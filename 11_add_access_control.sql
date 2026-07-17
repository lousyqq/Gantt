/* =====================================================================
   MSD 專案追蹤總表 — 遷移 11：頁面瀏覽權限卡控（Access Control）
   ---------------------------------------------------------------------
   適用對象：已執行過 old.sql + new.sql + 10 的資料庫。
   內容：
     1) 新表 dbo.AccessRules — 允許瀏覽本站的條件規則(任一符合即放行)：
        RuleType='DEPT_1'/'DEPT_2'/'DEPT_3'＝登入者於 notes_person 的部門欄位等於 Value；
        RuleType='EMPNO'＝登入者工號等於 Value(白名單，不查 notes_person 也放行)。
     2) AppSettings 新增 'AccessControlEnabled'(預設 'false'＝不卡控，避免部署當下鎖死)。
     3) SP usp_AddAccessRule / usp_DeleteAccessRule — 僅主管可操作(SP 內檢查)，
        稽核 Action='ACCESSRULE'。開關切換沿用既有 usp_SetAppSetting(Action='SETTING')。
   ※ 登入者部門資料來源為 [WEB].[dbo].[notes_person]（遠端為跨 server 之 VIEW，
     本遷移不建立、不修改該物件；App 端由 appsettings 可設定其名稱）。
   可安全重複執行（idempotent）。
   sqlcmd 執行範例：
     sqlcmd -S <server> -d Gantt -I -b -f 65001 -i 11_add_access_control.sql
   ===================================================================== */
SET NOCOUNT ON;
GO

IF OBJECT_ID('dbo.AccessRules','U') IS NULL
BEGIN
    CREATE TABLE dbo.AccessRules (
        RuleId    INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AccessRules PRIMARY KEY,
        RuleType  NVARCHAR(20) NOT NULL,          -- DEPT_1 / DEPT_2 / DEPT_3 / EMPNO
        Value     NVARCHAR(50) NOT NULL,          -- 比對值(部門代碼或工號)
        Note      NVARCHAR(200) NULL,             -- 備註(選填,如「MSD 全員」)
        CreatedBy NVARCHAR(50)  NULL,
        CreatedAt DATETIME2(0)  NOT NULL CONSTRAINT DF_AccRule_At DEFAULT(SYSDATETIME()),
        CONSTRAINT UQ_AccessRules UNIQUE (RuleType, Value),
        CONSTRAINT CK_AccRule_Type CHECK (RuleType IN (N'DEPT_1', N'DEPT_2', N'DEPT_3', N'EMPNO'))
    );
    PRINT '已建立 dbo.AccessRules。';
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.AppSettings WHERE KeyName = 'AccessControlEnabled')
BEGIN
    INSERT INTO dbo.AppSettings (KeyName, Value, UpdatedBy)
    VALUES ('AccessControlEnabled', 'false', 'system');
    PRINT '已初始化 AccessControlEnabled = false(預設不卡控)。';
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_AddAccessRule
    @RuleType  NVARCHAR(20),
    @Value     NVARCHAR(50),
    @Note      NVARCHAR(200) = NULL,
    @Actor     NVARCHAR(50),
    @ActorRole NVARCHAR(20) = NULL,
    @ActorEmpId NVARCHAR(20) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF ISNULL(@ActorRole,'') <> 'manager'
    BEGIN RAISERROR(N'僅主管可設定瀏覽權限規則',16,1); RETURN; END
    IF @RuleType NOT IN (N'DEPT_1', N'DEPT_2', N'DEPT_3', N'EMPNO')
    BEGIN RAISERROR(N'規則類型僅限 DEPT_1 / DEPT_2 / DEPT_3 / EMPNO',16,1); RETURN; END
    SET @Value = LTRIM(RTRIM(ISNULL(@Value, N'')));
    IF @Value = N''
    BEGIN RAISERROR(N'比對值不可空白',16,1); RETURN; END
    IF EXISTS (SELECT 1 FROM dbo.AccessRules WHERE RuleType = @RuleType AND Value = @Value)
    BEGIN RAISERROR(N'相同規則已存在',16,1); RETURN; END

    INSERT INTO dbo.AccessRules (RuleType, Value, Note, CreatedBy)
    VALUES (@RuleType, @Value, NULLIF(LTRIM(RTRIM(ISNULL(@Note, N''))), N''), @Actor);

    INSERT dbo.AuditLog(ActorName,ActorRole,ActorEmpId,Action,EntityType,EntityId,NewValue)
    VALUES(@Actor,@ActorRole,@ActorEmpId,'ACCESSRULE','AccessRule',
           CONCAT(@RuleType,'=',@Value), CONCAT(N'新增瀏覽權限規則 ', @RuleType, N'=', @Value,
           CASE WHEN @Note IS NULL OR LTRIM(RTRIM(@Note)) = N'' THEN N'' ELSE CONCAT(N'（', @Note, N'）') END));
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_DeleteAccessRule
    @RuleId    INT,
    @Actor     NVARCHAR(50),
    @ActorRole NVARCHAR(20) = NULL,
    @ActorEmpId NVARCHAR(20) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF ISNULL(@ActorRole,'') <> 'manager'
    BEGIN RAISERROR(N'僅主管可設定瀏覽權限規則',16,1); RETURN; END

    DECLARE @RuleType NVARCHAR(20), @Value NVARCHAR(50);
    SELECT @RuleType = RuleType, @Value = Value FROM dbo.AccessRules WHERE RuleId = @RuleId;
    IF @RuleType IS NULL
    BEGIN RAISERROR(N'規則不存在或已刪除',16,1); RETURN; END

    DELETE FROM dbo.AccessRules WHERE RuleId = @RuleId;

    INSERT dbo.AuditLog(ActorName,ActorRole,ActorEmpId,Action,EntityType,EntityId,OldValue)
    VALUES(@Actor,@ActorRole,@ActorEmpId,'ACCESSRULE','AccessRule',
           CONCAT(@RuleType,'=',@Value), CONCAT(N'刪除瀏覽權限規則 ', @RuleType, N'=', @Value));
END
GO

PRINT '遷移 11 完成：AccessRules / usp_AddAccessRule / usp_DeleteAccessRule / AccessControlEnabled 已就緒。';
GO
