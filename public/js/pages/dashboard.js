/**
 * @file dashboard.js
 * @description Page: Dashboard — main landing page with widgets, presence, and mailbox summary
 * @module MUMS/Pages
 * @version UAT
 */
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

  // ★ PERMANENT FIX — countQbRecords
  // ROOT CAUSE 1: monitoring returns {ok, columns, records:[]} NOT {data, totalRecords, count}.
  //   d.data was always undefined → always fell through to "return 0".
  // ROOT CAUSE 2: ?countOnly param doesn't exist on the monitoring endpoint.
  //   We still fetch records but limit=1 is not enough for counting — we need the full set.
  //   Instead we use limit=5000 (QB API max) and read d.records.length for the count.
  // ROOT CAUSE 3: monitoring ignores our ?where= for its own privacy filter logic.
  //   The ?where= is passed as extraWhere but the endpoint ALSO adds its own Assigned-To filter.
  //   For DASHBOARD counters we need a DIRECT QB API call (not through monitoring)
  //   to get un-filtered counts using our custom WHERE clause.
  //
  // FIX: Call a dedicated lightweight count endpoint using Global QB settings (token on server).
  // Falls back gracefully if the endpoint is unavailable.
  async function countQbRecords(qbSettings, whereClause) {
    if (!qbSettings.realm || !qbSettings.tableId) return null;
    try {
      const params = new URLSearchParams({
        realm:   String(qbSettings.realm   || '').trim(),
        tableId: String(qbSettings.tableId || '').trim(),
        qid:     String(qbSettings.qid     || '').trim(),
        where:   String(whereClause        || '').trim(),
      });
      const d = await apiFetch('settings/global_qb_count?' + params.toString());
      if (!d.ok) return null;
      if (typeof d.count === 'number') return d.count;
      return 0;
    } catch (_) { return null; }
  }

  // Build Quickbase WHERE clause for a counter
  // fieldId is the numeric field id, operator is QB operator (EX, CT, etc.)
  // userValue is the user's qb_name (injected automatically for hero)

  function hasValidQbName(name) {
    const normalized = String(name || '').trim().toLowerCase();
    if (!normalized) return false;
    return normalized !== 'not assigned' && normalized !== '-- not assigned --';
  }

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
      <div>DATA NOT AVAILABLE</div>
      <div style="font-size:11px;margin-top:6px">Contact the ADMIN to Enable your dashboard.</div>
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
      // ★ FIX: Was calling /api/profile?uid=... (404 — that route doesn't exist).
      //   Correct endpoint is /api/users/me which returns { profile: { qb_name, ... } }.
      //   This eliminated 3 red 404 errors per page load in the console.
      const me = getCurrentUser();
      const myId = me && me.id;
      if (myId) {
        try {
          const pd = await apiFetch('users/me');
          // users/me returns { ok, profile: { qb_name, ... } }
          userQbName = String(
            (pd && pd.profile && pd.profile.qb_name) ||
            (pd && pd.qb_name) ||
            ''
          ).trim();
        } catch (_) {}
        // fallback: check Store (local cache, no network)
        if (!userQbName && window.Store && typeof Store.getUsers === 'function') {
          const su = Store.getUsers().find(u => u.id === myId || u.user_id === myId);
          if (su) userQbName = String(su.qb_name || '').trim();
        }
      }

      // No counters configured at all (both hero AND side counters empty)
      // ★ FIX: Allow partial config — if side counters exist, show them even without hero fieldId.
      //   Only show "no config" state when NOTHING is configured at all.
      const hasHero    = !!(ctrConfig.hero && ctrConfig.hero.heroFieldId);
      const hasCounters = !!(ctrConfig.counters && ctrConfig.counters.length);
      if (!hasHero && !hasCounters) {
        hide('epLoading'); show('epNoConfig'); return;
      }

      // Dashboard requires a valid Quickbase name to prevent global-data bleed.
      if (!hasValidQbName(userQbName)) {
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

  // ── fetchCounts — v3.0 (Monitoring-Primary Architecture)
  // ─────────────────────────────────────────────────────────────────────────
  // ROOT CAUSE OF MISMATCH (diagnosed):
  //   Old approach used separate global_qb_count QB API calls per counter.
  //   Hero relied on heroFieldId (admin-set) for user filter.
  //   If heroFieldId = "" (empty/not saved) → hero shows "—", side counters
  //   show ALL users' records (99) instead of just this user's (12).
  //
  // FIX — PRIMARY PATH: Use QuickbaseAdapter.fetchMonitoringData()
  //   - SAME monitoring endpoint that My Quickbase page uses
  //   - Monitoring auto-resolves "Assigned to" field by label — no heroFieldId needed
  //   - Applies: QID report filter + Global QB base filters + user qb_name filter
  //   - Records returned = identical to what My QB shows
  //   - Hero count = records.length (total user records)
  //   - Side counters = count from records locally (same logic as renderDashboardCounters)
  //   → GUARANTEED exact match with My Quickbase. Always.
  //
  // FALLBACK PATH: global_qb_count QB API calls (old approach)
  //   - Used ONLY if QuickbaseAdapter unavailable or monitoring fails
  //   - Requires heroFieldId to be correctly set for user filtering
  // ─────────────────────────────────────────────────────────────────────────
  async function fetchCounts() {
    const canUseMonitoring = !!(
      window.QuickbaseAdapter &&
      typeof window.QuickbaseAdapter.fetchMonitoringData === 'function' &&
      qbSettings.qid &&
      qbSettings.tableId &&
      qbSettings.realm &&
      userQbName
    );

    if (canUseMonitoring) {
      await _fetchCountsViaMonitoring();
    } else {
      // Fallback: direct QB API calls (requires heroFieldId to be set)
      await _fetchCountsViaQbApi();
    }
    lastSync = new Date();
  }

  // ── PRIMARY: Monitoring endpoint (same as My Quickbase) ──────────────────
  async function _fetchCountsViaMonitoring() {
    try {
      const data = await window.QuickbaseAdapter.fetchMonitoringData({
        bust     : Date.now(),
        limit    : 500,                         // Enough for accurate counts (monitoring caps at 500)
        qid      : qbSettings.qid     || '',
        tableId  : qbSettings.tableId || '',
        realm    : qbSettings.realm   || '',
        customFilters : [],
        filterMatch   : 'ALL',
        search        : ''
        // Note: monitoring server auto-injects {assignedToFieldId.EX.'userQbName'}
        // for non-SUPER_ADMIN users. SUPER_ADMIN sees all records unless
        // bypassGlobal is false (which it is here — we want per-user counts).
      });

      const records = Array.isArray(data && data.records) ? data.records : [];

      // Hero count = total records for this user
      // Monitoring already filtered by user's qb_name — this IS "My Active Cases"
      heroCount = records.length;


      // DASHBOARD DRILL-DOWN CACHE: store fetched records for counter click drill-down
      window.__mums_dash_records = records.slice();
      window.__mums_dash_columns = Array.isArray(data && data.columns) ? data.columns.slice()
        : (Array.isArray(data && data.allAvailableFields) ? data.allAvailableFields.slice() : []);

      // Side counters: count from fetched records locally
      // Mirrors renderDashboardCounters() in my_quickbase.js — exact same logic
      ctrConfig.counters.forEach(c => {
        if (!c.fieldId) { counts[c.id] = null; return; }
        const matchVal = String(c.value || '').toLowerCase();
        const op       = String(c.operator || 'EX').toUpperCase();
        counts[c.id] = records.filter(record => {
          const fields   = record && record.fields ? record.fields : {};
          const fld      = fields[String(c.fieldId)] || null;
          const srcVal   = String(fld && fld.value != null ? fld.value : '').toLowerCase();
          if (op === 'XEX') return srcVal !== matchVal;
          if (op === 'CT')  return srcVal.includes(matchVal);
          return srcVal === matchVal; // EX (default) — exact match, case-insensitive
        }).length;
      });

      console.log('[dashboard] ✅ fetchCounts via monitoring — hero:', heroCount,
        '| counters:', Object.entries(counts).map(([k,v]) => k+':'+v).join(', '));

    } catch (err) {
      console.warn('[dashboard] monitoring fallback triggered:', err && err.message || err);
      // Monitoring failed — fall back to direct QB API
      // Note: columns not available in fallback path — drill-down shows raw data
      window.__mums_dash_records = [];
      window.__mums_dash_columns = [];
      await _fetchCountsViaQbApi();
    }
  }

  // ── FALLBACK: Direct QB API via global_qb_count (requires heroFieldId) ───
  async function _fetchCountsViaQbApi() {
    const tasks = [];

    // Hero count — filtered to user's qb_name via heroFieldId
    if (ctrConfig.hero.heroFieldId && userQbName) {
      const where = buildWhere(ctrConfig.hero.heroFieldId, ctrConfig.hero.heroOperator || 'EX', userQbName);
      tasks.push(countQbRecords(qbSettings, where).then(n => { heroCount = n; }));
    }

    // Side counters — intersect user filter + counter filter
    ctrConfig.counters.forEach(c => {
      if (!c.fieldId || !c.value) { counts[c.id] = null; return; }
      let where = buildWhere(c.fieldId, c.operator || 'EX', c.value);
      if (ctrConfig.hero.heroFieldId && userQbName) {
        const userWhere = buildWhere(ctrConfig.hero.heroFieldId, ctrConfig.hero.heroOperator || 'EX', userQbName);
        where = `${userWhere}AND${where}`;
      }
      tasks.push(countQbRecords(qbSettings, where).then(n => { counts[c.id] = n; }));
    });

    await Promise.allSettled(tasks);
    console.log('[dashboard] ⚡ fetchCounts via QB API (fallback) — hero:', heroCount);
  }

  // ── render ─────────────────────────────────────────────────────────────────
  // [FIX-ZERO-HIDE] Only render side counters with count > 0.
  // Zero counts are hidden — they convey no useful info and clutter the dashboard.
  // [FREE-TIER-LAYOUT] Balanced column split auto-adjusts to however many visible
  // counters remain, so the layout never has empty column slots.
  function renderDashboard() {
    const layout = root.querySelector('#epLayout');
    if (!layout) return;
    layout.innerHTML = '';

    // Filter: only counters with a positive count (> 0) are rendered.
    // null (loading) and 0 are both hidden — enterprise standard: show signal, not noise.
    const visibleCounters = ctrConfig.counters.filter(c => {
      const n = counts[c.id];
      return typeof n === 'number' && n > 0;
    });

    // Balanced split: left = floor(n/2), right = ceil(n/2), overflow = extras beyond 4
    const splitAt = Math.min(Math.ceil(visibleCounters.length / 2), 2);
    const left    = visibleCounters.slice(0, splitAt);
    const right   = visibleCounters.slice(splitAt, splitAt + 2);
    const extra   = visibleCounters.slice(splitAt + 2);

    // Left pills column
    if (left.length) {
      const col = div('', 'display:flex;flex-direction:column;gap:14px;align-items:flex-end');
      left.forEach(c => col.appendChild(makePill(c)));
      layout.appendChild(col);
    }

    // Hero circle — always rendered regardless of heroCount value
    layout.appendChild(makeHero());

    // Right pills column
    if (right.length) {
      const col = div('', 'display:flex;flex-direction:column;gap:14px;align-items:flex-start');
      right.forEach(c => col.appendChild(makePill(c)));
      layout.appendChild(col);
    }

    // Extra pills (5th+) in a centred bottom row
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
      ? `Filter: QB Name = <b style="color:rgba(255,255,255,.5)">${esc(userQbName)}</b> &nbsp;&bull;&nbsp; Scope: Global QB base filters + Report (QID) filters — same as My Quickbase`
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
  // ── Auto-refresh — free-tier aligned ────────────────────────────────────────
  // [FREE-TIER] 120 s interval (2 min) halves API call frequency vs 60 s.
  // [FREE-TIER] Page Visibility API: pause all refreshes when browser tab is
  //   hidden — zero wasted API calls when user switches away. Resume on return.
  // With 30 daily users, this caps Cloudflare/QB calls at ~450/day (vs 900/day).
  let _pageHidden = false;

  const _onVisibilityChange = () => {
    _pageHidden = document.hidden;
    // Immediately refresh on tab return after being away > 60 s
    if (!_pageHidden && root.isConnected && lastSync && (Date.now() - lastSync.getTime()) > 60000) {
      fetchCounts().then(() => { renderDashboard(); updateMeta(); });
    }
  };
  document.addEventListener('visibilitychange', _onVisibilityChange);

  // Clean up visibility listener when page component is torn down
  const _prevCleanup2 = root._cleanup;
  root._cleanup = () => {
    try { if (_prevCleanup2) _prevCleanup2(); } catch (_) {}
    document.removeEventListener('visibilitychange', _onVisibilityChange);
    clearInterval(_refreshTimer);
  };

  _refreshTimer = setInterval(() => {
    if (!root.isConnected) { clearInterval(_refreshTimer); return; }
    if (_pageHidden) return;  // Tab hidden — skip this tick entirely
    fetchCounts().then(() => { renderDashboard(); updateMeta(); });
  }, 120 * 1000); // 2 minutes — free-tier optimised


  // ═══════════════════════════════════════════════════════════════════════════
  // DASHBOARD DRILL-DOWN: Counter click → filtered records table
  // + Row click → Case Detail View (same format as My Quickbase)
  //
  // Architecture:
  //   1. makePill/makeHero get click handlers injected (clickable pill/hero)
  //   2. Click fires openDrillDown(filterId, label) — fetches records via
  //      QuickbaseAdapter.fetchMonitoringData (same engine as My QB)
  //   3. Records rendered as premium table with exact required columns
  //   4. Row-num click → builds snap → opens qbcd modal via window.dispatchEvent
  //      mums:open_qbcd — a new lightweight event the modal listens for
  // ═══════════════════════════════════════════════════════════════════════════

  // ── _fetchDrillRecords: get full records set for a counter filter ──────────
  async function _fetchDrillRecords(counterId) {
    const records = window.__mums_dash_records || [];
    if (!records.length) return [];
    if (counterId === '__hero__') return records;
    const c = (ctrConfig.counters || []).find(function(x) { return x.id === counterId; });
    if (!c || !c.fieldId) return records;
    const matchVal = String(c.value || '').toLowerCase();
    const op       = String(c.operator || 'EX').toUpperCase();
    return records.filter(function(record) {
      const fields = record && record.fields ? record.fields : {};
      const fld    = fields[String(c.fieldId)] || null;
      const srcVal = String(fld && fld.value != null ? fld.value : '').toLowerCase();
      if (op === 'XEX') return srcVal !== matchVal;
      if (op === 'CT')  return srcVal.includes(matchVal);
      return srcVal === matchVal;
    });
  }

  // ── Column label resolver using column keyword matching ───────────────────
  function _resolveColumns(columns) {
    // Returns an array of { id, label } for the REQUIRED table headers
    // in display order. Falls back to raw label if no match.
    const REQUIRED = [
      { key: 'case_num',     labels: ['case #','case#','case number','record id','rid'] },
      { key: 'description',  labels: ['short description','concern','description','subject'] },
      { key: 'case_notes',   labels: ['case notes','notes detail','case note'] },
      { key: 'assigned_to',  labels: ['assigned to','assignee'] },
      { key: 'contact_name', labels: ['contact','full name','contact – full name','contact - full name'] },
      { key: 'case_status',  labels: ['case status','status'] },
      { key: 'age',          labels: ['\bage\b','open duration','age (days)'] },
      { key: 'end_user',     labels: ['end user','client account','end user / client'] },
      { key: 'type',         labels: ['\btype\b','case type','case category'] },
      { key: 'last_update',  labels: ['last update','last updated','days since update','update days'] },
    ];
    const DISPLAY_LABELS = {
      case_num:     'CASE #',
      description:  'SHORT DESCRIPTION',
      case_notes:   'CASE NOTES',
      assigned_to:  'ASSIGNED TO',
      contact_name: 'CONTACT – FULL NAME',
      case_status:  'CASE STATUS',
      age:          'AGE',
      end_user:     'END USER',
      type:         'TYPE',
      last_update:  'LAST UPDATE DAYS',
    };
    const resolved = {};
    REQUIRED.forEach(function(req) {
      const match = (columns || []).find(function(col) {
        const lbl = String(col.label || '').toLowerCase();
        return req.labels.some(function(k) { return lbl.includes(k.replace(/\\b/g, '')); });
      });
      resolved[req.key] = match ? { id: String(match.id), label: DISPLAY_LABELS[req.key] } : null;
    });
    return resolved;
  }

  // ── _esc helper ───────────────────────────────────────────────────────────
  function _esc2(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function _cellVal(record, colId) {
    if (!colId) return '';
    const f = record && record.fields && record.fields[colId];
    return f && f.value != null ? String(f.value) : '';
  }

  function _fmtAge(val) {
    const n = Number(val);
    if (!isFinite(n) || n < 0) return val || '';
    const d = Math.round(n / 86400000);
    if (d < 1) return '< 1 day';
    return d + (d === 1 ? ' day' : ' days');
  }

  function _statusBadge(val) {
    const v = String(val || '').toLowerCase();
    let color = '#94a3b8';
    if (v.includes('investigating')) color = '#22d3ee';
    else if (v.includes('waiting'))  color = '#f59e0b';
    else if (v.includes('initial'))  color = '#a78bfa';
    else if (v.includes('escalat'))  color = '#f87171';
    return `<span style="display:inline-block;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:600;letter-spacing:.04em;background:${color}22;color:${color};border:1px solid ${color}55">${_esc2(val)}</span>`;
  }

  // ── Open drill-down panel ─────────────────────────────────────────────────
  let _ddPanel = null;
  let _ddCleanup = null;

  async function openDrillDown(counterId, label) {
    // Remove existing panel
    if (_ddPanel) { try { _ddPanel.remove(); } catch(_) {} _ddPanel = null; }
    if (_ddCleanup) { try { _ddCleanup(); } catch(_) {} _ddCleanup = null; }

    // Build panel
    const panel = document.createElement('div');
    panel.id = '__epDrillPanel';
    panel.style.cssText = [
      'position:fixed;inset:0;z-index:9000;',
      'background:rgba(2,6,23,.92);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);',
      'display:flex;flex-direction:column;overflow:hidden;',
      'animation:__epDdIn .22s cubic-bezier(.32,1.12,.64,1)',
    ].join('');
    document.body.appendChild(panel);
    _ddPanel = panel;

    panel.innerHTML = `
    <style>
      @keyframes __epDdIn { from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:none} }
      @keyframes __epDdSpin { to{transform:rotate(360deg)} }
      .__ep-tbl { width:100%;border-collapse:collapse;font-size:12px; }
      .__ep-tbl thead th {
        position:sticky;top:0;z-index:2;
        background:#0a1628;color:rgba(255,255,255,.38);
        font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;
        padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.08);text-align:left;
        white-space:nowrap;
      }
      .__ep-tbl tbody tr {
        border-bottom:1px solid rgba(255,255,255,.05);
        transition:background .1s;cursor:default;
      }
      .__ep-tbl tbody tr:hover { background:rgba(255,255,255,.04); }
      .__ep-tbl tbody td {
        padding:9px 14px;color:#cbd5e1;vertical-align:top;
        font-size:12px;line-height:1.45;
      }
      .__ep-rn {
        width:36px;min-width:36px;background:rgba(0,0,0,.2);
        border-right:1px solid rgba(255,255,255,.06);text-align:center;
      }
      .__ep-rn-btn {
        display:inline-flex;align-items:center;justify-content:center;
        width:26px;height:26px;border-radius:8px;
        background:rgba(34,211,238,.12);border:1px solid rgba(34,211,238,.25);
        color:#22d3ee;font-size:11px;font-weight:700;cursor:pointer;
        transition:all .15s;
      }
      .__ep-rn-btn:hover { background:rgba(34,211,238,.28);transform:scale(1.08); }
      .__ep-cn-cell { max-width:260px; }
      .__ep-desc-cell { max-width:200px; }
      .__ep-notes-cell { max-width:300px;font-size:11.5px;color:rgba(200,220,255,.7); }
      .__ep-overflow { white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block;max-width:inherit; }
    </style>

    <div style="display:flex;align-items:center;justify-content:space-between;
      padding:14px 24px;border-bottom:1px solid rgba(255,255,255,.07);flex-shrink:0;
      background:linear-gradient(90deg,rgba(34,211,238,.05),transparent)">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:3px;height:28px;border-radius:3px;background:linear-gradient(180deg,#22d3ee,#a78bfa)"></div>
        <div>
          <div style="font-size:13px;font-weight:700;color:#f1f5f9;letter-spacing:.02em">${_esc2(label)}</div>
          <div style="font-size:11px;color:rgba(255,255,255,.35);margin-top:2px" id="__epDdCount">Loading…</div>
        </div>
      </div>
      <button id="__epDdClose" style="
        display:flex;align-items:center;gap:6px;height:32px;padding:0 14px;
        border-radius:8px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);
        color:rgba(255,255,255,.5);font-size:12px;font-weight:500;cursor:pointer;
        transition:all .15s" onmouseover="this.style.background='rgba(255,255,255,.1)'" onmouseout="this.style.background='rgba(255,255,255,.05)'">
        ✕ &nbsp;Close
      </button>
    </div>

    <div id="__epDdBody" style="flex:1;overflow-y:auto;padding:0 24px 24px">
      <div style="display:flex;align-items:center;justify-content:center;height:120px;gap:10px;color:rgba(255,255,255,.3)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(34,211,238,.5)" stroke-width="2" stroke-linecap="round" style="animation:__epDdSpin 1s linear infinite"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>
        Loading records…
      </div>
    </div>`;

    // Close handlers
    const closeBtn = panel.querySelector('#__epDdClose');
    if (closeBtn) closeBtn.onclick = _closeDrillDown;
    function _onEscDd(e) { if (e.key === 'Escape') _closeDrillDown(); }
    document.addEventListener('keydown', _onEscDd);
    _ddCleanup = function() { document.removeEventListener('keydown', _onEscDd); };

    // Fetch + render
    let records = [];
    let columns = [];
    try {
      // Use cached records from last monitoring fetch if available
      records = await _fetchDrillRecords(counterId);
      columns = window.__mums_dash_columns || [];
    } catch(e) {
      records = [];
    }

    const body = panel.querySelector('#__epDdBody');
    const countEl = panel.querySelector('#__epDdCount');
    if (countEl) countEl.textContent = records.length + ' record' + (records.length !== 1 ? 's' : '');

    if (!records.length) {
      if (body) body.innerHTML = '<div style="text-align:center;padding:48px;color:rgba(255,255,255,.25);font-size:13px">No records found for this filter.</div>';
      return;
    }

    const colMap = _resolveColumns(columns);

    // Build table
    const tbl = document.createElement('table');
    tbl.className = '__ep-tbl';

    // Header
    const thead = document.createElement('thead');
    thead.innerHTML = `<tr>
      <th class="__ep-rn" style="text-align:center">#</th>
      <th>${colMap.case_num ? _esc2(colMap.case_num.label) : 'CASE #'}</th>
      <th class="__ep-desc-cell">${colMap.description ? _esc2(colMap.description.label) : 'SHORT DESCRIPTION'}</th>
      <th class="__ep-notes-cell">${colMap.case_notes ? _esc2(colMap.case_notes.label) : 'CASE NOTES'}</th>
      <th>${colMap.assigned_to ? _esc2(colMap.assigned_to.label) : 'ASSIGNED TO'}</th>
      <th>${colMap.contact_name ? _esc2(colMap.contact_name.label) : 'CONTACT – FULL NAME'}</th>
      <th>${colMap.case_status ? _esc2(colMap.case_status.label) : 'CASE STATUS'}</th>
      <th>${colMap.age ? _esc2(colMap.age.label) : 'AGE'}</th>
      <th>${colMap.end_user ? _esc2(colMap.end_user.label) : 'END USER'}</th>
      <th>${colMap.type ? _esc2(colMap.type.label) : 'TYPE'}</th>
      <th>${colMap.last_update ? _esc2(colMap.last_update.label) : 'LAST UPDATE DAYS'}</th>
    </tr>`;
    tbl.appendChild(thead);

    // Body
    const tbody = document.createElement('tbody');
    const snaps = []; // Parallel snap array for QBCD modal

    records.forEach(function(record, idx) {
      const recordId = record && (record.rid || record.recordId ||
        (record.fields && Object.values(record.fields)[0] && Object.values(record.fields)[0].value));
      const caseNum = colMap.case_num ? _cellVal(record, colMap.case_num.id) : String(recordId || '');

      // Build snap for QBCD modal (same structure as my_quickbase snaps)
      const snap = {
        recordId: String(caseNum || recordId || idx + 1),
        fields:   record && record.fields ? record.fields : {},
        columnMap: (columns || []).reduce(function(acc, c) {
          acc[String(c.id)] = String(c.label || c.id || '');
          return acc;
        }, {}),
      };
      snaps.push(snap);

      const notes = colMap.case_notes ? _cellVal(record, colMap.case_notes.id) : '';
      const notesTrunc = notes.length > 120 ? notes.slice(0, 120) + '…' : notes;

      const tr = document.createElement('tr');
      tr.dataset.snapIdx = String(idx);
      tr.innerHTML = `
        <td class="__ep-rn">
          <button class="__ep-rn-btn" data-snap-idx="${idx}" title="View case details — Case# ${_esc2(caseNum)}">${idx + 1}</button>
        </td>
        <td style="font-weight:700;color:#22d3ee;letter-spacing:.03em;font-family:'JetBrains Mono',monospace">${_esc2(caseNum)}</td>
        <td class="__ep-desc-cell"><span class="__ep-overflow">${_esc2(colMap.description ? _cellVal(record, colMap.description.id) : '')}</span></td>
        <td class="__ep-notes-cell"><span style="display:block;max-height:52px;overflow:hidden;font-size:11px;line-height:1.45">${_esc2(notesTrunc)}</span></td>
        <td>${_esc2(colMap.assigned_to ? _cellVal(record, colMap.assigned_to.id) : '')}</td>
        <td>${_esc2(colMap.contact_name ? _cellVal(record, colMap.contact_name.id) : '')}</td>
        <td>${_statusBadge(colMap.case_status ? _cellVal(record, colMap.case_status.id) : '')}</td>
        <td style="white-space:nowrap">${_esc2(_fmtAge(colMap.age ? _cellVal(record, colMap.age.id) : ''))}</td>
        <td>${_esc2(colMap.end_user ? _cellVal(record, colMap.end_user.id) : '')}</td>
        <td>${_esc2(colMap.type ? _cellVal(record, colMap.type.id) : '')}</td>
        <td style="white-space:nowrap">${_esc2(colMap.last_update ? _cellVal(record, colMap.last_update.id) : '')}</td>`;
      tbody.appendChild(tr);
    });
    tbl.appendChild(tbody);

    if (body) {
      body.innerHTML = '';
      body.appendChild(tbl);
    }

    // ── Row-num button click → Case Detail Modal ──────────────────────────
    tbl.addEventListener('click', function(e) {
      const btn = e.target.closest('.__ep-rn-btn');
      if (!btn) return;
      const idx2 = parseInt(btn.getAttribute('data-snap-idx'), 10);
      if (isNaN(idx2) || !snaps[idx2]) return;
      _openQbcdFromDash(snaps[idx2], snaps, idx2);
    });
  }

  function _closeDrillDown() {
    if (_ddPanel) {
      _ddPanel.style.opacity = '0';
      _ddPanel.style.transform = 'translateY(10px)';
      _ddPanel.style.transition = 'opacity .15s,transform .15s';
      setTimeout(function() { try { _ddPanel && _ddPanel.remove(); _ddPanel = null; } catch(_) {} }, 180);
    }
    if (_ddCleanup) { try { _ddCleanup(); } catch(_) {} _ddCleanup = null; }
  }

  // ── Open QBCD Modal from Dashboard (reuse my_quickbase modal via navigation) ─
  function _openQbcdFromDash(snap, allSnaps, idx) {
    // Store snap data for the modal to pick up
    window.__mums_dash_pending_qbcd = { snap: snap, snaps: allSnaps, idx: idx };

    // Strategy: if My QB page is loaded, use its _qbcdOpen directly
    var mainEl = document.getElementById('main');
    if (mainEl && typeof mainEl._qbcdOpen === 'function') {
      // Build temp snap storage so prev/next works
      var host = mainEl.querySelector('#qbDataBody');
      if (host) host._qbRowSnaps = allSnaps;
      mainEl._qbcdOpen(snap, allSnaps);
      return;
    }

    // Navigate to my_quickbase then open
    if (window.App && typeof App.navigate === 'function') {
      App.navigate('my_quickbase');
    }
    var _tryOpen = function() {
      var m = document.getElementById('main');
      if (m && typeof m._qbcdOpen === 'function') {
        var h = m.querySelector('#qbDataBody');
        if (h) h._qbRowSnaps = allSnaps;
        m._qbcdOpen(snap, allSnaps);
        return true;
      }
      return false;
    };
    var retries = 0;
    var retryInterval = setInterval(function() {
      if (_tryOpen() || ++retries >= 10) clearInterval(retryInterval);
    }, 300);
  }

  // ── Patch makePill to be clickable ────────────────────────────────────────
  var _origMakePill = makePill;
  makePill = function(c) {
    var el = _origMakePill(c);
    el.style.cursor = 'pointer';
    el.title = 'Click to view records: ' + (c.label || '');
    el.addEventListener('click', function() {
      openDrillDown(c.id, c.label || 'Records');
    });
    return el;
  };

  // ── Patch makeHero to be clickable ────────────────────────────────────────
  var _origMakeHero = makeHero;
  makeHero = function() {
    var el = _origMakeHero();
    el.style.cursor = 'pointer';
    el.title = 'Click to view all your active cases';
    el.addEventListener('click', function() {
      openDrillDown('__hero__', ctrConfig.hero.label || 'My Active Cases');
    });
    return el;
  };


  // ── kick off ───────────────────────────────────────────────────────────────
  loadAll(false);
});
