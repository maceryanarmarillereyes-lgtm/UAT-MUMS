/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */


(window.Pages=window.Pages||{}, window.Pages.logs = function(root){
  root.innerHTML = '<div class="small muted">Loading…</div>';
  (async()=>{
  const me = await Auth.requireUser();
  if(!me) return;

  const isSuper = me.role === Config.ROLES.SUPER_ADMIN;
  const isAdmin = isSuper || me.role === Config.ROLES.ADMIN;
  const isLead  = me.role === Config.ROLES.TEAM_LEAD;
  const canManager = isLead || isAdmin;

  let showAll = isAdmin ? true : false;
  if(isLead){
    showAll = localStorage.getItem('ums_logs_show_all') === '1';
  }

  let memberFilter = canManager ? (localStorage.getItem('mums_logs_member_filter') || '') : '';
  let errorsOnly = canManager ? (localStorage.getItem('mums_logs_errors_only') === '1') : false;

  root.innerHTML = `
    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-end">
      <div>
        <div class="h1">Activity Logs</div>
        <div class="muted">Audit trail for scheduling, users, announcements, mailbox actions, and system errors.</div>
      </div>
      <div class="row" style="gap:10px;flex-wrap:wrap;align-items:center;justify-content:flex-end">
        ${isLead ? `<label class="small row" style="gap:8px;align-items:center"><input type="checkbox" id="showAllCb" ${showAll?'checked':''}/> Show all users</label>` : ''}
        ${canManager ? `
          <select class="input" id="memberFilter" style="min-width:220px" title="Filter logs by member">
            <option value="">All members</option>
          </select>
          <button class="btn ghost" id="errOnlyBtn" type="button" title="Show only error logs">
            ⚠ Errors <span class="pill" id="errCount" style="margin-left:6px">0</span>
          </button>
        ` : ''}
        <input class="input" id="q" placeholder="Search..." style="min-width:220px" />
        ${canManager ? `<button class="btn ghost" id="autoFix" type="button" title="Safely remove resolved or duplicate error logs">Auto-fix</button>` : ''}
        <button class="btn" id="exportCsv" type="button">Export CSV</button>
      </div>
    </div>

    
    <div class="card" style="padding:12px;margin-top:12px;overflow:hidden">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div>
          <div style="font-weight:700">Sync Queue</div>
          <div class="small muted" id="syncQueueMeta">Queued offline changes (localStorage) will flush automatically on reconnect.</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn ghost" id="syncQueueRefresh" type="button">Refresh</button>
          <button class="btn" id="syncQueueFlush" type="button">Flush now</button>
        </div>
      </div>
      <div style="margin-top:10px" id="syncQueueBody" class="small"></div>
    </div>

    <div class="card" style="padding:12px;margin-top:12px;overflow:hidden">
      <div class="logs" id="logList"></div>
    </div>
  `;

  const listEl = root.querySelector('#logList');
  const qEl = root.querySelector('#q');
  const memberSel = root.querySelector('#memberFilter');
  const errBtn = root.querySelector('#errOnlyBtn');

  // ---- Sync Queue panel (offline-first diagnostics) ----
  const sqBody = root.querySelector('#syncQueueBody');
  const sqRefresh = root.querySelector('#syncQueueRefresh');
  const sqFlush = root.querySelector('#syncQueueFlush');

  function readSyncQueue(){
    try{
      if (window.Realtime && typeof Realtime.queueStatus === 'function'){
        return Realtime.queueStatus() || [];
      }
      const raw = localStorage.getItem('mums_sync_queue_v1');
      const obj = raw ? JSON.parse(raw) : {};
      const keys = Object.keys(obj||{});
      return keys.map(k=>({
        key: k,
        tries: Number((obj[k]||{}).tries||0),
        lastError: String((obj[k]||{}).lastError||'')
      })).sort((a,b)=>a.key.localeCompare(b.key));
    }catch(_){ return []; }
  }

  function renderSyncQueue(){
    if(!sqBody) return;
    const rows = readSyncQueue();
    if(!rows.length){
      sqBody.innerHTML = '<div class="muted">No queued items.</div>';
      return;
    }
    const html = `
      <div style="overflow:auto">
        <table class="table" style="width:100%">
          <thead>
            <tr>
              <th style="min-width:220px">Key</th>
              <th style="width:120px">Attempts</th>
              <th>Last error</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r=>`
              <tr>
                <td><code>${UI.esc(r.key)}</code></td>
                <td>${Number(r.tries||0)}</td>
                <td class="muted">${UI.esc(r.lastError||'')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
    sqBody.innerHTML = html;
  }

  if(sqRefresh) sqRefresh.addEventListener('click', renderSyncQueue);
  if(sqFlush) sqFlush.addEventListener('click', async ()=>{
    try{
      if(window.Realtime && typeof Realtime.flushQueue === 'function'){
        await Realtime.flushQueue('logs_ui');
        renderSyncQueue();
      }else{
        UI.toast('Realtime module not available.', { type:'warn' });
      }
    }catch(e){
      UI.toast('Flush failed: ' + String(e && e.message ? e.message : e), { type:'error' });
    }
  });

  // Auto-refresh on logs page — with cleanup on navigate away
  try{
    renderSyncQueue();
    const _logsTimer = setInterval(renderSyncQueue, 3000);
    const _logsStorageHandler = (e)=>{ if(e && e.key==='mums_sync_queue_v1') renderSyncQueue(); };
    window.addEventListener('storage', _logsStorageHandler);
    root._cleanup = ()=>{
      try{ clearInterval(_logsTimer); }catch(_){}
      try{ window.removeEventListener('storage', _logsStorageHandler); }catch(_){}
    };
  }catch(_){}


  const errCount = root.querySelector('#errCount');
  const autoFixBtn = root.querySelector('#autoFix');

  function teamOk(entry){
    if(isAdmin) return true;
    if(isLead) return showAll ? true : (entry.teamId === me.teamId);
    // MEMBER sees only team
    return entry.teamId === me.teamId;
  }

  function fmt(ts){
    const d = new Date(ts);
    const parts = UI.manilaParts(d);
    const pad = n => String(n).padStart(2,'0');
    return `${parts.isoDate} ${pad(parts.hh)}:${pad(parts.mm)}:${pad(parts.ss)}`;
  }

  function isErrorLog(e){
    try{
      const action = String(e.action||'').toUpperCase();
      if(action.includes('ERROR') || action.includes('FAIL') || action.includes('EXCEPTION')) return true;
      const d = `${e.detail||''} ${e.msg||''} ${e.action||''}`.toLowerCase();
      return d.includes('uncaught') || d.includes('typeerror') || d.includes('referenceerror') || d.includes('failed') || d.includes('error');
    }catch(_){ return false; }
  }

  function buildMemberOptions(){
    if(!canManager || !memberSel) return;
    const users = (Store.getUsers()||[]).slice().filter(u=>u && u.id);
    const teams = (Config && Array.isArray(Config.TEAMS)) ? Config.TEAMS : [];
    const visibleTeams = isAdmin
      ? teams
      : (showAll ? teams : teams.filter(t=>t && t.id === me.teamId));

    const map = {};
    visibleTeams.forEach(t=>{ map[t.id] = []; });
    users.forEach(u=>{
      if(!map[u.teamId]) return;
      map[u.teamId].push(u);
    });
    visibleTeams.forEach(t=>{
      map[t.id].sort((a,b)=>String(a.name||a.username||'').localeCompare(String(b.name||b.username||'')));
    });

    memberSel.innerHTML = `<option value="">All members</option>` + visibleTeams.map(t=>{
      const opts = (map[t.id]||[]).map(u=>`<option value="${UI.esc(u.id)}">${UI.esc(u.name||u.username||u.id)}</option>`).join('');
      return `<optgroup label="${UI.esc(t.label||t.id)}">${opts}</optgroup>`;
    }).join('');

    memberSel.value = memberFilter;
  }

  function currentLogs(){
    const q = (qEl && qEl.value ? String(qEl.value) : '').trim().toLowerCase();
    let logs = (Store.getLogs()||[]).filter(teamOk);

    if(memberFilter){
      logs = logs.filter(e=>e.actorId === memberFilter || e.targetId === memberFilter);
    }
    if(errorsOnly){
      logs = logs.filter(isErrorLog);
    }
    if(q){
      logs = logs.filter(e=>{
        const hay = `${e.action||''} ${e.actorName||''} ${e.targetName||''} ${e.detail||''} ${e.msg||''}`.toLowerCase();
        return hay.includes(q);
      });
    }
    return logs;
  }

  function render(){
    // update errors count (within current visibility scope)
    if(errCount && canManager){
      const cnt = (Store.getLogs()||[]).filter(teamOk).filter(isErrorLog).length;
      errCount.textContent = String(cnt||0);
      errCount.style.borderColor = cnt ? 'rgba(255,90,90,.35)' : 'rgba(255,255,255,.18)';
      errCount.style.background = cnt ? 'rgba(255,90,90,.10)' : 'rgba(255,255,255,.06)';
      errCount.style.color = cnt ? '#ff8b8b' : 'rgba(255,255,255,.85)';
    }
    if(errBtn && canManager){
      errBtn.classList.toggle('active', !!errorsOnly);
    }

    const logs = currentLogs();
    if(!logs.length){
      listEl.innerHTML = '<div class="muted">No logs to show.</div>';
      return;
    }

    listEl.innerHTML = logs.map(e=>{
      const teamClass = `team-${e.teamId||'morning'}`;
      const actor = UI.esc(e.actorName||'');
      const msgText = (e.detail || e.msg || e.action || '').toString();
      const msg = UI.esc(msgText);
      const tgt = e.targetName ? ` <span class="muted">→</span> <b>${UI.esc(e.targetName)}</b>` : '';
      const isErr = isErrorLog(e);
      const badge = isErr ? `<span class="pill" style="margin-left:8px;border-color:rgba(255,90,90,.35);background:rgba(255,90,90,.10);color:#ff7b7b">ERROR</span>` : '';
      const meta = isErr ? (()=>{
        const bits = [];
        if(e.build) bits.push(`build: ${String(e.build)}`);
        if(e.route) bits.push(`route: ${String(e.route)}`);
        if(e.file) bits.push(`file: ${String(e.file)}`);
        if(e.line) bits.push(`line: ${String(e.line)}:${String(e.col||0)}`);
        return bits.length ? `<div class="small muted" style="margin-top:6px;white-space:normal">${UI.esc(bits.join(' • '))}</div>` : '';
      })() : '';
      const stack = isErr && (e.stackTop || e.detail) ? `<details style="margin-top:8px"><summary class="small" style="cursor:pointer;font-weight:900">Developer details</summary><div class="small muted" style="margin-top:8px;white-space:pre-wrap">${UI.esc(String(e.detail||e.stackTop||''))}</div></details>` : '';
      return `
        <div class="logcard ${teamClass} ${isErr?'is-error':''}">
          <div class="small muted">${fmt(e.ts)}</div>
          <div class="detail">
            <div class="who"><b>${actor}</b>${tgt}${badge}</div>
            <div class="msg" style="margin-top:4px;white-space:pre-wrap">${msg}</div>
            ${meta}
            ${stack}
          </div>
        </div>
      `;
    }).join('');
  }

  // events
  qEl.addEventListener('input', render);

  const cb = root.querySelector('#showAllCb');
  if(cb){
    cb.addEventListener('change', ()=>{
      showAll = cb.checked;
      localStorage.setItem('ums_logs_show_all', showAll ? '1' : '0');
      // When scope changes, rebuild member filter options so they match the visible set.
      buildMemberOptions();
      // If previously selected member is now not visible, reset.
      if(memberSel && memberFilter){
        const ok = !!memberSel.querySelector(`option[value="${CSS.escape(memberFilter)}"]`);
        if(!ok){ memberFilter = ''; localStorage.setItem('mums_logs_member_filter',''); memberSel.value = ''; }
      }
      render();
    });
  }

  if(memberSel){
    memberSel.addEventListener('change', ()=>{
      memberFilter = String(memberSel.value||'');
      localStorage.setItem('mums_logs_member_filter', memberFilter);
      render();
    });
  }

  if(errBtn){
    errBtn.addEventListener('click', ()=>{
      errorsOnly = !errorsOnly;
      localStorage.setItem('mums_logs_errors_only', errorsOnly ? '1' : '0');
      render();
    });
  }

  if(autoFixBtn){
    autoFixBtn.addEventListener('click', ()=>{
      try{
        if(window.Store && Store.autoFixLogs){
          const stable = Number(localStorage.getItem('mums_syscheck_last_ok_ts')||0) || Number(window.__mumsBootTs||0) || 0;
          // Smart clear removes known-resolved errors only when we have a stability cut-off.
          Store.autoFixLogs(stable ? { clearResolvedBefore: stable, smartClearResolved: true } : { smartClearResolved: true });
        }
        if(window.UI && typeof UI.toast === 'function') UI.toast('Activity Logs auto-fix applied.');
      }catch(e){ console.error(e); }
      render();
    });
  }

  root.querySelector('#exportCsv').onclick = ()=>{
    const rows = [['ts','manila_time','team','actor','action','target','detail','msg']];
    currentLogs().forEach(e=>{
      rows.push([
        e.ts,
        fmt(e.ts),
        e.teamId||'',
        e.actorName||'',
        e.action||'',
        e.targetName||'',
        e.detail||'',
        e.msg||''
      ]);
    });
    UI.downloadCSV('activity_logs.csv', rows);
  };

  buildMemberOptions();
  render();
  })().catch((e)=>{
    try{ console.error(e); }catch(_){ }
    try{
      const msg = (e && (e.stack || e.message || e)) ? String(e.stack || e.message || e) : 'Unknown error';
      root.innerHTML = '<div class="h1">Activity Logs</div><div class="muted" style="white-space:pre-wrap">'+(UI&&UI.esc?UI.esc(msg):msg)+'</div>';
    }catch(_){ }
  });
});
