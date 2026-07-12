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
