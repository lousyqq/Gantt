/* =====================================================================
   MSD 專案追蹤總表 — 遷移 20：子區間打卡（回報單位改為「該週進行中的子區間」）
   可安全重複執行（idempotent）。在 Gantt 資料庫下執行（需先跑完 18、19）。
   sqlcmd 執行範例：
     sqlcmd -S Sariel -d Gantt -I -b -f 65001 -i 20_sub_interval_checkin.sql
   背景（2026-09-12 使用者決定，推翻遷移 18 的「子區間只排程不打卡」）：
     專案很大時一條計畫區間底下切了好幾個階段，只對計畫區間打卡會變成「一週只有一件事」，
     主管也看不出哪個階段動了、哪個卡住。規則：
       ①該週有落在範圍內的子區間 → 對那些子區間各自打卡；沒有 → 對計畫區間打卡（同「階段」的定義）。
       ②父層那週若已有紀錄（切子區間之前回報過的舊週）→ 視為已回報，不回頭催子區間。
       ③分數：計畫區間該週分數＝子區間分數平均（未回報＝0），滿分仍＝計畫區間數（切得細不會膨脹）。
       ④有回報紀錄的子區間只有主管能刪；刪除軟刪、可復原（usp_RestoreTaskSubInterval）。
   內容：
     1) WeeklyLogs.SubId INT NULL（FK→TaskSubIntervals）；NULL＝對計畫區間的回報（既有資料全部維持 NULL，不動）
     2) 唯一鍵 UQ_WeeklyLogs(TaskId,Year,Week) → 唯一索引 UQ_WeeklyLogs_Unit(TaskId,SubId,Year,Week)
        （SQL Server 的唯一索引把 NULL 當一個值：每條區間每週仍只能有一筆「父層」紀錄，子區間各一筆）
     3) usp_UpsertWeeklyLog／usp_UpdateLogScore 加選填 @SubId（放參數最後、預設 NULL → 舊呼叫端不變）
        稽核 EntityId：有 SubId 時為 `t101-1#5@2026W9`（'#' 與子區間稽核同一個分隔符）
     4) usp_DeleteTaskSubInterval：有回報紀錄時僅主管可刪，Detail 帶筆數
     5) usp_RestoreTaskSubInterval：復原軟刪除（檢查父區間仍在且範圍涵蓋、未超過 10 筆）
     6) vw_WeeklyReport 補 SubId／SubName
   ===================================================================== */
SET NOCOUNT ON;
GO
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

/* 1) 欄位（冪等） */
IF COL_LENGTH('dbo.WeeklyLogs','SubId') IS NULL
BEGIN
    ALTER TABLE dbo.WeeklyLogs ADD SubId INT NULL;
    PRINT '已新增 WeeklyLogs.SubId';
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name='FK_WLog_Sub' AND parent_object_id=OBJECT_ID('dbo.WeeklyLogs'))
    ALTER TABLE dbo.WeeklyLogs WITH CHECK ADD CONSTRAINT FK_WLog_Sub FOREIGN KEY (SubId) REFERENCES dbo.TaskSubIntervals(SubId);
GO

/* 2) 唯一鍵改含 SubId（先建新的再拿掉舊的，任何時刻都有唯一性保護） */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='UQ_WeeklyLogs_Unit' AND object_id=OBJECT_ID('dbo.WeeklyLogs'))
    CREATE UNIQUE INDEX UQ_WeeklyLogs_Unit ON dbo.WeeklyLogs(TaskId, SubId, ScheduleYear, WeekNo);
GO
IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE name='UQ_WeeklyLogs' AND parent_object_id=OBJECT_ID('dbo.WeeklyLogs'))
BEGIN
    ALTER TABLE dbo.WeeklyLogs DROP CONSTRAINT UQ_WeeklyLogs;
    PRINT '已以 UQ_WeeklyLogs_Unit 取代 UQ_WeeklyLogs';
END
GO

/* 3a) 打卡 upsert（加 @SubId；其餘與遷移 16 相同） */
CREATE OR ALTER PROCEDURE dbo.usp_UpsertWeeklyLog
    @TaskCode NVARCHAR(30),
    @Year     INT,
    @Week     INT,
    @Status   NVARCHAR(20),
    @Note     NVARCHAR(MAX),
    @Actor    NVARCHAR(50),
    @ActorRole NVARCHAR(20) = NULL,
    @ActorEmpId NVARCHAR(20) = NULL,
    @DocUrl   NVARCHAR(500) = NULL,
    @SubId    INT = NULL                  -- NULL＝對計畫區間回報；有值＝對該子區間回報
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @TaskId INT, @ActorId INT, @OldStatus NVARCHAR(20), @OldNote NVARCHAR(MAX), @OldDoc NVARCHAR(500);
    SELECT @TaskId = TaskId FROM dbo.Tasks WHERE TaskCode = @TaskCode;
    SELECT @ActorId = UserId FROM dbo.Users WHERE UserName = @Actor;
    IF @TaskId IS NULL OR @ActorId IS NULL
    BEGIN RAISERROR('TaskCode 或 Actor 不存在',16,1); RETURN; END
    -- 子區間必須屬於這條計畫區間且未刪除（防止把回報掛到別條區間的子區間上）
    IF @SubId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.TaskSubIntervals WHERE SubId=@SubId AND TaskId=@TaskId AND IsDeleted=0)
    BEGIN RAISERROR('子區間不存在或不屬於此計畫區間',16,1); RETURN; END

    SET @DocUrl = NULLIF(LTRIM(RTRIM(@DocUrl)), N'');

    SELECT @OldStatus = Status, @OldNote = Note, @OldDoc = DocUrl
    FROM dbo.WeeklyLogs
    WHERE TaskId=@TaskId AND ScheduleYear=@Year AND WeekNo=@Week AND ISNULL(SubId,-1)=ISNULL(@SubId,-1);

    MERGE dbo.WeeklyLogs AS tgt
    USING (SELECT @TaskId AS TaskId, @SubId AS SubId, @Year AS Y, @Week AS W) AS src
       ON tgt.TaskId=src.TaskId AND tgt.ScheduleYear=src.Y AND tgt.WeekNo=src.W AND ISNULL(tgt.SubId,-1)=ISNULL(src.SubId,-1)
    WHEN MATCHED THEN
        UPDATE SET Status=@Status, Note=@Note, DocUrl=@DocUrl, ReportedByUserId=@ActorId, UpdatedAt=SYSDATETIME()
    WHEN NOT MATCHED THEN
        INSERT (TaskId,SubId,ScheduleYear,WeekNo,Status,Note,DocUrl,ReportedByUserId)
        VALUES (@TaskId,@SubId,@Year,@Week,@Status,@Note,@DocUrl,@ActorId);

    INSERT dbo.AuditLog(ActorName,ActorRole,ActorEmpId,Action,EntityType,EntityId,FieldName,OldValue,NewValue,Detail)
    VALUES(@Actor,@ActorRole,@ActorEmpId,'CLOCKIN','WeeklyLog',
           CONCAT(@TaskCode, CASE WHEN @SubId IS NULL THEN N'' ELSE CONCAT(N'#',@SubId) END, '@',@Year,'W',@Week),'status',
           @OldStatus, @Status,
           CONCAT(N'doc舊=',ISNULL(@OldDoc,N''),N' | doc新=',ISNULL(@DocUrl,N''),
                  N' | note舊=',ISNULL(@OldNote,N''),N' | note新=',ISNULL(@Note,N'')));
END
GO

/* 3b) 主管評分（加 @SubId） */
CREATE OR ALTER PROCEDURE dbo.usp_UpdateLogScore
    @TaskCode NVARCHAR(30), @Year INT, @Week INT, @Score DECIMAL(2,1),
    @Actor NVARCHAR(50), @ActorRole NVARCHAR(20)=NULL, @ActorEmpId NVARCHAR(20)=NULL,
    @SubId INT = NULL
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
    SELECT @Old = Score FROM dbo.WeeklyLogs
    WHERE TaskId=@TaskId AND ScheduleYear=@Year AND WeekNo=@Week AND ISNULL(SubId,-1)=ISNULL(@SubId,-1);
    IF @Old IS NULL BEGIN RAISERROR('該週尚未回報，無法評分',16,1); RETURN; END

    UPDATE dbo.WeeklyLogs SET Score=@Score, UpdatedAt=SYSDATETIME()
    WHERE TaskId=@TaskId AND ScheduleYear=@Year AND WeekNo=@Week AND ISNULL(SubId,-1)=ISNULL(@SubId,-1);

    INSERT dbo.AuditLog(ActorName,ActorRole,ActorEmpId,Action,EntityType,EntityId,OldValue,NewValue)
    VALUES(@Actor,@ActorRole,@ActorEmpId,'SCORE','WeeklyLog',
           CONCAT(@TaskCode, CASE WHEN @SubId IS NULL THEN N'' ELSE CONCAT(N'#',@SubId) END, '@',@Year,'W',@Week),
           CONVERT(NVARCHAR(10),@Old), CONVERT(NVARCHAR(10),@Score));
END
GO

/* 4) 刪除子區間：有回報紀錄時僅主管可刪（成員不可刪掉自己／主管已評分的回報載體） */
CREATE OR ALTER PROCEDURE dbo.usp_DeleteTaskSubInterval
    @SubId      INT,
    @Actor      NVARCHAR(50),
    @ActorRole  NVARCHAR(20) = NULL,
    @ActorEmpId NVARCHAR(20) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @TaskCode NVARCHAR(30), @OwnerName NVARCHAR(50), @Old NVARCHAR(MAX), @Logs INT;
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

    SELECT @Logs = COUNT(*) FROM dbo.WeeklyLogs WHERE SubId=@SubId;
    IF @Logs > 0 AND ISNULL(@ActorRole,'') <> 'manager'
    BEGIN RAISERROR('此子區間已有回報紀錄，僅主管可刪除',16,1); RETURN; END

    UPDATE dbo.TaskSubIntervals SET IsDeleted=1, UpdatedAt=SYSDATETIME() WHERE SubId=@SubId;

    INSERT dbo.AuditLog(ActorName,ActorRole,ActorEmpId,Action,EntityType,EntityId,OldValue,Detail)
    VALUES(@Actor,@ActorRole,@ActorEmpId,'DELETE','SubInterval',CONCAT(@TaskCode,'#',@SubId),@Old,
           CASE WHEN @Logs > 0 THEN CONCAT(N'軟刪除（含 ',@Logs,N' 筆回報，資料保留）') ELSE N'軟刪除' END);
END
GO

/* 5) 復原子區間（刪除 toast 的「↩ 復原」） */
CREATE OR ALTER PROCEDURE dbo.usp_RestoreTaskSubInterval
    @SubId      INT,
    @Actor      NVARCHAR(50),
    @ActorRole  NVARCHAR(20) = NULL,
    @ActorEmpId NVARCHAR(20) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @TaskId INT, @TaskCode NVARCHAR(30), @OwnerName NVARCHAR(50), @Val NVARCHAR(MAX),
            @S INT, @E INT, @PStart INT, @PEnd INT, @Cnt INT;
    SELECT @TaskId=t.TaskId, @TaskCode=t.TaskCode, @OwnerName=u.UserName, @S=s.StartWeek, @E=s.EndWeek,
           @PStart=t.StartWeek, @PEnd=t.EndWeek,
           @Val=CONCAT(N'name=',s.Name,N' | W',s.StartWeek,N'-W',s.EndWeek)
    FROM dbo.TaskSubIntervals s
    JOIN dbo.Tasks t    ON t.TaskId=s.TaskId AND t.IsDeleted=0
    JOIN dbo.Projects p ON p.ProjectId=t.ProjectId AND p.IsDeleted=0
    JOIN dbo.Users u    ON u.UserId=p.OwnerUserId
    WHERE s.SubId=@SubId AND s.IsDeleted=1;
    IF @TaskCode IS NULL BEGIN RAISERROR('找不到可復原的子區間（可能未被刪除，或其計畫區間已刪除）',16,1); RETURN; END
    IF ISNULL(@ActorRole,'') <> 'manager' AND @Actor <> @OwnerName
    BEGIN RAISERROR('僅專案負責人或主管可復原子區間',16,1); RETURN; END
    IF @S < @PStart OR @E > @PEnd
    BEGIN
        DECLARE @Msg NVARCHAR(200) = CONCAT(N'子區間 W',@S,N'–W',@E,N' 已超出計畫區間目前的排程 W',@PStart,N'–W',@PEnd,N'，無法復原');
        RAISERROR(@Msg,16,1); RETURN;
    END
    SELECT @Cnt = COUNT(*) FROM dbo.TaskSubIntervals WHERE TaskId=@TaskId AND IsDeleted=0;
    IF @Cnt >= 10 BEGIN RAISERROR('每條計畫區間最多 10 個子區間，無法復原',16,1); RETURN; END

    UPDATE dbo.TaskSubIntervals SET IsDeleted=0, UpdatedAt=SYSDATETIME() WHERE SubId=@SubId;

    INSERT dbo.AuditLog(ActorName,ActorRole,ActorEmpId,Action,EntityType,EntityId,NewValue,Detail)
    VALUES(@Actor,@ActorRole,@ActorEmpId,'RESTORE','SubInterval',CONCAT(@TaskCode,'#',@SubId),@Val,N'復原軟刪除');
END
GO

/* 6) 週報 View 補 SubId／SubName（其餘與遷移 16 相同） */
CREATE OR ALTER VIEW dbo.vw_WeeklyReport AS
SELECT  w.ScheduleYear, w.WeekNo, sw.MonthLabel,
        owner.UserName AS OwnerName,
        p.ProjectId, p.Name AS ProjectName, p.Category, p.TypeCode,
        t.TaskCode, t.TaskName, t.StartWeek, t.EndWeek,
        w.SubId, s.Name AS SubName,
        w.Status, w.Note, w.DocUrl,
        rep.UserName AS ReportedBy, w.ReportedAt
FROM dbo.WeeklyLogs w
JOIN dbo.Tasks t     ON t.TaskId = w.TaskId
JOIN dbo.Projects p  ON p.ProjectId = t.ProjectId
JOIN dbo.Users owner ON owner.UserId = p.OwnerUserId
JOIN dbo.Users rep   ON rep.UserId = w.ReportedByUserId
LEFT JOIN dbo.TaskSubIntervals s ON s.SubId = w.SubId
LEFT JOIN dbo.ScheduleWeeks sw ON sw.ScheduleYear = w.ScheduleYear AND sw.WeekNo = w.WeekNo;
GO

PRINT '遷移 20 完成：WeeklyLogs.SubId／UQ_WeeklyLogs_Unit／usp_UpsertWeeklyLog／usp_UpdateLogScore／usp_DeleteTaskSubInterval／usp_RestoreTaskSubInterval／vw_WeeklyReport';
GO
