const {
  useState,
  useMemo,
  useRef,
  useCallback
} = React;

// --- 1. 系統設定與時間軸定義 ---
const WEEKS_TOTAL = 52; // 預設值;實際以選定年度 ScheduleWeeks 的筆數為準(52 或 53)
const DEFAULT_SCHEDULE_YEAR = new Date().getFullYear(); // 預設載入今年;實際可用年度由 bootstrap 的 years 決定

// 依今天日期計算 ISO 週數(週一為一週起始);非選定年度時夾在排程範圍內
const getTodayWeek = (scheduleYear = DEFAULT_SCHEDULE_YEAR, weeksTotal = WEEKS_TOTAL) => {
  const now = new Date();
  if (now.getFullYear() < scheduleYear) return 1;
  if (now.getFullYear() > scheduleYear) return weeksTotal;
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // 週一=0
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // 本週的週四
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const fDayNum = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - fDayNum + 3);
  const week = 1 + Math.round((d - firstThu) / (7 * 24 * 3600 * 1000));
  return Math.min(weeksTotal, Math.max(1, week));
};
const DEFAULT_CURRENT_WEEK = getTodayWeek();
const NAVY = '#001F5B';
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
const PROJECT_TYPES = {
  'a': {
    label: '一級專案/KPI',
    chip: 'bg-pink-100 text-pink-800 border-pink-400',
    dot: 'bg-pink-500'
  },
  'b': {
    label: '重大貢獻及亮點',
    chip: 'bg-yellow-100 text-yellow-800 border-yellow-500',
    dot: 'bg-yellow-500'
  },
  'c': {
    label: '日常管理',
    chip: 'bg-teal-100 text-teal-800 border-teal-400',
    dot: 'bg-teal-500'
  },
  'd': {
    label: '其他加分項',
    chip: 'bg-orange-100 text-orange-800 border-orange-400',
    dot: 'bg-orange-500'
  },
  'e': {
    label: '主管交辦',
    chip: 'bg-purple-100 text-purple-800 border-purple-400',
    dot: 'bg-purple-500'
  }
};

// 狀態色加深(範本 B 高對比):白字在色塊上達 WCAG AA,年長使用者更易辨識
const STATUS_META = {
  executed: {
    label: '有執行',
    icon: '✅',
    bar: 'bg-green-700 border-green-800 text-white',
    tag: 'bg-green-100 text-green-800',
    dot: 'bg-green-700'
  },
  monitor: {
    label: 'Monitor',
    icon: '👁️',
    bar: 'bg-sky-700 border-sky-800 text-white',
    tag: 'bg-sky-100 text-sky-800',
    dot: 'bg-sky-700'
  },
  not_executed: {
    label: '未執行',
    icon: '⏸️',
    bar: 'bg-slate-500 border-slate-600 text-white',
    tag: 'bg-slate-200 text-slate-700',
    dot: 'bg-slate-500'
  }
};

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
async function apiGet(path) {
  const res = await fetch(API_BASE + path, {
    headers: {
      'Accept': 'application/json'
    }
  });
  if (!res.ok) throw new Error((await readApiError(res)) || 'HTTP ' + res.status);
  return res.json();
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

// 彈窗「未儲存內容」旗標:表單型視窗(打卡/非專案/下週預計/產出/專案/區間)輸入時設 true、
// 視窗卸載時自動清除;ESC 關窗前檢查,避免打到一半的內容被默默丟棄
let MODAL_DIRTY = false;
const markModalDirty = () => {
  MODAL_DIRTY = true;
};
// 表單型視窗掛載時呼叫:卸載(不論儲存或取消)自動重置旗標
const useModalDirtyReset = () => {
  React.useEffect(() => () => {
    MODAL_DIRTY = false;
  }, []);
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
  toggleStar
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
  const renderSortHeader = (label, key, widthClass, extraClass = "") => {
    const isSorted = sortConfig.key === key;
    const dirIcon = !isSorted ? '↕' : sortConfig.direction === 'asc' ? '▲' : '▼';
    return /*#__PURE__*/React.createElement("th", {
      onClick: () => handleSortHeader(key),
      className: `px-3 py-2 cursor-pointer select-none transition hover:bg-slate-200 whitespace-nowrap ${isSorted ? 'bg-blue-100/80 text-blue-900 border-b-2 border-blue-600' : 'text-slate-700'} ${widthClass} ${extraClass}`,
      title: `點擊依「${label}」${!isSorted ? '排序' : sortConfig.direction === 'asc' ? '改為降冪排序' : '改為升冪排序'}`
    }, /*#__PURE__*/React.createElement("div", {
      className: "flex items-center justify-between gap-1"
    }, /*#__PURE__*/React.createElement("span", {
      className: "whitespace-nowrap"
    }, label), /*#__PURE__*/React.createElement("span", {
      className: `text-[11px] px-1 rounded flex-shrink-0 ${isSorted ? 'bg-blue-600 text-white font-black' : 'text-slate-400 font-normal'}`
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
    disabled: exporting,
    className: `flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold transition border shadow-sm text-white disabled:opacity-70 ${exportFailed ? 'bg-red-600 hover:bg-red-500 border-red-700' : 'bg-green-600 hover:bg-green-500 border-green-700'}`,
    title: `下載目前顯示的清單（含套用中的篩選與排序，共 ${displayedProjects.length} 案）為 Excel，供離線瀏覽專案項目、具體產出與 MP Saving`
  }, exporting ? '⏳ 產生中…' : exportFailed ? '❌ 匯出失敗，點擊重試' : `⬇️ 匯出 Excel（${displayedProjects.length} 案）`)), /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-2 md:grid-cols-5 gap-4"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setFilterMode('all'),
    className: `p-2.5 rounded-xl border text-left transition flex items-center gap-2.5 ${filterMode === 'all' ? 'bg-[#001F5B] text-white border-[#001F5B] shadow-md ring-2 ring-offset-2 ring-[#001F5B]/30' : 'bg-white text-slate-800 border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`
  }, /*#__PURE__*/React.createElement("div", {
    className: `w-9 h-9 rounded-full flex items-center justify-center text-base font-bold ${filterMode === 'all' ? 'bg-white/10 text-white' : 'bg-slate-100 text-slate-600'}`
  }, "\uD83D\uDCC1"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: `text-xs font-bold ${filterMode === 'all' ? 'text-blue-200' : 'text-slate-500'}`
  }, "\u5168\u90E8\u5C08\u6848"), /*#__PURE__*/React.createElement("div", {
    className: "text-lg font-black"
  }, projects.length, " ", /*#__PURE__*/React.createElement("span", {
    className: `text-xs font-medium ${filterMode === 'all' ? 'text-blue-200' : 'text-slate-500'}`
  }, "\u6848")))), /*#__PURE__*/React.createElement("button", {
    onClick: () => setFilterMode('starred'),
    className: `p-2.5 rounded-xl border text-left transition flex items-center gap-2.5 ${filterMode === 'starred' ? 'bg-amber-500 text-white border-amber-500 shadow-md ring-2 ring-offset-2 ring-amber-500/30' : 'bg-white text-slate-800 border-slate-200 hover:border-amber-300 hover:bg-amber-50/40'}`
  }, /*#__PURE__*/React.createElement("div", {
    className: `w-9 h-9 rounded-full flex items-center justify-center text-base font-bold ${filterMode === 'starred' ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-600'}`
  }, "\u2B50"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: `text-xs font-bold ${filterMode === 'starred' ? 'text-amber-100' : 'text-slate-500'}`
  }, "\u91CD\u9EDE\u95DC\u6CE8\u9805\u76EE"), /*#__PURE__*/React.createElement("div", {
    className: "text-lg font-black"
  }, projects.filter(p => starredIds.has(p.id)).length, " ", /*#__PURE__*/React.createElement("span", {
    className: `text-xs font-medium ${filterMode === 'starred' ? 'text-amber-100' : 'text-slate-500'}`
  }, "\u6848")))), /*#__PURE__*/React.createElement("button", {
    onClick: () => setFilterMode('hasMp'),
    className: `p-2.5 rounded-xl border text-left transition flex items-center gap-2.5 ${filterMode === 'hasMp' ? 'bg-emerald-600 text-white border-emerald-600 shadow-md ring-2 ring-offset-2 ring-emerald-600/30' : 'bg-white text-slate-800 border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/40'}`
  }, /*#__PURE__*/React.createElement("div", {
    className: `w-9 h-9 rounded-full flex items-center justify-center text-base font-bold ${filterMode === 'hasMp' ? 'bg-white/10 text-white' : 'bg-emerald-100 text-emerald-600'}`
  }, "\uD83D\uDCA1"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: `text-xs font-bold ${filterMode === 'hasMp' ? 'text-emerald-100' : 'text-slate-500'}`
  }, "\u5177\u5099 MP Saving"), /*#__PURE__*/React.createElement("div", {
    className: "text-lg font-black"
  }, projects.filter(p => p.mpSaving).length, " ", /*#__PURE__*/React.createElement("span", {
    className: `text-xs font-medium ${filterMode === 'hasMp' ? 'text-emerald-100' : 'text-slate-500'}`
  }, "\u6848")))), /*#__PURE__*/React.createElement("button", {
    onClick: () => setFilterMode('hasDeliverable'),
    className: `p-2.5 rounded-xl border text-left transition flex items-center gap-2.5 ${filterMode === 'hasDeliverable' ? 'bg-amber-600 text-white border-amber-600 shadow-md ring-2 ring-offset-2 ring-amber-600/30' : 'bg-white text-slate-800 border-slate-200 hover:border-amber-300 hover:bg-amber-50/40'}`
  }, /*#__PURE__*/React.createElement("div", {
    className: `w-9 h-9 rounded-full flex items-center justify-center text-base font-bold ${filterMode === 'hasDeliverable' ? 'bg-white/10 text-white' : 'bg-amber-100 text-amber-600'}`
  }, "\uD83C\uDFAF"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: `text-xs font-bold ${filterMode === 'hasDeliverable' ? 'text-amber-100' : 'text-slate-500'}`
  }, "\u6709\u5177\u9AD4\u7522\u51FA\u6210\u679C"), /*#__PURE__*/React.createElement("div", {
    className: "text-lg font-black"
  }, projects.filter(p => p.deliverable).length, " ", /*#__PURE__*/React.createElement("span", {
    className: `text-xs font-medium ${filterMode === 'hasDeliverable' ? 'text-amber-100' : 'text-slate-500'}`
  }, "/ ", projects.length, " \u6848")))), /*#__PURE__*/React.createElement("button", {
    onClick: () => setFilterMode('missing'),
    className: `p-2.5 rounded-xl border text-left transition flex items-center gap-2.5 ${filterMode === 'missing' ? 'bg-red-600 text-white border-red-600 shadow-md ring-2 ring-offset-2 ring-red-600/30' : 'bg-white text-slate-800 border-slate-200 hover:border-red-300 hover:bg-red-50/40'}`
  }, /*#__PURE__*/React.createElement("div", {
    className: `w-9 h-9 rounded-full flex items-center justify-center text-base font-bold ${filterMode === 'missing' ? 'bg-white/10 text-white' : 'bg-red-100 text-red-600'}`
  }, "\u26A0\uFE0F"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: `text-xs font-bold ${filterMode === 'missing' ? 'text-red-100' : 'text-slate-500'}`
  }, "\u5F85\u88DC\u5145\u7522\u51FA\u6548\u76CA"), /*#__PURE__*/React.createElement("div", {
    className: "text-lg font-black"
  }, projects.filter(p => !p.deliverable && !p.mpSaving).length, " ", /*#__PURE__*/React.createElement("span", {
    className: `text-xs font-medium ${filterMode === 'missing' ? 'text-red-100' : 'text-slate-500'}`
  }, "\u6848")))))), sortConfig.key && /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between bg-blue-50 border border-blue-200 px-4 py-2 rounded-xl text-xs font-bold text-blue-900 shadow-sm"
  }, /*#__PURE__*/React.createElement("span", null, "\u76EE\u524D\u5DF2\u5957\u7528\u6B04\u4F4D\u6392\u5E8F (", sortConfig.direction === 'asc' ? '升冪 ▲' : '降冪 ▼', ")"), /*#__PURE__*/React.createElement("button", {
    onClick: () => setSortConfig({
      key: null,
      direction: 'asc'
    }),
    className: "px-3 py-1 rounded-lg bg-white hover:bg-blue-100 text-blue-700 border border-blue-300 font-bold transition shadow-sm"
  }, "\u6E05\u9664\u6392\u5E8F")), /*#__PURE__*/React.createElement("div", {
    className: "bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
  }, /*#__PURE__*/React.createElement("table", {
    className: "w-full text-left border-collapse table-fixed"
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
    className: "bg-slate-100 text-xs font-bold border-b border-slate-200 h-9"
  }, /*#__PURE__*/React.createElement("th", {
    className: "px-2 w-10 text-center text-slate-500 whitespace-nowrap"
  }, "No"), renderSortHeader("分類", "category", "w-20"), renderSortHeader("類型", "type", "w-14 text-center"), renderSortHeader("專案名稱", "name", "w-[420px]"), renderSortHeader("負責人", "owner", "w-24"), renderSortHeader("預計交付具體產出成果", "deliverable", "w-auto"), renderSortHeader("MP Saving", "mpSaving", "w-36"))), /*#__PURE__*/React.createElement("tbody", {
    className: "divide-y divide-slate-200 text-[13px]"
  }, displayedProjects.map((proj, idx) => {
    const cleanDeliverable = proj.deliverable ? String(proj.deliverable).replace(/[\r\n]+/g, ' ') : '';
    return /*#__PURE__*/React.createElement("tr", {
      key: proj.id,
      className: "hover:bg-blue-50/40 transition"
    }, /*#__PURE__*/React.createElement("td", {
      className: "px-3 py-1 text-center text-slate-400 font-medium whitespace-nowrap truncate"
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
    }, role === 'manager' ? /*#__PURE__*/React.createElement("button", {
      onClick: e => toggleStar && toggleStar(proj.id, e),
      className: `flex-shrink-0 mr-1.5 text-base transition transform hover:scale-125 ${starredIds.has(proj.id) ? 'text-amber-500' : 'text-slate-300 hover:text-amber-400'}`,
      title: starredIds.has(proj.id) ? '取消重點關注標記' : '標記為重點關注項目'
    }, starredIds.has(proj.id) ? '★' : '☆') : starredIds.has(proj.id) ? /*#__PURE__*/React.createElement("span", {
      className: "flex-shrink-0 mr-1.5 text-base text-amber-500",
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
      className: "text-slate-300 font-light"
    }, "\u2014")), /*#__PURE__*/React.createElement("td", {
      className: "px-3 py-1 whitespace-nowrap"
    }, proj.mpSaving ? /*#__PURE__*/React.createElement("span", {
      className: "inline-flex items-center px-2 py-0.5 rounded text-[13px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 whitespace-nowrap"
    }, proj.mpSaving) : /*#__PURE__*/React.createElement("span", {
      className: "text-slate-300 font-light"
    }, "\u2014")));
  }), displayedProjects.length === 0 && /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
    colSpan: 7,
    className: "py-8 text-center text-slate-400 font-medium"
  }, "\u7B26\u5408\u7BE9\u9078\u689D\u4EF6\u7684\u5C08\u6848\u9805\u76EE\u70BA\u7A7A"))))));
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

  // 載入時偵測一次 Windows 工號(非網域環境取不到 → null),接著向後端驗證瀏覽權限
  React.useEffect(() => {
    let cancelled = false;
    detectEmpId().then(async id => {
      if (cancelled) return;
      setEmpId(id);
      try {
        const r = await apiGet(`/api/access-check?empId=${encodeURIComponent(id || '')}`);
        if (!cancelled) setAccessCheck(r);
      } catch {
        // 後端不可達時不在此擋(bootstrap 會另行顯示連線錯誤);卡控啟用時的失敗判斷在伺服器端(fail-closed)
        if (!cancelled) setAccessCheck({
          enabled: false,
          allowed: true
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 年度切換:可用年度與週→月對照皆來自 DB 的 ScheduleWeeks(開新年度只需 EXEC usp_EnsureScheduleYear)
  const [scheduleYear, setScheduleYear] = useState(DEFAULT_SCHEDULE_YEAR);
  const [years, setYears] = useState([]);
  const [months, setMonths] = useState(MONTHS);
  const weeksTotal = useMemo(() => months.reduce((s, m) => s + m.weeks, 0), [months]);

  // 分頁標題帶目前週次(多分頁好辨識);非今年年度再帶年份;未登入維持原名
  React.useEffect(() => {
    if (!currentUser) {
      document.title = 'MSD 專案追蹤總表';
      return;
    }
    const prefix = scheduleYear !== new Date().getFullYear() ? `${scheduleYear} ` : '';
    document.title = `${prefix}W${String(currentWeek).padStart(2, '0')}｜MSD 專案追蹤總表`;
  }, [currentUser, currentWeek, scheduleYear]);

  // UI 狀態(範本 B:預設寬鬆模式,字級較大對年長者友善)
  const [isCompact, setIsCompact] = useState(() => readPrefs().compact === true); // 緊湊模式偏好:重整後沿用
  const [isOverview, setIsOverview] = useState(false); // 年度總覽:52 週自動縮放進一個畫面寬,無水平捲軸(唯讀瀏覽視角)
  const [isResults, setIsResults] = useState(false); // 成果清單:集中檢閱所有專案具體成果項目與 MP 節省統計
  const [collapsedOwners, setCollapsedOwners] = useState(new Set());
  const [searchText, setSearchText] = useState('');
  const [typeFilter, setTypeFilter] = useState(new Set()); // 空 = 全部
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [onlyMine, setOnlyMine] = useState(false);
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
      alert('標記失敗：' + (err.message || '無法連線資料庫'));
    }
  }, [currentUser, role, starredIds]);
  const [tooltip, setTooltip] = useState(null); // {x, y, proj, task, weekLog, history}
  const ganttRef = useRef(null);

  // 紀錄打卡、非專案工作與下週預計
  const [taskLogs, setTaskLogs] = useState({});
  const [extraNotes, setExtraNotes] = useState({});
  const [weeklyPlans, setWeeklyPlans] = useState({}); // weeklyPlans[user][week] = 下週預計執行工作(填寫於該週)
  const [weeklyComments, setWeeklyComments] = useState({}); // weeklyComments[user][week] = 主管週報回覆(選填,全員可見)
  // 各表的最後編輯資訊 meta[user][week] = { by, byRole, at }(與內容字典並列,避免改動既有字串結構)
  const [extraNoteMeta, setExtraNoteMeta] = useState({});
  const [weeklyPlanMeta, setWeeklyPlanMeta] = useState({});
  const [weeklyCommentMeta, setWeeklyCommentMeta] = useState({});
  const [allowRetroCheckin, setAllowRetroCheckin] = useState(false); // 主管全域開關：允許成員回報/調正歷史進度

  // 重新抓取資料但不顯示整頁 Loading (供編輯後靜默刷新)
  const refreshData = useCallback(async () => {
    const data = await apiGet(`/api/bootstrap?year=${scheduleYear}`);
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
  React.useEffect(() => {
    loadBootstrap();
  }, [loadBootstrap]);
  const [selectedTaskInfo, setSelectedTaskInfo] = useState(null);
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
  const [showDeadlinePanel, setShowDeadlinePanel] = useState(false); // 即將到期清單面板(頂部 ⏰ 晶片點開)

  const weekW = isCompact ? 22 : 32;
  const todayWeek = getTodayWeek(scheduleYear, weeksTotal); // 本週(相對於選定年度)
  const isViewingPast = currentWeek !== todayWeek; // 是否在檢視非本週

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
    setOnlyMine(selectedRole === 'member');
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
  const handleLogout = () => {
    try {
      localStorage.removeItem('gantt_login');
    } catch (e) {}
    setCurrentUser(null);
    setRole(null);
    setIsOverview(false);
    setIsResults(false);
    setCollapsedOwners(new Set());
    setOnlyMine(false);
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
  const scrollToWeek = useCallback(wk => {
    const el = ganttRef.current;
    if (!el) return;
    const LEFT_W = 490;
    const target = LEFT_W + (wk - 1) * weekW - (el.clientWidth - LEFT_W) / 2;
    smoothScrollLeftTo(el, target);
  }, [weekW]);
  const goToCurrentWeek = () => {
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

  // 本地時間戳(yyyy-MM-dd HH:mm),與 bootstrap 回傳的 updatedAt 格式一致(樂觀更新用)
  const nowStamp = () => {
    const d = new Date(),
      p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const handleSaveLog = async (taskId, status, note) => {
    try {
      await apiPost('/api/weekly-log', {
        taskCode: taskId,
        year: scheduleYear,
        week: currentWeek,
        status,
        note,
        actor: currentUser,
        actorRole: role
      });
      setTaskLogs(prev => ({
        ...prev,
        [taskId]: {
          ...prev[taskId],
          [currentWeek]: {
            ...(prev[taskId]?.[currentWeek] || {}),
            isExecuting: status !== 'not_executed',
            status,
            note,
            reporter: currentUser,
            reporterRole: role,
            updatedAt: nowStamp()
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
  const handleSaveExtraNote = async note => {
    const target = noteTargetUser || currentUser; // 主管可代成員修正(noteTargetUser 由週次編輯面板設定)
    try {
      await apiPost('/api/extra-note', {
        userName: target,
        year: scheduleYear,
        week: currentWeek,
        note,
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
      setExtraNoteMeta(prev => ({
        ...prev,
        [target]: {
          ...prev[target],
          [currentWeek]: {
            by: currentUser,
            byRole: role,
            at: nowStamp()
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
  const handleSaveWeeklyPlan = async note => {
    const target = noteTargetUser || currentUser; // 主管可代成員修正(noteTargetUser 由週次編輯面板設定)
    try {
      await apiPost('/api/weekly-plan', {
        userName: target,
        year: scheduleYear,
        week: currentWeek,
        note,
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
            at: nowStamp()
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
  const handleUpdateScore = async (taskId, score) => {
    try {
      await apiPost('/api/weekly-log/score', {
        taskCode: taskId,
        year: scheduleYear,
        week: currentWeek,
        score,
        actor: currentUser,
        actorRole: role
      });
      setTaskLogs(prev => {
        const log = prev[taskId]?.[currentWeek];
        if (!log) return prev;
        return {
          ...prev,
          [taskId]: {
            ...prev[taskId],
            [currentWeek]: {
              ...log,
              score
            }
          }
        };
      });
      setSelectedTaskInfo(prev => prev?.weekLog ? {
        ...prev,
        weekLog: {
          ...prev.weekLog,
          score
        }
      } : prev);
      showToast(`✅ 分數已調整為 ${score} 分`);
    } catch (e) {
      showToast('❌ 調整失敗：' + (e.message || '無法連線資料庫'));
    }
  };
  const handleUpdateTaskDetails = async (projId, taskId, newName, newStart, newEnd) => {
    try {
      await apiPost('/api/task-schedule', {
        taskCode: taskId,
        name: newName,
        start: parseInt(newStart),
        end: parseInt(newEnd),
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
            end: parseInt(newEnd)
          } : t)
        };
      }));
      setSelectedTaskInfo(null);
      showToast('✅ 排程已更新');
    } catch (e) {
      showToast('❌ 更新失敗：' + (e.message || '無法連線資料庫'));
    }
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

  // 多人共用時每 60 秒靜默刷新,讓其他人的變更自動出現(拖曳中暫停以免干擾;失敗靜默忽略,下輪再試)
  React.useEffect(() => {
    if (!currentUser || dragState) return;
    const timer = setInterval(() => {
      refreshData().catch(() => {});
    }, 60000);
    return () => clearInterval(timer);
  }, [currentUser, dragState, refreshData]);

  // --- 全域鍵盤導航（方向鍵平移甘特圖、Home/H 回本週、ESC 關閉最上層彈窗） ---
  React.useEffect(() => {
    if (!currentUser) return;
    const handler = e => {
      // 中文組字中略過
      if (e.isComposing) return;
      // 焦點在表單元素時略過（搜尋框、輸入框等）
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

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
          setShowWeeklyReport(false);
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
        if (showMemberPanel) {
          setShowMemberPanel(false);
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

      // 以下導航快捷鍵：任何 Modal/Panel 開啟時不觸發
      const isAnyModalOpen = !!(confirmInfo || commentTarget || selectedTaskInfo || deliverableProj || editingProject || addingInterval || showExtraNoteModal || showWeeklyPlanModal || showWeeklyReport || showPendingPanel || showRetroPanel || showWeekEditPanel || showAuditPanel || showMemberPanel || showAccessPanel || showUsagePanel || showAdminMenu || showDeadlinePanel);
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
  }, [currentUser, weekW, isOverview, isResults, confirmInfo, commentTarget, selectedTaskInfo, deliverableProj, editingProject, addingInterval, showExtraNoteModal, showWeeklyPlanModal, showWeeklyReport, showPendingPanel, showRetroPanel, showWeekEditPanel, showAuditPanel, showMemberPanel, showAccessPanel, showUsagePanel, showAdminMenu, showDeadlinePanel, goToCurrentWeek]);
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
  const handleAddInterval = async (proj, taskName, start, end) => {
    try {
      await apiPost('/api/task', {
        projectId: proj.id,
        taskName,
        start: parseInt(start),
        end: parseInt(end),
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

  // --- 篩選 ---
  const filteredProjects = useMemo(() => {
    const kw = searchText.trim().toLowerCase();
    return projects.filter(p => {
      if (!isResults && onlyMine && role === 'member' && p.owner !== currentUser) return false;
      if (!onlyMine && ownerFilter !== 'all' && p.owner !== ownerFilter) return false;
      if (typeFilter.size > 0 && !typeFilter.has(p.type)) return false;
      if (kw) {
        const hay = `${p.name} ${p.category} ${p.owner} ${p.tasks.map(t => t.name).join(' ')}`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
  }, [projects, searchText, typeFilter, ownerFilter, onlyMine, role, currentUser, isResults]);

  // 主管未啟用搜尋/類型篩選時，沒有專案的成員(如剛加入的新同仁)也要顯示群組列,才能為其新增專案
  const groupedProjects = useMemo(() => users.map(user => ({
    owner: user,
    projects: filteredProjects.filter(p => p.owner === user)
  })).filter(g => g.projects.length > 0 || role === 'manager' && !isFilteringRows && (ownerFilter === 'all' || ownerFilter === g.owner)), [filteredProjects, users, role, isFilteringRows, ownerFilter]);

  // 排程到期提醒:任務進行中(以「實際本週」計)且 剩餘 ≤2 週 或 時程已過 ≥70%
  const isTaskDeadlineSoon = useCallback(task => {
    if (task.start > todayWeek || task.end < todayWeek) return false;
    const span = task.end - task.start + 1;
    const remain = task.end - todayWeek + 1; // 含本週
    const elapsed = (todayWeek - task.start + 1) / span; // 已過比例
    return remain <= 2 || elapsed >= 0.7;
  }, [todayWeek]);

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

  // --- 本週統計 ---
  const weekStats = useMemo(() => {
    let active = 0,
      reported = 0,
      executed = 0,
      monitor = 0,
      notExec = 0;
    projects.forEach(p => p.tasks.forEach(t => {
      if (t.start <= currentWeek && t.end >= currentWeek) {
        active++;
        const log = taskLogs[t.id]?.[currentWeek];
        if (log) {
          reported++;
          if (log.status === 'not_executed') notExec++;else if (log.status === 'monitor') monitor++;else executed++;
        }
      }
    }));
    return {
      active,
      reported,
      executed,
      monitor,
      notExec,
      pending: active - reported
    };
  }, [projects, taskLogs, currentWeek]);
  const myPendingTasks = useMemo(() => {
    if (role !== 'member') return [];
    const list = [];
    projects.filter(p => p.owner === currentUser).forEach(p => p.tasks.forEach(t => {
      if (t.start <= todayWeek && t.end >= todayWeek && !taskLogs[t.id]?.[todayWeek]) {
        list.push({
          proj: p,
          task: t
        });
      }
    }));
    return list;
  }, [projects, taskLogs, todayWeek, role, currentUser]);
  const myCompletedTasks = useMemo(() => {
    if (role !== 'member') return [];
    const list = [];
    projects.filter(p => p.owner === currentUser).forEach(p => p.tasks.forEach(t => {
      if (t.start <= todayWeek && t.end >= todayWeek && taskLogs[t.id]?.[todayWeek]) {
        list.push({
          proj: p,
          task: t,
          log: taskLogs[t.id][todayWeek]
        });
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
        list.push({
          proj: p,
          task: t
        });
      }
    }));
    return list;
  }, [projects, taskLogs, currentWeek, todayWeek, role, currentUser]);
  const myRetroCompletedTasks = useMemo(() => {
    if (role !== 'member' || currentWeek === todayWeek) return [];
    const list = [];
    projects.filter(p => p.owner === currentUser).forEach(p => p.tasks.forEach(t => {
      if (t.start <= currentWeek && t.end >= currentWeek && taskLogs[t.id]?.[currentWeek]) {
        list.push({
          proj: p,
          task: t,
          log: taskLogs[t.id][currentWeek]
        });
      }
    }));
    return list;
  }, [projects, taskLogs, currentWeek, todayWeek, role, currentUser]);

  // 「下週預計工作」也是強制回報項目:未填寫時計入待回報數,回報完最後一項任務會自動跳出填寫視窗
  const planPendingThisWeek = role === 'member' && !!currentUser && !weeklyPlans[currentUser]?.[todayWeek];
  const totalPendingCount = myPendingTasks.length + (planPendingThisWeek ? 1 : 0);
  const showTooltip = (e, proj, task) => {
    const weekLog = taskLogs[task.id]?.[currentWeek];
    const history = Object.entries(taskLogs[task.id] || {}).filter(([w]) => Number(w) !== currentWeek).sort((a, b) => Number(a[0]) - Number(b[0]));
    setTooltip({
      x: e.clientX,
      y: e.clientY,
      proj,
      task,
      weekLog,
      history
    });
  };
  const moveTooltip = e => setTooltip(prev => prev ? {
    ...prev,
    x: e.clientX,
    y: e.clientY
  } : null);
  const hideTooltip = () => setTooltip(null);

  // 瀏覽權限卡控:檢查完成前顯示載入畫面;卡控啟用且未通過 → 整頁無權限畫面(不顯示登入與任何資料)
  if (!accessCheck) return /*#__PURE__*/React.createElement("div", {
    className: "min-h-screen bg-slate-100 flex flex-col"
  }, /*#__PURE__*/React.createElement(LoadingScreen, null));
  if (accessCheck.enabled && !accessCheck.allowed) {
    return /*#__PURE__*/React.createElement(AccessDeniedScreen, {
      empId: empId,
      reason: accessCheck.reason,
      person: accessCheck.person
    });
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "min-h-screen bg-slate-50 font-sans flex flex-col relative overflow-hidden"
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
  }, "MSD \u5C08\u6848\u8FFD\u8E64\u7E3D\u8868")), currentUser && /*#__PURE__*/React.createElement("div", {
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
    className: "w-5 h-5 flex items-center justify-center bg-white/10 hover:bg-white/30 rounded-full text-xs font-bold transition",
    title: "\u4E0A\u4E00\u9031"
  }, "\u2039"), /*#__PURE__*/React.createElement("span", {
    className: "font-bold text-sm tracking-wider text-center",
    style: {
      color: GOLD,
      minWidth: 100
    }
  }, "W", String(currentWeek).padStart(2, '0'), /*#__PURE__*/React.createElement("span", {
    className: "text-white/75 font-normal text-[10px] ml-1"
  }, weekToMonth(currentWeek, months))), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      const w = Math.min(weeksTotal, currentWeek + 1);
      setCurrentWeek(w);
      setScrollTargetWeek(w);
    },
    className: "w-5 h-5 flex items-center justify-center bg-white/10 hover:bg-white/30 rounded-full text-xs font-bold transition",
    title: "\u4E0B\u4E00\u9031"
  }, "\u203A")) : /*#__PURE__*/React.createElement("div", {
    className: "flex items-center space-x-1.5"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      const w = Math.max(1, currentWeek - 1);
      setCurrentWeek(w);
      setScrollTargetWeek(w);
    },
    className: "w-5 h-5 flex items-center justify-center bg-white/10 hover:bg-white/30 rounded-full text-xs font-bold transition",
    title: "\u6AA2\u8996\u524D\u4E00\u9031(\u552F\u8B80)"
  }, "\u2039"), /*#__PURE__*/React.createElement("span", {
    className: "font-bold text-sm tracking-wider text-center",
    style: {
      color: GOLD,
      minWidth: 100
    }
  }, "W", String(currentWeek).padStart(2, '0'), /*#__PURE__*/React.createElement("span", {
    className: "text-white/75 font-normal text-[10px] ml-1"
  }, weekToMonth(currentWeek, months))), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      const w = Math.min(todayWeek, currentWeek + 1);
      setCurrentWeek(w);
      setScrollTargetWeek(w);
    },
    disabled: currentWeek >= todayWeek,
    className: `w-5 h-5 flex items-center justify-center rounded-full text-xs font-bold transition ${currentWeek >= todayWeek ? 'bg-white/5 text-white/20 cursor-not-allowed' : 'bg-white/10 hover:bg-white/30'}`,
    title: "\u6AA2\u8996\u5F8C\u4E00\u9031"
  }, "\u203A")), role === 'member' && isViewingPast && /*#__PURE__*/React.createElement("button", {
    onClick: goToCurrentWeek,
    className: "ml-2 flex items-center bg-yellow-500/90 hover:bg-yellow-400 text-slate-900 text-[10px] font-bold px-2 py-0.5 rounded-full transition"
  }, "\uD83D\uDD12 \u552F\u8B80\u6AA2\u8996\u4E2D \xB7 \u8FD4\u56DE\u672C\u9031 W", String(todayWeek).padStart(2, '0')))), currentUser && /*#__PURE__*/React.createElement("div", {
    className: "flex items-center space-x-2"
  }, role === 'member' && allowRetroCheckin && currentWeek !== todayWeek &&
  /*#__PURE__*/
  // 主管開放補登時:成員檢視非當週可直接修改該週回報(任務打卡/非專案/下週預計;主管回覆不可異動)
  React.createElement("button", {
    onClick: () => setShowRetroPanel(true),
    className: "bg-amber-700/80 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold shadow-md transition flex items-center gap-1 border border-amber-400/80",
    title: `主管已開放補登：可修改 W${String(currentWeek).padStart(2, '0')} 的任務打卡、非專案事項與下週預計工作`
  }, "\uD83D\uDD58 \u4FEE\u6539 W", String(currentWeek).padStart(2, '0'), " \u56DE\u5831"), role === 'member' &&
  /*#__PURE__*/
  // 本週回報的三件事(任務打卡/下週預計/非專案事項)合併為單一入口;紅點=未回報任務+未填下週預計(非專案為選填不計)
  React.createElement("button", {
    onClick: () => setShowPendingPanel(true),
    className: "relative bg-amber-500 hover:bg-amber-600 text-white px-3.5 py-1.5 rounded-lg text-xs font-bold shadow-md transition flex items-center gap-1.5 border border-amber-400"
  }, /*#__PURE__*/React.createElement("span", null, "\uD83D\uDCCB \u672C\u9031\u56DE\u5831\u4E2D\u5FC3"), totalPendingCount > 0 && /*#__PURE__*/React.createElement("span", {
    className: "bg-red-600 text-white text-[11px] px-1.5 py-0.5 rounded-full font-black shadow leading-none"
  }, totalPendingCount)), role === 'manager' && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("button", {
    onClick: () => setShowWeekEditPanel(true),
    className: "bg-amber-700/80 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold shadow-md transition flex items-center gap-1 border border-amber-400/80",
    title: `編輯 W${String(currentWeek).padStart(2, '0')} 各成員回報：代成員補登/修正任務打卡、非專案事項、下週預計工作，並可編輯主管回覆`
  }, "\uD83D\uDEE0 \u7DE8\u8F2F W", String(currentWeek).padStart(2, '0'), " \u56DE\u5831")), /*#__PURE__*/React.createElement("button", {
    onClick: () => setShowWeeklyReport(true),
    className: "bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-md text-xs font-bold shadow transition border border-blue-400/50"
  }, "\uD83D\uDCCA W", String(currentWeek).padStart(2, '0'), " \u5718\u968A\u7E3D\u7D50"), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center space-x-3 border-l border-white/20 pl-3 ml-1"
  }, role === 'manager' && /*#__PURE__*/React.createElement("div", {
    className: "relative"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setShowAdminMenu(v => !v),
    className: `px-3 py-1.5 rounded-md text-xs font-bold shadow transition border border-white/20 text-white ${showAdminMenu ? 'bg-white/25' : 'bg-white/10 hover:bg-white/20'}`,
    title: "\u7BA1\u7406\u529F\u80FD\uFF1A\u6210\u54E1\u7BA1\u7406\u3001\u700F\u89BD\u6B0A\u9650\u3001\u4F7F\u7528\u7D71\u8A08\u3001\u7570\u52D5\u7D00\u9304"
  }, "\u2699\uFE0F \u7BA1\u7406 ", showAdminMenu ? '▴' : '▾'), showAdminMenu && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "fixed inset-0 z-[60]",
    onClick: () => setShowAdminMenu(false)
  }), /*#__PURE__*/React.createElement("div", {
    className: "absolute right-0 top-full mt-1.5 z-[70] w-44 bg-white rounded-xl shadow-2xl border border-slate-200 py-1.5 overflow-hidden"
  }, [{
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
    onClick: () => {
      setShowAdminMenu(false);
      item.open();
    },
    className: "w-full text-left px-3.5 py-2 hover:bg-slate-100 transition flex items-center gap-2.5"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-base"
  }, item.icon), /*#__PURE__*/React.createElement("span", {
    className: "min-w-0"
  }, /*#__PURE__*/React.createElement("span", {
    className: "block text-xs font-bold text-slate-800"
  }, item.label), /*#__PURE__*/React.createElement("span", {
    className: "block text-[10px] text-slate-400"
  }, item.desc))))))), /*#__PURE__*/React.createElement("div", {
    className: "text-right leading-tight"
  }, /*#__PURE__*/React.createElement("div", {
    className: "font-bold text-sm"
  }, currentUser), /*#__PURE__*/React.createElement("div", {
    className: "text-[10px] text-white/80"
  }, role === 'manager' ? '主管' : '成員', empId ? ` · 工號 ${empId}` : '')), /*#__PURE__*/React.createElement("button", {
    onClick: handleLogout,
    className: "p-1.5 hover:bg-red-500/80 rounded-lg transition text-white/70 hover:text-white bg-white/5",
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
  })))))), dataLoading ? /*#__PURE__*/React.createElement(LoadingScreen, null) : dataError ? /*#__PURE__*/React.createElement(ErrorScreen, {
    message: dataError,
    onRetry: loadBootstrap
  }) : !currentUser ? /*#__PURE__*/React.createElement(LoginScreen, {
    onLogin: handleLogin,
    users: users,
    year: scheduleYear,
    empId: empId
  }) : /*#__PURE__*/React.createElement("div", {
    className: "flex-1 flex flex-col overflow-hidden bg-white relative"
  }, isResults ? /*#__PURE__*/React.createElement("div", {
    className: "px-4 py-2 border-b border-slate-200 bg-gradient-to-r from-amber-50/80 via-white to-white flex items-center justify-between text-xs overflow-x-auto"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-3"
  }, /*#__PURE__*/React.createElement("span", {
    className: "font-black text-amber-800 text-sm"
  }, "\uD83C\uDFAF ", scheduleYear, " \u5E74\u5EA6\u6210\u679C\u8207 MP \u6548\u76CA\u6E05\u55AE"), /*#__PURE__*/React.createElement("span", {
    className: "text-slate-500"
  }, "\u6AA2\u8996\u6240\u6709\u5C08\u6848\u5B8C\u5DE5\u9810\u8A08\u4EA4\u4ED8\u4E4B\u5177\u9AD4\u7522\u51FA\u8207\u7D2F\u8A08\u7BC0\u7701\u4E4B MP \u4EBA\u529B")), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "bg-amber-100/80 border border-amber-300 text-amber-900 px-3 py-1 rounded-full font-bold"
  }, "\u5DF2\u586B\u5BEB\u7522\u51FA\u9805\u76EE\uFF1A", projects.filter(p => p.deliverable).length, " / ", projects.length, " \u6848"), /*#__PURE__*/React.createElement("div", {
    className: "bg-emerald-100/80 border border-emerald-300 text-emerald-900 px-3 py-1 rounded-full font-bold"
  }, "\uD83D\uDCA1 MP Saving\uFF1A", projects.filter(p => p.mpSaving).length, " \u6848"))) : /*#__PURE__*/React.createElement("div", {
    className: "px-4 py-2 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white flex items-center gap-3 text-xs overflow-x-auto"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center flex-shrink-0"
  }, /*#__PURE__*/React.createElement("span", {
    className: "font-black text-slate-900 text-sm"
  }, "W", String(currentWeek).padStart(2, '0')), /*#__PURE__*/React.createElement("span", {
    className: "text-slate-600 ml-1 text-[10px]"
  }, weekToMonth(currentWeek, months), " \u6982\u6CC1")), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center flex-shrink-0 min-w-[150px]"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex-1 h-2 bg-slate-300 rounded-full overflow-hidden"
  }, /*#__PURE__*/React.createElement("div", {
    className: `h-full rounded-full transition-all duration-500 ${weekStats.active > 0 && weekStats.reported === weekStats.active ? 'bg-green-600' : 'bg-indigo-600'}`,
    style: {
      width: `${weekStats.active > 0 ? weekStats.reported / weekStats.active * 100 : 0}%`
    }
  })), /*#__PURE__*/React.createElement("span", {
    className: "ml-2 font-bold text-slate-800 whitespace-nowrap"
  }, weekStats.reported, "/", weekStats.active, " \u5DF2\u56DE\u5831")), /*#__PURE__*/React.createElement("div", {
    className: "h-6 border-l border-slate-200 flex-shrink-0"
  }), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-1.5 flex-shrink-0"
  }, /*#__PURE__*/React.createElement(StatChip, {
    label: "\u6709\u57F7\u884C",
    value: weekStats.executed,
    className: "bg-green-100 text-green-800 border-green-400"
  }), /*#__PURE__*/React.createElement(StatChip, {
    label: "Monitor",
    value: weekStats.monitor,
    className: "bg-sky-100 text-sky-800 border-sky-400"
  }), /*#__PURE__*/React.createElement(StatChip, {
    label: "\u672A\u57F7\u884C",
    value: weekStats.notExec,
    className: "bg-slate-200 text-slate-700 border-slate-400"
  }), /*#__PURE__*/React.createElement(StatChip, {
    label: "\u672A\u56DE\u5831",
    value: weekStats.pending,
    className: weekStats.pending > 0 ? 'bg-yellow-100 text-yellow-800 border-yellow-500' : 'bg-slate-100 text-slate-500 border-slate-300'
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
  }, "\u203A"))), /*#__PURE__*/React.createElement("div", {
    className: "flex-1 min-w-[8px]"
  }), /*#__PURE__*/React.createElement("div", {
    className: "flex-shrink-0 flex items-center gap-2 text-[11px] text-slate-600 border border-slate-200 rounded-lg bg-white px-2 py-0.5"
  }, /*#__PURE__*/React.createElement("span", {
    className: "flex items-center",
    title: "\u9EC3\u8272\u659C\u7D0B\u689D\uFF1D\u8A08\u756B\u5340\u9593(\u6392\u5B9A\u7684\u8D77\u8A16\u9031)"
  }, /*#__PURE__*/React.createElement("span", {
    className: "w-3 h-2.5 mr-1 rounded-sm border",
    style: {
      backgroundImage: 'repeating-linear-gradient(45deg,#FFF6D6,#FFF6D6 3px,#FDEDB8 3px,#FDEDB8 6px)',
      borderColor: '#B45309'
    }
  }), "\u8A08\u756B"), /*#__PURE__*/React.createElement("span", {
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
  }), "\u672A\u57F7\u884C"), /*#__PURE__*/React.createElement("span", {
    className: "flex items-center",
    title: "\u7D05\u6846\uFF0B\u2757\uFF1D\u672C\u9031\u6392\u5B9A\u4F46\u5C1A\u672A\u56DE\u5831\u7684\u4EFB\u52D9"
  }, /*#__PURE__*/React.createElement("span", {
    className: "w-3 h-2.5 mr-1 rounded-sm border-2 border-red-400 bg-white"
  }), "\u2757\u5F85\u56DE\u5831"), /*#__PURE__*/React.createElement("span", {
    className: "flex items-center text-slate-400 border-l border-slate-200 pl-2",
    title: "\u9375\u76E4\u5FEB\u6377\u9375\uFF1AH\uFF1D\u56DE\u5230\u672C\u9031\u4E26\u7F6E\u4E2D\uFF1B\u2190 \u2192\uFF1D\u5DE6\u53F3\u5E73\u79FB 4 \u9031\uFF1BShift\uFF0B\u2190 \u2192\uFF1D\u5FAE\u79FB 1 \u9031\uFF1BESC\uFF1D\u95DC\u9589\u6700\u4E0A\u5C64\u8996\u7A97"
  }, "\u2328 H \u56DE\u672C\u9031\u30FB\u2190\u2192 \u5E73\u79FB"))), /*#__PURE__*/React.createElement("div", {
    className: "bg-white px-4 py-1.5 border-b border-slate-200 flex flex-nowrap items-center gap-1.5 text-[11px] z-30 overflow-x-auto [&>*]:flex-shrink-0"
  }, /*#__PURE__*/React.createElement("div", {
    className: "relative"
  }, /*#__PURE__*/React.createElement("svg", {
    className: "w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400",
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
    className: "pl-7 pr-6 py-1 border border-slate-300 rounded-lg outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-200 transition w-44 focus:w-52"
  }), searchText && /*#__PURE__*/React.createElement("button", {
    onClick: () => setSearchText(''),
    className: "absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 font-bold px-1"
  }, "\xD7")), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center space-x-1"
  }, Object.entries(PROJECT_TYPES).map(([key, meta]) => {
    const on = typeFilter.has(key);
    return /*#__PURE__*/React.createElement("button", {
      key: key,
      onClick: () => toggleTypeFilter(key),
      className: `px-1.5 py-0.5 rounded-full border font-bold transition ${on ? meta.chip + ' ring-1 ring-offset-1 ring-slate-500' : 'bg-white text-slate-700 border-slate-400 hover:border-slate-600 hover:bg-slate-50'}`,
      title: meta.label
    }, key, "\xB7", meta.label);
  }), typeFilter.size > 0 && /*#__PURE__*/React.createElement("button", {
    onClick: () => setTypeFilter(new Set()),
    className: "text-blue-600 hover:underline px-1"
  }, "\u6E05\u9664")), /*#__PURE__*/React.createElement("div", {
    className: "h-5 border-l border-slate-200"
  }), role === 'member' && !isResults ? /*#__PURE__*/React.createElement("label", {
    className: "flex items-center space-x-1.5 cursor-pointer select-none bg-slate-50 border border-slate-200 rounded-lg px-2 py-1"
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: onlyMine,
    onChange: e => setOnlyMine(e.target.checked),
    className: "w-3.5 h-3.5 rounded text-blue-600"
  }), /*#__PURE__*/React.createElement("span", {
    className: "font-medium text-slate-700"
  }, "\u53EA\u770B\u6211\u7684\u5C08\u6848")) : /*#__PURE__*/React.createElement("select", {
    value: ownerFilter,
    onChange: e => setOwnerFilter(e.target.value),
    className: "border border-slate-300 rounded-lg px-2 py-1 outline-none bg-white font-medium text-slate-700"
  }, /*#__PURE__*/React.createElement("option", {
    value: "all"
  }, "\u5168\u90E8\u6210\u54E1"), users.map(u => /*#__PURE__*/React.createElement("option", {
    key: u,
    value: u
  }, u))), /*#__PURE__*/React.createElement("div", {
    className: "flex-1"
  }), /*#__PURE__*/React.createElement("select", {
    value: scheduleYear,
    onChange: e => {
      const y = parseInt(e.target.value);
      setScheduleYear(y);
      setCurrentWeek(getTodayWeek(y));
    },
    title: "\u5207\u63DB\u6392\u7A0B\u5E74\u5EA6(\u5E74\u5EA6\u8CC7\u6599\u7531 DB \u7684 ScheduleWeeks \u6C7A\u5B9A)",
    className: "border border-slate-300 rounded-lg px-2 py-1 outline-none bg-white font-bold text-slate-700"
  }, (years.length ? years : [scheduleYear]).map(y => /*#__PURE__*/React.createElement("option", {
    key: y,
    value: y
  }, y, " \u5E74\u5EA6"))), /*#__PURE__*/React.createElement("div", {
    className: "flex rounded-lg overflow-hidden border",
    style: {
      borderColor: NAVY
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      if (isResults && role === 'member') {
        setOnlyMine(true);
        setOwnerFilter('all');
      }
      setIsOverview(false);
      setIsResults(false);
      savePref('overview', false);
    },
    className: `px-2 py-1 font-bold transition ${!isOverview && !isResults ? 'text-white' : 'bg-white text-slate-600 hover:bg-slate-100'}`,
    style: !isOverview && !isResults ? {
      backgroundColor: NAVY
    } : {}
  }, "\u9031\u6AA2\u8996"), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      if (isResults && role === 'member') {
        setOnlyMine(true);
        setOwnerFilter('all');
      }
      setIsOverview(true);
      setIsResults(false);
      savePref('overview', true);
    },
    className: `px-2 py-1 font-bold transition ${isOverview && !isResults ? 'text-white' : 'bg-white text-slate-600 hover:bg-slate-100'}`,
    style: isOverview && !isResults ? {
      backgroundColor: NAVY
    } : {},
    title: "\u6574\u5E74 52 \u9031\u81EA\u52D5\u7E2E\u653E\u81F3\u4E00\u500B\u756B\u9762\u5BEC(\u7121\u6C34\u5E73\u6372\u8EF8),\u6ED1\u9F20\u505C\u7559\u7518\u7279\u689D\u53EF\u770B\u7D30\u7BC0"
  }, "\u5E74\u5EA6\u7E3D\u89BD"), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      if (role === 'member') {
        setOnlyMine(false);
        setOwnerFilter(currentUser);
      }
      setIsOverview(false);
      setIsResults(true);
    },
    className: `px-2 py-1 font-bold transition ${isResults ? 'text-white' : 'bg-white text-slate-600 hover:bg-slate-100'}`,
    style: isResults ? {
      backgroundColor: NAVY
    } : {},
    title: "\u6AA2\u8996\u5168\u5E74\u5EA6\u6240\u6709\u5C08\u6848\u7684\u5177\u9AD4\u7522\u51FA\u9805\u76EE\u8207 MP Saving \u7D71\u8A08(\u9AD8\u968E\u4E3B\u7BA1\u700F\u89BD\u8996\u89D2,\u552F\u8B80)"
  }, "\u6210\u679C\u6E05\u55AE")), !isOverview && !isResults && /*#__PURE__*/React.createElement("button", {
    onClick: goToCurrentWeek,
    title: `回到本週 W${String(todayWeek).padStart(2, '0')} 並置中（快捷鍵 H）`,
    className: "flex items-center text-white px-2 py-1 rounded-lg font-bold shadow-sm transition hover:opacity-90",
    style: {
      backgroundColor: NAVY
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
    className: "text-slate-600 bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded-lg border border-slate-200 font-medium transition"
  }, isCompact ? '寬鬆模式' : '緊湊模式'), role === 'manager' &&
  /*#__PURE__*/
  // 長文字縮短:完整說明放 title;開啟時下方另有整條琥珀色警示列,資訊不會漏
  React.createElement("button", {
    onClick: toggleRetroCheckin,
    className: `px-2 py-1 rounded-lg font-bold border shadow-sm transition flex items-center gap-1 ${allowRetroCheckin ? 'bg-amber-500 hover:bg-amber-600 text-white border-amber-600' : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300'}`,
    title: allowRetroCheckin ? '目前開放全體成員回報/調正今年度的所有歷史週次紀錄，點擊關閉' : '目前成員僅能回報當週，點擊開放歷史補登'
  }, /*#__PURE__*/React.createElement("span", null, allowRetroCheckin ? '🔓 補登 ON' : '🔒 僅限當週')), !isResults && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "h-5 w-px bg-slate-300/80 mx-1 flex-shrink-0"
  }), /*#__PURE__*/React.createElement("button", {
    onClick: () => setCollapsedOwners(new Set()),
    title: "\u5C55\u958B\u5168\u90E8\u6210\u54E1\u7FA4\u7D44",
    className: "text-blue-600 hover:text-blue-800 font-medium"
  }, "\u5C55\u958B"), /*#__PURE__*/React.createElement("span", {
    className: "text-slate-300"
  }, "|"), /*#__PURE__*/React.createElement("button", {
    onClick: () => setCollapsedOwners(new Set(users)),
    title: "\u6536\u5408\u5168\u90E8\u6210\u54E1\u7FA4\u7D44",
    className: "text-blue-600 hover:text-blue-800 font-medium"
  }, "\u6536\u5408"))), allowRetroCheckin && /*#__PURE__*/React.createElement("div", {
    className: "bg-amber-50 border-b border-amber-300 px-4 py-2 flex items-center justify-between text-xs text-amber-900 font-bold z-30"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-sm"
  }, "\u26A0\uFE0F"), /*#__PURE__*/React.createElement("span", null, "\u7CFB\u7D71\u5DF2\u958B\u555F\u300C\u5168\u9AD4\u6210\u54E1\u6B77\u53F2\u9032\u5EA6\u88DC\u767B\u8207\u8ABF\u6B63\u300D\u8C41\u514D\u671F\uFF1A\u76EE\u524D\u53EF\u5C0D W", String(todayWeek).padStart(2, '0'), " \u4EE5\u524D\u4E4B\u6240\u6709\u6B77\u53F2\u9031\u6B21\u9032\u884C\u4EFB\u52D9\u8207\u975E\u5C08\u6848\u56DE\u5831\u3002")), role === 'manager' && /*#__PURE__*/React.createElement("button", {
    onClick: toggleRetroCheckin,
    className: "px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded font-bold shadow-sm transition"
  }, "\u95DC\u9589\u8C41\u514D\u671F")), /*#__PURE__*/React.createElement("div", {
    ref: ganttRef,
    className: "flex-1 overflow-auto bg-slate-50 relative"
  }, isResults ? /*#__PURE__*/React.createElement(ResultsView, {
    projects: filteredProjects,
    role: role,
    currentUser: currentUser,
    year: scheduleYear,
    starredIds: starredIds,
    toggleStar: toggleStar
  }) : /*#__PURE__*/React.createElement("table", {
    className: "border-collapse bg-white",
    style: {
      tableLayout: 'fixed',
      width: isOverview ? '100%' : 490 + weeksTotal * weekW
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
      width: isOverview ? 240 : 420
    }
  }), Array.from({
    length: weeksTotal
  }).map((_, i) => /*#__PURE__*/React.createElement("col", {
    key: i,
    style: isOverview ? undefined : {
      width: weekW
    }
  }))), /*#__PURE__*/React.createElement("thead", {
    className: "sticky top-0 z-40 text-xs shadow-sm bg-slate-100"
  }, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", {
    colSpan: isOverview ? 1 : 3,
    className: "border-r border-b border-slate-300 bg-slate-200 sticky left-0 z-50 px-2 py-1 text-left",
    style: {
      width: isOverview ? 240 : 490
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex justify-between items-center text-[10px]"
  }, /*#__PURE__*/React.createElement("span", {
    className: "font-bold text-slate-700"
  }, "\u5C08\u6848\u57FA\u672C\u8CC7\u8A0A"), /*#__PURE__*/React.createElement("span", {
    className: "text-slate-600 font-normal"
  }, "\u986F\u793A ", filteredProjects.length, " / ", projects.length, " \u9805"))), months.map((m, i) => /*#__PURE__*/React.createElement("th", {
    key: i,
    colSpan: m.weeks,
    className: "border-r border-b border-slate-300 text-white p-0.5 text-center font-medium text-[11px] tracking-wider relative overflow-hidden",
    style: {
      backgroundColor: i % 2 === 0 ? NAVY : '#0A3178'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "absolute inset-0 bg-gradient-to-b from-white/10 to-transparent"
  }), m.name.slice(0, 4), "/", m.name.slice(4)))), !isOverview && /*#__PURE__*/React.createElement("tr", {
    className: "bg-slate-100 text-slate-600 text-[11px]"
  }, /*#__PURE__*/React.createElement("th", {
    className: "border-r border-b border-slate-300 p-1 sticky left-0 z-50 text-center font-medium",
    style: {
      width: 28,
      minWidth: 28,
      maxWidth: 28,
      backgroundColor: '#F1F5F9'
    }
  }, "No"), /*#__PURE__*/React.createElement("th", {
    className: "border-r border-b border-slate-300 p-1 sticky z-50 text-center font-medium",
    style: {
      width: 42,
      minWidth: 42,
      maxWidth: 42,
      left: 28,
      backgroundColor: '#F1F5F9'
    }
  }, "\u5206\u985E"), /*#__PURE__*/React.createElement("th", {
    className: "border-r border-b border-slate-300 p-1 sticky z-50 shadow-[3px_0_6px_rgba(0,0,0,0.08)] text-left pl-3 font-medium",
    style: {
      width: 420,
      minWidth: 420,
      maxWidth: 420,
      left: 70,
      backgroundColor: '#F1F5F9'
    }
  }, "\u5C08\u6848\u540D\u7A31 (Project Name)"), Array.from({
    length: weeksTotal
  }).map((_, i) => {
    const weekNum = i + 1;
    const isCurrent = weekNum === currentWeek;
    return /*#__PURE__*/React.createElement("th", {
      key: i,
      onClick: () => {
        if (role === 'manager' || weekNum <= todayWeek) setCurrentWeek(weekNum);
      },
      title: role === 'manager' ? `點擊將系統週切換至 W${weekNum}` : weekNum <= todayWeek ? `點擊檢視 W${weekNum}(唯讀)` : undefined,
      className: `border-r border-b border-slate-300 p-0 text-center relative ${role === 'manager' || weekNum <= todayWeek ? 'cursor-pointer hover:bg-blue-100' : ''} ${isCurrent ? 'text-white font-bold' : weekNum > todayWeek ? 'bg-slate-100 text-slate-500 font-normal' : 'bg-slate-50 text-slate-700 font-normal'}`,
      style: {
        width: weekW,
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
      className: "py-1 z-10 relative"
    }, isCompact ? weekNum : `W${String(weekNum).padStart(2, '0')}`));
  }))), /*#__PURE__*/React.createElement("tbody", {
    className: "text-xs"
  }, groupedProjects.length === 0 ? /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
    colSpan: weeksTotal + 3,
    className: "p-10 text-center text-slate-400"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-3xl mb-2"
  }, "\uD83D\uDD0D"), "\u627E\u4E0D\u5230\u7B26\u5408\u689D\u4EF6\u7684\u5C08\u6848\u3002\u8ABF\u6574\u641C\u5C0B\u95DC\u9375\u5B57\u6216\u6E05\u9664\u7BE9\u9078\u5F8C\u518D\u8A66\u4E00\u6B21\u3002")) : groupedProjects.map(group => {
    const isCollapsed = collapsedOwners.has(group.owner);
    let gActive = 0,
      gReported = 0;
    group.projects.forEach(p => p.tasks.forEach(t => {
      if (t.start <= currentWeek && t.end >= currentWeek) {
        gActive++;
        if (taskLogs[t.id]?.[currentWeek]) gReported++;
      }
    }));
    return /*#__PURE__*/React.createElement(React.Fragment, {
      key: group.owner
    }, /*#__PURE__*/React.createElement("tr", {
      onClick: () => toggleOwnerCollapse(group.owner),
      className: "group/header bg-[#EFF6FF] hover:bg-[#DBEAFE] cursor-pointer border-b border-blue-100 transition-colors"
    }, /*#__PURE__*/React.createElement("td", {
      colSpan: isOverview ? 1 : 3,
      className: "sticky left-0 z-40 border-r border-blue-200 p-0 shadow-[3px_0_6px_rgba(0,0,0,0.06)]",
      style: {
        width: isOverview ? 240 : 490,
        minWidth: isOverview ? 240 : 490,
        maxWidth: isOverview ? 240 : 490,
        backgroundColor: '#EFF6FF'
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
        backgroundColor: NAVY
      }
    }, group.owner[0]), group.owner, /*#__PURE__*/React.createElement("span", {
      className: "ml-2 px-1.5 py-0.5 bg-white text-blue-600 rounded text-[10px] font-medium border border-blue-100"
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
      className: "ml-auto flex-shrink-0 flex items-center gap-1 bg-white text-blue-700 hover:bg-blue-600 hover:text-white border border-blue-300 rounded px-2 py-0.5 text-[10px] font-bold transition shadow-sm",
      title: `為 ${group.owner} 新增專案`
    }, "\uFF0B \u65B0\u589E\u5C08\u6848"))), /*#__PURE__*/React.createElement("td", {
      colSpan: weeksTotal,
      className: "p-0 border-r border-slate-200"
    }, /*#__PURE__*/React.createElement("div", {
      className: "w-full h-full flex opacity-30"
    }, Array.from({
      length: weeksTotal
    }).map((_, i) => /*#__PURE__*/React.createElement("div", {
      key: i,
      className: `flex-1 border-r border-slate-300 ${i + 1 === currentWeek ? 'bg-red-100' : ''}`
    }))))), !isCollapsed && group.projects.map((proj, idx) => /*#__PURE__*/React.createElement("tr", {
      key: proj.id,
      onDragOver: role === 'manager' && dragState && dragState.owner === group.owner ? e => {
        e.preventDefault();
        if (dragOverId !== proj.id) setDragOverId(proj.id);
      } : undefined,
      onDrop: role === 'manager' && dragState ? e => {
        e.preventDefault();
        handleReorderProjects(group.owner, dragState.id, proj.id);
        setDragState(null);
        setDragOverId(null);
      } : undefined,
      className: `group/row border-b border-slate-300 transition-colors ${dragOverId === proj.id && dragState && dragState.id !== proj.id ? 'border-t-2 border-t-blue-500' : ''} ${dragState && dragState.id === proj.id ? 'opacity-40' : ''}`
    }, !isOverview && /*#__PURE__*/React.createElement("td", {
      className: `text-center sticky left-0 bg-white group-hover/row:bg-[#EFF6FF] transition-colors z-30 border-r border-slate-200 text-slate-500 font-medium ${isCompact ? 'py-1' : 'py-2'}`,
      style: {
        width: 28,
        minWidth: 28,
        maxWidth: 28
      }
    }, idx + 1), !isOverview && /*#__PURE__*/React.createElement("td", {
      className: `text-center sticky bg-white group-hover/row:bg-[#EFF6FF] transition-colors z-30 border-r border-slate-200 text-slate-800 font-medium ${isCompact ? 'py-1' : 'py-2'}`,
      style: {
        width: 42,
        minWidth: 42,
        maxWidth: 42,
        left: 28
      }
    }, proj.category), /*#__PURE__*/React.createElement("td", {
      className: "sticky bg-white group-hover/row:bg-[#EFF6FF] transition-colors z-30 shadow-[4px_0_8px_rgba(0,0,0,0.08)] border-r border-slate-300 p-0",
      style: {
        width: isOverview ? 240 : 420,
        minWidth: isOverview ? 240 : 420,
        maxWidth: isOverview ? 240 : 420,
        left: isOverview ? 0 : 70
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
      className: "flex-shrink-0 mr-1 cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 select-none text-[13px] leading-none",
      title: "\u62D6\u66F3\u4EE5\u8ABF\u6574\u6392\u5E8F"
    }, "\u283F")), /*#__PURE__*/React.createElement("div", {
      className: `flex-shrink-0 px-1.5 py-0.5 mr-2 text-[9px] font-bold rounded-sm border ${PROJECT_TYPES[proj.type].chip}`
    }, proj.type.toUpperCase()), /*#__PURE__*/React.createElement("span", {
      className: `flex-1 min-w-0 truncate font-semibold text-slate-900 ${isOverview ? 'text-[12.5px]' : isCompact ? 'text-[13px]' : 'text-[15px]'}`,
      title: proj.name
    }, proj.name), /*#__PURE__*/React.createElement("button", {
      onClick: e => {
        e.stopPropagation();
        setDeliverableProj(proj);
      },
      className: `flex-shrink-0 ml-1 text-[12px] leading-none transition hover:scale-125 ${proj.deliverable ? 'opacity-90' : 'opacity-25 hover:opacity-70'}`,
      title: proj.deliverable || proj.mpSaving ? `具體產出項目：${proj.deliverable || '（未填寫）'}${proj.mpSaving ? `\n💡 MP Saving：${proj.mpSaving}` : ''}` : '具體產出項目（尚未填寫，點擊檢視/填寫）'
    }, "\uD83C\uDFAF"), (() => {
      const soon = proj.tasks.filter(isTaskDeadlineSoon);
      if (soon.length === 0) return null;
      const remain = Math.min(...soon.map(t => t.end - todayWeek + 1));
      return /*#__PURE__*/React.createElement("span", {
        className: "flex-shrink-0 ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-orange-100 text-orange-700 border border-orange-300 whitespace-nowrap",
        title: `${soon.length} 個計畫區間即將到期(最近的剩 ${remain} 週)`
      }, "\u23F0 \u5269", remain, "\u9031");
    })(), role === 'manager' && !isOverview && /*#__PURE__*/React.createElement("div", {
      className: "flex-shrink-0 flex items-center gap-0.5 ml-1 opacity-0 group-hover/row:opacity-100 transition-opacity"
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
    }, "\uD83D\uDDD1")))), /*#__PURE__*/React.createElement("td", {
      colSpan: weeksTotal,
      className: "p-0 relative",
      style: {
        height: isOverview ? 24 : isCompact ? 30 : 40
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "absolute inset-0 flex pointer-events-none z-0"
    }, Array.from({
      length: weeksTotal
    }).map((_, i) => /*#__PURE__*/React.createElement("div", {
      key: i,
      className: `flex-1 border-r border-slate-200 ${i + 1 === currentWeek ? 'bg-red-50/70' : ''}`
    }))), /*#__PURE__*/React.createElement("div", {
      className: "absolute top-0 bottom-0 z-10 pointer-events-none",
      style: {
        left: `${(currentWeek - 0.5) * (100 / weeksTotal)}%`,
        borderLeft: '2px solid rgba(220,38,38,0.55)'
      }
    }), proj.tasks.map(task => {
      const isActiveThisWeek = task.start <= currentWeek && task.end >= currentWeek;
      const weekLog = taskLogs[task.id]?.[currentWeek];
      const isPending = role === 'member' && proj.owner === currentUser && isActiveThisWeek && !weekLog;
      const deadlineSoon = isTaskDeadlineSoon(task); // 剩 ≤2 週或已過 70% 時程 → 橘框 + ⏰(未回報紅框優先)

      const barClass = 'text-slate-900';
      const barStyle = {
        backgroundImage: 'repeating-linear-gradient(45deg, #FFF6D6, #FFF6D6 6px, #FDEDB8 6px, #FDEDB8 12px)',
        borderColor: 'rgba(180,83,9,0.75)' // 加深(範本 B):淡黃條在白底上需要更明確的輪廓
      };
      const textClass = weekLog ? 'font-bold' : 'font-medium opacity-90';
      const spanWeeks = task.end - task.start + 1;
      const leftPercent = (task.start - 1) * (100 / weeksTotal);
      const widthPercent = (task.end - task.start + 1) * (100 / weeksTotal);
      const logs = taskLogs[task.id] || {};
      return /*#__PURE__*/React.createElement(React.Fragment, {
        key: task.id
      }, /*#__PURE__*/React.createElement("div", {
        onClick: () => setSelectedTaskInfo({
          proj,
          task,
          isActiveThisWeek,
          weekLog
        }),
        onMouseEnter: e => showTooltip(e, proj, task),
        onMouseMove: moveTooltip,
        onMouseLeave: hideTooltip,
        className: `absolute flex items-center overflow-hidden cursor-pointer transition-transform hover:scale-y-110 hover:z-20 z-10 border rounded-sm shadow-sm ${barClass} ${isPending ? 'ring-2 ring-red-400 ring-offset-1' : deadlineSoon ? 'ring-2 ring-orange-400 ring-offset-1' : ''}`,
        style: {
          left: `${leftPercent}%`,
          width: `${widthPercent}%`,
          top: isOverview ? 4 : 4,
          bottom: isOverview ? 4 : isCompact ? 8 : 10,
          ...barStyle
        }
      }, Object.entries(logs).map(([w, log]) => {
        const wn = Number(w);
        if (!log || wn < task.start || wn > task.end) return null;
        const isCur = wn === currentWeek;
        return /*#__PURE__*/React.createElement("div", {
          key: w,
          className: `absolute bottom-0 pointer-events-none ${STATUS_META[log.status]?.dot || 'bg-blue-500'}`,
          style: {
            left: `${(wn - task.start) / spanWeeks * 100}%`,
            width: `${100 / spanWeeks}%`,
            height: isCur ? '5px' : '4px',
            opacity: isCur ? 0.95 : 0.75
          },
          title: `W${w}: ${STATUS_META[log.status]?.label}${log.reporterRole === 'manager' ? ' (主管補登)' : ''}`
        });
      }), !isOverview && /*#__PURE__*/React.createElement("span", {
        className: `relative z-10 truncate px-1.5 whitespace-nowrap ${isCompact ? 'text-[10px]' : 'text-[12px]'} ${textClass}`,
        style: {
          textShadow: '0 0 3px rgba(255,255,255,0.9), 0 0 6px rgba(255,255,255,0.75)'
        }
      }, isPending && '❗', deadlineSoon && '⏰', task.name)));
    })))));
  }))))), tooltip && /*#__PURE__*/React.createElement("div", {
    className: "fixed z-[200] pointer-events-none",
    style: {
      left: Math.min(tooltip.x + 14, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 300),
      top: Math.min(tooltip.y + 14, (typeof window !== 'undefined' ? window.innerHeight : 800) - 200)
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "bg-slate-900/95 text-white rounded-lg shadow-xl px-3.5 py-3 text-xs max-w-xs border border-slate-700"
  }, /*#__PURE__*/React.createElement("div", {
    className: "font-bold text-[13px] mb-1 text-yellow-200"
  }, tooltip.proj.name), /*#__PURE__*/React.createElement("div", {
    className: "text-slate-300 mb-0.5"
  }, "\uD83D\uDC64 ", tooltip.proj.owner, "\u3000\xB7\u3000", tooltip.proj.category), tooltip.proj.deliverable && /*#__PURE__*/React.createElement("div", {
    className: "text-amber-200/90 mb-0.5"
  }, "\uD83C\uDFAF ", tooltip.proj.deliverable), tooltip.proj.mpSaving && /*#__PURE__*/React.createElement("div", {
    className: "text-emerald-300 font-bold mb-0.5"
  }, "\uD83D\uDCA1 MP \u7BC0\u7701\uFF1A", tooltip.proj.mpSaving), /*#__PURE__*/React.createElement("div", {
    className: "text-slate-300"
  }, "\uD83D\uDCC5 ", tooltip.task.name), /*#__PURE__*/React.createElement("div", {
    className: "text-slate-400"
  }, "W", tooltip.task.start, " \u2013 W", tooltip.task.end, "\uFF08", weekToMonth(tooltip.task.start, months), " ~ ", weekToMonth(tooltip.task.end, months), "\uFF09"), isTaskDeadlineSoon(tooltip.task) && /*#__PURE__*/React.createElement("div", {
    className: "mt-1 text-orange-300 font-bold"
  }, "\u23F0 \u6392\u7A0B\u5373\u5C07\u5230\u671F\uFF1A\u5269 ", tooltip.task.end - todayWeek + 1, " \u9031 \uFF08\u6642\u7A0B\u5DF2\u904E ", Math.round((todayWeek - tooltip.task.start + 1) / (tooltip.task.end - tooltip.task.start + 1) * 100), "%\uFF09"), tooltip.weekLog && /*#__PURE__*/React.createElement("div", {
    className: "mt-2 pt-2 border-t border-slate-700"
  }, /*#__PURE__*/React.createElement("div", {
    className: "font-bold mb-0.5"
  }, STATUS_META[tooltip.weekLog.status]?.icon, " \u672C\u9031 W", currentWeek, "\uFF1A", STATUS_META[tooltip.weekLog.status]?.label, tooltip.weekLog.reporterRole === 'manager' && /*#__PURE__*/React.createElement("span", {
    className: "ml-1 text-yellow-300 text-[11px]"
  }, "\u270F\uFE0F(\u4E3B\u7BA1\u88DC\u767B)")), tooltip.weekLog.note && /*#__PURE__*/React.createElement("div", {
    className: "text-slate-300 whitespace-pre-wrap"
  }, tooltip.weekLog.note)), tooltip.history.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "mt-2 pt-2 border-t border-slate-700 text-slate-400"
  }, "\u6B77\u53F2\u56DE\u5831\uFF1A", tooltip.history.map(([w, l]) => `W${w}${STATUS_META[l.status]?.icon || ''}`).join('　')), /*#__PURE__*/React.createElement("div", {
    className: "mt-1.5 text-[10px] text-slate-500"
  }, "\u9EDE\u64CA\u53EF\u958B\u555F\u8A73\u7D30 / \u56DE\u5831\u8996\u7A97"))), selectedTaskInfo && /*#__PURE__*/React.createElement(TaskModal, {
    info: selectedTaskInfo,
    role: role,
    currentUser: currentUser,
    currentWeek: currentWeek,
    todayWeek: todayWeek,
    weeksTotal: weeksTotal,
    allowRetroCheckin: allowRetroCheckin,
    onClose: () => setSelectedTaskInfo(null),
    onSaveLog: handleSaveLog,
    onUpdateTaskDetails: handleUpdateTaskDetails,
    onDeleteTask: handleDeleteTask,
    onUpdateScore: handleUpdateScore
  }), showExtraNoteModal && /*#__PURE__*/React.createElement(ExtraNoteModal, {
    currentWeek: currentWeek,
    initialNote: extraNotes[noteTargetUser || currentUser]?.[currentWeek] || '',
    readOnly: role !== 'manager' && isViewingPast && !allowRetroCheckin,
    targetUser: noteTargetUser,
    meta: extraNoteMeta[noteTargetUser || currentUser]?.[currentWeek],
    onClose: () => {
      setShowExtraNoteModal(false);
      setNoteTargetUser(null);
    },
    onSave: handleSaveExtraNote
  }), showWeeklyPlanModal && /*#__PURE__*/React.createElement(WeeklyPlanModal, {
    currentWeek: currentWeek,
    initialNote: weeklyPlans[noteTargetUser || currentUser]?.[currentWeek] || '',
    readOnly: role !== 'manager' && isViewingPast && !allowRetroCheckin,
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
        isActiveThisWeek: item.task.start <= currentWeek && item.task.end >= currentWeek,
        weekLog: taskLogs[item.task.id]?.[currentWeek]
      });
    }
  }), showPendingPanel && /*#__PURE__*/React.createElement(PendingPanel, {
    pending: myPendingTasks,
    completed: myCompletedTasks,
    currentWeek: todayWeek,
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
    onSelect: (item, log) => {
      setShowPendingPanel(false);
      setCurrentWeek(todayWeek);
      setSelectedTaskInfo({
        proj: item.proj,
        task: item.task,
        isActiveThisWeek: true,
        weekLog: log
      });
    }
  }), showRetroPanel && role === 'member' && /*#__PURE__*/React.createElement(PendingPanel, {
    retro: true,
    pending: myRetroPendingTasks,
    completed: myRetroCompletedTasks,
    currentWeek: currentWeek,
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
    onSelect: (item, log) => {
      setShowRetroPanel(false);
      setSelectedTaskInfo({
        proj: item.proj,
        task: item.task,
        isActiveThisWeek: true,
        weekLog: log
      });
    }
  }), showWeekEditPanel && role === 'manager' && /*#__PURE__*/React.createElement(ManagerWeekPanel, {
    week: currentWeek,
    todayWeek: todayWeek,
    users: users,
    projects: projects,
    taskLogs: taskLogs,
    extraNotes: extraNotes,
    weeklyPlans: weeklyPlans,
    weeklyComments: weeklyComments,
    extraNoteMeta: extraNoteMeta,
    weeklyPlanMeta: weeklyPlanMeta,
    weeklyCommentMeta: weeklyCommentMeta,
    onClose: () => setShowWeekEditPanel(false),
    onSelectTask: (proj, task, log) => {
      setShowWeekEditPanel(false);
      setSelectedTaskInfo({
        proj,
        task,
        isActiveThisWeek: true,
        weekLog: log
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
  }), showWeeklyReport && /*#__PURE__*/React.createElement(WeeklyReportDashboard, {
    currentWeek: currentWeek,
    year: scheduleYear,
    users: users,
    projects: projects,
    taskLogs: taskLogs,
    extraNotes: extraNotes,
    weeklyPlans: weeklyPlans,
    weeklyComments: weeklyComments,
    extraNoteMeta: extraNoteMeta,
    weeklyPlanMeta: weeklyPlanMeta,
    weeklyCommentMeta: weeklyCommentMeta,
    currentUser: currentUser,
    role: role,
    onEditComment: userName => setCommentTarget(userName),
    onClose: () => setShowWeeklyReport(false)
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
  }), toast && /*#__PURE__*/React.createElement("div", {
    className: `fixed bottom-6 left-1/2 -translate-x-1/2 z-[300] bg-slate-900 text-white text-sm font-bold px-5 py-3 rounded-xl shadow-2xl border flex items-center gap-3 ${toast.isError ? 'border-red-500' : 'border-slate-700 animate-bounce'}`
  }, /*#__PURE__*/React.createElement("span", {
    className: "whitespace-pre-wrap"
  }, toast.msg), toast.action && /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      dismissToast();
      toast.action.onClick();
    },
    className: "flex-shrink-0 bg-amber-500 hover:bg-amber-400 text-slate-900 px-3 py-1 rounded-lg text-xs font-black transition"
  }, "\u21A9 ", toast.action.label), (toast.isError || toast.action) && /*#__PURE__*/React.createElement("button", {
    onClick: dismissToast,
    className: "flex-shrink-0 text-white/50 hover:text-white font-bold px-1",
    title: "\u95DC\u9589"
  }, "\u2715")));
}

// 投影友善:晶片加邊框確保輪廓、標籤文字不再用透明度淡化(投影機對比打折,淡字會消失)
function StatChip({
  label,
  value,
  className
}) {
  return /*#__PURE__*/React.createElement("span", {
    className: `flex-shrink-0 pl-2 pr-2.5 py-1 rounded-full font-bold flex items-center gap-1 border ${className}`
  }, /*#__PURE__*/React.createElement("span", {
    className: "font-medium text-[11px]"
  }, label), /*#__PURE__*/React.createElement("span", {
    className: "text-[13px] leading-none"
  }, value));
}
function LoadingScreen() {
  return /*#__PURE__*/React.createElement("div", {
    className: "flex-1 flex justify-center items-center bg-slate-100 p-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-center"
  }, /*#__PURE__*/React.createElement("div", {
    className: "w-12 h-12 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-4"
  }), /*#__PURE__*/React.createElement("div", {
    className: "text-slate-500 font-bold"
  }, "\u8F09\u5165\u8CC7\u6599\u4E2D\u2026")));
}
function ErrorScreen({
  message,
  onRetry
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "flex-1 flex justify-center items-center bg-slate-100 p-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "bg-white p-10 rounded-2xl shadow-2xl border border-red-200 max-w-md w-full text-center"
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
      backgroundColor: '#001F5B'
    }
  }, "\u91CD\u65B0\u8F09\u5165")));
}

// 瀏覽權限未通過的整頁封鎖畫面(卡控啟用時取代整個 App,不顯示登入與資料)
function AccessDeniedScreen({
  empId,
  reason,
  person
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "min-h-screen flex justify-center items-center bg-slate-100 p-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "bg-white p-10 rounded-2xl shadow-2xl border border-red-200 max-w-md w-full text-center"
  }, /*#__PURE__*/React.createElement("div", {
    className: "w-16 h-16 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center mx-auto mb-4 text-3xl"
  }, "\uD83D\uDEAB"), /*#__PURE__*/React.createElement("h2", {
    className: "text-xl font-black text-slate-800 mb-2"
  }, "\u7121\u6B0A\u9650\u700F\u89BD\u6B64\u9801\u9762"), /*#__PURE__*/React.createElement("p", {
    className: "text-sm text-slate-500 mb-4"
  }, "\u60A8\u7684\u5E33\u865F\u672A\u88AB\u6388\u6B0A\u700F\u89BD MSD \u5C08\u6848\u8FFD\u8E64\u7E3D\u8868\u3002"), /*#__PURE__*/React.createElement("div", {
    className: "text-left text-sm bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4 space-y-1.5"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    className: "text-slate-400 font-bold mr-2"
  }, "\u767B\u5165\u5DE5\u865F"), /*#__PURE__*/React.createElement("span", {
    className: "font-mono font-bold text-slate-800"
  }, empId || '（無法取得）')), person && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    className: "text-slate-400 font-bold mr-2"
  }, "\u4EBA\u54E1\u540D\u518A"), /*#__PURE__*/React.createElement("span", {
    className: "text-slate-700 font-medium"
  }, person.name || '', " ", person.ename ? `(${person.ename})` : '', "\u30FB", person.deptname || [person.dept1, person.dept2, person.dept3].filter(Boolean).join('/') || '無部門資料'))), reason && /*#__PURE__*/React.createElement("div", {
    className: "text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg p-3 mb-5 text-left whitespace-pre-wrap"
  }, reason), /*#__PURE__*/React.createElement("p", {
    className: "text-xs text-slate-400"
  }, "\u82E5\u9700\u8981\u700F\u89BD\u6B0A\u9650\uFF0C\u8ACB\u806F\u7D61\u7CFB\u7D71\u7BA1\u7406\u54E1\uFF08\u4E3B\u7BA1\uFF09\u5C07\u60A8\u7684\u90E8\u9580\u6216\u5DE5\u865F\u52A0\u5165\u5141\u8A31\u6E05\u55AE\u3002")));
}
function LoginScreen({
  onLogin,
  users,
  year,
  empId
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "flex-1 flex justify-center items-center bg-slate-100 p-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "bg-white p-10 rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-center mb-8"
  }, /*#__PURE__*/React.createElement("div", {
    className: "w-16 h-16 text-white rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg text-2xl",
    style: {
      backgroundColor: '#001F5B'
    }
  }, "\uD83D\uDCCA"), /*#__PURE__*/React.createElement("h2", {
    className: "text-2xl font-black text-slate-800"
  }, "MSD \u5C08\u6848\u8FFD\u8E64\u7CFB\u7D71"), /*#__PURE__*/React.createElement("p", {
    className: "text-xs text-slate-400 mt-2"
  }, year, " \u5E74\u5EA6\u5C08\u6848\u6392\u7A0B \xB7 \u9031\u9032\u5EA6\u7BA1\u63A7")), /*#__PURE__*/React.createElement("button", {
    onClick: () => onLogin('管理部主管', 'manager'),
    className: "w-full text-white font-bold py-3.5 rounded-xl mb-6 shadow-md transition hover:opacity-90",
    style: {
      backgroundColor: '#001F5B'
    }
  }, "\uD83D\uDC51 \u4E3B\u7BA1\u767B\u5165\uFF08\u8ABF\u6574\u6392\u7A0B / \u6AA2\u8996\u5168\u9AD4\uFF09"), /*#__PURE__*/React.createElement("div", {
    className: "relative flex py-2 items-center"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex-grow border-t border-slate-200"
  }), /*#__PURE__*/React.createElement("span", {
    className: "flex-shrink-0 mx-4 text-slate-400 text-xs font-bold uppercase tracking-wider"
  }, "\u5718\u968A\u6210\u54E1\u767B\u5165\uFF08\u56DE\u5831\u9032\u5EA6\uFF09"), /*#__PURE__*/React.createElement("div", {
    className: "flex-grow border-t border-slate-200"
  })), /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-3 gap-3 mt-4"
  }, users.map(u => /*#__PURE__*/React.createElement("button", {
    key: u,
    onClick: () => onLogin(u, 'member'),
    className: "bg-white border border-slate-300 hover:border-blue-500 hover:bg-blue-50 py-2.5 rounded-xl font-bold text-slate-700 hover:text-blue-700 transition shadow-sm text-sm"
  }, u))), empId && /*#__PURE__*/React.createElement("div", {
    className: "mt-6 text-center text-[11px] text-slate-400"
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
function TaskModal({
  info,
  role,
  currentUser,
  currentWeek,
  todayWeek,
  weeksTotal = WEEKS_TOTAL,
  allowRetroCheckin,
  onClose,
  onSaveLog,
  onUpdateTaskDetails,
  onDeleteTask,
  onUpdateScore
}) {
  const {
    proj,
    task,
    isActiveThisWeek,
    weekLog
  } = info;
  const isManager = role === 'manager';
  const isMyTask = proj.owner === currentUser;
  const isReportingWeek = currentWeek === todayWeek;
  const canClockIn = isManager && isActiveThisWeek || role === 'member' && isMyTask && isActiveThisWeek && (isReportingWeek || allowRetroCheckin && currentWeek <= todayWeek);
  const score = weekLog ? Number(weekLog.score ?? 1) : 0;
  const [status, setStatus] = useState(weekLog?.status || null);
  const [note, setNote] = useState(weekLog?.note || '');
  const [taskName, setTaskName] = useState(task.name);
  const [startWeek, setStartWeek] = useState(task.start);
  const [endWeek, setEndWeek] = useState(task.end);
  const [saving, setSaving] = useState(false); // 防連點:送出中鎖定按鈕
  useModalDirtyReset();
  const [scheduleError, setScheduleError] = useState('');
  const [noteError, setNoteError] = useState('');
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
    setSaving(true);
    try {
      await onSaveLog(task.id, status, note.trim());
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
    setSaving(true);
    try {
      await onUpdateTaskDetails(proj.id, task.id, taskName.trim(), s, e);
    } finally {
      setSaving(false);
    }
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex justify-center items-center p-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden max-h-[90vh] overflow-y-auto",
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("div", {
    className: "px-6 py-4 text-white flex justify-between items-start",
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
  }, proj.name)), /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    className: "text-white/60 hover:text-white flex-shrink-0"
  }, /*#__PURE__*/React.createElement("svg", {
    className: "w-6 h-6",
    fill: "none",
    viewBox: "0 0 24 24",
    stroke: "currentColor"
  }, /*#__PURE__*/React.createElement("path", {
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 2,
    d: "M6 18L18 6M6 6l12 12"
  })))), /*#__PURE__*/React.createElement("div", {
    className: "p-6 space-y-6"
  }, /*#__PURE__*/React.createElement("div", {
    className: "bg-slate-50 p-4 rounded-xl border border-slate-200"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex justify-between items-center mb-3"
  }, /*#__PURE__*/React.createElement("label", {
    className: "text-sm font-bold text-slate-800"
  }, "\u5C08\u6848\u6392\u7A0B\u8207\u9810\u8A08\u4E8B\u9805"), isManager && /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] bg-yellow-200 text-yellow-800 px-2 py-0.5 rounded font-bold"
  }, "\u4E3B\u7BA1\u53EF\u7DE8\u8F2F")), /*#__PURE__*/React.createElement("input", {
    type: "text",
    value: taskName,
    onChange: e => {
      setTaskName(e.target.value);
      setScheduleError('');
      markModalDirty();
    },
    disabled: !isManager,
    className: "w-full border border-slate-300 rounded-md p-2 text-sm mb-3 text-center disabled:bg-slate-100 disabled:text-slate-500 outline-none focus:border-blue-500"
  }), /*#__PURE__*/React.createElement("div", {
    className: "flex space-x-3 items-center"
  }, /*#__PURE__*/React.createElement("div", {
    className: "w-1/2"
  }, /*#__PURE__*/React.createElement("label", {
    className: "text-[10px] text-slate-400 font-bold"
  }, "\u958B\u59CB\u9031"), /*#__PURE__*/React.createElement("input", {
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
    className: "w-full border border-slate-300 rounded-md p-2 text-sm disabled:bg-slate-100 disabled:text-slate-500 outline-none focus:border-blue-500"
  })), /*#__PURE__*/React.createElement("div", {
    className: "w-1/2"
  }, /*#__PURE__*/React.createElement("label", {
    className: "text-[10px] text-slate-400 font-bold"
  }, "\u7D50\u675F\u9031"), /*#__PURE__*/React.createElement("input", {
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
    className: "w-full border border-slate-300 rounded-md p-2 text-sm disabled:bg-slate-100 disabled:text-slate-500 outline-none focus:border-blue-500"
  }))), scheduleError && /*#__PURE__*/React.createElement("div", {
    className: "mt-2 text-xs text-red-600 font-bold"
  }, scheduleError), isManager && /*#__PURE__*/React.createElement("div", {
    className: "mt-3 flex gap-2"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: submitSchedule,
    disabled: saving,
    className: "flex-1 text-white px-4 py-1.5 rounded text-sm font-bold transition hover:opacity-90 disabled:opacity-50",
    style: {
      backgroundColor: '#001F5B'
    }
  }, saving ? '儲存中…' : '儲存排程'), /*#__PURE__*/React.createElement("button", {
    onClick: () => onDeleteTask(proj, task),
    className: "flex-shrink-0 px-3 py-1.5 rounded text-sm font-bold text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 transition",
    title: "\u522A\u9664\u6B64\u8A08\u756B\u5340\u9593\uFF08\u8EDF\u522A\u9664\uFF0C\u53EF\u7531\u8CC7\u6599\u5EAB\u9084\u539F\uFF09"
  }, "\uD83D\uDDD1 \u522A\u9664\u5340\u9593"))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h4", {
    className: "text-sm font-bold text-slate-800 mb-3 flex items-center"
  }, "W", String(currentWeek).padStart(2, '0'), " \u5BE6\u969B\u57F7\u884C\u56DE\u5831", isActiveThisWeek && /*#__PURE__*/React.createElement("span", {
    className: `ml-2 px-2 py-0.5 rounded-full text-[11px] font-bold ${weekLog ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-200 text-slate-500'}`,
    title: "\u56DE\u5831\u6210\u529F\u9810\u8A2D 1 \u5206,\u672A\u56DE\u5831 0 \u5206;\u4E3B\u7BA1\u53EF\u4F9D\u8868\u73FE\u8ABF\u6574"
  }, "\uD83C\uDFC6 ", score, " \u5206")), weekLog?.updatedAt && /*#__PURE__*/React.createElement("div", {
    className: "text-[11px] text-slate-500 mb-2 flex items-center gap-1.5"
  }, /*#__PURE__*/React.createElement("span", null, "\uD83D\uDD58 \u6700\u5F8C\u7DE8\u8F2F\uFF1A", weekLog.updatedAt), weekLog.reporter && /*#__PURE__*/React.createElement("span", {
    className: "text-slate-400"
  }, "by ", weekLog.reporter), weekLog.reporterRole === 'manager' && /*#__PURE__*/React.createElement("span", {
    className: "px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 font-bold text-[10px]",
    title: "\u6B64\u7B46\u7531\u4E3B\u7BA1\u4EE3\u70BA\u4FEE\u6B63/\u88DC\u767B"
  }, "\u270F\uFE0F \u4E3B\u7BA1\u4FEE\u6B63")), canClockIn ? /*#__PURE__*/React.createElement("div", {
    className: `p-4 rounded-xl border transition-colors ${status && status !== 'not_executed' ? 'bg-blue-50 border-blue-200' : 'bg-slate-50 border-slate-200'}`
  }, isManager && !isMyTask && /*#__PURE__*/React.createElement("div", {
    className: "mb-3 bg-amber-100 border border-amber-400 text-amber-900 rounded-lg px-3.5 py-2.5 text-xs font-bold flex items-center"
  }, /*#__PURE__*/React.createElement("span", {
    className: "mr-2 text-sm"
  }, "\uD83D\uDC51"), /*#__PURE__*/React.createElement("span", null, "\u4E3B\u7BA1\u7279\u6B0A\u6A21\u5F0F\uFF1A\u6B63\u5728\u70BA\u6210\u54E1\u6838\u5BE6\u6216\u8ABF\u88DC W", String(currentWeek).padStart(2, '0'), " \u57F7\u884C\u7D00\u9304")), /*#__PURE__*/React.createElement("div", {
    className: "mb-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "font-bold text-slate-800 text-sm"
  }, "\u672C\u9031\u6B64\u4EFB\u52D9\u7684\u57F7\u884C\u72C0\u614B"), /*#__PURE__*/React.createElement("div", {
    className: "text-xs text-slate-500 mt-0.5"
  }, "\u56DE\u5831\u5F8C\u6703\u5728\u8A72\u9031\u7518\u7279\u689D\u6A19\u793A\u5C0D\u61C9\u984F\u8272\uFF08\u6709\u57F7\u884C=\u7DA0\u3001Monitor=\u85CD\u3001\u672A\u57F7\u884C=\u7070\uFF09\u3002Monitor \u70BA\u4F8B\u884C\u76E3\u63A7\u5DE5\u4F5C\uFF0C\u53EF\u4E0D\u586B\u8AAA\u660E\u3002"), /*#__PURE__*/React.createElement("div", {
    className: "text-xs text-indigo-600 mt-1 font-bold"
  }, "\uD83C\uDFC6 \u5B8C\u6210\u56DE\u5831\u9810\u8A2D\u7372\u5F97 1 \u5206\uFF08\u672A\u56DE\u5831\u70BA 0 \u5206\uFF09\uFF0C\u4E3B\u7BA1\u53EF\u4F9D\u8868\u73FE\u8ABF\u6574\u5206\u6578\u3002")), /*#__PURE__*/React.createElement("div", {
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
    className: `py-3 rounded-lg border text-sm font-bold transition ${status === key ? meta.tag + ' ring-2 ring-offset-1 ring-slate-300' : 'bg-white text-slate-400 border-slate-200 hover:border-slate-400'}`
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
  }, noteError)), /*#__PURE__*/React.createElement("div", {
    className: "flex justify-end space-x-3 pt-4"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    className: "px-4 py-2 text-sm text-slate-500 bg-white border border-slate-300 rounded-lg font-bold hover:bg-slate-50"
  }, "\u53D6\u6D88"), /*#__PURE__*/React.createElement("button", {
    onClick: submitLog,
    disabled: saving,
    className: "px-6 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold rounded-lg shadow-md"
  }, saving ? '儲存中…' : '儲存進度回報')), isManager && weekLog && /*#__PURE__*/React.createElement("div", {
    className: "mt-4 pt-3 border-t border-slate-200"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-bold text-slate-500 mb-2"
  }, "\u4E3B\u7BA1\u8A55\u5206\u5FAE\u8ABF\uFF08\u9EDE\u64CA\u5373\u6642\u66F4\u65B0\u5206\u6578\uFF09"), /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-5 gap-1.5"
  }, SCORE_OPTIONS.map(o => /*#__PURE__*/React.createElement("button", {
    key: o.value,
    onClick: () => onUpdateScore(task.id, o.value),
    className: `px-1 py-2 rounded-lg border text-center transition ${score === o.value ? 'bg-indigo-600 text-white border-indigo-700 ring-2 ring-offset-1 ring-indigo-300' : 'bg-white text-slate-600 border-slate-300 hover:border-indigo-400 hover:bg-indigo-50'}`
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-[11px] font-bold leading-tight"
  }, o.label), /*#__PURE__*/React.createElement("div", {
    className: `text-[10px] mt-0.5 ${score === o.value ? 'text-indigo-100' : 'text-slate-400'}`
  }, o.value, " \u5206")))))) : /*#__PURE__*/React.createElement("div", {
    className: "bg-slate-50 border border-slate-200 p-4 rounded-xl text-sm"
  }, role === 'member' && isMyTask && isActiveThisWeek && !isReportingWeek && /*#__PURE__*/React.createElement("div", {
    className: "mb-3 bg-yellow-50 border border-yellow-300 text-yellow-800 rounded-lg px-3 py-2 text-xs font-bold"
  }, "\uD83D\uDD12 \u552F\u8B80\u6AA2\u8996\uFF1A\u50C5\u80FD\u56DE\u5831\u672C\u9031 W", String(todayWeek).padStart(2, '0'), " \u7684\u9032\u5EA6\uFF0C\u6B77\u53F2\u9031\u6B21\u53EA\u80FD\u700F\u89BD\u3002"), !isActiveThisWeek ? /*#__PURE__*/React.createElement("div", {
    className: "text-slate-500 text-center py-2"
  }, "\u6B64\u4EFB\u52D9\u6392\u5B9A\u65BC W", task.start, "\u2013W", task.end, "\uFF0C\u975E W", String(currentWeek).padStart(2, '0'), " \u6392\u5B9A\u9805\u76EE\u3002") : weekLog ? /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "mb-2 flex items-center flex-wrap gap-y-1"
  }, /*#__PURE__*/React.createElement("span", {
    className: "font-bold mr-2"
  }, "\u72C0\u614B\uFF1A"), /*#__PURE__*/React.createElement("span", {
    className: `px-2 py-0.5 rounded text-xs font-bold ${STATUS_META[weekLog.status]?.tag}`
  }, STATUS_META[weekLog.status]?.icon, " ", STATUS_META[weekLog.status]?.label), /*#__PURE__*/React.createElement("span", {
    className: "ml-2 px-2 py-0.5 rounded-full text-xs font-bold bg-indigo-100 text-indigo-700",
    title: "\u56DE\u5831\u6210\u529F\u9810\u8A2D 1 \u5206,\u4E3B\u7BA1\u53EF\u8ABF\u6574"
  }, "\uD83C\uDFC6 ", score, " \u5206")), /*#__PURE__*/React.createElement("div", {
    className: "font-bold mb-1"
  }, "\u5DE5\u4F5C\u8AAA\u660E\uFF1A"), /*#__PURE__*/React.createElement("div", {
    className: "bg-white p-3 rounded border border-slate-200 text-slate-700 whitespace-pre-wrap"
  }, weekLog.note || '（未填寫備註）'), isManager && /*#__PURE__*/React.createElement("div", {
    className: "mt-3 pt-3 border-t border-slate-200"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-bold text-slate-500 mb-2"
  }, "\u4E3B\u7BA1\u8A55\u5206\uFF08\u9EDE\u64CA\u5373\u4FEE\u6539\u6B64\u9031\u5206\u6578\uFF09"), /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-5 gap-1.5"
  }, SCORE_OPTIONS.map(o => /*#__PURE__*/React.createElement("button", {
    key: o.value,
    onClick: () => onUpdateScore(task.id, o.value),
    className: `px-1 py-2 rounded-lg border text-center transition ${score === o.value ? 'bg-indigo-600 text-white border-indigo-700 ring-2 ring-offset-1 ring-indigo-300' : 'bg-white text-slate-600 border-slate-300 hover:border-indigo-400 hover:bg-indigo-50'}`
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-[11px] font-bold leading-tight"
  }, o.label), /*#__PURE__*/React.createElement("div", {
    className: `text-[10px] mt-0.5 ${score === o.value ? 'text-indigo-100' : 'text-slate-400'}`
  }, o.value, " \u5206")))))) : /*#__PURE__*/React.createElement("div", {
    className: "text-slate-500 text-center py-2"
  }, "\uD83D\uDCCC W", String(currentWeek).padStart(2, '0'), " \u672A\u56DE\u5831\u6B64\u9805\u76EE\uFF08\u7DAD\u6301\u8A08\u756B\u4E2D\uFF0C\uD83C\uDFC6 0 \u5206\uFF09\u3002"))))));
}
function ExtraNoteModal({
  currentWeek,
  initialNote,
  readOnly,
  targetUser,
  meta,
  onClose,
  onSave
}) {
  const [note, setNote] = useState(initialNote);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useModalDirtyReset();
  // 非專案事項為「選填」:允許空白儲存(=清空本週內容),不強迫填字
  const isClearing = !note.trim() && !!initialNote;
  const submit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onSave(note.trim());
    } finally {
      setSaving(false);
    }
  };
  if (readOnly) {
    return /*#__PURE__*/React.createElement("div", {
      className: "fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[110] flex justify-center items-center p-4"
    }, /*#__PURE__*/React.createElement("div", {
      className: "bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden",
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
    }, "\uD83D\uDD12 W", currentWeek, " \u975E\u5C08\u6848\u5DE5\u4F5C\uFF08\u552F\u8B80\uFF09"), /*#__PURE__*/React.createElement("button", {
      onClick: onClose,
      className: "text-white/60 hover:text-white"
    }, /*#__PURE__*/React.createElement("svg", {
      className: "w-6 h-6",
      fill: "none",
      viewBox: "0 0 24 24",
      stroke: "currentColor"
    }, /*#__PURE__*/React.createElement("path", {
      strokeLinecap: "round",
      strokeLinejoin: "round",
      strokeWidth: 2,
      d: "M6 18L18 6M6 6l12 12"
    })))), /*#__PURE__*/React.createElement("div", {
      className: "p-6"
    }, /*#__PURE__*/React.createElement("p", {
      className: "text-xs text-slate-400 mb-3"
    }, "\u6B77\u53F2\u9031\u6B21\u50C5\u4F9B\u700F\u89BD\uFF0C\u7121\u6CD5\u4FEE\u6539\u3002"), initialNote ? /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      className: "text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-4 whitespace-pre-wrap"
    }, initialNote), /*#__PURE__*/React.createElement(MetaLine, {
      meta: meta
    })) : /*#__PURE__*/React.createElement("div", {
      className: "text-sm text-slate-400 italic text-center py-6"
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
    React.createElement("div", {
      className: "fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[110] flex justify-center items-center p-4"
    }, /*#__PURE__*/React.createElement("div", {
      className: "bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden",
      onClick: e => e.stopPropagation()
    }, /*#__PURE__*/React.createElement("div", {
      className: "px-6 py-4 text-white flex justify-between items-center",
      style: {
        backgroundColor: '#F97316'
      }
    }, /*#__PURE__*/React.createElement("h3", {
      className: "font-bold text-lg flex items-center",
      style: {
        color: '#FFFFFF'
      }
    }, "\uD83D\uDCDD \u586B\u5BEB W", currentWeek, " \u975E\u5C08\u6848\u5DE5\u4F5C", targetUser ? `（${targetUser}）` : ''), /*#__PURE__*/React.createElement("button", {
      onClick: onClose,
      className: "text-white/60 hover:text-white"
    }, /*#__PURE__*/React.createElement("svg", {
      className: "w-6 h-6",
      fill: "none",
      viewBox: "0 0 24 24",
      stroke: "currentColor"
    }, /*#__PURE__*/React.createElement("path", {
      strokeLinecap: "round",
      strokeLinejoin: "round",
      strokeWidth: 2,
      d: "M6 18L18 6M6 6l12 12"
    })))), /*#__PURE__*/React.createElement("div", {
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
      className: "block mt-1 text-slate-400"
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
  return /*#__PURE__*/React.createElement("div", {
    className: "fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[130] flex justify-center items-center p-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden",
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("div", {
    className: "px-6 py-4 text-white flex justify-between items-start",
    style: {
      backgroundColor: '#F59E0B'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "pr-3"
  }, /*#__PURE__*/React.createElement("h3", {
    className: "font-bold text-lg",
    style: {
      color: '#FFFFFF'
    }
  }, "\uD83C\uDFAF \u5177\u9AD4\u7522\u51FA\u8207 MP \u6548\u76CA"), /*#__PURE__*/React.createElement("p", {
    className: "text-xs mt-0.5 truncate max-w-[360px]",
    style: {
      color: '#FEF3C7'
    }
  }, proj.name, "\uFF08\u8CA0\u8CAC\u4EBA\uFF1A", proj.owner, "\uFF09")), /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    className: "text-white/70 hover:text-white flex-shrink-0"
  }, /*#__PURE__*/React.createElement("svg", {
    className: "w-6 h-6",
    fill: "none",
    viewBox: "0 0 24 24",
    stroke: "currentColor"
  }, /*#__PURE__*/React.createElement("path", {
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 2,
    d: "M6 18L18 6M6 6l12 12"
  })))), /*#__PURE__*/React.createElement("div", {
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
    className: "text-slate-400 italic"
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
function WeeklyPlanModal({
  currentWeek,
  initialNote,
  readOnly,
  targetUser,
  meta,
  onClose,
  onSave
}) {
  const [note, setNote] = useState(initialNote);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useModalDirtyReset();
  // 允許清空:清空後系統將其復原為「必填尚未填寫」(扣回打卡 1 分)，待重新填寫送出後再計分
  const isClearing = !note.trim() && !!initialNote;
  const submit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onSave(note.trim());
    } finally {
      setSaving(false);
    }
  };
  if (readOnly) {
    return /*#__PURE__*/React.createElement("div", {
      className: "fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[110] flex justify-center items-center p-4"
    }, /*#__PURE__*/React.createElement("div", {
      className: "bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden",
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
    }, "\uD83D\uDD12 W", currentWeek, " \u4E0B\u9031\u9810\u8A08\u5DE5\u4F5C\uFF08\u552F\u8B80\uFF09"), /*#__PURE__*/React.createElement("button", {
      onClick: onClose,
      className: "text-white/60 hover:text-white"
    }, /*#__PURE__*/React.createElement("svg", {
      className: "w-6 h-6",
      fill: "none",
      viewBox: "0 0 24 24",
      stroke: "currentColor"
    }, /*#__PURE__*/React.createElement("path", {
      strokeLinecap: "round",
      strokeLinejoin: "round",
      strokeWidth: 2,
      d: "M6 18L18 6M6 6l12 12"
    })))), /*#__PURE__*/React.createElement("div", {
      className: "p-6"
    }, /*#__PURE__*/React.createElement("p", {
      className: "text-xs text-slate-400 mb-3"
    }, "\u6B77\u53F2\u9031\u6B21\u50C5\u4F9B\u700F\u89BD\uFF0C\u7121\u6CD5\u4FEE\u6539\u3002"), initialNote ? /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      className: "text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-4 whitespace-pre-wrap"
    }, initialNote), /*#__PURE__*/React.createElement(MetaLine, {
      meta: meta
    })) : /*#__PURE__*/React.createElement("div", {
      className: "text-sm text-slate-400 italic text-center py-6"
    }, "\u8A72\u9031\u672A\u586B\u5BEB\u4E0B\u9031\u9810\u8A08\u5DE5\u4F5C"), /*#__PURE__*/React.createElement("div", {
      className: "flex justify-end pt-4"
    }, /*#__PURE__*/React.createElement("button", {
      onClick: onClose,
      className: "px-6 py-2 text-sm bg-slate-600 hover:bg-slate-700 text-white font-bold rounded-lg"
    }, "\u95DC\u9589")))));
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[110] flex justify-center items-center p-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden",
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
  }, "\uD83D\uDCC5 \u586B\u5BEB W", currentWeek, " \u4E0B\u9031\u9810\u8A08\u57F7\u884C\u5DE5\u4F5C", targetUser ? `（${targetUser}）` : ''), /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    className: "text-white/60 hover:text-white"
  }, /*#__PURE__*/React.createElement("svg", {
    className: "w-6 h-6",
    fill: "none",
    viewBox: "0 0 24 24",
    stroke: "currentColor"
  }, /*#__PURE__*/React.createElement("path", {
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 2,
    d: "M6 18L18 6M6 6l12 12"
  })))), /*#__PURE__*/React.createElement("div", {
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
  }, "\u8ACB\u586B\u5BEB\u4E0B\u4E00\u9031\uFF08W", String(Math.min(currentWeek + 1, 53)).padStart(2, '0'), "\uFF09\u9810\u8A08\u9032\u884C\u7684\u5DE5\u4F5C\u5B89\u6392\uFF1B\u96A8\u6642\u53EF\u6E05\u7A7A\u5167\u5BB9\u5F8C\u9001\u51FA\uFF08\u6E05\u7A7A\u5F8C\u5C07\u6062\u5FA9\u70BA\u672A\u586B\u5BEB\uFF0C\u6709\u586B\u5BEB\u624D\u7B97\u6709\u6253\u5361\u5F97 1 \u5206\uFF09\u3002"), /*#__PURE__*/React.createElement("textarea", {
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
  return /*#__PURE__*/React.createElement("div", {
    className: "fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[105] flex justify-end"
  }, /*#__PURE__*/React.createElement("div", {
    className: "w-full max-w-sm bg-white h-full shadow-2xl flex flex-col",
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("div", {
    className: "px-5 py-4 text-white flex justify-between items-center",
    style: {
      backgroundColor: '#EA580C'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h3", {
    className: "font-bold text-lg",
    style: {
      color: '#FFFFFF'
    }
  }, "\u23F0 \u5373\u5C07\u5230\u671F\u6E05\u55AE"), /*#__PURE__*/React.createElement("p", {
    className: "text-xs mt-0.5",
    style: {
      color: '#FFEDD5'
    }
  }, "\u5269\u9918 \u22642 \u9031\u6216\u6642\u7A0B\u5DF2\u904E 70% \u7684\u8A08\u756B\u5340\u9593")), /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    className: "text-white/70 hover:text-white p-1"
  }, /*#__PURE__*/React.createElement("svg", {
    className: "w-6 h-6",
    fill: "none",
    viewBox: "0 0 24 24",
    stroke: "currentColor"
  }, /*#__PURE__*/React.createElement("path", {
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 2,
    d: "M6 18L18 6M6 6l12 12"
  })))), /*#__PURE__*/React.createElement("div", {
    className: "flex-1 overflow-y-auto p-4 space-y-2.5"
  }, items.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "text-center text-slate-400 py-16"
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
    className: "text-xs font-bold text-slate-700 truncate"
  }, proj.name), /*#__PURE__*/React.createElement("div", {
    className: "text-sm text-slate-600 mt-0.5 truncate"
  }, task.name), /*#__PURE__*/React.createElement("div", {
    className: "text-[10px] text-slate-400 mt-1"
  }, "\uD83D\uDC64 ", proj.owner, " \xB7 \u6392\u7A0B W", task.start, "\u2013W", task.end)), /*#__PURE__*/React.createElement("div", {
    className: "flex-shrink-0 text-right"
  }, /*#__PURE__*/React.createElement("div", {
    className: `font-bold text-sm ${remain <= 1 ? 'text-red-600' : 'text-orange-600'}`
  }, "\u5269 ", remain, " \u9031"), /*#__PURE__*/React.createElement("div", {
    className: "text-[10px] text-slate-400 mt-0.5"
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
  const totalRequired = pending.length + completed.length + 1; // 任務總數 + 1項下週預計
  const completedCount = completed.length + (planPending ? 0 : 1);
  const percent = totalRequired > 0 ? Math.round(completedCount / totalRequired * 100) : 100;
  const allDone = pending.length === 0 && !planPending;
  const wkLabel = retro ? `W${String(currentWeek).padStart(2, '0')}` : '本週'; // 補登模式所有文案以週次取代「本週」

  return /*#__PURE__*/React.createElement("div", {
    className: "fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[105] flex justify-end"
  }, /*#__PURE__*/React.createElement("div", {
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
  }, retro ? '主管已開放補登：可修改此週任務打卡、非專案事項與下週預計工作' : '整合本週排定任務打卡 ＋ 每週必填工作預計')), /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    className: "text-white/60 hover:text-white p-1"
  }, /*#__PURE__*/React.createElement("svg", {
    className: "w-6 h-6",
    fill: "none",
    viewBox: "0 0 24 24",
    stroke: "currentColor"
  }, /*#__PURE__*/React.createElement("path", {
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 2,
    d: "M6 18L18 6M6 6l12 12"
  })))), /*#__PURE__*/React.createElement("div", {
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
    task
  }) => /*#__PURE__*/React.createElement("button", {
    key: task.id,
    onClick: () => onSelect({
      proj,
      task
    }, undefined),
    className: "w-full text-left bg-yellow-50 hover:bg-yellow-100 border border-yellow-300 rounded-xl p-3.5 transition group shadow-sm"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between"
  }, /*#__PURE__*/React.createElement("div", {
    className: "min-w-0 pr-2"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-bold text-amber-900 truncate"
  }, proj.name), /*#__PURE__*/React.createElement("div", {
    className: "text-sm font-black text-slate-800 mt-0.5 truncate"
  }, task.name), /*#__PURE__*/React.createElement("div", {
    className: "text-[10px] text-slate-500 mt-1"
  }, "\u6392\u7A0B W", task.start, "\u2013W", task.end, " \xB7 ", proj.category)), /*#__PURE__*/React.createElement("div", {
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
  }, "\u8ACB\u5B89\u6392 W", String(Math.min(currentWeek + 1, 53)).padStart(2, '0'), " \u9031\u9810\u8A08\u9032\u884C\u7684\u5DE5\u4F5C\u5167\u5BB9"), !planPending && /*#__PURE__*/React.createElement(MetaLine, {
    meta: planMeta,
    className: "text-[10px] text-slate-400 mt-0.5"
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
    className: "text-[10px] text-slate-400 mt-0.5"
  })), /*#__PURE__*/React.createElement("div", {
    className: `flex-shrink-0 font-bold text-xs bg-white border rounded-full px-3 py-1.5 transition ${extraFilled ? 'text-emerald-600 border-emerald-300 group-hover:bg-emerald-600 group-hover:text-white' : 'text-orange-600 border-orange-300 group-hover:bg-orange-600 group-hover:text-white'}`
  }, extraFilled ? '檢閱修改 ›' : '前往填寫 ›')))), completed.length > 0 && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-black text-slate-400 uppercase tracking-wider mb-2"
  }, "\uD83D\uDFE2 ", wkLabel, "\u5DF2\u5B8C\u6210\u6253\u5361\u4EFB\u52D9 (", completed.length, " \u9805)"), /*#__PURE__*/React.createElement("div", {
    className: "space-y-2"
  }, completed.map(({
    proj,
    task,
    log
  }) => /*#__PURE__*/React.createElement("button", {
    key: task.id,
    onClick: () => onSelect({
      proj,
      task
    }, log),
    className: "w-full text-left bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl p-3 transition group opacity-90"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between"
  }, /*#__PURE__*/React.createElement("div", {
    className: "min-w-0 pr-2"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-1.5"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-xs font-bold text-slate-600 truncate"
  }, proj.name), /*#__PURE__*/React.createElement("span", {
    className: `px-1.5 py-0.5 rounded text-[10px] font-bold ${log.status === 'executed' ? 'bg-green-100 text-green-800' : log.status === 'monitor' ? 'bg-sky-100 text-sky-800' : 'bg-slate-200 text-slate-700'}`
  }, STATUS_META[log.status]?.icon, " ", STATUS_META[log.status]?.label)), /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-medium text-slate-700 mt-1 truncate"
  }, task.name), log.updatedAt && /*#__PURE__*/React.createElement("div", {
    className: "text-[10px] text-slate-400 mt-0.5"
  }, "\uD83D\uDD58 \u6700\u5F8C\u7DE8\u8F2F ", log.updatedAt, log.reporterRole === 'manager' ? '・✏️ 主管修正' : '')), /*#__PURE__*/React.createElement("div", {
    className: "flex-shrink-0 text-slate-500 font-bold text-xs bg-white border border-slate-200 rounded-full px-2.5 py-1 group-hover:border-slate-400 transition"
  }, "\u4FEE\u6539 \u203A"))))))), /*#__PURE__*/React.createElement("div", {
    className: "p-4 bg-slate-50 border-t border-slate-200"
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
function ManagerWeekPanel({
  week,
  todayWeek,
  users = [],
  projects,
  taskLogs,
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
  const [member, setMember] = useState(users[0] || '');
  const wk = String(week).padStart(2, '0');
  const rows = [];
  projects.filter(p => p.owner === member).forEach(p => p.tasks.forEach(t => {
    if (t.start <= week && t.end >= week) rows.push({
      proj: p,
      task: t,
      log: taskLogs[t.id]?.[week]
    });
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
    className: "text-xs text-slate-400 italic mt-1"
  }, emptyText), value && /*#__PURE__*/React.createElement(MetaLine, {
    meta: meta,
    showManagerTag: showManagerTag,
    className: "text-[10px] text-slate-400 mt-0.5"
  })), /*#__PURE__*/React.createElement("div", {
    className: "flex-shrink-0 text-slate-600 font-bold text-xs bg-white border border-slate-300 rounded-full px-3 py-1.5 group-hover:bg-slate-700 group-hover:text-white transition"
  }, "\u7DE8\u8F2F \u203A")));
  return /*#__PURE__*/React.createElement("div", {
    className: "fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[105] flex justify-end"
  }, /*#__PURE__*/React.createElement("div", {
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
  }, "\u4EE3\u6210\u54E1\u88DC\u767B/\u4FEE\u6B63\u6B64\u9031\u56DE\u5831\uFF0C\u7570\u52D5\u6703\u6A19\u8A18\u4E3B\u7BA1\u4FEE\u6B63\u4E26\u7559\u4E0B\u7A3D\u6838\u7D00\u9304")), /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    className: "text-white/60 hover:text-white p-1"
  }, /*#__PURE__*/React.createElement("svg", {
    className: "w-6 h-6",
    fill: "none",
    viewBox: "0 0 24 24",
    stroke: "currentColor"
  }, /*#__PURE__*/React.createElement("path", {
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 2,
    d: "M6 18L18 6M6 6l12 12"
  })))), /*#__PURE__*/React.createElement("div", {
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
  }, u))), week !== todayWeek && /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] font-bold bg-amber-300 text-amber-900 px-2 py-1 rounded-full whitespace-nowrap"
  }, "\u6B77\u53F2\u9031\u6B21"))), /*#__PURE__*/React.createElement("div", {
    className: "flex-1 overflow-y-auto p-5 space-y-5"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-black text-slate-500 uppercase tracking-wider mb-2"
  }, "\uD83D\uDCCC W", wk, " \u6392\u5B9A\u4EFB\u52D9\u6253\u5361 (", rows.length, " \u9805)"), rows.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "bg-slate-50 border border-slate-200 rounded-xl p-4 text-center text-slate-400 text-xs italic"
  }, "\u6B64\u9031\u7121\u6392\u5B9A\u4EFB\u52D9") : /*#__PURE__*/React.createElement("div", {
    className: "space-y-2.5"
  }, rows.map(({
    proj,
    task,
    log
  }) => /*#__PURE__*/React.createElement("button", {
    key: task.id,
    onClick: () => onSelectTask(proj, task, log),
    className: `w-full text-left border rounded-xl p-3 transition group shadow-sm ${log ? 'bg-slate-50 hover:bg-slate-100 border-slate-200' : 'bg-yellow-50 hover:bg-yellow-100 border-yellow-300'}`
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between"
  }, /*#__PURE__*/React.createElement("div", {
    className: "min-w-0 pr-2"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-1.5"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-xs font-bold text-slate-700 truncate"
  }, proj.name), log ? /*#__PURE__*/React.createElement("span", {
    className: `flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold ${log.status === 'executed' ? 'bg-green-100 text-green-800' : log.status === 'monitor' ? 'bg-sky-100 text-sky-800' : 'bg-slate-200 text-slate-700'}`
  }, STATUS_META[log.status]?.icon, " ", STATUS_META[log.status]?.label) : /*#__PURE__*/React.createElement("span", {
    className: "flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700 border border-red-300"
  }, "\u2757\u672A\u56DE\u5831"), log?.reporterRole === 'manager' && /*#__PURE__*/React.createElement("span", {
    className: "flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300",
    title: "\u6B64\u7B46\u7531\u4E3B\u7BA1\u4EE3\u70BA\u4FEE\u6B63/\u88DC\u767B"
  }, "\u270F\uFE0F\u4E3B\u7BA1")), /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-medium text-slate-700 mt-1 truncate"
  }, task.name), log?.updatedAt && /*#__PURE__*/React.createElement("div", {
    className: "text-[10px] text-slate-400 mt-0.5"
  }, "\uD83D\uDD58 \u6700\u5F8C\u7DE8\u8F2F ", log.updatedAt, log.reporter ? `（${log.reporter}）` : '')), /*#__PURE__*/React.createElement("div", {
    className: "flex-shrink-0 text-slate-600 font-bold text-xs bg-white border border-slate-300 rounded-full px-2.5 py-1 group-hover:bg-slate-700 group-hover:text-white transition"
  }, log ? '修改 ›' : '補登 ›')))))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-black text-slate-500 uppercase tracking-wider mb-2"
  }, "\uD83D\uDCDD \u6BCF\u9031\u56DE\u5831\u5167\u5BB9\uFF08\u4EE3 ", member, " \u4FEE\u6B63\uFF09"), /*#__PURE__*/React.createElement("div", {
    className: "space-y-2.5"
  }, editRow('📝', '非專案事項', extra, '未填寫（可代為補登）', 'bg-orange-50/70 hover:bg-orange-100/70 border-orange-200', () => onEditExtra(member), extraMeta), editRow('📅', '下週預計執行工作', plan, '未填寫（可代為補登）', 'bg-indigo-50/70 hover:bg-indigo-100/70 border-indigo-200', () => onEditPlan(member), planMeta))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-black text-slate-500 uppercase tracking-wider mb-2"
  }, "\uD83D\uDC51 \u4E3B\u7BA1\u56DE\u8986\uFF08\u6210\u54E1\u4E0D\u53EF\u7570\u52D5\uFF09"), editRow('💬', `對 ${member} 的 W${wk} 週報回覆`, comment, '尚未回覆（選填）', 'bg-violet-50/70 hover:bg-violet-100/70 border-violet-200', () => onEditComment(member), commentMeta, false))), /*#__PURE__*/React.createElement("div", {
    className: "p-4 bg-slate-50 border-t border-slate-200"
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
  return /*#__PURE__*/React.createElement("div", {
    className: "fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[140] flex justify-center items-center p-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden",
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
  }, "\u4E3B\u7BA1\u5EFA\u8B70(\u9078\u586B)\uFF0C\u5132\u5B58\u5F8C\u5168\u9AD4\u6210\u54E1\u65BC\u5718\u968A\u7E3D\u7D50\u770B\u677F\u53EF\u898B")), /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    className: "text-white/60 hover:text-white"
  }, /*#__PURE__*/React.createElement("svg", {
    className: "w-6 h-6",
    fill: "none",
    viewBox: "0 0 24 24",
    stroke: "currentColor"
  }, /*#__PURE__*/React.createElement("path", {
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 2,
    d: "M6 18L18 6M6 6l12 12"
  })))), /*#__PURE__*/React.createElement("div", {
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
    className: "mb-4 bg-slate-50 border border-slate-300 text-slate-600 rounded-lg px-3 py-2.5 text-sm font-bold flex items-center"
  }, /*#__PURE__*/React.createElement("span", {
    className: "mr-2"
  }, "\uD83D\uDCED"), " \u672C\u9031\u5C1A\u672A\u56DE\u8986\u6B64\u6210\u54E1\u3002"), /*#__PURE__*/React.createElement("p", {
    className: "text-sm text-slate-500 mb-4 border-l-4 border-violet-400 pl-3"
  }, "\u91DD\u5C0D ", member, " \u672C\u9031\u7684\u56DE\u5831\u7D50\u679C\u7D66\u4E88\u56DE\u994B\u6216\u5EFA\u8B70\uFF08\u5DE5\u4F5C\u65B9\u5411\u3001\u512A\u5148\u9806\u5E8F\u3001\u63D0\u9192\u4E8B\u9805\u7B49\uFF09\u3002", /*#__PURE__*/React.createElement("span", {
    className: "block mt-1 text-slate-400"
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
  className = 'text-[10px] text-slate-400 mt-1'
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
  extraNotes,
  weeklyPlans = {},
  weeklyComments = {},
  extraNoteMeta = {},
  weeklyPlanMeta = {},
  weeklyCommentMeta = {},
  currentUser,
  role,
  onEditComment,
  onClose
}) {
  const isManager = role === 'manager';
  const [copied, setCopied] = useState(false); // 全團隊複製回饋
  const [copiedUser, setCopiedUser] = useState(null); // 個別成員複製回饋
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
    const activeTasks = [],
      pendingTasks = [];
    projects.filter(p => p.owner === user).forEach(p => p.tasks.forEach(t => {
      if (t.start <= currentWeek && t.end >= currentWeek) {
        const log = taskLogs[t.id]?.[currentWeek];
        if (log) activeTasks.push({
          proj: p,
          task: t,
          log
        });else pendingTasks.push({
          proj: p,
          task: t
        });
      }
    }));
    // 本週得分=已回報任務分數加總(回報預設 1 分,主管可調 0.3~1);未回報=0;滿分=本週排定任務數
    const weekScore = Math.round(activeTasks.reduce((sum, {
      log
    }) => sum + Number(log.score ?? 1), 0) * 10) / 10;
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
      weekScore
    };
  }), [users, projects, taskLogs, extraNotes, weeklyPlans, weeklyComments, extraNoteMeta, weeklyPlanMeta, weeklyCommentMeta, currentWeek]);

  // 依 onlyMine 過濾要顯示的成員摘要
  const visibleSummary = useMemo(() => {
    if (onlyMine && !isManager) return summary.filter(s => s.user === currentUser);
    return summary;
  }, [summary, onlyMine, isManager, currentUser]);
  const showTeamView = isManager || !onlyMine; // 是否為團隊瀏覽模式（多人＋折疊）

  // 產生單一成員的週報文字
  const buildSingleUserReport = s => {
    const lines = [`【MSD W${String(currentWeek).padStart(2, '0')} 週報 — ${s.user}】`, ''];
    lines.push(`■ ${s.user}（回報 ${s.activeTasks.length}/${s.total}・得分 ${s.weekScore}/${s.total}）`);
    s.activeTasks.forEach(({
      proj,
      task,
      log
    }) => {
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
      s.activeTasks.forEach(({
        proj,
        task,
        log
      }) => {
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
      try {
        document.execCommand('copy');
        onDone();
      } catch {}
      document.body.removeChild(ta);
    }
  };
  const copyReport = () => doCopy(buildReportText(), () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  });
  const copyUserReport = s => doCopy(buildSingleUserReport(s), () => {
    setCopiedUser(s.user);
    setTimeout(() => setCopiedUser(null), 2000);
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
    className: "p-4 grid grid-cols-1 md:grid-cols-2 gap-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "space-y-2.5"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-bold text-slate-400 border-b border-slate-100 pb-1"
  }, "\uD83D\uDCCC \u5C08\u6848\u57F7\u884C\u9805\u76EE"), activeTasks.length > 0 ? activeTasks.map(({
    proj,
    task,
    log
  }) => /*#__PURE__*/React.createElement("div", {
    key: task.id,
    className: `text-sm p-2.5 rounded-lg border ${log.status === 'not_executed' ? 'bg-slate-100 border-slate-200 opacity-80' : log.status === 'monitor' ? 'bg-sky-50/70 border-sky-200' : 'bg-green-50/60 border-green-200'}`
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between"
  }, /*#__PURE__*/React.createElement("div", {
    className: "font-bold text-slate-700 truncate text-xs pr-2"
  }, proj.name), /*#__PURE__*/React.createElement("div", {
    className: "flex-shrink-0 flex items-center gap-1"
  }, /*#__PURE__*/React.createElement("span", {
    className: `px-1.5 py-0.5 rounded text-[10px] font-bold ${STATUS_META[log.status]?.tag}`
  }, STATUS_META[log.status]?.label), /*#__PURE__*/React.createElement("span", {
    className: "px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-700",
    title: "\u6253\u5361\u5F97\u5206"
  }, Number(log.score ?? 1), "\u5206"), log.reporterRole === 'manager' && /*#__PURE__*/React.createElement("span", {
    className: "px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300",
    title: "\u6B64\u7B46\u7531\u4E3B\u7BA1\u4EE3\u70BA\u4FEE\u6B63/\u88DC\u767B"
  }, "\u270F\uFE0F\u4E3B\u7BA1"))), /*#__PURE__*/React.createElement("div", {
    className: "text-slate-600 my-1 font-medium text-xs"
  }, task.name), log.note && /*#__PURE__*/React.createElement("div", {
    className: "text-slate-700 text-xs bg-white p-1.5 rounded border border-slate-100 whitespace-pre-wrap"
  }, log.note), log.updatedAt && /*#__PURE__*/React.createElement("div", {
    className: "text-[10px] text-slate-400 mt-1"
  }, "\uD83D\uDD58 \u6700\u5F8C\u7DE8\u8F2F ", log.updatedAt, log.reporter ? `（${log.reporter}）` : ''))) : /*#__PURE__*/React.createElement("div", {
    className: "text-sm text-slate-400 italic py-2"
  }, "\u672C\u9031\u7121\u5C08\u6848\u6295\u5165"), pendingTasks.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "text-[11px] text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-lg px-2.5 py-1.5"
  }, "\u5C1A\u6709 ", pendingTasks.length, " \u9805\u672C\u9031\u6392\u5B9A\u4EFB\u52D9\u672A\u56DE\u5831")), /*#__PURE__*/React.createElement("div", {
    className: "space-y-2.5 md:border-l md:border-slate-100 md:pl-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-bold text-slate-400 border-b border-slate-100 pb-1"
  }, "\uD83D\uDCDD \u65E5\u5E38\u71DF\u904B / \u81E8\u6642\u4EA4\u8FA6\uFF08\u975E\u5C08\u6848\uFF09"), extraNote ? /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "text-sm text-slate-700 bg-orange-50 p-3 rounded-lg border border-orange-200 whitespace-pre-wrap"
  }, extraNote), /*#__PURE__*/React.createElement(MetaLine, {
    meta: extraMeta
  })) : /*#__PURE__*/React.createElement("div", {
    className: "text-sm text-slate-400 italic py-2"
  }, "\u7121\u586B\u5BEB\u5176\u4ED6\u9805\u76EE"), /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-bold text-slate-400 border-b border-slate-100 pb-1 pt-1"
  }, "\uD83D\uDCC5 \u4E0B\u9031\u9810\u8A08\u57F7\u884C\u5DE5\u4F5C"), weekPlan ? /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "text-sm text-slate-700 bg-indigo-50 p-3 rounded-lg border border-indigo-200 whitespace-pre-wrap"
  }, weekPlan), /*#__PURE__*/React.createElement(MetaLine, {
    meta: planMeta
  })) : /*#__PURE__*/React.createElement("div", {
    className: "text-sm text-slate-400 italic py-2"
  }, "\u672A\u586B\u5BEB")), comment && /*#__PURE__*/React.createElement("div", {
    className: "md:col-span-2"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-bold text-violet-700 border-b border-violet-100 pb-1 mb-2"
  }, "\uD83D\uDC51 \u4E3B\u7BA1\u56DE\u8986"), /*#__PURE__*/React.createElement("div", {
    className: "text-sm text-slate-800 bg-violet-50 p-3 rounded-lg border border-violet-300 whitespace-pre-wrap"
  }, comment), /*#__PURE__*/React.createElement(MetaLine, {
    meta: commentMeta,
    showManagerTag: false
  })));
  return /*#__PURE__*/React.createElement("div", {
    className: "fixed inset-y-0 right-0 w-full max-w-2xl bg-slate-50 shadow-2xl z-[120] flex flex-col border-l border-slate-200"
  }, /*#__PURE__*/React.createElement("div", {
    className: "px-6 py-4 text-white flex justify-between items-center shadow-md",
    style: {
      backgroundColor: '#001F5B'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h2", {
    className: "font-bold text-xl"
  }, "\uD83D\uDCCA W", String(currentWeek).padStart(2, '0'), " \u5718\u968A\u5DE5\u4F5C\u7E3D\u7D50\u770B\u677F"), /*#__PURE__*/React.createElement("p", {
    className: "text-xs text-blue-200 mt-1"
  }, "\u5F59\u7E3D\u5404\u6210\u54E1\u300C\u5C08\u6848\u5BE6\u969B\u57F7\u884C\u300D\u8207\u300C\u975E\u5C08\u6848\u4E8B\u9805\u300D")), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center space-x-2"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: exportExcel,
    disabled: exporting,
    className: `px-3 py-1.5 rounded-lg text-xs font-bold transition border text-white disabled:opacity-70 ${exportFailed ? 'bg-red-600 hover:bg-red-500 border-red-400/60' : 'bg-green-600 hover:bg-green-500 border-green-400/60'}`,
    title: "\u4E0B\u8F09 Excel \u9031\u5831(.xlsx)"
  }, exporting ? '⏳ 產生中…' : exportFailed ? '❌ 匯出失敗，點擊重試' : '⬇️ 匯出 Excel'), /*#__PURE__*/React.createElement("button", {
    onClick: copyReport,
    className: `px-3 py-1.5 rounded-lg text-xs font-bold transition border ${copied ? 'bg-green-500 border-green-400 text-white' : 'bg-white/10 hover:bg-white/20 border-white/20 text-white'}`
  }, copied ? '✓ 已複製' : '📋 複製週報文字'), /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    className: "text-white hover:bg-white/20 p-2 rounded-full"
  }, /*#__PURE__*/React.createElement("svg", {
    className: "w-6 h-6",
    fill: "none",
    viewBox: "0 0 24 24",
    stroke: "currentColor"
  }, /*#__PURE__*/React.createElement("path", {
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 2,
    d: "M6 18L18 6M6 6l12 12"
  }))))), /*#__PURE__*/React.createElement("div", {
    className: "bg-white px-6 py-2 border-b border-slate-200 flex items-center gap-2 flex-wrap"
  }, !isManager && /*#__PURE__*/React.createElement("label", {
    className: "flex items-center space-x-1.5 cursor-pointer select-none bg-slate-50 border border-slate-200 rounded-lg px-2 py-1"
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
    className: "h-4 border-l border-slate-200"
  }), /*#__PURE__*/React.createElement("button", {
    onClick: expandAll,
    className: "text-[11px] text-blue-600 hover:text-blue-800 font-bold"
  }, "\u5C55\u958B\u5168\u90E8"), /*#__PURE__*/React.createElement("span", {
    className: "text-slate-300"
  }, "|"), /*#__PURE__*/React.createElement("button", {
    onClick: collapseAll,
    className: "text-[11px] text-blue-600 hover:text-blue-800 font-bold"
  }, "\u6536\u5408\u5168\u90E8"))), /*#__PURE__*/React.createElement("div", {
    className: "flex-1 overflow-y-auto p-6 space-y-5"
  }, visibleSummary.map(s => {
    const {
      user,
      activeTasks,
      pendingTasks,
      extraNote,
      weekPlan,
      total
    } = s;
    if (activeTasks.length === 0 && !extraNote && !weekPlan && pendingTasks.length === 0) return null;
    const rate = total > 0 ? Math.round(activeTasks.length / total * 100) : 0;
    const isExpanded = showTeamView ? expandedUsers.has(user) : true; // 個人模式固定展開
    const isCopiedUser = copiedUser === user;
    return /*#__PURE__*/React.createElement("div", {
      key: user,
      className: "bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden"
    }, /*#__PURE__*/React.createElement("div", {
      className: `bg-slate-100 px-4 py-2 border-b border-slate-200 font-bold text-slate-800 flex items-center ${showTeamView ? 'cursor-pointer hover:bg-slate-200/70 transition' : ''}`,
      onClick: showTeamView ? () => toggleExpand(user) : undefined
    }, showTeamView && /*#__PURE__*/React.createElement("span", {
      className: "mr-1.5 text-slate-400 text-xs select-none"
    }, isExpanded ? '▼' : '▶'), /*#__PURE__*/React.createElement("div", {
      className: "w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs mr-2 flex-shrink-0"
    }, user[0]), /*#__PURE__*/React.createElement("span", {
      className: "mr-3"
    }, user), total > 0 && /*#__PURE__*/React.createElement("div", {
      className: "flex items-center flex-1 max-w-[260px]"
    }, /*#__PURE__*/React.createElement("div", {
      className: "flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden"
    }, /*#__PURE__*/React.createElement("div", {
      className: `h-full rounded-full transition-all ${rate === 100 ? 'bg-green-500' : rate >= 50 ? 'bg-blue-500' : 'bg-yellow-400'}`,
      style: {
        width: `${rate}%`
      }
    })), /*#__PURE__*/React.createElement("span", {
      className: "ml-2 text-[10px] font-bold text-slate-500 whitespace-nowrap"
    }, activeTasks.length, "/", total, " \u56DE\u5831"), /*#__PURE__*/React.createElement("span", {
      className: `ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap ${s.weekScore >= total ? 'bg-green-100 text-green-800 border-green-400' : 'bg-indigo-100 text-indigo-800 border-indigo-400'}`,
      title: `本週得分＝各任務打卡分數加總（回報預設 1 分、主管可調 0.3~1；未回報 0 分）／滿分＝本週排定任務數`
    }, "\uD83C\uDFC6 ", s.weekScore, "/", total, " \u5206")), !isExpanded && showTeamView && /*#__PURE__*/React.createElement("div", {
      className: "ml-auto flex items-center gap-1.5 text-[10px]"
    }, activeTasks.length > 0 && /*#__PURE__*/React.createElement("span", {
      className: "bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-bold border border-green-300"
    }, "\u2705", activeTasks.filter(a => a.log.status === 'executed').length), activeTasks.filter(a => a.log.status === 'monitor').length > 0 && /*#__PURE__*/React.createElement("span", {
      className: "bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded font-bold border border-sky-300"
    }, "\uD83D\uDC41\uFE0F", activeTasks.filter(a => a.log.status === 'monitor').length), pendingTasks.length > 0 && /*#__PURE__*/React.createElement("span", {
      className: "bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded font-bold border border-yellow-300"
    }, "\u2757", pendingTasks.length), extraNote && /*#__PURE__*/React.createElement("span", {
      className: "bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-bold border border-orange-300"
    }, "\uD83D\uDCDD"), weekPlan && /*#__PURE__*/React.createElement("span", {
      className: "bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-bold border border-indigo-300"
    }, "\uD83D\uDCC5"), s.comment && /*#__PURE__*/React.createElement("span", {
      className: "bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded font-bold border border-violet-300",
      title: "\u5DF2\u6709\u4E3B\u7BA1\u56DE\u8986"
    }, "\uD83D\uDCAC")), /*#__PURE__*/React.createElement("button", {
      onClick: e => {
        e.stopPropagation();
        copyUserReport(s);
      },
      className: `ml-auto px-2 py-0.5 rounded text-[10px] font-bold transition border ${isCopiedUser ? 'bg-green-500 border-green-400 text-white' : 'bg-slate-200 hover:bg-slate-300 border-slate-300 text-slate-600'}`,
      title: `複製 ${user} 的週報文字`
    }, isCopiedUser ? '✓ 已複製' : '📋 複製週報'), isManager && onEditComment && /*#__PURE__*/React.createElement("button", {
      onClick: e => {
        e.stopPropagation();
        onEditComment(user);
      },
      className: `ml-1.5 px-2 py-0.5 rounded text-[10px] font-bold transition border ${s.comment ? 'bg-violet-100 hover:bg-violet-200 border-violet-400 text-violet-800' : 'bg-slate-200 hover:bg-slate-300 border-slate-300 text-slate-600'}`,
      title: s.comment ? `編輯對 ${user} 的本週回覆` : `回覆 ${user} 的本週週報（選填）`
    }, s.comment ? '💬 編輯回覆' : '💬 主管回覆')), isExpanded && renderCardBody(s));
  }), visibleSummary.filter(s => s.activeTasks.length > 0 || s.extraNote || s.weekPlan || s.pendingTasks.length > 0).length === 0 && /*#__PURE__*/React.createElement("div", {
    className: "text-center text-slate-400 italic py-12"
  }, "\u672C\u9031\u5C1A\u7121\u56DE\u5831\u8CC7\u6599")));
}
function ProjectEditModal({
  info,
  existingCategories,
  users = [],
  onClose,
  onSave
}) {
  const isEdit = info.mode === 'edit';
  const p = info.project;
  const [name, setName] = useState(isEdit ? p.name : '');
  const [category, setCategory] = useState(isEdit ? p.category : '');
  const [type, setType] = useState(isEdit ? p.type : 'a');
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
        type
      });
    } finally {
      setSaving(false);
    }
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[130] flex justify-center items-center p-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden",
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
  }, "\u8CA0\u8CAC\u4EBA\uFF1A", info.owner)), /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    className: "text-white/60 hover:text-white"
  }, /*#__PURE__*/React.createElement("svg", {
    className: "w-6 h-6",
    fill: "none",
    viewBox: "0 0 24 24",
    stroke: "currentColor"
  }, /*#__PURE__*/React.createElement("path", {
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 2,
    d: "M6 18L18 6M6 6l12 12"
  })))), /*#__PURE__*/React.createElement("div", {
    className: "p-6 space-y-4"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "text-xs font-bold text-slate-500"
  }, "\u5C08\u6848\u540D\u7A31"), /*#__PURE__*/React.createElement("input", {
    type: "text",
    value: name,
    onChange: e => {
      setName(e.target.value);
      setError('');
      markModalDirty();
    },
    autoFocus: true,
    className: "mt-1 w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500",
    placeholder: "\u8F38\u5165\u5C08\u6848\u540D\u7A31\u2026"
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "text-xs font-bold text-slate-500"
  }, "\u5206\u985E"), /*#__PURE__*/React.createElement("input", {
    type: "text",
    list: "category-options",
    value: category,
    onChange: e => {
      setCategory(e.target.value);
      setError('');
      markModalDirty();
    },
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
    className: "mt-1 w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500 bg-white"
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
    className: "mt-1 w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500 bg-white"
  }, (users.includes(owner) ? users : [owner, ...users]).map(u => /*#__PURE__*/React.createElement("option", {
    key: u,
    value: u
  }, u))), owner !== info.owner && /*#__PURE__*/React.createElement("div", {
    className: "mt-1 text-[11px] text-orange-600 font-bold"
  }, "\u26A0 \u5132\u5B58\u5F8C\u6B64\u5C08\u6848(\u542B\u5340\u9593\u8207\u56DE\u5831\u7D00\u9304)\u5C07\u79FB\u8F49\u7D66\u300C", owner, "\u300D")), error && /*#__PURE__*/React.createElement("div", {
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
      backgroundColor: '#001F5B'
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
  const [taskName, setTaskName] = useState('');
  const [start, setStart] = useState(currentWeek);
  const [end, setEnd] = useState(currentWeek);
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
      await onSave(project, taskName.trim(), s, e);
    } finally {
      setSaving(false);
    }
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[130] flex justify-center items-center p-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden",
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
  }, project.name)), /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    className: "text-white/60 hover:text-white"
  }, /*#__PURE__*/React.createElement("svg", {
    className: "w-6 h-6",
    fill: "none",
    viewBox: "0 0 24 24",
    stroke: "currentColor"
  }, /*#__PURE__*/React.createElement("path", {
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 2,
    d: "M6 18L18 6M6 6l12 12"
  })))), /*#__PURE__*/React.createElement("div", {
    className: "p-6 space-y-4"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "text-xs font-bold text-slate-500"
  }, "\u8A08\u756B\u540D\u7A31"), /*#__PURE__*/React.createElement("input", {
    type: "text",
    value: taskName,
    onChange: e => {
      setTaskName(e.target.value);
      setError('');
      markModalDirty();
    },
    autoFocus: true,
    className: "mt-1 w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500",
    placeholder: "\u8F38\u5165\u6B64\u5340\u9593\u7684\u8A08\u756B\u9805\u76EE\u2026"
  })), /*#__PURE__*/React.createElement("div", {
    className: "flex space-x-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "w-1/2"
  }, /*#__PURE__*/React.createElement("label", {
    className: "text-xs font-bold text-slate-500"
  }, "\u958B\u59CB\u9031"), /*#__PURE__*/React.createElement("input", {
    type: "number",
    min: "1",
    max: weeksTotal,
    value: start,
    onChange: e => {
      setStart(e.target.value);
      setError('');
      markModalDirty();
    },
    className: "mt-1 w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500"
  })), /*#__PURE__*/React.createElement("div", {
    className: "w-1/2"
  }, /*#__PURE__*/React.createElement("label", {
    className: "text-xs font-bold text-slate-500"
  }, "\u7D50\u675F\u9031"), /*#__PURE__*/React.createElement("input", {
    type: "number",
    min: "1",
    max: weeksTotal,
    value: end,
    onChange: e => {
      setEnd(e.target.value);
      setError('');
      markModalDirty();
    },
    className: "mt-1 w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500"
  }))), error && /*#__PURE__*/React.createElement("div", {
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
      backgroundColor: '#001F5B'
    }
  }, saving ? '新增中…' : '新增區間')))));
}

// 自製刪除確認視窗(取代 window.confirm,樣式與系統一致)
function ConfirmModal({
  info,
  onCancel
}) {
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
  return /*#__PURE__*/React.createElement("div", {
    className: "fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[150] flex justify-center items-center p-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden",
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
    className: "bg-white border border-slate-200 rounded-xl p-3 text-center shadow-sm"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-[11px] font-bold text-slate-500"
  }, label), /*#__PURE__*/React.createElement("div", {
    className: "text-2xl font-black text-slate-800 mt-0.5"
  }, value), sub && /*#__PURE__*/React.createElement("div", {
    className: "text-[10px] text-slate-400 mt-0.5"
  }, sub));
  return /*#__PURE__*/React.createElement("div", {
    className: "fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[105] flex justify-end"
  }, /*#__PURE__*/React.createElement("div", {
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
      color: '#99F6E4'
    }
  }, "\u767B\u5165\u6B21\u6578\uFF08\u542B\u91CD\u65B0\u6574\u7406\u81EA\u52D5\u767B\u5165\uFF09\uFF0C\u8A55\u4F30\u7DB2\u9801\u4F7F\u7528\u7387")), /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    className: "text-white/70 hover:text-white p-1"
  }, /*#__PURE__*/React.createElement("svg", {
    className: "w-6 h-6",
    fill: "none",
    viewBox: "0 0 24 24",
    stroke: "currentColor"
  }, /*#__PURE__*/React.createElement("path", {
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 2,
    d: "M6 18L18 6M6 6l12 12"
  })))), /*#__PURE__*/React.createElement("div", {
    className: "bg-white px-5 py-2 border-b border-slate-200 flex items-center gap-1.5"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-[11px] font-bold text-slate-500 mr-1"
  }, "\u7D71\u8A08\u5340\u9593"), [7, 30, 90].map(d => /*#__PURE__*/React.createElement("button", {
    key: d,
    onClick: () => setDays(d),
    className: `px-2.5 py-1 rounded-lg text-[11px] font-bold border transition ${days === d ? 'bg-teal-600 text-white border-teal-700' : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'}`
  }, "\u8FD1 ", d, " \u5929"))), /*#__PURE__*/React.createElement("div", {
    className: "flex-1 overflow-y-auto p-5 space-y-5"
  }, loadError ? /*#__PURE__*/React.createElement("div", {
    className: "bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm font-bold"
  }, "\u274C \u8F09\u5165\u5931\u6557\uFF1A", loadError) : !stats ? /*#__PURE__*/React.createElement("div", {
    className: "text-center text-slate-400 py-10"
  }, "\u8F09\u5165\u4E2D\u2026") : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-2 gap-3"
  }, kpi('今日登入', stats.today), kpi('近 7 天', stats.last7), kpi(`近 ${stats.days} 天`, stats.lastN, `手動 ${stats.manualN}・自動 ${stats.autoN}`), kpi('活躍使用者', stats.uniqueUsers, `近 ${stats.days} 天有登入的人數`)), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-black text-slate-500 uppercase tracking-wider mb-2"
  }, "\uD83D\uDCC5 \u6BCF\u65E5\u767B\u5165\u6B21\u6578\uFF08\u8FD1 ", stats.days, " \u5929\uFF09"), /*#__PURE__*/React.createElement("div", {
    className: "bg-white border border-slate-200 rounded-xl p-3 shadow-sm"
  }, stats.lastN === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "text-center text-slate-400 italic text-xs py-6"
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
    className: "flex justify-between text-[10px] text-slate-400 mt-1.5 font-medium"
  }, /*#__PURE__*/React.createElement("span", null, dayBars[0]?.label), /*#__PURE__*/React.createElement("span", null, "\u55AE\u65E5\u6700\u9AD8 ", maxDay, " \u6B21"), /*#__PURE__*/React.createElement("span", null, dayBars[dayBars.length - 1]?.label))))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-black text-slate-500 uppercase tracking-wider mb-2"
  }, "\uD83D\uDC65 \u5404\u4F7F\u7528\u8005\u767B\u5165\u6B21\u6578\uFF08\u8FD1 ", stats.days, " \u5929\uFF09"), (stats.byUser || []).length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "bg-slate-50 border border-slate-200 rounded-xl p-4 text-center text-slate-400 text-xs italic"
  }, "\u6B64\u5340\u9593\u5C1A\u7121\u767B\u5165\u7D00\u9304") : /*#__PURE__*/React.createElement("div", {
    className: "space-y-2"
  }, stats.byUser.map(u => /*#__PURE__*/React.createElement("div", {
    key: u.user,
    className: "bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-sm"
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
    className: "text-[10px] text-slate-400 mt-1"
  }, "\u6700\u5F8C\u767B\u5165 ", u.lastAt))))), /*#__PURE__*/React.createElement("div", {
    className: "text-[11px] text-slate-400 leading-relaxed"
  }, "\u203B \u6BCF\u6B21\u65BC\u767B\u5165\u756B\u9762\u9078\u64C7\u8EAB\u5206\u3001\u6216\u91CD\u65B0\u6574\u7406\uFF0F\u91CD\u958B\u5206\u9801\u81EA\u52D5\u9084\u539F\u767B\u5165\uFF0C\u7686\u8A08\u4E00\u6B21\u3002\u7E3D\u7D2F\u8A08\uFF08\u542B\u66F4\u65E9\u671F\u9593\uFF09\uFF1A", stats.total, " \u6B21\u3002"))), /*#__PURE__*/React.createElement("div", {
    className: "p-4 bg-slate-50 border-t border-slate-200"
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
  return /*#__PURE__*/React.createElement("div", {
    className: "fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[105] flex justify-end"
  }, /*#__PURE__*/React.createElement("div", {
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
  }, "\u4F9D\u4EBA\u54E1\u540D\u518A\u90E8\u9580(DEPT_1/2/3)\u6216\u5DE5\u865F\u767D\u540D\u55AE\u5361\u63A7\uFF0C\u4EFB\u4E00\u898F\u5247\u7B26\u5408\u5373\u53EF\u700F\u89BD")), /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    className: "text-white/70 hover:text-white p-1"
  }, /*#__PURE__*/React.createElement("svg", {
    className: "w-6 h-6",
    fill: "none",
    viewBox: "0 0 24 24",
    stroke: "currentColor"
  }, /*#__PURE__*/React.createElement("path", {
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 2,
    d: "M6 18L18 6M6 6l12 12"
  })))), /*#__PURE__*/React.createElement("div", {
    className: "flex-1 overflow-y-auto p-5 space-y-5"
  }, loading ? /*#__PURE__*/React.createElement("div", {
    className: "text-center text-slate-400 py-10"
  }, "\u8F09\u5165\u4E2D\u2026") : loadError ? /*#__PURE__*/React.createElement("div", {
    className: "bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm font-bold"
  }, "\u274C \u8F09\u5165\u5931\u6557\uFF1A", loadError, /*#__PURE__*/React.createElement("button", {
    onClick: load,
    className: "ml-2 underline"
  }, "\u91CD\u8A66")) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: `rounded-xl border p-4 ${enabled ? 'bg-rose-50 border-rose-300' : 'bg-slate-50 border-slate-200'}`
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
    className: "bg-white border border-slate-200 rounded-xl p-3.5 space-y-2.5 shadow-sm"
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
      if (e.key === 'Enter' && !e.isComposing) addRule();
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
      if (e.key === 'Enter' && !e.isComposing) addRule();
    },
    placeholder: "\u5982\uFF1AMSD \u5168\u54E1",
    className: "w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-rose-500"
  }))), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex-1 text-[11px] text-slate-400 leading-snug"
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
    className: "bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-sm"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-1 flex-wrap min-w-0"
  }, RULE_FIELDS.filter(f => r[f.key]).map((f, i) => /*#__PURE__*/React.createElement(React.Fragment, {
    key: f.key
  }, i > 0 && /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] font-black text-slate-400"
  }, "\u4E14"), /*#__PURE__*/React.createElement("span", {
    className: `px-2 py-0.5 rounded text-[10px] font-bold border whitespace-nowrap ${f.chip}`
  }, f.label, "\uFF1D", r[f.key])))), /*#__PURE__*/React.createElement("span", {
    className: "ml-auto flex-shrink-0 text-[10px] text-slate-400",
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
    className: "bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2.5"
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
      if (e.key === 'Enter' && !e.isComposing) runTest();
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
    className: "p-4 bg-slate-50 border-t border-slate-200"
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
    }
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
    if (ok) setEditing(null);
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[115] flex justify-end"
  }, /*#__PURE__*/React.createElement("div", {
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
  }, "\u65B0\u589E\u7684\u6210\u54E1\u5373\u53EF\u767B\u5165\u56DE\u5831\uFF0C\u4E26\u53EF\u70BA\u5176\u5B89\u6392\u5C08\u6848")), /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    className: "text-white/60 hover:text-white p-1"
  }, /*#__PURE__*/React.createElement("svg", {
    className: "w-6 h-6",
    fill: "none",
    viewBox: "0 0 24 24",
    stroke: "currentColor"
  }, /*#__PURE__*/React.createElement("path", {
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 2,
    d: "M6 18L18 6M6 6l12 12"
  })))), /*#__PURE__*/React.createElement("div", {
    className: "p-4 border-b border-slate-200 bg-slate-50"
  }, /*#__PURE__*/React.createElement("label", {
    className: "text-xs font-bold text-slate-500"
  }, "\u65B0\u589E\u6210\u54E1"), /*#__PURE__*/React.createElement("div", {
    className: "mt-1 flex gap-2"
  }, /*#__PURE__*/React.createElement("input", {
    value: name,
    onChange: e => {
      setName(e.target.value);
      setError('');
    },
    onKeyDown: e => {
      if (e.key === 'Enter') submit();
    },
    placeholder: "\u8F38\u5165\u65B0\u6210\u54E1\u986F\u793A\u540D\u7A31\u2026",
    autoFocus: true,
    className: `flex-1 border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 ${error ? 'border-red-400' : 'border-slate-300'}`
  }), /*#__PURE__*/React.createElement("button", {
    onClick: submit,
    disabled: saving,
    className: "flex-shrink-0 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-sm transition hover:opacity-90 disabled:opacity-50",
    style: {
      backgroundColor: NAVY
    }
  }, saving ? '新增中…' : '＋ 新增')), error && /*#__PURE__*/React.createElement("div", {
    className: "mt-1.5 text-xs text-red-600 font-bold"
  }, error), /*#__PURE__*/React.createElement("p", {
    className: "mt-2 text-[11px] text-slate-400 leading-relaxed"
  }, "\u65B0\u589E\u5F8C\u6210\u54E1\u6703\u51FA\u73FE\u5728\u767B\u5165\u756B\u9762\u8207\u7518\u7279\u5716\uFF0C\u53EF\u76F4\u63A5\u70BA\u5176\u65B0\u589E\u5C08\u6848\u4E26\u958B\u59CB\u6BCF\u9031\u6253\u5361\u56DE\u5831\u3002 \u82E5\u8F38\u5165\u66FE\u88AB\u79FB\u9664\u7684\u540C\u540D\u6210\u54E1\uFF0C\u6703\u81EA\u52D5\u91CD\u65B0\u555F\u7528\u4E26\u9084\u539F\u5176\u6B77\u53F2\u8CC7\u6599\u3002")), /*#__PURE__*/React.createElement("div", {
    className: "flex-1 overflow-y-auto p-4 space-y-2"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-xs font-bold text-slate-400 mb-1"
  }, "\u73FE\u6709\u6210\u54E1\uFF08", users.length, " \u4F4D\uFF09"), users.map(u => {
    const projCount = projects.filter(p => p.owner === u).length;
    const isEditing = editing?.old === u;
    return /*#__PURE__*/React.createElement("div", {
      key: u,
      className: "flex items-center bg-white border border-slate-200 rounded-xl p-3 shadow-sm"
    }, /*#__PURE__*/React.createElement("div", {
      className: "w-8 h-8 rounded-full text-white flex items-center justify-center text-sm mr-3 flex-shrink-0",
      style: {
        backgroundColor: NAVY
      }
    }, u[0]), isEditing ? /*#__PURE__*/React.createElement("div", {
      className: "flex-1 min-w-0"
    }, /*#__PURE__*/React.createElement("div", {
      className: "flex items-center gap-1.5"
    }, /*#__PURE__*/React.createElement("input", {
      value: editing.value,
      autoFocus: true,
      onChange: e => setEditing(prev => ({
        ...prev,
        value: e.target.value,
        error: ''
      })),
      onKeyDown: e => {
        if (e.key === 'Enter') submitRename();
        if (e.key === 'Escape') setEditing(null);
      },
      className: `flex-1 min-w-0 border rounded-lg px-2 py-1 text-sm outline-none focus:border-blue-500 ${editing.error ? 'border-red-400' : 'border-slate-300'}`
    }), /*#__PURE__*/React.createElement("button", {
      onClick: submitRename,
      disabled: renaming,
      className: "flex-shrink-0 px-2 py-1 rounded-lg text-xs font-bold text-white transition hover:opacity-90 disabled:opacity-50",
      style: {
        backgroundColor: NAVY
      }
    }, renaming ? '…' : '✓ 儲存'), /*#__PURE__*/React.createElement("button", {
      onClick: () => setEditing(null),
      className: "flex-shrink-0 px-2 py-1 rounded-lg text-xs font-bold text-slate-500 bg-slate-100 hover:bg-slate-200 transition"
    }, "\u2715")), editing.error ? /*#__PURE__*/React.createElement("div", {
      className: "mt-1 text-[11px] text-red-600 font-bold"
    }, editing.error) : /*#__PURE__*/React.createElement("div", {
      className: "mt-1 text-[11px] text-slate-400"
    }, "\u6539\u540D\u5F8C\u5176\u5C08\u6848\u8207\u6B77\u53F2\u56DE\u5831\u81EA\u52D5\u8DDF\u96A8\u65B0\u540D\u7A31")) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
      className: "flex-1 min-w-0"
    }, /*#__PURE__*/React.createElement("div", {
      className: "font-bold text-sm text-slate-700 truncate"
    }, u), /*#__PURE__*/React.createElement("div", {
      className: "text-[11px] text-slate-400"
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
    className: "text-center text-slate-400 py-10 text-sm"
  }, "\u5C1A\u7121\u6210\u54E1\uFF0C\u8ACB\u65BC\u4E0A\u65B9\u65B0\u589E\u3002"))));
}
function AuditPanel({
  onClose
}) {
  const [logs, setLogs] = useState(null); // null=載入中
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');
  React.useEffect(() => {
    apiGet('/api/audit-log?top=300').then(d => setLogs(d.logs || [])).catch(e => setError(e.message || '無法連線資料庫'));
  }, []);
  const shown = useMemo(() => {
    if (!logs) return [];
    const kw = filter.trim().toLowerCase();
    if (!kw) return logs;
    return logs.filter(l => `${l.actor} ${l.empId || ''} ${l.action} ${l.entityType} ${l.entityId || ''} ${l.summary || ''} ${l.newValue || ''} ${l.detail || ''} ${l.at}`.toLowerCase().includes(kw));
  }, [logs, filter]);
  return /*#__PURE__*/React.createElement("div", {
    className: "fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[115] flex justify-end"
  }, /*#__PURE__*/React.createElement("div", {
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
  }, "\u6700\u8FD1 300 \u7B46\u64CD\u4F5C\u7A3D\u6838\uFF08\u8AB0\u3001\u4F55\u6642\u3001\u505A\u4E86\u4EC0\u9EBC\uFF09")), /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    className: "text-white/60 hover:text-white p-1"
  }, /*#__PURE__*/React.createElement("svg", {
    className: "w-6 h-6",
    fill: "none",
    viewBox: "0 0 24 24",
    stroke: "currentColor"
  }, /*#__PURE__*/React.createElement("path", {
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 2,
    d: "M6 18L18 6M6 6l12 12"
  })))), /*#__PURE__*/React.createElement("div", {
    className: "p-3 border-b border-slate-200 bg-slate-50"
  }, /*#__PURE__*/React.createElement("input", {
    value: filter,
    onChange: e => setFilter(e.target.value),
    placeholder: "\u7BE9\u9078\uFF1A\u4EBA\u54E1 / \u52D5\u4F5C / \u5C08\u6848 / \u5167\u5BB9\u2026",
    className: "w-full border border-slate-300 rounded-lg px-3 py-1.5 text-xs outline-none focus:border-blue-500"
  })), /*#__PURE__*/React.createElement("div", {
    className: "flex-1 overflow-y-auto p-3 space-y-1.5 text-xs"
  }, error ? /*#__PURE__*/React.createElement("div", {
    className: "text-red-600 bg-red-50 border border-red-100 rounded-lg p-3"
  }, error) : logs === null ? /*#__PURE__*/React.createElement("div", {
    className: "text-center text-slate-400 py-10"
  }, "\u8F09\u5165\u4E2D\u2026") : shown.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "text-center text-slate-400 py-10"
  }, "\u6C92\u6709\u7B26\u5408\u7684\u7D00\u9304") : shown.map(l => {
    const meta = AUDIT_ACTION_META[l.action] || {
      label: l.action,
      cls: 'bg-slate-100 text-slate-600'
    };
    return (
      /*#__PURE__*/
      // title 保留技術識別碼(如 t101-1@2026W9),畫面上只顯示後端翻譯好的白話摘要(summary)
      React.createElement("div", {
        key: l.id,
        className: "border border-slate-200 rounded-lg p-2.5 hover:bg-slate-50",
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
        className: "ml-1 px-1 py-px rounded bg-slate-100 text-slate-400 font-mono text-[10px]",
        title: "\u64CD\u4F5C\u8005 Windows \u5DE5\u865F"
      }, l.empId)), /*#__PURE__*/React.createElement("span", {
        className: "ml-auto flex-shrink-0 text-slate-400"
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
