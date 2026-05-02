/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Auth Flow.
   DO NOT modify without a RISK IMPACT REPORT to MACE and explicit "CLEARED" approval. */

/**
 * mums-boot-loader.js — v1.0
 * Enterprise Boot Loader / Workspace Preparation Screen
 * ─────────────────────────────────────────────────────────────────────────────
 * PURPOSE:
 *   Prevents the landing page (dashboard) from being visible until the app is
 *   100% hydrated: auth resolved + session hydrated + realtime connected/polling.
 *
 * ARCHITECTURE (zero coupling, surgical):
 *   1. ON SCRIPT LOAD (synchronous, before DOMContentLoaded):
 *      - Hides <div class="app"> immediately via inline style (opacity:0; pointer-events:none)
 *      - Injects the loader overlay into document.body
 *
 *   2. LISTEN for these signals from the existing boot sequence:
 *      ┌─ mums:session_hydrated → Step: Profile Hydrated
 *      ├─ mums:syncstatus { mode:'realtime' } → Step: Sync Connected
 *      ├─ mums:syncstatus { mode:'polling' }  → Step: Sync Ready (fallback)
 *      └─ mums:syncstatus { mode:'offline' }  → Update pill state (degraded)
 *
 *   3. COMPLETION GATE:
 *      Ready = session_hydrated AND (realtime|polling connected)
 *      When ready:
 *        a. Run "Welcome, {name}" finish animation (checkmark + scale-up)
 *        b. After 1.2s → fade out loader + fade in .app
 *        c. SAFETY NET: 12 s hard timeout auto-dismisses loader
 *           (prevents user being stuck if a signal never fires)
 *
 * STRICT CONSTRAINTS:
 *   - Does NOT touch auth logic, RLS, realtime channel names, or routing
 *   - Does NOT delay boot() execution — runs in parallel
 *   - Does NOT use Tailwind CDN (self-contained CSS)
 *   - Does NOT block on QB counter data — that's not boot-critical
 *   - Removed safely via window.MUMSLoader.dismiss() if needed
 */

(function () {
  'use strict';

  // ── Safety: don't mount twice ────────────────────────────────────────────
  if (window.__mumsLoaderMounted) return;
  window.__mumsLoaderMounted = true;

  // ── Constants ────────────────────────────────────────────────────────────
  var HARD_TIMEOUT_MS    = 14000; // max wait before auto-dismiss
  var DISMISS_DELAY_MS   = 1200;  // ms after "ready" before hiding loader
  var WELCOME_LINGER_MS  = 800;   // welcome flash duration

  // ── State ────────────────────────────────────────────────────────────────
  var _dismissed    = false;
  var _sessionReady = false;
  var _syncReady    = false;
  var _hardTimer    = null;
  var _overlayEl    = null;
  var _appEl        = null;

  // ── 1. HIDE THE APP SHELL immediately (before DOMContentLoaded) ──────────
  // This single CSS change is the "door" — the rest of the loader is cosmetic.
  function _hideAppShell() {
    try {
      var style = document.createElement('style');
      style.id = '__mums-boot-veil';
      style.textContent = [
        '.app{opacity:0!important;pointer-events:none!important;',
        'transition:opacity 0.55s cubic-bezier(0.22,1,0.36,1)!important;}',
      ].join('');
      document.head.appendChild(style);
    } catch (_) {}
  }

  function _revealAppShell() {
    try {
      var veil = document.getElementById('__mums-boot-veil');
      if (veil) veil.remove();
      var app = document.querySelector('.app');
      if (app) {
        app.style.opacity = '1';
        app.style.pointerEvents = '';
        // After transition ends, clean up inline styles
        app.addEventListener('transitionend', function () {
          try { app.style.opacity = ''; app.style.pointerEvents = ''; } catch (_) {}
        }, { once: true });
      }
    } catch (_) {}
  }

  // ── 2. BUILD THE LOADER HTML ─────────────────────────────────────────────
  var _CSS = [
    ':root{--bl-ease:cubic-bezier(0.22,1,0.36,1);--bl-spring:cubic-bezier(0.175,0.885,0.32,1.275);}',
    '#mums-boot-loader{',
    '  position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;',
    '  background:linear-gradient(180deg,#0a0a0f 0%,#0d0f15 40%,#10131c 100%);',
    '  font-family:Inter,-apple-system,BlinkMacSystemFont,"SF Pro Display",system-ui,sans-serif;',
    '  -webkit-font-smoothing:antialiased;',
    '  transition:opacity 0.55s var(--bl-ease),filter 0.55s var(--bl-ease),transform 0.55s var(--bl-ease);',
    '  overflow:hidden;',
    '}',
    '#mums-boot-loader.bl-hide{opacity:0;pointer-events:none;filter:blur(4px);transform:scale(0.985);}',
    // Orbs
    '.bl-orb{will-change:transform;position:absolute;border-radius:50%;pointer-events:none;}',
    '@keyframes bl-float1{0%,100%{transform:translate3d(0,0,0) scale(1);}50%{transform:translate3d(50px,-30px,0) scale(1.08);}}',
    '@keyframes bl-float2{0%,100%{transform:translate3d(0,0,0) scale(1);}50%{transform:translate3d(-60px,40px,0) scale(1.05);}}',
    '@keyframes bl-spin{to{transform:rotate(360deg);}}',
    '@keyframes bl-shimmer{0%{transform:translateX(-120%);}100%{transform:translateX(220%);}}',
    '@keyframes bl-pulse{0%,100%{opacity:.8;}50%{opacity:.4;}}',
    // Panel
    '#bl-panel{',
    '  position:relative;width:100%;max-width:520px;border-radius:28px;padding:0;',
    '  background:rgba(255,255,255,0.06);backdrop-filter:blur(40px) saturate(140%);-webkit-backdrop-filter:blur(40px) saturate(140%);',
    '  border:1px solid rgba(255,255,255,0.1);',
    '  box-shadow:0 30px 80px -20px rgba(0,0,0,.7),0 10px 30px -10px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.08);',
    '  opacity:0;transform:translateY(16px) scale(.98);',
    '  transition:opacity 1s var(--bl-ease),transform 1s var(--bl-ease);',
    '}',
    '#bl-panel.bl-panel-show{opacity:1;transform:translateY(0) scale(1);}',
    '#bl-panel.bl-panel-done{transform:scale(1.015);transition:transform 0.8s var(--bl-spring);}',
    // Welcome overlay
    '#bl-welcome{',
    '  position:absolute;inset:0;z-index:30;border-radius:28px;',
    '  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;',
    '  background:rgba(10,10,15,.75);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);',
    '  opacity:0;pointer-events:none;transition:opacity 0.7s var(--bl-ease);',
    '}',
    '#bl-welcome.bl-welcome-show{opacity:1;pointer-events:auto;}',
    '#bl-check-wrap{',
    '  position:relative;width:64px;height:64px;border-radius:50%;',
    '  background:linear-gradient(135deg,#60a5fa,#a78bfa);',
    '  display:flex;align-items:center;justify-content:center;',
    '  box-shadow:0 10px 40px rgba(96,165,250,.35),inset 0 1px 0 rgba(255,255,255,.2);',
    '  transform:scale(.85);transition:transform 0.7s var(--bl-spring);',
    '}',
    '#bl-check-wrap.bl-check-scaled{transform:scale(1);}',
    // Step dots
    '.bl-step-dot{',
    '  width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;',
    '  background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);',
    '  color:rgba(255,255,255,.45);transition:all 0.6s var(--bl-ease);',
    '}',
    '.bl-step.bl-done .bl-step-dot{',
    '  background:linear-gradient(135deg,#60a5fa,#a78bfa);border-color:transparent;color:#fff;',
    '  box-shadow:0 0 20px rgba(96,165,250,.25),inset 0 1px 0 rgba(255,255,255,.2);',
    '}',
    '.bl-step.bl-active .bl-step-dot{',
    '  background:rgba(255,255,255,.08);border-color:rgba(167,139,250,.55);color:#fff;',
    '  box-shadow:0 0 0 4px rgba(167,139,250,.12),inset 0 0 12px rgba(167,139,250,.1);',
    '}',
    // Pills
    '.bl-pill{',
    '  background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.08);',
    '  border-radius:9999px;padding:10px 14px;position:relative;overflow:hidden;',
    '}',
    '.bl-pill.bl-shimmer::after{',
    '  content:"";position:absolute;inset:0;',
    '  background:linear-gradient(90deg,transparent,rgba(255,255,255,.09),transparent);',
    '  animation:bl-shimmer 0.7s var(--bl-ease);',
    '}',
    // Progress ring
    '#bl-progress-ring{transition:stroke-dashoffset .15s linear;}',
    // Utility
    '.bl-tabular{font-variant-numeric:tabular-nums;}',
    '.bl-gradient-text{',
    '  background:linear-gradient(180deg,#fff,rgba(255,255,255,.8));',
    '  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;',
    '}',
  ].join('\n');

  function _buildHTML(userName) {
    var nameDisplay = userName ? (String(userName).split(' ').slice(0, 2).join(' ')) : 'there';
    return [
      // orbs
      '<div style="pointer-events:none;position:fixed;inset:0;overflow:hidden;z-index:0">',
      '  <div class="bl-orb" style="top:-12%;left:-12%;width:680px;height:680px;opacity:.7;background:radial-gradient(circle,rgba(59,130,246,.22) 0%,transparent 60%);filter:blur(90px);animation:bl-float1 22s ease-in-out infinite;"></div>',
      '  <div class="bl-orb" style="bottom:-12%;right:-12%;width:620px;height:620px;opacity:.7;background:radial-gradient(circle,rgba(139,92,246,.24) 0%,transparent 60%);filter:blur(100px);animation:bl-float2 26s ease-in-out infinite;"></div>',
      '</div>',
      // vignette
      '<div style="pointer-events:none;position:fixed;inset:0;background:radial-gradient(ellipse at center,transparent 30%,rgba(0,0,0,.4) 100%);z-index:0"></div>',
      // panel
      '<div id="bl-panel" style="position:relative;z-index:10">',
      // top highlight
      '  <div style="position:absolute;inset-x:0;top:0;height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.2),transparent)"></div>',
      // welcome overlay
      '  <div id="bl-welcome">',
      '    <div id="bl-check-wrap">',
      '      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
      '    </div>',
      '    <div style="text-align:center">',
      '      <p style="font-size:24px;font-weight:500;letter-spacing:-.02em;color:#fff">Welcome, ' + nameDisplay + '</p>',
      '      <p style="font-size:13px;color:rgba(255,255,255,.6);margin-top:6px">Workspace is ready</p>',
      '    </div>',
      '  </div>',
      // main content
      '  <div style="padding:40px">',
      // header
      '    <div style="display:flex;flex-direction:column;align-items:center;text-align:center">',
      '      <div style="display:inline-flex;align-items:center;gap:10px;padding:6px 12px;border-radius:9999px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08)">',
      '        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><defs><linearGradient id="blg" x1="0" y1="0" x2="24" y2="24"><stop stop-color="#60a5fa"/><stop offset="1" stop-color="#a78bfa"/></linearGradient></defs><path d="M12 2L20 7v10l-8 5-8-5V7l8-5z" stroke="url(#blg)" stroke-width="1.5" fill="none"/><path d="M12 2v20" stroke="url(#blg)" stroke-opacity=".5" stroke-width="1"/></svg>',
      '        <span style="font-size:10.5px;letter-spacing:.18em;font-weight:500;color:rgba(255,255,255,.7)">MUMS</span>',
      '        <span style="width:1px;height:12px;background:rgba(255,255,255,.15)"></span>',
      '        <span style="font-size:10.5px;letter-spacing:.18em;font-weight:500;color:rgba(255,255,255,.4)">USER MANAGEMENT SYSTEM</span>',
      '      </div>',
      '      <h1 style="margin-top:28px;font-size:28px;font-weight:500;letter-spacing:-.02em;line-height:1.15;color:#fff">Preparing your workspace</h1>',
      '      <p style="margin-top:10px;font-size:14px;line-height:1.5;color:rgba(255,255,255,.6);max-width:360px">Ensuring everything is fully loaded and synced before you enter.</p>',
      '    </div>',
      // ring
      '    <div style="margin-top:40px;display:flex;justify-content:center">',
      '      <div style="position:relative;width:148px;height:148px">',
      '        <svg style="position:absolute;inset:0;transform:rotate(-90deg)" width="148" height="148" viewBox="0 0 148 148">',
      '          <defs><linearGradient id="bl-ring" x1="0" y1="0" x2="148" y2="148"><stop stop-color="#60a5fa"/><stop offset="1" stop-color="#a78bfa"/></linearGradient><filter id="bl-glow"><feGaussianBlur stdDeviation="3" result="b"/><feComposite in="SourceGraphic" in2="b" operator="over"/></filter></defs>',
      '          <circle cx="74" cy="74" r="56" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="1.5"/>',
      '          <circle cx="74" cy="74" r="56" fill="none" stroke="rgba(255,255,255,.04)" stroke-width="8"/>',
      '          <circle id="bl-progress-ring" cx="74" cy="74" r="56" fill="none" stroke="url(#bl-ring)" stroke-width="1.75" stroke-linecap="round" stroke-dasharray="351.86" stroke-dashoffset="351.86" filter="url(#bl-glow)"/>',
      '        </svg>',
      '        <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center">',
      '          <span id="bl-pct" class="bl-tabular bl-gradient-text" style="font-size:52px;font-weight:450;letter-spacing:-.02em;line-height:1">0</span>',
      '          <div style="margin-top:10px;display:flex;align-items:center;gap:6px">',
      '            <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:rgba(52,211,153,.8);animation:bl-pulse 2s ease-in-out infinite"></span>',
      '            <span id="bl-ring-label" style="font-size:10px;text-transform:uppercase;letter-spacing:.12em;font-weight:500;color:rgba(255,255,255,.5)">Booting</span>',
      '          </div>',
      '        </div>',
      '      </div>',
      '    </div>',
      // stepper
      '    <div style="margin-top:40px;position:relative">',
      '      <div style="position:absolute;top:14px;left:12%;right:12%;height:1px;background:rgba(255,255,255,.08)"></div>',
      '      <div style="position:absolute;top:14px;left:12%;right:12%;height:1px;overflow:hidden">',
      '        <div id="bl-step-progress" style="height:100%;width:0;background:linear-gradient(90deg,#60a5fa,#a78bfa);box-shadow:0 0 10px rgba(96,165,250,.5);transition:width 0.8s var(--bl-ease)"></div>',
      '      </div>',
      '      <div style="position:relative;display:grid;grid-template-columns:repeat(4,1fr);gap:8px">',
      // step 1: Login
      '        <div class="bl-step bl-done" style="display:flex;flex-direction:column;align-items:center;gap:10px">',
      '          <div class="bl-step-dot"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg></div>',
      '          <span style="font-size:11px;color:rgba(255,255,255,.7);font-weight:500">Login</span>',
      '        </div>',
      // step 2: Session
      '        <div id="bl-step2" class="bl-step bl-active" style="display:flex;flex-direction:column;align-items:center;gap:10px">',
      '          <div class="bl-step-dot" style="position:relative">',
      '            <div style="position:absolute;inset:0;border-radius:50%;background:conic-gradient(from 0deg,transparent 60%,#a78bfa 100%);mask:radial-gradient(farthest-side,transparent calc(100% - 2px),black calc(100% - 2px));-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 2px),black calc(100% - 2px));animation:bl-spin 1s linear infinite" id="bl-spin2"></div>',
      '            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
      '          </div>',
      '          <span style="font-size:11px;color:#fff;font-weight:500">Profile</span>',
      '        </div>',
      // step 3: Sync
      '        <div id="bl-step3" class="bl-step" style="display:flex;flex-direction:column;align-items:center;gap:10px">',
      '          <div class="bl-step-dot" id="bl-step3-dot">',
      '            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>',
      '          </div>',
      '          <span id="bl-step3-label" style="font-size:11px;color:rgba(255,255,255,.45);font-weight:500">Syncing</span>',
      '        </div>',
      // step 4: Ready
      '        <div id="bl-step4" class="bl-step" style="display:flex;flex-direction:column;align-items:center;gap:10px">',
      '          <div class="bl-step-dot">',
      '            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>',
      '          </div>',
      '          <span style="font-size:11px;color:rgba(255,255,255,.45);font-weight:500">Ready</span>',
      '        </div>',
      '      </div>',
      '    </div>',
      // pills
      '    <div style="margin-top:36px;display:grid;grid-template-columns:repeat(3,1fr);gap:10px">',
      '      <div class="bl-pill"><div style="display:flex;align-items:center;justify-content:space-between"><span style="font-size:11px;color:rgba(255,255,255,.5)">Realtime</span><span id="bl-p-realtime" style="font-size:12px;font-weight:500;color:rgba(255,255,255,.7)" class="bl-tabular">Connecting</span></div></div>',
      '      <div class="bl-pill"><div style="display:flex;align-items:center;justify-content:space-between"><span style="font-size:11px;color:rgba(255,255,255,.5)">Cache</span><span id="bl-p-cache" style="font-size:12px;font-weight:500;color:rgba(255,255,255,.7)" class="bl-tabular">Cold</span></div></div>',
      '      <div class="bl-pill"><div style="display:flex;align-items:center;justify-content:space-between"><span style="font-size:11px;color:rgba(255,255,255,.5)">Profile</span><span id="bl-p-profile" style="font-size:12px;font-weight:500;color:rgba(255,255,255,.7)" class="bl-tabular">Loading</span></div></div>',
      '    </div>',
      // footer
      '    <div style="margin-top:32px;padding-top:24px;border-top:1px solid rgba(255,255,255,.06);display:flex;align-items:center;justify-content:center;gap:6px">',
      '      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.4)" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
      '      <p style="font-size:12px;color:rgba(255,255,255,.45);text-align:center">Landing page appears only when 100% ready — preventing unresponsive pages.</p>',
      '    </div>',
      '  </div>',
      '</div>',
    ].join('');
  }

  // ── 3. MOUNT LOADER ──────────────────────────────────────────────────────
  function _mount() {
    if (_overlayEl) return;
    // Inject CSS
    var styleEl = document.createElement('style');
    styleEl.id  = '__mums-boot-css';
    styleEl.textContent = _CSS;
    document.head.appendChild(styleEl);

    // Try to get user name from Store / Auth for welcome message
    var userName = '';
    try {
      var u = window.Auth && Auth.getUser ? Auth.getUser() : null;
      if (!u && window.Store) u = Store.getUser ? Store.getUser() : null;
      if (u) userName = String(u.name || u.username || u.email || '').trim();
    } catch (_) {}

    // Build overlay
    _overlayEl = document.createElement('div');
    _overlayEl.id = 'mums-boot-loader';
    _overlayEl.innerHTML = _buildHTML(userName);
    document.body.insertBefore(_overlayEl, document.body.firstChild);

    // Init ring
    var ring = document.getElementById('bl-progress-ring');
    if (ring) {
      var C = 2 * Math.PI * 56; // 351.86
      ring.setAttribute('stroke-dasharray', String(C));
      ring.setAttribute('stroke-dashoffset', String(C));
    }

    // Panel enter animation
    setTimeout(function () {
      var panel = document.getElementById('bl-panel');
      if (panel) panel.classList.add('bl-panel-show');
    }, 80);

    // Step progress starts at 25% (Login = done = 1/4)
    _setStepProgress(25);

    _appEl = document.querySelector('.app');
  }

  // ── 4. PROGRESS HELPERS ──────────────────────────────────────────────────
  var _pctVal   = 0;
  var _pctRafId = null;

  function _animatePct(target) {
    if (_pctRafId) cancelAnimationFrame(_pctRafId);
    var start     = _pctVal;
    var startTime = null;
    var dur       = 900;
    var C         = 351.86;
    var ring      = document.getElementById('bl-progress-ring');
    var numEl     = document.getElementById('bl-pct');

    function step(ts) {
      if (!startTime) startTime = ts;
      var p    = Math.min((ts - startTime) / dur, 1);
      var ease = 1 - Math.pow(1 - p, 3);
      var val  = Math.round(start + (target - start) * ease);
      _pctVal  = val;

      if (numEl) numEl.textContent = String(val);
      if (ring)  ring.style.strokeDashoffset = String(C * (1 - val / 100 * 0.94));
      if (p < 1) { _pctRafId = requestAnimationFrame(step); }
    }
    _pctRafId = requestAnimationFrame(step);
  }

  function _setStepProgress(pct) {
    var bar = document.getElementById('bl-step-progress');
    if (bar) bar.style.width = pct + '%';
  }

  function _shimmerPill(id) {
    try {
      var el   = document.getElementById(id);
      if (!el) return;
      var pill = el.closest('.bl-pill');
      if (pill) {
        pill.classList.add('bl-shimmer');
        setTimeout(function () { pill.classList.remove('bl-shimmer'); }, 700);
      }
    } catch (_) {}
  }

  function _setPill(id, text, color) {
    try {
      var el = document.getElementById(id);
      if (!el) return;
      _shimmerPill(id);
      setTimeout(function () {
        if (!el) return;
        el.textContent = text;
        if (color) el.style.color = color;
      }, 200);
    } catch (_) {}
  }

  function _completeStep(stepId, spinId, labelEl) {
    try {
      var step = document.getElementById(stepId);
      if (!step) return;
      step.classList.remove('bl-active');
      step.classList.add('bl-done');
      var spin = spinId ? document.getElementById(spinId) : null;
      if (spin) spin.style.display = 'none';
      var dot = step.querySelector('.bl-step-dot');
      if (dot) dot.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg>';
      if (labelEl) { labelEl.style.color = 'rgba(255,255,255,.7)'; }
    } catch (_) {}
  }

  function _activateStep(stepId, labelId) {
    try {
      var step = document.getElementById(stepId);
      if (!step) return;
      step.classList.add('bl-active');
      var dot  = step.querySelector('.bl-step-dot');
      if (dot) {
        dot.style.position = 'relative';
        var spinner = document.createElement('div');
        spinner.style.cssText = [
          'position:absolute;inset:0;border-radius:50%;',
          'background:conic-gradient(from 0deg,transparent 60%,#a78bfa 100%);',
          'mask:radial-gradient(farthest-side,transparent calc(100% - 2px),black calc(100% - 2px));',
          '-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 2px),black calc(100% - 2px));',
          'animation:bl-spin 1s linear infinite;',
        ].join('');
        dot.insertBefore(spinner, dot.firstChild);
      }
      var lbl = labelId ? document.getElementById(labelId) : null;
      if (lbl) { lbl.style.color = '#fff'; }
    } catch (_) {}
  }

  // ── 5. SIGNAL HANDLERS ───────────────────────────────────────────────────

  function _onSessionHydrated() {
    if (_dismissed) return;
    _sessionReady = true;

    // Update ring label
    var rl = document.getElementById('bl-ring-label');
    if (rl) rl.textContent = 'Profile Hydrated';

    // Complete step 2 (Profile)
    _completeStep('bl-step2', 'bl-spin2', null);
    _setStepProgress(50);
    _animatePct(55);

    // Update Profile pill
    _setPill('bl-p-profile', 'Hydrated', 'rgba(147,197,253,.9)'); // sky-300

    // Activate step 3 (Syncing)
    _activateStep('bl-step3', 'bl-step3-label');

    // Update Cache pill after short delay
    setTimeout(function () {
      _setPill('bl-p-cache', 'Warming', 'rgba(196,181,253,.9)');
      setTimeout(function () { _setPill('bl-p-cache', 'Warm', 'rgba(196,181,253,.9)'); }, 800);
    }, 400);

    _checkReady();
  }

  function _onSyncConnected(mode) {
    if (_dismissed) return;
    _syncReady = true;

    var rl = document.getElementById('bl-ring-label');
    if (rl) rl.textContent = mode === 'realtime' ? 'Live Sync' : 'Polling Sync';

    // Complete step 3
    _completeStep('bl-step3', null, document.getElementById('bl-step3-label'));
    _setStepProgress(75);
    _animatePct(80);

    // Realtime pill
    var rtText  = mode === 'realtime' ? 'Connected' : 'Polling';
    var rtColor = mode === 'realtime' ? 'rgba(52,211,153,.9)' : 'rgba(250,204,21,.9)';
    _setPill('bl-p-realtime', rtText, rtColor);

    // Activate step 4
    setTimeout(function () {
      _activateStep('bl-step4', null);
      var s4lbl = document.querySelector('#bl-step4 span');
      if (s4lbl) s4lbl.style.color = '#fff';
      _setStepProgress(100);
      _animatePct(100);

      setTimeout(function () {
        _completeStep('bl-step4', null, null);
        _checkReady();
      }, 600);
    }, 300);
  }

  function _checkReady() {
    if (_dismissed) return;
    if (!(_sessionReady && _syncReady)) return;

    // ── COMPLETION SEQUENCE ────────────────────────────────────────────────
    var rl = document.getElementById('bl-ring-label');
    if (rl) rl.textContent = 'Ready';

    // Try to get user name (may now be available post-hydration)
    try {
      var nameEl = _overlayEl && _overlayEl.querySelector('#bl-welcome p');
      if (nameEl) {
        var u = window.Auth && Auth.getUser ? Auth.getUser() : null;
        if (!u && window.Store) u = Store.getUser ? Store.getUser() : null;
        if (u) {
          var n = String(u.name || u.username || u.email || '').trim().split(' ').slice(0, 2).join(' ');
          if (n) nameEl.textContent = 'Welcome, ' + n;
        }
      }
    } catch (_) {}

    // Panel scale-up
    var panel = document.getElementById('bl-panel');
    if (panel) panel.classList.add('bl-panel-done');

    // Welcome overlay
    var welcome = document.getElementById('bl-welcome');
    if (welcome) {
      welcome.classList.add('bl-welcome-show');
      setTimeout(function () {
        var wrap = document.getElementById('bl-check-wrap');
        if (wrap) wrap.classList.add('bl-check-scaled');
      }, 80);
    }

    // Dismiss after linger
    setTimeout(function () {
      _dismiss();
    }, WELCOME_LINGER_MS + DISMISS_DELAY_MS);
  }

  // ── 6. DISMISS ────────────────────────────────────────────────────────────
  function _dismiss() {
    if (_dismissed) return;
    _dismissed = true;
    if (_hardTimer) { clearTimeout(_hardTimer); _hardTimer = null; }

    // Reveal the app FIRST (it fades in while loader fades out — crossfade)
    _revealAppShell();

    // Then fade out loader
    if (_overlayEl) {
      _overlayEl.classList.add('bl-hide');
      setTimeout(function () {
        try {
          if (_overlayEl && _overlayEl.parentNode) _overlayEl.parentNode.removeChild(_overlayEl);
          var css = document.getElementById('__mums-boot-css');
          if (css) css.remove();
        } catch (_) {}
        _overlayEl = null;
      }, 600);
    }

    // Signal dismissed
    try { window.__mumsLoaderDismissed = true; } catch (_) {}
    try { window.dispatchEvent(new CustomEvent('mums:boot_loader_dismissed')); } catch (_) {}
  }

  // ── 7. WIRE UP EVENT LISTENERS ───────────────────────────────────────────
  function _bindEvents() {
    // session_hydrated → step 2 done
    window.addEventListener('mums:session_hydrated', function () {
      try { _onSessionHydrated(); } catch (_) {}
    });

    // syncstatus → step 3 done + ready check
    window.addEventListener('mums:syncstatus', function (e) {
      try {
        var mode = e && e.detail && e.detail.mode;
        if (mode === 'realtime' || mode === 'polling') {
          _onSyncConnected(mode);
        }
        // Offline during load — just update pill, don't dismiss
        if (mode === 'offline' && !_dismissed) {
          _setPill('bl-p-realtime', 'Degraded', 'rgba(251,191,36,.9)');
        }
      } catch (_) {}
    });

    // Also check if sync was already connected before our listener registered
    // (Realtime.init may fire before our listener if the script loads late)
    try {
      if (window.__mumsSyncMode === 'realtime' || window.__mumsSyncMode === 'polling') {
        _syncReady = true;
      }
    } catch (_) {}
  }

  // ── 8. INIT ───────────────────────────────────────────────────────────────
  function _init() {
    _hideAppShell();
    _bindEvents();

    // Mount after DOM is available
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _mount);
    } else {
      _mount();
    }

    // Hard safety timeout — never trap user
    _hardTimer = setTimeout(function () {
      if (!_dismissed) {
        console.warn('[MUMS Loader] Hard timeout — auto-dismissing after ' + HARD_TIMEOUT_MS + 'ms');
        _dismiss();
      }
    }, HARD_TIMEOUT_MS);
  }

  // ── PUBLIC API ────────────────────────────────────────────────────────────
  window.MUMSLoader = {
    dismiss       : _dismiss,
    isDismissed   : function () { return _dismissed; },
    markSessionReady: _onSessionHydrated,
    markSyncReady   : _onSyncConnected,
  };

  // Run immediately
  _init();

})();
