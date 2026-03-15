/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */
/* File: public/js/pages/distribution_monitoring.js */

// Phase 3: Command Center (Team Lead Monitoring Dashboard)
(function(){
  const UI = window.UI;
  const Config = window.Config;
  const CloudTasks = window.CloudTasks;

  // ENTERPRISE UPGRADE: Capture global user context for Team Isolation
  const currentUserRaw = (window.Auth && typeof window.Auth.getUser === 'function') ? window.Auth.getUser() : null;
  const currentUser = (currentUserRaw && typeof currentUserRaw === 'object') ? currentUserRaw : {};
  const currentUserRole = String(currentUser.role || '').toUpperCase();
  const currentUserTeamId = String(currentUser.teamId || currentUser.team_id || '').trim().toLowerCase();
  const currentUserDuty = String(currentUser.duty || '').trim().toLowerCase();

  function canView(){
    try{
      const user = (window.Auth && typeof window.Auth.getUser === 'function') ? window.Auth.getUser() : null;
      if(Config && typeof Config.can === 'function' && user) {
        return !!Config.can(user, 'view_distribution_monitoring');
      }
      const role = user ? String(user.role || '').toUpperCase() : '';
      return ['TEAM_LEAD','ADMIN','SUPER_ADMIN','SUPER_USER'].includes(role);
    }catch(_){ return false; }
  }

  function pctColor(pct){
    const v = Number(pct||0);
    if(v >= 80) return 'rgba(16, 185, 129, .85)';   // Green
    if(v >= 50) return 'rgba(56, 189, 248, .85)';   // Blue (Ongoing)
    return 'rgba(239, 68, 68, .85)';                // Red (Problem/Delayed)
  }

  function fmtDate(iso){
    try{
      if(!iso) return '';
      const d = new Date(iso);
      if(String(d) === 'Invalid Date') return String(iso);
      return d.toLocaleString();
    }catch(_){ return String(iso||''); }
  }

  function downloadBlob(blob, filename){
    try{
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || 'export.csv';
      document.body.appendChild(a);
      a.click();
      setTimeout(()=>{
        try{ URL.revokeObjectURL(url); }catch(_){ }
        try{ a.remove(); }catch(_){ }
      }, 500);
    }catch(_){ }
  }

  function buildModal(){
    return `
<div class="modal" id="distReassignModal" aria-hidden="true" style="background:rgba(2,6,23,0.85); backdrop-filter:blur(10px);">
  <div class="panel" style="max-width:720px; background:linear-gradient(145deg, rgba(15,23,42,0.95), rgba(2,6,23,0.98)); border:1px solid rgba(56,189,248,0.3); border-radius:16px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.7);">
    <div class="head" style="border-bottom: 1px solid rgba(255,255,255,0.06); padding:20px 24px;">
      <div>
        <div style="font-weight:900; letter-spacing:-0.5px; font-size:18px; color:#f8fafc; display:flex; align-items:center; gap:8px;">
          🔄 Transfer Pending Tasks
        </div>
        <div class="muted" id="distReassignSub" style="font-size:12px; margin-top:4px; color:#94a3b8;">Re-distribute workload to another team member</div>
      </div>
      <button class="btn ghost" data-action="close" style="color:#fca5a5; border:1px solid rgba(239,68,68,0.3);">✕ Cancel</button>
    </div>
    <div class="body" style="padding:24px;">
      <div class="grid" style="grid-template-columns:1fr 1fr; gap:16px;">
        <div style="background:rgba(255,255,255,0.02); padding:14px; border-radius:8px; border:1px solid rgba(255,255,255,0.05);">
          <div class="muted" style="font-size:11px; font-weight:800; text-transform:uppercase; margin-bottom:6px; color:#94a3b8;">📤 From</div>
          <div id="distReassignFrom" style="font-weight:900; color:#f8fafc; font-size:14px;"></div>
        </div>
        <div style="background:rgba(255,255,255,0.02); padding:14px; border-radius:8px; border:1px solid rgba(255,255,255,0.05);">
          <div class="muted" style="font-size:11px; font-weight:800; text-transform:uppercase; margin-bottom:6px; color:#94a3b8;">📥 To (Eligible Member)</div>
          <select class="input" id="distReassignTo" style="width:100%; background:rgba(2,6,23,0.5); border-color:rgba(148,163,184,0.3); color:#e2e8f0; border-radius:6px; padding:8px; outline:none;"></select>
        </div>
      </div>

      <div class="dist-items-wrap" style="margin-top:20px; border:1px solid rgba(148,163,184,0.2); border-radius:10px; background:rgba(15,23,42,0.6);">
        <div class="dist-items-head" style="padding:12px 14px; border-bottom:1px solid rgba(255,255,255,0.05);">
          <label class="dist-items-selectall" style="cursor:pointer; display:flex; align-items:center; gap:8px;">
            <input type="checkbox" id="distReassignSelectAll" style="width:16px; height:16px; accent-color:#38bdf8;"> 
            <span style="font-weight:800; color:#e2e8f0;">Select All Tasks</span>
          </label>
          <div class="muted" id="distReassignInfo" style="font-size:12px; font-weight:600; color:#38bdf8;"></div>
        </div>
        <div class="dist-items-scroll" style="max-height:260px; overflow-y:auto;">
          <table class="dist-items-table" style="width:100%; border-collapse:collapse;">
            <thead>
              <tr>
                <th style="width:46px; background:rgba(15,23,42,0.9); padding:10px;">Select</th>
                <th style="background:rgba(15,23,42,0.9); padding:10px;">Case Reference</th>
                <th style="background:rgba(15,23,42,0.9); padding:10px;">Site</th>
              </tr>
            </thead>
            <tbody id="distReassignItems"></tbody>
          </table>
        </div>
      </div>

      <div style="margin-top:20px; display:flex; justify-content:flex-end;">
        <button class="btn primary" id="distReassignConfirm" style="background:linear-gradient(145deg, #0ea5e9, #0284c7); border:none; padding:10px 24px; font-weight:800; font-size:13px; box-shadow:0 4px 12px rgba(14,165,233,0.3); border-radius:8px;">Execute Transfer 🚀</button>
      </div>
    </div>
  </div>
</div>`;
  }

  function page(root){
    if(!root) return;

    if(!canView()){
      root.innerHTML = `
        <div class="card" style="background:rgba(15,23,42,0.5); border:1px solid rgba(239,68,68,0.3); padding:20px; border-radius:12px;">
          <div class="card-head"><div class="card-title" style="color:#fca5a5;">🛑 Access Denied</div></div>
          <div class="card-body" style="color:#e2e8f0;">You do not have administrative or lead privileges to view the Command Center.</div>
        </div>`;
      return;
    }

    root.innerHTML = `
      <div class="card" style="background:transparent; border:none; padding:0;">
        <div class="card-head" style="display:flex; align-items:flex-end; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:20px; border-bottom:1px solid rgba(255,255,255,0.05); padding-bottom:16px;">
          <div>
            <div class="card-title" style="font-size:24px; font-weight:900; color:#f8fafc; letter-spacing:-0.5px;">📡 Command Center</div>
            <div class="muted" style="margin-top:6px; color:#94a3b8; font-size:13px;">Team Lead monitoring interface for workload progress, blocking issues, and dynamic transfers.</div>
          </div>
          <div style="display:flex; gap:8px; align-items:center;">
            ${currentUserRole === 'TEAM_LEAD' ? `<span style="background:rgba(56,189,248,0.1); border:1px solid rgba(56,189,248,0.2); padding:6px 12px; border-radius:8px; color:#38bdf8; font-size:12px; font-weight:800;">Filtered to: ${currentUser.duty || currentUser.teamId || 'Your Team'}</span>` : ''}
            <button class="btn" id="ccRefresh" style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); border-radius:8px; font-weight:700;">🔄 Sync Dashboard</button>
          </div>
        </div>
        <div class="card-body" style="padding:0;">
          <div id="ccList"></div>
          <div style="display:flex;justify-content:center;margin-top:20px">
            <button class="btn ghost" id="ccLoadMore" style="background:rgba(15,23,42,0.6); border-radius:999px;">Load more history (20)</button>
          </div>
        </div>
      </div>
      ${buildModal()}
    `;

    const modal = UI.el('#distReassignModal');
    if(modal){
      modal.addEventListener('click', (e)=>{
        const btn = e.target.closest('[data-action]');
        if(!btn) return;
        const act = btn.getAttribute('data-action');
        if(act === 'close') UI.closeModal('distReassignModal');
      });
    }

    const state = {
      limit: 20,
      offset: 0,
      loading: false,
      done: false,
      dists: [],
      team_roster: [],
      modalCtx: null,
    };

    const elList = UI.el('#ccList');
    const btnMore = UI.el('#ccLoadMore');
    const btnRefresh = UI.el('#ccRefresh');

    function render(){
      const elDistList = UI.el('#ccList');
      if(!elDistList) return;

      const html = [];
      if(!state.dists.length){
        html.push(`<div class="task-empty" style="padding:40px; text-align:center; border:1px dashed rgba(255,255,255,0.1); border-radius:12px; color:#94a3b8;">No active distributions found. Click sync to update.</div>`);
      }

      state.dists.forEach((d)=>{
        let members = Array.isArray(d.members) ? d.members : [];
        
        // ==========================================
        // ENTERPRISE UPGRADE: STRICT TEAM ISOLATION 
        // ==========================================
        if (currentUserRole === 'TEAM_LEAD') {
            members = members.filter(m => {
                const mTeamId = String(m.team_id || m.teamId || '').trim().toLowerCase();
                const mDuty = String(m.duty || m.shift || '').trim().toLowerCase();
                
                let isMatch = false;
                if (currentUserTeamId && mTeamId && currentUserTeamId === mTeamId) isMatch = true;
                if (currentUserDuty && mDuty && currentUserDuty === mDuty) isMatch = true;
                
                return isMatch;
            });
            
            // SECURITY: If the team lead has zero members involved in this specific batch, hide it entirely!
            if (members.length === 0) return;
        }

        // RECALCULATE localized totals strictly based on VISIBLE members
        let dTotal = 0, dProb = 0, dPend = 0, dDone = 0;
        
        if (currentUserRole === 'TEAM_LEAD') {
            members.forEach(m => {
                dTotal += Number(m.total || 0);
                dDone += Number(m.completed || 0);
                dProb += Number(m.with_problem || 0);
            });
            dPend = dTotal - dDone;
        } else {
            // Admins see global totals
            dTotal = Number(d.totals?.total || 0);
            dProb = Number(d.totals?.with_problem || 0);
            dPend = Number(d.totals?.pending || 0);
        }

        const distId = String(d.id || '');
        const distTitle = UI.esc(d.title || 'Untitled');
        const createdBy = UI.esc(d.created_by_name || 'System');

        html.push(`
          <div class="enterprise-dist-card">
            <div class="dist-header">
              <div class="dist-info">
                <div class="dist-badge">BATCH ID: ${UI.esc(distId ? distId.slice(0, 8) : 'N/A')}</div>
                <h3 class="dist-title">${distTitle}</h3>
                <div class="dist-meta">Deployer: <b>${createdBy}</b> • ${UI.esc(fmtDate(d.created_at))}</div>
              </div>
              <div class="dist-actions">
                <button class="btn tiny primary" data-export="${UI.esc(distId)}" style="background:rgba(56,189,248,0.1); border:1px solid rgba(56,189,248,0.4); color:#38bdf8; font-weight:800; border-radius:6px; box-shadow:none;">CSV Export</button>
              </div>
            </div>
            
            <div class="dist-summary-pills">
              <div class="s-pill blue">Tasks: ${dTotal}</div>
              <div class="s-pill ${dProb > 0 ? 'red pulse' : 'gray'}">Problems: ${dProb}</div>
              <div class="s-pill gold">Pending: ${dPend}</div>
            </div>
            
            <div class="member-grid-compact">
              ${members.map((m)=>{
                const mTotal = Number(m.total||0);
                const mDone = Number(m.completed||0);
                const pct = mTotal > 0 ? Math.min(100, Math.round((mDone / mTotal) * 100)) : 0;
                
                return `
                  <div class="member-mini-card">
                    <div class="m-info">
                      <span class="m-name">${UI.esc(m.name || 'Unknown')}</span>
                      <span class="m-stat">${mDone}/${mTotal} tasks</span>
                    </div>
                    <div class="m-progress-wrap">
                      <div class="m-progress-bar" style="width:${pct}%; background:${pctColor(pct)}"></div>
                    </div>
                    <div class="m-actions">
                      ${(m.with_problem||0) > 0 ? '<span class="err-dot" title="Has Problem"></span>' : ''}
                      <button class="m-manage-btn" data-manage="${UI.esc(distId)}" data-from="${UI.esc(m.user_id || '')}">Transfer</button>
                    </div>
                  </div>`;
              }).join('')}
            </div>
          </div>
        `);
      });

      elDistList.innerHTML = `<div class="enterprise-dashboard-grid">${html.join('')}</div>`;

      if(!document.getElementById('cc-enterprise-styles')){
        const s = document.createElement('style');
        s.id = 'cc-enterprise-styles';
        s.textContent = `
          .enterprise-dashboard-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:20px; }
          .enterprise-dist-card { background:linear-gradient(145deg, rgba(30, 41, 59, 0.4), rgba(15,23,42,0.6)); backdrop-filter:blur(10px); border:1px solid rgba(255,255,255,0.08); border-radius:14px; padding:20px; transition:transform .2s ease, border-color .2s ease; box-shadow:0 8px 24px rgba(0,0,0,.15), inset 0 1px 0 rgba(255,255,255,0.02); }
          .enterprise-dist-card:hover { transform:translateY(-2px); border-color:rgba(56,189,248,.35); box-shadow:0 12px 30px rgba(0,0,0,.25); }
          .dist-header { display:flex; justify-content:space-between; gap:10px; margin-bottom:14px; align-items:flex-start; }
          .dist-info { min-width:0; }
          .dist-badge { font-size:10px; color:#38bdf8; font-weight:900; letter-spacing:.08em; background:rgba(56,189,248,0.1); padding:2px 8px; border-radius:4px; display:inline-block; margin-bottom:4px; }
          .dist-title { font-size:17px; font-weight:800; margin:4px 0; color:#f8fafc; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; letter-spacing:-0.5px; }
          .dist-meta { font-size:12px; color:#94a3b8; }
          .dist-summary-pills { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:16px; background:rgba(2,6,23,0.4); padding:10px; border-radius:8px; border:1px solid rgba(255,255,255,0.03); }
          .s-pill { padding:4px 10px; border-radius:6px; font-size:11px; font-weight:800; border:1px solid rgba(255,255,255,0.1); text-transform:uppercase; letter-spacing:0.5px; }
          .s-pill.blue { background:rgba(56, 189, 248, 0.1); color:#38bdf8; border-color:rgba(56,189,248,0.3); }
          .s-pill.red.pulse { background:rgba(239, 68, 68, 0.15); color:#fca5a5; border-color:rgba(239,68,68,0.4); box-shadow:0 0 10px rgba(239,68,68,0.2); }
          .s-pill.gray { background:rgba(148,163,184,.12); color:#94a3b8; border-color:transparent;}
          .s-pill.gold { background:rgba(245, 158, 11, .15); color:#fcd34d; border-color:rgba(245,158,11,0.3); }
          .member-grid-compact { display:flex; flex-direction:column; gap:8px; }
          .member-mini-card { background:rgba(15, 23, 42, 0.5); border:1px solid rgba(255,255,255,.04); border-radius:8px; padding:10px 14px; display:grid; grid-template-columns:minmax(0,1fr) 140px auto; align-items:center; gap:12px; transition:background 0.2s;}
          .member-mini-card:hover { background:rgba(30, 41, 59, 0.6); }
          .m-name { font-size:13px; font-weight:700; color:#e2e8f0; display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
          .m-stat { font-size:11px; color:#94a3b8; font-weight:600; }
          .m-progress-wrap { height:6px; background:rgba(2,6,23,0.8); border-radius:10px; overflow:hidden; border:1px solid rgba(255,255,255,0.02);}
          .m-progress-bar { height:100%; border-radius:10px; }
          .m-actions { display:flex; justify-content:flex-end; align-items:center; gap:10px; }
          .m-manage-btn { background:transparent; border:1px solid #0ea5e9; color:#38bdf8; font-size:11px; font-weight:700; padding:4px 10px; border-radius:6px; cursor:pointer; transition:all 0.2s; }
          .m-manage-btn:hover { background:#0ea5e9; color:#fff; box-shadow:0 4px 10px rgba(14,165,233,0.3); }
          .err-dot { width:10px; height:10px; background:#ef4444; border-radius:50%; display:inline-block; box-shadow:0 0 8px #ef4444; }
          
          @media (max-width: 1200px) {
            .enterprise-dashboard-grid { grid-template-columns:1fr; }
          }
          @media (max-width: 600px) {
            .member-mini-card { grid-template-columns:1fr; gap:8px;}
            .m-progress-wrap { width:100%; }
            .m-actions { justify-content:flex-start; margin-top:4px;}
          }
        `;
        document.head.appendChild(s);
      }

      btnMore.disabled = state.loading || state.done;
      btnMore.style.display = state.done ? 'none' : '';
    }

    async function loadNext(reset){
      if(state.loading) return;
      if(reset){
        state.offset = 0;
        state.dists = [];
        state.done = false;
      }
      state.loading = true;
      render();
      try{
        const out = await CloudTasks.monitoring(state.limit, state.offset);
        if(!out.ok){
          UI.toast(out.message || out.error || 'Failed to load monitoring data', { variant: 'danger' });
          state.loading = false;
          render();
          return;
        }
        const list = (out.data && out.data.distributions) ? out.data.distributions : [];
        const hasMore = !!(out.data && out.data.has_more);
        state.dists = state.dists.concat(list);
        if (out.data && out.data.team_roster) {
          state.team_roster = out.data.team_roster;
        }
        state.offset += list.length;
        state.done = !hasMore || list.length < state.limit;
      }catch(e){
        UI.toast(String(e && e.message ? e.message : e), { variant: 'danger' });
      }finally{
        state.loading = false;
        render();
      }
    }

    async function doExport(distId){
      const out = await CloudTasks.exportDistribution(distId, 'csv');
      if(!out.ok){
        UI.toast(out.message || 'Export failed', { variant: 'danger' });
        return;
      }
      let name = `MUMS_CommandCenter_Export_${distId}.csv`;
      try{
        const cd = out.disposition || '';
        const m = cd.match(/filename\*=UTF-8''([^;]+)|filename=\"([^\"]+)\"|filename=([^;]+)/i);
        const fn = m ? (m[1] || m[2] || m[3]) : '';
        if(fn) name = decodeURIComponent(String(fn).trim());
      }catch(_){ }
      downloadBlob(out.blob, name);
    }

    function getModalSelectedItemIds(){
      const tbody = UI.el('#distReassignItems');
      if(!tbody) return [];
      return Array.from(tbody.querySelectorAll('input[data-item-id]:checked'))
        .map((el)=>String(el.getAttribute('data-item-id') || '').trim())
        .filter(Boolean);
    }

    function syncSelectAllState(){
      const tbody = UI.el('#distReassignItems');
      const allEl = UI.el('#distReassignSelectAll');
      const infoEl = UI.el('#distReassignInfo');
      const btn = UI.el('#distReassignConfirm');
      const total = tbody ? Number(tbody.getAttribute('data-total') || 0) : 0;
      const selected = getModalSelectedItemIds().length;
      if(infoEl) infoEl.textContent = `Selected ${selected} of ${total} pending task(s)`;
      if(btn) btn.disabled = selected <= 0;
      if(allEl){
        allEl.checked = total > 0 && selected === total;
        allEl.indeterminate = selected > 0 && selected < total;
      }
    }

    function openManageModal(distId, fromUserId){
      const dist = state.dists.find((d)=>String(d.id)===String(distId));
      if(!dist) return;
      const members = Array.isArray(dist.members) ? dist.members : [];
      const from = members.find((m)=>String((m && (m.user_id || m.id)) || '')===String(fromUserId));
      if(!from) return;

      const toSel = UI.el('#distReassignTo');
      const fromEl = UI.el('#distReassignFrom');
      const subEl = UI.el('#distReassignSub');
      const infoEl = UI.el('#distReassignInfo');
      const tbody = UI.el('#distReassignItems');
      const allEl = UI.el('#distReassignSelectAll');

      const fromMemberId = String((from && (from.user_id || from.id)) || '').trim();
      fromEl.textContent = `${from.name || fromMemberId} (${fromMemberId})`;
      subEl.textContent = `${dist.title || 'Distribution'} • Select tasks to isolate & transfer`;

      const globalTeamRoster = {};
      if (Array.isArray(state.team_roster)) {
        state.team_roster.forEach(m => {
          const mid = String(m.user_id || m.id || '').trim();
          if(mid) globalTeamRoster[mid] = m;
        });
      }
      
      state.dists.forEach(d => {
        if(Array.isArray(d.members)){
          d.members.forEach(m => {
            const mid = String(m.user_id || m.id || '').trim();
            if(mid && !globalTeamRoster[mid]) globalTeamRoster[mid] = m;
          });
        }
      });
      
      // ==========================================
      // ENTERPRISE UPGRADE: DROPDOWN TARGET ISOLATION
      // ==========================================
      const opts = Object.values(globalTeamRoster)
        .filter((m) => {
          const isSelf = String(m.user_id || m.id || '').trim() === String(fromMemberId);
          const mTeamId = String(m.team_id || m.teamId || '').trim().toLowerCase();
          const mDuty = String(m.duty || m.shift || '').trim().toLowerCase();
          
          let isSameTeam = false;
          if (currentUserRole === 'TEAM_LEAD') {
              // Strictly force the list to match the Lead's team
              if (currentUserTeamId && mTeamId === currentUserTeamId) isSameTeam = true;
              if (currentUserDuty && mDuty === currentUserDuty) isSameTeam = true;
          } else {
              // Admin mode: Match the specific member's team
              const fromTeamId = String(from.team_id || from.teamId || '').trim().toLowerCase();
              const fromDuty = String(from.duty || from.shift || '').trim().toLowerCase();
              if (!fromTeamId && !fromDuty) isSameTeam = true; // allow fallback if completely null
              else {
                  if (fromTeamId && mTeamId === fromTeamId) isSameTeam = true;
                  if (fromDuty && mDuty === fromDuty) isSameTeam = true;
              }
          }
          return !isSelf && isSameTeam;
        })
        .sort((a,b) => (a.name || '').localeCompare(b.name || ''))
        .map((m) => {
          const memberId = String(m.user_id || m.id || '').trim();
          return `<option value="${UI.esc(memberId)}">${UI.esc(m.name || memberId)}</option>`;
        });
        
      toSel.innerHTML = opts.join('') || '<option value="">No other team members available in this shift</option>';

      const memberItems = Array.isArray(from.items) ? from.items : [];
      const pendingItems = memberItems.filter((it)=>String(it && it.status || '').trim().toLowerCase() === 'pending');
      if(tbody){
        tbody.setAttribute('data-total', String(pendingItems.length));
        if(!pendingItems.length){
          tbody.innerHTML = '<tr><td colspan="3" class="dist-item-empty" style="padding:20px;">No pending tasks left. Great job!</td></tr>';
        }else{
          tbody.innerHTML = pendingItems.map((it)=>{
            const itemId = String(it && it.id || '').trim();
            const caseNo = it && (it.case_number || it.case_no) ? String(it.case_number || it.case_no) : 'N/A';
            const site = it && it.site ? String(it.site) : 'N/A';
            return `
              <tr>
                <td><input class="dist-item-checkbox" type="checkbox" data-item-id="${UI.esc(itemId)}"></td>
                <td style="font-weight:700; color:#f8fafc;">${UI.esc(caseNo)}</td>
                <td style="color:#cbd5e1;">${UI.esc(site)}</td>
              </tr>`;
          }).join('');
        }
      }

      if(allEl){
        allEl.checked = false;
        allEl.indeterminate = false;
      }

      const pendingCount = pendingItems.length;
      infoEl.textContent = `Selected 0 of ${pendingCount} pending task(s)`;

      state.modalCtx = { distribution_id: distId, from_user_id: fromMemberId, pending: pendingCount };
      UI.openModal('distReassignModal');

      const btn = UI.el('#distReassignConfirm');
      btn.disabled = pendingCount <= 0 || !opts.length;
    }

    async function confirmTransfer(){
      const ctx = state.modalCtx;
      if(!ctx) return;
      const toUser = String((UI.el('#distReassignTo') && UI.el('#distReassignTo').value) || '').trim();
      if(!toUser){
        UI.toast('Select an eligible team member first', { variant: 'danger' });
        return;
      }

      const btn = UI.el('#distReassignConfirm');
      btn.disabled = true;
      try{
        const selectedItemIds = getModalSelectedItemIds();
        if(!selectedItemIds.length){
          UI.toast('Select at least one task to transfer.', { variant: 'danger' });
          btn.disabled = false;
          return;
        }
        const out = await CloudTasks.reassignPending({
          distribution_id: ctx.distribution_id,
          from_user_id: ctx.from_user_id,
          to_user_id: toUser,
          selected_item_ids: selectedItemIds
        });
        if(!out.ok){
          UI.toast(out.message || out.error || 'Transfer protocol failed', { variant: 'danger' });
          btn.disabled = false;
          return;
        }
        UI.toast(`Successfully routed ${out.data && out.data.moved != null ? out.data.moved : 0} tasks to the new agent.`, { variant: 'success' });
        UI.closeModal('distReassignModal');
        await loadNext(true);
      }catch(e){
        UI.toast(String(e && e.message ? e.message : e), { variant: 'danger' });
        btn.disabled = false;
      }
    }

    // Delegated click handlers
    elList.addEventListener('click', (e)=>{
      const ex = e.target.closest('[data-export]');
      if(ex){
        e.preventDefault();
        doExport(ex.getAttribute('data-export'));
        return;
      }
      const mg = e.target.closest('[data-manage]');
      if(mg){
        e.preventDefault();
        const distId = mg.getAttribute('data-manage');
        const from = mg.getAttribute('data-from');
        openManageModal(distId, from);
        return;
      }
    });

    UI.el('#distReassignConfirm').addEventListener('click', (e)=>{
      e.preventDefault();
      confirmTransfer();
    });

    const selectAllEl = UI.el('#distReassignSelectAll');
    if(selectAllEl){
      selectAllEl.addEventListener('change', ()=>{
        const tbody = UI.el('#distReassignItems');
        if(!tbody) return;
        const checks = tbody.querySelectorAll('input[data-item-id]');
        checks.forEach((el)=>{ el.checked = !!selectAllEl.checked; });
        syncSelectAllState();
      });
    }

    const itemsBodyEl = UI.el('#distReassignItems');
    if(itemsBodyEl){
      itemsBodyEl.addEventListener('change', (e)=>{
        const cb = e.target.closest('input[data-item-id]');
        if(!cb) return;
        syncSelectAllState();
      });
    }

    btnMore.addEventListener('click', (e)=>{
      e.preventDefault();
      loadNext(false);
    });

    btnRefresh.addEventListener('click', (e)=>{
      e.preventDefault();
      loadNext(true);
    });

    // Initial load
    loadNext(true);

    return () => {
      try{ UI.closeModal('distReassignModal'); }catch(_){ }
    };
  }

  window.Pages = window.Pages || {};
  window.Pages['distribution_monitoring'] = page;
})();
