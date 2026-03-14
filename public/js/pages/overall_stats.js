/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Strictly protects Enterprise UI/UX, Realtime Sync Logic, Core State Management, and Database/API Adapters. Do NOT modify existing logic or layout in this file without explicitly asking MACE for clearance. If overlapping changes are required, STOP and provide a RISK IMPACT REPORT first. */
/* File: public/js/pages/overall_stats.js */

(window.Pages = window.Pages || {}, window.Pages.overall_stats = function(root){
  const me = (window.Auth && Auth.getUser) ? (Auth.getUser() || {}) : {};
  const canView = (window.Config && Config.can) ? Config.can(me, 'view_members') : false;
  if(!canView){
    root.innerHTML = '<div class="ovr-shell"><div class="ovr-glass-panel"><h1 style="color:#ef4444;">Access Denied</h1><div class="muted">You do not have clearance to view overall statistics.</div></div></div>';
    return;
  }

  const isLead = me.role === (Config && Config.ROLES ? Config.ROLES.TEAM_LEAD : 'TEAM_LEAD');
  const isAdmin = me.role === (Config && Config.ROLES ? Config.ROLES.ADMIN : 'ADMIN');
  const isSuper = me.role === (Config && Config.ROLES ? Config.ROLES.SUPER_ADMIN : 'SUPER_ADMIN');
  const teams = (Config && Config.TEAMS) ? Config.TEAMS.slice() : [];
  
  const pilotKey = 'mums_pilot_overall_stats';
  const storedPilot = localStorage.getItem(pilotKey);
  let pilotEnabled = !isLead || (storedPilot === null ? true : storedPilot === '1');
  
  let activePreset = 'current_week';
  let dateRange = presetRange(activePreset);
  let sortBy = 'name';
  let sortDir = 'asc';
  let searchQuery = '';
  let pageSize = 10;
  let pageOffset = 0;
  let loading = false;
  let lastResponse = null;

  function presetRange(preset){
    const today = (window.UI && UI.manilaTodayISO) ? UI.manilaTodayISO() : new Date().toISOString().slice(0,10);
    const start = String(today || '').slice(0, 10);
    switch(preset){
      case 'previous_week': {
        const curStart = normalizeToMonday(today);
        return { start: UI.addDaysISO(curStart, -7), end: UI.addDaysISO(curStart, -1), label: 'Previous week' };
      }
      case 'last_month': {
        const d = new Date(`${today}T00:00:00Z`);
        const prev = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
        const startISO = prev.toISOString().slice(0,10);
        const endISO = new Date(Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth() + 1, 0)).toISOString().slice(0,10);
        return { start: startISO, end: endISO, label: 'Last month' };
      }
      case 'this_month': {
        const d = new Date(`${today}T00:00:00Z`);
        const startISO = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0,10);
        const endISO = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0,10);
        return { start: startISO, end: endISO, label: 'This month' };
      }
      case 'last_30_days': {
        return { start: UI.addDaysISO(start, -29), end: start, label: 'Last 30 days' };
      }
      case 'last_7_days': {
        return { start: UI.addDaysISO(start, -6), end: start, label: 'Last 7 days' };
      }
      default: {
        const curStart = normalizeToMonday(today);
        return { start: curStart, end: UI.addDaysISO(curStart, 6), label: 'Current week' };
      }
    }
  }
  
  let selectedTeamId = isLead ? me.teamId : ((teams[0] && teams[0].id) || '');

  function normalizeToMonday(iso){
    if(!window.UI || !UI.weekdayFromISO || !UI.addDaysISO) return iso;
    const wd = UI.weekdayFromISO(String(iso||UI.manilaTodayISO()));
    if(wd == null) return iso;
    const delta = (wd === 0) ? -6 : (1 - wd);
    return UI.addDaysISO(String(iso||UI.manilaTodayISO()), delta);
  }

  function formatRangeLabel(range){
    if(!range) return 'Custom range';
    try {
      const fmt = (d)=>new Date(String(d||'')+'T00:00:00Z').toLocaleDateString('en-US', { month:'short', day:'2-digit', year:'numeric', timeZone: (Config.TZ || 'Asia/Manila') });
      return `${range.label || 'Custom range'} • ${fmt(range.start)} – ${fmt(range.end)}`;
    } catch(e) {
      return `${range.label || 'Custom'} (${range.start} to ${range.end})`;
    }
  }

  function renderDeltaPill(value, prev, suffix = ''){
    const valNum = Number(value||0);
    const prevNum = Number(prev||0);
    const delta = valNum - prevNum;
    
    if(delta === 0) return `<span class="ovr-delta delta-neu">No change</span>`;
    const sign = delta > 0 ? '+' : '';
    const cls = delta > 0 ? 'delta-pos' : 'delta-neg';
    
    const fDelta = Number.isInteger(delta) ? delta : delta.toFixed(1);
    return `<span class="ovr-delta ${cls}">${sign}${fDelta}${suffix} vs prev</span>`;
  }

  function buildSparkline(values){
    const data = Array.isArray(values) ? values : [];
    if(!data.length) return '<span class="muted" style="font-size:11px;">No trend data</span>';
    const max = Math.max(...data, 1);
    const min = Math.min(...data, 0);
    const points = data.map((v,i)=>{
      const x = (i/(data.length-1 || 1)) * 100;
      const y = 100 - ((v - min) / (max - min || 1)) * 100;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');
    
    return `<svg class="ovr-sparkline sparkline-glow" viewBox="0 -5 100 110" preserveAspectRatio="none">
      <polyline points="${points}" fill="none" stroke="#38bdf8" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
    </svg>`;
  }

  function buildTrendChart(trends){
    const data = Array.isArray(trends) ? trends : [];
    if(!data.length) return '<div class="muted" style="padding:40px; text-align:center;">Insufficient data to plot trend line.</div>';
    const totals = data.map(d=>Number(d.totalHours||0));
    const max = Math.max(...totals, 1);
    const min = Math.min(...totals, 0);
    const points = totals.map((v,i)=>{
      const x = (i/(totals.length-1 || 1)) * 100;
      const y = 100 - ((v - min) / (max - min || 1)) * 100;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');
    
    const areaPoints = `0,100 ${points} 100,100`;
    
    return `
    <svg class="ovr-trend-chart sparkline-glow" viewBox="0 -10 100 120" preserveAspectRatio="none">
      <defs>
        <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="rgba(56,189,248,0.4)" />
          <stop offset="100%" stop-color="rgba(56,189,248,0.0)" />
        </linearGradient>
      </defs>
      <polygon points="${areaPoints}" fill="url(#trendGrad)" />
      <polyline points="${points}" fill="none" stroke="#0ea5e9" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
      ${totals.map((v,i)=>{
        const x = (i/(totals.length-1 || 1)) * 100;
        const y = 100 - ((v - min) / (max - min || 1)) * 100;
        return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="2" fill="#fff" filter="drop-shadow(0 0 2px #38bdf8)" />`;
      }).join('')}
    </svg>`;
  }

  function buildCsv(rows){
    const header = ['Member','Mailbox Hours','Back Office Hours','Call Hours','Assigned Cases','Total Hours','Delta vs Previous'];
    const lines = [header.join(',')];
    (rows||[]).forEach(r=>{
      lines.push([
        `"${String(r.name||'').replace(/\"/g,'\"\"')}"`,
        r.mailboxH,
        r.backOfficeH,
        r.callH,
        r.caseCount,
        r.totalH,
        r.deltaTotal
      ].join(','));
    });
    return lines.join('\n');
  }

  function updatePilotState(enabled){
    pilotEnabled = !!enabled;
    localStorage.setItem(pilotKey, pilotEnabled ? '1' : '0');
    render();
  }

  function ensureEnterpriseStyles() {
    if (document.getElementById('enterprise-ovr-styles')) return;
    const style = document.createElement('style');
    style.id = 'enterprise-ovr-styles';
    style.textContent = `
      .ovr-shell { display:flex; flex-direction:column; gap:24px; padding-bottom:40px; animation: ovrFadeIn 0.3s ease-out; }
      @keyframes ovrFadeIn { from{opacity:0; transform:translateY(10px);} to{opacity:1; transform:translateY(0);} }
      
      .ovr-glass-panel { background: linear-gradient(145deg, rgba(15,23,42,0.8), rgba(2,6,23,0.9)); backdrop-filter: blur(12px); border: 1px solid rgba(56,189,248,0.15); border-radius: 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05); padding: 24px; overflow:hidden; }
      
      .ovr-header-bar { display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:16px; margin-bottom: 24px; }
      .ovr-title { font-size: 28px; font-weight: 900; color: #f8fafc; margin:0; letter-spacing: -0.5px; text-shadow: 0 2px 10px rgba(0,0,0,0.5); }
      .ovr-subtitle { font-size: 13px; color: #94a3b8; margin-top: 6px; font-weight:600; }
      
      .ovr-badge { background:rgba(56,189,248,0.1); color:#38bdf8; border:1px solid rgba(56,189,248,0.3); padding:4px 12px; border-radius:999px; font-size:12px; font-weight:800; display:inline-flex; align-items:center; }
      
      /* Control Bar */
      .ovr-command-bar { background: rgba(2,6,23,0.5); border: 1px solid rgba(255,255,255,0.05); border-radius: 12px; padding: 16px; display:flex; flex-wrap:wrap; gap: 16px; align-items:flex-end; box-shadow: inset 0 2px 10px rgba(0,0,0,0.2); }
      .ovr-filter-group { display:flex; flex-direction:column; gap:6px; flex:1; min-width:200px; }
      .ovr-filter-group-row { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
      .ovr-label { font-size:11px; font-weight:800; color:#94a3b8; text-transform:uppercase; letter-spacing:0.5px; }
      .ovr-input { background: rgba(15,23,42,0.8); border: 1px solid rgba(148,163,184,0.3); color: #f8fafc; padding: 10px 14px; border-radius: 8px; outline: none; transition: all 0.2s; font-size:13px; width:100%; font-weight:600; }
      .ovr-input:focus { border-color: #38bdf8; box-shadow: 0 0 0 2px rgba(56,189,248,0.2); }
      
      /* KPI Cards */
      .ovr-kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 24px; }
      .ovr-kpi-card { background: linear-gradient(145deg, rgba(30,41,59,0.5), rgba(15,23,42,0.7)); border: 1px solid rgba(255,255,255,0.06); border-radius: 14px; padding: 24px; text-align: center; transition: transform 0.2s, box-shadow 0.2s; position:relative; overflow:hidden; }
      .ovr-kpi-card:hover { transform: translateY(-3px); border-color: rgba(56,189,248,0.4); box-shadow: 0 10px 25px rgba(0,0,0,0.3); }
      .ovr-kpi-label { font-size: 11px; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom:12px; }
      .ovr-kpi-val { font-size: 36px; font-weight: 900; color: #f8fafc; margin: 0 0 12px 0; font-variant-numeric: tabular-nums; text-shadow: 0 0 20px rgba(56,189,248,0.2); letter-spacing:-1px;}
      
      .ovr-delta { font-size: 11px; font-weight: 800; padding: 4px 10px; border-radius: 6px; display: inline-flex; align-items:center; }
      .delta-pos { background: rgba(16,185,129,0.15); color: #34d399; border:1px solid rgba(16,185,129,0.2); }
      .delta-neg { background: rgba(239,68,68,0.15); color: #fca5a5; border:1px solid rgba(239,68,68,0.2); }
      .delta-neu { background: rgba(148,163,184,0.1); color: #cbd5e1; }
      
      /* Trend Chart */
      .ovr-trend-card { grid-column: span 2; display:flex; flex-direction:column; justify-content:space-between; }
      @media(max-width:800px){ .ovr-trend-card { grid-column: span 1; } }
      .ovr-trend-wrap { height: 80px; width: 100%; margin-top: auto; }
      .ovr-trend-chart { width: 100%; height: 100%; overflow:visible; }
      .sparkline-glow { filter: drop-shadow(0 0 6px rgba(56,189,248,0.6)); }
      .ovr-sparkline { width:80px; height:30px; overflow:visible; }

      /* Buttons */
      .btn-glass { padding: 10px 18px; border-radius: 8px; font-weight: 700; font-size: 13px; cursor: pointer; transition: all 0.2s; outline: none; display:inline-flex; align-items:center; justify-content:center; gap:6px; border:none; white-space:nowrap; }
      .btn-glass-ghost { background: rgba(255,255,255,0.05); color: #cbd5e1; border: 1px solid rgba(255,255,255,0.1); }
      .btn-glass-ghost:hover { background: rgba(255,255,255,0.1); color: #f8fafc; border-color: rgba(255,255,255,0.2); transform:translateY(-1px);}
      .btn-glass-primary { background: linear-gradient(145deg, #0ea5e9, #0284c7); color: #fff; border: 1px solid rgba(56,189,248,0.4); box-shadow: 0 4px 12px rgba(14,165,233,0.3); }
      .btn-glass-primary:hover:not(:disabled) { background: linear-gradient(145deg, #38bdf8, #0ea5e9); transform: translateY(-1px); box-shadow: 0 6px 16px rgba(14,165,233,0.4); }
      .btn-glass-active { background: rgba(56,189,248,0.2); color: #38bdf8; border: 1px solid rgba(56,189,248,0.4); box-shadow:inset 0 0 10px rgba(56,189,248,0.1);}

      /* Table */
      .ovr-table-wrap { overflow-x: auto; border-radius: 12px; border: 1px solid rgba(255,255,255,0.05); background: rgba(2,6,23,0.5); box-shadow: inset 0 2px 10px rgba(0,0,0,0.3); }
      .ovr-table { width: 100%; border-collapse: collapse; min-width: 900px; }
      .ovr-table th { background: rgba(15,23,42,0.95); padding: 16px 14px; font-size: 11px; font-weight: 800; color: #cbd5e1; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid rgba(255,255,255,0.08); text-align:left; position: sticky; top: 0; backdrop-filter: blur(10px); z-index: 10; white-space:nowrap;}
      .ovr-table td { padding: 14px; border-bottom: 1px solid rgba(255,255,255,0.02); font-size: 13px; color: #e2e8f0; vertical-align: middle; }
      .ovr-table tbody tr { transition: background 0.2s; }
      .ovr-table tbody tr:hover { background: rgba(56,189,248,0.06); }
      .ovr-crown { color: #fcd34d; font-size: 16px; margin-right: 8px; filter: drop-shadow(0 0 5px rgba(245,158,11,0.6)); display:inline-block; animation: floatCrown 2s ease-in-out infinite alternate;}
      @keyframes floatCrown { 0%{transform:translateY(0);} 100%{transform:translateY(-2px);} }
      
      .ovr-table-num { font-weight:800; font-size:14px; font-variant-numeric:tabular-nums; display:block; margin-bottom:4px;}
      
      /* Detail Panel */
      .ovr-detail-row { background: rgba(2,6,23,0.8); }
      .ovr-detail-cell { padding:0 !important; border:none !important; }
      .ovr-detail-panel { border-left: 3px solid #38bdf8; padding: 24px; display:grid; grid-template-columns: 1fr 2fr; gap:24px; box-shadow: inset 0 4px 15px rgba(0,0,0,0.4); animation: ovrSlideDown 0.3s ease-out;}
      @keyframes ovrSlideDown { from{opacity:0; transform:translateY(-10px);} to{opacity:1; transform:translateY(0);} }
      
      /* Skeletons */
      .sk-card { background: linear-gradient(145deg, rgba(30,41,59,0.3), rgba(15,23,42,0.5)); border: 1px solid rgba(255,255,255,0.02); border-radius: 14px; padding: 24px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:16px; }
      .sk-bar { background: linear-gradient(90deg, rgba(255,255,255,0.02) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.02) 75%); background-size: 200% 100%; animation: ovrLoad 1.5s infinite; border-radius: 8px; }
      .sk-lbl { height:12px; width:60%; }
      .sk-val { height:36px; width:40%; border-radius:12px; }
      .sk-tr { border-bottom:1px solid rgba(255,255,255,0.02); }
      .sk-td { padding:14px; }
      .sk-cell { height:16px; width:80%; }
      @keyframes ovrLoad { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
      
      /* Switch */
      .ovr-switch { position: relative; display: inline-block; width: 44px; height: 24px; }
      .ovr-switch input { opacity: 0; width: 0; height: 0; }
      .ovr-slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.2); transition: .3s; border-radius: 24px; }
      .ovr-slider:before { position: absolute; content: ""; height: 16px; width: 16px; left: 3px; bottom: 3px; background-color: #cbd5e1; transition: .3s; border-radius: 50%; }
      .ovr-switch input:checked + .ovr-slider { background-color: rgba(16,185,129,0.2); border-color: rgba(16,185,129,0.4); }
      .ovr-switch input:checked + .ovr-slider:before { transform: translateX(20px); background-color: #34d399; box-shadow: 0 0 10px rgba(52,211,153,0.5); }
    `;
    document.head.appendChild(style);
  }

  async function fetchStats(){
    if(!pilotEnabled && isLead) return;
    loading = true;
    render(); // Trigger skeleton loaders

    const params = new URLSearchParams();
    params.set('start_date', dateRange.start);
    params.set('end_date', dateRange.end);
    params.set('team_id', selectedTeamId || '');
    params.set('sort_by', sortBy);
    params.set('sort_dir', sortDir);
    params.set('search', searchQuery.trim());
    params.set('limit', String(pageSize));
    params.set('offset', String(pageOffset));
    params.set('preset', activePreset || 'custom');

    const headers = {};
    const jwt = (window.CloudAuth && CloudAuth.accessToken) ? CloudAuth.accessToken() : '';
    if(jwt) headers['Authorization'] = `Bearer ${jwt}`;
    if(isLead) headers['x-mums-pilot'] = pilotEnabled ? 'overall_stats' : 'off';

    try{
      const res = await fetch(`/api/overall_stats?${params.toString()}`, { headers });
      const json = await res.json().catch(()=>({ ok:false }));
      if(!res.ok || !json.ok){
        throw new Error(json.error || 'Unable to load overall stats.');
      }
      lastResponse = json;
    }catch(e){
      lastResponse = { ok:false, error: e.message || String(e) };
    }finally{
      loading = false;
      render(); // Render final UI with payload
    }
  }

  function render(){
    ensureEnterpriseStyles();
    const scrollPos = window.scrollY; // Capture scroll

    const rangeLabel = formatRangeLabel(dateRange);
    const kpis = lastResponse && lastResponse.kpis ? lastResponse.kpis : null;
    const members = lastResponse && Array.isArray(lastResponse.members) ? lastResponse.members : [];
    const trends = lastResponse && Array.isArray(lastResponse.trends) ? lastResponse.trends : [];
    const meta = lastResponse && lastResponse.meta ? lastResponse.meta : {};
    const totalMembers = meta.total_members || members.length || 0;
    const page = Math.floor(pageOffset / pageSize) + 1;
    const totalPages = Math.max(1, Math.ceil(totalMembers / pageSize));

    // TOP PERFORMER CROWN LOGIC: Auto-detect #1 based on strict performance sorting!
    let topPerformerId = null;
    if(members.length > 0 && sortDir === 'desc' && ['cases','total','call','mailbox','back_office'].includes(sortBy)){
        topPerformerId = members[0].id;
    }

    if(isLead && !pilotEnabled){
      root.innerHTML = `
        <div class="ovr-shell">
          <div class="ovr-glass-panel" style="text-align:center; padding: 60px 20px;">
            <div class="ovr-title" style="margin-bottom:10px;">Enterprise Analytics Pilot</div>
            <div class="ovr-subtitle" style="margin-bottom:24px;">Activate pilot mode to securely access your team's overall metrics and historical trends.</div>
            <label style="display:inline-flex; align-items:center; gap:12px; cursor:pointer; background:rgba(255,255,255,0.05); padding:10px 20px; border-radius:12px; border:1px solid rgba(255,255,255,0.1);">
              <span class="ovr-switch">
                <input type="checkbox" id="overallPilotToggle" />
                <span class="ovr-slider"></span>
              </span>
              <span style="font-weight:700; color:#f8fafc;">Enable Pilot Engine</span>
            </label>
          </div>
        </div>
      `;
      const toggle = root.querySelector('#overallPilotToggle');
      if(toggle){ toggle.addEventListener('change', ()=> updatePilotState(toggle.checked)); }
      return;
    }

    // SKELETON STATES
    const skeletonKPIs = `
      <div class="sk-card"><div class="sk-bar sk-lbl"></div><div class="sk-bar sk-val"></div></div>
      <div class="sk-card"><div class="sk-bar sk-lbl"></div><div class="sk-bar sk-val"></div></div>
      <div class="sk-card"><div class="sk-bar sk-lbl"></div><div class="sk-bar sk-val"></div></div>
      <div class="sk-card"><div class="sk-bar sk-lbl"></div><div class="sk-bar sk-val"></div></div>
      <div class="sk-card" style="grid-column: span 2;"><div class="sk-bar sk-lbl"></div><div class="sk-bar sk-val" style="height:60px; width:80%;"></div></div>
    `;
    const skeletonTable = Array.from({length: 5}).map(()=>`
      <tr class="sk-tr">
        <td class="sk-td"><div class="sk-bar sk-cell" style="width:70%;"></div><div class="sk-bar sk-cell" style="width:40%; height:10px; margin-top:6px;"></div></td>
        <td class="sk-td"><div class="sk-bar sk-cell"></div></td>
        <td class="sk-td"><div class="sk-bar sk-cell"></div></td>
        <td class="sk-td"><div class="sk-bar sk-cell"></div></td>
        <td class="sk-td"><div class="sk-bar sk-cell"></div></td>
        <td class="sk-td"><div class="sk-bar sk-cell"></div></td>
        <td class="sk-td"><div class="sk-bar sk-cell" style="height:24px;"></div></td>
        <td class="sk-td"><div class="sk-bar sk-cell" style="width:40px;"></div></td>
      </tr>
    `).join('');

    root.innerHTML = `
      <div class="ovr-shell">
        <div class="ovr-header-bar">
          <div>
            <h1 class="ovr-title">MISSION CONTROL: Overall Stats</h1>
            <div class="ovr-subtitle">High-level visibility for member workload, services, and activity distribution.</div>
          </div>
          <div style="display:flex; gap:12px; align-items:center;">
            <span class="ovr-badge">🗓️ ${UI.esc(rangeLabel)}</span>
            ${isLead ? `
              <label style="display:inline-flex; align-items:center; gap:8px; cursor:pointer;" title="Pilot Engine Active">
                <span class="ovr-switch">
                  <input type="checkbox" id="overallPilotInline" ${pilotEnabled ? 'checked' : ''} />
                  <span class="ovr-slider"></span>
                </span>
              </label>
            ` : ''}
            <button class="btn-glass btn-glass-ghost" id="overallExportBtn" type="button">📥 Export CSV</button>
          </div>
        </div>

        <div class="ovr-command-bar">
          <div class="ovr-filter-group" style="flex:2;">
             <div class="ovr-label" style="margin-bottom:6px;">Timeframe Presets</div>
             <div class="ovr-filter-group-row">
               ${[
                 ['current_week','Current Week'],
                 ['previous_week','Last Week'],
                 ['this_month','This Month'],
                 ['last_30_days','30 Days']
               ].map(([id,label])=>`
                 <button class="btn-glass ${activePreset===id?'btn-glass-active':'btn-glass-ghost'}" data-preset="${id}" type="button">${label}</button>
               `).join('')}
             </div>
          </div>
          
          <div class="ovr-filter-group" style="flex:2;">
             <div class="ovr-label" style="margin-bottom:6px;">Custom Range</div>
             <div class="ovr-filter-group-row">
                <input class="ovr-input" type="date" id="overallStartDate" value="${UI.esc(dateRange.start)}" style="flex:1; min-width:130px;" />
                <span style="color:#94a3b8; font-weight:900;">-</span>
                <input class="ovr-input" type="date" id="overallEndDate" value="${UI.esc(dateRange.end)}" style="flex:1; min-width:130px;" />
                <button class="btn-glass btn-glass-primary" id="overallApplyRange" type="button">Apply</button>
             </div>
          </div>

          ${(!isLead && (isAdmin || isSuper)) ? `
          <div class="ovr-filter-group">
             <div class="ovr-label" style="margin-bottom:6px;">Target Team</div>
             <select class="ovr-input" id="overallTeamSelect">
                ${teams.map(t=>`<option value="${UI.esc(t.id)}" ${t.id===selectedTeamId?'selected':''}>${UI.esc(t.label)}</option>`).join('')}
             </select>
          </div>
          ` : ''}
        </div>

        <div class="ovr-kpi-grid">
          ${loading ? skeletonKPIs : (kpis ? `
            <div class="ovr-kpi-card">
              <div class="ovr-kpi-label">Total Assigned Cases</div>
              <div class="ovr-kpi-val">${UI.esc(String(kpis.cases || 0))}</div>
              <div>${renderDeltaPill(kpis.cases, kpis.prev_cases)}</div>
            </div>
            <div class="ovr-kpi-card">
              <div class="ovr-kpi-label">Total Call Hours</div>
              <div class="ovr-kpi-val">${UI.esc(String(kpis.call_hours || 0))} <span style="font-size:16px; opacity:0.6;">HR</span></div>
              <div>${renderDeltaPill(kpis.call_hours, kpis.prev_call_hours, 'h')}</div>
            </div>
            <div class="ovr-kpi-card">
              <div class="ovr-kpi-label">Total Mailbox Hours</div>
              <div class="ovr-kpi-val">${UI.esc(String(kpis.mailbox_hours || 0))} <span style="font-size:16px; opacity:0.6;">HR</span></div>
              <div>${renderDeltaPill(kpis.mailbox_hours, kpis.prev_mailbox_hours, 'h')}</div>
            </div>
            <div class="ovr-kpi-card">
              <div class="ovr-kpi-label">Back Office Hours</div>
              <div class="ovr-kpi-val">${UI.esc(String(kpis.back_office_hours || 0))} <span style="font-size:16px; opacity:0.6;">HR</span></div>
              <div>${renderDeltaPill(kpis.back_office_hours, kpis.prev_back_office_hours, 'h')}</div>
            </div>
            <div class="ovr-kpi-card ovr-trend-card">
              <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                 <div>
                    <div class="ovr-kpi-label" style="text-align:left;">Aggregated Workload</div>
                    <div class="ovr-kpi-val" style="text-align:left; color:#38bdf8;">${UI.esc(String(kpis.total_hours || 0))} <span style="font-size:16px; opacity:0.6;">HR</span></div>
                    <div style="text-align:left;">${renderDeltaPill(kpis.total_hours, kpis.prev_total_hours, 'h')}</div>
                 </div>
                 <div style="width:120px; height:60px;">
                    ${buildTrendChart(trends)}
                 </div>
              </div>
            </div>
          ` : `
            <div class="ovr-kpi-card" style="grid-column: 1 / -1; padding:40px; color:#fca5a5; border-color:rgba(239,68,68,0.3);">
              ⚠️ System Error: Unable to compute core metrics. Please try adjusting the date range.
            </div>
          `)}
        </div>

        <div class="ovr-glass-panel" style="padding:0;">
          <div style="padding: 20px 24px; border-bottom: 1px solid rgba(255,255,255,0.05); display:flex; justify-content:space-between; flex-wrap:wrap; gap:16px; align-items:center; background:rgba(15,23,42,0.4);">
             <div>
                <h3 style="margin:0; font-size:16px; color:#f8fafc;">Roster Analytics Ledger</h3>
                <div class="ovr-subtitle" style="margin-top:2px;">Showing ${UI.esc(String(totalMembers))} agents • Page ${page} of ${totalPages}</div>
             </div>
             
             <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
                <input class="ovr-input" id="overallSearch" placeholder="🔍 Search agent..." value="${UI.esc(searchQuery)}" style="width:180px; padding:8px 12px; font-size:12px;" />
                <select class="ovr-input" id="overallSort" style="width:150px; padding:8px 12px; font-size:12px;">
                  <option value="name" ${sortBy==='name'?'selected':''}>Sort: A-Z</option>
                  <option value="cases" ${sortBy==='cases'?'selected':''}>Sort: Cases</option>
                  <option value="mailbox" ${sortBy==='mailbox'?'selected':''}>Sort: Mailbox</option>
                  <option value="call" ${sortBy==='call'?'selected':''}>Sort: Call Hrs</option>
                  <option value="total" ${sortBy==='total'?'selected':''}>Sort: Total Hrs</option>
                </select>
                <button class="btn-glass btn-glass-ghost" id="overallSortDir" style="padding:8px 12px;">${sortDir==='asc'?'Asc ▴':'Desc ▾'}</button>
             </div>
          </div>
          
          <div class="ovr-table-wrap" style="margin:0; border:none; border-radius:0;">
            <table class="ovr-table">
              <thead>
                <tr>
                  <th style="min-width:240px;">Agent Profile</th>
                  <th>Assigned Cases</th>
                  <th>Call Hrs</th>
                  <th>Mailbox Hrs</th>
                  <th>Back Office</th>
                  <th style="color:#38bdf8;">Overall Workload</th>
                  <th>7-Day Trend</th>
                  <th style="text-align:right;">Action</th>
                </tr>
              </thead>
              <tbody>
                ${loading ? skeletonTable : (members.length === 0 ? `<tr><td colspan="8" style="text-align:center; padding:40px; color:#94a3b8;">No data found for the selected parameters.</td></tr>` : 
                  members.map((r, idx)=>{
                    const teamLabel = (Config.teamById(r.teamId) || {}).label || r.teamLabel || r.teamId || '';
                    const isTop = topPerformerId && r.id === topPerformerId;
                    
                    return `
                    <tr class="ovr-row" data-row="${idx}">
                      <td>
                        <div style="font-weight:800; font-size:13px; color:#f8fafc; display:flex; align-items:center;">
                           ${isTop ? '<span class="ovr-crown" title="Top Performer">👑</span>' : ''}
                           ${UI.esc(r.name||r.username)}
                        </div>
                        <div style="font-size:11px; color:#94a3b8; margin-top:4px;">${UI.esc(teamLabel)}</div>
                      </td>
                      <td>
                         <span class="ovr-table-num">${UI.esc(String(r.caseCount||0))}</span>
                         ${renderDeltaPill(r.caseCount, r.prev_caseCount)}
                      </td>
                      <td>
                         <span class="ovr-table-num">${UI.esc(String(r.callH||0))}h</span>
                         ${renderDeltaPill(r.callH, r.prev_callH, 'h')}
                      </td>
                      <td>
                         <span class="ovr-table-num">${UI.esc(String(r.mailboxH||0))}h</span>
                         ${renderDeltaPill(r.mailboxH, r.prev_mailboxH, 'h')}
                      </td>
                      <td>
                         <span class="ovr-table-num">${UI.esc(String(r.backOfficeH||0))}h</span>
                         ${renderDeltaPill(r.backOfficeH, r.prev_backOfficeH, 'h')}
                      </td>
                      <td>
                         <span class="ovr-table-num" style="color:#38bdf8; font-size:16px;">${UI.esc(String(r.totalH||0))}h</span>
                         ${renderDeltaPill(r.totalH, r.prev_totalH, 'h')}
                      </td>
                      <td style="width:100px;">${buildSparkline(r.sparkline)}</td>
                      <td style="text-align:right;">
                         <button class="btn-glass btn-glass-ghost overall-detail-toggle" data-row="${idx}">Deep Dive ▾</button>
                      </td>
                    </tr>
                    <tr class="ovr-detail-row" id="overall-detail-${idx}" hidden>
                      <td colspan="8" class="ovr-detail-cell">
                        <div class="ovr-detail-panel">
                          <div>
                            <div style="font-size:18px; font-weight:900; color:#f8fafc; margin-bottom:4px;">${UI.esc(r.name||r.username)}</div>
                            <div class="ovr-badge" style="margin-bottom:16px;">Agent ID: ${UI.esc(r.id.slice(0,8))}</div>
                            <div class="small muted">Data Context: Includes explicitly scheduled blocks and implicitly logged cases within ${UI.esc(rangeLabel)}.</div>
                          </div>
                          <div style="background:rgba(2,6,23,0.5); padding:16px; border-radius:10px; border:1px solid rgba(255,255,255,0.05); display:flex; flex-direction:column; justify-content:center;">
                             <div class="ovr-label" style="margin-bottom:8px;">Momentum Graph (Last 7 Points)</div>
                             <div style="height:40px; width:100%;">
                                ${buildSparkline(r.sparkline)}
                             </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  `;
                  }).join('')
                )}
              </tbody>
            </table>
          </div>
          
          <div style="padding: 16px 24px; border-top: 1px solid rgba(255,255,255,0.05); display:flex; justify-content:space-between; align-items:center; background:rgba(15,23,42,0.6);">
             <div class="ovr-label">
                <select class="ovr-input" id="overallPageSize" style="padding:6px 10px; font-size:11px; width:auto; display:inline-block; margin-right:8px;">
                  ${[10,25,50,100].map(v=>`<option value="${v}" ${pageSize===v?'selected':''}>${v} rows</option>`).join('')}
                </select>
                per page
             </div>
             <div style="display:flex; gap:8px; align-items:center;">
                <button class="btn-glass btn-glass-ghost" id="overallPrevPage" ${page<=1 || loading ?'disabled':''} style="padding:6px 12px;">◀ Prev</button>
                <span style="font-size:12px; font-weight:800; color:#cbd5e1; margin:0 8px;">Page ${page} of ${totalPages}</span>
                <button class="btn-glass btn-glass-ghost" id="overallNextPage" ${page>=totalPages || loading ?'disabled':''} style="padding:6px 12px;">Next ▶</button>
             </div>
          </div>
        </div>

      </div>
    `;

    // Re-attach Events
    const teamSelect = root.querySelector('#overallTeamSelect');
    if(teamSelect){ teamSelect.addEventListener('change', ()=>{ selectedTeamId = teamSelect.value; pageOffset = 0; fetchStats(); }); }

    const exportBtn = root.querySelector('#overallExportBtn');
    if(exportBtn){
      exportBtn.addEventListener('click', ()=>{
        if(members.length === 0) return UI.toast('No data to export', 'warn');
        const csv = buildCsv(members);
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `mums_overall_stats_${dateRange.start}_to_${dateRange.end}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      });
    }

    root.querySelectorAll('[data-preset]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        activePreset = btn.getAttribute('data-preset');
        dateRange = presetRange(activePreset);
        pageOffset = 0;
        fetchStats();
      });
    });

    const applyBtn = root.querySelector('#overallApplyRange');
    if(applyBtn){
      applyBtn.addEventListener('click', ()=>{
        const start = root.querySelector('#overallStartDate').value;
        const end = root.querySelector('#overallEndDate').value;
        if(start && end){
          activePreset = 'custom';
          dateRange = { start, end, label: 'Custom' };
          pageOffset = 0;
          fetchStats();
        }
      });
    }

    let searchTimeout;
    const searchInput = root.querySelector('#overallSearch');
    if(searchInput){
      searchInput.addEventListener('input', ()=>{
        searchQuery = searchInput.value;
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(()=>{ pageOffset = 0; fetchStats(); }, 500);
      });
    }

    const sortSel = root.querySelector('#overallSort');
    if(sortSel){
      sortSel.addEventListener('change', ()=>{
        sortBy = sortSel.value;
        pageOffset = 0;
        fetchStats();
      });
    }
    const sortDirBtn = root.querySelector('#overallSortDir');
    if(sortDirBtn){
      sortDirBtn.addEventListener('click', ()=>{
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        pageOffset = 0;
        fetchStats();
      });
    }

    const pageSizeSel = root.querySelector('#overallPageSize');
    if(pageSizeSel){
      pageSizeSel.addEventListener('change', ()=>{
        pageSize = Number(pageSizeSel.value) || 10;
        pageOffset = 0;
        fetchStats();
      });
    }

    const prevBtn = root.querySelector('#overallPrevPage');
    const nextBtn = root.querySelector('#overallNextPage');
    if(prevBtn){ prevBtn.addEventListener('click', ()=>{ pageOffset = Math.max(0, pageOffset - pageSize); fetchStats(); }); }
    if(nextBtn){ nextBtn.addEventListener('click', ()=>{ pageOffset = pageOffset + pageSize; fetchStats(); }); }

    const pilotToggle = root.querySelector('#overallPilotInline');
    if(pilotToggle){
      pilotToggle.addEventListener('change', ()=>{ updatePilotState(pilotToggle.checked); });
    }

    // Toggle Details using requestAnimationFrame to prevent layout jumps
    root.querySelectorAll('.overall-detail-toggle').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const row = btn.getAttribute('data-row');
        const detail = root.querySelector(`#overall-detail-${CSS.escape(row)}`);
        if(!detail) return;
        
        requestAnimationFrame(() => {
          const open = !detail.hasAttribute('hidden');
          if(open){
            detail.setAttribute('hidden', '');
            btn.innerHTML = 'Deep Dive ▾';
            btn.classList.remove('btn-glass-active');
            btn.classList.add('btn-glass-ghost');
          }else{
            detail.removeAttribute('hidden');
            btn.innerHTML = 'Close ▴';
            btn.classList.add('btn-glass-active');
            btn.classList.remove('btn-glass-ghost');
          }
        });
      });
    });

    if(!loading) window.scrollTo(0, scrollPos);
  }

  // BOOT INITIAL FETCH
  render();
  fetchStats();
});