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
- **原生控制項靠 `color-scheme: dark`**（`.dark` 區塊內）：`<input type="date">` 的日曆圖示與彈出月曆、
  `<select>` 的下拉清單、捲軸都不吃 Tailwind class，只認 `color-scheme`。不設的話深色下會是
  「日曆圖示深灰配深底看不見、點開的月曆與下拉整片白」。`check-dark-coverage.js` 掃不到這類問題。
- **新增彩色 class 必須同步補 `.dark` 映射**（`ClientApp/input.css`）。深色模式是「以 `.dark` 覆寫指定 class」實作，
  漏映射的元素在深色下會維持**淺色底**、但文字已被調亮 → 淺底配亮字看不見（曾重複發生）。
  ⚠ Tailwind 各變體是**獨立 class**，要分別映射：`bg-blue-50`／`bg-blue-50/70`／`hover:bg-blue-50` 是三個不同 class
  （hover 只有滑鼠移過去才現形，最難用肉眼發現）。`npm run build` 會跑 `scripts/check-dark-coverage.js` 自動檢查並列出缺漏
  （僅警告不中斷建置），也可單獨執行 `npm run check:dark`。
- **顏色不要用「任意變體」下在父層**（`[&>th]:bg-slate-100`、`[&>td]:bg-*` 之類）：Tailwind 產生的是
  `.\[\&\>th\]\:bg-slate-100>th` 這個**獨立選擇器**，`.dark .bg-slate-100` 匹配不到它 → 深色下該元素永遠留在淺色底
  （成果清單表頭實測 `#F1F5F9` 配已調亮的 `text-slate-700` `#CBD5E1`＝**對比 1.36**，整排欄位標題消失）。
  且它的權重 (0,1,1) 會**壓過子元素自己的顏色 class** (0,1,0)——同一處的 `bg-blue-100/80`「已排序」藍底
  因此在**淺色模式下也從未顯示過**。正解＝把顏色直接寫在子元素的 class 上（`<th className="bg-slate-100 …">`），
  既有 `.dark` 映射就會自然生效，hover／選中態的權重順序也回到正常。
  `check-dark-coverage.js` 已加入這條檢查（它會比對**完整字面** `.dark .[&>th]:bg-...`；
  原本的 regex 會把 `[&>th]:bg-slate-100` 當成 `bg-slate-100` 而誤判通過，這正是當初漏網的原因）。
  ⚠ sticky `thead` ＋ `border-collapse` 下背景**本來就必須下在 `th`**（下在 `tr`／`thead` 不會跟著 sticky 一起繪製），
  所以不是拿掉背景，而是把它從「父層變體」改成「th 自己的 class」。
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
- `GET /api/audit-log?top=&from=&to=&actor=&action=&entityType=` — 稽核紀錄，**API 層翻譯白話 summary**
  （對照含已刪資料；前端顯示 summary、原代碼放 title）。篩選條件皆選填、參數化組 WHERE，回傳
  `{logs, actors, matched, truncated}`——`actors` 取自 AuditLog 而非 Users（才含已移除／已改名者），
  `matched` 是**不受 TOP 限制**的符合筆數，供前端提示「符合 N 筆、僅顯示最近 300 筆」。
  ⚠ `Summarize()` 每個 `entityType` 都要有 case，**漏掉就會掉到 fallback＝裸的 NewValue**。
  `AppSettings` 原本就漏了，面板上只顯示孤零零的「false」／「true」——同一份清單裡專案類都是完整句子，
  唯獨影響全體權限的設定看不懂改了什麼（已補：「開啟/關閉歷史補登…」「開啟/關閉頁面瀏覽權限卡控…」，
  未知 key 也至少回「變更系統設定「X」：…」不再掉回裸值）。
  ⚠ 篩選一定要做在**伺服器端**：本端點只回最近 n 筆，放前端過濾的話查「上個月某人改了什麼」時，
  最近 300 筆可能全是本週資料 → 永遠查不到。（關鍵字例外，它的語意是「在已篩出的結果裡再找」。）
  ⚠ 日期用 `>= 起日 00:00` 與 `< 迄日+1 天` 的**半開區間**，勿寫 `CONVERT(date, CreatedAt) BETWEEN`：
  後者會讓索引失效，且**迄日當天 00:00 之後的資料會整天被漏掉**。
- `POST /api/login-log`（登入統計 fire-and-forget；manual/auto）＋`GET /api/login-stats?days=`
  （注意 `SUM(CASE)`/`COUNT_BIG` 型別混用，讀取端 `Convert.ToInt64(GetValue)`）
- `GET /api/weekly-report-excel?year=&week=`、`POST /api/results-excel`（body `{year, projectIds}`＝畫面篩選排序順序，空=全部；ClosedXML）

**錯誤處理慣例**：所有端點 catch 走 `Fail(ex)` — 內部例外只記 log 回一般化 500；SP `RAISERROR`(50000) 照原文回 400。
新增端點沿用，勿直接回 `ex.Message`。

**輸入驗證慣例（2026-08-10 新增）**：**使用者輸入錯誤要用 `Bad(msg)` 回 400 明文，不可掉進 `Fail(ex)`**。
掉進 `Fail` 會變成 500「伺服器處理失敗，請稍後再試」——但「專案名稱空白」「結束週早於開始週」「分數 7」
不是伺服器壞了，是使用者填錯；回一句不能行動的話，使用者只會一直重試同樣的輸入。
前端各表單已有即時驗證，這是第二道防線（前端漏擋或直接打 API 時）。
已套用：`/api/project`(+update)、`/api/task`、`/api/task-schedule`、`/api/weekly-log`、`/api/weekly-log/score`、
`/api/user`(+update)。共用 `BlankStr()`／`ValidateWeekRange(start,end)`／`MaxWeekNo=53`。
⚠ 週次驗證只擋「明顯不合理」（1~53）；**該年度到底幾週交給 SP 判斷**，不要在這裡再放一份週數定義。

## 前端慣例

**檢視與導航**
- 三段檢視：週檢視（操作）／年度總覽（table width:100% 整年一頁唯讀）／成果清單（高階主管唯讀：無操作欄、
  ★星號**只在此頁**顯示、可排序篩選＋匯出 Excel）。
- **成員篩選＝三個檢視共用的單一「成員下拉」`ownerFilter`**（`'all'` 或成員名），**切檢視不重設**，
  使用者選了誰就一路帶著走。登入預設由 `defaultOwnerFilter(role, user)` 統一決定：成員＝自己、主管＝全部成員；
  登入／登出／關閉團隊看板都回到這個值（看板的「點卡片高亮」會把它聚焦到單一成員，關閉時要還原）。
  ⚠ 舊版週檢視是勾選框「只看我的專案」（`onlyMine`）、成果清單是下拉，同一件事兩種操作，
  切檢視會讓人以為篩選跑掉了 —— `onlyMine` 已從 App 層移除，勿再引入。
  （`WeeklyReportDashboard` 內另有同名的 `onlyMine`，那是看板自己的「只看我的週報」，與此無關。）
- **三種檢視的 `thead` 都要 `sticky top-0`**。⚠ 表格外層包裝**不可加 `overflow-hidden`**（即使只是為了裁圓角）：
  它會成為 sticky 的定位容器而自己不捲動 → 表頭跟著內容捲走。成果清單原本就是這樣壞掉的
  （69 列、內容 2524px vs 可視 948px，捲到底時表頭跑到 `top:-1311`，欄位標題與 7 個排序鈕全部看不到）。
  圓角改用 `[&>th:first-child]:rounded-tl-xl` 之類在 th 上補。
- 切週（‹ ›／返回本週）一律走 `scrollTargetWeek` 機制平滑置中，勿只 setCurrentWeek。
- **header 的系統週數是可直接輸入的 `<WeekNumberInput>`**（2026-08-10）：原本只有 ‹ › 兩顆鈕＋純文字，
  從 W32 跳到 W08 要按 24 次（`←→` 一次也只走 4 週，而且沒人知道有這個快捷鍵）。
  ⚠ 不做成「點一下才變輸入框」——多一次點擊、又少了「這裡可以打字」的可見提示。
  ⚠ **commit 在 Enter／失焦，不在 `onChange`**：邊打字邊切週會在打「1」時先跳 W01，整張甘特白重算一次。
  ⚠ 超出範圍**夾回邊界不是拒收**；成員的上限是 `todayWeek`（與 › 鈕 disabled 的規則一致）。
  ⚠ `type=number` 的微調鈕要用 `.week-input` 隱藏（深藍 header 上是灰方塊，還吃掉 16px；欄位只有 36px）。
- **「W.. 概況」的統計跟著 `ownerFilter` 走**（2026-08-10）：標題就寫在被篩選過的表格正上方，
  選了「玉婷」卻顯示全隊 3/21、而表格是 16/69，兩組數字對不起來（實測切 all→玉婷→裕隆，晶片三次都不變）。
  標題會同步顯示範圍（`全隊概況`／`玉婷概況`），使用者不必用猜的。
  ⚠ 但**不吃搜尋與類型篩選**：那兩個是臨時的「找資料」動作，概況是「這週該做的事完成多少」的固定基準。
- **「未回報」晶片＝可切換的篩選鈕**（`pendingOnly`，2026-08-10）：主管每週的核心動作就是「誰還沒交」，
  原本看到「未回報 18」之後只能自己在 69 列裡找紅框。用 `<button aria-pressed>`（不必套 `clickable`）。
  ⚠ 它會隱藏部分列 → 必須併進 `isFilteringRows`（暫停拖曳排序）。
  ⚠ 看板開啟／切成果清單時：**篩選中的話那顆要留著**（否則清單只剩幾列卻找不到地方取消），
  切成果清單則直接 `setPendingOnly(false)`（全年度視角沒有「本週未回報」的概念）。
  ⚠ 篩到 0 筆時不要報「找不到專案」——那其實是好消息，改顯示「已全數回報」＋「顯示全部專案」出口。
- 「⚡ 回到本週」的條件是 **`!isResults`**（週檢視＋年度總覽都要有）：年度總覽同樣有週次列與當週高亮，
  點到 W15 後若沒有這顆，只能用 header 的 ‹ › 一週一週按回來（H 快捷鍵沒人知道）。
- **週次列（thead 第二列）三種檢視都要有**：年度總覽原本整列被 `!isOverview` 關掉，導致總覽下看不出週別、
  也無法點週次移動當週紅線。總覽的週欄寬＝剩餘空間÷週數（非固定 `weekW`），故該列在總覽時
  不加固定寬度、字級降到 9px、只顯示數字；欄寬 <16px（如 1366＋看板開啟＝12px）時**只標 5 的倍數與當週**，
  未標數字的格子照樣可點（hover／title 不變）。門檻與欄寬由 `overviewWeekW`／`sparseWeekLabel` 推算。
- **年度總覽的名稱欄由「週欄保底寬」倒推**（`MIN_OVERVIEW_WEEK_W = 20` → `overviewNameW`）：
  原本寫死 240，1920 下明明有空間卻不用（截斷 22%）。現行＝把剩餘空間讓給名稱欄，但先保證每個週欄 ≥20px。
  上限沿用週檢視的 `nameColWidth`（切換兩檢視時名稱欄不跳動）、下限 240（任何情況都不比原本差）。
  「整年 53 週一畫面」是核心前提，表格 `width:100%` 本來就不會有水平捲軸，加寬只是週欄變窄——
  ⚠ 所以 `MIN_OVERVIEW_WEEK_W` **別調高**：22px 時 1366（投影）只剩 200px 給名稱欄、低於下限 240，
  投影環境完全得不到改善；20px 才讓 1366 也能撐到 300。
- **量測文字截斷務必等 `document.fonts.ready`**：字體載入前是 fallback（較窄），同一畫面會量出
  1/176 與 13/176 兩種結果（本專案實際踩過，導致一份稽核報告數字錯誤）。
- **版面寬度一律用 `viewportW` 推導，勿再寫死 490／420**（app.jsx 頂部 `nameColWidth`／`reportPanelWidth`／
  `STICKY_LEAD_W`；`frozenW = STICKY_LEAD_W + nameW`）。投影機／筆電（1366）下寫死的「凍結欄 490＋看板 672」
  會吃掉 85% 畫面寬，中間甘特只剩 6 欄。1920 時公式算出來仍是原本的 420/672，桌機畫面不變。
- **團隊總結看板＝右側整條欄位**：看板本身 `fixed top-0 right-0 bottom-0 z-[120]`（從視窗最頂端蓋到最底端，
  連 header 的管理／登出一起蓋住——要用那些按鈕先關看板即可，這是刻意的視覺取捨），
  **主內容區同步 `marginRight: reportPanelW` 內縮**，所以工具列與甘特完全不會被蓋到。
  ⚠ 關鍵是「fixed 疊層」與「內容內縮」**必須成對**，只做其中一邊就是下面列的那些坑：
  ①純 `fixed` 疊上去 → 甘特容器維持整個視窗寬，`scrollLeft` 上限只夠把最後一週推到**視窗**右緣
  （正好被面板蓋住），年底區間永遠捲不出來，「置中」也中到面板底下。
  ②只做外層內容區 `marginRight`（面板不 fixed）→ 上方兩條 `flex-nowrap + overflow-x-auto` 工具列被壓窄，
  各吐出一條橫向捲軸。**內縮一定要搭配下一條的「工具列收控制項」**。
  ③改成只縮捲動容器（工具列維持整寬）→ 捲軸沒了，但工具列右半（週檢視／年度總覽／成果清單／密度切換）
  被面板蓋住，高階主管要切換得先關看板。
  ④曾一度把面板改成 flow 內的分割欄位（非 fixed）→ 面板參與版面流，根容器沒有明確高度時整棵樹會被它的內容
  撐到數千 px（實測 5045px），`flex-1` 分不出高度、面板內部的 `overflow-y-auto` 捲不動；
  且面板只能從工具列下方開始，做不出「整條到頂」的視覺。現行改回 fixed 就沒這問題，
  根容器維持 `h-screen`（登入／載入／錯誤畫面用 `min-h-screen`）＋內容欄 `min-h-0` 仍保留，對內部捲動較穩。
- **兩條工具列跟著主內容區一起內縮，不是跨整個寬度**：整寬時「週檢視／年度總覽／密度切換」那排會右對齊到
  看板正上方，看起來不知道屬於誰、也離甘特很遠（實測 x=1401 → 內縮後 x=729）。
- **內容區變窄後，工具列要收起「找資料」的控制項**，否則 `overflow-x-auto` 又會吐捲軸。
  收：搜尋框、a~e 類型晶片（有殘留條件時**保留已選中的那顆＋清除鈕**，否則使用者不知道畫面為何只剩部分專案）、
  全隊狀態晶片（看板裡每人的分段條已表達更細的同一組資訊）、鍵盤提示。
  留：⏰即將到期（行動項）、甘特條色義圖例（讀圖必需）、年度／檢視切換／密度／展開收合（要能隨時切）。
  關閉看板即全部復原。
  ⚠ 寬度變化**不要加 CSS transition**：動畫期間 `clientWidth` 還在變會算錯置中位置，且嵌入式／背景分頁環境
  transition 可能不推進，寬度會永遠停在起始值（實測踩過）。
- 置中公式＝`scrollLeft = (wk-1)*weekW + weekW/2 - (clientWidth - frozenW)/2`；超出範圍時瀏覽器自動夾住，
  年底幾週自然變成靠右顯示（看得到但無法置中，符合預期）。可視寬改變（開關看板／視窗大小／接投影機）要重新置中。
- 團隊總結看板不列入 `isAnyModalOpen`：它是側邊疊加面板不是輸入型視窗，主管講評時要能邊看邊用 ←→／H 平移甘特
  （ESC 關窗優先序仍保留它）。
- 鍵盤：`H`/Home 回本週、`←→` 平移 4 週（Shift=1 週）、ESC 由外而內關最上層視窗（新 Modal 要加進
  `closeTopModal` 優先序清單；中文組字 `isComposing` 略過）。
- 檢視偏好 localStorage `gantt_prefs`（compact/overview）；登入身分 `gantt_login`（重整還原、登出清除）。
- 60 秒靜默輪詢 refreshData 同步他人變更；搜尋/類型篩選啟用時拖曳排序暫停。
- **輪詢暫停條件與 `isAnyModalOpen`**：`isAnyModalOpen` 提到元件層，**輪詢與鍵盤快捷鍵共用同一份判斷**
  （原本只在 keydown handler 裡算，輪詢完全沒擋 → 兩邊會各自漂移）。暫停時機有二：
  ①拖曳排序中（刷新會重排 projects，拖到一半位置會跳掉）
  ②任何彈窗／面板開啟中——`refreshData` 整包換掉 `projects`／`taskLogs`，而使用者正在彈窗裡看的就是那份資料。
  打到一半的字**不會**被抹掉（表單值是開窗當下 `useState` 初始化的，之後不再同步 props），但畫面上的對照資料
  會在眼前跳動（「前幾週回報」、排程、評分），且使用者是看著舊資料做決定、送出時覆蓋新值
  ——**這就是 last-write-wins 的實際發生路徑**。
  ⚠ **團隊總結看板（`showWeeklyReport`）刻意不列入**（與快捷鍵的例外一致）：它是唯讀側邊面板，
  主管講評時反而**希望**看到成員陸續回報進來，暫停等於把看板凍住。
  ⚠ 關窗後的補刷**只在暫停真的跨過一個輪詢週期（≥60 秒）時才做**（`pausedAtRef` 記暫停起點）：
  存檔類操作本身已經 `await refreshData()`，關窗再無條件打一次 bootstrap 會讓**每次存檔都變成雙倍請求**
  （bootstrap 是整包載入的重端點）。
- **輪詢失敗要看得見（2026-08-10）**：原本是 `refreshData().catch(() => {})`，後端重啟／斷網時畫面停在舊資料
  **零提示**（實測連續 31 次 `ERR_CONNECTION_REFUSED` 而畫面毫無異狀）；使用者看著過期資料做判斷，
  直到按下儲存才發現失敗——而那時他已經用舊資料覆蓋新值。現行＝計數與時間戳埋在 `refreshData` 內
  （所有呼叫點自動涵蓋，失敗時**仍要 `throw`**，`loadBootstrap` 靠它顯示 ErrorScreen），
  連續失敗 **≥2 次**（≈2 分鐘）才在 header 亮出琥珀晶片「⚠ 連線中斷，畫面為 HH:mm 的快照」＋「重新連線」。
  ⚠ 放 header 不放工具列：工具列在看板開啟／成果清單時會收控制項，而這是系統級狀態，任何情境都必須看得到。
  ⚠ 文案要講「資料有多舊」而不只是「連線失敗」——使用者真正要判斷的是能不能相信畫面上的數字。
- **會把畫面整個擋住的請求要有 timeout**（`apiGet(path, { timeoutMs })`）：`fetch` 對「連得上但伺服器不回應」
  （例：IIS 正在回收）**不會 reject**，catch 永遠等不到。權限閘門 `if (!accessCheck) return <LoadingScreen/>`
  因此會永久轉圈且無提示（使用者唯一出路是自己想到按 Ctrl+F5）。現行＝15 秒逾時 → ErrorScreen＋重試。
  ⚠ 逾時**不比照既有 catch 直接放行**：catch 是「明確被拒絕／連不上」，逾時是「不知道伺服器怎麼了」，
  未知狀態下自動放行等於把權限閘門變成裝飾（維持 fail-closed）。

**Modal／Toast 規範**
- 遮罩**不綁點擊關閉**（防誤點遺失輸入）；例外：無輸入的下拉選單（如 ⚙️ 管理）可點外關。
- 表單三件套：①`saving` 防連點（「儲存中…」+disabled）②`markModalDirty()`＋`useModalDirtyReset()`
  （ESC 遇未儲存跳「放棄未儲存的內容？」）③新 Modal 沿用。
- **④Enter 送出 `onEnterSubmit(submit)`**：所有**單行 `<input>`** 都要掛（`textarea` 不可掛——那裡 Enter 是換行）。
  多個送出目標時綁對應的那個（如 TaskModal 的排程欄位綁 `submitSchedule`，不是打卡）。
  ⚠ 原本只有成員管理／瀏覽權限支援 Enter，其餘四個表單都沒有 → 同樣是單行表單卻兩種行為，
  使用者在一處養成習慣、換一處就以為當掉。
- 🚨 **中文組字判斷一律用 `isComposingEvent(e)`，絕對不要寫 `e.isComposing`**（2026-08-10 修）：
  React 18 的 `SyntheticKeyboardEvent` 介面只複製 key/code/location/repeat/修飾鍵/charCode/keyCode/which，
  **沒有 `isComposing`** → 在 React 的 `onKeyDown` 裡取到的永遠是 `undefined`，整個防護等於沒寫。
  實測：對輸入框派發 `isComposing=true` 的 keydown（原生事件確認帶得到），表單照樣送出、彈窗關閉、POST 發出。
  影響過全部 6 處（`onEnterSubmit`＋瀏覽權限 3 處＋成員改名）——使用者打「專案」按 Enter 選字時會把半成品送出去。
  `isComposingEvent` 會優先讀 `e.nativeEvent.isComposing`。
  ⚠ 例外：`document.addEventListener` 那種**原生**監聽器（全域快捷鍵）拿到的是原生事件，可以直接讀 `e.isComposing`。
- **⑤必填欄位掛 `<ReqMark />`**（紅色 `*`），與「本週回報中心」既有的必填語彙一致。
  判斷依據＝`submit()` 裡會擋下來的欄位；沒有驗證就不要標。讓使用者填之前就知道，而不是按了送出才被擋。
- **⑥焦點管理 `useModalFocus()`**：回傳值展開到最外層容器 `<div {...focus} className="fixed inset-0 …">`，
  元件頂層先 `const focus = useModalFocus();`。已套用全部 15 個彈窗／側邊面板（17 個容器），新視窗必須沿用。
  它做三件事：開啟時焦點移入（**已有 `autoFocus` 的輸入欄優先，不搶走**；沒有就聚焦容器本身，
  刻意不自動聚焦第一顆按鈕以免 Enter 誤觸「關閉／刪除」）、Tab／Shift+Tab 鎖在視窗內、關閉還原到觸發元素。
  修正前實測：打卡彈窗開啟後焦點仍在背景按鈕，背景有 **306 個**可聚焦元素，Tab 會跑到甘特條上。
- **⑦圖示型按鈕一律要 `aria-label`**：沒有文字的鈕（✕、‹ ›、🌙、登出、★）讀螢幕器只念得出「按鈕」。
  彈窗右上角的關閉鈕已抽成共用元件 **`<CloseButton onClick={} className={} />`**（全站 17 處），
  新彈窗直接用它，不要再複製那段 ✕ 的 SVG——集中一處才不會下次又漏掉 `aria-label`。
  裝飾性 SVG 要掛 `aria-hidden="true"`（語意由 `aria-label` 提供），否則會被重複朗讀。
- **非 `<button>` 的互動元素用 `clickable(onActivate, label, opts)`**（`{...clickable(...)}` 展開到元素上）：
  補 `tabIndex=0`、`role="button"`、`aria-label` 與 Enter／Space 啟動。**Space 一定要 `preventDefault`**，
  否則頁面會捲動、使用者以為沒反應。已套用：成果清單排序表頭、甘特成員群組列、甘特條、看板成員列、看板任務卡。
  ⚠ `opts.role = null` 代表**保留元素原生語意**：`<th>` 改成 `role="button"` 就不再是 `columnheader`，
  讀螢幕器不會當它是欄位標題、`aria-sort` 也失效——那種情況只要「可聚焦＋可按 Enter」即可，
  名稱沿用 th 內文，排序狀態改用 `aria-sort="none|ascending|descending"` 播報。
  折疊類的再帶 `opts.expanded` 產生 `aria-expanded`（甘特群組列、看板成員列）。
  ⚠ **不要把顏色／進度條這種純視覺資訊留在 `title` 裡**：看板成員列的分段進度條原本只有視覺，
  現在把「已回報 3/3（有執行 1・Monitor 1・未執行 1）／未回報 0」寫進 `aria-label`，讀螢幕器才拿得到同樣的資訊。
- **甘特圖的「週次表頭格」刻意不加入 Tab 順序**：53 個格子會在使用者碰到內容前塞 53 個 Tab 停留點，
  而切週已有等效且更好的鍵盤路徑（`←→`／`Shift+←→`／`H`／header 的週數輸入框），
  加了只會變慢不會變好。甘特條則相反——它是開啟打卡彈窗的唯一入口，沒有替代路徑，所以必須可聚焦。
- **甘特條走 roving tabindex（`clickable` 的 `opts.roving`）**：107 條全部 `tabIndex=0` 時，鍵盤使用者
  要按 107 次 Tab 才穿得過甘特區。現行＝整區只留**一個** Tab 停留點（`data-roving-group="gantt-bar"`），
  進去後用 **↑↓** 移動、Enter 開啟打卡彈窗。
  ⚠ **只收 ↑↓，不可收 ←→**：`←→` 是全域「平移甘特 4 週」，佔用等於拿掉一個沒有替代路徑的操作。
  ⚠ **tab stop 的更新不能只靠元素的 `onFocus`**：焦點事件在「文件本身沒有焦點」時**完全不會派送**
    （背景分頁／嵌入式檢視；實測 `document.hasFocus()=false` 時連一般 `<button>` 的 focus 事件都收不到），
    那時 tab stop 會留在原地，使用者 Tab 出去再回來會被丟回第一條。故 `move()` 內要**同時**呼叫
    `opts.roving.onRove(next.dataset.rovingId)`。因為 id 會經過 DOM 屬性（字串）與 `onFocus`（原值）兩條路，
    `activeRovingTaskId` 的比較一律轉 `String()`。
  ⚠ 篩選／收合把當前那條藏起來時要**退回第一條**，否則整區會變成 0 個 Tab 停留點＝鍵盤進不去。
- **Toast 的讀螢幕器播報區必須「常駐」在 DOM**：live region 若跟著 toast 一起插入再移除，多數讀螢幕器
  **不會播報**（toast 最常見的無障礙坑）。現行＝兩個常駐的 `sr-only` 區塊只換文字不換節點：
  錯誤走 `role="alert" aria-live="assertive"`（打斷當下朗讀，操作失敗必須馬上知道）、
  一般走 `role="status" aria-live="polite"`。視覺 toast 的文字另掛 `aria-hidden` 避免念兩次，
  但**操作鈕（↩ 復原／✕ 關閉）不可藏**，那是鍵盤使用者唯一的觸發點。
- **ESC 是「焦點在表單元素時略過快捷鍵」的例外**：其餘快捷鍵（H／←→）在 INPUT/TEXTAREA/SELECT 上要略過，
  但 ESC 在輸入框裡的語意就是取消。加了焦點鎖後 Tab 會走進輸入框，不設例外就會關不掉視窗（實測踩到）。
- Toast：`❌` 開頭自動視為錯誤（6 秒+紅框+✕）；`showToast(msg, {action})` 顯示動作鈕。
- 週次 input `max` 用動態 `weeksTotal`（2026=53 週），勿寫死 52。

**視覺規範（範本 B 高對比＋投影友善）**
- 專案名稱近全黑 `text-slate-900 font-semibold`；狀態色 green-700/sky-700/slate-500；次要文字至少 slate-600。
- 投影友善：彩色晶片帶 400 級以上實線邊框、文字 700~800 級、不用 opacity 淡化、深色底白字 ≥75%。
- **投影機是比螢幕嚴苛的環境，驗色要用投影模型**：會議室有燈時 on-screen 對比只剩 30~50:1（螢幕 1000:1+），
  環境光相當於在畫面疊一層亮度地板 `L' = L×(1−1/C) + 1/C`。螢幕上 4.6 的小字投影後只剩 4.0。
  ⚠ 因此**次要文字不可用 Tailwind 原生 slate-500**：淺色下已改寫為 `#556274`（`input.css` 最上方，
  投影 50:1 白底 5.62／slate-100 底 5.14），與 slate-600 仍差 1.22 保住層級。新增次要文字沿用即可。
  ⚠ **深色的次要文字同理，但解法是「改用 slate-600」而不是動色階**（2026-08-10）：深色投影 50:1 原本有 24 項
  不合格，其中 **21 項是甘特週次列 W33–W53 的 `text-slate-500`**（落在 `bg-slate-100`＝`#334155` 上只有 3.99）。
  已把那批（未來週次、鍵盤提示、`|` 分隔）改成 `text-slate-600`；「顯示 n/n 項」因為坐在更亮的 `bg-slate-200`
  （`#3E4C61`）上，要再上一階到 `text-slate-700`。
  ⚠ **不要為了這個去調整 `.dark` 的中性文字階梯**：700/600/500/400 是全站 8000+ 文字元素驗過的階梯，
  把 500 提到 4.5 會壓縮到與 600 只差 1.06（現行相鄰階差 1.22~1.29），層級會糊掉。針對性換 class 才是對的。
  淺色的 `⏰ 剩N週` 晶片（9px）同理：`text-orange-700` 投影 50:1 只有 4.18，改 `text-orange-800`＝5.64。
  實測基準（2026-08-10 修正後，全檢視）：淺色 螢幕 0／投影50 0／投影30 1；深色 螢幕 0／投影50 **0**／投影30 47。
  （投影 30:1 是「開燈會議室」的極端值，非本專案的驗收標準；深色 30:1 那批全是 4.41 的 `text-slate-600`，
  要清掉就得動色階，已評估後不做。）
- 工具列 `flex-nowrap + overflow-x-auto + [&>*]:flex-shrink-0` 不換行；操作元件小尺寸（11px、py-1），內容區大字。
- **鍵盤焦點外框**：Tailwind preflight 會把 outline 全清掉（實測 `outline-style: none`），`input.css` 已補回
  全域 `:focus-visible`（**不是 `:focus`**——滑鼠點擊不出現外框，只有鍵盤操作才顯示，不影響滑鼠體感）。
  深藍 header／表頭上的控制項改用亮金 `#FDD075`（對 `#001F5B` 對比 10.73；藍框只有 3.04），
  深色模式的 header 底色不變，故 `.dark header …` 要一併指定，否則 `.dark`（0,1,0）會蓋掉 `header`（0,0,1）。
- 主管 header 只留高頻鈕（🛠 編輯回報／📊 團隊總結），低頻管理入口一律加進右上「⚙️ 管理 ▾」選單。
- 甘特斑馬紋（sticky 欄同步上色）；圖例常駐可見（閱讀輔助資訊不藏 tooltip）。

**其他行為**
- `API_BASE` 執行期自動偵測部署根路徑（IIS 子目錄相容），勿寫死。
- 離線策略：連不到後端顯示 ErrorScreen，不塞假資料。
- 補登機制：主管開關開啟時成員可修非當週（PendingPanel retro 琥珀樣式）；主管常駐 ManagerWeekPanel 代修
  任一成員任一週（顯示「✏️主管修正」標記）；最後編輯資訊統一用 `MetaLine` 元件。
- 團隊總結看板：成員預設「只看我的週報」、主管預設全隊折疊；卡片常駐「📋 複製週報」。
- **依情境收控制項（兩組條件，新增入口時一併判斷）**
  ①**成果清單＝全年度視角** → `!isResults` 隱藏所有「當週」控制項：header 的**系統週數選擇器**、
  主管「🛠 編輯 W.. 回報」、成員「📋 本週回報中心」／「🕘 修改 W.. 回報」、「📊 團隊總結」、
  「🔒 僅限當週／🔓 補登 ON」（它管的是當週打卡權限）、展開／收合。
  ②**看板開啟＝「檢視本週已完成工作」的唯讀情境** → `!showWeeklyReport` 隱藏所有**編輯／跳出情境**的入口：
  「🛠 編輯 W.. 回報」（成員的兩顆同理）、「成果清單」（跳到全年度視角）、
  「🔒 僅限當週／🔓 補登 ON」（改寫入權限的系統設定，誤點會直接對全體開放歷史補登）、
  全隊狀態晶片與「⏰ 即將到期」（前者在看板裡已被每人的分段條拆得更細＝重複資訊，後者會開另一個面板跳出情境）。
  ⚠ 收整區時**連同前面的分隔線一起收**，否則工具列會留下孤立的豎線。
  兩組都保留 ⚙️管理／深色／登出，以及**看板情境下仍需要的**系統週數（切週會同步換看板內容）、
  週檢視／年度總覽、密度切換、回到本週。分段控制少一段不影響外觀（圓角與邊框在容器上）。
- **看板只屬於甘特類檢視（週檢視／年度總覽），成果清單不提供**：看板是「配合甘特圖講評本週」用的
  （點卡片會去高亮甘特區間），成果清單是全年度產出總表、沒有甘特可對照，開了只會把清單擠窄。
  ⚠ 只隱藏入口鈕擋不住「看板開著時切過去」這條路徑，切換到成果清單時必須**一併關閉看板**，
  並清掉看板造成的殘留狀態（`highlightedTaskId`、被聚焦到單一成員的 `ownerFilter`）——
  否則成果清單會莫名只剩一個人的專案（實測：高亮後 ownerFilter＝「裕隆」，切過去要還原成 `all`）。
  **標題與成員列一律不斷行**：標題 `whitespace-nowrap`＋窄面板改短標題（「團隊總結」）；成員列每個元件
  `flex-shrink-0`、只有姓名 `min-w-0 truncate`、容器 `overflow-hidden`。面板窄化分兩級
  （`narrowPanel<560` 縮短文字＋縮 gap／`tightRow<440` 省略回報數文字）。沒有這層保護時面板一窄整列就
  各自換行（姓名、按鈕都被拆成兩行，列高從 41 暴增）。看板寬度下限 400＝成員列放得下所有元件的最小寬。
- **操作鈕不用 emoji、不縮字**：10px 的 📋／💬 只是彩色色塊，認不出功能；**拿掉 emoji 省下的寬度剛好夠放
  完整四字標籤**（實測只差 5px），所以任何面板寬度都寫全名「複製週報」「主管回覆／✓ 已回覆」。
  並排的兩顆鈕要**用色系區隔**（中性＝複製、紫＝回覆，紫是全站「主管回覆」既有語彙），否則兩顆灰鈕分不出誰是誰。
  ⚠ 邊框一律 **500 級**：`border-slate-400` 在淺色 slate-200 列上只有 2.08，鈕會看起來像 disabled；
  500 級＝淺色 3.86／深色 3.07。（emoji 只留給**單一**用途明確的晶片，如 `📅 下週預計未填`。）
- **折疊摘要只標「例外」，不標常態**：原本一列同時掛 ✅n／👁️n／❗n／📝／📅／💬 六顆晶片＝視覺噪音。
  現行＝①**分段進度條**一條表達回報率＋狀態分佈，取代前三顆；②「下週預計」是強制項故**未填才亮** `📅 未填`；
  ③非專案為選填、主管回覆已由右側按鈕的紫色狀態表達，都不再開晶片（成員視角看不到該按鈕，才補一顆 💬）。
- **「已回報／未回報」用「有填／沒填」區分，不要用顏色深淺，更不要用警示色**：分段條三段已回報一律**實心**
  且直接取 `STATUS_META[k].dot`（green-700／sky-700／slate-500，與甘特條、狀態晶片同源，改一處全站同步）；
  **未回報不畫任何填充**，留空槽（`BAR_TRACK`）。條填滿多少＝回報多少，是最直覺的讀法。
  兩次踩坑：①未執行淺灰實心＋未回報琥珀實心 → 只差顏色深淺，「未執行」被讀成「沒交」
  （它其實**有回報**、只是本週沒做＝要追原因；「沒交」＝要催，是兩種處置）。
  ②改成黃黑警示斜紋 → **週中「還沒回報」本來就是常態**，週一開看板整片警示膠帶，真正的警訊反而失效。
  現行把警示收斂到**單一通道＝數字**（`0/7` 轉 `text-amber-800`）。
  ⚠ 空槽要「看得出是個空容器」：軌道必須有外框（`border-slate-500`，淺 3.86／深 3.07），
  且**深色軌道要壓到 slate-900**——用 slate-700 時「未執行實心」對空槽只有 2.18，分不出有填沒填。
- **進度條填色用 `STATUS_META[k].fill`（淺色 600／深色 500），不要用 `dot`（700）**：700 級擠在小色條裡
  又暗又悶（使用者實際回饋）；軌道淺色用**白**、深色用 slate-900，整條才輕透。
  ⚠ 不可只寫 600 就了事：`.dark .bg-green-600` 是給「實心動作按鈕加深」用的（→#166534 墨綠），
  沒有 `dark:` 變體會被壓暗；`bg-slate-400` 深色同理被壓成 #475569（對空槽只有 2.41），
  故「未執行」深淺兩邊都用 slate-500。實測 淺 3.30／4.10／4.76（投影 3.15／3.86／4.43）、
  深 7.83／6.44／3.75（投影 6.01／4.99／3.02）。圖例色點也用 `fill`，才會與條完全同色。
- 回報中心 🎉 只在任務＋下週預計**全部完成**才顯示。
- **打卡彈窗（TaskModal）顯示「前幾週回報」**：位置在排程卡與「W.. 實際執行回報」之間——寫的時候不用捲動就能
  對照上週寫到哪。資料取自 `logs` prop（＝`taskLogs[task.id]`，本來就在 client 端，**不需要再打 API**）；
  只取 `week < currentWeek`、新到舊。預設展開最近 3 週（`HISTORY_PREVIEW`），更多則收在「顯示全部 n 週」後面；
  清單 `max-h-56 + overflow-y-auto`，長區間展開後不會把回報區推出畫面。**沒有任何歷史就整塊不渲染**（不留空殼）。
  每列都有「沿用」鈕，把該週的**狀態＋內容一起**帶入本週草稿（`markModalDirty()`，ESC 會跳未儲存確認）。
  ⚠ 沿用鈕只在 `canClockIn` 時顯示——唯讀情境下 textarea 根本不存在，按了不會有任何作用。
  ⚠ 逐列都放沿用鈕（**歷史區逐列保留**）：可以挑任一週，行為一致。
- **另有一顆「↩ 沿用上次回報（W..・狀態）」主按鈕**（2026-08-10，在狀態選擇區上方）：最高頻的動作就是
  「照抄上一次」，走歷史區要「往上捲 → 找到最上面那列 → 點沿用」三步，這裡一步到位（`history[0]` 已是最新一週）。
  ⚠ **只在 `!status`（還沒選狀態）時顯示**：已經在編輯了才跳出來，按下去會把使用者剛打的內容覆寫掉。

**團隊總結看板**
- 主管專用「複製待回報名單（n）」（2026-08-10）：看板算得出每人「回報 0/5」，但看完之後沒有下一步——
  主管還是得自己把名字抄到通訊軟體。純前端組字串進剪貼簿（零後端成本），內容含每人缺漏項目與項目名稱。
  ⚠ 只在 `isManager && pendingSummary.length > 0` 出現：全員交齊時擺一顆按不出東西的鈕只是噪音。
  ⚠ 放**子工具列**不放標題列：標題列已有三顆鈕，窄面板（400px）再加會擠爆。

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

見 `memory.md`「目前待辦事項」（遠端遷移 10~15 確認、明碼密碼、git origin、--minify、HTTPS、rowversion、
AuditLog 亂碼 ActorName）。
