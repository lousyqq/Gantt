using Microsoft.AspNetCore.Authentication.Negotiate;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Data.SqlClient;
using System.Data;

var builder = WebApplication.CreateBuilder(args);

// Windows 驗證(Negotiate/NTLM):僅 /api/whoami 要求驗證,其餘端點維持匿名。
// Kestrel 由此套件處理;掛 IIS 時 handler 會自動交給 IIS 的 Windows 驗證(IIS 需啟用 Windows Authentication,匿名驗證也要保持啟用)。
builder.Services.AddAuthentication(NegotiateDefaults.AuthenticationScheme).AddNegotiate();
builder.Services.AddAuthorization();
builder.Services.AddHttpContextAccessor();   // 多站台:ConnStr() 要從目前請求的 PathBase 判斷是哪個群組(見 ResolveSite)

var app = builder.Build();

// 本機模擬 IIS 子目錄(只在設定了 PathBase 時生效;IIS 上不需要,ASP.NET Core Module 會自己填 PathBase):
//   dotnet run --project Gantt.csproj --urls http://localhost:5099 --PathBase /Gantt_IMD
// 之後用 http://localhost:5099/Gantt_IMD/ 開,ResolveSite() 就會挑 Sites:Gantt_IMD,可在開發機驗證多站台設定。
var devPathBase = app.Configuration["PathBase"];
if (!string.IsNullOrWhiteSpace(devPathBase)) app.UsePathBase(devPathBase);

app.UseDefaultFiles();
app.UseStaticFiles();
app.UseAuthentication();
app.UseAuthorization();

// ── 多站台(2026-09-13):同一份程式發佈到四個 IIS application(/Gantt、/Gantt_IMD、/Gantt_EMS1、/Gantt_EMS2),
//    各連自己的 DB、各有自己的群組名稱。**用 IIS application 的路徑(Request.PathBase)當 key** 去 appsettings 的 Sites 段落找設定:
//      "Sites": { "Gantt": { "GroupName": "MSD", "ConnectionString": "…Database=Gantt…" }, "Gantt_IMD": { … }, … },
//      "SiteDefault": "Gantt"        ← PathBase 為空(本機 dotnet run)或找不到對應 key 時用哪一個
//    四個資料夾放**完全相同**的設定檔即可,發佈時不必再逐一改連線字串與群組名稱。
//    ⚠ PathBase 是 IIS 依 application 設定填的,不是使用者可以在網址上改的東西,所以拿它選 DB 是安全的;
//      Kestrel 本機沒有 PathBase → 走 SiteDefault。IConfiguration 的 key 不分大小寫,/gantt_imd 也對得到。
//    ⚠ 沒有 Sites 段落時退回舊格式(ConnectionStrings:Gantt ＋ Site:GroupName,預設 MSD)——舊部署不改設定照樣能跑。
//    與過去相同,每次取用即時讀取(reloadOnChange):部署後改檔數秒生效,無須回收應用程式集區。
var httpCtx = app.Services.GetRequiredService<IHttpContextAccessor>();
(string Key, string GroupName, string Conn) ResolveSite()
{
    var cfg = app.Configuration;
    var sites = cfg.GetSection("Sites");
    if (sites.Exists())
    {
        var pathKey = (httpCtx.HttpContext?.Request.PathBase.Value ?? "").Trim('/');
        var key = pathKey.Length > 0 && sites.GetSection(pathKey).Exists() ? pathKey : (cfg["SiteDefault"] ?? "");
        var sec = sites.GetSection(key);
        if (key.Length > 0 && sec.Exists())
        {
            var conn = sec["ConnectionString"];
            if (string.IsNullOrWhiteSpace(conn))
                throw new InvalidOperationException($"Sites:{key}:ConnectionString 未設定");
            return (key, sec["GroupName"] ?? key, conn);
        }
        throw new InvalidOperationException($"找不到站台設定：PathBase=/{pathKey}、SiteDefault={cfg["SiteDefault"]}（請檢查 appsettings 的 Sites 段落）");
    }
    return ("Gantt", cfg["Site:GroupName"] ?? "MSD",
        cfg.GetConnectionString("Gantt") ?? throw new InvalidOperationException("找不到連線字串 ConnectionStrings:Gantt"));
}
string ConnStr() => ResolveSite().Conn;

// 站台資訊(群組名稱):前端登入頁標題、header、document.title 都用它,取代原本寫死的「MSD」。
// 刻意不碰 DB——DB 連不上時 ErrorScreen 的標題也要對。
app.MapGet("/api/site", () =>
{
    try { var s = ResolveSite(); return Results.Ok(new { siteKey = s.Key, groupName = s.GroupName }); }
    catch (Exception ex) { return Fail(ex); }
});

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

// 使用者輸入錯誤 → 400 + 看得懂的訊息。
// ⚠ 不要讓這類錯誤掉進 Fail(ex):那會變成 500「伺服器處理失敗，請稍後再試」——
//    但「專案名稱空白」「結束週早於開始週」不是伺服器壞了,是使用者少填/填錯,
//    回一句不能行動的話,使用者只會一直重試同樣的輸入。
// 前端各表單目前都有對應的即時驗證,這裡是第二道防線(前端漏擋、或直接打 API 時)。
IResult Bad(string message) => Results.Problem(message, statusCode: 400);

// 週次上下限以 ScheduleWeeks 為準,但驗證只擋明顯不合理的值(1~53);
// 「該年度到底有幾週」交給 SP 內的外鍵/檢查去判斷,避免這裡與 DB 各有一份週數定義。
const int MaxWeekNo = 53;
static bool BlankStr(string? s) => string.IsNullOrWhiteSpace(s);
IResult? ValidateWeekRange(int start, int end)
{
    if (start < 1 || start > MaxWeekNo || end < 1 || end > MaxWeekNo)
        return Bad($"週次需介於 1–{MaxWeekNo}（目前為 W{start}–W{end}）。");
    if (start > end)
        return Bad($"開始週不可晚於結束週（目前為 W{start}–W{end}）。");
    return null;
}

// 打卡回報的「文件連結」驗證(選填)。長度與 WeeklyLogs.DocUrl NVARCHAR(500) 一致。
// 🚨 `javascript:`／`data:`／`vbscript:` 一律擋掉:這個值會被前端放進 <a href>,
//    存進去等於一個「主管一定會點」的儲存型 XSS。前端也擋一次,但前端擋不住直接打 API,
//    所以真正的防線在這裡。允許的形式=http/https 網址、UNC 路徑(\\server\share)、本機路徑。
// 「尚未到的週次」不可回報／回覆(2026-09-12 使用者決定:系統是檢視過去到現在的專案狀態,主管也不開放對未來週打卡)。
// 以伺服器今天的 ISO 週為準(與前端 getTodayWeek 同一套演算法:週一起始、含跨年 53 週);前端已擋,這是第二道防線。
static bool IsFutureWeek(int year, int week)
{
    var today = DateTime.Today;
    int y = System.Globalization.ISOWeek.GetYear(today), w = System.Globalization.ISOWeek.GetWeekOfYear(today);
    return year > y || (year == y && week > w);
}
IResult? RejectFutureWeek(int year, int week, string what) =>
    IsFutureWeek(year, week) ? Bad($"W{week:00} 尚未到，不可預先{what}。") : null;

// AppSettings 布林開關(缺列＝false):AllowRetroCheckin／AccessControlEnabled 這類主管在網頁上切的設定。
static async Task<bool> SettingOn(SqlConnection conn, string key)
{
    using var cmd = new SqlCommand("SELECT Value FROM dbo.AppSettings WHERE KeyName = @k", conn);
    cmd.Parameters.AddWithValue("@k", key);
    return ((await cmd.ExecuteScalarAsync()) as string)?.Equals("true", StringComparison.OrdinalIgnoreCase) == true;
}
// 子區間打卡總開關(2026-09-12):**放 appsettings.json 的 Features:SubIntervalCheckin,不放 DB、不做在網頁上**——
// 使用者要求避免誤操作(這是改變全體回報單位的設定,不該一顆鈕就切)。與連線字串同樣每次即時讀(reloadOnChange),
// 改檔存檔數秒內生效、使用者重新整理即套用。缺值＝false(子區間只排程不打卡)。
bool SubCheckinOn() => app.Configuration.GetValue<bool>("Features:SubIntervalCheckin", false);

const int DocUrlMax = 500;
IResult? ValidateDocUrl(string? url)
{
    var s = (url ?? "").Trim();
    if (s.Length == 0) return null;
    if (s.Length > DocUrlMax) return Bad($"文件連結請勿超過 {DocUrlMax} 個字元（目前 {s.Length} 個）。");
    if (System.Text.RegularExpressions.Regex.IsMatch(s, @"^\s*(javascript|data|vbscript)\s*:", System.Text.RegularExpressions.RegexOptions.IgnoreCase))
        return Bad("文件連結格式不正確，請貼上網址（http/https）或檔案路徑。");
    return null;
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
        using var conn = new SqlConnection(ConnStr());
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
                   t.TaskCode, t.TaskName, t.StartWeek, t.EndWeek, p.Deliverable, p.MpSaving,
                   CAST(ISNULL(p.IsStarred, 0) AS BIT) AS IsStarred, p.NID AS ProjNID, t.NID AS TaskNID
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
                        Deliverable = r.IsDBNull(9) ? null : r.GetString(9),
                        MpSaving = r.IsDBNull(10) ? null : r.GetString(10),
                        IsStarred = Convert.ToBoolean(r.GetValue(11)),
                        Nid = r.IsDBNull(12) ? null : r.GetString(12),
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
                        End = r.GetInt32(8),
                        Nid = r.IsDBNull(13) ? null : r.GetString(13)
                    });
            }
        }
        var projects = projOrder.Select(id => projMap[id]).ToList();

        // 子區間(遷移 18):掛到 tasks[*].subs。父區間／專案已軟刪的自然不會被 JOIN 到。
        // 只有在 TaskSubIntervals 存在時才查:遠端尚未跑遷移 18 的話,整包 bootstrap 不能因此失敗
        // (遷移 16/17 曾因 DocUrl 欄位不存在讓整個系統開不起來,同一個坑不踩第二次)。
        var taskByCode = projects.SelectMany(p => p.Tasks).ToDictionary(t => t.Id);
        using (var chk = new SqlCommand("SELECT OBJECT_ID('dbo.TaskSubIntervals','U')", conn))
        if (await chk.ExecuteScalarAsync() is not DBNull and not null)
        {
            using var cmd = new SqlCommand(@"
                SELECT t.TaskCode, s.SubId, s.Name, s.StartWeek, s.EndWeek
                FROM dbo.TaskSubIntervals s
                JOIN dbo.Tasks t    ON t.TaskId = s.TaskId AND t.IsDeleted = 0
                JOIN dbo.Projects p ON p.ProjectId = t.ProjectId AND p.IsDeleted = 0 AND p.ScheduleYear = @y
                WHERE s.IsDeleted = 0
                ORDER BY s.StartWeek, s.EndWeek, s.SortOrder, s.SubId", conn);
            cmd.Parameters.AddWithValue("@y", y);
            using var r = await cmd.ExecuteReaderAsync();
            while (await r.ReadAsync())
                if (taskByCode.TryGetValue(r.GetString(0), out var task))
                    task.Subs.Add(new SubIntervalDto { Id = r.GetInt32(1), Name = r.GetString(2), Start = r.GetInt32(3), End = r.GetInt32(4) });
        }

        // taskLogs[taskCode][week] = { status, note, docUrl, isExecuting, score, reporter, reporterRole, updatedAt }
        //   ＝對「計畫區間」的回報(SubId IS NULL);
        // subLogs[subId][week]     = 同格式,＝對「子區間」的回報(遷移 20)。
        // 兩份分開放:前端所有 `taskLogs[t.id]?.[week]` 取值點語意不變(仍是父層那筆),
        // 子區間那份另外查;回報單位由前端依「該週有無進行中的子區間」判斷(見 app.jsx weekUnits)。
        // ⚠ 遷移 20 之前 WeeklyLogs 沒有 SubId 欄:先 COL_LENGTH 檢查再決定 SQL,遠端未跑遷移時整包不能因此失敗。
        bool hasSubLogCol;
        using (var chk = new SqlCommand("SELECT COL_LENGTH('dbo.WeeklyLogs','SubId')", conn))
            hasSubLogCol = await chk.ExecuteScalarAsync() is not DBNull and not null;
        var taskLogs = new Dictionary<string, Dictionary<int, object>>();
        var subLogs = new Dictionary<int, Dictionary<int, object>>();
        using (var cmd = new SqlCommand(@"
            SELECT t.TaskCode, w.WeekNo, w.Status, w.Note, w.Score, u.UserName, u.Role, w.UpdatedAt, w.DocUrl" +
            (hasSubLogCol ? ", w.SubId" : ", NULL AS SubId") + @"
            FROM dbo.WeeklyLogs w
            JOIN dbo.Tasks t ON t.TaskId = w.TaskId
            LEFT JOIN dbo.Users u ON u.UserId = w.ReportedByUserId
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
                decimal score = r.GetDecimal(4);
                string? reporter = r.IsDBNull(5) ? null : r.GetString(5);
                string? reporterRole = r.IsDBNull(6) ? null : r.GetString(6);
                string updatedAt = r.GetDateTime(7).ToString("yyyy-MM-dd HH:mm");
                string? docUrl = r.IsDBNull(8) ? null : r.GetString(8);
                int? subId = r.IsDBNull(9) ? null : r.GetInt32(9);
                var log = new { status, note, docUrl, isExecuting = status != "not_executed", score, reporter, reporterRole, updatedAt };
                if (subId is int sid)
                {
                    if (!subLogs.TryGetValue(sid, out var sm)) { sm = new(); subLogs[sid] = sm; }
                    sm[wk] = log;
                }
                else
                {
                    if (!taskLogs.TryGetValue(code, out var m)) { m = new(); taskLogs[code] = m; }
                    m[wk] = log;
                }
            }
        }

        // extraNotes[userName][week] = note；extraNoteMeta[userName][week] = { by, byRole, at, docUrl }
        // ⚠ docUrl 放在 *Meta 而不是另開一組 map:內容本身是純字串(前端到處都是 `extraNotes[u]?.[w] || ''`),
        //   改成物件會動到十幾個取值點;而 meta 物件本來就跟著內容一路傳到每個顯示/編輯的地方
        //   (彈窗的 meta prop、看板的 extraMeta/planMeta、代修面板),放這裡零新增 prop、也不會漏掉任何一處。
        //   MetaLine 只讀 by/byRole/at,多一個欄位不影響。weeklyPlanMeta 同理。
        var extraNotes = new Dictionary<string, Dictionary<int, string>>();
        var extraNoteMeta = new Dictionary<string, Dictionary<int, object>>();
        using (var cmd = new SqlCommand(@"
            SELECT u.UserName, e.WeekNo, e.Note, u2.UserName, u2.Role, e.UpdatedAt, e.DocUrl
            FROM dbo.ExtraNotes e
            JOIN dbo.Users u ON u.UserId = e.UserId
            LEFT JOIN dbo.Users u2 ON u2.UserId = e.UpdatedByUserId
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
                if (!extraNoteMeta.TryGetValue(name, out var mm)) { mm = new(); extraNoteMeta[name] = mm; }
                mm[wk] = new
                {
                    by = r.IsDBNull(3) ? null : r.GetString(3),
                    byRole = r.IsDBNull(4) ? null : r.GetString(4),
                    at = r.GetDateTime(5).ToString("yyyy-MM-dd HH:mm"),
                    docUrl = r.IsDBNull(6) ? null : r.GetString(6)
                };
            }
        }

        // weeklyComments[userName][week] = 主管週報回覆(選填;空字串=已清空,不回傳)；weeklyCommentMeta 同步帶最後編輯人/時間
        var weeklyComments = new Dictionary<string, Dictionary<int, string>>();
        var weeklyCommentMeta = new Dictionary<string, Dictionary<int, object>>();
        using (var cmd = new SqlCommand(@"
            SELECT u.UserName, wc.WeekNo, wc.Comment, u2.UserName, u2.Role, wc.UpdatedAt
            FROM dbo.WeeklyComments wc
            JOIN dbo.Users u ON u.UserId = wc.UserId
            LEFT JOIN dbo.Users u2 ON u2.UserId = wc.UpdatedByUserId
            WHERE wc.ScheduleYear = @y AND wc.Comment <> N''", conn))
        {
            cmd.Parameters.AddWithValue("@y", y);
            using var r = await cmd.ExecuteReaderAsync();
            while (await r.ReadAsync())
            {
                string name = r.GetString(0);
                int wk = r.GetInt32(1);
                string cmt = r.IsDBNull(2) ? "" : r.GetString(2);
                if (!weeklyComments.TryGetValue(name, out var m)) { m = new(); weeklyComments[name] = m; }
                m[wk] = cmt;
                if (!weeklyCommentMeta.TryGetValue(name, out var mm)) { mm = new(); weeklyCommentMeta[name] = mm; }
                mm[wk] = new
                {
                    by = r.IsDBNull(3) ? null : r.GetString(3),
                    byRole = r.IsDBNull(4) ? null : r.GetString(4),
                    at = r.GetDateTime(5).ToString("yyyy-MM-dd HH:mm")
                };
            }
        }

        // weeklyPlans[userName][week] = 下週預計執行工作(填寫於該週)；weeklyPlanMeta = { by, byRole, at, docUrl }
        var weeklyPlans = new Dictionary<string, Dictionary<int, string>>();
        var weeklyPlanMeta = new Dictionary<string, Dictionary<int, object>>();
        using (var cmd = new SqlCommand(@"
            SELECT u.UserName, wp.WeekNo, wp.Note, u2.UserName, u2.Role, wp.UpdatedAt, wp.DocUrl
            FROM dbo.WeeklyPlans wp
            JOIN dbo.Users u ON u.UserId = wp.UserId
            LEFT JOIN dbo.Users u2 ON u2.UserId = wp.UpdatedByUserId
            WHERE wp.ScheduleYear = @y", conn))
        {
            cmd.Parameters.AddWithValue("@y", y);
            using var r = await cmd.ExecuteReaderAsync();
            while (await r.ReadAsync())
            {
                string name = r.GetString(0);
                int wk = r.GetInt32(1);
                string note = r.IsDBNull(2) ? "" : r.GetString(2);
                if (!weeklyPlans.TryGetValue(name, out var m)) { m = new(); weeklyPlans[name] = m; }
                m[wk] = note;
                if (!weeklyPlanMeta.TryGetValue(name, out var mm)) { mm = new(); weeklyPlanMeta[name] = mm; }
                mm[wk] = new
                {
                    by = r.IsDBNull(3) ? null : r.GetString(3),
                    byRole = r.IsDBNull(4) ? null : r.GetString(4),
                    at = r.GetDateTime(5).ToString("yyyy-MM-dd HH:mm"),
                    docUrl = r.IsDBNull(6) ? null : r.GetString(6)
                };
            }
        }

        bool allowRetroCheckin = await SettingOn(conn, "AllowRetroCheckin");
        bool subCheckinEnabled = SubCheckinOn();

        return Results.Ok(new { year = y, years, weeks, users, projects, taskLogs, subLogs, subCheckinEnabled, extraNotes, extraNoteMeta, weeklyPlans, weeklyPlanMeta, weeklyComments, weeklyCommentMeta, allowRetroCheckin });
    }
    catch (Exception ex) { return Fail(ex); }
});

// 2) 打卡 (每週任務執行回報) — usp_UpsertWeeklyLog
app.MapPost("/api/weekly-log", async (WeeklyLogReq req) =>
{
    if (BlankStr(req.TaskCode)) return Bad("缺少任務代碼。");
    if (BlankStr(req.Actor)) return Bad("缺少回報人。");
    if (req.Week < 1 || req.Week > MaxWeekNo) return Bad($"週次需介於 1–{MaxWeekNo}。");
    // 狀態只有這三種(對應甘特條的綠/藍/灰);其他值寫進去會讓前端查不到對應的顏色與標籤
    if (req.Status is not ("executed" or "monitor" or "not_executed"))
        return Bad("回報狀態不正確（僅接受 有執行／Monitor／未執行）。");
    if (RejectFutureWeek(req.Year, req.Week, "回報") is { } futErr) return futErr;
    var docErr = ValidateDocUrl(req.DocUrl);
    if (docErr is not null) return docErr;
    try
    {
        using var conn = new SqlConnection(ConnStr());
        await conn.OpenAsync();
        if (req.SubId is not null && !SubCheckinOn())
            return Bad("「子區間打卡」功能目前未開啟，請對計畫區間回報。");
        using var cmd = new SqlCommand("dbo.usp_UpsertWeeklyLog", conn) { CommandType = CommandType.StoredProcedure };
        cmd.Parameters.AddWithValue("@TaskCode", req.TaskCode);
        cmd.Parameters.AddWithValue("@Year", req.Year);
        cmd.Parameters.AddWithValue("@Week", req.Week);
        cmd.Parameters.AddWithValue("@Status", req.Status);
        cmd.Parameters.AddWithValue("@Note", (object?)req.Note ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@Actor", req.Actor);
        cmd.Parameters.AddWithValue("@ActorRole", (object?)req.ActorRole ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@ActorEmpId", (object?)req.ActorEmpId ?? DBNull.Value);
        // 空字串照樣送:SP 內 NULLIF 會轉成 NULL,使用者才能把已填的連結清空
        cmd.Parameters.AddWithValue("@DocUrl", (object?)req.DocUrl?.Trim() ?? DBNull.Value);
        // 子區間打卡(遷移 20):**只在有值時才傳 @SubId**——遠端尚未跑遷移 20 時 SP 沒這個參數,
        // 一律傳會讓所有打卡(含對計畫區間的)整個壞掉;不傳則舊 SP 照常運作。
        if (req.SubId is int subId) cmd.Parameters.AddWithValue("@SubId", subId);
        await cmd.ExecuteNonQueryAsync();
        return Results.Ok(new { success = true });
    }
    catch (Exception ex) { return Fail(ex); }
});

// 3) 非專案事項 — usp_UpsertExtraNote
app.MapPost("/api/extra-note", async (ExtraNoteReq req) =>
{
    if (RejectFutureWeek(req.Year, req.Week, "填寫") is { } futErr) return futErr;
    var docErr = ValidateDocUrl(req.DocUrl);
    if (docErr is not null) return docErr;
    try
    {
        using var conn = new SqlConnection(ConnStr());
        await conn.OpenAsync();
        using var cmd = new SqlCommand("dbo.usp_UpsertExtraNote", conn) { CommandType = CommandType.StoredProcedure };
        cmd.Parameters.AddWithValue("@UserName", req.UserName);
        cmd.Parameters.AddWithValue("@Year", req.Year);
        cmd.Parameters.AddWithValue("@Week", req.Week);
        cmd.Parameters.AddWithValue("@Note", (object?)req.Note ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@Actor", req.Actor);
        cmd.Parameters.AddWithValue("@ActorRole", (object?)req.ActorRole ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@ActorEmpId", (object?)req.ActorEmpId ?? DBNull.Value);
        // 空字串照樣送:SP 內 NULLIF 會轉成 NULL,使用者才能把已填的連結清空
        cmd.Parameters.AddWithValue("@DocUrl", (object?)req.DocUrl?.Trim() ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync();
        return Results.Ok(new { success = true });
    }
    catch (Exception ex) { return Fail(ex); }
});

// 3.1) 下週預計執行工作 — usp_UpsertWeeklyPlan
app.MapPost("/api/weekly-plan", async (WeeklyPlanReq req) =>
{
    if (RejectFutureWeek(req.Year, req.Week, "填寫") is { } futErr) return futErr;
    var docErr = ValidateDocUrl(req.DocUrl);
    if (docErr is not null) return docErr;
    try
    {
        using var conn = new SqlConnection(ConnStr());
        await conn.OpenAsync();
        using var cmd = new SqlCommand("dbo.usp_UpsertWeeklyPlan", conn) { CommandType = CommandType.StoredProcedure };
        cmd.Parameters.AddWithValue("@UserName", req.UserName);
        cmd.Parameters.AddWithValue("@Year", req.Year);
        cmd.Parameters.AddWithValue("@Week", req.Week);
        cmd.Parameters.AddWithValue("@Note", (object?)req.Note ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@Actor", req.Actor);
        cmd.Parameters.AddWithValue("@ActorRole", (object?)req.ActorRole ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@ActorEmpId", (object?)req.ActorEmpId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@DocUrl", (object?)req.DocUrl?.Trim() ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync();
        return Results.Ok(new { success = true });
    }
    catch (Exception ex) { return Fail(ex); }
});

// 3.1.5) 主管週報回覆 — usp_UpsertWeeklyComment(僅主管,SP 內檢查;空字串=清空回覆)
app.MapPost("/api/weekly-comment", async (WeeklyCommentReq req) =>
{
    if (RejectFutureWeek(req.Year, req.Week, "回覆") is { } futErr) return futErr;
    try
    {
        using var conn = new SqlConnection(ConnStr());
        await conn.OpenAsync();
        using var cmd = new SqlCommand("dbo.usp_UpsertWeeklyComment", conn) { CommandType = CommandType.StoredProcedure };
        cmd.Parameters.AddWithValue("@UserName", req.UserName);
        cmd.Parameters.AddWithValue("@Year", req.Year);
        cmd.Parameters.AddWithValue("@Week", req.Week);
        cmd.Parameters.AddWithValue("@Comment", (object?)req.Comment ?? "");
        cmd.Parameters.AddWithValue("@Actor", req.Actor);
        cmd.Parameters.AddWithValue("@ActorRole", (object?)req.ActorRole ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@ActorEmpId", (object?)req.ActorEmpId ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync();
        return Results.Ok(new { success = true });
    }
    catch (Exception ex) { return Fail(ex); }
});

// 3.2) 專案具體產出項目 — usp_UpdateProjectDeliverable(僅負責人或主管,SP 內檢查)
app.MapPost("/api/project/deliverable", async (DeliverableReq req) =>
{
    // ⚠ 與子區間端點同一個坑:SP 的權限判斷是 `@Actor <> @OwnerName`,Actor 為 NULL 時比對結果 UNKNOWN → IF 被跳過,
    //   資料先寫、AuditLog.ActorName NOT NULL 才炸(SP 無交易)→ 留下沒有稽核紀錄的產出項目。API 層先擋。
    if (BlankStr(req.Actor)) return Bad("缺少操作者。");
    try
    {
        using var conn = new SqlConnection(ConnStr());
        await conn.OpenAsync();
        using var cmd = new SqlCommand("dbo.usp_UpdateProjectDeliverable", conn) { CommandType = CommandType.StoredProcedure };
        cmd.Parameters.AddWithValue("@ProjectId", req.ProjectId);
        cmd.Parameters.AddWithValue("@Deliverable", (object?)req.Deliverable ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@MpSaving", (object?)req.MpSaving ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@Actor", req.Actor);
        cmd.Parameters.AddWithValue("@ActorRole", (object?)req.ActorRole ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@ActorEmpId", (object?)req.ActorEmpId ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync();
        return Results.Ok(new { success = true });
    }
    catch (Exception ex) { return Fail(ex); }
});

// 3.3) 主管標記重點關注 — usp_ToggleProjectStar(僅主管,SP 內檢查)
app.MapPost("/api/project/star", async (ProjectStarReq req) =>
{
    try
    {
        using var conn = new SqlConnection(ConnStr());
        await conn.OpenAsync();
        using var cmd = new SqlCommand("dbo.usp_ToggleProjectStar", conn) { CommandType = CommandType.StoredProcedure };
        cmd.Parameters.AddWithValue("@ProjectId", req.ProjectId);
        cmd.Parameters.AddWithValue("@Starred", req.Starred);
        cmd.Parameters.AddWithValue("@Actor", req.Actor);
        cmd.Parameters.AddWithValue("@ActorRole", (object?)req.ActorRole ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@ActorEmpId", (object?)req.ActorEmpId ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync();
        return Results.Ok(new { success = true });
    }
    catch (Exception ex) { return Fail(ex); }
});

// 3.4) 主管調整打卡分數 — usp_UpdateLogScore(僅主管,SP 內檢查;分數限 0.3/0.5/0.8/0.9/1)
app.MapPost("/api/weekly-log/score", async (ScoreReq req) =>
{
    if (BlankStr(req.TaskCode)) return Bad("缺少任務代碼。");
    if (req.Week < 1 || req.Week > MaxWeekNo) return Bad($"週次需介於 1–{MaxWeekNo}。");
    // 分數是固定的五個等第(0.3 再三交代 / 0.5 說一動做一動 / 0.8 完成老闆交代 / 0.9 超越老闆期許 / 1 主動承擔),
    // 不是自由數值——放行任意數字會讓「本週得分/滿分」的統計失去意義
    if (req.Score is not (0.3m or 0.5m or 0.8m or 0.9m or 1m))
        return Bad("分數僅接受 0.3／0.5／0.8／0.9／1。");
    if (RejectFutureWeek(req.Year, req.Week, "評分") is { } futErr) return futErr;
    try
    {
        using var conn = new SqlConnection(ConnStr());
        await conn.OpenAsync();
        if (req.SubId is not null && !SubCheckinOn())
            return Bad("「子區間打卡」功能目前未開啟。");
        using var cmd = new SqlCommand("dbo.usp_UpdateLogScore", conn) { CommandType = CommandType.StoredProcedure };
        cmd.Parameters.AddWithValue("@TaskCode", req.TaskCode);
        cmd.Parameters.AddWithValue("@Year", req.Year);
        cmd.Parameters.AddWithValue("@Week", req.Week);
        cmd.Parameters.AddWithValue("@Score", req.Score);
        cmd.Parameters.AddWithValue("@Actor", req.Actor);
        cmd.Parameters.AddWithValue("@ActorRole", (object?)req.ActorRole ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@ActorEmpId", (object?)req.ActorEmpId ?? DBNull.Value);
        if (req.SubId is int subId) cmd.Parameters.AddWithValue("@SubId", subId);   // 理由同 /api/weekly-log
        await cmd.ExecuteNonQueryAsync();
        return Results.Ok(new { success = true });
    }
    catch (Exception ex) { return Fail(ex); }
});

// 4) 主管修改任務排程 (名稱/起訖週) — usp_UpdateTaskSchedule
app.MapPost("/api/task-schedule", async (TaskScheduleReq req) =>
{
    if (BlankStr(req.TaskCode)) return Bad("缺少任務代碼。");
    if (BlankStr(req.Name)) return Bad("計畫名稱不可空白。");
    if (ValidateWeekRange(req.Start, req.End) is { } weekErr) return weekErr;
    try
    {
        using var conn = new SqlConnection(ConnStr());
        await conn.OpenAsync();
        using var cmd = new SqlCommand("dbo.usp_UpdateTaskSchedule", conn) { CommandType = CommandType.StoredProcedure };
        cmd.Parameters.AddWithValue("@TaskCode", req.TaskCode);
        cmd.Parameters.AddWithValue("@Name", req.Name);
        cmd.Parameters.AddWithValue("@Start", req.Start);
        cmd.Parameters.AddWithValue("@End", req.End);
        cmd.Parameters.AddWithValue("@Actor", req.Actor);
        cmd.Parameters.AddWithValue("@ActorRole", (object?)req.ActorRole ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@ActorEmpId", (object?)req.ActorEmpId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@NID", (object?)req.Nid ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync();
        return Results.Ok(new { success = true });
    }
    catch (Exception ex) { return Fail(ex); }
});

// 5) 主管新增專案 — usp_InsertProject
app.MapPost("/api/project", async (ProjectCreateReq req) =>
{
    if (BlankStr(req.Name)) return Bad("專案名稱不可空白。");
    if (BlankStr(req.Category)) return Bad("分類不可空白。");
    if (BlankStr(req.Owner)) return Bad("缺少負責人。");
    if (BlankStr(req.Type)) return Bad("缺少專案類型。");
    try
    {
        using var conn = new SqlConnection(ConnStr());
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
        cmd.Parameters.AddWithValue("@NID", (object?)req.Nid ?? DBNull.Value);
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
    if (BlankStr(req.Name)) return Bad("專案名稱不可空白。");
    if (BlankStr(req.Category)) return Bad("分類不可空白。");
    if (BlankStr(req.Owner)) return Bad("缺少負責人。");
    try
    {
        using var conn = new SqlConnection(ConnStr());
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
        cmd.Parameters.AddWithValue("@NID", (object?)req.Nid ?? DBNull.Value);
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
        using var conn = new SqlConnection(ConnStr());
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

// 7.1) 復原軟刪除的專案(刪除 toast 的「復原」按鈕) — usp_RestoreProject
app.MapPost("/api/project/restore", async (ProjectDeleteReq req) =>
{
    try
    {
        using var conn = new SqlConnection(ConnStr());
        await conn.OpenAsync();
        using var cmd = new SqlCommand("dbo.usp_RestoreProject", conn) { CommandType = CommandType.StoredProcedure };
        cmd.Parameters.AddWithValue("@ProjectId", req.ProjectId);
        cmd.Parameters.AddWithValue("@Actor", req.Actor);
        cmd.Parameters.AddWithValue("@ActorRole", (object?)req.ActorRole ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@ActorEmpId", (object?)req.ActorEmpId ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync();
        return Results.Ok(new { success = true });
    }
    catch (Exception ex) { return Fail(ex); }
});

// 7.2) 復原軟刪除的計畫區間 — usp_RestoreTask
app.MapPost("/api/task/restore", async (TaskDeleteReq req) =>
{
    try
    {
        using var conn = new SqlConnection(ConnStr());
        await conn.OpenAsync();
        using var cmd = new SqlCommand("dbo.usp_RestoreTask", conn) { CommandType = CommandType.StoredProcedure };
        cmd.Parameters.AddWithValue("@TaskCode", req.TaskCode);
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
        using var conn = new SqlConnection(ConnStr());
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
    if (BlankStr(req.TaskName)) return Bad("計畫名稱不可空白。");
    if (ValidateWeekRange(req.Start, req.End) is { } weekErr) return weekErr;
    try
    {
        using var conn = new SqlConnection(ConnStr());
        await conn.OpenAsync();
        using var cmd = new SqlCommand("dbo.usp_InsertTask", conn) { CommandType = CommandType.StoredProcedure };
        cmd.Parameters.AddWithValue("@ProjectId", req.ProjectId);
        cmd.Parameters.AddWithValue("@TaskName", req.TaskName);
        cmd.Parameters.AddWithValue("@Start", req.Start);
        cmd.Parameters.AddWithValue("@End", req.End);
        cmd.Parameters.AddWithValue("@Actor", req.Actor);
        cmd.Parameters.AddWithValue("@ActorRole", (object?)req.ActorRole ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@ActorEmpId", (object?)req.ActorEmpId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@NID", (object?)req.Nid ?? DBNull.Value);
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
        using var conn = new SqlConnection(ConnStr());
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

// 10.1) 新增／修改子區間 — usp_UpsertTaskSubInterval(遷移 18)
//       權限(主管或專案負責人)、「必須落在父區間內」、「每條最多 10 個」都在 SP 內檢查 → RAISERROR 照原文回 400。
app.MapPost("/api/task/sub", async (SubIntervalUpsertReq req) =>
{
    if (BlankStr(req.TaskCode)) return Bad("缺少任務代碼。");
    // ⚠ Actor 一定要在這裡擋:SP 的權限判斷是 `@Actor <> @OwnerName`,NULL 比對結果是 UNKNOWN → 整個 IF 被跳過;
    //   接著資料先寫入、AuditLog.ActorName NOT NULL 才炸(SP 沒交易)→ 留下一筆沒有稽核紀錄的子區間。
    if (BlankStr(req.Actor)) return Bad("缺少操作者。");
    if (BlankStr(req.Name)) return Bad("子區間名稱不可空白。");
    if (req.Name.Trim().Length > 200) return Bad("子區間名稱請勿超過 200 個字元。");
    if (ValidateWeekRange(req.Start, req.End) is { } weekErr) return weekErr;
    try
    {
        using var conn = new SqlConnection(ConnStr());
        await conn.OpenAsync();
        using var cmd = new SqlCommand("dbo.usp_UpsertTaskSubInterval", conn) { CommandType = CommandType.StoredProcedure };
        cmd.Parameters.AddWithValue("@SubId", (object?)req.SubId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@TaskCode", req.TaskCode);
        cmd.Parameters.AddWithValue("@Name", req.Name.Trim());
        cmd.Parameters.AddWithValue("@Start", req.Start);
        cmd.Parameters.AddWithValue("@End", req.End);
        cmd.Parameters.AddWithValue("@Actor", req.Actor);
        cmd.Parameters.AddWithValue("@ActorRole", (object?)req.ActorRole ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@ActorEmpId", (object?)req.ActorEmpId ?? DBNull.Value);
        var outId = new SqlParameter("@NewSubId", SqlDbType.Int) { Direction = ParameterDirection.Output };
        cmd.Parameters.Add(outId);
        await cmd.ExecuteNonQueryAsync();
        return Results.Ok(new { success = true, subId = outId.Value is int id ? id : (int?)null });
    }
    catch (Exception ex) { return Fail(ex); }
});

// 10.2) 刪除子區間(軟刪除) — usp_DeleteTaskSubInterval
app.MapPost("/api/task/sub/delete", async (SubIntervalDeleteReq req) =>
{
    if (BlankStr(req.Actor)) return Bad("缺少操作者。");   // 理由同上:NULL 會略過 SP 的權限檢查
    try
    {
        using var conn = new SqlConnection(ConnStr());
        await conn.OpenAsync();
        using var cmd = new SqlCommand("dbo.usp_DeleteTaskSubInterval", conn) { CommandType = CommandType.StoredProcedure };
        cmd.Parameters.AddWithValue("@SubId", req.SubId);
        cmd.Parameters.AddWithValue("@Actor", req.Actor);
        cmd.Parameters.AddWithValue("@ActorRole", (object?)req.ActorRole ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@ActorEmpId", (object?)req.ActorEmpId ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync();
        return Results.Ok(new { success = true });
    }
    catch (Exception ex) { return Fail(ex); }
});

// 10.3) 復原軟刪除的子區間(刪除 toast 的「↩ 復原」;遷移 20) — usp_RestoreTaskSubInterval
//       子區間自遷移 20 起有回報紀錄掛在底下,誤刪就不再是「重建即可」,故補上復原。
app.MapPost("/api/task/sub/restore", async (SubIntervalDeleteReq req) =>
{
    if (BlankStr(req.Actor)) return Bad("缺少操作者。");
    try
    {
        using var conn = new SqlConnection(ConnStr());
        await conn.OpenAsync();
        using var cmd = new SqlCommand("dbo.usp_RestoreTaskSubInterval", conn) { CommandType = CommandType.StoredProcedure };
        cmd.Parameters.AddWithValue("@SubId", req.SubId);
        cmd.Parameters.AddWithValue("@Actor", req.Actor);
        cmd.Parameters.AddWithValue("@ActorRole", (object?)req.ActorRole ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@ActorEmpId", (object?)req.ActorEmpId ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync();
        return Results.Ok(new { success = true });
    }
    catch (Exception ex) { return Fail(ex); }
});

// 11) 稽核紀錄查詢(主管「異動紀錄」面板) — 讀 AuditLog 最近 N 筆,
//     並於讀取時把技術代碼(如 t101-1@2026W9、軟刪除)翻譯成給高階主管看的白話摘要(summary)。
// 篩選條件皆為選填,未帶就不加限制(維持原本「最近 n 筆」的行為,舊呼叫端不受影響)。
// ⚠ 篩選一定要做在**伺服器端**:本端點只回最近 n 筆,若把日期/成員篩選放前端,
//    使用者查「上個月某人改了什麼」時,最近 300 筆可能全是本週的資料 → 篩出來永遠是空的。
// (參數名加 Filter 後綴避開下方讀取迴圈的同名區域變數;用 FromQuery 保住 ?action= / ?entityType= 的網址寫法)
app.MapGet("/api/audit-log", async (int? top, string? from, string? to, string? actor,
    [Microsoft.AspNetCore.Mvc.FromQuery(Name = "action")] string? actionFilter,
    [Microsoft.AspNetCore.Mvc.FromQuery(Name = "entityType")] string? entityTypeFilter) =>
{
    int n = Math.Clamp(top ?? 200, 1, 1000);
    try
    {
        using var conn = new SqlConnection(ConnStr());
        await conn.OpenAsync();

        // 名稱對照(含已刪除/已停用者,舊紀錄才翻得出名稱)
        var taskInfo = new Dictionary<string, (string Task, string Proj, string Owner)>();
        using (var cmd = new SqlCommand(@"
            SELECT t.TaskCode, t.TaskName, p.Name, u.UserName
            FROM dbo.Tasks t
            JOIN dbo.Projects p ON p.ProjectId = t.ProjectId
            JOIN dbo.Users u    ON u.UserId = p.OwnerUserId", conn))
        using (var r0 = await cmd.ExecuteReaderAsync())
            while (await r0.ReadAsync())
                taskInfo[r0.GetString(0)] = (r0.GetString(1), r0.GetString(2), r0.GetString(3));

        var projInfo = new Dictionary<string, (string Name, string Owner)>();
        using (var cmd = new SqlCommand(@"
            SELECT p.ProjectId, p.Name, u.UserName
            FROM dbo.Projects p
            JOIN dbo.Users u ON u.UserId = p.OwnerUserId", conn))
        using (var r0 = await cmd.ExecuteReaderAsync())
            while (await r0.ReadAsync())
                projInfo[r0.GetInt32(0).ToString()] = (r0.GetString(1), r0.GetString(2));

        // 子區間名稱對照(含已刪除;遷移 20 起打卡稽核的 EntityId 可能帶 #SubId)。表不存在(遠端未跑 18)就留空。
        var subInfo = new Dictionary<int, string>();
        using (var chk = new SqlCommand("SELECT OBJECT_ID('dbo.TaskSubIntervals','U')", conn))
        if (await chk.ExecuteScalarAsync() is not DBNull and not null)
        {
            using var cmd = new SqlCommand("SELECT SubId, Name FROM dbo.TaskSubIntervals", conn);
            using var r0 = await cmd.ExecuteReaderAsync();
            while (await r0.ReadAsync()) subInfo[r0.GetInt32(0)] = r0.GetString(1);
        }

        var statusLabel = new Dictionary<string, string>
        { ["executed"] = "有執行", ["monitor"] = "Monitor(例行監控)", ["not_executed"] = "未執行" };
        var typeLabel = new Dictionary<string, string>
        { ["a"] = "a·一級專案/KPI", ["b"] = "b·重大貢獻及亮點", ["c"] = "c·日常管理", ["d"] = "d·其他加分項", ["e"] = "e·主管交辦" };

        // 解析 "2026W9" → (2026, 9);解析 "name=xxx | W3-W7" → ("xxx","W3–W7")
        static (string Year, string Week) ParseYw(string yw)
        {
            var i = yw.IndexOf('W');
            return i > 0 ? (yw[..i], yw[(i + 1)..]) : (yw, "?");
        }
        static (string Name, string Range) ParseTaskSchedule(string v)
        {
            var s = v.StartsWith("name=") ? v[5..] : v;
            var i = s.LastIndexOf(" | W", StringComparison.Ordinal);
            return i > 0 ? (s[..i], s[(i + 4)..].Insert(0, "W")) : (s, "");
        }

        // 從 Detail 取出「新的文件連結」。兩種 Detail 格式共用同一個解析:
        //   打卡      = doc舊=… | doc新=… | note舊=… | note新=…（doc 之後還有 note，要切掉）
        //   非專案/下週預計 = doc舊=… | doc新=…（doc新 直接到結尾）
        // 遷移 16/17 之前的舊紀錄沒有 doc 段落 → 回空字串,不影響既有白話翻譯。
        static string ExtractNewDoc(string? detail)
        {
            var d = detail ?? "";
            var i = d.IndexOf("doc新=", StringComparison.Ordinal);
            if (i < 0) return "";
            var rest = d[(i + 5)..];
            var end = rest.IndexOf(" | note舊=", StringComparison.Ordinal);
            return (end >= 0 ? rest[..end] : rest).Trim();
        }

        string Summarize(string action, string entityType, string? entityId, string? oldV, string? newV, string? detail, string? fieldName = null)
        {
            try
            {
                switch (entityType)
                {
                    case "WeeklyLog":   // entityId = t101-1@2026W9 或 t101-1#5@2026W9(子區間打卡,遷移 20),NewValue = 狀態(CLOCKIN)或分數(SCORE)
                    {
                        var at = (entityId ?? "").Split('@');
                        var (y, w) = at.Length == 2 ? ParseYw(at[1]) : ("?", "?");
                        var unit = at.Length > 0 ? at[0] : "";
                        var hashAt = unit.IndexOf('#');
                        var code = hashAt > 0 ? unit[..hashAt] : unit;
                        var where = taskInfo.TryGetValue(code, out var ti) ? $"專案「{ti.Proj}」的任務「{ti.Task}」" : "任務";
                        if (hashAt > 0 && int.TryParse(unit[(hashAt + 1)..], out var subId))
                            where += subInfo.TryGetValue(subId, out var sn) ? $"的子區間「{sn}」" : "的子區間";
                        if (action == "SCORE")
                        {
                            var scoreName = new Dictionary<string, string>
                            { ["0.3"] = "再三交代", ["0.5"] = "說一動做一動", ["0.8"] = "完成老闆交代", ["0.9"] = "超越老闆期許", ["1.0"] = "主動承擔", ["1"] = "主動承擔" };
                            var nv = (newV ?? "").TrimEnd('0').TrimEnd('.');
                            var label = scoreName.GetValueOrDefault(newV ?? "", scoreName.GetValueOrDefault(nv, ""));
                            return $"評分 {where} {y} 年第 {w} 週回報：{oldV} 分 → {newV} 分{(label != "" ? $"（{label}）" : "")}";
                        }
                        var s = $"回報 {where} {y} 年第 {w} 週進度：{statusLabel.GetValueOrDefault(newV ?? "", newV ?? "")}";
                        // Detail 格式(遷移 16 起):doc舊=… | doc新=… | note舊=… | note新=…
                        //   遷移 16 之前只有 note 兩段,兩種格式都要能解析(歷史紀錄不會回頭改寫)。
                        // ⚠ note 一定放在最後、且用 LastIndexOf 取「到結尾」:工作說明本身可能含 | 或換行。
                        //   doc 段落因此**必須排在 note 之前**,否則會被當成工作說明的一部分。
                        var idx = (detail ?? "").LastIndexOf("note新=", StringComparison.Ordinal);
                        if (idx >= 0)
                        {
                            var note = detail![(idx + 6)..].Trim();
                            if (note != "") s += $"，工作說明：{note}";
                        }
                        var doc = ExtractNewDoc(detail);
                        if (doc != "") s += $"，文件連結：{doc}";
                        return s;
                    }
                    case "ExtraNote":     // entityId = 裕隆@2026W27,NewValue = 內容
                    case "WeeklyPlan":    // 同格式;內容為「下週預計執行工作」
                    case "WeeklyComment": // 同格式;內容為「主管週報回覆」
                    {
                        var at = (entityId ?? "").Split('@');
                        var (y, w) = at.Length == 2 ? ParseYw(at[1]) : ("?", "?");
                        var who = at.Length > 0 ? at[0] : "?";
                        if (entityType == "WeeklyComment")
                            return string.IsNullOrWhiteSpace(newV)
                                ? $"清除 {who} {y} 年第 {w} 週週報的主管回覆"
                                : $"主管回覆 {who} {y} 年第 {w} 週週報：{newV}";
                        var what = entityType == "WeeklyPlan" ? "下週預計執行工作" : "非專案事項";
                        var s = $"填寫 {who} {y} 年第 {w} 週的{what}";
                        if (!string.IsNullOrWhiteSpace(newV)) s += $"：{newV}";
                        // 遷移 17 起這兩類也有文件連結(放 Detail;OldValue/NewValue 維持只放內容,
                        // 既有「內容未變更」的比對邏輯不受影響)
                        var noteDoc = ExtractNewDoc(detail);
                        if (noteDoc != "") s += $"，文件連結：{noteDoc}";
                        return s;
                    }
                    case "Project":
                    {
                        if (action == "REORDER")
                        {
                            var ids = System.Text.Json.JsonSerializer.Deserialize<List<int>>(newV ?? "[]") ?? new();
                            var owner = ids.Count > 0 && projInfo.TryGetValue(ids[0].ToString(), out var pi0) ? pi0.Owner : null;
                            return owner is null ? $"調整專案顯示順序（共 {ids.Count} 項）"
                                                 : $"調整 {owner} 的專案顯示順序（共 {ids.Count} 項）";
                        }
                        if (action == "DELETE")
                            return projInfo.TryGetValue(entityId ?? "", out var pd)
                                ? $"刪除專案「{pd.Name}」（負責人：{pd.Owner}，含其所有計畫區間；資料保留，必要時可請系統管理者還原）"
                                : "刪除專案（含其所有計畫區間；資料保留，必要時可請系統管理者還原）";
                        if (action == "RESTORE")
                            return projInfo.TryGetValue(entityId ?? "", out var pr)
                                ? $"復原已刪除的專案「{pr.Name}」（負責人：{pr.Owner}，含其計畫區間）"
                                : "復原已刪除的專案（含其計畫區間）";
                        if (action == "UPDATE" && fieldName == "Deliverable")
                            return projInfo.TryGetValue(entityId ?? "", out var pv)
                                ? $"更新專案「{pv.Name}」的具體產出項目：{newV}"
                                : $"更新專案的具體產出項目：{newV}";
                        // INSERT / UPDATE:值格式 type|分類|負責人|名稱[|NID](NID 自遷移 15 起)
                        var np = (newV ?? "").Split('|');
                        if (action == "INSERT" && np.Length >= 4)
                            return $"新增專案「{np[3]}」（負責人:{np[2]}，分類:{np[1]}，類型:{typeLabel.GetValueOrDefault(np[0], np[0])}）";
                        if (action == "UPDATE" && np.Length >= 4)
                        {
                            var op = (oldV ?? "").Split('|');
                            var changes = new List<string>();
                            if (op.Length >= 4)
                            {
                                if (op[3] != np[3]) changes.Add($"名稱「{op[3]}」→「{np[3]}」");
                                if (op[1] != np[1]) changes.Add($"分類「{op[1]}」→「{np[1]}」");
                                if (op[0] != np[0]) changes.Add($"類型「{typeLabel.GetValueOrDefault(op[0], op[0])}」→「{typeLabel.GetValueOrDefault(np[0], np[0])}」");
                                if (op[2] != np[2]) changes.Add($"負責人「{op[2]}」→「{np[2]}」(專案移轉)");
                                // NID 僅在兩邊皆有第 5 欄(遷移 15 後的紀錄)時比較
                                if (op.Length >= 5 && np.Length >= 5 && op[4] != np[4])
                                    changes.Add($"NID「{(op[4] == "" ? "（未填）" : op[4])}」→「{(np[4] == "" ? "（未填）" : np[4])}」");
                            }
                            return changes.Count > 0
                                ? $"修改專案「{np[3]}」：{string.Join("、", changes)}"
                                : $"修改專案「{np[3]}」（內容未變更）";
                        }
                        break;
                    }
                    case "Task":
                    {
                        var projName = taskInfo.TryGetValue(entityId ?? "", out var t) ? t.Proj : null;
                        if (action == "INSERT")
                        {
                            // NewValue 格式:任務名 | W10-W20
                            var i = (newV ?? "").LastIndexOf(" | W", StringComparison.Ordinal);
                            var (nm, rg) = i > 0 ? (newV![..i], newV[(i + 3)..]) : (newV ?? "", "");
                            return projName is null
                                ? $"新增計畫區間「{nm}」（排程 {rg}）"
                                : $"在專案「{projName}」新增計畫區間「{nm}」（排程 {rg}）";
                        }
                        if (action == "UPDATE")
                        {
                            // 自遷移 15 起,值尾端以換行附加 NID=...;先分離後再解析排程
                            static (string Sched, string Nid) SplitNid(string v)
                            {
                                var k = v.IndexOf("\nNID=", StringComparison.Ordinal);
                                return k >= 0 ? (v[..k], v[(k + 5)..]) : (v, "");
                            }
                            var (oSched, oNid) = SplitNid(oldV ?? "");
                            var (nSched, nNid) = SplitNid(newV ?? "");
                            var (on, orr) = ParseTaskSchedule(oSched);
                            var (nn, nr) = ParseTaskSchedule(nSched);
                            var parts = new List<string>();
                            if (on != nn) parts.Add($"任務「{on}」更名為「{nn}」");
                            if (orr != nr) parts.Add($"排程 {orr} → {nr}");
                            if (oNid != nNid) parts.Add($"NID「{(oNid == "" ? "（未填）" : oNid)}」→「{(nNid == "" ? "（未填）" : nNid)}」");
                            var what = parts.Count > 0 ? string.Join("，", parts) : "內容未變更";
                            return projName is null ? $"調整計畫區間：{what}" : $"調整專案「{projName}」的計畫區間：{what}";
                        }
                        if (action == "DELETE")
                            return taskInfo.TryGetValue(entityId ?? "", out var td)
                                ? $"刪除專案「{td.Proj}」的計畫區間「{td.Task}」（資料保留，必要時可請系統管理者還原）"
                                : "刪除計畫區間（資料保留，必要時可請系統管理者還原）";
                        if (action == "RESTORE")
                            return taskInfo.TryGetValue(entityId ?? "", out var tr)
                                ? $"復原已刪除的計畫區間「{tr.Task}」（專案「{tr.Proj}」）"
                                : "復原已刪除的計畫區間";
                        break;
                    }
                    // 子區間(遷移 18):entityId = t101-1#5(父區間代碼 # 子區間 id)。
                    // 子區間本身不在 taskInfo 對照表裡,名稱一律從 Old/NewValue 解析(格式與 Task 相同:name=… | W..-W..)。
                    case "SubInterval":
                    {
                        var hash = (entityId ?? "").IndexOf('#');
                        var code = hash > 0 ? entityId![..hash] : (entityId ?? "");
                        var where = taskInfo.TryGetValue(code, out var ti) ? $"專案「{ti.Proj}」的計畫區間「{ti.Task}」" : "計畫區間";
                        var (nn, nr) = ParseTaskSchedule(newV ?? "");
                        var (on, orr) = ParseTaskSchedule(oldV ?? "");
                        if (action == "INSERT") return $"在{where}下新增子區間「{nn}」（排程 {nr}）";
                        if (action == "UPDATE")
                        {
                            var parts = new List<string>();
                            if (on != nn) parts.Add($"子區間「{on}」更名為「{nn}」");
                            if (orr != nr) parts.Add($"排程 {orr} → {nr}");
                            var what = parts.Count > 0 ? string.Join("，", parts) : $"子區間「{nn}」內容未變更";
                            return $"調整{where}的子區間：{what}";
                        }
                        if (action == "DELETE")
                            return $"刪除{where}的子區間「{on}」（{orr}）" +
                                   ((detail ?? "").Contains("筆回報") ? "，" + detail!.Replace("軟刪除（", "").TrimEnd('）') : "");
                        if (action == "RESTORE") return $"復原已刪除的子區間「{nn}」（{where}，{nr}）";
                        break;
                    }
                    case "User":
                        return action switch
                        {
                            "INSERT" => (detail ?? "").Contains("重新啟用")
                                        ? $"重新啟用成員「{entityId}」（還原其歷史專案與回報）"
                                        : $"新增成員「{entityId}」",
                            "UPDATE" => $"成員更名：「{oldV}」→「{newV}」（其專案與歷史回報自動跟隨）",
                            "DELETE" => $"移除成員「{entityId}」（其歷史回報保留）",
                            _ => ""
                        };
                    // 系統設定:原本沒有這個 case,summary 就掉到最後的 fallback = NewValue,
                    // 面板上只會顯示一個孤零零的「false」/「true」——同一份清單裡專案類都是完整句子,
                    // 唯獨影響全體權限的設定看不懂改了什麼。
                    case "AppSettings":
                    {
                        var on = (newV ?? "").Equals("true", StringComparison.OrdinalIgnoreCase);
                        return entityId switch
                        {
                            "AllowRetroCheckin" => on
                                ? "開啟歷史補登：成員可回報／修改非當週的進度"
                                : "關閉歷史補登：成員僅能回報當週進度",
                            "AccessControlEnabled" => on
                                ? "開啟頁面瀏覽權限卡控：僅符合允許規則的工號可瀏覽"
                                : "關閉頁面瀏覽權限卡控：所有人皆可瀏覽",
                            // 日後新增的設定至少講得出「哪個設定被改成什麼」,不會又掉回裸值
                            _ => $"變更系統設定「{entityId}」：{(on ? "開啟" : newV ?? "")}"
                        };
                    }
                }
            }
            catch { /* 解析失敗 → 走 fallback */ }
            return newV ?? detail ?? "";
        }

        // 供前端「成員」下拉使用:直接取自 AuditLog,才包含已移除/已改名的操作者(用 Users 名冊會漏掉)
        var actors = new List<string>();
        using (var cmd = new SqlCommand("SELECT DISTINCT ActorName FROM dbo.AuditLog ORDER BY ActorName", conn))
        using (var ra = await cmd.ExecuteReaderAsync())
            while (await ra.ReadAsync())
                if (!ra.IsDBNull(0)) actors.Add(ra.GetString(0));

        // 動態組 WHERE:一律走參數化,不做字串內插。
        // ⚠ 日期用「>= 起日 00:00」「< 迄日+1 天」的半開區間,不要寫 CONVERT(date, CreatedAt) BETWEEN ...:
        //    ①那會讓 CreatedAt 上的索引失效 ②迄日當天 00:00 之後的資料會整天被漏掉。
        var conds = new List<string>();
        var filters = new List<SqlParameter>();
        if (DateTime.TryParse(from, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var dFrom))
        { conds.Add("CreatedAt >= @from"); filters.Add(new SqlParameter("@from", dFrom.Date)); }
        if (DateTime.TryParse(to, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var dTo))
        { conds.Add("CreatedAt < @to"); filters.Add(new SqlParameter("@to", dTo.Date.AddDays(1))); }
        if (!string.IsNullOrWhiteSpace(actor))
        { conds.Add("ActorName = @actor"); filters.Add(new SqlParameter("@actor", actor)); }
        if (!string.IsNullOrWhiteSpace(actionFilter))
        { conds.Add("Action = @action"); filters.Add(new SqlParameter("@action", actionFilter)); }
        if (!string.IsNullOrWhiteSpace(entityTypeFilter))
        { conds.Add("EntityType = @etype"); filters.Add(new SqlParameter("@etype", entityTypeFilter)); }
        var whereSql = conds.Count > 0 ? " WHERE " + string.Join(" AND ", conds) : "";

        // 符合條件的總筆數(不受 TOP 限制):讓前端能提示「符合 N 筆，顯示最近 n 筆」,
        // 否則使用者不知道自己看到的是被截斷的結果。
        long matched;
        using (var cmd = new SqlCommand("SELECT COUNT_BIG(*) FROM dbo.AuditLog" + whereSql, conn))
        {
            foreach (var p in filters) cmd.Parameters.Add(new SqlParameter(p.ParameterName, p.Value));
            matched = Convert.ToInt64(await cmd.ExecuteScalarAsync());
        }

        var logs = new List<object>();
        using (var cmd = new SqlCommand(@"
            SELECT TOP (@n) AuditId, ActorName, ActorRole, ActorEmpId, Action, EntityType, EntityId, OldValue, NewValue, Detail, CreatedAt, FieldName
            FROM dbo.AuditLog" + whereSql + @"
            ORDER BY AuditId DESC", conn))
        {
            cmd.Parameters.AddWithValue("@n", n);
            foreach (var p in filters) cmd.Parameters.Add(new SqlParameter(p.ParameterName, p.Value));
            using var r = await cmd.ExecuteReaderAsync();
            while (await r.ReadAsync())
            {
                string action = r.GetString(4), entityType = r.GetString(5);
                string? entityId = r.IsDBNull(6) ? null : r.GetString(6);
                string? oldValue = r.IsDBNull(7) ? null : r.GetString(7);
                string? newValue = r.IsDBNull(8) ? null : r.GetString(8);
                string? detail = r.IsDBNull(9) ? null : r.GetString(9);
                string? fieldName = r.IsDBNull(11) ? null : r.GetString(11);
                logs.Add(new
                {
                    id = r.GetInt64(0),
                    actor = r.GetString(1),
                    role = r.IsDBNull(2) ? null : r.GetString(2),
                    empId = r.IsDBNull(3) ? null : r.GetString(3),
                    action,
                    entityType,
                    entityId,
                    newValue,
                    detail,
                    summary = Summarize(action, entityType, entityId, oldValue, newValue, detail, fieldName),
                    at = r.GetDateTime(10).ToString("yyyy-MM-dd HH:mm:ss")
                });
            }
        }
        return Results.Ok(new { logs, actors, matched, truncated = matched > logs.Count });
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
        // --- 撈本週排定任務(含未回報)、非專案事項、下週預計工作 ---
        // Sheet1 一列＝一個「回報單位」(遷移 20):該週有進行中的子區間 → 每個子區間一列(「本週階段」欄＝子區間名稱、
        // 狀態＝該子區間的回報);沒有 → 計畫區間一列。父層那週已有紀錄(切子區間前回報過的舊週)→ 仍以父層一列呈現,
        // 階段欄併列名稱。與前端 weekUnits() 同一套規則。
        var rows = new List<(string Owner, string Category, string Type, string Project, string Task, int Start, int End, string? Status, string? Note, string? DocUrl, string TaskCode, string Phase)>();
        var userOrder = new List<string>();
        var extraD = new Dictionary<string, string>();
        var planD = new Dictionary<string, string>();
        var extraDocD = new Dictionary<string, string>();   // 非專案事項的文件連結(選填)
        var planDocD = new Dictionary<string, string>();    // 下週預計的文件連結(選填)
        using (var conn = new SqlConnection(ConnStr()))
        {
            await conn.OpenAsync();
            bool hasSubTable, hasSubLogCol;
            using (var chk = new SqlCommand("SELECT OBJECT_ID('dbo.TaskSubIntervals','U')", conn))
                hasSubTable = await chk.ExecuteScalarAsync() is not DBNull and not null;
            using (var chk = new SqlCommand("SELECT COL_LENGTH('dbo.WeeklyLogs','SubId')", conn))
                hasSubLogCol = await chk.ExecuteScalarAsync() is not DBNull and not null;
            // 子區間打卡總開關關著時,不逐子區間展開(與前端 weekUnits 同一條規則);子區間的回報也不查。
            // ⚠ 父層查詢的 `AND w.SubId IS NULL` 仍看 hasSubLogCol(欄位存不存在),否則關掉開關後既有的子區間回報會讓父層 JOIN 出多列。
            bool subCheckin = hasSubLogCol && SubCheckinOn();

            // 子區間(遷移 18):taskCode → 本週落在範圍內的子區間 (SubId, Name, 該子區間本週回報)。表不存在(遠端未跑 18)就留空。
            var phaseD = new Dictionary<string, List<(int SubId, string Name, string? Status, string? Note, string? DocUrl)>>();
            if (hasSubTable)
            {
                using var cmd = new SqlCommand(@"
                    SELECT t.TaskCode, s.SubId, s.Name" + (subCheckin ? ", w.Status, w.Note, w.DocUrl" : ", NULL, NULL, NULL") + @"
                    FROM dbo.TaskSubIntervals s
                    JOIN dbo.Tasks t ON t.TaskId = s.TaskId AND t.IsDeleted = 0" +
                    (subCheckin ? " LEFT JOIN dbo.WeeklyLogs w ON w.SubId = s.SubId AND w.ScheduleYear = @y AND w.WeekNo = @w" : "") + @"
                    WHERE s.IsDeleted = 0 AND s.StartWeek <= @w AND s.EndWeek >= @w
                    ORDER BY s.StartWeek, s.EndWeek, s.SubId", conn);
                cmd.Parameters.AddWithValue("@y", y);
                cmd.Parameters.AddWithValue("@w", w);
                using var r = await cmd.ExecuteReaderAsync();
                while (await r.ReadAsync())
                {
                    if (!phaseD.TryGetValue(r.GetString(0), out var list)) { list = new(); phaseD[r.GetString(0)] = list; }
                    list.Add((r.GetInt32(1), r.GetString(2),
                              r.IsDBNull(3) ? null : r.GetString(3),
                              r.IsDBNull(4) ? null : r.GetString(4),
                              r.IsDBNull(5) ? null : r.GetString(5)));
                }
            }
            using (var cmd = new SqlCommand(@"
                SELECT u.UserName, p.Category, p.TypeCode, p.Name, t.TaskName, t.StartWeek, t.EndWeek, w.Status, w.Note, w.DocUrl, t.TaskCode
                FROM dbo.Tasks t
                JOIN dbo.Projects p ON p.ProjectId = t.ProjectId AND p.IsDeleted = 0 AND p.ScheduleYear = @y
                JOIN dbo.Users u    ON u.UserId = p.OwnerUserId
                LEFT JOIN dbo.WeeklyLogs w ON w.TaskId = t.TaskId AND w.ScheduleYear = @y AND w.WeekNo = @w" +
                (hasSubLogCol ? " AND w.SubId IS NULL" : "") + @"
                WHERE t.IsDeleted = 0 AND t.StartWeek <= @w AND t.EndWeek >= @w
                ORDER BY u.SortOrder, p.SortOrder, p.ProjectId, t.SortOrder", conn))
            {
                cmd.Parameters.AddWithValue("@y", y);
                cmd.Parameters.AddWithValue("@w", w);
                using var r = await cmd.ExecuteReaderAsync();
                while (await r.ReadAsync())
                {
                    var code = r.GetString(10);
                    var parentStatus = r.IsDBNull(7) ? null : r.GetString(7);
                    var phases = phaseD.GetValueOrDefault(code);
                    if (subCheckin && parentStatus is null && phases is { Count: > 0 })
                    {
                        // 回報單位＝子區間:一個子區間一列
                        foreach (var ph in phases)
                            rows.Add((r.GetString(0), r.GetString(1), r.GetString(2), r.GetString(3), r.GetString(4),
                                      r.GetInt32(5), r.GetInt32(6), ph.Status, ph.Note, ph.DocUrl, code, ph.Name));
                    }
                    else
                        rows.Add((r.GetString(0), r.GetString(1), r.GetString(2), r.GetString(3), r.GetString(4),
                                  r.GetInt32(5), r.GetInt32(6), parentStatus,
                                  r.IsDBNull(8) ? null : r.GetString(8),
                                  r.IsDBNull(9) ? null : r.GetString(9),
                                  code, phases is null ? "" : string.Join("、", phases.Select(p => p.Name))));
                }
            }
            using (var cmd = new SqlCommand(
                "SELECT UserName FROM dbo.Users WHERE IsActive = 1 AND Role = 'member' ORDER BY SortOrder", conn))
            using (var r = await cmd.ExecuteReaderAsync())
                while (await r.ReadAsync()) userOrder.Add(r.GetString(0));
            using (var cmd = new SqlCommand(@"
                SELECT u.UserName, e.Note, e.DocUrl
                FROM dbo.ExtraNotes e
                JOIN dbo.Users u ON u.UserId = e.UserId
                WHERE e.ScheduleYear = @y AND e.WeekNo = @w", conn))
            {
                cmd.Parameters.AddWithValue("@y", y);
                cmd.Parameters.AddWithValue("@w", w);
                using var r = await cmd.ExecuteReaderAsync();
                while (await r.ReadAsync())
                {
                    extraD[r.GetString(0)] = r.IsDBNull(1) ? "" : r.GetString(1);
                    if (!r.IsDBNull(2)) extraDocD[r.GetString(0)] = r.GetString(2);
                }
            }
            using (var cmd = new SqlCommand(@"
                SELECT u.UserName, wp.Note, wp.DocUrl
                FROM dbo.WeeklyPlans wp
                JOIN dbo.Users u ON u.UserId = wp.UserId
                WHERE wp.ScheduleYear = @y AND wp.WeekNo = @w", conn))
            {
                cmd.Parameters.AddWithValue("@y", y);
                cmd.Parameters.AddWithValue("@w", w);
                using var r = await cmd.ExecuteReaderAsync();
                while (await r.ReadAsync())
                {
                    planD[r.GetString(0)] = r.IsDBNull(1) ? "" : r.GetString(1);
                    if (!r.IsDBNull(2)) planDocD[r.GetString(0)] = r.GetString(2);
                }
            }
        }

        var statusLabel = new Dictionary<string, string>
        { ["executed"] = "有執行", ["monitor"] = "Monitor", ["not_executed"] = "未執行" };

        using var wb = new ClosedXML.Excel.XLWorkbook();

        // --- Sheet 1:專案執行 ---
        var ws = wb.Worksheets.Add($"W{w:00} 專案執行");
        // 「本週階段」= 計畫區間底下、本週落在範圍內的子區間(遷移 18);沒切子區間的列留空
        string[] headers = { "成員", "分類", "類型", "專案名稱", "計畫任務", "排程", "本週階段", "本週狀態", "工作說明", "文件連結" };
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
            ws.Cell(row, 7).Value = t.Phase;
            ws.Cell(row, 8).Value = t.Status is null ? "未回報" : (statusLabel.GetValueOrDefault(t.Status, t.Status));
            ws.Cell(row, 9).Value = t.Note ?? "";
            // 文件連結:Excel 對 UNC 路徑(\\server\share\…)的超連結是可以直接開的——
            // 瀏覽器則要靠網域政策放行(見前端 DocLink 的說明),所以匯出檔在內網常是最穩的開啟路徑。
            PutLink(ws, row, 10, t.DocUrl);
            var st = ws.Cell(row, 8).Style;
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
        ws.Column(4).Width = 45; ws.Column(5).Width = 30; ws.Column(7).Width = 24; ws.Column(9).Width = 50; ws.Column(10).Width = 40;
        ws.Columns(1, 3).AdjustToContents(); ws.Column(6).AdjustToContents(); ws.Column(8).AdjustToContents();
        ws.Column(9).Style.Alignment.WrapText = true;

        // --- Sheet 2:非專案事項 + 下週預計工作 ---
        var ws2 = wb.Worksheets.Add($"W{w:00} 非專案事項");
        ws2.Cell(1, 1).Value = "成員"; ws2.Cell(1, 2).Value = "非專案工作內容"; ws2.Cell(1, 3).Value = "非專案文件連結";
        ws2.Cell(1, 4).Value = "下週預計執行工作"; ws2.Cell(1, 5).Value = "下週預計文件連結";
        var head2 = ws2.Range(1, 1, 1, 5);
        head2.Style.Font.Bold = true;
        head2.Style.Font.FontColor = ClosedXML.Excel.XLColor.White;
        head2.Style.Fill.BackgroundColor = ClosedXML.Excel.XLColor.FromArgb(0xEA, 0x58, 0x0C);
        int row2 = 2;
        // 連結欄與 Sheet1 一樣做成真正可點的超連結(Excel 對 UNC 沒有瀏覽器那層限制);
        // 個別格式無法建立超連結時只留純文字,不要讓整份匯出失敗
        void PutLink(ClosedXML.Excel.IXLWorksheet sheet, int r, int c, string? url)
        {
            if (string.IsNullOrWhiteSpace(url)) return;
            var cell = sheet.Cell(r, c);
            cell.Value = url;
            try { cell.SetHyperlink(new ClosedXML.Excel.XLHyperlink(url)); } catch { }
        }
        foreach (var u in userOrder)
        {
            var extra = extraD.GetValueOrDefault(u, "");
            var plan = planD.GetValueOrDefault(u, "");
            var extraDoc = extraDocD.GetValueOrDefault(u, "");
            var planDoc = planDocD.GetValueOrDefault(u, "");
            // 只有連結沒有內容也要出現(內容可清空、連結留著),否則那一列會整個消失
            if (extra == "" && plan == "" && extraDoc == "" && planDoc == "") continue;
            ws2.Cell(row2, 1).Value = u;
            ws2.Cell(row2, 2).Value = extra;
            PutLink(ws2, row2, 3, extraDoc);
            ws2.Cell(row2, 4).Value = plan;
            PutLink(ws2, row2, 5, planDoc);
            row2++;
        }
        var used2 = ws2.Range(1, 1, Math.Max(row2 - 1, 1), 5);
        used2.Style.Border.InsideBorder = ClosedXML.Excel.XLBorderStyleValues.Thin;
        used2.Style.Border.OutsideBorder = ClosedXML.Excel.XLBorderStyleValues.Thin;
        ws2.Column(1).AdjustToContents();
        ws2.Column(2).Width = 55;
        ws2.Column(2).Style.Alignment.WrapText = true;
        ws2.Column(3).Width = 40;
        ws2.Column(4).Width = 45;
        ws2.Column(4).Style.Alignment.WrapText = true;
        ws2.Column(5).Width = 40;
        ws2.SheetView.FreezeRows(1);

        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return Results.File(ms.ToArray(),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            $"WeeklyReport_{y}_W{w:00}.xlsx");
    }
    catch (Exception ex) { return Fail(ex); }
});

// 12b) 成果清單匯出 Excel — 專案項目/具體產出/MP Saving(高階主管離線瀏覽用);
//      body 帶 projectIds(前端目前顯示的篩選+排序結果)則依序匯出,不帶或空陣列=全部(預設順序)
app.MapPost("/api/results-excel", async (ResultsExcelReq req) =>
{
    int y = req.Year;
    try
    {
        var all = new List<(int Id, string Owner, string Category, string Type, string Name, bool Starred, string? Deliverable, string? MpSaving, string? Nid)>();
        using (var conn = new SqlConnection(ConnStr()))
        {
            await conn.OpenAsync();
            using var cmd = new SqlCommand(@"
                SELECT p.ProjectId, u.UserName, p.Category, p.TypeCode, p.Name, p.IsStarred, p.Deliverable, p.MpSaving, p.NID
                FROM dbo.Projects p
                JOIN dbo.Users u ON u.UserId = p.OwnerUserId
                WHERE p.IsDeleted = 0 AND p.ScheduleYear = @y
                ORDER BY u.SortOrder, p.SortOrder, p.ProjectId", conn);
            cmd.Parameters.AddWithValue("@y", y);
            using var r = await cmd.ExecuteReaderAsync();
            while (await r.ReadAsync())
                all.Add((r.GetInt32(0), r.GetString(1), r.GetString(2), r.GetString(3), r.GetString(4),
                         r.GetBoolean(5),
                         r.IsDBNull(6) ? null : r.GetString(6),
                         r.IsDBNull(7) ? null : r.GetString(7),
                         r.IsDBNull(8) ? null : r.GetString(8)));
        }

        // 依前端傳入的顯示順序輸出(套用畫面上的篩選與排序)。
        // ⚠ 只有「**沒傳** ProjectIds(null)」才等於全部;**傳了空陣列 = 畫面上一案都沒有**,要輸出空表。
        //   原本寫 `is { Count: > 0 }`,空陣列會落到下面的「全部」→ 使用者在成果清單篩到 0 筆時,
        //   按下寫著「匯出 Excel(0 案)」的按鈕會拿到**全部 69 案**的檔案,而他以為那是自己篩出來的結果。
        //   (前端已同步把 0 案時的匯出鈕 disabled,這裡是第二道防線。)
        var rows = all;
        if (req.ProjectIds is not null)
        {
            var byId = all.ToDictionary(p => p.Id);
            rows = req.ProjectIds.Where(byId.ContainsKey).Select(id => byId[id]).ToList();
        }

        using var wb = new ClosedXML.Excel.XLWorkbook();
        var ws = wb.Worksheets.Add($"{y} 成果清單");
        string[] headers = { "No", "分類", "類型", "專案名稱", "負責人", "重點關注", "預計交付具體產出成果", "MP Saving", "NID" };
        for (int i = 0; i < headers.Length; i++) ws.Cell(1, i + 1).Value = headers[i];
        var head = ws.Range(1, 1, 1, headers.Length);
        head.Style.Font.Bold = true;
        head.Style.Font.FontColor = ClosedXML.Excel.XLColor.White;
        head.Style.Fill.BackgroundColor = ClosedXML.Excel.XLColor.FromArgb(0x00, 0x1F, 0x5B);
        head.Style.Alignment.Horizontal = ClosedXML.Excel.XLAlignmentHorizontalValues.Center;

        int row = 2;
        foreach (var p in rows)
        {
            ws.Cell(row, 1).Value = row - 1;
            ws.Cell(row, 2).Value = p.Category;
            ws.Cell(row, 3).Value = p.Type.ToUpperInvariant();
            ws.Cell(row, 4).Value = p.Name;
            ws.Cell(row, 5).Value = p.Owner;
            ws.Cell(row, 6).Value = p.Starred ? "★" : "";
            ws.Cell(row, 7).Value = p.Deliverable ?? "";
            ws.Cell(row, 8).Value = p.MpSaving ?? "";
            ws.Cell(row, 9).Value = p.Nid ?? "";
            if (p.Starred)
            {
                var st = ws.Cell(row, 6).Style;
                st.Font.Bold = true;
                st.Font.FontColor = ClosedXML.Excel.XLColor.FromArgb(0xB4, 0x53, 0x09);
                st.Fill.BackgroundColor = ClosedXML.Excel.XLColor.FromArgb(0xFE, 0xF3, 0xC7);
            }
            row++;
        }
        var used = ws.Range(1, 1, Math.Max(row - 1, 1), headers.Length);
        used.Style.Border.InsideBorder = ClosedXML.Excel.XLBorderStyleValues.Thin;
        used.Style.Border.OutsideBorder = ClosedXML.Excel.XLBorderStyleValues.Thin;
        ws.SheetView.FreezeRows(1);
        ws.Column(1).Width = 5;
        ws.Columns(2, 3).AdjustToContents();
        ws.Column(4).Width = 48;
        ws.Column(5).AdjustToContents();
        ws.Column(6).AdjustToContents();
        ws.Column(6).Style.Alignment.Horizontal = ClosedXML.Excel.XLAlignmentHorizontalValues.Center;
        ws.Column(7).Width = 60;
        ws.Column(7).Style.Alignment.WrapText = true;
        ws.Column(8).Width = 20;
        ws.Column(8).Style.Alignment.WrapText = true;
        ws.Column(9).Width = 22;
        ws.Column(9).Style.Alignment.WrapText = true;

        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return Results.File(ms.ToArray(),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            $"Results_{y}.xlsx");
    }
    catch (Exception ex) { return Fail(ex); }
});

// 13) 主管新增成員 — usp_InsertUser(同名成員曾被移除則重新啟用)
app.MapPost("/api/user", async (UserCreateReq req) =>
{
    if (BlankStr(req.UserName)) return Bad("成員名稱不可空白。");
    try
    {
        using var conn = new SqlConnection(ConnStr());
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
    if (BlankStr(req.UserName) || BlankStr(req.NewName)) return Bad("成員名稱不可空白。");
    try
    {
        using var conn = new SqlConnection(ConnStr());
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
        using var conn = new SqlConnection(ConnStr());
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

// 16) 主管開關全年度歷史進度補登授權 — usp_SetAppSetting
// ─── 頁面瀏覽權限卡控(遷移 11) ───────────────────────────────────────
// 登入者工號 → 比對 AccessRules(EMPNO 白名單 / 部門規則) + [WEB].[dbo].[notes_person](部門名冊);
// 任一規則符合即放行。開關 AppSettings.AccessControlEnabled 預設 false(不卡控,避免部署當下鎖死)。

// 名冊 View 名稱可由 appsettings 的 Access:PersonView 覆寫(即時讀取);僅允許 [字元/底線/點/中括號] 防注入
string PersonView()
{
    var v = app.Configuration["Access:PersonView"] ?? "[WEB].[dbo].[notes_person]";
    return System.Text.RegularExpressions.Regex.IsMatch(v, @"^[\w\[\]\.]+$") ? v : "[WEB].[dbo].[notes_person]";
}

// 檢查工號是否可瀏覽。preview=true 供主管面板測試規則(略過總開關判斷)。
app.MapGet("/api/access-check", async (string? empId, bool? preview) =>
{
    try
    {
        using var conn = new SqlConnection(ConnStr());
        await conn.OpenAsync();
        bool enabled;
        using (var cmd = new SqlCommand("SELECT Value FROM dbo.AppSettings WHERE KeyName = 'AccessControlEnabled'", conn))
            enabled = ((await cmd.ExecuteScalarAsync()) as string)?.Equals("true", StringComparison.OrdinalIgnoreCase) == true;

        if (!enabled && preview != true)
            return Results.Ok(new { enabled, allowed = true, reason = (string?)null, person = (object?)null });

        var id = (empId ?? "").Trim();
        if (id == "")
            return Results.Ok(new { enabled, allowed = false, reason = "無法取得您的 Windows 登入工號（非網域環境），無法驗證瀏覽權限", person = (object?)null });

        // 讀取規則(遷移 12:多欄位組合;同一條規則內有填的欄位全部符合=通過(AND),規則之間任一符合即放行(OR))
        var rules = new List<(string? Empno, string? DeptName, string? D1, string? D2, string? D3)>();
        using (var cmd = new SqlCommand("SELECT Empno, DeptName, Dept1, Dept2, Dept3 FROM dbo.AccessRules", conn))
        using (var r = await cmd.ExecuteReaderAsync())
            while (await r.ReadAsync())
                rules.Add((r.IsDBNull(0) ? null : r.GetString(0).Trim(),
                           r.IsDBNull(1) ? null : r.GetString(1).Trim(),
                           r.IsDBNull(2) ? null : r.GetString(2).Trim(),
                           r.IsDBNull(3) ? null : r.GetString(3).Trim(),
                           r.IsDBNull(4) ? null : r.GetString(4).Trim()));

        // 查人員名冊(遠端為跨 server VIEW,可能查詢失敗 → 卡控中一律擋下,但「僅工號」規則不受影響)
        bool personFound = false;
        string? name = null, ename = null, dn = null, d1 = null, d2 = null, d3 = null, lookupError = null;
        try
        {
            using var cmd = new SqlCommand($"SELECT TOP 1 NAME, ENAME, DEPTNAME, DEPT_1, DEPT_2, DEPT_3 FROM {PersonView()} WHERE LTRIM(RTRIM(EMPNO)) = @id", conn);
            cmd.Parameters.AddWithValue("@id", id);
            using var r = await cmd.ExecuteReaderAsync();
            if (await r.ReadAsync())
            {
                personFound = true;
                name  = r.IsDBNull(0) ? null : r.GetString(0);
                ename = r.IsDBNull(1) ? null : r.GetString(1);
                dn = r.IsDBNull(2) ? null : r.GetString(2)?.Trim();
                d1 = r.IsDBNull(3) ? null : r.GetString(3)?.Trim();
                d2 = r.IsDBNull(4) ? null : r.GetString(4)?.Trim();
                d3 = r.IsDBNull(5) ? null : r.GetString(5)?.Trim();
            }
        }
        catch (Exception ex)
        {
            lookupError = "人員名冊(notes_person)查詢失敗";
            app.Logger.LogError(ex, "notes_person 查詢失敗");
        }
        object? person = personFound ? new { empno = id, name, ename, deptname = dn, dept1 = d1, dept2 = d2, dept3 = d3 } : null;

        var cmp = StringComparer.OrdinalIgnoreCase;
        bool RuleMatches((string? Empno, string? DeptName, string? D1, string? D2, string? D3) rule, bool useRoster)
        {
            bool hasDeptCond = rule.DeptName != null || rule.D1 != null || rule.D2 != null || rule.D3 != null;
            if (hasDeptCond && !useRoster) return false;   // 名冊查不到/查詢失敗時,含部門條件的規則不成立
            if (rule.Empno != null && !cmp.Equals(rule.Empno, id)) return false;
            if (rule.DeptName != null && !(dn != null && cmp.Equals(rule.DeptName, dn))) return false;
            if (rule.D1 != null && !(d1 != null && cmp.Equals(rule.D1, d1))) return false;
            if (rule.D2 != null && !(d2 != null && cmp.Equals(rule.D2, d2))) return false;
            if (rule.D3 != null && !(d3 != null && cmp.Equals(rule.D3, d3))) return false;
            return true;
        }
        bool ok = rules.Any(rule => RuleMatches(rule, personFound));
        if (ok)
            return Results.Ok(new { enabled, allowed = true, reason = "符合允許瀏覽的條件", person });
        if (lookupError != null)
            return Results.Ok(new { enabled, allowed = false, reason = lookupError + "，請聯絡管理員", person });
        if (!personFound)
            return Results.Ok(new { enabled, allowed = false, reason = $"工號 {id} 不在人員名冊(notes_person)中，且不在工號白名單", person });
        return Results.Ok(new
        {
            enabled,
            allowed = false,
            reason = $"您的部門（{dn ?? "-"}；{d1 ?? "-"} / {d2 ?? "-"} / {d3 ?? "-"}）與工號皆不符合允許瀏覽的條件",
            person
        });
    }
    catch (Exception ex) { return Fail(ex); }
});

// 規則清單(主管面板)
app.MapGet("/api/access-rules", async () =>
{
    try
    {
        using var conn = new SqlConnection(ConnStr());
        await conn.OpenAsync();
        bool enabled;
        using (var cmd = new SqlCommand("SELECT Value FROM dbo.AppSettings WHERE KeyName = 'AccessControlEnabled'", conn))
            enabled = ((await cmd.ExecuteScalarAsync()) as string)?.Equals("true", StringComparison.OrdinalIgnoreCase) == true;
        var rules = new List<object>();
        using (var cmd = new SqlCommand("SELECT RuleId, Empno, DeptName, Dept1, Dept2, Dept3, Note, CreatedBy, CreatedAt FROM dbo.AccessRules ORDER BY RuleId", conn))
        using (var r = await cmd.ExecuteReaderAsync())
            while (await r.ReadAsync())
                rules.Add(new
                {
                    id = r.GetInt32(0),
                    empno    = r.IsDBNull(1) ? null : r.GetString(1),
                    deptName = r.IsDBNull(2) ? null : r.GetString(2),
                    dept1    = r.IsDBNull(3) ? null : r.GetString(3),
                    dept2    = r.IsDBNull(4) ? null : r.GetString(4),
                    dept3    = r.IsDBNull(5) ? null : r.GetString(5),
                    note = r.IsDBNull(6) ? null : r.GetString(6),
                    createdBy = r.IsDBNull(7) ? null : r.GetString(7),
                    createdAt = r.GetDateTime(8).ToString("yyyy-MM-dd HH:mm")
                });
        return Results.Ok(new { enabled, rules });
    }
    catch (Exception ex) { return Fail(ex); }
});

// 新增規則 — usp_AddAccessRule(SP 內檢查主管權限,稽核 ACCESSRULE)
app.MapPost("/api/access-rule", async (AccessRuleAddReq req) =>
{
    try
    {
        using var conn = new SqlConnection(ConnStr());
        await conn.OpenAsync();
        using var cmd = new SqlCommand("dbo.usp_AddAccessRule", conn) { CommandType = CommandType.StoredProcedure };
        cmd.Parameters.AddWithValue("@Empno", (object?)req.Empno ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@DeptName", (object?)req.DeptName ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@Dept1", (object?)req.Dept1 ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@Dept2", (object?)req.Dept2 ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@Dept3", (object?)req.Dept3 ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@Note", (object?)req.Note ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@Actor", req.Actor);
        cmd.Parameters.AddWithValue("@ActorRole", (object?)req.ActorRole ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@ActorEmpId", (object?)req.ActorEmpId ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync();
        return Results.Ok(new { success = true });
    }
    catch (Exception ex) { return Fail(ex); }
});

// 刪除規則 — usp_DeleteAccessRule
app.MapPost("/api/access-rule/delete", async (AccessRuleDelReq req) =>
{
    try
    {
        using var conn = new SqlConnection(ConnStr());
        await conn.OpenAsync();
        using var cmd = new SqlCommand("dbo.usp_DeleteAccessRule", conn) { CommandType = CommandType.StoredProcedure };
        cmd.Parameters.AddWithValue("@RuleId", req.RuleId);
        cmd.Parameters.AddWithValue("@Actor", req.Actor);
        cmd.Parameters.AddWithValue("@ActorRole", (object?)req.ActorRole ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@ActorEmpId", (object?)req.ActorEmpId ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync();
        return Results.Ok(new { success = true });
    }
    catch (Exception ex) { return Fail(ex); }
});

// 卡控總開關 — 沿用 usp_SetAppSetting(SP 內檢查主管權限,稽核 SETTING)
app.MapPost("/api/settings/access-control", async (AccessControlReq req) =>
{
    try
    {
        using var conn = new SqlConnection(ConnStr());
        await conn.OpenAsync();
        using var cmd = new SqlCommand("dbo.usp_SetAppSetting", conn) { CommandType = CommandType.StoredProcedure };
        cmd.Parameters.AddWithValue("@KeyName", "AccessControlEnabled");
        cmd.Parameters.AddWithValue("@Value", req.Enabled ? "true" : "false");
        cmd.Parameters.AddWithValue("@Actor", req.Actor);
        cmd.Parameters.AddWithValue("@ActorRole", (object?)req.ActorRole ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync();
        return Results.Ok(new { success = true });
    }
    catch (Exception ex) { return Fail(ex); }
});

// ─── 使用率統計(遷移 13) ─────────────────────────────────────────────
// 每次登入(含重新整理自動還原)寫一筆 LoginLogs;統計面板供主管評估網頁使用率

app.MapPost("/api/login-log", async (LoginLogReq req) =>
{
    try
    {
        using var conn = new SqlConnection(ConnStr());
        await conn.OpenAsync();
        using var cmd = new SqlCommand("dbo.usp_LogLogin", conn) { CommandType = CommandType.StoredProcedure };
        cmd.Parameters.AddWithValue("@UserName", req.UserName);
        cmd.Parameters.AddWithValue("@Role", (object?)req.Role ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@EmpId", (object?)req.ActorEmpId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@Source", (object?)req.Source ?? "manual");
        await cmd.ExecuteNonQueryAsync();
        return Results.Ok(new { success = true });
    }
    catch (Exception ex) { return Fail(ex); }
});

// 統計:整體/今日/近7天/近days天登入次數、不重複使用者、各使用者次數、每日趨勢
app.MapGet("/api/login-stats", async (int? days) =>
{
    int d = Math.Clamp(days ?? 30, 7, 365);
    try
    {
        using var conn = new SqlConnection(ConnStr());
        await conn.OpenAsync();

        long total = 0, today = 0, last7 = 0, lastN = 0, uniqueUsers = 0, manualN = 0;
        using (var cmd = new SqlCommand(@"
            SELECT COUNT_BIG(*),
                   SUM(CASE WHEN LoginAt >= CAST(GETDATE() AS date) THEN 1 ELSE 0 END),
                   SUM(CASE WHEN LoginAt >= DATEADD(day, -7, GETDATE()) THEN 1 ELSE 0 END),
                   SUM(CASE WHEN LoginAt >= DATEADD(day, -@d, GETDATE()) THEN 1 ELSE 0 END),
                   COUNT(DISTINCT CASE WHEN LoginAt >= DATEADD(day, -@d, GETDATE()) THEN UserName END),
                   SUM(CASE WHEN LoginAt >= DATEADD(day, -@d, GETDATE()) AND Source = N'manual' THEN 1 ELSE 0 END)
            FROM dbo.LoginLogs", conn))
        {
            cmd.Parameters.AddWithValue("@d", d);
            using var r = await cmd.ExecuteReaderAsync();
            if (await r.ReadAsync() && !r.IsDBNull(0))
            {
                // SUM(CASE...)=int、COUNT_BIG=bigint,統一用 Convert.ToInt64 讀取避免型別轉換例外
                total = Convert.ToInt64(r.GetValue(0));
                today = r.IsDBNull(1) ? 0 : Convert.ToInt64(r.GetValue(1));
                last7 = r.IsDBNull(2) ? 0 : Convert.ToInt64(r.GetValue(2));
                lastN = r.IsDBNull(3) ? 0 : Convert.ToInt64(r.GetValue(3));
                uniqueUsers = r.IsDBNull(4) ? 0 : Convert.ToInt64(r.GetValue(4));
                manualN = r.IsDBNull(5) ? 0 : Convert.ToInt64(r.GetValue(5));
            }
        }

        // 各使用者(近 d 天):次數/最後登入
        var byUser = new List<object>();
        using (var cmd = new SqlCommand(@"
            SELECT UserName, MAX(ISNULL(Role, N'')), COUNT_BIG(*), MAX(LoginAt)
            FROM dbo.LoginLogs
            WHERE LoginAt >= DATEADD(day, -@d, GETDATE())
            GROUP BY UserName
            ORDER BY COUNT_BIG(*) DESC, MAX(LoginAt) DESC", conn))
        {
            cmd.Parameters.AddWithValue("@d", d);
            using var r = await cmd.ExecuteReaderAsync();
            while (await r.ReadAsync())
                byUser.Add(new
                {
                    user = r.GetString(0),
                    role = r.GetString(1),
                    count = r.GetInt64(2),
                    lastAt = r.GetDateTime(3).ToString("yyyy-MM-dd HH:mm")
                });
        }

        // 每日趨勢(近 d 天;無登入的日期由前端補 0)
        var byDay = new List<object>();
        using (var cmd = new SqlCommand(@"
            SELECT CAST(LoginAt AS date), COUNT_BIG(*)
            FROM dbo.LoginLogs
            WHERE LoginAt >= DATEADD(day, -@d, GETDATE())
            GROUP BY CAST(LoginAt AS date)
            ORDER BY CAST(LoginAt AS date)", conn))
        {
            cmd.Parameters.AddWithValue("@d", d);
            using var r = await cmd.ExecuteReaderAsync();
            while (await r.ReadAsync())
                byDay.Add(new { date = r.GetDateTime(0).ToString("yyyy-MM-dd"), count = r.GetInt64(1) });
        }

        return Results.Ok(new { days = d, total, today, last7, lastN, uniqueUsers, manualN, autoN = lastN - manualN, byUser, byDay });
    }
    catch (Exception ex) { return Fail(ex); }
});

app.MapPost("/api/settings/retro-checkin", async (RetroCheckinReq req) =>
{
    try
    {
        using var conn = new SqlConnection(ConnStr());
        await conn.OpenAsync();
        using var cmd = new SqlCommand("dbo.usp_SetAppSetting", conn) { CommandType = CommandType.StoredProcedure };
        cmd.Parameters.AddWithValue("@KeyName", "AllowRetroCheckin");
        cmd.Parameters.AddWithValue("@Value", req.Enabled ? "true" : "false");
        cmd.Parameters.AddWithValue("@Actor", req.Actor);
        cmd.Parameters.AddWithValue("@ActorRole", (object?)req.ActorRole ?? DBNull.Value);
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
    public string? Deliverable { get; set; }   // 具體產出項目(負責人與主管可編輯)
    public string? MpSaving { get; set; }      // MP 人力節省(同上,與產出項目同視窗編輯)
    public bool IsStarred { get; set; }        // 主管標記重點關注(存於 DB，全員同步可見)
    public string? Nid { get; set; }           // 專案流水編號(選填;一專案可含多組 NID)
    public List<TaskItemDto> Tasks { get; set; } = new();
}

class TaskItemDto
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public int Start { get; set; }
    public int End { get; set; }
    public string? Nid { get; set; }           // 該進度區間對應哪組 NID(選填)
    public List<SubIntervalDto> Subs { get; set; } = new();   // 子區間(遷移 18):只排程不打卡,可重疊
}

class SubIntervalDto
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public int Start { get; set; }
    public int End { get; set; }
}

// ActorEmpId = 前端 /api/whoami 偵測到的 Windows 工號(如 00058897);非網域環境為 null,由 apiPost 自動附帶
// SubId(遷移 20):對子區間打卡時帶子區間 id;對計畫區間打卡為 null
record WeeklyLogReq(string TaskCode, int Year, int Week, string Status, string? Note, string Actor, string? ActorRole, string? ActorEmpId, string? DocUrl = null, int? SubId = null);
record ExtraNoteReq(string UserName, int Year, int Week, string Note, string Actor, string? ActorRole, string? ActorEmpId, string? DocUrl = null);
record TaskScheduleReq(string TaskCode, string Name, int Start, int End, string Actor, string? ActorRole, string? ActorEmpId, string? Nid);
record ProjectCreateReq(string Type, string Category, string Owner, string Name, int Year, string Actor, string? ActorRole, string? ActorEmpId, string? Nid);
record ProjectUpdateReq(int ProjectId, string Type, string Category, string Owner, string Name, string Actor, string? ActorRole, string? ActorEmpId, string? Nid);
record ProjectDeleteReq(int ProjectId, string Actor, string? ActorRole, string? ActorEmpId);
record ProjectReorderReq(List<int>? OrderedIds, string Actor, string? ActorRole, string? ActorEmpId);
record TaskCreateReq(int ProjectId, string TaskName, int Start, int End, string Actor, string? ActorRole, string? ActorEmpId, string? Nid);
record TaskDeleteReq(string TaskCode, string Actor, string? ActorRole, string? ActorEmpId);
record SubIntervalUpsertReq(int? SubId, string TaskCode, string Name, int Start, int End, string Actor, string? ActorRole, string? ActorEmpId);
record SubIntervalDeleteReq(int SubId, string Actor, string? ActorRole, string? ActorEmpId);
record UserCreateReq(string UserName, string Actor, string? ActorRole, string? ActorEmpId);
record UserUpdateReq(string UserName, string NewName, string Actor, string? ActorRole, string? ActorEmpId);
record UserDeleteReq(string UserName, string Actor, string? ActorRole, string? ActorEmpId);
record WeeklyPlanReq(string UserName, int Year, int Week, string Note, string Actor, string? ActorRole, string? ActorEmpId, string? DocUrl = null);
record WeeklyCommentReq(string UserName, int Year, int Week, string? Comment, string Actor, string? ActorRole, string? ActorEmpId);
record DeliverableReq(int ProjectId, string? Deliverable, string? MpSaving, string Actor, string? ActorRole, string? ActorEmpId);
record ScoreReq(string TaskCode, int Year, int Week, decimal Score, string Actor, string? ActorRole, string? ActorEmpId, int? SubId = null);
record RetroCheckinReq(bool Enabled, string Actor, string? ActorRole);
record ResultsExcelReq(int Year, List<int>? ProjectIds);
record AccessRuleAddReq(string? Empno, string? DeptName, string? Dept1, string? Dept2, string? Dept3, string? Note, string Actor, string? ActorRole, string? ActorEmpId);
record AccessRuleDelReq(int RuleId, string Actor, string? ActorRole, string? ActorEmpId);
record AccessControlReq(bool Enabled, string Actor, string? ActorRole);
record LoginLogReq(string UserName, string? Role, string? Source, string? ActorEmpId);
record ProjectStarReq(int ProjectId, bool Starred, string Actor, string? ActorRole, string? ActorEmpId);
