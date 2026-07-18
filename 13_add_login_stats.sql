/* =====================================================================
   MSD 專案追蹤總表 — 遷移 13：使用者登入次數統計（Login Stats）
   ---------------------------------------------------------------------
   適用對象：已執行過 old.sql + new.sql + 10 + 11 + 12 的資料庫。
   內容：
     1) 新表 dbo.LoginLogs — 每次登入寫一筆(含重新整理自動還原登入)：
        UserName(登入身分)、Role、EmpId(Windows 工號,可空)、
        Source('manual'=登入畫面點選/'auto'=重整自動還原)、LoginAt。
     2) SP usp_LogLogin — 寫入登入紀錄(所有人皆可寫,無權限限制)。
     統計查詢由 API 端直接下 SELECT(GET /api/login-stats)，不另建 SP。
   可安全重複執行（idempotent）。
   sqlcmd 執行範例：
     sqlcmd -S <server> -d Gantt -I -b -f 65001 -i 13_add_login_stats.sql
   ===================================================================== */
SET NOCOUNT ON;
GO

IF OBJECT_ID('dbo.LoginLogs','U') IS NULL
BEGIN
    CREATE TABLE dbo.LoginLogs (
        LoginId  BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_LoginLogs PRIMARY KEY,
        UserName NVARCHAR(50) NOT NULL,           -- 登入身分(成員名或主管顯示名)
        Role     NVARCHAR(20) NULL,               -- manager / member
        EmpId    NVARCHAR(20) NULL,               -- Windows 工號(非網域環境為 NULL)
        Source   NVARCHAR(10) NOT NULL CONSTRAINT DF_LoginLogs_Src DEFAULT(N'manual'),  -- manual / auto
        LoginAt  DATETIME2(0) NOT NULL CONSTRAINT DF_LoginLogs_At DEFAULT(SYSDATETIME()),
        CONSTRAINT CK_LoginLogs_Src CHECK (Source IN (N'manual', N'auto'))
    );
    CREATE INDEX IX_LoginLogs_At ON dbo.LoginLogs(LoginAt);
    PRINT '已建立 dbo.LoginLogs。';
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_LogLogin
    @UserName NVARCHAR(50),
    @Role     NVARCHAR(20) = NULL,
    @EmpId    NVARCHAR(20) = NULL,
    @Source   NVARCHAR(10) = N'manual'
AS
BEGIN
    SET NOCOUNT ON;
    IF LTRIM(RTRIM(ISNULL(@UserName, N''))) = N'' RETURN;   -- 無身分不記,靜默略過
    IF @Source NOT IN (N'manual', N'auto') SET @Source = N'manual';
    INSERT INTO dbo.LoginLogs (UserName, Role, EmpId, Source)
    VALUES (LTRIM(RTRIM(@UserName)), @Role, NULLIF(LTRIM(RTRIM(ISNULL(@EmpId, N''))), N''), @Source);
END
GO

PRINT '遷移 13 完成：LoginLogs 與 usp_LogLogin 已就緒。';
GO
