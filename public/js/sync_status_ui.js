/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Strictly protects Enterprise UI/UX, Realtime Sync Logic, Core State Management, and Database/API Adapters. Do NOT modify existing logic or layout in this file without explicitly asking Thunter BOY for clearance. If overlapping changes are required, STOP and provide a RISK IMPACT REPORT first. */
(function(){
  const ENABLE_BLOCKER_MODAL = false; // Enterprise: no disruptive modal popouts.

  // UI stability controls:
  // Debounce rapid status changes and add hysteresis to prevent orange/green flashing.
  // Apply improvements immediately (e.g., Connected), but delay degradations
  // (e.g., Connected -> Offline) to avoid transient drops during token refresh.
  const DEBOUNCE_MS = 200;
  const DOWNGRADE_DELAY_MS = 800;   // Connected -> (Connecting/Polling/Offline)
  const OFFLINE_CONFIRM_MS = 1200;  // Require sustained offline before showing
  const RECENT_CONNECT_GRACE_MS = 1000;

  let lastApplied = { mode: null, detail: '' };
  let lastConnectedAt = 0;
  let pendingTimer = null;
  let pendingSeq = 0;
  let latestWanted = { mode: 'connecting', detail: 'Sync starting…' };

  function root(){ return document.getElementById('realtimeSyncStatus'); }
  function isLoginPage(){
    try {
      const p = String(location.pathname || '');
      return p.endsWith('/login.html') || p.endsWith('login.html');
    } catch (_) { return false; }
  }

  function removeLegacyBlocker(){
    try {
      const el = document.getElementById('realtimeBlocker');
      if (el && el.parentNode) el.parentNode.removeChild(el);
    } catch(_) {}
  }

  function ensureBlocker(){
    if (!ENABLE_BLOCKER_MODAL) return null;
    if (isLoginPage()) return null;
    let el = document.getElementById('realtimeBlocker');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'realtimeBlocker';
    el.className = 'realtime-blocker';
    el.style.display = 'none';
    el.innerHTML = `
      <div class="realtime-blocker-card" role="dialog" aria-modal="true" aria-labelledby="rtTitle">
        <div class="rt-head">
          <div class="rt-title" id="rtTitle">Realtime Sync Required</div>
          <div class="rt-sub">This app requires an active realtime connection to ensure cross-device consistency.</div>
        </div>
        <div class="rt-body">
          <div class="rt-status"><span class="rt-dot"></span><span class="rt-status-text">Connecting…</span></div>
          <div class="rt-detail" aria-live="polite"></div>
          <div class="rt-hint">
            If this persists, verify: (1) you are logged in, (2) Supabase Realtime is enabled for <b>mums_documents</b>, and (3) your network allows WebSockets.
          </div>
        </div>
        <div class="rt-actions">
          <button class="btn btn-primary" type="button" id="rtRetryBtn">Retry connection</button>
          <button class="btn" type="button" id="rtReloadBtn">Reload page</button>
          <button class="btn" type="button" id="rtLoginBtn" style="display:none;">Go to login</button>
        </div>
      </div>
    `;
    document.body.appendChild(el);
    try {
      el.querySelector('#rtRetryBtn').addEventListener('click', function(){
        try {
          if (window.Realtime && typeof Realtime.forceReconnect === 'function') Realtime.forceReconnect();
          else location.reload();
        } catch (_) { location.reload(); }
      });
      el.querySelector('#rtReloadBtn').addEventListener('click', function(){ location.reload(); });
      el.querySelector('#rtLoginBtn').addEventListener('click', function(){
        const next = encodeURIComponent(window.location.href);
        window.location.href = `/login.html?next=${next}`;
      });
    } catch (_) {}
    return el;
  }

  function setBlockerVisible(visible, mode, detail){
    const el = ensureBlocker();
    if (!el) return;
    el.style.display = visible ? 'flex' : 'none';
    if (!visible) return;
    try {
      const st = el.querySelector('.rt-status-text');
      if (st) st.textContent = (mode === 'connecting') ? 'Connecting…' : 'Offline';
      const det = el.querySelector('.rt-detail');
      if (det) det.textContent = detail || '';

      // Only show "Go to login" if we truly appear unauthenticated.
      const loginBtn = el.querySelector('#rtLoginBtn');
      const hasToken = !!(window.CloudAuth && typeof CloudAuth.accessToken === 'function' && CloudAuth.accessToken());
      const needsLogin = /login required/i.test(String(detail || ''));
      if (loginBtn) loginBtn.style.display = (needsLogin && !hasToken) ? 'inline-flex' : 'none';
    } catch (_) {}
  }

  function applyMode(mode, detail){
    if (!ENABLE_BLOCKER_MODAL) removeLegacyBlocker();

    var el = root();
    if (!el) return;

    // IMPORTANT: Do not auto-redirect to login based on realtime status.
    // Realtime may momentarily report "login required" during token refresh,
    // cold starts, or transient 401s. Redirecting here causes a login loop.
    // Auth routing must be handled by Auth.requireUser() (auth.js).
    el.classList.remove('ok','poll','off');
    if (mode === 'realtime') el.classList.add('ok');
    else if (mode === 'connecting' || mode === 'polling') el.classList.add('poll');
    else el.classList.add('off');

    var state = el.querySelector('.state');
    if (state) {
      state.textContent = (mode === 'realtime') ? 'Connected' : (mode === 'connecting') ? 'Connecting' : (mode === 'polling') ? 'Polling' : 'Offline';
    }
    if (detail) el.title = detail;

    // Mandatory realtime: block interactions unless connected.
    if (mode === 'realtime') setBlockerVisible(false);
    else setBlockerVisible(true, mode, detail);

    lastApplied = { mode: mode, detail: String(detail || '') };
    if (mode === 'realtime') lastConnectedAt = Date.now();
  }

  function normalizeMode(m){
    m = String(m || 'offline');
    if (m === 'ok') return 'realtime';
    if (m === 'poll') return 'polling';
    return m;
  }

  function scheduleMode(mode, detail){
    mode = normalizeMode(mode);
    detail = String(detail || '');
    latestWanted = { mode: mode, detail: detail };

    // Improvements are applied immediately.
    if (mode === 'realtime') {
      if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
      applyMode(mode, detail);
      return;
    }

    // Compute delay with hysteresis.
    const now = Date.now();
    let delay = DEBOUNCE_MS;

    // Delay degradations from Connected to reduce flicker.
    if (lastApplied.mode === 'realtime' && mode !== 'realtime') {
      delay = Math.max(delay, DOWNGRADE_DELAY_MS);
    }

    // Offline should be "confirmed" (transient 401s, websocket blips, etc.).
    if (mode === 'offline') {
      delay = Math.max(delay, OFFLINE_CONFIRM_MS);
    }

    // Grace period right after connecting; ignore brief drops.
    if (lastConnectedAt && (now - lastConnectedAt) < RECENT_CONNECT_GRACE_MS) {
      delay = Math.max(delay, RECENT_CONNECT_GRACE_MS - (now - lastConnectedAt));
    }

    // Schedule (debounced). Only the most recent status should be applied.
    pendingSeq += 1;
    const mySeq = pendingSeq;
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(function(){
      pendingTimer = null;
      if (mySeq !== pendingSeq) return;
      if (!latestWanted) return;
      // If we connected while waiting, do nothing (Connected already applied).
      if (latestWanted.mode === 'realtime') return;
      applyMode(latestWanted.mode, latestWanted.detail);
    }, delay);
  }

  window.addEventListener('mums:syncstatus', function(e){
    try {
      var d = (e && e.detail) ? e.detail : {};
      scheduleMode(String(d.mode || 'offline'), String(d.detail || ''));
    } catch(_) {}
  });

  document.addEventListener('DOMContentLoaded', function(){
    // Ensure any legacy blocker element from older builds is removed (modal is optional).
    removeLegacyBlocker();
    // Default to connecting; realtime module will update shortly.
    applyMode('connecting', 'Sync starting…');
  });
})();
