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

## 先前修改（同一改造專案的前置作業）

- **ServiceCenter → Gantt 更名**：專案由舊 ServiceCenter App 改造，所有 ServiceCenter 字樣改為 Gantt。
- **修正 Visual Studio「專案已卸載」**：`Gantt.sln` 原指向 legacy 子資料夾 `Gantt\Gantt.csproj`，改指向根目錄 `Gantt.csproj`。
- **清除瀏覽器 console 警告**：favicon 404、Tailwind CDN、in-browser Babel、Tracking Prevention
  → 改為預先編譯（Babel CLI + Tailwind CLI）、React/ReactDOM 本地化於 `wwwroot/lib/`。
