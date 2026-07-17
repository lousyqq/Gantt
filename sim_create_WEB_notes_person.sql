/* =====================================================================
   本機模擬腳本：建立 [WEB].[dbo].[notes_person]（僅供開發機模擬遠端環境）
   ---------------------------------------------------------------------
   ⚠ 遠端主機「已有」WEB DB 且 notes_person 為 CREATE VIEW（來自別台 server），
     本檔僅在開發機模擬同名資料表與範例資料，**遠端主機請勿執行**。
   內容：CREATE DATABASE WEB（若不存在）→ 建 notes_person 資料表（若不存在）
         → 清空重灌截圖範例資料（34 筆，中文姓名為截圖辨識、僅供測試）。
   可重複執行（idempotent）。
   sqlcmd 執行範例：
     sqlcmd -S Sariel -U testuser -P test -I -b -f 65001 -i sim_create_WEB_notes_person.sql
   ===================================================================== */
IF DB_ID('WEB') IS NULL
    CREATE DATABASE [WEB];
GO
USE [WEB];
GO
IF OBJECT_ID('dbo.notes_person','U') IS NULL AND OBJECT_ID('dbo.notes_person','V') IS NULL
BEGIN
    CREATE TABLE [dbo].[notes_person](
        [EMPNO]    [nvarchar](20)  NULL,
        [NAME]     [nvarchar](50)  NULL,
        [ENAME]    [nvarchar](50)  NULL,
        [DEPTID]   [nvarchar](45)  NULL,
        [DEPTNAME] [nvarchar](45)  NULL,
        [DEPT_1]   [nvarchar](45)  NULL,
        [DEPT_2]   [nvarchar](45)  NULL,
        [DEPT_3]   [nvarchar](45)  NULL,
        [DEPT_4]   [nvarchar](45)  NULL,
        [EXT]      [nvarchar](60)  NULL,
        [EMAIL]    [nvarchar](100) NULL,
        [LEVELS]   [nvarchar](5)   NULL
    ) ON [PRIMARY];
END
GO
-- 模擬資料重灌（僅資料表型態時；若之後改建為 VIEW 則略過）
IF OBJECT_ID('dbo.notes_person','U') IS NOT NULL
BEGIN
    DELETE FROM dbo.notes_person;

    INSERT INTO dbo.notes_person (EMPNO,NAME,ENAME,DEPTID,DEPTNAME,DEPT_1,DEPT_2,DEPT_3,DEPT_4,EXT,EMAIL,LEVELS) VALUES
    (N'00002892',N'江炳耀',N'P Y Chiang',      NULL,N'12A_PTI/ESI',     N'12A_PTI',N'ESI',NULL,  NULL,N'23800/8623800',N'P_Y_Chiang@UMCG',N'2'),
    (N'00015965',N'羅乃焱',N'Ray Lo',          NULL,N'12A_PTI/ESI/EMS1',N'12A_PTI',N'ESI',N'EMS1',NULL,N'23808/8623808',N'Ray_Lo@UMCG',N'3'),
    (N'00010278',N'何明翰',N'Macgyver Ho',     NULL,N'12A_PTI/ESI/EMS1',N'12A_PTI',N'ESI',N'EMS1',NULL,N'23810/8623810',N'Macgyver_Ho@UMCG',N'5'),
    (N'00045688',N'王靖凱',N'Frankie CK Wang', NULL,N'12A_PTI/ESI/EMS1',N'12A_PTI',N'ESI',N'EMS1',NULL,N'23820/8623820',N'Frankie_CK_Wang@UMCG',N'5'),
    (N'00045896',N'蔡侑憲',N'Yahoo YH Tsai',   NULL,N'12A_PTI/ESI/EMS1',N'12A_PTI',N'ESI',N'EMS1',NULL,N'23804/8623804',N'Yahoo_YH_Tsai@UMCG',N'5'),
    (N'00057728',N'陳建翰',N'Chien Han Chen',  NULL,N'12A_PTI/ESI/EMS1',N'12A_PTI',N'ESI',N'EMS1',NULL,N'23821/8623821',N'Chien_Han_Chen@UMCG',N'5'),
    (N'00017742',N'黃世偉',N'Sharon Huang',    NULL,N'12A_PTI/ESI/EMS2',N'12A_PTI',N'ESI',N'EMS2',NULL,N'23817/8623817',N'Sharon_Huang@UMCG',N'3'),
    (N'00019246',N'陳桂豪',N'KH Chen',         NULL,N'12A_PTI/ESI/EMS2',N'12A_PTI',N'ESI',N'EMS2',NULL,N'25056/8625056',N'KH_Chen@UMCG',N'5'),
    (N'00019354',N'郭宗宜',N'Tsung Yi Kuo',    NULL,N'12A_PTI/ESI/EMS2',N'12A_PTI',N'ESI',N'EMS2',NULL,N'23807/8623807',N'Tsung_Yi_Kuo@UMCG',N'5'),
    (N'00019734',N'吳振茂',N'Clarence Wu',     NULL,N'12A_PTI/ESI/EMS2',N'12A_PTI',N'ESI',N'EMS2',NULL,N'23811/8623811',N'Clarence_Wu@UMCG',N'5'),
    (N'00026934',N'鄭天翔',N'Eason Cheng',     NULL,N'12A_PTI/ESI/EMS2',N'12A_PTI',N'ESI',N'EMS2',NULL,N'23819/8623819',N'Eason_Cheng@UMCG',N'5'),
    (N'00034018',N'張智寬',N'Chih Kuan Chang', NULL,N'12A_PTI/ESI/EMS2',N'12A_PTI',N'ESI',N'EMS2',NULL,N'25050/8625050',N'Chih_Kuan_Chang@UMCG',N'5'),
    (N'00042436',N'吳鄒儀',N'Amanda Wu',       NULL,N'12A_PTI/ESI/EMS2',N'12A_PTI',N'ESI',N'EMS2',NULL,N'8623801',      N'Amanda_Wu@UMCG',N'5'),
    (N'00042619',N'陶淑芬',N'Mina Tao',        NULL,N'12A_PTI/ESI/EMS2',N'12A_PTI',N'ESI',N'EMS2',NULL,N'23818/8623818',N'Mina_Tao@UMCG',N'5'),
    (N'00044520',N'朱冠榮',N'Kuan Jung Chu',   NULL,N'12A_PTI/ESI/EMS2',N'12A_PTI',N'ESI',N'EMS2',NULL,N'25057/8625057',N'Kuan_Jung_Chu@UMCG',N'5'),
    (N'00058682',N'陳繹全',N'Yi C Chen',       NULL,N'12A_PTI/ESI/EMS2',N'12A_PTI',N'ESI',N'EMS2',NULL,N'8623812',      N'Yi_C_Chen@UMCG',N'5'),
    (N'00043029',N'陳政誠',N'Jarvis Chen',     NULL,N'12A_PTI/ESI/IMD', N'12A_PTI',N'ESI',N'IMD', NULL,N'23814/8623814',N'Jarvis_Chen@UMCG',N'3'),
    (N'00015584',N'王明冬',N'Winter Wang',     NULL,N'12A_PTI/ESI/IMD', N'12A_PTI',N'ESI',N'IMD', NULL,N'23809/8623809',N'Winter_Wang@UMCG',N'5'),
    (N'00040704',N'鄭維揚',N'Marty Cheng',     NULL,N'12A_PTI/ESI/IMD', N'12A_PTI',N'ESI',N'IMD', NULL,N'23802/8623802',N'Marty_Cheng@UMCG',N'5'),
    (N'00040862',N'宋守仁',N'Solon Sung',      NULL,N'12A_PTI/ESI/IMD', N'12A_PTI',N'ESI',N'IMD', NULL,N'23809/8623809',N'Solon_Sung@UMCG',N'5'),
    (N'00043488',N'王鴻昇',N'James HS Wang',   NULL,N'12A_PTI/ESI/IMD', N'12A_PTI',N'ESI',N'IMD', NULL,N'23805/8623805',N'James_HS_Wang@UMCG',N'5'),
    (N'00046066',N'李康平',N'Ken KP Li',       NULL,N'12A_PTI/ESI/IMD', N'12A_PTI',N'ESI',N'IMD', NULL,N'25055/8625055',N'Ken_KP_Li@UMCG',N'5'),
    (N'00048755',N'胡怡萱',N'Sharon Hu',       NULL,N'12A_PTI/ESI/IMD', N'12A_PTI',N'ESI',N'IMD', NULL,N'8625058',      N'Sharon_Hu@UMCG',N'5'),
    (N'00059287',N'吳偉民',N'Adai Wu',         NULL,N'12A_PTI/ESI/IMD', N'12A_PTI',N'ESI',N'IMD', NULL,N'23811/8623811',N'Adai_Wu@UMCG',N'5'),
    (N'00002732',N'黃振暉',N'J H Huang',       NULL,N'12A_PTI/ESI/MSD', N'12A_PTI',N'ESI',N'MSD', NULL,N'23813/8623813',N'J_H_Huang@UMCG',N'3'),
    (N'00041817',N'李裕隆',N'Yue Loong Li',    NULL,N'12A_PTI/ESI/MSD', N'12A_PTI',N'ESI',N'MSD', NULL,N'23815/8623815',N'Yue_Loong_Li@UMCG',N'5'),
    (N'00041856',N'李棻',  N'Sw Lee',          NULL,N'12A_PTI/ESI/MSD', N'12A_PTI',N'ESI',N'MSD', NULL,N'23816/8623816',N'Sw_Lee@UMCG',N'5'),
    (N'00043388',N'楊詠裕',N'Yong Yu Yang',    NULL,N'12A_PTI/ESI/MSD', N'12A_PTI',N'ESI',N'MSD', NULL,N'23803/8623803',N'Yong_Yu_Yang@UMCG',N'5'),
    (N'00046038',N'李彬魁',N'Brian PK Lee',    NULL,N'12A_PTI/ESI/MSD', N'12A_PTI',N'ESI',N'MSD', NULL,N'25054/8625054',N'Brian_PK_Lee@UMCG',N'5'),
    (N'00048599',N'李政翰',N'James CH Li',     NULL,N'12A_PTI/ESI/MSD', N'12A_PTI',N'ESI',N'MSD', NULL,N'23806/8623806',N'James_CH_Li@UMCG',N'5'),
    (N'00048765',N'陳冠芝',N'Guan Jhih Chen',  NULL,N'12A_PTI/ESI/MSD', N'12A_PTI',N'ESI',N'MSD', NULL,N'25059/8625059',N'Guan_Jhih_Chen@UMCG',N'5'),
    (N'00058313',N'呂宛芸',N'Annie Lu',        NULL,N'12A_PTI/ESI/MSD', N'12A_PTI',N'ESI',N'MSD', NULL,N'25054/8625054',N'Annie_Lu@UMCG',N'5'),
    (N'00058402',N'廖威智',N'Ian Liao',        NULL,N'12A_PTI/ESI/MSD', N'12A_PTI',N'ESI',N'MSD', NULL,N'25053/8625053',N'Ian_Liao@UMCG',N'5'),
    (N'00058897',N'林玉婷',N'Sariel Lin',      NULL,N'12A_PTI/ESI/MSD', N'12A_PTI',N'ESI',N'MSD', NULL,N'25054/8625054',N'Sariel_Lin@UMCG',N'5');

    DECLARE @cnt int;
    SELECT @cnt = COUNT(*) FROM dbo.notes_person;
    PRINT '模擬資料已重灌：' + CAST(@cnt AS varchar(10)) + ' 筆。';
END
GO
