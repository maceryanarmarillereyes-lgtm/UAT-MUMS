/* MUMS System Monitor v4.0 — Super Admin Only
   ─────────────────────────────────────────────
   Provides real-time visibility into:
   · All active timers and their polling intervals
   · Cloudflare Workers request counts (via /api/env metadata)
   · Supabase Realtime connection health
   · Sync queue depth and error breakdown
   · Per-endpoint request rate analysis
   · Free-tier usage thresholds with traffic-light status
   ─────────────────────────────────────────────
   Approved CLEARED by MACE — performance diagnostic tool.
   Does NOT modify any sync, auth, or store logic.
*/
(window.Pages = window.Pages || {}, window.Pages.system = function (root) {
  'use strict';

  // ── Guard: Super Admin only ──────────────────────────────────────────────
  const user = (window.Auth && Auth.getUser) ? (Auth.getUser() || {}) : {};
  if (user.role !== 'SUPER_ADMIN') {
    root.innerHTML = `
      <div style="padding:40px;text-align:center;color:var(--muted)">
        <div style="font-size:48px;margin-bottom:16px">🔒</div>
        <div style="font-size:18px;font-weight:700">Super Admin Access Required</div>
        <div style="margin-top:8px;font-size:14px">This page is restricted to Super Admin accounts.</div>
      </div>`;
    return;
  }

  // ── Cleanup registry ─────────────────────────────────────────────────────
  const _cleanups = [];
  function onCleanup(fn) { _cleanups.push(fn); }
  function destroy() { _cleanups.forEach(fn => { try { fn(); } catch (_) { } }); }
  if (root._sysCleanup) try { root._sysCleanup(); } catch (_) { }
  root._sysCleanup = destroy;

  // ── Free Tier Limits ─────────────────────────────────────────────────────
  const FREE_TIER = {
    CF_REQUESTS_DAY: 100000,
    CF_CPU_MS_DAY:   10000,
    SB_DB_SIZE_MB:   500,
    SB_EGRESS_GB:    2,
    SB_MAU:          50000,
    SB_REALTIME_CONN: 200,
    SB_STORAGE_GB:   1,
  };

  // ── Request tracking (in-page session counters) ──────────────────────────
  const _reqLog = [];
  const _MAX_LOG = 500;

  function _intercept() {
    if (window.__sysMonPatched) return;
    window.__sysMonPatched = true;
    const orig = window.fetch;
    window.fetch = function (url, opts) {
      const ts = Date.now();
      const u = String(url || '');
      const method = String((opts && opts.method) || 'GET').toUpperCase();
      const p = orig.apply(this, arguments);
      p.then(r => {
        _reqLog.push({ ts, url: u, method, status: r ? r.status : 0 });
        if (_reqLog.length > _MAX_LOG) _reqLog.shift();
      }).catch(() => {
        _reqLog.push({ ts, url: u, method, status: 0, error: true });
        if (_reqLog.length > _MAX_LOG) _reqLog.shift();
      });
      return p;
    };
    onCleanup(() => {
      window.fetch = orig;
      window.__sysMonPatched = false;
    });
  }
  _intercept();

  // ── Helpers ──────────────────────────────────────────────────────────────
  const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const fmt = n => Number(n || 0).toLocaleString();
  const fmtMs = ms => ms >= 60000 ? (ms/60000).toFixed(0)+'m' : (ms/1000).toFixed(0)+'s';
  const ago = ts => {
    const d = Date.now() - (ts || 0);
    if (!ts) return '—';
    if (d < 5000) return 'just now';
    if (d < 60000) return Math.round(d/1000)+'s ago';
    if (d < 3600000) return Math.round(d/60000)+'m ago';
    return Math.round(d/3600000)+'h ago';
  };
  const pct = (v, max) => Math.min(100, Math.round((v / max) * 100));
  const trafficLight = (val, warn, crit) => {
    if (val >= crit) return { color: '#ef4444', label: '🔴 CRITICAL' };
    if (val >= warn) return { color: '#f59e0b', label: '🟡 WARNING' };
    return { color: '#22c55e', label: '🟢 OK' };
  };

  // ── Timer Inventory ──────────────────────────────────────────────────────
  function getTimerInventory() {
    const env = (window.MUMS_ENV || {});
    return [
      {
        name: 'Mailbox Override Sync',
        file: 'store.js',
        interval: env.MAILBOX_OVERRIDE_POLL_MS || 120000,
        endpoint: '/api/mailbox_override/get',
        method: 'GET',
        note: 'Polls cloud for global mailbox time override. Idle auto-scales to 6× active.',
        critical: env.MAILBOX_OVERRIDE_POLL_MS < 30000,
      },
      {
        name: 'Presence Heartbeat',
        file: 'presence_client.js',
        interval: env.PRESENCE_POLL_MS || 120000,
        endpoint: '/api/presence/heartbeat',
        method: 'POST',
        note: 'Keeps user marked online in roster. TTL=' + ((env.PRESENCE_TTL_SECONDS || 600)) + 's.',
        critical: env.PRESENCE_POLL_MS < 60000,
      },
      {
        name: 'Presence Roster List',
        file: 'presence_client.js',
        interval: env.PRESENCE_LIST_POLL_MS || 300000,
        endpoint: '/api/presence/list',
        method: 'GET',
        note: 'Fetches who is online. Read-heavy — keep ≥90s.',
        critical: env.PRESENCE_LIST_POLL_MS < 60000,
      },
      {
        name: 'Presence Watchdog Backup',
        file: 'presence_watchdog.js',
        interval: 150000,
        endpoint: '/api/presence/heartbeat',
        method: 'POST',
        note: 'Backup HB fires only when primary misses a beat (tab sleep/network drop).',
        critical: false,
      },
      {
        name: 'Presence Store Update',
        file: 'store.js',
        interval: 120000,
        endpoint: '(local only)',
        method: '—',
        note: 'In-memory online map refresh. No network call.',
        critical: false,
      },
      {
        name: 'Realtime Reconcile',
        file: 'realtime.js',
        interval: env.SYNC_RECONCILE_MS || 180000,
        endpoint: '/api/sync/pull',
        method: 'GET',
        note: 'Safety net for missed WS events. Realtime channel is primary.',
        critical: env.SYNC_RECONCILE_MS < 30000,
      },
      {
        name: 'Offline Fallback Pull',
        file: 'realtime.js',
        interval: 45000,
        endpoint: '/api/sync/pull',
        method: 'GET',
        note: 'Active only when Realtime WS is OFFLINE. Dormant when green.',
        critical: false,
      },
      {
        name: 'QuickBase Notification Poll',
        file: 'app.js',
        interval: 300000,
        endpoint: '/api/quickbase/monitoring',
        method: 'GET',
        note: 'Auto-fetches QB data for notifications every 5 minutes.',
        critical: false,
      },
      {
        name: 'Announcement Rotation',
        file: 'app.js',
        interval: 8000,
        endpoint: '(DOM only)',
        method: '—',
        note: 'Visual carousel — no network call.',
        critical: false,
      },
      {
        name: 'Clock Display Update',
        file: 'app.js',
        interval: 1000,
        endpoint: '(DOM only)',
        method: '—',
        note: 'Local clock tick — no network call.',
        critical: false,
      },
    ];
  }

  // ── Request Rate Analysis (last 5 min window) ────────────────────────────
  function getRequestAnalysis() {
    const now = Date.now();
    const window5m = now - 5 * 60 * 1000;
    const window1h = now - 60 * 60 * 1000;
    const recent = _reqLog.filter(r => r.ts > window5m);
    const hourly = _reqLog.filter(r => r.ts > window1h);

    // Group by endpoint pattern
    const byEndpoint = {};
    hourly.forEach(r => {
      const base = r.url.replace(/\?.*$/, '').replace(/\/api\//, '/api/');
      byEndpoint[base] = (byEndpoint[base] || 0) + 1;
    });

    const sorted = Object.entries(byEndpoint)
      .map(([url, count]) => ({ url, count, perHour: count }))
      .sort((a, b) => b.count - a.count);

    const errors = recent.filter(r => r.error || r.status >= 400);
    const extrapolatedPerHour = Math.round((hourly.length / Math.max(1, (now - (hourly[0] && hourly[0].ts || now)) / 3600000)));

    return {
      last5m: recent.length,
      last1h: hourly.length,
      extrapolatedDay: extrapolatedPerHour * 24,
      errors: errors.length,
      byEndpoint: sorted.slice(0, 10),
      totalLogged: _reqLog.length,
    };
  }

  // ── Realtime Health ──────────────────────────────────────────────────────
  function getRealtimeHealth() {
    const rt = window.Realtime || {};
    const queue = (typeof rt.queueStatus === 'function') ? rt.queueStatus() : [];
    let syncMode = 'unknown';
    let lastOkAt = 0;
    try {
      // Read last known sync mode from custom event cache
      syncMode = window.__mumsSyncMode || 'unknown';
      lastOkAt = window.__mumsSyncOkAt || 0;
    } catch (_) { }

    const env = window.MUMS_ENV || {};
    const hasCreds = !!(env.SUPABASE_URL && env.SUPABASE_ANON_KEY);

    return {
      syncMode,
      lastOkAt,
      hasCreds,
      clientId: typeof rt.clientId === 'function' ? rt.clientId() : '—',
      queue,
      queueDepth: queue.length,
      queueErrors: queue.filter(q => q.tries > 0).length,
    };
  }

  // ── Supabase Diagnostics ─────────────────────────────────────────────────
  async function getSbDiagnostics() {
    try {
      const tok = (window.CloudAuth && CloudAuth.accessToken) ? CloudAuth.accessToken() : '';
      if (!tok) return { error: 'No auth token — log in first.' };
      const r = await fetch('/api/sync/pull?since=0&clientId=sysmon_diag', {
        headers: { Authorization: 'Bearer ' + tok }
      });
      const data = r.ok ? await r.json() : null;
      return {
        status: r.status,
        ok: r.ok,
        docCount: data && data.docs ? data.docs.length : 0,
        keys: data && data.docs ? data.docs.map(d => d.key) : [],
        rawStatus: r.status,
      };
    } catch (e) {
      return { error: String(e && e.message ? e.message : e) };
    }
  }

  // ── Track sync mode via event ────────────────────────────────────────────
  function _trackSyncMode() {
    const handler = e => {
      try {
        const d = e && e.detail;
        if (d) {
          window.__mumsSyncMode = d.mode || d.syncMode || 'unknown';
          if (d.lastOkAt) window.__mumsSyncOkAt = d.lastOkAt;
        }
      } catch (_) { }
    };
    window.addEventListener('mums:syncstatus', handler);
    onCleanup(() => window.removeEventListener('mums:syncstatus', handler));
  }
  _trackSyncMode();

  // ── Estimated req/day for free tier gauge ────────────────────────────────
  function calcEstimatedReqPerDay() {
    const env = window.MUMS_ENV || {};
    const USERS = 30;
    const HRS = 8;
    const SEC = 3600;

    const mbMs = env.MAILBOX_OVERRIDE_POLL_MS || 120000;
    const presMs = env.PRESENCE_POLL_MS || 120000;
    const listMs = env.PRESENCE_LIST_POLL_MS || 300000;
    const wdMs = 150000;
    const reconcMs = env.SYNC_RECONCILE_MS || 180000;

    const mbPerHr = Math.round(SEC / (mbMs / 1000));
    const presPerHr = Math.round(SEC / (presMs / 1000));
    const listPerHr = Math.round(SEC / (listMs / 1000));
    const wdPerHr = Math.round(SEC / (wdMs / 1000));
    const reconcPerHr = Math.round(SEC / (reconcMs / 1000));
    const qbPerHr = Math.round(SEC / 300);
    const authPerHr = 2;

    const perUserHr = mbPerHr + presPerHr + listPerHr + wdPerHr + reconcPerHr + qbPerHr + authPerHr;
    const totalPerDay = perUserHr * HRS * USERS;
    return {
      perUserHr,
      totalPerDay,
      breakdown: [
        { label: 'Mailbox Override', perHr: mbPerHr, interval: fmtMs(mbMs) },
        { label: 'Presence HB', perHr: presPerHr, interval: fmtMs(presMs) },
        { label: 'Presence Roster', perHr: listPerHr, interval: fmtMs(listMs) },
        { label: 'Watchdog Backup', perHr: wdPerHr, interval: fmtMs(wdMs) },
        { label: 'Realtime Reconcile', perHr: reconcPerHr, interval: fmtMs(reconcMs) },
        { label: 'QuickBase Poll', perHr: qbPerHr, interval: '5m' },
        { label: 'Auth/Token Refresh', perHr: authPerHr, interval: 'event' },
      ]
    };
  }

  // ── CSS ───────────────────────────────────────────────────────────────────
  const STYLE = `
  .sys-wrap { padding:20px; max-width:1100px; margin:0 auto; font-family:inherit; }
  .sys-header { display:flex; align-items:center; gap:12px; margin-bottom:24px; }
  .sys-header h1 { font-size:22px; font-weight:800; margin:0; }
  .sys-badge { font-size:10px; font-weight:700; padding:2px 8px; border-radius:99px;
    background:var(--accent,#6366f1); color:#fff; letter-spacing:.5px; }
  .sys-tabs { display:flex; gap:4px; flex-wrap:wrap; margin-bottom:20px;
    border-bottom:2px solid var(--border,#334155); padding-bottom:0; }
  .sys-tab { padding:8px 16px; border:none; background:none; color:var(--muted,#94a3b8);
    font-size:13px; font-weight:600; cursor:pointer; border-bottom:3px solid transparent;
    margin-bottom:-2px; border-radius:6px 6px 0 0; transition:all .15s; }
  .sys-tab:hover { color:var(--text,#f8fafc); background:var(--surface2,#1e293b); }
  .sys-tab.active { color:var(--accent,#6366f1); border-bottom-color:var(--accent,#6366f1);
    background:var(--surface2,#1e293b); }
  .sys-panel { display:none; }
  .sys-panel.active { display:block; }
  .sys-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:12px; margin-bottom:20px; }
  .sys-card { background:var(--surface,#0f172a); border:1px solid var(--border,#334155);
    border-radius:10px; padding:16px; }
  .sys-card-label { font-size:11px; font-weight:700; color:var(--muted,#94a3b8);
    text-transform:uppercase; letter-spacing:.5px; margin-bottom:6px; }
  .sys-card-val { font-size:26px; font-weight:800; color:var(--text,#f8fafc); line-height:1; }
  .sys-card-sub { font-size:12px; color:var(--muted,#94a3b8); margin-top:4px; }
  .sys-card.warn { border-color:#f59e0b; }
  .sys-card.crit { border-color:#ef4444; background:#1a0a0a; }
  .sys-card.ok   { border-color:#22c55e; }
  .sys-progress-wrap { margin:8px 0 2px; }
  .sys-progress { height:6px; border-radius:99px; background:var(--border,#334155); overflow:hidden; }
  .sys-progress-bar { height:100%; border-radius:99px; transition:width .5s; }
  .sys-table { width:100%; border-collapse:collapse; font-size:13px; }
  .sys-table th { text-align:left; padding:8px 10px; color:var(--muted,#94a3b8);
    font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.5px;
    border-bottom:1px solid var(--border,#334155); }
  .sys-table td { padding:8px 10px; border-bottom:1px solid var(--border,#1e293b);
    vertical-align:top; }
  .sys-table tr:last-child td { border-bottom:none; }
  .sys-table tr:hover td { background:var(--surface2,#1e293b); }
  .sys-pill { display:inline-block; padding:2px 8px; border-radius:99px; font-size:11px;
    font-weight:700; }
  .sys-pill.ok { background:#14532d; color:#4ade80; }
  .sys-pill.warn { background:#78350f; color:#fbbf24; }
  .sys-pill.crit { background:#450a0a; color:#f87171; }
  .sys-pill.info { background:#1e3a5f; color:#60a5fa; }
  .sys-btn { padding:7px 14px; border-radius:7px; border:none; font-size:12px;
    font-weight:700; cursor:pointer; background:var(--accent,#6366f1); color:#fff;
    transition:opacity .15s; }
  .sys-btn:hover { opacity:.85; }
  .sys-btn.ghost { background:var(--surface,#0f172a); border:1px solid var(--border,#334155);
    color:var(--text,#f8fafc); }
  .sys-section-title { font-size:14px; font-weight:800; color:var(--text,#f8fafc);
    margin:20px 0 10px; display:flex; align-items:center; gap:8px; }
  .sys-alert { padding:12px 16px; border-radius:8px; font-size:13px; margin-bottom:12px;
    display:flex; align-items:flex-start; gap:10px; }
  .sys-alert.crit { background:#450a0a; border:1px solid #ef4444; color:#fca5a5; }
  .sys-alert.warn { background:#451a03; border:1px solid #f59e0b; color:#fde68a; }
  .sys-alert.ok   { background:#052e16; border:1px solid #22c55e; color:#86efac; }
  .sys-alert.info { background:#0c1a2e; border:1px solid #3b82f6; color:#93c5fd; }
  .sys-mono { font-family: 'Courier New', monospace; font-size:12px; }
  .sys-refresh-row { display:flex; align-items:center; gap:10px; margin-bottom:16px; }
  .sys-refresh-ts { font-size:12px; color:var(--muted,#94a3b8); }
  .sys-tip { font-size:12px; color:var(--muted,#94a3b8); font-style:italic; }
  `;

  // ── Render shell ──────────────────────────────────────────────────────────
  root.innerHTML = `<style>${STYLE}</style>
  <div class="sys-wrap" id="sysWrap">
    <div class="sys-header">
      <div style="font-size:28px">⚙️</div>
      <h1>System Monitor</h1>
      <span class="sys-badge">SUPER ADMIN</span>
      <div style="flex:1"></div>
      <button class="sys-btn ghost" id="sysRefreshBtn">🔄 Refresh All</button>
    </div>

    <div class="sys-tabs" id="sysTabs">
      <button class="sys-tab active" data-tab="overview">📊 Overview</button>
      <button class="sys-tab" data-tab="timers">⏱️ Timers &amp; Polls</button>
      <button class="sys-tab" data-tab="requests">🔬 Request Log</button>
      <button class="sys-tab" data-tab="realtime">📡 Realtime</button>
      <button class="sys-tab" data-tab="supabase">🗄️ Supabase</button>
      <button class="sys-tab" data-tab="cloudflare">☁️ Cloudflare</button>
      <button class="sys-tab" data-tab="queue">🔁 Sync Queue</button>
    </div>

    <div id="sysTabPanels">
      <div class="sys-panel active" id="tab-overview"></div>
      <div class="sys-panel" id="tab-timers"></div>
      <div class="sys-panel" id="tab-requests"></div>
      <div class="sys-panel" id="tab-realtime"></div>
      <div class="sys-panel" id="tab-supabase"></div>
      <div class="sys-panel" id="tab-cloudflare"></div>
      <div class="sys-panel" id="tab-queue"></div>
    </div>
  </div>`;

  // ── Tab switching ─────────────────────────────────────────────────────────
  const TAB_FROM_ROUTE = {
    overview: 'overview',
    requests: 'requests',
    realtime: 'realtime',
    timers: 'timers',
    supabase: 'supabase',
    cloudflare: 'cloudflare',
    queue: 'queue'
  };
  function tabFromRoute(){
    try{
      const path = String(window.location.pathname || window.location.hash || '').toLowerCase();
      const cleaned = path.replace(/^#?\/?/, '').split('?')[0].split('#')[0];
      let seg = '';
      if(cleaned.startsWith('system/')){
        seg = cleaned.split('/')[1] || '';
      }else if(cleaned.startsWith('system_')){
        seg = cleaned.slice('system_'.length);
      }else if(cleaned === 'system'){
        seg = 'overview';
      }else{
        return 'overview';
      }
      return TAB_FROM_ROUTE[seg] || 'overview';
    }catch(_){ return 'overview'; }
  }

  let activeTab = tabFromRoute();
  function applyActiveTab(tab){
    const t = TAB_FROM_ROUTE[tab] || 'overview';
    root.querySelectorAll('.sys-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
    root.querySelectorAll('.sys-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + t));
    activeTab = t;
  }

  applyActiveTab(activeTab);
  root.querySelector('#sysTabs').addEventListener('click', e => {
    const btn = e.target.closest('.sys-tab');
    if (!btn) return;
    const tab = btn.dataset.tab;
    applyActiveTab(tab);
    renderActiveTab();
  });

  root.querySelector('#sysRefreshBtn').addEventListener('click', () => renderActiveTab(true));

  // ── Render: Overview ──────────────────────────────────────────────────────
  function renderOverview() {
    const est = calcEstimatedReqPerDay();
    const rt = getRealtimeHealth();
    const analysis = getRequestAnalysis();
    const env = window.MUMS_ENV || {};

    const cfTl = trafficLight(est.totalPerDay, FREE_TIER.CF_REQUESTS_DAY * 0.6, FREE_TIER.CF_REQUESTS_DAY * 0.85);
    const rtTl = rt.syncMode === 'realtime' ? { color:'#22c55e', label:'🟢 CONNECTED' }
               : rt.syncMode === 'connecting' ? { color:'#f59e0b', label:'🟡 CONNECTING' }
               : { color:'#ef4444', label:'🔴 OFFLINE' };

    const alerts = [];
    if (est.totalPerDay > FREE_TIER.CF_REQUESTS_DAY * 0.85)
      alerts.push({ level:'crit', msg:`Estimated ${fmt(est.totalPerDay)} req/day — CRITICAL: exceeds 85% of Cloudflare free tier limit (${fmt(FREE_TIER.CF_REQUESTS_DAY)}/day). Increase poll intervals immediately.` });
    else if (est.totalPerDay > FREE_TIER.CF_REQUESTS_DAY * 0.6)
      alerts.push({ level:'warn', msg:`Estimated ${fmt(est.totalPerDay)} req/day — WARNING: above 60% of Cloudflare free tier. Monitor closely.` });
    else
      alerts.push({ level:'ok', msg:`Estimated ${fmt(est.totalPerDay)} req/day — OK: within safe range for Cloudflare free tier.` });

    if (!env.MAILBOX_OVERRIDE_POLL_MS || env.MAILBOX_OVERRIDE_POLL_MS < 60000)
      alerts.push({ level:'crit', msg:`MAILBOX_OVERRIDE_POLL_MS = ${fmtMs(env.MAILBOX_OVERRIDE_POLL_MS||10000)} — too aggressive! Should be ≥120s. This alone causes 360+ req/hr.` });

    if (rt.syncMode !== 'realtime')
      alerts.push({ level:'warn', msg:`Supabase Realtime is ${rt.syncMode}. Offline fallback poll is now active (every 45s) — increases Supabase usage.` });

    if (rt.queueDepth > 0)
      alerts.push({ level:'warn', msg:`${rt.queueDepth} item(s) pending in sync queue. ${rt.queueErrors} with errors. Check Sync Queue tab.` });

    const p = pct(est.totalPerDay, FREE_TIER.CF_REQUESTS_DAY);
    const barColor = p >= 85 ? '#ef4444' : p >= 60 ? '#f59e0b' : '#22c55e';

    const panel = root.querySelector('#tab-overview');
    panel.innerHTML = `
      <div>
        ${alerts.map(a => `<div class="sys-alert ${a.level}"><span>${a.level==='crit'?'🚨':a.level==='warn'?'⚠️':'✅'}</span><span>${esc(a.msg)}</span></div>`).join('')}

        <div class="sys-section-title">📊 Free Tier Health — Cloudflare</div>
        <div class="sys-card" style="margin-bottom:16px">
          <div class="sys-card-label">Estimated Requests / Day (30 users × 8hr)</div>
          <div style="display:flex;align-items:baseline;gap:12px">
            <div class="sys-card-val" style="color:${cfTl.color}">${fmt(est.totalPerDay)}</div>
            <div style="font-size:14px;color:var(--muted)">/ ${fmt(FREE_TIER.CF_REQUESTS_DAY)} free</div>
            <div class="sys-pill ${p>=85?'crit':p>=60?'warn':'ok'}">${cfTl.label}</div>
          </div>
          <div class="sys-progress-wrap">
            <div class="sys-progress">
              <div class="sys-progress-bar" style="width:${p}%;background:${barColor}"></div>
            </div>
          </div>
          <div class="sys-card-sub">${p}% of free tier daily limit</div>
        </div>

        <div class="sys-grid">
          <div class="sys-card">
            <div class="sys-card-label">Req/User/Hour</div>
            <div class="sys-card-val">${fmt(est.perUserHr)}</div>
            <div class="sys-card-sub">From all active timers</div>
          </div>
          <div class="sys-card ${rt.syncMode==='realtime'?'ok':rt.syncMode==='connecting'?'warn':'crit'}">
            <div class="sys-card-label">Realtime Status</div>
            <div class="sys-card-val" style="font-size:18px;color:${rtTl.color}">${rtTl.label}</div>
            <div class="sys-card-sub">Last OK: ${ago(rt.lastOkAt)}</div>
          </div>
          <div class="sys-card">
            <div class="sys-card-label">Session Requests Logged</div>
            <div class="sys-card-val">${fmt(analysis.last1h)}</div>
            <div class="sys-card-sub">Last 1hr in this tab</div>
          </div>
          <div class="sys-card ${rt.queueDepth>0?'warn':'ok'}">
            <div class="sys-card-label">Sync Queue Depth</div>
            <div class="sys-card-val">${rt.queueDepth}</div>
            <div class="sys-card-sub">${rt.queueErrors} item(s) with errors</div>
          </div>
        </div>

        <div class="sys-section-title">⏱️ Request Breakdown (per user/hr)</div>
        <table class="sys-table">
          <thead><tr>
            <th>Source</th><th>Interval</th><th>Req/hr</th><th>Req/day (30 users)</th><th>Status</th>
          </tr></thead>
          <tbody>
            ${est.breakdown.map(b => {
              const reqDay = b.perHr * 8 * 30;
              const tl = trafficLight(b.perHr, 30, 60);
              return `<tr>
                <td><b>${esc(b.label)}</b></td>
                <td class="sys-mono">${esc(b.interval)}</td>
                <td class="sys-mono">${b.perHr}</td>
                <td class="sys-mono">${fmt(reqDay)}</td>
                <td><span class="sys-pill ${b.perHr>=60?'crit':b.perHr>=30?'warn':'ok'}">${tl.label}</span></td>
              </tr>`;
            }).join('')}
            <tr style="border-top:2px solid var(--border)">
              <td><b>TOTAL</b></td>
              <td>—</td>
              <td class="sys-mono"><b>${est.perUserHr}</b></td>
              <td class="sys-mono"><b>${fmt(est.totalPerDay)}</b></td>
              <td><span class="sys-pill ${cfTl.label.includes('CRIT')?'crit':cfTl.label.includes('WARN')?'warn':'ok'}">${cfTl.label}</span></td>
            </tr>
          </tbody>
        </table>
      </div>`;
  }

  // ── Render: Timers ────────────────────────────────────────────────────────
  function renderTimers() {
    const timers = getTimerInventory();
    const panel = root.querySelector('#tab-timers');

    panel.innerHTML = `
      <div class="sys-alert info">
        <span>ℹ️</span>
        <span>All intervals below are the <b>current live values</b> from <code>window.MUMS_ENV</code>.
        To change them, update <code>env_runtime.js</code> defaults or set variables in your Cloudflare Worker environment.
        Changes take effect on next page load.</span>
      </div>
      <table class="sys-table">
        <thead><tr>
          <th>Timer Name</th><th>File</th><th>Interval</th><th>Endpoint</th><th>Req/hr</th><th>Status</th><th>Notes</th>
        </tr></thead>
        <tbody>
          ${timers.map(t => {
            const perHr = t.endpoint.startsWith('(') ? 0 : Math.round(3600 / (t.interval / 1000));
            const level = t.critical ? 'crit' : perHr > 60 ? 'warn' : 'ok';
            return `<tr>
              <td><b>${esc(t.name)}</b></td>
              <td class="sys-mono" style="font-size:11px">${esc(t.file)}</td>
              <td class="sys-mono" style="color:${t.critical?'#ef4444':'inherit'}">${fmtMs(t.interval)}</td>
              <td class="sys-mono" style="font-size:11px;color:var(--muted)">${esc(t.endpoint)}</td>
              <td class="sys-mono">${t.endpoint.startsWith('(') ? '—' : perHr}</td>
              <td><span class="sys-pill ${level}">${t.critical?'🔴 HIGH':perHr>60?'🟡 MED':'🟢 OK'}</span></td>
              <td class="sys-tip">${esc(t.note)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      <div class="sys-section-title" style="margin-top:24px">🔧 Current MUMS_ENV Values</div>
      <table class="sys-table">
        <thead><tr><th>Key</th><th>Value</th><th>Recommendation</th></tr></thead>
        <tbody>
          ${Object.entries(window.MUMS_ENV || {}).map(([k,v]) => {
            let rec = '';
            if (k === 'MAILBOX_OVERRIDE_POLL_MS') rec = Number(v)<120000 ? '⚠️ Set ≥120000 (120s)' : '✅ OK';
            if (k === 'PRESENCE_POLL_MS') rec = Number(v)<90000 ? '⚠️ Set ≥90000 (90s)' : '✅ OK';
            if (k === 'PRESENCE_LIST_POLL_MS') rec = Number(v)<180000 ? '⚠️ Set ≥180000 (180s)' : '✅ OK';
            if (k === 'SYNC_RECONCILE_MS') rec = Number(v)<120000 ? '⚠️ Set ≥120000 (120s)' : '✅ OK';
            if (k === 'PRESENCE_TTL_SECONDS') rec = Number(v)<300 ? '⚠️ Set ≥600 (10 min)' : '✅ OK';
            return `<tr>
              <td class="sys-mono">${esc(k)}</td>
              <td class="sys-mono">${esc(String(v))}</td>
              <td style="font-size:12px">${rec}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  }

  // ── Render: Request Log ───────────────────────────────────────────────────
  function renderRequests() {
    const analysis = getRequestAnalysis();
    const panel = root.querySelector('#tab-requests');

    const recentItems = _reqLog.slice(-50).reverse();

    panel.innerHTML = `
      <div class="sys-grid" style="margin-bottom:16px">
        <div class="sys-card">
          <div class="sys-card-label">Requests (last 5m)</div>
          <div class="sys-card-val">${analysis.last5m}</div>
        </div>
        <div class="sys-card">
          <div class="sys-card-label">Requests (last 1hr)</div>
          <div class="sys-card-val">${analysis.last1h}</div>
        </div>
        <div class="sys-card ${analysis.errors>0?'warn':'ok'}">
          <div class="sys-card-label">Errors (last 5m)</div>
          <div class="sys-card-val" style="color:${analysis.errors>0?'#f59e0b':'#22c55e'}">${analysis.errors}</div>
        </div>
        <div class="sys-card">
          <div class="sys-card-label">Total Logged (session)</div>
          <div class="sys-card-val">${analysis.totalLogged}</div>
          <div class="sys-card-sub">Max ${_MAX_LOG} stored</div>
        </div>
      </div>

      <div class="sys-section-title">🔝 Top Endpoints (last 1hr)</div>
      <table class="sys-table">
        <thead><tr><th>Endpoint</th><th>Calls</th><th>Est/hr</th></tr></thead>
        <tbody>
          ${analysis.byEndpoint.length ? analysis.byEndpoint.map(e => `
            <tr>
              <td class="sys-mono" style="font-size:12px">${esc(e.url)}</td>
              <td class="sys-mono">${e.count}</td>
              <td class="sys-mono">${e.perHour}</td>
            </tr>`).join('') : '<tr><td colspan="3" style="color:var(--muted);text-align:center">No requests logged yet — interact with the app to populate this log.</td></tr>'}
        </tbody>
      </table>

      <div class="sys-section-title">📋 Recent Requests (last 50)</div>
      <table class="sys-table">
        <thead><tr><th>Time</th><th>Method</th><th>URL</th><th>Status</th></tr></thead>
        <tbody>
          ${recentItems.length ? recentItems.map(r => {
            const statusClass = r.error || r.status >= 500 ? 'crit' : r.status >= 400 ? 'warn' : r.status >= 200 ? 'ok' : 'info';
            return `<tr>
              <td class="sys-mono" style="font-size:11px;white-space:nowrap">${ago(r.ts)}</td>
              <td class="sys-mono"><span class="sys-pill info">${esc(r.method)}</span></td>
              <td class="sys-mono" style="font-size:11px;word-break:break-all">${esc(r.url.length > 80 ? r.url.slice(0, 80) + '…' : r.url)}</td>
              <td><span class="sys-pill ${statusClass}">${r.error ? 'ERR' : r.status}</span></td>
            </tr>`;
          }).join('') : '<tr><td colspan="4" style="color:var(--muted);text-align:center">No requests logged yet.</td></tr>'}
        </tbody>
      </table>`;
  }

  // ── Render: Realtime ──────────────────────────────────────────────────────
  function renderRealtime() {
    const rt = getRealtimeHealth();
    const env = window.MUMS_ENV || {};
    const panel = root.querySelector('#tab-realtime');

    const statusColor = rt.syncMode === 'realtime' ? '#22c55e'
      : rt.syncMode === 'connecting' ? '#f59e0b' : '#ef4444';
    const statusLabel = rt.syncMode === 'realtime' ? '🟢 CONNECTED'
      : rt.syncMode === 'connecting' ? '🟡 CONNECTING' : '🔴 OFFLINE';

    panel.innerHTML = `
      <div class="sys-grid">
        <div class="sys-card ${rt.syncMode==='realtime'?'ok':rt.syncMode==='connecting'?'warn':'crit'}">
          <div class="sys-card-label">WebSocket Status</div>
          <div class="sys-card-val" style="font-size:20px;color:${statusColor}">${statusLabel}</div>
          <div class="sys-card-sub">Last OK: ${ago(rt.lastOkAt)}</div>
        </div>
        <div class="sys-card ${rt.hasCreds?'ok':'crit'}">
          <div class="sys-card-label">Supabase Credentials</div>
          <div class="sys-card-val" style="font-size:18px;color:${rt.hasCreds?'#22c55e':'#ef4444'}">${rt.hasCreds?'✅ Present':'🔴 Missing'}</div>
          <div class="sys-card-sub">URL + ANON_KEY in env</div>
        </div>
        <div class="sys-card">
          <div class="sys-card-label">Client ID</div>
          <div class="sys-card-val" style="font-size:12px" class="sys-mono">${esc(rt.clientId)}</div>
        </div>
        <div class="sys-card ${rt.queueDepth>0?'warn':'ok'}">
          <div class="sys-card-label">Queue Depth</div>
          <div class="sys-card-val">${rt.queueDepth}</div>
          <div class="sys-card-sub">${rt.queueErrors} with errors</div>
        </div>
      </div>

      <div class="sys-section-title">🔧 Realtime Configuration</div>
      <table class="sys-table">
        <thead><tr><th>Setting</th><th>Value</th><th>Impact</th></tr></thead>
        <tbody>
          <tr><td>SYNC_ENABLE_SUPABASE_REALTIME</td><td class="sys-mono">${String(env.SYNC_ENABLE_SUPABASE_REALTIME)}</td><td>Must be <code>true</code> for WS sync</td></tr>
          <tr><td>SYNC_RECONCILE_MS</td><td class="sys-mono">${fmtMs(env.SYNC_RECONCILE_MS||180000)}</td><td>Safety-net pull interval while WS active</td></tr>
          <tr><td>SYNC_POLL_MS (offline fallback)</td><td class="sys-mono">${fmtMs(env.SYNC_POLL_MS||180000)}</td><td>Active only when WS is offline</td></tr>
          <tr><td>Offline pull timer</td><td class="sys-mono">45s</td><td>Dormant when realtime=green</td></tr>
          <tr><td>Reconnect backoff (max)</td><td class="sys-mono">12s</td><td>Exponential up to 12s delay</td></tr>
        </tbody>
      </table>

      <div class="sys-section-title" style="margin-top:20px">⚡ Actions</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="sys-btn" id="sysForceReconnect">🔄 Force Reconnect</button>
        <button class="sys-btn ghost" id="sysFlushQueue">📤 Flush Sync Queue</button>
      </div>
      <div id="sysRtActionResult" style="margin-top:10px;font-size:13px;color:var(--muted)"></div>`;

    root.querySelector('#sysForceReconnect').onclick = () => {
      try {
        if (window.Realtime && Realtime.forceReconnect) {
          Realtime.forceReconnect();
          root.querySelector('#sysRtActionResult').textContent = '✅ Reconnect triggered. Check status in ~5s.';
        } else {
          root.querySelector('#sysRtActionResult').textContent = '⚠️ Realtime.forceReconnect not available.';
        }
      } catch (e) {
        root.querySelector('#sysRtActionResult').textContent = '❌ Error: ' + e.message;
      }
    };
    root.querySelector('#sysFlushQueue').onclick = async () => {
      try {
        const el = root.querySelector('#sysRtActionResult');
        el.textContent = '⏳ Flushing queue…';
        if (window.Realtime && Realtime.flushQueue) {
          const r = await Realtime.flushQueue('manual_sysmon');
          el.textContent = `✅ Flush done — flushed: ${r.flushed}, remaining: ${r.remaining}`;
        } else {
          el.textContent = '⚠️ Realtime.flushQueue not available.';
        }
      } catch (e) {
        root.querySelector('#sysRtActionResult').textContent = '❌ Error: ' + e.message;
      }
    };
  }

  // ── Render: Supabase ──────────────────────────────────────────────────────
  async function renderSupabase() {
    const panel = root.querySelector('#tab-supabase');
    panel.innerHTML = `<div style="color:var(--muted);padding:20px">⏳ Running Supabase diagnostics…</div>`;
    const diag = await getSbDiagnostics();
    const env = window.MUMS_ENV || {};

    panel.innerHTML = `
      <div class="sys-alert info">
        <span>ℹ️</span>
        <span>These values are for the <b>Free (Nano) plan</b>. Supabase free tier: 500MB DB, 2GB egress/month, 200 realtime connections, 50k MAU.</span>
      </div>
      <div class="sys-grid">
        <div class="sys-card ${diag.error?'crit':diag.ok?'ok':'warn'}">
          <div class="sys-card-label">API Connectivity</div>
          <div class="sys-card-val" style="font-size:18px">${diag.error ? '🔴 Error' : diag.ok ? '🟢 OK' : '🟡 Partial'}</div>
          <div class="sys-card-sub">HTTP ${diag.rawStatus||'—'}</div>
        </div>
        <div class="sys-card">
          <div class="sys-card-label">Sync Documents</div>
          <div class="sys-card-val">${diag.error ? '—' : diag.docCount}</div>
          <div class="sys-card-sub">mums_documents rows</div>
        </div>
        <div class="sys-card">
          <div class="sys-card-label">DB Plan Limit</div>
          <div class="sys-card-val" style="font-size:18px">500 MB</div>
          <div class="sys-card-sub">Free tier (Nano)</div>
        </div>
        <div class="sys-card">
          <div class="sys-card-label">Egress Limit</div>
          <div class="sys-card-val" style="font-size:18px">2 GB/mo</div>
          <div class="sys-card-sub">Free tier egress</div>
        </div>
      </div>

      ${diag.error ? `<div class="sys-alert crit"><span>🚨</span><span>Diagnostic error: ${esc(diag.error)}</span></div>` : ''}
      ${diag.keys && diag.keys.length ? `
        <div class="sys-section-title">🗂️ Synced Document Keys (${diag.keys.length})</div>
        <table class="sys-table">
          <thead><tr><th>Key</th></tr></thead>
          <tbody>${diag.keys.map(k => `<tr><td class="sys-mono">${esc(k)}</td></tr>`).join('')}</tbody>
        </table>` : ''}

      <div class="sys-section-title" style="margin-top:20px">⚠️ Disk IO Budget Warning</div>
      <div class="sys-alert warn">
        <span>⚠️</span>
        <div>
          <b>Your Supabase project shows "Depleting Disk IO Budget"</b> — this is caused by too many
          small writes to <code>mums_documents</code> and <code>mums_sync_log</code>.
          <br><br>
          <b>Root cause:</b> <code>MAILBOX_OVERRIDE_POLL_MS=10s</code> triggered 360 read requests/hr
          per user, plus <code>ums_activity_logs</code> writes on every action.
          <br><br>
          <b>Fix applied:</b> Poll raised to 120s (12× reduction). Also ensure you run
          <code>FREE_TIER_APPLY_NOW.sql</code> in Supabase SQL Editor — it vacuums tables
          and adds missing indexes to reduce IO.
        </div>
      </div>

      <div class="sys-section-title">🔑 Supabase Config</div>
      <table class="sys-table">
        <thead><tr><th>Setting</th><th>Value</th></tr></thead>
        <tbody>
          <tr><td>SUPABASE_URL</td><td class="sys-mono">${env.SUPABASE_URL ? env.SUPABASE_URL.replace(/^https?:\/\//, '').slice(0,20)+'…' : '🔴 Not set'}</td></tr>
          <tr><td>SUPABASE_ANON_KEY</td><td class="sys-mono">${env.SUPABASE_ANON_KEY ? '✅ Set (' + env.SUPABASE_ANON_KEY.slice(0,12)+'…)' : '🔴 Not set'}</td></tr>
          <tr><td>Realtime eventsPerSecond</td><td class="sys-mono">10 (hard-coded)</td></tr>
          <tr><td>Auth persistSession</td><td class="sys-mono">false (saves IO)</td></tr>
          <tr><td>Auth autoRefreshToken</td><td class="sys-mono">false (saves IO)</td></tr>
        </tbody>
      </table>`;
  }

  // ── Render: Cloudflare ────────────────────────────────────────────────────
  function renderCloudflare() {
    const est = calcEstimatedReqPerDay();
    const panel = root.querySelector('#tab-cloudflare');
    const cfPct = pct(est.totalPerDay, FREE_TIER.CF_REQUESTS_DAY);
    const barColor = cfPct >= 85 ? '#ef4444' : cfPct >= 60 ? '#f59e0b' : '#22c55e';

    panel.innerHTML = `
      <div class="sys-alert info">
        <span>ℹ️</span>
        <span>Cloudflare Workers <b>Free Plan</b>: 100,000 requests/day, 10ms CPU/request.
        The values below are estimates based on current polling intervals.
        Live actual counts are only visible in the Cloudflare Dashboard.</span>
      </div>

      <div class="sys-section-title">📊 Estimated Usage vs Free Tier</div>
      <div class="sys-card" style="margin-bottom:16px">
        <div class="sys-card-label">Estimated Requests / Day</div>
        <div style="display:flex;align-items:baseline;gap:12px">
          <div class="sys-card-val" style="color:${barColor}">${fmt(est.totalPerDay)}</div>
          <div style="color:var(--muted)">/&nbsp;${fmt(FREE_TIER.CF_REQUESTS_DAY)}</div>
        </div>
        <div class="sys-progress-wrap">
          <div class="sys-progress">
            <div class="sys-progress-bar" style="width:${cfPct}%;background:${barColor}"></div>
          </div>
        </div>
        <div class="sys-card-sub">${cfPct}% of daily limit used (estimate)</div>
      </div>

      <div class="sys-grid">
        <div class="sys-card">
          <div class="sys-card-label">Free Limit</div>
          <div class="sys-card-val" style="font-size:18px">100K/day</div>
        </div>
        <div class="sys-card">
          <div class="sys-card-label">Per User / Hour</div>
          <div class="sys-card-val">${est.perUserHr}</div>
          <div class="sys-card-sub">At current intervals</div>
        </div>
        <div class="sys-card">
          <div class="sys-card-label">Break-even Users</div>
          <div class="sys-card-val">${Math.floor(FREE_TIER.CF_REQUESTS_DAY / (est.perUserHr * 8))}</div>
          <div class="sys-card-sub">At 8 hrs active/day</div>
        </div>
        <div class="sys-card">
          <div class="sys-card-label">CPU Limit</div>
          <div class="sys-card-val" style="font-size:18px">10ms/req</div>
          <div class="sys-card-sub">Free tier CPU cap</div>
        </div>
      </div>

      <div class="sys-section-title">💡 Optimization Tips</div>
      <div style="display:flex;flex-direction:column;gap:10px">
        ${[
          ['✅ Applied', 'MAILBOX_OVERRIDE_POLL_MS raised from 10s → 120s (12× reduction, saves ~300 req/hr/user)'],
          ['✅ Applied', 'PRESENCE_POLL_MS raised from 45s → 120s (saves ~55 req/hr/user)'],
          ['✅ Applied', 'PRESENCE_LIST_POLL_MS raised from 90s → 300s (saves ~30 req/hr/user)'],
          ['✅ Applied', 'Presence store update timer raised from 15s → 120s (local only, no network)'],
          ['✅ Applied', 'Watchdog backup poll raised from 45s → 150s'],
          ['✅ Applied', 'Realtime reconcile raised from 90s → 180s'],
          ['🔧 Optional', 'Set SYNC_ENABLE_SUPABASE_REALTIME=false during off-hours to stop WS connections'],
          ['🔧 Optional', 'Run FREE_TIER_APPLY_NOW.sql to VACUUM tables and add indexes (reduces Supabase IO)'],
          ['🔧 Optional', 'Add Cloudflare Cache rules to cache /api/sync/pull responses for 30s (check _routes.json)'],
          ['🔧 Optional', 'Use Supabase Connection Pooler (port 6543) instead of direct connections for Disk IO savings'],
        ].map(([tag, tip]) => `
          <div style="display:flex;gap:10px;align-items:flex-start">
            <span class="sys-pill ${tag.startsWith('✅')?'ok':'info'}" style="white-space:nowrap">${esc(tag)}</span>
            <span style="font-size:13px">${esc(tip)}</span>
          </div>`).join('')}
      </div>`;
  }

  // ── Render: Sync Queue ────────────────────────────────────────────────────
  function renderQueue() {
    const rt = getRealtimeHealth();
    const panel = root.querySelector('#tab-queue');

    panel.innerHTML = `
      <div class="sys-grid" style="margin-bottom:16px">
        <div class="sys-card ${rt.queueDepth>0?'warn':'ok'}">
          <div class="sys-card-label">Queue Depth</div>
          <div class="sys-card-val">${rt.queueDepth}</div>
        </div>
        <div class="sys-card ${rt.queueErrors>0?'crit':'ok'}">
          <div class="sys-card-label">Items with Errors</div>
          <div class="sys-card-val" style="color:${rt.queueErrors>0?'#ef4444':'#22c55e'}">${rt.queueErrors}</div>
        </div>
      </div>

      ${rt.queueDepth > 0 ? `
        <div class="sys-section-title">📦 Queued Items</div>
        <table class="sys-table">
          <thead><tr><th>Key</th><th>Attempts</th><th>Last Error</th></tr></thead>
          <tbody>
            ${rt.queue.map(q => `<tr>
              <td class="sys-mono">${esc(q.key)}</td>
              <td><span class="sys-pill ${q.tries>=5?'crit':q.tries>0?'warn':'ok'}">${q.tries}</span></td>
              <td class="sys-mono" style="font-size:11px;color:var(--muted)">${esc(q.lastError||'—')}</td>
            </tr>`).join('')}
          </tbody>
        </table>` : `
        <div class="sys-alert ok"><span>✅</span><span>Sync queue is empty — all writes have been flushed to Supabase.</span></div>`}

      <div class="sys-section-title">🔧 Queue Actions</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="sys-btn" id="sysQueueFlush">📤 Flush Queue Now</button>
        <button class="sys-btn ghost" id="sysQueueRefresh">🔄 Refresh</button>
      </div>
      <div id="sysQueueResult" style="margin-top:10px;font-size:13px;color:var(--muted)"></div>

      <div class="sys-section-title" style="margin-top:24px">ℹ️ Queue Behavior</div>
      <table class="sys-table">
        <thead><tr><th>Behavior</th><th>Detail</th></tr></thead>
        <tbody>
          <tr><td>Max retries</td><td>10 attempts, then item is dropped</td></tr>
          <tr><td>403 Forbidden</td><td>Key permanently suppressed (saved to localStorage for 12h)</td></tr>
          <tr><td>Flush trigger</td><td>On WS connect, on auth, on manual flush</td></tr>
          <tr><td>Offline behavior</td><td>All writes queued; flush on reconnect</td></tr>
          <tr><td>Per-key debounce</td><td>300ms (exponential backoff on errors)</td></tr>
        </tbody>
      </table>`;

    root.querySelector('#sysQueueFlush').onclick = async () => {
      const el = root.querySelector('#sysQueueResult');
      el.textContent = '⏳ Flushing…';
      try {
        if (window.Realtime && Realtime.flushQueue) {
          const r = await Realtime.flushQueue('sysmon_manual');
          el.textContent = `✅ Done — flushed: ${r.flushed}, remaining: ${r.remaining}`;
          renderQueue();
        } else {
          el.textContent = '⚠️ Realtime not available.';
        }
      } catch (e) { el.textContent = '❌ ' + e.message; }
    };
    root.querySelector('#sysQueueRefresh').onclick = () => renderQueue();
  }

  // ── Active tab render dispatcher ──────────────────────────────────────────
  function renderActiveTab(force) {
    switch (activeTab) {
      case 'overview':   renderOverview(); break;
      case 'timers':     renderTimers(); break;
      case 'requests':   renderRequests(); break;
      case 'realtime':   renderRealtime(); break;
      case 'supabase':   renderSupabase(); break;
      case 'cloudflare': renderCloudflare(); break;
      case 'queue':      renderQueue(); break;
    }
  }

  // ── Auto-refresh every 30s ────────────────────────────────────────────────
  renderOverview();
  const _autoRefresh = setInterval(() => { try { renderActiveTab(); } catch (_) { } }, 30000);
  onCleanup(() => clearInterval(_autoRefresh));
});
