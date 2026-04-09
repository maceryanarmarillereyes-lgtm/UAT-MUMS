/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

/* ═══════════════════════════════════════════════════════════════════
   STUDIO SETTINGS PRE-LOADER
   Pre-fetches Connect+ and Part Number CSV settings from DB
   immediately after auth is confirmed (mums:authtoken event).
   This ensures window._cpCsvUrl and window._pnCsvUrl are populated
   BEFORE any tab is clicked, so all users/devices see data on load.
   Also retries on tab refocus (visibilitychange).
═══════════════════════════════════════════════════════════════════ */
(function() {
  'use strict';

  var _preloaded  = false;
  var _preloading = false;

  function _getApiTok() {
    try {
      var raw = localStorage.getItem('mums_supabase_session') || sessionStorage.getItem('mums_supabase_session');
      if (raw) { var p = JSON.parse(raw); if (p && p.access_token) return p.access_token; }
      if (window.CloudAuth && typeof window.CloudAuth.accessToken === 'function') {
        return window.CloudAuth.accessToken() || '';
      }
    } catch(_) {}
    return '';
  }

  function preloadSettings() {
    if (_preloading) return;
    var tok = _getApiTok();
    if (!tok) return;
    _preloading = true;

    var headers = { 'Authorization': 'Bearer ' + tok, 'Cache-Control': 'no-cache' };

    var p1 = fetch('/api/studio/csv_settings?type=connect_plus', { headers: headers })
      .then(function(r) { return r.ok ? r.json().catch(function() { return null; }) : null; })
      .then(function(d) {
        if (d && d.ok && d.settings && d.settings.csvUrl) {
          window._cpCsvUrl    = d.settings.csvUrl;
          window._cpSearchCols = (Array.isArray(d.settings.searchColumns) && d.settings.searchColumns.length > 0)
            ? d.settings.searchColumns : null;
        }
      }).catch(function() {});

    var p2 = fetch('/api/studio/csv_settings?type=parts_number', { headers: headers })
      .then(function(r) { return r.ok ? r.json().catch(function() { return null; }) : null; })
      .then(function(d) {
        if (d && d.ok && d.settings && d.settings.csvUrl) {
          window._pnCsvUrl    = d.settings.csvUrl;
          window._pnSearchCols = (Array.isArray(d.settings.searchColumns) && d.settings.searchColumns.length > 0)
            ? d.settings.searchColumns : null;
        }
      }).catch(function() {});

    var p3 = fetch('/api/studio/csv_settings?type=contact_information', { headers: headers })
      .then(function(r) { return r.ok ? r.json().catch(function() { return null; }) : null; })
      .then(function(d) {
        if (d && d.ok && d.settings && d.settings.csvUrl) {
          window._ctiCsvUrl    = d.settings.csvUrl;
          window._ctiSearchCols = (Array.isArray(d.settings.searchColumns) && d.settings.searchColumns.length > 0)
            ? d.settings.searchColumns : null;
        }
      }).catch(function() {});

    Promise.all([p1, p2, p3]).then(function() {
      _preloaded  = true;
      _preloading = false;
    }).catch(function() { _preloading = false; });
  }

  // PRIMARY TRIGGER: fire as soon as CloudAuth emits a valid token
  window.addEventListener('mums:authtoken', function() {
    setTimeout(preloadSettings, 150);
  });

  // FALLBACK: if mums:authtoken already fired before this script ran
  if (document.readyState !== 'loading') {
    setTimeout(function() { if (!_preloaded) preloadSettings(); }, 600);
  } else {
    document.addEventListener('DOMContentLoaded', function() {
      setTimeout(function() { if (!_preloaded) preloadSettings(); }, 800);
    });
  }

  // RETRY: when user switches back to this tab
  document.addEventListener('visibilitychange', function() {
    if (!document.hidden && !_preloaded) {
      setTimeout(preloadSettings, 300);
    }
  });

  // EXPOSE for manual re-trigger (called after Save settings to force refresh on other tabs)
  window._preloadStudioSettings = function() {
    _preloaded  = false;
    _preloading = false;
    preloadSettings();
  };

})();

/* ═══════════════════════════════════════════════════════════════════
   STUDIO QB SETTINGS — General Settings > Studio Quickbase Settings
   Fully isolated: reads/writes /api/studio/qb_settings only.
═══════════════════════════════════════════════════════════════════ */
(function() {
  'use strict';

  // ── Token helper ──────────────────────────────────────────────────
  function sqbGetToken() {
    try {
      // Primary: CloudAuth session (mums_supabase_session) — same key as cloud_auth.js LS_SESSION
      var sessionKeys = ['mums_supabase_session'];
      for (var i = 0; i < sessionKeys.length; i++) {
        var raw = localStorage.getItem(sessionKeys[i]) || sessionStorage.getItem(sessionKeys[i]);
        if (raw) {
          try {
            var parsed = JSON.parse(raw);
            var t = parsed && (parsed.access_token || (parsed.session && parsed.session.access_token));
            if (t) return String(t);
          } catch(_) {}
        }
      }
      // Fallback: CloudAuth in-memory via window.CloudAuth
      if (window.CloudAuth && typeof window.CloudAuth.accessToken === 'function') {
        var t2 = window.CloudAuth.accessToken();
        if (t2) return t2;
      }
      // Fallback: Auth via window.Auth
      if (window.Auth && typeof window.Auth.getSession === 'function') {
        var s = window.Auth.getSession();
        var t3 = s && s.access_token;
        if (t3) return String(t3);
      }
      // Legacy fallbacks
      var legacyKeys = ['mums_access_token','sb-access-token','supabase.auth.token'];
      for (var j = 0; j < legacyKeys.length; j++) {
        var v = localStorage.getItem(legacyKeys[j]);
        if (v) return v;
      }
    } catch(_) {}
    return '';
  }

  function sqbFetch(url, opts) {
    var tok = sqbGetToken();
    var headers = Object.assign({ 'Content-Type': 'application/json' }, (opts && opts.headers) || {});
    if (tok) headers['Authorization'] = 'Bearer ' + tok;
    return fetch(url, Object.assign({}, opts || {}, { headers: headers }));
  }

  // ── Tab switcher ──────────────────────────────────────────────────
  window._sqbSwitchTab = function(tabId) {
    document.querySelectorAll('.sqb-tab').forEach(function(btn) {
      var active = btn.dataset.sqbTab === tabId;
      btn.style.borderBottomColor = active ? '#58a6ff' : 'transparent';
      btn.style.color = active ? '#58a6ff' : 'var(--ss-muted)';
    });
    ['report-config','custom-columns','filter-config'].forEach(function(id) {
      var el = document.getElementById('sqb-panel-' + id);
      if (el) el.style.display = id === tabId ? 'block' : 'none';
    });
    if (tabId === 'custom-columns') window._sqbLoadColumns();
    if (tabId === 'filter-config')  window._sqbRenderFilters();
  };

  // ── URL parser ────────────────────────────────────────────────────
  function sqbParseLink(url) {
    var out = { realm: '', tableId: '', qid: '' };
    if (!url) return out;
    try {
      var u = new URL(url);
      var host = u.hostname;
      var m = host.match(/^([a-z0-9-]+)\.quickbase\.com$/i);
      if (m) out.realm = m[1];
      var segs = u.pathname.split('/').filter(Boolean);
      var ti = segs.indexOf('table');
      if (ti >= 0 && segs[ti+1]) out.tableId = segs[ti+1];
      if (!out.tableId) {
        var di = segs.indexOf('db');
        if (di >= 0 && segs[di+1]) out.tableId = segs[di+1];
      }
      var qRaw = u.searchParams.get('qid') || '';
      var qm = qRaw.match(/-?\d+/);
      if (qm) out.qid = qm[0];
      if (!out.qid) {
        var rm = url.match(/[?&]qid=(-?\d+)/i);
        if (rm) out.qid = rm[1];
      }
    } catch(_) {}
    return out;
  }

  // ── Auto-fill (on URL input AND on load) ──────────────────────────
  window._sqbAutoFill = function(val) {
    var p = sqbParseLink(val);
    var el = function(id) { return document.getElementById(id); };
    if (p.realm   && el('sqb-realm'))    el('sqb-realm').value    = p.realm;
    if (p.tableId && el('sqb-table-id')) el('sqb-table-id').value = p.tableId;
    if (p.qid     && el('sqb-qid'))      el('sqb-qid').value      = p.qid;
  };

  // ── Load settings from server ─────────────────────────────────────
  window._sqbLoadSettings = function() {
    sqbFetch('/api/studio/qb_settings')
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (!d.ok) return;
        var s = d.settings || {};
        var el = function(id) { return document.getElementById(id); };
        var rl = s.reportLink || '';
        if (el('sqb-report-link')) el('sqb-report-link').value = rl;

        // Always populate parsed fields — use stored values first, fallback to parse
        var realm   = s.realm   || '';
        var tableId = s.tableId || '';
        var qid     = s.qid     || '';

        // If stored realm/tableId/qid are empty, parse from reportLink
        if (rl && (!realm || !tableId || !qid)) {
          var parsed = sqbParseLink(rl);
          if (!realm   && parsed.realm)   realm   = parsed.realm;
          if (!tableId && parsed.tableId) tableId = parsed.tableId;
          if (!qid     && parsed.qid)     qid     = parsed.qid;
        }

        if (el('sqb-realm'))    el('sqb-realm').value    = realm;
        if (el('sqb-table-id')) el('sqb-table-id').value = tableId;
        if (el('sqb-qid'))      el('sqb-qid').value      = qid;

        var hint = el('sqb-token-hint');
        if (s.qbTokenSet) {
          if (el('sqb-token')) el('sqb-token').placeholder = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';
          if (hint) hint.textContent = '\u2713 Token saved. Enter a new value to replace.';
        } else {
          if (hint) hint.textContent = 'Token not set. Enter your QB User Token.';
        }

        // Store customColumns / filterConfig for other tabs
        window._sqbState = window._sqbState || {};
        window._sqbState.customColumns = Array.isArray(s.customColumns) ? s.customColumns : [];
        window._sqbState.filterConfig  = Array.isArray(s.filterConfig)  ? s.filterConfig  : [];
        window._sqbState.filterMatch   = s.filterMatch || 'ALL';
      }).catch(function() {});
  };

  // ── Save Report Config ────────────────────────────────────────────
  window._sqbSaveSettings = function() {
    var el = function(id) { return document.getElementById(id); };
    var msg = el('sqb-save-msg');
    var btn = el('sqb-save-btn');
    var tokenVal = el('sqb-token') ? el('sqb-token').value.trim() : '';
    var rl = el('sqb-report-link') ? el('sqb-report-link').value.trim() : '';
    var realm   = el('sqb-realm')    ? el('sqb-realm').value.trim()    : '';
    var tableId = el('sqb-table-id') ? el('sqb-table-id').value.trim() : '';
    var qid     = el('sqb-qid')      ? el('sqb-qid').value.trim()      : '';

    // Auto-parse realm/tableId/qid from URL if fields are empty
    if (rl && (!realm || !tableId || !qid)) {
      var p = sqbParseLink(rl);
      if (!realm   && p.realm)   { realm = p.realm;     if (el('sqb-realm'))    el('sqb-realm').value    = realm;   }
      if (!tableId && p.tableId) { tableId = p.tableId; if (el('sqb-table-id')) el('sqb-table-id').value = tableId; }
      if (!qid     && p.qid)     { qid = p.qid;         if (el('sqb-qid'))      el('sqb-qid').value      = qid;     }
    }

    var body = {
      reportLink: rl,
      realm:      realm,
      tableId:    tableId,
      qid:        qid,
      qbToken:    tokenVal || '__QB_TOKEN_SAVED__',
    };
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving\u2026';
      btn.style.opacity = '.7';
    }
    sqbFetch('/api/studio/qb_settings', { method: 'POST', body: JSON.stringify(body) })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (!d.ok) throw new Error(d.error || 'Save failed');
        if (tokenVal && el('sqb-token')) {
          el('sqb-token').value = '';
          el('sqb-token').placeholder = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';
          var hint = el('sqb-token-hint');
          if (hint) hint.textContent = '\u2713 Token saved. Enter a new value to replace.';
        }
        if (msg) {
          msg.textContent = '\u2713 Studio QB Settings saved!';
          msg.style.cssText = 'font-size:11px;color:#3fb950;opacity:1;font-weight:600;';
          clearTimeout(msg._t);
          msg._t = setTimeout(function() { msg.style.opacity = '0'; }, 4000);
        }
        if (typeof window._qbsReset === 'function') window._qbsReset();
      })
      .catch(function(e) {
        if (msg) {
          msg.textContent = '\u2717 ' + (e && e.message || 'Save failed');
          msg.style.cssText = 'font-size:11px;color:#f85149;opacity:1;font-weight:600;';
        }
      })
      .finally(function() {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<i class="fas fa-save"></i> Save Studio QB Settings';
          btn.style.opacity = '1';
        }
      });
  };

  // ── Test Connection ───────────────────────────────────────────────
  window._sqbTestSettings = function() {
    if (typeof window._qbsReset === 'function') window._qbsReset();
    var qbsTab = document.querySelector('[data-tab="qbs"]');
    if (qbsTab) qbsTab.click();
  };

  // ── Custom Columns tab ────────────────────────────────────────────
  window._sqbState = window._sqbState || {};

  window._sqbLoadColumns = function() {
    var avail = document.getElementById('sqb-col-available');
    var sel   = document.getElementById('sqb-col-selected');
    if (!avail || !sel) return;

    var allFields  = window._sqbState.allFields  || [];
    var selCols    = window._sqbState.customColumns || [];

    if (!allFields.length) {
      // Try to load from QBS page state
      if (window.__mumsQbRecords && window.__mumsQbRecords.columns) {
        allFields = window.__mumsQbRecords.columns.map(function(c) {
          return { id: Number(c.id), label: c.label };
        });
        window._sqbState.allFields = allFields;
      }
    }

    if (!allFields.length) {
      avail.innerHTML = '<div style="padding:12px;font-size:11px;color:var(--ss-muted);text-align:center;"><i class="fas fa-info-circle" style="margin-right:5px;"></i>Go to QuickBase_S tab and click Reload to populate fields.</div>';
    } else {
      var selectedSet = new Set(selCols.map(String));
      avail.innerHTML = allFields.filter(function(f) {
        return !selectedSet.has(String(f.id));
      }).map(function(f) {
        return '<div onclick="window._sqbSelectCol(' + f.id + ',\'' + f.label.replace(/'/g,"\\'") + '\')" class="sqb-col-item" style="padding:6px 10px;border-radius:5px;cursor:pointer;font-size:11px;color:var(--ss-text);display:flex;align-items:center;gap:6px;transition:background .12s;">' +
          '<span style="color:#58a6ff;font-size:9px;font-weight:800;">+</span> ' + f.label +
          '</div>';
      }).join('') || '<div style="padding:8px;font-size:11px;color:var(--ss-muted);text-align:center;">All fields selected.</div>';
    }

    window._sqbRenderSelectedCols();
  };

  window._sqbRenderSelectedCols = function() {
    var sel = document.getElementById('sqb-col-selected');
    var cnt = document.getElementById('sqb-col-count');
    var cols = window._sqbState.customColumns || [];
    var allFields = window._sqbState.allFields || [];
    var byId = {};
    allFields.forEach(function(f) { byId[String(f.id)] = f.label; });
    if (cnt) cnt.textContent = cols.length ? '(' + cols.length + ')' : '';
    if (!sel) return;
    if (!cols.length) {
      sel.innerHTML = '<div style="padding:8px;font-size:11px;color:var(--ss-muted);text-align:center;">No columns selected — using report defaults.</div>';
      return;
    }
    sel.innerHTML = cols.map(function(id, idx) {
      var label = byId[String(id)] || 'Field #' + id;
      return '<div style="padding:6px 10px;border-radius:5px;font-size:11px;color:var(--ss-text);display:flex;align-items:center;gap:6px;background:rgba(88,166,255,.06);border:1px solid rgba(88,166,255,.12);margin-bottom:2px;">' +
        '<span style="color:#58a6ff;font-size:9px;font-weight:800;cursor:ns-resize;">⠿</span>' +
        '<span style="flex:1;">' + label + '</span>' +
        '<span onclick="window._sqbDeselectCol(' + id + ')" style="color:var(--ss-muted);cursor:pointer;font-size:10px;padding:0 3px;" title="Remove">✕</span>' +
        '</div>';
    }).join('');
  };

  window._sqbSelectCol = function(id, label) {
    window._sqbState.customColumns = window._sqbState.customColumns || [];
    if (window._sqbState.customColumns.indexOf(Number(id)) === -1) {
      window._sqbState.customColumns.push(Number(id));
    }
    window._sqbLoadColumns();
  };

  window._sqbDeselectCol = function(id) {
    window._sqbState.customColumns = (window._sqbState.customColumns || []).filter(function(c) { return c !== Number(id); });
    window._sqbLoadColumns();
  };

  window._sqbFilterColumns = function(term) {
    var avail = document.getElementById('sqb-col-available');
    if (!avail) return;
    var allFields = window._sqbState.allFields || [];
    var selCols = window._sqbState.customColumns || [];
    var selectedSet = new Set(selCols.map(String));
    var filtered = term
      ? allFields.filter(function(f) { return f.label.toLowerCase().includes(term.toLowerCase()) && !selectedSet.has(String(f.id)); })
      : allFields.filter(function(f) { return !selectedSet.has(String(f.id)); });
    avail.innerHTML = filtered.map(function(f) {
      return '<div onclick="window._sqbSelectCol(' + f.id + ',\'' + f.label.replace(/'/g,"\\'") + '\')" class="sqb-col-item" style="padding:6px 10px;border-radius:5px;cursor:pointer;font-size:11px;color:var(--ss-text);display:flex;align-items:center;gap:6px;transition:background .12s;">' +
        '<span style="color:#58a6ff;font-size:9px;font-weight:800;">+</span> ' + f.label + '</div>';
    }).join('') || '<div style="padding:8px;font-size:11px;color:var(--ss-muted);text-align:center;">No results.</div>';
  };

  window._sqbSaveColumns = function() {
    var msg = document.getElementById('sqb-col-msg');
    var cols = window._sqbState.customColumns || [];
    sqbFetch('/api/studio/qb_settings', {
      method: 'POST',
      body: JSON.stringify({
        reportLink: (document.getElementById('sqb-report-link') || {}).value || '',
        realm:      (document.getElementById('sqb-realm')       || {}).value || '',
        tableId:    (document.getElementById('sqb-table-id')    || {}).value || '',
        qid:        (document.getElementById('sqb-qid')         || {}).value || '',
        qbToken:    '__QB_TOKEN_SAVED__',
        customColumns: cols,
        filterConfig:  window._sqbState.filterConfig || [],
        filterMatch:   window._sqbState.filterMatch  || 'ALL',
      })
    }).then(function(r) { return r.json(); }).then(function(d) {
      if (!d.ok) throw new Error(d.error || 'Save failed');
      if (msg) { msg.textContent = '\u2713 Columns saved!'; msg.style.cssText = 'font-size:11px;color:#3fb950;opacity:1;font-weight:600;'; clearTimeout(msg._t); msg._t = setTimeout(function() { msg.style.opacity='0'; }, 3000); }
      if (typeof window._qbsReset === 'function') window._qbsReset();
    }).catch(function(e) {
      if (msg) { msg.textContent = '\u2717 ' + e.message; msg.style.cssText = 'font-size:11px;color:#f85149;opacity:1;'; }
    });
  };

  window._sqbClearColumns = function() {
    window._sqbState.customColumns = [];
    window._sqbRenderSelectedCols();
    window._sqbLoadColumns();
  };

  // ── Filter Config tab ─────────────────────────────────────────────
  window._sqbRenderFilters = function() {
    var container = document.getElementById('sqb-filter-rows');
    var matchEl   = document.getElementById('sqb-filter-match');
    if (!container) return;
    var filters = window._sqbState.filterConfig || [];
    if (matchEl) matchEl.value = window._sqbState.filterMatch || 'ALL';

    if (!filters.length) {
      container.innerHTML = '<div style="font-size:11px;color:var(--ss-muted);padding:8px 0;">No filters configured.</div>';
      return;
    }
    container.innerHTML = filters.map(function(f, idx) {
      return '<div style="display:flex;gap:8px;align-items:center;background:var(--ss-surface3);border:1px solid var(--ss-border);border-radius:7px;padding:8px 10px;">' +
        '<input type="number" value="' + (f.fieldId || '') + '" placeholder="Field ID" onchange="window._sqbUpdateFilter(' + idx + ',\'fieldId\',this.value)" style="width:80px;background:var(--ss-bg);border:1px solid var(--ss-border);border-radius:5px;color:var(--ss-text);padding:5px 8px;font-size:11px;font-family:var(--ss-font);">' +
        '<select onchange="window._sqbUpdateFilter(' + idx + ',\'operator\',this.value)" style="background:var(--ss-bg);border:1px solid var(--ss-border);border-radius:5px;color:var(--ss-text);padding:5px 8px;font-size:11px;font-family:var(--ss-font);">' +
          ['EX','XEX','CT','XCT'].map(function(op) { return '<option value="' + op + '"' + (f.operator === op ? ' selected' : '') + '>' + op + '</option>'; }).join('') +
        '</select>' +
        '<input type="text" value="' + ((f.value || '') + '').replace(/"/g,'&quot;') + '" placeholder="Value" onchange="window._sqbUpdateFilter(' + idx + ',\'value\',this.value)" style="flex:1;background:var(--ss-bg);border:1px solid var(--ss-border);border-radius:5px;color:var(--ss-text);padding:5px 8px;font-size:11px;font-family:var(--ss-font);">' +
        '<button onclick="window._sqbRemoveFilter(' + idx + ')" style="background:rgba(248,81,73,.08);border:1px solid rgba(248,81,73,.2);border-radius:5px;color:#f85149;padding:4px 8px;cursor:pointer;font-size:10px;">✕</button>' +
        '</div>';
    }).join('');
  };

  window._sqbAddFilter = function() {
    window._sqbState.filterConfig = window._sqbState.filterConfig || [];
    window._sqbState.filterConfig.push({ fieldId: '', operator: 'XEX', value: '' });
    window._sqbRenderFilters();
  };
  window._sqbRemoveFilter = function(idx) {
    (window._sqbState.filterConfig || []).splice(idx, 1);
    window._sqbRenderFilters();
  };
  window._sqbUpdateFilter = function(idx, key, val) {
    if (window._sqbState.filterConfig && window._sqbState.filterConfig[idx]) {
      window._sqbState.filterConfig[idx][key] = key === 'fieldId' ? Number(val) : val;
    }
  };

  window._sqbSaveFilters = function() {
    var msg = document.getElementById('sqb-filter-msg');
    var matchEl = document.getElementById('sqb-filter-match');
    if (matchEl) window._sqbState.filterMatch = matchEl.value;
    sqbFetch('/api/studio/qb_settings', {
      method: 'POST',
      body: JSON.stringify({
        reportLink: (document.getElementById('sqb-report-link') || {}).value || '',
        realm:      (document.getElementById('sqb-realm')       || {}).value || '',
        tableId:    (document.getElementById('sqb-table-id')    || {}).value || '',
        qid:        (document.getElementById('sqb-qid')         || {}).value || '',
        qbToken:    '__QB_TOKEN_SAVED__',
        customColumns: window._sqbState.customColumns || [],
        filterConfig:  window._sqbState.filterConfig  || [],
        filterMatch:   window._sqbState.filterMatch   || 'ALL',
      })
    }).then(function(r) { return r.json(); }).then(function(d) {
      if (!d.ok) throw new Error(d.error || 'Save failed');
      if (msg) { msg.textContent = '\u2713 Filters saved!'; msg.style.cssText = 'font-size:11px;color:#3fb950;opacity:1;font-weight:600;'; clearTimeout(msg._t); msg._t = setTimeout(function() { msg.style.opacity='0'; }, 3000); }
      if (typeof window._qbsReset === 'function') window._qbsReset();
    }).catch(function(e) {
      if (msg) { msg.textContent = '\u2717 ' + e.message; msg.style.cssText = 'font-size:11px;color:#f85149;opacity:1;'; }
    });
  };

})();

/* ═══════════════════════════════════════════════════════════════════
   CONNECT+ SETTINGS — General Settings > Connect+ Settings
   ═══════════════════════════════════════════════════════════════════
   Storage: localStorage key 'ss_connectplus_settings'
   Shape: { csvUrl: string, searchColumns: string[] | null }
   - csvUrl: the Google Sheets published CSV link
   - searchColumns: array of column names to search (null = all)

   NOTE FOR AI: This module manages Connect+ tab configuration.
   - _cpsSwitchTab(tabId)    → switches between 'data-source' and 'search-columns'
   - _cpsLoadSettings()      → called when General Settings tab opens
   - _cpsSaveSettings()      → saves csvUrl + triggers Connect+ reload
   - _cpsSaveSearchCols()    → saves searchColumns selection
   - _cpsTestUrl()           → fetches first 5 rows to validate URL + populate columns
   - _cpsSelectAllCols(bool) → check/uncheck all column checkboxes
   - window._cpSearchCols    → live array of active search columns (read by Connect+ tab)
   - window._cpCsvUrl        → live CSV URL (read by Connect+ tab)
   DO NOT modify the Connect+ tab JS (_cpInit, _cpLoad etc.) from here.
═══════════════════════════════════════════════════════════════════ */
(function() {
  'use strict';

  var LS_KEY = 'ss_connectplus_settings';

  // ── Helpers ──────────────────────────────────────────────────────
  function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function loadStoredSettings() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (raw) return JSON.parse(raw);
    } catch(_) {}
    return { csvUrl: '', searchColumns: null };
  }

  function storeSettings(obj) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(obj)); } catch(_) {}
  }

  function _getApiTok() {
    try {
      var raw = localStorage.getItem('mums_supabase_session') || sessionStorage.getItem('mums_supabase_session');
      if (raw) { var p = JSON.parse(raw); if (p && p.access_token) return p.access_token; }
      if (window.CloudAuth && typeof window.CloudAuth.accessToken === 'function') return window.CloudAuth.accessToken();
    } catch(_) {} return '';
  }


  function showMsg(id, text, ok) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.style.cssText = 'font-size:11px;opacity:1;font-weight:600;color:' + (ok ? '#3fb950' : '#f85149') + ';transition:opacity .3s;';
    clearTimeout(el._t);
    el._t = setTimeout(function() { el.style.opacity = '0'; }, 4000);
  }

  function setUrlStatus(msg, type) {
    var el = document.getElementById('cps-url-status');
    if (!el) return;
    if (!msg) { el.style.display = 'none'; return; }
    var colors = { ok: { bg: 'rgba(63,185,80,.08)', border: 'rgba(63,185,80,.25)', text: '#3fb950' },
                   err:{ bg: 'rgba(248,81,73,.08)',  border: 'rgba(248,81,73,.25)',  text: '#f85149' },
                   info:{ bg: 'rgba(34,211,238,.06)', border: 'rgba(34,211,238,.2)', text: '#22d3ee' } };
    var c = colors[type] || colors.info;
    el.style.cssText = 'display:block;margin-bottom:16px;padding:12px 14px;border-radius:8px;font-size:11px;line-height:1.6;background:' + c.bg + ';border:1px solid ' + c.border + ';color:' + c.text + ';';
    el.innerHTML = msg;
  }

  // ── Tab switcher ─────────────────────────────────────────────────
  window._cpsSwitchTab = function(tabId) {
    document.querySelectorAll('.cps-tab').forEach(function(btn) {
      var active = btn.dataset.cpsTab === tabId;
      btn.style.borderBottomColor = active ? '#22d3ee' : 'transparent';
      btn.style.color = active ? '#22d3ee' : 'var(--ss-muted)';
    });
    ['data-source','search-columns'].forEach(function(id) {
      var el = document.getElementById('cps-panel-' + id);
      if (el) el.style.display = id === tabId ? 'block' : 'none';
    });
    if (tabId === 'search-columns') _cpsRenderColCheckboxes();
  };

  // ── Load settings into form on General Settings open ─────────────
  window._cpsLoadSettings = function() {
    fetch('/api/studio/csv_settings?type=connect_plus', { headers: { 'Authorization': 'Bearer ' + _getApiTok() } })
    .then(function(r){ return r.json(); })
    .then(function(d){
      var stored = (d.ok && d.settings) ? d.settings : loadStoredSettings();
      storeSettings(stored);
      var urlEl = document.getElementById('cps-csv-url');
      if (urlEl) urlEl.value = stored.csvUrl || '';
      window._cpCsvUrl = stored.csvUrl || '';
      window._cpSearchCols = (Array.isArray(stored.searchColumns) && stored.searchColumns.length > 0) ? stored.searchColumns : null;
      window._cpDetectedCols = Array.isArray(stored.detectedColumns) ? stored.detectedColumns : null;
      if (stored.csvUrl && stored.detectedColumns && stored.detectedColumns.length) {
        _showColumnsPreview(stored.detectedColumns, stored.rowCount || null);
      }
      setUrlStatus('', '');
    }).catch(function(){});
  };

  // _cpsLoadSettings is called by the main settings nav listener (in Core JS)
  // when the user clicks "Connect+ Settings" in the sidebar.
  // It is also exposed on window so it can be called from activateTab if needed.
  // No duplicate listener needed here — Core JS handles the click routing.

  // ── Test & Preview URL ───────────────────────────────────────────
  // ── Convert any Google Sheets URL to a CSV export URL ───────────────────
  // Handles all common Google Sheets URL formats:
  //   - /pub?output=csv (already correct)
  //   - /pubhtml (published as HTML — convert to CSV)
  //   - /edit (edit link — extract sheet ID, convert to export)
  //   - /view (view link)
  //   - 2PACX-... (exported with new format)
  function _normalizeGoogleSheetsCsvUrl(raw) {
    var url = String(raw || '').trim();
    if (!url) return url;

    // Already a correct CSV URL — return as-is
    if (url.includes('output=csv')) return url;

    try {
      var u = new URL(url);

      // Case 1: /pub link missing output=csv param
      // e.g. .../pub?gid=12345&single=true  →  add &output=csv
      if (u.pathname.includes('/pub')) {
        u.searchParams.set('output', 'csv');
        return u.toString();
      }

      // Case 2: /pubhtml — replace with /pub?output=csv
      if (u.pathname.includes('/pubhtml')) {
        var gid = u.searchParams.get('gid') || '';
        u.pathname = u.pathname.replace('/pubhtml', '/pub');
        u.searchParams.set('output', 'csv');
        if (gid) u.searchParams.set('gid', gid);
        return u.toString();
      }

      // Case 3: /edit or /view — extract spreadsheet ID, build export URL
      // e.g. https://docs.google.com/spreadsheets/d/{ID}/edit  →  .../export?format=csv
      var idMatch = u.pathname.match(/\/spreadsheets\/d\/([^\/]+)/);
      if (idMatch) {
        var sheetId = idMatch[1];
        var gidEdit = u.searchParams.get('gid') || (u.hash.match(/gid=(\d+)/) || [])[1] || '';
        var exportUrl = 'https://docs.google.com/spreadsheets/d/' + sheetId + '/export?format=csv';
        if (gidEdit) exportUrl += '&gid=' + gidEdit;
        return exportUrl;
      }
    } catch(_) {}
    return url;
  }

  window._cpsTestUrl = window._cpsPreviewUrl = function() {
    var urlEl = document.getElementById('cps-csv-url');
    var rawUrl = urlEl ? urlEl.value.trim() : '';
    if (!rawUrl) { setUrlStatus('<i class="fas fa-exclamation-circle" style="margin-right:6px;"></i>Please enter a CSV URL first.', 'err'); return; }

    // Auto-normalize Google Sheets URLs before fetching
    var url = _normalizeGoogleSheetsCsvUrl(rawUrl);
    if (url !== rawUrl) {
      // Update the input to show the corrected URL
      if (urlEl) urlEl.value = url;
      setUrlStatus('<i class="fas fa-magic" style="margin-right:6px;"></i>Auto-converted to CSV export URL. Fetching…', 'info');
    } else {
      setUrlStatus('<i class="fas fa-spinner fa-spin" style="margin-right:6px;"></i>Fetching CSV to validate…', 'info');
    }

    var btn = document.querySelector('[onclick*="_cpsTestUrl"]');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing…'; }

    fetch(url, { cache: 'no-store' })
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status + ' — check the URL is correct and published');
        return r.text();
      })
      .then(function(text) {
        // Detect if response is HTML instead of CSV (common mistake with share links)
        var trimmed = text.trim().toLowerCase();
        if (trimmed.startsWith('<!doctype') || trimmed.startsWith('<html')) {
          // Try to suggest the fix
          throw new Error(
            'This URL returned an HTML page, not CSV data. ' +
            'In Google Sheets: File → Share → Publish to web → Select sheet → CSV → Copy link.'
          );
        }

        // Parse CSV header row
        var lines = text.split('\n');
        var header = _parseCsvRow(lines[0] || '');
        var rowCount = Math.max(0, lines.filter(function(l) { return l.trim(); }).length - 1);

        if (!header.length || (header.length === 1 && header[0].includes('<'))) {
          throw new Error('Could not detect column headers — the URL may not be a CSV. Make sure to use File → Publish to web → CSV format.');
        }

        // Cache detected columns in stored settings
        var stored = loadStoredSettings();
        stored.detectedColumns = header;
        stored.rowCount = rowCount;
        stored.csvUrl = url; // save normalized URL
        storeSettings(stored);
        window._cpCsvUrl = url;
        window._cpDetectedCols = header;

        setUrlStatus(
          '<i class="fas fa-check-circle" style="margin-right:6px;"></i>' +
          '<strong>Valid CSV</strong> — ' + rowCount.toLocaleString() + ' data rows, ' + header.length + ' columns detected.',
          'ok'
        );
        _showColumnsPreview(header, rowCount);

        // Update search columns panel
        _cpsRenderColCheckboxes(header);
      })
      .catch(function(e) {
        setUrlStatus('<i class="fas fa-times-circle" style="margin-right:6px;"></i><strong>Failed:</strong> ' + esc(e.message), 'err');
        document.getElementById('cps-columns-preview').style.display = 'none';
      })
      .finally(function() {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-satellite-dish"></i> Test &amp; Preview'; }
      });
  };

  function _parseCsvRow(row) {
    var fields = []; var f = ''; var q = false;
    for (var i = 0; i < row.length; i++) {
      var c = row[i];
      if (c === '"') { q = !q; }
      else if (c === ',' && !q) { fields.push(f.trim()); f = ''; }
      else f += c;
    }
    fields.push(f.trim());
    return fields.filter(function(s) { return s; });
  }

  function _showColumnsPreview(cols, rowCount) {
    var wrap = document.getElementById('cps-columns-preview');
    var list = document.getElementById('cps-columns-list');
    var cnt  = document.getElementById('cps-row-count-text');
    if (!wrap || !list) return;
    if (cnt && rowCount != null) cnt.textContent = rowCount.toLocaleString() + ' rows';
    list.innerHTML = cols.map(function(c) {
      return '<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(34,211,238,.08);border:1px solid rgba(34,211,238,.18);border-radius:5px;padding:3px 9px;font-size:10px;font-weight:600;color:#22d3ee;">' +
        '<i class="fas fa-columns" style="font-size:8px;opacity:.7;"></i>' + esc(c) + '</span>';
    }).join('');
    wrap.style.display = 'block';
  }

  // ── Search columns checkboxes ────────────────────────────────────
  function _cpsRenderColCheckboxes(cols) {
    var stored = loadStoredSettings();
    var columns = cols || stored.detectedColumns || [];
    var activeCols = Array.isArray(stored.searchColumns) ? stored.searchColumns : columns;
    var container  = document.getElementById('cps-col-checkboxes');
    var countEl    = document.getElementById('cps-col-filter-count');
    if (!container) return;

    if (!columns.length) {
      container.innerHTML = '<div style="font-size:11px;color:var(--ss-muted);opacity:.5;grid-column:1/-1;text-align:center;padding:8px 0;">Save a CSV URL in Data Source tab first.</div>';
      return;
    }

    container.innerHTML = columns.map(function(col, i) {
      var checked = activeCols.length === 0 || activeCols.indexOf(col) >= 0;
      return '<label style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:rgba(255,255,255,.03);border:1px solid var(--ss-border2);border-radius:7px;cursor:pointer;transition:background .12s;font-size:11px;color:var(--ss-text);font-weight:500;" ' +
        'onmouseover="this.style.background=\'rgba(34,211,238,.06)\'" onmouseout="this.style.background=\'rgba(255,255,255,.03)\'">' +
        '<input type="checkbox" class="cps-col-chk" data-col="' + esc(col) + '" ' + (checked ? 'checked' : '') + ' ' +
        'style="width:14px;height:14px;accent-color:#22d3ee;cursor:pointer;" onchange="window._cpsUpdateColCount()">' +
        '<span>' + esc(col) + '</span>' +
        '</label>';
    }).join('');

    _cpsUpdateColCount();
  }

  window._cpsUpdateColCount = function() {
    var checks = document.querySelectorAll('.cps-col-chk');
    var total   = checks.length;
    var checked = document.querySelectorAll('.cps-col-chk:checked').length;
    var el = document.getElementById('cps-col-filter-count');
    if (el) el.textContent = checked + ' of ' + total + ' columns selected for search';
  };

  window._cpsSelectAllCols = function(val) {
    document.querySelectorAll('.cps-col-chk').forEach(function(cb) { cb.checked = val; });
    _cpsUpdateColCount();
  };

  // ── Save settings ─────────────────────────────────────────────────
  window._cpsSaveSettings = function() {
    var urlEl = document.getElementById('cps-csv-url');
    var url   = urlEl ? urlEl.value.trim() : '';
    var btn   = document.getElementById('cps-save-btn');
    if (!url) { showMsg('cps-save-msg', '✗ Enter a CSV URL first', false); return; }
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…'; btn.style.opacity = '.7'; }
    var stored = loadStoredSettings();
    stored.csvUrl = url;
    fetch('/api/studio/csv_settings?type=connect_plus', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _getApiTok() },
      body: JSON.stringify(stored)
    }).then(function(r){
      if (!r.ok) return r.json().catch(function(){ return { ok: false, error: 'HTTP ' + r.status }; })
                               .then(function(d){ throw new Error(d && d.error ? String(d.error) : 'HTTP ' + r.status); });
      return r.json().catch(function(){ return { ok: true }; });
    }).then(function(d){
      if (!d || !d.ok) throw new Error(d && d.error ? String(d.error) : 'Server error');
      storeSettings(stored);
      window._cpCsvUrl = url;
      showMsg('cps-save-msg', '✓ Saved globally! Reload Connect+ to apply.', true);
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save Connect+ Settings'; btn.style.opacity = '1'; }
      if (typeof window._preloadStudioSettings === 'function') window._preloadStudioSettings();
      if (typeof window._cpRefresh === 'function') window._cpRefresh();
    }).catch(function(err){
      showMsg('cps-save-msg', '✗ Save failed: ' + (err && err.message ? err.message : 'Network error'), false);
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save Connect+ Settings'; btn.style.opacity = '1'; }
    });
  };

  window._cpsSaveSearchCols = function() {
    var checks  = document.querySelectorAll('.cps-col-chk');
    var stored  = loadStoredSettings();
    var allCols = (stored.detectedColumns || []);
    var selected = [];

    checks.forEach(function(cb) {
      if (cb.checked) selected.push(cb.getAttribute('data-col'));
    });

    // null = all columns (no filter); array = specific columns
    stored.searchColumns = (selected.length === allCols.length) ? null : selected;
    storeSettings(stored);
    fetch('/api/studio/csv_settings?type=connect_plus', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _getApiTok() },
      body: JSON.stringify(stored)
    }).then(function(r){
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json().catch(function(){ return { ok: true }; });
    }).then(function(d){
      if (!d || !d.ok) throw new Error(d && d.error ? String(d.error) : 'Server error');
      // Expose live to Connect+ search
      window._cpSearchCols = (Array.isArray(stored.searchColumns) && stored.searchColumns.length > 0) ? stored.searchColumns : null;
      showMsg('cps-cols-msg', '✓ Search columns saved!', true);
    }).catch(function(err){
      showMsg('cps-cols-msg', '✗ Failed: ' + (err && err.message ? err.message : 'Network error'), false);
    });

    // Expose live to Connect+ search
    // null or empty = all columns; only restrict when user explicitly selected subset
    window._cpSearchCols = (Array.isArray(stored.searchColumns) && stored.searchColumns.length > 0) ? stored.searchColumns : null;

    showMsg('cps-cols-msg', '✓ Search columns saved!', true);
  };

})();

/* ═══════════════════════════════════════════════════════════════════
   APPEARANCE SETTINGS — General Settings > Appearance
   ═══════════════════════════════════════════════════════════════════
   Storage (local):  localStorage key 'ss_appearance_settings'
   Storage (global): /api/settings/global_theme  (Super Admin → all users)
   Shape: { brightness, contrast, scale, sidebarOpacity, theme }
   Global apply: on page load, fetch /api/settings/global_theme.
     If user has a local override it wins; otherwise global default wins.
═══════════════════════════════════════════════════════════════════ */
(function() {
  'use strict';

  var LS_KEY      = 'ss_appearance_settings';
  var LS_OVERRIDE = 'ss_appearance_user_override'; // true = user chose to override global

  // ── Premium theme palette (no purple) ────────────────────────────
  var THEMES = [
    { id:'default',    name:'Obsidian',    bg:'#010409', surface:'#0d1117', accent:'#58a6ff',  tag:'Default'  },
    { id:'midnight',   name:'Midnight',    bg:'#040c18', surface:'#071428', accent:'#60a5fa',  tag:''         },
    { id:'carbon',     name:'Carbon',      bg:'#080808', surface:'#111111', accent:'#e6edf3',  tag:''         },
    { id:'onyx',       name:'Onyx Steel',  bg:'#09090b', surface:'#18181b', accent:'#94a3b8',  tag:''         },
    { id:'deep',       name:'Deep Ocean',  bg:'#00050f', surface:'#071020', accent:'#22d3ee',  tag:'Cool'     },
    { id:'arctic',     name:'Arctic',      bg:'#020c12', surface:'#0c1f2b', accent:'#38bdf8',  tag:''         },
    { id:'forest',     name:'Forest',      bg:'#030a05', surface:'#0b1a0e', accent:'#4ade80',  tag:''         },
    { id:'ember',      name:'Ember',       bg:'#0c0700', surface:'#1a1000', accent:'#f97316',  tag:'Warm'     },
    { id:'crimson',    name:'Crimson',     bg:'#0c0005', surface:'#1a000c', accent:'#fb7185',  tag:''         },
    { id:'aurora',     name:'Aurora',      bg:'#010509', surface:'#0a1520', accent:'#2dd4bf',  tag:'Premium'  },
  ];

  // ── Auth token helper ─────────────────────────────────────────────
  function _getToken() {
    try {
      var raw = localStorage.getItem('mums_supabase_session') || sessionStorage.getItem('mums_supabase_session');
      if (raw) { var p = JSON.parse(raw); if (p && p.access_token) return p.access_token; }
      if (window.CloudAuth && typeof window.CloudAuth.accessToken === 'function') return window.CloudAuth.accessToken() || '';
    } catch(_) {}
    return '';
  }

  // ── Super Admin check ─────────────────────────────────────────────
  function _isSuperAdmin() {
    try {
      var raw = localStorage.getItem('mums_supabase_session') || sessionStorage.getItem('mums_supabase_session');
      if (raw) {
        var s = JSON.parse(raw);
        var role = (s && (s.role || (s.user && s.user.role) || (s.session && s.session.user && s.session.user.role))) || '';
        if (String(role).trim().toUpperCase().replace(/\s+/g,'_') === 'SUPER_ADMIN') return true;
      }
      if (window.Auth && typeof window.Auth.getUser === 'function') {
        var u = window.Auth.getUser();
        if (u && String(u.role||'').trim().toUpperCase().replace(/\s+/g,'_') === 'SUPER_ADMIN') return true;
      }
    } catch(_) {}
    return false;
  }

  // ── Local storage helpers ─────────────────────────────────────────
  function loadStored() {
    try { var r = localStorage.getItem(LS_KEY); if (r) return JSON.parse(r); } catch(_) {}
    return { brightness: 100, contrast: 100, scale: 100, sidebarOpacity: 100, theme: 'default' };
  }
  function saveStored(obj) { try { localStorage.setItem(LS_KEY, JSON.stringify(obj)); } catch(_) {} }

  // ── Tab switcher ──────────────────────────────────────────────────
  window._appSwitchTab = function(tabId) {
    var ACCENT = '#0ea5e9';
    document.querySelectorAll('.app-tab').forEach(function(b) {
      var active = b.dataset.appTab === tabId;
      b.style.borderBottomColor = active ? ACCENT : 'transparent';
      b.style.color = active ? ACCENT : 'var(--ss-muted)';
    });
    ['display','theme'].forEach(function(id) {
      var el = document.getElementById('app-panel-' + id);
      if (el) el.style.display = id === tabId ? 'block' : 'none';
    });
    if (tabId === 'theme') _appRenderThemes();
  };

  // ── Apply display settings live to DOM ───────────────────────────
  window._appApplyDisplay = function() {
    var brightness = Number(document.getElementById('app-brightness')?.value    || 100);
    var contrast   = Number(document.getElementById('app-contrast')?.value      || 100);
    var scale      = Number(document.getElementById('app-scale')?.value         || 100);
    var sidebarOp  = Number(document.getElementById('app-sidebar-opacity')?.value || 100);

    function set(id, v) { var e = document.getElementById(id); if (e) e.textContent = v + '%'; }
    set('app-brightness-val',      brightness);
    set('app-contrast-val',        contrast);
    set('app-scale-val',           scale);
    set('app-sidebar-opacity-val', sidebarOp);

    document.body.style.filter = 'brightness(' + (brightness/100) + ') contrast(' + (contrast/100) + ')';
    document.documentElement.style.fontSize = (scale / 100 * 16) + 'px';
    var sidebar  = document.getElementById('ss-left-sidebar');
    if (sidebar)  sidebar.style.opacity = (sidebarOp / 100).toString();
    var rsidebar = document.querySelector('.ss-right-panel');
    if (rsidebar) rsidebar.style.opacity = (sidebarOp / 100).toString();
  };

  // ── Save: local + (Super Admin) → global API ─────────────────────
  window._appSaveDisplay = function() {
    var stored = loadStored();
    stored.brightness    = Number(document.getElementById('app-brightness')?.value    || 100);
    stored.contrast      = Number(document.getElementById('app-contrast')?.value      || 100);
    stored.scale         = Number(document.getElementById('app-scale')?.value         || 100);
    stored.sidebarOpacity = Number(document.getElementById('app-sidebar-opacity')?.value || 100);
    saveStored(stored);
    _appApplyDisplay();

    var msgId = document.querySelector('#app-panel-display') && document.querySelector('#app-panel-display').style.display !== 'none'
      ? 'app-display-msg' : 'app-theme-msg';
    var msg = document.getElementById(msgId) || document.getElementById('app-display-msg');

    // Super Admin: also push to global API so all users get it
    if (_isSuperAdmin()) {
      var tok = _getToken();
      var payload = {
        defaultTheme:   stored.theme    || 'default',
        brightness:     stored.brightness,
        contrast:       stored.contrast,
        scale:          stored.scale,
        sidebarOpacity: stored.sidebarOpacity,
      };
      fetch('/api/settings/global_theme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
        body: JSON.stringify(payload),
      })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (msg) {
          msg.textContent = d.ok ? '✓ Saved & applied globally to all users!' : '⚠ Saved locally; global push failed.';
          msg.style.cssText = 'font-size:11px;opacity:1;color:' + (d.ok ? '#3fb950' : '#d29922') + ';font-weight:600;transition:opacity .3s;';
          clearTimeout(msg._t); msg._t = setTimeout(function() { msg.style.opacity = '0'; }, 4000);
        }
      })
      .catch(function() {
        if (msg) {
          msg.textContent = '⚠ Saved locally; network error.';
          msg.style.cssText = 'font-size:11px;opacity:1;color:#d29922;font-weight:600;';
        }
      });
    } else {
      if (msg) {
        msg.textContent = '✓ Appearance saved!';
        msg.style.cssText = 'font-size:11px;opacity:1;color:#3fb950;font-weight:600;transition:opacity .3s;';
        clearTimeout(msg._t); msg._t = setTimeout(function() { msg.style.opacity = '0'; }, 3000);
      }
    }
  };

  // ── Reset to defaults ─────────────────────────────────────────────
  window._appResetDisplay = function() {
    var defaults = { brightness: 100, contrast: 100, scale: 100, sidebarOpacity: 100 };
    var map = { brightness:'app-brightness', contrast:'app-contrast', scale:'app-scale', sidebarOpacity:'app-sidebar-opacity' };
    Object.keys(defaults).forEach(function(k) {
      var el = document.getElementById(map[k]);
      if (el) el.value = defaults[k];
    });
    _appApplyDisplay();
    var stored = loadStored();
    Object.assign(stored, defaults);
    saveStored(stored);
    var msg = document.getElementById('app-display-msg');
    if (msg) {
      msg.textContent = '↺ Reset to defaults';
      msg.style.cssText = 'font-size:11px;opacity:1;color:#0ea5e9;font-weight:600;';
      clearTimeout(msg._t); msg._t = setTimeout(function() { msg.style.opacity = '0'; }, 2500);
    }
  };

  // ── Load sliders from stored values ──────────────────────────────
  function _applyToSliders(s) {
    function setSlider(id, val) { var e = document.getElementById(id); if (e) e.value = val; }
    setSlider('app-brightness',      s.brightness     || 100);
    setSlider('app-contrast',        s.contrast       || 100);
    setSlider('app-scale',           s.scale          || 100);
    setSlider('app-sidebar-opacity', s.sidebarOpacity || 100);
    _appApplyDisplay();
    _appRenderThemes(s.theme);
  }

  window._appLoadDisplay = function() {
    var stored = loadStored();

    // Show/hide Super Admin global note
    var isSA = _isSuperAdmin();
    var noteD = document.getElementById('app-global-note');
    var noteT = document.getElementById('app-global-note-theme');
    var badge = document.getElementById('app-global-badge');
    if (noteD) noteD.style.display = isSA ? 'block' : 'none';
    if (noteT) noteT.style.display = isSA ? 'block' : 'none';

    // Fetch global settings from API (all users get this on load)
    var tok = _getToken();
    var headers = tok ? { 'Authorization': 'Bearer ' + tok } : {};
    fetch('/api/settings/global_theme', { headers: headers })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (!d.ok) { _applyToSliders(stored); return; }
        // Global settings exist — merge with local stored
        // Local stored takes priority (user can override), but if not set, use global
        var merged = {
          brightness:    stored.brightness    !== 100 ? stored.brightness    : (d.brightness    ?? 100),
          contrast:      stored.contrast      !== 100 ? stored.contrast      : (d.contrast      ?? 100),
          scale:         stored.scale         !== 100 ? stored.scale         : (d.scale         ?? 100),
          sidebarOpacity: stored.sidebarOpacity !== 100 ? stored.sidebarOpacity : (d.sidebarOpacity ?? 100),
          theme:         stored.theme !== 'default' ? stored.theme : (d.defaultTheme || 'default'),
        };
        _applyToSliders(merged);
        // Show global badge if Super Admin has set non-default values
        var hasGlobal = d.brightness !== 100 || d.contrast !== 100 || d.scale !== 100 ||
                        d.sidebarOpacity !== 100 || (d.defaultTheme && d.defaultTheme !== 'default');
        if (badge) badge.style.display = hasGlobal ? '' : 'none';
      })
      .catch(function() { _applyToSliders(stored); });
  };

  // ── Theme renderer ────────────────────────────────────────────────
  function _appRenderThemes(activeTheme) {
    var grid = document.getElementById('app-theme-grid');
    if (!grid) return;
    var stored  = loadStored();
    var current = activeTheme || stored.theme || 'default';
    var ACCENT  = '#0ea5e9';

    grid.innerHTML = THEMES.map(function(t) {
      var isActive = t.id === current;
      return '<div onclick="window._appSelectTheme(\'' + t.id + '\')" ' +
        'style="padding:14px;background:' + (isActive ? 'rgba(14,165,233,.1)' : 'rgba(255,255,255,.03)') + ';border:2px solid ' +
        (isActive ? ACCENT : 'rgba(255,255,255,.07)') + ';border-radius:10px;cursor:pointer;transition:all .15s;position:relative;" ' +
        'onmouseover="if(\'' + t.id + '\'!==\'' + current + '\'){this.style.background=\'rgba(255,255,255,.06)\';this.style.borderColor=\'rgba(255,255,255,.18)\';}" ' +
        'onmouseout="if(\'' + t.id + '\'!==\'' + current + '\'){this.style.background=\'rgba(255,255,255,.03)\';this.style.borderColor=\'rgba(255,255,255,.07)\';}"> ' +
        // Color swatches
        '<div style="display:flex;gap:5px;margin-bottom:10px;">' +
          '<div style="width:22px;height:22px;border-radius:5px;background:' + t.bg + ';border:1px solid rgba(255,255,255,.12);"></div>' +
          '<div style="width:22px;height:22px;border-radius:5px;background:' + t.surface + ';border:1px solid rgba(255,255,255,.08);"></div>' +
          '<div style="width:22px;height:22px;border-radius:5px;background:' + t.accent + ';"></div>' +
        '</div>' +
        '<div style="font-size:11px;font-weight:700;color:' + (isActive ? ACCENT : '#c9d1d9') + ';margin-bottom:2px;">' + t.name + '</div>' +
        (t.tag ? '<div style="font-size:8px;font-weight:800;letter-spacing:.08em;color:' + (isActive ? ACCENT : 'var(--ss-muted)') + ';opacity:.7;">' + t.tag + '</div>' : '') +
        (isActive ? '<div style="position:absolute;top:8px;right:8px;font-size:8px;font-weight:900;color:' + ACCENT + ';letter-spacing:.06em;">✓ ACTIVE</div>' : '') +
        '</div>';
    }).join('');
  }

  window._appSelectTheme = function(themeId) {
    var t = THEMES.find(function(x) { return x.id === themeId; });
    if (!t) return;
    document.documentElement.style.setProperty('--ss-bg',      t.bg);
    document.documentElement.style.setProperty('--ss-surface', t.surface);
    document.documentElement.style.setProperty('--ss-accent',  t.accent);
    var stored = loadStored();
    stored.theme = themeId;
    saveStored(stored);
    _appRenderThemes(themeId);
    var msg = document.getElementById('app-theme-msg');
    if (msg) {
      msg.textContent = '✓ Theme applied — click Save to push globally.';
      msg.style.cssText = 'font-size:11px;opacity:1;color:#3fb950;font-weight:600;';
      clearTimeout(msg._t); msg._t = setTimeout(function() { msg.style.opacity = '0'; }, 3500);
    }
  };

  // ── Wire nav click ────────────────────────────────────────────────
  document.querySelectorAll('.ss-settings-nav-btn').forEach(function(btn) {
    if (btn.dataset.settingsSection === 'studio-appearance') {
      btn.addEventListener('click', window._appLoadDisplay);
    }
  });

  // ── Apply on page load (for all users) — pull global, apply ───────
  (function applyOnLoad() {
    var s = loadStored();
    // Apply local immediately (no flash)
    if (s.brightness !== 100 || s.contrast !== 100) {
      document.body.style.filter = 'brightness(' + ((s.brightness||100)/100) + ') contrast(' + ((s.contrast||100)/100) + ')';
    }
    if (s.scale && s.scale !== 100) {
      document.documentElement.style.fontSize = (s.scale/100 * 16) + 'px';
    }
    if (s.sidebarOpacity && s.sidebarOpacity !== 100) {
      var sidebar = document.getElementById('ss-left-sidebar');
      if (sidebar) sidebar.style.opacity = (s.sidebarOpacity/100).toString();
    }
    if (s.theme && s.theme !== 'default') {
      var t = THEMES.find(function(x) { return x.id === s.theme; });
      if (t) {
        document.documentElement.style.setProperty('--ss-bg',      t.bg);
        document.documentElement.style.setProperty('--ss-surface', t.surface);
        document.documentElement.style.setProperty('--ss-accent',  t.accent);
      }
    }

    // Then fetch global settings and apply if user has no local overrides
    try {
      var tok = '';
      var raw = localStorage.getItem('mums_supabase_session') || sessionStorage.getItem('mums_supabase_session');
      if (raw) { var p = JSON.parse(raw); if (p && p.access_token) tok = p.access_token; }
      var headers = tok ? { 'Authorization': 'Bearer ' + tok } : {};
      fetch('/api/settings/global_theme', { headers: headers })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (!d.ok) return;
          // Only apply global values where user has NOT set a local override (i.e. still at default 100 / 'default')
          var changed = false;
          var filter = '';
          var bright = (s.brightness === 100 && d.brightness !== undefined) ? d.brightness : s.brightness || 100;
          var contr  = (s.contrast   === 100 && d.contrast   !== undefined) ? d.contrast   : s.contrast   || 100;
          var sc     = (s.scale      === 100 && d.scale      !== undefined) ? d.scale      : s.scale      || 100;
          var sop    = (s.sidebarOpacity === 100 && d.sidebarOpacity !== undefined) ? d.sidebarOpacity : s.sidebarOpacity || 100;
          var theme  = ((!s.theme || s.theme === 'default') && d.defaultTheme) ? d.defaultTheme : s.theme || 'default';

          if (bright !== 100 || contr !== 100) {
            document.body.style.filter = 'brightness(' + (bright/100) + ') contrast(' + (contr/100) + ')';
          }
          if (sc !== 100) document.documentElement.style.fontSize = (sc/100 * 16) + 'px';
          if (sop !== 100) {
            var sb2 = document.getElementById('ss-left-sidebar');
            if (sb2) sb2.style.opacity = (sop/100).toString();
          }
          if (theme && theme !== 'default') {
            var t2 = THEMES.find(function(x) { return x.id === theme; });
            if (t2) {
              document.documentElement.style.setProperty('--ss-bg',      t2.bg);
              document.documentElement.style.setProperty('--ss-surface', t2.surface);
              document.documentElement.style.setProperty('--ss-accent',  t2.accent);
            }
          }
        })
        .catch(function() {});
    } catch(_) {}
  })();

})();

/* ═══════════════════════════════════════════════════════════════════
   SUPER ADMIN GATE — Hide General Settings from non-SUPER_ADMIN
   ═══════════════════════════════════════════════════════════════════
   General Settings tab is only visible to users with role === 'SUPER_ADMIN'.
   All other roles see the tab as hidden (display:none).

   NOTE FOR AI: To change who can see General Settings, update the
   ALLOWED_ROLES array below. Current allowed: ['SUPER_ADMIN'].
   Add 'SUPER_USER' or 'ADMIN' if needed.
═══════════════════════════════════════════════════════════════════ */
(function() {
  'use strict';

  var ALLOWED_ROLES = ['SUPERADMIN', 'SUPER_ADMIN', 'ADMIN'];

  function getUserRole() {
    try {
      // CloudAuth session (primary)
      var raw = localStorage.getItem('mums_supabase_session') || sessionStorage.getItem('mums_supabase_session');
      if (raw) {
        var sess = JSON.parse(raw);
        var userId = sess && (sess.userId || (sess.user && sess.user.id));
        if (userId && window.Store && typeof Store.getUserById === 'function') {
          var u = Store.getUserById(userId);
          if (u && u.role) return String(u.role).trim().toUpperCase();
        }
        // Fallback: role embedded in session
        if (sess && sess.role) return String(sess.role).trim().toUpperCase();
        if (sess && sess.user && sess.user.role) return String(sess.user.role).trim().toUpperCase();
      }
      // CloudAuth API
      if (window.Auth && typeof window.Auth.getUser === 'function') {
        var user = window.Auth.getUser();
        if (user && user.role) return String(user.role).trim().toUpperCase();
      }
    } catch(_) {}
    return '';
  }

  function applyGate() {
    var role     = getUserRole();
    var allowed  = ALLOWED_ROLES.indexOf(role) >= 0;
    var configTab = document.getElementById('ss-tab-config');
    var mainBody = document.getElementById('ss-main-body');

    // Main studio body must never be role-gated.
    if (mainBody) {
      try { mainBody.removeAttribute('role'); } catch(_) {}
      try { mainBody.removeAttribute('aria-hidden'); } catch(_) {}
      try { mainBody.removeAttribute('data-role-gated'); } catch(_) {}
      try { mainBody.style.removeProperty('display'); } catch(_) {}
    }

    if (configTab) {
      if (allowed) {
        configTab.style.removeProperty('display');
      } else {
        // Strict hide rule for non-admin roles.
        configTab.style.setProperty('display', 'none', 'important');
      }
      configTab.setAttribute('data-role-gated', allowed ? 'visible' : 'hidden');
    }

    // If user is on the config tab but not allowed, redirect to first available tab
    if (!allowed) {
      var active = document.querySelector('.ss-tab.active');
      if (active && active.dataset.tab === 'config') {
        var firstTab = document.querySelector('.ss-tab:not([id="ss-tab-config"])');
        if (firstTab && typeof window.activateTab === 'function') {
          window.activateTab(firstTab.dataset.tab);
        }
      }
    }
  }

  // Apply immediately + retry after hydration completes
  applyGate();
  setTimeout(applyGate, 300);
  setTimeout(applyGate, 1200);

  // Re-apply if user changes (Store dispatches events)
  try {
    window.addEventListener('mums:store', function() { setTimeout(applyGate, 100); });
    window.addEventListener('mums:auth', function()  { setTimeout(applyGate, 100); });
  } catch(_) {}

})();

/* ═══════════════════════════════════════════════════════════════════
   MANILA CALENDAR FIX — Retry navigation if Pages not yet registered
   ═══════════════════════════════════════════════════════════════════
   When support_studio.html opens a new tab, the MUMS app at /manila_calendar
   may render my_task instead if window.Pages['manila_calendar'] hasn't
   registered by the time navigateToPageId fires.

   This patch adds a popstate/load listener that retries the route render
   up to 5 times if the expected page isn't registered yet.

   NOTE FOR AI: This is a safe client-side patch — it does NOT modify
   app.js (which has @AI_CRITICAL_GUARD). It patches window.App.navigate
   to add retry logic for deferred page scripts.
═══════════════════════════════════════════════════════════════════ */
(function() {
  'use strict';

  // Only runs inside the MUMS main app (index.html), not support_studio.html
  // Since this script IS in support_studio.html, we add a postMessage bridge
  // that the main MUMS window can use to retry navigation when needed.

  // Bridge: when a link to MUMS opens support_studio.html, and user clicks
  // Manila Calendar in the MUMS sidebar, MUMS calls navigateToPageId.
  // The fix is to ensure the retry logic exists in the MUMS app.
  // We inject a tiny retry helper that survives across the deferred script loading.

  if (window.location.pathname.includes('support_studio')) {
    // We are in support_studio.html — nothing to do here for Manila Calendar
    // The Manila Calendar fix runs in the MUMS main window (index.html)
    return;
  }

  // Retry logic (runs in MUMS main window context if somehow loaded there)
  var _mcRetries = 0;
  function _retryManilaCalendar() {
    var pages = window.Pages || {};
    var currentId = window._currentPageId || '';
    if (currentId === 'manila_calendar' && !pages['manila_calendar']) {
      _mcRetries++;
      if (_mcRetries < 10) {
        setTimeout(function() {
          var p2 = window.Pages || {};
          if (p2['manila_calendar'] && window.App && typeof window.App.navigate === 'function') {
            window.App.navigate('manila_calendar');
          } else {
            _retryManilaCalendar();
          }
        }, 300);
      }
    }
  }

  window.addEventListener('popstate', function() {
    setTimeout(_retryManilaCalendar, 100);
  });

})();

/* ═══════════════════════════════════════════════════════════════════
   PART NUMBER SETTINGS — General Settings > Part Number Settings
   ═══════════════════════════════════════════════════════════════════
   Storage: localStorage key 'ss_parts_number_settings'
   Shape: { csvUrl: string, searchColumns: string[] | null }
   - csvUrl: the Google Sheets published CSV link
   - searchColumns: array of column names to search (null = all)

   Exposed globals:
   - window._pnsLoadSettings()     → called when nav btn is clicked
   - window._pnsSwitchTab(tabId)   → switches inner tabs
   - window._pnsSaveSettings()     → saves csvUrl + triggers tab reload
   - window._pnsSaveSearchCols()   → saves searchColumns selection
   - window._pnsTestUrl()          → validates URL and populates columns
   - window._pnsSelectAllCols(bool)→ check/uncheck all column checkboxes
   - window._pnSearchCols          → live array of active search columns
   - window._pnCsvUrl              → live CSV URL (read by Parts Number tab)
   DO NOT modify the Parts Number tab JS (_pnInit, _pnLoad etc.) from here.
═══════════════════════════════════════════════════════════════════ */
(function() {
  'use strict';

  var LS_KEY = 'ss_parts_number_settings';

  function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function loadStoredSettings() {
    try { var r = localStorage.getItem(LS_KEY); if (r) return JSON.parse(r); } catch(_) {}
    return { csvUrl: '', searchColumns: null };
  }

  function storeSettings(obj) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(obj)); } catch(_) {}
  }

  function _getApiTok() {
    try {
      var raw = localStorage.getItem('mums_supabase_session') || sessionStorage.getItem('mums_supabase_session');
      if (raw) { var p = JSON.parse(raw); if (p && p.access_token) return p.access_token; }
      if (window.CloudAuth && typeof window.CloudAuth.accessToken === 'function') return window.CloudAuth.accessToken();
    } catch(_) {} return '';
  }

  function showMsg(id, text, ok) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.style.cssText = 'font-size:11px;opacity:1;font-weight:600;color:' + (ok ? '#3fb950' : '#f85149') + ';transition:opacity .3s;';
    clearTimeout(el._t);
    el._t = setTimeout(function() { el.style.opacity = '0'; }, 4000);
  }

  function setUrlStatus(msg, type) {
    var el = document.getElementById('pns-url-status');
    if (!el) return;
    if (!msg) { el.style.display = 'none'; return; }
    var colors = {
      ok:   { bg: 'rgba(63,185,80,.08)',   border: 'rgba(63,185,80,.25)',   text: '#3fb950' },
      err:  { bg: 'rgba(248,81,73,.08)',   border: 'rgba(248,81,73,.25)',   text: '#f85149' },
      info: { bg: 'rgba(251,146,60,.06)',  border: 'rgba(251,146,60,.2)',   text: '#fb923c' }
    };
    var c = colors[type] || colors.info;
    el.style.cssText = 'display:block;margin-bottom:16px;padding:12px 14px;border-radius:8px;font-size:11px;line-height:1.6;background:' + c.bg + ';border:1px solid ' + c.border + ';color:' + c.text + ';';
    el.innerHTML = msg;
  }

  // ── Tab switcher ─────────────────────────────────────────────────
  window._pnsSwitchTab = function(tabId) {
    document.querySelectorAll('.pns-tab').forEach(function(btn) {
      var active = btn.dataset.pnsTab === tabId;
      btn.style.borderBottomColor = active ? '#fb923c' : 'transparent';
      btn.style.color = active ? '#fb923c' : 'var(--ss-muted)';
    });
    ['data-source','search-columns'].forEach(function(id) {
      var el = document.getElementById('pns-panel-' + id);
      if (el) el.style.display = (id === tabId) ? 'block' : 'none';
    });
    if (tabId === 'search-columns') _pnsRenderColCheckboxes();
  };

  // ── Load settings into form ───────────────────────────────────────
  window._pnsLoadSettings = function() {
    fetch('/api/studio/csv_settings?type=parts_number', { headers: { 'Authorization': 'Bearer ' + _getApiTok() } })
    .then(function(r){ return r.json(); })
    .then(function(d){
      var stored = (d.ok && d.settings) ? d.settings : loadStoredSettings();
      storeSettings(stored);
      var urlEl = document.getElementById('pns-csv-url');
      if (urlEl) urlEl.value = stored.csvUrl || '';
      window._pnCsvUrl = stored.csvUrl || '';
      window._pnSearchCols = (Array.isArray(stored.searchColumns) && stored.searchColumns.length > 0) ? stored.searchColumns : null;
      if (stored.csvUrl && stored.detectedColumns && stored.detectedColumns.length) {
        _showColumnsPreview(stored.detectedColumns, stored.rowCount || null);
      }
      setUrlStatus('', '');
    }).catch(function(){});
  };

  // ── URL normalizer (same logic as Connect+ settings) ─────────────
  function _normalizeUrl(raw) {
    var url = String(raw || '').trim();
    if (!url) return url;
    if (url.includes('output=csv')) return url;
    try {
      var u = new URL(url);
      if (u.pathname.includes('/pub')) {
        u.searchParams.set('output', 'csv');
        return u.toString();
      }
      if (u.pathname.includes('/pubhtml')) {
        var gid = u.searchParams.get('gid') || '';
        u.pathname = u.pathname.replace('/pubhtml', '/pub');
        u.searchParams.set('output', 'csv');
        if (gid) u.searchParams.set('gid', gid);
        return u.toString();
      }
      if (u.pathname.includes('/edit') || u.pathname.includes('/view')) {
        var m = u.pathname.match(/\/d\/([^/]+)/);
        if (m) {
          u.pathname = '/spreadsheets/d/' + m[1] + '/pub';
          u.search = '?output=csv';
          return u.toString();
        }
      }
    } catch(_) {}
    return url;
  }

  // ── onInput: live normalize the URL field ─────────────────────────
  window._pnsOnUrlInput = function(val) {
    var normalized = _normalizeUrl(val);
    if (normalized && normalized !== val) {
      var el = document.getElementById('pns-csv-url');
      if (el && document.activeElement !== el) el.value = normalized;
    }
  };

  // ── Show detected columns as tags ────────────────────────────────
  function _showColumnsPreview(cols, rowCount) {
    var preview = document.getElementById('pns-columns-preview');
    var tagsEl  = document.getElementById('pns-col-tags');
    var countEl = document.getElementById('pns-row-count');
    if (!preview || !tagsEl) return;
    preview.style.display = 'block';
    if (countEl && rowCount) countEl.textContent = Number(rowCount).toLocaleString() + ' rows';
    tagsEl.innerHTML = cols.map(function(c) {
      return '<span style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:6px;background:rgba(251,146,60,.08);border:1px solid rgba(251,146,60,.18);font-size:10px;font-weight:600;color:#fb923c;">' +
        '<i class="fas fa-columns" style="font-size:9px;opacity:.7;"></i>' + esc(c) + '</span>';
    }).join('');
  }

  // ── Test URL ──────────────────────────────────────────────────────
  window._pnsTestUrl = function() {
    var urlEl = document.getElementById('pns-csv-url');
    if (!urlEl) return;
    var raw  = (urlEl.value || '').trim();
    var url  = _normalizeUrl(raw);
    if (!url) { setUrlStatus('<i class="fas fa-exclamation-circle" style="margin-right:6px;"></i>Enter a Google Sheets CSV URL first.', 'err'); return; }
    urlEl.value = url;
    setUrlStatus('<i class="fas fa-spinner fa-spin" style="margin-right:6px;"></i>Fetching preview from Google Sheets…', 'info');

    fetch(url).then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function(text) {
      var lines = text.split('\n').filter(Boolean);
      if (!lines.length) throw new Error('Empty CSV');
      var headers = lines[0].split(',').map(function(h) { return h.replace(/^"|"$/g,'').trim(); });
      var rowCount = lines.length - 1;
      var stored = loadStoredSettings();
      stored.csvUrl          = url;
      stored.detectedColumns = headers;
      stored.rowCount        = rowCount;
      storeSettings(stored);
      window._pnCsvUrl = url;
      _showColumnsPreview(headers, rowCount);
      setUrlStatus(
        '<i class="fas fa-check-circle" style="margin-right:6px;"></i>' +
        '<strong>Connected!</strong> Detected <strong>' + headers.length + ' columns</strong> · ' +
        '<strong>' + rowCount.toLocaleString() + ' rows</strong><br>' +
        '<span style="opacity:.75;">Columns: ' + headers.slice(0,8).map(esc).join(', ') + (headers.length > 8 ? '…' : '') + '</span>',
        'ok'
      );
    }).catch(function(e) {
      setUrlStatus('<i class="fas fa-exclamation-triangle" style="margin-right:6px;"></i><strong>Failed:</strong> ' + esc(e.message) + '<br><span style="opacity:.75;">Make sure the sheet is Published to the web as CSV.</span>', 'err');
    });
  };

  // ── Save CSV URL ──────────────────────────────────────────────────
  window._pnsSaveSettings = function() {
    var urlEl = document.getElementById('pns-csv-url');
    var url   = urlEl ? urlEl.value.trim() : '';
    var btn   = document.getElementById('pns-save-btn');
    if (!url) { showMsg('pns-save-msg', '✗ Enter a CSV URL first', false); return; }
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…'; btn.style.opacity = '.7'; }
    var stored = loadStoredSettings();
    stored.csvUrl = url;
    fetch('/api/studio/csv_settings?type=parts_number', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _getApiTok() },
      body: JSON.stringify(stored)
    }).then(function(r){
      if (!r.ok) return r.json().catch(function(){ return { ok: false, error: 'HTTP ' + r.status }; })
                               .then(function(d){ throw new Error(d && d.error ? String(d.error) : 'HTTP ' + r.status); });
      return r.json().catch(function(){ return { ok: true }; });
    }).then(function(d){
      if (!d || !d.ok) throw new Error(d && d.error ? String(d.error) : 'Server error');
      storeSettings(stored);
      window._pnCsvUrl = url;
      showMsg('pns-save-msg', '✓ Saved globally! Reload Parts Number to apply.', true);
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save Part Number Settings'; btn.style.opacity = '1'; }
      if (typeof window._preloadStudioSettings === 'function') window._preloadStudioSettings();
      if (typeof window._pnRefresh === 'function') window._pnRefresh();
    }).catch(function(err){
      showMsg('pns-save-msg', '✗ Save failed: ' + (err && err.message ? err.message : 'Network error'), false);
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save Part Number Settings'; btn.style.opacity = '1'; }
    });
  };

  // ── Search columns checkbox rendering ────────────────────────────
  function _pnsRenderColCheckboxes() {
    var container = document.getElementById('pns-col-checkboxes');
    if (!container) return;
    var stored = loadStoredSettings();
    var cols   = stored.detectedColumns || [];
    var active = stored.searchColumns || null;
    if (!cols.length) {
      container.innerHTML = '<span style="font-size:11px;color:var(--ss-muted);font-style:italic;">Load a CSV URL first to see columns.</span>';
      return;
    }
    container.innerHTML = cols.map(function(col) {
      var checked = !active || active.indexOf(col) >= 0;
      return '<label style="display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:6px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);cursor:pointer;font-size:11px;color:var(--ss-text);">' +
        '<input type="checkbox" data-pns-col="' + esc(col) + '" ' + (checked ? 'checked' : '') +
        ' style="accent-color:#fb923c;cursor:pointer;">' + esc(col) + '</label>';
    }).join('');
  }

  window._pnsSelectAllCols = function(val) {
    document.querySelectorAll('[data-pns-col]').forEach(function(cb) { cb.checked = val; });
  };

  window._pnsSaveSearchCols = function() {
    var checked = [];
    document.querySelectorAll('[data-pns-col]:checked').forEach(function(cb) { checked.push(cb.dataset.pnsCol); });
    var stored = loadStoredSettings();
    var allCols = stored.detectedColumns || [];
    stored.searchColumns = (checked.length === allCols.length) ? null : checked;
    storeSettings(stored);
    fetch('/api/studio/csv_settings?type=parts_number', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _getApiTok() },
      body: JSON.stringify(stored)
    }).then(function(r){
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json().catch(function(){ return { ok: true }; });
    }).then(function(d){
      if (!d || !d.ok) throw new Error(d && d.error ? String(d.error) : 'Server error');
      window._pnSearchCols = stored.searchColumns;
      showMsg('pns-cols-msg', '✓ Search columns saved.', true);
    }).catch(function(err){
      showMsg('pns-cols-msg', '✗ Failed: ' + (err && err.message ? err.message : 'Network error'), false);
    });
    window._pnSearchCols = stored.searchColumns;
    showMsg('pns-cols-msg', '✓ Search columns saved.', true);
  };

})();

/* ═══════════════════════════════════════════════════════════════════
   CONTACT INFORMATION SETTINGS — General Settings > Contact Information Settings
   ═══════════════════════════════════════════════════════════════════
   Storage: localStorage key 'ss_contact_information_settings'
   Shape: { csvUrl: string, searchColumns: string[] | null }
   - csvUrl: the Google Sheets published CSV link
   - searchColumns: array of column names to search (null = all)

   Exposed globals:
   - window._ctisLoadSettings()     → called when nav btn is clicked
   - window._ctisSwitchTab(tabId)   → switches inner tabs
   - window._ctisSaveSettings()     → saves csvUrl + triggers tab reload
   - window._ctisSaveSearchCols()   → saves searchColumns selection
   - window._ctisTestUrl()          → validates URL and populates columns
   - window._ctisSelectAllCols(bool)→ check/uncheck all column checkboxes
   - window._ctiSearchCols          → live array of active search columns
   - window._ctiCsvUrl              → live CSV URL (read by Parts Number tab)
   DO NOT modify the Contact Information tab JS (_ctiInit, _ctiLoad etc.) from here.
═══════════════════════════════════════════════════════════════════ */
(function() {
  'use strict';

  var LS_KEY = 'ss_contact_information_settings';

  function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function loadStoredSettings() {
    try { var r = localStorage.getItem(LS_KEY); if (r) return JSON.parse(r); } catch(_) {}
    return { csvUrl: '', searchColumns: null };
  }

  function storeSettings(obj) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(obj)); } catch(_) {}
  }

  function _getApiTok() {
    try {
      var raw = localStorage.getItem('mums_supabase_session') || sessionStorage.getItem('mums_supabase_session');
      if (raw) { var p = JSON.parse(raw); if (p && p.access_token) return p.access_token; }
      if (window.CloudAuth && typeof window.CloudAuth.accessToken === 'function') return window.CloudAuth.accessToken();
    } catch(_) {} return '';
  }

  function showMsg(id, text, ok) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.style.cssText = 'font-size:11px;opacity:1;font-weight:600;color:' + (ok ? '#3fb950' : '#f85149') + ';transition:opacity .3s;';
    clearTimeout(el._t);
    el._t = setTimeout(function() { el.style.opacity = '0'; }, 4000);
  }

  function setUrlStatus(msg, type) {
    var el = document.getElementById('ctis-url-status');
    if (!el) return;
    if (!msg) { el.style.display = 'none'; return; }
    var colors = {
      ok:   { bg: 'rgba(63,185,80,.08)',   border: 'rgba(63,185,80,.25)',   text: '#3fb950' },
      err:  { bg: 'rgba(248,81,73,.08)',   border: 'rgba(248,81,73,.25)',   text: '#f85149' },
      info: { bg: 'rgba(20,184,166,.08)',  border: 'rgba(20,184,166,.24)',   text: '#14b8a6' }
    };
    var c = colors[type] || colors.info;
    el.style.cssText = 'display:block;margin-bottom:16px;padding:12px 14px;border-radius:8px;font-size:11px;line-height:1.6;background:' + c.bg + ';border:1px solid ' + c.border + ';color:' + c.text + ';';
    el.innerHTML = msg;
  }

  // ── Tab switcher ─────────────────────────────────────────────────
  window._ctisSwitchTab = function(tabId) {
    document.querySelectorAll('.ctis-tab').forEach(function(btn) {
      var active = btn.dataset.ctisTab === tabId;
      btn.style.borderBottomColor = active ? '#14b8a6' : 'transparent';
      btn.style.color = active ? '#14b8a6' : 'var(--ss-muted)';
    });
    ['data-source','search-columns'].forEach(function(id) {
      var el = document.getElementById('ctis-panel-' + id);
      if (el) el.style.display = (id === tabId) ? 'block' : 'none';
    });
    if (tabId === 'search-columns') _ctisRenderColCheckboxes();
  };

  // ── Load settings into form ───────────────────────────────────────
  window._ctisLoadSettings = function() {
    fetch('/api/studio/csv_settings?type=contact_information', { headers: { 'Authorization': 'Bearer ' + _getApiTok() } })
    .then(function(r){ return r.json(); })
    .then(function(d){
      var stored = (d.ok && d.settings) ? d.settings : loadStoredSettings();
      storeSettings(stored);
      var urlEl = document.getElementById('ctis-csv-url');
      if (urlEl) urlEl.value = stored.csvUrl || '';
      window._ctiCsvUrl = stored.csvUrl || '';
      window._ctiSearchCols = (Array.isArray(stored.searchColumns) && stored.searchColumns.length > 0) ? stored.searchColumns : null;
      if (stored.csvUrl && stored.detectedColumns && stored.detectedColumns.length) {
        _showColumnsPreview(stored.detectedColumns, stored.rowCount || null);
      }
      setUrlStatus('', '');
    }).catch(function(){});
  };

  // ── URL normalizer (same logic as Connect+ settings) ─────────────
  function _normalizeUrl(raw) {
    var url = String(raw || '').trim();
    if (!url) return url;
    if (url.includes('output=csv')) return url;
    try {
      var u = new URL(url);
      if (u.pathname.includes('/pub')) {
        u.searchParams.set('output', 'csv');
        return u.toString();
      }
      if (u.pathname.includes('/pubhtml')) {
        var gid = u.searchParams.get('gid') || '';
        u.pathname = u.pathname.replace('/pubhtml', '/pub');
        u.searchParams.set('output', 'csv');
        if (gid) u.searchParams.set('gid', gid);
        return u.toString();
      }
      if (u.pathname.includes('/edit') || u.pathname.includes('/view')) {
        var m = u.pathname.match(/\/d\/([^/]+)/);
        if (m) {
          u.pathname = '/spreadsheets/d/' + m[1] + '/pub';
          u.search = '?output=csv';
          return u.toString();
        }
      }
    } catch(_) {}
    return url;
  }

  // ── onInput: live normalize the URL field ─────────────────────────
  window._ctisOnUrlInput = function(val) {
    var normalized = _normalizeUrl(val);
    if (normalized && normalized !== val) {
      var el = document.getElementById('ctis-csv-url');
      if (el && document.activeElement !== el) el.value = normalized;
    }
  };

  // ── Show detected columns as tags ────────────────────────────────
  function _showColumnsPreview(cols, rowCount) {
    var preview = document.getElementById('ctis-columns-preview');
    var tagsEl  = document.getElementById('ctis-col-tags');
    var countEl = document.getElementById('ctis-row-count');
    if (!preview || !tagsEl) return;
    preview.style.display = 'block';
    if (countEl && rowCount) countEl.textContent = Number(rowCount).toLocaleString() + ' rows';
    tagsEl.innerHTML = cols.map(function(c) {
      return '<span style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:6px;background:rgba(20,184,166,.1);border:1px solid rgba(20,184,166,.22);font-size:10px;font-weight:600;color:#14b8a6;">' +
        '<i class="fas fa-columns" style="font-size:9px;opacity:.7;"></i>' + esc(c) + '</span>';
    }).join('');
  }

  // ── Test URL ──────────────────────────────────────────────────────
  window._ctisTestUrl = function() {
    var urlEl = document.getElementById('ctis-csv-url');
    if (!urlEl) return;
    var raw  = (urlEl.value || '').trim();
    var url  = _normalizeUrl(raw);
    if (!url) { setUrlStatus('<i class="fas fa-exclamation-circle" style="margin-right:6px;"></i>Enter a Google Sheets CSV URL first.', 'err'); return; }
    urlEl.value = url;
    setUrlStatus('<i class="fas fa-spinner fa-spin" style="margin-right:6px;"></i>Fetching preview from Google Sheets…', 'info');

    fetch(url).then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function(text) {
      var lines = text.split('\n').filter(Boolean);
      if (!lines.length) throw new Error('Empty CSV');
      var headers = lines[0].split(',').map(function(h) { return h.replace(/^"|"$/g,'').trim(); });
      var rowCount = lines.length - 1;
      var stored = loadStoredSettings();
      stored.csvUrl          = url;
      stored.detectedColumns = headers;
      stored.rowCount        = rowCount;
      storeSettings(stored);
      window._ctiCsvUrl = url;
      _showColumnsPreview(headers, rowCount);
      setUrlStatus(
        '<i class="fas fa-check-circle" style="margin-right:6px;"></i>' +
        '<strong>Connected!</strong> Detected <strong>' + headers.length + ' columns</strong> · ' +
        '<strong>' + rowCount.toLocaleString() + ' rows</strong><br>' +
        '<span style="opacity:.75;">Columns: ' + headers.slice(0,8).map(esc).join(', ') + (headers.length > 8 ? '…' : '') + '</span>',
        'ok'
      );
    }).catch(function(e) {
      setUrlStatus('<i class="fas fa-exclamation-triangle" style="margin-right:6px;"></i><strong>Failed:</strong> ' + esc(e.message) + '<br><span style="opacity:.75;">Make sure the sheet is Published to the web as CSV.</span>', 'err');
    });
  };

  // ── Save CSV URL ──────────────────────────────────────────────────
  window._ctisSaveSettings = function() {
    var urlEl = document.getElementById('ctis-csv-url');
    var url   = urlEl ? urlEl.value.trim() : '';
    var btn   = document.getElementById('ctis-save-btn');
    if (!url) { showMsg('ctis-save-msg', '✗ Enter a CSV URL first', false); return; }
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…'; btn.style.opacity = '.7'; }
    var stored = loadStoredSettings();
    stored.csvUrl = url;
    fetch('/api/studio/csv_settings?type=contact_information', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _getApiTok() },
      body: JSON.stringify(stored)
    }).then(function(r){
      if (!r.ok) return r.json().catch(function(){ return { ok: false, error: 'HTTP ' + r.status }; })
                               .then(function(d){ throw new Error(d && d.error ? String(d.error) : 'HTTP ' + r.status); });
      return r.json().catch(function(){ return { ok: true }; });
    }).then(function(d){
      if (!d || !d.ok) throw new Error(d && d.error ? String(d.error) : 'Server error');
      storeSettings(stored);
      window._ctiCsvUrl = url;
      showMsg('ctis-save-msg', '✓ Saved globally! Reload Contact Information to apply.', true);
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save Contact Information Settings'; btn.style.opacity = '1'; }
      if (typeof window._preloadStudioSettings === 'function') window._preloadStudioSettings();
      if (typeof window._ctiRefresh === 'function') window._ctiRefresh();
    }).catch(function(err){
      showMsg('ctis-save-msg', '✗ Save failed: ' + (err && err.message ? err.message : 'Network error'), false);
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save Contact Information Settings'; btn.style.opacity = '1'; }
    });
  };

  // ── Search columns checkbox rendering ────────────────────────────
  function _ctisRenderColCheckboxes() {
    var container = document.getElementById('ctis-col-checkboxes');
    if (!container) return;
    var stored = loadStoredSettings();
    var cols   = stored.detectedColumns || [];
    var active = stored.searchColumns || null;
    if (!cols.length) {
      container.innerHTML = '<span style="font-size:11px;color:var(--ss-muted);font-style:italic;">Load a CSV URL first to see columns.</span>';
      return;
    }
    container.innerHTML = cols.map(function(col) {
      var checked = !active || active.indexOf(col) >= 0;
      return '<label style="display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:6px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);cursor:pointer;font-size:11px;color:var(--ss-text);">' +
        '<input type="checkbox" data-ctis-col="' + esc(col) + '" ' + (checked ? 'checked' : '') +
        ' style="accent-color:#14b8a6;cursor:pointer;">' + esc(col) + '</label>';
    }).join('');
  }

  window._ctisSelectAllCols = function(val) {
    document.querySelectorAll('[data-ctis-col]').forEach(function(cb) { cb.checked = val; });
  };

  window._ctisSaveSearchCols = function() {
    var checked = [];
    document.querySelectorAll('[data-ctis-col]:checked').forEach(function(cb) { checked.push(cb.dataset.ctisCol); });
    var stored = loadStoredSettings();
    var allCols = stored.detectedColumns || [];
    stored.searchColumns = (checked.length === allCols.length) ? null : checked;
    storeSettings(stored);
    fetch('/api/studio/csv_settings?type=contact_information', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _getApiTok() },
      body: JSON.stringify(stored)
    }).then(function(r){
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json().catch(function(){ return { ok: true }; });
    }).then(function(d){
      if (!d || !d.ok) throw new Error(d && d.error ? String(d.error) : 'Server error');
      window._ctiSearchCols = stored.searchColumns;
      showMsg('ctis-cols-msg', '✓ Search columns saved.', true);
    }).catch(function(err){
      showMsg('ctis-cols-msg', '✗ Failed: ' + (err && err.message ? err.message : 'Network error'), false);
    });
    window._ctiSearchCols = stored.searchColumns;
    showMsg('ctis-cols-msg', '✓ Search columns saved.', true);
  };

})();
