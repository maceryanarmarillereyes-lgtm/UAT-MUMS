/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Strictly protects Enterprise UI/UX, Realtime Sync Logic, Core State Management, and Database/API Adapters. Do NOT modify existing logic or layout in this file without explicitly asking Thunter BOY for clearance. If overlapping changes are required, STOP and provide a RISK IMPACT REPORT first. */
(window.Pages=window.Pages||{}, window.Pages.my_reminders = function(root){
  // Cleanup from prior renders (prevents duplicate listeners / memory leaks)
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
  if(!Config.can(me,'view_my_reminders')){
    root.innerHTML = `<div class="card"><h2 style="margin:0 0 6px">My Reminders</h2><div class="small">You do not have access to this page.</div></div>`;
    return;
  }

  const KEY = 'mums_my_reminders';
  const KEY_SETTINGS = 'mums_reminder_settings';
  const PREF_KEY = 'mums_reminder_prefs_' + String(me.id);

  let editingId = null;
  let renderCleanup = null;

  function settings(){
    try{ return (Store.getReminderSettings && Store.getReminderSettings()) || { snoozePresets:[5,10,15,30], categories:['Work','Personal','Urgent'], escalationAfterMin:2, maxVisible:3 }; }
    catch(e){ return { snoozePresets:[5,10,15,30], categories:['Work','Personal','Urgent'], escalationAfterMin:2, maxVisible:3 }; }
  }
  function prefs(){
    try{
      const raw = localStorage.getItem(PREF_KEY);
      if(!raw) return { muteUntil: 0 };
      const o = JSON.parse(raw);
      return (o && typeof o==='object') ? { muteUntil: Number(o.muteUntil||0) } : { muteUntil: 0 };
    }catch(_){ return { muteUntil: 0 }; }
  }
  function setPrefs(patch){
    try{
      const cur = prefs();
      const next = Object.assign({}, cur, patch||{});
      next.muteUntil = Number(next.muteUntil||0);
      localStorage.setItem(PREF_KEY, JSON.stringify(next));
      try{ window.dispatchEvent(new CustomEvent('mums:store', { detail:{ key: PREF_KEY }})); }catch(_){}
    }catch(_){}
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

  function computeStatus(r, now){
    if(r.closedAt) return 'Closed';
    if(r.snoozeUntil && r.snoozeUntil>now) return 'Snoozed';
    if(now >= Number(r.alarmAt||0)) return 'Alarming';
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
    return (Store.getMyReminders && Store.getMyReminders(me.id)) || [];
  }

  function computeKpis(list){
    const now = Date.now();
    const counts = { Scheduled:0, Alarming:0, Snoozed:0, Closed:0 };
    let nextDue = null;
    list.forEach(r=>{
      const st = computeStatus(r, now);
      counts[st] = (counts[st]||0) + 1;
      if(st !== 'Closed'){
        const t = (r.snoozeUntil && r.snoozeUntil>now) ? r.snoozeUntil : r.alarmAt;
        const ms = Number(t||0);
        if(ms && (nextDue===null || ms < nextDue)) nextDue = ms;
      }
    });
    return { counts, nextDue };
  }

  function render(){
    try{ if(typeof renderCleanup === 'function') renderCleanup(); }catch(_){}
    renderCleanup = null;

    const list = getList();
    const k = computeKpis(list);
    const p = prefs();
    const muted = (p.muteUntil && Number(p.muteUntil) > Date.now());

    const s = settings();
    const presets = Array.isArray(s.snoozePresets) ? s.snoozePresets : [5,10];

    root.innerHTML = `
      <div class="rem-page">
        <div class="rem-head">
          <div>
            <h2 class="title">My Reminders</h2>
            <div class="sub">Personal reminders visible only to you. Notifications appear on the top bar with a green outline.</div>
          </div>
          <div class="rem-actions">
            <button class="btn ghost tiny" data-act="export">Export</button>
            <button class="btn ghost tiny" data-act="import">Import</button>
            <button class="btn ghost tiny" data-act="mute">${muted ? 'Unmute' : 'Mute 15m'}</button>
          </div>
        </div>

        <div class="rem-kpis">
          <div class="rem-kpi"><div class="k">Scheduled</div><div class="v">${k.counts.Scheduled||0}</div><div class="h">Upcoming reminders</div></div>
          <div class="rem-kpi"><div class="k">Alarming</div><div class="v">${k.counts.Alarming||0}</div><div class="h">Require your attention</div></div>
          <div class="rem-kpi"><div class="k">Snoozed</div><div class="v">${k.counts.Snoozed||0}</div><div class="h">Temporarily postponed</div></div>
          <div class="rem-kpi"><div class="k">Next</div><div class="v">${k.nextDue ? '⏱' : '—'}</div><div class="h">${k.nextDue ? UI.esc(fmt(k.nextDue)) : 'No upcoming reminders'}</div></div>
        </div>

        <div class="rem-layout">
          <div class="rem-panel">
            <div class="ph">
              <h3>${editingId ? 'Edit Reminder' : 'Create Reminder'}</h3>
              <div class="small muted">${editingId ? 'Update details and save.' : 'Fill out the fields and add.'}</div>
            </div>
            <div class="pb">
              <div class="rem-field">
                <div class="lbl">Short Description</div>
                <input class="input" id="r_short" placeholder="e.g., Follow up with client" />
              </div>
              <div class="rem-field">
                <div class="lbl">Details</div>
                <textarea class="input" id="r_details" rows="3" placeholder="Add details..."></textarea>
              </div>

              <div class="rem-inline">
                <div class="rem-field">
                  <div class="lbl">Alarm Date & Time</div>
                  <input class="input" id="r_alarm" type="datetime-local" />
                  <div class="rem-badges" style="margin-top:6px">
                    <span class="rem-badge neutral" data-act="preset" data-preset="15m">+15m</span>
                    <span class="rem-badge neutral" data-act="preset" data-preset="1h">+1h</span>
                    <span class="rem-badge neutral" data-act="preset" data-preset="tom9">Tomorrow 9AM</span>
                  </div>
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
            </div>
          </div>

          <div class="rem-panel">
            <div class="rem-filterbar">
              <div class="left">
                <div style="font-weight:800">Reminders</div>
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
                      <th>Status</th>
                      <th style="width:280px">Actions</th>
                    </tr>
                  </thead>
                  <tbody id="rows"></tbody>
                </table>
              </div>
              <div class="rem-note">Tip: You can manage alarms from the floating top-bar notification as well.</div>
            </div>
          </div>
        </div>

        <div class="modal" id="myRemModal">
          <div class="panel">
            <div class="head">
              <div>
                <div style="font-weight:900" id="m_title">Reminder</div>
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

              <div class="row" style="justify-content:flex-end;gap:8px;margin-top:14px;flex-wrap:wrap" id="m_actions"></div>
            </div>
          </div>
        </div>
      </div>
    `;

    // Default alarm value
    const alarm = UI.el('#r_alarm', root);
    if(alarm && !alarm.value){
      alarm.value = localFromMs(Date.now() + 5*60*1000);
    }

    const repeatSel = UI.el('#r_repeat', root);
    const daysWrap = UI.el('#r_days_wrap', root);
    const updateDaysVisibility = ()=>{
      const rep = String(repeatSel.value||'none');
      daysWrap.style.display = (rep==='custom') ? 'block' : 'none';
    };
    repeatSel.addEventListener('change', updateDaysVisibility);
    updateDaysVisibility();

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
        const s = computeStatus(r, now);
        if(st && s!==st) return false;
        if(!query) return true;
        return (String(r.short||'').toLowerCase().includes(query) || String(r.details||'').toLowerCase().includes(query));
      }).sort((a,b)=>{
        const sa = computeStatus(a, now);
        const sb = computeStatus(b, now);
        const rank = (x)=> x==='Alarming'?0 : x==='Snoozed'?1 : x==='Scheduled'?2 : 3;
        const ra = rank(sa), rb = rank(sb);
        if(ra!==rb) return ra-rb;
        if((a.priority||'normal')!==(b.priority||'normal')) return (a.priority==='high'?-1:1);
        const da = (a.snoozeUntil && a.snoozeUntil>now) ? a.snoozeUntil : a.alarmAt;
        const db = (b.snoozeUntil && b.snoozeUntil>now) ? b.snoozeUntil : b.alarmAt;
        return (da||0)-(db||0);
      });

      const tbody = UI.el('#rows', root);
      tbody.innerHTML = out.map(r=>{
        const s = computeStatus(r, now);
        const when = fmt((r.snoozeUntil && r.snoozeUntil>now) ? r.snoozeUntil : r.alarmAt);
        const cat = String(r.category||'');
        const statusClass = statusBadgeClass(s);
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
          <td>
            <div class="actions">
              <button class="btn ghost tiny" data-act="view" data-id="${UI.esc(r.id)}">View</button>
              <button class="btn ghost tiny" data-act="snooze" data-id="${UI.esc(r.id)}" data-min="${UI.esc(String((presets[0]||10)))}">Snooze</button>
              <button class="btn ghost tiny" data-act="close" data-id="${UI.esc(r.id)}">${(r.repeat||'none')==='none'?'Done':'Acknowledge'}</button>
              <button class="btn ghost tiny" data-act="edit" data-id="${UI.esc(r.id)}">Edit</button>
              <button class="btn danger ghost tiny" data-act="del" data-id="${UI.esc(r.id)}">Delete</button>
            </div>
          </td>
        </tr>`;
      }).join('') || `<tr><td colspan="7" class="small muted" style="padding:14px 12px">No reminders found.</td></tr>`;
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
        if(!f || f.type !== 'myReminder' || !f.id) return;
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


    // Save / Cancel
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
        Store.updateMyReminder(editingId, payload);
      }else{
        Store.addMyReminder(me.id, payload);
      }
      editingId = null;
      render();
      try{ if(window.ReminderEngine && ReminderEngine.tickSoon) ReminderEngine.tickSoon(0); }catch(_){}
    });

    function openModal(r){
      const now = Date.now();
      const st = computeStatus(r, now);
      UI.el('#m_title', root).textContent = r.short || 'Reminder';
      UI.el('#m_meta', root).textContent = fmt((r.snoozeUntil && r.snoozeUntil>now) ? r.snoozeUntil : r.alarmAt);
      UI.el('#m_details', root).textContent = r.details || '';
      UI.el('#m_status', root).textContent = st;
      UI.el('#m_status', root).className = 'rem-badge ' + statusBadgeClass(st);
      UI.el('#m_repeat', root).textContent = repeatText(r);
      UI.el('#m_priority', root).textContent = (r.priority||'normal').toUpperCase();
      UI.el('#m_cat', root).textContent = r.category ? r.category : '—';

      const actions = UI.el('#m_actions', root);
      const presets = Array.isArray(settings().snoozePresets) ? settings().snoozePresets : [5,10];

      const btn = (label, act, extra='') => `<button class="btn ghost tiny" data-act="${act}" data-id="${UI.esc(r.id)}" ${extra}>${UI.esc(label)}</button>`;
      actions.innerHTML = [
        btn('Edit', 'edit'),
        btn((r.repeat||'none')==='none'?'Done':'Acknowledge', 'close'),
        ...presets.slice(0,4).map(m=> btn(`Snooze ${m}m`, 'snooze', `data-min="${UI.esc(String(m))}"`)),
        btn('Delete', 'del', 'data-danger="1"')
      ].join(' ');

      UI.openModal('myRemModal');
    }

    // Event delegation (single handler)
    const onClick = async (e)=>{
      const t = e.target;
      const actEl = t && t.closest ? t.closest('[data-act]') : null;
      if(!actEl) return;
      const act = actEl.getAttribute('data-act');

      if(act === 'modal_close'){
        UI.closeModal('myRemModal');
        return;
      }

      if(act === 'preset'){
        const preset = String(actEl.getAttribute('data-preset')||'');
        const now = new Date();
        let ms = Date.now();
        if(preset==='15m') ms = Date.now() + 15*60*1000;
        if(preset==='1h') ms = Date.now() + 60*60*1000;
        if(preset==='tom9'){
          const d = new Date();
          d.setDate(d.getDate()+1);
          d.setHours(9,0,0,0);
          ms = d.getTime();
        }
        UI.el('#r_alarm', root).value = localFromMs(ms);
        return;
      }

      if(act === 'export'){
        UI.downloadJSON('my_reminders.json', getList());
        return;
      }
      if(act === 'import'){
        const data = await UI.pickJSON();
        if(!data) return;
        const arr = Array.isArray(data) ? data : (Array.isArray(data.reminders)?data.reminders:[]);
        if(!Array.isArray(arr) || !arr.length) return alert('Import file is empty or invalid.');
        const now = Date.now();
        arr.slice(0,200).forEach(x=>{
          try{
            const alarmAt = Number(x.alarmAt||0) || (now + 5*60*1000);
            Store.addMyReminder(me.id, {
              short: String(x.short||'').trim() || 'Imported reminder',
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

      if(act === 'mute'){
        const cur = prefs();
        const now = Date.now();
        const muted = (cur.muteUntil && Number(cur.muteUntil) > now);
        if(muted){
          setPrefs({ muteUntil: 0 });
        }else{
          setPrefs({ muteUntil: now + 15*60*1000 });
        }
        try{ if(window.ReminderEngine && ReminderEngine.tickSoon) ReminderEngine.tickSoon(0); }catch(_){}
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
        UI.closeModal('myRemModal');
        return;
      }

      if(act === 'del'){
        const ok = await UI.confirm({ title:'Delete Reminder', message:'Delete this reminder?', okText:'Delete', danger:true });
        if(!ok) return;
        Store.deleteMyReminder(id);
        UI.closeModal('myRemModal');
        render();
        try{ if(window.ReminderEngine && ReminderEngine.tickSoon) ReminderEngine.tickSoon(0); }catch(_){}
        return;
      }

      if(act === 'close'){
        const now = Date.now();
        if((r.repeat||'none')==='none'){
          Store.updateMyReminder(r.id, { closedAt: now, snoozeUntil: null });
        }else{
          const tNext = nextAlarmAtForReminder(r, now);
          Store.updateMyReminder(r.id, { alarmAt: tNext, snoozeUntil: null, closedAt: null });
        }
        UI.closeModal('myRemModal');
        render();
        try{ if(window.ReminderEngine && ReminderEngine.tickSoon) ReminderEngine.tickSoon(0); }catch(_){}
        return;
      }

      if(act === 'snooze'){
        const minutes = Math.max(1, Number(actEl.getAttribute('data-min')||presets[0]||10));
        const until = Date.now() + minutes*60*1000;
        Store.updateMyReminder(r.id, { snoozeUntil: until, closedAt: null });
        UI.closeModal('myRemModal');
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
        if(key === KEY || key === KEY_SETTINGS || key === PREF_KEY) render();
      }catch(_){}
    }
    window.addEventListener('mums:store', onStore);

    renderCleanup = ()=>{
      try{ root.removeEventListener('click', onClick); }catch(_){}
      try{ window.removeEventListener('mums:store', onStore); }catch(_){}
    };

    root._cleanup = ()=>{
      try{ if(typeof renderCleanup === 'function') renderCleanup(); }catch(_){}
      renderCleanup = null;
    };
  }

  render();
});
