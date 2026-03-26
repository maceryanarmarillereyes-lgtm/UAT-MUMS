/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */
(window.Pages = window.Pages || {}, window.Pages.dashboard = function (root) {
  const me = (window.Auth && Auth.getUser) ? (Auth.getUser() || {}) : {};
  const role = String(me.role || '').toUpperCase();
  const isLeadView = role === 'TEAM_LEAD' || role === 'ADMIN' || role === 'SUPER_ADMIN' || role === 'SUPER_USER';

  function shiftIcon(shift) {
    const s = String(shift || '').toLowerCase();
    if (s.includes('morning')) return '☀️';
    if (s.includes('night')) return '🌙';
    if (s.includes('mid')) return '⛅';
    return '🕘';
  }

  function normalizeTeamLabel(raw) {
    const src = String(raw || '').trim();
    if (!src) return '';
    const key = src.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!key || key === 'n/a' || key === 'na' || key === 'none' || key === 'null' || key === 'undefined') return '';
    if (key === 'mid' || key === 'mid shift') return 'Mid Shift';
    if (key === 'morning' || key === 'morning shift') return 'Morning Shift';
    if (key === 'night' || key === 'night shift') return 'Night Shift';
    return src
      .split(/\s+/)
      .map((p) => p ? (p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()) : '')
      .join(' ')
      .trim();
  }

  function isShiftActive(shift) {
    const now = new Date();
    const hour = Number(now.getHours());
    const s = String(shift || '').toLowerCase();
    if (s.includes('morning')) return hour >= 6 && hour < 14;
    if (s.includes('mid')) return hour >= 14 && hour < 22;
    if (s.includes('night')) return hour >= 22 || hour < 6;
    return true;
  }

  function groupRows(rows) {
    const by = {};
    (rows || []).forEach((row) => {
      const dist = String(row.distribution_title || 'Untitled Distribution');
      const member = String(row.member_name || 'Unknown Member');
      const key = `${dist}__${member}`;
      if (!by[key]) by[key] = {
        distribution_title: dist,
        member_name: member,
        member_shift: normalizeTeamLabel(row.member_shift),
        total: 0,
        done: 0,
        pending: 0,
        last_update: row.last_update || null
      };
      by[key].total += 1;
      if (String(row.task_status || '').toUpperCase() === 'DONE') by[key].done += 1;
      if (String(row.task_status || '').toUpperCase() === 'PENDING') by[key].pending += 1;
      if (row.last_update && (!by[key].last_update || new Date(row.last_update).getTime() > new Date(by[key].last_update).getTime())) {
        by[key].last_update = row.last_update;
      }
    });
    return Object.values(by).sort((a, b) => String(a.distribution_title).localeCompare(String(b.distribution_title)) || String(a.member_name).localeCompare(String(b.member_name)));
  }

  async function mountTeamWorkloadPulse() {
    if (!isLeadView) return;
    let state = { rows: [], filter: '', shiftFilter: '', subscription: null, refreshLock: false, observer: null };
    const isSuperAdminView = role === 'SUPER_ADMIN';

    const formatTs = (iso) => {
      if (!iso) return 'N/A';
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return 'N/A';
      return d.toLocaleString('en-PH', { hour12: true, year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    };

    const ensureHostMount = () => {
      const host = root.querySelector('.dashx');
      if (!host) return null;
      let mount = root.querySelector('#teamWorkloadPulseMount');
      if (!mount) {
        mount = document.createElement('div');
        mount.id = 'teamWorkloadPulseMount';
        mount.className = 'dashx-panel twp-enterprise';
        host.appendChild(mount);
      }
      return mount;
    };

    const renderWidget = () => {
      const mount = ensureHostMount();
      if (!mount) return;

      const grouped = groupRows(state.rows);
      const shiftOptions = Array.from(new Set(grouped
        .map((r) => normalizeTeamLabel(r.member_shift))
        .filter(Boolean)))
        .sort((a, b) => String(a).localeCompare(String(b)));

      if (state.shiftFilter && !shiftOptions.includes(state.shiftFilter)) state.shiftFilter = '';

      const shownByShift = state.shiftFilter
        ? grouped.filter((g) => normalizeTeamLabel(g.member_shift) === state.shiftFilter)
        : grouped;
      const shown = state.filter ? shownByShift.filter((g) => String(g.distribution_title || '') === state.filter) : shownByShift;
      const titles = Array.from(new Set(grouped.map((r) => String(r.distribution_title || '').trim()).filter(Boolean))).sort();
      const byDist = shown.reduce((acc, row) => {
        const key = row.distribution_title;
        if (!acc[key]) acc[key] = [];
        acc[key].push(row);
        return acc;
      }, {});

      const totalTasks = shown.reduce((n, r) => n + Number(r.total || 0), 0);
      const completedTasks = shown.reduce((n, r) => n + Number(r.done || 0), 0);
      const completion = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
      const scopeText = role === 'SUPER_ADMIN' || role === 'SUPER_USER' ? 'All teams view' : 'My team only';

      mount.innerHTML = `
        <div class="ux-card twp-shell">
          <div class="row twp-header">
            <div class="twp-title-wrap">
              <div class="dashx-title">Team Workload Pulse</div>
              <div class="small muted">Enterprise operations view • ${UI.esc(scopeText)} • ${UI.esc(shown.length)} active members</div>
            </div>
            <div class="twp-toolbar">
              <span class="badge">Tasks: ${UI.esc(totalTasks)}</span>
              <span class="badge ok">Done: ${UI.esc(completedTasks)}</span>
              <span class="badge ${completion >= 80 ? 'ok' : completion >= 40 ? 'warn' : ''}">Completion: ${UI.esc(completion)}%</span>
              ${isSuperAdminView ? `
                <select id="twpShiftFilter" class="ux-focusable twp-select" title="Filter workload by team shift">
                  <option value="">All details</option>
                  ${shiftOptions.map((s) => `<option value="${UI.esc(s)}" ${state.shiftFilter === s ? 'selected' : ''}>${UI.esc(s)}</option>`).join('')}
                </select>
              ` : ''}
              <select id="twpFilter" class="ux-focusable twp-select">
                <option value="">All Active Tasks</option>
                ${titles.map((t) => `<option value="${UI.esc(t)}" ${state.filter === t ? 'selected' : ''}>${UI.esc(t)}</option>`).join('')}
              </select>
            </div>
          </div>

          <div class="twp-list">
            ${Object.keys(byDist).map((dist) => `
              <div class="card pad twp-dist-card">
                <div class="small twp-dist-head">
                  <b>${UI.esc(dist)}</b>
                  <span class="muted">${UI.esc(byDist[dist].length)} members contributing</span>
                </div>
                <div class="twp-table-wrap">
                <table class="table twp-table">
                  <thead>
                    <tr><th>Member</th><th>Workload</th><th>Progress</th><th>Status</th><th>Last Update</th></tr>
                  </thead>
                  <tbody>
                    ${byDist[dist].map((row) => {
                      const progress = row.total ? Math.round((row.done / row.total) * 100) : 0;
                      const active = isShiftActive(row.member_shift);
                      let label = 'In Progress';
                      let cls = 'badge';
                      if (row.pending > 0 && !active) { label = 'Waiting for Shift'; cls = 'badge'; }
                      else if (row.pending > 0 && active) { label = 'Overdue/Pending'; cls = 'badge warn'; }
                      else if (progress >= 100) { label = 'Completed'; cls = 'badge ok'; }
                      return `
                        <tr>
                          <td>${UI.esc(row.member_name)} <span class="badge">${UI.esc(shiftIcon(row.member_shift || ''))} ${UI.esc(row.member_shift || '—')}</span></td>
                          <td>${UI.esc(row.total)} items</td>
                          <td>
                            <div class="twp-progress-track">
                              <div style="height:100%;width:${Math.max(0, Math.min(100, progress))}%;background:linear-gradient(90deg,#22c55e,#0ea5e9)"></div>
                            </div>
                            <div class="small muted" style="margin-top:4px">${UI.esc(progress)}%</div>
                          </td>
                          <td><span class="${cls}">${UI.esc(label)}</span></td>
                          <td class="small muted">${UI.esc(formatTs(row.last_update))}</td>
                        </tr>
                      `;
                    }).join('') || '<tr><td colspan="5" class="muted">No workload rows for this distribution.</td></tr>'}
                  </tbody>
                </table>
                </div>
              </div>
            `).join('') || '<div class="small muted">No workload matrix data found.</div>'}
          </div>
        </div>
      `;

      const filterEl = root.querySelector('#twpFilter');
      if (filterEl) {
        filterEl.onchange = () => {
          state.filter = String(filterEl.value || '').trim();
          refreshData();
        };
      }

      const shiftFilterEl = root.querySelector('#twpShiftFilter');
      if (shiftFilterEl) {
        shiftFilterEl.onchange = () => {
          state.shiftFilter = String(shiftFilterEl.value || '').trim();
          renderWidget();
        };
      }
    };

    const refreshData = async () => {
      if (state.refreshLock) return;
      state.refreshLock = true;
      const out = await CloudTasks.workloadMatrix(state.filter);
      state.refreshLock = false;
      state.rows = out.ok ? (out.data.rows || []) : [];
      renderWidget();
    };

    const ensureRealtime = async () => {
      try {
        const env = (window.EnvRuntime && EnvRuntime.env) ? EnvRuntime.env() : (window.MUMS_ENV || {});
        const sbUrl = String(env.SUPABASE_URL || '');
        const sbAnon = String(env.SUPABASE_ANON_KEY || '');
        if (!window.supabase || !sbUrl || !sbAnon) return;
        if (state.subscription) return;

        const token = (window.CloudAuth && CloudAuth.accessToken) ? CloudAuth.accessToken() : '';
        if (!token) return;

        if (!window.__MUMS_SB_CLIENT) {
          const dummyStorage = { getItem() { return null; }, setItem() { }, removeItem() { } };
          window.__MUMS_SB_CLIENT = window.supabase.createClient(sbUrl, sbAnon, {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storage: dummyStorage, storageKey: 'mums_shared' },
            realtime: { params: { eventsPerSecond: 10 } },
            global: { headers: { Authorization: 'Bearer ' + token } }
          });
        }

        const client = window.__MUMS_SB_CLIENT;
        if (token && client && client.realtime && typeof client.realtime.setAuth === 'function') client.realtime.setAuth(token);

        state.subscription = client
          .channel('team-workload-pulse')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'task_items' }, () => refreshData())
          .subscribe();
      } catch (_) { }
    };

    const prevCleanup = root._cleanup;
    root._cleanup = () => {
      try { if (prevCleanup) prevCleanup(); } catch (_) { }
      try { if (state.observer) state.observer.disconnect(); } catch (_) { }
      try {
        const client = window.__MUMS_SB_CLIENT;
        if (state.subscription && client) client.removeChannel(state.subscription);
      } catch (_) { }
      state.subscription = null;
      state.observer = null;
    };

    try {
      state.observer = new MutationObserver(() => {
        try {
          if (!root.querySelector('#teamWorkloadPulseMount') && root.querySelector('.dashx')) renderWidget();
        } catch (_) { }
      });
      state.observer.observe(root, { childList: true, subtree: true });
    } catch (_) { }

    await refreshData();
    await ensureRealtime();
  }

  try {
    if (window.UI && typeof UI.renderDashboard === 'function') {
      UI.renderDashboard(root);
      mountTeamWorkloadPulse().catch(() => { });
      return;
    }
  } catch (e) { try { console.error(e); } catch (_) { } }

  const team = (window.Config && Config.teamById && me.teamId) ? Config.teamById(me.teamId) : null;
  root.innerHTML = `
    <h2 style="margin:0 0 10px">Dashboard</h2>
    <div class="card pad">
      <div class="small muted">Fallback dashboard renderer used. UI.renderDashboard() was not available.</div>
      <div style="margin-top:8px">User: <b>${UI.esc(me.fullName || me.name || me.username || 'User')}</b></div>
      <div class="small muted" style="margin-top:2px">Role: ${UI.esc(me.role || '')}</div>
      <div class="small muted">Team: ${UI.esc(team ? (team.label || team.id) : (me.teamId || ''))}</div>
    </div>
  `;
});
