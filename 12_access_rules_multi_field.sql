/* =====================================================================
   MSD 專案追蹤總表 — 遷移 12：瀏覽權限規則改為多欄位組合(AND)
   ---------------------------------------------------------------------
   適用對象：已執行過 old.sql + new.sql + 10 + 11 的資料庫。
   內容：
     1) dbo.AccessRules 由「單欄位(RuleType+Value)」改為「多欄位組合」：
        新欄位 Empno / DeptName / Dept1 / Dept2 / Dept3(皆可空,至少填一個)。
        同一條規則內有填的欄位「全部符合」才算通過(AND)；
        多條規則之間維持「任一符合即放行」(OR)。
        既有規則自動搬移(RuleType/Value → 對應新欄位)後移除舊欄位。
     2) 重建 usp_AddAccessRule / usp_DeleteAccessRule 配合新結構(僅主管,稽核 ACCESSRULE)。
   可安全重複執行（idempotent）。
   sqlcmd 執行範例：
     sqlcmd -S <server> -d Gantt -I -b -f 65001 -i 12_access_rules_multi_field.sql
   ===================================================================== */
SET NOCOUNT ON;
GO

-- 1) 新增多欄位條件欄位 ------------------------------------------------
IF COL_LENGTH('dbo.AccessRules','Empno') IS NULL
    ALTER TABLE dbo.AccessRules ADD Empno NVARCHAR(50) NULL;
IF COL_LENGTH('dbo.AccessRules','DeptName') IS NULL
    ALTER TABLE dbo.AccessRules ADD DeptName NVARCHAR(50) NULL;
IF COL_LENGTH('dbo.AccessRules','Dept1') IS NULL
    ALTER TABLE dbo.AccessRules ADD Dept1 NVARCHAR(50) NULL;
IF COL_LENGTH('dbo.AccessRules','Dept2') IS NULL
    ALTER TABLE dbo.AccessRules ADD Dept2 NVARCHAR(50) NULL;
IF COL_LENGTH('dbo.AccessRules','Dept3') IS NULL
    ALTER TABLE dbo.AccessRules ADD Dept3 NVARCHAR(50) NULL;
GO

-- 2) 舊單欄位規則搬移至新欄位(僅於舊欄位仍存在時) ------------------------
IF COL_LENGTH('dbo.AccessRules','RuleType') IS NOT NULL
BEGIN
    EXEC sp_executesql N'
        UPDATE dbo.AccessRules
        SET Empno    = CASE WHEN RuleType = N''EMPNO''  THEN Value ELSE Empno    END,
            Dept1    = CASE WHEN RuleType = N''DEPT_1'' THEN Value ELSE Dept1    END,
            Dept2    = CASE WHEN RuleType = N''DEPT_2'' THEN Value ELSE Dept2    END,
            Dept3    = CASE WHEN RuleType = N''DEPT_3'' THEN Value ELSE Dept3    END
        WHERE COALESCE(Empno, DeptName, Dept1, Dept2, Dept3) IS NULL;';
    PRINT '既有單欄位規則已搬移至新欄位。';
END
GO

-- 3) 移除舊欄位與舊約束 -------------------------------------------------
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_AccessRules' AND object_id = OBJECT_ID('dbo.AccessRules'))
    ALTER TABLE dbo.AccessRules DROP CONSTRAINT UQ_AccessRules;
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_AccRule_Type')
    ALTER TABLE dbo.AccessRules DROP CONSTRAINT CK_AccRule_Type;
IF COL_LENGTH('dbo.AccessRules','RuleType') IS NOT NULL
    ALTER TABLE dbo.AccessRules DROP COLUMN RuleType;
IF COL_LENGTH('dbo.AccessRules','Value') IS NOT NULL
    ALTER TABLE dbo.AccessRules DROP COLUMN Value;
GO

-- 4) 至少一個條件欄位不可全空 -------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_AccRule_AnyField')
    ALTER TABLE dbo.AccessRules WITH CHECK
    ADD CONSTRAINT CK_AccRule_AnyField CHECK (COALESCE(Empno, DeptName, Dept1, Dept2, Dept3) IS NOT NULL);
GO

-- 5) 重建 SP：新增規則(多欄位組合) --------------------------------------
CREATE OR ALTER PROCEDURE dbo.usp_AddAccessRule
    @Empno     NVARCHAR(50) = NULL,
    @DeptName  NVARCHAR(50) = NULL,
    @Dept1     NVARCHAR(50) = NULL,
    @Dept2     NVARCHAR(50) = NULL,
    @Dept3     NVARCHAR(50) = NULL,
    @Note      NVARCHAR(200) = NULL,
    @Actor     NVARCHAR(50),
    @ActorRole NVARCHAR(20) = NULL,
    @ActorEmpId NVARCHAR(20) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF ISNULL(@ActorRole,'') <> 'manager'
    BEGIN RAISERROR(N'僅主管可設定瀏覽權限規則',16,1); RETURN; END

    SET @Empno    = NULLIF(LTRIM(RTRIM(ISNULL(@Empno,    N''))), N'');
    SET @DeptName = NULLIF(LTRIM(RTRIM(ISNULL(@DeptName, N''))), N'');
    SET @Dept1    = NULLIF(LTRIM(RTRIM(ISNULL(@Dept1,    N''))), N'');
    SET @Dept2    = NULLIF(LTRIM(RTRIM(ISNULL(@Dept2,    N''))), N'');
    SET @Dept3    = NULLIF(LTRIM(RTRIM(ISNULL(@Dept3,    N''))), N'');
    IF COALESCE(@Empno, @DeptName, @Dept1, @Dept2, @Dept3) IS NULL
    BEGIN RAISERROR(N'至少需填寫一個條件欄位',16,1); RETURN; END

    IF EXISTS (SELECT 1 FROM dbo.AccessRules
               WHERE ISNULL(Empno,N'')=ISNULL(@Empno,N'') AND ISNULL(DeptName,N'')=ISNULL(@DeptName,N'')
                 AND ISNULL(Dept1,N'')=ISNULL(@Dept1,N'') AND ISNULL(Dept2,N'')=ISNULL(@Dept2,N'')
                 AND ISNULL(Dept3,N'')=ISNULL(@Dept3,N''))
    BEGIN RAISERROR(N'相同條件組合的規則已存在',16,1); RETURN; END

    INSERT INTO dbo.AccessRules (Empno, DeptName, Dept1, Dept2, Dept3, Note, CreatedBy)
    VALUES (@Empno, @DeptName, @Dept1, @Dept2, @Dept3, NULLIF(LTRIM(RTRIM(ISNULL(@Note, N''))), N''), @Actor);

    DECLARE @Desc NVARCHAR(400) = STUFF(
        CASE WHEN @Empno    IS NULL THEN N'' ELSE N' 且 工號='   + @Empno    END +
        CASE WHEN @DeptName IS NULL THEN N'' ELSE N' 且 DEPTNAME=' + @DeptName END +
        CASE WHEN @Dept1    IS NULL THEN N'' ELSE N' 且 DEPT_1=' + @Dept1    END +
        CASE WHEN @Dept2    IS NULL THEN N'' ELSE N' 且 DEPT_2=' + @Dept2    END +
        CASE WHEN @Dept3    IS NULL THEN N'' ELSE N' 且 DEPT_3=' + @Dept3    END, 1, 3, N'');

    INSERT dbo.AuditLog(ActorName,ActorRole,ActorEmpId,Action,EntityType,EntityId,NewValue)
    VALUES(@Actor,@ActorRole,@ActorEmpId,'ACCESSRULE','AccessRule',@Desc,
           CONCAT(N'新增瀏覽權限規則：', @Desc,
           CASE WHEN @Note IS NULL OR LTRIM(RTRIM(@Note)) = N'' THEN N'' ELSE CONCAT(N'（', @Note, N'）') END));
END
GO

-- 6) 重建 SP：刪除規則 --------------------------------------------------
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

    DECLARE @Empno NVARCHAR(50), @DeptName NVARCHAR(50), @Dept1 NVARCHAR(50), @Dept2 NVARCHAR(50), @Dept3 NVARCHAR(50);
    SELECT @Empno=Empno, @DeptName=DeptName, @Dept1=Dept1, @Dept2=Dept2, @Dept3=Dept3
    FROM dbo.AccessRules WHERE RuleId = @RuleId;
    IF COALESCE(@Empno, @DeptName, @Dept1, @Dept2, @Dept3) IS NULL AND NOT EXISTS (SELECT 1 FROM dbo.AccessRules WHERE RuleId = @RuleId)
    BEGIN RAISERROR(N'規則不存在或已刪除',16,1); RETURN; END

    DELETE FROM dbo.AccessRules WHERE RuleId = @RuleId;

    DECLARE @Desc NVARCHAR(400) = STUFF(
        CASE WHEN @Empno    IS NULL THEN N'' ELSE N' 且 工號='   + @Empno    END +
        CASE WHEN @DeptName IS NULL THEN N'' ELSE N' 且 DEPTNAME=' + @DeptName END +
        CASE WHEN @Dept1    IS NULL THEN N'' ELSE N' 且 DEPT_1=' + @Dept1    END +
        CASE WHEN @Dept2    IS NULL THEN N'' ELSE N' 且 DEPT_2=' + @Dept2    END +
        CASE WHEN @Dept3    IS NULL THEN N'' ELSE N' 且 DEPT_3=' + @Dept3    END, 1, 3, N'');

    INSERT dbo.AuditLog(ActorName,ActorRole,ActorEmpId,Action,EntityType,EntityId,OldValue)
    VALUES(@Actor,@ActorRole,@ActorEmpId,'ACCESSRULE','AccessRule',@Desc, CONCAT(N'刪除瀏覽權限規則：', @Desc));
END
GO

PRINT '遷移 12 完成：AccessRules 已改為多欄位組合(AND)結構。';
GO
