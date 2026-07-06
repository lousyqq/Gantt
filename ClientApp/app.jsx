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

const PROJECT_TYPES = {
  'a': { label: '一級專案/KPI', chip: 'bg-pink-100 text-pink-800 border-pink-300', dot: 'bg-pink-400' },
  'b': { label: '重大貢獻及亮點', chip: 'bg-yellow-100 text-yellow-800 border-yellow-300', dot: 'bg-yellow-400' },
  'c': { label: '日常管理', chip: 'bg-teal-100 text-teal-800 border-teal-300', dot: 'bg-teal-400' },
  'd': { label: '其他加分項', chip: 'bg-orange-100 text-orange-800 border-orange-300', dot: 'bg-orange-400' }
};

const STATUS_META = {
  executed:     { label: '有執行', icon: '✅', bar: 'bg-green-500 border-green-600 text-white', tag: 'bg-green-100 text-green-700', dot: 'bg-green-500' },
  monitor:      { label: 'Monitor', icon: '👁️', bar: 'bg-sky-500 border-sky-600 text-white', tag: 'bg-sky-100 text-sky-700', dot: 'bg-sky-500' },
  not_executed: { label: '未執行', icon: '⏸️', bar: 'bg-slate-400 border-slate-500 text-white', tag: 'bg-slate-200 text-slate-600', dot: 'bg-slate-400' }
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

// 週 -> 月份標籤
const weekToMonth = (w, months = MONTHS) => {
  let acc = 0;
  for (const m of months) {
    acc += m.weeks;
    if (w <= acc) return `${m.name.slice(0, 4)}/${m.name.slice(4)}`;
  }
  return '';
};

function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [role, setRole] = useState(null);
  const [currentWeek, setCurrentWeek] = useState(DEFAULT_CURRENT_WEEK);
  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState(null);
  const [empId, setEmpId] = useState(null);   // Windows 工號(顯示用;實際寫入由 apiPost 自動附帶)

  // 載入時偵測一次 Windows 工號(非網域環境取不到 → null,系統照常運作)
  React.useEffect(() => { detectEmpId().then(setEmpId); }, []);

  // 年度切換:可用年度與週→月對照皆來自 DB 的 ScheduleWeeks(開新年度只需 EXEC usp_EnsureScheduleYear)
  const [scheduleYear, setScheduleYear] = useState(DEFAULT_SCHEDULE_YEAR);
  const [years, setYears] = useState([]);
  const [months, setMonths] = useState(MONTHS);
  const weeksTotal = useMemo(() => months.reduce((s, m) => s + m.weeks, 0), [months]);

  // UI 狀態
  const [isCompact, setIsCompact] = useState(true);
  const [collapsedOwners, setCollapsedOwners] = useState(new Set());
  const [searchText, setSearchText] = useState('');
  const [typeFilter, setTypeFilter] = useState(new Set());       // 空 = 全部
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [onlyMine, setOnlyMine] = useState(false);
  const [tooltip, setTooltip] = useState(null);                  // {x, y, proj, task, weekLog, history}
  const ganttRef = useRef(null);

  // 紀錄打卡與非專案工作
  const [taskLogs, setTaskLogs] = useState({});
  const [extraNotes, setExtraNotes] = useState({});

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
    setTaskLogs(data.taskLogs || {});
    setExtraNotes(data.extraNotes || {});
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
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const showToast = (msg) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  };
  const [showWeeklyReport, setShowWeeklyReport] = useState(false);
  const [showPendingPanel, setShowPendingPanel] = useState(false);
  const [showAuditPanel, setShowAuditPanel] = useState(false);   // 主管:異動紀錄(AuditLog)面板
  const [showMemberPanel, setShowMemberPanel] = useState(false); // 主管:成員管理面板

  const weekW = isCompact ? 22 : 32;
  const todayWeek = getTodayWeek(scheduleYear, weeksTotal);   // 本週(相對於選定年度)
  const isViewingPast = currentWeek !== todayWeek;  // 是否在檢視非本週

  const handleLogin = (user, selectedRole) => {
    setCurrentUser(user);
    setRole(selectedRole);
    setCurrentWeek(getTodayWeek(scheduleYear, weeksTotal));
    setOnlyMine(selectedRole === 'member');
    setOwnerFilter('all');
    setSearchText('');
    setTypeFilter(new Set());
  };

  const handleLogout = () => {
    setCurrentUser(null); setRole(null);
    setShowPendingPanel(false); setShowWeeklyReport(false);
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
    const LEFT_W = 430;
    const target = LEFT_W + (wk - 1) * weekW - (el.clientWidth - LEFT_W) / 2;
    el.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
  }, [weekW]);

  const goToCurrentWeek = () => {
    const tw = getTodayWeek(scheduleYear, weeksTotal);   // 動態取得今天的實際週(W27、下週為 W28…)
    setCurrentWeek(tw);                 // 將選取週強制切回本週
    setScrollTargetWeek(tw);            // 觸發 effect,於畫面更新後捲動定位
  };

  // 選取週更新後才捲動,確保「選取週」與「畫面位置」同步
  React.useEffect(() => {
    if (scrollTargetWeek == null) return;
    scrollToWeek(scrollTargetWeek);
    setScrollTargetWeek(null);
  }, [scrollTargetWeek, scrollToWeek]);

  const handleSaveLog = async (taskId, status, note) => {
    try {
      await apiPost('/api/weekly-log', {
        taskCode: taskId, year: scheduleYear, week: currentWeek,
        status, note, actor: currentUser, actorRole: role
      });
      setTaskLogs(prev => ({
        ...prev,
        [taskId]: { ...prev[taskId], [currentWeek]: { isExecuting: status !== 'not_executed', status, note } }
      }));
      setSelectedTaskInfo(null);
      showToast(`✅ W${String(currentWeek).padStart(2, '0')} 任務回報已送出`);
    } catch (e) {
      showToast('❌ 儲存失敗：' + (e.message || '無法連線資料庫'));
    }
  };

  const handleSaveExtraNote = async (note) => {
    try {
      await apiPost('/api/extra-note', {
        userName: currentUser, year: scheduleYear, week: currentWeek,
        note, actor: currentUser, actorRole: role
      });
      setExtraNotes(prev => ({
        ...prev,
        [currentUser]: { ...prev[currentUser], [currentWeek]: note }
      }));
      setShowExtraNoteModal(false);
      showToast(`✅ W${String(currentWeek).padStart(2, '0')} 非專案事項已送出`);
    } catch (e) {
      showToast('❌ 儲存失敗：' + (e.message || '無法連線資料庫'));
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

  // 多人共用時每 60 秒靜默刷新,讓其他人的變更自動出現(拖曳中暫停以免干擾;失敗靜默忽略,下輪再試)
  React.useEffect(() => {
    if (!currentUser || dragState) return;
    const timer = setInterval(() => { refreshData().catch(() => {}); }, 60000);
    return () => clearInterval(timer);
  }, [currentUser, dragState, refreshData]);

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
          showToast('✅ 專案已刪除');
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
          showToast('✅ 計畫區間已刪除');
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
      if (onlyMine && role === 'member' && p.owner !== currentUser) return false;
      if (!onlyMine && ownerFilter !== 'all' && p.owner !== ownerFilter) return false;
      if (typeFilter.size > 0 && !typeFilter.has(p.type)) return false;
      if (kw) {
        const hay = `${p.name} ${p.category} ${p.owner} ${p.tasks.map(t => t.name).join(' ')}`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
  }, [projects, searchText, typeFilter, ownerFilter, onlyMine, role, currentUser]);

  // 主管未啟用搜尋/類型篩選時，沒有專案的成員(如剛加入的新同仁)也要顯示群組列,才能為其新增專案
  const groupedProjects = useMemo(() =>
    users.map(user => ({ owner: user, projects: filteredProjects.filter(p => p.owner === user) }))
      .filter(g => g.projects.length > 0 ||
        (role === 'manager' && !isFilteringRows && (ownerFilter === 'all' || ownerFilter === g.owner)))
  , [filteredProjects, users, role, isFilteringRows, ownerFilter]);

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

  const showTooltip = (e, proj, task) => {
    const weekLog = taskLogs[task.id]?.[currentWeek];
    const history = Object.entries(taskLogs[task.id] || {})
      .filter(([w]) => Number(w) !== currentWeek)
      .sort((a, b) => Number(a[0]) - Number(b[0]));
    setTooltip({ x: e.clientX, y: e.clientY, proj, task, weekLog, history });
  };
  const moveTooltip = (e) => setTooltip(prev => prev ? { ...prev, x: e.clientX, y: e.clientY } : null);
  const hideTooltip = () => setTooltip(null);

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
              <span className="text-white/60 mr-2 text-xs font-medium">系統週數</span>
              {role === 'manager' ? (
                <div className="flex items-center space-x-1.5">
                  <button onClick={() => setCurrentWeek(p => Math.max(1, p - 1))} className="w-5 h-5 flex items-center justify-center bg-white/10 hover:bg-white/30 rounded-full text-xs font-bold transition" title="上一週">‹</button>
                  <span className="font-bold text-sm tracking-wider text-center" style={{ color: GOLD, minWidth: 100 }}>W{String(currentWeek).padStart(2, '0')}<span className="text-white/40 font-normal text-[10px] ml-1">{weekToMonth(currentWeek, months)}</span></span>
                  <button onClick={() => setCurrentWeek(p => Math.min(weeksTotal, p + 1))} className="w-5 h-5 flex items-center justify-center bg-white/10 hover:bg-white/30 rounded-full text-xs font-bold transition" title="下一週">›</button>
                </div>
              ) : (
                <div className="flex items-center space-x-1.5">
                  <button onClick={() => setCurrentWeek(p => Math.max(1, p - 1))} className="w-5 h-5 flex items-center justify-center bg-white/10 hover:bg-white/30 rounded-full text-xs font-bold transition" title="檢視前一週(唯讀)">‹</button>
                  <span className="font-bold text-sm tracking-wider text-center" style={{ color: GOLD, minWidth: 100 }}>W{String(currentWeek).padStart(2, '0')}<span className="text-white/40 font-normal text-[10px] ml-1">{weekToMonth(currentWeek, months)}</span></span>
                  <button onClick={() => setCurrentWeek(p => Math.min(todayWeek, p + 1))} disabled={currentWeek >= todayWeek}
                    className={`w-5 h-5 flex items-center justify-center rounded-full text-xs font-bold transition ${currentWeek >= todayWeek ? 'bg-white/5 text-white/20 cursor-not-allowed' : 'bg-white/10 hover:bg-white/30'}`} title="檢視後一週">›</button>
                </div>
              )}
              {role === 'member' && isViewingPast && (
                <button onClick={() => setCurrentWeek(todayWeek)}
                  className="ml-2 flex items-center bg-yellow-500/90 hover:bg-yellow-400 text-slate-900 text-[10px] font-bold px-2 py-0.5 rounded-full transition">
                  🔒 唯讀檢視中 · 返回本週 W{String(todayWeek).padStart(2, '0')}
                </button>
              )}
            </div>
          )}
        </div>

        {currentUser && (
          <div className="flex items-center space-x-2">
            {role === 'member' && (
              <>
                <button onClick={() => setShowPendingPanel(true)}
                  className="relative bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-md text-xs font-bold shadow transition flex items-center border border-white/20">
                  🔔 本週待回報
                  {myPendingTasks.length > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center font-bold border-2 border-white/40 shadow">{myPendingTasks.length}</span>
                  )}
                </button>
                <button onClick={() => setShowExtraNoteModal(true)}
                  className={`relative px-3 py-1.5 rounded-md text-xs font-bold shadow transition border ${isViewingPast ? 'bg-slate-500 hover:bg-slate-400 border-slate-400/50 text-white' : extraNotes[currentUser]?.[currentWeek] ? 'bg-green-600 hover:bg-green-500 border-green-400/50 text-white' : 'bg-orange-500 hover:bg-orange-400 border-orange-400/50 text-white'}`}>
                  {isViewingPast ? `🔒 檢視 W${String(currentWeek).padStart(2, '0')} 非專案事項` : extraNotes[currentUser]?.[currentWeek] ? '✓ 非專案事項(已填寫)' : '📝 非專案事項(未填寫)'}
                </button>
              </>
            )}
            {role === 'manager' && (
              <>
                <button onClick={() => setShowMemberPanel(true)}
                  className="bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-md text-xs font-bold shadow transition border border-white/20">
                  👥 成員管理
                </button>
                <button onClick={() => setShowAuditPanel(true)}
                  className="bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-md text-xs font-bold shadow transition border border-white/20">
                  📜 異動紀錄
                </button>
              </>
            )}
            <button onClick={() => setShowWeeklyReport(true)}
              className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-md text-xs font-bold shadow transition border border-blue-400/50">
              📊 W{String(currentWeek).padStart(2, '0')} 團隊總結
            </button>
            <div className="flex items-center space-x-3 border-l border-white/20 pl-3 ml-1">
              <div className="text-right leading-tight">
                <div className="font-bold text-sm">{currentUser}</div>
                <div className="text-[10px] text-white/50">{role === 'manager' ? '主管' : '成員'}{empId ? ` · 工號 ${empId}` : ''}</div>
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
          <div className="px-4 py-2 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white flex items-center gap-3 text-xs overflow-x-auto">
            <div className="flex items-center flex-shrink-0">
              <span className="font-black text-slate-800 text-sm">W{String(currentWeek).padStart(2, '0')}</span>
              <span className="text-slate-400 ml-1 text-[10px]">{weekToMonth(currentWeek, months)} 概況</span>
            </div>
            {/* 回報率進度條 */}
            <div className="flex items-center flex-shrink-0 min-w-[150px]">
              <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-500 ${weekStats.active > 0 && weekStats.reported === weekStats.active ? 'bg-green-500' : 'bg-indigo-500'}`}
                  style={{ width: `${weekStats.active > 0 ? (weekStats.reported / weekStats.active) * 100 : 0}%` }}></div>
              </div>
              <span className="ml-2 font-bold text-slate-600 whitespace-nowrap">{weekStats.reported}/{weekStats.active} 已回報</span>
            </div>
            <div className="h-6 border-l border-slate-200 flex-shrink-0"></div>
            {/* 狀態分佈 */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <StatChip label="有執行" value={weekStats.executed} className="bg-green-100 text-green-700" />
              <StatChip label="Monitor" value={weekStats.monitor} className="bg-sky-100 text-sky-700" />
              <StatChip label="未執行" value={weekStats.notExec} className="bg-slate-200 text-slate-600" />
              <StatChip label="未回報" value={weekStats.pending} className={weekStats.pending > 0 ? 'bg-yellow-100 text-yellow-800' : 'bg-slate-100 text-slate-400'} />
            </div>
            <div className="flex-1 min-w-[8px]"></div>
            <div className="flex-shrink-0 flex items-center gap-2 text-slate-500">
              <span className="hidden xl:flex items-center"><span className="w-3 h-2.5 mr-1 rounded-sm border" style={{ backgroundImage: 'repeating-linear-gradient(45deg,#FFF6D6,#FFF6D6 3px,#FDEDB8 3px,#FDEDB8 6px)', borderColor: '#D4B106' }}></span>計畫區間</span>
              <span className="hidden xl:flex items-center"><span className="w-2.5 h-2.5 bg-green-500 mr-1 rounded-sm"></span>有執行</span>
              <span className="hidden xl:flex items-center"><span className="w-2.5 h-2.5 bg-sky-500 mr-1 rounded-sm"></span>Monitor</span>
              <span className="hidden xl:flex items-center"><span className="w-2.5 h-2.5 bg-slate-400 mr-1 rounded-sm"></span>未執行</span>
            </div>
          </div>

          <div className="bg-white px-4 py-2 border-b border-slate-200 flex flex-wrap items-center gap-2 text-xs z-30">
            <div className="relative">
              <svg className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>
              <input value={searchText} onChange={e => setSearchText(e.target.value)} placeholder="搜尋專案 / 任務 / 分類…"
                className="pl-7 pr-6 py-1.5 border border-slate-300 rounded-lg outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-200 transition w-52" />
              {searchText && <button onClick={() => setSearchText('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 font-bold px-1">×</button>}
            </div>

            <div className="flex items-center space-x-1">
              {Object.entries(PROJECT_TYPES).map(([key, meta]) => {
                const on = typeFilter.has(key);
                return (
                  <button key={key} onClick={() => toggleTypeFilter(key)}
                    className={`px-2 py-1 rounded-full border font-bold transition ${on ? meta.chip + ' ring-1 ring-offset-1 ring-slate-400' : 'bg-white text-slate-400 border-slate-200 hover:border-slate-400'}`}
                    title={meta.label}>
                    {key}·{meta.label}
                  </button>
                );
              })}
              {typeFilter.size > 0 && <button onClick={() => setTypeFilter(new Set())} className="text-blue-600 hover:underline px-1">清除</button>}
            </div>

            <div className="h-5 border-l border-slate-200"></div>

            {role === 'member' ? (
              <label className="flex items-center space-x-1.5 cursor-pointer select-none bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5">
                <input type="checkbox" checked={onlyMine} onChange={e => setOnlyMine(e.target.checked)} className="w-3.5 h-3.5 rounded text-blue-600" />
                <span className="font-medium text-slate-700">只看我的專案</span>
              </label>
            ) : (
              <select value={ownerFilter} onChange={e => setOwnerFilter(e.target.value)}
                className="border border-slate-300 rounded-lg px-2 py-1.5 outline-none bg-white font-medium text-slate-700">
                <option value="all">全部成員</option>
                {users.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            )}

            <div className="flex-1"></div>

            <select value={scheduleYear}
              onChange={e => { const y = parseInt(e.target.value); setScheduleYear(y); setCurrentWeek(getTodayWeek(y)); }}
              title="切換排程年度(年度資料由 DB 的 ScheduleWeeks 決定)"
              className="border border-slate-300 rounded-lg px-2 py-1.5 outline-none bg-white font-bold text-slate-700">
              {(years.length ? years : [scheduleYear]).map(y => <option key={y} value={y}>{y} 年度</option>)}
            </select>

            <button onClick={goToCurrentWeek} className="flex items-center text-white px-2.5 py-1.5 rounded-lg font-bold shadow-sm transition hover:opacity-90" style={{ backgroundColor: NAVY }}>
              <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
              回到本週 W{String(todayWeek).padStart(2, '0')}
            </button>
            <button onClick={() => setIsCompact(!isCompact)} className="text-slate-600 bg-slate-100 hover:bg-slate-200 px-2.5 py-1.5 rounded-lg border border-slate-200 font-medium transition">
              {isCompact ? '寬鬆模式' : '緊湊模式'}
            </button>
            <button onClick={() => setCollapsedOwners(new Set())} className="text-blue-600 hover:text-blue-800 font-medium">展開全部</button>
            <span className="text-slate-300">|</span>
            <button onClick={() => setCollapsedOwners(new Set(users))} className="text-blue-600 hover:text-blue-800 font-medium">收合全部</button>
          </div>

          <div ref={ganttRef} className="flex-1 overflow-auto bg-slate-50 relative">
            <table className="border-collapse bg-white" style={{ tableLayout: 'fixed', width: 430 + weeksTotal * weekW }}>
              <colgroup>
                <col style={{ width: 28 }} />
                <col style={{ width: 42 }} />
                <col style={{ width: 360 }} />
                {Array.from({ length: weeksTotal }).map((_, i) => <col key={i} style={{ width: weekW }} />)}
              </colgroup>
              <thead className="sticky top-0 z-40 text-xs shadow-sm bg-slate-100">
                <tr>
                  <th colSpan="3" className="border-r border-b border-slate-300 bg-slate-200 sticky left-0 z-50 px-2 py-1 text-left" style={{ width: 430 }}>
                    <div className="flex justify-between items-center text-[10px]">
                      <span className="font-bold text-slate-600">專案基本資訊</span>
                      <span className="text-slate-400 font-normal">顯示 {filteredProjects.length} / {projects.length} 項</span>
                    </div>
                  </th>
                  {months.map((m, i) => (
                    <th key={i} colSpan={m.weeks} className="border-r border-b border-slate-300 text-white p-0.5 text-center font-medium text-[11px] tracking-wider relative overflow-hidden" style={{ backgroundColor: i % 2 === 0 ? NAVY : '#0A3178' }}>
                      <div className="absolute inset-0 bg-gradient-to-b from-white/10 to-transparent"></div>
                      {m.name.slice(0, 4)}/{m.name.slice(4)}
                    </th>
                  ))}
                </tr>
                <tr className="bg-slate-100 text-slate-600 text-[11px]">
                  <th className="border-r border-b border-slate-300 p-1 sticky left-0 bg-slate-100 z-50 text-center font-medium" style={{ width: 28 }}>No</th>
                  <th className="border-r border-b border-slate-300 p-1 sticky bg-slate-100 z-50 text-center font-medium" style={{ width: 42, left: 28 }}>分類</th>
                  <th className="border-r border-b border-slate-300 p-1 sticky bg-slate-100 z-50 shadow-[2px_0_5px_rgba(0,0,0,0.05)] text-left pl-3 font-medium" style={{ width: 360, left: 70 }}>專案名稱 (Project Name)</th>
                  {Array.from({ length: weeksTotal }).map((_, i) => {
                    const weekNum = i + 1;
                    const isCurrent = weekNum === currentWeek;
                    return (
                      <th key={i}
                        onClick={() => { if (role === 'manager' || weekNum <= todayWeek) setCurrentWeek(weekNum); }}
                        title={role === 'manager' ? `點擊將系統週切換至 W${weekNum}` : (weekNum <= todayWeek ? `點擊檢視 W${weekNum}(唯讀)` : undefined)}
                        className={`border-r border-b border-slate-300 p-0 text-center relative ${(role === 'manager' || weekNum <= todayWeek) ? 'cursor-pointer hover:bg-blue-100' : ''} ${isCurrent ? 'text-white font-bold' : weekNum > todayWeek ? 'bg-slate-100 text-slate-400 font-normal' : 'bg-slate-50 font-normal'}`}
                        style={{ width: weekW, ...(isCurrent ? { backgroundColor: NAVY } : {}) }}>
                        {isCurrent && <div className="absolute -bottom-px left-0 right-0 h-0.5" style={{ backgroundColor: GOLD }}></div>}
                        <div className="py-1 z-10 relative">{isCompact ? weekNum : `W${String(weekNum).padStart(2, '0')}`}</div>
                      </th>
                    );
                  })}
                </tr>
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
                      <tr onClick={() => toggleOwnerCollapse(group.owner)} className="group/header bg-blue-50 hover:bg-blue-100 cursor-pointer border-b border-blue-100 transition-colors">
                        <td colSpan="3" className="sticky left-0 z-40 bg-blue-50 group-hover/header:bg-blue-100 border-r border-blue-200 p-0 shadow-[2px_0_5px_rgba(0,0,0,0.02)]">
                          <div className="flex items-center text-blue-900 font-bold text-[13px] px-2 py-1.5 border-l-4" style={{ borderColor: NAVY }}>
                            <svg className={`w-4 h-4 mr-1 text-blue-500 transition-transform ${isCollapsed ? '-rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                            <div className="w-6 h-6 rounded-full text-white flex items-center justify-center text-xs mr-2 flex-shrink-0" style={{ backgroundColor: NAVY }}>{group.owner[0]}</div>
                            {group.owner}
                            <span className="ml-2 px-1.5 py-0.5 bg-white text-blue-600 rounded text-[10px] font-medium border border-blue-100">{group.projects.length} 項</span>
                            {gActive > 0 && (
                              <div className="ml-2 flex items-center gap-1.5">
                                <div className="w-16 h-1.5 bg-white rounded-full overflow-hidden border border-blue-100">
                                  <div className={`h-full rounded-full ${gReported === gActive ? 'bg-green-500' : 'bg-yellow-400'}`} style={{ width: `${(gReported / gActive) * 100}%` }}></div>
                                </div>
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${gReported === gActive ? 'bg-green-100 text-green-700 border-green-200' : 'bg-yellow-100 text-yellow-700 border-yellow-200'}`}>
                                  本週回報 {gReported}/{gActive}
                                </span>
                              </div>
                            )}
                            {role === 'manager' && (
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
                          className={`hover:bg-slate-50 group/row border-b border-slate-200 ${dragOverId === proj.id && dragState && dragState.id !== proj.id ? 'border-t-2 border-t-blue-500' : ''} ${dragState && dragState.id === proj.id ? 'opacity-40' : ''}`}>
                          <td className={`text-center sticky left-0 bg-white group-hover/row:bg-slate-50 z-30 border-r border-slate-200 text-slate-400 font-medium ${isCompact ? 'py-1' : 'py-2'}`}>{idx + 1}</td>
                          <td className={`text-center sticky bg-white group-hover/row:bg-slate-50 z-30 border-r border-slate-200 text-slate-600 ${isCompact ? 'py-1' : 'py-2'}`} style={{ left: 28 }}>{proj.category}</td>
                          {/* --- 修改點 2: 將 bg-white 實色直接套用到 <td> 本身，避免裡層高度撐不滿而露空 --- */}
                          <td className="sticky bg-white group-hover/row:bg-slate-50 z-30 shadow-[2px_0_5px_rgba(0,0,0,0.03)] border-r border-slate-300 p-0" style={{ left: 70 }}>
                            <div className="w-full h-full flex items-center px-2 overflow-hidden">
                              {role === 'manager' && (
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
                              <span className="flex-1 min-w-0 truncate font-medium text-slate-700 text-[11px]">{proj.name}</span>
                              {role === 'manager' && (
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

                          <td colSpan={weeksTotal} className="p-0 relative" style={{ height: isCompact ? 30 : 40 }}>
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

                              const barClass = 'text-slate-700';
                              const barStyle = {
                                backgroundImage: 'repeating-linear-gradient(45deg, #FFF6D6, #FFF6D6 6px, #FDEDB8 6px, #FDEDB8 12px)',
                                borderColor: 'rgba(212,177,6,0.7)'
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
                                    className={`absolute flex items-center overflow-hidden cursor-pointer transition-transform hover:scale-y-110 hover:z-20 z-10 border rounded-sm shadow-sm ${barClass} ${isPending ? 'ring-2 ring-red-400 ring-offset-1' : ''}`}
                                    style={{ left: `${leftPercent}%`, width: `${widthPercent}%`, top: 4, bottom: isCompact ? 8 : 10, ...barStyle }}>
                                    
                                    {Object.entries(logs).map(([w, log]) => {
                                      const wn = Number(w);
                                      if (!log || wn < task.start || wn > task.end) return null;
                                      const isCur = wn === currentWeek;
                                      return (
                                        <div key={w}
                                          className={`absolute inset-y-0 pointer-events-none ${STATUS_META[log.status]?.dot || 'bg-blue-500'} ${isCur ? 'opacity-95' : 'opacity-60'}`}
                                          style={{
                                            left: `${((wn - task.start) / spanWeeks) * 100}%`,
                                            width: `${100 / spanWeeks}%`,
                                            boxShadow: isCur ? 'inset 0 0 0 1.5px rgba(255,255,255,0.6)' : 'none'
                                          }}
                                          title={`W${w}: ${STATUS_META[log.status]?.label}`}></div>
                                      );
                                    })}
                                    
                                    <span className={`relative z-10 truncate px-1.5 whitespace-nowrap ${isCompact ? 'text-[9px]' : 'text-[11px]'} ${textClass}`}
                                      style={{ textShadow: '0 0 3px rgba(255,255,255,0.9), 0 0 6px rgba(255,255,255,0.75)' }}>
                                      {isPending && '❗'}{!isCompact && weekLog?.note ? `${task.name} ➔ ${weekLog.note}` : task.name}
                                    </span>
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
          </div>
        </div>
      )}

      {tooltip && (
        <div className="fixed z-[200] pointer-events-none"
          style={{ left: Math.min(tooltip.x + 14, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 300), top: Math.min(tooltip.y + 14, (typeof window !== 'undefined' ? window.innerHeight : 800) - 200) }}>
          <div className="bg-slate-900/95 text-white rounded-lg shadow-xl px-3.5 py-3 text-xs max-w-xs border border-slate-700">
            <div className="font-bold text-[13px] mb-1 text-yellow-200">{tooltip.proj.name}</div>
            <div className="text-slate-300 mb-0.5">👤 {tooltip.proj.owner}　·　{tooltip.proj.category}</div>
            <div className="text-slate-300">📅 {tooltip.task.name}</div>
            <div className="text-slate-400">W{tooltip.task.start} – W{tooltip.task.end}（{weekToMonth(tooltip.task.start, months)} ~ {weekToMonth(tooltip.task.end, months)}）</div>
            {tooltip.weekLog && (
              <div className="mt-2 pt-2 border-t border-slate-700">
                <div className="font-bold mb-0.5">{STATUS_META[tooltip.weekLog.status]?.icon} 本週 W{currentWeek}：{STATUS_META[tooltip.weekLog.status]?.label}</div>
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
          weeksTotal={weeksTotal}
          onClose={() => setSelectedTaskInfo(null)} onSaveLog={handleSaveLog} onUpdateTaskDetails={handleUpdateTaskDetails}
          onDeleteTask={handleDeleteTask}
        />
      )}
      {showExtraNoteModal && (
        <ExtraNoteModal
          currentWeek={currentWeek} initialNote={extraNotes[currentUser]?.[currentWeek] || ''}
          readOnly={isViewingPast}
          onClose={() => setShowExtraNoteModal(false)} onSave={handleSaveExtraNote}
        />
      )}
      {showPendingPanel && (
        <PendingPanel
          pending={myPendingTasks} currentWeek={todayWeek}
          onClose={() => setShowPendingPanel(false)}
          onSelect={(item) => {
            setShowPendingPanel(false);
            setCurrentWeek(todayWeek);
            setSelectedTaskInfo({ proj: item.proj, task: item.task, isActiveThisWeek: true, weekLog: undefined });
          }}
        />
      )}
      {showWeeklyReport && (
        <WeeklyReportDashboard
          currentWeek={currentWeek} year={scheduleYear} users={users} projects={projects} taskLogs={taskLogs} extraNotes={extraNotes}
          onClose={() => setShowWeeklyReport(false)}
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
      {confirmInfo && (
        <ConfirmModal info={confirmInfo} onCancel={() => setConfirmInfo(null)} />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[300] bg-slate-900 text-white text-sm font-bold px-5 py-3 rounded-xl shadow-2xl border border-slate-700 flex items-center animate-bounce">
          {toast}
        </div>
      )}
    </div>
  );
}

function StatChip({ label, value, className }) {
  return (
    <span className={`flex-shrink-0 pl-2 pr-2.5 py-1 rounded-full font-bold flex items-center gap-1 ${className}`}>
      <span className="opacity-60 font-medium text-[10px]">{label}</span>
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

function TaskModal({ info, role, currentUser, currentWeek, todayWeek, weeksTotal = WEEKS_TOTAL, onClose, onSaveLog, onUpdateTaskDetails, onDeleteTask }) {
  const { proj, task, isActiveThisWeek, weekLog } = info;
  const isManager = role === 'manager';
  const isMyTask = proj.owner === currentUser;
  const isReportingWeek = currentWeek === todayWeek;
  const canClockIn = role === 'member' && isMyTask && isActiveThisWeek && isReportingWeek;

  const [status, setStatus] = useState(weekLog?.status || null);
  const [note, setNote] = useState(weekLog?.note || '');
  const [taskName, setTaskName] = useState(task.name);
  const [startWeek, setStartWeek] = useState(task.start);
  const [endWeek, setEndWeek] = useState(task.end);
  const [scheduleError, setScheduleError] = useState('');
  const [noteError, setNoteError] = useState('');

  const submitLog = () => {
    if (!status) { setNoteError('請先選擇本週狀態'); return; }
    if (status === 'executed' && !note.trim()) { setNoteError('請填寫實際工作內容，才能讓團隊了解進度'); return; }
    onSaveLog(task.id, status, note.trim());
  };

  const submitSchedule = () => {
    const s = parseInt(startWeek), e = parseInt(endWeek);
    if (!taskName.trim()) { setScheduleError('任務名稱不可空白'); return; }
    if (isNaN(s) || isNaN(e) || s < 1 || e > weeksTotal || s > e) { setScheduleError(`週次需介於 1–${weeksTotal}，且開始週不可晚於結束週`); return; }
    onUpdateTaskDetails(proj.id, task.id, taskName.trim(), s, e);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex justify-center items-center p-4" onClick={onClose}>
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
            <input type="text" value={taskName} onChange={e => { setTaskName(e.target.value); setScheduleError(''); }} disabled={!isManager}
              className="w-full border border-slate-300 rounded-md p-2 text-sm mb-3 disabled:bg-slate-100 disabled:text-slate-500 outline-none focus:border-blue-500" />
            <div className="flex space-x-3 items-center">
              <div className="w-1/2">
                <label className="text-[10px] text-slate-400 font-bold">開始週</label>
                <input type="number" min="1" max="52" value={startWeek} onChange={e => { setStartWeek(e.target.value); setScheduleError(''); }} disabled={!isManager}
                  className="w-full border border-slate-300 rounded-md p-2 text-sm disabled:bg-slate-100 disabled:text-slate-500 outline-none focus:border-blue-500" />
              </div>
              <div className="w-1/2">
                <label className="text-[10px] text-slate-400 font-bold">結束週</label>
                <input type="number" min="1" max="52" value={endWeek} onChange={e => { setEndWeek(e.target.value); setScheduleError(''); }} disabled={!isManager}
                  className="w-full border border-slate-300 rounded-md p-2 text-sm disabled:bg-slate-100 disabled:text-slate-500 outline-none focus:border-blue-500" />
              </div>
            </div>
            {scheduleError && <div className="mt-2 text-xs text-red-600 font-bold">{scheduleError}</div>}
            {isManager && (
              <div className="mt-3 flex gap-2">
                <button onClick={submitSchedule} className="flex-1 text-white px-4 py-1.5 rounded text-sm font-bold transition hover:opacity-90" style={{ backgroundColor: '#001F5B' }}>儲存排程</button>
                <button onClick={() => onDeleteTask(proj, task)}
                  className="flex-shrink-0 px-3 py-1.5 rounded text-sm font-bold text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 transition"
                  title="刪除此計畫區間（軟刪除，可由資料庫還原）">🗑 刪除區間</button>
              </div>
            )}
          </div>

          <div>
            <h4 className="text-sm font-bold text-slate-800 mb-3">W{String(currentWeek).padStart(2, '0')} 實際執行回報</h4>
            {canClockIn ? (
              <div className={`p-4 rounded-xl border transition-colors ${status && status !== 'not_executed' ? 'bg-blue-50 border-blue-200' : 'bg-slate-50 border-slate-200'}`}>
                <div className="mb-3">
                  <div className="font-bold text-slate-800 text-sm">本週此任務的執行狀態</div>
                  <div className="text-xs text-slate-500 mt-0.5">回報後會在該週甘特條標示對應顏色（有執行=綠、Monitor=藍、未執行=灰）。Monitor 為例行監控工作，可不填說明。</div>
                </div>
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-2">
                    {Object.entries(STATUS_META).map(([key, meta]) => (
                      <button key={key} onClick={() => { setStatus(key); setNoteError(''); }}
                        className={`py-3 rounded-lg border text-sm font-bold transition ${status === key ? meta.tag + ' ring-2 ring-offset-1 ring-slate-300' : 'bg-white text-slate-400 border-slate-200 hover:border-slate-400'}`}>
                        {meta.icon} {meta.label}
                      </button>
                    ))}
                  </div>
                  {status && (
                    <textarea value={note} onChange={e => { setNote(e.target.value); setNoteError(''); }}
                      placeholder={status === 'not_executed' ? '可備註未執行原因（選填）' : status === 'monitor' ? '例行監控項目，可備註（選填）' : '說明本週實際工作內容…'}
                      className={`w-full border rounded-lg p-3 text-sm h-24 outline-none resize-none focus:border-blue-500 ${noteError ? 'border-red-400' : 'border-slate-300'}`}></textarea>
                  )}
                  {noteError && <div className="text-xs text-red-600 font-bold">{noteError}</div>}
                </div>
                <div className="flex justify-end space-x-3 pt-4">
                  <button onClick={onClose} className="px-4 py-2 text-sm text-slate-500 bg-white border border-slate-300 rounded-lg font-bold hover:bg-slate-50">取消</button>
                  <button onClick={submitLog} className="px-6 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-md">儲存狀態</button>
                </div>
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
                    <div className="mb-2"><span className="font-bold mr-2">狀態：</span>
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${STATUS_META[weekLog.status]?.tag}`}>
                        {STATUS_META[weekLog.status]?.icon} {STATUS_META[weekLog.status]?.label}
                      </span>
                    </div>
                    <div className="font-bold mb-1">工作說明：</div>
                    <div className="bg-white p-3 rounded border border-slate-200 text-slate-700 whitespace-pre-wrap">{weekLog.note || '（未填寫備註）'}</div>
                  </div>
                ) : <div className="text-slate-500 text-center py-2">📌 W{String(currentWeek).padStart(2, '0')} 未回報此項目（維持計畫中）。</div>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ExtraNoteModal({ currentWeek, initialNote, readOnly, onClose, onSave }) {
  const [note, setNote] = useState(initialNote);
  const [error, setError] = useState('');
  const submit = () => {
    if (!note.trim()) { setError('請填寫內容後再儲存'); return; }
    onSave(note.trim());
  };
  if (readOnly) {
    return (
      <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[110] flex justify-center items-center p-4" onClick={onClose}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
          <div className="px-6 py-4 bg-slate-600 text-white flex justify-between items-center">
            <h3 className="font-bold text-lg">🔒 W{currentWeek} 非專案工作（唯讀）</h3>
            <button onClick={onClose} className="text-white/60 hover:text-white"><svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
          </div>
          <div className="p-6">
            <p className="text-xs text-slate-400 mb-3">歷史週次僅供瀏覽，無法修改。</p>
            {initialNote ? (
              <div className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-4 whitespace-pre-wrap">{initialNote}</div>
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
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[110] flex justify-center items-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 bg-orange-500 text-white flex justify-between items-center">
          <h3 className="font-bold text-lg flex items-center">📝 填寫 W{currentWeek} 非專案工作</h3>
          <button onClick={onClose} className="text-white/60 hover:text-white"><svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
        </div>
        <div className="p-6">
          {initialNote ? (
            <div className="mb-4 bg-green-50 border border-green-300 text-green-800 rounded-lg px-3 py-2.5 text-sm font-bold flex items-center">
              <span className="mr-2">✅</span> 本週已送出過，以下為已儲存的內容，可修改後重新送出。
            </div>
          ) : (
            <div className="mb-4 bg-yellow-50 border border-yellow-300 text-yellow-800 rounded-lg px-3 py-2.5 text-sm font-bold flex items-center">
              <span className="mr-2">📭</span> 本週尚未填寫。
            </div>
          )}
          <p className="text-sm text-slate-500 mb-4 border-l-4 border-orange-400 pl-3">
            專案外的項目（日常維運、臨時交辦、會議、教育訓練等）請填寫於此，會呈現在團隊總結看板。
          </p>
          <textarea value={note} onChange={e => { setNote(e.target.value); setError(''); }}
            placeholder={"例如：\n1. 協助 OOO 機台異常處理 (1天)\n2. 參加跨部門會議…"}
            className={`w-full border rounded-lg p-3 text-sm h-40 outline-none focus:ring-2 focus:ring-orange-400 resize-none ${error ? 'border-red-400' : 'border-slate-300'}`}></textarea>
          {error && <div className="text-xs text-red-600 font-bold mt-1">{error}</div>}
          <div className="flex justify-end space-x-3 pt-4">
            <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 bg-slate-100 rounded-lg font-bold hover:bg-slate-200">取消</button>
            <button onClick={submit} className="px-6 py-2 text-sm bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-lg shadow-md">送出回報</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PendingPanel({ pending, currentWeek, onClose, onSelect }) {
  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[105] flex justify-end" onClick={onClose}>
      <div className="w-full max-w-sm bg-white h-full shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 text-white flex justify-between items-center" style={{ backgroundColor: '#001F5B' }}>
          <div>
            <h3 className="font-bold text-lg">🔔 W{String(currentWeek).padStart(2, '0')} 待回報清單</h3>
            <p className="text-xs text-blue-200 mt-0.5">本週排定但尚未打卡的任務</p>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white p-1"><svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {pending.length === 0 ? (
            <div className="text-center text-slate-400 py-16">
              <div className="text-4xl mb-3">🎉</div>
              <div className="font-bold text-slate-600">本週任務已全數回報</div>
              <div className="text-xs mt-1">辛苦了！</div>
            </div>
          ) : pending.map(({ proj, task }) => (
            <button key={task.id} onClick={() => onSelect({ proj, task })}
              className="w-full text-left bg-yellow-50 hover:bg-yellow-100 border border-yellow-200 rounded-xl p-3 transition group">
              <div className="flex items-center justify-between">
                <div className="min-w-0 pr-2">
                  <div className="text-xs font-bold text-slate-700 truncate">{proj.name}</div>
                  <div className="text-sm text-slate-600 mt-0.5 truncate">{task.name}</div>
                  <div className="text-[10px] text-slate-400 mt-1">排程 W{task.start}–W{task.end} · {proj.category}</div>
                </div>
                <div className="flex-shrink-0 text-blue-600 font-bold text-xs bg-white border border-blue-200 rounded-full px-2.5 py-1 group-hover:bg-blue-600 group-hover:text-white transition">回報 ›</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function WeeklyReportDashboard({ currentWeek, year, users, projects, taskLogs, extraNotes, onClose }) {
  const [copied, setCopied] = useState(false);

  // 下載後端產生的 Excel 週報(.xlsx:專案執行 + 非專案事項 兩個工作表)
  const exportExcel = () => {
    const a = document.createElement('a');
    a.href = `${API_BASE}/api/weekly-report-excel?year=${year}&week=${currentWeek}`;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
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
    return { user, activeTasks, pendingTasks, extraNote: extraNotes[user]?.[currentWeek], total: activeTasks.length + pendingTasks.length };
  }), [users, projects, taskLogs, extraNotes, currentWeek]);

  const buildReportText = () => {
    const lines = [`【MSD W${String(currentWeek).padStart(2, '0')} 團隊週報】`, ''];
    summary.forEach(s => {
      if (s.activeTasks.length === 0 && !s.extraNote) return;
      lines.push(`■ ${s.user}（回報 ${s.activeTasks.length}/${s.total}）`);
      s.activeTasks.forEach(({ proj, task, log }) => {
        lines.push(`  [${STATUS_META[log.status]?.label}] ${proj.name} - ${task.name}${log.note ? '：' + log.note : ''}`);
      });
      if (s.extraNote) lines.push(`  (非專案) ${s.extraNote.replace(/\n/g, ' / ')}`);
      lines.push('');
    });
    return lines.join('\n');
  };

  const copyReport = async () => {
    const text = buildReportText();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
      document.body.removeChild(ta);
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 w-full max-w-2xl bg-slate-50 shadow-2xl z-[120] flex flex-col border-l border-slate-200">
      <div className="px-6 py-4 text-white flex justify-between items-center shadow-md" style={{ backgroundColor: '#001F5B' }}>
        <div>
          <h2 className="font-bold text-xl">📊 W{String(currentWeek).padStart(2, '0')} 團隊工作總結看板</h2>
          <p className="text-xs text-blue-200 mt-1">彙總各成員「專案實際執行」與「非專案事項」</p>
        </div>
        <div className="flex items-center space-x-2">
          <button onClick={exportExcel}
            className="px-3 py-1.5 rounded-lg text-xs font-bold transition border bg-green-600 hover:bg-green-500 border-green-400/60 text-white"
            title="下載 Excel 週報(.xlsx)">
            ⬇️ 匯出 Excel
          </button>
          <button onClick={copyReport}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition border ${copied ? 'bg-green-500 border-green-400 text-white' : 'bg-white/10 hover:bg-white/20 border-white/20 text-white'}`}>
            {copied ? '✓ 已複製' : '📋 複製週報文字'}
          </button>
          <button onClick={onClose} className="text-white hover:bg-white/20 p-2 rounded-full"><svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {summary.map(({ user, activeTasks, pendingTasks, extraNote, total }) => {
          if (activeTasks.length === 0 && !extraNote && pendingTasks.length === 0) return null;
          const rate = total > 0 ? Math.round((activeTasks.length / total) * 100) : 0;
          return (
            <div key={user} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="bg-slate-100 px-4 py-2 border-b border-slate-200 font-bold text-slate-800 flex items-center">
                <div className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs mr-2 flex-shrink-0">{user[0]}</div>
                <span className="mr-3">{user}</span>
                {total > 0 && (
                  <div className="flex items-center flex-1 max-w-[180px]">
                    <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${rate === 100 ? 'bg-green-500' : rate >= 50 ? 'bg-blue-500' : 'bg-yellow-400'}`} style={{ width: `${rate}%` }}></div>
                    </div>
                    <span className="ml-2 text-[10px] font-bold text-slate-500">{activeTasks.length}/{total} 回報</span>
                  </div>
                )}
              </div>
              <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2.5">
                  <div className="text-xs font-bold text-slate-400 border-b border-slate-100 pb-1">📌 專案執行項目</div>
                  {activeTasks.length > 0 ? activeTasks.map(({ proj, task, log }) => (
                    <div key={task.id} className={`text-sm p-2.5 rounded-lg border ${log.status === 'not_executed' ? 'bg-slate-100 border-slate-200 opacity-80' : log.status === 'monitor' ? 'bg-sky-50/70 border-sky-200' : 'bg-green-50/60 border-green-200'}`}>
                      <div className="flex items-center justify-between">
                        <div className="font-bold text-slate-700 truncate text-xs pr-2">{proj.name}</div>
                        <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold ${STATUS_META[log.status]?.tag}`}>{STATUS_META[log.status]?.label}</span>
                      </div>
                      <div className="text-slate-600 my-1 font-medium text-xs">{task.name}</div>
                      {log.note && <div className="text-slate-700 text-xs bg-white p-1.5 rounded border border-slate-100 whitespace-pre-wrap">{log.note}</div>}
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
                    <div className="text-sm text-slate-700 bg-orange-50 p-3 rounded-lg border border-orange-200 whitespace-pre-wrap">{extraNote}</div>
                  ) : <div className="text-sm text-slate-400 italic py-2">無填寫其他項目</div>}
                </div>
              </div>
            </div>
          );
        })}
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

  const submit = () => {
    if (!name.trim()) { setError('專案名稱不可空白'); return; }
    if (!category.trim()) { setError('分類不可空白'); return; }
    onSave({
      mode: info.mode,
      projectId: isEdit ? p.id : undefined,
      owner,
      name: name.trim(),
      category: category.trim(),
      type
    });
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[130] flex justify-center items-center p-4" onClick={onClose}>
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
            <input type="text" value={name} onChange={e => { setName(e.target.value); setError(''); }} autoFocus
              className="mt-1 w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500" placeholder="輸入專案名稱…" />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500">分類</label>
            <input type="text" list="category-options" value={category} onChange={e => { setCategory(e.target.value); setError(''); }}
              className="mt-1 w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500" placeholder="選擇現有分類或輸入新分類…" />
            <datalist id="category-options">
              {existingCategories.map(c => <option key={c} value={c} />)}
            </datalist>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500">類型</label>
            <select value={type} onChange={e => setType(e.target.value)}
              className="mt-1 w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500 bg-white">
              {Object.entries(PROJECT_TYPES).map(([key, meta]) => (
                <option key={key} value={key}>{key.toUpperCase()}·{meta.label}</option>
              ))}
            </select>
          </div>
          {isEdit && (
            <div>
              <label className="text-xs font-bold text-slate-500">負責人</label>
              <select value={owner} onChange={e => setOwner(e.target.value)}
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
            <button onClick={submit} className="px-6 py-2 text-sm text-white font-bold rounded-lg shadow-md transition hover:opacity-90" style={{ backgroundColor: '#001F5B' }}>{isEdit ? '儲存變更' : '新增專案'}</button>
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

  const submit = () => {
    const s = parseInt(start), e = parseInt(end);
    if (!taskName.trim()) { setError('計畫名稱不可空白'); return; }
    if (isNaN(s) || isNaN(e) || s < 1 || e > weeksTotal || s > e) { setError(`週次需介於 1–${weeksTotal}，且開始週不可晚於結束週`); return; }
    onSave(project, taskName.trim(), s, e);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[130] flex justify-center items-center p-4" onClick={onClose}>
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
            <input type="text" value={taskName} onChange={e => { setTaskName(e.target.value); setError(''); }} autoFocus
              className="mt-1 w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500" placeholder="輸入此區間的計畫項目…" />
          </div>
          <div className="flex space-x-3">
            <div className="w-1/2">
              <label className="text-xs font-bold text-slate-500">開始週</label>
              <input type="number" min="1" max="52" value={start} onChange={e => { setStart(e.target.value); setError(''); }}
                className="mt-1 w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500" />
            </div>
            <div className="w-1/2">
              <label className="text-xs font-bold text-slate-500">結束週</label>
              <input type="number" min="1" max="52" value={end} onChange={e => { setEnd(e.target.value); setError(''); }}
                className="mt-1 w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500" />
            </div>
          </div>
          {error && <div className="text-xs text-red-600 font-bold">{error}</div>}
          <div className="flex justify-end space-x-3 pt-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 bg-slate-100 rounded-lg font-bold hover:bg-slate-200">取消</button>
            <button onClick={submit} className="px-6 py-2 text-sm text-white font-bold rounded-lg shadow-md transition hover:opacity-90" style={{ backgroundColor: '#001F5B' }}>新增區間</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// 自製刪除確認視窗(取代 window.confirm,樣式與系統一致)
function ConfirmModal({ info, onCancel }) {
  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[150] flex justify-center items-center p-4" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 bg-red-600 text-white flex items-center">
          <span className="text-xl mr-2">⚠️</span>
          <h3 className="font-bold text-lg">{info.title}</h3>
        </div>
        <div className="p-6">
          <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{info.message}</p>
          <div className="flex justify-end space-x-3 pt-5">
            <button onClick={onCancel} className="px-4 py-2 text-sm text-slate-600 bg-slate-100 rounded-lg font-bold hover:bg-slate-200">取消</button>
            <button onClick={info.onConfirm} className="px-6 py-2 text-sm bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg shadow-md">確定刪除</button>
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
  EXTRANOTE: { label: '非專案', cls: 'bg-orange-100 text-orange-700' }
};
const AUDIT_ENTITY_LABELS = { Project: '專案', Task: '任務', WeeklyLog: '週回報', ExtraNote: '非專案事項', User: '成員' };

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
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[115] flex justify-end" onClick={onClose}>
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
      `${l.actor} ${l.empId || ''} ${l.action} ${l.entityType} ${l.entityId || ''} ${l.newValue || ''} ${l.detail || ''} ${l.at}`.toLowerCase().includes(kw));
  }, [logs, filter]);

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[115] flex justify-end" onClick={onClose}>
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
              <div key={l.id} className="border border-slate-200 rounded-lg p-2.5 hover:bg-slate-50">
                <div className="flex items-center gap-2">
                  <span className={`flex-shrink-0 px-1.5 py-0.5 rounded font-bold ${meta.cls}`}>{meta.label}</span>
                  <span className="font-bold text-slate-700">{AUDIT_ENTITY_LABELS[l.entityType] || l.entityType}</span>
                  {l.entityId && <span className="text-slate-400 truncate">{l.entityId}</span>}
                  <span className="ml-auto flex-shrink-0 text-slate-400">{l.at}</span>
                </div>
                <div className="mt-1 flex items-start gap-2">
                  <span className="flex-shrink-0 text-slate-500 font-medium">
                    {l.actor}{l.role === 'manager' ? '（主管）' : ''}
                    {l.empId && <span className="ml-1 px-1 py-px rounded bg-slate-100 text-slate-400 font-mono text-[10px]" title="操作者 Windows 工號">{l.empId}</span>}
                  </span>
                  {(l.newValue || l.detail) && (
                    <span className="text-slate-600 break-all" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {l.newValue || l.detail}
                    </span>
                  )}
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
