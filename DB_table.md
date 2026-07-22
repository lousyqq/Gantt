# DB_table.md — 資料庫結構與變更歷史（append-only）

> **本檔規則（最重要）**：資料庫變更紀錄**只能往下新增、不可刪減或改寫既有段落**。
> 遠端正式 DB 已有線上資料，**嚴禁刪庫／刪表重建**；所有變更以冪等增量遷移檔配合本檔歷史對照執行。

## 環境與基準

| 環境 | 說明 | 已執行 |
|------|------|--------|
| 遠端正式主機 | 線上正式資料，只能跑增量遷移 | `old.sql` → `new.sql`（=01~09 基準）；**10~13 需依編號順序執行（若尚未）** |
| 本機開發 `Sariel\Gantt` | 開發／驗證用 | 全部（old+new+10+11+12+13） |
| 本機測試 `Sariel\Gantt2` | 切換連線字串測試用 | old+new+10（2026-07-16 補跑）；11~13 未套用 |

- **`old.sql`＋`new.sql` 不可修改**：兩檔＝遠端已執行完畢的架構基準（2026-07-12 以臨時 DB 逐項指紋驗證與正式架構一致）。
- `backup_sql/` 內 01~09 逐檔僅供參考，勿執行勿修改。
- 新遷移檔一律 `10_xxx.sql`、`11_xxx.sql`… 往下遞增、冪等設計；全新環境＝`CREATE DATABASE` → `old.sql` → `new.sql` → 10 以後依序。
- `sim_create_WEB_notes_person.sql`＝**僅開發機用**（模擬遠端跨 server VIEW `[WEB].[dbo].[notes_person]` 名冊，34 筆測試資料），**遠端勿執行**。
- sqlcmd 執行必帶旗標：`-I`（QUOTED_IDENTIFIER ON，filtered index 必要）、`-f 65001`（UTF-8 中文）、`-b`（遇錯停止）。
- 開新年度只需 `EXEC dbo.usp_EnsureScheduleYear <年度>;`。

## 目前資料表清單（13 張）

| 資料表 | 用途 | 關鍵欄位 |
|--------|------|----------|
| Users | 成員＋主管 | UserName(UNIQUE)、Role(manager/member)、IsActive(軟刪)、SortOrder |
| ProjectTypes | 類型 a~e | TypeCode、Label、SortOrder |
| ScheduleWeeks | 年度週→月對照 | (ScheduleYear,WeekNo) PK、MonthName、MonthLabel；CHECK 週 1..53 |
| Projects | 專案主檔 | TypeCode、Category、OwnerUserId、Name、ScheduleYear、SortOrder、IsDeleted、Deliverable、MpSaving、IsStarred、NID |
| Tasks | 計畫區間 | TaskCode(`t{ProjectId}-{seq}`)、StartWeek/EndWeek(CHECK 1..53)、SortOrder、IsDeleted、NID |
| WeeklyLogs | 每週打卡 | TaskId×Year×Week 唯一、Status、Note、Score DECIMAL(2,1) DEFAULT 1、ReportedByUserId、UpdatedAt |
| ExtraNotes | 非專案事項 | UserId×Year×Week 唯一、Note、UpdatedByUserId、UpdatedAt |
| WeeklyPlans | 下週預計工作 | 同 ExtraNotes 結構 |
| WeeklyComments | 主管週報回覆 | UserId×Year×Week 唯一、Comment(空字串=已清空)、UpdatedByUserId、UpdatedAt |
| AuditLog | 操作稽核 | ActorName、ActorRole、**ActorEmpId**(Windows 工號)、Action、EntityType、EntityId、Old/NewValue、Detail、CreatedAt |
| AppSettings | 系統設定 KV | KeyName PK、Value；現有鍵：AllowRetroCheckin、AccessControlEnabled |
| AccessRules | 瀏覽權限規則 | Empno/DeptName/Dept1/Dept2/Dept3（任填≥1，同規則 AND、規則間 OR）、Note、CreatedBy/At |
| LoginLogs | 登入統計 | UserName、Role、EmpId、Source(manual/auto)、LoginAt |

**View**：`vw_ProjectTasks`、`vw_WeeklyReport`。
**外部相依**：`[WEB].[dbo].[notes_person]` 名冊（遠端跨 server VIEW；本機以 sim 腳本模擬）。

## 目前預存程序清單（24 個，全部寫 AuditLog）

usp_UpsertWeeklyLog（打卡）、usp_UpsertExtraNote、usp_UpsertWeeklyPlan、usp_UpsertWeeklyComment（SP 內檢查主管）、
usp_UpdateTaskSchedule、usp_InsertProject、usp_UpdateProject（可改負責人）、usp_DeleteProject（軟刪）、
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

<!-- 新的 DB 變更請從此行下方繼續追加，勿修改上方任何段落 -->
