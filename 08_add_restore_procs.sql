/* =====================================================================
   MSD 專案追蹤總表 — 遷移 08：軟刪除復原（Undo）預存程序
   ---------------------------------------------------------------------
   適用對象：已執行過 01~07 的資料庫。
   內容：
     1) usp_RestoreProject — 復原軟刪除的專案（連同其計畫區間 IsDeleted=0）
     2) usp_RestoreTask    — 復原軟刪除的單一計畫區間
   用途：前端刪除後 toast 的「復原」按鈕（10 秒內反悔），皆寫入 AuditLog(Action='RESTORE')。
   可安全重複執行（idempotent，CREATE OR ALTER）。
   sqlcmd 執行範例：
     sqlcmd -S <server> -d Gantt -I -b -f 65001 -i 08_add_restore_procs.sql
   ===================================================================== */
SET NOCOUNT ON;
GO

CREATE OR ALTER PROCEDURE dbo.usp_RestoreProject
    @ProjectId INT, @Actor NVARCHAR(50), @ActorRole NVARCHAR(20)=NULL, @ActorEmpId NVARCHAR(20)=NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.Projects WHERE ProjectId = @ProjectId)
    BEGIN RAISERROR('專案不存在',16,1); RETURN; END

    UPDATE dbo.Projects SET IsDeleted = 0, UpdatedAt = SYSDATETIME() WHERE ProjectId = @ProjectId;
    UPDATE dbo.Tasks    SET IsDeleted = 0, UpdatedAt = SYSDATETIME() WHERE ProjectId = @ProjectId;

    INSERT dbo.AuditLog(ActorName,ActorRole,ActorEmpId,Action,EntityType,EntityId,Detail)
    VALUES(@Actor,@ActorRole,@ActorEmpId,'RESTORE','Project',CONVERT(NVARCHAR(50),@ProjectId),N'復原軟刪除(含任務)');
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_RestoreTask
    @TaskCode NVARCHAR(30), @Actor NVARCHAR(50), @ActorRole NVARCHAR(20)=NULL, @ActorEmpId NVARCHAR(20)=NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.Tasks WHERE TaskCode = @TaskCode)
    BEGIN RAISERROR('TaskCode 不存在',16,1); RETURN; END

    UPDATE dbo.Tasks SET IsDeleted = 0, UpdatedAt = SYSDATETIME() WHERE TaskCode = @TaskCode;

    INSERT dbo.AuditLog(ActorName,ActorRole,ActorEmpId,Action,EntityType,EntityId,Detail)
    VALUES(@Actor,@ActorRole,@ActorEmpId,'RESTORE','Task',@TaskCode,N'復原軟刪除');
END
GO

PRINT '遷移 08 完成：usp_RestoreProject / usp_RestoreTask 已就緒。';
GO
