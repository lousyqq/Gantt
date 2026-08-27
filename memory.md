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
- **系統開關現況**：`AllowRetroCheckin=false`、`AccessControlEnabled=false`（本機留示範規則 DEPT_3=MSD 一條）。
- **深色模式／版面自適應／無障礙**：已完成三輪稽核並定案，細節與所有「踩過的坑」全部寫在 `CLAUDE.md`
  （中性表面階梯、彩色亮度階梯、投影機對比模型、凍結欄與看板寬度公式、焦點管理與 `clickable`）。
  現行實測基準：**淺色 螢幕 0／投影50 0／投影30 1；深色 螢幕 0／投影50 0／投影30 47**
  （深色 30:1 那批全是 4.41 的 `text-slate-600`，要清掉得動全站色階，已評估後不做）。

## 最近一次變更（2026-08-27：新增使用者手冊 `使用者手冊.html`）

**內容**：面向使用者（非開發者）的單檔操作手冊，13 章，依角色分組（入門／成員／主管／高階主管／通用），
含頂部「我的身分」篩選（選了角色即隱藏不適用章節）、左側目錄軌（跟隨捲動）、深淺主題、列印樣式。
**限制**：內網禁 CDN → **零外部資源**（不外連字型，中文走系統字族、資料型文字走等寬字族），
單檔可直接開啟／隨 wwwroot 一起部署。色彩沿用系統本身（NAVY #001F5B、GOLD #FDD075、深色表面 #1E293B）。
⚠ 功能異動若影響操作流程，須同步更新此檔（已登記進 `CLAUDE.md` 文件體系表）。

## 上一次變更（2026-08-26：非專案事項／下週預計 也加文件連結）

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

1. **遠端 DB 遷移**：確認遠端是否已依序執行 `10→…→16→17`（未執行則需執行）；Gantt2 測試庫缺 11~17。
   ⚠ **遷移 16／17 是文件連結功能的前提**：沒跑的話 `/api/bootstrap` 會因為 `DocUrl` 欄位不存在而**整包失敗**
   （三張表都會查到，等於整個系統開不起來）。部署新版程式前務必先跑完這兩支。
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
