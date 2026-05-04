/**
 * @file leave_monitor.js
 * @description Component: leave monitor — tracks members on leave AND on rest day
 * @module MUMS/Components
 * @version UAT v2.0
 *
 * v2.0 CHANGES:
 * ─────────────────────────────────────────────────────────────────────────────
 * [FEAT-RD-1] REST DAY INTEGRATION
 *   Merges Master Schedule rest day rules into Leave Monitor display.
 *   For today and tomorrow, any user whose Master Schedule `restWeekdays` includes
 *   that day (and whose effectiveStart has passed) appears in the Leave Monitor
 *   with a distinct "RD" (Rest Day) badge.
 *   Data source: Store.getMaster() → localStorage `mums_master` key.
 *   Zero extra API calls — pure local Store read.
 *
 * [FEAT-RD-2] DEDUPLICATION
 *   If a user appears in both the QB Calendar leave list AND the rest day list
 *   (rare but possible), QB Calendar entry wins (more specific). Rest day entries
 *   are only added when the user is NOT already in the leave list.
 *
 * [FEAT-RD-3] MONITORING LOG
 *   On each load, emits structured activity logs via Store.addLog() for:
 *   - LEAVE_MONITOR_LOAD: total QB leave + rest day entries per day
 *   - LEAVE_MONITOR_REST_DAY: one log per rest day match found (user + day)
 *   These appear in Activity Logs page for audit/diagnostic purposes.
 *
 * [FEAT-RD-4] UPDATED FOOTER
 *   Footer label updated to "Manila Calendar + Rest Days · Live" to reflect
 *   the dual data source.
 *
 * All existing auth, realtime, QB calendar fetch, scroll persistence,
 * and refresh logic: UNCHANGED.
 * ─────────────────────────────────────────────────────────────────────────────
 */
/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */


// public/js/components/leave_monitor.js
// Leave Monitor — Right Sidebar Widget (Option B: Timeline Rail)
// Shows who is on leave TODAY and TOMORROW, sourced from Manila Calendar QB data.
// v2.0: Also shows who is ON REST DAY per Master Schedule rules.
// Visible to all authenticated users. Auto-refreshes every 10 minutes.
// Injected into #right-sidebar-container, below status-widget-grid.

(function () {
  'use strict';

  const WIDGET_ID  = 'lm-leave-monitor-widget';
  const ROOT_ID    = 'right-sidebar-container';
  const REFRESH_MS = 10 * 60 * 1000; // 10 min auto-refresh
  const SCROLL_KEY = 'leaveMonitorScroll';

  // ─── Leave type colour map (matches Manila Calendar) ────────────────────────
  const LEAVE_COLORS = {
    VL:      { bg: 'rgba(20,184,166,.18)',  border: 'rgba(20,184,166,.35)',  text: '#2dd4bf' },
    HL:      { bg: 'rgba(59,130,246,.15)',  border: 'rgba(59,130,246,.3)',   text: '#60a5fa' },
    SL:      { bg: 'rgba(239,68,68,.15)',   border: 'rgba(239,68,68,.3)',    text: '#f87171' },
    OB:      { bg: 'rgba(168,85,247,.15)',  border: 'rgba(168,85,247,.3)',   text: '#c084fc' },
    WBD:     { bg: 'rgba(234,179,8,.15)',   border: 'rgba(234,179,8,.3)',    text: '#facc15' },
    LEAVE:   { bg: 'rgba(249,115,22,.15)',  border: 'rgba(249,115,22,.3)',   text: '#fb923c' },
    // [FEAT-RD-1] Rest Day — slate-grey palette, distinct from all leave types
    RD:      { bg: 'rgba(100,116,139,.14)', border: 'rgba(100,116,139,.3)',  text: '#94a3b8' },
    DEFAULT: { bg: 'rgba(148,163,184,.1)',  border: 'rgba(148,163,184,.2)',  text: '#94a3b8' },
  };

  function leaveColor(note) {
    const n = String(note || '').toUpperCase();
    if (n === 'RD' || n.includes('REST DAY'))       return LEAVE_COLORS.RD;
    if (n.includes('WBD'))                            return LEAVE_COLORS.WBD;
    if (n.includes('OB'))                             return LEAVE_COLORS.OB;
    if (n.includes('HL'))                             return LEAVE_COLORS.HL;
    if (n.includes('VL'))                             return LEAVE_COLORS.VL;
    if (n.includes('SL'))                             return LEAVE_COLORS.SL;
    if (n.includes('HOLIDAY') || n.includes('LEAVE')) return LEAVE_COLORS.LEAVE;
    return LEAVE_COLORS.DEFAULT;
  }

  function leaveLabel(note) {
    const n = String(note || '').toUpperCase();
    if (n === 'RD' || n.includes('REST DAY')) return 'RD';
    if (n.includes('WBD'))   return 'WBD';
    if (n.includes('OB'))    return 'OB';
    if (n.includes('HL'))    return 'HL';
    if (n.includes('VL'))    return 'VL';
    if (n.includes('SL'))    return 'SL';
    if (n.includes('HOLIDAY')) return 'HL';
    return note || '—';
  }

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function getBearerToken() {
    try {
      return (window.CloudAuth && typeof CloudAuth.accessToken === 'function')
        ? CloudAuth.accessToken() : '';
    } catch (_) { return ''; }
  }

  // ─── Date helpers ────────────────────────────────────────────────────────────
  function parseDate(str) {
    if (!str) return null;
    try {
      const s = String(str).trim();
      const d = s.length === 10 ? new Date(s + 'T00:00:00') : new Date(s);
      return isNaN(d.getTime()) ? null : d;
    } catch (_) { return null; }
  }

  function toMidnight(d) {
    const c = new Date(d);
    c.setHours(0, 0, 0, 0);
    return c;
  }

  function dateInRange(d, start, end) {
    const t = toMidnight(d).getTime();
    const s = start ? toMidnight(start).getTime() : null;
    const e = end   ? toMidnight(end).getTime()   : s;
    if (!s) return false;
    return t >= s && t <= e;
  }

  // ─── Unwrap nested QB value objects ─────────────────────────────────────────
  function unwrapQBValue(val) {
    if (val === null || val === undefined) return '';
    if (typeof val === 'object') {
      if (val.name)       return String(val.name);
      if (val.screenName) return String(val.screenName);
      if (val.userName)   return String(val.userName);
      if (val.email)      return String(val.email);
      if (val.label)      return String(val.label);
      if (val.value !== undefined) return unwrapQBValue(val.value);
      if (Array.isArray(val)) return val.map(unwrapQBValue).filter(Boolean).join(', ');
      return '';
    }
    return String(val);
  }

  function cellValue(row, id) {
    if (!id) return '';
    const cell = row[String(id)];
    if (cell === null || cell === undefined) return '';
    if (typeof cell === 'object' && Object.prototype.hasOwnProperty.call(cell, 'value')) {
      return unwrapQBValue(cell.value);
    }
    return unwrapQBValue(cell);
  }

  // ─── Normalize raw QB records ────────────────────────────────────────────────
  function normalizeRecords(data) {
    const rawRows  = Array.isArray(data.records) ? data.records : [];
    const fields   = Array.isArray(data.fields)  ? data.fields  : [];
    const mappings = data.fieldMappings || {};

    const byLabel = {};
    fields.forEach(f => {
      byLabel[String(f.label || '').toLowerCase().trim()] = String(f.id);
    });

    function findId(hints) {
      for (const h of hints) {
        const k = h.toLowerCase().trim();
        if (byLabel[k]) return byLabel[k];
        for (const [lbl, id] of Object.entries(byLabel)) {
          if (lbl.includes(k)) return id;
        }
      }
      return null;
    }

    const empId   = mappings.fieldEmployee  || findId(['employee - username','employee','username','name','user']);
    const noteId  = mappings.fieldNote      || findId(['activity/note','activity','note','leave type','type']);
    const startId = mappings.fieldStartDate || findId(['holiday/training start date','start date','start','from','begin date']);
    const endId   = mappings.fieldEndDate   || findId(['holiday/training end date','end date','end','to','finish date']);

    return rawRows.map((row, idx) => {
      const fv   = id => cellValue(row, id);
      const start = parseDate(fv(startId));
      const end   = parseDate(fv(endId)) || start;
      return {
        id:        idx,
        employee:  String(fv(empId) || '').trim() || 'Unknown',
        note:      String(fv(noteId) || '').trim(),
        startDate: start,
        endDate:   end,
        _source:   'calendar',
      };
    }).filter(r => r.startDate !== null);
  }

  // ─── Filter for a specific day ───────────────────────────────────────────────
  function filterForDay(records, day) {
    return records.filter(r => dateInRange(day, r.startDate, r.endDate || r.startDate));
  }

  // ─── [FEAT-RD-1] REST DAY INTEGRATION ───────────────────────────────────────
  // Reads Master Schedule from Store.getMaster() (localStorage — zero API calls).
  // For the given `day` date, returns synthetic leave entries for each user whose
  // restWeekdays includes that day's weekday index AND whose effectiveStart ≤ day.
  //
  // Entry shape: { id, employee, note:'RD', startDate:day, endDate:day, _source:'rest_day' }
  // Returned entries are labelled 'RD' (Rest Day) and use the slate-grey badge colour.
  function _getRestDayEntries(day) {
    try {
      if (!window.Store || typeof Store.getMaster !== 'function') return [];
      if (!window.Store || typeof Store.getUsers !== 'function')  return [];

      const master   = Store.getMaster();   // { [teamId]: { members: { [userId]: { restWeekdays, startISO } } } }
      const allUsers = Store.getUsers();    // [{ id, name, username, teamId, ... }]
      if (!master || !allUsers) return [];

      const dayOfWeek    = day.getDay(); // 0=Sun..6=Sat
      const dayMidnight  = toMidnight(day).getTime();
      const results      = [];
      const seenUserIds  = new Set();

      Object.entries(master).forEach(([teamId, teamData]) => {
        if (!teamData || !teamData.members) return;
        Object.entries(teamData.members).forEach(([userId, rule]) => {
          if (!rule) return;
          if (seenUserIds.has(userId)) return; // skip duplicates across teams

          const restWeekdays = Array.isArray(rule.restWeekdays) ? rule.restWeekdays : [];
          if (!restWeekdays.map(Number).includes(dayOfWeek)) return; // not a rest day

          // Check effectiveStart: only apply if today >= effectiveStart
          const startISO = String(rule.startISO || '');
          if (startISO) {
            const effectiveStart = parseDate(startISO);
            if (effectiveStart && toMidnight(effectiveStart).getTime() > dayMidnight) return; // rule not yet active
          }

          // Resolve display name from user list
          const user = allUsers.find(u => String(u && u.id) === String(userId));
          const displayName = user
            ? (String(user.name || user.username || '').trim() || String(user.username || userId))
            : String(userId);

          seenUserIds.add(userId);
          results.push({
            id:        'rd_' + userId + '_' + day.toISOString().slice(0, 10),
            employee:  displayName,
            note:      'RD',
            startDate: day,
            endDate:   day,
            _source:   'rest_day',
            _userId:   userId,
            _teamId:   teamId,
          });
        });
      });

      return results;
    } catch (err) {
      try { console.warn('[LeaveMonitor] _getRestDayEntries error:', err); } catch (_) {}
      return [];
    }
  }

  // ─── [FEAT-RD-2] MERGE: QB Calendar + Rest Days (with deduplication) ─────────
  // QB Calendar entries take priority. Rest day entries are only added when the
  // user's display name is NOT already present in the QB Calendar list for that day.
  // Matching is case-insensitive on the employee/display name.
  function _mergeWithRestDays(calendarList, restDayList) {
    const calendarNames = new Set(
      calendarList.map(r => String(r.employee || '').toLowerCase().trim())
    );
    const uniqueRestDays = restDayList.filter(
      r => !calendarNames.has(String(r.employee || '').toLowerCase().trim())
    );
    // Calendar entries first (highlighted), then rest day entries
    return [...calendarList, ...uniqueRestDays];
  }

  // ─── [FEAT-RD-3] MONITORING LOG ──────────────────────────────────────────────
  // Writes structured logs to Store.addLog() for audit trail in Activity Logs.
  function _emitMonitoringLog(todayAll, tomorrowAll) {
    try {
      if (!window.Store || typeof Store.addLog !== 'function') return;

      const todayRD    = todayAll.filter(r => r._source === 'rest_day');
      const tomorrowRD = tomorrowAll.filter(r => r._source === 'rest_day');
      const todayLeave = todayAll.filter(r => r._source === 'calendar');
      const tomorrowLeave = tomorrowAll.filter(r => r._source === 'calendar');

      // Summary log
      Store.addLog({
        ts:     Date.now(),
        action: 'LEAVE_MONITOR_LOAD',
        msg:    `Leave Monitor refreshed — Today: ${todayAll.length} (${todayLeave.length} leave, ${todayRD.length} rest), Tomorrow: ${tomorrowAll.length} (${tomorrowLeave.length} leave, ${tomorrowRD.length} rest)`,
        detail: JSON.stringify({
          today:    { total: todayAll.length,    leave: todayLeave.length,    restDay: todayRD.length    },
          tomorrow: { total: tomorrowAll.length, leave: tomorrowLeave.length, restDay: tomorrowRD.length },
        }),
      });

      // Individual rest day match logs (for traceability per user)
      [...todayRD, ...tomorrowRD].forEach(r => {
        const dayLabel = r._source === 'rest_day' && r.startDate
          ? r.startDate.toISOString().slice(0, 10)
          : '';
        Store.addLog({
          ts:       Date.now(),
          action:   'LEAVE_MONITOR_REST_DAY',
          targetId: r._userId || '',
          msg:      `Rest day detected: ${r.employee} on ${dayLabel} (team: ${r._teamId || 'unknown'})`,
          detail:   JSON.stringify({ userId: r._userId, teamId: r._teamId, date: dayLabel }),
        });
      });

    } catch (_) {}
  }

  // ─── Initials from full name ─────────────────────────────────────────────────
  function initials(name) {
    const parts = String(name || '').trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return String(name || '?').slice(0, 2).toUpperCase();
  }

  // ─── Day label ───────────────────────────────────────────────────────────────
  function fmtDayLabel(d) {
    const DAY_ABBR   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${DAY_ABBR[d.getDay()]} · ${MONTH_ABBR[d.getMonth()]} ${d.getDate()}`;
  }

  // ─── Render a single person row ──────────────────────────────────────────────
  function renderPersonRow(r, isToday) {
    const ini  = initials(r.employee);
    const c    = leaveColor(r.note);
    const lbl  = leaveLabel(r.note);
    const isRD = r._source === 'rest_day' || r.note === 'RD';

    // Rest day entries use a muted slate avatar; leave entries use teal/blue
    const avBg = isRD
      ? 'rgba(100,116,139,.12)'
      : (isToday ? 'rgba(20,184,166,.15)' : 'rgba(59,130,246,.12)');
    const avTx = isRD
      ? '#64748b'
      : (isToday ? '#2dd4bf' : '#60a5fa');

    // Rest day rows are slightly muted to visually distinguish from leave entries
    const rowStyle = isRD ? 'opacity:.82;' : '';

    return `
      <div class="lm-tl-row" style="${rowStyle}" title="${isRD ? 'Rest Day (Master Schedule)' : 'Leave (Manila Calendar)'}">
        <div class="lm-tl-avatar" style="background:${avBg};color:${avTx};">${esc(ini)}</div>
        <span class="lm-tl-name">${esc(r.employee)}</span>
        <span class="lm-badge" style="background:${c.bg};color:${c.text};border:1px solid ${c.border};">${esc(lbl)}</span>
      </div>`;
  }

  // ─── Render full widget HTML ─────────────────────────────────────────────────
  function renderWidget(todayList, tomorrowList, isLoading, error) {
    const today    = new Date();
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    const totalOut = todayList.length + tomorrowList.length;

    const todayRows = todayList.length
      ? todayList.map(r => renderPersonRow(r, true)).join('')
      : `<div class="lm-tl-empty">No one on leave today</div>`;

    const tomorrowRows = tomorrowList.length
      ? tomorrowList.map(r => renderPersonRow(r, false)).join('')
      : `<div class="lm-tl-empty">No one on leave tomorrow</div>`;

    const countBadge = isLoading
      ? `<span class="lm-count-badge lm-badge-loading">···</span>`
      : error
        ? `<span class="lm-count-badge lm-badge-error">!</span>`
        : `<span class="lm-count-badge">${totalOut} out</span>`;

    const bodyContent = isLoading
      ? `<div class="lm-skeleton-wrap">
          <div class="lm-skel lm-skel-row"></div>
          <div class="lm-skel lm-skel-row" style="width:85%"></div>
          <div class="lm-skel lm-skel-row" style="width:70%;margin-top:10px"></div>
          <div class="lm-skel lm-skel-row" style="width:90%"></div>
        </div>`
      : error
        ? `<div class="lm-error-state">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span>${esc(String(error).slice(0, 80))}</span>
          </div>`
        : `<div class="lm-timeline">
            <div class="lm-rail"></div>

            <!-- TODAY block -->
            <div class="lm-day-block">
              <div class="lm-day-dot lm-day-dot-today"></div>
              <div class="lm-day-label lm-label-today">
                Today · ${fmtDayLabel(today)}
              </div>
              <div class="lm-tl-rows">
                ${todayRows}
              </div>
            </div>

            <!-- TOMORROW block -->
            <div class="lm-day-block lm-day-block-last">
              <div class="lm-day-dot lm-day-dot-tmrw"></div>
              <div class="lm-day-label lm-label-tmrw">
                Tomorrow · ${fmtDayLabel(tomorrow)}
              </div>
              <div class="lm-tl-rows">
                ${tomorrowRows}
              </div>
            </div>
          </div>`;

    return `
      <div class="lm-widget-inner">

        <!-- Header -->
        <div class="lm-header">
          <div class="lm-header-left">
            <div class="lm-icon">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#2dd4bf" stroke-width="2.2" stroke-linecap="round">
                <rect x="3" y="4" width="18" height="18" rx="2"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
                <line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="16" y1="2" x2="16" y2="6"/>
              </svg>
            </div>
            <span class="lm-title">Leave Monitor</span>
            <span class="lm-live-pip"></span>
          </div>
          <div class="lm-header-right">
            ${countBadge}
            <button class="lm-refresh-btn" id="lm-refresh-btn" title="Reload leave data">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                <polyline points="23 4 23 10 17 10"/>
                <polyline points="1 20 1 14 7 14"/>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
              </svg>
            </button>
          </div>
        </div>

        <!-- Body -->
        <div class="lm-body leave-monitor-list" id="leaveMonitorList">
          ${bodyContent}
        </div>

        <!-- [FEAT-RD-4] Updated footer: reflects dual data source -->
        <div class="lm-footer">
          <span class="lm-footer-txt">Manila Calendar + Rest Days · Live</span>
        </div>

      </div>`;
  }

  // ─── Mount / Update widget in sidebar ────────────────────────────────────────
  function getOrCreateHost() {
    let el = document.getElementById(WIDGET_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = WIDGET_ID;
      el.className = 'lm-widget';
    }
    return el;
  }

  function inject(el) {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    // Always inject after the status-widget-grid (Cases/Reminders/Deadlines)
    const swGrid = document.getElementById('status-widget-grid');
    if (swGrid && swGrid.parentNode === root) {
      swGrid.after(el);
    } else if (root.firstChild) {
      root.insertBefore(el, root.firstChild);
    } else {
      root.appendChild(el);
    }
  }

  let _refreshTimer = null;
  let _lastData = null;

  async function load() {
    // Show skeleton immediately
    const el = getOrCreateHost();
    el.innerHTML = renderWidget([], [], true, null);
    inject(el);
    bindButtons(el);
    bindScrollPersistence(el);

    try {
      const tok = getBearerToken();
      const r   = await fetch('/api/calendar/records', {
        headers: { Authorization: 'Bearer ' + tok }
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();

      const today    = new Date();
      const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);

      // ── QB Calendar records ──────────────────────────────────────────────────
      let calendarRecords = [];
      if (data.ok) {
        calendarRecords = normalizeRecords(data);
      }
      // (If data.ok is false → calendar not configured → silent empty calendar list)
      _lastData = calendarRecords;

      const calToday    = filterForDay(calendarRecords, today);
      const calTomorrow = filterForDay(calendarRecords, tomorrow);

      // ── [FEAT-RD-1] Rest Day entries from Master Schedule ───────────────────
      const rdToday    = _getRestDayEntries(today);
      const rdTomorrow = _getRestDayEntries(tomorrow);

      // ── [FEAT-RD-2] Merge (QB Calendar wins on duplicate names) ─────────────
      const todayAll    = _mergeWithRestDays(calToday,    rdToday);
      const tomorrowAll = _mergeWithRestDays(calTomorrow, rdTomorrow);

      // ── [FEAT-RD-3] Monitoring log ───────────────────────────────────────────
      _emitMonitoringLog(todayAll, tomorrowAll);

      render(todayAll, tomorrowAll);
    } catch (err) {
      const el = getOrCreateHost();
      el.innerHTML = renderWidget([], [], false, String(err && err.message || err));
      inject(el);
      bindButtons(el);
      bindScrollPersistence(el);
    }
  }

  function render(todayList, tomorrowList) {
    const el = getOrCreateHost();
    el.innerHTML = renderWidget(todayList, tomorrowList, false, null);
    inject(el);
    bindButtons(el);
    bindScrollPersistence(el);
  }



  function bindScrollPersistence(el) {
    const list = el && el.querySelector('#leaveMonitorList');
    if (!list || list.__lmScrollBound) return;

    const saved = sessionStorage.getItem(SCROLL_KEY);
    if (saved !== null) {
      const top = parseInt(saved, 10);
      if (!Number.isNaN(top)) list.scrollTop = top;
    }

    list.__lmScrollBound = true;
    list.addEventListener('scroll', () => {
      sessionStorage.setItem(SCROLL_KEY, String(list.scrollTop));
    }, { passive: true });
  }

  function bindButtons(el) {
    const btn = el.querySelector('#lm-refresh-btn');
    if (btn && !btn.__lmBound) {
      btn.__lmBound = true;
      btn.addEventListener('click', () => {
        btn.style.transform = 'rotate(360deg)';
        btn.style.transition = 'transform .5s ease';
        setTimeout(() => { btn.style.transform = ''; btn.style.transition = ''; }, 500);
        load();
      });
    }
  }

  function scheduleRefresh() {
    if (_refreshTimer) clearInterval(_refreshTimer);
    _refreshTimer = setInterval(load, REFRESH_MS);
  }

  // ─── Init ────────────────────────────────────────────────────────────────────
  function init() {
    // Wait for auth to be ready
    const tryInit = () => {
      const tok = getBearerToken();
      if (!tok) { setTimeout(tryInit, 800); return; }
      load();
      scheduleRefresh();
    };
    setTimeout(tryInit, 1200); // give statusWidgets time to render first
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 0);
  }

  window.LeaveMonitor = { reload: load };
})();
