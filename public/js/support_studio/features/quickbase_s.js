/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

/* ═══════════════════════════════════════════════════════════════════
   QuickBase_S — Injects Pages.my_quickbase into #qbs-root
   ISOLATED: Uses /api/studio/qb_settings (per-user) NOT global QB.
   fetch() is patched ONLY for the my_quickbase instance running inside
   #qbs-root, redirecting global_quickbase calls to studio/qb_settings_global.
═══════════════════════════════════════════════════════════════════ */
(function() {
  'use strict';

  var _qbsPageMounted = false;
  var _fetchPatched   = false;

  // ── Patch fetch ONCE before my_quickbase.js boots ─────────────────
  // my_quickbase.js calls two endpoints we need to redirect to Studio-isolated versions:
  // 1. /api/settings/global_quickbase  → /api/studio/qb_settings_global  (settings)
  // 2. /api/quickbase/monitoring       → /api/studio/qb_monitoring        (data fetch)
  // This ensures QuickBase_S reads from Studio QB Settings, never from Global QB.
  function applyFetchPatch() {
    if (_fetchPatched) return;
    _fetchPatched = true;
    var _orig = window.fetch;
    window.fetch = function(resource, init) {
      var url = (resource && typeof resource === 'object' && resource.url)
        ? resource.url : String(resource || '');
      // Redirect global QB settings reads/writes → Studio isolated settings
      if (url === '/api/settings/global_quickbase' ||
          url.startsWith('/api/settings/global_quickbase?') ||
          url.startsWith('/api/settings/global_quickbase ')) {
        var studioUrl = url.replace('/api/settings/global_quickbase', '/api/studio/qb_settings_global');
        return _orig.call(this, studioUrl, init);
      }
      // Redirect monitoring data fetch → Studio monitoring proxy (uses Studio token)
      if (url.startsWith('/api/quickbase/monitoring') ||
          url.startsWith('/functions/quickbase/monitoring')) {
        var studioMonUrl = url
          .replace('/api/quickbase/monitoring', '/api/studio/qb_monitoring')
          .replace('/functions/quickbase/monitoring', '/api/studio/qb_monitoring');
        return _orig.call(this, studioMonUrl, init);
      }
      return _orig.apply(this, arguments);
    };
  }

  window._qbsInit = function() {
    if (_qbsPageMounted) return;

    var root = document.getElementById('qbs-root');
    if (!root) return;

    // Apply patch before my_quickbase boots
    applyFetchPatch();

    function tryInit() {
      if (!window.Pages || !window.Pages.my_quickbase) {
        setTimeout(tryInit, 150);
        return;
      }
      root.className = 'main card pad';
      root.style.cssText = 'flex:1;min-height:0;overflow:hidden;';
      root.innerHTML = '';
      // ENFORCE ISOLATION NAMESPACE
      root.setAttribute('data-page', 'quickbase_s');
      root.dataset.page = 'quickbase_s';
            try {
              var _qbsInitResult = window.Pages.my_quickbase(root);
              _qbsPageMounted = true;
              
              // Robust polling to expose root._qbcdOpen as window.__studioQbCdOpen
              // root._qbcdOpen is set by my_quickbase.js only AFTER async data loads + renderRecords
              function _exposeQbCdOpen() {
                if (typeof root._qbcdOpen === 'function') {
                  // FIX v3.9.28: __studioQbCdOpen passes [snap] as the snaps array
                  // when called from deep search, since host._qbRowSnaps only has the
                  // current report rows and won't contain resolved/old cases.
                  window.__studioQbCdOpen = function(snap, allSnaps) {
                    var snapsToUse = Array.isArray(allSnaps) && allSnaps.length
                      ? allSnaps
                      : [snap];
                    return root._qbcdOpen(snap, snapsToUse);
                  };
                  console.log('[SupportStudio] __studioQbCdOpen exposed successfully');
                  return true;
                }
                return false;
              }
              
              // Try immediately after init
              Promise.resolve(_qbsInitResult).then(function() {
                if (_exposeQbCdOpen()) return;
                // Poll every 1s for up to 20s (covers slow data loads)
                var attempts = 0;
                var poller = setInterval(function() {
                  attempts++;
                  if (_exposeQbCdOpen() || attempts >= 20) {
                    clearInterval(poller);
                  }
                }, 1000);
              }).catch(function(){});
      } catch (e) {
        root.innerHTML =
          '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:12px;color:#f85149;padding:24px;text-align:center;">' +
          '<i class="fas fa-exclamation-triangle" style="font-size:32px;opacity:.6;"></i>' +
          '<div style="font-size:13px;font-weight:600;">QuickBase_S failed to load</div>' +
          '<div style="font-size:11px;opacity:.6;max-width:360px;">' + String(e && e.message || e) + '</div>' +
          '<button onclick="window._qbsReset()" style="margin-top:8px;background:rgba(248,81,73,.1);border:1px solid rgba(248,81,73,.3);color:#f85149;padding:7px 16px;border-radius:6px;font-size:12px;font-weight:700;font-family:inherit;cursor:pointer;">Retry</button>' +
          '</div>';
        console.error('[QBS] my_quickbase init failed:', e);
      }
    }

    tryInit();
  };

  window._qbsReset = function() {
    _qbsPageMounted = false;
    var root = document.getElementById('qbs-root');
    if (root) {
      if (typeof root._cleanup === 'function') { try { root._cleanup(); } catch(_) {} root._cleanup = null; }
      root.innerHTML = '';
    }
    window._qbsInit();
  };

  // ── Open Case Detail Modal ─────────────────────────────────────────
  // Works for both: row number clicks (from my_quickbase) and deep search cards.
  // The modal #qbCaseDetailModal is now in support_studio.html directly.

  // PHT conversion — Eastern Time (ET) → PHT(UTC+8)
  // QB uses Eastern Time which observes US DST:
  //   EDT(UTC-4): 2nd Sunday March → 1st Sunday November
  //   EST(UTC-5): December, January, February
  function _ssConvertPHT(text) {
    if (!text) return text;
    var _MON = {JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11};
    var _MN  = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    function _etOffset(year, month, day) {
      if (month > 2 && month < 10) return 4;
      if (month === 2) { var d = new Date(year,2,1); var s2 = ((7-d.getDay())%7)+8; return day>=s2?4:5; }
      if (month === 10) { var d2 = new Date(year,10,1); var s1 = ((7-d2.getDay())%7)+1; return day<s1?4:5; }
      return 5;
    }
    return text.replace(
      /\[([A-Z]{3})-(\d{1,2})-(\d{2})\s+(\d{1,2}):(\d{2})\s*(AM|PM)([\s\S]*?)\]/gi,
      function(full, mon, dd, yy, hh, mi, ap, rest) {
        try {
          var monU = mon.toUpperCase();
          if (!(_MON[monU] !== undefined)) return full;
          var year = parseInt(yy,10); year = year < 50 ? 2000+year : 1900+year;
          var month = _MON[monU], day = parseInt(dd,10);
          var h = parseInt(hh,10);
          if (ap.toUpperCase()==='PM' && h<12) h+=12;
          if (ap.toUpperCase()==='AM' && h===12) h=0;
          var offsetH = _etOffset(year, month, day);
          var utcMs = Date.UTC(year, month, day, h+offsetH, parseInt(mi,10), 0);
          var phtMs = utcMs + 8*3600*1000;
          var p = new Date(phtMs);
          var ph = p.getUTCHours(), pm2 = p.getUTCMinutes();
          var pap = ph >= 12 ? 'PM' : 'AM';
          ph = ph % 12 || 12;
          // FIX: pad day to 2 digits so date-parsing regexes always match \d{2}
          var dayStr = String(p.getUTCDate()).padStart(2,'0');
          return '[' + _MN[p.getUTCMonth()] + '-' + dayStr + '-' +
            String(p.getUTCFullYear()).slice(-2) + ' ' + ph + ':' +
            String(pm2).padStart(2,'0') + ' ' + pap + rest + ']';
        } catch(_) { return full; }
      }
    );
  }
  // Expose on window so YCT and other modules can use it
  window._ssConvertPHT = _ssConvertPHT;

  window._qbsOpenCaseDetail = function(snap, allSnaps) {
    var root = document.getElementById('qbs-root');

    // Primary path: use root._qbcdOpen set by Pages.my_quickbase
    if (root && typeof root._qbcdOpen === 'function') {
      root._qbcdOpen(snap, allSnaps || [snap]);
      return;
    }

    // Fallback path: directly open the modal ourselves
    // (when QBS page is mounted but _qbcdOpen ref lost, or called before full mount)
    var m = document.getElementById('qbCaseDetailModal');
    if (!m) { console.warn('[QBS] qbCaseDetailModal not found'); return; }

    // Populate fields
    function set(id, val) {
      var el = document.getElementById(id);
      if (el) el.textContent = val || '—';
    }
    function html(id, val) {
      var el = document.getElementById(id);
      if (el) el.innerHTML = val || '';
    }
    function fieldVal(keys) {
      if (!snap || !snap.fields || !snap.columnMap) return '';
      var colId = Object.keys(snap.columnMap).find(function(id) {
        var lbl = (snap.columnMap[id] || '').toLowerCase();
        return keys.some(function(k) { return lbl.includes(k); });
      });
      if (!colId) return '';
      var f = snap.fields[colId];
      return f && f.value != null ? String(f.value) : '';
    }
    function statusBadge(s) {
      if (!s) return '';
      var colors = { resolv: '#3fb950', invest: '#58a6ff', initial: '#f59e0b',
        triag: '#a78bfa', close: '#8b949e', wait: '#f97316' };
      var sl = s.toLowerCase();
      var c = '#8b949e';
      for (var k in colors) { if (sl.includes(k)) { c = colors[k]; break; } }
      return '<span style="display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;background:' + c + '18;color:' + c + ';border:1px solid ' + c + '40;">' + s + '</span>';
    }

    var caseId = snap.recordId || '—';
    var ridRaw = snap.recordId || '';
    var rid = ridRaw && ridRaw !== '—' ? String(ridRaw) : '';
    var qbBase = 'https://copeland-coldchainservices.quickbase.com/nav/app/bpvmztzkw/table/bpvmztzr5';
    var editUrl = rid ? (qbBase + '/action/er?rid=' + encodeURIComponent(rid) + '&rl=bmg5') : '#';
    var viewUrl = rid ? (qbBase + '/action/dr?rid=' + encodeURIComponent(rid) + '&rl=bmg5') : '#';
    var desc   = fieldVal(['short description','description','concern','subject']) || '—';
    var assign = fieldVal(['assigned to','assigned','agent']);
    var contact= fieldVal(['contact','full name','customer name']);
    var endUser= fieldVal(['end user','client','account','customer']);
    var type   = fieldVal(['type','category']);
    var status = fieldVal(['case status','status']);
    var age    = fieldVal(['age']);
    var lastUpd= fieldVal(['last update days','last update']);
    // Convert EST→PHT timestamps in all text-bearing fields
    var latest = _ssConvertPHT(fieldVal([
      'latest update on the case',
      'latest update',
      'last update',
      'last comment',
      'most recent update',
      'update on the case'
    ]));
    var notes  = _ssConvertPHT(fieldVal([
      'case notes detail',
      'case notes',
      'case note',
      'case details',
      'resolution details',
      'notes'
    ]));

    set('qbcdRowBadge', snap.rowNum || '—');
    set('qbcdCaseId',   caseId);
    set('qbcdDesc',     desc);
    set('qbcdRidBadge', 'RID: ' + (rid || 'N/A'));
    var viewBtn = document.getElementById('qbcdViewBtn');
    var editBtn = document.getElementById('qbcdEditBtn');
    if (viewBtn) {
      viewBtn.href = viewUrl;
      viewBtn.setAttribute('aria-disabled', rid ? 'false' : 'true');
      viewBtn.classList.toggle('is-disabled', !rid);
    }
    if (editBtn) {
      editBtn.href = editUrl;
      editBtn.setAttribute('aria-disabled', rid ? 'false' : 'true');
      editBtn.classList.toggle('is-disabled', !rid);
    }
    html('qbcdStatusBadge', statusBadge(status));
    set('qbcdMeta',     'Row ' + (snap.rowNum || '?') + (endUser ? ' · ' + endUser : ''));
    set('qbcdKpiAge',   age     ? (Number(age) < 86400000 ? '< 1 day' : Math.round(Number(age)/(86400000)) + ' days') : '—');
    set('qbcdKpiLast',  lastUpd ? (Number(lastUpd) < 1 ? '< 1 day' : lastUpd + ' days') : '—');
    set('qbcdKpiType',  type);
    set('qbcdKpiEndUser', endUser);
    set('qbcdAssigned', assign);
    set('qbcdContact',  contact);
    set('qbcdEndUser',  endUser);
    set('qbcdCaseId2',  caseId);
    set('qbcdType2',    type);
    html('qbcdStatus2', statusBadge(status));
    set('qbcdLatest',   latest || '—');

    var notesBlock = document.getElementById('qbcdNotesBlock');
    if (notes) {
      set('qbcdNotes', notes);
      if (notesBlock) notesBlock.style.display = '';
    } else {
      if (notesBlock) notesBlock.style.display = 'none';
    }

    // Nav position
    var _allSnaps = Array.isArray(allSnaps) ? allSnaps : [snap];
    var _idx = _allSnaps.findIndex(function(s) { return s && s.rowNum === snap.rowNum; });
    if (_idx < 0) _idx = 0;
    var posEl = document.getElementById('qbcdPos');
    if (posEl) posEl.textContent = (_idx + 1) + ' of ' + _allSnaps.length;
    var prevBtn = document.getElementById('qbcdPrevBtn');
    var nextBtn = document.getElementById('qbcdNextBtn');
    if (prevBtn) prevBtn.disabled = _idx <= 0;
    if (nextBtn) nextBtn.disabled = _idx >= _allSnaps.length - 1;

    // Store state for nav buttons
    m._qbsSnaps = _allSnaps;
    m._qbsIdx   = _idx;

    // Wire nav/close if not already wired
    if (!m._qbsWired) {
      m._qbsWired = true;
      function navTo(newIdx) {
        var s = m._qbsSnaps[newIdx];
        if (!s) return;
        m._qbsIdx = newIdx;
        window._qbsOpenCaseDetail(s, m._qbsSnaps);
      }
      var cbtn  = document.getElementById('qbcdCloseBtn');
      var cbtn2 = document.getElementById('qbcdCloseBtn2');
      var pb    = document.getElementById('qbcdPrevBtn');
      var nb    = document.getElementById('qbcdNextBtn');
      var cpy   = document.getElementById('qbcdCopyBtn');
      function closeModal() {
        m.classList.remove('open');
        m.removeAttribute('style');
        try { document.body.classList.remove('modal-open'); } catch(_) {}
      }
      if (cbtn)  cbtn.addEventListener('click',  closeModal);
      if (cbtn2) cbtn2.addEventListener('click', closeModal);
      if (pb)    pb.addEventListener('click', function() { navTo(m._qbsIdx - 1); });
      if (nb)    nb.addEventListener('click', function() { navTo(m._qbsIdx + 1); });
      if (cpy)   cpy.addEventListener('click', function() {
        var id = (document.getElementById('qbcdCaseId') || {}).textContent || '';
        if (id && navigator.clipboard) navigator.clipboard.writeText(id).then(function() {
          cpy.textContent = 'Copied!';
          setTimeout(function() { cpy.textContent = 'Copy Case #'; }, 1800);
        }).catch(function() {});
      });
      m.addEventListener('mousedown', function(e) { if (e.target === m) closeModal(); });
      document.addEventListener('keydown', function(e) {
        if (!m.classList.contains('open')) return;
        if (e.key === 'Escape')    closeModal();
        if (e.key === 'ArrowLeft') navTo(m._qbsIdx - 1);
        if (e.key === 'ArrowRight') navTo(m._qbsIdx + 1);
      });
    }

    // Open
    m.removeAttribute('style');
    m.style.cssText = 'display:flex!important;position:fixed!important;inset:0!important;' +
      'z-index:2147483647!important;align-items:center!important;justify-content:center!important;' +
      'background:rgba(6,12,24,.88)!important;padding:16px!important;box-sizing:border-box!important;';
    m.classList.add('open');
    if (m.parentElement !== document.body) document.body.appendChild(m);
    try { document.body.classList.add('modal-open'); } catch(_) {}
  };

  // Clean up when leaving the QBS tab
  document.querySelectorAll('.ss-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      if (tab.dataset.tab !== 'qbs' && _qbsPageMounted) {
        var root = document.getElementById('qbs-root');
        if (root && typeof root._cleanup === 'function') {
          try { root._cleanup(); } catch(_) {}
          root._cleanup = null;
        }
        _qbsPageMounted = false;
      }
    });
  });

  // ── Deep Search — searches ALL QB records via /api/studio/qb_search ──
  // Results sorted by Case # DESCENDING (highest = newest case first).
  // Renders clickable cards in #qbs-search-results.
  function _qbsReadContextConfig() {
    var reportLink = ((document.getElementById('sqb-report-link') || {}).value || '').trim();
    var realm = ((document.getElementById('sqb-realm') || {}).value || '').trim();
    var tableId = ((document.getElementById('sqb-table-id') || {}).value || '').trim();
    var appId = '';
    if (reportLink) {
      try {
        var u = new URL(reportLink);
        var segs = String(u.pathname || '').split('/').filter(Boolean);
        var ai = segs.findIndex(function(seg) { return String(seg).toLowerCase() === 'app'; });
        if (ai >= 0 && segs[ai + 1]) appId = String(segs[ai + 1]).trim();
      } catch(_) {}
    }
    var tabConfig = { reportLink: reportLink, realm: realm, tableId: tableId };
    return { tabConfig: tabConfig, realm: realm, appId: appId, tableId: tableId };
  }

  // FIX v3.9.28: _qbsBuildDeepSearchSnaps now uses rec.columnMap from the server
  // response directly (which includes ALL field IDs, including field 3 / Record ID#).
  // Previously it rebuilt columnMap only from d.columns (which filters out field 3),
  // so _populate() could not find "Case #" or other critical fields → empty modal.
  function _qbsBuildDeepSearchSnaps(records, labelMap) {
    var context = _qbsReadContextConfig();
    var cols = Object.keys(labelMap || {}).map(function(id) {
      return { id: Number(id) || id, label: labelMap[id] || ('Field #' + id) };
    });
    return (Array.isArray(records) ? records : []).map(function(rec, idx) {
      // Prefer the server-supplied rec.columnMap (complete field map including field 3).
      // Fall back to labelMap (built from d.columns) only if server didn't send it.
      var colMap = (rec && rec.columnMap && Object.keys(rec.columnMap).length)
        ? Object.assign({}, rec.columnMap)
        : Object.assign({}, labelMap || {});
      return {
        rowNum: idx + 1,
        recordId: rec && (rec.qbRecordId || rec.recordId || rec.id) ? String(rec.qbRecordId || rec.recordId || rec.id) : '',
        qbRecordId: rec && rec.qbRecordId ? rec.qbRecordId : '',
        fields: rec && rec.fields ? rec.fields : {},
        columns: cols,
        columnMap: colMap,
        tabConfig: context.tabConfig,
        realm: context.realm,
        appId: context.appId,
        tableId: context.tableId
      };
    });
  }

  /*
    DIAGNOSTIC (Q1-Q4)
    Q1: my_quickbase case detail opener was not exposed on window; it was an internal _open closure inside _initQbCaseDetailModal with root._qbcdOpen only.
    Q2: QB_S row number click handler exists via .qb-row-detail-btn (direct onclick + delegated #qbDataBody listener), but cross-module callers could not reliably access the opener.
    Q3: Deep Search cards had a CASE VIEW DETAILS button (.qbs-case-detail-btn) but it used only data-qbs-result-idx and local fallback openers.
    Q4: Timing issue risk existed for cross-module calls because no stable window-level modal opener was guaranteed before external handlers fired.
  */
  // FIX v3.9.30: Removed the broken columnMap:{} snap path entirely.
  // This function now delegates ALL opens to _qbsOpenDeepResult which uses
  // the pre-built snap from _qbsDeepSearchSnaps (has full fields + columnMap).
  function _qbsEnsureDeepSearchCaseDetailBinding(resultsEl) {
    if (!resultsEl || resultsEl._qbsCaseDetailBound) return;
    resultsEl._qbsCaseDetailBound = true;
    resultsEl.addEventListener('click', function(e) {
      var btn = e.target && e.target.closest && e.target.closest('[data-action="ds-case-view-details"]');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      var resultIdx = parseInt(btn.getAttribute('data-qbs-result-idx') || '', 10);
      var rid = btn.getAttribute('data-rid') || '';
      // Always use the pre-built snap which has the FULL columnMap + fields from the API.
      // The old path built columnMap:{} here, making every detail view show all dashes.
      if (!isNaN(resultIdx)) {
        window._qbsOpenDeepResult(rid, resultIdx);
      }
    });
  }

  window._qbsDeepSearch = function(term, skip) {
    term = String(term || '').trim();
    if (!term) {
      document.getElementById('qbs-search-status').textContent = '';
      document.getElementById('qbs-search-results').innerHTML = '';
      return;
    }
    skip = Math.max(0, Number(skip || 0));
    var TOP = 50;

    var statusEl  = document.getElementById('qbs-search-status');
    var resultsEl = document.getElementById('qbs-search-results');
    var qfEl      = document.getElementById('qbs-quick-filters');
    var btn       = document.getElementById('qbs-deep-search-btn');

    if (statusEl) statusEl.textContent = 'Searching…';
    if (resultsEl && skip === 0) resultsEl.innerHTML = '<div style="color:var(--ss-muted);font-size:11px;padding:12px 0;display:flex;align-items:center;gap:8px;"><i class="fas fa-spinner fa-spin"></i> Searching all records…</div>';
    if (qfEl) qfEl.style.display = 'none';
    if (btn) btn.disabled = true;

    // Auth token
    var tok = '';
    try {
      var raw = localStorage.getItem('mums_supabase_session') || sessionStorage.getItem('mums_supabase_session');
      if (raw) { var p = JSON.parse(raw); if (p && p.access_token) tok = p.access_token; }
      if (!tok && window.CloudAuth && typeof window.CloudAuth.accessToken === 'function') tok = window.CloudAuth.accessToken() || '';
    } catch(_) {}

    var headers = { 'Content-Type': 'application/json' };
    if (tok) headers['Authorization'] = 'Bearer ' + tok;

    var url = '/api/studio/qb_search?q=' + encodeURIComponent(term) + '&skip=' + skip + '&top=' + TOP;

    fetch(url, { headers: headers })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (btn) btn.disabled = false;

        // Not configured
        if (d.warning === 'studio_qb_not_configured') {
          if (statusEl) statusEl.textContent = '';
          if (resultsEl) resultsEl.innerHTML =
            '<div style="padding:16px;background:rgba(248,81,73,.06);border:1px solid rgba(248,81,73,.2);border-radius:8px;font-size:11px;color:#f85149;line-height:1.6;">' +
            '<i class="fas fa-exclamation-triangle" style="margin-right:6px;"></i>' +
            'QB not configured. Go to <strong>General Settings → Studio Quickbase Settings</strong>.</div>';
          return;
        }

        if (!d.ok) {
          if (statusEl) statusEl.textContent = 'Search failed.';
          if (resultsEl) resultsEl.innerHTML =
            '<div style="padding:12px;background:rgba(248,81,73,.06);border:1px solid rgba(248,81,73,.2);border-radius:8px;font-size:11px;color:#f85149;">' +
            '<i class="fas fa-times-circle" style="margin-right:6px;"></i>' + _dsEsc(d.message || 'Unknown error') + '</div>';
          return;
        }

        var records = Array.isArray(d.records) ? d.records : [];
        var cols    = Array.isArray(d.columns) ? d.columns : [];
        var total   = typeof d.total === 'number' ? d.total : null;

        // Sort by Case # (field 3) DESCENDING — highest number = newest case
        records.sort(function(a, b) {
          var aId = Number(a.qbRecordId) || 0;
          var bId = Number(b.qbRecordId) || 0;
          return bId - aId; // descending
        });

        // Build column label map
        var labelMap = {};
        cols.forEach(function(c) { labelMap[String(c.id)] = c.label; });

        // Key fields we want to surface in cards
        var PRIORITY_KEYS = ['case status','short description','assigned to','contact','type','latest update','end user','age','last update'];

        function getFieldValue(fields, labelHint) {
          if (!fields) return '';
          var keys = Object.keys(fields);
          // Try to find by label hint
          var matched = keys.find(function(k) {
            var lbl = (labelMap[k] || '').toLowerCase();
            return PRIORITY_KEYS.some(function(h) { return lbl.includes(h); }) &&
              lbl.includes(labelHint.toLowerCase());
          });
          if (!matched) matched = keys.find(function(k) { return (labelMap[k]||'').toLowerCase().includes(labelHint.toLowerCase()); });
          if (!matched) return '';
          var v = fields[matched];
          return v && typeof v === 'object' ? String(v.value || '') : String(v || '');
        }

        function _dsEsc2(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

        // Render result cards
        var html = '';
        if (!records.length) {
          html = '<div style="padding:20px 0;text-align:center;color:var(--ss-muted);font-size:11px;">' +
            '<i class="fas fa-search" style="font-size:20px;opacity:.3;display:block;margin-bottom:8px;"></i>' +
            'No results for <strong>' + _dsEsc2(term) + '</strong></div>';
        } else {
          records.forEach(function(rec, resultIdx) {
            var caseNum   = rec.qbRecordId || '—';
            var status    = getFieldValue(rec.fields, 'case status') || getFieldValue(rec.fields, 'status');
            var desc      = getFieldValue(rec.fields, 'short description') || getFieldValue(rec.fields, 'description') || getFieldValue(rec.fields, 'latest update') || '';
            var assignee  = getFieldValue(rec.fields, 'assigned') || '';
            var contact   = getFieldValue(rec.fields, 'contact') || getFieldValue(rec.fields, 'full name') || '';
            var caseType  = getFieldValue(rec.fields, 'type') || '';
            var age       = getFieldValue(rec.fields, 'age') || getFieldValue(rec.fields, 'last update days') || '';

            // Status badge color
            var statusColor = '#58a6ff';
            var sl = status.toLowerCase();
            if (sl.includes('resolv') || sl.includes('closed') || sl.startsWith('c -')) statusColor = '#3fb950';
            else if (sl.includes('investigat') || sl.includes('waiting') || sl.startsWith('o -')) statusColor = '#d29922';

            var descTrunc = desc.length > 110 ? desc.slice(0, 107) + '…' : desc;

            html += '<div onclick="window._qbsOpenDeepResult(\'' + _dsEsc2(caseNum) + '\',' + resultIdx + ')" ' +
              'style="padding:10px 11px;margin-bottom:6px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:7px;cursor:pointer;transition:background .12s,border-color .12s;" ' +
              'onmouseover="this.style.background=\'rgba(88,166,255,.07)\';this.style.borderColor=\'rgba(88,166,255,.25)\';" ' +
              'onmouseout="this.style.background=\'rgba(255,255,255,.03)\';this.style.borderColor=\'rgba(255,255,255,.07)\';">' +

              '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">' +
                '<span style="font-size:11px;font-weight:900;color:#e6edf3;letter-spacing:-.01em;">#' + _dsEsc2(String(caseNum)) + '</span>' +
                '<span style="font-size:9px;font-weight:700;padding:2px 7px;border-radius:4px;background:' + statusColor + '18;color:' + statusColor + ';border:1px solid ' + statusColor + '30;">' + _dsEsc2(status || 'Open') + '</span>' +
              '</div>' +

              (caseType || contact || age ? '<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;flex-wrap:wrap;">' +
                (caseType ? '<span style="font-size:9px;color:var(--ss-muted);background:rgba(255,255,255,.05);padding:1px 6px;border-radius:3px;">' + _dsEsc2(caseType) + '</span>' : '') +
                (contact  ? '<span style="font-size:9px;color:var(--ss-muted);"><i class="fas fa-user" style="margin-right:3px;opacity:.5;"></i>' + _dsEsc2(contact) + '</span>' : '') +
                (age      ? '<span style="font-size:9px;color:var(--ss-muted);margin-left:auto;opacity:.7;">' + _dsEsc2(age) + '</span>' : '') +
              '</div>' : '') +

              (descTrunc ? '<div style="font-size:10px;color:var(--ss-muted);line-height:1.5;opacity:.85;">' + _dsEsc2(descTrunc) + '</div>' : '') +

              '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:7px;padding-top:7px;border-top:1px solid rgba(255,255,255,.07);">' +
                '<div style="display:flex;align-items:center;gap:6px;min-width:0;">' +
                  '<span class="ds-card-label" style="font-size:9px;font-weight:700;color:var(--ss-muted);text-transform:uppercase;letter-spacing:.04em;">Assigned to</span>' +
                  '<span class="ds-card-value" style="font-size:10px;color:#e6edf3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:170px;">' + _dsEsc2(assignee || '—') + '</span>' +
                '</div>' +
                '<button type="button" class="qb-row-num-pill qb-row-detail-btn qbs-case-detail-btn ds-case-view-btn" data-action="ds-case-view-details" data-rid="' + _dsEsc2(String(caseNum || '')) + '" data-row=\'' + _dsEsc2(JSON.stringify(rec).replace(/'/g, '&#39;')) + '\' data-qbs-result-idx="' + resultIdx + '" style="border-radius:999px;padding:5px 10px;min-width:auto;font-size:9px;font-weight:800;letter-spacing:.02em;" onclick="event.stopPropagation();" title="View case details" aria-label="CASE VIEW DETAILS for case #' + _dsEsc2(String(caseNum)) + '">CASE VIEW DETAILS</button>' +
              '</div>' +

              '</div>';
          });
        }

        // Pagination controls
        var paginationHtml = '';
        if (records.length === TOP || skip > 0) {
          paginationHtml = '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px;padding-top:8px;border-top:1px solid var(--ss-border);">' +
            (skip > 0 ? '<button onclick="window._qbsDeepSearch(\'' + _dsEsc2(term) + '\',' + Math.max(0, skip - TOP) + ')" style="font-size:10px;font-weight:700;color:#58a6ff;background:rgba(88,166,255,.1);border:1px solid rgba(88,166,255,.2);border-radius:5px;padding:5px 10px;cursor:pointer;font-family:var(--ss-font);">← Prev</button>' : '<span></span>') +
            (records.length === TOP ? '<button onclick="window._qbsDeepSearch(\'' + _dsEsc2(term) + '\',' + (skip + TOP) + ')" style="font-size:10px;font-weight:700;color:#58a6ff;background:rgba(88,166,255,.1);border:1px solid rgba(88,166,255,.2);border-radius:5px;padding:5px 10px;cursor:pointer;font-family:var(--ss-font);">Next →</button>' : '<span style="font-size:9px;color:var(--ss-muted);">End of results</span>') +
          '</div>';
        }

        var countText = total !== null
          ? records.length + ' of ' + total.toLocaleString() + ' total'
          : records.length + ' results';
        if (skip > 0) countText = 'Showing ' + (skip + 1) + '–' + (skip + records.length);

        if (statusEl) statusEl.textContent = countText;
        if (resultsEl) {
          resultsEl.innerHTML = html + paginationHtml;
          resultsEl._qbsDeepSearchSnaps = _qbsBuildDeepSearchSnaps(records, labelMap);
          resultsEl._qbsDeepSearchColumns = cols;
          // Keep global references in sync for patch-layer fallback openers.
          window.__studioQbDeepRecords = records;
          window.__studioQbDeepColumns = cols;
          _qbsEnsureDeepSearchCaseDetailBinding(resultsEl);
        }
      })
      .catch(function(err) {
        if (btn) btn.disabled = false;
        if (statusEl) statusEl.textContent = 'Search error.';
        if (resultsEl) resultsEl.innerHTML =
          '<div style="font-size:11px;color:#f85149;padding:8px 0;">' +
          '<i class="fas fa-times-circle" style="margin-right:6px;"></i>' + String(err && err.message || 'Network error') + '</div>';
      });
  };

  // Helper: open a deep search result as a case detail
  // FIX v3.9.28: Removed the broken window.MQ.openCaseDetailModal path.
  // That function looks up the record in the CURRENTLY LOADED REPORT rows
  // (_qbRowSnaps, max 100–500 records, filtered to active cases only).
  // Resolved/old cases are NOT in that set, so the modal opened with
  // wrong data (row 0) or empty dashes.
  // Correct path: root._qbcdOpen(snap, snaps) which calls _populate(snap)
  // using the snap's own fields + columnMap from the deep search API.
  // FIX v3.9.30: always use the pre-built snap from deep-search (has full fields + columnMap).
  // root._qbcdOpen is now set synchronously (moved before try{} — FIX 1), so it is
  // reliably available. MQ.openCaseDetailModal path removed: it looked up records in
  // host._qbRowSnaps (active report only, max 500 rows) and missed resolved/old cases.
  window._qbsOpenDeepResult = function(caseNum, resultIdx) {
    var resultsEl = document.getElementById('qbs-search-results');
    var snaps = resultsEl && Array.isArray(resultsEl._qbsDeepSearchSnaps) ? resultsEl._qbsDeepSearchSnaps : [];
    var idx = Number(resultIdx);
    var root = document.getElementById('qbs-root');

    function _open() {
      var snap = null;
      if (!isNaN(idx) && snaps[idx]) snap = snaps[idx];
      if (!snap) {
        snap = snaps.find(function(s) {
          return s && String(s.recordId || s.qbRecordId || '') === String(caseNum || '');
        }) || null;
      }
      if (!snap) return false;
      if (root && typeof root._qbcdOpen === 'function') {
        root._qbcdOpen(snap, snaps);
        return true;
      }
      if (typeof window._qbsOpenCaseDetail === 'function') {
        window._qbsOpenCaseDetail(snap, snaps);
        return true;
      }
      return false;
    }

    if (!_open()) {
      setTimeout(function() {
        if (!_open()) {
          var s = root && root.querySelector && root.querySelector('input[type="text"]');
          if (s) { s.value = '#' + caseNum; s.dispatchEvent(new Event('input',{bubbles:true})); }
        }
      }, 300);
    }
  };

  // Escape helper for deep search HTML interpolation
  function _dsEsc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // Wire Enter key on the deep search input
  (function() {
    var inp = document.getElementById('qbs-search-input');
    if (inp) {
      inp.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') window._qbsDeepSearch(inp.value, 0);
      });
    }
  })();


  // Calls /api/studio/qb_export which paginates through all QB records.
  // v2: retry-with-backoff per page — handles QB API 502/504 transient errors.
  // PAGE_SIZE reduced to 500 to stay safely under QB API timeout limits.
  // No record limit — fetches all 22,000+ cases.
  window._qbsExportAll = function(format) {
    var statusEl  = document.getElementById('qbs-export-status');
    var csvBtn    = document.getElementById('qbs-export-csv-btn');
    var xlsBtn    = document.getElementById('qbs-export-xls-btn');
    var isCsv     = format === 'csv';
    var startTime = Date.now();

    function _setStatus(html, color) { if (statusEl) { statusEl.innerHTML = html; statusEl.style.color = color || '#58a6ff'; } }
    function _setDisabled(v) { if (csvBtn) csvBtn.disabled = v; if (xlsBtn) xlsBtn.disabled = v; }
    function _esc(s) { return String(s == null ? '' : s).replace(/"/g, '\\"'); }
    function _xlEsc(s) { return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,''); }
    function _tok() {
      try {
        var raw = localStorage.getItem('mums_supabase_session') || sessionStorage.getItem('mums_supabase_session');
        if (raw) { var p = JSON.parse(raw); if (p && p.access_token) return p.access_token; }
        if (window.CloudAuth && typeof window.CloudAuth.accessToken === 'function') return window.CloudAuth.accessToken();
      } catch(_) {} return '';
    }

    // Delay helper for exponential backoff
    function _wait(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

    // Fetch one page with up to 4 retries on 502/504/network errors
    function _fetchPage(skip, pageSize, hdrs, attempt) {
      attempt = attempt || 1;
      var MAX_RETRIES = 4;
      return fetch('/api/studio/qb_export?skip=' + skip + '&top=' + pageSize, { headers: hdrs })
        .then(function(r) {
          // Always read as text first — body may not be JSON on gateway errors
          return r.text().then(function(txt) {
            var d = null;
            try { d = JSON.parse(txt); } catch(_) {}

            // 502/504/429 = transient error — retry with exponential backoff
            if ((r.status === 502 || r.status === 504 || r.status === 429 || r.status === 503) && attempt <= MAX_RETRIES) {
              var waitSec = Math.pow(2, attempt); // 2s, 4s, 8s, 16s
              _setStatus(
                '<i class="fas fa-sync fa-spin" style="margin-right:5px;"></i>' +
                'QB API timeout on page at record ' + (skip+1) +
                ' (attempt ' + attempt + '/' + MAX_RETRIES + ') — retrying in ' + waitSec + 's…',
                '#f59e0b'
              );
              return _wait(waitSec * 1000).then(function() {
                return _fetchPage(skip, pageSize, hdrs, attempt + 1);
              });
            }

            // Parse error message from response body if available
            if (!d || !d.ok) {
              var errDetail = (d && (d.message || d.error || d.detail)) || txt.slice(0, 200);
              throw new Error('QB API' + r.status + ': ' + errDetail);
            }
            return d;
          });
        })
        .catch(function(err) {
          // Network-level failure (no response at all) — also retry
          var isNet = String(err && err.name || '').indexOf('TypeError') >= 0 ||
                      String(err && err.message || '').toLowerCase().indexOf('fetch') >= 0;
          if (isNet && attempt <= MAX_RETRIES) {
            var waitSec = Math.pow(2, attempt);
            _setStatus(
              '<i class="fas fa-sync fa-spin" style="margin-right:5px;"></i>' +
              'Network error at record ' + (skip+1) +
              ' (attempt ' + attempt + '/' + MAX_RETRIES + ') — retrying in ' + waitSec + 's…',
              '#f59e0b'
            );
            return _wait(waitSec * 1000).then(function() {
              return _fetchPage(skip, pageSize, hdrs, attempt + 1);
            });
          }
          throw err;
        });
    }

    _setDisabled(true);
    _setStatus('<i class="fas fa-spinner fa-spin" style="margin-right:5px;"></i>Starting export — fetching QB settings…');

    var headers = {};
    var tok = _tok();
    if (tok) headers['Authorization'] = 'Bearer ' + tok;

    // Step 1: get QB settings — read body safely regardless of HTTP status
    fetch('/api/studio/qb_settings_global', { headers: headers })
      .then(function(r) {
        return r.text().then(function(txt) {
          var d = null; try { d = JSON.parse(txt); } catch(_) {}
          if (!r.ok || !d || !d.ok) throw new Error((d && (d.message || d.error)) || 'Settings fetch failed (HTTP ' + r.status + ')');
          return d;
        });
      })
      .then(function(resp) {
        var cfg     = (resp && resp.settings) ? resp.settings : resp;
        var realm   = cfg.realm   || '';
        var tableId = cfg.tableId || '';
        var qid     = cfg.qid     || '';
        if (!realm || !tableId || !qid) throw new Error('Studio QB not configured. Go to General Settings → Studio Quickbase Settings first.');

        // Step 2: paginated fetch — 500 records/page (safe under QB API 30s timeout)
        var allRecords = [];
        var fields     = [];
        var PAGE_SIZE  = 500;
        var skip       = 0;

        function fetchNext() {
          _setStatus(
            '<i class="fas fa-spinner fa-spin" style="margin-right:5px;"></i>' +
            'Fetching records ' + (skip + 1) + '–' + (skip + PAGE_SIZE) +
            ' (' + allRecords.length.toLocaleString() + ' loaded so far)…'
          );
          return _fetchPage(skip, PAGE_SIZE, headers, 1)
            .then(function(d) {
              if (!fields.length && d.fields) fields = d.fields;
              var batch = d.records || [];
              allRecords = allRecords.concat(batch);
              // Continue if we got a full page and haven't exceeded 100K safety cap
              if (batch.length >= PAGE_SIZE && skip < 100000) {
                skip += PAGE_SIZE;
                return fetchNext();
              }
            });
        }

        return fetchNext().then(function() { return { allRecords: allRecords, fields: fields }; });
      })
      .then(function(result) {
        var recs = result.allRecords;
        var cols = (result.fields || []).map(function(f) { return { id: String(f.id), label: String(f.label || 'Field ' + f.id) }; });
        _setStatus('<i class="fas fa-cog fa-spin" style="margin-right:5px;"></i>Building ' + format.toUpperCase() + ' file (' + recs.length.toLocaleString() + ' records)…', '#22d3ee');

        function cellVal(row, col) {
          var cell = row && row[col.id];
          return (cell && typeof cell === 'object') ? cell.value : cell;
        }

        var blob, filename, mime;
        if (isCsv) {
          var rows = [cols.map(function(c) { return '"' + _esc(c.label) + '"'; }).join(',')];
          recs.forEach(function(row) { rows.push(cols.map(function(c) { return '"' + _esc(cellVal(row,c)) + '"'; }).join(',')); });
          blob = new Blob(['\uFEFF' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
          filename = 'quickbase_all_cases_' + new Date().toISOString().slice(0,10) + '.csv';
          mime = 'text/csv';
        } else {
          var xml = ['<?xml version="1.0" encoding="UTF-8"?>',
            '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet">',
            '<Worksheet ss:Name="QB Export"><Table>',
            '<Row>' + cols.map(function(c) { return '<Cell><Data ss:Type="String">' + _xlEsc(c.label) + '</Data></Cell>'; }).join('') + '</Row>'];
          recs.forEach(function(row) {
            xml.push('<Row>' + cols.map(function(c) {
              var v = String(cellVal(row,c) == null ? '' : cellVal(row,c));
              return '<Cell><Data ss:Type="' + (!isNaN(v)&&v.trim()&&v.length<15?'Number':'String') + '">' + _xlEsc(v) + '</Data></Cell>';
            }).join('') + '</Row>');
          });
          xml.push('</Table></Worksheet></Workbook>');
          blob = new Blob(['\uFEFF' + xml.join('\n')], { type: 'application/vnd.ms-excel;charset=utf-8;' });
          filename = 'quickbase_all_cases_' + new Date().toISOString().slice(0,10) + '.xls';
          mime = 'application/vnd.ms-excel';
        }

        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function() { URL.revokeObjectURL(a.href); }, 5000);

        var elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        _setStatus(
          '<i class="fas fa-check-circle" style="margin-right:5px;"></i>' +
          recs.length.toLocaleString() + ' records exported — ' + filename + ' (' + elapsed + 's)',
          '#3fb950'
        );
        setTimeout(function() { if (statusEl) statusEl.innerHTML = ''; }, 12000);
      })
      .catch(function(e) {
        _setStatus(
          '<i class="fas fa-times-circle" style="margin-right:5px;"></i>' +
          'Export failed: ' + (e && e.message || 'Unknown error'),
          '#f85149'
        );
        console.error('[qbsExport] failed:', e);
      })
      .finally(function() { _setDisabled(false); });
  };

  // ── Connect+ tab state (BUG FIX: was missing — caused ReferenceError) ──
  var _state = {
    loaded:    false,
    loading:   false,
    all:       [],
    filtered:  [],
    page:      1,
    search:    '',
    country:   '',
    directory: '',
    sortCol:   null,
    sortDir:   1,
    modalIdx:  0,
  };
  var CSV_URL  = '';
  var PAGE_SIZE = 100;

  // ── Helper: get active CSV URL from live window var or localStorage ──
  // (BUG FIX: _getActiveCsvUrl + _normalizeCsvUrl were missing from scope)
  function _getActiveCsvUrl() {
    // Primary: live value set by CPS settings module
    if (window._cpCsvUrl) return String(window._cpCsvUrl);
    // Fallback: read directly from localStorage key used by CPS module
    try {
      var raw = localStorage.getItem('ss_connectplus_settings');
      if (raw) {
        var obj = JSON.parse(raw);
        if (obj && obj.csvUrl) return String(obj.csvUrl);
      }
    } catch (_) {}
    return '';
  }

  function _normalizeCsvUrl(raw) {
    var url = String(raw || '').trim();
    if (!url) return url;
    // Already a correct CSV export URL
    if (url.includes('output=csv')) return url;
    try {
      var u = new URL(url);
      // Case 1: /pub link missing output=csv param
      if (u.pathname.includes('/pub')) {
        u.searchParams.set('output', 'csv');
        return u.toString();
      }
      // Case 2: /pubhtml — replace with /pub?output=csv
      if (u.pathname.includes('/pubhtml')) {
        var gid2 = u.searchParams.get('gid') || '';
        u.pathname = u.pathname.replace('/pubhtml', '/pub');
        u.searchParams.set('output', 'csv');
        if (gid2) u.searchParams.set('gid', gid2);
        return u.toString();
      }
      // Case 3: /edit or /view — build export URL
      if (u.pathname.includes('/edit') || u.pathname.includes('/view')) {
        var gid3 = u.searchParams.get('gid') || '0';
        var m2 = u.pathname.match(/\/d\/([^/]+)\//);
        if (m2) {
          return 'https://docs.google.com/spreadsheets/d/' + m2[1] +
            '/export?format=csv&gid=' + gid3;
        }
      }
    } catch (_) {}
    return url;
  }

  // ── CSV parser (handles quoted fields with commas) ──────────────────
  function parseCSV(text) {
    var lines = [];
    var cur = '';
    var inQ  = false;
    var rows = [];
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (c === '"') { inQ = !inQ; cur += c; }
      else if (c === '\n' && !inQ) { rows.push(cur); cur = ''; }
      else if (c === '\r' && !inQ) {}
      else { cur += c; }
    }
    if (cur) rows.push(cur);

    return rows.map(function(row) {
      var fields = [];
      var f = ''; var q = false;
      for (var j = 0; j < row.length; j++) {
        var ch = row[j];
        if (ch === '"') {
          if (q && row[j+1] === '"') { f += '"'; j++; }
          else q = !q;
        } else if (ch === ',' && !q) { fields.push(f); f = ''; }
        else f += ch;
      }
      fields.push(f);
      return fields;
    });
  }

  function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  // ── Load CSV ────────────────────────────────────────────────────────
  window._cpInit = function() {
    if (_state.loaded || _state.loading) return;
    _cpLoad();
  };

  window._cpRefresh = function() {
    _state.loaded = false;
    _state.all = [];
    _state.filtered = [];
    _state.page = 1;
    _cpLoad();
  };

  function _cpLoad() {
    _state.loading = true;
    _setStatus('Loading…');

    var body = document.getElementById('cp-table-body');
    function _loadSettingsIfNeeded() {
      // We need both CSV URL and detected column metadata.
      // Having only _cpCsvUrl is not enough for cache schema validation.
      if (window._cpCsvUrl && Array.isArray(window._cpDetectedCols)) return Promise.resolve();

      // Fast path from local storage (no auth/network required)
      try {
        var localRaw = localStorage.getItem('ss_connectplus_settings');
        if (localRaw) {
          var localCfg = JSON.parse(localRaw);
          if (!window._cpCsvUrl && localCfg && localCfg.csvUrl) window._cpCsvUrl = localCfg.csvUrl;
          if (!Array.isArray(window._cpDetectedCols) && localCfg && Array.isArray(localCfg.detectedColumns)) {
            window._cpDetectedCols = localCfg.detectedColumns;
          }
          if (!window._cpSearchCols && localCfg && Array.isArray(localCfg.searchColumns)) {
            window._cpSearchCols = localCfg.searchColumns.length > 0 ? localCfg.searchColumns : null;
          }
        }
      } catch(_) {}

      if (window._cpCsvUrl && Array.isArray(window._cpDetectedCols)) return Promise.resolve();

      var tok = '';
      try {
        var raw = localStorage.getItem('mums_supabase_session') || sessionStorage.getItem('mums_supabase_session');
        if (raw) {
          var p = JSON.parse(raw);
          if (p && p.access_token) tok = p.access_token;
        }
        if (!tok && window.CloudAuth && typeof window.CloudAuth.accessToken === 'function') tok = window.CloudAuth.accessToken();
      } catch(_) {}
      if (!tok) return Promise.resolve(); // no token yet — caller will handle empty CSV_URL
      return fetch('/api/studio/csv_settings?type=connect_plus', {
        headers: { 'Authorization': 'Bearer ' + tok, 'Cache-Control': 'no-cache' }
      }).then(function(resp) { return resp.ok ? resp.json().catch(function(){ return null; }) : null; })
        .then(function(d) {
          if (d && d.ok && d.settings && d.settings.csvUrl) {
            window._cpCsvUrl = d.settings.csvUrl;
            window._cpSearchCols = (Array.isArray(d.settings.searchColumns) && d.settings.searchColumns.length > 0)
              ? d.settings.searchColumns : null;
            window._cpDetectedCols = Array.isArray(d.settings.detectedColumns) ? d.settings.detectedColumns : null;
          }
        })
        .catch(function() {});
    }

    // ── Cache-first: try IndexedDB before hitting network ─────────────
    var cacheAvailable = typeof window.StudioCache !== 'undefined';
    var cachePromise   = cacheAvailable
      ? window.StudioCache.getBundle('connect_plus')
      : Promise.resolve(null);

    _loadSettingsIfNeeded().then(function() {
      CSV_URL = _normalizeCsvUrl(_getActiveCsvUrl());
      return cachePromise;
    }).then(function(cached) {
      if (cached && Array.isArray(cached.data) && cached.data.length > 0) {
        // Cache schema guard:
        // older cached bundles may not include endUser key at all.
        var cacheHasEndUserKey = cached.data.some(function(row) {
          return row && Object.prototype.hasOwnProperty.call(row, 'endUser');
        });
        if (!cacheHasEndUserKey) cached = null;

        // BUG-FIX: Invalidate caches built before storeNumber was added to the data model.
        // Any cache missing the storeNumber key was built with the old schema and must be refreshed.
        if (cached) {
          var cacheHasStoreNumberKey = cached.data.some(function(row) {
            return row && Object.prototype.hasOwnProperty.call(row, 'storeNumber');
          });
          if (!cacheHasStoreNumberKey) cached = null;
        }

        // If settings detected an End User column but cache has no non-empty
        // values, treat cache as stale and force a network refresh.
        if (cached) {
          var detectedCols = Array.isArray(window._cpDetectedCols) ? window._cpDetectedCols : [];
          var expectsEndUser = detectedCols.some(function(col) {
            var k = String(col || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            return k.indexOf('enduser') >= 0 || (k.indexOf('end') >= 0 && k.indexOf('user') >= 0);
          });
          if (expectsEndUser) {
            var hasEndUserValue = cached.data.some(function(row) {
              return row && String(row.endUser || '').trim().length > 0;
            });
            if (!hasEndUserValue) cached = null;
          }
        }
      }

      if (cached && Array.isArray(cached.data) && cached.data.length > 0) {
        // ✅ Serve from cache — instant, no network
        _state.all     = cached.data;
        window.__studioCpRecords = Array.isArray(_state.all) ? _state.all.slice() : [];
        _state.loaded  = true;
        _state.loading = false;
        _buildFilterOptions();
        _cpApplyFilters();
        var lb = document.getElementById('cp-live-badge');
        if (lb) lb.style.display = '';
        var ageMin = Math.round((Date.now() - (cached.fetchedAt || 0)) / 60000);
        _setStatus('Loaded from cache (' + ageMin + 'm ago)');
        setTimeout(function() { _setStatus(''); }, 3000);
        return;
      }

      // ── No cache — load from network ─────────────────────────────
      if (!CSV_URL) {
        _state.loading = false;
        if (body) body.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:200px;gap:10px;color:var(--ss-muted);"><i class="fas fa-link-slash" style="font-size:28px;opacity:.4;"></i><div style="font-size:13px;">No CSV URL configured</div><div style="font-size:11px;opacity:.6;">Go to General Settings → Connect+ Settings</div></div>';
        _setStatus('No CSV URL configured.');
        return;
      }

      if (body) body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:200px;gap:12px;color:var(--ss-muted);"><i class="fas fa-spinner fa-spin" style="font-size:20px;opacity:.4;"></i><span style="font-size:13px;opacity:.5;">Loading Connect+ sites…</span></div>';

      fetch(CSV_URL, { cache: 'no-store' })
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function(text) {
        var rows = parseCSV(text);
        if (!rows.length) throw new Error('Empty CSV');
        var header = rows[0] || [];
        function _normHeader(v) {
          return String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        }
        function _findHeaderIndex(aliases, fallbackIndex) {
          var aliasSet = aliases.map(_normHeader);
          for (var i = 0; i < header.length; i++) {
            if (aliasSet.indexOf(_normHeader(header[i])) >= 0) return i;
          }
          return typeof fallbackIndex === 'number' ? fallbackIndex : -1;
        }
        // Header-based mapping (resilient to column order/label variations)
        // BUG-FIX: Added storeNumber (CSV index 10). Corrected endUser fallback
        // from 10→11 and endUser2 fallback from 11→12 to match actual CSV column order:
        // 0=Site,1=Directory,2=Address1,3=Country,4=City,5=State,6=Zip,7=TimeZone,
        // 8=Systems,9=URL,10=STORE NUMBER,11=END USER,12=END USER2
        var colIdx = {
          site:        _findHeaderIndex(['site'], 0),
          directory:   _findHeaderIndex(['directory'], 1),
          address1:    _findHeaderIndex(['address 1','address1','address'], 2),
          country:     _findHeaderIndex(['country'], 3),
          city:        _findHeaderIndex(['city'], 4),
          state:       _findHeaderIndex(['state/province/region','state province region','state','province','region'], 5),
          zip:         _findHeaderIndex(['zip/postal code','zip postal code','zip','postal code','postal'], 6),
          timezone:    _findHeaderIndex(['time zone','timezone'], 7),
          systems:     _findHeaderIndex(['number of control systems','control systems','systems'], 8),
          url:         _findHeaderIndex(['url connect+ link','url connect link','connect+ link','connect link','url'], 9),
          storeNumber: _findHeaderIndex(['store number','storenumber','store no','store #','store#'], 10),
          endUser:     _findHeaderIndex(['end user','enduser','client','account','customer'], 11),
          endUser2:    _findHeaderIndex(['end user2','enduser2','end user 2','client 2','account 2','customer 2'], 12)
        };

        var data = [];
        for (var i = 1; i < rows.length; i++) {
          var r = rows[i];
          if (!r || !String(r[colIdx.site] || '').trim()) continue;
          var endUser = '';
          var endUserIdxOrder = [colIdx.endUser, colIdx.endUser2];
          for (var e = 0; e < endUserIdxOrder.length; e++) {
            var euIdx = endUserIdxOrder[e];
            if (typeof euIdx !== 'number' || euIdx < 0) continue;
            var euVal = String(r[euIdx] || '').trim();
            if (euVal) { endUser = euVal; break; }
          }
          data.push({
            site:        String(r[colIdx.site]        || '').trim(),
            directory:   String(r[colIdx.directory]   || '').trim(),
            address1:    String(r[colIdx.address1]    || '').trim(),
            country:     String(r[colIdx.country]     || '').trim(),
            city:        String(r[colIdx.city]        || '').trim(),
            state:       String(r[colIdx.state]       || '').trim(),
            zip:         String(r[colIdx.zip]         || '').trim(),
            timezone:    String(r[colIdx.timezone]    || '').trim(),
            systems:     String(r[colIdx.systems]     || '').trim(),
            url:         String(r[colIdx.url]         || '').trim(),
            storeNumber: String(r[colIdx.storeNumber] || '').trim(),
            endUser:     endUser,
            // _search includes ALL text columns including STORE NUMBER — searches all 36k+ records by default
            _search:     [
              r[colIdx.site], r[colIdx.directory], r[colIdx.address1], r[colIdx.country],
              r[colIdx.city], r[colIdx.state], r[colIdx.zip], r[colIdx.timezone],
              r[colIdx.systems], r[colIdx.url], r[colIdx.storeNumber], endUser
            ].join(' ').toLowerCase(),
          });
        }
        _state.all     = data;
        window.__studioCpRecords = Array.isArray(data) ? data.slice() : [];
        _state.loaded  = true;
        _state.loading = false;
        _buildFilterOptions();
        _cpApplyFilters();
        var lb = document.getElementById('cp-live-badge');
        if (lb) lb.style.display = '';
        // ── Write to IndexedDB cache for next visit ─────────────
        if (cacheAvailable) {
          window.StudioCache.setBundle('connect_plus', data, '', data.length)
            .catch(function() {});
        }
      })
      .catch(function(e) {
        _state.loading = false;
        var body2 = document.getElementById('cp-table-body');
        if (body2) body2.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:200px;gap:10px;color:#f85149;"><i class="fas fa-exclamation-triangle" style="font-size:28px;opacity:.6;"></i><div style="font-size:13px;">Failed to load Connect+ data</div><div style="font-size:11px;opacity:.6;">' + esc(e.message) + '</div><button onclick="window._cpRefresh()" style="margin-top:8px;background:rgba(248,81,73,.1);border:1px solid rgba(248,81,73,.3);color:#f85149;padding:7px 16px;border-radius:6px;font-size:12px;font-weight:700;font-family:var(--ss-font);cursor:pointer;"><i class="fas fa-redo"></i> Retry</button></div>';
        _setStatus('Error: ' + e.message);
      });
    }); // end cachePromise.then
  }

  function _buildFilterOptions() {
    var countries = {};
    var dirs      = {};
    _state.all.forEach(function(r) {
      if (r.country) countries[r.country] = 1;
      if (r.directory) dirs[r.directory]  = 1;
    });
    var cSel = document.getElementById('cp-country-filter');
    var dSel = document.getElementById('cp-dir-filter');
    if (cSel) {
      var cOpts = Object.keys(countries).sort();
      cSel.innerHTML = '<option value="">All Countries</option>' +
        cOpts.map(function(c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');
    }
    if (dSel) {
      var dOpts = Object.keys(dirs).sort();
      dSel.innerHTML = '<option value="">All Directories</option>' +
        dOpts.map(function(d) { return '<option value="' + esc(d) + '">' + esc(d) + '</option>'; }).join('');
    }
  }

  // ── Search + Filter + Sort ──────────────────────────────────────────
  window._cpOnSearch = function(val) {
    _state.search = String(val || '').trim().toLowerCase();
    // Sync both search inputs
    var si = document.getElementById('cp-search-input');
    var sm = document.getElementById('cp-main-search');
    if (si && si.value.toLowerCase() !== _state.search) si.value = val || '';
    if (sm && sm.value.toLowerCase() !== _state.search) sm.value = val || '';
    _state.page = 1;
    _cpApplyFilters();
  };

  window._cpApplyFilters = function() {
    var cSel = document.getElementById('cp-country-filter');
    var dSel = document.getElementById('cp-dir-filter');
    _state.country   = cSel ? cSel.value : '';
    _state.directory = dSel ? dSel.value : '';

    var q = _state.search;
    // Respect active search columns from Connect+ Settings
    // window._cpSearchCols = null or empty = search ALL columns (default)
    var activeCols = (Array.isArray(window._cpSearchCols) && window._cpSearchCols.length > 0)
      ? window._cpSearchCols : null;

    var colIndexMap = { 'Site':0,'Directory':1,'Address 1':2,'Country':3,'City':4,'State/Province/Region':5,'Zip/Postal Code':6,'Time Zone':7 };
    var filtered = _state.all.filter(function(r) {
      if (_state.country   && r.country   !== _state.country)   return false;
      if (_state.directory && r.directory !== _state.directory) return false;
      if (q) {
        var haystack;
        if (!activeCols) {
          // No column filter — search all indexed fields including storeNumber
          haystack = r._search || [r.site,r.directory,r.address1,r.country,r.city,r.state,r.zip,r.timezone,r.systems,r.url,r.storeNumber,r.endUser].join(' ').toLowerCase();
        } else {
          // Build haystack from only selected columns
          haystack = activeCols.map(function(col) {
            var colKey = col.toLowerCase().replace(/[^a-z0-9]/g, '');
            // Map column name to row field
            if (colKey === 'site')                     return r.site        || '';
            if (colKey === 'directory')                return r.directory   || '';
            if (colKey.includes('address'))            return r.address1    || '';
            if (colKey === 'country')                  return r.country     || '';
            if (colKey === 'city')                     return r.city        || '';
            if (colKey.includes('state') || colKey.includes('province') || colKey.includes('region')) return r.state || '';
            if (colKey.includes('zip') || colKey.includes('postal'))     return r.zip         || '';
            if (colKey.includes('time') || colKey.includes('zone'))      return r.timezone    || '';
            if (colKey.includes('url') || colKey.includes('connect') || colKey.includes('link')) return r.url || '';
            if (colKey.includes('system') || colKey.includes('control')) return r.systems     || '';
            // BUG-FIX: map STORE NUMBER column to storeNumber field
            if (colKey === 'storenumber' || colKey.includes('store'))    return r.storeNumber || '';
            if (colKey.includes('enduser') || (colKey.includes('end') && colKey.includes('user')) ||
                colKey.includes('client') || colKey.includes('account') || colKey.includes('customer')) return r.endUser || '';
            // Fallback: try index map
            var idx = colIndexMap[col];
            if (idx != null) {
              var fields = [r.site,r.directory,r.address1,r.country,r.city,r.state,r.zip,r.timezone];
              return fields[idx] || '';
            }
            return '';
          }).join(' ').toLowerCase();
        }
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    // Sort
    if (_state.sortCol) {
      var col = _state.sortCol;
      var dir = _state.sortDir;
      filtered.sort(function(a, b) {
        var av = String(a[col] || '').toLowerCase();
        var bv = String(b[col] || '').toLowerCase();
        return av < bv ? -dir : av > bv ? dir : 0;
      });
    }

    _state.filtered = filtered;
    _state.page = 1;
    _cpRender();
  };

  window._cpSort = function(col) {
    if (_state.sortCol === col) _state.sortDir *= -1;
    else { _state.sortCol = col; _state.sortDir = 1; }
    document.querySelectorAll('[id^="cp-sort-"]').forEach(function(el) {
      el.className = 'fas fa-sort'; el.style.opacity = '.3';
    });
    var icon = document.getElementById('cp-sort-' + col);
    if (icon) {
      icon.className = 'fas fa-sort-' + (_state.sortDir > 0 ? 'up' : 'down');
      icon.style.opacity = '1';
      icon.style.color = '#22d3ee';
    }
    _cpApplyFilters();
  };

  // ── Render table ────────────────────────────────────────────────────
  function _cpRender() {
    var total    = _state.filtered.length;
    var page     = _state.page;
    var maxPage  = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (page > maxPage) page = _state.page = 1;
    var start = (page - 1) * PAGE_SIZE;
    var end   = Math.min(start + PAGE_SIZE, total);
    var rows  = _state.filtered.slice(start, end);

    // Update counts
    var cnt = document.getElementById('cp-record-count');
    if (cnt) cnt.textContent = total.toLocaleString() + ' site' + (total !== 1 ? 's' : '');
    var sc = document.getElementById('cp-search-count');
    if (sc) sc.textContent = _state.search
      ? (total.toLocaleString() + ' of ' + _state.all.length.toLocaleString())
      : (_state.all.length.toLocaleString() + ' total');

    _setStatus('');

    var body = document.getElementById('cp-table-body');
    if (!body) return;

    if (!total) {
      body.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:200px;gap:10px;color:var(--ss-muted);"><i class="fas fa-search" style="font-size:28px;opacity:.2;"></i><div style="font-size:13px;opacity:.5;">No sites match your search.</div></div>';
      document.getElementById('cp-pagination').style.display = 'none';
      _cpSyncHeadScrollbarGap();
      return;
    }

    // Build table — HD Premium rows
    var html = '<table class="prem-table cyan" style="width:100%;min-width:1020px;">';
    html += '<tbody>';
    rows.forEach(function(row, i) {
      var globalIdx = start + i;
      var rowBg = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,.012)';
      html += '<tr data-cp-idx="' + globalIdx + '" style="background:' + rowBg + ';cursor:pointer;" ' +
        'onclick="window._cpOpenDetail(' + globalIdx + ')" ' +
        'onmouseover="this.querySelectorAll(\'td\').forEach(function(t){t.style.background=\'rgba(34,211,238,.04)\'})" ' +
        'onmouseout="this.querySelectorAll(\'td\').forEach(function(t){t.style.background=\'\'});">';
      html += '<td style="padding:6px 11px;border-bottom:1px solid rgba(255,255,255,.025);color:var(--ss-muted);font-size:10px;width:38px;">' + (start + i + 1) + '</td>';
      html += '<td style="padding:6px 11px;border-bottom:1px solid rgba(255,255,255,.025);"><span class="cp-site-link">' + esc(row.site) + '</span></td>';
      html += '<td style="padding:6px 11px;border-bottom:1px solid rgba(255,255,255,.025);color:var(--ss-text);">' + esc(row.directory) + '</td>';
      html += '<td style="padding:6px 11px;border-bottom:1px solid rgba(255,255,255,.025);color:var(--ss-text);">' + esc(row.city) + '</td>';
      html += '<td style="padding:6px 11px;border-bottom:1px solid rgba(255,255,255,.025);color:var(--ss-muted);">' + esc(row.state) + '</td>';
      html += '<td style="padding:6px 11px;border-bottom:1px solid rgba(255,255,255,.025);color:var(--ss-text);">' + esc(row.country) + '</td>';
      html += '<td style="padding:6px 11px;border-bottom:1px solid rgba(255,255,255,.025);color:var(--ss-muted);font-size:10px;">' + esc(row.timezone) + '</td>';
      html += '<td style="padding:6px 11px;border-bottom:1px solid rgba(255,255,255,.025);color:var(--ss-text);">' + esc(row.endUser || '—') + '</td>';
      html += '<td style="padding:6px 11px;border-bottom:1px solid rgba(255,255,255,.025);text-align:center;"><span class="cp-sys-badge">' + esc(row.systems || '—') + '</span></td>';
      html += '<td style="padding:6px 11px;border-bottom:1px solid rgba(255,255,255,.025);">';
      if (row.url) {
        html += '<a href="' + esc(row.url) + '" target="_blank" rel="noopener noreferrer" ' +
          'onclick="event.stopPropagation()" class="cp-open-btn">' +
          '<i class="fas fa-external-link-alt" style="font-size:8px;"></i> Open</a>';
      }
      html += '</td></tr>';
    });
    html += '</tbody></table>';
    body.innerHTML = html;
    _cpSyncHeadScrollbarGap();

    _renderPagination(total, maxPage);
  }

  function _cpSyncHeadScrollbarGap() {
    var bodyEl = document.getElementById('cp-table-body');
    var headWrap = document.getElementById('cp-table-head-wrap');
    if (!bodyEl || !headWrap) return;
    var scrollbarW = Math.max(0, bodyEl.offsetWidth - bodyEl.clientWidth);
    headWrap.style.paddingRight = scrollbarW ? (scrollbarW + 'px') : '';
  }

  function _renderPagination(total, maxPage) {
    var pg = document.getElementById('cp-pagination');
    if (!pg) return;
    if (maxPage <= 1 && total <= PAGE_SIZE) { pg.style.display = 'none'; return; }
    pg.style.display = 'flex';
    var page = _state.page;
    var start = (page - 1) * PAGE_SIZE + 1;
    var end   = Math.min(page * PAGE_SIZE, total);
    var info  = document.getElementById('cp-page-info');
    if (info) info.textContent = 'Showing ' + start.toLocaleString() + '–' + end.toLocaleString() + ' of ' + total.toLocaleString() + ' sites';
    var prevBtn = document.getElementById('cp-prev-btn');
    var nextBtn = document.getElementById('cp-next-btn');
    if (prevBtn) { prevBtn.disabled = page <= 1; prevBtn.style.opacity = page <= 1 ? '.4' : '1'; }
    if (nextBtn) { nextBtn.disabled = page >= maxPage; nextBtn.style.opacity = page >= maxPage ? '.4' : '1'; }
    var btnContainer = document.getElementById('cp-page-btns');
    if (btnContainer) {
      var pages = [];
      for (var p = Math.max(1, page - 2); p <= Math.min(maxPage, page + 2); p++) pages.push(p);
      btnContainer.innerHTML = pages.map(function(p) {
        return '<button onclick="window._cpGoPage(' + p + ')" class="prem-page-num ' + (p === page ? 'cyan' : '') + '" ' +
          (p !== page ? 'style="border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:var(--ss-muted);"' : '') +
          '>' + p + '</button>';
      }).join('');
    }
  }

  window._cpChangePage = function(delta) {
    var maxPage = Math.max(1, Math.ceil(_state.filtered.length / PAGE_SIZE));
    _state.page = Math.max(1, Math.min(_state.page + delta, maxPage));
    _cpRender();
    var body = document.getElementById('cp-table-body');
    if (body) body.scrollTop = 0;
  };
  window._cpGoPage = function(p) {
    _state.page = p;
    _cpRender();
    var body2 = document.getElementById('cp-table-body');
    if (body2) body2.scrollTop = 0;
  };

  window.addEventListener('resize', function() {
    _cpSyncHeadScrollbarGap();
  });

  // ── Detail Modal ────────────────────────────────────────────────────
  window._cpOpenDetail = function(idx) {
    var row = _state.filtered[idx];
    if (!row) return;
    _state.modalIdx = idx;
    _cpPopulateModal(row, idx);
    var m = document.getElementById('cp-detail-modal');
    if (m) {
      m.style.display = 'flex';
      if (m.parentElement !== document.body) document.body.appendChild(m);
    }
    try { document.body.classList.add('modal-open'); } catch(_) {}
  };

  function _cpPopulateModal(row, idx) {
    function set(id, v) { var el = document.getElementById(id); if (el) el.textContent = v || '—'; }
    var total = _state.filtered.length;
    set('cp-modal-site',      row.site);
    set('cp-modal-address',   [row.address1, row.city, row.state, row.zip].filter(Boolean).join(', '));
    set('cp-modal-country',   row.country);
    set('cp-modal-directory', row.directory);
    set('cp-modal-timezone',  row.timezone);
    set('cp-modal-systems',   row.systems || '0');
    set('cp-modal-city',      row.city);
    set('cp-modal-state',     row.state);
    set('cp-modal-zip',       row.zip);
    set('cp-modal-addr1',     row.address1);
    set('cp-modal-pos',       (idx + 1) + ' of ' + total.toLocaleString());

    var urlEl = document.getElementById('cp-modal-url');
    var urlTx = document.getElementById('cp-modal-url-text');
    if (urlEl) {
      if (row.url) {
        urlEl.href = row.url;
        urlEl.style.display = 'inline-flex';
        if (urlTx) urlTx.textContent = row.url;
      } else {
        urlEl.style.display = 'none';
      }
    }

    var prev = document.getElementById('cp-modal-prev');
    var next = document.getElementById('cp-modal-next');
    if (prev) prev.disabled = idx <= 0;
    if (next) next.disabled = idx >= total - 1;
  }

  window._cpModalNav = function(dir) {
    var next = _state.modalIdx + dir;
    if (next < 0 || next >= _state.filtered.length) return;
    _state.modalIdx = next;
    _cpPopulateModal(_state.filtered[next], next);
  };

  window._cpCloseModal = function() {
    var m = document.getElementById('cp-detail-modal');
    if (m) m.style.display = 'none';
    try { if (!document.querySelector('.modal.open')) document.body.classList.remove('modal-open'); } catch(_) {}
  };

  // Keyboard nav + escape for modal
  document.addEventListener('keydown', function(e) {
    var m = document.getElementById('cp-detail-modal');
    if (!m || m.style.display === 'none') return;
    if (e.key === 'Escape')     window._cpCloseModal();
    if (e.key === 'ArrowLeft')  window._cpModalNav(-1);
    if (e.key === 'ArrowRight') window._cpModalNav(1);
  });
  // Backdrop click — guard against null when modal not yet in DOM
  (function() {
    var _modal = document.getElementById('cp-detail-modal');
    if (_modal) {
      _modal.addEventListener('click', function(e) {
        if (e.target === this) window._cpCloseModal();
      });
    }
  })();

  // ── CSV Export ──────────────────────────────────────────────────────
  window._cpExportCsv = function() {
    var rows = _state.filtered;
    if (!rows.length) { alert('No data to export.'); return; }
    var header = ['Site','Directory','Address 1','Country','City','State/Province/Region','Zip/Postal Code','Time Zone','End User','Number of Control Systems','URL CONNECT+ LINK'];
    var csv = [header].concat(rows.map(function(r) {
      return [r.site,r.directory,r.address1,r.country,r.city,r.state,r.zip,r.timezone,r.endUser,r.systems,r.url].map(function(v) {
        return '"' + String(v||'').replace(/"/g,'""') + '"';
      });
    })).map(function(r) { return r.join ? r.join(',') : r; }).join('\n');
    var a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = 'connect_plus_sites_' + new Date().toISOString().slice(0,10) + '.csv';
    a.click();
  };

  function _setStatus(msg) {
    var el = document.getElementById('cp-status');
    if (el) el.textContent = msg;
  }

})();
