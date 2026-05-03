/**
 * @file home_apps.js
 * @description Home Apps module
 * @module MUMS/MUMS
 * @version UAT
 */
/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

(function() {
  'use strict';

  var ICON_UPLOAD_REPO_URL = 'https://mycopeland.sharepoint.com/sites/AdvanceServices/Shared%20Documents/Forms/AllItems.aspx?id=%2Fsites%2FAdvanceServices%2FShared%20Documents%2FManila%20Controller%20Appsheet%20Project%2FMUMS%20APP%2FApplication%20Icon&viewid=e4a428c7%2D1e26%2D4929%2D9fe6%2D85f5f21174a9&OR=Teams%2DHL&CT=1723517065809&clickparams=eyJBcHBOYW1lIjoiVGVhbXMtRGVza3RvcCIsIkFwcFZlcnNpb24iOiI0OS8yNDA3MTEyODgyNSIsIkhhc0ZlZGVyYXRlZFVzZXIiOmZhbHNlfQ%3D%3D';

  var _haState = {
    apps: [], canDelete: false, modalOpen: false, saveBusy: false,
    draft: { label: '', link: '', icon: '', description: '' },
    step: 1,
    revision: '',
    pollTimer: null,
  };

  function _haEsc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function _haToken() {
    try {
      var raw = localStorage.getItem('mums_supabase_session') || sessionStorage.getItem('mums_supabase_session');
      if (raw) {
        var p = JSON.parse(raw);
        var t = p && (p.access_token || (p.session && p.session.access_token));
        if (t) return String(t);
      }
      if (window.CloudAuth && typeof window.CloudAuth.accessToken === 'function') return String(window.CloudAuth.accessToken() || '');
    } catch(_) {}
    return '';
  }
  function _haHeaders() {
    var t = _haToken();
    return t ? { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + t } : { 'Content-Type': 'application/json' };
  }
  function _haNormRole(role) { return String(role || '').trim().toUpperCase().replace(/\s+/g, '_'); }
  function _haRoleFromSession() {
    try {
      var raw = localStorage.getItem('mums_supabase_session') || sessionStorage.getItem('mums_supabase_session');
      if (raw) {
        var s = JSON.parse(raw);
        return _haNormRole((s && (s.role || (s.user && s.user.role) || (s.session && s.session.user && s.session.user.role))) || '');
      }
    } catch(_) {}
    try {
      if (window.Auth && typeof window.Auth.getUser === 'function') {
        var u = window.Auth.getUser();
        if (u && u.role) return _haNormRole(u.role);
      }
    } catch(_) {}
    return '';
  }
  function _haCanDelete() {
    var role = _haRoleFromSession();
    return role === 'SUPER_ADMIN' || role === 'TEAM_LEAD' || role === 'TEAMLEAD';
  }
  function _haSafeUrl(v) {
    var x = String(v || '').trim();
    if (!x) return '';
    try {
      var u = new URL(x);
      var p = String(u.protocol || '').toLowerCase();
      if (p !== 'http:' && p !== 'https:') return '';
      return u.toString();
    } catch (_) { return ''; }
  }
  function _haNormalizeApps(raw) {
    var arr = Array.isArray(raw) ? raw : [];
    return arr.map(function(a, idx) {
      var label = String((a && a.label) || '').trim().slice(0,80);
      var link = _haSafeUrl((a && a.link) || '');
      var icon = _haSafeUrl((a && a.icon) || '');
      var description = String((a && a.description) || '').trim().slice(0,220);
      return { id: String((a && a.id) || ('ha_' + Date.now() + '_' + idx)).slice(0,80), label: label, link: link, icon: icon, description: description, position: idx + 1 };
    }).filter(function(a) { return !!a.label && !!a.link; }).slice(0,30);
  }

  function _haRevision(apps, updatedAt) {
    return JSON.stringify(apps || []) + '|' + String(updatedAt || '');
  }

  function _haRenderHomeGrid() {
    var host = document.getElementById('hp-apps-grid');
    if (!host) return;
    if (!_haState.apps.length) {
      host.innerHTML = '<div class="hp-empty"><span style="font-size:9px;opacity:.5;">No applications yet</span></div>';
      return;
    }
    host.innerHTML = _haState.apps.map(function(app) {
      var iconHtml = app.icon
        ? ('<img src="' + _haEsc(app.icon) + '" alt="' + _haEsc(app.label) + ' icon" onerror="this.onerror=null;this.remove();" />')
        : '<i class="fas fa-globe"></i>';
      return '<a class="hp-app-item" data-app-link="' + _haEsc(app.link) + '" title="Open ' + _haEsc(app.label) + '">' +
        '<div class="hp-app-icon">' + iconHtml + '</div>' +
        '<div class="hp-app-label">' + _haEsc(app.label) + '</div>' +
        '<div class="hp-app-desc">' + _haEsc(app.description || 'N/A') + '</div>' +
      '</a>';
    }).join('');

    host.querySelectorAll('.hp-app-item').forEach(function(el) {
      el.addEventListener('click', function(e) {
        e.preventDefault();
        var url = String(el.getAttribute('data-app-link') || '').trim();
        if (!url) return;
        window.open(url, '_blank', 'noopener,noreferrer');
      });
    });
  }

  function _haRenderManageList() {
    var list = document.getElementById('ha-list');
    if (!list) return;
    var canDelete = _haState.canDelete;
    var roleNote = document.getElementById('ha-role-note');
    if (roleNote) roleNote.textContent = canDelete ? 'Delete: enabled for your role' : 'Delete: visible only for Super Admin / Team Lead';
    if (!_haState.apps.length) {
      list.innerHTML = '<div class="hp-empty" style="height:72px;"><span>No applications created yet.</span></div>';
      return;
    }

    list.innerHTML = _haState.apps.map(function(app, idx) {
      var del = canDelete
        ? '<button data-act="del" data-idx="' + idx + '" class="odp-row-save-btn" style="height:28px;border-color:rgba(248,81,73,.28);color:#f85149;">Delete</button>'
        : '';
      return '<div style="display:grid;grid-template-columns:34px 1fr auto;gap:8px;align-items:center;border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:6px;background:rgba(255,255,255,.02);">' +
        '<div style="font-size:11px;font-weight:800;color:#79c0ff;text-align:center;">' + (idx + 1) + '</div>' +
        '<div style="min-width:0;">' +
          '<div style="font-size:11px;font-weight:700;color:#e6edf3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _haEsc(app.label) + '</div>' +
          '<div style="font-size:9px;color:var(--ss-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _haEsc(app.link) + '</div>' +
        '</div>' +
        '<div style="display:flex;gap:4px;">' +
          '<button data-act="up" data-idx="' + idx + '" class="odp-row-save-btn" style="height:28px;">↑</button>' +
          '<button data-act="down" data-idx="' + idx + '" class="odp-row-save-btn" style="height:28px;">↓</button>' +
          del +
        '</div>' +
      '</div>';
    }).join('');

    list.querySelectorAll('button[data-act]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var act = btn.getAttribute('data-act');
        var idx = parseInt(btn.getAttribute('data-idx'), 10);
        if (isNaN(idx)) return;
        if (act === 'up' && idx > 0) {
          var a = _haState.apps[idx - 1]; _haState.apps[idx - 1] = _haState.apps[idx]; _haState.apps[idx] = a;
        } else if (act === 'down' && idx < _haState.apps.length - 1) {
          var b = _haState.apps[idx + 1]; _haState.apps[idx + 1] = _haState.apps[idx]; _haState.apps[idx] = b;
        } else if (act === 'del' && _haState.canDelete) {
          _haState.apps.splice(idx, 1);
        } else { return; }
        _haState.apps = _haNormalizeApps(_haState.apps);
        _haRenderManageList();
        _haRenderHomeGrid();
        _haSave();
      });
    });
  }

  function _haIsStepValid(step) {
    if (step === 1) return !!String(_haState.draft.label || '').trim();
    if (step === 2) return !!_haSafeUrl(_haState.draft.link);
    if (step === 3) return !!_haSafeUrl(_haState.draft.icon);
    if (step === 4) return !!String(_haState.draft.description || '').trim();
    return false;
  }

  function _haRenderStepper() {
    var host = document.getElementById('ha-stepper');
    if (!host) return;
    var done1 = _haIsStepValid(1), done2 = _haIsStepValid(2), done3 = _haIsStepValid(3), done4 = _haIsStepValid(4);
    host.innerHTML = [
      { n:1, t:'Label', d:done1 },
      { n:2, t:'Link', d:done2 },
      { n:3, t:'Icon', d:done3 },
      { n:4, t:'Description', d:done4 }
    ].map(function(st) {
      var cls = 'ha-step-chip' + (_haState.step === st.n ? ' active' : '') + (st.d ? ' done' : '');
      return '<span class="' + cls + '">Step ' + st.n + ' · ' + st.t + '</span>';
    }).join('');
  }

  function _haRenderWizard() {
    _haRenderStepper();
    var body = document.getElementById('ha-wizard-body');
    var nextBtn = document.getElementById('ha-next-btn');
    var backBtn = document.getElementById('ha-back-btn');
    if (!body || !nextBtn || !backBtn) return;

    var step = _haState.step;
    var html = '';
    if (step === 1) {
      html = '<div style="font-size:10px;font-weight:800;color:#79c0ff;letter-spacing:.06em;margin-bottom:6px;">1. Application Label Name <span style="color:#f85149;">(Required)</span></div>' +
             '<input id="ha-step-input" dir="ltr" class="odp-input" style="height:36px;text-align:left;direction:ltr;unicode-bidi:plaintext;" value="' + _haEsc(_haState.draft.label) + '" placeholder="Enter program label" />';
    } else if (step === 2) {
      html = '<div style="font-size:10px;font-weight:800;color:#79c0ff;letter-spacing:.06em;margin-bottom:6px;">2. Application Link <span style="color:#f85149;">(Required)</span></div>' +
             '<input id="ha-step-input" dir="ltr" class="odp-input" style="height:36px;text-align:left;direction:ltr;unicode-bidi:plaintext;" value="' + _haEsc(_haState.draft.link) + '" placeholder="https://..." />';
    } else if (step === 3) {
      html = '<div style="font-size:10px;font-weight:800;color:#79c0ff;letter-spacing:.06em;margin-bottom:6px;">3. Application Icon Link <span style="color:#f85149;">(Required)</span></div>' +
             '<input id="ha-step-input" dir="ltr" class="odp-input" style="height:36px;text-align:left;direction:ltr;unicode-bidi:plaintext;" value="' + _haEsc(_haState.draft.icon) + '" placeholder="https://..." />' +
             '<div style="margin-top:8px;font-size:10px;color:var(--ss-muted);">' +
             '<a href="' + _haEsc(ICON_UPLOAD_REPO_URL) + '" target="_blank" rel="noopener noreferrer" class="ha-upload-link">' +
             '<span class="ha-upload-arrows">⇢⇢</span> Upload here the image and copy the link <span class="ha-upload-arrows">⇢⇢</span>' +
             '</a>' +
             '</div>';
    } else {
      html = '<div style="font-size:10px;font-weight:800;color:#79c0ff;letter-spacing:.06em;margin-bottom:6px;">4. Short Description <span style="color:#f85149;">(Required)</span></div>' +
             '<textarea id="ha-step-input" dir="ltr" class="odp-input" style="min-height:72px;padding-top:10px;resize:vertical;text-align:left;direction:ltr;unicode-bidi:plaintext;">' + _haEsc(_haState.draft.description) + '</textarea>';
    }

    body.innerHTML = html;
    _haUpdateWizardActions();
    backBtn.style.display = step > 1 ? '' : 'none';

    var input = document.getElementById('ha-step-input');
    if (input) {
      setTimeout(function(){ try { input.focus(); } catch(_){} }, 10);
      return;
    }
  }

  function _haUpdateWizardActions() {
    var nextBtn = document.getElementById('ha-next-btn');
    var backBtn = document.getElementById('ha-back-btn');
    if (!nextBtn || !backBtn) return;

    var step = _haState.step;
    var isValid = _haIsStepValid(step);
    nextBtn.style.opacity = isValid ? '1' : '.5';
    nextBtn.style.pointerEvents = isValid ? 'auto' : 'none';
    nextBtn.innerHTML = step < 4 ? '<i class="fas fa-arrow-right"></i> Next' : '<i class="fas fa-check"></i> Create Now';
    backBtn.style.display = step > 1 ? '' : 'none';
  }

  function _haResetWizard() {
    _haState.step = 1;
    _haState.draft = { label: '', link: '', icon: '', description: '' };
    var m = document.getElementById('ha-create-msg');
    if (m) m.style.opacity = '0';
    _haRenderWizard();
  }

  async function _haLoad(opts) {
    opts = opts || {};
    try {
      var r = await fetch('/api/studio/home_apps', { headers: _haHeaders() });
      if (!r.ok) return;
      var d = await r.json();
      if (!d || !d.ok) return;
      var nextApps = _haNormalizeApps(d.apps);
      var rev = _haRevision(nextApps, d.updatedAt);
      if (!opts.force && rev === _haState.revision) return;
      _haState.revision = rev;
      _haState.apps = nextApps;
      _haRenderHomeGrid();
      _haRenderManageList();
    } catch(_) {}
  }

  async function _haSave() {
    if (_haState.saveBusy) return;
    _haState.saveBusy = true;
    try {
      _haState.apps = _haNormalizeApps(_haState.apps);
      var resp = await fetch('/api/studio/home_apps', {
        method: 'POST',
        headers: _haHeaders(),
        body: JSON.stringify({ apps: _haState.apps })
      });
      var d = null;
      try { d = await resp.json(); } catch(_) { d = null; }
      _haState.revision = _haRevision(_haState.apps, d && d.updatedAt ? d.updatedAt : Date.now());
    } catch(_) {}
    _haState.saveBusy = false;
  }

  function _haCreateNow() {
    _haState.apps.push({
      id: 'ha_' + Date.now(),
      label: String(_haState.draft.label || '').trim(),
      link: _haSafeUrl(_haState.draft.link),
      icon: _haSafeUrl(_haState.draft.icon),
      description: String(_haState.draft.description || '').trim(),
    });
    _haState.apps = _haNormalizeApps(_haState.apps);
    _haRenderHomeGrid();
    _haRenderManageList();
    _haSave();
    var m = document.getElementById('ha-create-msg');
    if (m) {
      m.style.opacity = '1';
      clearTimeout(m._t);
      m._t = setTimeout(function(){ m.style.opacity = '0'; }, 2600);
    }
    _haResetWizard();
  }

  function _haStartPolling() {
    if (_haState.pollTimer) return;
    _haState.pollTimer = setInterval(function() { _haLoad(); }, 7000);
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'visible') _haLoad({ force: true });
    });
  }

  function _haOpenModal() {
    var modal = document.getElementById('home-apps-modal');
    if (!modal) return;
    _haState.canDelete = _haCanDelete();
    _haRenderManageList();
    _haResetWizard();
    modal.classList.add('is-open');
    _haState.modalOpen = true;
  }
  function _haCloseModal() {
    var modal = document.getElementById('home-apps-modal');
    if (!modal) return;
    modal.classList.remove('is-open');
    _haState.modalOpen = false;
  }

  function _haBind() {
    var manageBtn = document.getElementById('hp-apps-manage-btn');
    if (manageBtn) manageBtn.addEventListener('click', _haOpenModal);
    var closeBtn = document.getElementById('home-apps-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', _haCloseModal);
    var modal = document.getElementById('home-apps-modal');
    if (modal) {
      modal.addEventListener('click', function(e) {
        // Keep modal open when clicking outside panel (requested behavior).
        e.stopPropagation();
      });
    }

    document.addEventListener('input', function(e) {
      if (!e.target || e.target.id !== 'ha-step-input') return;
      if (_haState.step === 1) _haState.draft.label = e.target.value;
      else if (_haState.step === 2) _haState.draft.link = e.target.value;
      else if (_haState.step === 3) _haState.draft.icon = e.target.value;
      else _haState.draft.description = e.target.value;
      _haRenderStepper();
      _haUpdateWizardActions();
    });

    var backBtn = document.getElementById('ha-back-btn');
    if (backBtn) backBtn.addEventListener('click', function() {
      if (_haState.step > 1) { _haState.step--; _haRenderWizard(); }
    });

    var nextBtn = document.getElementById('ha-next-btn');
    if (nextBtn) nextBtn.addEventListener('click', function() {
      if (!_haIsStepValid(_haState.step)) return;
      if (_haState.step < 4) {
        _haState.step++;
        _haRenderWizard();
      } else {
        _haCreateNow();
      }
    });

    // Escape close disabled by request: close only via explicit close button (x).
  }

  function _haInit() {
    _haBind();
    _haRenderHomeGrid();
    _haRenderManageList();
    _haLoad({ force: true });
    _haStartPolling();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _haInit);
  else setTimeout(_haInit, 150);

  window._homeAppsReload = function(){ _haLoad({ force: true }); };
})();
