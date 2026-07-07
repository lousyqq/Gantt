/* =====================================================================
   MSD 專案追蹤總表 — 遷移 04：新增專案類型 e「主管交辦」
   ---------------------------------------------------------------------
   適用對象：已執行過 01→02→03 的資料庫。
   可安全重複執行（idempotent）。在 Gantt 資料庫下執行。
   sqlcmd 執行範例：
     sqlcmd -S Sariel -d Gantt -I -b -f 65001 -i 04_add_type_e_supervisor.sql
   ===================================================================== */
SET NOCOUNT ON;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.ProjectTypes WHERE TypeCode = 'e')
    INSERT dbo.ProjectTypes(TypeCode, Label, SortOrder) VALUES('e', N'主管交辦', 5);
GO

PRINT '遷移 04 完成：專案類型 e「主管交辦」已就緒。';
GO
