using Microsoft.Data.SqlClient;
using System.Data;

var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();

// 連線字串來自 appsettings.json 的 ConnectionStrings:Gantt
string connStr = builder.Configuration.GetConnectionString("Gantt")
    ?? throw new InvalidOperationException("找不到連線字串 ConnectionStrings:Gantt");

const int DefaultYear = 2026;

// 1) 一次載入前端所需的全部資料：使用者、專案(含任務)、每週打卡、非專案事項
app.MapGet("/api/bootstrap", async (int? year) =>
{
    int y = year ?? DefaultYear;
    try
    {
        using var conn = new SqlConnection(connStr);
        await conn.OpenAsync();

        var users = new List<object>();
        using (var cmd = new SqlCommand(
            "SELECT UserName, Role FROM dbo.Users WHERE IsActive = 1 ORDER BY SortOrder", conn))
        using (var r = await cmd.ExecuteReaderAsync())
            while (await r.ReadAsync())
                users.Add(new { name = r.GetString(0), role = r.GetString(1) });

        var projMap = new Dictionary<int, ProjectDto>();
        var projOrder = new List<int>();
        using (var cmd = new SqlCommand(@"
            SELECT p.ProjectId, p.TypeCode, p.Category, u.UserName AS Owner, p.Name,
                   t.TaskCode, t.TaskName, t.StartWeek, t.EndWeek
            FROM dbo.Projects p
            JOIN dbo.Users u ON u.UserId = p.OwnerUserId
            LEFT JOIN dbo.Tasks t ON t.ProjectId = p.ProjectId AND t.IsDeleted = 0
            WHERE p.IsDeleted = 0
            ORDER BY p.OwnerUserId, p.SortOrder, p.ProjectId, t.SortOrder", conn))
        using (var r = await cmd.ExecuteReaderAsync())
            while (await r.ReadAsync())
            {
                int pid = r.GetInt32(0);
                if (!projMap.TryGetValue(pid, out var proj))
                {
                    proj = new ProjectDto
                    {
                        Id = pid,
                        Type = r.GetString(1),
                        Category = r.GetString(2),
                        Owner = r.GetString(3),
                        Name = r.GetString(4),
                        Tasks = new List<TaskItemDto>()
                    };
                    projMap[pid] = proj;
                    projOrder.Add(pid);
                }
                if (!r.IsDBNull(5))
                    proj.Tasks.Add(new TaskItemDto
                    {
                        Id = r.GetString(5),
                        Name = r.GetString(6),
                        Start = r.GetInt32(7),
                        End = r.GetInt32(8)
                    });
            }
        var projects = projOrder.Select(id => projMap[id]).ToList();

        // taskLogs[taskCode][week] = { status, note, isExecuting }
        var taskLogs = new Dictionary<string, Dictionary<int, object>>();
        using (var cmd = new SqlCommand(@"
            SELECT t.TaskCode, w.WeekNo, w.Status, w.Note
            FROM dbo.WeeklyLogs w
            JOIN dbo.Tasks t ON t.TaskId = w.TaskId
            WHERE w.ScheduleYear = @y", conn))
        {
            cmd.Parameters.AddWithValue("@y", y);
            using var r = await cmd.ExecuteReaderAsync();
            while (await r.ReadAsync())
            {
                string code = r.GetString(0);
                int wk = r.GetInt32(1);
                string status = r.GetString(2);
                string? note = r.IsDBNull(3) ? null : r.GetString(3);
                if (!taskLogs.TryGetValue(code, out var m)) { m = new(); taskLogs[code] = m; }
                m[wk] = new { status, note, isExecuting = status != "not_executed" };
            }
        }

        // extraNotes[userName][week] = note
        var extraNotes = new Dictionary<string, Dictionary<int, string>>();
        using (var cmd = new SqlCommand(@"
            SELECT u.UserName, e.WeekNo, e.Note
            FROM dbo.ExtraNotes e
            JOIN dbo.Users u ON u.UserId = e.UserId
            WHERE e.ScheduleYear = @y", conn))
        {
            cmd.Parameters.AddWithValue("@y", y);
            using var r = await cmd.ExecuteReaderAsync();
            while (await r.ReadAsync())
            {
                string name = r.GetString(0);
                int wk = r.GetInt32(1);
                string note = r.IsDBNull(2) ? "" : r.GetString(2);
                if (!extraNotes.TryGetValue(name, out var m)) { m = new(); extraNotes[name] = m; }
                m[wk] = note;
            }
        }

        return Results.Ok(new { year = y, users, projects, taskLogs, extraNotes });
    }
    catch (Exception ex)
    {
        return Results.Problem("讀取資料庫失敗：" + ex.Message);
    }
});

// 2) 打卡 (每週任務執行回報) — usp_UpsertWeeklyLog
app.MapPost("/api/weekly-log", async (WeeklyLogReq req) =>
{
    try
    {
        using var conn = new SqlConnection(connStr);
        await conn.OpenAsync();
        using var cmd = new SqlCommand("dbo.usp_UpsertWeeklyLog", conn) { CommandType = CommandType.StoredProcedure };
        cmd.Parameters.AddWithValue("@TaskCode", req.TaskCode);
        cmd.Parameters.AddWithValue("@Year", req.Year);
        cmd.Parameters.AddWithValue("@Week", req.Week);
        cmd.Parameters.AddWithValue("@Status", req.Status);
        cmd.Parameters.AddWithValue("@Note", (object?)req.Note ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@Actor", req.Actor);
        cmd.Parameters.AddWithValue("@ActorRole", (object?)req.ActorRole ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync();
        return Results.Ok(new { success = true });
    }
    catch (Exception ex) { return Results.Problem(ex.Message); }
});

// 3) 非專案事項 — usp_UpsertExtraNote
app.MapPost("/api/extra-note", async (ExtraNoteReq req) =>
{
    try
    {
        using var conn = new SqlConnection(connStr);
        await conn.OpenAsync();
        using var cmd = new SqlCommand("dbo.usp_UpsertExtraNote", conn) { CommandType = CommandType.StoredProcedure };
        cmd.Parameters.AddWithValue("@UserName", req.UserName);
        cmd.Parameters.AddWithValue("@Year", req.Year);
        cmd.Parameters.AddWithValue("@Week", req.Week);
        cmd.Parameters.AddWithValue("@Note", (object?)req.Note ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@Actor", req.Actor);
        cmd.Parameters.AddWithValue("@ActorRole", (object?)req.ActorRole ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync();
        return Results.Ok(new { success = true });
    }
    catch (Exception ex) { return Results.Problem(ex.Message); }
});

// 4) 主管修改任務排程 (名稱/起訖週) — usp_UpdateTaskSchedule
app.MapPost("/api/task-schedule", async (TaskScheduleReq req) =>
{
    try
    {
        using var conn = new SqlConnection(connStr);
        await conn.OpenAsync();
        using var cmd = new SqlCommand("dbo.usp_UpdateTaskSchedule", conn) { CommandType = CommandType.StoredProcedure };
        cmd.Parameters.AddWithValue("@TaskCode", req.TaskCode);
        cmd.Parameters.AddWithValue("@Name", req.Name);
        cmd.Parameters.AddWithValue("@Start", req.Start);
        cmd.Parameters.AddWithValue("@End", req.End);
        cmd.Parameters.AddWithValue("@Actor", req.Actor);
        cmd.Parameters.AddWithValue("@ActorRole", (object?)req.ActorRole ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync();
        return Results.Ok(new { success = true });
    }
    catch (Exception ex) { return Results.Problem(ex.Message); }
});

// 5) 主管新增專案 — usp_InsertProject
app.MapPost("/api/project", async (ProjectCreateReq req) =>
{
    try
    {
        using var conn = new SqlConnection(connStr);
        await conn.OpenAsync();
        using var cmd = new SqlCommand("dbo.usp_InsertProject", conn) { CommandType = CommandType.StoredProcedure };
        cmd.Parameters.AddWithValue("@TypeCode", req.Type);
        cmd.Parameters.AddWithValue("@Category", req.Category);
        cmd.Parameters.AddWithValue("@OwnerName", req.Owner);
        cmd.Parameters.AddWithValue("@Name", req.Name);
        cmd.Parameters.AddWithValue("@Year", req.Year);
        cmd.Parameters.AddWithValue("@Actor", req.Actor);
        cmd.Parameters.AddWithValue("@ActorRole", (object?)req.ActorRole ?? DBNull.Value);
        var outId = new SqlParameter("@NewProjectId", SqlDbType.Int) { Direction = ParameterDirection.Output };
        cmd.Parameters.Add(outId);
        await cmd.ExecuteNonQueryAsync();
        return Results.Ok(new { success = true, projectId = (int)outId.Value });
    }
    catch (Exception ex) { return Results.Problem(ex.Message); }
});

// 6) 主管修改專案 (名稱/分類/類型) — usp_UpdateProject
app.MapPost("/api/project/update", async (ProjectUpdateReq req) =>
{
    try
    {
        using var conn = new SqlConnection(connStr);
        await conn.OpenAsync();
        using var cmd = new SqlCommand("dbo.usp_UpdateProject", conn) { CommandType = CommandType.StoredProcedure };
        cmd.Parameters.AddWithValue("@ProjectId", req.ProjectId);
        cmd.Parameters.AddWithValue("@TypeCode", req.Type);
        cmd.Parameters.AddWithValue("@Category", req.Category);
        cmd.Parameters.AddWithValue("@OwnerName", req.Owner);
        cmd.Parameters.AddWithValue("@Name", req.Name);
        cmd.Parameters.AddWithValue("@Actor", req.Actor);
        cmd.Parameters.AddWithValue("@ActorRole", (object?)req.ActorRole ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync();
        return Results.Ok(new { success = true });
    }
    catch (Exception ex) { return Results.Problem(ex.Message); }
});

// 7) 主管刪除專案 (軟刪除，含任務) — usp_DeleteProject
app.MapPost("/api/project/delete", async (ProjectDeleteReq req) =>
{
    try
    {
        using var conn = new SqlConnection(connStr);
        await conn.OpenAsync();
        using var cmd = new SqlCommand("dbo.usp_DeleteProject", conn) { CommandType = CommandType.StoredProcedure };
        cmd.Parameters.AddWithValue("@ProjectId", req.ProjectId);
        cmd.Parameters.AddWithValue("@Actor", req.Actor);
        cmd.Parameters.AddWithValue("@ActorRole", (object?)req.ActorRole ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync();
        return Results.Ok(new { success = true });
    }
    catch (Exception ex) { return Results.Problem(ex.Message); }
});

// 8) 主管拖曳重新排序 — usp_ReorderProjects
app.MapPost("/api/project/reorder", async (ProjectReorderReq req) =>
{
    try
    {
        using var conn = new SqlConnection(connStr);
        await conn.OpenAsync();
        using var cmd = new SqlCommand("dbo.usp_ReorderProjects", conn) { CommandType = CommandType.StoredProcedure };
        cmd.Parameters.AddWithValue("@OrderedIdsJson", System.Text.Json.JsonSerializer.Serialize(req.OrderedIds ?? new List<int>()));
        cmd.Parameters.AddWithValue("@Actor", req.Actor);
        cmd.Parameters.AddWithValue("@ActorRole", (object?)req.ActorRole ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync();
        return Results.Ok(new { success = true });
    }
    catch (Exception ex) { return Results.Problem(ex.Message); }
});

// 9) 主管新增任務/計畫區間 — usp_InsertTask
app.MapPost("/api/task", async (TaskCreateReq req) =>
{
    try
    {
        using var conn = new SqlConnection(connStr);
        await conn.OpenAsync();
        using var cmd = new SqlCommand("dbo.usp_InsertTask", conn) { CommandType = CommandType.StoredProcedure };
        cmd.Parameters.AddWithValue("@ProjectId", req.ProjectId);
        cmd.Parameters.AddWithValue("@TaskName", req.TaskName);
        cmd.Parameters.AddWithValue("@Start", req.Start);
        cmd.Parameters.AddWithValue("@End", req.End);
        cmd.Parameters.AddWithValue("@Actor", req.Actor);
        cmd.Parameters.AddWithValue("@ActorRole", (object?)req.ActorRole ?? DBNull.Value);
        var outCode = new SqlParameter("@NewTaskCode", SqlDbType.NVarChar, 30) { Direction = ParameterDirection.Output };
        cmd.Parameters.Add(outCode);
        await cmd.ExecuteNonQueryAsync();
        return Results.Ok(new { success = true, taskCode = outCode.Value as string });
    }
    catch (Exception ex) { return Results.Problem(ex.Message); }
});

// 10) 主管刪除任務/區間 (軟刪除) — usp_DeleteTask
app.MapPost("/api/task/delete", async (TaskDeleteReq req) =>
{
    try
    {
        using var conn = new SqlConnection(connStr);
        await conn.OpenAsync();
        using var cmd = new SqlCommand("dbo.usp_DeleteTask", conn) { CommandType = CommandType.StoredProcedure };
        cmd.Parameters.AddWithValue("@TaskCode", req.TaskCode);
        cmd.Parameters.AddWithValue("@Actor", req.Actor);
        cmd.Parameters.AddWithValue("@ActorRole", (object?)req.ActorRole ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync();
        return Results.Ok(new { success = true });
    }
    catch (Exception ex) { return Results.Problem(ex.Message); }
});

app.Run();

class ProjectDto
{
    public int Id { get; set; }
    public string Type { get; set; } = "";
    public string Category { get; set; } = "";
    public string Owner { get; set; } = "";
    public string Name { get; set; } = "";
    public List<TaskItemDto> Tasks { get; set; } = new();
}

class TaskItemDto
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public int Start { get; set; }
    public int End { get; set; }
}

record WeeklyLogReq(string TaskCode, int Year, int Week, string Status, string? Note, string Actor, string? ActorRole);
record ExtraNoteReq(string UserName, int Year, int Week, string Note, string Actor, string? ActorRole);
record TaskScheduleReq(string TaskCode, string Name, int Start, int End, string Actor, string? ActorRole);
record ProjectCreateReq(string Type, string Category, string Owner, string Name, int Year, string Actor, string? ActorRole);
record ProjectUpdateReq(int ProjectId, string Type, string Category, string Owner, string Name, string Actor, string? ActorRole);
record ProjectDeleteReq(int ProjectId, string Actor, string? ActorRole);
record ProjectReorderReq(List<int>? OrderedIds, string Actor, string? ActorRole);
record TaskCreateReq(int ProjectId, string TaskName, int Start, int End, string Actor, string? ActorRole);
record TaskDeleteReq(string TaskCode, string Actor, string? ActorRole);
