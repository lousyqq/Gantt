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

## 先前修改（同一改造專案的前置作業）

- **ServiceCenter → Gantt 更名**：專案由舊 ServiceCenter App 改造，所有 ServiceCenter 字樣改為 Gantt。
- **修正 Visual Studio「專案已卸載」**：`Gantt.sln` 原指向 legacy 子資料夾 `Gantt\Gantt.csproj`，改指向根目錄 `Gantt.csproj`。
- **清除瀏覽器 console 警告**：favicon 404、Tailwind CDN、in-browser Babel、Tracking Prevention
  → 改為預先編譯（Babel CLI + Tailwind CLI）、React/ReactDOM 本地化於 `wwwroot/lib/`。
