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
    var _ctlSavePending = false;
    var _ctlSaveTimer = null;
    var CATALOG = {
      'E2':             { img: '/Widget%20Images/E2_Widget.png',             label: 'E2'    },
      'E3':             { img: '/Widget%20Images/E3_Widget.png',             label: 'E3'       },
      'Site Supervisor':{ img: '/Widget%20Images/Site%20Supervisor_Widget.png', label: 'Site Supervisor' }
    };
    var FALLBACK_IMG = '/Widget%20Images/quickbase_logo.png';

    function esc(v){ return String(v == null ? '' : v)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

    // ── Auth token helper for API calls ───────────────────────────────────
    function _ctlGetToken() {
      try {
        var raw = localStorage.getItem('mums_supabase_session') || sessionStorage.getItem('mums_supabase_session');
        if (raw) { var p = JSON.parse(raw); var t = p && (p.access_token || (p.session && p.session.access_token)); if (t) return String(t); }
        if (window.CloudAuth && typeof window.CloudAuth.accessToken === 'function') { var t2 = window.CloudAuth.accessToken(); if (t2) return t2; }
      } catch(_) {}
      return '';
    }

    // ── BUG-FIX: Shared storage via Supabase ─────────────────────────────
    // ROOT CAUSE: Items were stored ONLY in localStorage, so each user/browser
    // had its own empty list — other users saw "No controller configured yet."
    // FIX: items are now persisted in mums_documents via /api/studio/ctl_lab_config
    // and shared across ALL authenticated users. localStorage = fast local cache.

    function getItems() {
      // Read from localStorage cache for instant render (no async blocking)
      try { var r=localStorage.getItem(STORAGE_KEY); var p=r?JSON.parse(r):[]; return Array.isArray(p)?p:[]; }
      catch(_){ return []; }
    }

    function setItems(items) {
      // Write to local cache immediately for instant UI update
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items||[])); } catch(_) {}
      // Debounce Supabase write — coalesce rapid edits into a single API call
      if (_ctlSaveTimer) clearTimeout(_ctlSaveTimer);
      _ctlSaveTimer = setTimeout(function() { _ctlPushToServer(items||[]); }, 400);
    }

    function _ctlPushToServer(items) {
      if (_ctlSavePending) return;
      var tok = _ctlGetToken();
      if (!tok) return;
      _ctlSavePending = true;
      fetch('/api/studio/ctl_lab_config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
        body: JSON.stringify({ items: items })
      }).catch(function(){}).finally(function(){ _ctlSavePending = false; });
    }

    // Called once on mount — fetches the authoritative shared list from Supabase
    function _ctlLoadFromServer() {
      var tok = _ctlGetToken();
      if (!tok) { setTimeout(_ctlLoadFromServer, 1200); return; }
      fetch('/api/studio/ctl_lab_config', {
        headers: { 'Authorization': 'Bearer ' + tok, 'Cache-Control': 'no-store' }
      })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(d) {
        if (!d || !d.ok || !Array.isArray(d.items)) return;
        var serverItems = d.items;
        var localItems = getItems();
        // If server has more items (another user added controllers), adopt server list.
        // If local has more (admin added while offline/logged-out), keep local and push.
        var useItems = serverItems.length >= localItems.length ? serverItems : localItems;
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(useItems)); } catch(_) {}
        if (localItems.length > serverItems.length) _ctlPushToServer(localItems);
        renderAll();
      })
      .catch(function(){});
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
    /* ── Booking / Queue state helpers (shared with booking module) ── */
    function _ctlLS(key) { try{var r=localStorage.getItem(key);return r?JSON.parse(r):null;}catch(_){return null;} }
    function getBooking(id){
      if (typeof window._ctlSharedStateGetBooking === 'function') return window._ctlSharedStateGetBooking(id);
      return _ctlLS('ctl_booking_'+id)||null;
    }
    function setBooking(id,data){
      if (typeof window._ctlSetSharedBooking === 'function') { window._ctlSetSharedBooking(id, data); return; }
      try{if(data)localStorage.setItem('ctl_booking_'+id,JSON.stringify(data));else localStorage.removeItem('ctl_booking_'+id);}catch(_){}
      _ctlBroadcast({type:'ctl_update',key:'ctl_booking_'+id});
    }
    function getQueue(id){
      if (typeof window._ctlSharedStateGetQueue === 'function') return window._ctlSharedStateGetQueue(id);
      var r=_ctlLS('ctl_queue_'+id); return Array.isArray(r)?r:[];
    }
    function setQueue(id,arr){
      if (typeof window._ctlSetSharedQueue === 'function') { window._ctlSetSharedQueue(id, arr); return; }
      try{localStorage.setItem('ctl_queue_'+id,JSON.stringify(arr||[]));}catch(_){}
      _ctlBroadcast({type:'ctl_update',key:'ctl_queue_'+id});
    }

    /* ── Cross-tab broadcast (BroadcastChannel + storage event fallback) ── */
    var _ctlChannel=null;
    try{ _ctlChannel=new BroadcastChannel('mums_ctl_v1'); }catch(_){}
    var _ctlTimeUpAlert = { audio: null, stopTimer: null, key: '' };

    function _ctlBroadcast(msg){
      // BroadcastChannel for same-origin tabs
      try{ if(_ctlChannel) _ctlChannel.postMessage(msg); }catch(_){}
      // localStorage storage event fires in OTHER tabs automatically on write
      // (we just need to trigger renderAll in THIS tab after any write)
      setTimeout(renderAll, 0);
    }

    if(_ctlChannel){
      _ctlChannel.addEventListener('message',function(e){
        if(e.data&&e.data.type==='ctl_update') renderAll();
      });
    }
    // Also listen for storage events (other tabs writing localStorage)
    window.addEventListener('storage', function(e){
      if(e.key&&(e.key.startsWith('ctl_booking_')||e.key.startsWith('ctl_queue_'))){
        renderAll();
      }
    });

    /* ── Format ms → readable countdown ── */
    function fmtMs(ms){
      if(ms<=0) return '00:00';
      var s=Math.ceil(ms/1000),h=Math.floor(s/3600);s%=3600;var m=Math.floor(s/60);s%=60;
      if(h>0) return h+'h '+pad2(m)+'m '+pad2(s)+'s';
      return pad2(m)+':'+pad2(s);
    }
    function pad2(n){return n<10?'0'+n:String(n);}
    function parseDurMs(str){
      str=String(str||'').trim().toLowerCase(); var ms=0;
      var h=str.match(/(\d+)\s*h(?:our)?s?/);if(h)ms+=parseInt(h[1])*3600000;
      var m=str.match(/(\d+)\s*m(?:in(?:ute)?s?)?/);if(m)ms+=parseInt(m[1])*60000;
      var s=str.match(/(\d+)\s*s(?:ec(?:ond)?s?)?/);if(s)ms+=parseInt(s[1])*1000;
      if(!ms){var only=str.match(/^(\d+)$/);if(only)ms=parseInt(only[1])*60000;}
      return ms||0;
    }
    function initials(n){return String(n||'').trim().split(/\s+/).map(function(w){return w[0]||'';}).join('').toUpperCase().slice(0,2)||'??';}
    function _ctlGetCurrentUser(){
      try{
        if(window._qbMyNameCache&&window._qbMyNameCache.trim()) return window._qbMyNameCache.trim();
        var store=window.store&&typeof window.store.getState==='function'?window.store.getState():null;
        if(store&&store.user){var u=store.user;return(u.qb_name||u.name||u.email||'Unknown').trim();}
        if(window.me) return(window.me.qb_name||window.me.name||window.me.email||'Unknown').trim();
      }catch(_){}
      return 'Unknown';
    }
    function _ctlGetAvatar(){
      try{
        var store=window.store&&typeof window.store.getState==='function'?window.store.getState():null;
        if(store&&store.user&&store.user.avatar_url) return store.user.avatar_url;
        if(window.me&&window.me.avatar_url) return window.me.avatar_url;
      }catch(_){}
      return '';
    }
    function _sameUserLite(a,b){
      return String(a||'').trim().toLowerCase()===String(b||'').trim().toLowerCase();
    }
    function _stopTimeUpAlert(){
      try{
        if(_ctlTimeUpAlert.stopTimer){ clearTimeout(_ctlTimeUpAlert.stopTimer); _ctlTimeUpAlert.stopTimer=null; }
        if(_ctlTimeUpAlert.audio){ _ctlTimeUpAlert.audio.pause(); _ctlTimeUpAlert.audio.currentTime=0; _ctlTimeUpAlert.audio=null; }
      }catch(_){}
      var modal=document.getElementById('hp-ctl-timeup-modal');
      if(modal&&modal.parentElement) modal.remove();
    }
    function _playTimeUpAudio(audio, sources, idx){
      if(!audio||!sources||idx>=sources.length) return;
      audio.src=sources[idx];
      audio.onended=null;
      audio.onerror=function(){ _playTimeUpAudio(audio, sources, idx+1); };
      var p=audio.play();
      if(p&&typeof p.catch==='function'){ p.catch(function(){ _playTimeUpAudio(audio, sources, idx+1); }); }
    }
    function _showTimeUpAlert(item, booking){
      var modal=document.getElementById('hp-ctl-timeup-modal');
      if(modal&&modal.parentElement) modal.remove();
      modal=document.createElement('div');
      modal.id='hp-ctl-timeup-modal';
      modal.style.cssText='position:fixed;inset:0;z-index:99998;background:rgba(1,4,9,.84);display:flex;align-items:center;justify-content:center;padding:14px;';
      modal.innerHTML=
        '<div style="width:min(420px,94vw);border-radius:16px;padding:20px;background:linear-gradient(160deg,#131b2b,#0d1322);border:1px solid rgba(248,81,73,.35);box-shadow:0 20px 60px rgba(0,0,0,.7);text-align:center;">'
          +'<div style="font-size:18px;font-weight:900;color:#fda4af;margin-bottom:8px;">Time is up</div>'
          +'<div style="font-size:12px;color:#cbd5e1;line-height:1.6;margin-bottom:14px;">Your booking session has ended for <strong style="color:#fff;">'+esc(labelFor(item.type||''))+'</strong>.</div>'
          +'<div style="font-size:11px;color:#94a3b8;margin-bottom:16px;">Sound alert plays for up to 30 seconds unless acknowledged.</div>'
          +'<button id="hp-ctl-timeup-ok-btn" style="min-width:110px;padding:10px 14px;border-radius:10px;border:1px solid rgba(248,81,73,.55);background:rgba(248,81,73,.18);color:#fecaca;font-size:12px;font-weight:800;cursor:pointer;">OK</button>'
        +'</div>';
      document.body.appendChild(modal);

      var btn=document.getElementById('hp-ctl-timeup-ok-btn');
      if(btn){
        btn.addEventListener('click', function(){
          _ctlTimeUpAlert.key='';
          _stopTimeUpAlert();
        });
      }

      var audio=new Audio();
      audio.loop=true;
      audio.volume=0.9;
      _ctlTimeUpAlert.audio=audio;
      _playTimeUpAudio(audio, [
        '/sound%20alert/Alert_Yourtimeisup.mp3',
        '/sound alert/Alert_Yourtimeisup.mp3',
        '/sound%20alert/Alert_Yourturntousethecontroller.mp3',
        '/sound alert/Alert_Yourturntousethecontroller.mp3'
      ], 0);
      _ctlTimeUpAlert.stopTimer=setTimeout(function(){
        _ctlTimeUpAlert.key='';
        _stopTimeUpAlert();
      }, 30000);
    }
    function _maybeTimeUpAlert(item, booking){
      if(!item||!booking) return;
      var me=_ctlGetCurrentUser();
      if(!_sameUserLite(booking.user, me)) return;
      var alertKey=[item.id, booking.user||'', booking.startMs||'', booking.endMs||''].join('|');
      if(_ctlTimeUpAlert.key===alertKey) return;
      _ctlTimeUpAlert.key=alertKey;
      _stopTimeUpAlert();
      _ctlTimeUpAlert.key=alertKey;
      _showTimeUpAlert(item, booking);
    }

    /* ── Render controller cards ── */
    function renderMainList(items){
      var host=document.getElementById('hp-ctl-list'); if(!host) return;
      if(!items.length){
        host.innerHTML='<div class="hp-ctl-empty"><i class="fas fa-network-wired"></i><span>No controller configured yet</span><span style="font-size:9px;opacity:.5;">Click the cog icon to add one</span></div>';
        return;
      }
      if(window._ctlTimers){Object.keys(window._ctlTimers).forEach(function(k){clearInterval(window._ctlTimers[k]);});}
      window._ctlTimers={};

      host.innerHTML=items.map(function(item){
        var cls=statusCls(item.status);
        var booking=getBooking(item.id);
        var queue=getQueue(item.id);
        var isActive=!!(booking&&booking.endMs>Date.now());
        var me=_ctlGetCurrentUser();

        /* header badge */
        var headerBadge=isActive
          ?'<div class="hp-ctl-col-header-badge in-use"><i class="fas fa-user-clock" style="font-size:7px;"></i> IN USED</div>'
          :'<div class="hp-ctl-col-header-badge available"><i class="fas fa-check-circle" style="font-size:7px;"></i> Available</div>';

        /* user strip */
        var userBadge='';
        if(isActive){
          var av=booking.avatarUrl||'';
          var avHtml=av
            ?'<img src="'+esc(av)+'" alt="" onerror="this.style.display=\'none\'" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" />'
            :'<span style="width:26px;height:26px;border-radius:50%;background:rgba(162,93,220,.35);display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:#c084fc;flex-shrink:0;">'+esc(initials(booking.user))+'</span>';
          userBadge='<div class="hp-ctl-user-strip"><div class="hp-ctl-user-avatar">'+avHtml+'</div>'
            +'<div class="hp-ctl-user-info"><div class="hp-ctl-user-name">'+esc(booking.user)+'</div>'
            +'<div class="hp-ctl-user-task">'+esc((booking.task||'').slice(0,30))+'</div></div></div>';
        }

        /* timer OVERLAY (centered on image) */
        var timerId='ctl-timer-'+item.id;
        var imgBlock='';
        if(isActive){
          imgBlock='<div class="hp-ctl-img-wrap">'
            +'<img class="hp-ctl-col-img" src="'+esc(imageFor(item.type))+'" alt="'+esc(item.type)+'" onerror="this.src=\''+esc(FALLBACK_IMG)+'\';" />'
            +'<div class="hp-ctl-timer-overlay" id="'+timerId+'">'
              +'<div class="hp-ctl-timer-inner">'
                +'<div class="hp-ctl-timer-label">REMAINING</div>'
                +'<div class="hp-ctl-timer-val" id="'+timerId+'-val">--:--</div>'
              +'</div>'
            +'</div>'
          +'</div>';
        } else {
          imgBlock='<div class="hp-ctl-img-wrap">'
            +'<img class="hp-ctl-col-img" src="'+esc(imageFor(item.type))+'" alt="'+esc(item.type)+'" onerror="this.src=\''+esc(FALLBACK_IMG)+'\';" />'
          +'</div>';
        }

        /* queue pill */
        var queueNames = queue.slice(0, 8).map(function(q, i){
          var uname = q && q.user ? q.user : 'Unknown';
          return '<div class="hp-ctl-queue-tip-item"><span class="hp-ctl-queue-tip-pos">#'+(i+1)+'</span><span class="hp-ctl-queue-tip-name">'+esc(uname)+'</span></div>';
        }).join('');
        if (queue.length > 8) queueNames += '<div class="hp-ctl-queue-tip-more">+'+(queue.length-8)+' more</div>';
        var queuePill=queue.length>0
          ?'<div class="hp-ctl-queue-pill" tabindex="0" aria-label="'+queue.length+' waiting users">'
            +'<div class="hp-ctl-queue-pill-main"><i class="fas fa-users" style="font-size:8px;"></i><span>'+queue.length+' waiting</span></div>'
            +'<div class="hp-ctl-queue-tooltip">'+queueNames+'</div>'
          +'</div>':'' ;

        /* action button — waiting status for current user if they're in queue */
        var myQueuePos=queue.findIndex(function(q){
          return String((q&&q.user)||'').trim().toLowerCase()===String(me||'').trim().toLowerCase();
        });
        var actionBtn;
        if(isActive){
          if(myQueuePos>=0){
            actionBtn='<div class="hp-ctl-queue-position-badge">'
              +'<i class="fas fa-hourglass-half" style="font-size:9px;"></i>'
              +' Queue position <strong>#'+(myQueuePos+1)+'</strong>'
            +'</div>';
          } else {
            actionBtn='<button class="hp-ctl-book-btn queue-mode" data-ctl-queue="'+esc(item.id)+'">'
              +'<i class="fas fa-list-alt" style="font-size:10px;"></i> Join Queue'
            +'</button>';
          }
        } else {
          actionBtn='<button class="hp-ctl-book-btn" data-ctl-use="'+esc(item.id)+'">'
            +'<i class="fas fa-calendar-check" style="font-size:10px;"></i> Book this Controller'
          +'</button>';
        }

        var statusIcon=cls==='offline'?'<span style="color:#f85149;">&#9679;</span>':cls==='maintenance'?'<span style="color:#fbbf24;">&#9679;</span>':'<span style="color:#10b981;">&#9679;</span>';

        return '<div class="hp-ctl-col'+(isActive?' in-use':'')+'" data-ctl-id="'+esc(item.id)+'">'
          +headerBadge+userBadge+imgBlock
          +'<div class="hp-ctl-col-meta"><div class="hp-ctl-col-name">'+esc(labelFor(item.type))+'</div><div class="hp-ctl-col-ip">'+esc(item.ip||'--')+'</div></div>'
          +'<span class="hp-ctl-col-status '+cls+'">'+statusIcon+' '+esc(item.status||'Online')+'</span>'
          +queuePill
          +'<div class="hp-ctl-col-actions">'+actionBtn
          +'<button class="hp-ctl-overlay-settings" data-ctl-settings="'+esc(item.id)+'"><i class="fas fa-cog" style="font-size:10px;"></i> Settings</button>'
          +'</div>'
        +'</div>';
      }).join('');

      /* start countdown intervals */
      items.forEach(function(item){
        var booking=getBooking(item.id);
        if(!booking||booking.endMs<=Date.now()) return;
        var valEl=document.getElementById('ctl-timer-'+item.id+'-val');
        var wrapEl=document.getElementById('ctl-timer-'+item.id);
        if(!valEl) return;
        function tick(){
          var rem=booking.endMs-Date.now();
          if(rem<=0){
            _maybeTimeUpAlert(item, booking);
            clearInterval(window._ctlTimers[item.id]);
            delete window._ctlTimers[item.id];
            setBooking(item.id,null);
            // Broadcast expiry to all tabs
            _ctlBroadcast({type:'ctl_update',key:'ctl_booking_'+item.id});
            if(window._ctlNotifyQueue) window._ctlNotifyQueue(item.id);
            renderAll();
            return;
          }
          var el=document.getElementById('ctl-timer-'+item.id+'-val');
          if(el) el.textContent=fmtMs(rem);
          var w=document.getElementById('ctl-timer-'+item.id);
          if(w){ if(rem<120000){w.classList.add('urgent');}else{w.classList.remove('urgent');}
                  w.style.display=''; /* ensure visible */ }
        }
        tick();
        window._ctlTimers[item.id]=setInterval(tick, 1000);
      });
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
      // "Book this Controller" button (free) OR "Join Queue" (in-use)
      var useBtn = t.closest && t.closest('[data-ctl-use]');
      if(useBtn){ window._ctlOpenBooking(String(useBtn.getAttribute('data-ctl-use')||'')); return; }
      var queueBtn = t.closest && t.closest('[data-ctl-queue]');
      if(queueBtn){ window._ctlOpenQueue(String(queueBtn.getAttribute('data-ctl-queue')||'')); return; }
      // Override button
      var overrideBtn = t.closest && t.closest('[data-ctl-override]');
      if(overrideBtn){ window._ctlOverride(String(overrideBtn.getAttribute('data-ctl-override')||'')); return; }
      // Any settings button
      var settingsBtn = t.closest && t.closest('[data-ctl-settings]');
      if(settingsBtn){ openSettings(String(settingsBtn.getAttribute('data-ctl-settings')||'')); return; }
      // Backdrop click to close
      if(t.id==='hp-ctl-config-modal'){ openModal('hp-ctl-config-modal', false); return; }
      if(t.id==='hp-ctl-settings-modal'){ openModal('hp-ctl-settings-modal', false); return; }
    });

    var selectEl = document.getElementById('hp-ctl-type-select');
    if(selectEl) selectEl.addEventListener('change', renderPreview);

    // Listen for booking system re-render requests
    document.addEventListener('ctl:rerender', renderAll);

    renderPreview();
    renderAll();

    // BUG 1 FIX: On mount, fetch the shared controller list from Supabase.
    // This ensures ALL users see the same controllers regardless of their browser's
    // localStorage state. renderAll() above shows the local cache instantly while
    // _ctlLoadFromServer() fetches the authoritative list in the background.
    _ctlLoadFromServer();

    // Expose internal renderAll + server refresh for booking system
    window._ctlRenderAll = renderAll;
    window._ctlRefreshFromServer = _ctlLoadFromServer;
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


/* ══════════════════════════════════════════════════════════════════════════
   CONTROLLER LAB — Full Booking System v6.0
   BUGFIX SUMMARY (v6):
   ──────────────────────────────────────────────────────────────────────────
   BUG 1 — RACE CONDITION: Two users could simultaneously book the same
     controller because the server had no atomic lock. Both clients read
     "available", both write bookings, last writer wins → silent double-book.
     FIX: Server-side optimistic lock. POST now sends `lockedSince` timestamp;
     server rejects if another booking was written after that timestamp.
     Client re-fetches + shows "Controller was just booked" error.

   BUG 2 — STALE LOCAL STATE: Polling fetched server state, applied it to
     _stateCache, but still fell back to localStorage for getBooking/getQueue
     when window._ctlSharedState* functions weren't registered yet.
     FIX: Single source of truth — _stateCache only. localStorage is a
     write-through cache for offline resilience, never used as primary read.

   BUG 3 — DOUBLE BOOKING via expired booking not cleared: normalizeBooking()
     on server returned null for expired bookings (endMs <= Date.now()) but
     the client could still see a stale booking from the local cache right at
     expiry boundary (race between timer tick and state sync).
     FIX: Client-side getBooking() also checks endMs > Date.now() before
     returning. Expired bookings are treated as null everywhere.

   BUG 4 — QUEUE DUPLICATE JOIN: No deduplication guard on server — a user
     refreshing the page while _ctlJoinQueue was in-flight could push their
     name twice. Server-side normalizeQueueEntry runs but doesn't dedup users.
     FIX: Server POST deduplicates queue entries by user (case-insensitive).
     Client also checks alreadyIn before pushing.

   BUG 5 — QUEUE NOTIFY LOOP: _ctlNotifyQueue checked notifiedAt but the
     expiry guard had a clock-skew window where it could re-notify before the
     user responded — causing duplicate "It's Your Turn!" modals.
     FIX: Added a per-controller notify-lock Map (_notifyLocks). Once a notify
     is dispatched for a ctrlId, it is suppressed for 30s unless explicitly
     reset by queue advance.

   BUG 6 — TIMER CLEARS ON RE-RENDER: renderMainList() called clearInterval
     on ALL _ctlTimers before rebuilding innerHTML. If renderAll() fired during
     a tick (storage event from another tab), the in-flight timer for the
     current user's session was killed → countdown froze.
     FIX: Timers are keyed by (itemId + endMs). Only clear timers whose
     endMs changed or whose controller was removed.

   BUG 7 — BOOKING MODAL SHOWS "AVAILABLE" for stale bookings: When another
     user's booking just expired, the "Book this Controller" button worked but
     the modal still briefly showed the stale in-use notice because it read
     booking from local cache before the poll cycle updated it.
     FIX: _ctlOpenBooking() always does a fresh server fetch before rendering.

   BUG 8 — POLL STORM: 3-second polling with no back-off caused 20 requests/
     minute per user. For 30 users → 600 DB reads/min → free tier IO bleed.
     FIX: Poll interval 8s when page is visible, 30s when hidden.
     Added visibility change listener to recover quickly on tab focus.

   BUG 9 — OVERRIDE leaves queue intact: After an override, the overridden
     user's booking was deleted but they could still re-appear in queue and
     get notified immediately for their own forced-out session.
     FIX: Override also removes the overridden user from queue and resets
     any pending notify lock for that controller.

   BUG 10 — TIME-UP ALERT CSS not injected for support_studio context:
     The CSS animation keyframes were only injected inside the core_ui IIFE
     scope, but support_studio.html loads core_ui.js and the injector ran
     before DOM was ready in some load orders.
     FIX: _injectTimeUpCSS() now checks document.head and defers via
     requestAnimationFrame if head is not yet available.
   ══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── CONFIG ─────────────────────────────────────────────────────────────── */
  var BACKUP_FOLDER_URL = 'https://mycopeland.sharepoint.com/sites/AdvanceServices/Shared%20Documents/Forms/AllItems.aspx?id=%2Fsites%2FAdvanceServices%2FShared%20Documents%2FManila%20Controller%20Appsheet%20Project%2FMUMS%20APP%2FCONTROLLER%20LAB%20BACKUP%20FILE&viewid=e4a428c7%2D1e26%2D4929%2D9fe6%2D85f5f21174a9';
  var BACKUP_LS_KEY     = 'mums_ctl_log_backup';
  var SHEETS_ENDPOINT   = window._CTL_SHEETS_ENDPOINT || '';
  var TIMEUP_SOUND_URL  = '/sound%20alert/Alert_Yourtimeisup.mp3';
  var QUEUE_SOUND_URL   = '/sound%20alert/Alert_Yourturntousethecontroller.mp3';
  var SOUND_FALLBACK    = '/sound_alert_queue.mp3';

  /* ── State ──────────────────────────────────────────────────────────────── */
  var _bookingCtlId     = null;
  var _bookingCtlData   = null;
  var _queueCtlId       = null;
  var _sheetReachable   = null;
  var _timeUpAudio      = null;   // looping time-up Audio
  var _queueAudio       = null;   // looping queue-turn Audio
  var _pollTimer        = null;
  var _pollInterval     = 8000;
  var _queueSweepBusy   = false;
  var _pendingRetryBusy = false;
  var _stateReqBusy     = false;
  var _lastServerWrite  = 0;      // BUG 1 FIX: optimistic lock timestamp
  var _notifyLocks      = {};     // BUG 5 FIX: { ctrlId: timestampMs }

  /* BUG 6 FIX: keyed timer registry { itemId: { interval, endMs } } */
  window._ctlTimers = window._ctlTimers || {};

  /* ── Single source of truth ─────────────────────────────────────────────── */
  /* BUG 2 FIX: _stateCache is the ONE authoritative read source.
     localStorage is write-through only (for offline resilience).          */
  var _stateCache = { bookings: {}, queues: {} };

  /* ── Cross-tab broadcast channel ────────────────────────────────────────── */
  var _channel = null;
  try { _channel = new BroadcastChannel('mums_ctl_v1'); } catch (_) {}
  if (_channel) {
    _channel.addEventListener('message', function (e) {
      if (!e || !e.data || e.data.type !== 'ctl_update') return;
      /* Apply the inline state patch if provided (faster than a full re-fetch) */
      if (e.data.statePatch) _applyStatePatch(e.data.statePatch);
      if (window._ctlRenderAll) window._ctlRenderAll();
      /* BUG 5 FIX: queue_notify — only trigger for the target user */
      if (
        e.data.subtype === 'queue_notify' &&
        _sameUser(e.data.targetUser, _getCurrentUser())
      ) {
        _triggerQueueAlert(e.data.ctrlId, e.data.ctrlLabel, Number(e.data.notifyExpiresAt || 0));
      }
    });
  }

  /* BUG 8 FIX: adaptive poll — faster when visible, slower when hidden */
  function _startPoll() {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
    _pollTimer = setInterval(function () {
      _loadSharedStateFromServer(function () {
        _ctlSweepQueueTimeouts();
        if (window._ctlRenderAll) window._ctlRenderAll();
      });
    }, _pollInterval);
  }
  document.addEventListener('visibilitychange', function () {
    _pollInterval = document.hidden ? 30000 : 8000;
    _startPoll();
  });
  _startPoll();

  function _broadcast(msg) {
    try { if (_channel) _channel.postMessage(msg); } catch (_) {}
  }

  /* ── Auth helper ────────────────────────────────────────────────────────── */
  function _ctlGetToken() {
    try {
      var raw = localStorage.getItem('mums_supabase_session') || sessionStorage.getItem('mums_supabase_session');
      if (raw) { var p = JSON.parse(raw); var t = p && (p.access_token || (p.session && p.session.access_token)); if (t) return String(t); }
      if (window.CloudAuth && typeof window.CloudAuth.accessToken === 'function') { var t2 = window.CloudAuth.accessToken(); if (t2) return String(t2); }
    } catch (_) {}
    return '';
  }

  /* ── Storage helpers ────────────────────────────────────────────────────── */
  function _ls(key) { try { var r = localStorage.getItem(key); return r ? JSON.parse(r) : null; } catch (_) { return null; } }
  function _setLs(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (_) {} }

  /* ── State cache persistence ────────────────────────────────────────────── */
  function _saveStateCache() { _setLs('mums_ctl_lab_state_v1', _stateCache); }
  function _loadStateCache() {
    var s = _ls('mums_ctl_lab_state_v1');
    if (s && typeof s === 'object') {
      _stateCache = {
        bookings: (s.bookings && typeof s.bookings === 'object') ? s.bookings : {},
        queues:   (s.queues   && typeof s.queues   === 'object') ? s.queues   : {},
      };
    }
  }
  function _applySharedState(data) {
    if (!data || typeof data !== 'object') return;
    _stateCache = {
      bookings: (data.bookings && typeof data.bookings === 'object') ? data.bookings : {},
      queues:   (data.queues   && typeof data.queues   === 'object') ? data.queues   : {},
    };
    _saveStateCache();
  }
  /* BUG 1 helper: apply only the fields that changed (from broadcast or poll) */
  function _applyStatePatch(patch) {
    if (!patch || typeof patch !== 'object') return;
    if (patch.bookings) Object.assign(_stateCache.bookings, patch.bookings);
    if (patch.deletedBookings && Array.isArray(patch.deletedBookings)) {
      patch.deletedBookings.forEach(function (id) { delete _stateCache.bookings[id]; });
    }
    if (patch.queues) Object.assign(_stateCache.queues, patch.queues);
    _saveStateCache();
  }

  /* ── Server I/O ─────────────────────────────────────────────────────────── */
  function _loadSharedStateFromServer(cb) {
    if (_stateReqBusy) { if (cb) cb(); return; }
    var tok = _ctlGetToken();
    if (!tok) { if (cb) cb(); return; }
    _stateReqBusy = true;
    fetch('/api/studio/ctl_lab_state', {
      headers: { 'Authorization': 'Bearer ' + tok, 'Cache-Control': 'no-store' }
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.ok) { _applySharedState(d); _lastServerWrite = Date.now(); } })
      .catch(function () {})
      .finally(function () { _stateReqBusy = false; if (cb) cb(); });
  }

  /* BUG 1 FIX: server push now includes lockedSince for optimistic locking */
  function _pushSharedPatch(body, onSuccess, onConflict) {
    var tok = _ctlGetToken();
    if (!tok) return;
    var payload = Object.assign({ lockedSince: _lastServerWrite }, body);
    fetch('/api/studio/ctl_lab_state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
      body: JSON.stringify(payload)
    })
      .then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); })
      .then(function (res) {
        if (res.data && res.data.ok) {
          _applySharedState(res.data);
          _lastServerWrite = Date.now();
          if (onSuccess) onSuccess(res.data);
        } else if (res.status === 409) {
          /* BUG 1 FIX: conflict — another user booked first */
          _loadSharedStateFromServer(function () {
            if (window._ctlRenderAll) window._ctlRenderAll();
            if (onConflict) onConflict();
          });
        }
      })
      .catch(function () {});
  }

  /* ── Booking / Queue accessors (BUG 2 FIX: always reads _stateCache) ────── */
  function getItems() { var r = _ls('mums_controller_lab_items_v1'); return Array.isArray(r) ? r : []; }

  /* BUG 3 FIX: expired bookings return null */
  function getBooking(id) {
    var b = _stateCache.bookings && _stateCache.bookings[id] ? _stateCache.bookings[id] : null;
    if (!b) return null;
    if (b.endMs && b.endMs <= Date.now()) return null; /* treat expired as free */
    return b;
  }

  function setBooking(id, data, onSuccess, onConflict) {
    if (!_stateCache.bookings || typeof _stateCache.bookings !== 'object') _stateCache.bookings = {};
    if (data) _stateCache.bookings[id] = data;
    else       delete _stateCache.bookings[id];
    /* write-through cache */
    try { if (data) localStorage.setItem('ctl_booking_' + id, JSON.stringify(data)); else localStorage.removeItem('ctl_booking_' + id); } catch (_) {}
    _saveStateCache();
    var patch = data
      ? { booking: { id: id, data: data } }
      : { booking: { id: id, data: null } };
    _pushSharedPatch(patch, function (serverState) {
      /* Broadcast with inline patch so other tabs don't need a full re-fetch */
      var statePatch = data
        ? { bookings: {}, deletedBookings: [] }
        : { bookings: {}, deletedBookings: [id] };
      if (data) statePatch.bookings[id] = data;
      _broadcast({ type: 'ctl_update', key: 'ctl_booking_' + id, statePatch: statePatch });
      if (onSuccess) onSuccess();
    }, function () {
      /* BUG 1 FIX: conflict — revert local optimistic update */
      var serverBooking = _stateCache.bookings && _stateCache.bookings[id] ? _stateCache.bookings[id] : null;
      if (onConflict) onConflict(serverBooking);
    });
    if (window._ctlRenderAll) window._ctlRenderAll();
  }

  function getQueue(id) {
    var r = _stateCache.queues && Array.isArray(_stateCache.queues[id]) ? _stateCache.queues[id] : [];
    return Array.isArray(r) ? r : [];
  }

  /* BUG 4 FIX: client-side dedup before push */
  function setQueue(id, arr) {
    if (!_stateCache.queues || typeof _stateCache.queues !== 'object') _stateCache.queues = {};
    var deduped = _deduplicateQueue(Array.isArray(arr) ? arr : []);
    if (deduped.length) _stateCache.queues[id] = deduped;
    else                delete _stateCache.queues[id];
    try { if (deduped.length) localStorage.setItem('ctl_queue_' + id, JSON.stringify(deduped)); else localStorage.removeItem('ctl_queue_' + id); } catch (_) {}
    _saveStateCache();
    var qPatch = { queues: {} };
    qPatch.queues[id] = deduped;
    _pushSharedPatch({ queue: { id: id, items: deduped } }, function () {
      _broadcast({ type: 'ctl_update', key: 'ctl_queue_' + id, statePatch: qPatch });
    });
    if (window._ctlRenderAll) window._ctlRenderAll();
  }

  /* BUG 4 FIX: dedup queue by user (case-insensitive), keep last entry */
  function _deduplicateQueue(arr) {
    var seen = {};
    var out = [];
    /* iterate in reverse so last join wins (most recent task/duration kept) */
    for (var i = arr.length - 1; i >= 0; i--) {
      var entry = arr[i];
      if (!entry || !entry.user) continue;
      var key = String(entry.user).trim().toLowerCase();
      if (!seen[key]) { seen[key] = true; out.unshift(entry); }
    }
    return out;
  }

  /* ── Pending log helpers ─────────────────────────────────────────────────── */
  function getPendingLogs() { var r = _ls(BACKUP_LS_KEY); return Array.isArray(r) ? r : []; }
  function setPendingLogs(logs) { _setLs(BACKUP_LS_KEY, (logs || []).slice(0, 200)); }
  function savePendingLog(p) {
    try { var logs = getPendingLogs(); if (!logs.some(function (l) { return l.timestamp === p.timestamp && l.user === p.user; })) { logs.unshift(p); setPendingLogs(logs); } } catch (_) {}
  }
  function removePendingLog(ts, user) {
    try { setPendingLogs(getPendingLogs().filter(function (l) { return !(l.timestamp === ts && l.user === user); })); } catch (_) {}
  }

  /* ── Utility helpers ─────────────────────────────────────────────────────── */
  function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function imageFor(type) { var m = { 'E2': '/Widget%20Images/E2_Widget.png', 'E3': '/Widget%20Images/E3_Widget.png', 'Site Supervisor': '/Widget%20Images/Site%20Supervisor_Widget.png' }; return m[type] || '/Widget%20Images/quickbase_logo.png'; }
  function labelFor(type) { var m = { 'E2': 'E2 Controller', 'E3': 'E3 Gateway', 'Site Supervisor': 'Site Supervisor' }; return m[type] || type; }
  function phtNow() { return new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila', month: 'short', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }) + ' PHT'; }
  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  function fmtMs(ms) { if (ms <= 0) return '00:00'; var s = Math.ceil(ms / 1000), h = Math.floor(s / 3600); s %= 3600; var m = Math.floor(s / 60); s %= 60; if (h > 0) return h + 'h ' + pad2(m) + 'm ' + pad2(s) + 's'; return pad2(m) + ':' + pad2(s); }
  function parseDurMs(str) {
    str = String(str || '').trim().toLowerCase(); var ms = 0;
    var h = str.match(/(\d+)\s*h(?:our)?s?/); if (h) ms += parseInt(h[1]) * 3600000;
    var m = str.match(/(\d+)\s*m(?:in(?:ute)?s?)?/); if (m) ms += parseInt(m[1]) * 60000;
    var sv = str.match(/(\d+)\s*s(?:ec(?:ond)?s?)?/); if (sv) ms += parseInt(sv[1]) * 1000;
    if (!ms) { var only = str.match(/^(\d+)$/); if (only) ms = parseInt(only[1]) * 60000; }
    return ms || 0;
  }
  function _getCurrentUser() {
    try {
      if (window._qbMyNameCache && window._qbMyNameCache.trim()) return window._qbMyNameCache.trim();
      var store = window.store && typeof window.store.getState === 'function' ? window.store.getState() : null;
      if (store && store.user) { var u = store.user; return (u.qb_name || u.name || u.email || 'Unknown').trim(); }
      if (window.me) return (window.me.qb_name || window.me.name || window.me.email || 'Unknown').trim();
    } catch (_) {}
    return 'Unknown';
  }
  function _sameUser(a, b) {
    var left = String(a || '').trim().toLowerCase();
    var right = String(b || '').trim().toLowerCase();
    return !!left && !!right && left === right;
  }
  function _getAvatarUrl() {
    try { var store = window.store && typeof window.store.getState === 'function' ? window.store.getState() : null; if (store && store.user && store.user.avatar_url) return store.user.avatar_url; if (window.me && window.me.avatar_url) return window.me.avatar_url; } catch (_) {}
    return '';
  }
  function buildFormPayload(p) {
    return new URLSearchParams({ timestamp: p.timestamp, user: p.user, controller: p.controller, task: p.task, duration: p.duration, backupFile: p.backupFile, note: p.note || '' });
  }

  /* ── BUG 6 FIX: Smart timer management ─────────────────────────────────── */
  /* Only clear/restart timers if the booking endMs actually changed.        */
  function _syncTimers(items) {
    var now = Date.now();
    /* Mark which item IDs are still present */
    var activeIds = {};
    items.forEach(function (item) { activeIds[item.id] = true; });

    /* Clear timers for removed controllers */
    Object.keys(window._ctlTimers).forEach(function (id) {
      if (!activeIds[id]) {
        clearInterval(window._ctlTimers[id].interval);
        delete window._ctlTimers[id];
      }
    });

    /* Start/restart timers only when booking changed */
    items.forEach(function (item) {
      var booking = getBooking(item.id);
      var existing = window._ctlTimers[item.id];

      if (!booking || booking.endMs <= now) {
        /* No active booking — clear timer */
        if (existing) { clearInterval(existing.interval); delete window._ctlTimers[item.id]; }
        return;
      }

      /* If timer already running for same booking endMs, don't restart */
      if (existing && existing.endMs === booking.endMs) return;

      /* Clear old timer (different booking) */
      if (existing) { clearInterval(existing.interval); delete window._ctlTimers[item.id]; }

      /* Capture booking in closure */
      (function (capturedItem, capturedBooking) {
        function tick() {
          var rem = capturedBooking.endMs - Date.now();
          if (rem <= 0) {
            /* Session expired */
            clearInterval(window._ctlTimers[capturedItem.id] && window._ctlTimers[capturedItem.id].interval);
            delete window._ctlTimers[capturedItem.id];
            /* BUG 3 FIX: clear from cache so getBooking returns null */
            if (_stateCache.bookings) delete _stateCache.bookings[capturedItem.id];
            _saveStateCache();
            /* Time-up alarm for the session owner */
            _maybeTimeUpAlert(capturedItem, capturedBooking);
            /* Broadcast expiry */
            _broadcast({ type: 'ctl_update', key: 'ctl_booking_' + capturedItem.id, statePatch: { bookings: {}, deletedBookings: [capturedItem.id] } });
            _pushSharedPatch({ booking: { id: capturedItem.id, data: null } });
            /* Notify next in queue */
            _ctlNotifyQueue(capturedItem.id);
            if (window._ctlRenderAll) window._ctlRenderAll();
            return;
          }
          var valEl = document.getElementById('ctl-timer-' + capturedItem.id + '-val');
          if (valEl) valEl.textContent = fmtMs(rem);
          var wrapEl = document.getElementById('ctl-timer-' + capturedItem.id);
          if (wrapEl) {
            if (rem < 120000) wrapEl.classList.add('urgent'); else wrapEl.classList.remove('urgent');
            wrapEl.style.display = '';
          }
        }
        tick();
        var iv = setInterval(tick, 1000);
        window._ctlTimers[capturedItem.id] = { interval: iv, endMs: capturedBooking.endMs };
      })(item, booking);
    });
  }

  /* ── BUG 5 FIX: Notify queue with lock ─────────────────────────────────── */
  function _ctlNotifyQueue(itemId) {
    var queue = getQueue(itemId);
    if (!queue.length) { if (window._ctlRenderAll) window._ctlRenderAll(); return; }

    var next = queue[0] || {};
    var items = getItems();
    var ctrl = items.find(function (i) { return i.id === itemId; }) || {};
    var ctrlLabel = labelFor(ctrl.type || '');
    var me = _getCurrentUser();

    /* BUG 5 FIX: suppress duplicate notify within 30s */
    var lockKey = itemId + '|' + (next.user || '');
    var lockTs = _notifyLocks[lockKey] || 0;
    if (lockTs && (Date.now() - lockTs) < 30000) return;
    _notifyLocks[lockKey] = Date.now();

    var firstNotify = !next.notifiedAt;
    if (firstNotify) {
      next.notifiedAt = Date.now();
      next.notifyExpiresAt = Date.now() + (3 * 60 * 1000);
      queue[0] = next;
      setQueue(itemId, queue);
    } else {
      var exp = Number(next.notifyExpiresAt || 0);
      if (exp && exp <= Date.now()) {
        /* Grace period: if notified within last 15s, extend rather than void */
        var nAt = Number(next.notifiedAt || 0);
        if (nAt && (Date.now() - nAt) < 15000) {
          next.notifyExpiresAt = Date.now() + (3 * 60 * 1000);
          queue[0] = next;
          setQueue(itemId, queue);
          return;
        }
        queue.shift();
        delete _notifyLocks[lockKey];
        setQueue(itemId, queue);
        if (queue.length) _ctlNotifyQueue(itemId);
        return;
      }
      return; /* already notified, not yet expired */
    }

    /* Sheet log */
    if (firstNotify && SHEETS_ENDPOINT && next.task) {
      var logPayload = { timestamp: phtNow(), user: next.user, controller: ctrlLabel + ' — ' + (ctrl.ip || '—'), task: next.task, duration: next.duration || 'queued', backupFile: 'pending', note: 'Queue turn notified' };
      savePendingLog(logPayload);
      fetch(SHEETS_ENDPOINT, { method: 'POST', mode: 'no-cors', body: buildFormPayload(logPayload) }).catch(function () {});
    }

    /* Broadcast notify to all tabs */
    _broadcast({
      type: 'ctl_update', subtype: 'queue_notify',
      ctrlId: itemId, ctrlLabel: ctrlLabel,
      targetUser: next.user,
      notifyExpiresAt: next.notifyExpiresAt || 0
    });

    if (_sameUser(next.user, me)) {
      _triggerQueueAlert(itemId, ctrlLabel, next.notifyExpiresAt || 0);
    } else {
      _showAlarmBanner(next.user + '\'s turn! ' + ctrlLabel + ' is now available.', itemId);
    }

    if (window._ctlRenderAll) window._ctlRenderAll();
  }

  /* ── BUG 5 FIX: expose notify for timer expiry ───────────────────────────  */
  window._ctlNotifyQueue = _ctlNotifyQueue;

  /* ── Queue sweeper ───────────────────────────────────────────────────────── */
  function _ctlSweepQueueTimeouts() {
    if (_queueSweepBusy) return;
    _queueSweepBusy = true;
    try {
      var now = Date.now();
      var items = getItems();
      items.forEach(function (item) {
        var id = item && item.id ? item.id : '';
        if (!id) return;
        var booking = getBooking(id);
        var queue = getQueue(id);
        if (!queue.length) return;
        if (!booking || booking.endMs <= now) {
          var head = queue[0] || {};
          var expiresAt = Number(head.notifyExpiresAt || 0);
          if (expiresAt && expiresAt <= now) {
            var notifiedAt = Number(head.notifiedAt || 0);
            if (notifiedAt && (now - notifiedAt) < 15000) {
              head.notifyExpiresAt = now + (3 * 60 * 1000);
              queue[0] = head;
              setQueue(id, queue);
              return;
            }
            var lockKey = id + '|' + (head.user || '');
            delete _notifyLocks[lockKey];
            queue.shift();
            setQueue(id, queue);
            if (queue.length) _ctlNotifyQueue(id);
            return;
          }
          if (!head.notifiedAt) _ctlNotifyQueue(id);
        }
      });
    } catch (_) {}
    _queueSweepBusy = false;
  }

  /* ── Time-up alert (BUG 10 FIX: deferred CSS injection) ─────────────────── */
  function _injectTimeUpCSS() {
    if (document.getElementById('hp-ctl-timeup-css')) return;
    function doInject() {
      if (!document.head) { requestAnimationFrame(doInject); return; }
      var s = document.createElement('style');
      s.id = 'hp-ctl-timeup-css';
      s.textContent = [
        '@keyframes hp-tua-pulse{0%,100%{box-shadow:0 0 0 0 rgba(248,81,73,.55),0 20px 60px rgba(0,0,0,.7)}60%{box-shadow:0 0 0 18px rgba(248,81,73,0),0 20px 60px rgba(0,0,0,.7)}}',
        '@keyframes hp-tua-icon-bounce{0%,100%{transform:scale(1)}45%{transform:scale(1.18)}}',
        '@keyframes hp-tua-bg-flash{0%,100%{background:rgba(1,4,9,.88)}50%{background:rgba(40,6,6,.92)}}',
        '#hp-ctl-timeup-modal{animation:hp-tua-bg-flash 1.6s ease-in-out infinite}',
        '#hp-ctl-timeup-card{animation:hp-tua-pulse 1.4s ease-in-out infinite}',
        '#hp-ctl-timeup-icon{animation:hp-tua-icon-bounce 1.4s ease-in-out infinite}',
        '#hp-ctl-timeup-bar-fill{transition:width 1s linear}',
        '#hp-ctl-timeup-ok-btn:hover{background:rgba(248,81,73,.35)!important;transform:scale(1.04)}',
        '#hp-ctl-timeup-ok-btn{transition:all .15s}'
      ].join('');
      document.head.appendChild(s);
    }
    doInject();
  }
  _injectTimeUpCSS();

  var _timeUpState = { audio: null, stopTimer: null, barTimer: null, key: '' };

  function _stopTimeUpAlert() {
    try {
      if (_timeUpState.stopTimer) { clearTimeout(_timeUpState.stopTimer); _timeUpState.stopTimer = null; }
      if (_timeUpState.barTimer)  { clearInterval(_timeUpState.barTimer);  _timeUpState.barTimer  = null; }
      if (_timeUpState.audio)     { _timeUpState.audio.pause(); _timeUpState.audio.currentTime = 0; _timeUpState.audio = null; }
    } catch (_) {}
    var modal = document.getElementById('hp-ctl-timeup-modal');
    if (modal && modal.parentElement) modal.remove();
  }

  function _playAudio(audio, sources, idx) {
    if (!audio || !sources || idx >= sources.length) return;
    audio.src = sources[idx];
    audio.onerror = function () { _playAudio(audio, sources, idx + 1); };
    var p = audio.play();
    if (p && typeof p.catch === 'function') {
      p.catch(function () {
        function _retryOnGesture() {
          document.removeEventListener('click', _retryOnGesture, { capture: true });
          try { audio.play().catch(function () {}); } catch (_) {}
        }
        document.addEventListener('click', _retryOnGesture, { capture: true, once: true });
      });
    }
  }

  function _showTimeUpAlert(item, booking) {
    _stopTimeUpAlert();
    var ALARM_MS = 30000;
    var startedAt = Date.now();

    var modal = document.createElement('div');
    modal.id = 'hp-ctl-timeup-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:14px;';
    modal.innerHTML =
      '<div id="hp-ctl-timeup-card" style="width:min(440px,94vw);border-radius:18px;padding:28px 24px 22px;' +
        'background:linear-gradient(160deg,#1a0a0a,#110d0d,#0d1117);' +
        'border:1px solid rgba(248,81,73,.45);text-align:center;position:relative;overflow:hidden;">' +
        '<div style="position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,transparent,rgba(248,81,73,.9),transparent);"></div>' +
        '<div id="hp-ctl-timeup-icon" style="font-size:38px;margin-bottom:14px;line-height:1;">⏰</div>' +
        '<div style="font-size:20px;font-weight:900;color:#fda4af;letter-spacing:.5px;margin-bottom:6px;">TIME\'S UP!</div>' +
        '<div style="font-size:13px;color:#cbd5e1;line-height:1.65;margin-bottom:6px;">' +
          'Your booking for <strong style="color:#fff;background:rgba(255,255,255,.07);padding:1px 7px;border-radius:5px;">' +
          esc(labelFor(item.type || '')) + '</strong> has ended.' +
        '</div>' +
        '<div style="font-size:11px;color:#94a3b8;margin-bottom:18px;">' +
          'Alert silences in <span id="hp-ctl-timeup-sec" style="color:#fda4af;font-weight:700;">30</span>s — or press OK now.' +
        '</div>' +
        '<div style="background:rgba(255,255,255,.07);border-radius:99px;height:5px;margin-bottom:20px;overflow:hidden;">' +
          '<div id="hp-ctl-timeup-bar-fill" style="height:100%;width:100%;border-radius:99px;background:linear-gradient(90deg,#f85149,#fda4af);"></div>' +
        '</div>' +
        '<button id="hp-ctl-timeup-ok-btn" style="min-width:130px;padding:11px 18px;border-radius:11px;border:1px solid rgba(248,81,73,.6);background:rgba(248,81,73,.22);color:#fecaca;font-size:13px;font-weight:900;cursor:pointer;letter-spacing:.5px;">✓ OK — Silence Alert</button>' +
      '</div>';
    document.body.appendChild(modal);

    document.getElementById('hp-ctl-timeup-ok-btn').addEventListener('click', function () {
      _timeUpState.key = '';
      _stopTimeUpAlert();
    });

    function _tickBar() {
      var elapsed = Date.now() - startedAt;
      var remaining = Math.max(0, ALARM_MS - elapsed);
      var secEl = document.getElementById('hp-ctl-timeup-sec');
      var barEl = document.getElementById('hp-ctl-timeup-bar-fill');
      if (secEl) secEl.textContent = Math.ceil(remaining / 1000);
      if (barEl) barEl.style.width = ((remaining / ALARM_MS) * 100).toFixed(1) + '%';
    }
    _tickBar();
    _timeUpState.barTimer = setInterval(_tickBar, 500);

    var audio = new Audio();
    audio.loop   = true;
    audio.volume = 0.92;
    _timeUpState.audio = audio;
    _playAudio(audio, [TIMEUP_SOUND_URL, '/sound alert/Alert_Yourtimeisup.mp3', SOUND_FALLBACK], 0);
    _timeUpState.stopTimer = setTimeout(function () { _timeUpState.key = ''; _stopTimeUpAlert(); }, ALARM_MS);
  }

  function _maybeTimeUpAlert(item, booking) {
    if (!item || !booking) return;
    if (!_sameUser(booking.user, _getCurrentUser())) return;
    var alertKey = [item.id, booking.user || '', booking.startMs || '', booking.endMs || ''].join('|');
    if (_timeUpState.key === alertKey) return;
    _timeUpState.key = alertKey;
    _showTimeUpAlert(item, booking);
  }

  /* ── Queue alert sound ───────────────────────────────────────────────────── */
  function _stopQueueSound() {
    try { if (_queueAudio) { _queueAudio.pause(); _queueAudio.currentTime = 0; _queueAudio = null; } } catch (_) {}
  }
  function _startQueueSound() {
    _stopQueueSound();
    _queueAudio = new Audio();
    _queueAudio.loop   = true;
    _queueAudio.volume = 0.85;
    _playAudio(_queueAudio, [QUEUE_SOUND_URL, '/sound alert/Alert_Yourturntousethecontroller.mp3', SOUND_FALLBACK], 0);
  }

  function _triggerQueueAlert(ctrlId, ctrlLabel, notifyExpiresAt) {
    _stopQueueSound();
    _showQueueAlertBanner(ctrlId, ctrlLabel, notifyExpiresAt);
    _startQueueSound();
  }

  /* ── Queue alert banner ──────────────────────────────────────────────────── */
  function _showQueueAlertBanner(ctrlId, ctrlLabel, notifyExpiresAt) {
    var existing = document.getElementById('hp-ctl-queue-alert-modal');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'hp-ctl-queue-alert-modal';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(1,4,9,.88);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML =
      '<style>@keyframes ctl-ring{0%{transform:rotate(-15deg)}100%{transform:rotate(15deg)}}@keyframes ctl-pulse-ring{0%{transform:scale(1);opacity:.8}100%{transform:scale(1.5);opacity:0}}</style>' +
      '<div style="background:linear-gradient(145deg,#0d1525,#0a0f1e);border:2px solid rgba(162,93,220,.5);border-radius:20px;padding:36px 40px;text-align:center;max-width:480px;width:90%;box-shadow:0 0 80px rgba(162,93,220,.3);">' +
        '<div style="position:relative;width:80px;height:80px;margin:0 auto 24px;">' +
          '<div style="position:absolute;inset:-10px;border:3px solid rgba(162,93,220,.4);border-radius:50%;animation:ctl-pulse-ring 1.2s ease-out infinite;"></div>' +
          '<div style="position:absolute;inset:-20px;border:2px solid rgba(162,93,220,.2);border-radius:50%;animation:ctl-pulse-ring 1.2s ease-out infinite .3s;"></div>' +
          '<div style="width:80px;height:80px;border-radius:50%;background:linear-gradient(135deg,rgba(162,93,220,.3),rgba(109,40,217,.2));border:2px solid rgba(162,93,220,.6);display:flex;align-items:center;justify-content:center;">' +
            '<i class="fas fa-bell" style="font-size:34px;color:#c084fc;animation:ctl-ring .35s ease infinite alternate;"></i>' +
          '</div>' +
        '</div>' +
        '<div style="font-size:22px;font-weight:900;color:#fff;margin-bottom:8px;">It\'s Your Turn!</div>' +
        '<div style="font-size:14px;color:rgba(255,255,255,.7);line-height:1.6;margin-bottom:10px;">The <strong style="color:#c084fc;">' + esc(ctrlLabel || 'controller') + '</strong> is now available.</div>' +
        '<div id="hp-ctl-qa-countdown" style="display:inline-flex;align-items:center;justify-content:center;min-width:120px;padding:6px 14px;border-radius:10px;background:rgba(248,81,73,.12);border:1px solid rgba(248,81,73,.35);color:#fda4af;font-size:15px;font-weight:900;font-family:monospace;margin-bottom:10px;">03:00</div>' +
        '<div style="font-size:11px;color:rgba(255,255,255,.4);margin-bottom:28px;">Acknowledge before timer ends or your queue slot will be forfeited.</div>' +
        '<button id="hp-ctl-qa-ack-btn" style="display:inline-flex;align-items:center;gap:10px;padding:14px 32px;border-radius:12px;background:linear-gradient(135deg,rgba(162,93,220,.35),rgba(109,40,217,.25));border:1.5px solid rgba(162,93,220,.55);color:#c084fc;font-size:14px;font-weight:800;cursor:pointer;">' +
          '<i class="fas fa-check-circle" style="font-size:16px;"></i> I\'m Ready — Upload Backup' +
        '</button>' +
      '</div>';

    document.body.appendChild(overlay);

    var cdEl  = document.getElementById('hp-ctl-qa-countdown');
    var expMs = Number(notifyExpiresAt || 0);
    if (!expMs || expMs <= Date.now()) {
      expMs = Date.now() + (3 * 60 * 1000);
      /* Stamp the queue entry */
      var rq = getQueue(ctrlId);
      var me = _getCurrentUser();
      if (rq.length && rq[0] && _sameUser(rq[0].user, me)) {
        rq[0].notifiedAt = Date.now();
        rq[0].notifyExpiresAt = expMs;
        setQueue(ctrlId, rq);
      }
    }
    var cdTimer = setInterval(function () {
      var rem = expMs - Date.now();
      if (rem <= 0) {
        clearInterval(cdTimer);
        _stopQueueSound();
        if (overlay && overlay.parentElement) overlay.remove();
        /* Auto-void this user's queue turn */
        var q  = getQueue(ctrlId);
        var me = _getCurrentUser();
        if (q.length && q[0] && _sameUser(q[0].user, me)) {
          var lockKey = ctrlId + '|' + (q[0].user || '');
          delete _notifyLocks[lockKey];
          q.shift();
          setQueue(ctrlId, q);
          if (q.length) _ctlNotifyQueue(ctrlId);
        }
        alert('Time is up (3:00). Your queue turn was forfeited. Please queue again if needed.');
        return;
      }
      if (cdEl) cdEl.textContent = fmtMs(rem);
    }, 1000);

    document.getElementById('hp-ctl-qa-ack-btn').addEventListener('click', function () {
      clearInterval(cdTimer);
      _stopQueueSound();
      overlay.remove();
      window._ctlOpenBackupUpload && window._ctlOpenBackupUpload(ctrlId);
    });
  }

  /* ── Backup upload modal (after queue turn ack) ───────────────────────────  */
  window._ctlOpenBackupUpload = function (itemId) {
    var items   = getItems();
    var ctrl    = items.find(function (it) { return it.id === itemId; });
    if (!ctrl) return;
    var queue   = getQueue(itemId);
    var me      = _getCurrentUser();
    var qEntry  = queue.find(function (q) { return _sameUser(q && q.user, me); }) || {};

    var existing = document.getElementById('hp-ctl-backup-upload-modal');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id  = 'hp-ctl-backup-upload-modal';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(1,4,9,.85);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML =
      '<div style="background:#0d1117;border:1px solid rgba(34,197,94,.25);border-radius:18px;width:min(500px,95vw);max-height:90vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.8);">' +
        '<div style="padding:20px 22px 16px;background:linear-gradient(135deg,rgba(34,197,94,.07),transparent);border-bottom:1px solid rgba(255,255,255,.07);display:flex;align-items:center;justify-content:space-between;">' +
          '<div style="display:flex;align-items:center;gap:12px;">' +
            '<div style="width:36px;height:36px;border-radius:10px;background:rgba(34,197,94,.15);border:1px solid rgba(34,197,94,.3);display:flex;align-items:center;justify-content:center;">' +
              '<i class="fas fa-cloud-upload-alt" style="color:#4ade80;font-size:15px;"></i>' +
            '</div>' +
            '<div><div style="font-size:14px;font-weight:900;color:#e2e8f0;">Upload Backup File</div>' +
              '<div style="font-size:10px;color:#6b7280;margin-top:2px;">' + esc(labelFor(ctrl.type)) + ' — Your session starts after upload</div>' +
            '</div>' +
          '</div>' +
          '<button onclick="document.getElementById(\'hp-ctl-backup-upload-modal\').remove()" style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:#6b7280;border-radius:7px;width:28px;height:28px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:13px;">✕</button>' +
        '</div>' +
        '<div style="padding:20px 22px;display:flex;flex-direction:column;gap:14px;overflow-y:auto;">' +
          '<div style="padding:12px 14px;background:rgba(34,197,94,.06);border:1px solid rgba(34,197,94,.18);border-radius:10px;font-size:11px;color:rgba(255,255,255,.7);line-height:1.6;">' +
            '<strong style="color:#4ade80;">Your queued task:</strong> ' + esc(qEntry.task || '—') +
            '<br><strong style="color:#4ade80;">Duration:</strong> ' + esc(qEntry.duration || '—') +
          '</div>' +
          '<div style="padding:12px;background:rgba(88,166,255,.06);border:1px dashed rgba(88,166,255,.2);border-radius:10px;text-align:center;cursor:pointer;" onclick="window._ctlOpenBackupFolder()">' +
            '<i class="fas fa-cloud-upload-alt" style="font-size:20px;color:#58a6ff;display:block;margin-bottom:6px;"></i>' +
            '<div style="font-size:11px;font-weight:700;color:#94a3b8;">Click to Upload to SharePoint</div>' +
            '<div style="font-size:9px;color:#4b5563;margin-top:3px;">Upload → copy link → paste below</div>' +
          '</div>' +
          '<div style="position:relative;">' +
            '<i class="fas fa-link" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:#6b7280;font-size:12px;"></i>' +
            '<input id="hp-ctl-bu-backup-link" style="width:100%;padding:10px 12px 10px 34px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:9px;color:#e2e8f0;font-size:12px;box-sizing:border-box;" type="text" placeholder="Paste SharePoint backup link here…" autocomplete="off"/>' +
          '</div>' +
          '<div id="hp-ctl-bu-error" style="display:none;padding:8px 12px;background:rgba(248,81,73,.08);border:1px solid rgba(248,81,73,.2);border-radius:8px;font-size:11px;color:#f85149;"></div>' +
          '<button id="hp-ctl-bu-start-btn" onclick="window._ctlStartFromQueue(\'' + esc(itemId) + '\')" style="padding:13px 20px;border-radius:10px;background:linear-gradient(135deg,rgba(34,197,94,.22),rgba(16,185,129,.14));border:1.5px solid rgba(34,197,94,.45);color:#4ade80;font-size:13px;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;">' +
            '<i class="fas fa-play-circle" style="font-size:14px;"></i> Start My Session' +
          '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
  };

  /* ── Start session from queue ──────────────────────────────────────────── */
  window._ctlStartFromQueue = function (itemId) {
    var backupEl = document.getElementById('hp-ctl-bu-backup-link');
    var errorEl  = document.getElementById('hp-ctl-bu-error');
    var backup   = (backupEl && backupEl.value.trim()) || '';
    if (!backup) {
      if (errorEl) { errorEl.textContent = 'Please upload your backup file and paste the link first.'; errorEl.style.display = 'block'; }
      return;
    }
    if (errorEl) errorEl.style.display = 'none';

    var queue  = getQueue(itemId);
    var me     = _getCurrentUser();
    var qEntry = queue.find(function (q) { return _sameUser(q && q.user, me); }) || {};

    /* BUG 1 FIX: check controller is still free before booking */
    var currentBooking = getBooking(itemId);
    if (currentBooking && currentBooking.endMs > Date.now()) {
      if (errorEl) { errorEl.textContent = 'Controller was just booked by ' + esc(currentBooking.user) + '. Please wait for their session to end.'; errorEl.style.display = 'block'; }
      /* Re-fetch to sync */
      _loadSharedStateFromServer(function () { if (window._ctlRenderAll) window._ctlRenderAll(); });
      return;
    }

    /* Remove user from queue */
    var lockKey = itemId + '|' + me;
    delete _notifyLocks[lockKey];
    var newQueue = queue.filter(function (q) { return !_sameUser(q && q.user, me); });
    setQueue(itemId, newQueue);

    var durMs   = parseDurMs(qEntry.duration || '30 minutes');
    var booking = {
      user: me, avatarUrl: _getAvatarUrl(),
      task: qEntry.task || 'Queued session',
      duration: qEntry.duration || '30 minutes',
      backupFile: backup,
      startMs: Date.now(), endMs: Date.now() + durMs,
    };

    /* BUG 1 FIX: optimistic lock — if server rejects with 409, show error */
    var startBtn = document.getElementById('hp-ctl-bu-start-btn');
    if (startBtn) { startBtn.disabled = true; startBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Starting…'; }

    setBooking(itemId, booking, function () {
      /* success */
      var items  = getItems();
      var ctrl   = items.find(function (it) { return it.id === itemId; }) || {};
      var payload = { timestamp: phtNow(), user: me, controller: labelFor(ctrl.type) + ' — ' + (ctrl.ip || '—'), task: booking.task, duration: booking.duration, backupFile: backup, note: 'Started from queue' };
      savePendingLog(payload);
      if (SHEETS_ENDPOINT) fetch(SHEETS_ENDPOINT, { method: 'POST', mode: 'no-cors', body: buildFormPayload(payload) }).catch(function () {});
      _updatePendingBtn();
      var modal = document.getElementById('hp-ctl-backup-upload-modal');
      if (modal) modal.remove();
      if (window._ctlRenderAll) window._ctlRenderAll();
    }, function (existingBooking) {
      /* BUG 1 FIX: conflict — another user booked between our checks */
      if (startBtn) { startBtn.disabled = false; startBtn.innerHTML = '<i class="fas fa-play-circle" style="font-size:14px;"></i> Start My Session'; }
      if (errorEl) {
        var who = existingBooking ? existingBooking.user : 'someone else';
        errorEl.textContent = 'Controller was just booked by ' + esc(who) + '. Please wait for their session to end.';
        errorEl.style.display = 'block';
      }
    });
  };

  /* ── Open booking modal ────────────────────────────────────────────────── */
  window._ctlOpenBooking = function (itemId) {
    var items = getItems();
    var ctrl  = items.find(function (it) { return it.id === itemId; });
    if (!ctrl) return;
    _bookingCtlId   = itemId;
    _bookingCtlData = ctrl;

    /* BUG 7 FIX: fresh server fetch before opening modal */
    var tok = _ctlGetToken();
    if (tok) {
      fetch('/api/studio/ctl_lab_state', { headers: { 'Authorization': 'Bearer ' + tok, 'Cache-Control': 'no-store' } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { if (d && d.ok) { _applySharedState(d); _lastServerWrite = Date.now(); } })
        .catch(function () {})
        .finally(function () { _renderBookingModal(itemId, ctrl); });
    } else {
      _renderBookingModal(itemId, ctrl);
    }
  };

  function _renderBookingModal(itemId, ctrl) {
    var booking  = getBooking(itemId);
    var isActive = !!(booking && booking.endMs > Date.now());

    var imgEl  = document.getElementById('hp-ctl-bk-ctrl-img');
    var nameEl = document.getElementById('hp-ctl-bk-ctrl-name');
    var ipEl   = document.getElementById('hp-ctl-bk-ctrl-ip');
    if (imgEl)  imgEl.src          = imageFor(ctrl.type);
    if (nameEl) nameEl.textContent = labelFor(ctrl.type);
    if (ipEl)   ipEl.textContent   = ctrl.ip || '—';

    var userDisp = document.getElementById('hp-ctl-bk-user-display');
    var dateDisp = document.getElementById('hp-ctl-bk-date-display');
    if (userDisp) userDisp.textContent = _getCurrentUser();
    if (dateDisp) dateDisp.textContent = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

    ['hp-ctl-bk-task', 'hp-ctl-bk-duration', 'hp-ctl-bk-backup', 'hp-ctl-bk-custom-time'].forEach(function (id) {
      var el = document.getElementById(id); if (el) { el.value = ''; el.classList.remove('invalid'); }
    });
    document.querySelectorAll('.hp-ctl-dur-chip').forEach(function (c) { c.classList.remove('selected', 'invalid-chip'); });
    var customWrap = document.getElementById('hp-ctl-bk-custom-time-wrap'); if (customWrap) customWrap.style.display = 'none';

    var inUseNotice = document.getElementById('hp-ctl-bk-inuse-notice');
    var inUserName  = document.getElementById('hp-ctl-bk-inuse-name');
    var inUserEnd   = document.getElementById('hp-ctl-bk-inuse-end');
    if (inUseNotice) inUseNotice.style.display = isActive ? 'flex' : 'none';
    if (isActive && booking) {
      if (inUserName) inUserName.textContent = booking.user;
      if (inUserEnd)  inUserEnd.textContent  = 'Ends in approx. ' + fmtMs(booking.endMs - Date.now());
    }

    var successEl = document.getElementById('hp-ctl-bk-success');
    var bodyEl    = document.getElementById('hp-ctl-booking-body');
    if (successEl) successEl.classList.remove('show');
    if (bodyEl)    Array.from(bodyEl.children).forEach(function (c) { if (!c.classList.contains('hp-ctl-bk-success')) c.style.display = ''; });

    var sheetSt = document.getElementById('hp-ctl-bk-sheet-status');
    if (sheetSt) { sheetSt.style.display = 'none'; sheetSt.textContent = ''; }

    var regBtn   = document.getElementById('hp-ctl-bk-register-btn');
    var regIcon  = document.getElementById('hp-ctl-bk-register-icon');
    var regLabel = document.getElementById('hp-ctl-bk-register-label');
    var spinner  = document.getElementById('hp-ctl-bk-spinner');
    if (regBtn)   regBtn.disabled = false;
    if (regIcon)  regIcon.style.display = '';
    if (regLabel) regLabel.textContent = 'Book this Controller';
    if (spinner)  spinner.style.display = 'none';

    _updatePendingBtn();
    _autoRetryPendingLogs();
    var modal = document.getElementById('hp-ctl-booking-modal');
    if (modal) { modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false'); }
    setTimeout(function () { var t = document.getElementById('hp-ctl-bk-task'); if (t) t.focus(); }, 80);
    _pingSheet(null);
  }

  window._ctlCloseBooking = function () {
    var modal = document.getElementById('hp-ctl-booking-modal');
    if (modal) { modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true'); }
    _bookingCtlId = null; _bookingCtlData = null;
    document.querySelectorAll('.hp-ctl-bk-step').forEach(function (s) { s.classList.remove('done'); });
    document.querySelectorAll('.hp-ctl-dur-chip').forEach(function (c) { c.classList.remove('selected', 'invalid-chip'); });
  };

  window._ctlOpenBackupFolder = function () { window.open(BACKUP_FOLDER_URL, '_blank', 'noopener,noreferrer'); };

  /* ── Submit booking ────────────────────────────────────────────────────── */
  window._ctlSubmitBooking = function () {
    if (!_bookingCtlData) return;
    var taskEl   = document.getElementById('hp-ctl-bk-task');
    var durEl    = document.getElementById('hp-ctl-bk-duration');
    var backupEl = document.getElementById('hp-ctl-bk-backup');
    var customEl = document.getElementById('hp-ctl-bk-custom-time');

    [taskEl, durEl, backupEl].forEach(function (el) { if (el) el.classList.remove('invalid'); });
    document.querySelectorAll('.hp-ctl-dur-chip').forEach(function (c) { c.classList.remove('invalid-chip'); });

    var task   = (taskEl   && taskEl.value.trim())   || '';
    var durVal = (durEl    && durEl.value.trim())    || '';
    var backup = (backupEl && backupEl.value.trim()) || '';
    var valid  = true;

    if (!task)   { if (taskEl)   taskEl.classList.add('invalid');   valid = false; }
    if (!durVal) { if (durEl)    durEl.classList.add('invalid');    document.querySelectorAll('.hp-ctl-dur-chip').forEach(function (c) { c.classList.add('invalid-chip'); }); valid = false; }
    if (!backup) { if (backupEl) backupEl.classList.add('invalid'); valid = false; }

    var duration = durVal;
    if (durVal === 'set_time') {
      var custom = (customEl && customEl.value.trim()) || '';
      if (!custom) { if (customEl) customEl.classList.add('invalid'); valid = false; }
      else duration = custom;
    }
    if (!valid) return;

    /* BUG 1 FIX: check controller is still free */
    var existingBooking = getBooking(_bookingCtlId);
    if (existingBooking && existingBooking.endMs > Date.now()) {
      var inUserName = document.getElementById('hp-ctl-bk-inuse-name');
      var inUserEnd  = document.getElementById('hp-ctl-bk-inuse-end');
      var notice     = document.getElementById('hp-ctl-bk-inuse-notice');
      if (inUserName) inUserName.textContent = existingBooking.user;
      if (inUserEnd)  inUserEnd.textContent  = 'Ends in approx. ' + fmtMs(existingBooking.endMs - Date.now());
      if (notice)     notice.style.display   = 'flex';
      return;
    }

    var regBtn   = document.getElementById('hp-ctl-bk-register-btn');
    var regIcon  = document.getElementById('hp-ctl-bk-register-icon');
    var regLabel = document.getElementById('hp-ctl-bk-register-label');
    var spinner  = document.getElementById('hp-ctl-bk-spinner');
    if (regBtn)   regBtn.disabled = true;
    if (regIcon)  regIcon.style.display = 'none';
    if (regLabel) regLabel.textContent = 'Booking…';
    if (spinner)  spinner.style.display = 'inline-block';

    var me     = _getCurrentUser();
    var durMs  = parseDurMs(duration);
    var booking = { user: me, avatarUrl: _getAvatarUrl(), task: task, duration: duration, backupFile: backup, startMs: Date.now(), endMs: Date.now() + durMs };

    var payload = { timestamp: phtNow(), user: me, controller: labelFor(_bookingCtlData.type) + ' — ' + (_bookingCtlData.ip || '—'), task: task, duration: duration, backupFile: backup, note: 'Direct booking' };
    savePendingLog(payload);

    setBooking(_bookingCtlId, booking, function () {
      /* success */
      function _onSuccess(wroteToSheet) {
        var bodyEl    = document.getElementById('hp-ctl-booking-body');
        var successEl = document.getElementById('hp-ctl-bk-success');
        var msgEl     = document.getElementById('hp-ctl-bk-success-msg');
        var sheetSt   = document.getElementById('hp-ctl-bk-sheet-status');
        if (bodyEl)    Array.from(bodyEl.children).forEach(function (c) { if (!c.classList.contains('hp-ctl-bk-success')) c.style.display = 'none'; });
        if (msgEl)     msgEl.textContent = 'Booked by ' + me + ' — ' + labelFor(_bookingCtlData.type) + ' — Duration: ' + duration;
        if (sheetSt) {
          sheetSt.style.display = 'block';
          if (wroteToSheet) { sheetSt.style.background = 'rgba(16,185,129,.1)'; sheetSt.style.border = '1px solid rgba(16,185,129,.25)'; sheetSt.style.color = '#10b981'; sheetSt.textContent = 'Written to sheet'; removePendingLog(payload.timestamp, me); }
          else               { sheetSt.style.background = 'rgba(245,158,11,.08)'; sheetSt.style.border = '1px solid rgba(245,158,11,.2)'; sheetSt.style.color = '#f59e0b'; sheetSt.textContent = 'Saved locally — sheet unreachable.'; }
          _updatePendingBtn();
        }
        if (successEl) successEl.classList.add('show');
        setTimeout(function () { window._ctlCloseBooking(); }, 2400);
      }
      if (SHEETS_ENDPOINT) {
        fetch(SHEETS_ENDPOINT, { method: 'POST', mode: 'no-cors', body: buildFormPayload(payload) }).then(function () { _onSuccess(true); }).catch(function () { _onSuccess(false); });
      } else {
        setTimeout(function () { _onSuccess(false); }, 500);
      }
    }, function (serverBooking) {
      /* BUG 1 FIX: conflict — re-enable button and show in-use notice */
      if (regBtn)   { regBtn.disabled = false; }
      if (regIcon)  regIcon.style.display = '';
      if (regLabel) regLabel.textContent = 'Book this Controller';
      if (spinner)  spinner.style.display = 'none';
      var notice     = document.getElementById('hp-ctl-bk-inuse-notice');
      var inUserName = document.getElementById('hp-ctl-bk-inuse-name');
      var inUserEnd  = document.getElementById('hp-ctl-bk-inuse-end');
      if (serverBooking) {
        if (inUserName) inUserName.textContent = serverBooking.user;
        if (inUserEnd)  inUserEnd.textContent  = 'Ends in approx. ' + fmtMs(serverBooking.endMs - Date.now());
      }
      if (notice) notice.style.display = 'flex';
    });
  };

  /* ── Open queue modal ────────────────────────────────────────────────────  */
  window._ctlOpenQueue = function (itemId) {
    var items   = getItems();
    var ctrl    = items.find(function (it) { return it.id === itemId; });
    if (!ctrl) return;
    _queueCtlId = itemId;
    var booking = getBooking(itemId);
    var queue   = getQueue(itemId);
    var me      = _getCurrentUser();

    var qNameEl  = document.getElementById('hp-ctl-q-ctrl-name');
    var qUserEl  = document.getElementById('hp-ctl-q-current-user');
    var qEndEl   = document.getElementById('hp-ctl-q-end-time');
    var qListEl  = document.getElementById('hp-ctl-q-list');
    var qImgEl   = document.getElementById('hp-ctl-q-ctrl-img');

    if (qNameEl) qNameEl.textContent = labelFor(ctrl.type);
    if (qImgEl)  qImgEl.src          = imageFor(ctrl.type);
    if (booking) {
      if (qUserEl) qUserEl.textContent = booking.user;
      if (qEndEl)  qEndEl.textContent  = '~' + fmtMs(booking.endMs - Date.now()) + ' remaining';
    } else {
      if (qUserEl) qUserEl.textContent = '—';
      if (qEndEl)  qEndEl.textContent  = 'No active booking';
    }

    if (qListEl) {
      if (!queue.length) {
        qListEl.innerHTML = '<div style="padding:12px 0;text-align:center;color:rgba(255,255,255,.3);font-size:11px;">No one in queue yet — be first!</div>';
      } else {
        qListEl.innerHTML = queue.map(function (q, i) {
          var isMe = _sameUser(q && q.user, me);
          return '<div class="hp-ctl-q-item' + (isMe ? ' is-me' : '') + '">' +
            '<div class="hp-ctl-q-pos">' + (i + 1) + '</div>' +
            '<div class="hp-ctl-q-meta">' +
              '<div class="hp-ctl-q-name">' + (isMe ? 'You (' + esc(q.user) + ')' : esc(q.user)) + '</div>' +
              '<div class="hp-ctl-q-task">' + esc(q.task || '') + (q.duration ? ' · ' + esc(q.duration) : '') + '</div>' +
            '</div>' +
            (q.urgent ? '<span class="hp-ctl-q-urgent-badge">URGENT</span>' : '') +
            (isMe ? '<button class="hp-ctl-q-leave-btn" onclick="window._ctlLeaveQueue(\'' + esc(itemId) + '\')">Leave</button>' : '') +
            '</div>';
        }).join('');
      }
    }

    var alreadyQueued = queue.some(function (q) { return _sameUser(q && q.user, me); });
    var joinSection   = document.getElementById('hp-ctl-q-join-section');
    var alreadyMsg    = document.getElementById('hp-ctl-q-already-msg');
    if (joinSection) joinSection.style.display = alreadyQueued ? 'none' : 'block';
    if (alreadyMsg)  { alreadyMsg.style.display = alreadyQueued ? 'block' : 'none'; alreadyMsg.textContent = 'You are in queue — waiting for your turn.'; }

    if (window._ctlQueueTimer) clearInterval(window._ctlQueueTimer);
    if (booking && booking.endMs > Date.now()) {
      window._ctlQueueTimer = setInterval(function () {
        var rem = booking.endMs - Date.now();
        if (rem <= 0) { clearInterval(window._ctlQueueTimer); }
        var el = document.getElementById('hp-ctl-q-end-time');
        if (el) el.textContent = '~' + fmtMs(Math.max(0, rem)) + ' remaining';
      }, 1000);
    }

    var modal = document.getElementById('hp-ctl-queue-modal');
    if (modal) { modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false'); }
  };

  window._ctlCloseQueue = function () {
    var modal = document.getElementById('hp-ctl-queue-modal');
    if (modal) { modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true'); }
    if (window._ctlQueueTimer) { clearInterval(window._ctlQueueTimer); window._ctlQueueTimer = null; }
    _queueCtlId = null;
  };

  /* ── Join queue ────────────────────────────────────────────────────────── */
  window._ctlJoinQueue = function () {
    if (!_queueCtlId) return;
    var me      = _getCurrentUser();
    var taskEl  = document.getElementById('hp-ctl-q-task-input');
    var durEl   = document.getElementById('hp-ctl-q-duration-select');
    var urgEl   = document.getElementById('hp-ctl-q-urgent');

    var task     = (taskEl && taskEl.value.trim()) || '';
    var duration = (durEl  && durEl.value.trim())  || '30 minutes';
    var isUrgent = !!(urgEl && urgEl.checked);

    if (!task) {
      if (taskEl) { taskEl.style.borderColor = 'rgba(248,81,73,.6)'; taskEl.placeholder = 'Please describe your task first…'; setTimeout(function () { if (taskEl) taskEl.style.borderColor = ''; }, 2000); }
      return;
    }

    var queue     = getQueue(_queueCtlId);
    /* BUG 4 FIX: strict duplicate check before joining */
    var alreadyIn = queue.some(function (q) { return _sameUser(q && q.user, me); });
    if (alreadyIn) { window._ctlCloseQueue(); return; }

    queue.push({ user: me, avatarUrl: _getAvatarUrl(), task: task, duration: duration, urgent: isUrgent, joinedAt: Date.now() });
    setQueue(_queueCtlId, queue);

    if (isUrgent) window._ctlShowUrgentNotice(_queueCtlId, me);

    var joinSection = document.getElementById('hp-ctl-q-join-section');
    var alreadyMsg  = document.getElementById('hp-ctl-q-already-msg');
    if (joinSection) joinSection.style.display = 'none';
    if (alreadyMsg)  { alreadyMsg.style.display = 'block'; alreadyMsg.textContent = 'You are in queue at position ' + queue.length + '. We\'ll alert you when it\'s your turn.'; }

    /* BUG 7 FIX: If controller is already free, notify immediately */
    var booking = getBooking(_queueCtlId);
    if (!booking || booking.endMs <= Date.now()) {
      setTimeout(function () { _ctlNotifyQueue(_queueCtlId); }, 200);
    }

    setTimeout(function () { window._ctlCloseQueue(); }, 1800);
  };

  window._ctlLeaveQueue = function (itemId) {
    var me = _getCurrentUser();
    var lockKey = itemId + '|' + me;
    delete _notifyLocks[lockKey];
    setQueue(itemId, getQueue(itemId).filter(function (q) { return !_sameUser(q && q.user, me); }));
    window._ctlCloseQueue();
  };

  /* ── Alarm banner (for observers) ───────────────────────────────────────── */
  function _showAlarmBanner(msg, itemId) {
    var existing = document.getElementById('hp-ctl-alarm-banner');
    if (existing) existing.remove();
    var banner = document.createElement('div');
    banner.id = 'hp-ctl-alarm-banner'; banner.className = 'hp-ctl-alarm-banner';
    banner.innerHTML =
      '<i class="fas fa-bell" style="font-size:18px;"></i>' +
      '<div><div style="font-size:13px;font-weight:800;color:#fff;">Controller Available!</div>' +
        '<div style="font-size:11px;opacity:.8;">' + esc(msg) + '</div></div>' +
      '<button class="hp-ctl-alarm-dismiss" onclick="this.parentElement.remove()"><i class="fas fa-times"></i></button>';
    document.body.appendChild(banner);
    setTimeout(function () { if (banner.parentElement) banner.remove(); }, 10000);
  }

  /* ── Urgent notice ───────────────────────────────────────────────────────── */
  window._ctlShowUrgentNotice = function (itemId, requester) {
    var booking = getBooking(itemId); if (!booking) return;
    var items   = getItems();
    var ctrl    = items.find(function (it) { return it.id === itemId; });
    if (!_sameUser(booking.user, _getCurrentUser())) return;
    var existing = document.getElementById('hp-ctl-urgent-banner'); if (existing) existing.remove();
    var banner   = document.createElement('div');
    banner.id    = 'hp-ctl-urgent-banner'; banner.className = 'hp-ctl-urgent-banner';
    banner.innerHTML =
      '<div style="display:flex;align-items:center;gap:12px;flex:1;">' +
        '<i class="fas fa-exclamation-triangle" style="font-size:20px;color:#f59e0b;flex-shrink:0;"></i>' +
        '<div><div style="font-size:13px;font-weight:800;color:#fff;">Urgent Request</div>' +
          '<div style="font-size:11px;color:rgba(255,255,255,.75);margin-top:2px;">' + esc(requester) + ' has an urgent task and needs ' + esc(ctrl ? labelFor(ctrl.type) : 'this controller') + '.</div>' +
        '</div></div>' +
      '<button class="hp-ctl-alarm-dismiss" onclick="document.getElementById(\'hp-ctl-urgent-banner\').remove()"><i class="fas fa-times"></i> Dismiss</button>';
    document.body.appendChild(banner);
    setTimeout(function () { if (banner.parentElement) banner.remove(); }, 30000);
  };

  /* ── Override ────────────────────────────────────────────────────────────── */
  window._ctlOverride = function (itemId) {
    var items   = getItems();
    var ctrl    = items.find(function (it) { return it.id === itemId; });
    var booking = getBooking(itemId);
    if (!ctrl || !booking) return;
    var modal       = document.getElementById('hp-ctl-override-modal');
    var ctrlNameEl  = document.getElementById('hp-ctl-ov-ctrl-name');
    var ownerEl     = document.getElementById('hp-ctl-ov-owner');
    var confirmBtn  = document.getElementById('hp-ctl-ov-confirm-btn');
    if (ctrlNameEl) ctrlNameEl.textContent = labelFor(ctrl.type);
    if (ownerEl)    ownerEl.textContent    = booking.user;
    if (confirmBtn) {
      confirmBtn.onclick = function () {
        var reasonEl = document.getElementById('hp-ctl-ov-reason');
        var reason   = (reasonEl && reasonEl.value.trim()) || 'Urgent task';
        window._ctlExecuteOverride(itemId, reason);
      };
    }
    if (modal) { modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false'); }
  };

  window._ctlCloseOverride = function () {
    var modal = document.getElementById('hp-ctl-override-modal');
    if (modal) { modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true'); }
  };

  window._ctlExecuteOverride = function (itemId, reason) {
    var items    = getItems();
    var ctrl     = items.find(function (it) { return it.id === itemId; });
    var booking  = getBooking(itemId);
    if (!ctrl || !booking) return;
    var me              = _getCurrentUser();
    var overriddenUser  = booking.user;

    /* BUG 9 FIX: clear notify lock for the overridden user */
    var lockKey = itemId + '|' + overriddenUser;
    delete _notifyLocks[lockKey];

    /* BUG 9 FIX: also remove overridden user from queue */
    var queue = getQueue(itemId).filter(function (q) { return !_sameUser(q && q.user, overriddenUser); });
    setQueue(itemId, queue);

    var payload = { timestamp: phtNow(), user: me, controller: labelFor(ctrl.type) + ' — ' + (ctrl.ip || '—'), task: '[OVERRIDE] ' + reason, duration: 'Session overridden', backupFile: 'N/A', note: 'Override of ' + overriddenUser + ' by ' + me };
    savePendingLog(payload);
    if (SHEETS_ENDPOINT) fetch(SHEETS_ENDPOINT, { method: 'POST', mode: 'no-cors', body: buildFormPayload(payload) }).catch(function () {});

    setBooking(itemId, null, function () {
      window._ctlCloseOverride();
      _showAlarmBanner('Override executed. ' + labelFor(ctrl.type) + ' is now available.', itemId);
      setTimeout(function () { if (window._ctlOpenBooking) window._ctlOpenBooking(itemId); }, 400);
    });
  };

  /* ── Sheet health ─────────────────────────────────────────────────────────  */
  function _pingSheet(cb) {
    var dotIcon  = document.getElementById('hp-ctl-sheet-dot-icon');
    var dotLabel = document.getElementById('hp-ctl-sheet-dot-label');
    function setStatus(ok, label) {
      _sheetReachable = ok;
      if (dotIcon)  { dotIcon.className = 'hp-ctl-status-dot ' + (ok ? 'connected' : 'error'); dotIcon.style.background = ok ? '#10b981' : '#ef4444'; }
      if (dotLabel) { dotLabel.style.color = ok ? '#10b981' : '#ef4444'; dotLabel.textContent = label; }
      if (cb) cb(ok);
    }
    if (!SHEETS_ENDPOINT) { setStatus(false, 'No sheet configured'); return; }
    if (dotLabel) { dotLabel.style.color = '#6b7280'; dotLabel.textContent = 'Checking…'; }
    fetch(SHEETS_ENDPOINT, { method: 'GET', mode: 'cors', cache: 'no-store' })
      .then(function (r) { (r.ok || r.status === 302) ? setStatus(true, 'Sheet connected') : setStatus(false, 'Sheet error ' + r.status); })
      .catch(function () { setStatus(false, 'Sheet unreachable'); });
  }

  function _updatePendingBtn() {
    var btn = document.getElementById('hp-ctl-bk-pending-btn');
    var cnt = document.getElementById('hp-ctl-pending-count');
    var n   = getPendingLogs().length;
    if (btn) btn.style.display = n > 0 ? 'flex' : 'none';
    if (cnt) cnt.textContent   = String(n);
  }

  function _autoRetryPendingLogs() {
    if (_pendingRetryBusy) return;
    var logs = getPendingLogs();
    if (!logs.length || !SHEETS_ENDPOINT) return;
    _pendingRetryBusy = true;
    var done = 0;
    logs.forEach(function (payload) {
      fetch(SHEETS_ENDPOINT, { method: 'POST', mode: 'no-cors', body: buildFormPayload(payload) })
        .then(function () { removePendingLog(payload.timestamp, payload.user); })
        .catch(function () {})
        .finally(function () {
          done++;
          if (done === logs.length) {
            _pendingRetryBusy = false;
            _updatePendingBtn();
            var pm = document.getElementById('hp-ctl-pending-modal');
            if (pm && pm.style.display !== 'none' && window._ctlShowPendingLogs) window._ctlShowPendingLogs();
          }
        });
    });
  }

  /* ── Pending logs modal ─────────────────────────────────────────────────── */
  window._ctlShowPendingLogs = function () {
    var modal   = document.getElementById('hp-ctl-pending-modal');
    var list    = document.getElementById('hp-ctl-pending-list');
    if (!modal || !list) return;
    var logs = getPendingLogs();
    list.innerHTML = !logs.length
      ? '<div style="text-align:center;padding:30px;color:#6b7280;font-size:12px;">No pending logs</div>'
      : logs.map(function (log) {
          return '<div style="background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:10px 14px;margin-bottom:8px;font-size:11px;">' +
            '<div style="display:flex;justify-content:space-between;margin-bottom:6px;"><span style="font-weight:700;color:#f1f5f9;">' + esc(log.user) + '</span><span style="color:#6b7280;font-family:monospace;font-size:9px;">' + esc(log.timestamp) + '</span></div>' +
            '<div style="color:#94a3b8;line-height:1.6;">' + esc(log.controller) + ' | ' + esc(log.task) + ' | ' + esc(log.duration) + '</div>' +
            '</div>';
        }).join('');
    var statusEl = document.getElementById('hp-ctl-replay-status');
    if (statusEl) statusEl.textContent = logs.length + ' pending log' + (logs.length !== 1 ? 's' : '');
    modal.style.display = 'flex'; modal.setAttribute('aria-hidden', 'false');
  };
  window._ctlClosePendingLogs = function () {
    var modal = document.getElementById('hp-ctl-pending-modal');
    if (modal) { modal.style.display = 'none'; modal.setAttribute('aria-hidden', 'true'); }
  };
  window._ctlClearPendingLogs = function () {
    if (!confirm('Clear all ' + getPendingLogs().length + ' pending logs?')) return;
    setPendingLogs([]); _updatePendingBtn(); window._ctlShowPendingLogs();
  };
  window._ctlReplayPendingLogs = function () {
    var logs = getPendingLogs();
    if (!logs.length) return;
    if (!SHEETS_ENDPOINT) { alert('SHEETS_ENDPOINT not configured.'); return; }
    var replayBtn    = document.getElementById('hp-ctl-replay-btn');
    var replayStatus = document.getElementById('hp-ctl-replay-status');
    if (replayBtn) { replayBtn.disabled = true; replayBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending…'; }
    var success = 0, fail = 0, remaining = logs.length;
    logs.forEach(function (payload) {
      fetch(SHEETS_ENDPOINT, { method: 'POST', mode: 'no-cors', body: buildFormPayload(payload) })
        .then(function () { success++; removePendingLog(payload.timestamp, payload.user); })
        .catch(function () { fail++; })
        .finally(function () {
          remaining--;
          if (remaining === 0) {
            _updatePendingBtn();
            if (replayBtn) { replayBtn.disabled = false; replayBtn.innerHTML = '<i class="fas fa-redo"></i> Retry Send'; }
            if (replayStatus) { replayStatus.textContent = success + ' sent' + (fail ? ', ' + fail + ' failed' : ''); replayStatus.style.color = fail ? '#ef4444' : '#10b981'; }
            setTimeout(function () { window._ctlShowPendingLogs(); }, 400);
          }
        });
    });
  };

  /* Expose _maybeTimeUpAlert so config IIFE stub can delegate to us */
  window._ctlMaybeTimeUpAlert = _maybeTimeUpAlert;

  /* ── Expose shared state accessors for the CTL IIFE ──────────────────────  */
  window._ctlSharedStateGetBooking = getBooking;
  window._ctlSharedStateGetQueue   = getQueue;
  window._ctlSetSharedBooking      = setBooking;
  window._ctlSetSharedQueue        = setQueue;

  /* BUG 6 FIX: expose syncTimers for renderMainList */
  window._ctlSyncTimers = _syncTimers;

  /* ── Keyboard + click wiring ──────────────────────────────────────────────  */
  document.addEventListener('click', function (e) {
    var chip = e.target.closest('.hp-ctl-dur-chip'); if (!chip) return;
    document.querySelectorAll('.hp-ctl-dur-chip').forEach(function (c) { c.classList.remove('selected'); });
    chip.classList.add('selected');
    var dur = chip.getAttribute('data-dur') || '';
    var sel = document.getElementById('hp-ctl-bk-duration'); if (sel) { sel.value = dur; sel.dispatchEvent(new Event('change')); }
    var s2 = document.querySelector('.hp-ctl-bk-step[data-step="2"]'); if (s2 && dur && dur !== 'set_time') s2.classList.add('done');
  });
  document.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'hp-ctl-bk-duration') {
      var wrap = document.getElementById('hp-ctl-bk-custom-time-wrap'); if (wrap) wrap.style.display = e.target.value === 'set_time' ? 'block' : 'none';
    }
  });
  document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'hp-ctl-bk-task')   { var s1 = document.querySelector('.hp-ctl-bk-step[data-step="1"]'); if (s1) s1.classList.toggle('done', e.target.value.trim().length > 2); }
    if (e.target && e.target.id === 'hp-ctl-bk-backup') { var s3 = document.querySelector('.hp-ctl-bk-step[data-step="3"]'); if (s3) s3.classList.toggle('done', e.target.value.trim().length > 5); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var m  = document.getElementById('hp-ctl-booking-modal');  if (m  && m.classList.contains('open'))     { window._ctlCloseBooking();  return; }
    var qm = document.getElementById('hp-ctl-queue-modal');    if (qm && qm.classList.contains('open'))    { window._ctlCloseQueue();    return; }
    var om = document.getElementById('hp-ctl-override-modal'); if (om && om.classList.contains('open'))    { window._ctlCloseOverride(); return; }
    var pm = document.getElementById('hp-ctl-pending-modal');  if (pm && pm.style.display !== 'none')      { window._ctlClosePendingLogs(); }
  });
  document.addEventListener('click', function (e) {
    if (e.target && e.target.id === 'hp-ctl-queue-modal')    window._ctlCloseQueue();
    if (e.target && e.target.id === 'hp-ctl-override-modal') window._ctlCloseOverride();
  });

  /* ── Boot ─────────────────────────────────────────────────────────────────  */
  _loadStateCache();
  _loadSharedStateFromServer(function () { if (window._ctlRenderAll) window._ctlRenderAll(); });

  document.addEventListener('ctl:rerender', function () {
    if (window._ctlRenderAll) window._ctlRenderAll();
  });

})();
