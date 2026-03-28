// public/js/studio_kb_settings.js
// Knowledge Base Sync — Settings UI  v1.0
// Wired to: GET/POST /api/studio/kb_settings  &  POST /api/studio/kb_sync
// Loaded by support_studio.html via <script src>

(function () {
  'use strict';

  // ── Helpers ─────────────────────────────────────────────────────────────
  var _kbsReady = false;

  function _authHeader() {
    var token = '';
    try {
      // Reuse the same JWT retrieval used by the rest of Support Studio
      if (typeof window.getCloudAuthToken === 'function') token = window.getCloudAuthToken();
      else if (typeof window.__mumsToken !== 'undefined') token = window.__mumsToken;
      else token = localStorage.getItem('mums_token') || '';
    } catch (_) {}
    return token ? { Authorization: 'Bearer ' + token } : {};
  }

  function _ksbShowMsg(id, msg, type) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg;
    el.style.opacity = '1';
    el.style.color = type === 'ok' ? '#3fb950' : type === 'warn' ? '#d29922' : '#f85149';
    clearTimeout(el._fadeTimer);
    el._fadeTimer = setTimeout(function () { el.style.opacity = '0'; }, 3500);
  }

  // Parse QB URL → realm, tableId, qid  (same logic as server parseQbUrl)
  function _kbsParseUrl(url) {
    var out = { realm: '', tableId: '', qid: '' };
    try {
      if (!url) return out;
      var u = new URL(url);
      // realm = first subdomain
      out.realm = u.hostname.split('.')[0] || '';
      // tableId = path segment that looks like a QB table id (alphanumeric, typically 8-12 chars)
      var parts = u.pathname.split('/');
      for (var i = 0; i < parts.length; i++) {
        if (/^[a-z0-9]{8,15}$/i.test(parts[i])) { out.tableId = parts[i]; }
      }
      // qid = query param ?qid=
      out.qid = u.searchParams.get('qid') || '';
    } catch (_) {}
    return out;
  }

  // ── Load settings from server ────────────────────────────────────────────
  function kbsLoad() {
    var statusEl = document.getElementById('kbs-load-status');
    if (statusEl) { statusEl.textContent = 'Loading…'; statusEl.style.color = 'var(--ss-muted)'; }
    fetch('/api/studio/kb_settings', { headers: _authHeader() })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (statusEl) statusEl.textContent = '';
        if (!data.ok) {
          if (statusEl) { statusEl.textContent = 'Failed to load settings.'; statusEl.style.color = '#f85149'; }
          return;
        }
        var s = data.settings || {};
        _kbsSetField('kbs-app-url',    s.quickbaseAppUrl  || '');
        _kbsSetField('kbs-realm',      s.quickbaseRealm   || '');
        _kbsSetField('kbs-table-id',   s.quickbaseTableId || '');
        _kbsSetField('kbs-qid',        s.quickbaseQid     || '');
        _kbsSetField('kbs-schedule',   s.syncSchedule     || '');
        // Token: show placeholder if already set, blank if not
        var tokenInput = document.getElementById('kbs-token');
        if (tokenInput) {
          tokenInput.placeholder = s.quickbaseUserTokenSet
            ? '●●●●●●●●●●●● (token saved — enter new to replace)'
            : 'Enter Quickbase User Token';
          tokenInput.value = '';
        }
        var tokenBadge = document.getElementById('kbs-token-badge');
        if (tokenBadge) {
          tokenBadge.style.display = s.quickbaseUserTokenSet ? 'inline-flex' : 'none';
        }
        // Last synced
        _kbsRenderSyncStatus(s.lastSyncedAt);
      })
      .catch(function () {
        if (statusEl) { statusEl.textContent = 'Network error loading settings.'; statusEl.style.color = '#f85149'; }
      });
  }

  function _kbsSetField(id, val) {
    var el = document.getElementById(id);
    if (el) el.value = val;
  }

  function _kbsRenderSyncStatus(lastSyncedAt) {
    var el = document.getElementById('kbs-last-synced');
    if (!el) return;
    if (!lastSyncedAt) { el.textContent = 'Never synced'; el.style.color = 'var(--ss-muted)'; return; }
    try {
      var d = new Date(lastSyncedAt);
      var now = new Date();
      var diff = Math.floor((now - d) / 1000);
      var label = '';
      if (diff < 60)       label = diff + 's ago';
      else if (diff < 3600) label = Math.floor(diff / 60) + 'm ago';
      else if (diff < 86400) label = Math.floor(diff / 3600) + 'h ago';
      else                  label = Math.floor(diff / 86400) + 'd ago';
      el.textContent = 'Last synced ' + label + ' — ' + d.toLocaleString();
      el.style.color = diff < 3600 ? '#3fb950' : diff < 86400 ? '#d29922' : '#f85149';
    } catch (_) { el.textContent = lastSyncedAt; }
  }

  // ── Auto-fill realm/tableId/qid from URL ────────────────────────────────
  window._kbsAutoFill = function (url) {
    var parsed = _kbsParseUrl(url);
    if (parsed.realm)   { var r = document.getElementById('kbs-realm');    if (r && !r._userEdited) r.value = parsed.realm; }
    if (parsed.tableId) { var t = document.getElementById('kbs-table-id'); if (t && !t._userEdited) t.value = parsed.tableId; }
    if (parsed.qid)     { var q = document.getElementById('kbs-qid');      if (q && !q._userEdited) q.value = parsed.qid; }
  };

  // ── Save settings ────────────────────────────────────────────────────────
  window._kbsSaveSettings = function () {
    var btn = document.getElementById('kbs-save-btn');
    if (btn) { btn.disabled = true; btn.querySelector('span') && (btn.querySelector('span').textContent = 'Saving…'); }

    var tokenEl = document.getElementById('kbs-token');
    var tokenVal = tokenEl ? tokenEl.value.trim() : '';

    var body = {
      quickbaseAppUrl:  (_v('kbs-app-url')).trim(),
      quickbaseRealm:   (_v('kbs-realm')).trim(),
      quickbaseTableId: (_v('kbs-table-id')).trim(),
      quickbaseQid:     (_v('kbs-qid')).trim(),
      syncSchedule:     (_v('kbs-schedule')).trim(),
      // If user left token blank, send sentinel to keep existing
      quickbaseUserToken: tokenVal || '__KEEP__'
    };

    fetch('/api/studio/kb_settings', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, _authHeader()),
      body: JSON.stringify(body)
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (btn) { btn.disabled = false; btn.querySelector('span') && (btn.querySelector('span').textContent = 'Save KB Settings'); }
        if (data.ok) {
          _ksbShowMsg('kbs-save-msg', '✓ Settings saved', 'ok');
          var s = data.settings || {};
          var tokenBadge = document.getElementById('kbs-token-badge');
          if (tokenBadge) tokenBadge.style.display = s.quickbaseUserTokenSet ? 'inline-flex' : 'none';
          if (tokenEl) tokenEl.value = '';
        } else {
          _ksbShowMsg('kbs-save-msg', '✗ ' + (data.error || 'Save failed'), 'err');
        }
      })
      .catch(function () {
        if (btn) { btn.disabled = false; }
        _ksbShowMsg('kbs-save-msg', '✗ Network error', 'err');
      });
  };

  function _v(id) { var el = document.getElementById(id); return el ? el.value : ''; }

  // ── Manual Sync ──────────────────────────────────────────────────────────
  window._kbsRunSync = function () {
    var btn = document.getElementById('kbs-sync-btn');
    var icon = document.getElementById('kbs-sync-icon');
    var label = document.getElementById('kbs-sync-label');
    if (btn) btn.disabled = true;
    if (icon) { icon.className = 'fas fa-sync-alt fa-spin'; }
    if (label) label.textContent = 'Syncing…';
    _ksbShowMsg('kbs-sync-msg', '', '');

    fetch('/api/studio/kb_sync', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, _authHeader())
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (btn) btn.disabled = false;
        if (icon) icon.className = 'fas fa-sync-alt';
        if (label) label.textContent = 'Sync Now';
        if (data.ok) {
          _ksbShowMsg('kbs-sync-msg', '✓ Synced ' + (data.count || 0) + ' records', 'ok');
          _kbsRenderSyncStatus(data.syncedAt);
          kbsLoadStats(data.count);
        } else {
          _ksbShowMsg('kbs-sync-msg', '✗ ' + (data.error || 'Sync failed'), 'err');
        }
      })
      .catch(function () {
        if (btn) btn.disabled = false;
        if (icon) icon.className = 'fas fa-sync-alt';
        if (label) label.textContent = 'Sync Now';
        _ksbShowMsg('kbs-sync-msg', '✗ Network error', 'err');
      });
  };

  // ── Load KB item stats for the overview bar ───────────────────────────────
  function kbsLoadStats(preloadCount) {
    fetch('/api/studio/kb_sync', { headers: _authHeader() })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.ok) return;
        var count = typeof preloadCount === 'number' ? preloadCount : (data.count || 0);
        var tables = data.tables || [];
        // Update stats pills
        var elTotal   = document.getElementById('kbs-stat-total');
        var elTables  = document.getElementById('kbs-stat-tables');
        var elSynced  = document.getElementById('kbs-stat-synced');
        if (elTotal)  elTotal.textContent  = count.toLocaleString();
        if (elTables) elTables.textContent = tables.length;
        // Update table preview list
        var listEl = document.getElementById('kbs-table-list');
        if (listEl && tables.length) {
          listEl.innerHTML = tables.map(function (t) {
            var name = t.table_name || t.name || t;
            var cnt  = t.count !== undefined ? t.count : '';
            return '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.05);">' +
              '<i class="fas fa-table" style="font-size:10px;color:#22d3ee;width:14px;text-align:center;"></i>' +
              '<span style="flex:1;font-size:11px;color:var(--ss-text);">' + name + '</span>' +
              (cnt !== '' ? '<span style="font-size:10px;color:var(--ss-muted);">' + cnt + ' rows</span>' : '') +
              '</div>';
          }).join('');
        } else if (listEl) {
          listEl.innerHTML = '<div style="font-size:11px;color:var(--ss-muted);padding:8px 0;">No tables synced yet.</div>';
        }
        _kbsRenderSyncStatus(data.syncedAt);
      })
      .catch(function () {});
  }

  // ── Schedule helper ──────────────────────────────────────────────────────
  window._kbsSetSchedule = function (val) {
    var el = document.getElementById('kbs-schedule');
    if (el) {
      el.value = val;
      el._userEdited = true;
    }
    // Highlight the active preset button
    document.querySelectorAll('.kbs-preset-btn').forEach(function (b) {
      b.style.background = b.dataset.val === val
        ? 'rgba(34,211,238,.15)'
        : 'rgba(255,255,255,.04)';
      b.style.borderColor = b.dataset.val === val
        ? 'rgba(34,211,238,.4)'
        : 'rgba(255,255,255,.1)';
      b.style.color = b.dataset.val === val ? '#22d3ee' : 'var(--ss-muted)';
    });
  };

  // ── Boot: called when the settings section becomes visible ───────────────
  window._kbsInit = function () {
    if (_kbsReady) return;
    _kbsReady = true;
    kbsLoad();
    kbsLoadStats();
  };

  // ── Hook into settings nav: auto-init when section becomes visible ────────
  (function _hookSettingsNav() {
    function _maybeInit(sectionId) {
      if (sectionId === 'kb-settings') window._kbsInit();
    }
    // If the settings nav listener fires a custom event
    document.addEventListener('ss:settings:section', function (e) {
      if (e && e.detail) _maybeInit(e.detail);
    });
    // Fallback: poll for visibility of the section div (for MutationObserver)
    var _observer = new MutationObserver(function () {
      var el = document.getElementById('settings-section-kb-settings');
      if (el && el.style.display !== 'none') window._kbsInit();
    });
    document.addEventListener('DOMContentLoaded', function () {
      var el = document.getElementById('settings-section-kb-settings');
      if (el) _observer.observe(el, { attributes: true, attributeFilter: ['style'] });
    });
  })();

})();
