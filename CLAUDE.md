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

- `GET  /api/bootstrap?year=` — 一次載入 users / projects(含 tasks) / taskLogs / extraNotes
- `POST /api/weekly-log`   — `dbo.usp_UpsertWeeklyLog`
- `POST /api/extra-note`   — `dbo.usp_UpsertExtraNote`
- `POST /api/task-schedule`— `dbo.usp_UpdateTaskSchedule`

主管專案管理（見 `memory.md` 2026-07-02）：

- `POST /api/project`         — `usp_InsertProject`（新增專案，回傳 projectId）
- `POST /api/project/update`  — `usp_UpdateProject`（改名稱／分類／類型）
- `POST /api/project/delete`  — `usp_DeleteProject`（軟刪除）
- `POST /api/project/reorder` — `usp_ReorderProjects`（拖曳排序，body `orderedIds`）
- `POST /api/task`            — `usp_InsertTask`（新增計畫區間，回傳 taskCode）
- `POST /api/task/delete`     — `usp_DeleteTask`

前端離線策略：連不到後端時顯示錯誤（ErrorScreen），不塞假資料。

## 資料庫

- 伺服器 `Sariel`，資料庫 `Gantt`，連線字串在 `appsettings.json` 的 `ConnectionStrings:Gantt`（開發用明碼密碼）。
- 建置腳本：`01_schema_and_objects.sql`（結構＋預存程序，含 DROP 保護可重跑；已含 `Projects.SortOrder` 與 `usp_ReorderProjects`）、`02_seed_data.sql`（種子資料：7 users、68 projects、107 tasks）。
- `03_add_project_sortorder.sql` 為既有 DB「事後補 SortOrder」的遷移腳本（idempotent）；**全新建置只需 01→02**，不必跑 03。
- 全新 server 需先 `CREATE DATABASE [Gantt];`（腳本本身不建資料庫）。
- 用 sqlcmd 執行時需帶旗標：`-I`（QUOTED_IDENTIFIER ON，filtered index 必要）、`-f 65001`（UTF-8，中文 NVARCHAR 必要）、`-b`（遇錯停止）。

## 前端建置工具

`package.json` 使用 `@babel/cli` + `@babel/preset-react` 編譯 JSX、`tailwindcss` CLI 編譯 CSS。`tailwind.config.js` 的 content 指向 `./ClientApp/**/*.jsx`。
