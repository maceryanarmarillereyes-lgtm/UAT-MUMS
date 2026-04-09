/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */


/* File: public/js/pages/my_task.js */

(window.Pages = window.Pages || {}, window.Pages.my_task = function myTaskPage(root) {
  const esc = (v) => (window.UI && UI.esc ? UI.esc(v) : String(v == null ? '' : v));
  const safeText = (v, fallback = 'N/A') => {
    const out = String(v == null ? '' : v).trim();
    return out || fallback;
  };

  const state = {
    loading: false,
    creating: false,
    activeTab: 'assigned',
    pendingStatusByItemId: {},
    savingStatusByItemId: {},
    problemModal: { open: false, taskItemId: '', prevStatus: 'Pending', notes: '', error: '' },
    deepLinkDistId: '',
    deepLinkApplied: false,
    deepLinkScrolled: false,
    assignedGroups: [],
    expandedAssignedId: '',
    distributions: [],
    expandedDistributionId: '',
    distributionItemsById: {},
    members: [],
    modalOpen: false,
    parseError: '',
    dragActive: false,
    uploadMeta: { name: '', rows: 0, sheets: 0 },
    parsedRows: [],
    assigneeColumnIndex: -1,
    form: { title: '', description: '', reference_url: '', deadline: '', enable_daily_alerts: true },
    isSheetJsReady: false,
    loginAlert: { open: false, totalOverdue: 0, distributions: [], isHourlyEscalation: false },
    isFullscreen: false,       
    showWorkloadModal: false,
    confirmCloseModal: false, 
    
    autoAssign: {
      open: false,
      group: 'ALL',
      includeLead: false
    },
    
    deleteModal: { open: false, distId: '', title: '' },

    // ENTERPRISE UPGRADE: Filter State per Distribution
    distributionFilters: {} 
  };

  const LOGIN_ALERT_SESSION_KEY = 'mums:my_task:high_priority_login_alert_v2';
  const STATUS_OPTIONS = ['Pending', 'Ongoing', 'Completed', 'With Problem'];

  function normalizeItemStatus(value) {
    const s = String(value == null ? '' : value).trim().toLowerCase();
    if (!s) return 'Pending';
    if (s === 'pending' || s === 'p' || s === 'new') return 'Pending';
    if (s === 'ongoing' || s === 'in progress' || s === 'in_progress') return 'Ongoing';
    if (s === 'completed' || s === 'done' || s === 'complete') return 'Completed';
    if (s === 'with problem' || s === 'with_problem' || s === 'problem') return 'With Problem';
    return 'Pending';
  }

  function statusClass(label) {
    const s = normalizeItemStatus(label).toLowerCase();
    if (s === 'completed') return 'status-completed';
    if (s === 'ongoing') return 'status-ongoing';
    if (s === 'with problem') return 'status-problem';
    return 'status-pending';
  }

  function getQueryParam(name) {
    try { return new URLSearchParams(window.location.search || '').get(name); } catch (_) { return null; }
  }

  function findTaskItem(taskItemId) {
    const id = String(taskItemId || '');
    for (const group of state.assignedGroups) {
      const hit = (Array.isArray(group.items) ? group.items : []).find((r) => String(r.id || '') === id);
      if (hit) return { group, item: hit, source: 'assigned' };
    }
    for (const distId in state.distributionItemsById) {
      const items = state.distributionItemsById[distId];
      const hit = items.find((r) => String(r.id || '') === id);
      if (hit) {
        const dist = state.distributions.find(d => String(d.id || d.distribution_id) === String(distId));
        return { group: dist, item: hit, source: 'distribution' };
      }
    }
    return { group: null, item: null, source: null };
  }

  function applyDeepLinkIfNeeded() {
    if (state.deepLinkApplied) return;
    const dist = String(getQueryParam('dist') || '').trim();
    if (!dist) return;
    state.deepLinkApplied = true;
    state.deepLinkDistId = dist;
    state.activeTab = 'assigned';
    state.expandedAssignedId = dist;
  }

  function requestDeepLinkScroll() {
    if (!state.deepLinkDistId || state.deepLinkScrolled) return;
    state.deepLinkScrolled = true;
    setTimeout(() => {
      const el = document.getElementById(`assignedGroup_${state.deepLinkDistId}`);
      if (el && el.scrollIntoView) { try { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) { el.scrollIntoView(); } }
    }, 50);
  }

  window.addEventListener('mums:open_task_distribution', (ev) => {
    try {
      const distId = String(ev && ev.detail ? ev.detail.distribution_id || '' : '');
      if (!distId) return;
      state.activeTab = 'assigned';
      state.expandedAssignedId = distId;
      state.deepLinkDistId = distId;
      state.deepLinkApplied = true;
      state.deepLinkScrolled = false;
      render();
    } catch (_) {}
  });

  function normalizeName(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function percent(done, total) { return !total ? 0 : Math.max(0, Math.min(100, Math.round((done / total) * 100))); }

  function safeDate(value) {
    if (!value) return 'N/A';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
  }

  function unresolvedRowsCount() { return state.parsedRows.filter((row) => !row.assigned_to).length; }

  function isDailyAlertsEnabled(value) {
    if (value === true || value === 1) return true;
    const normalized = String(value == null ? '' : value).trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 't' || normalized === 'yes';
  }

  // ENTERPRISE UPGRADE: Centralized Team Extractor Helper
  function getMemberTeam(uid) {
    if (!uid) return 'Unassigned';
    const m = state.members.find(mem => String(mem.user_id || mem.id) === uid);
    if (!m) return 'Unknown Member';
    let t = m.duty || m.shift || m.team_name || m.team || m.team_id || m.department;
    if (!t && m.teams) t = m.teams.duty || m.teams.name || m.teams.shift;
    if (!t && m.user_metadata) t = m.user_metadata.duty || m.user_metadata.shift;
    return t ? String(t).trim() : 'No Team Assigned';
  }

  function computeLoginAlertData() {
    const distributions = {};
    let totalOverdue = 0;
    let isHourlyEscalation = false;
    const now = Date.now();

    state.assignedGroups.forEach((group) => {
      if (!isDailyAlertsEnabled(group && group.enable_daily_alerts)) return;
      const distTitle = safeText(group.project_title, 'Untitled Distribution');

      (Array.isArray(group.items) ? group.items : []).forEach((item) => {
        const status = normalizeItemStatus(item && item.status);
        if (status !== 'Pending' && status !== 'Ongoing') return;

        const deadline = item && (item.deadline || item.deadline_at || item.due_at);
        if (!deadline) return;

        const ms = new Date(deadline).getTime();
        const diffHours = (ms - now) / (1000 * 60 * 60);

        if (diffHours <= 24 && diffHours >= -24) isHourlyEscalation = true; 
        if (diffHours < 0) totalOverdue += 1;

        if (!distributions[distTitle]) {
          distributions[distTitle] = { pendingCount: 0, deadlineMs: ms };
        }
        distributions[distTitle].pendingCount += 1;
        if (ms < distributions[distTitle].deadlineMs) {
          distributions[distTitle].deadlineMs = ms;
        }
      });
    });

    const distList = Object.keys(distributions)
      .map(k => ({ title: k, ...distributions[k] }))
      .sort((a,b) => a.deadlineMs - b.deadlineMs);

    return { totalOverdue, distributions: distList, isHourlyEscalation };
  }

  function maybeShowLoginAlertOncePerSession() {
    let alreadyShown = false;
    try { alreadyShown = sessionStorage.getItem(LOGIN_ALERT_SESSION_KEY) === '1'; } catch (_) {}
    if (alreadyShown) return;
    const info = computeLoginAlertData();
    if (info.distributions.length < 1) return;
    state.loginAlert = { open: true, ...info };
    try { sessionStorage.setItem(LOGIN_ALERT_SESSION_KEY, '1'); } catch (_) {}
  }

  function closeLoginAlertModal() { state.loginAlert.open = false; render(); }

  function normalizeStatus(value, pendingCount) {
    return Number(pendingCount || 0) === 0 ? 'COMPLETED' : (String(value || 'ONGOING').toUpperCase() === 'COMPLETED' ? 'COMPLETED' : 'ONGOING');
  }

  function guessMember(rawValue) {
    const input = normalizeName(rawValue);
    if (!input) return null;
    let winner = null;
    state.members.forEach((member) => {
      const label = normalizeName(member.name || member.username || member.user_id);
      if (!label) return;
      let score = 0;
      if (label === input) score = 1;
      else if (label.includes(input) || input.includes(label)) score = 0.86;
      else {
        const a = input.split(' ').filter(Boolean);
        const b = label.split(' ').filter(Boolean);
        const overlap = a.filter((token) => b.includes(token)).length;
        score = overlap / Math.max(a.length || 1, b.length || 1);
      }
      if (!winner || score > winner.score) winner = { member, score };
    });
    return winner;
  }

  async function exportDistributionToExcel(distId, title) {
    let items = state.distributionItemsById[distId];
    if (!items || items.length === 0) {
      state.loading = true; render();
      const out = await CloudTasks.distributionItems(distId);
      state.loading = false;
      if(out.ok && Array.isArray(out.data.rows)) items = out.data.rows;
      else { alert("Failed to fetch data for export."); render(); return; }
    }
    
    if (items.length === 0) { alert("No tasks available to export."); return; }

    await ensureSheetJs();
    const exportData = items.map(i => {
       const uid = String(i.assigned_to || i.assignee_user_id || '').trim();
       const m = state.members.find(mem => String(mem.user_id || mem.id) === uid);
       const assigneeName = m ? (m.name || m.username || uid) : (uid || 'Unassigned');

       return {
         'Case Number': safeText(i.case_number || i.case_no, 'N/A'),
         'Site': safeText(i.site, 'N/A'),
         'Task Description Payload': i.description || '',
         'Assignee': assigneeName,
         'Team/Shift': getMemberTeam(uid),
         'Status': normalizeItemStatus(i.status),
         'Deadline': safeDate(i.deadline || i.deadline_at || i.due_at),
         'Problem Notes': i.problem_notes || ''
       };
    });

    try {
      const ws = window.XLSX.utils.json_to_sheet(exportData);
      const wb = window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(wb, ws, "Deployment Data");
      const safeTitle = String(title).replace(/[^a-z0-9]/gi, '_');
      window.XLSX.writeFile(wb, `MUMS_Export_${safeTitle}.xlsx`);
    } catch(err) {
      console.error(err);
      alert("Error generating Excel file.");
    }
  }

  function ensureStyleTag() {
    if (document.getElementById('my-task-dashboard-style')) return;
    const style = document.createElement('style');
    style.id = 'my-task-dashboard-style';
    style.textContent = `
      /* Base & Existing Styles */
      .task-shell{position:relative;display:flex;flex-direction:column;gap:20px;color:#e2e8f0; padding: 10px 0;}
      .task-header{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 16px;}
      .task-title-main { font-size: 24px; font-weight: 900; color: #f8fafc; margin: 0; letter-spacing: -0.5px;}
      .task-section{display:flex;flex-direction:column;gap:12px; margin-top: 8px;}
      
      .task-section-title{
        font-size:16px; font-weight:800; display:flex; align-items:center; gap:8px; color:#e2e8f0;
        text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;
      }
      .task-section-title .badge-count {
        background: rgba(56, 189, 248, 0.15); color: #38bdf8; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 900;
      }

      .task-card{
        background:linear-gradient(145deg, rgba(30,41,59,0.4), rgba(15,23,42,0.6));
        border-radius:12px; padding:18px 20px; 
        border:1px solid rgba(255,255,255,0.06);
        box-shadow: 0 4px 12px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.02);
        transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
      }
      .task-card:hover {
        transform: translateY(-2px);
        border-color: rgba(56, 189, 248, 0.3);
        box-shadow: 0 8px 20px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.05);
      }
      
      .task-accordion{display:block;width:100%;text-align:left;border:none;background:transparent;color:inherit;padding:0;cursor:pointer; outline:none;}
      
      .task-title{font-size:17px;font-weight:800;line-height:1.3;margin-bottom:6px;color:#f8fafc; display:flex; align-items:center; gap:8px;}
      .task-meta{font-size:12px;color:#94a3b8; line-height: 1.5; white-space: normal; word-break: break-word;}
      .task-meta strong { color: #cbd5e1; }
      
      .task-progress-rail{height:10px;background:rgba(2,6,23,0.6);border-radius:999px;overflow:hidden; margin-top:12px; border: 1px solid rgba(255,255,255,0.03); box-shadow: inset 0 1px 3px rgba(0,0,0,0.3);}
      .task-progress-fill{height:100%;background:linear-gradient(90deg,#0ea5e9,#38bdf8); border-radius:999px; transition: width 0.4s ease-out;}
      .task-progress-fill.complete { background:linear-gradient(90deg,#10b981,#34d399); box-shadow: 0 0 10px rgba(16,185,129,0.4); }

      .task-empty{padding:30px 20px;text-align:center;color:#64748b;border:1px dashed rgba(255,255,255,.1);border-radius:12px; background: rgba(15,23,42,0.3); font-size: 14px; font-weight: 600;}
      
      /* TABS */
      .task-tabs{display:flex;gap:10px;flex-wrap:wrap}
      .task-tab{
        border:1px solid rgba(148,163,184,.2);border-radius:8px;background:rgba(15,23,42,.6);
        padding:8px 16px;color:#cbd5e1;cursor:pointer;font-weight:600; font-size: 13px;
        transition:all 0.2s; display:flex; align-items:center; gap:6px;
      }
      .task-tab:hover{background:rgba(56,189,248,.1);border-color:rgba(56,189,248,.4); color:#f8fafc;}
      .task-tab.active{background:linear-gradient(145deg, #0ea5e9, #0284c7); border-color:#38bdf8; color:#fff; box-shadow: 0 4px 12px rgba(14,165,233,0.3);}

      .task-ref{display:inline-flex;align-items:center;justify-content:center; padding: 4px 12px; border:1px solid rgba(14,165,233,0.4); border-radius:6px; text-decoration:none; color:#38bdf8; background: rgba(14,165,233,0.1); font-size: 11px; font-weight: 700; text-transform: uppercase; transition: all 0.2s;}
      .task-ref:hover { background: rgba(14,165,233,0.2); transform: translateY(-1px); box-shadow: 0 4px 10px rgba(14,165,233,0.2); }

      /* GRID INNER - FIXED SCROLLING */
      .task-grid-wrap{max-height:0;overflow:hidden;opacity:0;transition:max-height .3s ease, opacity .2s ease;margin-top:0}
      .task-grid-wrap.open{max-height:2000px;opacity:1;margin-top:16px; border-top: 1px solid rgba(255,255,255,0.05); padding-top:16px;}
      .task-grid { border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); overflow-y: auto; max-height: 450px; background: rgba(2,6,23,0.4); }
      .task-grid table{width:100%;border-collapse:collapse; }
      .task-grid th{padding:12px;border-bottom:1px solid rgba(255,255,255,.05);font-size:11px; font-weight:700; text-align:left; color:#94a3b8; text-transform:uppercase; letter-spacing:0.5px; background: rgba(15,23,42,0.95); position:sticky; top:0; z-index:2;}
      .task-grid td{padding:12px;border-bottom:1px solid rgba(255,255,255,.02);font-size:13px;text-align:left;vertical-align:top}
      .task-grid tbody tr:hover{background:rgba(255,255,255,.03)}
      
      .task-grid::-webkit-scrollbar { width: 6px; height: 6px; }
      .task-grid::-webkit-scrollbar-track { background: transparent; }
      .task-grid::-webkit-scrollbar-thumb { background: rgba(148, 163, 184, 0.3); border-radius: 10px; }
      .task-grid::-webkit-scrollbar-thumb:hover { background: rgba(148, 163, 184, 0.5); }

      .task-overlay{position:absolute;inset:0;background:rgba(2,6,23,.7);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:40;border-radius:8px}
      .task-spinner{width:40px;height:40px;border-radius:999px;border:4px solid rgba(255,255,255,.1);border-top-color:#38bdf8;animation:taskSpin 1s linear infinite}
      
      .task-status-select{width:max-content;max-width:220px;padding:6px 12px;border-radius:6px;font-weight:700;font-size:12px;border:1px solid rgba(148,163,184,.2);background:rgba(15,23,42,.8);color:#e2e8f0;outline:none; cursor:pointer;}
      .task-status-select:disabled{opacity:.5;cursor:not-allowed}
      .task-status-select.status-pending{border-color:rgba(245,158,11,.4);background:rgba(245,158,11,.1);color:#fcd34d}
      .task-status-select.status-ongoing{border-color:rgba(56,189,248,.4);background:rgba(56,189,248,.1);color:#7dd3fc}
      .task-status-select.status-completed{border-color:rgba(16,185,129,.4);background:rgba(16,185,129,.1);color:#6ee7b7}
      .task-status-select.status-problem{border-color:rgba(239,68,68,.4);background:rgba(239,68,68,.1);color:#fca5a5}
      .task-problem-notes{font-size:12px;color:#fca5a5;line-height:1.4;word-break:break-word;opacity:.9; background: rgba(239,68,68,0.1); padding: 8px; border-radius: 6px; border-left: 3px solid #ef4444; margin-top: 6px;}

      /* ENTERPRISE UPGRADE: Interactive Summary & Team Progress Grid */
      .enterprise-dashboard-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 16px; align-items: start; }
      @media (max-width: 900px) { .enterprise-dashboard-grid { grid-template-columns: 1fr; } }
      
      .dist-filter-btn { display:flex; flex-direction:column; padding:10px 14px; border-radius:8px; border:1px solid rgba(255,255,255,0.05); background:rgba(2,6,23,0.6); cursor:pointer; transition:all 0.2s; outline:none; text-align:left; flex:1; min-width:80px; position:relative; overflow:hidden;}
      .dist-filter-btn:hover { background:rgba(15,23,42,0.8); transform:translateY(-1px); box-shadow:0 4px 12px rgba(0,0,0,0.2); }
      .dist-filter-btn.active::before { content:''; position:absolute; inset:0; background:currentColor; opacity:0.05; }
      
      /* Active Filter Glowing Borders */
      .dist-filter-btn.active[data-filter="Pending"] { border-color:#fcd34d; box-shadow:0 0 15px rgba(245,158,11,0.2); }
      .dist-filter-btn.active[data-filter="Ongoing"] { border-color:#38bdf8; box-shadow:0 0 15px rgba(56,189,248,0.2); }
      .dist-filter-btn.active[data-filter="With Problem"] { border-color:#ef4444; box-shadow:0 0 15px rgba(239,68,68,0.2); }
      .dist-filter-btn.active[data-filter="Completed"] { border-color:#10b981; box-shadow:0 0 15px rgba(16,185,129,0.2); }

      .team-progress-pill { background: rgba(15,23,42,0.6); border:1px solid rgba(255,255,255,0.04); padding: 8px 12px; border-radius: 6px; display:flex; flex-direction:column; gap:4px; margin-bottom:6px; }
      .team-progress-pill-header { display:flex; justify-content:space-between; font-size:11px; font-weight:700; color:#e2e8f0; }
      .team-progress-pill-rail { height:4px; background:rgba(2,6,23,0.8); border-radius:999px; overflow:hidden; }
      .team-progress-pill-fill { height:100%; background:linear-gradient(90deg, #0ea5e9, #38bdf8); border-radius:999px; }

      /* ========================================= */
      /* MODAL UI UPGRADE    */
      /* ========================================= */
      
      .task-modal-glass::-webkit-scrollbar, .glass-table-container::-webkit-scrollbar, .modal-body-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
      .task-modal-glass::-webkit-scrollbar-track, .glass-table-container::-webkit-scrollbar-track, .modal-body-scroll::-webkit-scrollbar-track { background: transparent; }
      .task-modal-glass::-webkit-scrollbar-thumb, .glass-table-container::-webkit-scrollbar-thumb, .modal-body-scroll::-webkit-scrollbar-thumb { background: rgba(148, 163, 184, 0.3); border-radius: 10px; }
      .task-modal-glass::-webkit-scrollbar-thumb:hover, .glass-table-container::-webkit-scrollbar-thumb:hover, .modal-body-scroll::-webkit-scrollbar-thumb:hover { background: rgba(148, 163, 184, 0.5); }
      .task-modal-backdrop{position:fixed;inset:0;background:rgba(2,6,23,.85);backdrop-filter:blur(10px);z-index:14060;display:flex;align-items:center;justify-content:center;padding:20px;overflow:hidden;}
      
      .task-modal-glass{
        width:min(1100px,100%); max-height:94vh; overflow:hidden;
        background:linear-gradient(145deg, rgba(15,23,42,0.98) 0%, rgba(2,6,23,0.99) 100%);
        border:1px solid rgba(148,163,184,.2); border-radius:16px; 
        box-shadow: 0 25px 50px -12px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.1);
        display:flex; flex-direction:column; transition: all 0.3s ease;
      }

      .task-modal-glass.is-fullscreen { width: 98vw !important; height: 98vh !important; max-height: 98vh !important; border-radius:10px; }
      .task-modal-glass.is-fullscreen .modal-body-scroll { padding: 20px 30px; }
      .task-modal-glass.is-fullscreen .glass-table-container { flex: 1; max-height: none !important; margin-bottom: 0; }
      
      .modal-header-glass {
        padding: 20px 24px; border-bottom: 1px solid rgba(255,255,255,0.06);
        display:flex; justify-content:space-between; align-items:center;
        background: rgba(15,23,42,0.6); z-index:10; backdrop-filter:blur(10px); flex-shrink:0;
      }
      
      .modal-header-glass h3 { margin:0; font-size:18px; font-weight:800; color:#f8fafc; letter-spacing:-0.5px; display:flex; align-items:center; gap:8px;}
      
      .modal-body-scroll {
        padding: 24px; overflow-y:auto; flex:1; display:flex; flex-direction:column; gap:20px;
      }

      .glass-card {
        background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05);
        border-radius: 12px; padding: 20px;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.02);
      }
      
      .premium-label { display:block; font-size:12px; font-weight:600; color:#94a3b8; margin-bottom:6px; text-transform:uppercase; letter-spacing:0.5px; }
      
      .premium-input {
        width:100%; background:rgba(2,6,23,0.5); border:1px solid rgba(148,163,184,0.2);
        border-radius:8px; padding:10px 14px; color:#f8fafc; font-size:14px;
        transition:all 0.2s; outline:none; box-shadow: inset 0 2px 4px rgba(0,0,0,0.2);
      }
      .premium-input:focus { border-color:#38bdf8; box-shadow: 0 0 0 2px rgba(56,189,248,0.2), inset 0 2px 4px rgba(0,0,0,0.2); background:rgba(15,23,42,0.8); }
      .premium-input::placeholder { color:#475569; }
      
      .premium-checkbox-container {
        display:flex; align-items:center; gap:10px; padding:12px 16px; 
        background:rgba(2,6,23,0.4); border:1px solid rgba(148,163,184,0.15); border-radius:8px;
        cursor:pointer; transition:all 0.2s;
      }
      .premium-checkbox-container:hover { border-color:rgba(148,163,184,0.3); background:rgba(15,23,42,0.6); }
      
      .upload-zone-glass {
        border: 2px dashed rgba(56,189,248,0.3); border-radius: 12px; padding: 40px 20px;
        text-align: center; transition: all 0.3s ease; background: rgba(56,189,248,0.03);
        cursor:pointer; position:relative; overflow:hidden;
      }
      .upload-zone-glass:hover, .upload-zone-glass.drag {
        border-color: #38bdf8; background: rgba(56,189,248,0.08); transform: translateY(-2px);
        box-shadow: 0 10px 25px -5px rgba(56,189,248,0.1);
      }
      .upload-icon { font-size:32px; margin-bottom:12px; opacity:0.8; }
      
      .stat-container { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; }
      .stat-box { flex: 1; min-width: 140px; max-width: 250px; background: linear-gradient(145deg, rgba(30,41,59,0.5), rgba(15,23,42,0.8)); padding: 16px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.06); display: flex; flex-direction: column; gap: 6px; box-shadow: inset 0 1px 0 rgba(255,255,255,0.05), 0 4px 6px -1px rgba(0,0,0,0.1); }
      .stat-label { font-size: 11px; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }
      .stat-value { font-size: 28px; font-weight: 900; color: #f8fafc; line-height: 1; letter-spacing: -1px; }

      .enterprise-toolbar { display:flex; justify-content:space-between; align-items:center; background:linear-gradient(90deg, rgba(15,23,42,0.8), rgba(2,6,23,0.6)); padding:12px 18px; border-radius:10px; border:1px solid rgba(255,255,255,0.06); margin-bottom:16px; flex-wrap:wrap; gap:12px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); }

      .glass-table-container { border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; overflow-y: auto; background: rgba(2,6,23,0.5); max-height: 380px; transition: all 0.3s ease; box-shadow: inset 0 2px 10px rgba(0,0,0,0.2); }
      .glass-table-container table { width:100%; border-collapse:collapse; }
      .glass-table-container th { background: rgba(15,23,42,0.95); color:#cbd5e1; font-weight:700; text-transform:uppercase; font-size:11px; letter-spacing:0.5px; padding:14px 12px; border-bottom:1px solid rgba(255,255,255,0.08); position:sticky; top:0; z-index:5; backdrop-filter:blur(8px); }
      .glass-table-container td { padding:12px; border-bottom:1px solid rgba(255,255,255,0.02); font-size:13px; vertical-align:middle; }
      .glass-table-container tr:last-child td { border-bottom:none; }
      .glass-table-container tr:hover { background: rgba(255,255,255,0.03); }
      
      .btn-glass {
        padding: 8px 16px; border-radius: 8px; font-weight: 600; font-size: 13px;
        cursor: pointer; transition: all 0.2s; outline: none; border: 1px solid transparent; display:inline-flex; align-items:center; gap:6px; justify-content:center;
      }
      .btn-glass-ghost { background: transparent; color: #94a3b8; border-color: rgba(148,163,184,0.3); }
      .btn-glass-ghost:hover { background: rgba(148,163,184,0.1); color: #f8fafc; }
      .btn-glass-primary { background: linear-gradient(145deg, #0ea5e9, #0284c7); color: #fff; box-shadow: 0 4px 12px rgba(14,165,233,0.3); border:1px solid rgba(56,189,248,0.4); }
      .btn-glass-primary:hover:not(:disabled) { background: linear-gradient(145deg, #38bdf8, #0ea5e9); transform: translateY(-1px); box-shadow: 0 6px 16px rgba(14,165,233,0.4); }
      .btn-glass-primary:disabled { background: rgba(14,165,233,0.2); color: rgba(255,255,255,0.4); border-color:transparent; cursor: not-allowed; box-shadow:none; }
      
      .btn-glass-danger { background: rgba(239,68,68,0.1); color: #ef4444; border: 1px solid rgba(239,68,68,0.3); }
      .btn-glass-danger:hover { background: rgba(239,68,68,0.2); border-color: #ef4444; color: #fca5a5; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(239,68,68,0.2); }

      .btn-glass-action { background: linear-gradient(145deg, #10b981, #059669); color: #fff; border:1px solid rgba(52,211,153,0.4); box-shadow: 0 4px 12px rgba(16,185,129,0.3); }
      .btn-glass-action:hover:not(:disabled) { background: linear-gradient(145deg, #34d399, #10b981); transform: translateY(-1px); box-shadow: 0 6px 16px rgba(16,185,129,0.4); }

      .task-invalid{background:rgba(239,68,68,.08) !important; border-left:3px solid #ef4444;}
      
      .task-modal-actions{display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap}
      .task-modal-error{font-size:12px;color:#fecaca;background:rgba(239,68,68,.14);border:1px solid rgba(239,68,68,.25);padding:10px 12px;border-radius:8px}
      
      .login-alert-modal{width:min(600px,96vw);max-height:calc(100vh - 100px);overflow:auto;background:linear-gradient(145deg,rgba(15,23,42,.98),rgba(2,6,23,.95));backdrop-filter:blur(14px);border:1px solid rgba(248,113,113,.4);box-shadow:0 18px 48px rgba(2,6,23,.8), inset 0 1px 0 rgba(255,255,255,0.05);border-radius:16px;padding:24px;color:#f8fafc;display:flex;flex-direction:column;gap:16px}
      .login-alert-pill{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:999px;background:rgba(239,68,68,.2);border:1px solid rgba(248,113,113,.45);color:#fca5a5;font-size:12px;font-weight:800;width:max-content; text-transform:uppercase; letter-spacing:0.5px;}
      .login-alert-actions{display:flex;justify-content:flex-end; border-top:1px solid rgba(255,255,255,0.05); padding-top:16px; margin-top:8px;}
      
      .grid-header-split { display: grid; grid-template-columns: 2fr 1fr; gap: 16px; }
      @media (max-width: 600px) { .grid-header-split { grid-template-columns: 1fr; } }
      @keyframes taskSpin{to{transform:rotate(360deg)}}
      @keyframes pulseAlert{0%{box-shadow:0 0 0 0 rgba(239,68,68,.4)}70%{box-shadow:0 0 0 10px rgba(239,68,68,0)}100%{box-shadow:0 0 0 0 rgba(239,68,68,0)}}
    `;
    document.head.appendChild(style);
  }

  function renderAssignedCard(group) {
    const id = String(group.distribution_id || 'unassigned');
    const total = Number(group.total_count || (Array.isArray(group.items) ? group.items.length : 0));
    const done = Number(group.done_count || 0);
    const assignedAt = safeDate(group.assigned_at);
    const isOpen = state.expandedAssignedId === id;
    const items = Array.isArray(group.items) ? group.items : [];
    const isComplete = total > 0 && done === total;
    const progressPct = percent(done, total);

    return `
      <article class="task-card" id="assignedGroup_${esc(id)}" style="${isComplete ? 'border-color: rgba(16,185,129,0.3);' : ''}">
        <button class="task-accordion" type="button" data-toggle-assigned="${esc(id)}" aria-expanded="${isOpen ? 'true' : 'false'}">
          <div style="display:flex; justify-content:space-between; align-items:flex-start;">
             <div>
                <div class="task-title">
                   ${isComplete ? '✅ ' : '📋 '} ${esc(safeText(group.project_title, 'Untitled Distribution'))}
                </div>
                <div class="task-meta" style="margin-top:2px;">
                   Assigned by: <strong>${esc(safeText(group.assigner_name, 'N/A'))}</strong> • ${esc(assignedAt)}
                </div>
                ${group.reference_url ? `
                  <div style="margin-top:8px;">
                     <a href="${esc(group.reference_url)}" target="_blank" rel="noopener" class="task-ref" title="Open Work Instruction" onclick="event.stopPropagation();">
                        📘 Open Work Instruction
                     </a>
                  </div>
                ` : ''}
             </div>
             <div style="background: rgba(255,255,255,0.05); padding: 4px 10px; border-radius: 6px; font-size: 12px; color: #cbd5e1; font-weight: 600; display:flex; gap:6px; align-items:center;">
                <span style="font-size:14px; transform: ${isOpen ? 'rotate(180deg)' : 'rotate(0deg)'}; transition: transform 0.2s;">▾</span>
                ${isOpen ? 'Hide Tasks' : 'View Tasks'}
             </div>
          </div>
          
          <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:16px;">
            <div class="task-meta">Progress: <strong style="color:${isComplete ? '#34d399' : '#f8fafc'}; font-size:14px;">${esc(done)} / ${esc(total)}</strong> tasks</div>
            <div style="font-weight:900; font-size:16px; color:${isComplete ? '#10b981' : '#38bdf8'};">${esc(progressPct)}%</div>
          </div>
          <div class="task-progress-rail">
             <div class="task-progress-fill ${isComplete ? 'complete' : ''}" style="width:${progressPct}%"></div>
          </div>
        </button>
        
        <div class="task-grid-wrap ${isOpen ? 'open' : ''}">
          <div class="task-grid">
            <table>
              <thead><tr><th>Task Info</th><th>Site</th><th>Status</th><th>Deadline</th></tr></thead>
              <tbody>
                ${items.map((item) => `
                  <tr>
                    <td>
                      <div style="font-weight:800; color:#f8fafc; font-size:13px; margin-bottom:4px;">${esc(safeText(item.case_number || item.case_no, 'N/A'))}</div>
                      <div class="task-meta" style="font-size:11px; max-width:350px;">${esc(item.description || '')}</div>
                    </td>
                    <td style="color:#e2e8f0; font-size:13px;">${esc(safeText(item.site, 'N/A'))}</td>
                    <td>
                      ${(() => {
                        const raw = normalizeItemStatus(item.status);
                        const pending = state.pendingStatusByItemId[String(item.id || '')];
                        const shown = pending ? normalizeItemStatus(pending) : raw;
                        const isSaving = !!state.savingStatusByItemId[String(item.id || '')];
                        const notes = String(item.problem_notes || '');
                        return `
                          <div style="display:flex;flex-direction:column;">
                            <select class="task-status-select ${statusClass(shown)}" data-item-status="${esc(String(item.id || ''))}" ${isSaving ? 'disabled' : ''}>
                              ${STATUS_OPTIONS.map((opt) => `<option value="${esc(opt)}" ${normalizeItemStatus(opt) === shown ? 'selected' : ''}>${esc(opt)}</option>`).join('')}
                            </select>
                            ${normalizeItemStatus(shown) === 'With Problem' && notes ? `<div class="task-problem-notes" title="Problem Notes">📝 ${esc(notes)}</div>` : ''}
                          </div>
                        `;
                      })()}
                    </td>
                    <td style="color:#94a3b8; font-size:12px;">${esc(safeDate(item.deadline || item.deadline_at || item.due_at))}</td>
                  </tr>
                `).join('') || '<tr><td colspan="4" class="task-meta" style="text-align:center; padding:20px;">No assigned items</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </article>
    `;
  }

  function renderAssignedPanel() {
    const count = state.assignedGroups.length;
    return `
      <section class="task-section">
        <div class="task-section-title">
          📥 My Assigned Tasks
          ${count > 0 ? `<span class="badge-count">${count}</span>` : ''}
        </div>
        <div style="display:flex; flex-direction:column; gap:16px;">
           ${count ? state.assignedGroups.map(renderAssignedCard).join('') : '<div class="task-empty">You have no pending tasks at the moment. Excellent work!</div>'}
        </div>
      </section>
    `;
  }

  function renderDistributionCard(dist) {
    const id = String(dist.id || dist.distribution_id || '');
    const total = Number(dist.total_count || dist.total_items || 0);
    const pending = Number(dist.pending_count || dist.pending_items || 0);
    const done = Math.max(0, total - pending);
    const isOpen = state.expandedDistributionId === id;
    const items = isOpen ? (state.distributionItemsById[id] || []) : [];
    const isComplete = total > 0 && done === total;
    const progressPct = percent(done, total);

    // ENTERPRISE UPGRADE: Filter Engine & Team Progress Data
    const activeFilter = state.distributionFilters[id] || 'ALL';
    
    let summaryHtml = '';
    let filteredItems = items;

    if (isOpen && items.length > 0) {
       let s_ready = 0, s_ongoing = 0, s_problem = 0, s_completed = 0;
       const teamStats = {};

       items.forEach(i => {
          // Status counting
          const s = normalizeItemStatus(i.status);
          if (s === 'Pending') s_ready++;
          else if (s === 'Ongoing') s_ongoing++;
          else if (s === 'With Problem') s_problem++;
          else s_completed++;

          // Team Progress tracking
          const uid = String(i.assigned_to || i.assignee_user_id || '').trim();
          const tName = getMemberTeam(uid);
          if(!teamStats[tName]) teamStats[tName] = { total: 0, done: 0 };
          teamStats[tName].total++;
          if (s === 'Completed') teamStats[tName].done++;
       });

       // Apply Filter to Table
       if (activeFilter !== 'ALL') {
          filteredItems = items.filter(i => normalizeItemStatus(i.status) === activeFilter);
       }

       const teamProgressHtml = Object.keys(teamStats).map(t => {
          const stat = teamStats[t];
          const pct = Math.round((stat.done / stat.total) * 100);
          const isTeamDone = stat.done === stat.total;
          return `
             <div class="team-progress-pill">
                <div class="team-progress-pill-header">
                   <span>${esc(t)}</span>
                   <span style="color:${isTeamDone ? '#34d399' : '#38bdf8'};">${stat.done}/${stat.total} (${pct}%)</span>
                </div>
                <div class="team-progress-pill-rail">
                   <div class="team-progress-pill-fill" style="width:${pct}%; ${isTeamDone ? 'background:#10b981;' : ''}"></div>
                </div>
             </div>
          `;
       }).join('');

       summaryHtml = `
          <div class="enterprise-dashboard-grid">
             <div style="background:rgba(15,23,42,0.5); padding:16px; border-radius:12px; border:1px solid rgba(255,255,255,0.05);">
                <div style="font-size:11px; font-weight:800; color:#94a3b8; text-transform:uppercase; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">
                   <span>📊 Interactive Summary</span>
                   ${activeFilter !== 'ALL' ? `<span style="color:#38bdf8; font-size:10px;">Filter Active: ${activeFilter}</span>` : ''}
                </div>
                <div style="display:flex; gap:10px; flex-wrap:wrap;">
                   <button type="button" class="dist-filter-btn ${activeFilter === 'Pending' ? 'active' : ''}" data-dist="${esc(id)}" data-filter="Pending" style="color:#fcd34d;">
                      <span style="font-size:10px; font-weight:800; opacity:0.8;">PENDING</span>
                      <span style="font-size:20px; font-weight:900;">${s_ready}</span>
                   </button>
                   <button type="button" class="dist-filter-btn ${activeFilter === 'Ongoing' ? 'active' : ''}" data-dist="${esc(id)}" data-filter="Ongoing" style="color:#38bdf8;">
                      <span style="font-size:10px; font-weight:800; opacity:0.8;">ONGOING</span>
                      <span style="font-size:20px; font-weight:900;">${s_ongoing}</span>
                   </button>
                   <button type="button" class="dist-filter-btn ${activeFilter === 'With Problem' ? 'active' : ''}" data-dist="${esc(id)}" data-filter="With Problem" style="color:#fca5a5;">
                      <span style="font-size:10px; font-weight:800; opacity:0.8;">PROBLEM</span>
                      <span style="font-size:20px; font-weight:900;">${s_problem}</span>
                   </button>
                   <button type="button" class="dist-filter-btn ${activeFilter === 'Completed' ? 'active' : ''}" data-dist="${esc(id)}" data-filter="Completed" style="color:#6ee7b7;">
                      <span style="font-size:10px; font-weight:800; opacity:0.8;">DONE</span>
                      <span style="font-size:20px; font-weight:900;">${s_completed}</span>
                   </button>
                </div>
             </div>

             <div style="background:rgba(15,23,42,0.5); padding:16px; border-radius:12px; border:1px solid rgba(255,255,255,0.05); max-height:130px; overflow-y:auto;">
                <div style="font-size:11px; font-weight:800; color:#94a3b8; text-transform:uppercase; margin-bottom:12px;">👥 Team Progress</div>
                <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap:8px;">
                   ${teamProgressHtml}
                </div>
             </div>
          </div>
       `;
    }

    return `
      <article class="task-card" style="${isComplete ? 'border-color: rgba(16,185,129,0.3); opacity:0.95;' : ''}">
        <button class="task-accordion" type="button" data-toggle-dist="${esc(id)}" aria-expanded="${isOpen ? 'true' : 'false'}">
          
          <div style="display:flex; justify-content:space-between; align-items:flex-start;">
             <div>
                <div class="task-title">
                   ${isComplete ? '✅ ' : '🚀 '} ${esc(safeText(dist.title, 'Untitled Distribution'))}
                </div>
                <div class="task-meta" style="margin-top:4px;">
                   ${esc(safeText(dist.description, 'No description provided.'))}
                </div>
                ${dist.reference_url ? `
                  <div style="margin-top:8px;">
                     <a href="${esc(dist.reference_url)}" target="_blank" rel="noopener" class="task-ref" title="Open Work Instruction" onclick="event.stopPropagation();">
                        📘 Open Work Instruction
                     </a>
                  </div>
                ` : ''}
             </div>
             
             <div style="display:flex; gap:8px; align-items:center;">
                <div class="btn-glass btn-glass-primary btn-export-dist" data-id="${esc(id)}" data-title="${esc(dist.title)}" title="Export Data (Admin/Lead Privileged)">
                   📥 Export Excel
                </div>
                <div class="btn-glass btn-glass-danger btn-delete-dist" data-id="${esc(id)}" data-title="${esc(dist.title)}" title="Delete Batch (Admin/Lead Privileged)">
                   🗑️ Delete
                </div>
                <div style="background: rgba(255,255,255,0.05); padding: 6px 12px; border-radius: 6px; font-size: 12px; color: #cbd5e1; font-weight: 600; display:flex; gap:6px; align-items:center; margin-left:8px;">
                   <span style="font-size:14px; transform: ${isOpen ? 'rotate(180deg)' : 'rotate(0deg)'}; transition: transform 0.2s;">▾</span>
                   ${isOpen ? 'Hide Tracking' : 'Track Members'}
                </div>
             </div>
          </div>

          <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:16px;">
            <div class="task-meta">Overall Progress: <strong style="color:${isComplete ? '#34d399' : '#f8fafc'}; font-size:14px;">${esc(done)} / ${esc(total)}</strong> tasks completed</div>
            <div style="font-weight:900; font-size:16px; color:${isComplete ? '#10b981' : '#38bdf8'};">${esc(progressPct)}%</div>
          </div>
          <div class="task-progress-rail">
             <div class="task-progress-fill ${isComplete ? 'complete' : ''}" style="width:${progressPct}%"></div>
          </div>

        </button>
        
        <div class="task-grid-wrap ${isOpen ? 'open' : ''}">
          ${summaryHtml}
          <div class="task-grid">
            <table>
              <thead><tr><th>Task Info</th><th>Site</th><th>Assignee</th><th>Status</th><th>Deadline</th></tr></thead>
              <tbody>
                ${filteredItems.map((item) => {
                  const uid = String(item.assigned_to || item.assignee_user_id || '').trim();
                  const member = state.members.find(m => String(m.user_id || m.id) === uid);
                  const assigneeName = member ? (member.name || member.username || uid) : (uid || 'N/A');
                  const tName = getMemberTeam(uid);
                  
                  const s = normalizeItemStatus(item.status);
                  let pillStyle = 'background:rgba(245,158,11,0.1); color:#fcd34d; border:1px solid rgba(245,158,11,0.2);';
                  if (s === 'Ongoing') pillStyle = 'background:rgba(56,189,248,0.1); color:#7dd3fc; border:1px solid rgba(56,189,248,0.2);';
                  if (s === 'Completed') pillStyle = 'background:rgba(16,185,129,0.1); color:#6ee7b7; border:1px solid rgba(16,185,129,0.2);';
                  if (s === 'With Problem') pillStyle = 'background:rgba(239,68,68,0.1); color:#fca5a5; border:1px solid rgba(239,68,68,0.2);';

                  return `
                    <tr>
                      <td>
                        <div style="font-weight:800; color:#f8fafc; font-size:13px; margin-bottom:4px;">${esc(safeText(item.case_number || item.case_no, 'N/A'))}</div>
                        <div class="task-meta" style="font-size:11px; max-width:300px; white-space:normal;">${esc(item.description || '')}</div>
                      </td>
                      <td style="color:#e2e8f0; font-size:13px;">${esc(safeText(item.site, 'N/A'))}</td>
                      <td>
                         <div style="font-weight:600; color:#f8fafc; font-size:13px;">${esc(assigneeName)}</div>
                         <div style="font-size:10px; color:#94a3b8; margin-top:2px;">${esc(tName)}</div>
                      </td>
                      <td>
                         <span style="display:inline-block; padding:4px 10px; border-radius:6px; font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.5px; ${pillStyle}">
                           ${esc(s)}
                         </span>
                         ${s === 'With Problem' && item.problem_notes ? `<div class="task-meta" style="margin-top:4px; font-size:11px; color:#fca5a5;">📝 ${esc(item.problem_notes)}</div>` : ''}
                      </td>
                      <td style="color:#94a3b8; font-size:12px;">${esc(safeDate(item.deadline || item.deadline_at || item.due_at))}</td>
                    </tr>
                  `;
                }).join('') || `<<tr><td colspan="5" class="task-meta" style="text-align:center; padding:30px;">No tasks found matching filter: <strong>${esc(activeFilter)}</strong></td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
      </article>
    `;
  }

  function renderDistributionPanel() {
    const ongoing = [];
    const completed = [];
    state.distributions.forEach((dist) => {
      if (normalizeStatus(dist.status, dist.pending_count || dist.pending_items) === 'COMPLETED') completed.push(dist);
      else ongoing.push(dist);
    });
    return `
      <section class="task-section">
        <div class="task-section-title">
          📌 Active Deployments
          ${ongoing.length > 0 ? `<span class="badge-count">${ongoing.length}</span>` : ''}
        </div>
        <div style="display:flex; flex-direction:column; gap:16px;">
           ${ongoing.length ? ongoing.map(renderDistributionCard).join('') : '<div class="task-empty">No active distributions deployed.</div>'}
        </div>
      </section>
      
      <section class="task-section" style="margin-top: 32px;">
        <details>
          <summary class="task-section-title" style="cursor:pointer; opacity:0.8;">
             ✅ Completed Archives
             <span class="badge-count" style="background: rgba(16,185,129,0.1); color: #10b981;">${completed.length}</span>
             <span style="font-size:12px; color:#64748b; font-weight:normal; text-transform:none;">(Click to expand)</span>
          </summary>
          <div style="display:flex;flex-direction:column;gap:16px;margin-top:16px">
            ${completed.length ? completed.map(renderDistributionCard).join('') : '<div class="task-empty">Archive is empty.</div>'}
          </div>
        </details>
      </section>
    `;
  }

  function renderConfirmCloseModal() {
    return `
      <div class="task-modal-backdrop" id="confirmCloseBackdrop" style="z-index:17000; background:rgba(2,6,23,0.95);">
        <div class="task-modal-glass" style="width:min(450px, 95vw); border-color:rgba(239,68,68,0.5); box-shadow: 0 0 50px rgba(239,68,68,0.15);">
          <div class="modal-header-glass" style="background:rgba(15,23,42,0.95); border-bottom:1px solid rgba(239,68,68,0.2);">
            <h3 style="color:#fca5a5;">⚠️ Unsaved Progress</h3>
          </div>
          <div class="modal-body-scroll" style="gap:16px;">
            <div style="font-size:14px; color:#e2e8f0; line-height:1.5;">
              Are you sure you want to close? You have active configurations or uploaded data. <br><br><strong style="color:#ef4444;">Your work will not be saved.</strong>
            </div>
          </div>
          <div class="modal-header-glass" style="border-top: 1px solid rgba(255,255,255,0.06); border-bottom:none; justify-content:flex-end; top:auto; bottom:0; gap:12px;">
            <button class="btn-glass btn-glass-ghost" type="button" id="confirmCloseNo" style="color:#e2e8f0;">Return to Work</button>
            <button class="btn-glass btn-glass-action" type="button" id="confirmCloseYes" style="background:rgba(239,68,68,0.1); color:#ef4444; border:1px solid rgba(239,68,68,0.3); box-shadow:none;">Yes, Discard & Close</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderDeleteConfirmModal() {
    return `
      <div class="task-modal-backdrop" id="deleteModalBackdrop" style="z-index:18000; background:rgba(2,6,23,0.95);">
        <div class="task-modal-glass" style="width:min(450px, 95vw); border-color:rgba(239,68,68,0.5); box-shadow: 0 0 50px rgba(239,68,68,0.2);">
          <div class="modal-header-glass" style="background:rgba(15,23,42,0.95); border-bottom:1px solid rgba(239,68,68,0.2);">
            <h3 style="color:#fca5a5;">🛑 Danger Zone: Delete Distribution</h3>
          </div>
          <div class="modal-body-scroll" style="gap:16px;">
            <div style="font-size:14px; color:#e2e8f0; line-height:1.5;">
              You are about to delete <strong style="color:#f8fafc;">"${esc(state.deleteModal.title)}"</strong>. <br><br>
              This will permanently wipe all assigned tasks from your members' dashboards. <strong style="color:#ef4444;">This action cannot be undone.</strong>
            </div>
            ${state.loading ? `<div style="color:#38bdf8; font-size:13px; font-weight:700;">Processing deletion...</div>` : ''}
          </div>
          <div class="modal-header-glass" style="border-top: 1px solid rgba(255,255,255,0.06); border-bottom:none; justify-content:flex-end; top:auto; bottom:0; gap:12px;">
            <button class="btn-glass btn-glass-ghost" type="button" id="cancelDeleteBtn" ${state.loading ? 'disabled' : ''}>Cancel</button>
            <button class="btn-glass btn-glass-action" type="button" id="confirmDeleteBtn" style="background:rgba(239,68,68,0.1); color:#ef4444; border:1px solid rgba(239,68,68,0.3); box-shadow:none;" ${state.loading ? 'disabled' : ''}>Yes, Delete Permanently</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderModal() {
    const hasData = state.parsedRows.length > 0;
    let totalReady = 0; let totalNeedsFix = 0; const assigneeCounts = {};
    state.parsedRows.forEach(row => {
      if (row.assigned_to) { totalReady++; assigneeCounts[row.assigned_to] = (assigneeCounts[row.assigned_to] || 0) + 1; } 
      else { totalNeedsFix++; }
    });
    const assigneeStats = Object.keys(assigneeCounts).map(uid => {
      const member = state.members.find(m => String(m.user_id || m.id) === uid);
      return { name: member ? (member.name || member.username || uid) : uid, count: assigneeCounts[uid] };
    }).sort((a, b) => b.count - a.count);
    let maxTasks = 0; assigneeStats.forEach(s => { if(s.count > maxTasks) maxTasks = s.count; });
    const canSubmit = state.form.title.trim() && state.form.deadline && hasData && totalNeedsFix === 0 && !state.creating;

    let workloadModalHtml = '';
    if (state.showWorkloadModal) {
      const listHtml = assigneeStats.map(astat => {
        const pct = maxTasks > 0 ? (astat.count / maxTasks) * 100 : 0;
        return `
          <div style="background:rgba(15,23,42,0.8); border:1px solid rgba(148,163,184,0.2); border-radius:8px; padding:12px; margin-bottom:8px;">
            <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
              <span style="color:#e2e8f0; font-weight:700; font-size:13px;">${esc(astat.name)}</span>
              <span style="color:#38bdf8; font-weight:900; font-size:13px;">${astat.count} tasks</span>
            </div>
            <div style="height:6px; background:rgba(255,255,255,0.05); border-radius:999px; overflow:hidden;">
              <div style="height:100%; width:${pct}%; background:linear-gradient(90deg, #0ea5e9, #38bdf8); border-radius:999px;"></div>
            </div>
          </div>
        `;
      }).join('');
      workloadModalHtml = `
        <div class="task-modal-backdrop" id="workloadModalBackdrop" style="z-index:15000; background:rgba(2,6,23,0.9);">
          <div class="task-modal-glass" style="width:min(500px, 95vw); max-height:85vh;">
            <div class="modal-header-glass">
              <h3>📊 Workload Balance</h3>
              <button class="btn-glass btn-glass-ghost" type="button" id="closeWorkloadModal" style="padding:6px 12px;">✕ Close</button>
            </div>
            <div class="modal-body-scroll">
              <div class="task-meta" style="margin-bottom:4px;">Check distribution to avoid assigning too many tasks to a single member.</div>
              <div style="margin-top:10px;">${listHtml || '<div class="task-empty">No members mapped yet.</div>'}</div>
            </div>
          </div>
        </div>
      `;
    }

    let autoAssignModalHtml = '';
    if (state.autoAssign.open) {
       const extractedTeams = [...new Set(state.members.map(m => {
           let t = m.duty || m.shift || m.team_name || m.team || m.team_id || m.department;
           if (!t && m.teams) t = m.teams.duty || m.teams.name || m.teams.shift;
           if (!t && m.user_metadata) t = m.user_metadata.duty || m.user_metadata.shift;
           return t ? String(t).trim() : null;
       }).filter(Boolean))];
       const teamOptionsHtml = extractedTeams.map(t => `<option value="${esc(t)}" ${state.autoAssign.group === t ? 'selected' : ''}>${esc(t)}</option>`).join('');
       autoAssignModalHtml = `
         <div class="task-modal-backdrop" id="autoAssignBackdrop" style="z-index:16000; background:rgba(2,6,23,0.92);">
           <div class="task-modal-glass" style="width:min(550px, 95vw); border-color:#8b5cf6; box-shadow: 0 0 40px rgba(139,92,246,0.15);">
             <div class="modal-header-glass" style="background:rgba(15,23,42,0.9);">
               <h3>✨ Smart Auto-Assign</h3>
               <button class="btn-glass btn-glass-ghost" type="button" id="closeAutoAssign">✕ Close</button>
             </div>
             <div class="modal-body-scroll" style="gap:20px;">
               <div style="background:rgba(245,158,11,0.1); border:1px solid rgba(245,158,11,0.3); padding:14px; border-radius:8px; display:flex; gap:12px; align-items:flex-start;">
                 <span style="font-size:20px;">⚠️</span>
                 <div style="color:#fcd34d; font-size:13px; line-height:1.45;">
                   <strong>Override Notice:</strong> Executing Auto-Assign will <strong style="color:#f8fafc;">erase all existing manual assignments</strong> in your current preview and distribute the tasks equally among the selected group.
                 </div>
               </div>
               <div class="glass-card" style="padding:20px;">
                 <label class="premium-label" style="margin-bottom:8px;">1. Select Target Group (Shift/Team)</label>
                 ${extractedTeams.length === 0 ? `<div style="color:#ef4444; font-size:12px; font-weight:700; background:rgba(239,68,68,0.1); padding:8px; border-radius:4px; margin-bottom:16px;">⚠️ No Team/Shift data detected in API. Only 'All Members' is available. Please check if backend SELECT query includes the 'duty' column.</div>` : ''}
                 <select class="premium-input" id="autoAssignGroupSelect" style="margin-bottom:16px;">
                   <option value="ALL" ${state.autoAssign.group === 'ALL' ? 'selected' : ''}>All Available Members</option>
                   ${teamOptionsHtml}
                 </select>
                 <label class="premium-checkbox-container" style="padding:12px 14px; margin-top:8px;">
                   <input type="checkbox" id="autoAssignLeadCheck" ${state.autoAssign.includeLead ? 'checked' : ''} style="width:18px; height:18px; accent-color:#8b5cf6;">
                   <div style="font-size:14px; font-weight:600; color:#e2e8f0;">Include Team Lead in distribution</div>
                 </label>
               </div>
             </div>
             <div class="modal-header-glass" style="border-top: 1px solid rgba(255,255,255,0.06); border-bottom:none; justify-content:flex-end; top:auto; bottom:0;">
               <button class="btn-glass btn-glass-action" type="button" id="executeAutoAssign" style="background:linear-gradient(145deg, #8b5cf6, #7c3aed); box-shadow: 0 4px 12px rgba(139,92,246,0.3);">Execute Equal Distribution 🚀</button>
             </div>
           </div>
         </div>
       `;
    }

    const gridRowsHtml = state.parsedRows.map((row, idx) => {
      const invalid = !row.assigned_to;
      const optionsHtml = state.members.map((m) => {
        const isSelected = String(row.assigned_to) === String(m.user_id) ? 'selected' : '';
        return `<option value="${esc(m.user_id)}" ${isSelected}>${esc(m.name || m.username || m.user_id)}</option>`;
      }).join('');
      const badgeHtml = invalid 
        ? '<div style="background:rgba(239,68,68,0.2); color:#fca5a5; padding:4px 8px; border-radius:4px; font-size:11px; font-weight:700; border:1px solid rgba(239,68,68,0.3);">NEEDS FIX</div>' 
        : '<div style="background:rgba(34,197,94,0.2); color:#86efac; padding:4px 8px; border-radius:4px; font-size:11px; font-weight:700; border:1px solid rgba(34,197,94,0.3);">READY</div>';
      return `
        <tr class="${invalid ? 'task-invalid' : ''}">
          <td>
            <div style="font-weight:700; color:#f8fafc; font-size:14px; margin-bottom:4px;">${esc(safeText(row.case_number, 'N/A'))}</div>
            <div class="task-meta" style="font-size:11px; max-width:400px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${esc(row.description)}"><span style="color:#38bdf8; opacity:0.8;">Payload:</span> ${esc(row.description)}</div>
          </td>
          <td style="width:240px;">
            <div style="font-weight:600; font-size:12px; color:${invalid ? '#ef4444' : '#94a3b8'}; margin-bottom:4px;">Extracted: "${esc(safeText(row.assigned_name, 'Unknown'))}"</div>
            <select class="premium-input" data-assignee-fix="${idx}" style="padding:6px; font-size:12px; background:rgba(15,23,42,0.8);"><option value="">-- Resolve Member --</option>${optionsHtml}</select>
          </td>
          <td style="width:120px; text-align:center;">${badgeHtml}</td>
        </tr>
      `;
    }).join('');

    return `
      <div class="task-modal-backdrop" id="distributionModalBackdrop">
        <div class="task-modal-glass ${state.isFullscreen ? 'is-fullscreen' : ''}" role="dialog" aria-modal="true">
          <div class="modal-header-glass">
            <h3>✨ Create New Distribution</h3>
            ${!state.isFullscreen ? `<button class="btn-glass btn-glass-ghost" type="button" id="closeDistributionModal" style="padding:6px 12px; border:1px solid rgba(239,68,68,0.3); color:#fca5a5;">✕ Cancel & Close</button>` : ''}
          </div>
          <div class="modal-body-scroll">
            <div class="glass-card" style="${state.isFullscreen ? 'display:none;' : ''}">
              <div style="display:flex; align-items:center; gap:10px; margin-bottom:16px;">
                <div style="background:#0ea5e9; color:#fff; width:24px; height:24px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:bold;">1</div>
                <div class="task-title" style="margin:0;">Project Metadata & Escalation</div>
              </div>
              <div class="grid-header-split">
                <div><label class="premium-label" for="distTitleInput">Project Title <span style="color:#ef4444">*</span></label><input class="premium-input" id="distTitleInput" type="text" value="${esc(state.form.title)}" placeholder="e.g. Q3 Custom Screen Remapping" autocomplete="off" /></div>
                <div><label class="premium-label" for="distDeadlineInput">Project Deadline <span style="color:#ef4444">*</span></label><input class="premium-input" id="distDeadlineInput" type="datetime-local" value="${esc(state.form.deadline)}" required style="color-scheme: dark;" /></div>
              </div>
              <div style="margin-top:16px;"><label class="premium-label" for="distDescriptionInput">Global Description</label><textarea class="premium-input" id="distDescriptionInput" rows="2" placeholder="Provide context or instructions for the whole batch...">${esc(state.form.description)}</textarea></div>
              <div style="margin-top:16px;"><label class="premium-label" for="distReferenceInput">Work Instruction URL</label><input class="premium-input" id="distReferenceInput" type="url" value="${esc(state.form.reference_url)}" placeholder="https://confluence.yourcompany.com/..." autocomplete="off" /></div>
              <label class="premium-checkbox-container" style="margin-top:16px;">
                <input id="distEnableDailyAlerts" type="checkbox" ${state.form.enable_daily_alerts ? 'checked' : ''} style="width:18px; height:18px; accent-color:#0ea5e9;" />
                <div><div style="font-size:14px; font-weight:600; color:#e2e8f0;">Enable Smart Reminders & Escalation</div><div style="font-size:12px; color:#94a3b8; margin-top:2px;">Sends daily alerts. <strong style="color:#f8fafc;">Escalates to HOURLY alerts</strong> for members and Team Lead on the actual deadline day.</div></div>
              </label>
            </div>
            <div class="glass-card" style="margin-bottom:0; display:flex; flex-direction:column; padding: ${state.isFullscreen ? '0' : '20px'}; border: ${state.isFullscreen ? 'none' : ''}; background: ${state.isFullscreen ? 'transparent' : ''}; ${state.isFullscreen ? 'flex:1; height:100%; overflow:hidden;' : ''}">
              <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
                <div style="display:flex; align-items:center; gap:10px;">
                  <div style="background:#0ea5e9; color:#fff; width:24px; height:24px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:bold;">2</div>
                  <div class="task-title" style="margin:0;">Enterprise Data Ingestion</div>
                </div>
                <div style="display:flex; gap:8px;">
                  ${hasData ? `
                    <button class="btn-glass btn-glass-ghost" type="button" id="btnToggleFullscreen" style="font-size:11px; padding:6px 12px; color:#38bdf8; border-color:rgba(56,189,248,0.3); background:rgba(56,189,248,0.05);">
                      ${state.isFullscreen ? '↙️ Exit Fullscreen' : '↗️ Fullscreen View'}
                    </button>
                    ${!state.isFullscreen ? `<button class="btn-glass btn-glass-ghost" type="button" id="btnReplaceFile" style="font-size:11px; padding:6px 12px; border:1px solid rgba(239,68,68,0.3); color:#fca5a5;">🗑️ Discard & Reupload</button>` : ''}
                  ` : ''}
                </div>
              </div>
              ${!hasData ? `
                <div class="task-meta" style="margin-bottom:16px; margin-left:34px;">Upload any structured Excel/CSV file. The system will dynamically pack columns into the payload.</div>
                <div id="uploadZone" class="upload-zone-glass ${state.dragActive ? 'drag' : ''}">
                  <div class="upload-icon">📊</div>
                  <div style="font-weight:700;font-size:16px; color:#e2e8f0;">Drag & Drop your dataset here</div>
                  <div class="task-meta" style="margin:6px 0 16px 0;">Supports .xlsx, .xls, .csv</div>
                  <label class="btn-glass btn-glass-primary" style="display:inline-block; cursor:pointer;">Browse Files<input type="file" id="taskFileInput" accept=".xlsx,.xls,.csv" style="display:none;" /></label>
                  ${state.parseError ? `<div style="color:#ef4444;margin-top:16px;font-size:13px;font-weight:bold;background:rgba(239,68,68,0.1);padding:8px;border-radius:4px;">⚠️ ${esc(state.parseError)}</div>` : ''}
                </div>
              ` : `
                <div class="stat-container">
                  <div class="stat-box" style="border-left: 3px solid #38bdf8;"><div class="stat-label">Total Rows</div><div class="stat-value">${state.parsedRows.length}</div></div>
                  <div class="stat-box" style="border-left: 3px solid #22c55e;"><div class="stat-label">Ready (Mapped)</div><div class="stat-value" style="color:#4ade80;">${totalReady}</div></div>
                  <div class="stat-box" style="border-left: 3px solid ${totalNeedsFix > 0 ? '#ef4444' : '#64748b'};"><div class="stat-label">Needs Fix</div><div class="stat-value" style="color:${totalNeedsFix > 0 ? '#f87171' : '#cbd5e1'};">${totalNeedsFix}</div></div>
                </div>
                <div class="enterprise-toolbar">
                  <div style="font-size:12px; color:#94a3b8;"><strong style="color:#e2e8f0;">${assigneeStats.length}</strong> members mapped. Balance the distribution to prevent burnout.</div>
                  <div style="display:flex; gap:10px; flex-wrap:wrap;">
                     <button class="btn-glass btn-glass-primary" type="button" id="btnOpenAutoAssign" style="padding:6px 14px; font-size:12px; background:linear-gradient(145deg, #8b5cf6, #d97706); border:none; box-shadow: 0 4px 12px rgba(245,158,11,0.3);">✨ Auto-Assign Wizard</button>
                     <button class="btn-glass btn-glass-primary" type="button" id="btnViewWorkload" style="padding:6px 14px; font-size:12px; background:rgba(56,189,248,0.1); color:#38bdf8; border:1px solid rgba(56,189,248,0.3); box-shadow:none;">📊 View Workload Balance</button>
                  </div>
                </div>
                <div class="glass-table-container">
                  <table>
                    <thead><tr><th>Task Reference & Data Summary</th><th style="width:240px;">Assignee Matching</th><th style="width:120px; text-align:center;">Status</th></tr></thead>
                    <tbody>${gridRowsHtml || '<tr><td colspan="3" class="task-meta" style="text-align:center; padding:30px;">No preview generated.</td></tr>'}</tbody>
                  </table>
                </div>
                ${totalNeedsFix > 0 ? `<div style="display:flex; align-items:center; gap:8px; background:rgba(245,158,11,0.1); border:1px solid rgba(245,158,11,0.3); border-radius:8px; padding:10px 14px; margin-top:16px;"><span style="font-size:18px;">⚠️</span><div style="color:#fcd34d; font-size:13px; font-weight:600;">Action Required: Please resolve ${totalNeedsFix} unmatched member(s) to enable submission.</div></div>` : ''}
              `}
            </div>
          </div>
          <div class="modal-header-glass" style="border-top: 1px solid rgba(255,255,255,0.06); border-bottom:none; justify-content:space-between; top:auto; bottom:0;">
            <div class="task-meta">${canSubmit ? `<span style="color:#86efac; font-weight:700;">✓ Ready to deploy ${state.parsedRows.length} tasks</span>` : 'Complete all mandatory fields (Title, Deadline) and resolve members to continue.'}</div>
            <div style="display:flex; gap:12px;">
              ${!state.isFullscreen ? `<button class="btn-glass btn-glass-ghost" type="button" id="cancelDistributionCreate">Cancel</button>` : ''}
              <button class="btn-glass btn-glass-primary" type="button" id="submitDistribution" style="padding:8px 24px;" ${!canSubmit ? 'disabled' : ''}>${state.creating ? 'Deploying...' : 'Launch Distribution 🚀'}</button>
            </div>
          </div>
        </div>
      </div>
      ${workloadModalHtml}
      ${autoAssignModalHtml}
      ${state.confirmCloseModal ? renderConfirmCloseModal() : ''}
      ${state.deleteModal && state.deleteModal.open ? renderDeleteConfirmModal() : ''}
    `;
  }

  function renderProblemModal() {
    const taskItemId = String(state.problemModal.taskItemId || '');
    const { item } = findTaskItem(taskItemId);
    const title = item ? `Report a Problem — Case ${safeText(item.case_number || item.case_no, 'N/A')}` : 'Report a Problem';
    const err = String(state.problemModal.error || '').trim();
    return `
      <div class="task-modal-backdrop" id="problemModalBackdrop">
        <div class="task-modal" role="dialog" aria-modal="true" style="width:min(500px, 95vw);">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
            <h3>${esc(title)}</h3>
            <button class="task-btn task-btn-ghost" type="button" id="problemModalClose">Close</button>
          </div>
          <div style="margin-top:10px">
            <textarea id="problemModalNotes" rows="4" placeholder="Enter problem details..." style="width:100%">${esc(state.problemModal.notes || '')}</textarea>
            ${err ? `<div class="task-modal-error" style="margin-top:10px">${esc(err)}</div>` : ''}
          </div>
          <div class="task-modal-actions" style="margin-top:14px">
            <button class="task-btn task-btn-ghost" type="button" id="problemModalCancel">Cancel</button>
            <button class="task-btn task-btn-primary" type="button" id="problemModalSave">Save</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderLoginAlertModal() {
    const info = state.loginAlert || {};
    const now = Date.now();
    return `
      <div class="task-modal-backdrop" id="loginAlertBackdrop">
        <div class="login-alert-modal" role="dialog" aria-modal="true">
          <div style="display:flex; align-items:center; justify-content:space-between;">
            <div class="login-alert-pill" style="${info.isHourlyEscalation ? 'animation: pulseAlert 2s infinite;' : ''}">
              ${info.isHourlyEscalation ? '🚨 HOURLY ESCALATION ACTIVE' : '⚠️ DAILY TASK REMINDER'}
            </div>
          </div>
          <div style="font-size:24px;font-weight:900;line-height:1.2; letter-spacing:-0.5px;">Action Required: Pending Tasks</div>
          <div class="login-alert-summary" style="margin-top:4px;">You have <strong style="color:#ef4444; font-size:16px;">${esc(String(info.totalOverdue || 0))}</strong> overdue tasks, and several active distributions awaiting completion.</div>
          <div style="max-height: 280px; overflow-y: auto; display:flex; flex-direction:column; gap:10px; margin-top: 8px; padding-right:6px;" class="task-modal-glass">
             ${(info.distributions || []).map(d => {
               const daysLeft = Math.ceil((d.deadlineMs - now) / (1000*60*60*24));
               const isDueToday = daysLeft === 0;
               const isOverdue = daysLeft < 0;
               let urgencyColor = '#38bdf8'; let urgencyText = `${daysLeft} days left`;
               if (isOverdue) { urgencyColor = '#ef4444'; urgencyText = `OVERDUE by ${Math.abs(daysLeft)} days`; } 
               else if (isDueToday) { urgencyColor = '#f59e0b'; urgencyText = `DUE TODAY (Hourly Alerting)`; } 
               else if (daysLeft === 1) { urgencyColor = '#eab308'; urgencyText = `Due Tomorrow`; }
               return `
                 <div style="background: rgba(15,23,42,0.6); border-left: 4px solid ${urgencyColor}; padding: 14px; border-radius: 8px; border-top:1px solid rgba(255,255,255,0.02); border-right:1px solid rgba(255,255,255,0.02); border-bottom:1px solid rgba(255,255,255,0.02);">
                    <div style="font-weight: 800; color: #f8fafc; font-size: 14px; margin-bottom:6px;">${esc(d.title)}</div>
                    <div style="display:flex; justify-content: space-between; align-items:center; font-size: 13px; color: #94a3b8;">
                       <span style="background:rgba(255,255,255,0.05); padding:4px 8px; border-radius:4px;">Pending Tasks: <strong style="color:#e2e8f0; font-size:14px;">${d.pendingCount}</strong></span>
                       <span style="color: ${urgencyColor}; font-weight: 800; letter-spacing:0.5px;">${urgencyText}</span>
                    </div>
                 </div>
               `;
             }).join('')}
          </div>
          <div class="login-alert-actions"><button class="btn-glass btn-glass-primary" type="button" id="loginAlertAcknowledge" style="width:100%; padding:12px; font-size:14px;">Acknowledge & Proceed to Work</button></div>
        </div>
      </div>
    `;
  }

  function render() {
    ensureStyleTag();
    root.innerHTML = `
      <section class="task-shell">
        ${state.loading || state.creating ? '<div class="task-overlay"><div class="task-spinner"></div></div>' : ''}
        <header class="task-header">
          <h2 class="task-title-main">My Task Dashboard</h2>
          <nav class="task-tabs">
            <button type="button" class="task-tab ${state.activeTab === 'assigned' ? 'active' : ''}" id="tabAssigned">📥 My Assigned Tasks</button>
            <button type="button" class="task-tab ${state.activeTab === 'distribution' ? 'active' : ''}" id="tabDistribution">🚀 Distribution Management</button>
            <button type="button" class="btn-glass btn-glass-primary" id="openDistributionModal" ${state.activeTab === 'distribution' ? '' : 'style="display:none"'}>+ Create Distribution</button>
          </nav>
        </header>
        ${state.activeTab === 'assigned' ? renderAssignedPanel() : renderDistributionPanel()}
        ${state.modalOpen ? renderModal() : ''}
        ${state.problemModal && state.problemModal.open ? renderProblemModal() : ''}
        ${state.loginAlert && state.loginAlert.open ? renderLoginAlertModal() : ''}
      </section>
    `;
    bindEvents();
    requestDeepLinkScroll();
  }

  function parseCsvLine(line) {
    const cells = [];
    let buf = ''; let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { buf += '"'; i += 1; } else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) { cells.push(buf.trim()); buf = ''; } else buf += ch;
    }
    cells.push(buf.trim()); return cells;
  }

  async function ensureSheetJs() {
    if (window.XLSX) { state.isSheetJsReady = true; return true; }
    if (state.isSheetJsReady) return true;
    await new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      script.onload = () => resolve(); script.onerror = () => resolve();
      document.head.appendChild(script);
    });
    state.isSheetJsReady = Boolean(window.XLSX);
    return state.isSheetJsReady;
  }

  async function fileToMatrix(file) {
    const ext = String(file.name || '').split('.').pop().toLowerCase();
    if (ext === 'csv') {
      const text = await file.text();
      const matrix = text.replace(/\r/g, '').split('\n').map((line) => line.trim()).filter(Boolean).map(parseCsvLine);
      return { matrix, sheets: 1 };
    }
    const ready = await ensureSheetJs();
    if (!ready || !window.XLSX) throw new Error('SheetJS failed to load. Use CSV or retry.');
    const buf = await file.arrayBuffer();
    const workbook = window.XLSX.read(buf, { type: 'array' });
    const matrix = [];
    (workbook.SheetNames || []).forEach((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) return;
      window.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' }).forEach((row) => matrix.push(Array.isArray(row) ? row : []));
    });
    return { matrix, sheets: (workbook.SheetNames || []).length || 1 };
  }

  function splitMatrix(matrix) {
    const rows = Array.isArray(matrix) ? matrix : [];
    const headerIndex = rows.findIndex((row) => (Array.isArray(row) ? row : []).some((cell) => String(cell || '').trim()));
    if (headerIndex < 0) return { headers: [], rows: [] };
    const headers = (Array.isArray(rows[headerIndex]) ? rows[headerIndex] : []).map((h, idx) => safeText(h, `Column ${idx + 1}`));
    const dataRows = rows.slice(headerIndex + 1).filter((row) => (Array.isArray(row) ? row : []).some((cell) => String(cell || '').trim()));
    return { headers, rows: dataRows };
  }

  function detectColumns(headers, dataRows) {
    let assigneeColumnIndex = -1;
    let siteColumnIndex = -1;
    let bestAssigneeScore = 0;
    const sampleRows = dataRows.slice(0, 250);

    headers.forEach((header, idx) => {
      const h = normalizeName(header);
      if (siteColumnIndex < 0 && /site|location|branch|store|facility/.test(h)) siteColumnIndex = idx;

      let nonEmpty = 0; let hits = 0;
      sampleRows.forEach((row) => {
        const value = String((Array.isArray(row) ? row[idx] : '') || '').trim();
        if (!value) return;
        nonEmpty += 1;
        const match = guessMember(value);
        if (match && match.score >= 0.72) hits += 1;
      });
      const ratio = nonEmpty ? hits / nonEmpty : 0;
      const explicit = /assignee|owner|agent|assigned|tech/.test(h);
      if (ratio > bestAssigneeScore || (explicit && ratio >= bestAssigneeScore)) {
        bestAssigneeScore = ratio;
        assigneeColumnIndex = idx;
      }
    });
    return { assigneeColumnIndex, siteColumnIndex };
  }

  function buildParsedRows(dataRows, detection, headers) {
    return dataRows.map((row) => {
      const values = Array.isArray(row) ? row : [];
      let assigneeName = '';
      if (detection.assigneeColumnIndex >= 0) assigneeName = String(values[detection.assigneeColumnIndex] || '').trim();
      
      let site = 'N/A';
      if (detection.siteColumnIndex >= 0) site = safeText(values[detection.siteColumnIndex], 'N/A');

      const details = [];
      let primaryReference = 'N/A';
      let foundPrimary = false;

      headers.forEach((h, idx) => {
        const val = String(values[idx] || '').trim();
        if (val) {
          details.push(`${h}: ${val}`);
          if (!foundPrimary && idx !== detection.assigneeColumnIndex && idx !== detection.siteColumnIndex) {
            primaryReference = val;
            foundPrimary = true;
          }
        }
      });

      const compiledDesc = details.join(' | ');
      const match = guessMember(assigneeName);

      return {
        case_number: primaryReference,
        site: site,
        description: compiledDesc,
        assigned_name: assigneeName,
        assigned_to: match && match.score >= 0.72 ? String(match.member.user_id || '') : ''
      };
    }).filter((row) => row.case_number !== 'N/A' || row.site !== 'N/A' || row.assigned_name);
  }

  async function handleFile(file) {
    if (!file) return;
    state.creating = true; state.parseError = ''; render();
    try {
      const parsed = await fileToMatrix(file);
      const split = splitMatrix(parsed.matrix);
      const detection = detectColumns(split.headers, split.rows);
      state.parsedRows = buildParsedRows(split.rows, detection, split.headers);
      state.assigneeColumnIndex = detection.assigneeColumnIndex;
      state.uploadMeta = { name: String(file.name || ''), rows: state.parsedRows.length, sheets: parsed.sheets };
      if(state.parsedRows.length > 50) state.isFullscreen = true;
    } catch (err) {
      state.parseError = String(err && err.message ? err.message : err);
      state.parsedRows = [];
    } finally { state.creating = false; render(); }
  }

  function closeModal() {
    state.modalOpen = false; state.parseError = ''; state.dragActive = false;
    state.uploadMeta = { name: '', rows: 0, sheets: 0 }; state.parsedRows = [];
    state.form = { title: '', description: '', reference_url: '', deadline: '', enable_daily_alerts: true };
    state.isFullscreen = false; state.showWorkloadModal = false; state.autoAssign.open = false;
    state.confirmCloseModal = false;
    render();
  }

  async function loadDistributionItems(distributionId) {
    const id = String(distributionId || ''); if (!id || state.distributionItemsById[id]) return;
    const out = await CloudTasks.distributionItems(id);
    state.distributionItemsById[id] = out.ok && Array.isArray(out.data.rows) ? out.data.rows : [];
  }

  async function loadBaseData() {
    state.loading = true; render();
    const [assignedRes, distRes, membersRes] = await Promise.all([CloudTasks.assigned(), CloudTasks.distributions(), CloudTasks.members()]);
    state.assignedGroups = assignedRes.ok && Array.isArray(assignedRes.data.groups) ? assignedRes.data.groups : [];
    state.distributions = distRes.ok && Array.isArray(distRes.data.rows) ? distRes.data.rows : [];
    state.members = membersRes.ok && Array.isArray(membersRes.data.rows) ? membersRes.data.rows : [];
    maybeShowLoginAlertOncePerSession();
    applyDeepLinkIfNeeded();
    state.loading = false; render();
  }

  function bindEvents() {
    const el = (id) => root.querySelector(id);
    const els = (sel) => root.querySelectorAll(sel);

    if (el('#tabAssigned')) el('#tabAssigned').onclick = () => { state.activeTab = 'assigned'; render(); };
    if (el('#tabDistribution')) el('#tabDistribution').onclick = () => { state.activeTab = 'distribution'; render(); };
    if (state.loginAlert && state.loginAlert.open) {
      if (el('#loginAlertBackdrop')) el('#loginAlertBackdrop').onclick = (e) => { if (e.target === el('#loginAlertBackdrop')) closeLoginAlertModal(); };
      if (el('#loginAlertAcknowledge')) el('#loginAlertAcknowledge').onclick = closeLoginAlertModal;
    }
    if (el('#openDistributionModal')) el('#openDistributionModal').onclick = () => { state.modalOpen = true; render(); };

    els('[data-toggle-assigned]').forEach((btn) => btn.onclick = () => {
      const id = String(btn.getAttribute('data-toggle-assigned') || '');
      state.expandedAssignedId = state.expandedAssignedId === id ? '' : id; render();
    });
    els('[data-toggle-dist]').forEach((btn) => btn.onclick = async () => {
      const id = String(btn.getAttribute('data-toggle-dist') || '');
      if (!id) return;
      if (state.expandedDistributionId === id) { state.expandedDistributionId = ''; render(); return; }
      state.expandedDistributionId = id; state.loading = true; render();
      await loadDistributionItems(id); state.loading = false; render();
    });

    // ENTERPRISE UPGRADE: Filter Box Toggles
    els('.dist-filter-btn').forEach((btn) => {
       btn.onclick = (e) => {
          e.stopPropagation(); // Prevent accordion from collapsing
          const distId = btn.getAttribute('data-dist');
          const filter = btn.getAttribute('data-filter');
          if (state.distributionFilters[distId] === filter) {
             state.distributionFilters[distId] = 'ALL'; // Toggle off
          } else {
             state.distributionFilters[distId] = filter; // Set filter
          }
          
          // Lock scroll before render
          const cardEl = document.getElementById(`assignedGroup_${distId}`) || el(`[data-toggle-dist="${distId}"]`).parentElement;
          const gridEl = cardEl ? cardEl.querySelector('.task-grid') : null;
          const gridScroll = gridEl ? gridEl.scrollTop : 0;
          
          render();
          
          requestAnimationFrame(() => {
             const newCardEl = document.getElementById(`assignedGroup_${distId}`) || root.querySelector(`[data-toggle-dist="${distId}"]`).parentElement;
             const newGridEl = newCardEl ? newCardEl.querySelector('.task-grid') : null;
             if (newGridEl) newGridEl.scrollTop = gridScroll;
          });
       };
    });

    els('[data-item-status]').forEach((select) => select.onchange = async () => {
      const id = String(select.getAttribute('data-item-status') || ''); if (!id) return;
      const next = normalizeItemStatus(select.value);
      const { group, item, source } = findTaskItem(id); if (!item) return;
      const prev = normalizeItemStatus(item.status); if (next === prev) return;

      if (next === 'With Problem') {
        state.pendingStatusByItemId[id] = 'With Problem';
        state.problemModal = { open: true, taskItemId: id, prevStatus: prev, notes: String(item.problem_notes || ''), error: '' };
        render(); return;
      }
      
      state.savingStatusByItemId[id] = true; state.pendingStatusByItemId[id] = next; render();
      const out = await CloudTasks.updateItemStatus({ task_item_id: id, status: next });
      if (!out.ok) {
        delete state.pendingStatusByItemId[id]; delete state.savingStatusByItemId[id]; render();
        UI && UI.toast && UI.toast(out.message || 'Failed to update', 'danger'); return;
      }
      
      item.status = next; 
      item.problem_notes = null;
      
      if (source === 'assigned' && group && group.items) {
          group.done_count = group.items.filter(i => normalizeItemStatus(i.status) === 'Completed').length;
      } else if (source === 'distribution' && group) {
          const itemsArr = state.distributionItemsById[String(group.id || group.distribution_id)] || [];
          group.pending_count = itemsArr.filter(i => normalizeItemStatus(i.status) !== 'Completed').length;
      }

      delete state.pendingStatusByItemId[id]; delete state.savingStatusByItemId[id]; render();
    });

    if (state.problemModal && state.problemModal.open) {
      const cancel = () => {
        const id = String(state.problemModal.taskItemId || '');
        if (id) delete state.pendingStatusByItemId[id];
        state.problemModal = { open: false, taskItemId: '', prevStatus: 'Pending', notes: '', error: '' }; render();
      };
      if (el('#problemModalBackdrop')) el('#problemModalBackdrop').onclick = (e) => { if (e.target === el('#problemModalBackdrop')) cancel(); };
      if (el('#problemModalCancel')) el('#problemModalCancel').onclick = cancel;
      if (el('#problemModalClose')) el('#problemModalClose').onclick = cancel;
      if (el('#problemModalNotes')) el('#problemModalNotes').oninput = () => {
        state.problemModal.notes = String(el('#problemModalNotes').value || '');
        if (el('#problemModalSave')) el('#problemModalSave').disabled = !state.problemModal.notes.trim();
      };
      if (el('#problemModalSave')) {
        el('#problemModalSave').disabled = !String(state.problemModal.notes || '').trim();
        el('#problemModalSave').onclick = async () => {
          const id = String(state.problemModal.taskItemId || ''); const notes = String(state.problemModal.notes || '').trim();
          if (!id) return cancel();
          if (!notes) { state.problemModal.error = 'Notes required'; render(); return; }
          const { group, item, source } = findTaskItem(id); if (!item) return cancel();
          state.savingStatusByItemId[id] = true; render();
          const out = await CloudTasks.updateItemStatus({ task_item_id: id, status: 'With Problem', problem_notes: notes });
          if (!out.ok) { state.problemModal.error = out.message || 'Failed'; delete state.savingStatusByItemId[id]; render(); return; }
          
          item.status = 'With Problem'; item.problem_notes = notes;
          
          if (source === 'assigned' && group && group.items) {
             group.done_count = group.items.filter(i => normalizeItemStatus(i.status) === 'Completed').length;
          } else if (source === 'distribution' && group) {
             const itemsArr = state.distributionItemsById[String(group.id || group.distribution_id)] || [];
             group.pending_count = itemsArr.filter(i => normalizeItemStatus(i.status) !== 'Completed').length;
          }

          delete state.pendingStatusByItemId[id]; delete state.savingStatusByItemId[id];
          state.problemModal = { open: false, taskItemId: '', prevStatus: 'Pending', notes: '', error: '' }; render();
        };
      }
    }

    els('.btn-export-dist').forEach(btn => {
       btn.onclick = (e) => {
         e.stopPropagation();
         const distId = btn.getAttribute('data-id');
         const title = btn.getAttribute('data-title');
         exportDistributionToExcel(distId, title);
       };
    });

    els('.btn-delete-dist').forEach(btn => {
       btn.onclick = (e) => {
         e.stopPropagation();
         const distId = btn.getAttribute('data-id');
         const title = btn.getAttribute('data-title');
         state.deleteModal = { open: true, distId, title };
         render();
       };
    });

    if (state.deleteModal && state.deleteModal.open) {
      const cancelDelete = () => { state.deleteModal = { open: false, distId: '', title: '' }; render(); };
      if (el('#cancelDeleteBtn')) el('#cancelDeleteBtn').onclick = cancelDelete;
      if (el('#deleteModalBackdrop')) el('#deleteModalBackdrop').onclick = (e) => { if(e.target === el('#deleteModalBackdrop')) cancelDelete(); };
      if (el('#confirmDeleteBtn')) {
        el('#confirmDeleteBtn').onclick = async () => {
           state.loading = true; render();
           try {
             if (window.CloudTasks && CloudTasks.deleteDistribution) {
                const out = await CloudTasks.deleteDistribution(state.deleteModal.distId);
                if (!out.ok) throw new Error(out.message || "Failed to delete");
             } else {
                console.warn("CloudTasks.deleteDistribution not implemented on client API layer. UI proceeding to remove state.");
             }
             state.deleteModal = { open: false, distId: '', title: '' };
             await loadBaseData(); 
           } catch(err) {
             state.loading = false;
             alert("Error deleting distribution: " + err.message);
             render();
           }
        };
      }
    }

    const handleModalCloseRequest = () => {
      const hasUnsavedChanges = state.parsedRows.length > 0 || state.form.title.trim() !== '' || state.form.deadline !== '';
      if (hasUnsavedChanges) {
        state.confirmCloseModal = true;
        render();
      } else {
        closeModal();
      }
    };

    if (!state.modalOpen) return;
    
    if (el('#closeDistributionModal')) el('#closeDistributionModal').onclick = handleModalCloseRequest;
    if (el('#cancelDistributionCreate')) el('#cancelDistributionCreate').onclick = handleModalCloseRequest;
    
    if (state.confirmCloseModal) {
      if (el('#confirmCloseNo')) el('#confirmCloseNo').onclick = () => { state.confirmCloseModal = false; render(); };
      if (el('#confirmCloseYes')) el('#confirmCloseYes').onclick = closeModal;
      if (el('#confirmCloseBackdrop')) el('#confirmCloseBackdrop').onclick = (e) => { 
        if (e.target === el('#confirmCloseBackdrop')) { state.confirmCloseModal = false; render(); }
      };
    }
    
    if (el('#btnToggleFullscreen')) {
      el('#btnToggleFullscreen').onclick = () => {
        state.isFullscreen = !state.isFullscreen;
        render();
      };
    }
    if (el('#btnViewWorkload')) {
      el('#btnViewWorkload').onclick = () => {
        state.showWorkloadModal = true;
        render();
      };
    }
    if (el('#closeWorkloadModal')) {
      el('#closeWorkloadModal').onclick = () => {
        state.showWorkloadModal = false;
        render();
      };
    }
    if (el('#workloadModalBackdrop')) {
      el('#workloadModalBackdrop').onclick = (e) => {
        if(e.target === el('#workloadModalBackdrop')) {
          state.showWorkloadModal = false;
          render();
        }
      };
    }

    if (el('#btnReplaceFile')) {
      el('#btnReplaceFile').onclick = () => {
        state.parsedRows = [];
        state.uploadMeta = { name: '', rows: 0, sheets: 0 };
        state.parseError = '';
        state.isFullscreen = false;
        render();
      };
    }

    if (el('#btnOpenAutoAssign')) {
      el('#btnOpenAutoAssign').onclick = () => {
        state.autoAssign.open = true;
        render();
      };
    }
    if (el('#closeAutoAssign')) {
      el('#closeAutoAssign').onclick = () => {
        state.autoAssign.open = false;
        render();
      };
    }
    if (el('#autoAssignBackdrop')) {
      el('#autoAssignBackdrop').onclick = (e) => {
        if (e.target === el('#autoAssignBackdrop')) {
          state.autoAssign.open = false;
          render();
        }
      };
    }
    if (el('#autoAssignGroupSelect')) {
      el('#autoAssignGroupSelect').onchange = (e) => {
        state.autoAssign.group = e.target.value;
        render(); 
      };
    }
    if (el('#autoAssignLeadCheck')) {
      el('#autoAssignLeadCheck').onchange = (e) => {
        state.autoAssign.includeLead = e.target.checked;
      };
    }
    if (el('#executeAutoAssign')) {
      el('#executeAutoAssign').onclick = () => {
        
        const isLead = (m) => {
          const roleStr = String(m.role || m.user_role || m.designation || '').toLowerCase();
          return roleStr.includes('lead') || roleStr.includes('manager') || roleStr.includes('supervisor') || roleStr.includes('admin');
        };

        const targetGroup = state.autoAssign.group;
        const includeLead = state.autoAssign.includeLead;

        const eligible = state.members.filter(m => {
          if (targetGroup !== 'ALL') {
            let mTeam = m.duty || m.shift || m.team_name || m.team || m.team_id || m.department;
            if (!mTeam && m.teams) mTeam = m.teams.duty || m.teams.name || m.teams.shift;
            if (!mTeam && m.user_metadata) mTeam = m.user_metadata.duty || m.user_metadata.shift;
            
            if (String(mTeam).trim() !== targetGroup) return false;
          }
          if (!includeLead && isLead(m)) return false;
          return true;
        });

        if (eligible.length === 0) {
          alert("Error: No eligible members found for the selected criteria.");
          return;
        }

        state.parsedRows.forEach((row, idx) => {
          const member = eligible[idx % eligible.length];
          row.assigned_to = String(member.user_id || member.id);
        });

        state.autoAssign.open = false;
        render();
      };
    }

    const checkSubmitBtn = () => {
      const canSubmit = state.form.title.trim() && state.form.deadline && state.parsedRows.length > 0 && unresolvedRowsCount() === 0 && !state.creating;
      if (el('#submitDistribution')) el('#submitDistribution').disabled = !canSubmit;
    };

    if (el('#distTitleInput')) el('#distTitleInput').oninput = () => {
      state.form.title = String(el('#distTitleInput').value || '');
      checkSubmitBtn();
    };
    if (el('#distDeadlineInput')) el('#distDeadlineInput').oninput = () => {
      state.form.deadline = String(el('#distDeadlineInput').value || '');
      checkSubmitBtn();
    };
    if (el('#distDescriptionInput')) el('#distDescriptionInput').oninput = () => state.form.description = String(el('#distDescriptionInput').value || '');
    if (el('#distReferenceInput')) el('#distReferenceInput').oninput = () => state.form.reference_url = String(el('#distReferenceInput').value || '');
    if (el('#distEnableDailyAlerts')) el('#distEnableDailyAlerts').onchange = () => state.form.enable_daily_alerts = !!el('#distEnableDailyAlerts').checked;
    
    if (el('#taskFileInput')) el('#taskFileInput').onchange = () => handleFile(el('#taskFileInput').files[0]);
    
    const zone = el('#uploadZone');
    if (zone) {
      zone.ondragover = (e) => { e.preventDefault(); state.dragActive = true; render(); };
      zone.ondragleave = () => { state.dragActive = false; render(); };
      zone.ondrop = (e) => { e.preventDefault(); state.dragActive = false; render(); handleFile(e.dataTransfer.files[0]); };
    }

    els('[data-assignee-fix]').forEach((select) => select.onchange = () => {
      const idx = Number(select.getAttribute('data-assignee-fix'));
      if (Number.isFinite(idx) && state.parsedRows[idx]) {
        state.parsedRows[idx].assigned_to = String(select.value || '');
        
        const modalEl = root.querySelector('.modal-body-scroll');
        const gridEl = root.querySelector('.glass-table-container');
        const modalScroll = modalEl ? modalEl.scrollTop : 0;
        const gridScroll = gridEl ? gridEl.scrollTop : 0;
        
        render();
        
        requestAnimationFrame(() => {
          const newModalEl = root.querySelector('.modal-body-scroll');
          const newGridEl = root.querySelector('.glass-table-container');
          if (newModalEl) newModalEl.scrollTop = modalScroll;
          if (newGridEl) newGridEl.scrollTop = gridScroll;
        });
      }
    });

    if (el('#submitDistribution')) el('#submitDistribution').onclick = async () => {
      if (!state.form.title.trim() || !state.form.deadline || !state.parsedRows.length || unresolvedRowsCount() > 0) return;
      
      const items = state.parsedRows.filter((r) => r.assigned_to).map((r) => ({
        case_number: r.case_number || 'N/A',
        site: r.site || 'N/A',
        description: r.description || '', 
        assigned_to: r.assigned_to,
        deadline: state.form.deadline 
      }));
      
      state.creating = true; render();
      const out = await CloudTasks.createDistribution({
        title: state.form.title, description: state.form.description,
        reference_url: state.form.reference_url, enable_daily_alerts: !!state.form.enable_daily_alerts,
        items
      });
      state.creating = false;
      if (!out.ok) { state.parseError = out.message || 'Failed'; render(); return; }
      state.form = { title: '', description: '', reference_url: '', deadline: '', enable_daily_alerts: true };
      state.isFullscreen = false; state.autoAssign.open = false;
      closeModal(); await loadBaseData();
    };
  }

  loadBaseData();
});