/* =====================================================================
   MSD 專案追蹤總表 — 遷移 17：非專案事項／下週預計 也加「文件連結」（DocUrl）
   可安全重複執行（idempotent）。在 Gantt 資料庫下執行。
   sqlcmd 執行範例：
     sqlcmd -S Sariel -d Gantt -I -b -f 65001 -i 17_add_note_docurl.sql
   內容：
     1) ExtraNotes.DocUrl  NVARCHAR(500) NULL — 非專案事項的文件連結（選填）
     2) WeeklyPlans.DocUrl NVARCHAR(500) NULL — 下週預計執行工作的文件連結（選填）
        欄位型別與遷移 16 的 WeeklyLogs.DocUrl 完全一致（三處同一種東西，不要各用各的長度）
     3) CREATE OR ALTER usp_UpsertExtraNote / usp_UpsertWeeklyPlan（加選填 @DocUrl）
   ⚠ 稽核寫法與遷移 16 的打卡**刻意不同**：
     這兩支 SP 的 OldValue/NewValue 本來就是「內容全文」、且 Detail 欄一直沒用到，
     所以文件連結放 **Detail**＝`doc舊=… | doc新=…`，OldValue/NewValue 維持只放內容。
     這樣既有的白話翻譯（比對 OldValue/NewValue 判斷「內容未變更」）完全不受影響。
     打卡那支則是因為 Detail 已被 note 佔用，才需要「doc 排在 note 之前」那條規則。
   ===================================================================== */
SET NOCOUNT ON;
GO

/* 1) 欄位（冪等） */
IF COL_LENGTH('dbo.ExtraNotes','DocUrl') IS NULL
    ALTER TABLE dbo.ExtraNotes ADD DocUrl NVARCHAR(500) NULL;
GO
IF COL_LENGTH('dbo.WeeklyPlans','DocUrl') IS NULL
    ALTER TABLE dbo.WeeklyPlans ADD DocUrl NVARCHAR(500) NULL;
GO

/* SP 一律以 QUOTED_IDENTIFIER ON 建立（沿用 2026-07-11 error 1934 教訓） */
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

/* 2) 非專案事項 upsert（加 @DocUrl） */
CREATE OR ALTER PROCEDURE dbo.usp_UpsertExtraNote
    @UserName NVARCHAR(50),
    @Year     INT,
    @Week     INT,
    @Note     NVARCHAR(MAX),
    @Actor    NVARCHAR(50),
    @ActorRole NVARCHAR(20) = NULL,
    @ActorEmpId NVARCHAR(20) = NULL,
    @DocUrl   NVARCHAR(500) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Uid INT, @ActorId INT, @OldNote NVARCHAR(MAX), @OldDoc NVARCHAR(500);
    SELECT @Uid = UserId FROM dbo.Users WHERE UserName=@UserName;
    SELECT @ActorId = UserId FROM dbo.Users WHERE UserName=@Actor;
    IF @Uid IS NULL OR @ActorId IS NULL BEGIN RAISERROR('User 不存在',16,1); RETURN; END

    -- 空字串一律存 NULL（前端清空欄位時送空字串），前端才能一律用「有沒有值」判斷要不要顯示圖示
    SET @DocUrl = NULLIF(LTRIM(RTRIM(@DocUrl)), N'');

    SELECT @OldNote = Note, @OldDoc = DocUrl
    FROM dbo.ExtraNotes WHERE UserId=@Uid AND ScheduleYear=@Year AND WeekNo=@Week;

    MERGE dbo.ExtraNotes AS tgt
    USING (SELECT @Uid AS U,@Year AS Y,@Week AS W) AS src
       ON tgt.UserId=src.U AND tgt.ScheduleYear=src.Y AND tgt.WeekNo=src.W
    WHEN MATCHED THEN UPDATE SET Note=@Note, DocUrl=@DocUrl, UpdatedByUserId=@ActorId, UpdatedAt=SYSDATETIME()
    WHEN NOT MATCHED THEN INSERT(UserId,ScheduleYear,WeekNo,Note,DocUrl,UpdatedByUserId)
                          VALUES(@Uid,@Year,@Week,@Note,@DocUrl,@ActorId);

    INSERT dbo.AuditLog(ActorName,ActorRole,ActorEmpId,Action,EntityType,EntityId,OldValue,NewValue,Detail)
    VALUES(@Actor,@ActorRole,@ActorEmpId,'EXTRANOTE','ExtraNote',CONCAT(@UserName,'@',@Year,'W',@Week),@OldNote,@Note,
           CASE WHEN @OldDoc IS NULL AND @DocUrl IS NULL THEN NULL
                ELSE CONCAT(N'doc舊=',ISNULL(@OldDoc,N''),N' | doc新=',ISNULL(@DocUrl,N'')) END);
END
GO

/* 3) 下週預計 upsert（加 @DocUrl） */
CREATE OR ALTER PROCEDURE dbo.usp_UpsertWeeklyPlan
    @UserName NVARCHAR(50),
    @Year     INT,
    @Week     INT,
    @Note     NVARCHAR(MAX),
    @Actor    NVARCHAR(50),
    @ActorRole NVARCHAR(20) = NULL,
    @ActorEmpId NVARCHAR(20) = NULL,
    @DocUrl   NVARCHAR(500) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Uid INT, @ActorId INT, @OldNote NVARCHAR(MAX), @OldDoc NVARCHAR(500);
    SELECT @Uid = UserId FROM dbo.Users WHERE UserName=@UserName;
    SELECT @ActorId = UserId FROM dbo.Users WHERE UserName=@Actor;
    IF @Uid IS NULL OR @ActorId IS NULL BEGIN RAISERROR('User 不存在',16,1); RETURN; END

    SET @DocUrl = NULLIF(LTRIM(RTRIM(@DocUrl)), N'');

    SELECT @OldNote = Note, @OldDoc = DocUrl
    FROM dbo.WeeklyPlans WHERE UserId=@Uid AND ScheduleYear=@Year AND WeekNo=@Week;

    MERGE dbo.WeeklyPlans AS tgt
    USING (SELECT @Uid AS U,@Year AS Y,@Week AS W) AS src
       ON tgt.UserId=src.U AND tgt.ScheduleYear=src.Y AND tgt.WeekNo=src.W
    WHEN MATCHED THEN UPDATE SET Note=@Note, DocUrl=@DocUrl, UpdatedByUserId=@ActorId, UpdatedAt=SYSDATETIME()
    WHEN NOT MATCHED THEN INSERT(UserId,ScheduleYear,WeekNo,Note,DocUrl,UpdatedByUserId)
                          VALUES(@Uid,@Year,@Week,@Note,@DocUrl,@ActorId);

    INSERT dbo.AuditLog(ActorName,ActorRole,ActorEmpId,Action,EntityType,EntityId,OldValue,NewValue,Detail)
    VALUES(@Actor,@ActorRole,@ActorEmpId,'WEEKPLAN','WeeklyPlan',CONCAT(@UserName,'@',@Year,'W',@Week),@OldNote,@Note,
           CASE WHEN @OldDoc IS NULL AND @DocUrl IS NULL THEN NULL
                ELSE CONCAT(N'doc舊=',ISNULL(@OldDoc,N''),N' | doc新=',ISNULL(@DocUrl,N'')) END);
END
GO

PRINT '遷移 17 完成：ExtraNotes.DocUrl／WeeklyPlans.DocUrl／usp_UpsertExtraNote／usp_UpsertWeeklyPlan';
GO
