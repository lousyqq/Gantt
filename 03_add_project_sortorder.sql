/* =====================================================================
   MSD 專案追蹤總表 — 遷移 03：Projects 加入 SortOrder（供主管拖曳排序）
   可安全重複執行（idempotent）。在 Gantt 資料庫下執行。
   sqlcmd 執行範例：
     sqlcmd -S Sariel -d Gantt -I -b -f 65001 -i 03_add_project_sortorder.sql
   ===================================================================== */
SET NOCOUNT ON;
GO

/* 1) 新增 SortOrder 欄位（若尚未存在） */
IF COL_LENGTH('dbo.Projects','SortOrder') IS NULL
BEGIN
    ALTER TABLE dbo.Projects
        ADD SortOrder INT NOT NULL CONSTRAINT DF_Projects_Sort DEFAULT(0);
END
GO

/* 2) 回填：每位負責人底下，依現有 ProjectId 順序給 1..N */
;WITH ranked AS (
    SELECT ProjectId,
           ROW_NUMBER() OVER (PARTITION BY OwnerUserId ORDER BY ProjectId) AS rn
    FROM dbo.Projects
)
UPDATE p SET p.SortOrder = r.rn
FROM dbo.Projects p
JOIN ranked r ON r.ProjectId = p.ProjectId;
GO

/* 3) 重新排序預存程序：接受 JSON 陣列（依目標順序排列的 ProjectId） */
IF OBJECT_ID('dbo.usp_ReorderProjects','P') IS NOT NULL DROP PROCEDURE dbo.usp_ReorderProjects;
GO
CREATE PROCEDURE dbo.usp_ReorderProjects
    @OrderedIdsJson NVARCHAR(MAX),          -- 例：'[105,101,110]'
    @Actor NVARCHAR(50),
    @ActorRole NVARCHAR(20) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    -- OPENJSON 對陣列的 [key] 即為 0-based 索引，可保留輸入順序
    UPDATE p
       SET p.SortOrder = j.seq + 1,
           p.UpdatedAt = SYSDATETIME()
    FROM dbo.Projects p
    JOIN (
        SELECT CONVERT(INT,[value]) AS ProjectId,
               CONVERT(INT,[key])   AS seq
        FROM OPENJSON(@OrderedIdsJson)
    ) j ON j.ProjectId = p.ProjectId;

    INSERT dbo.AuditLog(ActorName,ActorRole,Action,EntityType,EntityId,NewValue)
    VALUES(@Actor,@ActorRole,'REORDER','Project',NULL,@OrderedIdsJson);
END
GO

PRINT '遷移 03 完成：Projects.SortOrder 與 usp_ReorderProjects 已就緒。';
GO
