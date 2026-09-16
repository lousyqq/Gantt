function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const {
  useState,
  useMemo,
  useRef,
  useCallback
} = React;

// --- 1. 系統設定與時間軸定義 ---
const WEEKS_TOTAL = 52; // 預設值;實際以選定年度 ScheduleWeeks 的筆數為準(52 或 53)
const DEFAULT_SCHEDULE_YEAR = new Date().getFullYear(); // 預設載入今年;實際可用年度由 bootstrap 的 years 決定

// 公司週次規則(2026-09-14 使用者確認,**不是 ISO 8601**):一週從**週日**開始;W1＝含 1/1 的那一週(從 1/1 前最近的週日起算);
// 跨年照日期切——12/31 屬於舊年度的最後一週、1/1 起屬於新年度 W1(等同 Excel WEEKNUM(d,1))。
// 例:2026-12-31(四)=2026 W53、2027-01-01(五)=2027 W01(只有 1/1、1/2 兩天,0 個上班日)、2027 W02 從 1/3(日)起。
// ⚠ 後端 Program.cs `CompanyWeekOf` 與 SP `usp_EnsureScheduleYear`(遷移 21)是同一套規則,三處要一起改。
// ⚠ 之前是 ISO 週(週一起始、含 1/4 那週為 W1),每個星期日差一週、跨年整段錯,2026-09-14 一併修正。
const WEEK1_SUNDAY = year => {
  const jan1 = new Date(year, 0, 1);
  return new Date(year, 0, 1 - jan1.getDay());
}; // getDay: 週日=0
const companyWeekOf = d => {
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.floor(Math.round((day - WEEK1_SUNDAY(day.getFullYear())) / 86400000) / 7) + 1;
};
// 某週的實際日期區間(夾在 1/1～12/31 內):W1 從 1/1 起、最後一週到 12/31 止。純前端算,不進 DB。
const weekDateRange = (year, week) => {
  const start = new Date(WEEK1_SUNDAY(year).getTime() + (week - 1) * 7 * 86400000);
  const end = new Date(start.getTime() + 6 * 86400000);
  const jan1 = new Date(year, 0, 1),
    dec31 = new Date(year, 11, 31);
  return {
    start: start < jan1 ? jan1 : start,
    end: end > dec31 ? dec31 : end
  };
};
// MM/DD 零填補(2026-09-14 使用者決定):與企業報表／Excel 慣例一致、與 W01 的週次寫法一致,且日期區間寬度固定不隨週跳動
const fmtMD = d => `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
// 「W37（9/6–9/12）」這種給人看的週名;短週(跨年 W1、W53)靠日期區間自明,不必另外解釋
const weekRangeLabel = (year, week) => {
  const r = weekDateRange(year, week);
  return `${fmtMD(r.start)}–${fmtMD(r.end)}`;
};
// 依今天日期算公司週;非選定年度時夾在排程範圍內(過去年度=最後一週、未來年度=1)
const getTodayWeek = (scheduleYear = DEFAULT_SCHEDULE_YEAR, weeksTotal = WEEKS_TOTAL) => {
  const now = new Date();
  if (now.getFullYear() < scheduleYear) return 1;
  if (now.getFullYear() > scheduleYear) return weeksTotal;
  return Math.min(weeksTotal, Math.max(1, companyWeekOf(now)));
};
const DEFAULT_CURRENT_WEEK = getTodayWeek();
// 「今天」屬於哪個排程年度。選到別的年度時整年都是過去或未來,沒有「本週」可言——
// 所有「本週回報」的入口(徽章、回報中心、打卡)都只認 scheduleYear === getTodayScheduleYear()。
// 公司規則跨年照日期切,所以就是日曆年;其餘判斷都經由 isCurrentYear／isReportingWeek／isFutureWeek 三個旗標。
const getTodayScheduleYear = () => new Date().getFullYear();
const NAVY = '#001F5B';
// 品牌色的「按鈕」版本:深色模式下提亮成 #2563EB(見 input.css 的 --brand-btn)。
// 為什麼要分成兩個常數:NAVY 用在標題列/表頭那種大面積色塊,深色下維持深海軍藍才好看;
// 但同一個 #001F5B 拿來當「按鈕填色」時,坐在 #1E293B 的工具列/彈窗上對比只有 1.07,
// 按鈕會完全融進背景。帶 fallback 是為了快取到舊 CSS 時仍退回原色,不會變透明底配白字。
const BRAND_BTN = 'var(--brand-btn, #001F5B)';
const GOLD = '#FDD075';

// 2026 年的預設週→月對照(fallback);實際以 bootstrap 回傳的 weeks(ScheduleWeeks)為準
const MONTHS = [{
  name: '202601',
  weeks: 5
}, {
  name: '202602',
  weeks: 4
}, {
  name: '202603',
  weeks: 4
}, {
  name: '202604',
  weeks: 4
}, {
  name: '202605',
  weeks: 5
}, {
  name: '202606',
  weeks: 4
}, {
  name: '202607',
  weeks: 4
}, {
  name: '202608',
  weeks: 5
}, {
  name: '202609',
  weeks: 4
}, {
  name: '202610',
  weeks: 4
}, {
  name: '202611',
  weeks: 5
}, {
  name: '202612',
  weeks: 4
}];

// 將 bootstrap 的 weeks 陣列([{week, monthName, monthLabel}, ...])聚合成 MONTHS 形式
const groupWeeksToMonths = weeks => {
  const out = [];
  for (const w of weeks) {
    const last = out[out.length - 1];
    if (last && last.name === w.monthName) last.weeks++;else out.push({
      name: w.monthName,
      weeks: 1
    });
  }
  return out;
};

// 類型標籤:邊框用 400/500 深階(投影機對比打折,300 級邊框在布幕上會消失)
// short＝工具列篩選晶片用的四字短名(全名放 title):五顆全名晶片 419px,是 1366 寬時工具列溢出的主因之一(2026-09-13)
const PROJECT_TYPES = {
  'a': {
    label: '一級專案/KPI',
    short: '一級專案',
    chip: 'bg-pink-100 text-pink-800 border-pink-400',
    dot: 'bg-pink-500'
  },
  'b': {
    label: '重大貢獻及亮點',
    short: '重大貢獻',
    chip: 'bg-yellow-100 text-yellow-800 border-yellow-500',
    dot: 'bg-yellow-500'
  },
  'c': {
    label: '日常管理',
    short: '日常管理',
    chip: 'bg-teal-100 text-teal-800 border-teal-400',
    dot: 'bg-teal-500'
  },
  'd': {
    label: '其他加分項',
    short: '其他加分',
    chip: 'bg-orange-100 text-orange-800 border-orange-400',
    dot: 'bg-orange-500'
  },
  'e': {
    label: '主管交辦',
    short: '主管交辦',
    chip: 'bg-purple-100 text-purple-800 border-purple-400',
    dot: 'bg-purple-500'
  }
};

// 狀態色加深(範本 B 高對比):白字在色塊上達 WCAG AA,年長使用者更易辨識
// dot＝甘特條上的週回報小點(坐在淺色計畫區間上,需要 700 級才壓得住);
// fill＝團隊看板成員列的分段進度條——700 級整條又暗又悶,改用「淺色 600／深色 500」:
//   淺色坐在白色空槽上,600 級清爽又守得住對比(green 3.28／sky 4.07／slate 4.76);
//   深色坐在近黑空槽上,500 級才明亮舒服(green 7.96／sky 6.52／slate-500 3.75)。
//   ⚠ 不可只寫 600:`.dark .bg-green-600` 是給「實心動作按鈕」加深用的(→#166534),
//     不加 dark: 變體會被壓成墨綠;`bg-slate-400` 深色同理被壓成 #475569(對比 2.41),故未執行兩邊都用 500。
const STATUS_META = {
  executed: {
    label: '有執行',
    icon: '✅',
    bar: 'bg-green-700 border-green-800 text-white',
    tag: 'bg-green-100 text-green-800',
    dot: 'bg-green-700',
    fill: 'bg-green-600 dark:bg-green-500'
  },
  monitor: {
    label: 'Monitor',
    icon: '👁️',
    bar: 'bg-sky-700 border-sky-800 text-white',
    tag: 'bg-sky-100 text-sky-800',
    dot: 'bg-sky-700',
    fill: 'bg-sky-600 dark:bg-sky-500'
  },
  not_executed: {
    label: '未執行',
    icon: '⏸️',
    bar: 'bg-slate-500 border-slate-600 text-white',
    tag: 'bg-slate-200 text-slate-700',
    dot: 'bg-slate-500',
    fill: 'bg-slate-500'
  }
};
// 分段條的軌道(空槽):加外框才看得出「這是一個空容器＝0%」而不是元件沒畫出來。
// 「未回報」刻意**不畫任何填充**——條填多少＝回報多少,是最直覺的讀法;
// 「未執行」則是實心 slate-500(有回報、只是本週沒做),實心 vs 空槽對比 3.21,不會再被誤讀成「沒交」。
// (曾用黃黑警示斜紋表示未回報,但週中「還沒回報」本來就是常態,整片警示反而讓真正的警訊失效)
// 空槽:淺色用**白**(原本 slate-300 中灰,配 700 級填色整條又暗又悶);深色壓到近黑 slate-900
// (用 slate-700 時「未執行實心 slate-500」對空槽只有 2.18,分不出有填沒填;壓暗後 3.80)。
// 軌道與列底同色沒關係——外框(淺 3.86／深 3.07)負責界定「這是一個空容器」。
const BAR_TRACK = 'bg-white dark:bg-slate-900 border border-slate-500';

// ── 回報單位(遷移 20,2026-09-12 使用者決定,推翻「子區間只排程不打卡」) ──────────────
// 專案很大時一條計畫區間底下切了好幾個階段,只對計畫區間打卡會變成「一週只有一件事」,主管也看不出哪個階段
// 動了、哪個卡住。規則(全站唯一一份,所有「待回報／已回報／分數」的計算都從這裡出去):
//   ①該週有落在範圍內的子區間 → 回報單位＝那些子區間(各自打卡);沒有 → 回報單位＝計畫區間本身。
//   ②父層那週若已有紀錄(切子區間之前回報過的舊週)→ 視為已回報、單位仍是計畫區間,不回頭催子區間(legacy)。
//   ③計畫區間該週的分數＝子區間分數平均(未回報＝0),滿分仍＝計畫區間數——切得細不會讓分數膨脹。
// taskLogs[taskCode][week]＝父層紀錄(SubId NULL)、subLogs[subId][week]＝子區間紀錄,後端分兩份回傳。
// 總開關 SubIntervalCheckin(appsettings.json 的 Features:SubIntervalCheckin,預設關;使用者 2026-09-12 決定先不用,
// 且**刻意不做在網頁上**避免誤操作——只能改設定檔,改完使用者重新整理即套用):關著時子區間回到「只排程不打卡」,
// weekUnits 永遠回 mode:'task'。模組層變數而不是 prop:呼叫點有十幾處分散在四個元件;
// **只在 refreshData 裡跟著整包資料一起更新**(bootstrap 回 subCheckinEnabled),
// 這樣旗標永遠與 taskLogs/subLogs 同一批,所有 useMemo 都因資料物件換新而重算,不會有旗標變了、畫面沒跟上的窗口。
let SUB_CHECKIN = false;
const activeSubsOf = (task, week) => (task.subs || []).filter(s => s.start <= week && s.end >= week);
const weekUnits = (task, week, taskLogs, subLogs) => {
  const parentLog = taskLogs[task.id]?.[week];
  const subs = SUB_CHECKIN ? activeSubsOf(task, week) : [];
  if (parentLog || subs.length === 0) {
    return {
      mode: 'task',
      units: [{
        sub: null,
        log: parentLog
      }],
      reported: parentLog ? 1 : 0,
      total: 1,
      score: parentLog ? Number(parentLog.score ?? 1) : 0,
      legacy: !!parentLog && subs.length > 0
    };
  }
  const units = subs.map(s => ({
    sub: s,
    log: subLogs[s.id]?.[week]
  }));
  const reported = units.filter(u => u.log).length;
  const score = units.reduce((a, u) => a + (u.log ? Number(u.log.score ?? 1) : 0), 0) / units.length;
  return {
    mode: 'sub',
    units,
    reported,
    total: units.length,
    score,
    legacy: false
  };
};
// 甘特父條上的週色點:父層有紀錄 → 該狀態;子區間模式 → 全部回報完取「最積極」的狀態,只回報一部分 → 'partial'(琥珀)
const PARTIAL_DOT = 'bg-amber-500';
const unitsDotStatus = wu => {
  if (wu.reported === 0) return null;
  if (wu.mode === 'task') return wu.units[0].log.status;
  if (wu.reported < wu.total) return 'partial';
  const st = wu.units.map(u => u.log.status);
  return st.includes('executed') ? 'executed' : st.includes('monitor') ? 'monitor' : 'not_executed';
};
// ⚠ 概況列的四顆狀態晶片是**純計數**,不是篩選鈕(2026-09-14 使用者決定移除篩選;2026-08-10 做了「未回報」、09-13 擴成四顆)。
//   移除理由:篩出來的是 20 列整年甘特,主管還是不知道「哪一條」該交;「誰還沒交／誰沒做」看板已經回答得更好
//   (每人「回報 0/5」＋複製待回報名單＋點卡片高亮那條)。同一件事兩條路只是多一套要學、多一堆特例要維護。
//   晶片改成不像按鈕的靜態標籤(色點＋文字＋數字),避免再有人去點。勿再把 statusFilter 加回來。
const unitLabel = (task, sub) => sub ? `${task.name} › ${sub.name}` : task.name;
const sameUnit = (a, b) => a.task.id === b.task.id && (a.sub?.id ?? null) === (b.sub?.id ?? null);
const NO_UNITS = Object.freeze({
  pending: [],
  completed: []
}); // 「沒有待回報清單」的固定空值(非本年度／未來週)

// --- 2. 資料來源:改由後端 API 讀寫 Gantt 資料庫 (取代原本寫死的 INITIAL_PROJECTS) ---
// 自動偵測部署根路徑:本地為 ''(→ /api/...)、IIS 子應用程式(如 /Gantt/)則為 '/Gantt'(→ /Gantt/api/...)
// 作法:取目前頁面 pathname,去掉檔名(如 index.html)與結尾斜線,即為 app 的虛擬目錄前綴
const API_BASE = window.location.pathname.replace(/\/[^/]*\.[^/]*$/, '') // 去掉 /index.html 之類的檔名
.replace(/\/+$/, ''); // 去掉結尾斜線 → '/' 變 ''、'/Gantt/' 變 '/Gantt'

// 後端錯誤回應為 ProblemDetails JSON,解析出 detail/title 顯示;非 JSON 則顯示原文
async function readApiError(res) {
  const text = await res.text().catch(() => '');
  try {
    const j = JSON.parse(text);
    return j.detail || j.title || text;
  } catch {
    return text;
  }
}
// opts.timeoutMs:逾時後主動中止並丟出。
// 只有「畫面被單一請求擋住」的地方需要它(目前是 access-check 的權限閘門)——
// fetch 對「連上了但伺服器不回應」(例:IIS 正在回收)不會 reject,會一直掛著,catch 永遠等不到,
// 沒有逾時的話畫面就**永久停在載入中且無任何提示**。
async function apiGet(path, opts = {}) {
  const ctrl = opts.timeoutMs ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), opts.timeoutMs) : null;
  try {
    const res = await fetch(API_BASE + path, {
      headers: {
        'Accept': 'application/json'
      },
      signal: ctrl ? ctrl.signal : undefined
    });
    if (!res.ok) throw new Error((await readApiError(res)) || 'HTTP ' + res.status);
    return await res.json();
  } finally {
    if (timer) clearTimeout(timer);
  }
}
// Windows 工號(如 00058897):載入時由 /api/whoami 偵測(桌機網域帳號 UMC\00058897 剝前綴),
// 所有寫入 API 自動附帶,由預存程序寫入 AuditLog.ActorEmpId 留下操作紀錄;非網域環境為 null(照常可用)
// 檢視偏好持久化(gantt_prefs):緊湊模式/「週檢視vs年度總覽」重整或隔天重開沿用上次習慣;
// 成果清單不記憶(重開回到週檢視較安全);登出不清除(偏好屬於這台電腦的使用習慣)
function readPrefs() {
  try {
    return JSON.parse(localStorage.getItem('gantt_prefs') || '{}') || {};
  } catch (e) {
    return {};
  }
}
function savePref(key, value) {
  try {
    const p = readPrefs();
    p[key] = value;
    localStorage.setItem('gantt_prefs', JSON.stringify(p));
  } catch (e) {}
}
let CURRENT_EMP_ID = null;
async function detectEmpId() {
  try {
    const d = await apiGet('/api/whoami');
    CURRENT_EMP_ID = d.empId || null;
  } catch {
    CURRENT_EMP_ID = null;
  } // 401(非網域/無法驗證)→ 靜默忽略
  return CURRENT_EMP_ID;
}
async function apiPost(path, body) {
  const res = await fetch(API_BASE + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      actorEmpId: CURRENT_EMP_ID,
      ...body
    })
  });
  if (!res.ok) throw new Error((await readApiError(res)) || 'HTTP ' + res.status);
  return res.json();
}

// 平滑捲動+保底:部分環境(嵌入式瀏覽器/舊核心)的 smooth 動畫會靜默失效,
// 250ms 內未位移就改用瞬間捲動,確保「回到本週/方向鍵平移/到期定位」在任何瀏覽器都有效
const smoothScrollLeftTo = (el, left) => {
  if (!el) return;
  const from = el.scrollLeft;
  const target = Math.max(0, left);
  el.scrollTo({
    left: target,
    behavior: 'smooth'
  });
  setTimeout(() => {
    if (Math.abs(el.scrollLeft - from) < 1 && Math.abs(target - from) >= 1) el.scrollTo(target, el.scrollTop);
  }, 250);
};

// --- 版面自適應(投影機/低解析度筆電) ---
// 投影會議實測:1366×768 下「凍結欄 490 + 團隊看板 672」就吃掉 85% 畫面寬,中間甘特圖幾乎不剩。
// 故凍結欄(專案名稱)與看板寬度改為隨視窗等比縮放:1920 時算出來剛好＝原本的 420 / 672(現有畫面不變),
// 窄螢幕則同步縮小,讓「專案資訊:甘特圖:看板」永遠維持約 1 : 1.5 : 1.4 的比例。
const useViewportWidth = () => {
  const [vw, setVw] = useState(() => typeof window === 'undefined' ? 1920 : window.innerWidth);
  React.useEffect(() => {
    let timer = null; // 拖曳改視窗大小會連續觸發,150ms 去抖避免整張甘特反覆重算
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setVw(window.innerWidth), 150);
    };
    window.addEventListener('resize', onResize);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', onResize);
    };
  }, []);
  return vw;
};
// 成員下拉的登入預設值:成員=只看自己、主管=全部成員。三個檢視共用同一個 ownerFilter,
// 登入／登出／關閉團隊看板都回到這個值,避免各處各寫一份而漂移。
const defaultOwnerFilter = (role, user) => role === 'member' && user ? user : 'all';
const STICKY_LEAD_W = 70; // 凍結欄前兩格:No(28)+分類(42)
const nameColWidth = vw => Math.round(Math.min(420, Math.max(200, vw * 0.22))); // 專案名稱欄(1920→420=原值)
const WEEK_W_RELAXED = 32; // 週檢視寬鬆模式的週欄寬(固定,橫向捲)
const WEEK_W_COMPACT_MIN = 22; // 緊湊模式的週欄下限;整年塞得下時會放大到最多 WEEK_W_RELAXED(見 App 內 weekW)
const SCROLLBAR_W = 17; // Windows 傳統垂直捲軸寬,算「塞不塞得下」時要扣掉
// 團隊看板(1920→672=原 max-w-2xl);下限 400=成員列放得下「條＋得分＋兩顆有文字的按鈕」的最小寬度
const reportPanelWidth = vw => Math.round(Math.min(672, Math.max(400, vw * 0.35)));

// 兩條工具列「全部控制項攤開」所需的自然寬度(實測值,主管+週檢視=最寬的情況)。
// 主內容區可用寬(availW)低於它就必須收起「找資料」那組,否則 flex-nowrap + overflow-x-auto
// 會吐出橫向捲軸——實測 概況列 1188、控制列 1338,故 1280 溢出 58、1024 溢出 164/314。
// ⚠ 原本收控制項**只看看板是否開啟**,完全不看視窗本身多寬 → 1366 以下的筆電/投影機一律中招,
//   而這正是本專案最在意的環境(看板沒開時反而沒有任何保護)。
// ⚠ 兩條分開設門檻,不要合成一個:概況列只要 1188,若跟著控制列的 1345 一起收,
//   1280 會白白失去還放得下的全隊狀態晶片。
// ⚠ 值可略高於實測值留餘裕(中文字寬會隨字體載入狀態浮動),但**絕不可高到 1366 也被收**:
//   1366 是投影機基準解析度,它放得下完整工具列,收掉只會讓投影情境比現在更差。
const STATS_BAR_FULL_W = 1200; // 第一條:概況數字＋全隊狀態晶片＋圖例＋鍵盤提示
const TOOLBAR_FULL_W = 1345; // 第二條:搜尋框＋a~e 晶片＋成員/年度/檢視/密度/補登/展開收合
// 概況列的「極窄」門檻:收掉狀態晶片與鍵盤提示之後,這排仍有三塊不可刪的東西——
// 標題 118＋進度條 150＋圖例 302,加上 padding 32 與 3 個 gap 36 = **646**。
// 1024 投影機開看板時 availW 只有 624 → 溢位 22px,那一列自己吐出橫向捲軸(實測)。
// 極窄時**一項都不刪**(圖例是讀甘特條的必需資訊、標題與回報率是這排存在的理由),
// 改為把「間距與進度條」縮一號:padding 32→16、gap 36→24、進度條 150→120(條身仍有 46px),
// 合計省 58px → 588,1024 有 36px 餘裕。
// ⚠ 門檻取 700 而不是貼著 646:availW 只有「視窗寬−看板寬」兩種變因,700 與 1024 的 624 之間
//   沒有任何實際解析度會落入,但留了中文字寬隨字體載入浮動的餘裕。
// ⚠ 縮完仍可能不夠(例:同時開看板又按下「未回報」篩選,會多一顆晶片與分隔線),
//   故極窄時另加 flex-wrap 讓圖例掉到第二行 —— 寧可多一行,也不要橫向捲軸(甘特本身就是橫向捲動的,
//   同一畫面兩條橫捲軸會分不清在捲哪一個)。
const STATS_BAR_MIN_W = 700;
// 年度總覽的週欄保底寬度:名稱欄要加寬到多少,先由這個值倒推。
// 20px＝兩位數週次在 9px 字級下仍清楚可讀(低於 16px 才需要改成間隔標示),
// 也確保「整年 53 週一畫面」這個核心前提不被名稱欄吃掉。
// ⚠ 別調高:22px 時 1366(投影)算出來只剩 200px 給名稱欄、低於下限 240 → 投影環境完全得不到改善;
//   20px 才讓 1366 也能把名稱欄從 240 撐到 300,而週欄只從 21.1 掉到 20.1。
const MIN_OVERVIEW_WEEK_W = 20;
// ⏰ 即將到期的「時程已過 70%」規則另加「剩餘 ≤ 這個週數」的上限(見 isTaskDeadlineSoon)
const DEADLINE_RATIO_MAX_REMAIN = 4;

// 彈窗「未儲存內容」旗標:表單型視窗(打卡/非專案/下週預計/產出/專案/區間)輸入時設 true、
// 視窗卸載時自動清除;ESC 關窗前檢查,避免打到一半的內容被默默丟棄
let MODAL_DIRTY = false;
const markModalDirty = () => {
  MODAL_DIRTY = true;
};
// 送出成功後手動清旗標 —— 給「**送出後不關閉**」的視窗用(如成員管理:新增完還留在面板繼續管理)。
// 大多數表單送出即卸載,靠 useModalDirtyReset 自動清就夠;那類視窗不需要呼叫這個。
const clearModalDirty = () => {
  MODAL_DIRTY = false;
};
// 表單型視窗掛載時呼叫:卸載(不論儲存或取消)自動重置旗標
const useModalDirtyReset = () => {
  React.useEffect(() => () => {
    MODAL_DIRTY = false;
  }, []);
};

// 單行輸入按 Enter 直接送出。**只給 <input>,textarea 不可套用**(那裡 Enter 是換行)。
// `isComposing` 判斷不可省:中文注音/拼音選字時按 Enter 是「確認選字」,誤送出會把打到一半的字送出去。
// 原本只有成員管理與瀏覽權限支援 Enter,新增專案/區間/產出/打卡都沒有 → 同樣是單行表單卻兩種行為,
// 使用者在一處養成習慣、換一處就以為當掉。
//
// ⚠⚠ 一律用 `isComposingEvent(e)`,**絕對不要直接寫 `e.isComposing`**:
//   React 18 的 SyntheticKeyboardEvent 介面(KeyboardEventInterface)只複製 key/code/location/repeat/
//   修飾鍵/charCode/keyCode/which,**沒有 isComposing** → 在 React 的 onKeyDown 裡取到的永遠是 undefined,
//   整個防護等於沒寫。實測:對輸入框派發 isComposing=true 的 keydown(原生事件確認帶得到),表單照樣送出。
//   只有 `document.addEventListener` 那種**原生**監聽器(全域快捷鍵)拿到的才是真的原生事件,可直接讀。
const isComposingEvent = e => !!(e && (e.nativeEvent ? e.nativeEvent.isComposing : e.isComposing));
const onEnterSubmit = fn => e => {
  if (e.key !== 'Enter' || isComposingEvent(e)) return;
  e.preventDefault();
  fn();
};

// 必填欄位標記:沿用「本週回報中心」既有的紅色必填語彙,讓使用者填之前就知道,而不是按了送出才被擋
const ReqMark = () => /*#__PURE__*/React.createElement("span", {
  className: "text-red-600 font-black ml-0.5",
  title: "\u5FC5\u586B\u6B04\u4F4D"
}, "*");

// 彈窗/側邊面板右上角的關閉鈕(全站 16 處原本各自複製同一段 SVG)。
// 抽成元件的原因不只是去重:圖示鈕沒有任何文字,少了 aria-label 讀螢幕器只會念「按鈕」,
// 使用者不知道那是關閉還是刪除;集中在一處才不會下次新增彈窗又漏掉。
// SVG 本身掛 aria-hidden——它是純裝飾,語意由 aria-label 提供,否則會被重複朗讀。
const CloseButton = ({
  onClick,
  className = 'text-white/70 hover:text-white p-1',
  label = '關閉'
}) => /*#__PURE__*/React.createElement("button", {
  onClick: onClick,
  "aria-label": label,
  title: label,
  className: className
}, /*#__PURE__*/React.createElement("svg", {
  className: "w-6 h-6",
  fill: "none",
  viewBox: "0 0 24 24",
  stroke: "currentColor",
  "aria-hidden": "true"
}, /*#__PURE__*/React.createElement("path", {
  strokeLinecap: "round",
  strokeLinejoin: "round",
  strokeWidth: 2,
  d: "M6 18L18 6M6 6l12 12"
})));

// ── 打卡回報的「文件連結」(選填) ────────────────────────────────────────────
// 主管讀週報時最常做的下一個動作就是「去把那份文件打開」,原本得自己去信件/檔案總管翻;
// 回報時順手貼上連結,看板與彈窗就能直接點開。
const DOC_URL_MAX = 500; // 與 WeeklyLogs.DocUrl NVARCHAR(500) 一致
// 🚨 這個值會被放進 <a href>,而且是「主管一定會點」的連結——不擋等於一個儲存型 XSS。
//    後端 /api/weekly-log 也擋一次(這裡擋不住直接打 API 的情況)。
const isUnsafeUrl = u => /^\s*(javascript|data|vbscript)\s*:/i.test(u || '');
const isHttpUrl = u => /^https?:\/\//i.test((u || '').trim());
// 使用者常直接貼「portal.company.com/doc/1」這種沒有 scheme 的網址。原樣放進 href 會被當成
// **相對路徑** → 點下去跳到本站的 /portal.company.com/doc/1(404),而且看起來像系統壞了。
// 看起來像網域就補上 https://;UNC(\\server\share)與磁碟路徑(C:\…)原樣保留。
const normalizeDocUrl = raw => {
  const s = (raw || '').trim();
  if (!s) return '';
  if (/^[a-z][\w+.-]*:/i.test(s) || s.startsWith('\\\\') || s.startsWith('/')) return s;
  return /^[\w-]+(\.[\w-]+)+([/?#]|$)/.test(s) ? `https://${s}` : s;
};

// 複製到剪貼簿。navigator.clipboard 只在 secure context(https / localhost)提供,
// 內網是純 http → 直接用會 throw,所以一定要保留 execCommand 的退路。回傳是否成功。
const copyToClipboard = async text => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {}
    document.body.removeChild(ta);
    return ok;
  }
};

// 打卡內容裡的文件連結圖示(看板卡片、打卡彈窗、歷史回報列共用)。
// **一律 <a target="_blank">:點一下就開新分頁**,不分來源(2026-08-25 依使用者指示改;
// 原本 UNC/本機路徑走「複製路徑」鈕,兩種來源兩種行為,同一顆圖示點下去結果不一樣)。
//
// ⚠ 非 http 的路徑**一定要先轉成合法的 file: URL**(toDocHref):`\\server\share\a.xlsx` 原樣放進 href
//   會被當成**相對路徑** → 點下去跳到本站的 /\\server\share\a.xlsx(404),那是保證失敗。
//   轉成 `file://server/share/a.xlsx` 之後,只要瀏覽器/IT 政策允許就會真的開起來。
// ⚠ 已知限制:Chrome/Edge **預設封鎖**從 http 頁面開啟 file://(點了沒反應也不報錯),
//   要靠網域政策(URLAllowlist / LocalLinksAllowedInBrowser)放行。若內網未放行,
//   使用者可改從匯出的週報 Excel 開——那裡是真正可點的超連結(Excel 沒有這個限制),
//   或 hover 看 title 取得完整路徑自行貼到檔案總管。
// ⚠ stopPropagation:看板卡片整張是 clickable(點了會去高亮甘特),不擋的話點連結會順便觸發高亮。
//
// 🚨 純圖示,**不可以用 emoji**:初版是「📎 開啟文件」整串文字,在看板卡片裡太吵;
//    但縮成 emoji 也不行——10px 的 📎 只是一團彩色色塊,認不出是什麼(與工具列不用 emoji 同一條理由)。
//    改用 SVG:單色、吃 currentColor(深淺模式自動跟著走)、縮到 14px 仍然看得出是「文件」。
// ⚠ 沒有文字 → **aria-label 是唯一的可及名稱**,讀螢幕器只念得出「連結」的話這個功能等於不存在。
//    title 另外帶完整網址,滑鼠使用者 hover 就知道會去哪,不必先點下去試。
const toDocHref = raw => {
  const s = (raw || '').trim();
  if (!s) return '';
  const enc = p => p.replace(/\\/g, '/').replace(/ /g, '%20'); // 反斜線轉正斜線、空白轉義
  // ⚠ 磁碟機代號要**排在 scheme 判斷之前**:`C:\Docs\a.docx` 的開頭 `C:` 會被當成合法 scheme,
  //   放後面就永遠輪不到這一條(實測 href 直接留成 `C:\Docs\a.docx`)。
  //   Chrome 的 URL parser 有「Windows 磁碟機」特例會幫忙補救,但那是瀏覽器實作細節,不能靠它。
  if (/^[a-zA-Z]:[\\/]/.test(s)) return `file:///${enc(s)}`; // 本機 C:\… → file:///C:/…
  if (s.startsWith('\\\\')) return `file://${enc(s.slice(2))}`; // UNC \\server\share\… → file://server/share/…
  // scheme 至少兩個字元(單字元的都是磁碟機代號,真實 scheme 沒有一個是單字母)
  if (/^[a-z][\w+.-]+:/i.test(s)) return s; // 已有 scheme(http/https/file/onenote…)
  return s;
};
const DocIcon = () => /*#__PURE__*/React.createElement("svg", {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  className: "w-3.5 h-3.5",
  "aria-hidden": "true"
}, /*#__PURE__*/React.createElement("path", {
  d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
}), /*#__PURE__*/React.createElement("path", {
  d: "M14 2v6h6"
}));
const DocLink = ({
  url,
  className = '',
  stopPropagation = false
}) => {
  if (!url || isUnsafeUrl(url)) return null; // 不安全的舊資料一律不渲染成連結
  const href = toDocHref(url);
  if (!href) return null;
  // 點擊區 24×24(WCAG 2.5.8):圖示 14 + p-1 的 8 + 外框 2
  const cls = `inline-flex items-center justify-center p-1 rounded border transition ` + `border-blue-300 bg-blue-50 text-blue-800 hover:bg-blue-100 ${className}`;
  const guard = e => {
    if (stopPropagation) e.stopPropagation();
  };
  return /*#__PURE__*/React.createElement("a", {
    href: href,
    target: "_blank",
    rel: "noopener noreferrer",
    onClick: guard,
    onKeyDown: guard,
    className: cls,
    "aria-label": `開啟文件（另開新分頁）：${url}`,
    title: `開啟文件：${url}`
  }, /*#__PURE__*/React.createElement(DocIcon, null));
};

// 文件連結的送出前驗證(打卡／非專案／下週預計三個表單共用,規則只有一份)。
// 回傳 { doc, error }:doc 已補過 scheme,可直接送出。
const validateDocInput = raw => {
  const doc = normalizeDocUrl(raw);
  if (isUnsafeUrl(doc)) return {
    doc,
    error: '文件連結格式不正確，請貼上網址（http/https）或檔案路徑'
  };
  if (doc.length > DOC_URL_MAX) return {
    doc,
    error: `文件連結請勿超過 ${DOC_URL_MAX} 個字元（目前 ${doc.length} 個）`
  };
  return {
    doc,
    error: ''
  };
};

// 文件連結輸入欄(同上三個表單共用;三處長得一模一樣,抽出來才不會下次只改到其中一個)。
// ⚠ 單行 input 依全站慣例掛 onEnterSubmit(對應該表單的送出目標)。
// ⚠ blur 時補 scheme:使用者看得到實際會送出的值,而不是存完才發現變了。
const DocUrlField = ({
  id,
  value,
  onChange,
  onSubmit,
  error
}) => /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
  className: "flex items-center gap-2"
}, /*#__PURE__*/React.createElement("label", {
  htmlFor: id,
  className: "text-[11px] font-bold text-slate-600"
}, "\uD83D\uDCCE \u6587\u4EF6\u9023\u7D50\uFF08\u9078\u586B\uFF09"), value.trim() && !error && /*#__PURE__*/React.createElement(DocLink, {
  url: normalizeDocUrl(value)
})), /*#__PURE__*/React.createElement("input", {
  id: id,
  type: "text",
  value: value,
  maxLength: DOC_URL_MAX,
  onChange: e => {
    onChange(e.target.value);
    markModalDirty();
  },
  onBlur: e => {
    const n = normalizeDocUrl(e.target.value);
    if (n !== e.target.value) onChange(n);
  },
  onKeyDown: onEnterSubmit(onSubmit),
  placeholder: "https://\u2026 \u6216 \\\\\u4F3A\u670D\u5668\\\u5171\u7528\u8CC7\u6599\u593E\\\u6A94\u6848.xlsx",
  className: `w-full border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 mt-1 ${error ? 'border-red-400' : 'border-slate-300'}`
}), error ? /*#__PURE__*/React.createElement("div", {
  className: "text-xs text-red-600 font-bold mt-1"
}, error) : /*#__PURE__*/React.createElement("div", {
  className: "text-[10px] text-slate-500 mt-1"
}, "\u586B\u4E86\u4E4B\u5F8C\uFF0C\u4E3B\u7BA1\u5728\u5718\u968A\u7E3D\u7D50\u770B\u677F\u9EDE\u4E00\u4E0B\u5716\u793A\u5C31\u6703\u53E6\u958B\u5206\u9801\u958B\u555F\uFF0C\u4E0D\u5FC5\u53E6\u5916\u627E\u6A94\u6848\u3002", value.trim() && !isHttpUrl(normalizeDocUrl(value)) && /*#__PURE__*/React.createElement("span", {
  className: "text-slate-600"
}, "\uFF08\u7DB2\u8DEF\u78C1\u789F\uFF0F\u672C\u6A5F\u8DEF\u5F91\u8981\u700F\u89BD\u5668\u653F\u7B56\u5141\u8A31\u624D\u958B\u5F97\u8D77\u4F86\uFF0C\u5EFA\u8B70\u512A\u5148\u8CBC http/https \u7DB2\u5740\uFF09")));

// 讓非 <button> 的互動元素(表格的 th/tr、絕對定位的甘特條、看板卡片)也能用鍵盤操作。
// 用法:<div {...clickable(() => open(), '開啟 XXX')}>。
// 為什麼不直接改寫成 <button>:th/tr 換掉會破壞 table 結構(sticky 表頭、欄寬、斑馬紋全靠它),
// 甘特條則是 absolute 定位疊在週格上,換成 button 會被 preflight 的按鈕預設樣式干擾。
// 空白鍵要 preventDefault,否則頁面會捲動(瀏覽器預設行為),使用者以為按鈕沒反應。
const clickable = (onActivate, label, opts = {}) => {
  if (!onActivate) return {};
  const props = {
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      onActivate(e);
    }
  };
  // opts.role === null:保留元素的原生語意。<th> 一旦被改成 role="button" 就不再是 columnheader,
  // 讀螢幕器不會把它當欄位標題唸,aria-sort 也會失效——那類元素只要能聚焦＋能按 Enter 就夠了。
  if (opts.role !== null) {
    props.role = opts.role || 'button';
    props['aria-label'] = label;
  }
  if (opts.expanded !== undefined) props['aria-expanded'] = opts.expanded;
  // roving tabindex:同一組元素只留一個 Tab 停留點,組內改用方向鍵移動(WAI-ARIA 的標準做法)。
  // 甘特條有 107 個,全部 tabIndex=0 的話鍵盤使用者要按 107 次 Tab 才穿得過甘特區。
  // opts.roving = { active, group }:active=false 就退出 Tab 順序(仍可被程式 focus)。
  if (opts.roving) {
    props.tabIndex = opts.roving.active ? 0 : -1;
    props['data-roving-group'] = opts.roving.group;
    props['data-roving-id'] = String(opts.roving.id);
    const move = (el, dir) => {
      const all = [...document.querySelectorAll(`[data-roving-group="${opts.roving.group}"]`)];
      const i = all.indexOf(el);
      if (i < 0) return;
      const next = all[Math.min(all.length - 1, Math.max(0, i + dir))];
      if (!next || next === el) return;
      next.focus();
      // ⚠ 一定要在這裡把 tab stop 也移過去,不能只靠元素的 onFocus:
      //   焦點事件在「文件本身沒有焦點」時不會派送(背景分頁、嵌入式檢視),
      //   那時 tab stop 會留在原地 → 使用者 Tab 出去再回來會被丟回第一條。
      if (opts.roving.onRove) opts.roving.onRove(next.getAttribute('data-roving-id'));
    };
    const baseKeyDown = props.onKeyDown;
    props.onKeyDown = e => {
      // ⚠ 只收 ↑↓:←→ 是全域「平移甘特 4 週」的快捷鍵,佔用會拿掉一個沒有替代路徑的操作。
      //   ↑↓ 在此沒有其他用途,拿來做組內移動不會撞到任何既有行為。
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        move(e.currentTarget, e.key === 'ArrowDown' ? 1 : -1);
        return;
      }
      if (baseKeyDown) baseKeyDown(e);
    };
  }
  return props;
};

// header 的系統週數:直接可輸入的週次框。
// 原本只有 ‹ › 兩顆鈕＋純文字「W32」,從 W32 跳到 W08 要按 24 次;←→ 快捷鍵一次也只走 4 週,
// 而且沒有任何提示(使用者不會知道)。做成輸入框後「跳到指定週」變成一步。
// ⚠ 不做成「點一下才變輸入框」:多一次點擊、也少了「這裡可以打字」的可見提示,得不償失。
// ⚠ 一律 onCommit 後才切週(Enter / 失焦),不在 onChange 就切——邊打字邊切週會在打「1」時先跳到 W01,
//    整張甘特白重算一次(53 週 × 107 條)。
// ⚠ 值超出範圍時夾回邊界而不是拒收:成員的上限是 todayWeek(不能看未來週),打 99 會落回本週。
const WeekNumberInput = ({
  week,
  min = 1,
  max,
  onCommit,
  label
}) => {
  const [draft, setDraft] = useState(String(week));
  // 外部切週(‹ ›、H、點週次列)時同步顯示值;使用者正在輸入時不覆蓋
  const focusedRef = useRef(false);
  React.useEffect(() => {
    if (!focusedRef.current) setDraft(String(week));
  }, [week]);
  const commit = () => {
    const n = parseInt(draft, 10);
    if (isNaN(n)) {
      setDraft(String(week));
      return;
    }
    const clamped = Math.min(max, Math.max(min, n));
    setDraft(String(clamped));
    if (clamped !== week) onCommit(clamped);
  };
  return /*#__PURE__*/React.createElement("span", {
    className: "font-bold text-sm tracking-wider inline-flex items-center justify-center",
    style: {
      color: GOLD,
      minWidth: 100
    }
  }, "W", /*#__PURE__*/React.createElement("input", {
    type: "number",
    inputMode: "numeric",
    min: min,
    max: max,
    value: draft,
    "aria-label": label,
    title: label,
    onFocus: e => {
      focusedRef.current = true;
      e.target.select();
    },
    onBlur: () => {
      focusedRef.current = false;
      commit();
    },
    onChange: e => setDraft(e.target.value),
    onKeyDown: e => {
      if (isComposingEvent(e)) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
        e.currentTarget.blur();
      }
      if (e.key === 'Escape') {
        setDraft(String(week));
        e.currentTarget.blur();
      }
    },
    className: "week-input w-9 bg-transparent border-0 border-b border-dashed border-white/40 hover:border-white/80 focus:border-solid text-center font-bold text-sm tracking-wider p-0 outline-none",
    style: {
      color: GOLD
    }
  }));
};

// 彈窗/側邊面板的焦點管理:把回傳值展開到最外層容器 <div {...useModalFocus()} className="fixed inset-0 …">
// 解決三件事(實測:打卡彈窗開啟後焦點仍留在背景按鈕上,背景還有 306 個可聚焦元素,Tab 會跑到甘特條去):
//   ①開啟時把焦點移進彈窗——已有 autoFocus 的輸入欄優先,不搶走;沒有就聚焦容器本身(tabIndex=-1),
//     刻意不自動聚焦第一顆按鈕,免得使用者一按 Enter 就誤觸「關閉」或「刪除」
//   ②Tab / Shift+Tab 在彈窗內循環,不會跑到背景
//   ③關閉時把焦點還原到原本的觸發元素(該元素可能已隨刪除消失,故 try/catch)
const FOCUSABLE_SEL = 'button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])';
const useModalFocus = () => {
  const ref = useRef(null);
  React.useEffect(() => {
    const prev = document.activeElement;
    const el = ref.current;
    // 等 autoFocus 生效後再判斷要不要接手
    const t = setTimeout(() => {
      if (el && !el.contains(document.activeElement)) el.focus({
        preventScroll: true
      });
    }, 0);
    return () => {
      clearTimeout(t);
      try {
        if (prev && document.contains(prev)) prev.focus({
          preventScroll: true
        });
      } catch (e) {}
    };
  }, []);
  const onKeyDown = e => {
    if (e.key !== 'Tab') return;
    const el = ref.current;
    if (!el) return;
    const items = [...el.querySelectorAll(FOCUSABLE_SEL)].filter(n => n.offsetParent !== null);
    if (!items.length) {
      e.preventDefault();
      return;
    } // 無可聚焦元素:焦點留在容器,不放行到背景
    const first = items[0],
      last = items[items.length - 1];
    const inside = items.includes(document.activeElement);
    if (!inside) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
      return;
    } // 焦點在容器本身
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  return {
    ref,
    onKeyDown,
    tabIndex: -1
  };
};

// 週 -> 月份標籤
const weekToMonth = (w, months = MONTHS) => {
  let acc = 0;
  for (const m of months) {
    acc += m.weeks;
    if (w <= acc) return `${m.name.slice(0, 4)}/${m.name.slice(4)}`;
  }
  return '';
};

// 成果清單面板：單一列極簡矩陣，與甘特圖欄位順序一致，且全欄位支援點擊排序
// 成果清單=高階主管「檢視」視角:唯讀無操作欄(編輯一律回週檢視的 🎯 入口);緊湊列距讓單一成員專案盡量一頁看完
function ResultsView({
  projects,
  role,
  currentUser,
  year,
  starredIds = new Set(),
  toggleStar,
  activeFilters = [],
  onClearAllFilters
}) {
  const [filterMode, setFilterMode] = useState('all'); // 'all' | 'starred' | 'hasMp' | 'hasDeliverable' | 'missing'
  const [sortConfig, setSortConfig] = useState({
    key: null,
    direction: 'asc'
  }); // key: 'category' | 'name' | 'owner' | 'deliverable' | 'mpSaving'
  const [exporting, setExporting] = useState(false); // 匯出 Excel 防連點 + 進度回饋
  const [exportFailed, setExportFailed] = useState(false);

  // 點擊表頭切換排序欄位與方向
  const handleSortHeader = key => {
    setSortConfig(prev => {
      if (prev.key === key) {
        return {
          key,
          direction: prev.direction === 'asc' ? 'desc' : 'asc'
        };
      }
      return {
        key,
        direction: key === 'mpSaving' ? 'desc' : 'asc'
      };
    });
  };

  // 根據篩選與排序整理專案列表
  const displayedProjects = useMemo(() => {
    let list = [...projects];
    if (filterMode === 'starred') list = list.filter(p => starredIds.has(p.id));else if (filterMode === 'hasMp') list = list.filter(p => p.mpSaving);else if (filterMode === 'hasDeliverable') list = list.filter(p => p.deliverable);else if (filterMode === 'missing') list = list.filter(p => !p.deliverable && !p.mpSaving);
    if (sortConfig.key) {
      const {
        key,
        direction
      } = sortConfig;
      const factor = direction === 'asc' ? 1 : -1;
      list.sort((a, b) => {
        if (key === 'mpSaving') {
          const parseMp = val => {
            if (!val) return -1;
            const num = parseFloat(String(val).replace(/[^0-9.-]+/g, ""));
            return isNaN(num) ? -1 : num;
          };
          return (parseMp(a.mpSaving) - parseMp(b.mpSaving)) * factor;
        } else if (key === 'category') {
          return String(a.category || '').localeCompare(String(b.category || ''), 'zh-TW') * factor;
        } else if (key === 'type') {
          return String(a.type || '').localeCompare(String(b.type || ''), 'zh-TW') * factor;
        } else if (key === 'name') {
          return String(a.name || '').localeCompare(String(b.name || ''), 'zh-TW') * factor;
        } else if (key === 'owner') {
          return String(a.owner || '').localeCompare(String(b.owner || ''), 'zh-TW') * factor;
        } else if (key === 'deliverable') {
          const hasA = a.deliverable ? 1 : 0;
          const hasB = b.deliverable ? 1 : 0;
          if (hasA !== hasB) return (hasA - hasB) * factor;
          return String(a.deliverable || '').localeCompare(String(b.deliverable || ''), 'zh-TW') * factor;
        } else if (key === 'nid') {
          return String(a.nid || '').localeCompare(String(b.nid || ''), 'zh-TW', {
            numeric: true
          }) * factor;
        }
        return 0;
      });
    }
    return list;
  }, [projects, filterMode, sortConfig]);

  // 空狀態要列出的條件 = App 層的(搜尋/類型/成員)＋ 本頁 KPI 卡片的篩選。
  // KPI 卡片就在畫面上,但選中的是深色實心卡、清單卻空著,不講的話使用者只會覺得「資料不見了」。
  const KPI_LABELS = {
    starred: '重點關注項目',
    hasMp: '具備 MP Saving',
    hasDeliverable: '有具體產出成果',
    missing: '待補充產出效益'
  };
  const emptyFilters = [...activeFilters, ...(filterMode !== 'all' ? [{
    key: 'kpi',
    label: `KPI 卡片「${KPI_LABELS[filterMode]}」`,
    clearLabel: '清除 KPI 卡片篩選',
    clear: () => setFilterMode('all')
  }] : [])];

  // 匯出目前顯示的清單(套用中的篩選與排序)為 Excel — 高階主管離線(車上)瀏覽用
  const exportExcel = async () => {
    if (exporting) return;
    setExporting(true);
    setExportFailed(false);
    try {
      const res = await fetch(`${API_BASE}/api/results-excel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          year,
          projectIds: displayedProjects.map(p => p.id)
        })
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `成果清單_${year}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportFailed(true);
    } finally {
      setExporting(false);
    }
  };

  // 表頭渲染輔助函式（強制 whitespace-nowrap 不換行）
  // 鍵盤:th 用 clickable(role:null) 保留原生 columnheader 語意——欄位名由 th 內文提供,
  //       排序狀態由 aria-sort 播報;改成 role="button" 反而會失去「這是欄位標題」的語意。
  // ⚠ 表頭底色必須掛在 th 自己身上,不可用 tr 的 [&>th]:bg-xxx 任意變體(2026-08-09 修):
  //   ①任意變體產生的是獨立選擇器 .[&>th]:bg-slate-100>th,`.dark .bg-slate-100` 匹配不到 →
  //     深色下表頭停在淺色 #F1F5F9,配 text-slate-700 的深色值 #CBD5E1 對比只有 1.36(實測)。
  //   ②它的權重(0,1,1)還壓過 th 自己的 bg-blue-100(0,1,0) → 淺色下「已排序」的藍底從來沒顯示過。
  //   sticky thead + border-collapse 下背景本來就要下在 th,只是要下成「th 的類別」而非父層變體。
  const renderSortHeader = (label, key, widthClass, extraClass = "") => {
    const isSorted = sortConfig.key === key;
    const dirIcon = !isSorted ? '↕' : sortConfig.direction === 'asc' ? '▲' : '▼';
    return /*#__PURE__*/React.createElement("th", _extends({}, clickable(() => handleSortHeader(key), null, {
      role: null
    }), {
      "aria-sort": !isSorted ? 'none' : sortConfig.direction === 'asc' ? 'ascending' : 'descending',
      className: `px-3 py-2 cursor-pointer select-none transition hover:bg-slate-200 whitespace-nowrap ${isSorted ? 'bg-blue-100 text-blue-900 border-b-2 border-blue-600' : 'bg-slate-100 text-slate-700'} ${widthClass} ${extraClass}`,
      title: `點擊依「${label}」${!isSorted ? '排序' : sortConfig.direction === 'asc' ? '改為降冪排序' : '改為升冪排序'}`
    }), /*#__PURE__*/React.createElement("div", {
      className: "flex items-center justify-between gap-1"
    }, /*#__PURE__*/React.createElement("span", {
      className: "whitespace-nowrap"
    }, label), /*#__PURE__*/React.createElement("span", {
      className: `text-[11px] px-1 rounded flex-shrink-0 ${isSorted ? 'bg-blue-600 text-white font-black' : 'text-slate-600 font-normal'}`
    }, dirIcon)));
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "px-6 py-3 max-w-[1560px] w-full mx-auto space-y-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex flex-col gap-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between gap-2"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-xs font-bold text-slate-500"
  }, "\u9EDE\u64CA\u4E0B\u65B9 KPI \u6307\u6A19\u5361\u7247\uFF0C\u5373\u53EF\u5FEB\u901F\u5207\u63DB\u6AA2\u8996\u8207\u904E\u6FFE\u6E05\u55AE\uFF1A"), /*#__PURE__*/React.createElement("button", {
    onClick: exportExcel,
    disabled: exporting || displayedProjects.length === 0
    // ⚠ 實心鈕的白字要配 700 級底,不可用 600:白字在 green-600 上只有 3.30、red-600 3.95(實測,皆 <4.5)
    ,
    className: `flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold transition border shadow-sm text-white disabled:opacity-70 disabled:cursor-not-allowed ${exportFailed ? 'bg-red-700 hover:bg-red-600 border-red-800' : 'bg-green-700 hover:bg-green-600 border-green-800'}`,
    title: displayedProjects.length === 0 ? '目前的篩選條件沒有符合的專案，沒有可匯出的內容' : `下載目前顯示的清單（含套用中的篩選與排序，共 ${displayedProjects.length} 案）為 Excel，供離線瀏覽專案項目、具體產出與 MP Saving`
  }, exporting ? '⏳ 產生中…' : exportFailed ? '❌ 匯出失敗，點擊重試' : `⬇️ 匯出 Excel（${displayedProjects.length} 案）`)), /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-2 md:grid-cols-5 gap-4"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setFilterMode('all'),
    className: `p-2.5 rounded-xl border text-left transition flex items-center gap-2.5 ${filterMode === 'all' ? 'bg-[#001F5B] text-white border-[#001F5B] shadow-md ring-2 ring-offset-2 ring-[#001F5B]/30' : 'bg-white text-slate-800 border-slate-300 hover:border-slate-300 hover:bg-slate-50'}`
  }, /*#__PURE__*/React.createElement("div", {
    className: `w-9 h-9 rounded-full flex items-center justify-center text-base font-bold ${filterMode === 'all' ? 'bg-white/10 text-white' : 'bg-slate-100 text-slate-600'}`
  }, "\uD83D\uDCC1"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: `text-xs font-bold ${filterMode === 'all' ? 'text-white' : 'text-slate-500'}`
  }, "\u5168\u90E8\u5C08\u6848"), /*#__PURE__*/React.createElement("div", {
    className: "text-lg font-black"
  }, projects.length, " ", /*#__PURE__*/React.createElement("span", {
    className: `text-xs font-medium ${filterMode === 'all' ? 'text-white' : 'text-slate-500'}`
  }, "\u6848")))), /*#__PURE__*/React.createElement("button", {
    onClick: () => setFilterMode('starred'),
    className: `p-2.5 rounded-xl border text-left transition flex items-center gap-2.5 ${filterMode === 'starred' ? 'bg-amber-700 text-white border-amber-700 shadow-md ring-2 ring-offset-2 ring-amber-700/40' : 'bg-white text-slate-800 border-slate-300 hover:border-amber-300 hover:bg-amber-50/40'}`
  }, /*#__PURE__*/React.createElement("div", {
    className: `w-9 h-9 rounded-full flex items-center justify-center text-base font-bold ${filterMode === 'starred' ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-600'}`
  }, "\u2B50"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: `text-xs font-bold ${filterMode === 'starred' ? 'text-white' : 'text-slate-500'}`
  }, "\u91CD\u9EDE\u95DC\u6CE8\u9805\u76EE"), /*#__PURE__*/React.createElement("div", {
    className: "text-lg font-black"
  }, projects.filter(p => starredIds.has(p.id)).length, " ", /*#__PURE__*/React.createElement("span", {
    className: `text-xs font-medium ${filterMode === 'starred' ? 'text-white' : 'text-slate-500'}`
  }, "\u6848")))), /*#__PURE__*/React.createElement("button", {
    onClick: () => setFilterMode('hasMp'),
    className: `p-2.5 rounded-xl border text-left transition flex items-center gap-2.5 ${filterMode === 'hasMp' ? 'bg-emerald-700 text-white border-emerald-700 shadow-md ring-2 ring-offset-2 ring-emerald-700/40' : 'bg-white text-slate-800 border-slate-300 hover:border-emerald-300 hover:bg-emerald-50/40'}`
  }, /*#__PURE__*/React.createElement("div", {
    className: `w-9 h-9 rounded-full flex items-center justify-center text-base font-bold ${filterMode === 'hasMp' ? 'bg-white/10 text-white' : 'bg-emerald-100 text-emerald-600'}`
  }, "\uD83D\uDCA1"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: `text-xs font-bold ${filterMode === 'hasMp' ? 'text-white' : 'text-slate-500'}`
  }, "\u5177\u5099 MP Saving"), /*#__PURE__*/React.createElement("div", {
    className: "text-lg font-black"
  }, projects.filter(p => p.mpSaving).length, " ", /*#__PURE__*/React.createElement("span", {
    className: `text-xs font-medium ${filterMode === 'hasMp' ? 'text-white' : 'text-slate-500'}`
  }, "\u6848")))), /*#__PURE__*/React.createElement("button", {
    onClick: () => setFilterMode('hasDeliverable'),
    className: `p-2.5 rounded-xl border text-left transition flex items-center gap-2.5 ${filterMode === 'hasDeliverable' ? 'bg-orange-700 text-white border-orange-700 shadow-md ring-2 ring-offset-2 ring-orange-700/40' : 'bg-white text-slate-800 border-slate-300 hover:border-amber-300 hover:bg-amber-50/40'}`
  }, /*#__PURE__*/React.createElement("div", {
    className: `w-9 h-9 rounded-full flex items-center justify-center text-base font-bold ${filterMode === 'hasDeliverable' ? 'bg-white/10 text-white' : 'bg-amber-100 text-amber-600'}`
  }, "\uD83C\uDFAF"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: `text-xs font-bold ${filterMode === 'hasDeliverable' ? 'text-white' : 'text-slate-500'}`
  }, "\u6709\u5177\u9AD4\u7522\u51FA\u6210\u679C"), /*#__PURE__*/React.createElement("div", {
    className: "text-lg font-black"
  }, projects.filter(p => p.deliverable).length, " ", /*#__PURE__*/React.createElement("span", {
    className: `text-xs font-medium ${filterMode === 'hasDeliverable' ? 'text-white' : 'text-slate-500'}`
  }, "/ ", projects.length, " \u6848")))), /*#__PURE__*/React.createElement("button", {
    onClick: () => setFilterMode('missing'),
    className: `p-2.5 rounded-xl border text-left transition flex items-center gap-2.5 ${filterMode === 'missing' ? 'bg-red-700 text-white border-red-700 shadow-md ring-2 ring-offset-2 ring-red-700/40' : 'bg-white text-slate-800 border-slate-300 hover:border-red-300 hover:bg-red-50/40'}`
  }, /*#__PURE__*/React.createElement("div", {
    className: `w-9 h-9 rounded-full flex items-center justify-center text-base font-bold ${filterMode === 'missing' ? 'bg-white/10 text-white' : 'bg-red-100 text-red-600'}`
  }, "\u26A0\uFE0F"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: `text-xs font-bold ${filterMode === 'missing' ? 'text-white' : 'text-slate-500'}`
  }, "\u5F85\u88DC\u5145\u7522\u51FA\u6548\u76CA"), /*#__PURE__*/React.createElement("div", {
    className: "text-lg font-black"
  }, projects.filter(p => !p.deliverable && !p.mpSaving).length, " ", /*#__PURE__*/React.createElement("span", {
    className: `text-xs font-medium ${filterMode === 'missing' ? 'text-white' : 'text-slate-500'}`
  }, "\u6848")))))), sortConfig.key && /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between bg-blue-50 border border-blue-200 px-4 py-2 rounded-xl text-xs font-bold text-blue-900 shadow-sm"
  }, /*#__PURE__*/React.createElement("span", null, "\u76EE\u524D\u5DF2\u5957\u7528\u6B04\u4F4D\u6392\u5E8F (", sortConfig.direction === 'asc' ? '升冪 ▲' : '降冪 ▼', ")"), /*#__PURE__*/React.createElement("button", {
    onClick: () => setSortConfig({
      key: null,
      direction: 'asc'
    }),
    className: "px-3 py-1 rounded-lg bg-white hover:bg-blue-100 text-blue-700 border border-blue-300 font-bold transition shadow-sm"
  }, "\u6E05\u9664\u6392\u5E8F")), /*#__PURE__*/React.createElement("div", {
    className: "bg-white rounded-xl border border-slate-300 shadow-sm"
  }, /*#__PURE__*/React.createElement("table", {
    className: "w-full text-left border-collapse table-fixed"
  }, /*#__PURE__*/React.createElement("thead", {
    className: "sticky top-0 z-20"
  }, /*#__PURE__*/React.createElement("tr", {
    className: "bg-slate-100 text-xs font-bold border-b border-slate-300 h-9 [&>th:first-child]:rounded-tl-xl [&>th:last-child]:rounded-tr-xl"
  }, /*#__PURE__*/React.createElement("th", {
    className: "px-2 w-10 text-center bg-slate-100 text-slate-600 whitespace-nowrap"
  }, "No"), renderSortHeader("分類", "category", "w-20"), renderSortHeader("類型", "type", "w-14 text-center"), renderSortHeader("專案名稱", "name", "w-[300px]"), renderSortHeader("負責人", "owner", "w-24"), renderSortHeader("預計交付具體產出成果", "deliverable", "w-auto"), renderSortHeader("MP Saving", "mpSaving", "w-28"), renderSortHeader("NID", "nid", "w-[200px]"))), /*#__PURE__*/React.createElement("tbody", {
    className: "divide-y divide-slate-200 text-[13px]"
  }, displayedProjects.map((proj, idx) => {
    const cleanDeliverable = proj.deliverable ? String(proj.deliverable).replace(/[\r\n]+/g, ' ') : '';
    return /*#__PURE__*/React.createElement("tr", {
      key: proj.id,
      className: "hover:bg-blue-50/40 transition [&>td]:align-top"
    }, /*#__PURE__*/React.createElement("td", {
      className: "px-3 py-1 text-center text-slate-500 font-medium whitespace-nowrap truncate"
    }, idx + 1), /*#__PURE__*/React.createElement("td", {
      className: "px-3 py-1 whitespace-nowrap truncate text-slate-800 font-semibold",
      title: proj.category
    }, proj.category || '--'), /*#__PURE__*/React.createElement("td", {
      className: "px-1 py-1 text-center whitespace-nowrap"
    }, /*#__PURE__*/React.createElement("span", {
      className: `inline-block px-1.5 py-0.5 rounded text-[11px] font-extrabold border ${PROJECT_TYPES[proj.type]?.chip || 'bg-slate-100 text-slate-600 border-slate-300'}`,
      title: PROJECT_TYPES[proj.type]?.label
    }, proj.type?.toUpperCase() || '--')), /*#__PURE__*/React.createElement("td", {
      className: "px-3 py-1 font-bold text-slate-900 text-[14px]",
      title: proj.name
    }, /*#__PURE__*/React.createElement("div", {
      className: "flex items-start"
    }, role === 'manager' ?
    /*#__PURE__*/
    // ⚠ 熱區靠 padding 撐開,不能只放一個字元:★ 本身只有 13×24(WCAG 2.5.8 AA 要 24×24),
    //   而它是主管標記重點專案的唯一入口,又坐在 24px 高的密集列裡緊貼專案名稱,很容易點歪。
    //   `-ml-1.5` 抵銷左內距、右內距取代原本的 mr-1.5 → 版面位置與加大前完全一樣。
    // ⚠ 未標記態用 slate-500 不用 slate-400:後者投影 50:1 只有 4.13(本專案基準 4.5),
    //   而這是可點擊的控制項,不是純裝飾。
    React.createElement("button", {
      onClick: e => toggleStar && toggleStar(proj.id, e)
      // ★ 用 amber-600 不用 amber-500:後者(#F59E0B)在白底上只有 2.15,連圖形物件的 3:1 都不到。
      // amber-600 淺色 3.14、深色因 .dark .text-amber-600→#FCD34D 反而更亮,兩邊都看得見金星。
      ,
      className: `flex-shrink-0 -ml-1.5 px-1.5 py-1 leading-none text-base transition transform hover:scale-125 ${starredIds.has(proj.id) ? 'text-amber-600' : 'text-slate-500 hover:text-amber-400'}`,
      "aria-pressed": starredIds.has(proj.id),
      "aria-label": `${proj.name}：${starredIds.has(proj.id) ? '取消重點關注標記' : '標記為重點關注項目'}`,
      title: starredIds.has(proj.id) ? '取消重點關注標記' : '標記為重點關注項目'
    }, starredIds.has(proj.id) ? '★' : '☆') : starredIds.has(proj.id) ? /*#__PURE__*/React.createElement("span", {
      className: "flex-shrink-0 mr-1.5 text-base text-amber-600",
      title: "\u91CD\u9EDE\u95DC\u6CE8\u9805\u76EE"
    }, "\u2605") : null, /*#__PURE__*/React.createElement("span", {
      className: "whitespace-normal break-words leading-snug"
    }, proj.name))), /*#__PURE__*/React.createElement("td", {
      className: "px-3 py-1 whitespace-nowrap"
    }, /*#__PURE__*/React.createElement("span", {
      className: "inline-flex items-center px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-bold whitespace-nowrap"
    }, proj.owner)), /*#__PURE__*/React.createElement("td", {
      className: "px-4 py-1"
    }, cleanDeliverable ? /*#__PURE__*/React.createElement("div", {
      className: "text-slate-800 font-semibold whitespace-normal break-words leading-snug"
    }, cleanDeliverable) : /*#__PURE__*/React.createElement("span", {
      className: "text-slate-500 font-light",
      "aria-hidden": "true"
    }, "\u2014")), /*#__PURE__*/React.createElement("td", {
      className: "px-3 py-1 align-top overflow-hidden"
    }, proj.mpSaving ? /*#__PURE__*/React.createElement("span", {
      className: "inline-block max-w-full px-2 py-0.5 rounded text-[13px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 break-words leading-snug"
    }, proj.mpSaving) : /*#__PURE__*/React.createElement("span", {
      className: "text-slate-500 font-light",
      "aria-hidden": "true"
    }, "\u2014")), /*#__PURE__*/React.createElement("td", {
      className: "px-3 py-1 align-top",
      title: proj.nid || ''
    }, proj.nid ? /*#__PURE__*/React.createElement("div", {
      className: "flex flex-wrap gap-1"
    }, String(proj.nid).split(/[、,，;；\s]+/).filter(Boolean).map((n, i) => /*#__PURE__*/React.createElement("span", {
      key: i,
      className: "inline-block px-1 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold border border-slate-300 whitespace-nowrap"
    }, n))) : /*#__PURE__*/React.createElement("span", {
      className: "text-slate-500 font-light",
      "aria-hidden": "true"
    }, "\u2014")));
  }), displayedProjects.length === 0 && /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
    colSpan: 8,
    className: "text-center text-slate-500 font-medium"
  }, /*#__PURE__*/React.createElement(EmptyFilterState, {
    filters: emptyFilters,
    onClearAll: () => {
      setFilterMode('all');
      onClearAllFilters && onClearAllFilters();
    },
    emptyNote: `${year} 年度目前沒有專案項目。`
  })))))));
}
function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [role, setRole] = useState(null);
  const [currentWeek, setCurrentWeek] = useState(DEFAULT_CURRENT_WEEK);
  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState(null);
  const [empId, setEmpId] = useState(null); // Windows 工號(顯示用;實際寫入由 apiPost 自動附帶)
  // 瀏覽權限卡控:null=檢查中;{enabled,allowed,reason,person}=結果。開關關閉時後端直接回 allowed=true。
  const [accessCheck, setAccessCheck] = useState(null);
  // 權限檢查逾時:畫面被 `if (!accessCheck) return <LoadingScreen/>` 擋住,沒有逾時就會**永久轉圈且無任何提示**
  // (fetch 對「連得上但伺服器不回應」不會 reject,例如 IIS 正在回收應用程式集區)。
  // ⚠ 逾時**不比照下面的 catch 直接放行**:catch 是「明確被拒絕/連不上」,而逾時是「不知道伺服器怎麼了」——
  //    未知狀態下自動放行等於把權限閘門變成裝飾。改為顯示錯誤畫面＋重試,維持 fail-closed。
  const [accessError, setAccessError] = useState(null);
  const [accessRetry, setAccessRetry] = useState(0);

  // 載入時偵測一次 Windows 工號(非網域環境取不到 → null),接著向後端驗證瀏覽權限
  React.useEffect(() => {
    let cancelled = false;
    setAccessError(null);
    detectEmpId().then(async id => {
      if (cancelled) return;
      setEmpId(id);
      try {
        const r = await apiGet(`/api/access-check?empId=${encodeURIComponent(id || '')}`, {
          timeoutMs: 15000
        });
        if (!cancelled) setAccessCheck(r);
      } catch (e) {
        if (cancelled) return;
        if (e && e.name === 'AbortError') {
          setAccessError('伺服器沒有在時間內回應權限檢查（可能正在重啟）。');
          return;
        }
        // 只有「連不上」(fetch 本身丟 TypeError:ERR_CONNECTION_REFUSED／斷網)才放行——那時 bootstrap 也連不上,
        // 會另行顯示連線錯誤畫面,這裡擋不擋沒差。
        // ⚠ 伺服器有回應但是 4xx/5xx(apiGet 包成 Error)是「檢查失敗」不是「連不上」:原本一律放行,等於
        //    AccessRules 查詢炸掉時卡控自動失效(fail-open)。改成錯誤畫面＋重試,與逾時同樣維持 fail-closed。
        if (e instanceof TypeError) {
          setAccessCheck({
            enabled: false,
            allowed: true
          });
          return;
        }
        setAccessError('權限檢查失敗：' + (e.message || '伺服器回應錯誤') + '。');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [accessRetry]);

  // 年度切換:可用年度與週→月對照皆來自 DB 的 ScheduleWeeks(開新年度只需 EXEC usp_EnsureScheduleYear)
  const [scheduleYear, setScheduleYear] = useState(DEFAULT_SCHEDULE_YEAR);
  const [years, setYears] = useState([]);
  const [months, setMonths] = useState(MONTHS);
  const weeksTotal = useMemo(() => months.reduce((s, m) => s + m.weeks, 0), [months]);

  // 群組名稱(2026-09-13 多站台):同一份程式發佈到 /Gantt、/Gantt_IMD…,後端依 IIS application 路徑從 appsettings 的
  // Sites 段落回「MSD／IMD／EMS1…」。原本寫死「MSD」共 6 處(登入頁、header、分頁標題、未授權文案),全改吃這個值。
  // /api/site 不碰 DB,DB 連不上時標題也是對的;取不到就顯示不帶群組的「專案追蹤總表」。
  const [siteName, setSiteName] = useState('');
  React.useEffect(() => {
    apiGet('/api/site').then(r => {
      if (r && r.groupName) setSiteName(r.groupName);
    }).catch(() => {});
  }, []);
  const siteTitle = siteName ? `${siteName} 專案追蹤總表` : '專案追蹤總表';

  // 分頁標題帶目前週次(多分頁好辨識);非今年年度再帶年份;未登入維持原名
  React.useEffect(() => {
    if (!currentUser) {
      document.title = siteTitle;
      return;
    }
    const prefix = scheduleYear !== getTodayScheduleYear() ? `${scheduleYear} ` : '';
    document.title = `${prefix}W${String(currentWeek).padStart(2, '0')}｜${siteTitle}`;
  }, [currentUser, currentWeek, scheduleYear, siteTitle]);

  // UI 狀態(範本 B:預設寬鬆模式,字級較大對年長者友善)
  const [isDark, setIsDark] = useState(() => readPrefs().dark === true); // 深色模式偏好:重整後沿用(這台電腦)
  React.useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    savePref('dark', isDark);
  }, [isDark]);
  const [isCompact, setIsCompact] = useState(() => readPrefs().compact === true); // 緊湊模式偏好:重整後沿用
  const [isOverview, setIsOverview] = useState(false); // 年度總覽:52 週自動縮放進一個畫面寬,無水平捲軸(唯讀瀏覽視角)
  const [isResults, setIsResults] = useState(false); // 成果清單:集中檢閱所有專案具體成果項目與 MP 節省統計
  const [collapsedOwners, setCollapsedOwners] = useState(new Set());
  // 子區間列的展開/收合(遷移 18)。預設值依檢視而異:
  //   週檢視=有子區間就展開(主管要看的就是這個);年度總覽=收合(「整年一畫面」是核心前提,69 案再各加幾列會撐長)。
  // 兩邊各記「偏離預設」的專案 id 並持久化到 gantt_prefs:主管收過的下次開還是收的。
  const [subCollapsedWeek, setSubCollapsedWeek] = useState(() => new Set(readPrefs().subCollapsed || []));
  const [subExpandedOverview, setSubExpandedOverview] = useState(() => new Set(readPrefs().subExpandedOv || []));
  // 搜尋命中子區間名稱的專案一律視為展開(subSearchHits 在下方篩選區宣告;只在 render 時呼叫,不會踩到 TDZ)
  const isSubExpanded = projId => subSearchHits.has(projId) || (isOverview ? subExpandedOverview.has(projId) : !subCollapsedWeek.has(projId));
  const toggleSubExpanded = projId => {
    if (isOverview) {
      setSubExpandedOverview(prev => {
        const n = new Set(prev);
        n.has(projId) ? n.delete(projId) : n.add(projId);
        savePref('subExpandedOv', [...n]);
        return n;
      });
    } else {
      setSubCollapsedWeek(prev => {
        const n = new Set(prev);
        n.has(projId) ? n.delete(projId) : n.add(projId);
        savePref('subCollapsed', [...n]);
        return n;
      });
    }
  };
  // 全域「子區間 ▾｜▸」(工具列「展開｜收合」旁):一案一案按 ▾ n 太慢(每案 3 條子區間＝表格高度翻三倍)。
  // 兩份 prefs 記的是「偏離預設」:週檢視預設展開 → 全收＝把所有帶子區間的案子塞進 subCollapsed;
  // 年度總覽預設收合 → 全展＝把它們塞進 subExpandedOv。另一個方向都是清空。
  const setAllSubExpanded = expanded => {
    const withSubs = projects.filter(p => p.tasks.some(t => (t.subs || []).length > 0)).map(p => p.id);
    if (isOverview) {
      const n = new Set(expanded ? withSubs : []);
      setSubExpandedOverview(n);
      savePref('subExpandedOv', [...n]);
    } else {
      const n = new Set(expanded ? [] : withSubs);
      setSubCollapsedWeek(n);
      savePref('subCollapsed', [...n]);
    }
  };
  const [searchText, setSearchText] = useState('');
  const [typeFilter, setTypeFilter] = useState(new Set()); // 空 = 全部
  // 成員篩選:三個檢視統一用「成員下拉」('all' 或成員名),不再有週檢視專用的「只看我的專案」勾選框
  // ——同一件事兩種操作方式(勾選 vs 下拉)會讓使用者切檢視時以為篩選跑掉了。
  // 登入預設:成員=自己、主管=全部成員(見 handleLogin / DEFAULT_OWNER_FILTER)
  const [ownerFilter, setOwnerFilter] = useState('all');
  // 重點關注標記：從 bootstrap 資料初始化（DB 持久化），不再使用 localStorage
  const [starredIds, setStarredIds] = useState(() => new Set());
  const toggleStar = useCallback(async (projId, e) => {
    if (e) e.stopPropagation();
    // 立即同步判定目標值，避免 React state 批次更新回呼延遲導致 newStarred 為 undefined
    const newStarred = !starredIds.has(projId);
    setStarredIds(prev => {
      const next = new Set(prev);
      if (newStarred) next.add(projId);else next.delete(projId);
      return next;
    });
    // 同步更新 projects 內的 isStarred，確保重整後 starredIds 能正確重建
    setProjects(prev => prev.map(p => p.id === projId ? {
      ...p,
      isStarred: newStarred
    } : p));
    try {
      await apiPost('/api/project/star', {
        projectId: projId,
        starred: newStarred,
        actor: currentUser,
        actorRole: role
      });
    } catch (err) {
      // 若後端失敗，rollback 畫面狀態
      setStarredIds(prev => {
        const next = new Set(prev);
        if (newStarred) next.delete(projId);else next.add(projId);
        return next;
      });
      setProjects(prev => prev.map(p => p.id === projId ? {
        ...p,
        isStarred: !newStarred
      } : p));
      // 全站錯誤一律走 toast(原本這裡是唯一一個 window.alert:會阻斷操作、樣式與深色模式脫節)。
      // ⚠ showToast 刻意**不放進 deps**:它宣告在本 useCallback 之後(見下方 useState 區),
      //   寫進 deps 陣列會在 render 當下就踩到 TDZ;而它只用到 setToast/toastTimer 這種穩定參考,
      //   閉包抓到舊的那份行為完全一致,不會有 stale 問題。
      showToast('❌ 標記失敗：' + (err.message || '無法連線資料庫'));
    }
  }, [currentUser, role, starredIds]);
  const [tooltip, setTooltip] = useState(null); // {x, y, proj, task, weekLog, history}
  const ganttRef = useRef(null);

  // 紀錄打卡、非專案工作與下週預計
  const [taskLogs, setTaskLogs] = useState({});
  const [subLogs, setSubLogs] = useState({}); // subLogs[subId][week] = 對子區間的回報(遷移 20;格式同 taskLogs)
  const [extraNotes, setExtraNotes] = useState({});
  const [weeklyPlans, setWeeklyPlans] = useState({}); // weeklyPlans[user][week] = 下週預計執行工作(填寫於該週)
  const [weeklyComments, setWeeklyComments] = useState({}); // weeklyComments[user][week] = 主管週報回覆(選填,全員可見)
  // 各表的最後編輯資訊 meta[user][week] = { by, byRole, at }(與內容字典並列,避免改動既有字串結構)
  const [extraNoteMeta, setExtraNoteMeta] = useState({});
  const [weeklyPlanMeta, setWeeklyPlanMeta] = useState({});
  const [weeklyCommentMeta, setWeeklyCommentMeta] = useState({});
  const [allowRetroCheckin, setAllowRetroCheckin] = useState(false); // 主管全域開關：允許成員回報/調正歷史進度
  const [subCheckinEnabled, setSubCheckinEnabled] = useState(false); // 子區間打卡開關(來自 appsettings.json,顯示用;判斷一律走 SUB_CHECKIN/weekUnits)

  // --- 同步狀態(給「連線中斷」指示用) ---
  // 原本 60 秒輪詢是 `refreshData().catch(() => {})`,後端重啟/斷網時畫面就停在舊資料、**完全沒有提示**
  // (實測連續 31 次 ERR_CONNECTION_REFUSED,畫面毫無異狀)。使用者會看著過期資料做判斷,
  // 直到按下儲存才發現失敗——而那時他已經是用舊資料覆蓋新值(last-write-wins)。
  // 計數與時間戳直接埋在 refreshData 裡,所有呼叫點(輪詢、存檔後刷新、關窗補刷)自動涵蓋。
  const [syncFailures, setSyncFailures] = useState(0); // 連續失敗次數(成功即歸零)
  const [lastSyncAt, setLastSyncAt] = useState(null); // 最後一次成功同步的時間

  // 最近一次載入完成的年度(切年度時把系統週切到該年度的本週用;見 refreshData 尾段)
  const loadedYearRef = useRef(null);
  // 重新抓取資料但不顯示整頁 Loading (供編輯後靜默刷新)
  const refreshData = useCallback(async () => {
    let data;
    try {
      data = await apiGet(`/api/bootstrap?year=${scheduleYear}`);
    } catch (e) {
      setSyncFailures(n => n + 1);
      throw e; // ⚠ 一定要往外拋:loadBootstrap 靠這個 throw 才顯示 ErrorScreen + 重試
    }
    setSyncFailures(0);
    setLastSyncAt(new Date());
    // 若選定年度在 DB 沒有週資料(如今年尚未 EnsureScheduleYear),退回最近的可用年度重載
    if ((!data.weeks || data.weeks.length === 0) && (data.years || []).length > 0 && !data.years.includes(scheduleYear)) {
      setScheduleYear(data.years[data.years.length - 1]);
      return;
    }
    setUsers((data.users || []).filter(u => u.role === 'member').map(u => u.name));
    setProjects(data.projects || []);
    // 從 DB 資料同步重點關注標記（isStarred 存於 DB，全員共享）
    setStarredIds(new Set((data.projects || []).filter(p => p.isStarred || p.IsStarred).map(p => p.id ?? p.Id)));
    SUB_CHECKIN = data.subCheckinEnabled === true; // 一定在 setState 之前:同一批資料同一個旗標(見 weekUnits 說明)
    setSubCheckinEnabled(SUB_CHECKIN);
    setTaskLogs(data.taskLogs || {});
    setSubLogs(data.subLogs || {});
    setExtraNotes(data.extraNotes || {});
    setWeeklyPlans(data.weeklyPlans || {});
    setWeeklyComments(data.weeklyComments || {});
    setExtraNoteMeta(data.extraNoteMeta || {});
    setWeeklyPlanMeta(data.weeklyPlanMeta || {});
    setWeeklyCommentMeta(data.weeklyCommentMeta || {});
    if (typeof data.allowRetroCheckin === 'boolean') setAllowRetroCheckin(data.allowRetroCheckin);
    if (data.years && data.years.length) setYears(data.years);
    if (data.weeks && data.weeks.length) setMonths(groupWeeksToMonths(data.weeks));
    // 換了年度(含首次載入、退回可用年度)才把系統週切到該年度的「本週」並置中。
    // ⚠ 要在這裡而不是年度下拉的 onChange:該年度有幾週(52/53)要等 bootstrap 回來才知道,
    //   在 onChange 用預設 52 算會讓 53 週年度的 W53 落成 W52;而且這裡才有辦法連 scrollTargetWeek 一起做。
    //   用 loadedYearRef 比對,60 秒輪詢刷新同一年度不會動使用者選好的週。
    if (loadedYearRef.current !== data.year) {
      loadedYearRef.current = data.year;
      const tw = getTodayWeek(data.year, (data.weeks || []).length || WEEKS_TOTAL);
      setCurrentWeek(tw);
      setScrollTargetWeek(tw);
    }
  }, [scheduleYear]);

  // 從後端載入全部資料 (使用者 / 專案 / 打卡 / 非專案事項)
  const loadBootstrap = useCallback(async () => {
    setDataLoading(true);
    setDataError(null);
    try {
      await refreshData();
    } catch (e) {
      setDataError(e.message || '無法連線資料庫');
    } finally {
      setDataLoading(false);
    }
  }, [refreshData]);
  React.useEffect(() => {
    loadBootstrap();
  }, [loadBootstrap]);
  const [selectedTaskInfo, setSelectedTaskInfo] = useState(null);
  // 團隊總結看板點成員回報格 → 左側甘特圖對應區間暫時淺藍高亮(提示「正在講哪一項」),再點/關看板/點別處即還原
  const [highlightedTaskId, setHighlightedTaskId] = useState(null);
  // 高亮的回報單位(2026-09-13):看板一張卡＝一個回報單位,點子區間的卡只亮**那條子條**(subId 有值),
  // 點計畫區間的卡(父層/legacy)只亮父條(subId null)。原本只記 taskId,點子區間會把父條＋全部子條一起亮成一組,
  // 使用者:「我點亮子區間,應該只顯示子區間排程」。
  const [highlightedSubId, setHighlightedSubId] = useState(null);
  const clearHighlight = () => {
    setHighlightedTaskId(null);
    setHighlightedSubId(null);
  };
  const [showExtraNoteModal, setShowExtraNoteModal] = useState(false);
  const [showWeeklyPlanModal, setShowWeeklyPlanModal] = useState(false); // 下週預計執行工作
  // Toast:成功 2.5 秒;錯誤(訊息以 ❌ 開頭自動判定)停 6 秒且可手動關閉;
  // opts.action={label,onClick} 顯示動作鈕(如刪除後的「復原」),此時停留 opts.duration(預設 10 秒)
  const [toast, setToast] = useState(null); // { msg, isError, action? }
  const toastTimer = useRef(null);
  const showToast = (msg, opts = {}) => {
    const isError = opts.type === 'error' || msg.startsWith('❌');
    setToast({
      msg,
      isError,
      action: opts.action || null
    });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    const duration = opts.duration ?? (opts.action ? 10000 : isError ? 6000 : 2500);
    toastTimer.current = setTimeout(() => setToast(null), duration);
  };
  const dismissToast = () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(null);
  };
  const [showWeeklyReport, setShowWeeklyReport] = useState(false);
  const [showPendingPanel, setShowPendingPanel] = useState(false);
  const [showRetroPanel, setShowRetroPanel] = useState(false); // 成員:補登面板(修改檢視中之非當週回報;需主管開放補登)
  const [showWeekEditPanel, setShowWeekEditPanel] = useState(false); // 主管:週次回報編輯面板(代成員補登/修正檢視中週次)
  const [noteTargetUser, setNoteTargetUser] = useState(null); // 主管代編「非專案/下週預計」的目標成員(null=編輯自己的)
  const [showAuditPanel, setShowAuditPanel] = useState(false); // 主管:異動紀錄(AuditLog)面板
  const [showMemberPanel, setShowMemberPanel] = useState(false); // 主管:成員管理面板
  const [showAccessPanel, setShowAccessPanel] = useState(false); // 主管:瀏覽權限卡控面板(遷移 11)
  const [showUsagePanel, setShowUsagePanel] = useState(false); // 主管:使用統計面板(登入次數,遷移 13)
  const [showAdminMenu, setShowAdminMenu] = useState(false); // 主管:header「⚙️ 管理」下拉選單(收納低頻管理入口)
  const [adminMenuPos, setAdminMenuPos] = useState({
    top: 0,
    right: 0
  }); // fixed 定位座標(選單本體放在 header 外,見 2026-09-16 註解)
  const [showDisplayMenu, setShowDisplayMenu] = useState(false); // 工具列「顯示 ▾」下拉(展開/收合全部成員群組、子區間)
  const [displayMenuPos, setDisplayMenuPos] = useState({
    top: 0,
    right: 0
  }); // fixed 定位座標(工具列是 overflow 容器,absolute 會被裁掉)
  const [showDeadlinePanel, setShowDeadlinePanel] = useState(false); // 即將到期清單面板(頂部 ⏰ 晶片點開)

  // 版面自適應:凍結欄與右側團隊看板寬度隨視窗縮放,投影機/筆電才留得下中間甘特區(1920 時＝原本的 420/490/672)
  const viewportW = useViewportWidth();
  // 看板寬度:再夾一道「不得超過視窗 45%」,避免小視窗下甘特被壓成一條
  const reportPanelW = Math.round(Math.min(reportPanelWidth(viewportW), viewportW * 0.45));
  const availW = viewportW - (showWeeklyReport ? reportPanelW : 0); // 主內容區可用寬(看板開啟時已內縮)
  // 工具列是否要收起「找資料」那組。收的內容沿用既有那組:
  // 概況列=全隊狀態晶片＋鍵盤提示;控制列=搜尋框＋a~e 晶片(有殘留篩選條件時仍保留已選中的)。
  // ⚠ 兩個條件是 OR 而不是只留寬度那個——看板開啟時要收**另有情境上的理由**,與空間無關:
  //   全隊狀態晶片在看板裡已被每人的分段條拆得更細(重複資訊)、講評當下也不會臨時改篩選條件。
  //   只寫 `availW < …` 的話,2560 這種寬螢幕開看板時 availW=1888 仍大於門檻,它們會全部跑回來。
  // ⚠ 「⏰ 即將到期」不列入:它在看板情境被收是因為「會開另一個面板跳出講評情境」,
  //   視窗窄跟那個理由無關,而它是行動項,所以維持只看 showWeeklyReport。
  const tightStatsBar = showWeeklyReport || availW < STATS_BAR_FULL_W;
  const tightToolbar = showWeeklyReport || availW < TOOLBAR_FULL_W;
  // 概況列已收無可收(剩下的三塊都不能刪)、但寬度仍不夠時的最後一手:縮間距與進度條(見 STATS_BAR_MIN_W)。
  // 只看 availW,不看 showWeeklyReport —— 1366 以上就算開著看板也放得下,不需要縮。
  const ultraTightStatsBar = availW < STATS_BAR_MIN_W;
  // 概況列左側「有執行／Monitor／未執行」三顆統計晶片是否在畫面上:在 → 右側圖例不再重畫這三個色點(晶片本身就是圖例);
  // 收起(看板開啟／窄螢幕)→ 圖例補回,讀圖必需的資訊任何情況都在。
  const statusChipsVisible = !showWeeklyReport && !tightStatsBar;
  // 圖例的「子區間」格只在資料裡真的有子區間時顯示(見圖例處的說明)
  const hasAnySubs = useMemo(() => projects.some(p => p.tasks.some(t => (t.subs || []).length > 0)), [projects]);
  // 年度總覽的名稱欄:原本寫死 240,1920 下明明還有空間卻不用 → 22% 的名稱被截(週檢視只有 1%)。
  // 改成「把剩餘空間讓給名稱欄,但先保證每個週欄至少 MIN_OVERVIEW_WEEK_W」,
  // 整年仍在同一畫面(表格 width:100%,週欄只是變窄,不會產生水平捲軸);
  // 上限沿用週檢視的 nameColWidth(切換兩個檢視時名稱欄不跳動),下限維持原本的 240 → 任何情況都不比現況差。
  const overviewNameW = Math.round(Math.max(240, Math.min(nameColWidth(viewportW), availW - weeksTotal * MIN_OVERVIEW_WEEK_W)));
  const nameW = isOverview ? overviewNameW : nameColWidth(viewportW);
  const frozenW = isOverview ? nameW : STICKY_LEAD_W + nameW; // 甘特左側凍結區總寬(捲動置中的基準)
  // 週檢視的週欄寬:寬鬆固定 32(本來就要橫向捲);緊湊原本固定 22 → 1926 寬時 53 週只佔 1166、加凍結欄 490 才 1656,
  // 右側 ~230px 什麼都沒放。改成「整年塞得下就把剩餘寬度分給週欄」(與年度總覽名稱欄同一種思路):
  // 1926 → 26px(條內名稱截斷變少、格子點擊區變大)、1366 算出 18 → 夾回 22 照舊橫向捲、開看板 availW 變小自動退回。
  // 上限 32＝寬鬆值(緊湊不可比寬鬆寬);扣 SCROLLBAR_W 是垂直捲軸,少扣會多出 1~2px 吐一條橫向捲軸。
  // 凍結欄一律用週檢視的寬(不吃 isOverview)——總覽不用 weekW,但 ←→ 平移量吃它,切檢視時不要跳值。
  const fitWeekW = Math.floor((availW - (STICKY_LEAD_W + nameColWidth(viewportW)) - SCROLLBAR_W) / weeksTotal);
  const weekW = isCompact ? Math.min(WEEK_W_RELAXED, Math.max(WEEK_W_COMPACT_MIN, fitWeekW)) : WEEK_W_RELAXED;
  // 年度總覽的週欄寬度是「剩餘空間 ÷ 週數」(非固定 weekW);太窄時 53 個數字會擠成一片,
  // 故 <16px 只標 5 的倍數與當週(格子本身仍可點,hover/title 不變)
  const overviewWeekW = isOverview ? (availW - frozenW) / weeksTotal : 0;
  const sparseWeekLabel = isOverview && overviewWeekW < 16;
  const todayWeek = getTodayWeek(scheduleYear, weeksTotal); // 本週(相對於選定年度;非本年度時夾在 1 或最後一週)
  // 檢視中週次與「今天」的關係,三個旗標全站共用(2026-09-12 修):
  //   原本各處直接比 currentWeek 與 todayWeek,但 todayWeek 在別的年度只是被夾到邊界的值——
  //   成員切到 2027 會看到「本週回報中心 1」在催 2027 W01 的下週預計(送出被後端 400);
  //   到了 2027 切回 2026,W53 又變成「本週」,不用補登權限就能寫去年的回報。
  //   非本年度沒有「本週」:整年不是過去就是未來,回報入口一律收起。
  const todayYear = getTodayScheduleYear();
  const isCurrentYear = scheduleYear === todayYear;
  const isFutureWeek = scheduleYear > todayYear || isCurrentYear && currentWeek > todayWeek; // 尚未到:誰都不能寫(後端同樣擋)
  const isReportingWeek = isCurrentYear && currentWeek === todayWeek; // 成員「本週回報」的唯一目標週
  const isViewingPast = !isReportingWeek; // 是否在檢視非本週(含非本年度)

  // 團隊看板點回報格 → 展開該成員群組、捲到該列與當前週(靠左避開右側面板)、暫時高亮該區間;再點同項=取消
  const [pendingScrollProj, setPendingScrollProj] = useState(null); // 觸發「捲到該列+當前週」的 effect(用 effect 而非 rAF,嵌入式瀏覽器較可靠)
  const handleHighlightTask = useCallback((proj, task, sub = null) => {
    const subId = sub?.id ?? null;
    const willClear = highlightedTaskId === task.id && highlightedSubId === subId;
    setHighlightedTaskId(willClear ? null : task.id);
    setHighlightedSubId(willClear ? null : subId);
    if (willClear) return;
    // 子區間的卡 → 該專案的子列要展開(走與 ▾ n 晶片同一份 prefs),否則亮的那條在收合狀態下根本看不到
    if (subId != null) {
      if (isOverview) setSubExpandedOverview(prev => {
        const n = new Set(prev);
        n.add(proj.id);
        savePref('subExpandedOv', [...n]);
        return n;
      });else setSubCollapsedWeek(prev => {
        const n = new Set(prev);
        n.delete(proj.id);
        savePref('subCollapsed', [...n]);
        return n;
      });
    }
    setCollapsedOwners(prev => {
      const s = new Set(prev);
      s.delete(proj.owner);
      return s;
    });
    // 聚焦執行者:左側甘特只留這位成員的專案,主管講評時不被其他人的列干擾(關閉看板即還原登入預設)
    setOwnerFilter(proj.owner);
    setPendingScrollProj(proj.id);
  }, [highlightedTaskId, highlightedSubId, isOverview]);

  // 關閉團隊看板:清除高亮與成員聚焦,甘特還原為「登入預設成員 ＋ 全部展開」
  const closeWeeklyReport = useCallback(() => {
    setHighlightedTaskId(null);
    setHighlightedSubId(null);
    setShowWeeklyReport(false);
    setOwnerFilter(defaultOwnerFilter(role, currentUser));
    setCollapsedOwners(new Set());
  }, [role, currentUser]);

  // 每次登入角色時：預設開啟各成員的週檢視、展開清單頁面；成員預設顯示個人專案，主管預設為全部成員
  // 登入身分寫入 localStorage:重新整理/重開分頁不再被登出(登出時清除;內網固定使用者,風險可接受)
  const handleLogin = (user, selectedRole, source = 'manual') => {
    try {
      localStorage.setItem('gantt_login', JSON.stringify({
        user,
        role: selectedRole
      }));
    } catch (e) {}
    // 使用率統計:每次登入寫一筆 LoginLogs(manual=登入畫面點選/auto=重整自動還原);失敗靜默不影響使用
    apiPost('/api/login-log', {
      userName: user,
      role: selectedRole,
      source
    }).catch(() => {});
    setCurrentUser(user);
    setRole(selectedRole);
    setIsOverview(readPrefs().overview === true); // 檢視偏好:沿用上次的週檢視/年度總覽選擇
    setIsResults(false);
    setCurrentWeek(getTodayWeek(scheduleYear, weeksTotal));
    setCollapsedOwners(new Set());
    setOwnerFilter(defaultOwnerFilter(selectedRole, user)); // 成員=自己、主管=全部成員
    setSearchText('');
    setTypeFilter(new Set());
    setShowPendingPanel(false);
    setShowRetroPanel(false);
    setShowWeekEditPanel(false);
    setNoteTargetUser(null);
    setShowWeeklyReport(false);
    setShowAuditPanel(false);
    setShowMemberPanel(false);
    setShowAccessPanel(false);
    setShowUsagePanel(false);
    setShowAdminMenu(false);
    setShowDeadlinePanel(false);
  };
  const handleLogout = () => {
    try {
      localStorage.removeItem('gantt_login');
    } catch (e) {}
    setCurrentUser(null);
    setRole(null);
    setIsOverview(false);
    setIsResults(false);
    setCollapsedOwners(new Set());
    setOwnerFilter('all');
    setSearchText('');
    setTypeFilter(new Set());
    setShowPendingPanel(false);
    setShowRetroPanel(false);
    setShowWeekEditPanel(false);
    setNoteTargetUser(null);
    setShowWeeklyReport(false);
    setShowAuditPanel(false);
    setShowMemberPanel(false);
    setShowAccessPanel(false);
    setShowUsagePanel(false);
    setShowAdminMenu(false);
    setShowDeadlinePanel(false);
  };
  const toggleOwnerCollapse = owner => {
    setCollapsedOwners(prev => {
      const s = new Set(prev);
      s.has(owner) ? s.delete(owner) : s.add(owner);
      return s;
    });
  };
  const toggleTypeFilter = t => {
    setTypeFilter(prev => {
      const s = new Set(prev);
      s.has(t) ? s.delete(t) : s.add(t);
      return s;
    });
  };
  const [scrollTargetWeek, setScrollTargetWeek] = useState(null);

  // 把某一週置中於「看得到的甘特區」= 容器寬扣掉左側凍結欄(看板開啟時容器已內縮,右緣即看板左緣)。
  // 目標超出捲動範圍時瀏覽器自動夾住 → 年底幾週改為靠右顯示(無法置中,但一定看得到)。
  const scrollToWeek = useCallback(wk => {
    const el = ganttRef.current;
    if (!el) return;
    const viewW = Math.max(weekW, el.clientWidth - frozenW); // 可視甘特區寬度
    smoothScrollLeftTo(el, (wk - 1) * weekW + weekW / 2 - viewW / 2);
  }, [weekW, frozenW]);
  const goToCurrentWeek = () => {
    // 正在看別的年度 → 先切回今年;系統週會在該年度載入完成後由 refreshData 切到本週並置中
    if (!isCurrentYear) {
      setScheduleYear(todayYear);
      return;
    }
    const tw = getTodayWeek(scheduleYear, weeksTotal); // 動態取得今天的實際週(W27、下週為 W28…)
    setCurrentWeek(tw); // 將選取週強制切回本週
    setScrollTargetWeek(tw); // 觸發 effect,於畫面更新後捲動定位
  };
  const toggleRetroCheckin = async () => {
    if (role !== 'manager') return;
    try {
      await apiPost('/api/settings/retro-checkin', {
        enabled: !allowRetroCheckin,
        // 後端 RetroCheckinReq 欄位為 Enabled(先前誤送 allow 導致永遠寫入 false)
        actor: currentUser,
        actorRole: role
      });
      setAllowRetroCheckin(!allowRetroCheckin);
      showToast(!allowRetroCheckin ? '🔓 已開放歷史補登，全體成員可回報歷史週次' : '🔒 已關閉歷史補登，僅限當週回報');
    } catch (e) {
      showToast('❌ 切換失敗：' + (e.message || '連線錯誤'));
    }
  };

  // 選取週更新後才捲動,確保「選取週」與「畫面位置」同步
  React.useEffect(() => {
    if (scrollTargetWeek == null) return;
    scrollToWeek(scrollTargetWeek);
    setScrollTargetWeek(null);
  }, [scrollTargetWeek, scrollToWeek]);

  // 團隊看板點回報格後:捲到該專案列(垂直)＋把當前週置中於「看得到的甘特區」(水平)
  React.useEffect(() => {
    if (pendingScrollProj == null) return;
    const el = ganttRef.current;
    if (el) {
      const row = el.querySelector(`[data-proj-row="${pendingScrollProj}"]`);
      if (row) {
        const cr = el.getBoundingClientRect(),
          rr = row.getBoundingClientRect();
        el.scrollTop = Math.max(0, el.scrollTop + (rr.top - cr.top) - Math.min(el.clientHeight / 2, 220));
      }
      scrollToWeek(currentWeek); // 置中(年底週次捲不動時自動靠右,仍在看板左側可視區內)
    }
    setPendingScrollProj(null);
  }, [pendingScrollProj, currentWeek, scrollToWeek]);

  // 可視甘特寬改變(開/關看板、視窗大小或接上投影機導致解析度變更)→ 重新把當前週置中;
  // 否則捲動位置會停在舊寬度算出來的地方(接投影機後年底的週次會整個躲進看板底下)
  const ganttViewKeyRef = useRef(null);
  React.useEffect(() => {
    const key = `${showWeeklyReport}|${viewportW}`;
    if (ganttViewKeyRef.current === null) {
      ganttViewKeyRef.current = key;
      return;
    } // 首次掛載不干擾初始位置
    if (ganttViewKeyRef.current === key) return;
    ganttViewKeyRef.current = key;
    if (!isOverview && !isResults) setScrollTargetWeek(currentWeek); // 交給 scrollTargetWeek effect,確保新寬度已套用
  }, [showWeeklyReport, viewportW, isOverview, isResults, currentWeek]);

  // 本地時間戳(yyyy-MM-dd HH:mm),與 bootstrap 回傳的 updatedAt 格式一致(樂觀更新用)
  const nowStamp = () => {
    const d = new Date(),
      p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  // subId:對子區間打卡時帶子區間 id、對計畫區間打卡為 null(回報單位規則見 weekUnits)
  const handleSaveLog = async (taskId, subId, status, note, docUrl = '') => {
    try {
      await apiPost('/api/weekly-log', {
        taskCode: taskId,
        subId: subId ?? null,
        year: scheduleYear,
        week: currentWeek,
        status,
        note,
        docUrl,
        actor: currentUser,
        actorRole: role
      });
      const key = subId ?? taskId;
      const setMap = subId ? setSubLogs : setTaskLogs;
      setMap(prev => ({
        ...prev,
        [key]: {
          ...prev[key],
          [currentWeek]: {
            ...(prev[key]?.[currentWeek] || {}),
            // docUrl 一律覆寫(含空字串):清空欄位再送出就是「把連結拿掉」,
            // 用 `|| 舊值` 之類的寫法會讓畫面上連結消不掉,與 DB 不一致
            isExecuting: status !== 'not_executed',
            status,
            note,
            docUrl: docUrl || null,
            reporter: currentUser,
            reporterRole: role,
            updatedAt: nowStamp()
          }
        }
      }));
      setSelectedTaskInfo(null);
      // 「下週預計工作」為強制回報項目:回報完本週最後一項任務後仍未填寫時,直接開啟填寫視窗
      const remainingPending = myPendingTasks.filter(x => !sameUnit(x, {
        task: {
          id: taskId
        },
        sub: subId ? {
          id: subId
        } : null
      })).length;
      if (role === 'member' && isReportingWeek && remainingPending === 0 && !weeklyPlans[currentUser]?.[todayWeek]) {
        showToast(`✅ 本週任務已全數回報，請接著填寫「下週預計工作」`);
        setShowWeeklyPlanModal(true);
      } else {
        showToast(`✅ W${String(currentWeek).padStart(2, '0')} 任務回報已送出`);
      }
    } catch (e) {
      showToast('❌ 儲存失敗：' + (e.message || '無法連線資料庫'));
    }
  };
  const handleSaveExtraNote = async (note, docUrl = '') => {
    const target = noteTargetUser || currentUser; // 主管可代成員修正(noteTargetUser 由週次編輯面板設定)
    try {
      await apiPost('/api/extra-note', {
        userName: target,
        year: scheduleYear,
        week: currentWeek,
        note,
        docUrl,
        actor: currentUser,
        actorRole: role
      });
      setExtraNotes(prev => ({
        ...prev,
        [target]: {
          ...prev[target],
          [currentWeek]: note
        }
      }));
      // docUrl 一律覆寫(含空字串→null):清空欄位再送出就是「把連結拿掉」,畫面要跟著消失
      setExtraNoteMeta(prev => ({
        ...prev,
        [target]: {
          ...prev[target],
          [currentWeek]: {
            by: currentUser,
            byRole: role,
            at: nowStamp(),
            docUrl: docUrl || null
          }
        }
      }));
      setShowExtraNoteModal(false);
      setNoteTargetUser(null);
      const who = target !== currentUser ? `已為 ${target} ` : '';
      showToast(note ? `✅ ${who}W${String(currentWeek).padStart(2, '0')} 非專案事項已送出` : `✅ ${who}W${String(currentWeek).padStart(2, '0')} 非專案事項已清空`);
    } catch (e) {
      showToast('❌ 儲存失敗：' + (e.message || '無法連線資料庫'));
    }
  };

  // 主管週報回覆:針對「成員×週」的建議(選填,可清空);寫入後全員於團隊總結看板可見
  const [commentTarget, setCommentTarget] = useState(null); // 回覆對象成員名(開啟 CommentModal)
  const handleSaveComment = async (userName, comment) => {
    try {
      await apiPost('/api/weekly-comment', {
        userName,
        year: scheduleYear,
        week: currentWeek,
        comment,
        actor: currentUser,
        actorRole: role
      });
      setWeeklyComments(prev => {
        const mine = {
          ...(prev[userName] || {})
        };
        if (comment) mine[currentWeek] = comment;else delete mine[currentWeek];
        return {
          ...prev,
          [userName]: mine
        };
      });
      setWeeklyCommentMeta(prev => {
        const mine = {
          ...(prev[userName] || {})
        };
        if (comment) mine[currentWeek] = {
          by: currentUser,
          byRole: role,
          at: nowStamp()
        };else delete mine[currentWeek];
        return {
          ...prev,
          [userName]: mine
        };
      });
      setCommentTarget(null);
      showToast(comment ? `✅ 已回覆 ${userName} 的 W${String(currentWeek).padStart(2, '0')} 週報` : `✅ 已清除 ${userName} 的 W${String(currentWeek).padStart(2, '0')} 週報回覆`);
    } catch (e) {
      showToast('❌ 儲存失敗：' + (e.message || '無法連線資料庫'));
    }
  };
  const handleSaveWeeklyPlan = async (note, docUrl = '') => {
    const target = noteTargetUser || currentUser; // 主管可代成員修正(noteTargetUser 由週次編輯面板設定)
    try {
      await apiPost('/api/weekly-plan', {
        userName: target,
        year: scheduleYear,
        week: currentWeek,
        note,
        docUrl,
        actor: currentUser,
        actorRole: role
      });
      setWeeklyPlans(prev => ({
        ...prev,
        [target]: {
          ...prev[target],
          [currentWeek]: note
        }
      }));
      setWeeklyPlanMeta(prev => ({
        ...prev,
        [target]: {
          ...prev[target],
          [currentWeek]: {
            by: currentUser,
            byRole: role,
            at: nowStamp(),
            docUrl: docUrl || null
          }
        }
      }));
      setShowWeeklyPlanModal(false);
      setNoteTargetUser(null);
      const who = target !== currentUser ? `已為 ${target} ` : '';
      showToast(note ? `✅ ${who}W${String(currentWeek).padStart(2, '0')} 下週預計工作已送出` : `🗑️ ${who}W${String(currentWeek).padStart(2, '0')} 下週預計工作已清空`);
    } catch (e) {
      showToast('❌ 儲存失敗：' + (e.message || '無法連線資料庫'));
    }
  };

  // 具體產出項目與 MP 人力節省效益
  const [deliverableProj, setDeliverableProj] = useState(null); // 開啟中的產出項目視窗(甘特列 🎯 進入)
  const handleSaveDeliverable = async (projId, deliverable, mpSaving) => {
    try {
      await apiPost('/api/project/deliverable', {
        projectId: projId,
        deliverable,
        mpSaving,
        actor: currentUser,
        actorRole: role
      });
      setProjects(prev => prev.map(p => p.id === projId ? {
        ...p,
        deliverable,
        mpSaving
      } : p));
      setDeliverableProj(null);
      showToast('✅ 具體產出與效益已儲存');
    } catch (e) {
      showToast('❌ 儲存失敗：' + (e.message || '無法連線資料庫'));
    }
  };

  // 主管調整打卡分數(0.3/0.5/0.8/0.9/1)
  const handleUpdateScore = async (taskId, subId, score) => {
    try {
      await apiPost('/api/weekly-log/score', {
        taskCode: taskId,
        subId: subId ?? null,
        year: scheduleYear,
        week: currentWeek,
        score,
        actor: currentUser,
        actorRole: role
      });
      const key = subId ?? taskId;
      (subId ? setSubLogs : setTaskLogs)(prev => {
        const log = prev[key]?.[currentWeek];
        if (!log) return prev;
        return {
          ...prev,
          [key]: {
            ...prev[key],
            [currentWeek]: {
              ...log,
              score
            }
          }
        };
      });
      showToast(`✅ 分數已調整為 ${score} 分`);
    } catch (e) {
      showToast('❌ 調整失敗：' + (e.message || '無法連線資料庫'));
    }
  };
  const handleUpdateTaskDetails = async (projId, taskId, newName, newStart, newEnd, newNid) => {
    try {
      await apiPost('/api/task-schedule', {
        taskCode: taskId,
        name: newName,
        start: parseInt(newStart),
        end: parseInt(newEnd),
        nid: newNid,
        actor: currentUser,
        actorRole: role
      });
      setProjects(prev => prev.map(p => {
        if (p.id !== projId) return p;
        return {
          ...p,
          tasks: p.tasks.map(t => t.id === taskId ? {
            ...t,
            name: newName,
            start: parseInt(newStart),
            end: parseInt(newEnd),
            nid: newNid
          } : t)
        };
      }));
      setSelectedTaskInfo(null);
      showToast('✅ 排程已更新');
    } catch (e) {
      showToast('❌ 更新失敗：' + (e.message || '無法連線資料庫'));
    }
  };

  // --- 子區間(遷移 18):新增/修改/刪除。主管與專案負責人皆可(權限在 SP 內檢查)。 ---
  // 存檔後同時更新 projects 與 selectedTaskInfo.task:彈窗拿的是開窗當下的 task 快照,不更新它的話
  // 清單要關窗再開才看得到剛加的那筆。
  // ⚠ updater 必須是純函式,對兩個 state 各自的 prev 分別套用:不可先用閉包裡的 projects 算一份再塞給兩邊——
  //    刪除 toast 的「復原」是 10 秒後才按,那時閉包裡的 projects 已經是舊的(輪詢可能刷新過),會把別人的變更蓋掉。
  const applySubsToState = (projId, taskId, updater) => {
    setProjects(prev => prev.map(p => p.id !== projId ? p : {
      ...p,
      tasks: p.tasks.map(t => t.id === taskId ? {
        ...t,
        subs: updater(t.subs || [])
      } : t)
    }));
    setSelectedTaskInfo(prev => prev && prev.task.id === taskId ? {
      ...prev,
      task: {
        ...prev.task,
        subs: updater(prev.task.subs || [])
      }
    } : prev);
  };
  const sortSubs = subs => [...subs].sort((a, b) => a.start - b.start || a.end - b.end || a.id - b.id); // 與 bootstrap 同序(起週→迄週)
  const handleUpsertSub = async (projId, taskId, sub) => {
    // 回傳 true/false 讓彈窗決定要不要清空「新增」表單;錯誤訊息用 toast(SP 的 RAISERROR 會照原文回來)
    try {
      const res = await apiPost('/api/task/sub', {
        subId: sub.id ?? null,
        taskCode: taskId,
        name: sub.name,
        start: sub.start,
        end: sub.end,
        actor: currentUser,
        actorRole: role
      });
      const saved = {
        id: sub.id ?? res.subId,
        name: sub.name,
        start: sub.start,
        end: sub.end
      };
      applySubsToState(projId, taskId, subs => sortSubs(sub.id ? subs.map(s => s.id === sub.id ? saved : s) : [...subs, saved]));
      showToast(sub.id ? '✅ 子區間已更新' : `✅ 已新增子區間「${sub.name}」`);
      return true;
    } catch (e) {
      showToast('❌ 儲存失敗：' + (e.message || '無法連線資料庫'));
      return false;
    }
  };
  const handleDeleteSub = (projId, taskId, sub) => {
    // 自遷移 20 起子區間底下掛著回報紀錄:確認訊息要講清楚有幾筆、有紀錄時只有主管能刪(SP 也擋),
    // 且刪除後給 10 秒「↩ 復原」(與計畫區間一致)。
    const logCount = Object.keys(subLogs[sub.id] || {}).length;
    if (logCount > 0 && role !== 'manager') {
      showToast('❌ 此子區間已有回報紀錄，僅主管可刪除');
      return;
    }
    // ConfirmModal 是 z-[150],疊在打卡彈窗(z-[100])之上,可直接從彈窗內觸發
    setConfirmInfo({
      title: '刪除子區間',
      message: `確定要刪除子區間「${sub.name}」(W${sub.start}–W${sub.end})嗎？\n` + (logCount > 0 ? `此子區間已有 ${logCount} 筆週回報，刪除後這些回報將不再顯示。\n` : '') + '（軟刪除，10 秒內可按「復原」，之後可由資料庫還原）',
      onConfirm: async () => {
        setConfirmInfo(null);
        try {
          await apiPost('/api/task/sub/delete', {
            subId: sub.id,
            actor: currentUser,
            actorRole: role
          });
          applySubsToState(projId, taskId, subs => subs.filter(s => s.id !== sub.id));
          showToast(`✅ 子區間「${sub.name}」已刪除`, {
            action: {
              label: '復原',
              onClick: async () => {
                try {
                  await apiPost('/api/task/sub/restore', {
                    subId: sub.id,
                    actor: currentUser,
                    actorRole: role
                  });
                  applySubsToState(projId, taskId, subs => sortSubs([...subs.filter(s => s.id !== sub.id), sub]));
                  showToast('✅ 子區間已復原');
                } catch (e) {
                  showToast('❌ 復原失敗：' + (e.message || '無法連線資料庫'));
                }
              }
            }
          });
        } catch (e) {
          showToast('❌ 刪除失敗：' + (e.message || '無法連線資料庫'));
        }
      }
    });
  };

  // --- 主管：專案 新增/修改/刪除 + 區間新增 + 拖曳排序 ---
  const [editingProject, setEditingProject] = useState(null); // {mode:'add'|'edit', owner, project?}
  const [addingInterval, setAddingInterval] = useState(null); // project
  const [dragState, setDragState] = useState(null); // {id, owner}
  const [dragOverId, setDragOverId] = useState(null);
  const [confirmInfo, setConfirmInfo] = useState(null); // {title, message, onConfirm} — 自製刪除確認視窗(取代 window.confirm)

  // 資料載入完成後還原上次登入身分(重新整理免重登);成員名單已無此人(被移除/改名)則清除紀錄
  React.useEffect(() => {
    if (dataLoading || dataError || currentUser) return;
    try {
      const saved = JSON.parse(localStorage.getItem('gantt_login') || 'null');
      if (!saved || !saved.user || !saved.role) return;
      if (saved.role === 'manager' || users.includes(saved.user)) {
        handleLogin(saved.user, saved.role, 'auto'); // 重整自動還原:統計來源記 auto
      } else {
        localStorage.removeItem('gantt_login');
      }
    } catch (e) {}
  }, [dataLoading, dataError, currentUser, users]); // eslint-disable-line react-hooks/exhaustive-deps

  // 是否有彈窗/面板開啟中——輪詢暫停與鍵盤快捷鍵共用同一份判斷,兩邊才不會各自漂移。
  // ⚠ 團隊總結看板(showWeeklyReport)刻意不列入:它是唯讀的側邊疊加面板,不是輸入型視窗。
  //   快捷鍵要讓主管邊看看板邊用 ←→/H 平移甘特圖;輪詢更是反過來——講評時本來就希望看到成員陸續回報進來。
  const isAnyModalOpen = !!(confirmInfo || commentTarget || selectedTaskInfo || deliverableProj || editingProject || addingInterval || showExtraNoteModal || showWeeklyPlanModal || showPendingPanel || showRetroPanel || showWeekEditPanel || showAuditPanel || showMemberPanel || showAccessPanel || showUsagePanel || showAdminMenu || showDisplayMenu || showDeadlinePanel);

  // 多人共用時每 60 秒靜默刷新,讓其他人的變更自動出現(失敗靜默忽略,下輪再試)。
  // 暫停條件有兩個:
  //   ①拖曳排序中——刷新會重排 projects,拖到一半的位置會跳掉。
  //   ②任何彈窗/面板開啟中——refreshData 會整包換掉 projects/taskLogs,而使用者正在彈窗裡看的就是那份資料。
  //     打到一半的字不會被抹掉(表單值是開窗當下用 useState 初始化的,之後不再同步 props),
  //     但畫面上的對照資料會在眼前跳動(如「前幾週回報」、排程、評分),
  //     而且使用者是看著舊資料做決定、送出時覆蓋新值 → 正是 last-write-wins 的實際發生路徑。
  const pausedAtRef = useRef(null);
  React.useEffect(() => {
    if (!currentUser) return;
    if (dragState || isAnyModalOpen) {
      if (pausedAtRef.current === null) pausedAtRef.current = Date.now(); // 記錄暫停起點
      return;
    }
    // 暫停期間若已經跨過一個輪詢週期,關窗後補刷一次;否則使用者得再等滿 60 秒才看得到別人的變更。
    // ⚠ 只在「真的錯過」時才補:存檔類操作本身已經 await refreshData(),關窗馬上再打一次 bootstrap 是多餘的
    //    (bootstrap 是整包載入的重端點,每次存檔都雙倍請求並不划算)。
    const missedTick = pausedAtRef.current !== null && Date.now() - pausedAtRef.current >= 60000;
    pausedAtRef.current = null;
    if (missedTick) refreshData().catch(() => {});
    const timer = setInterval(() => {
      refreshData().catch(() => {});
    }, 60000);
    return () => clearInterval(timer);
  }, [currentUser, dragState, isAnyModalOpen, refreshData]);

  // --- 全域鍵盤導航（方向鍵平移甘特圖、Home/H 回本週、ESC 關閉最上層彈窗） ---
  React.useEffect(() => {
    if (!currentUser) return;
    const handler = e => {
      // 中文組字中略過。
      // 此處是 document.addEventListener 的**原生**事件,可以直接讀 e.isComposing;
      // React 的 onKeyDown 不行(合成事件沒這個屬性),那邊一律用 isComposingEvent(e)。
      if (e.isComposing) return;
      // 焦點在表單元素時略過（搜尋框、輸入框等）
      // ⚠ ESC 是例外:它在輸入框裡的語意就是「取消」。彈窗加了焦點鎖之後 Tab 會走進輸入框,
      //   若比照其他快捷鍵一起略過,使用者在輸入框按 ESC 會關不掉視窗(實測踩到)。
      const tag = document.activeElement?.tagName;
      if (e.key !== 'Escape' && (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT')) return;

      // ESC：關閉最上層 Modal/Panel（優先序由內到外）;
      // 表單型視窗有未儲存內容(MODAL_DIRTY)時,先跳確認避免默默丟失輸入
      if (e.key === 'Escape') {
        const closeGuard = closer => {
          if (MODAL_DIRTY) {
            setConfirmInfo({
              title: '放棄未儲存的內容？',
              message: '視窗內有尚未儲存的修改，關閉後將會遺失。',
              confirmLabel: '放棄並關閉',
              onConfirm: () => {
                MODAL_DIRTY = false;
                setConfirmInfo(null);
                closer();
              }
            });
          } else closer();
        };
        if (showAdminMenu) {
          setShowAdminMenu(false);
          e.preventDefault();
          return;
        }
        if (showDisplayMenu) {
          setShowDisplayMenu(false);
          e.preventDefault();
          return;
        }
        if (confirmInfo) {
          setConfirmInfo(null);
          e.preventDefault();
          return;
        }
        if (commentTarget) {
          closeGuard(() => setCommentTarget(null));
          e.preventDefault();
          return;
        }
        if (selectedTaskInfo) {
          closeGuard(() => setSelectedTaskInfo(null));
          e.preventDefault();
          return;
        }
        if (deliverableProj) {
          closeGuard(() => setDeliverableProj(null));
          e.preventDefault();
          return;
        }
        if (editingProject) {
          closeGuard(() => setEditingProject(null));
          e.preventDefault();
          return;
        }
        if (addingInterval) {
          closeGuard(() => setAddingInterval(null));
          e.preventDefault();
          return;
        }
        if (showExtraNoteModal) {
          closeGuard(() => {
            setShowExtraNoteModal(false);
            setNoteTargetUser(null);
          });
          e.preventDefault();
          return;
        }
        if (showWeeklyPlanModal) {
          closeGuard(() => {
            setShowWeeklyPlanModal(false);
            setNoteTargetUser(null);
          });
          e.preventDefault();
          return;
        }
        if (showWeeklyReport) {
          closeWeeklyReport();
          e.preventDefault();
          return;
        }
        if (showPendingPanel) {
          setShowPendingPanel(false);
          e.preventDefault();
          return;
        }
        if (showRetroPanel) {
          setShowRetroPanel(false);
          e.preventDefault();
          return;
        }
        if (showWeekEditPanel) {
          setShowWeekEditPanel(false);
          e.preventDefault();
          return;
        }
        if (showAuditPanel) {
          setShowAuditPanel(false);
          e.preventDefault();
          return;
        }
        // 成員管理有「新增成員」與「行內改名」兩個輸入框 → 與其他表單型視窗一樣要走 closeGuard,
        // 否則打到一半的姓名按 ESC 會直接消失(全站 16 個彈窗裡原本只有這個沒接上)
        if (showMemberPanel) {
          closeGuard(() => setShowMemberPanel(false));
          e.preventDefault();
          return;
        }
        if (showAccessPanel) {
          setShowAccessPanel(false);
          e.preventDefault();
          return;
        }
        if (showUsagePanel) {
          setShowUsagePanel(false);
          e.preventDefault();
          return;
        }
        if (showDeadlinePanel) {
          setShowDeadlinePanel(false);
          e.preventDefault();
          return;
        }
        return;
      }

      // 以下導航快捷鍵：任何 Modal/Panel 開啟時不觸發（判斷共用上方的 isAnyModalOpen，說明見該處）
      if (isAnyModalOpen) return;

      // Home 或 H：回到本週
      if (e.key === 'Home' || e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        goToCurrentWeek();
        return;
      }

      // 方向鍵：僅在週檢視模式下平移甘特圖
      if (!isOverview && !isResults) {
        const el = ganttRef.current;
        if (!el) return;
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          smoothScrollLeftTo(el, el.scrollLeft - (e.shiftKey ? weekW : weekW * 4));
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          smoothScrollLeftTo(el, el.scrollLeft + (e.shiftKey ? weekW : weekW * 4));
        }
      }
    };
    window.addEventListener('keydown', handler, true); // capture phase
    return () => window.removeEventListener('keydown', handler, true);
  }, [currentUser, weekW, isOverview, isResults, isAnyModalOpen, confirmInfo, commentTarget, selectedTaskInfo, deliverableProj, editingProject, addingInterval, showExtraNoteModal, showWeeklyPlanModal, showWeeklyReport, showPendingPanel, showRetroPanel, showWeekEditPanel, showAuditPanel, showMemberPanel, showAccessPanel, showUsagePanel, showAdminMenu, showDisplayMenu, showDeadlinePanel, goToCurrentWeek, closeWeeklyReport]);
  const existingCategories = useMemo(() => [...new Set(projects.map(p => p.category).filter(Boolean))].sort(), [projects]);

  // 搜尋/類型篩選會隱藏同成員內的部分專案列,此時拖曳落點會與畫面不一致,故暫停拖曳排序
  const isFilteringRows = searchText.trim() !== '' || typeFilter.size > 0;
  const handleSaveProject = async form => {
    try {
      if (form.mode === 'add') {
        await apiPost('/api/project', {
          type: form.type,
          category: form.category,
          owner: form.owner,
          name: form.name,
          year: scheduleYear,
          nid: form.nid,
          actor: currentUser,
          actorRole: role
        });
      } else {
        await apiPost('/api/project/update', {
          projectId: form.projectId,
          type: form.type,
          category: form.category,
          owner: form.owner,
          name: form.name,
          nid: form.nid,
          actor: currentUser,
          actorRole: role
        });
      }
      await refreshData();
      setEditingProject(null);
      showToast(form.mode === 'add' ? '✅ 專案已新增' : '✅ 專案已更新');
    } catch (e) {
      showToast('❌ 儲存失敗：' + (e.message || '無法連線資料庫'));
    }
  };
  const handleDeleteProject = proj => {
    setConfirmInfo({
      title: '刪除專案',
      message: `確定要刪除專案「${proj.name}」嗎？\n此動作會一併移除其所有計畫區間（軟刪除，可由資料庫還原）。`,
      onConfirm: async () => {
        setConfirmInfo(null);
        try {
          await apiPost('/api/project/delete', {
            projectId: proj.id,
            actor: currentUser,
            actorRole: role
          });
          await refreshData();
          // 10 秒內可一鍵復原(軟刪除還原,含其計畫區間)
          showToast(`✅ 專案「${proj.name}」已刪除`, {
            action: {
              label: '復原',
              onClick: async () => {
                try {
                  await apiPost('/api/project/restore', {
                    projectId: proj.id,
                    actor: currentUser,
                    actorRole: role
                  });
                  await refreshData();
                  showToast('✅ 專案已復原');
                } catch (e) {
                  showToast('❌ 復原失敗：' + (e.message || '無法連線資料庫'));
                }
              }
            }
          });
        } catch (e) {
          showToast('❌ 刪除失敗：' + (e.message || '無法連線資料庫'));
        }
      }
    });
  };
  const handleAddInterval = async (proj, taskName, start, end, nid) => {
    try {
      await apiPost('/api/task', {
        projectId: proj.id,
        taskName,
        start: parseInt(start),
        end: parseInt(end),
        nid,
        actor: currentUser,
        actorRole: role
      });
      await refreshData();
      setAddingInterval(null);
      showToast('✅ 計畫區間已新增');
    } catch (e) {
      showToast('❌ 新增失敗：' + (e.message || '無法連線資料庫'));
    }
  };
  const handleDeleteTask = (proj, task) => {
    setConfirmInfo({
      title: '刪除計畫區間',
      message: `確定要刪除計畫區間「${task.name}」(W${task.start}–W${task.end})嗎？\n（軟刪除，可由資料庫還原）`,
      onConfirm: async () => {
        setConfirmInfo(null);
        try {
          await apiPost('/api/task/delete', {
            taskCode: task.id,
            actor: currentUser,
            actorRole: role
          });
          await refreshData();
          setSelectedTaskInfo(null);
          showToast(`✅ 計畫區間「${task.name}」已刪除`, {
            action: {
              label: '復原',
              onClick: async () => {
                try {
                  await apiPost('/api/task/restore', {
                    taskCode: task.id,
                    actor: currentUser,
                    actorRole: role
                  });
                  await refreshData();
                  showToast('✅ 計畫區間已復原');
                } catch (e) {
                  showToast('❌ 復原失敗：' + (e.message || '無法連線資料庫'));
                }
              }
            }
          });
        } catch (e) {
          showToast('❌ 刪除失敗：' + (e.message || '無法連線資料庫'));
        }
      }
    });
  };
  const handleReorderProjects = async (owner, fromId, toId) => {
    if (fromId === toId) return;
    const ownerProjs = projects.filter(p => p.owner === owner);
    const ids = ownerProjs.map(p => p.id);
    const from = ids.indexOf(fromId),
      to = ids.indexOf(toId);
    if (from < 0 || to < 0) return;
    const reordered = [...ownerProjs];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    const newIds = reordered.map(p => p.id);
    // 樂觀更新(純函式:每次呼叫自建佇列,即使 StrictMode 重複執行 updater 也不會錯位)
    setProjects(prev => {
      const queue = [...reordered];
      return prev.map(p => p.owner === owner ? queue.shift() : p);
    });
    try {
      await apiPost('/api/project/reorder', {
        orderedIds: newIds,
        actor: currentUser,
        actorRole: role
      });
      showToast('✅ 排序已更新');
    } catch (e) {
      showToast('❌ 排序失敗：' + (e.message || '無法連線資料庫'));
      refreshData();
    }
  };

  // --- 主管：成員 新增/移除 ---
  const handleAddUser = async name => {
    try {
      await apiPost('/api/user', {
        userName: name,
        actor: currentUser,
        actorRole: role
      });
      await refreshData();
      showToast('✅ 成員已新增');
      return true;
    } catch (e) {
      showToast('❌ 新增失敗：' + (e.message || '無法連線資料庫'));
      return false;
    }
  };
  const handleRenameUser = async (oldName, newName) => {
    try {
      await apiPost('/api/user/update', {
        userName: oldName,
        newName,
        actor: currentUser,
        actorRole: role
      });
      await refreshData();
      showToast('✅ 成員名稱已更新');
      return true;
    } catch (e) {
      showToast('❌ 更新失敗：' + (e.message || '無法連線資料庫'));
      return false;
    }
  };
  const handleDeleteUser = name => {
    setConfirmInfo({
      title: '移除成員',
      message: `確定要移除成員「${name}」嗎？\n移除後將不再出現於登入畫面與甘特圖（歷史回報保留，重新新增同名成員即可還原）。\n若其名下仍有專案，需先刪除或改派專案才能移除。`,
      onConfirm: async () => {
        setConfirmInfo(null);
        try {
          await apiPost('/api/user/delete', {
            userName: name,
            actor: currentUser,
            actorRole: role
          });
          await refreshData();
          showToast('✅ 成員已移除');
        } catch (e) {
          showToast('❌ 移除失敗：' + (e.message || '無法連線資料庫'));
        }
      }
    });
  };

  // 目前生效中的篩選條件 — 供空狀態「講出是什麼把清單清空的」並就地給出口(見 EmptyFilterState)。
  // ⚠ 成員下拉比對的是 defaultOwnerFilter 而非 'all':成員的預設本來就是「只看自己」,
  //   把它列成「生效中的篩選」並叫人清掉,只會讓成員看到別人的專案,不是他要的。
  const ownerDefault = defaultOwnerFilter(role, currentUser);
  const activeFilters = useMemo(() => {
    const list = [];
    if (searchText.trim()) list.push({
      key: 'search',
      label: `搜尋「${searchText.trim()}」`,
      clearLabel: '清除搜尋',
      clear: () => setSearchText('')
    });
    if (typeFilter.size > 0) list.push({
      key: 'type',
      label: `類型 ${[...typeFilter].map(k => String(k).toUpperCase()).join('、')}`,
      clearLabel: '清除類型',
      clear: () => setTypeFilter(new Set())
    });
    if (ownerFilter !== ownerDefault) list.push({
      key: 'owner',
      label: `成員「${ownerFilter === 'all' ? '全部成員' : ownerFilter}」`,
      clearLabel: '清除成員',
      clear: () => setOwnerFilter(ownerDefault)
    });
    return list;
  }, [searchText, typeFilter, ownerFilter, ownerDefault]);
  const clearAllFilters = () => {
    setSearchText('');
    setTypeFilter(new Set());
    setOwnerFilter(ownerDefault);
  };

  // --- 篩選 ---
  const filteredProjects = useMemo(() => {
    const kw = searchText.trim().toLowerCase();
    return projects.filter(p => {
      if (ownerFilter !== 'all' && p.owner !== ownerFilter) return false; // 三個檢視共用的成員下拉
      if (typeFilter.size > 0 && !typeFilter.has(p.type)) return false;
      if (kw) {
        const hay = `${p.name} ${p.category} ${p.owner} ${p.tasks.map(t => `${t.name} ${(t.subs || []).map(s => s.name).join(' ')}`).join(' ')}`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
  }, [projects, searchText, typeFilter, ownerFilter]);
  // 關鍵字命中「子區間名稱」的專案 id:這些專案要暫時視為展開(見 isSubExpanded),否則收合狀態下
  // 搜「驗證」跑出一個名稱裡沒有「驗證」的專案,使用者只會覺得搜尋壞了。
  // 只是暫時的顯示狀態,不寫進 gantt_prefs——清掉搜尋就回到原本的偏好。
  const subSearchHits = useMemo(() => {
    const kw = searchText.trim().toLowerCase();
    if (!kw) return new Set();
    return new Set(projects.filter(p => p.tasks.some(t => (t.subs || []).some(s => s.name.toLowerCase().includes(kw)))).map(p => p.id));
  }, [projects, searchText]);

  // 主管未啟用搜尋/類型篩選時，沒有專案的成員(如剛加入的新同仁)也要顯示群組列,才能為其新增專案
  const groupedProjects = useMemo(() => users.map(user => ({
    owner: user,
    projects: filteredProjects.filter(p => p.owner === user)
  })).filter(g => g.projects.length > 0 || role === 'manager' && !isFilteringRows && (ownerFilter === 'all' || ownerFilter === g.owner)), [filteredProjects, users, role, isFilteringRows, ownerFilter]);

  // 工具列「顯示 ▾」的項目:成員群組的展開/收合只在畫面上有 ≥2 個群組時才列(成員預設只看自己＝一個群組,
  // 「收合」等於把整張表收掉,沒有意義);子區間兩項只在資料裡真的有子區間時列。一項都沒有 → 整顆鈕不顯示。
  const displayMenuItems = [...(groupedProjects.length >= 2 ? [{
    label: '展開全部成員群組',
    run: () => setCollapsedOwners(new Set())
  }, {
    label: '收合全部成員群組',
    run: () => setCollapsedOwners(new Set(users))
  }] : []), ...(hasAnySubs ? [{
    label: '展開全部子區間',
    run: () => setAllSubExpanded(true),
    sep: true
  }, {
    label: '收合全部子區間',
    run: () => setAllSubExpanded(false)
  }] : [])];

  // 排程到期提醒:任務進行中(以「實際本週」計)且 剩餘 ≤2 週,或「時程已過 ≥70% **且** 剩餘 ≤ DEADLINE_RATIO_MAX_REMAIN 週」。
  // ⚠ 70% 規則要配剩餘週數上限(2026-09-12 修):原本只看比例,整年 52 週的區間在 9 月(71%)、剩 16 週就被標成
  //   「即將到期」——實測本週 18 條進行中 7 條被標示,其中 4 條是這種整年區間、2 條剩 7 週,真正快到期的只有 1 條。
  //   「即將」的語意是剩下的時間不多,所以比例之外一定要有絕對週數;4 週＝一個月,主管盯得住的範圍。
  const isTaskDeadlineSoon = useCallback(task => {
    if (!isCurrentYear) return false; // 別的年度整年都是過去/未來,沒有「即將」可言(否則去年 W53 結束的區間會一直亮 ⏰)
    if (task.start > todayWeek || task.end < todayWeek) return false;
    const span = task.end - task.start + 1;
    const remain = task.end - todayWeek + 1; // 含本週
    const elapsed = (todayWeek - task.start + 1) / span; // 已過比例
    return remain <= 2 || remain <= DEADLINE_RATIO_MAX_REMAIN && elapsed >= 0.7;
  }, [todayWeek, isCurrentYear]);

  // 即將到期清單(依剩餘週數排序,供頂部晶片點開的面板與統計數字共用)
  const deadlineTasks = useMemo(() => {
    const list = [];
    projects.forEach(p => p.tasks.forEach(t => {
      if (isTaskDeadlineSoon(t)) {
        list.push({
          proj: p,
          task: t,
          remain: t.end - todayWeek + 1,
          elapsed: Math.round((todayWeek - t.start + 1) / (t.end - t.start + 1) * 100)
        });
      }
    }));
    return list.sort((a, b) => a.remain - b.remain);
  }, [projects, isTaskDeadlineSoon, todayWeek]);

  // --- 甘特條的 roving tabindex ---
  // 107 個甘特條原本各自 tabIndex=0,鍵盤使用者要按 107 次 Tab 才穿得過甘特區。
  // 改成整區只留一個 Tab 停留點(目前聚焦過的那條,沒有就是第一條),進去之後用 ↑↓ 移動。
  // 順序直接照渲染順序算(收合的成員群組不入列),與畫面上看到的一致。
  // 子區間自遷移 20 起是打卡入口,子條也要進 roving 群組(id 加 's' 前綴與父條區隔);順序＝畫面順序(專案列的父條 → 該專案的子列)
  const ganttBarTaskIds = useMemo(() => {
    const ids = [];
    groupedProjects.forEach(g => {
      if (collapsedOwners.has(g.owner)) return;
      g.projects.forEach(p => {
        p.tasks.forEach(t => ids.push(t.id));
        if (isSubExpanded(p.id)) p.tasks.forEach(t => (t.subs || []).forEach(s => ids.push(`s${s.id}`)));
      });
    });
    return ids;
  }, [groupedProjects, collapsedOwners, isOverview, subCollapsedWeek, subExpandedOverview, subSearchHits]); // eslint-disable-line react-hooks/exhaustive-deps
  // ⚠ 存成字串:onRove 是從 DOM 的 data-roving-id 讀回來的(字串),onFocus 給的是原始 id(數字),
  //    兩條路徑都會寫進這個 state,故一律以字串比較,避免 32 !== '32' 造成 tab stop 找不到目標。
  const [rovingTaskId, setRovingTaskId] = useState(null);
  // 篩選/收合把原本那條藏起來時要退回第一條,否則整區會變成「沒有任何 Tab 停留點」＝鍵盤進不去
  const activeRovingTaskId = rovingTaskId != null && ganttBarTaskIds.some(id => String(id) === String(rovingTaskId)) ? rovingTaskId : ganttBarTaskIds[0];

  // --- 本週統計 ---
  // ⚠ 跟著**成員下拉(ownerFilter)**走,不是永遠全隊:標題就寫在被篩選過的表格正上方,
  //   選了「玉婷」卻顯示全隊 3/21、而表格是 16/69,兩組數字對不起來(實測 all→玉婷→裕隆 晶片三次都不變)。
  //   標題會同步顯示範圍(全隊 / 成員名),使用者不必用猜的。
  // ⚠ 但**不吃搜尋與類型篩選**:那兩個是臨時的「找資料」動作,概況是「這週該做的事完成多少」的固定基準——
  //   跟著關鍵字一起跳動的話,邊打字邊變的數字沒有任何意義。
  // ⚠ 一律以「回報單位」計(weekUnits):子區間模式下一條計畫區間＝N 個單位,概況的「x/y 已回報」與看板、待回報徽章同一口徑
  const weekStats = useMemo(() => {
    let active = 0,
      reported = 0,
      executed = 0,
      monitor = 0,
      notExec = 0;
    projects.forEach(p => {
      if (ownerFilter !== 'all' && p.owner !== ownerFilter) return;
      p.tasks.forEach(t => {
        if (t.start <= currentWeek && t.end >= currentWeek) {
          const wu = weekUnits(t, currentWeek, taskLogs, subLogs);
          active += wu.total;
          reported += wu.reported;
          wu.units.forEach(({
            log
          }) => {
            if (!log) return;
            if (log.status === 'not_executed') notExec++;else if (log.status === 'monitor') monitor++;else executed++;
          });
        }
      });
    });
    return {
      active,
      reported,
      executed,
      monitor,
      notExec,
      pending: active - reported
    };
  }, [projects, taskLogs, subLogs, currentWeek, ownerFilter]);

  // 成員自己在某週的回報單位清單:pending＝還沒交的單位、completed＝已交的單位(每筆 {proj, task, sub, log},sub 為 null＝計畫區間本身)
  const myUnitsAt = useCallback(week => {
    const pending = [],
      completed = [];
    if (role !== 'member') return {
      pending,
      completed
    };
    projects.filter(p => p.owner === currentUser).forEach(p => p.tasks.forEach(t => {
      if (t.start <= week && t.end >= week) {
        weekUnits(t, week, taskLogs, subLogs).units.forEach(({
          sub,
          log
        }) => {
          (log ? completed : pending).push({
            proj: p,
            task: t,
            sub,
            log
          });
        });
      }
    }));
    return {
      pending,
      completed
    };
  }, [projects, taskLogs, subLogs, role, currentUser]);
  // 「本週」只存在於今年:看別的年度時待回報清單一律空(徽章不催、回報中心不開)
  const myUnitsToday = useMemo(() => isCurrentYear ? myUnitsAt(todayWeek) : NO_UNITS, [myUnitsAt, todayWeek, isCurrentYear]); // eslint-disable-line react-hooks/exhaustive-deps
  const myPendingTasks = myUnitsToday.pending;
  const myCompletedTasks = myUnitsToday.completed;

  // 補登面板用:檢視中週次(非本週、且已經過去)的待打卡/已打卡清單(成員;需主管開放補登)
  const myUnitsRetro = useMemo(() => isReportingWeek || isFutureWeek ? NO_UNITS : myUnitsAt(currentWeek), [myUnitsAt, currentWeek, isReportingWeek, isFutureWeek]); // eslint-disable-line react-hooks/exhaustive-deps
  const myRetroPendingTasks = myUnitsRetro.pending;
  const myRetroCompletedTasks = myUnitsRetro.completed;

  // 「下週預計工作」也是強制回報項目:未填寫時計入待回報數,回報完最後一項任務會自動跳出填寫視窗
  const planPendingThisWeek = role === 'member' && !!currentUser && isCurrentYear && !weeklyPlans[currentUser]?.[todayWeek];
  const totalPendingCount = myPendingTasks.length + (planPendingThisWeek ? 1 : 0);

  // 甘特 tooltip 的「位置」不進 state(2026-09-12 修):App 沒有任何 memo 邊界,tooltip 的 x/y 放在 state 裡
  // 等於每次 mousemove 都把 77 列 × 53 格(4,600 個 div)整張重繪,實測每次 7–18ms,投影筆電滑過甘特條會掉幀。
  // 內容(哪條區間、本週狀態)仍走 state(進出一條才換一次);座標存 ref、mousemove 直接改 tooltip 節點的 style,零重繪。
  const tooltipElRef = useRef(null);
  const tooltipPosRef = useRef({
    x: 0,
    y: 0
  });
  const placeTooltip = (x, y) => {
    tooltipPosRef.current = {
      x,
      y
    };
    const el = tooltipElRef.current;
    if (!el) return;
    el.style.left = `${Math.min(x + 14, window.innerWidth - 300)}px`;
    el.style.top = `${Math.min(y + 14, window.innerHeight - 200)}px`;
  };
  const showTooltip = (e, proj, task, sub = null) => {
    const weekLog = taskLogs[task.id]?.[currentWeek];
    const history = Object.entries(taskLogs[task.id] || {}).filter(([w]) => Number(w) !== currentWeek).sort((a, b) => Number(a[0]) - Number(b[0]));
    // 子區間模式(該週回報單位＝子區間)時列出每個子區間的回報狀態
    const wu = weekUnits(task, currentWeek, taskLogs, subLogs);
    // 滑的是子條(2026-09-13):多帶這條子區間自己的本週紀錄與歷史(subLogs),父層資訊照樣列出當上下文
    const subInfo = sub ? {
      sub,
      isUnit: wu.mode === 'sub' && wu.units.some(u => u.sub.id === sub.id),
      // 本週的回報單位之一
      log: SUB_CHECKIN ? subLogs[sub.id]?.[currentWeek] : undefined,
      history: !SUB_CHECKIN ? [] : Object.entries(subLogs[sub.id] || {}).filter(([w]) => Number(w) !== currentWeek && Number(w) >= sub.start && Number(w) <= sub.end).sort((a, b) => Number(a[0]) - Number(b[0]))
    } : null;
    placeTooltip(e.clientX, e.clientY);
    setTooltip({
      proj,
      task,
      weekLog,
      history,
      wu,
      subInfo
    });
  };
  const moveTooltip = e => placeTooltip(e.clientX, e.clientY);
  const hideTooltip = () => setTooltip(null);
  // 節點掛上來的當下就套用最後一次的座標(setTooltip 之後才有節點可以改)
  const tooltipRefCb = el => {
    tooltipElRef.current = el;
    if (el) placeTooltip(tooltipPosRef.current.x, tooltipPosRef.current.y);
  };

  // 瀏覽權限卡控:檢查完成前顯示載入畫面;卡控啟用且未通過 → 整頁無權限畫面(不顯示登入與任何資料)
  // 逾時:給錯誤畫面＋重試,不要無限轉圈(原本使用者唯一的出路是自己想到按 Ctrl+F5)
  if (accessError) {
    return /*#__PURE__*/React.createElement("div", {
      className: "min-h-screen bg-slate-100 app-bg flex flex-col"
    }, /*#__PURE__*/React.createElement(ErrorScreen, {
      message: accessError,
      onRetry: () => setAccessRetry(n => n + 1)
    }));
  }
  if (!accessCheck) return /*#__PURE__*/React.createElement("div", {
    className: "min-h-screen bg-slate-100 app-bg flex flex-col"
  }, /*#__PURE__*/React.createElement(LoadingScreen, null));
  if (accessCheck.enabled && !accessCheck.allowed) {
    return /*#__PURE__*/React.createElement(AccessDeniedScreen, {
      empId: empId,
      reason: accessCheck.reason,
      person: accessCheck.person,
      siteTitle: siteTitle
    });
  }
  return (
    /*#__PURE__*/
    // 主畫面用 h-screen(不是 min-h-screen):團隊看板改成分割欄位後會參與版面流,沒有明確高度時整棵樹會被
    // 它的內容撐到數千 px,flex-1 分不出高度、面板內部的 overflow-y-auto 就捲不動(原本它是 fixed 才沒事)。
    // 登入/載入/錯誤畫面維持 min-h-screen——那些畫面沒有內部捲動區,矮視窗時要能整頁撐開。
    React.createElement("div", {
      className: `bg-slate-100 app-bg font-sans flex flex-col relative overflow-hidden ${currentUser && !dataLoading && !dataError ? 'h-screen' : 'min-h-screen'}`
    }, /*#__PURE__*/React.createElement("header", {
      className: "text-white px-4 py-2 flex justify-between items-center z-50 shadow-md",
      style: {
        backgroundColor: NAVY
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "flex items-center space-x-4"
    }, /*#__PURE__*/React.createElement("div", {
      className: "flex items-center space-x-2"
    }, /*#__PURE__*/React.createElement("div", {
      className: "bg-white/10 p-1.5 rounded-lg border border-white/20"
    }, /*#__PURE__*/React.createElement("svg", {
      className: "w-5 h-5",
      style: {
        color: GOLD
      },
      fill: "none",
      stroke: "currentColor",
      viewBox: "0 0 24 24"
    }, /*#__PURE__*/React.createElement("path", {
      strokeLinecap: "round",
      strokeLinejoin: "round",
      strokeWidth: 2,
      d: "M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2"
    }))), /*#__PURE__*/React.createElement("span", {
      className: "text-base font-bold tracking-wide"
    }, siteTitle)), currentUser && !isResults && /*#__PURE__*/React.createElement("div", {
      className: "px-3 py-1 rounded-full border border-white/10 flex items-center shadow-inner",
      style: {
        backgroundColor: '#001338'
      }
    }, /*#__PURE__*/React.createElement("span", {
      className: "text-white/85 mr-2 text-xs font-medium"
    }, "\u7CFB\u7D71\u9031\u6578"), role === 'manager' ? /*#__PURE__*/React.createElement("div", {
      className: "flex items-center space-x-1.5"
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => {
        const w = Math.max(1, currentWeek - 1);
        setCurrentWeek(w);
        setScrollTargetWeek(w);
      },
      className: "w-6 h-6 flex items-center justify-center bg-white/10 hover:bg-white/30 rounded-full text-xs font-bold transition",
      "aria-label": "\u4E0A\u4E00\u9031",
      title: "\u4E0A\u4E00\u9031"
    }, "\u2039"), /*#__PURE__*/React.createElement("span", {
      className: "inline-flex items-baseline",
      style: {
        minWidth: 100
      }
    }, /*#__PURE__*/React.createElement(WeekNumberInput, {
      week: currentWeek,
      max: weeksTotal,
      label: `跳至指定週次（1–${weeksTotal}）`,
      onCommit: w => {
        setCurrentWeek(w);
        setScrollTargetWeek(w);
      }
    }), /*#__PURE__*/React.createElement("span", {
      className: "text-white/75 font-normal text-[10px] ml-1 whitespace-nowrap",
      title: `${weekToMonth(currentWeek, months)}・${weekRangeLabel(scheduleYear, currentWeek)}（週日起算）`
    }, weekRangeLabel(scheduleYear, currentWeek))), /*#__PURE__*/React.createElement("button", {
      onClick: () => {
        const w = Math.min(weeksTotal, currentWeek + 1);
        setCurrentWeek(w);
        setScrollTargetWeek(w);
      },
      className: "w-6 h-6 flex items-center justify-center bg-white/10 hover:bg-white/30 rounded-full text-xs font-bold transition",
      "aria-label": "\u4E0B\u4E00\u9031",
      title: "\u4E0B\u4E00\u9031"
    }, "\u203A")) : /*#__PURE__*/React.createElement("div", {
      className: "flex items-center space-x-1.5"
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => {
        const w = Math.max(1, currentWeek - 1);
        setCurrentWeek(w);
        setScrollTargetWeek(w);
      },
      className: "w-6 h-6 flex items-center justify-center bg-white/10 hover:bg-white/30 rounded-full text-xs font-bold transition",
      "aria-label": "\u6AA2\u8996\u524D\u4E00\u9031(\u552F\u8B80)",
      title: "\u6AA2\u8996\u524D\u4E00\u9031(\u552F\u8B80)"
    }, "\u2039"), /*#__PURE__*/React.createElement("span", {
      className: "inline-flex items-baseline",
      style: {
        minWidth: 100
      }
    }, /*#__PURE__*/React.createElement(WeekNumberInput, {
      week: currentWeek,
      max: todayWeek,
      label: `跳至指定週次（1–${todayWeek}，僅能檢視本週以前）`,
      onCommit: w => {
        setCurrentWeek(w);
        setScrollTargetWeek(w);
      }
    }), /*#__PURE__*/React.createElement("span", {
      className: "text-white/75 font-normal text-[10px] ml-1 whitespace-nowrap",
      title: `${weekToMonth(currentWeek, months)}・${weekRangeLabel(scheduleYear, currentWeek)}（週日起算）`
    }, weekRangeLabel(scheduleYear, currentWeek))), /*#__PURE__*/React.createElement("button", {
      onClick: () => {
        const w = Math.min(todayWeek, currentWeek + 1);
        setCurrentWeek(w);
        setScrollTargetWeek(w);
      },
      disabled: currentWeek >= todayWeek,
      className: `w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold transition ${currentWeek >= todayWeek ? 'bg-white/5 text-white/20 cursor-not-allowed' : 'bg-white/10 hover:bg-white/30'}`,
      "aria-label": "\u6AA2\u8996\u5F8C\u4E00\u9031",
      title: "\u6AA2\u8996\u5F8C\u4E00\u9031"
    }, "\u203A")), !isCurrentYear && /*#__PURE__*/React.createElement("button", {
      onClick: goToCurrentWeek,
      title: `正在檢視 ${scheduleYear} 年度（${scheduleYear > todayYear ? '尚未開始' : '已結束'}），沒有本週可回報；點擊切回 ${todayYear} 年度的本週`,
      className: "ml-2 flex items-center bg-yellow-500/90 hover:bg-yellow-400 text-slate-900 text-[10px] font-bold px-2 py-0.5 rounded-full transition"
    }, "\uD83D\uDCC5 ", scheduleYear, " \u975E\u672C\u5E74\u5EA6 \xB7 \u50C5\u6AA2\u8996 \xB7 \u56DE\u5230 ", todayYear, " \u5E74"), isCurrentYear && role === 'member' && isViewingPast && /*#__PURE__*/React.createElement("button", {
      onClick: goToCurrentWeek,
      className: "ml-2 flex items-center bg-yellow-500/90 hover:bg-yellow-400 text-slate-900 text-[10px] font-bold px-2 py-0.5 rounded-full transition"
    }, "\uD83D\uDD12 \u552F\u8B80\u6AA2\u8996\u4E2D \xB7 \u8FD4\u56DE\u672C\u9031 W", String(todayWeek).padStart(2, '0')), isCurrentYear && role === 'manager' && isFutureWeek && /*#__PURE__*/React.createElement("button", {
      onClick: goToCurrentWeek,
      title: `W${String(currentWeek).padStart(2, '0')} 尚未到，僅供檢視排程；點擊返回本週`,
      className: "ml-2 flex items-center bg-yellow-500/90 hover:bg-yellow-400 text-slate-900 text-[10px] font-bold px-2 py-0.5 rounded-full transition"
    }, "\uD83D\uDCC5 \u672A\u4F86\u9031\u6B21 \xB7 \u50C5\u6AA2\u8996 \xB7 \u8FD4\u56DE\u672C\u9031 W", String(todayWeek).padStart(2, '0'))), currentUser && syncFailures >= 2 && /*#__PURE__*/React.createElement("div", {
      role: "status",
      "aria-live": "polite",
      className: "flex items-center gap-2 px-3 py-1 rounded-full bg-amber-300 text-amber-950 text-[11px] font-bold border border-amber-600 shadow"
    }, /*#__PURE__*/React.createElement("span", {
      "aria-hidden": "true"
    }, "\u26A0"), /*#__PURE__*/React.createElement("span", null, "\u9023\u7DDA\u4E2D\u65B7\uFF0C\u756B\u9762\u70BA", lastSyncAt ? ` ${String(lastSyncAt.getHours()).padStart(2, '0')}:${String(lastSyncAt.getMinutes()).padStart(2, '0')} ` : '稍早 ', "\u7684\u5FEB\u7167"), /*#__PURE__*/React.createElement("button", {
      onClick: () => {
        refreshData().catch(() => {});
      },
      className: "px-1.5 py-0.5 rounded bg-amber-800 text-white hover:bg-amber-900 transition",
      "aria-label": "\u7ACB\u5373\u91CD\u65B0\u9023\u7DDA\u4E26\u66F4\u65B0\u8CC7\u6599",
      title: "\u7ACB\u5373\u91CD\u65B0\u9023\u7DDA"
    }, "\u91CD\u65B0\u9023\u7DDA"))), currentUser && /*#__PURE__*/React.createElement("div", {
      className: "flex items-center space-x-2"
    }, !isResults && !showWeeklyReport && role === 'member' && allowRetroCheckin && !isReportingWeek && !isFutureWeek &&
    /*#__PURE__*/
    // 主管開放補登時:成員檢視非當週可直接修改該週回報(任務打卡/非專案/下週預計;主管回覆不可異動)
    React.createElement("button", {
      onClick: () => setShowRetroPanel(true),
      className: "bg-amber-700/80 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold shadow-md transition flex items-center gap-1 border border-amber-400/80",
      title: `主管已開放補登：可修改 W${String(currentWeek).padStart(2, '0')} 的任務打卡、非專案事項與下週預計工作`
    }, "\uD83D\uDD58 \u4FEE\u6539 W", String(currentWeek).padStart(2, '0'), " \u56DE\u5831"), !isResults && !showWeeklyReport && role === 'member' && isCurrentYear &&
    /*#__PURE__*/
    // 本週回報的三件事(任務打卡/下週預計/非專案事項)合併為單一入口;紅點=未回報任務+未填下週預計(非專案為選填不計)
    // 非本年度整顆收起:那裡沒有「本週」
    // 琥珀 amber-600(2026-09-14 三輪定案):原本 bg-amber-500(#F59E0B)使用者說「太亮太刺眼」;改主管同款 amber-700/80
    // → 深色下與「⏰ 即將到期」撞色;改 emerald-700 翠綠 → 使用者「不好,退回黃色但不要那麼亮」。
    // 現行＝amber-600(#D97706),深淺兩色鎖同一值(input.css 明示 .dark .bg-amber-600),比 500 沉、比主管的 700/80 亮一階。
    // hover 用 opacity 不換色階(免再開一組 .dark 映射)。⚠ 白字在 amber-600 對比 2.86,是使用者明確選擇的例外。
    React.createElement("button", {
      onClick: () => setShowPendingPanel(true),
      className: "relative bg-amber-600 hover:opacity-90 text-white px-3.5 py-1.5 rounded-lg text-xs font-bold shadow-md transition flex items-center gap-1.5 border border-amber-400/80"
    }, /*#__PURE__*/React.createElement("span", null, "\uD83D\uDCCB \u672C\u9031\u56DE\u5831\u4E2D\u5FC3"), totalPendingCount > 0 && /*#__PURE__*/React.createElement("span", {
      className: "bg-red-600 text-white text-[11px] px-1.5 py-0.5 rounded-full font-black shadow leading-none"
    }, totalPendingCount)), !isResults && !showWeeklyReport && role === 'manager' && !isFutureWeek && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("button", {
      onClick: () => setShowWeekEditPanel(true),
      className: "bg-amber-700/80 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold shadow-md transition flex items-center gap-1 border border-amber-400/80",
      title: `編輯 W${String(currentWeek).padStart(2, '0')} 各成員回報：代成員補登/修正任務打卡、非專案事項、下週預計工作，並可編輯主管回覆`
    }, "\uD83D\uDEE0 \u7DE8\u8F2F W", String(currentWeek).padStart(2, '0'), " \u56DE\u5831")), !isResults && /*#__PURE__*/React.createElement("button", {
      onClick: () => setShowWeeklyReport(true),
      className: "bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-md text-xs font-bold shadow transition border border-blue-400/50"
    }, "\uD83D\uDCCA W", String(currentWeek).padStart(2, '0'), " \u5718\u968A\u7E3D\u7D50"), /*#__PURE__*/React.createElement("div", {
      className: "flex items-center space-x-3 border-l border-white/20 pl-3 ml-1"
    }, role === 'manager' && /*#__PURE__*/React.createElement("div", {
      className: "relative"
    }, /*#__PURE__*/React.createElement("button", {
      onClick: e => {
        const r = e.currentTarget.getBoundingClientRect();
        setAdminMenuPos({
          top: r.bottom + 6,
          right: window.innerWidth - r.right
        });
        setShowAdminMenu(v => !v);
      },
      "aria-expanded": showAdminMenu,
      "aria-haspopup": "true",
      className: `px-3 py-1.5 rounded-md text-xs font-bold shadow transition border border-white/20 text-white ${showAdminMenu ? 'bg-white/25' : 'bg-white/10 hover:bg-white/20'}`,
      title: "\u7BA1\u7406\u529F\u80FD\uFF1A\u6B77\u53F2\u88DC\u767B\u958B\u95DC\u3001\u6210\u54E1\u7BA1\u7406\u3001\u700F\u89BD\u6B0A\u9650\u3001\u4F7F\u7528\u7D71\u8A08\u3001\u7570\u52D5\u7D00\u9304"
    }, "\u2699\uFE0F \u7BA1\u7406 ", showAdminMenu ? '▴' : '▾')), /*#__PURE__*/React.createElement("div", {
      className: "text-right leading-tight"
    }, /*#__PURE__*/React.createElement("div", {
      className: "font-bold text-sm"
    }, currentUser), /*#__PURE__*/React.createElement("div", {
      className: "text-[10px] text-white/80"
    }, role === 'manager' ? '主管' : '成員', empId ? ` · 工號 ${empId}` : '')), /*#__PURE__*/React.createElement("a", {
      href: `${API_BASE}/${encodeURIComponent('使用者手冊.html')}?role=${role === 'manager' ? 'manager' : 'member'}&theme=${isDark ? 'dark' : 'light'}`,
      target: "_blank",
      rel: "noopener noreferrer",
      className: "p-1.5 hover:bg-white/20 rounded-lg transition text-white/80 hover:text-white bg-white/5 w-8 h-8 flex items-center justify-center",
      "aria-label": "\u958B\u555F\u4F7F\u7528\u624B\u518A\uFF08\u65B0\u5206\u9801\uFF09",
      title: "\u4F7F\u7528\u624B\u518A\uFF08\u958B\u65B0\u5206\u9801\uFF09"
    }, /*#__PURE__*/React.createElement("svg", {
      className: "w-4 h-4",
      fill: "none",
      stroke: "currentColor",
      viewBox: "0 0 24 24",
      "aria-hidden": "true"
    }, /*#__PURE__*/React.createElement("path", {
      strokeLinecap: "round",
      strokeLinejoin: "round",
      strokeWidth: 2,
      d: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
    }))), /*#__PURE__*/React.createElement("button", {
      onClick: () => setIsDark(v => !v),
      className: "p-1.5 hover:bg-white/20 rounded-lg transition text-white/80 hover:text-white bg-white/5 text-sm leading-none w-8 h-8 flex items-center justify-center",
      "aria-label": isDark ? '切換為淺色模式' : '切換為深色模式',
      title: isDark ? '切換為淺色模式' : '切換為深色模式'
    }, isDark ? '☀️' : '🌙'), /*#__PURE__*/React.createElement("button", {
      onClick: handleLogout,
      className: "p-1.5 hover:bg-red-500/80 rounded-lg transition text-white/70 hover:text-white bg-white/5",
      "aria-label": "\u767B\u51FA",
      title: "\u767B\u51FA"
    }, /*#__PURE__*/React.createElement("svg", {
      className: "w-4 h-4",
      fill: "none",
      stroke: "currentColor",
      viewBox: "0 0 24 24"
    }, /*#__PURE__*/React.createElement("path", {
      strokeLinecap: "round",
      strokeLinejoin: "round",
      strokeWidth: 2,
      d: "M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
    })))))), showAdminMenu && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
      className: "fixed inset-0 z-[60]",
      onClick: () => setShowAdminMenu(false)
    }), /*#__PURE__*/React.createElement("div", {
      className: "fixed z-[70] w-44 bg-white rounded-xl shadow-2xl modal-card border border-slate-300 py-1.5 overflow-hidden",
      style: {
        top: adminMenuPos.top,
        right: adminMenuPos.right
      },
      role: "menu"
    }, [
    // 補登總開關(2026-09-13 從工具列移進來):改全體寫入權限的系統設定,放在第一項並用琥珀色標示 ON 狀態。
    // 關閉的入口另有兩處:此處、以及開啟時畫面上的琥珀橫幅「關閉歷史補登」。
    // ⚠ 標籤寫「動作」、小字寫「現況」(2026-09-13 使用者問):原本標籤是「歷史補登:僅限當週」這種狀態描述,
    //   點下去卻做相反的事,其他四項都是「點了會去哪」,只有這項要先讀小字才知道是開還是關。
    //   名稱全站統一叫「歷史補登」(橫幅、toast 原本叫「豁免期」「調正歷史進度」,同一件事三個名字)。
    {
      icon: allowRetroCheckin ? '🔒' : '🔓',
      label: allowRetroCheckin ? '關閉歷史補登' : '開放歷史補登',
      desc: allowRetroCheckin ? '目前：開放中，全體可補登歷史週次' : '目前：僅限當週回報',
      open: toggleRetroCheckin,
      cls: allowRetroCheckin ? 'bg-amber-100 hover:bg-amber-200' : ''
    }, {
      icon: '👥',
      label: '成員管理',
      desc: '新增/移除/改名',
      open: () => setShowMemberPanel(true)
    }, {
      icon: '🔐',
      label: '瀏覽權限',
      desc: '部門/工號卡控',
      open: () => setShowAccessPanel(true)
    }, {
      icon: '📈',
      label: '使用統計',
      desc: '登入次數/使用率',
      open: () => setShowUsagePanel(true)
    }, {
      icon: '📜',
      label: '異動紀錄',
      desc: '操作稽核',
      open: () => setShowAuditPanel(true)
    }].map(item => /*#__PURE__*/React.createElement("button", {
      key: item.label,
      role: "menuitem",
      onClick: () => {
        setShowAdminMenu(false);
        item.open();
      },
      className: `w-full text-left px-3.5 py-2 transition flex items-center gap-2.5 ${item.cls || 'hover:bg-slate-100'}`
    }, /*#__PURE__*/React.createElement("span", {
      className: "text-base"
    }, item.icon), /*#__PURE__*/React.createElement("span", {
      className: "min-w-0"
    }, /*#__PURE__*/React.createElement("span", {
      className: "block text-xs font-bold text-slate-800"
    }, item.label), /*#__PURE__*/React.createElement("span", {
      className: "block text-[10px] text-slate-500"
    }, item.desc)))))), dataLoading ? /*#__PURE__*/React.createElement(LoadingScreen, null) : dataError ? /*#__PURE__*/React.createElement(ErrorScreen, {
      message: dataError,
      onRetry: loadBootstrap
    }) : !currentUser ? /*#__PURE__*/React.createElement(LoginScreen, {
      onLogin: handleLogin,
      users: users,
      year: scheduleYear,
      empId: empId,
      siteName: siteName
    }) :
    /*#__PURE__*/
    // 主內容區在看板開啟時整塊內縮(讓出的寬度給看板),工具列與甘特都只跨左半邊:
    // ①「週檢視/年度總覽/密度」那排會待在甘特正上方,不會飄到看板頭上
    // ②甘特可視寬與捲動範圍都排除看板區 → 當週能真的置中、年底區間捲得出來
    // ③看板本身是 fixed 從視窗最頂端蓋下來(連 header 一起蓋),視覺上是一整條完整欄位
    // ⚠ 內縮後工具列會變窄,務必同時收起「找資料」類控制項,否則 overflow-x-auto 會吐橫向捲軸
    React.createElement("div", {
      className: "flex-1 min-h-0 flex overflow-hidden bg-white relative",
      style: {
        marginRight: showWeeklyReport ? reportPanelW : 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "flex-1 min-w-0 flex flex-col overflow-hidden"
    }, isResults ? /*#__PURE__*/React.createElement("div", {
      className: "px-4 py-2 border-b border-slate-300 bg-gradient-to-r from-amber-50/80 via-white to-white dark:bg-none dark:bg-slate-800 flex items-center justify-between text-xs overflow-x-auto"
    }, /*#__PURE__*/React.createElement("div", {
      className: "flex items-center gap-3"
    }, /*#__PURE__*/React.createElement("span", {
      className: "font-black text-amber-800 dark:text-amber-300 text-sm"
    }, "\uD83C\uDFAF ", scheduleYear, " \u5E74\u5EA6\u6210\u679C\u8207 MP \u6548\u76CA\u6E05\u55AE"), /*#__PURE__*/React.createElement("span", {
      className: "text-slate-500"
    }, "\u6AA2\u8996\u6240\u6709\u5C08\u6848\u5B8C\u5DE5\u9810\u8A08\u4EA4\u4ED8\u4E4B\u5177\u9AD4\u7522\u51FA\u8207\u7D2F\u8A08\u7BC0\u7701\u4E4B MP \u4EBA\u529B")), /*#__PURE__*/React.createElement("div", {
      className: "flex items-center gap-4"
    }, /*#__PURE__*/React.createElement("div", {
      className: "bg-amber-100/80 border border-amber-300 text-amber-900 px-3 py-1 rounded-full font-bold"
    }, "\u5DF2\u586B\u5BEB\u7522\u51FA\u9805\u76EE\uFF1A", projects.filter(p => p.deliverable).length, " / ", projects.length, " \u6848"), /*#__PURE__*/React.createElement("div", {
      className: "bg-emerald-100/80 border border-emerald-300 text-emerald-900 px-3 py-1 rounded-full font-bold"
    }, "\uD83D\uDCA1 MP Saving\uFF1A", projects.filter(p => p.mpSaving).length, " \u6848"))) : /*#__PURE__*/React.createElement("div", {
      className: `py-2 border-b border-slate-300 bg-gradient-to-r from-slate-50 to-white flex items-center text-xs overflow-x-auto ${ultraTightStatsBar ? 'px-2 gap-2 gap-y-1 flex-wrap' : 'px-4 gap-3'}`
    }, /*#__PURE__*/React.createElement("div", {
      className: "flex items-center flex-shrink-0"
    }, /*#__PURE__*/React.createElement("span", {
      className: "font-black text-slate-900 text-sm"
    }, "W", String(currentWeek).padStart(2, '0')), /*#__PURE__*/React.createElement("span", {
      className: "ml-1 text-[10px] font-bold text-slate-700"
    }, ownerFilter === 'all' ? '全員' : ownerFilter, "\u6982\u6CC1")), /*#__PURE__*/React.createElement("div", {
      className: `flex items-center flex-shrink-0 ${ultraTightStatsBar ? 'min-w-[120px]' : 'min-w-[150px]'}`
    }, /*#__PURE__*/React.createElement("div", {
      className: "flex-1 h-2 bg-slate-300 rounded-full overflow-hidden"
    }, /*#__PURE__*/React.createElement("div", {
      className: `h-full rounded-full transition-all duration-500 ${weekStats.active > 0 && weekStats.reported === weekStats.active ? 'bg-green-600' : 'bg-indigo-600'}`,
      style: {
        width: `${weekStats.active > 0 ? weekStats.reported / weekStats.active * 100 : 0}%`
      }
    })), /*#__PURE__*/React.createElement("span", {
      className: "ml-2 font-bold text-slate-800 whitespace-nowrap"
    }, weekStats.reported, "/", weekStats.active, " \u5DF2\u56DE\u5831")), !showWeeklyReport && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
      className: "h-6 border-l border-slate-300 flex-shrink-0"
    }), /*#__PURE__*/React.createElement("div", {
      className: "flex items-center gap-3 flex-shrink-0"
    }, statusChipsVisible && /*#__PURE__*/React.createElement(StatCount, {
      label: "\u6709\u57F7\u884C",
      value: weekStats.executed,
      dotClass: "bg-green-700",
      title: "\u672C\u9031\u56DE\u5831\u300C\u6709\u57F7\u884C\u300D\u7684\u56DE\u5831\u55AE\u4F4D\u6578\uFF1B\u7518\u7279\u689D\u4E0A\u8A72\u9031\u7684\u7DA0\u8272\u9EDE\uFF1D\u6709\u57F7\u884C"
    }), statusChipsVisible && /*#__PURE__*/React.createElement(StatCount, {
      label: "Monitor",
      value: weekStats.monitor,
      dotClass: "bg-sky-700",
      title: "\u672C\u9031\u56DE\u5831\u300CMonitor\uFF08\u4F8B\u884C\u76E3\u63A7\uFF09\u300D\u7684\u56DE\u5831\u55AE\u4F4D\u6578\uFF1B\u7518\u7279\u689D\u4E0A\u8A72\u9031\u7684\u85CD\u8272\u9EDE\uFF1DMonitor"
    }), statusChipsVisible && /*#__PURE__*/React.createElement(StatCount, {
      label: "\u672A\u57F7\u884C",
      value: weekStats.notExec,
      dotClass: "bg-slate-500",
      title: "\u672C\u9031\u56DE\u5831\u300C\u672A\u57F7\u884C\u300D\u7684\u56DE\u5831\u55AE\u4F4D\u6578\uFF08\u6709\u56DE\u5831\u3001\u4F46\u672C\u9031\u6C92\u505A\uFF1D\u8981\u8FFD\u539F\u56E0\uFF09\uFF1B\u7518\u7279\u689D\u4E0A\u8A72\u9031\u7684\u7070\u8272\u9EDE\uFF1D\u672A\u57F7\u884C"
    }), /*#__PURE__*/React.createElement(StatCount, {
      label: "\u672A\u56DE\u5831",
      value: weekStats.pending,
      valueClass: weekStats.pending > 0 ? 'text-amber-800' : 'text-slate-500',
      title: "\u672C\u9031\u6392\u5B9A\u4F46\u5C1A\u672A\u56DE\u5831\u7684\u56DE\u5831\u55AE\u4F4D\u6578\uFF08\u8981\u50AC\uFF09\uFF1B\u7518\u7279\u689D\u4E0A\u7684\u7D05\u6846\uFF1D\u5F85\u56DE\u5831\u3002\u8981\u770B\u662F\u8AB0\u3001\u8981\u8907\u88FD\u50AC\u5831\u540D\u55AE\uFF0C\u958B\u300C\uD83D\uDCCA \u5718\u968A\u7E3D\u7D50\u300D"
    }), /*#__PURE__*/React.createElement("button", {
      onClick: () => setShowDeadlinePanel(true),
      title: "\u9EDE\u64CA\u6AA2\u8996\u5373\u5C07\u5230\u671F\u6E05\u55AE",
      className: `flex-shrink-0 pl-2 pr-2.5 py-1 rounded-full font-bold flex items-center gap-1 border transition ${deadlineTasks.length > 0 ? 'bg-orange-100 text-orange-800 hover:bg-orange-200 border-orange-500' : 'bg-slate-100 text-slate-500 hover:bg-slate-200 border-slate-300'}`
    }, /*#__PURE__*/React.createElement("span", {
      className: "font-medium text-[11px]"
    }, "\u23F0 \u5373\u5C07\u5230\u671F"), /*#__PURE__*/React.createElement("span", {
      className: "text-[13px] leading-none"
    }, deadlineTasks.length), /*#__PURE__*/React.createElement("span", {
      className: "text-[11px]"
    }, "\u203A")))), /*#__PURE__*/React.createElement("div", {
      className: "flex-1 min-w-[8px]"
    }), /*#__PURE__*/React.createElement("div", {
      className: "flex-shrink-0 flex items-center gap-2 text-[11px] text-slate-600 border border-slate-300 rounded-lg bg-white ctl-raised px-2 py-0.5"
    }, /*#__PURE__*/React.createElement("span", {
      className: "flex items-center",
      title: "\u9EC3\u8272\u659C\u7D0B\u689D\uFF1D\u8A08\u756B\u5340\u9593(\u6392\u5B9A\u7684\u8D77\u8A16\u9031)"
    }, /*#__PURE__*/React.createElement("span", {
      className: "w-3 h-2.5 mr-1 rounded-sm border",
      style: {
        backgroundImage: 'repeating-linear-gradient(45deg,#FFF6D6,#FFF6D6 3px,#FDEDB8 3px,#FDEDB8 6px)',
        borderColor: '#B45309'
      }
    }), "\u8A08\u756B"), hasAnySubs && /*#__PURE__*/React.createElement("span", {
      className: "flex items-center",
      title: "\u9752\u7DA0\u659C\u7D0B\u689D\uFF1D\u8A08\u756B\u5340\u9593\u5E95\u4E0B\u7684\u5B50\u5340\u9593(\u968E\u6BB5,\u53EF\u91CD\u758A;\u8207\u9EC3\u8272\u7684\u8A08\u756B\u5340\u9593\u660E\u78BA\u5206\u8272)\u3002\u6ED1\u904E\u689D\u53EF\u770B\u672A\u958B\u59CB\uFF0F\u9032\u884C\u4E2D\uFF0F\u5DF2\u7D50\u675F"
    }, /*#__PURE__*/React.createElement("span", {
      className: "w-3 h-2.5 mr-1 rounded-sm border",
      style: {
        backgroundImage: 'repeating-linear-gradient(45deg,#CCFBF1,#CCFBF1 3px,#BDF7EC 3px,#BDF7EC 6px)',
        borderColor: 'rgba(15,118,110,0.75)'
      }
    }), "\u5B50\u5340\u9593"), !statusChipsVisible && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
      className: "flex items-center",
      title: "\u7DA0\u8272\uFF1D\u8A72\u9031\u56DE\u5831\u300C\u6709\u57F7\u884C\u300D"
    }, /*#__PURE__*/React.createElement("span", {
      className: "w-2.5 h-2.5 bg-green-700 mr-1 rounded-sm"
    }), "\u6709\u57F7\u884C"), /*#__PURE__*/React.createElement("span", {
      className: "flex items-center",
      title: "\u85CD\u8272\uFF1D\u8A72\u9031\u56DE\u5831\u300CMonitor(\u4F8B\u884C\u76E3\u63A7)\u300D"
    }, /*#__PURE__*/React.createElement("span", {
      className: "w-2.5 h-2.5 bg-sky-700 mr-1 rounded-sm"
    }), "Monitor"), /*#__PURE__*/React.createElement("span", {
      className: "flex items-center",
      title: "\u7070\u8272\uFF1D\u8A72\u9031\u56DE\u5831\u300C\u672A\u57F7\u884C\u300D"
    }, /*#__PURE__*/React.createElement("span", {
      className: "w-2.5 h-2.5 bg-slate-500 mr-1 rounded-sm"
    }), "\u672A\u57F7\u884C")), /*#__PURE__*/React.createElement("span", {
      className: "flex items-center",
      title: "\u7D05\u6846\uFF0B\u2757\uFF1D\u672C\u9031\u6392\u5B9A\u4F46\u5C1A\u672A\u56DE\u5831\u7684\u4EFB\u52D9"
    }, /*#__PURE__*/React.createElement("span", {
      className: "w-3 h-2.5 mr-1 rounded-sm border-2 border-red-400 bg-white"
    }), "\u2757\u5F85\u56DE\u5831"), !tightStatsBar && /*#__PURE__*/React.createElement("span", {
      className: "flex items-center text-slate-600 border-l border-slate-300 pl-2",
      title: "\u9375\u76E4\u5FEB\u6377\u9375\uFF1AH\uFF1D\u56DE\u5230\u672C\u9031\u4E26\u7F6E\u4E2D\uFF1B\u2190 \u2192\uFF1D\u5DE6\u53F3\u5E73\u79FB 4 \u9031\uFF1BShift\uFF0B\u2190 \u2192\uFF1D\u5FAE\u79FB 1 \u9031\uFF1BTab \u9032\u5165\u7518\u7279\u689D\u5F8C \u2191 \u2193\uFF1D\u4E0A\u4E0B\u5207\u63DB\u7518\u7279\u689D\u3001Enter\uFF1D\u958B\u555F\u8A72\u5340\u9593\uFF1BESC\uFF1D\u95DC\u9589\u6700\u4E0A\u5C64\u8996\u7A97"
    }, "\u2328 H \u56DE\u672C\u9031\u30FB\u2190\u2192 \u5E73\u79FB\u30FB\u2191\u2193 \u63DB\u689D"))), /*#__PURE__*/React.createElement("div", {
      className: "bg-white px-4 py-1.5 border-b border-slate-300 flex flex-nowrap items-center gap-1.5 text-[11px] z-30 overflow-x-auto [&>*]:flex-shrink-0"
    }, (!tightToolbar || searchText) && /*#__PURE__*/React.createElement("div", {
      className: "relative"
    }, /*#__PURE__*/React.createElement("svg", {
      className: "w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-slate-500",
      fill: "none",
      stroke: "currentColor",
      viewBox: "0 0 24 24"
    }, /*#__PURE__*/React.createElement("path", {
      strokeLinecap: "round",
      strokeLinejoin: "round",
      strokeWidth: 2,
      d: "M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z"
    })), /*#__PURE__*/React.createElement("input", {
      value: searchText,
      onChange: e => setSearchText(e.target.value),
      placeholder: "\u641C\u5C0B\u5C08\u6848 / \u4EFB\u52D9\u2026",
      className: `pl-7 pr-6 py-1 border border-slate-300 rounded-lg outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-200 transition ${tightToolbar ? 'w-32' : 'w-44'}`
    }), searchText && /*#__PURE__*/React.createElement("button", {
      onClick: () => setSearchText(''),
      className: "absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-600 font-bold px-1"
    }, "\xD7")), (!tightToolbar || typeFilter.size > 0) && /*#__PURE__*/React.createElement("div", {
      className: "flex items-center space-x-1"
    }, Object.entries(PROJECT_TYPES).map(([key, meta]) => {
      const on = typeFilter.has(key);
      if (tightToolbar && !on) return null; // 空間不足時只留「已選中」的晶片(方便一鍵取消)
      return /*#__PURE__*/React.createElement("button", {
        key: key,
        onClick: () => toggleTypeFilter(key),
        className: `px-1.5 py-0.5 rounded-full border font-bold transition ${on ? meta.chip + ' ring-1 ring-offset-1 ring-slate-500' : 'bg-white ctl-raised text-slate-700 border-slate-400 hover:border-slate-600 hover:bg-slate-50'}`,
        title: `${key}・${meta.label}`,
        "aria-label": `${on ? '取消篩選' : '篩選'} ${key} ${meta.label}`
      }, key, " ", meta.short);
    }), typeFilter.size > 0 && /*#__PURE__*/React.createElement("button", {
      onClick: () => setTypeFilter(new Set()),
      className: "text-blue-600 hover:underline px-1"
    }, "\u6E05\u9664")), (!tightToolbar || searchText || typeFilter.size > 0) && /*#__PURE__*/React.createElement("div", {
      className: "h-5 border-l border-slate-300"
    }), /*#__PURE__*/React.createElement("select", {
      value: ownerFilter,
      onChange: e => setOwnerFilter(e.target.value),
      title: "\u7BE9\u9078\u8981\u986F\u793A\u54EA\u4F4D\u6210\u54E1\u7684\u5C08\u6848",
      className: "border border-slate-300 rounded-lg px-2 py-1 outline-none bg-white ctl-raised font-medium text-slate-700"
    }, /*#__PURE__*/React.createElement("option", {
      value: "all"
    }, "\u5168\u90E8\u6210\u54E1"), users.map(u => /*#__PURE__*/React.createElement("option", {
      key: u,
      value: u
    }, u))), /*#__PURE__*/React.createElement("div", {
      className: "flex-1"
    }), /*#__PURE__*/React.createElement("select", {
      value: scheduleYear,
      onChange: e => setScheduleYear(parseInt(e.target.value)) // 系統週由 refreshData 在該年度載入後切到本週並置中(那時才知道該年有幾週)
      ,
      title: "\u5207\u63DB\u6392\u7A0B\u5E74\u5EA6(\u5E74\u5EA6\u8CC7\u6599\u7531 DB \u7684 ScheduleWeeks \u6C7A\u5B9A)",
      className: "border border-slate-300 rounded-lg px-2 py-1 outline-none bg-white ctl-raised font-bold text-slate-700"
    }, (years.length ? years : [scheduleYear]).map(y => /*#__PURE__*/React.createElement("option", {
      key: y,
      value: y
    }, y, " \u5E74\u5EA6"))), /*#__PURE__*/React.createElement("div", {
      className: "flex rounded-lg overflow-hidden border",
      style: {
        borderColor: BRAND_BTN
      }
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => {
        setIsOverview(false);
        setIsResults(false);
        savePref('overview', false);
      },
      className: `px-2 py-1 font-bold transition ${!isOverview && !isResults ? 'text-white' : 'bg-white text-slate-600 hover:bg-slate-100'}`,
      style: !isOverview && !isResults ? {
        backgroundColor: BRAND_BTN
      } : {}
    }, "\u9031\u6AA2\u8996"), /*#__PURE__*/React.createElement("button", {
      onClick: () => {
        setIsOverview(true);
        setIsResults(false);
        savePref('overview', true);
      },
      className: `px-2 py-1 font-bold transition ${isOverview && !isResults ? 'text-white' : 'bg-white text-slate-600 hover:bg-slate-100'}`,
      style: isOverview && !isResults ? {
        backgroundColor: BRAND_BTN
      } : {},
      title: `整年 ${weeksTotal} 週自動縮放至一個畫面寬(無水平捲軸),滑鼠停留甘特條可看細節`
    }, "\u5E74\u5EA6\u7E3D\u89BD"), !showWeeklyReport && /*#__PURE__*/React.createElement("button", {
      onClick: () => {
        if (showWeeklyReport) {
          setShowWeeklyReport(false);
          clearHighlight();
          setCollapsedOwners(new Set());
          setOwnerFilter(defaultOwnerFilter(role, currentUser)); // 清掉看板高亮造成的單一成員聚焦
        }
        setIsOverview(false);
        setIsResults(true);
      },
      className: `px-2 py-1 font-bold transition ${isResults ? 'text-white' : 'bg-white text-slate-600 hover:bg-slate-100'}`,
      style: isResults ? {
        backgroundColor: BRAND_BTN
      } : {},
      title: "\u6AA2\u8996\u5168\u5E74\u5EA6\u6240\u6709\u5C08\u6848\u7684\u5177\u9AD4\u7522\u51FA\u9805\u76EE\u8207 MP Saving \u7D71\u8A08(\u9AD8\u968E\u4E3B\u7BA1\u700F\u89BD\u8996\u89D2,\u552F\u8B80)"
    }, "\u6210\u679C\u6E05\u55AE")), !isResults && /*#__PURE__*/React.createElement("button", {
      onClick: goToCurrentWeek,
      title: isCurrentYear ? isReportingWeek ? `已在本週 W${String(todayWeek).padStart(2, '0')}，點擊重新置中（快捷鍵 H）` : `回到本週 W${String(todayWeek).padStart(2, '0')} 並置中（快捷鍵 H）` : `切回 ${todayYear} 年度的本週（快捷鍵 H）`,
      className: `flex items-center px-2 py-1 rounded-lg font-bold ${isReportingWeek ? 'bg-white ctl-raised text-slate-700 border border-slate-300 hover:bg-slate-100' : 'text-white shadow-sm hover:opacity-90'}`,
      style: isReportingWeek ? {} : {
        backgroundColor: BRAND_BTN
      }
    }, /*#__PURE__*/React.createElement("svg", {
      className: "w-3.5 h-3.5 mr-1",
      fill: "none",
      stroke: "currentColor",
      viewBox: "0 0 24 24"
    }, /*#__PURE__*/React.createElement("path", {
      strokeLinecap: "round",
      strokeLinejoin: "round",
      strokeWidth: 2,
      d: "M13 10V3L4 14h7v7l9-11h-7z"
    })), "\u56DE\u5230\u672C\u9031"), /*#__PURE__*/React.createElement("div", {
      className: "h-5 w-px bg-slate-300/80 mx-1 flex-shrink-0"
    }), !isOverview && !isResults && /*#__PURE__*/React.createElement("button", {
      onClick: () => {
        const v = !isCompact;
        setIsCompact(v);
        savePref('compact', v);
      },
      className: "text-slate-600 bg-slate-100 ctl-raised hover:bg-slate-200 px-2 py-1 rounded-lg border border-slate-300 font-medium transition"
    }, isCompact ? '寬鬆模式' : '緊湊模式'), !isResults && displayMenuItems.length > 0 && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
      className: "h-5 w-px bg-slate-300/80 mx-1 flex-shrink-0"
    }), /*#__PURE__*/React.createElement("button", {
      onClick: e => {
        const r = e.currentTarget.getBoundingClientRect();
        setDisplayMenuPos({
          top: r.bottom + 6,
          right: window.innerWidth - r.right
        });
        setShowDisplayMenu(v => !v);
      },
      "aria-expanded": showDisplayMenu,
      "aria-haspopup": "true",
      title: "\u4E00\u6B21\u5C55\u958B\uFF0F\u6536\u5408\u5168\u90E8\u6210\u54E1\u7FA4\u7D44\u6216\u5B50\u5340\u9593",
      className: `px-2 py-1 rounded-lg border font-medium transition ${showDisplayMenu ? 'bg-slate-200 border-slate-400 text-slate-800' : 'bg-white ctl-raised border-slate-300 text-slate-700 hover:bg-slate-50'}`
    }, "\u986F\u793A ", showDisplayMenu ? '▴' : '▾'))), showDisplayMenu && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
      className: "fixed inset-0 z-[60]",
      onClick: () => setShowDisplayMenu(false)
    }), /*#__PURE__*/React.createElement("div", {
      className: "fixed z-[70] w-44 bg-white rounded-xl shadow-2xl modal-card border border-slate-300 py-1.5 overflow-hidden",
      style: {
        top: displayMenuPos.top,
        right: displayMenuPos.right
      },
      role: "menu"
    }, displayMenuItems.map((item, i) => /*#__PURE__*/React.createElement("button", {
      key: item.label,
      role: "menuitem",
      onClick: () => {
        setShowDisplayMenu(false);
        item.run();
      },
      className: `w-full text-left px-3.5 py-2 text-xs font-medium text-slate-800 hover:bg-slate-100 transition ${item.sep && i > 0 ? 'border-t border-slate-200 mt-1 pt-2.5' : ''}`
    }, item.label)))), allowRetroCheckin && /*#__PURE__*/React.createElement("div", {
      className: "bg-amber-50 border-b border-amber-300 px-4 py-2 flex items-center justify-between text-xs text-amber-900 font-bold z-30"
    }, /*#__PURE__*/React.createElement("div", {
      className: "flex items-center gap-2"
    }, /*#__PURE__*/React.createElement("span", {
      className: "text-sm"
    }, "\u26A0\uFE0F"), /*#__PURE__*/React.createElement("span", null, "\u7CFB\u7D71\u5DF2\u958B\u653E\u300C\u6B77\u53F2\u88DC\u767B\u300D\uFF1A\u5168\u9AD4\u6210\u54E1\u76EE\u524D\u53EF\u5C0D W", String(todayWeek).padStart(2, '0'), " \u4EE5\u524D\u4E4B\u6240\u6709\u6B77\u53F2\u9031\u6B21\u9032\u884C\u4EFB\u52D9\u8207\u975E\u5C08\u6848\u56DE\u5831\u3002")), role === 'manager' && /*#__PURE__*/React.createElement("button", {
      onClick: toggleRetroCheckin,
      className: "px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded font-bold shadow-sm transition"
    }, "\u95DC\u9589\u6B77\u53F2\u88DC\u767B")), /*#__PURE__*/React.createElement("div", {
      ref: ganttRef,
      className: "flex-1 min-h-0 overflow-auto bg-slate-100 app-bg relative"
    }, isResults ? /*#__PURE__*/React.createElement(ResultsView, {
      projects: filteredProjects,
      role: role,
      currentUser: currentUser,
      year: scheduleYear,
      starredIds: starredIds,
      toggleStar: toggleStar,
      activeFilters: activeFilters,
      onClearAllFilters: clearAllFilters
    }) : /*#__PURE__*/React.createElement("div", {
      className: "relative",
      style: {
        display: 'grid',
        gridTemplateColumns: isOverview ? '100%' : 'max-content'
      }
    }, /*#__PURE__*/React.createElement("div", {
      "aria-hidden": "true",
      className: "sticky left-0 z-20 pointer-events-none",
      style: {
        gridArea: '1 / 1',
        justifySelf: 'start',
        width: frozenW,
        background: 'var(--frozen-bg)'
      }
    }), /*#__PURE__*/React.createElement("table", {
      className: "border-separate border-spacing-0 bg-white",
      style: {
        gridArea: '1 / 1',
        tableLayout: 'fixed',
        width: isOverview ? '100%' : frozenW + weeksTotal * weekW
      }
    }, /*#__PURE__*/React.createElement("colgroup", null, !isOverview && /*#__PURE__*/React.createElement("col", {
      style: {
        width: 28
      }
    }), !isOverview && /*#__PURE__*/React.createElement("col", {
      style: {
        width: 42
      }
    }), /*#__PURE__*/React.createElement("col", {
      style: {
        width: nameW
      }
    }), Array.from({
      length: weeksTotal
    }).map((_, i) => /*#__PURE__*/React.createElement("col", {
      key: i,
      style: isOverview ? undefined : {
        width: weekW
      }
    }))), /*#__PURE__*/React.createElement("thead", {
      className: "sticky top-0 z-50 text-xs shadow-sm bg-slate-100"
    }, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", {
      colSpan: isOverview ? 1 : 3,
      className: "border-r border-b border-slate-300 bg-slate-200 sticky left-0 z-50 px-2 py-1 text-left",
      style: {
        width: frozenW
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "flex justify-between items-center text-[10px]"
    }, /*#__PURE__*/React.createElement("span", {
      className: "font-bold text-slate-700"
    }, "\u5C08\u6848\u57FA\u672C\u8CC7\u8A0A"), /*#__PURE__*/React.createElement("span", {
      className: "text-slate-700 font-normal"
    }, "\u986F\u793A ", filteredProjects.length, " / ", projects.length, " \u9805"))), months.map((m, i) => /*#__PURE__*/React.createElement("th", {
      key: i,
      colSpan: m.weeks,
      className: "border-r border-b border-slate-300 text-white p-0.5 text-center font-medium text-[11px] tracking-wider relative overflow-hidden",
      style: {
        backgroundColor: i % 2 === 0 ? NAVY : '#0A3178'
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "absolute inset-0 bg-gradient-to-b from-white/10 to-transparent"
    }), m.name.slice(0, 4), "/", m.name.slice(4)))), /*#__PURE__*/React.createElement("tr", {
      className: "bg-slate-100 text-slate-600 text-[11px]"
    }, !isOverview && /*#__PURE__*/React.createElement("th", {
      className: "border-r border-b border-slate-300 p-1 sticky left-0 z-50 text-center font-medium",
      style: {
        width: 28,
        minWidth: 28,
        maxWidth: 28,
        backgroundColor: 'var(--gantt-sticky)'
      }
    }, "No"), !isOverview && /*#__PURE__*/React.createElement("th", {
      className: "border-r border-b border-slate-300 p-1 sticky z-50 text-center font-medium",
      style: {
        width: 42,
        minWidth: 42,
        maxWidth: 42,
        left: 28,
        backgroundColor: 'var(--gantt-sticky)'
      }
    }, "\u5206\u985E"), /*#__PURE__*/React.createElement("th", {
      className: "border-r border-b border-slate-300 p-1 sticky z-50 shadow-[3px_0_6px_rgba(0,0,0,0.08)] text-left pl-3 font-medium",
      style: {
        width: nameW,
        minWidth: nameW,
        maxWidth: nameW,
        left: isOverview ? 0 : STICKY_LEAD_W,
        backgroundColor: 'var(--gantt-sticky)'
      }
    }, "\u5C08\u6848\u540D\u7A31"), Array.from({
      length: weeksTotal
    }).map((_, i) => {
      const weekNum = i + 1;
      const isCurrent = weekNum === currentWeek;
      return /*#__PURE__*/React.createElement("th", {
        key: i,
        onClick: () => {
          if (role === 'manager' || weekNum <= todayWeek) setCurrentWeek(weekNum);
        },
        title: `W${String(weekNum).padStart(2, '0')}（${weekRangeLabel(scheduleYear, weekNum)}）${role === 'manager' ? '・點擊將系統週切換至此' : weekNum <= todayWeek ? '・點擊檢視(唯讀)' : '・尚未到'}`,
        className: `border-r border-b border-slate-300 p-0 text-center relative ${isOverview ? 'text-[9px] leading-none' : ''} ${role === 'manager' || weekNum <= todayWeek ? 'cursor-pointer hover:bg-blue-100' : ''} ${isCurrent ? 'text-white font-bold' : weekNum > todayWeek ? 'bg-slate-100 text-slate-600 font-normal' : 'bg-slate-100 text-slate-700 font-normal'}`,
        style: {
          ...(isOverview ? {} : {
            width: weekW
          }),
          ...(isCurrent ? {
            backgroundColor: NAVY
          } : {})
        }
      }, isCurrent && /*#__PURE__*/React.createElement("div", {
        className: "absolute -bottom-px left-0 right-0 h-0.5",
        style: {
          backgroundColor: GOLD
        }
      }), /*#__PURE__*/React.createElement("div", {
        className: `z-10 relative ${isOverview ? 'py-0.5' : 'py-1'}`
      }, isOverview ? sparseWeekLabel && !isCurrent && weekNum % 5 !== 0 ? ' ' : weekNum : isCompact ? weekNum : `W${String(weekNum).padStart(2, '0')}`));
    }))), /*#__PURE__*/React.createElement("tbody", {
      className: "text-xs"
    }, groupedProjects.length === 0 ? /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
      colSpan: weeksTotal + 3,
      className: "p-10 text-center text-slate-500"
    }, /*#__PURE__*/React.createElement(EmptyFilterState, {
      filters: activeFilters,
      onClearAll: clearAllFilters
    }))) : groupedProjects.map(group => {
      const isCollapsed = collapsedOwners.has(group.owner);
      let gActive = 0,
        gReported = 0;
      group.projects.forEach(p => p.tasks.forEach(t => {
        if (t.start <= currentWeek && t.end >= currentWeek) {
          const wu = weekUnits(t, currentWeek, taskLogs, subLogs); // 以回報單位計(子區間各算一個)
          gActive += wu.total;
          gReported += wu.reported;
        }
      }));
      return /*#__PURE__*/React.createElement(React.Fragment, {
        key: group.owner
      }, /*#__PURE__*/React.createElement("tr", _extends({}, clickable(() => toggleOwnerCollapse(group.owner), null, {
        role: null,
        expanded: !isCollapsed
      }), {
        title: `${isCollapsed ? '展開' : '收合'} ${group.owner} 的專案`,
        className: "group/header bg-[var(--gantt-group)] hover:bg-[var(--gantt-group-hover)] cursor-pointer transition-colors"
      }), /*#__PURE__*/React.createElement("td", {
        colSpan: isOverview ? 1 : 3,
        className: "sticky left-0 z-30 border-r border-b border-blue-200 border-b-blue-100 p-0 shadow-[3px_0_6px_rgba(0,0,0,0.06)]",
        style: {
          width: frozenW,
          minWidth: frozenW,
          maxWidth: frozenW,
          backgroundColor: 'var(--gantt-group)'
        }
      }, /*#__PURE__*/React.createElement("div", {
        className: "flex items-center text-blue-900 font-bold text-[13px] px-2 py-1.5 border-l-4",
        style: {
          borderColor: NAVY
        }
      }, /*#__PURE__*/React.createElement("svg", {
        className: `w-4 h-4 mr-1 text-blue-500 transition-transform ${isCollapsed ? '-rotate-90' : ''}`,
        fill: "none",
        stroke: "currentColor",
        viewBox: "0 0 24 24"
      }, /*#__PURE__*/React.createElement("path", {
        strokeLinecap: "round",
        strokeLinejoin: "round",
        strokeWidth: 2,
        d: "M19 9l-7 7-7-7"
      })), /*#__PURE__*/React.createElement("div", {
        className: "w-6 h-6 rounded-full text-white flex items-center justify-center text-xs mr-2 flex-shrink-0",
        style: {
          backgroundColor: BRAND_BTN
        }
      }, group.owner[0]), group.owner, /*#__PURE__*/React.createElement("span", {
        className: "ml-2 px-1.5 py-0.5 bg-white ctl-raised text-blue-600 rounded text-[10px] font-medium border border-blue-100"
      }, group.projects.length, " \u9805"), gActive > 0 && /*#__PURE__*/React.createElement("div", {
        className: "ml-2 flex items-center gap-1.5"
      }, !isOverview && /*#__PURE__*/React.createElement("div", {
        className: "w-16 h-1.5 bg-white rounded-full overflow-hidden border border-blue-100"
      }, /*#__PURE__*/React.createElement("div", {
        className: `h-full rounded-full ${gReported === gActive ? 'bg-green-600' : 'bg-yellow-400'}`,
        style: {
          width: `${gReported / gActive * 100}%`
        }
      })), /*#__PURE__*/React.createElement("span", {
        className: `px-1.5 py-0.5 rounded text-[10px] font-bold border ${gReported === gActive ? 'bg-green-100 text-green-800 border-green-200' : 'bg-yellow-100 text-yellow-800 border-yellow-300'}`
      }, "\u672C\u9031\u56DE\u5831 ", gReported, "/", gActive)), role === 'manager' && !isOverview && /*#__PURE__*/React.createElement("button", {
        onClick: e => {
          e.stopPropagation();
          setEditingProject({
            mode: 'add',
            owner: group.owner
          });
        },
        className: "ml-auto flex-shrink-0 flex items-center gap-1 bg-white ctl-raised text-blue-700 hover:bg-blue-600 hover:text-white border border-blue-300 rounded px-2 py-0.5 text-[10px] font-bold transition shadow-sm",
        title: `為 ${group.owner} 新增專案`
      }, "\uFF0B \u65B0\u589E\u5C08\u6848"))), /*#__PURE__*/React.createElement("td", {
        colSpan: weeksTotal,
        className: "p-0 border-r border-b border-slate-300 border-b-blue-100"
      }, /*#__PURE__*/React.createElement("div", {
        className: "w-full h-full flex opacity-30"
      }, Array.from({
        length: weeksTotal
      }).map((_, i) => /*#__PURE__*/React.createElement("div", {
        key: i,
        className: `flex-1 border-r border-slate-300 ${i + 1 === currentWeek ? 'bg-red-100' : ''}`
      }))))), !isCollapsed && group.projects.map((proj, idx) => {
        // 子區間(遷移 18):掛在各計畫區間底下、可重疊,展開時以「縮排子列」逐條畫在專案列下方。
        // 一個子區間一列(不擠進父條、也不自動堆疊泳道):重疊區間自然成階梯、名稱在凍結欄一定讀得到。
        const subEntries = proj.tasks.flatMap(task => (task.subs || []).map(sub => ({
          task,
          sub
        })));
        const subCount = subEntries.length;
        const subExpanded = subCount > 0 && isSubExpanded(proj.id);
        // 同一專案有兩條以上計畫區間都帶子區間時,子列名稱前再標父區間名,否則只靠底帶就分得出
        const tasksWithSubs = proj.tasks.filter(t => (t.subs || []).length > 0).length;
        // 拖曳排序的放下目標:專案列與它底下的子列共用同一組 handler(目標一律是 proj.id)。
        // ⚠ 子列在拖曳中**不能藏起來**:上方若有十幾列子區間,一開始拖整張表突然縮短,
        //   游標下的目標會跳成另一個專案(實際踩到)。保留子列、落在子列上=落在父專案上,版面才不動。
        const rowDragOver = role === 'manager' && dragState && dragState.owner === group.owner ? e => {
          e.preventDefault();
          if (dragOverId !== proj.id) setDragOverId(proj.id);
        } : undefined;
        const rowDrop = role === 'manager' && dragState ? e => {
          e.preventDefault();
          handleReorderProjects(group.owner, dragState.id, proj.id);
          setDragState(null);
          setDragOverId(null);
        } : undefined;
        const isDragSource = !!dragState && dragState.id === proj.id;
        // 列底線與拖曳目標的藍線下在每個 td(border-separate 下 tr 的 border 不會畫,見 table 處說明)
        const rowBorder = `border-b border-slate-300 ${dragOverId === proj.id && dragState && !isDragSource ? 'border-t-2 border-t-blue-500' : ''}`;
        return /*#__PURE__*/React.createElement(React.Fragment, {
          key: proj.id
        }, /*#__PURE__*/React.createElement("tr", {
          "data-proj-row": proj.id,
          onDragOver: rowDragOver,
          onDrop: rowDrop,
          className: `group/row transition-colors ${isDragSource ? 'opacity-40' : ''}`
        }, !isOverview && /*#__PURE__*/React.createElement("td", {
          className: `text-center sticky left-0 bg-white group-hover/row:bg-[var(--gantt-row-hover)] z-30 border-r ${rowBorder} text-slate-500 font-medium ${isCompact ? 'py-1' : 'py-2'}`,
          style: {
            width: 28,
            minWidth: 28,
            maxWidth: 28,
            boxShadow: '2px 0 0 0 var(--frozen-bg)'
          }
        }, idx + 1), !isOverview && /*#__PURE__*/React.createElement("td", {
          className: `text-center sticky bg-white group-hover/row:bg-[var(--gantt-row-hover)] z-30 border-r ${rowBorder} text-slate-800 font-medium ${isCompact ? 'py-1' : 'py-2'}`,
          style: {
            width: 42,
            minWidth: 42,
            maxWidth: 42,
            left: 28,
            boxShadow: '2px 0 0 0 var(--frozen-bg)'
          }
        }, proj.category), /*#__PURE__*/React.createElement("td", {
          className: `sticky bg-white group-hover/row:bg-[var(--gantt-row-hover)] z-30 border-r ${rowBorder} p-0`,
          style: {
            width: nameW,
            minWidth: nameW,
            maxWidth: nameW,
            left: isOverview ? 0 : STICKY_LEAD_W,
            boxShadow: '2px 0 0 0 var(--frozen-bg), 4px 0 8px rgba(0,0,0,0.08)'
          }
        }, /*#__PURE__*/React.createElement("div", {
          className: "w-full h-full flex items-center px-2 overflow-hidden"
        }, role === 'manager' && !isOverview && (isFilteringRows ? /*#__PURE__*/React.createElement("span", {
          className: "flex-shrink-0 mr-1 text-slate-200 select-none text-[13px] leading-none cursor-not-allowed",
          title: "\u641C\u5C0B/\u985E\u578B\u7BE9\u9078\u4E2D\u7121\u6CD5\u62D6\u66F3\u6392\u5E8F\uFF0C\u8ACB\u5148\u6E05\u9664\u7BE9\u9078"
        }, "\u283F") : /*#__PURE__*/React.createElement("span", {
          draggable: true,
          onDragStart: () => setDragState({
            id: proj.id,
            owner: group.owner
          }),
          onDragEnd: () => {
            setDragState(null);
            setDragOverId(null);
          },
          className: "flex-shrink-0 mr-1 cursor-grab active:cursor-grabbing text-slate-500 hover:text-slate-600 select-none text-[13px] leading-none",
          title: "\u62D6\u66F3\u4EE5\u8ABF\u6574\u6392\u5E8F"
        }, "\u283F")), /*#__PURE__*/React.createElement("div", {
          className: `flex-shrink-0 px-1.5 py-0.5 mr-2 text-[9px] font-bold rounded-sm border ${PROJECT_TYPES[proj.type].chip}`
        }, proj.type.toUpperCase()), /*#__PURE__*/React.createElement("span", {
          className: `flex-1 min-w-0 truncate font-semibold text-slate-900 ${isOverview ? 'text-[12.5px]' : isCompact ? 'text-[13px]' : 'text-[15px]'}`,
          title: proj.nid ? `${proj.name}\nNID：${proj.nid}` : proj.name
        }, proj.name), subCount > 0 && /*#__PURE__*/React.createElement("button", {
          onClick: e => {
            e.stopPropagation();
            toggleSubExpanded(proj.id);
          },
          "aria-expanded": subExpanded,
          "aria-label": `${subExpanded ? '收合' : '展開'}子區間（${subCount} 個）`,
          disabled: subSearchHits.has(proj.id),
          title: subSearchHits.has(proj.id) ? `搜尋命中此專案的子區間，已自動展開（清除搜尋後可收合）` : `${subCount} 個子區間，點擊${subExpanded ? '收合' : '展開'}`,
          className: "flex-shrink-0 ml-1 -my-1 px-1.5 py-1 rounded-full text-[10px] font-bold leading-none whitespace-nowrap bg-sky-100 text-sky-800 border border-sky-300 hover:bg-sky-200 transition disabled:cursor-default"
        }, /*#__PURE__*/React.createElement("span", {
          "aria-hidden": "true"
        }, subExpanded ? '▾' : '▸'), " ", subCount), (() => {
          const soon = proj.tasks.filter(isTaskDeadlineSoon);
          if (soon.length === 0) return null;
          const remain = Math.min(...soon.map(t => t.end - todayWeek + 1));
          // orange-800(不是 700):9px 的字在投影 50:1 下 700 只有 4.18,800 為 5.64
          // ⚠ 這行原本寫成 `return ( {/* … */} <span…> )`——JSX 註解放進 return 的括號裡
          //   會被當成第二個運算式,Babel 直接 UnexpectedToken 建置失敗。註解要放 return 之外。
          return /*#__PURE__*/React.createElement("span", {
            className: "flex-shrink-0 ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-orange-100 text-orange-800 border border-orange-300 whitespace-nowrap",
            title: `${soon.length} 個計畫區間即將到期(最近的剩 ${remain} 週)`
          }, "\u23F0 \u5269", remain, "\u9031");
        })(), role === 'manager' && !isOverview && /*#__PURE__*/React.createElement("div", {
          className: "flex-shrink-0 hidden group-hover/row:flex items-center gap-0.5 ml-1"
        }, /*#__PURE__*/React.createElement("button", {
          onClick: () => setAddingInterval(proj),
          className: "w-5 h-5 flex items-center justify-center rounded text-green-600 hover:bg-green-100 font-bold",
          title: "\u65B0\u589E\u8A08\u756B\u5340\u9593"
        }, "\uFF0B"), /*#__PURE__*/React.createElement("button", {
          onClick: () => setEditingProject({
            mode: 'edit',
            owner: group.owner,
            project: proj
          }),
          className: "w-5 h-5 flex items-center justify-center rounded text-blue-600 hover:bg-blue-100",
          title: "\u7DE8\u8F2F\u5C08\u6848"
        }, "\u270E"), /*#__PURE__*/React.createElement("button", {
          onClick: () => handleDeleteProject(proj),
          className: "w-5 h-5 flex items-center justify-center rounded text-red-500 hover:bg-red-100",
          title: "\u522A\u9664\u5C08\u6848"
        }, "\uD83D\uDDD1")), /*#__PURE__*/React.createElement("button", {
          onClick: e => {
            e.stopPropagation();
            setDeliverableProj(proj);
          },
          className: `flex-shrink-0 px-1 py-1.5 -my-1.5 text-[12px] leading-none transition hover:scale-125 ${proj.deliverable ? 'opacity-90' : 'opacity-25 hover:opacity-70'}`,
          title: proj.deliverable || proj.mpSaving ? `具體產出項目：${proj.deliverable || '（未填寫）'}${proj.mpSaving ? `\n💡 MP Saving：${proj.mpSaving}` : ''}` : '具體產出項目（尚未填寫，點擊檢視/填寫）'
        }, "\uD83C\uDFAF"))), /*#__PURE__*/React.createElement("td", {
          colSpan: weeksTotal,
          className: `p-0 relative ${rowBorder}`,
          style: {
            height: isOverview ? 24 : isCompact ? 28 : 40
          }
        }, /*#__PURE__*/React.createElement("div", {
          className: "absolute inset-0 flex pointer-events-none z-0"
        }, Array.from({
          length: weeksTotal
        }).map((_, i) => /*#__PURE__*/React.createElement("div", {
          key: i,
          className: `flex-1 border-r border-slate-300 ${i + 1 === currentWeek ? 'bg-red-50/70' : ''}`
        }))), /*#__PURE__*/React.createElement("div", {
          className: "absolute top-0 bottom-0 z-10 pointer-events-none",
          style: {
            left: `${(currentWeek - 0.5) * (100 / weeksTotal)}%`,
            borderLeft: '2px solid rgba(220,38,38,0.55)'
          }
        }), proj.tasks.map(task => {
          const isActiveThisWeek = task.start <= currentWeek && task.end >= currentWeek;
          const weekLog = taskLogs[task.id]?.[currentWeek];
          // 回報單位(遷移 20):該週有進行中的子區間就以子區間為單位,父條只做彙總顯示
          const wu = weekUnits(task, currentWeek, taskLogs, subLogs);
          // 紅框＋❗畫在「回報單位」上(2026-09-13 使用者決定):子區間模式且子列展開時,待回報的是子區間、
          // 紅框只框子條(各自 subPending),父條不框——否則父條與子條同時亮紅,分不出到底哪條要打卡。
          // 子列收合時子條看不到,父條就得代為承接(維持彙總判斷),否則收合狀態下待回報訊號整個消失。
          const isPending = role === 'member' && proj.owner === currentUser && isActiveThisWeek && wu.reported < wu.total && !(wu.mode === 'sub' && subExpanded);
          const deadlineSoon = isTaskDeadlineSoon(task); // 剩 ≤2 週或已過 70% 時程 → 橘框 + ⏰(未回報紅框優先)

          const isHighlighted = task.id === highlightedTaskId && highlightedSubId == null; // 團隊看板點回報格時的暫時提示(點的是子區間的卡就只亮子條)
          const barClass = 'text-[#0f172a]'; // 計畫條底永遠是淺奶油色,文字固定深色(不受深色模式覆寫),投影高對比
          const barStyle = isHighlighted ? {
            backgroundImage: 'repeating-linear-gradient(45deg, #DBEAFE, #DBEAFE 6px, #BFDBFE 6px, #BFDBFE 12px)',
            // 淺藍高亮(僅提示用)
            borderColor: '#2563EB'
          } : {
            backgroundImage: 'repeating-linear-gradient(45deg, #FFF6D6, #FFF6D6 6px, #FDEDB8 6px, #FDEDB8 12px)',
            borderColor: 'rgba(180,83,9,0.75)' // 加深(範本 B):淡黃條在白底上需要更明確的輪廓
          };
          const textClass = weekLog ? 'font-bold' : 'font-medium opacity-90';
          const spanWeeks = task.end - task.start + 1;
          const leftPercent = (task.start - 1) * (100 / weeksTotal);
          const widthPercent = (task.end - task.start + 1) * (100 / weeksTotal);
          // 父條上每週的色點:父層自己的紀錄照舊;子區間模式的週改畫彙總(全交＝最積極的狀態、部分＝琥珀 partial)
          const dots = [];
          for (let wn = task.start; wn <= task.end; wn++) {
            const st = unitsDotStatus(weekUnits(task, wn, taskLogs, subLogs));
            if (st) dots.push({
              wn,
              st
            });
          }
          const weekLabel = !isActiveThisWeek ? '非本週區間' : wu.mode === 'sub' ? `子區間 ${wu.reported}/${wu.total} 已回報` : weekLog ? STATUS_META[weekLog.status]?.label || '已回報' : '尚未回報';
          return /*#__PURE__*/React.createElement(React.Fragment, {
            key: task.id
          }, /*#__PURE__*/React.createElement("div", _extends({}, clickable(() => {
            clearHighlight();
            setSelectedTaskInfo({
              proj,
              task,
              sub: null,
              origin: 'gantt'
            });
          }, `${proj.owner} ${proj.name}｜${task.name}｜W${String(task.start).padStart(2, '0')}–W${String(task.end).padStart(2, '0')}｜W${String(currentWeek).padStart(2, '0')} ${weekLabel}`, {
            roving: {
              active: String(task.id) === String(activeRovingTaskId),
              group: 'gantt-bar',
              id: task.id,
              onRove: setRovingTaskId
            }
          }), {
            onFocus: () => setRovingTaskId(task.id),
            onMouseEnter: e => showTooltip(e, proj, task),
            onMouseMove: moveTooltip,
            onMouseLeave: hideTooltip,
            className: `absolute flex items-center overflow-hidden cursor-pointer transition-transform hover:scale-y-110 hover:z-20 border rounded-sm shadow-sm ${barClass} ${isHighlighted ? 'ring-2 ring-blue-500 ring-offset-1 z-20' : isPending ? 'ring-2 ring-red-400 ring-offset-1 z-10' : deadlineSoon ? 'ring-2 ring-orange-400 ring-offset-1 z-10' : 'z-10'}`,
            style: {
              left: `${leftPercent}%`,
              width: `${widthPercent}%`,
              top: isOverview ? 4 : 4,
              bottom: isOverview ? 4 : isCompact ? 6 : 10,
              ...barStyle
            }
          }), dots.map(({
            wn,
            st
          }) => {
            const isCur = wn === currentWeek;
            return /*#__PURE__*/React.createElement("div", {
              key: wn,
              className: `absolute bottom-0 pointer-events-none ${st === 'partial' ? PARTIAL_DOT : STATUS_META[st]?.dot || 'bg-blue-500'}`,
              style: {
                left: `${(wn - task.start) / spanWeeks * 100}%`,
                width: `${100 / spanWeeks}%`,
                height: isCur ? '5px' : '4px',
                opacity: isCur ? 0.95 : 0.75
              }
            });
          }), /*#__PURE__*/React.createElement("span", {
            className: `relative z-10 truncate whitespace-nowrap ${isOverview ? 'text-[9px] leading-none px-1' : isCompact ? 'text-[10px] px-1.5' : 'text-[12px] px-1.5'} ${textClass}`,
            style: {
              textShadow: '0 0 3px rgba(255,255,255,0.9), 0 0 6px rgba(255,255,255,0.75)'
            }
          }, isPending && '❗', deadlineSoon && '⏰', task.name)));
        }))), subExpanded && subEntries.map(({
          task,
          sub
        }, subIdx) => {
          // 總覽子列 18(不是 16):條內要放 9px 的名稱＋3px 色點,16 扣掉上下 2px 只剩 12px 會疊在一起。
          const subRowH = isOverview ? 18 : isCompact ? 22 : 26;
          const isLastSub = subIdx === subEntries.length - 1;
          const subRowBorder = isLastSub ? 'border-slate-300' : 'border-slate-200';
          // 名稱欄的樹狀導引線(2026-09-13,取代每列一個 └):10 筆子區間時每列都是 └ 會像每列都是最後一筆,
          // 父列捲出畫面後也不知道這幾列屬於誰、到哪結束。改成一條貫穿的直線,最後一列只畫到一半自然收成 └,
          // 群組結尾再把底線加粗一階(slate-300),與下一個專案列分開。純 CSS、不進 state。
          // ⚠ 縮排兩種檢視都是 40(2026-09-14 修):總覽原本 16,但總覽的父列名稱欄一樣有 px-2＋類型晶片(B)＋mr-2,
          //   專案名從 36px 起,子區間名稱 16px 反而跑到專案名**左邊**,讀起來像另一層、不像底下的子項。
          const subIndent = 40;
          const guideX = subIndent - 10;
          const phase = sub.end < todayWeek ? 'done' : sub.start > todayWeek ? 'future' : 'active';
          const phaseLabel = phase === 'done' ? '已結束' : phase === 'future' ? '未開始' : '進行中';
          // 條色與父條一樣走行內固定色(淺底深字,不受深色模式覆寫),投影高對比。
          // ⚠ 子條用 **teal(青綠)色系**、與父條的琥珀色明確分開(2026-09-13 使用者決定,推翻同日稍早的「沿用父條琥珀色」):
          //   同色系版實測「一眼望去看不出來是什麼」——子條與父條、奶油底帶全是黃的,只差深淺根本分不出層級。
          //   色相挑 teal 是因為圖上其他顏色都已有語意:琥珀＝計畫區間、藍＝看板高亮/按鈕、綠/天藍＝回報狀態色點、
          //   紅＝待回報/當週線、紫＝主管回覆;teal 沒人用,且與看板高亮的 #DBEAFE 藍分得開(點看板時只有那條變藍)。
          //   ⚠ **一種樣式、不分階段**(2026-09-13 使用者兩次回報後定案):斜紋 #CCFBF1/#BDF7EC＋1px rgba(15,118,110,.75) 框,
          //   與父條**完全同一種構造**(同紋距、同框粗細、同透明度)只換色相。之前依「今天」分三階段
          //   (未開始虛線／進行中實心→斜紋深框／已結束淡斜紋淡框),使用者看到上下兩個專案的子條顏色不同,
          //   直覺是「顏色不一致＝壞掉」而不是「一個進行中一個已結束」——父條本來就不分階段(W01 的區間到年底
          //   照樣奶油斜紋),子條單獨分只會多一套要學的語彙。階段資訊留在 tooltip 的 phaseLabel。
          //   ⚠ 也不用實心(更早一版是 #99F6E4 實心):全圖唯一一條實心飽和色會被讀成「進度填色/做完了」。
          //   ⚠ **暗條用 #BDF7EC 不用 #99F6E4**(2026-09-13 使用者:子條看起來比父條重、主從層次反了):兩條斜紋的亮度差
          //   父條只有 0.03(#FFF6D6/#FDEDB8)、子條原本 0.10(#CCFBF1/#99F6E4)＝3 倍,紋路太吵才顯得搶眼;
          //   亮條與邊框的深度本來就跟父條一樣。改 #BDF7EC 後 ΔL=0.05 與父條同量級。**不要整條調淺**:
          //   亮條 #CCFBF1(L .88)跟底下的奶油底帶(L≈.92)只差 .04,再淺就融進底帶;子條是打卡入口,變淡會像不能點。
          //   主從層次由 └ 縮排、子列位置、父區間底帶表達,顏色只要「不搶」就夠。
          //   對比:#0f172a 字在 #BDF7EC/#CCFBF1 上≈14+、teal-700 框對白底 5.5,投影 OK。
          const subHighlighted = sub.id === highlightedSubId; // 看板點「這條子區間」的卡才亮這條(父條與其他子條不亮)
          const subBarStyle = subHighlighted ? {
            backgroundColor: '#DBEAFE',
            borderColor: '#2563EB',
            borderStyle: 'solid',
            borderWidth: 1.5
          } : {
            backgroundImage: 'repeating-linear-gradient(45deg, #CCFBF1, #CCFBF1 6px, #BDF7EC 6px, #BDF7EC 12px)',
            borderColor: 'rgba(15,118,110,0.75)',
            borderStyle: 'solid'
          };
          // 子區間自遷移 20 起是回報單位:該週落在範圍內、父層那週沒有舊紀錄 → 這條子區間本週要打卡
          const subActiveThisWeek = sub.start <= currentWeek && sub.end >= currentWeek;
          const parentWu = weekUnits(task, currentWeek, taskLogs, subLogs);
          const subLog = subLogs[sub.id]?.[currentWeek];
          const subIsUnit = subActiveThisWeek && parentWu.mode === 'sub';
          const subPending = role === 'member' && proj.owner === currentUser && subIsUnit && !subLog;
          const rangeText = `W${String(sub.start).padStart(2, '0')}–W${String(sub.end).padStart(2, '0')}`;
          const subWeekLabel = subIsUnit ? subLog ? STATUS_META[subLog.status]?.label || '已回報' : '尚未回報' : phaseLabel;
          const subTitle = `${task.name} › ${sub.name}（${rangeText}・${phaseLabel}）${subIsUnit ? `｜W${String(currentWeek).padStart(2, '0')} ${subWeekLabel}` : ''}`;
          const openSub = () => {
            clearHighlight();
            setSelectedTaskInfo({
              proj,
              task,
              sub,
              origin: 'gantt'
            });
          };
          // 總開關關著時不畫子區間的色點(那時回報單位是父區間,色點畫在父條上;舊的子區間回報留在 DB 不顯示)
          const subDots = !SUB_CHECKIN ? [] : Object.entries(subLogs[sub.id] || {}).map(([w, l]) => ({
            wn: Number(w),
            st: l.status
          })).filter(d => d.wn >= sub.start && d.wn <= sub.end);
          const subSpan = sub.end - sub.start + 1;
          const subRovingId = `s${sub.id}`;
          return /*#__PURE__*/React.createElement("tr", {
            key: `sub-${sub.id}`,
            "data-sub-row": sub.id,
            onDragOver: rowDragOver,
            onDrop: rowDrop,
            className: `group/row ${isDragSource ? 'opacity-40' : ''}`
          }, !isOverview && /*#__PURE__*/React.createElement("td", {
            className: `sticky left-0 bg-white group-hover/row:bg-[var(--gantt-row-hover)] z-30 border-r border-slate-300 border-b ${subRowBorder}`,
            style: {
              width: 28,
              minWidth: 28,
              maxWidth: 28,
              boxShadow: '2px 0 0 0 var(--frozen-bg)'
            }
          }), !isOverview && /*#__PURE__*/React.createElement("td", {
            className: `sticky bg-white group-hover/row:bg-[var(--gantt-row-hover)] z-30 border-r border-slate-300 border-b ${subRowBorder}`,
            style: {
              width: 42,
              minWidth: 42,
              maxWidth: 42,
              left: 28,
              boxShadow: '2px 0 0 0 var(--frozen-bg)'
            }
          }), /*#__PURE__*/React.createElement("td", {
            className: `sticky bg-white group-hover/row:bg-[var(--gantt-row-hover)] z-30 border-r border-slate-300 border-b ${subRowBorder} p-0`,
            style: {
              width: nameW,
              minWidth: nameW,
              maxWidth: nameW,
              left: isOverview ? 0 : STICKY_LEAD_W,
              boxShadow: '2px 0 0 0 var(--frozen-bg), 4px 0 8px rgba(0,0,0,0.08)'
            }
          }, /*#__PURE__*/React.createElement("div", {
            className: "relative w-full h-full flex items-center overflow-hidden pr-2",
            style: {
              paddingLeft: subIndent
            }
          }, /*#__PURE__*/React.createElement("div", {
            "aria-hidden": "true",
            className: "absolute border-l border-slate-400 pointer-events-none",
            style: {
              left: guideX,
              top: 0,
              bottom: isLastSub ? '50%' : 0
            }
          }), /*#__PURE__*/React.createElement("div", {
            "aria-hidden": "true",
            className: "absolute border-t border-slate-400 pointer-events-none",
            style: {
              left: guideX,
              width: 7,
              top: '50%'
            }
          }), tasksWithSubs > 1 && /*#__PURE__*/React.createElement("span", {
            className: "flex-shrink-0 mr-1.5 px-1 rounded text-[9px] font-bold bg-slate-100 text-slate-600 border border-slate-300 truncate",
            style: {
              maxWidth: 88
            },
            title: `所屬計畫區間：${task.name}`
          }, task.name), /*#__PURE__*/React.createElement("span", {
            className: `flex-1 min-w-0 truncate text-slate-700 ${isOverview ? 'text-[11px]' : isCompact ? 'text-[11px]' : 'text-[12px]'}`,
            title: subTitle
          }, sub.name))), /*#__PURE__*/React.createElement("td", {
            colSpan: weeksTotal,
            className: `p-0 relative border-b ${subRowBorder}`,
            style: {
              height: subRowH
            }
          }, /*#__PURE__*/React.createElement("div", {
            className: "absolute inset-0 flex pointer-events-none z-0"
          }, Array.from({
            length: weeksTotal
          }).map((_, i) => /*#__PURE__*/React.createElement("div", {
            key: i,
            className: `flex-1 border-r border-slate-300 ${i + 1 === currentWeek ? 'bg-red-50/70' : ''}`
          }))), /*#__PURE__*/React.createElement("div", {
            className: "absolute top-0 bottom-0 z-0 pointer-events-none",
            style: {
              left: `${(task.start - 1) * (100 / weeksTotal)}%`,
              width: `${(task.end - task.start + 1) * (100 / weeksTotal)}%`,
              backgroundColor: 'var(--gantt-sub-band)'
            }
          }), /*#__PURE__*/React.createElement("div", {
            className: "absolute top-0 bottom-0 z-10 pointer-events-none",
            style: {
              left: `${(currentWeek - 0.5) * (100 / weeksTotal)}%`,
              borderLeft: '2px solid rgba(220,38,38,0.55)'
            }
          }), /*#__PURE__*/React.createElement("div", _extends({}, clickable(openSub, `${proj.owner} ${proj.name}｜${subTitle}`, {
            roving: {
              active: String(subRovingId) === String(activeRovingTaskId),
              group: 'gantt-bar',
              id: subRovingId,
              onRove: setRovingTaskId
            }
          }), {
            onFocus: () => setRovingTaskId(subRovingId)
            // hover 回饋與 tooltip 都比照父條(2026-09-13):子條是打卡入口,原本滑過去毫無反應、只有原生 title
            // (延遲 1 秒、不顯示回報內容),使用者會覺得「父條會動、子條不會動＝不能點」。
            // 原生 title 拿掉:自訂 tooltip 已涵蓋,兩個同時出現會疊在一起。
            ,
            onMouseEnter: e => showTooltip(e, proj, task, sub),
            onMouseMove: moveTooltip,
            onMouseLeave: hideTooltip,
            className: `absolute flex items-center overflow-hidden cursor-pointer transition-transform hover:scale-y-110 hover:z-20 border rounded-sm shadow-sm text-[#0f172a] ${subHighlighted ? 'ring-2 ring-blue-500 ring-offset-1 z-20' : subPending ? 'ring-2 ring-red-400 ring-offset-1 z-20' : 'z-10'}`,
            style: {
              left: `${(sub.start - 1) * (100 / weeksTotal)}%`,
              width: `${(sub.end - sub.start + 1) * (100 / weeksTotal)}%`,
              top: isOverview ? 2 : 4,
              bottom: isOverview ? 2 : 4,
              ...subBarStyle
            }
          }), subDots.map(({
            wn,
            st
          }) => /*#__PURE__*/React.createElement("div", {
            key: wn,
            className: `absolute bottom-0 pointer-events-none ${STATUS_META[st]?.dot || 'bg-blue-500'}`,
            style: {
              left: `${(wn - sub.start) / subSpan * 100}%`,
              width: `${100 / subSpan}%`,
              height: wn === currentWeek ? '4px' : '3px',
              opacity: wn === currentWeek ? 0.95 : 0.75
            }
          })), /*#__PURE__*/React.createElement("span", {
            className: `relative z-10 truncate whitespace-nowrap font-medium ${isOverview ? 'text-[9px] leading-none px-1' : isCompact ? 'text-[10px] px-1.5' : 'text-[11px] px-1.5'}`
          }, subPending && '❗', sub.name))));
        }));
      }));
    })))))), showWeeklyReport && /*#__PURE__*/React.createElement(WeeklyReportDashboard, {
      currentWeek: currentWeek,
      year: scheduleYear,
      users: users,
      projects: projects,
      taskLogs: taskLogs,
      subLogs: subLogs,
      extraNotes: extraNotes,
      weeklyPlans: weeklyPlans,
      weeklyComments: weeklyComments,
      extraNoteMeta: extraNoteMeta,
      weeklyPlanMeta: weeklyPlanMeta,
      weeklyCommentMeta: weeklyCommentMeta,
      currentUser: currentUser,
      role: role,
      panelWidth: reportPanelW,
      todayWeek: todayWeek,
      isFutureWeek: isFutureWeek,
      highlightedTaskId: highlightedTaskId,
      highlightedSubId: highlightedSubId,
      onHighlightTask: handleHighlightTask,
      onEditComment: !isFutureWeek ? userName => setCommentTarget(userName) : undefined,
      onClose: closeWeeklyReport
    })), tooltip && /*#__PURE__*/React.createElement("div", {
      ref: tooltipRefCb,
      className: "fixed z-[200] pointer-events-none"
    }, /*#__PURE__*/React.createElement("div", {
      className: "bg-slate-900/95 text-white rounded-lg shadow-xl px-3.5 py-3 text-xs max-w-xs border border-slate-700"
    }, /*#__PURE__*/React.createElement("div", {
      className: "font-bold text-[13px] mb-1 text-yellow-200"
    }, tooltip.proj.name), /*#__PURE__*/React.createElement("div", {
      className: "text-slate-400 mb-0.5"
    }, "\uD83D\uDC64 ", tooltip.proj.owner, "\u3000\xB7\u3000", tooltip.proj.category), tooltip.proj.deliverable && /*#__PURE__*/React.createElement("div", {
      className: "text-amber-200/90 mb-0.5"
    }, "\uD83C\uDFAF ", tooltip.proj.deliverable), tooltip.proj.mpSaving && /*#__PURE__*/React.createElement("div", {
      className: "text-emerald-300 font-bold mb-0.5"
    }, "\uD83D\uDCA1 MP \u7BC0\u7701\uFF1A", tooltip.proj.mpSaving), tooltip.proj.nid && /*#__PURE__*/React.createElement("div", {
      className: "text-slate-400 mb-0.5"
    }, "\uD83D\uDD16 \u5C08\u6848 NID\uFF1A", tooltip.proj.nid), /*#__PURE__*/React.createElement("div", {
      className: "text-slate-400"
    }, "\uD83D\uDCC5 ", tooltip.task.name), tooltip.task.nid && /*#__PURE__*/React.createElement("div", {
      className: "text-slate-500"
    }, "\uD83D\uDD16 \u5340\u9593 NID\uFF1A", tooltip.task.nid), /*#__PURE__*/React.createElement("div", {
      className: "text-slate-500"
    }, "W", tooltip.task.start, " \u2013 W", tooltip.task.end, "\uFF08", weekToMonth(tooltip.task.start, months), " ~ ", weekToMonth(tooltip.task.end, months), "\uFF09"), (tooltip.task.subs || []).length > 0 && /*#__PURE__*/React.createElement("div", {
      className: "mt-1 pl-2 border-l border-slate-600 space-y-0.5"
    }, tooltip.task.subs.map(s => {
      const ph = s.end < todayWeek ? '已結束' : s.start > todayWeek ? '未開始' : '進行中';
      const isHovered = tooltip.subInfo?.sub.id === s.id; // 滑的是子條時標出「就是這條」
      return /*#__PURE__*/React.createElement("div", {
        key: s.id,
        className: isHovered ? 'text-teal-200 font-bold' : ph === '進行中' ? 'text-sky-200' : 'text-slate-400'
      }, isHovered ? '▸' : '└', " ", s.name, "\u3000W", s.start, "\u2013W", s.end, "\u30FB", ph);
    })), tooltip.subInfo && (() => {
      const {
        sub,
        isUnit,
        log,
        history: subHistory
      } = tooltip.subInfo;
      return /*#__PURE__*/React.createElement("div", {
        className: "mt-2 pt-2 border-t border-teal-700/70"
      }, /*#__PURE__*/React.createElement("div", {
        className: "font-bold text-teal-200 mb-0.5"
      }, "\u2514 ", sub.name), log ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
        className: "font-bold"
      }, STATUS_META[log.status]?.icon, " \u672C\u9031 W", currentWeek, "\uFF1A", STATUS_META[log.status]?.label, log.reporterRole === 'manager' && /*#__PURE__*/React.createElement("span", {
        className: "ml-1 text-yellow-300 text-[11px]"
      }, "\u270F\uFE0F(\u4E3B\u7BA1\u88DC\u767B)")), log.note && /*#__PURE__*/React.createElement("div", {
        className: "text-slate-400 whitespace-pre-wrap"
      }, log.note), log.docUrl && /*#__PURE__*/React.createElement("div", {
        className: "text-sky-300 mt-0.5"
      }, "\uD83D\uDCCE \u5DF2\u9644\u6587\u4EF6\u9023\u7D50")) : isUnit ? /*#__PURE__*/React.createElement("div", {
        className: "text-amber-300"
      }, "\u2757 \u672C\u9031 W", currentWeek, " \u5C1A\u672A\u56DE\u5831") : /*#__PURE__*/React.createElement("div", {
        className: "text-slate-500"
      }, sub.end < todayWeek ? '已結束' : sub.start > todayWeek ? '未開始' : '本週非此子區間的回報單位'), subHistory.length > 0 && /*#__PURE__*/React.createElement("div", {
        className: "mt-1 text-slate-500"
      }, "\u6B77\u53F2\u56DE\u5831\uFF1A", subHistory.map(([w, l]) => `W${w}${STATUS_META[l.status]?.icon || ''}`).join('　')));
    })(), isTaskDeadlineSoon(tooltip.task) && /*#__PURE__*/React.createElement("div", {
      className: "mt-1 text-orange-300 font-bold"
    }, "\u23F0 \u6392\u7A0B\u5373\u5C07\u5230\u671F\uFF1A\u5269 ", tooltip.task.end - todayWeek + 1, " \u9031 \uFF08\u6642\u7A0B\u5DF2\u904E ", Math.round((todayWeek - tooltip.task.start + 1) / (tooltip.task.end - tooltip.task.start + 1) * 100), "%\uFF09"), tooltip.wu?.mode === 'sub' && /*#__PURE__*/React.createElement("div", {
      className: "mt-2 pt-2 border-t border-slate-700"
    }, /*#__PURE__*/React.createElement("div", {
      className: "font-bold mb-0.5"
    }, "\u672C\u9031 W", currentWeek, "\uFF1A\u5B50\u5340\u9593 ", tooltip.wu.reported, "/", tooltip.wu.total, " \u5DF2\u56DE\u5831"), tooltip.wu.units.map(({
      sub,
      log
    }) => /*#__PURE__*/React.createElement("div", {
      key: sub.id,
      className: `${log ? 'text-slate-300' : 'text-amber-300'} ${tooltip.subInfo?.sub.id === sub.id ? 'font-bold' : ''}`
    }, tooltip.subInfo?.sub.id === sub.id ? '▸' : '└', " ", sub.name, "\uFF1A", log ? `${STATUS_META[log.status]?.icon} ${STATUS_META[log.status]?.label}${log.note ? '－' + log.note : ''}` : '❗尚未回報'))), tooltip.weekLog && /*#__PURE__*/React.createElement("div", {
      className: "mt-2 pt-2 border-t border-slate-700"
    }, /*#__PURE__*/React.createElement("div", {
      className: "font-bold mb-0.5"
    }, STATUS_META[tooltip.weekLog.status]?.icon, " \u672C\u9031 W", currentWeek, "\uFF1A", STATUS_META[tooltip.weekLog.status]?.label, tooltip.wu?.legacy && /*#__PURE__*/React.createElement("span", {
      className: "ml-1 text-slate-400 text-[11px]"
    }, "\uFF08\u4EE5\u8A08\u756B\u5340\u9593\u56DE\u5831\uFF09"), tooltip.weekLog.reporterRole === 'manager' && /*#__PURE__*/React.createElement("span", {
      className: "ml-1 text-yellow-300 text-[11px]"
    }, "\u270F\uFE0F(\u4E3B\u7BA1\u88DC\u767B)")), tooltip.weekLog.note && /*#__PURE__*/React.createElement("div", {
      className: "text-slate-400 whitespace-pre-wrap"
    }, tooltip.weekLog.note), tooltip.weekLog.docUrl && /*#__PURE__*/React.createElement("div", {
      className: "text-sky-300 mt-0.5"
    }, "\uD83D\uDCCE \u5DF2\u9644\u6587\u4EF6\u9023\u7D50")), tooltip.history.length > 0 && /*#__PURE__*/React.createElement("div", {
      className: "mt-2 pt-2 border-t border-slate-700 text-slate-500"
    }, "\u6B77\u53F2\u56DE\u5831\uFF1A", tooltip.history.map(([w, l]) => `W${w}${STATUS_META[l.status]?.icon || ''}`).join('　')), /*#__PURE__*/React.createElement("div", {
      className: "mt-1.5 text-[10px] text-slate-500"
    }, "\u9EDE\u64CA\u53EF\u958B\u555F\u8A73\u7D30 / \u56DE\u5831\u8996\u7A97"))), selectedTaskInfo && /*#__PURE__*/React.createElement(TaskModal, {
      info: selectedTaskInfo,
      role: role,
      currentUser: currentUser,
      currentWeek: currentWeek,
      todayWeek: todayWeek,
      isReportingWeek: isReportingWeek,
      isFutureWeek: isFutureWeek,
      weeksTotal: weeksTotal,
      allowRetroCheckin: allowRetroCheckin,
      logs: taskLogs[selectedTaskInfo.task.id] || {},
      subLogs: subLogs,
      onClose: () => setSelectedTaskInfo(null),
      onSaveLog: handleSaveLog,
      onUpdateTaskDetails: handleUpdateTaskDetails,
      onDeleteTask: handleDeleteTask,
      onUpdateScore: handleUpdateScore,
      onUpsertSub: handleUpsertSub,
      onDeleteSub: handleDeleteSub
    }), showExtraNoteModal && /*#__PURE__*/React.createElement(ExtraNoteModal, {
      currentWeek: currentWeek,
      initialNote: extraNotes[noteTargetUser || currentUser]?.[currentWeek] || '',
      readOnly: isFutureWeek || role !== 'manager' && isViewingPast && !allowRetroCheckin,
      future: isFutureWeek,
      targetUser: noteTargetUser,
      meta: extraNoteMeta[noteTargetUser || currentUser]?.[currentWeek],
      onClose: () => {
        setShowExtraNoteModal(false);
        setNoteTargetUser(null);
      },
      onSave: handleSaveExtraNote
    }), showWeeklyPlanModal && /*#__PURE__*/React.createElement(WeeklyPlanModal, {
      currentWeek: currentWeek,
      weeksTotal: weeksTotal,
      initialNote: weeklyPlans[noteTargetUser || currentUser]?.[currentWeek] || '',
      readOnly: isFutureWeek || role !== 'manager' && isViewingPast && !allowRetroCheckin,
      future: isFutureWeek,
      targetUser: noteTargetUser,
      meta: weeklyPlanMeta[noteTargetUser || currentUser]?.[currentWeek],
      onClose: () => {
        setShowWeeklyPlanModal(false);
        setNoteTargetUser(null);
      },
      onSave: handleSaveWeeklyPlan
    }), showDeadlinePanel && /*#__PURE__*/React.createElement(DeadlinePanel, {
      items: deadlineTasks,
      onClose: () => setShowDeadlinePanel(false),
      onSelect: item => {
        setShowDeadlinePanel(false);
        setScrollTargetWeek(Math.min(item.task.end, weeksTotal)); // 捲動定位到該任務結束週
        setSelectedTaskInfo({
          proj: item.proj,
          task: item.task,
          sub: null
        });
      }
    }), showPendingPanel && isCurrentYear && /*#__PURE__*/React.createElement(PendingPanel, {
      pending: myPendingTasks,
      completed: myCompletedTasks,
      currentWeek: todayWeek,
      weeksTotal: weeksTotal,
      scheduleYear: scheduleYear,
      planPending: planPendingThisWeek,
      extraFilled: !!extraNotes[currentUser]?.[todayWeek],
      planMeta: weeklyPlanMeta[currentUser]?.[todayWeek],
      extraMeta: extraNoteMeta[currentUser]?.[todayWeek],
      onFillPlan: () => {
        setShowPendingPanel(false);
        setCurrentWeek(todayWeek);
        setShowWeeklyPlanModal(true);
      },
      onFillExtra: () => {
        setShowPendingPanel(false);
        setCurrentWeek(todayWeek);
        setShowExtraNoteModal(true);
      },
      onClose: () => setShowPendingPanel(false),
      onSelect: item => {
        setShowPendingPanel(false);
        setCurrentWeek(todayWeek);
        setSelectedTaskInfo({
          proj: item.proj,
          task: item.task,
          sub: item.sub || null
        });
      }
    }), showRetroPanel && role === 'member' && /*#__PURE__*/React.createElement(PendingPanel, {
      retro: true,
      pending: myRetroPendingTasks,
      completed: myRetroCompletedTasks,
      currentWeek: currentWeek,
      weeksTotal: weeksTotal,
      scheduleYear: scheduleYear,
      planPending: !weeklyPlans[currentUser]?.[currentWeek],
      extraFilled: !!extraNotes[currentUser]?.[currentWeek],
      planMeta: weeklyPlanMeta[currentUser]?.[currentWeek],
      extraMeta: extraNoteMeta[currentUser]?.[currentWeek],
      onFillPlan: () => {
        setShowRetroPanel(false);
        setShowWeeklyPlanModal(true);
      },
      onFillExtra: () => {
        setShowRetroPanel(false);
        setShowExtraNoteModal(true);
      },
      onClose: () => setShowRetroPanel(false),
      onSelect: item => {
        setShowRetroPanel(false);
        setSelectedTaskInfo({
          proj: item.proj,
          task: item.task,
          sub: item.sub || null
        });
      }
    }), showWeekEditPanel && role === 'manager' && !isFutureWeek && /*#__PURE__*/React.createElement(ManagerWeekPanel, {
      week: currentWeek,
      historical: !isReportingWeek,
      users: users,
      projects: projects,
      taskLogs: taskLogs,
      subLogs: subLogs,
      extraNotes: extraNotes,
      weeklyPlans: weeklyPlans,
      weeklyComments: weeklyComments,
      extraNoteMeta: extraNoteMeta,
      weeklyPlanMeta: weeklyPlanMeta,
      weeklyCommentMeta: weeklyCommentMeta,
      onClose: () => setShowWeekEditPanel(false),
      onSelectTask: (proj, task, sub) => {
        setShowWeekEditPanel(false);
        setSelectedTaskInfo({
          proj,
          task,
          sub: sub || null
        });
      },
      onEditExtra: u => {
        setShowWeekEditPanel(false);
        setNoteTargetUser(u);
        setShowExtraNoteModal(true);
      },
      onEditPlan: u => {
        setShowWeekEditPanel(false);
        setNoteTargetUser(u);
        setShowWeeklyPlanModal(true);
      },
      onEditComment: u => {
        setShowWeekEditPanel(false);
        setCommentTarget(u);
      }
    }), commentTarget && /*#__PURE__*/React.createElement(CommentModal, {
      member: commentTarget,
      currentWeek: currentWeek,
      initialComment: weeklyComments[commentTarget]?.[currentWeek] || '',
      meta: weeklyCommentMeta[commentTarget]?.[currentWeek],
      onClose: () => setCommentTarget(null),
      onSave: c => handleSaveComment(commentTarget, c)
    }), editingProject && /*#__PURE__*/React.createElement(ProjectEditModal, {
      info: editingProject,
      existingCategories: existingCategories,
      users: users,
      onClose: () => setEditingProject(null),
      onSave: handleSaveProject
    }), addingInterval && /*#__PURE__*/React.createElement(IntervalModal, {
      project: addingInterval,
      currentWeek: currentWeek,
      weeksTotal: weeksTotal,
      onClose: () => setAddingInterval(null),
      onSave: handleAddInterval
    }), showAuditPanel && /*#__PURE__*/React.createElement(AuditPanel, {
      onClose: () => setShowAuditPanel(false)
    }), showMemberPanel && /*#__PURE__*/React.createElement(MemberPanel, {
      users: users,
      projects: projects,
      year: scheduleYear,
      onAdd: handleAddUser,
      onRename: handleRenameUser,
      onDelete: handleDeleteUser,
      onClose: () => setShowMemberPanel(false)
    }), showAccessPanel && role === 'manager' && /*#__PURE__*/React.createElement(AccessPanel, {
      currentUser: currentUser,
      role: role,
      empId: empId,
      showToast: showToast,
      onClose: () => setShowAccessPanel(false)
    }), showUsagePanel && role === 'manager' && /*#__PURE__*/React.createElement(UsageStatsPanel, {
      onClose: () => setShowUsagePanel(false)
    }), deliverableProj && /*#__PURE__*/React.createElement(DeliverableModal, {
      proj: deliverableProj,
      role: role,
      currentUser: currentUser,
      onClose: () => setDeliverableProj(null),
      onSave: handleSaveDeliverable
    }), confirmInfo && /*#__PURE__*/React.createElement(ConfirmModal, {
      info: confirmInfo,
      onCancel: () => setConfirmInfo(null)
    }), /*#__PURE__*/React.createElement("div", {
      className: "sr-only",
      role: "status",
      "aria-live": "polite"
    }, toast && !toast.isError ? toast.msg : ''), /*#__PURE__*/React.createElement("div", {
      className: "sr-only",
      role: "alert",
      "aria-live": "assertive"
    }, toast && toast.isError ? toast.msg : ''), toast && /*#__PURE__*/React.createElement("div", {
      className: `fixed bottom-6 left-1/2 -translate-x-1/2 z-[300] bg-slate-900 text-white text-sm font-bold px-5 py-3 rounded-xl shadow-2xl border flex items-center gap-3 ${toast.isError ? 'border-red-500' : 'border-slate-700 animate-bounce'}`
    }, /*#__PURE__*/React.createElement("span", {
      className: "whitespace-pre-wrap",
      "aria-hidden": "true"
    }, toast.msg), toast.action && /*#__PURE__*/React.createElement("button", {
      onClick: () => {
        dismissToast();
        toast.action.onClick();
      },
      className: "flex-shrink-0 bg-amber-500 hover:bg-amber-400 text-slate-900 px-3 py-1 rounded-lg text-xs font-black transition"
    }, "\u21A9 ", toast.action.label), (toast.isError || toast.action) && /*#__PURE__*/React.createElement("button", {
      onClick: dismissToast,
      "aria-label": "\u95DC\u9589\u901A\u77E5",
      className: "flex-shrink-0 text-white/50 hover:text-white font-bold px-1",
      title: "\u95DC\u9589"
    }, "\u2715")))
  );
}

// 概況列的狀態計數(2026-09-14 起是純顯示,不再是篩選鈕):色點＋標籤＋數字,與右側圖例同一種構造。
// 刻意**不做成晶片／不加 hover**——長得像按鈕就會有人去點(09-13 的四顆篩選鈕就是這樣長出來的)。
// 投影友善:數字用 700 級粗體、標籤 slate-700,不用透明度淡化。
function StatCount({
  label,
  value,
  dotClass,
  valueClass = 'text-slate-800',
  title
}) {
  return /*#__PURE__*/React.createElement("span", {
    className: "flex-shrink-0 flex items-center gap-1 text-[11px] text-slate-700",
    title: title
  }, dotClass && /*#__PURE__*/React.createElement("span", {
    className: `w-2.5 h-2.5 rounded-sm ${dotClass}`,
    "aria-hidden": "true"
  }), /*#__PURE__*/React.createElement("span", null, label), /*#__PURE__*/React.createElement("span", {
    className: `text-[13px] leading-none font-black ${valueClass}`
  }, value));
}

// 「條件篩到 0 筆」的共用空狀態(週檢視/年度總覽/成果清單)。
// ⚠ 空狀態要做兩件事,少一件都不算數:
//   ①**講出是什麼把清單清空的** —— 造成 0 筆的條件散在三處(工具列的搜尋框與 a~e 晶片、
//     header 右側的成員下拉、成果清單自己的 KPI 卡片),使用者看不到「現在同時生效了哪些」。
//   ②**就地給出口** —— 原本週檢視只寫「調整搜尋關鍵字或清除篩選後再試一次」,
//     清除鈕卻遠在工具列;成果清單更只有一句「符合篩選條件的專案項目為空」,連該做什麼都沒說。
// 每個條件各給一顆清除鈕(使用者通常只想拿掉其中一個,不是全部重來),兩個以上才多給「清除全部」。
function EmptyFilterState({
  filters = [],
  onClearAll,
  emptyNote = '這個年度目前沒有專案。'
}) {
  const btn = 'px-2.5 py-1 rounded-lg bg-white border border-slate-400 text-[11px] font-bold text-slate-700 hover:bg-slate-100 hover:border-blue-500 transition';
  return /*#__PURE__*/React.createElement("div", {
    className: "py-10 text-center"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-3xl mb-2",
    "aria-hidden": "true"
  }, "\uD83D\uDD0D"), /*#__PURE__*/React.createElement("div", {
    className: "font-bold text-slate-700"
  }, "\u627E\u4E0D\u5230\u7B26\u5408\u689D\u4EF6\u7684\u5C08\u6848"), filters.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "mt-1 text-xs text-slate-600"
  }, emptyNote) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "mt-1 text-xs text-slate-600"
  }, "\u76EE\u524D\u751F\u6548\u7684\u7BE9\u9078\uFF1A", filters.map(f => f.label).join('、')), /*#__PURE__*/React.createElement("div", {
    className: "mt-3 flex items-center justify-center gap-2 flex-wrap"
  }, filters.map(f => /*#__PURE__*/React.createElement("button", {
    key: f.key,
    onClick: f.clear,
    className: btn
  }, "\u2715 ", f.clearLabel)), filters.length > 1 && /*#__PURE__*/React.createElement("button", {
    onClick: onClearAll,
    className: `${btn} text-blue-700 border-blue-400`
  }, "\u6E05\u9664\u5168\u90E8\u689D\u4EF6"))));
}
function LoadingScreen() {
  return /*#__PURE__*/React.createElement("div", {
    className: "flex-1 flex justify-center items-center bg-slate-100 app-bg p-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-center"
  }, /*#__PURE__*/React.createElement("div", {
    className: "w-12 h-12 border-4 border-slate-300 border-t-blue-600 rounded-full animate-spin mx-auto mb-4"
  }), /*#__PURE__*/React.createElement("div", {
    className: "text-slate-500 font-bold"
  }, "\u8F09\u5165\u8CC7\u6599\u4E2D\u2026")));
}
function ErrorScreen({
  message,
  onRetry
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "flex-1 flex justify-center items-center bg-slate-100 app-bg p-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "bg-white p-10 rounded-2xl shadow-2xl modal-card border border-red-200 max-w-md w-full text-center"
  }, /*#__PURE__*/React.createElement("div", {
    className: "w-16 h-16 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center mx-auto mb-4 text-3xl"
  }, "\u26A0\uFE0F"), /*#__PURE__*/React.createElement("h2", {
    className: "text-xl font-black text-slate-800 mb-2"
  }, "\u7121\u6CD5\u9023\u7DDA\u8CC7\u6599\u5EAB"), /*#__PURE__*/React.createElement("p", {
    className: "text-sm text-slate-500 mb-3"
  }, "\u7CFB\u7D71\u7121\u6CD5\u5F9E\u5F8C\u7AEF\u8B80\u53D6\u8CC7\u6599\uFF0C\u8ACB\u78BA\u8A8D\u5F8C\u7AEF\u670D\u52D9\u8207\u8CC7\u6599\u5EAB\u9023\u7DDA\u5F8C\u518D\u8A66\u4E00\u6B21\u3002"), /*#__PURE__*/React.createElement("div", {
    className: "text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg p-3 mb-5 text-left whitespace-pre-wrap break-words max-h-40 overflow-y-auto"
  }, message), /*#__PURE__*/React.createElement("button", {
    onClick: onRetry,
    className: "w-full text-white font-bold py-3 rounded-xl shadow-md transition hover:opacity-90",
    style: {
      backgroundColor: BRAND_BTN
    }
  }, "\u91CD\u65B0\u8F09\u5165")));
}

// 瀏覽權限未通過的整頁封鎖畫面(卡控啟用時取代整個 App,不顯示登入與資料)
function AccessDeniedScreen({
  empId,
  reason,
  person,
  siteTitle = '專案追蹤總表'
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "min-h-screen flex justify-center items-center bg-slate-100 app-bg p-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "bg-white p-10 rounded-2xl shadow-2xl modal-card border border-red-200 max-w-md w-full text-center"
  }, /*#__PURE__*/React.createElement("div", {
    className: "w-16 h-16 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center mx-auto mb-4 text-3xl"
  }, "\uD83D\uDEAB"), /*#__PURE__*/React.createElement("h2", {
    className: "text-xl font-black text-slate-800 mb-2"
  }, "\u7121\u6B0A\u9650\u700F\u89BD\u6B64\u9801\u9762"), /*#__PURE__*/React.createElement("p", {
    className: "text-sm text-slate-500 mb-4"
  }, "\u60A8\u7684\u5E33\u865F\u672A\u88AB\u6388\u6B0A\u700F\u89BD ", siteTitle, "\u3002"), /*#__PURE__*/React.createElement("div", {
    className: "text-left text-sm bg-slate-100 border border-slate-300 rounded-lg p-4 mb-4 space-y-1.5"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    className: "text-slate-500 font-bold mr-2"
  }, "\u767B\u5165\u5DE5\u865F"), /*#__PURE__*/React.createElement("span", {
    className: "font-mono font-bold text-slate-800"
  }, empId || '（無法取得）')), person && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    className: "text-slate-500 font-bold mr-2"
  }, "\u4EBA\u54E1\u540D\u518A"), /*#__PURE__*/React.createElement("span", {
    className: "text-slate-700 font-medium"
  }, person.name || '', " ", person.ename ? `(${person.ename})` : '', "\u30FB", person.deptname || [person.dept1, person.dept2, person.dept3].filter(Boolean).join('/') || '無部門資料'))), reason && /*#__PURE__*/React.createElement("div", {
    className: "text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg p-3 mb-5 text-left whitespace-pre-wrap"
  }, reason), /*#__PURE__*/React.createElement("p", {
    className: "text-xs text-slate-500"
  }, "\u82E5\u9700\u8981\u700F\u89BD\u6B0A\u9650\uFF0C\u8ACB\u806F\u7D61\u7CFB\u7D71\u7BA1\u7406\u54E1\uFF08\u4E3B\u7BA1\uFF09\u5C07\u60A8\u7684\u90E8\u9580\u6216\u5DE5\u865F\u52A0\u5165\u5141\u8A31\u6E05\u55AE\u3002")));
}
function LoginScreen({
  onLogin,
  users,
  year,
  empId,
  siteName = ''
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "flex-1 flex justify-center items-center bg-slate-100 login-bg p-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "bg-white p-10 rounded-2xl shadow-2xl modal-card dark:shadow-none border border-slate-300 max-w-md w-full"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-center mb-8"
  }, /*#__PURE__*/React.createElement("div", {
    className: "w-16 h-16 text-white rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg text-2xl",
    style: {
      backgroundColor: 'var(--brand-btn, #001F5B)'
    }
  }, "\uD83D\uDCCA"), /*#__PURE__*/React.createElement("h2", {
    className: "text-2xl font-black text-slate-800"
  }, siteName ? `${siteName} ` : '', "\u5C08\u6848\u8FFD\u8E64\u7CFB\u7D71"), /*#__PURE__*/React.createElement("p", {
    className: "text-xs text-slate-500 mt-2"
  }, year, " \u5E74\u5EA6\u5C08\u6848\u6392\u7A0B \xB7 \u9031\u9032\u5EA6\u7BA1\u63A7")), /*#__PURE__*/React.createElement("button", {
    onClick: () => onLogin('管理部主管', 'manager'),
    className: "w-full text-white font-bold py-3.5 rounded-xl mb-6 shadow-md transition hover:opacity-90",
    style: {
      backgroundColor: 'var(--brand-btn, #001F5B)'
    }
  }, "\uD83D\uDC51 \u4E3B\u7BA1\u767B\u5165\uFF08\u8ABF\u6574\u6392\u7A0B / \u6AA2\u8996\u5168\u9AD4\uFF09"), /*#__PURE__*/React.createElement("div", {
    className: "relative flex py-2 items-center"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex-grow border-t border-slate-300"
  }), /*#__PURE__*/React.createElement("span", {
    className: "flex-shrink-0 mx-4 text-slate-500 text-xs font-bold uppercase tracking-wider"
  }, "\u5718\u968A\u6210\u54E1\u767B\u5165\uFF08\u56DE\u5831\u9032\u5EA6\uFF09"), /*#__PURE__*/React.createElement("div", {
    className: "flex-grow border-t border-slate-300"
  })), /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-3 gap-3 mt-4"
  }, users.map(u => /*#__PURE__*/React.createElement("button", {
    key: u,
    onClick: () => onLogin(u, 'member'),
    className: "bg-white login-chip border border-slate-300 hover:border-blue-500 hover:bg-blue-50 py-2.5 rounded-xl font-bold text-slate-700 hover:text-blue-700 transition shadow-sm text-sm"
  }, u))), empId && /*#__PURE__*/React.createElement("div", {
    className: "mt-6 text-center text-[11px] text-slate-500"
  }, "\uD83D\uDDA5\uFE0F \u5DF2\u5075\u6E2C\u5230 Windows \u5DE5\u865F\uFF1A", /*#__PURE__*/React.createElement("span", {
    className: "font-bold text-slate-500"
  }, empId), "\uFF08\u64CD\u4F5C\u7D00\u9304\u5C07\u4E00\u4F75\u8A18\u8F09\uFF09")));
}

// 主管評分選項(成員回報預設 1 分,未回報 0 分,僅主管可調整)
const SCORE_OPTIONS = [{
  value: 0.3,
  label: '再三交代'
}, {
  value: 0.5,
  label: '說一動做一動'
}, {
  value: 0.8,
  label: '完成老闆交代'
}, {
  value: 0.9,
  label: '超越老闆期許'
}, {
  value: 1,
  label: '主動承擔'
}];

// isReportingWeek／isFutureWeek 由 App 統一判斷(含「非本年度沒有本週」),這裡不要再拿 currentWeek 跟 todayWeek 比;
// todayWeek 只拿來標子區間的「未開始／進行中／已結束」。
function TaskModal({
  info,
  role,
  currentUser,
  currentWeek,
  todayWeek,
  isReportingWeek = currentWeek === todayWeek,
  isFutureWeek = currentWeek > todayWeek,
  weeksTotal = WEEKS_TOTAL,
  allowRetroCheckin,
  logs = {},
  subLogs = {},
  onClose,
  onSaveLog,
  onUpdateTaskDetails,
  onDeleteTask,
  onUpdateScore,
  onUpsertSub,
  onDeleteSub
}) {
  const focus = useModalFocus(); // 開啟時焦點移入、Tab 鎖在視窗內、關閉時還原
  const {
    proj,
    task
  } = info;
  const isManager = role === 'manager';
  const isMyTask = proj.owner === currentUser;
  const canEditSubs = isManager || isMyTask; // 子區間=負責人自己的工作拆解,負責人與主管皆可編輯(SP 內同樣檢查)
  const subs = task.subs || [];
  // 本週狀態一律從 props 現算(不吃開窗時的快照):評分／存檔後父層會更新 logs／subLogs,彈窗才跟得上
  const isActiveThisWeek = task.start <= currentWeek && task.end >= currentWeek;
  const weekLog = logs[currentWeek];
  // 回報單位(遷移 20):該週有進行中的子區間 → 逐個子區間回報;info.sub 是從子條／清單點進來時要直接停在的那一個
  const wu = weekUnits(task, currentWeek, {
    [task.id]: logs
  }, subLogs);
  const [unitSubId, setUnitSubId] = useState(() => info.sub?.id ?? (wu.mode === 'sub' ? (wu.units.find(u => !u.log) || wu.units[0]).sub.id : null));
  const unitSub = wu.mode === 'sub' ? (wu.units.find(u => u.sub.id === unitSubId) || wu.units[0]).sub : null;
  const unitLog = unitSub ? subLogs[unitSub.id]?.[currentWeek] : weekLog;
  // 未來週次一律不可回報(主管也不行,2026-09-12 使用者決定:系統是檢視「過去到現在」的狀態;後端同樣擋)
  const canClockIn = !isFutureWeek && (isManager && isActiveThisWeek || role === 'member' && isMyTask && isActiveThisWeek && (isReportingWeek || allowRetroCheckin));
  // 版面順序依「從哪裡開的」決定(2026-09-13 使用者要求):從**甘特條**點進來＝在看排程 → 排程與子區間置頂、回報放最下面;
  // 從回報面板(本週回報中心／補登面板／主管 🛠)點進來＝要打卡 → 回報置頂。
  // ⚠ 唯一例外:成員點自己「本週可打卡」的條——甘特條本來就是成員最常用的打卡入口(回報中心是第二條路),
  //   這種情況仍回報置頂,否則成員每次打卡都得先捲過排程卡。
  const openedFromGantt = info.origin === 'gantt';
  const scheduleFirst = openedFromGantt && !(role === 'member' && canClockIn);
  const score = unitLog ? Number(unitLog.score ?? 1) : 0;
  const [status, setStatus] = useState(unitLog?.status || null);
  const [note, setNote] = useState(unitLog?.note || '');
  const [docUrl, setDocUrl] = useState(unitLog?.docUrl || ''); // 本週回報對應的文件連結(選填)
  const [taskName, setTaskName] = useState(task.name);
  const [startWeek, setStartWeek] = useState(task.start);
  const [endWeek, setEndWeek] = useState(task.end);
  const [taskNid, setTaskNid] = useState(task.nid || ''); // 此進度區間對應哪組 NID(選填)
  const [saving, setSaving] = useState(false); // 防連點:送出中鎖定按鈕
  useModalDirtyReset();
  const [scheduleError, setScheduleError] = useState('');
  const [noteError, setNoteError] = useState('');
  const [docError, setDocError] = useState('');
  // 前幾週回報:**預設收合**。它是「參考資料」不是「要填的東西」,展開時會佔掉彈窗一大塊,
  // 把真正要操作的「本週實際執行回報」推到畫面外。需要對照時才展開。
  // ⚠ 收合不影響最高頻的動作:「↩ 沿用上次回報」是獨立主按鈕(在狀態選擇區上方),不在這一區裡。
  const [historyOpen, setHistoryOpen] = useState(false);

  // 此計畫區間「本週之前」的歷次回報,新到舊。
  // 寫本週回報時最需要的參考就是「上週寫到哪、狀態是什麼」,原本只有甘特條 hover tooltip 看得到 →
  // 使用者得先關掉這個彈窗、去甘特條上 hover、記住內容、再開回來。資料本來就在 client 端(taskLogs),不需要再打 API。
  // 歷史跟著回報單位走:子區間看自己的歷史(它才是連續的那條線);父層歷史另存,子區間第一次打卡時「沿用上次」退回去用它
  const toHistory = map => Object.entries(map || {}).map(([w, log]) => ({
    week: Number(w),
    log
  })).filter(h => h.week < currentWeek && h.log).sort((a, b) => b.week - a.week);
  const parentHistory = useMemo(() => toHistory(logs), [logs, currentWeek]);
  const history = useMemo(() => unitSub ? toHistory(subLogs[unitSub.id]) : parentHistory, [unitSub?.id, subLogs, parentHistory, currentWeek]);
  const reuseSource = history[0] || (unitSub ? parentHistory[0] : null); // 子區間沒有自己的歷史時退回計畫區間的上一次

  // 回報表單是否動過(切換回報單位前要擋:表單只有一份,切過去會把打到一半的內容換掉)
  const reportDirty = () => status !== (unitLog?.status || null) || note !== (unitLog?.note || '') || docUrl !== (unitLog?.docUrl || '');
  const switchUnit = id => {
    if (id === unitSubId || reportDirty()) return;
    setUnitSubId(id);
    const l = subLogs[id]?.[currentWeek];
    setStatus(l?.status || null);
    setNote(l?.note || '');
    setDocUrl(l?.docUrl || '');
    setNoteError('');
    setDocError('');
  };
  // 展開後直接列出全部:原本還有一層「先 3 週、再顯示全部」的中間狀態,改成預設收合之後
  // 會變成「展開 → 再按顯示全部」兩次點擊才看得到完整歷史。清單本身有 max-h-56 內部捲動撐著,
  // 一次全列不會把版面推爆,所以收掉那層中間狀態,只留「收合 ⇄ 展開」兩態。

  // 沿用某一週的回報當本週草稿:狀態與內容一起帶入,使用者可再修改後送出。
  // 例行性/持續性的工作每週內容差異不大,重打一次是純粹的重工;帶入後文字就攤在 textarea 裡,
  // 使用者看得到自己送出的是什麼,不會有「以為填了新內容」的錯覺。
  // 文件連結一起帶:同一份文件通常會延續好幾週(進度報告、追蹤表),重貼一次也是重工。
  const reuseLog = h => {
    setStatus(h.log.status);
    setNote(h.log.note || '');
    setDocUrl(h.log.docUrl || '');
    setNoteError('');
    setDocError('');
    markModalDirty();
  };
  const submitLog = async () => {
    if (saving) return;
    if (!status) {
      setNoteError('請先選擇本週狀態');
      return;
    }
    if (status === 'executed' && !note.trim()) {
      setNoteError('請填寫實際工作內容，才能讓團隊了解進度');
      return;
    }
    // 沒有 scheme 的網址補 https://(否則進 href 會被當相對路徑,點下去是本站 404)
    const {
      doc,
      error: dErr
    } = validateDocInput(docUrl);
    if (dErr) {
      setDocError(dErr);
      return;
    }
    if (doc !== docUrl) setDocUrl(doc); // 補過 scheme 的話同步回欄位,使用者看得到送出的是什麼
    setSaving(true);
    try {
      await onSaveLog(task.id, unitSub?.id ?? null, status, note.trim(), doc);
    } finally {
      setSaving(false);
    }
  };
  const submitSchedule = async () => {
    if (saving) return;
    const s = parseInt(startWeek),
      e = parseInt(endWeek);
    if (!taskName.trim()) {
      setScheduleError('任務名稱不可空白');
      return;
    }
    if (isNaN(s) || isNaN(e) || s < 1 || e > weeksTotal || s > e) {
      setScheduleError(`週次需介於 1–${weeksTotal}，且開始週不可晚於結束週`);
      return;
    }
    // 父區間縮短時不可讓子區間跑出範圍(SP 也會擋,這裡先講清楚哪幾筆,不必送出才知道)
    const outside = subs.filter(x => x.start < s || x.end > e);
    if (outside.length > 0) {
      setScheduleError(`以下子區間會超出 W${s}–W${e}，請先調整：${outside.map(x => `${x.name}（W${x.start}–W${x.end}）`).join('、')}`);
      return;
    }
    setSaving(true);
    try {
      await onUpdateTaskDetails(proj.id, task.id, taskName.trim(), s, e, taskNid.trim());
    } finally {
      setSaving(false);
    }
  };

  // --- 子區間編輯(遷移 18):清單逐列就地編輯(✎ 進入編輯、儲存/取消),底部一列新增表單。
  //     驗證與後端一致:名稱必填、落在**已儲存的**父區間 task.start–task.end 內(不是上方表單還沒存的值)、最多 10 筆。
  const [subEditId, setSubEditId] = useState(null); // 進入編輯狀態的子區間 id
  const [subForm, setSubForm] = useState({
    name: '',
    start: '',
    end: ''
  }); // 編輯中/新增中的欄位值(同一份,兩者互斥)
  const [subError, setSubError] = useState('');
  const [subSaving, setSubSaving] = useState(false);
  const SUB_MAX = 10;
  // 起迄週留空＝沿用父區間的邊界(新增列的 placeholder 就是顯示父區間起迄,灰字暗示「不填就是這個值」,
  // 驗證卻擋下來會讓使用者以為壞了)。「準備資料」常常就是從父起週開始,少打兩格。
  const resolveSubWeeks = f => ({
    s: String(f.start).trim() === '' ? task.start : parseInt(f.start),
    e: String(f.end).trim() === '' ? task.end : parseInt(f.end)
  });
  const validateSub = f => {
    const {
      s,
      e
    } = resolveSubWeeks(f);
    if (!f.name.trim()) return '子區間名稱不可空白';
    if (isNaN(s) || isNaN(e)) return `週次請填數字（W${task.start}–W${task.end} 之間；留空＝沿用計畫區間的起迄）`;
    if (s > e) return '開始週不可晚於結束週';
    if (s < task.start || e > task.end) return `子區間需落在計畫區間 W${task.start}–W${task.end} 內`;
    return '';
  };
  // 新增列有打字時,各列的 ✎/🗑 要一併鎖住:表單是新增/編輯共用的一份,按 ✎ 會直接覆蓋掉打到一半的新增內容、
  // 新增列也隨之隱藏,輸入無聲消失。與「編輯中鎖住其他列」是同一條規則的另一半。
  const subFormDirty = subForm.name.trim() !== '' || String(subForm.start).trim() !== '' || String(subForm.end).trim() !== '';
  const subRowActionsLocked = subEditId !== null || subFormDirty;
  const subRowLockHint = subEditId !== null ? '請先儲存或取消目前編輯中的子區間' : '請先送出或清空下方新增列的內容';
  // 「排程與子區間」折疊卡(2026-09-13):打卡情境預設收合、唯讀情境預設展開;編輯中強制展開(見 JSX 處的說明)
  const [setupOpenState, setSetupOpenState] = useState(!canClockIn || scheduleFirst);
  const setupForced = !!scheduleError || subEditId !== null || subFormDirty || !!subError;
  const setupOpen = setupOpenState || setupForced;
  const beginEditSub = x => {
    setSubEditId(x.id);
    setSubForm({
      name: x.name,
      start: String(x.start),
      end: String(x.end)
    });
    setSubError('');
  };
  // 子區間存檔/取消後彈窗不關閉,未儲存旗標要自己處理:其他欄位(回報、排程)都沒動的話就清掉,
  // 否則剛存完子區間按 ESC 會誤跳「放棄未儲存的內容?」(旗標是全域布林,只能整個清)。
  // 排程四欄(名稱/起迄週/NID)是否動過:「儲存排程」只在有變更時可按,按鈕的可按狀態本身就在講「它只管這四格」
  // (改子區間列不會讓它亮起來,使用者就不會以為它會把子區間一起存)。
  const scheduleDirty = taskName !== task.name || String(startWeek) !== String(task.start) || String(endWeek) !== String(task.end) || taskNid !== (task.nid || '');
  const otherFieldsDirty = () => reportDirty() || scheduleDirty;
  const cancelEditSub = () => {
    setSubEditId(null);
    setSubForm({
      name: '',
      start: '',
      end: ''
    });
    setSubError('');
    if (!otherFieldsDirty()) clearModalDirty();
  };
  const setSubField = (k, v) => {
    setSubForm(f => ({
      ...f,
      [k]: v
    }));
    setSubError('');
    markModalDirty();
  };
  const submitSub = async () => {
    if (subSaving) return;
    const err = validateSub(subForm);
    if (err) {
      setSubError(err);
      return;
    }
    if (subEditId === null && subs.length >= SUB_MAX) {
      setSubError(`每條計畫區間最多 ${SUB_MAX} 個子區間`);
      return;
    }
    const {
      s,
      e
    } = resolveSubWeeks(subForm);
    // 編輯但三個欄位都沒改 → 直接收掉編輯列、不打 API:否則會多一筆「…內容未變更」的稽核噪音
    // (子區間是負責人隨手編的,「點 ✎ 看一眼又存回去」比主管改排程頻繁得多)。
    if (subEditId !== null) {
      const orig = subs.find(x => x.id === subEditId);
      if (orig && orig.name === subForm.name.trim() && orig.start === s && orig.end === e) {
        cancelEditSub();
        return;
      }
    }
    setSubSaving(true);
    try {
      const ok = await onUpsertSub(proj.id, task.id, {
        id: subEditId ?? undefined,
        name: subForm.name.trim(),
        start: s,
        end: e
      });
      if (ok) cancelEditSub();
    } finally {
      setSubSaving(false);
    }
  };
  const subInputCls = 'border border-slate-300 rounded-md px-2 py-1 text-sm outline-none focus:border-blue-500 bg-white';

  // 三個區塊各自組好,最後依 scheduleFirst 決定 DOM 順序(不用 CSS order:Tab 順序要跟視覺順序一致)。
  // 排程置頂模式下「非本週排定」的區間不渲染回報區:排程卡就在最上面寫著 W27–W31,再放一句「此任務排定於 W27–W31,
  // 非 W37 排定項目」是同一件事講兩次;前幾週回報(歷史)仍保留。
  const reportSection = !(scheduleFirst && !isActiveThisWeek) && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h4", {
    className: "text-sm font-bold text-slate-800 mb-3 flex items-center flex-wrap gap-y-1"
  }, "W", String(currentWeek).padStart(2, '0'), " \u5BE6\u969B\u57F7\u884C\u56DE\u5831", isActiveThisWeek && /*#__PURE__*/React.createElement("span", {
    className: `ml-2 px-2 py-0.5 rounded-full text-[11px] font-bold ${unitLog ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-200 text-slate-500'}`,
    title: wu.mode === 'sub' ? '此子區間的分數;計畫區間本週分數＝各子區間分數平均（未回報＝0）' : '回報成功預設 1 分,未回報 0 分;主管可依表現調整'
  }, "\uD83C\uDFC6 ", score, " \u5206"), wu.mode === 'sub' && /*#__PURE__*/React.createElement("span", {
    className: "ml-2 px-2 py-0.5 rounded-full text-[11px] font-bold bg-sky-100 text-sky-800 border border-sky-300",
    title: "\u672C\u9031\u56DE\u5831\u55AE\u4F4D\uFF1D\u9032\u884C\u4E2D\u7684\u5B50\u5340\u9593,\u6BCF\u500B\u5B50\u5340\u9593\u5404\u81EA\u6253\u5361;\u8A08\u756B\u5340\u9593\u672C\u9031\u5206\u6578\uFF1D\u5B50\u5340\u9593\u5E73\u5747"
  }, "\u5B50\u5340\u9593 ", wu.reported, "/", wu.total, " \u5DF2\u56DE\u5831\u30FB\u5340\u9593\u5F97\u5206 ", Math.round(wu.score * 10) / 10)), wu.mode === 'sub' && /*#__PURE__*/React.createElement("div", {
    className: "mb-3 flex flex-wrap gap-1.5",
    role: "tablist",
    "aria-label": "\u9078\u64C7\u8981\u56DE\u5831\u7684\u5B50\u5340\u9593"
  }, wu.units.map(({
    sub,
    log
  }) => {
    const on = sub.id === unitSub?.id;
    const locked = !on && reportDirty();
    return /*#__PURE__*/React.createElement("button", {
      key: sub.id,
      role: "tab",
      "aria-selected": on,
      onClick: () => switchUnit(sub.id),
      disabled: locked,
      title: locked ? '請先送出或取消目前的回報內容，再切換子區間' : `回報子區間「${sub.name}」（W${String(sub.start).padStart(2, '0')}–W${String(sub.end).padStart(2, '0')}）`,
      className: `px-2.5 py-1 rounded-full text-[11px] font-bold border transition disabled:opacity-50 ${on ? 'text-white border-transparent' : log ? 'bg-green-100 text-green-800 border-green-400 hover:bg-green-200' : 'bg-red-50 text-red-700 border-red-300 hover:bg-red-100'}`,
      style: on ? {
        backgroundColor: BRAND_BTN
      } : {}
    }, log ? '✓ ' : '❗', sub.name);
  })), wu.legacy && /*#__PURE__*/React.createElement("div", {
    className: "mb-2 text-[11px] text-slate-600 bg-slate-100 border border-slate-300 rounded-lg px-2.5 py-1.5"
  }, "\u6B64\u9031\u5DF2\u4EE5\u300C\u8A08\u756B\u5340\u9593\u300D\u70BA\u55AE\u4F4D\u56DE\u5831\u904E\uFF08\u5207\u5206\u5B50\u5340\u9593\u4E4B\u524D\uFF09\uFF0C\u7DAD\u6301\u539F\u55AE\u4F4D\uFF0C\u4E0D\u9700\u518D\u5C0D\u5B50\u5340\u9593\u9010\u4E00\u56DE\u5831\u3002"), unitLog?.updatedAt && /*#__PURE__*/React.createElement("div", {
    className: "text-[11px] text-slate-500 mb-2 flex items-center gap-1.5"
  }, /*#__PURE__*/React.createElement("span", null, "\uD83D\uDD58 \u6700\u5F8C\u7DE8\u8F2F\uFF1A", unitLog.updatedAt), unitLog.reporter && /*#__PURE__*/React.createElement("span", {
    className: "text-slate-500"
  }, "by ", unitLog.reporter), unitLog.reporterRole === 'manager' && /*#__PURE__*/React.createElement("span", {
    className: "px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 font-bold text-[10px]",
    title: "\u6B64\u7B46\u7531\u4E3B\u7BA1\u4EE3\u70BA\u4FEE\u6B63/\u88DC\u767B"
  }, "\u270F\uFE0F \u4E3B\u7BA1\u4FEE\u6B63")), canClockIn ? /*#__PURE__*/React.createElement("div", {
    className: `p-4 rounded-xl border transition-colors ${status && status !== 'not_executed' ? 'bg-blue-50 border-blue-200' : 'bg-slate-100 border-slate-300'}`
  }, isManager && !isMyTask && /*#__PURE__*/React.createElement("div", {
    className: "mb-3 bg-amber-100 border border-amber-400 text-amber-900 rounded-lg px-3.5 py-2.5 text-xs font-bold flex items-center"
  }, /*#__PURE__*/React.createElement("span", {
    className: "mr-2 text-sm"
  }, "\uD83D\uDC51"), /*#__PURE__*/React.createElement("span", null, "\u4E3B\u7BA1\u7279\u6B0A\u6A21\u5F0F\uFF1A\u6B63\u5728\u70BA\u6210\u54E1\u6838\u5BE6\u6216\u8ABF\u88DC W", String(currentWeek).padStart(2, '0'), " \u57F7\u884C\u7D00\u9304")), /*#__PURE__*/React.createElement("div", {
    className: "mb-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "font-bold text-slate-800 text-sm"
  }, unitSub ? /*#__PURE__*/React.createElement(React.Fragment, null, "\u672C\u9031\u300C", /*#__PURE__*/React.createElement("span", {
    className: "text-sky-800"
  }, unitSub.name), "\u300D\u7684\u57F7\u884C\u72C0\u614B") : '本週此任務的執行狀態'), /*#__PURE__*/React.createElement("div", {
    className: "text-xs text-slate-500 mt-0.5"
  }, "\u9078\u4E00\u500B\u72C0\u614B\uFF0C\u8A72\u9031\u7518\u7279\u689D\u5C31\u6703\u6A19\u4E0A\u5C0D\u61C9\u984F\u8272\uFF1B\u5B8C\u6210\u56DE\u5831\u9810\u8A2D 1 \u5206\uFF0C\u4E3B\u7BA1\u53EF\u8ABF\u6574\u3002")), reuseSource && !status && /*#__PURE__*/React.createElement("button", {
    onClick: () => reuseLog(reuseSource),
    className: "mb-3 w-full px-3 py-2 rounded-lg border border-indigo-400 bg-indigo-50 text-indigo-800 text-xs font-bold hover:bg-indigo-100 transition flex items-center justify-center gap-1.5",
    title: `把 W${String(reuseSource.week).padStart(2, '0')} 的狀態與內容帶入，可再修改後送出`
  }, /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true"
  }, "\u21A9"), "\u6CBF\u7528\u4E0A\u6B21\u56DE\u5831\uFF08W", String(reuseSource.week).padStart(2, '0'), "\u30FB", STATUS_META[reuseSource.log.status]?.label, unitSub && history.length === 0 ? '・計畫區間' : '', "\uFF09"), /*#__PURE__*/React.createElement("div", {
    className: "space-y-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-3 gap-2"
  }, Object.entries(STATUS_META).map(([key, meta]) => /*#__PURE__*/React.createElement("button", {
    key: key,
    onClick: () => {
      setStatus(key);
      setNoteError('');
      markModalDirty();
    },
    title: key === 'executed' ? '本週有實際工作進度（甘特條標綠；需填工作說明）' : key === 'monitor' ? '例行監控／觀察，無實作進度（甘特條標藍；說明可不填）' : '本週沒有做（甘特條標灰；可備註原因）',
    className: `py-3 rounded-lg border text-sm font-bold transition ${status === key ? meta.tag + ' ring-2 ring-offset-1 ring-slate-300' : 'bg-white ctl-raised text-slate-500 border-slate-300 hover:border-slate-400'}`
  }, meta.icon, " ", meta.label))), status && /*#__PURE__*/React.createElement("textarea", {
    value: note,
    onChange: e => {
      setNote(e.target.value);
      setNoteError('');
      markModalDirty();
    },
    placeholder: status === 'not_executed' ? '可備註未執行原因（選填）' : status === 'monitor' ? '例行監控項目，可備註（選填）' : '說明本週實際工作內容…',
    className: `w-full border rounded-lg p-3 text-sm h-24 outline-none resize-none focus:border-blue-500 ${noteError ? 'border-red-400' : 'border-slate-300'}`
  }), noteError && /*#__PURE__*/React.createElement("div", {
    className: "text-xs text-red-600 font-bold"
  }, noteError), status && /*#__PURE__*/React.createElement(DocUrlField, {
    id: "log-doc-url",
    value: docUrl,
    onSubmit: submitLog,
    error: docError,
    onChange: v => {
      setDocUrl(v);
      setDocError('');
    }
  })), /*#__PURE__*/React.createElement("div", {
    className: "flex justify-end space-x-3 pt-4"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    className: "px-4 py-2 text-sm text-slate-500 bg-white ctl-raised border border-slate-300 rounded-lg font-bold hover:bg-slate-50"
  }, "\u53D6\u6D88"), /*#__PURE__*/React.createElement("button", {
    onClick: submitLog,
    disabled: saving,
    className: "px-6 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold rounded-lg shadow-md"
  }, saving ? '儲存中…' : '儲存進度回報')), isManager && unitLog && /*#__PURE__*/React.createElement("div", {
    className: "mt-4 pt-3 border-t border-slate-300"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-bold text-slate-500 mb-2"
  }, "\u4E3B\u7BA1\u8A55\u5206\u5FAE\u8ABF\uFF08\u9EDE\u64CA\u5373\u6642\u66F4\u65B0\u5206\u6578", unitSub ? `・子區間「${unitSub.name}」` : '', "\uFF09"), /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-5 gap-1.5"
  }, SCORE_OPTIONS.map(o => /*#__PURE__*/React.createElement("button", {
    key: o.value,
    onClick: () => onUpdateScore(task.id, unitSub?.id ?? null, o.value),
    className: `px-1 py-2 rounded-lg border text-center transition ${score === o.value ? 'bg-indigo-600 text-white border-indigo-700 ring-2 ring-offset-1 ring-indigo-300' : 'bg-white ctl-raised text-slate-600 border-slate-300 hover:border-indigo-400 hover:bg-indigo-50'}`
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-[11px] font-bold leading-tight"
  }, o.label), /*#__PURE__*/React.createElement("div", {
    className: `text-[10px] mt-0.5 ${score === o.value ? 'text-indigo-100' : 'text-slate-500'}`
  }, o.value, " \u5206")))))) : /*#__PURE__*/React.createElement("div", {
    className: "bg-slate-100 border border-slate-300 p-4 rounded-xl text-sm"
  }, isFutureWeek && isActiveThisWeek && /*#__PURE__*/React.createElement("div", {
    className: "mb-3 bg-slate-200 border border-slate-400 text-slate-700 rounded-lg px-3 py-2 text-xs font-bold"
  }, "\uD83D\uDCC5 W", String(currentWeek).padStart(2, '0'), " \u5C1A\u672A\u5230\uFF1A\u4E0D\u958B\u653E\u9810\u5148\u56DE\u5831\uFF08\u672C\u9031\u70BA W", String(todayWeek).padStart(2, '0'), "\uFF09\uFF0C\u6B64\u8655\u50C5\u4F9B\u6AA2\u8996\u6392\u7A0B\u3002"), !isFutureWeek && role === 'member' && isMyTask && isActiveThisWeek && !isReportingWeek && /*#__PURE__*/React.createElement("div", {
    className: "mb-3 bg-yellow-50 border border-yellow-300 text-yellow-800 rounded-lg px-3 py-2 text-xs font-bold"
  }, "\uD83D\uDD12 \u552F\u8B80\u6AA2\u8996\uFF1A\u50C5\u80FD\u56DE\u5831\u672C\u9031 W", String(todayWeek).padStart(2, '0'), " \u7684\u9032\u5EA6\uFF0C\u6B77\u53F2\u9031\u6B21\u53EA\u80FD\u700F\u89BD\u3002"), !isActiveThisWeek ? /*#__PURE__*/React.createElement("div", {
    className: "text-slate-500 text-center py-2"
  }, "\u6B64\u4EFB\u52D9\u6392\u5B9A\u65BC W", task.start, "\u2013W", task.end, "\uFF0C\u975E W", String(currentWeek).padStart(2, '0'), " \u6392\u5B9A\u9805\u76EE\u3002") : unitLog ? /*#__PURE__*/React.createElement("div", null, unitSub && /*#__PURE__*/React.createElement("div", {
    className: "mb-2 text-xs font-bold text-sky-800"
  }, "\u5B50\u5340\u9593\u300C", unitSub.name, "\u300D"), /*#__PURE__*/React.createElement("div", {
    className: "mb-2 flex items-center flex-wrap gap-y-1"
  }, /*#__PURE__*/React.createElement("span", {
    className: "font-bold mr-2"
  }, "\u72C0\u614B\uFF1A"), /*#__PURE__*/React.createElement("span", {
    className: `px-2 py-0.5 rounded text-xs font-bold ${STATUS_META[unitLog.status]?.tag}`
  }, STATUS_META[unitLog.status]?.icon, " ", STATUS_META[unitLog.status]?.label), /*#__PURE__*/React.createElement("span", {
    className: "ml-2 px-2 py-0.5 rounded-full text-xs font-bold bg-indigo-100 text-indigo-700",
    title: "\u56DE\u5831\u6210\u529F\u9810\u8A2D 1 \u5206,\u4E3B\u7BA1\u53EF\u8ABF\u6574"
  }, "\uD83C\uDFC6 ", score, " \u5206")), /*#__PURE__*/React.createElement("div", {
    className: "font-bold mb-1"
  }, "\u5DE5\u4F5C\u8AAA\u660E\uFF1A"), /*#__PURE__*/React.createElement("div", {
    className: "bg-white p-3 rounded border border-slate-300 text-slate-700 whitespace-pre-wrap"
  }, unitLog.note || '（未填寫備註）'), unitLog.docUrl && /*#__PURE__*/React.createElement("div", {
    className: "mt-2"
  }, /*#__PURE__*/React.createElement(DocLink, {
    url: unitLog.docUrl
  })), isManager && /*#__PURE__*/React.createElement("div", {
    className: "mt-3 pt-3 border-t border-slate-300"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-bold text-slate-500 mb-2"
  }, "\u4E3B\u7BA1\u8A55\u5206\uFF08\u9EDE\u64CA\u5373\u4FEE\u6539\u6B64\u9031\u5206\u6578\uFF09"), /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-5 gap-1.5"
  }, SCORE_OPTIONS.map(o => /*#__PURE__*/React.createElement("button", {
    key: o.value,
    onClick: () => onUpdateScore(task.id, unitSub?.id ?? null, o.value),
    className: `px-1 py-2 rounded-lg border text-center transition ${score === o.value ? 'bg-indigo-600 text-white border-indigo-700 ring-2 ring-offset-1 ring-indigo-300' : 'bg-white ctl-raised text-slate-600 border-slate-300 hover:border-indigo-400 hover:bg-indigo-50'}`
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-[11px] font-bold leading-tight"
  }, o.label), /*#__PURE__*/React.createElement("div", {
    className: `text-[10px] mt-0.5 ${score === o.value ? 'text-indigo-100' : 'text-slate-500'}`
  }, o.value, " \u5206")))))) : /*#__PURE__*/React.createElement("div", {
    className: "text-slate-500 text-center py-2"
  }, "\uD83D\uDCCC W", String(currentWeek).padStart(2, '0'), " \u672A\u56DE\u5831", unitSub ? `子區間「${unitSub.name}」` : '此項目', "\uFF08\u7DAD\u6301\u8A08\u756B\u4E2D\uFF0C\uD83C\uDFC6 0 \u5206\uFF09\u3002")));

  // 前幾週回報:緊接在「本週回報」下方(2026-09-13 版面重排前是正上方),寫的時候往下看一眼就能對照上週寫到哪。
  // 沒有歷史就整塊不渲染(不留空殼),避免新區間第一次打卡時多一塊沒內容的區域。
  const historySection = history.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "border border-slate-300 rounded-xl overflow-hidden"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setHistoryOpen(v => !v),
    className: "w-full bg-slate-100 hover:bg-slate-200 px-4 py-2 flex items-center justify-between gap-2 text-left transition",
    "aria-expanded": historyOpen,
    "aria-controls": "task-history-list"
  }, /*#__PURE__*/React.createElement("span", {
    className: "flex items-center gap-2 min-w-0"
  }, /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    className: "flex-shrink-0 text-[10px] text-slate-600"
  }, historyOpen ? '▼' : '▶'), /*#__PURE__*/React.createElement("span", {
    className: "flex-shrink-0 text-sm font-bold text-slate-800"
  }, unitSub ? `「${unitSub.name}」` : '', "\u524D\u5E7E\u9031\u56DE\u5831\uFF08", history.length, " \u9031\uFF09"), !historyOpen && /*#__PURE__*/React.createElement("span", {
    className: `flex-shrink-0 px-2 py-0.5 rounded text-[11px] font-bold ${STATUS_META[history[0].log.status]?.tag}`
  }, "\u6700\u8FD1 W", String(history[0].week).padStart(2, '0'), " ", STATUS_META[history[0].log.status]?.icon, " ", STATUS_META[history[0].log.status]?.label)), /*#__PURE__*/React.createElement("span", {
    className: "flex-shrink-0 text-xs font-bold text-blue-700"
  }, historyOpen ? '收合' : '展開')), historyOpen && /*#__PURE__*/React.createElement("div", {
    id: "task-history-list",
    className: "max-h-56 overflow-y-auto divide-y divide-slate-200"
  }, history.map(h => /*#__PURE__*/React.createElement("div", {
    key: h.week,
    className: "px-4 py-2.5 bg-white"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center flex-wrap gap-1.5"
  }, /*#__PURE__*/React.createElement("span", {
    className: "px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 font-bold text-[11px] font-mono"
  }, "W", String(h.week).padStart(2, '0')), /*#__PURE__*/React.createElement("span", {
    className: `px-2 py-0.5 rounded text-[11px] font-bold ${STATUS_META[h.log.status]?.tag}`
  }, STATUS_META[h.log.status]?.icon, " ", STATUS_META[h.log.status]?.label), h.log.reporterRole === 'manager' && /*#__PURE__*/React.createElement("span", {
    className: "px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 font-bold text-[10px]",
    title: "\u6B64\u7B46\u7531\u4E3B\u7BA1\u4EE3\u70BA\u4FEE\u6B63/\u88DC\u767B"
  }, "\u270F\uFE0F \u4E3B\u7BA1\u4FEE\u6B63"), canClockIn && /*#__PURE__*/React.createElement("button", {
    onClick: () => reuseLog(h),
    className: "ml-auto flex-shrink-0 px-2 py-0.5 rounded border text-[11px] font-bold bg-white ctl-raised text-slate-600 border-slate-400 hover:border-indigo-500 hover:bg-indigo-50 transition",
    title: `把 W${String(h.week).padStart(2, '0')} 的狀態與內容帶入本週草稿，可再修改後送出`
  }, "\u6CBF\u7528")), /*#__PURE__*/React.createElement("div", {
    className: "mt-1 text-xs text-slate-700 whitespace-pre-wrap break-words leading-relaxed"
  }, h.log.note || /*#__PURE__*/React.createElement("span", {
    className: "text-slate-500 italic"
  }, "\uFF08\u672A\u586B\u5BEB\u8AAA\u660E\uFF09")), h.log.docUrl && /*#__PURE__*/React.createElement("div", {
    className: "mt-1.5"
  }, /*#__PURE__*/React.createElement(DocLink, {
    url: h.log.docUrl
  })), h.log.updatedAt && /*#__PURE__*/React.createElement("div", {
    className: "text-[10px] text-slate-500 mt-1"
  }, "\uD83D\uDD58 \u6700\u5F8C\u7DE8\u8F2F ", h.log.updatedAt, h.log.reporter ? `（${h.log.reporter}）` : '')))));

  // 排程＋子區間＝「設定」不是「每週要做的事」(主管一年改幾次排程、負責人專案開始時切一次子區間),
  // 2026-09-13 起合併成一張可折疊卡:打卡情境(從回報面板開、或成員點自己本週可打卡的條)放最下面且**預設收合**
  // (原本兩張卡佔 600px+,把回報表單推到折線下,每次打卡都要先捲一段);從甘特條開(scheduleFirst)或唯讀情境
  // (沒有回報表單)排程就是主要內容 → 置頂＋預設展開;排程驗證錯誤／子區間編輯中／新增列有字時強制展開,
  // 表單不會在使用者眼前被收掉。收合時標題列自帶摘要(起迄週、子區間數與進行中幾個)。
  const setupSection = /*#__PURE__*/React.createElement("div", {
    className: "border border-slate-300 rounded-xl overflow-hidden"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setSetupOpenState(v => !v),
    disabled: setupForced,
    className: "w-full bg-slate-100 hover:bg-slate-200 px-4 py-2 flex items-center justify-between gap-2 text-left transition disabled:cursor-default",
    "aria-expanded": setupOpen,
    "aria-controls": "task-setup-body",
    title: setupForced ? '排程或子區間編輯中，請先儲存或取消' : setupOpen ? '收合排程與子區間' : '展開以檢視或編輯排程與子區間'
  }, /*#__PURE__*/React.createElement("span", {
    className: "flex items-center gap-2 min-w-0 flex-wrap"
  }, /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    className: "flex-shrink-0 text-[10px] text-slate-600"
  }, setupOpen ? '▼' : '▶'), /*#__PURE__*/React.createElement("span", {
    className: "flex-shrink-0 text-sm font-bold text-slate-800"
  }, "\u6392\u7A0B\u8207\u5B50\u5340\u9593"), !setupOpen && /*#__PURE__*/React.createElement("span", {
    className: "text-[11px] text-slate-600 min-w-0 truncate"
  }, "W", String(task.start).padStart(2, '0'), "\u2013W", String(task.end).padStart(2, '0'), task.nid ? `・NID ${task.nid}` : '', subs.length > 0 ? `・子區間 ${subs.length}（進行中 ${subs.filter(x => x.start <= todayWeek && x.end >= todayWeek).length}）` : ''), isManager && /*#__PURE__*/React.createElement("span", {
    className: "flex-shrink-0 text-[10px] bg-yellow-200 text-yellow-800 px-2 py-0.5 rounded font-bold"
  }, "\u4E3B\u7BA1\u53EF\u7DE8\u8F2F")), /*#__PURE__*/React.createElement("span", {
    className: "flex-shrink-0 text-xs font-bold text-blue-700"
  }, setupOpen ? '收合' : '展開')), setupOpen && /*#__PURE__*/React.createElement("div", {
    id: "task-setup-body",
    className: "p-3 space-y-3 bg-white"
  }, /*#__PURE__*/React.createElement("div", {
    className: "bg-slate-100 p-4 rounded-xl border border-slate-300"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex justify-between items-center mb-3"
  }, /*#__PURE__*/React.createElement("label", {
    className: "text-sm font-bold text-slate-800"
  }, "\u5C08\u6848\u6392\u7A0B\u8207\u9810\u8A08\u4E8B\u9805")), /*#__PURE__*/React.createElement("input", {
    type: "text",
    value: taskName,
    onChange: e => {
      setTaskName(e.target.value);
      setScheduleError('');
      markModalDirty();
    },
    disabled: !isManager,
    onKeyDown: onEnterSubmit(submitSchedule),
    className: "w-full border border-slate-300 rounded-md p-2 text-sm mb-3 text-center disabled:bg-slate-100 disabled:text-slate-500 outline-none focus:border-blue-500"
  }), /*#__PURE__*/React.createElement("div", {
    className: "flex space-x-3 items-center"
  }, /*#__PURE__*/React.createElement("div", {
    className: "w-1/2"
  }, /*#__PURE__*/React.createElement("label", {
    className: "text-[10px] text-slate-500 font-bold"
  }, "\u958B\u59CB\u9031", /*#__PURE__*/React.createElement(ReqMark, null)), /*#__PURE__*/React.createElement("input", {
    type: "number",
    min: "1",
    max: weeksTotal,
    value: startWeek,
    onChange: e => {
      setStartWeek(e.target.value);
      setScheduleError('');
      markModalDirty();
    },
    disabled: !isManager,
    onKeyDown: onEnterSubmit(submitSchedule),
    className: "w-full border border-slate-300 rounded-md p-2 text-sm disabled:bg-slate-100 disabled:text-slate-500 outline-none focus:border-blue-500"
  })), /*#__PURE__*/React.createElement("div", {
    className: "w-1/2"
  }, /*#__PURE__*/React.createElement("label", {
    className: "text-[10px] text-slate-500 font-bold"
  }, "\u7D50\u675F\u9031", /*#__PURE__*/React.createElement(ReqMark, null)), /*#__PURE__*/React.createElement("input", {
    type: "number",
    min: "1",
    max: weeksTotal,
    value: endWeek,
    onChange: e => {
      setEndWeek(e.target.value);
      setScheduleError('');
      markModalDirty();
    },
    disabled: !isManager,
    onKeyDown: onEnterSubmit(submitSchedule),
    className: "w-full border border-slate-300 rounded-md p-2 text-sm disabled:bg-slate-100 disabled:text-slate-500 outline-none focus:border-blue-500"
  }))), /*#__PURE__*/React.createElement("div", {
    className: "mt-3"
  }, /*#__PURE__*/React.createElement("label", {
    className: "text-[10px] text-slate-500 font-bold"
  }, "NID\uFF08\u6B64\u5340\u9593\u5C0D\u61C9\u54EA\u7D44 NID\uFF0C\u9078\u586B\uFF09"), /*#__PURE__*/React.createElement("input", {
    type: "text",
    value: taskNid,
    onChange: e => {
      setTaskNid(e.target.value);
      setScheduleError('');
      markModalDirty();
    },
    disabled: !isManager,
    onKeyDown: onEnterSubmit(submitSchedule),
    className: "w-full border border-slate-300 rounded-md p-2 text-sm disabled:bg-slate-100 disabled:text-slate-500 outline-none focus:border-blue-500",
    placeholder: "\u5982 N001\u2026"
  })), scheduleError && /*#__PURE__*/React.createElement("div", {
    className: "mt-2 text-xs text-red-600 font-bold"
  }, scheduleError), isManager && /*#__PURE__*/React.createElement("div", {
    className: "mt-3 flex items-center justify-between gap-3"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => onDeleteTask(proj, task),
    className: "flex-shrink-0 px-2 py-1.5 rounded text-xs font-bold text-red-700 hover:bg-red-50 hover:text-red-800 transition",
    title: "\u522A\u9664\u6B64\u8A08\u756B\u5340\u9593\uFF08\u8EDF\u522A\u9664\uFF0C\u53EF\u7531\u8CC7\u6599\u5EAB\u9084\u539F\uFF09"
  }, "\uD83D\uDDD1 \u522A\u9664\u5340\u9593"), /*#__PURE__*/React.createElement("button", {
    onClick: submitSchedule,
    disabled: saving || !scheduleDirty,
    className: "flex-shrink-0 text-white px-6 py-1.5 rounded text-sm font-bold transition hover:opacity-90 disabled:opacity-50",
    style: {
      backgroundColor: BRAND_BTN
    },
    title: scheduleDirty ? '儲存上方的名稱、起迄週與 NID（子區間各列已各自儲存）' : '上方的排程欄位尚未變更'
  }, saving ? '儲存中…' : scheduleDirty ? '儲存排程' : '排程未變更'))), (subs.length > 0 || canEditSubs) && /*#__PURE__*/React.createElement("div", {
    className: "border border-slate-300 rounded-xl overflow-hidden"
  }, /*#__PURE__*/React.createElement("div", {
    className: "bg-slate-100 px-4 py-2 flex items-center justify-between gap-2 flex-wrap"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-sm font-bold text-slate-800"
  }, "\u5B50\u5340\u9593\uFF08", subs.length, "\uFF09"), /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] text-slate-500"
  }, "\u6BCF\u5217\u5404\u81EA\u5132\u5B58\uFF08\u4E0D\u7D93\u4E0A\u65B9\u300C\u5132\u5B58\u6392\u7A0B\u300D\uFF09\uFF1B\u7518\u7279\u5716\u4E0A\u4EE5\u7E2E\u6392\u5B50\u5217\u986F\u793A\uFF0C\u53EF\u91CD\u758A", SUB_CHECKIN ? '；該週進行中的子區間即為回報單位' : '')), /*#__PURE__*/React.createElement("div", {
    className: "divide-y divide-slate-200"
  }, subs.length === 0 && /*#__PURE__*/React.createElement("div", {
    className: "px-4 py-2.5 text-xs text-slate-500 italic bg-white"
  }, "\u5C1A\u672A\u5207\u5206\u5B50\u5340\u9593"), subs.map(x => {
    const ph = x.end < todayWeek ? '已結束' : x.start > todayWeek ? '未開始' : '進行中';
    const phCls = ph === '進行中' ? 'bg-sky-100 text-sky-800 border-sky-300' : ph === '未開始' ? 'bg-slate-100 text-slate-600 border-slate-300' : 'bg-slate-200 text-slate-600 border-slate-300';
    return subEditId === x.id ? /*#__PURE__*/React.createElement("div", {
      key: x.id,
      className: "px-4 py-2.5 bg-blue-50/40 flex items-center gap-2"
    }, /*#__PURE__*/React.createElement("input", {
      autoFocus: true,
      type: "text",
      value: subForm.name,
      onChange: e => setSubField('name', e.target.value),
      onKeyDown: onEnterSubmit(submitSub),
      className: `${subInputCls} flex-1 min-w-0`,
      "aria-label": "\u5B50\u5340\u9593\u540D\u7A31"
    }), /*#__PURE__*/React.createElement("input", {
      type: "number",
      min: task.start,
      max: task.end,
      value: subForm.start,
      onChange: e => setSubField('start', e.target.value),
      onKeyDown: onEnterSubmit(submitSub),
      className: `${subInputCls} w-16`,
      "aria-label": "\u958B\u59CB\u9031"
    }), /*#__PURE__*/React.createElement("span", {
      className: "text-slate-500 text-xs",
      "aria-hidden": "true"
    }, "\u2013"), /*#__PURE__*/React.createElement("input", {
      type: "number",
      min: task.start,
      max: task.end,
      value: subForm.end,
      onChange: e => setSubField('end', e.target.value),
      onKeyDown: onEnterSubmit(submitSub),
      className: `${subInputCls} w-16`,
      "aria-label": "\u7D50\u675F\u9031"
    }), /*#__PURE__*/React.createElement("button", {
      onClick: submitSub,
      disabled: subSaving,
      className: "flex-shrink-0 px-2.5 py-1 rounded text-xs font-bold text-white hover:opacity-90 disabled:opacity-50",
      style: {
        backgroundColor: BRAND_BTN
      }
    }, subSaving ? '儲存中…' : '儲存'), /*#__PURE__*/React.createElement("button", {
      onClick: cancelEditSub,
      className: "flex-shrink-0 px-2 py-1 rounded text-xs font-bold text-slate-600 bg-slate-100 border border-slate-300 hover:bg-slate-200"
    }, "\u53D6\u6D88")) : /*#__PURE__*/React.createElement("div", {
      key: x.id,
      className: "px-4 py-2 bg-white flex items-center gap-2"
    }, /*#__PURE__*/React.createElement("span", {
      className: "flex-1 min-w-0 truncate text-sm text-slate-800",
      title: x.name
    }, x.name), (() => {
      const u = wu.mode === 'sub' ? wu.units.find(v => v.sub.id === x.id) : null;
      if (!u) return null;
      return u.log ? /*#__PURE__*/React.createElement("span", {
        className: `flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold ${STATUS_META[u.log.status]?.tag}`
      }, "\u672C\u9031 ", STATUS_META[u.log.status]?.icon, " ", STATUS_META[u.log.status]?.label) : /*#__PURE__*/React.createElement("span", {
        className: "flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700 border border-red-300"
      }, "\u2757\u672C\u9031\u672A\u56DE\u5831");
    })(), /*#__PURE__*/React.createElement("span", {
      className: "flex-shrink-0 px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 font-bold text-[11px] font-mono"
    }, "W", String(x.start).padStart(2, '0'), "\u2013W", String(x.end).padStart(2, '0')), /*#__PURE__*/React.createElement("span", {
      className: `flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold border ${phCls}`
    }, ph), canEditSubs && (() => {
      const logCount = Object.keys(subLogs[x.id] || {}).length;
      const delLocked = subRowActionsLocked || logCount > 0 && !isManager;
      const delHint = subRowActionsLocked ? subRowLockHint : logCount > 0 ? isManager ? `刪除（含 ${logCount} 筆回報，可復原）` : `已有 ${logCount} 筆回報，僅主管可刪除` : '刪除';
      return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("button", {
        onClick: () => beginEditSub(x),
        "aria-label": `編輯子區間「${x.name}」`,
        title: subRowActionsLocked ? subRowLockHint : '編輯',
        disabled: subRowActionsLocked,
        className: "flex-shrink-0 w-6 h-6 flex items-center justify-center rounded text-blue-600 hover:bg-blue-100 disabled:opacity-40"
      }, "\u270E"), /*#__PURE__*/React.createElement("button", {
        onClick: () => onDeleteSub(proj.id, task.id, x),
        "aria-label": `刪除子區間「${x.name}」`,
        title: delHint,
        disabled: delLocked,
        className: "flex-shrink-0 w-6 h-6 flex items-center justify-center rounded text-red-500 hover:bg-red-100 disabled:opacity-40"
      }, "\uD83D\uDDD1"));
    })());
  }), canEditSubs && subEditId === null && (subs.length >= SUB_MAX ? /*#__PURE__*/React.createElement("div", {
    className: "px-4 py-2 text-[11px] text-slate-500 bg-white"
  }, "\u5DF2\u9054\u4E0A\u9650\uFF08\u6BCF\u689D\u8A08\u756B\u5340\u9593\u6700\u591A ", SUB_MAX, " \u500B\u5B50\u5340\u9593\uFF09") : /*#__PURE__*/React.createElement("div", {
    className: "px-4 py-2.5 bg-white flex items-center gap-2"
  }, /*#__PURE__*/React.createElement("input", {
    type: "text",
    value: subForm.name,
    onChange: e => setSubField('name', e.target.value),
    onKeyDown: onEnterSubmit(submitSub),
    className: `${subInputCls} flex-1 min-w-0`,
    placeholder: "\u65B0\u589E\u5B50\u5340\u9593\uFF0C\u5982\uFF1A\u6E96\u5099\u8CC7\u6599",
    "aria-label": "\u65B0\u589E\u5B50\u5340\u9593\u540D\u7A31"
  }), /*#__PURE__*/React.createElement("input", {
    type: "number",
    min: task.start,
    max: task.end,
    value: subForm.start,
    onChange: e => setSubField('start', e.target.value),
    onKeyDown: onEnterSubmit(submitSub),
    className: `${subInputCls} w-16`,
    placeholder: String(task.start),
    "aria-label": "\u958B\u59CB\u9031",
    title: `留空＝W${task.start}（計畫區間的開始週）`
  }), /*#__PURE__*/React.createElement("span", {
    className: "text-slate-500 text-xs",
    "aria-hidden": "true"
  }, "\u2013"), /*#__PURE__*/React.createElement("input", {
    type: "number",
    min: task.start,
    max: task.end,
    value: subForm.end,
    onChange: e => setSubField('end', e.target.value),
    onKeyDown: onEnterSubmit(submitSub),
    className: `${subInputCls} w-16`,
    placeholder: String(task.end),
    "aria-label": "\u7D50\u675F\u9031",
    title: `留空＝W${task.end}（計畫區間的結束週）`
  }), /*#__PURE__*/React.createElement("button", {
    onClick: submitSub,
    disabled: subSaving,
    className: "flex-shrink-0 px-2.5 py-1 rounded text-xs font-bold bg-white ctl-raised text-blue-700 border border-blue-300 hover:bg-blue-600 hover:text-white disabled:opacity-50 transition"
  }, subSaving ? '儲存中…' : '＋ 新增'))), subError && /*#__PURE__*/React.createElement("div", {
    className: "px-4 py-2 text-xs text-red-600 font-bold bg-white"
  }, subError)))));
  return /*#__PURE__*/React.createElement("div", _extends({}, focus, {
    className: "fixed inset-0 bg-slate-900/50 backdrop-blur-sm modal-scrim z-[100] flex justify-center items-center p-4"
  }), /*#__PURE__*/React.createElement("div", {
    className: "bg-white rounded-2xl shadow-2xl modal-card w-full max-w-lg overflow-hidden max-h-[90vh] flex flex-col",
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("div", {
    className: "px-6 py-4 text-white flex justify-between items-start flex-shrink-0",
    style: {
      backgroundColor: isManager ? '#001F5B' : '#334155'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "pr-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-xs text-white/80 font-medium mb-1 flex items-center"
  }, "\u8CA0\u8CAC\u4EBA\uFF1A", proj.owner, /*#__PURE__*/React.createElement("span", {
    className: `ml-2 px-1.5 rounded text-[10px] font-bold border ${PROJECT_TYPES[proj.type].chip}`
  }, proj.type.toUpperCase(), " ", PROJECT_TYPES[proj.type].label)), /*#__PURE__*/React.createElement("h3", {
    className: "font-bold text-lg leading-snug"
  }, proj.name), /*#__PURE__*/React.createElement("div", {
    className: "text-xs text-white/85 font-medium mt-1"
  }, task.name, "\u30FBW", String(task.start).padStart(2, '0'), "\u2013W", String(task.end).padStart(2, '0'), task.nid ? `・NID ${task.nid}` : '')), /*#__PURE__*/React.createElement(CloseButton, {
    onClick: onClose,
    className: "text-white/60 hover:text-white flex-shrink-0"
  })), /*#__PURE__*/React.createElement("div", {
    className: "p-6 space-y-6 overflow-y-auto min-h-0"
  }, scheduleFirst ? /*#__PURE__*/React.createElement(React.Fragment, null, setupSection, historySection, reportSection) : /*#__PURE__*/React.createElement(React.Fragment, null, reportSection, historySection, setupSection))));
}

// future:未來週次(主管也不能預先填,唯讀文案不同)
function ExtraNoteModal({
  currentWeek,
  initialNote,
  readOnly,
  future = false,
  targetUser,
  meta,
  onClose,
  onSave
}) {
  const focus = useModalFocus(); // 開啟時焦點移入、Tab 鎖在視窗內、關閉時還原
  const [note, setNote] = useState(initialNote);
  // 文件連結存在 meta 裡(見 Program.cs bootstrap 的說明:內容本身是純字串,
  // 改成物件會動到十幾個取值點;meta 本來就一路傳到每個顯示/編輯的地方)
  const [docUrl, setDocUrl] = useState(meta?.docUrl || '');
  const [error, setError] = useState('');
  const [docError, setDocError] = useState('');
  const [saving, setSaving] = useState(false);
  useModalDirtyReset();
  // 非專案事項為「選填」:允許空白儲存(=清空本週內容),不強迫填字。
  // ⚠ 只留文件連結不算「清空」——那時按鈕仍該是「送出回報」,否則使用者會以為連結也會被丟掉
  const isClearing = !note.trim() && !docUrl.trim() && !!initialNote;
  const submit = async () => {
    if (saving) return;
    const {
      doc,
      error: dErr
    } = validateDocInput(docUrl);
    if (dErr) {
      setDocError(dErr);
      return;
    }
    if (doc !== docUrl) setDocUrl(doc);
    setSaving(true);
    try {
      await onSave(note.trim(), doc);
    } finally {
      setSaving(false);
    }
  };
  if (readOnly) {
    return /*#__PURE__*/React.createElement("div", _extends({}, focus, {
      className: "fixed inset-0 bg-slate-900/60 backdrop-blur-sm modal-scrim z-[110] flex justify-center items-center p-4"
    }), /*#__PURE__*/React.createElement("div", {
      className: "bg-white rounded-2xl shadow-2xl modal-card w-full max-w-lg overflow-hidden",
      onClick: e => e.stopPropagation()
    }, /*#__PURE__*/React.createElement("div", {
      className: "px-6 py-4 text-white flex justify-between items-center",
      style: {
        backgroundColor: '#475569'
      }
    }, /*#__PURE__*/React.createElement("h3", {
      className: "font-bold text-lg",
      style: {
        color: '#FFFFFF'
      }
    }, "\uD83D\uDD12 W", currentWeek, " \u975E\u5C08\u6848\u5DE5\u4F5C\uFF08\u552F\u8B80\uFF09"), /*#__PURE__*/React.createElement(CloseButton, {
      onClick: onClose,
      className: "text-white/60 hover:text-white"
    })), /*#__PURE__*/React.createElement("div", {
      className: "p-6"
    }, /*#__PURE__*/React.createElement("p", {
      className: "text-xs text-slate-500 mb-3"
    }, future ? `W${currentWeek} 尚未到，不開放預先填寫。` : '歷史週次僅供瀏覽，無法修改。'), initialNote ? /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      className: "text-sm text-slate-700 bg-slate-100 border border-slate-300 rounded-lg p-4 whitespace-pre-wrap"
    }, initialNote), meta?.docUrl && /*#__PURE__*/React.createElement("div", {
      className: "mt-2"
    }, /*#__PURE__*/React.createElement(DocLink, {
      url: meta.docUrl
    })), /*#__PURE__*/React.createElement(MetaLine, {
      meta: meta
    })) : /*#__PURE__*/React.createElement("div", {
      className: "text-sm text-slate-500 italic text-center py-6"
    }, "\u8A72\u9031\u672A\u586B\u5BEB\u975E\u5C08\u6848\u4E8B\u9805"), /*#__PURE__*/React.createElement("div", {
      className: "flex justify-end pt-4"
    }, /*#__PURE__*/React.createElement("button", {
      onClick: onClose,
      className: "px-6 py-2 text-sm bg-slate-600 hover:bg-slate-700 text-white font-bold rounded-lg"
    }, "\u95DC\u9589")))));
  }
  return (
    /*#__PURE__*/
    // 注意:全站慣例 — 所有彈出視窗/面板的遮罩都「不」綁 onClick 關閉(避免誤點視窗外遺失輸入),一律用「取消」「×」或送出按鈕關閉;新增 Modal 請沿用
    React.createElement("div", _extends({}, focus, {
      className: "fixed inset-0 bg-slate-900/60 backdrop-blur-sm modal-scrim z-[110] flex justify-center items-center p-4"
    }), /*#__PURE__*/React.createElement("div", {
      className: "bg-white rounded-2xl shadow-2xl modal-card w-full max-w-lg overflow-hidden",
      onClick: e => e.stopPropagation()
    }, /*#__PURE__*/React.createElement("div", {
      className: "px-6 py-4 text-white flex justify-between items-center",
      style: {
        backgroundColor: '#C2410C'
      }
    }, /*#__PURE__*/React.createElement("h3", {
      className: "font-bold text-lg flex items-center",
      style: {
        color: '#FFFFFF'
      }
    }, "\uD83D\uDCDD \u586B\u5BEB W", currentWeek, " \u975E\u5C08\u6848\u5DE5\u4F5C", targetUser ? `（${targetUser}）` : ''), /*#__PURE__*/React.createElement(CloseButton, {
      onClick: onClose,
      className: "text-white/60 hover:text-white"
    })), /*#__PURE__*/React.createElement("div", {
      className: "p-6"
    }, targetUser && /*#__PURE__*/React.createElement("div", {
      className: "mb-4 bg-amber-100 border border-amber-400 text-amber-900 rounded-lg px-3 py-2.5 text-xs font-bold flex items-center"
    }, /*#__PURE__*/React.createElement("span", {
      className: "mr-2 text-sm"
    }, "\uD83D\uDC51"), /*#__PURE__*/React.createElement("span", null, "\u4E3B\u7BA1\u4EE3\u4FEE\u6A21\u5F0F\uFF1A\u6B63\u5728\u7DE8\u8F2F ", targetUser, " \u7684\u5167\u5BB9\uFF0C\u7570\u52D5\u7D00\u9304\u5C07\u6A19\u8A18\u70BA\u4E3B\u7BA1\u4FEE\u6B63\u3002")), initialNote ? /*#__PURE__*/React.createElement("div", {
      className: "mb-4 bg-green-50 border border-green-300 text-green-800 rounded-lg px-3 py-2.5 text-sm font-bold"
    }, /*#__PURE__*/React.createElement("div", {
      className: "flex items-center"
    }, /*#__PURE__*/React.createElement("span", {
      className: "mr-2"
    }, "\u2705"), " \u672C\u9031\u5DF2\u9001\u51FA\u904E\uFF0C\u4EE5\u4E0B\u70BA\u5DF2\u5132\u5B58\u7684\u5167\u5BB9\uFF0C\u53EF\u4FEE\u6539\u5F8C\u91CD\u65B0\u9001\u51FA\u3002"), /*#__PURE__*/React.createElement(MetaLine, {
      meta: meta,
      className: "text-[11px] text-green-700 font-medium mt-1"
    })) : /*#__PURE__*/React.createElement("div", {
      className: "mb-4 bg-yellow-50 border border-yellow-300 text-yellow-800 rounded-lg px-3 py-2.5 text-sm font-bold flex items-center"
    }, /*#__PURE__*/React.createElement("span", {
      className: "mr-2"
    }, "\uD83D\uDCED"), " \u672C\u9031\u5C1A\u672A\u586B\u5BEB\u3002"), /*#__PURE__*/React.createElement("p", {
      className: "text-sm text-slate-500 mb-4 border-l-4 border-orange-400 pl-3"
    }, "\u5C08\u6848\u5916\u7684\u9805\u76EE\uFF08\u65E5\u5E38\u7DAD\u904B\u3001\u81E8\u6642\u4EA4\u8FA6\u3001\u6703\u8B70\u3001\u6559\u80B2\u8A13\u7DF4\u7B49\uFF09\u8ACB\u586B\u5BEB\u65BC\u6B64\uFF0C\u6703\u5448\u73FE\u5728\u5718\u968A\u7E3D\u7D50\u770B\u677F\u3002", /*#__PURE__*/React.createElement("span", {
      className: "block mt-1 text-slate-500"
    }, "\u6B64\u6B04\u70BA\u9078\u586B\uFF0C\u96A8\u6642\u53EF\u6E05\u7A7A\u5167\u5BB9\u5F8C\u5132\u5B58\u3002")), /*#__PURE__*/React.createElement("textarea", {
      value: note,
      onChange: e => {
        setNote(e.target.value);
        setError('');
        markModalDirty();
      },
      placeholder: "例如：\n1. 協助 OOO 機台異常處理 (1天)\n2. 參加跨部門會議…",
      className: `w-full border rounded-lg p-3 text-sm h-40 outline-none focus:ring-2 focus:ring-orange-400 resize-none ${error ? 'border-red-400' : 'border-slate-300'}`
    }), error && /*#__PURE__*/React.createElement("div", {
      className: "text-xs text-red-600 font-bold mt-1"
    }, error), /*#__PURE__*/React.createElement("div", {
      className: "mt-3"
    }, /*#__PURE__*/React.createElement(DocUrlField, {
      id: "extra-doc-url",
      value: docUrl,
      onSubmit: submit,
      error: docError,
      onChange: v => {
        setDocUrl(v);
        setDocError('');
      }
    })), /*#__PURE__*/React.createElement("div", {
      className: "flex justify-end space-x-3 pt-4"
    }, /*#__PURE__*/React.createElement("button", {
      onClick: onClose,
      className: "px-4 py-2 text-sm text-slate-600 bg-slate-100 rounded-lg font-bold hover:bg-slate-200"
    }, "\u53D6\u6D88"), /*#__PURE__*/React.createElement("button", {
      onClick: submit,
      disabled: saving,
      className: `px-6 py-2 text-sm text-white font-bold rounded-lg shadow-md disabled:opacity-50 ${isClearing ? 'bg-slate-500 hover:bg-slate-600' : 'bg-orange-500 hover:bg-orange-600'}`
    }, saving ? '儲存中…' : isClearing ? '清空內容' : '送出回報')))))
  );
}

// 具體產出項目:專案「全部執行完畢後」預計交付的具體成果(專案層級,所有計畫區間共用);
// 負責人本人與主管可編輯(SP 內再驗一次權限),其他成員唯讀
function DeliverableModal({
  proj,
  role,
  currentUser,
  onClose,
  onSave
}) {
  const focus = useModalFocus(); // 開啟時焦點移入、Tab 鎖在視窗內、關閉時還原
  const canEdit = role === 'manager' || proj.owner === currentUser;
  const [text, setText] = useState(proj.deliverable || '');
  const [mpSaving, setMpSaving] = useState(proj.mpSaving || '');
  const [saving, setSaving] = useState(false);
  useModalDirtyReset();
  const submit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onSave(proj.id, text.trim(), mpSaving.trim());
    } finally {
      setSaving(false);
    }
  };
  return /*#__PURE__*/React.createElement("div", _extends({}, focus, {
    className: "fixed inset-0 bg-slate-900/50 backdrop-blur-sm modal-scrim z-[130] flex justify-center items-center p-4"
  }), /*#__PURE__*/React.createElement("div", {
    className: "bg-white rounded-2xl shadow-2xl modal-card w-full max-w-lg overflow-hidden",
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("div", {
    className: "px-6 py-4 text-white flex justify-between items-start",
    style: {
      backgroundColor: '#B45309'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "pr-3"
  }, /*#__PURE__*/React.createElement("h3", {
    className: "font-bold text-lg",
    style: {
      color: '#FFFFFF'
    }
  }, "\uD83C\uDFAF \u5177\u9AD4\u7522\u51FA\u8207 MP \u6548\u76CA"), /*#__PURE__*/React.createElement("p", {
    className: "text-xs mt-0.5 break-words leading-snug",
    style: {
      color: '#FEF3C7'
    }
  }, proj.name, "\uFF08\u8CA0\u8CAC\u4EBA\uFF1A", proj.owner, "\uFF09")), /*#__PURE__*/React.createElement(CloseButton, {
    onClick: onClose,
    className: "text-white/70 hover:text-white flex-shrink-0"
  })), /*#__PURE__*/React.createElement("div", {
    className: "p-6"
  }, /*#__PURE__*/React.createElement("p", {
    className: "text-sm text-slate-500 mb-4 border-l-4 border-amber-400 pl-3"
  }, "\u8ACB\u63CF\u8FF0\u6B64\u5C08\u6848", /*#__PURE__*/React.createElement("span", {
    className: "font-bold text-slate-700"
  }, "\u5168\u90E8\u57F7\u884C\u5B8C\u7562\u5F8C"), "\u9810\u8A08\u4EA4\u4ED8\u7684\u5177\u9AD4\u6210\u679C\u8207\u9810\u671F\u6E1B\u5C11\u7684\u4EBA\u529B\u8CA0\u64D4\uFF08MP \u4EBA\u529B\u7BC0\u7701\uFF09\u3002"), canEdit ? /*#__PURE__*/React.createElement("div", {
    className: "space-y-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex justify-end mb-1"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-bold"
  }, role === 'manager' ? '主管可編輯' : '負責人可編輯')), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "block text-xs font-bold text-slate-700 mb-1"
  }, "\uD83C\uDFAF \u5177\u9AD4\u7522\u51FA\u6210\u679C\u9805\u76EE"), /*#__PURE__*/React.createElement("textarea", {
    value: text,
    onChange: e => {
      setText(e.target.value);
      markModalDirty();
    },
    autoFocus: true,
    placeholder: "\u63CF\u8FF0\u5C08\u6848\u5B8C\u6210\u5F8C\u8981\u4EA4\u4ED8\u7684\u6700\u7D42\u6210\u679C\uFF08\u7CFB\u7D71\u4E0A\u7DDA\u3001SOP \u6587\u4EF6\u7B49\uFF09\u2026",
    className: "w-full border border-slate-300 rounded-lg p-3 text-sm h-28 outline-none focus:ring-2 focus:ring-amber-400 resize-none"
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "block text-xs font-bold text-slate-700 mb-1"
  }, "\uD83D\uDCA1 MP Saving (\u9078\u586B)"), /*#__PURE__*/React.createElement("input", {
    type: "text",
    value: mpSaving,
    onChange: e => {
      setMpSaving(e.target.value);
      markModalDirty();
    },
    onKeyDown: onEnterSubmit(submit),
    placeholder: "\u4F8B\u5982\uFF1A0.5 \u4EBA/\u6708\u3001\u6BCF\u5E74\u7BC0\u7701 120 \u5C0F\u6642\u2026",
    className: "w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-amber-400"
  })), /*#__PURE__*/React.createElement("div", {
    className: "flex justify-end space-x-3 pt-2"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    className: "px-4 py-2 text-sm text-slate-600 bg-slate-100 rounded-lg font-bold hover:bg-slate-200"
  }, "\u53D6\u6D88"), /*#__PURE__*/React.createElement("button", {
    onClick: submit,
    disabled: saving,
    className: "px-6 py-2 text-sm bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-bold rounded-lg shadow-md"
  }, saving ? '儲存中…' : '儲存'))) : /*#__PURE__*/React.createElement("div", {
    className: "space-y-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-sm text-slate-700 whitespace-pre-wrap bg-amber-50/70 border border-amber-200 rounded-lg p-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-bold text-amber-800 mb-1"
  }, "\uD83C\uDFAF \u5177\u9AD4\u7522\u51FA\u9805\u76EE"), proj.deliverable || /*#__PURE__*/React.createElement("span", {
    className: "text-slate-500 italic"
  }, "\uFF08\u8CA0\u8CAC\u4EBA\u5C1A\u672A\u586B\u5BEB\uFF09")), proj.mpSaving && /*#__PURE__*/React.createElement("div", {
    className: "text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg p-3 font-bold"
  }, "\uD83D\uDCA1 MP Saving\uFF1A", proj.mpSaving), /*#__PURE__*/React.createElement("div", {
    className: "flex justify-end pt-3"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    className: "px-6 py-2 text-sm bg-slate-600 hover:bg-slate-700 text-white font-bold rounded-lg"
  }, "\u95DC\u9589"))))));
}

// 下週預計執行工作:每人每週一筆(填寫於本週,內容為下一週的工作安排),樣式比照非專案事項但用靛藍色系
// weeksTotal:「下一週」的週次上限用該年度的實際週數(2026=53、2027=52),勿寫死 53
function WeeklyPlanModal({
  currentWeek,
  weeksTotal = WEEKS_TOTAL,
  initialNote,
  readOnly,
  future = false,
  targetUser,
  meta,
  onClose,
  onSave
}) {
  const focus = useModalFocus(); // 開啟時焦點移入、Tab 鎖在視窗內、關閉時還原
  const [note, setNote] = useState(initialNote);
  const [docUrl, setDocUrl] = useState(meta?.docUrl || ''); // 文件連結存在 meta 裡(同 ExtraNoteModal)
  const [error, setError] = useState('');
  const [docError, setDocError] = useState('');
  const [saving, setSaving] = useState(false);
  useModalDirtyReset();
  // 允許清空:清空後系統將其復原為「必填尚未填寫」(扣回打卡 1 分)，待重新填寫送出後再計分
  // ⚠ 只留文件連結不算「清空」(同 ExtraNoteModal)
  const isClearing = !note.trim() && !docUrl.trim() && !!initialNote;
  const submit = async () => {
    if (saving) return;
    const {
      doc,
      error: dErr
    } = validateDocInput(docUrl);
    if (dErr) {
      setDocError(dErr);
      return;
    }
    if (doc !== docUrl) setDocUrl(doc);
    setSaving(true);
    try {
      await onSave(note.trim(), doc);
    } finally {
      setSaving(false);
    }
  };
  if (readOnly) {
    return /*#__PURE__*/React.createElement("div", _extends({}, focus, {
      className: "fixed inset-0 bg-slate-900/60 backdrop-blur-sm modal-scrim z-[110] flex justify-center items-center p-4"
    }), /*#__PURE__*/React.createElement("div", {
      className: "bg-white rounded-2xl shadow-2xl modal-card w-full max-w-lg overflow-hidden",
      onClick: e => e.stopPropagation()
    }, /*#__PURE__*/React.createElement("div", {
      className: "px-6 py-4 text-white flex justify-between items-center",
      style: {
        backgroundColor: '#475569'
      }
    }, /*#__PURE__*/React.createElement("h3", {
      className: "font-bold text-lg",
      style: {
        color: '#FFFFFF'
      }
    }, "\uD83D\uDD12 W", currentWeek, " \u4E0B\u9031\u9810\u8A08\u5DE5\u4F5C\uFF08\u552F\u8B80\uFF09"), /*#__PURE__*/React.createElement(CloseButton, {
      onClick: onClose,
      className: "text-white/60 hover:text-white"
    })), /*#__PURE__*/React.createElement("div", {
      className: "p-6"
    }, /*#__PURE__*/React.createElement("p", {
      className: "text-xs text-slate-500 mb-3"
    }, future ? `W${currentWeek} 尚未到，不開放預先填寫。` : '歷史週次僅供瀏覽，無法修改。'), initialNote ? /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      className: "text-sm text-slate-700 bg-slate-100 border border-slate-300 rounded-lg p-4 whitespace-pre-wrap"
    }, initialNote), meta?.docUrl && /*#__PURE__*/React.createElement("div", {
      className: "mt-2"
    }, /*#__PURE__*/React.createElement(DocLink, {
      url: meta.docUrl
    })), /*#__PURE__*/React.createElement(MetaLine, {
      meta: meta
    })) : /*#__PURE__*/React.createElement("div", {
      className: "text-sm text-slate-500 italic text-center py-6"
    }, "\u8A72\u9031\u672A\u586B\u5BEB\u4E0B\u9031\u9810\u8A08\u5DE5\u4F5C"), /*#__PURE__*/React.createElement("div", {
      className: "flex justify-end pt-4"
    }, /*#__PURE__*/React.createElement("button", {
      onClick: onClose,
      className: "px-6 py-2 text-sm bg-slate-600 hover:bg-slate-700 text-white font-bold rounded-lg"
    }, "\u95DC\u9589")))));
  }
  return /*#__PURE__*/React.createElement("div", _extends({}, focus, {
    className: "fixed inset-0 bg-slate-900/60 backdrop-blur-sm modal-scrim z-[110] flex justify-center items-center p-4"
  }), /*#__PURE__*/React.createElement("div", {
    className: "bg-white rounded-2xl shadow-2xl modal-card w-full max-w-lg overflow-hidden",
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("div", {
    className: "px-6 py-4 text-white flex justify-between items-center",
    style: {
      backgroundColor: '#6366F1'
    }
  }, /*#__PURE__*/React.createElement("h3", {
    className: "font-bold text-lg flex items-center",
    style: {
      color: '#FFFFFF'
    }
  }, "\uD83D\uDCC5 \u586B\u5BEB W", currentWeek, " \u4E0B\u9031\u9810\u8A08\u57F7\u884C\u5DE5\u4F5C", targetUser ? `（${targetUser}）` : ''), /*#__PURE__*/React.createElement(CloseButton, {
    onClick: onClose,
    className: "text-white/60 hover:text-white"
  })), /*#__PURE__*/React.createElement("div", {
    className: "p-6"
  }, targetUser && /*#__PURE__*/React.createElement("div", {
    className: "mb-4 bg-amber-100 border border-amber-400 text-amber-900 rounded-lg px-3 py-2.5 text-xs font-bold flex items-center"
  }, /*#__PURE__*/React.createElement("span", {
    className: "mr-2 text-sm"
  }, "\uD83D\uDC51"), /*#__PURE__*/React.createElement("span", null, "\u4E3B\u7BA1\u4EE3\u4FEE\u6A21\u5F0F\uFF1A\u6B63\u5728\u7DE8\u8F2F ", targetUser, " \u7684\u5167\u5BB9\uFF0C\u7570\u52D5\u7D00\u9304\u5C07\u6A19\u8A18\u70BA\u4E3B\u7BA1\u4FEE\u6B63\u3002")), initialNote ? /*#__PURE__*/React.createElement("div", {
    className: "mb-4 bg-green-50 border border-green-300 text-green-800 rounded-lg px-3 py-2.5 text-sm font-bold"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center"
  }, /*#__PURE__*/React.createElement("span", {
    className: "mr-2"
  }, "\u2705"), " \u672C\u9031\u5DF2\u9001\u51FA\u904E\uFF0C\u53EF\u4FEE\u6539\u6216\u6E05\u7A7A\u5F8C\u91CD\u65B0\u586B\u5BEB\u3002"), /*#__PURE__*/React.createElement(MetaLine, {
    meta: meta,
    className: "text-[11px] text-green-700 font-medium mt-1"
  })) : /*#__PURE__*/React.createElement("div", {
    className: "mb-4 bg-yellow-50 border border-yellow-300 text-yellow-800 rounded-lg px-3 py-2.5 text-sm font-bold flex items-center"
  }, /*#__PURE__*/React.createElement("span", {
    className: "mr-2"
  }, "\uD83D\uDCED"), " \u672C\u9031\u5C1A\u672A\u586B\u5BEB\uFF08\u6709\u586B\u5BEB\u4E26\u9001\u51FA\u624D\u7B97\u5B8C\u6210\u6253\u5361\u5F97 1 \u5206\uFF09\u3002"), /*#__PURE__*/React.createElement("p", {
    className: "text-sm text-slate-500 mb-4 border-l-4 border-indigo-400 pl-3"
  }, "\u8ACB\u586B\u5BEB\u4E0B\u4E00\u9031\uFF08W", String(Math.min(currentWeek + 1, weeksTotal)).padStart(2, '0'), "\uFF09\u9810\u8A08\u9032\u884C\u7684\u5DE5\u4F5C\u5B89\u6392\uFF1B\u96A8\u6642\u53EF\u6E05\u7A7A\u5167\u5BB9\u5F8C\u9001\u51FA\uFF08\u6E05\u7A7A\u5F8C\u5C07\u6062\u5FA9\u70BA\u672A\u586B\u5BEB\uFF0C\u6709\u586B\u5BEB\u624D\u7B97\u6709\u6253\u5361\u5F97 1 \u5206\uFF09\u3002"), /*#__PURE__*/React.createElement("textarea", {
    value: note,
    onChange: e => {
      setNote(e.target.value);
      setError('');
      markModalDirty();
    },
    placeholder: "例如：\n1. OOO 專案進入測試階段，預計完成驗證報告\n2. 準備季度檢討資料…",
    className: `w-full border rounded-lg p-3 text-sm h-40 outline-none focus:ring-2 focus:ring-indigo-400 resize-none ${error ? 'border-red-400' : 'border-slate-300'}`
  }), error && /*#__PURE__*/React.createElement("div", {
    className: "text-xs text-red-600 font-bold mt-1"
  }, error), /*#__PURE__*/React.createElement("div", {
    className: "mt-3"
  }, /*#__PURE__*/React.createElement(DocUrlField, {
    id: "plan-doc-url",
    value: docUrl,
    onSubmit: submit,
    error: docError,
    onChange: v => {
      setDocUrl(v);
      setDocError('');
    }
  })), /*#__PURE__*/React.createElement("div", {
    className: "flex justify-end space-x-3 pt-4"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    className: "px-4 py-2 text-sm text-slate-600 bg-slate-100 rounded-lg font-bold hover:bg-slate-200"
  }, "\u53D6\u6D88"), /*#__PURE__*/React.createElement("button", {
    onClick: submit,
    disabled: saving,
    className: `px-6 py-2 text-sm text-white font-bold rounded-lg shadow-md disabled:opacity-50 ${isClearing ? 'bg-slate-500 hover:bg-slate-600' : 'bg-indigo-500 hover:bg-indigo-600'}`
  }, saving ? '儲存中…' : isClearing ? '清空重填' : '送出')))));
}

// 即將到期清單面板:列出剩餘 ≤2 週或已過 70% 時程的任務,依剩餘週數排序,點擊可定位並開啟任務視窗
function DeadlinePanel({
  items,
  onClose,
  onSelect
}) {
  const focus = useModalFocus(); // 開啟時焦點移入、Tab 鎖在視窗內、關閉時還原
  return /*#__PURE__*/React.createElement("div", _extends({}, focus, {
    className: "fixed inset-0 bg-slate-900/40 backdrop-blur-sm modal-scrim z-[105] flex justify-end"
  }), /*#__PURE__*/React.createElement("div", {
    className: "w-full max-w-sm bg-white h-full shadow-2xl flex flex-col",
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("div", {
    className: "px-5 py-4 text-white flex justify-between items-center",
    style: {
      backgroundColor: 'var(--hdr-deadline, #EA580C)'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h3", {
    className: "font-bold text-lg",
    style: {
      color: '#FFFFFF'
    }
  }, "\u23F0 \u5373\u5C07\u5230\u671F\u6E05\u55AE"), /*#__PURE__*/React.createElement("p", {
    className: "text-xs mt-0.5",
    style: {
      color: '#FFF7ED'
    }
  }, "\u5269\u9918 \u22642 \u9031\uFF0C\u6216\u5DF2\u8D70\u904E 70% \u6642\u7A0B\u4E14\u5269\u9918 \u2264", DEADLINE_RATIO_MAX_REMAIN, " \u9031\u7684\u8A08\u756B\u5340\u9593")), /*#__PURE__*/React.createElement(CloseButton, {
    onClick: onClose,
    className: "text-white/70 hover:text-white p-1"
  })), /*#__PURE__*/React.createElement("div", {
    className: "flex-1 overflow-y-auto p-4 space-y-2.5"
  }, items.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "text-center text-slate-500 py-16"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-4xl mb-3"
  }, "\uD83C\uDF89"), /*#__PURE__*/React.createElement("div", {
    className: "font-bold text-slate-600"
  }, "\u76EE\u524D\u6C92\u6709\u5373\u5C07\u5230\u671F\u7684\u4EFB\u52D9")) : items.map(({
    proj,
    task,
    remain,
    elapsed
  }) => /*#__PURE__*/React.createElement("button", {
    key: task.id,
    onClick: () => onSelect({
      proj,
      task
    }),
    className: "w-full text-left bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded-xl p-3 transition group"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between"
  }, /*#__PURE__*/React.createElement("div", {
    className: "min-w-0 pr-2"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-bold text-slate-700 break-words leading-snug"
  }, proj.name), /*#__PURE__*/React.createElement("div", {
    className: "text-sm text-slate-600 mt-0.5 truncate"
  }, task.name), /*#__PURE__*/React.createElement("div", {
    className: "text-[10px] text-slate-500 mt-1"
  }, "\uD83D\uDC64 ", proj.owner, " \xB7 \u6392\u7A0B W", task.start, "\u2013W", task.end)), /*#__PURE__*/React.createElement("div", {
    className: "flex-shrink-0 text-right"
  }, /*#__PURE__*/React.createElement("div", {
    className: `font-bold text-sm ${remain <= 1 ? 'text-red-600' : 'text-orange-600'}`
  }, "\u5269 ", remain, " \u9031"), /*#__PURE__*/React.createElement("div", {
    className: "text-[10px] text-slate-500 mt-0.5"
  }, "\u5DF2\u904E ", elapsed, "%"))), /*#__PURE__*/React.createElement("div", {
    className: "mt-2 h-1.5 bg-white rounded-full overflow-hidden border border-orange-200"
  }, /*#__PURE__*/React.createElement("div", {
    className: `h-full rounded-full ${remain <= 1 ? 'bg-red-500' : 'bg-orange-400'}`,
    style: {
      width: `${Math.min(elapsed, 100)}%`
    }
  })))))));
}
function PendingPanel({
  pending = [],
  completed = [],
  currentWeek,
  weeksTotal = WEEKS_TOTAL,
  scheduleYear = DEFAULT_SCHEDULE_YEAR,
  planPending = false,
  extraFilled = false,
  retro = false,
  planMeta,
  extraMeta,
  onFillPlan,
  onFillExtra,
  onClose,
  onSelect
}) {
  const focus = useModalFocus(); // 開啟時焦點移入、Tab 鎖在視窗內、關閉時還原
  const totalRequired = pending.length + completed.length + 1; // 任務總數 + 1項下週預計
  const completedCount = completed.length + (planPending ? 0 : 1);
  const percent = totalRequired > 0 ? Math.round(completedCount / totalRequired * 100) : 100;
  const allDone = pending.length === 0 && !planPending;
  const wkLabel = retro ? `W${String(currentWeek).padStart(2, '0')}` : '本週'; // 補登模式所有文案以週次取代「本週」

  return /*#__PURE__*/React.createElement("div", _extends({}, focus, {
    className: "fixed inset-0 bg-slate-900/40 backdrop-blur-sm modal-scrim z-[105] flex justify-end"
  }), /*#__PURE__*/React.createElement("div", {
    className: "w-full max-w-md bg-white h-full shadow-2xl flex flex-col",
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("div", {
    className: "px-5 py-4 text-white flex flex-col space-y-3",
    style: {
      backgroundColor: retro ? '#92400E' : '#001F5B'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex justify-between items-center"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h3", {
    className: "font-bold text-lg flex items-center gap-2"
  }, /*#__PURE__*/React.createElement("span", null, retro ? `🕘 W${String(currentWeek).padStart(2, '0')} 歷史回報補登` : `📋 W${String(currentWeek).padStart(2, '0')} 本週回報中心`)), /*#__PURE__*/React.createElement("p", {
    className: `text-xs mt-0.5 ${retro ? 'text-amber-200' : 'text-blue-200'}`
  }, weekRangeLabel(scheduleYear, currentWeek), "\u30FB", retro ? '主管已開放補登：可修改此週任務打卡、非專案事項與下週預計工作' : '整合本週排定任務打卡 ＋ 每週必填工作預計')), /*#__PURE__*/React.createElement(CloseButton, {
    onClick: onClose,
    className: "text-white/60 hover:text-white p-1"
  })), /*#__PURE__*/React.createElement("div", {
    className: "bg-white/10 rounded-xl p-3 border border-white/20"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex justify-between items-center text-xs font-bold mb-1.5"
  }, /*#__PURE__*/React.createElement("span", null, wkLabel, "\u56DE\u5831\u5B8C\u6210\u5EA6"), /*#__PURE__*/React.createElement("span", {
    className: "text-amber-300"
  }, completedCount, " / ", totalRequired, " \u9805 (", percent, "%)")), /*#__PURE__*/React.createElement("div", {
    className: "w-full h-2 bg-white/20 rounded-full overflow-hidden"
  }, /*#__PURE__*/React.createElement("div", {
    className: `h-full rounded-full transition-all duration-500 ${allDone ? 'bg-emerald-400' : 'bg-amber-400'}`,
    style: {
      width: `${percent}%`
    }
  })))), /*#__PURE__*/React.createElement("div", {
    className: "flex-1 overflow-y-auto p-5 space-y-5"
  }, retro && /*#__PURE__*/React.createElement("div", {
    className: "bg-amber-50 border border-amber-400 text-amber-900 rounded-xl px-3.5 py-2.5 text-xs font-bold flex items-center"
  }, /*#__PURE__*/React.createElement("span", {
    className: "mr-2 text-sm"
  }, "\u26A0\uFE0F"), /*#__PURE__*/React.createElement("span", null, "\u88DC\u767B\u6A21\u5F0F\uFF1A\u6B63\u5728\u4FEE\u6539 W", String(currentWeek).padStart(2, '0'), " \u7684\u6B77\u53F2\u56DE\u5831\uFF0C\u7570\u52D5\u6703\u7559\u4E0B\u7A3D\u6838\u7D00\u9304\u3002")), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-black text-slate-500 uppercase tracking-wider mb-2"
  }, "\uD83D\uDD35 ", wkLabel, "\u5F85\u6253\u5361\u4EFB\u52D9 (", pending.length, " \u9805)"), pending.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center text-emerald-800 font-bold text-xs"
  }, "\uD83C\uDF89 \u592A\u68D2\u4E86\uFF01", wkLabel, "\u6392\u5B9A\u4E4B\u5C08\u6848\u4EFB\u52D9\u5DF2\u5168\u6578\u5B8C\u6210\u6253\u5361") : /*#__PURE__*/React.createElement("div", {
    className: "space-y-2.5"
  }, pending.map(({
    proj,
    task,
    sub
  }) => /*#__PURE__*/React.createElement("button", {
    key: `${task.id}-${sub?.id ?? ''}`,
    onClick: () => onSelect({
      proj,
      task,
      sub
    }),
    className: "w-full text-left bg-yellow-50 hover:bg-yellow-100 border border-yellow-300 rounded-xl p-3.5 transition group shadow-sm"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between"
  }, /*#__PURE__*/React.createElement("div", {
    className: "min-w-0 pr-2"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-bold text-amber-900 dark:text-amber-200 break-words leading-snug"
  }, proj.name), /*#__PURE__*/React.createElement("div", {
    className: "text-sm font-black text-slate-800 mt-0.5 truncate"
  }, sub ? sub.name : task.name), /*#__PURE__*/React.createElement("div", {
    className: "text-[10px] text-slate-500 mt-1"
  }, sub ? `${task.name} › 子區間 W${sub.start}–W${sub.end}` : `排程 W${task.start}–W${task.end}`, " \xB7 ", proj.category)), /*#__PURE__*/React.createElement("div", {
    className: "flex-shrink-0 text-blue-600 font-bold text-xs bg-white border border-blue-300 rounded-full px-3 py-1.5 group-hover:bg-blue-600 group-hover:text-white transition shadow-sm"
  }, "\u6253\u5361\u56DE\u5831 \u203A")))))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-black text-slate-500 uppercase tracking-wider mb-2"
  }, "\uD83D\uDCC5 \u4E0B\u9031\u9810\u8A08\u57F7\u884C\u5DE5\u4F5C\uFF08\u5FC5\u586B\uFF09"), /*#__PURE__*/React.createElement("button", {
    onClick: onFillPlan,
    className: `w-full text-left border rounded-xl p-3.5 transition group border-l-4 ${planPending ? 'bg-pink-50 hover:bg-pink-100 border-pink-200 border-l-red-500 shadow-sm' : 'bg-emerald-50/70 hover:bg-emerald-100/70 border-emerald-200 border-l-emerald-500'}`
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between"
  }, /*#__PURE__*/React.createElement("div", {
    className: "min-w-0 pr-2"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-xs font-bold text-slate-800"
  }, "\u4E0B\u9031\u9810\u8A08\u57F7\u884C\u5DE5\u4F5C"), planPending ? /*#__PURE__*/React.createElement("span", {
    className: "bg-red-600 text-white text-[10px] px-1.5 py-0.5 rounded font-bold"
  }, "\u5FC5\u586B\u5C1A\u672A\u586B\u5BEB") : /*#__PURE__*/React.createElement("span", {
    className: "bg-emerald-600 text-white text-[10px] px-1.5 py-0.5 rounded font-bold"
  }, "\u2713 \u5DF2\u586B\u5BEB\u5B8C\u6210")), /*#__PURE__*/React.createElement("div", {
    className: "text-xs text-slate-500 mt-1"
  }, "\u8ACB\u5B89\u6392 W", String(Math.min(currentWeek + 1, weeksTotal)).padStart(2, '0'), " \u9031\u9810\u8A08\u9032\u884C\u7684\u5DE5\u4F5C\u5167\u5BB9"), !planPending && /*#__PURE__*/React.createElement(MetaLine, {
    meta: planMeta,
    className: "text-[10px] text-slate-500 mt-0.5"
  })), /*#__PURE__*/React.createElement("div", {
    className: `flex-shrink-0 font-bold text-xs bg-white border rounded-full px-3 py-1.5 transition ${planPending ? 'text-red-600 border-red-300 group-hover:bg-red-600 group-hover:text-white' : 'text-emerald-600 border-emerald-300 group-hover:bg-emerald-600 group-hover:text-white'}`
  }, planPending ? '立即填寫 ›' : '檢閱修改 ›')))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-black text-slate-500 uppercase tracking-wider mb-2"
  }, "\uD83D\uDCDD \u975E\u5C08\u6848\u4E8B\u9805\uFF08\u9078\u586B\uFF09"), /*#__PURE__*/React.createElement("button", {
    onClick: onFillExtra,
    className: `w-full text-left border rounded-xl p-3.5 transition group border-l-4 ${extraFilled ? 'bg-emerald-50/70 hover:bg-emerald-100/70 border-emerald-200 border-l-emerald-500' : 'bg-orange-50 hover:bg-orange-100 border-orange-200 border-l-orange-400'}`
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between"
  }, /*#__PURE__*/React.createElement("div", {
    className: "min-w-0 pr-2"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-xs font-bold text-slate-800"
  }, "\u975E\u5C08\u6848\u4E8B\u9805"), extraFilled ? /*#__PURE__*/React.createElement("span", {
    className: "bg-emerald-600 text-white text-[10px] px-1.5 py-0.5 rounded font-bold"
  }, "\u2713 \u5DF2\u586B\u5BEB\u5B8C\u6210") : /*#__PURE__*/React.createElement("span", {
    className: "bg-slate-400 text-white text-[10px] px-1.5 py-0.5 rounded font-bold"
  }, "\u9078\u586B \xB7 \u672A\u586B\u5BEB")), /*#__PURE__*/React.createElement("div", {
    className: "text-xs text-slate-500 mt-1"
  }, "\u65E5\u5E38\u7DAD\u904B\u3001\u81E8\u6642\u4EA4\u8FA6\u3001\u6703\u8B70\u7B49\u5C08\u6848\u5916\u9805\u76EE\uFF08\u9078\u586B\uFF0C\u4E0D\u8A08\u5165\u5B8C\u6210\u5EA6\uFF09"), extraFilled && /*#__PURE__*/React.createElement(MetaLine, {
    meta: extraMeta,
    className: "text-[10px] text-slate-500 mt-0.5"
  })), /*#__PURE__*/React.createElement("div", {
    className: `flex-shrink-0 font-bold text-xs bg-white border rounded-full px-3 py-1.5 transition ${extraFilled ? 'text-emerald-600 border-emerald-300 group-hover:bg-emerald-600 group-hover:text-white' : 'text-orange-600 border-orange-300 group-hover:bg-orange-600 group-hover:text-white'}`
  }, extraFilled ? '檢閱修改 ›' : '前往填寫 ›')))), completed.length > 0 && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-black text-slate-500 uppercase tracking-wider mb-2"
  }, "\uD83D\uDFE2 ", wkLabel, "\u5DF2\u5B8C\u6210\u6253\u5361\u4EFB\u52D9 (", completed.length, " \u9805)"), /*#__PURE__*/React.createElement("div", {
    className: "space-y-2"
  }, completed.map(({
    proj,
    task,
    sub,
    log
  }) => /*#__PURE__*/React.createElement("button", {
    key: `${task.id}-${sub?.id ?? ''}`,
    onClick: () => onSelect({
      proj,
      task,
      sub
    }),
    className: "w-full text-left bg-slate-100 hover:bg-slate-100 border border-slate-300 rounded-xl p-3 transition group opacity-90"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between"
  }, /*#__PURE__*/React.createElement("div", {
    className: "min-w-0 pr-2"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-bold text-slate-600 break-words leading-snug"
  }, proj.name), /*#__PURE__*/React.createElement("div", {
    className: "flex flex-wrap items-center gap-1.5 mt-1"
  }, /*#__PURE__*/React.createElement("span", {
    className: `px-1.5 py-0.5 rounded text-[10px] font-bold ${log.status === 'executed' ? 'bg-green-100 text-green-800' : log.status === 'monitor' ? 'bg-sky-100 text-sky-800' : 'bg-slate-200 text-slate-700'}`
  }, STATUS_META[log.status]?.icon, " ", STATUS_META[log.status]?.label)), /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-medium text-slate-700 mt-1 truncate"
  }, unitLabel(task, sub)), log.updatedAt && /*#__PURE__*/React.createElement("div", {
    className: "text-[10px] text-slate-500 mt-0.5"
  }, "\uD83D\uDD58 \u6700\u5F8C\u7DE8\u8F2F ", log.updatedAt, log.reporterRole === 'manager' ? '・✏️ 主管修正' : '')), /*#__PURE__*/React.createElement("div", {
    className: "flex-shrink-0 text-slate-500 font-bold text-xs bg-white border border-slate-300 rounded-full px-2.5 py-1 group-hover:border-slate-400 transition"
  }, "\u4FEE\u6539 \u203A"))))))), /*#__PURE__*/React.createElement("div", {
    className: "p-4 bg-slate-100 border-t border-slate-300"
  }, allDone ? /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    className: "w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm rounded-xl shadow-md transition flex items-center justify-center gap-2"
  }, /*#__PURE__*/React.createElement("span", null, "\uD83C\uDF89 ", wkLabel, "\u56DE\u5831\u5DF2\u5168\u6578\u5B8C\u6210\uFF01\u8FD4\u56DE\u7E3D\u8868 \u203A")) : /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    className: "w-full py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs rounded-xl transition"
  }, "\u66AB\u5B58\u96E2\u958B\uFF08\u5C1A\u6709 ", pending.length + (planPending ? 1 : 0), " \u9805\u5F85\u5B8C\u6210\u9805\u76EE\uFF09"))));
}

// 主管:週次回報編輯面板 — 選成員後可代為補登/修正該週任務打卡、非專案事項、下週預計工作,
// 並可編輯主管回覆;所有代修異動由 SP 記錄操作者(ReportedBy/UpdatedBy=主管)並留稽核紀錄
// historical:檢視中週次不是「本週」(含非本年度)→ 標「歷史週次」晶片
function ManagerWeekPanel({
  week,
  historical = false,
  users = [],
  projects,
  taskLogs,
  subLogs = {},
  extraNotes,
  weeklyPlans,
  weeklyComments,
  extraNoteMeta = {},
  weeklyPlanMeta = {},
  weeklyCommentMeta = {},
  onClose,
  onSelectTask,
  onEditExtra,
  onEditPlan,
  onEditComment
}) {
  const focus = useModalFocus(); // 開啟時焦點移入、Tab 鎖在視窗內、關閉時還原
  const [member, setMember] = useState(users[0] || '');
  const wk = String(week).padStart(2, '0');

  // 一列＝一個回報單位(遷移 20:該週有進行中的子區間就逐子區間列)
  const rows = [];
  projects.filter(p => p.owner === member).forEach(p => p.tasks.forEach(t => {
    if (t.start <= week && t.end >= week) weekUnits(t, week, taskLogs, subLogs).units.forEach(({
      sub,
      log
    }) => rows.push({
      proj: p,
      task: t,
      sub,
      log
    }));
  }));
  const extra = extraNotes[member]?.[week] || '';
  const plan = weeklyPlans[member]?.[week] || '';
  const comment = weeklyComments[member]?.[week] || '';
  const extraMeta = extraNoteMeta[member]?.[week];
  const planMeta = weeklyPlanMeta[member]?.[week];
  const commentMeta = weeklyCommentMeta[member]?.[week];

  // 三張可編輯卡片共用的列版型(meta=最後編輯資訊;主管回覆傳 showManagerTag=false)
  const editRow = (icon, label, value, emptyText, colorCls, onEdit, meta, showManagerTag = true) => /*#__PURE__*/React.createElement("button", {
    onClick: onEdit,
    className: `w-full text-left border rounded-xl p-3.5 transition group shadow-sm ${colorCls}`
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between"
  }, /*#__PURE__*/React.createElement("div", {
    className: "min-w-0 pr-2"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-bold text-slate-800"
  }, icon, " ", label), value ? /*#__PURE__*/React.createElement("div", {
    className: "text-xs text-slate-600 mt-1 whitespace-pre-wrap",
    style: {
      display: '-webkit-box',
      WebkitLineClamp: 2,
      WebkitBoxOrient: 'vertical',
      overflow: 'hidden'
    }
  }, value) : /*#__PURE__*/React.createElement("div", {
    className: "text-xs text-slate-500 italic mt-1"
  }, emptyText), meta?.docUrl && /*#__PURE__*/React.createElement("span", {
    className: "inline-flex items-center gap-1 mt-1 px-2 py-1 rounded border border-blue-300 bg-blue-50 text-blue-800 text-[10px] font-bold",
    title: `已附文件連結：${meta.docUrl}（點「編輯」進去即可開啟）`
  }, /*#__PURE__*/React.createElement(DocIcon, null), "\u5DF2\u9644\u6587\u4EF6"), (value || meta?.docUrl) && /*#__PURE__*/React.createElement(MetaLine, {
    meta: meta,
    showManagerTag: showManagerTag,
    className: "text-[10px] text-slate-500 mt-0.5"
  })), /*#__PURE__*/React.createElement("div", {
    className: "flex-shrink-0 text-slate-600 font-bold text-xs bg-white border border-slate-300 rounded-full px-3 py-1.5 group-hover:bg-slate-700 group-hover:text-white transition"
  }, "\u7DE8\u8F2F \u203A")));
  return /*#__PURE__*/React.createElement("div", _extends({}, focus, {
    className: "fixed inset-0 bg-slate-900/40 backdrop-blur-sm modal-scrim z-[105] flex justify-end"
  }), /*#__PURE__*/React.createElement("div", {
    className: "w-full max-w-md bg-white h-full shadow-2xl flex flex-col",
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("div", {
    className: "px-5 py-4 text-white flex flex-col space-y-3",
    style: {
      backgroundColor: '#92400E'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex justify-between items-center"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h3", {
    className: "font-bold text-lg"
  }, "\uD83D\uDEE0 W", wk, " \u56DE\u5831\u7DE8\u8F2F\uFF08\u4E3B\u7BA1\uFF09"), /*#__PURE__*/React.createElement("p", {
    className: "text-xs text-amber-200 mt-0.5"
  }, "\u4EE3\u6210\u54E1\u88DC\u767B/\u4FEE\u6B63\u6B64\u9031\u56DE\u5831\uFF0C\u7570\u52D5\u6703\u6A19\u8A18\u4E3B\u7BA1\u4FEE\u6B63\u4E26\u7559\u4E0B\u7A3D\u6838\u7D00\u9304")), /*#__PURE__*/React.createElement(CloseButton, {
    onClick: onClose,
    className: "text-white/60 hover:text-white p-1"
  })), /*#__PURE__*/React.createElement("div", {
    className: "bg-white/10 rounded-xl p-3 border border-white/20 flex items-center gap-2"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-xs font-bold whitespace-nowrap"
  }, "\u7DE8\u8F2F\u6210\u54E1"), /*#__PURE__*/React.createElement("select", {
    value: member,
    onChange: e => setMember(e.target.value),
    className: "flex-1 border border-white/30 bg-white text-slate-800 rounded-lg px-2 py-1.5 text-sm font-bold outline-none"
  }, users.map(u => /*#__PURE__*/React.createElement("option", {
    key: u,
    value: u
  }, u))), historical && /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] font-bold bg-amber-300 text-amber-950 px-2 py-1 rounded-full whitespace-nowrap"
  }, "\u6B77\u53F2\u9031\u6B21"))), /*#__PURE__*/React.createElement("div", {
    className: "flex-1 overflow-y-auto p-5 space-y-5"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-black text-slate-500 uppercase tracking-wider mb-2"
  }, "\uD83D\uDCCC W", wk, " \u6392\u5B9A\u4EFB\u52D9\u6253\u5361 (", rows.length, " \u9805)"), rows.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "bg-slate-100 border border-slate-300 rounded-xl p-4 text-center text-slate-500 text-xs italic"
  }, "\u6B64\u9031\u7121\u6392\u5B9A\u4EFB\u52D9") : /*#__PURE__*/React.createElement("div", {
    className: "space-y-2.5"
  }, rows.map(({
    proj,
    task,
    sub,
    log
  }) => /*#__PURE__*/React.createElement("button", {
    key: `${task.id}-${sub?.id ?? ''}`,
    onClick: () => onSelectTask(proj, task, sub),
    className: `w-full text-left border rounded-xl p-3 transition group shadow-sm ${log ? 'bg-slate-100 hover:bg-slate-100 border-slate-300' : 'bg-yellow-50 hover:bg-yellow-100 border-yellow-300'}`
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between"
  }, /*#__PURE__*/React.createElement("div", {
    className: "min-w-0 pr-2"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-bold text-slate-700 break-words leading-snug"
  }, proj.name), /*#__PURE__*/React.createElement("div", {
    className: "flex flex-wrap items-center gap-1.5 mt-1"
  }, log ? /*#__PURE__*/React.createElement("span", {
    className: `flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold ${log.status === 'executed' ? 'bg-green-100 text-green-800' : log.status === 'monitor' ? 'bg-sky-100 text-sky-800' : 'bg-slate-200 text-slate-700'}`
  }, STATUS_META[log.status]?.icon, " ", STATUS_META[log.status]?.label) : /*#__PURE__*/React.createElement("span", {
    className: "flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700 border border-red-300"
  }, "\u2757\u672A\u56DE\u5831"), log?.reporterRole === 'manager' && /*#__PURE__*/React.createElement("span", {
    className: "flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300",
    title: "\u6B64\u7B46\u7531\u4E3B\u7BA1\u4EE3\u70BA\u4FEE\u6B63/\u88DC\u767B"
  }, "\u270F\uFE0F\u4E3B\u7BA1")), /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-medium text-slate-700 mt-1 truncate"
  }, unitLabel(task, sub)), log?.updatedAt && /*#__PURE__*/React.createElement("div", {
    className: "text-[10px] text-slate-500 mt-0.5"
  }, "\uD83D\uDD58 \u6700\u5F8C\u7DE8\u8F2F ", log.updatedAt, log.reporter ? `（${log.reporter}）` : '')), /*#__PURE__*/React.createElement("div", {
    className: "flex-shrink-0 text-slate-600 font-bold text-xs bg-white border border-slate-300 rounded-full px-2.5 py-1 group-hover:bg-slate-700 group-hover:text-white transition"
  }, log ? '修改 ›' : '補登 ›')))))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-black text-slate-500 uppercase tracking-wider mb-2"
  }, "\uD83D\uDCDD \u6BCF\u9031\u56DE\u5831\u5167\u5BB9\uFF08\u4EE3 ", member, " \u4FEE\u6B63\uFF09"), /*#__PURE__*/React.createElement("div", {
    className: "space-y-2.5"
  }, editRow('📝', '非專案事項', extra, '未填寫（可代為補登）', 'bg-orange-50/70 hover:bg-orange-100/70 border-orange-200', () => onEditExtra(member), extraMeta), editRow('📅', '下週預計執行工作', plan, '未填寫（可代為補登）', 'bg-indigo-50/70 hover:bg-indigo-100/70 border-indigo-200', () => onEditPlan(member), planMeta))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-black text-slate-500 uppercase tracking-wider mb-2"
  }, "\uD83D\uDC51 \u4E3B\u7BA1\u56DE\u8986\uFF08\u6210\u54E1\u4E0D\u53EF\u7570\u52D5\uFF09"), editRow('💬', `對 ${member} 的 W${wk} 週報回覆`, comment, '尚未回覆（選填）', 'bg-violet-50/70 hover:bg-violet-100/70 border-violet-200', () => onEditComment(member), commentMeta, false))), /*#__PURE__*/React.createElement("div", {
    className: "p-4 bg-slate-100 border-t border-slate-300"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    className: "w-full py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs rounded-xl transition"
  }, "\u95DC\u9589\u9762\u677F"))));
}

// 主管週報回覆:針對單一成員×週的建議(選填,可清空);儲存後顯示於團隊總結看板,全員可見
function CommentModal({
  member,
  currentWeek,
  initialComment,
  meta,
  onClose,
  onSave
}) {
  const focus = useModalFocus(); // 開啟時焦點移入、Tab 鎖在視窗內、關閉時還原
  const [text, setText] = useState(initialComment);
  const [saving, setSaving] = useState(false);
  useModalDirtyReset();
  const isClearing = !text.trim() && !!initialComment;
  const submit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onSave(text.trim());
    } finally {
      setSaving(false);
    }
  };
  return /*#__PURE__*/React.createElement("div", _extends({}, focus, {
    className: "fixed inset-0 bg-slate-900/60 backdrop-blur-sm modal-scrim z-[140] flex justify-center items-center p-4"
  }), /*#__PURE__*/React.createElement("div", {
    className: "bg-white rounded-2xl shadow-2xl modal-card w-full max-w-lg overflow-hidden",
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("div", {
    className: "px-6 py-4 text-white flex justify-between items-center",
    style: {
      backgroundColor: '#7C3AED'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h3", {
    className: "font-bold text-lg",
    style: {
      color: '#FFFFFF'
    }
  }, "\uD83D\uDCAC \u56DE\u8986 ", member, " \u7684 W", String(currentWeek).padStart(2, '0'), " \u9031\u5831"), /*#__PURE__*/React.createElement("p", {
    className: "text-xs mt-0.5",
    style: {
      color: '#EDE9FE'
    }
  }, "\u4E3B\u7BA1\u5EFA\u8B70(\u9078\u586B)\uFF0C\u5132\u5B58\u5F8C\u5168\u9AD4\u6210\u54E1\u65BC\u5718\u968A\u7E3D\u7D50\u770B\u677F\u53EF\u898B")), /*#__PURE__*/React.createElement(CloseButton, {
    onClick: onClose,
    className: "text-white/60 hover:text-white"
  })), /*#__PURE__*/React.createElement("div", {
    className: "p-6"
  }, initialComment ? /*#__PURE__*/React.createElement("div", {
    className: "mb-4 bg-violet-50 border border-violet-300 text-violet-800 rounded-lg px-3 py-2.5 text-sm font-bold"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center"
  }, /*#__PURE__*/React.createElement("span", {
    className: "mr-2"
  }, "\u2705"), " \u672C\u9031\u5DF2\u56DE\u8986\u904E\uFF0C\u4EE5\u4E0B\u70BA\u5DF2\u5132\u5B58\u7684\u5167\u5BB9\uFF0C\u53EF\u4FEE\u6539\u5F8C\u91CD\u65B0\u9001\u51FA\u3002"), /*#__PURE__*/React.createElement(MetaLine, {
    meta: meta,
    showManagerTag: false,
    className: "text-[11px] text-violet-700 font-medium mt-1"
  })) : /*#__PURE__*/React.createElement("div", {
    className: "mb-4 bg-slate-100 border border-slate-300 text-slate-600 rounded-lg px-3 py-2.5 text-sm font-bold flex items-center"
  }, /*#__PURE__*/React.createElement("span", {
    className: "mr-2"
  }, "\uD83D\uDCED"), " \u672C\u9031\u5C1A\u672A\u56DE\u8986\u6B64\u6210\u54E1\u3002"), /*#__PURE__*/React.createElement("p", {
    className: "text-sm text-slate-500 mb-4 border-l-4 border-violet-400 pl-3"
  }, "\u91DD\u5C0D ", member, " \u672C\u9031\u7684\u56DE\u5831\u7D50\u679C\u7D66\u4E88\u56DE\u994B\u6216\u5EFA\u8B70\uFF08\u5DE5\u4F5C\u65B9\u5411\u3001\u512A\u5148\u9806\u5E8F\u3001\u63D0\u9192\u4E8B\u9805\u7B49\uFF09\u3002", /*#__PURE__*/React.createElement("span", {
    className: "block mt-1 text-slate-500"
  }, "\u6B64\u6B04\u70BA\u9078\u586B\uFF0C\u96A8\u6642\u53EF\u6E05\u7A7A\u5167\u5BB9\u5F8C\u5132\u5B58\u3002")), /*#__PURE__*/React.createElement("textarea", {
    value: text,
    onChange: e => {
      setText(e.target.value);
      markModalDirty();
    },
    autoFocus: true,
    placeholder: "例如：\n1. FDC 案進度良好，下週優先處理驗證報告\n2. 非專案事項佔比偏高，需要時提出來討論…",
    className: "w-full border border-slate-300 rounded-lg p-3 text-sm h-36 outline-none focus:ring-2 focus:ring-violet-400 resize-none"
  }), /*#__PURE__*/React.createElement("div", {
    className: "flex justify-end space-x-3 pt-4"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    className: "px-4 py-2 text-sm text-slate-600 bg-slate-100 rounded-lg font-bold hover:bg-slate-200"
  }, "\u53D6\u6D88"), /*#__PURE__*/React.createElement("button", {
    onClick: submit,
    disabled: saving,
    className: `px-6 py-2 text-sm text-white font-bold rounded-lg shadow-md disabled:opacity-50 ${isClearing ? 'bg-slate-500 hover:bg-slate-600' : 'bg-violet-600 hover:bg-violet-700'}`
  }, saving ? '儲存中…' : isClearing ? '清空回覆' : '送出回覆')))));
}

// 最後編輯資訊列(meta={by,byRole,at});showManagerTag=false 用於主管回覆(編輯者必為主管,標記為冗餘)
function MetaLine({
  meta,
  showManagerTag = true,
  className = 'text-[10px] text-slate-500 mt-1'
}) {
  if (!meta || !meta.at) return null;
  return /*#__PURE__*/React.createElement("div", {
    className: className
  }, "\uD83D\uDD58 \u6700\u5F8C\u7DE8\u8F2F ", meta.at, meta.by ? `（${meta.by}）` : '', showManagerTag && meta.byRole === 'manager' && /*#__PURE__*/React.createElement("span", {
    className: "ml-1 px-1 py-px rounded bg-amber-100 text-amber-800 border border-amber-300 font-bold",
    title: "\u6B64\u7B46\u7531\u4E3B\u7BA1\u4EE3\u70BA\u4FEE\u6B63/\u88DC\u767B"
  }, "\u270F\uFE0F \u4E3B\u7BA1\u4FEE\u6B63"));
}
function WeeklyReportDashboard({
  currentWeek,
  year,
  users,
  projects,
  taskLogs,
  subLogs = {},
  extraNotes,
  weeklyPlans = {},
  weeklyComments = {},
  extraNoteMeta = {},
  weeklyPlanMeta = {},
  weeklyCommentMeta = {},
  currentUser,
  role,
  panelWidth = 672,
  todayWeek = currentWeek,
  isFutureWeek = currentWeek > todayWeek,
  highlightedTaskId,
  highlightedSubId = null,
  onHighlightTask,
  onEditComment,
  onClose
}) {
  const isManager = role === 'manager';
  // isFutureWeek 由 App 判斷(含「未來年度」):未來週全員本來就「未回報」,催報名單沒有意義(主管回覆入口由父層以 onEditComment=undefined 收掉)
  // 看板變窄(投影機/筆電)時卡片內容改單欄:md: 斷點看的是「視窗寬」不是「面板寬」,不改會在窄面板裡擠成兩欄
  const narrowPanel = panelWidth < 560;
  // 更窄(≈1024 螢幕→面板 358)時成員列連晶片文字也放不下(實測溢出 26px),只留圖示＋title
  const tightRow = panelWidth < 440;
  const [copied, setCopied] = useState(false); // 全團隊複製回饋
  const [copiedUser, setCopiedUser] = useState(null); // 個別成員複製回饋
  const [copiedPending, setCopiedPending] = useState(false); // 催報名單複製回饋
  // 成員預設勾選「只看我的週報」；主管不寫週報，固定看全團隊
  const [onlyMine, setOnlyMine] = useState(!isManager);
  // 展開狀態：勾選自己時預設展開；看團隊時預設折疊
  const [expandedUsers, setExpandedUsers] = useState(new Set(!isManager ? [currentUser] : []));

  // 下載後端產生的 Excel 週報(.xlsx:專案執行 + 非專案事項 兩個工作表)
  // 改用 fetch→blob:按鈕可顯示「產生中…」並防重複點擊,失敗時給明確回饋(原 <a download> 無從得知進度)
  const [exporting, setExporting] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);
  const exportExcel = async () => {
    if (exporting) return;
    setExporting(true);
    setExportFailed(false);
    try {
      const res = await fetch(`${API_BASE}/api/weekly-report-excel?year=${year}&week=${currentWeek}`);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `WeeklyReport_${year}_W${String(currentWeek).padStart(2, '0')}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportFailed(true);
      setTimeout(() => setExportFailed(false), 5000);
    } finally {
      setExporting(false);
    }
  };

  // activeTasks／pendingTasks 的元素＝「回報單位」{proj, task, sub, log}(遷移 20:該週有進行中的子區間就逐子區間一筆,sub=null＝計畫區間本身)。
  // 回報數 x/total 以單位計;得分則以計畫區間計(區間分數＝子區間平均,滿分＝taskTotal)——切得細不會膨脹分數。
  const summary = useMemo(() => users.map(user => {
    const activeTasks = [],
      pendingTasks = [];
    let taskTotal = 0,
      scoreSum = 0;
    projects.filter(p => p.owner === user).forEach(p => p.tasks.forEach(t => {
      if (t.start <= currentWeek && t.end >= currentWeek) {
        const wu = weekUnits(t, currentWeek, taskLogs, subLogs);
        taskTotal++;
        scoreSum += wu.score;
        wu.units.forEach(({
          sub,
          log
        }) => {
          if (log) activeTasks.push({
            proj: p,
            task: t,
            sub,
            log,
            legacy: wu.legacy
          });else pendingTasks.push({
            proj: p,
            task: t,
            sub
          });
        });
      }
    }));
    const weekScore = Math.round(scoreSum * 10) / 10;
    return {
      user,
      activeTasks,
      pendingTasks,
      extraNote: extraNotes[user]?.[currentWeek],
      weekPlan: weeklyPlans[user]?.[currentWeek],
      comment: weeklyComments[user]?.[currentWeek],
      // 主管週報回覆(全員可見)
      extraMeta: extraNoteMeta[user]?.[currentWeek],
      planMeta: weeklyPlanMeta[user]?.[currentWeek],
      commentMeta: weeklyCommentMeta[user]?.[currentWeek],
      total: activeTasks.length + pendingTasks.length,
      taskTotal,
      weekScore
    };
  }), [users, projects, taskLogs, subLogs, extraNotes, weeklyPlans, weeklyComments, extraNoteMeta, weeklyPlanMeta, weeklyCommentMeta, currentWeek]);

  // 依 onlyMine 過濾要顯示的成員摘要
  const visibleSummary = useMemo(() => {
    if (onlyMine && !isManager) return summary.filter(s => s.user === currentUser);
    return summary;
  }, [summary, onlyMine, isManager, currentUser]);
  const showTeamView = isManager || !onlyMine; // 是否為團隊瀏覽模式（多人＋折疊）

  // 週報文字裡的一列回報。「階段」= 該計畫區間底下、本週(currentWeek,不是今天)落在範圍內的子區間;沒有就不加括號。
  // 兩份週報文字(單人/全隊)共用這一行,格式才不會漂掉。
  // 一列＝一個回報單位:子區間回報寫成「區間 › 子區間」;父層舊紀錄(legacy)才在括號列出當週階段
  const reportTaskLine = ({
    proj,
    task,
    sub,
    log,
    legacy
  }) => {
    const phases = legacy ? activeSubsOf(task, currentWeek).map(x => x.name) : [];
    const phaseText = phases.length > 0 ? `（階段：${phases.join('／')}）` : '';
    return `  [${STATUS_META[log.status]?.label}] ${proj.name} - ${unitLabel(task, sub)}${phaseText}${log.note ? '：' + log.note : ''}${log.docUrl ? `\n      📎 ${log.docUrl}` : ''}`;
  };

  // 產生單一成員的週報文字
  const buildSingleUserReport = s => {
    const lines = [`【MSD W${String(currentWeek).padStart(2, '0')} 週報 — ${s.user}】`, ''];
    lines.push(`■ ${s.user}（回報 ${s.activeTasks.length}/${s.total}・得分 ${s.weekScore}/${s.taskTotal}）`);
    s.activeTasks.forEach(t => lines.push(reportTaskLine(t)));
    if (s.extraNote) lines.push(`  (非專案) ${s.extraNote.replace(/\n/g, ' / ')}`);
    if (s.extraMeta?.docUrl) lines.push(`      📎 ${s.extraMeta.docUrl}`);
    if (s.weekPlan) lines.push(`  (下週預計) ${s.weekPlan.replace(/\n/g, ' / ')}`);
    if (s.planMeta?.docUrl) lines.push(`      📎 ${s.planMeta.docUrl}`);
    if (s.comment) lines.push(`  (主管回覆) ${s.comment.replace(/\n/g, ' / ')}`);
    lines.push('');
    return lines.join('\n');
  };

  // 產生可見範圍的週報文字
  const buildReportText = () => {
    const lines = [`【MSD W${String(currentWeek).padStart(2, '0')} ${showTeamView ? '團隊週報' : '週報 — ' + currentUser}】`, ''];
    visibleSummary.forEach(s => {
      // 只附了文件、沒打字的人也要出現(否則他的連結不會進週報文字)
      if (s.activeTasks.length === 0 && !s.extraNote && !s.weekPlan && !s.extraMeta?.docUrl && !s.planMeta?.docUrl) return;
      lines.push(`■ ${s.user}（回報 ${s.activeTasks.length}/${s.total}・得分 ${s.weekScore}/${s.taskTotal}）`);
      s.activeTasks.forEach(t => lines.push(reportTaskLine(t)));
      if (s.extraNote) lines.push(`  (非專案) ${s.extraNote.replace(/\n/g, ' / ')}`);
      if (s.extraMeta?.docUrl) lines.push(`      📎 ${s.extraMeta.docUrl}`);
      if (s.weekPlan) lines.push(`  (下週預計) ${s.weekPlan.replace(/\n/g, ' / ')}`);
      if (s.planMeta?.docUrl) lines.push(`      📎 ${s.planMeta.docUrl}`);
      if (s.comment) lines.push(`  (主管回覆) ${s.comment.replace(/\n/g, ' / ')}`);
      lines.push('');
    });
    return lines.join('\n');
  };

  // 通用複製函式(實作在頂層的 copyToClipboard,與文件連結的「複製路徑」鈕共用同一份退路處理)
  const doCopy = async (text, onDone) => {
    if (await copyToClipboard(text)) onDone();
  };
  const copyReport = () => doCopy(buildReportText(), () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  });
  const copyUserReport = s => doCopy(buildSingleUserReport(s), () => {
    setCopiedUser(s.user);
    setTimeout(() => setCopiedUser(null), 2000);
  });

  // 催報名單:看板已經算得出每個人「回報 0/5」,但看完之後沒有任何後續動作——
  // 主管還是得自己把名字抄到通訊軟體上。這裡直接組好可貼的文字(純前端,零後端成本)。
  // 只列「真的有缺」的人:未回報任務 >0 或下週預計未填;全員都交了就不給空名單,直接回報好消息。
  const pendingSummary = useMemo(() => visibleSummary.filter(s => s.pendingTasks.length > 0 || !s.weekPlan), [visibleSummary]);
  const buildPendingText = () => {
    const lines = [`【MSD W${String(currentWeek).padStart(2, '0')} 待回報提醒】`, ''];
    pendingSummary.forEach(s => {
      const miss = [];
      if (s.pendingTasks.length > 0) miss.push(`專案回報 ${s.pendingTasks.length} 項未填`);
      if (!s.weekPlan) miss.push('下週預計未填');
      lines.push(`• ${s.user}：${miss.join('、')}`);
      // 把未回報的項目名稱一併列出,收到訊息的人不用再回系統查是哪幾項
      s.pendingTasks.forEach(({
        proj,
        task,
        sub
      }) => lines.push(`    - ${proj.name}｜${unitLabel(task, sub)}`));
    });
    lines.push('', `（共 ${pendingSummary.length} 人待補，請於本週內完成回報）`);
    return lines.join('\n');
  };
  const copyPendingList = () => doCopy(buildPendingText(), () => {
    setCopiedPending(true);
    setTimeout(() => setCopiedPending(false), 2000);
  });

  // 全部展開 / 全部收合
  const expandAll = () => setExpandedUsers(new Set(users));
  const collapseAll = () => setExpandedUsers(new Set());
  const toggleExpand = user => setExpandedUsers(prev => {
    const s = new Set(prev);
    s.has(user) ? s.delete(user) : s.add(user);
    return s;
  });

  // 卡片展開內容(收整個成員摘要物件,含各區塊內容與最後編輯 meta)
  const renderCardBody = ({
    activeTasks,
    pendingTasks,
    extraNote,
    weekPlan,
    comment,
    extraMeta,
    planMeta,
    commentMeta
  }) => /*#__PURE__*/React.createElement("div", {
    className: `p-4 grid grid-cols-1 gap-4 ${narrowPanel ? '' : 'md:grid-cols-2'}`
  }, /*#__PURE__*/React.createElement("div", {
    className: "space-y-2.5"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-bold text-slate-500 border-b border-slate-200 pb-1"
  }, "\uD83D\uDCCC \u5C08\u6848\u57F7\u884C\u9805\u76EE"), activeTasks.length > 0 ? activeTasks.map(({
    proj,
    task,
    sub,
    log,
    legacy
  }) => {
    // 一張卡＝一個回報單位:高亮也以單位比對(子區間的卡只亮那條子條,父層的卡只亮父條)
    const cardHighlighted = highlightedTaskId === task.id && (highlightedSubId ?? null) === (sub?.id ?? null);
    return /*#__PURE__*/React.createElement("div", _extends({
      key: `${task.id}-${sub?.id ?? ''}`
    }, clickable(onHighlightTask ? () => onHighlightTask(proj, task, sub || null) : undefined, `在甘特圖高亮 ${proj.name}｜${task.name}${sub ? `｜${sub.name}` : ''}`), {
      title: onHighlightTask ? sub ? '點擊在左側甘特圖高亮此子區間' : '點擊在左側甘特圖高亮此項目的計畫區間' : undefined,
      className: `text-sm p-2.5 rounded-lg border ${onHighlightTask ? 'cursor-pointer' : ''} ${cardHighlighted ? 'ring-2 ring-blue-500 border-blue-400 bg-blue-50/70' : log.status === 'not_executed' ? 'bg-slate-100 border-slate-300 opacity-80' : log.status === 'monitor' ? 'bg-sky-50/70 border-sky-200' : 'bg-green-50/60 border-green-200'}`
    }), /*#__PURE__*/React.createElement("div", {
      className: "font-bold text-slate-700 text-xs leading-snug break-words"
    }, proj.name, cardHighlighted && /*#__PURE__*/React.createElement("span", {
      className: "ml-1 text-blue-600 text-[10px]"
    }, "\u25C0 \u7518\u7279\u5716\u5DF2\u9AD8\u4EAE")), /*#__PURE__*/React.createElement("div", {
      className: "flex flex-wrap items-center gap-1 mt-1"
    }, /*#__PURE__*/React.createElement("span", {
      className: `px-1.5 py-0.5 rounded text-[10px] font-bold ${STATUS_META[log.status]?.tag}`
    }, STATUS_META[log.status]?.label), /*#__PURE__*/React.createElement("span", {
      className: "px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-700",
      title: "\u6253\u5361\u5F97\u5206"
    }, Number(log.score ?? 1), "\u5206"), log.reporterRole === 'manager' && /*#__PURE__*/React.createElement("span", {
      className: "px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300",
      title: "\u6B64\u7B46\u7531\u4E3B\u7BA1\u4EE3\u70BA\u4FEE\u6B63/\u88DC\u767B"
    }, "\u270F\uFE0F\u4E3B\u7BA1"), log.docUrl && /*#__PURE__*/React.createElement(DocLink, {
      url: log.docUrl,
      stopPropagation: true
    })), (() => {
      const phases = legacy ? activeSubsOf(task, currentWeek) : [];
      return /*#__PURE__*/React.createElement("div", {
        className: "my-1 flex flex-wrap items-center gap-1"
      }, /*#__PURE__*/React.createElement("span", {
        className: "text-slate-600 font-medium text-xs"
      }, task.name), sub && /*#__PURE__*/React.createElement("span", {
        className: "px-1.5 py-0.5 rounded text-[10px] font-bold bg-sky-100 text-sky-800 border border-sky-300 whitespace-nowrap",
        title: `子區間：${sub.name}（W${String(sub.start).padStart(2, '0')}–W${String(sub.end).padStart(2, '0')}）`
      }, "\u203A ", sub.name), phases.map(x => /*#__PURE__*/React.createElement("span", {
        key: x.id,
        className: "px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-300 whitespace-nowrap",
        title: `本週進行中的子區間：${x.name}（W${String(x.start).padStart(2, '0')}–W${String(x.end).padStart(2, '0')}）；此週以計畫區間為單位回報`
      }, "\u968E\u6BB5\uFF1A", x.name)));
    })(), log.note && /*#__PURE__*/React.createElement("div", {
      className: "text-slate-700 text-xs bg-white p-1.5 rounded border border-slate-200 whitespace-pre-wrap"
    }, log.note), log.updatedAt && /*#__PURE__*/React.createElement("div", {
      className: "text-[10px] text-slate-500 mt-1"
    }, "\uD83D\uDD58 \u6700\u5F8C\u7DE8\u8F2F ", log.updatedAt, log.reporter ? `（${log.reporter}）` : ''));
  }) : /*#__PURE__*/React.createElement("div", {
    className: "text-sm text-slate-500 italic py-2"
  }, "\u672C\u9031\u7121\u5C08\u6848\u6295\u5165"), pendingTasks.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "text-[11px] text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-lg px-2.5 py-1.5"
  }, "\u5C1A\u6709 ", pendingTasks.length, " \u9805\u672C\u9031\u6392\u5B9A\u4EFB\u52D9\u672A\u56DE\u5831\uFF1A", pendingTasks.map(({
    task,
    sub
  }) => unitLabel(task, sub)).join('、'))), /*#__PURE__*/React.createElement("div", {
    className: `space-y-2.5 ${narrowPanel ? 'border-t border-slate-200 pt-2' : 'md:border-l md:border-slate-100 md:pl-4'}`
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-bold text-slate-500 border-b border-slate-200 pb-1"
  }, "\uD83D\uDCDD \u65E5\u5E38\u71DF\u904B / \u81E8\u6642\u4EA4\u8FA6\uFF08\u975E\u5C08\u6848\uFF09"), extraNote || extraMeta?.docUrl ? /*#__PURE__*/React.createElement("div", null, extraNote ? /*#__PURE__*/React.createElement("div", {
    className: "text-sm text-slate-700 bg-orange-50 p-3 rounded-lg border border-orange-200 whitespace-pre-wrap"
  }, extraNote) : /*#__PURE__*/React.createElement("div", {
    className: "text-sm text-slate-500 italic py-1"
  }, "\uFF08\u672A\u586B\u5BEB\u6587\u5B57\uFF0C\u50C5\u9644\u6587\u4EF6\uFF09"), extraMeta?.docUrl && /*#__PURE__*/React.createElement("div", {
    className: "mt-1.5"
  }, /*#__PURE__*/React.createElement(DocLink, {
    url: extraMeta.docUrl
  })), /*#__PURE__*/React.createElement(MetaLine, {
    meta: extraMeta
  })) : /*#__PURE__*/React.createElement("div", {
    className: "text-sm text-slate-500 italic py-2"
  }, "\u7121\u586B\u5BEB\u5176\u4ED6\u9805\u76EE"), /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-bold text-slate-500 border-b border-slate-200 pb-1 pt-1"
  }, "\uD83D\uDCC5 \u4E0B\u9031\u9810\u8A08\u57F7\u884C\u5DE5\u4F5C"), weekPlan || planMeta?.docUrl ? /*#__PURE__*/React.createElement("div", null, weekPlan ? /*#__PURE__*/React.createElement("div", {
    className: "text-sm text-slate-700 bg-indigo-50 p-3 rounded-lg border border-indigo-200 whitespace-pre-wrap"
  }, weekPlan) : /*#__PURE__*/React.createElement("div", {
    className: "text-sm text-slate-500 italic py-1"
  }, "\uFF08\u672A\u586B\u5BEB\u6587\u5B57\uFF0C\u50C5\u9644\u6587\u4EF6\uFF09"), planMeta?.docUrl && /*#__PURE__*/React.createElement("div", {
    className: "mt-1.5"
  }, /*#__PURE__*/React.createElement(DocLink, {
    url: planMeta.docUrl
  })), /*#__PURE__*/React.createElement(MetaLine, {
    meta: planMeta
  })) : /*#__PURE__*/React.createElement("div", {
    className: "text-sm text-slate-500 italic py-2"
  }, "\u672A\u586B\u5BEB")), comment && /*#__PURE__*/React.createElement("div", {
    className: narrowPanel ? '' : 'md:col-span-2'
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-bold text-violet-700 border-b border-violet-100 pb-1 mb-2"
  }, "\uD83D\uDC51 \u4E3B\u7BA1\u56DE\u8986"), /*#__PURE__*/React.createElement("div", {
    className: "text-sm text-slate-800 bg-violet-50 p-3 rounded-lg border border-violet-300 whitespace-pre-wrap"
  }, comment), /*#__PURE__*/React.createElement(MetaLine, {
    meta: commentMeta,
    showManagerTag: false
  })));
  return (
    /*#__PURE__*/
    // 從視窗最頂端貼到最底端的右側欄位(fixed):連 header 那一列(管理／登出／深色切換)一起蓋住,
    // 視覺上是一整條完整的欄位;要用那些按鈕時先關掉看板即可。
    // 左側主內容區另以 marginRight 內縮同樣寬度,所以工具列與甘特不會被蓋到。
    // ⚠ z-[90]:看板是「唯讀側邊面板」,必須壓在所有彈窗/面板(z-[100] 起跳)之下。
    //   原本是 z-[120],夾在彈窗層中間 → 看板開著時點甘特條開啟的打卡彈窗(z-[100])會被看板蓋住右半邊,
    //   連右上角的 ✕ 都按不到,使用者得先關看板才關得掉彈窗。90 仍高於 header(z-50)與甘特凍結欄(z-50),
    //   「整條蓋住 header」的原始設計不受影響。
    React.createElement("div", {
      className: "fixed top-0 right-0 bottom-0 z-[90] bg-slate-100 shadow-[-4px_0_12px_rgba(0,0,0,0.18)] flex flex-col border-l border-slate-300",
      style: {
        width: panelWidth,
        maxWidth: '100%'
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: `text-white flex justify-between items-center shadow-md gap-2 ${narrowPanel ? 'px-3 py-2.5' : 'px-6 py-4'}`,
      style: {
        backgroundColor: '#001F5B'
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "min-w-0"
    }, /*#__PURE__*/React.createElement("h2", {
      className: `font-bold whitespace-nowrap truncate ${narrowPanel ? 'text-base leading-tight' : 'text-xl'}`
    }, "\uD83D\uDCCA W", String(currentWeek).padStart(2, '0'), " ", narrowPanel ? '團隊總結' : '團隊工作總結看板'), !narrowPanel && /*#__PURE__*/React.createElement("p", {
      className: "text-xs text-blue-200 mt-1"
    }, "\u5F59\u7E3D\u5404\u6210\u54E1\u300C\u5C08\u6848\u5BE6\u969B\u57F7\u884C\u300D\u8207\u300C\u975E\u5C08\u6848\u4E8B\u9805\u300D")), /*#__PURE__*/React.createElement("div", {
      className: "flex items-center space-x-2 flex-shrink-0"
    }, /*#__PURE__*/React.createElement("button", {
      onClick: exportExcel,
      disabled: exporting,
      className: `px-3 py-1.5 rounded-lg text-xs font-bold transition border text-white disabled:opacity-70 whitespace-nowrap ${exportFailed ? 'bg-red-700 hover:bg-red-600 border-red-400/60' : 'bg-green-700 hover:bg-green-600 border-green-400/60'}`,
      title: "\u4E0B\u8F09 Excel \u9031\u5831(.xlsx)"
    }, exporting ? '⏳ 產生中…' : exportFailed ? narrowPanel ? '❌ 重試' : '❌ 匯出失敗，點擊重試' : narrowPanel ? '⬇️ Excel' : '⬇️ 匯出 Excel'), /*#__PURE__*/React.createElement("button", {
      onClick: copyReport,
      className: `px-3 py-1.5 rounded-lg text-xs font-bold transition border whitespace-nowrap ${copied ? 'bg-green-700 border-green-400 text-white' : 'bg-white/10 hover:bg-white/20 border-white/20 text-white'}`,
      title: "\u8907\u88FD\u6574\u4EFD\u5718\u968A\u9031\u5831\u6587\u5B57"
    }, copied ? '✓ 已複製' : narrowPanel ? '📋 複製全部' : '📋 複製週報文字'), /*#__PURE__*/React.createElement(CloseButton, {
      onClick: onClose,
      className: "text-white hover:bg-white/20 p-2 rounded-full"
    }))), /*#__PURE__*/React.createElement("div", {
      className: `bg-white py-2 border-b border-slate-300 flex items-center gap-2 flex-wrap ${narrowPanel ? 'px-3' : 'px-6'}`
    }, !isManager && /*#__PURE__*/React.createElement("label", {
      className: "flex items-center space-x-1.5 cursor-pointer select-none bg-slate-100 border border-slate-300 rounded-lg px-2 py-1"
    }, /*#__PURE__*/React.createElement("input", {
      type: "checkbox",
      checked: onlyMine,
      onChange: e => {
        setOnlyMine(e.target.checked);
        if (!e.target.checked) setExpandedUsers(new Set());else setExpandedUsers(new Set([currentUser]));
      },
      className: "w-3.5 h-3.5 rounded text-blue-600"
    }), /*#__PURE__*/React.createElement("span", {
      className: "font-medium text-slate-700 text-[11px]"
    }, "\u53EA\u770B\u6211\u7684\u9031\u5831")), showTeamView && /*#__PURE__*/React.createElement(React.Fragment, null, !isManager && /*#__PURE__*/React.createElement("div", {
      className: "h-4 border-l border-slate-300"
    }), /*#__PURE__*/React.createElement("button", {
      onClick: expandAll,
      className: "text-[11px] text-blue-600 hover:text-blue-800 font-bold"
    }, "\u5C55\u958B\u5168\u90E8"), /*#__PURE__*/React.createElement("span", {
      className: "text-slate-500",
      "aria-hidden": "true"
    }, "|"), /*#__PURE__*/React.createElement("button", {
      onClick: collapseAll,
      className: "text-[11px] text-blue-600 hover:text-blue-800 font-bold"
    }, "\u6536\u5408\u5168\u90E8"), isManager && !isFutureWeek && pendingSummary.length > 0 && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
      className: "text-slate-400",
      "aria-hidden": "true"
    }, "|"), /*#__PURE__*/React.createElement("button", {
      onClick: copyPendingList,
      className: `px-2 py-1 rounded-lg text-[11px] font-bold border transition ${copiedPending ? 'bg-green-700 border-green-800 text-white' : 'bg-amber-100 text-amber-900 border-amber-500 hover:bg-amber-200'}`,
      title: `複製 ${pendingSummary.length} 位待回報成員的名單與缺漏項目，可直接貼到通訊軟體`
    }, copiedPending ? '✓ 已複製名單' : `複製待回報名單（${pendingSummary.length}）`)), /*#__PURE__*/React.createElement("div", {
      className: "ml-auto flex items-center gap-1.5 text-[10px] text-slate-600 dark:text-slate-400"
    }, /*#__PURE__*/React.createElement("span", {
      className: "font-bold text-slate-700 dark:text-slate-300"
    }, "\u5DF2\u56DE\u5831"), ['executed', 'monitor', 'not_executed'].map(k => /*#__PURE__*/React.createElement("span", {
      key: k,
      className: "flex items-center gap-1 whitespace-nowrap"
    }, /*#__PURE__*/React.createElement("span", {
      className: `w-3 h-2.5 rounded-full ${STATUS_META[k].fill}`
    }), STATUS_META[k].label)), /*#__PURE__*/React.createElement("span", {
      className: "text-slate-400 dark:text-slate-500"
    }, "\uFF5C"), /*#__PURE__*/React.createElement("span", {
      className: "flex items-center gap-1 whitespace-nowrap font-bold text-slate-700 dark:text-slate-300"
    }, /*#__PURE__*/React.createElement("span", {
      className: `w-3 h-2.5 rounded-full ${BAR_TRACK}`
    }), "\u672A\u56DE\u5831\uFF08\u7559\u7A7A\uFF09")))), /*#__PURE__*/React.createElement("div", {
      className: `flex-1 overflow-y-auto space-y-5 ${narrowPanel ? 'p-3' : 'p-6'}`
    }, visibleSummary.map(s => {
      const {
        user,
        activeTasks,
        pendingTasks,
        extraNote,
        weekPlan,
        total
      } = s;
      // 只附了文件、沒打字的人也要有卡片(否則他的連結整個看不到)
      if (activeTasks.length === 0 && !extraNote && !weekPlan && pendingTasks.length === 0 && !s.extraMeta?.docUrl && !s.planMeta?.docUrl) return null;
      const isExpanded = showTeamView ? expandedUsers.has(user) : true; // 個人模式固定展開
      const isCopiedUser = copiedUser === user;
      // 進度條改「分段組成」:一條就同時表達回報率與狀態分佈,取代原本 ✅/👁️/❗ 三顆晶片。
      // 已回報三段沿用全站狀態色(STATUS_META.fill),未回報留空槽——有填/沒填才不會被誤讀成同一類。
      const cExec = activeTasks.filter(a => a.log.status === 'executed').length;
      const cMon = activeTasks.filter(a => a.log.status === 'monitor').length;
      const cNot = activeTasks.filter(a => a.log.status === 'not_executed').length;
      const cPend = pendingTasks.length;
      const barSegs = [{
        n: cExec,
        key: 'executed'
      }, {
        n: cMon,
        key: 'monitor'
      }, {
        n: cNot,
        key: 'not_executed'
      }]; // 未回報不入列:留空槽即代表未回報(條填滿程度＝回報率)
      const barTitle = `已回報 ${activeTasks.length}/${total}（有執行 ${cExec}・Monitor ${cMon}・未執行 ${cNot}）／未回報 ${cPend}`;
      return /*#__PURE__*/React.createElement("div", {
        key: user,
        className: "bg-white dark:bg-slate-800/80 rounded-xl shadow-sm border border-slate-300 dark:border-slate-700 overflow-hidden"
      }, /*#__PURE__*/React.createElement("div", _extends({
        className: `bg-slate-200 dark:bg-slate-800 py-2 border-b border-slate-300 dark:border-slate-700 font-bold text-slate-800 dark:text-slate-100 flex items-center overflow-hidden ${tightRow ? 'gap-1 px-2' : narrowPanel ? 'gap-1.5 px-2.5' : 'gap-2 px-4'} ${showTeamView ? 'cursor-pointer hover:bg-slate-200/70 dark:hover:bg-slate-700/70 transition' : ''}`
      }, clickable(showTeamView ? () => toggleExpand(user) : undefined, `${isExpanded ? '收合' : '展開'} ${user} 的週報（${barTitle}）`, {
        expanded: isExpanded
      })), showTeamView && /*#__PURE__*/React.createElement("span", {
        className: "flex-shrink-0 text-slate-600 dark:text-slate-400 text-xs select-none"
      }, isExpanded ? '▼' : '▶'), /*#__PURE__*/React.createElement("div", {
        className: "flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs"
      }, user[0]), /*#__PURE__*/React.createElement("span", {
        className: "min-w-0 truncate",
        title: user
      }, user), total > 0 && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
        className: `flex-shrink-0 h-2.5 rounded-full overflow-hidden flex ${BAR_TRACK} ${tightRow ? 'w-12' : narrowPanel ? 'w-14' : 'w-24'}`,
        title: barTitle
      }, barSegs.filter(x => x.n > 0).map(x => /*#__PURE__*/React.createElement("div", {
        key: x.key,
        className: STATUS_META[x.key].fill,
        style: {
          width: `${x.n / total * 100}%`
        }
      }))), !tightRow && /*#__PURE__*/React.createElement("span", {
        className: `flex-shrink-0 text-[10px] font-bold whitespace-nowrap ${cPend > 0 ? 'text-amber-800 dark:text-amber-300' : 'text-slate-700 dark:text-slate-300'}`
      }, activeTasks.length, "/", total, narrowPanel ? '' : ' 回報'), /*#__PURE__*/React.createElement("span", {
        className: `flex-shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap ${s.weekScore >= s.taskTotal ? 'bg-green-100 text-green-800 border-green-400 dark:bg-green-900/40 dark:text-green-300 dark:border-green-700/50' : 'bg-indigo-100 text-indigo-800 border-indigo-400 dark:bg-indigo-900/40 dark:text-indigo-300 dark:border-indigo-700/50'}`,
        title: `本週得分＝各計畫區間打卡分數加總（回報預設 1 分、主管可調 0.3~1；未回報 0 分；有子區間的週＝子區間分數平均）／滿分＝本週排定計畫區間數`
      }, tightRow ? `${s.weekScore}/${s.taskTotal}分` : `🏆 ${s.weekScore}/${s.taskTotal}${narrowPanel ? '' : ' 分'}`)), !isExpanded && showTeamView && !weekPlan && /*#__PURE__*/React.createElement("span", {
        className: "flex-shrink-0 bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 px-1.5 py-0.5 rounded text-[10px] font-bold border border-amber-400 dark:border-amber-700/50 whitespace-nowrap",
        title: "\u5C1A\u672A\u586B\u5BEB\u300C\u4E0B\u9031\u9810\u8A08\u57F7\u884C\u5DE5\u4F5C\u300D\uFF08\u5F37\u5236\u56DE\u5831\u9805\u76EE\uFF09"
      }, "\uD83D\uDCC5 ", narrowPanel ? '未填' : '下週預計未填'), !isExpanded && showTeamView && !isManager && s.comment && /*#__PURE__*/React.createElement("span", {
        className: "flex-shrink-0 bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 px-1.5 py-0.5 rounded text-[10px] font-bold border border-violet-300 dark:border-violet-700/50",
        title: "\u5DF2\u6709\u4E3B\u7BA1\u56DE\u8986"
      }, "\uD83D\uDCAC"), /*#__PURE__*/React.createElement("button", {
        onClick: e => {
          e.stopPropagation();
          copyUserReport(s);
        },
        className: `ml-auto flex-shrink-0 px-2 py-1 rounded text-[10px] font-bold transition border whitespace-nowrap ${isCopiedUser ? 'bg-green-700 border-green-800 text-white dark:bg-green-700 dark:border-green-600' : 'bg-white ctl-raised hover:bg-slate-200 border-slate-500 text-slate-700 dark:text-slate-200'}`,
        title: `複製 ${user} 的週報文字（可貼到郵件／通訊軟體）`
      }, isCopiedUser ? '✓ 已複製' : '複製週報'), isManager && onEditComment && /*#__PURE__*/React.createElement("button", {
        onClick: e => {
          e.stopPropagation();
          onEditComment(user);
        },
        className: `flex-shrink-0 px-2 py-1 rounded text-[10px] font-bold transition border whitespace-nowrap ${s.comment ? 'bg-violet-100 hover:bg-violet-200 border-violet-500 text-violet-800 dark:bg-violet-900/40 dark:hover:bg-violet-900/60 dark:border-violet-700/50 dark:text-violet-300' : 'bg-white ctl-raised hover:bg-violet-50 border-violet-500 text-violet-700 dark:text-violet-300'}`,
        title: s.comment ? `編輯對 ${user} 的本週回覆` : `回覆 ${user} 的本週週報（選填）`
      }, s.comment ? '✓ 已回覆' : '主管回覆')), isExpanded && renderCardBody(s));
    }), visibleSummary.filter(s => s.activeTasks.length > 0 || s.extraNote || s.weekPlan || s.pendingTasks.length > 0).length === 0 && /*#__PURE__*/React.createElement("div", {
      className: "text-center text-slate-500 italic py-12"
    }, "\u672C\u9031\u5C1A\u7121\u56DE\u5831\u8CC7\u6599")))
  );
}
function ProjectEditModal({
  info,
  existingCategories,
  users = [],
  onClose,
  onSave
}) {
  const focus = useModalFocus(); // 開啟時焦點移入、Tab 鎖在視窗內、關閉時還原
  const isEdit = info.mode === 'edit';
  const p = info.project;
  const [name, setName] = useState(isEdit ? p.name : '');
  const [category, setCategory] = useState(isEdit ? p.category : '');
  const [type, setType] = useState(isEdit ? p.type : 'a');
  const [nid, setNid] = useState(isEdit ? p.nid || '' : ''); // 專案流水編號(選填;一專案可含多組)
  const [owner, setOwner] = useState(info.owner); // 編輯時可改派負責人(如移轉給新成員)
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useModalDirtyReset();
  const submit = async () => {
    if (saving) return;
    if (!name.trim()) {
      setError('專案名稱不可空白');
      return;
    }
    if (!category.trim()) {
      setError('分類不可空白');
      return;
    }
    setSaving(true);
    try {
      await onSave({
        mode: info.mode,
        projectId: isEdit ? p.id : undefined,
        owner,
        name: name.trim(),
        category: category.trim(),
        type,
        nid: nid.trim()
      });
    } finally {
      setSaving(false);
    }
  };
  return /*#__PURE__*/React.createElement("div", _extends({}, focus, {
    className: "fixed inset-0 bg-slate-900/50 backdrop-blur-sm modal-scrim z-[130] flex justify-center items-center p-4"
  }), /*#__PURE__*/React.createElement("div", {
    className: "bg-white rounded-2xl shadow-2xl modal-card w-full max-w-md overflow-hidden",
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("div", {
    className: "px-6 py-4 text-white flex justify-between items-center",
    style: {
      backgroundColor: '#001F5B'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h3", {
    className: "font-bold text-lg"
  }, isEdit ? '✎ 編輯專案' : '＋ 新增專案'), /*#__PURE__*/React.createElement("p", {
    className: "text-xs text-blue-200 mt-0.5"
  }, "\u8CA0\u8CAC\u4EBA\uFF1A", info.owner)), /*#__PURE__*/React.createElement(CloseButton, {
    onClick: onClose,
    className: "text-white/60 hover:text-white"
  })), /*#__PURE__*/React.createElement("div", {
    className: "p-6 space-y-4"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "text-xs font-bold text-slate-500"
  }, "\u5C08\u6848\u540D\u7A31", /*#__PURE__*/React.createElement(ReqMark, null)), /*#__PURE__*/React.createElement("input", {
    type: "text",
    value: name,
    onChange: e => {
      setName(e.target.value);
      setError('');
      markModalDirty();
    },
    autoFocus: true,
    onKeyDown: onEnterSubmit(submit),
    className: "mt-1 w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500",
    placeholder: "\u8F38\u5165\u5C08\u6848\u540D\u7A31\u2026"
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "text-xs font-bold text-slate-500"
  }, "\u5206\u985E", /*#__PURE__*/React.createElement(ReqMark, null)), /*#__PURE__*/React.createElement("input", {
    type: "text",
    list: "category-options",
    value: category,
    onChange: e => {
      setCategory(e.target.value);
      setError('');
      markModalDirty();
    },
    onKeyDown: onEnterSubmit(submit),
    className: "mt-1 w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500",
    placeholder: "\u9078\u64C7\u73FE\u6709\u5206\u985E\u6216\u8F38\u5165\u65B0\u5206\u985E\u2026"
  }), /*#__PURE__*/React.createElement("datalist", {
    id: "category-options"
  }, existingCategories.map(c => /*#__PURE__*/React.createElement("option", {
    key: c,
    value: c
  })))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "text-xs font-bold text-slate-500"
  }, "\u985E\u578B"), /*#__PURE__*/React.createElement("select", {
    value: type,
    onChange: e => {
      setType(e.target.value);
      markModalDirty();
    },
    className: "mt-1 w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500 bg-white ctl-raised"
  }, Object.entries(PROJECT_TYPES).map(([key, meta]) => /*#__PURE__*/React.createElement("option", {
    key: key,
    value: key
  }, key.toUpperCase(), "\xB7", meta.label)))), isEdit && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "text-xs font-bold text-slate-500"
  }, "\u8CA0\u8CAC\u4EBA"), /*#__PURE__*/React.createElement("select", {
    value: owner,
    onChange: e => {
      setOwner(e.target.value);
      markModalDirty();
    },
    className: "mt-1 w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500 bg-white ctl-raised"
  }, (users.includes(owner) ? users : [owner, ...users]).map(u => /*#__PURE__*/React.createElement("option", {
    key: u,
    value: u
  }, u))), owner !== info.owner && /*#__PURE__*/React.createElement("div", {
    className: "mt-1 text-[11px] text-orange-600 font-bold"
  }, "\u26A0 \u5132\u5B58\u5F8C\u6B64\u5C08\u6848(\u542B\u5340\u9593\u8207\u56DE\u5831\u7D00\u9304)\u5C07\u79FB\u8F49\u7D66\u300C", owner, "\u300D")), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "text-xs font-bold text-slate-500"
  }, "NID\uFF08\u6D41\u6C34\u7DE8\u865F\uFF0C\u9078\u586B\uFF09"), /*#__PURE__*/React.createElement("input", {
    type: "text",
    value: nid,
    onChange: e => {
      setNid(e.target.value);
      markModalDirty();
    },
    onKeyDown: onEnterSubmit(submit),
    className: "mt-1 w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500",
    placeholder: "\u5C08\u6848\u6D41\u6C34\u7DE8\u865F\uFF0C\u53EF\u542B\u591A\u7D44\uFF08\u5982 N001, N002\uFF09\u2026"
  })), error && /*#__PURE__*/React.createElement("div", {
    className: "text-xs text-red-600 font-bold"
  }, error), /*#__PURE__*/React.createElement("div", {
    className: "flex justify-end space-x-3 pt-2"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    className: "px-4 py-2 text-sm text-slate-600 bg-slate-100 rounded-lg font-bold hover:bg-slate-200"
  }, "\u53D6\u6D88"), /*#__PURE__*/React.createElement("button", {
    onClick: submit,
    disabled: saving,
    className: "px-6 py-2 text-sm text-white font-bold rounded-lg shadow-md transition hover:opacity-90 disabled:opacity-50",
    style: {
      backgroundColor: BRAND_BTN
    }
  }, saving ? '儲存中…' : isEdit ? '儲存變更' : '新增專案')))));
}
function IntervalModal({
  project,
  currentWeek,
  weeksTotal = WEEKS_TOTAL,
  onClose,
  onSave
}) {
  const focus = useModalFocus(); // 開啟時焦點移入、Tab 鎖在視窗內、關閉時還原
  const [taskName, setTaskName] = useState('');
  const [start, setStart] = useState(currentWeek);
  const [end, setEnd] = useState(currentWeek);
  const [nid, setNid] = useState(''); // 此區間對應哪組 NID(選填)
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useModalDirtyReset();
  const submit = async () => {
    if (saving) return;
    const s = parseInt(start),
      e = parseInt(end);
    if (!taskName.trim()) {
      setError('計畫名稱不可空白');
      return;
    }
    if (isNaN(s) || isNaN(e) || s < 1 || e > weeksTotal || s > e) {
      setError(`週次需介於 1–${weeksTotal}，且開始週不可晚於結束週`);
      return;
    }
    setSaving(true);
    try {
      await onSave(project, taskName.trim(), s, e, nid.trim());
    } finally {
      setSaving(false);
    }
  };
  return /*#__PURE__*/React.createElement("div", _extends({}, focus, {
    className: "fixed inset-0 bg-slate-900/50 backdrop-blur-sm modal-scrim z-[130] flex justify-center items-center p-4"
  }), /*#__PURE__*/React.createElement("div", {
    className: "bg-white rounded-2xl shadow-2xl modal-card w-full max-w-md overflow-hidden",
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("div", {
    className: "px-6 py-4 text-white flex justify-between items-center",
    style: {
      backgroundColor: '#001F5B'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h3", {
    className: "font-bold text-lg"
  }, "\uFF0B \u65B0\u589E\u8A08\u756B\u5340\u9593"), /*#__PURE__*/React.createElement("p", {
    className: "text-xs text-blue-200 mt-0.5 truncate max-w-[300px]"
  }, project.name)), /*#__PURE__*/React.createElement(CloseButton, {
    onClick: onClose,
    className: "text-white/60 hover:text-white"
  })), /*#__PURE__*/React.createElement("div", {
    className: "p-6 space-y-4"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "text-xs font-bold text-slate-500"
  }, "\u8A08\u756B\u540D\u7A31", /*#__PURE__*/React.createElement(ReqMark, null)), /*#__PURE__*/React.createElement("input", {
    type: "text",
    value: taskName,
    onChange: e => {
      setTaskName(e.target.value);
      setError('');
      markModalDirty();
    },
    autoFocus: true,
    onKeyDown: onEnterSubmit(submit),
    className: "mt-1 w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500",
    placeholder: "\u8F38\u5165\u6B64\u5340\u9593\u7684\u8A08\u756B\u9805\u76EE\u2026"
  })), /*#__PURE__*/React.createElement("div", {
    className: "flex space-x-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "w-1/2"
  }, /*#__PURE__*/React.createElement("label", {
    className: "text-xs font-bold text-slate-500"
  }, "\u958B\u59CB\u9031", /*#__PURE__*/React.createElement(ReqMark, null)), /*#__PURE__*/React.createElement("input", {
    type: "number",
    min: "1",
    max: weeksTotal,
    value: start,
    onChange: e => {
      setStart(e.target.value);
      setError('');
      markModalDirty();
    },
    onKeyDown: onEnterSubmit(submit),
    className: "mt-1 w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500"
  })), /*#__PURE__*/React.createElement("div", {
    className: "w-1/2"
  }, /*#__PURE__*/React.createElement("label", {
    className: "text-xs font-bold text-slate-500"
  }, "\u7D50\u675F\u9031", /*#__PURE__*/React.createElement(ReqMark, null)), /*#__PURE__*/React.createElement("input", {
    type: "number",
    min: "1",
    max: weeksTotal,
    value: end,
    onChange: e => {
      setEnd(e.target.value);
      setError('');
      markModalDirty();
    },
    onKeyDown: onEnterSubmit(submit),
    className: "mt-1 w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500"
  }))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "text-xs font-bold text-slate-500"
  }, "NID\uFF08\u6B64\u5340\u9593\u5C0D\u61C9\u54EA\u7D44 NID\uFF0C\u9078\u586B\uFF09"), /*#__PURE__*/React.createElement("input", {
    type: "text",
    value: nid,
    onChange: e => {
      setNid(e.target.value);
      markModalDirty();
    },
    onKeyDown: onEnterSubmit(submit),
    className: "mt-1 w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500",
    placeholder: "\u5982 N001\u2026"
  })), error && /*#__PURE__*/React.createElement("div", {
    className: "text-xs text-red-600 font-bold"
  }, error), /*#__PURE__*/React.createElement("div", {
    className: "flex justify-end space-x-3 pt-2"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    className: "px-4 py-2 text-sm text-slate-600 bg-slate-100 rounded-lg font-bold hover:bg-slate-200"
  }, "\u53D6\u6D88"), /*#__PURE__*/React.createElement("button", {
    onClick: submit,
    disabled: saving,
    className: "px-6 py-2 text-sm text-white font-bold rounded-lg shadow-md transition hover:opacity-90 disabled:opacity-50",
    style: {
      backgroundColor: BRAND_BTN
    }
  }, saving ? '新增中…' : '新增區間')))));
}

// 自製刪除確認視窗(取代 window.confirm,樣式與系統一致)
function ConfirmModal({
  info,
  onCancel
}) {
  const focus = useModalFocus(); // 開啟時焦點移入、Tab 鎖在視窗內、關閉時還原
  const [busy, setBusy] = useState(false); // 防連點:確認處理中鎖定按鈕
  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await info.onConfirm();
    } finally {
      setBusy(false);
    }
  };
  return /*#__PURE__*/React.createElement("div", _extends({}, focus, {
    className: "fixed inset-0 bg-slate-900/50 backdrop-blur-sm modal-scrim z-[150] flex justify-center items-center p-4"
  }), /*#__PURE__*/React.createElement("div", {
    className: "bg-white rounded-2xl shadow-2xl modal-card w-full max-w-sm overflow-hidden",
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("div", {
    className: "px-6 py-4 text-white flex items-center",
    style: {
      backgroundColor: '#DC2626'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-xl mr-2"
  }, "\u26A0\uFE0F"), /*#__PURE__*/React.createElement("h3", {
    className: "font-bold text-lg",
    style: {
      color: '#FFFFFF'
    }
  }, info.title)), /*#__PURE__*/React.createElement("div", {
    className: "p-6"
  }, /*#__PURE__*/React.createElement("p", {
    className: "text-sm text-slate-700 whitespace-pre-wrap leading-relaxed"
  }, info.message), /*#__PURE__*/React.createElement("div", {
    className: "flex justify-end space-x-3 pt-5"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: onCancel,
    className: "px-4 py-2 text-sm text-slate-600 bg-slate-100 rounded-lg font-bold hover:bg-slate-200"
  }, "\u53D6\u6D88"), /*#__PURE__*/React.createElement("button", {
    onClick: confirm,
    disabled: busy,
    className: "px-6 py-2 text-sm bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold rounded-lg shadow-md"
  }, busy ? '處理中…' : info.confirmLabel || '確定刪除')))));
}

// 主管:異動紀錄面板(讀 AuditLog)
const AUDIT_ACTION_META = {
  INSERT: {
    label: '新增',
    cls: 'bg-green-100 text-green-700'
  },
  UPDATE: {
    label: '修改',
    cls: 'bg-blue-100 text-blue-700'
  },
  DELETE: {
    label: '刪除',
    cls: 'bg-red-100 text-red-700'
  },
  REORDER: {
    label: '排序',
    cls: 'bg-purple-100 text-purple-700'
  },
  CLOCKIN: {
    label: '回報',
    cls: 'bg-teal-100 text-teal-700'
  },
  EXTRANOTE: {
    label: '非專案',
    cls: 'bg-orange-100 text-orange-700'
  },
  WEEKPLAN: {
    label: '下週預計',
    cls: 'bg-indigo-100 text-indigo-700'
  },
  SCORE: {
    label: '評分',
    cls: 'bg-fuchsia-100 text-fuchsia-700'
  },
  COMMENT: {
    label: '回覆',
    cls: 'bg-violet-100 text-violet-700'
  },
  ACCESSRULE: {
    label: '權限',
    cls: 'bg-rose-100 text-rose-700'
  },
  SETTING: {
    label: '設定',
    cls: 'bg-slate-200 text-slate-700'
  }
};
const AUDIT_ENTITY_LABELS = {
  Project: '專案',
  Task: '任務',
  SubInterval: '子區間',
  WeeklyLog: '週回報',
  ExtraNote: '非專案事項',
  WeeklyPlan: '下週計畫',
  WeeklyComment: '主管回覆',
  User: '成員',
  AccessRule: '瀏覽權限',
  AppSettings: '系統設定'
};

// 主管:使用統計面板 — 登入次數(LoginLogs,遷移 13)評估網頁使用率;
// 每次登入寫一筆(manual=登入畫面點選/auto=重整自動還原,兩者都代表一次開啟使用)
function UsageStatsPanel({
  onClose
}) {
  const focus = useModalFocus(); // 開啟時焦點移入、Tab 鎖在視窗內、關閉時還原
  const [days, setDays] = useState(30);
  const [stats, setStats] = useState(null);
  const [loadError, setLoadError] = useState(null);
  React.useEffect(() => {
    let cancelled = false;
    setStats(null);
    setLoadError(null);
    apiGet(`/api/login-stats?days=${days}`).then(d => {
      if (!cancelled) setStats(d);
    }).catch(e => {
      if (!cancelled) setLoadError(e.message || '載入失敗');
    });
    return () => {
      cancelled = true;
    };
  }, [days]);

  // 每日趨勢:補齊近 days 天中無登入的日期(count=0),依日期排序
  const dayBars = useMemo(() => {
    if (!stats) return [];
    const map = {};
    (stats.byDay || []).forEach(d => {
      map[d.date] = d.count;
    });
    const list = [];
    for (let i = days - 1; i >= 0; i--) {
      const dt = new Date();
      dt.setDate(dt.getDate() - i);
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      list.push({
        date: key,
        label: `${dt.getMonth() + 1}/${dt.getDate()}`,
        count: map[key] || 0
      });
    }
    return list;
  }, [stats, days]);
  const maxDay = Math.max(1, ...dayBars.map(d => d.count));
  const maxUser = stats ? Math.max(1, ...(stats.byUser || []).map(u => Number(u.count))) : 1;
  const kpi = (label, value, sub) => /*#__PURE__*/React.createElement("div", {
    className: "bg-white ctl-raised border border-slate-300 rounded-xl p-3 text-center shadow-sm"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-[11px] font-bold text-slate-500"
  }, label), /*#__PURE__*/React.createElement("div", {
    className: "text-2xl font-black text-slate-800 mt-0.5"
  }, value), sub && /*#__PURE__*/React.createElement("div", {
    className: "text-[10px] text-slate-500 mt-0.5"
  }, sub));
  return /*#__PURE__*/React.createElement("div", _extends({}, focus, {
    className: "fixed inset-0 bg-slate-900/40 backdrop-blur-sm modal-scrim z-[105] flex justify-end"
  }), /*#__PURE__*/React.createElement("div", {
    className: "w-full max-w-md bg-white h-full shadow-2xl flex flex-col",
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("div", {
    className: "px-5 py-4 text-white flex justify-between items-center",
    style: {
      backgroundColor: '#0F766E'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h3", {
    className: "font-bold text-lg",
    style: {
      color: '#FFFFFF'
    }
  }, "\uD83D\uDCC8 \u4F7F\u7528\u7D71\u8A08"), /*#__PURE__*/React.createElement("p", {
    className: "text-xs mt-0.5",
    style: {
      color: '#CCFBF1'
    }
  }, "\u767B\u5165\u6B21\u6578\uFF08\u542B\u91CD\u65B0\u6574\u7406\u81EA\u52D5\u767B\u5165\uFF09\uFF0C\u8A55\u4F30\u7DB2\u9801\u4F7F\u7528\u7387")), /*#__PURE__*/React.createElement(CloseButton, {
    onClick: onClose,
    className: "text-white/70 hover:text-white p-1"
  })), /*#__PURE__*/React.createElement("div", {
    className: "bg-white px-5 py-2 border-b border-slate-300 flex items-center gap-1.5"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-[11px] font-bold text-slate-500 mr-1"
  }, "\u7D71\u8A08\u5340\u9593"), [7, 30, 90].map(d => /*#__PURE__*/React.createElement("button", {
    key: d,
    onClick: () => setDays(d),
    className: `px-2.5 py-1 rounded-lg text-[11px] font-bold border transition ${days === d ? 'bg-teal-700 text-white border-teal-800' : 'bg-slate-100 text-slate-600 border-slate-300 hover:bg-slate-200'}`
  }, "\u8FD1 ", d, " \u5929"))), /*#__PURE__*/React.createElement("div", {
    className: "flex-1 overflow-y-auto p-5 space-y-5"
  }, loadError ? /*#__PURE__*/React.createElement("div", {
    className: "bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm font-bold"
  }, "\u274C \u8F09\u5165\u5931\u6557\uFF1A", loadError) : !stats ? /*#__PURE__*/React.createElement("div", {
    className: "text-center text-slate-500 py-10"
  }, "\u8F09\u5165\u4E2D\u2026") : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-2 gap-3"
  }, kpi('今日登入', stats.today), kpi('近 7 天', stats.last7), kpi(`近 ${stats.days} 天`, stats.lastN, `手動 ${stats.manualN}・自動 ${stats.autoN}`), kpi('活躍使用者', stats.uniqueUsers, `近 ${stats.days} 天有登入的人數`)), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-black text-slate-500 uppercase tracking-wider mb-2"
  }, "\uD83D\uDCC5 \u6BCF\u65E5\u767B\u5165\u6B21\u6578\uFF08\u8FD1 ", stats.days, " \u5929\uFF09"), /*#__PURE__*/React.createElement("div", {
    className: "bg-white ctl-raised border border-slate-300 rounded-xl p-3 shadow-sm"
  }, stats.lastN === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "text-center text-slate-500 italic text-xs py-6"
  }, "\u6B64\u5340\u9593\u5C1A\u7121\u767B\u5165\u7D00\u9304") : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "flex items-end gap-px h-24"
  }, dayBars.map(d => /*#__PURE__*/React.createElement("div", {
    key: d.date,
    className: "flex-1 flex flex-col justify-end h-full group relative",
    title: `${d.date}：${d.count} 次`
  }, /*#__PURE__*/React.createElement("div", {
    className: `w-full rounded-t transition ${d.count > 0 ? 'bg-teal-500 group-hover:bg-teal-600' : 'bg-slate-100'}`,
    style: {
      height: d.count > 0 ? `${Math.max(8, Math.round(d.count / maxDay * 100))}%` : 2
    }
  })))), /*#__PURE__*/React.createElement("div", {
    className: "flex justify-between text-[10px] text-slate-500 mt-1.5 font-medium"
  }, /*#__PURE__*/React.createElement("span", null, dayBars[0]?.label), /*#__PURE__*/React.createElement("span", null, "\u55AE\u65E5\u6700\u9AD8 ", maxDay, " \u6B21"), /*#__PURE__*/React.createElement("span", null, dayBars[dayBars.length - 1]?.label))))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-black text-slate-500 uppercase tracking-wider mb-2"
  }, "\uD83D\uDC65 \u5404\u4F7F\u7528\u8005\u767B\u5165\u6B21\u6578\uFF08\u8FD1 ", stats.days, " \u5929\uFF09"), (stats.byUser || []).length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "bg-slate-100 border border-slate-300 rounded-xl p-4 text-center text-slate-500 text-xs italic"
  }, "\u6B64\u5340\u9593\u5C1A\u7121\u767B\u5165\u7D00\u9304") : /*#__PURE__*/React.createElement("div", {
    className: "space-y-2"
  }, stats.byUser.map(u => /*#__PURE__*/React.createElement("div", {
    key: u.user,
    className: "bg-white border border-slate-300 rounded-xl px-3 py-2 shadow-sm"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2"
  }, /*#__PURE__*/React.createElement("span", {
    className: "font-bold text-slate-800 text-sm"
  }, u.user), /*#__PURE__*/React.createElement("span", {
    className: `px-1.5 py-0.5 rounded text-[10px] font-bold border ${u.role === 'manager' ? 'bg-violet-100 text-violet-800 border-violet-400' : 'bg-sky-100 text-sky-800 border-sky-400'}`
  }, u.role === 'manager' ? '主管' : '成員'), /*#__PURE__*/React.createElement("span", {
    className: "ml-auto font-black text-teal-700 text-sm"
  }, u.count, " \u6B21")), /*#__PURE__*/React.createElement("div", {
    className: "mt-1.5 h-1.5 bg-slate-100 rounded-full overflow-hidden"
  }, /*#__PURE__*/React.createElement("div", {
    className: "h-full bg-teal-500 rounded-full",
    style: {
      width: `${Math.max(4, Math.round(Number(u.count) / maxUser * 100))}%`
    }
  })), /*#__PURE__*/React.createElement("div", {
    className: "text-[10px] text-slate-500 mt-1"
  }, "\u6700\u5F8C\u767B\u5165 ", u.lastAt))))), /*#__PURE__*/React.createElement("div", {
    className: "text-[11px] text-slate-500 leading-relaxed"
  }, "\u203B \u6BCF\u6B21\u65BC\u767B\u5165\u756B\u9762\u9078\u64C7\u8EAB\u5206\u3001\u6216\u91CD\u65B0\u6574\u7406\uFF0F\u91CD\u958B\u5206\u9801\u81EA\u52D5\u9084\u539F\u767B\u5165\uFF0C\u7686\u8A08\u4E00\u6B21\u3002\u7E3D\u7D2F\u8A08\uFF08\u542B\u66F4\u65E9\u671F\u9593\uFF09\uFF1A", stats.total, " \u6B21\u3002"))), /*#__PURE__*/React.createElement("div", {
    className: "p-4 bg-slate-100 border-t border-slate-300"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    className: "w-full py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs rounded-xl transition"
  }, "\u95DC\u9589\u9762\u677F"))));
}

// 瀏覽權限規則的條件欄位定義(投影友善:400 級實線邊框+700/800 級文字)
// 同一條規則內有填的欄位「全部符合」才通過(AND);多條規則之間「任一符合」即放行(OR)
const RULE_FIELDS = [{
  key: 'empno',
  label: '工號',
  ph: '如 00058897',
  chip: 'bg-amber-100 text-amber-800 border-amber-400'
}, {
  key: 'deptName',
  label: 'DEPTNAME',
  ph: '如 12A_PTI/ESI/MSD',
  chip: 'bg-rose-100 text-rose-800 border-rose-400'
}, {
  key: 'dept1',
  label: 'DEPT_1',
  ph: '如 12A_PTI',
  chip: 'bg-sky-100 text-sky-800 border-sky-400'
}, {
  key: 'dept2',
  label: 'DEPT_2',
  ph: '如 ESI',
  chip: 'bg-teal-100 text-teal-800 border-teal-400'
}, {
  key: 'dept3',
  label: 'DEPT_3',
  ph: '如 MSD',
  chip: 'bg-indigo-100 text-indigo-800 border-indigo-400'
}];

// 主管:瀏覽權限卡控面板 — 總開關 + 允許規則(部門/工號白名單,任一符合即放行) + 工號測試
// 資料來源:登入者工號比對 [WEB].[dbo].[notes_person] 名冊的 DEPT_1/2/3;規則存 Gantt DB 的 AccessRules(遷移 11)
function AccessPanel({
  currentUser,
  role,
  empId,
  showToast,
  onClose
}) {
  const focus = useModalFocus(); // 開啟時焦點移入、Tab 鎖在視窗內、關閉時還原
  const [enabled, setEnabled] = useState(false);
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [ruleForm, setRuleForm] = useState({
    empno: '',
    deptName: '',
    dept1: '',
    dept2: '',
    dept3: ''
  }); // 任填 ≥1 欄,填多欄=全部符合才通過(AND)
  const [ruleNote, setRuleNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [testId, setTestId] = useState('');
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const d = await apiGet('/api/access-rules');
      setEnabled(!!d.enabled);
      setRules(d.rules || []);
    } catch (e) {
      setLoadError(e.message || '載入失敗');
    } finally {
      setLoading(false);
    }
  };
  React.useEffect(() => {
    load();
  }, []);

  // 規則物件 → 「欄位=值 且 …」描述文字(清單顯示與 toast 用)
  const ruleDesc = r => RULE_FIELDS.filter(f => r[f.key]).map(f => `${f.label}=${r[f.key]}`).join(' 且 ');
  const addRule = async () => {
    if (saving) return;
    const cond = {};
    RULE_FIELDS.forEach(f => {
      const v = (ruleForm[f.key] || '').trim();
      if (v) cond[f.key] = v;
    });
    if (Object.keys(cond).length === 0) {
      showToast('❌ 至少填寫一個條件欄位（工號或部門）');
      return;
    }
    setSaving(true);
    try {
      await apiPost('/api/access-rule', {
        ...cond,
        note: ruleNote.trim() || null,
        actor: currentUser,
        actorRole: role
      });
      setRuleForm({
        empno: '',
        deptName: '',
        dept1: '',
        dept2: '',
        dept3: ''
      });
      setRuleNote('');
      showToast(`✅ 已新增允許規則：${ruleDesc(cond)}`);
      await load();
    } catch (e) {
      showToast('❌ 新增失敗：' + (e.message || '無法連線資料庫'));
    } finally {
      setSaving(false);
    }
  };
  const deleteRule = async r => {
    try {
      await apiPost('/api/access-rule/delete', {
        ruleId: r.id,
        actor: currentUser,
        actorRole: role
      });
      showToast(`🗑️ 已刪除規則：${ruleDesc(r)}`);
      await load();
    } catch (e) {
      showToast('❌ 刪除失敗：' + (e.message || '無法連線資料庫'));
    }
  };
  const toggle = async () => {
    if (toggling) return;
    setToggling(true);
    try {
      if (!enabled) {
        // 開啟前保險:先用主管自己的工號跑一次規則,不通過就擋下,避免主管把自己鎖在門外
        const me = await apiGet(`/api/access-check?empId=${encodeURIComponent(empId || '')}&preview=true`);
        if (!me.allowed) {
          showToast(`❌ 無法開啟卡控：您目前的工號（${empId || '無法取得'}）不符合任何允許規則，開啟後您自己也會被擋在門外。請先把自己的部門或工號加入規則。`);
          return;
        }
      }
      await apiPost('/api/settings/access-control', {
        enabled: !enabled,
        actor: currentUser,
        actorRole: role
      });
      setEnabled(!enabled);
      showToast(!enabled ? '🔒 已開啟瀏覽權限卡控，之後進站的訪客將依規則驗證' : '🔓 已關閉瀏覽權限卡控，所有人皆可瀏覽');
    } catch (e) {
      showToast('❌ 切換失敗：' + (e.message || '無法連線資料庫'));
    } finally {
      setToggling(false);
    }
  };
  const runTest = async () => {
    if (testing) return;
    const id = testId.trim();
    if (!id) {
      showToast('❌ 請輸入要測試的工號');
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await apiGet(`/api/access-check?empId=${encodeURIComponent(id)}&preview=true`));
    } catch (e) {
      showToast('❌ 測試失敗：' + (e.message || '無法連線資料庫'));
    } finally {
      setTesting(false);
    }
  };
  return /*#__PURE__*/React.createElement("div", _extends({}, focus, {
    className: "fixed inset-0 bg-slate-900/40 backdrop-blur-sm modal-scrim z-[105] flex justify-end"
  }), /*#__PURE__*/React.createElement("div", {
    className: "w-full max-w-md bg-white h-full shadow-2xl flex flex-col",
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("div", {
    className: "px-5 py-4 text-white flex justify-between items-center",
    style: {
      backgroundColor: '#9F1239'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h3", {
    className: "font-bold text-lg",
    style: {
      color: '#FFFFFF'
    }
  }, "\uD83D\uDD10 \u9801\u9762\u700F\u89BD\u6B0A\u9650"), /*#__PURE__*/React.createElement("p", {
    className: "text-xs mt-0.5",
    style: {
      color: '#FECDD3'
    }
  }, "\u4F9D\u4EBA\u54E1\u540D\u518A\u90E8\u9580(DEPT_1/2/3)\u6216\u5DE5\u865F\u767D\u540D\u55AE\u5361\u63A7\uFF0C\u4EFB\u4E00\u898F\u5247\u7B26\u5408\u5373\u53EF\u700F\u89BD")), /*#__PURE__*/React.createElement(CloseButton, {
    onClick: onClose,
    className: "text-white/70 hover:text-white p-1"
  })), /*#__PURE__*/React.createElement("div", {
    className: "flex-1 overflow-y-auto p-5 space-y-5"
  }, loading ? /*#__PURE__*/React.createElement("div", {
    className: "text-center text-slate-500 py-10"
  }, "\u8F09\u5165\u4E2D\u2026") : loadError ? /*#__PURE__*/React.createElement("div", {
    className: "bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm font-bold"
  }, "\u274C \u8F09\u5165\u5931\u6557\uFF1A", loadError, /*#__PURE__*/React.createElement("button", {
    onClick: load,
    className: "ml-2 underline"
  }, "\u91CD\u8A66")) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: `rounded-xl border p-4 ${enabled ? 'bg-rose-50 border-rose-300' : 'bg-slate-100 border-slate-300'}`
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "text-sm font-black text-slate-800"
  }, enabled ? '🔒 卡控啟用中' : '🔓 目前未卡控'), /*#__PURE__*/React.createElement("div", {
    className: "text-xs text-slate-500 mt-1"
  }, enabled ? '不符合規則的訪客會看到「無權限」畫面' : '所有人皆可瀏覽；設定好規則後再開啟')), /*#__PURE__*/React.createElement("button", {
    onClick: toggle,
    disabled: toggling,
    className: `px-4 py-2 rounded-lg text-xs font-bold border shadow-sm transition text-white disabled:opacity-60 ${enabled ? 'bg-slate-500 hover:bg-slate-600 border-slate-600' : 'bg-rose-600 hover:bg-rose-700 border-rose-700'}`
  }, toggling ? '切換中…' : enabled ? '關閉卡控' : '開啟卡控')), enabled && /*#__PURE__*/React.createElement("div", {
    className: "mt-2.5 text-[11px] font-bold text-rose-800 bg-rose-100 border border-rose-300 rounded-lg px-2.5 py-1.5"
  }, "\u26A0\uFE0F \u4FEE\u6539\u898F\u5247\u7ACB\u5373\u751F\u6548\u65BC\u300C\u4E0B\u4E00\u6B21\u9032\u7AD9/\u91CD\u65B0\u6574\u7406\u300D\uFF1B\u5DF2\u5728\u700F\u89BD\u4E2D\u7684\u4F7F\u7528\u8005\u4E0D\u6703\u88AB\u4E2D\u9014\u8E22\u51FA\u3002")), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-black text-slate-500 uppercase tracking-wider mb-2"
  }, "\u2795 \u65B0\u589E\u5141\u8A31\u898F\u5247"), /*#__PURE__*/React.createElement("div", {
    className: "bg-white border border-slate-300 rounded-xl p-3.5 space-y-2.5 shadow-sm"
  }, /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-2 gap-2"
  }, RULE_FIELDS.map(f => /*#__PURE__*/React.createElement("label", {
    key: f.key,
    className: f.key === 'deptName' ? 'col-span-1' : ''
  }, /*#__PURE__*/React.createElement("span", {
    className: "block text-[10px] font-bold text-slate-500 mb-0.5"
  }, f.label), /*#__PURE__*/React.createElement("input", {
    type: "text",
    value: ruleForm[f.key],
    onChange: e => setRuleForm(prev => ({
      ...prev,
      [f.key]: e.target.value
    })),
    onKeyDown: e => {
      if (e.key === 'Enter' && !isComposingEvent(e)) addRule();
    },
    placeholder: f.ph,
    className: "w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-rose-500"
  }))), /*#__PURE__*/React.createElement("label", null, /*#__PURE__*/React.createElement("span", {
    className: "block text-[10px] font-bold text-slate-500 mb-0.5"
  }, "\u5099\u8A3B\uFF08\u9078\u586B\uFF09"), /*#__PURE__*/React.createElement("input", {
    type: "text",
    value: ruleNote,
    onChange: e => setRuleNote(e.target.value),
    onKeyDown: e => {
      if (e.key === 'Enter' && !isComposingEvent(e)) addRule();
    },
    placeholder: "\u5982\uFF1AMSD \u5168\u54E1",
    className: "w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-rose-500"
  }))), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex-1 text-[11px] text-slate-500 leading-snug"
  }, "\u4EFB\u586B\u4E00\u6B04\u4EE5\u4E0A\uFF1B", /*#__PURE__*/React.createElement("span", {
    className: "font-bold text-slate-600"
  }, "\u540C\u4E00\u689D\u898F\u5247\u5167\u586B\u591A\u500B\u6B04\u4F4D\uFF1D\u5168\u90E8\u7B26\u5408\u624D\u901A\u904E\uFF08\u4E14\uFF09"), "\uFF0C \u591A\u689D\u898F\u5247\u4E4B\u9593\u4EFB\u4E00\u7B26\u5408\u5373\u653E\u884C\uFF08\u6216\uFF09\u3002\u53EA\u586B\u5DE5\u865F\uFF1D\u767D\u540D\u55AE\u76F4\u63A5\u653E\u884C\uFF08\u4E0D\u67E5\u540D\u518A\uFF09\u3002"), /*#__PURE__*/React.createElement("button", {
    onClick: addRule,
    disabled: saving,
    className: "flex-shrink-0 px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 border border-rose-700 shadow-sm disabled:opacity-60"
  }, saving ? '儲存中…' : '新增')))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-black text-slate-500 uppercase tracking-wider mb-2"
  }, "\uD83D\uDCDC \u76EE\u524D\u5141\u8A31\u898F\u5247\uFF08", rules.length, " \u689D\uFF0C\u4EFB\u4E00\u7B26\u5408\u5373\u653E\u884C\uFF09"), rules.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "bg-yellow-50 border border-yellow-300 text-yellow-800 rounded-xl p-4 text-xs font-bold"
  }, "\u5C1A\u672A\u8A2D\u5B9A\u4EFB\u4F55\u898F\u5247\u3002", enabled ? '⚠️ 卡控啟用中且無規則＝全部擋下！' : '請先新增規則再開啟卡控。') : /*#__PURE__*/React.createElement("div", {
    className: "space-y-2"
  }, rules.map(r => /*#__PURE__*/React.createElement("div", {
    key: r.id,
    className: "bg-white border border-slate-300 rounded-xl px-3 py-2 shadow-sm"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-1 flex-wrap min-w-0"
  }, RULE_FIELDS.filter(f => r[f.key]).map((f, i) => /*#__PURE__*/React.createElement(React.Fragment, {
    key: f.key
  }, i > 0 && /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] font-black text-slate-500"
  }, "\u4E14"), /*#__PURE__*/React.createElement("span", {
    className: `px-2 py-0.5 rounded text-[10px] font-bold border whitespace-nowrap ${f.chip}`
  }, f.label, "\uFF1D", r[f.key])))), /*#__PURE__*/React.createElement("span", {
    className: "ml-auto flex-shrink-0 text-[10px] text-slate-500",
    title: `建立者 ${r.createdBy || '-'}`
  }, r.createdAt), /*#__PURE__*/React.createElement("button", {
    onClick: () => deleteRule(r),
    className: "flex-shrink-0 p-1 rounded text-red-500 hover:bg-red-50 border border-transparent hover:border-red-200 transition",
    title: "\u522A\u9664\u6B64\u898F\u5247"
  }, "\uD83D\uDDD1")), r.note && /*#__PURE__*/React.createElement("div", {
    className: "text-xs text-slate-500 mt-1 truncate",
    title: r.note
  }, "\uD83D\uDCDD ", r.note))))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-black text-slate-500 uppercase tracking-wider mb-2"
  }, "\uD83E\uDDEA \u4EE5\u5DE5\u865F\u6E2C\u8A66\u898F\u5247\uFF08\u4E0D\u53D7\u7E3D\u958B\u95DC\u5F71\u97FF\uFF09"), /*#__PURE__*/React.createElement("div", {
    className: "bg-slate-100 border border-slate-300 rounded-xl p-3.5 space-y-2.5"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex gap-2"
  }, /*#__PURE__*/React.createElement("input", {
    type: "text",
    value: testId,
    onChange: e => {
      setTestId(e.target.value);
      setTestResult(null);
    },
    onKeyDown: e => {
      if (e.key === 'Enter' && !isComposingEvent(e)) runTest();
    },
    placeholder: `輸入工號，如 ${empId || '00058897'}`,
    className: "flex-1 min-w-0 border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm font-mono outline-none focus:border-rose-500"
  }), /*#__PURE__*/React.createElement("button", {
    onClick: runTest,
    disabled: testing,
    className: "flex-shrink-0 px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-slate-700 hover:bg-slate-800 border border-slate-800 shadow-sm disabled:opacity-60"
  }, testing ? '測試中…' : '測試')), testResult && /*#__PURE__*/React.createElement("div", {
    className: `rounded-lg border p-3 text-xs font-bold ${testResult.allowed ? 'bg-green-50 border-green-300 text-green-800' : 'bg-red-50 border-red-300 text-red-700'}`
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-sm"
  }, testResult.allowed ? '✅ 可以瀏覽' : '🚫 會被擋下'), testResult.person && /*#__PURE__*/React.createElement("div", {
    className: "mt-1 font-medium text-slate-600"
  }, testResult.person.name, testResult.person.ename ? `（${testResult.person.ename}）` : '', "\u30FB", testResult.person.deptname || [testResult.person.dept1, testResult.person.dept2, testResult.person.dept3].filter(Boolean).join(' / ') || '無部門資料'), testResult.reason && /*#__PURE__*/React.createElement("div", {
    className: "mt-1 font-medium"
  }, testResult.reason)))))), /*#__PURE__*/React.createElement("div", {
    className: "p-4 bg-slate-100 border-t border-slate-300"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    className: "w-full py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs rounded-xl transition"
  }, "\u95DC\u9589\u9762\u677F"))));
}

// 主管:成員管理面板(新增/移除成員;移除為軟刪除 IsActive=0,名下仍有專案時後端會擋下)
function MemberPanel({
  users,
  projects,
  year,
  onAdd,
  onRename,
  onDelete,
  onClose
}) {
  const focus = useModalFocus(); // 開啟時焦點移入、Tab 鎖在視窗內、關閉時還原
  useModalDirtyReset(); // 16 個彈窗裡原本只有這個沒掛:打到一半的成員姓名按 ESC 會直接消失,與其他表單不一致
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null); // {old, value, error} — 行內編輯成員名稱
  const [renaming, setRenaming] = useState(false);
  const submit = async () => {
    const n = name.trim();
    if (!n) {
      setError('請輸入成員名稱');
      return;
    }
    if (users.includes(n)) {
      setError(`成員「${n}」已存在`);
      return;
    }
    setSaving(true);
    const ok = await onAdd(n);
    setSaving(false);
    if (ok) {
      setName('');
      setError('');
      clearModalDirty();
    } // 面板不關閉,旗標要自己清,否則關窗時會誤跳「放棄未儲存」
  };
  const submitRename = async () => {
    const n = (editing?.value || '').trim();
    if (!n) {
      setEditing(prev => ({
        ...prev,
        error: '成員名稱不可空白'
      }));
      return;
    }
    if (n === editing.old) {
      setEditing(null);
      clearModalDirty();
      return;
    } // 沒改,直接關閉
    if (users.includes(n)) {
      setEditing(prev => ({
        ...prev,
        error: `成員「${n}」已存在`
      }));
      return;
    }
    setRenaming(true);
    const ok = await onRename(editing.old, n);
    setRenaming(false);
    if (ok) {
      setEditing(null);
      clearModalDirty();
    }
  };
  return /*#__PURE__*/React.createElement("div", _extends({}, focus, {
    className: "fixed inset-0 bg-slate-900/40 backdrop-blur-sm modal-scrim z-[115] flex justify-end"
  }), /*#__PURE__*/React.createElement("div", {
    className: "w-full max-w-sm bg-white h-full shadow-2xl flex flex-col",
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("div", {
    className: "px-5 py-4 text-white flex justify-between items-center",
    style: {
      backgroundColor: NAVY
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h3", {
    className: "font-bold text-lg"
  }, "\uD83D\uDC65 \u6210\u54E1\u7BA1\u7406"), /*#__PURE__*/React.createElement("p", {
    className: "text-xs text-blue-200 mt-0.5"
  }, "\u65B0\u589E\u7684\u6210\u54E1\u5373\u53EF\u767B\u5165\u56DE\u5831\uFF0C\u4E26\u53EF\u70BA\u5176\u5B89\u6392\u5C08\u6848")), /*#__PURE__*/React.createElement(CloseButton, {
    onClick: onClose,
    className: "text-white/60 hover:text-white p-1"
  })), /*#__PURE__*/React.createElement("div", {
    className: "p-4 border-b border-slate-300 bg-slate-100"
  }, /*#__PURE__*/React.createElement("label", {
    className: "text-xs font-bold text-slate-500"
  }, "\u65B0\u589E\u6210\u54E1"), /*#__PURE__*/React.createElement("div", {
    className: "mt-1 flex gap-2"
  }, /*#__PURE__*/React.createElement("input", {
    value: name,
    onChange: e => {
      setName(e.target.value);
      setError('');
      markModalDirty();
    },
    onKeyDown: onEnterSubmit(submit),
    placeholder: "\u8F38\u5165\u65B0\u6210\u54E1\u986F\u793A\u540D\u7A31\u2026",
    autoFocus: true,
    className: `flex-1 border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 ${error ? 'border-red-400' : 'border-slate-300'}`
  }), /*#__PURE__*/React.createElement("button", {
    onClick: submit,
    disabled: saving,
    className: "flex-shrink-0 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-sm transition hover:opacity-90 disabled:opacity-50",
    style: {
      backgroundColor: BRAND_BTN
    }
  }, saving ? '新增中…' : '＋ 新增')), error && /*#__PURE__*/React.createElement("div", {
    className: "mt-1.5 text-xs text-red-600 font-bold"
  }, error), /*#__PURE__*/React.createElement("p", {
    className: "mt-2 text-[11px] text-slate-500 leading-relaxed"
  }, "\u65B0\u589E\u5F8C\u6210\u54E1\u6703\u51FA\u73FE\u5728\u767B\u5165\u756B\u9762\u8207\u7518\u7279\u5716\uFF0C\u53EF\u76F4\u63A5\u70BA\u5176\u65B0\u589E\u5C08\u6848\u4E26\u958B\u59CB\u6BCF\u9031\u6253\u5361\u56DE\u5831\u3002 \u82E5\u8F38\u5165\u66FE\u88AB\u79FB\u9664\u7684\u540C\u540D\u6210\u54E1\uFF0C\u6703\u81EA\u52D5\u91CD\u65B0\u555F\u7528\u4E26\u9084\u539F\u5176\u6B77\u53F2\u8CC7\u6599\u3002")), /*#__PURE__*/React.createElement("div", {
    className: "flex-1 overflow-y-auto p-4 space-y-2"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-bold text-slate-500 mb-1"
  }, "\u73FE\u6709\u6210\u54E1\uFF08", users.length, " \u4F4D\uFF09"), users.map(u => {
    const projCount = projects.filter(p => p.owner === u).length;
    const isEditing = editing?.old === u;
    return /*#__PURE__*/React.createElement("div", {
      key: u,
      className: "flex items-center bg-white ctl-raised border border-slate-300 rounded-xl p-3 shadow-sm"
    }, /*#__PURE__*/React.createElement("div", {
      className: "w-8 h-8 rounded-full text-white flex items-center justify-center text-sm mr-3 flex-shrink-0",
      style: {
        backgroundColor: BRAND_BTN
      }
    }, u[0]), isEditing ? /*#__PURE__*/React.createElement("div", {
      className: "flex-1 min-w-0"
    }, /*#__PURE__*/React.createElement("div", {
      className: "flex items-center gap-1.5"
    }, /*#__PURE__*/React.createElement("input", {
      value: editing.value,
      autoFocus: true,
      onChange: e => {
        setEditing(prev => ({
          ...prev,
          value: e.target.value,
          error: ''
        }));
        markModalDirty();
      },
      onKeyDown: e => {
        if (isComposingEvent(e)) return;
        if (e.key === 'Enter') submitRename();
        if (e.key === 'Escape') {
          setEditing(null);
          clearModalDirty();
        }
      },
      className: `flex-1 min-w-0 border rounded-lg px-2 py-1 text-sm outline-none focus:border-blue-500 ${editing.error ? 'border-red-400' : 'border-slate-300'}`
    }), /*#__PURE__*/React.createElement("button", {
      onClick: submitRename,
      disabled: renaming,
      className: "flex-shrink-0 px-2 py-1 rounded-lg text-xs font-bold text-white transition hover:opacity-90 disabled:opacity-50",
      style: {
        backgroundColor: BRAND_BTN
      }
    }, renaming ? '…' : '✓ 儲存'), /*#__PURE__*/React.createElement("button", {
      onClick: () => setEditing(null),
      className: "flex-shrink-0 px-2 py-1 rounded-lg text-xs font-bold text-slate-500 bg-slate-100 hover:bg-slate-200 transition"
    }, "\u2715")), editing.error ? /*#__PURE__*/React.createElement("div", {
      className: "mt-1 text-[11px] text-red-600 font-bold"
    }, editing.error) : /*#__PURE__*/React.createElement("div", {
      className: "mt-1 text-[11px] text-slate-500"
    }, "\u6539\u540D\u5F8C\u5176\u5C08\u6848\u8207\u6B77\u53F2\u56DE\u5831\u81EA\u52D5\u8DDF\u96A8\u65B0\u540D\u7A31")) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
      className: "flex-1 min-w-0"
    }, /*#__PURE__*/React.createElement("div", {
      className: "font-bold text-sm text-slate-700 truncate"
    }, u), /*#__PURE__*/React.createElement("div", {
      className: "text-[11px] text-slate-500"
    }, year, " \u5E74\u5EA6\u5C08\u6848 ", projCount, " \u9805")), /*#__PURE__*/React.createElement("button", {
      onClick: () => setEditing({
        old: u,
        value: u,
        error: ''
      }),
      className: "flex-shrink-0 mr-1.5 px-2.5 py-1 rounded-lg text-xs font-bold text-blue-600 bg-blue-50 border border-blue-200 hover:bg-blue-100 transition",
      title: "\u7DE8\u8F2F\u6210\u54E1\u540D\u7A31"
    }, "\u270E \u7DE8\u8F2F"), /*#__PURE__*/React.createElement("button", {
      onClick: () => onDelete(u),
      className: "flex-shrink-0 px-2.5 py-1 rounded-lg text-xs font-bold text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 transition",
      title: projCount > 0 ? '名下仍有專案，需先刪除或改派專案才能移除' : '移除成員（軟刪除，歷史回報保留）'
    }, "\u79FB\u9664")));
  }), users.length === 0 && /*#__PURE__*/React.createElement("div", {
    className: "text-center text-slate-500 py-10 text-sm"
  }, "\u5C1A\u7121\u6210\u54E1\uFF0C\u8ACB\u65BC\u4E0A\u65B9\u65B0\u589E\u3002"))));
}

// 近 n 天的日期字串(yyyy-MM-dd,本地時區):快捷鈕用
const daysAgoStr = n => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const AUDIT_TOP = 300;
function AuditPanel({
  onClose
}) {
  const focus = useModalFocus(); // 開啟時焦點移入、Tab 鎖在視窗內、關閉時還原
  const [logs, setLogs] = useState(null); // null=載入中
  const [actors, setActors] = useState([]);
  const [matched, setMatched] = useState(0); // 符合條件的總筆數(可能大於實際載入的 300 筆)
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  // 伺服器端條件:改變時重新查詢(關鍵字仍是前端即時過濾,見下方說明)
  const [cond, setCond] = useState({
    from: '',
    to: '',
    actor: '',
    action: '',
    entityType: ''
  });
  const setC = (k, v) => setCond(prev => ({
    ...prev,
    [k]: v
  }));
  const hasCond = !!(cond.from || cond.to || cond.actor || cond.action || cond.entityType);

  // ⚠ 日期/成員/動作/類型一律走**伺服器端**篩選:本端點只回最近 300 筆,
  //   若在前端過濾,查「上個月某人改了什麼」時最近 300 筆可能全是本週的 → 永遠查不到東西。
  //   關鍵字則留在前端即時過濾(打字不必每個字都打一次 API),語意是「在已篩出的結果裡再找」。
  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const qs = new URLSearchParams({
      top: String(AUDIT_TOP)
    });
    Object.entries(cond).forEach(([k, v]) => {
      if (v) qs.set(k, v);
    });
    apiGet('/api/audit-log?' + qs.toString()).then(d => {
      if (cancelled) return; // 快速連按條件時,舊回應不可覆蓋新結果
      setLogs(d.logs || []);
      setMatched(d.matched ?? (d.logs || []).length);
      if (d.actors) setActors(d.actors);
      setError(null);
    }).catch(e => {
      if (!cancelled) setError(e.message || '無法連線資料庫');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [cond]);
  const shown = useMemo(() => {
    if (!logs) return [];
    const kw = filter.trim().toLowerCase();
    if (!kw) return logs;
    return logs.filter(l => `${l.actor} ${l.empId || ''} ${l.action} ${l.entityType} ${l.entityId || ''} ${l.summary || ''} ${l.newValue || ''} ${l.detail || ''} ${l.at}`.toLowerCase().includes(kw));
  }, [logs, filter]);
  const selectCls = "border border-slate-300 rounded-lg px-2 py-1 text-[11px] bg-white outline-none focus:border-blue-500 min-w-0";
  return /*#__PURE__*/React.createElement("div", _extends({}, focus, {
    className: "fixed inset-0 bg-slate-900/40 backdrop-blur-sm modal-scrim z-[115] flex justify-end"
  }), /*#__PURE__*/React.createElement("div", {
    className: "w-full max-w-lg bg-white h-full shadow-2xl flex flex-col",
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("div", {
    className: "px-5 py-4 text-white flex justify-between items-center",
    style: {
      backgroundColor: NAVY
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h3", {
    className: "font-bold text-lg"
  }, "\uD83D\uDCDC \u7570\u52D5\u7D00\u9304"), /*#__PURE__*/React.createElement("p", {
    className: "text-xs text-blue-200 mt-0.5"
  }, "\u64CD\u4F5C\u7A3D\u6838\uFF08\u8AB0\u3001\u4F55\u6642\u3001\u505A\u4E86\u4EC0\u9EBC\uFF09")), /*#__PURE__*/React.createElement(CloseButton, {
    onClick: onClose,
    className: "text-white/60 hover:text-white p-1"
  })), /*#__PURE__*/React.createElement("div", {
    className: "p-3 border-b border-slate-300 bg-slate-100 space-y-2"
  }, /*#__PURE__*/React.createElement("input", {
    value: filter,
    onChange: e => setFilter(e.target.value),
    placeholder: "\u5728\u7BE9\u9078\u7D50\u679C\u4E2D\u641C\u5C0B\uFF1A\u4EBA\u54E1 / \u52D5\u4F5C / \u5C08\u6848 / \u5167\u5BB9\u2026",
    onKeyDown: e => {
      if (e.key === 'Escape' && filter) {
        e.stopPropagation();
        setFilter('');
      }
    },
    className: "w-full border border-slate-300 rounded-lg px-3 py-1.5 text-xs outline-none focus:border-blue-500"
  }), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-1.5 flex-wrap"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-[11px] font-bold text-slate-600 flex-shrink-0"
  }, "\u671F\u9593"), /*#__PURE__*/React.createElement("input", {
    type: "date",
    value: cond.from,
    max: cond.to || undefined,
    onChange: e => setC('from', e.target.value),
    "aria-label": "\u8D77\u59CB\u65E5\u671F",
    className: selectCls
  }), /*#__PURE__*/React.createElement("span", {
    className: "text-[11px] text-slate-500"
  }, "\u2013"), /*#__PURE__*/React.createElement("input", {
    type: "date",
    value: cond.to,
    min: cond.from || undefined,
    onChange: e => setC('to', e.target.value),
    "aria-label": "\u7D50\u675F\u65E5\u671F",
    className: selectCls
  }), [['近 7 天', 6], ['近 30 天', 29]].map(([label, d]) => /*#__PURE__*/React.createElement("button", {
    key: label,
    onClick: () => setCond(prev => ({
      ...prev,
      from: daysAgoStr(d),
      to: ''
    })),
    className: "flex-shrink-0 px-2 py-1 rounded-lg border border-slate-400 bg-white ctl-raised text-[11px] font-bold text-slate-600 hover:border-blue-500 hover:bg-blue-50 transition"
  }, label))), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-1.5 flex-wrap"
  }, /*#__PURE__*/React.createElement("select", {
    value: cond.actor,
    onChange: e => setC('actor', e.target.value),
    "aria-label": "\u64CD\u4F5C\u4EBA\u54E1",
    className: selectCls
  }, /*#__PURE__*/React.createElement("option", {
    value: ""
  }, "\u5168\u90E8\u4EBA\u54E1"), actors.map(a => /*#__PURE__*/React.createElement("option", {
    key: a,
    value: a
  }, a))), /*#__PURE__*/React.createElement("select", {
    value: cond.action,
    onChange: e => setC('action', e.target.value),
    "aria-label": "\u52D5\u4F5C\u985E\u578B",
    className: selectCls
  }, /*#__PURE__*/React.createElement("option", {
    value: ""
  }, "\u5168\u90E8\u52D5\u4F5C"), Object.entries(AUDIT_ACTION_META).map(([k, m]) => /*#__PURE__*/React.createElement("option", {
    key: k,
    value: k
  }, m.label))), /*#__PURE__*/React.createElement("select", {
    value: cond.entityType,
    onChange: e => setC('entityType', e.target.value),
    "aria-label": "\u5C0D\u8C61\u985E\u578B",
    className: selectCls
  }, /*#__PURE__*/React.createElement("option", {
    value: ""
  }, "\u5168\u90E8\u5C0D\u8C61"), Object.entries(AUDIT_ENTITY_LABELS).map(([k, label]) => /*#__PURE__*/React.createElement("option", {
    key: k,
    value: k
  }, label))), hasCond && /*#__PURE__*/React.createElement("button", {
    onClick: () => setCond({
      from: '',
      to: '',
      actor: '',
      action: '',
      entityType: ''
    }),
    className: "flex-shrink-0 px-2 py-1 rounded-lg border border-slate-400 bg-white ctl-raised text-[11px] font-bold text-blue-700 hover:border-blue-500 hover:bg-blue-50 transition"
  }, "\u6E05\u9664\u689D\u4EF6")), /*#__PURE__*/React.createElement("div", {
    className: "text-[11px] text-slate-600",
    "aria-live": "polite"
  }, loading ? '查詢中…' : error ? '' : matched > AUDIT_TOP ? /*#__PURE__*/React.createElement("span", null, "\u7B26\u5408\u689D\u4EF6 ", /*#__PURE__*/React.createElement("b", {
    className: "text-amber-800"
  }, matched), " \u7B46\uFF0C\u50C5\u986F\u793A\u6700\u8FD1 ", AUDIT_TOP, " \u7B46", filter && /*#__PURE__*/React.createElement(React.Fragment, null, "\uFF08\u95DC\u9375\u5B57\u518D\u7BE9\u51FA ", shown.length, " \u7B46\uFF09"), "\uFF0C\u8ACB\u7E2E\u5C0F\u671F\u9593\u7BC4\u570D") : /*#__PURE__*/React.createElement("span", null, "\u7B26\u5408\u689D\u4EF6 ", /*#__PURE__*/React.createElement("b", null, matched), " \u7B46", filter && /*#__PURE__*/React.createElement(React.Fragment, null, "\uFF0C\u95DC\u9375\u5B57\u518D\u7BE9\u51FA ", shown.length, " \u7B46")))), /*#__PURE__*/React.createElement("div", {
    className: "flex-1 overflow-y-auto p-3 space-y-1.5 text-xs"
  }, error ? /*#__PURE__*/React.createElement("div", {
    className: "text-red-600 bg-red-50 border border-red-100 rounded-lg p-3"
  }, error) : logs === null ? /*#__PURE__*/React.createElement("div", {
    className: "text-center text-slate-500 py-10"
  }, "\u8F09\u5165\u4E2D\u2026") : shown.length === 0 ?
  /*#__PURE__*/
  // 空結果要說清楚是「條件太窄」還是「真的沒紀錄」,並直接給收回條件的出口
  React.createElement("div", {
    className: "text-center py-10 space-y-2"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-slate-500"
  }, hasCond || filter ? '沒有符合目前篩選條件的紀錄' : '尚無異動紀錄'), (hasCond || filter) && /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setCond({
        from: '',
        to: '',
        actor: '',
        action: '',
        entityType: ''
      });
      setFilter('');
    },
    className: "px-3 py-1 rounded-lg border border-slate-400 bg-white ctl-raised text-[11px] font-bold text-blue-700 hover:border-blue-500 hover:bg-blue-50 transition"
  }, "\u6E05\u9664\u5168\u90E8\u689D\u4EF6")) : shown.map(l => {
    const meta = AUDIT_ACTION_META[l.action] || {
      label: l.action,
      cls: 'bg-slate-100 text-slate-600'
    };
    return (
      /*#__PURE__*/
      // title 保留技術識別碼(如 t101-1@2026W9),畫面上只顯示後端翻譯好的白話摘要(summary)
      React.createElement("div", {
        key: l.id,
        className: "border border-slate-300 rounded-lg p-2.5 hover:bg-slate-50",
        title: `${l.entityType}${l.entityId ? ' ' + l.entityId : ''}`
      }, /*#__PURE__*/React.createElement("div", {
        className: "flex items-center gap-2"
      }, /*#__PURE__*/React.createElement("span", {
        className: `flex-shrink-0 px-1.5 py-0.5 rounded font-bold ${meta.cls}`
      }, meta.label), /*#__PURE__*/React.createElement("span", {
        className: "font-bold text-slate-700"
      }, AUDIT_ENTITY_LABELS[l.entityType] || l.entityType), /*#__PURE__*/React.createElement("span", {
        className: "flex-shrink-0 text-slate-500 font-medium ml-1"
      }, l.actor, l.role === 'manager' ? '（主管）' : '', l.empId && /*#__PURE__*/React.createElement("span", {
        className: "ml-1 px-1 py-px rounded bg-slate-100 text-slate-500 font-mono text-[10px]",
        title: "\u64CD\u4F5C\u8005 Windows \u5DE5\u865F"
      }, l.empId)), /*#__PURE__*/React.createElement("span", {
        className: "ml-auto flex-shrink-0 text-slate-500"
      }, l.at)), /*#__PURE__*/React.createElement("div", {
        className: "mt-1 text-slate-600 break-all leading-relaxed",
        style: {
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden'
        }
      }, l.summary || l.newValue || l.detail || ''))
    );
  }))));
}
ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(App, null));
