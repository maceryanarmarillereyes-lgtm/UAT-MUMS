/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */


/*
  Realtime (Collaboration Sync)
  -------------------------------------------------------------------
  - Local dev: optional WebSocket relay (ws://localhost...) for fast iteration.
  - Production: cloud sync via Supabase (Vercel functions /api/sync/*).

  Data model:
  - Only shared/team-interaction features are synced (announcements, schedules,
    mailbox state/tables, cases, team reminders, activity logs, etc.).
  - Per-user preferences (theme, world clock, quick links) are NOT synced here.

  Sync modes:
  - Green  : realtime channel (Supabase Realtime) active
  - Yellow : connecting / reconnecting
  - Red    : offline (blocked when realtime is mandatory)
*/
(function(){
  const isLocalHost = (location.hostname === 'localhost' || location.hostname === '127.0.0.1');

  // Keys that should synchronize across all devices/users (global read).
  const SYNC_KEYS = [
    'ums_announcements',
    'mums_team_reminders',
    'ums_weekly_schedules',
    // Canonical schedule docs (enterprise) — used by My Schedule + Members for stable cross-device sync.
    'mums_schedule_blocks',
    'mums_schedule_snapshots',
    'ums_master_schedule',
    'ums_schedule_locks',
    'mums_schedule_lock_state',
    'ums_member_leaves',
    'ums_schedule_notifs',
    'mums_schedule_notifs',
    'mums_team_config',
    'mums_attendance',
    'mums_mailbox_tables',
    'mums_mailbox_state',
    'ums_cases',
    'ums_activity_logs',
    'mums_mailbox_time_override_cloud',
    'mums_user_events'
  ];

  const DEFAULT_RELAY_URL = 'ws://localhost:17601';
  const SUPABASE_STORAGE = {
    getItem(){ return null; },
    setItem(){},
    removeItem(){}
  };

  let ws = null;
  let wsOk = false;

  // Cloud sync
  // NOTE: Realtime is mandatory for collaborative features in production.
  // We still run a light periodic reconciliation pull while realtime is connected
  // to protect against missed events (tab sleep, network hiccups).
  let lastCloudTs = 0;
  let cloudOkAt = 0;
  let cloudMode = 'offline'; // realtime | connecting | offline
  let sbClient = null;
  let sbChannel = null;
  let connectTimer = null;
  let reconnectTimer = null;
  let reconcileTimer = null;
  let offlinePullTimer = null;
  let reconnectBackoffMs = 1200;
  let lastAuthToken = '';
  let userExplicitlyLoggedOut = false;
  let bootStarted = false;
  let bootCompleted = false;
  let forceClientRecreate = false;

  // BUG FIX 2026-04-16: authtoken reconnect debounce.
  // Without this, every token rotation (which fires mums:authtoken) triggers:
  //   connectCloudMandatory → stopCloud (unsubscribes) → CLOSED status
  //   → scheduleReconnect('closed') → connectCloudMandatory again
  // This creates a console-spam loop of "[Realtime Guard] Preparing realtime subscribe"
  // and keeps the UI stuck at "Connecting" briefly after every token refresh.
  let _authtokenDebounceTimer = null;
  const _AUTHTOKEN_DEBOUNCE_MS = 400; // wait 400ms before reconnecting on token rotation

  // Realtime subscription generation guard (prevents CONNECTED/OFFLINE flicker on reconnect)
  let connectSeq = 0;
  let activeSeq = 0;

  const pushTimers = new Map();
  const lastLocalByKey = new Map();
  const clientId = (function(){
    try {
      const k = 'mums_client_id';
      let v = localStorage.getItem(k);
      if (!v) {
        v = 'c_' + Math.random().toString(36).slice(2) + '_' + Date.now().toString(36);
        localStorage.setItem(k, v);
      }
      return v;
    } catch (_) {
      return 'c_' + Math.random().toString(36).slice(2);
    }
  })();

  function dispatchStatus(mode, detail){
    cloudMode = mode;
    try {
      window.dispatchEvent(new CustomEvent('mums:syncstatus', {
        detail: { mode, detail: detail || '', lastOkAt: cloudOkAt }
      }));
    } catch(_) {}
  }

  function shouldSyncKey(key){
    return SYNC_KEYS.indexOf(key) !== -1;
  }

  const MEMBER_PUSH_KEYS = new Set([
    'mums_attendance',
    'mums_mailbox_state',
    'mums_mailbox_tables',  // REALTIME FIX: MEMBERs must push mailbox table updates
                             // so ALL connected users (other MEMBERs, TL, SA) see
                             // assignment changes without a refresh.
    'ums_cases',
    'ums_schedule_notifs',
    'mums_schedule_notifs'
  ]);

  // Persisted suppression for server-forbidden keys.
  // If the server returns 403 for a key, continuing to attempt pushes creates
  // request storms and console spam (especially on dashboards that emit
  // frequent log updates). We remember forbidden keys per-browser and skip
  // subsequent pushes for those keys.
  const FORBIDDEN_PUSH_KEYS_STORAGE = 'mums_forbidden_push_keys_v1';
  // If a user's role changes (e.g., promoted to Team Lead), we should not
  // permanently suppress keys forever. We expire the suppression periodically.
  const FORBIDDEN_PUSH_KEYS_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
  const forbiddenPushKeys = new Set();

  function loadForbiddenPushKeys(){
    try{
      const raw = localStorage.getItem(FORBIDDEN_PUSH_KEYS_STORAGE);
      const parsed = raw ? JSON.parse(raw) : null;

      // Back-compat: older builds stored a raw array.
      let keys = [];
      let ts = 0;
      if(Array.isArray(parsed)){
        keys = parsed;
      } else if(parsed && typeof parsed === 'object'){
        keys = Array.isArray(parsed.keys) ? parsed.keys : [];
        ts = Number(parsed.ts || 0);
      }

      if(ts && (Date.now() - ts) > FORBIDDEN_PUSH_KEYS_TTL_MS){
        try{ localStorage.removeItem(FORBIDDEN_PUSH_KEYS_STORAGE); }catch(_){ }
        return;
      }

      keys.forEach((k)=>{ if(k) forbiddenPushKeys.add(String(k)); });
    }catch(_){ }
  }
  function saveForbiddenPushKeys(){
    try{
      localStorage.setItem(
        FORBIDDEN_PUSH_KEYS_STORAGE,
        JSON.stringify({ v: 1, ts: Date.now(), keys: Array.from(forbiddenPushKeys) })
      );
    }catch(_){ }
  }
  function markForbiddenPushKey(key){
    try{
      const k = String(key||'').trim();
      if(!k) return;
      if(forbiddenPushKeys.has(k)) return;
      forbiddenPushKeys.add(k);
      saveForbiddenPushKeys();
      try{ if(window.Store && Store.addLog) Store.addLog({ action: 'SYNC_PUSH_FORBIDDEN', detail: k }); }catch(_){ }
    }catch(_){ }
  }

  // Load once on module init.
  loadForbiddenPushKeys();

  function canPushKey(key){
    try{
      const k = String(key||'');
      if(forbiddenPushKeys.has(k)) return false;
      if (!(window.CloudAuth && CloudAuth.isEnabled && CloudAuth.isEnabled())) return false;
      if (!(CloudAuth.accessToken && CloudAuth.accessToken())) return false;
      const u = (window.Auth && Auth.getUser) ? (Auth.getUser()||{}) : {};
      const role = String(u.role || 'MEMBER');
      if (role === 'MEMBER' && !MEMBER_PUSH_KEYS.has(k)) return false;
      return true;
    }catch(_){
      return false;
    }
  }

  
  // ----------------------
  // Offline-first push queue (all SYNC_KEYS)
  // ----------------------
  const QUEUE_KEY = 'mums_sync_queue_v1';
  let queueCache = null;
  let flushing = false;

  function loadQueue(){
    try {
      const raw = localStorage.getItem(QUEUE_KEY);
      const obj = raw ? JSON.parse(raw) : {};
      return (obj && typeof obj === 'object') ? obj : {};
    } catch(_) { return {}; }
  }
  function saveQueue(q){
    try {
      queueCache = q;
      localStorage.setItem(QUEUE_KEY, JSON.stringify(q || {}));
    } catch(_) {}
  }
  function getQueue(){
    if (!queueCache) queueCache = loadQueue();
    return queueCache;
  }
  function isQueued(key){
    try {
      const q = getQueue();
      return !!(q && q[String(key||'')]);
    } catch(_) { return false; }
  }

  function enqueue(key, value, removedIds, op, reason, err){
    try {
      const k = String(key||'');
      if (!k) return;
      if (!canPushKey(k)) return;
      const q = getQueue();
      const prev = q[k] || {};
      const next = {
        key: k,
        value: value,
        removedIds: Array.isArray(removedIds) ? removedIds : [],
        op: op || 'set',
        ts: Date.now(),
        tries: Number(prev.tries || 0),
        lastError: err ? String(err) : (prev.lastError || ''),
        reason: reason ? String(reason) : (prev.reason || '')
      };
      q[k] = next;
      saveQueue(q);
      try { if (window.Store && Store.addLog) Store.addLog({ action: 'SYNC_QUEUE_ENQUEUE', detail: k + ' (reason=' + next.reason + ')' }); } catch(_) {}
    } catch(_) {}
  }

  async function flushQueue(trigger){
    if (flushing) return { ok:false, error:'flush_in_progress' };
    flushing = true;
    try {
      const q = getQueue();
      const keys = Object.keys(q || {});
      if (!keys.length) return { ok:true, flushed:0, remaining:0 };

      try { if (window.Store && Store.addLog) Store.addLog({ action: 'SYNC_QUEUE_FLUSH_START', detail: 'keys=' + keys.length + ' trigger=' + String(trigger||'') }); } catch(_) {}

      let okCount = 0;
      const flushedEvents = [];

      for (const k of keys) {
        const item = q[k];
        if (!item) continue;
        if (!canPushKey(item.key || k)) {
          try{ if (window.Store && Store.addLog) Store.addLog({ action: 'SYNC_QUEUE_DROP_FORBIDDEN', detail: String(item.key||k) + ' reason=client_guard' }); }catch(_){}
          delete q[k];
          continue;
        }

        // Only attempt flush when cloud auth is available.
        if (!(window.CloudAuth && CloudAuth.isEnabled && CloudAuth.isEnabled() && CloudAuth.accessToken && CloudAuth.accessToken())) {
          item.tries = Number(item.tries||0) + 1;
          item.lastError = 'no_auth_token';
          q[k] = item;
          continue;
        }

        try {
          const out = await cloudFetch('/api/sync/push', {
            method: 'POST',
            body: JSON.stringify({
              key: item.key,
              value: item.value,
              removedIds: item.removedIds || [],
              op: item.op || 'set',
              clientId: clientId,
              ts: Date.now(),
              _fromQueue: true
            })
          });

          if (out && out.ok) {
            try{
              if(String(item.key||'') === 'mums_user_events'){
                flushedEvents.push({ key: item.key, value: item.value, ts: item.ts || Date.now() });
              }
            }catch(_){ }
            delete q[k];
            okCount++;
          } else {
            const st = out ? out.status : 0;
            // Permanent failure hardening:
            // - 403 indicates the current role is not allowed to push this key.
            //   Keeping it in the queue causes repeated 403 spam on resume.
            if(st === 403){
              try{ markForbiddenPushKey(item.key || k); }catch(_){ }
              try{ if (window.Store && Store.addLog) Store.addLog({ action: 'SYNC_QUEUE_DROP_FORBIDDEN', detail: String(item.key||k) + ' status=403' }); }catch(_){}
              delete q[k];
              continue;
            }
            item.tries = Number(item.tries||0) + 1;
            item.lastError = 'http_' + String(out ? out.status : 'unknown');
            // FIX v3.9.25: Drop items after 10 failed attempts to prevent infinite retry loops
            // that cause ERR_INSUFFICIENT_RESOURCES browser exhaustion.
            if (item.tries >= 10) {
              try{ if(window.Store && Store.addLog) Store.addLog({ action: 'SYNC_QUEUE_DROP_MAX_TRIES', detail: String(item.key||k) }); }catch(_){}
              delete q[k];
            } else {
              q[k] = item;
            }
          }
        } catch (e) {
          item.tries = Number(item.tries||0) + 1;
          item.lastError = String(e && e.message ? e.message : e);
          // FIX v3.9.25: Drop after 10 tries to prevent browser resource exhaustion
          if (item.tries >= 10) {
            try{ if(window.Store && Store.addLog) Store.addLog({ action: 'SYNC_QUEUE_DROP_MAX_TRIES', detail: String(item.key||k) }); }catch(_){}
            delete q[k];
          } else {
            q[k] = item;
          }
        }
      }

      saveQueue(q);

      try { if (window.Store && Store.addLog) Store.addLog({ action: 'SYNC_QUEUE_FLUSH_DONE', detail: 'ok=' + okCount + ' remaining=' + Object.keys(q||{}).length }); } catch(_) {}

      // Enhanced: dispatch queue flush details for listeners (User Management realtime).
      try{
        if(window.dispatchEvent){
          window.dispatchEvent(new CustomEvent('SYNC_QUEUE_FLUSH_DONE', { detail: { ok:true, flushed: okCount, remaining: Object.keys(q||{}).length, events: flushedEvents } }));
          // If the flush contained a user_created event, nudge the UI to refresh the roster.
          const userCreated = (flushedEvents||[]).find(e=>e && e.value && e.value.type === 'user_created');
          if(userCreated){
            window.dispatchEvent(new CustomEvent('mums:store', { detail: { key: 'mums_user_list_updated', event: userCreated.value, source: 'SYNC_QUEUE_FLUSH_DONE' } }));
          }
        }
      }catch(_){ }

      return { ok:true, flushed: okCount, remaining: Object.keys(q||{}).length };
    } finally {
      flushing = false;
    }
  }

  // Keep queue cache fresh across tabs.
  try {
    window.addEventListener('storage', (e)=>{
      if (e && e.key === QUEUE_KEY) queueCache = null;
    });
  } catch(_) {}


function applyRemoteKey(key, value){
    // Migrate legacy lock key to new cloud key
    try{
      if(String(key||'') === 'ums_schedule_locks') key = 'mums_schedule_lock_state';
    }catch(_){ }
    if (!shouldSyncKey(key)) return;
    // Do not overwrite locally queued changes.
    if (isQueued && isQueued(key)) {
      try { if (window.Store && Store.addLog) Store.addLog({ action: 'SYNC_REMOTE_SKIPPED_QUEUED', detail: String(key||'') }); } catch(_){}
      return;
    }
    if (!window.Store) return;
    const rawWrite = (typeof Store.__rawWrite === 'function') ? Store.__rawWrite
      : (typeof Store.__writeRaw === 'function') ? Store.__writeRaw
      : null;
    if (!rawWrite) return;
    rawWrite(key, value, { fromRealtime: true });

    // Special: user management realtime events
    try{
      if(String(key||'') === 'mums_user_events' && window.dispatchEvent){
        const ev = (value && typeof value === 'object') ? value : null;
        if(ev && ev.type === 'user_created'){
          window.dispatchEvent(new CustomEvent('mums:store', { detail: { key: 'mums_user_list_updated', event: ev } }));
        }
      }
    }catch(_){ }
  }

  // ----------------------
  // Local relay (dev only)
  // ----------------------
  function connectRelay(){
    try {
      const env = (window.EnvRuntime && EnvRuntime.env && EnvRuntime.env()) || (window.MUMS_ENV || {});
      const relayUrl = (env.REALTIME_RELAY_URL || '').trim() || DEFAULT_RELAY_URL;
      if (!isLocalHost) return; // only for dev

      ws = new WebSocket(relayUrl);
      ws.addEventListener('open', ()=>{ wsOk = true; });
      ws.addEventListener('close', ()=>{ wsOk = false; });
      ws.addEventListener('error', ()=>{ wsOk = false; });
      ws.addEventListener('message', (ev)=>{
        try{
          const msg = JSON.parse(ev.data || '{}');
          if (!msg || msg.type !== 'set' || !shouldSyncKey(msg.key)) return;
          applyRemoteKey(msg.key, msg.value);
        }catch(_){ }
      });
    } catch (_) {}
  }

  function relaySend(key, value){
    try {
      if (!wsOk || !ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type:'set', key, value }));
    } catch (_) {}
  }

  // ----------------------
  // Cloud sync (Supabase)
  // ----------------------
  async function cloudFetch(url, opts){
    const headers = Object.assign({}, (opts && opts.headers) || {});
    const token = window.CloudAuth && CloudAuth.accessToken ? CloudAuth.accessToken() : '';
    if (token) headers['Authorization'] = 'Bearer ' + token;
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    const res = await fetch(url, Object.assign({}, opts || {}, { headers }));
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) {}
    return { ok: res.ok, status: res.status, json, text };
  }

  async function pullOnce(){
    try {
      const out = await cloudFetch(`/api/sync/pull?since=${encodeURIComponent(String(lastCloudTs))}&clientId=${encodeURIComponent(clientId)}`);
      if (!out.ok) {
        // Keep current status; surface detail.
        dispatchStatus(cloudMode, `Pull failed (${out.status})`);
        return;
      }
      const docs = (out.json && out.json.docs) ? out.json.docs : [];
      for (const d of docs) {
        if (!d || !d.key) continue;
        // Ignore our own echo if desired; Store.__writeRaw already suppresses republish.
        applyRemoteKey(d.key, d.value);
        if (d.updatedAt && d.updatedAt > lastCloudTs) lastCloudTs = d.updatedAt;
      }
      cloudOkAt = Date.now();
      if (cloudMode !== 'realtime') {
        dispatchStatus('polling', 'Polling sync active');
      }
      // Do not downgrade mode to polling; realtime remains mandatory.
    } catch (e) {
      dispatchStatus(cloudMode, `Pull error: ${String(e && e.message ? e.message : e)}`);
    }
  }

  function ensureOfflinePull(){
    try{
      if(offlinePullTimer) return;
      // FIX v3.9.25: Increased from 8s to 45s — 8s caused ERR_INSUFFICIENT_RESOURCES
      // when API was failing (each failed pull consumed a TCP connection slot).
      offlinePullTimer = setInterval(()=>{
        try{
          if (cloudMode === 'realtime') return;
          if (!(window.CloudAuth && CloudAuth.isEnabled && CloudAuth.isEnabled())) return;
          if (!(CloudAuth.accessToken && CloudAuth.accessToken())) return;
          pullOnce();
        }catch(_){ }
      }, 45000);
    }catch(_){ }
  }

  function stopCloud(){
    try {
      if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; }
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (reconcileTimer) { clearInterval(reconcileTimer); reconcileTimer = null; }
      if (offlinePullTimer) { clearInterval(offlinePullTimer); offlinePullTimer = null; }
    } catch (_) {}
    try { if (sbChannel && sbChannel.unsubscribe) sbChannel.unsubscribe(); } catch (_) {}
    try {
      if (window.__MUMS_SB_CLIENT && typeof window.__MUMS_SB_CLIENT.removeAllChannels === 'function') {
        window.__MUMS_SB_CLIENT.removeAllChannels();
      }
    } catch (_) {}
    try {
      if (forceClientRecreate && window.__MUMS_SB_CLIENT) {
        window.__MUMS_SB_CLIENT = null;
      }
    } catch (_) {}
    sbChannel = null;
    sbClient = null;
  }

  function scheduleReconnect(reason){
    try {
      if (userExplicitlyLoggedOut) {
        console.log('[Realtime Guard] Reconnect skipped: explicit logout');
        return;
      }
      // If WebSocket transport failed before SUBSCRIBED, rebuild Supabase client
      // on next attempt to avoid reusing a poisoned realtime socket state.
      const rs = String(reason || '').toLowerCase();
      if (rs === 'closed' || rs === 'channel_error' || rs === 'timed_out' || rs === 'not-subscribed') {
        forceClientRecreate = true;
      }
      if (reconnectTimer) return;
      const delay = Math.min(12000, reconnectBackoffMs);
      reconnectBackoffMs = Math.min(12000, Math.round(reconnectBackoffMs * 1.6));
      console.log('[Realtime Guard] Reconnect scheduled', { reason: reason || '', delay });
      dispatchStatus('connecting', `Reconnecting… ${reason ? '('+reason+')' : ''}`);
      reconnectTimer = setTimeout(async ()=>{
  try{ if(window.EnvRuntime && typeof EnvRuntime.ready==='function'){ await Promise.race([EnvRuntime.ready(), new Promise(res=>setTimeout(res, 2500))]); } }catch(e){ (window.MUMS_DEBUG||{}).warn && MUMS_DEBUG.warn('realtime.env_wait_failed',{e:String(e)}); }

        reconnectTimer = null;
        connectCloudMandatory();
      }, delay);
    } catch (_) {}
  }

  function trySupabaseRealtimeMandatory(){
    try {
      const env = (window.EnvRuntime && EnvRuntime.env && EnvRuntime.env()) || (window.MUMS_ENV || {});
      const enabled = String(env.SYNC_ENABLE_SUPABASE_REALTIME || 'true').toLowerCase() !== 'false';
      if (!enabled) return false;
      if (!window.supabase || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return false;
      if (!(window.CloudAuth && CloudAuth.accessToken && CloudAuth.accessToken())) return false;

      const token = String(CloudAuth.accessToken() || '');
      if (!token) return false;
      lastAuthToken = token;
      // BUG FIX: was console.log — moved to debug-only to eliminate console spam
      try{ (window.MUMS_DEBUG||{}).log && MUMS_DEBUG.log('realtime.preparing_subscribe', { hasToken: !!token }); }catch(_){}
      if (forceClientRecreate && window.__MUMS_SB_CLIENT) {
        try { window.__MUMS_SB_CLIENT = null; } catch (_) {}
      }
      if (!window.__MUMS_SB_CLIENT) {
        window.__MUMS_SB_CLIENT = window.supabase.createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
          auth: { persistSession: false, autoRefreshToken: false, storage: SUPABASE_STORAGE },
          realtime: { params: { eventsPerSecond: 10 } },
          global: {
            headers: {
              // Critical: provide user JWT so Realtime respects RLS (authenticated role)
              Authorization: 'Bearer ' + token
            }
          }
        });
      }
      sbClient = window.__MUMS_SB_CLIENT;

      const seq = activeSeq;

      // Critical: authorize Realtime socket (Supabase Realtime v2)
      try { sbClient.realtime && sbClient.realtime.setAuth && sbClient.realtime.setAuth(token); } catch (_) {}

      // Subscribe to documents table changes (server writes). RLS allows authenticated select;
      // we still do a reconciliation pull after we are subscribed.
      sbChannel = sbClient.channel('mums-sync-docs')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'mums_documents' }, (payload) => {
          try {
            const row = payload && payload.new ? payload.new : null;
            if (!row || !row.key) return;
            if (row.updated_by_client_id && row.updated_by_client_id === clientId) return;
            applyRemoteKey(row.key, row.value);
            const ts = row.updated_at ? Date.parse(row.updated_at) : Date.now();
            if (ts > lastCloudTs) lastCloudTs = ts;
          } catch (_) {}
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mums_sync_log' }, (payload) => {
          try {
            const row = payload && payload.new ? payload.new : null;
            if (!row) return;
            if (row.client_id === clientId) return; // Prevent self-echo
            if(window.dispatchEvent){
              window.dispatchEvent(new CustomEvent('mums:realtime_alert', { detail: row }));
            }

            // Mailbox override events must propagate immediately across online users.
            // Trigger a forced cloud override sync as soon as the audit row arrives,
            // so pages reflect set/lift changes without requiring refresh.
            try{
              const action = String(row.action || '').toLowerCase();
              const scope = String(row.scope || '').toLowerCase();
              if(['set','reset','freeze'].includes(action) && ['global','superadmin'].includes(scope)){
                if(window.Store && typeof Store.startMailboxOverrideSync === 'function'){
                  Store.startMailboxOverrideSync({ force:true });
                }
              }
            }catch(_){ }
          } catch (_) {}
        })
        .subscribe((status) => {
          // Ignore status events from older channels after a reconnect.
          if (seq !== activeSeq) return;
          // Log non-SUBSCRIBED statuses at warn; SUBSCRIBED silently
      if (status !== 'SUBSCRIBED') { console.warn('[Realtime Guard] Channel status:', status); }
          if (status === 'SUBSCRIBED') {
            forceClientRecreate = false;
            cloudOkAt = Date.now();
            reconnectBackoffMs = 1200;
            dispatchStatus('realtime', 'Supabase Realtime connected');
            try {
              window.dispatchEvent(new CustomEvent('mums:syncstatus', {
                detail: { mode: 'realtime', syncMode: 'realtime', detail: 'Supabase Realtime connected', lastOkAt: cloudOkAt }
              }));
            } catch(_) {}
            // Flush queued local changes before reconciling.
            try {
              flushQueue('subscribed').then(()=>{ try { pullOnce(); } catch(_) {} });
            } catch(_) {
              try { pullOnce(); } catch(_) {}
            }


            // Integrity reconciliation: keep status green, but periodically pull
            // PERF OPT: Reconcile interval increased from 15s → 45s.
            // Supabase Realtime is the primary real-time channel; this poll is only
            // a safety net for missed events. 45s is sufficient without hammering the API.
            try {
              const intervalMs = Math.max(15000, Number(env.SYNC_RECONCILE_MS || 45000));
              if (reconcileTimer) clearInterval(reconcileTimer);
              reconcileTimer = setInterval(()=>{
                if (cloudMode !== 'realtime') return;
                pullOnce();
              }, intervalMs);
            } catch (_) {}
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            try {
              window.dispatchEvent(new CustomEvent('mums:syncstatus', {
                detail: { mode: 'offline', syncMode: 'offline', error: status, detail: String(status || 'CHANNEL_ERROR') }
              }));
            } catch(_) {}
            // Treat transient channel errors as reconnecting (yellow), not offline (red), to avoid UI flicker.
            scheduleReconnect(status);
          } else if (status === 'CLOSED') {
            // BUG FIX 2026-04-16: Only treat CLOSED as an error when the sequence still
            // matches (i.e., this is NOT from our own stopCloud/unsubscribe during token
            // rotation or manual reconnect). Stale CLOSED events from old channels must
            // be silently ignored — previously they fired scheduleReconnect() causing the
            // "Connecting" loop even after a successful re-subscribe.
            if (seq === activeSeq) {
              try {
                window.dispatchEvent(new CustomEvent('mums:syncstatus', {
                  detail: { mode: 'offline', syncMode: 'offline', error: 'CLOSED', detail: 'CLOSED' }
                }));
              } catch(_) {}
              scheduleReconnect('closed');
            }
            // If seq !== activeSeq: this CLOSED came from our own unsubscribe — ignore silently.
          }
        });

      // Mandatory realtime: fail fast if we cannot subscribe within timeout.
      try {
        const timeoutMs = Math.max(2500, Number(env.SYNC_CONNECT_TIMEOUT_MS || 7000));
        if (connectTimer) clearTimeout(connectTimer);
        connectTimer = setTimeout(()=>{
          connectTimer = null;
          if (cloudMode !== 'realtime') {
            dispatchStatus('offline', 'Realtime required but not connected (check network / Realtime replication)');
            scheduleReconnect('not-subscribed');
          }
        }, timeoutMs);
      } catch (_) {}

      return true;
    } catch (_) {
      return false;
    }
  }

  function connectCloudMandatory(){
    try {
      if (userExplicitlyLoggedOut) {
        dispatchStatus('offline', 'Logged out');
        return;
      }
      // Invalidate any in-flight callbacks from a previous channel (unsubscribe emits CLOSED).
      activeSeq = ++connectSeq;

      stopCloud();

      if (!(window.CloudAuth && CloudAuth.isEnabled && CloudAuth.isEnabled())) {
        dispatchStatus('offline', 'Cloud auth disabled (SUPABASE_URL/ANON_KEY missing)');
        return;
      }

      if (!(CloudAuth.accessToken && CloudAuth.accessToken())) {
        // Debug-only: suppress noisy 'no token' log on cold boot
        try{ (window.MUMS_DEBUG||{}).log && MUMS_DEBUG.log('realtime.connect_skipped_no_token'); }catch(_){}
        dispatchStatus('offline', 'Not authenticated');
        return;
      }

      dispatchStatus('connecting', 'Connecting to Supabase Realtime…');

      // Attempt Supabase Realtime (mandatory).
      const ok = trySupabaseRealtimeMandatory();
      if (!ok) {
        console.warn('[Realtime Guard] subscribe init failed (env/auth missing)');
        dispatchStatus('offline', 'Realtime init failed (env/auth missing)');
        scheduleReconnect('init-failed');
      }
    } catch (e) {
      dispatchStatus('offline', String(e && e.message ? e.message : e));
    }
  }

  async function cloudPush(key, value, removedIds, op){
    try {
      if(!canPushKey(key)) return;
      const body = { key, value, removedIds: removedIds || [], op: op || 'set', clientId, ts: Date.now() };
      const out = await cloudFetch('/api/sync/push', {
        method: 'POST',
        body: JSON.stringify(body)
      });

      // RBAC mismatch hardening:
      // If the server forbids this key, permanently suppress further attempts
      // to prevent repeated 403 request storms and console spam.
      if (!out.ok && out.status === 403) {
        const code = String(out && out.json && out.json.code ? out.json.code : '').trim();
        if (code === 'forbidden_key' || code === 'forbidden_member_write' || !code) {
          try{ markForbiddenPushKey(key); }catch(_){ }
          dispatchStatus(cloudMode, `Push forbidden (${String(key||'')})`);
          return;
        }
      }

      if (!out.ok) {
        try { enqueue(key, value, removedIds, op, 'push_failed', 'http_' + String(out.status)); } catch(_){}
        // Do not change mode on push failures; surface detail only.
        dispatchStatus(cloudMode, `Push failed (${out.status})`);
      }
    } catch (e) {
      try { enqueue(key, value, removedIds, op, 'push_error', String(e && e.message ? e.message : e)); } catch(_){}
      dispatchStatus(cloudMode, `Push error: ${String(e && e.message ? e.message : e)}`);
    }
  }

  function diffArray(prevArr, nextArr){
    const prev = Array.isArray(prevArr) ? prevArr : [];
    const next = Array.isArray(nextArr) ? nextArr : [];
    const idOf = (it)=>{
      if (!it || typeof it !== 'object') return '';
      return String(it.id || it.caseNo || it.case_no || it.uuid || it.key || '');
    };
    const prevIds = new Set(prev.map(idOf).filter(Boolean));
    const nextIds = new Set(next.map(idOf).filter(Boolean));
    const removed = [];
    prevIds.forEach((id)=>{ if (!nextIds.has(id)) removed.push(id); });
    return removed;
  }

  function schedulePush(key, value){
    if (!shouldSyncKey(key)) return;

    // Relay (dev)
    relaySend(key, value);

    // Cloud
    if (!(window.CloudAuth && CloudAuth.isEnabled && CloudAuth.isEnabled())) return;
    if (!canPushKey(key)) return;

    // Debounce per key
    if (pushTimers.has(key)) clearTimeout(pushTimers.get(key));
    // FIX v3.9.25: Exponential backoff on push — prevents ERR_INSUFFICIENT_RESOURCES
    const _pushTries = (function(){ try{ const _q=loadQueue(); return _q && _q[key] ? Number((_q[key]||{}).tries||0) : 0; }catch(_r){ return 0; } })();
    const _pushDelay = Math.min(30000, 300 * Math.pow(2, Math.min(_pushTries, 6)));
    pushTimers.set(key, setTimeout(()=>{
      pushTimers.delete(key);
      const prev = lastLocalByKey.get(key);
      lastLocalByKey.set(key, value);

      let removedIds = [];
      let op = 'set';
      if (Array.isArray(value)) {
        removedIds = diffArray(prev, value);
        op = 'merge'; // safe for list keys
      } else if (typeof value === 'object') {
        op = 'merge';

        // CLEAR BUG FIX: Schedule block keys must use op='set' (replace) not 'merge'.
        // With op='merge', a server-side mergeObjects shallow-merges old user entries
        // back on top of cleared entries — causing deleted blocks to resurrect.
        // Setting op='set' makes the pushed value authoritative: the server stores it
        // exactly as-is without mixing in stale data from other clients.
        // _ts is embedded so the server can resolve multi-tab race conditions (last-write-wins).
        if (key === 'mums_schedule_blocks' || key === 'mums_schedule_snapshots' || key === 'ums_weekly_schedules') {
          op = 'set';
          // Stamp the push time so the server can reject older pushes from stale tabs.
          if (value && typeof value === 'object' && !Array.isArray(value)) {
            value = Object.assign({}, value, { _ts: Date.now() });
          }
        }

        // RESURRECTION FIX: For mums_mailbox_tables, compute which assignment IDs
        // were present in the previous push but are absent in the current push.
        // These are forwarded to push.js as removedIds so mergeMailboxAssignments
        // can exclude them from Supabase's existing doc — preventing the server's
        // additive merge from silently resurrecting deleted cases.
        if (key === 'mums_mailbox_tables' && prev && typeof prev === 'object') {
          try {
            const flatAssigns = (tables) => Object.values(tables || {}).reduce((acc, t) => {
              if (t && Array.isArray(t.assignments)) acc.push(...t.assignments);
              return acc;
            }, []);
            const assignRemoved = diffArray(flatAssigns(prev), flatAssigns(value));
            if (assignRemoved.length) removedIds = assignRemoved;
          } catch(_) {}
        }
      }

      // If realtime isn't healthy, queue the change and let reconnect/flush handle it.
      if (cloudMode !== 'realtime') {
        if (!canPushKey(key)) return;
        enqueue(key, value, removedIds, op, 'not_realtime', cloudMode);
        try { connectCloudMandatory(); } catch(_){}
        return;
      }
      cloudPush(key, value, removedIds, op);
    }, 300));
  }

  // Connect after DOM and env are ready
  async function hasSupabaseSession(){
    try {
      if (!(window.supabase && window.__MUMS_SB_CLIENT && window.__MUMS_SB_CLIENT.auth && typeof window.__MUMS_SB_CLIENT.auth.getSession === 'function')) return false;
      const out = await window.__MUMS_SB_CLIENT.auth.getSession();
      const session = out && out.data ? out.data.session : null;
      return !!(session && session.access_token);
    } catch (_) {
      return false;
    }
  }

  function waitForAuthStateSignal(maxMs){
    return new Promise((resolve)=>{
      let done = false;
      let timer = null;
      let unsub = null;
      function finish(v){
        if (done) return;
        done = true;
        try { if (timer) clearTimeout(timer); } catch(_) {}
        try { if (typeof unsub === 'function') unsub(); else if (unsub && typeof unsub.unsubscribe === 'function') unsub.unsubscribe(); } catch(_) {}
        resolve(!!v);
      }

      timer = setTimeout(()=>finish(false), Math.max(0, Number(maxMs || 0)));

      try {
        window.addEventListener('mums:session_hydrated', function onHydrated(){
          try { window.removeEventListener('mums:session_hydrated', onHydrated); } catch(_) {}
          finish(true);
        }, { once: true });
      } catch(_) {}

      try {
        const auth = window.__MUMS_SB_CLIENT && window.__MUMS_SB_CLIENT.auth;
        if (auth && typeof auth.onAuthStateChange === 'function') {
          const out = auth.onAuthStateChange((_event, session)=>{
            if (session && session.access_token) finish(true);
          });
          unsub = out && out.data ? out.data.subscription : null;
        }
      } catch(_) {}
    });
  }

  async function waitForRealtimeAuthReady(maxMs){
    const deadline = Date.now() + Math.max(0, Number(maxMs || 0));
    while (Date.now() < deadline) {
      if (userExplicitlyLoggedOut) return false;
      try {
        const tokenReady = !!(window.CloudAuth && CloudAuth.isEnabled && CloudAuth.isEnabled() && CloudAuth.accessToken && CloudAuth.accessToken());
        if (tokenReady) {
          const sbSession = await hasSupabaseSession();
          if (sbSession || !window.__MUMS_SB_CLIENT) {
            return true;
          }
        }
      } catch (_) {}
      await new Promise((res)=>setTimeout(res, 150));
    }

    // Last chance: wait for explicit auth-state/session signal.
    return waitForAuthStateSignal(1200);
  }

  async function boot(){
    if (bootStarted) return;
    bootStarted = true;
    try {
      connectRelay();

      // Mandatory realtime: wait briefly for session restore to avoid false offline / UI flicker.
      dispatchStatus('connecting', 'Waiting for session…');

      try {
        if (window.EnvRuntime && typeof EnvRuntime.ready === 'function') {
          await Promise.race([EnvRuntime.ready(), new Promise((res)=>setTimeout(res, 2000))]);
        }
      } catch (_) {}

      try {
        if (window.CloudAuth && typeof CloudAuth.refreshSession === 'function') {
          await CloudAuth.refreshSession();
        }
      } catch (_) {}

      const ready = await waitForRealtimeAuthReady(4200);
      console.log('[Realtime Guard] Auth readiness', { ready });

      // Connect once we have a token.
      if (ready && window.CloudAuth && CloudAuth.isEnabled && CloudAuth.isEnabled() && CloudAuth.accessToken && CloudAuth.accessToken()) {
        connectCloudMandatory();
      } else {
        dispatchStatus('offline', 'Login required');
      }
      ensureOfflinePull();


      // Reconnect on login/logout.
      window.addEventListener('mums:auth', (e)=>{
        // e.detail = { type: 'login'|'logout' }
        const t = (e && e.detail && e.detail.type) ? String(e.detail.type) : '';
        if (t === 'logout') {
          userExplicitlyLoggedOut = true;
          stopCloud();
          dispatchStatus('offline', 'Logged out');
          return;
        }
        userExplicitlyLoggedOut = false;
        connectCloudMandatory();
        ensureOfflinePull();
      });

      // BUG FIX 2026-04-16: Debounced token-rotation reconnect.
      //
      // ROOT CAUSE OF "Sync: Connecting" LOOP + CONSOLE SPAM:
      //   1. mums:authtoken fires (token refresh)
      //   2. → connectCloudMandatory() → stopCloud() → sbChannel.unsubscribe()
      //   3. → Supabase emits CLOSED status on the channel callback
      //   4. → scheduleReconnect('closed') → connectCloudMandatory() AGAIN
      //   5. → "[Realtime Guard] Preparing realtime subscribe" printed on every iteration
      //   6. → UI flickers orange "Connecting" after every 1-hour token refresh
      //
      // FIX: Two-layer guard:
      //   a) Debounce 400ms so rapid token events (e.g. loadSession + refreshSession firing
      //      in quick succession at boot) collapse into one reconnect.
      //   b) Skip reconnect entirely when SUBSCRIBED and token changed but channel is live —
      //      just call setAuth() to update the WS auth in-place (no channel tear-down).
      //   c) Only do a full reconnect when channel is NOT already subscribed.
      window.addEventListener('mums:authtoken', (e)=>{
        try {
          const t = (e && e.detail && e.detail.token) ? String(e.detail.token) : '';
          if (!t || t === lastAuthToken) return;
          userExplicitlyLoggedOut = false;
          lastAuthToken = t;

          // Debounce: cancel any pending reconnect and restart the timer.
          if (_authtokenDebounceTimer) { clearTimeout(_authtokenDebounceTimer); _authtokenDebounceTimer = null; }
          _authtokenDebounceTimer = setTimeout(()=>{
            _authtokenDebounceTimer = null;
            try {
              // PREFERRED PATH: if already SUBSCRIBED, just rotate the auth token
              // on the existing channel. No teardown → no CLOSED event → no reconnect loop.
              if (cloudMode === 'realtime' && sbClient && sbClient.realtime &&
                  typeof sbClient.realtime.setAuth === 'function') {
                sbClient.realtime.setAuth(lastAuthToken);
                ensureOfflinePull();
                return; // ✅ Token updated in-place — no reconnect needed
              }
              // FALLBACK: channel not live → do full reconnect (normal startup path).
              connectCloudMandatory();
              ensureOfflinePull();
            } catch (_) {}
          }, _AUTHTOKEN_DEBOUNCE_MS);
        } catch (_) {}
      });
      bootCompleted = true;
    } catch (_) {}
  }

  function initRealtimeSync(){
    if (bootCompleted || bootStarted) return;
    setTimeout(()=>{ try { boot(); } catch(_) {} }, 400);
  }

  // Delay boot to allow Store/Auth to initialize.
  initRealtimeSync();

  try {
    window.addEventListener('mums:session_hydrated', ()=>{ try{ initRealtimeSync(); }catch(_){} }, { once: true });
  } catch(_) {}

  window.Realtime = {
    onLocalWrite: schedulePush,
    clientId: ()=>clientId,
    syncKeys: ()=>SYNC_KEYS.slice(),
    queueStatus: ()=>{
      try {
        const q = getQueue();
        const keys = Object.keys(q||{});
        return keys.map(k=>({ key:k, tries:Number((q[k]||{}).tries||0), lastError:String((q[k]||{}).lastError||'') })).sort((a,b)=>a.key.localeCompare(b.key));
      } catch(_) { return []; }
    },
    flushQueue: (trigger)=>flushQueue(trigger||'manual'),
    forceReconnect: ()=>{ try{ userExplicitlyLoggedOut = false; connectCloudMandatory(); }catch(_){ } },
    init: ()=>{ try{ initRealtimeSync(); }catch(_){ } }
  };
})();
