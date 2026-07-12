/* =====================================================================
   MSD 專案追蹤總表 — 01_old.sql (已執行於遠端主機的舊基礎架構 01~05)
   包含的遷移腳本清單：
     - 01_schema_and_objects.sql
     - 02_seed_data.sql
     - 03_upgrade_to_current.sql
     - 04_add_type_e_supervisor.sql
     - 05_add_plan_deliverable_score.sql
   產出時間：2026-07-12T05:55:14.222Z
===================================================================== */

/* =====================================================================
   START OF FILE: 01_schema_and_objects.sql
===================================================================== */
GO
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
GO
/* =====================================================================
   END OF FILE: 01_schema_and_objects.sql
===================================================================== */

/* =====================================================================
   START OF FILE: 02_seed_data.sql
===================================================================== */
GO
/* =====================================================================
   MSD 專案追蹤總表 — 初始資料 (由目前網頁資料轉出)
   執行前請先跑 01_schema_and_objects.sql
   ===================================================================== */
SET NOCOUNT ON;
GO

DELETE FROM dbo.AuditLog; DELETE FROM dbo.ExtraNotes; DELETE FROM dbo.WeeklyLogs;
DELETE FROM dbo.Tasks; DELETE FROM dbo.Projects; DELETE FROM dbo.ScheduleWeeks;
DELETE FROM dbo.ProjectTypes; DELETE FROM dbo.Users;
DBCC CHECKIDENT('dbo.Projects', RESEED, 0); DBCC CHECKIDENT('dbo.Tasks', RESEED, 0);
DBCC CHECKIDENT('dbo.Users', RESEED, 0);
GO

/* --- Users --- */
SET IDENTITY_INSERT dbo.Users ON;
INSERT dbo.Users(UserId,UserName,Role,SortOrder) VALUES(1,N'裕隆','member',1);
INSERT dbo.Users(UserId,UserName,Role,SortOrder) VALUES(2,N'玉婷','member',2);
INSERT dbo.Users(UserId,UserName,Role,SortOrder) VALUES(3,N'詠裕','member',3);
INSERT dbo.Users(UserId,UserName,Role,SortOrder) VALUES(4,N'宸詳','member',4);
INSERT dbo.Users(UserId,UserName,Role,SortOrder) VALUES(5,N'政翰','member',5);
INSERT dbo.Users(UserId,UserName,Role,SortOrder) VALUES(6,N'冠芝','member',6);
INSERT dbo.Users(UserId,UserName,Role,SortOrder) VALUES(99,N'管理部主管','manager',99);
SET IDENTITY_INSERT dbo.Users OFF;
GO

/* --- ProjectTypes --- */
INSERT dbo.ProjectTypes(TypeCode,Label,SortOrder) VALUES('a',N'一級專案/KPI',1);
INSERT dbo.ProjectTypes(TypeCode,Label,SortOrder) VALUES('b',N'重大貢獻及亮點',2);
INSERT dbo.ProjectTypes(TypeCode,Label,SortOrder) VALUES('c',N'日常管理',3);
INSERT dbo.ProjectTypes(TypeCode,Label,SortOrder) VALUES('d',N'其他加分項',4);
GO

/* --- ScheduleWeeks (2026, W1..W52) --- */
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,1,'202601',N'2026/01');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,2,'202601',N'2026/01');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,3,'202601',N'2026/01');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,4,'202601',N'2026/01');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,5,'202601',N'2026/01');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,6,'202602',N'2026/02');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,7,'202602',N'2026/02');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,8,'202602',N'2026/02');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,9,'202602',N'2026/02');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,10,'202603',N'2026/03');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,11,'202603',N'2026/03');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,12,'202603',N'2026/03');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,13,'202603',N'2026/03');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,14,'202604',N'2026/04');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,15,'202604',N'2026/04');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,16,'202604',N'2026/04');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,17,'202604',N'2026/04');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,18,'202605',N'2026/05');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,19,'202605',N'2026/05');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,20,'202605',N'2026/05');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,21,'202605',N'2026/05');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,22,'202605',N'2026/05');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,23,'202606',N'2026/06');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,24,'202606',N'2026/06');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,25,'202606',N'2026/06');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,26,'202606',N'2026/06');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,27,'202607',N'2026/07');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,28,'202607',N'2026/07');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,29,'202607',N'2026/07');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,30,'202607',N'2026/07');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,31,'202608',N'2026/08');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,32,'202608',N'2026/08');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,33,'202608',N'2026/08');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,34,'202608',N'2026/08');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,35,'202608',N'2026/08');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,36,'202609',N'2026/09');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,37,'202609',N'2026/09');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,38,'202609',N'2026/09');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,39,'202609',N'2026/09');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,40,'202610',N'2026/10');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,41,'202610',N'2026/10');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,42,'202610',N'2026/10');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,43,'202610',N'2026/10');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,44,'202611',N'2026/11');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,45,'202611',N'2026/11');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,46,'202611',N'2026/11');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,47,'202611',N'2026/11');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,48,'202611',N'2026/11');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,49,'202612',N'2026/12');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,50,'202612',N'2026/12');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,51,'202612',N'2026/12');
INSERT dbo.ScheduleWeeks(ScheduleYear,WeekNo,MonthName,MonthLabel) VALUES(2026,52,'202612',N'2026/12');
GO

/* --- Projects (保留原始 ProjectId) --- */
SET IDENTITY_INSERT dbo.Projects ON;
 
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(101,'b',N'FDC',1,N'b.[FDC Enhancement for RH/RL]',2026,1,0,'2026-07-03 09:01:13','2026-07-03 10:50:48');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(102,'b',N'FDC',1,N'b.[2024QIT AAR版面&邏輯修改] BKM定義查詢與maintain',2026,2,0,'2026-07-03 09:01:13','2026-07-08 13:42:26');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(103,'b',N'FDC',1,N'b.[2025QIT 跨廠FDC參數監控]',2026,3,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(104,'b',N'防護',1,N'b.[E3 8.9 測試&上線驗證: ESI Ap & Loader 確認]',2026,4,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(105,'b',N'FDC',1,N'b.[MR+CL 1.35 Grp-Spec+CMS]',2026,5,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(106,'b',N'FDC',1,N'b.[MA Chart ET打定值(User Setting)]',2026,6,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(107,'b',N'維運',1,N'b.[DB03 JOB 移轉]',2026,7,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(108,'b',N'防護',1,N'b.[BSL shift 過濾條件]',2026,8,0,'2026-07-03 09:01:13','2026-07-08 13:44:29');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(109,'b',N'專案',1,N'b.[2026 QIT 圈長]',2026,9,0,'2026-07-03 09:01:13','2026-07-08 11:29:29');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(110,'b',N'FDC',1,N'b.[12M support]',2026,10,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(111,'b',N'FDC',1,N'b.[NODC機器人]',2026,11,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(112,'c',N'維運',1,N'c.[系統防護與維運]',2026,12,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(113,'b',N'專案',1,N'b.[POCDB]',2026,13,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(201,'b',N'FDC',2,N'b.[MaxRange]: Retarget<10次',2026,1,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(202,'b',N'FDC',2,N'b.[Retarget: Target超過HH.HL]',2026,2,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(203,'b',N'FDC',2,N'b.[Tool Matching for ca]',2026,3,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(204,'b',N'FDC',2,N'b.[BSL Shift Platform]',2026,4,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(205,'b',N'FDC',2,N'b.[Group SPEC]',2026,5,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(206,'b',N'FDC',2,N'b.[RH/RL Platform]',2026,6,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(207,'b',N'FDC',2,N'b.[MNOP]',2026,7,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(208,'b',N'FDC',2,N'b.[Warning Line Clear]',2026,8,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(209,'a',N'跨廠',2,N'a.[12M support]',2026,9,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(210,'c',N'維運',2,N'c.[TempSpec系統維運]',2026,10,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(211,'b',N'數轉',2,N'b.[IND 4.0 & 數位轉型-代辦中心網頁]',2026,11,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(212,'b',N'跨廠',2,N'b.[12M EQDashboard]',2026,12,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(213,'b',N'數轉',2,N'b.[GptDB 大盤]',2026,13,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(214,'b',N'維運',2,N'b.[系統日管]',2026,14,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(215,'b',N'FDC',2,N'b.[大氣壓力Auto Mail]',2026,15,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(216,'b',N'FDC',2,N'b.[EQDashboard ZE看板]',2026,16,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(301,'b',N'設備',3,N'b.[2026 APM]',2026,1,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(302,'b',N'設備',3,N'b.[2027 ESI Server 採購]',2026,2,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(303,'b',N'跨廠',3,N'b.[12M support]',2026,3,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(304,'b',N'跨廠',3,N'b.[12W support]',2026,4,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(305,'b',N'FDC',3,N'b.[eFDC 應用擴展]',2026,5,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(306,'b',N'FDC',3,N'b.[Extra Sensor 看板]',2026,6,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(307,'b',N'FDC',3,N'b.[Raw Trace]',2026,7,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(308,'b',N'設備',3,N'b.[Tool Log]',2026,8,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(309,'b',N'設備',3,N'b.[2026 QIT - Chart Data]',2026,9,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(310,'b',N'設備',3,N'b.[GPTDB-公用系統環境建置、使用者權限設定]',2026,10,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(311,'b',N'FDC',3,N'b.[Warning Line]',2026,11,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(312,'b',N'設備',3,N'b.[系統防護與維運]',2026,12,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(401,'b',N'FDC',4,N'b.[FDC Early Detection - Chart Audit 3.0]',2026,1,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(402,'b',N'QIT',4,N'b.[2026 QIT - Chart List]',2026,2,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(403,'b',N'FDC',4,N'b.[IND 4.0 & 數位轉型 - DB 建置]',2026,3,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(404,'b',N'設備',4,N'b.[2026 APM]',2026,4,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(405,'c',N'防護',4,N'c.[系統防護 - 指標 vs. AMSD]',2026,5,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(406,'c',N'防護',4,N'c.[系統防護 - Server EOS 系統移轉&調校]',2026,6,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(407,'b',N'設備',4,N'b.[IND 4.0 & 數位轉型 - 破片 All in one Web API]',2026,7,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(408,'b',N'跨廠',4,N'b.[12M support]',2026,8,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(409,'a',N'FDC',4,N'a.[Cross FAB - 需求控管表]',2026,9,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(410,'b',N'FDC',4,N'b.[系統日管]',2026,10,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(501,'a',N'設備',5,N'a.[2026 APM]',2026,1,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(502,'a',N'FDC',5,N'a.[2026 QIT - 副圈長]',2026,2,0,'2026-07-03 09:01:13','2026-07-08 11:29:17');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(503,'b',N'FDC',5,N'b.[CMS Warning Line]',2026,3,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(504,'c',N'維運',5,N'c.[CMS 系統維運]',2026,4,0,'2026-07-03 09:01:13','2026-07-08 13:15:34');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(505,'c',N'維運',5,N'c.[CMS Server Redundant]',2026,5,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(506,'b',N'FDC',5,N'b.[WL: 移除天條限制](new)',2026,6,0,'2026-07-03 09:01:13','2026-07-08 13:23:44');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(507,'b',N'FDC',5,N'b.[WL: Auto Tighen Enhancement]',2026,7,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(508,'b',N'FDC',5,N'b.[WL: Auto Tighen Job]',2026,8,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(509,'b',N'數轉',5,N'b.[GenAI - PoCDB & API 應用]',2026,9,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(510,'b',N'數轉',5,N'b.[FDC & NODC 機器人]',2026,10,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(511,'b',N'維運',5,N'b.[Server Job 轉移作業]',2026,11,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(512,'b',N'跨廠',5,N'b.[12M support]',2026,12,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(601,'c',N'維運',6,N'c.[DB03 JOB 移轉]',2026,1,0,'2026-07-03 09:01:13','2026-07-08 13:38:52');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(602,'a',N'跨廠',6,N'a. Project West-FDC support',2026,2,0,'2026-07-03 09:01:13','2026-07-08 13:38:52');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(603,'c',N'防護',6,N'c.FD over 120 sec',2026,4,0,'2026-07-03 09:01:13','2026-07-08 13:38:52');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(604,'c',N'設備',6,N'c.[DF Tuning System]',2026,5,0,'2026-07-03 09:01:13','2026-07-08 13:38:52');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(605,'a',N'FDC',6,N'a.[2026 QIT - 輔導]',2026,6,0,'2026-07-03 09:01:13','2026-07-08 13:38:52');
INSERT dbo.Projects(ProjectId,TypeCode,Category,OwnerUserId,Name,ScheduleYear,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(606,'a',N'跨廠',6,N'a. Project West-FDC support',2026,3,0,'2026-07-08 13:38:28','2026-07-08 13:38:52');
 
SET IDENTITY_INSERT dbo.Projects OFF;
GO

/* --- Tasks --- */
-- 先清空舊資料（如需要）
-- DELETE FROM dbo.Tasks;
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't101-1',101,N'SPEC 提供',10,18,1,0,'2026-07-03 09:01:13','2026-07-08 10:55:42');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't102-1',102,N'SPEC 確認 & 開發',10,31,1,0,'2026-07-03 09:01:13','2026-07-08 13:43:20');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't103-1',103,N'SPEC 確認 & 開發',9,22,1,0,'2026-07-03 09:01:13','2026-07-08 10:56:57');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't104-1',104,N'驗證 & 確認',1,9,1,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't104-2',104,N'SPEC 確認 & 開發',14,17,2,1,'2026-07-03 09:01:13','2026-07-08 10:57:57');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't105-1',105,N'SPEC 確認 & 開發',9,18,1,0,'2026-07-03 09:01:13','2026-07-08 10:58:16');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't106-1',106,N'測試開發確認',1,9,1,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't107-1',107,N'確認 & 驗證',1,9,1,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't108-1',108,N'SPEC 確認 & 開發',9,31,1,0,'2026-07-03 09:01:13','2026-07-08 10:58:41');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't109-1',109,N'專案執行',6,52,1,0,'2026-07-03 09:01:13','2026-07-08 10:59:12');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't110-1',110,N'系統支援',1,52,1,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't111-1',111,N'SPEC 確認 & 開發',9,35,1,0,'2026-07-03 09:01:13','2026-07-08 10:59:48');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't112-1',112,N'系統防護與維運',1,52,1,0,'2026-07-03 09:01:13','2026-07-08 11:00:26');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't113-1',113,N'POCDB',21,35,1,0,'2026-07-03 09:01:13','2026-07-08 11:00:42');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't201-1',201,N'算法提供',6,13,1,0,'2026-07-03 09:01:13','2026-07-08 11:01:04');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't201-2',201,N'測試 & 上線',14,22,2,0,'2026-07-03 09:01:13','2026-07-08 11:01:22');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't202-1',202,N'SPEC提供',1,5,1,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't202-2',202,N'算法調整',19,22,2,0,'2026-07-03 09:01:13','2026-07-08 11:01:45');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't203-1',203,N'Phase2開發',1,5,1,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't203-2',203,N'Phase3開發',6,9,2,0,'2026-07-03 09:01:13','2026-07-08 11:02:26');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't203-3',203,N'Phase4開發',10,18,3,0,'2026-07-03 09:01:13','2026-07-08 11:02:36');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't203-4',203,N'通知Mail',19,22,4,0,'2026-07-03 09:01:13','2026-07-08 11:02:48');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't204-1',204,N'各區間Hold',1,9,1,0,'2026-07-03 09:01:13','2026-07-08 11:03:18');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't204-2',204,N'回覆看板自動化開發',10,22,2,0,'2026-07-03 09:01:13','2026-07-08 11:03:51');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't204-3',204,N'測試&上線',27,31,3,0,'2026-07-03 09:01:13','2026-07-08 11:04:12');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't205-1',205,N'轉自動化上線',36,52,1,0,'2026-07-03 09:01:13','2026-07-08 11:04:28');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't206-1',206,N'加入OH/OL平台',36,52,1,0,'2026-07-03 09:01:13','2026-07-08 11:04:34');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't207-1',207,N'DB來源移轉',1,5,1,0,'2026-07-03 09:01:13','2026-07-08 11:04:44');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't207-2',207,N'Phase1修改',10,13,2,0,'2026-07-03 09:01:13','2026-07-08 11:06:57');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't207-3',207,N'Phase2修改',23,26,3,0,'2026-07-03 09:01:13','2026-07-08 11:07:07');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't208-1',208,N'優化',21,22,1,0,'2026-07-03 09:01:13','2026-07-08 11:07:32');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't209-1',209,N'程式碼提供',1,31,1,0,'2026-07-03 09:01:13','2026-07-08 11:07:46');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't211-1',211,N'網頁建置',18,22,1,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't213-1',213,N'大盤Excel資料提供',14,22,1,0,'2026-07-03 09:01:13','2026-07-08 11:09:24');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't212-1',212,N'自主版面設計&調整',10,22,1,0,'2026-07-03 09:01:13','2026-07-08 11:09:00');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't210-1',210,N'系統維運',1,52,1,0,'2026-07-03 09:01:13','2026-07-08 11:08:17');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't214-1',214,N'日管指標確認',1,52,1,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't215-1',215,N'新增Mail',25,29,1,0,'2026-07-03 09:01:13','2026-07-08 11:10:52');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't216-1',216,N'BWH版面調整',27,31,1,0,'2026-07-03 09:01:13','2026-07-08 11:11:54');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't216-2',216,N'WL新增史高/低',32,35,2,0,'2026-07-03 09:01:13','2026-07-08 11:11:48');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't301-1',301,N'ESI Server APM',1,5,1,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't302-1',302,N'採購規劃',19,40,1,0,'2026-07-03 09:01:13','2026-07-08 11:12:35');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't303-1',303,N'程式碼提供',1,22,1,0,'2026-07-03 09:01:13','2026-07-08 11:13:01');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't304-1',304,N'eUSPC SQL',20,21,1,0,'2026-07-03 09:01:13','2026-07-08 11:13:43');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't305-1',305,N'開發環境建置 & 取資料API開發',1,13,1,0,'2026-07-03 09:01:13','2026-07-08 11:19:38');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't305-2',305,N'自動獲取使用者資訊',14,23,2,0,'2026-07-03 09:01:13','2026-07-08 11:18:01');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't305-3',305,N'畫圖API開發',24,30,3,0,'2026-07-03 09:01:13','2026-07-08 11:19:22');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't305-4',305,N'轉 Local DB',31,40,4,0,'2026-07-03 09:01:13','2026-07-08 11:18:44');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't305-5',305,N'權限控管與分流',41,52,5,0,'2026-07-03 09:01:13','2026-07-08 11:19:04');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't306-1',306,N'Phase1開發',6,15,1,0,'2026-07-03 09:01:13','2026-07-08 11:20:10');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't306-2',306,N'Phase1開發',31,38,2,0,'2026-07-03 09:01:13','2026-07-08 11:21:03');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't306-3',306,N'Phase2開發',39,52,3,0,'2026-07-03 09:01:13','2026-07-08 11:21:15');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't307-1',307,N'系統建置',44,52,1,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't308-1',308,N'LRTP 分析工具開發',36,52,1,0,'2026-07-03 09:01:13','2026-07-08 11:21:36');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't309-1',309,N'FDC Chart 資料預置 & PDCA、預先產生FDC繪圖',1,26,1,0,'2026-07-03 09:01:13','2026-07-08 13:54:23');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't309-2',309,N'預先產生FDC繪圖',18,26,2,1,'2026-07-03 09:01:13','2026-07-08 13:54:12');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't310-1',310,N'零基礎環境設定',6,22,1,0,'2026-07-03 09:01:13','2026-07-08 11:23:07');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't311-1',311,N'Min Scale 設定下架',16,22,1,0,'2026-07-03 09:01:13','2026-07-08 11:23:37');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't312-1',312,N'Server 資源盤點、移轉、高風險server下線',1,52,1,0,'2026-07-03 09:01:13','2026-07-08 11:23:51');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't401-1',401,N'Type1 &Type2 自動上線 & Mail',1,9,1,0,'2026-07-03 09:01:13','2026-07-08 11:24:39');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't401-2',401,N'Type 3~6 待侑憲SPEC',10,26,2,0,'2026-07-03 09:01:13','2026-07-08 11:25:07');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't402-1',402,N'Chart List 開發 & 驗證',1,9,1,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't402-2',402,N'待 PDCA',10,13,2,0,'2026-07-03 09:01:13','2026-07-08 13:56:23');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't402-3',402,N'新需求(HH/HL)',14,18,3,0,'2026-07-03 09:01:13','2026-07-08 11:25:39');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't403-1',403,N'需求調查 & POC & DB 建置',14,22,1,0,'2026-07-03 09:01:13','2026-07-08 11:25:58');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't404-1',404,N'ESI Server APM',1,5,1,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't405-1',405,N'與IT討論系統防護項目',14,22,1,0,'2026-07-03 09:01:13','2026-07-08 11:26:38');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't406-1',406,N'EOS Server 系統移轉',1,18,1,0,'2026-07-03 09:01:13','2026-07-08 11:26:52');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't407-1',407,N'WebAPI 開發',14,18,1,0,'2026-07-03 09:01:13','2026-07-08 11:27:16');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't408-1',408,N'程式碼提供、系統建置',1,31,1,0,'2026-07-03 09:01:13','2026-07-08 13:58:13');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't408-2',408,N'系統建置',18,31,2,1,'2026-07-03 09:01:13','2026-07-08 13:58:01');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't409-1',409,N'MSD 需求追蹤 & 確認',1,52,1,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't410-1',410,N'日管指標確認',1,52,1,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't501-1',501,N'ESI Server APM',1,5,1,0,'2026-07-03 09:01:13','2026-07-08 11:29:01');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't502-1',502,N'S1~S2 檢視真因數據與PPT',1,13,1,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't502-2',502,N'S3~S5 真因邏輯檢視與PPT Format 訂版',14,26,2,0,'2026-07-03 09:01:13','2026-07-08 13:20:09');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't502-3',502,N'S5',27,40,3,0,'2026-07-03 09:01:13','2026-07-08 13:20:25');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't502-4',502,N'S6~S8',41,52,4,0,'2026-07-03 09:01:13','2026-07-08 13:20:35');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't503-1',503,N'(2) 開發新Warning Limit-->RH/RL偵測模組',1,13,1,0,'2026-07-03 09:01:13','2026-07-08 13:22:18');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't503-2',503,N'2Y資料做WL SPEC',17,22,2,0,'2026-07-03 09:01:13','2026-07-08 13:22:39');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't504-1',504,N'系統維護',1,5,1,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't504-2',504,N'RTO Case 查詢',6,13,2,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't504-3',504,N'機台異常OCAP運作流程 & ENS Phone Call Tracing',14,40,3,0,'2026-07-03 09:01:13','2026-07-08 13:23:18');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't504-4',504,N'系統維護',41,52,4,0,'2026-07-03 09:01:13','2026-07-08 13:23:27');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't505-1',505,N'備援Server建立',1,22,1,0,'2026-07-03 09:01:13','2026-07-08 14:00:30');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't506-1',506,N'移除天條限制',20,22,1,0,'2026-07-03 09:01:13','2026-07-08 13:24:06');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't507-1',507,N'流程修正',1,5,1,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't507-2',507,N'Alarm信件功能  & 移除Target 偏邊不上線條件',7,24,2,0,'2026-07-03 09:01:13','2026-07-08 13:26:32');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't508-1',508,N'ET12 -> ET34 -> LT -> DF -> TF -> LT',1,22,1,0,'2026-07-03 09:01:13','2026-07-08 13:26:54');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't508-2',508,N'ET12 -> LT -> DF -> ET34 -> TF -> LT',23,48,2,0,'2026-07-03 09:01:13','2026-07-08 13:27:16');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't509-1',509,N'GenAI DB&API 代辦中心',1,13,1,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't509-2',509,N'插頭 & 插座資料彙整',14,22,2,0,'2026-07-03 09:01:13','2026-07-08 13:30:59');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't509-3',509,N'回收使用成果與效益',23,32,3,0,'2026-07-03 09:01:13','2026-07-08 13:31:24');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't510-1',510,N'Spec 確認、技能Study、功能開發、測試',7,22,1,0,'2026-07-03 09:01:13','2026-07-08 13:34:47');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't510-2',510,N'功能開發、測試',23,36,2,0,'2026-07-03 09:01:13','2026-07-08 13:35:27');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't510-3',510,N'功能調整&上線',37,44,3,0,'2026-07-03 09:01:13','2026-07-08 13:35:40');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't511-1',511,N'系統轉移完畢',1,5,1,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't512-1',512,N'程式碼提供',1,22,1,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't601-1',601,N'系統移轉完畢',1,5,1,0,'2026-07-03 09:01:13','2026-07-08 13:36:29');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't602-1',602,N'Data view from Manual transmission',1,13,1,0,'2026-07-03 09:01:13','2026-07-03 09:01:13');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't602-2',602,N'Automatic transmission',10,52,2,0,'2026-07-03 09:01:13','2026-07-08 13:39:41');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't602-3',602,N'Index 管理機制',36,52,3,1,'2026-07-03 09:01:13','2026-07-08 13:39:47');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't603-1',603,N'上線',1,9,1,0,'2026-07-03 09:01:13','2026-07-08 13:40:42');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't603-2',603,N'效果確認',10,22,2,0,'2026-07-03 09:01:13','2026-07-08 13:40:51');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't604-1',604,N'回補2025各tool type小需求',1,13,1,0,'2026-07-03 09:01:13','2026-07-08 13:41:11');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't604-2',604,N'系統維護',14,52,2,0,'2026-07-03 09:01:13','2026-07-08 13:41:20');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't605-1',605,N'輔導',1,52,1,0,'2026-07-03 09:01:13','2026-07-08 13:41:29');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't507-3',507,N'(尚未填寫)',49,52,0,1,'2026-07-08 13:28:30','2026-07-08 13:28:39');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't508-3',508,N'(待安排)',49,52,0,0,'2026-07-08 13:29:14','2026-07-08 13:29:14');
INSERT dbo.Tasks(TaskCode,ProjectId,TaskName,StartWeek,EndWeek,SortOrder,IsDeleted,CreatedAt,UpdatedAt) VALUES(N't606-1',606,N'Index 管理機制',35,52,0,0,'2026-07-08 13:40:15','2026-07-08 13:40:15');
GO

PRINT '初始資料匯入完成:';
SELECT (SELECT COUNT(*) FROM dbo.Projects) AS Projects, (SELECT COUNT(*) FROM dbo.Tasks) AS Tasks, (SELECT COUNT(*) FROM dbo.Users) AS Users;
GO
GO
/* =====================================================================
   END OF FILE: 02_seed_data.sql
===================================================================== */

/* =====================================================================
   START OF FILE: 03_upgrade_to_current.sql
===================================================================== */
GO
/* =====================================================================
   MSD 專案追蹤總表 — 遷移 03（合併版）：舊版 01+02 基準 → 目前完整架構
   ---------------------------------------------------------------------
   適用對象：先前只執行過「舊版」01_schema_and_objects.sql + 02_seed_data.sql
   的既有資料庫。執行本檔一次即可升級到與目前 01 相同的結構，內容涵蓋
   原 03(Projects.SortOrder)、04(usp_EnsureScheduleYear)、
   05(成員管理 SP)、06(AuditLog.ActorEmpId) 全部變更。

   可安全重複執行（idempotent）：
     - 欄位以 COL_LENGTH 檢查後才 ADD
     - SortOrder 回填僅在「全部為 0（剛加欄位）」時執行，不會洗掉已拖曳的自訂排序
     - 預存程序一律 CREATE OR ALTER（SQL Server 2016 SP1+）

   注意：全新建置請直接跑目前的 01→02，不需要本檔。
   sqlcmd 執行範例：
     sqlcmd -S Sariel -d Gantt -I -b -f 65001 -i 03_upgrade_to_current.sql
   ===================================================================== */
SET NOCOUNT ON;
GO

/* =====================================================================
   1) Projects.SortOrder — 同一負責人內的顯示順序(主管可拖曳調整)
   ===================================================================== */
IF COL_LENGTH('dbo.Projects','SortOrder') IS NULL
BEGIN
    ALTER TABLE dbo.Projects
        ADD SortOrder INT NOT NULL CONSTRAINT DF_Projects_Sort DEFAULT(0);
END
GO

/* 回填：每位負責人底下依 ProjectId 順序給 1..N。
   僅在全部為 0（剛加欄位）時執行，避免重跑洗掉主管已拖曳的自訂排序。 */
IF NOT EXISTS (SELECT 1 FROM dbo.Projects WHERE SortOrder <> 0)
BEGIN
    ;WITH ranked AS (
        SELECT ProjectId,
               ROW_NUMBER() OVER (PARTITION BY OwnerUserId ORDER BY ProjectId) AS rn
        FROM dbo.Projects
    )
    UPDATE p SET p.SortOrder = r.rn
    FROM dbo.Projects p
    JOIN ranked r ON r.ProjectId = p.ProjectId;
END
GO

/* =====================================================================
   2) AuditLog.ActorEmpId — 操作者 Windows 工號(由 /api/whoami 偵測,如 00058897)
   ===================================================================== */
IF COL_LENGTH('dbo.AuditLog','ActorEmpId') IS NULL
    ALTER TABLE dbo.AuditLog ADD ActorEmpId NVARCHAR(20) NULL;
GO

/* =====================================================================
   3) 預存程序 — 以下皆為目前最新版本(含 @ActorEmpId 寫入稽核)
   ===================================================================== */

-- 3.1 打卡 upsert -----------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.usp_UpsertWeeklyLog
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

-- 3.2 非專案事項 upsert ----------------------------------------------
CREATE OR ALTER PROCEDURE dbo.usp_UpsertExtraNote
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

-- 3.3 主管修改任務排程(名稱/起訖) ------------------------------------
CREATE OR ALTER PROCEDURE dbo.usp_UpdateTaskSchedule
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

-- 3.4 新增專案 --------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.usp_InsertProject
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

-- 3.5 修改專案 --------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.usp_UpdateProject
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

-- 3.6 刪除專案(軟刪除,連同其任務) ------------------------------------
CREATE OR ALTER PROCEDURE dbo.usp_DeleteProject
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

-- 3.7 新增任務 --------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.usp_InsertTask
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

-- 3.8 刪除任務(軟刪除) ------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.usp_DeleteTask
    @TaskCode NVARCHAR(30), @Actor NVARCHAR(50), @ActorRole NVARCHAR(20)=NULL, @ActorEmpId NVARCHAR(20)=NULL
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.Tasks SET IsDeleted=1, UpdatedAt=SYSDATETIME() WHERE TaskCode=@TaskCode;
    INSERT dbo.AuditLog(ActorName,ActorRole,ActorEmpId,Action,EntityType,EntityId,Detail)
    VALUES(@Actor,@ActorRole,@ActorEmpId,'DELETE','Task',@TaskCode,N'軟刪除');
END
GO

-- 3.9 重新排序專案(同一負責人內的顯示順序) --------------------------
CREATE OR ALTER PROCEDURE dbo.usp_ReorderProjects
    @OrderedIdsJson NVARCHAR(MAX),          -- 例:'[105,101,110]'
    @Actor NVARCHAR(50),
    @ActorRole NVARCHAR(20) = NULL,
    @ActorEmpId NVARCHAR(20) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    -- OPENJSON 對陣列的 [key] 即為 0-based 索引,可保留輸入順序
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

-- 3.10 新增成員(同名成員曾被移除則重新啟用,保留其歷史資料) ------------
CREATE OR ALTER PROCEDURE dbo.usp_InsertUser
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

-- 3.11 修改成員名稱(專案/回報以 UserId 關聯,改名後歷史資料自動跟隨) --
CREATE OR ALTER PROCEDURE dbo.usp_UpdateUser
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

-- 3.12 移除成員(軟刪除=IsActive:0;名下仍有專案時擋下) ----------------
CREATE OR ALTER PROCEDURE dbo.usp_DeleteUser
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

-- 3.13 產生指定年度的 ScheduleWeeks 週資料(若尚未存在) ----------------
-- 用法:EXEC dbo.usp_EnsureScheduleYear 2027;  之後前端年度下拉即可選到該年
CREATE OR ALTER PROCEDURE dbo.usp_EnsureScheduleYear
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

PRINT '遷移 03(合併版) 完成：DB 結構與預存程序已升級至目前版本。';
PRINT '提醒：開新年度請 EXEC dbo.usp_EnsureScheduleYear <年度>;';
GO
GO
/* =====================================================================
   END OF FILE: 03_upgrade_to_current.sql
===================================================================== */

/* =====================================================================
   START OF FILE: 04_add_type_e_supervisor.sql
===================================================================== */
GO
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
GO
/* =====================================================================
   END OF FILE: 04_add_type_e_supervisor.sql
===================================================================== */

/* =====================================================================
   START OF FILE: 05_add_plan_deliverable_score.sql
===================================================================== */
GO
/* =====================================================================
   MSD 專案追蹤總表 — 遷移 05：下週預計工作 + 具體產出項目 + 打卡計分
   ---------------------------------------------------------------------
   適用對象：已執行過 01→02→03→04 的資料庫。
   內容：
     1) 新表 dbo.WeeklyPlans      — 成員每週填寫「下週預計執行工作」(每人每年每週一筆)
     2) SP  usp_UpsertWeeklyPlan  — 寫入下週預計(含稽核 WEEKPLAN)
     3) Projects.Deliverable      — 專案「具體產出項目」欄位(負責人與主管可編輯)
     4) SP  usp_UpdateProjectDeliverable — 寫入產出項目(SP 內檢查權限;含稽核)
     5) WeeklyLogs.Score          — 打卡計分(回報成功預設 1 分;未回報=無資料列=0 分)
     6) SP  usp_UpdateLogScore    — 主管調整分數(0.3/0.5/0.8/0.9/1;含稽核 SCORE)
   可安全重複執行（idempotent）。
   sqlcmd 執行範例：
     sqlcmd -S Sariel -d Gantt -I -b -f 65001 -i 05_add_plan_deliverable_score.sql
   ===================================================================== */
SET NOCOUNT ON;
GO

/* 1) WeeklyPlans — 下週預計執行工作(記錄於「本週」,內容描述下一週的工作安排) */
IF OBJECT_ID('dbo.WeeklyPlans','U') IS NULL
BEGIN
    CREATE TABLE dbo.WeeklyPlans (
        WeeklyPlanId   INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_WeeklyPlans PRIMARY KEY,
        UserId         INT           NOT NULL,
        ScheduleYear   INT           NOT NULL,
        WeekNo         INT           NOT NULL,          -- 填寫當週(內容=下週預計)
        Note           NVARCHAR(MAX) NOT NULL,
        UpdatedByUserId INT          NOT NULL,
        UpdatedAt      DATETIME2(0)  NOT NULL CONSTRAINT DF_WPlan_Upd DEFAULT(SYSDATETIME()),
        CONSTRAINT UQ_WeeklyPlans UNIQUE (UserId, ScheduleYear, WeekNo),
        CONSTRAINT FK_WPlan_User    FOREIGN KEY (UserId)          REFERENCES dbo.Users(UserId),
        CONSTRAINT FK_WPlan_UpdUser FOREIGN KEY (UpdatedByUserId) REFERENCES dbo.Users(UserId),
        CONSTRAINT CK_WPlan_Week    CHECK (WeekNo BETWEEN 1 AND 53)
    );
END
GO

/* 2) 下週預計 upsert */
CREATE OR ALTER PROCEDURE dbo.usp_UpsertWeeklyPlan
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

    SELECT @OldNote = Note FROM dbo.WeeklyPlans WHERE UserId=@Uid AND ScheduleYear=@Year AND WeekNo=@Week;

    MERGE dbo.WeeklyPlans AS tgt
    USING (SELECT @Uid AS U,@Year AS Y,@Week AS W) AS src
       ON tgt.UserId=src.U AND tgt.ScheduleYear=src.Y AND tgt.WeekNo=src.W
    WHEN MATCHED THEN UPDATE SET Note=@Note, UpdatedByUserId=@ActorId, UpdatedAt=SYSDATETIME()
    WHEN NOT MATCHED THEN INSERT(UserId,ScheduleYear,WeekNo,Note,UpdatedByUserId)
                          VALUES(@Uid,@Year,@Week,@Note,@ActorId);

    INSERT dbo.AuditLog(ActorName,ActorRole,ActorEmpId,Action,EntityType,EntityId,OldValue,NewValue)
    VALUES(@Actor,@ActorRole,@ActorEmpId,'WEEKPLAN','WeeklyPlan',CONCAT(@UserName,'@',@Year,'W',@Week),@OldNote,@Note);
END
GO

/* 3) Projects.Deliverable — 具體產出項目 */
IF COL_LENGTH('dbo.Projects','Deliverable') IS NULL
    ALTER TABLE dbo.Projects ADD Deliverable NVARCHAR(1000) NULL;
GO

/* 4) 更新具體產出項目(僅負責人本人或主管;權限於 SP 內檢查) */
CREATE OR ALTER PROCEDURE dbo.usp_UpdateProjectDeliverable
    @ProjectId INT, @Deliverable NVARCHAR(1000),
    @Actor NVARCHAR(50), @ActorRole NVARCHAR(20)=NULL, @ActorEmpId NVARCHAR(20)=NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @OwnerName NVARCHAR(50), @Old NVARCHAR(1000), @ProjName NVARCHAR(200);
    SELECT @OwnerName=u.UserName, @Old=p.Deliverable, @ProjName=p.Name
    FROM dbo.Projects p JOIN dbo.Users u ON u.UserId=p.OwnerUserId
    WHERE p.ProjectId=@ProjectId AND p.IsDeleted=0;
    IF @OwnerName IS NULL BEGIN RAISERROR('專案不存在',16,1); RETURN; END
    IF ISNULL(@ActorRole,'') <> 'manager' AND @Actor <> @OwnerName
    BEGIN RAISERROR('僅專案負責人或主管可編輯具體產出項目',16,1); RETURN; END

    UPDATE dbo.Projects SET Deliverable=@Deliverable, UpdatedAt=SYSDATETIME() WHERE ProjectId=@ProjectId;

    INSERT dbo.AuditLog(ActorName,ActorRole,ActorEmpId,Action,EntityType,EntityId,FieldName,OldValue,NewValue)
    VALUES(@Actor,@ActorRole,@ActorEmpId,'UPDATE','Project',CONVERT(NVARCHAR(50),@ProjectId),'Deliverable',@Old,@Deliverable);
END
GO

/* 5) WeeklyLogs.Score — 打卡計分(回報成功預設 1;未回報=無資料列=0) */
IF COL_LENGTH('dbo.WeeklyLogs','Score') IS NULL
    ALTER TABLE dbo.WeeklyLogs ADD Score DECIMAL(2,1) NOT NULL CONSTRAINT DF_WLog_Score DEFAULT(1);
GO

/* 6) 主管調整分數(0.3 再三交代 / 0.5 說一動做一動 / 0.8 完成老闆交代 / 0.9 超越老闆期許 / 1 主動承擔) */
CREATE OR ALTER PROCEDURE dbo.usp_UpdateLogScore
    @TaskCode NVARCHAR(30), @Year INT, @Week INT, @Score DECIMAL(2,1),
    @Actor NVARCHAR(50), @ActorRole NVARCHAR(20)=NULL, @ActorEmpId NVARCHAR(20)=NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF ISNULL(@ActorRole,'') <> 'manager'
    BEGIN RAISERROR('僅主管可調整分數',16,1); RETURN; END
    IF @Score NOT IN (0.3, 0.5, 0.8, 0.9, 1.0)
    BEGIN RAISERROR('分數僅限 0.3 / 0.5 / 0.8 / 0.9 / 1',16,1); RETURN; END

    DECLARE @TaskId INT, @Old DECIMAL(2,1);
    SELECT @TaskId = TaskId FROM dbo.Tasks WHERE TaskCode = @TaskCode;
    IF @TaskId IS NULL BEGIN RAISERROR('TaskCode 不存在',16,1); RETURN; END
    SELECT @Old = Score FROM dbo.WeeklyLogs WHERE TaskId=@TaskId AND ScheduleYear=@Year AND WeekNo=@Week;
    IF @Old IS NULL BEGIN RAISERROR('該週尚未回報，無法評分',16,1); RETURN; END

    UPDATE dbo.WeeklyLogs SET Score=@Score, UpdatedAt=SYSDATETIME()
    WHERE TaskId=@TaskId AND ScheduleYear=@Year AND WeekNo=@Week;

    INSERT dbo.AuditLog(ActorName,ActorRole,ActorEmpId,Action,EntityType,EntityId,OldValue,NewValue)
    VALUES(@Actor,@ActorRole,@ActorEmpId,'SCORE','WeeklyLog',
           CONCAT(@TaskCode,'@',@Year,'W',@Week),
           CONVERT(NVARCHAR(10),@Old), CONVERT(NVARCHAR(10),@Score));
END
GO

PRINT '遷移 05 完成：WeeklyPlans／Projects.Deliverable／WeeklyLogs.Score 已就緒。';
GO
GO
/* =====================================================================
   END OF FILE: 05_add_plan_deliverable_score.sql
===================================================================== */
