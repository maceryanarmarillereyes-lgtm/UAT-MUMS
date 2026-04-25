(function(){
  'use strict';

  const CONFIG_KEY = 'mums_pause_config';
  const SESSION_KEY = 'mums_supabase_session';
  const DEFAULT_CONFIG = { enabled: true, timeout_minutes: 10 };
  const ALLOWED_TIMEOUTS = new Set([1,5,10,30,60]); // ADDED 1

  class PauseSessionManager {
    constructor(){
      this.config = this._loadCachedConfig();
      this.lastActivityKey = 'mums_last_activity';
      this.lastActivity = Number(localStorage.getItem(this.lastActivityKey) || Date.now());
      this.checkerTimer = null;
      this.activityHandler = this._onActivity.bind(this);
      this._eventsBound = false;
      this._saveBound = false;
      this._paused = false;
      this._origFetch = window.fetch;
      this._blockedIntervalKeys = [
        'presenceInterval','syncInterval','__mumsPresenceTimer','__mumsOnlineBarTimer','__mumsClockTimer',
        '__mumsGmtOverviewTimer','annTimer'
      ];
      this.userRole = this._getCurrentRole();
      this._loadConfigPromise = null;
      this.channel = new BroadcastChannel('mums_activity');
    }

    async init(){
      await this.loadConfig();
      this._bindSettingsPanel();
      this._setupCrossTab();
      if (this.config && this.config.enabled) {
        this._bindActivityListeners();
        this._startChecker();
      }
    }

    async loadConfig(force){
      if (this._loadConfigPromise && !force) return this._loadConfigPromise;
      this._loadConfigPromise = (async()=>{
        try {
          const token = this._getToken();
          const headers = token ? { Authorization: `Bearer ${token}` } : {};
          const res = await fetch('/api/settings/pause-session', { method:'GET', headers, cache:'no-store' });
          const data = await res.json().catch(()=>({}));
          if (res.ok && data && data.ok && data.settings) {
            this.config = this._normalizeConfig(data.settings);
            this._saveCachedConfig(this.config);
            return this.config;
          }
        } catch (_) {}
        return this.config;
      })();
      const out = await this._loadConfigPromise;
      this._loadConfigPromise = null;
      return out;
    }

    pause(){
      if (this._paused) return;
      this._paused = true;
      window.__MUMS_PAUSED = true;

      // Broadcast to other tabs
      try { this.channel.postMessage({type:'pause'}); } catch(_){}

      this._unbindActivityListeners();
      if (this.checkerTimer) {
        clearInterval(this.checkerTimer);
        this.checkerTimer = null;
      }

      try {
        if (window.__MUMS_SB_CLIENT && typeof window.__MUMS_SB_CLIENT.removeAllChannels === 'function') {
          window.__MUMS_SB_CLIENT.removeAllChannels();
        }
      } catch (_) {}

      try {
        const rt = window.Realtime;
        if (rt && typeof rt.getRealtimeClient === 'function') {
          const c = rt.getRealtimeClient();
          if (c && typeof c.removeAllChannels === 'function') c.removeAllChannels();
        }
      } catch (_) {}

      try {
        const svcClient = window.servicesDB && window.servicesDB.client;
        if (svcClient && typeof svcClient.removeAllChannels === 'function') {
          svcClient.removeAllChannels();
        }
      } catch (_) {}

      try {
        const odpClient = window.odpDB && window.odpDB.client;
        if (odpClient && typeof odpClient.removeAllChannels === 'function') {
          odpClient.removeAllChannels();
        }
      } catch (_) {}

      this._blockedIntervalKeys.forEach((k)=>{
        try {
          if (window[k]) {
            clearInterval(window[k]);
            clearTimeout(window[k]);
            window[k] = null;
          }
        } catch (_) {}
      });

      try {
        if (window.presenceWatchdog && typeof window.presenceWatchdog.stop === 'function') {
          window.presenceWatchdog.stop();
        }
      } catch (_) {}

      this._blockFetches();
      this._showOverlay();
    }

    _normalizeConfig(raw){
      const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
      const enabled = src.enabled !== undefined ? src.enabled === true : DEFAULT_CONFIG.enabled;
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
      } catch (_) {
        return { ...DEFAULT_CONFIG };
      }
    }

    _saveCachedConfig(cfg){
      try { localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)); } catch (_) {}
    }

    _onActivity(){ 
      const now = Date.now();
      this.lastActivity = now;
      try { localStorage.setItem(this.lastActivityKey, String(now)); } catch(_){}
      try { this.channel.postMessage({type:'activity', ts: now}); } catch(_){}
    }

    _setupCrossTab(){
      this.channel.onmessage = (e) => {
        if (!e.data) return;
        if (e.data.type === 'activity') {
          this.lastActivity = Number(e.data.ts) || Date.now();
          try { localStorage.setItem(this.lastActivityKey, String(this.lastActivity)); } catch(_){}
        }
        if (e.data.type === 'pause') {
          this._showOverlay();
        }
        if (e.data.type === 'resume') {
          this._resumeFromBroadcast();
        }
      };
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
      if (this.checkerTimer) clearInterval(this.checkerTimer);
      this.checkerTimer = setInterval(()=>{
        if (!this.config || !this.config.enabled || this._paused) return;
        const last = Number(localStorage.getItem(this.lastActivityKey) || this.lastActivity || Date.now());
        const timeoutMs = Number(this.config.timeout_minutes || 10) * 60000;
        if ((Date.now() - last) > timeoutMs) {
          this.pause();
        }
      }, 15000);
    }

    _showOverlay(){
      if (document.getElementById('mums-pause-overlay')) return;
      const overlay = document.createElement('div');
      overlay.id = 'mums-pause-overlay';
      overlay.setAttribute('style', 'position:fixed;inset:0;background:#0b1220f2;z-index:99999;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:14px;padding:24px;text-align:center;color:#e2e8f0;font-family:Inter,system-ui,sans-serif;');
      overlay.innerHTML = '<div style="font-size:28px;font-weight:700;letter-spacing:.01em;">Session Paused</div>' +
        '<div style="font-size:13px;opacity:.85;max-width:520px;line-height:1.6;">For system protection, all realtime and network requests were paused due to inactivity.</div>';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Return to Session';
      btn.setAttribute('style', 'height:42px;padding:0 22px;border-radius:10px;border:1px solid rgba(56,189,248,.45);background:linear-gradient(135deg,#0ea5e9,#22d3ee);color:#082f49;font-weight:800;cursor:pointer;');
      btn.onclick = () => {
        try { this.channel.postMessage({type:'resume'}); } catch(_){}
        this._resumeFromBroadcast();
      };
      overlay.appendChild(btn);
      document.body.appendChild(overlay);
    }

    _resumeFromBroadcast(){
      this._paused = false;
      window.__MUMS_PAUSED = false;
      document.getElementById('mums-pause-overlay')?.remove();
      this._onActivity();
      location.reload();
    }

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

    _getToken(){
      try {
        if (window.CloudAuth && typeof CloudAuth.accessToken === 'function') {
          const t = String(CloudAuth.accessToken() || '').trim();
          if (t) return t;
        }
      } catch (_) {}
      try {
        const raw = localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        return parsed && parsed.access_token ? String(parsed.access_token) : '';
      } catch (_) {}
      return '';
    }

    _getCurrentRole(){
      try {
        if (window.Auth && typeof Auth.getUser === 'function') {
          const u = Auth.getUser();
          const role = String((u && u.role) || '').trim().toUpperCase().replace(/\s+/g,'_');
          if (role) return role;
        }
      } catch (_) {}
      try {
        const raw = localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY);
        const s = raw ? JSON.parse(raw) : null;
        const role = String((s && (s.role || (s.user_metadata && s.user_metadata.role))) || '').trim().toUpperCase().replace(/\s+/g,'_');
        return role;
      } catch (_) {}
      return '';
    }

    _bindSettingsPanel(){
      const enabledEl = document.getElementById('pause-enabled');
      const timeoutEl = document.getElementById('pause-timeout');
      const saveBtn = document.getElementById('pause-save');
      const statusEl = document.getElementById('pause-save-msg');
      if (!enabledEl || !timeoutEl || !saveBtn) return;

      enabledEl.checked = !!this.config.enabled;
      timeoutEl.value = String(this.config.timeout_minutes || DEFAULT_CONFIG.timeout_minutes);

      const role = this.userRole || this._getCurrentRole();
      const isSuperAdmin = role === 'SUPER_ADMIN';
      enabledEl.disabled = !isSuperAdmin;
      timeoutEl.disabled = !isSuperAdmin;
      saveBtn.style.display = isSuperAdmin ? '' : 'none';

      if (this._saveBound) return;
      this._saveBound = true;
      saveBtn.addEventListener('click', async ()=>{
        const payload = {
          enabled: !!enabledEl.checked,
          timeout_minutes: Number(timeoutEl.value || DEFAULT_CONFIG.timeout_minutes)
        };

        if (!ALLOWED_TIMEOUTS.has(payload.timeout_minutes)) {
          if (statusEl) {
            statusEl.textContent = 'Invalid timeout option.';
            statusEl.style.opacity = '1';
            statusEl.style.color = '#ef4444';
          }
          return;
        }

        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving…';
        try {
          const token = this._getToken();
          const res = await fetch('/api/settings/pause-session', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {})
            },
            body: JSON.stringify(payload)
          });
          const data = await res.json().catch(()=>({}));
          if (res.ok && data && data.ok && data.settings) {
            this.config = this._normalizeConfig(data.settings);
            this._saveCachedConfig(this.config);
            this._onActivity();
            if (statusEl) {
              statusEl.textContent = '✓ Pause session settings saved.';
              statusEl.style.opacity = '1';
              statusEl.style.color = '#22c55e';
            }
          } else {
            if (statusEl) {
              statusEl.textContent = '✗ Save failed.';
              statusEl.style.opacity = '1';
              statusEl.style.color = '#ef4444';
            }
          }
        } catch (_) {
          if (statusEl) {
            statusEl.textContent = '✗ Network error.';
            statusEl.style.opacity = '1';
            statusEl.style.color = '#ef4444';
          }
        } finally {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save';
          if (statusEl) {
            setTimeout(()=>{ statusEl.style.opacity = '0'; }, 3500);
          }
        }
      });
    }
  }

  window.PauseSessionManager = PauseSessionManager;
})();
