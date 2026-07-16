# memory.md — 修改歷史紀錄

本檔記錄 MSD 專案追蹤總表（Gantt）的重大修改歷史。
規則：每次更新同步寫入本檔與 `CLAUDE.md`；若 SQL 結構有變動，一併修改目錄下的 `.sql` 檔案。

---

## 2026-07-02 — 主管專案管理功能

**需求**：主管登入時可對每位成員的既有專案進行新增／修改／刪除（名稱＋分類＋類型），
新增專案預計進行的進度區間，並可拖曳專案名稱在同一成員內上下排序，拖曳後 No 欄自動重新編號。

**設計決定**（經使用者確認）：
- 分類輸入 = 下拉選現有分類 + 可自行輸入新分類（HTML `datalist`）。
- 新增／編輯時，名稱、分類、類型（a/b/c/d）皆可修改。

**資料庫**（`01_schema_and_objects.sql`；遷移腳本 `03_add_project_sortorder.sql` 供既有 DB 事後補欄位用）
- `dbo.Projects` 新增 `SortOrder INT NOT NULL DEFAULT(0)` — 同一負責人內的顯示順序。
- 新增預存程序 `dbo.usp_ReorderProjects @OrderedIdsJson,@Actor,@ActorRole`
  （用 `OPENJSON` 保留陣列輸入順序；SQL 2019 的 `STRING_SPLIT` 不保序，故不採用）。
- 既有並沿用：`usp_InsertProject`（`@NewProjectId OUTPUT`）、`usp_UpdateProject`、
  `usp_DeleteProject`（軟刪除）、`usp_InsertTask`（`@NewTaskCode OUTPUT`，碼為 `t{ProjectId}-{seq}`）、`usp_DeleteTask`。
- `usp_GetBootstrap` / bootstrap 查詢改以 `ORDER BY p.OwnerUserId, p.SortOrder, p.ProjectId, t.SortOrder` 排序。

**後端**（`Program.cs`）新增 6 個端點：
- `POST /api/project`（新增，回傳 `projectId`）
- `POST /api/project/update`（修改名稱／分類／類型）
- `POST /api/project/delete`（軟刪除）
- `POST /api/project/reorder`（拖曳排序，body `orderedIds`）
- `POST /api/task`（新增計畫區間，回傳 `taskCode`）
- `POST /api/task/delete`

**前端**（`ClientApp/app.jsx`，需 `npm run build`）
- 各成員群組標題新增「＋ 新增專案」按鈕（僅主管）。
- 專案列（僅主管）：拖曳把手 `⠿` 於同成員內排序（No 依 index 自動重編號）；
  hover 顯示 ＋（新增區間）／✎（編輯）／🗑（刪除）。
- 新增 `ProjectEditModal`（名稱／分類 datalist／類型下拉）與 `IntervalModal`（名稱／起訖週）。
- 變更後以 `refreshData()` 靜默刷新（不跳整頁 Loading）；拖曳為樂觀更新，失敗才回滾。

**驗證**：`npm run build`、`dotnet build` 皆 0 error/0 warning；
以實際 Gantt DB 跑過 新增→加區間→排序→更新→刪除 全流程皆成功，測試資料已清除；瀏覽器 console 無警告／錯誤。

---

## 2026-07-05 — API 路徑自動適應 IIS 子目錄部署

**問題**：發布到 IIS 的 `/Gantt` 子應用程式時，前端寫死的絕對路徑 `/api/...` 會打到站台根目錄而 404，
過去需手動把程式碼全部改成 `/Gantt/api/...` 才能用。

**修正**（`ClientApp/app.jsx`，需 `npm run build`）：
- `API_BASE` 改為執行期自動偵測：取 `window.location.pathname`，去掉檔名（如 `index.html`）與結尾斜線。
  - 本地 `http://localhost:5099/` → `API_BASE=''` → `/api/...`
  - IIS `http://server/Gantt/` → `API_BASE='/Gantt'` → `/Gantt/api/...`
- 後端不需修改：ASP.NET Core 掛在 IIS 子應用程式時 ANCM 自動處理 PathBase。
- `wwwroot/index.html` 的資源本來就是相對路徑（`app.js`／`app.css`／`lib/*`），不受影響。

**驗證**：本地 bootstrap 正常；模擬 `/Gantt/`、`/Gantt`、`/Gantt/index.html` 三種 pathname 皆算出 `/Gantt`；console 無錯誤。
**結論**：本地測好的程式碼可直接發布至 IIS 子目錄，無需再改 API 路徑。

---

## 2026-07-05 — 中優先缺口與 bug 修正（4 項）

皆為前端修改（`ClientApp/app.jsx`，已 `npm run build`），後端與 DB 不變：

1. **補上「刪除計畫區間」UI**：後端 `/api/task/delete` 原本沒有任何前端入口。
   TaskModal（主管視角）「儲存排程」旁新增「🗑 刪除區間」按鈕，經 `handleDeleteTask` 呼叫 API（confirm → 軟刪除 → refreshData）。
2. **拖曳排序樂觀更新改純函式**：原 `let i=0; setProjects(prev => ...reordered[i++]...)` 閉包遞增計數器，
   若開 React StrictMode（updater 重複執行）會錯位；改為 updater 內自建佇列 `[...reordered]` + `queue.shift()`。
3. **篩選中暫停拖曳**：搜尋字串或類型篩選啟用時（`isFilteringRows`），拖曳把手改為灰色不可拖曳
   並提示「請先清除篩選」，避免落點以全清單計算、與畫面（篩選後）不一致。
4. **60 秒靜默輪詢**：登入後每 60 秒 `refreshData()`（拖曳中暫停、失敗靜默忽略），
   讓其他使用者的變更自動出現。註：寫入衝突仍為 last-write-wins，完整並行控制（rowversion）列為未來事項。

**驗證**：把手 69 個可拖曳→篩選中 0 個（顯示停用提示）→清除後恢復；
「刪除區間」以測試專案走完 建立→刪區間→bootstrap 消失→清除測試專案 全流程；console 無警告錯誤。

---

## 2026-07-05 — 低優先修正（年度切換／異動紀錄／自製確認視窗）

**資料庫**（`01_schema_and_objects.sql`；遷移 `04_add_ensure_schedule_year.sql`，已在 Sariel 執行）
- 新增 `usp_EnsureScheduleYear @Year`：依 ISO 8601 產生指定年度的 `ScheduleWeeks`（52 或 53 週，
  每週所屬月份取該週「週四」的月份）。**開新年度只需 `EXEC dbo.usp_EnsureScheduleYear 2027;`，不用改程式**。
- 已產生 2027 年度資料（52 週）供年度切換使用。

**後端**（`Program.cs`）
- bootstrap 新增回傳 `years`（可切換年度清單）與 `weeks`（該年度週→月對照），
  且 projects 查詢加上 `AND p.ScheduleYear = @y`（以前不分年度全撈）。
- 新增 `GET /api/audit-log?top=`（預設 200、上限 1000）：回傳 AuditLog 最近 N 筆。

**前端**（`ClientApp/app.jsx`，已 `npm run build`）
1. **年度切換**：`SCHEDULE_YEAR` 常數改為 `scheduleYear` state（預設今年，DB 無該年資料自動退回最近年度）；
   `MONTHS`／`WEEKS_TOTAL` 改由 bootstrap 的 weeks 動態計算（支援 53 週年）；工具列新增「年度」下拉。
   `getTodayWeek(year, weeksTotal)` 參數化；TaskModal／IntervalModal 週次驗證上限改動態。
2. **異動紀錄面板**（主管專屬）：header 新增「📜 異動紀錄」按鈕 → `AuditPanel` 右側滑出面板，
   顯示最近 300 筆（動作彩色標籤＋人員＋時間＋內容），可關鍵字篩選。
3. **自製確認視窗**：`window.confirm` 全數改為 `ConfirmModal`（紅色標題、取消／確定刪除），
   用於刪除專案與刪除計畫區間。
4. **HTTPS**：屬 IIS 部署設定（站台綁定 https + 憑證），非程式碼變更，未動。

**驗證**：前後端建置 0 error；bootstrap 回傳 years=[2026,2027]；切 2027 顯示空清單＋2027 月份表頭、
切回 2026 資料還原；異動紀錄面板顯示實際 AuditLog；確認視窗開啟／取消正常；console 無警告錯誤。

---

## 2026-07-05 — Excel 週報匯出

**套件**：`Gantt.csproj` 新增 NuGet `ClosedXML 0.105.0`（產生 .xlsx）。

**後端**（`Program.cs`）
- 新增 `GET /api/weekly-report-excel?year=&week=`：直接查 DB（本週排定任務含未回報＋非專案事項），
  以 ClosedXML 產生兩個工作表：
  - 「W{週} 專案執行」：成員／分類／類型／專案名稱／計畫任務／排程／本週狀態／工作說明；
    狀態欄依 有執行=綠、Monitor=藍、未執行=灰、未回報=黃 上色；深藍標題列、凍結首列、框線、欄寬與自動換行。
  - 「W{週} 非專案事項」：成員／內容（橘色標題列）。
- 檔名 `WeeklyReport_{年}_W{週}.xlsx`（純 ASCII，避免 Content-Disposition 中文編碼問題）。

**前端**（`ClientApp/app.jsx`，已 `npm run build`）
- 「團隊總結」面板 header 新增「⬇️ 匯出 Excel」按鈕（綠色，位於「複製週報文字」左側），
  以隱藏 `<a download>` 觸發下載；URL 走 `API_BASE` 前綴（IIS 子目錄相容）；`WeeklyReportDashboard` 新增 `year` prop。

**驗證**：端點回傳 200＋正確 content-type／content-disposition、ZIP 簽名（PK）有效；
解壓檢查 sharedStrings 含正確中文標題與實際資料列；UI 按鈕存在；建置 0 error、console 乾淨。

---

## 2026-07-05 — 錯誤訊息外洩修復 + Git 版本控管整理

**錯誤訊息外洩（高優先安全項之一）**
- `Program.cs` 新增統一錯誤處理 `Fail(ex)`：內部例外只寫入伺服器 log（`app.Logger.LogError`，含完整堆疊），
  對外一律回「伺服器處理失敗，請稍後再試或聯絡系統管理員。」（500）；
  預存程序以 `RAISERROR` 拋出的商業邏輯訊息（SqlException Number=50000，自己撰寫的安全文字）照原文回 400。
  全部 12 個 catch 區塊改走 `Fail(ex)`。
- `ClientApp/app.jsx` 新增 `readApiError()`：解析 ProblemDetails JSON 的 `detail`/`title` 顯示，不再把整包 JSON 原文丟給使用者。
- 驗證：不存在的 TaskCode → 400「TaskCode 或 Actor 不存在」；週次違反 CHECK 約束 → 500 一般化訊息
  （瀏覽器端看不到資料表/約束名稱），詳細例外完整記錄於伺服器 log。

**Git 版本控管整理**
- 原況：整個 repo 只有一個 commit（first commit）；無 `.gitignore`；`node_modules`（3,330 檔）、
  `.vs`/`bin`/`obj`（116 檔）全被追蹤。remote 為 github.com/lousyqq/Gantt。
- 處理：新增 `.gitignore`（.vs/bin/obj/publish/node_modules/*.suo/*.user）；`git rm -r --cached` 移除追蹤；
  分兩個 commit：①chore（.gitignore＋移除建置產物）②feat（近期全部功能）。
- ⚠️ 注意：`appsettings.json` 含明碼 SQL 密碼且已存在於 GitHub remote 的歷史中——若該 repo 為 public 應立即改密碼並改為 private；
  正式解法為改用環境變數（尚未實作，屬高優先安全項）。

---

## 2026-07-06 — 主管成員管理（新增／移除成員 + 專案改派）

**需求**：單位有新同仁轉入時，主管可自行新增成員（不必改種子資料），
為其安排專案工作，新成員與其他成員一樣可登入打卡回報；也可移除已離開的成員。

**資料庫**（`01_schema_and_objects.sql`；遷移 `05_add_user_management.sql`（CREATE OR ALTER，idempotent），已在 Sariel 執行）
- `usp_InsertUser @UserName,@Actor,@ActorRole`：新增 member（SortOrder=MAX+1）；
  名稱空白／已存在會 RAISERROR；**同名成員曾被移除（IsActive=0）則重新啟用**，歷史專案與回報自動恢復可見。
- `usp_DeleteUser @UserName,@Actor,@ActorRole`：軟刪除（`IsActive=0`，歷史回報保留）；
  不可移除 manager；**名下仍有未刪除專案時 RAISERROR 擋下**（提示先刪除或改派專案）。
- 兩者皆寫 AuditLog（EntityType=`User`，Action=INSERT/DELETE）。Users 表結構不變（本來就有 IsActive）。

**後端**（`Program.cs`）新增 2 個端點：`POST /api/user`、`POST /api/user/delete`（皆走 `Fail(ex)` 慣例）。

**前端**（`ClientApp/app.jsx`，已 `npm run build`）
1. 主管 header 新增「👥 成員管理」按鈕 → `MemberPanel` 右側滑出面板：
   輸入名稱新增（Enter 可送出、重名前端先擋）；成員清單顯示當年度專案數；「移除」經 `ConfirmModal` 確認。
2. **空群組列**：主管視角（未啟用搜尋／類型篩選）下，沒有專案的成員也顯示甘特圖群組列（0 項），
   才能對剛加入的新同仁按「＋ 新增專案」。成員視角維持原行為（無專案不顯示）。
3. **編輯專案可改派負責人**：`ProjectEditModal`（編輯模式）新增「負責人」下拉（後端 `usp_UpdateProject` 本就支援），
   改選他人時顯示移轉警告；用於把專案移轉給新同仁、或清空離職成員名下專案以便移除。
4. `AUDIT_ENTITY_LABELS` 補 `User: '成員'`。新成員自動出現在登入畫面（bootstrap users），即可打卡與填非專案事項。

**驗證**：`npm run build`、`dotnet build` 0 error；以實際 Gantt DB 走完
新增成員→空群組列出現→為其新增專案→（名下有專案時移除被 400 擋下，訊息照原文顯示）→
編輯專案改派給冠芝→移除成員成功→AuditLog 有 User INSERT/DELETE 紀錄；
測試成員與測試專案已從 DB 硬刪清除；console 無警告錯誤。

**追加（同日）— 編輯成員名稱**
- `usp_UpdateUser @UserName,@NewName,@Actor,@ActorRole`（01 與 05 皆已更新，05 已重跑於 Sariel）：
  名稱空白／不存在／重名（含已停用者，UNIQUE 約束涵蓋全部列）RAISERROR；同名直接 RETURN 不記錄。
  專案／回報以 UserId 關聯，改名後歷史資料自動跟隨；AuditLog 記 UPDATE User（OldValue→NewValue）。
- 後端新增 `POST /api/user/update`。
- 前端 `MemberPanel` 成員卡新增「✎ 編輯」→ 行內編輯（Enter 儲存、Esc 取消、重名前端先擋）。
- 注意：成員被改名當下若正在其他瀏覽器以舊名登入，後續寫入會回「User 不存在」，重新登入即可。
- 驗證：改名「冠芝→冠芝改」名下 5 專案跟隨→重名「玉婷」被擋→改回「冠芝」；AuditLog 兩筆 UPDATE User；console 乾淨。

---

## 2026-07-06 — Windows 工號稽核（whoami + AuditLog.ActorEmpId）

**需求**：公司桌機登入必帶 Windows 帳號（如 `UMC\00058897`），要求記錄操作網頁者的**工號**，
讓每筆編輯動作可追溯到實際操作的 Windows 帳號（顯示名稱可能共用/選錯人頭）。
參考 EQDashboard `AuthController.WhoAmI` 的 Negotiate 作法。

**套件**：`Gantt.csproj` 新增 `Microsoft.AspNetCore.Authentication.Negotiate 9.0.0`。

**後端**（`Program.cs`）
- 註冊 `AddAuthentication(Negotiate).AddNegotiate()` + `UseAuthentication/UseAuthorization`；
  僅 `/api/whoami` 要求驗證（`RequireAuthorization` 指定 Negotiate scheme），其餘端點維持匿名。
- 新增 `GET /api/whoami`：`User.Identity.Name` 剝 `{Auth:WindowsDomainStripPrefix}\`（預設 UMC，appsettings 可改）
  → 剝 `@domain`（UPN 保險）→ 取最後 `\` 之後（非設定網域如本機開發 `SARIEL\yu-tinglin` 也能取到帳號）。
  無法驗證的請求收到 401 + WWW-Authenticate: Negotiate；網域內瀏覽器會自動補認證。
- 12 個寫入端點的 request record 全部加 `string? ActorEmpId`，傳入 SP `@ActorEmpId`。
- `GET /api/audit-log` 回傳新增 `empId` 欄位。

**資料庫**（`01`；遷移 `06_add_actor_empid.sql`，已在 Sariel 執行）
- `AuditLog` 新增 `ActorEmpId NVARCHAR(20) NULL`。
- 全部 12 個寫入 SP 加 `@ActorEmpId NVARCHAR(20)=NULL` 並寫入 AuditLog（06 以 CREATE OR ALTER 全數重建）。

**前端**（`ClientApp/app.jsx`，已 `npm run build`）
- 模組層 `CURRENT_EMP_ID` + `detectEmpId()`：App 載入時打一次 `/api/whoami`（401/失敗靜默 → null，系統照常）。
- **`apiPost` 統一自動注入 `actorEmpId`**（一處改動涵蓋所有寫入，之後新端點不用另外處理）。
- 顯示：登入畫面底部「已偵測到 Windows 工號：xxx」；header 使用者資訊「主管 · 工號 xxx」；
  異動紀錄面板操作者旁灰色 mono 標籤顯示工號，並納入關鍵字篩選。

**部署注意**：IIS 需啟用 Windows Authentication（**匿名驗證也要保持啟用**，其他端點才不會被擋）；
Kestrel 本機由 Negotiate 套件處理（NTLM）。部署到非 UMC 網域改 `appsettings Auth:WindowsDomainStripPrefix`。

**驗證**：本機 whoami 回 `SARIEL\yu-tinglin` → empId=`yu-tinglin`；登入畫面/header 顯示工號；
新增＋移除測試成員後 `AuditLog.ActorEmpId` 兩筆皆為 `yu-tinglin`，異動紀錄面板顯示工號標籤；
測試資料已清除；前後端建置 0 error、console 乾淨。

---

## 2026-07-06 — SQL 遷移腳本合併（03/04/05/06 → 03_upgrade_to_current.sql）

**需求**：使用者的既有 DB 只跑過舊版 01+02，希望一份 03 執行一次就升級到目前完整架構，取代零散的 03～06。

**處理**：
- 新增 `03_upgrade_to_current.sql`（合併版），內容＝原 03+04+05+06 全部：
  ① `Projects.SortOrder` 欄位＋回填（**加保護：僅在全部為 0 時回填**，重跑不會洗掉主管拖曳的自訂排序；
  原 03 是無條件回填，重跑會破壞排序——此為合併時的行為修正）；
  ② `AuditLog.ActorEmpId` 欄位；③ 13 個 SP 最新版（CREATE OR ALTER，含 @ActorEmpId 與 usp_EnsureScheduleYear）。
- 刪除 `03_add_project_sortorder.sql`、`04_add_ensure_schedule_year.sql`、`05_add_user_management.sql`、
  `06_add_actor_empid.sql`（內容已全數併入；歷史可從 git 取回）。
- 目前 .sql 檔只剩三個：01（結構）、02（種子）、03（既有 DB 升級用）。全新建置仍只需 01→02。

**驗證**：
- 在正式 Gantt DB 重跑合併版：成功、SortOrder checksum 前後一致（14964/71/468，自訂排序未被動）。
- 從 git（56b7f01）取出舊版 01/02 建臨時 DB `Gantt_MigTest` → 跑合併版 03 →
  與正式 DB 比對：資料表欄位 diff=0、13 個 SP 定義 SHA2_256 雜湊 diff=0，結構完全一致；測試 DB 已刪除。

---

## 2026-07-07 — 類型 e、視窗防誤關、到期提醒、異動紀錄白話化（4 項）

**遷移規則變更（使用者指示）**：01~03 已在其他主機建立為線上 DB 基準，之後 DB 變動一律新增 04、05… 往下，
不回頭改 01~03（含 01 也不改）。全新建置＝01→02→04+。

1. **專案類型 e「主管交辦」**
   - DB：`04_add_type_e_supervisor.sql`（idempotent，INSERT ProjectTypes 'e'；已在 Sariel 執行）。
   - 前端：`PROJECT_TYPES` 加 `'e'`（紫色系 chip）。因篩選 chips／專案列標籤／新增與編輯下拉都吃同一物件，
     自動涵蓋「新增時可選、編輯時可調動」。後端無需改（FK 到 ProjectTypes）。

2. **非專案事項編輯視窗防誤關**：編輯模式遮罩移除 `onClick={onClose}`，點視窗外不再關閉（打字不會遺失），
   只能按「取消」或 × 關閉；唯讀檢視版維持點外可關（無資料遺失疑慮）。

3. **排程到期提醒**（設計：與「未回報」紅框❗區隔，用橘框⏰）
   - 判定（以「實際本週 todayWeek」計，非檢視週）：任務進行中且（剩餘 ≤2 週 或 時程已過 ≥70%）→ `isTaskDeadlineSoon()`。
   - 呈現：甘特條橘色 ring＋任務名前 ⏰（未回報紅框優先）；tooltip 加「⏰ 排程即將到期：剩 N 週（時程已過 X%）」；
     頂部統計列新增「⏰ 即將到期 N」StatChip（>0 橘色）；右側圖例補「⏰ 即將到期」。

4. **異動紀錄白話化（給高階主管看）**
   - 作法：**讀取時翻譯**（`/api/audit-log` 端點內做，DB 與寫入 SP 不動，舊紀錄也翻得出來）。
     端點先載入 Task/Project 名稱對照（含已刪除），把每筆組成 `summary` 回傳。
   - 範例：`t101-1@2026W999`＋executed → 「回報 專案「b.[FDC…]」的任務「SPEC 提供1」2026 年第 999 週進度：有執行，工作說明：x」；
     `軟刪除(含任務)` → 「刪除專案「名稱」（負責人：X，含其所有計畫區間；資料保留，必要時可請系統管理者還原）」；
     專案修改列出欄位差異（名稱／分類／類型／負責人→專案移轉）；成員更名「舊」→「新」等。
   - 前端 AuditPanel 只顯示 summary（原始技術代碼移到滑鼠 title 提示），關鍵字篩選納入 summary。
   - 對照查不到（如已被硬刪的測試資料）→ 退回通用描述；解析失敗 → fallback 原文。

**驗證**：建置 0 error；e 類型新增→紫色 E chip→編輯改 c 成功；異動紀錄實際顯示上述白話文；
點視窗外不關、文字保留、取消可關；主管視角 6 個任務橘框⏰ 與統計晶片一致；測試專案已刪除；console 乾淨。
（註：preview 截圖工具當下逾時，驗證以 DOM 檢查完成。）

---

## 2026-07-07 — 全站彈出視窗防誤關（點視窗外一律不關閉）

**需求**：延續前次「非專案事項」的修正，使用者要求**所有**子視窗點擊視窗外都不可自動關閉，
只能用「取消」「×」或送出按鈕關閉。

**修正**（`ClientApp/app.jsx`，已 `npm run build`；後端與 DB 不變）：
移除全部 8 處遮罩的 `onClick={onClose/onCancel}`：TaskModal、ExtraNoteModal(唯讀版；編輯版前次已改)、
PendingPanel、ProjectEditModal、IntervalModal、ConfirmModal、AuditPanel、MemberPanel。
並於程式碼與 CLAUDE.md 記為 UI 慣例：新增 Modal 沿用「遮罩不綁關閉」。

**驗證**：逐一實測 新增專案 / 任務回報 / 刪除確認 / 異動紀錄 / 成員管理 —
點遮罩皆維持開啟、取消或 × 正常關閉；console 乾淨。

---

## 2026-07-07 — 到期提醒強化（左欄徽章＋可點開清單）

**需求**：原本的到期提醒（甘特條細橘框＋⏰）不夠明顯。與使用者確認設計後選定兩項（未選整條變橘、閃爍動畫）：

**修正**（`ClientApp/app.jsx`，已 `npm run build`；後端與 DB 不變）：
1. **左欄徽章**：凍結的「專案名稱」欄位加橘色「⏰ 剩N週」小徽章（取該專案所有到期區間的最小剩餘週數，
   title 顯示到期區間數）——橫向捲動到別的月份也看得到提醒。
2. **可點開的到期清單**：頂部「⏰ 即將到期 N」統計晶片改為按鈕（>0 橘底＋ring），點開右側 `DeadlinePanel`：
   依剩餘週數排序，每項顯示專案／任務／負責人／排程／剩N週（≤1 週紅字）／已過%＋進度條；
   點項目 → 關面板、`setScrollTargetWeek(task.end)` 捲動定位、開 TaskModal。空清單顯示 🎉。
   `deadlineTasks` useMemo 供清單與晶片數字共用（`weekStats.deadlineSoon` 移除）。
3. 遮罩不綁關閉（沿用全站慣例）。原本的甘特條橘框＋⏰＋tooltip 保留。

**驗證**：左欄 6 個徽章與晶片數一致；清單排序正確；點項目後面板關閉、水平捲動定位、TaskModal 開啟；
點遮罩不關閉；console 乾淨。

---

## 2026-07-08 — 下週預計工作／名稱欄加寬／具體產出項目／打卡計分（4 項）

**資料庫**（遷移 `05_add_plan_deliverable_score.sql`，已在 Sariel 執行；01~03 不動）
- 新表 `WeeklyPlans`（每人每年每週一筆，結構同 ExtraNotes）＋ `usp_UpsertWeeklyPlan`（稽核 WEEKPLAN/WeeklyPlan）。
- `Projects.Deliverable NVARCHAR(1000)` ＋ `usp_UpdateProjectDeliverable`（**SP 內檢查**：僅負責人本人或主管；
  稽核 UPDATE Project + FieldName='Deliverable'）。
- `WeeklyLogs.Score DECIMAL(2,1) NOT NULL DEFAULT(1)`（既有列自動補 1）＋ `usp_UpdateLogScore`
  （**SP 內檢查**：僅主管、分數限 0.3/0.5/0.8/0.9/1；稽核 SCORE）。回報=1 分（含未執行），未回報=無列=0 分；
  成員重新回報不會洗掉主管評分（MERGE UPDATE 不動 Score）。

**後端**（`Program.cs`）
- bootstrap 回傳 `weeklyPlans`、taskLogs 加 `score`、projects 加 `deliverable`。
- 新端點：`POST /api/weekly-plan`、`/api/project/deliverable`、`/api/weekly-log/score`。
- audit-log 白話化補三種：SCORE（含分數名稱如「完成老闆交代」）、WeeklyPlan、Deliverable（讀 FieldName 判別）。
- Excel 週報 Sheet2 加第三欄「下週預計執行工作」（改以 Users 排序合併非專案＋下週預計）。

**前端**（`ClientApp/app.jsx`，已 `npm run build`）
1. **下週預計**：成員 header 新增「📅 下週預計」按鈕（靛藍，已填轉綠、歷史週唯讀）→ `WeeklyPlanModal`；
   團隊總結右欄加「📅 下週預計執行工作」區塊；複製週報文字加「(下週預計)」行。
2. **名稱欄加寬**：360→420（表格 430→490，含 LEFT_W／表頭／colgroup 同步改）；專案名稱 truncate 時
   滑鼠停留顯示完整名稱（title）；TaskModal 任務名稱輸入框改置中（text-center）。
3. **具體產出項目**：TaskModal 排程卡下方新增琥珀色卡片（整個專案共用）；負責人本人與主管可編輯
   （內容有變才出現「儲存產出項目」鈕），其他人唯讀；甘特 tooltip 加「🎯 產出」行。
4. **打卡計分**：TaskModal「實際執行回報」標題旁 🏆 分數徽章（未回報 0 分）；成員回報卡加計分說明；
   主管在已回報項目下看到 5 顆評分鈕（0.3 再三交代/0.5 說一動做一動/0.8 完成老闆交代/0.9 超越老闆期許/1 主動承擔，
   現分數高亮）；團隊總結每項任務顯示分數小徽章；AUDIT 標籤補 WEEKPLAN/SCORE/WeeklyPlan。

**驗證**（實際 DB 全流程）：名稱欄 420px、任務名置中；主管填產出→負責人可見可編輯；裕隆填下週預計（按鈕轉綠）
→回報任務得 1 分→主管點 0.8 徽章即時更新且按鈕高亮；異動紀錄四種新紀錄皆白話；團隊總結顯示下週預計＋分數；
Excel sharedStrings 含新欄與內容；測試專案/回報/計畫已從 DB 硬刪；console 乾淨。

---

## 2026-07-08 — 「下週預計工作」納入強制回報

**需求**：不要只有本週進度算打卡，下週預計工作也強制必填。

**修正**（`ClientApp/app.jsx`，已 `npm run build`；後端與 DB 不變）：
1. `planPendingThisWeek`（本週未填下週預計）計入 header「本週待回報」紅色徽章數（totalPendingCount）。
2. `PendingPanel` 最上方新增靛藍色「📅 下週預計執行工作(必填)」項目，點「填寫 ›」直接開 `WeeklyPlanModal`；
   空狀態(🎉)需任務與下週預計皆完成才顯示；副標改「本週排定任務打卡 ＋ 下週預計工作(必填)」。
3. `handleSaveLog`：成員於本週回報完**最後一項**待回報任務且尚未填下週預計時，
   自動開啟下週預計視窗＋提示 toast（多項任務連續回報時不干擾，只在最後一項觸發）。

**驗證**：裕隆(5 待回報+未填) 徽章=6、清單含必填項、點擊開窗；冠芝(剩 1 項)回報 Monitor 後
自動跳出下週預計視窗＋「請接著填寫」toast；測試回報已從 DB 清除；console 乾淨。

---

## 2026-07-08 — 具體產出項目重新定位（區間視窗 → 專案層級專屬視窗）

**需求釐清**：具體產出項目＝專案「**全部執行完畢後**」的最終交付成果（專案層級），
原本放在 TaskModal（進度區間的回報視窗）內會被誤解為該區間的產出。資料模型本來就存 `Projects.Deliverable`，不用改 DB。

**修正**（`ClientApp/app.jsx`，已 `npm run build`；後端與 DB 不變）：
1. TaskModal 內的產出卡片整段移除（含 deliverable state 與 onSaveDeliverable prop）。
2. 甘特圖專案列名稱旁新增 🎯 小圖示入口（已填=實色＋title 預覽內容；未填=淡色），點擊開新的 `DeliverableModal`。
3. `DeliverableModal`（琥珀色標題列，顯示專案名與負責人）：說明文字強調「全部執行完畢後預計交付的具體成果，
   非單週或單一區間的產出」；負責人本人與主管可編輯（儲存後自動關閉），其他成員唯讀（僅「關閉」）。
4. 甘特 tooltip 的「🎯 產出」行保留。

**驗證**：每列都有 🎯；裕隆編輯自己專案→儲存→圖示轉實色且 title 帶內容；開玉婷的專案=唯讀；
TaskModal 已無產出卡片；測試寫入的 Deliverable 已從 DB 清除（使用者自填的「測試用」保留）；console 乾淨。

---

## 2026-07-09 — 企業內網樣式缺失修復（快取破壞＋標題列行內樣式）

**問題**：企業內網部署後「即將到期清單」等新面板白底白字（要反白才看得到）。
根因：`index.html` 引用 `app.css`/`app.js` 無版本號 → IIS/瀏覽器快取**舊版 app.css**，
新版 app.js 用到的新 Tailwind class（如 `bg-orange-600`）在舊 CSS 不存在。
本機編譯的 app.css 其實都有這些 class；不是 Tailwind 建置問題。使用者不接受 CDN 方案（內網可能斷線）。

**修正**：
1. **快取破壞**：新增 `scripts/stamp-assets.js`（純 Node、無新套件），`npm run build` 最後自動把
   index.html 的 `app.css`/`app.js` 引用改成 `?v=yyyyMMddHHmm`。只在開發機執行，內網主機不需 npm/node。
2. **行內樣式保險**：彈窗/面板彩色標題列全部改 `style={{backgroundColor}}`＋標題字 inline white：
   DeadlinePanel(#EA580C)、DeliverableModal(#F59E0B)、WeeklyPlanModal(#6366F1)、ExtraNoteModal(#F97316)、
   兩個唯讀版(#475569)、ConfirmModal(#DC2626)。TaskModal/各 NAVY 面板原本就是行內樣式。
   已列入 CLAUDE.md UI 慣例：新 Modal 的彩色標題列一律行內樣式。

**驗證**：index.html 兩處引用帶 `?v=202607091422`；瀏覽器實際以版本參數載入；
模擬最壞情況（disable stylesheet）標題列仍橘底白字可讀；console 乾淨。

---

## 2026-07-09 — 視覺重構：範本 B 高對比大字 ＋ 年度總覽模式

**需求**：老闆反映配色不夠黑、看得吃力（年長者視覺友善）；且希望一個版面不需捲軸看到整年度規劃。
與使用者確認採「範本 B＋年度總覽」（曾提供 A 高對比微調／B 大字舒適／C 米白護眼三範本）。

**修正**（`ClientApp/app.jsx`，已 `npm run build`；後端與 DB 不變）：

1. **範本 B 配色與字級（週檢視）**
   - 專案名稱：`text-[11px] font-medium text-slate-700` → **近全黑 `text-slate-900` + `font-semibold`**，
     寬鬆 15px／緊湊 13px／總覽 12.5px；**預設改為寬鬆模式**（isCompact 初始 false）。
   - STATUS_META 狀態色加深：有執行 green-500→**green-700**、Monitor sky-500→**sky-700**、未執行 slate-400→**slate-500**
     （白字在色塊上達 WCAG AA）；tag 文字 700→800；圖例色塊同步。
   - 分類欄 slate-600→slate-800+medium；No 欄 400→500；列分隔線 slate-200→300；
     甘特條文字 9/11px→10/12px、text-slate-700→900；計畫區間邊框 rgba(212,177,6,.7)→rgba(180,83,9,.75)。

2. **年度總覽模式（isOverview）** — 工具列「週檢視｜年度總覽」切換：
   - 實作核心：`table width:100%` + fixed layout，名稱單欄固定 240px、52 個週欄**自動均分剩餘寬度**
     （不用 JS 量測、隨視窗縮放自適應）→ **整年一頁、無水平捲軸**。
   - 總覽時：隱藏 No/分類欄與週數字表頭列（保留月份表頭）、列高 24px、條上不顯字（tooltip/點擊仍可用）、
     隱藏 拖曳把手/專案編輯鈕/＋新增專案/回到本週/緊湊切換（唯讀瀏覽視角）；群組列保留 項數+本週回報 摘要。
   - 條的位置本來就用百分比定位,兩模式共用同一渲染程式。

**驗證**：週檢視名稱 15px/600/#0F172A、有水平捲軸、52 週表頭與拖曳把手正常；
總覽模式 tableW==containerW（1600 與 695 寬皆無捲軸）、No 欄消失、12 月表頭、條上無字、點條仍開 TaskModal；
console 乾淨。

---

## 2026-07-09 — 投影友善強化（全域對比再提升）

**需求**：公司會議室以投影機開啟網頁，投影機亮度/色域打折,淡色元件在布幕上會消失。
評估「獨立投影模式開關」vs「全域強化」後選擇**全域強化**（淡色元件在一般螢幕也偏淡,一次改兩者受益,免多維護一個模式）。

**修正**（`ClientApp/app.jsx`，已 `npm run build`；後端與 DB 不變）：
1. `StatChip` 元件加 `border`、標籤文字移除 opacity-60 淡化、字級 10→11px；
   呼叫端配色 text 700→800＋邊框 400/500 級（有執行 green、Monitor sky、未執行 slate、未回報 yellow-500）。
2. 「⏰ 即將到期」按鈕 ring→實線 border-orange-500。
3. 類型篩選（a~e）未選取態：text-slate-400/border-200 → **text-slate-700/border-400**。
4. `PROJECT_TYPES` chip 邊框 300→400 級（yellow 用 500）、dot 400→500。
5. 深藍 header 半透明白字加濃：系統週數 60→85%、週月份 40→75%、身分/工號 50→80%。
6. 概況列：W28 標題 slate-800→900、「概況」400→600、「已回報」600→800；回報率軌道 slate-200→300、
   填色 500→600。
7. 週表頭：未來週文字 slate-400→500、過去週補 text-slate-700。
8. 「顯示 x/y 項」slate-400→600。

**驗證**：DOM 實測 StatChip 邊框 green-400/文字 green-800、類型鈕 slate-700、系統週數 85% 白、
計數 slate-600；截圖整體輪廓清晰；console 乾淨。

---

## 2026-07-10 — 2026 改 53 週、ESC 關窗、工具列不斷行

**使用者自行變更（先記錄）**：
1. **2026 年度改 53 週**：`01_schema_and_objects.sql`（ScheduleWeeks/Tasks 的 CHECK 由 1..52 改 1..53）、
   `02_seed_data.sql`（2026 週資料補到 W53，含 `2026,53,` 一列）皆已改；Sariel 開發 DB 的 2026 已是 53 週。
   ⚠ 註：使用者直接改了 01/02（原「01~03 不回改」規則的例外，本人已知並刻意為之）。
   ⚠ 註：其公司線上 DB 另把專案 EndWeek 由 52 改 53（資料調整），但 **Sariel 仍有 18 筆 Task EndWeek=52**、
   seed 未全面改——「W52→W53」屬各環境資料調整，非本 repo 全面套用。
2. **ESC 關閉最上層視窗**：使用者原本手改在**建置後的 `wwwroot/app.js`**（非原始碼），
   下次 `npm run build` 會被覆蓋遺失。**已將該邏輯移植進原始碼 `ClientApp/app.jsx`**（App 內 `closeTopModal`
   useCallback + window keydown capture-phase 監聽；`e.isComposing` 時略過避免中文組字誤關；
   關閉優先序：confirm→deliverable→editProject→interval→各面板→plan/extraNote→taskModal）。已重新 build 確認保留。

**本次一併修正**：
3. **工具列不斷行**（使用者要求「不要斷行」）：篩選/檢視工具列 `flex-wrap` → `flex-nowrap ... overflow-x-auto
   [&>*]:flex-shrink-0`；視窗夠寬單列呈現、過窄改水平捲動（子項不壓縮），不再折到第二行。
4. **週輸入上限動態化**：TaskModal／IntervalModal 四個週次 `<input>` 的 `max="52"` → `max={weeksTotal}`，
   配合 53 週（驗證本就用 weeksTotal，此為補齊 spinner 上限）。

**驗證**：build 後 wwwroot/app.js 含 closeTopModal×3；1400px 工具列單列高 48px 無捲軸、900px 改水平捲動不折行；
新增區間週 input max=53；ESC 關閉視窗成功；console 乾淨。

---

## 2026-07-10 — 成果清單檢視(MP)、看板個人視角、非專案事項可清空（3 項）

**資料庫**（遷移 `06_add_mp_saving.sql`，已在 Sariel 執行）
- `Projects.MpSaving NVARCHAR(100) NULL`（MP 人力節省,自由文字如「0.5 人/月」）。
- `usp_UpdateProjectDeliverable` 加 `@MpSaving` 參數（權限沿用:負責人本人或主管）；
  稽核 OldValue/NewValue 改為 `產出｜MP:xx` 合併格式（FieldName 仍為 'Deliverable',白話翻譯沿用）。

**後端**（`Program.cs`）：bootstrap projects 加 `mpSaving`；`/api/project/deliverable` 傳 `@MpSaving`；
`DeliverableReq` 加 `MpSaving`。

**前端**（`ClientApp/app.jsx`，已 `npm run build`）
1. **成果清單檢視**（主管瀏覽視角）：檢視切換改三段「週檢視｜年度總覽｜成果清單」
   （`viewMode` state 取代原 isOverview boolean,isOverview/isResults 為衍生值）。
   `ResultsView`：無甘特圖,欄位 No/分類/類型/專案名稱/🎯具體成果/MP,成果與 MP **直接顯示在欄位**
   （不用滑鼠停留）;🎯 圖示行為不變(點擊開 DeliverableModal);群組列顯示「成果已填 x/y」;
   收合沿用 collapsedOwners;搜尋/類型/成員篩選皆有效。
   `DeliverableModal` 加「MP（人力節省，選填）」輸入框,唯讀視角也顯示 MP。
2. **團隊工作看板個人視角**（`WeeklyReportDashboard` 加 role/currentUser props）：
   - 成員預設「只看我自己」（checkbox 可切回全部成員）;主管預設全部。
   - 每張成員卡標題列新增「📋 複製週報」= 只複製該成員內容（格式同團隊週報單人段落,含個人標題）。
   - 成員卡可點標題展開/收合（唯 onlyMe 時不收合）;「展開全部/收合全部」按鈕（瀏覽全部時顯示）。
   - 原「複製週報文字」改名「複製團隊週報」,複製回饋 per-target（copied='team'|成員名）。
3. **非專案事項可清空**：ExtraNoteModal 移除「必填」驗證（此欄為選填）;
   內容清空且原本有資料時按鈕變灰色「清空內容」;儲存空字串=清除,toast 顯示「已清空」;
   按鈕狀態自動回「未填寫」。DB 不需改（Note NOT NULL 存空字串,前端 falsy 判定一致）。
   註:「下週預計」仍為強制項目,未改。

**驗證**（實際 DB 全流程）：成果清單表頭/無甘特欄/群組摘要「成果已填 0/15」;🎯 填成果+MP 後清單直接顯示;
看板成員預設只看自己(1 張卡)、個人複製有「已複製」回饋、切全部 6 張卡、收合全部生效、團隊複製鈕保留;
非專案 填寫→已填寫→清空(按鈕變「清空內容」)→toast「已清空」→回未填寫;測試資料已清除;console 乾淨。

---

## 2026-07-11 — 版面收納重構（回報中心／工具列緊湊化／概況降噪／斑馬紋）

**需求**：版面太擠、捲軸太多。與使用者確認方案（類型晶片維持全名、按鈕整體縮小）後動工。

**修正**（`ClientApp/app.jsx`，已 `npm run build`；後端與 DB 不變）：
1. **本週回報中心**：成員 header 三顆長按鈕（本週待回報/非專案事項/下週預計）合併為一顆
   「📋 本週回報中心」＋紅點總數（未回報任務＋未填下週預計;非專案為選填不計入）。
   `PendingPanel` 重構為回報中心：待回報任務清單 ＋ 兩個常駐入口「下週預計(必填,紅/綠狀態章)」
   「非專案事項(選填)」，各自可點開填寫視窗（onFillPlan/onFillExtra,一律切回本週）。
   ⚠ 行為變更:成員檢視歷史週時不再有 header 按鈕直接看該週非專案/下週預計（可從團隊總結看板看）。
2. **工具列緊湊化**：類型晶片**全名保留**,內距 px-2 py-1→px-1.5 py-0.5;整列字級 12→11px;
   各按鈕 py-1.5→py-1;「回到本週 W28」→「回到本週」(title 保留週次);搜尋框 w-52→w-40(聚焦展開 w-52);
   容器 py-2→py-1.5。**實測 1366px 單列放下、工具列捲軸消失**（nowrap 機制保留）。
3. **概況列降噪**：列高 py-2→py-1.5;Header 所有功能鈕同步縮小（px-3 py-1.5 text-xs→px-2.5 py-1 text-[11px]）。
   圖例原改為「?」滑鼠提示,**使用者反映不直觀,改回常駐可見**：右側精簡圖例條（淡框容器整理成一組,
   標籤精簡:計畫/有執行/Monitor/未執行/⏰到期/❗待回報,各項 title 補完整說明;1366px 無捲軸）。
4. **甘特閱讀性**：專案列斑馬紋（偶數列 bg-slate-50,**sticky 欄位同步上色**避免水平捲動露白;
   hover 統一 slate-100）;群組列頂部 border-t-4 border-t-slate-200 加強成員分界。

**驗證**（1366×800）：header 功能鈕剩 2 顆（回報中心紅點 6＋團隊總結）;工具列 scrollW==clientW 無捲軸;
「?」圖例提示存在、舊圖例移除;斑馬紋 row1 白/row2 slate-50;回報中心面板含 待回報任務(5)＋下週預計(必填)
＋非專案(選填)且各自可開啟填寫視窗;console 乾淨。

---

## 2026-07-11 — 回報中心 UX 重構（進度條＋統一清單，方案 C）

**需求**：「本週回報中心」原設計：任務全部打卡後顯示 🎉「本週任務已全數回報」，
使用者看到慶祝訊號後易誤關面板，未填「下週預計（必填）」即離開。

**UX 問題分析**（與使用者討論後確認）：
- 🎉 慶祝感太強，傳達「已完成」訊號但下週預計未填。
- 「每週固定回報」區塊置於下方，視覺地位被稀釋（與選填並列）。
- 紅點數（任務＋下週預計）與面板完成訊號矛盾。

**修正（方案 C）**（`ClientApp/app.jsx`，已 `npm run build`；後端與 DB 不變）：
1. **整體進度條**：面板頂部顯示「N / M 項完成」進度條（indigo 填色，完成後轉 green）；
   分母 = 本週所有任務數 + 1（下週預計）；「填完下週預計即可達成 🎉」提示。
2. **🎉 條件正確化**：只有任務全部完成 **且** 下週預計已填，進度條才轉綠並顯示 🎉，
   避免「任務打卡完就誤以為全部做完」。
3. **已完成任務顯示**：清單改為顯示所有本週任務（`allMyTasks` prop），
   已回報任務 = 綠色圓形打勾＋「已回報」綠色 badge（可點開查看）；
   待回報任務 = 橘黃圓形＋「回報 ›」按鈕（與原行為相同）。
4. **每週必填獨立分區**：下週預計移至獨立「⚠ 每週必填」分區（未填：紅色標頭＋紅底＋紅色粗左邊框；
   已填：綠色標頭＋綠底）；「選填」分區（非專案事項）另外獨立，顏色低調不干擾。
5. **PendingPanel** 新增 `allMyTasks` prop，由呼叫端以 `useMemo` 計算本週全部任務傳入。

**驗證**：進度條在「3 任務完成、下週未填」時顯示 3/4 × 75%；填完下週預計後跳至 4/4 綠色 + 🎉；
---

## 2026-07-11 — 表格瀏覽體驗：鍵盤快捷鍵快速導航（Keyboard & Focus Navigation）

**需求**：高階主管會議投影簡報或日常操作時，全年 52/53 週的甘特表較寬，需不改動任何視覺色彩與介面風格，提供滑順快捷的鍵盤操控。

**修正**（`ClientApp/app.jsx`，已 `npm run build`；後端與 DB 不變）：
1. **整合全域鍵盤導航事件**：將原先僅監聽 `ESC` 關閉彈窗的 `useEffect` 擴展為全域鍵盤導航監聽器；
   - 自動判斷：當無任何彈窗開啟（`!isAnyModalOpen`）、且非於表單輸入欄位聚焦（非 `INPUT`、`TEXTAREA`、`SELECT` 及非中文輸入法組字 `isComposing`）時啟用。
2. **一鍵定位本週 (`Home` 或 `H`)**：按下 `Home` 鍵或單鍵 `H` 時，觸發 `goToCurrentWeek()`，強制將當前週切回今天的實際週並將甘特圖平滑置中。
3. **左右箭平移月份 (`←` / `→`)**：在週檢視模式下，按 `←` / `→` 方向鍵可左右平滑捲動 4 週（約 1 個月）；搭配 `Shift + ←` / `Shift + →` 可精細微調平移 1 週。
4. **發現性增強**：「回到本週」按鈕的 `title` 提示同步更新說明快捷鍵。

---

## 2026-07-11 — 回報中心體驗：完成回報的明確回饋與收尾導引（Completion Loop）

**需求**：成員在「本週回報中心」填寫進度後，原先僅依靠上方進度條呈現，面板下方缺乏明確的收尾動作與完成回饋按鈕。

**修正**（`ClientApp/app.jsx`，已 `npm run build`；後端與 DB 不變）：
1. **新增底部 Completion Loop 操作列**：在 `PendingPanel` 底部固定放置收尾導引按鈕區塊。
2. **達成 100% 回報的滿分鼓勵與收尾**：當成員的本週任務與「每週必填（下週預計）」全數完成時（`allDone = true`），底部顯現醒目綠色按鈕 **「🎉 本週回報已全數完成！返回總表 ›」**，點擊後即安心收尾關閉面板。
3. **未全數完成時的狀態回饋**：當仍有項目待辦時，顯示灰色按鈕 **「暫存離開（尚有未完項目）」**，清楚告知目前打卡紀錄已保存，隨時可返回繼續填寫。

**驗證**：進入回報中心時下方可清晰看到收尾按鈕；所有任務打卡並填妥下週預計後，按鈕轉為綠色「本週回報已全數完成！返回總表 ›」；點擊後順暢關閉面板回到主畫面；編譯零錯誤。

---

## 2026-07-11 — 會議室專用：沉浸簡報模式（Presentation / Focus Mode）

**需求**：高階主管在企業內部簡報展示專案總表時，希望能一鍵最大化呈現專案與甘特圖資訊，消除無關的裝飾與次要操作列高。

**修正**（`ClientApp/app.jsx`，已 `npm run build`；後端與 DB 不變）：
1. **新增簡報模式狀態與入口**：在 `App` 新增 `isPresentationMode`，於工具列「回到本週」旁新增金黃底色亮點按鈕 **「🖥️ 簡報模式」**。
2. **沉浸版面縮減與自動對齊**：進入簡報模式瞬間自動執行 `goToCurrentWeek()` 置中當週 W28；並隱藏次要的統計概況列（多出約 60px 垂直可視高度，投影幕上可額外多展示 3~4 列專案）；最上層 Header 改為緊湊 38px 高度的「會議投影簡報模式」導航列。
3. **靈活出入與快速鍵支援**：支援鍵盤快捷鍵 **`P`** 平滑進出簡報模式；按 **`ESC`**（當無視窗彈窗時）立即退出回到一般模式。

**狀態**：經使用者實測評估後表示簡報模式幫助有限，已於同日依指示完全移除該功能與相關按鈕／快速鍵。

## 2026-07-11 — 主管進度調補與歷史週次打卡功能（Manager Retroactive Check-in）

**需求**：在企業實務中，成員可能因公請假或出差錯過當週打卡時間，或是歷史進度需主管核定調補。開放主管（Manager）對計畫期間內任務的歷史週次進行補登與覆核，同時維持成員當週打卡紀律。

**後端修正**（`Program.cs`，已 `dotnet build` 驗證成功）：
- 修改 `/api/bootstrap` 中的 `taskLogs` 查詢，`LEFT JOIN dbo.Users u ON u.UserId = w.ReportedByUserId` 並將 `reporter` 與 `reporterRole` 回傳至 `taskLogs` 字典中，識別每一筆打卡紀錄是否是由主管所進行核實或補登。

**前端修正**（`ClientApp/app.jsx`，已 `npm run build` 驗證成功）：
1. **主管不受歷史週次限制（canClockIn）**：當登入者為主管（`role === 'manager'`）且檢視計畫區間內（`isActiveThisWeek`）的任一週次時，可為任一位成員的專案任務啟用回報與調整權限。
2. **主管特權回報模式提示與雙重調整**：當主管進入歷史或當週進度回報面板時，顯示專屬金色提示列 **「👑 主管特權模式：正在為成員核實或調補 Wxx 執行紀錄」**；且回報面板下方直接整合「主管評分調整（SCORE_OPTIONS）」，主管可一次搞定狀態、說明與評分。
3. **甘特表視覺化「補」徽章與 Tooltip 溯源**：凡是由主管送出或補登之打卡儲存格（`reporterRole === 'manager'`），該格右緣顯示高對比金黃色 **「補」** 字小徽章；游標懸停 Tooltip 明確標註 **「✏️（由主管 [姓名] 核實補登）」**，完整區分個人當週準時打卡與主管事後覆核紀錄。

---

## 2026-07-11 — 主管全年度歷史進度補登授權開關（Global Retroactive Check-in Toggle）

**需求**：因應企業天然災害（如颱風假）、連續假期延後開工或年度/季度大查核補齊資料的需求，避免將補登範圍寫死（如僅限上一週）。建立由主管控制的全域通用授權開關，開啟時全體同仁皆可對今年度「本週之前」的所有歷史週次進行打卡與補充。

**資料庫與後端修正**（`01_schema_and_objects.sql`；遷移腳本 `07_add_app_settings.sql`；`Program.cs`）：
- 新增 `dbo.AppSettings` 系統設定表（主鍵 `KeyName`、值 `Value`）與儲存程序 `dbo.usp_SetAppSetting`，並預設初始化 `AllowRetroCheckin='false'`。
- 新增 API 端點 `POST /api/settings/retro-checkin` 供主管遠端切換開關設定，並將變更完整記錄於 `AuditLog`。
- `/api/bootstrap` 啟動時一併讀取並回傳 `allowRetroCheckin` 狀態。

**前端修正**（`ClientApp/app.jsx`，已 `npm run build`）：
1. **頂部導航開關按鈕**：主管視角下在頂部工具列新增 **「🔓 開放成員歷史補登 (ON)」 / 「🔒 僅限當週打卡」** 切換按鈕。
2. **全域豁免期橫幅提示**：當開關開啟時，畫面上方呈現醒目的琥珀金公告列，提示全員目前已開啟歷史進度豁免期，主管亦可於橫幅一鍵快速關閉。
3. **全面解鎖成員歷史回報**：當 `allowRetroCheckin === true` 且於檢視本週以前的歷史週次（`currentWeek <= todayWeek`）時，成員可自由對打卡視窗、額外工作說明以及下週預計工作進行編輯與補齊。

---

## 2026-07-11 — 建立資料庫增量升級標準規範 (`old_sql/06_upgrade_to_current.sql`)

- **資料庫不可變更原則**：因公司內部已使用 `old_sql` 目錄下的 `01 ~ 05` 腳本建置正式資料表且成員已在線填寫與更新狀態，**絕對不可刪除或修改 `01 ~ 05` 的 SQL 檔案與既有結構**。
- **統一集中異動點**：凡自 `01 ~ 05` 架構之後所需補齊的所有 DB 修改（例如新增 `Projects.MpSaving` 欄位、建立 `dbo.AppSettings` 設定表、預存程序更新及放寬週次約束），皆完整彙整與維護於 **`old_sql\06_upgrade_to_current.sql`**，且維持等冪相容。

---

## 2026-07-11 — 甘特圖進度條純淨化顯示調整

- 依指示調整甘特圖打卡儲存格（`ClientApp/app.jsx`）：進度條區間內**不再顯示任何額外的補登文字與標記（「補」徽章）**，確保進度條區間**純粹僅顯示任務名稱**，保持版面乾淨與視覺一致；主管核實紀錄仍可透過游標懸停 Tooltip 查看溯源。
- **極簡底部進度軌跡線 (Bottom Progress Ribbon)**：為避免傳統滿格打卡色塊遮擋黃色排程區間與字體，將打卡狀態改為**進度條最底端 2.5px 高度的柔和底線軌跡**；當檢視到「當週時間紅線處」時，自動增高為 4.5px 並呈現焦點狀態，達到文字清晰度與歷史稽核能見度的完美平衡。

---

## 2026-07-11 — 成果清單 (isResults) 與主管進度調補登完整重構復原

- **頂部導覽按鈕三模式切換**：在導覽列提供「週檢視 (`isOverview=false, isResults=false`)」、「年度總覽 (`isOverview=true`)」與「🎯 成果清單 (`isResults=true`)」。
- **成果清單 (ResultsView)**：
  - 切換至「成果清單」時，頂部狀態列改為專屬的 **「年度成果與 MP 效益清單」** 概況指標（顯示已填報產出專案數與填報 MP 節省數）。
  - 下方主畫面顯示完整專案清單，包含專案名稱、負責人、分類與類型、預計交付成果 (`Deliverable`)、MP 人力節省效益 (`MpSaving`) 及編輯操作按鈕。
- **歷史補登與主管特權模式**：
  - 導覽列主管專屬切換按鈕 `🔓 開放成員歷史補登 (ON)` / `🔒 僅限當週打卡`。開啟時，畫面上方出現豁免期公告橫幅，所有成員可對當週以前的所有歷史週次進行任務與非專案紀錄回報。
  - 主管開啟任何成員或歷史週次進度回報視窗 (`TaskModal`) 時，顯示 `👑 主管特權模式：正在為成員核實或調補 Wxx 執行紀錄` 提示，並整合「主管評分微調 (0~3 分)」及儲存功能。

---

## 2026-07-11 — 方案 C：整合式「本週回報中心 (Weekly Check-in Center)」版面復原

- **導覽列按鈕升級**：成員視角右上方顯示金黃亮眼的 **「📋 本週回報中心」** 按鈕，並標示未回報數量紅點標籤。
- **一站式整合回報面板 (PendingPanel)**：
  - **表頭進度統計**：清晰展示當週綜合回報進度條 `已完成 / 總數 (百分比)`。
  - **每週必填項目**：採用警示色塊區分「🔴 每週必填：下週預計執行工作」（粉紅底＋紅側邊框或完成綠色勾勾），點擊即填。
  - **雙軌打卡任務檢閱**：同時展示「🔵 待打卡任務」與「🟢 已完成打卡任務」，成員不僅可一鍵回報未打卡項目，更能隨時點擊修改已打卡紀錄。
  - **Completion Loop 底部收尾**：當所有打卡與下週預計皆全數完成時，面板底部自動顯現綠色慶祝按鈕 **「🎉 本週回報已全數完成！返回總表 ›」**；未完工時則顯示「暫存離開（尚有 N 項待完成）」。



- **ServiceCenter → Gantt 更名**：專案由舊 ServiceCenter App 改造，所有 ServiceCenter 字樣改為 Gantt。
- **修正 Visual Studio「專案已卸載」**：`Gantt.sln` 原指向 legacy 子資料夾 `Gantt\Gantt.csproj`，改指向根目錄 `Gantt.csproj`。
- **清除瀏覽器 console 警告**：favicon 404、Tailwind CDN、in-browser Babel、Tracking Prevention
  → 改為預先編譯（Babel CLI + Tailwind CLI）、React/ReactDOM 本地化於 `wwwroot/lib/`。

---

## 2026-07-11 — 回報入口再合併＋工具列不斷行緊湊化（方案 A+B）

**背景**：使用者自行迭代過 app.jsx（回報中心面板改為「方案C」設計：完成度進度條＋必填區＋待回報＋已完成清單；
header 又拆回三顆按鈕；工具列改回 flex-wrap 導致「展開/收合」斷行；新增主管「歷史補登」開關）。
本次依使用者核可的 A+B 方案修正（C 概況列去重複未核可、未做）。

**A. 回報入口合併**（保留使用者的方案C面板設計）
- header 移除「非專案事項」「下週預計」兩顆獨立按鈕，成員只剩「📋 本週回報中心」＋「📊 團隊總結」。
- PendingPanel 區塊1改名「每週固定回報項目」，於下週預計卡下方新增「📝 非專案事項」卡
  （選填：灰章「選填 · 未填寫」/綠章「✓ 已填寫完成」，不計入完成度與紅點；onFillExtra 開 ExtraNoteModal）。
- 歷史週檢視非專案/下週預計改由團隊總結看板（與先前合併版同取捨）。

**B. 工具列不斷行＋緊湊化**
- flex-wrap → flex-nowrap + overflow-x-auto + [&>*]:flex-shrink-0（恢復不斷行慣例）；gap-2→1.5；py-2→1.5；字級 12→11px。
- 各控件 py-1.5→py-1；類型晶片(全名保留) px-2 py-1→px-1.5 py-0.5；搜尋框 w-52→w-44(聚焦 w-52)；
  「回到本週 W28」→「回到本週」；主管「🔓 開放成員歷史補登 (ON)/🔒 僅限當週打卡」→「🔓 補登 ON/🔒 僅限當週」
  （完整說明放 title；開啟時另有琥珀警示列）；「展開全部/收合全部」→「展開/收合」(title 補全名)。

**驗證**（1366×800）：成員 header 剩 2 顆功能鈕；回報中心含 完成度進度條＋下週預計(必填)＋非專案(選填)卡
且可開啟填寫視窗；成員/主管工具列皆 scrollW==clientW 無捲軸不斷行；console 乾淨。
（preview 截圖工具逾時，以 DOM 驗證完成。）

---

## 2026-07-11 — 概況列圖例去重複（方案 C）

**修正**（`ClientApp/app.jsx`，已 `npm run build`；後端與 DB 不變）：
- 圖例移除 `hidden xl:flex`（窄螢幕會整組消失，違反「圖例必須常駐可見」原則）→ 常駐顯示。
- 精簡標籤（計畫區間→計畫）＋淡框容器整理成一組；各項 title 補完整說明。
- **移除圖例中的「⏰ 即將到期」**（同列左側已有「⏰ 即將到期 N ›」按鈕，避免重複出現）；補上缺的「❗待回報」。

**驗證**：1366px 概況列無捲軸、圖例含「計畫/有執行/Monitor/未執行/❗待回報」且無「即將到期」重複；
1024px 圖例仍可見（列改水平捲動）；console 乾淨。

---

## 2026-07-11 — 團隊總結看板依角色區分顯示與 Checkbox 篩選改版（WeeklyReportDashboard 改版）

**需求**：
1. 成員登入後預設勾選「只看我的週報」（類似只看我的專案 Checkbox 風格），取消勾選則顯示團隊所有人折疊後的週報（支援全部展開/收合）。
2. 主管不需寫週報，登入後不用 checkbox，預設直接看全體成員折疊簡報（支援全部展開/收合）。
3. 每個團隊成員卡片標題列右側常駐獨立「📋 複製週報」按鈕，方便隨時複製個人格式化週報。

**修正**（`ClientApp/app.jsx`，已 `npm run build`；後端與 DB 不變）：
1. **角色感知與 Checkbox 篩選**：`WeeklyReportDashboard` 使用 `onlyMine` state 控制。成員預設勾選 `onlyMine = true`（僅顯示個人卡片且展開）；主管（`role === 'manager'`）不顯示 Checkbox，預設查看全體團隊。
2. **主管與團隊折疊視角**：取消勾選或主管瀏覽時，卡片預設折疊（`expandedUsers` 空 Set），標題列右側顯示摘要標籤（✅ 有執行數 / 👁️ Monitor / ❗ 待回報 / 📝 非專案 / 📅 下週預計）；點擊可展開該名成員卡片。
3. **全部展開 / 收合**：團隊模式下拉工具列提供「展開全部 | 收合全部」操作按鈕。
4. **個別成員常駐複製**：每張卡片標題列最右側常駐「📋 複製週報」按鈕，可複製該成員純文字週報（標題為「【MSD W{XX} 週報 — {成員名}】」）；頂部仍有全體或個人匯出複製功能。

**驗證**：成員登入預設勾選顯示個人週報，取消勾選顯示全隊折疊；主管登入預設全隊折疊；個別成員複製按鈕常駐且運作正確；編譯零錯誤。

---

## 2026-07-11 — 全域鍵盤導航復原（方向鍵 + Home/H + ESC）

**需求**：先前實作的全域鍵盤導航（方向鍵平移甘特圖、Home/H 回本週、ESC 關閉最上層視窗）在後續修改中
被刪除，需要加回。

**修正**（`ClientApp/app.jsx`，已 `npm run build`；後端與 DB 不變）：
1. **全域 `useEffect` 鍵盤監聽器**（capture phase）：
   - 自動判斷：中文組字 `isComposing` → 略過；焦點在 `INPUT`/`TEXTAREA`/`SELECT` → 略過。
   - `Escape`：關閉最上層 Modal/Panel（優先序：confirmInfo > selectedTaskInfo > deliverableProj >
     editingProject > addingInterval > showExtraNoteModal > showWeeklyPlanModal > showWeeklyReport >
     showPendingPanel > showAuditPanel > showMemberPanel > showDeadlinePanel）。
   - 導航鍵（任何 Modal 開啟時不觸發）：
     - `Home` 或 `H`：`goToCurrentWeek()` 回到本週並置中。
     - `ArrowLeft`：平滑捲動左移 4 週（約 1 月）。
     - `ArrowRight`：平滑捲動右移 4 週。
     - `Shift+ArrowLeft`/`Shift+ArrowRight`：微調平移 1 週。
   - 僅在週檢視模式下生效（`isOverview`/`isResults` 時方向鍵跳過，但 Home/H 仍可用）。

**驗證**：在主甘特圖無視窗開啟時按 ←/→ 可捲動、Shift 微調、Home 回本週、ESC 關閉視窗；
焦點在搜尋框時不觸發；編譯零錯誤。

---

## 2026-07-11 — 務實 UI/UX 細節精煉與視覺優化

**需求**：針對企業內部營運系統特性，在不更動熟悉配色與架構的原則下，提升大表跨欄閱讀體驗與視覺秩序。

**修正**（`ClientApp/app.jsx`，已 `npm run build`；後端與 DB 不變）：
1. **全寬聯動懸停列 (Connected Row Hover)**：當滑鼠停留在專案資料列 `<tr>` 上時，同步套用 `hover:bg-blue-50/45` 並聯動左側 3 個 Sticky 儲存格 (`group-hover/row:bg-blue-50/70`)，橫越 52 週追蹤同一專案時輕鬆對準不跳列。
2. **打卡進度實心軌道加厚**：把 45 度金黃斜紋條底下的打卡進度線由原先的 2.5px 提高至 4px (本週 5px)，完工落實視覺份量更扎實。
3. **過濾與控制區工具列細線分組**：在搜尋過濾列與視角開關之間插入極細灰色垂直分隔線 (`h-5 w-px bg-slate-300/80`)，將工具切分為邏輯明確的三大模組。

**驗證**：滑鼠移入任何列均同步柔和高亮全欄寬度；打卡實心進度清晰飽滿；編譯零錯誤。

---

## 2026-07-11 — 成果清單面板（ResultsView）單行列極簡矩陣與主管篩選排序改版

**需求**：使用者指出成果清單中一項專案因為文字與負責人堆疊變成兩行（行高過高），要求「一項專案維持一項資料列（單行）」的試算表模式，且增強主管一眼審視專案實作貢獻與 MP 人力節省意義。

**修正**（`ClientApp/app.jsx`，已 `npm run build`；後端與 DB 不變）：
1. **嚴格單列單行矩陣 (`h-11 = 44px` 固定行高)**：拆分表頭為 `No` | `負責人` (`w-28`) | `專案名稱` | `分類/類型` | `預計交付具體產出成果` | `MP 人力節省效益` | `操作` 共 7 欄；文字換行一律轉為水平空格並套用 `truncate`，保證一案一行絕對不換列。
2. **主管貢獻快覽過濾標籤 (`filterMode`)**：新增 `[ 全部專案 ]`、`[ 💡 具備 MP 效益 ]`、`[ 🎯 有具體產出 ]`、`[ ⚠️ 待補充效益 ]` 四大狀態快覽按鈕。
3. **一鍵 MP 效益排序 (`sortByMp`)**：支援將專案依據 MP 節省數值由大到小排序，一秒定位最高價值專案。

**驗證**：畫面全部維護單一行高順暢無比；篩選與排序功能準確，編譯零錯誤。

---

## 2026-07-11 — 修正甘特圖水平捲動時與左側專案欄位重疊/穿透問題

**問題原因**：先前新增的全寬懸停列設定使用半透明色 (`group-hover/row:bg-blue-50/70`)，且部分 Sticky 儲存格未設定絕對的 `minWidth` / `maxWidth` 與 100% 純實色背景，導致橫向捲動時右側甘特計畫條 (`z-10`) 透出或重疊於左側專案基本資訊欄上方。

**修正**（`ClientApp/app.jsx`，已 `npm run build`）：
1. **嚴格純實色背景 (100% Opaque Solid Background)**：將所有 Sticky 儲存格 (`thead th`, `group.owner tr td`, `proj tr td`) 的預設背景設為 100% 不透明純色 (`bg-white` / `#F1F5F9` / `#EFF6FF`)，且懸停背景改用純色 `#EFF6FF` (`group-hover/row:bg-[#EFF6FF]`)，完全排除任何 alpha 透明度穿透。
2. **鎖死 Sticky 欄位絕對寬度與邊界陰影**：明確為 `No` (`28px`)、`分類` (`42px`)、`專案名稱` (`420px`/`240px`) 等儲存格補齊 `style={{ width, minWidth, maxWidth, left }}`，並在最右側專案名稱欄加上右側投影 `shadow-[4px_0_8px_rgba(0,0,0,0.08)]`，確保甘特圖捲動時被左側欄位完全覆蓋與遮蔽。

**驗證**：橫向左右捲動甘特圖時，左側 3 欄專案基本資訊維持 100% 穩固純實遮蔽，無任何甘特條穿透或重疊；編譯零錯誤。

---

## 2026-07-11 — 修正編輯「具體產出與 MP 效益」儲存失敗 (error 1934 QUOTED_IDENTIFIER)

**問題原因**：使用者在彈窗中編輯「具體產出與 MP 效益」並點擊儲存時出現 `❌ 儲存失敗：伺服器處理失敗`。經查 SQL Server 資料庫 `Sariel` 上的預存程序 `dbo.usp_UpdateProjectDeliverable` 建立時其中繼資料 `uses_quoted_identifier = 0` (`QUOTED_IDENTIFIER OFF`)，當執行 `UPDATE dbo.Projects` 時遭 SQL Server 阻擋（錯誤代碼 1934）。

**修正**：
1. 建立並在資料庫 `Sariel` 執行 SQL 腳本重建 `dbo.usp_UpdateProjectDeliverable` 預存程序，於定義前嚴格加入：
   ```sql
   SET ANSI_NULLS ON
   GO
   SET QUOTED_IDENTIFIER ON
   GO
   CREATE OR ALTER PROCEDURE dbo.usp_UpdateProjectDeliverable ...
   ```
2. 同步在升級腳本 `06_upgrade_to_current.sql` 中加入 `SET QUOTED_IDENTIFIER ON`，確保未來環境部署皆預設啟用。

**驗證**：執行 `sp_helptext` 與 `EXEC dbo.usp_UpdateProjectDeliverable` 實測，順利寫入 `Projects.Deliverable` 與 `Projects.MpSaving` 並回傳成功。

---

## 2026-07-11 — 成果清單欄位順序對齊甘特圖與全欄位多維度點擊排序 (`ResultsView`)

**需求**：將「成果清單 (`isResults`)」表格的欄位顯示順序嚴格對齊前頁甘特圖專案列表的順序，並為每個表頭加上可自由點擊排序的功能。

**實作**（`ClientApp/app.jsx`，已 `npm run build`）：
1. **統一順序對齊與拆分雙欄**：將原先「分類 / 類型」獨立拆分為兩欄：`No` ➔ `分類` (`FDC`) ➔ `類型` (`[ E ]`) ➔ `專案名稱` (`12M porting`) ➔ `負責人` (`👤 裕隆`) ➔ `🎯 預計交付具體產出成果` ➔ `💡 MP Saving` ➔ `操作`。
2. **嚴格不換列不折行保護 (`whitespace-nowrap truncate`)**：每一個 `<th>` 表頭與 `<td>` 資料儲存格全數加上 `whitespace-nowrap`，確保任何欄位文字均維持單橫行整齊閱讀，絕不斷行。
3. **統一命名與排序支援 (`sortConfig`)**：
   - 表頭呈現可互動指標 `▲`（升冪）、`▼`（降冪）、`↕`（未啟用），點擊同一欄位自動切換升冪 / 降冪 / 取消。
   - 將所有前端介面與彈窗標籤上的「MP 人力節省效益」統一正名為「MP Saving」。
   - 支援「分類 (`category`)」、「類型 (`type`)」、「專案名稱」、「負責人」、「具體產出」的中文 localeCompare 獨立排序，與「MP Saving」的數值型態 (`parseFloat`) 排序，並提供「✖ 清除排序」一鍵還原。

---

## 2026-07-11 — 角色切換登入視圖重置優化 (`handleLogin` / `handleLogout`)

**需求**：每次切換各角色登入時，避免停留在上一個使用者最後開啟的特殊視角（如年度總覽、成果清單或收合狀態），必須做到：
1. 預設開啟該成員或主管的「週檢視」（重置 `isOverview` 與 `isResults` 為 `false`，並切回本週 `todayWeek`）。
2. 若登入角色為「團隊成員 (`member`)」，預設顯示個人專案的「展開清單頁面」（`onlyMine = true`、`collapsedOwners = new Set()`）。
3. 若登入角色為「主管 (`manager`)」，預設為「週檢視全部成員展開的頁面清單」（`onlyMine = false`、`collapsedOwners = new Set()`）。

**實作**（`ClientApp/app.jsx`，已 `npm run build`）：
- 更新 `handleLogin` 與 `handleLogout`，每次登入或登出均完整重置視圖切換與收合狀態：
  - `setIsOverview(false); setIsResults(false);` // 自動切回標準週檢視

---

## 2026-07-11 — 成果清單 Executive Dashboard UI/UX 全面精煉與互動整合

**需求**：針對全螢幕成果清單版面，依據建議優化：
1. **建議 1（合體整合）**：將原本垂直分層的「頂部三大靜態 KPI 統計卡片」與「下層貢獻檢視按鈕列」二合一，整合為 **4 張互動式 KPI 統計篩選卡片（全部專案 / 具備 MP Saving / 有具體產出成果 / 待補充產出效益）**，點擊卡片即直接過濾下方清單，大幅節省垂直空間。
2. **建議 3（空白欄位視覺降噪）**：將原本冗長的 `（尚未填寫具體產出成果）` 與 `--` 替換為極簡優雅的單破折號 `—`，使未填寫與有產出內容在掃描時對比更鮮明亮眼。
3. **建議 4（頂部細節術語 100% 統一）**：將頁首右上方膠囊標籤由 `填報 MP 節省` 統一改為 `💡 MP Saving`。

**實作**（`ClientApp/app.jsx`，已 `npm run build` 版號 `v=202607111242`）。

---

## 2026-07-11 — 重點關注專案標記與快篩功能（Starred / Key Projects）

**需求**：新增重點關注標記 (`tag`) 功能，主管可標記專案並一鍵快篩直接顯示重點關注項目。

**實作**（`ClientApp/app.jsx`，已 `npm run build` 版號 `v=202607111259`）：
1. **權限與頁面隔離（專屬成果清單與主管權限）**：
   - 僅在 **「成果清單 (ResultsView)」** 頁面顯示重點關注項目與篩選卡片；主甘特圖檢視完全移除了標記與篩選按鈕，保持甘特排程頁面簡潔無雜訊。
   - 僅當登入角色為 **主管 (`role === 'manager'`)** 時，才顯示星號調動按鈕 (`★` / `☆`) 供調整；成員與非主管僅能檢視標記結果。
2. **頂部 5 大 KPI 篩選卡片**：
   - 成果清單頂部設有專屬 **「⭐ 重點關注項目 (N 案)」** 卡片，點擊即可篩選出主管重點標記之戰略專案。
3. **成果清單最佳化版面配置、純文字與自動換行**（版號 `v=202607111324`）：
   - **收斂左右舒適留白**：主容器設定為 `max-w-[1560px] w-full px-8`，既有寬敞視界又維持兩側舒適呼吸空間。
   - **專案名稱寬度恰到好處 (`420px`)**：將 `專案名稱` 欄位微調為 **`w-[420px]`**，剛好能完整容納單行長名稱（如 `★ b.[2024QIT AAR版圖&邏輯修改] BKM定義查詢與maintain`），不再留下過多尾端空白。
   - **移除圖示保持專業純文字**：移除表頭與內容儲存格中不必要的圖示表情（`預計交付具體產出成果`、`MP Saving` 等），只保留專業簡潔的純文字。
   - **專案名稱與具體成果「自動換行完整顯示不截斷」**：移除了 `預計交付具體產出成果` 與 `專案名稱` 欄位的 `truncate` 單行限制，改為 **`whitespace-normal break-words leading-relaxed`**，長篇內容皆會自動換行呈現所有細節，主管可一目了然看完全部內容不需懸停 tooltip。

---

## 2026-07-11 — 操作順暢度五項優化（登入持久化/錯誤toast/防連點/ESC防護/刪除復原）

**背景**：UI/UX 檢視後使用者核可 1~5 全做。DB 異動依規則新增 `08_add_restore_procs.sql`（01~05 為既有基準、06/07 已存在）。

**資料庫**（遷移 `08_add_restore_procs.sql`，已在 Sariel 執行）
- `usp_RestoreProject`（IsDeleted=0，連同其 Tasks）、`usp_RestoreTask`（單一區間），皆寫 AuditLog(Action='RESTORE')。

**後端**（`Program.cs`）
- 新端點 `POST /api/project/restore`、`POST /api/task/restore`（沿用 Delete 的 request record）。
- audit-log 白話翻譯補 RESTORE（Project/Task 兩種）。

**前端**（`ClientApp/app.jsx`，已 `npm run build`）
1. **登入持久化**：handleLogin 寫 `localStorage('gantt_login')`、logout 清除；資料載入完成後自動還原
   （成員名單已無此人則清除紀錄）。重新整理/重開分頁不再被登出。
2. **Toast 升級**：state 改物件 {msg,isError,action}；訊息以 ❌ 開頭自動判定錯誤 → 停 6 秒＋紅框＋✕ 手動關閉；
   成功維持 2.5 秒；`opts.action={label,onClick}` 顯示琥珀色動作鈕（停 10 秒）。
3. **防連點**：TaskModal(儲存回報/儲存排程)、ExtraNote、WeeklyPlan、Deliverable、ProjectEdit、Interval、
   ConfirmModal(確定刪除→處理中…) 全部加 saving 鎖定＋「儲存中…」字樣（await onSave 完成才解鎖）。
4. **ESC 未儲存防護**：模組層 `MODAL_DIRTY` 旗標＋`markModalDirty()`(表單 onChange 觸發)＋
   `useModalDirtyReset()`(視窗卸載自動清除)；ESC 關表單型視窗時若 dirty → ConfirmModal
   「放棄未儲存的內容？/放棄並關閉」（confirmLabel 參數新增）。面板類(無輸入)不受影響。
5. **刪除復原**：刪除專案/區間成功的 toast 附「↩ 復原」鈕(10 秒)，點擊呼叫 restore API → refreshData。
- 順手修正：ExtraNoteModal 又被改回強制填字 → 還原「選填可清空」（清空時按鈕變灰「清空內容」，toast 顯示已清空）；
  TaskModal/IntervalModal 週次 max 又寫死 52 → 還原 `max={weeksTotal}`（53 週年支援）。

**驗證**（實際瀏覽器全流程）：裕隆登入→重整自動還原、登出清除；非專案打字→ESC→「放棄未儲存的內容?」
→放棄並關閉正常；主管刪測試專案→toast「↩ 復原/✕」→復原成功且 AuditLog 有 RESTORE；
移除有專案成員→錯誤 toast 紅框、4 秒仍在、✕ 可關；測試專案已從 DB 硬刪；console 乾淨。

---

## 2026-07-12 — 全面功能驗證＋兩項修正（回報中心排序/平滑捲動保底）

**背景**：使用者要求重新確認功能是否正常並檢視優化空間。以實際瀏覽器煙霧測試全部主要流程。

**驗證通過清單**：登入持久化(重整還原/登出清除)；成員 header 2 顆功能鈕；回報中心(完成度進度條/
Completion Loop 底部導引)；三種檢視切換(週檢視/年度總覽 12 月表頭滿版無捲軸/成果清單含使用者自加的
排序欄與負責人欄)；到期清單；異動紀錄白話 summary；補登開關縮短標籤;團隊總結(成員預設只看我的+
個人複製鈕;主管無 checkbox+展開收合+團隊複製)；Excel 週報 200/10KB；console 乾淨。

**修正 1 — 回報中心區塊排序**（延續前次核可的優先序）：
「已完成打卡任務」原卡在 ①待打卡 與 ②下週預計(必填) 之間——已全數打卡的成員(如 6 項已完成)會把必填項
推出視野。調整為 ①待打卡 → ②下週預計(必填) → ③非專案(選填) → ④已完成(參考資訊,唯讀性質放最後)。

**修正 2 — 平滑捲動保底 `smoothScrollLeftTo()`**：
測試發現部分環境(嵌入式瀏覽器)的 `scrollTo/scrollBy({behavior:'smooth'})` 會**靜默失效**(事件有處理、
捲動不發生)。新增輔助函式:先 smooth,250ms 內未位移則改用瞬間捲動。套用於 scrollToWeek(回到本週/
到期定位)與 ←/→ 鍵盤平移。一般 Chrome/Edge 行為不變(平滑),異常環境保證仍可捲動。

**備註**：`package.json` 的 build:css 被移除 `--minify`(使用者改動)——app.css 未壓縮約大 3~5 倍,
內網部署影響小,若要復原加回 `--minify` 即可。

---

## 2026-07-12 — old.sql/new.sql 合併腳本等價性驗證＋遷移 10 補齊週基準

**背景**：遠端主機已依序執行 01~05,使用者將 01~05 合併為 `old.sql`(存檔紀錄)、06~09 合併為 `new.sql`
(遠端待執行),要求驗證三個等價性,目標=不重建遠端 DB、直接跑 new.sql 接上目前架構。

**驗證方法**：Sariel 建兩個臨時 DB — A 逐檔執行、B 執行合併檔,以結構指紋(欄位/SP·View 定義 SHA-256/
CHECK/DEFAULT/FK/索引含 filter)＋種子資料檢查碼逐項比對(定序衝突需在目錄名稱上加 COLLATE DATABASE_DEFAULT)。

**結論**：
1. ✅ `01→05` ≡ `old.sql`（結構 144 項＋種子資料 0 差異）。
2. ✅ `06→09` ≡ `new.sql`（結構 161 項＋資料 0 差異）。
3. ✅ `old.sql`＋`new.sql` ≡ 正式 Gantt 架構。28 項表面差異皆非實質:
   - 26 項=AuditLog/Projects 欄位「順序」不同(正式 DB 走 ALTER ADD 附尾端 vs 全新建置 CREATE TABLE 內建;
     欄名/型別/可空性完全相同,程式皆以欄名存取,無功能影響)。
   - usp_ToggleProjectStar 定義雜湊不同=僅 CRLF/LF 換行差(去換行後 SHA-256 相同)。

**發現並修正**：7/11 重新匯出的 `02_seed_data.sql` 只種到 2026 W52(漏 W53),且全新建置缺 2027 年度
→ 依「01~05 不回改」規則新增 **`10_ensure_week53_and_2027.sql`**(冪等:補 2026 W53(202612)＋
EXEC usp_EnsureScheduleYear 2027),並以相同合併格式附加進 `new.sql`。重驗:B 重建後與 A(01~05+06~10)
結構/資料 0 差異,週基準與正式 DB 一致(2026=53、2027=52);正式 DB 跑 10 冪等無動作。臨時 DB 已刪除。

**給遠端主機的結論**：直接執行 `new.sql`(含 06~10)即可從 01~05 基準升級到與目前 Gantt 相同的架構,
不需刪庫重建;全新環境=`old.sql`→`new.sql`。

---

## 2026-07-12 — 週基準段改歸 old.sql（更正前一筆的做法）

**使用者說明**：「補 2026 W53＋建 2027 週資料」已在遠端主機於 01~05 之後執行過,屬舊基準而非待執行項。
**調整**：該段(冪等)改附加至 `old.sql` 尾端(標註為已執行的補充基準段);自 `new.sql` 移除 10 區段;
刪除獨立的 `10_ensure_week53_and_2027.sql`(內容已併入 old.sql,之後新遷移從 10 開始編號可重用)。
**重驗**：`old.sql` 單獨建置 → 2026=53 週、2027=52 週 ✓;接 `new.sql` 後與正式 Gantt 比對
總 diff 28、實質差異 0(僅欄位順序/換行雜湊,同前結論) ✓;臨時 DB 已刪除。
**現行守則**：old.sql=01~05+週基準段(遠端已執行的全部);new.sql=06~09(遠端待執行);
新遷移檔往下編號並同步附加進 new.sql。

---

## 2026-07-12 — SQL 檔案結構定案（old/new 為已執行基準，新異動從 10 起）

**使用者指示（新守則,取代先前所有遷移規則）**：
- 原 01~09 逐檔已移至 `backup_sql/`（僅存檔參考,勿執行勿修改）。
- 根目錄 `old.sql`＋`new.sql`＝**遠端主機已全部執行完畢**的 DB 架構基準,與目前 DB 架構一致;兩檔不可再改。
- 遠端主機已有正式資料,**嚴禁刪庫/刪表重建**;所有遷移必須冪等、增量、不破壞資料。
- 之後專案修正若涉及 DB 架構變更,一律**新增 `10_xxx.sql`、`11_xxx.sql`… 往下遞增**,
  使用者只需將新檔依序於遠端執行即可接上(不再附加進 new.sql)。
- 全新環境＝CREATE DATABASE → old.sql → new.sql → 10 以後新檔。

CLAUDE.md 維護規則與資料庫章節已同步改寫（含開頭「絕對禁止」條款）。

---

## 2026-07-12 — UI/UX 巡檢＋補做「個人週得分統計」

**巡檢結果（1366×768 實測）**：前後端建置 0 error、console 乾淨;工具列/概況列無捲軸不斷行;
成果清單(使用者自加的欄位排序↕/負責人欄/MP/操作欄/星號標記×69)運作正常;到期徽章 6 與晶片一致;
星號功能已由 localStorage 改為 DB 版(Projects.IsStarred+usp_ToggleProjectStar,主管標記全員共享,遷移 09)。

**補做——個人週得分統計**（先前已核可,實作時因中斷遺失;純前端,DB 不變）：
- `WeeklyReportDashboard` summary 加 `weekScore`＝已回報任務分數加總(回報預設 1,主管可調 0.3~1;
  未回報 0),四捨五入至小數 1 位;滿分＝本週排定任務數。
- 成員卡標題列回報進度旁加「🏆 X/Y 分」徽章(滿分綠/未滿靛藍,400 級邊框投影友善,title 說明計算方式);
  成員只看自己時見個人得分,主管展開全隊即跨成員比較。
- 「複製週報」「複製團隊週報」文字的成員標題行加「・得分 X/Y」。
- 驗證:徽章正確顯示 5/5、5.8/6(主管調分 0.8 如實反映)、0/7 等;console 乾淨。

**剩餘建議（未動工）**：①偏好記憶(viewMode/onlyMine/年度/緊湊 存 localStorage) ②Excel 匯出鈕 busy 回饋
③星號目前只在成果清單可見,週檢視甘特列看不到主管標的重點關注(建議名稱旁顯示★或加「只看關注」篩選)
④分頁標題帶週次 ⑤build:css 已無 --minify(app.css 未壓縮) ⑥長期:並行控制/appsettings 明碼密碼。

---

## 2026-07-12 — Excel 匯出回饋＋分頁標題帶週次（優化 3+4）

**修正**（`ClientApp/app.jsx`，已 `npm run build`；後端與 DB 不變）：
1. **Excel 匯出回饋**：`WeeklyReportDashboard.exportExcel` 由 `<a download>` 盲點連結改為 fetch→blob 下載:
   按鈕點擊後顯示「⏳ 產生中…」並 disabled(防重複點擊),完成自動恢復;失敗轉紅色「❌ 匯出失敗,點擊重試」
   (5 秒自動復原);下載檔名維持 `WeeklyReport_{年}_W{週}.xlsx`。
2. **分頁標題帶週次**：`document.title` 隨登入/週次/年度動態更新——本年度=`W28｜MSD 專案追蹤總表`、
   非本年度=`2027 W01｜…`、未登入=原名。開多分頁可直接辨識。
   ⚠ 實作註記:此 effect 引用 scheduleYear,必須放在其 useState 宣告之後(deps 陣列於 render 期求值,
   放前面會 TDZ ReferenceError——初版就踩到,已修)。

**驗證**：標題 未登入→W28→切上週 W27→切 2027 顯示「2027 W01」;匯出鈕 50ms 顯示產生中+disabled、
500ms 完成恢復;console 乾淨。

---

## 2026-07-13 — 成果清單定位為「高階主管唯讀檢視」（4 項修正）

**設計決定（使用者確認）**：星號(重點關注)只顯示於成果清單——高階主管挑重點的視角;
週檢視/年度總覽是成員與直屬主管掌握進度的畫面,不顯示星號(避免對成員形成無謂壓力)。

**修正**（`ClientApp/app.jsx`，已 `npm run build`；後端與 DB 不變）：
1. **成員也可瀏覽他人**：成果清單一律顯示「成員下拉」(取代成員的「只看我的專案」checkbox);
   成員切入成果清單預設選自己(setOnlyMine(false)+setOwnerFilter(自己)),切回週檢視/年度總覽自動還原
   (onlyMine=true, ownerFilter='all');主管預設「全部成員」不變。
2. **展開｜收合隱藏**：只作用於甘特成員群組列,成果清單(平面表)以 `!isResults` 隱藏。
3. **移除操作欄**：成果清單為唯讀檢視,「編輯/檢視」按鈕與欄位整欄移除(編輯一律走週檢視 🎯 入口);
   onEditDeliverable prop 一併移除;colSpan 8→7。
4. **緊湊化**：列高 44→35px(取消固定 h-11,改 py-1 貼合文字);tbody 12→13px、分類/產出 font-semibold、
   名稱 14px bold;KPI 卡 p-4→p-2.5、icon w-11→w-9、數字 xl→lg;容器 py-6→py-3。
   實測 768 高視窗可完整顯示單一成員 16 案無捲軸(1080p 更寬裕)。

**驗證**：成員→成果清單 預設玉婷/可切裕隆/checkbox 消失/展開收合消失/表頭 7 欄無操作;
切回週檢視 checkbox 與展開收合恢復;主管預設 all(69 列);console 乾淨。

---

## 2026-07-13 — 🎯 tooltip 補 MP＋主管週報回覆（遷移 10）

**需求**：① 🎯 圖示滑鼠提示只顯示具體成果，若有填 MP Saving 也要顯示；
② 主管可針對每位成員「本週回報結果」寫回覆建議（選填），顯示於團隊總結看板，全體成員登入皆可見。

**修正 ①**（`ClientApp/app.jsx`）：🎯 按鈕 title 改為「具體產出項目：…＋💡 MP Saving：…」
（任一有填即顯示，未填的一項標（未填寫）；甘特條 tooltip 先前已含 MP）。

**資料庫**（新遷移檔 `10_add_manager_weekly_comment.sql`，冪等，已於本機 Sariel 套用驗證；
**遠端主機需依序執行此檔**）：
- 新表 `dbo.WeeklyComments`：UserId×ScheduleYear×WeekNo 唯一（每人每週一筆），`Comment NVARCHAR(MAX)`
  （空字串＝已清空，保留列留稽核脈絡）、UpdatedByUserId／UpdatedAt。
- 新 SP `usp_UpsertWeeklyComment`：**SP 內檢查僅主管可寫**（RAISERROR）；MERGE upsert；
  稽核 `Action='COMMENT', EntityType='WeeklyComment', EntityId=成員@yyyyWww`。

**後端**（`Program.cs`）：
- bootstrap 回傳 `weeklyComments`（`{成員: {週: 回覆}}`，只含非空、依年度篩選）。
- 新端點 `POST /api/weekly-comment` → usp_UpsertWeeklyComment（Comment null 視為清空）。
- 異動紀錄 Summarize() 新增 WeeklyComment case：「主管回覆 ○○ 2026 年第 N 週週報：…」／清空版本。

**前端**（`ClientApp/app.jsx`）：
- 新 `CommentModal`（紫色標題列 #7C3AED 行內樣式，遵循表單三件套＋ESC closeGuard）；
  已有回覆時開窗預填並提示可修改，清空文字送出＝「清空回覆」。
- 團隊總結看板：主管每張成員卡標題列新增「💬 主管回覆／編輯回覆」鈕（成員不顯示）；
  折疊摘要多 💬 徽章；展開卡片底部新增「👑 主管回覆」紫色區塊（**全角色可見**）；
  單人「📋 複製週報」與整體「複製週報文字」皆帶「(主管回覆)」行。
- 異動紀錄面板：AUDIT_ACTION_META 加 `COMMENT=回覆`（紫）、AUDIT_ENTITY_LABELS 加 `WeeklyComment=主管回覆`。

**驗證**：主管回覆裕隆 W29 →卡片即時出現💬徽章＋展開紫色區塊；成員（玉婷）登入取消「只看我的週報」
可見裕隆卡片的主管回覆、且無編輯鈕；清空流程按鈕轉「清空回覆」→徽章消失；
異動紀錄顯示紫色「回覆/主管回覆」白話摘要；console 乾淨；測試資料已清除。

---

## 2026-07-15 — 非當週回報補登入口＋主管週次編輯面板＋打卡最後編輯時間

**需求**：主管開啟補登時，成員檢視非當週（如 W25）要在「本週回報中心」左邊出現該週的修改按鈕，
可修改專案打卡/非專案/下週預計（主管回覆不可異動）；主管登入則有編輯任何週回報的按鈕，
可代成員補登/修正全部內容（標記主管修正）並編輯主管回覆；打卡要顯示各筆回報的最後編輯時間。

**DB**：**無架構變更、無新遷移檔**——`WeeklyLogs.UpdatedAt`/`ReportedByUserId` 與
ExtraNotes/WeeklyPlans 的 `UpdatedAt`/`UpdatedByUserId` 既有欄位已足夠（SP 每次 upsert 都會更新）。

**後端**（`Program.cs`）：bootstrap taskLogs 加回傳 `updatedAt`（`yyyy-MM-dd HH:mm`）。

**前端**（`ClientApp/app.jsx`）：
1. **成員補登鈕**：`role==='member' && allowRetroCheckin && currentWeek!==todayWeek` 時，
   header「📋 本週回報中心」左邊出現琥珀色「🕘 修改 W{..} 回報」→ 開 `PendingPanel retro`
   （範圍=檢視中週次；琥珀標題列 #92400E＋⚠️補登警示列，文案以 W{..} 取代「本週」；無主管回覆項）。
2. **主管編輯鈕**：主管 header 常駐「🛠 編輯 W{..} 回報」→ 新元件 `ManagerWeekPanel`
   （成員下拉→該週任務清單(狀態/❗未回報/✏️主管標記/最後編輯時間，點擊開 TaskModal 補登)＋
   代修「非專案」「下週預計」卡＋「👑 主管回覆」卡）。
3. **代修機制**：`noteTargetUser` state — handleSaveExtraNote/WeeklyPlan 以目標成員送出
   （SP 記 UpdatedBy=主管＝可稽核的主管修正）；ExtraNote/WeeklyPlan Modal 加 `targetUser` prop
   顯示「👑 主管代修模式」banner；主管開這兩個 modal 不再受唯讀限制（readOnly 加 `role!=='manager'`）。
4. **最後編輯時間**：TaskModal 回報區、補登/主管面板任務列、團隊總結卡片任務項顯示
   「🕘 最後編輯 {updatedAt}（{reporter}）」＋ reporterRole==='manager' 時「✏️主管修正」琥珀標記；
   handleSaveLog 樂觀更新同步寫入 reporter/reporterRole/updatedAt（`nowStamp()`）。
5. ESC 優先序/isAnyModalOpen 加入 showRetroPanel/showWeekEditPanel；登入/登出重置新狀態。

**順手修掉的既有 bug**：
- `toggleRetroCheckin` 送 `allow` 但後端 `RetroCheckinReq` 收 `Enabled` → 開關**從未真正寫入 DB**
  （畫面靠樂觀更新，60 秒輪詢即被打回）。改送 `enabled` 後已驗證 DB 正確存 true/false。
- `.git/config` 損毀（295 bytes 全為 0x00，dotnet build 讀 git 資訊失敗）：重建 core＋user 區段，
  歷史 commit 完整；**origin remote URL 隨損毀遺失**，需使用者 `git remote add origin <URL>` 補回。

**驗證**：主管 W28 面板列出裕隆 5 筆任務（含最後編輯時間）＋代修非專案（DB UpdatedBy=管理部主管）＋
主管回覆卡顯示既有回覆；成員裕隆 W28 出現 🕘 鈕、補登面板琥珀樣式、TaskModal 可編輯並顯示最後編輯；
補登開關 DB 持久化 true/false 皆驗證；console 乾淨；測試資料已清除、開關還原 OFF。

---

## 2026-07-15 — 非專案／下週預計／主管回覆 全面顯示最後編輯時間與編輯人

**需求**：延續打卡的最後編輯資訊，非專案事項、下週預計工作、主管回覆三項也要顯示最後編輯時間與編輯人。

**DB**：無架構變更（三表既有 `UpdatedByUserId`＋`UpdatedAt`）。

**後端**（`Program.cs`）：bootstrap 的 extraNotes／weeklyPlans／weeklyComments 查詢 LEFT JOIN 編輯人，
另回傳並列的 `extraNoteMeta`／`weeklyPlanMeta`／`weeklyCommentMeta`（`meta[user][week]={by,byRole,at}`）——
**不改動既有字串字典結構**，前端既有用法零影響。

**前端**（`ClientApp/app.jsx`）：
- 新共用元件 `MetaLine`（🕘 最後編輯 時間（編輯人）＋ byRole==='manager' 時「✏️ 主管修正」琥珀標記；
  `showManagerTag=false` 用於主管回覆——編輯者必為主管，標記為冗餘）。
- 三個 meta state＋refreshData 接收；三個 save handler 樂觀更新 meta（nowStamp()）。
- 顯示位置：團隊總結卡片三區塊（非專案/下週預計/主管回覆）、ExtraNoteModal／WeeklyPlanModal
  （編輯與唯讀分支）、CommentModal 已回覆提示、ManagerWeekPanel 三張卡、PendingPanel（回報中心＋補登面板）
  的下週預計/非專案卡；未填寫一律不顯示 meta。

**驗證**：W28 團隊總結 26 處最後編輯行（裕隆主管回覆=管理部主管、玉婷/詠裕/宸詳/冠芝各筆正確）；
主管週次編輯面板玉婷下週預計卡＋裕隆主管回覆卡帶 meta；CommentModal 提示區顯示最後編輯；
未填寫的卡片不顯示；console 乾淨。

---

## 2026-07-16 — 成果清單匯出 Excel（高階主管離線瀏覽）

**需求**：成果清單頁加匯出 Excel 按鈕，主管可在車上離線瀏覽專案項目、具體產出成果與 MP Saving。

**DB**：無架構變更。

**後端**（`Program.cs`）：新端點 `POST /api/results-excel`（ClosedXML，單一工作表「{年} 成果清單」）：
- body `{ year, projectIds }`——projectIds＝前端目前顯示的專案 ID 順序（**套用畫面上的篩選與排序**），
  空陣列/未傳＝該年度全部（成員/專案預設順序）。
- 欄位：No、分類、類型、專案名稱、負責人、重點關注（★ 琥珀底）、預計交付具體產出成果（wrap 60）、
  MP Saving（wrap 20）；表頭 Navy #001F5B 白字、凍結首列、框線，沿用週報匯出樣式。
- 新增 record `ResultsExcelReq(int Year, List<int>? ProjectIds)`。

**前端**（`ClientApp/app.jsx`）：ResultsView 頂部提示列右側新增「⬇️ 匯出 Excel（N 案）」綠色按鈕
（沿用週報匯出的 exporting/exportFailed 防連點與失敗重試回饋）；fetch→blob 下載
`成果清單_{年}.xlsx`；ResultsView 新增 `year` prop（App 傳 scheduleYear）。

**驗證**：成果清單 69 案按鈕顯示正確；點擊 POST 200；檔案內容含表頭/★/MP Saving(112)/專案名稱；
帶 projectIds=[101] 只輸出表頭+1 列（篩選匯出正確）；console 乾淨。

---

## 2026-07-16 — 連線字串改為即時讀取（發佈後改 appsettings.json 免重新發佈）

**問題**：使用者反映發佈到遠端 IIS 後，改 `appsettings.json` 的 `Initial Catalog=Gantt→Gantt2` 不再生效，
必須重新發佈。根因：`Program.cs` 啟動時 `string connStr = builder.Configuration.GetConnectionString(...)`
**只讀一次進變數**，之後 24 處 API 都用這份快取；ASP.NET Core 部署在 IIS 改 appsettings.json
**不會**自動重啟程式（不像老 ASP.NET 改 web.config 會回收）——先前「改了會生效」是碰巧遇到
應用程式集區閒置回收重啟。

**修正**（`Program.cs`；前端與 DB 不變）：改為 local function
`string ConnStr() => app.Configuration.GetConnectionString("Gantt") ?? throw …`，
24 處 `new SqlConnection(connStr)` 全改 `new SqlConnection(ConnStr())`。
appsettings.json 預設以 `reloadOnChange:true` 載入 → **存檔數秒內所有後續請求即用新連線字串**，
無須重啟/回收/重新發佈。appsettings.json 的註解同步補充此行為。

**驗證**（全程不重啟伺服器）：指向不存在 DB → API 立即 500；改回 → 立即恢復；
切 Gantt2（marker：AllowRetroCheckin=true）→ bootstrap 回 True 證明讀 Gantt2；切回 Gantt → False。
過程發現 **Gantt2 尚未跑遷移 10**（bootstrap 掛在 WeeklyComments 不存在），已代跑
`10_add_manager_weekly_comment.sql` 於 Gantt2（冪等）。Gantt2 marker 已還原 false、連線字串已還原 Gantt。

**教訓（工具側）**：PowerShell 5.1 `Get-Content -Raw`＋`Set-Content` 改含中文的 UTF-8(無BOM) 檔會以
系統編碼誤讀→寫壞 JSON（驗證過程曾把 appsettings.json 中文註解弄成亂碼導致 config 解析失敗，
已用 Write 工具重寫修復）；改此類檔案一律用 Edit/Write 工具。
