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
const STATUS_META = {
  executed:     { label: '有執行', icon: '✅', bar: 'bg-green-700 border-green-800 text-white', tag: 'bg-green-100 text-green-800', dot: 'bg-green-700' },
  monitor:      { label: 'Monitor', icon: '👁️', bar: 'bg-sky-700 border-sky-800 text-white', tag: 'bg-sky-100 text-sky-800', dot: 'bg-sky-700' },
  not_executed: { label: '未執行', icon: '⏸️', bar: 'bg-slate-500 border-slate-600 text-white', tag: 'bg-slate-200 text-slate-700', dot: 'bg-slate-500' }
};

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
async function apiGet(path) {
  const res = await fetch(API_BASE + path, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error((await readApiError(res)) || ('HTTP ' + res.status));
  return res.json();
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

// 彈窗「未儲存內容」旗標:表單型視窗(打卡/非專案/下週預計/產出/專案/區間)輸入時設 true、
// 視窗卸載時自動清除;ESC 關窗前檢查,避免打到一半的內容被默默丟棄
let MODAL_DIRTY = false;
const markModalDirty = () => { MODAL_DIRTY = true; };
// 表單型視窗掛載時呼叫:卸載(不論儲存或取消)自動重置旗標
const useModalDirtyReset = () => {
  React.useEffect(() => () => { MODAL_DIRTY = false; }, []);
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
  const renderSortHeader = (label, key, widthClass, extraClass = "") => {
    const isSorted = sortConfig.key === key;
    const dirIcon = !isSorted ? '↕' : sortConfig.direction === 'asc' ? '▲' : '▼';
    return (
      <th
        onClick={() => handleSortHeader(key)}
        className={`px-3 py-2 cursor-pointer select-none transition hover:bg-slate-200 whitespace-nowrap ${isSorted ? 'bg-blue-100/80 text-blue-900 border-b-2 border-blue-600' : 'text-slate-700'} ${widthClass} ${extraClass}`}
        title={`點擊依「${label}」${!isSorted ? '排序' : sortConfig.direction === 'asc' ? '改為降冪排序' : '改為升冪排序'}`}
      >
        <div className="flex items-center justify-between gap-1">
          <span className="whitespace-nowrap">{label}</span>
          <span className={`text-[11px] px-1 rounded flex-shrink-0 ${isSorted ? 'bg-blue-600 text-white font-black' : 'text-slate-400 font-normal'}`}>
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
            className={`p-2.5 rounded-xl border text-left transition flex items-center gap-2.5 ${filterMode === 'all' ? 'bg-[#001F5B] text-white border-[#001F5B] shadow-md ring-2 ring-offset-2 ring-[#001F5B]/30' : 'bg-white text-slate-800 border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}>
            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-base font-bold ${filterMode === 'all' ? 'bg-white/10 text-white' : 'bg-slate-100 text-slate-600'}`}>📁</div>
            <div>
              <div className={`text-xs font-bold ${filterMode === 'all' ? 'text-blue-200' : 'text-slate-500'}`}>全部專案</div>
              <div className="text-lg font-black">{projects.length} <span className={`text-xs font-medium ${filterMode === 'all' ? 'text-blue-200' : 'text-slate-500'}`}>案</span></div>
            </div>
          </button>

          <button onClick={() => setFilterMode('starred')}
            className={`p-2.5 rounded-xl border text-left transition flex items-center gap-2.5 ${filterMode === 'starred' ? 'bg-amber-500 text-white border-amber-500 shadow-md ring-2 ring-offset-2 ring-amber-500/30' : 'bg-white text-slate-800 border-slate-200 hover:border-amber-300 hover:bg-amber-50/40'}`}>
            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-base font-bold ${filterMode === 'starred' ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-600'}`}>⭐</div>
            <div>
              <div className={`text-xs font-bold ${filterMode === 'starred' ? 'text-amber-100' : 'text-slate-500'}`}>重點關注項目</div>
              <div className="text-lg font-black">{projects.filter(p => starredIds.has(p.id)).length} <span className={`text-xs font-medium ${filterMode === 'starred' ? 'text-amber-100' : 'text-slate-500'}`}>案</span></div>
            </div>
          </button>

          <button onClick={() => setFilterMode('hasMp')}
            className={`p-2.5 rounded-xl border text-left transition flex items-center gap-2.5 ${filterMode === 'hasMp' ? 'bg-emerald-600 text-white border-emerald-600 shadow-md ring-2 ring-offset-2 ring-emerald-600/30' : 'bg-white text-slate-800 border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/40'}`}>
            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-base font-bold ${filterMode === 'hasMp' ? 'bg-white/10 text-white' : 'bg-emerald-100 text-emerald-600'}`}>💡</div>
            <div>
              <div className={`text-xs font-bold ${filterMode === 'hasMp' ? 'text-emerald-100' : 'text-slate-500'}`}>具備 MP Saving</div>
              <div className="text-lg font-black">{projects.filter(p => p.mpSaving).length} <span className={`text-xs font-medium ${filterMode === 'hasMp' ? 'text-emerald-100' : 'text-slate-500'}`}>案</span></div>
            </div>
          </button>

          <button onClick={() => setFilterMode('hasDeliverable')}
            className={`p-2.5 rounded-xl border text-left transition flex items-center gap-2.5 ${filterMode === 'hasDeliverable' ? 'bg-amber-600 text-white border-amber-600 shadow-md ring-2 ring-offset-2 ring-amber-600/30' : 'bg-white text-slate-800 border-slate-200 hover:border-amber-300 hover:bg-amber-50/40'}`}>
            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-base font-bold ${filterMode === 'hasDeliverable' ? 'bg-white/10 text-white' : 'bg-amber-100 text-amber-600'}`}>🎯</div>
            <div>
              <div className={`text-xs font-bold ${filterMode === 'hasDeliverable' ? 'text-amber-100' : 'text-slate-500'}`}>有具體產出成果</div>
              <div className="text-lg font-black">{projects.filter(p => p.deliverable).length} <span className={`text-xs font-medium ${filterMode === 'hasDeliverable' ? 'text-amber-100' : 'text-slate-500'}`}>/ {projects.length} 案</span></div>
            </div>
          </button>

          <button onClick={() => setFilterMode('missing')}
            className={`p-2.5 rounded-xl border text-left transition flex items-center gap-2.5 ${filterMode === 'missing' ? 'bg-red-600 text-white border-red-600 shadow-md ring-2 ring-offset-2 ring-red-600/30' : 'bg-white text-slate-800 border-slate-200 hover:border-red-300 hover:bg-red-50/40'}`}>
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
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse table-fixed">
          <thead>
            <tr className="bg-slate-100 text-xs font-bold border-b border-slate-200 h-9">
              <th className="px-2 w-10 text-center text-slate-500 whitespace-nowrap">No</th>
              {renderSortHeader("分類", "category", "w-20")}
              {renderSortHeader("類型", "type", "w-14 text-center")}
              {renderSortHeader("專案名稱", "name", "w-[420px]")}
              {renderSortHeader("負責人", "owner", "w-24")}
              {renderSortHeader("預計交付具體產出成果", "deliverable", "w-auto")}
              {renderSortHeader("MP Saving", "mpSaving", "w-36")}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-[13px]">
            {displayedProjects.map((proj, idx) => {
              const cleanDeliverable = proj.deliverable ? String(proj.deliverable).replace(/[\r\n]+/g, ' ') : '';
              return (
                <tr key={proj.id} className="hover:bg-blue-50/40 transition">
                  <td className="px-3 py-1 text-center text-slate-400 font-medium whitespace-nowrap truncate">{idx + 1}</td>
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
                          className={`flex-shrink-0 mr-1.5 text-base transition transform hover:scale-125 ${starredIds.has(proj.id) ? 'text-amber-500' : 'text-slate-300 hover:text-amber-400'}`}
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
                      <span className="text-slate-300 font-light">—</span>
                    )}
                  </td>
                  <td className="px-3 py-1 whitespace-nowrap">
                    {proj.mpSaving ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[13px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 whitespace-nowrap">
                        {proj.mpSaving}
                      </span>
                    ) : (
                      <span className="text-slate-300 font-light">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {displayedProjects.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-400 font-medium">
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

  // 載入時偵測一次 Windows 工號(非網域環境取不到 → null),接著向後端驗證瀏覽權限
  React.useEffect(() => {
    let cancelled = false;
    detectEmpId().then(async (id) => {
      if (cancelled) return;
      setEmpId(id);
      try {
        const r = await apiGet(`/api/access-check?empId=${encodeURIComponent(id || '')}`);
        if (!cancelled) setAccessCheck(r);
      } catch {
        // 後端不可達時不在此擋(bootstrap 會另行顯示連線錯誤);卡控啟用時的失敗判斷在伺服器端(fail-closed)
        if (!cancelled) setAccessCheck({ enabled: false, allowed: true });
      }
    });
    return () => { cancelled = true; };
  }, []);

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
  const [isCompact, setIsCompact] = useState(() => readPrefs().compact === true);   // 緊湊模式偏好:重整後沿用
  const [isOverview, setIsOverview] = useState(false);   // 年度總覽:52 週自動縮放進一個畫面寬,無水平捲軸(唯讀瀏覽視角)
  const [isResults, setIsResults] = useState(false);     // 成果清單:集中檢閱所有專案具體成果項目與 MP 節省統計
  const [collapsedOwners, setCollapsedOwners] = useState(new Set());
  const [searchText, setSearchText] = useState('');
  const [typeFilter, setTypeFilter] = useState(new Set());       // 空 = 全部
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
      alert('標記失敗：' + (err.message || '無法連線資料庫'));
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

  React.useEffect(() => { loadBootstrap(); }, [loadBootstrap]);

  const [selectedTaskInfo, setSelectedTaskInfo] = useState(null);
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
  const todayWeek = getTodayWeek(scheduleYear, weeksTotal);   // 本週(相對於選定年度)
  const isViewingPast = currentWeek !== todayWeek;  // 是否在檢視非本週

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
    try { localStorage.removeItem('gantt_login'); } catch (e) {}
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

  const scrollToWeek = useCallback((wk) => {
    const el = ganttRef.current;
    if (!el) return;
    const LEFT_W = 490;
    const target = LEFT_W + (wk - 1) * weekW - (el.clientWidth - LEFT_W) / 2;
    smoothScrollLeftTo(el, target);
  }, [weekW]);

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

  const handleUpdateTaskDetails = async (projId, taskId, newName, newStart, newEnd) => {
    try {
      await apiPost('/api/task-schedule', {
        taskCode: taskId, name: newName, start: parseInt(newStart), end: parseInt(newEnd),
        actor: currentUser, actorRole: role
      });
      setProjects(prev => prev.map(p => {
        if (p.id !== projId) return p;
        return { ...p, tasks: p.tasks.map(t => t.id === taskId ? { ...t, name: newName, start: parseInt(newStart), end: parseInt(newEnd) } : t) };
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

  // 多人共用時每 60 秒靜默刷新,讓其他人的變更自動出現(拖曳中暫停以免干擾;失敗靜默忽略,下輪再試)
  React.useEffect(() => {
    if (!currentUser || dragState) return;
    const timer = setInterval(() => { refreshData().catch(() => {}); }, 60000);
    return () => clearInterval(timer);
  }, [currentUser, dragState, refreshData]);

  // --- 全域鍵盤導航（方向鍵平移甘特圖、Home/H 回本週、ESC 關閉最上層彈窗） ---
  React.useEffect(() => {
    if (!currentUser) return;
    const handler = (e) => {
      // 中文組字中略過
      if (e.isComposing) return;
      // 焦點在表單元素時略過（搜尋框、輸入框等）
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

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
        if (showWeeklyReport) { setShowWeeklyReport(false); e.preventDefault(); return; }
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
    window.addEventListener('keydown', handler, true);   // capture phase
    return () => window.removeEventListener('keydown', handler, true);
  }, [currentUser, weekW, isOverview, isResults, confirmInfo, commentTarget, selectedTaskInfo, deliverableProj, editingProject, addingInterval, showExtraNoteModal, showWeeklyPlanModal, showWeeklyReport, showPendingPanel, showRetroPanel, showWeekEditPanel, showAuditPanel, showMemberPanel, showAccessPanel, showUsagePanel, showAdminMenu, showDeadlinePanel, goToCurrentWeek]);

  const existingCategories = useMemo(
    () => [...new Set(projects.map(p => p.category).filter(Boolean))].sort(),
    [projects]
  );

  // 搜尋/類型篩選會隱藏同成員內的部分專案列,此時拖曳落點會與畫面不一致,故暫停拖曳排序
  const isFilteringRows = searchText.trim() !== '' || typeFilter.size > 0;

  const handleSaveProject = async (form) => {
    try {
      if (form.mode === 'add') {
        await apiPost('/api/project', {
          type: form.type, category: form.category, owner: form.owner,
          name: form.name, year: scheduleYear, actor: currentUser, actorRole: role
        });
      } else {
        await apiPost('/api/project/update', {
          projectId: form.projectId, type: form.type, category: form.category,
          owner: form.owner, name: form.name, actor: currentUser, actorRole: role
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

  const handleAddInterval = async (proj, taskName, start, end) => {
    try {
      await apiPost('/api/task', {
        projectId: proj.id, taskName, start: parseInt(start), end: parseInt(end),
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

  // --- 本週統計 ---
  const weekStats = useMemo(() => {
    let active = 0, reported = 0, executed = 0, monitor = 0, notExec = 0;
    projects.forEach(p => p.tasks.forEach(t => {
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
    }));
    return { active, reported, executed, monitor, notExec, pending: active - reported };
  }, [projects, taskLogs, currentWeek]);

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
  if (!accessCheck) return <div className="min-h-screen bg-slate-100 flex flex-col"><LoadingScreen /></div>;
  if (accessCheck.enabled && !accessCheck.allowed) {
    return <AccessDeniedScreen empId={empId} reason={accessCheck.reason} person={accessCheck.person} />;
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans flex flex-col relative overflow-hidden">
      <header className="text-white px-4 py-2 flex justify-between items-center z-50 shadow-md" style={{ backgroundColor: NAVY }}>
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <div className="bg-white/10 p-1.5 rounded-lg border border-white/20">
              <svg className="w-5 h-5" style={{ color: GOLD }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" /></svg>
            </div>
            <span className="text-base font-bold tracking-wide">MSD 專案追蹤總表</span>
          </div>

          {currentUser && (
            <div className="px-3 py-1 rounded-full border border-white/10 flex items-center shadow-inner" style={{ backgroundColor: '#001338' }}>
              <span className="text-white/85 mr-2 text-xs font-medium">系統週數</span>
              {role === 'manager' ? (
                <div className="flex items-center space-x-1.5">
                  {/* 切週後同步捲動置中該週(scrollTargetWeek 機制),避免「週切了但畫面停在原地」 */}
                  <button onClick={() => { const w = Math.max(1, currentWeek - 1); setCurrentWeek(w); setScrollTargetWeek(w); }} className="w-5 h-5 flex items-center justify-center bg-white/10 hover:bg-white/30 rounded-full text-xs font-bold transition" title="上一週">‹</button>
                  <span className="font-bold text-sm tracking-wider text-center" style={{ color: GOLD, minWidth: 100 }}>W{String(currentWeek).padStart(2, '0')}<span className="text-white/75 font-normal text-[10px] ml-1">{weekToMonth(currentWeek, months)}</span></span>
                  <button onClick={() => { const w = Math.min(weeksTotal, currentWeek + 1); setCurrentWeek(w); setScrollTargetWeek(w); }} className="w-5 h-5 flex items-center justify-center bg-white/10 hover:bg-white/30 rounded-full text-xs font-bold transition" title="下一週">›</button>
                </div>
              ) : (
                <div className="flex items-center space-x-1.5">
                  <button onClick={() => { const w = Math.max(1, currentWeek - 1); setCurrentWeek(w); setScrollTargetWeek(w); }} className="w-5 h-5 flex items-center justify-center bg-white/10 hover:bg-white/30 rounded-full text-xs font-bold transition" title="檢視前一週(唯讀)">‹</button>
                  <span className="font-bold text-sm tracking-wider text-center" style={{ color: GOLD, minWidth: 100 }}>W{String(currentWeek).padStart(2, '0')}<span className="text-white/75 font-normal text-[10px] ml-1">{weekToMonth(currentWeek, months)}</span></span>
                  <button onClick={() => { const w = Math.min(todayWeek, currentWeek + 1); setCurrentWeek(w); setScrollTargetWeek(w); }} disabled={currentWeek >= todayWeek}
                    className={`w-5 h-5 flex items-center justify-center rounded-full text-xs font-bold transition ${currentWeek >= todayWeek ? 'bg-white/5 text-white/20 cursor-not-allowed' : 'bg-white/10 hover:bg-white/30'}`} title="檢視後一週">›</button>
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
        </div>

        {currentUser && (
          <div className="flex items-center space-x-2">
            {role === 'member' && allowRetroCheckin && currentWeek !== todayWeek && (
              // 主管開放補登時:成員檢視非當週可直接修改該週回報(任務打卡/非專案/下週預計;主管回覆不可異動)
              <button onClick={() => setShowRetroPanel(true)}
                className="bg-amber-700/80 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold shadow-md transition flex items-center gap-1 border border-amber-400/80"
                title={`主管已開放補登：可修改 W${String(currentWeek).padStart(2, '0')} 的任務打卡、非專案事項與下週預計工作`}>
                🕘 修改 W{String(currentWeek).padStart(2, '0')} 回報
              </button>
            )}
            {role === 'member' && (
              // 本週回報的三件事(任務打卡/下週預計/非專案事項)合併為單一入口;紅點=未回報任務+未填下週預計(非專案為選填不計)
              <button onClick={() => setShowPendingPanel(true)}
                className="relative bg-amber-500 hover:bg-amber-600 text-white px-3.5 py-1.5 rounded-lg text-xs font-bold shadow-md transition flex items-center gap-1.5 border border-amber-400">
                <span>📋 本週回報中心</span>
                {totalPendingCount > 0 && (
                  <span className="bg-red-600 text-white text-[11px] px-1.5 py-0.5 rounded-full font-black shadow leading-none">{totalPendingCount}</span>
                )}
              </button>
            )}
            {role === 'manager' && (
              <>
                {/* 主管:檢視中週次的回報編輯入口(代成員補登/修正任務打卡、非專案、下週預計,並可編輯主管回覆) */}
                <button onClick={() => setShowWeekEditPanel(true)}
                  className="bg-amber-700/80 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold shadow-md transition flex items-center gap-1 border border-amber-400/80"
                  title={`編輯 W${String(currentWeek).padStart(2, '0')} 各成員回報：代成員補登/修正任務打卡、非專案事項、下週預計工作，並可編輯主管回覆`}>
                  🛠 編輯 W{String(currentWeek).padStart(2, '0')} 回報
                </button>
              </>
            )}
            <button onClick={() => setShowWeeklyReport(true)}
              className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-md text-xs font-bold shadow transition border border-blue-400/50">
              📊 W{String(currentWeek).padStart(2, '0')} 團隊總結
            </button>
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
                      <div className="absolute right-0 top-full mt-1.5 z-[70] w-44 bg-white rounded-xl shadow-2xl border border-slate-200 py-1.5 overflow-hidden">
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
                              <span className="block text-[10px] text-slate-400">{item.desc}</span>
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
              <button onClick={handleLogout} className="p-1.5 hover:bg-red-500/80 rounded-lg transition text-white/70 hover:text-white bg-white/5" title="登出">
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
        <div className="flex-1 flex flex-col overflow-hidden bg-white relative">
          {isResults ? (
            <div className="px-4 py-2 border-b border-slate-200 bg-gradient-to-r from-amber-50/80 via-white to-white flex items-center justify-between text-xs overflow-x-auto">
              <div className="flex items-center gap-3">
                <span className="font-black text-amber-800 text-sm">🎯 {scheduleYear} 年度成果與 MP 效益清單</span>
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
            <div className="px-4 py-2 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white flex items-center gap-3 text-xs overflow-x-auto">
              <div className="flex items-center flex-shrink-0">
                <span className="font-black text-slate-900 text-sm">W{String(currentWeek).padStart(2, '0')}</span>
                <span className="text-slate-600 ml-1 text-[10px]">{weekToMonth(currentWeek, months)} 概況</span>
              </div>
              {/* 回報率進度條 */}
              <div className="flex items-center flex-shrink-0 min-w-[150px]">
                <div className="flex-1 h-2 bg-slate-300 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-500 ${weekStats.active > 0 && weekStats.reported === weekStats.active ? 'bg-green-600' : 'bg-indigo-600'}`}
                    style={{ width: `${weekStats.active > 0 ? (weekStats.reported / weekStats.active) * 100 : 0}%` }}></div>
                </div>
                <span className="ml-2 font-bold text-slate-800 whitespace-nowrap">{weekStats.reported}/{weekStats.active} 已回報</span>
              </div>
              <div className="h-6 border-l border-slate-200 flex-shrink-0"></div>
              {/* 狀態分佈 */}
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <StatChip label="有執行" value={weekStats.executed} className="bg-green-100 text-green-800 border-green-400" />
                <StatChip label="Monitor" value={weekStats.monitor} className="bg-sky-100 text-sky-800 border-sky-400" />
                <StatChip label="未執行" value={weekStats.notExec} className="bg-slate-200 text-slate-700 border-slate-400" />
                <StatChip label="未回報" value={weekStats.pending} className={weekStats.pending > 0 ? 'bg-yellow-100 text-yellow-800 border-yellow-500' : 'bg-slate-100 text-slate-500 border-slate-300'} />
                <button onClick={() => setShowDeadlinePanel(true)} title="點擊檢視即將到期清單"
                  className={`flex-shrink-0 pl-2 pr-2.5 py-1 rounded-full font-bold flex items-center gap-1 border transition ${deadlineTasks.length > 0 ? 'bg-orange-100 text-orange-800 hover:bg-orange-200 border-orange-500' : 'bg-slate-100 text-slate-500 hover:bg-slate-200 border-slate-300'}`}>
                  <span className="font-medium text-[11px]">⏰ 即將到期</span>
                  <span className="text-[13px] leading-none">{deadlineTasks.length}</span>
                  <span className="text-[11px]">›</span>
                </button>
              </div>
              <div className="flex-1 min-w-[8px]"></div>
              {/* 常駐精簡圖例(不用 hidden xl:flex,窄螢幕也要看得到):標籤精簡+title 補完整說明;
                  「⏰即將到期」不放圖例(左側同名按鈕已表達,避免同列重複出現) */}
              <div className="flex-shrink-0 flex items-center gap-2 text-[11px] text-slate-600 border border-slate-200 rounded-lg bg-white px-2 py-0.5">
                <span className="flex items-center" title="黃色斜紋條＝計畫區間(排定的起訖週)"><span className="w-3 h-2.5 mr-1 rounded-sm border" style={{ backgroundImage: 'repeating-linear-gradient(45deg,#FFF6D6,#FFF6D6 3px,#FDEDB8 3px,#FDEDB8 6px)', borderColor: '#B45309' }}></span>計畫</span>
                <span className="flex items-center" title="綠色＝該週回報「有執行」"><span className="w-2.5 h-2.5 bg-green-700 mr-1 rounded-sm"></span>有執行</span>
                <span className="flex items-center" title="藍色＝該週回報「Monitor(例行監控)」"><span className="w-2.5 h-2.5 bg-sky-700 mr-1 rounded-sm"></span>Monitor</span>
                <span className="flex items-center" title="灰色＝該週回報「未執行」"><span className="w-2.5 h-2.5 bg-slate-500 mr-1 rounded-sm"></span>未執行</span>
                <span className="flex items-center" title="紅框＋❗＝本週排定但尚未回報的任務"><span className="w-3 h-2.5 mr-1 rounded-sm border-2 border-red-400 bg-white"></span>❗待回報</span>
                {/* 鍵盤快捷鍵提示:常駐小字(輔助資訊直接顯示原則),完整說明放 title */}
                <span className="flex items-center text-slate-400 border-l border-slate-200 pl-2"
                  title="鍵盤快捷鍵：H＝回到本週並置中；← →＝左右平移 4 週；Shift＋← →＝微移 1 週；ESC＝關閉最上層視窗">
                  ⌨ H 回本週・←→ 平移
                </span>
              </div>
            </div>
          )}

          {/* 工具列:單列不斷行(nowrap+水平捲動保險),操作元件縮小一號(內容區才是主角) */}
          <div className="bg-white px-4 py-1.5 border-b border-slate-200 flex flex-nowrap items-center gap-1.5 text-[11px] z-30 overflow-x-auto [&>*]:flex-shrink-0">
            <div className="relative">
              <svg className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>
              <input value={searchText} onChange={e => setSearchText(e.target.value)} placeholder="搜尋專案 / 任務…"
                className="pl-7 pr-6 py-1 border border-slate-300 rounded-lg outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-200 transition w-44 focus:w-52" />
              {searchText && <button onClick={() => setSearchText('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 font-bold px-1">×</button>}
            </div>

            <div className="flex items-center space-x-1">
              {Object.entries(PROJECT_TYPES).map(([key, meta]) => {
                const on = typeFilter.has(key);
                return (
                  <button key={key} onClick={() => toggleTypeFilter(key)}
                    className={`px-1.5 py-0.5 rounded-full border font-bold transition ${on ? meta.chip + ' ring-1 ring-offset-1 ring-slate-500' : 'bg-white text-slate-700 border-slate-400 hover:border-slate-600 hover:bg-slate-50'}`}
                    title={meta.label}>
                    {key}·{meta.label}
                  </button>
                );
              })}
              {typeFilter.size > 0 && <button onClick={() => setTypeFilter(new Set())} className="text-blue-600 hover:underline px-1">清除</button>}
            </div>

            <div className="h-5 border-l border-slate-200"></div>

            {/* 成果清單:成員也用「成員下拉」瀏覽任何人(預設自己);週檢視/年度總覽維持成員勾選「只看我的」 */}
            {role === 'member' && !isResults ? (
              <label className="flex items-center space-x-1.5 cursor-pointer select-none bg-slate-50 border border-slate-200 rounded-lg px-2 py-1">
                <input type="checkbox" checked={onlyMine} onChange={e => setOnlyMine(e.target.checked)} className="w-3.5 h-3.5 rounded text-blue-600" />
                <span className="font-medium text-slate-700">只看我的專案</span>
              </label>
            ) : (
              <select value={ownerFilter} onChange={e => setOwnerFilter(e.target.value)}
                className="border border-slate-300 rounded-lg px-2 py-1 outline-none bg-white font-medium text-slate-700">
                <option value="all">全部成員</option>
                {users.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            )}

            <div className="flex-1"></div>

            <select value={scheduleYear}
              onChange={e => { const y = parseInt(e.target.value); setScheduleYear(y); setCurrentWeek(getTodayWeek(y)); }}
              title="切換排程年度(年度資料由 DB 的 ScheduleWeeks 決定)"
              className="border border-slate-300 rounded-lg px-2 py-1 outline-none bg-white font-bold text-slate-700">
              {(years.length ? years : [scheduleYear]).map(y => <option key={y} value={y}>{y} 年度</option>)}
            </select>

            {/* 檢視切換:週檢視=可打卡操作(可水平捲動);年度總覽=52 週縮放進一頁供主管瀏覽全貌 */}
            {/* 檢視切換: 週檢視=可打卡操作; 年度總覽=整年全景; 成果清單=具體產出與MP總表 */}
            {/* 成員切入成果清單:改用成員下拉、預設看自己;切回週檢視/年度總覽:還原「只看我的」預設 */}
            <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: NAVY }}>
              <button onClick={() => { if (isResults && role === 'member') { setOnlyMine(true); setOwnerFilter('all'); } setIsOverview(false); setIsResults(false); savePref('overview', false); }}
                className={`px-2 py-1 font-bold transition ${!isOverview && !isResults ? 'text-white' : 'bg-white text-slate-600 hover:bg-slate-100'}`}
                style={!isOverview && !isResults ? { backgroundColor: NAVY } : {}}>週檢視</button>
              <button onClick={() => { if (isResults && role === 'member') { setOnlyMine(true); setOwnerFilter('all'); } setIsOverview(true); setIsResults(false); savePref('overview', true); }}
                className={`px-2 py-1 font-bold transition ${isOverview && !isResults ? 'text-white' : 'bg-white text-slate-600 hover:bg-slate-100'}`}
                style={isOverview && !isResults ? { backgroundColor: NAVY } : {}}
                title="整年 52 週自動縮放至一個畫面寬(無水平捲軸),滑鼠停留甘特條可看細節">年度總覽</button>
              <button onClick={() => { if (role === 'member') { setOnlyMine(false); setOwnerFilter(currentUser); } setIsOverview(false); setIsResults(true); }}
                className={`px-2 py-1 font-bold transition ${isResults ? 'text-white' : 'bg-white text-slate-600 hover:bg-slate-100'}`}
                style={isResults ? { backgroundColor: NAVY } : {}}
                title="檢視全年度所有專案的具體產出項目與 MP Saving 統計(高階主管瀏覽視角,唯讀)">成果清單</button>
            </div>
            {!isOverview && !isResults && (
              <button onClick={goToCurrentWeek} title={`回到本週 W${String(todayWeek).padStart(2, '0')} 並置中（快捷鍵 H）`}
                className="flex items-center text-white px-2 py-1 rounded-lg font-bold shadow-sm transition hover:opacity-90" style={{ backgroundColor: NAVY }}>
                <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                回到本週
              </button>
            )}
            <div className="h-5 w-px bg-slate-300/80 mx-1 flex-shrink-0"></div>
            {!isOverview && !isResults && (
              <button onClick={() => { const v = !isCompact; setIsCompact(v); savePref('compact', v); }} className="text-slate-600 bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded-lg border border-slate-200 font-medium transition">
                {isCompact ? '寬鬆模式' : '緊湊模式'}
              </button>
            )}
            {role === 'manager' && (
              // 長文字縮短:完整說明放 title;開啟時下方另有整條琥珀色警示列,資訊不會漏
              <button onClick={toggleRetroCheckin}
                className={`px-2 py-1 rounded-lg font-bold border shadow-sm transition flex items-center gap-1 ${allowRetroCheckin ? 'bg-amber-500 hover:bg-amber-600 text-white border-amber-600' : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300'}`}
                title={allowRetroCheckin ? '目前開放全體成員回報/調正今年度的所有歷史週次紀錄，點擊關閉' : '目前成員僅能回報當週，點擊開放歷史補登'}>
                <span>{allowRetroCheckin ? '🔓 補登 ON' : '🔒 僅限當週'}</span>
              </button>
            )}
            {/* 展開/收合只作用於甘特圖的成員群組列,成果清單(單一平面表)用不到 → 隱藏 */}
            {!isResults && (
              <>
                <div className="h-5 w-px bg-slate-300/80 mx-1 flex-shrink-0"></div>
                <button onClick={() => setCollapsedOwners(new Set())} title="展開全部成員群組" className="text-blue-600 hover:text-blue-800 font-medium">展開</button>
                <span className="text-slate-300">|</span>
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

          <div ref={ganttRef} className="flex-1 overflow-auto bg-slate-50 relative">
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
              <table className="border-collapse bg-white" style={{ tableLayout: 'fixed', width: isOverview ? '100%' : 490 + weeksTotal * weekW }}>
              <colgroup>
                {!isOverview && <col style={{ width: 28 }} />}
                {!isOverview && <col style={{ width: 42 }} />}
                <col style={{ width: isOverview ? 240 : 420 }} />
                {Array.from({ length: weeksTotal }).map((_, i) => <col key={i} style={isOverview ? undefined : { width: weekW }} />)}
              </colgroup>
              <thead className="sticky top-0 z-40 text-xs shadow-sm bg-slate-100">
                <tr>
                  <th colSpan={isOverview ? 1 : 3} className="border-r border-b border-slate-300 bg-slate-200 sticky left-0 z-50 px-2 py-1 text-left" style={{ width: isOverview ? 240 : 490 }}>
                    <div className="flex justify-between items-center text-[10px]">
                      <span className="font-bold text-slate-700">專案基本資訊</span>
                      <span className="text-slate-600 font-normal">顯示 {filteredProjects.length} / {projects.length} 項</span>
                    </div>
                  </th>
                  {months.map((m, i) => (
                    <th key={i} colSpan={m.weeks} className="border-r border-b border-slate-300 text-white p-0.5 text-center font-medium text-[11px] tracking-wider relative overflow-hidden" style={{ backgroundColor: i % 2 === 0 ? NAVY : '#0A3178' }}>
                      <div className="absolute inset-0 bg-gradient-to-b from-white/10 to-transparent"></div>
                      {m.name.slice(0, 4)}/{m.name.slice(4)}
                    </th>
                  ))}
                </tr>
                {!isOverview && <tr className="bg-slate-100 text-slate-600 text-[11px]">
                  <th className="border-r border-b border-slate-300 p-1 sticky left-0 z-50 text-center font-medium" style={{ width: 28, minWidth: 28, maxWidth: 28, backgroundColor: '#F1F5F9' }}>No</th>
                  <th className="border-r border-b border-slate-300 p-1 sticky z-50 text-center font-medium" style={{ width: 42, minWidth: 42, maxWidth: 42, left: 28, backgroundColor: '#F1F5F9' }}>分類</th>
                  <th className="border-r border-b border-slate-300 p-1 sticky z-50 shadow-[3px_0_6px_rgba(0,0,0,0.08)] text-left pl-3 font-medium" style={{ width: 420, minWidth: 420, maxWidth: 420, left: 70, backgroundColor: '#F1F5F9' }}>專案名稱 (Project Name)</th>
                  {Array.from({ length: weeksTotal }).map((_, i) => {
                    const weekNum = i + 1;
                    const isCurrent = weekNum === currentWeek;
                    return (
                      <th key={i}
                        onClick={() => { if (role === 'manager' || weekNum <= todayWeek) setCurrentWeek(weekNum); }}
                        title={role === 'manager' ? `點擊將系統週切換至 W${weekNum}` : (weekNum <= todayWeek ? `點擊檢視 W${weekNum}(唯讀)` : undefined)}
                        className={`border-r border-b border-slate-300 p-0 text-center relative ${(role === 'manager' || weekNum <= todayWeek) ? 'cursor-pointer hover:bg-blue-100' : ''} ${isCurrent ? 'text-white font-bold' : weekNum > todayWeek ? 'bg-slate-100 text-slate-500 font-normal' : 'bg-slate-50 text-slate-700 font-normal'}`}
                        style={{ width: weekW, ...(isCurrent ? { backgroundColor: NAVY } : {}) }}>
                        {isCurrent && <div className="absolute -bottom-px left-0 right-0 h-0.5" style={{ backgroundColor: GOLD }}></div>}
                        <div className="py-1 z-10 relative">{isCompact ? weekNum : `W${String(weekNum).padStart(2, '0')}`}</div>
                      </th>
                    );
                  })}
                </tr>}
              </thead>

              <tbody className="text-xs">
                {groupedProjects.length === 0 ? (
                  <tr><td colSpan={weeksTotal + 3} className="p-10 text-center text-slate-400">
                    <div className="text-3xl mb-2">🔍</div>
                    找不到符合條件的專案。調整搜尋關鍵字或清除篩選後再試一次。
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
                      <tr onClick={() => toggleOwnerCollapse(group.owner)} className="group/header bg-[#EFF6FF] hover:bg-[#DBEAFE] cursor-pointer border-b border-blue-100 transition-colors">
                        <td colSpan={isOverview ? 1 : 3} className="sticky left-0 z-40 border-r border-blue-200 p-0 shadow-[3px_0_6px_rgba(0,0,0,0.06)]" style={{ width: isOverview ? 240 : 490, minWidth: isOverview ? 240 : 490, maxWidth: isOverview ? 240 : 490, backgroundColor: '#EFF6FF' }}>
                          <div className="flex items-center text-blue-900 font-bold text-[13px] px-2 py-1.5 border-l-4" style={{ borderColor: NAVY }}>
                            <svg className={`w-4 h-4 mr-1 text-blue-500 transition-transform ${isCollapsed ? '-rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                            <div className="w-6 h-6 rounded-full text-white flex items-center justify-center text-xs mr-2 flex-shrink-0" style={{ backgroundColor: NAVY }}>{group.owner[0]}</div>
                            {group.owner}
                            <span className="ml-2 px-1.5 py-0.5 bg-white text-blue-600 rounded text-[10px] font-medium border border-blue-100">{group.projects.length} 項</span>
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
                                className="ml-auto flex-shrink-0 flex items-center gap-1 bg-white text-blue-700 hover:bg-blue-600 hover:text-white border border-blue-300 rounded px-2 py-0.5 text-[10px] font-bold transition shadow-sm"
                                title={`為 ${group.owner} 新增專案`}>
                                ＋ 新增專案
                              </button>
                            )}
                          </div>
                        </td>
                        <td colSpan={weeksTotal} className="p-0 border-r border-slate-200">
                          <div className="w-full h-full flex opacity-30">
                            {Array.from({ length: weeksTotal }).map((_, i) => (
                              <div key={i} className={`flex-1 border-r border-slate-300 ${i + 1 === currentWeek ? 'bg-red-100' : ''}`}></div>
                            ))}
                          </div>
                        </td>
                      </tr>

                      {!isCollapsed && group.projects.map((proj, idx) => (
                        <tr key={proj.id}
                          onDragOver={role === 'manager' && dragState && dragState.owner === group.owner ? (e) => { e.preventDefault(); if (dragOverId !== proj.id) setDragOverId(proj.id); } : undefined}
                          onDrop={role === 'manager' && dragState ? (e) => { e.preventDefault(); handleReorderProjects(group.owner, dragState.id, proj.id); setDragState(null); setDragOverId(null); } : undefined}
                          className={`group/row border-b border-slate-300 transition-colors ${dragOverId === proj.id && dragState && dragState.id !== proj.id ? 'border-t-2 border-t-blue-500' : ''} ${dragState && dragState.id === proj.id ? 'opacity-40' : ''}`}>
                          {!isOverview && <td className={`text-center sticky left-0 bg-white group-hover/row:bg-[#EFF6FF] transition-colors z-30 border-r border-slate-200 text-slate-500 font-medium ${isCompact ? 'py-1' : 'py-2'}`} style={{ width: 28, minWidth: 28, maxWidth: 28 }}>{idx + 1}</td>}
                          {!isOverview && <td className={`text-center sticky bg-white group-hover/row:bg-[#EFF6FF] transition-colors z-30 border-r border-slate-200 text-slate-800 font-medium ${isCompact ? 'py-1' : 'py-2'}`} style={{ width: 42, minWidth: 42, maxWidth: 42, left: 28 }}>{proj.category}</td>}
                          {/* --- 嚴格設定 100% 純實色背景與絕對寬度，防止橫向捲動時甘特條穿透或重疊 --- */}
                          <td className="sticky bg-white group-hover/row:bg-[#EFF6FF] transition-colors z-30 shadow-[4px_0_8px_rgba(0,0,0,0.08)] border-r border-slate-300 p-0" style={{ width: isOverview ? 240 : 420, minWidth: isOverview ? 240 : 420, maxWidth: isOverview ? 240 : 420, left: isOverview ? 0 : 70 }}>
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
                                    className="flex-shrink-0 mr-1 cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 select-none text-[13px] leading-none"
                                    title="拖曳以調整排序">⠿</span>
                                )
                              )}
                              <div className={`flex-shrink-0 px-1.5 py-0.5 mr-2 text-[9px] font-bold rounded-sm border ${PROJECT_TYPES[proj.type].chip}`}>{proj.type.toUpperCase()}</div>
                              {/* 範本 B:專案名稱近全黑+加粗,寬鬆模式 15px(預設)/緊湊 13px/總覽 12.5px */}
                              <span className={`flex-1 min-w-0 truncate font-semibold text-slate-900 ${isOverview ? 'text-[12.5px]' : isCompact ? 'text-[13px]' : 'text-[15px]'}`} title={proj.name}>{proj.name}</span>
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
                                return (
                                  <span className="flex-shrink-0 ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-orange-100 text-orange-700 border border-orange-300 whitespace-nowrap"
                                    title={`${soon.length} 個計畫區間即將到期(最近的剩 ${remain} 週)`}>
                                    ⏰ 剩{remain}週
                                  </span>
                                );
                              })()}
                              {role === 'manager' && !isOverview && (
                                <div className="flex-shrink-0 flex items-center gap-0.5 ml-1 opacity-0 group-hover/row:opacity-100 transition-opacity">
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
                                <div key={i} className={`flex-1 border-r border-slate-200 ${i + 1 === currentWeek ? 'bg-red-50/70' : ''}`}></div>
                              ))}
                            </div>
                            <div className="absolute top-0 bottom-0 z-10 pointer-events-none" style={{ left: `${(currentWeek - 0.5) * (100 / weeksTotal)}%`, borderLeft: '2px solid rgba(220,38,38,0.55)' }}></div>

                            {proj.tasks.map(task => {
                              const isActiveThisWeek = task.start <= currentWeek && task.end >= currentWeek;
                              const weekLog = taskLogs[task.id]?.[currentWeek];
                              const isPending = role === 'member' && proj.owner === currentUser && isActiveThisWeek && !weekLog;
                              const deadlineSoon = isTaskDeadlineSoon(task);   // 剩 ≤2 週或已過 70% 時程 → 橘框 + ⏰(未回報紅框優先)

                              const barClass = 'text-slate-900';
                              const barStyle = {
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
                                  <div
                                    onClick={() => setSelectedTaskInfo({ proj, task, isActiveThisWeek, weekLog })}
                                    onMouseEnter={(e) => showTooltip(e, proj, task)}
                                    onMouseMove={moveTooltip}
                                    onMouseLeave={hideTooltip}
                                    className={`absolute flex items-center overflow-hidden cursor-pointer transition-transform hover:scale-y-110 hover:z-20 z-10 border rounded-sm shadow-sm ${barClass} ${isPending ? 'ring-2 ring-red-400 ring-offset-1' : deadlineSoon ? 'ring-2 ring-orange-400 ring-offset-1' : ''}`}
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
            )}
          </div>
        </div>
      )}

      {tooltip && (
        <div className="fixed z-[200] pointer-events-none"
          style={{ left: Math.min(tooltip.x + 14, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 300), top: Math.min(tooltip.y + 14, (typeof window !== 'undefined' ? window.innerHeight : 800) - 200) }}>
          <div className="bg-slate-900/95 text-white rounded-lg shadow-xl px-3.5 py-3 text-xs max-w-xs border border-slate-700">
            <div className="font-bold text-[13px] mb-1 text-yellow-200">{tooltip.proj.name}</div>
            <div className="text-slate-300 mb-0.5">👤 {tooltip.proj.owner}　·　{tooltip.proj.category}</div>
            {tooltip.proj.deliverable && <div className="text-amber-200/90 mb-0.5">🎯 {tooltip.proj.deliverable}</div>}
            {tooltip.proj.mpSaving && <div className="text-emerald-300 font-bold mb-0.5">💡 MP 節省：{tooltip.proj.mpSaving}</div>}
            <div className="text-slate-300">📅 {tooltip.task.name}</div>
            <div className="text-slate-400">W{tooltip.task.start} – W{tooltip.task.end}（{weekToMonth(tooltip.task.start, months)} ~ {weekToMonth(tooltip.task.end, months)}）</div>
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
                {tooltip.weekLog.note && <div className="text-slate-300 whitespace-pre-wrap">{tooltip.weekLog.note}</div>}
              </div>
            )}
            {tooltip.history.length > 0 && (
              <div className="mt-2 pt-2 border-t border-slate-700 text-slate-400">
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
      {showWeeklyReport && (
        <WeeklyReportDashboard
          currentWeek={currentWeek} year={scheduleYear} users={users} projects={projects} taskLogs={taskLogs} extraNotes={extraNotes}
          weeklyPlans={weeklyPlans} weeklyComments={weeklyComments}
          extraNoteMeta={extraNoteMeta} weeklyPlanMeta={weeklyPlanMeta} weeklyCommentMeta={weeklyCommentMeta}
          currentUser={currentUser} role={role}
          onEditComment={(userName) => setCommentTarget(userName)}
          onClose={() => setShowWeeklyReport(false)}
        />
      )}
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

      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[300] bg-slate-900 text-white text-sm font-bold px-5 py-3 rounded-xl shadow-2xl border flex items-center gap-3 ${toast.isError ? 'border-red-500' : 'border-slate-700 animate-bounce'}`}>
          <span className="whitespace-pre-wrap">{toast.msg}</span>
          {toast.action && (
            <button onClick={() => { dismissToast(); toast.action.onClick(); }}
              className="flex-shrink-0 bg-amber-500 hover:bg-amber-400 text-slate-900 px-3 py-1 rounded-lg text-xs font-black transition">
              ↩ {toast.action.label}
            </button>
          )}
          {(toast.isError || toast.action) && (
            <button onClick={dismissToast} className="flex-shrink-0 text-white/50 hover:text-white font-bold px-1" title="關閉">✕</button>
          )}
        </div>
      )}
    </div>
  );
}

// 投影友善:晶片加邊框確保輪廓、標籤文字不再用透明度淡化(投影機對比打折,淡字會消失)
function StatChip({ label, value, className }) {
  return (
    <span className={`flex-shrink-0 pl-2 pr-2.5 py-1 rounded-full font-bold flex items-center gap-1 border ${className}`}>
      <span className="font-medium text-[11px]">{label}</span>
      <span className="text-[13px] leading-none">{value}</span>
    </span>
  );
}

function LoadingScreen() {
  return (
    <div className="flex-1 flex justify-center items-center bg-slate-100 p-4">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-4"></div>
        <div className="text-slate-500 font-bold">載入資料中…</div>
      </div>
    </div>
  );
}

function ErrorScreen({ message, onRetry }) {
  return (
    <div className="flex-1 flex justify-center items-center bg-slate-100 p-4">
      <div className="bg-white p-10 rounded-2xl shadow-2xl border border-red-200 max-w-md w-full text-center">
        <div className="w-16 h-16 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center mx-auto mb-4 text-3xl">⚠️</div>
        <h2 className="text-xl font-black text-slate-800 mb-2">無法連線資料庫</h2>
        <p className="text-sm text-slate-500 mb-3">系統無法從後端讀取資料，請確認後端服務與資料庫連線後再試一次。</p>
        <div className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg p-3 mb-5 text-left whitespace-pre-wrap break-words max-h-40 overflow-y-auto">{message}</div>
        <button onClick={onRetry} className="w-full text-white font-bold py-3 rounded-xl shadow-md transition hover:opacity-90" style={{ backgroundColor: '#001F5B' }}>重新載入</button>
      </div>
    </div>
  );
}

// 瀏覽權限未通過的整頁封鎖畫面(卡控啟用時取代整個 App,不顯示登入與資料)
function AccessDeniedScreen({ empId, reason, person }) {
  return (
    <div className="min-h-screen flex justify-center items-center bg-slate-100 p-4">
      <div className="bg-white p-10 rounded-2xl shadow-2xl border border-red-200 max-w-md w-full text-center">
        <div className="w-16 h-16 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center mx-auto mb-4 text-3xl">🚫</div>
        <h2 className="text-xl font-black text-slate-800 mb-2">無權限瀏覽此頁面</h2>
        <p className="text-sm text-slate-500 mb-4">您的帳號未被授權瀏覽 MSD 專案追蹤總表。</p>
        <div className="text-left text-sm bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4 space-y-1.5">
          <div><span className="text-slate-400 font-bold mr-2">登入工號</span><span className="font-mono font-bold text-slate-800">{empId || '（無法取得）'}</span></div>
          {person && (
            <div><span className="text-slate-400 font-bold mr-2">人員名冊</span>
              <span className="text-slate-700 font-medium">{person.name || ''} {person.ename ? `(${person.ename})` : ''}・{person.deptname || [person.dept1, person.dept2, person.dept3].filter(Boolean).join('/') || '無部門資料'}</span>
            </div>
          )}
        </div>
        {reason && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg p-3 mb-5 text-left whitespace-pre-wrap">{reason}</div>
        )}
        <p className="text-xs text-slate-400">若需要瀏覽權限，請聯絡系統管理員（主管）將您的部門或工號加入允許清單。</p>
      </div>
    </div>
  );
}

function LoginScreen({ onLogin, users, year, empId }) {
  return (
    <div className="flex-1 flex justify-center items-center bg-slate-100 p-4">
      <div className="bg-white p-10 rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full">
        <div className="text-center mb-8">
          <div className="w-16 h-16 text-white rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg text-2xl" style={{ backgroundColor: '#001F5B' }}>📊</div>
          <h2 className="text-2xl font-black text-slate-800">MSD 專案追蹤系統</h2>
          <p className="text-xs text-slate-400 mt-2">{year} 年度專案排程 · 週進度管控</p>
        </div>
        <button onClick={() => onLogin('管理部主管', 'manager')} className="w-full text-white font-bold py-3.5 rounded-xl mb-6 shadow-md transition hover:opacity-90" style={{ backgroundColor: '#001F5B' }}>👑 主管登入（調整排程 / 檢視全體）</button>
        <div className="relative flex py-2 items-center">
          <div className="flex-grow border-t border-slate-200"></div>
          <span className="flex-shrink-0 mx-4 text-slate-400 text-xs font-bold uppercase tracking-wider">團隊成員登入（回報進度）</span>
          <div className="flex-grow border-t border-slate-200"></div>
        </div>
        <div className="grid grid-cols-3 gap-3 mt-4">
          {users.map(u => (
            <button key={u} onClick={() => onLogin(u, 'member')}
              className="bg-white border border-slate-300 hover:border-blue-500 hover:bg-blue-50 py-2.5 rounded-xl font-bold text-slate-700 hover:text-blue-700 transition shadow-sm text-sm">
              {u}
            </button>
          ))}
        </div>
        {empId && (
          <div className="mt-6 text-center text-[11px] text-slate-400">
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

function TaskModal({ info, role, currentUser, currentWeek, todayWeek, weeksTotal = WEEKS_TOTAL, allowRetroCheckin, onClose, onSaveLog, onUpdateTaskDetails, onDeleteTask, onUpdateScore }) {
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
  const [saving, setSaving] = useState(false);   // 防連點:送出中鎖定按鈕
  useModalDirtyReset();
  const [scheduleError, setScheduleError] = useState('');
  const [noteError, setNoteError] = useState('');

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
    try { await onUpdateTaskDetails(proj.id, task.id, taskName.trim(), s, e); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex justify-center items-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 text-white flex justify-between items-start" style={{ backgroundColor: isManager ? '#001F5B' : '#334155' }}>
          <div className="pr-3">
            <div className="text-xs text-white/80 font-medium mb-1 flex items-center">
              負責人：{proj.owner}
              <span className={`ml-2 px-1.5 rounded text-[10px] font-bold border ${PROJECT_TYPES[proj.type].chip}`}>{proj.type.toUpperCase()} {PROJECT_TYPES[proj.type].label}</span>
            </div>
            <h3 className="font-bold text-lg leading-snug">{proj.name}</h3>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white flex-shrink-0"><svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
        </div>

        <div className="p-6 space-y-6">
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
            <div className="flex justify-between items-center mb-3">
              <label className="text-sm font-bold text-slate-800">專案排程與預計事項</label>
              {isManager && <span className="text-[10px] bg-yellow-200 text-yellow-800 px-2 py-0.5 rounded font-bold">主管可編輯</span>}
            </div>
            <input type="text" value={taskName} onChange={e => { setTaskName(e.target.value); setScheduleError(''); markModalDirty(); }} disabled={!isManager}
              className="w-full border border-slate-300 rounded-md p-2 text-sm mb-3 text-center disabled:bg-slate-100 disabled:text-slate-500 outline-none focus:border-blue-500" />
            <div className="flex space-x-3 items-center">
              <div className="w-1/2">
                <label className="text-[10px] text-slate-400 font-bold">開始週</label>
                <input type="number" min="1" max={weeksTotal} value={startWeek} onChange={e => { setStartWeek(e.target.value); setScheduleError(''); markModalDirty(); }} disabled={!isManager}
                  className="w-full border border-slate-300 rounded-md p-2 text-sm disabled:bg-slate-100 disabled:text-slate-500 outline-none focus:border-blue-500" />
              </div>
              <div className="w-1/2">
                <label className="text-[10px] text-slate-400 font-bold">結束週</label>
                <input type="number" min="1" max={weeksTotal} value={endWeek} onChange={e => { setEndWeek(e.target.value); setScheduleError(''); markModalDirty(); }} disabled={!isManager}
                  className="w-full border border-slate-300 rounded-md p-2 text-sm disabled:bg-slate-100 disabled:text-slate-500 outline-none focus:border-blue-500" />
              </div>
            </div>
            {scheduleError && <div className="mt-2 text-xs text-red-600 font-bold">{scheduleError}</div>}
            {isManager && (
              <div className="mt-3 flex gap-2">
                <button onClick={submitSchedule} disabled={saving} className="flex-1 text-white px-4 py-1.5 rounded text-sm font-bold transition hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: '#001F5B' }}>{saving ? '儲存中…' : '儲存排程'}</button>
                <button onClick={() => onDeleteTask(proj, task)}
                  className="flex-shrink-0 px-3 py-1.5 rounded text-sm font-bold text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 transition"
                  title="刪除此計畫區間（軟刪除，可由資料庫還原）">🗑 刪除區間</button>
              </div>
            )}
          </div>

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
                {weekLog.reporter && <span className="text-slate-400">by {weekLog.reporter}</span>}
                {weekLog.reporterRole === 'manager' && (
                  <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 font-bold text-[10px]" title="此筆由主管代為修正/補登">✏️ 主管修正</span>
                )}
              </div>
            )}
            {canClockIn ? (
              <div className={`p-4 rounded-xl border transition-colors ${status && status !== 'not_executed' ? 'bg-blue-50 border-blue-200' : 'bg-slate-50 border-slate-200'}`}>
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
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-2">
                    {Object.entries(STATUS_META).map(([key, meta]) => (
                      <button key={key} onClick={() => { setStatus(key); setNoteError(''); markModalDirty(); }}
                        className={`py-3 rounded-lg border text-sm font-bold transition ${status === key ? meta.tag + ' ring-2 ring-offset-1 ring-slate-300' : 'bg-white text-slate-400 border-slate-200 hover:border-slate-400'}`}>
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
                  <button onClick={onClose} className="px-4 py-2 text-sm text-slate-500 bg-white border border-slate-300 rounded-lg font-bold hover:bg-slate-50">取消</button>
                  <button onClick={submitLog} disabled={saving} className="px-6 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold rounded-lg shadow-md">{saving ? '儲存中…' : '儲存進度回報'}</button>
                </div>
                {isManager && weekLog && (
                  <div className="mt-4 pt-3 border-t border-slate-200">
                    <div className="text-xs font-bold text-slate-500 mb-2">主管評分微調（點擊即時更新分數）</div>
                    <div className="grid grid-cols-5 gap-1.5">
                      {SCORE_OPTIONS.map(o => (
                        <button key={o.value} onClick={() => onUpdateScore(task.id, o.value)}
                          className={`px-1 py-2 rounded-lg border text-center transition ${score === o.value ? 'bg-indigo-600 text-white border-indigo-700 ring-2 ring-offset-1 ring-indigo-300' : 'bg-white text-slate-600 border-slate-300 hover:border-indigo-400 hover:bg-indigo-50'}`}>
                          <div className="text-[11px] font-bold leading-tight">{o.label}</div>
                          <div className={`text-[10px] mt-0.5 ${score === o.value ? 'text-indigo-100' : 'text-slate-400'}`}>{o.value} 分</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl text-sm">
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
                    <div className="bg-white p-3 rounded border border-slate-200 text-slate-700 whitespace-pre-wrap">{weekLog.note || '（未填寫備註）'}</div>
                    {isManager && (
                      <div className="mt-3 pt-3 border-t border-slate-200">
                        <div className="text-xs font-bold text-slate-500 mb-2">主管評分（點擊即修改此週分數）</div>
                        <div className="grid grid-cols-5 gap-1.5">
                          {SCORE_OPTIONS.map(o => (
                            <button key={o.value} onClick={() => onUpdateScore(task.id, o.value)}
                              className={`px-1 py-2 rounded-lg border text-center transition ${score === o.value ? 'bg-indigo-600 text-white border-indigo-700 ring-2 ring-offset-1 ring-indigo-300' : 'bg-white text-slate-600 border-slate-300 hover:border-indigo-400 hover:bg-indigo-50'}`}>
                              <div className="text-[11px] font-bold leading-tight">{o.label}</div>
                              <div className={`text-[10px] mt-0.5 ${score === o.value ? 'text-indigo-100' : 'text-slate-400'}`}>{o.value} 分</div>
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
      <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[110] flex justify-center items-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
          <div className="px-6 py-4 text-white flex justify-between items-center" style={{ backgroundColor: '#475569' }}>
            <h3 className="font-bold text-lg" style={{ color: '#FFFFFF' }}>🔒 W{currentWeek} 非專案工作（唯讀）</h3>
            <button onClick={onClose} className="text-white/60 hover:text-white"><svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
          </div>
          <div className="p-6">
            <p className="text-xs text-slate-400 mb-3">歷史週次僅供瀏覽，無法修改。</p>
            {initialNote ? (
              <div>
                <div className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-4 whitespace-pre-wrap">{initialNote}</div>
                <MetaLine meta={meta} />
              </div>
            ) : (
              <div className="text-sm text-slate-400 italic text-center py-6">該週未填寫非專案事項</div>
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
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[110] flex justify-center items-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 text-white flex justify-between items-center" style={{ backgroundColor: '#F97316' }}>
          <h3 className="font-bold text-lg flex items-center" style={{ color: '#FFFFFF' }}>📝 填寫 W{currentWeek} 非專案工作{targetUser ? `（${targetUser}）` : ''}</h3>
          <button onClick={onClose} className="text-white/60 hover:text-white"><svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
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
            <span className="block mt-1 text-slate-400">此欄為選填，隨時可清空內容後儲存。</span>
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
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[130] flex justify-center items-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 text-white flex justify-between items-start" style={{ backgroundColor: '#F59E0B' }}>
          <div className="pr-3">
            <h3 className="font-bold text-lg" style={{ color: '#FFFFFF' }}>🎯 具體產出與 MP 效益</h3>
            <p className="text-xs mt-0.5 truncate max-w-[360px]" style={{ color: '#FEF3C7' }}>{proj.name}（負責人：{proj.owner}）</p>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white flex-shrink-0"><svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
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
                {proj.deliverable || <span className="text-slate-400 italic">（負責人尚未填寫）</span>}
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
      <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[110] flex justify-center items-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
          <div className="px-6 py-4 text-white flex justify-between items-center" style={{ backgroundColor: '#475569' }}>
            <h3 className="font-bold text-lg" style={{ color: '#FFFFFF' }}>🔒 W{currentWeek} 下週預計工作（唯讀）</h3>
            <button onClick={onClose} className="text-white/60 hover:text-white"><svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
          </div>
          <div className="p-6">
            <p className="text-xs text-slate-400 mb-3">歷史週次僅供瀏覽，無法修改。</p>
            {initialNote ? (
              <div>
                <div className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-4 whitespace-pre-wrap">{initialNote}</div>
                <MetaLine meta={meta} />
              </div>
            ) : (
              <div className="text-sm text-slate-400 italic text-center py-6">該週未填寫下週預計工作</div>
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
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[110] flex justify-center items-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 text-white flex justify-between items-center" style={{ backgroundColor: '#6366F1' }}>
          <h3 className="font-bold text-lg flex items-center" style={{ color: '#FFFFFF' }}>📅 填寫 W{currentWeek} 下週預計執行工作{targetUser ? `（${targetUser}）` : ''}</h3>
          <button onClick={onClose} className="text-white/60 hover:text-white"><svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
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
  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[105] flex justify-end">
      <div className="w-full max-w-sm bg-white h-full shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        {/* 標題列顏色一律用行內樣式:企業內網若快取到舊版 app.css,新 class 不存在會變白底白字 */}
        <div className="px-5 py-4 text-white flex justify-between items-center" style={{ backgroundColor: '#EA580C' }}>
          <div>
            <h3 className="font-bold text-lg" style={{ color: '#FFFFFF' }}>⏰ 即將到期清單</h3>
            <p className="text-xs mt-0.5" style={{ color: '#FFEDD5' }}>剩餘 ≤2 週或時程已過 70% 的計畫區間</p>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white p-1"><svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {items.length === 0 ? (
            <div className="text-center text-slate-400 py-16">
              <div className="text-4xl mb-3">🎉</div>
              <div className="font-bold text-slate-600">目前沒有即將到期的任務</div>
            </div>
          ) : items.map(({ proj, task, remain, elapsed }) => (
            <button key={task.id} onClick={() => onSelect({ proj, task })}
              className="w-full text-left bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded-xl p-3 transition group">
              <div className="flex items-center justify-between">
                <div className="min-w-0 pr-2">
                  <div className="text-xs font-bold text-slate-700 truncate">{proj.name}</div>
                  <div className="text-sm text-slate-600 mt-0.5 truncate">{task.name}</div>
                  <div className="text-[10px] text-slate-400 mt-1">👤 {proj.owner} · 排程 W{task.start}–W{task.end}</div>
                </div>
                <div className="flex-shrink-0 text-right">
                  <div className={`font-bold text-sm ${remain <= 1 ? 'text-red-600' : 'text-orange-600'}`}>剩 {remain} 週</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">已過 {elapsed}%</div>
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
  const totalRequired = pending.length + completed.length + 1; // 任務總數 + 1項下週預計
  const completedCount = completed.length + (planPending ? 0 : 1);
  const percent = totalRequired > 0 ? Math.round((completedCount / totalRequired) * 100) : 100;
  const allDone = pending.length === 0 && !planPending;
  const wkLabel = retro ? `W${String(currentWeek).padStart(2, '0')}` : '本週';   // 補登模式所有文案以週次取代「本週」

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[105] flex justify-end">
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
            <button onClick={onClose} className="text-white/60 hover:text-white p-1">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
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
                        <div className="text-xs font-bold text-amber-900 truncate">{proj.name}</div>
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
                  {!planPending && <MetaLine meta={planMeta} className="text-[10px] text-slate-400 mt-0.5" />}
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
                  {extraFilled && <MetaLine meta={extraMeta} className="text-[10px] text-slate-400 mt-0.5" />}
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
              <div className="text-xs font-black text-slate-400 uppercase tracking-wider mb-2">🟢 {wkLabel}已完成打卡任務 ({completed.length} 項)</div>
              <div className="space-y-2">
                {completed.map(({ proj, task, log }) => (
                  <button key={task.id} onClick={() => onSelect({ proj, task }, log)}
                    className="w-full text-left bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl p-3 transition group opacity-90">
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 pr-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-slate-600 truncate">{proj.name}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${log.status === 'executed' ? 'bg-green-100 text-green-800' : log.status === 'monitor' ? 'bg-sky-100 text-sky-800' : 'bg-slate-200 text-slate-700'}`}>
                            {STATUS_META[log.status]?.icon} {STATUS_META[log.status]?.label}
                          </span>
                        </div>
                        <div className="text-xs font-medium text-slate-700 mt-1 truncate">{task.name}</div>
                        {log.updatedAt && (
                          <div className="text-[10px] text-slate-400 mt-0.5">🕘 最後編輯 {log.updatedAt}{log.reporterRole === 'manager' ? '・✏️ 主管修正' : ''}</div>
                        )}
                      </div>
                      <div className="flex-shrink-0 text-slate-500 font-bold text-xs bg-white border border-slate-200 rounded-full px-2.5 py-1 group-hover:border-slate-400 transition">
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
        <div className="p-4 bg-slate-50 border-t border-slate-200">
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
            : <div className="text-xs text-slate-400 italic mt-1">{emptyText}</div>}
          {value && <MetaLine meta={meta} showManagerTag={showManagerTag} className="text-[10px] text-slate-400 mt-0.5" />}
        </div>
        <div className="flex-shrink-0 text-slate-600 font-bold text-xs bg-white border border-slate-300 rounded-full px-3 py-1.5 group-hover:bg-slate-700 group-hover:text-white transition">
          編輯 ›
        </div>
      </div>
    </button>
  );

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[105] flex justify-end">
      <div className="w-full max-w-md bg-white h-full shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 text-white flex flex-col space-y-3" style={{ backgroundColor: '#92400E' }}>
          <div className="flex justify-between items-center">
            <div>
              <h3 className="font-bold text-lg">🛠 W{wk} 回報編輯（主管）</h3>
              <p className="text-xs text-amber-200 mt-0.5">代成員補登/修正此週回報，異動會標記主管修正並留下稽核紀錄</p>
            </div>
            <button onClick={onClose} className="text-white/60 hover:text-white p-1">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
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
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-center text-slate-400 text-xs italic">此週無排定任務</div>
            ) : (
              <div className="space-y-2.5">
                {rows.map(({ proj, task, log }) => (
                  <button key={task.id} onClick={() => onSelectTask(proj, task, log)}
                    className={`w-full text-left border rounded-xl p-3 transition group shadow-sm ${log ? 'bg-slate-50 hover:bg-slate-100 border-slate-200' : 'bg-yellow-50 hover:bg-yellow-100 border-yellow-300'}`}>
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 pr-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-slate-700 truncate">{proj.name}</span>
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
                          <div className="text-[10px] text-slate-400 mt-0.5">🕘 最後編輯 {log.updatedAt}{log.reporter ? `（${log.reporter}）` : ''}</div>
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

        <div className="p-4 bg-slate-50 border-t border-slate-200">
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
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[140] flex justify-center items-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* 標題列顏色一律用行內樣式:企業內網若快取到舊版 app.css,新 class 不存在會變白底白字 */}
        <div className="px-6 py-4 text-white flex justify-between items-center" style={{ backgroundColor: '#7C3AED' }}>
          <div>
            <h3 className="font-bold text-lg" style={{ color: '#FFFFFF' }}>💬 回覆 {member} 的 W{String(currentWeek).padStart(2, '0')} 週報</h3>
            <p className="text-xs mt-0.5" style={{ color: '#EDE9FE' }}>主管建議(選填)，儲存後全體成員於團隊總結看板可見</p>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white"><svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
        </div>
        <div className="p-6">
          {initialComment ? (
            <div className="mb-4 bg-violet-50 border border-violet-300 text-violet-800 rounded-lg px-3 py-2.5 text-sm font-bold">
              <div className="flex items-center"><span className="mr-2">✅</span> 本週已回覆過，以下為已儲存的內容，可修改後重新送出。</div>
              <MetaLine meta={meta} showManagerTag={false} className="text-[11px] text-violet-700 font-medium mt-1" />
            </div>
          ) : (
            <div className="mb-4 bg-slate-50 border border-slate-300 text-slate-600 rounded-lg px-3 py-2.5 text-sm font-bold flex items-center">
              <span className="mr-2">📭</span> 本週尚未回覆此成員。
            </div>
          )}
          <p className="text-sm text-slate-500 mb-4 border-l-4 border-violet-400 pl-3">
            針對 {member} 本週的回報結果給予回饋或建議（工作方向、優先順序、提醒事項等）。
            <span className="block mt-1 text-slate-400">此欄為選填，隨時可清空內容後儲存。</span>
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
function MetaLine({ meta, showManagerTag = true, className = 'text-[10px] text-slate-400 mt-1' }) {
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

function WeeklyReportDashboard({ currentWeek, year, users, projects, taskLogs, extraNotes, weeklyPlans = {}, weeklyComments = {}, extraNoteMeta = {}, weeklyPlanMeta = {}, weeklyCommentMeta = {}, currentUser, role, onEditComment, onClose }) {
  const isManager = role === 'manager';
  const [copied, setCopied] = useState(false);           // 全團隊複製回饋
  const [copiedUser, setCopiedUser] = useState(null);     // 個別成員複製回饋
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
    <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="space-y-2.5">
        <div className="text-xs font-bold text-slate-400 border-b border-slate-100 pb-1">📌 專案執行項目</div>
        {activeTasks.length > 0 ? activeTasks.map(({ proj, task, log }) => (
          <div key={task.id} className={`text-sm p-2.5 rounded-lg border ${log.status === 'not_executed' ? 'bg-slate-100 border-slate-200 opacity-80' : log.status === 'monitor' ? 'bg-sky-50/70 border-sky-200' : 'bg-green-50/60 border-green-200'}`}>
            <div className="flex items-center justify-between">
              <div className="font-bold text-slate-700 truncate text-xs pr-2">{proj.name}</div>
              <div className="flex-shrink-0 flex items-center gap-1">
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${STATUS_META[log.status]?.tag}`}>{STATUS_META[log.status]?.label}</span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-700" title="打卡得分">{Number(log.score ?? 1)}分</span>
                {log.reporterRole === 'manager' && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300" title="此筆由主管代為修正/補登">✏️主管</span>
                )}
              </div>
            </div>
            <div className="text-slate-600 my-1 font-medium text-xs">{task.name}</div>
            {log.note && <div className="text-slate-700 text-xs bg-white p-1.5 rounded border border-slate-100 whitespace-pre-wrap">{log.note}</div>}
            {log.updatedAt && <div className="text-[10px] text-slate-400 mt-1">🕘 最後編輯 {log.updatedAt}{log.reporter ? `（${log.reporter}）` : ''}</div>}
          </div>
        )) : <div className="text-sm text-slate-400 italic py-2">本週無專案投入</div>}
        {pendingTasks.length > 0 && (
          <div className="text-[11px] text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-lg px-2.5 py-1.5">
            尚有 {pendingTasks.length} 項本週排定任務未回報
          </div>
        )}
      </div>
      <div className="space-y-2.5 md:border-l md:border-slate-100 md:pl-4">
        <div className="text-xs font-bold text-slate-400 border-b border-slate-100 pb-1">📝 日常營運 / 臨時交辦（非專案）</div>
        {extraNote ? (
          <div>
            <div className="text-sm text-slate-700 bg-orange-50 p-3 rounded-lg border border-orange-200 whitespace-pre-wrap">{extraNote}</div>
            <MetaLine meta={extraMeta} />
          </div>
        ) : <div className="text-sm text-slate-400 italic py-2">無填寫其他項目</div>}
        <div className="text-xs font-bold text-slate-400 border-b border-slate-100 pb-1 pt-1">📅 下週預計執行工作</div>
        {weekPlan ? (
          <div>
            <div className="text-sm text-slate-700 bg-indigo-50 p-3 rounded-lg border border-indigo-200 whitespace-pre-wrap">{weekPlan}</div>
            <MetaLine meta={planMeta} />
          </div>
        ) : <div className="text-sm text-slate-400 italic py-2">未填寫</div>}
      </div>
      {/* 主管回覆（選填）：有內容才顯示，全體成員可見 */}
      {comment && (
        <div className="md:col-span-2">
          <div className="text-xs font-bold text-violet-700 border-b border-violet-100 pb-1 mb-2">👑 主管回覆</div>
          <div className="text-sm text-slate-800 bg-violet-50 p-3 rounded-lg border border-violet-300 whitespace-pre-wrap">{comment}</div>
          <MetaLine meta={commentMeta} showManagerTag={false} />
        </div>
      )}
    </div>
  );

  return (
    <div className="fixed inset-y-0 right-0 w-full max-w-2xl bg-slate-50 shadow-2xl z-[120] flex flex-col border-l border-slate-200">
      <div className="px-6 py-4 text-white flex justify-between items-center shadow-md" style={{ backgroundColor: '#001F5B' }}>
        <div>
          <h2 className="font-bold text-xl">📊 W{String(currentWeek).padStart(2, '0')} 團隊工作總結看板</h2>
          <p className="text-xs text-blue-200 mt-1">彙總各成員「專案實際執行」與「非專案事項」</p>
        </div>
        <div className="flex items-center space-x-2">
          <button onClick={exportExcel} disabled={exporting}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition border text-white disabled:opacity-70 ${exportFailed ? 'bg-red-600 hover:bg-red-500 border-red-400/60' : 'bg-green-600 hover:bg-green-500 border-green-400/60'}`}
            title="下載 Excel 週報(.xlsx)">
            {exporting ? '⏳ 產生中…' : exportFailed ? '❌ 匯出失敗，點擊重試' : '⬇️ 匯出 Excel'}
          </button>
          <button onClick={copyReport}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition border ${copied ? 'bg-green-500 border-green-400 text-white' : 'bg-white/10 hover:bg-white/20 border-white/20 text-white'}`}>
            {copied ? '✓ 已複製' : '📋 複製週報文字'}
          </button>
          <button onClick={onClose} className="text-white hover:bg-white/20 p-2 rounded-full"><svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
        </div>
      </div>

      {/* 子工具列：checkbox 篩選 + 展開/收合 */}
      <div className="bg-white px-6 py-2 border-b border-slate-200 flex items-center gap-2 flex-wrap">
        {!isManager && (
          <label className="flex items-center space-x-1.5 cursor-pointer select-none bg-slate-50 border border-slate-200 rounded-lg px-2 py-1">
            <input type="checkbox" checked={onlyMine}
              onChange={e => { setOnlyMine(e.target.checked); if (!e.target.checked) setExpandedUsers(new Set()); else setExpandedUsers(new Set([currentUser])); }}
              className="w-3.5 h-3.5 rounded text-blue-600" />
            <span className="font-medium text-slate-700 text-[11px]">只看我的週報</span>
          </label>
        )}
        {showTeamView && (
          <>
            {!isManager && <div className="h-4 border-l border-slate-200"></div>}
            <button onClick={expandAll} className="text-[11px] text-blue-600 hover:text-blue-800 font-bold">展開全部</button>
            <span className="text-slate-300">|</span>
            <button onClick={collapseAll} className="text-[11px] text-blue-600 hover:text-blue-800 font-bold">收合全部</button>
          </>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {visibleSummary.map((s) => {
          const { user, activeTasks, pendingTasks, extraNote, weekPlan, total } = s;
          if (activeTasks.length === 0 && !extraNote && !weekPlan && pendingTasks.length === 0) return null;
          const rate = total > 0 ? Math.round((activeTasks.length / total) * 100) : 0;
          const isExpanded = showTeamView ? expandedUsers.has(user) : true;   // 個人模式固定展開
          const isCopiedUser = copiedUser === user;

          return (
            <div key={user} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className={`bg-slate-100 px-4 py-2 border-b border-slate-200 font-bold text-slate-800 flex items-center ${showTeamView ? 'cursor-pointer hover:bg-slate-200/70 transition' : ''}`}
                onClick={showTeamView ? () => toggleExpand(user) : undefined}>
                {showTeamView && (
                  <span className="mr-1.5 text-slate-400 text-xs select-none">{isExpanded ? '▼' : '▶'}</span>
                )}
                <div className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs mr-2 flex-shrink-0">{user[0]}</div>
                <span className="mr-3">{user}</span>
                {total > 0 && (
                  <div className="flex items-center flex-1 max-w-[260px]">
                    <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${rate === 100 ? 'bg-green-500' : rate >= 50 ? 'bg-blue-500' : 'bg-yellow-400'}`} style={{ width: `${rate}%` }}></div>
                    </div>
                    <span className="ml-2 text-[10px] font-bold text-slate-500 whitespace-nowrap">{activeTasks.length}/{total} 回報</span>
                    {/* 個人週得分:已回報任務分數加總/滿分(=排定任務數);滿分綠、其餘靛藍 */}
                    <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap ${s.weekScore >= total ? 'bg-green-100 text-green-800 border-green-400' : 'bg-indigo-100 text-indigo-800 border-indigo-400'}`}
                      title={`本週得分＝各任務打卡分數加總（回報預設 1 分、主管可調 0.3~1；未回報 0 分）／滿分＝本週排定任務數`}>
                      🏆 {s.weekScore}/{total} 分
                    </span>
                  </div>
                )}
                {/* 折疊時在標題列右側顯示摘要標籤 */}
                {!isExpanded && showTeamView && (
                  <div className="ml-auto flex items-center gap-1.5 text-[10px]">
                    {activeTasks.length > 0 && <span className="bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-bold border border-green-300">✅{activeTasks.filter(a => a.log.status === 'executed').length}</span>}
                    {activeTasks.filter(a => a.log.status === 'monitor').length > 0 && <span className="bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded font-bold border border-sky-300">👁️{activeTasks.filter(a => a.log.status === 'monitor').length}</span>}
                    {pendingTasks.length > 0 && <span className="bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded font-bold border border-yellow-300">❗{pendingTasks.length}</span>}
                    {extraNote && <span className="bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-bold border border-orange-300">📝</span>}
                    {weekPlan && <span className="bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-bold border border-indigo-300">📅</span>}
                    {s.comment && <span className="bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded font-bold border border-violet-300" title="已有主管回覆">💬</span>}
                  </div>
                )}
                {/* 個別成員複製按鈕（永遠顯示） */}
                <button onClick={(e) => { e.stopPropagation(); copyUserReport(s); }}
                  className={`ml-auto px-2 py-0.5 rounded text-[10px] font-bold transition border ${isCopiedUser ? 'bg-green-500 border-green-400 text-white' : 'bg-slate-200 hover:bg-slate-300 border-slate-300 text-slate-600'}`}
                  title={`複製 ${user} 的週報文字`}>
                  {isCopiedUser ? '✓ 已複製' : '📋 複製週報'}
                </button>
                {/* 主管專屬：回覆本週週報（選填，全體成員可見） */}
                {isManager && onEditComment && (
                  <button onClick={(e) => { e.stopPropagation(); onEditComment(user); }}
                    className={`ml-1.5 px-2 py-0.5 rounded text-[10px] font-bold transition border ${s.comment ? 'bg-violet-100 hover:bg-violet-200 border-violet-400 text-violet-800' : 'bg-slate-200 hover:bg-slate-300 border-slate-300 text-slate-600'}`}
                    title={s.comment ? `編輯對 ${user} 的本週回覆` : `回覆 ${user} 的本週週報（選填）`}>
                    {s.comment ? '💬 編輯回覆' : '💬 主管回覆'}
                  </button>
                )}
              </div>
              {isExpanded && renderCardBody(s)}
            </div>
          );
        })}
        {visibleSummary.filter(s => s.activeTasks.length > 0 || s.extraNote || s.weekPlan || s.pendingTasks.length > 0).length === 0 && (
          <div className="text-center text-slate-400 italic py-12">本週尚無回報資料</div>
        )}
      </div>
    </div>
  );
}




function ProjectEditModal({ info, existingCategories, users = [], onClose, onSave }) {
  const isEdit = info.mode === 'edit';
  const p = info.project;
  const [name, setName] = useState(isEdit ? p.name : '');
  const [category, setCategory] = useState(isEdit ? p.category : '');
  const [type, setType] = useState(isEdit ? p.type : 'a');
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
        type
      });
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[130] flex justify-center items-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 text-white flex justify-between items-center" style={{ backgroundColor: '#001F5B' }}>
          <div>
            <h3 className="font-bold text-lg">{isEdit ? '✎ 編輯專案' : '＋ 新增專案'}</h3>
            <p className="text-xs text-blue-200 mt-0.5">負責人：{info.owner}</p>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white"><svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="text-xs font-bold text-slate-500">專案名稱</label>
            <input type="text" value={name} onChange={e => { setName(e.target.value); setError(''); markModalDirty(); }} autoFocus
              className="mt-1 w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500" placeholder="輸入專案名稱…" />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500">分類</label>
            <input type="text" list="category-options" value={category} onChange={e => { setCategory(e.target.value); setError(''); markModalDirty(); }}
              className="mt-1 w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500" placeholder="選擇現有分類或輸入新分類…" />
            <datalist id="category-options">
              {existingCategories.map(c => <option key={c} value={c} />)}
            </datalist>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500">類型</label>
            <select value={type} onChange={e => { setType(e.target.value); markModalDirty(); }}
              className="mt-1 w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500 bg-white">
              {Object.entries(PROJECT_TYPES).map(([key, meta]) => (
                <option key={key} value={key}>{key.toUpperCase()}·{meta.label}</option>
              ))}
            </select>
          </div>
          {isEdit && (
            <div>
              <label className="text-xs font-bold text-slate-500">負責人</label>
              <select value={owner} onChange={e => { setOwner(e.target.value); markModalDirty(); }}
                className="mt-1 w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500 bg-white">
                {(users.includes(owner) ? users : [owner, ...users]).map(u => <option key={u} value={u}>{u}</option>)}
              </select>
              {owner !== info.owner && (
                <div className="mt-1 text-[11px] text-orange-600 font-bold">⚠ 儲存後此專案(含區間與回報紀錄)將移轉給「{owner}」</div>
              )}
            </div>
          )}
          {error && <div className="text-xs text-red-600 font-bold">{error}</div>}
          <div className="flex justify-end space-x-3 pt-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 bg-slate-100 rounded-lg font-bold hover:bg-slate-200">取消</button>
            <button onClick={submit} disabled={saving} className="px-6 py-2 text-sm text-white font-bold rounded-lg shadow-md transition hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: '#001F5B' }}>{saving ? '儲存中…' : isEdit ? '儲存變更' : '新增專案'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function IntervalModal({ project, currentWeek, weeksTotal = WEEKS_TOTAL, onClose, onSave }) {
  const [taskName, setTaskName] = useState('');
  const [start, setStart] = useState(currentWeek);
  const [end, setEnd] = useState(currentWeek);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useModalDirtyReset();

  const submit = async () => {
    if (saving) return;
    const s = parseInt(start), e = parseInt(end);
    if (!taskName.trim()) { setError('計畫名稱不可空白'); return; }
    if (isNaN(s) || isNaN(e) || s < 1 || e > weeksTotal || s > e) { setError(`週次需介於 1–${weeksTotal}，且開始週不可晚於結束週`); return; }
    setSaving(true);
    try { await onSave(project, taskName.trim(), s, e); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[130] flex justify-center items-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 text-white flex justify-between items-center" style={{ backgroundColor: '#001F5B' }}>
          <div>
            <h3 className="font-bold text-lg">＋ 新增計畫區間</h3>
            <p className="text-xs text-blue-200 mt-0.5 truncate max-w-[300px]">{project.name}</p>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white"><svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="text-xs font-bold text-slate-500">計畫名稱</label>
            <input type="text" value={taskName} onChange={e => { setTaskName(e.target.value); setError(''); markModalDirty(); }} autoFocus
              className="mt-1 w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500" placeholder="輸入此區間的計畫項目…" />
          </div>
          <div className="flex space-x-3">
            <div className="w-1/2">
              <label className="text-xs font-bold text-slate-500">開始週</label>
              <input type="number" min="1" max={weeksTotal} value={start} onChange={e => { setStart(e.target.value); setError(''); markModalDirty(); }}
                className="mt-1 w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500" />
            </div>
            <div className="w-1/2">
              <label className="text-xs font-bold text-slate-500">結束週</label>
              <input type="number" min="1" max={weeksTotal} value={end} onChange={e => { setEnd(e.target.value); setError(''); markModalDirty(); }}
                className="mt-1 w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500" />
            </div>
          </div>
          {error && <div className="text-xs text-red-600 font-bold">{error}</div>}
          <div className="flex justify-end space-x-3 pt-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 bg-slate-100 rounded-lg font-bold hover:bg-slate-200">取消</button>
            <button onClick={submit} disabled={saving} className="px-6 py-2 text-sm text-white font-bold rounded-lg shadow-md transition hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: '#001F5B' }}>{saving ? '新增中…' : '新增區間'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// 自製刪除確認視窗(取代 window.confirm,樣式與系統一致)
function ConfirmModal({ info, onCancel }) {
  const [busy, setBusy] = useState(false);   // 防連點:確認處理中鎖定按鈕
  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try { await info.onConfirm(); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[150] flex justify-center items-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
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
    <div className="bg-white border border-slate-200 rounded-xl p-3 text-center shadow-sm">
      <div className="text-[11px] font-bold text-slate-500">{label}</div>
      <div className="text-2xl font-black text-slate-800 mt-0.5">{value}</div>
      {sub && <div className="text-[10px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[105] flex justify-end">
      <div className="w-full max-w-md bg-white h-full shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 text-white flex justify-between items-center" style={{ backgroundColor: '#0F766E' }}>
          <div>
            <h3 className="font-bold text-lg" style={{ color: '#FFFFFF' }}>📈 使用統計</h3>
            <p className="text-xs mt-0.5" style={{ color: '#99F6E4' }}>登入次數（含重新整理自動登入），評估網頁使用率</p>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white p-1"><svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
        </div>

        {/* 統計區間切換 */}
        <div className="bg-white px-5 py-2 border-b border-slate-200 flex items-center gap-1.5">
          <span className="text-[11px] font-bold text-slate-500 mr-1">統計區間</span>
          {[7, 30, 90].map(d => (
            <button key={d} onClick={() => setDays(d)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition ${days === d ? 'bg-teal-600 text-white border-teal-700' : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'}`}>
              近 {d} 天
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loadError ? (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm font-bold">❌ 載入失敗：{loadError}</div>
          ) : !stats ? (
            <div className="text-center text-slate-400 py-10">載入中…</div>
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
                <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm">
                  {stats.lastN === 0 ? (
                    <div className="text-center text-slate-400 italic text-xs py-6">此區間尚無登入紀錄</div>
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
                      <div className="flex justify-between text-[10px] text-slate-400 mt-1.5 font-medium">
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
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-center text-slate-400 text-xs italic">此區間尚無登入紀錄</div>
                ) : (
                  <div className="space-y-2">
                    {stats.byUser.map(u => (
                      <div key={u.user} className="bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-sm">
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
                        <div className="text-[10px] text-slate-400 mt-1">最後登入 {u.lastAt}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="text-[11px] text-slate-400 leading-relaxed">
                ※ 每次於登入畫面選擇身分、或重新整理／重開分頁自動還原登入，皆計一次。總累計（含更早期間）：{stats.total} 次。
              </div>
            </>
          )}
        </div>

        <div className="p-4 bg-slate-50 border-t border-slate-200">
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
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[105] flex justify-end">
      <div className="w-full max-w-md bg-white h-full shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 text-white flex justify-between items-center" style={{ backgroundColor: '#9F1239' }}>
          <div>
            <h3 className="font-bold text-lg" style={{ color: '#FFFFFF' }}>🔐 頁面瀏覽權限</h3>
            <p className="text-xs mt-0.5" style={{ color: '#FECDD3' }}>依人員名冊部門(DEPT_1/2/3)或工號白名單卡控，任一規則符合即可瀏覽</p>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white p-1"><svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loading ? (
            <div className="text-center text-slate-400 py-10">載入中…</div>
          ) : loadError ? (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm font-bold">
              ❌ 載入失敗：{loadError}
              <button onClick={load} className="ml-2 underline">重試</button>
            </div>
          ) : (
            <>
              {/* ① 總開關 */}
              <div className={`rounded-xl border p-4 ${enabled ? 'bg-rose-50 border-rose-300' : 'bg-slate-50 border-slate-200'}`}>
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
                <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-2.5 shadow-sm">
                  <div className="grid grid-cols-2 gap-2">
                    {RULE_FIELDS.map(f => (
                      <label key={f.key} className={f.key === 'deptName' ? 'col-span-1' : ''}>
                        <span className="block text-[10px] font-bold text-slate-500 mb-0.5">{f.label}</span>
                        <input type="text" value={ruleForm[f.key]}
                          onChange={e => setRuleForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter' && !e.isComposing) addRule(); }}
                          placeholder={f.ph}
                          className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-rose-500" />
                      </label>
                    ))}
                    <label>
                      <span className="block text-[10px] font-bold text-slate-500 mb-0.5">備註（選填）</span>
                      <input type="text" value={ruleNote} onChange={e => setRuleNote(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.isComposing) addRule(); }}
                        placeholder="如：MSD 全員"
                        className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-rose-500" />
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 text-[11px] text-slate-400 leading-snug">
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
                      <div key={r.id} className="bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-sm">
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1 flex-wrap min-w-0">
                            {RULE_FIELDS.filter(f => r[f.key]).map((f, i) => (
                              <React.Fragment key={f.key}>
                                {i > 0 && <span className="text-[10px] font-black text-slate-400">且</span>}
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold border whitespace-nowrap ${f.chip}`}>
                                  {f.label}＝{r[f.key]}
                                </span>
                              </React.Fragment>
                            ))}
                          </div>
                          <span className="ml-auto flex-shrink-0 text-[10px] text-slate-400" title={`建立者 ${r.createdBy || '-'}`}>{r.createdAt}</span>
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
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2.5">
                  <div className="flex gap-2">
                    <input type="text" value={testId} onChange={e => { setTestId(e.target.value); setTestResult(null); }}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.isComposing) runTest(); }}
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

        <div className="p-4 bg-slate-50 border-t border-slate-200">
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
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[115] flex justify-end">
      <div className="w-full max-w-sm bg-white h-full shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 text-white flex justify-between items-center" style={{ backgroundColor: NAVY }}>
          <div>
            <h3 className="font-bold text-lg">👥 成員管理</h3>
            <p className="text-xs text-blue-200 mt-0.5">新增的成員即可登入回報，並可為其安排專案</p>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white p-1"><svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
        </div>

        <div className="p-4 border-b border-slate-200 bg-slate-50">
          <label className="text-xs font-bold text-slate-500">新增成員</label>
          <div className="mt-1 flex gap-2">
            <input value={name} onChange={e => { setName(e.target.value); setError(''); }}
              onKeyDown={e => { if (e.key === 'Enter') submit(); }}
              placeholder="輸入新成員顯示名稱…" autoFocus
              className={`flex-1 border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 ${error ? 'border-red-400' : 'border-slate-300'}`} />
            <button onClick={submit} disabled={saving}
              className="flex-shrink-0 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-sm transition hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: NAVY }}>
              {saving ? '新增中…' : '＋ 新增'}
            </button>
          </div>
          {error && <div className="mt-1.5 text-xs text-red-600 font-bold">{error}</div>}
          <p className="mt-2 text-[11px] text-slate-400 leading-relaxed">
            新增後成員會出現在登入畫面與甘特圖，可直接為其新增專案並開始每週打卡回報。
            若輸入曾被移除的同名成員，會自動重新啟用並還原其歷史資料。
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          <div className="text-xs font-bold text-slate-400 mb-1">現有成員（{users.length} 位）</div>
          {users.map(u => {
            const projCount = projects.filter(p => p.owner === u).length;
            const isEditing = editing?.old === u;
            return (
              <div key={u} className="flex items-center bg-white border border-slate-200 rounded-xl p-3 shadow-sm">
                <div className="w-8 h-8 rounded-full text-white flex items-center justify-center text-sm mr-3 flex-shrink-0" style={{ backgroundColor: NAVY }}>{u[0]}</div>
                {isEditing ? (
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <input value={editing.value} autoFocus
                        onChange={e => setEditing(prev => ({ ...prev, value: e.target.value, error: '' }))}
                        onKeyDown={e => { if (e.key === 'Enter') submitRename(); if (e.key === 'Escape') setEditing(null); }}
                        className={`flex-1 min-w-0 border rounded-lg px-2 py-1 text-sm outline-none focus:border-blue-500 ${editing.error ? 'border-red-400' : 'border-slate-300'}`} />
                      <button onClick={submitRename} disabled={renaming}
                        className="flex-shrink-0 px-2 py-1 rounded-lg text-xs font-bold text-white transition hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: NAVY }}>
                        {renaming ? '…' : '✓ 儲存'}
                      </button>
                      <button onClick={() => setEditing(null)}
                        className="flex-shrink-0 px-2 py-1 rounded-lg text-xs font-bold text-slate-500 bg-slate-100 hover:bg-slate-200 transition">✕</button>
                    </div>
                    {editing.error
                      ? <div className="mt-1 text-[11px] text-red-600 font-bold">{editing.error}</div>
                      : <div className="mt-1 text-[11px] text-slate-400">改名後其專案與歷史回報自動跟隨新名稱</div>}
                  </div>
                ) : (
                  <>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-sm text-slate-700 truncate">{u}</div>
                      <div className="text-[11px] text-slate-400">{year} 年度專案 {projCount} 項</div>
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
          {users.length === 0 && <div className="text-center text-slate-400 py-10 text-sm">尚無成員，請於上方新增。</div>}
        </div>
      </div>
    </div>
  );
}

function AuditPanel({ onClose }) {
  const [logs, setLogs] = useState(null);   // null=載入中
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');

  React.useEffect(() => {
    apiGet('/api/audit-log?top=300')
      .then(d => setLogs(d.logs || []))
      .catch(e => setError(e.message || '無法連線資料庫'));
  }, []);

  const shown = useMemo(() => {
    if (!logs) return [];
    const kw = filter.trim().toLowerCase();
    if (!kw) return logs;
    return logs.filter(l =>
      `${l.actor} ${l.empId || ''} ${l.action} ${l.entityType} ${l.entityId || ''} ${l.summary || ''} ${l.newValue || ''} ${l.detail || ''} ${l.at}`.toLowerCase().includes(kw));
  }, [logs, filter]);

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[115] flex justify-end">
      <div className="w-full max-w-lg bg-white h-full shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 text-white flex justify-between items-center" style={{ backgroundColor: NAVY }}>
          <div>
            <h3 className="font-bold text-lg">📜 異動紀錄</h3>
            <p className="text-xs text-blue-200 mt-0.5">最近 300 筆操作稽核（誰、何時、做了什麼）</p>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white p-1"><svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
        </div>
        <div className="p-3 border-b border-slate-200 bg-slate-50">
          <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="篩選：人員 / 動作 / 專案 / 內容…"
            className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-xs outline-none focus:border-blue-500" />
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5 text-xs">
          {error ? (
            <div className="text-red-600 bg-red-50 border border-red-100 rounded-lg p-3">{error}</div>
          ) : logs === null ? (
            <div className="text-center text-slate-400 py-10">載入中…</div>
          ) : shown.length === 0 ? (
            <div className="text-center text-slate-400 py-10">沒有符合的紀錄</div>
          ) : shown.map(l => {
            const meta = AUDIT_ACTION_META[l.action] || { label: l.action, cls: 'bg-slate-100 text-slate-600' };
            return (
              // title 保留技術識別碼(如 t101-1@2026W9),畫面上只顯示後端翻譯好的白話摘要(summary)
              <div key={l.id} className="border border-slate-200 rounded-lg p-2.5 hover:bg-slate-50" title={`${l.entityType}${l.entityId ? ' ' + l.entityId : ''}`}>
                <div className="flex items-center gap-2">
                  <span className={`flex-shrink-0 px-1.5 py-0.5 rounded font-bold ${meta.cls}`}>{meta.label}</span>
                  <span className="font-bold text-slate-700">{AUDIT_ENTITY_LABELS[l.entityType] || l.entityType}</span>
                  <span className="flex-shrink-0 text-slate-500 font-medium ml-1">
                    {l.actor}{l.role === 'manager' ? '（主管）' : ''}
                    {l.empId && <span className="ml-1 px-1 py-px rounded bg-slate-100 text-slate-400 font-mono text-[10px]" title="操作者 Windows 工號">{l.empId}</span>}
                  </span>
                  <span className="ml-auto flex-shrink-0 text-slate-400">{l.at}</span>
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
