/* =====================================================================
   MSD 專案追蹤總表 — 遷移 18：計畫區間的「子區間」（TaskSubIntervals）
   可安全重複執行（idempotent）。在 Gantt 資料庫下執行。
   sqlcmd 執行範例：
     sqlcmd -S Sariel -d Gantt -I -b -f 65001 -i 18_add_task_subintervals.sql
   內容：
     1) 新表 dbo.TaskSubIntervals — 一條計畫區間（Tasks）底下可再切多個子區間，
        子區間之間**允許重疊**（例：測試 W10–W27 底下有 準備資料 W10–W15、跟 IT 溝通 W12–W19、驗證 W14–W27）。
        子區間只排程、**不打卡**：每週回報仍以計畫區間（Tasks）為單位，WeeklyLogs 完全不動。
     2) usp_UpsertTaskSubInterval — 新增／修改（@SubId NULL=新增）；SP 內檢查權限（主管或專案負責人）、
        起迄週必須落在父區間內、每條計畫區間最多 10 筆。
     3) usp_DeleteTaskSubInterval — 軟刪除（SP 內檢查權限）。
     4) CREATE OR ALTER usp_UpdateTaskSchedule — 父區間改期時，若會讓任一子區間跑出範圍則 RAISERROR 列出名稱
        （不靜默截斷子區間；簽章與稽核格式完全不變，遷移 14 的 @NID 保留）。
   稽核：EntityType='SubInterval'、EntityId=CONCAT(TaskCode,'#',SubId)；Old/NewValue 格式與 Task 相同
        （`name=… | W..-W..`），刪除時 OldValue 也帶名稱（子區間不在 Tasks 對照表裡，API 白話翻譯只能靠它）。
   ===================================================================== */
SET NOCOUNT ON;
GO
/* 一開始就設 QUOTED_IDENTIFIER ON（沿用 2026-07-11 error 1934 教訓）：
   下方的 filtered index（CREATE INDEX … WHERE IsDeleted = 0）與所有 SP 都需要它。
   ⚠ 必須放在 CREATE INDEX 之前——原本擺在索引之後，sqlcmd 沒帶 -I 時索引會 1934 失敗、SP 卻照建，
   得到「功能正常但沒索引」的半套結果。 */
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

/* 1) 資料表（冪等） */
IF OBJECT_ID('dbo.TaskSubIntervals','U') IS NULL
BEGIN
    CREATE TABLE dbo.TaskSubIntervals (
        SubId       INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_TaskSubIntervals PRIMARY KEY,
        TaskId      INT           NOT NULL,
        Name        NVARCHAR(200) NOT NULL,
        StartWeek   INT           NOT NULL,
        EndWeek     INT           NOT NULL,
        SortOrder   INT           NOT NULL CONSTRAINT DF_TaskSub_Sort DEFAULT(0),
        IsDeleted   BIT           NOT NULL CONSTRAINT DF_TaskSub_Del DEFAULT(0),
        CreatedAt   DATETIME2(0)  NOT NULL CONSTRAINT DF_TaskSub_Created DEFAULT(SYSDATETIME()),
        UpdatedAt   DATETIME2(0)  NOT NULL CONSTRAINT DF_TaskSub_Updated DEFAULT(SYSDATETIME()),
        CONSTRAINT FK_TaskSub_Task FOREIGN KEY (TaskId) REFERENCES dbo.Tasks(TaskId),
        CONSTRAINT CK_TaskSub_Weeks CHECK (StartWeek BETWEEN 1 AND 53 AND EndWeek BETWEEN 1 AND 53 AND StartWeek <= EndWeek)
    );
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_TaskSub_Task' AND object_id=OBJECT_ID('dbo.TaskSubIntervals'))
    CREATE INDEX IX_TaskSub_Task ON dbo.TaskSubIntervals(TaskId) WHERE IsDeleted = 0;
GO

/* 2) 新增／修改子區間 */
CREATE OR ALTER PROCEDURE dbo.usp_UpsertTaskSubInterval
    @SubId      INT = NULL,               -- NULL = 新增
    @TaskCode   NVARCHAR(30),
    @Name       NVARCHAR(200),
    @Start      INT,
    @End        INT,
    @Actor      NVARCHAR(50),
    @ActorRole  NVARCHAR(20) = NULL,
    @ActorEmpId NVARCHAR(20) = NULL,
    @NewSubId   INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @TaskId INT, @PStart INT, @PEnd INT, @OwnerName NVARCHAR(50), @Old NVARCHAR(MAX), @Cnt INT;

    SELECT @TaskId=t.TaskId, @PStart=t.StartWeek, @PEnd=t.EndWeek, @OwnerName=u.UserName
    FROM dbo.Tasks t
    JOIN dbo.Projects p ON p.ProjectId=t.ProjectId AND p.IsDeleted=0
    JOIN dbo.Users u    ON u.UserId=p.OwnerUserId
    WHERE t.TaskCode=@TaskCode AND t.IsDeleted=0;
    IF @TaskId IS NULL BEGIN RAISERROR('計畫區間不存在',16,1); RETURN; END

    -- 子區間是「負責人自己的工作拆解」,故負責人與主管皆可編輯(比照具體產出項目)
    IF ISNULL(@ActorRole,'') <> 'manager' AND @Actor <> @OwnerName
    BEGIN RAISERROR('僅專案負責人或主管可編輯子區間',16,1); RETURN; END

    SET @Name = LTRIM(RTRIM(@Name));
    IF @Name IS NULL OR @Name = N'' BEGIN RAISERROR('子區間名稱不可空白',16,1); RETURN; END
    IF @Start > @End BEGIN RAISERROR('子區間的開始週不可晚於結束週',16,1); RETURN; END
    -- 子區間必須落在父區間內:跑出去就不是「子」了,甘特圖上也會畫到父條外面
    IF @Start < @PStart OR @End > @PEnd
    BEGIN
        DECLARE @Msg NVARCHAR(200) = CONCAT(N'子區間需落在計畫區間 W',@PStart,N'–W',@PEnd,N' 內（目前為 W',@Start,N'–W',@End,N'）');
        RAISERROR(@Msg,16,1); RETURN;
    END

    IF @SubId IS NULL
    BEGIN
        SELECT @Cnt = COUNT(*) FROM dbo.TaskSubIntervals WHERE TaskId=@TaskId AND IsDeleted=0;
        IF @Cnt >= 10 BEGIN RAISERROR('每條計畫區間最多 10 個子區間',16,1); RETURN; END

        INSERT dbo.TaskSubIntervals(TaskId,Name,StartWeek,EndWeek,SortOrder)
        VALUES(@TaskId,@Name,@Start,@End,@Cnt+1);
        SET @NewSubId = SCOPE_IDENTITY();

        INSERT dbo.AuditLog(ActorName,ActorRole,ActorEmpId,Action,EntityType,EntityId,NewValue)
        VALUES(@Actor,@ActorRole,@ActorEmpId,'INSERT','SubInterval',CONCAT(@TaskCode,'#',@NewSubId),
               CONCAT(N'name=',@Name,N' | W',@Start,N'-W',@End));
    END
    ELSE
    BEGIN
        SELECT @Old = CONCAT(N'name=',Name,N' | W',StartWeek,N'-W',EndWeek)
        FROM dbo.TaskSubIntervals WHERE SubId=@SubId AND TaskId=@TaskId AND IsDeleted=0;
        IF @Old IS NULL BEGIN RAISERROR('子區間不存在',16,1); RETURN; END

        UPDATE dbo.TaskSubIntervals SET Name=@Name, StartWeek=@Start, EndWeek=@End, UpdatedAt=SYSDATETIME()
        WHERE SubId=@SubId;
        SET @NewSubId = @SubId;

        INSERT dbo.AuditLog(ActorName,ActorRole,ActorEmpId,Action,EntityType,EntityId,OldValue,NewValue)
        VALUES(@Actor,@ActorRole,@ActorEmpId,'UPDATE','SubInterval',CONCAT(@TaskCode,'#',@SubId),@Old,
               CONCAT(N'name=',@Name,N' | W',@Start,N'-W',@End));
    END
END
GO

/* 3) 刪除子區間（軟刪除） */
CREATE OR ALTER PROCEDURE dbo.usp_DeleteTaskSubInterval
    @SubId      INT,
    @Actor      NVARCHAR(50),
    @ActorRole  NVARCHAR(20) = NULL,
    @ActorEmpId NVARCHAR(20) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @TaskCode NVARCHAR(30), @OwnerName NVARCHAR(50), @Old NVARCHAR(MAX);
    SELECT @TaskCode=t.TaskCode, @OwnerName=u.UserName,
           @Old=CONCAT(N'name=',s.Name,N' | W',s.StartWeek,N'-W',s.EndWeek)
    FROM dbo.TaskSubIntervals s
    JOIN dbo.Tasks t    ON t.TaskId=s.TaskId
    JOIN dbo.Projects p ON p.ProjectId=t.ProjectId
    JOIN dbo.Users u    ON u.UserId=p.OwnerUserId
    WHERE s.SubId=@SubId AND s.IsDeleted=0;
    IF @TaskCode IS NULL BEGIN RAISERROR('子區間不存在',16,1); RETURN; END
    IF ISNULL(@ActorRole,'') <> 'manager' AND @Actor <> @OwnerName
    BEGIN RAISERROR('僅專案負責人或主管可刪除子區間',16,1); RETURN; END

    UPDATE dbo.TaskSubIntervals SET IsDeleted=1, UpdatedAt=SYSDATETIME() WHERE SubId=@SubId;

    -- OldValue 帶名稱:子區間不在 API 的 Tasks 對照表裡,刪除後白話翻譯只能靠這裡
    INSERT dbo.AuditLog(ActorName,ActorRole,ActorEmpId,Action,EntityType,EntityId,OldValue,Detail)
    VALUES(@Actor,@ActorRole,@ActorEmpId,'DELETE','SubInterval',CONCAT(@TaskCode,'#',@SubId),@Old,N'軟刪除');
END
GO

/* 4) 修改任務排程：加「子區間不可跑出新範圍」檢查（其餘與遷移 15 完全相同——稽核值尾端的 NID= 保留） */
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
    DECLARE @Old NVARCHAR(MAX), @TaskId INT, @Outside NVARCHAR(MAX);
    SELECT @Old = CONCAT(N'name=',TaskName,N' | W',StartWeek,N'-W',EndWeek,NCHAR(10),N'NID=',ISNULL(NID,N'')), @TaskId = TaskId
    FROM dbo.Tasks WHERE TaskCode=@TaskCode;
    IF @Old IS NULL BEGIN RAISERROR('TaskCode 不存在',16,1); RETURN; END

    -- 不靜默截斷子區間:列出會跑出範圍的子區間,讓使用者自己決定先改子區間還是改父區間
    SELECT @Outside = STRING_AGG(CONCAT(Name,N'（W',StartWeek,N'–W',EndWeek,N'）'), N'、')
    FROM dbo.TaskSubIntervals
    WHERE TaskId=@TaskId AND IsDeleted=0 AND (StartWeek < @Start OR EndWeek > @End);
    IF @Outside IS NOT NULL
    BEGIN
        DECLARE @Msg NVARCHAR(MAX) = CONCAT(N'以下子區間會超出新的排程 W',@Start,N'–W',@End,N'，請先調整子區間：',@Outside);
        RAISERROR(@Msg,16,1); RETURN;
    END

    UPDATE dbo.Tasks SET TaskName=@Name, StartWeek=@Start, EndWeek=@End,
           NID=NULLIF(LTRIM(RTRIM(@NID)),N''), UpdatedAt=SYSDATETIME()
    WHERE TaskCode=@TaskCode;

    INSERT dbo.AuditLog(ActorName,ActorRole,ActorEmpId,Action,EntityType,EntityId,OldValue,NewValue)
    VALUES(@Actor,@ActorRole,@ActorEmpId,'UPDATE','Task',@TaskCode,@Old,
           CONCAT(N'name=',@Name,N' | W',@Start,N'-W',@End,NCHAR(10),N'NID=',ISNULL(NULLIF(LTRIM(RTRIM(@NID)),N''),N'')));
END
GO

PRINT '遷移 18 完成：TaskSubIntervals／usp_UpsertTaskSubInterval／usp_DeleteTaskSubInterval／usp_UpdateTaskSchedule（子區間範圍檢查）';
GO
