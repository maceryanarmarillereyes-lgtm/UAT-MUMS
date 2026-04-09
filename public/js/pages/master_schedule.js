/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */


(window.Pages = window.Pages || {});

// Master Schedule
// Enterprise UI/UX refresh + bug/perf fixes:
// - Avoid class collisions with My Schedule
// - Search + select + bulk apply
// - Dirty-state tracking + Save All
// - Event delegation for better performance

window.Pages.master_schedule = function(root){
  root.innerHTML = '<div class="small muted">Loading…</div>';

  (async()=>{
    const me = await Auth.requireUser();
    if(!me) return;

    const isSuper = me.role === Config.ROLES.SUPER_ADMIN;
    const isAdmin = isSuper || me.role === Config.ROLES.ADMIN;
    const isLead = me.role === Config.ROLES.TEAM_LEAD;

    if(!(isLead || isAdmin || isSuper) || !Config.can(me, 'view_master_schedule')){
      root.innerHTML = '<div class="h1">Master Schedule</div><div class="muted">You do not have access to this page.</div>';
      return;
    }

    let teamId = isLead ? me.teamId : (Config.TEAMS[0] && Config.TEAMS[0].id);

    const getMaster = (tid)=> Store.getTeamMaster(tid) || { updatedAt: 0, frequencyMonths: 1, members: {} };

    function membersForTeam(tid){
      const users = Store.getUsers();
      return users
        .filter(u=>u && u.teamId===tid && u.role===Config.ROLES.MEMBER)
        .sort((a,b)=>String(a.name||a.username||'').localeCompare(String(b.name||b.username||'')));
    }

    function normalizeMemberRule(cur){
      const safe = cur && typeof cur==='object' ? cur : {};
      const rest = Array.isArray(safe.restWeekdays) ? safe.restWeekdays : [];
      const restClean = rest.map(n=>Number(n)).filter(n=>Number.isFinite(n) && n>=0 && n<=6).slice(0,2);
      const startISO = String(safe.startISO || UI.manilaNow().isoDate);
      return { restWeekdays: restClean, startISO };
    }

    function fmtUpdated(ts){
      if(!ts) return '—';
      try{ return new Date(ts).toLocaleString('en-US', { timeZone: Config.TZ }); }
      catch(_){ return '—'; }
    }

    function esc(s){ return (UI && UI.esc) ? UI.esc(String(s??'')) : String(s??''); }

    // --- UI helpers (dirty state, selection, filtering)
    function rowInitial(row){
      try{ return JSON.parse(row.getAttribute('data-initial')||'{}'); }
      catch(_){ return {}; }
    }
    function rowCurrent(row){
      const start = row.querySelector('[data-field="start"]');
      const rest = Array.from(row.querySelectorAll('button.chipbtn.on'))
        .map(b=>Number(b.dataset.wd)).filter(n=>Number.isFinite(n));
      return { restWeekdays: rest, startISO: String(start?.value||'') };
    }
    function isDirty(row){
      const a = rowInitial(row);
      const b = rowCurrent(row);
      const ra = Array.isArray(a.restWeekdays)?a.restWeekdays:[];
      const rb = Array.isArray(b.restWeekdays)?b.restWeekdays:[];
      if(String(a.startISO||'') !== String(b.startISO||'')) return true;
      if(ra.length !== rb.length) return true;
      for(let i=0;i<ra.length;i++) if(Number(ra[i]) !== Number(rb[i])) return true;
      return false;
    }
    function refreshRowState(row){
      const btn = row.querySelector('[data-save]');
      const pill = row.querySelector('[data-dirty-pill]');
      const dirty = isDirty(row);
      if(btn){
        btn.disabled = !dirty;
        btn.classList.toggle('primary', dirty);
      }
      if(pill){
        pill.style.display = dirty ? 'inline-flex' : 'none';
      }
    }

    function selectedRows(){
      return Array.from(root.querySelectorAll('.ms-grid-row')).filter(r=>r.querySelector('input[type="checkbox"]')?.checked);
    }

    function refreshBulkBar(){
      const bulk = root.querySelector('#msBulk');
      const countEl = root.querySelector('#msBulkCount');
      const rows = selectedRows();
      if(!bulk) return;
      if(rows.length){
        bulk.classList.add('show');
        if(countEl) countEl.textContent = String(rows.length);
      }else{
        bulk.classList.remove('show');
        if(countEl) countEl.textContent = '0';
      }
    }

    function refreshSaveAll(){
      const btn = root.querySelector('#msSaveAll');
      if(!btn) return;
      const dirtyCount = Array.from(root.querySelectorAll('.ms-grid-row')).filter(isDirty).length;
      btn.disabled = dirtyCount===0;
      btn.textContent = dirtyCount ? `Save All (${dirtyCount})` : 'Save All';
    }

    function applyToRow(row, patch){
      if(!row) return;
      if(patch && typeof patch==='object'){
        if('startISO' in patch){
          const start = row.querySelector('[data-field="start"]');
          if(start) start.value = String(patch.startISO||'');
        }
        if('restWeekdays' in patch){
          const rest = Array.isArray(patch.restWeekdays) ? patch.restWeekdays : [];
          row.querySelectorAll('button.chipbtn').forEach(b=>{
            const wd = Number(b.dataset.wd);
            b.classList.toggle('on', rest.includes(wd));
          });
        }
      }
      refreshRowState(row);
    }

    function saveRow(row){
      const userId = row.getAttribute('data-id');
      const cur = rowCurrent(row);
      const payload = normalizeMemberRule(cur);
      Store.setMasterMember(teamId, userId, payload);

      const t = getMaster(teamId);
      if(!t.frequencyMonths) t.frequencyMonths = 1;
      t.updatedAt = Date.now();
      Store.setTeamMaster(teamId, t);
      Store.addLog({
        ts: Date.now(),
        teamId,
        actorId: me.id,
        actorName: me.name||me.username,
        action: 'MASTER_SCHEDULE_MEMBER',
        targetId: userId,
        msg: `${me.name||me.username} updated master rest days`,
        detail: `Member ${userId}`
      });

      row.setAttribute('data-initial', JSON.stringify(payload));
      refreshRowState(row);
    }

    function saveAll(){
      const rows = Array.from(root.querySelectorAll('.ms-grid-row')).filter(isDirty);
      if(!rows.length) return;
      rows.forEach(saveRow);
      // Update header updatedAt display
      const u = root.querySelector('#msUpdatedAt');
      if(u) u.textContent = fmtUpdated(getMaster(teamId).updatedAt);
      refreshSaveAll();
    }

    function render(){
      const master = getMaster(teamId);
      const team = Config.teamById(teamId);
      const list = membersForTeam(teamId);

      const updated = fmtUpdated(master.updatedAt);
      const freq = Number(master.frequencyMonths||1);
      const ruleLabel = 'Up to 2 rest days';

      root.innerHTML = `
        <div class="ms-shell" style="padding:20px 24px 0;box-sizing:border-box">
          <div class="ms-topbar">
            <div>
              <div class="h1" style="margin-bottom:4px">Master Schedule</div>
              <div class="small muted" style="max-width:920px">
                Configure fixed Rest Day rules per member. These rules gray-out members in Members Scheduling with an <b>ON REST DAY</b> notice.
              </div>
              <div class="ms-meta" style="margin-top:10px">
                <span class="badge">Team: <b style="color:var(--text)">${esc(team.label)}</b></span>
                <span class="badge">Last updated: <b id="msUpdatedAt" style="color:var(--text)">${esc(updated)}</b></span>
                <span class="badge">Rule: <b style="color:var(--text)">${esc(ruleLabel)}</b></span>
              </div>
            </div>

            <div class="ms-controls">
              ${isLead ? '' : `
                <label class="small">Team
                  <select class="input" id="msTeam">
                    ${Config.TEAMS.map(t=>`<option value="${t.id}" ${t.id===teamId?'selected':''}>${esc(t.label)}</option>`).join('')}
                  </select>
                </label>
              `}
              <label class="small">Frequency
                <select class="input" id="msFreq">
                  <option value="1" ${freq===1?'selected':''}>Monthly</option>
                  <option value="2" ${freq===2?'selected':''}>Every 2 months</option>
                  <option value="3" ${freq===3?'selected':''}>Every 3 months</option>
                  <option value="4" ${freq===4?'selected':''}>Quarterly</option>
                </select>
              </label>
              <button class="btn" type="button" id="openMembers">Open Members Scheduling</button>
            </div>
          </div>

          <div class="ms-toolbar">
            <div class="ms-toolbar-left">
              <div class="ms-search">
                <span class="small muted" style="font-weight:900">Search</span>
                <input class="input" id="msSearch" type="search" placeholder="Name or username" autocomplete="off" />
              </div>
              <div class="row" style="gap:10px;flex-wrap:wrap">
                <label class="row small" style="gap:8px"><input id="msSelectAll" type="checkbox" /> Select all</label>
              </div>
            </div>

            <div class="ms-toolbar-right">
              <button class="btn primary" type="button" id="msSaveAll" disabled>Save All</button>
            </div>
          </div>

          <div class="ms-bulk" id="msBulk">
            <div class="ms-bulk-title">
              Bulk edit <span class="badge" style="margin-left:8px"><b id="msBulkCount" style="color:var(--text)">0</b> selected</span>
            </div>
            <div class="ms-bulk-controls">
              <div>
                <div class="small muted" style="margin-bottom:6px">Rest day(s)</div>
                <div class="weekday-chips" id="msBulkRest">
                  ${UI.DAYS.map((d,i)=>`<button type="button" class="chipbtn" data-wd="${i}" title="${esc(d)}">${esc(d.slice(0,3))}</button>`).join('')}
                </div>
                <div class="small muted" style="margin-top:6px">Select up to 2.</div>
              </div>
              <div>
                <div class="small muted" style="margin-bottom:6px">Effective start</div>
                <input class="input" id="msBulkStart" type="date" value="${esc(UI.manilaNow().isoDate)}" />
              </div>
              <div class="ms-bulk-actions">
                <button class="btn" type="button" id="msBulkApply">Apply</button>
                <button class="btn primary" type="button" id="msBulkApplySave">Apply & Save</button>
                <button class="btn" type="button" id="msBulkClear">Clear</button>
              </div>
            </div>
          </div>

          <div class="ms-grid-wrap"><div class="card pad">
            <div class="ms-grid">
              <div class="ms-grid-head">
                <div></div>
                <div>Member</div>
                <div>Rest day(s)</div>
                <div>Effective start</div>
                <div style="text-align:right">Actions</div>
              </div>

              <div class="ms-grid-body">
                ${list.map(m=>{
                  const cur = normalizeMemberRule((master.members && master.members[m.id]) ? master.members[m.id] : { restWeekdays: [], startISO: UI.manilaNow().isoDate });
                  const initial = String(m.name||m.username||'?').trim().slice(0,1).toUpperCase();
                  const chips = UI.DAYS.map((d,i)=>{
                    const on = cur.restWeekdays.includes(i) ? 'on' : '';
                    return `<button type="button" class="chipbtn ${on}" data-wd="${i}" title="${esc(d)}">${esc(d.slice(0,3))}</button>`;
                  }).join('');
                  return `
                    <div class="ms-grid-row" data-id="${esc(m.id)}" data-q="${esc((m.name||'')+' '+(m.username||''))}" data-initial='${esc(JSON.stringify(cur))}'>
                      <div class="ms-check"><input type="checkbox" aria-label="Select member" /></div>
                      <div class="ms-user">
                        <div class="ms-avatar">${esc(initial)}</div>
                        <div class="ms-user-text">
                          <div class="ms-user-name">${esc(m.name||m.username)}</div>
                          <div class="small muted">${esc(m.username||'')}</div>
                          <span class="badge warn" data-dirty-pill style="display:none;margin-top:6px">Unsaved</span>
                        </div>
                      </div>
                      <div>
                        <div class="weekday-chips" data-field="rest">${chips}</div>
                        <div class="small muted" style="margin-top:6px">Up to 2.</div>
                      </div>
                      <div>
                        <input class="input" type="date" data-field="start" value="${esc(cur.startISO)}" />
                      </div>
                      <div class="ms-actions-cell">
                        <button class="btn" type="button" data-save="1" disabled>Save</button>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          </div>
          </div>
        </div>
      `;

      // Initialize row state
      Array.from(root.querySelectorAll('.ms-grid-row')).forEach(refreshRowState);
      refreshSaveAll();
      refreshBulkBar();

      // Controls
      if(!isLead){
        const sel = root.querySelector('#msTeam');
        if(sel) sel.onchange = ()=>{ teamId = sel.value; render(); };
      }
      const freqSel = root.querySelector('#msFreq');
      if(freqSel) freqSel.onchange = ()=>{
        const t = getMaster(teamId);
        t.frequencyMonths = Number(freqSel.value||1);
        t.updatedAt = Date.now();
        Store.setTeamMaster(teamId, t);
        Store.addLog({ ts: Date.now(), teamId, actorId: me.id, actorName: me.name||me.username, action: 'MASTER_SCHEDULE_FREQUENCY', msg: `${me.name||me.username} set master schedule frequency to ${t.frequencyMonths} month(s)`, detail: `Team ${teamId}` });
        // Update just the header timestamp without re-rendering list
        const u = root.querySelector('#msUpdatedAt');
        if(u) u.textContent = fmtUpdated(t.updatedAt);
      };

      const openMembers = root.querySelector('#openMembers');
      if(openMembers) openMembers.onclick = ()=>{ window.location.hash = '#members'; };

      // Search filtering (no re-render)
      const s = root.querySelector('#msSearch');
      if(s) s.oninput = ()=>{
        const q = String(s.value||'').trim().toLowerCase();
        Array.from(root.querySelectorAll('.ms-grid-row')).forEach(r=>{
          const hay = String(r.getAttribute('data-q')||'').toLowerCase();
          r.style.display = (!q || hay.includes(q)) ? '' : 'none';
        });
      };
    }

    // Event delegation (perf)
    root.onclick = (ev)=>{
      const t = ev.target;
      if(!t) return;

      // Save all
      if(t.id === 'msSaveAll'){
        ev.preventDefault();
        saveAll();
        return;
      }

      // Select all
      if(t.id === 'msSelectAll'){
        const on = !!t.checked;
        Array.from(root.querySelectorAll('.ms-grid-row')).forEach(r=>{
          const cb = r.querySelector('input[type="checkbox"]');
          if(cb) cb.checked = on;
        });
        refreshBulkBar();
        return;
      }

      // Bulk chips
      if(t.closest && t.closest('#msBulkRest') && t.classList.contains('chipbtn')){
        const wrap = t.closest('#msBulkRest');
        const isOn = t.classList.contains('on');
        if(isOn){ t.classList.remove('on'); return; }
        const onCount = wrap.querySelectorAll('button.chipbtn.on').length;
        if(onCount >= 2) return;
        t.classList.add('on');
        return;
      }

      // Row chips
      if(t.classList && t.classList.contains('chipbtn') && t.closest('.ms-grid-row')){
        const row = t.closest('.ms-grid-row');
        const wrap = t.closest('.weekday-chips');
        const isOn = t.classList.contains('on');
        if(isOn){
          t.classList.remove('on');
          refreshRowState(row);
          refreshSaveAll();
          return;
        }
        const onCount = wrap ? wrap.querySelectorAll('button.chipbtn.on').length : 0;
        if(onCount >= 2) return;
        t.classList.add('on');
        refreshRowState(row);
        refreshSaveAll();
        return;
      }

      // Row save
      if(t.dataset && t.dataset.save && t.closest('.ms-grid-row')){
        const row = t.closest('.ms-grid-row');
        ev.preventDefault();
        saveRow(row);
        // feedback
        const old = t.textContent;
        t.textContent = 'Saved';
        setTimeout(()=>{ t.textContent = old || 'Save'; }, 900);
        const u = root.querySelector('#msUpdatedAt');
        if(u) u.textContent = fmtUpdated(getMaster(teamId).updatedAt);
        refreshSaveAll();
        return;
      }

      // Bulk actions
      if(t.id === 'msBulkClear'){
        Array.from(root.querySelectorAll('.ms-grid-row input[type="checkbox"]')).forEach(cb=>cb.checked=false);
        refreshBulkBar();
        return;
      }

      if(t.id === 'msBulkApply' || t.id === 'msBulkApplySave'){
        const rest = Array.from(root.querySelectorAll('#msBulkRest button.chipbtn.on'))
          .map(b=>Number(b.dataset.wd)).filter(n=>Number.isFinite(n));
        const start = root.querySelector('#msBulkStart');
        const startISO = String(start?.value||UI.manilaNow().isoDate);

        const rows = selectedRows();
        rows.forEach(r=>applyToRow(r, { restWeekdays: rest, startISO }));
        refreshSaveAll();
        if(t.id === 'msBulkApplySave'){
          saveAll();
        }
        return;
      }
    };

    root.oninput = (ev)=>{
      const t = ev.target;
      if(!t) return;

      // date change
      if(t.matches && t.matches('input[type="date"][data-field="start"]')){
        const row = t.closest('.ms-grid-row');
        if(row){
          refreshRowState(row);
          refreshSaveAll();
        }
        return;
      }

      // selection change
      if(t.matches && t.matches('.ms-grid-row input[type="checkbox"]')){
        refreshBulkBar();
        return;
      }
    };

    render();
  })().catch((e)=>{
    try{ console.error(e); }catch(_){ }
    try{
      const msg = (e && (e.stack || e.message || e)) ? String(e.stack || e.message || e) : 'Unknown error';
      root.innerHTML = '<div class="h1">Master Schedule</div><div class="muted" style="white-space:pre-wrap">'+(UI&&UI.esc?UI.esc(msg):msg)+'</div>';
    }catch(_){ }
  });
};
