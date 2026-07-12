/* =====================================================================
   MSD 專案追蹤總表 — 遷移 06：自 01~05 升級至最新現行 DB 架構
   ---------------------------------------------------------------------
   適用對象：在公司內部已執行過 01 ~ 05 SQL 腳本、且成員已在填報運轉的現有資料庫。
   特性：完全「不刪除、不破壞」現有任何專案與打卡資料，可安全重複執行 (idempotent)。

   執行後所補齊的現有 DB 架構整理：
     1) [新增欄位] dbo.Projects.MpSaving NVARCHAR(100) NULL
        - 用於記錄專案成果「MP 人力節省效益」（例如「0.5 人/月」、「200 hr/年」）。
     2) [更新預存程序] dbo.usp_UpdateProjectDeliverable
        - 增加 @MpSaving 參數，支援負責人或主管編輯具體產出與 MP 人力節省效益。
     3) [新增資料表] dbo.AppSettings
        - 系統設定表，用於保存主管授權開關狀態。
     4) [初始預設設定] AppSettings 寫入 AllowRetroCheckin = 'false'
     5) [新增預存程序] dbo.usp_SetAppSetting
        - 供主管在前端頁面一鍵開關「開放成員補登歷史進度」權限。
     6) [放寬週次檢查約束] 支援 ISO 8601 年度 53 週 (1..53)
   ===================================================================== */
SET NOCOUNT ON;
GO

PRINT '=======================================================';
PRINT '開始執行遷移 06：補齊現行 DB 架構...';
PRINT '=======================================================';
GO

-- ---------------------------------------------------------------------
-- 1) [新增欄位] Projects.MpSaving
-- ---------------------------------------------------------------------
IF COL_LENGTH('dbo.Projects','MpSaving') IS NULL
BEGIN
    ALTER TABLE dbo.Projects ADD MpSaving NVARCHAR(100) NULL;
    PRINT '已在 dbo.Projects 新增 MpSaving 欄位。';
END
ELSE
BEGIN
    PRINT 'dbo.Projects 已存在 MpSaving 欄位，略過建立。';
END
GO

-- ---------------------------------------------------------------------
-- 2) [更新預存程序] usp_UpdateProjectDeliverable (增加 @MpSaving)
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE OR ALTER PROCEDURE dbo.usp_UpdateProjectDeliverable
    @ProjectId INT, @Deliverable NVARCHAR(1000), @MpSaving NVARCHAR(100) = NULL,
    @Actor NVARCHAR(50), @ActorRole NVARCHAR(20)=NULL, @ActorEmpId NVARCHAR(20)=NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @OwnerName NVARCHAR(50), @OldD NVARCHAR(1000), @OldMp NVARCHAR(100);
    SELECT @OwnerName=u.UserName, @OldD=p.Deliverable, @OldMp=p.MpSaving
    FROM dbo.Projects p JOIN dbo.Users u ON u.UserId=p.OwnerUserId
    WHERE p.ProjectId=@ProjectId AND p.IsDeleted=0;
    IF @OwnerName IS NULL BEGIN RAISERROR('專案不存在',16,1); RETURN; END
    IF ISNULL(@ActorRole,'') <> 'manager' AND @Actor <> @OwnerName
    BEGIN RAISERROR('僅專案負責人或主管可編輯具體產出項目',16,1); RETURN; END

    UPDATE dbo.Projects SET Deliverable=@Deliverable, MpSaving=@MpSaving, UpdatedAt=SYSDATETIME()
    WHERE ProjectId=@ProjectId;

    INSERT dbo.AuditLog(ActorName,ActorRole,ActorEmpId,Action,EntityType,EntityId,FieldName,OldValue,NewValue)
    VALUES(@Actor,@ActorRole,@ActorEmpId,'UPDATE','Project',CONVERT(NVARCHAR(50),@ProjectId),'Deliverable',
           CONCAT(ISNULL(@OldD,N''), N'｜MP:', ISNULL(@OldMp,N'')),
           CONCAT(ISNULL(@Deliverable,N''), N'｜MP:', ISNULL(@MpSaving,N'')));
END
GO
PRINT '已建立/更新 dbo.usp_UpdateProjectDeliverable。';
GO

-- ---------------------------------------------------------------------
-- 3) & 4) [新增資料表與預設值] AppSettings (全年度歷史補登授權開關)
-- ---------------------------------------------------------------------
IF OBJECT_ID('dbo.AppSettings','U') IS NULL
BEGIN
    CREATE TABLE dbo.AppSettings (
        KeyName   NVARCHAR(50)  NOT NULL CONSTRAINT PK_AppSettings PRIMARY KEY,
        Value     NVARCHAR(MAX) NOT NULL,
        UpdatedBy NVARCHAR(50)  NULL,
        UpdatedAt DATETIME2(0)  NOT NULL CONSTRAINT DF_AppSet_Upd DEFAULT(SYSDATETIME())
    );
    PRINT '已建立 dbo.AppSettings 資料表。';
END
ELSE
BEGIN
    PRINT 'dbo.AppSettings 已存在，略過建立。';
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.AppSettings WHERE KeyName = 'AllowRetroCheckin')
BEGIN
    INSERT INTO dbo.AppSettings (KeyName, Value, UpdatedBy)
    VALUES ('AllowRetroCheckin', 'false', 'system');
    PRINT '已初始化 AllowRetroCheckin 預設設定。';
END
GO

-- ---------------------------------------------------------------------
-- 5) [新增預存程序] usp_SetAppSetting
-- ---------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.usp_SetAppSetting
    @KeyName   NVARCHAR(50),
    @Value     NVARCHAR(MAX),
    @Actor     NVARCHAR(50),
    @ActorRole NVARCHAR(20) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF ISNULL(@ActorRole,'') <> 'manager'
    BEGIN
        RAISERROR('僅主管可變更系統設定',16,1);
        RETURN;
    END

    DECLARE @OldValue NVARCHAR(MAX);
    SELECT @OldValue = Value FROM dbo.AppSettings WHERE KeyName = @KeyName;

    MERGE dbo.AppSettings AS tgt
    USING (SELECT @KeyName AS K) AS src ON tgt.KeyName = src.K
    WHEN MATCHED THEN
        UPDATE SET Value = @Value, UpdatedBy = @Actor, UpdatedAt = SYSDATETIME()
    WHEN NOT MATCHED THEN
        INSERT (KeyName, Value, UpdatedBy) VALUES (@KeyName, @Value, @Actor);

    INSERT dbo.AuditLog(ActorName, ActorRole, Action, EntityType, EntityId, FieldName, OldValue, NewValue, Detail)
    VALUES(@Actor, @ActorRole, 'SETTING', 'AppSettings', @KeyName, 'Value', @OldValue, @Value, N'主管設定全年度歷史補登豁免開關');
END
GO
PRINT '已建立/更新 dbo.usp_SetAppSetting。';
GO

-- ---------------------------------------------------------------------
-- 6) [相容 ISO 8601 53 週年] 將各表週次 Check Constraints 由 52 放寬為 53
-- ---------------------------------------------------------------------
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Tasks_Weeks')
BEGIN
    ALTER TABLE dbo.Tasks DROP CONSTRAINT CK_Tasks_Weeks;
END
ALTER TABLE dbo.Tasks WITH CHECK ADD CONSTRAINT CK_Tasks_Weeks CHECK (StartWeek BETWEEN 1 AND 53 AND EndWeek BETWEEN 1 AND 53 AND StartWeek <= EndWeek);

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ScheduleWeeks_WeekNo')
BEGIN
    ALTER TABLE dbo.ScheduleWeeks DROP CONSTRAINT CK_ScheduleWeeks_WeekNo;
END
ALTER TABLE dbo.ScheduleWeeks WITH CHECK ADD CONSTRAINT CK_ScheduleWeeks_WeekNo CHECK (WeekNo BETWEEN 1 AND 53);

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_WeeklyLogs_WeekNo')
BEGIN
    ALTER TABLE dbo.WeeklyLogs DROP CONSTRAINT CK_WeeklyLogs_WeekNo;
END
ALTER TABLE dbo.WeeklyLogs WITH CHECK ADD CONSTRAINT CK_WeeklyLogs_WeekNo CHECK (WeekNo BETWEEN 1 AND 53);

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ExtraNotes_WeekNo')
BEGIN
    ALTER TABLE dbo.ExtraNotes DROP CONSTRAINT CK_ExtraNotes_WeekNo;
END
ALTER TABLE dbo.ExtraNotes WITH CHECK ADD CONSTRAINT CK_ExtraNotes_WeekNo CHECK (WeekNo BETWEEN 1 AND 53);

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_WeeklyPlans_WeekNo')
BEGIN
    ALTER TABLE dbo.WeeklyPlans DROP CONSTRAINT CK_WeeklyPlans_WeekNo;
END
ALTER TABLE dbo.WeeklyPlans WITH CHECK ADD CONSTRAINT CK_WeeklyPlans_WeekNo CHECK (WeekNo BETWEEN 1 AND 53);
GO

PRINT '=======================================================';
PRINT '遷移 06 執行成功！現有 DB 已完整對接現行最新架構。';
PRINT '=======================================================';
GO
