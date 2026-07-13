/* =====================================================================
   MSD 專案追蹤總表 — 遷移 10：主管週報回覆（Manager Weekly Comment）
   ---------------------------------------------------------------------
   適用對象：已執行過 old.sql + new.sql（或 01~09）的資料庫。
   內容：
     1) 新表 dbo.WeeklyComments — 主管針對「成員×年×週」的週報回覆(每人每週一筆,選填)
     2) SP  usp_UpsertWeeklyComment — 僅主管可寫入(SP 內檢查);空字串=清空回覆;
        稽核 Action='COMMENT', EntityType='WeeklyComment'
   顯示於「團隊總結」看板,全體成員皆可見。
   可安全重複執行（idempotent）。
   sqlcmd 執行範例：
     sqlcmd -S <server> -d Gantt -I -b -f 65001 -i 10_add_manager_weekly_comment.sql
   ===================================================================== */
SET NOCOUNT ON;
GO

IF OBJECT_ID('dbo.WeeklyComments','U') IS NULL
BEGIN
    CREATE TABLE dbo.WeeklyComments (
        WeeklyCommentId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_WeeklyComments PRIMARY KEY,
        UserId          INT           NOT NULL,          -- 被回覆的成員
        ScheduleYear    INT           NOT NULL,
        WeekNo          INT           NOT NULL,
        Comment         NVARCHAR(MAX) NOT NULL,          -- 空字串=已清空(保留列以留稽核脈絡)
        UpdatedByUserId INT           NOT NULL,          -- 回覆的主管
        UpdatedAt       DATETIME2(0)  NOT NULL CONSTRAINT DF_WCmt_Upd DEFAULT(SYSDATETIME()),
        CONSTRAINT UQ_WeeklyComments UNIQUE (UserId, ScheduleYear, WeekNo),
        CONSTRAINT FK_WCmt_User    FOREIGN KEY (UserId)          REFERENCES dbo.Users(UserId),
        CONSTRAINT FK_WCmt_UpdUser FOREIGN KEY (UpdatedByUserId) REFERENCES dbo.Users(UserId),
        CONSTRAINT CK_WCmt_Week    CHECK (WeekNo BETWEEN 1 AND 53)
    );
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_UpsertWeeklyComment
    @UserName NVARCHAR(50),
    @Year     INT,
    @Week     INT,
    @Comment  NVARCHAR(MAX),
    @Actor    NVARCHAR(50),
    @ActorRole NVARCHAR(20) = NULL,
    @ActorEmpId NVARCHAR(20) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF ISNULL(@ActorRole,'') <> 'manager'
    BEGIN RAISERROR('僅主管可回覆成員週報',16,1); RETURN; END

    DECLARE @Uid INT, @ActorId INT, @OldComment NVARCHAR(MAX);
    SELECT @Uid = UserId FROM dbo.Users WHERE UserName = @UserName;
    SELECT @ActorId = UserId FROM dbo.Users WHERE UserName = @Actor;
    IF @Uid IS NULL OR @ActorId IS NULL BEGIN RAISERROR('User 不存在',16,1); RETURN; END

    SELECT @OldComment = Comment FROM dbo.WeeklyComments WHERE UserId=@Uid AND ScheduleYear=@Year AND WeekNo=@Week;

    MERGE dbo.WeeklyComments AS tgt
    USING (SELECT @Uid AS U, @Year AS Y, @Week AS W) AS src
       ON tgt.UserId=src.U AND tgt.ScheduleYear=src.Y AND tgt.WeekNo=src.W
    WHEN MATCHED THEN UPDATE SET Comment=@Comment, UpdatedByUserId=@ActorId, UpdatedAt=SYSDATETIME()
    WHEN NOT MATCHED THEN INSERT(UserId, ScheduleYear, WeekNo, Comment, UpdatedByUserId)
                          VALUES(@Uid, @Year, @Week, @Comment, @ActorId);

    INSERT dbo.AuditLog(ActorName,ActorRole,ActorEmpId,Action,EntityType,EntityId,OldValue,NewValue)
    VALUES(@Actor,@ActorRole,@ActorEmpId,'COMMENT','WeeklyComment',CONCAT(@UserName,'@',@Year,'W',@Week),@OldComment,@Comment);
END
GO

PRINT '遷移 10 完成：WeeklyComments 與 usp_UpsertWeeklyComment 已就緒。';
GO
