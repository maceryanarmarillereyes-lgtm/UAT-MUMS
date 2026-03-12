/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Do not modify existing UI/UX, layouts, or core logic in this file without explicitly asking Thunter BOY for clearance. If changes are required here, STOP and provide a RISK IMPACT REPORT first. */
(window.Pages = window.Pages || {});

window.Pages.members = function(root){
  root.innerHTML = '<div class="small muted">Loading…</div>';
  (async()=>{
  const me = await Auth.requireUser();
  if(!me) return;

  if(!Config.can(me, 'view_members')){
    root.innerHTML = '<div class="h1">Members</div><div class="muted">You do not have access to this page.</div>';
    return;
  }

  const isSuper = me.role === Config.ROLES.SUPER_ADMIN;
  const isAdmin = isSuper || me.role === Config.ROLES.ADMIN;
  const isLead = me.role === Config.ROLES.TEAM_LEAD;

  // Scheduling grid: STRICT 1-hour blocks (no minutes on the grid)
  // Every assignable unit is 60 minutes.
  const GRID_STEP_MIN = 60;

  // Schedule lock UX (Team Lead/Admin/Super Admin must unlock before editing)
  let unlockTriggered = false;
  function readableError(err, fallback){
    if(err == null) return String(fallback||'');
    if(typeof err === 'string') return err;
    if(err instanceof Error) return String(err.message || fallback || err);
    try{
      if(typeof err === 'object'){
        if(typeof err.message === 'string' && err.message.trim()) return err.message;
        if(typeof err.error === 'string' && err.error.trim()) return err.error;
        if(typeof err.details === 'string' && err.details.trim()) return err.details;
        if(typeof err.statusText === 'string' && err.statusText.trim()) return err.statusText;
        const j = JSON.stringify(err);
        if(j && j !== '{}' ) return j;
      }
    }catch(_e){ /* ignore */ }
    return String(fallback || err);
  }
  function showWarning(msg){
    const m = readableError(msg, 'Notice');
    try{
      if(UI && typeof UI.toast === 'function'){
        return UI.toast(m, 'warn');
      }
    }catch(_e){}
    try{ alert(m); }catch(_e){}
  }
  function warnScheduleLocked(){
    showWarning('Schedule is locked. Please unlock before making changes.');
  }


  // Shared dropdown options (Paint + Graph Panel must stay synchronized)
  function getTeamTaskOptions(teamId){
    const tasks = (window.Store && Store.getTeamTasks) ? (Store.getTeamTasks(teamId) || []) : [];
    const roleIds = (tasks && tasks.length) ? tasks.map(t=>t.id) : ['call_onqueue','back_office','block','lunch','mailbox_manager','mailbox_call'];
    const core = ['mailbox_manager','mailbox_call','call_onqueue','back_office','lunch','block'];
    const seen = new Set();
    const ids = [];
    for(const id of [...roleIds, ...core]){
      const v = String(id||'').trim();
      if(!v || seen.has(v)) continue;
      seen.add(v);
      ids.push(v);
    }
    const out = [];
    for(const id of ids){
      const s = Config.scheduleById(id);
      if(s){
        out.push({ id: s.id, label: s.label || id, icon: s.icon || '', color: s.color || '' });
        continue;
      }
      const t = (tasks||[]).find(x=>String(x.id)===String(id));
      if(t){
        out.push({ id, label: t.label || id, icon: '🧩', color: t.color || '' });
        continue;
      }
      out.push({ id, label: id, icon: '🧩', color: '' });
    }
    out.push({ id: '__clear__', label: 'Clear (empty)', icon: '🧽', color: '' });
    return out;
  }

  function taskMeta(teamId, roleId){
    const rid = String(roleId||'').trim();
    if(!rid) return { id:'', label:'', icon:'', color:'' };
    if(rid === '__clear__') return { id:'__clear__', label:'Clear (empty)', icon:'🧽', color:'' };
    const s = Config.scheduleById(rid);
    if(s) return { id: s.id, label: s.label || rid, icon: s.icon || '', color: s.color || '' };
    const tasks = (window.Store && Store.getTeamTasks) ? (Store.getTeamTasks(teamId) || []) : [];
    const t = (tasks||[]).find(x=>String(x.id)===rid);
    if(t) return { id: rid, label: t.label || rid, icon: '🧩', color: t.color || '' };
    return { id: rid, label: rid, icon: '🧩', color: '' };
  }

  function fallbackColorForLabel(label){
    const l = String(label||'').toLowerCase();
    if(l.includes('mailbox')) return '#4aa3ff';
    if(l.includes('call')) return '#2ecc71';
    if(l.includes('back')) return '#ffa21a';
    if(l.includes('lunch')) return '#22d3ee';
    if(l.includes('break')) return '#22d3ee';
    return '#64748b';

  function legendDotEmoji(color){
    const c = String(color||'').trim().toLowerCase();
    const has = (s)=>c.includes(s);
    if(has('emerald')||has('green')||has('#22c55e')||has('#10b981')||has('#16a34a')||has('#059669')) return '🟢';
    if(has('red')||has('#ef4444')||has('#f43f5e')||has('#dc2626')||has('#b91c1c')) return '🔴';
    if(has('orange')||has('#f59e0b')||has('#f97316')||has('#fb923c')) return '🟠';
    if(has('yellow')||has('#eab308')) return '🟡';
    if(has('blue')||has('#3b82f6')||has('#60a5fa')||has('#4aa3ff')) return '🔵';
    if(has('purple')||has('#a855f7')||has('#7c3aed')) return '🟣';

    // Hex fallback: choose dominant RGB channel.
    const m = /^#?([0-9a-f]{6})$/i.exec(c);
    if(m){
      const hex = m[1];
      const r = parseInt(hex.slice(0,2),16);
      const g = parseInt(hex.slice(2,4),16);
      const b = parseInt(hex.slice(4,6),16);
      const max = Math.max(r,g,b);
      if(max === r) return '🔴';
      if(max === g) return '🟢';
      if(max === b) return '🔵';
    }
    return '⚪';
  }

  }

  function _textColorForBg(hex){
    const h = String(hex||'').trim();
    const m = /^#?([0-9a-f]{6})$/i.exec(h);
    if(!m) return '#e5e7eb';
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    const yiq = ((r*299)+(g*587)+(b*114))/1000;
    return yiq >= 140 ? '#0b0f14' : '#f4f4f5';
  }



  // Team filter
  let selectedTeamId = isLead ? me.teamId : (Config.TEAMS[0] && Config.TEAMS[0].id);

  // Day tabs (Sun..Sat)
  function getManilaDayIndex(){
    // Use Manila calendar date -> weekday (timezone-safe)
    const wd = UI.weekdayFromISO(UI.manilaTodayISO());
    return (wd==null) ? 0 : wd;
  }

  let selectedDay = getManilaDayIndex();

  // Week scope selector (Manila week starting Monday)
  // Manila week starting Monday, derived from Manila *calendar* date
  const _todayISO = UI.manilaTodayISO();
  const _todayWD = UI.weekdayFromISO(_todayISO);
  const _deltaToMon = (_todayWD===0) ? -6 : (1 - _todayWD); // Sun->Mon = -6
  const defaultWeekStartISO = UI.addDaysISO(_todayISO, _deltaToMon);
  let weekStartISO = localStorage.getItem('ums_week_start_iso') || defaultWeekStartISO;

  // Paint state (also drives Graph Panel task comparison)
  let paint = {
    enabled: false,
    role: 'call_onqueue',
  };

  // Floating graphical task status panel (Team Lead)
  const GRAPH_LS_KEY = 'mums_graph_status_panel_v1';
  let graphEnabled = false;
  let graphPanelState = null; // { left, top, width, height }
  let graphTaskFilterId = paint.role; // role id; synced with Paint dropdown
  // Graph Panel Settings are hidden by default (Phase 1-505)
  let graphSettingsOpen = false;
  let _taskSyncing = false;

// Unified task selection sync (Paint ↔ Graph Panel). Paint is primary, but changes are bidirectional.
function syncTaskSelection(taskId, opts){
  const v = String(taskId||'').trim();
  if(!v) return;
  const o = opts || {};
  const shouldRender = (o.render !== false);
  const shouldPersist = (o.persist !== false);

  if(_taskSyncing){
    paint.role = v;
    graphTaskFilterId = v;
    if(shouldPersist) persistGraphPrefs();
    return;
  }

  _taskSyncing = true;
  try{
    paint.role = v;
    graphTaskFilterId = v;

    if(shouldPersist) persistGraphPrefs();

    // Keep dropdown UIs in lockstep (no manual re-selection).
    try{
      const pSel = document.getElementById('paintRole');
      if(pSel && String(pSel.value||'') !== v) pSel.value = v;
    }catch(_e){}
    try{
      const gSel = document.getElementById('gspTask');
      if(gSel && String(gSel.value||'') !== v) gSel.value = v;
    }catch(_e){}
  }finally{
    _taskSyncing = false;
  }

  // Re-render the Members list so per-member progress bars update immediately
  // when Paint task selection changes.
  if(shouldRender){
    try{ renderAll(); }catch(_e){}
  }

  if(shouldRender && graphEnabled){
    try{ renderGraphPanel(); }catch(_e){}
  }
}



  function persistGraphPrefs(){
    try{
      const raw = localStorage.getItem(GRAPH_LS_KEY);
      let st = {};
      try{ st = raw ? JSON.parse(raw) : {}; }catch(_e){ st = {}; }
      st.enabled = !!graphEnabled;
      st.taskId = String(graphTaskFilterId||'');
      st.settingsOpen = !!graphSettingsOpen;
      st.panel = graphPanelState || st.panel || null;
      // Analytics view selector removed (Phase 1-505)
      try{ delete st.view; }catch(_e){}
      try{ localStorage.setItem('settingsOpen', graphSettingsOpen ? '1' : '0'); }catch(_e){}
      localStorage.setItem(GRAPH_LS_KEY, JSON.stringify(st));
    }catch(_e){}
  }

  function setGraphTaskFilter(taskId, opts){
    syncTaskSelection(taskId, Object.assign({ render:true, persist:true }, opts||{}));
  }

  function requestGraphRefresh(){
    if(!graphEnabled) return;
    if(requestGraphRefresh._t) return;
    requestGraphRefresh._t = window.setTimeout(()=>{
      requestGraphRefresh._t = 0;
      try{ if(graphEnabled) renderGraphPanel(); }catch(_e){}
    }, 40);
  }
  requestGraphRefresh._t = 0;

  function normalizeToMonday(iso){
    // Snap selected ISO date to Monday of that week using calendar math (timezone-safe)
    const wd = UI.weekdayFromISO(String(iso||defaultWeekStartISO));
    if(wd==null) return defaultWeekStartISO;
    const delta = (wd===0) ? -6 : (1 - wd);
    return UI.addDaysISO(String(iso||defaultWeekStartISO), delta);
  }
  weekStartISO = normalizeToMonday(weekStartISO);

  function isoForDay(dayIndex){
    // weekStartISO is Monday (dayIndex 1). Sunday is -1 day.
    const offset = Number(dayIndex) - 1;
    return UI.addDaysISO(weekStartISO, offset);
  }

  function isRestDay(teamId, userId, isoDate){
    const t = Store.getTeamMaster ? Store.getTeamMaster(teamId) : null;
    const m = t && t.members ? t.members[userId] : null;
    if(!m || !Array.isArray(m.restWeekdays) || !m.restWeekdays.length) return false;
    // Weekday derived from the *calendar date* (timezone-safe)
    const wd = UI.weekdayFromISO(isoDate);
    if(wd==null) return false;
    return m.restWeekdays.includes(wd);
  }

  function getTeamLock(teamId){
    return (Store.getLock ? Store.getLock(teamId, weekStartISO) : null);
  }
  function isDayLocked(teamId, dayIndex){
    const lock = getTeamLock(teamId);
    return !!(lock && lock.lockedDays && lock.lockedDays[String(dayIndex)]);
  }

  function isDayLockedForEdit(teamId, dayIndex){
    // Lock is an approval barrier: ALL roles (Team Lead/Admin/Super Admin) must unlock before editing.
    return isDayLocked(teamId, dayIndex);
  }

  // Used by timeline/grid rendering to decide whether to show/disable a locked day.
  // Must be safe to call from any render path (prevents ReferenceError regressions).
  function dayLockedForGridDisplay(isoDate, teamId){
    try{
      const tid = String(teamId || selectedTeamId || '');
      const wd = UI.weekdayFromISO(String(isoDate||'')); // 0..6 (Sun..Sat)
      if(wd == null) return false;
      return isDayLockedForEdit(tid, wd);
    }catch(_){
      return false;
    }
  }

  function isScheduleEditLocked(teamId, dayIndex){
    return isDayLockedForEdit(teamId, dayIndex) && !unlockTriggered;
  }
  function guardScheduleEditLocked(teamId, dayIndex){
    if(isScheduleEditLocked(teamId, dayIndex)){
      warnScheduleLocked();
      return true;
    }
    return false;
  }

  function dayHasAnyBlocks(teamId, dayIndex){
    const members = getMembersForView(teamId);
    return members.some(m => (Store.getUserDayBlocks(m.id, dayIndex) || []).length > 0);
  }

  function renderDayTabs(){
    const tabs = wrap.querySelector('#dayTabs');
    if(!tabs) return;
    const teamId = selectedTeamId;
    const lock = getTeamLock(teamId);
    const lockedMonFri = !!(lock && lock.lockedDays && [1,2,3,4,5].some(d=>lock.lockedDays[String(d)]));
    tabs.innerHTML = UI.DAYS.map((d,i)=>{
      const active = i===selectedDay ? 'active' : '';
      const has = dayHasAnyBlocks(teamId, i);
      const locked = isDayLocked(teamId, i);
      const dot = has ? '<span class="dot"></span>' : '';
      const lk = locked ? '<span class="lock" role="img" aria-label="Locked" title="Locked">🔒</span>' : '';
      return `<button class="daytab ${active}" data-day="${i}" type="button">${UI.esc(d.slice(0,3))}${dot}${lk}</button>`;
    }).join('');
    tabs.querySelectorAll('button.daytab').forEach(b=>{
      b.onclick = ()=>{
        selectedDay = Number(b.dataset.day);
        triggerSwap();
        renderDayTabs();
        renderAll();
      };
    });

    const badge = wrap.querySelector('#lockBadge');
    const unlockBtn = wrap.querySelector('#unlockSchedule');
    const autoBtn = wrap.querySelector('#autoSchedule');
    const previewBtn = wrap.querySelector('#previewAuto');
    const autoSettingsBtn = wrap.querySelector('#autoSettings');
    if(badge) badge.classList.toggle('hidden', !lockedMonFri);
    // If the week is locked, require a fresh unlock action before any edits.
    if(lockedMonFri) unlockTriggered = false;
    const canUnlock = lockedMonFri && (isLead || isAdmin || isSuper);
    if(unlockBtn) unlockBtn.classList.toggle('hidden', !canUnlock);
    // When locked, prevent accidental re-apply until unlocked
    const lockDisable = !!lockedMonFri;
    if(autoBtn) autoBtn.disabled = lockDisable;
    if(previewBtn) previewBtn.disabled = lockDisable;
    if(autoSettingsBtn) autoSettingsBtn.disabled = lockDisable;

    renderWeekWarning();
  }

  // 12-hour clock label (for ruler)
  function to12h(hm){
    const mins = UI.parseHM(hm);
    const hh = Math.floor(mins/60) % 24;
    const mm = mins % 60;
    const ap = hh >= 12 ? 'PM' : 'AM';
    const h12 = ((hh + 11) % 12) + 1;
    return `${h12}:${String(mm).padStart(2,'0')} ${ap}`;
  }

  // Multi-select state (current day only)
  let selMemberId = null;
  let selMemberIds = new Set(); // selected members (for bulk actions)
  let selIdx = new Set(); // indices for selMemberId

  // Clipboard feature removed (copy/paste disabled)
  let lastCursor = null; // { memberId, offsetMin }

  function clearSelection(){
    selMemberId = null;
    selMemberIds = new Set();
    selIdx = new Set();
    updateSelectionUI();
    applySelectionStyles();
    applyMemberRowSelectionStyles();
  }

  function updateSelectionUI(){
    const badge = wrap.querySelector('#selBadge');
    const clr = wrap.querySelector('#selClear');
    const desel = wrap.querySelector('#selDeselect');
    const del = wrap.querySelector('#deleteSelected');
    const count = selIdx.size;
    if(badge) badge.textContent = `${count} selected`;
    // Clear All should work even if no blocks are selected, as long as a member is selected.
    const canClear = (selMemberIds && selMemberIds.size) ? true : !!selMemberId;
    const canDeleteSelected = !!selMemberId && count>0;
    if(clr) clr.disabled = !canClear;
    if(desel) desel.disabled = !canDeleteSelected;
    if(del) del.disabled = !canDeleteSelected;
  }

  function applySelectionStyles(){
    wrap.querySelectorAll('.timeline .seg').forEach(seg=>seg.classList.remove('selected'));
    if(!selMemberId || selIdx.size===0) return;
    const row = wrap.querySelector(`.members-row[data-id="${CSS.escape(selMemberId)}"]`);
    if(!row) return;
    selIdx.forEach(i=>{
      const seg = row.querySelector(`.seg[data-idx="${i}"]`);
      if(seg) seg.classList.add('selected');
    });
  }

  function applyMemberRowSelectionStyles(){
    // Highlight selected member rows (bulk actions)
    const rows = wrap.querySelectorAll('.members-row');
    rows.forEach(r=>{
      const id = r.dataset.id;
      const on = (selMemberIds && selMemberIds.has(id)) || (!!selMemberId && selMemberId===id);
      r.classList.toggle('m-selected', !!on);
      const cb = r.querySelector('input.m-select');
      if(cb) cb.checked = !!(selMemberIds && selMemberIds.has(id));
    });

    // Keep roster highlight in sync
    wrap.querySelectorAll('.roster-item').forEach(el=>{
      const id = el.getAttribute('data-id');
      const on = (selMemberIds && selMemberIds.has(id)) || (!!selMemberId && selMemberId===id);
      el.classList.toggle('selected', !!on);
      el.setAttribute('aria-selected', on ? 'true' : 'false');
    });

    // Keep floating graph highlight in sync (stability: never crash selection)
    if(graphEnabled){
      try{ renderGraphPanel(); }
      catch(_e){
        graphEnabled = false;
        try{ const t = wrap.querySelector('#graphToggle'); if(t) t.checked = false; }catch(__){}
        try{ const p = wrap.querySelector('#graphPanel'); if(p) p.classList.add('hidden'); }catch(__){}
      }
    }
  }

  // Roster (Section 1) — click-to-select and jump to timeline row.
  let rosterFilter = 'all'; // all | active | inactive
  let rosterQuery = '';

  function isElementVisible(el){
    if(!el) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
  }

  function renderRoster(members){
    if (!Array.isArray(members)) members = [];
    const list = wrap.querySelector('#membersRosterList');
    const meta = wrap.querySelector('#membersRosterMeta');
    if (!list) return;

    const q = String(rosterQuery || '').trim().toLowerCase();
    const f = String(rosterFilter || 'all');

    const filtered = members.filter(m => {
      const name = String(m.name || '');
      if (q && !name.toLowerCase().includes(q)) return false;
      if (f === 'active') return !m._isInactive;
      if (f === 'inactive') return !!m._isInactive;
      return true;
    });

    if (meta) meta.textContent = `${filtered.length} of ${members.length}`;

    if (!filtered.length) {
      list.innerHTML = `<div class="empty-state">No members found</div>`;
      return;
    }

    const sel = window.selMemberId;
    list.innerHTML = filtered.map(m => {
      const selected = sel && String(sel) === String(m.id);
      const statusClass = m._isInactive ? 'status-inactive' : 'status-active';
      const statusLabel = m._isInactive ? 'Inactive' : 'Active';
      const right = m._isInactive ? `<span class="roster-right text-zinc-400">Inactive</span>` : '';
      return `
        <button class="roster-item ${selected?'selected':''}" role="option" aria-selected="${selected?'true':'false'}" data-id="${UI.esc(m.id)}">
          <span class="roster-left">
            <span class="status-dot ${statusClass}" aria-label="${statusLabel}" title="${statusLabel}"></span>
            <span class="roster-name">${UI.esc(m.name)}</span>
          </span>
          ${right}
        </button>
      `;
    }).join('');
  }

  function selectMemberFromRoster(id, opts){
    const o = Object.assign({ scroll:true, preserveSelection:false, preserveBlocks:false }, opts||{});
    if(!id) return;

    // Avoid stale selection: if the member row doesn't exist in the current render, clear selection safely.
    const row = wrap.querySelector(`.members-row[data-id="${CSS.escape(id)}"]`);
    if(!row){
      selMemberId = null;
      selIdx = new Set();
      selMemberIds = new Set();
      updateSelectionUI();
      applySelectionStyles();
      applyMemberRowSelectionStyles();
      return;
    }

    selMemberId = id;

    // Roster click is a single-target action: unless preserving selection (renderAll restore), reset multi-select state.
    if(!o.preserveSelection){
      selMemberIds = new Set();
      selIdx = new Set();
    }else if(!o.preserveBlocks){
      // Preserve member selection but drop block selection when requested.
      selIdx = new Set();
    }

    updateSelectionUI();
    applySelectionStyles();
    applyMemberRowSelectionStyles();

    // Scroll selected row into view inside the timeline scroll container.
    if(o.scroll){
      try{
        const sc = wrap.querySelector('#membersTimelineScroll');
        if(sc){
          const r = row.getBoundingClientRect();
          const c = sc.getBoundingClientRect();
          const inView = r.top >= c.top && r.bottom <= c.bottom;
          if(!inView) row.scrollIntoView({ block:'center', behavior:'smooth' });
        }else{
          row.scrollIntoView({ block:'center', behavior:'smooth' });
        }
      }catch(_){
        try{ row.scrollIntoView(); }catch(__){}
      }
    }
  }

  const wrap = document.createElement('div');
  wrap.id = 'membersAppWrap';
  wrap.className = 'members-page bg-zinc-950 text-zinc-100 font-sans';

  wrap.innerHTML = `
    <div class="members-topbar">
      <div class="members-topbar-left">
        <div class="members-h1 tracking-tight">Members</div>
        <div class="members-sub text-zinc-400">Plan coverage by assigning time blocks (Sun–Sat). Timeline view shows the whole team shift.</div>
      </div>

      <div class="members-topbar-right" aria-label="Members header controls">
        <button class="btn ghost" id="membersFullscreenBtn" type="button" aria-pressed="false" title="Toggle fullscreen overlay">⛶ Fullscreen</button>

        ${isLead ? '' : `
        <label class="members-field">
          <span class="label text-zinc-400">Team</span>
          <select class="input" id="teamSelect">
            ${Config.TEAMS.map(t=>`<option value="${t.id}">${UI.esc(t.label)}</option>`).join('')}
          </select>
        </label>
        `}

        <div class="members-weekctl">
          <div class="members-weekctl-row">
            <span class="label text-zinc-400">Week of (Mon)</span>
            <button class="iconbtn" id="weekHelp" type="button" aria-label="Week selector help" title="What does this do?">ⓘ</button>
            <input class="input" id="weekSelect" type="date" value="${UI.esc(weekStartISO)}" />
            <button class="btn secondary" id="jumpToday" type="button" title="Jump to Manila Today / This Week">Today</button>
          </div>
          <div id="weekWarn" class="week-warn hidden" aria-live="polite"></div>
        </div>

        ${(isLead||isAdmin) ? `
        <div class="members-global-actions" aria-label="Global actions">
          <div class="reports-dropdown" id="reportsDropdown" aria-label="Reports">
            <button class="btn ghost reports-toggle" id="reportsToggle" type="button" aria-haspopup="menu" aria-expanded="false">Reports</button>
            <div class="reports-menu" id="reportsMenu" role="menu" aria-label="Reports Menu">
              <button class="reports-item" id="exportSchedule" type="button" role="menuitem">Export Schedule CSV</button>
              <button class="reports-item" id="exportWorkload" type="button" role="menuitem">Export Workload CSV</button>
              <button class="reports-item" id="viewAudit" type="button" role="menuitem">View Audit History</button>
              <button class="reports-item" id="viewAcks" type="button" role="menuitem">View Acknowledgements</button>
              <button class="reports-item" id="viewHealthTrend" type="button" role="menuitem">View Health Trend Weekly</button>
            </div>
          </div>

          <label class="switch" title="Show a floating, live-updating task status panel">
            <input type="checkbox" id="graphToggle" aria-label="Show graphical task status" />
            <span class="switch-ui"></span>
            <span class="switch-tx">Graph</span>
          </label>

          <button class="btn primary" id="sendSchedule" type="button" title="Apply schedule changes and notify affected members">Apply</button>

          <div class="global-lock">
            <button class="btn secondary" id="autoSettings" type="button">Settings</button>
            <button class="btn secondary" id="previewAuto" type="button">Preview</button>
            <button class="btn primary" id="autoSchedule" type="button">Apply &amp; Lock</button>
            <span class="lock-badge hidden" id="lockBadge" aria-label="Locked" title="Locked">
              <span class="lock-ic" aria-hidden="true"></span>
            </span>
            <button class="btn danger hidden" id="unlockSchedule" type="button">Unlock</button>
          </div>
        </div>
        ` : ''}
      </div>
    </div>

    <div class="daytabs" id="dayTabs"></div>

    <div class="members-enterprise-grid" id="membersEnterpriseGrid">
      <div class="card members-roster" id="membersRosterPanel">
        <div class="members-roster-header">
          <div class="members-roster-title">
            <div class="h2 tracking-tight">Team Roster</div>
            <div class="small text-zinc-400" id="membersRosterMeta">—</div>
          </div>

          <div class="members-roster-tools">
            <div class="roster-searchbar" role="search">
              <span class="search-ic" aria-hidden="true"></span>
              <input class="input roster-search" id="membersRosterSearch" type="search" placeholder="Search roster…" aria-label="Search roster" />
              <select class="input roster-filter" id="membersRosterFilter" aria-label="Roster filter">
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>
        </div>

        <div class="members-roster-list" id="membersRosterList" role="listbox" aria-label="Roster members"></div>
      </div>

      <div class="members-splitter" id="membersSplitLeft" role="separator" aria-orientation="vertical" tabindex="0" aria-label="Resize roster panel"></div>

      <div class="card members-timeline sched-swap" id="schedulePane">
        <div id="membersTimelineToolbar" class="members-timeline-toolbar" role="toolbar" aria-label="Timeline controls">
          <div class="mtb-left">
            <button class="btn ghost" id="paintToggle" type="button" aria-pressed="false" title="Paint mode: click &amp; drag across hours">Paint</button>
            <select class="input" id="paintRole" aria-label="Paint role" title="Role to paint"></select>

            <button class="btn ghost" id="selectionToggle" type="button" aria-pressed="false" title="Selection mode">Select</button>
            <button class="btn ghost danger" id="deleteSelected" type="button" disabled title="Delete selected blocks (or press Delete)" aria-label="Delete selected">Delete</button>

            <button class="btn danger" id="selClear" type="button" disabled title="Clear ALL blocks for this member/day">Clear</button>
            <button class="btn ghost hidden" id="selDeselect" type="button" aria-hidden="true" tabindex="-1">Delete</button>

            <span class="badge" id="selBadge">0</span>
            <div id="paintModeHint" class="hint text-zinc-400" aria-live="polite">Drag to create • Shift+Click multi-select • Shift+Drag box-select</div>
          </div>

          <div class="mtb-mid"></div>

          <div class="mtb-right">
            <button class="btn ghost icon" id="taskSettingsBtn" type="button" title="Task Settings (Max Hours)" aria-label="Task Settings">⚙️</button>
            ${(isLead||isAdmin||isSuper) ? `<button class="btn primary" id="autoAssignBtn" type="button" title="Auto Assign for this week">Auto Assign</button>` : ``}
          </div>
        </div>

        <div class="members-timeline-scroll" id="membersTimelineScroll">
          <div id="coverageMeter" class="coverage-panel coverage-sticky"></div>
          <div class="members-tip small text-zinc-400">Tip: Assignments are <b>strictly 1-hour blocks</b>. Drag empty space to create. Use <b>Paint</b> to fill multiple hours quickly.</div>
          <div class="timeline-ruler" id="ruler"></div>
          <div class="members-table" id="membersTable"></div>
        </div>
      </div>

      <div class="members-splitter" id="membersSplitRight" role="separator" aria-orientation="vertical" tabindex="0" aria-label="Resize inspector panel"></div>

      <div class="card members-inspector" id="membersAnalyticsRail">
        <div class="inspector-tabs" role="tablist" aria-label="Inspector tabs">
          <button class="tab is-on" type="button" data-tab="analytics" role="tab" aria-selected="true" aria-controls="inspAnalytics">Analytics</button>
<button class="tab" type="button" data-tab="guide" role="tab" aria-selected="false" aria-controls="inspGuide">Guide</button>
        </div>

        <div class="members-analytics-body inspector-panels">
          <div class="inspector-panel" id="inspAnalytics" role="tabpanel">
            <div class="small text-zinc-400" id="membersAnalyticsMeta">—</div>
            <div class="p-4 border-b border-zinc-800/50">
              <div id="member-graph-container"></div>
            </div>
            <div class="small text-zinc-400 mt-3">Notes</div>
            <textarea class="input" id="enterpriseNotes" rows="6" placeholder="Notes for leads and audit…" aria-label="Enterprise notes"></textarea>
            <div class="small text-zinc-400 mt-3">Use the roster to jump to a member. Timeline blocks support paint-fill and multi-select. Coverage meter is heatmap-ready.</div>
          </div>
          <div class="inspector-panel hidden" id="inspGuide" role="tabpanel">
            <div class="guide small text-zinc-400">
              <div class="guide-line"><b>Paint</b>: click &amp; drag across hours.</div>
              <div class="guide-line"><b>Select</b>: Shift+Click to multi-select blocks.</div>
              <div class="guide-line"><b>Delete</b>: Delete selected blocks.</div>
              <div class="guide-line"><b>Resize</b>: Drag splitters or use Arrow keys while focused.</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="modal" id="memberSchedModal">
      <div class="panel">
        <div class="head">
          <div>
            <div class="announce-title" id="msTitle">Schedule</div>
            <div class="small" id="msSub">Edit blocks</div>
          </div>
          <button class="btn ghost" type="button" id="msClose">✕</button>
        </div>
        <div class="body" id="msBody"></div>
      </div>
    </div>

    <div class="modal" id="ackModal">
      <div class="panel">
        <div class="head">
          <div>
            <div class="announce-title" id="ackTitle">Acknowledgements</div>
            <div class="small" id="ackSub">—</div>
          </div>
          <button class="btn ghost" type="button" id="ackClose">✕</button>
        </div>
        <div class="body" id="ackBody"></div>
      </div>
    </div>

    <div class="modal" id="auditModal">
      <div class="panel">
        <div class="head">
          <div>
            <div class="announce-title" id="auditTitle">Audit History</div>
            <div class="small" id="auditSub">—</div>
          </div>
          <button class="btn ghost" type="button" id="auditClose">✕</button>
        </div>
        <div class="body" id="auditBody"></div>
      </div>
    </div>

    <div class="modal" id="trendModal">
      <div class="panel">
        <div class="head">
          <div>
            <div class="announce-title" id="trendTitle">Health Trend</div>
            <div class="small" id="trendSub">—</div>
          </div>
          <button class="btn ghost" type="button" id="trendClose">✕</button>
        </div>
        <div class="body" id="trendBody"></div>
      </div>
    </div>

    <div class="modal modal-blur" id="taskSettingsModal" role="dialog" aria-label="Task Settings">
      <div class="panel">
        <div class="head">
          <div>
            <div class="announce-title" id="taskSettingsTitle">Task Settings</div>
            <div class="small" id="taskSettingsSub">Set Max Hours per Task (per team)</div>
          </div>
          <button class="btn ghost" type="button" id="taskSettingsClose">✕</button>
        </div>
        <div class="body" id="taskSettingsBody"></div>
        <div class="foot task-settings-foot">
          <button class="btn" type="button" id="taskSettingsCancel">Cancel</button>
          <button class="btn primary" type="button" id="taskSettingsSave">Save</button>
        </div>
      </div>
    </div>

    <div id="graphPanel"
 class="graph-status-panel gsp-floating gsp-float-anchor gsp-resizable hidden" role="dialog" aria-label="Graphical task status">
      <div class="gsp-head" id="graphPanelHead">
        <div>
          <div class="gsp-title">Graphical Task Status</div>
          <div class="small text-zinc-400">Live view of assignments</div>
        </div>
        <button class="iconbtn" id="graphClose" type="button" title="Close">✕</button>
      </div>
      <div class="gsp-body" id="graphBody"></div>
    </div>
  `;

  // Enterprise shell wiring (fullscreen, splitters, roster filters, ESC policy).
  function initEnterpriseMembersShell(){
    // Restore persisted splitter widths.
    const leftDefault = 280;
    const rightDefault = 320;
    const leftKey = 'mums_members_left_w';
    const rightKey = 'mums_members_right_w';

    const grid = wrap.querySelector('#membersEnterpriseGrid');
    if(grid){
      const leftW = parseInt(localStorage.getItem(leftKey)||'', 10);
      const rightW = parseInt(localStorage.getItem(rightKey)||'', 10);
      if(Number.isFinite(leftW) && leftW>=220 && leftW<=520) grid.style.setProperty('--members-left', `${leftW}px`);
      if(Number.isFinite(rightW) && rightW>=260 && rightW<=520) grid.style.setProperty('--members-right', `${rightW}px`);
    }

    // Fullscreen overlay toggle (Option A) + focus restore.
    const fsBtn = wrap.querySelector('#membersFullscreenBtn');
    let fsOrigin = null;

    function setFsBtn(on){
      if(!fsBtn) return;
      fsBtn.textContent = on ? '✕ Exit Fullscreen' : '⛶ Fullscreen';
      fsBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }

    function enterOverlay(){
      fsOrigin = document.activeElement;
      document.body.classList.add('members-fullscreen-active');
      wrap.classList.add('members-fullscreen-overlay');
      setFsBtn(true);

      // Try Fullscreen API, but keep overlay behavior even if denied.
      if(document.fullscreenElement !== wrap && wrap.requestFullscreen){
        try{ wrap.requestFullscreen(); }catch{}
      }

      // Focus first meaningful control.
      const first = wrap.querySelector('#paintToggle') || wrap.querySelector('#membersRosterSearch') || fsBtn;
      if(first) first.focus({ preventScroll:true });
    }

    function exitOverlay(){
      document.body.classList.remove('members-fullscreen-active');
      wrap.classList.remove('members-fullscreen-overlay');
      setFsBtn(false);

      if(document.fullscreenElement && document.exitFullscreen){
        try{ document.exitFullscreen(); }catch{}
      }

      if(fsOrigin && fsOrigin.focus){
        try{ fsOrigin.focus({ preventScroll:true }); }catch{ try{ fsOrigin.focus(); }catch{} }
      }
      fsOrigin = null;
    }

    function isOverlayActive(){
      return document.body.classList.contains('members-fullscreen-active') || wrap.classList.contains('members-fullscreen-overlay') || document.fullscreenElement===wrap;
    }

    if(fsBtn && !fsBtn.dataset.bound){
      fsBtn.dataset.bound = '1';
      fsBtn.onclick = ()=>{
        if(isOverlayActive()) exitOverlay();
        else enterOverlay();
      };
      setFsBtn(isOverlayActive());
    }

    document.addEventListener('fullscreenchange', ()=>{
      // Keep UI state consistent when ESC exits native fullscreen.
      if(document.fullscreenElement !== wrap && wrap.classList.contains('members-fullscreen-overlay')){
        // Overlay can remain, but we treat it as active until user exits.
        // No-op; explicit exitOverlay will clear both.
      }
      setFsBtn(isOverlayActive());
    });

    // Splitter drag + keyboard resize.
    function wireSplitter(splitEl, which){
      if(!splitEl || splitEl.dataset.bound) return;
      splitEl.dataset.bound = '1';

      const min = which==='left' ? 220 : 260;
      const max = which==='left' ? 520 : 520;
      const key = which==='left' ? leftKey : rightKey;
      const varName = which==='left' ? '--members-left' : '--members-right';

      function getCurrent(){
        const v = (grid ? getComputedStyle(grid).getPropertyValue(varName) : '').trim();
        const n = parseInt(v.replace('px',''), 10);
        return Number.isFinite(n) ? n : (which==='left' ? leftDefault : rightDefault);
      }
      function setCurrent(n){
        if(!grid) return;
        const clamped = Math.max(min, Math.min(max, n));
        grid.style.setProperty(varName, `${clamped}px`);
        localStorage.setItem(key, String(clamped));
        splitEl.setAttribute('aria-valuemin', String(min));
        splitEl.setAttribute('aria-valuemax', String(max));
        splitEl.setAttribute('aria-valuenow', String(clamped));
      }

      setCurrent(getCurrent());

      let dragging = false;
      let startX = 0;
      let startW = 0;

      splitEl.addEventListener('pointerdown', (e)=>{
        dragging = true;
        startX = e.clientX;
        startW = getCurrent();
        splitEl.setPointerCapture(e.pointerId);
        e.preventDefault();
      });

      splitEl.addEventListener('pointermove', (e)=>{
        if(!dragging) return;
        const dx = e.clientX - startX;
        const next = which==='left' ? (startW + dx) : (startW - dx);
        setCurrent(next);
        e.preventDefault();
      });

      splitEl.addEventListener('pointerup', (e)=>{
        dragging = false;
        try{ splitEl.releasePointerCapture(e.pointerId); }catch{}
      });
      splitEl.addEventListener('pointercancel', ()=>{ dragging=false; });

      splitEl.addEventListener('keydown', (e)=>{
        const step = e.shiftKey ? 24 : 8;
        if(e.key === 'ArrowLeft'){
          const n = which==='left' ? getCurrent()-step : getCurrent()+step;
          setCurrent(n); e.preventDefault();
        }else if(e.key === 'ArrowRight'){
          const n = which==='left' ? getCurrent()+step : getCurrent()-step;
          setCurrent(n); e.preventDefault();
        }
      });
    }

    wireSplitter(wrap.querySelector('#membersSplitLeft'), 'left');
    wireSplitter(wrap.querySelector('#membersSplitRight'), 'right');
    const search = wrap.querySelector('#membersRosterSearch');
    const filterSel = wrap.querySelector('#membersRosterFilter');

    if (filterSel && !filterSel.dataset.bound) {
      filterSel.dataset.bound = '1';
      filterSel.value = rosterFilter;
      filterSel.addEventListener('change', () => {
        rosterFilter = String(filterSel.value || 'all');
        if (Array.isArray(wrap._lastRosterMembers)) renderRoster(wrap._lastRosterMembers);
      });
    }

    if (search && !search.dataset.bound) {
      search.dataset.bound = '1';
      search.addEventListener('input', () => {
        rosterQuery = String(search.value || '');
        if (Array.isArray(wrap._lastRosterMembers)) renderRoster(wrap._lastRosterMembers);
      });
    }

    // Focus trap + ESC policy: close open modals/dropdowns first, then exit overlay.
    function getFocusable(root){
      const sel = [
        'a[href]:not([tabindex="-1"])',
        'button:not([disabled]):not([tabindex="-1"])',
        'input:not([disabled]):not([tabindex="-1"])',
        'select:not([disabled]):not([tabindex="-1"])',
        'textarea:not([disabled]):not([tabindex="-1"])',
        '[tabindex]:not([tabindex="-1"])'
      ].join(',');
      return Array.from(root.querySelectorAll(sel)).filter(el=>isElementVisible(el));
    }

    function closeOpenUiFirst(){
      // 1) Any open modal
      const openModal = Array.from(wrap.querySelectorAll('.modal')).find(m => (m.classList.contains('open') || isElementVisible(m)) && isElementVisible(m));
      if(openModal){
        const closeBtn = openModal.querySelector('[data-close], .modal-close, .btn-close, button[aria-label="Close"]');
        if(closeBtn) closeBtn.click();
        else openModal.classList.remove('open');
        return true;
      }

      // 2) Role picker popover
      const rp = wrap.querySelector('.role-picker');
      if(rp && isElementVisible(rp)){
        rp.remove();
        return true;
      }

      // 3) Reports dropdown
      const dd = wrap.querySelector('#reportsDropdown');
      if(dd && dd.classList.contains('open')){
        dd.classList.remove('open');
        const t = wrap.querySelector('#reportsToggle');
        if(t) t.setAttribute('aria-expanded','false');
        return true;
      }

      return false;
    }

    function onGlobalKeydown(e){
      // Only trap when overlay is active
      if(!isOverlayActive()) return;

      if(e.key === 'Tab'){
        const focusables = getFocusable(wrap);
        if(focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length-1];
        if(e.shiftKey && document.activeElement === first){
          last.focus(); e.preventDefault();
        }else if(!e.shiftKey && document.activeElement === last){
          first.focus(); e.preventDefault();
        }
        return;
      }

      if(e.key === 'Escape'){
        if(closeOpenUiFirst()){
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        exitOverlay();
        e.preventDefault();
        e.stopPropagation();
      }
    }

    if(!wrap._enterpriseKeydown){
      wrap._enterpriseKeydown = onGlobalKeydown;
      window.addEventListener('keydown', onGlobalKeydown, true);
      root._cleanup = root._cleanup || [];
      root._cleanup.push(()=>window.removeEventListener('keydown', onGlobalKeydown, true));
    }
  }


  root.replaceChildren(wrap);

  initEnterpriseMembersShell();

  // REPORTS dropdown (hover-open + click toggle)
  (function initReportsDropdown(){
    const dd = wrap.querySelector('#reportsDropdown');
    const btn = wrap.querySelector('#reportsToggle');
    const menu = wrap.querySelector('#reportsMenu');
    if(!dd || !btn || !menu) return;

    const setOpen = (on)=>{
      dd.classList.toggle('open', !!on);
      try{ btn.setAttribute('aria-expanded', on ? 'true' : 'false'); }catch(_e){}
    };

    btn.addEventListener('click', (e)=>{
      e.preventDefault();
      e.stopPropagation();
      setOpen(!dd.classList.contains('open'));
    });

    // Hover-open (enterprise UX) + keyboard focus support
    const hasFocus = ()=>{ try{ return dd.contains(document.activeElement); }catch(_e){ return false; } };
    dd.addEventListener('mouseenter', ()=>setOpen(true));
    dd.addEventListener('mouseleave', ()=>{ if(!hasFocus()) setOpen(false); });
    dd.addEventListener('focusin', ()=>setOpen(true));
    dd.addEventListener('focusout', ()=>{ setTimeout(()=>{ if(!hasFocus()) setOpen(false); }, 0); });

    // Close on outside click
    document.addEventListener('click', (e)=>{
      if(!dd.contains(e.target)) setOpen(false);
    });

    // Close after selecting an item
    menu.querySelectorAll('button').forEach(b=>{
      b.addEventListener('click', ()=>setOpen(false));
    });

    // ESC closes
    dd.addEventListener('keydown', (e)=>{
      if(e.key === 'Escape') setOpen(false);
    });
  })();

  // ---------------------------------------------------------------------
  // Floating Graphical Task Status Panel (Team Lead)
  // ---------------------------------------------------------------------
  (function initGraphPanel(){
    const toggle = wrap.querySelector('#graphToggle');
    const panel = wrap.querySelector('#graphPanel');
    const head = wrap.querySelector('#graphPanelHead');
    const closeBtn = wrap.querySelector('#graphClose');

    if(!toggle || !panel || !head) return;

    // Restore state
    try{
      const raw = localStorage.getItem(GRAPH_LS_KEY);
      if(raw){
        const st = JSON.parse(raw);
        graphEnabled = !!st.enabled;
        graphPanelState = st.panel || null;
        if(st && st.taskId) graphTaskFilterId = String(st.taskId);
        else if(st && st.mode === 'call') graphTaskFilterId = 'call_onqueue'; // legacy
        else if(st && st.mode === 'mailbox') graphTaskFilterId = 'mailbox_manager'; // legacy
        graphSettingsOpen = !!(st && st.settingsOpen);
        try{
          const so = localStorage.getItem('settingsOpen');
          if(so != null) graphSettingsOpen = (String(so) === '1' || String(so).toLowerCase() === 'true');
        }catch(_e){}
        // Keep Paint + Graph synchronized on load
        syncTaskSelection(graphTaskFilterId, { render:false, persist:true });
      }
    }catch(_e){ /* ignore */ }

    // Apply panel position/size if stored
    function applyPanelState(){
      if(!graphPanelState) return;
      const { left, top, width, height } = graphPanelState || {};
      if(Number.isFinite(left) && Number.isFinite(top)){
        panel.style.left = `${Math.max(8, left)}px`;
        panel.style.top = `${Math.max(8, top)}px`;
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
      }
      if(Number.isFinite(width) && width > 220) panel.style.width = `${width}px`;
      if(Number.isFinite(height) && height > 220) panel.style.height = `${height}px`;
    }

    function saveGraphState(){
      try{
        const r = panel.getBoundingClientRect();
        const st = {
          enabled: graphEnabled,
          taskId: String(graphTaskFilterId||''),
          settingsOpen: !!graphSettingsOpen,
          panel: {
            left: Math.round(r.left),
            top: Math.round(r.top),
            width: Math.round(r.width),
            height: Math.round(r.height),
          }
        };
        // Keep in-memory state in sync so mode changes don't clobber geometry.
        graphPanelState = st.panel;
        localStorage.setItem(GRAPH_LS_KEY, JSON.stringify(st));
      }catch(_e){ /* ignore */ }
    }

    function setEnabled(on){
      graphEnabled = !!on;
      toggle.checked = graphEnabled;
      panel.classList.toggle('hidden', !graphEnabled);
      if(graphEnabled){
        applyPanelState();
        // Ensure the panel always reflects the current Paint selection when opened.
        syncTaskSelection(paint.role, { render:false, persist:true });
        try{
        requestAnimationFrame(()=>{
          try{ renderGraphPanel(); }
          catch(_e){ try{ setEnabled(false); }catch(__){} }
        });
      }catch(_e){
        try{ renderGraphPanel(); }catch(__){ try{ setEnabled(false); }catch(___){} }
      }
      }
      saveGraphState();
    }

    // Draggable header
    (function makeDraggable(){
      let dragging = false;
      let sx = 0, sy = 0;
      let sl = 0, st = 0;

      head.addEventListener('pointerdown', (e)=>{
        if(e.button !== 0) return;
        if(e.target && e.target.closest && e.target.closest('#graphClose')) return;
        dragging = true;
        const rect = panel.getBoundingClientRect();
        sx = e.clientX; sy = e.clientY;
        sl = rect.left; st = rect.top;
        panel.style.left = `${sl}px`;
        panel.style.top = `${st}px`;
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        head.setPointerCapture(e.pointerId);
        head.classList.add('dragging');
      });

      head.addEventListener('pointermove', (e)=>{
        if(!dragging) return;
        const dx = e.clientX - sx;
        const dy = e.clientY - sy;
        const left = Math.max(8, sl + dx);
        const top = Math.max(8, st + dy);
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
      });

      const endDrag = (e)=>{
        if(!dragging) return;
        dragging = false;
        head.classList.remove('dragging');
        try{ head.releasePointerCapture(e.pointerId); }catch(_e){}
        saveGraphState();
      };
      head.addEventListener('pointerup', endDrag);
      head.addEventListener('pointercancel', endDrag);
    })();

    // Resizable from any edge/corner (enterprise handles)
    try{
      if(window.GraphPanel && typeof GraphPanel.enableResizable === 'function'){
        panel.classList.add('gsp-resizable');
        GraphPanel.enableResizable(panel, { minWidth: 320, minHeight: 240, onResizeEnd: saveGraphState });
      }
    }catch(_e){ /* non-fatal */ }

    // Save size after resize (native resize handle fallback)
    panel.addEventListener('mouseup', ()=>{ if(graphEnabled) saveGraphState(); });
    panel.addEventListener('touchend', ()=>{ if(graphEnabled) saveGraphState(); });

    // Wire controls
    toggle.addEventListener('change', ()=> setEnabled(toggle.checked));
    if(closeBtn) closeBtn.addEventListener('click', ()=> setEnabled(false));

    // Store-driven refresh
    if(wrap._members_graph_store_listener){
      window.removeEventListener('mums:store', wrap._members_graph_store_listener);
      wrap._members_graph_store_listener = null;
    }
    wrap._members_graph_store_listener = (ev)=>{
      if(!graphEnabled) return;
      const k = ev && ev.detail && ev.detail.key;
      if(!k) return;
      const ks = String(k);
      if(ks === '*' || ks.includes('schedule') || ks.includes('task') || ks.includes('team')){
        try{ renderGraphPanel(); }catch(_e){ try{ setEnabled(false); }catch(__){} }
      }
    };
    window.addEventListener('mums:store', wrap._members_graph_store_listener);

    // Initial paint
    setEnabled(graphEnabled);
  })();

  function renderGraphPanel(){
    // Stability: Graph panel may not exist yet (or may be removed in some views).
    const panel = wrap.querySelector('#graphPanel');
    const toggle = wrap.querySelector('#graphToggle');
    if(!panel || !toggle){
      graphEnabled = false;
      try{ if(toggle) toggle.checked = false; }catch(_e){}
      return;
    }

    // Landscape orientation (sample layout)
    panel.classList.add('gsp-landscape');

    const body = panel.querySelector('#graphBody') || panel.querySelector('#graphPanelBody');
    const sub = panel.querySelector('#graphPanelSub');
    const foot = panel.querySelector('#graphPanelFoot');

    if(!body){
      graphEnabled = false;
      try{ toggle.checked = false; }catch(_e){}
      panel.classList.add('hidden');
      return;
    }

    if(!graphEnabled){
      try{ toggle.checked = false; }catch(_e){}
      panel.classList.add('hidden');
      return;
    }
    panel.classList.remove('hidden');

    const team = Config.teamById(selectedTeamId);
    if(!team){
      body.innerHTML = `<div class="small muted">No team selected.</div>`;
      return;
    }

    const esc = UI.escapeHtml || ((s)=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'));

    const cfg = (window.Store && Store.getTeamConfig) ? Store.getTeamConfig(team.id) : null;
    const callRole = (cfg && cfg.coverageTaskId) ? String(cfg.coverageTaskId) : 'call_onqueue';

    // Unified task list (Paint + Graph)
    const taskOpts = getTeamTaskOptions(team.id);
    const optIds = new Set(taskOpts.map(o=>String(o.id)));

    // Paint dropdown is the source of truth; Graph Panel must follow.
    let desiredTaskId = String(paint.role||'').trim();
    if(!desiredTaskId || !optIds.has(desiredTaskId)){
      desiredTaskId = optIds.has(String(callRole)) ? String(callRole) : (taskOpts[0] ? String(taskOpts[0].id) : String(callRole));
    }
    if(String(graphTaskFilterId||'') !== String(desiredTaskId) || String(paint.role||'') !== String(desiredTaskId)){
      syncTaskSelection(desiredTaskId, { render:false, persist:true });
    }

    const meta = taskMeta(team.id, graphTaskFilterId);
    const compareLabel = (meta && meta.label) ? meta.label : String(graphTaskFilterId||'');

    const weekLong = (()=>{
      try{
        const d0 = new Date(`${weekStartISO}T00:00:00`);
        const endISO = UI.addDaysISO(weekStartISO, 6);
        const d1 = new Date(`${endISO}T00:00:00`);
        const a = d0.toLocaleDateString('en-US', { month:'short', day:'2-digit', year:'numeric' });
        const b = d1.toLocaleDateString('en-US', { month:'short', day:'2-digit', year:'numeric' });
        return `${a} – ${b}`;
      }catch(_){
        return String(weekStartISO||'');
      }
    })();

    if(sub){
      const tLabel = (team && (team.label || team.name || team.key)) ? (team.label || team.name || team.key) : 'Team';
      sub.textContent = `${tLabel} • Week ${weekLong} • Compare: ${compareLabel}`;
    }
    if(foot){
      foot.textContent = 'Synced with Paint • Sorted by percentage (lowest at top, highest at bottom).';
    }

    const members = getMembersForView(selectedTeamId) || [];
    if(!members.length){
      body.innerHTML = `<div class="small muted">No members loaded for this team.</div>`;
      return;
    }

    // Max-hours settings (stored per team)
    const maxKey = `mums_gsp_max_hours_${team.id}`;
    let maxMap = {};
    try{ maxMap = JSON.parse(localStorage.getItem(maxKey) || '{}') || {}; }catch(_){ maxMap = {}; }

    function taskLayout(taskId){
      try{
        if(window.GraphPanel && typeof GraphPanel.getTaskLayout === 'function'){
          return GraphPanel.getTaskLayout(taskId, { callRole, meta });
        }
      }catch(_){}
      // Fallback layout
      const c = (meta && meta.color) ? meta.color : fallbackColorForLabel(compareLabel);
      return { cls:'gsp-task-generic', defaultMax: 20, barColor: c };
    }

    function getMaxHoursForTask(taskId){
      const k = String(taskId||'');
      const v = Number(maxMap[k]);
      if(Number.isFinite(v) && v > 0) return v;
      const lay = taskLayout(taskId);
      const d = Number(lay && lay.defaultMax ? lay.defaultMax : 20);
      return (Number.isFinite(d) && d > 0) ? d : 20;
    }

    function setMaxHoursForTask(taskId, val){
      const k = String(taskId||'');
      const n = Number(val);
      if(!Number.isFinite(n) || n <= 0){
        delete maxMap[k];
      }else{
        maxMap[k] = Math.round(n*10)/10;
      }
      try{ localStorage.setItem(maxKey, JSON.stringify(maxMap)); }catch(_){}
    }

    function blockMinutes(b){
      try{
        const s = UI.offsetFromShiftStart(team, b.start);
        const e = UI.offsetFromShiftStart(team, b.end);
        return Math.max(0, e - s);
      }catch(_){ return 0; }
    }

    const shiftMin = (()=>{
      try{
        const sm = UI.shiftMeta(team);
        return Math.max(60, Number(sm && sm.length ? sm.length : 540));
      }catch(_){ return 540; }
    })();

    function computeTaskMinutesForMember(member, taskId){
      const tid = String(taskId||'');
      const byDay = new Array(7).fill(0);

      if(tid === '__clear__'){
        // Clear (empty) → unassigned minutes
        let total = 0;
        for(let d=0; d<7; d++){
          const bl = normalizeBlocks(team, Store.getUserDayBlocks(member.id, d) || []);
          let assigned = 0;
          for(const b of (bl||[])) assigned += blockMinutes(b);
          const unassigned = Math.max(0, shiftMin - assigned);
          byDay[d] = unassigned;
          total += unassigned;
        }
        return { totalMin: total, byDayMin: byDay };
      }

      const isMailbox = (tid === 'mailbox_manager');
      const isCall = (tid === callRole || tid === 'call_onqueue' || tid === 'call_available');

      let total = 0;
      for(let d=0; d<7; d++){
        const bl = normalizeBlocks(team, Store.getUserDayBlocks(member.id, d) || []);
        let dayMin = 0;
        for(const b of (bl||[])){
          const mins = blockMinutes(b);
          if(!mins) continue;
          const r = String(b.role||'');
          if(isMailbox){
            if(r==='mailbox_manager' || r==='mailbox_call') dayMin += mins;
          }else if(isCall){
            if(r===callRole || r==='call_available' || r==='mailbox_call' || r==='call_onqueue') dayMin += mins;
          }else{
            if(r===tid) dayMin += mins;
          }
        }
        byDay[d] = dayMin;
        total += dayMin;
      }
      return { totalMin: total, byDayMin: byDay };
    }

    const maxH = getMaxHoursForTask(graphTaskFilterId);
    const lay = taskLayout(graphTaskFilterId);

    // Apply per-task styling class to the panel (mailbox/call/backoffice/etc.)
    panel.classList.remove('gsp-task-mailbox','gsp-task-call','gsp-task-backoffice','gsp-task-generic');
    if(lay && lay.cls) panel.classList.add(lay.cls);

    const barColor = (lay && lay.barColor) ? lay.barColor : ((meta && meta.color) ? meta.color : fallbackColorForLabel(compareLabel));

    const rows = members.map(m=>{
      const res = computeTaskMinutesForMember(m, graphTaskFilterId);
      const name = m.fullName || m.name || m.email || m.id;
      const hours = (res.totalMin||0)/60;
      const hoursRounded = Math.round(hours);

      const pctRaw = maxH > 0 ? (hours / maxH) * 100 : 0;
      const pct = Math.min(100, Math.max(0, pctRaw));

      return {
        id: m.id,
        name,
        hours,
        hoursRounded,
        pctRaw,
        pct,
        pctText: `${Math.round(pct)}%`
      };
    });

    // Sort by percentage: lowest at top, highest at bottom (matches sample)
    rows.sort((a,b)=>{
      if(a.pctRaw !== b.pctRaw) return a.pctRaw - b.pctRaw;
      return String(a.name||'').localeCompare(String(b.name||''));
    });

    const controlHtml = `
      <div class="gsp-controls">
        <div class="gsp-field">
          <label class="small muted" for="gspTask">Comparison</label>
          <select class="input" id="gspTask" aria-label="Select task comparison">
            ${taskOpts.map(o=>`<option value="${esc(o.id)}">${esc(o.icon||'')} ${esc(o.label||o.id)}</option>`).join('')}
          </select>
        </div>
        <div class="gsp-controls-hint small muted">Landscape • % based on max hours • Synced with Paint</div>
      </div>
    `;

    const tableHtml = `
      <div class="gsp-landscape-table ${esc(lay && lay.cls ? lay.cls : 'gsp-task-generic')}" style="--gsp-bar:${esc(barColor)}">
        <div class="gsp-thead">
          <div class="gsp-th gsp-th-name">Members</div>
          <div class="gsp-th gsp-th-task">${esc(compareLabel)}</div>
        </div>
        <div class="gsp-tbody">
          ${rows.map(r=>{
            const title = `${compareLabel}: ${r.hours.toFixed(1)}h / ${maxH}h (${r.pctRaw.toFixed(1)}%)`;
            const viz = (window.GraphPanel && typeof GraphPanel.renderProgressBarHTML === 'function')
              ? GraphPanel.renderProgressBarHTML({ pct: r.pct, pctText: r.pctText, color: barColor, title })
              : `<div class="gsp-progress" title="${esc(title)}"><div class="gsp-progress-track" style="--p:${r.pct.toFixed(2)};--c:${esc(barColor)}"><div class="gsp-progress-fill"></div><div class="gsp-progress-label">${esc(r.pctText)}</div></div></div>`;
            const isHL = (String(selMemberId||'')===String(r.id)) || (selMemberIds && selMemberIds.has(String(r.id)));
            const rowCls = `gsp-tr${isHL ? ' gsp-highlighted' : ''}`;
            return `
              <div class="${rowCls}" data-mid="${esc(r.id)}" role="button" tabindex="0" aria-label="${esc(r.name)} ${esc(compareLabel)} percentage">
                <div class="gsp-td gsp-td-name">
                  <span class="gsp-member">${esc(r.name)}</span>
                  <span class="gsp-hours">(${esc(r.hoursRounded)}h)</span>
                </div>
                <div class="gsp-td gsp-td-bar">${viz}</div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    body.innerHTML = controlHtml + tableHtml;

    const taskSel = body.querySelector('#gspTask');
    if(taskSel){
      taskSel.value = String(graphTaskFilterId||'');
      taskSel.addEventListener('change', ()=>{
        const v = String(taskSel.value||'').trim();
        if(!v) return;
        syncTaskSelection(v, { render:true, persist:true });
        syncTimelineToolbarUI();
      });
    }

    // Analytics view selector removed (Phase 1-505)


    body.querySelectorAll('.gsp-tr').forEach(rEl=>{
      const id = rEl.dataset.mid;
      const go = ()=>{
        selMemberId = id;
        if(selMemberIds) selMemberIds.clear();
        applyMemberRowSelectionStyles();
        const row = wrap.querySelector(`.members-row[data-id="${CSS.escape(id)}"]`);
        if(row) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
        renderGraphPanel();
      };
      rEl.addEventListener('click', go);
      rEl.addEventListener('keydown', (e)=>{ if(e.key==='Enter' || e.key===' ') { e.preventDefault(); go(); } });
    });
  }

  function renderMemberGraphPanel(data) {
    // Target the specific container
    const container = document.getElementById('member-graph-container');
    // SAFETY CHECK: If container is missing (e.g., hidden tab), stop execution to prevent crash
    if (!container) {
        // console.warn('Graph container missing. Skipping render.');
        return;
    }

    // If caller didn't provide data, try to derive it from current view.
    if (!Array.isArray(data)) {
        try {
            data = (typeof getMembersForView === 'function') ? (getMembersForView(selectedTeamId) || []) : [];
        } catch (_) {
            data = [];
        }
    }

    // Calculate Stats
    const total = data.length;
    const active = data.filter(m => String(m && m.status ? m.status : '').toLowerCase() === 'active').length;
    const percentage = total > 0 ? (active / total) * 100 : 0;

    // Render Linear-Style Bar (Zinc/Emerald Theme)
    container.innerHTML = `
        <div class="flex items-center justify-between text-xs mb-2">
            <span class="text-zinc-500 font-medium">Team Availability</span>
            <span class="text-emerald-400 font-mono">${active}/${total} Online</span>
        </div>
        <div class="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div class="h-full bg-emerald-500 transition-all duration-500" style="width: ${percentage}%"></div>
        </div>
    `;
}



  // Smooth transitions when switching weeks/days
  function triggerSwap(){
    const pane = wrap.querySelector('#schedulePane');
    if(!pane) return;
    pane.classList.add('swap-anim');
    window.clearTimeout(triggerSwap._t);
    triggerSwap._t = window.setTimeout(()=>pane.classList.remove('swap-anim'), 240);
  }

  // Week selector tooltip (professional inline popover)
  function showWeekHelp(anchor){
    const existing = document.getElementById('weekHelpPop');
    if(existing) existing.remove();
    const pop = document.createElement('div');
    pop.id = 'weekHelpPop';
    pop.className = 'popover';
    pop.innerHTML = `
      <div class="pop-title">Week Selector</div>
      <div class="small leading-snug">
        Controls which <b>week</b> you are viewing, editing, sending, and locking.<br/>
        Rest Days, Leaves, Coverage Meter, and Notifications depend on the selected week.
      </div>
    `;
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    const pr = pop.getBoundingClientRect();
    const top = Math.max(12, r.bottom + 8);
    const left = Math.min(window.innerWidth - pr.width - 12, Math.max(12, r.left - 4));
    pop.style.top = top + 'px';
    pop.style.left = left + 'px';
    const onDown = (e)=>{
      if(pop.contains(e.target) || anchor.contains(e.target)) return;
      pop.remove();
      document.removeEventListener('mousedown', onDown);
    };
    document.addEventListener('mousedown', onDown);
  }

  function currentWeekStartISO(){
    const todayISO = UI.manilaTodayISO();
    return normalizeToMonday(todayISO);
  }

  function renderWeekWarning(){
    const warn = wrap.querySelector('#weekWarn');
    if(!warn) return;
    const nowWeek = currentWeekStartISO();
    const lock = getTeamLock(selectedTeamId);
    const lockedMonFri = !!(lock && lock.lockedDays && [1,2,3,4,5].some(d=>lock.lockedDays[String(d)]));
    const isPast = String(weekStartISO) < String(nowWeek);
    const isFuture = String(weekStartISO) > String(nowWeek);

    let html = '';
    let cls = '';
    if(lockedMonFri){
      cls = 'locked';
      html = `🔒 <b>This Week Is Locked</b> — Editing is disabled. Unlock to make changes.`;
    } else if(isPast){
      cls = 'past';
      html = `⚠️ <b>Past Week</b> — You are viewing a previous schedule. Changes here won’t affect current operations.`;
    } else if(isFuture){
      cls = 'future';
      html = `🗓️ <b>Future Week</b> — You are planning ahead.`;
    }

    if(!html){
      warn.className = 'week-warn hidden';
      warn.innerHTML = '';
      return;
    }
    warn.classList.remove('hidden');
    warn.className = `week-warn ${cls}`;
    warn.innerHTML = html;
  }

  // Header controls
  const teamSel = wrap.querySelector('#teamSelect');
  if(teamSel){
    teamSel.value = selectedTeamId;
    teamSel.onchange = ()=>{ selectedTeamId = teamSel.value; renderDayTabs(); renderAll(); };
  }
  const weekSel = wrap.querySelector('#weekSelect');
  if(weekSel){
    weekSel.value = weekStartISO;
    weekSel.onchange = ()=>{
      triggerSwap();
      weekStartISO = normalizeToMonday(weekSel.value);
      localStorage.setItem('ums_week_start_iso', weekStartISO);
      weekSel.value = weekStartISO;
      renderDayTabs();
      renderAll();
    };
  }

  const weekHelpBtn = wrap.querySelector('#weekHelp');
  if(weekHelpBtn){
    weekHelpBtn.onclick = ()=>showWeekHelp(weekHelpBtn);
  }

  const jumpTodayBtn = wrap.querySelector('#jumpToday');
  if(jumpTodayBtn){
    jumpTodayBtn.onclick = ()=>{
      triggerSwap();
      weekStartISO = currentWeekStartISO();
      localStorage.setItem('ums_week_start_iso', weekStartISO);
      if(weekSel) weekSel.value = weekStartISO;
      // Also snap day tab to Manila "today"
      selectedDay = getManilaDayIndex();
      renderDayTabs();
      renderAll();
    };
  }

  // Paint mode (click + drag across hours) — still strictly 1-hour blocks
  // Option B: keep legend chips in the sticky timeline toolbar.
  let selectionMode = false;

  function syncTimelineToolbarUI(){
    const paintBtn = wrap.querySelector('#paintToggle');
    const roleSel = wrap.querySelector('#paintRole');
    const selToggle = wrap.querySelector('#selectionToggle');
    const delBtn = wrap.querySelector('#deleteSelected');
    const legacyDelBtn = wrap.querySelector('#selDeselect');

    // Populate role dropdown when team changes (single source of truth).
    if(roleSel){
      const teamKey = String(selectedTeamId||'');
      if(roleSel.dataset.teamKey !== teamKey){
        const opts = getTeamTaskOptions(selectedTeamId).map(o=>{
          const meta = taskMeta(selectedTeamId, o.id) || {};
          const dot = legendDotEmoji(meta.color || meta.bg || meta.background || '');
          const label = UI.esc(o.label||o.id);
          return `<option value="${UI.esc(o.id)}">${UI.esc(dot)} ${label}</option>`;
        }).join('');
        roleSel.innerHTML = opts;
        roleSel.dataset.teamKey = teamKey;
      }
      roleSel.value = paint.role;
      if(!roleSel.dataset.bound){
        roleSel.dataset.bound = '1';
        roleSel.onchange = ()=>{
          const v = String(roleSel.value||'').trim();
          if(!v) return;
          paint.role = v;
          // Paint dropdown directly drives Graph Panel task comparison.
          syncTaskSelection(v, { render:true, persist:true });
        };
      }
    }

    if(paintBtn){
      paintBtn.setAttribute('aria-pressed', paint.enabled ? 'true' : 'false');
      paintBtn.classList.toggle('primary', !!paint.enabled);
      if(!paintBtn.dataset.bound){
        paintBtn.dataset.bound = '1';
        paintBtn.onclick = ()=>{
          paint.enabled = !paint.enabled;
          wrap.classList.toggle('paint-enabled', paint.enabled);
          syncTimelineToolbarUI();
        };
      }
    }
    wrap.classList.toggle('paint-enabled', paint.enabled);

    if(selToggle){
      selToggle.setAttribute('aria-pressed', selectionMode ? 'true' : 'false');
      selToggle.classList.toggle('primary', !!selectionMode);
      if(!selToggle.dataset.bound){
        selToggle.dataset.bound = '1';
        selToggle.onclick = ()=>{
          selectionMode = !selectionMode;
          wrap.classList.toggle('selection-mode', selectionMode);
          syncTimelineToolbarUI();
        };
      }
    }

    const canDeleteSelected = !!selMemberId && selIdx.size>0;
    if(delBtn){
      delBtn.disabled = !canDeleteSelected;
      if(!delBtn.dataset.bound){
        delBtn.dataset.bound = '1';
        delBtn.onclick = ()=>deleteSelectedBlocks({ confirm: true });
      }
    }
    if(legacyDelBtn) legacyDelBtn.disabled = !canDeleteSelected;
  }

  function wireInspectorTabs(){
    const tabs = Array.from(wrap.querySelectorAll('.inspector-tabs .tab'));
    const panels = {
      analytics: wrap.querySelector('#inspAnalytics'),
      guide: wrap.querySelector('#inspGuide')
    };
    const setActive = (key)=>{
      tabs.forEach(t=>{
        const on = t.dataset.tab === key;
        t.classList.toggle('is-on', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      Object.entries(panels).forEach(([k,p])=>{
        if(!p) return;
        p.classList.toggle('hidden', k !== key);
      });
    };
    tabs.forEach(t=>{
      if(t.dataset.bound) return;
      t.dataset.bound = '1';
      t.addEventListener('click', ()=>setActive(String(t.dataset.tab||'analytics')));
    });
    setActive('analytics');
  }

  // ---------------------------------------------------------------------
  // Task Settings Modal (Max Hours per Task, saved locally per team)
  // ---------------------------------------------------------------------
  function _taskMaxHoursKey(teamId){
    return `mums_gsp_max_hours_${String(teamId||'')}`;
  }
  function loadTaskMaxHoursMap(teamId){
    try{
      const raw = localStorage.getItem(_taskMaxHoursKey(teamId));
      if(!raw) return {};
      const obj = JSON.parse(raw);
      return (obj && typeof obj === 'object') ? obj : {};
    }catch(_e){
      return {};
    }
  }
  function saveTaskMaxHoursMap(teamId, map){
    try{
      localStorage.setItem(_taskMaxHoursKey(teamId), JSON.stringify(map || {}));
    }catch(_e){ /* ignore */ }
  }
  function defaultMaxHoursForTask(teamId, taskId){
    try{
      const opts = getTeamTaskOptions(teamId) || [];
      const o = opts.find(x=>String(x.id)===String(taskId));
      const label = String((o && (o.label||o.id)) || taskId || '');
      if(window.GraphPanel && GraphPanel.getTaskLayout){
        const layout = GraphPanel.getTaskLayout(label);
        if(layout && Number.isFinite(layout.maxHours)) return layout.maxHours;
      }
      if(label.toLowerCase().includes('mailbox')) return 24;
      if(label.toLowerCase().includes('call')) return 24;
      if(label.toLowerCase().includes('back')) return 16;
      if(label.toLowerCase().includes('lunch')) return 8;
    }catch(_e){ /* ignore */ }
    return 20;
  }

  function wireTaskSettingsModal(){
    const openBtn = wrap.querySelector('#taskSettingsBtn');
    const modal = wrap.querySelector('#taskSettingsModal');
    const body = wrap.querySelector('#taskSettingsBody');
    const closeBtn = wrap.querySelector('#taskSettingsClose');
    const cancelBtn = wrap.querySelector('#taskSettingsCancel');
    const saveBtn = wrap.querySelector('#taskSettingsSave');

    if(!openBtn || !modal || !body) return;

    let draft = null;
    let originEl = null;

    const close = ()=>{
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden','true');
      draft = null;
      try{ window.removeEventListener('keydown', onKey, true); }catch(_e){}
      // Restore focus for enterprise accessibility
      try{
        const t = originEl || openBtn;
        if(t && typeof t.focus === 'function') t.focus();
      }catch(_e){}
      originEl = null;
    };

    const getFocusable = ()=>{
      const sel = [
        'button',
        '[href]',
        'input',
        'select',
        'textarea',
        '[tabindex]:not([tabindex="-1"])'
      ].join(',');
      const els = Array.from(modal.querySelectorAll(sel));
      return els.filter(el=>{
        if(!el) return false;
        if(el.disabled) return false;
        // ignore hidden
        const style = window.getComputedStyle(el);
        if(style && (style.display === 'none' || style.visibility === 'hidden')) return false;
        // offsetParent null for display:none (except fixed); allow if still in modal
        if(el.offsetParent === null && !modal.contains(el)) return false;
        return true;
      });
    };

    const onKey = (e)=>{
      if(e.key === 'Escape'){
        e.preventDefault();
        close();
        return;
      }
      // Focus trap (Tab/Shift+Tab)
      if(e.key === 'Tab'){
        const items = getFocusable();
        if(!items.length){
          e.preventDefault();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;

        if(e.shiftKey){
          if(active === first || !modal.contains(active)){
            e.preventDefault();
            last.focus();
          }
        }else{
          if(active === last){
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    const open = ()=>{
      const team = Config.teamById(selectedTeamId);
      if(!team) return;
      originEl = document.activeElement;
      modal.classList.add('open');
      modal.setAttribute('aria-hidden','false');

      const opts = (getTeamTaskOptions(team.id) || []).filter(o=>o && o.id && String(o.id) !== '__clear__');
      const map = loadTaskMaxHoursMap(team.id);
      draft = Object.assign({}, map);

      const rows = opts.map(o=>{
        const meta = taskMeta(team.id, o.id) || {};
        const label = meta.label || o.label || o.id;
        const color = meta.color || fallbackColorForLabel(label);
        const cur = Number(draft[String(o.id)]);
        const value = (Number.isFinite(cur) && cur > 0) ? cur : defaultMaxHoursForTask(team.id, o.id);

        return `
          <div class="ts-row">
            <div class="ts-left">
              <span class="ts-dot" style="background:${UI.esc(color)}"></span>
              <div class="ts-name">${UI.esc(label)}</div>
            </div>
            <input class="input ts-input" data-taskid="${UI.esc(o.id)}" type="number" min="1" step="1" value="${UI.esc(String(value))}" aria-label="Max hours for ${UI.esc(label)}" />
          </div>
        `;
      }).join('');

      body.innerHTML = `
        <div class="task-settings-grid">
          ${rows || '<div class="small text-zinc-400">No tasks found for this team.</div>'}
        </div>
        <div class="small text-zinc-400 mt-3">Saved locally per team. Changes update progress bars and graph tools.</div>
      `;

      body.querySelectorAll('.ts-input').forEach(inp=>{
        inp.addEventListener('input', ()=>{
          const tid = String(inp.getAttribute('data-taskid')||'').trim();
          const v = Number(inp.value);
          if(!tid) return;
          if(Number.isFinite(v) && v > 0) draft[tid] = Math.round(v*10)/10;
          else delete draft[tid];
        });
      });

      // Focus first field
      const first = body.querySelector('.ts-input');
      if(first) first.focus();

      try{ window.addEventListener('keydown', onKey, true); }catch(_e){}
    };

    // Open
    if(!openBtn.dataset.bound){
      openBtn.dataset.bound = '1';
      openBtn.addEventListener('click', open);
    }

    // Close buttons
    const bindClose = (b)=>{
      if(!b || b.dataset.bound) return;
      b.dataset.bound = '1';
      b.addEventListener('click', close);
    };
    bindClose(closeBtn);
    bindClose(cancelBtn);

    // Save
    if(saveBtn && !saveBtn.dataset.bound){
      saveBtn.dataset.bound = '1';
      saveBtn.addEventListener('click', ()=>{
        const team = Config.teamById(selectedTeamId);
        if(!team) return close();
        saveTaskMaxHoursMap(team.id, draft || {});
        // Rerender UI that depends on max-hours
        try{ renderAll(); }catch(_e){}
        try{ if(graphEnabled) renderGraphPanel(); }catch(_e){}
        close();
      });
    }

    // Backdrop click closes
    if(!modal.dataset.bound){
      modal.dataset.bound = '1';
      modal.addEventListener('mousedown', (e)=>{
        if(e.target === modal) close();
      });
    }
  }

  function wireAutoAssignBtn(){
    const btn = wrap.querySelector('#autoAssignBtn');
    if(!btn || btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', ()=>{
      const auto = wrap.querySelector('#autoSchedule');
      if(auto) auto.click();
    });
  }


  

  // Initial sync for toolbar controls.
  syncTimelineToolbarUI();
  wireInspectorTabs();
  wireTaskSettingsModal();
  wireAutoAssignBtn();



  // Selection tools
  const selClearBtn = wrap.querySelector('#selClear');
  const selDeselectBtn = wrap.querySelector('#selDeselect');

  async function deleteSelectedBlocks(opts){
    const o = Object.assign({ confirm: true }, opts||{});
    if(!selMemberId || selIdx.size===0) return;
    const member = Store.getUsers().find(u=>u.id===selMemberId);
    if(!member || !canEditTarget(member)) return;
    const team = Config.teamById(member.teamId);
    if(guardScheduleEditLocked(selectedTeamId, selectedDay)) return;
    const blocks = normalizeBlocks(team, Store.getUserDayBlocks(member.id, selectedDay), { locked: isScheduleEditLocked(selectedTeamId, selectedDay) });
    const idxs = Array.from(selIdx).filter(i=>blocks[i]).sort((a,b)=>a-b);
    if(!idxs.length) return;
    if(o.confirm){
      const ok = await UI.confirm({ title:'Delete Selected Blocks', message:`Delete ${idxs.length} selected block(s) for ${member.name||member.username} on ${UI.DAYS[selectedDay]}?`, okText:'Delete', danger:true });
      if(!ok) return;
    }

    const keep = blocks.filter((_,i)=>!selIdx.has(i));
    try{
      Store.setUserDayBlocks(member.id, member.teamId, selectedDay, keep);
    }catch(err){
      showWarning(readableError(err, 'Unable to delete block. Please try again.'));
      return;
    }
    requestGraphRefresh();

    const actor = Auth.getUser();
    if(actor) Store.addLog({
      ts: Date.now(), teamId: member.teamId,
      actorId: actor.id, actorName: actor.name||actor.username,
      action: 'SCHEDULE_DELETE',
      targetId: member.id, targetName: member.name||member.username,
      msg: `${actor.name||actor.username} deleted ${idxs.length} block(s) for ${member.name||member.username}`,
      detail: `${UI.DAYS[selectedDay]}`
    });
    addAudit('SCHEDULE_DELETE', member.id, member.name||member.username, `${UI.DAYS[selectedDay]} deleted ${idxs.length} block(s)`);

    clearSelection();
    // Render immediately (no timers) to make Delete-key feel instantaneous.
    renderAll();
  }
  async function clearAllBlocksForMemberDay(){
    // Bulk clear: if multiple members are selected via checkboxes, clear all of them.
    const ids = (selMemberIds && selMemberIds.size) ? Array.from(selMemberIds) : (selMemberId ? [selMemberId] : []);
    if(!ids.length) return;
    const users = Store.getUsers();
    const members = ids.map(id=>users.find(u=>u.id===id)).filter(Boolean);
    if(!members.length) return;

    // Schedule lock enforcement: unlocking required before bulk schedule edits
    if([1,2,3,4,5].some(d=>isScheduleEditLocked(selectedTeamId, d))){
      warnScheduleLocked();
      return;
    }

    // Confirm message
    const label = members.length===1 ? (members[0].name||members[0].username) : `${members.length} members`;
    const ok = await UI.confirm({ title:'Clear All Schedule Blocks', message:`Clear ALL blocks for ${label} (Sun–Sat)?`, detail:`Executing Clear All will delete all existing assigned schedule blocks from Sun to Sat tabs for the selected member(s). This cannot be undone.`, okText:'Clear All', danger:true });
    if(!ok) return;

    for(const member of members){
      for(let d=0; d<=6; d++){
        if(isDayLockedForEdit(member.teamId, d)) continue;
        Store.setUserDayBlocks(member.id, member.teamId, d, []);
    requestGraphRefresh();
      }
      const actor = Auth.getUser();
      if(actor) Store.addLog({
        ts: Date.now(), teamId: member.teamId,
        actorId: actor.id, actorName: actor.name||actor.username,
        action: 'SCHEDULE_CLEAR_ALL',
        targetId: member.id, targetName: member.name||member.username,
        msg: `${actor.name||actor.username} cleared ALL blocks for ${member.name||member.username}`,
        detail: `Sun–Sat`
      });
      addAudit('SCHEDULE_CLEAR_ALL', member.id, member.name||member.username, `Sun–Sat cleared all blocks`);
    }

    clearSelection();
    renderAll();
  }


  // Deselect (requested behavior) = delete the specific selected blocks
  if(selDeselectBtn) selDeselectBtn.onclick = deleteSelectedBlocks;

  // Clear = clear all blocks for the selected member/day (confirm required)
  if(selClearBtn) selClearBtn.onclick = clearAllBlocksForMemberDay;

// Auto-schedule settings (per team/shift)
  function defaultAutoSettings(team){
    return {
      mailboxSegmentHours: 3,
      mailboxSingle: true,
      callMinPerHour: 2,
      lunchStart: '10:00',
      lunchEnd: '13:00',
      lunchOverlapMax: 2,
      lunchDurationMin: 60,
      backOfficeMaxHoursPerMember: 2,
    };
  }

  function getAutoSettingsForTeam(teamId){
    const team = Config.teamById(teamId);
    const base = defaultAutoSettings(team);
    const saved = Store.getTeamAutoSettings ? Store.getTeamAutoSettings(teamId) : null;
    return { ...base, ...(saved||{}) };
  }
  function renderAutoSettingsModal(initialTeamId){
    const existing = document.getElementById('autoSettingsModal');
    if(existing) existing.remove();

    // Permissions:
    // - SUPER_ADMIN / ADMIN can edit coverage parameters for any team
    // - TEAM_LEAD can edit only their own team (other teams appear disabled)
    const canEditAllTeams = !!(isSuper || isAdmin);

    let activeTeamId = String(initialTeamId || selectedTeamId || (me && me.teamId) || '').trim();
    if(!activeTeamId) activeTeamId = (Config.TEAMS && Config.TEAMS[0] ? Config.TEAMS[0].id : 'A');

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'autoSettingsModal';

    const buildPanel = (teamId)=>{
      const team = Config.teamById(teamId);
      const s = getAutoSettingsForTeam(team.id);

      const teamOpts = (Config.TEAMS||[]).map(t=>{
        const disabled = (!canEditAllTeams && t.id !== (me && me.teamId)) ? 'disabled' : '';
        const sel = t.id===teamId ? 'selected' : '';
        return `<option value="${UI.esc(t.id)}" ${sel} ${disabled}>${UI.esc(t.label)}</option>`;
      }).join('');

      const canEditThisTeam = canEditAllTeams || (me && me.teamId===team.id);
      const teamNote = canEditThisTeam ? '' : ' (read-only)';

      return `
      <div class="panel">
        <div class="head">
          <div>
            <div class="announce-title">Auto Schedule Settings</div>
            <div class="small">Configure criteria for: <b>${UI.esc(team.label)}</b>${teamNote}</div>
          </div>
          <button class="btn ghost" type="button" id="asClose">✕</button>
        </div>

        <div class="body grid gap-3">
          <div class="grid2">
            <div>
              <label class="small">Team</label>
              <select class="input" id="asTeam">${teamOpts}</select>
            </div>
            <div>
              <label class="small">Call Available minimum active per hour</label>
              <input class="input" id="asCallMin" type="number" min="1" max="10" value="${s.callMinPerHour}" />
            </div>
          </div>

          <div class="grid2">
            <div>
              <label class="small">Mailbox segment hours (minimum)</label>
              <input class="input" id="asMailboxHours" type="number" min="1" max="9" value="${s.mailboxSegmentHours}" />
            </div>
            <div>
              <label class="small">Back Office max hours per member (per day)</label>
              <input class="input" id="asBackMax" type="number" min="0" max="9" value="${s.backOfficeMaxHoursPerMember}" />
            </div>
          </div>

          <div class="grid2">
            <div>
              <label class="small">Lunch window start</label>
              <input class="input" id="asLunchStart" type="time" value="${s.lunchStart}" />
            </div>
            <div>
              <label class="small">Lunch window end</label>
              <input class="input" id="asLunchEnd" type="time" value="${s.lunchEnd}" />
            </div>
          </div>

          <div class="grid2">
            <div>
              <label class="small">Lunch max overlap (members at same time)</label>
              <input class="input" id="asLunchOverlap" type="number" min="1" max="5" value="${s.lunchOverlapMax}" />
            </div>
            <div class="small muted self-end">
              <div><b>1-hour grid only</b> (no minutes). Drag/paint assigns whole hours.</div>
              <div>Coverage is evaluated per-hour grid.</div>
            </div>
          </div>

          <div class="row justify-end gap-3 mt-2">
            <button class="btn" type="button" id="asCancel">Cancel</button>
            <button class="btn primary" type="button" id="asSave" ${canEditThisTeam?'':'disabled'}>Save Settings</button>
          </div>
        </div>
      </div>
      `;
    };

    modal.innerHTML = buildPanel(activeTeamId);
    document.body.appendChild(modal);

    const close = ()=>{ modal.classList.remove('open'); modal.remove(); };
    const bind = ()=>{
      const btnClose = modal.querySelector('#asClose');
      const btnCancel = modal.querySelector('#asCancel');
      if(btnClose) btnClose.onclick = close;
      if(btnCancel) btnCancel.onclick = close;

      const teamSel = modal.querySelector('#asTeam');
      if(teamSel){
        teamSel.onchange = ()=>{
          activeTeamId = String(teamSel.value||'').trim() || activeTeamId;
          modal.innerHTML = buildPanel(activeTeamId);
          bind();
        };
      }

      const btnSave = modal.querySelector('#asSave');
      if(btnSave) btnSave.onclick = ()=>{
        const team = Config.teamById(activeTeamId);
        const canEditThisTeam = canEditAllTeams || (me && me.teamId===team.id);
        if(!canEditThisTeam){
          alert('You do not have permission to edit Coverage Meter parameters for this team.');
          return;
        }
        const settings = {
          mailboxSegmentHours: Math.max(1, Number(modal.querySelector('#asMailboxHours').value||3)),
          mailboxSingle: true,
          callMinPerHour: Math.max(1, Number(modal.querySelector('#asCallMin').value||2)),
          lunchStart: String(modal.querySelector('#asLunchStart').value||'10:00'),
          lunchEnd: String(modal.querySelector('#asLunchEnd').value||'13:00'),
          lunchOverlapMax: Math.max(1, Number(modal.querySelector('#asLunchOverlap').value||2)),
          lunchDurationMin: 60,
          backOfficeMaxHoursPerMember: Math.max(0, Number(modal.querySelector('#asBackMax').value||2)),
        };
        if(Store.setTeamAutoSettings) Store.setTeamAutoSettings(team.id, settings);
        const actor = Auth.getUser();
        if(actor) Store.addLog({ ts: Date.now(), teamId: team.id, actorId: actor.id, actorName: actor.name||actor.username, action: 'AUTO_SETTINGS', targetId: team.id, targetName: team.label, msg: `${actor.name||actor.username} updated auto-schedule settings for ${team.label}`, detail: JSON.stringify(settings) });
        close();
        alert('Auto schedule settings saved.');
      };
    };

    modal.classList.add('open');
    bind();
  }


  const autoSettingsBtn = wrap.querySelector('#autoSettings');
  if(autoSettingsBtn){
    autoSettingsBtn.onclick = ()=>{
      if(!Config.can(me,'manage_users') && !Config.can(me,'manage_members')){}
      renderAutoSettingsModal();
    };
  }


  // Auto scheduling (Mon–Fri) to balance responsibilities
  function computeAutoPlans(team, members){
    const plans = {};
    for(let day=1; day<=5; day++){
      const iso = isoForDay(day);
      const avail = (members||[]).filter(m=>{
        const leave = Store.getLeave ? Store.getLeave(m.id, iso) : null;
        const rest = isRestDay(m.teamId, m.id, iso);
        return !(leave || rest);
      });
      plans[String(day)] = buildAutoPlan(team, avail, day);
    }
    return plans; // {"1": {userId:[blocks]}, ... "5": ...}
  }

  function applyPlansAndLock(team, members, plans){
    // apply
    for(let day=1; day<=5; day++){
      const plan = plans[String(day)] || {};
      for(const u of members){
        Store.setUserDayBlocks(u.id, u.teamId, day, plan[u.id] || []);
    requestGraphRefresh();
      }
    }
    // lock Mon–Fri for this Manila week
    const actor = Auth.getUser();
    const lockObj = {
      lockedDays: {"1":true,"2":true,"3":true,"4":true,"5":true},
      lockedAt: Date.now(),
      lockedBy: actor ? actor.id : null,
      lockedByName: actor ? (actor.name||actor.username) : 'System'
    };
    if(Store.setLock) Store.setLock(team.id, weekStartISO, lockObj);
    if(actor) Store.addLog({
      ts: Date.now(), teamId: team.id,
      actorId: actor.id, actorName: actor.name||actor.username,
      action: 'AUTO_SCHEDULE_APPLY_LOCK',
      targetId: team.id, targetName: team.label,
      msg: `${actor.name||actor.username} approved auto schedule and locked Mon–Fri for ${team.label}`,
      detail: `WeekStart ${weekStartISO}`
    });
    addAudit('AUTO_SCHEDULE_APPLY_LOCK', team.id, team.label, `Locked Mon–Fri for week of ${weekStartISO}`);
  }

  function hourCoverage(team, members, planMap){
    const meta = UI.shiftMeta(team);
    const step = GRID_STEP_MIN;
    const slots = Math.floor(meta.length/step);
    // build per-member slot role (min resolution)
    const slotRole = {};
    for(const u of members){
      const roles = Array(slots).fill(null);
      const bl = (planMap && planMap[u.id]) ? planMap[u.id] : [];
      for(const b of bl){
        const s = Math.max(0, Math.min(slots, Math.floor(UI.offsetFromShiftStart(team, b.start)/step)));
        const e = Math.max(0, Math.min(slots, Math.ceil(UI.offsetFromShiftStart(team, b.end)/step)));
        for(let i=s;i<e;i++) roles[i] = b.role;
      }
      slotRole[u.id] = roles;
    }
    const hours = Math.ceil(meta.length/step);
    const out = [];
    for(let h=0; h<hours; h++){
      const from = h;
      const to = Math.min(slots, from+1);
      let mailboxMin = 999, callMin = 999;
      for(let i=from;i<to;i++){
        let mailbox=0, call=0;
        for(const u of members){
          const r = slotRole[u.id][i];
          if(r==='mailbox_manager' || r==='mailbox_call') mailbox++;
          const cfg = (window.Store && Store.getTeamConfig) ? Store.getTeamConfig(team.id) : null;
          const callRole = (cfg && cfg.coverageTaskId) ? cfg.coverageTaskId : 'call_onqueue';
          if(r===callRole || r==='call_available' || r==='mailbox_call') call++;
        }
        mailboxMin = Math.min(mailboxMin, mailbox);
        callMin = Math.min(callMin, call);
      }
      const hm = UI.offsetToHM(team, h*step);
      out.push({ label: to12h(hm), mailboxMin: (mailboxMin===999?0:mailboxMin), callMin: (callMin===999?0:callMin) });
    }
    return out;
  }

  function renderPreviewModal(team, members, plans){
    const s = getAutoSettingsForTeam(team.id);
    let day = 1;
    const existing = document.getElementById('autoPreviewModal');
    if(existing) existing.remove();
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'autoPreviewModal';
    modal.innerHTML = `
      <div class="panel max-w-5xl">
        <div class="head">
          <div>
            <div class="announce-title">Preview Auto Schedule</div>
            <div class="small">${UI.esc(team.label)} • Mon–Fri • Week of ${UI.esc(weekStartISO)} (Manila)</div>
          </div>
          <button class="btn ghost" type="button" id="apClose">✕</button>
        </div>
        <div class="body grid gap-3">
          <div class="daytabs" id="apTabs">
            ${['Mon','Tue','Wed','Thu','Fri'].map((t,i)=>`<button class="daytab ${i===0?'active':''}" data-day="${i+1}" type="button">${t}</button>`).join('')}
          </div>
          <div class="coverage-wrap">
            <div class="small muted mb-2">Coverage meter shows per-hour minimum counts (stricter). Mailbox should be 1 active; Call should be ≥ ${s.callMinPerHour} active.</div>
            <div id="apMeter"></div>
          </div>
          <div class="row justify-between items-center flex-wrap gap-3">
            <div class="small muted">Lunch window: ${UI.esc(s.lunchStart)}–${UI.esc(s.lunchEnd)} (max overlap ${s.lunchOverlapMax}); Back Office max ${s.backOfficeMaxHoursPerMember} hrs/member/day</div>
            <div class="row gap-3">
              <button class="btn" type="button" id="apCancel">Cancel</button>
              <button class="btn primary" type="button" id="apApply">Approve & Lock Mon–Fri</button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.classList.add('open');

    const close = ()=>{ modal.classList.remove('open'); modal.remove(); };
    modal.querySelector('#apClose').onclick = close;
    modal.querySelector('#apCancel').onclick = close;

    const renderMeter = ()=>{
      const cov = hourCoverage(team, members, plans[String(day)]);
      const meter = modal.querySelector('#apMeter');
      const targetCall = (s.callMinPerHour||2);
      const okCount = cov.reduce((a,c)=>a+((c.mailboxMin===1 && c.callMin>=targetCall)?1:0),0);
      const totalCount = cov.length || 1;
      const pctOk = Math.round((okCount/totalCount)*100);
      meter.innerHTML = `
        <div class="coverage-head mb-2">
          <div>
            <div class="coverage-title">Coverage Meter</div>
            <div class="coverage-sub">Mailbox target: <b>1</b>/hr • Call target: <b>≥ ${targetCall}</b>/hr • Values are per-hour <b>minimum</b>.</div>
          </div>
          <div class="coverage-kpis">
            <div class="kpi"><div class="kpi-label">OK hours</div><div class="kpi-val">${okCount}/${totalCount}</div></div>
            <div class="kpi"><div class="kpi-label">Health</div><div class="kpi-val">${pctOk}%</div></div>
          </div>
        </div>
        <div class="coverage-scroll">
          <div class="coverage-meter" aria-label="Coverage meter by hour">
            ${cov.map(c=>{
              const okMailbox = c.mailboxMin===1;
              const okCall = c.callMin >= targetCall;
              const cls = (okMailbox && okCall) ? 'ok' : 'bad';
              return `<div class="cm-col ${cls}" title="${UI.esc(c.label)}\nMailbox: ${c.mailboxMin}\nCall: ${c.callMin}">
                <div class="cm-label">${UI.esc(c.label)}</div>
                <div class="cm-bars">
                  <div class="cm-bar" data-kind="mailbox">M:${c.mailboxMin}</div>
                  <div class="cm-bar" data-kind="call">C:${c.callMin}</div>
                </div>
              </div>`;
            }).join('')}
          </div>
        </div>
      `;
    };

    modal.querySelectorAll('#apTabs .daytab').forEach(b=>{
      b.onclick = ()=>{
        day = Number(b.dataset.day);
        modal.querySelectorAll('#apTabs .daytab').forEach(x=>x.classList.remove('active'));
        b.classList.add('active');
        renderMeter();
      };
    });

    modal.querySelector('#apApply').onclick = async ()=>{
      const ok = await UI.confirm({ title:'Apply Auto Schedule', message:'Apply auto schedule for Mon–Fri and lock the week?', detail:'This will overwrite existing schedules for those days.', okText:'Apply', danger:true });
      if(!ok) return;
      applyPlansAndLock(team, members, plans);
      selectedDay = 1;
      renderDayTabs();
      renderAll();
      close();
      alert('Applied and locked Mon–Fri for this week.');
    };

    renderMeter();
  }

  const previewBtn = wrap.querySelector('#previewAuto');
  if(previewBtn){
    previewBtn.onclick = ()=>{
      const team = Config.teamById(selectedTeamId);
      const members = getMembersForView(selectedTeamId).filter(u=>u.role===Config.ROLES.MEMBER);
      if(members.length < 2){ alert('Auto scheduling needs at least 2 members in the team.'); return; }
      const lock = getTeamLock(team.id);
      if(lock && lock.lockedDays && [1,2,3,4,5].some(d=>lock.lockedDays[String(d)])){
        alert('This week is locked. Unlock first to preview/apply again.');
        return;
      }
      const plans = computeAutoPlans(team, members);
      renderPreviewModal(team, members, plans);
    };
  }

  const autoBtn = wrap.querySelector('#autoSchedule');
  if(autoBtn){
    autoBtn.onclick = ()=>{
      // Direct apply is supported, but we encourage preview
      const team = Config.teamById(selectedTeamId);
      const members = getMembersForView(selectedTeamId).filter(u=>u.role===Config.ROLES.MEMBER);
      if(members.length < 2){ alert('Auto scheduling needs at least 2 members in the team.'); return; }
      const lock = getTeamLock(team.id);
      if(lock && lock.lockedDays && [1,2,3,4,5].some(d=>lock.lockedDays[String(d)])){
        alert('This week is locked. Unlock first to apply again.');
        return;
      }
      const plans = computeAutoPlans(team, members);
      renderPreviewModal(team, members, plans);
    };
  }

  const unlockBtn = wrap.querySelector('#unlockSchedule');
  if(unlockBtn){
    unlockBtn.onclick = async ()=>{
      const team = Config.teamById(selectedTeamId);
      // Team Leads can unlock for their team; Admin/Super can unlock any team.
      if(!(isLead||isAdmin||isSuper)) return;
      if(isLead && team.id !== me.teamId) return;
      const ok = await UI.confirm({ title:'Unlock Week', message:`Unlock Mon–Fri for ${team.label} (week of ${weekStartISO})?`, okText:'Unlock', danger:true });
      if(!ok) return;
      // Allow immediate edits right after unlock click (prevents stale-lock race conditions)
      unlockTriggered = true;
      if(Store.clearLock) Store.clearLock(team.id, weekStartISO);
      setTimeout(()=>{ unlockTriggered = false; }, 1200);
      const actor = Auth.getUser();
      if(actor) Store.addLog({ ts: Date.now(), teamId: team.id, actorId: actor.id, actorName: actor.name||actor.username, action: 'SCHEDULE_UNLOCK', targetId: team.id, targetName: team.label, msg: `${actor.name||actor.username} unlocked Mon–Fri schedules for ${team.label}`, detail: `WeekStart ${weekStartISO}` });
      addAudit('SCHEDULE_UNLOCK', team.id, team.label, `Unlocked Mon–Fri for week of ${weekStartISO}`);
      renderDayTabs();
      renderAll();
    };
  }


  // Build per-day plan map: { [userId]: [blocks...] }
  function buildAutoPlan(team, members, dayIndex){
    const s = getAutoSettingsForTeam(team.id);
    const meta = UI.shiftMeta(team);
    const step = GRID_STEP_MIN;
    const slots = Math.floor(meta.length / step);
    const slotsPerHour = 60 / step;

    const slotRole = {};
    const mins = {};
    members.forEach(u=>{
      slotRole[u.id] = Array(slots).fill(null);
      mins[u.id] = { mailbox:0, call:0, back:0, lunch:0 };
    });

    // 1) Mailbox coverage: one member at a time, start of shift, segments of mailboxSegmentHours
    const segMin = Math.max(step, Math.round((Number(s.mailboxSegmentHours||3)*60)/step)*step);
    const segSlots = Math.max(1, segMin/step);
    let cur = 0;
    let segIdx = 0;
    while(cur < slots){
      const end = Math.min(slots, cur + segSlots);
      const m = members[(segIdx + (dayIndex||0)) % members.length];
      for(let i=cur;i<end;i++){
        slotRole[m.id][i] = 'mailbox_manager';
      }
      mins[m.id].mailbox += (end-cur)*step;
      cur = end;
      segIdx++;
    }

    // 2) Lunch: 1 hour between lunchStart-lunchEnd, max overlap lunchOverlapMax, avoid mailbox slots if possible
    const lunchSlots = Math.max(1, Math.round((Number(s.lunchDurationMin||60))/step));
    const offStart = Math.max(0, Math.min(slots-1, Math.round(UI.offsetFromShiftStart(team, s.lunchStart)/step)*step/step));
    const offEnd = Math.max(0, Math.min(slots, Math.round(UI.offsetFromShiftStart(team, s.lunchEnd)/step)*step/step));
    const winStart = max(0, min(slots-lunchSlots, offStart));
    const winEnd = max(winStart + lunchSlots, min(slots, offEnd));
    const maxOverlap = Math.max(1, Number(s.lunchOverlapMax||2));
    const lunchCount = Array(slots).fill(0);

    // helper functions in JS string will be defined below
    function canPlaceLunch(memberId, st){
      for(let i=st;i<st+lunchSlots;i++){
        if(i<0 || i>=slots) return false;
        if(lunchCount[i] >= maxOverlap) return false;
        // avoid replacing mailbox_manager
        if(slotRole[memberId][i] === 'mailbox_manager') return false;
      }
      return true;
    }
    function placeLunch(memberId, st){
      for(let i=st;i<st+lunchSlots;i++){
        slotRole[memberId][i] = 'lunch';
        lunchCount[i] += 1;
      }
      mins[memberId].lunch += lunchSlots*step;
    }

    // Spread lunches; rotate order for fairness
    const order = members.slice();
    const rot = (dayIndex||0) % order.length;
    const lunchOrder = order.slice(rot).concat(order.slice(0, rot));
    for(let k=0;k<lunchOrder.length;k++){
      const u = lunchOrder[k];
      let chosen = -1;
      // stagger start in window
      const base = winStart + ((k*2) % max(1, (winEnd-winStart-lunchSlots+1)));
      for(let attempt=0; attempt< (winEnd-winStart+1); attempt++){
        const st = winStart + ((base - winStart + attempt) % max(1,(winEnd-winStart-lunchSlots+1)));
        if(canPlaceLunch(u.id, st)) { chosen = st; break; }
      }
      if(chosen >= 0) placeLunch(u.id, chosen);
    }

    // 3) Call coverage: ensure at least callMinPerHour active per hour
    const callMin = Math.max(1, Number(s.callMinPerHour||2));
    for(let i=0;i<slots;i++){
      let callCount = 0;
      for(const u of members){ if(slotRole[u.id][i] === 'call_onqueue') callCount++; }
      while(callCount < callMin){
        // pick available member with least call minutes
        let best = null;
        for(const u of members){
          const r = slotRole[u.id][i];
          if(r === null){
            if(!best || mins[u.id].call < mins[best.id].call) best = u;
          }
        }
        if(!best) break;
        slotRole[best.id][i] = 'call_onqueue';
        mins[best.id].call += step;
        callCount++;
      }
    }

    // 4) Back Office fill: limit backOfficeMaxHoursPerMember per member per day
    const backMax = Math.max(0, Number(s.backOfficeMaxHoursPerMember||2)) * 60;
    for(const u of members){
      if(backMax <= 0) continue;
      for(let i=0;i<slots;i++){
        if(slotRole[u.id][i] === null && mins[u.id].back < backMax){
          slotRole[u.id][i] = 'back_office';
          mins[u.id].back += step;
        }
      }
    }

    // 5) Remaining empty time -> call_onqueue (keeps coverage and balances)
    for(const u of members){
      for(let i=0;i<slots;i++){
        if(slotRole[u.id][i] === null){
          slotRole[u.id][i] = 'call_onqueue';
          mins[u.id].call += step;
        }
      }
    }

    // Convert slots -> merged blocks
    const out = {};
    for(const u of members){
      const arr = slotRole[u.id];
      const blocks = [];
      let curRole = arr[0];
      let st = 0;
      for(let i=1;i<=slots;i++){
        const r = (i<slots) ? arr[i] : null;
        if(r != curRole){
          if(curRole){
            const startHM = UI.offsetToHM(team, st*step);
            const endHM = UI.offsetToHM(team, i*step);
            blocks.push({ start: startHM, end: endHM, role: curRole });
          }
          curRole = r;
          st = i;
        }
      }
      out[u.id] = blocks;
    }

    return out;

    function max(a,b){ return a>b?a:b; }
    function min(a,b){ return a<b?a:b; }
  }
  function getMembersForView(teamId){
    const users = Store.getUsers();
    // Members page is only for MEMBER schedules
    return users.filter(u=>{
      if(u.role !== Config.ROLES.MEMBER) return false;
      if(isLead) return u.teamId === me.teamId;
      return u.teamId === teamId;
    }).sort((a,b)=>String(a.name||a.username).localeCompare(String(b.name||b.username)));
  }

  function canEditTarget(member){
    if(!member) return false;
    if(isSuper || isAdmin) return Config.can(me, 'manage_members_scheduling') || Config.can(me, 'manage_users') || Config.can(me, 'manage_members');
    if(isLead) return (member.teamId === me.teamId) && Config.can(me, 'manage_members_scheduling');
    return false;
  }

  function timelineHeaderHtml(team){
    const meta = UI.shiftMeta(team);
    // show hour markers
    const markers = [];
    const startMin = meta.start;
    const total = meta.length;
    for(let off = 0; off <= total; off += 60){
      const pct = (off/total)*100;
      let absoluteMin = startMin + off;
      absoluteMin = absoluteMin % (24*60);
      const hh = String(Math.floor(absoluteMin/60)).padStart(2,'0');
      const mm = String(absoluteMin%60).padStart(2,'0');
      markers.push(`<div class="tl-mark" style="left:${pct}%"><span>${hh}:${mm}</span></div>`);
    }
    return `<div class="tl-header">${markers.join('')}</div>`;
  }

  function blockLabel(roleId){
    const s = Config.scheduleById(roleId);
    if(s) return s.label;
    try{
      const tasks = Store.getTeamTasks(selectedTeamId) || [];
      const t = tasks.find(x=>x.id===roleId);
      if(t && t.label) return t.label;
    }catch(_){}
    return roleId;
  }

  function normalizeBlocks(team, blocks, opts){
    const meta = UI.shiftMeta(team);

    function isHourAligned(hm){
      const m = UI.parseHM(hm);
      return Number.isFinite(m) && (m % 60) === 0;
    }
    const clean = (blocks||[]).map(b=>({
      start: String(b.start||'').slice(0,5),
      end: String(b.end||'').slice(0,5),
      role: String(b.role||'block'),
      locked: !!(opts && opts.locked)
    })).filter(b=>b.start && b.end && isHourAligned(b.start) && isHourAligned(b.end));

    // sort by start offset
    clean.sort((a,b)=>UI.offsetFromShiftStart(team,a.start) - UI.offsetFromShiftStart(team,b.start));

    // validate within shift range and no overlaps
    const out = [];
    let lastEnd = -1;
    for(const b of clean){
      // Strict hour grid: reject any non-:00 times
      if(!isHourAligned(b.start) || !isHourAligned(b.end)) continue;
      const s = UI.offsetFromShiftStart(team,b.start);
      const e = UI.offsetFromShiftStart(team,b.end);
      if(e <= s) continue;
      if(((e - s) % GRID_STEP_MIN) !== 0) continue;
      if((e - s) < GRID_STEP_MIN) continue;
      if(s < 0 || e > meta.length) continue;
      if(s < lastEnd) continue;
      out.push(b);
      lastEnd = e;
    }
    return out;
  }

  function openEditModal(member){
    if(!member) return;
    if(guardScheduleEditLocked(selectedTeamId, selectedDay)) return;
    const modal = wrap.querySelector('#memberSchedModal');
    const body = wrap.querySelector('#msBody');
    const title = wrap.querySelector('#msTitle');
    const sub = wrap.querySelector('#msSub');
    const close = wrap.querySelector('#msClose');

    const team = Config.teamById(member.teamId);
    const meta = UI.shiftMeta(team);
    const blocks = Store.getUserDayBlocks(member.id, selectedDay);

    title.textContent = `Scheduling: ${member.name||member.username}`;
    sub.textContent = `${Config.teamById(member.teamId).label} • ${UI.DAYS[selectedDay]} • Shift ${team.teamStart}–${team.teamEnd}`;

    function rowHtml(b, idx){
      const options = Object.keys(Config.SCHEDULES).map(k=>{
        const s = Config.SCHEDULES[k];
        const sel = b.role===k ? 'selected' : '';
        return `<option value="${s.id}" ${sel}>${UI.esc(s.label)}</option>`;
      }).join('');
      return `
        <div class="ms-row" data-idx="${idx}">
          <input class="input" type="time" step="3600" data-field="start" value="${UI.esc(b.start)}">
          <input class="input" type="time" step="3600" data-field="end" value="${UI.esc(b.end)}">
          <select class="input" data-field="role">${options}</select>
          <button class="btn danger" type="button" data-act="del">Delete</button>
        </div>
      `;
    }

    function renderModal(){
      const list = normalizeBlocks(team, Store.getUserDayBlocks(member.id, selectedDay), { locked: isScheduleEditLocked(selectedTeamId, selectedDay) });
      body.innerHTML = `
        <div class="muted small mb-2">Blocks must be inside the shift window, must not overlap, and must be aligned to the hour (<b>:00</b>) in 1-hour increments.</div>
        <div class="ms-grid" id="msGrid">
          ${list.map(rowHtml).join('')}
        </div>
        <div class="row gap-3 justify-between flex-wrap mt-3">
          <button class="btn" type="button" id="msAdd">Add Block</button>
          <div class="row gap-2 flex-wrap">
            <button class="btn" type="button" id="msCancel">Cancel</button>
            <button class="btn primary" type="button" id="msSave">Save</button>
          </div>
        </div>
        <div class="err hidden mt-3" id="msErr"></div>
      `;

      const grid = body.querySelector('#msGrid');
      grid.addEventListener('click', (e)=>{
        const btn = e.target.closest('button');
        if(!btn) return;
        if(btn.dataset.act==='del'){
          if(guardScheduleEditLocked(selectedTeamId, selectedDay)) return;
          const row = btn.closest('.ms-row');
          const idx = Number(row.dataset.idx);
          const cur = Store.getUserDayBlocks(member.id, selectedDay).slice();
          cur.splice(idx,1);
          Store.setUserDayBlocks(member.id, member.teamId, selectedDay, cur);
    requestGraphRefresh();
          renderModal();
          renderAll();
        }
      });

      body.querySelectorAll('.ms-row').forEach(row=>{
        row.addEventListener('change', ()=>{
          if(guardScheduleEditLocked(selectedTeamId, selectedDay)) return;
          const idx = Number(row.dataset.idx);
          const cur = Store.getUserDayBlocks(member.id, selectedDay).slice();
          const start = row.querySelector('[data-field="start"]').value;
          const end = row.querySelector('[data-field="end"]').value;
          const role = row.querySelector('[data-field="role"]').value;
          cur[idx] = { start, end, role };
          Store.setUserDayBlocks(member.id, member.teamId, selectedDay, cur);
    requestGraphRefresh();
        });
      });

      body.querySelector('#msAdd').addEventListener('click', ()=>{
        const cur = Store.getUserDayBlocks(member.id, selectedDay).slice();
        // default one-hour block at shift start
        const defaultStart = team.teamStart;
        const sMin = UI.offsetFromShiftStart(team, defaultStart);
        const eMin = Math.min(meta.length, sMin + 60);
        // convert back to absolute clock time
        const absStart = UI.parseHM(team.teamStart);
        const absNewStart = (absStart + sMin) % (24*60);
        const absNewEnd = (absStart + eMin) % (24*60);
        const toHM = (m)=>String(Math.floor(m/60)).padStart(2,'0') + ':' + String(m%60).padStart(2,'0');
        cur.push({ start: toHM(absNewStart), end: toHM(absNewEnd), role: 'block' });
        Store.setUserDayBlocks(member.id, member.teamId, selectedDay, cur);
    requestGraphRefresh();
        renderModal();
        renderAll();
      });

      body.querySelector('#msCancel').addEventListener('click', ()=>UI.closeModal('memberSchedModal'));

      body.querySelector('#msSave').addEventListener('click', ()=>{
        const err = body.querySelector('#msErr');
        const cur = Store.getUserDayBlocks(member.id, selectedDay);
        const normalized = normalizeBlocks(team, cur);
        if(normalized.length !== cur.length){
          err.style.display = 'block';
          err.textContent = 'Some blocks were invalid (overlap, outside shift, or end before start). Fix times then save again.';
          return;
        }
        err.style.display = 'none';
        Store.setUserDayBlocks(member.id, member.teamId, selectedDay, normalized);
    requestGraphRefresh();
        UI.closeModal('memberSchedModal');
        renderAll();
      });
    }

    close.onclick = ()=>UI.closeModal('memberSchedModal');
    renderModal();
    UI.openModal('memberSchedModal');
  }

  function renderAll(){
    // Preserve selection across rerenders (avoid stale blocks when context changes).
    const ctxKey = `${selectedTeamId||''}|${weekStartISO||''}|${selectedDay||''}`;
    const ctxChanged = (wrap._lastSelectionCtxKey && wrap._lastSelectionCtxKey !== ctxKey);
    wrap._lastSelectionCtxKey = ctxKey;

    const prevSelMemberId = selMemberId;
    const prevSelIdx = new Set(selIdx);
    const prevSelMemberIds = new Set(selMemberIds);

    if(ctxChanged){
      // Keep member selection (if possible) but drop block selection.
      selIdx = new Set();
      selMemberIds = new Set();
    }
    renderWeekWarning();
    const team = Config.teamById(selectedTeamId);
    // Sort: active members always at the top. Inactive (rest/leave) go below.
    // Active = not on rest day and not on any leave for the selected Manila date.
    const isoDateForSort = isoForDay(selectedDay);
    const members = getMembersForView(selectedTeamId)
      .slice()
      .sort((a,b)=>{
        const aLeave = Store.getLeave ? Store.getLeave(a.id, isoDateForSort) : null;
        const bLeave = Store.getLeave ? Store.getLeave(b.id, isoDateForSort) : null;
        const aRest = isRestDay(a.teamId, a.id, isoDateForSort);
        const bRest = isRestDay(b.teamId, b.id, isoDateForSort);
        const aInactive = !!aLeave || !!aRest;
        const bInactive = !!bLeave || !!bRest;
        if(aInactive !== bInactive) return aInactive ? 1 : -1;
        return String(a.name||a.username).localeCompare(String(b.name||b.username));
      });

    // Build roster view-model (rosterVM) for Section 1 and keep it available for filter/search UI.
    const currentMemberIds = new Set(members.map(u=>u.id));
    const rosterVM = members.map(u=>{
      const leave = (Store.getLeave ? Store.getLeave(u.id, isoDateForSort) : null);
      const rest = isRestDay(u.teamId, u.id, isoDateForSort);
      const isInactive = !!leave || !!rest;
      let inactiveText = '';
      if(leave){
        inactiveText = leave.label || leave.type || 'On Leave';
      }else if(rest){
        inactiveText = 'Rest Day';
      }
      return Object.assign({}, u, { _isInactive: isInactive, _inactiveText: inactiveText });
    });
    wrap._lastRosterMembers = rosterVM;
    renderRoster(rosterVM);

    const table = wrap.querySelector('#membersTable');

    // Ruler (hour labels aligned to timeline grid)
    const ruler = wrap.querySelector('#ruler');
    const meta = UI.shiftMeta(team);
    const marks = [];
    const rticks = [];
    for(let off=0; off<=meta.length; off+=60){
      const pct = (off/meta.length)*100;
      const hm = UI.offsetToHM(team, off);
      const cls = off===0 ? 'mark first' : (off===meta.length ? 'mark last' : 'mark');
      marks.push(`<div class="${cls}" style="left:${pct}%">${UI.esc(to12h(hm))}</div>`);
      rticks.push(`<div class="ruler-tick" style="left:${pct}%"></div>`);
    }
    // 3-column ruler to match members-row grid: meta | timeline | actions
    ruler.innerHTML = `<div></div><div class="ruler-track">${rticks.join('')}${marks.join('')}</div><div></div>`;

    // Coverage meter for the selected day
    const covEl = wrap.querySelector('#coverageMeter');
    if(covEl){
      const s = getAutoSettingsForTeam(team.id);
      const planMap = {};
      for(const u of members){
        planMap[u.id] = normalizeBlocks(team, Store.getUserDayBlocks(u.id, selectedDay));
      }
      const cov = hourCoverage(team, members, planMap);
      const targetCall = (s.callMinPerHour||2);
      const okCount = cov.reduce((a,c)=>a+((c.mailboxMin===1 && c.callMin>=targetCall)?1:0),0);
      const totalCount = cov.length || 1;
      const pctOk = Math.round((okCount/totalCount)*100);

      // Show the specific calendar date + day for the currently edited grid (Manila week)
      // Example: January 19 | FRIDAY
      const _iso = isoForDay(selectedDay);
      const _parts = String(_iso||'').split('-');
      const _mm = Number(_parts[1]||0);
      const _dd = Number(_parts[2]||0);
      const _months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      const _pretty = `${_months[_mm-1] || _parts[1] || ''} ${_dd || (_parts[2]||'')}`.trim();
      const _dayLabel = String(UI.DAYS[selectedDay] || '').toUpperCase();
      const _dayDisplay = `${_pretty} | ${_dayLabel}`.trim();

      // Render coverage meter via component module (preferred)
      try{
        if(window.Components && Components.CoverageMeter){
          Components.CoverageMeter.render(covEl, {
            cov: cov,
            targetCall: targetCall,
            getTargetCall: ()=>{
              try{ const s2 = getAutoSettingsForTeam(team.id); return (s2 && s2.callMinPerHour) ? s2.callMinPerHour : (targetCall||2); }catch(_){ return (targetCall||2); }
            },
            isoDate: _iso,
            dayLabel: UI.DAYS[selectedDay],
            dayDisplay: _dayDisplay,
            canEdit: (isLead||isAdmin||isSuper),
            onEdit: ()=>renderAutoSettingsModal(selectedTeamId)
          });
        }else{
          covEl.textContent = '';
        }
      }catch(e){ }
    }

    const ticks = [];
    for(let off=0; off<=meta.length; off+=60){
      const pct = (off/meta.length)*100;
      ticks.push(`<div class="tick" style="left:${pct}%"></div>`);
    }

    const weekStartMs = UI.manilaWeekStartMondayMs();
    const cases = Store.getCases();
    function weeklyStats(u){
      const totals = { mailbox:0, back:0, call:0 };
      for(let d=0; d<7; d++){
        const bl = Store.getUserDayBlocks(u.id, d);
        const t = Config.teamById(u.teamId);
        for(const b of (bl||[])){
          const s = UI.offsetFromShiftStart(t,b.start);
          const e = UI.offsetFromShiftStart(t,b.end);
          const mins = Math.max(0, e-s);
          const r = b.role;
          if(r==='back_office') totals.back += mins;
          else if(r==='call_onqueue' || r==='call_available') totals.call += mins;
          else if(r==='mailbox_manager' || r==='mailbox_call') totals.mailbox += mins;
        }
      }
      const toH = m => Math.round(m/60);
      const caseCount = cases.filter(c=>c.assigneeId===u.id && (c.createdAt||0) >= weekStartMs).length;
      return {
        mailboxH: toH(totals.mailbox),
        backOfficeH: toH(totals.back),
        callAvailableH: toH(totals.call),
        caseAssigned: caseCount
      };
    }

    // Member-level progress bar: selected Paint task hours -> percentage vs max hours.
    const _taskCfg = (Store.getTeamTaskConfig ? Store.getTeamTaskConfig(team.id) : null) || {};
    const _callRole = _taskCfg.callRole ? String(_taskCfg.callRole) : 'call_onqueue';
    let _maxMap = {};
    try{
      _maxMap = JSON.parse(localStorage.getItem(`mums_gsp_max_hours_${team.id}`) || '{}') || {};
    }catch(e){ _maxMap = {}; }

    function _defaultMaxHours(taskId){
      const tid = String(taskId||'');
      try{
        if(window.GraphPanel && typeof GraphPanel.defaultMaxHours === 'function'){
          return Number(GraphPanel.defaultMaxHours(tid, { callRole: _callRole })) || 20;
        }
      }catch(_e){}
      if(tid===_callRole || tid==='call_onqueue' || tid==='call_available') return 25;
      return 20;
    }

    function _getMaxHours(taskId){
      const tid = String(taskId||'');
      const n = Number(_maxMap[tid]);
      return (Number.isFinite(n) && n>0) ? n : _defaultMaxHours(tid);
    }

    function _minutesForTaskWeek(u, taskId){
      const tid = String(taskId||'');
      if(!tid || tid==='__clear__') return 0;
      const isMailbox = (tid === 'mailbox_manager');
      const isCall = (tid === _callRole || tid === 'call_onqueue' || tid === 'call_available');
      let total = 0;
      for(let d=0; d<7; d++){
        const bl = Store.getUserDayBlocks(u.id, d) || [];
        const t = Config.teamById(u.teamId);
        for(const b of bl){
          const s = UI.offsetFromShiftStart(t, b.start);
          const e = UI.offsetFromShiftStart(t, b.end);
          const mins = Math.max(0, e - s);
          const r = String(b.role||'');
          if(isMailbox){
            if(r==='mailbox_manager' || r==='mailbox_call') total += mins;
          }else if(isCall){
            if(r==='call_onqueue' || r==='call_available' || r===_callRole || r==='mailbox_call') total += mins;
          }else{
            if(r===tid) total += mins;
          }
        }
      }
      return total;
    }

    function _progressForMember(u, taskId){
      const tid = String(taskId||'').trim();
      const maxH = _getMaxHours(tid);
      const hours = _minutesForTaskWeek(u, tid) / 60;
      const pctRaw = maxH>0 ? (hours / maxH) * 100 : 0;
      const pct = Math.max(0, Math.min(100, Math.round(pctRaw)));
      const cls = (pct<=60) ? 'progress-green' : (pct<=85 ? 'progress-orange' : 'progress-red');

      // Short label format for the tooltip.
      function shortTaskLabel(){
        if(tid==='mailbox_manager' || tid==='mailbox_call') return 'Mailbox';
        if(tid==='back_office') return 'Back Office';
        if(tid===_callRole || tid==='call_onqueue' || tid==='call_available') return 'Call';
        if(tid==='case_assigned' || tid==='cases') return 'Cases';
        const m = taskMeta(team.id, tid);
        const lbl = String((m && m.label) ? m.label : tid);
        const l = lbl.toLowerCase();
        if(l.includes('mailbox')) return 'Mailbox';
        if(l.includes('back')) return 'Back Office';
        if(l.includes('call')) return 'Call';
        if(l.includes('case')) return 'Cases';
        return lbl.replace(/\bmanager\b/i,'').trim() || lbl;
      }

      const maxFmt = Number.isInteger(maxH) ? String(maxH) : String(Math.round(maxH*10)/10);
      const hoursFmt = String(Math.round(hours));
      const taskHoursTooltip = `${shortTaskLabel()}: ${hoursFmt}h/${maxFmt}h`;

      return {
        pct,
        pctText: `${pct}%`,
        cls,
        taskHoursTooltip,
        title: taskHoursTooltip
      };
    }

    table.innerHTML = members.map(m=>{
      const isoDate = isoForDay(selectedDay);
      const dayLockedForGrid = dayLockedForGridDisplay(isoDate, team.id);
      const leave = Store.getLeave ? Store.getLeave(m.id, isoDate) : null;
      const rest = isRestDay(m.teamId, m.id, isoDate);
      const isInactive = !!leave || !!rest;
      const leaveLabel = (t)=>({
        SICK: 'ON SICK LEAVE',
        EMERGENCY: 'ON EMERGENCY LEAVE',
        VACATION: 'ON VACATION LEAVE',
        HOLIDAY: 'ON HOLIDAY LEAVE'
      }[t] || 'ON LEAVE');
      const inactiveText = leave ? leaveLabel(leave.type) : (rest ? 'ON REST DAY' : '');

      const ws = weeklyStats(m);
      const prog = _progressForMember(m, paint.role || graphTaskFilterId);

      const blocks = normalizeBlocks(team, Store.getUserDayBlocks(m.id, selectedDay), { locked: dayLockedForGrid && !unlockTriggered });
      const segs = (blocks||[]).map((b,i)=>{
          const st = segStyle(b);
          const role = (b.role || b.task || 'block');
          const roleCls = 'role-' + String(role).replace(/[^a-z0-9_-]/gi,'_');

          const segCssVars = (() => {
            try{
              const raw = b.bg || b.color || '';
              if (!raw) return '';
              const tc = _textColorForBg(raw);
              return `--seg-raw:${raw};--seg-fg:${tc};`;
            }catch(_){
              return '';
            }
          })();

          const styleAttr = `left:${st.left}%;width:${st.width}%;${segCssVars}`;
          const lockedIcon = b.locked ? `<span class="seg-lock" aria-label="Locked" title="Locked"><span class="lock-ic" aria-hidden="true"></span></span>` : '';

          return `<div class="seg ${roleCls} ${b.selected?'is-selected':''} ${b.locked?'is-locked':''}" data-mid="${UI.esc(m.id)}" data-idx="${i}" data-role="${UI.esc(role)}" style="${styleAttr}" title="${UI.esc(b.taskLabel || b.roleLabel || role)} (${st.hours}h)">
            ${lockedIcon}
            <span class="handle" aria-hidden="true"></span>
          </div>`;
        }).join('');
      const teamClass = `team-${m.teamId}`;
      const rowClass = isInactive ? 'inactive' : '';
      // Render row via component module (preferred).
      try{
        if(window.Components && Components.MemberRow){
          return Components.MemberRow.render({
            id: m.id,
            name: (m.name||m.username),
            memberTeamId: m.teamId,
            memberTeamLabel: Config.teamById(m.teamId).label,
            timelineTeamId: team.id,
            isoDate: isoDate,
            weeklyStats: ws,
            progress: prog,
            ticksHtml: ticks.join(''),
            segsHtml: segs,
            isInactive: isInactive,
            inactiveText: inactiveText,
            canEdit: canEditTarget(m),
            leave: leave,
            dayLocked: dayLockedForGrid
          });
        }
      }catch(e){ }

      return `
        <div class="members-row ${rowClass}" data-id="${UI.esc(m.id)}" data-inactive="${isInactive?'1':'0'}" data-iso="${UI.esc(isoDate)}">
          <div class="members-meta ${teamClass}">
            <div class="m-name">
              <label class="m-selwrap" title="Select member">
                <input class="m-select" type="checkbox" data-act="mselect" />
              </label>
              <div class="m-name-text">${UI.esc(m.name||m.username)}${isInactive ? ` <span class="status-pill">${UI.esc(inactiveText)}</span>`:''}</div>
            </div>
            <div class="member-progress" title="${UI.esc(prog.title||'')}" aria-label="Task completion ${UI.esc(prog.pctText||'')}">
              <div class="progress-track">
                <div class="progress-bar ${UI.esc(prog.cls||'progress-green')}" style="width:${Math.max(0, Math.min(100, Number(prog.pct)||0))}%"></div>
              </div>
              <span class="progress-text">${UI.esc(prog.pctText||'')}</span>
              <div class="progress-tooltip">${UI.esc(prog.taskHoursTooltip||'')}</div>
            </div>
          </div>
          <div>
            <div class="member-task-stats" aria-label="Weekly workload">Mailbox: ${ws.mailboxH}h • Back Office: ${ws.backOfficeH}h • Call: ${ws.callAvailableH}h • Cases: ${ws.caseAssigned}</div>
            <div class="timeline" data-team="${UI.esc(team.id)}">
              ${ticks.join('')}
              ${segs}
              ${isInactive ? `<div class="timeline-overlay">${UI.esc(inactiveText)}</div>`:''}
              ${dayLockedForGrid ? `<div class="locked-below" aria-label="Locked day" title="Locked"><span class="lock-ic" aria-hidden="true"></span></div>`:''}
            </div>
          </div>
          <div class="member-actions">
            ${canEditTarget(m) ? `
              <button class="iconbtn" data-act="edit" type="button" title="Edit schedule" ${isInactive?'disabled':''}>✎</button>
            ` : '<span class="small muted">View</span>'}
            ${canEditTarget(m) ? `
              <div class="leave-actions" aria-label="Leave actions">
                <button class="btn ghost tiny leavebtn ${leave && leave.type==='SICK'?'active':''}" data-act="leave" data-leave="SICK" type="button" title="Sick Leave (SL)">SL</button>
                <button class="btn ghost tiny leavebtn ${leave && leave.type==='EMERGENCY'?'active':''}" data-act="leave" data-leave="EMERGENCY" type="button" title="Emergency Leave (EL)">EL</button>
                <button class="btn ghost tiny leavebtn ${leave && leave.type==='VACATION'?'active':''}" data-act="leave" data-leave="VACATION" type="button" title="Vacation Leave (VL)">VL</button>
                <button class="btn ghost tiny leavebtn ${leave && leave.type==='HOLIDAY'?'active':''}" data-act="leave" data-leave="HOLIDAY" type="button" title="Holiday Leave (HL)">HL</button>
              </div>
            `:''}
          </div>
        </div>
      `;
    }).join('');

    table.querySelectorAll('button[data-act="edit"]').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const row = btn.closest('.members-row');
        const id = row.dataset.id;
        const member = Store.getUsers().find(u=>u.id===id);
        if(member) openEditModal(member);
      });
    });


    // Member multi-select checkboxes (bulk clear)
    // Ensure the checkbox itself AND its label are directly clickable.
    // Some browsers can fire the row pointerdown handler first, which may block toggling.
    table.querySelectorAll('.m-selwrap').forEach(lbl=>{
      lbl.addEventListener('pointerdown', (e)=>{ e.stopPropagation(); }, { passive: true });
      lbl.addEventListener('click', (e)=>{ e.stopPropagation(); });
    });
    table.querySelectorAll('input.m-select').forEach(cb=>{
      cb.addEventListener('click', (e)=>{ e.stopPropagation(); });
      cb.addEventListener('pointerdown', (e)=>{ e.stopPropagation(); });
      cb.addEventListener('change', ()=>{
        const row = cb.closest('.members-row');
        if(!row) return;
        const id = row.dataset.id;
        if(!id) return;
        if(cb.checked){
          if(!selMemberIds) selMemberIds = new Set();
          selMemberIds.add(id);
          selMemberId = id;
        }else{
          if(selMemberIds) selMemberIds.delete(id);
          if(selMemberId===id && selMemberIds && selMemberIds.size){
            selMemberId = Array.from(selMemberIds)[0];
          }
        }
        // Do not touch block selection; this is for bulk actions
        updateSelectionUI();
        applyMemberRowSelectionStyles();
      });
    });

    // Leave toggles (per date) — applies immediately.
    table.querySelectorAll('button[data-act="leave"]').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const row = btn.closest('.members-row');
        if(!row) return;
        const userId = row.dataset.id;
        const iso = row.dataset.iso || isoForDay(selectedDay);
        const cur = Store.getLeave ? Store.getLeave(userId, iso) : null;
        const want = String(btn.dataset.leave||'').toUpperCase();
        let next = (cur && cur.type===want) ? null : want;
        if(cur && cur.type===want){
          const label = ({SICK:'Sick Leave',EMERGENCY:'Emergency Leave',VACATION:'Vacation Leave',HOLIDAY:'Holiday Leave'}[want] || 'Leave');
          const ok = await UI.confirm({ title:'Remove Status', message:`Remove ${label} status for this member on ${iso}?`, okText:'Remove', danger:true });
          if(!ok) return;
        }
        try{
          Store.setLeave(userId, iso, next, { setBy: me.id, setByName: me.name||me.username });
          if(next){
            Store.addLog({ ts: Date.now(), teamId: selectedTeamId, actorId: me.id, actorName: me.name||me.username, action: 'LEAVE_SET', targetId: userId, msg: `${me.name||me.username} set ${want.toLowerCase()} leave`, detail: `Date ${iso}` });
            const u = Store.getUsers().find(x=>x.id===userId);
            addAudit(`LEAVE_SET_${want}`, userId, u ? (u.name||u.username) : null, `Date ${iso}`);
          } else {
            Store.addLog({ ts: Date.now(), teamId: selectedTeamId, actorId: me.id, actorName: me.name||me.username, action: 'LEAVE_CLEAR', targetId: userId, msg: `${me.name||me.username} cleared leave`, detail: `Date ${iso}` });
            const u = Store.getUsers().find(x=>x.id===userId);
            addAudit('LEAVE_CLEAR', userId, u ? (u.name||u.username) : null, `Date ${iso}`);
          }
        }catch(e){

          UI.toast && UI.toast('Unable to update leave. Please refresh and try again.');
        }
        clearSelection();
        // Re-render the whole page section so leave buttons + sorting update immediately.
        renderAll();
      });
    });



    // Restore selection state across renderAll() (without stale selections).
    // - Keep member selections if still present in currentMemberIds.
    // - Filter block selections to only those segments that still exist.
    if(!ctxChanged){
      selMemberId = (prevSelMemberId && currentMemberIds.has(prevSelMemberId)) ? prevSelMemberId : null;
      selMemberIds = new Set(Array.from(prevSelMemberIds).filter(id=>currentMemberIds.has(id)));

      if(selMemberId){
        const row = wrap.querySelector(`.members-row[data-id="${CSS.escape(selMemberId)}"]`);
        if(row && prevSelIdx && prevSelIdx.size){
          const nextIdx = new Set();
          prevSelIdx.forEach(i=>{ if(row.querySelector(`.seg[data-idx="${i}"]`)) nextIdx.add(i); });
          selIdx = nextIdx;
        }else{
          selIdx = new Set();
        }

        // Restore scroll context only if the selected row is off-screen.
        try{
          const sc = wrap.querySelector('#membersTimelineScroll');
          const r = row ? row.getBoundingClientRect() : null;
          const c = sc ? sc.getBoundingClientRect() : null;
          const inView = (r && c) ? (r.top >= c.top && r.bottom <= c.bottom) : true;
          selectMemberFromRoster(selMemberId, { preserveSelection:true, preserveBlocks:true, scroll: !inView });
        }catch(_){
          try{ selectMemberFromRoster(selMemberId, { preserveSelection:true, preserveBlocks:true, scroll:false }); }catch(__){}
        }
      }else{
        selIdx = new Set();
        updateSelectionUI();
        applySelectionStyles();
        applyMemberRowSelectionStyles();
      }
    }else{
      updateSelectionUI();
      applySelectionStyles();
      applyMemberRowSelectionStyles();
    }
    // Copy / mirror / duplicate features removed for a cleaner Team Lead workflow.
  

    // Graph Summary (Inspector > Analytics): keep availability bar up to date
    try{ renderMemberGraphPanel(members); }catch(_e){}
}

  // Drag-to-move / resize on timeline segments
  (function(){
    const table = wrap.querySelector('#membersTable');
    let drag = null;
    let raf = null;
    let paintDrag = null; // {member, team, meta, rect, lastHour}

    // Selecting a member row should not require selecting a block.
    // This enables "Clear All" to work predictably and makes keyboard actions behave consistently.
    if(table){
      table.addEventListener('pointerdown', (e)=>{
        const row = e.target.closest('.members-row');
        if(!row) return;
        // If the click is on a block, the segment handler will manage selection/drag.
        if(e.target.closest('.seg')) return;
        if(e.target.closest('input.m-select') || e.target.closest('.m-selwrap')) return;
        const memberId = row.dataset.id;
        if(!memberId) return;
        // Select the member row, clear any block selection
        selMemberId = memberId;
        selMemberIds = new Set([memberId]);
        selIdx = new Set();
        updateSelectionUI();
        applySelectionStyles();
        applyMemberRowSelectionStyles();
      });
    }

    function slotsFromBlocks(team, blocks){
      const meta = UI.shiftMeta(team);
      const hours = Math.ceil(meta.length / GRID_STEP_MIN);
      const slots = Array(hours).fill(null);
      for(const b of (blocks||[])){
        const s = Math.floor(UI.offsetFromShiftStart(team,b.start) / GRID_STEP_MIN);
        const e = Math.ceil(UI.offsetFromShiftStart(team,b.end) / GRID_STEP_MIN);
        for(let i=Math.max(0,s); i<Math.min(hours,e); i++) slots[i] = b.role;
      }
      return slots;
    }

    function blocksFromSlots(team, slots){
      const out = [];
      let curRole = slots[0] || null;
      let st = 0;
      for(let i=1;i<=slots.length;i++){
        const r = (i<slots.length) ? (slots[i]||null) : null;
        if(r !== curRole){
          if(curRole){
            out.push({ start: UI.offsetToHM(team, st*GRID_STEP_MIN), end: UI.offsetToHM(team, i*GRID_STEP_MIN), role: curRole });
          }
          curRole = r;
          st = i;
        }
      }
      return out;
    }

    function hourIndexFromX(rect, clientX, hours){
      const rel = (clientX - rect.left) / rect.width;
      const idx = Math.floor(rel * hours);
      return Math.max(0, Math.min(hours-1, idx));
    }

    function applyPaintHours(member, hoursToSet, role){
      const team = Config.teamById(member.teamId);
      const meta = UI.shiftMeta(team);
      const hours = Math.ceil(meta.length / GRID_STEP_MIN);
      const current = normalizeBlocks(team, Store.getUserDayBlocks(member.id, selectedDay));
      const slots = slotsFromBlocks(team, current);
      for(const h of hoursToSet){
        if(h<0 || h>=hours) continue;
        slots[h] = (role === '__clear__') ? null : role;
      }
      const updated = normalizeBlocks(team, blocksFromSlots(team, slots));
      Store.setUserDayBlocks(member.id, member.teamId, selectedDay, updated);
    requestGraphRefresh();
    }

    function roleAtHour(member, team, hourIdx){
      try{
        const meta = UI.shiftMeta(team);
        const hours = Math.ceil(meta.length / GRID_STEP_MIN);
        if(hourIdx < 0 || hourIdx >= hours) return null;
        const current = normalizeBlocks(team, Store.getUserDayBlocks(member.id, selectedDay));
        const slots = slotsFromBlocks(team, current);
        return slots[hourIdx] || null;
      }catch(e){
        return null;
      }
    }

    // If the paint gesture starts inside an existing block of the same role, treat the gesture
    // as a resize/trim request: keep only the painted hours for that contiguous role region.
    // This allows shortening (e.g., 4h -> 3h) without requiring users to manually switch to Clear.
    function trimRoleOutsideTouched(member, team, touchedHours, role){
      try{
        if(!touchedHours || !touchedHours.size) return;
        const meta = UI.shiftMeta(team);
        const hours = Math.ceil(meta.length / GRID_STEP_MIN);
        const current = normalizeBlocks(team, Store.getUserDayBlocks(member.id, selectedDay));
        const slots = slotsFromBlocks(team, current);
        const touched = Array.from(touchedHours).filter(h=>h>=0 && h<hours).sort((a,b)=>a-b);
        if(!touched.length) return;

        const touchedSet = new Set(touched);
        // Build contiguous segments from the painted hours.
        const segs = [];
        let a = touched[0], b = touched[0];
        for(let i=1;i<touched.length;i++){
          const h = touched[i];
          if(h === b + 1){ b = h; continue; }
          segs.push([a,b]);
          a = h; b = h;
        }
        segs.push([a,b]);

        for(const seg of segs){
          const s0 = seg[0], e0 = seg[1];
          // Trim left side
          let h = s0 - 1;
          while(h >= 0 && slots[h] === role && !touchedSet.has(h)){
            slots[h] = null;
            h--;
          }
          // Trim right side
          h = e0 + 1;
          while(h < hours && slots[h] === role && !touchedSet.has(h)){
            slots[h] = null;
            h++;
          }
        }

        const updated = normalizeBlocks(team, blocksFromSlots(team, slots));
        Store.setUserDayBlocks(member.id, member.teamId, selectedDay, updated);
    requestGraphRefresh();
      }catch(e){

      }
    }


    // Track cursor position for paste target
    table.addEventListener('pointermove', (e)=>{
      if(drag) return;
      const timeline = e.target.closest('.timeline');
      if(!timeline) return;
      const row = e.target.closest('.members-row');
      if(!row) return;
      if(row.dataset.inactive === '1') return;
      const memberId = row.dataset.id;
      const member = Store.getUsers().find(u=>u.id===memberId);
      if(!member) return;
      const team = Config.teamById(member.teamId);
      const meta = UI.shiftMeta(team);
      const rect = timeline.getBoundingClientRect();
      const rel = (e.clientX - rect.left) / rect.width;
      let off = UI.snapMinutes(Math.max(0, Math.min(meta.length, rel * meta.length)), GRID_STEP_MIN);
      if(off >= meta.length) off = meta.length - GRID_STEP_MIN;
      lastCursor = { memberId, offsetMin: off };
    });

    function getOffsets(team, block){
      return { s: UI.offsetFromShiftStart(team, block.start), e: UI.offsetFromShiftStart(team, block.end) };
    }
    function findConflicts(list, idx, s, e, team){
      const hits = [];
      for(let i=0;i<list.length;i++){
        if(i===idx) continue;
        const o = getOffsets(team, list[i]);
        if(e > o.s && s < o.e) hits.push(i);
      }
      return hits;
    }

    function flashConflict(seg, conflicts){
      if(!seg) return;
      const tl = seg.parentElement;
      const elems = [seg];
      (conflicts||[]).forEach(i=>{
        const other = tl.querySelector('.seg[data-idx="'+i+'"]');
        if(other) elems.push(other);
      });
      elems.forEach(el=>el.classList.add('conflict'));
      setTimeout(()=>elems.forEach(el=>el.classList.remove('conflict')), 450);
    }

    // Role picker popover (used after drag-to-create)
    let rolePicker = null;
    function hideRolePicker(){
      if(rolePicker){ rolePicker.remove(); rolePicker = null; }
      window.removeEventListener('pointerdown', onOutside, true);
      window.removeEventListener('keydown', onKey, true);
    }
    function onOutside(ev){
      if(!rolePicker) return;
      if(rolePicker.contains(ev.target)) return;
      hideRolePicker();
    }
    function onKey(ev){
      if(ev.key==='Escape') hideRolePicker();
    }
    function showRolePickerAt(x, y, initialRole, onPick){
      hideRolePicker();
      rolePicker = document.createElement('div');
      rolePicker.className = 'role-picker';
      const roleOptions = Object.keys(Config.SCHEDULES).map(k=>{
        const s = Config.SCHEDULES[k];
        return `<option value="${s.id}" ${s.id===initialRole?'selected':''}>${UI.esc(s.label)}</option>`;
      }).join('');
      rolePicker.innerHTML = `
        <div class="row">
          <div class="small font-extrabold">Choose role</div>
          <button class="btn ghost" type="button" data-act="close">✕</button>
        </div>
        <div class="mt-2">
          <select class="input" id="rpSel">${roleOptions}</select>
          <div class="quick" id="rpQuick"></div>
          <div class="row mt-3 justify-end">
            <button class="btn primary" type="button" data-act="apply">Apply</button>
          </div>
        </div>
      `;
      document.body.appendChild(rolePicker);

      // position (keep on-screen)
      const pad = 10;
      const r = rolePicker.getBoundingClientRect();
      const vx = Math.min(window.innerWidth - r.width - pad, Math.max(pad, x - r.width/2));
      const vy = Math.min(window.innerHeight - r.height - pad, Math.max(pad, y + 12));
      rolePicker.style.left = vx + 'px';
      rolePicker.style.top = vy + 'px';

      const sel = rolePicker.querySelector('#rpSel');
      const quick = rolePicker.querySelector('#rpQuick');
      const quickIds = ['mailbox_manager','call_onqueue','back_office','lunch','block'];
      quick.innerHTML = quickIds.map(id=>{
        const s = Config.scheduleById(id);
        return s ? `<button class="btn" type="button" data-role="${s.id}">${UI.esc(s.icon||'')}${UI.esc(s.label)}</button>` : '';
      }).join('');
      quick.querySelectorAll('button[data-role]').forEach(b=>b.onclick=()=>{ sel.value=b.dataset.role; });

      rolePicker.querySelector('[data-act="close"]').onclick = hideRolePicker;
      rolePicker.querySelector('[data-act="apply"]').onclick = ()=>{ const val = sel.value; hideRolePicker(); onPick(val); };

      window.addEventListener('pointerdown', onOutside, true);
      window.addEventListener('keydown', onKey, true);
    }

    // Drag-to-create (default) OR rectangle select (Shift+Drag) on empty timeline space
    table.addEventListener('pointerdown', (e)=>{
      const timeline = e.target.closest('.timeline');
      if(!timeline) return;
      if(e.target.closest('.seg')) return;
      const row = e.target.closest('.members-row');
      if(!row) return;
      if(row.dataset.inactive === '1') return;
      const memberId = row.dataset.id;
      const member = Store.getUsers().find(u=>u.id===memberId);
      if(!member || !canEditTarget(member)) return;
      const scheduleBlock = { locked: isDayLockedForEdit(selectedTeamId, selectedDay) };
      if(scheduleBlock.locked && !unlockTriggered){
        warnScheduleLocked();
        return;
      }
      const team = Config.teamById(member.teamId);
      const meta = UI.shiftMeta(team);
      const blocks = normalizeBlocks(team, Store.getUserDayBlocks(member.id, selectedDay), { locked: scheduleBlock.locked });

      // Paint mode: click+drag across hours
      if(paint.enabled && !e.shiftKey){
        const rect = timeline.getBoundingClientRect();
        const hours = Math.ceil(meta.length / GRID_STEP_MIN);
        const h0 = hourIndexFromX(rect, e.clientX, hours);
        const preSlots = slotsFromBlocks(team, normalizeBlocks(team, Store.getUserDayBlocks(member.id, selectedDay), { locked: scheduleBlock.locked })).slice();
        const startedRoleBefore = preSlots[h0] || null;
        applyPaintHours(member, [h0], paint.role);
        paintDrag = { member, team, meta, timeline, rect, hours, lastHour: h0, touched: new Set([h0]), startedRoleBefore, preSlots };
        timeline.setPointerCapture(e.pointerId);
        return;
      }

      // Shift+Drag: rectangle multi-select (within the member row)
      if(e.shiftKey){
        const rect = timeline.getBoundingClientRect();
        const box = document.createElement('div');
        box.className = 'select-rect';
        box.style.left = '0%';
        box.style.width = '0%';
        timeline.appendChild(box);
        drag = { kind: 'rect', box, timeline, row, memberId, rect, x0: e.clientX, x1: e.clientX };
        timeline.setPointerCapture(e.pointerId);
        return;
      }

      const rect = timeline.getBoundingClientRect();
      const ghost = document.createElement('div');
      ghost.className = 'seg ghost ok';
      ghost.dataset.role = 'block';
      ghost.style.left = '0%';
      ghost.style.width = '0%';
      ghost.title = 'New block';
      ghost.innerHTML = '<span>⏱</span>';
      timeline.appendChild(ghost);

      drag = { kind: 'create', seg: ghost, timeline, member, team, meta, idx: -1, blocks, rect, x0: e.clientX, x1: e.clientX };
      ghost.setPointerCapture(e.pointerId);
    });

    table.addEventListener('pointerdown', (e)=>{
      const seg = e.target.closest('.seg');
      if(!seg) return;
      const row = e.target.closest('.members-row');
      if(!row) return;
      const memberId = row.dataset.id;
      const member = Store.getUsers().find(u=>u.id===memberId);
      if(!member || !canEditTarget(member)) return;
      const scheduleBlock = { locked: isDayLockedForEdit(selectedTeamId, selectedDay) };
      if(scheduleBlock.locked && !unlockTriggered){
        warnScheduleLocked();
        return;
      }

      // Paint mode: allow painting over existing segments too
      if(paint.enabled && !e.shiftKey){
        const timeline = seg.parentElement;
        const rect = timeline.getBoundingClientRect();
        const team = Config.teamById(member.teamId);
        const meta = UI.shiftMeta(team);
        const hours = Math.ceil(meta.length / GRID_STEP_MIN);
        const h0 = hourIndexFromX(rect, e.clientX, hours);
        const preSlots = slotsFromBlocks(team, normalizeBlocks(team, Store.getUserDayBlocks(member.id, selectedDay))).slice();
        const startedRoleBefore = preSlots[h0] || null;
        applyPaintHours(member, [h0], paint.role);
        paintDrag = { member, team, meta, timeline, rect, hours, lastHour: h0, touched: new Set([h0]), startedRoleBefore, preSlots };
        timeline.setPointerCapture(e.pointerId);
        return;
      }

      // Multi-select: Shift+Click toggles selection and does not start drag
      const idxSel = Number(seg.dataset.idx);
      if(e.shiftKey){
        if(selMemberId && selMemberId !== memberId){ clearSelection(); }
        selMemberId = memberId;
        if(selIdx.has(idxSel)) selIdx.delete(idxSel); else selIdx.add(idxSel);
        updateSelectionUI();
    applySelectionStyles();
    applyMemberRowSelectionStyles();
        return;
      }

      // Normal click selects the block (single) but still allows drag
      selMemberId = memberId;
      selIdx = new Set([idxSel]);
      updateSelectionUI();
    applySelectionStyles();
    applyMemberRowSelectionStyles();

      const team = Config.teamById(member.teamId);
      const meta = UI.shiftMeta(team);
      const idx = Number(seg.dataset.idx);
      const blocks = normalizeBlocks(team, Store.getUserDayBlocks(member.id, selectedDay), { locked: scheduleBlock.locked });
      const b = blocks[idx];
      if(!b) return;

      const mode = e.target.classList.contains('l') ? 'resize-l' : e.target.classList.contains('r') ? 'resize-r' : 'move';
      if(b.role==='lunch' && mode!=='move') return; // fixed 1 hour lunch

      const rect = seg.parentElement.getBoundingClientRect();
      const o = getOffsets(team, b);
      drag = { seg, member, team, meta, idx, blocks, mode, rect, x0: e.clientX, s0:o.s, e0:o.e };
      seg.classList.add('dragging');
      seg.setPointerCapture(e.pointerId);
    });

    window.addEventListener('pointermove', (e)=>{
      if(paintDrag){
        const idx = hourIndexFromX(paintDrag.rect, e.clientX, paintDrag.hours);
        if(idx !== paintDrag.lastHour){
          const a = Math.min(paintDrag.lastHour, idx);
          const b = Math.max(paintDrag.lastHour, idx);
          const toSet = [];
          for(let h=a; h<=b; h++){
            if(!paintDrag.touched.has(h)){
              paintDrag.touched.add(h);
              toSet.push(h);
            }
          }
          if(toSet.length) applyPaintHours(paintDrag.member, toSet, paint.role);
          paintDrag.lastHour = idx;
        }
        return;
      }
      if(!drag) return;

      // rectangle select
      if(drag.kind==='rect'){
        drag.x1 = e.clientX;
        const xA = Math.min(drag.x0, drag.x1);
        const xB = Math.max(drag.x0, drag.x1);
        const relA = (xA - drag.rect.left) / drag.rect.width;
        const relB = (xB - drag.rect.left) / drag.rect.width;
        const leftPct = Math.max(0, Math.min(100, relA*100));
        const rightPct = Math.max(0, Math.min(100, relB*100));
        drag.box.style.left = leftPct + '%';
        drag.box.style.width = Math.max(0, rightPct-leftPct) + '%';
        return;
      }

      // create mode
      if(drag.kind==='create'){
        drag.x1 = e.clientX;
        const xA = Math.min(drag.x0, drag.x1);
        const xB = Math.max(drag.x0, drag.x1);
        const relA = (xA - drag.rect.left) / drag.rect.width;
        const relB = (xB - drag.rect.left) / drag.rect.width;
        let sMin = UI.snapMinutes(relA * drag.meta.length, GRID_STEP_MIN);
        let eMin = UI.snapMinutes(relB * drag.meta.length, GRID_STEP_MIN);
        if(eMin - sMin < GRID_STEP_MIN) eMin = sMin + GRID_STEP_MIN;
        sMin = Math.max(0, Math.min(sMin, drag.meta.length-GRID_STEP_MIN));
        eMin = Math.max(sMin+GRID_STEP_MIN, Math.min(eMin, drag.meta.length));
        const conflicts = findConflicts(drag.blocks, -1, sMin, eMin, drag.team);
        drag.seg.classList.toggle('bad', conflicts.length>0);
        drag.seg.classList.toggle('ok', conflicts.length==0);
        const left = (sMin/drag.meta.length)*100;
        const width = ((eMin-sMin)/drag.meta.length)*100;
        drag.seg.style.left = left + '%';
        drag.seg.style.width = width + '%';
        drag._s = sMin;
        drag._e = eMin;
        drag._conflicts = conflicts;
        drag.seg.title = 'New block ' + UI.offsetToHM(drag.team,sMin) + '–' + UI.offsetToHM(drag.team,eMin);
        return;
      }

      const dx = e.clientX - drag.x0;
      const dm = (dx / drag.rect.width) * drag.meta.length;
      let s = drag.s0;
      let e2 = drag.e0;
      const dur = drag.e0 - drag.s0;
      if(drag.mode==='move'){
        s = UI.snapMinutes(drag.s0 + dm, GRID_STEP_MIN);
        e2 = s + dur;
      } else if(drag.mode==='resize-l'){
        s = UI.snapMinutes(drag.s0 + dm, GRID_STEP_MIN);
      } else {
        e2 = UI.snapMinutes(drag.e0 + dm, GRID_STEP_MIN);
      }

      // lunch fixed 60 mins
      if(drag.blocks[drag.idx].role==='lunch'){
        const ns = UI.snapMinutes(s,GRID_STEP_MIN);
        s = ns;
        e2 = ns + GRID_STEP_MIN;
      }

      // clamp
      s = Math.max(0, Math.min(s, drag.meta.length-GRID_STEP_MIN));
      e2 = Math.max(s+GRID_STEP_MIN, Math.min(e2, drag.meta.length));
      if(drag.blocks[drag.idx].role==='lunch'){
        // ensure exactly 1 hour
        e2 = Math.min(drag.meta.length, s+GRID_STEP_MIN);
        if(e2 - s < GRID_STEP_MIN){ s = Math.max(0, e2-GRID_STEP_MIN); }
        e2 = s+GRID_STEP_MIN;
      }

      // overlap guard
      const conflicts = findConflicts(drag.blocks, drag.idx, s, e2, drag.team);
      if(conflicts.length){
        flashConflict(drag.seg, conflicts);
        return;
      }

      // live update DOM (throttled)
      if(raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(()=>{
        try{
          if(!drag || !drag.meta || !drag.seg || !drag.meta.length) return;
          const left = (s/drag.meta.length)*100;
        const width = ((e2-s)/drag.meta.length)*100;
        drag.seg.style.left = left + '%';
        drag.seg.style.width = width + '%';
        drag.seg.title = `${blockLabel(drag.blocks[drag.idx].role)} ${UI.offsetToHM(drag.team,s)}–${UI.offsetToHM(drag.team,e2)}`;
        drag._s = s; drag._e = e2;
        }catch(err){ }
      });
    });

    window.addEventListener('pointerup', (e)=>{
      if(paintDrag){
        const actor = Auth.getUser();
        if(actor){
          Store.addLog({
            ts: Date.now(),
            teamId: paintDrag.member.teamId,
            actorId: actor.id,
            actorName: actor.name||actor.username,
            action: 'SCHEDULE_PAINT',
            targetId: paintDrag.member.id,
            targetName: paintDrag.member.name||paintDrag.member.username,
            msg: `${actor.name||actor.username} painted ${paintDrag.touched.size} hour(s) for ${paintDrag.member.name||paintDrag.member.username}`,
            detail: `${UI.DAYS[selectedDay]} role=${paint.role}`
          });
        }
        // Support shortening (trim) of an existing block using paint.
        // Trim is only applied when the gesture STARTS inside an existing block of the same role.
        // This preserves the normal paint behavior when starting from empty hours (extend is allowed).
        if(paint.role !== '__clear__' && paintDrag.startedRoleBefore === paint.role){
          trimRoleOutsideTouched(paintDrag.member, paintDrag.team, paintDrag.touched, paint.role);
        }
        paintDrag = null;
        renderAll();
        return;
      }
      if(!drag) return;

      // finish rectangle selection
      if(drag.kind==='rect'){
        const row = drag.row;
        const memberId = drag.memberId;
        // remove box
        try{ drag.box.remove(); }catch(_e){}
        const xA = Math.min(drag.x0, drag.x1);
        const xB = Math.max(drag.x0, drag.x1);
        // select segments whose centers are inside [xA,xB]
        selMemberId = memberId;
        selIdx = new Set();
        const segs = row.querySelectorAll('.timeline .seg');
        segs.forEach(seg=>{
          const r = seg.getBoundingClientRect();
          const cx = r.left + r.width/2;
          if(cx >= xA && cx <= xB){
            const i = Number(seg.dataset.idx);
            if(Number.isFinite(i)) selIdx.add(i);
          }
        });
        updateSelectionUI();
    applySelectionStyles();
    applyMemberRowSelectionStyles();
        drag = null;
        return;
      }

      // finish create mode
      if(drag.kind==='create'){
        const sMin = (typeof drag._s==='number') ? drag._s : 0;
        const eMin = (typeof drag._e==='number') ? drag._e : (sMin + GRID_STEP_MIN);
        const conflicts = Array.isArray(drag._conflicts) ? drag._conflicts : [];

        // remove ghost
        try{ drag.seg.remove(); }catch(_e){}

        if(conflicts.length){
          const any = drag.timeline.querySelector('.seg[data-idx="'+conflicts[0]+'"]');
          if(any) flashConflict(any, conflicts.slice(1));
          drag = null;
          return;
        }

        // recompute with latest blocks (another edit might have happened)
        const current = normalizeBlocks(drag.team, Store.getUserDayBlocks(drag.member.id, selectedDay));
        const liveConf = findConflicts(current, -1, sMin, eMin, drag.team);
        if(liveConf.length){
          const any = drag.timeline.querySelector('.seg[data-idx="'+liveConf[0]+'"]');
          if(any) flashConflict(any, liveConf.slice(1));
          drag = null;
          renderAll();
          return;
        }

        // Ask role immediately after draw
        const member = drag.member;
        const team = drag.team;
        const actor = Auth.getUser();
        const startHM = UI.offsetToHM(team, sMin);
        const endHM = UI.offsetToHM(team, eMin);
        drag = null;

        showRolePickerAt(e.clientX, e.clientY, 'mailbox_manager', (role)=>{
          const nowCur = normalizeBlocks(team, Store.getUserDayBlocks(member.id, selectedDay));
          const conf2 = findConflicts(nowCur, -1, sMin, eMin, team);
          if(conf2.length){
            renderAll();
            const row = wrap.querySelector(`.members-row[data-id="${CSS.escape(member.id)}"]`);
            if(row){
              const any = row.querySelector('.timeline .seg');
              if(any) flashConflict(any, conf2);
            }
            return;
          }
          nowCur.push({ start: startHM, end: endHM, role: role || 'block' });
          const updated = normalizeBlocks(team, nowCur);
          Store.setUserDayBlocks(member.id, member.teamId, selectedDay, updated);
    requestGraphRefresh();
          if(actor){
            Store.addLog({
              ts: Date.now(),
              teamId: member.teamId,
              actorId: actor.id,
              actorName: actor.name||actor.username,
              action: 'SCHEDULE_CREATE',
              targetId: member.id,
              targetName: member.name||member.username,
              msg: `${actor.name||actor.username} created ${blockLabel(role||'block')} for ${member.name||member.username}`,
              detail: `${UI.DAYS[selectedDay]} ${startHM}-${endHM}`
            });
          }
          renderAll();
        });

        return;
      }
      drag.seg.classList.remove('dragging');
      const s = (typeof drag._s === 'number') ? drag._s : drag.s0;
      const e2 = (typeof drag._e === 'number') ? drag._e : drag.e0;

      // commit
      const updated = drag.blocks.slice();
      updated[drag.idx] = { ...updated[drag.idx], start: UI.offsetToHM(drag.team,s), end: UI.offsetToHM(drag.team,e2) };
      Store.setUserDayBlocks(drag.member.id, drag.member.teamId, selectedDay, updated);
    requestGraphRefresh();

      // log
      const actor = Auth.getUser();
      if(actor){
        Store.addLog({
          ts: Date.now(),
          teamId: drag.member.teamId,
          actorId: actor.id,
          actorName: actor.name||actor.username,
          action: 'SCHEDULE_UPDATE',
          targetId: drag.member.id,
          targetName: drag.member.name||drag.member.username,
          msg: `${actor.name||actor.username} updated schedule for ${drag.member.name||drag.member.username}`,
          detail: `${UI.DAYS[selectedDay]} ${updated[drag.idx].role} ${updated[drag.idx].start}-${updated[drag.idx].end}`
        });
        addAudit('SCHEDULE_UPDATE', drag.member.id, drag.member.name||drag.member.username, `${UI.DAYS[selectedDay]} ${updated[drag.idx].role} ${updated[drag.idx].start}-${updated[drag.idx].end}`);
      }
      drag = null;
      renderAll();
    });
  })();

  // Ctrl+C / Ctrl+V copy/paste within a member timeline
  const onKeydown = (ev)=>{
    if(!(ev.ctrlKey || ev.metaKey)) return;
    const tag = (ev.target && ev.target.tagName) ? ev.target.tagName.toLowerCase() : '';
    const inField = tag==='input' || tag==='textarea' || (ev.target && ev.target.isContentEditable);
    if(inField) return;

    // Copy/paste scheduling has been removed for Team Lead UX simplification.
  };
  window.addEventListener('keydown', onKeydown);


  // Delete / Backspace removes selected blocks immediately (when not typing)
  const onDeleteKey = (ev)=>{
    if(ev.key !== 'Delete' && ev.key !== 'Backspace') return;
    const tag = (ev.target && ev.target.tagName) ? ev.target.tagName.toLowerCase() : '';
    const inField = tag==='input' || tag==='textarea' || (ev.target && ev.target.isContentEditable);
    if(inField) return;
    if(selMemberId && selIdx && selIdx.size>0){
      ev.preventDefault();
      // Keyboard delete should be immediate (no confirm) for speed.
      deleteSelectedBlocks({ confirm: false });
    }
  };
  // Use capture to ensure Delete works instantly even if other handlers exist.
  document.addEventListener('keydown', onDeleteKey, true);
  // Cleanup when leaving page
  root._cleanup = ()=>{ window.removeEventListener('keydown', onKeydown); document.removeEventListener('keydown', onDeleteKey, true); };

  // Send schedule update notifications (Team Lead/Admin)
  const sendBtn = wrap.querySelector('#sendSchedule');
  const viewAcksBtn = wrap.querySelector('#viewAcks');
  const viewAuditBtn = wrap.querySelector('#viewAudit');
  const viewTrendBtn = wrap.querySelector('#viewTrend');
  const ackClose = wrap.querySelector('#ackClose');
  if(ackClose) ackClose.onclick = ()=>UI.closeModal('ackModal');
  const auditClose = wrap.querySelector('#auditClose');
  if(auditClose) auditClose.onclick = ()=>UI.closeModal('auditModal');
  const trendClose = wrap.querySelector('#trendClose');
  if(trendClose) trendClose.onclick = ()=>UI.closeModal('trendModal');

  function addAudit(action, targetId, targetName, detail){
    if(!Store.addAudit) return;
    const actor = Auth.getUser();
    if(!actor) return;
    Store.addAudit({
      id: (crypto && crypto.randomUUID) ? crypto.randomUUID() : ('a-'+Date.now()+Math.random().toString(16).slice(2)),
      ts: Date.now(),
      teamId: selectedTeamId,
      weekStartISO,
      actorId: actor.id,
      actorName: actor.name||actor.username,
      action,
      targetId: targetId||null,
      targetName: targetName||null,
      detail: detail||''
    });
  }

  function renderAckModal(notif){
    const title = wrap.querySelector('#ackTitle');
    const sub = wrap.querySelector('#ackSub');
    const body = wrap.querySelector('#ackBody');
    if(title) title.textContent = 'Acknowledgements';
    if(sub) sub.textContent = notif ? `Team ${Config.teamById(selectedTeamId).label} • Week of ${weekStartISO}` : 'No sent schedule yet for this week.';
    if(!body) return;
    if(!notif){ body.innerHTML = '<div class="muted">No schedule notification has been sent yet.</div>'; return; }
    const members = getMembersForView(selectedTeamId).filter(u=>u.role===Config.ROLES.MEMBER);
    const rows = members.map(m=>{
      const ts = notif.acks && notif.acks[m.id] ? new Date(notif.acks[m.id]).toLocaleString('en-US', { timeZone: Config.TZ }) : null;
      return `<div class="ack-card">
        <div><div class="font-extrabold">${UI.esc(m.name||m.username)}</div><div class="small muted">${UI.esc(m.username||'')}</div></div>
        <div class="small text-right">
          ${ts ? `<span class="badge badge-ok">✅ Acked</span><div class="small muted mt-1">${UI.esc(ts)}</div>` : `<span class="badge">⏳ Pending</span>`}
        </div>
      </div>`;
    }).join('');
    body.innerHTML = `<div class="small muted mb-3">${UI.esc(notif.title||'Schedule Updated')} • Sent ${new Date(notif.ts).toLocaleString('en-US', { timeZone: Config.TZ })}</div>${rows || '<div class="muted">No members found.</div>'}`;
  }

  function latestTeamNotif(){
    const list = Store.getTeamNotifs ? Store.getTeamNotifs(selectedTeamId) : [];
    return (list||[]).find(n => n && n.weekStartISO === weekStartISO) || (list||[])[0] || null;
  }

  function renderAuditModal(){
    const title = wrap.querySelector('#auditTitle');
    const sub = wrap.querySelector('#auditSub');
    const body = wrap.querySelector('#auditBody');
    if(title) title.textContent = 'Audit History';
    if(sub) sub.textContent = `Team ${Config.teamById(selectedTeamId).label} • Week of ${weekStartISO} (Manila)`;
    if(!body) return;
    const entries = Store.getWeekAudit ? Store.getWeekAudit(selectedTeamId, weekStartISO) : [];
    if(!entries.length){
      body.innerHTML = '<div class="muted">No audit events recorded for this week yet.</div>';
      return;
    }
    body.innerHTML = entries.map(e=>{
      const ts = new Date(e.ts).toLocaleString('en-US', { timeZone: Config.TZ });
      const who = UI.esc(e.actorName||'');
      const tgt = e.targetName ? ` • <span class="small font-extrabold">${UI.esc(e.targetName)}</span>` : '';
      const det = e.detail ? `<div class="small muted mt-1 whitespace-pre-wrap">${UI.esc(e.detail)}</div>` : '';
      return `<div class="audit-row">
        <div class="audit-left">
          <div class="font-black">${UI.esc(e.action||'EVENT')}${tgt}</div>
          <div class="small muted">${who}</div>
          ${det}
        </div>
        <div class="audit-right small muted">${UI.esc(ts)}</div>
      </div>`;
    }).join('');
  }

  function dayHealthForWeek(team, members, weekStart, dayIdx){
    const iso = UI.addDaysISO(weekStart, Number(dayIdx)-1);
    const s = getAutoSettingsForTeam(team.id);
    const targetCall = (s.callMinPerHour||2);
    const active = (members||[]).filter(m=>{
      const leave = Store.getLeave ? Store.getLeave(m.id, iso) : null;
      const rest = isRestDay(m.teamId, m.id, iso);
      return !(leave || rest);
    });
    const planMap = {};
    for(const u of active){
      planMap[u.id] = normalizeBlocks(team, Store.getUserDayBlocks(u.id, dayIdx));
    }
    const cov = hourCoverage(team, active, planMap);
    const ok = cov.reduce((a,c)=>a+((c.mailboxMin===1 && c.callMin>=targetCall)?1:0),0);
    const tot = cov.length || 1;
    return Math.round((ok/tot)*100);
  }

  function renderTrendModal(){
    const title = wrap.querySelector('#trendTitle');
    const sub = wrap.querySelector('#trendSub');
    const body = wrap.querySelector('#trendBody');
    if(title) title.textContent = 'Health Trend';
    if(sub) sub.textContent = `Team ${Config.teamById(selectedTeamId).label} • last 8 weeks (Manila)`;
    if(!body) return;

    const team = Config.teamById(selectedTeamId);
    const members = getMembersForView(selectedTeamId).filter(u=>u.role===Config.ROLES.MEMBER);
    const weeks = [];
    for(let i=7;i>=0;i--){
      weeks.push(UI.addDaysISO(weekStartISO, -7*i));
    }
    const points = weeks.map(ws=>{
      const pcts = [1,2,3,4,5].map(d=>dayHealthForWeek(team, members, ws, d));
      const avg = Math.round(pcts.reduce((a,b)=>a+b,0)/pcts.length);
      return { ws, avg, pcts };
    });
    const max = 100, min = 0;
    const w = 560, h = 140, pad = 18;
    const xStep = (w-2*pad)/(points.length-1||1);
    const y = (v)=> pad + (h-2*pad) * (1 - (v-min)/(max-min));
    const poly = points.map((p,i)=>`${pad + i*xStep},${y(p.avg)}`).join(' ');
    body.innerHTML = `
      <div class="trend-card">
        <div class="small muted mb-3">Average Health (Mon–Fri). Lower values usually indicate coverage gaps caused by Rest Days or Leaves.</div>
        <svg class="trend-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="Health trend">
          <polyline points="${poly}" fill="none" stroke="currentColor" stroke-width="2" opacity="0.95" />
          ${points.map((p,i)=>`<circle cx="${pad + i*xStep}" cy="${y(p.avg)}" r="3" fill="currentColor" opacity="0.95" />`).join('')}
          <line x1="${pad}" y1="${y(50)}" x2="${w-pad}" y2="${y(50)}" stroke="currentColor" opacity="0.18" />
        </svg>
        <div class="trend-grid">
          ${points.map(p=>{
            return `<div class="trend-item">
              <div class="small muted">Week of</div>
              <div class="font-black">${UI.esc(p.ws)}</div>
              <div class="badge badge-ok mt-2">${UI.esc(p.avg)}%</div>
              <div class="small muted mt-2">Mon–Fri: ${p.pcts.join('% / ')}%</div>
            </div>`;
          }).join('')}
        </div>
      </div>
    `;
  }

  if(viewAcksBtn){
    viewAcksBtn.onclick = ()=>{
      renderAckModal(latestTeamNotif());
      UI.openModal('ackModal');
    };
  }

  if(viewAuditBtn){
    viewAuditBtn.onclick = ()=>{
      renderAuditModal();
      UI.openModal('auditModal');
    };
  }

  if(viewTrendBtn){
    viewTrendBtn.onclick = ()=>{
      renderTrendModal();
      UI.openModal('trendModal');
    };
  }

  if(sendBtn){
    sendBtn.onclick = async ()=>{
      // Warn if sending for a past week (easy mistake)
      if(String(weekStartISO) < String(currentWeekStartISO())){
        const ok = await UI.confirm({ title:'Send Past Week', message:'You are about to send updates for a PAST week. Continue?', okText:'Continue', danger:true });
        if(!ok) return;
      }
      const members = getMembersForView(selectedTeamId).filter(u=>u.role===Config.ROLES.MEMBER);
      if(!members.length){ alert('No members to notify on this team.'); return; }
      // Notice if some are unavailable today (rest/leave) to nudge TL for adjustments
      const isoToday = isoForDay(selectedDay);
      const unavailable = members.filter(m=>{
        const leave = Store.getLeave ? Store.getLeave(m.id, isoToday) : null;
        const rest = isRestDay(m.teamId, m.id, isoToday);
        return !!leave || !!rest;
      });
      if(unavailable.length){
        alert(`${unavailable.length} member(s) are unavailable on ${isoToday} (rest/leave). Auto mode can still adjust by skipping them, but please review coverage.`);
      }

      const team = Config.teamById(selectedTeamId);

      // Build per-member diffs so we only notify affected members.
      const prev = latestTeamNotif();
      const prevSnapshots = (prev && prev.snapshots && typeof prev.snapshots === 'object') ? prev.snapshots : {};
      const prevHashes = (prev && prev.snapshotHashes && typeof prev.snapshotHashes === 'object') ? prev.snapshotHashes : {};

      const formatLongDate = (iso)=>{
        try{
          return new Date(String(iso||'')+'T00:00:00Z').toLocaleDateString('en-US', {
            weekday:'long', month:'long', day:'2-digit', year:'numeric', timeZone: Config.TZ
          });
        }catch(_){ return String(iso||''); }
      };

      const snapForUser = (userId)=>{
        const days = {};
        for(let d=0; d<7; d++){
          const bl = normalizeBlocks(team, Store.getUserDayBlocks(userId, d));
          days[String(d)] = (bl||[]).map(b=>({ role:String(b.role||''), start:String(b.start||''), end:String(b.end||'') }));
        }
        return { days };
      };

      const diffSnap = (prevSnap, curSnap)=>{
        const changes = [];
        const p = (prevSnap && prevSnap.days) ? prevSnap : { days:{} };
        const c = (curSnap && curSnap.days) ? curSnap : { days:{} };
        for(let d=0; d<7; d++){
          const key = String(d);
          const pv = Array.isArray(p.days[key]) ? p.days[key] : [];
          const cv = Array.isArray(c.days[key]) ? c.days[key] : [];
          const toK = (b)=>`${String(b.role||'')}|${String(b.start||'')}-${String(b.end||'')}`;
          const ps = new Set(pv.map(toK));
          const cs = new Set(cv.map(toK));
          const added = cv.filter(b=>!ps.has(toK(b)));
          const removed = pv.filter(b=>!cs.has(toK(b)));
          if(added.length || removed.length){
            changes.push({
              dayIndex: d,
              iso: isoForDay(d),
              added,
              removed
            });
          }
        }
        return changes;
      };

      const buildMessage = (changes)=>{
        if(!changes || !changes.length){
          return 'Schedule Updated.';
        }
        const first = changes[0];
        const dateLong = formatLongDate(first.iso);
        let primary = null;
        let action = '';
        if(first.added && first.added.length){
          primary = first.added[0];
          action = 'added';
        }else if(first.removed && first.removed.length){
          primary = first.removed[0];
          action = 'removed';
        }
        const label = primary ? blockLabel(primary.role) : 'Changes';
        const tRange = primary ? ` (${primary.start}-${primary.end})` : '';
        const extra = Math.max(0, changes.reduce((a,c)=>a+((c.added||[]).length+(c.removed||[]).length),0) - 1);
        const extraTxt = extra ? ` (and ${extra} more change${extra===1?'':'s'})` : '';
        const summary = `Schedule Updated: ${label} ${action || 'updated'} on ${dateLong}.${extraTxt}`;

        const lines = [summary];
        const details = [];
        for(const ch of changes.slice(0, 4)){
          const dLong = formatLongDate(ch.iso);
          for(const a of (ch.added||[]).slice(0, 4)){
            details.push(`• Added: ${blockLabel(a.role)} (${a.start}-${a.end}) — ${dLong}`);
          }
          for(const r of (ch.removed||[]).slice(0, 4)){
            details.push(`• Removed: ${blockLabel(r.role)} (${r.start}-${r.end}) — ${dLong}`);
          }
        }
        if(details.length){
          lines.push('', 'Details:', ...details);
        }
        lines.push('', 'Please acknowledge.');
        return lines.join('\n');
      };

      const recipients = [];
      const userMessages = {};
      const snapshotHashes = {};
      const snapshots = {};
      const affectedDates = new Set();

      for(const m of members){
        const curSnap = snapForUser(m.id);
        const curHash = (Store._hash ? Store._hash(JSON.stringify(curSnap)) : String(Date.now()));
        snapshotHashes[m.id] = curHash;
        snapshots[m.id] = curSnap;

        const prevHash = prevHashes[m.id];
        if(prevHash && String(prevHash) === String(curHash)) continue; // unchanged

        const changes = diffSnap(prevSnapshots[m.id], curSnap);
        if(!changes.length && prevHash) continue; // same content but no diff (guard)

        recipients.push(m.id);
        userMessages[m.id] = buildMessage(changes);
        for(const ch of changes){ affectedDates.add(ch.iso); }
      }

      if(!recipients.length){
        UI.toast('No member schedule changes detected for this week. Nothing to send.', 'info');
        return;
      }

      const notif = {
        id: (crypto && crypto.randomUUID) ? crypto.randomUUID() : ('n-'+Date.now()+Math.random().toString(16).slice(2)),
        ts: Date.now(),
        teamId: selectedTeamId,
        weekStartISO,
        fromId: me.id,
        fromName: me.name||me.username,
        title: 'Schedule Updated',
        body: `Schedule updates were applied for week of ${weekStartISO}. Please acknowledge.`,
        recipients,
        acks: {},
        userMessages,
        snapshotHashes,
        snapshots
      };

      Store.addNotif(notif);
      try{ ('BroadcastChannel' in window) && new BroadcastChannel('ums_schedule_updates').postMessage({ type:'notify', notifId: notif.id }); }catch(e){}

      const datesTxt = Array.from(affectedDates).sort().join(', ');
      Store.addLog({
        ts: Date.now(),
        teamId: selectedTeamId,
        actorId: me.id,
        actorName: me.name||me.username,
        action: 'SCHEDULE_APPLY',
        msg: 'Schedule changes applied and sent to members for visibility.',
        detail: `WeekStart ${weekStartISO} • Recipients ${recipients.length} • AffectedDates ${datesTxt}`
      });
      addAudit('SCHEDULE_APPLY', null, null, `Applied changes and notified ${recipients.length} member(s). Affected: ${datesTxt || '—'}`);

      // Popout/Toast for Team Lead confirmation.
      UI.toast('The Schedule Changes have been applied and sent to members for visibility.', 'success');

      // Open acknowledgements view for quick verification.
      renderAckModal(notif);
      UI.openModal('ackModal');
    };
  }

  // Exports
  wrap.querySelector('#exportSchedule').onclick = ()=>{
    const members = getMembersForView(selectedTeamId);
    const rows = [["Team","Day","User","Role","Start","End"]];
    for(const m of members){
      const team = Config.teamById(m.teamId);
      for(let d=0; d<7; d++){
        const bl = Store.getUserDayBlocks(m.id, d);
        for(const b of (bl||[])) rows.push([team.label, UI.DAYS[d], m.name||m.username, blockLabel(b.role), b.start, b.end]);
      }
    }
    UI.downloadCSV('team_schedules.csv', rows);
  };
  wrap.querySelector('#exportWorkload').onclick = ()=>{
    const members = getMembersForView(selectedTeamId);
    const weekStartMs = UI.manilaWeekStartMondayMs();
    const cases = Store.getCases();
    const rows = [["User","Team","MailboxHours","BackOfficeHours","CallOnqueHours","CasesAssignedThisWeek"]];
    for(const m of members){
      const totals = { mailbox:0, back:0, call:0 };
      for(let d=0; d<7; d++){
        const bl = Store.getUserDayBlocks(m.id, d);
        const t = Config.teamById(m.teamId);
        for(const b of (bl||[])){
          const mins = Math.max(0, UI.offsetFromShiftStart(t,b.end) - UI.offsetFromShiftStart(t,b.start));
          if(b.role==='back_office') totals.back += mins;
          else if(b.role==='call_onqueue' || b.role==='call_available') totals.call += mins;
          else if(b.role==='mailbox_manager' || b.role==='mailbox_call') totals.mailbox += mins;
        }
      }
      const toH = m=> (m/60).toFixed(2);
      const caseCount = cases.filter(c=>c.assigneeId===m.id && (c.createdAt||0) >= weekStartMs).length;
      rows.push([m.name||m.username, Config.teamById(m.teamId).label, toH(totals.mailbox), toH(totals.back), toH(totals.call), caseCount]);
    }
    UI.downloadCSV('team_workload.csv', rows);
  };

  renderDayTabs();
  renderAll();
  })().catch((e)=>{
    try{ }catch(_){ }
    try{
      const msg = (e && (e.stack || e.message || e)) ? String(e.stack || e.message || e) : 'Unknown error';
      root.innerHTML = '<div class="h1">Members</div><div class="muted whitespace-pre-wrap">'+(UI&&UI.esc?UI.esc(msg):msg)+'</div>';
    }catch(_){ }
  });
};
