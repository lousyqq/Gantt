/* =====================================================================
   MSD 專案追蹤總表 — 遷移 21：usp_EnsureScheduleYear 改用公司週次規則，重建 2027 週表
   可安全重複執行（idempotent）。在 Gantt 資料庫下執行（四個站台的 DB 都要跑）。
   sqlcmd 執行範例：
     sqlcmd -S Sariel -d Gantt -I -b -f 65001 -i 21_company_week_rule.sql
   成因（2026-09-14 使用者確認公司行事曆）：
     公司週次 **不是 ISO 8601**：一週從**週日**開始；W1＝含 1/1 的那一週（從 1/1 前最近的週日起算）；
     跨年**照日期切**——12/31 屬舊年度最後一週、1/1 起屬新年度 W1（等同 Excel WEEKNUM(d,1)）。
     例：2026-12-31(四)＝2026 W53、2027-01-01(五)＝2027 W01（只有 1/1、1/2 兩天）、2027 W02 從 1/3(日) 起。
     舊 SP 依 ISO（週一起始、含 1/4 那週為 W1、月份取週四）產生 →
       ・2027 產成 52 週且每週日期全錯（公司規則 2027 是 53 週：1 月 6 週、W53＝12/26–12/31）；
       ・2026 的 53 列是 old.sql 手寫種子，本來就符合公司規則（各月 5,4,5,4,5,4,4,5,4,4,5,4），**不動**。
     old.sql 已 EXEC dbo.usp_EnsureScheduleYear 2027 → 遠端目前存有 52 列 ISO 版的 2027，本檔會整組重建。
   內容：
     1) CREATE OR ALTER usp_EnsureScheduleYear：週日起始、W1 含 1/1、週所屬月份＝該週「週日」的月份（W1 固定 1 月）
     2) 校正既有年度：逐週比對，月份不符 UPDATE、缺週 INSERT（週次編號不動；ScheduleWeeks 無 FK，不影響資料表）
        實測本機：MSD 的 2026（old.sql 手寫種子）完全吻合、0 更動；IMD 的 2026 是 SP 產的 ISO 版 52 列 → 更正 9 週月份＋補 W53；
        2027（old.sql 用舊 SP 產的 ISO 52 列）→ 更正月份＋補 W53 成 6,4,4,4,5,4,4,5,4,5,4,4。
     3) EXEC usp_EnsureScheduleYear 2027（保險；已存在即略過）
   與前端 app.jsx `companyWeekOf`、後端 Program.cs `CompanyWeekOf` 同一套規則（三處要一起改）。
   ===================================================================== */
SET NOCOUNT ON;
GO
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

/* 1) 產生指定年度的 ScheduleWeeks（公司規則版） ----------------------------
   用法：EXEC dbo.usp_EnsureScheduleYear 2028;  之後前端年度下拉即可選到該年 */
CREATE OR ALTER PROCEDURE dbo.usp_EnsureScheduleYear
    @Year INT
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (SELECT 1 FROM dbo.ScheduleWeeks WHERE ScheduleYear = @Year) RETURN;

    -- 公司規則：週日起始、W1＝含 1/1 的那週。1900-01-07 是週日 → 與 @@DATEFIRST 無關的星期幾算法
    DECLARE @jan1     DATE = DATEFROMPARTS(@Year, 1, 1);
    DECLARE @dec31    DATE = DATEFROMPARTS(@Year, 12, 31);
    DECLARE @dowSun   INT  = DATEDIFF(DAY, '19000107', @jan1) % 7;          -- 0=週日
    DECLARE @week1Sun DATE = DATEADD(DAY, -@dowSun, @jan1);                  -- W1 的週日（可能落在前一年 12 月）
    DECLARE @maxWeek  INT  = DATEDIFF(DAY, @week1Sun, @dec31) / 7 + 1;       -- 該年週數（52 或 53）

    DECLARE @w INT = 1;
    WHILE @w <= @maxWeek
    BEGIN
        -- 週所屬月份＝該週週日的月份；W1 的週日可能在前一年 12 月，固定算 1 月
        DECLARE @sun DATE = DATEADD(DAY, (@w - 1) * 7, @week1Sun);
        IF @sun < @jan1 SET @sun = @jan1;
        INSERT dbo.ScheduleWeeks(ScheduleYear, WeekNo, MonthName, MonthLabel)
        VALUES(@Year, @w, FORMAT(@sun, 'yyyyMM'), FORMAT(@sun, 'yyyy/MM'));
        SET @w += 1;
    END
END
GO

/* 2) 校正既有年度：對 ScheduleWeeks 裡每個年度逐週比對公司規則 --------------------
   ・月份不符 → UPDATE（週次編號本身不變：使用者一直是用公司週在填，W37 就是 W37，只有「哪幾週算 9 月」對錯）
   ・缺週 → INSERT（ISO 版的 2027 只有 52 列、缺 W53；某些站台的 2026 也可能是 SP 產的 52 列、缺 W53）
   ・多出的週（超過該年週數）→ 只 PRINT 警告不刪（目前沒有這種年度；真的遇到再人工處理）
   ScheduleWeeks 沒有任何 FK 指向它，UPDATE/INSERT 不影響 Tasks／WeeklyLogs 等資料表。冪等：第二次執行全部略過。 */
DECLARE @year INT, @w INT, @sun DATE, @jan1 DATE, @dec31 DATE, @week1Sun DATE, @maxWeek INT,
        @expect CHAR(6), @actual CHAR(6), @upd INT, @ins INT, @extra INT;
DECLARE yrs CURSOR LOCAL FAST_FORWARD FOR SELECT DISTINCT ScheduleYear FROM dbo.ScheduleWeeks ORDER BY ScheduleYear;
OPEN yrs; FETCH NEXT FROM yrs INTO @year;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @jan1 = DATEFROMPARTS(@year, 1, 1); SET @dec31 = DATEFROMPARTS(@year, 12, 31);
    SET @week1Sun = DATEADD(DAY, -(DATEDIFF(DAY, '19000107', @jan1) % 7), @jan1);
    SET @maxWeek = DATEDIFF(DAY, @week1Sun, @dec31) / 7 + 1;
    SET @upd = 0; SET @ins = 0; SET @w = 1;
    WHILE @w <= @maxWeek
    BEGIN
        SET @sun = DATEADD(DAY, (@w - 1) * 7, @week1Sun);
        IF @sun < @jan1 SET @sun = @jan1;
        SET @expect = FORMAT(@sun, 'yyyyMM');
        SET @actual = NULL;
        SELECT @actual = MonthName FROM dbo.ScheduleWeeks WHERE ScheduleYear = @year AND WeekNo = @w;
        IF @actual IS NULL
        BEGIN
            INSERT dbo.ScheduleWeeks(ScheduleYear, WeekNo, MonthName, MonthLabel)
            VALUES(@year, @w, @expect, FORMAT(@sun, 'yyyy/MM'));
            SET @ins += 1;
        END
        ELSE IF @actual <> @expect
        BEGIN
            UPDATE dbo.ScheduleWeeks SET MonthName = @expect, MonthLabel = FORMAT(@sun, 'yyyy/MM')
            WHERE ScheduleYear = @year AND WeekNo = @w;
            PRINT '  ' + CAST(@year AS VARCHAR) + ' W' + RIGHT('0' + CAST(@w AS VARCHAR), 2) + ' 月份 ' + @actual + ' → ' + @expect;
            SET @upd += 1;
        END
        SET @w += 1;
    END
    SELECT @extra = COUNT(*) FROM dbo.ScheduleWeeks WHERE ScheduleYear = @year AND WeekNo > @maxWeek;
    PRINT CAST(@year AS VARCHAR) + '：應為 ' + CAST(@maxWeek AS VARCHAR) + ' 週，更正月份 ' + CAST(@upd AS VARCHAR)
        + ' 週、補入 ' + CAST(@ins AS VARCHAR) + ' 週' + CASE WHEN @extra > 0 THEN '；⚠ 多出 ' + CAST(@extra AS VARCHAR) + ' 週未刪除，請人工確認' ELSE '' END;
    FETCH NEXT FROM yrs INTO @year;
END
CLOSE yrs; DEALLOCATE yrs;
GO

/* 3) 2027 若整個年度還不存在（理論上 old.sql 已建），依新規則產生 */
EXEC dbo.usp_EnsureScheduleYear 2027;
GO

/* 結果：各年度週數與各月週數 */
SELECT ScheduleYear, MonthName, Weeks = COUNT(*), FirstWeek = MIN(WeekNo), LastWeek = MAX(WeekNo)
FROM dbo.ScheduleWeeks
WHERE ScheduleYear IN (2026, 2027)
GROUP BY ScheduleYear, MonthName
ORDER BY ScheduleYear, MonthName;
GO
