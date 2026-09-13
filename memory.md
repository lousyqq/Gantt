# memory.md — 專案現況與待辦（精簡版）

> 本檔只保留**最新狀態**與**待辦事項**。歷史修改紀錄已封存於 git 歷史（2026-07-19、2026-08-10 兩次重整）；
> DB 變更歷史**完整保留**於 `DB_table.md`（append-only，不可刪減）；架構總覽見 `系統架構.md`；開發規範見 `CLAUDE.md`。

## 專案概況（2026-08-10）

MSD 專案追蹤總表：ASP.NET Core 9 Minimal API＋React SPA＋SQL Server。
成員每週對甘特圖上的計畫區間打卡回報（含下週預計必填、非專案選填），主管管理專案／區間／成員、
評分、週報回覆、歷史補登、瀏覽權限、使用統計；高階主管走成果清單（★重點關注＋產出/MP Saving＋NID）與 Excel 匯出。
專案有選填 NID（流水編號，一專案可含多組），計畫區間有選填 NID（對應哪組）。
全功能已上線運作中，操作皆有 AuditLog 稽核（含 Windows 工號），異動紀錄以白話呈現。

- **使用者**：6 位成員＋管理部主管；登入畫面點選（身分持久化 localStorage），Windows 工號由 `/api/whoami` 自動偵測。
- **年度**：2026（53 週）為主，2027（52 週）已建；開新年度 `EXEC dbo.usp_EnsureScheduleYear <年>;`。
- **環境**：開發＝Sariel\Gantt（另有 Gantt2 測試庫）；遠端正式主機基準＝old.sql+new.sql，增量遷移 10~17。
- **系統開關現況**：`AllowRetroCheckin=false`、`AccessControlEnabled=false`（本機留示範規則 DEPT_3=MSD 一條）、
  子區間打卡 `appsettings.json` `Features:SubIntervalCheckin=false`（2026-09-12 加入，只能改檔、不在網頁上）。
- **深色模式／版面自適應／無障礙**：已完成三輪稽核並定案，細節與所有「踩過的坑」全部寫在 `CLAUDE.md`
  （中性表面階梯、彩色亮度階梯、投影機對比模型、凍結欄與看板寬度公式、焦點管理與 `clickable`）。
  現行實測基準：**淺色 螢幕 0／投影50 0／投影30 1；深色 螢幕 0／投影50 0／投影30 47**
  （深色 30:1 那批全是 4.41 的 `text-slate-600`，要清掉得動全站色階，已評估後不做）。

## 最近一次變更（2026-09-13 夜：⚙️ 管理選單「歷史補登」項目改名＋名稱統一）

**使用者問**「這個名稱是否需修正」（截圖：`🔒 歷史補登：僅限當週／點擊開放全體補登歷史週次`）→ 需要，兩個問題：①標籤寫狀態、
點下去做相反的事，其他四項都是動作；②同一功能三個名字（選單「歷史補登」、橫幅「豁免期」、toast「調正歷史進度」）。
**改法**（純前端 `app.jsx` 五處＋手冊六處）：選單標籤改動作、小字改現況——關：`🔓 開放歷史補登／目前：僅限當週回報`、
開：`🔒 關閉歷史補登／目前：開放中，全體可補登歷史週次`（琥珀底照舊）；橫幅文字「系統已開放「歷史補登」：…」、按鈕「關閉歷史補登」；
toast「🔓 已開放歷史補登，全體成員可回報歷史週次」「🔒 已關閉歷史補登，僅限當週回報」。手冊 §歷史補登開關、§補登（成員）、
§主管代修、FAQ、名詞表全部改「歷史補登」，不再出現「豁免期」。文件：CLAUDE.md 補登總開關條追加兩條 ⚠。

## 上一次變更（2026-09-13 夜：子區間甘特列三項 UX 補強）

**使用者問**「子排程的甘特圖顯示有更推薦的 UIUX 優化嗎」→ 提四項、做了前三項（第四項 hover 父⇄子互標未做，底帶已表達八成）：
1. ~~收合時父條頂端畫子區間縮圖~~ **已拆掉**：做了一版（每個子區間一段 3px teal 細帶在父條頂端），使用者收合後回報
   「計畫區間怎麼會變成上圖？請修正」——子區間 W06–W48 幾乎與父條等長，細帶讀起來是父條多了一道綠邊／壞掉。
   結論寫進 CLAUDE.md：父條只有一種樣式，收合狀態靠 `▸ n`＋tooltip 子區間清單，不在條上疊附加標記。
2. **名稱欄 `└` 改成樹狀導引線**：每列一個 `└` 在 10 筆時每列都像最後一筆、父列捲走後不知道屬於誰。改成一條 `border-slate-400`
   直線貫穿子列、最後一列只到 50% 自然收成 └，橫向 7px 短線接名稱；最後一列底線 `border-slate-300`（其餘 200）標出群組結尾。
   `subIndent` 週 40／總覽 16、`guideX = subIndent - 10`。純 CSS、`aria-hidden`。
3. **子條 hover／tooltip 比照父條**：原本滑過毫無反應、只有原生 `title`（延遲 1 秒、不含回報內容）。補 `shadow-sm transition-transform
   hover:scale-y-110`，接同一套 `showTooltip(e, proj, task, sub)`（多帶 `subInfo={sub,isUnit,log,history}`，來自 `subLogs`、
   受 `SUB_CHECKIN` 控）；tooltip 子區間清單把滑到的那條標 `▸`＋teal 粗體、下方加該子區間本週狀態／說明／📎／歷史區塊；
   原生 `title` 拿掉（兩個會疊）。凍結欄名稱的 `title` 保留。
實測 1600×900：週檢視 ├／└ 導引線與結尾粗線正確、tooltip 文字含「▸ 測試1」＋「└ 測試1 / 👁️ 本週 W37：Monitor」、
深色導引線 `#64748B` on `#1E293B`；拆掉縮圖後收合的父條回到純奶油斜紋（實測 teal 子節點 0 個）。`npm run build`／check:dark 通過。
文件：CLAUDE.md 子區間段（縮圖／導引線／hover 三條）、手冊 §子區間。

## 更早一次變更（2026-09-13 夜：子區間條改為「一種樣式、不分階段」）

**使用者兩次回報**（皆附截圖）：①「子排程變成實心綠色」——第四批定的進行中 `#99F6E4` 實心在全是斜紋的圖上是唯一實心飽和色，
讀起來像「進度填色」→ 先改成斜紋深框；②「上下兩邊子排程顏色不一致」——進行中（斜紋深框）與已結束（淡斜紋淡框）並列時，
使用者直覺是「壞掉」而非「兩個階段」。
**定案**（純前端）：子條**只有一種樣式**＝斜紋 `#CCFBF1`/`#99F6E4`＋`rgba(15,118,110,0.75)` 1px 框，與父條完全同構造只換色相；
不再依 `todayWeek` 分未開始虛線／進行中／已結束（父條本來就不分階段），階段只留在 tooltip 的 `phaseLabel`。`phase` 變數仍算、只給 tooltip 用。
圖例「子區間」色塊同款、title 改「滑過條可看未開始／進行中／已結束」。實測 4 條子條 computed 一致
（`repeating-linear-gradient(45deg, rgb(204,251,241) …)`＋`1px solid rgba(15,118,110,0.75)`）。`npm run build`／check:dark 通過。
文件：CLAUDE.md 子區間兩條改寫、手冊 §子區間顏色。
**第三次回報**：「子排程是不是該比計畫區間淺一點才有主從層次」——分析後不是整條調淺，而是暗條 `#99F6E4` → `#BDF7EC`：
父條斜紋 ΔL 0.03、子條原本 0.10（3 倍）紋路太吵才顯得比父條重；亮條與邊框深度本來就一樣。整條調淺會融進奶油底帶
（亮條 L .88 vs 底帶 .92），且子條是打卡入口不該變淡。只改甘特條＋圖例兩個 hex，構造不變。

## 更早一次變更（2026-09-13 夜：A-5 概況列四顆狀態晶片都可點篩選）

**做法**（純前端）：`pendingOnly` 布林改成單一 `statusFilter`（`null|'pending'|'executed'|'monitor'|'not_executed'`，
`toggleStatusFilter(key)` 點同一顆取消、點另一顆換條件——**單選**，四者是同一批回報單位的分割）；分類抽成 `app.jsx` 頂部的
`unitMatchesStatus(unit, key)`＋`STATUS_FILTER_LABEL`，與 `weekStats` 同一套規則。`StatChip` 加 `ringClass`（選中 ring 與晶片同色相）。
`pendingOnly` 保留為衍生值給 🎉 空狀態；`isFilteringRows`／`activeFilters`（「只看有執行」＋清除鈕）／登入登出／切成果清單
全改走 `statusFilter`。看板開啟或窄螢幕收起晶片時，**篩選中的那顆各自留著**（`statusChipsVisible || statusFilter === key`），
「未回報」比照（`!showWeeklyReport || pendingOnly`）。
**實測**（1366、W28 有資料）：有執行 2/69、Monitor 3/69、未執行 0→`EmptyFilterState`「只看未執行＋清除鈕」、未回報 22/69、
再點取消 69/69；篩選中 69 個拖曳把手 → 0＋3 個「無法拖曳」鎖；開看板時只剩「有執行 2 ✕」一顆、無篩選時整區收起、ESC 關看板後
四顆回來；概況列 scrollW＝clientW（1366／888 皆無橫向捲軸）；ring computed `rgb(3,105,161)`（要先關 transition 才量得到，
Browser pane 老問題）；console 無錯誤。`npm run build`／check:dark 通過。文件：CLAUDE.md「未回報」晶片條改寫、手冊 §03／§11。
**A 群剩**：A-1 週次加日曆日期（與待辦 0 合併、遷移 21）、A-2 甘特條拖曳改期、A-3 排程變更 ↩ 復原。

## 前一次變更（2026-09-13 夜：系統內加「使用手冊」入口，手冊移進 wwwroot）

**背景**：使用者問「與一般企業甘特維護工具比還有哪些 UX 可優化」，列了 A（5 項優先）／B（7 項評估）／C（不建議）三群；使用者先拍板做 A-4。
查證發現 `使用者手冊.html` 在專案根目錄、`wwwroot/` 沒有、`app.jsx` 也沒有任何連結——13 章手冊實際上沒有入口。
**做法**：`git mv` 手冊到 `wwwroot/使用者手冊.html`（publish 自動帶上）；header 帳號區（深色切換左邊）加書本 SVG 圖示 `<a target="_blank">`
（成員／主管都看得到，⚙️ 管理只有主管有），href＝`${API_BASE}/使用者手冊.html?role=member|manager&theme=dark|light`；
手冊 JS 補讀 `?role`（有效值才套、寫進 `msd_manual_role`）與 `?theme`（只蓋這次、不存）。手冊 §03 畫面導覽表補「使用手冊」圖示。
**實測**：link `aria-label`＋`rel="noopener noreferrer"`、點擊區 28×32、fetch 200；`?role=manager&theme=dark` → data-theme=dark、主管鈕 pressed；
`?role=member&theme=light` → 隱藏 s-proj／s-score／s-admin／s-results。`npm run build`／check:dark 通過。
⚠ 順帶看到（非本次造成、未動）：本機 `appsettings.json` 目前 `SiteDefault` 指向 `Gantt_IMD` 且 `SubIntervalCheckin=true`（使用者自行改的），
該庫 `POST /api/login-log` 回 500（fire-and-forget，畫面無感），推測缺 `usp_LogLogin`（登入統計遷移未套用到 IMD 庫）。
**A 群其餘待做**：A-1 週次加日曆日期（與待辦 0 合併、遷移 21）、A-2 甘特條拖曳改期、A-3 排程變更 ↩ 復原（A-5 已於同晚完成，見上）。
B 群：里程碑、凍結欄可選欄位、專案層級異動紀錄（`audit-log` 加 `entityId`）、批次平移、主動提醒、單筆回報主管備註、baseline ghost 線。

## 前一次變更（2026-09-13 晚：年度總覽計畫條加上區間名稱）

**使用者問**：總覽的計畫區間要不要加文字、企業一般會不會加、怕塞不進去。**答**：會加（MS Project／Smartsheet／PPT 年度計畫圖
慣例＝條內寫名、塞不下截斷、完整名稱 hover），且用開發 DB 2026 的 107 條區間實算：最短 3 週、8 成 ≥4 週，
1920 全部塞得下、1366 開看板 79%。使用者拍板加。
**做法**：[app.jsx](ClientApp/app.jsx) 甘特條的 `{!isOverview && <span>…}` 守門拿掉，總覽用 `text-[9px] leading-none px-1`
（週檢視 12px／緊湊 10px 不變），其餘沿用既有 `truncate`＋tooltip。子區間列不加、單區間專案名稱重複也照加。
**實測**：1920 總覽 104/105 完整顯示（截斷只有 2 週的 `eUSPC SQL`）；1366＋看板（週欄 12.4px）83/105，截斷者仍看得到前幾字；
9px 文字不撞底部色點。`npm run build` 通過、check:dark 通過。文件：CLAUDE.md（年度總覽節）、使用者手冊（檢視表格）。

## 前一次變更（2026-09-13 下午：多站台部署——同一份程式依 IIS 路徑選 DB 與群組名稱）

**背景**：使用者已在遠端主機以同一套程式發佈四個 IIS application（`/Gantt`＝MSD、`/Gantt_IMD`、`/Gantt_EMS1`、`/Gantt_EMS2`，
四個 DB `Gantt`／`Gantt_IMD`／`Gantt_EMS1`／`Gantt_EMS2` 同主機、日後可能拆），每次發佈都得逐一改連線字串與寫死的「MSD」。
先評估三條路（A 各用各的部署／B 單站多租戶加 GroupId／C 一份部署多 DB），使用者選 A。
**做法**：`Program.cs` 新增 `ResolveSite()`——以 `Request.PathBase`（IIS application 路徑）當 key 查 `Sites:{key}` →
`{GroupName, ConnectionString}`，空／查無 → `SiteDefault`；沒有 `Sites` 段落退回舊格式。`ConnStr()` 改從它出去（`IHttpContextAccessor`，
40 個呼叫點零改動）。新端點 `GET /api/site`（不碰 DB）。`app.UsePathBase` 只在設了 `PathBase` 時啟用（本機模擬 IIS 子目錄用）。
前端：`siteName` state 打 `/api/site`，寫死「MSD」6 處全改（登入頁、header、title×2、未授權文案、index.html title）。
`appsettings.json` 改為 `Sites` 格式（只放開發 DB）；新增 `appsettings.Production.example.json` 範本（四群組、密碼留空），
正式主機自建 `appsettings.Production.json`（發佈不覆蓋）。
**實測**：根路徑 `/api/site`→MSD；以 env `Sites__Gantt_IMD__*`＋`PathBase=/Gantt_IMD` 起第二個程序，`/Gantt_IMD/api/site`→IMD、
bootstrap 走該筆連線（7 人／69 案）、登入頁顯示「IMD 專案追蹤系統」；同程序根路徑仍回 SiteDefault。`dotnet build` 0 錯誤。
**後續決定**：使用者選擇把真正的 `appsettings.Production.json` **放進專案**（已建檔、`.gitignore` 排除；實測 `git check-ignore` 命中、
`dotnet publish` 輸出含該檔），發佈自動帶上、伺服器零手動。**待使用者做**：把檔內 `<正式主機>／<帳號>／<密碼>` 換成真實值（四筆）。
文件：CLAUDE.md 新增「多站台部署」節、系統架構.md、使用者手冊 §09 末「多群組部署」。

## 前一次變更（2026-09-13 第五批：打卡彈窗依開啟來源排版面＋標題列固定）

**使用者要求**：直接點甘特圖時排程／子區間要在上面、回報在下面（並問回報是否根本不需要）；捲動時標題列被捲走。
**建議與決定**：回報區**保留**——甘特條仍是成員最常用的打卡入口（回報中心是第二條路），且主管在甘特上點本週區間會要評分／核實；
但改成**依 `info.origin` 排順序**：甘特條開（`origin:'gantt'`）→ 排程置頂展開、歷史、回報最下（非本週排定不渲染回報區，
排程卡已寫著起迄週、那句「非 W37 排定項目」是重複）；回報面板開 → 回報置頂（原 2026-09-13 重排不變）。
例外：成員點自己本週可打卡的條仍回報置頂。三區塊先組成 `reportSection`／`historySection`／`setupSection` 再決定 DOM 順序
（不用 CSS order，Tab 順序要跟視覺一致）。標題列固定：卡片 `flex flex-col max-h-[90vh] overflow-hidden`＋內容區 `overflow-y-auto min-h-0`。
實測：BSL Shift Platform（W27–W31）從甘特開 → 排程／子區間／前幾週回報、無回報區；1000×560 捲 225px 後標題列仍在 top=28；
2026 QIT 圈長（本週）從甘特開 → 排程、回報在下；同一條從 🛠 面板開 → 回報置頂、排程收合。
文件：CLAUDE.md TaskModal 版面條、使用者手冊 §打卡視窗／§子區間。

**同批追加：「儲存排程」按鈕列**（使用者問「要不要放到子區間下面」）——答：**不要**，它只送排程四欄、子區間每列各自即時存檔，
放到子區間下面會暗示連子區間一起存。改三處讓範圍自明：🗑 刪除區間改左側低調文字鈕（原本與儲存並排等寬）、儲存排程靠右且
`!scheduleDirty` 時 disabled 顯示「排程未變更」、子區間說明開頭寫「每列各自儲存（不經上方「儲存排程」）」。
`input.css` 補 `.dark .hover\:text-red-800:hover`（check:dark 抓到）。實測開窗時 disabled、改名稱後變「儲存排程」可按。

## 前一次變更（2026-09-13 第四批：子區間甘特條改 teal 青綠色）

**使用者回饋**（附截圖）：子條沿用父條琥珀色後「一眼望去看不出來是什麼」——子條、父條、奶油底帶全是黃的，只差深淺分不出層級。
**已改（純前端、`npm run build` 通過、瀏覽器實測 computed border `rgb(15,118,110)`）**：`app.jsx` 子條 `subBarStyle` 三階段改 teal：
進行中 `#99F6E4`／`#0F766E` 1.5px 實線、未開始 `#F0FDFA` 虛線 `#0D9488`、已結束 teal 斜紋 `#F0FDFA`/`#CCFBF1`＋`rgba(15,118,110,0.75)` 框；
概況列圖例「子區間」色塊同步。挑 teal 的理由＝圖上唯一沒有語意的色相（琥珀＝計畫、藍＝高亮／按鈕、綠／天藍＝狀態點、紅＝待回報、紫＝主管回覆）；
看板高亮的 `#DBEAFE` 藍照舊、與 teal 分得開。父區間底帶 `--gantt-sub-band` 維持奶油色（它表達的是「屬於哪條父區間」）。
文件：CLAUDE.md 子區間配色條、使用者手冊 §子區間顏色說明。

## 前一次變更（2026-09-13：子區間配色改琥珀系〔已於第四批推翻〕＋高亮連子列＋全域「子區間 ▾｜▸」＋打卡彈窗重排）

**使用者提問**：子排程能否動態收合？子區間甘特條藍色是否該調（點看板高亮時也是藍）？
**答**：每案的 `▾ n` 晶片本來就能收（prefs 記住）；缺的是**一鍵全收**。顏色問題＝「藍色一字三義」——進行中子條 `#DBEAFE/#2563EB`
與父條看板高亮的色值**完全相同**，點看板整組全藍分不出哪條是剛點的；藍又是全站按鈕／連結語彙。
**已改（純前端，無 DB／API 異動；`npm run build`／`check:dark` 通過，實測子列 computed style 與工具列鈕正確）**：
1. 子條**沿用父條琥珀色系、深一階**（甘特慣例＝子項繼承父項色相，深淺表層級）：進行中 `#FDE68A`／`#B45309` 1.5px 實線、
   未開始 `#FFFBEB` 虛線 `#D97706`、已結束＝**父條的奶油斜紋**（三輪定案：slate 灰在暖底帶上被看成「淺藍」→ 換 stone
   暖灰使用者仍覺得突兀——它是全圖唯一一條灰的，父條過去了也不變灰 → 已結束直接沿用父條樣式，三階段全在同一色系）。
   概況列圖例色塊同步。
2. 藍色只剩「高亮」一義，**且以回報單位為準**（第二輪：初版做成「亮父條連同全部子條」，使用者要求「點亮子區間應該只顯示
   子區間排程」）：新增 `highlightedSubId`，看板點子區間的卡只亮那條子條、點父層卡只亮父條；子列收合時自動展開；`clearHighlight()`
   統一清兩個 id；看板卡片高亮標記同樣比對兩個 id。實測點 測試用3 → 只 1 條 ring、點 測試用2 → 換那條、點父層卡 → 只父條、再點取消。
3. 工具列「展開｜收合」旁新增「子區間 ▾｜▸」（`setAllSubExpanded`，只在 `hasAnySubs` 時出現）：作用於目前檢視那份 prefs，
   實測週檢視全收 → `subCollapsed=[109]`、子列 0；全展 → `[]`、子列 3。
文件：CLAUDE.md 子區間段、使用者手冊 §子區間（顏色說明＋全域鈕）。

**同日第二批：打卡彈窗（TaskModal）版面重排**（使用者：每次都要捲到下面才能打卡）——照「使用者來做什麼」排：
①本週回報置頂 ②前幾週回報（預設收合，改到回報區下方）③排程＋子區間合併成一張折疊卡放最下面
（`setupOpen`；打卡情境預設收合、唯讀情境預設展開；排程錯誤／子區間編輯中／新增列有字時強制展開且切換鈕 disabled）。
收合時標題列摘要 `W06–W52・NID・子區間 3（進行中 2）`；header 多一行 `task.name・起迄週・NID`。
回報區常駐說明壓成一行、狀態說明改放三顆狀態鈕的 title。實測 1600×900：打卡窗 569px 不捲動（原本 1137px）、
唯讀窗（非本週區間）折疊卡自動展開、新增列打字時切換鈕 disabled 並帶提示、清空後恢復；console 無錯誤。
文件：CLAUDE.md「前端慣例」打卡彈窗兩條、使用者手冊 §5.1／§子區間三處位置描述。

**同日第三批：工具列瘦身（使用者問「版面有什麼可精簡」）**——實測 1366 寬工具列溢出 114px 吐橫向捲軸（使用者截圖右緣被切的 ▸）。
做了 1、2：①「展開｜收合」＋「子區間 ▾｜▸」四顆鈕收成一顆「顯示 ▾」下拉（`showDisplayMenu`；選單本體放工具列外、fixed 定位——
工具列 z-30 stacking context 裡的 fixed 被甘特 sticky 表頭 z-50 蓋住，實測踩到）②a~e 晶片改四字短名 `PROJECT_TYPES.short`（419→352px）。
實測 1366：scrollW 1366＝clientW，餘 101px；選單四項可用、ESC／點外關閉。
接著做了 3–5：③`displayMenuItems`——群組 <2 時不列成員群組兩項（實測選成員「裕隆」後選單只剩子區間兩項）
④圖例的三個狀態色點只在 `!statusChipsVisible` 時補回（實測：一般 554→380px；看板開啟時晶片收起、圖例補回三色）
⑤概況列標題 `W37 全隊概況`（去掉月份）。console 無錯誤。
再做 6、8（建議 7 不做——快捷鍵提示縮成圖示會犧牲可發現性，使用者同意）：
⑥🔒 補登總開關移進 ⚙️ 管理選單第一項（`🔒 歷史補登：僅限當週／🔓 歷史補登：開放中`，ON 時琥珀底；橫幅「關閉豁免期」照舊）。
  實測選單開→橫幅出現→橫幅關閉→消失，1366 工具列 scrollW＝clientW。
⑧「回到本週」已在本週時白底外框、離開本週深色實心（`isReportingWeek`），不 disabled。實測 W37 白→‹ W36 navy→H 回 W37 白。
  ⚠ 踩到：加了 `transition` 時嵌入式瀏覽器的 transition 不推進，computed 永遠停在起始白色（class 與 inline 都已切換）——已拿掉。
四份文件同步（手冊 §8.3、§09 管理選單、工具列表格）。

**同日 bug 修：甘特可以無限往下捲、整張表捲出畫面**（使用者回報）。根因＝凍結欄遮罩 `height:100000 + margin-bottom:-100000`，
負 margin 不抵銷捲動溢出，容器 scrollHeight 實測 100000。改成遮罩與表格同一個 grid 格（等高）。實測 scrollHeight＝表格高、
全收合時捲不動、橫向捲動遮罩仍貼左、thead sticky 正常、凍結欄無滲色。純前端。

## 更早（2026-09-12 深夜：全專案邏輯複檢 → 修 3 項；週次規則待確認）

**🚨 待辦（使用者確認行事曆後才動）：公司週次規則 ≠ ISO**。使用者給的定義：週日起始，2026-09-06(日)=W37、10-25(日)=W44、12-31=W53。
從 DB `ScheduleWeeks` 2026 的 53 列反推出唯一吻合的規則＝**週日起始、W1＝含 1/1 的那週、週所屬月份＝該週週日的月份（W1 固定 1 月）**
（＝Excel `WEEKNUM(d,1)`）。現行 `getTodayWeek`（前端）、`IsFutureWeek`（後端 `ISOWeek`）、`usp_EnsureScheduleYear` 都是 ISO 週一起始：
**每個星期日差一週**（週日會指到上一週、對新週回報被 400「尚未到」）、跨年整段錯（2027-01-01 算成 W52）。2027 的週表是 ISO SP 產的
52 週；照公司規則應為 53 週（W1＝2026-12-27、1 月 6 週、W53＝12-26～31），2027 目前無任何資料可直接重建。
確認後一次修：前端 `getTodayWeek`＋`getTodayScheduleYear`、後端 `IsFutureWeek`、遷移 21 改寫 `usp_EnsureScheduleYear` 並重建 2027、四份文件。
使用者原話「行事曆的部分等我確定再請你修正」——**勿先動**。

**已修 3 項（實測通過，`npm run build`／`check:dark` 通過、console 無新錯誤）**：
1. **非本年度不再被當成回報週**：App 新增 `isCurrentYear`／`isFutureWeek`／`isReportingWeek` 三旗標，全站時間判斷改走它們
   （TaskModal／ManagerWeekPanel／看板改收 prop）。實測成員切 2027：原本「本週回報中心 1」在催 2027 W01 的下週預計，
   現在整顆收起、出現「📅 2027 非本年度・僅檢視・回到 2026 年」晶片，點了回到 2026 W37；主管在 2027 無 🛠、看板無催報鈕。
   連帶：切年度的系統週改由 `refreshData` 在該年度載入後設定並置中（`loadedYearRef`；原「少傳 weeksTotal 且不置中」小項一併解掉）；
   ⏰ 到期只算今年；`goToCurrentWeek`／H 在非本年度＝切回今年。
2. **甘特 tooltip 座標改走 ref 直接改 style**：原本每次 mousemove 整頁重繪（實測 7–18ms/次），修後 mousemove 0ms、只有換條時 16–18ms。
3. **access-check 只有 `TypeError`（連不上）才放行**：4xx/5xx 改 ErrorScreen＋重試（原本一律放行＝fail-open）。
**複檢另提、未動**（使用者未指示）：子列點進彈窗但該子區間非本週單位時 `unitSub` 靜默退回第一個；`PROJECT_TYPES[type].chip` 兩處無 `?.`；
Excel `phaseD` 未限定年度；`IsFutureWeek` 用伺服器時區（主機非台灣時區會讓週一凌晨的回報被擋）。（圖例 title 的「只排程不打卡」已於 09-13 順手改掉。）

## 更早（2026-09-12 晚：子區間改為回報單位，遷移 20）

**需求**：使用者提出——專案很大時一條計畫區間切了很多子區間，只對計畫區間打卡像「一週只有一件事」。決定**推翻遷移 18 的
「子區間只排程不打卡」**，六條規則皆依建議拍板：①該週有進行中的子區間 → 逐子區間打卡，沒有 → 對計畫區間 ②父層舊紀錄優先（legacy）
③區間分數＝子區間平均、滿分仍＝區間數（看板「回報 x/y」以單位計、「得分 x/z」以區間計，兩個分母刻意不同）④切子區間前已回報的週不回頭催
⑤有回報紀錄的子區間僅主管可刪、刪除可復原（`usp_RestoreTaskSubInterval`）⑥Excel／週報文字／看板一列一子區間。
**DB（遷移 20，本機已套用；遠端待執行）**：`WeeklyLogs.SubId NULL`＋唯一索引 `UQ_WeeklyLogs_Unit(TaskId,SubId,Year,Week)` 取代
`UQ_WeeklyLogs`；`usp_UpsertWeeklyLog`／`usp_UpdateLogScore` 加 `@SubId`（參數最後）；刪除 SP 加紀錄檢查；新 restore SP；
`vw_WeeklyReport` 補欄。詳見 `DB_table.md`。
**後端**：bootstrap 先 `COL_LENGTH` 再查，分 `taskLogs`＋`subLogs` 兩份；`/api/weekly-log`／`/score` 收 `subId`、**只在有值時才傳
`@SubId`**（舊 SP 相容）；`/api/task/sub/restore`；稽核白話「…的子區間「X」…」；Excel 逐子區間一列。
**前端**：規則只有一份 `weekUnits()`（`app.jsx` 頂部），概況／群組列／待回報徽章／PendingPanel／ManagerWeekPanel／看板／pendingOnly
全走它。父條畫彙總色點（部分＝琥珀）、子條自己畫色點＋❗紅框並進 roving 群組；**待回報紅框只框回報單位**（2026-09-13 使用者決定：
子區間模式且子列展開時只框子條、父條不框；子列收合時父條代為承接，否則訊號消失）；TaskModal 以 `unitSub` 為當前單位，子區間模式有單位
晶片列（`role=tablist`，表單打到一半不能切）、「沿用上次」子區間沒歷史時退回父層。
**實測**（本機，主管＋成員兩種身分）：API 十種情境、UI 單位切換／存檔／評分／刪除→復原、看板卡片與週報文字、Excel、legacy 規則、
console 無錯誤、`check-dark-coverage` 通過（補 `.dark .hover\:bg-green-200`）。驗證用子區間 16／17 與 3 筆 WeeklyLogs 已硬刪除，
AuditLog 保留。⚠ 舊版程式碼在遷移 20 之後的 DB 上仍可運作（父層打卡不變）；新版程式碼在未跑遷移 20 的 DB 上：bootstrap 正常、
父層打卡正常、**對子區間打卡會 500**（SP 沒 @SubId）——部署順序：先跑遷移再換程式。
**未做（可再議）**：⏰ 到期仍看父區間；`onHighlightTask` 仍高亮父條；歷史（前幾週回報）子區間各看各的。

**同日再修 2 項（使用者拍板）**：
- **未來週次一律不可寫入，主管也不行**：後端 `RejectFutureWeek()` 套五支寫入端點（實測 W45／2027W01 皆 400 明文）；前端主管在未來週
  收掉 🛠 鈕與看板催報／回覆入口、改出「📅 未來週次・僅檢視」晶片，打卡彈窗改唯讀提示。主管仍可切到未來週看排程。
- **⏰ 即將到期加「剩餘 ≤4 週」上限**：實測 7 → 1（原本 4 條整年區間 71%／剩 16 週也在亮）。
**使用者未回應、維持不動**：瀏覽權限刪規則防鎖死、SP 授權、年度切換小項、`ManagerWeekPanel` 記住成員、子區間改期遺留回報提示。

**同日第三批：子區間打卡加總開關、預設關**（使用者「現在先不想用」，且**要求用 config 不做在網頁上**，避免誤操作）：
`appsettings.json` → `"Features": { "SubIntervalCheckin": false }`，`SubCheckinOn()` 每次即時讀（reloadOnChange），改檔數秒生效、
使用者重新整理即套用。曾做過 `AppSettings` key＋⚙️ 管理切換鈕＋`/api/settings/sub-checkin` 的版本，依要求整組拆掉（DB 測試列已刪）。
前端模組變數 `SUB_CHECKIN` 只在 refreshData 裡隨整包資料更新；關著時 `weekUnits` 永遠 `mode:'task'`、子條不畫色點、後端帶 `subId` 一律 400、
Excel 不展開。實測：改檔 true/false 伺服器不重啟即反映、關著時子區間回報 400、端點 404、選單只剩四項。**本機設定目前 false**。
⚠ 系統目前的實際行為＝「子區間只排程不打卡」（與遷移 18 時相同）；開→關會讓已用子區間回報的週顯示未回報（資料保留），建議週初切、不要來回切。
遠端部署時 `appsettings.json` 記得加這段（缺值也視為 false）。

## 更早（2026-09-12：全站操作邏輯複檢 → 修 3 項，遷移 19）

複檢範圍：`Program.cs` 全部端點、`app.jsx` 全部元件、SP 權限檢查（查 `sys.sql_modules`）、本機 DB 約束。已修：
1. **🚨 W53 打卡／非專案事項會被舊 CHECK 擋下（遷移 19，本機已套用；遠端待執行）**：`old.sql` 的 `CK_WLog_Week`／`CK_Extra_Week`
   （1–52）從未被 `new.sql` 移除（它 DROP 的是不存在的新名字），與新約束同時生效 → 實際上限 52。交易探測 W53 INSERT 實際失敗、
   API 回 500 泛用訊息。W53＝2026-12-28～2027-01-03，年底必踩。詳見 `DB_table.md`。
2. `/api/project/deliverable` 補 `BlankStr(req.Actor)` → 400（與子區間 ⑧ 同源：SP `@Actor <> @OwnerName` 遇 NULL 略過權限）。實測 null／空白皆 400。
3. 「下週預計」文案的 `Math.min(currentWeek+1, 53)` 兩處（PendingPanel、WeeklyPlanModal）改吃 `weeksTotal` prop（2027 是 52 週）。
   實測主管代修面板 → 下週預計 → 顯示「下一週（W38）」。
**複檢提出、待使用者拍板**（勿再提為新發現；主管未來週打卡與 ⏰ 門檻已於同日晚間修掉）：
- 瀏覽權限面板刪規則**沒有確認、也沒有「刪掉後自己會被擋」的檢查**（開啟卡控時有檢查）；卡控中誤刪唯一涵蓋自己的規則＝鎖在門外只能進 DB 修。
- 伺服器端授權只做一半：26 支 SP 僅 9 支檢查 role／owner（`InsertProject/UpdateProject/DeleteProject/InsertTask/DeleteTask/
  ReorderProjects/UpdateTaskSchedule/Insert・Update・DeleteUser/Restore*` 皆無；`usp_UpsertWeeklyLog` 不檢查 owner 與補登開關）。
  `系統架構.md`「權限檢查在 SP 內做」與實況不符。因 role 本身是 client 送的，屬「防誤用」；真正解法＝用 empId 在伺服器端決定身分（大工程）。
- 小項：`ManagerWeekPanel` 每次開啟回到 `users[0]`。（年度切換少傳 `weeksTotal`／不置中已於同日深夜修掉。）

## 更早（2026-09-11：計畫區間的「子區間」，遷移 18）

**需求**：一條計畫區間底下實際上還會再切幾個**可重疊**的階段（測試 W10–W27 → 準備資料 W10–W15／跟 IT 溝通 W12–W19／
驗證 W14–W27），主管希望在甘特圖上直接看到。使用者拍板三點：①年度總覽預設收合（週檢視預設展開）
②負責人可自己編子區間 ③**不要「✓ 完成」手動標記**。

**DB（遷移 18，本機已套用；遠端待執行）**：新表 `TaskSubIntervals`＋`usp_UpsertTaskSubInterval`／`usp_DeleteTaskSubInterval`
（SP 內檢查主管或負責人、落在父區間內、每條最多 10 筆）＋`usp_UpdateTaskSchedule` 加「父區間改期不可讓子區間跑出範圍」。
**子區間只排程不打卡**（WeeklyLogs／徽章／看板／Excel 全部不動）。稽核 `SubInterval`，白話翻譯三種動作已補。

**前端**：專案列下方以「縮排子列」逐條畫（一個子區間一列，重疊自然成階梯；父區間範圍鋪淡色底帶）；
名稱後 `▾ n` 晶片展開／收合，偏好記 `gantt_prefs`；狀態依今天週次分 未開始（虛線）／進行中（實線）／已結束（灰）；
父條 tooltip 列出子區間。TaskModal 排程卡下方新增「子區間」清單（就地編輯、底部新增列、Enter 送出、刪除走 ConfirmModal）。
⚠ 子區間存檔後彈窗不關，`MODAL_DIRTY` 要在其他欄位未動時自行清掉（否則 ESC 誤跳未儲存確認，實測踩到）。
**追加（同日）**：概況列圖例加「子區間」格（只在資料裡有子區間時顯示）；週報 Excel Sheet1 多一欄「本週階段」、
複製週報文字的區間名稱後附「（階段：…）」——皆以該週落在範圍內的子區間為準（實測 Excel sharedStrings 含欄名與
「監控告警調校、交接文件」、複製文字含「（階段：交接文件）」；暫用子區間 6~8 已刪除）。
再追加：看板卡片區間名稱旁加 `階段：…` 晶片（同一定義；實測 W35 卡片顯示「階段：交接文件」，暫用子區間 9 已刪除）。
使用者決定**不做**：全域展開／收合鈕連動子列、⏰ 到期看子區間、子條樣式化浮框。
遷移 18 已在**測試主機**執行（非 Gantt2、非遠端）。

**2026-09-12 操作邏輯複檢後修正 4 項**（實測皆通過，驗證用子區間 10／11 已刪除、`gantt_prefs` 已還原）：
① `18_…sql` 的 `SET QUOTED_IDENTIFIER ON` 移到檔頭（原本在 filtered index **之後**，沒帶 `-I` 跑會索引 1934 失敗、SP 照建；
   本機已確認 `has_filter=1` 不需重跑，遠端直接用修正後的檔）。
② TaskModal 新增子區間：**起迄週留空＝沿用父區間起迄**（`resolveSubWeeks`）——placeholder 本來就顯示父區間的 10／27，
   灰字暗示「不填就是這個值」卻被驗證擋下；輸入框 `title` 也明講「留空＝W10」。實測只打名稱按 Enter → W10–W27。
③ 搜尋命中子區間名稱的專案**暫時視為展開**（`subSearchHits`，不寫 prefs）：否則收合狀態下搜「驗證」跑出一個名稱裡沒「驗證」
   的專案，像搜尋壞了。期間 `▾ n` 晶片 disabled＋title 說明；清掉搜尋即回原偏好（實測 prefs 未變）。
④ 新增列有內容時各列 ✎／🗑 一併 disabled（`subRowActionsLocked`）：表單是新增／編輯共用的一份，按 ✎ 會無聲覆蓋掉打到一半的內容。
⑤ 編輯子區間三欄都沒改 → 直接收掉編輯列、**不打 API**（免多一筆「內容未變更」稽核噪音；實測攔截 fetch：無變更 0 次 POST、改名 1 次）。
⑥ 子區間刪除 Confirm 訊息補「（軟刪除，可由資料庫還原）」與計畫區間一致。
**2026-09-12 第二輪複檢再修 2 項**（實測通過；暫用子區間 13~15 已刪除、reorder API 以攔截 fetch 驗證未真的寫入）：
⑦ 拖曳排序中子列**改為照畫**，掛與父列同一組 `rowDragOver`／`rowDrop`（落在子列＝落在父專案、被拖專案子列一併變淡）。
   原本「拖曳中藏子列」會讓整張表一開拖就縮短、游標下目標跳位。實測：dragstart 前後 tableH 3194 不變、
   拖 205 放到 204 的子列上 → reorder 送出 `[…203,205,204…]`、藍線只在 204 父列。
⑧ `/api/task/sub`／`/sub/delete` 補 `BlankStr(req.Actor)` → 400「缺少操作者」：SP 的 `@Actor <> @OwnerName` 遇 NULL 會略過權限檢查，
   且資料先寫、AuditLog 才因 NOT NULL 失敗（無交易）→ 會留下沒稽核的子區間。實測 null／空白皆 400、正常 actor 走到 SP。
**複檢提出但尚未動的小項**（待使用者決定）：父區間平移時「連動平移子區間」、刪除計畫區間 Confirm 提示含 n 個子區間、
「階段」分隔符統一（文字 `／`／Excel `、`）、子區間存檔／刪除後焦點掉到 body、排程表單未存時的子區間驗證提示、
`resolveSubWeeks` 改 `Number()`＋整數檢查、`SortOrder` 為死欄位。
**曾決定暫緩、已於遷移 20 補上**：子區間刪除的「↩ 復原」（子區間開始掛回報紀錄後前提消失）。

**實測**（本機）：API 十種情境（負責人／主管新增、他人 400、超出父區間 400、空白 400、W0 400、父區間縮短 400 列出兩筆、
修改、他人刪除 400）、bootstrap 帶出 `subs`、稽核白話完整；UI 週檢視階梯三列＋底帶、晶片收合／展開並持久化、
子條開父彈窗、彈窗新增（Enter）／編輯／範圍錯誤／刪除確認、父區間縮短前端先擋並列名、總覽預設收合、深色模式正常、
console 無錯誤、`check-dark-coverage` 通過。驗證用 5 筆子區間已刪除，AuditLog 保留（含兩筆 PowerShell 5.1 編碼
壞掉的 `? IT ??` 測試紀錄；t204-2 名稱與排程已還原）。
⚠ **測 API 別用 PowerShell 5.1 的 Invoke-WebRequest 送中文 JSON**——body 會被轉成 ANSI，負責人名字對不上就變成權限錯誤，
改用 Node `fetch` 腳本。

## 更早（2026-08-27：新增使用者手冊 `使用者手冊.html`）

**內容**：面向使用者（非開發者）的單檔操作手冊，13 章，依角色分組（入門／成員／主管／高階主管／通用），
含頂部「我的身分」篩選（選了角色即隱藏不適用章節）、左側目錄軌（跟隨捲動）、深淺主題、列印樣式。
**限制**：內網禁 CDN → **零外部資源**（不外連字型，中文走系統字族、資料型文字走等寬字族），
單檔可直接開啟／隨 wwwroot 一起部署。色彩沿用系統本身（NAVY #001F5B、GOLD #FDD075、深色表面 #1E293B）。
⚠ 功能異動若影響操作流程，須同步更新此檔（已登記進 `CLAUDE.md` 文件體系表）。

## 更早（2026-08-26：非專案事項／下週預計 也加文件連結）

**需求**：遷移 16 只有打卡有文件連結，另外兩個回報項目沒有 —— 同一份週報三個欄位兩種能力，使用者要求一致。

**DB（遷移 17，本機已套用；遠端待執行）**：`ExtraNotes.DocUrl`／`WeeklyPlans.DocUrl NVARCHAR(500) NULL`
＋兩支 upsert SP 加選填 `@DocUrl`。
⚠ **稽核寫法與打卡刻意不同**：這兩支的 OldValue/NewValue 本來就是「內容全文」、白話翻譯靠比對它們判斷
「內容未變更」，所以文件連結放**沒被用到的 Detail** 欄（`doc舊=…|doc新=…`），不動 Old/NewValue。
後端 `ExtractNewDoc()` 一個函式同時解析兩種 Detail 格式。

**資料結構決策**：`extraNotes`／`weeklyPlans` 的內容是**純字串** map，所以 `docUrl` 放進
`extraNoteMeta`／`weeklyPlanMeta`（＝`{by,byRole,at,docUrl}`）。理由：內容改成物件要動十幾個
`?.[week] || ''` 取值點，而 meta 本來就一路傳到每個顯示／編輯的地方，放這裡零新增 prop、不會漏掉任何一處。

**前端**：抽出共用的 `<DocUrlField>`（輸入欄）與 `validateDocInput()`（送出前驗證），三個表單共用同一份，
TaskModal 也一併改用。編輯時欄位旁多一顆**就地試開**的圖示（不必存檔→回看板→再點一次才發現貼錯）。
⚠ 主管代修面板那一列整個是 `<button>`，**不能再塞可點的 `<a>`**（巢狀互動元素是無效 HTML、
且點連結會順便觸發「編輯」），只標示「已附文件」。
⚠ 「內容清空但連結還在」的列要照樣顯示 —— 看板卡片、週報文字、Excel 的過濾條件都要把 docUrl 算進去；
彈窗的「清空內容／清空重填」按鈕字樣同理。

**實測**（本機 Sariel\Gantt）：兩支端點 `javascript:` 400／超長 400／https 與 UNC 存取皆正確；
bootstrap 的 meta 帶出 `docUrl`；稽核白話兩類都顯示「，文件連結：…」；看板兩個區塊各出現 24×24 圖示連結
（href 為 https 原樣／`file://fileserver/...`）；代修面板兩列都顯示「已附文件」徽章；
兩個彈窗都帶出已存連結＋就地試開連結；`portal.example.com/x` 失焦補成 `https://`；
前端 `javascript:` 擋下不發請求；清空連結存回 NULL 且內容保留、按鈕維持「送出」；
Excel Sheet2 多兩欄且 `sheet2.xml.rels` 產出 https 與 UNC 兩個外部超連結；
`check-dark-coverage.js` 通過、bootstrap 回歸 69 專案 7 成員、無新 console 錯誤。
⚠ 驗證用的 ExtraNotes／WeeklyPlans 各 1 筆（裕隆 W35，事前確認全表該週 0 筆）已刪除還原；AuditLog 保留未動。

## 更早（2026-08-25：打卡回報加「📎 文件連結」）

**需求**：主管讀週報時最常做的下一個動作就是「把那份文件打開」，原本得自己去信件／檔案總管翻。
回報時順手貼上連結，看板與打卡彈窗直接點開。

**DB（遷移 16，本機已套用；遠端待執行）**：`WeeklyLogs.DocUrl NVARCHAR(500) NULL`＋
`usp_UpsertWeeklyLog` 加選填 `@DocUrl`＋`vw_WeeklyReport` 補欄。稽核 Detail 改
`doc舊=…|doc新=…|note舊=…|note新=…`（**doc 必須排在 note 之前**，理由見 `DB_table.md`）。

**後端**：`/api/weekly-log` 收選填 `docUrl`；`bootstrap` 的 `taskLogs[*][week]` 多回 `docUrl`；
`Summarize()` 附「，文件連結：…」；週報 Excel 多一欄「文件連結」（UNC 產生真正可點的外部超連結）。
🚨 `ValidateDocUrl` 擋 `javascript:`／`data:`／`vbscript:`＋長度 500 —— 這個值會進 `<a href>` 且主管一定會點。

**前端**：共用元件 `<DocLink>`，顯示為 **24×24 純圖示（SVG，非 emoji）**——初版帶「📎 開啟文件」整串字，
使用者回饋在卡片裡太吵；縮成 emoji 也不行（10px 的 📎 只是彩色色塊）。看板裡併進「狀態／分數／✏️主管」
那排徽章不自己佔一列；`aria-label` 是唯一可及名稱、`title` 帶原始路徑。
**一律 `<a target="_blank">`，點一下就開新分頁**（使用者指示）——中間曾做成「http 開新分頁／路徑類改複製路徑鈕」，
同一顆圖示兩種結果，使用者預期不到，已收斂成單一行為。
非 http 的路徑先轉成合法 `file:` URL（`toDocHref`：UNC→`file://server/share/…`、`C:\`→`file:///C:/…`），
原樣放進 href 會被當相對路徑跳到本站 404。⚠ 磁碟機代號要**排在 scheme 判斷之前**（`C:` 會被當成 scheme），
scheme 規則同時改成要求 ≥2 字元。⚠ 已知限制：Chrome/Edge 預設封鎖從 http 開 `file://`，
要靠網域政策放行；填寫欄位下方對路徑類連結會提示，替代路徑是匯出的 Excel（那裡是真的可點）。
沒有 scheme 的網址在 blur／送出時補 `https://`。
顯示於：看板卡片、打卡彈窗（可編輯＋唯讀）、歷史回報逐列、甘特 tooltip（只標示有附件）、複製週報文字。
「沿用」連同連結一起帶入。看板卡片內的 `DocLink` 帶 `stopPropagation`（卡片本身點了會高亮甘特），
⚠ 該 guard **只能 `stopPropagation` 不能 `preventDefault`**，後者會擋掉開新分頁。

**實測**（本機 Sariel\Gantt）：https／UNC 兩種存取正確、清空存回 NULL、`javascript:` 前端擋下不發請求＋
後端 400、超長 400、`portal.example.com/x` → 補成 `https://…`、三種來源都渲染成 `<a target="_blank"
rel="noopener noreferrer">` 且**恰好 24×24 無文字**（href 實測：https 原樣／UNC→`file://fileserver/MSD/…`／
`C:\Docs\plan.docx`→`file:///C:/Docs/plan.docx`）、點擊後目前分頁不會被導走、看板卡片不會被誤觸高亮、
唯讀檢視與歷史列都顯示連結、Excel `sheet1.xml.rels` 產出 UNC 外部超連結、
圖示對比 淺 8.01（投影 6.95）／深 6.82（投影 5.65），`check-dark-coverage.js` 通過。
⚠ **「有沒有真的跳出新分頁」在這個環境驗不到**：內嵌 Browser pane 封鎖開新視窗（`window.open` 回 null），
不是程式問題；DOM 就是標準的 `<a target="_blank">`，真實 Chrome 會正常開。
⚠ **驗證用的 WeeklyLogs 全數刪除還原**（t109-1 W34/W35、t110-1 W35；都確認是本次新建、非覆寫既有資料）；
對應的 AuditLog 保留未動（稽核表不自行刪除，如需清可手動處理）。
⚠ 量測踩到一次假象:**Browser pane 沒有顯示時 CSS transition 不會推進**，`getComputedStyle` 會永遠停在
切換主題前的舊色（誤判成「深色映射失效」）。判讀前要先 `style.transitionProperty='none'` 取終值。
（`CLAUDE.md` 早就有「寬度變化不要加 transition」那條，同一個坑的另一面。）

## 再更早（2026-08-25：修正看板與彈窗的疊層順序）

**使用者回報**：開著「團隊總結看板」時再點甘特條開啟專案排程／打卡彈窗，彈窗被壓在看板下方，
右上角 ✕ 按不到 → 得先關看板才關得掉彈窗。

**成因**：看板是 `z-[120]`，**夾在彈窗層（100~150）中間**。實測 1280 寬：彈窗 ✕ 在 x=848、
看板從 x=832 起，`document.elementFromPoint` 命中的是看板而非 ✕。
受影響的不只打卡彈窗，`z-[105]`／`z-[110]`／`z-[115]` 那批（即將到期、回報中心、主管代修、
成員管理、異動紀錄…）同樣會被蓋住。

**修正**：看板改為 `z-[90]`——它是唯讀側邊面板不是視窗，排在整個彈窗層之下。
層級表定為 `90`看板 →`100~150`彈窗／面板 →`200`甘特 tooltip →`300`toast（已寫入 `CLAUDE.md`）。
90 仍高於 header／甘特凍結欄（皆 `z-50`），「整條蓋住 header」的原始設計不變。
ESC 優先序原本就正確（`selectedTaskInfo` 排在 `showWeeklyReport` 之前），無須調整。

**實測**（主管登入 → 開看板 → 點甘特條）：彈窗 z=100／看板 z=90、`elementFromPoint` 命中 ✕ 鈕、
按下即關閉；關閉後看板仍蓋住 header 右上角。console 無錯誤，`check-dark-coverage.js` 通過。

## 更早一次變更（2026-08-10：全功能檢查＋UI/UX 修正 24 項）

先做全專案功能檢查（建置、API、三檢視、15 個彈窗、權限、匯出、對比），再依檢查結果修正。
**檢查與修正全程未寫入任何業務資料**（以攔截 fetch 進行；事後確認 AuditLog 筆數未變、69 專案未變、
`AllowRetroCheckin` 仍為 false）。

**修正的缺陷**
1. 🚨 **中文輸入法防誤送完全失效**（全站 6 處）：React 18 合成事件沒有 `isComposing`，取到永遠是 `undefined`。
   已改為 `isComposingEvent(e)`（讀 `e.nativeEvent.isComposing`）。實測修正前後：組字中 Enter 由「照樣送出」→「0 次送出」。
2. **輪詢失敗完全靜默** → header 加「⚠ 連線中斷，畫面為 HH:mm 的快照」＋重新連線（連續失敗 ≥2 次才亮）。
   實測：第 2 次失敗後正確出現，恢復後按重新連線即消失。
3. **概況晶片不隨成員篩選連動**（選玉婷仍顯示全隊 3/21）→ 改為跟隨 `ownerFilter`，標題同步顯示 `全隊/玉婷/裕隆概況`。
4. 年度總覽 tooltip 寫死「52 週」→ 改 `{weeksTotal}`。
5. 全站唯一的 `window.alert`（★ 標記失敗）→ 改 `showToast`（實測落入 `role="alert"` 播報區、狀態正確 rollback）。
6. 異動紀錄的 `AppSettings` 沒有 `Summarize` case → summary 只有「false/true」。已補白話化（58 筆全部正確）。
7. 深色投影 50:1 的 24 項不合格 → **0 項**（21 項是甘特未來週次的 `text-slate-500`，改 slate-600；
   「顯示 n/n 項」改 slate-700；淺色 `⏰ 剩N週` 改 orange-800）。刻意不動全站中性色階梯。
8. 使用者輸入錯誤一律回 500 泛用訊息 → 改 `Bad()` 回 400 明文（10 項實測全部正確）。
9. `access-check` 無 timeout（伺服器不回應時永久轉圈）→ `apiGet` 加 `timeoutMs`，15 秒逾時顯示 ErrorScreen＋重試。
   ⚠ 逾時**不放行**（維持 fail-closed）。
10. `Microsoft.AspNetCore.Authentication.Negotiate` 9.0.0（2 個高嚴重性弱點）→ **9.0.18**；建置警告 4 → 0。
11. **成果清單篩到 0 筆時匯出會拿到全部 69 案**（UI/UX 複檢時發現，本批最嚴重）：前端送 `projectIds: []`，
    而 `Program.cs` 是 `if (req.ProjectIds is { Count: > 0 })` → 空陣列落到「未傳＝全部」。使用者按下寫著
    「匯出 Excel（0 案）」的按鈕，拿到的是整份清單。已改為 `is not null`（實測 空陣列 6,785 bytes／
    真實兩案 7,062／未傳 10,795＝全部），前端也在 0 案時 disable 匯出鈕。
12. **空狀態沒有出口**：新增共用 `<EmptyFilterState>`，列出生效中的條件並逐項給清除鈕。
    實測週檢視三條件同時生效時正確列出「搜尋「zzzzz」、類型 A、成員「玉婷」」＋4 顆鈕，
    「清除全部條件」按下後回到 69/69；成果清單併上 KPI 卡片條件（「搜尋「POCDB」、KPI 卡片「具備 MP Saving」」）。
13. **成果清單 ★ 星號點擊區只有 13×24**（WCAG 2.5.8 要 24×24，且是主管標記重點專案的唯一入口）：
    用 `-ml-1.5 px-1.5 py-1` 撐開熱區（版面位置不變，實測 **25×24**、列高仍 33px），
    未標記態 `text-slate-400`→`slate-500`（投影 50:1 由 4.13 → **5.26**）。
14. **成果清單 5 張 KPI 卡的「選中態」在淺深兩色都不合格**（UI/UX 複檢時量出來，比原本以為的嚴重）：
    -500/-600 實心底配 -100/-200 淡字，副標實測 重點關注 **1.93**／有具體產出 2.86／MP Saving 3.32／
    待補充 3.95。改為 **700 級底＋純白字**（amber-700／emerald-700／orange-700／red-700），
    淺深皆 **5.02~15.59**（投影 4.65~12.07）。同一原因也修了匯出鈕（green-600 白字 3.30 → green-700 **5.02**）。
15. **其餘無障礙補齊**：`—` 佔位符 163 處（淺色 2.56 → **6.20**，並加 `aria-hidden` 免得逐格朗讀）、
    ★ 實心星 `amber-500`→`amber-600`（2.15 → 3.19／深色 10.15）、⚙️ 管理補 `aria-expanded`/`aria-haspopup`、
    成員管理接上未儲存確認（新增 `clearModalDirty()` 給「送出後不關閉」的視窗用，實測 ESC 會跳確認且輸入保留）、
    點擊區 ‹ ›／展開收合／🎯／看板兩顆鈕全部 ≥24×24（負邊距吸收，甘特列高 40px 不變）。
    複檢結果：三檢視 × 兩主題 **真實對比缺失 0 筆**（剩下的 ⭐⚠️ 是 emoji，CSS color 不影響渲染）。
16. **1024×768＋看板開啟時概況列溢位 22px**（投影比例查核時發現）：收掉狀態晶片後仍需 646px、
    但 `availW` 只有 624。改為 `availW < 700`（`STATS_BAR_MIN_W`）時縮 padding／gap／進度條共 58px
    → 588，且加 `flex-wrap` 當保險。實測 1024 開看板 **溢位 0、單行**；再按下「未回報」篩選
    （最擠的組合）換成兩行、仍溢位 0；1280／1366／1920 完全不變（padding 16／gap 12／進度條 150、單行）。
17. **主管回報編輯「歷史週次」晶片在深色下整個字消失**（使用者回報）：`bg-amber-300`（300 級亮晶片，
    刻意不進暗色階梯）配 `text-amber-900`（被 `.dark` 映射成 `#FCD34D`）→ **兩者同值、對比 1.00**。
    改用 `text-amber-950`（與 header「⚠ 連線中斷」晶片同一組寫法），並在 `input.css` 明示鎖住
    `.dark .bg-amber-300`／`.dark .text-amber-950` 維持原值。實測深淺兩色皆 **10.39**。
    `check-dark-coverage.js` 加第 7 項檢查「亮底配亮字」——原本每個 class 各自都有映射、加起來才壞，
    舊檢查照樣回報通過（已驗證：還原成 -900 會被抓出並印出對比 1.00）。

**新增的 UI/UX 功能**
- **「未回報」晶片變成可切換篩選**：實測 69→18 項，且畫面上恰好 18 個未回報標記（與晶片數字一致）。
- **甘特條 roving tabindex**：107 個 Tab 停留點 → **1 個**，↑↓ 移動、Enter 開窗、←→ 仍平移。
- **打卡彈窗加「↩ 沿用上次回報（W..・狀態）」主按鈕**（歷史區逐列的沿用鈕保留）。
- **團隊看板加「複製待回報名單（n）」**（主管專用，純前端組字串到剪貼簿）。
- **header 系統週數改成可直接輸入**：實測打 8→W08、打 99→夾回 W53、‹ › 與輸入框雙向同步。

## 目前待辦事項

0. **🚨 公司週次規則（週日起始）改寫**：待使用者確認 2027 行事曆（2027-01-01=W1？12-31=W53？）後動手，內容見上方「最近一次變更」。
   年底前必須完成——現行 ISO 邏輯每個星期日都指到上一週。
1. **遠端 DB 遷移**：確認遠端是否已依序執行 `10→…→19→20`（未執行則需執行）；Gantt2 測試庫缺 11~20。
   ⚠ **遷移 20 要在部署新版程式之前跑**：新版對子區間打卡會呼叫 `@SubId`，舊 SP 沒這個參數會 500（父層打卡與載入不受影響）。
   ⚠ **遷移 16／17 是文件連結功能的前提**：沒跑的話 `/api/bootstrap` 會因為 `DocUrl` 欄位不存在而**整包失敗**
   （三張表都會查到，等於整個系統開不起來）。部署新版程式前務必先跑完這兩支。
   （遷移 18 沒跑的話 bootstrap 仍能載入——後端先檢查表存在才查——只是子區間功能會在存檔時報錯。）
   ⚠ **遷移 19 務必在 2026-12-28（W53）之前跑到遠端**，否則年底最後一週全員打卡與非專案事項都會 500。
2. **安全性——連線字串明碼密碼**：`appsettings.json` 含 SQL 明碼密碼且存在於 GitHub（lousyqq/Gantt）歷史；
   應改環境變數／IIS 組態覆蓋，必要時更改 SQL 密碼並將 repo 設為 private（或 git filter-repo 清歷史）。
   ⚠ 2026-08-10 稽核時未動此項——它屬於部署組態，改動會影響開發機連線。
3. **git origin 待補**：2026-07-15 `.git/config` 損毀重建後 origin remote URL 遺失，需 `git remote add origin <URL>`。
4. **build:css 未壓縮**：`package.json` 的 `--minify` 曾被移除，app.css 約大 3~5 倍；視需求加回。
5. **IIS HTTPS 綁定**（部署設定，非程式碼）。
6. **AuditLog 有一筆 ActorName 是亂碼 `??????`**：既有資料的編碼問題（非程式造成），人員下拉會出現該選項。
   屬資料層修正，需人工確認該筆原本是誰才能 UPDATE。
7. **部署注意**：Negotiate 升到 9.0.18 後，內網主機的 ASP.NET Core 9 執行階段版本需 ≥ 9.0.18；
   若為 framework-dependent 發佈且主機版本較舊，需先更新 Runtime。
8. **長期**：多人同時編輯為 last-write-wins（可評估 rowversion 樂觀鎖）；Sariel 尚有 18 筆 Task EndWeek=52
   （「W52→53」屬各環境資料調整，視需求處理）。
9. **已提出但使用者決定不做（勿再重提為新發現）**：成果清單搜尋框、主搜尋涵蓋 NID／產出、列印樣式（`@media print`）。
   三者都仍成立、只是優先度不足。

<!-- 更新原則：功能完成後更新上方概況（覆寫、保持精簡），待辦做完即刪；不再累積逐日流水帳 -->
