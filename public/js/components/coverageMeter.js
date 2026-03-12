/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Strictly protects Enterprise UI/UX, Realtime Sync Logic, Core State Management, and Database/API Adapters. Do NOT modify existing logic or layout in this file without explicitly asking Thunter BOY for clearance. If overlapping changes are required, STOP and provide a RISK IMPACT REPORT first. */
(function(){
  // Coverage Meter UI component
  // - Pure rendering from inputs
  // - Safe refresh (no crashes)
  // - Keeps last render args so the UI can be refreshed on Store updates
  window.Components = window.Components || {};

  function safeNum(x, d){
    const n = Number(x);
    return Number.isFinite(n) ? n : (d||0);
  }

  function prettyDateFromISO(iso){
    const parts = String(iso||'').split('-');
    const mm = Number(parts[1]||0);
    const dd = Number(parts[2]||0);
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const m = months[mm-1] || parts[1] || '';
    const d = dd || parts[2] || '';
    return `${m} ${d}`.trim();
  }

  const CoverageMeter = {
    _el: null,
    _args: null,

    render(el, args){
      try{
        if(!el) return;
        this._el = el;
        this._args = args || null;
        if(!args){ el.innerHTML=''; return; }

        const UI = window.UI;
        const esc = UI && UI.esc ? UI.esc : (s)=>String(s||'');

        const cov = Array.isArray(args.cov) ? args.cov : [];
        const getTargetCall = (typeof args.getTargetCall === 'function') ? args.getTargetCall : null;
        const targetCall = safeNum(getTargetCall ? getTargetCall() : args.targetCall, 2);

        const okCount = cov.reduce((a,c)=>{
          try{
            const okMailbox = safeNum(c.mailboxMin,0) === 1;
            const okCall = safeNum(c.callMin,0) >= targetCall;
            return a + ((okMailbox && okCall) ? 1 : 0);
          }catch(_){ return a; }
        }, 0);
        const totalCount = cov.length || 1;
        const pctOk = Math.round((okCount/totalCount)*100);

        const iso = args.isoDate || '';
        const dayLabel = String(args.dayLabel || '').toUpperCase();
        const dayPretty = args.dayDisplay || `${prettyDateFromISO(iso)}${dayLabel?(' | '+dayLabel):''}`.trim();

        const canEdit = !!args.canEdit;

        el.innerHTML = `
          <div class="coverage-head">
            <div class="coverage-left">
              <div class="coverage-title-row">
                <div class="coverage-title">Coverage Meter</div>
                ${canEdit ? '<button class="iconbtn" id="covEdit" type="button" title="Edit Coverage Meter parameters" aria-label="Edit Coverage Meter">✎</button>' : ''}
              </div>
              <div class="coverage-sub">Mailbox target: <b>1</b>/hr • Call target: <b>≥ ${esc(targetCall)}</b>/hr • Values are per-hour <b>minimum</b> (stricter).</div>
            </div>
            <div class="coverage-day-center" aria-label="Editing day">${esc(dayPretty)}</div>
            <div class="coverage-kpis">
              <div class="kpi"><div class="kpi-label">OK hours</div><div class="kpi-val">${esc(okCount)}/${esc(totalCount)}</div></div>
              <div class="kpi"><div class="kpi-label">Health</div><div class="kpi-val">${esc(pctOk)}%</div></div>
            </div>
          </div>
          <div class="coverage-scroll">
            <div class="coverage-meter" aria-label="Coverage meter by hour">
              ${cov.map(c=>{
                const okMailbox = safeNum(c.mailboxMin,0)===1;
                const okCall = safeNum(c.callMin,0) >= targetCall;
                const cls = (okMailbox && okCall) ? 'ok' : 'bad';
                const label = String(c.label||'');
                const title = `${label}\nMailbox: ${safeNum(c.mailboxMin,0)}\nCall: ${safeNum(c.callMin,0)}`;
                return `<div class="cm-col ${cls}" title="${esc(title)}">
                  <div class="cm-label">${esc(label)}</div>
                  <div class="cm-bars">
                    <div class="cm-bar" data-kind="mailbox">M:${esc(safeNum(c.mailboxMin,0))}</div>
                    <div class="cm-bar" data-kind="call">C:${esc(safeNum(c.callMin,0))}</div>
                  </div>
                </div>`;
              }).join('')}
            </div>
          </div>
        `;

        // Wire edit icon (if present)
        try{
          const covEdit = el.querySelector('#covEdit');
          if(covEdit){
            covEdit.onclick = ()=>{
              try{ if(typeof args.onEdit === 'function') args.onEdit(); }catch(e){ console.error(e); }
            };
          }
        }catch(_){ }

      }catch(e){
        console.error('CoverageMeter.render error', e);
      }
    },

    refresh(){
      try{
        if(!this._el || !this._args) return;
        // Refresh re-renders with the latest target settings.
        this.render(this._el, this._args);
      }catch(e){
        console.error('CoverageMeter.refresh error', e);
      }
    }
  };

  window.Components.CoverageMeter = CoverageMeter;
})();
