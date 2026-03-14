/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Strictly protects Enterprise UI/UX, Realtime Sync Logic, Core State Management, and Database/API Adapters. Do NOT modify existing logic or layout in this file without explicitly asking MACE for clearance. If overlapping changes are required, STOP and provide a RISK IMPACT REPORT first. */
(window.Pages=window.Pages||{}, window.Pages.team_reminders = function(root){
  try{ if(root && typeof root._cleanup === 'function') root._cleanup(); }catch(_){}

  

function debounce(fn, ms){
  let t=null;
  return function(...args){
    try{ if(t) clearTimeout(t); }catch(_){}
    t=setTimeout(()=>fn.apply(this,args), ms);
  };
}
const me = Auth.getUser();
  if(!me){ root.innerHTML = '<div class="card">No user session.</div>'; return; }
  if(!Config.can(me,'view_team_reminders')){
    root.innerHTML = `<div class="card"><h2 style="margin:0 0 6px">Team Reminders</h2><div class="small">You do not have access to this page.</div></div>`;
    return;
  }

  const KEY = 'mums_team_reminders';
  const KEY_SETTINGS = 'mums_reminder_settings';

  const canManage = Config.can(me,'manage_team_reminders') || Config.can(me,'manage_users') || Config.can(me,'manage_members');
  const canAdminSettings = (me.role === (Config?.ROLES?.SUPER_ADMIN || 'SUPER_ADMIN')) || (me.role === (Config?.ROLES?.ADMIN || 'ADMIN'));

  let editingId = null;
  let renderCleanup = null;

  function settings(){
    try{ return (Store.getReminderSettings && Store.getReminderSettings()) || { snoozePresets:[5,10,15,30], categories:['Work','Personal','Urgent'], escalationAfterMin:2, maxVisible:3 }; }
    catch(e){ return { snoozePresets:[5,10,15,30], categories:['Work','Personal','Urgent'], escalationAfterMin:2, maxVisible:3 }; }
  }
  function cats(){
    const s = settings();
    const c = Array.isArray(s.categories) ? s.categories : [];
    return c.length ? c : ['Work','Personal','Urgent'];
  }
  function catOptions(sel){
    const list = cats();
    const cur = String(sel||'');
    return ['<option value="">(None)</option>', ...list.map(c=>`<option value="${UI.esc(c)}" ${cur===c?'selected':''}>${UI.esc(c)}</option>`)].join('');
  }

  function msFromLocal(dtLocal){
    if(!dtLocal) return null;
    const t = new Date(dtLocal);
    const ms = t.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  function localFromMs(ms){
    try{
      const d = new Date(ms);
      const pad = (n)=>String(n).padStart(2,'0');
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }catch(e){ return ''; }
  }
  function fmt(ms){ try{ return new Date(ms).toLocaleString(); }catch(e){ return String(ms||''); } }

  function teamLabel(){
    return (Config.teamById && Config.teamById(me.teamId)?.label) || me.teamId || '—';
  }
  function teamMembers(){
    const users = (Store.getUsers && Store.getUsers()) || [];
    return users.filter(u => u && u.status==='active' && String(u.teamId)===String(me.teamId));
  }

  function computeStatusForMe(r, now){
    const st = (r.perUser && r.perUser[String(me.id)]) ? r.perUser[String(me.id)] : {};
    if(st && st.closedAt) return 'Closed';
    if(st && st.snoozeUntil && st.snoozeUntil>now) return 'Snoozed';
    const dueAt = (st && st.snoozeUntil && st.snoozeUntil>now) ? st.snoozeUntil : r.alarmAt;
    if(now >= Number(dueAt||0)) return 'Alarming';
    return 'Scheduled';
  }
  function statusBadgeClass(st){
    if(st==='Alarming') return 'danger';
    if(st==='Snoozed') return 'warn';
    if(st==='Scheduled') return 'ok';
    return 'neutral';
  }

  function repeatText(r){
    const rep = String(r.repeat||'none');
    if(rep==='daily') return 'Daily';
    if(rep==='weekly') return 'Weekly';
    if(rep==='custom') {
      const days = Array.isArray(r.repeatDays) ? r.repeatDays : [];
      const names = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      const s = days.map(d=>names[Number(d)]).filter(Boolean).join(', ');
      return s ? `Custom (${s})` : 'Custom';
    }
    return 'One-time';
  }

  function nextAlarmAtForReminder(r, now){
    const rep = String(r.repeat||'none');
    const base = Number(r.alarmAt||now);
    if(rep === 'none') return base;

    const baseDate = new Date(base);
    const hh = baseDate.getHours();
    const mm = baseDate.getMinutes();

    const makeCandidate = (d)=>{
      const dt = new Date(d);
      dt.setHours(hh, mm, 0, 0);
      return dt.getTime();
    };

    if(rep === 'daily'){
      let t = makeCandidate(now);
      if(t <= now + 500) t += 24*60*60*1000;
      return t;
    }
    if(rep === 'weekly'){
      const targetDow = baseDate.getDay();
      const d0 = new Date(now);
      d0.setHours(0,0,0,0);
      for(let i=0;i<14;i++){
        const d = new Date(d0.getTime() + i*24*60*60*1000);
        if(d.getDay() === targetDow){
          const t = makeCandidate(d.getTime());
          if(t > now + 500) return t;
        }
      }
      return base + 7*24*60*60*1000;
    }
    if(rep === 'custom'){
      const days = Array.isArray(r.repeatDays) ? r.repeatDays.map(x=>Number(x)).filter(x=>x>=0 && x<=6) : [];
      if(!days.length) return base;
      const set = new Set(days);
      const d0 = new Date(now);
      d0.setHours(0,0,0,0);
      for(let i=0;i<21;i++){
        const d = new Date(d0.getTime() + i*24*60*60*1000);
        if(set.has(d.getDay())){
          const t = makeCandidate(d.getTime());
          if(t > now + 500) return t;
        }
      }
      return base + 7*24*60*60*1000;
    }
    return base;
  }

  function getList(){
    return (Store.getTeamReminders && Store.getTeamReminders(me.teamId)) || [];
  }

  function ackSummary(r, members){
    const perUser = r.perUser || {};
    const ids = members.map(u=>String(u.id));
    const closed = ids.filter(id=> perUser[id] && perUser[id].closedAt).length;
    const snoozed = ids.filter(id=> perUser[id] && perUser[id].snoozeUntil && perUser[id].snoozeUntil>Date.now() && !perUser[id].closedAt).length;
    return { closed, snoozed, total: ids.length || 0 };
  }

  function computeKpis(list){
    const now = Date.now();
    const members = teamMembers();
    const counts = { Scheduled:0, Alarming:0, Snoozed:0, Closed:0 };
    let nextDue = null;
    list.forEach(r=>{
      const st = computeStatusForMe(r, now);
      counts[st] = (counts[st]||0) + 1;
      const mine = (r.perUser && r.perUser[String(me.id)]) ? r.perUser[String(me.id)] : {};
      const dueAt = (mine && mine.snoozeUntil && mine.snoozeUntil>now) ? mine.snoozeUntil : r.alarmAt;
      const ms = Number(dueAt||0);
      if(st !== 'Closed' && ms && (nextDue===null || ms < nextDue)) nextDue = ms;
    });
    const totalTeam = members.length || 0;
    return { counts, nextDue, totalTeam };
  }

  function render(){
    try{ if(typeof renderCleanup === 'function') renderCleanup(); }catch(_){}
    renderCleanup = null;

    const list = getList();
    const members = teamMembers();
    const k = computeKpis(list);

    const s = settings();
    const presets = Array.isArray(s.snoozePresets) ? s.snoozePresets : [5,10];

    root.innerHTML = `
      <div class="rem-page">
        <div class="rem-head">
          <div>
            <h2 class="title">Team Reminders</h2>
            <div class="sub">Team-wide reminders. Notifications appear on the top bar with a red outline.</div>
          </div>
          <div class="rem-actions">
            <div class="small muted" style="align-self:center">Team: ${UI.esc(teamLabel())} (${members.length})</div>
            <button class="btn ghost tiny" data-act="export">Export</button>
            ${canManage ? `<button class="btn ghost tiny" data-act="import">Import</button>` : ``}
          </div>
        </div>

        <div class="rem-kpis">
          <div class="rem-kpi"><div class="k">Scheduled</div><div class="v">${k.counts.Scheduled||0}</div><div class="h">Upcoming for you</div></div>
          <div class="rem-kpi"><div class="k">Alarming</div><div class="v">${k.counts.Alarming||0}</div><div class="h">Require your attention</div></div>
          <div class="rem-kpi"><div class="k">Snoozed</div><div class="v">${k.counts.Snoozed||0}</div><div class="h">Postponed by you</div></div>
          <div class="rem-kpi"><div class="k">Next</div><div class="v">${k.nextDue ? '⏱' : '—'}</div><div class="h">${k.nextDue ? UI.esc(fmt(k.nextDue)) : 'No upcoming reminders'}</div></div>
        </div>

        <div class="rem-layout">
          <div class="rem-panel">
            <div class="ph">
              <h3>${canManage ? (editingId ? 'Edit Team Reminder' : 'Create Team Reminder') : 'Permissions'}</h3>
              <div class="small muted">${canManage ? 'Visible to all team members. Each member must close individually.' : 'Only Team Leads (and above) can create or edit.'}</div>
            </div>
            <div class="pb">
              ${canManage ? `
              <div class="rem-field">
                <div class="lbl">Short Description</div>
                <input class="input" id="r_short" placeholder="e.g., Daily standup reminder" />
              </div>
              <div class="rem-field">
                <div class="lbl">Details</div>
                <textarea class="input" id="r_details" rows="3" placeholder="Add details..."></textarea>
              </div>

              <div class="rem-inline">
                <div class="rem-field">
                  <div class="lbl">Alarm Date & Time</div>
                  <input class="input" id="r_alarm" type="datetime-local" />
                </div>
                <div class="rem-field">
                  <div class="lbl">Alarm duration (minutes)</div>
                  <input class="input" id="r_duration" type="number" min="1" value="5" />
                </div>
              </div>

              <div class="rem-inline">
                <div class="rem-field">
                  <div class="lbl">Priority</div>
                  <select class="input" id="r_priority">
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                  </select>
                </div>
                <div class="rem-field">
                  <div class="lbl">Category</div>
                  <select class="input" id="r_category">${catOptions('')}</select>
                </div>
              </div>

              <div class="rem-field">
                <div class="lbl">Repeat</div>
                <select class="input" id="r_repeat">
                  <option value="none">One-time</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="custom">Custom (days)</option>
                </select>
              </div>

              <div class="rem-field" id="r_days_wrap" style="display:none">
                <div class="lbl">Repeat Days</div>
                <div class="rem-days">
                  <label class="rem-day"><input type="checkbox" class="rem-day-cb" data-day="0"> <span>Sun</span></label>
                  <label class="rem-day"><input type="checkbox" class="rem-day-cb" data-day="1"> <span>Mon</span></label>
                  <label class="rem-day"><input type="checkbox" class="rem-day-cb" data-day="2"> <span>Tue</span></label>
                  <label class="rem-day"><input type="checkbox" class="rem-day-cb" data-day="3"> <span>Wed</span></label>
                  <label class="rem-day"><input type="checkbox" class="rem-day-cb" data-day="4"> <span>Thu</span></label>
                  <label class="rem-day"><input type="checkbox" class="rem-day-cb" data-day="5"> <span>Fri</span></label>
                  <label class="rem-day"><input type="checkbox" class="rem-day-cb" data-day="6"> <span>Sat</span></label>
                </div>
              </div>

              <div class="row" style="justify-content:flex-end;gap:8px;margin-top:8px;flex-wrap:wrap">
                <button class="btn ghost tiny" id="r_cancel" ${editingId ? '' : 'disabled'}>Cancel</button>
                <button class="btn tiny" id="r_save">${editingId ? 'Save' : 'Add'}</button>
              </div>

              <div class="small" id="r_err" style="margin-top:10px;color:var(--danger);display:none"></div>
              <div class="small muted" style="margin-top:10px">Snooze presets: ${UI.esc(presets.join(', '))} minutes.</div>
              ` : `
              <div class="small">You can still acknowledge reminders when they trigger.</div>
              `}
            </div>
          </div>

          <div class="rem-panel">
            <div class="rem-filterbar">
              <div class="left">
                <div style="font-weight:800">Team Reminders</div>
                <span class="small muted">(${list.length})</span>
              </div>
              <div class="right">
                <input class="input" id="q" placeholder="Search..." style="min-width:220px" />
                <select class="input" id="status">
                  <option value="">All</option>
                  <option>Scheduled</option>
                  <option>Alarming</option>
                  <option>Snoozed</option>
                  <option>Closed</option>
                </select>
              </div>
            </div>

            <div class="pb" style="padding:0">
              <div style="overflow:auto">
                <table class="table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Reminder</th>
                      <th>Category</th>
                      <th>Priority</th>
                      <th>Repeat</th>
                      <th>Status (you)</th>
                      <th>Acknowledged</th>
                      <th style="width:300px">Actions</th>
                    </tr>
                  </thead>
                  <tbody id="rows"></tbody>
                </table>
              </div>
              <div class="rem-note">For repeating team reminders, the schedule advances only after all active team members close it.</div>
            </div>
          </div>
        </div>

        <div class="rem-layout" style="margin-top:-2px">
          <div></div>
          <div class="rem-panel">
            <div class="ph">
              <h3>Reminder Settings</h3>
              <div class="small muted">Global settings (Admin / Super Admin)</div>
            </div>
            <div class="pb">
              ${canAdminSettings ? `
                <div class="rem-inline">
                  <div class="rem-field">
                    <div class="lbl">Snooze presets (minutes, comma-separated)</div>
                    <input class="input" id="s_snooze" value="${UI.esc((Array.isArray(s.snoozePresets)?s.snoozePresets:[5,10,15,30]).join(','))}" />
                  </div>
                  <div class="rem-field">
                    <div class="lbl">Categories (comma-separated)</div>
                    <input class="input" id="s_cats" value="${UI.esc((Array.isArray(s.categories)?s.categories:['Work','Personal','Urgent']).join(','))}" />
                  </div>
                </div>
                <div class="rem-inline">
                  <div class="rem-field">
                    <div class="lbl">Escalation after (minutes)</div>
                    <input class="input" id="s_escalate" type="number" min="0" value="${UI.esc(String(Number(s.escalationAfterMin||2)))}" />
                  </div>
                  <div class="rem-field">
                    <div class="lbl">Max visible floating notifications</div>
                    <input class="input" id="s_max" type="number" min="1" max="10" value="${UI.esc(String(Number(s.maxVisible||3)))}" />
                  </div>
                </div>
                <div class="row" style="justify-content:flex-end;gap:8px;flex-wrap:wrap">
                  <button class="btn tiny" id="s_save">Save Settings</button>
                </div>
                <div class="small muted" id="s_msg" style="margin-top:10px;display:none"></div>
              ` : `
                <div class="small">Only Admin / Super Admin can edit these settings.</div>
                <div class="small muted" style="margin-top:8px">
                  Current snooze presets: ${UI.esc((Array.isArray(s.snoozePresets)?s.snoozePresets:[5,10,15,30]).join(', '))} minutes.
                  Escalation: ${UI.esc(String(Number(s.escalationAfterMin||2)))} minute(s).
                  Max visible: ${UI.esc(String(Number(s.maxVisible||3)))}.
                </div>
              `}
            </div>
          </div>
        </div>

        <div class="modal" id="teamRemModal">
          <div class="panel">
            <div class="head">
              <div>
                <div style="font-weight:900" id="m_title">Team Reminder</div>
                <div class="small muted" id="m_meta"></div>
              </div>
              <button class="btn ghost tiny" data-act="modal_close">Close</button>
            </div>
            <div class="body">
              <div class="rem-badges" style="margin-bottom:10px">
                <span class="rem-badge neutral" id="m_status">—</span>
                <span class="rem-badge neutral" id="m_repeat">—</span>
                <span class="rem-badge neutral" id="m_priority">—</span>
                <span class="rem-badge neutral" id="m_cat">—</span>
              </div>
              <div style="white-space:pre-wrap" id="m_details"></div>

              <div style="margin-top:14px">
                <div class="small muted" style="margin-bottom:8px">Acknowledgement status</div>
                <div style="overflow:auto">
                  <table class="table">
                    <thead>
                      <tr><th>Member</th><th>Status</th><th>Closed at</th></tr>
                    </thead>
                    <tbody id="m_ack"></tbody>
                  </table>
                </div>
              </div>

              <div class="row" style="justify-content:flex-end;gap:8px;margin-top:14px;flex-wrap:wrap" id="m_actions"></div>
            </div>
          </div>
        </div>
      </div>
    `;

    // Default alarm
    const alarm = UI.el('#r_alarm', root);
    if(alarm && !alarm.value){
      alarm.value = localFromMs(Date.now() + 5*60*1000);
    }

    // Form repeat days toggling
    const repeatSel = UI.el('#r_repeat', root);
    const daysWrap = UI.el('#r_days_wrap', root);
    const updateDaysVisibility = ()=>{
      if(!repeatSel || !daysWrap) return;
      const rep = String(repeatSel.value||'none');
      daysWrap.style.display = (rep==='custom') ? 'block' : 'none';
    };
    if(repeatSel){
      repeatSel.addEventListener('change', updateDaysVisibility);
      updateDaysVisibility();
    }

    function setErr(msg){
      const el = UI.el('#r_err', root);
      if(!el) return;
      if(msg){ el.style.display='block'; el.textContent=msg; }
      else { el.style.display='none'; el.textContent=''; }
    }

    function refreshTable(){
      const now = Date.now();
      const query = String(UI.el('#q', root).value||'').toLowerCase().trim();
      const st = String(UI.el('#status', root).value||'');
      const out = (getList()||[]).filter(r=>{
        const s = computeStatusForMe(r, now);
        if(st && s!==st) return false;
        if(!query) return true;
        return (String(r.short||'').toLowerCase().includes(query) || String(r.details||'').toLowerCase().includes(query));
      }).sort((a,b)=>{
        const sa = computeStatusForMe(a, now);
        const sb = computeStatusForMe(b, now);
        const rank = (x)=> x==='Alarming'?0 : x==='Snoozed'?1 : x==='Scheduled'?2 : 3;
        const ra = rank(sa), rb = rank(sb);
        if(ra!==rb) return ra-rb;
        if((a.priority||'normal')!==(b.priority||'normal')) return (a.priority==='high'?-1:1);
        const sta = (a.perUser && a.perUser[String(me.id)]) ? a.perUser[String(me.id)] : {};
        const stb = (b.perUser && b.perUser[String(me.id)]) ? b.perUser[String(me.id)] : {};
        const da = (sta && sta.snoozeUntil && sta.snoozeUntil>now) ? sta.snoozeUntil : a.alarmAt;
        const db = (stb && stb.snoozeUntil && stb.snoozeUntil>now) ? stb.snoozeUntil : b.alarmAt;
        return (da||0)-(db||0);
      });

      const tbody = UI.el('#rows', root);
      tbody.innerHTML = out.map(r=>{
        const s = computeStatusForMe(r, now);
        const my = (r.perUser && r.perUser[String(me.id)]) ? r.perUser[String(me.id)] : {};
        const when = fmt((my && my.snoozeUntil && my.snoozeUntil>now) ? my.snoozeUntil : r.alarmAt);
        const cat = String(r.category||'');
        const statusClass = statusBadgeClass(s);

        const sum = ackSummary(r, members);
        const ackText = `${sum.closed}/${sum.total}`;

        return `<tr data-remid="${UI.esc(r.id)}">
          <td>${UI.esc(when)}</td>
          <td>
            <div style="font-weight:800">${UI.esc(r.short||'')}</div>
            <div class="small muted" style="margin-top:2px;max-width:560px">${UI.esc((r.details||'').slice(0,120))}${(r.details||'').length>120?'…':''}</div>
          </td>
          <td>${UI.esc(cat||'—')}</td>
          <td>${UI.esc((r.priority||'normal').toUpperCase())}</td>
          <td>${UI.esc(repeatText(r))}</td>
          <td><span class="rem-badge ${statusClass}">${UI.esc(s)}</span></td>
          <td>${UI.esc(ackText)}</td>
          <td>
            <div class="actions">
              <button class="btn ghost tiny" data-act="view" data-id="${UI.esc(r.id)}">View</button>
              <button class="btn ghost tiny" data-act="snooze" data-id="${UI.esc(r.id)}" data-min="${UI.esc(String((presets[0]||10)))}">Snooze</button>
              <button class="btn ghost tiny" data-act="close" data-id="${UI.esc(r.id)}">Close</button>
              ${canManage ? `<button class="btn ghost tiny" data-act="edit" data-id="${UI.esc(r.id)}">Edit</button>` : ``}
              ${canManage ? `<button class="btn danger ghost tiny" data-act="del" data-id="${UI.esc(r.id)}">Delete</button>` : ``}
            </div>
          </td>
        </tr>`;
      }).join('') || `<tr><td colspan="8" class="small muted" style="padding:14px 12px">No reminders found.</td></tr>`;
    }

    UI.el('#q', root).addEventListener('input', debounce(refreshTable, 120));
    UI.el('#status', root).addEventListener('change', refreshTable);
    refreshTable();

    // Global search focus (highlight/scroll)
    function applyGlobalFocus(){
      try{
        const raw = localStorage.getItem('mums_global_focus');
        if(!raw) return;
        const f = JSON.parse(raw||'{}');
        if(!f || f.type !== 'teamReminder' || !f.id) return;
        setTimeout(()=>{
          try{
            const row = root.querySelector(`[data-remid="${CSS.escape(String(f.id))}"]`);
            if(row){
              row.scrollIntoView({ block:'center', behavior:'smooth' });
              row.classList.add('row-focus');
              setTimeout(()=>row.classList.remove('row-focus'), 2200);
            }
          }catch(_){}
        }, 120);
        // clear once applied
        localStorage.removeItem('mums_global_focus');
      }catch(_){}
    }
    try{ window.addEventListener('mums:globalFocus', applyGlobalFocus); }catch(_){}
    applyGlobalFocus();


    // Save / Cancel (only if canManage)
    if(canManage){
      UI.el('#r_cancel', root).addEventListener('click', (e)=>{
        e.preventDefault();
        editingId = null;
        render();
      });

      UI.el('#r_save', root).addEventListener('click', (e)=>{
        e.preventDefault();
        setErr('');

        const short = String(UI.el('#r_short', root).value||'').trim();
        const details = String(UI.el('#r_details', root).value||'').trim();
        const alarmAt = msFromLocal(UI.el('#r_alarm', root).value);
        const durationMin = Math.max(1, Number(UI.el('#r_duration', root).value||5));
        const priority = String(UI.el('#r_priority', root).value||'normal');
        const repeat = String(UI.el('#r_repeat', root).value||'none');
        const category = String(UI.el('#r_category', root).value||'').trim();

        let repeatDays = null;
        if(repeat==='custom'){
          const cbs = Array.from(root.querySelectorAll('.rem-day-cb'));
          const picked = cbs.filter(cb=>cb && cb.checked).map(cb=>Number(cb.getAttribute('data-day')));
          repeatDays = picked.filter(x=>Number.isFinite(x) && x>=0 && x<=6);
          if(!repeatDays.length) return setErr('Select at least one Repeat Day for Custom repeat.');
        }

        if(!short) return setErr('Short Description is required.');
        if(!alarmAt) return setErr('Alarm Date & Time is required.');

        const payload = { short, details, alarmAt, durationMin, priority, repeat, category, repeatDays };

        if(editingId){
          Store.updateTeamReminder(editingId, payload);
        }else{
          Store.addTeamReminder(me.teamId, me.id, payload);
        }
        editingId = null;
        render();
        try{ if(window.ReminderEngine && ReminderEngine.tickSoon) ReminderEngine.tickSoon(0); }catch(_){}
      });
    }

    // Settings save
    if(canAdminSettings){
      const s_save = UI.el('#s_save', root);
      if(s_save){
        s_save.addEventListener('click', (e)=>{
          e.preventDefault();
          const snooze = String(UI.el('#s_snooze', root).value||'');
          const catsStr = String(UI.el('#s_cats', root).value||'');
          const escalate = Math.max(0, Number(UI.el('#s_escalate', root).value||0));
          const max = Math.max(1, Math.min(10, Number(UI.el('#s_max', root).value||3)));

          const presets = snooze.split(',').map(s=>Math.max(1, Number(String(s).trim()||0))).filter(Boolean).slice(0,8);
          const categories = catsStr.split(',').map(s=>String(s).trim()).filter(Boolean).slice(0,12);

          Store.setReminderSettings({ snoozePresets: presets.length?presets:[5,10,15,30], categories: categories.length?categories:['Work','Personal','Urgent'], escalationAfterMin: escalate, maxVisible: max });

          const msg = UI.el('#s_msg', root);
          if(msg){ msg.style.display='block'; msg.textContent='Saved.'; setTimeout(()=>{ try{ msg.style.display='none'; }catch(_){} }, 1800); }
          try{ if(window.ReminderEngine && ReminderEngine.tickSoon) ReminderEngine.tickSoon(0); }catch(_){}
        });
      }
    }

    function openModal(r){
      const now = Date.now();
      const st = computeStatusForMe(r, now);
      UI.el('#m_title', root).textContent = r.short || 'Team Reminder';
      UI.el('#m_meta', root).textContent = fmt(r.alarmAt);
      UI.el('#m_details', root).textContent = r.details || '';
      UI.el('#m_status', root).textContent = st;
      UI.el('#m_status', root).className = 'rem-badge ' + statusBadgeClass(st);
      UI.el('#m_repeat', root).textContent = repeatText(r);
      UI.el('#m_priority', root).textContent = (r.priority||'normal').toUpperCase();
      UI.el('#m_cat', root).textContent = r.category ? r.category : '—';

      // ack table
      const perUser = r.perUser || {};
      const rows = members.map(u=>{
        const stU = perUser[String(u.id)] || {};
        const status = stU.closedAt ? 'Closed' : (stU.snoozeUntil && stU.snoozeUntil>Date.now() ? 'Snoozed' : 'Pending');
        const cls = status==='Closed' ? 'ok' : status==='Snoozed' ? 'warn' : 'neutral';
        const closedAt = stU.closedAt ? fmt(stU.closedAt) : '—';
        return `<tr><td>${UI.esc(u.name||u.email||u.id)}</td><td><span class="rem-badge ${cls}">${UI.esc(status)}</span></td><td>${UI.esc(closedAt)}</td></tr>`;
      }).join('') || `<tr><td colspan="3" class="small muted" style="padding:12px">No team members.</td></tr>`;
      UI.el('#m_ack', root).innerHTML = rows;

      const actions = UI.el('#m_actions', root);
      const presets = Array.isArray(settings().snoozePresets) ? settings().snoozePresets : [5,10];

      const btn = (label, act, extra='') => `<button class="btn ghost tiny" data-act="${act}" data-id="${UI.esc(r.id)}" ${extra}>${UI.esc(label)}</button>`;
      actions.innerHTML = [
        btn('Close', 'close'),
        ...presets.slice(0,4).map(m=> btn(`Snooze ${m}m`, 'snooze', `data-min="${UI.esc(String(m))}"`)),
        canManage ? btn('Edit', 'edit') : '',
        canManage ? btn('Delete', 'del') : ''
      ].filter(Boolean).join(' ');

      UI.openModal('teamRemModal');
    }

    // Delegated click handler
    const onClick = async (e)=>{
      const t = e.target;
      const actEl = t && t.closest ? t.closest('[data-act]') : null;
      if(!actEl) return;
      const act = actEl.getAttribute('data-act');

      if(act === 'modal_close'){
        UI.closeModal('teamRemModal');
        return;
      }

      if(act === 'export'){
        UI.downloadJSON('team_reminders.json', getList());
        return;
      }
      if(act === 'import'){
        if(!canManage) return;
        const data = await UI.pickJSON();
        if(!data) return;
        const arr = Array.isArray(data) ? data : (Array.isArray(data.reminders)?data.reminders:[]);
        if(!Array.isArray(arr) || !arr.length) return alert('Import file is empty or invalid.');
        const now = Date.now();
        arr.slice(0,200).forEach(x=>{
          try{
            const alarmAt = Number(x.alarmAt||0) || (now + 5*60*1000);
            Store.addTeamReminder(me.teamId, me.id, {
              short: String(x.short||'').trim() || 'Imported team reminder',
              details: String(x.details||'').trim(),
              alarmAt,
              durationMin: Math.max(1, Number(x.durationMin||5)),
              repeat: String(x.repeat||'none'),
              priority: String(x.priority||'normal'),
              category: String(x.category||'').trim(),
              repeatDays: Array.isArray(x.repeatDays) ? x.repeatDays : null
            });
          }catch(_){}
        });
        render();
        return;
      }

      const id = actEl.getAttribute('data-id');
      if(!id) return;

      const r = (getList()||[]).find(x=>String(x.id)===String(id));
      if(!r) return;

      if(act === 'view'){
        openModal(r);
        return;
      }

      if(act === 'edit'){
        if(!canManage) return;
        editingId = r.id;
        UI.el('#r_short', root).value = r.short||'';
        UI.el('#r_details', root).value = r.details||'';
        UI.el('#r_alarm', root).value = localFromMs(r.alarmAt||Date.now());
        UI.el('#r_duration', root).value = String(r.durationMin||5);
        UI.el('#r_priority', root).value = r.priority||'normal';
        UI.el('#r_repeat', root).value = r.repeat||'none';
        UI.el('#r_category', root).innerHTML = catOptions(r.category||'');
        updateDaysVisibility();
        const picked = Array.isArray(r.repeatDays) ? new Set(r.repeatDays.map(Number)) : new Set();
        Array.from(root.querySelectorAll('.rem-day-cb')).forEach(cb=>{
          const d = Number(cb.getAttribute('data-day'));
          cb.checked = picked.has(d);
        });
        UI.el('#r_cancel', root).disabled = false;
        UI.closeModal('teamRemModal');
        return;
      }

      if(act === 'del'){
        if(!canManage) return;
        const ok = await UI.confirm({ title:'Delete Team Reminder', message:'Delete this team reminder?', okText:'Delete', danger:true });
        if(!ok) return;
        Store.deleteTeamReminder(id);
        UI.closeModal('teamRemModal');
        render();
        try{ if(window.ReminderEngine && ReminderEngine.tickSoon) ReminderEngine.tickSoon(0); }catch(_){}
        return;
      }

      if(act === 'close'){
        Store.closeTeamReminderForUser(r.id, me.id);

        // Repeating team reminder: reschedule only if ALL active team members closed
        try{
          const now = Date.now();
          const cur = (Store.getAllTeamReminders ? Store.getAllTeamReminders() : []).find(x=>x && String(x.id)===String(r.id));
          if(cur && (cur.repeat||'none')!=='none'){
            const users = (Store.getUsers && Store.getUsers()) || [];
            const membersAll = users.filter(u => u && u.status==='active' && String(u.teamId)===String(cur.teamId));
            const ids = membersAll.map(u=>String(u.id));
            const perUser = cur.perUser || {};
            const allClosed = ids.length ? ids.every(id=> perUser[id] && perUser[id].closedAt ) : true;
            if(allClosed){
              const tNext = nextAlarmAtForReminder(cur, now);
              const ackLog = Array.isArray(cur.ackLog) ? cur.ackLog.slice() : [];
              ackLog.push({ ts: now, userId: String(me.id), action:'repeat_reset' });
              Store.updateTeamReminder(cur.id, { alarmAt: tNext, perUser: {}, ackLog });
            }
          }
        }catch(_){}

        UI.closeModal('teamRemModal');
        render();
        try{ if(window.ReminderEngine && ReminderEngine.tickSoon) ReminderEngine.tickSoon(0); }catch(_){}
        return;
      }

      if(act === 'snooze'){
        const minutes = Math.max(1, Number(actEl.getAttribute('data-min')||presets[0]||10));
        Store.snoozeTeamReminderForUser(r.id, me.id, minutes);
        UI.closeModal('teamRemModal');
        render();
        try{ if(window.ReminderEngine && ReminderEngine.tickSoon) ReminderEngine.tickSoon(0); }catch(_){}
        return;
      }
    };

    root.addEventListener('click', onClick);

    function onStore(e){
      try{
        if(!e || !e.detail) return;
        const key = String(e.detail.key||'');
        if(key === KEY || key === KEY_SETTINGS) render();
      }catch(_){}
    }
    window.addEventListener('mums:store', onStore);

    renderCleanup = ()=>{
      try{ root.removeEventListener('click', onClick); }catch(_){}
      try{ window.removeEventListener('mums:store', onStore); }catch(_){}
      try{ window.removeEventListener('mums:globalFocus', applyGlobalFocus); }catch(_){}
    };

    root._cleanup = ()=>{
      try{ if(typeof renderCleanup === 'function') renderCleanup(); }catch(_){}
      renderCleanup = null;
    };
  }

  render();
});
