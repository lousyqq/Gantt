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
- **環境**：開發＝Sariel\Gantt（另有 Gantt2 測試庫）；遠端正式主機基準＝old.sql+new.sql，增量遷移 10~15。
- **系統開關現況**：`AllowRetroCheckin=false`、`AccessControlEnabled=false`（本機留示範規則 DEPT_3=MSD 一條）。
- **深色模式／版面自適應／無障礙**：已完成三輪稽核並定案，細節與所有「踩過的坑」全部寫在 `CLAUDE.md`
  （中性表面階梯、彩色亮度階梯、投影機對比模型、凍結欄與看板寬度公式、焦點管理與 `clickable`）。
  現行實測基準：**淺色 螢幕 0／投影50 0／投影30 1；深色 螢幕 0／投影50 0／投影30 47**
  （深色 30:1 那批全是 4.41 的 `text-slate-600`，要清掉得動全站色階，已評估後不做）。

## 最近一次變更（2026-08-10：全功能檢查＋UI/UX 修正 17 項）

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

**新增的 UI/UX 功能**
- **「未回報」晶片變成可切換篩選**：實測 69→18 項，且畫面上恰好 18 個未回報標記（與晶片數字一致）。
- **甘特條 roving tabindex**：107 個 Tab 停留點 → **1 個**，↑↓ 移動、Enter 開窗、←→ 仍平移。
- **打卡彈窗加「↩ 沿用上次回報（W..・狀態）」主按鈕**（歷史區逐列的沿用鈕保留）。
- **團隊看板加「複製待回報名單（n）」**（主管專用，純前端組字串到剪貼簿）。
- **header 系統週數改成可直接輸入**：實測打 8→W08、打 99→夾回 W53、‹ › 與輸入框雙向同步。

## 目前待辦事項

1. **遠端 DB 遷移**：確認遠端是否已依序執行 `10→11→12→13→14→15`（未執行則需執行）；Gantt2 測試庫缺 11~15。
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
