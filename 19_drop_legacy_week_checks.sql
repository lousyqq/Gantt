/* =====================================================================
   MSD 專案追蹤總表 — 遷移 19：移除殘留的 1–52 週次 CHECK 約束（W53 打卡修正）
   可安全重複執行（idempotent）。在 Gantt 資料庫下執行。
   sqlcmd 執行範例：
     sqlcmd -S Sariel -d Gantt -I -b -f 65001 -i 19_drop_legacy_week_checks.sql
   成因：
     old.sql 建表時的週次約束名為 CK_WLog_Week（WeeklyLogs）／CK_Extra_Week（ExtraNotes），上限 52。
     new.sql 升級到 53 週時，DROP 的是「新名字」CK_WeeklyLogs_WeekNo／CK_ExtraNotes_WeekNo（當時根本不存在），
     再用新名字建了 1–53 的約束 → 兩張表各留下**新舊兩條**約束同時生效，實際上限仍是 52。
     實測（2026-09-12，本機 Sariel\Gantt）：對 WeeklyLogs 寫入 WeekNo=53 →
       「INSERT 陳述式與 CHECK 條件約束 "CK_WLog_Week" 衝突」，API 端走 Fail(ex) 回 500 泛用訊息。
     2026 年度有 53 週（W53 = 2026-12-28～2027-01-03），年底一定踩到；遠端基準相同，務必執行。
   內容：
     1) DROP CONSTRAINT CK_WLog_Week（WeeklyLogs，1–52）—— 保留 CK_WeeklyLogs_WeekNo（1–53）
     2) DROP CONSTRAINT CK_Extra_Week（ExtraNotes，1–52）—— 保留 CK_ExtraNotes_WeekNo（1–53）
     WeeklyPlans／WeeklyComments／Tasks／ScheduleWeeks 的舊約束已在 new.sql 正確處理（或本來就是 53），不動。
   不影響任何資料；不動 SP。
   ===================================================================== */
SET NOCOUNT ON;
GO
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

/* 1) WeeklyLogs：移除 1–52 的舊約束（新約束 CK_WeeklyLogs_WeekNo 1–53 保留） */
IF EXISTS (SELECT 1 FROM sys.check_constraints
           WHERE name = 'CK_WLog_Week' AND parent_object_id = OBJECT_ID('dbo.WeeklyLogs'))
BEGIN
    ALTER TABLE dbo.WeeklyLogs DROP CONSTRAINT CK_WLog_Week;
    PRINT '已移除 WeeklyLogs.CK_WLog_Week (1-52)';
END
ELSE PRINT 'WeeklyLogs.CK_WLog_Week 不存在，略過';
GO

/* 保險：若新約束因故不存在，補建 1–53（正常情況 new.sql 已建） */
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
               WHERE name = 'CK_WeeklyLogs_WeekNo' AND parent_object_id = OBJECT_ID('dbo.WeeklyLogs'))
BEGIN
    ALTER TABLE dbo.WeeklyLogs WITH CHECK ADD CONSTRAINT CK_WeeklyLogs_WeekNo CHECK (WeekNo BETWEEN 1 AND 53);
    PRINT '已補建 WeeklyLogs.CK_WeeklyLogs_WeekNo (1-53)';
END
GO

/* 2) ExtraNotes：移除 1–52 的舊約束（新約束 CK_ExtraNotes_WeekNo 1–53 保留） */
IF EXISTS (SELECT 1 FROM sys.check_constraints
           WHERE name = 'CK_Extra_Week' AND parent_object_id = OBJECT_ID('dbo.ExtraNotes'))
BEGIN
    ALTER TABLE dbo.ExtraNotes DROP CONSTRAINT CK_Extra_Week;
    PRINT '已移除 ExtraNotes.CK_Extra_Week (1-52)';
END
ELSE PRINT 'ExtraNotes.CK_Extra_Week 不存在，略過';
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
               WHERE name = 'CK_ExtraNotes_WeekNo' AND parent_object_id = OBJECT_ID('dbo.ExtraNotes'))
BEGIN
    ALTER TABLE dbo.ExtraNotes WITH CHECK ADD CONSTRAINT CK_ExtraNotes_WeekNo CHECK (WeekNo BETWEEN 1 AND 53);
    PRINT '已補建 ExtraNotes.CK_ExtraNotes_WeekNo (1-53)';
END
GO

/* 驗證：列出兩張表目前的週次約束，應各只剩一條且上限 53 */
SELECT tbl = OBJECT_NAME(parent_object_id), name, definition
FROM sys.check_constraints
WHERE parent_object_id IN (OBJECT_ID('dbo.WeeklyLogs'), OBJECT_ID('dbo.ExtraNotes'))
  AND definition LIKE '%WeekNo%'
ORDER BY 1, 2;
GO
