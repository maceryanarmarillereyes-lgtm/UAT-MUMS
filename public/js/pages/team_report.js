/**
 * @file team_report.js
 * @description Page: Team Report — daily workload matrix with 3-day case history,
 *   schedule hours, QB tab count and movement deltas. Visible to TEAM_LEAD,
 *   SUPER_USER, SUPER_ADMIN only.
 * @module MUMS/Pages
 * @version UAT-p1-665
 */

(window.Pages = window.Pages || {});

window.Pages.team_report = function (root) {
  root.innerHTML = '<div class="tr-shell"><div class="tr-loading">Loading Team Report…</div></div>';

  (async () => {
    /* ── Auth gate ─────────────────────────────────────────────────────── */
    const me = (window.Auth && Auth.getUser) ? (Auth.getUser() || {}) : {};
    const canView = (window.Config && Config.can) ? Config.can(me, 'view_team_report') : false;
    if (!canView) {
      root.innerHTML = `
        <div class="tr-shell">
          <div class="tr-glass-panel" style="padding:2rem;text-align:center">
            <div style="font-size:2rem;margin-bottom:.5rem">🔒</div>
            <div style="color:#ef4444;font-size:1.1rem;font-weight:600">Access Denied</div>
            <div class="muted" style="margin-top:.5rem">Team Report is restricted to Team Leads, Super Users, and Super Admins.</div>
          </div>
        </div>`;
      return;
    }

    const isLead = me.role === 'TEAM_LEAD';
    const isSuper = me.role === 'SUPER_ADMIN' || me.role === 'SUPER_USER';
    const teams = (Config && Config.TEAMS) ? Config.TEAMS.slice() : [];

    /* ── State ─────────────────────────────────────────────────────────── */
    let selectedTeamId = isLead
      ? String(me.teamId || '')
      : (teams[0] && teams[0].id ? teams[0].id : '');
    let searchQuery = '';
    let sortBy = 'name';
    let sortDir = 'asc';
    let lastData = null;
    let loading = false;
    let autoRefreshTimer = null;

    /* ── Helpers ───────────────────────────────────────────────────────── */
    function esc(s) { return UI && UI.esc ? UI.esc(String(s ?? '')) : String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c)); }

    function fmtDate(iso) {
      if (!iso) return '—';
      try {
        return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
          month: 'short', day: '2-digit', weekday: 'short', timeZone: 'Asia/Manila'
        });
      } catch (_) { return iso; }
    }

    function fmtMins(mins) {
      if (!mins) return '—';
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return m ? `${h}h ${m}m` : `${h}h`;
    }

    function deltaBadge(val) {
      if (val > 0) return `<span class="tr-delta tr-delta-up">▲ ${val}</span>`;
      if (val < 0) return `<span class="tr-delta tr-delta-down">▼ ${Math.abs(val)}</span>`;
      return `<span class="tr-delta tr-delta-flat">— 0</span>`;
    }

    function loadBadge(status) {
      if (status === 'overload') return '<span class="tr-load tr-load-overload">OVERLOAD</span>';
      if (status === 'warning')  return '<span class="tr-load tr-load-warning">WARNING</span>';
      return '<span class="tr-load tr-load-normal">NORMAL</span>';
    }

    function initials(name) {
      return String(name || '?').split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase();
    }

    function avatarColor(name) {
      const colors = ['#3B82F6','#8B5CF6','#06B6D4','#10B981','#F59E0B','#EF4444','#EC4899','#6366F1'];
      let h = 0;
      for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xFFFFFF;
      return colors[Math.abs(h) % colors.length];
    }

    /* ── Inject styles ─────────────────────────────────────────────────── */
    function injectStyles() {
      if (document.getElementById('tr-styles-v1')) return;
      const el = document.createElement('style');
      el.id = 'tr-styles-v1';
      el.textContent = `
        .tr-shell{padding:1.25rem 1.5rem;font-family:inherit;min-height:100vh;background:transparent}
        .tr-loading{color:#94a3b8;padding:2rem;text-align:center;font-size:.95rem}

        /* Header */
        .tr-header{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:.75rem;margin-bottom:1.25rem}
        .tr-title-row{display:flex;align-items:center;gap:.6rem}
        .tr-title{font-size:1.3rem;font-weight:700;color:#f1f5f9;letter-spacing:-.01em;margin:0}
        .tr-badge{display:inline-flex;align-items:center;gap:.3rem;padding:.15rem .5rem;border-radius:.25rem;font-size:.65rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;background:#1e293b;border:1px solid #334155;color:#94a3b8}
        .tr-subtitle{color:#64748b;font-size:.78rem;margin-top:.2rem}
        .tr-live-row{display:flex;align-items:center;gap:.5rem;font-size:.75rem;color:#64748b}
        .tr-live-dot{width:.5rem;height:.5rem;border-radius:50%;background:#22c55e;animation:tr-pulse 2s infinite}
        @keyframes tr-pulse{0%,100%{opacity:1}50%{opacity:.4}}

        /* KPI Row */
        .tr-kpi-row{display:grid;grid-template-columns:repeat(2,1fr);gap:.75rem;margin-bottom:1.25rem}
        @media(min-width:900px){.tr-kpi-row{grid-template-columns:repeat(4,1fr)}}
        .tr-kpi-card{position:relative;background:#1e293b;border:1px solid #334155;border-radius:.75rem;padding:1rem;overflow:hidden;transition:border-color .2s}
        .tr-kpi-card:hover{border-color:#475569}
        .tr-kpi-card--red{border-color:#7f1d1d}
        .tr-kpi-card--red:hover{border-color:#991b1b}
        .tr-kpi-grid-bg{position:absolute;inset:0;background-image:linear-gradient(rgba(148,163,184,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(148,163,184,.03) 1px,transparent 1px);background-size:20px 20px;pointer-events:none}
        .tr-kpi-label{font-size:.65rem;text-transform:uppercase;letter-spacing:.07em;color:#64748b;font-weight:600;margin-bottom:.4rem}
        .tr-kpi-val{font-size:1.8rem;font-weight:700;color:#f1f5f9;line-height:1;letter-spacing:-.03em}
        .tr-kpi-sub{font-size:.72rem;color:#64748b;margin-top:.5rem}
        .tr-kpi-sub--red{color:#f87171}
        .tr-kpi-sub--amber{color:#fbbf24}

        /* Toolbar */
        .tr-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:.75rem;background:#1e293b;border:1px solid #334155;border-radius:.75rem;padding:.6rem 1rem;margin-bottom:1.25rem}
        .tr-toolbar-label{font-size:.72rem;color:#64748b;white-space:nowrap}
        .tr-select{background:#0f172a;border:1px solid #334155;border-radius:.4rem;color:#e2e8f0;font-size:.8rem;padding:.3rem .6rem;outline:none}
        .tr-select:focus{border-color:#3b82f6}
        .tr-search{background:#0f172a;border:1px solid #334155;border-radius:.4rem;color:#e2e8f0;font-size:.8rem;padding:.3rem .6rem .3rem 1.6rem;outline:none;min-width:180px}
        .tr-search:focus{border-color:#3b82f6}
        .tr-search-wrap{position:relative}
        .tr-search-wrap svg{position:absolute;left:.5rem;top:50%;transform:translateY(-50%);color:#64748b;pointer-events:none}
        .tr-divider{width:1px;height:1.2rem;background:#334155;display:none}
        @media(min-width:640px){.tr-divider{display:block}}
        .tr-btn{display:inline-flex;align-items:center;gap:.35rem;background:#0f172a;border:1px solid #334155;border-radius:.4rem;color:#94a3b8;font-size:.75rem;padding:.3rem .65rem;cursor:pointer;transition:all .15s;white-space:nowrap}
        .tr-btn:hover{background:#1e293b;color:#e2e8f0;border-color:#475569}
        .tr-btn--primary{background:#1d4ed8;border-color:#2563eb;color:#fff}
        .tr-btn--primary:hover{background:#1e40af}
        .tr-ml-auto{margin-left:auto}

        /* Table panel */
        .tr-panel{background:#1e293b;border:1px solid #334155;border-radius:.75rem;overflow:hidden;margin-bottom:1.25rem}
        .tr-panel-head{display:flex;align-items:center;justify-content:space-between;padding:.65rem 1rem;background:#0f172a;border-bottom:1px solid #334155}
        .tr-panel-title{display:flex;align-items:center;gap:.5rem;font-size:.78rem;font-weight:600;color:#f1f5f9;text-transform:uppercase;letter-spacing:.06em}
        .tr-panel-icon{width:1.6rem;height:1.6rem;border-radius:.3rem;background:#0f172a;border:1px solid #334155;display:flex;align-items:center;justify-content:center}
        .tr-legend{display:flex;gap:.5rem;flex-wrap:wrap}
        .tr-legend-item{font-size:.65rem;padding:.12rem .4rem;border-radius:.2rem;font-weight:500}
        .tr-legend-normal{background:rgba(34,197,94,.12);color:#4ade80;border:1px solid rgba(34,197,94,.2)}
        .tr-legend-warning{background:rgba(251,191,36,.12);color:#fbbf24;border:1px solid rgba(251,191,36,.2)}
        .tr-legend-overload{background:rgba(239,68,68,.12);color:#f87171;border:1px solid rgba(239,68,68,.2)}

        /* Table */
        .tr-table-wrap{overflow-x:auto}
        .tr-table{width:100%;border-collapse:collapse;font-size:.8rem}
        .tr-table thead{background:rgba(15,23,42,.7);position:sticky;top:0;z-index:10}
        .tr-table th{padding:.55rem .75rem;text-align:left;font-size:.65rem;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:#64748b;white-space:nowrap;border-bottom:1px solid #334155;cursor:pointer;user-select:none}
        .tr-table th:hover{color:#94a3b8}
        .tr-table th.th-center{text-align:center}
        .tr-table th .sort-arrow{opacity:.3;margin-left:.25rem;font-size:.7rem}
        .tr-table th.sort-active{color:#93c5fd}
        .tr-table th.sort-active .sort-arrow{opacity:1;color:#60a5fa}
        .tr-table tbody tr{border-bottom:1px solid rgba(51,65,85,.5);transition:background .12s}
        .tr-table tbody tr:hover{background:rgba(51,65,85,.35)}
        .tr-table tbody tr:last-child{border-bottom:none}
        .tr-table td{padding:.55rem .75rem;color:#cbd5e1;vertical-align:middle}
        .tr-table td.td-center{text-align:center}
        .tr-table .td-num{font-variant-numeric:tabular-nums;font-weight:600;color:#f1f5f9}
        .tr-table .td-muted{color:#475569;font-size:.75rem}

        /* Member cell */
        .tr-member-cell{display:flex;align-items:center;gap:.6rem}
        .tr-avatar{width:1.75rem;height:1.75rem;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.6rem;font-weight:700;color:#fff;flex-shrink:0;letter-spacing:.02em}
        .tr-member-name{font-weight:600;color:#f1f5f9;font-size:.82rem}
        .tr-member-user{color:#64748b;font-size:.7rem}

        /* Load badge */
        .tr-load{display:inline-block;padding:.1rem .4rem;border-radius:.2rem;font-size:.6rem;font-weight:700;letter-spacing:.06em}
        .tr-load-normal{background:rgba(34,197,94,.12);color:#4ade80;border:1px solid rgba(34,197,94,.25)}
        .tr-load-warning{background:rgba(251,191,36,.12);color:#fbbf24;border:1px solid rgba(251,191,36,.25)}
        .tr-load-overload{background:rgba(239,68,68,.12);color:#f87171;border:1px solid rgba(239,68,68,.25)}

        /* Delta badges */
        .tr-delta{display:inline-block;padding:.08rem .35rem;border-radius:.2rem;font-size:.68rem;font-weight:600}
        .tr-delta-up{background:rgba(34,197,94,.1);color:#4ade80}
        .tr-delta-down{background:rgba(239,68,68,.1);color:#f87171}
        .tr-delta-flat{background:rgba(100,116,139,.1);color:#64748b}

        /* Date headers strip */
        .tr-date-strip{display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:1.25rem}
        .tr-date-chip{display:flex;flex-direction:column;align-items:center;padding:.4rem .8rem;background:#1e293b;border:1px solid #334155;border-radius:.5rem;min-width:90px}
        .tr-date-chip.today{border-color:#3b82f6;background:rgba(59,130,246,.07)}
        .tr-date-chip-label{font-size:.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#64748b}
        .tr-date-chip-date{font-size:.8rem;color:#e2e8f0;margin-top:.1rem}
        .tr-date-chip.today .tr-date-chip-label{color:#60a5fa}
        .tr-date-chip.today .tr-date-chip-date{color:#93c5fd}

        /* QB bar */
        .tr-qb-bar{display:flex;align-items:center;gap:.3rem}
        .tr-qb-tab-dot{width:.45rem;height:.45rem;border-radius:50%;background:#3b82f6;opacity:.8}

        /* Empty state */
        .tr-empty{padding:3rem 1rem;text-align:center;color:#64748b;font-size:.85rem}
        .tr-empty-icon{font-size:2rem;margin-bottom:.5rem;opacity:.5}

        /* Skeleton */
        .tr-skel{background:linear-gradient(90deg,#1e293b 25%,#263148 50%,#1e293b 75%);background-size:200% 100%;animation:tr-skel-anim 1.4s infinite;border-radius:.3rem;height:.8rem;display:inline-block}
        @keyframes tr-skel-anim{0%{background-position:200% 0}100%{background-position:-200% 0}}

        /* Footer meta */
        .tr-meta{font-size:.7rem;color:#475569;display:flex;align-items:center;gap:1rem;flex-wrap:wrap;margin-top:.5rem}
        .tr-meta-dot{width:.35rem;height:.35rem;border-radius:50%;background:#22c55e}
        .tr-panel-subhead{display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem;padding:.5rem 1rem;background:rgba(15,23,42,.4);border-bottom:1px solid #1e293b}
        .tr-day-col-head{text-align:center;font-size:.65rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#475569;padding:.2rem 0}
        .tr-day-col-head.is-today{color:#60a5fa}
      `;
      document.head.appendChild(el);
    }

    /* ── Fetch ─────────────────────────────────────────────────────────── */
    async function fetchReport() {
      loading = true;
      render();
      const headers = {};
      const jwt = (window.CloudAuth && CloudAuth.accessToken) ? CloudAuth.accessToken() : '';
      if (jwt) headers['Authorization'] = `Bearer ${jwt}`;
      const params = new URLSearchParams();
      if (selectedTeamId) params.set('team_id', selectedTeamId);

      try {
        const res = await fetch(`/api/team_report?${params}`, { headers });
        const json = await res.json().catch(() => ({ ok: false }));
        if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to load team report.');
        lastData = json;
      } catch (e) {
        lastData = { ok: false, error: String(e.message || e) };
      } finally {
        loading = false;
        render();
      }
    }

    /* ── Sort helpers ──────────────────────────────────────────────────── */
    function sortMembers(members) {
      const dir = sortDir === 'desc' ? -1 : 1;
      return [...members].sort((a, b) => {
        switch (sortBy) {
          case 'name':         return String(a.name).localeCompare(String(b.name)) * dir;
          case 'totalAssigned':return (a.totalAssigned - b.totalAssigned) * dir;
          case 'casesToday':   return (a.casesToday - b.casesToday) * dir;
          case 'casesD1':      return (a.casesD1 - b.casesD1) * dir;
          case 'casesD2':      return (a.casesD2 - b.casesD2) * dir;
          case 'deltaD1':      return (a.deltaD1 - b.deltaD1) * dir;
          case 'totalH':       return (a.totalH - b.totalH) * dir;
          case 'qbTabs':       return (a.qbTabs - b.qbTabs) * dir;
          case 'load':         return (['normal','warning','overload'].indexOf(a.loadStatus) - ['normal','warning','overload'].indexOf(b.loadStatus)) * dir;
          default:             return 0;
        }
      });
    }

    function thSort(col, label) {
      const active = sortBy === col;
      const arrow = active ? (sortDir === 'asc' ? '▲' : '▼') : '▲';
      return `<th class="th-center${active ? ' sort-active' : ''}" data-sort="${col}">${label}<span class="sort-arrow">${arrow}</span></th>`;
    }

    /* ── Render ────────────────────────────────────────────────────────── */
    function render() {
      injectStyles();
      const scrollY = window.scrollY;

      const dates = lastData && lastData.dates ? lastData.dates : {};
      const kpis  = lastData && lastData.kpis  ? lastData.kpis  : {};
      const todayIso = dates.today || '';
      const d1Iso    = dates.d1    || '';
      const d2Iso    = dates.d2    || '';

      let rawMembers = (lastData && Array.isArray(lastData.members)) ? lastData.members : [];
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        rawMembers = rawMembers.filter(m =>
          String(m.name || '').toLowerCase().includes(q) ||
          String(m.username || '').toLowerCase().includes(q)
        );
      }
      const members = sortMembers(rawMembers);

      /* Team selector options */
      const teamOpts = isLead
        ? `<option value="${esc(me.teamId)}" selected>${esc(me.teamId)}</option>`
        : teams.map(t => `<option value="${esc(t.id)}" ${t.id === selectedTeamId ? 'selected' : ''}>${esc(t.name || t.id)}</option>`).join('');

      /* KPI cards */
      const kpiCards = `
        <div class="tr-kpi-row">
          <div class="tr-kpi-card">
            <div class="tr-kpi-grid-bg"></div>
            <div class="tr-kpi-label">Team Members</div>
            <div class="tr-kpi-val">${loading ? '<span class="tr-skel" style="width:3rem"></span>' : esc(kpis.totalMembers ?? rawMembers.length ?? 0)}</div>
            <div class="tr-kpi-sub">Active in team</div>
          </div>
          <div class="tr-kpi-card">
            <div class="tr-kpi-grid-bg"></div>
            <div class="tr-kpi-label">Cases Today</div>
            <div class="tr-kpi-val">${loading ? '<span class="tr-skel" style="width:3rem"></span>' : esc(kpis.totalCasesToday ?? 0)}</div>
            <div class="tr-kpi-sub tr-kpi-sub--amber">
              ${(kpis.totalCasesD1 != null && !loading)
                ? `${kpis.totalCasesToday >= kpis.totalCasesD1 ? '▲' : '▼'} ${Math.abs((kpis.totalCasesToday||0)-(kpis.totalCasesD1||0))} vs yesterday`
                : 'vs yesterday'}
            </div>
          </div>
          <div class="tr-kpi-card${(kpis.overloaded > 0) ? ' tr-kpi-card--red' : ''}">
            <div class="tr-kpi-grid-bg"></div>
            <div class="tr-kpi-label">Overloaded</div>
            <div class="tr-kpi-val">${loading ? '<span class="tr-skel" style="width:3rem"></span>' : esc(kpis.overloaded ?? 0)}</div>
            <div class="tr-kpi-sub${(kpis.overloaded > 0) ? ' tr-kpi-sub--red' : ''}">members at overload</div>
          </div>
          <div class="tr-kpi-card">
            <div class="tr-kpi-grid-bg"></div>
            <div class="tr-kpi-label">Avg Cases / Member</div>
            <div class="tr-kpi-val">${loading ? '<span class="tr-skel" style="width:3rem"></span>' : esc(kpis.avgCasesPerMember ?? 0)}</div>
            <div class="tr-kpi-sub">Total assigned average</div>
          </div>
        </div>`;

      /* Date chips */
      const dateStrip = `
        <div class="tr-date-strip">
          <div class="tr-date-chip">
            <div class="tr-date-chip-label">D–2</div>
            <div class="tr-date-chip-date">${fmtDate(d2Iso)}</div>
          </div>
          <div class="tr-date-chip">
            <div class="tr-date-chip-label">Yesterday</div>
            <div class="tr-date-chip-date">${fmtDate(d1Iso)}</div>
          </div>
          <div class="tr-date-chip today">
            <div class="tr-date-chip-label">Today ●</div>
            <div class="tr-date-chip-date">${fmtDate(todayIso)}</div>
          </div>
        </div>`;

      /* Table rows */
      let tableBody = '';
      if (loading) {
        tableBody = Array.from({ length: 5 }).map(() => `
          <tr>
            ${Array.from({length:11}).map(()=>`<td><span class="tr-skel" style="width:${50+Math.random()*40}%"></span></td>`).join('')}
          </tr>`).join('');
      } else if (!members.length) {
        tableBody = `<tr><td colspan="11"><div class="tr-empty"><div class="tr-empty-icon">👥</div>${searchQuery ? 'No members match your search.' : 'No members found for this team.'}</div></td></tr>`;
      } else {
        tableBody = members.map(m => {
          const bg = avatarColor(m.name);
          const ini = initials(m.name);
          const qbDots = Math.min(m.qbTabs, 5);
          const qbStr = qbDots > 0
            ? Array.from({length:qbDots}).map(()=>'<span class="tr-qb-tab-dot"></span>').join('')
            : '<span style="color:#475569;font-size:.72rem">—</span>';

          return `
          <tr>
            <td>
              <div class="tr-member-cell">
                <div class="tr-avatar" style="background:${bg}">${ini}</div>
                <div>
                  <div class="tr-member-name">${esc(m.name)}</div>
                  <div class="tr-member-user">@${esc(m.username)}</div>
                </div>
              </div>
            </td>
            <td class="td-center td-num">${esc(m.totalAssigned)}</td>
            <td class="td-center td-num">${esc(m.casesD2)}</td>
            <td class="td-center td-num">${esc(m.casesD1)}</td>
            <td class="td-center td-num" style="color:#93c5fd">${esc(m.casesToday)}</td>
            <td class="td-center">${deltaBadge(m.deltaD1)}</td>
            <td class="td-center">${deltaBadge(m.deltaD2)}</td>
            <td class="td-center">
              <div class="tr-qb-bar" style="justify-content:center" title="${m.qbTabs} QB tab(s) configured">
                ${qbStr}
                <span style="color:#64748b;font-size:.7rem;margin-left:.25rem">${m.qbTabs}</span>
              </div>
            </td>
            <td class="td-center td-muted">${m.totalH ? `<span style="color:#94a3b8">${m.totalH}h</span>` : '—'}</td>
            <td class="td-center td-muted">${fmtMins(m.mailboxMins)}</td>
            <td class="td-center">${loadBadge(m.loadStatus)}</td>
          </tr>`;
        }).join('');
      }

      /* Summary row */
      const totalRow = (!loading && members.length > 1) ? `
        <tfoot>
          <tr style="background:rgba(15,23,42,.5);border-top:1px solid #334155">
            <td style="color:#64748b;font-size:.72rem;padding:.5rem .75rem;font-weight:600">TEAM TOTAL</td>
            <td class="td-center td-num">${members.reduce((s,m)=>s+m.totalAssigned,0)}</td>
            <td class="td-center td-num">${members.reduce((s,m)=>s+m.casesD2,0)}</td>
            <td class="td-center td-num">${members.reduce((s,m)=>s+m.casesD1,0)}</td>
            <td class="td-center td-num" style="color:#93c5fd">${members.reduce((s,m)=>s+m.casesToday,0)}</td>
            <td class="td-center">—</td>
            <td class="td-center">—</td>
            <td class="td-center td-num">${members.reduce((s,m)=>s+m.qbTabs,0)}</td>
            <td class="td-center" style="color:#94a3b8">${members.length ? (members.reduce((s,m)=>s+m.totalH,0)/members.length).toFixed(1)+'h avg' : '—'}</td>
            <td class="td-center">—</td>
            <td class="td-center">—</td>
          </tr>
        </tfoot>` : '';

      const now = new Date();
      const nowStr = now.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', timeZone:'Asia/Manila' });

      root.innerHTML = `
        <div class="tr-shell">
          <!-- Header -->
          <div class="tr-header">
            <div>
              <div class="tr-title-row">
                <h1 class="tr-title">Team Report</h1>
                <span class="tr-badge">📋 Daily Brief</span>
              </div>
              <div class="tr-subtitle">Workload matrix, case history &amp; movement tracking for daily standups</div>
            </div>
            <div class="tr-live-row">
              <div class="tr-live-dot"></div>
              <span>Live</span>
              <span style="color:#334155">•</span>
              <span>Updated ${esc(nowStr)} MNL</span>
            </div>
          </div>

          <!-- KPI Cards -->
          ${kpiCards}

          <!-- Date context -->
          ${dateStrip}

          <!-- Main Matrix -->
          <div class="tr-panel">
            <div class="tr-panel-head">
              <div class="tr-panel-title">
                <div class="tr-panel-icon">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2">
                    <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                    <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
                  </svg>
                </div>
                Member Workload Matrix
              </div>
              <div class="tr-legend">
                <span class="tr-legend-item tr-legend-normal">Normal</span>
                <span class="tr-legend-item tr-legend-warning">Warning ≥10</span>
                <span class="tr-legend-item tr-legend-overload">Overload ≥15</span>
              </div>
            </div>

            <!-- Toolbar -->
            <div class="tr-toolbar">
              ${!isLead ? `
                <span class="tr-toolbar-label">Team</span>
                <select class="tr-select" id="trTeamSelect">${teamOpts}</select>
                <div class="tr-divider"></div>
              ` : ''}
              <div class="tr-search-wrap">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                <input class="tr-search" id="trSearch" placeholder="Search member…" value="${esc(searchQuery)}">
              </div>
              <div class="tr-divider"></div>
              <span class="tr-toolbar-label">Sort:</span>
              <select class="tr-select" id="trSort">
                <option value="name"         ${sortBy==='name'?'selected':''}>Name</option>
                <option value="totalAssigned" ${sortBy==='totalAssigned'?'selected':''}>Total Assigned</option>
                <option value="casesToday"    ${sortBy==='casesToday'?'selected':''}>Cases Today</option>
                <option value="deltaD1"       ${sortBy==='deltaD1'?'selected':''}>Movement Δ1D</option>
                <option value="totalH"        ${sortBy==='totalH'?'selected':''}>Sched Hours</option>
                <option value="qbTabs"        ${sortBy==='qbTabs'?'selected':''}>QB Tabs</option>
                <option value="load"          ${sortBy==='load'?'selected':''}>Load Status</option>
              </select>
              <button class="tr-btn" id="trSortDir" title="Toggle direction">
                ${sortDir==='asc'?'▲ ASC':'▼ DESC'}
              </button>
              <div class="tr-ml-auto"></div>
              <button class="tr-btn tr-btn--primary" id="trRefresh">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
                Refresh
              </button>
            </div>

            <!-- Table -->
            <div class="tr-table-wrap">
              <table class="tr-table" id="trTable">
                <thead>
                  <tr>
                    <th data-sort="name" class="${sortBy==='name'?'sort-active':''}">Member<span class="sort-arrow">${sortBy==='name'?(sortDir==='asc'?'▲':'▼'):'▲'}</span></th>
                    ${thSort('totalAssigned','Total Assigned')}
                    ${thSort('casesD2', 'Cases D–2')}
                    ${thSort('casesD1', 'Cases D–1')}
                    ${thSort('casesToday', 'Cases Today')}
                    ${thSort('deltaD1', 'Δ 1D')}
                    ${thSort('deltaD2', 'Δ 2D')}
                    ${thSort('qbTabs', 'QB Tabs')}
                    ${thSort('totalH', 'Sched Hrs')}
                    <th class="th-center">Mailbox</th>
                    ${thSort('load', 'Load Status')}
                  </tr>
                </thead>
                <tbody>${tableBody}</tbody>
                ${totalRow}
              </table>
            </div>
          </div>

          <!-- Meta footer -->
          <div class="tr-meta">
            <div style="display:flex;align-items:center;gap:.35rem">
              <div class="tr-meta-dot"></div>
              <span>Showing ${members.length} member${members.length!==1?'s':''} ${searchQuery?`matching "${esc(searchQuery)}"`:''}</span>
            </div>
            <span>•</span>
            <span>Cases: counted from assigned date in ums_cases</span>
            <span>•</span>
            <span>Δ = today's cases minus prior day's cases</span>
            <span>•</span>
            <span>Load: Normal &lt;10 | Warning ≥10 | Overload ≥15 total assigned</span>
          </div>
        </div>`;

      /* ── Event bindings ───────────────────────────────────────────── */
      const teamSel = document.getElementById('trTeamSelect');
      if (teamSel) {
        teamSel.addEventListener('change', () => {
          selectedTeamId = teamSel.value;
          fetchReport();
        });
      }

      const searchEl = document.getElementById('trSearch');
      let searchTimer;
      if (searchEl) {
        searchEl.addEventListener('input', () => {
          clearTimeout(searchTimer);
          searchTimer = setTimeout(() => {
            searchQuery = searchEl.value;
            render();
          }, 280);
        });
      }

      const sortSel = document.getElementById('trSort');
      if (sortSel) {
        sortSel.addEventListener('change', () => {
          sortBy = sortSel.value;
          render();
        });
      }

      const sortDirBtn = document.getElementById('trSortDir');
      if (sortDirBtn) {
        sortDirBtn.addEventListener('click', () => {
          sortDir = sortDir === 'asc' ? 'desc' : 'asc';
          render();
        });
      }

      const refreshBtn = document.getElementById('trRefresh');
      if (refreshBtn) {
        refreshBtn.addEventListener('click', () => fetchReport());
      }

      // Column header sort
      const table = document.getElementById('trTable');
      if (table) {
        table.querySelectorAll('th[data-sort]').forEach(th => {
          th.addEventListener('click', () => {
            const col = th.dataset.sort;
            if (sortBy === col) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
            else { sortBy = col; sortDir = 'asc'; }
            render();
          });
        });
      }

      window.scrollTo(0, scrollY);
    }

    /* ── Auto-refresh every 5 min ──────────────────────────────────────── */
    function startAutoRefresh() {
      if (autoRefreshTimer) clearInterval(autoRefreshTimer);
      autoRefreshTimer = setInterval(() => {
        if (document.visibilityState !== 'hidden') fetchReport();
      }, 5 * 60 * 1000);
    }

    // Clean up on page change
    const origNav = window.navigateToPageId;
    if (typeof origNav === 'function') {
      const cleanup = () => {
        if (autoRefreshTimer) clearInterval(autoRefreshTimer);
        document.removeEventListener('visibilitychange', cleanup);
      };
      document.addEventListener('visibilitychange', cleanup, { once: true });
    }

    /* ── Boot ──────────────────────────────────────────────────────────── */
    injectStyles();
    render(); // Skeleton
    await fetchReport();
    startAutoRefresh();

  })();
};
