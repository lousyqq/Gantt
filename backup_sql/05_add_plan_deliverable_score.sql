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
