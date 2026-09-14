# DB_table.md — 資料庫結構與變更歷史（append-only）

> **本檔規則（最重要）**：資料庫變更紀錄**只能往下新增、不可刪減或改寫既有段落**。
> 遠端正式 DB 已有線上資料，**嚴禁刪庫／刪表重建**；所有變更以冪等增量遷移檔配合本檔歷史對照執行。

## 環境與基準

| 環境 | 說明 | 已執行 |
|------|------|--------|
| 遠端正式主機 | 線上正式資料，只能跑增量遷移 | `old.sql` → `new.sql`（=01~09 基準）；**10~18 需依編號順序執行（若尚未）** |
| 本機開發 `Sariel\Gantt` | 開發／驗證用 | 全部（old+new+10~18） |
| 本機測試 `Sariel\Gantt2` | 切換連線字串測試用 | old+new+10（2026-07-16 補跑）；11~18 未套用 |

- **`old.sql`＋`new.sql` 不可修改**：兩檔＝遠端已執行完畢的架構基準（2026-07-12 以臨時 DB 逐項指紋驗證與正式架構一致）。
- `backup_sql/` 內 01~09 逐檔僅供參考，勿執行勿修改。
- 新遷移檔一律 `10_xxx.sql`、`11_xxx.sql`… 往下遞增、冪等設計；全新環境＝`CREATE DATABASE` → `old.sql` → `new.sql` → 10 以後依序。
- `sim_create_WEB_notes_person.sql`＝**僅開發機用**（模擬遠端跨 server VIEW `[WEB].[dbo].[notes_person]` 名冊，34 筆測試資料），**遠端勿執行**。
- sqlcmd 執行必帶旗標：`-I`（QUOTED_IDENTIFIER ON，filtered index 必要）、`-f 65001`（UTF-8 中文）、`-b`（遇錯停止）。
- 開新年度只需 `EXEC dbo.usp_EnsureScheduleYear <年度>;`。

## 目前資料表清單（14 張）

| 資料表 | 用途 | 關鍵欄位 |
|--------|------|----------|
| Users | 成員＋主管 | UserName(UNIQUE)、Role(manager/member)、IsActive(軟刪)、SortOrder |
| ProjectTypes | 類型 a~e | TypeCode、Label、SortOrder |
| ScheduleWeeks | 年度週→月對照 | (ScheduleYear,WeekNo) PK、MonthName、MonthLabel；CHECK 週 1..53 |
| Projects | 專案主檔 | TypeCode、Category、OwnerUserId、Name、ScheduleYear、SortOrder、IsDeleted、Deliverable、MpSaving、IsStarred、NID |
| Tasks | 計畫區間 | TaskCode(`t{ProjectId}-{seq}`)、StartWeek/EndWeek(CHECK 1..53)、SortOrder、IsDeleted、NID |
| TaskSubIntervals | 計畫區間的子區間（只排程不打卡，可重疊） | SubId、TaskId(FK)、Name、StartWeek/EndWeek(CHECK 1..53；SP 另限制在父區間內)、SortOrder、IsDeleted |
| WeeklyLogs | 每週打卡 | TaskId×Year×Week 唯一、Status、Note、**DocUrl**(文件連結,選填)、Score DECIMAL(2,1) DEFAULT 1、ReportedByUserId、UpdatedAt |
| ExtraNotes | 非專案事項 | UserId×Year×Week 唯一、Note、**DocUrl**(文件連結,選填)、UpdatedByUserId、UpdatedAt |
| WeeklyPlans | 下週預計工作 | 同 ExtraNotes 結構（含 DocUrl） |
| WeeklyComments | 主管週報回覆 | UserId×Year×Week 唯一、Comment(空字串=已清空)、UpdatedByUserId、UpdatedAt |
| AuditLog | 操作稽核 | ActorName、ActorRole、**ActorEmpId**(Windows 工號)、Action、EntityType、EntityId、Old/NewValue、Detail、CreatedAt |
| AppSettings | 系統設定 KV | KeyName PK、Value；現有鍵：AllowRetroCheckin、AccessControlEnabled |
| AccessRules | 瀏覽權限規則 | Empno/DeptName/Dept1/Dept2/Dept3（任填≥1，同規則 AND、規則間 OR）、Note、CreatedBy/At |
| LoginLogs | 登入統計 | UserName、Role、EmpId、Source(manual/auto)、LoginAt |

**View**：`vw_ProjectTasks`、`vw_WeeklyReport`。
**外部相依**：`[WEB].[dbo].[notes_person]` 名冊（遠端跨 server VIEW；本機以 sim 腳本模擬）。

## 目前預存程序清單（26 個，全部寫 AuditLog）

usp_UpsertWeeklyLog（打卡）、usp_UpsertExtraNote、usp_UpsertWeeklyPlan、usp_UpsertWeeklyComment（SP 內檢查主管）、
usp_UpdateTaskSchedule（含子區間範圍檢查）、usp_UpsertTaskSubInterval／usp_DeleteTaskSubInterval（SP 內檢查主管或負責人）、usp_InsertProject、usp_UpdateProject（可改負責人）、usp_DeleteProject（軟刪）、
usp_ReorderProjects（OPENJSON 保序）、usp_InsertTask、usp_DeleteTask（軟刪）、usp_RestoreProject、usp_RestoreTask、
usp_InsertUser（同名停用者重新啟用）、usp_UpdateUser、usp_DeleteUser（名下有專案 RAISERROR）、
usp_UpdateProjectDeliverable（含 @MpSaving；SP 內檢查負責人/主管）、usp_UpdateLogScore（SP 內檢查主管；0.3/0.5/0.8/0.9/1）、
usp_ToggleProjectStar、usp_EnsureScheduleYear、usp_SetAppSetting、usp_AddAccessRule／usp_DeleteAccessRule（SP 內檢查主管）、usp_LogLogin。

---

# 變更歷史（只能往下新增）

## 2026-07-02 — Projects.SortOrder＋拖曳排序（原 03_add_project_sortorder.sql）
- `Projects` 加 `SortOrder INT NOT NULL DEFAULT(0)`，依 OwnerUserId 分組以 ProjectId 回填 1..N。
- 新 SP `usp_ReorderProjects @OrderedIdsJson,@Actor,@ActorRole`：以 `OPENJSON` 的 `[key]` 保留陣列順序
  （SQL 2019 `STRING_SPLIT` 不保序故不採用）；AuditLog Action='REORDER'。

## 2026-07-05 — usp_EnsureScheduleYear（原 04_add_ensure_schedule_year.sql）
- 新 SP `usp_EnsureScheduleYear @Year`：依 ISO 8601 產生該年度 ScheduleWeeks（52/53 週；每週所屬月份取該週週四的月份）。
- 已產生 2027 年度（52 週）。

## 2026-07-06 — 成員管理 SP（原 05_add_user_management.sql）
- `usp_InsertUser`（同名曾停用則重新啟用、歷史資料恢復可見）、`usp_DeleteUser`（IsActive=0 軟刪；名下有未刪專案 RAISERROR）、
  `usp_UpdateUser`（重名 RAISERROR；專案/回報以 UserId 關聯自動跟隨）。Users 表結構不變。

## 2026-07-06 — AuditLog.ActorEmpId（原 06_add_actor_empid.sql）
- `AuditLog` 加 `ActorEmpId NVARCHAR(20) NULL`（Windows 工號稽核）。
- 當時全部 12 個寫入 SP 加 `@ActorEmpId NVARCHAR(20)=NULL` 並寫入 AuditLog。

## 2026-07-06 — 遷移合併：03/04/05/06 → 03_upgrade_to_current.sql
- 合併時行為修正：SortOrder 回填**僅在全部為 0 時執行**（重跑不洗掉主管自訂排序；原 03 為無條件回填）。
- 驗證：正式 DB 重跑 checksum 一致；臨時 DB（舊版 01/02→合併版 03）與正式 DB 欄位 diff=0、13 個 SP 雜湊 diff=0。

## 2026-07-07 — 專案類型 e（原 04_add_type_e_supervisor.sql）
- `ProjectTypes` INSERT `'e' 主管交辦`（冪等）。遷移規則自此改為：01~03 為基準不回改，新變動 04、05…往下。

## 2026-07-08 — 下週預計／具體產出／打卡計分（原 05_add_plan_deliverable_score.sql）
- 新表 `WeeklyPlans`（每人每年每週一筆，結構同 ExtraNotes）＋ `usp_UpsertWeeklyPlan`（稽核 WEEKPLAN）。
- `Projects.Deliverable NVARCHAR(1000)` ＋ `usp_UpdateProjectDeliverable`（SP 內檢查負責人本人或主管）。
- `WeeklyLogs.Score DECIMAL(2,1) NOT NULL DEFAULT(1)`（既有列補 1）＋ `usp_UpdateLogScore`
  （SP 內檢查主管；限 0.3/0.5/0.8/0.9/1；成員重新回報不洗掉評分——MERGE UPDATE 不動 Score）。

## 2026-07-10 — 2026 年度改 53 週（使用者直改 01/02，已知例外）
- `ScheduleWeeks`/`Tasks` CHECK 由 1..52 改 **1..53**；02 種子補 2026 W53（202612）。
- 註：公司線上 DB 另把部分專案 EndWeek 52→53（各環境資料調整，非全面套用；當時 Sariel 留有 18 筆 EndWeek=52）。

## 2026-07-10 — Projects.MpSaving（原 06_add_mp_saving.sql）
- `Projects.MpSaving NVARCHAR(100) NULL`（MP 人力節省，自由文字）。
- `usp_UpdateProjectDeliverable` 加 `@MpSaving`；稽核 Old/NewValue 改「產出｜MP:xx」合併格式。

## 2026-07-11 — AppSettings 系統設定表（原 07_add_app_settings.sql）
- 新表 `AppSettings`（KeyName PK、Value）＋ `usp_SetAppSetting`；種子 `AllowRetroCheckin='false'`（主管歷史補登總開關）。

## 2026-07-11 — 公司環境增量規範（old_sql/06_upgrade_to_current.sql）
- 公司內部以 old_sql 目錄 01~05 為正式基準不可改；之後補齊變更集中維護於 `old_sql\06_upgrade_to_current.sql`（等冪）。

## 2026-07-11 — usp_UpdateProjectDeliverable QUOTED_IDENTIFIER 修復（error 1934）
- 該 SP 建立時 `uses_quoted_identifier=0` 導致 UPDATE 遭擋（1934）。以 `SET QUOTED_IDENTIFIER ON` + `CREATE OR ALTER` 重建；
  升級腳本同步加入 SET 前置。**教訓：所有 SP 部署前必須確保 QUOTED_IDENTIFIER ON（sqlcmd 帶 -I）**。

## 2026-07-11 — 刪除復原 SP（原 08_add_restore_procs.sql）
- `usp_RestoreProject`（IsDeleted=0 連同其 Tasks）、`usp_RestoreTask`；稽核 Action='RESTORE'。

## 2026-07-12 — 重點關注星號（原 09_add_starred_projects.sql）
- `Projects.IsStarred` ＋ `usp_ToggleProjectStar`（主管標記、全員共享；取代原 localStorage 版）。

## 2026-07-12 — old.sql／new.sql 基準定案（三段驗證）
- 驗證①：01→05 逐檔 ≡ `old.sql`（結構 144 項＋種子 0 差異）。②：06→09 ≡ `new.sql`（161 項＋資料 0 差異）。
  ③：old+new ≡ 正式 Gantt 架構（28 項表面差異皆為欄位順序/CRLF 雜湊差，無實質影響）。
- 補週基準：發現 02 種子漏 2026 W53、缺 2027 → 「補 2026 W53＋EXEC usp_EnsureScheduleYear 2027」段
  **併入 old.sql 尾端**（遠端已於 01~05 後執行過，屬既有基準）；原獨立 10 號檔刪除、編號釋出。
- **檔案結構定案**：backup_sql/=01~09 存檔；old.sql+new.sql=遠端已執行基準（不可改）；新遷移從 10 起。

## 2026-07-13 — 遷移 10：主管週報回覆（10_add_manager_weekly_comment.sql）
- 新表 `WeeklyComments`（UserId×Year×Week 唯一；Comment 空字串=已清空保留稽核脈絡；UpdatedByUserId/At）。
- 新 SP `usp_UpsertWeeklyComment`：SP 內檢查僅主管（RAISERROR）；MERGE upsert；稽核 Action='COMMENT'。
- 已套用：本機 Gantt（07-13）、Gantt2（07-16 補跑）。**遠端需執行**。

## 2026-07-16 — 連線字串即時讀取（無 DB 架構變更，行為相關）
- `Program.cs` 改 `ConnStr()` 每次向 Configuration 讀取（reloadOnChange）→ 部署後直接改 appsettings.json 的
  `Initial Catalog`（如 Gantt→Gantt2）數秒生效，免重新發佈／回收集區。

## 2026-07-17 — 遷移 11：瀏覽權限卡控（11_add_access_control.sql）
- 新表 `AccessRules`（當時：RuleType(DEPT_1/2/3/EMPNO)×Value 唯一）＋ SP `usp_AddAccessRule`/`usp_DeleteAccessRule`
  （SP 內檢查主管；稽核 Action='ACCESSRULE'）。
- AppSettings 種子 `AccessControlEnabled='false'`（預設不卡控，避免部署即鎖死）。
- 名冊 `[WEB].[dbo].[notes_person]` 為遠端既有跨 server VIEW，不在遷移範圍；本機以 `sim_create_WEB_notes_person.sql` 模擬（34 筆）。
- 已套用本機 Gantt。**遠端需執行（順序 11）**。

## 2026-07-17 — 遷移 12：權限規則改多欄位組合（12_access_rules_multi_field.sql）
- `AccessRules` 改為 Empno/DeptName/Dept1/Dept2/Dept3 五欄（任填≥1、CHECK 至少一欄非空）；
  既有單欄位規則自動搬移後移除舊欄位；語意＝**同規則內有填欄位全部符合（AND）、多條規則任一符合（OR）**；
  只填工號＝白名單直接放行（不查名冊）；名冊查無/失敗 fail-closed。
- `usp_AddAccessRule` 改五欄位＋重複組合檢查；`usp_DeleteAccessRule` 重建；稽核描述自動組白話（「DEPT_2=ESI 且 DEPT_3=IMD」）。
- 已套用本機 Gantt。**遠端需執行（順序 11→12）**。

## 2026-07-18 — 遷移 13：登入統計（13_add_login_stats.sql）
- 新表 `LoginLogs`（UserName/Role/EmpId/Source(manual=登入畫面點選、auto=重整自動還原)/LoginAt；索引 LoginAt）。
- 新 SP `usp_LogLogin`（無權限限制；空名靜默略過）。
- 讀取端注意：`SUM(CASE)`=int 與 `COUNT_BIG`=bigint 混用，C# 一律 `Convert.ToInt64(GetValue)`。
- 已套用本機 Gantt。**遠端需執行（順序 11→12→13）**。

## 2026-07-21 — 遷移 14：專案／區間 NID（14_add_nid.sql）
- `Projects.NID NVARCHAR(200) NULL`（專案流水編號，選填；一專案可含多組 NID）。
- `Tasks.NID NVARCHAR(200) NULL`（該進度區間對應哪組 NID，選填）。
- `CREATE OR ALTER` 四個 SP，各加**選填**參數 `@NID NVARCHAR(200)=NULL` 並寫入對應欄位
  （`NULLIF(LTRIM(RTRIM(@NID)),N'')` 空白存 NULL）：`usp_InsertProject`、`usp_UpdateProject`、
  `usp_InsertTask`、`usp_UpdateTaskSchedule`。OUTPUT 參數維持最後、稽核字串格式**不變**（不影響白話翻譯）。
- 冪等（COL_LENGTH 檢查欄位、CREATE OR ALTER）；SP 以 `QUOTED_IDENTIFIER ON` 建立。
- 已套用本機 Gantt（驗證：新增/更新專案 NID `N001,N002`→`N003`、區間 NID `N001`→`N002` 皆正確；results-excel 含 NID 欄）。
  **遠端需執行（順序 …→13→14）**；Gantt2 未套用。

## 2026-07-22 — 遷移 15：NID 納入稽核新舊值（15_audit_nid_changes.sql）
- 問題：遷移 14 未把 NID 放進 AuditLog 的 Old/NewValue，只改 NID 時白話翻譯顯示「內容未變更」。
- `CREATE OR ALTER usp_UpdateProject`：稽核值格式 `type|分類|負責人|名稱` → **`type|分類|負責人|名稱|NID`**。
- `CREATE OR ALTER usp_UpdateTaskSchedule`：稽核值尾端以換行附加 **`\nNID=<nid>`**（`name=… | W..-W..\nNID=…`）。
- 其餘行為與遷移 14 相同；後端 `/api/audit-log` 白話翻譯同步解析（Project 比較第 5 欄、Task 以 `\nNID=` 分離），
  向下相容 14 之前的短格式歷史列。
- 已套用本機 Gantt（驗證：只改 NID 的專案／區間、以及名稱+排程+NID 同改，皆正確顯示「NID『舊』→『新』」）。
  **遠端需執行（順序 …→14→15）**；Gantt2 未套用。

## 2026-08-25 — 遷移 16：打卡回報加「文件連結」（16_add_weeklylog_docurl.sql）
- 需求：主管讀週報時最常做的下一個動作就是「把那份文件打開」，原本得自己去信件／檔案總管翻。
  回報時順手貼上連結，看板與打卡彈窗就能直接點開。
- `WeeklyLogs.DocUrl NVARCHAR(500) NULL`（選填）。長度取 500：SharePoint／Teams 網址常帶一長串查詢字串，
  200 會被截斷；UNC 路徑（`\\server\share\…`）也可能很長。
- `CREATE OR ALTER usp_UpsertWeeklyLog`：加**選填** `@DocUrl NVARCHAR(500)=NULL`（放參數清單最後，
  舊呼叫端未傳時行為完全不變），`NULLIF(LTRIM(RTRIM(@DocUrl)),N'')` 空白存 NULL；MERGE 的 UPDATE/INSERT 都寫入。
  ⚠ `usp_UpdateLogScore` 只動 Score，不會洗掉 DocUrl（沿用既有行為，無需修改）。
- 稽核 Detail 格式：`note舊=… | note新=…` → **`doc舊=… | doc新=… | note舊=… | note新=…`**。
  ⚠ **doc 段落必須排在 note 之前**：後端 `Summarize()` 是用 `LastIndexOf('note新=')` 之後「整段到結尾」
  當工作說明（因為說明本身可能含 `|` 或換行），doc 放後面會被一起吃進工作說明裡。
  後端解析對**遷移 16 前的舊格式**（只有 note 兩段）相容，歷史紀錄不需回頭改寫。
- `CREATE OR ALTER vw_WeeklyReport` 補 `DocUrl` 欄（其餘定義與 `old.sql` 完全相同；此 View 應用程式未使用，
  僅供人工／報表查詢）。
- 冪等（`COL_LENGTH` 檢查欄位、`CREATE OR ALTER`）；SP／View 以 `QUOTED_IDENTIFIER ON` 建立。
- 已套用本機 Gantt（驗證：https 網址與 UNC 路徑存取皆正確、清空欄位存回 NULL、
  稽核白話顯示「…，文件連結：…」、週報 Excel 多一欄「文件連結」且 UNC 產生真正可點的外部超連結）。
  **遠端需執行（順序 …→15→16）**；Gantt2 未套用。

## 2026-08-26 — 遷移 17：非專案事項／下週預計 也加「文件連結」（17_add_note_docurl.sql）
- 需求：遷移 16 只有打卡有文件連結，另外兩個回報項目沒有，同一份週報裡三個欄位兩種能力，使用者要求一致。
- `ExtraNotes.DocUrl NVARCHAR(500) NULL`、`WeeklyPlans.DocUrl NVARCHAR(500) NULL`
  （型別與 `WeeklyLogs.DocUrl` 完全一致——三處是同一種東西，不要各用各的長度）。
- `CREATE OR ALTER usp_UpsertExtraNote`／`usp_UpsertWeeklyPlan`：加**選填** `@DocUrl NVARCHAR(500)=NULL`
  （放參數清單最後，舊呼叫端未傳時行為完全不變），`NULLIF(LTRIM(RTRIM(@DocUrl)),N'')` 空白存 NULL。
- ⚠ **稽核寫法與遷移 16 的打卡刻意不同**：這兩支 SP 的 OldValue/NewValue 本來就是「內容全文」、
  且 Detail 欄一直沒用到，所以文件連結放 **Detail**＝`doc舊=… | doc新=…`，OldValue/NewValue 維持只放內容
  → 既有「比對新舊值判斷內容未變更」的白話翻譯完全不受影響。
  打卡那支則是 Detail 已被 note 佔用，才需要「doc 排在 note 之前」那條規則。
  後端 `ExtractNewDoc()` 一個函式同時解析兩種格式（`doc新=` 之後，遇到 ` | note舊=` 就切掉）。
- 兩者皆為 NULL 時 Detail 寫 NULL，不留 `doc舊= | doc新=` 這種空殼字串（既有紀錄的樣子不變）。
- 冪等（`COL_LENGTH` 檢查欄位、`CREATE OR ALTER`）；SP 以 `QUOTED_IDENTIFIER ON` 建立。
- 已套用本機 Gantt（驗證：https 與 UNC 皆正確存取、清空存回 NULL、稽核白話顯示「…，文件連結：…」、
  週報 Excel 的 Sheet2 多「非專案文件連結」「下週預計文件連結」兩欄且產生真正可點的外部超連結）。
  **遠端需執行（順序 …→16→17）**；Gantt2 未套用。

## 2026-09-11 — 遷移 18：計畫區間的「子區間」（18_add_task_subintervals.sql）
- 需求：一條計畫區間（如「測試 W10–W27」）底下實際上還會再切成幾個**可重疊**的階段
  （準備資料 W10–W15、跟 IT 溝通 W12–W19、驗證 W14–W27），主管希望在甘特圖上直接看到。
- 新表 **`dbo.TaskSubIntervals`**：`SubId` IDENTITY PK、`TaskId` FK→Tasks、`Name NVARCHAR(200)`、
  `StartWeek/EndWeek`（CHECK 1..53 且 Start≤End）、`SortOrder`、`IsDeleted`（軟刪）、`CreatedAt/UpdatedAt`；
  filtered index `IX_TaskSub_Task(TaskId) WHERE IsDeleted=0`（需 `-I`）。
  ⚠ **子區間只排程、不打卡**：`WeeklyLogs` 仍以 Tasks 為單位、完全不動——子區間也打卡會讓成員一週對同一專案回報三次。
- `usp_UpsertTaskSubInterval(@SubId=NULL→新增, @TaskCode, @Name, @Start, @End, @Actor…, @NewSubId OUTPUT)`：
  SP 內檢查 ①權限＝**主管或專案負責人**（比照 `usp_UpdateProjectDeliverable`，子區間是負責人自己的工作拆解）
  ②名稱非空 ③**起迄必須落在父區間內**（跑出去就不是「子」，甘特圖也會畫到父條外面）④每條計畫區間最多 10 筆。
- `usp_DeleteTaskSubInterval(@SubId, @Actor…)`：軟刪除；同一套權限檢查。
- `CREATE OR ALTER usp_UpdateTaskSchedule`：**父區間改期時若任一子區間會跑出新範圍 → RAISERROR 列出名稱**
  （`STRING_AGG`；不靜默截斷子區間，讓使用者自己決定先改哪邊）。其餘與遷移 15 完全相同（稽核值尾端的 `NID=` 保留）。
- 稽核：`EntityType='SubInterval'`、`EntityId=CONCAT(TaskCode,'#',SubId)`（如 `t204-2#3`）；Old/NewValue 格式與 Task 相同
  `name=… | W..-W..`；**DELETE 的 OldValue 也帶名稱**——子區間不在 API 的 Tasks 對照表裡，刪除後白話翻譯只能靠它。
- 父區間／專案軟刪時子區間不另行處理（bootstrap 以 `t.IsDeleted=0 AND p.IsDeleted=0` JOIN，復原父區間即自動回來）。
- 後端 bootstrap **先 `OBJECT_ID('dbo.TaskSubIntervals')` 檢查再查**：遠端尚未跑遷移 18 時整包不會失敗（遷移 16/17 曾因欄位不存在讓系統開不起來）。
- 冪等（`OBJECT_ID`／`sys.indexes` 檢查、`CREATE OR ALTER`）；SP 以 `QUOTED_IDENTIFIER ON` 建立。
- 已套用本機 Gantt（驗證：負責人與主管新增皆成功、他人 400「僅專案負責人或主管可編輯子區間」、超出父區間 400 並列出範圍、
  空白名稱 400、W0 400、父區間縮短 400 列出兩筆子區間、修改與刪除正確、稽核白話三種動作皆完整句子；
  驗證用 5 筆子區間已刪除，AuditLog 保留）。**遠端需執行（順序 …→17→18）**；Gantt2 未套用。

## 2026-09-12 — 遷移 18 腳本修正（結構不變，遠端執行前的順序修正）
- `18_add_task_subintervals.sql` 的 `SET QUOTED_IDENTIFIER ON; SET ANSI_NULLS ON;` **由第 4 段 SP 之前移到檔頭**（`CREATE TABLE` 之前）。
  原本註解寫「上方 filtered index 亦需要」，但實際擺在 `CREATE INDEX … WHERE IsDeleted = 0` **之後**：
  sqlcmd 沒帶 `-I`（或用其他排程工具）跑時，索引會 error 1934 失敗、後面的 SP 卻照建 → 得到「功能正常但沒索引」的半套結果，
  且因腳本冪等、下次重跑也只會再失敗一次那一段。
- 資料表／SP／稽核格式**完全沒變**；本機 Gantt 當初以 `-I` 執行，`sys.indexes` 已確認 `IX_TaskSub_Task has_filter=1`，**不需重跑**。
  遠端／Gantt2 尚未執行 18，直接用修正後的檔案即可。
- 另：`STRING_AGG`（第 4 段）需 **SQL Server 2017+**；遠端執行前先 `SELECT @@VERSION` 確認（`系統架構.md` 記載為 2019）。

## 2026-09-12 — 遷移 19：移除殘留的 1–52 週次 CHECK（`19_drop_legacy_week_checks.sql`）
- **成因**：`old.sql` 建表時的週次約束叫 `CK_WLog_Week`（WeeklyLogs）／`CK_Extra_Week`（ExtraNotes），上限 **52**。
  `new.sql` 升到 53 週時 DROP 的是**新名字** `CK_WeeklyLogs_WeekNo`／`CK_ExtraNotes_WeekNo`（當時不存在），再用新名字建 1–53
  → 兩張表各同時掛著新舊兩條約束，**實際上限仍是 52**。（Tasks／WeeklyPlans／WeeklyComments／ScheduleWeeks 沒這問題。）
- **症狀**：本機以交易＋rollback 探測 `WeeklyLogs` 寫入 `WeekNo=53` →「INSERT 陳述式與 CHECK 條件約束 "CK_WLog_Week" 衝突」。
  不是 RAISERROR 50000，API 走 `Fail(ex)` 回 500「伺服器處理失敗」，使用者看不出是週次問題。
  2026 年度有 53 週（W53＝2026-12-28～2027-01-03），**年底打卡與非專案事項一定失敗**；遠端基準（old+new）相同。
- **內容**：冪等 `DROP CONSTRAINT CK_WLog_Week`／`CK_Extra_Week`（依 `sys.check_constraints` 名稱＋所屬表判斷）；
  另加保險：若新約束 `CK_WeeklyLogs_WeekNo`／`CK_ExtraNotes_WeekNo` 不存在則補建 1–53。末段 SELECT 列出兩張表的週次約束供目視確認。
  不動資料、不動 SP。
- 已套用本機 Gantt（驗證：兩張表各只剩一條 1–53 約束；W53 探測 INSERT 成功後 rollback；重跑腳本「不存在，略過」）。
  **遠端需執行（順序 …→18→19）**；Gantt2 未套用。

## 2026-09-12 — 遷移 20：子區間打卡（`20_sub_interval_checkin.sql`）
- **背景**：使用者決定推翻遷移 18 的「子區間只排程不打卡」——專案很大時一條計畫區間切了好幾個階段，只對計畫區間打卡
  變成「一週只有一件事」，主管看不出哪個階段動了。規則：①該週有落在範圍內的子區間 → 對每個子區間各自打卡；沒有 → 對計畫區間
  ②父層那週已有紀錄（切子區間前回報的舊週）→ 視為已回報、不催子區間 ③計畫區間該週分數＝子區間平均（未回報 0），滿分仍＝區間數
  ④有回報紀錄的子區間僅主管可刪；刪除可復原。
- `WeeklyLogs.SubId INT NULL`（FK `FK_WLog_Sub`→TaskSubIntervals）：NULL＝對計畫區間的回報；**既有資料全部維持 NULL，不動**。
- 唯一鍵：`UQ_WeeklyLogs (TaskId,Year,Week)` → 唯一索引 **`UQ_WeeklyLogs_Unit (TaskId,SubId,Year,Week)`**（先建新的再拿掉舊的）。
  SQL Server 的唯一索引把 NULL 當一個值 → 每條區間每週仍只能有一筆父層紀錄、每個子區間各一筆。
- `usp_UpsertWeeklyLog`／`usp_UpdateLogScore` 加 **`@SubId INT = NULL`（參數最後）**：舊呼叫端不變；有值時檢查子區間屬於該區間且未刪。
  MERGE／查詢一律 `ISNULL(SubId,-1)=ISNULL(@SubId,-1)`。稽核 `EntityId`＝`t101-1#5@2026W9`（有 SubId 時；`#` 與子區間稽核同分隔符）。
  ⚠ API 層**只在 `req.SubId` 有值時才傳 `@SubId`**——遠端未跑遷移 20 時舊 SP 沒這個參數，一律傳會讓所有打卡壞掉。
- `usp_DeleteTaskSubInterval`：有回報紀錄（`COUNT(*) FROM WeeklyLogs WHERE SubId=@SubId`）時非主管 RAISERROR；Detail
  `軟刪除（含 n 筆回報，資料保留）`（API 白話翻譯會接在句尾）。
- 新 `usp_RestoreTaskSubInterval(@SubId, @Actor…)`：復原軟刪除；檢查父區間仍在、範圍仍涵蓋、未超過 10 筆；稽核 `RESTORE/SubInterval`。
- `vw_WeeklyReport` 補 `SubId`／`SubName`（LEFT JOIN）。
- 後端 bootstrap 先 `COL_LENGTH('dbo.WeeklyLogs','SubId')` 再組 SQL：分兩份回 `taskLogs`（SubId NULL）＋`subLogs[subId][week]`；
  週報 Excel 同樣先檢查欄位，父層無紀錄且有進行中子區間 → 逐子區間一列。遠端未跑遷移 20 時整包不會失敗。
- 已套用本機 Gantt（驗證：成員對子區間打卡／主管評分／不屬於該區間的 SubId 400／成員刪有紀錄的子區間 400／主管刪→復原、
  bootstrap 分兩份、稽核白話「…的子區間「X」…」、Excel 逐子區間一列、看板「回報 2/4・得分 0.9/3」、legacy 父層紀錄優先；
  驗證用子區間 16／17 與 3 筆 WeeklyLogs 已硬刪除，AuditLog 保留）。**遠端需執行（順序 …→19→20）**；Gantt2 未套用。

## 2026-09-12 — 子區間打卡總開關（**不在 DB**，在 `appsettings.json` 的 `Features:SubIntervalCheckin`；無結構變更、無遷移檔）
- 使用者決定「先不用子區間打卡」→ 加總開關，**預設 false**。原本做成 `AppSettings.SubIntervalCheckin`＋網頁切換鈕，
  使用者要求**改為設定檔、不做在網頁上**（避免誤操作）→ 已拆掉端點與 DB key；本機測試時建的 `AppSettings` 列已刪除。
  `AppSettings` 維持兩個 key：`AllowRetroCheckin`／`AccessControlEnabled`。
- 關著時：bootstrap 回 `subCheckinEnabled:false`、前端回報單位一律為計畫區間、`/api/weekly-log`／`/score` 帶 `SubId` 一律 400、
  週報 Excel 不逐子區間展開（父層查詢仍以 `SubId IS NULL` 過濾，避免既有子區間回報讓 JOIN 出多列）。
- 遠端部署：`appsettings.json` 加 `"Features": { "SubIntervalCheckin": false }`（缺值也視為 false）；與連線字串同為即時讀取，改檔即生效。
- 本機已驗證：改檔 true → bootstrap `true`、改回 false → `false`（伺服器不重啟）；關著時子區間回報 400。

<!-- 新的 DB 變更請從此行下方繼續追加，勿修改上方任何段落 -->

## 2026-09-14 — 遷移 21：`usp_EnsureScheduleYear` 改用公司週次規則，校正既有週表（`21_company_week_rule.sql`）
- **背景**：使用者 2026-09-14 確認公司行事曆——**公司週次不是 ISO 8601**：一週從**週日**開始；W1＝含 1/1 的那一週（從 1/1 前最近的
  週日起算）；跨年**照日期切**（12/31 屬舊年度最後一週、1/1 起屬新年度 W1；等同 Excel `WEEKNUM(d,1)`）。
  例：2026-12-31(四)＝2026 W53、2027-01-01(五)＝2027 W01（只有 1/1、1/2 兩天、0 個上班日）、2027 W02 從 1/3(日) 起。
  舊 SP 依 ISO（週一起始、含 1/4 那週為 W1、月份取週四）：2027 產成 52 週且日期全錯；old.sql 已 `EXEC … 2027`，遠端存有這份 ISO 版。
  2026 的 53 列是 old.sql 手寫種子，本來就符合公司規則（各月 5,4,5,4,5,4,4,5,4,4,5,4）。
- **SP**：`CREATE OR ALTER usp_EnsureScheduleYear`——`@week1Sun`＝1/1 往前推到週日（`DATEDIFF(DAY,'19000107',@jan1)%7`，與 `@@DATEFIRST` 無關）、
  `@maxWeek = DATEDIFF(DAY,@week1Sun,12/31)/7+1`（52 或 53）、週所屬月份＝該週**週日**的月份（W1 的週日可能在前一年 12 月，固定算 1 月）。
- **校正既有年度**（cursor 逐年逐週比對）：月份不符 → UPDATE `MonthName/MonthLabel`；缺週 → INSERT；多出的週只 PRINT 警告不刪。
  **週次編號本身不動**——使用者一直是用公司週在填，W37 就是 W37，只有「哪幾週算 9 月」與週數對錯。ScheduleWeeks 沒有 FK 指向它，不影響資料表。
- 實測本機：**Gantt（MSD）2026 完全吻合、0 更動**；**Gantt_IMD 的 2026 是舊 SP 產的 ISO 版 52 列 → 更正 9 週月份（W14/18/23/27/31/36/40/44/49）
  ＋補 W53**；2027 兩庫皆由 ISO 52 列 → 公司規則 53 列（各月 6,4,4,4,5,4,4,5,4,5,4,4、W53＝12/26–12/31）。重跑「更正 0 週、補入 0 週」。
- 同批程式：前端 `app.jsx` `companyWeekOf`／`weekDateRange`／`weekRangeLabel`（`getTodayWeek` 改用；header 週數旁、甘特週次表頭 title、
  回報中心副標顯示「9/13–9/19」日期區間）、後端 `Program.cs` `CompanyWeekOf`（`IsFutureWeek` 改用，不再 `ISOWeek`）。三處同一套規則。
- **遠端需執行（順序 …→20→21，四個站台的 DB 都要跑）**；Gantt2 未套用。
  ⚠ 跑之前先看 PRINT：某站台的 2026 若是 ISO 版（像本機 IMD），會更正月份＋補 W53，甘特月份表頭會跟著移一週——那是修正，不是壞掉。
