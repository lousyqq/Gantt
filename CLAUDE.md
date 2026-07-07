# CLAUDE.md

MSD 專案追蹤總表 — ASP.NET Core 9 Minimal API 後端 + React SPA 前端，資料存於 SQL Server。

## 維護規則

- 每次更新同步寫入 `memory.md`（修改歷史）與本檔 `CLAUDE.md`。
- 若 SQL 結構有變動，一併修改目錄下的 `.sql` 檔案（`01`＝結構、`02`＝種子、`03+`＝遷移）。

## 專案結構（重要）

- **根目錄 `Gantt.csproj`** = 實際執行的應用程式（DB 讀寫版）。`Program.cs`、`wwwroot/`、`appsettings.json` 都屬於它。
- **`Gantt\` 子資料夾** = 舊的 legacy App（原 ServiceCenter），已用 `<Compile/Content/EmbeddedResource/None Remove="Gantt\**" />` 從根專案建置中排除，僅保留參考。
- `Gantt.sln` 指向根目錄的 `Gantt.csproj`。

## 前端建置流程（務必注意）

前端 React 程式碼**不要**直接改 `wwwroot/index.html`。`index.html` 只載入編譯後的 `app.js` / `app.css` / `lib/*`。

- 原始碼：`ClientApp/app.jsx`（React）與 `ClientApp/input.css`（Tailwind 進入點）
- 修改後執行：`npm run build`（產生 `wwwroot/app.js` 與 `wwwroot/app.css`）
- 開發時可用 `npm run watch:js` + `npm run watch:css` 自動重編譯
- React / ReactDOM 已本地化於 `wwwroot/lib/`（不再走 CDN，避免 Tracking Prevention 與 production 警告）

## 後端建置與執行

```
dotnet build Gantt.csproj -c Debug
dotnet run --project Gantt.csproj --urls http://localhost:5099
```

## API 端點（Program.cs）

- `GET  /api/whoami` — 取得桌機 Windows 登入者工號（Negotiate 驗證；`UMC\00058897`→`00058897`，
  剝除前綴由 `appsettings Auth:WindowsDomainStripPrefix` 控制，另有「取最後反斜線之後」的通用 fallback）。
  前端載入時偵測一次，之後**所有寫入 API 自動附帶 `actorEmpId`**，由 SP 寫入 `AuditLog.ActorEmpId` 留下操作紀錄；
  非網域環境回 401 → 前端靜默視為 null，系統照常運作。IIS 部署需啟用 Windows Authentication（匿名驗證也要保持啟用）。
- `GET  /api/bootstrap?year=` — 一次載入 users / projects(含 tasks，依年度過濾) / taskLogs / extraNotes / years(可切換年度) / weeks(週→月對照)
- `GET  /api/audit-log?top=`  — AuditLog 最近 N 筆（主管「異動紀錄」面板）。**讀取時**把技術代碼翻譯成
  白話 `summary`（如 `t101-1@2026W9` → 回報 專案「…」的任務「…」…），給高階主管看；查名稱的對照含已刪除資料，
  舊紀錄也翻得出來；翻譯在 API 端做、DB 不動，前端只顯示 summary（原始代碼放滑鼠提示）。
- `GET  /api/weekly-report-excel?year=&week=` — 下載 Excel 週報 .xlsx（ClosedXML；「團隊總結」面板的匯出按鈕）
- `POST /api/weekly-log`   — `dbo.usp_UpsertWeeklyLog`
- `POST /api/extra-note`   — `dbo.usp_UpsertExtraNote`
- `POST /api/task-schedule`— `dbo.usp_UpdateTaskSchedule`

主管專案管理（見 `memory.md` 2026-07-02）：

- `POST /api/project`         — `usp_InsertProject`（新增專案，回傳 projectId）
- `POST /api/project/update`  — `usp_UpdateProject`（改名稱／分類／類型）
- `POST /api/project/delete`  — `usp_DeleteProject`（軟刪除）
- `POST /api/project/reorder` — `usp_ReorderProjects`（拖曳排序，body `orderedIds`）
- `POST /api/task`            — `usp_InsertTask`（新增計畫區間，回傳 taskCode）
- `POST /api/task/delete`     — `usp_DeleteTask`（前端入口：TaskModal 主管視角的「刪除區間」按鈕）
- `POST /api/project/update` 亦可改負責人（「編輯專案」視窗的負責人下拉，把專案移轉給其他成員）

主管成員管理（見 `memory.md` 2026-07-06）：

- `POST /api/user`        — `usp_InsertUser`（新增成員；同名成員曾被移除則重新啟用並還原歷史資料）
- `POST /api/user/update` — `usp_UpdateUser`（改名稱；專案／回報以 UserId 關聯，歷史資料自動跟隨；重名 RAISERROR）
- `POST /api/user/delete` — `usp_DeleteUser`（軟刪除＝`IsActive=0`；名下仍有未刪除專案時 RAISERROR 擋下，需先刪除或改派專案）
- 前端入口：主管 header 的「👥 成員管理」面板；主管視角（未啟用搜尋／類型篩選）下沒有專案的成員（如新同仁）
  也會顯示甘特圖群組列，可直接「＋ 新增專案」。新成員自動出現在登入畫面即可打卡回報。
- 遷移腳本：已併入 `03_upgrade_to_current.sql`（既有 DB 用；全新建置 01 已含）。

前端行為備註：登入後每 60 秒靜默輪詢 refreshData（多人共用時自動同步他人變更）；
搜尋／類型篩選啟用時拖曳排序會暫停（避免落點與畫面不一致）。

前端離線策略：連不到後端時顯示錯誤（ErrorScreen），不塞假資料。

前端 UI 慣例：**所有彈出視窗／側面板的遮罩都不綁點擊關閉**（避免誤點視窗外遺失輸入），
一律用「取消」「×」或送出按鈕關閉；新增 Modal 請沿用此慣例。

前端 API 路徑：`app.jsx` 的 `API_BASE` 於執行期由 `window.location.pathname` 自動偵測部署根路徑
（本地＝`''`、IIS 子應用程式如 `/Gantt` ＝ `'/Gantt'`），本地測好可直接發布 IIS 子目錄，勿改回寫死的絕對路徑。

錯誤處理慣例：所有端點的 catch 走 `Fail(ex)` — 內部例外只記 log、回一般化 500；
SP 的 `RAISERROR`（Number=50000）視為商業邏輯訊息照原文回 400。新增端點請沿用，勿直接回 `ex.Message`。

## 資料庫

- 伺服器 `Sariel`，資料庫 `Gantt`，連線字串在 `appsettings.json` 的 `ConnectionStrings:Gantt`（開發用明碼密碼）。
- 建置腳本：`01_schema_and_objects.sql`（結構＋預存程序，含 DROP 保護可重跑；已含 `Projects.SortOrder` 與 `usp_ReorderProjects`）、`02_seed_data.sql`（種子資料：7 users、68 projects、107 tasks）。
- `03_upgrade_to_current.sql` — **合併版遷移腳本**（取代原 03/04/05/06）：舊版 01+02 基準的既有 DB 執行一次
  即升級到目前完整架構（Projects.SortOrder＋回填、AuditLog.ActorEmpId、13 個 SP 最新版）。
  idempotent 可重複執行；SortOrder 回填僅在全部為 0 時進行，不會洗掉已拖曳的自訂排序。
  **全新建置只需 01→02**，不必跑 03。
- `04_add_type_e_supervisor.sql` — 新增專案類型 e「主管交辦」（idempotent）。
- **⚠ 遷移規則（使用者指示）**：01~03 已是各主機線上 DB 的建置基準，**之後 DB 變動一律新增 04、05… 往下遞增**，
  不回頭改 01~03。全新建置＝01→02→04 以後的所有遷移檔。
- **開新年度**只需 `EXEC dbo.usp_EnsureScheduleYear <年度>;`（依 ISO 8601 產生該年 ScheduleWeeks），前端年度下拉即可選到，不用改程式。
- 全新 server 需先 `CREATE DATABASE [Gantt];`（腳本本身不建資料庫）。
- 用 sqlcmd 執行時需帶旗標：`-I`（QUOTED_IDENTIFIER ON，filtered index 必要）、`-f 65001`（UTF-8，中文 NVARCHAR 必要）、`-b`（遇錯停止）。

## 前端建置工具

`package.json` 使用 `@babel/cli` + `@babel/preset-react` 編譯 JSX、`tailwindcss` CLI 編譯 CSS。`tailwind.config.js` 的 content 指向 `./ClientApp/**/*.jsx`。
