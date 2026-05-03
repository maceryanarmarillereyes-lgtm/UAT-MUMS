/**
 * @file my_case.js
 * @description Page: My Case — personal case queue filtered to the logged-in user
 * @module MUMS/Pages
 * @version UAT
 */
/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */


(window.Pages=window.Pages||{}, window.Pages.my_case = function(root){
  const me = (window.Auth && Auth.getUser) ? (Auth.getUser()||{}) : {};
  const all = (window.Store && Store.getCases) ? (Store.getCases()||[]) : [];
  const mine = all.filter(c=>c && c.assigneeId===me.id);

  const fmt = (ms)=>{
    try{
      return new Date(Number(ms||0)).toLocaleString('en-CA', { year:'numeric', month:'short', day:'2-digit', hour:'2-digit', minute:'2-digit' });
    }catch(_){ return ''; }
  };

  root.innerHTML = `
    <h2 style="margin:0 0 10px">My Case</h2>

    <div class="row" style="justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap">
      <div class="small muted">
        Shows mailbox cases assigned to you on this device. Use Mailbox page to manage cases.
      </div>
      <div class="row" style="gap:8px;flex-wrap:wrap">
        <button class="btn" id="caseExportCsv">Export CSV</button>
        <button class="btn" id="caseExportJson">Export JSON</button>
      </div>
    </div>

    <div class="card pad" style="margin-top:10px">
      <table class="table">
        <thead><tr><th>Case</th><th>Status</th><th>Assigned By</th><th>Created</th></tr></thead>
        <tbody>
          ${mine.map(c=>`
            <tr>
              <td>${UI.esc(c.title||'')}</td>
              <td>${UI.esc(c.status||'')}</td>
              <td>${UI.esc(c.assignedByName||c.assignedBy||'—')}</td>
              <td class="small muted">${UI.esc(fmt(c.createdAt||c.ts||0))}</td>
            </tr>
          `).join('') || `<tr><td colspan="4" class="muted">No cases assigned to you.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;

  const rows = [['id','title','status','assignedBy','createdAt']];
  mine.forEach(c=>rows.push([c.id||'', c.title||'', c.status||'', c.assignedByName||c.assignedBy||'', String(c.createdAt||'')]));
  UI.el('#caseExportCsv').onclick = ()=>UI.downloadCSV(`my_cases_${me.username||me.id||'user'}.csv`, rows);
  UI.el('#caseExportJson').onclick = ()=>UI.downloadJSON(`my_cases_${me.username||me.id||'user'}.json`, mine);
});
