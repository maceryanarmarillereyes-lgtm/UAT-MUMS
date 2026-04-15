/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

/* ═══════════════════════════════════════════════════════════════════════
   YOUR CASE TODAY — Home Page Feature  v1.0
   Reads from window.__studioQbRecords (set by the fetch-patch at top of file)
   or root._qbRowSnaps after QB tab initialises.
   Filters to cases assigned to the current user that have a today-dated
   entry in Case Notes, then renders them with mine/other note bubbles.
═══════════════════════════════════════════════════════════════════════ */
(function() {
  'use strict';

  // ── helpers ──────────────────────────────────────────────────────────
  function _manilaToday() {
    return new Date().toLocaleDateString('en-US', {
      timeZone: 'Asia/Manila',
      month: 'short', day: '2-digit', year: '2-digit'
    }).toUpperCase().replace(/ /g, '-').replace(',', '');
  }

  function _phtNow() {
    return new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila',
      month: 'short', day: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: true });
  }

  function esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // Convert EST bracket timestamps to PHT (+13h offset EST→PHT)
  function _convertPHT(text) {
    if (!text || typeof window._ssConvertPHT !== 'function') return text;
    try { return window._ssConvertPHT(text); } catch(e) { return text; }
  }

  // Parse first today-dated [DATE TIME Name] bracket from notes text
  function _parseTodayEntry(notesRaw, todayStr, myNameLower) {
    if (!notesRaw || !todayStr) return null;
    // Match [MON-DD-YY H:MM AM/PM Name...] — \d{1,2} for day handles both padded and unpadded
    var regex = /\[([A-Z]{3}-\d{1,2}-\d{2})\s+(\d{1,2}:\d{2}\s*(?:AM|PM))\s+([^\]]+)\]/gi;
    var match;
    while ((match = regex.exec(notesRaw)) !== null) {
      var datePart = match[1].toUpperCase();
      // Normalise to padded form (e.g. "MAR-1-26" → "MAR-01-26") before comparing
      var datePadded = datePart.replace(/-(\d)-/, function(_, d) { return '-0' + d + '-'; });
      var todayPadded = todayStr.replace(/-(\d)-/, function(_, d) { return '-0' + d + '-'; });
      if (datePadded === todayPadded || datePart === todayStr) {
        var timePart = match[2].trim();
        var namePart = match[3].trim();
        var isMine   = namePart.toLowerCase().includes(myNameLower);
        return { time: timePart, name: namePart, isMine: isMine, full: match[0] };
      }
    }
    return null;
  }

  // Extract a short preview text after the bracket (strip dashes)
  function _notePreview(notesRaw, bracketFull) {
    if (!bracketFull) return '';
    var idx = notesRaw.indexOf(bracketFull);
    if (idx < 0) return '';
    var after = notesRaw.slice(idx + bracketFull.length).replace(/^[\s\-]+/, '').trim();
    // Cut at next bracket or 120 chars
    var nextBracket = after.indexOf('[');
    if (nextBracket > 0) after = after.slice(0, nextBracket).trim();
    return after.slice(0, 220) || '(update)';
  }

  // Convert "[MAR-31-26 2:43 PM Name]" bracket to a sortable ms timestamp (PHT)
  // Used for sorting matched cases from newest to oldest.
  function _parseNoteTime(entry) {
    if (!entry || !entry.date || !entry.time) return 0;
    try {
      // entry.date: "MAR-31-26", entry.time: "2:43 PM"
      var parts = entry.date.split('-');  // ["MAR","31","26"]
      var months = {JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11};
      var mon = months[parts[0]] !== undefined ? months[parts[0]] : 0;
      var day = parseInt(parts[1], 10);
      var yr  = 2000 + parseInt(parts[2], 10);
      var timeParts = entry.time.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      if (!timeParts) return 0;
      var hr  = parseInt(timeParts[1], 10);
      var min = parseInt(timeParts[2], 10);
      var ampm = timeParts[3].toUpperCase();
      if (ampm === 'PM' && hr !== 12) hr += 12;
      if (ampm === 'AM' && hr === 12) hr  = 0;
      // PHT = UTC+8; create as UTC then adjust
      return Date.UTC(yr, mon, day, hr - 8, min); // PHT→UTC
    } catch(_) { return 0; }
  }

  // Parse the MOST RECENT [DATE TIME Name] bracket from notes — regardless of date
  function _parseLatestEntry(notesRaw, myNameLower) {
    if (!notesRaw) return null;
    // \d{1,2} for day handles both zero-padded ("31") and unpadded ("1") dates
    var regex = /\[([A-Z]{3}-\d{1,2}-\d{2})\s+(\d{1,2}:\d{2}\s*(?:AM|PM))\s+([^\]]+)\]/gi;
    var last = null;
    var match;
    while ((match = regex.exec(notesRaw)) !== null) {
      var namePart = match[3].trim();
      var isMine   = myNameLower ? namePart.toLowerCase().includes(myNameLower) : false;
      last = { date: match[1].toUpperCase(), time: match[2].trim(), name: namePart, isMine: isMine, full: match[0] };
    }
    return last;
  }

  // Get field value from a QB record snap by keyword match
  function _fv(snap, keys) {
    if (!snap || !snap.fields || !snap.columnMap) return '';
    var colId = Object.keys(snap.columnMap).find(function(id) {
      var lbl = (snap.columnMap[id] || '').toLowerCase();
      return keys.some(function(k) { return lbl.includes(k); });
    });
    if (!colId) return '';
    var f = snap.fields[colId];
    return f && f.value != null ? String(f.value) : '';
  }

  // ── status accent ──────────────────────────────────────────────────────────
  function _accentClass(status) {
    var s = (status || '').toLowerCase();
    if (s.includes('invest'))        return { bar: 'yct-acc-blue',  dot: 'yct-dot-on',   badge: 'yct-cb-inv',  badgeTxt: 'Investigating',   entryClass: '' };
    if (s.includes('initial'))       return { bar: 'yct-acc-warn',  dot: 'yct-dot-warn', badge: 'yct-cb-init', badgeTxt: 'Initial Inquiry',  entryClass: ' yct-warn' };
    if (s.includes('resolv'))        return { bar: 'yct-acc-green', dot: 'yct-dot-res',  badge: 'yct-cb-res',  badgeTxt: 'Resolved',         entryClass: ' yct-green' };
    if (s.includes('wait'))          return { bar: 'yct-acc-warn',  dot: 'yct-dot-warn', badge: 'yct-cb-wait', badgeTxt: status || 'Waiting', entryClass: ' yct-warn' };
    return                                  { bar: 'yct-acc-init',  dot: 'yct-dot-warn', badge: 'yct-cb-init', badgeTxt: status || 'Open',   entryClass: '' };
  }

  // ── Premium Case Entry Card (v3.0) ────────────────────────────────────────
  // Sections: Header (Case# | Status | Age) → End User → Description → Case Notes
  function _renderEntry(snap, todayStr, myNameLower) {
    var caseId   = snap.recordId || '—';
    var desc     = _fv(snap, ['short description','description','concern','subject']) || '—';
    var status   = _fv(snap, ['case status','status']);
    var age      = _fv(snap, ['age','last update days','last update']);
    var endUser  = _fv(snap, ['end user','client','account','customer']);
    var notesRaw = _convertPHT(_fv(snap, ['case notes detail','case notes','case note','notes']));

    var acc = _accentClass(status);

    // ── Age display ──────────────────────────────────────────────────────────
    var ageStr = '';
    if (age) {
      var ageNum = Number(age);
      if (!isNaN(ageNum) && ageNum > 1000) {
        ageStr = ageNum < 86400000 ? '< 1 day' : Math.round(ageNum / 86400000) + 'd';
      } else if (!isNaN(ageNum)) {
        ageStr = ageNum < 1 ? '< 1 day' : ageNum === 1 ? '1 day' : Math.round(ageNum) + ' days';
      } else {
        ageStr = String(age).slice(0, 12);
      }
    }

    // ── Latest note entry ─────────────────────────────────────────────────────
    var entry = _parseTodayEntry(notesRaw, todayStr, myNameLower);
    if (!entry) entry = _parseLatestEntry(notesRaw, myNameLower);

    var preview  = entry ? _notePreview(notesRaw, entry.full) : '';
    var isMine   = entry ? entry.isMine : false;
    var avClass  = isMine ? 'av-mine' : 'av-other';
    var anClass  = isMine ? 'an-mine' : 'an-other';
    var ntClass  = isMine ? 'nt-mine' : 'nt-other';
    var snapIdx  = snap._yctIdx !== undefined ? snap._yctIdx : 0;

    // PHT timestamp chip from the note entry
    var phtChip = '';
    if (entry) {
      var phtLabel = entry.date ? (entry.date + ' ' + entry.time + ' PHT') : (entry.time + ' PHT');
      phtChip = '<span class="yct-pht-chip"><i class="fas fa-clock"></i>' + esc(phtLabel) + '</span>';
    }

    // Author avatar initials
    var authorInitials = entry ? entry.name.split(' ').slice(0,2).map(function(w){ return w[0]||''; }).join('').toUpperCase() : '';

    // Notes section HTML
    var notesHtml;
    if (entry && preview) {
      notesHtml =
        '<div class="yct-notes-section">' +
          '<div class="yct-notes-header">' +
            '<i class="fas fa-comment-alt" style="font-size:7px;color:rgba(255,255,255,.25);"></i>' +
            '<span class="yct-notes-label">Latest Case Note</span>' +
          '</div>' +
          '<div class="yct-notes-author">' +
            '<div class="yct-author-avatar ' + avClass + '">' + esc(authorInitials) + '</div>' +
            '<span class="yct-author-name ' + anClass + '">' + esc(entry.name) + '</span>' +
            (isMine ? '<span class="yct-me-chip">ME</span>' : '') +
          '</div>' +
          '<div class="yct-notes-text ' + ntClass + '">' + esc(preview) + '</div>' +
        '</div>';
    } else {
      notesHtml =
        '<div class="yct-notes-section">' +
          '<div class="yct-notes-header">' +
            '<i class="fas fa-comment-alt" style="font-size:7px;color:rgba(255,255,255,.25);"></i>' +
            '<span class="yct-notes-label">Latest Case Note</span>' +
          '</div>' +
          '<div class="yct-no-notes">No notes found</div>' +
        '</div>';
    }

    // Build the time chip for the header (prominent)
    var timeChipHtml = '';
    if (entry) {
      var timeDisplay = entry.time ? entry.time + ' PHT' : '';
      if (timeDisplay) {
        timeChipHtml = '<span class="yct-time-chip"><i class="fas fa-clock"></i>' + esc(timeDisplay) + '</span>';
      }
    }

    // Build end user row with prefix label
    var euHtml = '';
    if (endUser) {
      euHtml = '<div class="yct-eu-row">' +
        '<span class="yct-eu-tag">' +
          '<i class="fas fa-user"></i>' +
          '<span class="yct-eu-prefix">End User</span>' +
          esc(endUser) +
        '</span>' +
      '</div>';
    }

    return (
      '<div class="yct-entry' + acc.entryClass + '" data-yct-snap-idx="' + snapIdx + '" data-status-key="' + esc(status.toLowerCase()) + '" data-enduser="' + esc(endUser.toLowerCase()) + '">' +
        '<div class="yct-accent ' + acc.bar + '"></div>' +

        // ── Header row: dot + Case# + Status + Age + TIME (top-right) ──
        '<div class="yct-card-header">' +
          '<div class="yct-dot ' + acc.dot + '"></div>' +
          '<span class="yct-cnum">#' + esc(caseId) + '</span>' +
          '<span class="yct-badge ' + acc.badge + '">' + esc(acc.badgeTxt) + '</span>' +
          (ageStr
            ? '<span class="yct-age-pill"><i class="fas fa-hourglass-half"></i>' + esc(ageStr) + '</span>'
            : '') +
          timeChipHtml +
        '</div>' +

        // ── Card body: Description + End User ──
        '<div class="yct-card-body">' +
          '<div class="yct-desc">' + esc(desc) + '</div>' +
          euHtml +
        '</div>' +

        // ── Case Notes section ──
        notesHtml +

        // ── Footer CTA ──
        '<div class="yct-card-footer">' +
          '<span class="yct-cta-link"><i class="fas fa-arrow-right"></i> View Case Detail</span>' +
        '</div>' +
      '</div>'
    );
  }

  // ── main render ───────────────────────────────────────────────────────
  function _renderYCT() {
    var list    = document.getElementById('yct-list');
    var loading = document.getElementById('yct-loading');
    var countEl = document.getElementById('yct-count');
    var nameEl  = document.getElementById('yct-user-name');
    var qbCntEl = document.getElementById('home-qb-count');
    if (!list) return;

    // Get current user's QB name — try multiple sources in priority order
    var myName = String(window._qbMyNameCache || '').trim();
    if (!myName) {
      try {
        var u = window.store && window.store.getState && window.store.getState().user;
        myName = (u && (u.qb_name || u.name)) ? String(u.qb_name || u.name).trim() : '';
      } catch(e) {}
    }
    if (!myName && window.me) {
      myName = String(window.me.qb_name || window.me.name || '').trim();
    }
    if (!myName) {
      // Try reading from the cached profile on qbs-root
      var qbRootEl = document.getElementById('qbs-root');
      if (qbRootEl && qbRootEl._yctUserName) myName = qbRootEl._yctUserName;
    }
    var myNameLower = myName.toLowerCase();
    if (nameEl) nameEl.textContent = myName || 'You';

    // ── FIX v2.0: Read snaps from qbs-root._qbRowSnaps (set by _yctLoad) ──
    // _yctLoad calls /api/studio/yct_data (Global QB filtered by qb_name),
    // and stores them on qbs-root._qbRowSnaps before calling _renderYCT.
    // Fallback: raw __studioQbRecords from fetch-patch intercept.
    var qbRoot = document.getElementById('qbs-root');
    var snaps  = (qbRoot && Array.isArray(qbRoot._qbRowSnaps) && qbRoot._qbRowSnaps.length > 0)
                 ? qbRoot._qbRowSnaps : [];

    // Fallback: convert raw records if snaps not yet set
    if (snaps.length === 0) {
      var rawRecords = window.__studioQbRecords || [];
      var rawColumns = window.__studioQbColumns || [];
      if (rawRecords.length > 0) {
        var rawColMap = {};
        rawColumns.forEach(function(c) { rawColMap[String(c.id)] = String(c.label || c.id || ''); });
        snaps = rawRecords.map(function(r, i) {
          return {
            _yctIdx:   i,
            rowNum:    i + 1,
            recordId:  String(r.qbRecordId || r['3'] || i),
            fields:    r.fields || r,
            columnMap: rawColMap
          };
        });
      }
    }

    if (qbCntEl) qbCntEl.textContent = snaps.length + ' records';

    var todayStr = _manilaToday();

    // Filter: cases assigned to user AND with TODAY-dated note entry
    // Sort: most recent first (by latest note timestamp)
    var matched = [];
    snaps.forEach(function(snap, i) {
      snap._yctIdx = i;
      var assignedTo    = _fv(snap, ['assigned to','assigned','agent']);
      var assignedLower = assignedTo.toLowerCase();

      // STRICT FILTER: assignedTo must be non-empty AND match myName
      // - Skip records with empty/blank "Assigned to" (prevents unassigned cases leaking in)
      // - Use contains() for full-name flexibility ("Mace Ryan Reyes" ↔ stored qb_name)
      // - Secondary: first-name prefix match as fallback only when both sides are non-trivial
      if (!assignedLower.trim()) return; // skip — no assignee at all
      if (!myNameLower) return;          // skip — current user's qb_name not set

      var isAssignedToMe = assignedLower.includes(myNameLower);
      // Fallback: first word of assignedTo matches first word of myName (handles abbreviated names)
      // Only apply when myName has >4 chars to avoid matching single-letter or very short names
      if (!isAssignedToMe && myNameLower.length > 4) {
        var myFirst       = myNameLower.split(' ')[0];
        var assignedFirst = assignedLower.split(' ')[0];
        isAssignedToMe = myFirst.length > 3 && assignedFirst === myFirst;
      }
      if (!isAssignedToMe) return;

      // ONLY show cases with a TODAY-dated note entry (per user requirement)
      var notesRaw = _convertPHT(_fv(snap, ['case notes detail','case notes','case note','notes']));
      var todayEntry = _parseTodayEntry(notesRaw, todayStr, myNameLower);
      if (!todayEntry) return; // skip — no activity today

      // Store the today-entry and its sort time on the snap for ordering
      snap._yctTodayEntry = todayEntry;
      snap._yctSortTime   = _parseNoteTime(todayEntry);
      matched.push(snap);
    });

    // Sort: most recent first
    matched.sort(function(a, b) {
      return (b._yctSortTime || 0) - (a._yctSortTime || 0);
    });

    if (loading) loading.style.display = 'none';

    if (matched.length === 0) {
      list.innerHTML = '<div class="yct-empty"><i class="fas fa-check-circle"></i><span>No cases with activity today</span><span style="font-size:9px;color:rgba(255,255,255,.15);">' + todayStr + '</span></div>';
      if (countEl) countEl.textContent = '0';
      return;
    }

    if (countEl) countEl.textContent = matched.length;

    var html = matched.map(function(snap) {
      return _renderEntry(snap, todayStr, myNameLower);
    }).join('');
    list.innerHTML = html;

    // Bind click → Case Detail (FIX v3: activate QBS tab first, then open modal)
    list.querySelectorAll('.yct-entry').forEach(function(el) {
      el.addEventListener('click', function(e) {
        e.stopPropagation();
        var idx  = parseInt(el.dataset.yctSnapIdx, 10);
        var snap = snaps[idx];
        if (!snap) return;

        function _openModal() {
          // 1. Try the global opener (set by QBS init after data loads)
          if (typeof window.__studioQbCdOpen === 'function') {
            window.__studioQbCdOpen(snap, snaps);
            return;
          }
          // 2. Try root._qbcdOpen directly
          var qbRootEl = document.getElementById('qbs-root');
          if (qbRootEl && typeof qbRootEl._qbcdOpen === 'function') {
            qbRootEl._qbcdOpen(snap, snaps);
            return;
          }
          // 3. Walk up to find _qbcdOpen on any ancestor
          var el2 = document.getElementById('qbs-root');
          while (el2 && el2 !== document.body) {
            if (typeof el2._qbcdOpen === 'function') { el2._qbcdOpen(snap, snaps); return; }
            el2 = el2.parentElement;
          }
        }

        // Ensure QBS tab is active & _qbcdOpen is mounted before opening modal
        var qbRootEl2 = document.getElementById('qbs-root');
        var isQbsMounted = qbRootEl2 && (typeof qbRootEl2._qbcdOpen === 'function' || typeof window.__studioQbCdOpen === 'function');

        if (isQbsMounted) {
          // QBS already mounted — open immediately
          _openModal();
        } else {
          // QBS not mounted yet — activate tab first, then wait for mount
          var qbsTab = document.querySelector('[data-tab="qbs"]');
          if (qbsTab) qbsTab.click();
          var attempts = 0;
          var poll = setInterval(function() {
            attempts++;
            var ready = typeof window.__studioQbCdOpen === 'function'
                     || (document.getElementById('qbs-root') && typeof document.getElementById('qbs-root')._qbcdOpen === 'function');
            if (ready || attempts > 20) {
              clearInterval(poll);
              if (ready) _openModal();
            }
          }, 150);
        }
      });
    });

    // Store matched snaps for filter use
    list._yctAllSnaps = matched;
    list._yctAllSnapsGlobal = snaps;
  }

  // ── Compact / Detailed view toggle ──────────────────────────────────
  window._yctSetView = function(v) {
    var list       = document.getElementById('yct-list');
    var btnCompact = document.getElementById('yct-view-compact');
    var btnDetail  = document.getElementById('yct-view-detailed');
    if (!list) return;
    if (v === 'compact') {
      list.classList.add('yct-compact');
      if (btnCompact) { btnCompact.style.background = 'rgba(88,166,255,.15)'; btnCompact.style.color = '#58a6ff'; }
      if (btnDetail)  { btnDetail.style.background  = 'transparent';          btnDetail.style.color  = 'var(--ss-muted)'; }
    } else {
      list.classList.remove('yct-compact');
      if (btnCompact) { btnCompact.style.background = 'transparent';           btnCompact.style.color = 'var(--ss-muted)'; }
      if (btnDetail)  { btnDetail.style.background  = 'rgba(88,166,255,.15)'; btnDetail.style.color  = '#58a6ff'; }
    }
  };

  // ── filter pills ─────────────────────────────────────────────────────
  function _bindFilters() {
    var row = document.getElementById('yct-filter-row');
    var list = document.getElementById('yct-list');
    if (!row || !list) return;
    row.addEventListener('click', function(e) {
      var pill = e.target.closest('.yct-pill');
      if (!pill) return;
      row.querySelectorAll('.yct-pill').forEach(function(p) { p.classList.remove('active'); });
      pill.classList.add('active');
      var f = pill.dataset.filter;
      var entries = list.querySelectorAll('.yct-entry');
      entries.forEach(function(el) {
        var sk = el.dataset.statusKey || '';
        var eu = el.dataset.enduser || '';
        var show = true;
        if (f === 'investigating') show = sk.includes('invest');
        else if (f === 'initial')  show = sk.includes('initial');
        else if (f === 'woolworths') show = eu.includes('woolworths');
        el.style.display = show ? '' : 'none';
      });
    });
    // Set default view to compact
    window._yctSetView('compact');
  }

  // ── date display ──────────────────────────────────────────────────────
  function _updateDate() {
    var el = document.getElementById('home-date-display');
    if (!el) return;
    var now = new Date().toLocaleString('en-US', {
      timeZone: 'Asia/Manila', weekday:'short', month:'short', day:'numeric',
      hour:'2-digit', minute:'2-digit', hour12: true
    });
    el.textContent = now + ' PHT';
  }

  // ── init & refresh ────────────────────────────────────────────────────
  // ── PERMANENT FIX v2.0: YCT fetches its own QB data directly ──────
  // ROOT CAUSE of v1.x failure: YCT passively waited for window.__studioQbRecords
  // to be populated as a side-effect of the user clicking the QBS tab.
  // On home-page load, QBS tab is NEVER clicked → data never arrives → 0 records.
  //
  // SOLUTION: YCT calls /api/studio/yct_data (Global QB + assignedTo=qb_name filter).
  // This is the same endpoint used by the QBS tab, isolated to the user's own
  // Studio QB Settings. No dependency on any other tab being loaded.

  // ── get auth token (mirrors apiFetch pattern in this page) ──────────
  function _yctGetToken() {
    try {
      var raw = localStorage.getItem('mums_supabase_session') || sessionStorage.getItem('mums_supabase_session');
      if (raw) {
        var p = JSON.parse(raw);
        var t = p && (p.access_token || (p.session && p.session.access_token));
        if (t) return String(t);
      }
      if (window.CloudAuth && typeof window.CloudAuth.accessToken === 'function') {
        var t2 = window.CloudAuth.accessToken(); if (t2) return t2;
      }
      if (window.Auth && typeof window.Auth.getSession === 'function') {
        var s = window.Auth.getSession();
        var t3 = s && s.access_token; if (t3) return String(t3);
      }
    } catch(_) {}
    return '';
  }

  // ── fetch QB records from /api/studio/yct_data ───────────────────────
  // PERMANENT FIX (v2.0): Uses Global QB Settings — same source as My Quickbase.
  // Previous version called /api/studio/qb_data (per-user Studio QB, often empty).
  // /api/studio/yct_data reads Global QB + filters by user's registered qb_name.
  function _yctFetchQbData(limit) {
    limit = limit || 500;
    var tok = _yctGetToken();
    var headers = { 'Content-Type': 'application/json' };
    if (tok) headers['Authorization'] = 'Bearer ' + tok;
    return fetch('/api/studio/yct_data?limit=' + limit, { headers: headers })
      .then(function(r) {
        // If 401, token may be stale — trigger a re-boot on next authtoken event
        if (r.status === 401) {
          _yctBooted = false; // allow re-boot when token refreshes
          return Promise.reject(new Error('401_unauthorized'));
        }
        return r.json().catch(function() { return null; });
      })
      .then(function(data) {
        if (!data || !data.ok) {
          var list = document.getElementById('yct-list');
          var msgs = {
            'qb_name_not_assigned':         'Your QuickBase name is not set. Ask your admin to assign it in User Management.',
            'global_qb_not_configured':     'Global QuickBase is not configured. Contact your Super Admin.',
            'assigned_to_field_not_found':  '"Assigned to" field not found in this QuickBase table.',
          };
          var friendly = (data && data.warning && msgs[data.warning]) || (data && data.message) || 'QuickBase data unavailable.';
          if (list) list.innerHTML = '<div class="yct-empty"><i class="fas fa-exclamation-triangle" style="color:var(--ss-warn);"></i><span>' + (friendly).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</span></div>';
          return null;
        }
        // Cache qb_name returned from server — authoritative, no guesswork
        if (data.qbName) {
          window._qbMyNameCache = data.qbName;
          var nameEl = document.getElementById('yct-user-name');
          if (nameEl) nameEl.textContent = data.qbName;
          var qbRootEl = document.getElementById('qbs-root');
          if (qbRootEl) qbRootEl._yctUserName = data.qbName;
        }
        window.__studioQbRecords = data.records || [];
        window.__studioQbColumns = Array.isArray(data.columns) ? data.columns : [];
        return { records: data.records || [], columns: data.columns || [] };
      })
      .catch(function(err) {
        console.warn('[YCT] fetch error:', err);
        return null;
      });
  }

  // ── convert qb_data record shape → snap shape expected by _renderEntry ─
  // qb_data: { qbRecordId, fields: { "12": { value: "foo" } } }
  // _renderYCT expects snaps with: { recordId, fields, columnMap }
  function _yctRecordsToSnaps(records, columns) {
    // Build columnMap from columns array: { "12": "Case Status", ... }
    var columnMap = {};
    (columns || []).forEach(function(c) {
      columnMap[String(c.id)] = String(c.label || c.id);
    });
    return records.map(function(r, i) {
      return {
        _yctIdx:   i,
        rowNum:    i + 1,
        recordId:  String(r.qbRecordId || ''),
        fields:    r.fields || {},
        columnMap: columnMap
      };
    });
  }

  // ── update count badge in toolbar ───────────────────────────────────
  function _yctUpdateToolbar(count) {
    var qbCntEl = document.getElementById('home-qb-count');
    if (qbCntEl) qbCntEl.textContent = count + ' records';
  }

  // ── show loading state ───────────────────────────────────────────────
  function _yctShowLoading() {
    var list    = document.getElementById('yct-list');
    var loading = document.getElementById('yct-loading');
    if (!list) return;
    if (loading) {
      loading.style.display = '';
      if (!list.contains(loading)) list.innerHTML = '';
      if (!list.contains(loading)) list.appendChild(loading);
    } else {
      list.innerHTML = '<div class="yct-loading"><div class="yct-spinner"></div><span>Loading QB data...</span></div>';
    }
  }

  // ── main fetch+render cycle ──────────────────────────────────────────
  var _yctFetching = false;

  function _yctLoad(isRefresh) {
    if (_yctFetching) return;

    // Guard: if no token yet, don't try — _bootYCT will retry when mums:authtoken fires
    var tok = _yctGetToken();
    if (!tok) {
      var list = document.getElementById('yct-list');
      var loading = document.getElementById('yct-loading');
      if (list && loading) {
        if (!list.contains(loading)) list.innerHTML = '';
        if (!list.contains(loading)) list.appendChild(loading);
        loading.style.display = '';
      }
      return;
    }

    _yctFetching = true;
    _yctShowLoading();

    Promise.resolve()
    .then(function() {
      return _yctFetchQbData(500);
    }).then(function(result) {
      _yctFetching = false;
      if (!result) {
        // Error message already rendered inside _yctFetchQbData
        var countEl = document.getElementById('yct-count');
        if (countEl) countEl.textContent = '0';
        _yctUpdateToolbar(0);
        return;
      }
      // Convert records to snap format and update global snaps on qbs-root
      var snaps = _yctRecordsToSnaps(result.records, result.columns);
      _yctUpdateToolbar(result.records.length);

      // Attach to qbs-root so clicking a case opens the detail modal
      var qbRoot = document.getElementById('qbs-root');
      if (qbRoot) qbRoot._qbRowSnaps = snaps;

      // Track last successful fetch time for auto-poll debounce
      if (typeof _yctLastFetchTime !== 'undefined') _yctLastFetchTime = Date.now();
      // Render with the fresh snaps
      _renderYCT(snaps);
    }).catch(function(err) {
      _yctFetching = false;
      console.warn('[YCT] _yctLoad error:', err);
    });
  }

  // ── OVERRIDE _renderYCT to accept optional snaps argument ───────────
  // Wrap the original _renderYCT so _yctLoad can pass pre-fetched snaps directly
  var _renderYCT_orig = _renderYCT;
  _renderYCT = function(explicitSnaps) {
    if (Array.isArray(explicitSnaps) && explicitSnaps.length > 0) {
      // Use the passed snaps directly — bypass the window.__studioQbRecords lookup
      var _origRecords = window.__studioQbRecords;
      var _origColumns = window.__studioQbColumns;
      // _renderYCT_orig reads from qbs-root._qbRowSnaps or window.__studioQbRecords
      // We already set qbRoot._qbRowSnaps above, so just call it
      _renderYCT_orig();
    } else {
      _renderYCT_orig();
    }
  };

  // YCT auto-poll interval reference
  var _yctAutoPollInterval = null;
  var _yctLastFetchTime = 0;

  function _yctSilentRefresh() {
    // Silent refresh — only if home tab is visible and not already fetching
    var homeCanvas = document.getElementById('canvas-home');
    var isHomeVisible = homeCanvas && homeCanvas.style.display !== 'none' &&
                        !homeCanvas.classList.contains('hidden') &&
                        homeCanvas.offsetParent !== null;
    if (!isHomeVisible) return; // don't poll when user isn't on home tab
    if (_yctFetching) return;
    var now = Date.now();
    if (now - _yctLastFetchTime < 55000) return; // debounce: min 55s between fetches
    _yctLoad(true);
    _yctLastFetchTime = now;
  }

  function _startYCTAutoPoll() {
    if (_yctAutoPollInterval) return;
    // Poll every 60 seconds silently
    _yctAutoPollInterval = setInterval(_yctSilentRefresh, 60000);

    // Also refresh when browser tab regains visibility (user switches back)
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'visible') {
        var now = Date.now();
        // Only fetch if last fetch was >30s ago to avoid hammering on rapid tab switches
        if (now - _yctLastFetchTime > 30000) {
          _yctSilentRefresh();
        }
      }
    });
  }

  function _initYCT() {
    _updateDate();
    setInterval(_updateDate, 30000);
    _bindFilters();

    // Wire up Refresh Cases button — re-fetches from QB directly
    var refreshBtn = document.getElementById('home-yct-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function() {
        var icon = refreshBtn.querySelector('i');
        if (icon) icon.style.animation = 'yct-spin .7s linear infinite';
        _yctLastFetchTime = 0; // force refresh
        _yctLoad(true);
        setTimeout(function() { if (icon) icon.style.animation = ''; }, 1200);
      });
    }

    // Auto-fetch on init
    _yctLastFetchTime = Date.now();
    _yctLoad(false);

    // Start 60s auto-poll
    _startYCTAutoPoll();

    // Also re-load when home tab is clicked (silent refresh if already loaded)
    document.addEventListener('click', function(e) {
      var btn = e.target.closest('[data-tab="home"]');
      if (btn) {
        setTimeout(function() {
          _updateDate();
          var now = Date.now();
          // If last fetch was >30s ago, do a fresh fetch; else just re-render
          if (now - _yctLastFetchTime > 30000) {
            _yctLastFetchTime = now;
            _yctLoad(false);
          } else {
            var hasData = Array.isArray(window.__studioQbRecords) && window.__studioQbRecords.length > 0;
            if (hasData) { _renderYCT(); } else { _yctLoad(false); }
          }
        }, 200);
      }
    });

    // If QBS tab loads data later (user visits QBS tab), re-render YCT automatically
    window.__studioQbRecordsLoaded = function() {
      setTimeout(_renderYCT, 300);
    };
  }

  // ── YCT Boot — multi-layer auth-aware init ────────────────────────────────
  //
  // PRIMARY ROOT CAUSE (now fixed): /api/studio/yct_data was missing from the
  // Cloudflare Pages functions router (functions/api/[[path]].js) — every API
  // call on Cloudflare Pages MUST be registered there. Without it the endpoint
  // returned 404 → "QuickBase data unavailable" on every cold load.
  //
  // SECONDARY: auth token timing — cloud_auth.js resolves the session async
  // via ensureFreshSession() network round-trip. We must not call the API
  // until we have a token. Three-layer strategy below handles all cases:
  //   L1 — Immediate: token already in localStorage (fastest, returning users)
  //   L2 — mums:authtoken event (fired by cloud_auth.js after session confirmed)
  //   L3 — Retry loop: up to 10s at 500ms intervals (slow networks / cold logins)

  var _yctBooted = false;

  function _bootYCT() {
    if (_yctBooted) return;
    if (!_yctGetToken()) return;   // no token yet — wait for next trigger
    _yctBooted = true;
    clearInterval(_yctRetryInterval);
    _initYCT();
  }

  // L1 — Try immediately (synchronous check — works when token is already in LS)
  _bootYCT();

  // L2 — mums:authtoken: cloud_auth.js emits this after confirming the session
  window.addEventListener('mums:authtoken', function() {
    // 80ms delay ensures token is written to localStorage before we read it
    setTimeout(_bootYCT, 80);
  });

  // L2b — DOMContentLoaded: handles the case where mums:authtoken already fired
  // before this script registered (e.g. very fast cached sessions)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      setTimeout(function() { if (!_yctBooted) _bootYCT(); }, 200);
    });
  } else {
    setTimeout(function() { if (!_yctBooted) _bootYCT(); }, 200);
  }

  // L3 — Retry loop: every 500ms for up to 10s (slow auth, network latency)
  var _yctRetryCount = 0;
  var _yctRetryInterval = setInterval(function() {
    _yctRetryCount++;
    if (_yctBooted || _yctRetryCount > 20) { clearInterval(_yctRetryInterval); return; }
    _bootYCT();
  }, 500);

  // Expose globals
  window._yctRefresh = function() { _yctLoad(true); };
  window._yctRender  = _renderYCT;

})();
