/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

// public/js/studio_kb_settings.js
// Knowledge Base Sync — Settings UI  v1.1
// Strategy: replaces the stub #settings-section-kb-settings HTML with
// the full, wired panel at DOMContentLoaded, then runs logic.
// Wired to: GET/POST /api/studio/kb_settings  &  POST /api/studio/kb_sync

(function () {
  'use strict';

  // ── Rich HTML for the KB settings panel ──────────────────────────────────
  var KB_PANEL_HTML = [
    '<div style="display:flex;align-items:center;gap:14px;margin-bottom:0;">',
      '<div style="width:44px;height:44px;border-radius:12px;background:rgba(34,211,238,.1);border:1px solid rgba(34,211,238,.25);display:flex;align-items:center;justify-content:center;flex-shrink:0;">',
        '<i class="fas fa-book" style="color:#22d3ee;font-size:18px;"></i>',
      '</div>',
      '<div>',
        '<div style="font-size:17px;font-weight:900;color:#e6edf3;letter-spacing:-.01em;">Knowledge Base Sync</div>',
        '<div style="font-size:11px;color:var(--ss-muted);margin-top:2px;">Connect a Quickbase report as your KB data source. Records sync to the <a onclick="document.querySelector(\"[data-tab=knowledge_base]\").click()" style="color:#22d3ee;cursor:pointer;text-decoration:none;font-weight:700;">Knowledge Base</a> tab.</div>',
      '</div>',
    '</div>',
    '<div style="height:1px;background:linear-gradient(90deg,rgba(34,211,238,.3),transparent);margin:18px 0 0;"></div>',

    // ── Stats row ─────────────────────────────────────────────────────────
    '<div style="display:flex;gap:10px;padding:14px 0;flex-wrap:wrap;">',
      '<div style="background:rgba(34,211,238,.07);border:1px solid rgba(34,211,238,.15);border-radius:8px;padding:10px 16px;min-width:110px;">',
        '<div style="font-size:20px;font-weight:800;color:#22d3ee;" id="kbs-stat-total">—</div>',
        '<div style="font-size:9px;color:rgba(255,255,255,.3);font-weight:500;">KB Records</div>',
      '</div>',
      '<div style="background:rgba(63,185,80,.07);border:1px solid rgba(63,185,80,.15);border-radius:8px;padding:10px 16px;min-width:110px;">',
        '<div style="font-size:20px;font-weight:800;color:#3fb950;" id="kbs-stat-tables">—</div>',
        '<div style="font-size:9px;color:rgba(255,255,255,.3);font-weight:500;">Tables</div>',
      '</div>',
      '<div style="flex:1;min-width:160px;display:flex;flex-direction:column;justify-content:center;padding:10px 14px;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:8px;">',
        '<div style="font-size:10px;font-weight:700;color:var(--ss-muted);margin-bottom:2px;">Last Synced</div>',
        '<div style="font-size:11px;font-weight:600;" id="kbs-last-synced">—</div>',
      '</div>',
    '</div>',

    // ── Form ──────────────────────────────────────────────────────────────
    '<div style="max-width:660px;">',

      // App URL
      '<div style="margin-bottom:14px;">',
        '<label style="font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--ss-muted);display:block;margin-bottom:5px;">Quickbase App / Report URL</label>',
        '<input id="kbs-app-url" class="ss-input" type="text"',
          ' placeholder="https://your-realm.quickbase.com/nav/app/…/table/abcde123/action/q?qid=42"',
          ' style="font-size:11px;"',
          ' oninput="window._kbsAutoFill(this.value)"',
          ' onpaste="setTimeout(function(){window._kbsAutoFill(document.getElementById(\"kbs-app-url\").value)},10)">',
        '<div style="font-size:10px;color:rgba(245,158,11,.8);margin-top:4px;display:flex;align-items:center;gap:5px;">',
          '<i class="fas fa-bolt" style="font-size:9px;"></i> Realm, Table ID and QID auto-fill from the URL',
        '</div>',
      '</div>',

      // Realm / Table ID / QID row
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:14px;">',
        '<div>',
          '<label style="font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--ss-muted);display:block;margin-bottom:5px;">Realm</label>',
          '<input id="kbs-realm" class="ss-input" type="text" placeholder="your-company" style="font-size:11px;">',
        '</div>',
        '<div>',
          '<label style="font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--ss-muted);display:block;margin-bottom:5px;">Table ID</label>',
          '<input id="kbs-table-id" class="ss-input" type="text" placeholder="abcde12f" style="font-size:11px;">',
        '</div>',
        '<div>',
          '<label style="font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--ss-muted);display:block;margin-bottom:5px;">QID</label>',
          '<input id="kbs-qid" class="ss-input" type="text" placeholder="e.g. 1000315" style="font-size:11px;">',
        '</div>',
      '</div>',

      // Token
      '<div style="margin-bottom:14px;">',
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">',
          '<label style="font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--ss-muted);">User Token</label>',
          '<span id="kbs-token-badge"',
            ' style="display:none;font-size:9px;font-weight:700;padding:1px 7px;border-radius:20px;background:rgba(63,185,80,.12);color:#3fb950;border:1px solid rgba(63,185,80,.3);">',
            '\u2713 Token Saved</span>',
        '</div>',
        '<input type="password" autocomplete="new-password" tabindex="-1"',
          ' style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;">',
        '<input id="kbs-token" class="ss-input" type="password"',
          ' autocomplete="new-password" data-lpignore="true"',
          ' placeholder="Enter Quickbase User Token" style="font-size:11px;">',
        '<div style="font-size:10px;color:var(--ss-muted);margin-top:4px;">Token is encrypted on the server. Leave blank to keep existing.</div>',
      '</div>',

      // Sync schedule
      '<div style="margin-bottom:20px;">',
        '<label style="font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--ss-muted);display:block;margin-bottom:5px;">Sync Schedule</label>',
        '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">',
          '<button class="kbs-preset-btn" data-val="" onclick="window._kbsSetSchedule(\'\')"',
            ' style="padding:5px 12px;border-radius:6px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);color:var(--ss-muted);font-size:11px;font-weight:600;font-family:var(--ss-font);cursor:pointer;">Manual</button>',
          '<button class="kbs-preset-btn" data-val="0 * * * *" onclick="window._kbsSetSchedule(\'0 * * * *\')"',
            ' style="padding:5px 12px;border-radius:6px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);color:var(--ss-muted);font-size:11px;font-weight:600;font-family:var(--ss-font);cursor:pointer;">Hourly</button>',
          '<button class="kbs-preset-btn" data-val="0 0 * * *" onclick="window._kbsSetSchedule(\'0 0 * * *\')"',
            ' style="padding:5px 12px;border-radius:6px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);color:var(--ss-muted);font-size:11px;font-weight:600;font-family:var(--ss-font);cursor:pointer;">Daily (midnight)</button>',
          '<button class="kbs-preset-btn" data-val="0 6 * * 1" onclick="window._kbsSetSchedule(\'0 6 * * 1\')"',
            ' style="padding:5px 12px;border-radius:6px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);color:var(--ss-muted);font-size:11px;font-weight:600;font-family:var(--ss-font);cursor:pointer;">Weekly (Mon 6AM)</button>',
        '</div>',
        '<input id="kbs-schedule" class="ss-input" type="text"',
          ' placeholder="cron expression or leave blank for manual-only" style="font-size:11px;font-family:monospace;">',
        '<div style="font-size:10px;color:var(--ss-muted);margin-top:4px;">Cron format: <code style="color:#22d3ee;">minute hour day month weekday</code>. Example: <code style="color:#22d3ee;">0 6 * * *</code> = daily at 6 AM.</div>',
      '</div>',

      // Save row
      '<div style="display:flex;align-items:center;gap:10px;padding-top:16px;border-top:1px solid var(--ss-border2);">',
        '<span id="kbs-load-status" style="font-size:10px;color:var(--ss-muted);"></span>',
      '</div>',
      '<div style="display:flex;align-items:center;gap:10px;margin-top:12px;">',
        '<button id="kbs-save-btn" onclick="window._kbsSaveSettings()"',
          ' style="background:linear-gradient(135deg,#0e7490,#155e75);border:1px solid rgba(34,211,238,.4);color:#fff;padding:10px 24px;border-radius:9px;font-size:12px;font-weight:800;font-family:var(--ss-font);cursor:pointer;display:flex;align-items:center;gap:8px;box-shadow:0 4px 20px rgba(34,211,238,.18);">',
          '<i class="fas fa-save"></i><span>Save KB Settings</span>',
        '</button>',
        '<span id="kbs-save-msg" style="font-size:11px;opacity:0;transition:opacity .3s;font-weight:600;"></span>',
      '</div>',

    '</div>',

    // ── Manual Sync section ────────────────────────────────────────────────
    '<div style="margin-top:28px;padding-top:22px;border-top:1px solid var(--ss-border);">',
      '<div style="font-size:13px;font-weight:800;color:#e6edf3;margin-bottom:6px;">Manual Sync</div>',
      '<div style="font-size:11px;color:var(--ss-muted);margin-bottom:14px;">Trigger an immediate sync from Quickbase to the Knowledge Base. Records are upserted — nothing is deleted.</div>',
      '<div style="display:flex;align-items:center;gap:10px;">',
        '<button id="kbs-sync-btn" onclick="window._kbsRunSync()"',
          ' style="background:rgba(34,211,238,.1);border:1px solid rgba(34,211,238,.3);color:#22d3ee;padding:9px 18px;border-radius:8px;font-size:12px;font-weight:700;font-family:var(--ss-font);cursor:pointer;display:flex;align-items:center;gap:7px;transition:background .15s;">',
          '<i class="fas fa-sync-alt" id="kbs-sync-icon"></i>',
          '<span id="kbs-sync-label">Sync Now</span>',
        '</button>',
        '<span id="kbs-sync-msg" style="font-size:11px;font-weight:600;"></span>',
      '</div>',
    '</div>',

    // ── Synced tables preview ──────────────────────────────────────────────
    '<div style="margin-top:24px;padding-top:20px;border-top:1px solid var(--ss-border);">',
      '<div style="font-size:12px;font-weight:800;color:#e6edf3;margin-bottom:10px;">Synced Tables</div>',
      '<div id="kbs-table-list" style="background:var(--ss-surface3);border:1px solid var(--ss-border);border-radius:8px;padding:10px 12px;min-height:40px;">',
        '<div style="font-size:11px;color:var(--ss-muted);">No tables synced yet.</div>',
      '</div>',
    '</div>'
  ].join('');

  // ── Inject panel at DOM ready ─────────────────────────────────────────────
  function _inject() {
    var el = document.getElementById('settings-section-kb-settings');
    if (!el) return;
    el.innerHTML = KB_PANEL_HTML;
    var schedEl = document.getElementById('kbs-schedule');
    if (schedEl) schedEl.addEventListener('input', function () { schedEl._userEdited = true; });
    var realmEl = document.getElementById('kbs-realm');
    var tableEl = document.getElementById('kbs-table-id');
    var qidEl   = document.getElementById('kbs-qid');
    if (realmEl)  realmEl.addEventListener('input',  function () { realmEl._userEdited  = true; });
    if (tableEl)  tableEl.addEventListener('input',  function () { tableEl._userEdited  = true; });
    if (qidEl)    qidEl.addEventListener('input',    function () { qidEl._userEdited    = true; });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function _authHeader() {
    var token = '';
    try {
      if (typeof window.getCloudAuthToken === 'function') token = window.getCloudAuthToken();
      else if (typeof window.__mumsToken !== 'undefined') token = window.__mumsToken;
      else token = localStorage.getItem('mums_token') || '';
    } catch (_) {}
    return token ? { Authorization: 'Bearer ' + token } : {};
  }

  function _showMsg(id, msg, type) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg;
    el.style.opacity = '1';
    el.style.color = type === 'ok' ? '#3fb950' : type === 'warn' ? '#d29922' : '#f85149';
    clearTimeout(el._ft);
    el._ft = setTimeout(function () { el.style.opacity = '0'; }, 4000);
  }

  function _kbsParseUrl(url) {
    var out = { realm: '', tableId: '', qid: '' };
    try {
      if (!url) return out;
      var u = new URL(url);
      out.realm = u.hostname.split('.')[0] || '';
      var parts = u.pathname.replace(/\/+$/, '').split('/');
      for (var i = 0; i < parts.length; i++) {
        if (/^[a-z0-9]{6,16}$/i.test(parts[i])) out.tableId = parts[i];
      }
      out.qid = u.searchParams.get('qid') || '';
    } catch (_) {}
    return out;
  }

  window._kbsAutoFill = function (url) {
    var p = _kbsParseUrl(url);
    var r = document.getElementById('kbs-realm');
    var t = document.getElementById('kbs-table-id');
    var q = document.getElementById('kbs-qid');
    if (r && !r._userEdited && p.realm)   r.value = p.realm;
    if (t && !t._userEdited && p.tableId) t.value = p.tableId;
    if (q && !q._userEdited && p.qid)     q.value = p.qid;
  };

  window._kbsSetSchedule = function (val) {
    var el = document.getElementById('kbs-schedule');
    if (el) el.value = val;
    document.querySelectorAll('.kbs-preset-btn').forEach(function (b) {
      var isActive = b.dataset.val === val;
      b.style.background  = isActive ? 'rgba(34,211,238,.15)' : 'rgba(255,255,255,.04)';
      b.style.borderColor = isActive ? 'rgba(34,211,238,.4)'  : 'rgba(255,255,255,.1)';
      b.style.color       = isActive ? '#22d3ee'              : 'var(--ss-muted)';
    });
  };

  function _renderSyncStatus(lastSyncedAt) {
    var el = document.getElementById('kbs-last-synced');
    if (!el) return;
    if (!lastSyncedAt) { el.textContent = 'Never synced'; el.style.color = 'var(--ss-muted)'; return; }
    try {
      var d = new Date(lastSyncedAt);
      var diff = Math.floor((Date.now() - d) / 1000);
      var label = diff < 60 ? diff + 's ago'
        : diff < 3600  ? Math.floor(diff / 60)   + 'm ago'
        : diff < 86400 ? Math.floor(diff / 3600)  + 'h ago'
        :                Math.floor(diff / 86400) + 'd ago';
      el.textContent = 'Last synced ' + label + ' — ' + d.toLocaleString();
      el.style.color = diff < 3600 ? '#3fb950' : diff < 86400 ? '#d29922' : '#f85149';
    } catch (_) { el.textContent = lastSyncedAt; }
  }

  function _kbsLoad() {
    var st = document.getElementById('kbs-load-status');
    if (st) { st.textContent = 'Loading\u2026'; st.style.color = 'var(--ss-muted)'; }
    fetch('/api/studio/kb_settings', { headers: _authHeader() })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (st) st.textContent = '';
        if (!data.ok) { if (st) { st.textContent = 'Failed to load: ' + (data.error || 'error'); st.style.color = '#f85149'; } return; }
        var s = data.settings || {};
        function sv(id, v) { var e = document.getElementById(id); if (e) e.value = v || ''; }
        sv('kbs-app-url',  s.quickbaseAppUrl);
        sv('kbs-realm',    s.quickbaseRealm);
        sv('kbs-table-id', s.quickbaseTableId);
        sv('kbs-qid',      s.quickbaseQid);
        sv('kbs-schedule', s.syncSchedule);
        if (s.syncSchedule) window._kbsSetSchedule(s.syncSchedule);
        var tok = document.getElementById('kbs-token');
        if (tok) tok.placeholder = s.quickbaseUserTokenSet
          ? '\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf (token saved \u2014 enter new to replace)'
          : 'Enter Quickbase User Token';
        var badge = document.getElementById('kbs-token-badge');
        if (badge) badge.style.display = s.quickbaseUserTokenSet ? 'inline-flex' : 'none';
        _renderSyncStatus(s.lastSyncedAt);
      })
      .catch(function () { if (st) { st.textContent = 'Network error.'; st.style.color = '#f85149'; } });
  }

  window._kbsSaveSettings = function () {
    var btn = document.getElementById('kbs-save-btn');
    var sp  = btn && btn.querySelector('span');
    if (btn) btn.disabled = true;
    if (sp)  sp.textContent = 'Saving\u2026';
    var tok = document.getElementById('kbs-token');
    var tokVal = tok ? tok.value.trim() : '';
    var body = {
      quickbaseAppUrl:    _v('kbs-app-url'),
      quickbaseRealm:     _v('kbs-realm'),
      quickbaseTableId:   _v('kbs-table-id'),
      quickbaseQid:       _v('kbs-qid'),
      syncSchedule:       _v('kbs-schedule'),
      quickbaseUserToken: tokVal || '__KEEP__'
    };
    fetch('/api/studio/kb_settings', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, _authHeader()),
      body: JSON.stringify(body)
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (btn) btn.disabled = false;
        if (sp)  sp.textContent = 'Save KB Settings';
        if (data.ok) {
          _showMsg('kbs-save-msg', '\u2713 Saved', 'ok');
          var s = data.settings || {};
          var badge = document.getElementById('kbs-token-badge');
          if (badge) badge.style.display = s.quickbaseUserTokenSet ? 'inline-flex' : 'none';
          if (tok) tok.value = '';
        } else {
          _showMsg('kbs-save-msg', '\u2717 ' + (data.error || 'Save failed'), 'err');
        }
      })
      .catch(function () {
        if (btn) btn.disabled = false;
        if (sp)  sp.textContent = 'Save KB Settings';
        _showMsg('kbs-save-msg', '\u2717 Network error', 'err');
      });
  };

  function _v(id) { var e = document.getElementById(id); return e ? e.value.trim() : ''; }

  window._kbsRunSync = function () {
    var btn   = document.getElementById('kbs-sync-btn');
    var icon  = document.getElementById('kbs-sync-icon');
    var label = document.getElementById('kbs-sync-label');
    if (btn)   btn.disabled = true;
    if (icon)  icon.className = 'fas fa-sync-alt fa-spin';
    if (label) label.textContent = 'Syncing\u2026';
    fetch('/api/studio/kb_sync', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, _authHeader())
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (btn)   btn.disabled = false;
        if (icon)  icon.className = 'fas fa-sync-alt';
        if (label) label.textContent = 'Sync Now';
        if (data.ok) {
          _showMsg('kbs-sync-msg', '\u2713 Synced ' + (data.count || 0) + ' records', 'ok');
          _renderSyncStatus(data.syncedAt);
          var tot = document.getElementById('kbs-stat-total');
          if (tot) tot.textContent = (data.count || 0).toLocaleString();
          _kbsLoadStats();
        } else {
          _showMsg('kbs-sync-msg', '\u2717 ' + (data.error || 'Sync failed'), 'err');
        }
      })
      .catch(function () {
        if (btn)   btn.disabled = false;
        if (icon)  icon.className = 'fas fa-sync-alt';
        if (label) label.textContent = 'Sync Now';
        _showMsg('kbs-sync-msg', '\u2717 Network error', 'err');
      });
  };

  function _kbsLoadStats() {
    fetch('/api/studio/kb_sync', { headers: _authHeader() })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.ok) return;
        var tot = document.getElementById('kbs-stat-total');
        var tbl = document.getElementById('kbs-stat-tables');
        var lst = document.getElementById('kbs-table-list');
        if (tot) tot.textContent = (data.count || 0).toLocaleString();
        var tables = data.tables || [];
        if (tbl) tbl.textContent = tables.length;
        if (lst) {
          if (tables.length) {
            lst.innerHTML = tables.map(function (t) {
              var n = t.table_name || t.name || t;
              var c = t.count !== undefined ? t.count : '';
              return '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.05);">'
                + '<i class="fas fa-table" style="font-size:10px;color:#22d3ee;width:14px;text-align:center;"></i>'
                + '<span style="flex:1;font-size:11px;color:var(--ss-text);">' + n + '</span>'
                + (c !== '' ? '<span style="font-size:10px;color:var(--ss-muted);">' + c + ' rows</span>' : '')
                + '</div>';
            }).join('');
          } else {
            lst.innerHTML = '<div style="font-size:11px;color:var(--ss-muted);padding:4px 0;">No tables synced yet.</div>';
          }
        }
        _renderSyncStatus(data.syncedAt);
      })
      .catch(function () {});
  }

  // ── Init — FIX: handle already-visible element on direct load / refresh ──
  function _kbsLoadOnce() {
    if (_kbsLoadOnce._done) return;
    _kbsLoadOnce._done = true;
    _inject();
    _kbsLoad();
    _kbsLoadStats();
  }

  function _tryLoad() {
    var el = document.getElementById('settings-section-kb-settings');
    if (!el) return;
    // If already visible — load immediately (fixes direct-load race condition)
    var cs = window.getComputedStyle(el);
    if (cs.display !== 'none' && cs.visibility !== 'hidden' && el.offsetParent !== null) {
      _kbsLoadOnce();
      return;
    }
    // Otherwise watch for visibility change (tab switching)
    var obs = new MutationObserver(function () {
      var s = window.getComputedStyle(el);
      if (s.display !== 'none' && s.visibility !== 'hidden' && el.offsetParent !== null) {
        obs.disconnect();
        _kbsLoadOnce();
      }
    });
    obs.observe(el, { attributes: true, attributeFilter: ['style', 'class'] });
    // Also watch parent container for tab-switch class changes
    if (el.parentElement) {
      var pObs = new MutationObserver(function () {
        var s2 = window.getComputedStyle(el);
        if (s2.display !== 'none' && s2.visibility !== 'hidden' && el.offsetParent !== null) {
          pObs.disconnect();
          obs.disconnect();
          _kbsLoadOnce();
        }
      });
      pObs.observe(el.parentElement, { attributes: true, attributeFilter: ['style', 'class'] });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _tryLoad);
  } else {
    _tryLoad();
  }

})();
