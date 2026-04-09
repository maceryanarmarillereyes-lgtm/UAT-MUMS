/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */


/* public/js/security_pin.js
 * MUMS Security PIN System — Frontend Controller v2.0
 * BUG FIX REPORT:
 *
 * BUG 1 FIX — PIN accepted intermittently / needs hard refresh:
 *   Root cause: getToken() was called before CloudAuth had a valid session
 *   token during async gate() init. apiFetch('/api/pin/status') returned 401,
 *   fallback set pinStatus={pinSet:false}, skipping PIN entirely.
 *   Also: CTA re-enable was happening BEFORE verify result, allowing double-submit.
 *   Fix: _waitForToken() polls for a valid token before making API calls.
 *        CTA disable is toggled AFTER the data.verified check, not before.
 *        Digit input is disabled during in-flight API calls.
 *
 * BUG 2 FIX — Page content visible before PIN overlay:
 *   Root cause: No content hiding during async policy/status load.
 *   Fix: gate() immediately hides body content via #mumsSecBodyVeil overlay
 *        SYNCHRONOUSLY on call — before any async work. Veil is removed only
 *        after PIN passes or policy confirms PIN not required.
 *
 * BUG 3 (support_studio.html) — handled in the HTML auth guard injected there.
 */
(function () {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────────────
  const PIN_SESSION_KEY   = 'mums_pin_verified_at';
  const PIN_ATTEMPTS_KEY  = 'mums_pin_attempts';

  // ── State ──────────────────────────────────────────────────────────────────
  let _policy    = null;
  let _pinStatus = null;
  let _currentInput = '';
  let _mode      = 'verify';
  let _setupFirst = '';
  let _onSuccess  = null;
  let _initialized = false;
  let _overlayEl  = null;
  let _apiInFlight = false;  // FIX: prevents double-submit

  // ── Body veil — hides content until gate passes ────────────────────────────
  // FIX BUG 2: Inject an opaque overlay synchronously so content is never
  // visible during the async policy/status loading window.
  let _veilEl = null;
  function _showVeil() {
    if (_veilEl) return;
    _veilEl = document.createElement('div');
    _veilEl.id = 'mumsSecBodyVeil';
    Object.assign(_veilEl.style, {
      position: 'fixed', inset: '0', zIndex: '2147483100',
      background: '#010409', display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      pointerEvents: 'all',
    });
    // Subtle spinner so it's not a blank black screen
    _veilEl.innerHTML = '<div style="width:28px;height:28px;border:2px solid rgba(56,189,248,.15);border-top-color:#38bdf8;border-radius:50%;animation:pinVeilSpin .7s linear infinite;"></div>'
      + '<style>@keyframes pinVeilSpin{to{transform:rotate(360deg)}}</style>';
    if (document.body) {
      document.body.appendChild(_veilEl);
    } else {
      document.addEventListener('DOMContentLoaded', function() {
        if (_veilEl && !_veilEl.parentElement) document.body.appendChild(_veilEl);
      });
    }
  }

  function _hideVeil() {
    if (_veilEl && _veilEl.parentElement) {
      _veilEl.style.transition = 'opacity .25s ease';
      _veilEl.style.opacity = '0';
      setTimeout(function() {
        if (_veilEl && _veilEl.parentElement) _veilEl.parentElement.removeChild(_veilEl);
        _veilEl = null;
      }, 280);
    }
  }

  // ── Token wait — FIX BUG 1 core issue ─────────────────────────────────────
  // Poll for a valid auth token before firing API calls.
  // On page load CloudAuth may not have restored the session yet.
  function _waitForToken(maxMs) {
    maxMs = maxMs || 6000;
    const start = Date.now();
    return new Promise(function(resolve) {
      function check() {
        const tok = _getToken();
        if (tok) return resolve(tok);
        if (Date.now() - start > maxMs) return resolve(''); // timeout — proceed anyway
        setTimeout(check, 80);
      }
      check();
    });
  }

  function _getToken() {
    try {
      if (window.CloudAuth && typeof CloudAuth.accessToken === 'function') {
        const t = CloudAuth.accessToken();
        if (t) return t;
      }
    } catch (_) {}
    try {
      const raw = localStorage.getItem('mums_supabase_session') || sessionStorage.getItem('mums_supabase_session');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.access_token) return parsed.access_token;
      }
    } catch (_) {}
    return '';
  }

  async function apiFetch(path, opts) {
    const token = _getToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(path, Object.assign({ headers: headers }, opts || {}));
    const data = await res.json().catch(function() { return {}; });
    return data;
  }

  // ── Session storage helpers ────────────────────────────────────────────────
  function getSessionAttempts() {
    try { return parseInt(sessionStorage.getItem(PIN_ATTEMPTS_KEY) || '0', 10); } catch (_) { return 0; }
  }
  function setSessionAttempts(n) {
    try { sessionStorage.setItem(PIN_ATTEMPTS_KEY, String(n)); } catch (_) {}
  }
  function clearSessionAttempts() {
    try { sessionStorage.removeItem(PIN_ATTEMPTS_KEY); } catch (_) {}
  }
  function getPinVerifiedAt() {
    try { return parseInt(localStorage.getItem(PIN_SESSION_KEY) || '0', 10); } catch (_) { return 0; }
  }
  function setPinVerifiedAt(ts) {
    try { localStorage.setItem(PIN_SESSION_KEY, String(ts)); } catch (_) {}
  }
  function clearPinVerifiedAt() {
    try { localStorage.removeItem(PIN_SESSION_KEY); } catch (_) {}
  }
  function sessionExpiryMs() {
    const hours = (_policy && _policy.sessionExpiryHours) ? Number(_policy.sessionExpiryHours) : 3;
    return hours * 60 * 60 * 1000;
  }
  function isPinSessionExpired() {
    const v = getPinVerifiedAt();
    if (!v) return true;
    return (Date.now() - v) > sessionExpiryMs();
  }

  // ── Policy / status loaders ────────────────────────────────────────────────
  async function loadPolicy() {
    try {
      const data = await apiFetch('/api/pin/policy');
      _policy = data.ok ? data.policy : _defaultPolicy();
    } catch (_) {
      _policy = _defaultPolicy();
    }
    return _policy;
  }

  function _defaultPolicy() {
    return { enabled: true, requireOnLogin: true, enforceOnFirstLogin: true, sessionExpiryHours: 3, autoLogoutOnFailures: true, maxFailedAttempts: 3 };
  }

  async function loadPinStatus() {
    try {
      const data = await apiFetch('/api/pin/status');
      // FIX: if 401/unauthorized, token is still missing — treat as unknown, not "no pin"
      if (!data.ok && (data.error === 'unauthorized' || data.error === 'profile_missing')) {
        _pinStatus = null; // null = unknown, will retry
        return null;
      }
      _pinStatus = data.ok ? { pinSet: data.pinSet, pinSetAt: data.pinSetAt } : { pinSet: false };
    } catch (_) {
      _pinStatus = null;
    }
    return _pinStatus;
  }

  // ── DOM Builder (unchanged visual design) ─────────────────────────────────
  function buildOverlayHTML() {
    return '<div id="mumsSecPinOverlay" style="position:fixed;inset:0;z-index:2147483200;background:rgba(5,8,18,.92);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;">'
      + '<div style="position:absolute;inset:0;pointer-events:none;overflow:hidden">'
      + '<div style="position:absolute;top:-20%;left:50%;transform:translateX(-50%);width:600px;height:400px;background:radial-gradient(ellipse at center,rgba(56,189,248,.06) 0%,transparent 60%)"></div>'
      + '<div style="position:absolute;bottom:-10%;right:10%;width:300px;height:300px;background:radial-gradient(ellipse at center,rgba(99,102,241,.04) 0%,transparent 60%)"></div>'
      + '</div>'
      + '<div id="mumsSecPinCard" style="position:relative;width:100%;max-width:380px;background:rgba(10,18,32,.75);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,.1);border-radius:28px;padding:36px;box-shadow:0 0 0 1px rgba(56,189,248,.04),inset 0 1px 0 rgba(255,255,255,.07),0 40px 80px rgba(0,0,0,.65);animation:pinCardIn .35s cubic-bezier(.34,1.56,.64,1) both;">'
      + '<div id="mumsSecPinAccent" style="position:absolute;top:0;left:0;right:0;height:3px;border-radius:28px 28px 0 0;background:linear-gradient(90deg,rgba(56,189,248,0),#38bdf8,#6366f1,#38bdf8,rgba(56,189,248,0));background-size:200%;animation:pinShimmer 3s linear infinite;"></div>'
      + '<div id="mumsSecPinIcon" style="width:56px;height:56px;border-radius:16px;margin:0 auto 18px;background:rgba(56,189,248,.1);border:1px solid rgba(56,189,248,.22);display:flex;align-items:center;justify-content:center;box-shadow:0 0 24px rgba(56,189,248,.1);">'
      + '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><circle cx="12" cy="16" r="1.5" fill="#38bdf8" stroke="none"/></svg>'
      + '</div>'
      + '<div id="mumsSecPinTitle" style="font-size:20px;font-weight:800;color:#eef5ff;text-align:center;margin-bottom:5px;letter-spacing:-.03em"></div>'
      + '<div id="mumsSecPinSubtitle" style="font-size:12px;color:#7a95b5;text-align:center;line-height:1.65;margin-bottom:26px"></div>'
      + '<div id="mumsSecAttemptBar" style="display:none;margin-bottom:16px">'
      + '<div style="display:flex;gap:6px;margin-bottom:6px">'
      + '<div id="mumsAt1" class="mums-attempt-seg" style="flex:1;height:4px;border-radius:2px;background:rgba(255,255,255,.08);transition:.3s"></div>'
      + '<div id="mumsAt2" class="mums-attempt-seg" style="flex:1;height:4px;border-radius:2px;background:rgba(255,255,255,.08);transition:.3s"></div>'
      + '<div id="mumsAt3" class="mums-attempt-seg" style="flex:1;height:4px;border-radius:2px;background:rgba(255,255,255,.08);transition:.3s"></div>'
      + '</div>'
      + '<div style="display:flex;justify-content:space-between;font-family:\'JetBrains Mono\',monospace;font-size:9px;color:#3d5470;letter-spacing:.06em">'
      + '<span id="mumsAt1Lbl">ATTEMPT 1</span><span id="mumsAt2Lbl">ATTEMPT 2</span><span id="mumsAt3Lbl">ATTEMPT 3</span>'
      + '</div></div>'
      + '<div id="mumsSecWarnBox" style="display:none;padding:13px 15px;background:rgba(244,63,94,.06);border:1px solid rgba(244,63,94,.18);border-radius:14px;margin-bottom:18px">'
      + '<div style="font-size:11px;font-weight:700;color:#f43f5e;margin-bottom:5px;display:flex;align-items:center;gap:6px">'
      + '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>Important Notice</div>'
      + '<div style="font-size:11px;color:#7a95b5;line-height:1.6">If you forget your PIN, please advise your <strong style="color:#f59e0b">Reporting Supervisor</strong> to reset your PIN on the System. <strong style="color:#f59e0b">You will not be locked out</strong> — you may log back in immediately after sign out.</div>'
      + '</div>'
      + '<div style="display:flex;justify-content:center;gap:12px;margin-bottom:8px" id="mumsSecDots">'
      + '<div class="mspin-dot" style="width:20px;height:20px;border-radius:50%;border:2px solid rgba(56,189,248,.22);background:transparent;transition:all .28s cubic-bezier(.34,1.56,.64,1)"></div>'
      + '<div class="mspin-dot" style="width:20px;height:20px;border-radius:50%;border:2px solid rgba(56,189,248,.22);background:transparent;transition:all .28s cubic-bezier(.34,1.56,.64,1)"></div>'
      + '<div class="mspin-dot" style="width:20px;height:20px;border-radius:50%;border:2px solid rgba(56,189,248,.22);background:transparent;transition:all .28s cubic-bezier(.34,1.56,.64,1)"></div>'
      + '<div class="mspin-dot" style="width:20px;height:20px;border-radius:50%;border:2px solid rgba(56,189,248,.22);background:transparent;transition:all .28s cubic-bezier(.34,1.56,.64,1)"></div>'
      + '</div>'
      + '<div id="mumsSecHint" style="text-align:center;font-size:11px;color:#3d5470;margin-bottom:22px;min-height:16px;font-family:\'JetBrains Mono\',monospace;letter-spacing:.04em"></div>'
      + '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px">'
      + '<button class="mspk" data-n="1" style="height:58px;border-radius:16px;border:1px solid rgba(255,255,255,.07);background:rgba(255,255,255,.03);color:#eef5ff;cursor:pointer;font-family:\'Sora\',sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;user-select:none;transition:all .14s"><span style="font-size:22px;font-weight:700;line-height:1">1</span></button>'
      + '<button class="mspk" data-n="2" style="height:58px;border-radius:16px;border:1px solid rgba(255,255,255,.07);background:rgba(255,255,255,.03);color:#eef5ff;cursor:pointer;font-family:\'Sora\',sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;user-select:none;transition:all .14s"><span style="font-size:22px;font-weight:700;line-height:1">2</span><span style="font-size:7.5px;letter-spacing:.08em;color:#3d5470;text-transform:uppercase">ABC</span></button>'
      + '<button class="mspk" data-n="3" style="height:58px;border-radius:16px;border:1px solid rgba(255,255,255,.07);background:rgba(255,255,255,.03);color:#eef5ff;cursor:pointer;font-family:\'Sora\',sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;user-select:none;transition:all .14s"><span style="font-size:22px;font-weight:700;line-height:1">3</span><span style="font-size:7.5px;letter-spacing:.08em;color:#3d5470;text-transform:uppercase">DEF</span></button>'
      + '<button class="mspk" data-n="4" style="height:58px;border-radius:16px;border:1px solid rgba(255,255,255,.07);background:rgba(255,255,255,.03);color:#eef5ff;cursor:pointer;font-family:\'Sora\',sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;user-select:none;transition:all .14s"><span style="font-size:22px;font-weight:700;line-height:1">4</span><span style="font-size:7.5px;letter-spacing:.08em;color:#3d5470;text-transform:uppercase">GHI</span></button>'
      + '<button class="mspk" data-n="5" style="height:58px;border-radius:16px;border:1px solid rgba(255,255,255,.07);background:rgba(255,255,255,.03);color:#eef5ff;cursor:pointer;font-family:\'Sora\',sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;user-select:none;transition:all .14s"><span style="font-size:22px;font-weight:700;line-height:1">5</span><span style="font-size:7.5px;letter-spacing:.08em;color:#3d5470;text-transform:uppercase">JKL</span></button>'
      + '<button class="mspk" data-n="6" style="height:58px;border-radius:16px;border:1px solid rgba(255,255,255,.07);background:rgba(255,255,255,.03);color:#eef5ff;cursor:pointer;font-family:\'Sora\',sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;user-select:none;transition:all .14s"><span style="font-size:22px;font-weight:700;line-height:1">6</span><span style="font-size:7.5px;letter-spacing:.08em;color:#3d5470;text-transform:uppercase">MNO</span></button>'
      + '<button class="mspk" data-n="7" style="height:58px;border-radius:16px;border:1px solid rgba(255,255,255,.07);background:rgba(255,255,255,.03);color:#eef5ff;cursor:pointer;font-family:\'Sora\',sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;user-select:none;transition:all .14s"><span style="font-size:22px;font-weight:700;line-height:1">7</span><span style="font-size:7.5px;letter-spacing:.08em;color:#3d5470;text-transform:uppercase">PQRS</span></button>'
      + '<button class="mspk" data-n="8" style="height:58px;border-radius:16px;border:1px solid rgba(255,255,255,.07);background:rgba(255,255,255,.03);color:#eef5ff;cursor:pointer;font-family:\'Sora\',sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;user-select:none;transition:all .14s"><span style="font-size:22px;font-weight:700;line-height:1">8</span><span style="font-size:7.5px;letter-spacing:.08em;color:#3d5470;text-transform:uppercase">TUV</span></button>'
      + '<button class="mspk" data-n="9" style="height:58px;border-radius:16px;border:1px solid rgba(255,255,255,.07);background:rgba(255,255,255,.03);color:#eef5ff;cursor:pointer;font-family:\'Sora\',sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;user-select:none;transition:all .14s"><span style="font-size:22px;font-weight:700;line-height:1">9</span><span style="font-size:7.5px;letter-spacing:.08em;color:#3d5470;text-transform:uppercase">WXYZ</span></button>'
      + '<button class="mspk" data-n="0" style="height:58px;border-radius:16px;border:1px solid rgba(255,255,255,.07);background:rgba(255,255,255,.03);color:#eef5ff;cursor:pointer;font-family:\'Sora\',sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;user-select:none;transition:all .14s;grid-column:span 2"><span style="font-size:22px;font-weight:700;line-height:1">0</span></button>'
      + '<button id="mumsSecDelBtn" style="height:58px;border-radius:16px;border:1px solid rgba(244,63,94,.12);background:rgba(244,63,94,.04);color:rgba(244,63,94,.7);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .14s;user-select:none"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/></svg></button>'
      + '</div>'
      + '<button id="mumsSecCta" style="width:100%;height:48px;border-radius:14px;cursor:pointer;font-size:13px;font-weight:700;letter-spacing:-.01em;background:linear-gradient(135deg,rgba(56,189,248,.3),rgba(99,102,241,.2));border:1px solid rgba(56,189,248,.35);color:#38bdf8;display:flex;align-items:center;justify-content:center;gap:8px;transition:all .15s;margin-bottom:16px;font-family:\'Sora\',sans-serif;"></button>'
      + '<div style="display:flex;align-items:flex-start;gap:9px;padding:10px 12px;background:rgba(20,184,166,.05);border:1px solid rgba(20,184,166,.15);border-radius:12px">'
      + '<svg id="mumsSecNoteIcon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#14b8a6" stroke-width="2" stroke-linecap="round" style="flex-shrink:0;margin-top:2px"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>'
      + '<span id="mumsSecNote" style="font-size:10.5px;color:rgba(20,184,166,.75);line-height:1.5"></span>'
      + '</div>'
      + '</div>'
      + '<style>'
      + '@keyframes pinCardIn{from{opacity:0;transform:scale(.95) translateY(14px)}to{opacity:1;transform:none}}'
      + '@keyframes pinShimmer{0%{background-position:0%}100%{background-position:200%}}'
      + '@keyframes pinShake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-5px)}40%,80%{transform:translateX(5px)}}'
      + '.mspk:hover{background:rgba(56,189,248,.07)!important;border-color:rgba(56,189,248,.28)!important;transform:translateY(-2px);box-shadow:0 8px 20px rgba(0,0,0,.3)}'
      + '.mspk:active{transform:scale(.91)!important;box-shadow:none}'
      + '.mspk:disabled,.mspk[disabled]{opacity:.4;cursor:not-allowed;pointer-events:none}'
      + '#mumsSecDelBtn:hover{background:rgba(244,63,94,.1)!important;border-color:rgba(244,63,94,.3)!important;color:#f43f5e!important}'
      + '#mumsSecCta:hover{background:linear-gradient(135deg,rgba(56,189,248,.42),rgba(99,102,241,.3))!important;box-shadow:0 0 26px rgba(56,189,248,.15),0 4px 16px rgba(0,0,0,.3)}'
      + '.mums-dot-filled{background:linear-gradient(135deg,#38bdf8,#6366f1)!important;border-color:#38bdf8!important;box-shadow:0 0 16px rgba(56,189,248,.45),0 2px 6px rgba(56,189,248,.2)!important}'
      + '.mums-dot-filled::after{content:"";display:block;width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,.35);margin:4px auto}'
      + '.mums-dot-error{border-color:rgba(244,63,94,.5)!important;background:rgba(244,63,94,.22)!important;animation:pinShake .3s ease!important}'
      + '.mums-attempt-hit{background:linear-gradient(90deg,#f43f5e,#f59e0b)!important;box-shadow:0 0 8px rgba(244,63,94,.35)!important}'
      + '.mums-attempt-last{background:#f59e0b!important;animation:pinFlicker 1.5s infinite}'
      + '@keyframes pinFlicker{0%,100%{opacity:1}50%{opacity:.4}}'
      + '</style>'
      + '</div>';
  }

  function el(id) { return document.getElementById(id); }

  function _setInputDisabled(disabled) {
    // FIX BUG 1: disable numpad during in-flight API call to prevent double-submit
    document.querySelectorAll('.mspk').forEach(function(btn) {
      btn.disabled = disabled;
    });
    const delBtn = el('mumsSecDelBtn');
    if (delBtn) delBtn.disabled = disabled;
  }

  function updateDots() {
    const dots = document.querySelectorAll('.mspin-dot');
    const len = _currentInput.length;
    dots.forEach(function(d, i) {
      d.classList.toggle('mums-dot-filled', i < len);
      d.classList.remove('mums-dot-error');
      if (i < len) {
        d.style.background = 'linear-gradient(135deg,#38bdf8,#6366f1)';
        d.style.borderColor = '#38bdf8';
        d.style.boxShadow = '0 0 16px rgba(56,189,248,.45)';
      } else {
        d.style.background = 'transparent';
        d.style.borderColor = 'rgba(56,189,248,.22)';
        d.style.boxShadow = 'none';
      }
    });
    const hintEl = el('mumsSecHint');
    if (hintEl) {
      const hints = { 0: '_ _ _ _', 1: '■ _ _ _', 2: '■ ■ _ _', 3: '■ ■ ■ _', 4: 'PIN complete' };
      hintEl.textContent = hints[len] || '';
    }
  }

  function shakeError() {
    const dots = document.querySelectorAll('.mspin-dot');
    dots.forEach(function(d) {
      d.classList.remove('mums-dot-filled');
      d.classList.add('mums-dot-error');
      d.style.background = 'rgba(244,63,94,.22)';
      d.style.borderColor = 'rgba(244,63,94,.5)';
      d.style.boxShadow = 'none';
    });
    setTimeout(function() {
      _currentInput = '';
      updateDots();
    }, 400);
  }

  function updateAttemptBar(count) {
    const bar = el('mumsSecAttemptBar');
    if (bar) bar.style.display = '';
    const max = (_policy && _policy.maxFailedAttempts) || 3;
    for (let i = 1; i <= 3; i++) {
      const seg = el('mumsAt' + i);
      const lbl = el('mumsAt' + i + 'Lbl');
      if (!seg) continue;
      seg.classList.remove('mums-attempt-hit', 'mums-attempt-last');
      if (i <= count) {
        if (i === count && i === max) {
          seg.classList.add('mums-attempt-last');
          if (lbl) lbl.style.color = '#f59e0b';
        } else {
          seg.classList.add('mums-attempt-hit');
          if (lbl) lbl.style.color = '#f43f5e';
        }
      }
    }
    const warnBox = el('mumsSecWarnBox');
    if (warnBox) warnBox.style.display = (count >= max) ? '' : 'none';
  }

  function escHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function setMode(mode) {
    _mode = mode;
    _currentInput = '';
    _apiInFlight = false;
    updateDots();
    const titleEl    = el('mumsSecPinTitle');
    const subtitleEl = el('mumsSecPinSubtitle');
    const ctaEl      = el('mumsSecCta');
    const noteEl     = el('mumsSecNote');
    const noteIcon   = el('mumsSecNoteIcon');
    const accentEl   = el('mumsSecPinAccent');
    const iconEl     = el('mumsSecPinIcon');

    if (ctaEl) ctaEl.disabled = false;
    _setInputDisabled(false);

    if (mode === 'setup') {
      if (titleEl) titleEl.textContent = 'Create Your PIN';
      const userName = _getUserName();
      if (subtitleEl) subtitleEl.innerHTML = 'Welcome' + (userName ? ', <strong style="color:#eef5ff">' + escHtml(userName) + '</strong>' : '') + '.<br>Set your 4-digit Security PIN to protect your account.';
      if (ctaEl) ctaEl.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg> Create Security PIN';
      if (noteEl) noteEl.textContent = 'Encrypted with PBKDF2. Your PIN is never stored in plain text. Keep it private.';
      if (accentEl) accentEl.style.background = 'linear-gradient(90deg,rgba(56,189,248,0),#38bdf8,#6366f1,#38bdf8,rgba(56,189,248,0))';
      if (iconEl) iconEl.style.background = 'rgba(56,189,248,.1)';
      if (el('mumsSecAttemptBar')) el('mumsSecAttemptBar').style.display = 'none';
      if (el('mumsSecWarnBox')) el('mumsSecWarnBox').style.display = 'none';
    } else if (mode === 'confirm') {
      if (titleEl) titleEl.textContent = 'Confirm Your PIN';
      if (subtitleEl) subtitleEl.innerHTML = 'Enter your new PIN one more time to confirm.';
      if (ctaEl) ctaEl.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg> Confirm & Save PIN';
    } else if (mode === 'verify') {
      const attempts = getSessionAttempts();
      const max = (_policy && _policy.maxFailedAttempts) || 3;
      const isLast = attempts >= (max - 1);
      if (titleEl) titleEl.textContent = isLast ? 'Final Attempt' : 'Verify Identity';
      const userName = _getUserName();
      if (subtitleEl) subtitleEl.innerHTML = 'Welcome back' + (userName ? ', <strong style="color:#eef5ff">' + escHtml(userName) + '</strong>' : '') + '.<br>' + (isLast ? '<span style="color:#f43f5e">This is your last attempt before sign-out.</span>' : 'Enter your PIN to access MUMS.');
      if (ctaEl) ctaEl.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg> Verify & Enter';
      if (noteEl) noteEl.textContent = 'Session expires every 3 hours. 3 failed attempts will sign you out automatically.';
      if (isLast && accentEl) {
        accentEl.style.background = 'linear-gradient(90deg,rgba(244,63,94,0),#f43f5e,#f59e0b,#f43f5e,rgba(244,63,94,0))';
      }
      if (attempts > 0) updateAttemptBar(attempts);
    }
  }

  function _getUserName() {
    try {
      const user = window.Auth && Auth.getUser ? Auth.getUser() : null;
      return user && user.name ? String(user.name).trim() : '';
    } catch (_) { return ''; }
  }

  function addDigit(n) {
    // FIX BUG 1: Ignore input while API call is in-flight
    if (_apiInFlight) return;
    if (_currentInput.length >= 4) return;
    _currentInput += String(n);
    updateDots();
    if (_currentInput.length === 4) {
      setTimeout(function() { handleComplete(); }, 150);
    }
  }

  function delDigit() {
    if (_apiInFlight) return;
    if (_currentInput.length > 0) {
      _currentInput = _currentInput.slice(0, -1);
      updateDots();
    }
  }

  async function handleComplete() {
    if (_apiInFlight) return; // FIX: hard guard against double-submit
    const pin = _currentInput;

    if (_mode === 'setup') {
      _setupFirst = pin;
      setMode('confirm');
      return;
    }

    if (_mode === 'confirm') {
      if (pin !== _setupFirst) {
        shakeError();
        const subtitleEl = el('mumsSecPinSubtitle');
        if (subtitleEl) subtitleEl.innerHTML = '<span style="color:#f43f5e">PINs do not match. Please try again.</span>';
        setMode('setup');
        return;
      }
      _apiInFlight = true;
      _setInputDisabled(true);
      const ctaEl = el('mumsSecCta');
      if (ctaEl) { ctaEl.disabled = true; ctaEl.textContent = 'Saving\u2026'; }
      try {
        const data = await apiFetch('/api/pin/setup', { method: 'POST', body: JSON.stringify({ pin: pin }) });
        if (data.ok) {
          setPinVerifiedAt(Date.now());
          clearSessionAttempts();
          removeOverlay();
          _hideVeil();
          if (typeof _onSuccess === 'function') _onSuccess();
          try { if (window.UI && UI.toast) UI.toast('Security PIN created successfully! \uD83D\uDD12'); } catch(_) {}
        } else {
          shakeError();
          const subtitleEl = el('mumsSecPinSubtitle');
          if (subtitleEl) subtitleEl.innerHTML = '<span style="color:#f43f5e">' + escHtml(data.message || 'Failed to save PIN. Please try again.') + '</span>';
          setMode('setup');
        }
      } catch (_) {
        shakeError();
        setMode('setup');
      }
      _apiInFlight = false;
      return;
    }

    if (_mode === 'verify') {
      _apiInFlight = true;
      _setInputDisabled(true);
      const ctaEl = el('mumsSecCta');
      if (ctaEl) { ctaEl.disabled = true; ctaEl.textContent = 'Verifying\u2026'; }
      try {
        const data = await apiFetch('/api/pin/verify', { method: 'POST', body: JSON.stringify({ pin: pin }) });
        // FIX BUG 1: check result BEFORE re-enabling input
        if (data.verified) {
          setPinVerifiedAt(Date.now());
          clearSessionAttempts();
          removeOverlay();
          _hideVeil();
          if (typeof _onSuccess === 'function') _onSuccess();
        } else {
          _apiInFlight = false;
          shakeError();
          const newCount = data.failCount || 0;
          setSessionAttempts(newCount);
          updateAttemptBar(newCount);
          const max = (_policy && _policy.maxFailedAttempts) || 3;
          if (data.shouldLogout || newCount >= max) {
            const subtitleEl = el('mumsSecPinSubtitle');
            if (subtitleEl) subtitleEl.innerHTML = '<span style="color:#f43f5e">Signing you out now\u2026</span>';
            setTimeout(function() {
              clearPinVerifiedAt();
              clearSessionAttempts();
              try {
                if (window.CloudAuth && CloudAuth.logout) CloudAuth.logout();
                else if (window.Auth && Auth.logout) Auth.logout();
                else window.location.href = '/login.html';
              } catch (_) { window.location.href = '/login.html'; }
            }, 2000);
          } else {
            setMode('verify'); // re-enable CTA + inputs
          }
        }
      } catch (err) {
        _apiInFlight = false;
        setMode('verify');
        shakeError();
      }
    }
  }

  function showOverlay(mode, onSuccess) {
    _onSuccess = onSuccess || null;
    _currentInput = '';
    _setupFirst = '';
    _apiInFlight = false;

    if (!el('mumsSecPinOverlay')) {
      const div = document.createElement('div');
      div.innerHTML = buildOverlayHTML();
      document.body.appendChild(div.firstElementChild);
      _overlayEl = el('mumsSecPinOverlay');
      document.querySelectorAll('.mspk').forEach(function(btn) {
        btn.addEventListener('click', function() { addDigit(btn.getAttribute('data-n')); });
      });
      const delBtn = el('mumsSecDelBtn');
      if (delBtn) delBtn.addEventListener('click', delDigit);
      const ctaEl = el('mumsSecCta');
      if (ctaEl) ctaEl.addEventListener('click', function() {
        if (_currentInput.length === 4) handleComplete();
      });
      document.addEventListener('keydown', _keyHandler);
    }
    setMode(mode);
    document.body.style.overflow = 'hidden';
  }

  function removeOverlay() {
    const overlay = el('mumsSecPinOverlay');
    if (overlay) overlay.remove();
    document.body.style.overflow = '';
    document.removeEventListener('keydown', _keyHandler);
    _overlayEl = null;
    _apiInFlight = false;
  }

  function _keyHandler(e) {
    if (!el('mumsSecPinOverlay')) return;
    if (_apiInFlight) return; // FIX: ignore keyboard during in-flight
    if (e.key >= '0' && e.key <= '9') addDigit(e.key);
    else if (e.key === 'Backspace') delDigit();
    else if (e.key === 'Enter' && _currentInput.length === 4) handleComplete();
  }

  // ── 3-hour session watch ───────────────────────────────────────────────────
  let _sessionCheckTimer = null;
  function startSessionWatch() {
    if (_sessionCheckTimer) clearInterval(_sessionCheckTimer);
    _sessionCheckTimer = setInterval(function() {
      if (!_policy || !_policy.enabled) return;
      if (!_policy.requireOnLogin) return;
      if (isPinSessionExpired() && !el('mumsSecPinOverlay')) {
        loadPinStatus().then(function(status) {
          if (status && status.pinSet) {
            _showVeil();
            showOverlay('verify', function() {
              _hideVeil();
              startSessionWatch();
            });
          }
        });
      }
    }, 30 * 1000);
  }

  // ── Main gate — FIX BUG 1 + BUG 2 ────────────────────────────────────────
  async function gate(onPass) {
    // BUG 2 FIX: Immediately show veil to hide content before any async work
    _showVeil();

    if (_initialized) {
      _hideVeil();
      if (typeof onPass === 'function') onPass();
      return;
    }

    // BUG 1 FIX: Wait for auth token before calling APIs
    await _waitForToken(6000);

    await loadPolicy();

    if (!_policy.enabled) {
      _initialized = true;
      _hideVeil();
      if (typeof onPass === 'function') onPass();
      startSessionWatch();
      return;
    }

    // BUG 1 FIX: Retry loadPinStatus up to 3 times if token was missing
    let retries = 3;
    while (retries > 0) {
      await loadPinStatus();
      if (_pinStatus !== null) break; // got a real result (success or definitive error)
      retries--;
      if (retries > 0) {
        await _waitForToken(3000); // wait for token again
      }
    }

    // If still null after retries, treat as unknown — don't skip PIN, show verify
    if (_pinStatus === null) {
      _pinStatus = { pinSet: true }; // conservative: assume PIN is set, show verify
    }

    // No PIN set — enforce setup
    if (!_pinStatus.pinSet && _policy.enforceOnFirstLogin) {
      showOverlay('setup', function() {
        _initialized = true;
        _hideVeil();
        startSessionWatch();
        if (typeof onPass === 'function') onPass();
      });
      // Veil stays up until setup completes (overlay is on top of veil)
      return;
    }

    // PIN is set — check session expiry
    if (_pinStatus.pinSet && _policy.requireOnLogin && isPinSessionExpired()) {
      showOverlay('verify', function() {
        _initialized = true;
        _hideVeil();
        startSessionWatch();
        if (typeof onPass === 'function') onPass();
      });
      // Veil stays up until verify completes
      return;
    }

    // All clear
    _initialized = true;
    _hideVeil();
    startSessionWatch();
    if (typeof onPass === 'function') onPass();
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  window.PinController = {
    gate: gate,
    showSetup:    function(cb) { _showVeil(); showOverlay('setup', cb); },
    showVerify:   function(cb) { _showVeil(); showOverlay('verify', cb); },
    clearSession: function() { clearPinVerifiedAt(); clearSessionAttempts(); _initialized = false; },
    getPolicy:    function() { return _policy; },
    reloadPolicy: loadPolicy,
  };

})();
