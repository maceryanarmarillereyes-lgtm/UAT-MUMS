/**
 * @file team_report.js
 * @description Page: Team Report — Power BI–style dashboard.
 *   Member workload matrix, Chart.js case movement chart, QB timeline.
 * @module MUMS/Pages
 * @version UAT-p1-667
 */
(window.Pages = window.Pages || {});

window.Pages.team_report = function (root) {
  root.innerHTML = '<div class="tr2-shell"><div class="tr2-boot">Loading Team Report…</div></div>';

  (async () => {
    /* ── Auth gate ─────────────────────────────────────────────────────── */
    const me = (window.Auth && Auth.getUser) ? (Auth.getUser() || {}) : {};
    const canView = (window.Config && Config.can) ? Config.can(me, 'view_team_report') : false;
    if (!canView) {
      root.innerHTML = `<div class="tr2-shell"><div class="tr2-deny">
        <div style="font-size:2rem">🔒</div>
        <div style="color:#ef4444;font-weight:700;margin-top:.5rem">Access Denied</div>
        <div style="color:#64748b;margin-top:.25rem;font-size:.85rem">Team Report is restricted to Team Leads, Super Users, and Super Admins.</div>
        <div style="margin-top:.75rem;font-size:.7rem;color:#475569;border:1px solid #1e293b;padding:.3rem .6rem;border-radius:.3rem;display:inline-flex;align-items:center;gap:.4rem">
          🔒 Visible only to TEAM_LEAD, SUPER_USER, SUPER_ADMIN
        </div>
      </div></div>`;
      return;
    }

    const isLead  = me.role === 'TEAM_LEAD';
    const teams   = (Config && Config.TEAMS) ? Config.TEAMS.slice() : [];

    /* ── State ─────────────────────────────────────────────────────────── */
    let selectedTeamId = isLead ? String(me.teamId || '') : (teams[0] ? teams[0].id : '');
    let searchQuery    = '';
    let lastData       = null;
    let loading        = false;
    let autoTimer      = null;
    let chartLine      = null;
    let chartDonut     = null;
    let lastUpdated    = null;

    /* ── Helpers ───────────────────────────────────────────────────────── */
    function esc(s) {
      return String(s ?? '').replace(/[&<>"']/g, c =>
        ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c] || c));
    }

    function fmtDate(iso) {
      if (!iso) return '—';
      try {
        const d = new Date(`${iso}T00:00:00Z`);
        return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', weekday: 'short', timeZone: 'Asia/Manila' });
      } catch (_) { return iso; }
    }

    function fmtShortDate(iso) {
      if (!iso) return '';
      try {
        const d = new Date(`${iso}T00:00:00Z`);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'Asia/Manila' });
      } catch (_) { return iso; }
    }

    function initials(n) { return String(n||'?').split(/\s+/).map(w=>w[0]||'').join('').slice(0,2).toUpperCase(); }

    function gradientForName(name) {
      const grads = [
        'from-violet-500 to-purple-600','from-blue-500 to-cyan-600',
        'from-emerald-500 to-teal-600','from-orange-500 to-amber-600',
        'from-pink-500 to-rose-600','from-red-500 to-orange-600',
        'from-indigo-500 to-blue-600','from-cyan-500 to-sky-600'
      ];
      let h = 0;
      for (let i = 0; i < (name||'').length; i++) h = (h*31 + name.charCodeAt(i)) & 0xfffff;
      return grads[Math.abs(h) % grads.length];
    }

    function avatarColor(name) {
      const colors = ['#7C3AED','#2563EB','#059669','#D97706','#DB2777','#DC2626','#4F46E5','#0891B2'];
      let h = 0;
      for (let i = 0; i < (name||'').length; i++) h = (h*31 + name.charCodeAt(i)) & 0xfffff;
      return colors[Math.abs(h) % colors.length];
    }

    function deltaHtml(val, bold) {
      if (val > 0) return `<span class="tr2-delta tr2-delta-up${bold?' tr2-delta-bold':''}">`+
        `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M18 15l-6-6-6 6"/></svg>+${val}</span>`;
      if (val < 0) return `<span class="tr2-delta tr2-delta-dn">`+
        `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M6 9l6 6 6-6"/></svg>${val}</span>`;
      return `<span class="tr2-delta tr2-delta-flat">0</span>`;
    }

    function currentCaseBadge(m) {
      if (m.loadStatus === 'overload')
        return `<span class="tr2-cur tr2-cur-overload">${m.casesToday}</span>`;
      if (m.loadStatus === 'warning')
        return `<span class="tr2-cur tr2-cur-warning">${m.casesToday}</span>`;
      return `<span class="tr2-cur tr2-cur-normal">${m.casesToday}</span>`;
    }

    function loadBadge(m) {
      if (m.loadStatus === 'overload')
        return `<span class="tr2-status tr2-status-overload${m.casesToday >= 13 ? ' tr2-pulse' : ''}">Overload</span>`;
      if (m.loadStatus === 'warning')
        return `<span class="tr2-status tr2-status-warning">Warning</span>`;
      return `<span class="tr2-status tr2-status-normal">Normal</span>`;
    }

    function patternBadge(pattern) {
      const map = {
        spiking:  `<span class="tr2-pattern tr2-pattern-spiking"><span class="tr2-blink"></span>Spiking</span>`,
        rising:   `<span class="tr2-pattern tr2-pattern-rising">Rising</span>`,
        declining:`<span class="tr2-pattern tr2-pattern-declining">Declining</span>`,
        stable:   `<span class="tr2-pattern tr2-pattern-stable">Stable</span>`
      };
      return map[pattern] || map.stable;
    }

    function attendanceDots(attendance7) {
      if (!Array.isArray(attendance7) || !attendance7.length) {
        return Array.from({length:7}).map(()=>`<span class="tr2-att-dot tr2-att-absent"></span>`).join('');
      }
      return attendance7.slice(0,7).map(s => {
        const cls = s === 'present' ? 'tr2-att-present' : s === 'partial' ? 'tr2-att-partial' : 'tr2-att-absent';
        return `<span class="tr2-att-dot ${cls}"></span>`;
      }).join('');
    }

    function qbOpenBadge(n) {
      if (n >= 7) return `<span class="tr2-qb-open tr2-qb-open-high">${n}</span>`;
      if (n >= 4) return `<span class="tr2-qb-open tr2-qb-open-med">${n}</span>`;
      return `<span class="tr2-qb-open tr2-qb-open-low">${n}</span>`;
    }

    function qbClosedBadge(n) {
      return `<span class="tr2-qb-closed">${n}</span>`;
    }

    /* ── Styles injection ──────────────────────────────────────────────── */
    function injectStyles() {
      if (document.getElementById('tr2-styles')) return;
      const s = document.createElement('style');
      s.id = 'tr2-styles';
      s.textContent = `
        /* ── Base ── */
        .tr2-shell{font-family:'Inter',system-ui,sans-serif;background:#0B1120;min-height:100vh;padding:0;color:#e2e8f0}
        .tr2-boot{color:#64748b;padding:3rem;text-align:center;font-size:.9rem}
        .tr2-deny{padding:3rem 1rem;text-align:center}
        .pbi-grid-bg{background-image:linear-gradient(rgba(148,163,184,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(148,163,184,.03) 1px,transparent 1px);background-size:20px 20px}

        /* ── Page header ── */
        .tr2-page{padding:1.25rem 1.5rem 2rem}
        .tr2-header{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:.75rem;margin-bottom:1.25rem}
        .tr2-title{font-size:1.35rem;font-weight:600;color:#fff;letter-spacing:-.02em;margin:0;display:flex;align-items:center;gap:.6rem}
        .tr2-title-badge{font-size:.65rem;font-weight:500;padding:.15rem .45rem;border-radius:.25rem;background:#1e293b;border:1px solid #334155;color:#94a3b8;letter-spacing:.04em}
        .tr2-subtitle{color:#64748b;font-size:.8rem;margin-top:.2rem}
        .tr2-live{display:flex;align-items:center;gap:.4rem;font-size:.75rem;color:#64748b}
        .tr2-live-dot{width:.5rem;height:.5rem;border-radius:50%;background:#10b981;animation:tr2-pulse-anim 2s infinite}
        @keyframes tr2-pulse-anim{0%,100%{opacity:1}50%{opacity:.3}}

        /* ── KPI cards ── */
        .tr2-kpi-row{display:grid;grid-template-columns:repeat(2,1fr);gap:.9rem;margin-bottom:1.25rem}
        @media(min-width:900px){.tr2-kpi-row{grid-template-columns:repeat(4,1fr)}}
        .tr2-kpi{position:relative;background:#1e293b;border:1px solid rgba(100,116,139,.3);border-radius:.75rem;padding:1rem;overflow:hidden;transition:border-color .2s}
        .tr2-kpi:hover{border-color:rgba(100,116,139,.6)}
        .tr2-kpi--red{border-color:rgba(127,29,29,.6)}.tr2-kpi--red:hover{border-color:#991b1b}
        .tr2-kpi-inner{position:relative}
        .tr2-kpi-top{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:.4rem}
        .tr2-kpi-label{font-size:.65rem;text-transform:uppercase;letter-spacing:.07em;color:#64748b;font-weight:500}
        .tr2-kpi-val{font-size:1.85rem;font-weight:600;color:#fff;line-height:1;letter-spacing:-.03em;margin:.25rem 0}
        .tr2-kpi-sub{font-size:.72rem;display:flex;align-items:center;gap:.3rem;margin-top:.6rem}
        .tr2-kpi-sub-up{color:#f59e0b}.tr2-kpi-sub-dn{color:#f59e0b}.tr2-kpi-sub-red{color:#f87171}.tr2-kpi-sub-muted{color:#64748b}

        /* ── Filters ── */
        .tr2-filters{background:#1e293b;border:1px solid rgba(100,116,139,.3);border-radius:.75rem;padding:.6rem 1rem;margin-bottom:1.25rem;display:flex;flex-wrap:wrap;align-items:center;gap:.75rem}
        .tr2-filter-label{font-size:.75rem;color:#64748b}
        .tr2-select{background:#0f172a;border:1px solid #334155;border-radius:.45rem;color:#e2e8f0;font-size:.8rem;padding:.3rem .55rem;outline:none;cursor:pointer}
        .tr2-select:focus{border-color:#3b82f6}
        .tr2-date-btn{background:#0f172a;border:1px solid #334155;border-radius:.45rem;color:#e2e8f0;font-size:.8rem;padding:.3rem .7rem;display:inline-flex;align-items:center;gap:.4rem;cursor:pointer}
        .tr2-date-btn:hover{background:#1e293b}
        .tr2-vsep{width:1px;height:1.2rem;background:#334155;display:none}
        @media(min-width:640px){.tr2-vsep{display:block}}
        .tr2-search-wrap{position:relative;flex:1;max-width:240px}
        .tr2-search-wrap svg{position:absolute;left:.55rem;top:50%;transform:translateY(-50%);color:#64748b;pointer-events:none}
        .tr2-search{width:100%;background:#0f172a;border:1px solid #334155;border-radius:.45rem;color:#e2e8f0;font-size:.8rem;padding:.3rem .55rem .3rem 1.75rem;outline:none}
        .tr2-search:focus{border-color:#3b82f6}
        .tr2-ml-auto{margin-left:auto}

        /* ── Main 2-col grid ── */
        .tr2-main-grid{display:grid;grid-template-columns:1fr;gap:1.25rem;margin-bottom:1.25rem}
        @media(min-width:1100px){.tr2-main-grid{grid-template-columns:2fr 1fr}}

        /* ── Panel shared ── */
        .tr2-panel{background:#1e293b;border:1px solid rgba(100,116,139,.3);border-radius:.75rem;overflow:hidden}
        .tr2-panel-head{display:flex;align-items:center;justify-content:space-between;padding:.6rem 1rem;background:rgba(15,23,42,.5);border-bottom:1px solid rgba(100,116,139,.2)}
        .tr2-panel-title{display:flex;align-items:center;gap:.5rem;font-size:.72rem;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:.07em}
        .tr2-panel-icon{width:1.75rem;height:1.75rem;border-radius:.35rem;background:#0f172a;border:1px solid #334155;display:flex;align-items:center;justify-content:center;flex-shrink:0}
        .tr2-legend{display:flex;gap:.4rem}
        .tr2-leg{font-size:.65rem;padding:.1rem .4rem;border-radius:.2rem;font-weight:500}
        .tr2-leg-n{background:rgba(16,185,129,.12);color:#34d399;border:1px solid rgba(16,185,129,.2)}
        .tr2-leg-w{background:rgba(245,158,11,.12);color:#fbbf24;border:1px solid rgba(245,158,11,.2)}
        .tr2-leg-o{background:rgba(239,68,68,.12);color:#f87171;border:1px solid rgba(239,68,68,.2)}

        /* ── Workload Matrix table ── */
        .tr2-table-wrap{overflow-x:auto}
        .tr2-table{width:100%;border-collapse:collapse;font-size:.8rem}
        .tr2-table thead{background:rgba(15,23,42,.7);position:sticky;top:0;z-index:10}
        .tr2-table th{padding:.5rem .75rem;text-align:left;font-size:.65rem;font-weight:500;text-transform:uppercase;letter-spacing:.06em;color:#64748b;white-space:nowrap;border-bottom:1px solid rgba(51,65,85,.6)}
        .tr2-table th.tc{text-align:center}
        .tr2-table tbody tr{border-bottom:1px solid rgba(30,41,59,.8);transition:background .1s}
        .tr2-table tbody tr:hover{background:rgba(51,65,85,.4)}
        .tr2-table tbody tr.tr2-row-even{background:rgba(15,23,42,.3)}
        .tr2-table tbody tr.tr2-row-overload{background:rgba(127,29,29,.12);border-left:2px solid #ef4444}
        .tr2-table tbody tr.tr2-row-overload:hover{background:rgba(127,29,29,.22)}
        .tr2-table td{padding:.55rem .75rem;color:#cbd5e1;vertical-align:middle}
        .tr2-table td.tc{text-align:center}

        /* Member cell */
        .tr2-member-cell{display:flex;align-items:center;gap:.55rem}
        .tr2-avatar{width:1.75rem;height:1.75rem;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.6rem;font-weight:700;color:#fff;flex-shrink:0}
        .tr2-avatar-overload{ring:2px;box-shadow:0 0 0 2px rgba(239,68,68,.5)}
        .tr2-member-name{font-weight:500;color:#fff;font-size:.82rem;display:flex;align-items:center;gap:.4rem}
        .tr2-member-overload-dot{width:.45rem;height:.45rem;border-radius:50%;background:#ef4444;animation:tr2-pulse-anim 1.5s infinite;flex-shrink:0}
        .tr2-member-sub{color:#64748b;font-size:.68rem;margin-top:.05rem}

        /* Attendance dots */
        .tr2-att-dots{display:flex;justify-content:center;gap:.2rem}
        .tr2-att-dot{width:.45rem;height:.45rem;border-radius:50%;display:inline-block}
        .tr2-att-present{background:#10b981}
        .tr2-att-partial{background:#f59e0b}
        .tr2-att-absent{background:#374151}

        /* QB badges */
        .tr2-qb-open{padding:.1rem .4rem;border-radius:.25rem;font-size:.75rem;font-weight:600;font-variant-numeric:tabular-nums}
        .tr2-qb-open-high{background:rgba(239,68,68,.2);color:#fca5a5}
        .tr2-qb-open-med{background:rgba(245,158,11,.2);color:#fcd34d}
        .tr2-qb-open-low{background:rgba(51,65,85,.5);color:#e2e8f0}
        .tr2-qb-closed{padding:.1rem .4rem;border-radius:.25rem;font-size:.75rem;background:rgba(16,185,129,.12);color:#6ee7b7}

        /* Current cases */
        .tr2-cur{padding:.25rem .55rem;border-radius:.35rem;font-size:.82rem;font-weight:600;display:inline-block}
        .tr2-cur-overload{background:rgba(239,68,68,.2);color:#fca5a5;border:1px solid rgba(239,68,68,.3);box-shadow:0 1px 4px rgba(239,68,68,.08)}
        .tr2-cur-warning{background:rgba(245,158,11,.15);color:#fcd34d;border:1px solid rgba(245,158,11,.25)}
        .tr2-cur-normal{background:rgba(16,185,129,.12);color:#6ee7b7;border:1px solid rgba(16,185,129,.2)}

        /* Delta */
        .tr2-delta{display:inline-flex;align-items:center;gap:.2rem;font-size:.75rem;font-weight:500}
        .tr2-delta-up{color:#f87171}.tr2-delta-dn{color:#34d399}.tr2-delta-flat{color:#475569}
        .tr2-delta-bold{font-weight:700}

        /* Load status badge */
        .tr2-status{padding:.2rem .55rem;border-radius:999px;font-size:.68rem;font-weight:600}
        .tr2-status-overload{background:rgba(239,68,68,.15);color:#fca5a5;border:1px solid rgba(239,68,68,.3)}
        .tr2-status-warning{background:rgba(245,158,11,.15);color:#fbbf24;border:1px solid rgba(245,158,11,.25)}
        .tr2-status-normal{background:rgba(16,185,129,.12);color:#34d399;border:1px solid rgba(16,185,129,.2)}
        .tr2-pulse{animation:tr2-pulse-anim 1.5s infinite}

        /* Table footer */
        .tr2-table-foot{padding:.55rem 1rem;background:rgba(15,23,42,.5);border-top:1px solid rgba(51,65,85,.4);display:flex;align-items:center;justify-content:space-between;font-size:.68rem;color:#475569}

        /* ── Right panel ── */
        .tr2-right-panels{display:flex;flex-direction:column;gap:1.25rem}
        .tr2-chart-area{padding:1rem}
        .tr2-chart-canvas-wrap{height:200px;position:relative}
        .tr2-chart-summary{margin-top:.75rem;padding-top:.75rem;border-top:1px solid rgba(51,65,85,.4);display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem;font-size:.7rem}
        .tr2-chart-summary-item .tr2-chart-summary-label{color:#64748b}
        .tr2-chart-summary-item .tr2-chart-summary-val{color:#fff;font-weight:600;margin-top:.1rem}
        .tr2-donut-wrap{height:160px;position:relative;display:flex;align-items:center;justify-content:center}
        .tr2-donut-center{position:absolute;text-align:center;pointer-events:none}
        .tr2-donut-center-num{font-size:1.4rem;font-weight:700;color:#fff;line-height:1}
        .tr2-donut-center-lbl{font-size:.6rem;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-top:.15rem}
        .tr2-donut-legend{margin-top:.75rem;display:flex;flex-direction:column;gap:.4rem}
        .tr2-donut-legend-item{display:flex;align-items:center;justify-content:space-between;font-size:.72rem}
        .tr2-donut-legend-left{display:flex;align-items:center;gap:.4rem;color:#cbd5e1}
        .tr2-donut-dot{width:.55rem;height:.55rem;border-radius:50%}
        .tr2-donut-legend-right{color:#fff;font-weight:600}

        /* ── QB Timeline table ── */
        .tr2-timeline-wrap{overflow-x:auto}
        .tr2-timeline-table{width:100%;border-collapse:collapse;font-size:.8rem}
        .tr2-timeline-table thead{background:rgba(15,23,42,.7)}
        .tr2-timeline-table th{padding:.5rem 1rem;text-align:left;font-size:.65rem;font-weight:500;text-transform:uppercase;letter-spacing:.06em;color:#64748b;border-bottom:1px solid rgba(51,65,85,.5);white-space:nowrap}
        .tr2-timeline-table th.tc{text-align:center}
        .tr2-timeline-table tbody tr{border-bottom:1px solid rgba(30,41,59,.6);transition:background .1s}
        .tr2-timeline-table tbody tr:hover{background:rgba(51,65,85,.3)}
        .tr2-timeline-table td{padding:.5rem 1rem;color:#cbd5e1;vertical-align:middle}
        .tr2-timeline-table td.tc{text-align:center}
        .tr2-timeline-head-note{font-size:.7rem;color:#64748b}

        /* Timeline "today" cell */
        .tr2-td-today-high{display:inline-flex;align-items:center;gap:.4rem;padding:.25rem .6rem;border-radius:.3rem;background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.25)}
        .tr2-td-today-med{display:inline-flex;align-items:center;gap:.4rem;padding:.25rem .6rem;border-radius:.3rem;background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.2)}
        .tr2-td-today-norm{display:inline-flex;align-items:center;gap:.4rem}
        .tr2-td-today-count{color:#fff;font-weight:600}
        .tr2-td-d1-wrap{display:inline-flex;align-items:center;gap:.4rem}

        /* Pattern badges */
        .tr2-pattern{display:inline-flex;align-items:center;gap:.3rem;font-size:.68rem;padding:.15rem .45rem;border-radius:.25rem}
        .tr2-pattern-spiking{background:rgba(239,68,68,.12);color:#f87171}
        .tr2-pattern-rising{background:rgba(245,158,11,.12);color:#fbbf24}
        .tr2-pattern-declining{background:rgba(34,197,94,.1);color:#4ade80}
        .tr2-pattern-stable{background:rgba(51,65,85,.5);color:#94a3b8}
        .tr2-blink{width:.35rem;height:.35rem;border-radius:50%;background:#ef4444;animation:tr2-pulse-anim 1s infinite;display:inline-block}

        /* ── Footer ── */
        .tr2-footer{display:flex;align-items:center;justify-content:flex-end;gap:.4rem;margin-top:1rem;font-size:.7rem;color:#475569}

        /* ── Skeleton ── */
        .tr2-skel{display:inline-block;border-radius:.2rem;height:.75rem;background:linear-gradient(90deg,#1e293b 25%,#263148 50%,#1e293b 75%);background-size:200% 100%;animation:tr2-skel 1.4s infinite}
        @keyframes tr2-skel{0%{background-position:200% 0}100%{background-position:-200% 0}}

        /* ── Empty ── */
        .tr2-empty{padding:3rem 1rem;text-align:center;color:#64748b;font-size:.85rem}
      `;
      document.head.appendChild(s);
    }

    /* ── Load Chart.js dynamically ─────────────────────────────────────── */
    function ensureChartJs() {
      return new Promise(resolve => {
        if (window.Chart) { resolve(); return; }
        const sc = document.createElement('script');
        sc.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js';
        sc.onload = resolve;
        sc.onerror = resolve; // fail gracefully
        document.head.appendChild(sc);
      });
    }

    /* ── Fetch ─────────────────────────────────────────────────────────── */
    async function fetchReport() {
      loading = true;
      renderSkeleton();
      const jwt = (window.CloudAuth && CloudAuth.accessToken) ? CloudAuth.accessToken() : '';
      const headers = jwt ? { Authorization: `Bearer ${jwt}` } : {};
      const params  = new URLSearchParams();
      if (selectedTeamId) params.set('team_id', selectedTeamId);
      try {
        const res  = await fetch(`/api/team_report?${params}`, { headers });
        const json = await res.json().catch(() => ({ ok: false }));
        if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to load.');
        lastData    = json;
        lastUpdated = new Date();
      } catch (e) {
        lastData = { ok: false, error: String(e.message || e) };
      } finally {
        loading = false;
        await ensureChartJs();
        render();
      }
    }

    /* ── Skeleton while loading ─────────────────────────────────────────── */
    function renderSkeleton() {
      injectStyles();
      root.innerHTML = `<div class="tr2-shell"><div class="tr2-page">
        <div class="tr2-boot" style="padding:4rem;color:#475569">
          <div class="tr2-skel" style="width:120px;margin:0 auto .75rem"></div>
          <div class="tr2-skel" style="width:200px;margin:0 auto"></div>
        </div>
      </div></div>`;
    }

    /* ── Charts ────────────────────────────────────────────────────────── */
    function renderLineChart(members, dates7) {
      const canvas = document.getElementById('tr2LineChart');
      if (!canvas || !window.Chart) return;
      if (chartLine) { chartLine.destroy(); chartLine = null; }

      // Top 3 highest-load members for the chart
      const sorted = [...members].sort((a, b) => b.casesToday - a.casesToday).slice(0, 3);
      const CHART_COLORS = ['#EF4444', '#3B82F6', '#F59E0B', '#10B981'];
      const labels = (Array.isArray(dates7) ? dates7 : []).slice(0, 7).reverse().map(d => fmtShortDate(d));

      Chart.defaults.color        = '#94A3B8';
      Chart.defaults.borderColor  = '#1E293B';
      Chart.defaults.font.family  = 'Inter, system-ui, sans-serif';
      Chart.defaults.font.size    = 11;

      chartLine = new Chart(canvas, {
        type: 'line',
        data: {
          labels,
          datasets: sorted.map((m, i) => ({
            label: m.name,
            data:  [...(m.history7 || [])].slice(0, 7).reverse(),
            borderColor: CHART_COLORS[i],
            backgroundColor: CHART_COLORS[i] + '18',
            borderWidth: i === 0 ? 2.5 : 2,
            tension: 0.35,
            pointRadius: i === 0 ? 3 : 2.5,
            pointHoverRadius: 5,
            pointBackgroundColor: CHART_COLORS[i],
            fill: i === 0
          }))
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          interaction: { intersect: false, mode: 'index' },
          plugins: {
            legend: { display: true, position: 'top', align: 'start',
              labels: { boxWidth: 10, boxHeight: 10, padding: 10, color: '#CBD5E1', font: { size: 11, weight: '500' } }
            },
            tooltip: {
              backgroundColor: '#0F172A', titleColor: '#E2E8F0', bodyColor: '#CBD5E1',
              borderColor: '#334155', borderWidth: 1, padding: 10,
              callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y} cases` }
            }
          },
          scales: {
            y: { beginAtZero: true, grid: { color: 'rgba(51,65,85,.5)', drawBorder: false },
              ticks: { padding: 6, color: '#64748B' }, border: { display: false } },
            x: { grid: { display: false }, ticks: { padding: 4, color: '#64748B' }, border: { display: false } }
          }
        }
      });
    }

    function renderDonutChart(kpis) {
      const canvas = document.getElementById('tr2DonutChart');
      if (!canvas || !window.Chart) return;
      if (chartDonut) { chartDonut.destroy(); chartDonut = null; }
      const normal   = (kpis.totalMembers||0) - (kpis.overloaded||0) - (kpis.warning||0);
      chartDonut = new Chart(canvas, {
        type: 'doughnut',
        data: {
          labels: ['Normal', 'Warning', 'Overload'],
          datasets: [{ data: [Math.max(normal,0), kpis.warning||0, kpis.overloaded||0],
            backgroundColor: ['#10B981','#F59E0B','#EF4444'],
            borderWidth: 0, hoverOffset: 4, cutout: '72%' }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false },
            tooltip: { backgroundColor:'#0F172A', titleColor:'#E2E8F0', bodyColor:'#CBD5E1',
              borderColor:'#334155', borderWidth:1, padding:10,
              callbacks: { label: ctx => `${ctx.label}: ${ctx.parsed} members` }
            }
          }
        }
      });
    }

    /* ── Main render ────────────────────────────────────────────────────── */
    function render() {
      injectStyles();
      const scrollY = window.scrollY;

      if (!lastData || !lastData.ok) {
        root.innerHTML = `<div class="tr2-shell"><div class="tr2-page">
          <div class="tr2-empty" style="padding:5rem 1rem">
            <div style="font-size:1.5rem;margin-bottom:.5rem">⚠️</div>
            <div style="color:#ef4444;font-weight:600;margin-bottom:.25rem">Failed to load Team Report</div>
            <div style="color:#64748b;font-size:.8rem">${esc(lastData && lastData.error ? lastData.error : 'Unknown error')}</div>
            <button id="tr2Retry" style="margin-top:1rem;background:#1d4ed8;border:none;color:#fff;padding:.4rem 1rem;border-radius:.4rem;font-size:.8rem;cursor:pointer">Retry</button>
          </div>
        </div></div>`;
        document.getElementById('tr2Retry')?.addEventListener('click', fetchReport);
        return;
      }

      const kpis  = lastData.kpis  || {};
      const dates = lastData.dates || {};
      const dates7 = Array.isArray(dates.history7) ? dates.history7 : [];

      let members = Array.isArray(lastData.members) ? lastData.members : [];
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        members = members.filter(m =>
          String(m.name||'').toLowerCase().includes(q) ||
          String(m.username||'').toLowerCase().includes(q) ||
          String(m.qbName||'').toLowerCase().includes(q)
        );
      }

      const teamName = (() => {
        const t = teams.find(t => t.id === selectedTeamId);
        return t ? (t.label || t.name || t.id) : (selectedTeamId || 'All Teams');
      })();

      const updStr = lastUpdated
        ? lastUpdated.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', timeZone:'Asia/Manila' }) + ' MNL'
        : 'now';

      const teamOptsHtml = isLead
        ? `<option value="${esc(me.teamId)}" selected>${esc(me.teamId)}</option>`
        : teams.map(t => `<option value="${esc(t.id)}" ${t.id===selectedTeamId?'selected':''}>${esc(t.label||t.name||t.id)}</option>`).join('');

      /* ── KPI cards ── */
      const kpiHtml = `
        <div class="tr2-kpi-row">
          <div class="tr2-kpi pbi-grid-bg">
            <div class="tr2-kpi-inner">
              <div class="tr2-kpi-top">
                <p class="tr2-kpi-label">Total Members</p>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748B" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              </div>
              <div class="tr2-kpi-val">${kpis.totalMembers ?? 0}</div>
              <div class="tr2-kpi-sub tr2-kpi-sub-muted">Active in ${esc(teamName)}</div>
            </div>
          </div>
          <div class="tr2-kpi pbi-grid-bg">
            <div class="tr2-kpi-inner">
              <div class="tr2-kpi-top">
                <p class="tr2-kpi-label">Avg Cases / Member</p>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748B" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 17V9l4-4 4 4v8"/></svg>
              </div>
              <div class="tr2-kpi-val">${kpis.avgCases ?? 0}</div>
              <div class="tr2-kpi-sub tr2-kpi-sub-up">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M18 15l-6-6-6 6"/></svg>
                Total assigned avg
              </div>
            </div>
          </div>
          <div class="tr2-kpi pbi-grid-bg ${(kpis.overloaded||0)>0?'tr2-kpi--red':''}">
            <div class="tr2-kpi-inner">
              <div class="tr2-kpi-top">
                <p class="tr2-kpi-label" style="${(kpis.overloaded||0)>0?'color:#f87171;opacity:.8':''}">Overloaded Today</p>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${(kpis.overloaded||0)>0?'#F87171':'#64748B'}" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              </div>
              <div class="tr2-kpi-val">${kpis.overloaded ?? 0}</div>
              <div class="tr2-kpi-sub ${(kpis.overloaded||0)>0?'tr2-kpi-sub-red':'tr2-kpi-sub-muted'}">
                ${(kpis.overloaded||0)>0
                  ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M18 15l-6-6-6 6"/></svg>+${kpis.overloaded} vs yesterday`
                  : 'members at overload'}
              </div>
            </div>
          </div>
          <div class="tr2-kpi pbi-grid-bg">
            <div class="tr2-kpi-inner">
              <div class="tr2-kpi-top">
                <p class="tr2-kpi-label">Team Attendance</p>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748B" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="16 12 12 8 8 12"/><line x1="12" y1="16" x2="12" y2="8"/></svg>
              </div>
              <div class="tr2-kpi-val">${kpis.attendancePct ?? 0}<span style="font-size:1.25rem;color:#94a3b8">%</span></div>
              <div class="tr2-kpi-sub tr2-kpi-sub-up">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M6 9l6 6 6-6"/></svg>
                7-day attendance avg
              </div>
            </div>
          </div>
        </div>`;

      /* ── Filters ── */
      const filtersHtml = `
        <div class="tr2-filters">
          ${!isLead ? `<span class="tr2-filter-label">Team</span>
            <select class="tr2-select" id="tr2TeamSel">${teamOptsHtml}</select>` : ''}
          <button class="tr2-date-btn" id="tr2DateBtn" title="Date context: last 3 days shown in table">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            ${fmtShortDate(dates7[2]||'')} – ${fmtShortDate(dates7[0]||'')}
          </button>
          <div class="tr2-vsep"></div>
          <div class="tr2-ml-auto"></div>
          <div class="tr2-search-wrap">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input class="tr2-search" id="tr2Search" placeholder="Search member…" value="${esc(searchQuery)}">
          </div>
        </div>`;

      /* ── Workload Matrix rows ── */
      const matrixRows = members.length === 0
        ? `<tr><td colspan="10"><div class="tr2-empty">
            <div style="font-size:1.5rem;opacity:.4;margin-bottom:.4rem">👥</div>
            ${searchQuery ? 'No members match your search.' : 'No members found for this team.'}
           </div></td></tr>`
        : members.map((m, i) => {
            const isOverload = m.loadStatus === 'overload';
            const avColor    = avatarColor(m.name);
            const ini        = initials(m.name);
            const rowCls     = isOverload
              ? 'tr2-row-overload'
              : (i % 2 === 1 ? 'tr2-row-even' : '');

            return `<tr class="${rowCls}" data-name="${esc((m.name||'').toLowerCase())}">
              <td>
                <div class="tr2-member-cell">
                  <div class="tr2-avatar ${isOverload?'tr2-avatar-overload':''}" style="background:${avColor}">${ini}</div>
                  <div>
                    <div class="tr2-member-name">
                      ${esc(m.name)}
                      ${isOverload ? '<span class="tr2-member-overload-dot"></span>' : ''}
                    </div>
                    <div class="tr2-member-sub">@${esc(m.username)}${m.qbName?` • QB: ${esc(m.qbName)}`:''}</div>
                  </div>
                </div>
              </td>
              <td class="tc" style="color:#94a3b8;font-size:.75rem">${esc(m.duty||'Member')}</td>
              <td class="tc">
                <div class="tr2-att-dots">${attendanceDots(m.attendance7)}</div>
              </td>
              <td class="tc" style="color:#cbd5e1;font-variant-numeric:tabular-nums">${m.totalAssigned ?? 0}</td>
              <td class="tc">${qbOpenBadge(m.qbOpen ?? 0)}</td>
              <td class="tc">${qbClosedBadge(m.qbClosed ?? 0)}</td>
              <td class="tc">${currentCaseBadge(m)}</td>
              <td class="tc">${deltaHtml(m.deltaD1, true)}</td>
              <td class="tc">${deltaHtml(m.deltaD2, false)}</td>
              <td class="tc">${loadBadge(m)}</td>
            </tr>`;
          }).join('');

      /* ── QB Timeline rows ── */
      const timelineMembers = [...members]
        .sort((a, b) => b.casesToday - a.casesToday)
        .filter(m => m.casesToday > 0 || m.casesD1 > 0 || m.casesD2 > 0)
        .slice(0, 10);

      const timelineRows = timelineMembers.length === 0
        ? `<tr><td colspan="7"><div class="tr2-empty">No case movement data for this period.</div></td></tr>`
        : timelineMembers.map(m => {
            const avColor = avatarColor(m.name);
            const ini     = initials(m.name);
            const isHigh  = m.casesToday >= 13;
            const isMed   = m.casesToday >= 10 && !isHigh;
            const todayClass = isHigh ? 'tr2-td-today-high' : isMed ? 'tr2-td-today-med' : 'tr2-td-today-norm';
            const d1Delta = m.deltaD1 !== 0 ? deltaHtml(m.deltaD1, false) : '';

            return `<tr>
              <td>
                <div style="display:flex;align-items:center;gap:.5rem">
                  <div class="tr2-avatar" style="background:${avColor};width:1.5rem;height:1.5rem;font-size:.55rem">${ini}</div>
                  <span style="color:#fff">${esc(m.name)}</span>
                </div>
              </td>
              <td class="tc">
                <div class="${todayClass}">
                  <span class="tr2-td-today-count">${m.casesToday}</span>
                  ${m.deltaD1 !== 0 ? deltaHtml(m.deltaD1, false) : ''}
                </div>
              </td>
              <td class="tc">
                <div class="tr2-td-d1-wrap">
                  <span style="color:#e2e8f0">${m.casesD1}</span>
                  ${m.casesD1 - m.casesD2 !== 0 ? deltaHtml(m.casesD1 - m.casesD2, false) : ''}
                </div>
              </td>
              <td class="tc" style="color:#94a3b8">${m.casesD2}</td>
              <td class="tc">
                <span style="color:${m.deltaThreeDay>0?'#f87171':m.deltaThreeDay<0?'#34d399':'#64748b'};font-weight:600">
                  ${m.deltaThreeDay > 0 ? '+' : ''}${m.deltaThreeDay ?? 0}
                </span>
              </td>
              <td class="tc" style="color:#94a3b8">${m.sevenDayAvg ?? '—'}</td>
              <td>${patternBadge(m.pattern)}</td>
            </tr>`;
          }).join('');

      /* ── Overload count for footer ── */
      const overloadCount = members.filter(m => m.loadStatus === 'overload').length;

      /* ── Assemble full page ── */
      root.innerHTML = `
        <div class="tr2-shell">
          <div class="tr2-page">

            <!-- Header -->
            <div class="tr2-header">
              <div>
                <h1 class="tr2-title">
                  Team Report
                  <span class="tr2-title-badge">POWER BI</span>
                </h1>
                <p class="tr2-subtitle">${esc(teamName)} • Workload, attendance &amp; QuickBase operations</p>
              </div>
              <div class="tr2-live">
                <div class="tr2-live-dot"></div>Live
                <span>•</span>
                <span>Updated ${esc(updStr)}</span>
              </div>
            </div>

            ${kpiHtml}
            ${filtersHtml}

            <!-- Main 2-col grid -->
            <div class="tr2-main-grid">

              <!-- Left: Workload Matrix -->
              <div class="tr2-panel">
                <div class="tr2-panel-head">
                  <div class="tr2-panel-title">
                    <div class="tr2-panel-icon">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#60A5FA" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
                    </div>
                    Member Workload Matrix
                  </div>
                  <div class="tr2-legend">
                    <span class="tr2-leg tr2-leg-n">Normal</span>
                    <span class="tr2-leg tr2-leg-w">Warning</span>
                    <span class="tr2-leg tr2-leg-o">Overload</span>
                  </div>
                </div>
                <div class="tr2-table-wrap">
                  <table class="tr2-table" id="tr2Matrix">
                    <thead>
                      <tr>
                        <th>Member</th>
                        <th>Role</th>
                        <th class="tc">Attendance</th>
                        <th class="tc">Total</th>
                        <th class="tc">QB Open</th>
                        <th class="tc">QB Closed</th>
                        <th class="tc">Current</th>
                        <th class="tc">Δ 1D</th>
                        <th class="tc">Δ 2D</th>
                        <th class="tc">Load Status</th>
                      </tr>
                    </thead>
                    <tbody>${matrixRows}</tbody>
                  </table>
                </div>
                <div class="tr2-table-foot">
                  <span>Showing ${members.length} of ${(lastData.members||[]).length} members • ${overloadCount} overloaded</span>
                  <span>Conditional: ≥13 = Overload, ≥10 = Warning</span>
                </div>
              </div>

              <!-- Right: Charts -->
              <div class="tr2-right-panels">

                <!-- Line chart: Case movement -->
                <div class="tr2-panel">
                  <div class="tr2-panel-head">
                    <div class="tr2-panel-title" style="font-size:.7rem">Case Movement — Last 7 Days</div>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748B" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
                  </div>
                  <div class="tr2-chart-area">
                    <div class="tr2-chart-canvas-wrap">
                      <canvas id="tr2LineChart"></canvas>
                    </div>
                    <div class="tr2-chart-summary">
                      <div class="tr2-chart-summary-item">
                        <div class="tr2-chart-summary-label">Peak Load</div>
                        <div class="tr2-chart-summary-val">${(()=>{
                          const top = [...(lastData.members||[])].sort((a,b)=>b.casesToday-a.casesToday)[0];
                          return top ? `${top.name.split(' ')[0]} (${top.casesToday})` : '—';
                        })()}</div>
                      </div>
                      <div class="tr2-chart-summary-item">
                        <div class="tr2-chart-summary-label">Trend</div>
                        <div class="tr2-chart-summary-val" style="color:${(kpis.totalCasesToday||0)>(kpis.totalCasesD1||0)?'#f59e0b':'#34d399'}">
                          ${(kpis.totalCasesToday||0)>(kpis.totalCasesD1||0)?'↑':'↓'}
                          ${Math.abs((kpis.totalCasesToday||0)-(kpis.totalCasesD1||0))} today
                        </div>
                      </div>
                      <div class="tr2-chart-summary-item">
                        <div class="tr2-chart-summary-label">Risk</div>
                        <div class="tr2-chart-summary-val" style="color:${(kpis.overloaded||0)>1?'#f87171':(kpis.overloaded||0)===1?'#fbbf24':'#34d399'}">
                          ${(kpis.overloaded||0)>1?'High':(kpis.overloaded||0)===1?'Medium':'Low'}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Donut chart: Workload distribution -->
                <div class="tr2-panel">
                  <div class="tr2-panel-head">
                    <div class="tr2-panel-title" style="font-size:.7rem">Workload Distribution</div>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748B" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
                  </div>
                  <div class="tr2-chart-area">
                    <div class="tr2-donut-wrap">
                      <canvas id="tr2DonutChart"></canvas>
                      <div class="tr2-donut-center">
                        <div class="tr2-donut-center-num">${kpis.totalMembers??0}</div>
                        <div class="tr2-donut-center-lbl">Members</div>
                      </div>
                    </div>
                    <div class="tr2-donut-legend">
                      ${(()=>{
                        const normal   = Math.max((kpis.totalMembers||0)-(kpis.overloaded||0)-(kpis.warning||0),0);
                        const total    = kpis.totalMembers||1;
                        return [
                          { color:'#10B981', label:'Normal (≤9)',      count: normal,               pct: Math.round(normal/(total)*100) },
                          { color:'#F59E0B', label:'Warning (10–12)',   count: kpis.warning||0,      pct: Math.round((kpis.warning||0)/total*100) },
                          { color:'#EF4444', label:'Overload (13+)',    count: kpis.overloaded||0,   pct: Math.round((kpis.overloaded||0)/total*100) }
                        ].map(r => `<div class="tr2-donut-legend-item">
                          <div class="tr2-donut-legend-left">
                            <span class="tr2-donut-dot" style="background:${r.color}"></span>
                            <span>${r.label}</span>
                          </div>
                          <span class="tr2-donut-legend-right">${r.count} members • ${r.pct}%</span>
                        </div>`).join('');
                      })()}
                    </div>
                  </div>
                </div>

              </div><!-- /right panels -->
            </div><!-- /main grid -->

            <!-- Bottom: QB Record Timeline -->
            <div class="tr2-panel">
              <div class="tr2-panel-head">
                <div class="tr2-panel-title">
                  <div class="tr2-panel-icon">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#60A5FA" stroke-width="2"><path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/></svg>
                  </div>
                  My QuickBase Record Timeline
                </div>
                <span class="tr2-timeline-head-note">Per member • Today vs Yesterday vs 2 Days Ago</span>
              </div>
              <div class="tr2-timeline-wrap">
                <table class="tr2-timeline-table">
                  <thead>
                    <tr>
                      <th>Member</th>
                      <th class="tc" style="min-width:130px">Today <span style="font-weight:400;opacity:.5;text-transform:none;letter-spacing:0">${fmtShortDate(dates7[0]||'')}</span></th>
                      <th class="tc" style="min-width:130px">Yesterday <span style="font-weight:400;opacity:.5;text-transform:none;letter-spacing:0">${fmtShortDate(dates7[1]||'')}</span></th>
                      <th class="tc" style="min-width:110px">2 Days Ago <span style="font-weight:400;opacity:.5;text-transform:none;letter-spacing:0">${fmtShortDate(dates7[2]||'')}</span></th>
                      <th class="tc">3-Day Δ</th>
                      <th class="tc">7-Day Avg</th>
                      <th>Pattern</th>
                    </tr>
                  </thead>
                  <tbody>${timelineRows}</tbody>
                </table>
              </div>
            </div>

            <!-- Footer note -->
            <div class="tr2-footer">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              Visible only to TEAM_LEAD, SUPER_USER, SUPER_ADMIN
            </div>

          </div><!-- /page -->
        </div><!-- /shell -->`;

      /* ── Event bindings ─────────────────────────────────────────────── */
      document.getElementById('tr2TeamSel')?.addEventListener('change', e => {
        selectedTeamId = e.target.value;
        fetchReport();
      });

      const searchEl = document.getElementById('tr2Search');
      let searchTimer;
      if (searchEl) {
        searchEl.addEventListener('input', e => {
          clearTimeout(searchTimer);
          searchTimer = setTimeout(() => { searchQuery = e.target.value; render(); }, 250);
        });
      }

      /* ── Render charts after DOM settles ─────────────────────────────── */
      requestAnimationFrame(() => {
        renderLineChart(lastData.members || [], dates7);
        renderDonutChart(kpis);
      });

      window.scrollTo(0, scrollY);
    }

    /* ── Auto-refresh 5 min ─────────────────────────────────────────────── */
    function startAutoRefresh() {
      if (autoTimer) clearInterval(autoTimer);
      autoTimer = setInterval(() => {
        if (document.visibilityState !== 'hidden') fetchReport();
      }, 5 * 60 * 1000);
    }

    /* ── Cleanup on nav away ────────────────────────────────────────────── */
    const origNav = window.navigateToPageId;
    if (typeof origNav === 'function') {
      document.addEventListener('visibilitychange', () => {
        if (autoTimer) clearInterval(autoTimer);
        if (chartLine)  { chartLine.destroy();  chartLine  = null; }
        if (chartDonut) { chartDonut.destroy();  chartDonut = null; }
      }, { once: true });
    }

    /* ── Boot ──────────────────────────────────────────────────────────── */
    injectStyles();
    await ensureChartJs();
    await fetchReport();
    startAutoRefresh();

  })();
};
