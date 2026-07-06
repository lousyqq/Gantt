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
