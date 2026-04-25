/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */


(window.Pages=window.Pages||{}, window.Pages.commands = function(root){
  const me = Auth.getUser();
  if(!me){
    root.innerHTML = `<div class="card"><div class="small muted">Not logged in.</div></div>`;
    return;
  }
  const extras = (window.Store && Store.getUserExtraPrivs) ? Store.getUserExtraPrivs(me.id) : [];
  const items = [
    { perm:'view_master_schedule', label:'Master Schedule', icon:'📅', href:'#master_schedule', desc:'View team master schedule blocks.' },
    { perm:'create_users', label:'User Management', icon:'👤', href:'#users', desc:'Manage users and their profiles.' },
    { perm:'manage_announcements', label:'Announcements', icon:'📣', href:'#announcements', desc:'Publish announcements to teams.' },
    { perm:'view_dashboard', label:'My Notes', icon:'📝', href:'#', desc:'Open My Notes Command Center Pro.', action:'my_notes' },
  ].filter(i=>extras.includes(i.perm));

  root.innerHTML = `
    <div class="row" style="justify-content:space-between;align-items:flex-end;gap:10px;flex-wrap:wrap">
      <div>
        <h2 style="margin:0 0 6px">Commands</h2>
        <div class="small muted">Commands are additional privileges delegated to your account by a Super Admin.</div>
      </div>
    </div>

    ${items.length ? `
      <div class="cards" style="grid-template-columns:repeat(3, minmax(0,1fr));margin-top:12px">
        ${items.map(i=>`
          <a class="card" href="${i.href}" data-action="${i.action||''}" style="text-decoration:none">
            <div class="row" style="justify-content:space-between;align-items:center">
              <div style="font-weight:900">${UI.esc(i.label)}</div>
              <div style="font-size:18px">${i.icon}</div>
            </div>
            <div class="small muted" style="margin-top:8px">${UI.esc(i.desc)}</div>
          </a>
        `).join('')}
      </div>
    ` : `
      <div class="card" style="margin-top:12px">
        <div class="small muted">No delegated commands were assigned to your account.</div>
      </div>
    `}
  `;

  root.querySelectorAll('[data-action="my_notes"]').forEach(el=>{
    el.addEventListener('click', (ev)=>{
      ev.preventDefault();
      window.MyNotesCommandCenter?.open?.();
    });
  });

});