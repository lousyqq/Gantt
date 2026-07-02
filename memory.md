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

## 先前修改（同一改造專案的前置作業）

- **ServiceCenter → Gantt 更名**：專案由舊 ServiceCenter App 改造，所有 ServiceCenter 字樣改為 Gantt。
- **修正 Visual Studio「專案已卸載」**：`Gantt.sln` 原指向 legacy 子資料夾 `Gantt\Gantt.csproj`，改指向根目錄 `Gantt.csproj`。
- **清除瀏覽器 console 警告**：favicon 404、Tailwind CDN、in-browser Babel、Tracking Prevention
  → 改為預先編譯（Babel CLI + Tailwind CLI）、React/ReactDOM 本地化於 `wwwroot/lib/`。
