/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */


/* File: public/js/pages/team_config.js */

(window.Pages=window.Pages||{}, window.Pages.team_config = function(root){
  const me = Auth.getUser();
  if(!me) return;

  if(!Config.can(me,'manage_team_config') && me.role!==Config.ROLES.SUPER_ADMIN){
    root.innerHTML = `<div class="card pad"><div class="h2">Access denied</div><div class="muted">You do not have permission to access Team Task Settings.</div></div>`;
    return;
  }

  const isSuper = me.role===Config.ROLES.SUPER_ADMIN;
  let teamId = isSuper
    ? (localStorage.getItem('mums_teamcfg_last_team') || (Config.TEAMS[0] && Config.TEAMS[0].id))
    : me.teamId;

  // In-memory draft so edits feel realtime; only committed on Save.
  let draft = null; // { schedule:{start,end}, tasks:[...], coverageTaskId }
  let draftTeamId = null;

  const weekStartISO = (function(){
    try{
      const ms = UI.manilaWeekStartMondayMs();
      const parts = UI.manilaParts(new Date(ms));
      return parts.isoDate;
    }catch(_){ return ''; }
  })();

  function slugify(s){
    return String(s||'')
      .trim()
      .toLowerCase()
      .replace(/['"]/g,'')
      .replace(/[^a-z0-9]+/g,'_')
      .replace(/^_+|_+$/g,'')
      .slice(0, 42);
  }

  function resolveAssignId(label, existingIds){
    // 1) If label matches a known schedule label, use that schedule ID (stable + consistent).
    try{
      const hay = String(label||'').trim().toLowerCase();
      const schedules = (window.Config && Config.SCHEDULES) ? Config.SCHEDULES : {};
      for(const id in schedules){
        const sc = schedules[id];
        if(!sc) continue;
        const l = String(sc.label||'').trim().toLowerCase();
        if(l && l === hay) return id;
      }
    }catch(_){}

    // 2) Otherwise, derive a stable slug and de-dupe.
    const base = slugify(label) || ('task_'+Math.random().toString(16).slice(2,8));
    let id = base;
    let n = 2;
    while(existingIds && existingIds.has(id)){
      id = `${base}_${n++}`;
    }
    return id;
  }

  function ensureDraft(){
    if(draft && draftTeamId===teamId) return;
    const cfg = Store.getTeamConfig(teamId);
    const tasks = (cfg.tasks||[]).map(t=>({
      id: String(t.id||'').trim(),
      label: String(t.label||'').trim(),
      desc: String(t.desc||t.description||'').trim(),
      color: String(t.color||'#64748b')
    })).filter(t=>t.id && t.label);

    draft = {
      schedule: { start: cfg.schedule.start, end: cfg.schedule.end },
      tasks,
      coverageTaskId: String(cfg.coverageTaskId||'call_onqueue'),
      wfhReasons: Array.isArray(cfg.wfhReasons) ? cfg.wfhReasons.slice() : ['Health','Internet Issue','Family Emergency','Weather','Other'],
      mailboxBuckets: Array.isArray(cfg.mailboxBuckets) ? cfg.mailboxBuckets.map((b,i)=>({
        id: String(b && b.id ? b.id : ('b'+i)),
        start: String(b && b.start ? b.start : '00:00'),
        end: String(b && b.end ? b.end : '00:00')
      })) : []
    };
    draftTeamId = teamId;
  }

  function log(action, detail, targetId, targetName){
    try{
      Store.addLog({
        ts: Date.now(),
        teamId,
        actorId: me.id,
        actorName: me.name||me.username||me.id,
        targetId: targetId || '',
        targetName: targetName || '',
        action: String(action||'').toUpperCase(),
        detail: String(detail||'')
      });
    }catch(_){}
  }

  function audit(action, before, after){
    try{
      Store.addAudit({
        ts: Date.now(),
        teamId,
        weekStartISO,
        actorId: me.id,
        actorName: me.name||me.username||me.id,
        type: 'team_config',
        action: String(action||''),
        before: before || null,
        after: after || null
      });
    }catch(_){}
  }

  function exportConfig(){
    ensureDraft();
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      teamId,
      schedule: draft.schedule,
      coverageTaskId: draft.coverageTaskId,
      tasks: draft.tasks,
      wfhReasons: (draft.wfhReasons||[]),
      mailboxBuckets: (draft.mailboxBuckets||[])
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `team_config_${teamId}_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>{ try{ URL.revokeObjectURL(url); }catch(_){ } }, 1500);
    log('TEAMCFG_EXPORT', `Exported team configuration (${teamId}).`);
  }

  function importConfig(file){
    if(!file) return;
    const reader = new FileReader();
    reader.onload = ()=>{
      try{
        const obj = JSON.parse(String(reader.result||'{}'));
        if(!obj || typeof obj !== 'object') throw new Error('Invalid JSON');
        const next = {
          schedule: {
            start: String(obj.schedule?.start||'').trim() || draft.schedule.start,
            end: String(obj.schedule?.end||'').trim() || draft.schedule.end
          },
          coverageTaskId: String(obj.coverageTaskId||draft.coverageTaskId||'').trim(),
          tasks: Array.isArray(obj.tasks) ? obj.tasks.map(t=>({
            id: String(t.id||'').trim(),
            label: String(t.label||'').trim(),
            desc: String(t.desc||t.description||'').trim(),
            color: String(t.color||'#64748b')
          })).filter(t=>t.id && t.label) : draft.tasks,
          wfhReasons: Array.isArray(obj.wfhReasons) ? obj.wfhReasons.map(x=>String(x||'').trim()).filter(Boolean).slice(0,30) : (draft.wfhReasons||[]),
          mailboxBuckets: Array.isArray(obj.mailboxBuckets) ? obj.mailboxBuckets.map((b,i)=>({
            id: String(b && b.id ? b.id : ('b'+i)),
            start: String(b && b.start ? b.start : '00:00'),
            end: String(b && b.end ? b.end : '00:00')
          })).slice(0,12) : (draft.mailboxBuckets||[])
        };

        // Validate unique ids
        const seen = new Set();
        for(const t of next.tasks){
          if(seen.has(t.id)) throw new Error('Task IDs must be unique.');
          seen.add(t.id);
        }

        const before = Store.getTeamConfig(teamId);
        Store.setTeamSchedule(teamId, next.schedule.start, next.schedule.end);
        Store.setTeamTasks(teamId, next.tasks);
        Store.setTeamCoverageTask(teamId, next.coverageTaskId || (next.tasks[0] && next.tasks[0].id) || 'call_onqueue');
        try{ Store.setTeamWFHReasons && Store.setTeamWFHReasons(teamId, next.wfhReasons||[]); }catch(_){ }
        try{ Store.setTeamMailboxBuckets && Store.setTeamMailboxBuckets(teamId, next.mailboxBuckets||[]); }catch(_){ }

        audit('import', before, Store.getTeamConfig(teamId));
        log('TEAMCFG_IMPORT', `Imported team configuration (${teamId}).`);

        // Reset draft from store
        draft = null;
        ensureDraft();
        render();
        UI.toast('Team configuration imported.');
      }catch(err){
        console.error(err);
        UI.toast('Import failed. Please verify the JSON format.');
      }
    };
    reader.readAsText(file);
  }

  function render(){
    ensureDraft();
    const team = Config.teamById(teamId);

    const tasks = draft.tasks || [];
    const coverageId = draft.coverageTaskId || (tasks[0] && tasks[0].id) || 'call_onqueue';

    root.innerHTML = `
      <div class="row" style="justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap">
        <div>
          <div class="h2" style="margin:0">Team Task Settings</div>
          <div class="small muted">Configure schedule window, task catalog (with colors + descriptions), and Coverage Meter defaults per team. Stored locally per browser.</div>
        </div>
        <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap">
          ${isSuper ? `
            <span class="small muted">Team</span>
            <select class="input" id="tc_team" style="min-width:240px">
              ${Config.TEAMS.map(t=>`<option value="${t.id}" ${t.id===teamId?'selected':''}>${UI.esc(t.label)}</option>`).join('')}
            </select>
          ` : `<div class="badge">Team: ${UI.esc(team.label)}</div>`}
          <button class="btn" id="tc_export" type="button">Export</button>
          <label class="btn" style="cursor:pointer;display:inline-flex;align-items:center;gap:8px">
            Import <input id="tc_import" type="file" accept="application/json" style="display:none" />
          </label>
        </div>
      </div>

      <div class="grid2" style="margin-top:12px">
        <div class="card pad">
          <div class="h3" style="margin:0 0 10px">Team Time Schedule</div>
          <div class="small muted" style="margin-bottom:10px">Controls the shift window used across Members scheduling, coverage meter, and timelines.</div>
          <div class="row" style="gap:10px;align-items:flex-end;flex-wrap:wrap">
            <label class="field" style="min-width:180px">
              <div class="label">Start</div>
              <input class="input" id="tc_start" type="time" value="${UI.esc(draft.schedule.start)}">
            </label>
            <label class="field" style="min-width:180px">
              <div class="label">End</div>
              <input class="input" id="tc_end" type="time" value="${UI.esc(draft.schedule.end)}">
            </label>
            <div class="row" style="gap:8px;margin-left:auto">
              <button class="btn" id="tc_reset_sched" type="button">Reset</button>
              <button class="btn primary" id="tc_save_sched" type="button">Save</button>
            </div>
          </div>
          <div class="small muted" style="margin-top:8px">Note: If End is earlier than Start, the shift is treated as crossing midnight.</div>
        </div>

        <div class="card pad">
          <div class="h3" style="margin:0 0 10px">Coverage Meter Default</div>
          <div class="small muted" style="margin-bottom:10px">Choose the task that counts toward "Call" coverage in the meter (per hour).</div>
          <div class="row" style="gap:10px;align-items:flex-end;flex-wrap:wrap">
            <label class="field" style="min-width:260px;flex:1">
              <div class="label">Standard Meter Task</div>
              <select class="input" id="tc_cov_task">
                ${tasks.map(t=>`<option value="${UI.esc(t.id)}" ${t.id===coverageId?'selected':''}>${UI.esc(t.label)}</option>`).join('')}
              </select>
            </label>
            <button class="btn primary" id="tc_save_cov" type="button">Save</button>
          </div>
        </div>
      </div>


      <div class="card pad" style="margin-top:12px">
        <div class="row" style="justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap">
          <div>
            <div class="h3" style="margin:0">Mailbox Counter Time Slots</div>
            <div class="small muted">Defines the column time windows used by the Mailbox Counter table (team-specific). If empty, the system auto-splits the shift window into 3 equal segments.</div>
            <div class="small" style="color:#fbbf24; font-weight:700; margin-top:6px; padding:6px; background:rgba(245,158,11,0.1); border-left:3px solid #fbbf24; border-radius:4px;">⚠️ PRO-TIP: We are now using Native Time Pickers. Make sure to input PM times correctly (e.g., 3:00 PM is saved as 15:00) to avoid ghost overlaps!</div>
          </div>
          <button class="btn" id="tc_mbx_add" type="button">Add Slot</button>
        </div>

        <div id="tc_mbx_slots" style="display:grid;gap:8px;margin-top:10px"></div>

        <div class="row" style="justify-content:flex-end;gap:10px;margin-top:10px;flex-wrap:wrap">
          <button class="btn" id="tc_mbx_reset" type="button">Reset</button>
          <button class="btn primary" id="tc_mbx_save" type="button">Save Slots</button>
        </div>
      </div>


      <div class="card pad" style="margin-top:12px">
        <div class="row" style="justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap">
          <div>
            <div class="h3" style="margin:0">WFH Reasons</div>
            <div class="small muted">These options appear in the mandatory Attendance prompt when a member selects Work From Home (team-specific).</div>
          </div>
          <button class="btn" id="tc_add_reason" type="button">Add Reason</button>
        </div>

        <div id="tc_reasons" style="display:grid;gap:8px;margin-top:10px"></div>

        <div class="row" style="justify-content:flex-end;gap:10px;margin-top:10px;flex-wrap:wrap">
          <button class="btn" id="tc_reset_reasons" type="button">Reset</button>
          <button class="btn primary" id="tc_save_reasons" type="button">Save Reasons</button>
        </div>
      </div>

      <div class="card pad" style="margin-top:12px">
        <div class="row" style="justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap">
          <div>
            <div class="h3" style="margin:0">Task Catalog</div>
            <div class="small muted">Tasks appear in the Members "Paint" dropdown for this team. <b>Assign ID</b> is auto-generated and hidden from users.</div>
          </div>
          <button class="btn primary" id="tc_add_task" type="button">Add Task</button>
        </div>

        <div class="tablewrap vscroll" style="margin-top:10px;overflow:auto">
          <table class="table">
            <thead>
              <tr>
                <th style="min-width:220px">Task Label</th>
                <th style="min-width:320px">Task Description</th>
                <th style="min-width:120px">Color</th>
                <th style="min-width:120px">Preview</th>
                <th style="width:140px">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${tasks.map((t,idx)=>`
                <tr data-idx="${idx}">
                  <td><b>${UI.esc(t.label||'')}</b></td>
                  <td class="small">${UI.esc(t.desc||'')}</td>
                  <td><input class="input" type="color" value="${UI.esc(t.color||'#64748b')}" data-color-idx="${idx}" style="height:34px;width:48px;padding:0;border-radius:10px"></td>
                  <td>
                    <span class="badge" style="background:${UI.esc(t.color||'#64748b')};color:${UI.esc((function(hex){ try{ const h=String(hex||'').replace('#',''); if(h.length!==6) return '#fff'; const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16); const lum=(0.2126*r+0.7152*g+0.0722*b)/255; return lum>0.62?'#111827':'#fff'; }catch(_){return '#fff';} })(t.color))};border:1px solid rgba(255,255,255,.10)">
                      ${UI.esc(t.label||'')}
                    </span>
                  </td>
                  <td>
                    <div class="row" style="gap:8px">
                      <button class="btn" type="button" data-edit="${idx}">Edit</button>
                      <button class="btn danger" type="button" data-del="${idx}">Delete</button>
                    </div>
                  </td>
                </tr>
              `).join('')}
              ${(!tasks.length) ? `<tr><td colspan="5" class="muted">No tasks configured.</td></tr>` : ''}
            </tbody>
          </table>
        </div>

        <div class="row" style="justify-content:flex-end;gap:10px;margin-top:10px;flex-wrap:wrap">
          <button class="btn" id="tc_reset_tasks" type="button">Reset to Defaults</button>
          <button class="btn primary" id="tc_save_tasks" type="button">Save Tasks</button>
        </div>
      </div>

      <div class="card pad" style="margin-top:12px">
        <div class="h3" style="margin:0 0 8px">Recommended Next Upgrades</div>
        <ul class="small muted" style="margin:0 0 0 18px;line-height:1.6">
          <li><b>Task templates per day</b>: define default blocks by role (e.g., lunch window) and apply with one click.</li>
          <li><b>Coverage thresholds per team</b>: different call targets for Morning/Mid/Night.</li>
          <li><b>Export/Import team config</b>: share configs between devices (JSON file).</li>
          <li><b>Audit log integration</b>: all changes in this page are logged to Activity Logs for traceability.</li>
          <li><b>Right sidebar UI</b>: align with the same enterprise design language (cards, spacing, typography).</li>
        </ul>
      </div>
    `;

    // Team switch (super)
    if(isSuper){
      const sel = UI.el('#tc_team');
      if(sel){
        sel.onchange = (e)=>{
          teamId = String(e.target.value||'');
          try{ localStorage.setItem('mums_teamcfg_last_team', teamId); }catch(_){}
          // reset draft for new team
          draft = null;
          draftTeamId = null;
          render();
        };
      }
    }

    // Export/Import
    UI.el('#tc_export').onclick = exportConfig;
    const imp = UI.el('#tc_import');
    if(imp){
      imp.onchange = ()=>{
        const f = imp.files && imp.files[0];
        if(!f) return;
        ensureDraft();
        importConfig(f);
        imp.value = '';
      };
    }

    // Schedule edits update draft immediately
    UI.el('#tc_start').oninput = (e)=>{ ensureDraft(); draft.schedule.start = e.target.value; };
    UI.el('#tc_end').oninput   = (e)=>{ ensureDraft(); draft.schedule.end = e.target.value; };

    UI.el('#tc_reset_sched').onclick = ()=>{
      const t = Config.teamById(teamId);
      ensureDraft();
      draft.schedule.start = t.teamStart;
      draft.schedule.end = t.teamEnd;
      render();
      UI.toast('Schedule reset to defaults.');
    };

    UI.el('#tc_save_sched').onclick = ()=>{
      ensureDraft();
      const before = Store.getTeamConfig(teamId);
      Store.setTeamSchedule(teamId, draft.schedule.start, draft.schedule.end);
      audit('schedule_save', before, Store.getTeamConfig(teamId));
      log('TEAMCFG_SCHEDULE_SAVE', `Saved team schedule (${draft.schedule.start}–${draft.schedule.end}).`);
      UI.toast('Team schedule saved.');
    };

    // Coverage
    UI.el('#tc_save_cov').onclick = ()=>{
      ensureDraft();
      const taskId = UI.el('#tc_cov_task').value;
      const before = Store.getTeamConfig(teamId);
      Store.setTeamCoverageTask(teamId, taskId);
      draft.coverageTaskId = taskId;
      audit('coverage_save', before, Store.getTeamConfig(teamId));
      log('TEAMCFG_COVERAGE_SAVE', `Saved coverage task: ${taskId}.`);
      UI.toast('Coverage Meter default saved.');
    };

    // Color changes (draft only)
    root.querySelectorAll('input[data-color-idx]').forEach(inp=>{
      inp.addEventListener('input', (e)=>{
        const idx = Number(e.target.getAttribute('data-color-idx'));
        if(!Number.isFinite(idx) || !draft.tasks[idx]) return;
        draft.tasks[idx].color = e.target.value;
        // Keep UI responsive without full re-render
        const tr = root.querySelector(`tr[data-idx="${idx}"]`);
        if(tr){
          const badge = tr.querySelector('.badge');
          if(badge) badge.style.background = e.target.value;
        }
      });
    });

    root.querySelectorAll('button[data-edit]').forEach(b=>{
      b.onclick = ()=>{
        const idx = Number(b.getAttribute('data-edit'));
        const t = draft.tasks[idx];
        if(!t) return;
        openTaskModal(idx, t);
      };
    });

    root.querySelectorAll('button[data-del]').forEach(b=>{
      b.onclick = async ()=>{
        const idx = Number(b.getAttribute('data-del'));
        const t = draft.tasks[idx];
        if(!t) return;
        const ok = await UI.confirm({ title:'Delete Task', message:`Delete task "${t.label}"?`, okText:'Delete', danger:true });
        if(!ok) return;
        draft.tasks.splice(idx, 1);

        // Keep coverage task valid
        if(draft.coverageTaskId && !draft.tasks.find(x=>x.id===draft.coverageTaskId)){
          draft.coverageTaskId = (draft.tasks[0] && draft.tasks[0].id) || 'call_onqueue';
        }
        render();
      };
    });


    // BOSS THUNTER: Upgraded standard to TYPE="TIME" to prevent the 3:00 AM format bug!
    const mbxWrap = UI.el('#tc_mbx_slots');
    function renderMbxSlots(){
      ensureDraft();
      if(!mbxWrap) return;
      const list = Array.isArray(draft.mailboxBuckets) ? draft.mailboxBuckets : [];
      mbxWrap.innerHTML = list.map((b,i)=>`
        <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap">
          <input class="input" type="time" data-mbx-start="${i}" value="${UI.esc(b.start||'')}" style="width:160px; font-weight:bold; color:#38bdf8;">
          <span class="muted">to</span>
          <input class="input" type="time" data-mbx-end="${i}" value="${UI.esc(b.end||'')}" style="width:160px; font-weight:bold; color:#38bdf8;">
          <input class="input" data-mbx-id="${i}" value="${UI.esc(b.id||('b'+i))}" placeholder="ID (optional)" style="width:140px">
          <button class="btn danger" type="button" data-mbx-del="${i}">Remove</button>
        </div>
      `).join('') || `<div class="muted">No custom slots set. Defaults will be used.</div>`;

      mbxWrap.querySelectorAll('input[data-mbx-start]').forEach(inp=>{
        inp.oninput = ()=>{
          const i = Number(inp.getAttribute('data-mbx-start'));
          if(!Number.isFinite(i)) return;
          draft.mailboxBuckets[i] = draft.mailboxBuckets[i] || {};
          draft.mailboxBuckets[i].start = String(inp.value||'').trim();
        };
      });
      mbxWrap.querySelectorAll('input[data-mbx-end]').forEach(inp=>{
        inp.oninput = ()=>{
          const i = Number(inp.getAttribute('data-mbx-end'));
          if(!Number.isFinite(i)) return;
          draft.mailboxBuckets[i] = draft.mailboxBuckets[i] || {};
          draft.mailboxBuckets[i].end = String(inp.value||'').trim();
        };
      });
      mbxWrap.querySelectorAll('input[data-mbx-id]').forEach(inp=>{
        inp.oninput = ()=>{
          const i = Number(inp.getAttribute('data-mbx-id'));
          if(!Number.isFinite(i)) return;
          draft.mailboxBuckets[i] = draft.mailboxBuckets[i] || {};
          draft.mailboxBuckets[i].id = String(inp.value||'').trim();
        };
      });
      mbxWrap.querySelectorAll('button[data-mbx-del]').forEach(btn=>{
        btn.onclick = async ()=>{
          const i = Number(btn.getAttribute('data-mbx-del'));
          if(!Number.isFinite(i)) return;
          const ok = await UI.confirm({ title:'Remove Slot', message:'Remove this mailbox time slot?', okText:'Remove', danger:true });
          if(!ok) return;
          draft.mailboxBuckets.splice(i, 1);
          renderMbxSlots();
        };
      });
    }
    renderMbxSlots();

    const mbxAddBtn = UI.el('#tc_mbx_add');
    if(mbxAddBtn){
      mbxAddBtn.onclick = ()=>{
        ensureDraft();
        draft.mailboxBuckets = Array.isArray(draft.mailboxBuckets) ? draft.mailboxBuckets : [];
        draft.mailboxBuckets.push({ id:'', start:'', end:'' });
        renderMbxSlots();
      };
    }

    const mbxResetBtn = UI.el('#tc_mbx_reset');
    if(mbxResetBtn){
      mbxResetBtn.onclick = ()=>{
        ensureDraft();
        draft.mailboxBuckets = [];
        renderMbxSlots();
        UI.toast('Mailbox slots reset.');
      };
    }

    const mbxSaveBtn = UI.el('#tc_mbx_save');
    if(mbxSaveBtn){
      mbxSaveBtn.onclick = ()=>{
        ensureDraft();
        const before = Store.getTeamConfig(teamId);
        const clean = (draft.mailboxBuckets||[]).map((b,i)=>({
          id: String(b.id||('b'+i)).trim() || ('b'+i),
          start: String(b.start||'').trim(),
          end: String(b.end||'').trim()
        })).filter(b=>b.start && b.end).slice(0,12);
        try{ Store.setTeamMailboxBuckets && Store.setTeamMailboxBuckets(teamId, clean); }catch(_){}
        audit('mailbox_slots_save', before, Store.getTeamConfig(teamId));
        log('TEAMCFG_MAILBOX_SLOTS_SAVE', `Saved ${clean.length} mailbox slot(s).`);
        UI.toast('Mailbox slots saved.');
        draft = null;
        ensureDraft();
        render();
      };
    }


    // WFH Reasons editor
    const reasonsWrap = UI.el('#tc_reasons');
    function renderReasons(){
      ensureDraft();
      if(!reasonsWrap) return;
      const list = Array.isArray(draft.wfhReasons) ? draft.wfhReasons : [];
      reasonsWrap.innerHTML = list.map((r, i)=>`
        <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap">
          <input class="input" data-reason-idx="${i}" value="${UI.esc(r)}" placeholder="e.g., Internet Issue" style="flex:1;min-width:220px">
          <button class="btn danger" type="button" data-reason-del="${i}">Remove</button>
        </div>
      `).join('') || `<div class="muted">No reasons configured.</div>`;

      reasonsWrap.querySelectorAll('input[data-reason-idx]').forEach(inp=>{
        inp.oninput = ()=>{
          const i = Number(inp.getAttribute('data-reason-idx'));
          if(!Number.isFinite(i)) return;
          draft.wfhReasons[i] = String(inp.value||'');
        };
      });
      reasonsWrap.querySelectorAll('button[data-reason-del]').forEach(btn=>{
        btn.onclick = async ()=>{
          const i = Number(btn.getAttribute('data-reason-del'));
          if(!Number.isFinite(i)) return;
          const val = String(draft.wfhReasons[i]||'').trim();
          const ok = await UI.confirm({ title:'Remove Reason', message:`Remove "${val||'this reason'}"?`, okText:'Remove', danger:true });
          if(!ok) return;
          draft.wfhReasons.splice(i, 1);
          renderReasons();
        };
      });
    }
    renderReasons();

    const addReasonBtn = UI.el('#tc_add_reason');
    if(addReasonBtn){
      addReasonBtn.onclick = ()=>{
        ensureDraft();
        draft.wfhReasons = Array.isArray(draft.wfhReasons) ? draft.wfhReasons : [];
        draft.wfhReasons.push('');
        renderReasons();
        try{
          const last = reasonsWrap && reasonsWrap.querySelector('input[data-reason-idx]:last-of-type');
          last && last.focus();
        }catch(_){}
      };
    }

    const resetReasonsBtn = UI.el('#tc_reset_reasons');
    if(resetReasonsBtn){
      resetReasonsBtn.onclick = ()=>{
        ensureDraft();
        draft.wfhReasons = ['Health','Internet Issue','Family Emergency','Weather','Other'];
        renderReasons();
        UI.toast('WFH Reasons reset.');
      };
    }

    const saveReasonsBtn = UI.el('#tc_save_reasons');
    if(saveReasonsBtn){
      saveReasonsBtn.onclick = ()=>{
        ensureDraft();
        const before = Store.getTeamConfig(teamId);
        const clean = (draft.wfhReasons||[])
          .map(x=>String(x||'').trim())
          .filter(Boolean)
          .slice(0, 30);
        Store.setTeamWFHReasons(teamId, clean);
        audit('wfh_reasons_save', before, Store.getTeamConfig(teamId));
        log('TEAMCFG_WFH_SAVE', `Saved ${clean.length} WFH reason(s).`);
        UI.toast('WFH Reasons saved.');
        // refresh draft
        draft = null;
        ensureDraft();
        render();
      };
    }

    UI.el('#tc_add_task').onclick = ()=> openTaskModal(-1, { id:'', label:'', desc:'', color:'#64748b' });

    UI.el('#tc_reset_tasks').onclick = ()=>{
      ensureDraft();
      const defs = Store._defaultTeamTasks().map(t=>({ id:t.id, label:t.label, desc:String(t.desc||''), color:t.color }));
      draft.tasks = defs;
      // keep coverage valid
      if(!draft.tasks.find(x=>x.id===draft.coverageTaskId)){
        draft.coverageTaskId = (draft.tasks[0] && draft.tasks[0].id) || 'call_onqueue';
      }
      render();
      UI.toast('Tasks reset to defaults.');
    };

    UI.el('#tc_save_tasks').onclick = ()=>{
      ensureDraft();
      const before = Store.getTeamConfig(teamId);

      // sanitize + ensure unique IDs
      const existingIds = new Set();
      const clean = [];
      for(const t of (draft.tasks||[])){
        const label = String(t.label||'').trim();
        const desc = String(t.desc||'').trim();
        const color = String(t.color||'#64748b');
        if(!label) continue;

        // Auto-assign id if missing (hidden field).
        const id = String(t.id||'').trim() || resolveAssignId(label, existingIds);
        if(existingIds.has(id)){
          UI.toast('Task IDs must be unique.');
          return;
        }
        existingIds.add(id);
        clean.push({ id, label, desc, color });
      }

      if(!clean.length){
        UI.toast('Add at least one task before saving.');
        return;
      }

      // Persist
      Store.setTeamTasks(teamId, clean);

      // Keep coverage valid and persist if needed
      const cov = draft.coverageTaskId;
      const covOk = clean.find(x=>x.id===cov);
      const nextCov = covOk ? cov : (clean[0] && clean[0].id) || 'call_onqueue';
      Store.setTeamCoverageTask(teamId, nextCov);

      // Update draft from persisted clean set
      draft.tasks = clean;
      draft.coverageTaskId = nextCov;

      audit('tasks_save', before, Store.getTeamConfig(teamId));
      log('TEAMCFG_TASKS_SAVE', `Saved ${clean.length} task(s).`);

      UI.toast('Tasks saved.');
      render();
    };
  }

  function openTaskModal(idx, task){
    const existing = document.getElementById('taskModal');
    if(existing) existing.remove();

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'taskModal';

    const list = (window.Config && Config.SCHEDULES) ? Object.values(Config.SCHEDULES) : [];
    const datalist = `
      <datalist id="taskLabelHints">
        ${list.map(s=>`<option value="${UI.esc(s.label||s.id)}"></option>`).join('')}
        <option value="Block"></option>
      </datalist>
    `;

    modal.innerHTML = `
      <div class="panel" style="max-width:560px">
        <div class="head">
          <div>
            <div class="announce-title">${idx>=0?'Edit Task':'Add Task'}</div>
            <div class="small muted">On save, Assign ID is auto-filled and hidden from users.</div>
          </div>
          <button class="btn ghost" type="button" id="tmClose">✕</button>
        </div>
        <div class="body" style="display:grid;gap:10px">
          ${datalist}
          <label class="field">
            <div class="label">Task Label</div>
            <input class="input" id="tmLabel" value="${UI.esc(task.label||'')}" placeholder="e.g., Mailbox Manager" list="taskLabelHints">
          </label>
          <label class="field">
            <div class="label">Task Description</div>
            <textarea class="input" id="tmDesc" rows="3" placeholder="Optional details shown in settings only">${UI.esc(task.desc||'')}</textarea>
          </label>
          <label class="field">
            <div class="label">Color</div>
            <input class="input" id="tmColor" type="color" value="${UI.esc(task.color||'#64748b')}" style="height:40px;width:64px;padding:0;border-radius:12px">
          </label>
          <div class="row" style="justify-content:flex-end;gap:8px;margin-top:4px">
            <button class="btn" id="tmCancel" type="button">Cancel</button>
            <button class="btn primary" id="tmSave" type="button">Save</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.classList.add('open');

    const close = ()=>{ modal.classList.remove('open'); modal.remove(); };
    modal.querySelector('#tmClose').onclick = close;
    modal.querySelector('#tmCancel').onclick = close;

    modal.querySelector('#tmSave').onclick = ()=>{
      ensureDraft();

      const label = modal.querySelector('#tmLabel').value.trim();
      const desc  = modal.querySelector('#tmDesc').value.trim();
      const color = modal.querySelector('#tmColor').value;

      if(!label){
        UI.toast('Task Label is required.');
        return;
      }

      // Auto-assign id (hidden)
      const existingIds = new Set(draft.tasks.map(t=>t.id).filter(Boolean));
      if(idx>=0 && draft.tasks[idx] && draft.tasks[idx].id) existingIds.delete(draft.tasks[idx].id);
      const id = resolveAssignId(label, existingIds);

      const obj = { id, label, desc, color };
      if(idx>=0) draft.tasks[idx] = obj; else draft.tasks.push(obj);

      close();
      render();
    };
  }

  render();
});