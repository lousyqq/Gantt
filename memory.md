# memory.md — 專案現況與待辦（精簡版）

> 本檔只保留**最新狀態**與**待辦事項**。歷史修改紀錄已封存於 git 歷史（2026-07-19 重整）；
> DB 變更歷史**完整保留**於 `DB_table.md`（append-only，不可刪減）；架構總覽見 `系統架構.md`；開發規範見 `CLAUDE.md`。

## 專案概況（2026-07-21）

MSD 專案追蹤總表：ASP.NET Core 9 Minimal API＋React SPA＋SQL Server。
成員每週對甘特圖上的計畫區間打卡回報（含下週預計必填、非專案選填），主管管理專案／區間／成員、
評分、週報回覆、歷史補登、瀏覽權限、使用統計；高階主管走成果清單（★重點關注＋產出/MP Saving＋NID）與 Excel 匯出。
專案有選填 NID（流水編號，一專案可含多組），計畫區間有選填 NID（對應哪組）——編輯專案／編輯排程／新增區間皆可填，
專案名稱 hover tip、成果清單欄位、甘特條 tooltip 皆可檢視。
全功能已上線運作中，操作皆有 AuditLog 稽核（含 Windows 工號），異動紀錄以白話呈現。

- 使用者：6 位成員＋管理部主管；登入畫面點選（身分持久化 localStorage），Windows 工號由 `/api/whoami` 自動偵測。
- 深色模式：header 🌙/☀️ 切換，偏好存 `gantt_prefs.dark`；`index.html` 有 no-flash 前置腳本、`<html>` 掛 `dark` class。
  做法＝`ClientApp/input.css` 的 `.dark` 覆寫層（中性 slate/blue 表面/文字/邊框 + 彩色面板卡片 -50 底色轉深）
  ＋甘特凍結欄色改 CSS 變數；狀態晶片(-100+同色深字)維持淺底。少數混色元件用 `dark:` 變體個別修正。
  登入頁另做三階景深（`.login-bg` #0B1220／卡片 #1E293B／`.login-chip` #334155）並把品牌色 `#001F5B`
  改成 `var(--brand-btn)`（深色 #2563EB）——原本三層同色（對比 1.00）且主管鈕融進卡片（1.07）。
  2026-07-30 重訂彩色矩陣亮度階梯（14 色相 -50/-100/-200＋hover＋9 色相邊框）：原本 -50 比面板底還暗，
  卡片變成「凹陷」且整體糊成一片；現為 -50 L≈0.035 →-100 0.060 →-200 0.085，各階與 hover 皆逐階遞增。
  全檢視實測（週檢視/年度總覽/成果清單/看板/回報中心）低對比項＝0（只餘 disabled 鈕，WCAG 豁免）。
  同日再修工具列／彈窗按鈕：原本每顆鈕對工具列的對比都是 1.00~1.07（選中的「週檢視」還比未選中更暗、
  分段外框完全看不見）。品牌色拆成 `NAVY`（標題列／表頭，不變）與 `BRAND_BTN`（按鈕填色，深色 #2563EB），
  另加 `.ctl-raised` 抬高 bg-slate-100 類按鈕 → 外框與選中段 2.83、緊湊模式 1.41。淺色模式逐項比對未變。
  同日**全專案深色稽核**（21 個畫面／彈窗＋47 處行內寫死色靜態掃描）後定案「中性表面階梯」：
  bg-white #1E293B → bg-slate-100 #334155 → bg-slate-200 #3E4C61 → bg-slate-700 #5A6B84，
  中性文字同步上調（700 #CBD5E1／600 #B6C0CD／500 #A3AEC0／400 #8C99AC），大面積容器另掛 `app-bg`，
  彈窗加 `modal-card`／`modal-scrim`。細節與連動規則見 CLAUDE.md。
  最終實測：13 個畫面共 **8614 個文字元素，低對比 0**；「控制項融進背景」僅餘有邊框的內容容器與
  分段控制未選中段（設計如此）。淺色模式關鍵色逐項比對未變。
  同日再以**投影機模型**（環境光亮度地板，on-screen 對比 30~50:1）重驗：淺色原有 92 處 11~12px 的
  `text-slate-500` 在投影下全數不合格（違反自訂的「次要文字至少 slate-600」），已把淺色 slate-500 改寫為
  `#556274` → 淺色投影 50:1 不合格 **95→3**、螢幕 22→0。深色未動，投影 50:1 仍有 24 項
  （主因是深色的 `text-slate-500 #A3AEC0` 落在抬升面上，投影後 3.99），如需比照可再處理。
- 年度：2026（53 週）為主，2027 已建；開新年度 `EXEC dbo.usp_EnsureScheduleYear <年>;`。
- 環境：開發=Sariel\Gantt（另有 Gantt2 測試庫）；遠端正式主機基準=old.sql+new.sql，增量遷移 10~13。
- 系統開關現況：`AllowRetroCheckin=false`、`AccessControlEnabled=false`（本機留示範規則 DEPT_3=MSD 一條）。

## 目前待辦事項

1. **遠端 DB 遷移**：確認遠端是否已依序執行 `10→11→12→13→14→15`（未執行則需執行）；Gantt2 測試庫缺 11~15。
2. **安全性——連線字串明碼密碼**：`appsettings.json` 含 SQL 明碼密碼且存在於 GitHub（lousyqq/Gantt）歷史；
   應改環境變數／IIS 組態覆蓋，必要時更改 SQL 密碼並將 repo 設為 private（或 git filter-repo 清歷史）。
3. **git origin 待補**：2026-07-15 `.git/config` 損毀重建後 origin remote URL 遺失，需 `git remote add origin <URL>`（若尚未補）。
4. **build:css 未壓縮**：`package.json` 的 `--minify` 曾被移除，app.css 約大 3~5 倍；視需求加回。
5. **IIS HTTPS 綁定**（部署設定，非程式碼）。
6. **已知風險（2026-07-30 評估後暫不修）**：`app.jsx:1291` 的權限卡控閘門
   `if (!accessCheck) return <LoadingScreen/>` **沒有 timeout／錯誤畫面／重試**——若
   `/api/access-check` 的 fetch 掛著不 reject（例：伺服器正好在重啟），catch 接不到，
   畫面會**永久停在「載入資料中…」且無任何提示**。對照組：`loadBootstrap` 有 try/catch/finally，
   失敗會顯示 ErrorScreen 附重試。暫時解法＝使用者按 Ctrl+F5。
   若要修，逾時後的處置需先決定（顯示 ErrorScreen 重試 vs 比照現有 catch 直接放行），
   因為牽涉權限卡控的安全預設。
7. **長期**：多人同時編輯為 last-write-wins（可評估 rowversion 樂觀鎖）；Sariel 尚有 18 筆 Task EndWeek=52
   （「W52→53」屬各環境資料調整，視需求處理）。

<!-- 更新原則：功能完成後更新上方概況（覆寫、保持精簡），待辦做完即刪；不再累積逐日流水帳 -->
