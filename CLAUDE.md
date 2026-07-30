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
  **嚴禁刪庫／刪表重建**。所有 DB 結構異動一律新增編號遷移檔 `15_xxx.sql`… 往下遞增（10~15 已存在）、
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
- **新增彩色 class 必須同步補 `.dark` 映射**（`ClientApp/input.css`）。深色模式是「以 `.dark` 覆寫指定 class」實作，
  漏映射的元素在深色下會維持**淺色底**、但文字已被調亮 → 淺底配亮字看不見（曾重複發生）。
  ⚠ Tailwind 各變體是**獨立 class**，要分別映射：`bg-blue-50`／`bg-blue-50/70`／`hover:bg-blue-50` 是三個不同 class
  （hover 只有滑鼠移過去才現形，最難用肉眼發現）。`npm run build` 會跑 `scripts/check-dark-coverage.js` 自動檢查並列出缺漏
  （僅警告不中斷建置），也可單獨執行 `npm run check:dark`。
- **hover 文字色在深色下要「更亮」**，不可沿用淺色的加深慣例（`text-blue-600 hover:text-blue-800` 在深底上
  滑過去反而看不見）——`.dark .hover\:text-xxx:hover` 一律映射到亮色階。
- **行內品牌色改用 `var(--brand-btn, #001F5B)`**（CSS 變數＋**fallback**）才能隨主題切換：帶 fallback 時即使
  快取到舊 CSS、變數不存在，也會退回原本的色，不會變成透明底配白字。
  ⚠ 品牌色**分兩個常數**，勿混用（`app.jsx` 頂部）：`NAVY` 給**標題列／表頭**那種大面積色塊（深色下維持
  深海軍藍才好看）；`BRAND_BTN` 給**按鈕填色／控制項外框**（深色提亮成 #2563EB）。同一個 `#001F5B` 當按鈕
  坐在 `#1E293B` 的工具列或彈窗上時對比只有 **1.07**，整顆融進背景——工具列與「＋新增／✓儲存」曾全中。
- **深色的中性表面階梯（2026-07-30 定案，改動前先讀）**：
  `bg-white`＝面板/卡片本體 `#1E293B` → `bg-slate-100`＝次級表面/控制項 `#334155` → `bg-slate-200` `#3E4C61`
  → `bg-slate-700` 實心中性鈕 `#5A6B84`。**每一階都必須不同**——`bg-slate-100` 原本也映射成 `#1E293B`，
  導致全站 60 處控制項與所在面板同色（實測 1.00）、只剩文字漂著。
  ⚠ 連動規則（改任一階都要重跑）：
  ① 把 `bg-slate-100` 當**整頁底色**的大面積容器（App 根、甘特容器、Loading/Error/AccessDenied）
     必須另掛 `app-bg` 抵銷回 `#1E293B`，否則整頁變淺灰。
  ② 表面提亮會**壓低其上文字**：中性文字階梯已同步上調為
     700 `#CBD5E1`／600 `#B6C0CD`／500 `#A3AEC0`／400 `#8C99AC`（維持亮度遞減不倒置）。
  ③ Tailwind 原生 `bg-slate-700` 的值正好等於 `#334155`，未映射會與新表面撞色，已另行映射。
  ④ 彩色 `-100` 晶片（L≈0.060）落在抬升面上只差 1.1，**別把「含彩色晶片的內容卡」加 `ctl-raised`**，
     那類卡靠 `border-slate-300`（對比 1.92）界定即可。`ctl-raised` 只給**控制項**（按鈕、下拉、晶片、資訊區塊）。
- **彈窗在深色浮不起來**：`shadow-2xl` 的黑色陰影在深底等於不存在，彈窗與遮罩只差 1.11。
  彈窗本體掛 `modal-card`（補一圈 `#475569` 亮邊界）、遮罩掛 `modal-scrim`（加深）。
- **深色的「層次」要自己做**：`.dark` 把 `bg-slate-100`／`bg-white` 都映射成 `#1E293B`，所以「頁面底＋卡片＋
  卡片內按鈕」三層疊在一起時會同色糊掉（登入頁曾發生）。解法是加獨立 class（如 `.login-bg`／`.login-chip`）
  只在 `.dark` 下定義，淺色模式不受影響；勿改基底 class 或用 `dark:` 變體（自訂規則寫在 `@tailwind utilities`
  之後，同特異性會蓋掉 `dark:` 變體）。
- **彩色底的深色亮度階梯（勿隨意調低）**：面板底 `#1E293B` 的 L=0.0218，彩色卡片必須**高於**它才有
  「浮起／被強調」的語意——初版把 -50 壓到 L≈0.011~0.018 比面板還暗，整個面板讀起來就是一片黑。
  現行固定為 `-50` L≈0.035 →`-100` L≈0.060 →`-200` L≈0.085，hover 一律再上一階。
  ⚠ 調整背景後**務必連帶檢查邊框**：`border-*-200/300` 曾因背景提亮而糊在 -100 上（rose 對比正好 1.00
  完全消失），故 9 個色相的邊框已重取到 L≈0.155。驗證基準：-50 vs 面板 ≥1.15、-50 vs -100 ≥1.25、
  卡片上 `text-slate-500` ≥4.5、同色亮字 ≥6。

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
- **投影機是比螢幕嚴苛的環境，驗色要用投影模型**：會議室有燈時 on-screen 對比只剩 30~50:1（螢幕 1000:1+），
  環境光相當於在畫面疊一層亮度地板 `L' = L×(1−1/C) + 1/C`。螢幕上 4.6 的小字投影後只剩 4.0。
  ⚠ 因此**次要文字不可用 Tailwind 原生 slate-500**：淺色下已改寫為 `#556274`（`input.css` 最上方，
  投影 50:1 白底 5.62／slate-100 底 5.14），與 slate-600 仍差 1.22 保住層級。新增次要文字沿用即可。
  實測基準（週檢視 530 個文字元素）：淺色 螢幕 0／投影50 3／投影30 3；深色 螢幕 0／投影50 24／投影30 42。
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

`scripts/`（皆為純 Node、無額外套件，只在開發機執行；內網主機不需要 npm/node）：
- `stamp-assets.js`——建置後蓋資產版本戳（快取破壞）
- `check-dark-coverage.js`——檢查 app.jsx 用到的彩色 class 是否都有 `.dark` 映射

## 目前待辦

見 `memory.md`「目前待辦事項」（遠端遷移 10~13 確認、明碼密碼、git origin、--minify、HTTPS、rowversion）。
