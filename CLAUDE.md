# CLAUDE.md

MSD 專案追蹤總表 — ASP.NET Core 9 Minimal API 後端 + React SPA 前端，資料存於 SQL Server。

## 維護規則

- 每次更新同步寫入 `memory.md`（修改歷史）與本檔 `CLAUDE.md`。
- **絕對禁止更改 `old.sql`／`new.sql`**：兩檔為遠端正式環境**已執行完畢**的 DB 架構基準（與目前架構一致），
  嚴禁修改或刪除；遠端已有正式資料，**嚴禁刪庫／刪表重建**。日後所有 DB 結構異動（新增欄位、資料表、
  預存程序、約束等），**一律新增編號遷移檔 `10_xxx.sql`、`11_xxx.sql`… 往下遞增**，且必須維持
  等冪安全設計（不破壞或覆寫既有資料）；使用者只需將新檔依序於遠端執行。歷史逐檔 01~09 存放於 `backup_sql/`（僅供參考）。

## 專案結構（重要）

- **根目錄 `Gantt.csproj`** = 實際執行的應用程式（DB 讀寫版）。`Program.cs`、`wwwroot/`、`appsettings.json` 都屬於它。
- **`Gantt\` 子資料夾** = 舊的 legacy App（原 ServiceCenter），已用 `<Compile/Content/EmbeddedResource/None Remove="Gantt\**" />` 從根專案建置中排除，僅保留參考。
- `Gantt.sln` 指向根目錄的 `Gantt.csproj`。

## 前端建置流程（務必注意）

前端 React 程式碼**不要**直接改 `wwwroot/index.html`。`index.html` 只載入編譯後的 `app.js` / `app.css` / `lib/*`。

- 原始碼：`ClientApp/app.jsx`（React）與 `ClientApp/input.css`（Tailwind 進入點）
- 修改後執行：`npm run build`（產生 `wwwroot/app.js` 與 `wwwroot/app.css`，
  並由 `scripts/stamp-assets.js` 自動幫 index.html 的資產引用蓋 `?v=時間戳` — **快取破壞**，
  企業內網部署後瀏覽器才不會拿舊 app.css 配新 app.js 造成樣式缺失白底白字）
- 彈窗／面板的**彩色標題列一律用行內樣式**（style={{backgroundColor}}），不要用 Tailwind 色彩 class —
  部署端若快取到舊 CSS，新 class 不存在會看不到字；新增 Modal 請沿用
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
- `GET  /api/bootstrap?year=` — 一次載入 users / projects(含 tasks 與 deliverable) / taskLogs(含 score) / extraNotes /
  weeklyPlans(下週預計) / years(可切換年度) / weeks(週→月對照)
- `POST /api/weekly-plan`  — `usp_UpsertWeeklyPlan`（成員「下週預計執行工作」，每人每年每週一筆，填寫於當週；
  **屬強制回報項目**：未填計入「本週待回報」徽章，回報完本週最後一項任務會自動跳出填寫視窗）
- `POST /api/project/deliverable` — `usp_UpdateProjectDeliverable`（專案「具體產出項目」＝**專案全部執行完畢後**的
  最終交付成果，專案層級非區間；同視窗一併編輯 **MP 人力節省**（`Projects.MpSaving`，自由文字）；
  前端入口為甘特列/成果清單的 🎯 圖示 → DeliverableModal；僅負責人本人或主管可編輯，SP 內檢查）
- `POST /api/weekly-log/score`    — `usp_UpdateLogScore`（主管調整打卡分數；回報預設 1 分、未回報 0 分；
  僅限 0.3 再三交代／0.5 說一動做一動／0.8 完成老闆交代／0.9 超越老闆期許／1 主動承擔，SP 內檢查主管權限）
- `GET  /api/audit-log?top=`  — AuditLog 最近 N 筆（主管「異動紀錄」面板）。**讀取時**把技術代碼翻譯成
  白話 `summary`（如 `t101-1@2026W9` → 回報 專案「…」的任務「…」…），給高階主管看；查名稱的對照含已刪除資料，
  舊紀錄也翻得出來；翻譯在 API 端做、DB 不動，前端只顯示 summary（原始代碼放滑鼠提示）。
- `GET  /api/weekly-report-excel?year=&week=` — 下載 Excel 週報 .xlsx（ClosedXML；「團隊總結」面板的匯出按鈕）
- `POST /api/weekly-comment` — `usp_UpsertWeeklyComment`（遷移 10；**主管週報回覆**：主管針對成員×年×週的
  回報結果給回覆建議，選填、每人每週一筆，空字串＝清空；SP 內檢查主管權限；bootstrap 回傳 `weeklyComments`。
  前端入口：團隊總結看板成員卡標題列「💬 主管回覆」鈕（僅主管），展開卡片底部「👑 主管回覆」紫色區塊
  **全體成員可見**，單人/整體複製週報文字皆帶「(主管回覆)」行；CommentModal 紫色標題列 #7C3AED，遵循表單三件套）
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
- `POST /api/project/restore`／`POST /api/task/restore` — `usp_RestoreProject`／`usp_RestoreTask`（遷移 08；
  刪除成功 toast 的「↩ 復原」鈕，10 秒內一鍵反悔軟刪除，稽核 Action='RESTORE'）
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

前端視覺規範（2026-07-09 重構，範本 B 高對比＋投影友善）：專案名稱近全黑 `text-slate-900 font-semibold`（寬鬆 15px，
預設寬鬆模式）；狀態色 green-700／sky-700／slate-500（白字達 WCAG AA）；次要文字至少 slate-600。
**投影友善原則**（會議室投影機對比打折）：彩色晶片/標籤一律帶 400 級以上實線邊框、文字用 700~800 級、
不用 opacity 淡化文字、深色底上的白字透明度至少 75%；新增元件請沿用。
檢視模式三段切換：「週檢視」（打卡操作）／「年度總覽」（isOverview：table `width:100%`＋
名稱單欄 240px，週欄自動均分 → 整年一頁無水平捲軸，唯讀瀏覽，條上不顯字）／「成果清單」（isResults：
ResultsView 無甘特圖，**高階主管唯讀檢視**——無操作欄（編輯一律走週檢視 🎯）、無展開收合、
緊湊列距（py-1、13px semibold）；★重點關注星號**只在此頁**顯示（勿加到週檢視/年度總覽——
使用者定調：星號是高階主管挑重點用，放進成員日常畫面會形成壓力）；
成員在此頁用「成員下拉」瀏覽任何人（預設自己，切回其他檢視還原「只看我的」），主管預設全部）。

前端離線策略：連不到後端時顯示錯誤（ErrorScreen），不塞假資料。

前端 UI 慣例：**所有彈出視窗／側面板的遮罩都不綁點擊關閉**（避免誤點視窗外遺失輸入），
一律用「取消」「×」或送出按鈕關閉；新增 Modal 請沿用此慣例。
**表單型 Modal 三件套（2026-07-11）**：①送出按鈕加 `saving` 防連點（送出中顯示「儲存中…」並 disabled）；
②輸入 onChange 呼叫 `markModalDirty()`＋掛 `useModalDirtyReset()`——ESC 關窗遇未儲存內容會先跳
「放棄未儲存的內容？」確認（ConfirmModal 支援 `confirmLabel` 自訂按鈕字）；③新增 Modal 請沿用。
**Toast 慣例**：訊息以 ❌ 開頭自動視為錯誤（停 6 秒＋紅框＋✕ 可關閉），成功 2.5 秒；
`showToast(msg, { action: { label, onClick } })` 顯示動作鈕（如刪除後「↩ 復原」，停 10 秒）。
**登入持久化**：登入身分存 `localStorage('gantt_login')`，重整自動還原（登出清除；成員被移除則失效）。另有全域 **ESC 關閉最上層視窗**
（App 內 `closeTopModal` + window keydown capture-phase；中文組字 `e.isComposing` 時略過）——
新增 Modal 若要支援 ESC，請把它的關閉狀態加進 `closeTopModal` 的優先序清單。
**表格鍵盤導航快捷鍵（2026-07-11 新增）**：在無視窗開啟且非於表單輸入狀態時，支援按 `Home` 或 `H` 鍵一鍵定位並置中至「本週」；按 `←` / `→` 方向鍵可左右平滑捲動 4 週（約 1 個月，搭配 Shift 為微移 1 週），ESC 可由外層到內層關閉最上層 Modal。
**團隊總結看板角色感知與 Checkbox 篩選（2026-07-11 改版）**：成員登入預設勾選「☑️ 只看我的週報」顯示自己展開卡片，取消勾選顯示全隊折疊摘要；主管登入不顯示 Checkbox，預設顯示全體成員折疊卡片；卡片標題列右側常駐「📋 複製週報」按鈕以便一鍵複製單筆格式化週報；團隊視角支援「展開全部 | 收合全部」。
**主管進度調補與歷史打卡機制（2026-07-11 新增，2026-07-15 擴充）**：成員（Member）預設僅可對當週進行打卡回報，非當週唯讀；主管（Manager）不受週次限制且可在工具列啟用全域開關 **「🔓 補登 ON／🔒 僅限當週」**（開啟時另有琥珀警示列；對應 `AppSettings.AllowRetroCheckin` API `/api/settings/retro-checkin`，**request 欄位為 `enabled`**——2026-07-15 修正前端誤送 `allow` 導致開關從未寫入 DB 的 bug），授權成員自由修正與補齊本週之前全年度歷史打卡、額外備註與預計工作。
**非當週補登入口與主管週次編輯面板（2026-07-15 新增）**：補登開啟時成員檢視非當週，header「📋 本週回報中心」左側出現「🕘 修改 W{..} 回報」→ 開 `PendingPanel retro`（琥珀標題列＋補登警示，範圍=檢視中週次，可修改該週任務打卡/非專案/下週預計；主管回覆不可異動）。主管 header 常駐「🛠 編輯 W{..} 回報」→ `ManagerWeekPanel`（成員下拉→該週任務打卡清單＋代修非專案/下週預計＋編輯主管回覆）；主管代修經 `noteTargetUser` 指向目標成員，SP 記 UpdatedBy/ReportedBy=主管，畫面顯示「✏️主管修正」琥珀標記。bootstrap taskLogs 含 `updatedAt`（最後編輯時間），顯示於 TaskModal/補登與主管面板任務列/團隊總結卡片。此功能**無 DB 架構變更**（沿用既有 UpdatedAt/ReportedByUserId 欄位）。
**最後編輯資訊（2026-07-15 擴充）**：非專案／下週預計／主管回覆也顯示最後編輯時間與編輯人——bootstrap 另回傳並列的 `extraNoteMeta`／`weeklyPlanMeta`／`weeklyCommentMeta`（`meta[user][week]={by,byRole,at}`，不改動既有字串字典），前端共用元件 `MetaLine` 渲染（byRole=manager 帶「✏️ 主管修正」標記；主管回覆傳 `showManagerTag=false`），顯示於團隊總結卡片、三個編輯 Modal、ManagerWeekPanel、PendingPanel；未填寫不顯示。


前端週數上限：TaskModal／IntervalModal 週次 `<input max>` 用動態 `weeksTotal`（非寫死 52），
因年度可能 52 或 53 週（2026 已改為 53 週；週數以 DB ScheduleWeeks 筆數為準）。

前端工具列（篩選/檢視列）採 `flex-nowrap + overflow-x-auto + [&>*]:flex-shrink-0`：**不換行**，
視窗過窄時水平捲動而非折到第二列；新增工具列項目請沿用。
**版面收納原則（2026-07-11）**：操作元件（工具列/header 按鈕）走小尺寸（11px、py-1），內容區（專案名稱、
甘特、統計數字）維持大字高對比——外殼是配角。成員回報入口統一為 header「📋 本週回報中心」
（PendingPanel＝整體進度條＋任務清單（含已回報綠色打勾）＋每週必填（下週預計、紅色左邊框醒目）＋選填（非專案）；
**🎉 只在任務＋下週預計全部完成時才顯示**，避免任務打卡完就誤以為「全部做完」；紅點=未回報任務+未填下週預計；
面板底部有 Completion Loop 收尾導引列：全數完成顯示綠色「🎉 本週回報已全數完成！返回總表 ›」，未完顯示「暫存離開」）；
甘特專案列有斑馬紋（偶數列 slate-50，sticky 欄位需同步上色）；概況列右側為**常駐精簡圖例條**
（使用者要求圖例必須可見、不可藏進 tooltip——閱讀輔助資訊一律直接顯示在版面上；不用 `hidden xl:flex`；
「⏰即將到期」不放圖例，因同列已有同名按鈕，避免重複）。

前端 API 路徑：`app.jsx` 的 `API_BASE` 於執行期由 `window.location.pathname` 自動偵測部署根路徑
（本地＝`''`、IIS 子應用程式如 `/Gantt` ＝ `'/Gantt'`），本地測好可直接發布 IIS 子目錄，勿改回寫死的絕對路徑。

錯誤處理慣例：所有端點的 catch 走 `Fail(ex)` — 內部例外只記 log、回一般化 500；
SP 的 `RAISERROR`（Number=50000）視為商業邏輯訊息照原文回 400。新增端點請沿用，勿直接回 `ex.Message`。

## 資料庫

- 伺服器 `Sariel`，資料庫 `Gantt`，連線字串在 `appsettings.json` 的 `ConnectionStrings:Gantt`（開發用明碼密碼）。
- **⚠ 遷移規則（使用者指示，2026-07-12 起生效）**：
  - 根目錄 `old.sql`＋`new.sql`＝**遠端主機已全部執行完畢**的 DB 架構基準，與目前 DB 架構一致
    （2026-07-12 已以臨時 DB 逐項指紋驗證）。**兩檔皆不可再修改**。
  - **遠端主機已有正式資料，嚴禁刪除資料庫／資料表重建**，任何遷移必須是冪等、不破壞既有資料的增量修改。
  - 之後專案修改若涉及 DB 架構變更（欄位、資料表、預存程序、約束…），**一律新增編號 SQL 檔
    `10_xxx.sql`、`11_xxx.sql`… 往下遞增**（idempotent 設計），使用者只需把新檔依序拿到遠端主機執行即可接上。
  - `backup_sql/`＝歷史逐檔遷移 01~09 的存檔（僅供參考，內容已全數併入 old/new，勿再執行或修改）。
  - 全新環境建置＝`CREATE DATABASE` → `old.sql` → `new.sql` →（若有）10 以後的新遷移檔。
  - 既有新遷移檔：`10_add_manager_weekly_comment.sql`（主管週報回覆，2026-07-13）；下一個編號從 11 起。
- **開新年度**只需 `EXEC dbo.usp_EnsureScheduleYear <年度>;`（依 ISO 8601 產生該年 ScheduleWeeks），前端年度下拉即可選到，不用改程式。
- 全新 server 需先 `CREATE DATABASE [Gantt];`（腳本本身不建資料庫）。
- 用 sqlcmd 執行時需帶旗標：`-I`（QUOTED_IDENTIFIER ON，filtered index 必要）、`-f 65001`（UTF-8，中文 NVARCHAR 必要）、`-b`（遇錯停止）。

## 前端建置工具

`package.json` 使用 `@babel/cli` + `@babel/preset-react` 編譯 JSX、`tailwindcss` CLI 編譯 CSS。`tailwind.config.js` 的 content 指向 `./ClientApp/**/*.jsx`。
