/* =====================================================================
   MSD 專案追蹤總表 — 遷移 04：usp_EnsureScheduleYear（年度週資料產生器）
   可安全重複執行（idempotent）。在 Gantt 資料庫下執行。
   sqlcmd 執行範例：
     sqlcmd -S Sariel -d Gantt -I -b -f 65001 -i 04_add_ensure_schedule_year.sql
   之後要開新年度（例如 2027）只需：
     EXEC dbo.usp_EnsureScheduleYear 2027;
   ===================================================================== */
SET NOCOUNT ON;
GO

IF OBJECT_ID('dbo.usp_EnsureScheduleYear','P') IS NOT NULL DROP PROCEDURE dbo.usp_EnsureScheduleYear;
GO
CREATE PROCEDURE dbo.usp_EnsureScheduleYear
    @Year INT
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (SELECT 1 FROM dbo.ScheduleWeeks WHERE ScheduleYear = @Year) RETURN;

    -- ISO 8601:第 1 週=含 1/4 的那一週(週一起始);每週所屬月份取該週「週四」的月份
    DECLARE @jan4     DATE = DATEFROMPARTS(@Year, 1, 4);
    DECLARE @dowMon   INT  = (DATEPART(WEEKDAY, @jan4) + @@DATEFIRST - 2) % 7;      -- 0=週一
    DECLARE @week1Mon DATE = DATEADD(DAY, -@dowMon, @jan4);                          -- 第 1 週的週一
    DECLARE @maxWeek  INT  = DATEPART(ISO_WEEK, DATEFROMPARTS(@Year, 12, 28));       -- 該年 ISO 週數(52 或 53)

    DECLARE @w INT = 1;
    WHILE @w <= @maxWeek
    BEGIN
        DECLARE @thu DATE = DATEADD(DAY, (@w - 1) * 7 + 3, @week1Mon);               -- 該週週四
        INSERT dbo.ScheduleWeeks(ScheduleYear, WeekNo, MonthName, MonthLabel)
        VALUES(@Year, @w, FORMAT(@thu, 'yyyyMM'), FORMAT(@thu, 'yyyy/MM'));
        SET @w += 1;
    END
END
GO

PRINT '遷移 04 完成：usp_EnsureScheduleYear 已就緒。開新年度請 EXEC dbo.usp_EnsureScheduleYear <年度>;';
GO
