/**
 * @file pause-session-manager.js
 * @description Pause session timer tracking and auto-resume logic
 * @module MUMS/Sessions
 * @version UAT
 */
/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

/* ============================================================
   MUMS Pause Session Manager  — v4.0 (2026-04-26)
   CHANGES vs v3.0:
   [FIX-1] Alarm-Wake Scheduler — auto-resumes 15s before next alarm
   [FIX-2] Extended _blockedIntervalKeys for support_studio + services
   [FIX-3] window.__MUMS_PAUSE_MGR_READY signal post-init
   [FIX-4] BroadcastChannel pause/resume triggers alarm wake in all tabs
   [FIX-5] Overlay shows scheduled auto-resume time when alarm is pending
   All existing auth, realtime, RLS, UI logic: UNCHANGED.
   ============================================================ */

(function(){
  'use strict';

  const CONFIG_KEY     = 'mums_pause_config';
  const SESSION_KEY    = 'mums_supabase_session';
  const DEFAULT_CONFIG = { enabled: true, timeout_minutes: 10 };
  const ALLOWED_TIMEOUTS = new Set([1,5,10,30,60]);

  // Mirrors Store.KEYS for both reminder stores
  const REMINDER_KEYS = ['mums_my_reminders', 'mums_team_reminders'];

  class PauseSessionManager {
    constructor(){
      this.config           = this._loadCachedConfig();
      this.lastActivityKey  = 'mums_last_activity';
      // FIX-PS-BOOT-1: Always reset lastActivity to NOW at construction time.
      // If a previous session wrote a stale timestamp to localStorage (e.g. the user
      // was idle before logout, or the session was auto-paused), the constructor would
      // read that old value and the 15-second checker could fire immediately on the
      // next login → pause() triggers before the page finishes loading → app stuck.
      // Resetting to Date.now() here is safe: the user just authenticated and the page
      // is actively loading — that IS activity. The checker will correctly start its
      // timeout countdown from this fresh timestamp.
      this.lastActivity     = Date.now();
      try { localStorage.setItem('mums_last_activity', String(this.lastActivity)); } catch(_){}
      this.checkerTimer     = null;
      this.activityHandler  = this._onActivity.bind(this);
      this._eventsBound     = false;
      this._saveBound       = false;
      this._paused          = false;
      this._origFetch       = window.fetch;

      // [FIX-2] Extended interval kill list
      this._blockedIntervalKeys = [
        'presenceInterval',
        'syncInterval',
        '__mumsPresenceTimer',
        '__mumsOnlineBarTimer',
        '__mumsClockTimer',
        '__mumsGmtOverviewTimer',
        'annTimer',
        '_ctlQueueTimer',     // support_studio/core_ui.js
        '_colStateDbTimer',   // services-grid.js
        '_colStateQueueTimer' // services-grid.js
      ];

      this.userRole           = this._getCurrentRole();
      this._loadConfigPromise = null;
      this.channel            = null;

      // [FIX-1] Alarm wake state
      this._alarmWakeTimer  = null;
      this._nextAlarmAt     = null;

      try {
        if (typeof BroadcastChannel !== 'undefined') {
          this.channel = new BroadcastChannel('mums_activity');
        }
      } catch(_){}
    }

    // ── PUBLIC: init ────────────────────────────────────────────────
    async init(){
      await this.loadConfig();
      this._bindSettingsPanel();
      this._setupCrossTab();
      if (this.config && this.config.enabled) {
        this._bindActivityListeners();
        this._startChecker();
      }
      // [FIX-3] Ready signal
      try { window.__MUMS_PAUSE_MGR_READY = true; } catch(_){}
    }

    // ── PUBLIC: loadConfig ──────────────────────────────────────────
    async loadConfig(force){
      if (this._loadConfigPromise && !force) return this._loadConfigPromise;
      this._loadConfigPromise = (async()=>{
        try {
          const token = this._getToken();
          const headers = token ? { Authorization: `Bearer ${token}` } : {};
          // FIX-PS-LC-1: Always use _origFetch for config loads.
          // If a previous pause cycle installed _blockFetches(), window.fetch is the
          // blocked interceptor that immediately rejects all requests.
          // The settings panel opens while the session is paused (user clicks Settings
          // from the overlay or via keyboard) — using window.fetch here would cause
          // loadConfig to silently fail and the panel would show stale cached values.
          // Using _origFetch guarantees the GET reaches the server regardless of pause state.
          const safeFetch = (this._origFetch && typeof this._origFetch === 'function')
            ? this._origFetch
            : window.fetch;
          const res = await safeFetch.call(window, '/api/settings/pause-session', { method:'GET', headers, cache:'no-store' });
          if (!res.ok) { return this.config; }
          const data = await res.json().catch(()=>({}));
          if (data && data.ok && data.settings) {
            this.config = this._normalizeConfig(data.settings);
            this._saveCachedConfig(this.config);
            return this.config;
          }
        } catch(_){}
        return this.config;
      })();
      const out = await this._loadConfigPromise;
      this._loadConfigPromise = null;
      return out;
    }

    // ── PUBLIC: pause ───────────────────────────────────────────────
    pause(){
      if (this._paused) return;
      this._paused = true;
      window.__MUMS_PAUSED = true;

      try { this.channel && this.channel.postMessage({type:'pause'}); } catch(_){}

      this._unbindActivityListeners();
      if (this.checkerTimer) { clearInterval(this.checkerTimer); this.checkerTimer = null; }

      // Tear down all known Supabase realtime clients
      try {
        if (window.__MUMS_SB_CLIENT && typeof window.__MUMS_SB_CLIENT.removeAllChannels === 'function') {
          window.__MUMS_SB_CLIENT.removeAllChannels();
        }
      } catch(_){}

      try {
        const rt = window.Realtime;
        if (rt && typeof rt.getRealtimeClient === 'function') {
          const c = rt.getRealtimeClient();
          if (c && typeof c.removeAllChannels === 'function') c.removeAllChannels();
        }
      } catch(_){}

      try {
        const svcClient = window.servicesDB && window.servicesDB.client;
        if (svcClient && typeof svcClient.removeAllChannels === 'function') svcClient.removeAllChannels();
      } catch(_){}

      try {
        const odpClient = window.odpDB && window.odpDB.client;
        if (odpClient && typeof odpClient.removeAllChannels === 'function') odpClient.removeAllChannels();
      } catch(_){}

      this._blockedIntervalKeys.forEach((k)=>{
        try {
          if (window[k]) { clearInterval(window[k]); clearTimeout(window[k]); window[k] = null; }
        } catch(_){}
      });

      try {
        if (window.presenceWatchdog && typeof window.presenceWatchdog.stop === 'function') {
          window.presenceWatchdog.stop();
        }
      } catch(_){}

      this._blockFetches();

      // [FIX-1] Schedule auto-wake before showing overlay (so overlay can show alarm time)
      this._scheduleAlarmWake();
      this._showOverlay();
    }

    // ── INTERNAL: Config normalization ──────────────────────────────
    _normalizeConfig(raw){
      const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};

      // FIX-PS-NC-1: Support all truthy/falsy representations.
      // Supabase JSONB returns native booleans, but localStorage may return
      // stringified JSON where the value was previously cached as a string.
      // We must handle: true/false (boolean), "true"/"false" (string), 1/0 (number).
      let enabled;
      if (src.enabled === undefined) {
        enabled = DEFAULT_CONFIG.enabled;
      } else if (src.enabled === true || src.enabled === false) {
        enabled = src.enabled;  // native boolean — most common from server
      } else {
        const s = String(src.enabled).trim().toLowerCase();
        if      (s === 'true'  || s === '1' || s === 'yes' || s === 'on')  enabled = true;
        else if (s === 'false' || s === '0' || s === 'no'  || s === 'off') enabled = false;
        else enabled = DEFAULT_CONFIG.enabled;
      }

      const timeout = Number(src.timeout_minutes);
      return {
        enabled,
        timeout_minutes: ALLOWED_TIMEOUTS.has(timeout) ? timeout : DEFAULT_CONFIG.timeout_minutes
      };
    }

    _loadCachedConfig(){
      try {
        const raw = localStorage.getItem(CONFIG_KEY);
        if (!raw) return { ...DEFAULT_CONFIG };
        const parsed = JSON.parse(raw);
        return this._normalizeConfig(parsed);
      } catch(_) {
        return { ...DEFAULT_CONFIG };
      }
    }

    _saveCachedConfig(cfg){
      try { localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)); } catch(_){}
    }

    // ── INTERNAL: Activity ──────────────────────────────────────────
    _onActivity(){
      const now = Date.now();
      this.lastActivity = now;
      try { localStorage.setItem(this.lastActivityKey, String(now)); } catch(_){}
      try { this.channel && this.channel.postMessage({type:'activity', ts: now}); } catch(_){}
    }

    _setupCrossTab(){
      if (this.channel) {
        this.channel.onmessage = (e) => {
          if (!e.data) return;
          if (e.data.type === 'activity') {
            this.lastActivity = Number(e.data.ts) || Date.now();
            try { localStorage.setItem(this.lastActivityKey, String(this.lastActivity)); } catch(_){}
          }
          if (e.data.type === 'pause')  { this._applyPauseFromBroadcast(); }
          if (e.data.type === 'resume') { this._resumeFromBroadcast(); }
        };
      }
      window.addEventListener('storage', (e) => {
        if (e.key === this.lastActivityKey) {
          this.lastActivity = Number(e.newValue || Date.now());
        }
      });
    }

    _bindActivityListeners(){
      if (this._eventsBound) return;
      this._eventsBound = true;
      ['mousemove','keydown','scroll','touchstart'].forEach((evt)=>{
        window.addEventListener(evt, this.activityHandler, { passive: true });
      });
      this._onActivity();
    }

    _unbindActivityListeners(){
      if (!this._eventsBound) return;
      this._eventsBound = false;
      ['mousemove','keydown','scroll','touchstart'].forEach((evt)=>{
        window.removeEventListener(evt, this.activityHandler, { passive: true });
      });
    }

    _startChecker(){
      // FIX-PS-8: Stop any existing checker first (prevents duplicate intervals)
      if (this.checkerTimer) { clearInterval(this.checkerTimer); this.checkerTimer = null; }
      // FIX-PS-8: Do NOT start checker if feature is disabled — prevents lingering
      // timers from triggering pause even after user saves enabled=false.
      if (!this.config || !this.config.enabled) return;
      this.checkerTimer = setInterval(()=>{
        if (!this.config || !this.config.enabled || this._paused) return;
        const last = Number(localStorage.getItem(this.lastActivityKey) || this.lastActivity || Date.now());
        const timeoutMs = Number(this.config.timeout_minutes || 10) * 60000;
        if ((Date.now() - last) > timeoutMs) { this.pause(); }
      }, 15000);
    }

    // ── [FIX-1] ALARM WAKE SCHEDULER ───────────────────────────────
    // Reads both reminder stores from localStorage.
    // Finds the soonest future alarmAt (or snoozeUntil if active).
    // Sets a setTimeout to auto-resume 15 seconds before that alarm fires.
    // This keeps the free-tier healthy AND ensures the user never misses an alarm.
    _scheduleAlarmWake(){
      this._cancelAlarmWake(); // clear any stale timer first

      const now = Date.now();
      let soonest = Infinity;

      REMINDER_KEYS.forEach((key) => {
        try {
          const raw = localStorage.getItem(key);
          if (!raw) return;
          const reminders = JSON.parse(raw);
          if (!Array.isArray(reminders)) return;
          reminders.forEach((r) => {
            if (!r || r.closedAt) return; // skip closed
            // Mirror logic from my_reminders.js: snoozeUntil takes priority
            const at = Number(
              (r.snoozeUntil && r.snoozeUntil > now) ? r.snoozeUntil : (r.alarmAt || 0)
            );
            if (at > now && at < soonest) soonest = at;
          });
        } catch(_){}
      });

      if (soonest === Infinity) return; // no pending alarms — stay paused

      this._nextAlarmAt = soonest;

      // Wake 15 seconds early so page reload can complete before alarm fires
      const wakeInMs = Math.max(0, soonest - now - 15000);

      this._alarmWakeTimer = setTimeout(() => {
        if (!this._paused) return; // user already manually resumed
        // Broadcast to all tabs so they all wake together [FIX-4]
        try { this.channel && this.channel.postMessage({type:'resume'}); } catch(_){}
        this._resumeFromBroadcast();
      }, wakeInMs);
    }

    _cancelAlarmWake(){
      if (this._alarmWakeTimer) {
        clearTimeout(this._alarmWakeTimer);
        this._alarmWakeTimer = null;
      }
      this._nextAlarmAt = null;
    }

    // ── INTERNAL: Pause overlay ─────────────────────────────────────
    // [FIX-5] Shows auto-resume time when _nextAlarmAt is set
    _showOverlay(){
      if (document.getElementById('mums-pause-overlay')) return;
      const overlay = document.createElement('div');
      overlay.id = 'mums-pause-overlay';
      overlay.setAttribute('style',
        'position:fixed;inset:0;background:#0b1220f2;z-index:99999;display:flex;' +
        'align-items:center;justify-content:center;flex-direction:column;gap:14px;' +
        'padding:24px;text-align:center;color:#e2e8f0;font-family:Inter,system-ui,sans-serif;'
      );

      let alarmBadge = '';
      if (this._nextAlarmAt) {
        try {
          const d = new Date(this._nextAlarmAt);
          const timeStr = d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
          const dateStr = d.toLocaleDateString([], { month:'short', day:'numeric' });
          alarmBadge =
            '<div style="font-size:12px;color:#38bdf8;border:1px solid rgba(56,189,248,.3);' +
            'border-radius:8px;padding:8px 16px;max-width:420px;">' +
            '\u23F0 Session will auto-resume at <strong>' + timeStr + ' (' + dateStr + ')</strong> for your alarm.' +
            '</div>';
        } catch(_){}
      }

      overlay.innerHTML =
        '<div style="font-size:28px;font-weight:700;letter-spacing:.01em;">Session Paused</div>' +
        '<div style="font-size:13px;opacity:.85;max-width:520px;line-height:1.6;">' +
        'For system protection, all realtime and network requests were paused due to inactivity.</div>' +
        alarmBadge;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Return to Session';
      btn.setAttribute('style',
        'height:42px;padding:0 22px;border-radius:10px;border:1px solid rgba(56,189,248,.45);' +
        'background:linear-gradient(135deg,#0ea5e9,#22d3ee);color:#082f49;font-weight:800;cursor:pointer;'
      );
      btn.onclick = () => {
        try { this.channel && this.channel.postMessage({type:'resume'}); } catch(_){}
        this._resumeFromBroadcast();
      };
      overlay.appendChild(btn);
      document.body.appendChild(overlay);
    }

    // ── INTERNAL: Broadcast-received pause ──────────────────────────
    _applyPauseFromBroadcast(){
      if (this._paused) return;
      this._paused = true;
      window.__MUMS_PAUSED = true;
      this._unbindActivityListeners();
      if (this.checkerTimer) { clearInterval(this.checkerTimer); this.checkerTimer = null; }

      try { if (window.__MUMS_SB_CLIENT?.removeAllChannels) window.__MUMS_SB_CLIENT.removeAllChannels(); } catch(_){}
      try { const c = window.Realtime?.getRealtimeClient?.(); if (c?.removeAllChannels) c.removeAllChannels(); } catch(_){}
      try { if (window.servicesDB?.client?.removeAllChannels) window.servicesDB.client.removeAllChannels(); } catch(_){}
      try { if (window.odpDB?.client?.removeAllChannels) window.odpDB.client.removeAllChannels(); } catch(_){}

      this._blockedIntervalKeys.forEach(k=>{
        try {
          if (window[k]) { clearInterval(window[k]); clearTimeout(window[k]); window[k]=null; }
        } catch(_){}
      });

      try { window.presenceWatchdog?.stop?.(); } catch(_){}

      this._blockFetches();

      // [FIX-4] Schedule alarm wake on broadcast-received pause too
      this._scheduleAlarmWake();
      this._showOverlay();
    }

    // ── INTERNAL: Resume ────────────────────────────────────────────
    _resumeFromBroadcast(){
      // [FIX-1] Always cancel alarm wake timer before reload
      this._cancelAlarmWake();

      this._paused = false;
      window.__MUMS_PAUSED = false;
      document.getElementById('mums-pause-overlay')?.remove();
      this._onActivity();
      location.reload();
    }

    // ── INTERNAL: Fetch block ───────────────────────────────────────
    _blockFetches(){
      if (window.fetch !== this._origFetch) return;
      const orig = this._origFetch;
      window.fetch = function(input, init){
        if (window.__MUMS_PAUSED) {
          return Promise.reject(new Error('MUMS paused: network requests disabled.'));
        }
        return orig.call(this, input, init);
      };
    }

    // ── INTERNAL: Token / Role helpers ──────────────────────────────
    _getToken(){
      try {
        if (window.CloudAuth && typeof CloudAuth.accessToken === 'function') {
          const t = String(CloudAuth.accessToken() || '').trim();
          if (t) return t;
        }
      } catch(_){}
      try {
        const raw = localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        return parsed && parsed.access_token ? String(parsed.access_token) : '';
      } catch(_){}
      return '';
    }

    _getCurrentRole(){
      try {
        if (window.Auth && typeof Auth.getUser === 'function') {
          const u = Auth.getUser();
          const role = String((u && u.role) || '').trim().toUpperCase().replace(/\s+/g,'_');
          if (role) return role;
        }
      } catch(_){}
      try {
        const raw = localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY);
        const s = raw ? JSON.parse(raw) : null;
        const role = String((s && (s.role || (s.user_metadata && s.user_metadata.role))) || '').trim().toUpperCase().replace(/\s+/g,'_');
        return role;
      } catch(_){}
      return '';
    }

    // ── INTERNAL: Settings panel (Super Admin only) ─────────────────
    // FIX-PS-1: Always re-evaluate the role at bind time (not at constructor time).
    //   Role from constructor (_getCurrentRole at new PauseSessionManager()) may be
    //   stale if CloudAuth session hadn't settled yet.
    // FIX-PS-2: When called again (panelInits resets _saveBound), fully re-syncs
    //   UI values from latest config and re-registers the save click listener.
    _bindSettingsPanel(){
      const enabledEl = document.getElementById('pause-enabled');
      const timeoutEl = document.getElementById('pause-timeout');
      const saveBtn   = document.getElementById('pause-save');
      const statusEl  = document.getElementById('pause-save-msg');
      if (!enabledEl || !timeoutEl || !saveBtn) return;

      // FIX-PS-1: Re-read role live — not from stale constructor cache.
      // Auth.getUser() is available after the PIN gate resolves.
      const role = this._getCurrentRole();
      const isSA = role === 'SUPER_ADMIN';

      // Always sync UI to latest config on every bind (covers re-open case)
      enabledEl.checked = !!this.config.enabled;
      timeoutEl.value   = String(this.config.timeout_minutes || DEFAULT_CONFIG.timeout_minutes);

      // FIX-PS-3: Correctly gate editing — Super Admin can change, others see read-only
      enabledEl.disabled    = !isSA;
      timeoutEl.disabled    = !isSA;
      saveBtn.style.display = isSA ? '' : 'none';

      // FIX-PS-2: _saveBound guard is reset by panelInits on each panel open
      if (this._saveBound) return;
      this._saveBound = true;

      saveBtn.addEventListener('click', async ()=>{
        // FIX-PS-4: Re-read role at click time (double-guard against privilege escalation)
        const clickRole = this._getCurrentRole();
        if (clickRole !== 'SUPER_ADMIN') {
          if (statusEl) {
            statusEl.textContent = '✗ Insufficient permissions.';
            statusEl.style.opacity = '1';
            statusEl.style.color   = '#ef4444';
            setTimeout(()=>{ if(statusEl) statusEl.style.opacity = '0'; }, 3000);
          }
          return;
        }

        const timeoutVal = Number(timeoutEl.value || DEFAULT_CONFIG.timeout_minutes);
        const payload = {
          enabled: !!enabledEl.checked,
          timeout_minutes: ALLOWED_TIMEOUTS.has(timeoutVal)
            ? timeoutVal
            : DEFAULT_CONFIG.timeout_minutes
        };

        if (!ALLOWED_TIMEOUTS.has(payload.timeout_minutes)) {
          if (statusEl) {
            statusEl.textContent = '✗ Invalid timeout option.';
            statusEl.style.opacity = '1';
            statusEl.style.color   = '#ef4444';
          }
          return;
        }

        saveBtn.disabled    = true;
        saveBtn.textContent = 'Saving\u2026';

        try {
          // FIX-PS-5: Ensure window.fetch is NOT the blocked version before saving.
          // If a previous pause cycle installed _blockFetches(), the blocked fetch
          // would reject here. Use _origFetch directly to guarantee the request lands.
          const safeFetch = (this._origFetch && window.fetch !== this._origFetch)
            ? this._origFetch
            : window.fetch;

          const token = this._getToken();
          const res = await safeFetch.call(window, '/api/settings/pause-session', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {})
            },
            body: JSON.stringify(payload)
          });

          let data = {};
          try { data = await res.json(); } catch(_) {}

          if (res.ok && data && data.ok && data.settings) {
            this.config = this._normalizeConfig(data.settings);
            this._saveCachedConfig(this.config);
            this._onActivity();

            // FIX-PS-6: Apply the new enabled state immediately — don't wait for reload.
            // If user disabled pause session, stop the checker and unbind listeners.
            // If user re-enabled, restart the checker.
            if (!this.config.enabled) {
              this._unbindActivityListeners();
              if (this.checkerTimer) { clearInterval(this.checkerTimer); this.checkerTimer = null; }
            } else {
              if (!this._paused) {
                this._bindActivityListeners();
                this._startChecker();
              }
            }

            if (statusEl) {
              statusEl.textContent = '\u2713 Pause session settings saved.';
              statusEl.style.opacity = '1';
              statusEl.style.color   = '#22c55e';
            }
          } else {
            const errMsg = (data && (data.message || data.error))
              ? String(data.message || data.error)
              : ('HTTP ' + res.status);
            if (statusEl) {
              statusEl.textContent = '\u2717 ' + errMsg;
              statusEl.style.opacity = '1';
              statusEl.style.color   = '#ef4444';
            }
          }
        } catch(err) {
          if (statusEl) {
            statusEl.textContent = '\u2717 Network error. ' + (err && err.message ? String(err.message) : '');
            statusEl.style.opacity = '1';
            statusEl.style.color   = '#ef4444';
          }
        } finally {
          saveBtn.disabled    = false;
          saveBtn.textContent = 'Save';
          if (statusEl) {
            setTimeout(()=>{ if(statusEl) statusEl.style.opacity = '0'; }, 3500);
          }
        }
      });
    }
  }

  window.PauseSessionManager = PauseSessionManager;
})();
