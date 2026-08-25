/* =====================================================================
   MSD 專案追蹤總表 — 遷移 16：打卡回報加「文件連結」（DocUrl）
   可安全重複執行（idempotent）。在 Gantt 資料庫下執行。
   sqlcmd 執行範例：
     sqlcmd -S Sariel -d Gantt -I -b -f 65001 -i 16_add_weeklylog_docurl.sql
   內容：
     1) WeeklyLogs.DocUrl NVARCHAR(500) NULL — 該週回報對應的文件連結（選填）
        長度取 500：SharePoint／Teams 的網址常帶一長串查詢字串，200 會被截斷；
        UNC 路徑（\\server\share\...）也可能很長。
     2) CREATE OR ALTER usp_UpsertWeeklyLog（加選填 @DocUrl，並納入 AuditLog 新舊值）
        ⚠ @DocUrl 放在參數清單最後、預設 NULL → 舊呼叫端（未傳）行為完全不變。
        ⚠ 稽核 Detail 的 doc 段落**必須排在 note 段落之前**：後端 Summarize() 是用
          LastIndexOf('note新=') 之後「整段到結尾」當工作說明，doc 放後面會被一起吃進去，
          異動紀錄的「工作說明」就會多出一串網址（遷移 15 踩過類似的格式相容問題）。
     3) CREATE OR ALTER vw_WeeklyReport（補 DocUrl 欄；此 View 應用程式未使用，
        僅供人工／報表查詢，補上才不會少一個欄位）
   ===================================================================== */
SET NOCOUNT ON;
GO

/* 1) 欄位（冪等） */
IF COL_LENGTH('dbo.WeeklyLogs','DocUrl') IS NULL
    ALTER TABLE dbo.WeeklyLogs ADD DocUrl NVARCHAR(500) NULL;
GO

/* SP／View 一律以 QUOTED_IDENTIFIER ON 建立（沿用 2026-07-11 error 1934 教訓） */
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

/* 2) 打卡 upsert（加 @DocUrl） */
CREATE OR ALTER PROCEDURE dbo.usp_UpsertWeeklyLog
    @TaskCode NVARCHAR(30),
    @Year     INT,
    @Week     INT,
    @Status   NVARCHAR(20),
    @Note     NVARCHAR(MAX),
    @Actor    NVARCHAR(50),
    @ActorRole NVARCHAR(20) = NULL,
    @ActorEmpId NVARCHAR(20) = NULL,
    @DocUrl   NVARCHAR(500) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @TaskId INT, @ActorId INT, @OldStatus NVARCHAR(20), @OldNote NVARCHAR(MAX), @OldDoc NVARCHAR(500);
    SELECT @TaskId = TaskId FROM dbo.Tasks WHERE TaskCode = @TaskCode;
    SELECT @ActorId = UserId FROM dbo.Users WHERE UserName = @Actor;
    IF @TaskId IS NULL OR @ActorId IS NULL
    BEGIN RAISERROR('TaskCode 或 Actor 不存在',16,1); RETURN; END

    -- 空字串一律存 NULL（前端清空欄位時送空字串過來），前端才能一律用「有沒有值」判斷要不要顯示圖示
    SET @DocUrl = NULLIF(LTRIM(RTRIM(@DocUrl)), N'');

    SELECT @OldStatus = Status, @OldNote = Note, @OldDoc = DocUrl
    FROM dbo.WeeklyLogs WHERE TaskId=@TaskId AND ScheduleYear=@Year AND WeekNo=@Week;

    MERGE dbo.WeeklyLogs AS tgt
    USING (SELECT @TaskId AS TaskId, @Year AS Y, @Week AS W) AS src
       ON tgt.TaskId=src.TaskId AND tgt.ScheduleYear=src.Y AND tgt.WeekNo=src.W
    WHEN MATCHED THEN
        UPDATE SET Status=@Status, Note=@Note, DocUrl=@DocUrl, ReportedByUserId=@ActorId, UpdatedAt=SYSDATETIME()
    WHEN NOT MATCHED THEN
        INSERT (TaskId,ScheduleYear,WeekNo,Status,Note,DocUrl,ReportedByUserId)
        VALUES (@TaskId,@Year,@Week,@Status,@Note,@DocUrl,@ActorId);

    INSERT dbo.AuditLog(ActorName,ActorRole,ActorEmpId,Action,EntityType,EntityId,FieldName,OldValue,NewValue,Detail)
    VALUES(@Actor,@ActorRole,@ActorEmpId,'CLOCKIN','WeeklyLog',
           CONCAT(@TaskCode,'@',@Year,'W',@Week),'status',
           @OldStatus, @Status,
           -- doc 段落在前、note 段落在後（原因見檔頭；note新= 之後到結尾仍等於「工作說明」，
           -- 遷移 16 之前的舊紀錄沒有 doc 段落，後端解析對兩種格式都相容）
           CONCAT(N'doc舊=',ISNULL(@OldDoc,N''),N' | doc新=',ISNULL(@DocUrl,N''),
                  N' | note舊=',ISNULL(@OldNote,N''),N' | note新=',ISNULL(@Note,N'')));
END
GO

/* 3) 週報 View 補 DocUrl（其餘定義與 old.sql 完全相同） */
CREATE OR ALTER VIEW dbo.vw_WeeklyReport AS
SELECT  w.ScheduleYear, w.WeekNo, sw.MonthLabel,
        owner.UserName AS OwnerName,
        p.ProjectId, p.Name AS ProjectName, p.Category, p.TypeCode,
        t.TaskCode, t.TaskName, t.StartWeek, t.EndWeek,
        w.Status, w.Note, w.DocUrl,
        rep.UserName AS ReportedBy, w.ReportedAt
FROM dbo.WeeklyLogs w
JOIN dbo.Tasks t     ON t.TaskId = w.TaskId
JOIN dbo.Projects p  ON p.ProjectId = t.ProjectId
JOIN dbo.Users owner ON owner.UserId = p.OwnerUserId
JOIN dbo.Users rep   ON rep.UserId = w.ReportedByUserId
LEFT JOIN dbo.ScheduleWeeks sw ON sw.ScheduleYear = w.ScheduleYear AND sw.WeekNo = w.WeekNo;
GO

PRINT '遷移 16 完成：WeeklyLogs.DocUrl／usp_UpsertWeeklyLog／vw_WeeklyReport';
GO
