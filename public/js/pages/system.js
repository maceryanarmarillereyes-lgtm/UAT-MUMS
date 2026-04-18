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
      // ── Support Studio Features ─────────────────────────────────────────
      {
        name: 'CTL Lab State Poll',
        file: 'features/ctl_booking.js',
        interval: 30000, // PERF FIX: Raised from 15s → 30s
        endpoint: '/api/studio/ctl_lab_state',
        method: 'GET',
        note: 'Polls shared booking/queue state while Support Studio is open. Raised from 15s to 30s to reduce free tier impact.',
        critical: false,
        warn: true,
      },
      {
        name: 'CTL Lab Config Poll',
        file: 'features/ctl_booking.js',
        interval: 30000,
        endpoint: '/api/studio/ctl_lab_config',
        method: 'GET',
        note: 'Refreshes controller list (items) from shared Supabase document. Only runs while Support Studio is open.',
        critical: false,
      },
      {
        name: 'ODP Poll Fallback',
        file: 'features/odp.js',
        interval: 15000,
        endpoint: '/api/studio/daily_passwords',
        method: 'GET',
        note: 'Active ONLY when ODP Supabase Realtime subscription fails. Normally dormant (RT handles updates).',
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
        { label: 'CTL Lab State (Studio)', perHr: 120, interval: '30s', note: 'FIXED: was 15s (240/hr) → now 30s (120/hr). Active per-tab when Support Studio open' },
        { label: 'CTL Lab Config (Studio)', perHr: 120, interval: '30s', note: 'Active per-tab when Support Studio open' },
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
      <button class="sys-btn ghost" id="sysExportBtn" style="margin-right:6px">📥 Export CSV</button>
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
      <button class="sys-tab" data-tab="studio">🎛️ Studio Features</button>
      <button class="sys-tab" data-tab="bugscanner" style="background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.3);color:#fca5a5;border-radius:6px;">🔍 Auto Bug Scan <span id="bugBadge" style="display:none;margin-left:4px;background:#ef4444;color:#fff;border-radius:4px;padding:1px 5px;font-size:10px;font-weight:900;"></span></button>
    </div>

    <div id="sysTabPanels">
      <div class="sys-panel active" id="tab-overview"></div>
      <div class="sys-panel" id="tab-timers"></div>
      <div class="sys-panel" id="tab-requests"></div>
      <div class="sys-panel" id="tab-realtime"></div>
      <div class="sys-panel" id="tab-supabase"></div>
      <div class="sys-panel" id="tab-cloudflare"></div>
      <div class="sys-panel" id="tab-queue"></div>
      <div class="sys-panel" id="tab-studio"></div>
      <div class="sys-panel" id="tab-bugscanner"></div>
    </div>
  </div>`;

  // ── Tab switching ─────────────────────────────────────────────────────────
  const TAB_FROM_ROUTE = {
    overview:   'overview',
    requests:   'requests',
    realtime:   'realtime',
    timers:     'timers',
    supabase:   'supabase',
    cloudflare: 'cloudflare',
    queue:      'queue',
    studio:     'studio',      // FIX: was missing — caused Studio Features tab to always show overview
    bugscanner: 'bugscanner'   // FIX: was missing — caused Auto Bug Scan tab to always show overview
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

  // ── Export CSV ────────────────────────────────────────────────────────────
  function exportCSV() {
    const rows = [];
    const now = new Date().toISOString();

    // Header
    rows.push(['MUMS System Monitor — CRITICAL & HIGH Export', '', '', '', '', '', '', '']);
    rows.push(['Generated', now, '', '', '', '', '', '']);
    rows.push(['', '', '', '', '', '', '', '']);
    rows.push(['Category', 'ID / Name', 'Severity', 'Current Value', 'Req/Hr', 'Req/Day (30 users)', 'Recommended Fix', 'File / Notes']);

    // ── Section 1: Timer / Poll Intervals ────────────────────────────────
    const timers = getTimerInventory();
    const env = window.MUMS_ENV || {};
    timers.forEach((t, i) => {
      const isNetworkCall = !t.endpoint.startsWith('(');
      const perHr = isNetworkCall ? Math.round(3600 / (t.interval / 1000)) : 0;
      const reqDay = perHr * 8 * 30;
      const isCrit = t.critical || (isNetworkCall && perHr >= 60);
      const isHigh = !isCrit && isNetworkCall && perHr >= 30;
      if (!isCrit && !isHigh) return;
      const sev = isCrit ? 'CRITICAL' : 'HIGH';
      const rec = t.critical
        ? `Raise interval to ≥120s (currently ${fmtMs(t.interval)})`
        : `Consider raising interval; current ${fmtMs(t.interval)} generates ${perHr} req/hr`;
      rows.push([
        'Timer / Poll',
        t.name,
        sev,
        fmtMs(t.interval),
        perHr > 0 ? perHr : '—',
        reqDay > 0 ? reqDay : '—',
        rec,
        t.file
      ]);
    });

    // ── Section 2: Free Tier Estimate ────────────────────────────────────
    const est = calcEstimatedReqPerDay();
    const cfPct = Math.min(100, Math.round((est.totalPerDay / 100000) * 100));
    if (cfPct >= 60) {
      rows.push([
        'Free Tier — Cloudflare',
        'Total Estimated Req/Day',
        cfPct >= 85 ? 'CRITICAL' : 'HIGH',
        `${fmt(est.totalPerDay)} / 100,000`,
        est.perUserHr,
        est.totalPerDay,
        'Reduce poll intervals. CTL Lab State poll (15s) alone adds 57,600 req/day.',
        'env_runtime.js / ctl_booking.js'
      ]);
    }
    est.breakdown.forEach(b => {
      const reqDay = b.perHr * 8 * 30;
      const isCrit = b.perHr >= 60;
      const isHigh = !isCrit && b.perHr >= 30;
      if (!isCrit && !isHigh) return;
      rows.push([
        'Free Tier — Breakdown',
        b.label,
        isCrit ? 'CRITICAL' : 'HIGH',
        b.interval,
        b.perHr,
        reqDay,
        `Reduce poll interval. Current rate: ${b.perHr} req/hr × 8hr × 30 users = ${fmt(reqDay)}/day`,
        b.note || 'env_runtime.js'
      ]);
    });

    // ── Section 3: Bug Scan Issues ───────────────────────────────────────
    const bugs = _bugResults || [];
    bugs.forEach(issue => {
      const sev = issue.severity === 'critical' ? 'CRITICAL' : issue.severity === 'warning' ? 'HIGH' : null;
      if (!sev) return;
      rows.push([
        `Bug Scan — ${issue.feature}`,
        `[${issue.id}] ${issue.title}`,
        sev,
        'Runtime State',
        '—',
        '—',
        issue.recommendation.replace(/\n/g, ' '),
        issue.file
      ]);
    });

    // ── Section 4: Realtime health ───────────────────────────────────────
    const rt = getRealtimeHealth();
    if (rt.syncMode !== 'realtime' && rt.syncMode !== 'unknown') {
      rows.push([
        'Realtime Sync',
        'WebSocket Status',
        'HIGH',
        rt.syncMode.toUpperCase(),
        '—',
        '—',
        'Offline fallback poll (45s) is now active. Verify Supabase credentials.',
        'realtime.js'
      ]);
    }
    if (rt.queueErrors > 0) {
      rows.push([
        'Sync Queue',
        'Items with Errors',
        'HIGH',
        `${rt.queueErrors} item(s)`,
        '—',
        '—',
        'Open Sync Queue tab → flush queue. Check for expired tokens or 403 errors.',
        'realtime.js'
      ]);
    }

    // Build CSV string
    const escape = v => {
      const s = String(v == null ? '' : v);
      return (s.includes(',') || s.includes('"') || s.includes('\n'))
        ? '"' + s.replace(/"/g, '""') + '"'
        : s;
    };
    const csv = rows.map(r => r.map(escape).join(',')).join('\r\n');

    // Download
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `MUMS_System_Issues_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Toast feedback
    try {
      if (window.UI && UI.toast) UI.toast('📥 CSV exported — check your Downloads folder.', 'success');
    } catch(_) {}
  }

  root.querySelector('#sysExportBtn').addEventListener('click', () => {
    try {
      // Make sure bug scan has run first
      if (!_bugResults) _runBugScan();
      exportCSV();
    } catch(e) {
      alert('Export failed: ' + e.message);
    }
  });

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



  // ══════════════════════════════════════════════════════════════════════════
  // 🎛️  SUPPORT STUDIO FEATURES MONITOR
  // ══════════════════════════════════════════════════════════════════════════
  function renderStudio() {
    const panel = root.querySelector('#tab-studio');
    if (!panel) return;

    // ── Probe live state from window globals ───────────────────────────────
    const env = window.MUMS_ENV || {};

    // CTL Booking
    const ctlState = window._ctlS || null;
    const ctlItems = (() => { try { const r = localStorage.getItem('mums_controller_lab_items_v1'); return JSON.parse(r || '[]'); } catch (_) { return []; } })();
    const ctlBookings = ctlState ? ctlState.bookings || {} : {};
    const ctlQueues   = ctlState ? ctlState.queues   || {} : {};
    const ctlPollMs   = 30000; // hardcoded in ctl_booking.js
    const ctlActiveBookings = Object.values(ctlBookings).filter(b => b && b.endMs > Date.now()).length;
    const ctlTotalQueued = Object.values(ctlQueues).reduce((s, q) => s + (Array.isArray(q) ? q.length : 0), 0);

    // ODP (One Day Password)
    const odpState = window._odpState || null;
    const odpRt = odpState && odpState.rtChannel ? 'SUBSCRIBED' : (odpState && odpState.pollInterval ? 'POLL FALLBACK' : 'UNKNOWN');
    const odpSdkLoaded = !!(window.supabase && typeof window.supabase.createClient === 'function');

    // OnCall Tech
    const onCallLoaded = typeof window._ocsLoadSettings === 'function';
    const onCallHomeCard = !!document.getElementById('hp-oncall-home-card');

    // Knowledge Base
    const kbLoaded = typeof window._kbLoadSettings === 'function';
    const kbSyncEl = document.getElementById('kb-last-sync');
    const kbLastSync = kbSyncEl ? kbSyncEl.textContent : 'Unknown';

    // Supabase client health
    const sbClient = window.__MUMS_SB_CLIENT;
    const sbOk = !!(sbClient && sbClient.auth);

    // Cache system
    const cacheLoaded = typeof window._cacheUI !== 'undefined';

    // Home apps (controller lab host)
    const isSupportStudioRuntime = (() => {
      try {
        if (window.location && /support_studio\.html$/i.test(String(window.location.pathname || ''))) return true;
        return !!(
          document.getElementById('supportStudioRoot') ||
          document.getElementById('hp-ctl-list') ||
          document.querySelector('[data-page="quickbase_s"]')
        );
      } catch (_) {
        return false;
      }
    })();
    const homeAppsLoaded = typeof window._ctlOpenBooking === 'function';

    // Support Records / KB Feature
    const srLoaded = !!document.getElementById('left-panel-support_records');

    // ODP last fetch
    const odpLastFetch = odpState && odpState.homeData ? 'Loaded' : 'Not loaded';

    // Alarm audio
    const alarmPlaying = ctlState && ctlState.alarmPlaying ? '🔊 PLAYING' : '🔇 Silent';

    function featureRow(icon, name, status, detail, severity) {
      const colors = { ok: '#22c55e', warn: '#f59e0b', crit: '#ef4444', info: '#3b82f6' };
      const bg = { ok: 'rgba(34,197,94,.08)', warn: 'rgba(245,158,11,.08)', crit: 'rgba(239,68,68,.08)', info: 'rgba(59,130,246,.08)' };
      const border = { ok: 'rgba(34,197,94,.2)', warn: 'rgba(245,158,11,.2)', crit: 'rgba(239,68,68,.2)', info: 'rgba(59,130,246,.2)' };
      const pill = { ok: '✅ OK', warn: '⚠️ WARNING', crit: '🔴 CRITICAL', info: 'ℹ️ INFO' };
      return `<tr style="border-bottom:1px solid rgba(255,255,255,.04);">
        <td style="padding:10px 8px;font-size:13px;">${icon}</td>
        <td style="padding:10px 8px;font-weight:700;color:#f1f5f9;font-size:12px;">${esc(name)}</td>
        <td style="padding:10px 8px;">
          <span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:6px;font-size:11px;font-weight:700;background:${bg[severity]};border:1px solid ${border[severity]};color:${colors[severity]};">
            ${pill[severity]}
          </span>
        </td>
        <td style="padding:10px 8px;font-size:11px;color:#94a3b8;">${esc(status)}</td>
        <td style="padding:10px 8px;font-size:11px;color:#6b7280;max-width:300px;">${esc(detail)}</td>
      </tr>`;
    }

    // Derive severity
    const odpSev = odpRt === 'SUBSCRIBED' ? 'ok' : odpRt === 'POLL FALLBACK' ? 'warn' : 'crit';
    const ctlSev = homeAppsLoaded ? 'ok' : (isSupportStudioRuntime ? 'crit' : 'info');
    const kbSev  = kbLoaded ? 'ok' : (isSupportStudioRuntime ? 'warn' : 'info');
    const onCallSev = onCallLoaded ? 'ok' : 'warn';
    const sbSev  = sbOk ? 'ok' : 'crit';
    const cacheSev = cacheLoaded ? 'ok' : 'warn';

    // CTL poll rate - 15s is aggressive for free tier
    const ctlPollSev = ctlPollMs < 20000 ? 'warn' : 'ok';

    panel.innerHTML = `
      <div>
        <div class="sys-refresh-row">
          <div class="sys-section-title" style="margin:0;">🎛️ Support Studio Feature Health</div>
          <button class="sys-btn ghost" onclick="window.Pages && Pages.system && Pages.system._renderStudio && Pages.system._renderStudio()">🔄 Refresh</button>
          <span class="sys-refresh-ts">Live runtime probe — ${new Date().toLocaleTimeString()}</span>
        </div>

        <!-- Summary cards -->
        <div class="sys-grid" style="margin-bottom:20px;">
          <div class="sys-card">
            <div class="sys-card-label">Controllers Configured</div>
            <div class="sys-card-val">${ctlItems.length}</div>
            <div class="sys-card-sub">${ctlActiveBookings} active booking(s)</div>
          </div>
          <div class="sys-card ${ctlTotalQueued > 0 ? 'warn' : 'ok'}">
            <div class="sys-card-label">Queue Depth</div>
            <div class="sys-card-val">${ctlTotalQueued}</div>
            <div class="sys-card-sub">Users waiting across all controllers</div>
          </div>
          <div class="sys-card ${odpSev}">
            <div class="sys-card-label">ODP Realtime</div>
            <div class="sys-card-val" style="font-size:16px;">${odpRt}</div>
            <div class="sys-card-sub">daily_passwords subscription</div>
          </div>
          <div class="sys-card ${sbSev}">
            <div class="sys-card-label">Supabase Client</div>
            <div class="sys-card-val" style="font-size:16px;">${sbOk ? '✅ READY' : '❌ MISSING'}</div>
            <div class="sys-card-sub">__MUMS_SB_CLIENT</div>
          </div>
        </div>

        <!-- Feature table -->
        <div class="sys-section-title">Feature Module Status</div>
        <table class="sys-table" style="width:100%;">
          <thead>
            <tr>
              <th style="width:30px;"></th>
              <th>Feature</th>
              <th style="width:130px;">Status</th>
              <th style="width:180px;">State</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            ${featureRow('🎮', 'CTL Lab Booking System', homeAppsLoaded ? 'Module loaded' : (isSupportStudioRuntime ? 'NOT LOADED' : 'Not active on this page'), ctlItems.length + ' controllers · ' + ctlActiveBookings + ' active session(s) · ' + ctlTotalQueued + ' queued', ctlSev)}
            ${featureRow('🔒', 'CTL State Server Sync', 'Poll every ' + fmtMs(ctlPollMs), 'Hits /api/studio/ctl_lab_state every ' + fmtMs(ctlPollMs) + ' per open Support Studio tab', ctlPollSev)}
            ${featureRow('🔔', 'CTL Alarm Audio', alarmPlaying, ctlState ? 'alarmPlaying=' + String(ctlState.alarmPlaying) : 'State not available', 'info')}
            ${featureRow('🗓️', 'One Day Password (ODP)', odpRt, 'SDK: ' + (odpSdkLoaded ? 'Loaded' : 'NOT LOADED') + ' · Data: ' + odpLastFetch, odpSev)}
            ${featureRow('📡', 'ODP Realtime Channel', odpState && odpState.rtChannel ? 'Channel active' : 'No channel', odpState && odpState.pollInterval ? 'Using POLL fallback (15s) — check Supabase Realtime' : 'Using WebSocket (efficient)', odpSev)}
            ${featureRow('👨‍💻', 'On-Call Tech Module', onCallLoaded ? 'Loaded' : 'Not yet loaded', onCallHomeCard ? 'Home card rendered' : 'Home card not rendered', onCallSev)}
            ${featureRow('📚', 'Knowledge Base Sync', kbLoaded ? 'Module loaded' : (isSupportStudioRuntime ? 'Not yet loaded' : 'Not active on this page'), kbLastSync, kbSev)}
            ${featureRow('🗄️', 'Cache Manager', cacheLoaded ? 'Initialized' : 'Not loaded', 'Studio-side IndexedDB cache layer', cacheSev)}
            ${featureRow('🗄️', 'Supabase Client (MUMS)', sbOk ? 'Ready' : 'Not initialized', sbClient ? 'Auth: ' + (sbClient.auth ? 'OK' : 'MISSING') : '__MUMS_SB_CLIENT not found', sbSev)}
            ${featureRow('📋', 'Support Records', srLoaded ? 'Panel present' : 'Panel missing', 'Left sidebar panel for case knowledge base', srLoaded ? 'ok' : 'warn')}
          </tbody>
        </table>

        <!-- CTL Booking Detail -->
        ${ctlItems.length > 0 ? `
        <div class="sys-section-title" style="margin-top:24px;">🎮 Controller Lab — Session Detail</div>
        <table class="sys-table" style="width:100%;">
          <thead><tr>
            <th>Controller</th><th>IP</th><th>Status</th><th>Booked By</th><th>Ends In</th><th>Queue</th>
          </tr></thead>
          <tbody>
            ${ctlItems.map(ctl => {
              const bk = ctlBookings[ctl.id];
              const q  = Array.isArray(ctlQueues[ctl.id]) ? ctlQueues[ctl.id] : [];
              const active = bk && bk.endMs > Date.now();
              const rem = active ? bk.endMs - Date.now() : 0;
              return `<tr>
                <td><b>${esc(ctl.type || '—')}</b></td>
                <td class="sys-mono">${esc(ctl.ip || '—')}</td>
                <td><span class="sys-pill ${esc(ctl.status === 'Offline' ? 'crit' : 'ok')}">${esc(ctl.status || 'Online')}</span></td>
                <td>${active ? esc(bk.user) : '<span style="color:#6b7280">—</span>'}</td>
                <td class="sys-mono">${active ? fmtMs(rem) : '<span style="color:#22c55e">Free</span>'}</td>
                <td>${q.length > 0 ? q.length + ' waiting' : '<span style="color:#6b7280">Empty</span>'}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>` : ''}

        <!-- Interval warnings -->
        <div class="sys-section-title" style="margin-top:24px;">⏱️ Studio Feature Poll Intervals</div>
        <table class="sys-table" style="width:100%;">
          <thead><tr><th>Source</th><th>Interval</th><th>Endpoint</th><th>Status</th></tr></thead>
          <tbody>
            <tr>
              <td><b>CTL Lab State Poll</b></td>
              <td class="sys-mono">30s</td>
              <td class="sys-mono">/api/studio/ctl_lab_state</td>
              <td><span class="sys-pill ok">✅ Optimized — 2 req/min per open tab</span></td>
            </tr>
            <tr>
              <td><b>CTL Config Poll</b></td>
              <td class="sys-mono">30s</td>
              <td class="sys-mono">/api/studio/ctl_lab_config</td>
              <td><span class="sys-pill ok">✅ Acceptable</span></td>
            </tr>
            <tr>
              <td><b>ODP Realtime (WebSocket)</b></td>
              <td class="sys-mono">Event-driven</td>
              <td class="sys-mono">supabase_realtime → daily_passwords</td>
              <td><span class="sys-pill ${odpSev}">${odpRt === 'SUBSCRIBED' ? '✅ Connected' : '⚠️ ' + odpRt}</span></td>
            </tr>
            <tr>
              <td><b>ODP Poll Fallback</b></td>
              <td class="sys-mono">15s</td>
              <td class="sys-mono">/api/studio/daily_passwords</td>
              <td><span class="sys-pill ${odpState && odpState.pollInterval ? 'warn' : 'ok'}">${odpState && odpState.pollInterval ? '⚠️ Active (RT failed)' : '✅ Dormant (RT connected)'}</span></td>
            </tr>
            <tr>
              <td><b>OnCall Tech</b></td>
              <td class="sys-mono">Event-driven</td>
              <td class="sys-mono">/api/studio/oncall_settings, /schedule</td>
              <td><span class="sys-pill ok">✅ On-demand only</span></td>
            </tr>
            <tr>
              <td><b>KB Sync</b></td>
              <td class="sys-mono">Manual only</td>
              <td class="sys-mono">/api/studio/kb_sync</td>
              <td><span class="sys-pill ok">✅ On-demand only</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
  }
  // expose for self-refresh button
  if (!window.Pages) window.Pages = {};
  if (!window.Pages.system) window.Pages.system = {};
  window.Pages.system._renderStudio = renderStudio;


  // ══════════════════════════════════════════════════════════════════════════
  // 🔍  AUTO BUG SCANNER
  // ══════════════════════════════════════════════════════════════════════════
  var _bugResults = null;
  var _bugScanTs  = 0;

  function _runBugScan() {
    const issues = [];
    const env = window.MUMS_ENV || {};
    const now = Date.now();

    function bug(id, severity, feature, title, description, recommendation, file) {
      issues.push({ id, severity, feature, title, description, recommendation, file: file || '—' });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GROUP 1: REALTIME & WEBSOCKET
    // ─────────────────────────────────────────────────────────────────────────
    const syncMode = window.__mumsSyncMode || 'unknown';
    if (syncMode === 'offline' || syncMode === 'unknown') {
      bug('RT-001', 'critical', 'Realtime Sync', 'WebSocket Realtime OFFLINE',
        'Supabase Realtime channel is not connected. Sync queue will accumulate and all collaborative features (schedules, mailbox, announcements) will stop updating in real-time for affected users.',
        'Check SUPABASE_URL, SUPABASE_ANON_KEY in env vars. Verify Supabase project is not paused (free tier pauses after 1 week of inactivity). Check network tab for WebSocket 4xx errors.',
        'realtime.js');
    }

    const rt = window.Realtime || {};
    const queueStatus = typeof rt.queueStatus === 'function' ? rt.queueStatus() : [];
    const critQueue = queueStatus.filter(i => i.tries >= 5);
    if (critQueue.length > 0) {
      bug('RT-002', 'critical', 'Sync Queue', 'Sync Queue Items Exceeding Retry Limit',
        critQueue.length + ' sync queue item(s) have failed 5+ times: ' + critQueue.map(i => i.key).join(', ') + '. Data pushed by this user is not reaching the server.',
        'Open Sync Queue tab → check error messages. Common causes: expired auth token, server returning 403 (RBAC), or network errors. Trigger a manual flush after refreshing the session.',
        'realtime.js');
    }

    const hasQueueItems = queueStatus.filter(i => i.tries > 0).length;
    if (hasQueueItems > 3 && syncMode !== 'offline') {
      bug('RT-003', 'warning', 'Sync Queue', 'Multiple Pending Sync Items During Active Realtime',
        hasQueueItems + ' item(s) pending in sync queue despite Realtime being connected. These should have been flushed on SUBSCRIBED event.',
        'Force flush via Sync Queue tab → Retry. If issue persists, check that the \'subscribed\' event handler in realtime.js is calling flushQueue() correctly.',
        'realtime.js');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GROUP 2: FREE TIER IO / POLLING RATES
    // ─────────────────────────────────────────────────────────────────────────
    const mailboxPollMs = env.MAILBOX_OVERRIDE_POLL_MS || 120000;
    if (mailboxPollMs < 60000) {
      bug('IO-001', 'critical', 'Free Tier IO', 'Mailbox Override Poll Too Aggressive',
        'MAILBOX_OVERRIDE_POLL_MS = ' + fmtMs(mailboxPollMs) + '. At this rate: ' + Math.round(3600000/mailboxPollMs) + ' req/hr × 30 users = ' + Math.round(3600000/mailboxPollMs*30*8).toLocaleString() + ' req/day — this alone can exhaust the Cloudflare free tier.',
        'Set MAILBOX_OVERRIDE_POLL_MS ≥ 120000 (120s) in Cloudflare Pages environment variables. The store.js idle-scaler will automatically slow it down further when no override is active.',
        'env vars / store.js');
    }

    const presencePollMs = env.PRESENCE_POLL_MS || 120000;
    if (presencePollMs < 45000) {
      bug('IO-002', 'critical', 'Free Tier IO', 'Presence Heartbeat Too Frequent',
        'PRESENCE_POLL_MS = ' + fmtMs(presencePollMs) + '. Heartbeats firing faster than 45s are unnecessary and burn free tier IO budget.',
        'Set PRESENCE_POLL_MS ≥ 45000 in env vars. Supabase free tier presence TTL should be ≥120s to prevent users flashing offline.',
        'env vars / presence_client.js');
    }

    const reconcileMs = env.SYNC_RECONCILE_MS || 180000;
    if (reconcileMs < 90000) {
      bug('IO-003', 'warning', 'Free Tier IO', 'Realtime Reconcile Interval Too Short',
        'SYNC_RECONCILE_MS = ' + fmtMs(reconcileMs) + '. This safety-net pull runs while Realtime WebSocket is already connected. Firing faster than 90s wastes DB reads unnecessarily.',
        'Set SYNC_RECONCILE_MS ≥ 90000 (90s). The WebSocket handles real-time events; this is only a missed-event safety net.',
        'env vars / realtime.js');
    }

    const isSupportStudioRuntime = (() => {
      try {
        if (window.location && /support_studio\.html$/i.test(String(window.location.pathname || ''))) return true;
        return !!(
          document.getElementById('supportStudioRoot') ||
          document.getElementById('hp-ctl-list') ||
          document.querySelector('[data-page="quickbase_s"]')
        );
      } catch (_) {
        return false;
      }
    })();

    // CTL poll is hardcoded 30s
    const ctlItems = (() => { try { return JSON.parse(localStorage.getItem('mums_controller_lab_items_v1') || '[]'); } catch (_) { return []; } })();
    // CTL polling is now 30s (optimized for free-tier usage), so we no longer raise
    // a warning by default. Keep this section as a placeholder for future thresholds.

    // ─────────────────────────────────────────────────────────────────────────
    // GROUP 3: SUPABASE CLIENT HEALTH
    // ─────────────────────────────────────────────────────────────────────────
    const sbClient = window.__MUMS_SB_CLIENT;
    if (!sbClient) {
      bug('SB-001', 'critical', 'Supabase', 'Supabase Client Not Initialized',
        '__MUMS_SB_CLIENT is null/undefined. This means auth session restore, realtime channels, and all server-side operations requiring user JWTs will fail silently.',
        'Check supabase_loader.js → ensure /api/vendor/supabase loads correctly (should be HTTP 200, not 404). Check browser network tab for the SDK script request. The vendor proxy route must be registered in [[path]].js.',
        'supabase_loader.js / functions/api/[[path]].js');
    }

    if (!env.SUPABASE_URL) {
      bug('SB-002', 'critical', 'Supabase', 'SUPABASE_URL Not Set',
        'SUPABASE_URL is missing from MUMS_ENV. All database operations, auth, realtime, and storage features will fail. This is typically a Cloudflare Pages environment variable misconfiguration.',
        'Go to Cloudflare Pages → Settings → Environment Variables → Add SUPABASE_URL = your project URL (e.g. https://xxxx.supabase.co).',
        'env vars');
    }

    if (!env.SUPABASE_ANON_KEY) {
      bug('SB-003', 'critical', 'Supabase', 'SUPABASE_ANON_KEY Not Set',
        'SUPABASE_ANON_KEY is missing. Anonymous/authenticated Supabase client calls will all return 401. Realtime websocket auth will fail.',
        'Go to Cloudflare Pages → Settings → Environment Variables → Add SUPABASE_ANON_KEY from your Supabase project settings → API.',
        'env vars');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GROUP 4: ODP (ONE DAY PASSWORD) REALTIME
    // ─────────────────────────────────────────────────────────────────────────
    const odpState = window._odpState || null;
    if (odpState) {
      if (odpState.pollInterval && !odpState.rtChannel) {
        bug('ODP-001', 'warning', 'ODP / One Day Password', 'ODP Falling Back to Polling (Realtime Failed)',
          'The ODP Supabase Realtime channel for daily_passwords failed to subscribe. A 15-second polling fallback is now active. Every user on Support Studio is making 4 extra API calls/min.',
          'Check if daily_passwords table is added to supabase_realtime publication. Run: SELECT * FROM pg_publication_tables WHERE pubname=\'supabase_realtime\'. Also verify the ODP dedicated sbClient calls setAuth(token) after createClient().',
          'features/odp.js');
      }

      if (!odpState.sbClient) {
        bug('ODP-002', 'warning', 'ODP / One Day Password', 'ODP Supabase Client Not Created',
          'ODP dedicated Supabase client (_odpState.sbClient) has not been instantiated. This means realtime subscription for daily_passwords was never attempted.',
          'Verify the Supabase SDK loaded successfully (check window.supabase). The mums:supabase_ready event must fire on window (not document) for ODP to initialize.',
          'features/odp.js:461');
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GROUP 5: CTL BOOKING LOGIC ISSUES
    // ─────────────────────────────────────────────────────────────────────────
    if (ctlItems.length > 0) {
      const stateCache = (() => { try { return JSON.parse(localStorage.getItem('mums_ctl_lab_state_v1') || '{}'); } catch (_) { return {}; } })();
      const bookings = stateCache.bookings || {};

      // Check for expired bookings still in state
      const expiredStuck = Object.entries(bookings).filter(([id, bk]) => bk && bk.endMs && bk.endMs < now && bk.endMs > now - 3600000);
      if (expiredStuck.length > 0) {
        bug('CTL-001', 'warning', 'CTL Lab', 'Expired Bookings Not Cleared from State Cache',
          expiredStuck.length + ' booking(s) expired within the last hour but remain in local state cache: ' + expiredStuck.map(([id]) => id.slice(0,8)).join(', ') + '. This can cause stale "In Use" status displays for other users.',
          'The timer expiry handler should call setBooking(id, null) and push to server. Check that the _syncTimers() function in ctl_booking.js is correctly deleting expired bookings from _stateCache.bookings and syncing to server.',
          'features/ctl_booking.js');
      }

      // Check queue sanity - duplicate users
      const queues = stateCache.queues || {};
      Object.entries(queues).forEach(([ctlId, q]) => {
        if (!Array.isArray(q)) return;
        const users = q.map(e => String(e.user || '').toLowerCase());
        const unique = new Set(users);
        if (unique.size < users.length) {
          bug('CTL-002', 'warning', 'CTL Lab', 'Duplicate User in Controller Queue',
            'Controller ' + ctlId.slice(0,8) + ' has duplicate user entries in its queue. This causes the affected user to receive multiple "It\'s Your Turn" alerts.',
            'Queue deduplication should run on every setQueue() call. Verify _deduplicateQueue() is called in ctl_booking.js. Also run server-side dedup in ctl_lab_state.js POST handler.',
            'features/ctl_booking.js / server/routes/studio/ctl_lab_state.js');
        }
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GROUP 6: AUTH & SESSION
    // ─────────────────────────────────────────────────────────────────────────
    const session = (() => { try { return JSON.parse(localStorage.getItem('mums_supabase_session') || 'null'); } catch (_) { return null; } })();
    if (!session) {
      bug('AUTH-001', 'critical', 'Authentication', 'No Session Found in Storage',
        'mums_supabase_session is missing from localStorage. All authenticated API calls will return 401. This user appears to be running without a valid session.',
        'Sign out and sign back in. If the issue persists after login, check CloudAuth.signIn() and verify the session is being persisted to localStorage by cloud_auth.js.',
        'cloud_auth.js');
    } else {
      const accessToken = session.access_token || (session.session && session.session.access_token);
      if (accessToken) {
        try {
          const parts = accessToken.split('.');
          const payload = JSON.parse(atob(parts[1].replace(/-/g,'+').replace(/_/g,'/')));
          const expiry = payload.exp * 1000;
          if (expiry < now) {
            bug('AUTH-002', 'critical', 'Authentication', 'Access Token Expired',
              'JWT access token expired ' + fmtMs(now - expiry) + ' ago. All server API calls requiring authentication are failing with 401.',
              'Trigger CloudAuth.refreshSession() from browser console, or sign out and sign back in. Check that the token refresh interval is running correctly in cloud_auth.js.',
              'cloud_auth.js');
          } else if (expiry - now < 600000) {
            bug('AUTH-003', 'warning', 'Authentication', 'Access Token Expiring Soon',
              'JWT access token expires in ' + fmtMs(expiry - now) + '. If the auto-refresh fails, users will experience sudden 401 errors across all features.',
              'The token should auto-refresh via CloudAuth. Verify the mums:authtoken event is firing and realtime.js is reconnecting on token rotation.',
              'cloud_auth.js');
          }
        } catch (_) {}
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GROUP 7: FEATURE MODULE LOADING
    // ─────────────────────────────────────────────────────────────────────────
    if (isSupportStudioRuntime && typeof window._sqbLoadSettings !== 'function') {
      bug('MOD-001', 'warning', 'Studio QB', 'Studio QuickBase Module Not Loaded',
        'window._sqbLoadSettings is not defined. The QuickBase_S settings panel may fail to populate when the user opens General Settings → Studio Quickbase Settings.',
        'Check that support_studio.html correctly includes the <script> for the quickbase_s feature. Verify there are no JS errors blocking module initialization.',
        'features/quickbase_s.js');
    }

    if (isSupportStudioRuntime && typeof window._kbLoadSettings !== 'function') {
      bug('MOD-002', 'warning', 'Knowledge Base', 'KB Settings Module Not Loaded',
        'window._kbLoadSettings is not defined. Clicking General Settings → Knowledge Base Sync will show an empty panel.',
        'Check knowledge_base.js is included in support_studio.html and that no JS errors are preventing module initialization.',
        'features/knowledge_base.js');
    }

    if (isSupportStudioRuntime && typeof window._ctlOpenBooking !== 'function') {
      bug('MOD-003', 'critical', 'CTL Lab', 'CTL Booking Module Not Loaded',
        'window._ctlOpenBooking is not defined. The Controller Testing Lab booking buttons will throw errors when clicked.',
        'Verify features/ctl_booking.js is included in support_studio.html. Check for JS parse errors in the file (missing brackets, syntax issues).',
        'features/ctl_booking.js');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GROUP 8: VENDOR SDK
    // ─────────────────────────────────────────────────────────────────────────
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      bug('SDK-001', 'critical', 'Supabase SDK', 'Supabase SDK Not Loaded',
        'window.supabase.createClient is not available. The ODP Realtime channel and any feature using supabase.createClient() will fail. This usually means /api/vendor/supabase returned 404.',
        'Check Network tab for GET /api/vendor/supabase. It must return HTTP 200 with JavaScript content. Verify the route alias "vendor/supabase" (without .js) is registered in functions/api/[[path]].js.',
        'supabase_loader.js / functions/api/[[path]].js');
    }

    _bugResults = issues;
    _bugScanTs = Date.now();

    // Update badge
    const critCount = issues.filter(i => i.severity === 'critical').length;
    const badge = root.querySelector('#bugBadge');
    if (badge) {
      if (critCount > 0) {
        badge.style.display = 'inline-block';
        badge.textContent = critCount + ' CRIT';
        badge.style.background = '#ef4444';
      } else {
        const warnCount = issues.filter(i => i.severity === 'warning').length;
        if (warnCount > 0) {
          badge.style.display = 'inline-block';
          badge.textContent = warnCount + ' WARN';
          badge.style.background = '#f59e0b';
        } else {
          badge.style.display = 'none';
        }
      }
    }

    return issues;
  }

  function renderBugScanner(forceRescan) {
    const panel = root.querySelector('#tab-bugscanner');
    if (!panel) return;

    // Show loading state if no scan yet
    if (!_bugResults || forceRescan) {
      panel.innerHTML = `<div style="padding:40px;text-align:center;">
        <div style="font-size:32px;margin-bottom:12px;">🔍</div>
        <div style="font-size:15px;font-weight:700;color:#f1f5f9;margin-bottom:6px;">Auto Bug Scanner</div>
        <div style="font-size:12px;color:#6b7280;margin-bottom:24px;">Scans runtime state, env vars, timers, and feature modules for known bug patterns.</div>
        <button class="sys-btn" onclick="window.__mums_runScan()">▶ Run Scan Now</button>
      </div>`;
      window.__mums_runScan = function() {
        const issues = _runBugScan();
        renderBugScanner(false);
      };
      return;
    }

    const issues = _bugResults;
    const crits   = issues.filter(i => i.severity === 'critical');
    const warns    = issues.filter(i => i.severity === 'warning');
    const infos    = issues.filter(i => i.severity === 'info');
    const totalScore = crits.length * 10 + warns.length * 3 + infos.length;

    const healthLabel = crits.length > 0 ? '🔴 CRITICAL' : warns.length > 0 ? '🟡 WARNING' : '🟢 ALL CLEAR';
    const healthColor = crits.length > 0 ? '#ef4444' : warns.length > 0 ? '#f59e0b' : '#22c55e';

    function issueCard(issue) {
      const colors = { critical: '#ef4444', warning: '#f59e0b', info: '#3b82f6' };
      const bg     = { critical: 'rgba(239,68,68,.06)', warning: 'rgba(245,158,11,.06)', info: 'rgba(59,130,246,.06)' };
      const border = { critical: 'rgba(239,68,68,.25)', warning: 'rgba(245,158,11,.2)', info: 'rgba(59,130,246,.2)' };
      const icon   = { critical: '🔴', warning: '🟡', info: 'ℹ️' };
      const label  = { critical: 'CRITICAL', warning: 'WARNING', info: 'INFO' };
      return `
        <div style="background:${bg[issue.severity]};border:1px solid ${border[issue.severity]};border-radius:12px;padding:16px 18px;margin-bottom:10px;">
          <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:10px;">
            <span style="font-size:18px;flex-shrink:0;">${icon[issue.severity]}</span>
            <div style="flex:1;">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
                <span style="font-size:9px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;padding:2px 7px;border-radius:4px;background:${colors[issue.severity]}22;border:1px solid ${colors[issue.severity]}44;color:${colors[issue.severity]};">${label[issue.severity]}</span>
                <span style="font-size:9px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;padding:2px 7px;border-radius:4px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:#94a3b8;">${esc(issue.feature)}</span>
                <span style="font-size:9px;font-family:monospace;color:#6b7280;">${esc(issue.id)}</span>
              </div>
              <div style="font-size:13px;font-weight:800;color:#f1f5f9;margin-bottom:6px;">${esc(issue.title)}</div>
              <div style="font-size:11px;color:#94a3b8;line-height:1.65;margin-bottom:10px;">${esc(issue.description)}</div>
              <div style="background:rgba(34,197,94,.06);border:1px solid rgba(34,197,94,.18);border-radius:8px;padding:10px 12px;">
                <div style="font-size:9px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#4ade80;margin-bottom:4px;">💡 FIX RECOMMENDATION</div>
                <div style="font-size:11px;color:#86efac;line-height:1.65;">${esc(issue.recommendation)}</div>
              </div>
            </div>
            <div style="font-size:9px;font-family:monospace;color:#374151;flex-shrink:0;text-align:right;line-height:1.8;">${esc(issue.file)}</div>
          </div>
        </div>`;
    }

    panel.innerHTML = `
      <div>
        <div class="sys-refresh-row">
          <div class="sys-section-title" style="margin:0;">🔍 Auto Bug Scanner</div>
          <button class="sys-btn" onclick="window.__mums_runScan()">🔄 Re-Scan</button>
          <span class="sys-refresh-ts">Last scan: ${new Date(_bugScanTs).toLocaleTimeString()}</span>
        </div>

        <!-- Summary -->
        <div class="sys-grid" style="margin-bottom:20px;">
          <div class="sys-card" style="border-color:${healthColor}33;">
            <div class="sys-card-label">System Health</div>
            <div class="sys-card-val" style="font-size:20px;color:${healthColor};">${healthLabel}</div>
            <div class="sys-card-sub">Based on ${issues.length} check(s)</div>
          </div>
          <div class="sys-card ${crits.length > 0 ? 'crit' : 'ok'}">
            <div class="sys-card-label">🔴 Critical Issues</div>
            <div class="sys-card-val">${crits.length}</div>
            <div class="sys-card-sub">Require immediate action</div>
          </div>
          <div class="sys-card ${warns.length > 0 ? 'warn' : 'ok'}">
            <div class="sys-card-label">🟡 Warnings</div>
            <div class="sys-card-val">${warns.length}</div>
            <div class="sys-card-sub">Should be addressed soon</div>
          </div>
          <div class="sys-card ok">
            <div class="sys-card-label">✅ Checks Passed</div>
            <div class="sys-card-val">${issues.length === 0 ? '—' : (issues.length - crits.length - warns.length - infos.length)}</div>
            <div class="sys-card-sub">No issues detected</div>
          </div>
        </div>

        ${crits.length === 0 && warns.length === 0 ? `
          <div class="sys-alert ok">
            <span>✅</span>
            <span>All scanned patterns look healthy. No critical or warning issues detected. Run scan again after any deployment or config change.</span>
          </div>
        ` : ''}

        ${crits.length > 0 ? `
          <div class="sys-section-title">🔴 Critical Issues — Immediate Action Required</div>
          ${crits.map(issueCard).join('')}
        ` : ''}

        ${warns.length > 0 ? `
          <div class="sys-section-title">🟡 Warnings — Should Be Fixed Soon</div>
          ${warns.map(issueCard).join('')}
        ` : ''}

        ${infos.length > 0 ? `
          <div class="sys-section-title">ℹ️ Info</div>
          ${infos.map(issueCard).join('')}
        ` : ''}

        <!-- Scan coverage -->
        <div class="sys-section-title" style="margin-top:24px;">📋 Scan Coverage</div>
        <table class="sys-table" style="width:100%;">
          <thead><tr><th>Check ID</th><th>Category</th><th>What It Checks</th></tr></thead>
          <tbody>
            <tr><td class="sys-mono">RT-001…003</td><td>Realtime Sync</td><td>WebSocket connection, sync queue depth, retry failures</td></tr>
            <tr><td class="sys-mono">IO-001…004</td><td>Free Tier IO</td><td>Poll interval aggressiveness vs Cloudflare/Supabase limits</td></tr>
            <tr><td class="sys-mono">SB-001…003</td><td>Supabase Config</td><td>Client initialization, URL/key presence</td></tr>
            <tr><td class="sys-mono">ODP-001…002</td><td>One Day Password</td><td>Realtime channel status, SDK load, poll fallback detection</td></tr>
            <tr><td class="sys-mono">CTL-001…002</td><td>CTL Booking</td><td>Expired booking cleanup, queue duplicate detection</td></tr>
            <tr><td class="sys-mono">AUTH-001…003</td><td>Authentication</td><td>Session existence, JWT expiry, token rotation</td></tr>
            <tr><td class="sys-mono">MOD-001…003</td><td>Module Loading</td><td>Critical window.* function registrations</td></tr>
            <tr><td class="sys-mono">SDK-001</td><td>Vendor SDK</td><td>Supabase UMD bundle availability</td></tr>
          </tbody>
        </table>
        <div style="margin-top:12px;font-size:10px;color:#374151;font-style:italic;">
          Scan is client-side only — reads runtime window state, localStorage, and MUMS_ENV. Does not make any API calls. Safe to run in production.
        </div>
      </div>
    `;

    window.__mums_runScan = function() {
      _runBugScan();
      renderBugScanner(false);
    };
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
      case 'studio':     renderStudio(); break;
      case 'bugscanner':
        // FIX: forward force so Refresh All triggers a full rescan on this tab
        if (force) { _runBugScan(); }
        renderBugScanner(false);
        break;
    }
  }

  // ── Auto-refresh every 30s ────────────────────────────────────────────────
  renderOverview();
  // Auto-run bug scan after 2s so feature modules have time to initialize
  setTimeout(function() { try { _runBugScan(); } catch(_) {} }, 2000);
  const _autoRefresh = setInterval(() => { try { renderActiveTab(); } catch (_) { } }, 30000);
  onCleanup(() => clearInterval(_autoRefresh));
});
