/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

/* ═══════════════════════════════════════════════════════════════════
   SUPPORT STUDIO — Core JS (tab switching, clock, mode, call info)
═══════════════════════════════════════════════════════════════════ */
(function() {
  'use strict';

  // ── Tab switching — single persistent layout ────────────────────
  const LEFT_PANELS = ['home','catalog','config','qbs','connectplus','parts_number','contact_information','knowledge_base','support_records','search_engine_2'];
  const QUICKBASE_GROUPED_TABS = new Set(['qbs', 'knowledge_base', 'support_records']);

  function syncQuickbaseMenuState(activeTab) {
    const qbTrigger = document.getElementById('ss-quickbase-trigger');
    if (!qbTrigger) return;
    qbTrigger.classList.toggle('active', QUICKBASE_GROUPED_TABS.has(activeTab));
  }

  function activateTab(target) {
    const contentTarget = (target === 'search_engine_2') ? 'support_records' : target;

    document.querySelectorAll('.ss-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.tab === target));
    syncQuickbaseMenuState(target);
    LEFT_PANELS.forEach(id => {
      const el = document.getElementById('left-panel-' + id);
      if (!el) return;
      el.style.display = (id === contentTarget) ? 'flex' : 'none';
    });
    document.querySelectorAll('.ss-canvas-inner').forEach(el =>
      el.classList.remove('active'));
    const canvas = document.getElementById('canvas-' + contentTarget);
    if (canvas) canvas.classList.add('active');
    if (contentTarget === 'catalog' && typeof window._catInit === 'function') {
      window._catInit();
    }
    if (contentTarget === 'config') {
      // Load the currently active settings section
      // Guard: _sqbLoadSettings may not be defined if called before its script block loads
      const activeNavBtn = document.querySelector('.ss-settings-nav-btn.active, .ss-settings-nav-btn[style*="border-left-color: rgb"]');
      const activeSection = activeNavBtn ? activeNavBtn.dataset.settingsSection : 'studio-qb';
      if ((activeSection === 'studio-qb' || !activeSection) && typeof window._sqbLoadSettings === 'function') {
        window._sqbLoadSettings();
      } else if (activeSection === 'connectplus-settings' && typeof window._cpsLoadSettings === 'function') {
        window._cpsLoadSettings();
      } else if (activeSection === 'contact-information-settings' && typeof window._ctisLoadSettings === 'function') {
        window._ctisLoadSettings();
      } else if (activeSection === 'kb-settings' && typeof window._kbLoadSettings === 'function') {
        window._kbLoadSettings();
      }
    }
    if (contentTarget === 'qbs') {
      // Guard: _qbsInit is defined in a later script block
      if (typeof window._qbsInit === 'function') window._qbsInit();
      else setTimeout(function() { if (typeof window._qbsInit === 'function') window._qbsInit(); }, 200);
    }
    if (contentTarget === 'connectplus') {
      if (typeof window._cpInit === 'function') window._cpInit();
    }
    if (contentTarget === 'parts_number') {
      if (typeof window._pnInit === 'function') window._pnInit();
    }
    if (contentTarget === 'contact_information') {
      if (typeof window._ctiInit === 'function') window._ctiInit();
    }
    if (contentTarget === 'knowledge_base') {
      if (typeof window._kbInit === 'function') window._kbInit();
    }
    if (contentTarget === 'support_records') {
      if (typeof window._srInit === 'function') window._srInit();
    }
    if (target === 'search_engine_2') {
      // Hide support_records — we used it as the contentTarget only for left-panel logic
      const srPanel = document.getElementById('left-panel-support_records');
      if (srPanel) srPanel.style.display = 'none';
      const srCanvas = document.getElementById('canvas-support_records');
      if (srCanvas) srCanvas.classList.remove('active');

      // ── BUG FIX: activate the search_engine_2 canvas (was never set .active) ──
      const se2Canvas = document.getElementById('canvas-search_engine_2');
      if (se2Canvas) se2Canvas.classList.add('active');

      const frame = document.getElementById('search-engine-2-frame');
      if (frame && (!frame.src || frame.src === 'about:blank')) {
        frame.src = frame.dataset.src || '/search_engine_2.html?v=20260403b';
      }
    }
  }

  window._openSearchEngine2 = function(e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    activateTab('search_engine_2');
    return false;
  };

  const qbMenu = document.getElementById('ss-quickbase-menu');
  const qbTrigger = document.getElementById('ss-quickbase-trigger');
  const qbDropdown = document.getElementById('ss-quickbase-dropdown');
  function positionQuickbaseMenu() {
    if (!qbTrigger || !qbDropdown) return;
    const r = qbTrigger.getBoundingClientRect();
    const menuWidth = Math.max(188, Math.round(r.width));
    const top = Math.round(r.bottom + 6);
    const maxLeft = Math.max(8, window.innerWidth - menuWidth - 8);
    const left = Math.max(8, Math.min(Math.round(r.left), maxLeft));
    qbDropdown.style.top = top + 'px';
    qbDropdown.style.left = left + 'px';
    qbDropdown.style.minWidth = menuWidth + 'px';
  }
  function closeQuickbaseMenu() {
    if (!qbMenu || !qbTrigger) return;
    qbMenu.classList.remove('open');
    qbTrigger.setAttribute('aria-expanded', 'false');
  }
  if (qbMenu && qbTrigger) {
    qbTrigger.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      const willOpen = !qbMenu.classList.contains('open');
      qbMenu.classList.toggle('open', willOpen);
      qbTrigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      if (willOpen) positionQuickbaseMenu();
    });
    document.addEventListener('click', function(e) {
      if (!qbMenu.contains(e.target)) closeQuickbaseMenu();
    });
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') closeQuickbaseMenu();
    });
    window.addEventListener('resize', function() {
      if (qbMenu.classList.contains('open')) positionQuickbaseMenu();
    });
    window.addEventListener('scroll', function() {
      if (qbMenu.classList.contains('open')) positionQuickbaseMenu();
    }, true);
    qbMenu.querySelectorAll('.ss-tab').forEach(function(tabBtn) {
      tabBtn.addEventListener('click', function() { closeQuickbaseMenu(); });
    });
  }

  document.querySelectorAll('.ss-tab').forEach(tab => {
    tab.addEventListener('click', () => activateTab(tab.dataset.tab));
  });

  // Expose globally so other script blocks can call it.
  window.activateTab = activateTab;

  // Default landing: Home tab. _qbsInit guard is already in activateTab().
  // Config tab is gated to SUPER_ADMIN; this default works for all roles.
  activateTab('home');

  // ── Live clock ──────────────────────────────────────────────────
  const clockEl = document.getElementById('ss-clock');
  function updateClock() {
    const n = new Date();
    const pad = v => String(v).padStart(2,'0');
    if (clockEl) clockEl.textContent = pad(n.getHours())+':'+pad(n.getMinutes())+':'+pad(n.getSeconds());
  }
  updateClock();
  setInterval(updateClock, 1000);

  // ── Mode toggle ─────────────────────────────────────────────────
  const modeBtn   = document.getElementById('ss-mode-btn');
  const modeBadge = document.getElementById('ss-mode-badge');
  let modeActive  = false;
  if (modeBtn) {
    modeBtn.addEventListener('click', () => {
      modeActive = !modeActive;
      if (modeActive) {
        modeBtn.innerHTML  = '<i class="fas fa-times-circle"></i> Disable Support Mode';
        modeBtn.style.cssText = 'background:rgba(88,166,255,.10);border-color:rgba(88,166,255,.35);color:#58a6ff;';
        modeBadge.innerHTML  = '<i class="fas fa-circle" style="font-size:7px;margin-right:4px;color:#3fb950;"></i> Active';
        modeBadge.style.cssText = 'background:rgba(63,185,80,.10);color:#3fb950;border-color:rgba(63,185,80,.30);';
      } else {
        modeBtn.innerHTML  = '<i class="fas fa-mouse-pointer"></i> Enable Support Mode';
        modeBtn.style.cssText = '';
        modeBadge.innerHTML  = '<i class="fas fa-circle" style="font-size:7px;margin-right:4px;"></i> Standby';
        modeBadge.style.cssText = '';
      }
    });
  }

  // ── Search stub ─────────────────────────────────────────────────
  const searchInput = document.getElementById('ss-search');
  if (searchInput) {
    searchInput.addEventListener('keydown', e => {
      if (e.key === 'Escape') { searchInput.value = ''; searchInput.blur(); }
    });
  }

  // ── Call Widget + Call Information — Supabase-backed, per-user ───────────
  // Notes are stored server-side (/api/studio/call_notes) keyed by user ID,
  // so they survive cross-device login. localStorage is a write-back cache only.
  const CI_KEY = 'mums_ss_call_notes_cache'; // local cache key (not source of truth)
  var _ciNotesMemory = null;  // in-memory cache
  var _ciNotesLoaded = false; // flag: have we fetched from Supabase yet?

  // ── BUG FIX: editing state tracker ───────────────────────────────────────
  // -1 = new note; >= 0 = index of note being edited
  var _ciEditingIdx = -1;

  // ── Auth token helper ─────────────────────────────────────────────────────
  function _ciGetToken() {
    try {
      var raw = localStorage.getItem('mums_supabase_session') || sessionStorage.getItem('mums_supabase_session');
      if (raw) { var p = JSON.parse(raw); var t = p && (p.access_token || (p.session && p.session.access_token)); if (t) return String(t); }
      if (window.CloudAuth && typeof window.CloudAuth.accessToken === 'function') { var t2 = window.CloudAuth.accessToken(); if (t2) return t2; }
    } catch(_) {}
    return '';
  }

  // ── Load from Supabase (on first open) ────────────────────────────────────
  function loadCallNotes() {
    if (_ciNotesMemory !== null) return _ciNotesMemory.slice();
    try { var raw = localStorage.getItem(CI_KEY); if (raw) { _ciNotesMemory = JSON.parse(raw) || []; return _ciNotesMemory.slice(); } } catch(_) {}
    _ciNotesMemory = [];
    return [];
  }

  function _ciFetchFromServer() {
    if (_ciNotesLoaded) return;
    var tok = _ciGetToken();
    if (!tok) return;
    fetch('/api/studio/call_notes', { headers: { 'Authorization': 'Bearer ' + tok } })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d && d.ok && Array.isArray(d.notes)) {
          _ciNotesMemory = d.notes;
          _ciNotesLoaded = true;
          try { localStorage.setItem(CI_KEY, JSON.stringify(d.notes)); } catch(_) {}
          renderRecentNotes();
        }
      }).catch(function() {});
  }

  // ── Save to Supabase (async, fire-and-forget with local cache update) ─────
  function saveCallNotes(notes) {
    _ciNotesMemory = notes.slice(0, 200);
    try { localStorage.setItem(CI_KEY, JSON.stringify(_ciNotesMemory)); } catch(_) {}
    var tok = _ciGetToken();
    if (!tok) return;
    fetch('/api/studio/call_notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
      body: JSON.stringify({ notes: _ciNotesMemory })
    }).catch(function() {});
  }

  /* ── Helper: read all CI field values ────────────────────────────── */
  function _ciReadFields() {
    function v(id) { var e = document.getElementById(id); return e ? e.value.trim() : ''; }
    return {
      callerName:    v('ci-caller-name'),
      company:       v('ci-company'),
      contactNumber: v('ci-contact-number'),
      endUser:       v('ci-end-user'),
      caseNum:       v('ci-case-num'),
      issue:         v('ci-issue'),
      notes:         v('ci-notes'),
      product:       v('ci-product'),
      status:        v('ci-status'),
      ticket:        v('ci-ticket'),
      caseStatus:    (document.getElementById('ci-case-status-badge') || {}).textContent || '',
      shortDesc:     v('ci-short-desc'),
      detailDesc:    v('ci-detail-desc'),
      actionTaken:   v('ci-action-taken'),
    };
  }

  /* ── Helper: populate CI fields from a saved note ────────────────── */
  function _ciPopulateFields(n) {
    function s(id, val) { var e = document.getElementById(id); if (e) e.value = val || ''; }
    s('ci-caller-name',    n.callerName);
    s('ci-company',        n.company);
    s('ci-contact-number', n.contactNumber);
    s('ci-end-user',       n.endUser);
    s('ci-case-num',       n.caseNum);
    s('ci-issue',          n.issue);
    s('ci-notes',          n.notes);
    s('ci-product',        n.product);
    s('ci-status',         n.status);
    s('ci-ticket',         n.ticket);
    s('ci-short-desc',     n.shortDesc);
    s('ci-detail-desc',    n.detailDesc);
    s('ci-action-taken',   n.actionTaken);
    // Restore QB status badge if stored
    var badge = document.getElementById('ci-case-status-badge');
    if (badge) {
      if (n.caseStatus) {
        badge.textContent = n.caseStatus;
        badge.style.display = '';
        _ciStyleStatusBadge(badge, n.caseStatus);
      } else {
        badge.style.display = 'none';
        badge.textContent = '';
      }
    }
  }

  function _ciStyleStatusBadge(badge, statusText) {
    var s = (statusText || '').toLowerCase();
    var color = '#58a6ff'; // default blue
    if (s.includes('invest'))  color = '#58a6ff';
    else if (s.includes('init'))    color = '#d29922';
    else if (s.includes('wait'))    color = '#a25ddc';
    else if (s.includes('resolv'))  color = '#3fb950';
    else if (s.includes('close') || s.includes('soft')) color = '#7d8590';
    badge.style.background    = 'rgba(' + (color === '#58a6ff' ? '88,166,255' : color === '#d29922' ? '210,153,34' : color === '#a25ddc' ? '162,93,220' : color === '#3fb950' ? '63,185,80' : '125,133,144') + ',.12)';
    badge.style.borderColor   = color + '55';
    badge.style.color         = color;
  }

  /* ── QB Case# Status Lookup — debounced ───────────────────────────── */
  var _ciCaseLookupTimer = null;
  window._ciCaseLookup = function(val) {
    var badge = document.getElementById('ci-case-status-badge');
    var spin  = document.getElementById('ci-case-lookup-spin');
    clearTimeout(_ciCaseLookupTimer);
    var q = String(val || '').trim();
    if (!q) {
      if (badge) { badge.style.display = 'none'; badge.textContent = ''; }
      if (spin)  spin.style.display = 'none';
      return;
    }
    if (spin) spin.style.display = '';
    if (badge) badge.style.display = 'none';
    _ciCaseLookupTimer = setTimeout(function() {
      var tok = _ciGetToken();
      if (!tok) { if (spin) spin.style.display = 'none'; return; }
      fetch('/api/studio/qb_search?q=' + encodeURIComponent(q) + '&skip=0&top=10', {
        headers: { 'Authorization': 'Bearer ' + tok }
      })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (spin) spin.style.display = 'none';
        if (!d.ok || !Array.isArray(d.records) || !d.records.length) return;
        // Find exact match: recordId === query (case-insensitive / trimmed)
        var match = d.records.find(function(r) {
          return String(r.qbRecordId || '').trim() === q ||
                 String(r.qbRecordId || '').trim().toLowerCase() === q.toLowerCase();
        }) || d.records[0];
        if (!match || !match.fields || !match.columnMap) return;
        // Extract case status value from fields
        var statusFid = Object.keys(match.columnMap).find(function(id) {
          return (match.columnMap[id] || '').toLowerCase().includes('case status') ||
                 (match.columnMap[id] || '').toLowerCase() === 'status';
        });
        if (!statusFid) return;
        var statusVal = match.fields[statusFid];
        var statusText = (statusVal && statusVal.value != null) ? String(statusVal.value) : String(statusVal || '');
        if (!statusText) return;
        if (badge) {
          badge.textContent = statusText;
          badge.style.display = '';
          _ciStyleStatusBadge(badge, statusText);
        }
      })
      .catch(function() { if (spin) spin.style.display = 'none'; });
    }, 700);
  };

  /* ── Sidebar mini-list ───────────────────────────────── */
  function renderRecentNotes() {
    var list = document.getElementById('ci-recent-list');
    if (!list) return;
    var notes = loadCallNotes();
    if (!notes.length) {
      list.innerHTML = '<div class="ss-empty-note" style="padding:8px 0;font-size:10px;">No saved notes yet.</div>';
      return;
    }
    list.innerHTML = notes.slice(0, 5).map(function(n, i) {
      var dt = new Date(n.savedAt || Date.now());
      var timeStr = dt.toLocaleDateString('en-PH',{month:'short',day:'numeric'}) + ' ' +
                    dt.toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'});
      var durBadge = n.callDuration ? '<span style="margin-left:auto;font-size:8px;font-weight:800;color:#f85149;font-family:var(--ss-font);background:rgba(248,81,73,.1);border:1px solid rgba(248,81,73,.2);border-radius:4px;padding:2px 6px;flex-shrink:0;display:inline-flex;align-items:center;gap:3px;"><i class="fas fa-phone-volume" style="font-size:7px;"></i>' + n.callDuration + '</span>' : '';
      var statusDot = n.caseStatus ? '<span style="font-size:8px;font-weight:700;color:#58a6ff;margin-left:4px;">' + escHtml(n.caseStatus) + '</span>' : '';
      return '<div class="ci-note-card" data-idx="' + i + '" onclick="window._ciLoadNote(' + i + ')" style="cursor:pointer;">' +
        '<div class="ci-note-time" style="display:flex;align-items:center;gap:4px;">' + timeStr + statusDot + durBadge + '</div>' +
        '<div class="ci-note-caller">' + escHtml(n.callerName || '(no name)') + (n.caseNum ? ' &nbsp;·&nbsp; #' + escHtml(n.caseNum) : '') + '</div>' +
        '<div style="font-size:9px;color:var(--ss-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escHtml(n.shortDesc || n.endUser || '—') + '</div>' +
        '</div>';
    }).join('');
  }

  // ── BUG FIX 1: _ciLoadNote — NO timer start when editing a saved note ─────
  window._ciLoadNote = function(idx) {
    var notes = loadCallNotes();
    var n = notes[idx];
    if (!n) return;
    _ciEditingIdx = idx; // track which note we're editing
    _ciPopulateFields(n);
    // Show "EDITING" badge
    var eb = document.getElementById('ci-edit-badge');
    if (eb) eb.style.display = '';
    // Re-open Call Information — but DO NOT start the timer (fix for timer bug)
    _cwShowCallInfo();
    // _cwStartTimer() is intentionally NOT called here — timer only runs for live calls
  };

  /* ── BUG FIX 2 + 3: Save — updates existing note when editing, required fields ── */
  window._ciSaveNote = function() {
    var fields = _ciReadFields();
    // Required field validation
    var required = [
      { key: 'callerName',    label: 'Caller Name' },
      { key: 'contactNumber', label: 'Contact Number' },
      { key: 'endUser',       label: 'End User' },
      { key: 'shortDesc',     label: 'Short Description' },
      { key: 'detailDesc',    label: 'Detailed Description' },
      { key: 'actionTaken',   label: 'Action Taken' },
    ];
    var missing = required.filter(function(r) { return !fields[r.key]; });
    var reqMsg = document.getElementById('ci-req-msg');
    if (missing.length) {
      if (reqMsg) {
        reqMsg.textContent = '✗ Required: ' + missing.map(function(r){return r.label;}).join(', ');
        reqMsg.style.opacity = '1';
        clearTimeout(reqMsg._t);
        reqMsg._t = setTimeout(function() { reqMsg.style.opacity = '0'; }, 4000);
      }
      return;
    }
    if (reqMsg) reqMsg.style.opacity = '0';

    // Capture duration BEFORE stopping (only meaningful for live new calls)
    var durSecs  = _cwCallStartTime ? Math.floor((Date.now() - _cwCallStartTime) / 1000) : 0;
    var durLabel = durSecs > 0 ? _cwFmtTime(durSecs) : null;

    var note = {
      callerName:    fields.callerName,
      company:       fields.company,
      contactNumber: fields.contactNumber,
      endUser:       fields.endUser,
      caseNum:       fields.caseNum,
      issue:         fields.issue,
      notes:         fields.notes,
      product:       fields.product,
      status:        fields.status,
      ticket:        fields.ticket,
      caseStatus:    fields.caseStatus,
      shortDesc:     fields.shortDesc,
      detailDesc:    fields.detailDesc,
      actionTaken:   fields.actionTaken,
      callDuration:  _ciEditingIdx >= 0
                       ? (loadCallNotes()[_ciEditingIdx] || {}).callDuration || null
                       : durLabel,   // preserve original duration when editing
      savedAt:       new Date().toISOString(),
    };

    var all = loadCallNotes();
    if (_ciEditingIdx >= 0 && _ciEditingIdx < all.length) {
      // ── BUG FIX 2: UPDATE existing note in-place instead of unshift ──
      all[_ciEditingIdx] = note;
    } else {
      // ── New note: prepend ──
      all.unshift(note);
      // Only stop the live call timer for new notes, not edits
      if (_cwCallStartTime) _cwStopTimer();
    }
    _ciEditingIdx = -1; // reset edit state

    saveCallNotes(all);
    renderRecentNotes();

    // Hide EDITING badge
    var eb = document.getElementById('ci-edit-badge');
    if (eb) eb.style.display = 'none';

    // Show success message
    var ciMsg = document.getElementById('ci-save-msg');
    if (ciMsg) {
      var durationTxt = note.callDuration ? ' (' + note.callDuration + ')' : '';
      ciMsg.textContent = '✓ Note saved!' + durationTxt;
      ciMsg.style.cssText = 'font-size:10px;color:#3fb950;text-align:center;margin-top:4px;opacity:1;transition:opacity .4s;';
      clearTimeout(ciMsg._t);
      ciMsg._t = setTimeout(function() { ciMsg.style.opacity = '0'; }, 2500);
    }

    // Close panel after short delay
    setTimeout(function() { _cwHideCallInfo(); }, 900);
  };

  window._ciClearForm = function() {
    ['ci-caller-name','ci-company','ci-contact-number','ci-end-user',
     'ci-case-num','ci-issue','ci-notes','ci-product','ci-status','ci-ticket',
     'ci-short-desc','ci-detail-desc','ci-action-taken'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.value = '';
    });
    var badge = document.getElementById('ci-case-status-badge');
    if (badge) { badge.style.display = 'none'; badge.textContent = ''; }
    var eb = document.getElementById('ci-edit-badge');
    if (eb) eb.style.display = 'none';
    _ciEditingIdx = -1;
  };

  /* ── Premium Notes Panel ────────────────────────────── */
  function buildNpCard(n, idx) {
    var dt      = new Date(n.savedAt || Date.now());
    var dateStr = dt.toLocaleDateString('en-PH',{weekday:'short',month:'short',day:'numeric',year:'numeric'});
    var timeStr = dt.toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'});
    var sc      = '#58a6ff';
    if (n.caseStatus) {
      var sl = n.caseStatus.toLowerCase();
      if (sl.includes('invest')) sc = '#58a6ff';
      else if (sl.includes('init'))   sc = '#d29922';
      else if (sl.includes('wait'))   sc = '#a25ddc';
      else if (sl.includes('resolv')) sc = '#3fb950';
      else if (sl.includes('close') || sl.includes('soft')) sc = '#7d8590';
    }
    var hasCaller = n.callerName || n.caseNum;
    var fields = [
      ['Company',      n.company],
      ['Contact #',    n.contactNumber],
      ['End User',     n.endUser],
      ['Case #',       n.caseNum ? (n.caseNum + (n.caseStatus ? '  ·  ' + n.caseStatus : '')) : ''],
      ['Issue',        n.issue],
      ['Notes',        n.notes],
      ['Product',      n.product],
      ['Status',       n.status],
      ['Ticket',       n.ticket],
      ['Short Desc',   n.shortDesc],
      ['Details',      n.detailDesc],
      ['Action Taken', n.actionTaken],
      ['Duration',     n.callDuration],
    ].filter(function(f){ return f[1]; });

    return '<div class="ci-np-card" style="background:rgba(13,17,23,.9);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:18px 20px;transition:border-color .18s;cursor:default;" ' +
      'data-npidx="' + idx + '">' +
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px;">' +
        '<div>' +
          (hasCaller ? '<div style="font-size:14px;font-weight:800;color:#e6edf3;">' + escHtml(n.callerName || '(no name)') + (n.caseNum ? '<span style="font-size:11px;font-weight:600;color:var(--ss-muted);margin-left:8px;">#' + escHtml(n.caseNum) + '</span>' : '') + '</div>' : '') +
          '<div style="font-size:10px;color:var(--ss-muted);margin-top:2px;">' + escHtml(dateStr) + ' &nbsp;·&nbsp; ' + escHtml(timeStr) + '</div>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">' +
          (n.callDuration ? '<span style="font-size:9px;font-weight:800;padding:2px 8px;border-radius:5px;border:1px solid rgba(248,81,73,.25);background:rgba(248,81,73,.1);color:#f85149;font-family:var(--ss-mono,monospace);display:inline-flex;align-items:center;gap:4px;"><i class=\'fas fa-clock\' style=\'font-size:8px;\'></i>' + escHtml(n.callDuration) + '</span>' : '') +
          (n.caseStatus ? '<span style="font-size:9px;font-weight:800;padding:3px 10px;border-radius:20px;border:1px solid ' + sc + '30;background:' + sc + '18;color:' + sc + ';">' + escHtml(n.caseStatus) + '</span>' : '') +
          '<button onclick="window._ciLoadNoteAndClose(' + idx + ')" style="background:rgba(88,166,255,.1);border:1px solid rgba(88,166,255,.25);border-radius:6px;color:#58a6ff;font-size:10px;font-weight:700;padding:4px 10px;cursor:pointer;font-family:var(--ss-font);white-space:nowrap;">Load</button>' +
          '<button onclick="window._ciDeleteNote(' + idx + ')" style="background:rgba(248,81,73,.06);border:1px solid rgba(248,81,73,.2);border-radius:6px;color:#f85149;font-size:10px;font-weight:700;padding:4px 8px;cursor:pointer;font-family:var(--ss-font);" title="Delete note"><i class="fas fa-trash-alt"></i></button>' +
        '</div>' +
      '</div>' +
      (fields.length ? '<div style="display:flex;flex-direction:column;gap:8px;">' +
        fields.map(function(f) {
          return '<div style="display:flex;gap:8px;">' +
            '<span style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:var(--ss-muted);padding-top:2px;flex-shrink:0;width:66px;">' + escHtml(f[0]) + '</span>' +
            '<span style="font-size:11px;color:var(--ss-text);line-height:1.5;word-break:break-word;">' + escHtml(f[1]) + '</span>' +
          '</div>';
        }).join('') +
      '</div>' : '<div style="font-size:11px;color:var(--ss-muted);opacity:.4;">No additional details</div>') +
      '</div>';
  }

  function escHtml(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function buildNpStats(notes) {
    var total  = notes.length;
    var invest = notes.filter(function(n){return (n.caseStatus||'').toLowerCase().includes('invest');}).length;
    var wait   = notes.filter(function(n){return (n.caseStatus||'').toLowerCase().includes('wait');}).length;
    var res    = notes.filter(function(n){return (n.caseStatus||'').toLowerCase().includes('resolv') || (n.caseStatus||'').toLowerCase().includes('close');}).length;
    var stats  = [
      {label:'Total',        val:total,  color:'#58a6ff'},
      {label:'Investigating',val:invest, color:'#58a6ff'},
      {label:'Waiting',      val:wait,   color:'#a25ddc'},
      {label:'Resolved',     val:res,    color:'#3fb950'},
    ];
    return stats.map(function(s) {
      return '<div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:10px 18px;display:flex;flex-direction:column;gap:2px;">' +
        '<div style="font-size:20px;font-weight:900;color:' + s.color + ';">' + s.val + '</div>' +
        '<div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--ss-muted);">' + s.label + '</div>' +
      '</div>';
    }).join('');
  }

  function renderNpGrid(filter) {
    var notes   = loadCallNotes();
    var q       = (filter||'').toLowerCase().trim();
    var filtered = q ? notes.filter(function(n) {
      return (n.callerName    ||'').toLowerCase().includes(q) ||
             (n.company       ||'').toLowerCase().includes(q) ||
             (n.contactNumber ||'').toLowerCase().includes(q) ||
             (n.endUser       ||'').toLowerCase().includes(q) ||
             (n.caseNum       ||'').toLowerCase().includes(q) ||
             (n.caseStatus    ||'').toLowerCase().includes(q) ||
             (n.issue         ||'').toLowerCase().includes(q) ||
             (n.notes         ||'').toLowerCase().includes(q) ||
             (n.product       ||'').toLowerCase().includes(q) ||
             (n.status        ||'').toLowerCase().includes(q) ||
             (n.ticket        ||'').toLowerCase().includes(q) ||
             (n.shortDesc     ||'').toLowerCase().includes(q) ||
             (n.detailDesc    ||'').toLowerCase().includes(q) ||
             (n.actionTaken   ||'').toLowerCase().includes(q);
    }) : notes;

    var grid    = document.getElementById('ci-np-grid');
    var empty   = document.getElementById('ci-np-empty');
    var subtitle = document.getElementById('ci-np-subtitle');
    if (!grid) return;

    if (subtitle) subtitle.textContent = filtered.length + ' note' + (filtered.length!==1?'s':'') + ' saved';
    if (!filtered.length) {
      grid.innerHTML  = '';
      if (empty) empty.style.display = 'block';
      return;
    }
    if (empty) empty.style.display = 'none';
    grid.innerHTML = filtered.map(function(n, i) {
      // Use original index for load/delete
      var origIdx = notes.indexOf(n);
      return buildNpCard(n, origIdx);
    }).join('');
  }

  window._ciNpFilter = function(val) { renderNpGrid(val); };

  window._ciOpenNotesPanel = function() {
    var panel = document.getElementById('ci-notes-panel');
    if (!panel) return;
    var stats = document.getElementById('ci-np-stats');
    var notes = loadCallNotes();
    if (stats) stats.innerHTML = buildNpStats(notes);
    var searchEl = document.getElementById('ci-np-search');
    if (searchEl) searchEl.value = '';
    renderNpGrid('');
    panel.style.display = 'block';
    // Close on backdrop click
    panel.onclick = function(e) { if (e.target === panel || e.target.parentElement === panel) window._ciCloseNotesPanel(); };
  };

  window._ciCloseNotesPanel = function() {
    var panel = document.getElementById('ci-notes-panel');
    if (panel) panel.style.display = 'none';
  };

  window._ciLoadNoteAndClose = function(idx) {
    window._ciLoadNote(idx);  // _ciLoadNote already calls _cwShowCallInfo
    window._ciCloseNotesPanel();
  };

  window._ciDeleteNote = function(idx) {
    if (!confirm('Delete this note?')) return;
    var all = loadCallNotes();
    all.splice(idx, 1);
    saveCallNotes(all);
    renderRecentNotes();
    var stats = document.getElementById('ci-np-stats');
    if (stats) stats.innerHTML = buildNpStats(loadCallNotes());
    renderNpGrid(document.getElementById('ci-np-search') ? document.getElementById('ci-np-search').value : '');
  };

  // Keyboard: Escape closes panel
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      var panel = document.getElementById('ci-notes-panel');
      if (panel && panel.style.display !== 'none') window._ciCloseNotesPanel();
    }
  });


  var _ssNotesSidebarVisible = false;
  var _ssRightSidebarMode = 'notes';
  var _ssRightSidebarCollapsed = true;

  function _ssSyncMiniRail() {
    var right = document.getElementById('ss-right-sidebar');
    var notesBtn = document.getElementById('ss-mini-notes-btn');
    var bookmarksBtn = document.getElementById('ss-mini-bookmarks-btn');
    var collapseBtn = document.getElementById('ss-mini-collapse-btn');
    if (!right) return;

    right.classList.toggle('ss-right-hidden', _ssRightSidebarCollapsed);
    right.classList.toggle('ss-collapsed-notes', !_ssNotesSidebarVisible);
    right.classList.toggle('ss-bookmarks-mode', _ssNotesSidebarVisible && _ssRightSidebarMode === 'bookmarks');

    if (notesBtn) notesBtn.classList.toggle('active', _ssNotesSidebarVisible && _ssRightSidebarMode === 'notes');
    if (bookmarksBtn) bookmarksBtn.classList.toggle('active', _ssNotesSidebarVisible && _ssRightSidebarMode === 'bookmarks');
    if (collapseBtn) {
      collapseBtn.textContent = _ssRightSidebarCollapsed ? '<<' : '>>';
      collapseBtn.title = _ssRightSidebarCollapsed ? 'Show right sidebar' : 'Collapse right sidebar';
    }

    if (_ssRightSidebarCollapsed) return;
    if (_ssNotesSidebarVisible && _ssRightSidebarMode === 'notes') renderRecentNotes();
    if (_ssNotesSidebarVisible && _ssRightSidebarMode === 'bookmarks' && typeof window._ssRenderBookmarks === 'function') {
      window._ssRenderBookmarks();
    }
  }

  window._ssToggleRightNotes = function() {
    _ssRightSidebarCollapsed = false;
    if (_ssNotesSidebarVisible && _ssRightSidebarMode === 'notes') {
      _ssNotesSidebarVisible = false;
    } else {
      _ssNotesSidebarVisible = true;
      _ssRightSidebarMode = 'notes';
    }
    _ssSyncMiniRail();
  };

  window._ssOpenBookmarksPanel = function() {
    _ssRightSidebarCollapsed = false;
    _ssNotesSidebarVisible = true;
    _ssRightSidebarMode = 'bookmarks';
    if (typeof window._se2SetBookmarkFolderFilter === 'function') window._se2SetBookmarkFolderFilter('default');
    _ssSyncMiniRail();
    if (typeof window._se2EnsureBookmarksLoaded === 'function') window._se2EnsureBookmarksLoaded();
  };

  window._ssToggleSidebarCollapse = function() {
    _ssRightSidebarCollapsed = !_ssRightSidebarCollapsed;
    _ssSyncMiniRail();
  };

  // ── Call Widget & Timer ───────────────────────────────────────────────────
  // DESIGN:
  //   • Recent Notes panel starts minimized.
  //   • Call Information section slides open when widget is clicked → timer starts.
  //   • Call widget auto-opens the right notes panel.

  var _cwCallStartTime = null;
  var _cwTimerInterval = null;

  // ── FIX: Human-readable duration format ──────────────────────────────────
  // "1m 27s" instead of "1:27" or "0:87" (which was the bug — seconds > 59 display)
  function _cwFmtTime(secs) {
    secs = Math.floor(Math.max(0, Number(secs) || 0));
    var h = Math.floor(secs / 3600);
    var m = Math.floor((secs % 3600) / 60);
    var s = secs % 60;
    if (h > 0) return h + 'h ' + m + 'm ' + (s < 10 ? '0' : '') + s + 's';
    if (m > 0) return m + 'm ' + (s < 10 ? '0' : '') + s + 's';
    return s + 's';
  }

  // Badge label keeps compact format for the widget bubble: "1:27"
  function _cwFmtBadge(secs) {
    secs = Math.floor(Math.max(0, Number(secs) || 0));
    var m = Math.floor(secs / 60);
    var s = secs % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function _cwUpdateDisplay() {
    if (!_cwCallStartTime) return;
    var elapsed = Math.floor((Date.now() - _cwCallStartTime) / 1000);
    var disp  = document.getElementById('ci-timer-display');
    var badge = document.getElementById('cw-timer-badge');
    if (disp)  disp.textContent  = _cwFmtBadge(elapsed);
    if (badge) badge.textContent = _cwFmtBadge(elapsed);
  }

  function _cwShowCallInfo() {
    var sec = document.getElementById('ci-call-info-section');
    if (sec) sec.style.display = 'flex';
    _ssRightSidebarCollapsed = false;
    _ssNotesSidebarVisible = true;
    _ssRightSidebarMode = 'notes';
    _ssSyncMiniRail();
  }

  function _cwHideCallInfo() {
    var sec = document.getElementById('ci-call-info-section');
    if (sec) sec.style.display = 'none';
  }

  function _cwStartTimer() {
    if (_cwTimerInterval) return;
    _cwCallStartTime = _cwCallStartTime || Date.now();
    _cwUpdateDisplay();
    _cwTimerInterval = setInterval(_cwUpdateDisplay, 1000);
    var bar = document.getElementById('ci-timer-bar');
    if (bar) bar.classList.add('active');
    var btn = document.getElementById('ss-call-widget-btn');
    if (btn) btn.classList.add('call-active');
  }

  function _cwStopTimer() {
    clearInterval(_cwTimerInterval);
    _cwTimerInterval = null;
    _cwCallStartTime = null;
    var bar = document.getElementById('ci-timer-bar');
    if (bar) bar.classList.remove('active');
    var btn = document.getElementById('ss-call-widget-btn');
    if (btn) btn.classList.remove('call-active');
    var disp  = document.getElementById('ci-timer-display');
    var badge = document.getElementById('cw-timer-badge');
    if (disp)  disp.textContent  = '0:00';
    if (badge) badge.textContent = '0:00';
  }

  // ── Toggle: widget click shows Call Info + starts timer ──────────────────
  window._cwTogglePanel = function() {
    var sec = document.getElementById('ci-call-info-section');
    if (!sec) return;
    var isOpen = sec.style.display !== 'none';
    if (isOpen) {
      // Second click while open: close without saving (just hide)
      _cwStopTimer();
      _cwHideCallInfo();
    } else {
      // Open Call Information and start a new call timer
      _cwShowCallInfo();
      if (!_cwCallStartTime) _cwStartTimer();
      if (!_ciNotesLoaded) _ciFetchFromServer();
      // Scroll to top of call info section
      if (sec.scrollTop !== undefined) sec.scrollTop = 0;
    }
  };

  // ── End Call button: stop timer + hide Call Information ──────────────────
  window._cwEndCall = function() {
    _cwStopTimer();
    _cwHideCallInfo();
  };

  window._cwCloseCallInfoPanel = function() {
    _cwStopTimer();
    _cwHideCallInfo();
  };

  // Expose for other modules
  window._cwShowCallInfo = _cwShowCallInfo;
  window._cwHideCallInfo = _cwHideCallInfo;

  // Boot: fetch notes from Supabase when auth token becomes available
  window.addEventListener('mums:authtoken', function() {
    setTimeout(function() {
      if (!_ciNotesLoaded) _ciFetchFromServer();
    }, 200);
  });
  // Fallback: try on DOMContentLoaded or immediately if already loaded
  (function() {
    function _tryFetch() { if (!_ciNotesLoaded && _ciGetToken()) _ciFetchFromServer(); }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() { setTimeout(_tryFetch, 500); });
    } else {
      setTimeout(_tryFetch, 500);
    }
  })();

  // Init
  renderRecentNotes();
  _ssSyncMiniRail();
  document.title = 'MUMS Support Studio';

  // ── Home: Controller Testing Lab Widget ───────────────────────────────
  (function(){
    var STORAGE_KEY = 'mums_controller_lab_items_v1';
    var editingId = null;
    var CATALOG = {
      'E2':             { img: '/Widget%20Images/E2_Widget.jpeg',             label: 'E2 Controller'    },
      'E3':             { img: '/Widget%20Images/E3_Widget.jpeg',             label: 'E3 Gateway'       },
      'Site Supervisor':{ img: '/Widget%20Images/Site%20Supervisor_Widget.jpeg', label: 'Site Supervisor' }
    };
    var FALLBACK_IMG = '/Widget%20Images/quickbase_logo.png';

    function esc(v){ return String(v == null ? '' : v)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

    function getItems() {
      try { var r=localStorage.getItem(STORAGE_KEY); var p=r?JSON.parse(r):[]; return Array.isArray(p)?p:[]; }
      catch(_){ return []; }
    }
    function setItems(items) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items||[])); } catch(_) {}
    }
    function imageFor(type) {
      var hit = CATALOG[type]; return hit && hit.img ? hit.img : FALLBACK_IMG;
    }
    function labelFor(type) {
      var hit = CATALOG[type]; return hit && hit.label ? hit.label : type;
    }
    function statusCls(status) {
      var v = String(status||'').toLowerCase();
      if(v==='offline') return 'offline';
      if(v==='maintenance') return 'maintenance';
      return '';
    }
    function openModal(id, open) {
      var el = document.getElementById(id); if(!el) return;
      el.classList.toggle('open', !!open);
      el.setAttribute('aria-hidden', open ? 'false' : 'true');
    }
    function renderPreview() {
      var sel = document.getElementById('hp-ctl-type-select');
      var img = document.getElementById('hp-ctl-preview-img');
      if(!sel||!img) return;
      img.src = imageFor(sel.value);
      img.alt = sel.value;
    }

    /* ── Horizontal list in config modal ── */
    function renderChipRow(items) {
      var row = document.getElementById('hp-ctl-chip-row'); if(!row) return;
      if(!items.length) {
        row.innerHTML = '<div style="padding:20px;text-align:center;color:rgba(255,255,255,.25);font-size:11px;">No controllers added yet. Select a type and click Add Now.</div>';
        return;
      }
      row.innerHTML = items.map(function(item){
        var cls = statusCls(item.status);
        return '<div class="hp-ctl-chip">'+
          '<img class="hp-ctl-chip-img" src="'+esc(imageFor(item.type))+'" alt="'+esc(item.type)+'" onerror="this.src=\''+esc(FALLBACK_IMG)+'\';" />'+
          '<div class="hp-ctl-chip-meta">'+
            '<div class="hp-ctl-chip-name">'+esc(labelFor(item.type))+'</div>'+
            '<div class="hp-ctl-chip-ip">'+esc(item.ip||'—')+'</div>'+
          '</div>'+
          '<span class="hp-ctl-chip-status '+cls+'">'+esc(item.status||'Online')+'</span>'+
          '<button class="hp-ctl-settings-btn" data-ctl-settings="'+esc(item.id)+'">'+
            '<i class="fas fa-sliders-h" style="font-size:9px;margin-right:4px;"></i>Settings'+
          '</button>'+
        '</div>';
      }).join('');
    }

    /* ── Vertical column display in main lab area ── */
    function renderMainList(items) {
      var host = document.getElementById('hp-ctl-list'); if(!host) return;
      if(!items.length) {
        host.innerHTML = '<div class="hp-ctl-empty"><i class="fas fa-network-wired"></i><span>No controller configured yet</span><span style="font-size:9px;opacity:.5;">Click the ⚙ icon above to add one</span></div>';
        return;
      }
      host.innerHTML = items.map(function(item){
        var cls = statusCls(item.status);
        var statusIcon = cls==='offline' ? '🔴' : cls==='maintenance' ? '🟡' : '🟢';
        return '<div class="hp-ctl-col">'+
          '<div class="hp-ctl-col-badge">'+esc(item.type)+'</div>'+
          '<img class="hp-ctl-col-img" src="'+esc(imageFor(item.type))+'" alt="'+esc(item.type)+'" onerror="this.src=\''+esc(FALLBACK_IMG)+'\';" />'+
          '<div class="hp-ctl-col-meta">'+
            '<div class="hp-ctl-col-name">'+esc(labelFor(item.type))+'</div>'+
            '<div class="hp-ctl-col-ip">'+esc(item.ip||'—')+'</div>'+
          '</div>'+
          '<span class="hp-ctl-col-status '+cls+'">'+statusIcon+' '+esc(item.status||'Online')+'</span>'+
          '<button class="hp-ctl-col-settings" data-ctl-settings="'+esc(item.id)+'">'+
            '<i class="fas fa-sliders-h" style="font-size:9px;"></i> Settings'+
          '</button>'+
        '</div>';
      }).join('');
    }

    function renderAll() {
      var items = getItems();
      renderChipRow(items);
      renderMainList(items);
    }

    function addController() {
      var sel = document.getElementById('hp-ctl-type-select'); if(!sel) return;
      var type = sel.value || 'E2';
      var items = getItems();
      var idx = items.length + 1;
      items.push({
        id: String(Date.now())+'_'+Math.random().toString(36).slice(2,7),
        type: type,
        ip: '192.168.123.'+idx,
        status: 'Online'
      });
      setItems(items);
      renderAll();
    }

    function openSettings(id) {
      var items = getItems();
      var target = items.find(function(it){ return it.id===id; });
      if(!target) return;
      editingId = id;
      // Populate settings modal
      var ipEl  = document.getElementById('hp-ctl-ip-input');
      var stEl  = document.getElementById('hp-ctl-status-select');
      var imgEl = document.getElementById('hp-ctl-settings-img');
      var tyEl  = document.getElementById('hp-ctl-settings-type-label');
      var idEl  = document.getElementById('hp-ctl-settings-id-label');
      if(ipEl)  ipEl.value  = target.ip     || '';
      if(stEl)  stEl.value  = target.status || 'Online';
      if(imgEl) imgEl.src   = imageFor(target.type);
      if(tyEl)  tyEl.textContent = labelFor(target.type);
      if(idEl)  idEl.textContent = 'ID: '+target.id.slice(0,16);
      openModal('hp-ctl-settings-modal', true);
    }

    function saveSettings() {
      if(!editingId) return;
      var ipEl = document.getElementById('hp-ctl-ip-input');
      var stEl = document.getElementById('hp-ctl-status-select');
      var ip = (ipEl && ipEl.value ? ipEl.value.trim() : '') || 'N/A';
      var st = (stEl && stEl.value ? stEl.value.trim() : 'Online');
      var items = getItems().map(function(it){
        if(it.id!==editingId) return it;
        return Object.assign({}, it, {ip:ip, status:st});
      });
      setItems(items);
      openModal('hp-ctl-settings-modal', false);
      editingId = null;
      renderAll();
    }

    function deleteController() {
      if(!editingId) return;
      if(!confirm('Remove this controller from the lab?')) return;
      var items = getItems().filter(function(it){ return it.id!==editingId; });
      setItems(items);
      openModal('hp-ctl-settings-modal', false);
      openModal('hp-ctl-config-modal', false);
      editingId = null;
      renderAll();
    }

    /* ── Event delegation ── */
    document.addEventListener('click', function(e){
      var t = e.target; if(!t) return;
      // Gear icon → open config modal
      var cfg = t.closest && t.closest('#hp-ctl-config-btn');
      if(cfg){ openModal('hp-ctl-config-modal', true); renderPreview(); renderAll(); return; }
      // Add Now in preview
      var addNow = t.closest && t.closest('#hp-ctl-add-now-btn');
      if(addNow){ addController(); return; }
      // Add Controller button in header
      var quickAdd = t.closest && t.closest('#hp-ctl-add-btn');
      if(quickAdd){ addController(); return; }
      // Save settings
      var saveBtn = t.closest && t.closest('#hp-ctl-settings-save-btn');
      if(saveBtn){ saveSettings(); return; }
      // Delete controller
      var delBtn = t.closest && t.closest('#hp-ctl-settings-delete-btn');
      if(delBtn){ deleteController(); return; }
      // Any settings button (chip row or column)
      var settingsBtn = t.closest && t.closest('[data-ctl-settings]');
      if(settingsBtn){ openSettings(String(settingsBtn.getAttribute('data-ctl-settings')||'')); return; }
      // Backdrop click to close
      if(t.id==='hp-ctl-config-modal'){ openModal('hp-ctl-config-modal', false); return; }
      if(t.id==='hp-ctl-settings-modal'){ openModal('hp-ctl-settings-modal', false); return; }
    });

    var selectEl = document.getElementById('hp-ctl-type-select');
    if(selectEl) selectEl.addEventListener('change', renderPreview);

    renderPreview();
    renderAll();
  })();

  // ── Settings nav switching ──────────────────────────────────────
  // NOTE FOR AI: Each settings section has its own accent color.
  // Add new entries to SECTION_COLORS when adding a new settings section.
  var SECTION_COLORS = {
    'studio-qb':              { fg: '#58a6ff', bg: 'rgba(88,166,255,.1)',  border: '#58a6ff' },
    'connectplus-settings':   { fg: '#22d3ee', bg: 'rgba(34,211,238,.1)',  border: '#22d3ee' },
    'parts-number-settings':  { fg: '#fb923c', bg: 'rgba(251,146,60,.1)',  border: '#fb923c' },
    'contact-information-settings': { fg: '#14b8a6', bg: 'rgba(20,184,166,.1)', border: '#14b8a6' },
    'studio-appearance':      { fg: '#0ea5e9', bg: 'rgba(14,165,233,.1)',  border: '#0ea5e9' },
    'studio-cache':           { fg: '#22d3ee', bg: 'rgba(34,211,238,.1)',  border: '#22d3ee' },
    'studio-integrations':    { fg: '#3fb950', bg: 'rgba(63,185,80,.1)',   border: '#3fb950' },
    'oncall-tech-settings':   { fg: '#22d3ee', bg: 'rgba(34,211,238,.1)',  border: '#22d3ee' },
  };

  document.querySelectorAll('.ss-settings-nav-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var section = btn.dataset.settingsSection;
      var colors  = SECTION_COLORS[section] || SECTION_COLORS['studio-qb'];

      // Reset ALL nav buttons to inactive state
      document.querySelectorAll('.ss-settings-nav-btn').forEach(function(b) {
        b.classList.remove('ss-settings-nav-active');
        b.style.background      = 'transparent';
        b.style.borderLeftColor = 'transparent';
        b.style.color           = 'var(--ss-muted)';
        b.style.opacity         = b.dataset.settingsSection === 'studio-integrations' ? '0.6' : '1';
      });

      // Activate clicked button with section accent color
      btn.classList.add('ss-settings-nav-active');
      btn.style.background      = colors.bg;
      btn.style.borderLeftColor = colors.border;
      btn.style.color           = colors.fg;
      btn.style.opacity         = '1';

      // Show only the target settings section panel
      document.querySelectorAll('[id^="settings-section-"]').forEach(function(s) {
        s.style.display = 'none';
      });
      var target = document.getElementById('settings-section-' + section);
      if (target) target.style.display = 'block';

      // Call section-specific load hooks after the DOM is updated
      if (section === 'studio-qb' && typeof window._sqbLoadSettings === 'function') {
        window._sqbLoadSettings();
      } else if (section === 'connectplus-settings' && typeof window._cpsLoadSettings === 'function') {
        window._cpsLoadSettings();
      } else if (section === 'parts-number-settings' && typeof window._pnsLoadSettings === 'function') {
        window._pnsLoadSettings();
      } else if (section === 'contact-information-settings' && typeof window._ctisLoadSettings === 'function') {
        window._ctisLoadSettings();
      } else if (section === 'studio-cache' && typeof window._cacheUI !== 'undefined') {
        window._cacheUI.refreshPanel();
      } else if (section === 'studio-appearance' && typeof window._appLoadDisplay === 'function') {
        window._appLoadDisplay();
      } else if (section === 'kb-settings' && typeof window._kbLoadSettings === 'function') {
        // FIX BUG 1: was missing — KB Settings fields were always blank
        // because _kbLoadSettings() was never called when clicking this nav item.
        window._kbLoadSettings();
      } else if (section === 'oncall-tech-settings' && typeof window._ocsLoadSettings === 'function') {
        window._ocsLoadSettings();
      }
    });
  });

})();
