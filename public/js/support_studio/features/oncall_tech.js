/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

/* ═══════════════════════════════════════════════════════════════════
   ONCALL TECH SETTINGS & SCHEDULE MODULE v1.0
   Settings:  GET/POST /api/studio/oncall_settings
   Schedule:  GET      /api/studio/oncall_schedule
   Renders the ICare Oncall Tech card on the Home page with live QB data.
   Token inherited from Studio QB Settings — only report link stored here.
═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── auth token ─────────────────────────────────────────────── */
  function _getToken() {
    try {
      var raw = localStorage.getItem('mums_supabase_session') || sessionStorage.getItem('mums_supabase_session');
      if (raw) { var p = JSON.parse(raw); if (p && p.access_token) return p.access_token; }
      if (window.CloudAuth && typeof window.CloudAuth.accessToken === 'function') return window.CloudAuth.accessToken() || '';
    } catch(_) {}
    return '';
  }
  function _authHeaders() {
    var t = _getToken();
    return t ? { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + t } : { 'Content-Type': 'application/json' };
  }

  /* ── URL parser (same logic as server) ─────────────────────── */
  function _parseQbUrl(url) {
    var out = { realm: '', tableId: '', qid: '' };
    if (!url) return out;
    try {
      var u = new URL(url);
      // Realm from hostname: realm.quickbase.com
      var host = String(u.hostname || '').toLowerCase();
      var m = host.match(/^([a-z0-9-]+)\.quickbase\.com$/i);
      if (m) out.realm = m[1];
      var segs = u.pathname.split('/').filter(Boolean);
      // Primary: /table/{tableId}
      var ti = segs.findIndex(function(s) { return s.toLowerCase() === 'table'; });
      if (ti >= 0 && segs[ti + 1]) out.tableId = segs[ti + 1];
      // Legacy /db/{tableId}
      if (!out.tableId) {
        var di = segs.findIndex(function(s) { return s.toLowerCase() === 'db'; });
        if (di >= 0 && segs[di + 1]) out.tableId = segs[di + 1];
      }
      // Fallback: QB short URLs /nav/app/{id}/action/q (no /table/ present)
      // treat the segment after /app/ as tableId
      if (!out.tableId) {
        var ai = segs.findIndex(function(s) { return s.toLowerCase() === 'app'; });
        if (ai >= 0 && segs[ai + 1]) out.tableId = segs[ai + 1];
      }
      var rawQid = u.searchParams.get('qid') || '';
      var qm = rawQid.match(/-?\d+/);
      if (qm) out.qid = qm[0];
      if (!out.qid) {
        var rm = url.match(/[?&]qid=(-?\d+)/i);
        if (rm) out.qid = rm[1];
      }
    } catch(_) {}
    return out;
  }

  /* ── show save message helper ───────────────────────────────── */
  function _showMsg(id, text, ok) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.style.cssText = 'font-size:11px;opacity:1;font-weight:600;color:' + (ok ? '#3fb950' : '#f85149') + ';transition:opacity .3s;';
    clearTimeout(el._t);
    el._t = setTimeout(function() { el.style.opacity = '0'; }, 4000);
  }

  /* ══════════════════════════════════════════════════════════════
     SETTINGS: load / save / autofill
  ══════════════════════════════════════════════════════════════ */
  window._ocsAutoFill = function(val) {
    var p = _parseQbUrl(val);
    var el = function(id) { return document.getElementById(id); };
    if (el('ocs-realm'))    el('ocs-realm').value    = p.realm;
    if (el('ocs-table-id')) el('ocs-table-id').value = p.tableId;
    if (el('ocs-qid'))      el('ocs-qid').value      = p.qid;
  };

  window._ocsLoadSettings = function() {
    fetch('/api/studio/oncall_settings', { headers: _authHeaders() })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (!d.ok || !d.settings) return;
        var s = d.settings;
        var el = function(id) { return document.getElementById(id); };
        if (el('ocs-report-link')) el('ocs-report-link').value = s.reportLink || '';
        if (el('ocs-realm'))       el('ocs-realm').value       = s.realm      || '';
        if (el('ocs-table-id'))    el('ocs-table-id').value    = s.tableId    || '';
        if (el('ocs-qid'))         el('ocs-qid').value         = s.qid        || '';
      })
      .catch(function() {});
  };

  window._ocsSaveSettings = function() {
    var el = function(id) { return document.getElementById(id); };
    var reportLink = el('ocs-report-link') ? el('ocs-report-link').value.trim() : '';
    var btn = el('ocs-save-btn');
    if (!reportLink) { _showMsg('ocs-save-msg', '✗ Enter the QB Report Link first', false); return; }
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…'; btn.style.opacity = '.7'; }
    var parsed = _parseQbUrl(reportLink);
    fetch('/api/studio/oncall_settings', {
      method: 'POST',
      headers: _authHeaders(),
      body: JSON.stringify({ reportLink: reportLink, realm: parsed.realm, tableId: parsed.tableId, qid: parsed.qid })
    })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (!d.ok) throw new Error(d.error || 'Save failed');
      _showMsg('ocs-save-msg', '✓ Saved! Home page will refresh.', true);
      // Auto-fill extracted fields
      if (el('ocs-realm'))    el('ocs-realm').value    = d.settings.realm    || parsed.realm;
      if (el('ocs-table-id')) el('ocs-table-id').value = d.settings.tableId  || parsed.tableId;
      if (el('ocs-qid'))      el('ocs-qid').value      = d.settings.qid      || parsed.qid;
      // Refresh home card
      _ocsLoadHomeCard();
    })
    .catch(function(err) { _showMsg('ocs-save-msg', '✗ ' + (err.message || 'Save failed'), false); })
    .finally(function() {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save Oncall Settings'; btn.style.opacity = '1'; }
    });
  };

  window._ocsTestConnection = function() {
    var el = function(id) { return document.getElementById(id); };
    var msg = el('ocs-save-msg');
    if (msg) { msg.textContent = 'Testing…'; msg.style.cssText = 'font-size:11px;opacity:1;color:#22d3ee;font-weight:600;'; }
    fetch('/api/studio/oncall_schedule', { headers: _authHeaders() })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.error === 'not_found' || d.path) {
          // Route 404 — server not yet deployed with this route
          _showMsg('ocs-save-msg', '✗ API route not found — redeploy the server', false);
        } else if (!d.ok && !d.configured) {
          _showMsg('ocs-save-msg', '✗ ' + (d.message || 'Not configured — save the report link first'), false);
        } else if (!d.ok) {
          _showMsg('ocs-save-msg', '✗ QB Error: ' + (d.message || d.error || 'Unknown QB error'), false);
        } else if (d.onDutyToday) {
          _showMsg('ocs-save-msg', '✓ Connected! On duty: ' + d.wmTech + ' (' + d.daysLeft + 'd left)', true);
        } else {
          _showMsg('ocs-save-msg', '✓ Connected — checked ' + (d.totalRecords || 0) + ' records, no schedule for today (' + d.todayPHT + ' PHT)', true);
        }
      })
      .catch(function(err) { _showMsg('ocs-save-msg', '✗ Network error: ' + err.message, false); });
  };

  /* ══════════════════════════════════════════════════════════════
     HOME CARD: render the ICare Oncall Tech card
  ══════════════════════════════════════════════════════════════ */
  function _el(id) { return document.getElementById(id); }
  function _show(id) { var e = _el(id); if (e) e.style.display = ''; }
  function _hide(id) { var e = _el(id); if (e) e.style.display = 'none'; }
  function _setText(id, txt) { var e = _el(id); if (e) e.textContent = txt; }

  function _setCardState(state) {
    // states: 'loading' | 'on-duty' | 'no-schedule' | 'not-configured'
    _hide('oc-loading');
    _hide('oc-no-schedule');
    _hide('oc-not-configured');
    _hide('oc-techs-grid');
    _hide('oc-sched-bar');
    _hide('oc-live-wrap');
    if (state === 'loading')        { _show('oc-loading'); }
    else if (state === 'on-duty')   { _show('oc-live-wrap'); _show('oc-sched-bar'); _show('oc-techs-grid'); }
    else if (state === 'no-schedule') { _show('oc-no-schedule'); }
    else if (state === 'not-configured') { _show('oc-not-configured'); }
  }

  function _ocsLoadHomeCard() {
    if (!_el('oc-card')) return; // card not in DOM yet

    _setCardState('loading');

    fetch('/api/studio/oncall_schedule', { headers: _authHeaders() })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        // Route not found (server not yet deployed) — treat as not configured
        if (d.error === 'not_found') {
          _setCardState('not-configured');
          return;
        }
        if (!d.configured) {
          _setCardState('not-configured');
          return;
        }
        if (!d.ok) {
          // QB API error — show in no-schedule state with message
          _setCardState('no-schedule');
          _setText('oc-no-sched-date', d.message || d.error || 'QB error');
          return;
        }
        if (!d.onDutyToday) {
          _setCardState('no-schedule');
          _setText('oc-no-sched-date', d.todayPHT ? d.todayPHT + ' PHT' : '');
          return;
        }
        // On duty — populate fields
        _setText('oc-sched-dates', d.startDateLabel + '  →  ' + d.endDateLabel);
        _setText('oc-wm-name',     d.wmTech    || '—');
        _setText('oc-wm-ava',      d.wmInitials || '??');
        _setText('oc-wm-phone',    d.wmPhone   || '—');
        _setText('oc-ca-name',     d.caTech    || '—');
        _setText('oc-ca-ava',      d.caInitials || '??');
        _setText('oc-ca-phone',    d.caPhone   || '—');
        var daysLabel = d.daysLeft !== undefined ? d.daysLeft + ' day' + (d.daysLeft !== 1 ? 's' : '') + ' left' : '';
        _setText('oc-days-left-wm', daysLabel);
        _setText('oc-days-left-ca', daysLabel);
        _setCardState('on-duty');
      })
      .catch(function(err) {
        console.warn('[OCS] Failed to load oncall schedule:', err.message);
        _setCardState('not-configured');
      });
  }

  /* ── expose for external calls ──────────────────────────────── */
  window._ocsLoadHomeCard   = _ocsLoadHomeCard;
  window._ocsRefreshHomeCard = _ocsLoadHomeCard;

  /* ── auto-load when home tab is active ──────────────────────── */
  // Hook into the home tab activation
  var _ocLoaded = false;

  function _tryLoadOC() {
    var homeCanvas = document.getElementById('canvas-home');
    if (homeCanvas && homeCanvas.classList.contains('active')) {
      _ocsLoadHomeCard();
      _ocLoaded = true;
    }
  }

  // Watch for home tab clicks
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-tab="home"]');
    if (btn) { setTimeout(_ocsLoadHomeCard, 300); }
  });

  // Also hook into activateTab
  var _origActivateTab = window.activateTab;
  if (typeof _origActivateTab === 'function') {
    window.activateTab = function(target) {
      _origActivateTab(target);
      if (target === 'home') { setTimeout(_ocsLoadHomeCard, 350); }
    };
  }

  // Load on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(_tryLoadOC, 600); });
  } else {
    setTimeout(_tryLoadOC, 600);
  }

  // Also try after auth is ready
  window.addEventListener('mums:authtoken', function() { setTimeout(_ocsLoadHomeCard, 400); });
  window.addEventListener('mums:auth',      function() { setTimeout(_ocsLoadHomeCard, 400); });

})();
