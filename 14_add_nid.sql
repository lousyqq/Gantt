/* =====================================================================
   MSD 專案追蹤總表 — 遷移 14：專案 NID（流水編號）＋ 區間 NID（對應哪組 NID）
   可安全重複執行（idempotent）。在 Gantt 資料庫下執行。
   sqlcmd 執行範例：
     sqlcmd -S Sariel -d Gantt -I -b -f 65001 -i 14_add_nid.sql
   內容：
     1) Projects.NID    NVARCHAR(200) NULL — 專案流水編號（選填；一專案可含多組，故留較長）
     2) Tasks.NID       NVARCHAR(200) NULL — 該進度區間對應哪組 NID（選填）
     3) CREATE OR ALTER usp_InsertProject / usp_UpdateProject（加 @NID）
        CREATE OR ALTER usp_InsertTask / usp_UpdateTaskSchedule（加 @NID）
        —— 僅新增選填參數與欄位寫入，其餘簽章與稽核格式完全不變（不影響既有呼叫與白話翻譯）
   ===================================================================== */
SET NOCOUNT ON;
GO

/* 1) 欄位（冪等） */
IF COL_LENGTH('dbo.Projects','NID') IS NULL
    ALTER TABLE dbo.Projects ADD NID NVARCHAR(200) NULL;
GO
IF COL_LENGTH('dbo.Tasks','NID') IS NULL
    ALTER TABLE dbo.Tasks ADD NID NVARCHAR(200) NULL;
GO

/* SP 一律以 QUOTED_IDENTIFIER ON 建立（沿用 2026-07-11 error 1934 教訓） */
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

/* 2) 新增專案（加 @NID，OUTPUT 參數維持最後） */
CREATE OR ALTER PROCEDURE dbo.usp_InsertProject
    @TypeCode CHAR(1), @Category NVARCHAR(20), @OwnerName NVARCHAR(50),
    @Name NVARCHAR(200), @Year INT = 2026, @Actor NVARCHAR(50), @ActorRole NVARCHAR(20)=NULL, @ActorEmpId NVARCHAR(20)=NULL,
    @NID NVARCHAR(200) = NULL,
    @NewProjectId INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Owner INT; SELECT @Owner=UserId FROM dbo.Users WHERE UserName=@OwnerName;
    IF @Owner IS NULL BEGIN RAISERROR('OwnerName 不存在',16,1); RETURN; END
    INSERT dbo.Projects(TypeCode,Category,OwnerUserId,Name,ScheduleYear,NID)
    VALUES(@TypeCode,@Category,@Owner,@Name,@Year,NULLIF(LTRIM(RTRIM(@NID)),N''));
    SET @NewProjectId = SCOPE_IDENTITY();
    INSERT dbo.AuditLog(ActorName,ActorRole,ActorEmpId,Action,EntityType,EntityId,NewValue)
    VALUES(@Actor,@ActorRole,@ActorEmpId,'INSERT','Project',CONVERT(NVARCHAR(50),@NewProjectId),
           CONCAT(@TypeCode,N'|',@Category,N'|',@OwnerName,N'|',@Name));
END
GO

/* 3) 修改專案（加 @NID） */
CREATE OR ALTER PROCEDURE dbo.usp_UpdateProject
    @ProjectId INT, @TypeCode CHAR(1), @Category NVARCHAR(20), @OwnerName NVARCHAR(50),
    @Name NVARCHAR(200), @Actor NVARCHAR(50), @ActorRole NVARCHAR(20)=NULL, @ActorEmpId NVARCHAR(20)=NULL,
    @NID NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Owner INT, @Old NVARCHAR(MAX);
    SELECT @Owner=UserId FROM dbo.Users WHERE UserName=@OwnerName;
    SELECT @Old=CONCAT(TypeCode,N'|',Category,N'|',(SELECT UserName FROM dbo.Users WHERE UserId=p.OwnerUserId),N'|',Name)
    FROM dbo.Projects p WHERE ProjectId=@ProjectId;
    UPDATE dbo.Projects SET TypeCode=@TypeCode,Category=@Category,OwnerUserId=@Owner,Name=@Name,
           NID=NULLIF(LTRIM(RTRIM(@NID)),N''),UpdatedAt=SYSDATETIME()
    WHERE ProjectId=@ProjectId;
    INSERT dbo.AuditLog(ActorName,ActorRole,ActorEmpId,Action,EntityType,EntityId,OldValue,NewValue)
    VALUES(@Actor,@ActorRole,@ActorEmpId,'UPDATE','Project',CONVERT(NVARCHAR(50),@ProjectId),@Old,
           CONCAT(@TypeCode,N'|',@Category,N'|',@OwnerName,N'|',@Name));
END
GO

/* 4) 新增任務/區間（加 @NID，OUTPUT 參數維持最後） */
CREATE OR ALTER PROCEDURE dbo.usp_InsertTask
    @ProjectId INT, @TaskName NVARCHAR(200), @Start INT, @End INT,
    @Actor NVARCHAR(50), @ActorRole NVARCHAR(20)=NULL, @ActorEmpId NVARCHAR(20)=NULL,
    @NID NVARCHAR(200) = NULL, @NewTaskCode NVARCHAR(30) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @NextSeq INT = (SELECT ISNULL(MAX(TRY_CONVERT(INT, RIGHT(TaskCode, CHARINDEX('-', REVERSE(TaskCode))-1))),0)+1
                            FROM dbo.Tasks WHERE ProjectId=@ProjectId);
    SET @NewTaskCode = CONCAT('t',@ProjectId,'-',@NextSeq);
    INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,NID)
    VALUES(@NewTaskCode,@ProjectId,@TaskName,@Start,@End,NULLIF(LTRIM(RTRIM(@NID)),N''));
    INSERT dbo.AuditLog(ActorName,ActorRole,ActorEmpId,Action,EntityType,EntityId,NewValue)
    VALUES(@Actor,@ActorRole,@ActorEmpId,'INSERT','Task',@NewTaskCode,CONCAT(@TaskName,N' | W',@Start,N'-W',@End));
END
GO

/* 5) 修改任務排程（加 @NID） */
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
    SELECT @Old = CONCAT(N'name=',TaskName,N' | W',StartWeek,N'-W',EndWeek)
    FROM dbo.Tasks WHERE TaskCode=@TaskCode;
    IF @Old IS NULL BEGIN RAISERROR('TaskCode 不存在',16,1); RETURN; END

    UPDATE dbo.Tasks SET TaskName=@Name, StartWeek=@Start, EndWeek=@End,
           NID=NULLIF(LTRIM(RTRIM(@NID)),N''), UpdatedAt=SYSDATETIME()
    WHERE TaskCode=@TaskCode;

    INSERT dbo.AuditLog(ActorName,ActorRole,ActorEmpId,Action,EntityType,EntityId,OldValue,NewValue)
    VALUES(@Actor,@ActorRole,@ActorEmpId,'UPDATE','Task',@TaskCode,@Old,
           CONCAT(N'name=',@Name,N' | W',@Start,N'-W',@End));
END
GO

PRINT '遷移 14 完成：Projects.NID / Tasks.NID 與四個 SP 已就緒。';
GO
