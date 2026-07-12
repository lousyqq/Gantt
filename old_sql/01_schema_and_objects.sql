/* =====================================================================
   MSD 專案追蹤總表 — 資料庫結構 (MSSQL 2019)
   Database: Gantt
   執行順序: 01_schema_and_objects.sql → 02_seed_data.sql
   說明:
     - 所有寫入(新增/修改/刪除/打卡/非專案事項)都經由預存程序,
       並自動寫入 AuditLog,達成「誰、什麼時候、改了什麼」的完整追蹤。
     - 專案/任務採「軟刪除」(IsDeleted=1),保留歷史不真正刪除。
   ===================================================================== */

-- 若要重建,先確保在 Gantt 資料庫下執行
-- USE [Gantt];
-- GO

SET NOCOUNT ON;
GO

/* ---------- 清除舊物件 (方便重建;正式環境請斟酌) ---------- */
IF OBJECT_ID('dbo.usp_UpsertWeeklyLog','P')   IS NOT NULL DROP PROCEDURE dbo.usp_UpsertWeeklyLog;
IF OBJECT_ID('dbo.usp_UpsertExtraNote','P')   IS NOT NULL DROP PROCEDURE dbo.usp_UpsertExtraNote;
IF OBJECT_ID('dbo.usp_UpdateTaskSchedule','P')IS NOT NULL DROP PROCEDURE dbo.usp_UpdateTaskSchedule;
IF OBJECT_ID('dbo.usp_InsertProject','P')     IS NOT NULL DROP PROCEDURE dbo.usp_InsertProject;
IF OBJECT_ID('dbo.usp_UpdateProject','P')     IS NOT NULL DROP PROCEDURE dbo.usp_UpdateProject;
IF OBJECT_ID('dbo.usp_DeleteProject','P')     IS NOT NULL DROP PROCEDURE dbo.usp_DeleteProject;
IF OBJECT_ID('dbo.usp_ReorderProjects','P')   IS NOT NULL DROP PROCEDURE dbo.usp_ReorderProjects;
IF OBJECT_ID('dbo.usp_InsertTask','P')        IS NOT NULL DROP PROCEDURE dbo.usp_InsertTask;
IF OBJECT_ID('dbo.usp_DeleteTask','P')        IS NOT NULL DROP PROCEDURE dbo.usp_DeleteTask;
IF OBJECT_ID('dbo.usp_EnsureScheduleYear','P') IS NOT NULL DROP PROCEDURE dbo.usp_EnsureScheduleYear;
IF OBJECT_ID('dbo.usp_InsertUser','P')        IS NOT NULL DROP PROCEDURE dbo.usp_InsertUser;
IF OBJECT_ID('dbo.usp_UpdateUser','P')        IS NOT NULL DROP PROCEDURE dbo.usp_UpdateUser;
IF OBJECT_ID('dbo.usp_DeleteUser','P')        IS NOT NULL DROP PROCEDURE dbo.usp_DeleteUser;

IF OBJECT_ID('dbo.vw_WeeklyReport','V') IS NOT NULL DROP VIEW dbo.vw_WeeklyReport;
IF OBJECT_ID('dbo.vw_ProjectTasks','V') IS NOT NULL DROP VIEW dbo.vw_ProjectTasks;

IF OBJECT_ID('dbo.AuditLog','U')       IS NOT NULL DROP TABLE dbo.AuditLog;
IF OBJECT_ID('dbo.ExtraNotes','U')     IS NOT NULL DROP TABLE dbo.ExtraNotes;
IF OBJECT_ID('dbo.WeeklyLogs','U')     IS NOT NULL DROP TABLE dbo.WeeklyLogs;
IF OBJECT_ID('dbo.Tasks','U')          IS NOT NULL DROP TABLE dbo.Tasks;
IF OBJECT_ID('dbo.Projects','U')       IS NOT NULL DROP TABLE dbo.Projects;
IF OBJECT_ID('dbo.ScheduleWeeks','U')  IS NOT NULL DROP TABLE dbo.ScheduleWeeks;
IF OBJECT_ID('dbo.ProjectTypes','U')   IS NOT NULL DROP TABLE dbo.ProjectTypes;
IF OBJECT_ID('dbo.Users','U')          IS NOT NULL DROP TABLE dbo.Users;
GO

/* =====================================================================
   1) Users — 使用者(6 位成員 + 主管)
   ===================================================================== */
CREATE TABLE dbo.Users (
    UserId       INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Users PRIMARY KEY,
    UserName     NVARCHAR(50)  NOT NULL,               -- 顯示名稱: 裕隆 / 玉婷 ... / 管理部主管
    Role         NVARCHAR(20)  NOT NULL,               -- 'manager' | 'member'
    IsActive     BIT           NOT NULL CONSTRAINT DF_Users_IsActive DEFAULT(1),
    SortOrder    INT           NOT NULL CONSTRAINT DF_Users_Sort DEFAULT(0),
    CreatedAt    DATETIME2(0)  NOT NULL CONSTRAINT DF_Users_Created DEFAULT(SYSDATETIME()),
    CONSTRAINT UQ_Users_UserName UNIQUE (UserName),
    CONSTRAINT CK_Users_Role CHECK (Role IN ('manager','member'))
);
GO

/* =====================================================================
   2) ProjectTypes — 專案分類 a/b/c/d
   ===================================================================== */
CREATE TABLE dbo.ProjectTypes (
    TypeCode     CHAR(1)      NOT NULL CONSTRAINT PK_ProjectTypes PRIMARY KEY,  -- a/b/c/d
    Label        NVARCHAR(50) NOT NULL,
    SortOrder    INT          NOT NULL CONSTRAINT DF_PType_Sort DEFAULT(0)
);
GO

/* =====================================================================
   3) ScheduleWeeks — 週次 ↔ 月份對照(供 DB 依月份彙總查詢)
   ===================================================================== */
CREATE TABLE dbo.ScheduleWeeks (
    ScheduleYear INT          NOT NULL,        -- 2026
    WeekNo       INT          NOT NULL,        -- 1..52
    MonthName    CHAR(6)      NOT NULL,        -- '202601'
    MonthLabel   NVARCHAR(10) NOT NULL,        -- '2026/01'
    CONSTRAINT PK_ScheduleWeeks PRIMARY KEY (ScheduleYear, WeekNo),
    CONSTRAINT CK_ScheduleWeeks_Week CHECK (WeekNo BETWEEN 1 AND 53)
);
GO

/* =====================================================================
   4) Projects — 專案主檔
   ===================================================================== */
CREATE TABLE dbo.Projects (
    ProjectId    INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Projects PRIMARY KEY,
    TypeCode     CHAR(1)       NOT NULL,
    Category     NVARCHAR(20)  NOT NULL,               -- FDC / 防護 / 維運 ...
    OwnerUserId  INT           NOT NULL,               -- 負責人
    Name         NVARCHAR(200) NOT NULL,               -- 專案名稱
    ScheduleYear INT           NOT NULL CONSTRAINT DF_Projects_Year DEFAULT(2026),
    SortOrder    INT           NOT NULL CONSTRAINT DF_Projects_Sort DEFAULT(0),  -- 同一負責人內的顯示順序(主管可拖曳調整)
    IsDeleted    BIT           NOT NULL CONSTRAINT DF_Projects_Del DEFAULT(0),
    CreatedAt    DATETIME2(0)  NOT NULL CONSTRAINT DF_Projects_Created DEFAULT(SYSDATETIME()),
    UpdatedAt    DATETIME2(0)  NOT NULL CONSTRAINT DF_Projects_Updated DEFAULT(SYSDATETIME()),
    CONSTRAINT FK_Projects_Type  FOREIGN KEY (TypeCode)    REFERENCES dbo.ProjectTypes(TypeCode),
    CONSTRAINT FK_Projects_Owner FOREIGN KEY (OwnerUserId) REFERENCES dbo.Users(UserId)
);
GO
CREATE INDEX IX_Projects_Owner ON dbo.Projects(OwnerUserId) WHERE IsDeleted = 0;
GO

/* =====================================================================
   5) Tasks — 專案任務/區間(每段有起訖週 + 要做什麼的定義)
   TaskCode: 對應前端使用的識別碼(如 t101-1),方便前後端一致
   ===================================================================== */
CREATE TABLE dbo.Tasks (
    TaskId       INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Tasks PRIMARY KEY,
    TaskCode     NVARCHAR(30)  NOT NULL,               -- t101-1
    ProjectId    INT           NOT NULL,
    TaskName     NVARCHAR(200) NOT NULL,               -- 區間要做的事(定義)
    StartWeek    INT           NOT NULL,               -- 1..52
    EndWeek      INT           NOT NULL,               -- 1..52
    SortOrder    INT           NOT NULL CONSTRAINT DF_Tasks_Sort DEFAULT(0),
    IsDeleted    BIT           NOT NULL CONSTRAINT DF_Tasks_Del DEFAULT(0),
    CreatedAt    DATETIME2(0)  NOT NULL CONSTRAINT DF_Tasks_Created DEFAULT(SYSDATETIME()),
    UpdatedAt    DATETIME2(0)  NOT NULL CONSTRAINT DF_Tasks_Updated DEFAULT(SYSDATETIME()),
    CONSTRAINT UQ_Tasks_Code UNIQUE (TaskCode),
    CONSTRAINT FK_Tasks_Project FOREIGN KEY (ProjectId) REFERENCES dbo.Projects(ProjectId),
    CONSTRAINT CK_Tasks_Weeks CHECK (StartWeek BETWEEN 1 AND 52 AND EndWeek BETWEEN 1 AND 52 AND StartWeek <= EndWeek)
);
GO
CREATE INDEX IX_Tasks_Project ON dbo.Tasks(ProjectId) WHERE IsDeleted = 0;
GO

/* =====================================================================
   6) WeeklyLogs — 每週打卡(哪一週、哪個任務、做了什麼)
   Status: 'executed'(有執行) | 'monitor'(例行監控) | 'not_executed'(未執行)
   一個任務每年每週最多一筆(可覆寫)
   ===================================================================== */
CREATE TABLE dbo.WeeklyLogs (
    LogId          INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_WeeklyLogs PRIMARY KEY,
    TaskId         INT           NOT NULL,
    ScheduleYear   INT           NOT NULL CONSTRAINT DF_WLog_Year DEFAULT(2026),
    WeekNo         INT           NOT NULL,             -- 1..52
    Status         NVARCHAR(20)  NOT NULL,
    Note           NVARCHAR(MAX)  NULL,
    ReportedByUserId INT          NOT NULL,            -- 回報人
    ReportedAt     DATETIME2(0)  NOT NULL CONSTRAINT DF_WLog_At DEFAULT(SYSDATETIME()),
    UpdatedAt      DATETIME2(0)  NOT NULL CONSTRAINT DF_WLog_Upd DEFAULT(SYSDATETIME()),
    CONSTRAINT UQ_WeeklyLogs UNIQUE (TaskId, ScheduleYear, WeekNo),
    CONSTRAINT FK_WLog_Task   FOREIGN KEY (TaskId)           REFERENCES dbo.Tasks(TaskId),
    CONSTRAINT FK_WLog_User   FOREIGN KEY (ReportedByUserId) REFERENCES dbo.Users(UserId),
    CONSTRAINT CK_WLog_Status CHECK (Status IN ('executed','monitor','not_executed')),
    CONSTRAINT CK_WLog_Week   CHECK (WeekNo BETWEEN 1 AND 52)
);
GO
CREATE INDEX IX_WLog_YearWeek ON dbo.WeeklyLogs(ScheduleYear, WeekNo);
GO

/* =====================================================================
   7) ExtraNotes — 非專案事項(每人每年每週一筆)
   ===================================================================== */
CREATE TABLE dbo.ExtraNotes (
    ExtraNoteId    INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ExtraNotes PRIMARY KEY,
    UserId         INT           NOT NULL,
    ScheduleYear   INT           NOT NULL CONSTRAINT DF_Extra_Year DEFAULT(2026),
    WeekNo         INT           NOT NULL,
    Note           NVARCHAR(MAX) NOT NULL,
    UpdatedByUserId INT          NOT NULL,
    UpdatedAt      DATETIME2(0)  NOT NULL CONSTRAINT DF_Extra_Upd DEFAULT(SYSDATETIME()),
    CONSTRAINT UQ_ExtraNotes UNIQUE (UserId, ScheduleYear, WeekNo),
    CONSTRAINT FK_Extra_User    FOREIGN KEY (UserId)          REFERENCES dbo.Users(UserId),
    CONSTRAINT FK_Extra_UpdUser FOREIGN KEY (UpdatedByUserId) REFERENCES dbo.Users(UserId),
    CONSTRAINT CK_Extra_Week    CHECK (WeekNo BETWEEN 1 AND 52)
);
GO

/* =====================================================================
   8) AuditLog — 完整操作稽核(誰、何時、對什麼、做了什麼、改前改後)
   ===================================================================== */
CREATE TABLE dbo.AuditLog (
    AuditId       BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AuditLog PRIMARY KEY,
    ActorName     NVARCHAR(50)  NOT NULL,              -- 操作者顯示名稱
    ActorRole     NVARCHAR(20)   NULL,                 -- manager/member
    ActorEmpId    NVARCHAR(20)   NULL,                 -- 操作者 Windows 工號(由 /api/whoami 偵測,如 00058897;非網域環境為 NULL)
    Action        NVARCHAR(30)  NOT NULL,              -- INSERT/UPDATE/DELETE/CLOCKIN/EXTRANOTE
    EntityType    NVARCHAR(30)  NOT NULL,              -- Project/Task/WeeklyLog/ExtraNote
    EntityId      NVARCHAR(50)   NULL,                 -- ProjectId / TaskCode / 週次key
    FieldName     NVARCHAR(50)   NULL,
    OldValue      NVARCHAR(MAX)  NULL,
    NewValue      NVARCHAR(MAX)  NULL,
    Detail        NVARCHAR(MAX)  NULL,                 -- 額外 JSON / 說明
    CreatedAt     DATETIME2(0)  NOT NULL CONSTRAINT DF_Audit_At DEFAULT(SYSDATETIME())
);
GO
CREATE INDEX IX_Audit_Entity ON dbo.AuditLog(EntityType, EntityId);
CREATE INDEX IX_Audit_CreatedAt ON dbo.AuditLog(CreatedAt);
GO

/* =====================================================================
   檢視表 (Views) — 方便直接查詢
   ===================================================================== */
GO
CREATE VIEW dbo.vw_ProjectTasks AS
SELECT  p.ProjectId, p.TypeCode, pt.Label AS TypeLabel, p.Category,
        u.UserName AS OwnerName, p.Name AS ProjectName, p.ScheduleYear,
        t.TaskId, t.TaskCode, t.TaskName, t.StartWeek, t.EndWeek, t.SortOrder,
        p.IsDeleted AS ProjectDeleted, t.IsDeleted AS TaskDeleted
FROM dbo.Projects p
JOIN dbo.Users u        ON u.UserId = p.OwnerUserId
JOIN dbo.ProjectTypes pt ON pt.TypeCode = p.TypeCode
LEFT JOIN dbo.Tasks t   ON t.ProjectId = p.ProjectId AND t.IsDeleted = 0
WHERE p.IsDeleted = 0;
GO

CREATE VIEW dbo.vw_WeeklyReport AS
SELECT  w.ScheduleYear, w.WeekNo, sw.MonthLabel,
        owner.UserName AS OwnerName,
        p.ProjectId, p.Name AS ProjectName, p.Category, p.TypeCode,
        t.TaskCode, t.TaskName, t.StartWeek, t.EndWeek,
        w.Status, w.Note,
        rep.UserName AS ReportedBy, w.ReportedAt
FROM dbo.WeeklyLogs w
JOIN dbo.Tasks t     ON t.TaskId = w.TaskId
JOIN dbo.Projects p  ON p.ProjectId = t.ProjectId
JOIN dbo.Users owner ON owner.UserId = p.OwnerUserId
JOIN dbo.Users rep   ON rep.UserId = w.ReportedByUserId
LEFT JOIN dbo.ScheduleWeeks sw ON sw.ScheduleYear = w.ScheduleYear AND sw.WeekNo = w.WeekNo;
GO

/* =====================================================================
   預存程序 (Stored Procedures) — 所有寫入都走這裡並記錄 AuditLog
   ===================================================================== */
GO
-- 8.1 打卡 upsert -----------------------------------------------------
CREATE PROCEDURE dbo.usp_UpsertWeeklyLog
    @TaskCode NVARCHAR(30),
    @Year     INT,
    @Week     INT,
    @Status   NVARCHAR(20),
    @Note     NVARCHAR(MAX),
    @Actor    NVARCHAR(50),
    @ActorRole NVARCHAR(20) = NULL,
    @ActorEmpId NVARCHAR(20) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @TaskId INT, @ActorId INT, @OldStatus NVARCHAR(20), @OldNote NVARCHAR(MAX);
    SELECT @TaskId = TaskId FROM dbo.Tasks WHERE TaskCode = @TaskCode;
    SELECT @ActorId = UserId FROM dbo.Users WHERE UserName = @Actor;
    IF @TaskId IS NULL OR @ActorId IS NULL
    BEGIN RAISERROR('TaskCode 或 Actor 不存在',16,1); RETURN; END

    SELECT @OldStatus = Status, @OldNote = Note
    FROM dbo.WeeklyLogs WHERE TaskId=@TaskId AND ScheduleYear=@Year AND WeekNo=@Week;

    MERGE dbo.WeeklyLogs AS tgt
    USING (SELECT @TaskId AS TaskId, @Year AS Y, @Week AS W) AS src
       ON tgt.TaskId=src.TaskId AND tgt.ScheduleYear=src.Y AND tgt.WeekNo=src.W
    WHEN MATCHED THEN
        UPDATE SET Status=@Status, Note=@Note, ReportedByUserId=@ActorId, UpdatedAt=SYSDATETIME()
    WHEN NOT MATCHED THEN
        INSERT (TaskId,ScheduleYear,WeekNo,Status,Note,ReportedByUserId)
        VALUES (@TaskId,@Year,@Week,@Status,@Note,@ActorId);

    INSERT dbo.AuditLog(ActorName,ActorRole,ActorEmpId,Action,EntityType,EntityId,FieldName,OldValue,NewValue,Detail)
    VALUES(@Actor,@ActorRole,@ActorEmpId,'CLOCKIN','WeeklyLog',
           CONCAT(@TaskCode,'@',@Year,'W',@Week),'status',
           @OldStatus, @Status,
           CONCAT(N'note舊=',ISNULL(@OldNote,N''),N' | note新=',ISNULL(@Note,N'')));
END
GO

-- 8.2 非專案事項 upsert ----------------------------------------------
CREATE PROCEDURE dbo.usp_UpsertExtraNote
    @UserName NVARCHAR(50),
    @Year     INT,
    @Week     INT,
    @Note     NVARCHAR(MAX),
    @Actor    NVARCHAR(50),
    @ActorRole NVARCHAR(20) = NULL,
    @ActorEmpId NVARCHAR(20) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Uid INT, @ActorId INT, @OldNote NVARCHAR(MAX);
    SELECT @Uid = UserId FROM dbo.Users WHERE UserName=@UserName;
    SELECT @ActorId = UserId FROM dbo.Users WHERE UserName=@Actor;
    IF @Uid IS NULL OR @ActorId IS NULL BEGIN RAISERROR('User 不存在',16,1); RETURN; END

    SELECT @OldNote = Note FROM dbo.ExtraNotes WHERE UserId=@Uid AND ScheduleYear=@Year AND WeekNo=@Week;

    MERGE dbo.ExtraNotes AS tgt
    USING (SELECT @Uid AS U,@Year AS Y,@Week AS W) AS src
       ON tgt.UserId=src.U AND tgt.ScheduleYear=src.Y AND tgt.WeekNo=src.W
    WHEN MATCHED THEN UPDATE SET Note=@Note, UpdatedByUserId=@ActorId, UpdatedAt=SYSDATETIME()
    WHEN NOT MATCHED THEN INSERT(UserId,ScheduleYear,WeekNo,Note,UpdatedByUserId)
                          VALUES(@Uid,@Year,@Week,@Note,@ActorId);

    INSERT dbo.AuditLog(ActorName,ActorRole,ActorEmpId,Action,EntityType,EntityId,OldValue,NewValue)
    VALUES(@Actor,@ActorRole,@ActorEmpId,'EXTRANOTE','ExtraNote',CONCAT(@UserName,'@',@Year,'W',@Week),@OldNote,@Note);
END
GO

-- 8.3 主管修改任務排程(名稱/起訖) ------------------------------------
CREATE PROCEDURE dbo.usp_UpdateTaskSchedule
    @TaskCode NVARCHAR(30),
    @Name     NVARCHAR(200),
    @Start    INT,
    @End      INT,
    @Actor    NVARCHAR(50),
    @ActorRole NVARCHAR(20) = NULL,
    @ActorEmpId NVARCHAR(20) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Old NVARCHAR(MAX);
    SELECT @Old = CONCAT(N'name=',TaskName,N' | W',StartWeek,N'-W',EndWeek)
    FROM dbo.Tasks WHERE TaskCode=@TaskCode;
    IF @Old IS NULL BEGIN RAISERROR('TaskCode 不存在',16,1); RETURN; END

    UPDATE dbo.Tasks SET TaskName=@Name, StartWeek=@Start, EndWeek=@End, UpdatedAt=SYSDATETIME()
    WHERE TaskCode=@TaskCode;

    INSERT dbo.AuditLog(ActorName,ActorRole,ActorEmpId,Action,EntityType,EntityId,OldValue,NewValue)
    VALUES(@Actor,@ActorRole,@ActorEmpId,'UPDATE','Task',@TaskCode,@Old,
           CONCAT(N'name=',@Name,N' | W',@Start,N'-W',@End));
END
GO

-- 8.4 新增專案 --------------------------------------------------------
CREATE PROCEDURE dbo.usp_InsertProject
    @TypeCode CHAR(1), @Category NVARCHAR(20), @OwnerName NVARCHAR(50),
    @Name NVARCHAR(200), @Year INT = 2026, @Actor NVARCHAR(50), @ActorRole NVARCHAR(20)=NULL, @ActorEmpId NVARCHAR(20)=NULL,
    @NewProjectId INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Owner INT; SELECT @Owner=UserId FROM dbo.Users WHERE UserName=@OwnerName;
    IF @Owner IS NULL BEGIN RAISERROR('OwnerName 不存在',16,1); RETURN; END
    INSERT dbo.Projects(TypeCode,Category,OwnerUserId,Name,ScheduleYear)
    VALUES(@TypeCode,@Category,@Owner,@Name,@Year);
    SET @NewProjectId = SCOPE_IDENTITY();
    INSERT dbo.AuditLog(ActorName,ActorRole,ActorEmpId,Action,EntityType,EntityId,NewValue)
    VALUES(@Actor,@ActorRole,@ActorEmpId,'INSERT','Project',CONVERT(NVARCHAR(50),@NewProjectId),
           CONCAT(@TypeCode,N'|',@Category,N'|',@OwnerName,N'|',@Name));
END
GO

-- 8.5 修改專案 --------------------------------------------------------
CREATE PROCEDURE dbo.usp_UpdateProject
    @ProjectId INT, @TypeCode CHAR(1), @Category NVARCHAR(20), @OwnerName NVARCHAR(50),
    @Name NVARCHAR(200), @Actor NVARCHAR(50), @ActorRole NVARCHAR(20)=NULL, @ActorEmpId NVARCHAR(20)=NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Owner INT, @Old NVARCHAR(MAX);
    SELECT @Owner=UserId FROM dbo.Users WHERE UserName=@OwnerName;
    SELECT @Old=CONCAT(TypeCode,N'|',Category,N'|',(SELECT UserName FROM dbo.Users WHERE UserId=p.OwnerUserId),N'|',Name)
    FROM dbo.Projects p WHERE ProjectId=@ProjectId;
    UPDATE dbo.Projects SET TypeCode=@TypeCode,Category=@Category,OwnerUserId=@Owner,Name=@Name,UpdatedAt=SYSDATETIME()
    WHERE ProjectId=@ProjectId;
    INSERT dbo.AuditLog(ActorName,ActorRole,ActorEmpId,Action,EntityType,EntityId,OldValue,NewValue)
    VALUES(@Actor,@ActorRole,@ActorEmpId,'UPDATE','Project',CONVERT(NVARCHAR(50),@ProjectId),@Old,
           CONCAT(@TypeCode,N'|',@Category,N'|',@OwnerName,N'|',@Name));
END
GO

-- 8.6 刪除專案(軟刪除,連同其任務) ------------------------------------
CREATE PROCEDURE dbo.usp_DeleteProject
    @ProjectId INT, @Actor NVARCHAR(50), @ActorRole NVARCHAR(20)=NULL, @ActorEmpId NVARCHAR(20)=NULL
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.Projects SET IsDeleted=1, UpdatedAt=SYSDATETIME() WHERE ProjectId=@ProjectId;
    UPDATE dbo.Tasks    SET IsDeleted=1, UpdatedAt=SYSDATETIME() WHERE ProjectId=@ProjectId;
    INSERT dbo.AuditLog(ActorName,ActorRole,ActorEmpId,Action,EntityType,EntityId,Detail)
    VALUES(@Actor,@ActorRole,@ActorEmpId,'DELETE','Project',CONVERT(NVARCHAR(50),@ProjectId),N'軟刪除(含任務)');
END
GO

-- 8.7 新增任務 --------------------------------------------------------
CREATE PROCEDURE dbo.usp_InsertTask
    @ProjectId INT, @TaskName NVARCHAR(200), @Start INT, @End INT,
    @Actor NVARCHAR(50), @ActorRole NVARCHAR(20)=NULL, @ActorEmpId NVARCHAR(20)=NULL, @NewTaskCode NVARCHAR(30) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @NextSeq INT = (SELECT ISNULL(MAX(TRY_CONVERT(INT, RIGHT(TaskCode, CHARINDEX('-', REVERSE(TaskCode))-1))),0)+1
                            FROM dbo.Tasks WHERE ProjectId=@ProjectId);
    SET @NewTaskCode = CONCAT('t',@ProjectId,'-',@NextSeq);
    INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek)
    VALUES(@NewTaskCode,@ProjectId,@TaskName,@Start,@End);
    INSERT dbo.AuditLog(ActorName,ActorRole,ActorEmpId,Action,EntityType,EntityId,NewValue)
    VALUES(@Actor,@ActorRole,@ActorEmpId,'INSERT','Task',@NewTaskCode,CONCAT(@TaskName,N' | W',@Start,N'-W',@End));
END
GO

-- 8.8 刪除任務(軟刪除) ------------------------------------------------
CREATE PROCEDURE dbo.usp_DeleteTask
    @TaskCode NVARCHAR(30), @Actor NVARCHAR(50), @ActorRole NVARCHAR(20)=NULL, @ActorEmpId NVARCHAR(20)=NULL
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.Tasks SET IsDeleted=1, UpdatedAt=SYSDATETIME() WHERE TaskCode=@TaskCode;
    INSERT dbo.AuditLog(ActorName,ActorRole,ActorEmpId,Action,EntityType,EntityId,Detail)
    VALUES(@Actor,@ActorRole,@ActorEmpId,'DELETE','Task',@TaskCode,N'軟刪除');
END
GO

-- 8.9 重新排序專案(同一負責人內的顯示順序) --------------------------
CREATE PROCEDURE dbo.usp_ReorderProjects
    @OrderedIdsJson NVARCHAR(MAX),          -- 例:'[105,101,110]'
    @Actor NVARCHAR(50),
    @ActorRole NVARCHAR(20) = NULL,
    @ActorEmpId NVARCHAR(20) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE p
       SET p.SortOrder = j.seq + 1,
           p.UpdatedAt = SYSDATETIME()
    FROM dbo.Projects p
    JOIN (
        SELECT CONVERT(INT,[value]) AS ProjectId,
               CONVERT(INT,[key])   AS seq
        FROM OPENJSON(@OrderedIdsJson)
    ) j ON j.ProjectId = p.ProjectId;

    INSERT dbo.AuditLog(ActorName,ActorRole,ActorEmpId,Action,EntityType,EntityId,NewValue)
    VALUES(@Actor,@ActorRole,@ActorEmpId,'REORDER','Project',NULL,@OrderedIdsJson);
END
GO

-- 8.10 新增成員(同名成員曾被移除則重新啟用,保留其歷史資料) ------------
CREATE PROCEDURE dbo.usp_InsertUser
    @UserName NVARCHAR(50), @Actor NVARCHAR(50), @ActorRole NVARCHAR(20)=NULL, @ActorEmpId NVARCHAR(20)=NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET @UserName = LTRIM(RTRIM(ISNULL(@UserName, N'')));
    IF @UserName = N'' BEGIN RAISERROR('成員名稱不可空白',16,1); RETURN; END

    DECLARE @Uid INT, @Active BIT;
    SELECT @Uid = UserId, @Active = IsActive FROM dbo.Users WHERE UserName = @UserName;
    IF @Uid IS NOT NULL AND @Active = 1
    BEGIN RAISERROR('成員名稱已存在',16,1); RETURN; END

    IF @Uid IS NOT NULL  -- 曾被移除 → 重新啟用(歷史專案與回報自動恢復可見)
    BEGIN
        UPDATE dbo.Users SET IsActive = 1 WHERE UserId = @Uid;
        INSERT dbo.AuditLog(ActorName,ActorRole,ActorEmpId,Action,EntityType,EntityId,Detail)
        VALUES(@Actor,@ActorRole,@ActorEmpId,'INSERT','User',@UserName,N'重新啟用成員');
        RETURN;
    END

    INSERT dbo.Users(UserName,Role,SortOrder)
    VALUES(@UserName,'member',(SELECT ISNULL(MAX(SortOrder),0)+1 FROM dbo.Users));
    INSERT dbo.AuditLog(ActorName,ActorRole,ActorEmpId,Action,EntityType,EntityId,Detail)
    VALUES(@Actor,@ActorRole,@ActorEmpId,'INSERT','User',@UserName,N'新增成員');
END
GO

-- 8.11 修改成員名稱(專案/回報以 UserId 關聯,改名後歷史資料自動跟隨) --
CREATE PROCEDURE dbo.usp_UpdateUser
    @UserName NVARCHAR(50), @NewName NVARCHAR(50), @Actor NVARCHAR(50), @ActorRole NVARCHAR(20)=NULL, @ActorEmpId NVARCHAR(20)=NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET @NewName = LTRIM(RTRIM(ISNULL(@NewName, N'')));
    IF @NewName = N'' BEGIN RAISERROR('成員名稱不可空白',16,1); RETURN; END

    DECLARE @Uid INT;
    SELECT @Uid = UserId FROM dbo.Users WHERE UserName = @UserName AND IsActive = 1;
    IF @Uid IS NULL BEGIN RAISERROR('成員不存在或已移除',16,1); RETURN; END
    IF @NewName = @UserName RETURN;   -- 沒改,不動也不記錄
    IF EXISTS (SELECT 1 FROM dbo.Users WHERE UserName = @NewName)
    BEGIN RAISERROR('成員名稱已存在',16,1); RETURN; END

    UPDATE dbo.Users SET UserName = @NewName WHERE UserId = @Uid;
    INSERT dbo.AuditLog(ActorName,ActorRole,ActorEmpId,Action,EntityType,EntityId,OldValue,NewValue)
    VALUES(@Actor,@ActorRole,@ActorEmpId,'UPDATE','User',@NewName,@UserName,@NewName);
END
GO

-- 8.12 移除成員(軟刪除=IsActive:0;名下仍有專案時擋下) ----------------
CREATE PROCEDURE dbo.usp_DeleteUser
    @UserName NVARCHAR(50), @Actor NVARCHAR(50), @ActorRole NVARCHAR(20)=NULL, @ActorEmpId NVARCHAR(20)=NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Uid INT, @Role NVARCHAR(20);
    SELECT @Uid = UserId, @Role = Role FROM dbo.Users WHERE UserName = @UserName AND IsActive = 1;
    IF @Uid IS NULL BEGIN RAISERROR('成員不存在或已移除',16,1); RETURN; END
    IF @Role = 'manager' BEGIN RAISERROR('不可移除主管帳號',16,1); RETURN; END
    IF EXISTS (SELECT 1 FROM dbo.Projects WHERE OwnerUserId = @Uid AND IsDeleted = 0)
    BEGIN RAISERROR('該成員名下仍有專案，請先刪除專案或於「編輯專案」改派負責人後再移除',16,1); RETURN; END

    UPDATE dbo.Users SET IsActive = 0 WHERE UserId = @Uid;
    INSERT dbo.AuditLog(ActorName,ActorRole,ActorEmpId,Action,EntityType,EntityId,Detail)
    VALUES(@Actor,@ActorRole,@ActorEmpId,'DELETE','User',@UserName,N'移除成員(停用,歷史回報保留)');
END
GO

-- 8.x 產生指定年度的 ScheduleWeeks 週資料(若尚未存在) ------------------
-- 用法:EXEC dbo.usp_EnsureScheduleYear 2027;  之後前端年度下拉即可選到該年
CREATE PROCEDURE dbo.usp_EnsureScheduleYear
    @Year INT
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (SELECT 1 FROM dbo.ScheduleWeeks WHERE ScheduleYear = @Year) RETURN;

    -- ISO 8601:第 1 週=含 1/4 的那一週(週一起始);每週所屬月份取該週「週四」的月份
    DECLARE @jan4     DATE = DATEFROMPARTS(@Year, 1, 4);
    DECLARE @dowMon   INT  = (DATEPART(WEEKDAY, @jan4) + @@DATEFIRST - 2) % 7;      -- 0=週一
    DECLARE @week1Mon DATE = DATEADD(DAY, -@dowMon, @jan4);                          -- 第 1 週的週一
    DECLARE @maxWeek  INT  = DATEPART(ISO_WEEK, DATEFROMPARTS(@Year, 12, 28));       -- 該年 ISO 週數(52 或 53)

    DECLARE @w INT = 1;
    WHILE @w <= @maxWeek
    BEGIN
        DECLARE @thu DATE = DATEADD(DAY, (@w - 1) * 7 + 3, @week1Mon);               -- 該週週四
        INSERT dbo.ScheduleWeeks(ScheduleYear, WeekNo, MonthName, MonthLabel)
        VALUES(@Year, @w, FORMAT(@thu, 'yyyyMM'), FORMAT(@thu, 'yyyy/MM'));
        SET @w += 1;
    END
END
GO

PRINT '結構與物件建立完成。';
GO
