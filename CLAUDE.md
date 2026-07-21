# CLAUDE.md

MSD 專案追蹤總表 — ASP.NET Core 9 Minimal API 後端 + React SPA 前端，資料存於 SQL Server。

## 文件體系（四份核心文件，更新時同步維護）

| 文件 | 內容 | 維護方式 |
|------|------|----------|
| `CLAUDE.md` | 開發規範與慣例（本檔） | 保持精簡，只反映最新規範 |
| `memory.md` | 專案現況概觀＋目前待辦 | 覆寫更新，不累積流水帳 |
| `DB_table.md` | DB 結構＋**完整變更歷史** | **只能往下新增，不可刪減**（遠端增量遷移依賴此歷史） |
| `系統架構.md` | 模組與資料流總覽 | 架構有變時同步更新 |

## 維護規則（最重要）

- **絕對禁止更改 `old.sql`／`new.sql`**：兩檔為遠端正式環境已執行完畢的架構基準。遠端已有正式資料，
  **嚴禁刪庫／刪表重建**。所有 DB 結構異動一律新增編號遷移檔 `14_xxx.sql`… 往下遞增（10~13 已存在）、
  冪等設計，並**追加紀錄至 `DB_table.md`**。歷史逐檔 01~09 在 `backup_sql/`（僅供參考）。
- `sim_create_WEB_notes_person.sql` 僅開發機用（模擬遠端名冊 VIEW），**遠端勿執行**。

## 專案結構

- **根目錄 `Gantt.csproj`** = 實際應用程式（`Program.cs`、`wwwroot/`、`appsettings.json`）。`Gantt.sln` 指向它。
- **`Gantt\` 子資料夾** = 舊 legacy App，已用 `<Compile/Content/... Remove="Gantt\**" />` 排除，僅保留參考。

## 前端建置

- **不要直接改 `wwwroot/index.html`／`app.js`**（編譯產物）。原始碼＝`ClientApp/app.jsx`＋`ClientApp/input.css`。
- 修改後 `npm run build`：產生 app.js/app.css，並由 `scripts/stamp-assets.js` 自動蓋 `?v=時間戳`
  （**快取破壞**——內網部署後才不會舊 CSS 配新 JS 造成白底白字）。開發可用 `npm run watch:js`＋`watch:css`。
- React/ReactDOM 本地化於 `wwwroot/lib/`（內網禁 CDN）。
- **彈窗彩色標題列一律行內樣式** `style={{backgroundColor}}`（快取到舊 CSS 時新 class 不存在會看不到字）。

## 後端建置與執行

```
dotnet build Gantt.csproj -c Debug
dotnet run --project Gantt.csproj --urls http://localhost:5099
```

## API 端點（Program.cs）

**載入／驗證**
- `GET /api/whoami` — Windows 工號（Negotiate；剝 `Auth:WindowsDomainStripPrefix` 前綴＋最後反斜線 fallback；
  401→前端靜默 null）。前端 `apiPost` **自動附帶 `actorEmpId`** 寫入 AuditLog。IIS 需 Windows 驗證＋匿名驗證並存。
- `GET /api/bootstrap?year=` — 一次載入 users/projects(含 tasks/deliverable/mpSaving/isStarred)/taskLogs(含 score/updatedAt)/
  extraNotes/weeklyPlans/weeklyComments(＋三個 `*Meta` 最後編輯資訊)/years/weeks/allowRetroCheckin。
- `GET /api/access-check?empId=&preview=` — 瀏覽權限卡控：比對 `[WEB].[dbo].[notes_person]` 名冊＋`AccessRules`
  （規則內 AND、規則間 OR、只填工號=白名單；fail-closed）。總開關 `AccessControlEnabled`（預設 false）。
  規則 CRUD：`GET /api/access-rules`、`POST /api/access-rule`、`POST /api/access-rule/delete`、`POST /api/settings/access-control`。

**回報**
- `POST /api/weekly-log`／`/api/extra-note`／`/api/weekly-plan`（下週預計＝**強制項**，計入待回報徽章）
- `POST /api/weekly-log/score` — 主管評分（0.3/0.5/0.8/0.9/1，SP 檢查權限）
- `POST /api/weekly-comment` — 主管週報回覆（每人每週一筆，空字串=清空；看板紫色區塊全員可見）

**專案／任務（主管）**
- `POST /api/project`(+`/update` 含改負責人、`/delete`、`/restore`、`/reorder`、`/deliverable` 含 MpSaving)
- `POST /api/task`(+`/delete`、`/restore`)、`POST /api/task-schedule`
- 刪除 toast 附「↩ 復原」10 秒一鍵反悔（restore）

**成員（主管）**：`POST /api/user`(+`/update`、`/delete`)——軟刪除；同名曾移除則重新啟用；名下有專案擋刪。

**設定／統計／匯出**
- `POST /api/settings/retro-checkin` — 補登總開關（**request 欄位為 `enabled`**，曾誤送 `allow` 導致從未寫入 DB）
- `GET /api/audit-log?top=` — 稽核紀錄，**API 層翻譯白話 summary**（對照含已刪資料；前端顯示 summary、原代碼放 title）
- `POST /api/login-log`（登入統計 fire-and-forget；manual/auto）＋`GET /api/login-stats?days=`
  （注意 `SUM(CASE)`/`COUNT_BIG` 型別混用，讀取端 `Convert.ToInt64(GetValue)`）
- `GET /api/weekly-report-excel?year=&week=`、`POST /api/results-excel`（body `{year, projectIds}`＝畫面篩選排序順序，空=全部；ClosedXML）

**錯誤處理慣例**：所有端點 catch 走 `Fail(ex)` — 內部例外只記 log 回一般化 500；SP `RAISERROR`(50000) 照原文回 400。
新增端點沿用，勿直接回 `ex.Message`。

## 前端慣例

**檢視與導航**
- 三段檢視：週檢視（操作）／年度總覽（table width:100% 整年一頁唯讀）／成果清單（高階主管唯讀：無操作欄、
  ★星號**只在此頁**顯示、成員用下拉瀏覽任何人、可排序篩選＋匯出 Excel）。
- 切週（‹ ›／返回本週）一律走 `scrollTargetWeek` 機制平滑置中，勿只 setCurrentWeek。
- 鍵盤：`H`/Home 回本週、`←→` 平移 4 週（Shift=1 週）、ESC 由外而內關最上層視窗（新 Modal 要加進
  `closeTopModal` 優先序清單；中文組字 `isComposing` 略過）。
- 檢視偏好 localStorage `gantt_prefs`（compact/overview）；登入身分 `gantt_login`（重整還原、登出清除）。
- 60 秒靜默輪詢 refreshData 同步他人變更；搜尋/類型篩選啟用時拖曳排序暫停。

**Modal／Toast 規範**
- 遮罩**不綁點擊關閉**（防誤點遺失輸入）；例外：無輸入的下拉選單（如 ⚙️ 管理）可點外關。
- 表單三件套：①`saving` 防連點（「儲存中…」+disabled）②`markModalDirty()`＋`useModalDirtyReset()`
  （ESC 遇未儲存跳「放棄未儲存的內容？」）③新 Modal 沿用。
- Toast：`❌` 開頭自動視為錯誤（6 秒+紅框+✕）；`showToast(msg, {action})` 顯示動作鈕。
- 週次 input `max` 用動態 `weeksTotal`（2026=53 週），勿寫死 52。

**視覺規範（範本 B 高對比＋投影友善）**
- 專案名稱近全黑 `text-slate-900 font-semibold`；狀態色 green-700/sky-700/slate-500；次要文字至少 slate-600。
- 投影友善：彩色晶片帶 400 級以上實線邊框、文字 700~800 級、不用 opacity 淡化、深色底白字 ≥75%。
- 工具列 `flex-nowrap + overflow-x-auto + [&>*]:flex-shrink-0` 不換行；操作元件小尺寸（11px、py-1），內容區大字。
- 主管 header 只留高頻鈕（🛠 編輯回報／📊 團隊總結），低頻管理入口一律加進右上「⚙️ 管理 ▾」選單。
- 甘特斑馬紋（sticky 欄同步上色）；圖例常駐可見（閱讀輔助資訊不藏 tooltip）。

**其他行為**
- `API_BASE` 執行期自動偵測部署根路徑（IIS 子目錄相容），勿寫死。
- 離線策略：連不到後端顯示 ErrorScreen，不塞假資料。
- 補登機制：主管開關開啟時成員可修非當週（PendingPanel retro 琥珀樣式）；主管常駐 ManagerWeekPanel 代修
  任一成員任一週（顯示「✏️主管修正」標記）；最後編輯資訊統一用 `MetaLine` 元件。
- 團隊總結看板：成員預設「只看我的週報」、主管預設全隊折疊；卡片常駐「📋 複製週報」。
- 回報中心 🎉 只在任務＋下週預計**全部完成**才顯示。

## 資料庫

- 連線字串 `appsettings.json ConnectionStrings:Gantt`；`Program.cs` 以 `ConnStr()` **每次即時讀取**
  （reloadOnChange）——部署後改 appsettings 數秒生效，勿改回啟動時讀一次。
- 結構、SP 清單、遷移規則與**完整變更歷史**見 `DB_table.md`（append-only）。
- 開新年度：`EXEC dbo.usp_EnsureScheduleYear <年度>;`（週數以 ScheduleWeeks 筆數為準）。
- sqlcmd 必帶 `-I -f 65001 -b`。
- ⚠ PowerShell 5.1 `Get-Content/Set-Content` 會寫壞 UTF-8(無BOM) 中文檔——改檔一律用 Edit/Write 工具。

## 前端建置工具

`@babel/cli`＋`@babel/preset-react` 編譯 JSX、`tailwindcss` CLI 編譯 CSS（content 指向 `./ClientApp/**/*.jsx`）。

## 目前待辦

見 `memory.md`「目前待辦事項」（遠端遷移 10~13 確認、明碼密碼、git origin、--minify、HTTPS、rowversion）。
