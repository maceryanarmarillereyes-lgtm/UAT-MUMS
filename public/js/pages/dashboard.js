/* dashboard.js — MUMS Executive Pulse
 * Renders the live dashboard counters pulled from Quickbase.
 * Data source   : Global QB Settings (realm / tableId / qid / token)
 * Counter config: Global Dashboard Counters Settings (SUPER_ADMIN configures)
 * User filter   : qb_name from the logged-in user's profile (same as My Quickbase)
 * Refresh       : auto every 60 s, manual refresh button
 */
(window.Pages = window.Pages || {}, window.Pages.dashboard = function (root) {
  if (!root) return;
  root.innerHTML = '';

  // ── cleanup ──────────────────────────────────────────────────────────────
  let _refreshTimer = null;
  const prevCleanup = root._cleanup;
  root._cleanup = () => {
    try { if (prevCleanup) prevCleanup(); } catch (_) {}
    clearInterval(_refreshTimer);
  };

  // ── helpers ───────────────────────────────────────────────────────────────
  function getBearerToken() {
    try {
      const t = window.CloudAuth && typeof CloudAuth.accessToken === 'function' ? String(CloudAuth.accessToken() || '').trim() : '';
      if (t) return t;
      const sess = window.CloudAuth && typeof CloudAuth.loadSession === 'function' ? CloudAuth.loadSession() : null;
      return (sess && sess.access_token) ? String(sess.access_token).trim() : '';
    } catch (_) { return ''; }
  }

  function getCurrentUser() {
    try { return window.CloudAuth && typeof CloudAuth.getUser === 'function' ? CloudAuth.getUser() : null; } catch (_) { return null; }
  }

  async function apiFetch(path, opts) {
    const tok = getBearerToken();
    const r = await fetch('/api/' + path, {
      ...opts,
      headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json', ...(opts && opts.headers) }
    });
    return r.json();
  }

  // Count QB records matching a where clause via /api/quickbase/monitoring
  async function countQbRecords(qbSettings, whereClause) {
    if (!qbSettings.realm || !qbSettings.tableId) return null;
    try {
      const params = new URLSearchParams({
        realm:   qbSettings.realm,
        tableId: qbSettings.tableId,
        qid:     qbSettings.qid || '1',
        where:   whereClause || '',
        countOnly: '1',
      });
      const d = await apiFetch('quickbase/monitoring?' + params.toString());
      // The monitoring endpoint returns totalRecords or data array length
      if (typeof d.totalRecords === 'number') return d.totalRecords;
      if (Array.isArray(d.data)) return d.data.length;
      if (typeof d.count === 'number') return d.count;
      return 0;
    } catch (_) { return null; }
  }

  // Build Quickbase WHERE clause for a counter
  // fieldId is the numeric field id, operator is QB operator (EX, CT, etc.)
  // userValue is the user's qb_name (injected automatically for hero)
  function buildWhere(fieldId, operator, value) {
    if (!fieldId || !value) return '';
    return `{${fieldId}.${operator}.'${value.replace(/'/g, "\\'")}'}`;
  }

  // ── state ─────────────────────────────────────────────────────────────────
  let qbSettings   = {};
  let ctrConfig     = { hero: { label:'My Active Cases', sublabel:'', heroFieldId:'', heroOperator:'EX' }, counters:[] };
  let userQbName    = '';
  let counts        = {};    // { [counterId]: number | null }
  let heroCount     = null;
  let lastSync      = null;
  let loading       = true;

  // ── render skeleton ───────────────────────────────────────────────────────
  root.innerHTML = `
<div id="epRoot" style="
  min-height:100%;display:flex;flex-direction:column;
  background:#050b14;position:relative;overflow:hidden;font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif">

  <!-- ambient glows -->
  <div style="pointer-events:none;position:absolute;inset:0;overflow:hidden;z-index:0">
    <div style="position:absolute;top:-20%;left:50%;transform:translateX(-50%);width:1200px;height:800px;border-radius:50%;opacity:.14;filter:blur(120px);background:radial-gradient(ellipse,rgba(245,215,110,.45) 0%,transparent 60%)"></div>
    <div style="position:absolute;bottom:-30%;left:50%;transform:translateX(-50%);width:900px;height:600px;border-radius:50%;opacity:.07;filter:blur(100px);background:radial-gradient(ellipse,rgba(125,160,255,.5) 0%,transparent 60%)"></div>
    <div style="position:absolute;inset:0;box-shadow:inset 0 0 200px rgba(0,0,0,.85)"></div>
  </div>

  <!-- header -->
  <header style="position:relative;z-index:10;display:flex;align-items:center;justify-content:space-between;padding:0 32px;height:72px;border-bottom:1px solid rgba(255,255,255,.04)">
    <div style="display:flex;align-items:center;gap:12px">
      <div style="width:32px;height:32px;border-radius:10px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);display:flex;align-items:center;justify-content:center">
        <div style="width:14px;height:14px;border-radius:4px;background:linear-gradient(160deg,rgba(255,255,255,.8),rgba(255,255,255,.35))"></div>
      </div>
      <div style="display:flex;align-items:baseline;gap:10px">
        <span style="font-size:13px;letter-spacing:.18em;font-weight:600;color:rgba(255,255,255,.9)">MUMS</span>
        <span style="font-size:12px;font-weight:400;color:rgba(255,255,255,.3)">Executive Pulse</span>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:10px">
      <span id="epSyncStatus" style="font-size:11px;color:rgba(255,255,255,.3);letter-spacing:.04em"></span>
      <button id="epRefreshBtn" title="Refresh counters" style="
        display:flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:999px;
        background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);
        color:rgba(255,255,255,.5);font-size:11px;font-weight:500;cursor:pointer;
        transition:all .2s;letter-spacing:.04em">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>
        Refresh
      </button>
    </div>
  </header>

  <!-- main body -->
  <main id="epMain" style="position:relative;z-index:5;flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 24px">
    <!-- loading state -->
    <div id="epLoading" style="text-align:center;color:rgba(255,255,255,.25);font-size:13px;letter-spacing:.06em">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(245,215,110,.4)" stroke-width="1.5" stroke-linecap="round" style="animation:epSpin 1.2s linear infinite;margin-bottom:12px">
        <circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 10 10"/>
      </svg>
      <div>Loading dashboard…</div>
    </div>

    <!-- no config -->
    <div id="epNoConfig" style="display:none;text-align:center;color:rgba(255,255,255,.25);font-size:13px;line-height:2">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.2)" stroke-width="1.5" stroke-linecap="round" style="margin-bottom:12px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <div>No dashboard counters configured.</div>
      <div style="font-size:11px;margin-top:6px">Super Admin can set this up in Settings → Global Dashboard Counters.</div>
    </div>

    <!-- no QB name -->
    <div id="epNoQbName" style="display:none;text-align:center;color:rgba(255,255,255,.25);font-size:13px;line-height:2">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.2)" stroke-width="1.5" stroke-linecap="round" style="margin-bottom:12px"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
      <div>Your Quickbase name is not set.</div>
      <div style="font-size:11px;margin-top:6px">Ask your Super Admin to assign your QB Name in User Management.</div>
    </div>

    <!-- dashboard content -->
    <div id="epContent" style="display:none;width:100%;max-width:1200px">

      <!-- pills + hero layout -->
      <div id="epLayout" style="display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:24px 32px"></div>

      <!-- live badge -->
      <div style="margin-top:36px;display:flex;align-items:center;justify-content:center">
        <div style="display:flex;align-items:center;gap:8px;padding:0 14px;height:24px;border-radius:999px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06)">
          <span style="width:6px;height:6px;border-radius:50%;background:#34d399;animation:epPulse 2s ease-in-out infinite"></span>
          <span style="font-size:10px;letter-spacing:.18em;font-weight:500;color:rgba(255,255,255,.4)">LIVE PULSE</span>
        </div>
      </div>

    </div>
  </main>

  <!-- footer meta -->
  <footer style="position:relative;z-index:10;display:flex;align-items:center;justify-content:space-between;padding:12px 32px;border-top:1px solid rgba(255,255,255,.04)">
    <div id="epFilterMeta" style="font-size:11px;color:rgba(255,255,255,.28);letter-spacing:.03em"></div>
    <div id="epSyncMeta" style="font-size:11px;color:rgba(255,255,255,.2);letter-spacing:.03em"></div>
  </footer>

</div>
<style>
  @keyframes epSpin  { to { transform:rotate(360deg); } }
  @keyframes epPulse { 0%,100%{opacity:.5}50%{opacity:1} }
  @keyframes epCount { from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)} }
  @keyframes epRingA { to{transform:rotate(360deg);transform-origin:190px 190px} }
  @keyframes epRingB { to{transform:rotate(-360deg);transform-origin:190px 190px} }
  .ep-pill {
    backdrop-filter:blur(28px) saturate(140%);-webkit-backdrop-filter:blur(28px) saturate(140%);
    background:linear-gradient(180deg,rgba(255,255,255,.07) 0%,rgba(255,255,255,.02) 100%);
    box-shadow:inset 0 1px 0 rgba(255,255,255,.09),inset 0 0 30px rgba(0,0,0,.25),0 8px 32px rgba(0,0,0,.45);
    border:1px solid rgba(255,255,255,.06);
    border-radius:28px;height:88px;padding:0 28px;
    display:flex;align-items:center;justify-content:space-between;
    min-width:220px;width:244px;cursor:default;
    transition:transform .3s,background .3s;
  }
  .ep-pill:hover { transform:scale(1.015);background:rgba(255,255,255,.05); }
  .ep-val {
    color:#f5d76e;font-size:46px;font-weight:200;line-height:1;
    letter-spacing:-.02em;
    text-shadow:0 0 60px rgba(245,215,110,.12),0 0 20px rgba(245,215,110,.08);
    transition:text-shadow .4s;
    animation:epCount .4s ease-out;
  }
  .ep-pill:hover .ep-val { text-shadow:0 0 80px rgba(245,215,110,.28),0 0 30px rgba(245,215,110,.18); }
  .ep-val-null { color:rgba(255,255,255,.18);font-size:32px; }
  .ep-hero-wrap {
    position:relative;width:340px;height:340px;
    display:flex;align-items:center;justify-content:center;
    flex-shrink:0;
  }
  .ep-hero-core {
    position:absolute;width:280px;height:280px;border-radius:50%;
    background:radial-gradient(ellipse at center,rgba(255,255,255,.08) 0%,rgba(255,255,255,.025) 45%,transparent 70%);
    backdrop-filter:blur(40px);-webkit-backdrop-filter:blur(40px);
    box-shadow:inset 0 1px 1px rgba(255,255,255,.1),inset 0 -30px 60px rgba(0,0,0,.55),inset 0 0 80px rgba(0,0,0,.4);
    border:1px solid rgba(255,255,255,.055);
  }
  .ep-hero-num {
    position:relative;z-index:5;text-align:center;
  }
  .ep-hero-count {
    display:block;font-size:160px;font-weight:200;line-height:.85;letter-spacing:-.05em;
    color:#f5d76e;
    text-shadow:0 0 60px rgba(245,215,110,.15),0 0 20px rgba(245,215,110,.1);
    animation:epCount .5s ease-out;
  }
  .ep-hero-label {
    display:block;margin-top:16px;font-size:11px;letter-spacing:.24em;font-weight:550;
    color:rgba(255,255,255,.4);text-transform:uppercase;
  }
  #epRefreshBtn:hover { background:rgba(255,255,255,.08);color:rgba(255,255,255,.8);border-color:rgba(255,255,255,.18); }
</style>`;

  // ── wire refresh button ───────────────────────────────────────────────────
  const refreshBtn = root.querySelector('#epRefreshBtn');
  if (refreshBtn) refreshBtn.onclick = () => loadAll(true);

  // ── load everything ───────────────────────────────────────────────────────
  async function loadAll(manual) {
    show('epLoading'); hide('epContent'); hide('epNoConfig'); hide('epNoQbName');
    setSyncStatus('Loading…');

    try {
      // 1. Fetch Global QB settings (realm, tableId, token)
      const qbd = await apiFetch('settings/global_quickbase');
      qbSettings = (qbd.ok && qbd.settings) ? qbd.settings : {};

      // 2. Fetch dashboard counter config
      const ctrd = await apiFetch('settings/global_dashboard_counters');
      ctrConfig = (ctrd.ok && ctrd.config) ? ctrd.config : { hero:{label:'My Active Cases',sublabel:'',heroFieldId:'',heroOperator:'EX'}, counters:[] };

      // 3. Get current user's qb_name
      const me = getCurrentUser();
      const myId = me && me.id;
      if (myId) {
        try {
          const pd = await apiFetch('profile?uid=' + myId);
          userQbName = String((pd && (pd.qb_name || (pd.profile && pd.profile.qb_name))) || '').trim();
        } catch (_) {}
        // fallback: check Store
        if (!userQbName && window.Store && typeof Store.getUsers === 'function') {
          const su = Store.getUsers().find(u => u.id === myId || u.user_id === myId);
          if (su) userQbName = String(su.qb_name || '').trim();
        }
      }

      // No counters configured
      if (!ctrConfig.counters.length && !ctrConfig.hero.heroFieldId) {
        hide('epLoading'); show('epNoConfig'); return;
      }

      // No qb_name
      if (!userQbName) {
        hide('epLoading'); show('epNoQbName'); return;
      }

      // 4. Fetch counts in parallel
      await fetchCounts();

      // 5. Render
      hide('epLoading'); show('epContent');
      renderDashboard();
      updateMeta();
      setSyncStatus('');

    } catch (err) {
      console.error('[dashboard]', err);
      hide('epLoading');
      setSyncStatus('⚠ Error loading data');
    }
  }

  async function fetchCounts() {
    const tasks = [];

    // Hero count — filtered to user's qb_name
    if (ctrConfig.hero.heroFieldId && userQbName) {
      const where = buildWhere(ctrConfig.hero.heroFieldId, ctrConfig.hero.heroOperator || 'EX', userQbName);
      tasks.push(
        countQbRecords(qbSettings, where).then(n => { heroCount = n; })
      );
    }

    // Side counters — each has its own field+value filter
    ctrConfig.counters.forEach(c => {
      if (!c.fieldId || !c.value) { counts[c.id] = null; return; }
      // Counters also filter by user's qb_name IF the hero field is set
      // (intersect: assigned to user AND matching counter value)
      let where = buildWhere(c.fieldId, c.operator || 'EX', c.value);
      if (ctrConfig.hero.heroFieldId && userQbName) {
        const userWhere = buildWhere(ctrConfig.hero.heroFieldId, ctrConfig.hero.heroOperator || 'EX', userQbName);
        where = `${userWhere}AND${where}`;
      }
      tasks.push(
        countQbRecords(qbSettings, where).then(n => { counts[c.id] = n; })
      );
    });

    await Promise.allSettled(tasks);
    lastSync = new Date();
  }

  // ── render ────────────────────────────────────────────────────────────────
  function renderDashboard() {
    const layout = root.querySelector('#epLayout');
    if (!layout) return;
    layout.innerHTML = '';

    const allCounters = ctrConfig.counters;
    // Split into left (up to 2), hero, right (up to 2), remainder rendered below
    const left  = allCounters.slice(0, 2);
    const right  = allCounters.slice(2, 4);
    const extra  = allCounters.slice(4);

    // Left pills column
    if (left.length) {
      const col = div('', 'display:flex;flex-direction:column;gap:14px;align-items:flex-end');
      left.forEach(c => col.appendChild(makePill(c)));
      layout.appendChild(col);
    }

    // Hero circle
    layout.appendChild(makeHero());

    // Right pills column
    if (right.length) {
      const col = div('', 'display:flex;flex-direction:column;gap:14px;align-items:flex-start');
      right.forEach(c => col.appendChild(makePill(c)));
      layout.appendChild(col);
    }

    // Extra pills (5th, 6th) in a bottom row
    if (extra.length) {
      const row = div('', 'width:100%;display:flex;justify-content:center;gap:14px;margin-top:14px;flex-wrap:wrap');
      extra.forEach(c => row.appendChild(makePill(c)));
      layout.appendChild(row);
    }
  }

  function makePill(c) {
    const count = counts[c.id];
    const el = document.createElement('div');
    el.className = 'ep-pill';
    el.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:6px">
        <span style="font-size:11px;line-height:1;letter-spacing:.2em;font-weight:550;color:rgba(255,255,255,.38);text-transform:uppercase">${esc(c.label)}</span>
        ${c.sublabel ? `<span style="font-size:12px;line-height:1;font-weight:400;color:rgba(255,255,255,.25)">${esc(c.sublabel)}</span>` : ''}
      </div>
      <div class="ep-val${count === null ? ' ep-val-null' : ''}">${count === null ? '—' : count}</div>`;
    return el;
  }

  function makeHero() {
    const wrap = document.createElement('div');
    wrap.className = 'ep-hero-wrap';
    const n = heroCount;
    wrap.innerHTML = `
      <!-- glow -->
      <div style="position:absolute;width:420px;height:420px;border-radius:50%;opacity:.15;filter:blur(80px);pointer-events:none;background:radial-gradient(circle,rgba(245,215,110,.5) 0%,transparent 60%)"></div>
      <!-- animated rings SVG -->
      <svg style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none" viewBox="0 0 380 380">
        <defs>
          <linearGradient id="epRingGold" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%"   stop-color="#f5d76e" stop-opacity="0"/>
            <stop offset="20%"  stop-color="#f5d76e" stop-opacity="0.05"/>
            <stop offset="50%"  stop-color="#f5d76e" stop-opacity="0.9"/>
            <stop offset="80%"  stop-color="#f5d76e" stop-opacity="0.05"/>
            <stop offset="100%" stop-color="#f5d76e" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <circle cx="190" cy="190" r="172" fill="none" stroke="rgba(255,255,255,.035)" stroke-width="1"/>
        <circle cx="190" cy="190" r="158" fill="none" stroke="rgba(255,255,255,.02)" stroke-width=".5"/>
        <circle cx="190" cy="190" r="172" fill="none" stroke="url(#epRingGold)" stroke-width="1.2" stroke-linecap="round" stroke-dasharray="180 900" style="animation:epRingA 38s linear infinite;transform-origin:190px 190px" opacity=".9"/>
        <circle cx="190" cy="190" r="172" fill="none" stroke="rgba(245,215,110,.15)" stroke-width=".5" stroke-dasharray="2 14" style="animation:epRingB 52s linear infinite;transform-origin:190px 190px" opacity=".5"/>
      </svg>
      <!-- glass core -->
      <div class="ep-hero-core"></div>
      <div style="position:absolute;width:260px;height:260px;border-radius:50%;background:radial-gradient(circle at 30% 30%,rgba(255,255,255,.08),transparent 60%)"></div>
      <!-- number -->
      <div class="ep-hero-num">
        <span class="ep-hero-count">${n === null ? '—' : n}</span>
        <div style="height:1px;width:64px;margin:14px auto 10px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.2),transparent)"></div>
        <span class="ep-hero-label">${esc(ctrConfig.hero.label || 'My Active Cases')}</span>
        ${ctrConfig.hero.sublabel ? `<span style="display:block;font-size:11px;color:rgba(255,255,255,.22);margin-top:4px;letter-spacing:.08em">${esc(ctrConfig.hero.sublabel)}</span>` : ''}
      </div>`;
    return wrap;
  }

  function updateMeta() {
    const fm = root.querySelector('#epFilterMeta');
    const sm = root.querySelector('#epSyncMeta');
    if (fm) fm.innerHTML = userQbName
      ? `Filtered by Quickbase Name: <b style="color:rgba(255,255,255,.5)">${esc(userQbName)}</b> &nbsp;•&nbsp; Source: Global Quickbase Settings`
      : '';
    if (sm && lastSync) sm.textContent = '⬤ SYNCHRONIZED  ' + lastSync.toLocaleTimeString();
  }

  function setSyncStatus(msg) {
    const el = root.querySelector('#epSyncStatus');
    if (el) el.textContent = msg;
  }

  // ── utils ─────────────────────────────────────────────────────────────────
  function show(id) { const el = root.querySelector('#' + id); if (el) el.style.display = ''; }
  function hide(id) { const el = root.querySelector('#' + id); if (el) el.style.display = 'none'; }
  function div(cls, style) { const d = document.createElement('div'); if (cls) d.className = cls; if (style) d.style.cssText = style; return d; }
  function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // ── auto-refresh every 60 s ───────────────────────────────────────────────
  _refreshTimer = setInterval(() => {
    if (root.isConnected) {
      fetchCounts().then(() => {
        renderDashboard();
        updateMeta();
      });
    }
  }, 60 * 1000);

  // ── kick off ──────────────────────────────────────────────────────────────
  loadAll(false);
});
