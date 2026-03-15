/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED. */
// public/js/pages/manila_calendar.js — Manila Vacation Calendar
// Uses /api/calendar/records — dedicated endpoint that reads the calendar token server-side.

(function () {
  'use strict';

  // ─── Leave type colours ─────────────────────────────────────────────────────
  const LEAVE_COLORS = {
    VL:     { bg:'rgba(20,184,166,.18)',  border:'rgba(20,184,166,.7)',  text:'#2dd4bf', dot:'#14b8a6' },
    HL:     { bg:'rgba(59,130,246,.18)',  border:'rgba(59,130,246,.7)',  text:'#60a5fa', dot:'#3b82f6' },
    SL:     { bg:'rgba(239,68,68,.15)',   border:'rgba(239,68,68,.6)',   text:'#f87171', dot:'#ef4444' },
    OB:     { bg:'rgba(168,85,247,.15)',  border:'rgba(168,85,247,.6)',  text:'#c084fc', dot:'#a855f7' },
    WBD:    { bg:'rgba(234,179,8,.15)',   border:'rgba(234,179,8,.6)',   text:'#facc15', dot:'#eab308' },
    LEAVE:  { bg:'rgba(249,115,22,.15)',  border:'rgba(249,115,22,.6)',  text:'#fb923c', dot:'#f97316' },
    DEFAULT:{ bg:'rgba(56,189,248,.15)',  border:'rgba(56,189,248,.6)',  text:'#38bdf8', dot:'#0ea5e9' },
  };

  function getLeaveColor(note) {
    const n = String(note || '').toUpperCase();
    if (n.includes('WBD'))                           return LEAVE_COLORS.WBD;
    if (n.includes('OB'))                            return LEAVE_COLORS.OB;
    if (n.includes('HL'))                            return LEAVE_COLORS.HL;
    if (n.includes('VL'))                            return LEAVE_COLORS.VL;
    if (n.includes('SL'))                            return LEAVE_COLORS.SL;
    if (n.includes('HOLIDAY') || n.includes('LEAVE'))return LEAVE_COLORS.LEAVE;
    return LEAVE_COLORS.DEFAULT;
  }

  function esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function getBearerToken() {
    try { return (window.CloudAuth && typeof CloudAuth.accessToken === 'function') ? CloudAuth.accessToken() : ''; } catch(_){ return ''; }
  }

  function fmtDate(d) {
    if (!d) return '—';
    try {
      return new Date(d).toLocaleDateString('en-PH', { month:'short', day:'numeric', year:'numeric' });
    } catch(_) { return String(d); }
  }

  // Parse QB date strings: "2026-03-02" or ISO
  function parseDate(str) {
    if (!str) return null;
    try {
      const s = String(str).trim();
      // QB often returns "2026-03-02" — treat as local midnight
      const d = s.length === 10 ? new Date(s + 'T00:00:00') : new Date(s);
      return isNaN(d.getTime()) ? null : d;
    } catch(_) { return null; }
  }

  function isSameDay(a, b) {
    return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
  }

  function dateInRange(d, start, end) {
    const t = d.getTime();
    if (!start) return false;
    const s = start.getTime();
    const e = end ? end.getTime() : s;
    return t >= s && t <= e;
  }

  // ─── Normalize raw QB run-report data ────────────────────────────────────────
  // QB run-report returns: data = array of { [fieldId]: { value } }
  // fields = array of { id, label }
  function normalizeRecords(apiResponse) {
    const rawRows  = Array.isArray(apiResponse.records) ? apiResponse.records : [];
    const fields   = Array.isArray(apiResponse.fields)  ? apiResponse.fields  : [];
    const mappings = apiResponse.fieldMappings || {};

    // Build label → id lookup
    const byLabel = {};
    fields.forEach(f => {
      byLabel[String(f.label || '').toLowerCase().trim()] = String(f.id);
    });

    function findId(labelHints) {
      for (const hint of labelHints) {
        const key = hint.toLowerCase().trim();
        // Exact match first
        if (byLabel[key]) return byLabel[key];
        // Partial match
        for (const [lbl, id] of Object.entries(byLabel)) {
          if (lbl.includes(key)) return id;
        }
      }
      return null;
    }

    // Resolve field IDs — use admin-configured mappings, fall back to label auto-detect
    const empId   = mappings.fieldEmployee  || findId(['employee - username','employee','username','name','user']);
    const noteId  = mappings.fieldNote      || findId(['activity/note','activity','note','leave type','type']);
    const startId = mappings.fieldStartDate || findId(['holiday/training start date','start date','start','from','begin date']);
    const endId   = mappings.fieldEndDate   || findId(['holiday/training end date','end date','end','to','finish date']);

    // Log for debug
    console.log('[Manila Calendar] Field IDs resolved:', { empId, noteId, startId, endId });
    console.log('[Manila Calendar] Available fields:', fields.map(f => `#${f.id} "${f.label}"`).join(', '));
    console.log('[Manila Calendar] Raw rows sample:', rawRows.slice(0,2));

    if (!empId || !startId) {
      console.warn('[Manila Calendar] Could not auto-detect required field IDs. Configure field mappings in Calendar Settings.');
    }

    return rawRows.map((row, idx) => {
      // QB run-report row format: { [fieldId]: { value } }
      // value can be: string, number, boolean, or nested object {name, email, id} / {url, label}
      function unwrapQBValue(val) {
        if (val === null || val === undefined) return '';
        if (typeof val === 'object') {
          // User field: { id, email, name } or { id, userName, screenName }
          if (val.name)       return String(val.name);
          if (val.screenName) return String(val.screenName);
          if (val.userName)   return String(val.userName);
          if (val.email)      return String(val.email);
          // URL/rich text field: { url, label }
          if (val.label)      return String(val.label);
          if (val.url)        return String(val.url);
          // Record reference
          if (val.value !== undefined) return unwrapQBValue(val.value);
          // Array (multi-select)
          if (Array.isArray(val)) return val.map(unwrapQBValue).filter(Boolean).join(', ');
          return '';
        }
        return String(val);
      }

      function fv(id) {
        if (!id) return '';
        const cell = row[String(id)];
        if (cell === null || cell === undefined) return '';
        if (typeof cell === 'object' && Object.prototype.hasOwnProperty.call(cell, 'value')) {
          return unwrapQBValue(cell.value);
        }
        return unwrapQBValue(cell);
      }

      const startDate = parseDate(fv(startId));
      const endDate   = parseDate(fv(endId)) || startDate;

      return {
        id: idx,
        employee: String(fv(empId) || '').trim() || 'N/A',
        note:     String(fv(noteId) || '').trim(),
        startDate,
        endDate,
        startRaw: fv(startId),
        endRaw:   fv(endId),
      };
    }).filter(r => r.startDate !== null);
  }

  // ─── API fetch ───────────────────────────────────────────────────────────────
  async function fetchCalendarRecords() {
    const tok = getBearerToken();
    const r = await fetch('/api/calendar/records', {
      headers: { 'Authorization': 'Bearer ' + tok }
    });
    if (!r.ok) {
      const txt = await r.text();
      throw new Error('HTTP ' + r.status + ': ' + txt.slice(0,200));
    }
    const data = await r.json();
    if (!data.ok) throw new Error(data.message || data.error || 'Calendar not configured');
    return data;
  }

  // ─── CALENDAR VIEW ──────────────────────────────────────────────────────────
  function renderCalendarView(container, records, currentDate, onMonthChange) {
    const year  = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const today = new Date();

    const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

    const firstDay  = new Date(year, month, 1).getDay();
    const totalDays = new Date(year, month + 1, 0).getDate();
    const prevTotal = new Date(year, month, 0).getDate();

    function eventsForDate(d) {
      return records.filter(r => dateInRange(d, r.startDate, r.endDate || r.startDate));
    }

    // Build 42-cell grid
    const cells = [];
    for (let i = 0; i < firstDay; i++)
      cells.push({ day: prevTotal - firstDay + 1 + i, type:'prev' });
    for (let d = 1; d <= totalDays; d++)
      cells.push({ day: d, type:'cur' });
    while (cells.length < 42)
      cells.push({ day: cells.length - firstDay - totalDays + 1, type:'next' });

    // Build rows, skip trailing "next" rows
    const rows = [];
    for (let r = 0; r < 6; r++) {
      const row = cells.slice(r*7, r*7+7);
      if (row.every(c => c.type !== 'cur')) continue;
      rows.push(row);
    }

    const MAX = 3;

    const gridRows = rows.map(row => {
      const cells = row.map(cell => {
        const m = cell.type==='prev' ? month-1 : cell.type==='next' ? month+1 : month;
        const d = new Date(year, m, cell.day);
        const evs   = cell.type==='cur' ? eventsForDate(d) : [];
        const isToday = cell.type==='cur' && isSameDay(d, today);
        const isOther = cell.type !== 'cur';
        const visible = evs.slice(0, MAX);
        const extra   = evs.length - MAX;

        const bars = visible.map(ev => {
          const c = getLeaveColor(ev.note);
          return `<div class="mc-event-bar" style="background:${c.bg};border-left:2px solid ${c.dot};color:${c.text};" title="${esc(ev.employee+' | '+ev.note)}">
            <span class="mc-event-name">${esc(ev.employee)}</span>${ev.note ? `<span class="mc-event-note"> | ${esc(ev.note)}</span>` : ''}
          </div>`;
        }).join('');

        const todayLabel = isToday
          ? `<div class="mc-today-label"><span class="mc-today-pip"></span>Today</div>`
          : '';
        return `<div class="mc-cell${isOther?' mc-cell-other':''}${isToday?' mc-cell-today':''}">
          ${todayLabel}
          <div class="mc-day-num${isToday?' mc-today-num':''}">${cell.day}</div>
          <div class="mc-events">${bars}${extra>0?`<div class="mc-overflow">+${extra} more</div>`:''}</div>
        </div>`;
      }).join('');
      return `<div class="mc-row">${cells}</div>`;
    }).join('');

    const headerDays = DAYS.map(d=>`<div class="mc-header-day">${d}</div>`).join('');

    const legendItems = Object.entries(LEAVE_COLORS)
      .filter(([k])=>k!=='DEFAULT')
      .map(([k,c])=>`<span class="mc-legend-item"><span class="mc-legend-dot" style="background:${c.dot};"></span>${k}</span>`)
      .join('');

    const todayInView = (today.getFullYear()===year && today.getMonth()===month);
    const DAY_ABBR = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const livePill = todayInView
      ? `<div class="mc-today-live-pill"><span class="mc-today-pip"></span>${DAY_ABBR[today.getDay()]} · ${MONTHS[month].slice(0,3)} ${today.getDate()}</div>`
      : '';

    container.innerHTML = `
      <div class="mc-calendar">
        <div class="mc-nav">
          <div class="mc-nav-left">
            <div class="mc-month-title">${MONTHS[month]} ${year}</div>
            ${livePill}
          </div>
          <div class="mc-nav-btns">
            <button class="mc-nav-btn" id="mcPrev">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <button class="mc-nav-btn mc-today-btn" id="mcToday">TODAY</button>
            <button class="mc-nav-btn" id="mcNext">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
        </div>
        <div class="mc-grid-header">${headerDays}</div>
        <div class="mc-grid">${gridRows}</div>
        <div class="mc-legend">${legendItems}</div>
      </div>`;

    container.querySelector('#mcPrev').onclick = () => { const d=new Date(currentDate); d.setMonth(d.getMonth()-1); onMonthChange(d); };
    container.querySelector('#mcNext').onclick = () => { const d=new Date(currentDate); d.setMonth(d.getMonth()+1); onMonthChange(d); };
    container.querySelector('#mcToday').onclick= () => onMonthChange(new Date());
  }

  // ─── LIST VIEW ───────────────────────────────────────────────────────────────
  function renderListView(container, records) {
    // Show ALL records sorted by start date — no month filter on list view
    const sorted = [...records].sort((a,b) => (a.startDate||0) - (b.startDate||0));

    if (!sorted.length) {
      container.innerHTML = `<div class="mc-empty">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <div class="mc-empty-title">No records loaded</div>
        <div class="mc-empty-sub">Click Reload or check Calendar Settings configuration.</div>
      </div>`;
      return;
    }

    const rows = sorted.map((r, idx) => {
      const c = getLeaveColor(r.note);
      const single = r.endDate && isSameDay(r.startDate, r.endDate);
      const dateStr = single ? fmtDate(r.startDate) : `${fmtDate(r.startDate)} → ${fmtDate(r.endDate||r.startDate)}`;
      let duration = '1 day';
      if (r.endDate && !isSameDay(r.startDate, r.endDate)) {
        const diff = Math.round((r.endDate - r.startDate)/(1000*60*60*24)) + 1;
        duration = diff + (diff===1?' day':' days');
      }
      const initial = (r.employee||'?').charAt(0).toUpperCase();
      return `<tr class="mc-list-row">
        <td class="mc-list-td mc-list-num"><span class="mc-list-num-pill">${idx+1}</span></td>
        <td class="mc-list-td">
          <div class="mc-list-employee">
            <div class="mc-list-avatar">${esc(initial)}</div>
            <span>${esc(r.employee)}</span>
          </div>
        </td>
        <td class="mc-list-td">
          <span class="mc-type-badge" style="background:${c.bg};border:1px solid ${c.border};color:${c.text};">${esc(r.note)||'—'}</span>
        </td>
        <td class="mc-list-td mc-list-date">${esc(dateStr)}</td>
        <td class="mc-list-td"><span class="mc-dur-badge">${duration}</span></td>
      </tr>`;
    }).join('');

    container.innerHTML = `
      <div class="mc-list-outer">
        <div class="mc-list-scroll">
          <table class="mc-list-table">
            <thead class="mc-list-thead">
              <tr class="mc-list-head">
                <th class="mc-list-th" style="width:44px">#</th>
                <th class="mc-list-th">Employee</th>
                <th class="mc-list-th">Activity / Leave Type</th>
                <th class="mc-list-th">Date Range</th>
                <th class="mc-list-th">Duration</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  }

  // ─── PAGE INIT ───────────────────────────────────────────────────────────────
  async function init(root) {
    root.innerHTML = `
      <div class="mc-page-shell" id="mcShell">
        <div class="mc-page-header">
          <div class="mc-header-left">
            <div class="mc-header-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            </div>
            <div>
              <div class="mc-header-title">Manila Calendar</div>
              <div class="mc-header-sub">Team vacation &amp; activity schedule</div>
            </div>
          </div>
          <div class="mc-header-actions">
            <div class="mc-view-tabs">
              <button class="mc-view-tab mc-view-tab-active" id="mcTabCalendar">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg>Calendar
              </button>
              <button class="mc-view-tab" id="mcTabList">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/></svg>List
              </button>
            </div>
            <button class="mc-reload-btn" id="mcReload">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>Reload
            </button>
          </div>
        </div>
        <div class="mc-status-bar" id="mcStatus" style="display:none;"></div>
        <div class="mc-content-area" id="mcContent">
          <div class="mc-loading"><div class="mc-spinner"></div><div class="mc-loading-text">Loading calendar…</div></div>
        </div>
      </div>`;

    let view = 'calendar';
    let currentDate = new Date();
    let allRecords = [];

    const tabCal  = root.querySelector('#mcTabCalendar');
    const tabList = root.querySelector('#mcTabList');
    const content = root.querySelector('#mcContent');
    const statusEl= root.querySelector('#mcStatus');

    function setStatus(msg, type) {
      if (!statusEl) return;
      if (!msg) { statusEl.style.display='none'; return; }
      statusEl.style.display='';
      statusEl.className = 'mc-status-bar mc-status-'+(type||'info');
      statusEl.textContent = msg;
    }

    function setView(v) {
      view = v;
      tabCal.classList.toggle('mc-view-tab-active', v==='calendar');
      tabList.classList.toggle('mc-view-tab-active', v==='list');
      render();
    }

    function render() {
      if (!content) return;
      if (view==='calendar') {
        renderCalendarView(content, allRecords, currentDate, d => { currentDate=d; render(); });
      } else {
        renderListView(content, allRecords);
      }
    }

    async function load() {
      if (!content) return;
      content.innerHTML = `<div class="mc-loading"><div class="mc-spinner"></div><div class="mc-loading-text">Fetching records…</div></div>`;
      setStatus('');
      try {
        const data = await fetchCalendarRecords();
        allRecords = normalizeRecords(data);
        const n = allRecords.length;
        setStatus('✓ ' + n + ' record' + (n!==1?'s':'') + ' loaded', 'success');
        setTimeout(() => setStatus(''), 4000);
        render();
      } catch(err) {
        const msg = String(err && err.message || err);
        const isConfig = msg.toLowerCase().includes('not configured') || msg.toLowerCase().includes('calendar not configured');
        content.innerHTML = `<div class="mc-empty ${isConfig?'mc-unconfigured':'mc-error'}">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
            ${isConfig
              ? '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'
              : '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'}
          </svg>
          <div class="mc-empty-title">${isConfig ? 'Calendar Not Configured' : 'Failed to Load'}</div>
          <div class="mc-empty-sub">${esc(msg)}</div>
          ${isConfig ? '<div class="mc-empty-sub" style="margin-top:6px;opacity:.6;">Settings → Admin Controls → Calendar Settings</div>' : ''}
        </div>`;
        setStatus('❌ ' + msg.slice(0,80), 'error');
      }
    }

    tabCal.onclick  = () => setView('calendar');
    tabList.onclick = () => setView('list');
    root.querySelector('#mcReload').onclick = () => load();

    await load();
  }

  window.Pages = window.Pages || {};
  window.Pages['manila_calendar'] = init;
})();
