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
- 年度：2026（53 週）為主，2027 已建；開新年度 `EXEC dbo.usp_EnsureScheduleYear <年>;`。
- 環境：開發=Sariel\Gantt（另有 Gantt2 測試庫）；遠端正式主機基準=old.sql+new.sql，增量遷移 10~13。
- 系統開關現況：`AllowRetroCheckin=false`、`AccessControlEnabled=false`（本機留示範規則 DEPT_3=MSD 一條）。

## 目前待辦事項

1. **遠端 DB 遷移**：確認遠端是否已依序執行 `10→11→12→13→14`（未執行則需執行）；Gantt2 測試庫缺 11~14。
2. **安全性——連線字串明碼密碼**：`appsettings.json` 含 SQL 明碼密碼且存在於 GitHub（lousyqq/Gantt）歷史；
   應改環境變數／IIS 組態覆蓋，必要時更改 SQL 密碼並將 repo 設為 private（或 git filter-repo 清歷史）。
3. **git origin 待補**：2026-07-15 `.git/config` 損毀重建後 origin remote URL 遺失，需 `git remote add origin <URL>`（若尚未補）。
4. **build:css 未壓縮**：`package.json` 的 `--minify` 曾被移除，app.css 約大 3~5 倍；視需求加回。
5. **IIS HTTPS 綁定**（部署設定，非程式碼）。
6. **長期**：多人同時編輯為 last-write-wins（可評估 rowversion 樂觀鎖）；Sariel 尚有 18 筆 Task EndWeek=52
   （「W52→53」屬各環境資料調整，視需求處理）。

<!-- 更新原則：功能完成後更新上方概況（覆寫、保持精簡），待辦做完即刪；不再累積逐日流水帳 -->
