/* =====================================================================
   MSD 專案追蹤總表 — 02_new.sql (待於遠端主機執行的更新遷移 06~09)
   包含的遷移腳本清單：
     - 06_upgrade_to_current.sql
     - 07_fix_quoted_identifier.sql
     - 08_add_restore_procs.sql
     - 09_add_starred_projects.sql
   產出時間：2026-07-12T05:55:14.235Z
===================================================================== */

/* =====================================================================
   START OF FILE: 06_upgrade_to_current.sql
===================================================================== */
GO
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
GO
/* =====================================================================
   END OF FILE: 06_upgrade_to_current.sql
===================================================================== */

/* =====================================================================
   START OF FILE: 07_fix_quoted_identifier.sql
===================================================================== */
GO
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- 1) 重新建立 usp_UpdateProjectDeliverable 啟用 QUOTED_IDENTIFIER
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

SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- 2) 重新建立 usp_SetAppSetting 啟用 QUOTED_IDENTIFIER
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

PRINT '已成功重建 usp_UpdateProjectDeliverable 與 usp_SetAppSetting 且啟用 QUOTED_IDENTIFIER ON。';
GO
GO
/* =====================================================================
   END OF FILE: 07_fix_quoted_identifier.sql
===================================================================== */

/* =====================================================================
   START OF FILE: 08_add_restore_procs.sql
===================================================================== */
GO
/* =====================================================================
   MSD 專案追蹤總表 — 遷移 08：軟刪除復原（Undo）預存程序
   ---------------------------------------------------------------------
   適用對象：已執行過 01~07 的資料庫。
   內容：
     1) usp_RestoreProject — 復原軟刪除的專案（連同其計畫區間 IsDeleted=0）
     2) usp_RestoreTask    — 復原軟刪除的單一計畫區間
   用途：前端刪除後 toast 的「復原」按鈕（10 秒內反悔），皆寫入 AuditLog(Action='RESTORE')。
   可安全重複執行（idempotent，CREATE OR ALTER）。
   sqlcmd 執行範例：
     sqlcmd -S <server> -d Gantt -I -b -f 65001 -i 08_add_restore_procs.sql
   ===================================================================== */
SET NOCOUNT ON;
GO

CREATE OR ALTER PROCEDURE dbo.usp_RestoreProject
    @ProjectId INT, @Actor NVARCHAR(50), @ActorRole NVARCHAR(20)=NULL, @ActorEmpId NVARCHAR(20)=NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.Projects WHERE ProjectId = @ProjectId)
    BEGIN RAISERROR('專案不存在',16,1); RETURN; END

    UPDATE dbo.Projects SET IsDeleted = 0, UpdatedAt = SYSDATETIME() WHERE ProjectId = @ProjectId;
    UPDATE dbo.Tasks    SET IsDeleted = 0, UpdatedAt = SYSDATETIME() WHERE ProjectId = @ProjectId;

    INSERT dbo.AuditLog(ActorName,ActorRole,ActorEmpId,Action,EntityType,EntityId,Detail)
    VALUES(@Actor,@ActorRole,@ActorEmpId,'RESTORE','Project',CONVERT(NVARCHAR(50),@ProjectId),N'復原軟刪除(含任務)');
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_RestoreTask
    @TaskCode NVARCHAR(30), @Actor NVARCHAR(50), @ActorRole NVARCHAR(20)=NULL, @ActorEmpId NVARCHAR(20)=NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.Tasks WHERE TaskCode = @TaskCode)
    BEGIN RAISERROR('TaskCode 不存在',16,1); RETURN; END

    UPDATE dbo.Tasks SET IsDeleted = 0, UpdatedAt = SYSDATETIME() WHERE TaskCode = @TaskCode;

    INSERT dbo.AuditLog(ActorName,ActorRole,ActorEmpId,Action,EntityType,EntityId,Detail)
    VALUES(@Actor,@ActorRole,@ActorEmpId,'RESTORE','Task',@TaskCode,N'復原軟刪除');
END
GO

PRINT '遷移 08 完成：usp_RestoreProject / usp_RestoreTask 已就緒。';
GO
GO
/* =====================================================================
   END OF FILE: 08_add_restore_procs.sql
===================================================================== */

/* =====================================================================
   START OF FILE: 09_add_starred_projects.sql
===================================================================== */
GO
/* =====================================================================
   MSD 專案追蹤總表 — 遷移 09：新增「重點關注」標記欄位至 Projects 資料表
   ---------------------------------------------------------------------
   適用對象：已執行過 01 ~ 08 SQL 腳本的現有資料庫。
   特性：完全「不刪除、不破壞」現有任何資料，可安全重複執行 (idempotent)。

   執行後所補齊的 DB 架構：
     1) [新增欄位] dbo.Projects.IsStarred BIT NOT NULL DEFAULT(0)
        - 主管可將特定專案標記為「重點關注」，狀態持久化存於 DB，
          所有使用者登入皆可同步看到標記結果。
     2) [新增預存程序] dbo.usp_ToggleProjectStar
        - 供主管切換指定專案的重點關注狀態（0 ↔ 1），並寫入 AuditLog。
   ===================================================================== */
SET NOCOUNT ON;
GO

PRINT '=======================================================';
PRINT '開始執行遷移 09：新增 Projects.IsStarred 欄位與 SP...';
PRINT '=======================================================';
GO

-- ---------------------------------------------------------------------
-- 1) [新增欄位] Projects.IsStarred
-- ---------------------------------------------------------------------
IF COL_LENGTH('dbo.Projects', 'IsStarred') IS NULL
BEGIN
    ALTER TABLE dbo.Projects ADD IsStarred BIT NOT NULL CONSTRAINT DF_Projects_IsStarred DEFAULT(0);
    PRINT '已在 dbo.Projects 新增 IsStarred 欄位（預設值 0）。';
END
ELSE
BEGIN
    PRINT 'dbo.Projects 已存在 IsStarred 欄位，略過建立。';
END
GO

-- ---------------------------------------------------------------------
-- 2) [新增預存程序] usp_ToggleProjectStar
--    邏輯：只有 role = 'manager' 可執行；直接 toggle IsStarred 值並寫 AuditLog
-- ---------------------------------------------------------------------
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE OR ALTER PROCEDURE dbo.usp_ToggleProjectStar
    @ProjectId   INT,
    @Starred     BIT,              -- 前端傳入目標值（1=標記、0=取消）
    @Actor       NVARCHAR(50),
    @ActorRole   NVARCHAR(20) = NULL,
    @ActorEmpId  NVARCHAR(20) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    -- 僅允許主管操作
    IF ISNULL(@ActorRole, '') <> 'manager'
    BEGIN
        RAISERROR('權限不足：只有主管可以設定重點關注標記。', 16, 1);
        RETURN;
    END

    -- 確認專案存在且未刪除
    IF NOT EXISTS (SELECT 1 FROM dbo.Projects WHERE ProjectId = @ProjectId AND IsDeleted = 0)
    BEGIN
        RAISERROR('找不到指定的專案或專案已刪除。', 16, 1);
        RETURN;
    END

    DECLARE @OldVal BIT;
    SELECT @OldVal = IsStarred FROM dbo.Projects WHERE ProjectId = @ProjectId;

    -- 更新 IsStarred
    UPDATE dbo.Projects
    SET IsStarred = @Starred,
        UpdatedAt = SYSDATETIME()
    WHERE ProjectId = @ProjectId;

    -- 寫入 AuditLog（若資料表存在）
    IF OBJECT_ID('dbo.AuditLog', 'U') IS NOT NULL
    BEGIN
        INSERT INTO dbo.AuditLog (EntityType, EntityId, Action, OldValue, NewValue, ActorName, ActorEmpId, ActorRole, CreatedAt)
        VALUES (
            'Projects',
            CAST(@ProjectId AS NVARCHAR(50)),
            'UPDATE_STAR',
            CAST(@OldVal AS NVARCHAR(10)),
            CAST(@Starred AS NVARCHAR(10)),
            @Actor,
            @ActorEmpId,
            @ActorRole,
            SYSDATETIME()
        );
    END
END
GO

PRINT '已建立（或更新）預存程序 dbo.usp_ToggleProjectStar。';
GO

PRINT '=======================================================';
PRINT '遷移 09 執行完畢。';
PRINT '=======================================================';
GO
GO
/* =====================================================================
   END OF FILE: 09_add_starred_projects.sql
===================================================================== */
