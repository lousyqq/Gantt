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
const PROJECT_TYPES = {
  'a': {
    label: '一級專案/KPI',
    chip: 'bg-pink-100 text-pink-800 border-pink-300',
    dot: 'bg-pink-400'
  },
  'b': {
    label: '重大貢獻及亮點',
    chip: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    dot: 'bg-yellow-400'
  },
  'c': {
    label: '日常管理',
    chip: 'bg-teal-100 text-teal-800 border-teal-300',
    dot: 'bg-teal-400'
  },
  'd': {
    label: '其他加分項',
    chip: 'bg-orange-100 text-orange-800 border-orange-300',
    dot: 'bg-orange-400'
  },
  'e': {
    label: '主管交辦',
    chip: 'bg-purple-100 text-purple-800 border-purple-300',
    dot: 'bg-purple-400'
  }
};
const STATUS_META = {
  executed: {
    label: '有執行',
    icon: '✅',
    bar: 'bg-green-500 border-green-600 text-white',
    tag: 'bg-green-100 text-green-700',
    dot: 'bg-green-500'
  },
  monitor: {
    label: 'Monitor',
    icon: '👁️',
    bar: 'bg-sky-500 border-sky-600 text-white',
    tag: 'bg-sky-100 text-sky-700',
    dot: 'bg-sky-500'
  },
  not_executed: {
    label: '未執行',
    icon: '⏸️',
    bar: 'bg-slate-400 border-slate-500 text-white',
    tag: 'bg-slate-200 text-slate-600',
    dot: 'bg-slate-400'
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
  const [empId, setEmpId] = useState(null); // Windows 工號(顯示用;實際寫入由 apiPost 自動附帶)

  // 載入時偵測一次 Windows 工號(非網域環境取不到 → null,系統照常運作)
  React.useEffect(() => {
    detectEmpId().then(setEmpId);
  }, []);

  // 年度切換:可用年度與週→月對照皆來自 DB 的 ScheduleWeeks(開新年度只需 EXEC usp_EnsureScheduleYear)
  const [scheduleYear, setScheduleYear] = useState(DEFAULT_SCHEDULE_YEAR);
  const [years, setYears] = useState([]);
  const [months, setMonths] = useState(MONTHS);
  const weeksTotal = useMemo(() => months.reduce((s, m) => s + m.weeks, 0), [months]);

  // UI 狀態
  const [isCompact, setIsCompact] = useState(true);
  const [collapsedOwners, setCollapsedOwners] = useState(new Set());
  const [searchText, setSearchText] = useState('');
  const [typeFilter, setTypeFilter] = useState(new Set()); // 空 = 全部
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [onlyMine, setOnlyMine] = useState(false);
  const [tooltip, setTooltip] = useState(null); // {x, y, proj, task, weekLog, history}
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
  React.useEffect(() => {
    loadBootstrap();
  }, [loadBootstrap]);
  const [selectedTaskInfo, setSelectedTaskInfo] = useState(null);
  const [showExtraNoteModal, setShowExtraNoteModal] = useState(false);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const showToast = msg => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  };
  const [showWeeklyReport, setShowWeeklyReport] = useState(false);
  const [showPendingPanel, setShowPendingPanel] = useState(false);
  const [showAuditPanel, setShowAuditPanel] = useState(false); // 主管:異動紀錄(AuditLog)面板
  const [showMemberPanel, setShowMemberPanel] = useState(false); // 主管:成員管理面板
  const [showDeadlinePanel, setShowDeadlinePanel] = useState(false); // 即將到期清單面板(頂部 ⏰ 晶片點開)

  const weekW = isCompact ? 22 : 32;
  const todayWeek = getTodayWeek(scheduleYear, weeksTotal); // 本週(相對於選定年度)
  const isViewingPast = currentWeek !== todayWeek; // 是否在檢視非本週

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
    setCurrentUser(null);
    setRole(null);
    setShowPendingPanel(false);
    setShowWeeklyReport(false);
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
    const LEFT_W = 430;
    const target = LEFT_W + (wk - 1) * weekW - (el.clientWidth - LEFT_W) / 2;
    el.scrollTo({
      left: Math.max(0, target),
      behavior: 'smooth'
    });
  }, [weekW]);
  const goToCurrentWeek = () => {
    const tw = getTodayWeek(scheduleYear, weeksTotal); // 動態取得今天的實際週(W27、下週為 W28…)
    setCurrentWeek(tw); // 將選取週強制切回本週
    setScrollTargetWeek(tw); // 觸發 effect,於畫面更新後捲動定位
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
            isExecuting: status !== 'not_executed',
            status,
            note
          }
        }
      }));
      setSelectedTaskInfo(null);
      showToast(`✅ W${String(currentWeek).padStart(2, '0')} 任務回報已送出`);
    } catch (e) {
      showToast('❌ 儲存失敗：' + (e.message || '無法連線資料庫'));
    }
  };
  const handleSaveExtraNote = async note => {
    try {
      await apiPost('/api/extra-note', {
        userName: currentUser,
        year: scheduleYear,
        week: currentWeek,
        note,
        actor: currentUser,
        actorRole: role
      });
      setExtraNotes(prev => ({
        ...prev,
        [currentUser]: {
          ...prev[currentUser],
          [currentWeek]: note
        }
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

  // 多人共用時每 60 秒靜默刷新,讓其他人的變更自動出現(拖曳中暫停以免干擾;失敗靜默忽略,下輪再試)
  React.useEffect(() => {
    if (!currentUser || dragState) return;
    const timer = setInterval(() => {
      refreshData().catch(() => {});
    }, 60000);
    return () => clearInterval(timer);
  }, [currentUser, dragState, refreshData]);
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
    className: "text-white/60 mr-2 text-xs font-medium"
  }, "\u7CFB\u7D71\u9031\u6578"), role === 'manager' ? /*#__PURE__*/React.createElement("div", {
    className: "flex items-center space-x-1.5"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setCurrentWeek(p => Math.max(1, p - 1)),
    className: "w-5 h-5 flex items-center justify-center bg-white/10 hover:bg-white/30 rounded-full text-xs font-bold transition",
    title: "\u4E0A\u4E00\u9031"
  }, "\u2039"), /*#__PURE__*/React.createElement("span", {
    className: "font-bold text-sm tracking-wider text-center",
    style: {
      color: GOLD,
      minWidth: 100
    }
  }, "W", String(currentWeek).padStart(2, '0'), /*#__PURE__*/React.createElement("span", {
    className: "text-white/40 font-normal text-[10px] ml-1"
  }, weekToMonth(currentWeek, months))), /*#__PURE__*/React.createElement("button", {
    onClick: () => setCurrentWeek(p => Math.min(weeksTotal, p + 1)),
    className: "w-5 h-5 flex items-center justify-center bg-white/10 hover:bg-white/30 rounded-full text-xs font-bold transition",
    title: "\u4E0B\u4E00\u9031"
  }, "\u203A")) : /*#__PURE__*/React.createElement("div", {
    className: "flex items-center space-x-1.5"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setCurrentWeek(p => Math.max(1, p - 1)),
    className: "w-5 h-5 flex items-center justify-center bg-white/10 hover:bg-white/30 rounded-full text-xs font-bold transition",
    title: "\u6AA2\u8996\u524D\u4E00\u9031(\u552F\u8B80)"
  }, "\u2039"), /*#__PURE__*/React.createElement("span", {
    className: "font-bold text-sm tracking-wider text-center",
    style: {
      color: GOLD,
      minWidth: 100
    }
  }, "W", String(currentWeek).padStart(2, '0'), /*#__PURE__*/React.createElement("span", {
    className: "text-white/40 font-normal text-[10px] ml-1"
  }, weekToMonth(currentWeek, months))), /*#__PURE__*/React.createElement("button", {
    onClick: () => setCurrentWeek(p => Math.min(todayWeek, p + 1)),
    disabled: currentWeek >= todayWeek,
    className: `w-5 h-5 flex items-center justify-center rounded-full text-xs font-bold transition ${currentWeek >= todayWeek ? 'bg-white/5 text-white/20 cursor-not-allowed' : 'bg-white/10 hover:bg-white/30'}`,
    title: "\u6AA2\u8996\u5F8C\u4E00\u9031"
  }, "\u203A")), role === 'member' && isViewingPast && /*#__PURE__*/React.createElement("button", {
    onClick: () => setCurrentWeek(todayWeek),
    className: "ml-2 flex items-center bg-yellow-500/90 hover:bg-yellow-400 text-slate-900 text-[10px] font-bold px-2 py-0.5 rounded-full transition"
  }, "\uD83D\uDD12 \u552F\u8B80\u6AA2\u8996\u4E2D \xB7 \u8FD4\u56DE\u672C\u9031 W", String(todayWeek).padStart(2, '0')))), currentUser && /*#__PURE__*/React.createElement("div", {
    className: "flex items-center space-x-2"
  }, role === 'member' && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("button", {
    onClick: () => setShowPendingPanel(true),
    className: "relative bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-md text-xs font-bold shadow transition flex items-center border border-white/20"
  }, "\uD83D\uDD14 \u672C\u9031\u5F85\u56DE\u5831", myPendingTasks.length > 0 && /*#__PURE__*/React.createElement("span", {
    className: "absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center font-bold border-2 border-white/40 shadow"
  }, myPendingTasks.length)), /*#__PURE__*/React.createElement("button", {
    onClick: () => setShowExtraNoteModal(true),
    className: `relative px-3 py-1.5 rounded-md text-xs font-bold shadow transition border ${isViewingPast ? 'bg-slate-500 hover:bg-slate-400 border-slate-400/50 text-white' : extraNotes[currentUser]?.[currentWeek] ? 'bg-green-600 hover:bg-green-500 border-green-400/50 text-white' : 'bg-orange-500 hover:bg-orange-400 border-orange-400/50 text-white'}`
  }, isViewingPast ? `🔒 檢視 W${String(currentWeek).padStart(2, '0')} 非專案事項` : extraNotes[currentUser]?.[currentWeek] ? '✓ 非專案事項(已填寫)' : '📝 非專案事項(未填寫)')), role === 'manager' && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("button", {
    onClick: () => setShowMemberPanel(true),
    className: "bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-md text-xs font-bold shadow transition border border-white/20"
  }, "\uD83D\uDC65 \u6210\u54E1\u7BA1\u7406"), /*#__PURE__*/React.createElement("button", {
    onClick: () => setShowAuditPanel(true),
    className: "bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-md text-xs font-bold shadow transition border border-white/20"
  }, "\uD83D\uDCDC \u7570\u52D5\u7D00\u9304")), /*#__PURE__*/React.createElement("button", {
    onClick: () => setShowWeeklyReport(true),
    className: "bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-md text-xs font-bold shadow transition border border-blue-400/50"
  }, "\uD83D\uDCCA W", String(currentWeek).padStart(2, '0'), " \u5718\u968A\u7E3D\u7D50"), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center space-x-3 border-l border-white/20 pl-3 ml-1"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-right leading-tight"
  }, /*#__PURE__*/React.createElement("div", {
    className: "font-bold text-sm"
  }, currentUser), /*#__PURE__*/React.createElement("div", {
    className: "text-[10px] text-white/50"
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
  }, /*#__PURE__*/React.createElement("div", {
    className: "px-4 py-2 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white flex items-center gap-3 text-xs overflow-x-auto"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center flex-shrink-0"
  }, /*#__PURE__*/React.createElement("span", {
    className: "font-black text-slate-800 text-sm"
  }, "W", String(currentWeek).padStart(2, '0')), /*#__PURE__*/React.createElement("span", {
    className: "text-slate-400 ml-1 text-[10px]"
  }, weekToMonth(currentWeek, months), " \u6982\u6CC1")), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center flex-shrink-0 min-w-[150px]"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex-1 h-2 bg-slate-200 rounded-full overflow-hidden"
  }, /*#__PURE__*/React.createElement("div", {
    className: `h-full rounded-full transition-all duration-500 ${weekStats.active > 0 && weekStats.reported === weekStats.active ? 'bg-green-500' : 'bg-indigo-500'}`,
    style: {
      width: `${weekStats.active > 0 ? weekStats.reported / weekStats.active * 100 : 0}%`
    }
  })), /*#__PURE__*/React.createElement("span", {
    className: "ml-2 font-bold text-slate-600 whitespace-nowrap"
  }, weekStats.reported, "/", weekStats.active, " \u5DF2\u56DE\u5831")), /*#__PURE__*/React.createElement("div", {
    className: "h-6 border-l border-slate-200 flex-shrink-0"
  }), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-1.5 flex-shrink-0"
  }, /*#__PURE__*/React.createElement(StatChip, {
    label: "\u6709\u57F7\u884C",
    value: weekStats.executed,
    className: "bg-green-100 text-green-700"
  }), /*#__PURE__*/React.createElement(StatChip, {
    label: "Monitor",
    value: weekStats.monitor,
    className: "bg-sky-100 text-sky-700"
  }), /*#__PURE__*/React.createElement(StatChip, {
    label: "\u672A\u57F7\u884C",
    value: weekStats.notExec,
    className: "bg-slate-200 text-slate-600"
  }), /*#__PURE__*/React.createElement(StatChip, {
    label: "\u672A\u56DE\u5831",
    value: weekStats.pending,
    className: weekStats.pending > 0 ? 'bg-yellow-100 text-yellow-800' : 'bg-slate-100 text-slate-400'
  }), /*#__PURE__*/React.createElement("button", {
    onClick: () => setShowDeadlinePanel(true),
    title: "\u9EDE\u64CA\u6AA2\u8996\u5373\u5C07\u5230\u671F\u6E05\u55AE",
    className: `flex-shrink-0 pl-2 pr-2.5 py-1 rounded-full font-bold flex items-center gap-1 transition ${deadlineTasks.length > 0 ? 'bg-orange-100 text-orange-800 hover:bg-orange-200 ring-1 ring-orange-300' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`
  }, /*#__PURE__*/React.createElement("span", {
    className: "opacity-60 font-medium text-[10px]"
  }, "\u23F0 \u5373\u5C07\u5230\u671F"), /*#__PURE__*/React.createElement("span", {
    className: "text-[13px] leading-none"
  }, deadlineTasks.length), /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] opacity-50"
  }, "\u203A"))), /*#__PURE__*/React.createElement("div", {
    className: "flex-1 min-w-[8px]"
  }), /*#__PURE__*/React.createElement("div", {
    className: "flex-shrink-0 flex items-center gap-2 text-slate-500"
  }, /*#__PURE__*/React.createElement("span", {
    className: "hidden xl:flex items-center"
  }, /*#__PURE__*/React.createElement("span", {
    className: "w-3 h-2.5 mr-1 rounded-sm border",
    style: {
      backgroundImage: 'repeating-linear-gradient(45deg,#FFF6D6,#FFF6D6 3px,#FDEDB8 3px,#FDEDB8 6px)',
      borderColor: '#D4B106'
    }
  }), "\u8A08\u756B\u5340\u9593"), /*#__PURE__*/React.createElement("span", {
    className: "hidden xl:flex items-center"
  }, /*#__PURE__*/React.createElement("span", {
    className: "w-2.5 h-2.5 bg-green-500 mr-1 rounded-sm"
  }), "\u6709\u57F7\u884C"), /*#__PURE__*/React.createElement("span", {
    className: "hidden xl:flex items-center"
  }, /*#__PURE__*/React.createElement("span", {
    className: "w-2.5 h-2.5 bg-sky-500 mr-1 rounded-sm"
  }), "Monitor"), /*#__PURE__*/React.createElement("span", {
    className: "hidden xl:flex items-center"
  }, /*#__PURE__*/React.createElement("span", {
    className: "w-2.5 h-2.5 bg-slate-400 mr-1 rounded-sm"
  }), "\u672A\u57F7\u884C"), /*#__PURE__*/React.createElement("span", {
    className: "hidden xl:flex items-center"
  }, /*#__PURE__*/React.createElement("span", {
    className: "w-3 h-2.5 mr-1 rounded-sm border-2 border-orange-400 bg-white"
  }), "\u23F0 \u5373\u5C07\u5230\u671F"))), /*#__PURE__*/React.createElement("div", {
    className: "bg-white px-4 py-2 border-b border-slate-200 flex flex-wrap items-center gap-2 text-xs z-30"
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
    placeholder: "\u641C\u5C0B\u5C08\u6848 / \u4EFB\u52D9 / \u5206\u985E\u2026",
    className: "pl-7 pr-6 py-1.5 border border-slate-300 rounded-lg outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-200 transition w-52"
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
      className: `px-2 py-1 rounded-full border font-bold transition ${on ? meta.chip + ' ring-1 ring-offset-1 ring-slate-400' : 'bg-white text-slate-400 border-slate-200 hover:border-slate-400'}`,
      title: meta.label
    }, key, "\xB7", meta.label);
  }), typeFilter.size > 0 && /*#__PURE__*/React.createElement("button", {
    onClick: () => setTypeFilter(new Set()),
    className: "text-blue-600 hover:underline px-1"
  }, "\u6E05\u9664")), /*#__PURE__*/React.createElement("div", {
    className: "h-5 border-l border-slate-200"
  }), role === 'member' ? /*#__PURE__*/React.createElement("label", {
    className: "flex items-center space-x-1.5 cursor-pointer select-none bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5"
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
    className: "border border-slate-300 rounded-lg px-2 py-1.5 outline-none bg-white font-medium text-slate-700"
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
    className: "border border-slate-300 rounded-lg px-2 py-1.5 outline-none bg-white font-bold text-slate-700"
  }, (years.length ? years : [scheduleYear]).map(y => /*#__PURE__*/React.createElement("option", {
    key: y,
    value: y
  }, y, " \u5E74\u5EA6"))), /*#__PURE__*/React.createElement("button", {
    onClick: goToCurrentWeek,
    className: "flex items-center text-white px-2.5 py-1.5 rounded-lg font-bold shadow-sm transition hover:opacity-90",
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
  })), "\u56DE\u5230\u672C\u9031 W", String(todayWeek).padStart(2, '0')), /*#__PURE__*/React.createElement("button", {
    onClick: () => setIsCompact(!isCompact),
    className: "text-slate-600 bg-slate-100 hover:bg-slate-200 px-2.5 py-1.5 rounded-lg border border-slate-200 font-medium transition"
  }, isCompact ? '寬鬆模式' : '緊湊模式'), /*#__PURE__*/React.createElement("button", {
    onClick: () => setCollapsedOwners(new Set()),
    className: "text-blue-600 hover:text-blue-800 font-medium"
  }, "\u5C55\u958B\u5168\u90E8"), /*#__PURE__*/React.createElement("span", {
    className: "text-slate-300"
  }, "|"), /*#__PURE__*/React.createElement("button", {
    onClick: () => setCollapsedOwners(new Set(users)),
    className: "text-blue-600 hover:text-blue-800 font-medium"
  }, "\u6536\u5408\u5168\u90E8")), /*#__PURE__*/React.createElement("div", {
    ref: ganttRef,
    className: "flex-1 overflow-auto bg-slate-50 relative"
  }, /*#__PURE__*/React.createElement("table", {
    className: "border-collapse bg-white",
    style: {
      tableLayout: 'fixed',
      width: 430 + weeksTotal * weekW
    }
  }, /*#__PURE__*/React.createElement("colgroup", null, /*#__PURE__*/React.createElement("col", {
    style: {
      width: 28
    }
  }), /*#__PURE__*/React.createElement("col", {
    style: {
      width: 42
    }
  }), /*#__PURE__*/React.createElement("col", {
    style: {
      width: 360
    }
  }), Array.from({
    length: weeksTotal
  }).map((_, i) => /*#__PURE__*/React.createElement("col", {
    key: i,
    style: {
      width: weekW
    }
  }))), /*#__PURE__*/React.createElement("thead", {
    className: "sticky top-0 z-40 text-xs shadow-sm bg-slate-100"
  }, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", {
    colSpan: "3",
    className: "border-r border-b border-slate-300 bg-slate-200 sticky left-0 z-50 px-2 py-1 text-left",
    style: {
      width: 430
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex justify-between items-center text-[10px]"
  }, /*#__PURE__*/React.createElement("span", {
    className: "font-bold text-slate-600"
  }, "\u5C08\u6848\u57FA\u672C\u8CC7\u8A0A"), /*#__PURE__*/React.createElement("span", {
    className: "text-slate-400 font-normal"
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
  }, /*#__PURE__*/React.createElement("th", {
    className: "border-r border-b border-slate-300 p-1 sticky left-0 bg-slate-100 z-50 text-center font-medium",
    style: {
      width: 28
    }
  }, "No"), /*#__PURE__*/React.createElement("th", {
    className: "border-r border-b border-slate-300 p-1 sticky bg-slate-100 z-50 text-center font-medium",
    style: {
      width: 42,
      left: 28
    }
  }, "\u5206\u985E"), /*#__PURE__*/React.createElement("th", {
    className: "border-r border-b border-slate-300 p-1 sticky bg-slate-100 z-50 shadow-[2px_0_5px_rgba(0,0,0,0.05)] text-left pl-3 font-medium",
    style: {
      width: 360,
      left: 70
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
      className: `border-r border-b border-slate-300 p-0 text-center relative ${role === 'manager' || weekNum <= todayWeek ? 'cursor-pointer hover:bg-blue-100' : ''} ${isCurrent ? 'text-white font-bold' : weekNum > todayWeek ? 'bg-slate-100 text-slate-400 font-normal' : 'bg-slate-50 font-normal'}`,
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
      className: "group/header bg-blue-50 hover:bg-blue-100 cursor-pointer border-b border-blue-100 transition-colors"
    }, /*#__PURE__*/React.createElement("td", {
      colSpan: "3",
      className: "sticky left-0 z-40 bg-blue-50 group-hover/header:bg-blue-100 border-r border-blue-200 p-0 shadow-[2px_0_5px_rgba(0,0,0,0.02)]"
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
    }, /*#__PURE__*/React.createElement("div", {
      className: "w-16 h-1.5 bg-white rounded-full overflow-hidden border border-blue-100"
    }, /*#__PURE__*/React.createElement("div", {
      className: `h-full rounded-full ${gReported === gActive ? 'bg-green-500' : 'bg-yellow-400'}`,
      style: {
        width: `${gReported / gActive * 100}%`
      }
    })), /*#__PURE__*/React.createElement("span", {
      className: `px-1.5 py-0.5 rounded text-[10px] font-bold border ${gReported === gActive ? 'bg-green-100 text-green-700 border-green-200' : 'bg-yellow-100 text-yellow-700 border-yellow-200'}`
    }, "\u672C\u9031\u56DE\u5831 ", gReported, "/", gActive)), role === 'manager' && /*#__PURE__*/React.createElement("button", {
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
      className: `hover:bg-slate-50 group/row border-b border-slate-200 ${dragOverId === proj.id && dragState && dragState.id !== proj.id ? 'border-t-2 border-t-blue-500' : ''} ${dragState && dragState.id === proj.id ? 'opacity-40' : ''}`
    }, /*#__PURE__*/React.createElement("td", {
      className: `text-center sticky left-0 bg-white group-hover/row:bg-slate-50 z-30 border-r border-slate-200 text-slate-400 font-medium ${isCompact ? 'py-1' : 'py-2'}`
    }, idx + 1), /*#__PURE__*/React.createElement("td", {
      className: `text-center sticky bg-white group-hover/row:bg-slate-50 z-30 border-r border-slate-200 text-slate-600 ${isCompact ? 'py-1' : 'py-2'}`,
      style: {
        left: 28
      }
    }, proj.category), /*#__PURE__*/React.createElement("td", {
      className: "sticky bg-white group-hover/row:bg-slate-50 z-30 shadow-[2px_0_5px_rgba(0,0,0,0.03)] border-r border-slate-300 p-0",
      style: {
        left: 70
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "w-full h-full flex items-center px-2 overflow-hidden"
    }, role === 'manager' && (isFilteringRows ? /*#__PURE__*/React.createElement("span", {
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
      className: "flex-1 min-w-0 truncate font-medium text-slate-700 text-[11px]"
    }, proj.name), (() => {
      const soon = proj.tasks.filter(isTaskDeadlineSoon);
      if (soon.length === 0) return null;
      const remain = Math.min(...soon.map(t => t.end - todayWeek + 1));
      return /*#__PURE__*/React.createElement("span", {
        className: "flex-shrink-0 ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-orange-100 text-orange-700 border border-orange-300 whitespace-nowrap",
        title: `${soon.length} 個計畫區間即將到期(最近的剩 ${remain} 週)`
      }, "\u23F0 \u5269", remain, "\u9031");
    })(), role === 'manager' && /*#__PURE__*/React.createElement("div", {
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
        height: isCompact ? 30 : 40
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
          top: 4,
          bottom: isCompact ? 8 : 10,
          ...barStyle
        }
      }, Object.entries(logs).map(([w, log]) => {
        const wn = Number(w);
        if (!log || wn < task.start || wn > task.end) return null;
        const isCur = wn === currentWeek;
        return /*#__PURE__*/React.createElement("div", {
          key: w,
          className: `absolute inset-y-0 pointer-events-none ${STATUS_META[log.status]?.dot || 'bg-blue-500'} ${isCur ? 'opacity-95' : 'opacity-60'}`,
          style: {
            left: `${(wn - task.start) / spanWeeks * 100}%`,
            width: `${100 / spanWeeks}%`,
            boxShadow: isCur ? 'inset 0 0 0 1.5px rgba(255,255,255,0.6)' : 'none'
          },
          title: `W${w}: ${STATUS_META[log.status]?.label}`
        });
      }), /*#__PURE__*/React.createElement("span", {
        className: `relative z-10 truncate px-1.5 whitespace-nowrap ${isCompact ? 'text-[9px]' : 'text-[11px]'} ${textClass}`,
        style: {
          textShadow: '0 0 3px rgba(255,255,255,0.9), 0 0 6px rgba(255,255,255,0.75)'
        }
      }, isPending && '❗', deadlineSoon && '⏰', !isCompact && weekLog?.note ? `${task.name} ➔ ${weekLog.note}` : task.name)));
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
  }, "\uD83D\uDC64 ", tooltip.proj.owner, "\u3000\xB7\u3000", tooltip.proj.category), /*#__PURE__*/React.createElement("div", {
    className: "text-slate-300"
  }, "\uD83D\uDCC5 ", tooltip.task.name), /*#__PURE__*/React.createElement("div", {
    className: "text-slate-400"
  }, "W", tooltip.task.start, " \u2013 W", tooltip.task.end, "\uFF08", weekToMonth(tooltip.task.start, months), " ~ ", weekToMonth(tooltip.task.end, months), "\uFF09"), isTaskDeadlineSoon(tooltip.task) && /*#__PURE__*/React.createElement("div", {
    className: "mt-1 text-orange-300 font-bold"
  }, "\u23F0 \u6392\u7A0B\u5373\u5C07\u5230\u671F\uFF1A\u5269 ", tooltip.task.end - todayWeek + 1, " \u9031 \uFF08\u6642\u7A0B\u5DF2\u904E ", Math.round((todayWeek - tooltip.task.start + 1) / (tooltip.task.end - tooltip.task.start + 1) * 100), "%\uFF09"), tooltip.weekLog && /*#__PURE__*/React.createElement("div", {
    className: "mt-2 pt-2 border-t border-slate-700"
  }, /*#__PURE__*/React.createElement("div", {
    className: "font-bold mb-0.5"
  }, STATUS_META[tooltip.weekLog.status]?.icon, " \u672C\u9031 W", currentWeek, "\uFF1A", STATUS_META[tooltip.weekLog.status]?.label), tooltip.weekLog.note && /*#__PURE__*/React.createElement("div", {
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
    onClose: () => setSelectedTaskInfo(null),
    onSaveLog: handleSaveLog,
    onUpdateTaskDetails: handleUpdateTaskDetails,
    onDeleteTask: handleDeleteTask
  }), showExtraNoteModal && /*#__PURE__*/React.createElement(ExtraNoteModal, {
    currentWeek: currentWeek,
    initialNote: extraNotes[currentUser]?.[currentWeek] || '',
    readOnly: isViewingPast,
    onClose: () => setShowExtraNoteModal(false),
    onSave: handleSaveExtraNote
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
    currentWeek: todayWeek,
    onClose: () => setShowPendingPanel(false),
    onSelect: item => {
      setShowPendingPanel(false);
      setCurrentWeek(todayWeek);
      setSelectedTaskInfo({
        proj: item.proj,
        task: item.task,
        isActiveThisWeek: true,
        weekLog: undefined
      });
    }
  }), showWeeklyReport && /*#__PURE__*/React.createElement(WeeklyReportDashboard, {
    currentWeek: currentWeek,
    year: scheduleYear,
    users: users,
    projects: projects,
    taskLogs: taskLogs,
    extraNotes: extraNotes,
    onClose: () => setShowWeeklyReport(false)
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
  }), confirmInfo && /*#__PURE__*/React.createElement(ConfirmModal, {
    info: confirmInfo,
    onCancel: () => setConfirmInfo(null)
  }), toast && /*#__PURE__*/React.createElement("div", {
    className: "fixed bottom-6 left-1/2 -translate-x-1/2 z-[300] bg-slate-900 text-white text-sm font-bold px-5 py-3 rounded-xl shadow-2xl border border-slate-700 flex items-center animate-bounce"
  }, toast));
}
function StatChip({
  label,
  value,
  className
}) {
  return /*#__PURE__*/React.createElement("span", {
    className: `flex-shrink-0 pl-2 pr-2.5 py-1 rounded-full font-bold flex items-center gap-1 ${className}`
  }, /*#__PURE__*/React.createElement("span", {
    className: "opacity-60 font-medium text-[10px]"
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
function TaskModal({
  info,
  role,
  currentUser,
  currentWeek,
  todayWeek,
  weeksTotal = WEEKS_TOTAL,
  onClose,
  onSaveLog,
  onUpdateTaskDetails,
  onDeleteTask
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
  const canClockIn = role === 'member' && isMyTask && isActiveThisWeek && isReportingWeek;
  const [status, setStatus] = useState(weekLog?.status || null);
  const [note, setNote] = useState(weekLog?.note || '');
  const [taskName, setTaskName] = useState(task.name);
  const [startWeek, setStartWeek] = useState(task.start);
  const [endWeek, setEndWeek] = useState(task.end);
  const [scheduleError, setScheduleError] = useState('');
  const [noteError, setNoteError] = useState('');
  const submitLog = () => {
    if (!status) {
      setNoteError('請先選擇本週狀態');
      return;
    }
    if (status === 'executed' && !note.trim()) {
      setNoteError('請填寫實際工作內容，才能讓團隊了解進度');
      return;
    }
    onSaveLog(task.id, status, note.trim());
  };
  const submitSchedule = () => {
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
    onUpdateTaskDetails(proj.id, task.id, taskName.trim(), s, e);
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
    },
    disabled: !isManager,
    className: "w-full border border-slate-300 rounded-md p-2 text-sm mb-3 disabled:bg-slate-100 disabled:text-slate-500 outline-none focus:border-blue-500"
  }), /*#__PURE__*/React.createElement("div", {
    className: "flex space-x-3 items-center"
  }, /*#__PURE__*/React.createElement("div", {
    className: "w-1/2"
  }, /*#__PURE__*/React.createElement("label", {
    className: "text-[10px] text-slate-400 font-bold"
  }, "\u958B\u59CB\u9031"), /*#__PURE__*/React.createElement("input", {
    type: "number",
    min: "1",
    max: "52",
    value: startWeek,
    onChange: e => {
      setStartWeek(e.target.value);
      setScheduleError('');
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
    max: "52",
    value: endWeek,
    onChange: e => {
      setEndWeek(e.target.value);
      setScheduleError('');
    },
    disabled: !isManager,
    className: "w-full border border-slate-300 rounded-md p-2 text-sm disabled:bg-slate-100 disabled:text-slate-500 outline-none focus:border-blue-500"
  }))), scheduleError && /*#__PURE__*/React.createElement("div", {
    className: "mt-2 text-xs text-red-600 font-bold"
  }, scheduleError), isManager && /*#__PURE__*/React.createElement("div", {
    className: "mt-3 flex gap-2"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: submitSchedule,
    className: "flex-1 text-white px-4 py-1.5 rounded text-sm font-bold transition hover:opacity-90",
    style: {
      backgroundColor: '#001F5B'
    }
  }, "\u5132\u5B58\u6392\u7A0B"), /*#__PURE__*/React.createElement("button", {
    onClick: () => onDeleteTask(proj, task),
    className: "flex-shrink-0 px-3 py-1.5 rounded text-sm font-bold text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 transition",
    title: "\u522A\u9664\u6B64\u8A08\u756B\u5340\u9593\uFF08\u8EDF\u522A\u9664\uFF0C\u53EF\u7531\u8CC7\u6599\u5EAB\u9084\u539F\uFF09"
  }, "\uD83D\uDDD1 \u522A\u9664\u5340\u9593"))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h4", {
    className: "text-sm font-bold text-slate-800 mb-3"
  }, "W", String(currentWeek).padStart(2, '0'), " \u5BE6\u969B\u57F7\u884C\u56DE\u5831"), canClockIn ? /*#__PURE__*/React.createElement("div", {
    className: `p-4 rounded-xl border transition-colors ${status && status !== 'not_executed' ? 'bg-blue-50 border-blue-200' : 'bg-slate-50 border-slate-200'}`
  }, /*#__PURE__*/React.createElement("div", {
    className: "mb-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "font-bold text-slate-800 text-sm"
  }, "\u672C\u9031\u6B64\u4EFB\u52D9\u7684\u57F7\u884C\u72C0\u614B"), /*#__PURE__*/React.createElement("div", {
    className: "text-xs text-slate-500 mt-0.5"
  }, "\u56DE\u5831\u5F8C\u6703\u5728\u8A72\u9031\u7518\u7279\u689D\u6A19\u793A\u5C0D\u61C9\u984F\u8272\uFF08\u6709\u57F7\u884C=\u7DA0\u3001Monitor=\u85CD\u3001\u672A\u57F7\u884C=\u7070\uFF09\u3002Monitor \u70BA\u4F8B\u884C\u76E3\u63A7\u5DE5\u4F5C\uFF0C\u53EF\u4E0D\u586B\u8AAA\u660E\u3002")), /*#__PURE__*/React.createElement("div", {
    className: "space-y-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-3 gap-2"
  }, Object.entries(STATUS_META).map(([key, meta]) => /*#__PURE__*/React.createElement("button", {
    key: key,
    onClick: () => {
      setStatus(key);
      setNoteError('');
    },
    className: `py-3 rounded-lg border text-sm font-bold transition ${status === key ? meta.tag + ' ring-2 ring-offset-1 ring-slate-300' : 'bg-white text-slate-400 border-slate-200 hover:border-slate-400'}`
  }, meta.icon, " ", meta.label))), status && /*#__PURE__*/React.createElement("textarea", {
    value: note,
    onChange: e => {
      setNote(e.target.value);
      setNoteError('');
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
    className: "px-6 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-md"
  }, "\u5132\u5B58\u72C0\u614B"))) : /*#__PURE__*/React.createElement("div", {
    className: "bg-slate-50 border border-slate-200 p-4 rounded-xl text-sm"
  }, role === 'member' && isMyTask && isActiveThisWeek && !isReportingWeek && /*#__PURE__*/React.createElement("div", {
    className: "mb-3 bg-yellow-50 border border-yellow-300 text-yellow-800 rounded-lg px-3 py-2 text-xs font-bold"
  }, "\uD83D\uDD12 \u552F\u8B80\u6AA2\u8996\uFF1A\u50C5\u80FD\u56DE\u5831\u672C\u9031 W", String(todayWeek).padStart(2, '0'), " \u7684\u9032\u5EA6\uFF0C\u6B77\u53F2\u9031\u6B21\u53EA\u80FD\u700F\u89BD\u3002"), !isActiveThisWeek ? /*#__PURE__*/React.createElement("div", {
    className: "text-slate-500 text-center py-2"
  }, "\u6B64\u4EFB\u52D9\u6392\u5B9A\u65BC W", task.start, "\u2013W", task.end, "\uFF0C\u975E W", String(currentWeek).padStart(2, '0'), " \u6392\u5B9A\u9805\u76EE\u3002") : weekLog ? /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "mb-2"
  }, /*#__PURE__*/React.createElement("span", {
    className: "font-bold mr-2"
  }, "\u72C0\u614B\uFF1A"), /*#__PURE__*/React.createElement("span", {
    className: `px-2 py-0.5 rounded text-xs font-bold ${STATUS_META[weekLog.status]?.tag}`
  }, STATUS_META[weekLog.status]?.icon, " ", STATUS_META[weekLog.status]?.label)), /*#__PURE__*/React.createElement("div", {
    className: "font-bold mb-1"
  }, "\u5DE5\u4F5C\u8AAA\u660E\uFF1A"), /*#__PURE__*/React.createElement("div", {
    className: "bg-white p-3 rounded border border-slate-200 text-slate-700 whitespace-pre-wrap"
  }, weekLog.note || '（未填寫備註）')) : /*#__PURE__*/React.createElement("div", {
    className: "text-slate-500 text-center py-2"
  }, "\uD83D\uDCCC W", String(currentWeek).padStart(2, '0'), " \u672A\u56DE\u5831\u6B64\u9805\u76EE\uFF08\u7DAD\u6301\u8A08\u756B\u4E2D\uFF09\u3002"))))));
}
function ExtraNoteModal({
  currentWeek,
  initialNote,
  readOnly,
  onClose,
  onSave
}) {
  const [note, setNote] = useState(initialNote);
  const [error, setError] = useState('');
  const submit = () => {
    if (!note.trim()) {
      setError('請填寫內容後再儲存');
      return;
    }
    onSave(note.trim());
  };
  if (readOnly) {
    return /*#__PURE__*/React.createElement("div", {
      className: "fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[110] flex justify-center items-center p-4"
    }, /*#__PURE__*/React.createElement("div", {
      className: "bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden",
      onClick: e => e.stopPropagation()
    }, /*#__PURE__*/React.createElement("div", {
      className: "px-6 py-4 bg-slate-600 text-white flex justify-between items-center"
    }, /*#__PURE__*/React.createElement("h3", {
      className: "font-bold text-lg"
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
    }, "\u6B77\u53F2\u9031\u6B21\u50C5\u4F9B\u700F\u89BD\uFF0C\u7121\u6CD5\u4FEE\u6539\u3002"), initialNote ? /*#__PURE__*/React.createElement("div", {
      className: "text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-4 whitespace-pre-wrap"
    }, initialNote) : /*#__PURE__*/React.createElement("div", {
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
      className: "px-6 py-4 bg-orange-500 text-white flex justify-between items-center"
    }, /*#__PURE__*/React.createElement("h3", {
      className: "font-bold text-lg flex items-center"
    }, "\uD83D\uDCDD \u586B\u5BEB W", currentWeek, " \u975E\u5C08\u6848\u5DE5\u4F5C"), /*#__PURE__*/React.createElement("button", {
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
    }, initialNote ? /*#__PURE__*/React.createElement("div", {
      className: "mb-4 bg-green-50 border border-green-300 text-green-800 rounded-lg px-3 py-2.5 text-sm font-bold flex items-center"
    }, /*#__PURE__*/React.createElement("span", {
      className: "mr-2"
    }, "\u2705"), " \u672C\u9031\u5DF2\u9001\u51FA\u904E\uFF0C\u4EE5\u4E0B\u70BA\u5DF2\u5132\u5B58\u7684\u5167\u5BB9\uFF0C\u53EF\u4FEE\u6539\u5F8C\u91CD\u65B0\u9001\u51FA\u3002") : /*#__PURE__*/React.createElement("div", {
      className: "mb-4 bg-yellow-50 border border-yellow-300 text-yellow-800 rounded-lg px-3 py-2.5 text-sm font-bold flex items-center"
    }, /*#__PURE__*/React.createElement("span", {
      className: "mr-2"
    }, "\uD83D\uDCED"), " \u672C\u9031\u5C1A\u672A\u586B\u5BEB\u3002"), /*#__PURE__*/React.createElement("p", {
      className: "text-sm text-slate-500 mb-4 border-l-4 border-orange-400 pl-3"
    }, "\u5C08\u6848\u5916\u7684\u9805\u76EE\uFF08\u65E5\u5E38\u7DAD\u904B\u3001\u81E8\u6642\u4EA4\u8FA6\u3001\u6703\u8B70\u3001\u6559\u80B2\u8A13\u7DF4\u7B49\uFF09\u8ACB\u586B\u5BEB\u65BC\u6B64\uFF0C\u6703\u5448\u73FE\u5728\u5718\u968A\u7E3D\u7D50\u770B\u677F\u3002"), /*#__PURE__*/React.createElement("textarea", {
      value: note,
      onChange: e => {
        setNote(e.target.value);
        setError('');
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
      className: "px-6 py-2 text-sm bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-lg shadow-md"
    }, "\u9001\u51FA\u56DE\u5831")))))
  );
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
    className: "px-5 py-4 text-white flex justify-between items-center bg-orange-600"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h3", {
    className: "font-bold text-lg"
  }, "\u23F0 \u5373\u5C07\u5230\u671F\u6E05\u55AE"), /*#__PURE__*/React.createElement("p", {
    className: "text-xs text-orange-100 mt-0.5"
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
  pending,
  currentWeek,
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
      backgroundColor: '#001F5B'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h3", {
    className: "font-bold text-lg"
  }, "\uD83D\uDD14 W", String(currentWeek).padStart(2, '0'), " \u5F85\u56DE\u5831\u6E05\u55AE"), /*#__PURE__*/React.createElement("p", {
    className: "text-xs text-blue-200 mt-0.5"
  }, "\u672C\u9031\u6392\u5B9A\u4F46\u5C1A\u672A\u6253\u5361\u7684\u4EFB\u52D9")), /*#__PURE__*/React.createElement("button", {
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
    className: "flex-1 overflow-y-auto p-4 space-y-2.5"
  }, pending.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "text-center text-slate-400 py-16"
  }, /*#__PURE__*/React.createElement("div", {
    className: "text-4xl mb-3"
  }, "\uD83C\uDF89"), /*#__PURE__*/React.createElement("div", {
    className: "font-bold text-slate-600"
  }, "\u672C\u9031\u4EFB\u52D9\u5DF2\u5168\u6578\u56DE\u5831"), /*#__PURE__*/React.createElement("div", {
    className: "text-xs mt-1"
  }, "\u8F9B\u82E6\u4E86\uFF01")) : pending.map(({
    proj,
    task
  }) => /*#__PURE__*/React.createElement("button", {
    key: task.id,
    onClick: () => onSelect({
      proj,
      task
    }),
    className: "w-full text-left bg-yellow-50 hover:bg-yellow-100 border border-yellow-200 rounded-xl p-3 transition group"
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
  }, "\u6392\u7A0B W", task.start, "\u2013W", task.end, " \xB7 ", proj.category)), /*#__PURE__*/React.createElement("div", {
    className: "flex-shrink-0 text-blue-600 font-bold text-xs bg-white border border-blue-200 rounded-full px-2.5 py-1 group-hover:bg-blue-600 group-hover:text-white transition"
  }, "\u56DE\u5831 \u203A")))))));
}
function WeeklyReportDashboard({
  currentWeek,
  year,
  users,
  projects,
  taskLogs,
  extraNotes,
  onClose
}) {
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
    return {
      user,
      activeTasks,
      pendingTasks,
      extraNote: extraNotes[user]?.[currentWeek],
      total: activeTasks.length + pendingTasks.length
    };
  }), [users, projects, taskLogs, extraNotes, currentWeek]);
  const buildReportText = () => {
    const lines = [`【MSD W${String(currentWeek).padStart(2, '0')} 團隊週報】`, ''];
    summary.forEach(s => {
      if (s.activeTasks.length === 0 && !s.extraNote) return;
      lines.push(`■ ${s.user}（回報 ${s.activeTasks.length}/${s.total}）`);
      s.activeTasks.forEach(({
        proj,
        task,
        log
      }) => {
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
      try {
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {}
      document.body.removeChild(ta);
    }
  };
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
    className: "px-3 py-1.5 rounded-lg text-xs font-bold transition border bg-green-600 hover:bg-green-500 border-green-400/60 text-white",
    title: "\u4E0B\u8F09 Excel \u9031\u5831(.xlsx)"
  }, "\u2B07\uFE0F \u532F\u51FA Excel"), /*#__PURE__*/React.createElement("button", {
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
    className: "flex-1 overflow-y-auto p-6 space-y-5"
  }, summary.map(({
    user,
    activeTasks,
    pendingTasks,
    extraNote,
    total
  }) => {
    if (activeTasks.length === 0 && !extraNote && pendingTasks.length === 0) return null;
    const rate = total > 0 ? Math.round(activeTasks.length / total * 100) : 0;
    return /*#__PURE__*/React.createElement("div", {
      key: user,
      className: "bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden"
    }, /*#__PURE__*/React.createElement("div", {
      className: "bg-slate-100 px-4 py-2 border-b border-slate-200 font-bold text-slate-800 flex items-center"
    }, /*#__PURE__*/React.createElement("div", {
      className: "w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs mr-2 flex-shrink-0"
    }, user[0]), /*#__PURE__*/React.createElement("span", {
      className: "mr-3"
    }, user), total > 0 && /*#__PURE__*/React.createElement("div", {
      className: "flex items-center flex-1 max-w-[180px]"
    }, /*#__PURE__*/React.createElement("div", {
      className: "flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden"
    }, /*#__PURE__*/React.createElement("div", {
      className: `h-full rounded-full transition-all ${rate === 100 ? 'bg-green-500' : rate >= 50 ? 'bg-blue-500' : 'bg-yellow-400'}`,
      style: {
        width: `${rate}%`
      }
    })), /*#__PURE__*/React.createElement("span", {
      className: "ml-2 text-[10px] font-bold text-slate-500"
    }, activeTasks.length, "/", total, " \u56DE\u5831"))), /*#__PURE__*/React.createElement("div", {
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
    }, proj.name), /*#__PURE__*/React.createElement("span", {
      className: `flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold ${STATUS_META[log.status]?.tag}`
    }, STATUS_META[log.status]?.label)), /*#__PURE__*/React.createElement("div", {
      className: "text-slate-600 my-1 font-medium text-xs"
    }, task.name), log.note && /*#__PURE__*/React.createElement("div", {
      className: "text-slate-700 text-xs bg-white p-1.5 rounded border border-slate-100 whitespace-pre-wrap"
    }, log.note))) : /*#__PURE__*/React.createElement("div", {
      className: "text-sm text-slate-400 italic py-2"
    }, "\u672C\u9031\u7121\u5C08\u6848\u6295\u5165"), pendingTasks.length > 0 && /*#__PURE__*/React.createElement("div", {
      className: "text-[11px] text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-lg px-2.5 py-1.5"
    }, "\u5C1A\u6709 ", pendingTasks.length, " \u9805\u672C\u9031\u6392\u5B9A\u4EFB\u52D9\u672A\u56DE\u5831")), /*#__PURE__*/React.createElement("div", {
      className: "space-y-2.5 md:border-l md:border-slate-100 md:pl-4"
    }, /*#__PURE__*/React.createElement("div", {
      className: "text-xs font-bold text-slate-400 border-b border-slate-100 pb-1"
    }, "\uD83D\uDCDD \u65E5\u5E38\u71DF\u904B / \u81E8\u6642\u4EA4\u8FA6\uFF08\u975E\u5C08\u6848\uFF09"), extraNote ? /*#__PURE__*/React.createElement("div", {
      className: "text-sm text-slate-700 bg-orange-50 p-3 rounded-lg border border-orange-200 whitespace-pre-wrap"
    }, extraNote) : /*#__PURE__*/React.createElement("div", {
      className: "text-sm text-slate-400 italic py-2"
    }, "\u7121\u586B\u5BEB\u5176\u4ED6\u9805\u76EE"))));
  })));
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
  const submit = () => {
    if (!name.trim()) {
      setError('專案名稱不可空白');
      return;
    }
    if (!category.trim()) {
      setError('分類不可空白');
      return;
    }
    onSave({
      mode: info.mode,
      projectId: isEdit ? p.id : undefined,
      owner,
      name: name.trim(),
      category: category.trim(),
      type
    });
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
    onChange: e => setType(e.target.value),
    className: "mt-1 w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500 bg-white"
  }, Object.entries(PROJECT_TYPES).map(([key, meta]) => /*#__PURE__*/React.createElement("option", {
    key: key,
    value: key
  }, key.toUpperCase(), "\xB7", meta.label)))), isEdit && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    className: "text-xs font-bold text-slate-500"
  }, "\u8CA0\u8CAC\u4EBA"), /*#__PURE__*/React.createElement("select", {
    value: owner,
    onChange: e => setOwner(e.target.value),
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
    className: "px-6 py-2 text-sm text-white font-bold rounded-lg shadow-md transition hover:opacity-90",
    style: {
      backgroundColor: '#001F5B'
    }
  }, isEdit ? '儲存變更' : '新增專案')))));
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
  const submit = () => {
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
    onSave(project, taskName.trim(), s, e);
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
    max: "52",
    value: start,
    onChange: e => {
      setStart(e.target.value);
      setError('');
    },
    className: "mt-1 w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500"
  })), /*#__PURE__*/React.createElement("div", {
    className: "w-1/2"
  }, /*#__PURE__*/React.createElement("label", {
    className: "text-xs font-bold text-slate-500"
  }, "\u7D50\u675F\u9031"), /*#__PURE__*/React.createElement("input", {
    type: "number",
    min: "1",
    max: "52",
    value: end,
    onChange: e => {
      setEnd(e.target.value);
      setError('');
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
    className: "px-6 py-2 text-sm text-white font-bold rounded-lg shadow-md transition hover:opacity-90",
    style: {
      backgroundColor: '#001F5B'
    }
  }, "\u65B0\u589E\u5340\u9593")))));
}

// 自製刪除確認視窗(取代 window.confirm,樣式與系統一致)
function ConfirmModal({
  info,
  onCancel
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[150] flex justify-center items-center p-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden",
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("div", {
    className: "px-6 py-4 bg-red-600 text-white flex items-center"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-xl mr-2"
  }, "\u26A0\uFE0F"), /*#__PURE__*/React.createElement("h3", {
    className: "font-bold text-lg"
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
    onClick: info.onConfirm,
    className: "px-6 py-2 text-sm bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg shadow-md"
  }, "\u78BA\u5B9A\u522A\u9664")))));
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
  }
};
const AUDIT_ENTITY_LABELS = {
  Project: '專案',
  Task: '任務',
  WeeklyLog: '週回報',
  ExtraNote: '非專案事項',
  User: '成員'
};

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
