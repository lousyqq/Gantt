using Microsoft.AspNetCore.Authentication.Negotiate;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Data.SqlClient;
using System.Data;

var builder = WebApplication.CreateBuilder(args);

// Windows 驗證(Negotiate/NTLM):僅 /api/whoami 要求驗證,其餘端點維持匿名。
// Kestrel 由此套件處理;掛 IIS 時 handler 會自動交給 IIS 的 Windows 驗證(IIS 需啟用 Windows Authentication,匿名驗證也要保持啟用)。
builder.Services.AddAuthentication(NegotiateDefaults.AuthenticationScheme).AddNegotiate();
builder.Services.AddAuthorization();

var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();
app.UseAuthentication();
app.UseAuthorization();

// 連線字串來自 appsettings.json 的 ConnectionStrings:Gantt
string connStr = builder.Configuration.GetConnectionString("Gantt")
    ?? throw new InvalidOperationException("找不到連線字串 ConnectionStrings:Gantt");

const int DefaultYear = 2026;

// 統一錯誤處理:內部例外只寫入伺服器 log、對外回一般化訊息(避免洩漏連線字串/資料表結構等細節);
// 預存程序以 RAISERROR 拋出的商業邏輯錯誤(Number=50000,自己撰寫的安全文字)則照原文回給前端。
IResult Fail(Exception ex)
{
    if (ex is SqlException sql && sql.Number == 50000)
        return Results.Problem(sql.Message, statusCode: 400);
    app.Logger.LogError(ex, "API 處理失敗");
    return Results.Problem("伺服器處理失敗，請稍後再試或聯絡系統管理員。");
}

// 0) 取得桌機目前 Windows 登入者的工號(參考 EQDashboard AuthController.WhoAmI)。
//    未帶 Windows 認證票證的請求會收到 401 + WWW-Authenticate: Negotiate,網域內瀏覽器會自動補上;
//    非網域環境前端 catch 掉即可(empId 視為 null,寫入動作照常、AuditLog 的工號欄留空)。
app.MapGet("/api/whoami", (HttpContext ctx) =>
{
    var stripPrefix = builder.Configuration["Auth:WindowsDomainStripPrefix"] ?? "UMC";
    var rawName = ctx.User?.Identity?.Name ?? "";

    // 先剝 DOMAIN\、再剝 @domain.com (Kerberos UPN 形態的保險)
    var empId = rawName
        .Replace($"{stripPrefix}\\", "", StringComparison.OrdinalIgnoreCase)
        .Trim();
    var atIdx = empId.IndexOf('@');
    if (atIdx > 0) empId = empId[..atIdx];
    // 非設定網域(如本機開發 MACHINE\user)也取反斜線後的帳號,避免整串含網域寫入 DB
    var bsIdx = empId.LastIndexOf('\\');
    if (bsIdx >= 0) empId = empId[(bsIdx + 1)..];

    return string.IsNullOrWhiteSpace(empId)
        ? Results.Ok(new { success = false, empId = (string?)null, rawName })
        : Results.Ok(new { success = true, empId = (string?)empId, rawName });
}).RequireAuthorization(new AuthorizeAttribute { AuthenticationSchemes = NegotiateDefaults.AuthenticationScheme });

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

        // 可切換的年度清單 + 該年度的週→月對照(供前端月份表頭與年度下拉)
        var years = new List<int>();
        using (var cmd = new SqlCommand(
            "SELECT DISTINCT ScheduleYear FROM dbo.ScheduleWeeks ORDER BY ScheduleYear", conn))
        using (var r = await cmd.ExecuteReaderAsync())
            while (await r.ReadAsync()) years.Add(r.GetInt32(0));

        var weeks = new List<object>();
        using (var cmd = new SqlCommand(
            "SELECT WeekNo, MonthName, MonthLabel FROM dbo.ScheduleWeeks WHERE ScheduleYear = @y ORDER BY WeekNo", conn))
        {
            cmd.Parameters.AddWithValue("@y", y);
            using var r = await cmd.ExecuteReaderAsync();
            while (await r.ReadAsync())
                weeks.Add(new { week = r.GetInt32(0), monthName = r.GetString(1), monthLabel = r.GetString(2) });
        }

        var projMap = new Dictionary<int, ProjectDto>();
        var projOrder = new List<int>();
        using (var cmd = new SqlCommand(@"
            SELECT p.ProjectId, p.TypeCode, p.Category, u.UserName AS Owner, p.Name,
                   t.TaskCode, t.TaskName, t.StartWeek, t.EndWeek
            FROM dbo.Projects p
            JOIN dbo.Users u ON u.UserId = p.OwnerUserId
            LEFT JOIN dbo.Tasks t ON t.ProjectId = p.ProjectId AND t.IsDeleted = 0
            WHERE p.IsDeleted = 0 AND p.ScheduleYear = @y
            ORDER BY p.OwnerUserId, p.SortOrder, p.ProjectId, t.SortOrder", conn))
        {
            cmd.Parameters.AddWithValue("@y", y);
            using var r = await cmd.ExecuteReaderAsync();
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

        return Results.Ok(new { year = y, years, weeks, users, projects, taskLogs, extraNotes });
    }
    catch (Exception ex) { return Fail(ex); }
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
        cmd.Parameters.AddWithValue("@ActorEmpId", (object?)req.ActorEmpId ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync();
        return Results.Ok(new { success = true });
    }
    catch (Exception ex) { return Fail(ex); }
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
        cmd.Parameters.AddWithValue("@ActorEmpId", (object?)req.ActorEmpId ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync();
        return Results.Ok(new { success = true });
    }
    catch (Exception ex) { return Fail(ex); }
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
        cmd.Parameters.AddWithValue("@ActorEmpId", (object?)req.ActorEmpId ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync();
        return Results.Ok(new { success = true });
    }
    catch (Exception ex) { return Fail(ex); }
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
        cmd.Parameters.AddWithValue("@ActorEmpId", (object?)req.ActorEmpId ?? DBNull.Value);
        var outId = new SqlParameter("@NewProjectId", SqlDbType.Int) { Direction = ParameterDirection.Output };
        cmd.Parameters.Add(outId);
        await cmd.ExecuteNonQueryAsync();
        return Results.Ok(new { success = true, projectId = (int)outId.Value });
    }
    catch (Exception ex) { return Fail(ex); }
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
        cmd.Parameters.AddWithValue("@ActorEmpId", (object?)req.ActorEmpId ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync();
        return Results.Ok(new { success = true });
    }
    catch (Exception ex) { return Fail(ex); }
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
        cmd.Parameters.AddWithValue("@ActorEmpId", (object?)req.ActorEmpId ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync();
        return Results.Ok(new { success = true });
    }
    catch (Exception ex) { return Fail(ex); }
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
        cmd.Parameters.AddWithValue("@ActorEmpId", (object?)req.ActorEmpId ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync();
        return Results.Ok(new { success = true });
    }
    catch (Exception ex) { return Fail(ex); }
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
        cmd.Parameters.AddWithValue("@ActorEmpId", (object?)req.ActorEmpId ?? DBNull.Value);
        var outCode = new SqlParameter("@NewTaskCode", SqlDbType.NVarChar, 30) { Direction = ParameterDirection.Output };
        cmd.Parameters.Add(outCode);
        await cmd.ExecuteNonQueryAsync();
        return Results.Ok(new { success = true, taskCode = outCode.Value as string });
    }
    catch (Exception ex) { return Fail(ex); }
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
        cmd.Parameters.AddWithValue("@ActorEmpId", (object?)req.ActorEmpId ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync();
        return Results.Ok(new { success = true });
    }
    catch (Exception ex) { return Fail(ex); }
});

// 11) 稽核紀錄查詢(主管「異動紀錄」面板) — 讀 AuditLog 最近 N 筆
app.MapGet("/api/audit-log", async (int? top) =>
{
    int n = Math.Clamp(top ?? 200, 1, 1000);
    try
    {
        using var conn = new SqlConnection(connStr);
        await conn.OpenAsync();
        var logs = new List<object>();
        using var cmd = new SqlCommand(@"
            SELECT TOP (@n) AuditId, ActorName, ActorRole, ActorEmpId, Action, EntityType, EntityId, NewValue, Detail, CreatedAt
            FROM dbo.AuditLog
            ORDER BY AuditId DESC", conn);
        cmd.Parameters.AddWithValue("@n", n);
        using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
            logs.Add(new
            {
                id = r.GetInt64(0),
                actor = r.GetString(1),
                role = r.IsDBNull(2) ? null : r.GetString(2),
                empId = r.IsDBNull(3) ? null : r.GetString(3),
                action = r.GetString(4),
                entityType = r.GetString(5),
                entityId = r.IsDBNull(6) ? null : r.GetString(6),
                newValue = r.IsDBNull(7) ? null : r.GetString(7),
                detail = r.IsDBNull(8) ? null : r.GetString(8),
                at = r.GetDateTime(9).ToString("yyyy-MM-dd HH:mm:ss")
            });
        return Results.Ok(new { logs });
    }
    catch (Exception ex) { return Fail(ex); }
});

// 12) 匯出週報 Excel(主管「團隊總結」面板的下載按鈕) — ClosedXML 產生 .xlsx
app.MapGet("/api/weekly-report-excel", async (int? year, int? week) =>
{
    int y = year ?? DefaultYear;
    int w = week ?? 1;
    try
    {
        // --- 撈本週排定任務(含未回報)與非專案事項 ---
        var rows = new List<(string Owner, string Category, string Type, string Project, string Task, int Start, int End, string? Status, string? Note)>();
        var notes = new List<(string Owner, string Note)>();
        using (var conn = new SqlConnection(connStr))
        {
            await conn.OpenAsync();
            using (var cmd = new SqlCommand(@"
                SELECT u.UserName, p.Category, p.TypeCode, p.Name, t.TaskName, t.StartWeek, t.EndWeek, w.Status, w.Note
                FROM dbo.Tasks t
                JOIN dbo.Projects p ON p.ProjectId = t.ProjectId AND p.IsDeleted = 0 AND p.ScheduleYear = @y
                JOIN dbo.Users u    ON u.UserId = p.OwnerUserId
                LEFT JOIN dbo.WeeklyLogs w ON w.TaskId = t.TaskId AND w.ScheduleYear = @y AND w.WeekNo = @w
                WHERE t.IsDeleted = 0 AND t.StartWeek <= @w AND t.EndWeek >= @w
                ORDER BY u.SortOrder, p.SortOrder, p.ProjectId, t.SortOrder", conn))
            {
                cmd.Parameters.AddWithValue("@y", y);
                cmd.Parameters.AddWithValue("@w", w);
                using var r = await cmd.ExecuteReaderAsync();
                while (await r.ReadAsync())
                    rows.Add((r.GetString(0), r.GetString(1), r.GetString(2), r.GetString(3), r.GetString(4),
                              r.GetInt32(5), r.GetInt32(6),
                              r.IsDBNull(7) ? null : r.GetString(7),
                              r.IsDBNull(8) ? null : r.GetString(8)));
            }
            using (var cmd = new SqlCommand(@"
                SELECT u.UserName, e.Note
                FROM dbo.ExtraNotes e
                JOIN dbo.Users u ON u.UserId = e.UserId
                WHERE e.ScheduleYear = @y AND e.WeekNo = @w
                ORDER BY u.SortOrder", conn))
            {
                cmd.Parameters.AddWithValue("@y", y);
                cmd.Parameters.AddWithValue("@w", w);
                using var r = await cmd.ExecuteReaderAsync();
                while (await r.ReadAsync())
                    notes.Add((r.GetString(0), r.IsDBNull(1) ? "" : r.GetString(1)));
            }
        }

        var statusLabel = new Dictionary<string, string>
        { ["executed"] = "有執行", ["monitor"] = "Monitor", ["not_executed"] = "未執行" };

        using var wb = new ClosedXML.Excel.XLWorkbook();

        // --- Sheet 1:專案執行 ---
        var ws = wb.Worksheets.Add($"W{w:00} 專案執行");
        string[] headers = { "成員", "分類", "類型", "專案名稱", "計畫任務", "排程", "本週狀態", "工作說明" };
        for (int i = 0; i < headers.Length; i++) ws.Cell(1, i + 1).Value = headers[i];
        var head = ws.Range(1, 1, 1, headers.Length);
        head.Style.Font.Bold = true;
        head.Style.Font.FontColor = ClosedXML.Excel.XLColor.White;
        head.Style.Fill.BackgroundColor = ClosedXML.Excel.XLColor.FromArgb(0x00, 0x1F, 0x5B);
        head.Style.Alignment.Horizontal = ClosedXML.Excel.XLAlignmentHorizontalValues.Center;

        int row = 2;
        foreach (var t in rows)
        {
            ws.Cell(row, 1).Value = t.Owner;
            ws.Cell(row, 2).Value = t.Category;
            ws.Cell(row, 3).Value = t.Type.ToUpperInvariant();
            ws.Cell(row, 4).Value = t.Project;
            ws.Cell(row, 5).Value = t.Task;
            ws.Cell(row, 6).Value = $"W{t.Start}–W{t.End}";
            ws.Cell(row, 7).Value = t.Status is null ? "未回報" : (statusLabel.GetValueOrDefault(t.Status, t.Status));
            ws.Cell(row, 8).Value = t.Note ?? "";
            var st = ws.Cell(row, 7).Style;
            st.Font.Bold = true;
            st.Fill.BackgroundColor = t.Status switch
            {
                "executed"     => ClosedXML.Excel.XLColor.FromArgb(0xD1, 0xFA, 0xE5),   // 綠
                "monitor"      => ClosedXML.Excel.XLColor.FromArgb(0xDB, 0xEA, 0xFE),   // 藍
                "not_executed" => ClosedXML.Excel.XLColor.FromArgb(0xE2, 0xE8, 0xF0),   // 灰
                _              => ClosedXML.Excel.XLColor.FromArgb(0xFE, 0xF3, 0xC7)    // 未回報 = 黃
            };
            row++;
        }
        var used = ws.Range(1, 1, Math.Max(row - 1, 1), headers.Length);
        used.Style.Border.InsideBorder = ClosedXML.Excel.XLBorderStyleValues.Thin;
        used.Style.Border.OutsideBorder = ClosedXML.Excel.XLBorderStyleValues.Thin;
        ws.SheetView.FreezeRows(1);
        ws.Column(4).Width = 45; ws.Column(5).Width = 30; ws.Column(8).Width = 50;
        ws.Columns(1, 3).AdjustToContents(); ws.Column(6).AdjustToContents(); ws.Column(7).AdjustToContents();
        ws.Column(8).Style.Alignment.WrapText = true;

        // --- Sheet 2:非專案事項 ---
        var ws2 = wb.Worksheets.Add($"W{w:00} 非專案事項");
        ws2.Cell(1, 1).Value = "成員"; ws2.Cell(1, 2).Value = "非專案工作內容";
        var head2 = ws2.Range(1, 1, 1, 2);
        head2.Style.Font.Bold = true;
        head2.Style.Font.FontColor = ClosedXML.Excel.XLColor.White;
        head2.Style.Fill.BackgroundColor = ClosedXML.Excel.XLColor.FromArgb(0xEA, 0x58, 0x0C);
        int row2 = 2;
        foreach (var n in notes)
        {
            ws2.Cell(row2, 1).Value = n.Owner;
            ws2.Cell(row2, 2).Value = n.Note;
            row2++;
        }
        var used2 = ws2.Range(1, 1, Math.Max(row2 - 1, 1), 2);
        used2.Style.Border.InsideBorder = ClosedXML.Excel.XLBorderStyleValues.Thin;
        used2.Style.Border.OutsideBorder = ClosedXML.Excel.XLBorderStyleValues.Thin;
        ws2.Column(1).AdjustToContents();
        ws2.Column(2).Width = 80;
        ws2.Column(2).Style.Alignment.WrapText = true;
        ws2.SheetView.FreezeRows(1);

        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return Results.File(ms.ToArray(),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            $"WeeklyReport_{y}_W{w:00}.xlsx");
    }
    catch (Exception ex) { return Fail(ex); }
});

// 13) 主管新增成員 — usp_InsertUser(同名成員曾被移除則重新啟用)
app.MapPost("/api/user", async (UserCreateReq req) =>
{
    try
    {
        using var conn = new SqlConnection(connStr);
        await conn.OpenAsync();
        using var cmd = new SqlCommand("dbo.usp_InsertUser", conn) { CommandType = CommandType.StoredProcedure };
        cmd.Parameters.AddWithValue("@UserName", req.UserName);
        cmd.Parameters.AddWithValue("@Actor", req.Actor);
        cmd.Parameters.AddWithValue("@ActorRole", (object?)req.ActorRole ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@ActorEmpId", (object?)req.ActorEmpId ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync();
        return Results.Ok(new { success = true });
    }
    catch (Exception ex) { return Fail(ex); }
});

// 14) 主管修改成員名稱 — usp_UpdateUser(專案/回報以 UserId 關聯,歷史資料自動跟隨)
app.MapPost("/api/user/update", async (UserUpdateReq req) =>
{
    try
    {
        using var conn = new SqlConnection(connStr);
        await conn.OpenAsync();
        using var cmd = new SqlCommand("dbo.usp_UpdateUser", conn) { CommandType = CommandType.StoredProcedure };
        cmd.Parameters.AddWithValue("@UserName", req.UserName);
        cmd.Parameters.AddWithValue("@NewName", req.NewName);
        cmd.Parameters.AddWithValue("@Actor", req.Actor);
        cmd.Parameters.AddWithValue("@ActorRole", (object?)req.ActorRole ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@ActorEmpId", (object?)req.ActorEmpId ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync();
        return Results.Ok(new { success = true });
    }
    catch (Exception ex) { return Fail(ex); }
});

// 15) 主管移除成員 (軟刪除=IsActive:0，名下仍有專案時回 400) — usp_DeleteUser
app.MapPost("/api/user/delete", async (UserDeleteReq req) =>
{
    try
    {
        using var conn = new SqlConnection(connStr);
        await conn.OpenAsync();
        using var cmd = new SqlCommand("dbo.usp_DeleteUser", conn) { CommandType = CommandType.StoredProcedure };
        cmd.Parameters.AddWithValue("@UserName", req.UserName);
        cmd.Parameters.AddWithValue("@Actor", req.Actor);
        cmd.Parameters.AddWithValue("@ActorRole", (object?)req.ActorRole ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@ActorEmpId", (object?)req.ActorEmpId ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync();
        return Results.Ok(new { success = true });
    }
    catch (Exception ex) { return Fail(ex); }
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

// ActorEmpId = 前端 /api/whoami 偵測到的 Windows 工號(如 00058897);非網域環境為 null,由 apiPost 自動附帶
record WeeklyLogReq(string TaskCode, int Year, int Week, string Status, string? Note, string Actor, string? ActorRole, string? ActorEmpId);
record ExtraNoteReq(string UserName, int Year, int Week, string Note, string Actor, string? ActorRole, string? ActorEmpId);
record TaskScheduleReq(string TaskCode, string Name, int Start, int End, string Actor, string? ActorRole, string? ActorEmpId);
record ProjectCreateReq(string Type, string Category, string Owner, string Name, int Year, string Actor, string? ActorRole, string? ActorEmpId);
record ProjectUpdateReq(int ProjectId, string Type, string Category, string Owner, string Name, string Actor, string? ActorRole, string? ActorEmpId);
record ProjectDeleteReq(int ProjectId, string Actor, string? ActorRole, string? ActorEmpId);
record ProjectReorderReq(List<int>? OrderedIds, string Actor, string? ActorRole, string? ActorEmpId);
record TaskCreateReq(int ProjectId, string TaskName, int Start, int End, string Actor, string? ActorRole, string? ActorEmpId);
record TaskDeleteReq(string TaskCode, string Actor, string? ActorRole, string? ActorEmpId);
record UserCreateReq(string UserName, string Actor, string? ActorRole, string? ActorEmpId);
record UserUpdateReq(string UserName, string NewName, string Actor, string? ActorRole, string? ActorEmpId);
record UserDeleteReq(string UserName, string Actor, string? ActorRole, string? ActorEmpId);
