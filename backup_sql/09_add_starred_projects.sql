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
