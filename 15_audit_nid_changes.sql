/* =====================================================================
   MSD 專案追蹤總表 — 遷移 15：讓「只改 NID」也能在異動紀錄呈現變化
   背景：遷移 14 新增 NID 欄位時，為求穩妥沒有把 NID 放進 AuditLog 的新舊值，
         導致只修改 NID（其他欄位不變）時，白話翻譯判定「內容未變更」而失去意義。
   本遷移：CREATE OR ALTER 兩個 SP，把 NID 併入稽核的 OldValue / NewValue，
         其餘行為與遷移 14 完全相同（僅稽核字串格式擴充）。
   相容性：歷史稽核列（14 之前）格式較短，後端白話翻譯以長度/分隔字元判斷，向下相容。
   可安全重複執行（idempotent）。
     sqlcmd -S Sariel -d Gantt -I -b -f 65001 -i 15_audit_nid_changes.sql
   ===================================================================== */
SET NOCOUNT ON;
GO
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

/* 專案：稽核新舊值格式由 type|分類|負責人|名稱 擴充為 type|分類|負責人|名稱|NID */
CREATE OR ALTER PROCEDURE dbo.usp_UpdateProject
    @ProjectId INT, @TypeCode CHAR(1), @Category NVARCHAR(20), @OwnerName NVARCHAR(50),
    @Name NVARCHAR(200), @Actor NVARCHAR(50), @ActorRole NVARCHAR(20)=NULL, @ActorEmpId NVARCHAR(20)=NULL,
    @NID NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Owner INT, @Old NVARCHAR(MAX);
    SELECT @Owner=UserId FROM dbo.Users WHERE UserName=@OwnerName;
    SELECT @Old=CONCAT(TypeCode,N'|',Category,N'|',(SELECT UserName FROM dbo.Users WHERE UserId=p.OwnerUserId),N'|',Name,N'|',ISNULL(NID,N''))
    FROM dbo.Projects p WHERE ProjectId=@ProjectId;
    UPDATE dbo.Projects SET TypeCode=@TypeCode,Category=@Category,OwnerUserId=@Owner,Name=@Name,
           NID=NULLIF(LTRIM(RTRIM(@NID)),N''),UpdatedAt=SYSDATETIME()
    WHERE ProjectId=@ProjectId;
    INSERT dbo.AuditLog(ActorName,ActorRole,ActorEmpId,Action,EntityType,EntityId,OldValue,NewValue)
    VALUES(@Actor,@ActorRole,@ActorEmpId,'UPDATE','Project',CONVERT(NVARCHAR(50),@ProjectId),@Old,
           CONCAT(@TypeCode,N'|',@Category,N'|',@OwnerName,N'|',@Name,N'|',ISNULL(NULLIF(LTRIM(RTRIM(@NID)),N''),N'')));
END
GO

/* 任務排程：稽核新舊值尾端以換行分隔附加 NID=... （name=... | W..-W.. \n NID=...） */
CREATE OR ALTER PROCEDURE dbo.usp_UpdateTaskSchedule
    @TaskCode NVARCHAR(30),
    @Name     NVARCHAR(200),
    @Start    INT,
    @End      INT,
    @Actor    NVARCHAR(50),
    @ActorRole NVARCHAR(20) = NULL,
    @ActorEmpId NVARCHAR(20) = NULL,
    @NID NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Old NVARCHAR(MAX);
    SELECT @Old = CONCAT(N'name=',TaskName,N' | W',StartWeek,N'-W',EndWeek,NCHAR(10),N'NID=',ISNULL(NID,N''))
    FROM dbo.Tasks WHERE TaskCode=@TaskCode;
    IF @Old IS NULL BEGIN RAISERROR('TaskCode 不存在',16,1); RETURN; END

    UPDATE dbo.Tasks SET TaskName=@Name, StartWeek=@Start, EndWeek=@End,
           NID=NULLIF(LTRIM(RTRIM(@NID)),N''), UpdatedAt=SYSDATETIME()
    WHERE TaskCode=@TaskCode;

    INSERT dbo.AuditLog(ActorName,ActorRole,ActorEmpId,Action,EntityType,EntityId,OldValue,NewValue)
    VALUES(@Actor,@ActorRole,@ActorEmpId,'UPDATE','Task',@TaskCode,@Old,
           CONCAT(N'name=',@Name,N' | W',@Start,N'-W',@End,NCHAR(10),N'NID=',ISNULL(NULLIF(LTRIM(RTRIM(@NID)),N''),N'')));
END
GO

PRINT '遷移 15 完成：usp_UpdateProject / usp_UpdateTaskSchedule 已把 NID 納入稽核新舊值。';
GO
