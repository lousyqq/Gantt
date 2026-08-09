const { useState, useMemo, useRef, useCallback } = React;

// --- 1. 系統設定與時間軸定義 ---
const WEEKS_TOTAL = 52;                                 // 預設值;實際以選定年度 ScheduleWeeks 的筆數為準(52 或 53)
const DEFAULT_SCHEDULE_YEAR = new Date().getFullYear(); // 預設載入今年;實際可用年度由 bootstrap 的 years 決定

// 依今天日期計算 ISO 週數(週一為一週起始);非選定年度時夾在排程範圍內
const getTodayWeek = (scheduleYear = DEFAULT_SCHEDULE_YEAR, weeksTotal = WEEKS_TOTAL) => {
  const now = new Date();
  if (now.getFullYear() < scheduleYear) return 1;
  if (now.getFullYear() > scheduleYear) return weeksTotal;
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;          // 週一=0
  d.setUTCDate(d.getUTCDate() - dayNum + 3);        // 本週的週四
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const fDayNum = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - fDayNum + 3);
  const week = 1 + Math.round((d - firstThu) / (7 * 24 * 3600 * 1000));
  return Math.min(weeksTotal, Math.max(1, week));
};
const DEFAULT_CURRENT_WEEK = getTodayWeek();
const NAVY = '#001F5B';
// 品牌色的「按鈕」版本:深色模式下提亮成 #2563EB(見 input.css 的 --brand-btn)。
// 為什麼要分成兩個常數:NAVY 用在標題列/表頭那種大面積色塊,深色下維持深海軍藍才好看;
// 但同一個 #001F5B 拿來當「按鈕填色」時,坐在 #1E293B 的工具列/彈窗上對比只有 1.07,
// 按鈕會完全融進背景。帶 fallback 是為了快取到舊 CSS 時仍退回原色,不會變透明底配白字。
const BRAND_BTN = 'var(--brand-btn, #001F5B)';
const GOLD = '#FDD075';

// 2026 年的預設週→月對照(fallback);實際以 bootstrap 回傳的 weeks(ScheduleWeeks)為準
const MONTHS = [
  { name: '202601', weeks: 5 }, { name: '202602', weeks: 4 }, { name: '202603', weeks: 4 },
  { name: '202604', weeks: 4 }, { name: '202605', weeks: 5 }, { name: '202606', weeks: 4 },
  { name: '202607', weeks: 4 }, { name: '202608', weeks: 5 }, { name: '202609', weeks: 4 },
  { name: '202610', weeks: 4 }, { name: '202611', weeks: 5 }, { name: '202612', weeks: 4 }
];

// 將 bootstrap 的 weeks 陣列([{week, monthName, monthLabel}, ...])聚合成 MONTHS 形式
const groupWeeksToMonths = (weeks) => {
  const out = [];
  for (const w of weeks) {
    const last = out[out.length - 1];
    if (last && last.name === w.monthName) last.weeks++;
    else out.push({ name: w.monthName, weeks: 1 });
  }
  return out;
};

// 類型標籤:邊框用 400/500 深階(投影機對比打折,300 級邊框在布幕上會消失)
const PROJECT_TYPES = {
  'a': { label: '一級專案/KPI', chip: 'bg-pink-100 text-pink-800 border-pink-400', dot: 'bg-pink-500' },
  'b': { label: '重大貢獻及亮點', chip: 'bg-yellow-100 text-yellow-800 border-yellow-500', dot: 'bg-yellow-500' },
  'c': { label: '日常管理', chip: 'bg-teal-100 text-teal-800 border-teal-400', dot: 'bg-teal-500' },
  'd': { label: '其他加分項', chip: 'bg-orange-100 text-orange-800 border-orange-400', dot: 'bg-orange-500' },
  'e': { label: '主管交辦', chip: 'bg-purple-100 text-purple-800 border-purple-400', dot: 'bg-purple-500' }
};

// 狀態色加深(範本 B 高對比):白字在色塊上達 WCAG AA,年長使用者更易辨識
// dot＝甘特條上的週回報小點(坐在淺色計畫區間上,需要 700 級才壓得住);
// fill＝團隊看板成員列的分段進度條——700 級整條又暗又悶,改用「淺色 600／深色 500」:
//   淺色坐在白色空槽上,600 級清爽又守得住對比(green 3.28／sky 4.07／slate 4.76);
//   深色坐在近黑空槽上,500 級才明亮舒服(green 7.96／sky 6.52／slate-500 3.75)。
//   ⚠ 不可只寫 600:`.dark .bg-green-600` 是給「實心動作按鈕」加深用的(→#166534),
//     不加 dark: 變體會被壓成墨綠;`bg-slate-400` 深色同理被壓成 #475569(對比 2.41),故未執行兩邊都用 500。
const STATUS_META = {
  executed:     { label: '有執行', icon: '✅', bar: 'bg-green-700 border-green-800 text-white', tag: 'bg-green-100 text-green-800', dot: 'bg-green-700', fill: 'bg-green-600 dark:bg-green-500' },
  monitor:      { label: 'Monitor', icon: '👁️', bar: 'bg-sky-700 border-sky-800 text-white', tag: 'bg-sky-100 text-sky-800', dot: 'bg-sky-700', fill: 'bg-sky-600 dark:bg-sky-500' },
  not_executed: { label: '未執行', icon: '⏸️', bar: 'bg-slate-500 border-slate-600 text-white', tag: 'bg-slate-200 text-slate-700', dot: 'bg-slate-500', fill: 'bg-slate-500' }
};
// 分段條的軌道(空槽):加外框才看得出「這是一個空容器＝0%」而不是元件沒畫出來。
// 「未回報」刻意**不畫任何填充**——條填多少＝回報多少,是最直覺的讀法;
// 「未執行」則是實心 slate-500(有回報、只是本週沒做),實心 vs 空槽對比 3.21,不會再被誤讀成「沒交」。
// (曾用黃黑警示斜紋表示未回報,但週中「還沒回報」本來就是常態,整片警示反而讓真正的警訊失效)
// 空槽:淺色用**白**(原本 slate-300 中灰,配 700 級填色整條又暗又悶);深色壓到近黑 slate-900
// (用 slate-700 時「未執行實心 slate-500」對空槽只有 2.18,分不出有填沒填;壓暗後 3.80)。
// 軌道與列底同色沒關係——外框(淺 3.86／深 3.07)負責界定「這是一個空容器」。
const BAR_TRACK = 'bg-white dark:bg-slate-900 border border-slate-500';

// --- 2. 資料來源:改由後端 API 讀寫 Gantt 資料庫 (取代原本寫死的 INITIAL_PROJECTS) ---
// 自動偵測部署根路徑:本地為 ''(→ /api/...)、IIS 子應用程式(如 /Gantt/)則為 '/Gantt'(→ /Gantt/api/...)
// 作法:取目前頁面 pathname,去掉檔名(如 index.html)與結尾斜線,即為 app 的虛擬目錄前綴
const API_BASE = window.location.pathname
  .replace(/\/[^/]*\.[^/]*$/, '')   // 去掉 /index.html 之類的檔名
  .replace(/\/+$/, '');             // 去掉結尾斜線 → '/' 變 ''、'/Gantt/' 變 '/Gantt'

// 後端錯誤回應為 ProblemDetails JSON,解析出 detail/title 顯示;非 JSON 則顯示原文
async function readApiError(res) {
  const text = await res.text().catch(() => '');
  try {
    const j = JSON.parse(text);
    return j.detail || j.title || text;
  } catch { return text; }
}
// opts.timeoutMs:逾時後主動中止並丟出。
// 只有「畫面被單一請求擋住」的地方需要它(目前是 access-check 的權限閘門)——
// fetch 對「連上了但伺服器不回應」(例:IIS 正在回收)不會 reject,會一直掛著,catch 永遠等不到,
// 沒有逾時的話畫面就**永久停在載入中且無任何提示**。
async function apiGet(path, opts = {}) {
  const ctrl = opts.timeoutMs ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), opts.timeoutMs) : null;
  try {
    const res = await fetch(API_BASE + path, { headers: { 'Accept': 'application/json' }, signal: ctrl ? ctrl.signal : undefined });
    if (!res.ok) throw new Error((await readApiError(res)) || ('HTTP ' + res.status));
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
  try { return JSON.parse(localStorage.getItem('gantt_prefs') || '{}') || {}; } catch (e) { return {}; }
}
function savePref(key, value) {
  try { const p = readPrefs(); p[key] = value; localStorage.setItem('gantt_prefs', JSON.stringify(p)); } catch (e) {}
}

let CURRENT_EMP_ID = null;
async function detectEmpId() {
  try {
    const d = await apiGet('/api/whoami');
    CURRENT_EMP_ID = d.empId || null;
  } catch { CURRENT_EMP_ID = null; }   // 401(非網域/無法驗證)→ 靜默忽略
  return CURRENT_EMP_ID;
}

async function apiPost(path, body) {
  const res = await fetch(API_BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actorEmpId: CURRENT_EMP_ID, ...body })
  });
  if (!res.ok) throw new Error((await readApiError(res)) || ('HTTP ' + res.status));
  return res.json();
}

// 平滑捲動+保底:部分環境(嵌入式瀏覽器/舊核心)的 smooth 動畫會靜默失效,
// 250ms 內未位移就改用瞬間捲動,確保「回到本週/方向鍵平移/到期定位」在任何瀏覽器都有效
const smoothScrollLeftTo = (el, left) => {
  if (!el) return;
  const from = el.scrollLeft;
  const target = Math.max(0, left);
  el.scrollTo({ left: target, behavior: 'smooth' });
  setTimeout(() => {
    if (Math.abs(el.scrollLeft - from) < 1 && Math.abs(target - from) >= 1) el.scrollTo(target, el.scrollTop);
  }, 250);
};

// --- 版面自適應(投影機/低解析度筆電) ---
// 投影會議實測:1366×768 下「凍結欄 490 + 團隊看板 672」就吃掉 85% 畫面寬,中間甘特圖幾乎不剩。
// 故凍結欄(專案名稱)與看板寬度改為隨視窗等比縮放:1920 時算出來剛好＝原本的 420 / 672(現有畫面不變),
// 窄螢幕則同步縮小,讓「專案資訊:甘特圖:看板」永遠維持約 1 : 1.5 : 1.4 的比例。
const useViewportWidth = () => {
  const [vw, setVw] = useState(() => (typeof window === 'undefined' ? 1920 : window.innerWidth));
  React.useEffect(() => {
    let timer = null;   // 拖曳改視窗大小會連續觸發,150ms 去抖避免整張甘特反覆重算
    const onResize = () => { clearTimeout(timer); timer = setTimeout(() => setVw(window.innerWidth), 150); };
    window.addEventListener('resize', onResize);
    return () => { clearTimeout(timer); window.removeEventListener('resize', onResize); };
  }, []);
  return vw;
};
// 成員下拉的登入預設值:成員=只看自己、主管=全部成員。三個檢視共用同一個 ownerFilter,
// 登入／登出／關閉團隊看板都回到這個值,避免各處各寫一份而漂移。
const defaultOwnerFilter = (role, user) => (role === 'member' && user ? user : 'all');

const STICKY_LEAD_W = 70;                                                              // 凍結欄前兩格:No(28)+分類(42)
const nameColWidth = (vw) => Math.round(Math.min(420, Math.max(200, vw * 0.22)));       // 專案名稱欄(1920→420=原值)
// 團隊看板(1920→672=原 max-w-2xl);下限 400=成員列放得下「條＋得分＋兩顆有文字的按鈕」的最小寬度
const reportPanelWidth = (vw) => Math.round(Math.min(672, Math.max(400, vw * 0.35)));

// 兩條工具列「全部控制項攤開」所需的自然寬度(實測值,主管+週檢視=最寬的情況)。
// 主內容區可用寬(availW)低於它就必須收起「找資料」那組,否則 flex-nowrap + overflow-x-auto
// 會吐出橫向捲軸——實測 概況列 1188、控制列 1338,故 1280 溢出 58、1024 溢出 164/314。
// ⚠ 原本收控制項**只看看板是否開啟**,完全不看視窗本身多寬 → 1366 以下的筆電/投影機一律中招,
//   而這正是本專案最在意的環境(看板沒開時反而沒有任何保護)。
// ⚠ 兩條分開設門檻,不要合成一個:概況列只要 1188,若跟著控制列的 1345 一起收,
//   1280 會白白失去還放得下的全隊狀態晶片。
// ⚠ 值可略高於實測值留餘裕(中文字寬會隨字體載入狀態浮動),但**絕不可高到 1366 也被收**:
//   1366 是投影機基準解析度,它放得下完整工具列,收掉只會讓投影情境比現在更差。
const STATS_BAR_FULL_W = 1200;   // 第一條:概況數字＋全隊狀態晶片＋圖例＋鍵盤提示
const TOOLBAR_FULL_W = 1345;     // 第二條:搜尋框＋a~e 晶片＋成員/年度/檢視/密度/補登/展開收合
// 年度總覽的週欄保底寬度:名稱欄要加寬到多少,先由這個值倒推。
// 20px＝兩位數週次在 9px 字級下仍清楚可讀(低於 16px 才需要改成間隔標示),
// 也確保「整年 53 週一畫面」這個核心前提不被名稱欄吃掉。
// ⚠ 別調高:22px 時 1366(投影)算出來只剩 200px 給名稱欄、低於下限 240 → 投影環境完全得不到改善;
//   20px 才讓 1366 也能把名稱欄從 240 撐到 300,而週欄只從 21.1 掉到 20.1。
const MIN_OVERVIEW_WEEK_W = 20;

// 彈窗「未儲存內容」旗標:表單型視窗(打卡/非專案/下週預計/產出/專案/區間)輸入時設 true、
// 視窗卸載時自動清除;ESC 關窗前檢查,避免打到一半的內容被默默丟棄
let MODAL_DIRTY = false;
const markModalDirty = () => { MODAL_DIRTY = true; };
// 表單型視窗掛載時呼叫:卸載(不論儲存或取消)自動重置旗標
const useModalDirtyReset = () => {
  React.useEffect(() => () => { MODAL_DIRTY = false; }, []);
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
const isComposingEvent = (e) => !!(e && (e.nativeEvent ? e.nativeEvent.isComposing : e.isComposing));

const onEnterSubmit = (fn) => (e) => {
  if (e.key !== 'Enter' || isComposingEvent(e)) return;
  e.preventDefault();
  fn();
};

// 必填欄位標記:沿用「本週回報中心」既有的紅色必填語彙,讓使用者填之前就知道,而不是按了送出才被擋
const ReqMark = () => <span className="text-red-600 font-black ml-0.5" title="必填欄位">*</span>;

// 彈窗/側邊面板右上角的關閉鈕(全站 16 處原本各自複製同一段 SVG)。
// 抽成元件的原因不只是去重:圖示鈕沒有任何文字,少了 aria-label 讀螢幕器只會念「按鈕」,
// 使用者不知道那是關閉還是刪除;集中在一處才不會下次新增彈窗又漏掉。
// SVG 本身掛 aria-hidden——它是純裝飾,語意由 aria-label 提供,否則會被重複朗讀。
const CloseButton = ({ onClick, className = 'text-white/70 hover:text-white p-1', label = '關閉' }) => (
  <button onClick={onClick} aria-label={label} title={label} className={className}>
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  </button>
);

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
    onKeyDown: (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      onActivate(e);
    },
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
    props.onKeyDown = (e) => {
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
const WeekNumberInput = ({ week, min = 1, max, onCommit, label }) => {
  const [draft, setDraft] = useState(String(week));
  // 外部切週(‹ ›、H、點週次列)時同步顯示值;使用者正在輸入時不覆蓋
  const focusedRef = useRef(false);
  React.useEffect(() => { if (!focusedRef.current) setDraft(String(week)); }, [week]);
  const commit = () => {
    const n = parseInt(draft, 10);
    if (isNaN(n)) { setDraft(String(week)); return; }
    const clamped = Math.min(max, Math.max(min, n));
    setDraft(String(clamped));
    if (clamped !== week) onCommit(clamped);
  };
  return (
    <span className="font-bold text-sm tracking-wider inline-flex items-center justify-center" style={{ color: GOLD, minWidth: 100 }}>
      W
      <input type="number" inputMode="numeric" min={min} max={max} value={draft}
        aria-label={label} title={label}
        onFocus={e => { focusedRef.current = true; e.target.select(); }}
        onBlur={() => { focusedRef.current = false; commit(); }}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (isComposingEvent(e)) return;
          if (e.key === 'Enter') { e.preventDefault(); commit(); e.currentTarget.blur(); }
          if (e.key === 'Escape') { setDraft(String(week)); e.currentTarget.blur(); }
        }}
        className="week-input w-9 bg-transparent border-0 border-b border-dashed border-white/40 hover:border-white/80 focus:border-solid text-center font-bold text-sm tracking-wider p-0 outline-none"
        style={{ color: GOLD }} />
    </span>
  );
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
      if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
    }, 0);
    return () => {
      clearTimeout(t);
      try { if (prev && document.contains(prev)) prev.focus({ preventScroll: true }); } catch (e) {}
    };
  }, []);
  const onKeyDown = (e) => {
    if (e.key !== 'Tab') return;
    const el = ref.current;
    if (!el) return;
    const items = [...el.querySelectorAll(FOCUSABLE_SEL)].filter(n => n.offsetParent !== null);
    if (!items.length) { e.preventDefault(); return; }   // 無可聚焦元素:焦點留在容器,不放行到背景
    const first = items[0], last = items[items.length - 1];
    const inside = items.includes(document.activeElement);
    if (!inside) { e.preventDefault(); (e.shiftKey ? last : first).focus(); return; }   // 焦點在容器本身
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  return { ref, onKeyDown, tabIndex: -1 };
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
function ResultsView({ projects, role, currentUser, year, starredIds = new Set(), toggleStar }) {
  const [filterMode, setFilterMode] = useState('all');   // 'all' | 'starred' | 'hasMp' | 'hasDeliverable' | 'missing'
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' }); // key: 'category' | 'name' | 'owner' | 'deliverable' | 'mpSaving'
  const [exporting, setExporting] = useState(false);      // 匯出 Excel 防連點 + 進度回饋
  const [exportFailed, setExportFailed] = useState(false);

  // 點擊表頭切換排序欄位與方向
  const handleSortHeader = (key) => {
    setSortConfig(prev => {
      if (prev.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: key === 'mpSaving' ? 'desc' : 'asc' };
    });
  };

  // 根據篩選與排序整理專案列表
  const displayedProjects = useMemo(() => {
    let list = [...projects];
    if (filterMode === 'starred') list = list.filter(p => starredIds.has(p.id));
    else if (filterMode === 'hasMp') list = list.filter(p => p.mpSaving);
    else if (filterMode === 'hasDeliverable') list = list.filter(p => p.deliverable);
    else if (filterMode === 'missing') list = list.filter(p => !p.deliverable && !p.mpSaving);

    if (sortConfig.key) {
      const { key, direction } = sortConfig;
      const factor = direction === 'asc' ? 1 : -1;

      list.sort((a, b) => {
        if (key === 'mpSaving') {
          const parseMp = (val) => {
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
          return String(a.nid || '').localeCompare(String(b.nid || ''), 'zh-TW', { numeric: true }) * factor;
        }
        return 0;
      });
    }
    return list;
  }, [projects, filterMode, sortConfig]);

  // 匯出目前顯示的清單(套用中的篩選與排序)為 Excel — 高階主管離線(車上)瀏覽用
  const exportExcel = async () => {
    if (exporting) return;
    setExporting(true);
    setExportFailed(false);
    try {
      const res = await fetch(`${API_BASE}/api/results-excel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, projectIds: displayedProjects.map(p => p.id) })
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
    return (
      <th
        {...clickable(() => handleSortHeader(key), null, { role: null })}
        aria-sort={!isSorted ? 'none' : sortConfig.direction === 'asc' ? 'ascending' : 'descending'}
        className={`px-3 py-2 cursor-pointer select-none transition hover:bg-slate-200 whitespace-nowrap ${isSorted ? 'bg-blue-100 text-blue-900 border-b-2 border-blue-600' : 'bg-slate-100 text-slate-700'} ${widthClass} ${extraClass}`}
        title={`點擊依「${label}」${!isSorted ? '排序' : sortConfig.direction === 'asc' ? '改為降冪排序' : '改為升冪排序'}`}
      >
        <div className="flex items-center justify-between gap-1">
          <span className="whitespace-nowrap">{label}</span>
          <span className={`text-[11px] px-1 rounded flex-shrink-0 ${isSorted ? 'bg-blue-600 text-white font-black' : 'text-slate-600 font-normal'}`}>
            {dirIcon}
          </span>
        </div>
      </th>
    );
  };

  return (
    <div className="px-6 py-3 max-w-[1560px] w-full mx-auto space-y-3">
      {/* 頂部 KPI 互動統計篩選卡片 (二合一：點擊直接過濾列表) */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold text-slate-500">點擊下方 KPI 指標卡片，即可快速切換檢視與過濾清單：</span>
          <button onClick={exportExcel} disabled={exporting}
            className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold transition border shadow-sm text-white disabled:opacity-70 ${exportFailed ? 'bg-red-600 hover:bg-red-500 border-red-700' : 'bg-green-600 hover:bg-green-500 border-green-700'}`}
            title={`下載目前顯示的清單（含套用中的篩選與排序，共 ${displayedProjects.length} 案）為 Excel，供離線瀏覽專案項目、具體產出與 MP Saving`}>
            {exporting ? '⏳ 產生中…' : exportFailed ? '❌ 匯出失敗，點擊重試' : `⬇️ 匯出 Excel（${displayedProjects.length} 案）`}
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <button onClick={() => setFilterMode('all')}
            className={`p-2.5 rounded-xl border text-left transition flex items-center gap-2.5 ${filterMode === 'all' ? 'bg-[#001F5B] text-white border-[#001F5B] shadow-md ring-2 ring-offset-2 ring-[#001F5B]/30' : 'bg-white text-slate-800 border-slate-300 hover:border-slate-300 hover:bg-slate-50'}`}>
            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-base font-bold ${filterMode === 'all' ? 'bg-white/10 text-white' : 'bg-slate-100 text-slate-600'}`}>📁</div>
            <div>
              <div className={`text-xs font-bold ${filterMode === 'all' ? 'text-blue-200' : 'text-slate-500'}`}>全部專案</div>
              <div className="text-lg font-black">{projects.length} <span className={`text-xs font-medium ${filterMode === 'all' ? 'text-blue-200' : 'text-slate-500'}`}>案</span></div>
            </div>
          </button>

          <button onClick={() => setFilterMode('starred')}
            className={`p-2.5 rounded-xl border text-left transition flex items-center gap-2.5 ${filterMode === 'starred' ? 'bg-amber-500 text-white border-amber-500 shadow-md ring-2 ring-offset-2 ring-amber-500/30' : 'bg-white text-slate-800 border-slate-300 hover:border-amber-300 hover:bg-amber-50/40'}`}>
            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-base font-bold ${filterMode === 'starred' ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-600'}`}>⭐</div>
            <div>
              <div className={`text-xs font-bold ${filterMode === 'starred' ? 'text-amber-100' : 'text-slate-500'}`}>重點關注項目</div>
              <div className="text-lg font-black">{projects.filter(p => starredIds.has(p.id)).length} <span className={`text-xs font-medium ${filterMode === 'starred' ? 'text-amber-100' : 'text-slate-500'}`}>案</span></div>
            </div>
          </button>

          <button onClick={() => setFilterMode('hasMp')}
            className={`p-2.5 rounded-xl border text-left transition flex items-center gap-2.5 ${filterMode === 'hasMp' ? 'bg-emerald-600 text-white border-emerald-600 shadow-md ring-2 ring-offset-2 ring-emerald-600/30' : 'bg-white text-slate-800 border-slate-300 hover:border-emerald-300 hover:bg-emerald-50/40'}`}>
            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-base font-bold ${filterMode === 'hasMp' ? 'bg-white/10 text-white' : 'bg-emerald-100 text-emerald-600'}`}>💡</div>
            <div>
              <div className={`text-xs font-bold ${filterMode === 'hasMp' ? 'text-emerald-100' : 'text-slate-500'}`}>具備 MP Saving</div>
              <div className="text-lg font-black">{projects.filter(p => p.mpSaving).length} <span className={`text-xs font-medium ${filterMode === 'hasMp' ? 'text-emerald-100' : 'text-slate-500'}`}>案</span></div>
            </div>
          </button>

          <button onClick={() => setFilterMode('hasDeliverable')}
            className={`p-2.5 rounded-xl border text-left transition flex items-center gap-2.5 ${filterMode === 'hasDeliverable' ? 'bg-amber-600 text-white border-amber-600 shadow-md ring-2 ring-offset-2 ring-amber-600/30' : 'bg-white text-slate-800 border-slate-300 hover:border-amber-300 hover:bg-amber-50/40'}`}>
            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-base font-bold ${filterMode === 'hasDeliverable' ? 'bg-white/10 text-white' : 'bg-amber-100 text-amber-600'}`}>🎯</div>
            <div>
              <div className={`text-xs font-bold ${filterMode === 'hasDeliverable' ? 'text-amber-100' : 'text-slate-500'}`}>有具體產出成果</div>
              <div className="text-lg font-black">{projects.filter(p => p.deliverable).length} <span className={`text-xs font-medium ${filterMode === 'hasDeliverable' ? 'text-amber-100' : 'text-slate-500'}`}>/ {projects.length} 案</span></div>
            </div>
          </button>

          <button onClick={() => setFilterMode('missing')}
            className={`p-2.5 rounded-xl border text-left transition flex items-center gap-2.5 ${filterMode === 'missing' ? 'bg-red-600 text-white border-red-600 shadow-md ring-2 ring-offset-2 ring-red-600/30' : 'bg-white text-slate-800 border-slate-300 hover:border-red-300 hover:bg-red-50/40'}`}>
            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-base font-bold ${filterMode === 'missing' ? 'bg-white/10 text-white' : 'bg-red-100 text-red-600'}`}>⚠️</div>
            <div>
              <div className={`text-xs font-bold ${filterMode === 'missing' ? 'text-red-100' : 'text-slate-500'}`}>待補充產出效益</div>
              <div className="text-lg font-black">{projects.filter(p => !p.deliverable && !p.mpSaving).length} <span className={`text-xs font-medium ${filterMode === 'missing' ? 'text-red-100' : 'text-slate-500'}`}>案</span></div>
            </div>
          </button>
        </div>
      </div>

      {sortConfig.key && (
        <div className="flex items-center justify-between bg-blue-50 border border-blue-200 px-4 py-2 rounded-xl text-xs font-bold text-blue-900 shadow-sm">
          <span>目前已套用欄位排序 ({sortConfig.direction === 'asc' ? '升冪 ▲' : '降冪 ▼'})</span>
          <button onClick={() => setSortConfig({ key: null, direction: 'asc' })}
            className="px-3 py-1 rounded-lg bg-white hover:bg-blue-100 text-blue-700 border border-blue-300 font-bold transition shadow-sm">
            清除排序
          </button>
        </div>
      )}

      {/* 與甘特圖順序完全一致的單行列專案表 (No -> 分類 -> 類型 -> 專案名稱 -> 負責人 -> 產出 -> MP Saving -> 操作) */}
      {/* ⚠ 這層**不可**加 overflow-hidden:它會成為 thead sticky 的定位容器,而它自己不捲動 → 表頭跟著內容捲走
          (實測 69 列捲到底時表頭跑到 top:-1311,完全看不到欄位與排序鈕)。圓角改由 th 的 first/last 補。 */}
      <div className="bg-white rounded-xl border border-slate-300 shadow-sm">
        <table className="w-full text-left border-collapse table-fixed">
          {/* 表頭固定:成果清單有 69 列(內容 2524px vs 可視 948px),捲動時仍要看得到欄位標題與排序鈕
              (週檢視/年度總覽早已 sticky,此處原本漏掉) */}
          <thead className="sticky top-0 z-20">
            <tr className="bg-slate-100 text-xs font-bold border-b border-slate-300 h-9 [&>th:first-child]:rounded-tl-xl [&>th:last-child]:rounded-tr-xl">
              <th className="px-2 w-10 text-center bg-slate-100 text-slate-600 whitespace-nowrap">No</th>
              {renderSortHeader("分類", "category", "w-20")}
              {renderSortHeader("類型", "type", "w-14 text-center")}
              {renderSortHeader("專案名稱", "name", "w-[420px]")}
              {renderSortHeader("負責人", "owner", "w-24")}
              {renderSortHeader("預計交付具體產出成果", "deliverable", "w-auto")}
              {renderSortHeader("MP Saving", "mpSaving", "w-36")}
              {renderSortHeader("NID", "nid", "w-32")}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-[13px]">
            {displayedProjects.map((proj, idx) => {
              const cleanDeliverable = proj.deliverable ? String(proj.deliverable).replace(/[\r\n]+/g, ' ') : '';
              return (
                <tr key={proj.id} className="hover:bg-blue-50/40 transition [&>td]:align-top">
                  <td className="px-3 py-1 text-center text-slate-500 font-medium whitespace-nowrap truncate">{idx + 1}</td>
                  <td className="px-3 py-1 whitespace-nowrap truncate text-slate-800 font-semibold" title={proj.category}>
                    {proj.category || '--'}
                  </td>
                  <td className="px-1 py-1 text-center whitespace-nowrap">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-extrabold border ${PROJECT_TYPES[proj.type]?.chip || 'bg-slate-100 text-slate-600 border-slate-300'}`} title={PROJECT_TYPES[proj.type]?.label}>
                      {proj.type?.toUpperCase() || '--'}
                    </span>
                  </td>
                  <td className="px-3 py-1 font-bold text-slate-900 text-[14px]" title={proj.name}>
                    <div className="flex items-start">
                      {role === 'manager' ? (
                        <button
                          onClick={(e) => toggleStar && toggleStar(proj.id, e)}
                          className={`flex-shrink-0 mr-1.5 text-base transition transform hover:scale-125 ${starredIds.has(proj.id) ? 'text-amber-500' : 'text-slate-400 hover:text-amber-400'}`}
                          aria-pressed={starredIds.has(proj.id)}
                          aria-label={`${proj.name}：${starredIds.has(proj.id) ? '取消重點關注標記' : '標記為重點關注項目'}`}
                          title={starredIds.has(proj.id) ? '取消重點關注標記' : '標記為重點關注項目'}
                        >
                          {starredIds.has(proj.id) ? '★' : '☆'}
                        </button>
                      ) : starredIds.has(proj.id) ? (
                        <span className="flex-shrink-0 mr-1.5 text-base text-amber-500" title="重點關注項目">★</span>
                      ) : null}
                      <span className="whitespace-normal break-words leading-snug">{proj.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-1 whitespace-nowrap">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-bold whitespace-nowrap">
                      {proj.owner}
                    </span>
                  </td>
                  <td className="px-4 py-1">
                    {cleanDeliverable ? (
                      <div className="text-slate-800 font-semibold whitespace-normal break-words leading-snug">
                        {cleanDeliverable}
                      </div>
                    ) : (
                      <span className="text-slate-400 font-light">—</span>
                    )}
                  </td>
                  <td className="px-3 py-1 align-top overflow-hidden">
                    {proj.mpSaving ? (
                      <span className="inline-block max-w-full px-2 py-0.5 rounded text-[13px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 break-words leading-snug">
                        {proj.mpSaving}
                      </span>
                    ) : (
                      <span className="text-slate-400 font-light">—</span>
                    )}
                  </td>
                  <td className="px-3 py-1 align-top" title={proj.nid || ''}>
                    {proj.nid ? (
                      <div className="flex flex-wrap gap-1">
                        {String(proj.nid).split(/[、,，;；\s]+/).filter(Boolean).map((n, i) => (
                          <span key={i} className="inline-block px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold border border-slate-300 whitespace-nowrap">{n}</span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-slate-400 font-light">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {displayedProjects.length === 0 && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-slate-500 font-medium">
                  符合篩選條件的專案項目為空
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [role, setRole] = useState(null);
  const [currentWeek, setCurrentWeek] = useState(DEFAULT_CURRENT_WEEK);
  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState(null);
  const [empId, setEmpId] = useState(null);   // Windows 工號(顯示用;實際寫入由 apiPost 自動附帶)
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
    detectEmpId().then(async (id) => {
      if (cancelled) return;
      setEmpId(id);
      try {
        const r = await apiGet(`/api/access-check?empId=${encodeURIComponent(id || '')}`, { timeoutMs: 15000 });
        if (!cancelled) setAccessCheck(r);
      } catch (e) {
        if (cancelled) return;
        if (e && e.name === 'AbortError') {
          setAccessError('伺服器沒有在時間內回應權限檢查（可能正在重啟）。');
          return;
        }
        // 後端不可達時不在此擋(bootstrap 會另行顯示連線錯誤);卡控啟用時的失敗判斷在伺服器端(fail-closed)
        setAccessCheck({ enabled: false, allowed: true });
      }
    });
    return () => { cancelled = true; };
  }, [accessRetry]);

  // 年度切換:可用年度與週→月對照皆來自 DB 的 ScheduleWeeks(開新年度只需 EXEC usp_EnsureScheduleYear)
  const [scheduleYear, setScheduleYear] = useState(DEFAULT_SCHEDULE_YEAR);
  const [years, setYears] = useState([]);
  const [months, setMonths] = useState(MONTHS);
  const weeksTotal = useMemo(() => months.reduce((s, m) => s + m.weeks, 0), [months]);

  // 分頁標題帶目前週次(多分頁好辨識);非今年年度再帶年份;未登入維持原名
  React.useEffect(() => {
    if (!currentUser) { document.title = 'MSD 專案追蹤總表'; return; }
    const prefix = scheduleYear !== new Date().getFullYear() ? `${scheduleYear} ` : '';
    document.title = `${prefix}W${String(currentWeek).padStart(2, '0')}｜MSD 專案追蹤總表`;
  }, [currentUser, currentWeek, scheduleYear]);

  // UI 狀態(範本 B:預設寬鬆模式,字級較大對年長者友善)
  const [isDark, setIsDark] = useState(() => readPrefs().dark === true);   // 深色模式偏好:重整後沿用(這台電腦)
  React.useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    savePref('dark', isDark);
  }, [isDark]);
  const [isCompact, setIsCompact] = useState(() => readPrefs().compact === true);   // 緊湊模式偏好:重整後沿用
  const [isOverview, setIsOverview] = useState(false);   // 年度總覽:52 週自動縮放進一個畫面寬,無水平捲軸(唯讀瀏覽視角)
  const [isResults, setIsResults] = useState(false);     // 成果清單:集中檢閱所有專案具體成果項目與 MP 節省統計
  const [collapsedOwners, setCollapsedOwners] = useState(new Set());
  const [searchText, setSearchText] = useState('');
  const [typeFilter, setTypeFilter] = useState(new Set());       // 空 = 全部
  // 「未回報」晶片的開關:只顯示本週有排定但尚未回報的專案(主管催報用)
  const [pendingOnly, setPendingOnly] = useState(false);
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
      if (newStarred) next.add(projId); else next.delete(projId);
      return next;
    });
    // 同步更新 projects 內的 isStarred，確保重整後 starredIds 能正確重建
    setProjects(prev => prev.map(p => p.id === projId ? { ...p, isStarred: newStarred } : p));
    try {
      await apiPost('/api/project/star', {
        projectId: projId, starred: newStarred,
        actor: currentUser, actorRole: role
      });
    } catch (err) {
      // 若後端失敗，rollback 畫面狀態
      setStarredIds(prev => {
        const next = new Set(prev);
        if (newStarred) next.delete(projId); else next.add(projId);
        return next;
      });
      setProjects(prev => prev.map(p => p.id === projId ? { ...p, isStarred: !newStarred } : p));
      // 全站錯誤一律走 toast(原本這裡是唯一一個 window.alert:會阻斷操作、樣式與深色模式脫節)。
      // ⚠ showToast 刻意**不放進 deps**:它宣告在本 useCallback 之後(見下方 useState 區),
      //   寫進 deps 陣列會在 render 當下就踩到 TDZ;而它只用到 setToast/toastTimer 這種穩定參考,
      //   閉包抓到舊的那份行為完全一致,不會有 stale 問題。
      showToast('❌ 標記失敗：' + (err.message || '無法連線資料庫'));
    }
  }, [currentUser, role, starredIds]);
  const [tooltip, setTooltip] = useState(null);                  // {x, y, proj, task, weekLog, history}
  const ganttRef = useRef(null);

  // 紀錄打卡、非專案工作與下週預計
  const [taskLogs, setTaskLogs] = useState({});
  const [extraNotes, setExtraNotes] = useState({});
  const [weeklyPlans, setWeeklyPlans] = useState({});   // weeklyPlans[user][week] = 下週預計執行工作(填寫於該週)
  const [weeklyComments, setWeeklyComments] = useState({}); // weeklyComments[user][week] = 主管週報回覆(選填,全員可見)
  // 各表的最後編輯資訊 meta[user][week] = { by, byRole, at }(與內容字典並列,避免改動既有字串結構)
  const [extraNoteMeta, setExtraNoteMeta] = useState({});
  const [weeklyPlanMeta, setWeeklyPlanMeta] = useState({});
  const [weeklyCommentMeta, setWeeklyCommentMeta] = useState({});
  const [allowRetroCheckin, setAllowRetroCheckin] = useState(false); // 主管全域開關：允許成員回報/調正歷史進度

  // --- 同步狀態(給「連線中斷」指示用) ---
  // 原本 60 秒輪詢是 `refreshData().catch(() => {})`,後端重啟/斷網時畫面就停在舊資料、**完全沒有提示**
  // (實測連續 31 次 ERR_CONNECTION_REFUSED,畫面毫無異狀)。使用者會看著過期資料做判斷,
  // 直到按下儲存才發現失敗——而那時他已經是用舊資料覆蓋新值(last-write-wins)。
  // 計數與時間戳直接埋在 refreshData 裡,所有呼叫點(輪詢、存檔後刷新、關窗補刷)自動涵蓋。
  const [syncFailures, setSyncFailures] = useState(0);   // 連續失敗次數(成功即歸零)
  const [lastSyncAt, setLastSyncAt] = useState(null);     // 最後一次成功同步的時間

  // 重新抓取資料但不顯示整頁 Loading (供編輯後靜默刷新)
  const refreshData = useCallback(async () => {
    let data;
    try {
      data = await apiGet(`/api/bootstrap?year=${scheduleYear}`);
    } catch (e) {
      setSyncFailures(n => n + 1);
      throw e;   // ⚠ 一定要往外拋:loadBootstrap 靠這個 throw 才顯示 ErrorScreen + 重試
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
    setTaskLogs(data.taskLogs || {});
    setExtraNotes(data.extraNotes || {});
    setWeeklyPlans(data.weeklyPlans || {});
    setWeeklyComments(data.weeklyComments || {});
    setExtraNoteMeta(data.extraNoteMeta || {});
    setWeeklyPlanMeta(data.weeklyPlanMeta || {});
    setWeeklyCommentMeta(data.weeklyCommentMeta || {});
    if (typeof data.allowRetroCheckin === 'boolean') setAllowRetroCheckin(data.allowRetroCheckin);
    if (data.years && data.years.length) setYears(data.years);
    if (data.weeks && data.weeks.length) setMonths(groupWeeksToMonths(data.weeks));
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

  React.useEffect(() => { loadBootstrap(); }, [loadBootstrap]);

  const [selectedTaskInfo, setSelectedTaskInfo] = useState(null);
  // 團隊總結看板點成員回報格 → 左側甘特圖對應區間暫時淺藍高亮(提示「正在講哪一項」),再點/關看板/點別處即還原
  const [highlightedTaskId, setHighlightedTaskId] = useState(null);
  const [showExtraNoteModal, setShowExtraNoteModal] = useState(false);
  const [showWeeklyPlanModal, setShowWeeklyPlanModal] = useState(false);   // 下週預計執行工作
  // Toast:成功 2.5 秒;錯誤(訊息以 ❌ 開頭自動判定)停 6 秒且可手動關閉;
  // opts.action={label,onClick} 顯示動作鈕(如刪除後的「復原」),此時停留 opts.duration(預設 10 秒)
  const [toast, setToast] = useState(null);   // { msg, isError, action? }
  const toastTimer = useRef(null);
  const showToast = (msg, opts = {}) => {
    const isError = opts.type === 'error' || msg.startsWith('❌');
    setToast({ msg, isError, action: opts.action || null });
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
  const [showRetroPanel, setShowRetroPanel] = useState(false);       // 成員:補登面板(修改檢視中之非當週回報;需主管開放補登)
  const [showWeekEditPanel, setShowWeekEditPanel] = useState(false); // 主管:週次回報編輯面板(代成員補登/修正檢視中週次)
  const [noteTargetUser, setNoteTargetUser] = useState(null);        // 主管代編「非專案/下週預計」的目標成員(null=編輯自己的)
  const [showAuditPanel, setShowAuditPanel] = useState(false);   // 主管:異動紀錄(AuditLog)面板
  const [showMemberPanel, setShowMemberPanel] = useState(false); // 主管:成員管理面板
  const [showAccessPanel, setShowAccessPanel] = useState(false); // 主管:瀏覽權限卡控面板(遷移 11)
  const [showUsagePanel, setShowUsagePanel] = useState(false);   // 主管:使用統計面板(登入次數,遷移 13)
  const [showAdminMenu, setShowAdminMenu] = useState(false);     // 主管:header「⚙️ 管理」下拉選單(收納低頻管理入口)
  const [showDeadlinePanel, setShowDeadlinePanel] = useState(false); // 即將到期清單面板(頂部 ⏰ 晶片點開)

  const weekW = isCompact ? 22 : 32;
  // 版面自適應:凍結欄與右側團隊看板寬度隨視窗縮放,投影機/筆電才留得下中間甘特區(1920 時＝原本的 420/490/672)
  const viewportW = useViewportWidth();
  // 看板寬度:再夾一道「不得超過視窗 45%」,避免小視窗下甘特被壓成一條
  const reportPanelW = Math.round(Math.min(reportPanelWidth(viewportW), viewportW * 0.45));
  const availW = viewportW - (showWeeklyReport ? reportPanelW : 0);   // 主內容區可用寬(看板開啟時已內縮)
  // 工具列是否要收起「找資料」那組。收的內容沿用既有那組:
  // 概況列=全隊狀態晶片＋鍵盤提示;控制列=搜尋框＋a~e 晶片(有殘留篩選條件時仍保留已選中的)。
  // ⚠ 兩個條件是 OR 而不是只留寬度那個——看板開啟時要收**另有情境上的理由**,與空間無關:
  //   全隊狀態晶片在看板裡已被每人的分段條拆得更細(重複資訊)、講評當下也不會臨時改篩選條件。
  //   只寫 `availW < …` 的話,2560 這種寬螢幕開看板時 availW=1888 仍大於門檻,它們會全部跑回來。
  // ⚠ 「⏰ 即將到期」不列入:它在看板情境被收是因為「會開另一個面板跳出講評情境」,
  //   視窗窄跟那個理由無關,而它是行動項,所以維持只看 showWeeklyReport。
  const tightStatsBar = showWeeklyReport || availW < STATS_BAR_FULL_W;
  const tightToolbar = showWeeklyReport || availW < TOOLBAR_FULL_W;
  // 年度總覽的名稱欄:原本寫死 240,1920 下明明還有空間卻不用 → 22% 的名稱被截(週檢視只有 1%)。
  // 改成「把剩餘空間讓給名稱欄,但先保證每個週欄至少 MIN_OVERVIEW_WEEK_W」,
  // 整年仍在同一畫面(表格 width:100%,週欄只是變窄,不會產生水平捲軸);
  // 上限沿用週檢視的 nameColWidth(切換兩個檢視時名稱欄不跳動),下限維持原本的 240 → 任何情況都不比現況差。
  const overviewNameW = Math.round(Math.max(240, Math.min(nameColWidth(viewportW), availW - weeksTotal * MIN_OVERVIEW_WEEK_W)));
  const nameW = isOverview ? overviewNameW : nameColWidth(viewportW);
  const frozenW = isOverview ? nameW : STICKY_LEAD_W + nameW;    // 甘特左側凍結區總寬(捲動置中的基準)
  // 年度總覽的週欄寬度是「剩餘空間 ÷ 週數」(非固定 weekW);太窄時 53 個數字會擠成一片,
  // 故 <16px 只標 5 的倍數與當週(格子本身仍可點,hover/title 不變)
  const overviewWeekW = isOverview ? (availW - frozenW) / weeksTotal : 0;
  const sparseWeekLabel = isOverview && overviewWeekW < 16;
  const todayWeek = getTodayWeek(scheduleYear, weeksTotal);   // 本週(相對於選定年度)
  const isViewingPast = currentWeek !== todayWeek;  // 是否在檢視非本週

  // 團隊看板點回報格 → 展開該成員群組、捲到該列與當前週(靠左避開右側面板)、暫時高亮該區間;再點同項=取消
  const [pendingScrollProj, setPendingScrollProj] = useState(null);   // 觸發「捲到該列+當前週」的 effect(用 effect 而非 rAF,嵌入式瀏覽器較可靠)
  const handleHighlightTask = useCallback((proj, task) => {
    const willClear = highlightedTaskId === task.id;
    setHighlightedTaskId(willClear ? null : task.id);
    if (willClear) return;
    setCollapsedOwners(prev => { const s = new Set(prev); s.delete(proj.owner); return s; });
    // 聚焦執行者:左側甘特只留這位成員的專案,主管講評時不被其他人的列干擾(關閉看板即還原登入預設)
    setOwnerFilter(proj.owner);
    setPendingScrollProj(proj.id);
  }, [highlightedTaskId]);

  // 關閉團隊看板:清除高亮與成員聚焦,甘特還原為「登入預設成員 ＋ 全部展開」
  const closeWeeklyReport = useCallback(() => {
    setHighlightedTaskId(null);
    setShowWeeklyReport(false);
    setOwnerFilter(defaultOwnerFilter(role, currentUser));
    setCollapsedOwners(new Set());
  }, [role, currentUser]);

  // 每次登入角色時：預設開啟各成員的週檢視、展開清單頁面；成員預設顯示個人專案，主管預設為全部成員
  // 登入身分寫入 localStorage:重新整理/重開分頁不再被登出(登出時清除;內網固定使用者,風險可接受)
  const handleLogin = (user, selectedRole, source = 'manual') => {
    try { localStorage.setItem('gantt_login', JSON.stringify({ user, role: selectedRole })); } catch (e) {}
    // 使用率統計:每次登入寫一筆 LoginLogs(manual=登入畫面點選/auto=重整自動還原);失敗靜默不影響使用
    apiPost('/api/login-log', { userName: user, role: selectedRole, source }).catch(() => {});
    setCurrentUser(user);
    setRole(selectedRole);
    setIsOverview(readPrefs().overview === true);   // 檢視偏好:沿用上次的週檢視/年度總覽選擇
    setIsResults(false);
    setCurrentWeek(getTodayWeek(scheduleYear, weeksTotal));
    setCollapsedOwners(new Set());
    setOwnerFilter(defaultOwnerFilter(selectedRole, user));   // 成員=自己、主管=全部成員
    setSearchText('');
    setTypeFilter(new Set());
    setPendingOnly(false);
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
    try { localStorage.removeItem('gantt_login'); } catch (e) {}
    setCurrentUser(null);
    setRole(null);
    setIsOverview(false);
    setIsResults(false);
    setCollapsedOwners(new Set());
    setOwnerFilter('all');
    setSearchText('');
    setTypeFilter(new Set());
    setPendingOnly(false);
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

  const toggleOwnerCollapse = (owner) => {
    setCollapsedOwners(prev => {
      const s = new Set(prev);
      s.has(owner) ? s.delete(owner) : s.add(owner);
      return s;
    });
  };

  const toggleTypeFilter = (t) => {
    setTypeFilter(prev => {
      const s = new Set(prev);
      s.has(t) ? s.delete(t) : s.add(t);
      return s;
    });
  };

  const [scrollTargetWeek, setScrollTargetWeek] = useState(null);

  // 把某一週置中於「看得到的甘特區」= 容器寬扣掉左側凍結欄(看板開啟時容器已內縮,右緣即看板左緣)。
  // 目標超出捲動範圍時瀏覽器自動夾住 → 年底幾週改為靠右顯示(無法置中,但一定看得到)。
  const scrollToWeek = useCallback((wk) => {
    const el = ganttRef.current;
    if (!el) return;
    const viewW = Math.max(weekW, el.clientWidth - frozenW);   // 可視甘特區寬度
    smoothScrollLeftTo(el, (wk - 1) * weekW + weekW / 2 - viewW / 2);
  }, [weekW, frozenW]);

  const goToCurrentWeek = () => {
    const tw = getTodayWeek(scheduleYear, weeksTotal);   // 動態取得今天的實際週(W27、下週為 W28…)
    setCurrentWeek(tw);                 // 將選取週強制切回本週
    setScrollTargetWeek(tw);            // 觸發 effect,於畫面更新後捲動定位
  };

  const toggleRetroCheckin = async () => {
    if (role !== 'manager') return;
    try {
      await apiPost('/api/settings/retro-checkin', {
        enabled: !allowRetroCheckin,   // 後端 RetroCheckinReq 欄位為 Enabled(先前誤送 allow 導致永遠寫入 false)
        actor: currentUser,
        actorRole: role
      });
      setAllowRetroCheckin(!allowRetroCheckin);
      showToast(!allowRetroCheckin ? '🔓 已開放全體成員回報/調正歷史進度' : '🔒 已恢復僅限當週打卡');
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
        const cr = el.getBoundingClientRect(), rr = row.getBoundingClientRect();
        el.scrollTop = Math.max(0, el.scrollTop + (rr.top - cr.top) - Math.min(el.clientHeight / 2, 220));
      }
      scrollToWeek(currentWeek);   // 置中(年底週次捲不動時自動靠右,仍在看板左側可視區內)
    }
    setPendingScrollProj(null);
  }, [pendingScrollProj, currentWeek, scrollToWeek]);

  // 可視甘特寬改變(開/關看板、視窗大小或接上投影機導致解析度變更)→ 重新把當前週置中;
  // 否則捲動位置會停在舊寬度算出來的地方(接投影機後年底的週次會整個躲進看板底下)
  const ganttViewKeyRef = useRef(null);
  React.useEffect(() => {
    const key = `${showWeeklyReport}|${viewportW}`;
    if (ganttViewKeyRef.current === null) { ganttViewKeyRef.current = key; return; }   // 首次掛載不干擾初始位置
    if (ganttViewKeyRef.current === key) return;
    ganttViewKeyRef.current = key;
    if (!isOverview && !isResults) setScrollTargetWeek(currentWeek);   // 交給 scrollTargetWeek effect,確保新寬度已套用
  }, [showWeeklyReport, viewportW, isOverview, isResults, currentWeek]);

  // 本地時間戳(yyyy-MM-dd HH:mm),與 bootstrap 回傳的 updatedAt 格式一致(樂觀更新用)
  const nowStamp = () => {
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  const handleSaveLog = async (taskId, status, note) => {
    try {
      await apiPost('/api/weekly-log', {
        taskCode: taskId, year: scheduleYear, week: currentWeek,
        status, note, actor: currentUser, actorRole: role
      });
      setTaskLogs(prev => ({
        ...prev,
        [taskId]: {
          ...prev[taskId],
          [currentWeek]: {
            ...(prev[taskId]?.[currentWeek] || {}),
            isExecuting: status !== 'not_executed', status, note,
            reporter: currentUser, reporterRole: role, updatedAt: nowStamp()
          }
        }
      }));
      setSelectedTaskInfo(null);
      // 「下週預計工作」為強制回報項目:回報完本週最後一項任務後仍未填寫時,直接開啟填寫視窗
      const remainingPending = myPendingTasks.filter(x => x.task.id !== taskId).length;
      if (role === 'member' && currentWeek === todayWeek && remainingPending === 0 && !weeklyPlans[currentUser]?.[todayWeek]) {
        showToast(`✅ 本週任務已全數回報，請接著填寫「下週預計工作」`);
        setShowWeeklyPlanModal(true);
      } else {
        showToast(`✅ W${String(currentWeek).padStart(2, '0')} 任務回報已送出`);
      }
    } catch (e) {
      showToast('❌ 儲存失敗：' + (e.message || '無法連線資料庫'));
    }
  };

  const handleSaveExtraNote = async (note) => {
    const target = noteTargetUser || currentUser;   // 主管可代成員修正(noteTargetUser 由週次編輯面板設定)
    try {
      await apiPost('/api/extra-note', {
        userName: target, year: scheduleYear, week: currentWeek,
        note, actor: currentUser, actorRole: role
      });
      setExtraNotes(prev => ({
        ...prev,
        [target]: { ...prev[target], [currentWeek]: note }
      }));
      setExtraNoteMeta(prev => ({
        ...prev,
        [target]: { ...prev[target], [currentWeek]: { by: currentUser, byRole: role, at: nowStamp() } }
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
  const [commentTarget, setCommentTarget] = useState(null);   // 回覆對象成員名(開啟 CommentModal)
  const handleSaveComment = async (userName, comment) => {
    try {
      await apiPost('/api/weekly-comment', {
        userName, year: scheduleYear, week: currentWeek, comment,
        actor: currentUser, actorRole: role
      });
      setWeeklyComments(prev => {
        const mine = { ...(prev[userName] || {}) };
        if (comment) mine[currentWeek] = comment; else delete mine[currentWeek];
        return { ...prev, [userName]: mine };
      });
      setWeeklyCommentMeta(prev => {
        const mine = { ...(prev[userName] || {}) };
        if (comment) mine[currentWeek] = { by: currentUser, byRole: role, at: nowStamp() }; else delete mine[currentWeek];
        return { ...prev, [userName]: mine };
      });
      setCommentTarget(null);
      showToast(comment
        ? `✅ 已回覆 ${userName} 的 W${String(currentWeek).padStart(2, '0')} 週報`
        : `✅ 已清除 ${userName} 的 W${String(currentWeek).padStart(2, '0')} 週報回覆`);
    } catch (e) {
      showToast('❌ 儲存失敗：' + (e.message || '無法連線資料庫'));
    }
  };

  const handleSaveWeeklyPlan = async (note) => {
    const target = noteTargetUser || currentUser;   // 主管可代成員修正(noteTargetUser 由週次編輯面板設定)
    try {
      await apiPost('/api/weekly-plan', {
        userName: target, year: scheduleYear, week: currentWeek,
        note, actor: currentUser, actorRole: role
      });
      setWeeklyPlans(prev => ({
        ...prev,
        [target]: { ...prev[target], [currentWeek]: note }
      }));
      setWeeklyPlanMeta(prev => ({
        ...prev,
        [target]: { ...prev[target], [currentWeek]: { by: currentUser, byRole: role, at: nowStamp() } }
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
  const [deliverableProj, setDeliverableProj] = useState(null);   // 開啟中的產出項目視窗(甘特列 🎯 進入)
  const handleSaveDeliverable = async (projId, deliverable, mpSaving) => {
    try {
      await apiPost('/api/project/deliverable', {
        projectId: projId, deliverable, mpSaving, actor: currentUser, actorRole: role
      });
      setProjects(prev => prev.map(p => p.id === projId ? { ...p, deliverable, mpSaving } : p));
      setDeliverableProj(null);
      showToast('✅ 具體產出與效益已儲存');
    } catch (e) {
      showToast('❌ 儲存失敗：' + (e.message || '無法連線資料庫'));
    }
  };

  // 主管調整打卡分數(0.3/0.5/0.8/0.9/1)
  const handleUpdateScore = async (taskId, score) => {
    try {
      await apiPost('/api/weekly-log/score', {
        taskCode: taskId, year: scheduleYear, week: currentWeek, score,
        actor: currentUser, actorRole: role
      });
      setTaskLogs(prev => {
        const log = prev[taskId]?.[currentWeek];
        if (!log) return prev;
        return { ...prev, [taskId]: { ...prev[taskId], [currentWeek]: { ...log, score } } };
      });
      setSelectedTaskInfo(prev => prev?.weekLog ? { ...prev, weekLog: { ...prev.weekLog, score } } : prev);
      showToast(`✅ 分數已調整為 ${score} 分`);
    } catch (e) {
      showToast('❌ 調整失敗：' + (e.message || '無法連線資料庫'));
    }
  };

  const handleUpdateTaskDetails = async (projId, taskId, newName, newStart, newEnd, newNid) => {
    try {
      await apiPost('/api/task-schedule', {
        taskCode: taskId, name: newName, start: parseInt(newStart), end: parseInt(newEnd), nid: newNid,
        actor: currentUser, actorRole: role
      });
      setProjects(prev => prev.map(p => {
        if (p.id !== projId) return p;
        return { ...p, tasks: p.tasks.map(t => t.id === taskId ? { ...t, name: newName, start: parseInt(newStart), end: parseInt(newEnd), nid: newNid } : t) };
      }));
      setSelectedTaskInfo(null);
      showToast('✅ 排程已更新');
    } catch (e) {
      showToast('❌ 更新失敗：' + (e.message || '無法連線資料庫'));
    }
  };

  // --- 主管：專案 新增/修改/刪除 + 區間新增 + 拖曳排序 ---
  const [editingProject, setEditingProject] = useState(null);   // {mode:'add'|'edit', owner, project?}
  const [addingInterval, setAddingInterval] = useState(null);   // project
  const [dragState, setDragState] = useState(null);             // {id, owner}
  const [dragOverId, setDragOverId] = useState(null);
  const [confirmInfo, setConfirmInfo] = useState(null);         // {title, message, onConfirm} — 自製刪除確認視窗(取代 window.confirm)

  // 資料載入完成後還原上次登入身分(重新整理免重登);成員名單已無此人(被移除/改名)則清除紀錄
  React.useEffect(() => {
    if (dataLoading || dataError || currentUser) return;
    try {
      const saved = JSON.parse(localStorage.getItem('gantt_login') || 'null');
      if (!saved || !saved.user || !saved.role) return;
      if (saved.role === 'manager' || users.includes(saved.user)) {
        handleLogin(saved.user, saved.role, 'auto');   // 重整自動還原:統計來源記 auto
      } else {
        localStorage.removeItem('gantt_login');
      }
    } catch (e) {}
  }, [dataLoading, dataError, currentUser, users]);   // eslint-disable-line react-hooks/exhaustive-deps

  // 是否有彈窗/面板開啟中——輪詢暫停與鍵盤快捷鍵共用同一份判斷,兩邊才不會各自漂移。
  // ⚠ 團隊總結看板(showWeeklyReport)刻意不列入:它是唯讀的側邊疊加面板,不是輸入型視窗。
  //   快捷鍵要讓主管邊看看板邊用 ←→/H 平移甘特圖;輪詢更是反過來——講評時本來就希望看到成員陸續回報進來。
  const isAnyModalOpen = !!(confirmInfo || commentTarget || selectedTaskInfo || deliverableProj || editingProject || addingInterval || showExtraNoteModal || showWeeklyPlanModal || showPendingPanel || showRetroPanel || showWeekEditPanel || showAuditPanel || showMemberPanel || showAccessPanel || showUsagePanel || showAdminMenu || showDeadlinePanel);

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
      if (pausedAtRef.current === null) pausedAtRef.current = Date.now();   // 記錄暫停起點
      return;
    }
    // 暫停期間若已經跨過一個輪詢週期,關窗後補刷一次;否則使用者得再等滿 60 秒才看得到別人的變更。
    // ⚠ 只在「真的錯過」時才補:存檔類操作本身已經 await refreshData(),關窗馬上再打一次 bootstrap 是多餘的
    //    (bootstrap 是整包載入的重端點,每次存檔都雙倍請求並不划算)。
    const missedTick = pausedAtRef.current !== null && Date.now() - pausedAtRef.current >= 60000;
    pausedAtRef.current = null;
    if (missedTick) refreshData().catch(() => {});
    const timer = setInterval(() => { refreshData().catch(() => {}); }, 60000);
    return () => clearInterval(timer);
  }, [currentUser, dragState, isAnyModalOpen, refreshData]);

  // --- 全域鍵盤導航（方向鍵平移甘特圖、Home/H 回本週、ESC 關閉最上層彈窗） ---
  React.useEffect(() => {
    if (!currentUser) return;
    const handler = (e) => {
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
        const closeGuard = (closer) => {
          if (MODAL_DIRTY) {
            setConfirmInfo({
              title: '放棄未儲存的內容？',
              message: '視窗內有尚未儲存的修改，關閉後將會遺失。',
              confirmLabel: '放棄並關閉',
              onConfirm: () => { MODAL_DIRTY = false; setConfirmInfo(null); closer(); }
            });
          } else closer();
        };
        if (showAdminMenu) { setShowAdminMenu(false); e.preventDefault(); return; }
        if (confirmInfo) { setConfirmInfo(null); e.preventDefault(); return; }
        if (commentTarget) { closeGuard(() => setCommentTarget(null)); e.preventDefault(); return; }
        if (selectedTaskInfo) { closeGuard(() => setSelectedTaskInfo(null)); e.preventDefault(); return; }
        if (deliverableProj) { closeGuard(() => setDeliverableProj(null)); e.preventDefault(); return; }
        if (editingProject) { closeGuard(() => setEditingProject(null)); e.preventDefault(); return; }
        if (addingInterval) { closeGuard(() => setAddingInterval(null)); e.preventDefault(); return; }
        if (showExtraNoteModal) { closeGuard(() => { setShowExtraNoteModal(false); setNoteTargetUser(null); }); e.preventDefault(); return; }
        if (showWeeklyPlanModal) { closeGuard(() => { setShowWeeklyPlanModal(false); setNoteTargetUser(null); }); e.preventDefault(); return; }
        if (showWeeklyReport) { closeWeeklyReport(); e.preventDefault(); return; }
        if (showPendingPanel) { setShowPendingPanel(false); e.preventDefault(); return; }
        if (showRetroPanel) { setShowRetroPanel(false); e.preventDefault(); return; }
        if (showWeekEditPanel) { setShowWeekEditPanel(false); e.preventDefault(); return; }
        if (showAuditPanel) { setShowAuditPanel(false); e.preventDefault(); return; }
        if (showMemberPanel) { setShowMemberPanel(false); e.preventDefault(); return; }
        if (showAccessPanel) { setShowAccessPanel(false); e.preventDefault(); return; }
        if (showUsagePanel) { setShowUsagePanel(false); e.preventDefault(); return; }
        if (showDeadlinePanel) { setShowDeadlinePanel(false); e.preventDefault(); return; }
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
    window.addEventListener('keydown', handler, true);   // capture phase
    return () => window.removeEventListener('keydown', handler, true);
  }, [currentUser, weekW, isOverview, isResults, isAnyModalOpen, confirmInfo, commentTarget, selectedTaskInfo, deliverableProj, editingProject, addingInterval, showExtraNoteModal, showWeeklyPlanModal, showWeeklyReport, showPendingPanel, showRetroPanel, showWeekEditPanel, showAuditPanel, showMemberPanel, showAccessPanel, showUsagePanel, showAdminMenu, showDeadlinePanel, goToCurrentWeek, closeWeeklyReport]);

  const existingCategories = useMemo(
    () => [...new Set(projects.map(p => p.category).filter(Boolean))].sort(),
    [projects]
  );

  // 搜尋/類型篩選會隱藏同成員內的部分專案列,此時拖曳落點會與畫面不一致,故暫停拖曳排序
  // pendingOnly 也算:它同樣會隱藏同一位成員底下的部分專案列,拖曳落點會與畫面對不上
  const isFilteringRows = searchText.trim() !== '' || typeFilter.size > 0 || pendingOnly;

  const handleSaveProject = async (form) => {
    try {
      if (form.mode === 'add') {
        await apiPost('/api/project', {
          type: form.type, category: form.category, owner: form.owner,
          name: form.name, year: scheduleYear, nid: form.nid, actor: currentUser, actorRole: role
        });
      } else {
        await apiPost('/api/project/update', {
          projectId: form.projectId, type: form.type, category: form.category,
          owner: form.owner, name: form.name, nid: form.nid, actor: currentUser, actorRole: role
        });
      }
      await refreshData();
      setEditingProject(null);
      showToast(form.mode === 'add' ? '✅ 專案已新增' : '✅ 專案已更新');
    } catch (e) {
      showToast('❌ 儲存失敗：' + (e.message || '無法連線資料庫'));
    }
  };

  const handleDeleteProject = (proj) => {
    setConfirmInfo({
      title: '刪除專案',
      message: `確定要刪除專案「${proj.name}」嗎？\n此動作會一併移除其所有計畫區間（軟刪除，可由資料庫還原）。`,
      onConfirm: async () => {
        setConfirmInfo(null);
        try {
          await apiPost('/api/project/delete', { projectId: proj.id, actor: currentUser, actorRole: role });
          await refreshData();
          // 10 秒內可一鍵復原(軟刪除還原,含其計畫區間)
          showToast(`✅ 專案「${proj.name}」已刪除`, {
            action: {
              label: '復原',
              onClick: async () => {
                try {
                  await apiPost('/api/project/restore', { projectId: proj.id, actor: currentUser, actorRole: role });
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
        projectId: proj.id, taskName, start: parseInt(start), end: parseInt(end), nid,
        actor: currentUser, actorRole: role
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
          await apiPost('/api/task/delete', { taskCode: task.id, actor: currentUser, actorRole: role });
          await refreshData();
          setSelectedTaskInfo(null);
          showToast(`✅ 計畫區間「${task.name}」已刪除`, {
            action: {
              label: '復原',
              onClick: async () => {
                try {
                  await apiPost('/api/task/restore', { taskCode: task.id, actor: currentUser, actorRole: role });
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
    const from = ids.indexOf(fromId), to = ids.indexOf(toId);
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
      await apiPost('/api/project/reorder', { orderedIds: newIds, actor: currentUser, actorRole: role });
      showToast('✅ 排序已更新');
    } catch (e) {
      showToast('❌ 排序失敗：' + (e.message || '無法連線資料庫'));
      refreshData();
    }
  };

  // --- 主管：成員 新增/移除 ---
  const handleAddUser = async (name) => {
    try {
      await apiPost('/api/user', { userName: name, actor: currentUser, actorRole: role });
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
      await apiPost('/api/user/update', { userName: oldName, newName, actor: currentUser, actorRole: role });
      await refreshData();
      showToast('✅ 成員名稱已更新');
      return true;
    } catch (e) {
      showToast('❌ 更新失敗：' + (e.message || '無法連線資料庫'));
      return false;
    }
  };

  const handleDeleteUser = (name) => {
    setConfirmInfo({
      title: '移除成員',
      message: `確定要移除成員「${name}」嗎？\n移除後將不再出現於登入畫面與甘特圖（歷史回報保留，重新新增同名成員即可還原）。\n若其名下仍有專案，需先刪除或改派專案才能移除。`,
      onConfirm: async () => {
        setConfirmInfo(null);
        try {
          await apiPost('/api/user/delete', { userName: name, actor: currentUser, actorRole: role });
          await refreshData();
          showToast('✅ 成員已移除');
        } catch (e) {
          showToast('❌ 移除失敗：' + (e.message || '無法連線資料庫'));
        }
      }
    });
  };

  // --- 篩選 ---
  const filteredProjects = useMemo(() => {
    const kw = searchText.trim().toLowerCase();
    return projects.filter(p => {
      if (ownerFilter !== 'all' && p.owner !== ownerFilter) return false;   // 三個檢視共用的成員下拉
      if (typeFilter.size > 0 && !typeFilter.has(p.type)) return false;
      // 「未回報」晶片的篩選:只留下本週有排定、但還沒回報的專案。
      // 主管每週的核心動作就是「誰還沒交」——原本看到「未回報 18」之後,只能自己在 69 列裡找紅框。
      if (pendingOnly && !p.tasks.some(t => t.start <= currentWeek && t.end >= currentWeek && !taskLogs[t.id]?.[currentWeek])) return false;
      if (kw) {
        const hay = `${p.name} ${p.category} ${p.owner} ${p.tasks.map(t => t.name).join(' ')}`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
  }, [projects, searchText, typeFilter, ownerFilter, pendingOnly, currentWeek, taskLogs]);

  // 主管未啟用搜尋/類型篩選時，沒有專案的成員(如剛加入的新同仁)也要顯示群組列,才能為其新增專案
  const groupedProjects = useMemo(() =>
    users.map(user => ({ owner: user, projects: filteredProjects.filter(p => p.owner === user) }))
      .filter(g => g.projects.length > 0 ||
        (role === 'manager' && !isFilteringRows && (ownerFilter === 'all' || ownerFilter === g.owner)))
  , [filteredProjects, users, role, isFilteringRows, ownerFilter]);

  // 排程到期提醒:任務進行中(以「實際本週」計)且 剩餘 ≤2 週 或 時程已過 ≥70%
  const isTaskDeadlineSoon = useCallback((task) => {
    if (task.start > todayWeek || task.end < todayWeek) return false;
    const span = task.end - task.start + 1;
    const remain = task.end - todayWeek + 1;                 // 含本週
    const elapsed = (todayWeek - task.start + 1) / span;     // 已過比例
    return remain <= 2 || elapsed >= 0.7;
  }, [todayWeek]);

  // 即將到期清單(依剩餘週數排序,供頂部晶片點開的面板與統計數字共用)
  const deadlineTasks = useMemo(() => {
    const list = [];
    projects.forEach(p => p.tasks.forEach(t => {
      if (isTaskDeadlineSoon(t)) {
        list.push({
          proj: p, task: t,
          remain: t.end - todayWeek + 1,
          elapsed: Math.round(((todayWeek - t.start + 1) / (t.end - t.start + 1)) * 100)
        });
      }
    }));
    return list.sort((a, b) => a.remain - b.remain);
  }, [projects, isTaskDeadlineSoon, todayWeek]);

  // --- 甘特條的 roving tabindex ---
  // 107 個甘特條原本各自 tabIndex=0,鍵盤使用者要按 107 次 Tab 才穿得過甘特區。
  // 改成整區只留一個 Tab 停留點(目前聚焦過的那條,沒有就是第一條),進去之後用 ↑↓ 移動。
  // 順序直接照渲染順序算(收合的成員群組不入列),與畫面上看到的一致。
  const ganttBarTaskIds = useMemo(() => {
    const ids = [];
    groupedProjects.forEach(g => {
      if (collapsedOwners.has(g.owner)) return;
      g.projects.forEach(p => p.tasks.forEach(t => ids.push(t.id)));
    });
    return ids;
  }, [groupedProjects, collapsedOwners]);
  // ⚠ 存成字串:onRove 是從 DOM 的 data-roving-id 讀回來的(字串),onFocus 給的是原始 id(數字),
  //    兩條路徑都會寫進這個 state,故一律以字串比較,避免 32 !== '32' 造成 tab stop 找不到目標。
  const [rovingTaskId, setRovingTaskId] = useState(null);
  // 篩選/收合把原本那條藏起來時要退回第一條,否則整區會變成「沒有任何 Tab 停留點」＝鍵盤進不去
  const activeRovingTaskId = (rovingTaskId != null && ganttBarTaskIds.some(id => String(id) === String(rovingTaskId)))
    ? rovingTaskId : ganttBarTaskIds[0];

  // --- 本週統計 ---
  // ⚠ 跟著**成員下拉(ownerFilter)**走,不是永遠全隊:標題就寫在被篩選過的表格正上方,
  //   選了「玉婷」卻顯示全隊 3/21、而表格是 16/69,兩組數字對不起來(實測 all→玉婷→裕隆 晶片三次都不變)。
  //   標題會同步顯示範圍(全隊 / 成員名),使用者不必用猜的。
  // ⚠ 但**不吃搜尋與類型篩選**:那兩個是臨時的「找資料」動作,概況是「這週該做的事完成多少」的固定基準——
  //   跟著關鍵字一起跳動的話,邊打字邊變的數字沒有任何意義。
  const weekStats = useMemo(() => {
    let active = 0, reported = 0, executed = 0, monitor = 0, notExec = 0;
    projects.forEach(p => {
      if (ownerFilter !== 'all' && p.owner !== ownerFilter) return;
      p.tasks.forEach(t => {
        if (t.start <= currentWeek && t.end >= currentWeek) {
          active++;
          const log = taskLogs[t.id]?.[currentWeek];
          if (log) {
            reported++;
            if (log.status === 'not_executed') notExec++;
            else if (log.status === 'monitor') monitor++;
            else executed++;
          }
        }
      });
    });
    return { active, reported, executed, monitor, notExec, pending: active - reported };
  }, [projects, taskLogs, currentWeek, ownerFilter]);

  const myPendingTasks = useMemo(() => {
    if (role !== 'member') return [];
    const list = [];
    projects.filter(p => p.owner === currentUser).forEach(p => p.tasks.forEach(t => {
      if (t.start <= todayWeek && t.end >= todayWeek && !taskLogs[t.id]?.[todayWeek]) {
        list.push({ proj: p, task: t });
      }
    }));
    return list;
  }, [projects, taskLogs, todayWeek, role, currentUser]);

  const myCompletedTasks = useMemo(() => {
    if (role !== 'member') return [];
    const list = [];
    projects.filter(p => p.owner === currentUser).forEach(p => p.tasks.forEach(t => {
      if (t.start <= todayWeek && t.end >= todayWeek && taskLogs[t.id]?.[todayWeek]) {
        list.push({ proj: p, task: t, log: taskLogs[t.id][todayWeek] });
      }
    }));
    return list;
  }, [projects, taskLogs, todayWeek, role, currentUser]);

  // 補登面板用:檢視中週次(非本週)的待打卡/已打卡清單(成員;需主管開放補登)
  const myRetroPendingTasks = useMemo(() => {
    if (role !== 'member' || currentWeek === todayWeek) return [];
    const list = [];
    projects.filter(p => p.owner === currentUser).forEach(p => p.tasks.forEach(t => {
      if (t.start <= currentWeek && t.end >= currentWeek && !taskLogs[t.id]?.[currentWeek]) {
        list.push({ proj: p, task: t });
      }
    }));
    return list;
  }, [projects, taskLogs, currentWeek, todayWeek, role, currentUser]);

  const myRetroCompletedTasks = useMemo(() => {
    if (role !== 'member' || currentWeek === todayWeek) return [];
    const list = [];
    projects.filter(p => p.owner === currentUser).forEach(p => p.tasks.forEach(t => {
      if (t.start <= currentWeek && t.end >= currentWeek && taskLogs[t.id]?.[currentWeek]) {
        list.push({ proj: p, task: t, log: taskLogs[t.id][currentWeek] });
      }
    }));
    return list;
  }, [projects, taskLogs, currentWeek, todayWeek, role, currentUser]);

  // 「下週預計工作」也是強制回報項目:未填寫時計入待回報數,回報完最後一項任務會自動跳出填寫視窗
  const planPendingThisWeek = role === 'member' && !!currentUser && !weeklyPlans[currentUser]?.[todayWeek];
  const totalPendingCount = myPendingTasks.length + (planPendingThisWeek ? 1 : 0);

  const showTooltip = (e, proj, task) => {
    const weekLog = taskLogs[task.id]?.[currentWeek];
    const history = Object.entries(taskLogs[task.id] || {})
      .filter(([w]) => Number(w) !== currentWeek)
      .sort((a, b) => Number(a[0]) - Number(b[0]));
    setTooltip({ x: e.clientX, y: e.clientY, proj, task, weekLog, history });
  };
  const moveTooltip = (e) => setTooltip(prev => prev ? { ...prev, x: e.clientX, y: e.clientY } : null);
  const hideTooltip = () => setTooltip(null);

  // 瀏覽權限卡控:檢查完成前顯示載入畫面;卡控啟用且未通過 → 整頁無權限畫面(不顯示登入與任何資料)
  // 逾時:給錯誤畫面＋重試,不要無限轉圈(原本使用者唯一的出路是自己想到按 Ctrl+F5)
  if (accessError) {
    return (
      <div className="min-h-screen bg-slate-100 app-bg flex flex-col">
        <ErrorScreen message={accessError} onRetry={() => setAccessRetry(n => n + 1)} />
      </div>
    );
  }
  if (!accessCheck) return <div className="min-h-screen bg-slate-100 app-bg flex flex-col"><LoadingScreen /></div>;
  if (accessCheck.enabled && !accessCheck.allowed) {
    return <AccessDeniedScreen empId={empId} reason={accessCheck.reason} person={accessCheck.person} />;
  }

  return (
    // 主畫面用 h-screen(不是 min-h-screen):團隊看板改成分割欄位後會參與版面流,沒有明確高度時整棵樹會被
    // 它的內容撐到數千 px,flex-1 分不出高度、面板內部的 overflow-y-auto 就捲不動(原本它是 fixed 才沒事)。
    // 登入/載入/錯誤畫面維持 min-h-screen——那些畫面沒有內部捲動區,矮視窗時要能整頁撐開。
    <div className={`bg-slate-100 app-bg font-sans flex flex-col relative overflow-hidden ${currentUser && !dataLoading && !dataError ? 'h-screen' : 'min-h-screen'}`}>
      <header className="text-white px-4 py-2 flex justify-between items-center z-50 shadow-md" style={{ backgroundColor: NAVY }}>
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <div className="bg-white/10 p-1.5 rounded-lg border border-white/20">
              <svg className="w-5 h-5" style={{ color: GOLD }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" /></svg>
            </div>
            <span className="text-base font-bold tracking-wide">MSD 專案追蹤總表</span>
          </div>

          {/* 成果清單是「全年度」產出總表,與週次無關 → 系統週數選擇器隱藏(切回週檢視/年度總覽才出現) */}
          {currentUser && !isResults && (
            <div className="px-3 py-1 rounded-full border border-white/10 flex items-center shadow-inner" style={{ backgroundColor: '#001338' }}>
              <span className="text-white/85 mr-2 text-xs font-medium">系統週數</span>
              {role === 'manager' ? (
                <div className="flex items-center space-x-1.5">
                  {/* 切週後同步捲動置中該週(scrollTargetWeek 機制),避免「週切了但畫面停在原地」 */}
                  <button onClick={() => { const w = Math.max(1, currentWeek - 1); setCurrentWeek(w); setScrollTargetWeek(w); }} className="w-5 h-5 flex items-center justify-center bg-white/10 hover:bg-white/30 rounded-full text-xs font-bold transition" aria-label="上一週" title="上一週">‹</button>
                  <span className="inline-flex items-baseline" style={{ minWidth: 100 }}>
                    <WeekNumberInput week={currentWeek} max={weeksTotal} label={`跳至指定週次（1–${weeksTotal}）`}
                      onCommit={w => { setCurrentWeek(w); setScrollTargetWeek(w); }} />
                    <span className="text-white/75 font-normal text-[10px] ml-1">{weekToMonth(currentWeek, months)}</span>
                  </span>
                  <button onClick={() => { const w = Math.min(weeksTotal, currentWeek + 1); setCurrentWeek(w); setScrollTargetWeek(w); }} className="w-5 h-5 flex items-center justify-center bg-white/10 hover:bg-white/30 rounded-full text-xs font-bold transition" aria-label="下一週" title="下一週">›</button>
                </div>
              ) : (
                <div className="flex items-center space-x-1.5">
                  <button onClick={() => { const w = Math.max(1, currentWeek - 1); setCurrentWeek(w); setScrollTargetWeek(w); }} className="w-5 h-5 flex items-center justify-center bg-white/10 hover:bg-white/30 rounded-full text-xs font-bold transition" aria-label="檢視前一週(唯讀)" title="檢視前一週(唯讀)">‹</button>
                  {/* 成員的上限是 todayWeek(不能看未來週),打超過會自動夾回本週——與 › 鈕 disabled 的規則一致 */}
                  <span className="inline-flex items-baseline" style={{ minWidth: 100 }}>
                    <WeekNumberInput week={currentWeek} max={todayWeek} label={`跳至指定週次（1–${todayWeek}，僅能檢視本週以前）`}
                      onCommit={w => { setCurrentWeek(w); setScrollTargetWeek(w); }} />
                    <span className="text-white/75 font-normal text-[10px] ml-1">{weekToMonth(currentWeek, months)}</span>
                  </span>
                  <button onClick={() => { const w = Math.min(todayWeek, currentWeek + 1); setCurrentWeek(w); setScrollTargetWeek(w); }} disabled={currentWeek >= todayWeek}
                    className={`w-5 h-5 flex items-center justify-center rounded-full text-xs font-bold transition ${currentWeek >= todayWeek ? 'bg-white/5 text-white/20 cursor-not-allowed' : 'bg-white/10 hover:bg-white/30'}`} aria-label="檢視後一週" title="檢視後一週">›</button>
                </div>
              )}
              {role === 'member' && isViewingPast && (
                <button onClick={goToCurrentWeek}
                  className="ml-2 flex items-center bg-yellow-500/90 hover:bg-yellow-400 text-slate-900 text-[10px] font-bold px-2 py-0.5 rounded-full transition">
                  🔒 唯讀檢視中 · 返回本週 W{String(todayWeek).padStart(2, '0')}
                </button>
              )}
            </div>
          )}

          {/* 連線中斷指示:輪詢連續失敗 ≥2 次(≈2 分鐘)才亮,避免單次網路抖動就閃一下。
              放在 header 而不是工具列——工具列在看板開啟/成果清單時會收控制項,而這是系統級狀態,任何情境都必須看得到。
              琥珀底深字的晶片坐在深海軍藍 header 上,是全站對比最強的組合,不會被忽略。
              ⚠ 訊息要說「資料是幾點的快照」而不是只說「連線失敗」:使用者真正需要判斷的是「我看到的東西有多舊」。 */}
          {currentUser && syncFailures >= 2 && (
            <div role="status" aria-live="polite"
              className="flex items-center gap-2 px-3 py-1 rounded-full bg-amber-300 text-amber-950 text-[11px] font-bold border border-amber-600 shadow">
              <span aria-hidden="true">⚠</span>
              <span>
                連線中斷，畫面為
                {lastSyncAt ? ` ${String(lastSyncAt.getHours()).padStart(2, '0')}:${String(lastSyncAt.getMinutes()).padStart(2, '0')} ` : '稍早 '}
                的快照
              </span>
              <button onClick={() => { refreshData().catch(() => {}); }}
                className="px-1.5 py-0.5 rounded bg-amber-800 text-white hover:bg-amber-900 transition"
                aria-label="立即重新連線並更新資料" title="立即重新連線">重新連線</button>
            </div>
          )}
        </div>

        {currentUser && (
          <div className="flex items-center space-x-2">
            {/* 以下三個都是「編輯當週回報」入口,兩種情況一律隱藏:
                ①成果清單(全年度產出總表,與週次無關)
                ②團隊總結看板開啟時——當下是「檢視本週已完成工作」,不是編輯情境,擺著只會讓主管誤點 */}
            {!isResults && !showWeeklyReport && role === 'member' && allowRetroCheckin && currentWeek !== todayWeek && (
              // 主管開放補登時:成員檢視非當週可直接修改該週回報(任務打卡/非專案/下週預計;主管回覆不可異動)
              <button onClick={() => setShowRetroPanel(true)}
                className="bg-amber-700/80 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold shadow-md transition flex items-center gap-1 border border-amber-400/80"
                title={`主管已開放補登：可修改 W${String(currentWeek).padStart(2, '0')} 的任務打卡、非專案事項與下週預計工作`}>
                🕘 修改 W{String(currentWeek).padStart(2, '0')} 回報
              </button>
            )}
            {!isResults && !showWeeklyReport && role === 'member' && (
              // 本週回報的三件事(任務打卡/下週預計/非專案事項)合併為單一入口;紅點=未回報任務+未填下週預計(非專案為選填不計)
              <button onClick={() => setShowPendingPanel(true)}
                className="relative bg-amber-500 hover:bg-amber-600 text-white px-3.5 py-1.5 rounded-lg text-xs font-bold shadow-md transition flex items-center gap-1.5 border border-amber-400">
                <span>📋 本週回報中心</span>
                {totalPendingCount > 0 && (
                  <span className="bg-red-600 text-white text-[11px] px-1.5 py-0.5 rounded-full font-black shadow leading-none">{totalPendingCount}</span>
                )}
              </button>
            )}
            {!isResults && !showWeeklyReport && role === 'manager' && (
              <>
                {/* 主管:檢視中週次的回報編輯入口(代成員補登/修正任務打卡、非專案、下週預計,並可編輯主管回覆) */}
                <button onClick={() => setShowWeekEditPanel(true)}
                  className="bg-amber-700/80 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold shadow-md transition flex items-center gap-1 border border-amber-400/80"
                  title={`編輯 W${String(currentWeek).padStart(2, '0')} 各成員回報：代成員補登/修正任務打卡、非專案事項、下週預計工作，並可編輯主管回覆`}>
                  🛠 編輯 W{String(currentWeek).padStart(2, '0')} 回報
                </button>
              </>
            )}
            {/* 成果清單不顯示此鈕:看板是「配合甘特圖講評本週」用的(點卡片會去高亮甘特區間),
                成果清單是全年度產出總表、沒有甘特圖可對照,開了只會把清單擠窄 */}
            {!isResults && (
              <button onClick={() => setShowWeeklyReport(true)}
                className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-md text-xs font-bold shadow transition border border-blue-400/50">
                📊 W{String(currentWeek).padStart(2, '0')} 團隊總結
              </button>
            )}
            <div className="flex items-center space-x-3 border-l border-white/20 pl-3 ml-1">
              {/* 低頻管理入口收納為「⚙️ 管理」下拉選單,置於右側帳號區(網頁慣例:設定/管理在右上角,與登出同群組) */}
              {role === 'manager' && (
                <div className="relative">
                  <button onClick={() => setShowAdminMenu(v => !v)}
                    className={`px-3 py-1.5 rounded-md text-xs font-bold shadow transition border border-white/20 text-white ${showAdminMenu ? 'bg-white/25' : 'bg-white/10 hover:bg-white/20'}`}
                    title="管理功能：成員管理、瀏覽權限、使用統計、異動紀錄">
                    ⚙️ 管理 {showAdminMenu ? '▴' : '▾'}
                  </button>
                  {showAdminMenu && (
                    <>
                      {/* 選單無輸入內容,點選單外關閉不會遺失資料(輸入型視窗「不點外關閉」慣例的例外) */}
                      <div className="fixed inset-0 z-[60]" onClick={() => setShowAdminMenu(false)}></div>
                      <div className="absolute right-0 top-full mt-1.5 z-[70] w-44 bg-white rounded-xl shadow-2xl border border-slate-300 py-1.5 overflow-hidden">
                        {[
                          { icon: '👥', label: '成員管理', desc: '新增/移除/改名', open: () => setShowMemberPanel(true) },
                          { icon: '🔐', label: '瀏覽權限', desc: '部門/工號卡控', open: () => setShowAccessPanel(true) },
                          { icon: '📈', label: '使用統計', desc: '登入次數/使用率', open: () => setShowUsagePanel(true) },
                          { icon: '📜', label: '異動紀錄', desc: '操作稽核', open: () => setShowAuditPanel(true) }
                        ].map(item => (
                          <button key={item.label}
                            onClick={() => { setShowAdminMenu(false); item.open(); }}
                            className="w-full text-left px-3.5 py-2 hover:bg-slate-100 transition flex items-center gap-2.5">
                            <span className="text-base">{item.icon}</span>
                            <span className="min-w-0">
                              <span className="block text-xs font-bold text-slate-800">{item.label}</span>
                              <span className="block text-[10px] text-slate-500">{item.desc}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
              <div className="text-right leading-tight">
                <div className="font-bold text-sm">{currentUser}</div>
                <div className="text-[10px] text-white/80">{role === 'manager' ? '主管' : '成員'}{empId ? ` · 工號 ${empId}` : ''}</div>
              </div>
              <button onClick={() => setIsDark(v => !v)} className="p-1.5 hover:bg-white/20 rounded-lg transition text-white/80 hover:text-white bg-white/5 text-sm leading-none w-8 h-8 flex items-center justify-center" aria-label={isDark ? '切換為淺色模式' : '切換為深色模式'} title={isDark ? '切換為淺色模式' : '切換為深色模式'}>
                {isDark ? '☀️' : '🌙'}
              </button>
              <button onClick={handleLogout} className="p-1.5 hover:bg-red-500/80 rounded-lg transition text-white/70 hover:text-white bg-white/5" aria-label="登出" title="登出">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
              </button>
            </div>
          </div>
        )}
      </header>

      {dataLoading ? (
        <LoadingScreen />
      ) : dataError ? (
        <ErrorScreen message={dataError} onRetry={loadBootstrap} />
      ) : !currentUser ? (
        <LoginScreen onLogin={handleLogin} users={users} year={scheduleYear} empId={empId} />
      ) : (
        // 主內容區在看板開啟時整塊內縮(讓出的寬度給看板),工具列與甘特都只跨左半邊:
        // ①「週檢視/年度總覽/密度」那排會待在甘特正上方,不會飄到看板頭上
        // ②甘特可視寬與捲動範圍都排除看板區 → 當週能真的置中、年底區間捲得出來
        // ③看板本身是 fixed 從視窗最頂端蓋下來(連 header 一起蓋),視覺上是一整條完整欄位
        // ⚠ 內縮後工具列會變窄,務必同時收起「找資料」類控制項,否則 overflow-x-auto 會吐橫向捲軸
        <div className="flex-1 min-h-0 flex overflow-hidden bg-white relative"
          style={{ marginRight: showWeeklyReport ? reportPanelW : 0 }}>
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {isResults ? (
            <div className="px-4 py-2 border-b border-slate-300 bg-gradient-to-r from-amber-50/80 via-white to-white dark:bg-none dark:bg-slate-800 flex items-center justify-between text-xs overflow-x-auto">
              <div className="flex items-center gap-3">
                <span className="font-black text-amber-800 dark:text-amber-300 text-sm">🎯 {scheduleYear} 年度成果與 MP 效益清單</span>
                <span className="text-slate-500">檢視所有專案完工預計交付之具體產出與累計節省之 MP 人力</span>
              </div>
              <div className="flex items-center gap-4">
                <div className="bg-amber-100/80 border border-amber-300 text-amber-900 px-3 py-1 rounded-full font-bold">
                  已填寫產出項目：{projects.filter(p => p.deliverable).length} / {projects.length} 案
                </div>
                <div className="bg-emerald-100/80 border border-emerald-300 text-emerald-900 px-3 py-1 rounded-full font-bold">
                  💡 MP Saving：{projects.filter(p => p.mpSaving).length} 案
                </div>
              </div>
            </div>
          ) : (
            <div className="px-4 py-2 border-b border-slate-300 bg-gradient-to-r from-slate-50 to-white flex items-center gap-3 text-xs overflow-x-auto">
              {/* 統計範圍要寫出來:這排數字現在跟著成員下拉走,標題不講清楚就會變成「同一個字看到兩組數字」 */}
              <div className="flex items-center flex-shrink-0">
                <span className="font-black text-slate-900 text-sm">W{String(currentWeek).padStart(2, '0')}</span>
                <span className="text-slate-600 ml-1 text-[10px]">{weekToMonth(currentWeek, months)}</span>
                <span className="ml-1 text-[10px] font-bold text-slate-700">{ownerFilter === 'all' ? '全隊' : ownerFilter}概況</span>
              </div>
              {/* 回報率進度條 */}
              <div className="flex items-center flex-shrink-0 min-w-[150px]">
                <div className="flex-1 h-2 bg-slate-300 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-500 ${weekStats.active > 0 && weekStats.reported === weekStats.active ? 'bg-green-600' : 'bg-indigo-600'}`}
                    style={{ width: `${weekStats.active > 0 ? (weekStats.reported / weekStats.active) * 100 : 0}%` }}></div>
                </div>
                <span className="ml-2 font-bold text-slate-800 whitespace-nowrap">{weekStats.reported}/{weekStats.active} 已回報</span>
              </div>
              {/* 狀態分佈＋即將到期:看板開啟時整區收起(連前面的分隔線一起,否則會留下孤立的豎線)。
                  看板裡每位成員的分段條已把同一組狀態拆得更細,全隊加總屬重複資訊;
                  「⏰即將到期」會開另一個面板、跳出「檢視本週」的情境,講評當下不需要。 */}
              {/* 看板開啟時整區收起,但「未回報」若正在篩選中必須留著(否則使用者看到清單只剩幾列、
                  卻找不到任何地方可以取消)——沿用工具列既有的「有殘留條件就保留該顆＋可清除」規則 */}
              {(!showWeeklyReport || pendingOnly) && (
                <>
                  <div className="h-6 border-l border-slate-300 flex-shrink-0"></div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {!tightStatsBar && <StatChip label="有執行" value={weekStats.executed} className="bg-green-100 text-green-800 border-green-400" />}
                    {!tightStatsBar && <StatChip label="Monitor" value={weekStats.monitor} className="bg-sky-100 text-sky-800 border-sky-400" />}
                    {!tightStatsBar && <StatChip label="未執行" value={weekStats.notExec} className="bg-slate-200 text-slate-700 border-slate-400" />}
                    <StatChip label="未回報" value={weekStats.pending}
                      className={weekStats.pending > 0 ? 'bg-yellow-100 text-yellow-800 border-yellow-500' : 'bg-slate-100 text-slate-500 border-slate-300'}
                      onToggle={() => setPendingOnly(v => !v)} active={pendingOnly}
                      title={pendingOnly ? '取消篩選，顯示全部專案' : '只顯示本週尚未回報的專案'} />
                    {!showWeeklyReport && <button onClick={() => setShowDeadlinePanel(true)} title="點擊檢視即將到期清單"
                      className={`flex-shrink-0 pl-2 pr-2.5 py-1 rounded-full font-bold flex items-center gap-1 border transition ${deadlineTasks.length > 0 ? 'bg-orange-100 text-orange-800 hover:bg-orange-200 border-orange-500' : 'bg-slate-100 text-slate-500 hover:bg-slate-200 border-slate-300'}`}>
                      <span className="font-medium text-[11px]">⏰ 即將到期</span>
                      <span className="text-[13px] leading-none">{deadlineTasks.length}</span>
                      <span className="text-[11px]">›</span>
                    </button>}
                  </div>
                </>
              )}
              <div className="flex-1 min-w-[8px]"></div>
              {/* 常駐精簡圖例(不用 hidden xl:flex,窄螢幕也要看得到):標籤精簡+title 補完整說明;
                  「⏰即將到期」不放圖例(左側同名按鈕已表達,避免同列重複出現) */}
              <div className="flex-shrink-0 flex items-center gap-2 text-[11px] text-slate-600 border border-slate-300 rounded-lg bg-white ctl-raised px-2 py-0.5">
                <span className="flex items-center" title="黃色斜紋條＝計畫區間(排定的起訖週)"><span className="w-3 h-2.5 mr-1 rounded-sm border" style={{ backgroundImage: 'repeating-linear-gradient(45deg,#FFF6D6,#FFF6D6 3px,#FDEDB8 3px,#FDEDB8 6px)', borderColor: '#B45309' }}></span>計畫</span>
                <span className="flex items-center" title="綠色＝該週回報「有執行」"><span className="w-2.5 h-2.5 bg-green-700 mr-1 rounded-sm"></span>有執行</span>
                <span className="flex items-center" title="藍色＝該週回報「Monitor(例行監控)」"><span className="w-2.5 h-2.5 bg-sky-700 mr-1 rounded-sm"></span>Monitor</span>
                <span className="flex items-center" title="灰色＝該週回報「未執行」"><span className="w-2.5 h-2.5 bg-slate-500 mr-1 rounded-sm"></span>未執行</span>
                <span className="flex items-center" title="紅框＋❗＝本週排定但尚未回報的任務"><span className="w-3 h-2.5 mr-1 rounded-sm border-2 border-red-400 bg-white"></span>❗待回報</span>
                {/* 鍵盤快捷鍵提示:常駐小字(輔助資訊直接顯示原則),完整說明放 title;
                    看板開啟**或視窗本身太窄**時收起讓出寬度(見 tightStatsBar)
                    ——甘特條色義的圖例(上面五項)不收,那是讀圖必需 */}
                {!tightStatsBar && (
                  <span className="flex items-center text-slate-600 border-l border-slate-300 pl-2"
                    title="鍵盤快捷鍵：H＝回到本週並置中；← →＝左右平移 4 週；Shift＋← →＝微移 1 週；Tab 進入甘特條後 ↑ ↓＝上下切換甘特條、Enter＝開啟該區間；ESC＝關閉最上層視窗">
                    ⌨ H 回本週・←→ 平移・↑↓ 換條
                  </span>
                )}
              </div>
            </div>
          )}

          {/* 工具列:單列不斷行(nowrap+水平捲動保險),操作元件縮小一號(內容區才是主角) */}
          <div className="bg-white px-4 py-1.5 border-b border-slate-300 flex flex-nowrap items-center gap-1.5 text-[11px] z-30 overflow-x-auto [&>*]:flex-shrink-0">
            {/* 內容區變窄時(看板開啟 **或視窗本身就不夠寬**,見 tightToolbar):把「找資料」用的搜尋框與
                a~e 類型晶片收起來,讓「看資料」用的年度／檢視切換／密度／展開收合往左移到甘特正上方
                (講評當下不會臨時改篩選條件;變寬即恢復)。
                有殘留的篩選條件才保留晶片,否則使用者會不知道畫面為何只剩部分專案。 */}
            {(!tightToolbar || searchText) && (
              <div className="relative">
                <svg className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>
                {/* 寬度兩段:一般 w-44(176);空間不足時 w-32(128)。
                    ⚠ 空間不足時這個框只會因為「有殘留關鍵字」而留著(見上方條件),此時同時保留的還有
                      已選中的類型晶片＋清除鈕——兩者疊加在 1024 會再溢出 31px,收窄 48px 正好吸收掉。
                      不能直接把框藏起來:使用者會看不到自己正在用什麼關鍵字篩選,也沒有地方可以清掉。
                    ⚠ 原本還有 `focus:w-52`(聚焦放大到 208):在 flex-nowrap 工具列裡打字會把右邊所有控制項
                      往外推,且 1366 剛好被推爆(自然寬 1338＋32 > 1366)→ 一打字就冒出橫向捲軸,已移除。 */}
                <input value={searchText} onChange={e => setSearchText(e.target.value)} placeholder="搜尋專案 / 任務…"
                  className={`pl-7 pr-6 py-1 border border-slate-300 rounded-lg outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-200 transition ${tightToolbar ? 'w-32' : 'w-44'}`} />
                {searchText && <button onClick={() => setSearchText('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-600 font-bold px-1">×</button>}
              </div>
            )}

            {(!tightToolbar || typeFilter.size > 0) && (
              <div className="flex items-center space-x-1">
                {Object.entries(PROJECT_TYPES).map(([key, meta]) => {
                  const on = typeFilter.has(key);
                  if (tightToolbar && !on) return null;   // 空間不足時只留「已選中」的晶片(方便一鍵取消)
                  return (
                    <button key={key} onClick={() => toggleTypeFilter(key)}
                      className={`px-1.5 py-0.5 rounded-full border font-bold transition ${on ? meta.chip + ' ring-1 ring-offset-1 ring-slate-500' : 'bg-white ctl-raised text-slate-700 border-slate-400 hover:border-slate-600 hover:bg-slate-50'}`}
                      title={meta.label}>
                      {key}·{meta.label}
                    </button>
                  );
                })}
                {typeFilter.size > 0 && <button onClick={() => setTypeFilter(new Set())} className="text-blue-600 hover:underline px-1">清除</button>}
              </div>
            )}

            {(!tightToolbar || searchText || typeFilter.size > 0) && <div className="h-5 border-l border-slate-300"></div>}

            {/* 成員下拉:三個檢視共用同一個控制項與同一份 ownerFilter,切檢視不會重設,
                使用者選了誰就一路帶著走(原本週檢視是勾選框、成果清單是下拉,同一件事兩種操作) */}
            {(
              <select value={ownerFilter} onChange={e => setOwnerFilter(e.target.value)}
                title="篩選要顯示哪位成員的專案"
                className="border border-slate-300 rounded-lg px-2 py-1 outline-none bg-white ctl-raised font-medium text-slate-700">
                <option value="all">全部成員</option>
                {users.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            )}

            <div className="flex-1"></div>

            <select value={scheduleYear}
              onChange={e => { const y = parseInt(e.target.value); setScheduleYear(y); setCurrentWeek(getTodayWeek(y)); }}
              title="切換排程年度(年度資料由 DB 的 ScheduleWeeks 決定)"
              className="border border-slate-300 rounded-lg px-2 py-1 outline-none bg-white ctl-raised font-bold text-slate-700">
              {(years.length ? years : [scheduleYear]).map(y => <option key={y} value={y}>{y} 年度</option>)}
            </select>

            {/* 檢視切換:週檢視=可打卡操作(可水平捲動);年度總覽=52 週縮放進一頁供主管瀏覽全貌 */}
            {/* 檢視切換: 週檢視=可打卡操作; 年度總覽=整年全景; 成果清單=具體產出與MP總表 */}
            {/* 成員切入成果清單:改用成員下拉、預設看自己;切回週檢視/年度總覽:還原「只看我的」預設 */}
            <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: BRAND_BTN }}>
              {/* 切檢視不再動成員篩選:三個檢視共用同一個下拉,選了誰就一路帶著走 */}
              <button onClick={() => { setIsOverview(false); setIsResults(false); savePref('overview', false); }}
                className={`px-2 py-1 font-bold transition ${!isOverview && !isResults ? 'text-white' : 'bg-white text-slate-600 hover:bg-slate-100'}`}
                style={!isOverview && !isResults ? { backgroundColor: BRAND_BTN } : {}}>週檢視</button>
              <button onClick={() => { setIsOverview(true); setIsResults(false); savePref('overview', true); }}
                className={`px-2 py-1 font-bold transition ${isOverview && !isResults ? 'text-white' : 'bg-white text-slate-600 hover:bg-slate-100'}`}
                style={isOverview && !isResults ? { backgroundColor: BRAND_BTN } : {}}
                title={`整年 ${weeksTotal} 週自動縮放至一個畫面寬(無水平捲軸),滑鼠停留甘特條可看細節`}>年度總覽</button>
              {/* 成果清單＝全年度產出總表,與「檢視本週」無關 → 看板開啟時整顆隱藏(分段控制剩兩段,
                  外框圓角在容器上,少一段不影響外觀)。下方 onClick 的關閉邏輯保留為防呆:
                  萬一日後有別條路徑帶著看板切過來,清單仍不會被擠窄、也不會殘留單一成員的篩選 */}
              {!showWeeklyReport && (
              <button onClick={() => {
                  if (showWeeklyReport) {
                    setShowWeeklyReport(false);
                    setHighlightedTaskId(null);
                    setCollapsedOwners(new Set());
                    setOwnerFilter(defaultOwnerFilter(role, currentUser));   // 清掉看板高亮造成的單一成員聚焦
                  }
                  // 「本週未回報」在全年度產出總表沒有意義,切過去一併清掉;
                  // 不清的話清單會莫名只剩幾列,而該檢視根本沒有那顆晶片可以取消(與 ownerFilter 的還原同理)
                  setPendingOnly(false);
                  setIsOverview(false); setIsResults(true);
                }}
                className={`px-2 py-1 font-bold transition ${isResults ? 'text-white' : 'bg-white text-slate-600 hover:bg-slate-100'}`}
                style={isResults ? { backgroundColor: BRAND_BTN } : {}}
                title="檢視全年度所有專案的具體產出項目與 MP Saving 統計(高階主管瀏覽視角,唯讀)">成果清單</button>
              )}
            </div>
            {/* 年度總覽也要有:它同樣有週次列、當週高亮與紅線,點到 W15 後若沒有這顆,
                只能用 header 的 ‹ › 一週一週按回來(H 快捷鍵沒人知道)。成果清單無週次概念故仍不顯示。 */}
            {!isResults && (
              <button onClick={goToCurrentWeek} title={`回到本週 W${String(todayWeek).padStart(2, '0')} 並置中（快捷鍵 H）`}
                className="flex items-center text-white px-2 py-1 rounded-lg font-bold shadow-sm transition hover:opacity-90" style={{ backgroundColor: BRAND_BTN }}>
                <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                回到本週
              </button>
            )}
            <div className="h-5 w-px bg-slate-300/80 mx-1 flex-shrink-0"></div>
            {!isOverview && !isResults && (
              <button onClick={() => { const v = !isCompact; setIsCompact(v); savePref('compact', v); }} className="text-slate-600 bg-slate-100 ctl-raised hover:bg-slate-200 px-2 py-1 rounded-lg border border-slate-300 font-medium transition">
                {isCompact ? '寬鬆模式' : '緊湊模式'}
              </button>
            )}
            {/* 補登總開關:成果清單與看板開啟時都隱藏。這顆是改寫入權限的系統設定(誤點會直接對全體開放
                歷史補登,下方還會多一整條琥珀警示列),而它管的是「當週打卡」——成果清單是全年度產出總表、
                看板是唯讀講評情境,兩者都與當週寫入權限無關 */}
            {role === 'manager' && !isResults && !showWeeklyReport && (
              // 長文字縮短:完整說明放 title;開啟時下方另有整條琥珀色警示列,資訊不會漏
              <button onClick={toggleRetroCheckin}
                className={`px-2 py-1 rounded-lg font-bold border shadow-sm transition flex items-center gap-1 ${allowRetroCheckin ? 'bg-amber-500 hover:bg-amber-600 text-white border-amber-600' : 'bg-slate-100 ctl-raised hover:bg-slate-200 text-slate-700 border-slate-300'}`}
                title={allowRetroCheckin ? '目前開放全體成員回報/調正今年度的所有歷史週次紀錄，點擊關閉' : '目前成員僅能回報當週，點擊開放歷史補登'}>
                <span>{allowRetroCheckin ? '🔓 補登 ON' : '🔒 僅限當週'}</span>
              </button>
            )}
            {/* 展開/收合只作用於甘特圖的成員群組列,成果清單(單一平面表)用不到 → 隱藏 */}
            {!isResults && (
              <>
                <div className="h-5 w-px bg-slate-300/80 mx-1 flex-shrink-0"></div>
                <button onClick={() => setCollapsedOwners(new Set())} title="展開全部成員群組" className="text-blue-600 hover:text-blue-800 font-medium">展開</button>
                <span className="text-slate-500" aria-hidden="true">|</span>
                <button onClick={() => setCollapsedOwners(new Set(users))} title="收合全部成員群組" className="text-blue-600 hover:text-blue-800 font-medium">收合</button>
              </>
            )}
          </div>

          {allowRetroCheckin && (
            <div className="bg-amber-50 border-b border-amber-300 px-4 py-2 flex items-center justify-between text-xs text-amber-900 font-bold z-30">
              <div className="flex items-center gap-2">
                <span className="text-sm">⚠️</span>
                <span>系統已開啟「全體成員歷史進度補登與調正」豁免期：目前可對 W{String(todayWeek).padStart(2, '0')} 以前之所有歷史週次進行任務與非專案回報。</span>
              </div>
              {role === 'manager' && (
                <button onClick={toggleRetroCheckin} className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded font-bold shadow-sm transition">
                  關閉豁免期
                </button>
              )}
            </div>
          )}

          {/* 甘特區與團隊看板＝**左右分割**(不是把看板 fixed 疊在最上層):
              ①看板從工具列下方開始 → 週檢視/年度總覽/緊湊模式等甘特控制項不會被蓋住,開著看板也能切換
              ②甘特寬度由 flex 自然算出 → 可視寬與捲動範圍都排除看板區,當週能真的置中、年底區間捲得出來
              ⚠ 曾用「外層內容區 marginRight」做,結果上方兩條 overflow-x-auto 工具列被壓窄,各吐出一條橫向捲軸;
                 改只縮捲動容器後捲軸沒了,卻換成工具列右半被看板蓋住。分割版兩個問題都不存在。 */}
          <div ref={ganttRef} className="flex-1 min-h-0 overflow-auto bg-slate-100 app-bg relative">
            {isResults ? (
              <ResultsView
                projects={filteredProjects}
                role={role}
                currentUser={currentUser}
                year={scheduleYear}
                starredIds={starredIds}
                toggleStar={toggleStar}
              />
            ) : (
              <>
              {/* 凍結欄「遮罩層」:單一不透明實色蓋住整個左側凍結區,z 介於甘特條(10)與凍結格(30)之間,
                  徹底杜絕捲動時甘特條從欄位縫隙透出的次像素滲色(高度用負 margin 抵銷,不佔版面/不撐長捲軸) */}
              <div aria-hidden="true" className="sticky left-0 z-20 pointer-events-none"
                style={{ width: frozenW, height: 100000, marginBottom: -100000, background: 'var(--frozen-bg)' }}></div>
              <table className="border-collapse bg-white" style={{ tableLayout: 'fixed', width: isOverview ? '100%' : frozenW + weeksTotal * weekW }}>
              <colgroup>
                {!isOverview && <col style={{ width: 28 }} />}
                {!isOverview && <col style={{ width: 42 }} />}
                <col style={{ width: nameW }} />
                {Array.from({ length: weeksTotal }).map((_, i) => <col key={i} style={isOverview ? undefined : { width: weekW }} />)}
              </colgroup>
              <thead className="sticky top-0 z-40 text-xs shadow-sm bg-slate-100">
                <tr>
                  <th colSpan={isOverview ? 1 : 3} className="border-r border-b border-slate-300 bg-slate-200 sticky left-0 z-50 px-2 py-1 text-left" style={{ width: frozenW }}>
                    <div className="flex justify-between items-center text-[10px]">
                      <span className="font-bold text-slate-700">專案基本資訊</span>
                      {/* slate-700:此處底色是抬升過的 bg-slate-200(深色 #3E4C61),10px 字用 slate-600 在投影 50:1 只有 4.17 */}
                      <span className="text-slate-700 font-normal">顯示 {filteredProjects.length} / {projects.length} 項</span>
                    </div>
                  </th>
                  {months.map((m, i) => (
                    <th key={i} colSpan={m.weeks} className="border-r border-b border-slate-300 text-white p-0.5 text-center font-medium text-[11px] tracking-wider relative overflow-hidden" style={{ backgroundColor: i % 2 === 0 ? NAVY : '#0A3178' }}>
                      <div className="absolute inset-0 bg-gradient-to-b from-white/10 to-transparent"></div>
                      {m.name.slice(0, 4)}/{m.name.slice(4)}
                    </th>
                  ))}
                </tr>
                {/* 週次列:年度總覽也要有(原本整列被關掉,導致總覽下看不出週別、也無法點週次移動紅線)。
                    總覽的週欄只有 ~21~32px 寬,故不加固定寬度、只顯示數字(同緊湊模式的處理) */}
                <tr className="bg-slate-100 text-slate-600 text-[11px]">
                  {!isOverview && <th className="border-r border-b border-slate-300 p-1 sticky left-0 z-50 text-center font-medium" style={{ width: 28, minWidth: 28, maxWidth: 28, backgroundColor: 'var(--gantt-sticky)' }}>No</th>}
                  {!isOverview && <th className="border-r border-b border-slate-300 p-1 sticky z-50 text-center font-medium" style={{ width: 42, minWidth: 42, maxWidth: 42, left: 28, backgroundColor: 'var(--gantt-sticky)' }}>分類</th>}
                  <th className="border-r border-b border-slate-300 p-1 sticky z-50 shadow-[3px_0_6px_rgba(0,0,0,0.08)] text-left pl-3 font-medium" style={{ width: nameW, minWidth: nameW, maxWidth: nameW, left: isOverview ? 0 : STICKY_LEAD_W, backgroundColor: 'var(--gantt-sticky)' }}>專案名稱 (Project Name)</th>
                  {Array.from({ length: weeksTotal }).map((_, i) => {
                    const weekNum = i + 1;
                    const isCurrent = weekNum === currentWeek;
                    return (
                      <th key={i}
                        onClick={() => { if (role === 'manager' || weekNum <= todayWeek) setCurrentWeek(weekNum); }}
                        title={role === 'manager' ? `點擊將系統週切換至 W${weekNum}` : (weekNum <= todayWeek ? `點擊檢視 W${weekNum}(唯讀)` : undefined)}
                        className={`border-r border-b border-slate-300 p-0 text-center relative ${isOverview ? 'text-[9px] leading-none' : ''} ${(role === 'manager' || weekNum <= todayWeek) ? 'cursor-pointer hover:bg-blue-100' : ''} ${isCurrent ? 'text-white font-bold' : weekNum > todayWeek ? 'bg-slate-100 text-slate-600 font-normal' : 'bg-slate-100 text-slate-700 font-normal'}`}
                        style={{ ...(isOverview ? {} : { width: weekW }), ...(isCurrent ? { backgroundColor: NAVY } : {}) }}>
                        {isCurrent && <div className="absolute -bottom-px left-0 right-0 h-0.5" style={{ backgroundColor: GOLD }}></div>}
                        <div className={`z-10 relative ${isOverview ? 'py-0.5' : 'py-1'}`}>
                          {isOverview
                            ? (sparseWeekLabel && !isCurrent && weekNum % 5 !== 0 ? ' ' : weekNum)
                            : (isCompact ? weekNum : `W${String(weekNum).padStart(2, '0')}`)}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>

              <tbody className="text-xs">
                {groupedProjects.length === 0 ? (
                  <tr><td colSpan={weeksTotal + 3} className="p-10 text-center text-slate-500">
                    <div className="text-3xl mb-2">{pendingOnly && weekStats.pending === 0 ? '🎉' : '🔍'}</div>
                    {/* 「未回報」篩選開著而結果為 0,其實是好消息(全部都交了),不要當成「找不到資料」報給使用者 */}
                    {pendingOnly && weekStats.pending === 0 ? (
                      <div className="space-y-2">
                        <div className="font-bold text-slate-700">
                          W{String(currentWeek).padStart(2, '0')} {ownerFilter === 'all' ? '全隊' : ownerFilter}已全數回報，沒有待追蹤的項目。
                        </div>
                        <button onClick={() => setPendingOnly(false)}
                          className="px-3 py-1 rounded-lg bg-white border border-slate-400 font-bold text-slate-700 hover:bg-slate-100 transition">
                          顯示全部專案
                        </button>
                      </div>
                    ) : '找不到符合條件的專案。調整搜尋關鍵字或清除篩選後再試一次。'}
                  </td></tr>
                ) : groupedProjects.map((group) => {
                  const isCollapsed = collapsedOwners.has(group.owner);
                  let gActive = 0, gReported = 0;
                  group.projects.forEach(p => p.tasks.forEach(t => {
                    if (t.start <= currentWeek && t.end >= currentWeek) {
                      gActive++;
                      if (taskLogs[t.id]?.[currentWeek]) gReported++;
                    }
                  }));
                  return (
                    <React.Fragment key={group.owner}>
                      {/* --- 修改點 1: 移除群組標題背景的 /95 透明度，使用純色 bg-blue-50 --- */}
                      {/* 展開/收合成員群組:role 保留原生 row,只補可聚焦與 Enter/Space(換成 button 會破壞 table 列結構) */}
                      <tr {...clickable(() => toggleOwnerCollapse(group.owner), null, { role: null, expanded: !isCollapsed })}
                        title={`${isCollapsed ? '展開' : '收合'} ${group.owner} 的專案`}
                        className="group/header bg-[var(--gantt-group)] hover:bg-[var(--gantt-group-hover)] cursor-pointer border-b border-blue-100 transition-colors">
                        <td colSpan={isOverview ? 1 : 3} className="sticky left-0 z-40 border-r border-blue-200 p-0 shadow-[3px_0_6px_rgba(0,0,0,0.06)]" style={{ width: frozenW, minWidth: frozenW, maxWidth: frozenW, backgroundColor: 'var(--gantt-group)' }}>
                          <div className="flex items-center text-blue-900 font-bold text-[13px] px-2 py-1.5 border-l-4" style={{ borderColor: NAVY }}>
                            <svg className={`w-4 h-4 mr-1 text-blue-500 transition-transform ${isCollapsed ? '-rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                            <div className="w-6 h-6 rounded-full text-white flex items-center justify-center text-xs mr-2 flex-shrink-0" style={{ backgroundColor: BRAND_BTN }}>{group.owner[0]}</div>
                            {group.owner}
                            <span className="ml-2 px-1.5 py-0.5 bg-white ctl-raised text-blue-600 rounded text-[10px] font-medium border border-blue-100">{group.projects.length} 項</span>
                            {gActive > 0 && (
                              <div className="ml-2 flex items-center gap-1.5">
                                {!isOverview && (
                                  <div className="w-16 h-1.5 bg-white rounded-full overflow-hidden border border-blue-100">
                                    <div className={`h-full rounded-full ${gReported === gActive ? 'bg-green-600' : 'bg-yellow-400'}`} style={{ width: `${(gReported / gActive) * 100}%` }}></div>
                                  </div>
                                )}
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${gReported === gActive ? 'bg-green-100 text-green-800 border-green-200' : 'bg-yellow-100 text-yellow-800 border-yellow-300'}`}>
                                  本週回報 {gReported}/{gActive}
                                </span>
                              </div>
                            )}
                            {role === 'manager' && !isOverview && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setEditingProject({ mode: 'add', owner: group.owner }); }}
                                className="ml-auto flex-shrink-0 flex items-center gap-1 bg-white ctl-raised text-blue-700 hover:bg-blue-600 hover:text-white border border-blue-300 rounded px-2 py-0.5 text-[10px] font-bold transition shadow-sm"
                                title={`為 ${group.owner} 新增專案`}>
                                ＋ 新增專案
                              </button>
                            )}
                          </div>
                        </td>
                        <td colSpan={weeksTotal} className="p-0 border-r border-slate-300">
                          <div className="w-full h-full flex opacity-30">
                            {Array.from({ length: weeksTotal }).map((_, i) => (
                              <div key={i} className={`flex-1 border-r border-slate-300 ${i + 1 === currentWeek ? 'bg-red-100' : ''}`}></div>
                            ))}
                          </div>
                        </td>
                      </tr>

                      {!isCollapsed && group.projects.map((proj, idx) => (
                        <tr key={proj.id} data-proj-row={proj.id}
                          onDragOver={role === 'manager' && dragState && dragState.owner === group.owner ? (e) => { e.preventDefault(); if (dragOverId !== proj.id) setDragOverId(proj.id); } : undefined}
                          onDrop={role === 'manager' && dragState ? (e) => { e.preventDefault(); handleReorderProjects(group.owner, dragState.id, proj.id); setDragState(null); setDragOverId(null); } : undefined}
                          className={`group/row border-b border-slate-300 transition-colors ${dragOverId === proj.id && dragState && dragState.id !== proj.id ? 'border-t-2 border-t-blue-500' : ''} ${dragState && dragState.id === proj.id ? 'opacity-40' : ''}`}>
                          {!isOverview && <td className={`text-center sticky left-0 bg-white group-hover/row:bg-[var(--gantt-row-hover)] z-30 border-r border-slate-300 text-slate-500 font-medium ${isCompact ? 'py-1' : 'py-2'}`} style={{ width: 28, minWidth: 28, maxWidth: 28, boxShadow: '2px 0 0 0 var(--frozen-bg)' }}>{idx + 1}</td>}
                          {!isOverview && <td className={`text-center sticky bg-white group-hover/row:bg-[var(--gantt-row-hover)] z-30 border-r border-slate-300 text-slate-800 font-medium ${isCompact ? 'py-1' : 'py-2'}`} style={{ width: 42, minWidth: 42, maxWidth: 42, left: 28, boxShadow: '2px 0 0 0 var(--frozen-bg)' }}>{proj.category}</td>}
                          {/* --- 嚴格設定 100% 純實色背景與絕對寬度，防止橫向捲動時甘特條穿透或重疊 --- */}
                          <td className="sticky bg-white group-hover/row:bg-[var(--gantt-row-hover)] z-30 border-r border-slate-300 p-0" style={{ width: nameW, minWidth: nameW, maxWidth: nameW, left: isOverview ? 0 : STICKY_LEAD_W, boxShadow: '2px 0 0 0 var(--frozen-bg), 4px 0 8px rgba(0,0,0,0.08)' }}>
                            <div className="w-full h-full flex items-center px-2 overflow-hidden">
                              {role === 'manager' && !isOverview && (
                                isFilteringRows ? (
                                  <span className="flex-shrink-0 mr-1 text-slate-200 select-none text-[13px] leading-none cursor-not-allowed"
                                    title="搜尋/類型篩選中無法拖曳排序，請先清除篩選">⠿</span>
                                ) : (
                                  <span
                                    draggable
                                    onDragStart={() => setDragState({ id: proj.id, owner: group.owner })}
                                    onDragEnd={() => { setDragState(null); setDragOverId(null); }}
                                    className="flex-shrink-0 mr-1 cursor-grab active:cursor-grabbing text-slate-500 hover:text-slate-600 select-none text-[13px] leading-none"
                                    title="拖曳以調整排序">⠿</span>
                                )
                              )}
                              <div className={`flex-shrink-0 px-1.5 py-0.5 mr-2 text-[9px] font-bold rounded-sm border ${PROJECT_TYPES[proj.type].chip}`}>{proj.type.toUpperCase()}</div>
                              {/* 範本 B:專案名稱近全黑+加粗,寬鬆模式 15px(預設)/緊湊 13px/總覽 12.5px */}
                              <span className={`flex-1 min-w-0 truncate font-semibold text-slate-900 ${isOverview ? 'text-[12.5px]' : isCompact ? 'text-[13px]' : 'text-[15px]'}`} title={proj.nid ? `${proj.name}\nNID：${proj.nid}` : proj.name}>{proj.name}</span>
                              {/* 具體產出項目(專案執行完畢後的成果)入口:已填=實色,未填=淡色;負責人與主管可編輯,其他人唯讀 */}
                              <button
                                onClick={(e) => { e.stopPropagation(); setDeliverableProj(proj); }}
                                className={`flex-shrink-0 ml-1 text-[12px] leading-none transition hover:scale-125 ${proj.deliverable ? 'opacity-90' : 'opacity-25 hover:opacity-70'}`}
                                title={proj.deliverable || proj.mpSaving
                                  ? `具體產出項目：${proj.deliverable || '（未填寫）'}${proj.mpSaving ? `\n💡 MP Saving：${proj.mpSaving}` : ''}`
                                  : '具體產出項目（尚未填寫，點擊檢視/填寫）'}>🎯</button>
                              {/* 到期徽章放在「凍結」的左欄:橫向捲動到別的月份時提醒依然可見 */}
                              {(() => {
                                const soon = proj.tasks.filter(isTaskDeadlineSoon);
                                if (soon.length === 0) return null;
                                const remain = Math.min(...soon.map(t => t.end - todayWeek + 1));
                                // orange-800(不是 700):9px 的字在投影 50:1 下 700 只有 4.18,800 為 5.64
                                // ⚠ 這行原本寫成 `return ( {/* … */} <span…> )`——JSX 註解放進 return 的括號裡
                                //   會被當成第二個運算式,Babel 直接 UnexpectedToken 建置失敗。註解要放 return 之外。
                                return (
                                  <span className="flex-shrink-0 ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-orange-100 text-orange-800 border border-orange-300 whitespace-nowrap"
                                    title={`${soon.length} 個計畫區間即將到期(最近的剩 ${remain} 週)`}>
                                    ⏰ 剩{remain}週
                                  </span>
                                );
                              })()}
                              {role === 'manager' && !isOverview && (
                                <div className="flex-shrink-0 hidden group-hover/row:flex items-center gap-0.5 ml-1">
                                  <button onClick={() => setAddingInterval(proj)}
                                    className="w-5 h-5 flex items-center justify-center rounded text-green-600 hover:bg-green-100 font-bold" title="新增計畫區間">＋</button>
                                  <button onClick={() => setEditingProject({ mode: 'edit', owner: group.owner, project: proj })}
                                    className="w-5 h-5 flex items-center justify-center rounded text-blue-600 hover:bg-blue-100" title="編輯專案">✎</button>
                                  <button onClick={() => handleDeleteProject(proj)}
                                    className="w-5 h-5 flex items-center justify-center rounded text-red-500 hover:bg-red-100" title="刪除專案">🗑</button>
                                </div>
                              )}
                            </div>
                          </td>

                          <td colSpan={weeksTotal} className="p-0 relative" style={{ height: isOverview ? 24 : isCompact ? 30 : 40 }}>
                            <div className="absolute inset-0 flex pointer-events-none z-0">
                              {Array.from({ length: weeksTotal }).map((_, i) => (
                                <div key={i} className={`flex-1 border-r border-slate-300 ${i + 1 === currentWeek ? 'bg-red-50/70' : ''}`}></div>
                              ))}
                            </div>
                            <div className="absolute top-0 bottom-0 z-10 pointer-events-none" style={{ left: `${(currentWeek - 0.5) * (100 / weeksTotal)}%`, borderLeft: '2px solid rgba(220,38,38,0.55)' }}></div>

                            {proj.tasks.map(task => {
                              const isActiveThisWeek = task.start <= currentWeek && task.end >= currentWeek;
                              const weekLog = taskLogs[task.id]?.[currentWeek];
                              const isPending = role === 'member' && proj.owner === currentUser && isActiveThisWeek && !weekLog;
                              const deadlineSoon = isTaskDeadlineSoon(task);   // 剩 ≤2 週或已過 70% 時程 → 橘框 + ⏰(未回報紅框優先)

                              const isHighlighted = task.id === highlightedTaskId;   // 團隊看板點回報格時的暫時提示
                              const barClass = 'text-[#0f172a]';   // 計畫條底永遠是淺奶油色,文字固定深色(不受深色模式覆寫),投影高對比
                              const barStyle = isHighlighted ? {
                                backgroundImage: 'repeating-linear-gradient(45deg, #DBEAFE, #DBEAFE 6px, #BFDBFE 6px, #BFDBFE 12px)',   // 淺藍高亮(僅提示用)
                                borderColor: '#2563EB'
                              } : {
                                backgroundImage: 'repeating-linear-gradient(45deg, #FFF6D6, #FFF6D6 6px, #FDEDB8 6px, #FDEDB8 12px)',
                                borderColor: 'rgba(180,83,9,0.75)'   // 加深(範本 B):淡黃條在白底上需要更明確的輪廓
                              };
                              const textClass = weekLog ? 'font-bold' : 'font-medium opacity-90';
                              const spanWeeks = task.end - task.start + 1;

                              const leftPercent = (task.start - 1) * (100 / weeksTotal);
                              const widthPercent = (task.end - task.start + 1) * (100 / weeksTotal);
                              const logs = taskLogs[task.id] || {};

                              return (
                                <React.Fragment key={task.id}>
                                  {/* 甘特條是開啟打卡/檢視彈窗的主要入口,且沒有等效的鍵盤替代路徑,故必須可聚焦。
                                      名稱要自己組:條上只畫得下截斷的文字,讀螢幕器需要「專案-計畫-週次區間-本週狀態」完整資訊。 */}
                                  <div
                                    {...clickable(
                                      () => { setHighlightedTaskId(null); setSelectedTaskInfo({ proj, task, isActiveThisWeek, weekLog }); },
                                      `${proj.owner} ${proj.name}｜${task.name}｜W${String(task.start).padStart(2, '0')}–W${String(task.end).padStart(2, '0')}｜W${String(currentWeek).padStart(2, '0')} ${weekLog ? STATUS_META[weekLog.status]?.label || '已回報' : isActiveThisWeek ? '尚未回報' : '非本週區間'}`,
                                      { roving: { active: String(task.id) === String(activeRovingTaskId), group: 'gantt-bar', id: task.id, onRove: setRovingTaskId } }
                                    )}
                                    onFocus={() => setRovingTaskId(task.id)}
                                    onMouseEnter={(e) => showTooltip(e, proj, task)}
                                    onMouseMove={moveTooltip}
                                    onMouseLeave={hideTooltip}
                                    className={`absolute flex items-center overflow-hidden cursor-pointer transition-transform hover:scale-y-110 hover:z-20 border rounded-sm shadow-sm ${barClass} ${isHighlighted ? 'ring-2 ring-blue-500 ring-offset-1 z-20' : isPending ? 'ring-2 ring-red-400 ring-offset-1 z-10' : deadlineSoon ? 'ring-2 ring-orange-400 ring-offset-1 z-10' : 'z-10'}`}
                                    style={{ left: `${leftPercent}%`, width: `${widthPercent}%`, top: isOverview ? 4 : 4, bottom: isOverview ? 4 : isCompact ? 8 : 10, ...barStyle }}>
                                    
                                    {Object.entries(logs).map(([w, log]) => {
                                      const wn = Number(w);
                                      if (!log || wn < task.start || wn > task.end) return null;
                                      const isCur = wn === currentWeek;
                                      return (
                                        <div key={w}
                                          className={`absolute bottom-0 pointer-events-none ${STATUS_META[log.status]?.dot || 'bg-blue-500'}`}
                                          style={{
                                            left: `${((wn - task.start) / spanWeeks) * 100}%`,
                                            width: `${100 / spanWeeks}%`,
                                            height: isCur ? '5px' : '4px',
                                            opacity: isCur ? 0.95 : 0.75
                                          }}
                                          title={`W${w}: ${STATUS_META[log.status]?.label}${log.reporterRole === 'manager' ? ' (主管補登)' : ''}`}></div>
                                      );
                                    })}
                                    
                                    {/* 年度總覽:條上不顯字(壓縮後塞不下),以色塊+tooltip 傳達;週檢視純粹顯示任務名稱 */}
                                    {!isOverview && (
                                      <span className={`relative z-10 truncate px-1.5 whitespace-nowrap ${isCompact ? 'text-[10px]' : 'text-[12px]'} ${textClass}`}
                                        style={{ textShadow: '0 0 3px rgba(255,255,255,0.9), 0 0 6px rgba(255,255,255,0.75)' }}>
                                        {isPending && '❗'}{deadlineSoon && '⏰'}{task.name}
                                      </span>
                                    )}
                                  </div>

                                </React.Fragment>
                              );
                            })}
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
              </>
            )}
          </div>
          </div>
          {/* 團隊總結看板:右窗格(非 fixed 疊層),與左窗格並排,不會蓋到任何控制項 */}
          {showWeeklyReport && (
            <WeeklyReportDashboard
              currentWeek={currentWeek} year={scheduleYear} users={users} projects={projects} taskLogs={taskLogs} extraNotes={extraNotes}
              weeklyPlans={weeklyPlans} weeklyComments={weeklyComments}
              extraNoteMeta={extraNoteMeta} weeklyPlanMeta={weeklyPlanMeta} weeklyCommentMeta={weeklyCommentMeta}
              currentUser={currentUser} role={role} panelWidth={reportPanelW}
              highlightedTaskId={highlightedTaskId} onHighlightTask={handleHighlightTask}
              onEditComment={(userName) => setCommentTarget(userName)}
              onClose={closeWeeklyReport}
            />
          )}
        </div>
      )}

      {tooltip && (
        <div className="fixed z-[200] pointer-events-none"
          style={{ left: Math.min(tooltip.x + 14, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 300), top: Math.min(tooltip.y + 14, (typeof window !== 'undefined' ? window.innerHeight : 800) - 200) }}>
          <div className="bg-slate-900/95 text-white rounded-lg shadow-xl px-3.5 py-3 text-xs max-w-xs border border-slate-700">
            <div className="font-bold text-[13px] mb-1 text-yellow-200">{tooltip.proj.name}</div>
            <div className="text-slate-400 mb-0.5">👤 {tooltip.proj.owner}　·　{tooltip.proj.category}</div>
            {tooltip.proj.deliverable && <div className="text-amber-200/90 mb-0.5">🎯 {tooltip.proj.deliverable}</div>}
            {tooltip.proj.mpSaving && <div className="text-emerald-300 font-bold mb-0.5">💡 MP 節省：{tooltip.proj.mpSaving}</div>}
            {tooltip.proj.nid && <div className="text-slate-400 mb-0.5">🔖 專案 NID：{tooltip.proj.nid}</div>}
            <div className="text-slate-400">📅 {tooltip.task.name}</div>
            {tooltip.task.nid && <div className="text-slate-500">🔖 區間 NID：{tooltip.task.nid}</div>}
            <div className="text-slate-500">W{tooltip.task.start} – W{tooltip.task.end}（{weekToMonth(tooltip.task.start, months)} ~ {weekToMonth(tooltip.task.end, months)}）</div>
            {isTaskDeadlineSoon(tooltip.task) && (
              <div className="mt-1 text-orange-300 font-bold">
                ⏰ 排程即將到期：剩 {tooltip.task.end - todayWeek + 1} 週
                （時程已過 {Math.round(((todayWeek - tooltip.task.start + 1) / (tooltip.task.end - tooltip.task.start + 1)) * 100)}%）
              </div>
            )}
            {tooltip.weekLog && (
              <div className="mt-2 pt-2 border-t border-slate-700">
                <div className="font-bold mb-0.5">
                  {STATUS_META[tooltip.weekLog.status]?.icon} 本週 W{currentWeek}：{STATUS_META[tooltip.weekLog.status]?.label}
                  {tooltip.weekLog.reporterRole === 'manager' && <span className="ml-1 text-yellow-300 text-[11px]">✏️(主管補登)</span>}
                </div>
                {tooltip.weekLog.note && <div className="text-slate-400 whitespace-pre-wrap">{tooltip.weekLog.note}</div>}
              </div>
            )}
            {tooltip.history.length > 0 && (
              <div className="mt-2 pt-2 border-t border-slate-700 text-slate-500">
                歷史回報：{tooltip.history.map(([w, l]) => `W${w}${STATUS_META[l.status]?.icon || ''}`).join('　')}
              </div>
            )}
            <div className="mt-1.5 text-[10px] text-slate-500">點擊可開啟詳細 / 回報視窗</div>
          </div>
        </div>
      )}

      {selectedTaskInfo && (
        <TaskModal
          info={selectedTaskInfo} role={role} currentUser={currentUser} currentWeek={currentWeek} todayWeek={todayWeek}
          weeksTotal={weeksTotal} allowRetroCheckin={allowRetroCheckin}
          logs={taskLogs[selectedTaskInfo.task.id] || {}}
          onClose={() => setSelectedTaskInfo(null)} onSaveLog={handleSaveLog} onUpdateTaskDetails={handleUpdateTaskDetails}
          onDeleteTask={handleDeleteTask} onUpdateScore={handleUpdateScore}
        />
      )}
      {showExtraNoteModal && (
        <ExtraNoteModal
          currentWeek={currentWeek} initialNote={extraNotes[noteTargetUser || currentUser]?.[currentWeek] || ''}
          readOnly={role !== 'manager' && isViewingPast && !allowRetroCheckin}
          targetUser={noteTargetUser}
          meta={extraNoteMeta[noteTargetUser || currentUser]?.[currentWeek]}
          onClose={() => { setShowExtraNoteModal(false); setNoteTargetUser(null); }} onSave={handleSaveExtraNote}
        />
      )}
      {showWeeklyPlanModal && (
        <WeeklyPlanModal
          currentWeek={currentWeek} initialNote={weeklyPlans[noteTargetUser || currentUser]?.[currentWeek] || ''}
          readOnly={role !== 'manager' && isViewingPast && !allowRetroCheckin}
          targetUser={noteTargetUser}
          meta={weeklyPlanMeta[noteTargetUser || currentUser]?.[currentWeek]}
          onClose={() => { setShowWeeklyPlanModal(false); setNoteTargetUser(null); }} onSave={handleSaveWeeklyPlan}
        />
      )}
      {showDeadlinePanel && (
        <DeadlinePanel
          items={deadlineTasks}
          onClose={() => setShowDeadlinePanel(false)}
          onSelect={(item) => {
            setShowDeadlinePanel(false);
            setScrollTargetWeek(Math.min(item.task.end, weeksTotal));   // 捲動定位到該任務結束週
            setSelectedTaskInfo({
              proj: item.proj, task: item.task,
              isActiveThisWeek: item.task.start <= currentWeek && item.task.end >= currentWeek,
              weekLog: taskLogs[item.task.id]?.[currentWeek]
            });
          }}
        />
      )}
      {showPendingPanel && (
        <PendingPanel
          pending={myPendingTasks}
          completed={myCompletedTasks}
          currentWeek={todayWeek}
          planPending={planPendingThisWeek}
          extraFilled={!!extraNotes[currentUser]?.[todayWeek]}
          planMeta={weeklyPlanMeta[currentUser]?.[todayWeek]}
          extraMeta={extraNoteMeta[currentUser]?.[todayWeek]}
          onFillPlan={() => {
            setShowPendingPanel(false);
            setCurrentWeek(todayWeek);
            setShowWeeklyPlanModal(true);
          }}
          onFillExtra={() => {
            setShowPendingPanel(false);
            setCurrentWeek(todayWeek);
            setShowExtraNoteModal(true);
          }}
          onClose={() => setShowPendingPanel(false)}
          onSelect={(item, log) => {
            setShowPendingPanel(false);
            setCurrentWeek(todayWeek);
            setSelectedTaskInfo({ proj: item.proj, task: item.task, isActiveThisWeek: true, weekLog: log });
          }}
        />
      )}
      {/* 成員:非當週補登面板(主管開放補登時;沿用 PendingPanel,範圍=檢視中週次) */}
      {showRetroPanel && role === 'member' && (
        <PendingPanel retro
          pending={myRetroPendingTasks}
          completed={myRetroCompletedTasks}
          currentWeek={currentWeek}
          planPending={!weeklyPlans[currentUser]?.[currentWeek]}
          extraFilled={!!extraNotes[currentUser]?.[currentWeek]}
          planMeta={weeklyPlanMeta[currentUser]?.[currentWeek]}
          extraMeta={extraNoteMeta[currentUser]?.[currentWeek]}
          onFillPlan={() => { setShowRetroPanel(false); setShowWeeklyPlanModal(true); }}
          onFillExtra={() => { setShowRetroPanel(false); setShowExtraNoteModal(true); }}
          onClose={() => setShowRetroPanel(false)}
          onSelect={(item, log) => {
            setShowRetroPanel(false);
            setSelectedTaskInfo({ proj: item.proj, task: item.task, isActiveThisWeek: true, weekLog: log });
          }}
        />
      )}
      {/* 主管:週次回報編輯面板(選成員後代為補登/修正該週回報,並可編輯主管回覆) */}
      {showWeekEditPanel && role === 'manager' && (
        <ManagerWeekPanel
          week={currentWeek} todayWeek={todayWeek} users={users} projects={projects}
          taskLogs={taskLogs} extraNotes={extraNotes} weeklyPlans={weeklyPlans} weeklyComments={weeklyComments}
          extraNoteMeta={extraNoteMeta} weeklyPlanMeta={weeklyPlanMeta} weeklyCommentMeta={weeklyCommentMeta}
          onClose={() => setShowWeekEditPanel(false)}
          onSelectTask={(proj, task, log) => {
            setShowWeekEditPanel(false);
            setSelectedTaskInfo({ proj, task, isActiveThisWeek: true, weekLog: log });
          }}
          onEditExtra={(u) => { setShowWeekEditPanel(false); setNoteTargetUser(u); setShowExtraNoteModal(true); }}
          onEditPlan={(u) => { setShowWeekEditPanel(false); setNoteTargetUser(u); setShowWeeklyPlanModal(true); }}
          onEditComment={(u) => { setShowWeekEditPanel(false); setCommentTarget(u); }}
        />
      )}
      {/* 註:團隊總結看板已移到甘特區旁當「分割欄位」渲染(見上方),不在這層 fixed 疊層清單裡 */}
      {commentTarget && (
        <CommentModal
          member={commentTarget} currentWeek={currentWeek}
          initialComment={weeklyComments[commentTarget]?.[currentWeek] || ''}
          meta={weeklyCommentMeta[commentTarget]?.[currentWeek]}
          onClose={() => setCommentTarget(null)}
          onSave={(c) => handleSaveComment(commentTarget, c)}
        />
      )}
      {editingProject && (
        <ProjectEditModal
          info={editingProject} existingCategories={existingCategories} users={users}
          onClose={() => setEditingProject(null)} onSave={handleSaveProject}
        />
      )}
      {addingInterval && (
        <IntervalModal
          project={addingInterval} currentWeek={currentWeek} weeksTotal={weeksTotal}
          onClose={() => setAddingInterval(null)} onSave={handleAddInterval}
        />
      )}
      {showAuditPanel && (
        <AuditPanel onClose={() => setShowAuditPanel(false)} />
      )}
      {showMemberPanel && (
        <MemberPanel
          users={users} projects={projects} year={scheduleYear}
          onAdd={handleAddUser} onRename={handleRenameUser} onDelete={handleDeleteUser}
          onClose={() => setShowMemberPanel(false)}
        />
      )}
      {showAccessPanel && role === 'manager' && (
        <AccessPanel
          currentUser={currentUser} role={role} empId={empId}
          showToast={showToast}
          onClose={() => setShowAccessPanel(false)}
        />
      )}
      {showUsagePanel && role === 'manager' && (
        <UsageStatsPanel onClose={() => setShowUsagePanel(false)} />
      )}
      {deliverableProj && (
        <DeliverableModal
          proj={deliverableProj} role={role} currentUser={currentUser}
          onClose={() => setDeliverableProj(null)} onSave={handleSaveDeliverable}
        />
      )}
      {confirmInfo && (
        <ConfirmModal info={confirmInfo} onCancel={() => setConfirmInfo(null)} />
      )}

      {/* 讀螢幕器播報區:必須「常駐」在 DOM 裡,內容變更才會被朗讀——若整個 live region 跟著 toast
          一起插入再移除,多數讀螢幕器不會播報(toast 最常見的無障礙坑)。故這裡只換文字,不換節點。
          分兩個區:錯誤走 role="alert"(assertive,打斷當下朗讀,因為使用者的操作失敗了必須馬上知道),
          一般走 role="status"(polite,等使用者聽完手邊的內容再念,不打斷)。
          視覺上的 toast 文字另掛 aria-hidden,否則同一句話會被念兩次;但操作鈕(復原/關閉)不能藏,要留給鍵盤與讀螢幕器。 */}
      <div className="sr-only" role="status" aria-live="polite">{toast && !toast.isError ? toast.msg : ''}</div>
      <div className="sr-only" role="alert" aria-live="assertive">{toast && toast.isError ? toast.msg : ''}</div>

      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[300] bg-slate-900 text-white text-sm font-bold px-5 py-3 rounded-xl shadow-2xl border flex items-center gap-3 ${toast.isError ? 'border-red-500' : 'border-slate-700 animate-bounce'}`}>
          <span className="whitespace-pre-wrap" aria-hidden="true">{toast.msg}</span>
          {toast.action && (
            <button onClick={() => { dismissToast(); toast.action.onClick(); }}
              className="flex-shrink-0 bg-amber-500 hover:bg-amber-400 text-slate-900 px-3 py-1 rounded-lg text-xs font-black transition">
              ↩ {toast.action.label}
            </button>
          )}
          {(toast.isError || toast.action) && (
            <button onClick={dismissToast} aria-label="關閉通知" className="flex-shrink-0 text-white/50 hover:text-white font-bold px-1" title="關閉">✕</button>
          )}
        </div>
      )}
    </div>
  );
}

// 投影友善:晶片加邊框確保輪廓、標籤文字不再用透明度淡化(投影機對比打折,淡字會消失)
// 統計晶片。給 onToggle 就變成可切換的篩選鈕(用 <button>,鍵盤與讀螢幕器自然支援,
// 不需要另外套 clickable();aria-pressed 才播報得出「已按下/未按下」的切換語意)。
function StatChip({ label, value, className, onToggle, active = false, title }) {
  const base = `flex-shrink-0 pl-2 pr-2.5 py-1 rounded-full font-bold flex items-center gap-1 border ${className}`;
  if (!onToggle) {
    return (
      <span className={base}>
        <span className="font-medium text-[11px]">{label}</span>
        <span className="text-[13px] leading-none">{value}</span>
      </span>
    );
  }
  return (
    <button onClick={onToggle} aria-pressed={active} title={title}
      className={`${base} transition ${active ? 'ring-2 ring-offset-1 ring-yellow-600' : 'hover:brightness-95'}`}>
      <span className="font-medium text-[11px]">{label}</span>
      <span className="text-[13px] leading-none">{value}</span>
      {active && <span className="text-[11px] font-black" aria-hidden="true">✕</span>}
    </button>
  );
}

function LoadingScreen() {
  return (
    <div className="flex-1 flex justify-center items-center bg-slate-100 app-bg p-4">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-slate-300 border-t-blue-600 rounded-full animate-spin mx-auto mb-4"></div>
        <div className="text-slate-500 font-bold">載入資料中…</div>
      </div>
    </div>
  );
}

function ErrorScreen({ message, onRetry }) {
  return (
    <div className="flex-1 flex justify-center items-center bg-slate-100 app-bg p-4">
      <div className="bg-white p-10 rounded-2xl shadow-2xl modal-card border border-red-200 max-w-md w-full text-center">
        <div className="w-16 h-16 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center mx-auto mb-4 text-3xl">⚠️</div>
        <h2 className="text-xl font-black text-slate-800 mb-2">無法連線資料庫</h2>
        <p className="text-sm text-slate-500 mb-3">系統無法從後端讀取資料，請確認後端服務與資料庫連線後再試一次。</p>
        <div className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg p-3 mb-5 text-left whitespace-pre-wrap break-words max-h-40 overflow-y-auto">{message}</div>
        <button onClick={onRetry} className="w-full text-white font-bold py-3 rounded-xl shadow-md transition hover:opacity-90" style={{ backgroundColor: BRAND_BTN }}>重新載入</button>
      </div>
    </div>
  );
}

// 瀏覽權限未通過的整頁封鎖畫面(卡控啟用時取代整個 App,不顯示登入與資料)
function AccessDeniedScreen({ empId, reason, person }) {
  return (
    <div className="min-h-screen flex justify-center items-center bg-slate-100 app-bg p-4">
      <div className="bg-white p-10 rounded-2xl shadow-2xl modal-card border border-red-200 max-w-md w-full text-center">
        <div className="w-16 h-16 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center mx-auto mb-4 text-3xl">🚫</div>
        <h2 className="text-xl font-black text-slate-800 mb-2">無權限瀏覽此頁面</h2>
        <p className="text-sm text-slate-500 mb-4">您的帳號未被授權瀏覽 MSD 專案追蹤總表。</p>
        <div className="text-left text-sm bg-slate-100 border border-slate-300 rounded-lg p-4 mb-4 space-y-1.5">
          <div><span className="text-slate-500 font-bold mr-2">登入工號</span><span className="font-mono font-bold text-slate-800">{empId || '（無法取得）'}</span></div>
          {person && (
            <div><span className="text-slate-500 font-bold mr-2">人員名冊</span>
              <span className="text-slate-700 font-medium">{person.name || ''} {person.ename ? `(${person.ename})` : ''}・{person.deptname || [person.dept1, person.dept2, person.dept3].filter(Boolean).join('/') || '無部門資料'}</span>
            </div>
          )}
        </div>
        {reason && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg p-3 mb-5 text-left whitespace-pre-wrap">{reason}</div>
        )}
        <p className="text-xs text-slate-500">若需要瀏覽權限，請聯絡系統管理員（主管）將您的部門或工號加入允許清單。</p>
      </div>
    </div>
  );
}

function LoginScreen({ onLogin, users, year, empId }) {
  return (
    <div className="flex-1 flex justify-center items-center bg-slate-100 login-bg p-4">
      <div className="bg-white p-10 rounded-2xl shadow-2xl modal-card dark:shadow-none border border-slate-300 max-w-md w-full">
        <div className="text-center mb-8">
          <div className="w-16 h-16 text-white rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg text-2xl" style={{ backgroundColor: 'var(--brand-btn, #001F5B)' }}>📊</div>
          <h2 className="text-2xl font-black text-slate-800">MSD 專案追蹤系統</h2>
          <p className="text-xs text-slate-500 mt-2">{year} 年度專案排程 · 週進度管控</p>
        </div>
        <button onClick={() => onLogin('管理部主管', 'manager')} className="w-full text-white font-bold py-3.5 rounded-xl mb-6 shadow-md transition hover:opacity-90" style={{ backgroundColor: 'var(--brand-btn, #001F5B)' }}>👑 主管登入（調整排程 / 檢視全體）</button>
        <div className="relative flex py-2 items-center">
          <div className="flex-grow border-t border-slate-300"></div>
          <span className="flex-shrink-0 mx-4 text-slate-500 text-xs font-bold uppercase tracking-wider">團隊成員登入（回報進度）</span>
          <div className="flex-grow border-t border-slate-300"></div>
        </div>
        <div className="grid grid-cols-3 gap-3 mt-4">
          {users.map(u => (
            <button key={u} onClick={() => onLogin(u, 'member')}
              className="bg-white login-chip border border-slate-300 hover:border-blue-500 hover:bg-blue-50 py-2.5 rounded-xl font-bold text-slate-700 hover:text-blue-700 transition shadow-sm text-sm">
              {u}
            </button>
          ))}
        </div>
        {empId && (
          <div className="mt-6 text-center text-[11px] text-slate-500">
            🖥️ 已偵測到 Windows 工號：<span className="font-bold text-slate-500">{empId}</span>（操作紀錄將一併記載）
          </div>
        )}
      </div>
    </div>
  );
}

// 主管評分選項(成員回報預設 1 分,未回報 0 分,僅主管可調整)
const SCORE_OPTIONS = [
  { value: 0.3, label: '再三交代' },
  { value: 0.5, label: '說一動做一動' },
  { value: 0.8, label: '完成老闆交代' },
  { value: 0.9, label: '超越老闆期許' },
  { value: 1, label: '主動承擔' }
];

function TaskModal({ info, role, currentUser, currentWeek, todayWeek, weeksTotal = WEEKS_TOTAL, allowRetroCheckin, logs = {}, onClose, onSaveLog, onUpdateTaskDetails, onDeleteTask, onUpdateScore }) {
  const focus = useModalFocus();   // 開啟時焦點移入、Tab 鎖在視窗內、關閉時還原
  const { proj, task, isActiveThisWeek, weekLog } = info;
  const isManager = role === 'manager';
  const isMyTask = proj.owner === currentUser;
  const isReportingWeek = currentWeek === todayWeek;
  const canClockIn = (isManager && isActiveThisWeek) || (role === 'member' && isMyTask && isActiveThisWeek && (isReportingWeek || (allowRetroCheckin && currentWeek <= todayWeek)));
  const score = weekLog ? Number(weekLog.score ?? 1) : 0;

  const [status, setStatus] = useState(weekLog?.status || null);
  const [note, setNote] = useState(weekLog?.note || '');
  const [taskName, setTaskName] = useState(task.name);
  const [startWeek, setStartWeek] = useState(task.start);
  const [endWeek, setEndWeek] = useState(task.end);
  const [taskNid, setTaskNid] = useState(task.nid || '');   // 此進度區間對應哪組 NID(選填)
  const [saving, setSaving] = useState(false);   // 防連點:送出中鎖定按鈕
  useModalDirtyReset();
  const [scheduleError, setScheduleError] = useState('');
  const [noteError, setNoteError] = useState('');
  const [showAllHistory, setShowAllHistory] = useState(false);

  // 此計畫區間「本週之前」的歷次回報,新到舊。
  // 寫本週回報時最需要的參考就是「上週寫到哪、狀態是什麼」,原本只有甘特條 hover tooltip 看得到 →
  // 使用者得先關掉這個彈窗、去甘特條上 hover、記住內容、再開回來。資料本來就在 client 端(taskLogs),不需要再打 API。
  const history = useMemo(() =>
    Object.entries(logs)
      .map(([w, log]) => ({ week: Number(w), log }))
      .filter(h => h.week < currentWeek && h.log)
      .sort((a, b) => b.week - a.week)
  , [logs, currentWeek]);
  const HISTORY_PREVIEW = 3;                                   // 預設只展開最近 3 週,其餘收起來(避免長區間洗版)
  const shownHistory = showAllHistory ? history : history.slice(0, HISTORY_PREVIEW);

  // 沿用某一週的回報當本週草稿:狀態與內容一起帶入,使用者可再修改後送出。
  // 例行性/持續性的工作每週內容差異不大,重打一次是純粹的重工;帶入後文字就攤在 textarea 裡,
  // 使用者看得到自己送出的是什麼,不會有「以為填了新內容」的錯覺。
  const reuseLog = (h) => {
    setStatus(h.log.status);
    setNote(h.log.note || '');
    setNoteError('');
    markModalDirty();
  };

  const submitLog = async () => {
    if (saving) return;
    if (!status) { setNoteError('請先選擇本週狀態'); return; }
    if (status === 'executed' && !note.trim()) { setNoteError('請填寫實際工作內容，才能讓團隊了解進度'); return; }
    setSaving(true);
    try { await onSaveLog(task.id, status, note.trim()); } finally { setSaving(false); }
  };

  const submitSchedule = async () => {
    if (saving) return;
    const s = parseInt(startWeek), e = parseInt(endWeek);
    if (!taskName.trim()) { setScheduleError('任務名稱不可空白'); return; }
    if (isNaN(s) || isNaN(e) || s < 1 || e > weeksTotal || s > e) { setScheduleError(`週次需介於 1–${weeksTotal}，且開始週不可晚於結束週`); return; }
    setSaving(true);
    try { await onUpdateTaskDetails(proj.id, task.id, taskName.trim(), s, e, taskNid.trim()); } finally { setSaving(false); }
  };

  return (
    <div {...focus} className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm modal-scrim z-[100] flex justify-center items-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl modal-card w-full max-w-lg overflow-hidden max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 text-white flex justify-between items-start" style={{ backgroundColor: isManager ? '#001F5B' : '#334155' }}>
          <div className="pr-3">
            <div className="text-xs text-white/80 font-medium mb-1 flex items-center">
              負責人：{proj.owner}
              <span className={`ml-2 px-1.5 rounded text-[10px] font-bold border ${PROJECT_TYPES[proj.type].chip}`}>{proj.type.toUpperCase()} {PROJECT_TYPES[proj.type].label}</span>
            </div>
            <h3 className="font-bold text-lg leading-snug">{proj.name}</h3>
          </div>
          <CloseButton onClick={onClose} className="text-white/60 hover:text-white flex-shrink-0" />
        </div>

        <div className="p-6 space-y-6">
          <div className="bg-slate-100 p-4 rounded-xl border border-slate-300">
            <div className="flex justify-between items-center mb-3">
              <label className="text-sm font-bold text-slate-800">專案排程與預計事項</label>
              {isManager && <span className="text-[10px] bg-yellow-200 text-yellow-800 px-2 py-0.5 rounded font-bold">主管可編輯</span>}
            </div>
            {/* 此區塊的 Enter 綁「儲存排程」(submitSchedule),不是打卡送出——兩者是不同的送出目標 */}
            <input type="text" value={taskName} onChange={e => { setTaskName(e.target.value); setScheduleError(''); markModalDirty(); }} disabled={!isManager}
              onKeyDown={onEnterSubmit(submitSchedule)}
              className="w-full border border-slate-300 rounded-md p-2 text-sm mb-3 text-center disabled:bg-slate-100 disabled:text-slate-500 outline-none focus:border-blue-500" />
            <div className="flex space-x-3 items-center">
              <div className="w-1/2">
                <label className="text-[10px] text-slate-500 font-bold">開始週<ReqMark /></label>
                <input type="number" min="1" max={weeksTotal} value={startWeek} onChange={e => { setStartWeek(e.target.value); setScheduleError(''); markModalDirty(); }} disabled={!isManager}
                  onKeyDown={onEnterSubmit(submitSchedule)}
                  className="w-full border border-slate-300 rounded-md p-2 text-sm disabled:bg-slate-100 disabled:text-slate-500 outline-none focus:border-blue-500" />
              </div>
              <div className="w-1/2">
                <label className="text-[10px] text-slate-500 font-bold">結束週<ReqMark /></label>
                <input type="number" min="1" max={weeksTotal} value={endWeek} onChange={e => { setEndWeek(e.target.value); setScheduleError(''); markModalDirty(); }} disabled={!isManager}
                  onKeyDown={onEnterSubmit(submitSchedule)}
                  className="w-full border border-slate-300 rounded-md p-2 text-sm disabled:bg-slate-100 disabled:text-slate-500 outline-none focus:border-blue-500" />
              </div>
            </div>
            <div className="mt-3">
              <label className="text-[10px] text-slate-500 font-bold">NID（此區間對應哪組 NID，選填）</label>
              <input type="text" value={taskNid} onChange={e => { setTaskNid(e.target.value); setScheduleError(''); markModalDirty(); }} disabled={!isManager}
                onKeyDown={onEnterSubmit(submitSchedule)}
                className="w-full border border-slate-300 rounded-md p-2 text-sm disabled:bg-slate-100 disabled:text-slate-500 outline-none focus:border-blue-500" placeholder="如 N001…" />
            </div>
            {scheduleError && <div className="mt-2 text-xs text-red-600 font-bold">{scheduleError}</div>}
            {isManager && (
              <div className="mt-3 flex gap-2">
                <button onClick={submitSchedule} disabled={saving} className="flex-1 text-white px-4 py-1.5 rounded text-sm font-bold transition hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: BRAND_BTN }}>{saving ? '儲存中…' : '儲存排程'}</button>
                <button onClick={() => onDeleteTask(proj, task)}
                  className="flex-shrink-0 px-3 py-1.5 rounded text-sm font-bold text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 transition"
                  title="刪除此計畫區間（軟刪除，可由資料庫還原）">🗑 刪除區間</button>
              </div>
            )}
          </div>

          {/* 前幾週回報:放在「本週回報」正上方,寫的時候不用捲來捲去就能對照上週寫到哪。
              沒有歷史就整塊不渲染(不留空殼),避免新區間第一次打卡時多一塊沒內容的區域。 */}
          {history.length > 0 && (
            <div className="border border-slate-300 rounded-xl overflow-hidden">
              <div className="bg-slate-100 px-4 py-2 flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-slate-800">前幾週回報（{history.length} 週）</span>
                {history.length > HISTORY_PREVIEW && (
                  <button onClick={() => setShowAllHistory(v => !v)}
                    className="flex-shrink-0 text-xs font-bold text-blue-700 hover:text-blue-900 hover:underline"
                    aria-expanded={showAllHistory}>
                    {showAllHistory ? '只看最近 3 週' : `顯示全部 ${history.length} 週`}
                  </button>
                )}
              </div>
              {/* 上限高度 + 內部捲動:長區間(如 W14–W40)展開後不會把「本週回報」推到畫面外 */}
              <div className="max-h-56 overflow-y-auto divide-y divide-slate-200">
                {shownHistory.map(h => (
                  <div key={h.week} className="px-4 py-2.5 bg-white">
                    <div className="flex items-center flex-wrap gap-1.5">
                      <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 font-bold text-[11px] font-mono">
                        W{String(h.week).padStart(2, '0')}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${STATUS_META[h.log.status]?.tag}`}>
                        {STATUS_META[h.log.status]?.icon} {STATUS_META[h.log.status]?.label}
                      </span>
                      {h.log.reporterRole === 'manager' && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 font-bold text-[10px]" title="此筆由主管代為修正/補登">✏️ 主管修正</span>
                      )}
                      {/* 沿用鈕逐列都有:最上面那列就是「上週」,想挑更早的一週也行。
                          唯讀情境(非本週、無補登權限)不顯示——那時 textarea 根本不存在,按了沒有任何作用。 */}
                      {canClockIn && (
                        <button onClick={() => reuseLog(h)}
                          className="ml-auto flex-shrink-0 px-2 py-0.5 rounded border text-[11px] font-bold bg-white ctl-raised text-slate-600 border-slate-400 hover:border-indigo-500 hover:bg-indigo-50 transition"
                          title={`把 W${String(h.week).padStart(2, '0')} 的狀態與內容帶入本週草稿，可再修改後送出`}>
                          沿用
                        </button>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-slate-700 whitespace-pre-wrap break-words leading-relaxed">
                      {h.log.note || <span className="text-slate-500 italic">（未填寫說明）</span>}
                    </div>
                    {h.log.updatedAt && (
                      <div className="text-[10px] text-slate-500 mt-1">🕘 最後編輯 {h.log.updatedAt}{h.log.reporter ? `（${h.log.reporter}）` : ''}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <h4 className="text-sm font-bold text-slate-800 mb-3 flex items-center">
              W{String(currentWeek).padStart(2, '0')} 實際執行回報
              {isActiveThisWeek && (
                <span className={`ml-2 px-2 py-0.5 rounded-full text-[11px] font-bold ${weekLog ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-200 text-slate-500'}`}
                  title="回報成功預設 1 分,未回報 0 分;主管可依表現調整">
                  🏆 {score} 分
                </span>
              )}
            </h4>
            {weekLog?.updatedAt && (
              <div className="text-[11px] text-slate-500 mb-2 flex items-center gap-1.5">
                <span>🕘 最後編輯：{weekLog.updatedAt}</span>
                {weekLog.reporter && <span className="text-slate-500">by {weekLog.reporter}</span>}
                {weekLog.reporterRole === 'manager' && (
                  <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 font-bold text-[10px]" title="此筆由主管代為修正/補登">✏️ 主管修正</span>
                )}
              </div>
            )}
            {canClockIn ? (
              <div className={`p-4 rounded-xl border transition-colors ${status && status !== 'not_executed' ? 'bg-blue-50 border-blue-200' : 'bg-slate-100 border-slate-300'}`}>
                {isManager && !isMyTask && (
                  <div className="mb-3 bg-amber-100 border border-amber-400 text-amber-900 rounded-lg px-3.5 py-2.5 text-xs font-bold flex items-center">
                    <span className="mr-2 text-sm">👑</span>
                    <span>主管特權模式：正在為成員核實或調補 W{String(currentWeek).padStart(2, '0')} 執行紀錄</span>
                  </div>
                )}
                <div className="mb-3">
                  <div className="font-bold text-slate-800 text-sm">本週此任務的執行狀態</div>
                  <div className="text-xs text-slate-500 mt-0.5">回報後會在該週甘特條標示對應顏色（有執行=綠、Monitor=藍、未執行=灰）。Monitor 為例行監控工作，可不填說明。</div>
                  <div className="text-xs text-indigo-600 mt-1 font-bold">🏆 完成回報預設獲得 1 分（未回報為 0 分），主管可依表現調整分數。</div>
                </div>
                {/* 「沿用上週」主按鈕:歷史區逐列都有沿用鈕(可挑任一週),但最高頻的動作就是「照抄上一次」——
                    走歷史區要「往上捲 → 找到最上面那列 → 點沿用」三步,而這裡一步到位。
                    history[0] 已是最新的一週(降冪排序),故直接取 [0]。
                    ⚠ 只在還沒選狀態時顯示:已經在編輯了才跳出來會蓋掉使用者剛打的內容(reuseLog 會覆寫 note)。 */}
                {history.length > 0 && !status && (
                  <button onClick={() => reuseLog(history[0])}
                    className="mb-3 w-full px-3 py-2 rounded-lg border border-indigo-400 bg-indigo-50 text-indigo-800 text-xs font-bold hover:bg-indigo-100 transition flex items-center justify-center gap-1.5"
                    title={`把 W${String(history[0].week).padStart(2, '0')} 的狀態與內容帶入，可再修改後送出`}>
                    <span aria-hidden="true">↩</span>
                    沿用上次回報（W{String(history[0].week).padStart(2, '0')}・{STATUS_META[history[0].log.status]?.label}）
                  </button>
                )}
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-2">
                    {Object.entries(STATUS_META).map(([key, meta]) => (
                      <button key={key} onClick={() => { setStatus(key); setNoteError(''); markModalDirty(); }}
                        className={`py-3 rounded-lg border text-sm font-bold transition ${status === key ? meta.tag + ' ring-2 ring-offset-1 ring-slate-300' : 'bg-white ctl-raised text-slate-500 border-slate-300 hover:border-slate-400'}`}>
                        {meta.icon} {meta.label}
                      </button>
                    ))}
                  </div>
                  {status && (
                    <textarea value={note} onChange={e => { setNote(e.target.value); setNoteError(''); markModalDirty(); }}
                      placeholder={status === 'not_executed' ? '可備註未執行原因（選填）' : status === 'monitor' ? '例行監控項目，可備註（選填）' : '說明本週實際工作內容…'}
                      className={`w-full border rounded-lg p-3 text-sm h-24 outline-none resize-none focus:border-blue-500 ${noteError ? 'border-red-400' : 'border-slate-300'}`}></textarea>
                  )}
                  {noteError && <div className="text-xs text-red-600 font-bold">{noteError}</div>}
                </div>
                <div className="flex justify-end space-x-3 pt-4">
                  <button onClick={onClose} className="px-4 py-2 text-sm text-slate-500 bg-white ctl-raised border border-slate-300 rounded-lg font-bold hover:bg-slate-50">取消</button>
                  <button onClick={submitLog} disabled={saving} className="px-6 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold rounded-lg shadow-md">{saving ? '儲存中…' : '儲存進度回報'}</button>
                </div>
                {isManager && weekLog && (
                  <div className="mt-4 pt-3 border-t border-slate-300">
                    <div className="text-xs font-bold text-slate-500 mb-2">主管評分微調（點擊即時更新分數）</div>
                    <div className="grid grid-cols-5 gap-1.5">
                      {SCORE_OPTIONS.map(o => (
                        <button key={o.value} onClick={() => onUpdateScore(task.id, o.value)}
                          className={`px-1 py-2 rounded-lg border text-center transition ${score === o.value ? 'bg-indigo-600 text-white border-indigo-700 ring-2 ring-offset-1 ring-indigo-300' : 'bg-white ctl-raised text-slate-600 border-slate-300 hover:border-indigo-400 hover:bg-indigo-50'}`}>
                          <div className="text-[11px] font-bold leading-tight">{o.label}</div>
                          <div className={`text-[10px] mt-0.5 ${score === o.value ? 'text-indigo-100' : 'text-slate-500'}`}>{o.value} 分</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-slate-100 border border-slate-300 p-4 rounded-xl text-sm">
                {role === 'member' && isMyTask && isActiveThisWeek && !isReportingWeek && (
                  <div className="mb-3 bg-yellow-50 border border-yellow-300 text-yellow-800 rounded-lg px-3 py-2 text-xs font-bold">
                    🔒 唯讀檢視：僅能回報本週 W{String(todayWeek).padStart(2, '0')} 的進度，歷史週次只能瀏覽。
                  </div>
                )}
                {!isActiveThisWeek ? (
                  <div className="text-slate-500 text-center py-2">此任務排定於 W{task.start}–W{task.end}，非 W{String(currentWeek).padStart(2, '0')} 排定項目。</div>
                ) : weekLog ? (
                  <div>
                    <div className="mb-2 flex items-center flex-wrap gap-y-1"><span className="font-bold mr-2">狀態：</span>
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${STATUS_META[weekLog.status]?.tag}`}>
                        {STATUS_META[weekLog.status]?.icon} {STATUS_META[weekLog.status]?.label}
                      </span>
                      <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-bold bg-indigo-100 text-indigo-700" title="回報成功預設 1 分,主管可調整">🏆 {score} 分</span>
                    </div>
                    <div className="font-bold mb-1">工作說明：</div>
                    <div className="bg-white p-3 rounded border border-slate-300 text-slate-700 whitespace-pre-wrap">{weekLog.note || '（未填寫備註）'}</div>
                    {isManager && (
                      <div className="mt-3 pt-3 border-t border-slate-300">
                        <div className="text-xs font-bold text-slate-500 mb-2">主管評分（點擊即修改此週分數）</div>
                        <div className="grid grid-cols-5 gap-1.5">
                          {SCORE_OPTIONS.map(o => (
                            <button key={o.value} onClick={() => onUpdateScore(task.id, o.value)}
                              className={`px-1 py-2 rounded-lg border text-center transition ${score === o.value ? 'bg-indigo-600 text-white border-indigo-700 ring-2 ring-offset-1 ring-indigo-300' : 'bg-white ctl-raised text-slate-600 border-slate-300 hover:border-indigo-400 hover:bg-indigo-50'}`}>
                              <div className="text-[11px] font-bold leading-tight">{o.label}</div>
                              <div className={`text-[10px] mt-0.5 ${score === o.value ? 'text-indigo-100' : 'text-slate-500'}`}>{o.value} 分</div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : <div className="text-slate-500 text-center py-2">📌 W{String(currentWeek).padStart(2, '0')} 未回報此項目（維持計畫中，🏆 0 分）。</div>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ExtraNoteModal({ currentWeek, initialNote, readOnly, targetUser, meta, onClose, onSave }) {
  const focus = useModalFocus();   // 開啟時焦點移入、Tab 鎖在視窗內、關閉時還原
  const [note, setNote] = useState(initialNote);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useModalDirtyReset();
  // 非專案事項為「選填」:允許空白儲存(=清空本週內容),不強迫填字
  const isClearing = !note.trim() && !!initialNote;
  const submit = async () => {
    if (saving) return;
    setSaving(true);
    try { await onSave(note.trim()); } finally { setSaving(false); }
  };
  if (readOnly) {
    return (
      <div {...focus} className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm modal-scrim z-[110] flex justify-center items-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl modal-card w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
          <div className="px-6 py-4 text-white flex justify-between items-center" style={{ backgroundColor: '#475569' }}>
            <h3 className="font-bold text-lg" style={{ color: '#FFFFFF' }}>🔒 W{currentWeek} 非專案工作（唯讀）</h3>
            <CloseButton onClick={onClose} className="text-white/60 hover:text-white" />
          </div>
          <div className="p-6">
            <p className="text-xs text-slate-500 mb-3">歷史週次僅供瀏覽，無法修改。</p>
            {initialNote ? (
              <div>
                <div className="text-sm text-slate-700 bg-slate-100 border border-slate-300 rounded-lg p-4 whitespace-pre-wrap">{initialNote}</div>
                <MetaLine meta={meta} />
              </div>
            ) : (
              <div className="text-sm text-slate-500 italic text-center py-6">該週未填寫非專案事項</div>
            )}
            <div className="flex justify-end pt-4">
              <button onClick={onClose} className="px-6 py-2 text-sm bg-slate-600 hover:bg-slate-700 text-white font-bold rounded-lg">關閉</button>
            </div>
          </div>
        </div>
      </div>
    );
  }
  return (
    // 注意:全站慣例 — 所有彈出視窗/面板的遮罩都「不」綁 onClick 關閉(避免誤點視窗外遺失輸入),一律用「取消」「×」或送出按鈕關閉;新增 Modal 請沿用
    <div {...focus} className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm modal-scrim z-[110] flex justify-center items-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl modal-card w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 text-white flex justify-between items-center" style={{ backgroundColor: '#C2410C' }}>
          <h3 className="font-bold text-lg flex items-center" style={{ color: '#FFFFFF' }}>📝 填寫 W{currentWeek} 非專案工作{targetUser ? `（${targetUser}）` : ''}</h3>
          <CloseButton onClick={onClose} className="text-white/60 hover:text-white" />
        </div>
        <div className="p-6">
          {targetUser && (
            <div className="mb-4 bg-amber-100 border border-amber-400 text-amber-900 rounded-lg px-3 py-2.5 text-xs font-bold flex items-center">
              <span className="mr-2 text-sm">👑</span>
              <span>主管代修模式：正在編輯 {targetUser} 的內容，異動紀錄將標記為主管修正。</span>
            </div>
          )}
          {initialNote ? (
            <div className="mb-4 bg-green-50 border border-green-300 text-green-800 rounded-lg px-3 py-2.5 text-sm font-bold">
              <div className="flex items-center"><span className="mr-2">✅</span> 本週已送出過，以下為已儲存的內容，可修改後重新送出。</div>
              <MetaLine meta={meta} className="text-[11px] text-green-700 font-medium mt-1" />
            </div>
          ) : (
            <div className="mb-4 bg-yellow-50 border border-yellow-300 text-yellow-800 rounded-lg px-3 py-2.5 text-sm font-bold flex items-center">
              <span className="mr-2">📭</span> 本週尚未填寫。
            </div>
          )}
          <p className="text-sm text-slate-500 mb-4 border-l-4 border-orange-400 pl-3">
            專案外的項目（日常維運、臨時交辦、會議、教育訓練等）請填寫於此，會呈現在團隊總結看板。
            <span className="block mt-1 text-slate-500">此欄為選填，隨時可清空內容後儲存。</span>
          </p>
          <textarea value={note} onChange={e => { setNote(e.target.value); setError(''); markModalDirty(); }}
            placeholder={"例如：\n1. 協助 OOO 機台異常處理 (1天)\n2. 參加跨部門會議…"}
            className={`w-full border rounded-lg p-3 text-sm h-40 outline-none focus:ring-2 focus:ring-orange-400 resize-none ${error ? 'border-red-400' : 'border-slate-300'}`}></textarea>
          {error && <div className="text-xs text-red-600 font-bold mt-1">{error}</div>}
          <div className="flex justify-end space-x-3 pt-4">
            <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 bg-slate-100 rounded-lg font-bold hover:bg-slate-200">取消</button>
            <button onClick={submit} disabled={saving}
              className={`px-6 py-2 text-sm text-white font-bold rounded-lg shadow-md disabled:opacity-50 ${isClearing ? 'bg-slate-500 hover:bg-slate-600' : 'bg-orange-500 hover:bg-orange-600'}`}>
              {saving ? '儲存中…' : isClearing ? '清空內容' : '送出回報'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// 具體產出項目:專案「全部執行完畢後」預計交付的具體成果(專案層級,所有計畫區間共用);
// 負責人本人與主管可編輯(SP 內再驗一次權限),其他成員唯讀
function DeliverableModal({ proj, role, currentUser, onClose, onSave }) {
  const focus = useModalFocus();   // 開啟時焦點移入、Tab 鎖在視窗內、關閉時還原
  const canEdit = role === 'manager' || proj.owner === currentUser;
  const [text, setText] = useState(proj.deliverable || '');
  const [mpSaving, setMpSaving] = useState(proj.mpSaving || '');
  const [saving, setSaving] = useState(false);
  useModalDirtyReset();
  const submit = async () => {
    if (saving) return;
    setSaving(true);
    try { await onSave(proj.id, text.trim(), mpSaving.trim()); } finally { setSaving(false); }
  };
  return (
    <div {...focus} className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm modal-scrim z-[130] flex justify-center items-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl modal-card w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 text-white flex justify-between items-start" style={{ backgroundColor: '#B45309' }}>
          <div className="pr-3">
            <h3 className="font-bold text-lg" style={{ color: '#FFFFFF' }}>🎯 具體產出與 MP 效益</h3>
            <p className="text-xs mt-0.5 break-words leading-snug" style={{ color: '#FEF3C7' }}>{proj.name}（負責人：{proj.owner}）</p>
          </div>
          <CloseButton onClick={onClose} className="text-white/70 hover:text-white flex-shrink-0" />
        </div>
        <div className="p-6">
          <p className="text-sm text-slate-500 mb-4 border-l-4 border-amber-400 pl-3">
            請描述此專案<span className="font-bold text-slate-700">全部執行完畢後</span>預計交付的具體成果與預期減少的人力負擔（MP 人力節省）。
          </p>
          {canEdit ? (
            <div className="space-y-4">
              <div className="flex justify-end mb-1">
                <span className="text-[10px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-bold">{role === 'manager' ? '主管可編輯' : '負責人可編輯'}</span>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">🎯 具體產出成果項目</label>
                <textarea value={text} onChange={e => { setText(e.target.value); markModalDirty(); }} autoFocus
                  placeholder="描述專案完成後要交付的最終成果（系統上線、SOP 文件等）…"
                  className="w-full border border-slate-300 rounded-lg p-3 text-sm h-28 outline-none focus:ring-2 focus:ring-amber-400 resize-none"></textarea>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">💡 MP Saving (選填)</label>
                <input type="text" value={mpSaving} onChange={e => { setMpSaving(e.target.value); markModalDirty(); }}
                  onKeyDown={onEnterSubmit(submit)}
                  placeholder="例如：0.5 人/月、每年節省 120 小時…"
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-amber-400" />
              </div>
              <div className="flex justify-end space-x-3 pt-2">
                <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 bg-slate-100 rounded-lg font-bold hover:bg-slate-200">取消</button>
                <button onClick={submit} disabled={saving}
                  className="px-6 py-2 text-sm bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-bold rounded-lg shadow-md">{saving ? '儲存中…' : '儲存'}</button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-sm text-slate-700 whitespace-pre-wrap bg-amber-50/70 border border-amber-200 rounded-lg p-4">
                <div className="text-xs font-bold text-amber-800 mb-1">🎯 具體產出項目</div>
                {proj.deliverable || <span className="text-slate-500 italic">（負責人尚未填寫）</span>}
              </div>
              {proj.mpSaving && (
                <div className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg p-3 font-bold">
                  💡 MP Saving：{proj.mpSaving}
                </div>
              )}
              <div className="flex justify-end pt-3">
                <button onClick={onClose} className="px-6 py-2 text-sm bg-slate-600 hover:bg-slate-700 text-white font-bold rounded-lg">關閉</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// 下週預計執行工作:每人每週一筆(填寫於本週,內容為下一週的工作安排),樣式比照非專案事項但用靛藍色系
function WeeklyPlanModal({ currentWeek, initialNote, readOnly, targetUser, meta, onClose, onSave }) {
  const focus = useModalFocus();   // 開啟時焦點移入、Tab 鎖在視窗內、關閉時還原
  const [note, setNote] = useState(initialNote);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useModalDirtyReset();
  // 允許清空:清空後系統將其復原為「必填尚未填寫」(扣回打卡 1 分)，待重新填寫送出後再計分
  const isClearing = !note.trim() && !!initialNote;
  const submit = async () => {
    if (saving) return;
    setSaving(true);
    try { await onSave(note.trim()); } finally { setSaving(false); }
  };
  if (readOnly) {
    return (
      <div {...focus} className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm modal-scrim z-[110] flex justify-center items-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl modal-card w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
          <div className="px-6 py-4 text-white flex justify-between items-center" style={{ backgroundColor: '#475569' }}>
            <h3 className="font-bold text-lg" style={{ color: '#FFFFFF' }}>🔒 W{currentWeek} 下週預計工作（唯讀）</h3>
            <CloseButton onClick={onClose} className="text-white/60 hover:text-white" />
          </div>
          <div className="p-6">
            <p className="text-xs text-slate-500 mb-3">歷史週次僅供瀏覽，無法修改。</p>
            {initialNote ? (
              <div>
                <div className="text-sm text-slate-700 bg-slate-100 border border-slate-300 rounded-lg p-4 whitespace-pre-wrap">{initialNote}</div>
                <MetaLine meta={meta} />
              </div>
            ) : (
              <div className="text-sm text-slate-500 italic text-center py-6">該週未填寫下週預計工作</div>
            )}
            <div className="flex justify-end pt-4">
              <button onClick={onClose} className="px-6 py-2 text-sm bg-slate-600 hover:bg-slate-700 text-white font-bold rounded-lg">關閉</button>
            </div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div {...focus} className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm modal-scrim z-[110] flex justify-center items-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl modal-card w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 text-white flex justify-between items-center" style={{ backgroundColor: '#6366F1' }}>
          <h3 className="font-bold text-lg flex items-center" style={{ color: '#FFFFFF' }}>📅 填寫 W{currentWeek} 下週預計執行工作{targetUser ? `（${targetUser}）` : ''}</h3>
          <CloseButton onClick={onClose} className="text-white/60 hover:text-white" />
        </div>
        <div className="p-6">
          {targetUser && (
            <div className="mb-4 bg-amber-100 border border-amber-400 text-amber-900 rounded-lg px-3 py-2.5 text-xs font-bold flex items-center">
              <span className="mr-2 text-sm">👑</span>
              <span>主管代修模式：正在編輯 {targetUser} 的內容，異動紀錄將標記為主管修正。</span>
            </div>
          )}
          {initialNote ? (
            <div className="mb-4 bg-green-50 border border-green-300 text-green-800 rounded-lg px-3 py-2.5 text-sm font-bold">
              <div className="flex items-center">
                <span className="mr-2">✅</span> 本週已送出過，可修改或清空後重新填寫。
              </div>
              <MetaLine meta={meta} className="text-[11px] text-green-700 font-medium mt-1" />
            </div>
          ) : (
            <div className="mb-4 bg-yellow-50 border border-yellow-300 text-yellow-800 rounded-lg px-3 py-2.5 text-sm font-bold flex items-center">
              <span className="mr-2">📭</span> 本週尚未填寫（有填寫並送出才算完成打卡得 1 分）。
            </div>
          )}
          <p className="text-sm text-slate-500 mb-4 border-l-4 border-indigo-400 pl-3">
            請填寫下一週（W{String(Math.min(currentWeek + 1, 53)).padStart(2, '0')}）預計進行的工作安排；隨時可清空內容後送出（清空後將恢復為未填寫，有填寫才算有打卡得 1 分）。
          </p>
          <textarea value={note} onChange={e => { setNote(e.target.value); setError(''); markModalDirty(); }}
            placeholder={"例如：\n1. OOO 專案進入測試階段，預計完成驗證報告\n2. 準備季度檢討資料…"}
            className={`w-full border rounded-lg p-3 text-sm h-40 outline-none focus:ring-2 focus:ring-indigo-400 resize-none ${error ? 'border-red-400' : 'border-slate-300'}`}></textarea>
          {error && <div className="text-xs text-red-600 font-bold mt-1">{error}</div>}
          <div className="flex justify-end space-x-3 pt-4">
            <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 bg-slate-100 rounded-lg font-bold hover:bg-slate-200">取消</button>
            <button onClick={submit} disabled={saving}
              className={`px-6 py-2 text-sm text-white font-bold rounded-lg shadow-md disabled:opacity-50 ${isClearing ? 'bg-slate-500 hover:bg-slate-600' : 'bg-indigo-500 hover:bg-indigo-600'}`}>
              {saving ? '儲存中…' : isClearing ? '清空重填' : '送出'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// 即將到期清單面板:列出剩餘 ≤2 週或已過 70% 時程的任務,依剩餘週數排序,點擊可定位並開啟任務視窗
function DeadlinePanel({ items, onClose, onSelect }) {
  const focus = useModalFocus();   // 開啟時焦點移入、Tab 鎖在視窗內、關閉時還原
  return (
    <div {...focus} className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm modal-scrim z-[105] flex justify-end">
      <div className="w-full max-w-sm bg-white h-full shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        {/* 標題列顏色一律用行內樣式:企業內網若快取到舊版 app.css,新 class 不存在會變白底白字 */}
        <div className="px-5 py-4 text-white flex justify-between items-center" style={{ backgroundColor: 'var(--hdr-deadline, #EA580C)' }}>
          <div>
            <h3 className="font-bold text-lg" style={{ color: '#FFFFFF' }}>⏰ 即將到期清單</h3>
            <p className="text-xs mt-0.5" style={{ color: '#FFF7ED' }}>剩餘 ≤2 週或時程已過 70% 的計畫區間</p>
          </div>
          <CloseButton onClick={onClose} className="text-white/70 hover:text-white p-1" />
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {items.length === 0 ? (
            <div className="text-center text-slate-500 py-16">
              <div className="text-4xl mb-3">🎉</div>
              <div className="font-bold text-slate-600">目前沒有即將到期的任務</div>
            </div>
          ) : items.map(({ proj, task, remain, elapsed }) => (
            <button key={task.id} onClick={() => onSelect({ proj, task })}
              className="w-full text-left bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded-xl p-3 transition group">
              <div className="flex items-center justify-between">
                <div className="min-w-0 pr-2">
                  <div className="text-xs font-bold text-slate-700 break-words leading-snug">{proj.name}</div>
                  <div className="text-sm text-slate-600 mt-0.5 truncate">{task.name}</div>
                  <div className="text-[10px] text-slate-500 mt-1">👤 {proj.owner} · 排程 W{task.start}–W{task.end}</div>
                </div>
                <div className="flex-shrink-0 text-right">
                  <div className={`font-bold text-sm ${remain <= 1 ? 'text-red-600' : 'text-orange-600'}`}>剩 {remain} 週</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">已過 {elapsed}%</div>
                </div>
              </div>
              <div className="mt-2 h-1.5 bg-white rounded-full overflow-hidden border border-orange-200">
                <div className={`h-full rounded-full ${remain <= 1 ? 'bg-red-500' : 'bg-orange-400'}`} style={{ width: `${Math.min(elapsed, 100)}%` }}></div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function PendingPanel({ pending = [], completed = [], currentWeek, planPending = false, extraFilled = false, retro = false, planMeta, extraMeta, onFillPlan, onFillExtra, onClose, onSelect }) {
  const focus = useModalFocus();   // 開啟時焦點移入、Tab 鎖在視窗內、關閉時還原
  const totalRequired = pending.length + completed.length + 1; // 任務總數 + 1項下週預計
  const completedCount = completed.length + (planPending ? 0 : 1);
  const percent = totalRequired > 0 ? Math.round((completedCount / totalRequired) * 100) : 100;
  const allDone = pending.length === 0 && !planPending;
  const wkLabel = retro ? `W${String(currentWeek).padStart(2, '0')}` : '本週';   // 補登模式所有文案以週次取代「本週」

  return (
    <div {...focus} className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm modal-scrim z-[105] flex justify-end">
      <div className="w-full max-w-md bg-white h-full shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        {/* 方案C：整合式表頭與回報進度條(補登模式改琥珀色標題列) */}
        <div className="px-5 py-4 text-white flex flex-col space-y-3" style={{ backgroundColor: retro ? '#92400E' : '#001F5B' }}>
          <div className="flex justify-between items-center">
            <div>
              <h3 className="font-bold text-lg flex items-center gap-2">
                <span>{retro ? `🕘 W${String(currentWeek).padStart(2, '0')} 歷史回報補登` : `📋 W${String(currentWeek).padStart(2, '0')} 本週回報中心`}</span>
              </h3>
              <p className={`text-xs mt-0.5 ${retro ? 'text-amber-200' : 'text-blue-200'}`}>{retro ? '主管已開放補登：可修改此週任務打卡、非專案事項與下週預計工作' : '整合本週排定任務打卡 ＋ 每週必填工作預計'}</p>
            </div>
            <CloseButton onClick={onClose} className="text-white/60 hover:text-white p-1" />
          </div>
          <div className="bg-white/10 rounded-xl p-3 border border-white/20">
            <div className="flex justify-between items-center text-xs font-bold mb-1.5">
              <span>{wkLabel}回報完成度</span>
              <span className="text-amber-300">{completedCount} / {totalRequired} 項 ({percent}%)</span>
            </div>
            <div className="w-full h-2 bg-white/20 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all duration-500 ${allDone ? 'bg-emerald-400' : 'bg-amber-400'}`}
                style={{ width: `${percent}%` }}></div>
            </div>
          </div>
        </div>

        {/* 方案C：主內容分區清單 */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* 補登模式警示列:提醒正在修改歷史紀錄 */}
          {retro && (
            <div className="bg-amber-50 border border-amber-400 text-amber-900 rounded-xl px-3.5 py-2.5 text-xs font-bold flex items-center">
              <span className="mr-2 text-sm">⚠️</span>
              <span>補登模式：正在修改 W{String(currentWeek).padStart(2, '0')} 的歷史回報，異動會留下稽核紀錄。</span>
            </div>
          )}
          {/* ① 第一優先：本週待打卡任務 */}
          <div>
            <div className="text-xs font-black text-slate-500 uppercase tracking-wider mb-2">🔵 {wkLabel}待打卡任務 ({pending.length} 項)</div>
            {pending.length === 0 ? (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center text-emerald-800 font-bold text-xs">
                🎉 太棒了！{wkLabel}排定之專案任務已全數完成打卡
              </div>
            ) : (
              <div className="space-y-2.5">
                {pending.map(({ proj, task }) => (
                  <button key={task.id} onClick={() => onSelect({ proj, task }, undefined)}
                    className="w-full text-left bg-yellow-50 hover:bg-yellow-100 border border-yellow-300 rounded-xl p-3.5 transition group shadow-sm">
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 pr-2">
                        <div className="text-xs font-bold text-amber-900 dark:text-amber-200 break-words leading-snug">{proj.name}</div>
                        <div className="text-sm font-black text-slate-800 mt-0.5 truncate">{task.name}</div>
                        <div className="text-[10px] text-slate-500 mt-1">排程 W{task.start}–W{task.end} · {proj.category}</div>
                      </div>
                      <div className="flex-shrink-0 text-blue-600 font-bold text-xs bg-white border border-blue-300 rounded-full px-3 py-1.5 group-hover:bg-blue-600 group-hover:text-white transition shadow-sm">
                        打卡回報 ›
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ② 第二優先：下週預計執行工作（必填） */}
          <div>
            <div className="text-xs font-black text-slate-500 uppercase tracking-wider mb-2">📅 下週預計執行工作（必填）</div>
            <button onClick={onFillPlan}
              className={`w-full text-left border rounded-xl p-3.5 transition group border-l-4 ${planPending ? 'bg-pink-50 hover:bg-pink-100 border-pink-200 border-l-red-500 shadow-sm' : 'bg-emerald-50/70 hover:bg-emerald-100/70 border-emerald-200 border-l-emerald-500'}`}>
              <div className="flex items-center justify-between">
                <div className="min-w-0 pr-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-800">下週預計執行工作</span>
                    {planPending ? (
                      <span className="bg-red-600 text-white text-[10px] px-1.5 py-0.5 rounded font-bold">必填尚未填寫</span>
                    ) : (
                      <span className="bg-emerald-600 text-white text-[10px] px-1.5 py-0.5 rounded font-bold">✓ 已填寫完成</span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">請安排 W{String(Math.min(currentWeek + 1, 53)).padStart(2, '0')} 週預計進行的工作內容</div>
                  {!planPending && <MetaLine meta={planMeta} className="text-[10px] text-slate-500 mt-0.5" />}
                </div>
                <div className={`flex-shrink-0 font-bold text-xs bg-white border rounded-full px-3 py-1.5 transition ${planPending ? 'text-red-600 border-red-300 group-hover:bg-red-600 group-hover:text-white' : 'text-emerald-600 border-emerald-300 group-hover:bg-emerald-600 group-hover:text-white'}`}>
                  {planPending ? '立即填寫 ›' : '檢閱修改 ›'}
                </div>
              </div>
            </button>
          </div>

          {/* ③ 第三優先：非專案事項（選填） */}
          <div>
            <div className="text-xs font-black text-slate-500 uppercase tracking-wider mb-2">📝 非專案事項（選填）</div>
            <button onClick={onFillExtra}
              className={`w-full text-left border rounded-xl p-3.5 transition group border-l-4 ${extraFilled ? 'bg-emerald-50/70 hover:bg-emerald-100/70 border-emerald-200 border-l-emerald-500' : 'bg-orange-50 hover:bg-orange-100 border-orange-200 border-l-orange-400'}`}>
              <div className="flex items-center justify-between">
                <div className="min-w-0 pr-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-800">非專案事項</span>
                    {extraFilled ? (
                      <span className="bg-emerald-600 text-white text-[10px] px-1.5 py-0.5 rounded font-bold">✓ 已填寫完成</span>
                    ) : (
                      <span className="bg-slate-400 text-white text-[10px] px-1.5 py-0.5 rounded font-bold">選填 · 未填寫</span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">日常維運、臨時交辦、會議等專案外項目（選填，不計入完成度）</div>
                  {extraFilled && <MetaLine meta={extraMeta} className="text-[10px] text-slate-500 mt-0.5" />}
                </div>
                <div className={`flex-shrink-0 font-bold text-xs bg-white border rounded-full px-3 py-1.5 transition ${extraFilled ? 'text-emerald-600 border-emerald-300 group-hover:bg-emerald-600 group-hover:text-white' : 'text-orange-600 border-orange-300 group-hover:bg-orange-600 group-hover:text-white'}`}>
                  {extraFilled ? '檢閱修改 ›' : '前往填寫 ›'}
                </div>
              </div>
            </button>
          </div>

          {/* ④ 參考資訊：本週已完成打卡任務(唯讀性質,放最後避免把必填項目推出視野) */}
          {completed.length > 0 && (
            <div>
              <div className="text-xs font-black text-slate-500 uppercase tracking-wider mb-2">🟢 {wkLabel}已完成打卡任務 ({completed.length} 項)</div>
              <div className="space-y-2">
                {completed.map(({ proj, task, log }) => (
                  <button key={task.id} onClick={() => onSelect({ proj, task }, log)}
                    className="w-full text-left bg-slate-100 hover:bg-slate-100 border border-slate-300 rounded-xl p-3 transition group opacity-90">
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 pr-2">
                        <div className="text-xs font-bold text-slate-600 break-words leading-snug">{proj.name}</div>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${log.status === 'executed' ? 'bg-green-100 text-green-800' : log.status === 'monitor' ? 'bg-sky-100 text-sky-800' : 'bg-slate-200 text-slate-700'}`}>
                            {STATUS_META[log.status]?.icon} {STATUS_META[log.status]?.label}
                          </span>
                        </div>
                        <div className="text-xs font-medium text-slate-700 mt-1 truncate">{task.name}</div>
                        {log.updatedAt && (
                          <div className="text-[10px] text-slate-500 mt-0.5">🕘 最後編輯 {log.updatedAt}{log.reporterRole === 'manager' ? '・✏️ 主管修正' : ''}</div>
                        )}
                      </div>
                      <div className="flex-shrink-0 text-slate-500 font-bold text-xs bg-white border border-slate-300 rounded-full px-2.5 py-1 group-hover:border-slate-400 transition">
                        修改 ›
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 方案C：Completion Loop 底部收尾導引按鈕區塊 */}
        <div className="p-4 bg-slate-100 border-t border-slate-300">
          {allDone ? (
            <button onClick={onClose}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm rounded-xl shadow-md transition flex items-center justify-center gap-2">
              <span>🎉 {wkLabel}回報已全數完成！返回總表 ›</span>
            </button>
          ) : (
            <button onClick={onClose}
              className="w-full py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs rounded-xl transition">
              暫存離開（尚有 {pending.length + (planPending ? 1 : 0)} 項待完成項目）
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// 主管:週次回報編輯面板 — 選成員後可代為補登/修正該週任務打卡、非專案事項、下週預計工作,
// 並可編輯主管回覆;所有代修異動由 SP 記錄操作者(ReportedBy/UpdatedBy=主管)並留稽核紀錄
function ManagerWeekPanel({ week, todayWeek, users = [], projects, taskLogs, extraNotes, weeklyPlans, weeklyComments, extraNoteMeta = {}, weeklyPlanMeta = {}, weeklyCommentMeta = {}, onClose, onSelectTask, onEditExtra, onEditPlan, onEditComment }) {
  const focus = useModalFocus();   // 開啟時焦點移入、Tab 鎖在視窗內、關閉時還原
  const [member, setMember] = useState(users[0] || '');
  const wk = String(week).padStart(2, '0');

  const rows = [];
  projects.filter(p => p.owner === member).forEach(p => p.tasks.forEach(t => {
    if (t.start <= week && t.end >= week) rows.push({ proj: p, task: t, log: taskLogs[t.id]?.[week] });
  }));
  const extra = extraNotes[member]?.[week] || '';
  const plan = weeklyPlans[member]?.[week] || '';
  const comment = weeklyComments[member]?.[week] || '';
  const extraMeta = extraNoteMeta[member]?.[week];
  const planMeta = weeklyPlanMeta[member]?.[week];
  const commentMeta = weeklyCommentMeta[member]?.[week];

  // 三張可編輯卡片共用的列版型(meta=最後編輯資訊;主管回覆傳 showManagerTag=false)
  const editRow = (icon, label, value, emptyText, colorCls, onEdit, meta, showManagerTag = true) => (
    <button onClick={onEdit}
      className={`w-full text-left border rounded-xl p-3.5 transition group shadow-sm ${colorCls}`}>
      <div className="flex items-center justify-between">
        <div className="min-w-0 pr-2">
          <div className="text-xs font-bold text-slate-800">{icon} {label}</div>
          {value
            ? <div className="text-xs text-slate-600 mt-1 whitespace-pre-wrap" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{value}</div>
            : <div className="text-xs text-slate-500 italic mt-1">{emptyText}</div>}
          {value && <MetaLine meta={meta} showManagerTag={showManagerTag} className="text-[10px] text-slate-500 mt-0.5" />}
        </div>
        <div className="flex-shrink-0 text-slate-600 font-bold text-xs bg-white border border-slate-300 rounded-full px-3 py-1.5 group-hover:bg-slate-700 group-hover:text-white transition">
          編輯 ›
        </div>
      </div>
    </button>
  );

  return (
    <div {...focus} className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm modal-scrim z-[105] flex justify-end">
      <div className="w-full max-w-md bg-white h-full shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 text-white flex flex-col space-y-3" style={{ backgroundColor: '#92400E' }}>
          <div className="flex justify-between items-center">
            <div>
              <h3 className="font-bold text-lg">🛠 W{wk} 回報編輯（主管）</h3>
              <p className="text-xs text-amber-200 mt-0.5">代成員補登/修正此週回報，異動會標記主管修正並留下稽核紀錄</p>
            </div>
            <CloseButton onClick={onClose} className="text-white/60 hover:text-white p-1" />
          </div>
          <div className="bg-white/10 rounded-xl p-3 border border-white/20 flex items-center gap-2">
            <span className="text-xs font-bold whitespace-nowrap">編輯成員</span>
            <select value={member} onChange={e => setMember(e.target.value)}
              className="flex-1 border border-white/30 bg-white text-slate-800 rounded-lg px-2 py-1.5 text-sm font-bold outline-none">
              {users.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
            {week !== todayWeek && (
              <span className="text-[10px] font-bold bg-amber-300 text-amber-900 px-2 py-1 rounded-full whitespace-nowrap">歷史週次</span>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* ① 該週任務打卡 */}
          <div>
            <div className="text-xs font-black text-slate-500 uppercase tracking-wider mb-2">📌 W{wk} 排定任務打卡 ({rows.length} 項)</div>
            {rows.length === 0 ? (
              <div className="bg-slate-100 border border-slate-300 rounded-xl p-4 text-center text-slate-500 text-xs italic">此週無排定任務</div>
            ) : (
              <div className="space-y-2.5">
                {rows.map(({ proj, task, log }) => (
                  <button key={task.id} onClick={() => onSelectTask(proj, task, log)}
                    className={`w-full text-left border rounded-xl p-3 transition group shadow-sm ${log ? 'bg-slate-100 hover:bg-slate-100 border-slate-300' : 'bg-yellow-50 hover:bg-yellow-100 border-yellow-300'}`}>
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 pr-2">
                        <div className="text-xs font-bold text-slate-700 break-words leading-snug">{proj.name}</div>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                          {log ? (
                            <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold ${log.status === 'executed' ? 'bg-green-100 text-green-800' : log.status === 'monitor' ? 'bg-sky-100 text-sky-800' : 'bg-slate-200 text-slate-700'}`}>
                              {STATUS_META[log.status]?.icon} {STATUS_META[log.status]?.label}
                            </span>
                          ) : (
                            <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700 border border-red-300">❗未回報</span>
                          )}
                          {log?.reporterRole === 'manager' && (
                            <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300" title="此筆由主管代為修正/補登">✏️主管</span>
                          )}
                        </div>
                        <div className="text-xs font-medium text-slate-700 mt-1 truncate">{task.name}</div>
                        {log?.updatedAt && (
                          <div className="text-[10px] text-slate-500 mt-0.5">🕘 最後編輯 {log.updatedAt}{log.reporter ? `（${log.reporter}）` : ''}</div>
                        )}
                      </div>
                      <div className="flex-shrink-0 text-slate-600 font-bold text-xs bg-white border border-slate-300 rounded-full px-2.5 py-1 group-hover:bg-slate-700 group-hover:text-white transition">
                        {log ? '修改 ›' : '補登 ›'}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ② 非專案事項 / 下週預計(代成員修正) */}
          <div>
            <div className="text-xs font-black text-slate-500 uppercase tracking-wider mb-2">📝 每週回報內容（代 {member} 修正）</div>
            <div className="space-y-2.5">
              {editRow('📝', '非專案事項', extra, '未填寫（可代為補登）', 'bg-orange-50/70 hover:bg-orange-100/70 border-orange-200', () => onEditExtra(member), extraMeta)}
              {editRow('📅', '下週預計執行工作', plan, '未填寫（可代為補登）', 'bg-indigo-50/70 hover:bg-indigo-100/70 border-indigo-200', () => onEditPlan(member), planMeta)}
            </div>
          </div>

          {/* ③ 主管回覆(僅主管可編;成員補登面板無此項) */}
          <div>
            <div className="text-xs font-black text-slate-500 uppercase tracking-wider mb-2">👑 主管回覆（成員不可異動）</div>
            {editRow('💬', `對 ${member} 的 W${wk} 週報回覆`, comment, '尚未回覆（選填）', 'bg-violet-50/70 hover:bg-violet-100/70 border-violet-200', () => onEditComment(member), commentMeta, false)}
          </div>
        </div>

        <div className="p-4 bg-slate-100 border-t border-slate-300">
          <button onClick={onClose}
            className="w-full py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs rounded-xl transition">
            關閉面板
          </button>
        </div>
      </div>
    </div>
  );
}

// 主管週報回覆:針對單一成員×週的建議(選填,可清空);儲存後顯示於團隊總結看板,全員可見
function CommentModal({ member, currentWeek, initialComment, meta, onClose, onSave }) {
  const focus = useModalFocus();   // 開啟時焦點移入、Tab 鎖在視窗內、關閉時還原
  const [text, setText] = useState(initialComment);
  const [saving, setSaving] = useState(false);
  useModalDirtyReset();
  const isClearing = !text.trim() && !!initialComment;
  const submit = async () => {
    if (saving) return;
    setSaving(true);
    try { await onSave(text.trim()); } finally { setSaving(false); }
  };
  return (
    <div {...focus} className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm modal-scrim z-[140] flex justify-center items-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl modal-card w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* 標題列顏色一律用行內樣式:企業內網若快取到舊版 app.css,新 class 不存在會變白底白字 */}
        <div className="px-6 py-4 text-white flex justify-between items-center" style={{ backgroundColor: '#7C3AED' }}>
          <div>
            <h3 className="font-bold text-lg" style={{ color: '#FFFFFF' }}>💬 回覆 {member} 的 W{String(currentWeek).padStart(2, '0')} 週報</h3>
            <p className="text-xs mt-0.5" style={{ color: '#EDE9FE' }}>主管建議(選填)，儲存後全體成員於團隊總結看板可見</p>
          </div>
          <CloseButton onClick={onClose} className="text-white/60 hover:text-white" />
        </div>
        <div className="p-6">
          {initialComment ? (
            <div className="mb-4 bg-violet-50 border border-violet-300 text-violet-800 rounded-lg px-3 py-2.5 text-sm font-bold">
              <div className="flex items-center"><span className="mr-2">✅</span> 本週已回覆過，以下為已儲存的內容，可修改後重新送出。</div>
              <MetaLine meta={meta} showManagerTag={false} className="text-[11px] text-violet-700 font-medium mt-1" />
            </div>
          ) : (
            <div className="mb-4 bg-slate-100 border border-slate-300 text-slate-600 rounded-lg px-3 py-2.5 text-sm font-bold flex items-center">
              <span className="mr-2">📭</span> 本週尚未回覆此成員。
            </div>
          )}
          <p className="text-sm text-slate-500 mb-4 border-l-4 border-violet-400 pl-3">
            針對 {member} 本週的回報結果給予回饋或建議（工作方向、優先順序、提醒事項等）。
            <span className="block mt-1 text-slate-500">此欄為選填，隨時可清空內容後儲存。</span>
          </p>
          <textarea value={text} onChange={e => { setText(e.target.value); markModalDirty(); }} autoFocus
            placeholder={"例如：\n1. FDC 案進度良好，下週優先處理驗證報告\n2. 非專案事項佔比偏高，需要時提出來討論…"}
            className="w-full border border-slate-300 rounded-lg p-3 text-sm h-36 outline-none focus:ring-2 focus:ring-violet-400 resize-none"></textarea>
          <div className="flex justify-end space-x-3 pt-4">
            <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 bg-slate-100 rounded-lg font-bold hover:bg-slate-200">取消</button>
            <button onClick={submit} disabled={saving}
              className={`px-6 py-2 text-sm text-white font-bold rounded-lg shadow-md disabled:opacity-50 ${isClearing ? 'bg-slate-500 hover:bg-slate-600' : 'bg-violet-600 hover:bg-violet-700'}`}>
              {saving ? '儲存中…' : isClearing ? '清空回覆' : '送出回覆'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// 最後編輯資訊列(meta={by,byRole,at});showManagerTag=false 用於主管回覆(編輯者必為主管,標記為冗餘)
function MetaLine({ meta, showManagerTag = true, className = 'text-[10px] text-slate-500 mt-1' }) {
  if (!meta || !meta.at) return null;
  return (
    <div className={className}>
      🕘 最後編輯 {meta.at}{meta.by ? `（${meta.by}）` : ''}
      {showManagerTag && meta.byRole === 'manager' && (
        <span className="ml-1 px-1 py-px rounded bg-amber-100 text-amber-800 border border-amber-300 font-bold" title="此筆由主管代為修正/補登">✏️ 主管修正</span>
      )}
    </div>
  );
}

function WeeklyReportDashboard({ currentWeek, year, users, projects, taskLogs, extraNotes, weeklyPlans = {}, weeklyComments = {}, extraNoteMeta = {}, weeklyPlanMeta = {}, weeklyCommentMeta = {}, currentUser, role, panelWidth = 672, highlightedTaskId, onHighlightTask, onEditComment, onClose }) {
  const isManager = role === 'manager';
  // 看板變窄(投影機/筆電)時卡片內容改單欄:md: 斷點看的是「視窗寬」不是「面板寬」,不改會在窄面板裡擠成兩欄
  const narrowPanel = panelWidth < 560;
  // 更窄(≈1024 螢幕→面板 358)時成員列連晶片文字也放不下(實測溢出 26px),只留圖示＋title
  const tightRow = panelWidth < 440;
  const [copied, setCopied] = useState(false);           // 全團隊複製回饋
  const [copiedUser, setCopiedUser] = useState(null);     // 個別成員複製回饋
  const [copiedPending, setCopiedPending] = useState(false);   // 催報名單複製回饋
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

  const summary = useMemo(() => users.map(user => {
    const activeTasks = [], pendingTasks = [];
    projects.filter(p => p.owner === user).forEach(p => p.tasks.forEach(t => {
      if (t.start <= currentWeek && t.end >= currentWeek) {
        const log = taskLogs[t.id]?.[currentWeek];
        if (log) activeTasks.push({ proj: p, task: t, log });
        else pendingTasks.push({ proj: p, task: t });
      }
    }));
    // 本週得分=已回報任務分數加總(回報預設 1 分,主管可調 0.3~1);未回報=0;滿分=本週排定任務數
    const weekScore = Math.round(activeTasks.reduce((sum, { log }) => sum + Number(log.score ?? 1), 0) * 10) / 10;
    return {
      user, activeTasks, pendingTasks,
      extraNote: extraNotes[user]?.[currentWeek],
      weekPlan: weeklyPlans[user]?.[currentWeek],
      comment: weeklyComments[user]?.[currentWeek],   // 主管週報回覆(全員可見)
      extraMeta: extraNoteMeta[user]?.[currentWeek],
      planMeta: weeklyPlanMeta[user]?.[currentWeek],
      commentMeta: weeklyCommentMeta[user]?.[currentWeek],
      total: activeTasks.length + pendingTasks.length,
      weekScore
    };
  }), [users, projects, taskLogs, extraNotes, weeklyPlans, weeklyComments, extraNoteMeta, weeklyPlanMeta, weeklyCommentMeta, currentWeek]);

  // 依 onlyMine 過濾要顯示的成員摘要
  const visibleSummary = useMemo(() => {
    if (onlyMine && !isManager) return summary.filter(s => s.user === currentUser);
    return summary;
  }, [summary, onlyMine, isManager, currentUser]);

  const showTeamView = isManager || !onlyMine;   // 是否為團隊瀏覽模式（多人＋折疊）

  // 產生單一成員的週報文字
  const buildSingleUserReport = (s) => {
    const lines = [`【MSD W${String(currentWeek).padStart(2, '0')} 週報 — ${s.user}】`, ''];
    lines.push(`■ ${s.user}（回報 ${s.activeTasks.length}/${s.total}・得分 ${s.weekScore}/${s.total}）`);
    s.activeTasks.forEach(({ proj, task, log }) => {
      lines.push(`  [${STATUS_META[log.status]?.label}] ${proj.name} - ${task.name}${log.note ? '：' + log.note : ''}`);
    });
    if (s.extraNote) lines.push(`  (非專案) ${s.extraNote.replace(/\n/g, ' / ')}`);
    if (s.weekPlan) lines.push(`  (下週預計) ${s.weekPlan.replace(/\n/g, ' / ')}`);
    if (s.comment) lines.push(`  (主管回覆) ${s.comment.replace(/\n/g, ' / ')}`);
    lines.push('');
    return lines.join('\n');
  };

  // 產生可見範圍的週報文字
  const buildReportText = () => {
    const lines = [`【MSD W${String(currentWeek).padStart(2, '0')} ${showTeamView ? '團隊週報' : '週報 — ' + currentUser}】`, ''];
    visibleSummary.forEach(s => {
      if (s.activeTasks.length === 0 && !s.extraNote && !s.weekPlan) return;
      lines.push(`■ ${s.user}（回報 ${s.activeTasks.length}/${s.total}・得分 ${s.weekScore}/${s.total}）`);
      s.activeTasks.forEach(({ proj, task, log }) => {
        lines.push(`  [${STATUS_META[log.status]?.label}] ${proj.name} - ${task.name}${log.note ? '：' + log.note : ''}`);
      });
      if (s.extraNote) lines.push(`  (非專案) ${s.extraNote.replace(/\n/g, ' / ')}`);
      if (s.weekPlan) lines.push(`  (下週預計) ${s.weekPlan.replace(/\n/g, ' / ')}`);
      if (s.comment) lines.push(`  (主管回覆) ${s.comment.replace(/\n/g, ' / ')}`);
      lines.push('');
    });
    return lines.join('\n');
  };

  // 通用複製函式
  const doCopy = async (text, onDone) => {
    try {
      await navigator.clipboard.writeText(text);
      onDone();
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); onDone(); } catch {}
      document.body.removeChild(ta);
    }
  };

  const copyReport = () => doCopy(buildReportText(), () => {
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  });

  const copyUserReport = (s) => doCopy(buildSingleUserReport(s), () => {
    setCopiedUser(s.user); setTimeout(() => setCopiedUser(null), 2000);
  });

  // 催報名單:看板已經算得出每個人「回報 0/5」,但看完之後沒有任何後續動作——
  // 主管還是得自己把名字抄到通訊軟體上。這裡直接組好可貼的文字(純前端,零後端成本)。
  // 只列「真的有缺」的人:未回報任務 >0 或下週預計未填;全員都交了就不給空名單,直接回報好消息。
  const pendingSummary = useMemo(
    () => visibleSummary.filter(s => s.pendingTasks.length > 0 || !s.weekPlan),
    [visibleSummary]
  );
  const buildPendingText = () => {
    const lines = [`【MSD W${String(currentWeek).padStart(2, '0')} 待回報提醒】`, ''];
    pendingSummary.forEach(s => {
      const miss = [];
      if (s.pendingTasks.length > 0) miss.push(`專案回報 ${s.pendingTasks.length} 項未填`);
      if (!s.weekPlan) miss.push('下週預計未填');
      lines.push(`• ${s.user}：${miss.join('、')}`);
      // 把未回報的項目名稱一併列出,收到訊息的人不用再回系統查是哪幾項
      s.pendingTasks.forEach(({ proj, task }) => lines.push(`    - ${proj.name}｜${task.name}`));
    });
    lines.push('', `（共 ${pendingSummary.length} 人待補，請於本週內完成回報）`);
    return lines.join('\n');
  };
  const copyPendingList = () => doCopy(buildPendingText(), () => {
    setCopiedPending(true); setTimeout(() => setCopiedPending(false), 2000);
  });

  // 全部展開 / 全部收合
  const expandAll = () => setExpandedUsers(new Set(users));
  const collapseAll = () => setExpandedUsers(new Set());
  const toggleExpand = (user) => setExpandedUsers(prev => {
    const s = new Set(prev);
    s.has(user) ? s.delete(user) : s.add(user);
    return s;
  });

  // 卡片展開內容(收整個成員摘要物件,含各區塊內容與最後編輯 meta)
  const renderCardBody = ({ activeTasks, pendingTasks, extraNote, weekPlan, comment, extraMeta, planMeta, commentMeta }) => (
    <div className={`p-4 grid grid-cols-1 gap-4 ${narrowPanel ? '' : 'md:grid-cols-2'}`}>
      <div className="space-y-2.5">
        <div className="text-xs font-bold text-slate-500 border-b border-slate-200 pb-1">📌 專案執行項目</div>
        {activeTasks.length > 0 ? activeTasks.map(({ proj, task, log }) => (
          <div key={task.id}
            {...clickable(
              onHighlightTask ? () => onHighlightTask(proj, task) : undefined,
              `在甘特圖高亮 ${proj.name}｜${task.name}`
            )}
            title={onHighlightTask ? '點擊在左側甘特圖高亮此項目的計畫區間' : undefined}
            className={`text-sm p-2.5 rounded-lg border ${onHighlightTask ? 'cursor-pointer' : ''} ${highlightedTaskId === task.id ? 'ring-2 ring-blue-500 border-blue-400 bg-blue-50/70' : log.status === 'not_executed' ? 'bg-slate-100 border-slate-300 opacity-80' : log.status === 'monitor' ? 'bg-sky-50/70 border-sky-200' : 'bg-green-50/60 border-green-200'}`}>
            {/* 方案A:專案名稱獨立整行完整顯示(可換行,不截斷),徽章移到下方一列 */}
            <div className="font-bold text-slate-700 text-xs leading-snug break-words">{proj.name}{highlightedTaskId === task.id && <span className="ml-1 text-blue-600 text-[10px]">◀ 甘特圖已高亮</span>}</div>
            <div className="flex flex-wrap items-center gap-1 mt-1">
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${STATUS_META[log.status]?.tag}`}>{STATUS_META[log.status]?.label}</span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-700" title="打卡得分">{Number(log.score ?? 1)}分</span>
              {log.reporterRole === 'manager' && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300" title="此筆由主管代為修正/補登">✏️主管</span>
              )}
            </div>
            <div className="text-slate-600 my-1 font-medium text-xs">{task.name}</div>
            {log.note && <div className="text-slate-700 text-xs bg-white p-1.5 rounded border border-slate-200 whitespace-pre-wrap">{log.note}</div>}
            {log.updatedAt && <div className="text-[10px] text-slate-500 mt-1">🕘 最後編輯 {log.updatedAt}{log.reporter ? `（${log.reporter}）` : ''}</div>}
          </div>
        )) : <div className="text-sm text-slate-500 italic py-2">本週無專案投入</div>}
        {pendingTasks.length > 0 && (
          <div className="text-[11px] text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-lg px-2.5 py-1.5">
            尚有 {pendingTasks.length} 項本週排定任務未回報
          </div>
        )}
      </div>
      <div className={`space-y-2.5 ${narrowPanel ? 'border-t border-slate-200 pt-2' : 'md:border-l md:border-slate-100 md:pl-4'}`}>
        <div className="text-xs font-bold text-slate-500 border-b border-slate-200 pb-1">📝 日常營運 / 臨時交辦（非專案）</div>
        {extraNote ? (
          <div>
            <div className="text-sm text-slate-700 bg-orange-50 p-3 rounded-lg border border-orange-200 whitespace-pre-wrap">{extraNote}</div>
            <MetaLine meta={extraMeta} />
          </div>
        ) : <div className="text-sm text-slate-500 italic py-2">無填寫其他項目</div>}
        <div className="text-xs font-bold text-slate-500 border-b border-slate-200 pb-1 pt-1">📅 下週預計執行工作</div>
        {weekPlan ? (
          <div>
            <div className="text-sm text-slate-700 bg-indigo-50 p-3 rounded-lg border border-indigo-200 whitespace-pre-wrap">{weekPlan}</div>
            <MetaLine meta={planMeta} />
          </div>
        ) : <div className="text-sm text-slate-500 italic py-2">未填寫</div>}
      </div>
      {/* 主管回覆（選填）：有內容才顯示，全體成員可見 */}
      {comment && (
        <div className={narrowPanel ? '' : 'md:col-span-2'}>
          <div className="text-xs font-bold text-violet-700 border-b border-violet-100 pb-1 mb-2">👑 主管回覆</div>
          <div className="text-sm text-slate-800 bg-violet-50 p-3 rounded-lg border border-violet-300 whitespace-pre-wrap">{comment}</div>
          <MetaLine meta={commentMeta} showManagerTag={false} />
        </div>
      )}
    </div>
  );

  return (
    // 從視窗最頂端貼到最底端的右側欄位(fixed):連 header 那一列(管理／登出／深色切換)一起蓋住,
    // 視覺上是一整條完整的欄位;要用那些按鈕時先關掉看板即可。
    // 左側主內容區另以 marginRight 內縮同樣寬度,所以工具列與甘特不會被蓋到。
    <div className="fixed top-0 right-0 bottom-0 z-[120] bg-slate-100 shadow-[-4px_0_12px_rgba(0,0,0,0.18)] flex flex-col border-l border-slate-300"
      style={{ width: panelWidth, maxWidth: '100%' }}>
      {/* 窄面板(投影機/筆電)時標題縮排縮字、副標省略,確保三顆功能鈕不被擠出畫面 */}
      <div className={`text-white flex justify-between items-center shadow-md gap-2 ${narrowPanel ? 'px-3 py-2.5' : 'px-6 py-4'}`} style={{ backgroundColor: '#001F5B' }}>
        <div className="min-w-0">
          {/* 標題一律不斷行(whitespace-nowrap),窄面板改用短標題;真的放不下才 truncate */}
          <h2 className={`font-bold whitespace-nowrap truncate ${narrowPanel ? 'text-base leading-tight' : 'text-xl'}`}>
            📊 W{String(currentWeek).padStart(2, '0')} {narrowPanel ? '團隊總結' : '團隊工作總結看板'}
          </h2>
          {!narrowPanel && <p className="text-xs text-blue-200 mt-1">彙總各成員「專案實際執行」與「非專案事項」</p>}
        </div>
        <div className="flex items-center space-x-2 flex-shrink-0">
          <button onClick={exportExcel} disabled={exporting}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition border text-white disabled:opacity-70 whitespace-nowrap ${exportFailed ? 'bg-red-600 hover:bg-red-500 border-red-400/60' : 'bg-green-600 hover:bg-green-500 border-green-400/60'}`}
            title="下載 Excel 週報(.xlsx)">
            {exporting ? '⏳ 產生中…' : exportFailed ? (narrowPanel ? '❌ 重試' : '❌ 匯出失敗，點擊重試') : (narrowPanel ? '⬇️ Excel' : '⬇️ 匯出 Excel')}
          </button>
          <button onClick={copyReport}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition border whitespace-nowrap ${copied ? 'bg-green-500 border-green-400 text-white' : 'bg-white/10 hover:bg-white/20 border-white/20 text-white'}`}
            title="複製整份團隊週報文字">
            {copied ? '✓ 已複製' : (narrowPanel ? '📋 複製全部' : '📋 複製週報文字')}
          </button>
          <CloseButton onClick={onClose} className="text-white hover:bg-white/20 p-2 rounded-full" />
        </div>
      </div>

      {/* 子工具列：checkbox 篩選 + 展開/收合 */}
      <div className={`bg-white py-2 border-b border-slate-300 flex items-center gap-2 flex-wrap ${narrowPanel ? 'px-3' : 'px-6'}`}>
        {!isManager && (
          <label className="flex items-center space-x-1.5 cursor-pointer select-none bg-slate-100 border border-slate-300 rounded-lg px-2 py-1">
            <input type="checkbox" checked={onlyMine}
              onChange={e => { setOnlyMine(e.target.checked); if (!e.target.checked) setExpandedUsers(new Set()); else setExpandedUsers(new Set([currentUser])); }}
              className="w-3.5 h-3.5 rounded text-blue-600" />
            <span className="font-medium text-slate-700 text-[11px]">只看我的週報</span>
          </label>
        )}
        {showTeamView && (
          <>
            {!isManager && <div className="h-4 border-l border-slate-300"></div>}
            <button onClick={expandAll} className="text-[11px] text-blue-600 hover:text-blue-800 font-bold">展開全部</button>
            <span className="text-slate-500" aria-hidden="true">|</span>
            <button onClick={collapseAll} className="text-[11px] text-blue-600 hover:text-blue-800 font-bold">收合全部</button>
            {/* 催報名單:看板算得出誰沒交,但原本看完就沒有下一步了(主管得自己把名字抄到通訊軟體)。
                只有主管、且真的有人沒交時才出現——全員交齊時擺一顆按不出東西的鈕只是噪音。
                放在子工具列而不是標題列:標題列已有三顆鈕,窄面板(400px)再加會擠爆。 */}
            {isManager && pendingSummary.length > 0 && (
              <>
                <span className="text-slate-400" aria-hidden="true">|</span>
                <button onClick={copyPendingList}
                  className={`px-2 py-0.5 rounded-lg text-[11px] font-bold border transition ${copiedPending ? 'bg-green-600 border-green-700 text-white' : 'bg-amber-100 text-amber-900 border-amber-500 hover:bg-amber-200'}`}
                  title={`複製 ${pendingSummary.length} 位待回報成員的名單與缺漏項目，可直接貼到通訊軟體`}>
                  {copiedPending ? '✓ 已複製名單' : `複製待回報名單（${pendingSummary.length}）`}
                </button>
              </>
            )}
            {/* 成員列進度條的色義:常駐可見(閱讀輔助資訊不藏 tooltip)。
                刻意分成「已回報(實心)／未回報(空槽)」兩組並加分隔——「未執行」是有回報但本週沒做,
                不分組時灰色實心會被誤讀成「沒交」(使用者實際回饋)。 */}
            <div className="ml-auto flex items-center gap-1.5 text-[10px] text-slate-600 dark:text-slate-400">
              <span className="font-bold text-slate-700 dark:text-slate-300">已回報</span>
              {['executed', 'monitor', 'not_executed'].map(k => (
                <span key={k} className="flex items-center gap-1 whitespace-nowrap"><span className={`w-3 h-2.5 rounded-full ${STATUS_META[k].fill}`}></span>{STATUS_META[k].label}</span>
              ))}
              <span className="text-slate-400 dark:text-slate-500">｜</span>
              <span className="flex items-center gap-1 whitespace-nowrap font-bold text-slate-700 dark:text-slate-300">
                <span className={`w-3 h-2.5 rounded-full ${BAR_TRACK}`}></span>未回報（留空）
              </span>
            </div>
          </>
        )}
      </div>

      <div className={`flex-1 overflow-y-auto space-y-5 ${narrowPanel ? 'p-3' : 'p-6'}`}>
        {visibleSummary.map((s) => {
          const { user, activeTasks, pendingTasks, extraNote, weekPlan, total } = s;
          if (activeTasks.length === 0 && !extraNote && !weekPlan && pendingTasks.length === 0) return null;
          const isExpanded = showTeamView ? expandedUsers.has(user) : true;   // 個人模式固定展開
          const isCopiedUser = copiedUser === user;
          // 進度條改「分段組成」:一條就同時表達回報率與狀態分佈,取代原本 ✅/👁️/❗ 三顆晶片。
          // 已回報三段沿用全站狀態色(STATUS_META.fill),未回報留空槽——有填/沒填才不會被誤讀成同一類。
          const cExec = activeTasks.filter(a => a.log.status === 'executed').length;
          const cMon = activeTasks.filter(a => a.log.status === 'monitor').length;
          const cNot = activeTasks.filter(a => a.log.status === 'not_executed').length;
          const cPend = pendingTasks.length;
          const barSegs = [
            { n: cExec, key: 'executed' }, { n: cMon, key: 'monitor' }, { n: cNot, key: 'not_executed' }
          ];   // 未回報不入列:留空槽即代表未回報(條填滿程度＝回報率)
          const barTitle = `已回報 ${activeTasks.length}/${total}（有執行 ${cExec}・Monitor ${cMon}・未執行 ${cNot}）／未回報 ${cPend}`;

          return (
            <div key={user} className="bg-white dark:bg-slate-800/80 rounded-xl shadow-sm border border-slate-300 dark:border-slate-700 overflow-hidden">
              {/* 成員列固定一行:每個元件都 flex-shrink-0、只有姓名可截斷(min-w-0 truncate),
                  容器 overflow-hidden 防溢出。原本沒有任何 nowrap 保護,面板一窄就整列各自換行(姓名/按鈕都拆成兩行)。 */}
              <div className={`bg-slate-200 dark:bg-slate-800 py-2 border-b border-slate-300 dark:border-slate-700 font-bold text-slate-800 dark:text-slate-100 flex items-center overflow-hidden ${tightRow ? 'gap-1 px-2' : narrowPanel ? 'gap-1.5 px-2.5' : 'gap-2 px-4'} ${showTeamView ? 'cursor-pointer hover:bg-slate-200/70 dark:hover:bg-slate-700/70 transition' : ''}`}
                {...clickable(
                  showTeamView ? () => toggleExpand(user) : undefined,
                  `${isExpanded ? '收合' : '展開'} ${user} 的週報（${barTitle}）`,
                  { expanded: isExpanded }
                )}>
                {showTeamView && (
                  <span className="flex-shrink-0 text-slate-600 dark:text-slate-400 text-xs select-none">{isExpanded ? '▼' : '▶'}</span>
                )}
                <div className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs">{user[0]}</div>
                <span className="min-w-0 truncate" title={user}>{user}</span>
                {total > 0 && (
                  <>
                    {/* 分段進度條:已回報三段=實心(全站狀態色),未回報=留空槽
                        (取代原本 ✅n 👁️n ❗n 三顆晶片;色義由子工具列的常駐圖例說明,不靠 tooltip) */}
                    <div className={`flex-shrink-0 h-2.5 rounded-full overflow-hidden flex ${BAR_TRACK} ${tightRow ? 'w-12' : narrowPanel ? 'w-14' : 'w-24'}`} title={barTitle}>
                      {barSegs.filter(x => x.n > 0).map(x => (
                        <div key={x.key} className={STATUS_META[x.key].fill} style={{ width: `${(x.n / total) * 100}%` }}></div>
                      ))}
                    </div>
                    {/* 回報數:有未回報即轉琥珀(唯一需要催的訊號,不再另開一顆 ❗晶片);最窄時省略——條已表達比例
                        用 amber-800 而非 700:700 落在 slate-200 標題列上只有 4.07,投影 50:1 更低;800＝5.75/投影 4.97 */}
                    {!tightRow && (
                      <span className={`flex-shrink-0 text-[10px] font-bold whitespace-nowrap ${cPend > 0 ? 'text-amber-800 dark:text-amber-300' : 'text-slate-700 dark:text-slate-300'}`}>
                        {activeTasks.length}/{total}{narrowPanel ? '' : ' 回報'}
                      </span>
                    )}
                    {/* 個人週得分:已回報任務分數加總/滿分(=排定任務數);滿分綠、其餘靛藍 */}
                    <span className={`flex-shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap ${s.weekScore >= total ? 'bg-green-100 text-green-800 border-green-400 dark:bg-green-900/40 dark:text-green-300 dark:border-green-700/50' : 'bg-indigo-100 text-indigo-800 border-indigo-400 dark:bg-indigo-900/40 dark:text-indigo-300 dark:border-indigo-700/50'}`}
                      title={`本週得分＝各任務打卡分數加總（回報預設 1 分、主管可調 0.3~1；未回報 0 分）／滿分＝本週排定任務數`}>
                      {/* 最窄時省 🏆 改帶「分」字:此時回報數已隱藏,只剩一組 x/y,不標單位會分不出是回報數還是得分 */}
                      {tightRow ? `${s.weekScore}/${total}分` : `🏆 ${s.weekScore}/${total}${narrowPanel ? '' : ' 分'}`}
                    </span>
                  </>
                )}
                {/* 折疊摘要只保留「例外」:下週預計是強制項,未填才亮警示(有填是常態,不需要佔位)。
                    非專案為選填、主管回覆已由右側按鈕的紫色狀態表達,故不再各開一顆晶片。 */}
                {!isExpanded && showTeamView && !weekPlan && (
                  <span className="flex-shrink-0 bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 px-1.5 py-0.5 rounded text-[10px] font-bold border border-amber-400 dark:border-amber-700/50 whitespace-nowrap"
                    title="尚未填寫「下週預計執行工作」（強制回報項目）">📅 {narrowPanel ? '未填' : '下週預計未填'}</span>
                )}
                {/* 成員視角看不到「主管回覆」按鈕,故補一顆已回覆標記(主管端由按鈕顏色表達,不重複) */}
                {!isExpanded && showTeamView && !isManager && s.comment && (
                  <span className="flex-shrink-0 bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 px-1.5 py-0.5 rounded text-[10px] font-bold border border-violet-300 dark:border-violet-700/50" title="已有主管回覆">💬</span>
                )}
                {/* 兩顆操作鈕:**不用 emoji、不縮字**。10px 的 📋／💬 只是彩色色塊,認不出功能;
                    拿掉 emoji 省下的寬度剛好夠放完整的四字標籤(實測只差 5px),任何面板寬度都寫全名。
                    兩顆用不同色系區隔(中性=複製、紫=回覆,紫色是全站「主管回覆」的既有語彙),
                    避免並排兩顆灰鈕分不出誰是誰。 */}
                <button onClick={(e) => { e.stopPropagation(); copyUserReport(s); }}
                  className={`ml-auto flex-shrink-0 px-2 py-0.5 rounded text-[10px] font-bold transition border whitespace-nowrap ${isCopiedUser ? 'bg-green-600 border-green-700 text-white dark:bg-green-700 dark:border-green-600' : 'bg-white ctl-raised hover:bg-slate-200 border-slate-500 text-slate-700 dark:text-slate-200'}`}
                  title={`複製 ${user} 的週報文字（可貼到郵件／通訊軟體）`}>
                  {isCopiedUser ? '✓ 已複製' : '複製週報'}
                </button>
                {/* 主管專屬：回覆本週週報（選填，全體成員可見）;已回覆=紫色實心,同時取代原本的 💬 晶片 */}
                {isManager && onEditComment && (
                  <button onClick={(e) => { e.stopPropagation(); onEditComment(user); }}
                    className={`flex-shrink-0 px-2 py-0.5 rounded text-[10px] font-bold transition border whitespace-nowrap ${s.comment ? 'bg-violet-100 hover:bg-violet-200 border-violet-500 text-violet-800 dark:bg-violet-900/40 dark:hover:bg-violet-900/60 dark:border-violet-700/50 dark:text-violet-300' : 'bg-white ctl-raised hover:bg-violet-50 border-violet-500 text-violet-700 dark:text-violet-300'}`}
                    title={s.comment ? `編輯對 ${user} 的本週回覆` : `回覆 ${user} 的本週週報（選填）`}>
                    {s.comment ? '✓ 已回覆' : '主管回覆'}
                  </button>
                )}
              </div>
              {isExpanded && renderCardBody(s)}
            </div>
          );
        })}
        {visibleSummary.filter(s => s.activeTasks.length > 0 || s.extraNote || s.weekPlan || s.pendingTasks.length > 0).length === 0 && (
          <div className="text-center text-slate-500 italic py-12">本週尚無回報資料</div>
        )}
      </div>
    </div>
  );
}




function ProjectEditModal({ info, existingCategories, users = [], onClose, onSave }) {
  const focus = useModalFocus();   // 開啟時焦點移入、Tab 鎖在視窗內、關閉時還原
  const isEdit = info.mode === 'edit';
  const p = info.project;
  const [name, setName] = useState(isEdit ? p.name : '');
  const [category, setCategory] = useState(isEdit ? p.category : '');
  const [type, setType] = useState(isEdit ? p.type : 'a');
  const [nid, setNid] = useState(isEdit ? (p.nid || '') : '');   // 專案流水編號(選填;一專案可含多組)
  const [owner, setOwner] = useState(info.owner);   // 編輯時可改派負責人(如移轉給新成員)
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useModalDirtyReset();

  const submit = async () => {
    if (saving) return;
    if (!name.trim()) { setError('專案名稱不可空白'); return; }
    if (!category.trim()) { setError('分類不可空白'); return; }
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
    } finally { setSaving(false); }
  };

  return (
    <div {...focus} className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm modal-scrim z-[130] flex justify-center items-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl modal-card w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 text-white flex justify-between items-center" style={{ backgroundColor: '#001F5B' }}>
          <div>
            <h3 className="font-bold text-lg">{isEdit ? '✎ 編輯專案' : '＋ 新增專案'}</h3>
            <p className="text-xs text-blue-200 mt-0.5">負責人：{info.owner}</p>
          </div>
          <CloseButton onClick={onClose} className="text-white/60 hover:text-white" />
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="text-xs font-bold text-slate-500">專案名稱<ReqMark /></label>
            <input type="text" value={name} onChange={e => { setName(e.target.value); setError(''); markModalDirty(); }} autoFocus
              onKeyDown={onEnterSubmit(submit)}
              className="mt-1 w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500" placeholder="輸入專案名稱…" />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500">分類<ReqMark /></label>
            <input type="text" list="category-options" value={category} onChange={e => { setCategory(e.target.value); setError(''); markModalDirty(); }}
              onKeyDown={onEnterSubmit(submit)}
              className="mt-1 w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500" placeholder="選擇現有分類或輸入新分類…" />
            <datalist id="category-options">
              {existingCategories.map(c => <option key={c} value={c} />)}
            </datalist>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500">類型</label>
            <select value={type} onChange={e => { setType(e.target.value); markModalDirty(); }}
              className="mt-1 w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500 bg-white ctl-raised">
              {Object.entries(PROJECT_TYPES).map(([key, meta]) => (
                <option key={key} value={key}>{key.toUpperCase()}·{meta.label}</option>
              ))}
            </select>
          </div>
          {isEdit && (
            <div>
              <label className="text-xs font-bold text-slate-500">負責人</label>
              <select value={owner} onChange={e => { setOwner(e.target.value); markModalDirty(); }}
                className="mt-1 w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500 bg-white ctl-raised">
                {(users.includes(owner) ? users : [owner, ...users]).map(u => <option key={u} value={u}>{u}</option>)}
              </select>
              {owner !== info.owner && (
                <div className="mt-1 text-[11px] text-orange-600 font-bold">⚠ 儲存後此專案(含區間與回報紀錄)將移轉給「{owner}」</div>
              )}
            </div>
          )}
          <div>
            <label className="text-xs font-bold text-slate-500">NID（流水編號，選填）</label>
            <input type="text" value={nid} onChange={e => { setNid(e.target.value); markModalDirty(); }}
              onKeyDown={onEnterSubmit(submit)}
              className="mt-1 w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500" placeholder="專案流水編號，可含多組（如 N001, N002）…" />
          </div>
          {error && <div className="text-xs text-red-600 font-bold">{error}</div>}
          <div className="flex justify-end space-x-3 pt-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 bg-slate-100 rounded-lg font-bold hover:bg-slate-200">取消</button>
            <button onClick={submit} disabled={saving} className="px-6 py-2 text-sm text-white font-bold rounded-lg shadow-md transition hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: BRAND_BTN }}>{saving ? '儲存中…' : isEdit ? '儲存變更' : '新增專案'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function IntervalModal({ project, currentWeek, weeksTotal = WEEKS_TOTAL, onClose, onSave }) {
  const focus = useModalFocus();   // 開啟時焦點移入、Tab 鎖在視窗內、關閉時還原
  const [taskName, setTaskName] = useState('');
  const [start, setStart] = useState(currentWeek);
  const [end, setEnd] = useState(currentWeek);
  const [nid, setNid] = useState('');   // 此區間對應哪組 NID(選填)
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useModalDirtyReset();

  const submit = async () => {
    if (saving) return;
    const s = parseInt(start), e = parseInt(end);
    if (!taskName.trim()) { setError('計畫名稱不可空白'); return; }
    if (isNaN(s) || isNaN(e) || s < 1 || e > weeksTotal || s > e) { setError(`週次需介於 1–${weeksTotal}，且開始週不可晚於結束週`); return; }
    setSaving(true);
    try { await onSave(project, taskName.trim(), s, e, nid.trim()); } finally { setSaving(false); }
  };

  return (
    <div {...focus} className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm modal-scrim z-[130] flex justify-center items-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl modal-card w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 text-white flex justify-between items-center" style={{ backgroundColor: '#001F5B' }}>
          <div>
            <h3 className="font-bold text-lg">＋ 新增計畫區間</h3>
            <p className="text-xs text-blue-200 mt-0.5 truncate max-w-[300px]">{project.name}</p>
          </div>
          <CloseButton onClick={onClose} className="text-white/60 hover:text-white" />
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="text-xs font-bold text-slate-500">計畫名稱<ReqMark /></label>
            <input type="text" value={taskName} onChange={e => { setTaskName(e.target.value); setError(''); markModalDirty(); }} autoFocus
              onKeyDown={onEnterSubmit(submit)}
              className="mt-1 w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500" placeholder="輸入此區間的計畫項目…" />
          </div>
          <div className="flex space-x-3">
            <div className="w-1/2">
              <label className="text-xs font-bold text-slate-500">開始週<ReqMark /></label>
              <input type="number" min="1" max={weeksTotal} value={start} onChange={e => { setStart(e.target.value); setError(''); markModalDirty(); }}
                onKeyDown={onEnterSubmit(submit)}
                className="mt-1 w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500" />
            </div>
            <div className="w-1/2">
              <label className="text-xs font-bold text-slate-500">結束週<ReqMark /></label>
              <input type="number" min="1" max={weeksTotal} value={end} onChange={e => { setEnd(e.target.value); setError(''); markModalDirty(); }}
                onKeyDown={onEnterSubmit(submit)}
                className="mt-1 w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500" />
            </div>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500">NID（此區間對應哪組 NID，選填）</label>
            <input type="text" value={nid} onChange={e => { setNid(e.target.value); markModalDirty(); }}
              onKeyDown={onEnterSubmit(submit)}
              className="mt-1 w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500" placeholder="如 N001…" />
          </div>
          {error && <div className="text-xs text-red-600 font-bold">{error}</div>}
          <div className="flex justify-end space-x-3 pt-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 bg-slate-100 rounded-lg font-bold hover:bg-slate-200">取消</button>
            <button onClick={submit} disabled={saving} className="px-6 py-2 text-sm text-white font-bold rounded-lg shadow-md transition hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: BRAND_BTN }}>{saving ? '新增中…' : '新增區間'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// 自製刪除確認視窗(取代 window.confirm,樣式與系統一致)
function ConfirmModal({ info, onCancel }) {
  const focus = useModalFocus();   // 開啟時焦點移入、Tab 鎖在視窗內、關閉時還原
  const [busy, setBusy] = useState(false);   // 防連點:確認處理中鎖定按鈕
  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try { await info.onConfirm(); } finally { setBusy(false); }
  };
  return (
    <div {...focus} className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm modal-scrim z-[150] flex justify-center items-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl modal-card w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 text-white flex items-center" style={{ backgroundColor: '#DC2626' }}>
          <span className="text-xl mr-2">⚠️</span>
          <h3 className="font-bold text-lg" style={{ color: '#FFFFFF' }}>{info.title}</h3>
        </div>
        <div className="p-6">
          <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{info.message}</p>
          <div className="flex justify-end space-x-3 pt-5">
            <button onClick={onCancel} className="px-4 py-2 text-sm text-slate-600 bg-slate-100 rounded-lg font-bold hover:bg-slate-200">取消</button>
            <button onClick={confirm} disabled={busy}
              className="px-6 py-2 text-sm bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold rounded-lg shadow-md">
              {busy ? '處理中…' : (info.confirmLabel || '確定刪除')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// 主管:異動紀錄面板(讀 AuditLog)
const AUDIT_ACTION_META = {
  INSERT:    { label: '新增', cls: 'bg-green-100 text-green-700' },
  UPDATE:    { label: '修改', cls: 'bg-blue-100 text-blue-700' },
  DELETE:    { label: '刪除', cls: 'bg-red-100 text-red-700' },
  REORDER:   { label: '排序', cls: 'bg-purple-100 text-purple-700' },
  CLOCKIN:   { label: '回報', cls: 'bg-teal-100 text-teal-700' },
  EXTRANOTE: { label: '非專案', cls: 'bg-orange-100 text-orange-700' },
  WEEKPLAN:  { label: '下週預計', cls: 'bg-indigo-100 text-indigo-700' },
  SCORE:     { label: '評分', cls: 'bg-fuchsia-100 text-fuchsia-700' },
  COMMENT:   { label: '回覆', cls: 'bg-violet-100 text-violet-700' },
  ACCESSRULE:{ label: '權限', cls: 'bg-rose-100 text-rose-700' },
  SETTING:   { label: '設定', cls: 'bg-slate-200 text-slate-700' }
};
const AUDIT_ENTITY_LABELS = { Project: '專案', Task: '任務', WeeklyLog: '週回報', ExtraNote: '非專案事項', WeeklyPlan: '下週計畫', WeeklyComment: '主管回覆', User: '成員', AccessRule: '瀏覽權限', AppSettings: '系統設定' };

// 主管:使用統計面板 — 登入次數(LoginLogs,遷移 13)評估網頁使用率;
// 每次登入寫一筆(manual=登入畫面點選/auto=重整自動還原,兩者都代表一次開啟使用)
function UsageStatsPanel({ onClose }) {
  const focus = useModalFocus();   // 開啟時焦點移入、Tab 鎖在視窗內、關閉時還原
  const [days, setDays] = useState(30);
  const [stats, setStats] = useState(null);
  const [loadError, setLoadError] = useState(null);

  React.useEffect(() => {
    let cancelled = false;
    setStats(null); setLoadError(null);
    apiGet(`/api/login-stats?days=${days}`)
      .then(d => { if (!cancelled) setStats(d); })
      .catch(e => { if (!cancelled) setLoadError(e.message || '載入失敗'); });
    return () => { cancelled = true; };
  }, [days]);

  // 每日趨勢:補齊近 days 天中無登入的日期(count=0),依日期排序
  const dayBars = useMemo(() => {
    if (!stats) return [];
    const map = {};
    (stats.byDay || []).forEach(d => { map[d.date] = d.count; });
    const list = [];
    for (let i = days - 1; i >= 0; i--) {
      const dt = new Date(); dt.setDate(dt.getDate() - i);
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      list.push({ date: key, label: `${dt.getMonth() + 1}/${dt.getDate()}`, count: map[key] || 0 });
    }
    return list;
  }, [stats, days]);
  const maxDay = Math.max(1, ...dayBars.map(d => d.count));
  const maxUser = stats ? Math.max(1, ...(stats.byUser || []).map(u => Number(u.count))) : 1;

  const kpi = (label, value, sub) => (
    <div className="bg-white ctl-raised border border-slate-300 rounded-xl p-3 text-center shadow-sm">
      <div className="text-[11px] font-bold text-slate-500">{label}</div>
      <div className="text-2xl font-black text-slate-800 mt-0.5">{value}</div>
      {sub && <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );

  return (
    <div {...focus} className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm modal-scrim z-[105] flex justify-end">
      <div className="w-full max-w-md bg-white h-full shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 text-white flex justify-between items-center" style={{ backgroundColor: '#0F766E' }}>
          <div>
            <h3 className="font-bold text-lg" style={{ color: '#FFFFFF' }}>📈 使用統計</h3>
            <p className="text-xs mt-0.5" style={{ color: '#CCFBF1' }}>登入次數（含重新整理自動登入），評估網頁使用率</p>
          </div>
          <CloseButton onClick={onClose} className="text-white/70 hover:text-white p-1" />
        </div>

        {/* 統計區間切換 */}
        <div className="bg-white px-5 py-2 border-b border-slate-300 flex items-center gap-1.5">
          <span className="text-[11px] font-bold text-slate-500 mr-1">統計區間</span>
          {[7, 30, 90].map(d => (
            <button key={d} onClick={() => setDays(d)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition ${days === d ? 'bg-teal-700 text-white border-teal-800' : 'bg-slate-100 text-slate-600 border-slate-300 hover:bg-slate-200'}`}>
              近 {d} 天
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loadError ? (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm font-bold">❌ 載入失敗：{loadError}</div>
          ) : !stats ? (
            <div className="text-center text-slate-500 py-10">載入中…</div>
          ) : (
            <>
              {/* ① KPI */}
              <div className="grid grid-cols-2 gap-3">
                {kpi('今日登入', stats.today)}
                {kpi('近 7 天', stats.last7)}
                {kpi(`近 ${stats.days} 天`, stats.lastN, `手動 ${stats.manualN}・自動 ${stats.autoN}`)}
                {kpi('活躍使用者', stats.uniqueUsers, `近 ${stats.days} 天有登入的人數`)}
              </div>

              {/* ② 每日趨勢 */}
              <div>
                <div className="text-xs font-black text-slate-500 uppercase tracking-wider mb-2">📅 每日登入次數（近 {stats.days} 天）</div>
                <div className="bg-white ctl-raised border border-slate-300 rounded-xl p-3 shadow-sm">
                  {stats.lastN === 0 ? (
                    <div className="text-center text-slate-500 italic text-xs py-6">此區間尚無登入紀錄</div>
                  ) : (
                    <>
                      <div className="flex items-end gap-px h-24">
                        {dayBars.map(d => (
                          <div key={d.date} className="flex-1 flex flex-col justify-end h-full group relative" title={`${d.date}：${d.count} 次`}>
                            <div className={`w-full rounded-t transition ${d.count > 0 ? 'bg-teal-500 group-hover:bg-teal-600' : 'bg-slate-100'}`}
                              style={{ height: d.count > 0 ? `${Math.max(8, Math.round((d.count / maxDay) * 100))}%` : 2 }}></div>
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-between text-[10px] text-slate-500 mt-1.5 font-medium">
                        <span>{dayBars[0]?.label}</span>
                        <span>單日最高 {maxDay} 次</span>
                        <span>{dayBars[dayBars.length - 1]?.label}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* ③ 使用者排行 */}
              <div>
                <div className="text-xs font-black text-slate-500 uppercase tracking-wider mb-2">👥 各使用者登入次數（近 {stats.days} 天）</div>
                {(stats.byUser || []).length === 0 ? (
                  <div className="bg-slate-100 border border-slate-300 rounded-xl p-4 text-center text-slate-500 text-xs italic">此區間尚無登入紀錄</div>
                ) : (
                  <div className="space-y-2">
                    {stats.byUser.map(u => (
                      <div key={u.user} className="bg-white border border-slate-300 rounded-xl px-3 py-2 shadow-sm">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-800 text-sm">{u.user}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${u.role === 'manager' ? 'bg-violet-100 text-violet-800 border-violet-400' : 'bg-sky-100 text-sky-800 border-sky-400'}`}>
                            {u.role === 'manager' ? '主管' : '成員'}
                          </span>
                          <span className="ml-auto font-black text-teal-700 text-sm">{u.count} 次</span>
                        </div>
                        <div className="mt-1.5 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-teal-500 rounded-full" style={{ width: `${Math.max(4, Math.round((Number(u.count) / maxUser) * 100))}%` }}></div>
                        </div>
                        <div className="text-[10px] text-slate-500 mt-1">最後登入 {u.lastAt}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="text-[11px] text-slate-500 leading-relaxed">
                ※ 每次於登入畫面選擇身分、或重新整理／重開分頁自動還原登入，皆計一次。總累計（含更早期間）：{stats.total} 次。
              </div>
            </>
          )}
        </div>

        <div className="p-4 bg-slate-100 border-t border-slate-300">
          <button onClick={onClose}
            className="w-full py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs rounded-xl transition">
            關閉面板
          </button>
        </div>
      </div>
    </div>
  );
}

// 瀏覽權限規則的條件欄位定義(投影友善:400 級實線邊框+700/800 級文字)
// 同一條規則內有填的欄位「全部符合」才通過(AND);多條規則之間「任一符合」即放行(OR)
const RULE_FIELDS = [
  { key: 'empno',    label: '工號',     ph: '如 00058897',        chip: 'bg-amber-100 text-amber-800 border-amber-400' },
  { key: 'deptName', label: 'DEPTNAME', ph: '如 12A_PTI/ESI/MSD', chip: 'bg-rose-100 text-rose-800 border-rose-400' },
  { key: 'dept1',    label: 'DEPT_1',   ph: '如 12A_PTI',         chip: 'bg-sky-100 text-sky-800 border-sky-400' },
  { key: 'dept2',    label: 'DEPT_2',   ph: '如 ESI',             chip: 'bg-teal-100 text-teal-800 border-teal-400' },
  { key: 'dept3',    label: 'DEPT_3',   ph: '如 MSD',             chip: 'bg-indigo-100 text-indigo-800 border-indigo-400' }
];

// 主管:瀏覽權限卡控面板 — 總開關 + 允許規則(部門/工號白名單,任一符合即放行) + 工號測試
// 資料來源:登入者工號比對 [WEB].[dbo].[notes_person] 名冊的 DEPT_1/2/3;規則存 Gantt DB 的 AccessRules(遷移 11)
function AccessPanel({ currentUser, role, empId, showToast, onClose }) {
  const focus = useModalFocus();   // 開啟時焦點移入、Tab 鎖在視窗內、關閉時還原
  const [enabled, setEnabled] = useState(false);
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [ruleForm, setRuleForm] = useState({ empno: '', deptName: '', dept1: '', dept2: '', dept3: '' });   // 任填 ≥1 欄,填多欄=全部符合才通過(AND)
  const [ruleNote, setRuleNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [testId, setTestId] = useState('');
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);

  const load = async () => {
    setLoading(true); setLoadError(null);
    try {
      const d = await apiGet('/api/access-rules');
      setEnabled(!!d.enabled);
      setRules(d.rules || []);
    } catch (e) { setLoadError(e.message || '載入失敗'); }
    finally { setLoading(false); }
  };
  React.useEffect(() => { load(); }, []);

  // 規則物件 → 「欄位=值 且 …」描述文字(清單顯示與 toast 用)
  const ruleDesc = (r) => RULE_FIELDS.filter(f => r[f.key]).map(f => `${f.label}=${r[f.key]}`).join(' 且 ');

  const addRule = async () => {
    if (saving) return;
    const cond = {};
    RULE_FIELDS.forEach(f => { const v = (ruleForm[f.key] || '').trim(); if (v) cond[f.key] = v; });
    if (Object.keys(cond).length === 0) { showToast('❌ 至少填寫一個條件欄位（工號或部門）'); return; }
    setSaving(true);
    try {
      await apiPost('/api/access-rule', { ...cond, note: ruleNote.trim() || null, actor: currentUser, actorRole: role });
      setRuleForm({ empno: '', deptName: '', dept1: '', dept2: '', dept3: '' });
      setRuleNote('');
      showToast(`✅ 已新增允許規則：${ruleDesc(cond)}`);
      await load();
    } catch (e) { showToast('❌ 新增失敗：' + (e.message || '無法連線資料庫')); }
    finally { setSaving(false); }
  };

  const deleteRule = async (r) => {
    try {
      await apiPost('/api/access-rule/delete', { ruleId: r.id, actor: currentUser, actorRole: role });
      showToast(`🗑️ 已刪除規則：${ruleDesc(r)}`);
      await load();
    } catch (e) { showToast('❌ 刪除失敗：' + (e.message || '無法連線資料庫')); }
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
      await apiPost('/api/settings/access-control', { enabled: !enabled, actor: currentUser, actorRole: role });
      setEnabled(!enabled);
      showToast(!enabled ? '🔒 已開啟瀏覽權限卡控，之後進站的訪客將依規則驗證' : '🔓 已關閉瀏覽權限卡控，所有人皆可瀏覽');
    } catch (e) { showToast('❌ 切換失敗：' + (e.message || '無法連線資料庫')); }
    finally { setToggling(false); }
  };

  const runTest = async () => {
    if (testing) return;
    const id = testId.trim();
    if (!id) { showToast('❌ 請輸入要測試的工號'); return; }
    setTesting(true); setTestResult(null);
    try {
      setTestResult(await apiGet(`/api/access-check?empId=${encodeURIComponent(id)}&preview=true`));
    } catch (e) { showToast('❌ 測試失敗：' + (e.message || '無法連線資料庫')); }
    finally { setTesting(false); }
  };

  return (
    <div {...focus} className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm modal-scrim z-[105] flex justify-end">
      <div className="w-full max-w-md bg-white h-full shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 text-white flex justify-between items-center" style={{ backgroundColor: '#9F1239' }}>
          <div>
            <h3 className="font-bold text-lg" style={{ color: '#FFFFFF' }}>🔐 頁面瀏覽權限</h3>
            <p className="text-xs mt-0.5" style={{ color: '#FECDD3' }}>依人員名冊部門(DEPT_1/2/3)或工號白名單卡控，任一規則符合即可瀏覽</p>
          </div>
          <CloseButton onClick={onClose} className="text-white/70 hover:text-white p-1" />
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loading ? (
            <div className="text-center text-slate-500 py-10">載入中…</div>
          ) : loadError ? (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm font-bold">
              ❌ 載入失敗：{loadError}
              <button onClick={load} className="ml-2 underline">重試</button>
            </div>
          ) : (
            <>
              {/* ① 總開關 */}
              <div className={`rounded-xl border p-4 ${enabled ? 'bg-rose-50 border-rose-300' : 'bg-slate-100 border-slate-300'}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-black text-slate-800">{enabled ? '🔒 卡控啟用中' : '🔓 目前未卡控'}</div>
                    <div className="text-xs text-slate-500 mt-1">{enabled ? '不符合規則的訪客會看到「無權限」畫面' : '所有人皆可瀏覽；設定好規則後再開啟'}</div>
                  </div>
                  <button onClick={toggle} disabled={toggling}
                    className={`px-4 py-2 rounded-lg text-xs font-bold border shadow-sm transition text-white disabled:opacity-60 ${enabled ? 'bg-slate-500 hover:bg-slate-600 border-slate-600' : 'bg-rose-600 hover:bg-rose-700 border-rose-700'}`}>
                    {toggling ? '切換中…' : enabled ? '關閉卡控' : '開啟卡控'}
                  </button>
                </div>
                {enabled && (
                  <div className="mt-2.5 text-[11px] font-bold text-rose-800 bg-rose-100 border border-rose-300 rounded-lg px-2.5 py-1.5">
                    ⚠️ 修改規則立即生效於「下一次進站/重新整理」；已在瀏覽中的使用者不會被中途踢出。
                  </div>
                )}
              </div>

              {/* ② 新增規則(多欄位組合:任填 ≥1 欄;填多欄=全部符合才通過) */}
              <div>
                <div className="text-xs font-black text-slate-500 uppercase tracking-wider mb-2">➕ 新增允許規則</div>
                <div className="bg-white border border-slate-300 rounded-xl p-3.5 space-y-2.5 shadow-sm">
                  <div className="grid grid-cols-2 gap-2">
                    {RULE_FIELDS.map(f => (
                      <label key={f.key} className={f.key === 'deptName' ? 'col-span-1' : ''}>
                        <span className="block text-[10px] font-bold text-slate-500 mb-0.5">{f.label}</span>
                        <input type="text" value={ruleForm[f.key]}
                          onChange={e => setRuleForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter' && !isComposingEvent(e)) addRule(); }}
                          placeholder={f.ph}
                          className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-rose-500" />
                      </label>
                    ))}
                    <label>
                      <span className="block text-[10px] font-bold text-slate-500 mb-0.5">備註（選填）</span>
                      <input type="text" value={ruleNote} onChange={e => setRuleNote(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && !isComposingEvent(e)) addRule(); }}
                        placeholder="如：MSD 全員"
                        className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-rose-500" />
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 text-[11px] text-slate-500 leading-snug">
                      任填一欄以上；<span className="font-bold text-slate-600">同一條規則內填多個欄位＝全部符合才通過（且）</span>，
                      多條規則之間任一符合即放行（或）。只填工號＝白名單直接放行（不查名冊）。
                    </div>
                    <button onClick={addRule} disabled={saving}
                      className="flex-shrink-0 px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 border border-rose-700 shadow-sm disabled:opacity-60">
                      {saving ? '儲存中…' : '新增'}
                    </button>
                  </div>
                </div>
              </div>

              {/* ③ 規則清單 */}
              <div>
                <div className="text-xs font-black text-slate-500 uppercase tracking-wider mb-2">📜 目前允許規則（{rules.length} 條，任一符合即放行）</div>
                {rules.length === 0 ? (
                  <div className="bg-yellow-50 border border-yellow-300 text-yellow-800 rounded-xl p-4 text-xs font-bold">
                    尚未設定任何規則。{enabled ? '⚠️ 卡控啟用中且無規則＝全部擋下！' : '請先新增規則再開啟卡控。'}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {rules.map(r => (
                      <div key={r.id} className="bg-white border border-slate-300 rounded-xl px-3 py-2 shadow-sm">
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1 flex-wrap min-w-0">
                            {RULE_FIELDS.filter(f => r[f.key]).map((f, i) => (
                              <React.Fragment key={f.key}>
                                {i > 0 && <span className="text-[10px] font-black text-slate-500">且</span>}
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold border whitespace-nowrap ${f.chip}`}>
                                  {f.label}＝{r[f.key]}
                                </span>
                              </React.Fragment>
                            ))}
                          </div>
                          <span className="ml-auto flex-shrink-0 text-[10px] text-slate-500" title={`建立者 ${r.createdBy || '-'}`}>{r.createdAt}</span>
                          <button onClick={() => deleteRule(r)}
                            className="flex-shrink-0 p-1 rounded text-red-500 hover:bg-red-50 border border-transparent hover:border-red-200 transition" title="刪除此規則">
                            🗑
                          </button>
                        </div>
                        {r.note && <div className="text-xs text-slate-500 mt-1 truncate" title={r.note}>📝 {r.note}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ④ 工號測試 */}
              <div>
                <div className="text-xs font-black text-slate-500 uppercase tracking-wider mb-2">🧪 以工號測試規則（不受總開關影響）</div>
                <div className="bg-slate-100 border border-slate-300 rounded-xl p-3.5 space-y-2.5">
                  <div className="flex gap-2">
                    <input type="text" value={testId} onChange={e => { setTestId(e.target.value); setTestResult(null); }}
                      onKeyDown={e => { if (e.key === 'Enter' && !isComposingEvent(e)) runTest(); }}
                      placeholder={`輸入工號，如 ${empId || '00058897'}`}
                      className="flex-1 min-w-0 border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm font-mono outline-none focus:border-rose-500" />
                    <button onClick={runTest} disabled={testing}
                      className="flex-shrink-0 px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-slate-700 hover:bg-slate-800 border border-slate-800 shadow-sm disabled:opacity-60">
                      {testing ? '測試中…' : '測試'}
                    </button>
                  </div>
                  {testResult && (
                    <div className={`rounded-lg border p-3 text-xs font-bold ${testResult.allowed ? 'bg-green-50 border-green-300 text-green-800' : 'bg-red-50 border-red-300 text-red-700'}`}>
                      <div className="text-sm">{testResult.allowed ? '✅ 可以瀏覽' : '🚫 會被擋下'}</div>
                      {testResult.person && (
                        <div className="mt-1 font-medium text-slate-600">
                          {testResult.person.name}{testResult.person.ename ? `（${testResult.person.ename}）` : ''}・
                          {testResult.person.deptname || [testResult.person.dept1, testResult.person.dept2, testResult.person.dept3].filter(Boolean).join(' / ') || '無部門資料'}
                        </div>
                      )}
                      {testResult.reason && <div className="mt-1 font-medium">{testResult.reason}</div>}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="p-4 bg-slate-100 border-t border-slate-300">
          <button onClick={onClose}
            className="w-full py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs rounded-xl transition">
            關閉面板
          </button>
        </div>
      </div>
    </div>
  );
}

// 主管:成員管理面板(新增/移除成員;移除為軟刪除 IsActive=0,名下仍有專案時後端會擋下)
function MemberPanel({ users, projects, year, onAdd, onRename, onDelete, onClose }) {
  const focus = useModalFocus();   // 開啟時焦點移入、Tab 鎖在視窗內、關閉時還原
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null);       // {old, value, error} — 行內編輯成員名稱
  const [renaming, setRenaming] = useState(false);

  const submit = async () => {
    const n = name.trim();
    if (!n) { setError('請輸入成員名稱'); return; }
    if (users.includes(n)) { setError(`成員「${n}」已存在`); return; }
    setSaving(true);
    const ok = await onAdd(n);
    setSaving(false);
    if (ok) { setName(''); setError(''); }
  };

  const submitRename = async () => {
    const n = (editing?.value || '').trim();
    if (!n) { setEditing(prev => ({ ...prev, error: '成員名稱不可空白' })); return; }
    if (n === editing.old) { setEditing(null); return; }   // 沒改,直接關閉
    if (users.includes(n)) { setEditing(prev => ({ ...prev, error: `成員「${n}」已存在` })); return; }
    setRenaming(true);
    const ok = await onRename(editing.old, n);
    setRenaming(false);
    if (ok) setEditing(null);
  };

  return (
    <div {...focus} className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm modal-scrim z-[115] flex justify-end">
      <div className="w-full max-w-sm bg-white h-full shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 text-white flex justify-between items-center" style={{ backgroundColor: NAVY }}>
          <div>
            <h3 className="font-bold text-lg">👥 成員管理</h3>
            <p className="text-xs text-blue-200 mt-0.5">新增的成員即可登入回報，並可為其安排專案</p>
          </div>
          <CloseButton onClick={onClose} className="text-white/60 hover:text-white p-1" />
        </div>

        <div className="p-4 border-b border-slate-300 bg-slate-100">
          <label className="text-xs font-bold text-slate-500">新增成員</label>
          <div className="mt-1 flex gap-2">
            {/* onEnterSubmit 內含 isComposing 判斷:原本直接 if(key==='Enter') 會在輸入中文姓名選字時誤送出 */}
            <input value={name} onChange={e => { setName(e.target.value); setError(''); }}
              onKeyDown={onEnterSubmit(submit)}
              placeholder="輸入新成員顯示名稱…" autoFocus
              className={`flex-1 border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 ${error ? 'border-red-400' : 'border-slate-300'}`} />
            <button onClick={submit} disabled={saving}
              className="flex-shrink-0 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-sm transition hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: BRAND_BTN }}>
              {saving ? '新增中…' : '＋ 新增'}
            </button>
          </div>
          {error && <div className="mt-1.5 text-xs text-red-600 font-bold">{error}</div>}
          <p className="mt-2 text-[11px] text-slate-500 leading-relaxed">
            新增後成員會出現在登入畫面與甘特圖，可直接為其新增專案並開始每週打卡回報。
            若輸入曾被移除的同名成員，會自動重新啟用並還原其歷史資料。
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          <div className="text-xs font-bold text-slate-500 mb-1">現有成員（{users.length} 位）</div>
          {users.map(u => {
            const projCount = projects.filter(p => p.owner === u).length;
            const isEditing = editing?.old === u;
            return (
              <div key={u} className="flex items-center bg-white ctl-raised border border-slate-300 rounded-xl p-3 shadow-sm">
                <div className="w-8 h-8 rounded-full text-white flex items-center justify-center text-sm mr-3 flex-shrink-0" style={{ backgroundColor: BRAND_BTN }}>{u[0]}</div>
                {isEditing ? (
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <input value={editing.value} autoFocus
                        onChange={e => setEditing(prev => ({ ...prev, value: e.target.value, error: '' }))}
                        onKeyDown={e => { if (isComposingEvent(e)) return; if (e.key === 'Enter') submitRename(); if (e.key === 'Escape') setEditing(null); }}
                        className={`flex-1 min-w-0 border rounded-lg px-2 py-1 text-sm outline-none focus:border-blue-500 ${editing.error ? 'border-red-400' : 'border-slate-300'}`} />
                      <button onClick={submitRename} disabled={renaming}
                        className="flex-shrink-0 px-2 py-1 rounded-lg text-xs font-bold text-white transition hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: BRAND_BTN }}>
                        {renaming ? '…' : '✓ 儲存'}
                      </button>
                      <button onClick={() => setEditing(null)}
                        className="flex-shrink-0 px-2 py-1 rounded-lg text-xs font-bold text-slate-500 bg-slate-100 hover:bg-slate-200 transition">✕</button>
                    </div>
                    {editing.error
                      ? <div className="mt-1 text-[11px] text-red-600 font-bold">{editing.error}</div>
                      : <div className="mt-1 text-[11px] text-slate-500">改名後其專案與歷史回報自動跟隨新名稱</div>}
                  </div>
                ) : (
                  <>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-sm text-slate-700 truncate">{u}</div>
                      <div className="text-[11px] text-slate-500">{year} 年度專案 {projCount} 項</div>
                    </div>
                    <button onClick={() => setEditing({ old: u, value: u, error: '' })}
                      className="flex-shrink-0 mr-1.5 px-2.5 py-1 rounded-lg text-xs font-bold text-blue-600 bg-blue-50 border border-blue-200 hover:bg-blue-100 transition"
                      title="編輯成員名稱">✎ 編輯</button>
                    <button onClick={() => onDelete(u)}
                      className="flex-shrink-0 px-2.5 py-1 rounded-lg text-xs font-bold text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 transition"
                      title={projCount > 0 ? '名下仍有專案，需先刪除或改派專案才能移除' : '移除成員（軟刪除，歷史回報保留）'}>
                      移除
                    </button>
                  </>
                )}
              </div>
            );
          })}
          {users.length === 0 && <div className="text-center text-slate-500 py-10 text-sm">尚無成員，請於上方新增。</div>}
        </div>
      </div>
    </div>
  );
}

// 近 n 天的日期字串(yyyy-MM-dd,本地時區):快捷鈕用
const daysAgoStr = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const AUDIT_TOP = 300;

function AuditPanel({ onClose }) {
  const focus = useModalFocus();   // 開啟時焦點移入、Tab 鎖在視窗內、關閉時還原
  const [logs, setLogs] = useState(null);   // null=載入中
  const [actors, setActors] = useState([]);
  const [matched, setMatched] = useState(0);      // 符合條件的總筆數(可能大於實際載入的 300 筆)
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  // 伺服器端條件:改變時重新查詢(關鍵字仍是前端即時過濾,見下方說明)
  const [cond, setCond] = useState({ from: '', to: '', actor: '', action: '', entityType: '' });
  const setC = (k, v) => setCond(prev => ({ ...prev, [k]: v }));
  const hasCond = !!(cond.from || cond.to || cond.actor || cond.action || cond.entityType);

  // ⚠ 日期/成員/動作/類型一律走**伺服器端**篩選:本端點只回最近 300 筆,
  //   若在前端過濾,查「上個月某人改了什麼」時最近 300 筆可能全是本週的 → 永遠查不到東西。
  //   關鍵字則留在前端即時過濾(打字不必每個字都打一次 API),語意是「在已篩出的結果裡再找」。
  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const qs = new URLSearchParams({ top: String(AUDIT_TOP) });
    Object.entries(cond).forEach(([k, v]) => { if (v) qs.set(k, v); });
    apiGet('/api/audit-log?' + qs.toString())
      .then(d => {
        if (cancelled) return;                     // 快速連按條件時,舊回應不可覆蓋新結果
        setLogs(d.logs || []);
        setMatched(d.matched ?? (d.logs || []).length);
        if (d.actors) setActors(d.actors);
        setError(null);
      })
      .catch(e => { if (!cancelled) setError(e.message || '無法連線資料庫'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [cond]);

  const shown = useMemo(() => {
    if (!logs) return [];
    const kw = filter.trim().toLowerCase();
    if (!kw) return logs;
    return logs.filter(l =>
      `${l.actor} ${l.empId || ''} ${l.action} ${l.entityType} ${l.entityId || ''} ${l.summary || ''} ${l.newValue || ''} ${l.detail || ''} ${l.at}`.toLowerCase().includes(kw));
  }, [logs, filter]);

  const selectCls = "border border-slate-300 rounded-lg px-2 py-1 text-[11px] bg-white outline-none focus:border-blue-500 min-w-0";

  return (
    <div {...focus} className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm modal-scrim z-[115] flex justify-end">
      <div className="w-full max-w-lg bg-white h-full shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 text-white flex justify-between items-center" style={{ backgroundColor: NAVY }}>
          <div>
            <h3 className="font-bold text-lg">📜 異動紀錄</h3>
            <p className="text-xs text-blue-200 mt-0.5">操作稽核（誰、何時、做了什麼）</p>
          </div>
          <CloseButton onClick={onClose} className="text-white/60 hover:text-white p-1" />
        </div>
        <div className="p-3 border-b border-slate-300 bg-slate-100 space-y-2">
          <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="在篩選結果中搜尋：人員 / 動作 / 專案 / 內容…"
            onKeyDown={e => { if (e.key === 'Escape' && filter) { e.stopPropagation(); setFilter(''); } }}
            className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-xs outline-none focus:border-blue-500" />

          {/* 日期區間:主管最常問的是「上週誰改了什麼」,所以先給快捷鈕,手動選日期是次要路徑 */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-bold text-slate-600 flex-shrink-0">期間</span>
            <input type="date" value={cond.from} max={cond.to || undefined} onChange={e => setC('from', e.target.value)}
              aria-label="起始日期" className={selectCls} />
            <span className="text-[11px] text-slate-500">–</span>
            <input type="date" value={cond.to} min={cond.from || undefined} onChange={e => setC('to', e.target.value)}
              aria-label="結束日期" className={selectCls} />
            {[['近 7 天', 6], ['近 30 天', 29]].map(([label, d]) => (
              <button key={label} onClick={() => setCond(prev => ({ ...prev, from: daysAgoStr(d), to: '' }))}
                className="flex-shrink-0 px-2 py-1 rounded-lg border border-slate-400 bg-white ctl-raised text-[11px] font-bold text-slate-600 hover:border-blue-500 hover:bg-blue-50 transition">
                {label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <select value={cond.actor} onChange={e => setC('actor', e.target.value)} aria-label="操作人員" className={selectCls}>
              <option value="">全部人員</option>
              {actors.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            <select value={cond.action} onChange={e => setC('action', e.target.value)} aria-label="動作類型" className={selectCls}>
              <option value="">全部動作</option>
              {Object.entries(AUDIT_ACTION_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
            </select>
            <select value={cond.entityType} onChange={e => setC('entityType', e.target.value)} aria-label="對象類型" className={selectCls}>
              <option value="">全部對象</option>
              {Object.entries(AUDIT_ENTITY_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
            {hasCond && (
              <button onClick={() => setCond({ from: '', to: '', actor: '', action: '', entityType: '' })}
                className="flex-shrink-0 px-2 py-1 rounded-lg border border-slate-400 bg-white ctl-raised text-[11px] font-bold text-blue-700 hover:border-blue-500 hover:bg-blue-50 transition">
                清除條件
              </button>
            )}
          </div>

          {/* 只回最近 300 筆,符合條件卻沒載進來的要講清楚,否則使用者會以為「就這些」而做出錯誤結論 */}
          <div className="text-[11px] text-slate-600" aria-live="polite">
            {loading ? '查詢中…'
              : error ? ''
              : matched > AUDIT_TOP
                ? <span>符合條件 <b className="text-amber-800">{matched}</b> 筆，僅顯示最近 {AUDIT_TOP} 筆{filter && <>（關鍵字再篩出 {shown.length} 筆）</>}，請縮小期間範圍</span>
                : <span>符合條件 <b>{matched}</b> 筆{filter && <>，關鍵字再篩出 {shown.length} 筆</>}</span>}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5 text-xs">
          {error ? (
            <div className="text-red-600 bg-red-50 border border-red-100 rounded-lg p-3">{error}</div>
          ) : logs === null ? (
            <div className="text-center text-slate-500 py-10">載入中…</div>
          ) : shown.length === 0 ? (
            // 空結果要說清楚是「條件太窄」還是「真的沒紀錄」,並直接給收回條件的出口
            <div className="text-center py-10 space-y-2">
              <div className="text-slate-500">{hasCond || filter ? '沒有符合目前篩選條件的紀錄' : '尚無異動紀錄'}</div>
              {(hasCond || filter) && (
                <button onClick={() => { setCond({ from: '', to: '', actor: '', action: '', entityType: '' }); setFilter(''); }}
                  className="px-3 py-1 rounded-lg border border-slate-400 bg-white ctl-raised text-[11px] font-bold text-blue-700 hover:border-blue-500 hover:bg-blue-50 transition">
                  清除全部條件
                </button>
              )}
            </div>
          ) : shown.map(l => {
            const meta = AUDIT_ACTION_META[l.action] || { label: l.action, cls: 'bg-slate-100 text-slate-600' };
            return (
              // title 保留技術識別碼(如 t101-1@2026W9),畫面上只顯示後端翻譯好的白話摘要(summary)
              <div key={l.id} className="border border-slate-300 rounded-lg p-2.5 hover:bg-slate-50" title={`${l.entityType}${l.entityId ? ' ' + l.entityId : ''}`}>
                <div className="flex items-center gap-2">
                  <span className={`flex-shrink-0 px-1.5 py-0.5 rounded font-bold ${meta.cls}`}>{meta.label}</span>
                  <span className="font-bold text-slate-700">{AUDIT_ENTITY_LABELS[l.entityType] || l.entityType}</span>
                  <span className="flex-shrink-0 text-slate-500 font-medium ml-1">
                    {l.actor}{l.role === 'manager' ? '（主管）' : ''}
                    {l.empId && <span className="ml-1 px-1 py-px rounded bg-slate-100 text-slate-500 font-mono text-[10px]" title="操作者 Windows 工號">{l.empId}</span>}
                  </span>
                  <span className="ml-auto flex-shrink-0 text-slate-500">{l.at}</span>
                </div>
                <div className="mt-1 text-slate-600 break-all leading-relaxed" style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {l.summary || l.newValue || l.detail || ''}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
