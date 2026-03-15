/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED. */
// public/js/pages/manila_calendar.js
// Manila Vacation Calendar — Premium enterprise page
// Data source: Global Calendar QB Settings (configured by Super Admin)
// Available to all authenticated users

(function () {
  const LEAVE_COLORS = {
    'VL':   { bg: 'rgba(20,184,166,.18)', border: 'rgba(20,184,166,.7)',  text: '#2dd4bf', dot: '#14b8a6' },
    'HL':   { bg: 'rgba(59,130,246,.18)', border: 'rgba(59,130,246,.7)',  text: '#60a5fa', dot: '#3b82f6' },
    'SL':   { bg: 'rgba(239,68,68,.15)',  border: 'rgba(239,68,68,.6)',   text: '#f87171', dot: '#ef4444' },
    'OB':   { bg: 'rgba(168,85,247,.15)', border: 'rgba(168,85,247,.6)',  text: '#c084fc', dot: '#a855f7' },
    'WBD':  { bg: 'rgba(234,179,8,.15)',  border: 'rgba(234,179,8,.6)',   text: '#facc15', dot: '#eab308' },
    'LEAVE':{ bg: 'rgba(249,115,22,.15)', border: 'rgba(249,115,22,.6)',  text: '#fb923c', dot: '#f97316' },
    'DEFAULT':{ bg: 'rgba(56,189,248,.15)',border:'rgba(56,189,248,.6)',  text: '#38bdf8', dot: '#0ea5e9' },
  };

  function getLeaveColor(note) {
    const n = String(note || '').toUpperCase();
    if (n.includes('WBD'))    return LEAVE_COLORS.WBD;
    if (n.includes('OB'))     return LEAVE_COLORS.OB;
    if (n.includes('HL'))     return LEAVE_COLORS.HL;
    if (n.includes('VL'))     return LEAVE_COLORS.VL;
    if (n.includes('SL'))     return LEAVE_COLORS.SL;
    if (n.includes('HOLIDAY') || n.includes('LEAVE')) return LEAVE_COLORS.LEAVE;
    return LEAVE_COLORS.DEFAULT;
  }

  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function getBearerToken() {
    return (window.CloudAuth && typeof CloudAuth.accessToken === 'function') ? CloudAuth.accessToken() : '';
  }

  function fmtDate(d) {
    if (!d) return '—';
    try {
      const dt = new Date(d);
      if (isNaN(dt)) return String(d);
      return dt.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch(_) { return String(d); }
  }

  function parseDateSafe(str) {
    if (!str) return null;
    try {
      // Handle YYYY-MM-DD or ISO strings
      const d = new Date(String(str).includes('T') ? str : str + 'T00:00:00');
      return isNaN(d) ? null : d;
    } catch(_) { return null; }
  }

  function isSameDay(a, b) {
    return a.getFullYear() === b.getFullYear() &&
           a.getMonth()    === b.getMonth()    &&
           a.getDate()     === b.getDate();
  }

  function dateInRange(d, start, end) {
    const t = d.getTime();
    const s = start ? start.getTime() : null;
    const e = end   ? end.getTime()   : null;
    if (s && e) return t >= s && t <= e;
    if (s) return isSameDay(d, start);
    return false;
  }

  async function fetchCalendarData(settings) {
    const { realm, tableId, qid } = settings;
    if (!realm || !tableId) throw new Error('Calendar not configured. Ask your Super Admin to configure Quickbase Calendar Settings.');
    const tok = getBearerToken();
    const params = new URLSearchParams({ realm, tableId, qid: qid || '1' });
    const r = await fetch('/api/quickbase/monitoring?' + params.toString(), {
      headers: { 'Authorization': 'Bearer ' + tok }
    });
    if (!r.ok) throw new Error('Failed to fetch calendar data (' + r.status + ')');
    const data = await r.json();
    return data;
  }

  function normalizeRecords(rawData, settings) {
    // rawData.records is array of { fields: { [fieldId]: { value } } }
    const records = Array.isArray(rawData && rawData.records) ? rawData.records : [];
    const fields = Array.isArray(rawData && rawData.allAvailableFields) ? rawData.allAvailableFields : [];

    // Auto-detect field IDs by label if not configured
    function findFieldId(labelKeywords) {
      const kw = labelKeywords.map(k => k.toLowerCase());
      const f = fields.find(f => {
        const l = String(f.label || '').toLowerCase();
        return kw.some(k => l.includes(k));
      });
      return f ? String(f.id) : null;
    }

    const empId   = settings.fieldEmployee  || findFieldId(['employee','username','name','employee - username']) || '7';
    const noteId  = settings.fieldNote      || findFieldId(['activity','note','type','leave']) || '8';
    const startId = settings.fieldStartDate || findFieldId(['start','from','begin']) || '9';
    const endId   = settings.fieldEndDate   || findFieldId(['end','to','finish']) || '10';

    return records.map((r, idx) => {
      const fv = (id) => { const f = r.fields && r.fields[id]; return f ? (f.value || '') : ''; };
      return {
        id: idx,
        employee: String(fv(empId) || '').trim() || 'N/A',
        note:     String(fv(noteId) || '').trim(),
        startDate: parseDateSafe(fv(startId)),
        endDate:   parseDateSafe(fv(endId)),
        startRaw:  String(fv(startId) || ''),
        endRaw:    String(fv(endId) || ''),
      };
    }).filter(r => r.startDate);
  }

  // ─── CALENDAR VIEW ──────────────────────────────────────────────────────────
  function renderCalendarView(container, records, currentDate, onMonthChange) {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const today = new Date();

    const monthNames = ['January','February','March','April','May','June',
                        'July','August','September','October','November','December'];
    const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

    // Build grid: first day of month, total days
    const firstDay = new Date(year, month, 1).getDay();
    const totalDays = new Date(year, month + 1, 0).getDate();
    const prevMonthDays = new Date(year, month, 0).getDate();

    // For each calendar cell, collect events
    function getEventsForDate(d) {
      return records.filter(r => {
        const end = r.endDate || r.startDate;
        return dateInRange(d, r.startDate, end);
      });
    }

    // Build cells array (6 rows × 7 cols = 42)
    const cells = [];
    let dayCounter = 1;
    let nextCounter = 1;
    for (let i = 0; i < 42; i++) {
      if (i < firstDay) {
        cells.push({ day: prevMonthDays - firstDay + 1 + i, type: 'prev' });
      } else if (dayCounter <= totalDays) {
        cells.push({ day: dayCounter++, type: 'cur' });
      } else {
        cells.push({ day: nextCounter++, type: 'next' });
      }
    }

    // Drop last row if all "next" month
    const rows = [];
    for (let r = 0; r < 6; r++) {
      const row = cells.slice(r * 7, r * 7 + 7);
      if (row.every(c => c.type !== 'cur')) continue;
      rows.push(row);
    }

    const MAX_VISIBLE = 3;

    const gridRows = rows.map(row => {
      const dayCells = row.map(cell => {
        const d = new Date(year, cell.type === 'prev' ? month - 1 : cell.type === 'next' ? month + 1 : month, cell.day);
        const events = cell.type === 'cur' ? getEventsForDate(d) : [];
        const isToday = cell.type === 'cur' && isSameDay(d, today);
        const isOtherMonth = cell.type !== 'cur';

        const visible = events.slice(0, MAX_VISIBLE);
        const overflow = events.length - MAX_VISIBLE;

        const eventBars = visible.map(ev => {
          const c = getLeaveColor(ev.note);
          return `<div class="mc-event-bar" style="background:${c.bg};border-left:2px solid ${c.dot};color:${c.text};" title="${esc(ev.employee + ' | ' + ev.note)}">
            <span class="mc-event-name">${esc(ev.employee)}</span>
            ${ev.note ? `<span class="mc-event-note"> | ${esc(ev.note)}</span>` : ''}
          </div>`;
        }).join('');

        const overflowBadge = overflow > 0
          ? `<div class="mc-overflow">+${overflow} more</div>`
          : '';

        return `<div class="mc-cell${isOtherMonth ? ' mc-cell-other' : ''}${isToday ? ' mc-cell-today' : ''}">
          <div class="mc-day-num${isToday ? ' mc-today-num' : ''}">${cell.day}</div>
          <div class="mc-events">${eventBars}${overflowBadge}</div>
        </div>`;
      }).join('');
      return `<div class="mc-row">${dayCells}</div>`;
    }).join('');

    const headerDays = dayNames.map(d => `<div class="mc-header-day">${d}</div>`).join('');

    container.innerHTML = `
      <div class="mc-calendar">
        <div class="mc-nav">
          <div class="mc-month-title">${monthNames[month]} ${year}</div>
          <div class="mc-nav-btns">
            <button class="mc-nav-btn" id="mcPrev" title="Previous month">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <button class="mc-nav-btn mc-today-btn" id="mcToday">Today</button>
            <button class="mc-nav-btn" id="mcNext" title="Next month">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
        </div>
        <div class="mc-grid-header">${headerDays}</div>
        <div class="mc-grid">${gridRows}</div>
        <div class="mc-legend">
          ${Object.entries(LEAVE_COLORS).filter(([k]) => k !== 'DEFAULT').map(([k, c]) =>
            `<span class="mc-legend-item"><span class="mc-legend-dot" style="background:${c.dot};"></span>${k}</span>`
          ).join('')}
        </div>
      </div>`;

    container.querySelector('#mcPrev').onclick = () => {
      const d = new Date(currentDate);
      d.setMonth(d.getMonth() - 1);
      onMonthChange(d);
    };
    container.querySelector('#mcNext').onclick = () => {
      const d = new Date(currentDate);
      d.setMonth(d.getMonth() + 1);
      onMonthChange(d);
    };
    container.querySelector('#mcToday').onclick = () => {
      onMonthChange(new Date());
    };
  }

  // ─── LIST VIEW ───────────────────────────────────────────────────────────────
  function renderListView(container, records, filterMonth) {
    // Sort by start date
    const sorted = [...records].sort((a, b) => (a.startDate || 0) - (b.startDate || 0));

    // Filter by current month if filterMonth provided
    const filtered = filterMonth
      ? sorted.filter(r => r.startDate && r.startDate.getMonth() === filterMonth.getMonth() && r.startDate.getFullYear() === filterMonth.getFullYear())
      : sorted;

    if (!filtered.length) {
      container.innerHTML = `<div class="mc-empty"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><div>No records found for this period</div></div>`;
      return;
    }

    const rows = filtered.map((r, idx) => {
      const c = getLeaveColor(r.note);
      const isSingleDay = r.endDate && isSameDay(r.startDate, r.endDate);
      const dateRange = isSingleDay
        ? fmtDate(r.startDate)
        : `${fmtDate(r.startDate)} → ${fmtDate(r.endDate || r.startDate)}`;

      // Duration in days
      let duration = '1 day';
      if (r.endDate && !isSameDay(r.startDate, r.endDate)) {
        const diff = Math.round((r.endDate - r.startDate) / (1000 * 60 * 60 * 24)) + 1;
        duration = diff + (diff === 1 ? ' day' : ' days');
      }

      return `<tr class="mc-list-row" data-idx="${idx}">
        <td class="mc-list-td mc-list-num"><span class="mc-list-num-pill">${idx + 1}</span></td>
        <td class="mc-list-td">
          <div class="mc-list-employee">
            <div class="mc-list-avatar">${esc((r.employee || '?').charAt(0).toUpperCase())}</div>
            <span>${esc(r.employee)}</span>
          </div>
        </td>
        <td class="mc-list-td">
          <span class="mc-type-badge" style="background:${c.bg};border:1px solid ${c.border};color:${c.text};">${esc(r.note) || '—'}</span>
        </td>
        <td class="mc-list-td mc-list-date">${esc(dateRange)}</td>
        <td class="mc-list-td mc-list-dur"><span class="mc-dur-badge">${duration}</span></td>
      </tr>`;
    }).join('');

    container.innerHTML = `
      <div class="mc-list-wrap">
        <table class="mc-list-table">
          <thead>
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
      </div>`;
  }

  // ─── MAIN PAGE INIT ──────────────────────────────────────────────────────────
  async function init(root) {
    root.innerHTML = `
      <div class="mc-page-shell" id="mcPageShell">
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
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/></svg>
                Calendar
              </button>
              <button class="mc-view-tab" id="mcTabList">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                List
              </button>
            </div>
            <button class="mc-reload-btn" id="mcReload" title="Reload data">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
              Reload
            </button>
          </div>
        </div>

        <div class="mc-status-bar" id="mcStatusBar" style="display:none;"></div>

        <div class="mc-content-area" id="mcContentArea">
          <div class="mc-loading" id="mcLoading">
            <div class="mc-spinner"></div>
            <div class="mc-loading-text">Loading calendar data…</div>
          </div>
        </div>
      </div>`;

    let currentView = 'calendar';
    let currentDate = new Date();
    let allRecords = [];
    let settings = {};

    function setView(v) {
      currentView = v;
      root.querySelector('#mcTabCalendar').classList.toggle('mc-view-tab-active', v === 'calendar');
      root.querySelector('#mcTabList').classList.toggle('mc-view-tab-active', v === 'list');
      renderCurrentView();
    }

    function setStatus(msg, type) {
      const bar = root.querySelector('#mcStatusBar');
      if (!bar) return;
      if (!msg) { bar.style.display = 'none'; return; }
      bar.style.display = '';
      bar.className = 'mc-status-bar mc-status-' + (type || 'info');
      bar.textContent = msg;
    }

    function renderCurrentView() {
      const area = root.querySelector('#mcContentArea');
      if (!area) return;
      if (currentView === 'calendar') {
        renderCalendarView(area, allRecords, currentDate, (d) => { currentDate = d; renderCurrentView(); });
      } else {
        renderListView(area, allRecords, currentDate);
      }
    }

    async function loadData(force) {
      const area = root.querySelector('#mcContentArea');
      if (area) {
        area.innerHTML = `<div class="mc-loading"><div class="mc-spinner"></div><div class="mc-loading-text">Loading…</div></div>`;
      }
      setStatus('');
      try {
        // Load settings
        const tok = getBearerToken();
        const sr = await fetch('/api/settings/global_calendar', { headers: { Authorization: 'Bearer ' + tok } });
        const sd = await sr.json();
        if (!sd.ok || !sd.settings || !sd.settings.realm || !sd.settings.tableId) {
          if (area) area.innerHTML = `<div class="mc-empty mc-unconfigured">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <div class="mc-empty-title">Calendar Not Configured</div>
            <div class="mc-empty-sub">Ask your Super Admin to configure the Quickbase Calendar Settings in Main Settings → Admin Controls → Calendar Settings.</div>
          </div>`;
          return;
        }
        settings = sd.settings;

        // Fetch records
        const raw = await fetchCalendarData(settings);
        allRecords = normalizeRecords(raw, settings);
        const count = allRecords.length;
        setStatus(`✓ ${count} record${count !== 1 ? 's' : ''} loaded`, 'success');
        setTimeout(() => setStatus(''), 3000);
        renderCurrentView();
      } catch (err) {
        if (area) area.innerHTML = `<div class="mc-empty mc-error">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <div class="mc-empty-title">Failed to load calendar</div>
          <div class="mc-empty-sub">${esc(String(err && err.message || err))}</div>
        </div>`;
      }
    }

    root.querySelector('#mcTabCalendar').onclick = () => setView('calendar');
    root.querySelector('#mcTabList').onclick = () => setView('list');
    root.querySelector('#mcReload').onclick = () => loadData(true);

    await loadData();
  }

  window.Pages = window.Pages || {};
  window.Pages['manila_calendar'] = init;
})();
