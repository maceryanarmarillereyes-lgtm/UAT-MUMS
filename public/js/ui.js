/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Strictly protects Enterprise UI/UX, Realtime Sync Logic, Core State Management, and Database/API Adapters. Do NOT modify existing logic or layout in this file without explicitly asking Thunter BOY for clearance. If overlapping changes are required, STOP and provide a RISK IMPACT REPORT first. */
/* File: public/js/ui.js */

(function(){
  const UI = {
    el(sel, root){ return (root||document).querySelector(sel); },
    els(sel, root){ return Array.from((root||document).querySelectorAll(sel)); },
    esc(s){ return String(s??'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); },

    overrideLabel(override){
      try{
        const o = override;
        if(!o || typeof o !== 'object') return '';
        if(!o.enabled) return '';
        if(String(o.scope||'') !== 'global') return '';
        return `<span class="override-label" role="status" aria-live="polite">GLOBAL OVERRIDE ACTIVE</span>`;
      }catch(_){
        return '';
      }
    },
    
    initials(name){
      const parts = String(name||"").trim().split(/\s+/).filter(Boolean);
      if(!parts.length) return "U";
      const a = (parts[0]||"")[0]||"";
      const b = (parts[1]||parts[0]||"")[0]||"";
      return (a+b).toUpperCase();
    },

    async readImageAsDataUrl(file, maxSize){
      const f = file;
      if(!f) return null;
      const dataUrl = await new Promise((resolve,reject)=>{
        const r = new FileReader();
        r.onload = ()=>resolve(String(r.result||""));
        r.onerror = ()=>reject(r.error||new Error("read failed"));
        r.readAsDataURL(f);
      });
      const limit = Number(maxSize||0);
      if(!limit) return dataUrl;
      const img = await new Promise((resolve,reject)=>{
        const im = new Image();
        im.onload = ()=>resolve(im);
        im.onerror = ()=>reject(new Error("image load failed"));
        im.src = dataUrl;
      });
      const w = img.naturalWidth||img.width;
      const h = img.naturalHeight||img.height;
      const scale = Math.min(1, limit/Math.max(w,h));
      if(scale>=1) return dataUrl;
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(w*scale));
      canvas.height = Math.max(1, Math.round(h*scale));
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", 0.9);
    },

    openModal(id){
      const m = UI.el('#'+id);
      if(m){
        // BUG FIX: closeModal() sets style.display='none' (inline style).
        // Inline styles override CSS class rules (.modal.open { display:flex }).
        // So on second open, the CSS class is added back but display:none wins → modal invisible.
        // FIX: Always clear the inline style before adding the open class so CSS takes over.
        m.style.display = '';
        UI.bringToFront(m);
        m.classList.add('open');
      }
      try{ document.body.classList.add('modal-open'); }catch(_){ }
    },
    
    closeModal(id){
      // Block closing the notification modal when MAILBOX_ASSIGN cases are pending
      if(id === 'schedNotifModal' && window._schedNotifLocked) return;
      const m = UI.el('#'+id);
      if(m){
        m.classList.remove('open');
        // Fix: custom mailbox modals use 'is-open' class + display:none pattern
        m.classList.remove('is-open');
        m.style.display = 'none';
      }
      try{
        const any = document.querySelector('.modal.open');
        if(!any) document.body.classList.remove('modal-open');
      }catch(_){ }
    },
    
    bringToFront(modal, opts){
      try{
        const m = modal;
        if(!m || !(m instanceof HTMLElement)) return;
        if(document.body && m.parentElement === document.body){
          document.body.appendChild(m);
        }
        const o = Object.assign({ baseZ: 2147483000, panelOffset: 1, headOffset: 2 }, opts || {});
        m.style.zIndex = String(Math.max(10000, Number(o.baseZ)||2147483000));
        const panel = m.querySelector('.panel');
        if(panel) panel.style.zIndex = String((Number(m.style.zIndex)||2147483000) + Number(o.panelOffset||1));
        const head = m.querySelector('.head, .modal-head');
        if(head) head.style.zIndex = String((Number(m.style.zIndex)||2147483000) + Number(o.headOffset||2));
      }catch(_){ }
    },
    
    _ensureToastHost(){
      let host = document.getElementById('toastHost');
      if(host) return host;
      host = document.createElement('div');
      host.id = 'toastHost';
      host.className = 'toast-host';
      document.body.appendChild(host);
      return host;
    },
    
    _normalizeToastMessage(message){
      if(message == null) return '';
      if(typeof message === 'string') return message;
      try{ if(message instanceof Error) return message.message || String(message); }catch(_){ }
      if(typeof message === 'object'){
        try{
          if(typeof message.message === 'string') return message.message;
          if(typeof message.error === 'string') return message.error;
          if(typeof message.details === 'string') return message.details;
          if(typeof message.hint === 'string') return message.hint;
        }catch(_){ }
        try{ return JSON.stringify(message); }catch(_){ return String(message); }
      }
      return String(message);
    },

    _ensureHighAlertHosts(){
      let overlay = document.getElementById('highAlertOverlay');
      if(!overlay){
        overlay = document.createElement('div');
        overlay.id = 'highAlertOverlay';
        overlay.className = 'high-alert-overlay';
        overlay.style.display = 'none';
        document.body.appendChild(overlay);
      }
      let host = document.getElementById('highAlertHost');
      if(!host){
        host = document.createElement('div');
        host.id = 'highAlertHost';
        host.className = 'high-alert-host';
        host.style.display = 'none';
        host.innerHTML = `
          <div class="high-alert-box" role="alert" aria-live="assertive">
            <div class="high-alert-title">⚠️ Error</div>
            <div class="high-alert-message" id="highAlertMessage"></div>
            <div class="high-alert-actions">
              <button class="btn danger" type="button" id="highAlertCloseBtn">Close</button>
            </div>
          </div>
        `;
        document.body.appendChild(host);
      }
      return { overlay, host };
    },

    alertError(message, opts){
      try{
        const msg = UI._normalizeToastMessage(message);
        const o = Object.assign({ title: '⚠️ Error', autoCloseMs: 7000 }, (opts||{}));
        const hosts = UI._ensureHighAlertHosts();
        const overlay = hosts.overlay;
        const host = hosts.host;
        const titleEl = host.querySelector('.high-alert-title');
        const msgEl = host.querySelector('#highAlertMessage');
        const closeBtn = host.querySelector('#highAlertCloseBtn');

        if(titleEl) titleEl.textContent = String(o.title || '⚠️ Error');
        if(msgEl) msgEl.textContent = String(msg || 'Unknown error');

        overlay.style.display = 'block';
        host.style.display = 'flex';
        overlay.style.zIndex = '2147483645';
        host.style.zIndex = '2147483646';

        if(closeBtn && !closeBtn._mumsBound){
          closeBtn._mumsBound = true;
          closeBtn.onclick = () => UI.closeAlertError();
        }
        if(!host._mumsBound){
          host._mumsBound = true;
          host.addEventListener('click', (ev)=>{ if(ev.target === host) UI.closeAlertError(); });
        }

        if(host._mumsTimer) clearTimeout(host._mumsTimer);
        const ms = Number(o.autoCloseMs || 0);
        if(ms > 0){ host._mumsTimer = setTimeout(()=>UI.closeAlertError(), ms); }
      }catch(err){ try{ console.error('UI.alertError failed', err); }catch(_){} }
    },

    closeAlertError(){
      try{
        const overlay = document.getElementById('highAlertOverlay');
        const host = document.getElementById('highAlertHost');
        if(host && host._mumsTimer){ clearTimeout(host._mumsTimer); host._mumsTimer = null; }
        if(overlay) overlay.style.display = 'none';
        if(host) host.style.display = 'none';
      }catch(_){}
    },

    toast(message, variant){
      try{
        const v = String(variant||'').toLowerCase();
        if(v==='danger' || v==='error' || v==='invalid'){
          UI.alertError(message);
          return;
        }
        const host = UI._ensureToastHost();
        const t = document.createElement('div');
        t.className = 'toast' + (v ? ` ${v}` : '');
        const msg = UI._normalizeToastMessage(message);
        t.textContent = msg;
        host.appendChild(t);
        requestAnimationFrame(()=>t.classList.add('show'));
        setTimeout(()=>{
          t.classList.remove('show');
          setTimeout(()=>{ try{ t.remove(); }catch(_){} }, 250);
        }, 3200);
      }catch(e){ try{ console.log(UI._normalizeToastMessage(message)); }catch(_){} }
    },

    confirm(opts){
      const o = Object.assign({
        title: 'Confirm', message: '', detail: '', okText: 'Confirm', cancelText: 'Cancel', danger: false
      }, (opts||{}));

      return new Promise((resolve)=>{
        let modal = document.getElementById('mumsConfirmModal');
        if(!modal){
          modal = document.createElement('div');
          modal.id = 'mumsConfirmModal';
          modal.className = 'modal confirm-modal';
          modal.innerHTML = `
            <div class="panel" style="max-width:520px">
              <div class="head">
                <div>
                  <div class="announce-title" id="mcmTitle"></div>
                  <div class="small muted" id="mcmDetail" style="margin-top:2px"></div>
                </div>
                <button class="btn ghost" type="button" id="mcmX" aria-label="Close">✕</button>
              </div>
              <div class="body" style="display:grid;gap:10px">
                <div class="h3" id="mcmMsg" style="margin:0"></div>
                <div class="small muted" id="mcmMsg2" style="margin-top:-6px"></div>
                <div class="row" style="justify-content:flex-end;gap:8px;margin-top:4px;flex-wrap:wrap">
                  <button class="btn" id="mcmCancel" type="button"></button>
                  <button class="btn primary" id="mcmOk" type="button"></button>
                </div>
              </div>
            </div>
          `;
          document.body.appendChild(modal);
        }

        const titleEl = modal.querySelector('#mcmTitle');
        const detailEl = modal.querySelector('#mcmDetail');
        const msgEl = modal.querySelector('#mcmMsg');
        const msg2El = modal.querySelector('#mcmMsg2');
        const okBtn = modal.querySelector('#mcmOk');
        const cancelBtn = modal.querySelector('#mcmCancel');
        const xBtn = modal.querySelector('#mcmX');

        titleEl.textContent = String(o.title||'Confirm');
        msgEl.textContent = String(o.message||'');
        msg2El.textContent = String(o.detail||'');
        detailEl.textContent = '';
        cancelBtn.textContent = String(o.cancelText||'Cancel');
        okBtn.textContent = String(o.okText||'Confirm');

        okBtn.classList.toggle('danger', !!o.danger);
        okBtn.classList.toggle('primary', !o.danger);

        const cleanup = ()=>{
          try{
            modal.classList.remove('open');
            modal.removeEventListener('click', onBackdrop);
            document.removeEventListener('keydown', onKey);
            okBtn.onclick = null; cancelBtn.onclick = null; xBtn.onclick = null;
          }catch(_){}
        };
        const done = (v)=>{ cleanup(); resolve(!!v); };

        const onBackdrop = (e)=>{ if(e.target === modal) done(false); };
        const onKey = (e)=>{
          if(e.key === 'Escape'){ e.preventDefault(); done(false); }
          if(e.key === 'Enter'){ e.preventDefault(); done(true); }
        };

        okBtn.onclick = ()=>done(true);
        cancelBtn.onclick = ()=>done(false);
        xBtn.onclick = ()=>done(false);

        UI.bringToFront(modal, { baseZ: 2147483200, panelOffset: 1, headOffset: 2 });
        modal.addEventListener('click', onBackdrop);
        document.addEventListener('keydown', onKey, true);
        modal.classList.add('open');
        setTimeout(()=>{ try{ okBtn.focus(); }catch(_){} }, 0);
      });
    },

    promptText(opts){
      const o = Object.assign({
        title: 'Input required', message: '', detail: '', placeholder: 'Type here...',
        okText: 'Save', cancelText: 'Cancel', required: true, maxLen: 500
      }, (opts||{}));

      return new Promise((resolve)=>{
        let modal = document.getElementById('mumsPromptTextModal');
        if(!modal){
          modal = document.createElement('div');
          modal.id = 'mumsPromptTextModal';
          modal.className = 'modal prompt-modal';
          modal.innerHTML = `
            <div class="panel" style="max-width:560px">
              <div class="head">
                <div>
                  <div class="announce-title" id="mptTitle"></div>
                  <div class="small muted" id="mptDetail" style="margin-top:2px"></div>
                </div>
                <button class="btn ghost" type="button" id="mptX" aria-label="Close">✕</button>
              </div>
              <div class="body" style="display:grid;gap:10px">
                <div class="h3" id="mptMsg" style="margin:0"></div>
                <textarea id="mptTextarea" class="input" style="min-height:110px;resize:vertical" maxlength="${o.maxLen}"></textarea>
                <div class="row" style="justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap">
                  <div class="small muted" id="mptHint"></div>
                  <div class="row" style="gap:8px">
                    <button class="btn" id="mptCancel" type="button"></button>
                    <button class="btn primary" id="mptOk" type="button"></button>
                  </div>
                </div>
              </div>
            </div>
          `;
          document.body.appendChild(modal);
        }

        const titleEl = modal.querySelector('#mptTitle');
        const detailEl = modal.querySelector('#mptDetail');
        const msgEl = modal.querySelector('#mptMsg');
        const ta = modal.querySelector('#mptTextarea');
        const hintEl = modal.querySelector('#mptHint');
        const okBtn = modal.querySelector('#mptOk');
        const cancelBtn = modal.querySelector('#mptCancel');
        const xBtn = modal.querySelector('#mptX');

        titleEl.textContent = String(o.title||'Input required');
        detailEl.textContent = String(o.detail||'');
        msgEl.textContent = String(o.message||'');
        ta.value = String(o.value||'');
        ta.placeholder = String(o.placeholder||'');
        okBtn.textContent = String(o.okText||'Save');
        cancelBtn.textContent = String(o.cancelText||'Cancel');
        hintEl.textContent = o.required ? `Required (max ${o.maxLen} chars)` : `Optional (max ${o.maxLen} chars)`;

        const cleanup = ()=>{
          try{
            modal.classList.remove('open');
            modal.removeEventListener('click', onBackdrop);
            document.removeEventListener('keydown', onKey, true);
            okBtn.onclick = null; cancelBtn.onclick = null; xBtn.onclick = null;
          }catch(_){ }
        };
        const done = (v)=>{ cleanup(); resolve(v); };

        const onBackdrop = (e)=>{ if(e.target === modal) done(null); };
        const onKey = (e)=>{
          if(e.key === 'Escape'){ e.preventDefault(); done(null); }
          if(e.key === 'Enter' && (e.metaKey || e.ctrlKey)){ e.preventDefault(); okBtn.click(); }
        };

        okBtn.onclick = ()=>{
          const v = String(ta.value||'').trim();
          if(o.required && !v){
            UI.toast('Please enter a reason before saving.', 'warn');
            try{ ta.focus(); }catch(_){ }
            return;
          }
          done(v);
        };
        cancelBtn.onclick = ()=>done(null);
        xBtn.onclick = ()=>done(null);

        UI.bringToFront(modal, { baseZ: 2147483200, panelOffset: 1, headOffset: 2 });
        modal.addEventListener('click', onBackdrop);
        document.addEventListener('keydown', onKey, true);
        modal.classList.add('open');
        setTimeout(()=>{ try{ ta.focus(); }catch(_){ } }, 0);
      });
    },

    attendancePrompt(user, team){
      return new Promise((resolve)=>{
        const u = user || {};
        const t = team || { id:'', label:'' };
        const teamId = String(u.teamId || t.id || '');
        const reasons = (window.Store && Store.getTeamWFHReasons) ? (Store.getTeamWFHReasons(teamId)||[]) : [];
        const safeReasons = (Array.isArray(reasons) && reasons.length) ? reasons : ['Other'];

        let modal = document.getElementById('mumsAttendanceModal');
        if(!modal){
          modal = document.createElement('div');
          modal.id = 'mumsAttendanceModal';
          modal.className = 'modal attendance-modal';
          modal.innerHTML = `
            <div class="panel" style="max-width:640px">
              <div class="head">
                <div>
                  <div class="announce-title">Attendance Confirmation</div>
                  <div class="small muted" id="attSub" style="margin-top:2px"></div>
                </div>
              </div>
              <div class="body" style="display:grid;gap:12px">
                <div class="row" style="gap:12px;align-items:center;flex-wrap:wrap">
                  <div class="avatar-lg" id="attAvatar"></div>
                  <div style="display:grid;gap:2px">
                    <div class="h3" id="attName" style="margin:0"></div>
                    <div class="small muted" id="attTeam"></div>
                  </div>
                </div>

                <div class="card pad" style="padding:14px">
                  <div class="small muted" style="margin-bottom:10px">
                    To confirm your attendance for today, please select if you are working.
                  </div>
                  <div class="row" style="gap:10px;flex-wrap:wrap">
                    <button class="btn" type="button" id="attOffice">In Office</button>
                    <button class="btn" type="button" id="attWFH">Work From Home</button>
                  </div>

                  <div id="attWFHWrap" style="display:none;margin-top:12px">
                    <label class="field" style="max-width:420px">
                      <div class="label">WFH Reason (required)</div>
                      <select class="input" id="attReason">
                        <option value="">Select reason</option>
                      </select>
                    </label>
                  </div>

                  <div class="row" style="justify-content:flex-end;gap:8px;margin-top:12px;flex-wrap:wrap">
                    <button class="btn primary" type="button" id="attSubmit" disabled>Save Attendance</button>
                  </div>
                </div>
                <div class="small muted">
                  Note: Attendance is required during your active shift window. You cannot proceed until you submit.
                </div>
              </div>
            </div>
          `;
          document.body.appendChild(modal);
        }

        document.body.classList.add('attendance-locked');
        UI.bringToFront(modal, { baseZ: 2147483300, panelOffset: 1, headOffset: 2 });

        const name = String(u.name || u.fullName || u.username || 'User');
        const sub = modal.querySelector('#attSub');
        const attName = modal.querySelector('#attName');
        const attTeam = modal.querySelector('#attTeam');
        const av = modal.querySelector('#attAvatar');
        const reasonSel = modal.querySelector('#attReason');
        const wfhWrap = modal.querySelector('#attWFHWrap');
        const bOffice = modal.querySelector('#attOffice');
        const bWFH = modal.querySelector('#attWFH');
        const bSubmit = modal.querySelector('#attSubmit');

        sub.textContent = 'Please submit your attendance to continue.';
        attName.textContent = name;
        attTeam.textContent = `Team: ${String(t.label||teamId||'')}`;

        try{
          const prof = (window.Store && Store.getProfile) ? (Store.getProfile(u.id)||{}) : {};
          if(prof.photoDataUrl){
            av.innerHTML = `<img src="${UI.esc(prof.photoDataUrl)}" alt="Profile" />`;
          }else{
            av.textContent = UI.initials(name);
          }
        }catch(_){
          av.textContent = UI.initials(name);
        }

        reasonSel.innerHTML = `<option value="">Select reason</option>` + safeReasons.map(r=>`<option value="${UI.esc(r)}">${UI.esc(r)}</option>`).join('');

        let mode = '';
        let reason = '';

        function update(){
          if(mode === 'OFFICE'){
            wfhWrap.style.display = 'none';
            bSubmit.disabled = false;
          }else if(mode === 'WFH'){
            wfhWrap.style.display = '';
            bSubmit.disabled = !reason;
          }else{
            wfhWrap.style.display = 'none';
            bSubmit.disabled = true;
          }
          bOffice.classList.toggle('primary', mode==='OFFICE');
          bWFH.classList.toggle('primary', mode==='WFH');
        }

        bOffice.onclick = ()=>{ mode='OFFICE'; reason=''; if(reasonSel) reasonSel.value=''; update(); };
        bWFH.onclick = ()=>{ mode='WFH'; update(); };
        reasonSel.onchange = ()=>{ reason = String(reasonSel.value||''); update(); };

        const onKey = (e)=>{
          if(e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); return false; }
          return true;
        };

        document.addEventListener('keydown', onKey, true);

        bSubmit.onclick = ()=>{
          if(!mode) return;
          if(mode==='WFH' && !reason) return;
          document.removeEventListener('keydown', onKey, true);
          modal.classList.remove('open');
          document.body.classList.remove('attendance-locked');

          const record = {
            id: 'att_' + Math.random().toString(16).slice(2) + '_' + Date.now(),
            userId: u.id,
            username: u.username || '',
            name,
            teamId: teamId || '',
            teamLabel: String(t.label||''),
            mode,
            reason: (mode==='WFH') ? reason : '',
            ts: Date.now()
          };
          resolve(record);
        };

        modal.onclick = (e)=>{ if(e.target===modal){ e.preventDefault(); e.stopPropagation(); } };
        update();
        modal.classList.add('open');
      });
    },

    overtimePrompt(user, team, ctx){
      return new Promise((resolve)=>{
        const u = user || {};
        const t = team || { id:'', label:'' };
        const c = ctx || {};
        const scheduledEnd = Number(c.scheduledEndTs || 0);
        const overtimeMinutes = Math.max(0, Number(c.overtimeMinutes || 0));
        const name = String(u.name || u.fullName || u.username || 'User');

        let modal = document.getElementById('mumsOvertimeModal');
        if(!modal){
          modal = document.createElement('div');
          modal.id = 'mumsOvertimeModal';
          modal.className = 'modal attendance-modal';
          modal.innerHTML = `
            <div class="panel" style="max-width:700px">
              <div class="head">
                <div>
                  <div class="announce-title">Overtime Confirmation Required</div>
                  <div class="small muted" id="otSub" style="margin-top:2px"></div>
                </div>
              </div>
              <div class="body" style="display:grid;gap:12px">
                <div class="card pad" style="padding:14px;display:grid;gap:10px">
                  <div class="small" style="line-height:1.5;color:#e2e8f0">
                    Your scheduled work hours have ended. Please confirm if you are continuing as overtime.
                  </div>
                  <div class="small muted" id="otMeta"></div>
                  <div class="row" style="gap:10px;flex-wrap:wrap">
                    <button class="btn primary" type="button" id="otYes">Yes, continue as overtime</button>
                    <button class="btn" type="button" id="otNo">No, mark shift as completed</button>
                  </div>

                  <div id="otReasonWrap" style="display:none;margin-top:6px">
                    <label class="field" style="max-width:none">
                      <div class="label">Reason for Overtime (required)</div>
                      <textarea class="input" id="otReason" rows="3" maxlength="300" placeholder="Example: Backlog clean-up, urgent customer cases, production support"></textarea>
                    </label>
                    <div class="row" style="justify-content:flex-end;gap:8px;margin-top:8px">
                      <button class="btn" type="button" id="otCancelReason">Back</button>
                      <button class="btn primary" type="button" id="otConfirmYes" disabled>Confirm Overtime</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          `;
          document.body.appendChild(modal);
        }

        UI.bringToFront(modal, { baseZ: 2147483350, panelOffset: 1, headOffset: 2 });
        const sub = modal.querySelector('#otSub');
        const meta = modal.querySelector('#otMeta');
        const yesBtn = modal.querySelector('#otYes');
        const noBtn = modal.querySelector('#otNo');
        const reasonWrap = modal.querySelector('#otReasonWrap');
        const reasonTa = modal.querySelector('#otReason');
        const cancelReason = modal.querySelector('#otCancelReason');
        const confirmYes = modal.querySelector('#otConfirmYes');

        sub.textContent = `${name} • Team ${String(t.label || t.id || u.teamId || 'N/A')}`;
        const when = scheduledEnd ? new Date(scheduledEnd).toLocaleString('en-CA', { year:'numeric', month:'short', day:'2-digit', hour:'2-digit', minute:'2-digit' }) : 'N/A';
        const hh = Math.floor(overtimeMinutes / 60);
        const mm = overtimeMinutes % 60;
        const otLabel = overtimeMinutes > 0 ? `${hh>0?`${hh}h `:''}${mm}m` : '0m';
        meta.textContent = `Scheduled end: ${when} • Current overtime: ${otLabel}`;

        const cleanup = ()=>{
          modal.classList.remove('open');
          modal.onclick = null;
          document.removeEventListener('keydown', onKey, true);
        };
        const finish = (v)=>{ cleanup(); resolve(v); };
        const onKey = (e)=>{
          if(e.key === 'Escape'){ e.preventDefault(); finish({ action:'NO' }); }
        };
        document.addEventListener('keydown', onKey, true);

        const syncReasonState = ()=>{
          const txt = String((reasonTa && reasonTa.value) || '').trim();
          if(confirmYes) confirmYes.disabled = !txt;
        };

        if(reasonTa) reasonTa.value = '';
        if(reasonWrap) reasonWrap.style.display = 'none';
        if(confirmYes) confirmYes.disabled = true;

        yesBtn.onclick = ()=>{
          if(reasonWrap) reasonWrap.style.display = '';
          try{ reasonTa && reasonTa.focus(); }catch(_){ }
          syncReasonState();
        };
        noBtn.onclick = ()=>finish({ action:'NO' });
        if(reasonTa) reasonTa.oninput = ()=>syncReasonState();
        if(cancelReason) cancelReason.onclick = ()=>{
          if(reasonWrap) reasonWrap.style.display = 'none';
          if(reasonTa) reasonTa.value = '';
          syncReasonState();
        };
        if(confirmYes) confirmYes.onclick = ()=>{
          const reason = String((reasonTa && reasonTa.value) || '').trim();
          if(!reason) return;
          finish({ action:'YES', reason });
        };

        modal.onclick = (e)=>{ if(e.target===modal){ e.preventDefault(); e.stopPropagation(); } };
        modal.classList.add('open');
      });
    },

    downloadJSON(filename, obj){
      const blob = new Blob([JSON.stringify(obj, null, 2)], { type:'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
    },

    downloadCSV(filename, rows){
      const esc = (v)=>{
        const s = String(v ?? '');
        if(/^[0-9]{12,18}$/.test(s)){ return '"=""' + s + '"""'; }
        if(/[",\n\r]/.test(s)) return '"' + s.replace(/"/g,'""') + '"';
        return s;
      };
      const csv = rows.map(r => r.map(esc).join(',')).join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
    },

    pickJSON(){
      return new Promise((resolve)=>{
        const inp = document.createElement('input');
        inp.type='file';
        inp.accept='application/json';
        inp.onchange = async () => {
          const f = inp.files && inp.files[0];
          if(!f) return resolve(null);
          const txt = await f.text();
          try{ resolve(JSON.parse(txt)); }catch(e){ resolve(null); }
        };
        inp.click();
      });
    },

    manilaParts(date){
      const Config = window.Config;
      const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: (Config && Config.TZ) || 'Asia/Manila',
        year:'numeric',month:'2-digit',day:'2-digit',
        hour:'2-digit',minute:'2-digit',second:'2-digit',
        hour12:false
      });
      const parts = Object.fromEntries(
        fmt.formatToParts(date||new Date())
          .filter(p=>p.type!=='literal')
          .map(p=>[p.type,p.value])
      );
      return {
        y:+parts.year, m:+parts.month, d:+parts.day,
        hh:+parts.hour, mm:+parts.minute, ss:+parts.second,
        isoDate:`${parts.year}-${parts.month}-${parts.day}`,
        iso:`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`
      };
    },
    manilaNow(){ return UI.manilaParts(new Date()); },

    mailboxNowParts(){
      try{
        const u = (window.Auth && Auth.getUser) ? Auth.getUser() : null;
        const superAdmin = window.Config && Config.ROLES ? Config.ROLES.SUPER_ADMIN : 'SUPER_ADMIN';
        const isSA = !!(u && u.role === superAdmin);
        let o = (window.Store && Store.getMailboxTimeOverride) ? Store.getMailboxTimeOverride() : null;
        try{
          const raw = localStorage.getItem('mums_mailbox_time_override_cloud');
          const cloud = raw ? JSON.parse(raw) : null;
          if(cloud && typeof cloud === 'object' && cloud.enabled && String(cloud.scope) === 'global'){
            const def = { enabled:false, ms:0, freeze:true, setAt:0, scope:'global' };
            const c = Object.assign({}, def, cloud);
            c.enabled = !!c.enabled;
            c.ms = Number(c.ms)||0;
            c.freeze = (c.freeze !== false);
            c.setAt = Number(c.setAt)||0;
            c.scope = 'global';
            const oScope = String(o?.scope||'');
            const oMs = Number(o?.ms)||0;
            const oSetAt = Number(o?.setAt)||0;
            const oFreeze = (o?.freeze !== false);
            if(!o || !o.enabled || oScope !== 'global' || oMs !== c.ms || oSetAt !== c.setAt || oFreeze !== c.freeze){
              o = c;
            }
          }
        }catch(_){}
        if(!o || !o.enabled || String(o.scope||'') !== 'global'){
          try{
            const raw = localStorage.getItem('mums_mailbox_time_override_cloud');
            const cloud = raw ? JSON.parse(raw) : null;
            if(cloud && typeof cloud === 'object' && cloud.enabled && String(cloud.scope) === 'global'){
              const def = { enabled:false, ms:0, freeze:true, setAt:0, scope:'global' };
              const c = Object.assign({}, def, cloud);
              c.enabled = !!c.enabled;
              c.ms = Number(c.ms)||0;
              c.freeze = (c.freeze !== false);
              c.setAt = Number(c.setAt)||0;
              c.scope = 'global';
              o = c;
            }
          }catch(_){}
        }

        if(!o || !o.enabled) return UI.manilaNow();
        const scope = (String(o.scope||'sa_only') === 'global') ? 'global' : 'sa_only';
        if(scope === 'sa_only' && !isSA) return UI.manilaNow();

        const base = Number(o.ms);
        const MIN_VALID_MS = Date.UTC(2020,0,1);
        const MAX_VALID_MS = Date.now() + (366 * 24 * 60 * 60 * 1000);
        if(!Number.isFinite(base) || base <= 0) return UI.manilaNow();
        if(base < MIN_VALID_MS || base > MAX_VALID_MS) return UI.manilaNow();

        const freeze = (o.freeze !== false);
        let setAt = Number(o.setAt)||0;
        if(!freeze){
          if(!Number.isFinite(setAt) || setAt <= 0 || setAt > (Date.now() + 60*1000)) setAt = Date.now();
        }else{
          setAt = 0;
        }

        const ms = freeze ? base : (base + Math.max(0, Date.now() - setAt));
        if(!Number.isFinite(ms) || ms <= 0) return UI.manilaNow();
        return UI.manilaParts(new Date(ms));
      }catch(_){
        return UI.manilaNow();
      }
    },

    mailboxTimeInfo(){
      const info = {
        isSuperAdmin:false, scope:'sa_only', isApplicable:false, overrideEnabled:false,
        freeze:true, baseMs:0, effectiveMs:0, systemParts:UI.manilaNow(), effectiveParts:null,
      };
      try{
        const u = (window.Auth && Auth.getUser) ? Auth.getUser() : null;
        const superAdmin = (window.Config && Config.ROLES) ? Config.ROLES.SUPER_ADMIN : 'SUPER_ADMIN';
        info.isSuperAdmin = !!(u && u.role === superAdmin);
        let o = (window.Store && Store.getMailboxTimeOverride) ? Store.getMailboxTimeOverride() : null;
        try{
          const raw = localStorage.getItem('mums_mailbox_time_override_cloud');
          const cloud = raw ? JSON.parse(raw) : null;
          if(cloud && typeof cloud === 'object' && cloud.enabled && String(cloud.scope) === 'global'){
            const def = { enabled:false, ms:0, freeze:true, setAt:0, scope:'global' };
            const c = Object.assign({}, def, cloud);
            c.enabled = !!c.enabled;
            c.ms = Number(c.ms)||0;
            c.freeze = (c.freeze !== false);
            c.setAt = Number(c.setAt)||0;
            c.scope = 'global';
            const oScope = String(o?.scope||'');
            const oMs = Number(o?.ms)||0;
            const oSetAt = Number(o?.setAt)||0;
            const oFreeze = (o?.freeze !== false);
            if(!o || !o.enabled || oScope !== 'global' || oMs !== c.ms || oSetAt !== c.setAt || oFreeze !== c.freeze){
              o = c;
            }
          }
        }catch(_){}
        if(!o || !o.enabled || String(o.scope||'') !== 'global'){
          try{
            const raw = localStorage.getItem('mums_mailbox_time_override_cloud');
            const cloud = raw ? JSON.parse(raw) : null;
            if(cloud && typeof cloud === 'object' && cloud.enabled && String(cloud.scope) === 'global'){
              const def = { enabled:false, ms:0, freeze:true, setAt:0, scope:'global' };
              const c = Object.assign({}, def, cloud);
              c.enabled = !!c.enabled;
              c.ms = Number(c.ms)||0;
              c.freeze = (c.freeze !== false);
              c.setAt = Number(c.setAt)||0;
              c.scope = 'global';
              o = c;
            }
          }catch(_){}
        }

        if(!o || !o.enabled) return info;
        const base = Number(o.ms);
        const MIN_VALID_MS = Date.UTC(2020,0,1);
        const MAX_VALID_MS = Date.now() + (366 * 24 * 60 * 60 * 1000);
        if(!Number.isFinite(base) || base <= 0) return info;
        if(base < MIN_VALID_MS || base > MAX_VALID_MS) return info;
        info.scope = (String(o.scope||'sa_only') === 'global') ? 'global' : 'sa_only';
        info.isApplicable = (info.scope === 'global') ? true : info.isSuperAdmin;
        if(!info.isApplicable) return info;
        info.overrideEnabled = true;
        info.freeze = (o.freeze !== false);
        info.baseMs = base;
        let setAt = Number(o.setAt)||0;
        if(info.freeze === false){
          if(!Number.isFinite(setAt) || setAt <= 0 || setAt > (Date.now() + 60*1000)) setAt = Date.now();
        }else{
          setAt = 0;
        }
        info.effectiveMs = info.freeze ? info.baseMs : (info.baseMs + Math.max(0, Date.now()-setAt));
        info.effectiveParts = UI.manilaParts(new Date(info.effectiveMs));
      }catch(_){ }
      return info;
    },

    isMailboxOverrideActive(){
      try{
        const i = UI.mailboxTimeInfo();
        return !!(i && i.overrideEnabled);
      }catch(_){ return false; }
    },

    parseManilaDateTimeLocal(v){
      const s = String(v||'').trim();
      if(!s || !s.includes('T')) return 0;
      const [d,t] = s.split('T');
      const [yy,mm,dd] = d.split('-').map(n=>Number(n));
      const [hh,mi] = t.split(':').map(n=>Number(n));
      if(!yy||!mm||!dd||Number.isNaN(hh)||Number.isNaN(mi)) return 0;
      return Date.UTC(yy, mm-1, dd, hh-8, mi, 0, 0);
    },

    formatManilaDateTimeLocal(ms){
      const p = UI.manilaParts(new Date(Number(ms)||Date.now()));
      const pad = n => String(n).padStart(2,'0');
      return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.hh)}:${pad(p.mm)}`;
    },

    isoToYMD(iso){
      const parts = String(iso||'').split('-');
      const y = Number(parts[0]);
      const m = Number(parts[1]);
      const d = Number(parts[2]);
      if(!y || !m || !d) return null;
      return { y, m, d };
    },

    weekdayFromISO(iso){
      const v = UI.isoToYMD(iso);
      if(!v) return null;
      const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
      let y = v.y;
      const m = v.m;
      const d = v.d;
      if(m < 3) y -= 1;
      const wd = (y + Math.floor(y/4) - Math.floor(y/100) + Math.floor(y/400) + t[m-1] + d) % 7;
      return wd;
    },

    addDaysISO(iso, deltaDays){
      const v = UI.isoToYMD(iso);
      if(!v) return String(iso||'');
      const ms = Date.UTC(v.y, v.m-1, v.d) + (Number(deltaDays||0) * 86400000);
      const d = new Date(ms);
      const pad = n => String(n).padStart(2,'0');
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
    },

    manilaTodayISO(){
      return UI.manilaNow().isoDate;
    },
    minutesOfDay(p){ return (p.hh*60) + p.mm; },
    parseHM(hm){ const a = String(hm||'00:00').split(':'); return (+a[0]||0)*60 + (+a[1]||0); },

    DAYS: ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'],

    shiftMeta(team){
      let startHM = team && team.teamStart;
      let endHM = team && team.teamEnd;
      try{
        if(window.Store && Store.getTeamConfig && team && team.id){
          const cfg = Store.getTeamConfig(team.id);
          startHM = (cfg && cfg.schedule && cfg.schedule.start) ? cfg.schedule.start : startHM;
          endHM = (cfg && cfg.schedule && cfg.schedule.end) ? cfg.schedule.end : endHM;
        }
      }catch(_){ }
      const start = UI.parseHM(startHM);
      const end = UI.parseHM(endHM);
      const wraps = end <= start;
      const length = wraps ? (24*60 - start + end) : (end - start);
      return { start, end, wraps, length };
    },

    offsetFromShiftStart(team, hm){
      const m = UI.parseHM(hm);
      const meta = UI.shiftMeta(team);
      if(!meta.wraps) return m - meta.start;
      if(m >= meta.start) return m - meta.start;
      return (24*60 - meta.start) + m;
    },

    blockToStyle(team, block){
      const meta = UI.shiftMeta(team);
      const a = UI.offsetFromShiftStart(team, block.start);
      const b = UI.offsetFromShiftStart(team, block.end);
      const left = (a / meta.length) * 100;
      const width = ((b - a) / meta.length) * 100;
      return { left: left, width: width };
    },

    snapMinutes(mins, step){
      const s = step || 15;
      return Math.max(0, Math.round(mins / s) * s);
    },

    offsetToHM(team, off){
      const meta = UI.shiftMeta(team);
      const abs = (meta.start + off) % (24*60);
      const hh = String(Math.floor(abs/60)).padStart(2,'0');
      const mm = String(abs%60).padStart(2,'0');
      return `${hh}:${mm}`;
    },

    manilaNowDate(){
      return new Date(new Date().toLocaleString('en-US', { timeZone: (window.Config && Config.TZ) || 'Asia/Manila' }));
    },

    manilaWeekStartMondayMs(){
      const d = UI.manilaNowDate();
      const day = d.getDay();
      const diff = (day === 0) ? 6 : (day - 1);
      d.setDate(d.getDate() - diff);
      d.setHours(0,0,0,0);
      return d.getTime();
    },
    formatDuration(sec){
      sec = Math.max(0, Math.floor(sec||0));
      const h = Math.floor(sec/3600);
      const m = Math.floor((sec%3600)/60);
      const s = sec%60;
      const pad = n => String(n).padStart(2,'0');
      return `${pad(h)}:${pad(m)}:${pad(s)}`;
    },

    getDutyWindow(nowParts){
      const Config = window.Config;
      const p = nowParts || UI.manilaNow();
      const nowMin = UI.minutesOfDay(p);
      const teams = (Config && Array.isArray(Config.TEAMS)) ? Config.TEAMS : [];
      const windows = teams.map(t=>{
        const start = UI.parseHM(t.dutyStart);
        const end = UI.parseHM(t.dutyEnd);
        return { team:t, start, end, wraps: end<=start };
      });

      function inWindow(w){
        if(!w.wraps) return nowMin>=w.start && nowMin<w.end;
        return (nowMin>=w.start) || (nowMin<w.end);
      }

      let cur = windows.find(inWindow) || windows[0];
      const idx = Math.max(0, windows.findIndex(w=>w.team.id===cur.team.id));
      const next = windows[(idx+1)%windows.length] || windows[0];

      let minsLeft;
      if(!cur.wraps) minsLeft = cur.end - nowMin;
      else minsLeft = (nowMin < cur.end) ? (cur.end - nowMin) : (24*60 - nowMin + cur.end);
      const secLeft = minsLeft*60 - p.ss;

      return { current: cur.team, next: next.team, secLeft };
    },

    schedulePill(scheduleId){
      const Config = window.Config;
      const s = Config && Config.scheduleById ? Config.scheduleById(scheduleId) : null;
      if(!s) return '';
      return `<span class="iconpill"><span class="icon">${UI.esc(s.icon)}</span>${UI.esc(s.label)}</span>`;
    },

    activeAnnouncements(){
      const Store = window.Store;
      const list = Store ? Store.getAnnouncements() : [];
      const nowMs = Date.now();
      return list
        .filter(a => nowMs >= a.startAt && nowMs <= a.endAt)
        .sort((a,b)=>a.startAt-b.startAt);
    },

    toDatetimeLocal(ms){
      const d = new Date(ms);
      const pad = n => String(n).padStart(2,'0');
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    },

    _sndKey(userId){ return `ums_sound_settings_${userId||'anon'}`; },
    getSoundSettings(userId){
      try{
        const raw = localStorage.getItem(UI._sndKey(userId));
        const obj = raw ? JSON.parse(raw) : null;
        const out = Object.assign({ enabled: true, volume: 0.65, type: 'beep' }, (obj||{}));
        out.volume = Math.max(0, Math.min(1, Number(out.volume)));
        out.enabled = !!out.enabled;
        out.type = ['beep','chime','pop'].includes(out.type) ? out.type : 'beep';
        return out;
      }catch(e){
        return { enabled: true, volume: 0.65, type: 'beep' };
      }
    },
    saveSoundSettings(userId, settings){
      const s = Object.assign(UI.getSoundSettings(userId), settings||{});
      try{ localStorage.setItem(UI._sndKey(userId), JSON.stringify(s)); }catch(e){}
      return s;
    },
    playNotifSound(userId){
      const s = UI.getSoundSettings(userId);
      if(!s.enabled || s.volume<=0.001) return;

      try{
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if(!Ctx) return;
        const ctx = UI._audioCtx || (UI._audioCtx = new Ctx());
        const now = ctx.currentTime;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        gain.connect(ctx.destination);

        const env = (t0, attack, hold, release, peak)=>{
          gain.gain.cancelScheduledValues(t0);
          gain.gain.setValueAtTime(0, t0);
          gain.gain.linearRampToValueAtTime(peak, t0 + attack);
          gain.gain.setValueAtTime(peak, t0 + attack + hold);
          gain.gain.linearRampToValueAtTime(0, t0 + attack + hold + release);
        };

        const osc = ctx.createOscillator();
        osc.connect(gain);

        if(s.type==='chime'){
          osc.type = 'sine';
          osc.frequency.setValueAtTime(880, now);
          env(now, 0.01, 0.08, 0.18, 0.35*s.volume);
          osc.start(now);
          osc.stop(now + 0.30);

          const osc2 = ctx.createOscillator();
          osc2.type='sine';
          osc2.frequency.setValueAtTime(1175, now + 0.11);
          osc2.connect(gain);
          osc2.start(now + 0.11);
          osc2.stop(now + 0.36);
        } else if(s.type==='pop'){
          osc.type='triangle';
          osc.frequency.setValueAtTime(520, now);
          env(now, 0.005, 0.03, 0.09, 0.45*s.volume);
          osc.start(now);
          osc.stop(now + 0.13);
        } else {
          osc.type='square';
          osc.frequency.setValueAtTime(760, now);
          env(now, 0.01, 0.05, 0.12, 0.30*s.volume);
          osc.start(now);
          osc.stop(now + 0.20);
          const osc2 = ctx.createOscillator();
          osc2.type='square';
          osc2.frequency.setValueAtTime(760, now + 0.22);
          osc2.connect(gain);
          env(now + 0.22, 0.01, 0.05, 0.12, 0.26*s.volume);
          osc2.start(now + 0.22);
          osc2.stop(now + 0.42);
        }
      }catch(e){}
    },

    bindSoundSettingsModal(user){
      const u = user || (window.Auth && Auth.getUser && Auth.getUser());
      if(!u) return;
      const modal = document.getElementById('soundSettingsModal');
      if(!modal) return;
      const enabledEl = document.getElementById('sndEnabled');
      const typeEl = document.getElementById('sndType');
      const volEl = document.getElementById('sndVol');
      const testEl = document.getElementById('sndTest');
      const saveEl = document.getElementById('sndSave');

      const load = ()=>{
        const s = UI.getSoundSettings(u.id);
        if(enabledEl) enabledEl.checked = !!s.enabled;
        if(typeEl) typeEl.value = s.type;
        if(volEl) volEl.value = String(Math.round((s.volume||0)*100));
      };

      if(testEl) testEl.onclick = ()=>{
        const s = {
          enabled: enabledEl ? enabledEl.checked : true,
          type: typeEl ? typeEl.value : 'beep',
          volume: (volEl ? Number(volEl.value) : 65) / 100
        };
        UI.saveSoundSettings(u.id, s);
        UI.playNotifSound(u.id);
      };
      if(saveEl) saveEl.onclick = ()=>{
        const s = {
          enabled: enabledEl ? enabledEl.checked : true,
          type: typeEl ? typeEl.value : 'beep',
          volume: (volEl ? Number(volEl.value) : 65) / 100
        };
        UI.saveSoundSettings(u.id, s);
        UI.closeModal('soundSettingsModal');
      };

      (modal.querySelectorAll('[data-close="soundSettingsModal"]')||[]).forEach(b=>b.onclick=()=>UI.closeModal('soundSettingsModal'));
      modal.addEventListener('transitionend', ()=>{});
      load();
      return load;
    },

    bindDictionaryModal(user){
      const u = user || (window.Auth && Auth.getUser && Auth.getUser());
      const modal = document.getElementById('dictionaryModal');
      if(!modal) return;
      const searchEl = document.getElementById('dictSearch');
      const qEl = document.getElementById('dictQuestion');
      const askEl = document.getElementById('dictAskBtn');
      const askHint = document.getElementById('dictAskHint');
      const metaEl = document.getElementById('dictMeta');
      const contentEl = document.getElementById('dictContent');
      const footerEl = document.getElementById('dictFooter');

      const keyQ = (u ? `ums_dict_questions_${u.id}` : 'ums_dict_questions');
      const loadQs = ()=>{
        try{ const arr = JSON.parse(localStorage.getItem(keyQ)||'[]'); return Array.isArray(arr)?arr:[]; }catch(e){ return []; }
      };
      const saveQs = (arr)=>{ localStorage.setItem(keyQ, JSON.stringify(Array.isArray(arr)?arr:[])); };

      const stateSummary = ()=>{
        const cfg = window.Config || {};
        const tz = cfg.TZ || 'Asia/Manila';
        const navIds = (cfg.NAV||[]).map(n=>n.id);
        const hasMaster = navIds.includes('members') && (cfg.NAV||[]).some(n=>n.id==='members' && (n.children||[]).some(c=>c.id==='master_schedule'));
        const schedules = Object.keys(cfg.SCHEDULES||{});
        const week = (UI && UI.manilaTodayISO) ? UI.manilaTodayISO() : '';
        return {
          tz, week,
          user: u ? { name: u.name||u.username, role: u.role, teamId: u.teamId } : null,
          features: { masterSchedule: !!hasMaster, leaves: ['SICK','EMERGENCY','VACATION','HOLIDAY'], hourGrid: true, dragToPaint: true, sendAck: true, soundSettings: true },
          counts: { teams: (cfg.TEAMS||[]).length, schedules: schedules.length, nav: navIds.length }
        };
      };

      const illusGrid = ()=>`
        <div class="dict-illus" aria-hidden="true">
          <svg viewBox="0 0 520 120" width="100%" height="120" preserveAspectRatio="none">
            <rect x="8" y="18" width="504" height="84" rx="14" ry="14" fill="rgba(255,255,255,.03)" stroke="rgba(255,255,255,.10)"/>
            ${Array.from({length:9}).map((_,i)=>{
              const x = 18 + i*56;
              return `<rect x="${x}" y="32" width="46" height="56" rx="10" fill="rgba(255,255,255,.04)" stroke="rgba(255,255,255,.08)"/>`;
            }).join('')}
            <rect x="18" y="32" width="102" height="56" rx="10" fill="rgba(110,231,255,.14)" stroke="rgba(110,231,255,.45)"/>
            <text x="28" y="64" fill="rgba(255,255,255,.85)" font-size="12" font-weight="700">Call</text>
            <text x="28" y="80" fill="rgba(255,255,255,.55)" font-size="10">1-hour blocks</text>
          </svg>
        </div>`;

      const illusLeaves = ()=>`
        <div class="dict-illus" aria-hidden="true">
          <svg viewBox="0 0 520 120" width="100%" height="120" preserveAspectRatio="none">
            <rect x="8" y="18" width="504" height="84" rx="14" fill="rgba(255,255,255,.03)" stroke="rgba(255,255,255,.10)"/>
            <rect x="18" y="32" width="150" height="56" rx="12" fill="rgba(255,255,255,.03)" stroke="rgba(255,255,255,.10)"/>
            <text x="30" y="66" fill="rgba(255,255,255,.85)" font-size="12" font-weight="800">SL EL VL HL</text>
            <rect x="190" y="32" width="312" height="56" rx="12" fill="rgba(255,255,255,.02)" stroke="rgba(255,255,255,.08)"/>
            <text x="206" y="58" fill="rgba(255,255,255,.65)" font-size="12" font-weight="700">Click to set leave</text>
            <text x="206" y="76" fill="rgba(255,255,255,.55)" font-size="11">Click again → confirm removal</text>
          </svg>
        </div>`;

      const buildCards = (s)=>{
        const cards = [];
        cards.push({ id:'overview', title:'What is MUMS?', keywords:'mums meys user management system overview', body:`MUMS (MUMS User Management System) is a single-file web app for managing users, teams, announcements, and 1-hour grid scheduling (no minutes). It runs locally in the browser using secure localStorage.` });
        cards.push({ id:'scheduling', title:'Scheduling rules (strict hour blocks)', keywords:'schedule hour grid no minutes drag paint call onqueue back office block lunch', body:`All schedules are strictly aligned to 1-hour blocks. No minutes are allowed on the grid. Drag-to-paint lets Team Leads fill multiple hours quickly while still enforcing 1-hour steps.`, extra: illusGrid() });
        cards.push({ id:'master', title:'Master Schedule and Rest Days', keywords:'master schedule rest day monthly quarterly frequency', body:`Team Leads/Admins can configure fixed rest days per member in Master Schedule. Rest days automatically gray-out the member in Members Assigning with the notice “ON REST DAY”. Frequency controls how the fixed schedule repeats (monthly / every 2 months / every 3 months / quarterly).` });
        cards.push({ id:'leaves', title:'Leaves (SL / EL / VL / HL)', keywords:'sick emergency vacation holiday leave sl el vl hl', body:`Leaves are per-member per-date: SL (Sick), EL (Emergency), VL (Vacation), HL (Holiday). Setting a leave grays out the member schedule immediately and auto-scheduling skips them. Clicking an already-active leave prompts for confirmation before removal.`, extra: illusLeaves() });
        cards.push({ id:'send', title:'Send schedule updates + Acknowledgements', keywords:'send notify popup acknowledge', body:`Team Lead can press “Send” to broadcast schedule updates. Members receive a real-time pop-up with an Acknowledge button. Team Leads can view acknowledgement status (who acknowledged + timestamp).` });
        cards.push({ id:'sound', title:'Notification sound settings', keywords:'sound beep volume type on off', body:`Users can control notification sound with the Settings icon: On/Off, volume, and sound type (Beep/Chime/Pop). Notifications still show pop-ups even if sound is Off.` });
        cards.push({ id:'roles', title:'Roles and permissions', keywords:'roles team lead admin super user permissions', body:`Super Admin controls everything. Admin can manage teams and users. Team Lead manages their own team’s members, master schedule, announcements, and scheduling. Members view their own schedules and receive notifications.` });
        cards.push({ id:'structure', title:'How MUMS is built', keywords:'structure localstorage pages config store ui', body:`MUMS is a lightweight, file-based web app: Config defines teams/schedules/permissions; Store persists data in localStorage (with backups); UI provides timezone-safe Manila helpers and reusable modals; Pages render the screens (Dashboard, Members, Master Schedule, User Management, etc.).` });
        return cards;
      };

      const render = ()=>{
        const s = stateSummary();
        const cards = buildCards(s);
        const q = (searchEl && searchEl.value || '').trim().toLowerCase();
        const qs = loadQs();

        metaEl && (metaEl.innerHTML = `
          <div class="dict-grid">
            <div class="dict-card">
              <h3>Current state</h3>
              <div class="small">
                <div><b>Time zone:</b> ${UI.esc(s.tz)} (Manila)</div>
                <div><b>Today (Manila ISO):</b> ${UI.esc(s.week)}</div>
                ${s.user ? `<div><b>User:</b> ${UI.esc(s.user.name)} • ${UI.esc(s.user.role)} • Team ${UI.esc(s.user.teamId||'—')}</div>` : ''}
              </div>
            </div>
            <div class="dict-card">
              <h3>Enabled capabilities</h3>
              <div class="small">
                <div>✅ Strict 1-hour scheduling grid</div>
                <div>✅ Drag-to-paint assignment</div>
                <div>✅ Master Schedule + Rest Day sync</div>
                <div>✅ Leaves: SL, EL, VL, HL</div>
                <div>✅ Send + acknowledgements</div>
                <div>✅ Notification sound settings</div>
              </div>
            </div>
          </div>
        `);

        const filtered = !q ? cards : cards.filter(c=>{
          const hay = (c.title+' '+c.keywords+' '+c.body).toLowerCase();
          return hay.includes(q);
        });

        if(contentEl){
          contentEl.innerHTML = filtered.map(c=>{
            return `
              <div class="dict-card" data-id="${UI.esc(c.id)}">
                <h3>${UI.esc(c.title)}</h3>
                <div class="small">${UI.esc(c.body)}</div>
                ${c.extra || ''}
              </div>
            `;
          }).join('') || `<div class="dict-card"><h3>No match</h3><div class="small">Try a different keyword (e.g., rest day, leave, send, auto schedule).</div></div>`;
        }

        if(footerEl){
          footerEl.textContent = `MUMS Dictionary • Teams: ${s.counts.teams} • Schedules: ${s.counts.schedules} • Notes saved: ${qs.length}`;
        }

        if(askHint){
          if(qs.length){
            askHint.innerHTML = `Saved questions (local):<br>${qs.slice(0,5).map(x=>`• ${UI.esc(x.q)}`).join('<br>')}${qs.length>5?'<br>…':''}`;
          } else {
            askHint.textContent = 'Saved questions appear to you as notes (local only).';
          }
        }
      };

      if(searchEl){ searchEl.oninput = ()=>render(); }
      if(askEl){
        askEl.onclick = ()=>{
          const q = (qEl && qEl.value || '').trim();
          if(!q) return;
          const arr = loadQs();
          arr.unshift({ q, at: Date.now() });
          saveQs(arr.slice(0,50));
          if(qEl) qEl.value = '';
          render();
        };
      }

      (modal.querySelectorAll('[data-close="dictionaryModal"]')||[]).forEach(b=>b.onclick=()=>UI.closeModal('dictionaryModal'));

      render();
      return render;
    },

    bindReleaseNotesModal(user){
      const u = user || (window.Auth && Auth.getUser && Auth.getUser());
      const modal = document.getElementById('releaseNotesModal');
      if(!modal || !window.Store) return;

      const searchEl = document.getElementById('rnSearch');
      const filterEl = document.getElementById('rnFilter');
      const metaEl = document.getElementById('rnMeta');
      const listEl = document.getElementById('rnList');

      const adminWrap = document.getElementById('rnAdmin');
      const verEl = document.getElementById('rnVer');
      const tagsEl = document.getElementById('rnTags');
      const titleEl = document.getElementById('rnTitle');
      const bodyEl = document.getElementById('rnBody');
      const addEl = document.getElementById('rnAdd');

      const bodyPreviewEl = document.getElementById('rnBodyPreview');
      const importEl = document.getElementById('rnImportFile');
      const importModeEl = document.getElementById('rnImportMode');
      const importBtn = document.getElementById('rnImportBtn');
      const exportBtn = document.getElementById('rnExportBtn');
      const clearBtn = document.getElementById('rnClearBtn');
      const toolbar = document.getElementById('rnToolbar');

      const canManage = !!(u && window.Config && Config.can && Config.can(u,'manage_release_notes'));
      const canDelete = canManage;
      if(adminWrap) adminWrap.style.display = canManage ? '' : 'none';

      const fmt = (ms)=>{
        try{
          const d = new Date(Number(ms||0)||Date.now());
          return d.toLocaleString('en-CA', { year:'numeric', month:'short', day:'2-digit', hour:'2-digit', minute:'2-digit' });
        }catch(_){ return ''; }
      };

      const normalizeTags = (s)=>{
        return String(s||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean).slice(0,8);
      };

      const resolveDefaultVersion = ()=>{
        try{
          const el = document.querySelector('.brand-build');
          return el ? String(el.textContent||'').replace('Build:','').trim() : '';
        }catch(_){ return ''; }
      };

      const render = ()=>{
        const q = String(searchEl && searchEl.value || '').trim().toLowerCase();
        const f = String(filterEl && filterEl.value || 'all').trim().toLowerCase();
        const all = (Store.getReleaseNotes ? Store.getReleaseNotes() : []);

        let filtered = all;
        if(f && f!=='all'){ filtered = filtered.filter(n => (n.tags||[]).map(t=>String(t).toLowerCase()).includes(f)); }
        if(q){
          filtered = filtered.filter(n=>{
            const hay = (String(n.version||'') + ' ' + String(n.title||'') + ' ' + String(n.body||'') + ' ' + String((n.tags||[]).join(' '))).toLowerCase();
            return hay.includes(q);
          });
        }

        if(metaEl){ metaEl.textContent = `${filtered.length} of ${all.length} note(s) shown`; }

        if(listEl){
          listEl.innerHTML = filtered.map(n=>{
            const tags = (n.tags||[]).map(t=>`<span class="badge" style="margin-right:6px">${UI.esc(t)}</span>`).join('');
            return `
              <div class="card pad rn-item" style="margin:10px 0" data-rnid="${UI.esc(n.id||'')}">
                <div class="row" style="justify-content:space-between;gap:10px;align-items:flex-start">
                  <div style="min-width:0">
                    <div class="h3" style="margin:0">${UI.esc(n.title||'Update')}</div>
                    <div class="small muted" style="margin-top:4px">${UI.esc(n.version||'')} • ${UI.esc(fmt(n.date))}${n.author?(' • '+UI.esc(n.author)):''}</div>
                  </div>
                  ${canDelete ? `<button class="btn danger ghost rn-del" type="button" data-del="${UI.esc(n.id||'')}">Delete</button>` : ''}
                </div>
                <div class="rn-body" style="margin-top:10px">${renderMarkdownSafe(n.body||'')}</div>
                <div style="margin-top:10px">${tags}</div>
              </div>
            `;
          }).join('') || `<div class="card pad"><div class="small muted">No release notes match your filter.</div></div>`;
        }
      };

      function renderMarkdownSafe(md){
        const esc = UI.esc(String(md||''));
        let out = esc.replace(/```([\s\S]*?)```/g, (m,g)=>`<pre class="rn-pre"><code>${g}</code></pre>`);
        out = out.replace(/^###\s(.+)$/gm, '<div class="rn-h3">$1</div>');
        out = out.replace(/^##\s(.+)$/gm, '<div class="rn-h2">$1</div>');
        out = out.replace(/^#\s(.+)$/gm, '<div class="rn-h1">$1</div>');
        out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        out = out.replace(/`([^`]+)`/g, '<code class="rn-code">$1</code>');
        out = out.replace(/^(?:\s*[-*]\s.+\n?)+/gm, (block)=>{
          const items = block.trim().split(/\n/).map(l=>l.replace(/^\s*[-*]\s+/,'').trim()).filter(Boolean);
          if(!items.length) return block;
          return `<ul class="rn-ul">${items.map(i=>`<li>${i}</li>`).join('')}</ul>`;
        });
        out = out.replace(/^(?:\s*\d+\.\s.+\n?)+/gm, (block)=>{
          const items = block.trim().split(/\n/).map(l=>l.replace(/^\s*\d+\.\s+/,'').trim()).filter(Boolean);
          if(!items.length) return block;
          return `<ol class="rn-ol">${items.map(i=>`<li>${i}</li>`).join('')}</ol>`;
        });
        out = out.replace(/\n/g, '<br/>');
        return `<div class="rn-md">${out}</div>`;
      }

      if(searchEl) searchEl.oninput = ()=>render();
      if(filterEl) filterEl.onchange = ()=>render();

      if(toolbar && bodyEl){
        toolbar.querySelectorAll('[data-md]').forEach(btn=>{
          btn.onclick = ()=>{
            try{
              const t = String(btn.dataset.md||'');
              const ta = bodyEl;
              const start = ta.selectionStart || 0;
              const end = ta.selectionEnd || 0;
              const sel = String(ta.value||'').slice(start,end);
              const before = String(ta.value||'').slice(0,start);
              const after = String(ta.value||'').slice(end);

              let insert = t;
              if(t.includes('{text}')) insert = t.replace('{text}', sel||'text');
              ta.value = before + insert + after;
              const pos = before.length + insert.length;
              ta.focus();
              ta.selectionStart = ta.selectionEnd = pos;
              if(bodyPreviewEl) bodyPreviewEl.innerHTML = renderMarkdownSafe(ta.value||'');
            }catch(_){ }
          };
        });
      }

      if(bodyEl && bodyPreviewEl){
        bodyPreviewEl.innerHTML = renderMarkdownSafe(bodyEl.value||'');
        bodyEl.oninput = ()=>{ bodyPreviewEl.innerHTML = renderMarkdownSafe(bodyEl.value||''); };
      }

      if(addEl && canManage){
        addEl.onclick = ()=>{
          const ver = String(verEl && verEl.value || '').trim();
          const ttl = String(titleEl && titleEl.value || '').trim();
          const body = String(bodyEl && bodyEl.value || '').trim();
          const tags = normalizeTags(tagsEl && tagsEl.value || '');

          if(!ttl || !body){ alert('Please enter a Title and Details.'); return; }
          Store.addReleaseNote({
            version: ver || resolveDefaultVersion(),
            date: Date.now(), title: ttl, body: body, author: u ? (u.name||u.username||u.id) : '', tags: tags.length ? tags : ['feature'],
          });
          if(titleEl) titleEl.value = '';
          if(bodyEl) bodyEl.value = '';
          if(bodyPreviewEl) bodyPreviewEl.innerHTML = renderMarkdownSafe('');
          if(tagsEl) tagsEl.value = '';
          if(verEl) verEl.value = '';
          render();
        };
      }

      if(importBtn && canManage){
        importBtn.onclick = async()=>{
          const f = importEl && importEl.files && importEl.files[0];
          if(!f){ alert('Please choose a file to import.'); return; }
          const mode = String(importModeEl && importModeEl.value || 'merge');
          const name = String(f.name||'').toLowerCase();
          const text = await (f.text ? f.text() : new Promise((res,rej)=>{
            const r = new FileReader(); r.onload = ()=>res(String(r.result||'')); r.onerror = rej; r.readAsText(f);
          }));
          try{
            if(name.endsWith('.json')){
              const obj = JSON.parse(text);
              Store.importReleaseNotes(obj, mode);
            } else {
              const lines = String(text||'').replace(/\r/g,'').split('\n');
              const first = String(lines[0]||'').trim();
              const body = lines.slice(1).join('\n').trim();
              Store.addReleaseNote({
                version: resolveDefaultVersion(), date: Date.now(), title: first || 'Imported note', body: body || String(text||''),
                author: u ? (u.name||u.username||u.id) : '', tags: ['import']
              });
            }
            if(importEl) importEl.value = '';
            render();
          }catch(err){ console.error(err); alert('Import failed. Please verify the file format.'); }
        };
      }

      if(exportBtn && canManage){
        exportBtn.onclick = ()=>{
          try{
            const data = Store.getReleaseNotes ? Store.getReleaseNotes() : [];
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const ts = new Date().toISOString().slice(0,10);
            a.href = url;
            a.download = `mums_release_notes_${ts}.json`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(()=>{ try{ URL.revokeObjectURL(url); }catch(_){ } }, 1500);
          }catch(err){ console.error(err); alert('Export failed.'); }
        };
      }

      if(clearBtn && canManage){
        clearBtn.onclick = async ()=>{
          const ok1 = await UI.confirm({ title:'Delete All Release Notes', message:'This will delete ALL release notes in this browser. A backup is retained, but you should export first. Continue?', okText:'Continue', cancelText:'Cancel', danger:true });
          if(!ok1) return;
          const phrase = prompt('Type DELETE ALL to confirm:');
          if(String(phrase||'').trim().toUpperCase() !== 'DELETE ALL') return;
          try{ Store.clearReleaseNotes(); }catch(_){ }
          render();
        };
      }

      if(listEl && canDelete){
        listEl.onclick = async (e)=>{
          const btn = e && e.target ? e.target.closest('[data-del]') : null;
          if(!btn) return;
          const id = String(btn.dataset.del||'').trim();
          if(!id) return;
          const ok = await UI.confirm({ title:'Delete Release Note', message:'Delete this release note?', okText:'Delete', danger:true });
          if(!ok) return;
          try{ Store.deleteReleaseNote(id); }catch(_){ }
          render();
        };
      }

      (modal.querySelectorAll('[data-close="releaseNotesModal"]')||[]).forEach(b=>b.onclick=()=>UI.closeModal('releaseNotesModal'));

      render();
      return render;
    },

    startScheduleNotifListener(user){
      if(!user || !window.Store) return;

      if(!document.getElementById('schedNotifModal')){
        const m = document.createElement('div');
        m.className = 'modal'; 
        m.id = 'schedNotifModal';
        m.style.zIndex = '99999';
        m.style.background = 'rgba(2,6,23,0.85)';
        m.style.backdropFilter = 'blur(8px)';
        m.innerHTML = `
              <div class="task-modal-glass notification-popout" style="width:min(900px, 100vw); background:linear-gradient(145deg, rgba(15,23,42,0.95), rgba(2,6,23,0.98)); border:1px solid rgba(56,189,248,0.3); border-radius:16px; box-shadow:0 25px 50px -12px rgba(0,0,0,0.7); display:flex; flex-direction:column; max-height:90vh; overflow:hidden;">
                <div class="head modal-header-glass" style="padding:20px 24px; border-bottom:1px solid rgba(255,255,255,0.06); display:flex; justify-content:space-between; align-items:center; background:rgba(15,23,42,0.6);">
                  <div>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <span style="background:#0ea5e9; color:#fff; width:28px; height:28px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:14px;">🔔</span>
                        <div class="announce-title" id="schedNotifTitle" style="font-size:18px; font-weight:800; color:#f8fafc; letter-spacing:-0.5px;">Schedule Notifications</div>
                    <div id="schedNotifLockBadge" style="display:none; background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.4); color:#fca5a5; font-size:10px; font-weight:800; padding:2px 8px; border-radius:999px; letter-spacing:0.5px; margin-top:3px;">🔒 ACTION REQUIRED — MUST ACKNOWLEDGE BEFORE CONTINUING</div>
                    </div>
                    <div class="small" id="schedNotifMeta" style="color:#94a3b8; margin-top:4px; font-size:13px;">—</div>
                  </div>
                  <div style="display:flex; align-items:center; gap:12px;">
                      <div class="notif-member" id="schedNotifMember" style="background:rgba(255,255,255,0.05); padding:6px 12px; border-radius:999px; font-size:12px; font-weight:700; color:#cbd5e1;">—</div>
                      <div class="notif-count" id="schedNotifCount" style="background:#ef4444; color:#fff; padding:4px 10px; border-radius:999px; font-size:12px; font-weight:900;"></div>
                      <button id="schedNotifClose" class="btn-glass btn-glass-ghost" onclick="if(!window._schedNotifLocked){window.UI.closeModal('schedNotifModal');}" style="padding:6px 12px; border:1px solid rgba(255,255,255,0.1); color:#cbd5e1; background:transparent; border-radius:8px; cursor:pointer;">✕</button>
                  </div>
                </div>
                <div class="body modal-body-scroll" id="schedNotifBody" style="padding:24px; overflow-y:auto; overflow-x:hidden; flex:1; display:flex; flex-direction:column; gap:16px;"></div>
              </div>
        `;
        document.body.appendChild(m);
      }

      const channel = ('BroadcastChannel' in window) ? new BroadcastChannel('ums_schedule_updates') : null;

      const TASK_PALETTE = {
        'mailbox manager': '#4aa3ff',
        'back office': '#ffa21a',
        'call available': '#2ecc71',
        'lunch': '#22d3ee',
        'block': '#ff4d4f',
      };
      const getTeamTasks = ()=>{
        try{
          if(window.Store && Store.getTeamTasks && user.teamId != null) return Store.getTeamTasks(user.teamId) || [];
        }catch(_){ }
        return [];
      };
      const taskColorByLabel = (label, taskId)=>{
        const tasks = getTeamTasks();
        const id = String(taskId||'').trim();
        const lbl = String(label||'').trim();
        const hit = tasks.find(t=>{
          if(!t) return false;
          const tid = String(t.id||t.taskId||'').trim();
          const tlabel = String(t.label||t.name||'').trim();
          return (id && tid && tid === id) || (lbl && tlabel && tlabel.toLowerCase() === lbl.toLowerCase());
        });
        if(hit && hit.color) return hit.color;
        const s = String(label||'').trim().toLowerCase();
        if(TASK_PALETTE[s]) return TASK_PALETTE[s];
        if(s.includes('mailbox')) return TASK_PALETTE['mailbox manager'];
        if(s.includes('back')) return TASK_PALETTE['back office'];
        if(s.includes('call')) return TASK_PALETTE['call available'];
        if(s.includes('lunch')) return TASK_PALETTE['lunch'];
        if(s.includes('block')) return TASK_PALETTE['block'];
        return '';
      };

      const hexToRgb = (hex)=>{
        const m = String(hex||'').trim().match(/^#?([0-9a-f]{6})$/i);
        if(!m) return null;
        const n = parseInt(m[1],16);
        return { r:(n>>16)&255, g:(n>>8)&255, b:n&255 };
      };
      const esc = UI.esc || ((x)=>String(x||'').replace(/[&<>"']/g,(c)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])));

      const renderTaskSummary = (summary)=>{
        if(!summary || !summary.items) return '';
        const dateLabel = summary.dateLabel || summary.iso || '';
        const rows = (summary.items||[]).map(item=>{
          const label = item.label || item.role || '';
          const c = taskColorByLabel(label, item.role);
          return `
            <div class="notif-task-row">
              <span class="notif-task-bullet" style="--task-color:${esc(c)}"></span>
              <span class="notif-task-time">${esc(item.start||'')} to ${esc(item.end||'')}</span>
              <span class="notif-task-eq">=</span>
              <span class="notif-task-label">${esc(label)}</span>
            </div>
          `;
        }).join('');
        const empty = !rows ? '<div class="small muted">No assignments for this date.</div>' : rows;
        return `
          <div class="notif-summary">
            <div class="notif-date">Date: ${esc(dateLabel || '—')}</div>
            ${empty}
          </div>
        `;
      };

      const renderNotifBody = (msg, summary)=>{
        const text = String(msg||'').trim();
        const m = text.match(/^Schedule Updated:\s*(.+?)\s+(added|removed|updated)\s+on\s+(.+?)\.?\s*$/i);
        if(!m){
          const fallback = `<div class="notif-intro">${esc(text || 'Your schedule has been updated.')}</div>`;
          return `${fallback}${renderTaskSummary(summary)}`;
        }
        const label = m[1];
        const action = m[2];
        const date = m[3];
        const c = taskColorByLabel(label);
        const rgb = hexToRgb(c);
        const bg = rgb ? `rgba(${rgb.r},${rgb.g},${rgb.b},0.14)` : 'rgba(255,255,255,.06)';
        const border = rgb ? `rgba(${rgb.r},${rgb.g},${rgb.b},0.35)` : 'rgba(255,255,255,.14)';
        const taskText = '#081018';
        const headline = `
          <div class="notif-intro">
            <span class="task-label" style="--task-color:${esc(c)};--task-bg:${esc(bg)};--task-border:${esc(border)};--task-text:${esc(taskText)}">
              <span class="task-color" style="background:${esc(c)}"></span>
              ${esc(label)}
            </span>
            <span>${esc(action)} on ${esc(date)}.</span>
          </div>
        `;
        return `${headline}${renderTaskSummary(summary)}`;
      };
      
      const formatAssignTimer = (ts)=>{
        const assignedAt = Number(ts)||0;
        if(!assignedAt) return '00:00:00';
        const sec = Math.floor(Math.max(0, Date.now() - assignedAt) / 1000);
        const h = String(Math.floor(sec / 3600)).padStart(2, '0');
        const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
        const s = String(sec % 60).padStart(2, '0');
        return `${h}:${m}:${s}`;
      };
      const updateTimers = ()=>{
        document.querySelectorAll('[data-assign-timer]').forEach((el)=>{
          const start = parseInt(el.getAttribute('data-assign-timer'));
          if(start) el.textContent = formatAssignTimer(start);
        });
      };
      const formatAssignTimestamp = (ts)=>{
        const ms = Number(ts) || 0;
        if(!ms) return 'N/A';
        try{
          const d = new Date(ms);
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          const dd = String(d.getDate()).padStart(2, '0');
          const yyyy = String(d.getFullYear());
          const hour24 = d.getHours();
          const mins = String(d.getMinutes()).padStart(2, '0');
          const hour12 = String(hour24 % 12 || 12).padStart(2, '0');
          const meridiem = hour24 >= 12 ? 'PM' : 'AM';
          return `${mm}/${dd}/${yyyy} ${hour12}:${mins} ${meridiem}`;
        }catch(_){
          return 'N/A';
        }
      };
      const truncate = (v, max=50)=>{
        const s = String(v || '').trim();
        if(!s) return '';
        if(s.length <= max) return s;
        return `${s.slice(0, max-1)}…`;
      };
      const renderAssignedBy = (n)=>{
        const name = String((n && n.fromName) || 'Mailbox Manager').trim() || 'Mailbox Manager';
        const avatar = String((n && (n.fromAvatar || n.fromAvatarUrl || n.avatarUrl)) || '').trim();
        if(avatar){
          return `
            <div class="mbx-assign-by-wrap">
              <span class="mini-avatar"><img src="${esc(avatar)}" alt="${esc(name)} avatar" loading="lazy"/></span>
              <span class="mbx-assign-by-name">${esc(name)}</span>
            </div>
          `;
        }
        return `<span class="mbx-assign-by-name">${esc(name)}</span>`;
      };
      const mailboxAssignmentIdFromNotif = (n)=>{
        try{
          const explicit = String((n && n.assignmentId) || '').trim();
          if(explicit) return explicit;
          const id = String((n && n.id) || '').trim();
          if(id.startsWith('mbx_assign_')) return id.slice('mbx_assign_'.length);
        }catch(_){ }
        return '';
      };
      const confirmMailboxAssignmentFromNotif = async (n)=>{
        try{
          if(!n || String(n.type||'') !== 'MAILBOX_ASSIGN') return { ok:true, skipped:true };
          let shiftKey = String((n && n.shiftKey) || '').trim();
          const assignmentId = mailboxAssignmentIdFromNotif(n);
          // Fallback: resolve shiftKey from Store when notification predates shiftKey field
          if(!shiftKey && assignmentId && window.Store && Store.getMailboxTables) {
            try {
              const tables = Store.getMailboxTables() || {};
              outer: for (const [key, table] of Object.entries(tables)) {
                const assigns = (table && Array.isArray(table.assignments)) ? table.assignments : [];
                for (const a of assigns) {
                  if (a && String(a.id||'') === assignmentId) { shiftKey = key; break outer; }
                }
              }
            } catch(_){}
          }
          if(!shiftKey || !assignmentId) return { ok:false, message:'Missing mailbox assignment reference.' };

          const jwt = (window.CloudAuth && CloudAuth.accessToken) ? CloudAuth.accessToken() : '';
          if(!jwt) return { ok:false, message:'Session expired. Please log in again.' };

          const res = await fetch('/api/mailbox/confirm', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${jwt}`
            },
            body: JSON.stringify({ shiftKey, assignmentId })
          });
          const data = await res.json().catch(()=>null);

          // FIX: 404 = assignment was deleted by manager. Silently dismiss
          // the notification so the accept button disappears without error.
          if(res.status === 404){
            try{
              const Store = window.Store;
              const me = window.Auth && Auth.getUser ? Auth.getUser() : null;
              if(Store && Store.ackNotif && n && n.id && me && me.id) Store.ackNotif(n.id, me.id);
              if(Store && Store.getNotifs && Store.saveNotifs && assignmentId){
                const _list = Store.getNotifs() || [];
                const _kept = _list.filter(x => {
                  if(!x || !x.id) return false;
                  if(n && String(x.id) === String(n.id)) return false;
                  if(String(x.assignmentId||'') === assignmentId) return false;
                  return true;
                });
                if(_kept.length !== _list.length) Store.saveNotifs(_kept);
              }
            }catch(_){ }
            return { ok:true, deletedByManager:true };
          }

          if(!res.ok || !data || !data.ok){
            const msg = (data && (data.message || data.error)) ? String(data.message || data.error) : `Failed (${res.status})`;
            return { ok:false, message: msg };
          }
          try{
            if(data.table && window.Store && Store.saveMailboxTable){
              Store.saveMailboxTable(shiftKey, data.table, { fromRealtime:true });
            }
          }catch(_){ }
          return { ok:true };
        }catch(e){
          return { ok:false, message: String(e && (e.message || e) || 'Confirm failed') };
        }
      };
      
      const renderMailboxAssignTable = (list)=>{
        const rows = (Array.isArray(list) ? list : []).map((n, index)=>{
          const assignedAt = Number((n && (n.assignedAt || n.ts)) || 0);
          const ts = formatAssignTimestamp(assignedAt);
          const caseNo = String((n && (n.caseNo || n.ticketNumber || n.id)) || '').trim() || 'N/A';
          const desc = String((n && n.desc) || '').trim();
          const descDisplay = truncate(desc, 50) || 'N/A';
          const timer = formatAssignTimer(assignedAt);
          return `
            <tr class="mbx-assign-row-item" data-ack-row="${esc(n.id)}" style="transition:background 0.2s;">
              <td style="padding:12px; border-bottom:1px solid rgba(255,255,255,0.02); color:#64748b; font-weight:700;">${index + 1}</td>
              <td class="mbx-assign-ts" style="padding:12px; border-bottom:1px solid rgba(255,255,255,0.02); color:#cbd5e1; font-size:12px;">${esc(ts)}</td>
              <td style="padding:12px; border-bottom:1px solid rgba(255,255,255,0.02);"><strong class="mbx-assign-case-cell" style="color:#38bdf8; font-size:14px; letter-spacing:0.5px;">${esc(caseNo)}</strong></td>
              <td title="${esc(desc || 'N/A')}" style="padding:12px; border-bottom:1px solid rgba(255,255,255,0.02); color:#e2e8f0; font-size:13px; max-width:200px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(descDisplay)}</td>
              <td style="padding:12px; border-bottom:1px solid rgba(255,255,255,0.02); font-size:13px; font-weight:600; color:#f8fafc;">${renderAssignedBy(n)}</td>
              <td class="mbx-assign-live" data-assign-timer="${esc(assignedAt)}" style="padding:12px; border-bottom:1px solid rgba(255,255,255,0.02); color:#fcd34d; font-family:monospace; font-weight:800;">${esc(timer)}</td>
              <td style="padding:12px; border-bottom:1px solid rgba(255,255,255,0.02); text-align:right;">
                <button class="btn-glass dashx-ack mbx-accept-btn" data-ack="${esc(n.id)}" type="button" aria-label="Accept case assignment" style="background:linear-gradient(145deg, #10b981, #059669); color:#fff; border:1px solid rgba(52,211,153,0.4); padding:8px 16px; border-radius:8px; font-weight:800; box-shadow:0 4px 12px rgba(16,185,129,0.3); cursor:pointer;">
                  <span class="dashx-spin" aria-hidden="true" style="display:none;">⏳ </span>
                  <span class="dashx-acklbl">ACCEPT ✓</span>
                </button>
              </td>
            </tr>
          `;
        }).join('');
        
        if(!rows){
          return '<div class="muted">No pending cases.</div>';
        }
        
        return `
          <style>
            .mbx-assign-table tbody tr:hover { background: rgba(56,189,248,0.05); }
            .mbx-accept-btn { white-space: nowrap; flex-shrink: 0; }
            .mbx-accept-btn:hover { background: linear-gradient(145deg, #34d399, #10b981) !important; transform: translateY(-1px); box-shadow: 0 6px 16px rgba(16,185,129,0.4) !important; }
          </style>
          <div class="mbx-assign-table-wrap glass-table-container" role="region" aria-label="Pending case assignments" style="border:1px solid rgba(255,255,255,0.06); border-radius:10px; overflow-x:auto; background:rgba(2,6,23,0.5);">
            <table class="mbx-assign-table" role="table" style="width:100%; min-width:800px; border-collapse:collapse;">
              <thead>
                <tr>
                  <th style="background:rgba(15,23,42,0.95); padding:14px 12px; font-size:11px; font-weight:800; color:#94a3b8; text-transform:uppercase; letter-spacing:0.5px; border-bottom:1px solid rgba(255,255,255,0.08); position:sticky; top:0; z-index:5;">No.</th>
                  <th style="background:rgba(15,23,42,0.95); padding:14px 12px; font-size:11px; font-weight:800; color:#94a3b8; text-transform:uppercase; letter-spacing:0.5px; border-bottom:1px solid rgba(255,255,255,0.08); position:sticky; top:0; z-index:5;">Timestamp</th>
                  <th style="background:rgba(15,23,42,0.95); padding:14px 12px; font-size:11px; font-weight:800; color:#94a3b8; text-transform:uppercase; letter-spacing:0.5px; border-bottom:1px solid rgba(255,255,255,0.08); position:sticky; top:0; z-index:5;">Case #</th>
                  <th style="background:rgba(15,23,42,0.95); padding:14px 12px; font-size:11px; font-weight:800; color:#94a3b8; text-transform:uppercase; letter-spacing:0.5px; border-bottom:1px solid rgba(255,255,255,0.08); position:sticky; top:0; z-index:5;">Description</th>
                  <th style="background:rgba(15,23,42,0.95); padding:14px 12px; font-size:11px; font-weight:800; color:#94a3b8; text-transform:uppercase; letter-spacing:0.5px; border-bottom:1px solid rgba(255,255,255,0.08); position:sticky; top:0; z-index:5;">Assigned By</th>
                  <th style="background:rgba(15,23,42,0.95); padding:14px 12px; font-size:11px; font-weight:800; color:#94a3b8; text-transform:uppercase; letter-spacing:0.5px; border-bottom:1px solid rgba(255,255,255,0.08); position:sticky; top:0; z-index:5;">Elapsed</th>
                  <th style="background:rgba(15,23,42,0.95); padding:14px 12px; font-size:11px; font-weight:800; color:#94a3b8; text-transform:uppercase; letter-spacing:0.5px; border-bottom:1px solid rgba(255,255,255,0.08); text-align:right; position:sticky; top:0; z-index:5;">Action</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        `;
      };
      
      const shownKeys = new Set();
      let lastBeepedId = null;
      const pendingKeyFor = (n)=>{
        if(!n) return '';
        if(String(n.type||'') === 'MAILBOX_ASSIGN') return `id:${String(n.id||'')}`;
        if(n.snapshotDigest) return `digest:${String(n.snapshotDigest)}`;
        return `id:${String(n.id||'')}`;
      };
      let lastPending = [];
      const _justAccepted = new Set(); // IDs accepted but not yet confirmed by server

      const ackNotif = (n)=>{
        if(!n || !n.id) return;
        _justAccepted.add(String(n.id)); // mark as accepted locally
        Store.ackNotif(n.id, user.id);
        try{ channel && channel.postMessage({ type:'ack', notifId:n.id, userId:user.id }); }catch(e){}
        // Clean up the just-accepted set after 5s (server should confirm by then)
        setTimeout(()=>{ _justAccepted.delete(String(n.id)); }, 5000);
      };
      const renderPendingNotifs = (list)=>{
        if(!list.length){
          return '<div class="muted">No pending cases.</div>';
        }
        const allMailbox = list.every(n=>String(n && n.type || '') === 'MAILBOX_ASSIGN');
        if(allMailbox) return renderMailboxAssignTable(list);
        return list.map(n=>{
          try{
            if(String(n.type||'') === 'MAILBOX_ASSIGN'){
              return `
                <div class="notif-item mailbox-assign">
                  <div class="notif-item-head">
                    <button class="btn dashx-ack" data-ack="${esc(n.id)}" type="button" aria-label="Acknowledge case assignment notification">
                      <span class="dashx-spin" aria-hidden="true"></span>
                      <span class="dashx-acklbl">Acknowledge</span>
                    </button>
                  </div>
                  <div class="notif-item-body">${renderMailboxAssign(n)}</div>
                </div>
              `;
            }
            const perUser = (n.userMessages && n.userMessages[user.id]) ? n.userMessages[user.id] : '';
            const bodyMsg = perUser || n.body || 'Your schedule has been updated.';
            const summary = (n.userSummaries && n.userSummaries[user.id]) ? n.userSummaries[user.id] : null;
            const isTaskDist = String(n.type||'') === 'TASK_DISTRIBUTION';
            const isOvertimeAlert = String(n.type||'') === 'OVERTIME_ALERT';
            const distId = String(n.distribution_id || '');
            const distTitle = String(n.distribution_title || n.title || 'New Task Distribution');
            const taskDistBody = isTaskDist
              ? `
                <div class="notif-intro">${esc(distTitle)}</div>
                <div class="small">${esc(summary || bodyMsg || 'N/A')}</div>
              `
              : '';
            const overtimeBody = isOvertimeAlert
              ? `
                <div class="notif-intro">${esc(bodyMsg || 'Overtime confirmation recorded.')}</div>
                <div class="small" style="white-space:pre-line">${esc(String(n.detailText || 'N/A'))}</div>
              `
              : '';
            const meta = isTaskDist
              ? `From: ${n.fromName||'Team Lead'} • ${new Date(n.ts||Date.now()).toLocaleString()} • Tasks`
              : isOvertimeAlert
                ? `From: Attendance System • ${new Date(n.ts||Date.now()).toLocaleString()} • Overtime`
              : (String(n.type||'')==='MAILBOX_ASSIGN')
                ? `From: ${n.fromName||'Mailbox Manager'} • ${new Date(n.ts||Date.now()).toLocaleString()} • Mailbox`
                : `From: ${n.fromName||'Team Lead'} • Week of ${n.weekStartISO||'—'}`;
            return `
              <div class="notif-item">
                <div class="notif-item-head">
                  <div>
                    <div class="notif-item-title">${esc(isTaskDist ? distTitle : (n.title || (isOvertimeAlert ? 'Overtime Alert – Team Member' : 'Schedule Updated')))}</div>
                    <div class="small muted">${esc(meta)}</div>
                  </div>
                  <div class="row" style="gap:8px">
                    ${isTaskDist ? `<a class="btn" href="#my_task?dist=${encodeURIComponent(distId)}" data-view-tasks="${esc(n.id)}" type="button" style="font-weight:900">View All Details</a>` : ''}
                    <button class="btn dashx-ack" data-ack="${esc(n.id)}" type="button" aria-label="Acknowledge schedule notification">
                      <span class="dashx-spin" aria-hidden="true"></span>
                      <span class="dashx-acklbl">Acknowledge</span>
                    </button>
                  </div>
                </div>
                <div class="notif-item-body">${isTaskDist ? taskDistBody : (isOvertimeAlert ? overtimeBody : renderNotifBody(bodyMsg, summary))}</div>
              </div>
            `;
          }catch(err){
            try{ console.error('renderPendingNotifs: render failed', err, n); }catch(_){ }
            return `
              <div class="notif-item">
                <div class="notif-item-head">
                  <div>
                    <div class="notif-item-title">${esc((n && (n.title||n.type)) ? String(n.title||n.type) : 'Notification')}</div>
                    <div class="small muted">${esc((n && n.ts) ? new Date(n.ts).toLocaleString() : '')}</div>
                  </div>
                </div>
                <div class="notif-item-body"><div class="muted">N/A</div></div>
              </div>
            `;
          }
        }).join('');
      };
      const ping = ()=>{
        const list = Store.getNotifs();
        const pendingRaw = list.filter(x=>x && Array.isArray(x.recipients) && x.recipients.includes(user.id) && !(x.acks && x.acks[user.id]));
        const pendingSorted = pendingRaw.sort((a,b)=> (b.ts||0) - (a.ts||0));
        const deduped = [];
        const seen = new Set();
        for(const n of pendingSorted){
          const key = pendingKeyFor(n);
          if(!key || seen.has(key)) continue;
          // Skip items we just accepted locally — wait for server confirmation
          if(_justAccepted.has(String(n.id||''))) continue;
          seen.add(key);
          deduped.push(n);
        }
        lastPending = deduped;

        const modal = document.getElementById('schedNotifModal');
        const isOpen = !!(modal && modal.classList.contains('open'));
        if(!deduped.length){
          // BUG FIX 1: Always close when no pending items remain (even if not open tracking)
          UI.closeModal('schedNotifModal');
          window._schedNotifLocked = false;
          return;
        }

        const latest = deduped[0];
        if(latest && latest.id && latest.id !== lastBeepedId){
          lastBeepedId = latest.id;
          UI.playNotifSound(user.id);
        }

        const allMailbox = deduped.length && deduped.every(n=>String(n.type||'')==='MAILBOX_ASSIGN');
        const compactMailboxMode = false;
        const mailboxTableMode = !!allMailbox;
        const headerLabel = allMailbox
          ? `Case Assigned Notification${deduped.length===1?'':'s'}`
          : 'Schedule Notifications';
        const metaLabel = allMailbox
          ? `You have ${deduped.length} pending case assignment${deduped.length===1?'':'s'}.`
          : `You have ${deduped.length} pending schedule update${deduped.length===1?'':'s'}.`;
        UI.el('#schedNotifMember').textContent = user.name || user.username || 'Member';
        UI.el('#schedNotifTitle').textContent = headerLabel;
        UI.el('#schedNotifMeta').textContent = metaLabel;
        const countEl = UI.el('#schedNotifCount');
        if(countEl) countEl.textContent = String(deduped.length);
        const visibleList = deduped;
        UI.el('#schedNotifBody').innerHTML = renderPendingNotifs(visibleList);

        const panelEl = modal ? modal.querySelector('.notification-popout') : null;
        if(panelEl){
          panelEl.classList.toggle('mailbox-compact-mode', compactMailboxMode);
          panelEl.classList.toggle('mailbox-table-mode', mailboxTableMode);
          if(compactMailboxMode || mailboxTableMode) panelEl.scrollTop = 0;
        }

        if(modal && !modal._ackBound){
          modal._ackBound = true;
          modal.addEventListener('click', async (e)=>{
            const viewBtn = e && e.target ? e.target.closest('[data-view-tasks]') : null;
            if(viewBtn){
              try{ e.preventDefault(); }catch(_){ }
              const id = String(viewBtn.getAttribute('data-view-tasks')||'');
              const n = lastPending.find(x=>String(x.id||'')===id);
              const distId = n ? String(n.distribution_id || '') : '';

              if(!distId){
                try{ UI.toast('Missing distribution reference in this notification.', 'warn'); }catch(_){ }
                return;
              }

              const path = String(window.location.pathname || '').replace(/\/+$/,'');
              const isMyTask = path === '/my_task' || path.endsWith('/my_task');
              if(isMyTask){
                try{
                  window.dispatchEvent(new CustomEvent('mums:open_task_distribution', { detail: { distribution_id: distId } }));
                  UI.closeModal('schedNotifModal');
                }catch(_){ }
              }else{
                try{ window.location.href = `/my_task?dist=${encodeURIComponent(distId)}`; }catch(_){ window.location.href = '/my_task'; }
              }
              return;
            }

            const btn = e && e.target ? e.target.closest('[data-ack]') : null;
            if(!btn) return;
            const id = String(btn.getAttribute('data-ack')||'');
            if(!id) return;
            const row = btn.closest('[data-ack-row]');
            // Prevent double-fire
            if(btn.dataset.busy==='1') return;
            btn.dataset.busy='1';

            // ── STEP 1: Capture 'n' FIRST before any filtering ───────────────
            // CRITICAL FIX: n MUST be captured before lastPending.filter()
            // otherwise find() returns undefined and the API call is skipped entirely.
            const n = lastPending.find(x=>String(x.id||'')===id)
                   || Store.getNotifs().find(x=>String(x.id||'')===id);

            // ── STEP 2: NOW optimistically remove from pending (blocks ping re-render) ──
            _justAccepted.add(id);
            lastPending = lastPending.filter(x => String(x.id||'') !== id);

            // Show "Accepting..." state immediately
            try{
              btn.disabled = true;
              const spin = btn.querySelector('.dashx-spin');
              const lbl  = btn.querySelector('.dashx-acklbl');
              if(spin){ spin.textContent = ''; spin.style.display = 'inline-block'; spin.classList.add('on'); }
              if(lbl)  lbl.textContent = 'ACCEPTING…';
              btn.style.opacity = '0.8';
            }catch(_){}

            try{
              const confirmResult = await confirmMailboxAssignmentFromNotif(n);

              if(confirmResult && !confirmResult.ok){
                // Failed — remove from justAccepted so it shows again
                _justAccepted.delete(id);
                // Re-add to lastPending
                if(n) lastPending = [n, ...lastPending];
                try{
                  btn.dataset.busy='0';
                  btn.disabled = false;
                  btn.style.opacity = '';
                  const spin = btn.querySelector('.dashx-spin');
                  const lbl  = btn.querySelector('.dashx-acklbl');
                  if(spin){ spin.style.display='none'; spin.classList.remove('on'); }
                  if(lbl) lbl.textContent = 'ACCEPT ✓';
                }catch(_){}
                try{ UI.toast(confirmResult.message || 'Unable to accept case assignment.', 'warn'); }catch(_){}
                return;
              }

              // ── SUCCESS ────────────────────────────────────────────────────
              ackNotif(n); // persist ack to store/server

              // Show green check state on the button
              try{
                const spin = btn.querySelector('.dashx-spin');
                const lbl  = btn.querySelector('.dashx-acklbl');
                if(spin){ spin.style.display='none'; spin.classList.remove('on'); }
                if(lbl) lbl.textContent = '✓ ACCEPTED';
                btn.style.background   = 'linear-gradient(145deg,#059669,#047857)';
                btn.style.boxShadow    = '0 4px 16px rgba(5,150,105,0.45)';
                btn.style.color        = '#fff';
                btn.style.border       = '1px solid rgba(52,211,153,0.55)';
                btn.style.opacity      = '1';
                btn.disabled = true;
                if(row){
                  row.style.background   = 'rgba(5,150,105,0.09)';
                  row.style.borderLeft   = '3px solid #34d399';
                  row.style.transition   = 'background 0.3s, border 0.3s';
                }
              }catch(_){}

              // Close modal after a short pause so user sees the green state
              setTimeout(()=>{
                try{
                  // Re-check: if no more pending items → close modal
                  const stillPending = Store.getNotifs().filter(x =>
                    x && Array.isArray(x.recipients) &&
                    x.recipients.includes(user.id) &&
                    !(x.acks && x.acks[user.id]) &&
                    !_justAccepted.has(String(x.id||''))
                  );
                  if(!stillPending.length){
                    UI.closeModal('schedNotifModal');
                    window._schedNotifLocked = false;
                  } else {
                    ping();
                  }
                }catch(_){ ping(); }
              }, 1000);

            }catch(err){
              // Network or parse error — remove from justAccepted so it shows again
              _justAccepted.delete(id);
              if(n) lastPending = [n, ...lastPending];
              try{
                btn.dataset.busy='0';
                btn.disabled = false;
                btn.style.opacity = '';
                const spin = btn.querySelector('.dashx-spin');
                const lbl  = btn.querySelector('.dashx-acklbl');
                if(spin){ spin.style.display='none'; spin.classList.remove('on'); }
                if(lbl) lbl.textContent = 'ACCEPT ✓';
              }catch(_){}
              ping();
            }
          });
        }

        // ── Lock / Unlock modal for unacknowledged case assignments ────────────
        const hasPendingMailbox = deduped.some(n => String(n.type||'') === 'MAILBOX_ASSIGN');
        window._schedNotifLocked = hasPendingMailbox;

        // Update close button visibility
        const closeBtn = document.getElementById('schedNotifClose');
        if (closeBtn) {
          closeBtn.style.display = hasPendingMailbox ? 'none' : '';
          closeBtn.style.pointerEvents = hasPendingMailbox ? 'none' : '';
        }
        // Show/hide the lock warning badge
        const lockBadge = document.getElementById('schedNotifLockBadge');
        if (lockBadge) lockBadge.style.display = hasPendingMailbox ? 'block' : 'none';
        // Highlight modal border red when locked
        const popout = modal ? modal.querySelector('.notification-popout') : null;
        if (popout) {
          popout.style.borderColor = hasPendingMailbox ? 'rgba(239,68,68,0.5)' : 'rgba(56,189,248,0.3)';
          popout.style.boxShadow = hasPendingMailbox
            ? '0 25px 50px -12px rgba(0,0,0,0.7), 0 0 0 1px rgba(239,68,68,0.3)'
            : '0 25px 50px -12px rgba(0,0,0,0.7)';
        }

        // Prevent backdrop click from closing when locked
        if (modal && !modal._lockHandlerBound) {
          modal._lockHandlerBound = true;
          modal.addEventListener('click', (e) => {
            if (e.target === modal && window._schedNotifLocked) {
              e.preventDefault();
              e.stopPropagation();
            }
          }, true);
        }

        // Force modal open when MAILBOX_ASSIGN pending — always, even after refresh/close
        if (hasPendingMailbox) {
          if (!isOpen) UI.openModal('schedNotifModal');
        } else if (!isOpen) {
          const key = pendingKeyFor(latest);
          if (!shownKeys.has(key)) {
            shownKeys.add(key);
            UI.openModal('schedNotifModal');
          }
        }
      };

      let timer = setInterval(()=>{
        ping();
        updateTimers();
      }, 1000);
      const onStorage = (ev)=>{
        if(!ev || !ev.key) return;
        if(ev.key=== 'ums_schedule_notifs' || ev.key=== 'mums_schedule_notifs') ping();
      };
      window.addEventListener('storage', onStorage);
      const onStore = (ev)=>{
        try{
          const key = ev && ev.detail ? String(ev.detail.key||'') : '';
          if(key === 'ums_schedule_notifs' || key === 'mums_schedule_notifs') ping();
        }catch(_){ }
      };
      window.addEventListener('mums:store', onStore);

      if(channel){ channel.onmessage = ()=>ping(); }
      ping();

      return ()=>{
        try{ clearInterval(timer); }catch(e){}
        try{ window.removeEventListener('storage', onStorage); }catch(e){}
        try{ window.removeEventListener('mums:store', onStore); }catch(e){}
        try{ channel && channel.close(); }catch(e){}
      };
    },

    initAppCursor(){
      try{
        if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return;
        const mode = (localStorage.getItem('mums_cursor_mode')||'custom');
        if(mode !== 'custom') return;
        if(document.getElementById('appCursor')) return;

        const cur = document.createElement('div');
        cur.id = 'appCursor';
        cur.className = 'app-cursor';
        cur.innerHTML = '<div class="app-cursor-arrow"></div><div class="app-cursor-ibar"></div>';
        document.body.appendChild(cur);
        document.body.classList.add('app-cursor-on');

        let x = window.innerWidth/2, y = window.innerHeight/2;

        const isTextTarget = (el)=>{
          if(!el) return false;
          const tag = (el.tagName||'').toLowerCase();
          if(tag==='input' || tag==='textarea' || tag==='select') return true;
          if(el.isContentEditable) return true;
          return false;
        };

        const update = (cx, cy)=>{
          x = cx; y = cy;
          cur.style.transform = `translate(${x}px, ${y}px)`;
          const el = document.elementFromPoint(cx, cy);
          cur.classList.toggle('is-text', isTextTarget(el));
        };

        const onMove = (ev)=>{ update(ev.clientX, ev.clientY); };
        const onDown = ()=>cur.classList.add('is-down');
        const onUp = ()=>cur.classList.remove('is-down');

        window.addEventListener('mousemove', onMove, { passive:true });
        window.addEventListener('mousedown', onDown, { passive:true });
        window.addEventListener('mouseup', onUp, { passive:true });

        update(x, y);

        cur._cleanup = ()=>{
          try{ window.removeEventListener('mousemove', onMove); }catch(_){}
          try{ window.removeEventListener('mousedown', onDown); }catch(_){}
          try{ window.removeEventListener('mouseup', onUp); }catch(_){}
        };
      }catch(e){}
    },

    setCursorMode(mode){
      try{
        const m = (mode==='system') ? 'system' : 'custom';
        localStorage.setItem('mums_cursor_mode', m);
        const cur = document.getElementById('appCursor');
        if(m==='system'){
          if(cur && cur._cleanup) cur._cleanup();
          if(cur) cur.remove();
          document.body.classList.remove('app-cursor-on');
          return;
        }
        if(!cur) UI.initAppCursor();
        document.body.classList.add('app-cursor-on');
      }catch(e){ console.error('setCursorMode error', e); }
    }
  };

  UI.bindDataClose = function(){
    if(UI.__dataCloseBound) return;
    UI.__dataCloseBound = true;
    document.addEventListener('click', (e)=>{
      const btn = e.target && e.target.closest ? e.target.closest('[data-close]') : null;
      if(!btn) return;
      const id = btn.getAttribute('data-close');
      if(!id) return;
      try{ UI.closeModal(id); }catch(_){}
      e.preventDefault();
      e.stopPropagation();
    }, true);
  };

  UI.renderDashboard = function(root){
    try{
      const Config = window.Config || {};
      const Store = window.Store || {};
      const Auth = window.Auth || {};
      const me = (Auth.getUser ? (Auth.getUser()||{}) : {});

      try{ if(root && root._dashCleanup) root._dashCleanup(); }catch(_){ }

      const state = root._dashState || { filter: 'unread', q: '', sync: { mode:'offline', detail:'', lastOkAt:0 } };
      state.sync = state.sync || { mode:'offline', detail:'', lastOkAt:0 };
      root._dashState = state;

      const tz = (Config && Config.TZ) || 'Asia/Manila';
      const esc = (s)=> (window.UI && UI.esc) ? UI.esc(s) : String(s||'');
      const pad2 = (n)=>String(n).padStart(2,'0');

      const role = String(me.role||'');
      const ROLES = (Config.ROLES || {});
      const SA = ROLES.SUPER_ADMIN || 'SUPER_ADMIN';
      const SU = ROLES.SUPER_USER || 'SUPER_USER';
      const AD = ROLES.ADMIN || 'ADMIN';
      const TL = ROLES.TEAM_LEAD || 'TEAM_LEAD';
      const isAdmin = role===SA || role===SU || role===AD;
      const isLead = role===TL;

      const _parseHM = (hm)=>{
        try{ if(UI && typeof UI.parseHM==='function') return UI.parseHM(hm); }catch(_){ }
        try{
          const s = String(hm||'0:0').split(':');
          const h = Math.max(0, Math.min(23, parseInt(s[0]||'0',10)||0));
          const m = Math.max(0, Math.min(59, parseInt(s[1]||'0',10)||0));
          return h*60+m;
        }catch(_){ return 0; }
      };

      const inBucket = (nowMin, b)=>{
        const s = _parseHM(b.start);
        const e = _parseHM(b.end);
        const wrap = e <= s;
        if(!wrap) return nowMin >= s && nowMin < e;
        return (nowMin >= s) || (nowMin < e);
      };

      function manilaDateFromTs(ts){
        try{ return new Date(new Date(Number(ts||0)).toLocaleString('en-US', { timeZone: tz })); }catch(_){ return new Date(Number(ts||0)); }
      }
      function isoFromManilaDate(d){
        try{ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }catch(_){ return ''; }
      }

      const nowText = ()=>{
        try{
          return new Date().toLocaleString('en-CA', {
            timeZone: tz, weekday:'short', year:'numeric', month:'short', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false
          });
        }catch(_){ return ''; }
      };

      function buildModel(){
        const parts = (UI.mailboxNowParts ? UI.mailboxNowParts() : (UI.manilaNow ? UI.manilaNow() : null)) || {};
        const duty = (UI.getDutyWindow ? UI.getDutyWindow(parts) : null);
        const dutyCur = duty && duty.current ? duty.current : null;
        const dutyNext = duty && duty.next ? duty.next : null;
        const secLeft = duty && Number.isFinite(Number(duty.secLeft)) ? Number(duty.secLeft) : 0;

        const teamLabel = (Config.teamLabel && me.teamId!=null) ? Config.teamLabel(me.teamId) : (me.teamId||'—');
        const dutyLabel = dutyCur ? (dutyCur.label||dutyCur.id||'—') : '—';
        const nextLabel = dutyNext ? (dutyNext.label||dutyNext.id||'—') : '—';

        const allCases = (Store.getCases ? (Store.getCases()||[]) : []);
        const isOpen = (c)=>{
          const st = String((c && (c.status||c.state)) || '').toLowerCase();
          return !st || (st!=='closed' && st!=='done' && st!=='resolved');
        };
        const openCases = allCases.filter(c=>c && isOpen(c));
        const myOpen = openCases.filter(c=>c && String(c.assigneeId||'')===String(me.id||''));

        const notifsAll = (Store.getNotifs ? (Store.getNotifs()||[]) : []);
        const notifsTeam = me.teamId ? notifsAll.filter(n=>n && n.teamId===me.teamId) : notifsAll;
        const myNotifs = notifsTeam.filter(n=>n && Array.isArray(n.recipients) && me.id && n.recipients.includes(me.id));
        const myUnread = myNotifs.filter(n=>!(n.acks && n.acks[me.id]));

        const shiftKey = dutyCur ? String(dutyCur.id||'') : '';
        const table = (shiftKey && Store.getMailboxTable) ? Store.getMailboxTable(shiftKey) : null;
        const nowMin = (UI.minutesOfDay ? UI.minutesOfDay(parts) : (Number(parts.hh||0)*60 + Number(parts.mm||0)));

        let activeBucketId = '';
        let bucketLabel = '';
        let bucketManager = '';
        let mbx = {
          shiftKey, hasTable: !!table, totalAssigned: 0, totalConfirmed: 0, totalOpen: 0, bucketAssigned: 0, bucketOpen: 0, avgRespMin: 0, byBucket: [], byRole: [], topAssignees: []
        };

        if(table && typeof table==='object'){
          const buckets = Array.isArray(table.buckets) ? table.buckets : [];
          const assigns = Array.isArray(table.assignments) ? table.assignments : [];
          const totalAssigned = assigns.length;

          const bActive = buckets.find(b=>b && inBucket(nowMin, b)) || buckets[0] || null;
          activeBucketId = bActive ? String(bActive.id||'') : '';
          bucketLabel = bActive ? `${String(bActive.start||'')}–${String(bActive.end||'')}` : '';

          try{
            const bm = table.meta && table.meta.bucketManagers ? table.meta.bucketManagers[activeBucketId] : null;
            bucketManager = bm && bm.name ? String(bm.name) : '';
          }catch(_){ bucketManager=''; }

          const confirmed = assigns.filter(a=>a && Number(a.confirmedAt||0) > 0);
          const open = assigns.filter(a=>a && !(Number(a.confirmedAt||0) > 0));
          const inB = (a)=> String(a.bucketId||'') === activeBucketId;

          const confirmedDur = confirmed.map(a=> (Number(a.confirmedAt||0) - Number(a.assignedAt||0))).filter(ms=>Number.isFinite(ms) && ms>0);
          const avgRespMs = confirmedDur.length ? (confirmedDur.reduce((x,y)=>x+y,0) / confirmedDur.length) : 0;

          mbx.totalAssigned = assigns.length;
          mbx.totalConfirmed = confirmed.length;
          mbx.totalOpen = open.length;
          mbx.bucketAssigned = assigns.filter(a=>a && inB(a)).length;
          mbx.bucketOpen = open.filter(a=>a && inB(a)).length;
          mbx.avgRespMin = avgRespMs ? Math.round(avgRespMs/60000) : 0;

          const byB = {};
          for(const a of assigns){
            if(!a) continue;
            const bid = String(a.bucketId||'');
            byB[bid] = byB[bid] || { bucketId: bid, assigned:0, open:0, confirmed:0 };
            byB[bid].assigned++;
            if(Number(a.confirmedAt||0)>0) byB[bid].confirmed++; else byB[bid].open++;
          }
          mbx.byBucket = buckets.map(b=>{
            const bid = String(b && b.id || '');
            const row = byB[bid] || { bucketId: bid, assigned:0, open:0, confirmed:0 };
            return {
              bucketId: bid, label: b ? `${String(b.start||'')}–${String(b.end||'')}` : bid, assigned: row.assigned, open: row.open, confirmed: row.confirmed, isActive: bid === activeBucketId
            };
          });

          const users = (Store.getUsers ? (Store.getUsers()||[]) : []);
          const roleById = {};
          for(const u of users){ if(!u) continue; roleById[String(u.id||'')] = String(u.role||'MEMBER'); }
          const byRole = {};
          for(const a of assigns){
            if(!a) continue;
            const rid = roleById[String(a.assigneeId||'')] || 'MEMBER';
            byRole[rid] = (byRole[rid]||0) + 1;
          }
          mbx.byRole = Object.keys(byRole).sort((a,b)=>byRole[b]-byRole[a]).map(r=>({ role:r, count: byRole[r], pct: totalAssigned ? Math.round((byRole[r]/totalAssigned)*100) : 0 }));

          const byA = {};
          for(const a of assigns){
            if(!a) continue;
            const uid = String(a.assigneeId||'');
            byA[uid] = (byA[uid]||0) + 1;
          }
          const nameById = {};
          for(const u of users){ if(u) nameById[String(u.id||'')] = String(u.name||u.username||''); }
          mbx.topAssignees = Object.keys(byA).sort((a,b)=>byA[b]-byA[a]).slice(0, 6).map(uid=>({ uid, name: nameById[uid] || uid, count: byA[uid], pct: totalAssigned ? Math.round((byA[uid]/totalAssigned)*100) : 0 }));
        }

        const logsAll = (Store.getLogs ? (Store.getLogs()||[]) : []);
        const logs = me.teamId ? logsAll.filter(l=>l && (!l.teamId || String(l.teamId)===String(me.teamId))) : logsAll;

        const nowM = manilaDateFromTs(Date.now());
        const days = [];
        for(let i=6;i>=0;i--){
          const d = new Date(nowM.getTime());
          d.setDate(d.getDate()-i);
          const iso = isoFromManilaDate(d);
          const wd = d.toLocaleDateString('en-US', { weekday:'short', timeZone: tz });
          days.push({ iso, wd, label: `${wd} ${iso.slice(5)}` });
        }
        const dayIndex = {};
        days.forEach((d, idx)=>{ dayIndex[d.iso] = idx; });

        const bins = 6; 
        const mat = Array.from({length: bins}, ()=> Array.from({length:7}, ()=>0));
        const recentCut = Date.now() - (7*24*60*60*1000);

        for(const e of logs){
          if(!e || !e.ts) continue;
          const ts = Number(e.ts)||0;
          if(ts < recentCut) continue;
          const md = manilaDateFromTs(ts);
          const iso = isoFromManilaDate(md);
          const di = dayIndex[iso];
          if(di==null) continue;
          const hr = md.getHours();
          const bi = Math.max(0, Math.min(bins-1, Math.floor(hr/4)));
          mat[bi][di] += 1;
        }

        let maxV = 0;
        for(const row of mat){ for(const v of row){ if(v>maxV) maxV=v; } }

        return { parts, dutyCur, dutyNext, dutyLabel, nextLabel, secLeft, teamLabel, openCases: openCases.length, myOpen: myOpen.length, pendingAcks: myUnread.length, notifs: myNotifs, unreadNotifs: myUnread, mbx, activeBucketId, bucketLabel, bucketManager, heat: { days, mat, maxV }, logs };
      }

      function render(model){
        const syncMode = String(state.sync.mode||'offline');
        const syncLabel = (syncMode==='cloud') ? 'Realtime' : (syncMode==='poll') ? 'Polling' : (syncMode==='connecting') ? 'Connecting' : 'Offline';
        const syncDot = (syncMode==='cloud') ? 'ok' : (syncMode==='poll' || syncMode==='connecting') ? 'warn' : 'bad';

        const dutyCountdown = (UI && UI.formatDuration) ? UI.formatDuration(model.secLeft||0) : String(model.secLeft||0);

        const card = (k,v,s)=>`<div class="ux-card dashx-card"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div>${s?`<div class="s">${esc(s)}</div>`:''}</div>`;

        const heatRows = [];
        heatRows.push(`<div></div>`);
        for(const d of model.heat.days){ heatRows.push(`<div class="h">${esc(d.wd)}</div>`); }
        const labels = ['00','04','08','12','16','20'];
        for(let r=0;r<6;r++){
          heatRows.push(`<div class="h" style="text-align:left;padding-left:4px">${labels[r]}</div>`);
          for(let c=0;c<7;c++){
            const v = model.heat.mat[r][c];
            const maxV = model.heat.maxV || 1;
            const level = v<=0 ? 0 : Math.min(4, Math.ceil((v/maxV)*4));
            const alpha = 0.04 + (level*0.06);
            const dayIso = model.heat.days[c].iso;
            const title = `${dayIso} ${labels[r]}–${labels[r]=== '20' ? '24' : pad2((parseInt(labels[r],10)+4)%24)} • ${v} events`;
            heatRows.push(`<div class="cell" title="${esc(title)}" style="background: rgba(255,255,255,${alpha.toFixed(3)})"></div>`);
          }
        }

        const bucketRows = (model.mbx.hasTable && model.mbx.byBucket.length) ? model.mbx.byBucket.map(b=>{
          const dot = b.isActive ? '<span class="badge ok" style="margin-left:8px">Now</span>' : '';
          return `<div class="small" style="display:flex;justify-content:space-between;gap:10px;margin-top:6px"><div>${esc(b.label)}${dot}</div><div class="muted">${esc(b.open)} open • ${esc(b.assigned)} assigned</div></div>`;
        }).join('') : `<div class="small muted" style="margin-top:8px">Mailbox table not loaded yet for this shift.</div>`;

        const byRole = (model.mbx.byRole && model.mbx.byRole.length) ?
          `<div class="small muted" style="margin-top:10px">Distribution by assignee role</div>
           <div class="dashx-dist" style="margin-top:8px">
             ${model.mbx.byRole.slice(0,6).map(r=>`<div class="dashx-dist-row"><div class="dashx-dist-left">${esc(r.role)}</div><div class="dashx-dist-mid"><div class="dashx-bar" role="img" aria-label="${esc(r.role)} ${esc(r.count)} (${esc(r.pct)}%)"><div class="fill" style="width:${Math.max(0, Math.min(100, Number(r.pct||0)))}%"></div></div></div><div class="dashx-dist-right muted">${esc(r.count)} • ${esc(r.pct)}%</div></div>`).join('')}
           </div>` : '';

        const topAsg = (model.mbx.topAssignees && model.mbx.topAssignees.length) ?
          `<div class="small muted" style="margin-top:12px">Top assignees (distribution)</div>
           <div class="dashx-top" style="margin-top:8px">
             ${model.mbx.topAssignees.map(a=>`<div class="dashx-top-row"><div class="dashx-top-name">${esc(a.name)}</div><div class="dashx-top-meta muted">${esc(a.count)} • ${esc(a.pct)}%</div><div class="dashx-bar" role="img" aria-label="${esc(a.name)} ${esc(a.count)} (${esc(a.pct)}%)"><div class="fill" style="width:${Math.max(0, Math.min(100, Number(a.pct||0)))}%"></div></div></div>`).join('')}
           </div>` : '';

        root.innerHTML = `
          <div class="dashx">
            <div class="dashx-head">
              <div>
                <div class="ux-row" style="gap:12px">
                  <h2 class="ux-h1" style="margin:0">Dashboard</h2>
                  <span class="badge ${syncDot}" id="dashSyncBadge">${esc(syncLabel)}</span>
                </div>
                <div class="small muted ux-sub">
                  <span id="dashNow">${esc(nowText())}</span> • Team: <b>${esc(model.teamLabel)}</b> • Duty: <b>${esc(model.dutyLabel)}</b> (next: ${esc(model.nextLabel)} in <span id="dashDutyLeft">${esc(dutyCountdown)}</span>)
                </div>
              </div>
              <div class="dashx-actions">
                <button class="btn" type="button" id="dashToggleSidebar">Toggle Sidebar</button>
                <a class="btn" href="/mailbox">Assign Case</a>
                <a class="btn" href="/${isAdmin||isLead ? 'master_schedule' : 'my_schedule'}">Schedule</a>
                <a class="btn" href="/logs">Export Logs</a>
              </div>
            </div>
            <div class="dashx-cards">
              ${card('Active cases', String(model.openCases), isAdmin ? 'All open cases in system' : 'Your team workload signal')}
              ${card('My active cases', String(model.myOpen), 'Assigned to you')}
              ${card('Pending acknowledgements', String(model.pendingAcks), 'Schedule blocks awaiting your acknowledge')}
              ${card('Mailbox shift load', model.mbx.hasTable ? String(model.mbx.totalOpen) : '—', model.mbx.hasTable ? `Open assignments (${esc(model.mbx.shiftKey||'shift')})` : 'Mailbox not loaded')}
            </div>
            <div class="dashx-layout">
              <div class="ux-card dashx-panel">
                <div class="dashx-title">Team Activity Heatmap</div>
                <div class="small muted" style="margin-top:6px">Last 7 days • 4-hour bins • Hover for counts</div>
                <div class="dashx-heatmap" id="dashHeatmap">${heatRows.join('')}</div>
                <div style="margin-top:14px" class="dashx-title">Notification Center</div>
                <div class="dashx-notif-tools">
                  <button class="dashx-filter ux-focusable" data-filter="unread" id="dashF_unread">Unread (${esc(model.unreadNotifs.length)})</button>
                  <button class="dashx-filter ux-focusable" data-filter="schedule" id="dashF_schedule">Schedule (${esc(model.notifs.length)})</button>
                  <button class="dashx-filter ux-focusable" data-filter="mailbox" id="dashF_mailbox">Mailbox</button>
                  <button class="dashx-filter ux-focusable" data-filter="system" id="dashF_system">System</button>
                  <button class="dashx-filter ux-focusable" data-filter="all" id="dashF_all">All</button>
                  <input class="dashx-filter" style="flex:1;min-width:180px" id="dashNotifSearch" placeholder="Search…" value="${esc(state.q||'')}" />
                </div>
                <div class="dashx-notifs" id="dashNotifs"></div>
              </div>
              <div style="display:flex;flex-direction:column;gap:12px">
                <div class="ux-card dashx-panel">
                  <div class="dashx-title">Mailbox Analytics</div>
                  <div class="small muted" style="margin-top:6px">Shift: <b>${esc(model.mbx.shiftKey||'—')}</b>${model.bucketLabel ? ` • Bucket: <b>${esc(model.bucketLabel)}</b>` : ''}${model.bucketManager ? ` • Manager: <b>${esc(model.bucketManager)}</b>` : ''}</div>
                  ${model.mbx.hasTable ? `<div class="ux-row" style="margin-top:10px;gap:10px"><span class="badge">Assigned: ${esc(model.mbx.totalAssigned)}</span><span class="badge ok">Confirmed: ${esc(model.mbx.totalConfirmed)}</span><span class="badge warn">Open: ${esc(model.mbx.totalOpen)}</span><span class="badge">Avg response: ${esc(model.mbx.avgRespMin ? (model.mbx.avgRespMin+' min') : '—')}</span></div>` : ''}
                  <div style="margin-top:10px">${bucketRows}</div>
                  ${byRole}
                  ${topAsg}
                </div>
                <div class="ux-card dashx-panel">
                  <div class="dashx-title">Quick Navigation</div>
                  <div class="small muted" style="margin-top:6px">Role-aware shortcuts</div>
                  <div class="dashx-actions" style="margin-top:10px">
                    <a class="btn" href="/my_schedule">My Schedule</a>
                    <a class="btn" href="/mailbox">Mailbox</a>
                    <a class="btn" href="/attendance">Attendance</a>
                    <a class="btn" href="/tasks">Tasks</a>
                    ${(isAdmin||isLead) ? `<a class="btn" href="/master_schedule">Master Schedule</a>` : ''}
                    ${isAdmin ? `<a class="btn" href="/members">User Management</a>` : ''}
                  </div>
                </div>
              </div>
            </div>
          </div>
        `;

        try{
          const f = String(state.filter||'unread');
          (root.querySelectorAll('.dashx-filter[data-filter]')||[]).forEach(b=>{
            try{ b.classList.toggle('active', String(b.getAttribute('data-filter')||'')===f); }catch(_){ }
          });
        }catch(_){ }

        bindNotifCenter(model);
        bindQuickActions();
      }

      function classifyActivity(a){
        const act = String(a && a.action || '').toUpperCase();
        if(act.startsWith('MAILBOX_')) return 'mailbox';
        if(act.includes('SCHEDULE') || act.includes('ACK')) return 'schedule';
        if(act.includes('ERROR') || act.includes('EXCEPTION') || act==='APP_ERROR') return 'system';
        return 'other';
      }

      function renderNotifs(model){
        const f = String(state.filter||'unread');
        const q = String(state.q||'').trim().toLowerCase();
        const items = [];

        for(const n of (model.notifs||[])){
          if(!n) continue;
          const unread = !!(me.id && Array.isArray(n.recipients) && n.recipients.includes(me.id) && !(n.acks && n.acks[me.id]));
          items.push({
            type:'schedule', id: n.id, ts: Number(n.ts||0) || Date.now(), title: n.title || 'Schedule Updated',
            body: n.body || '', from: n.fromName || 'Team Lead', unread, category:'schedule'
          });
        }

        const logs = (model.logs||[]).slice(0, 60);
        for(const l of logs){
          if(!l) continue;
          items.push({
            type:'activity', id: String(l.ts||'') + '_' + String(l.action||''), ts: Number(l.ts||0) || 0,
            title: String(l.action||'Activity'), body: [l.msg, l.detail].filter(Boolean).join('\\n'), from: l.actorName || '',
            unread:false, category: classifyActivity(l)
          });
        }

        items.sort((a,b)=> (b.ts||0) - (a.ts||0));

        const filtered = items.filter(it=>{
          if(f==='unread' && !it.unread) return false;
          if(f==='schedule' && it.category!=='schedule') return false;
          if(f==='mailbox' && it.category!=='mailbox') return false;
          if(f==='system' && it.category!=='system') return false;
          if(f!=='all' && f!=='unread' && f!=='schedule' && f!=='mailbox' && f!=='system') return true;
          if(q){
            const txt = (it.title+'\n'+it.body+'\n'+it.from).toLowerCase();
            if(!txt.includes(q)) return false;
          }
          return true;
        }).slice(0, 16);

        const fmt = (ts)=>{
          try{ return new Date(Number(ts||0)).toLocaleString('en-CA', { timeZone: tz, month:'short', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false }); }catch(_){ return ''; }
        };

        if(!filtered.length){
          return `<div class="small muted" style="padding:10px 2px">No items for this filter.</div>`;
        }

        return filtered.map(it=>{
          const unreadCls = it.unread ? 'unread' : '';
          const topRight = `<div class="small muted">${esc(fmt(it.ts))}</div>`;
          const ackBtn = (it.type==='schedule' && it.unread) ? `<button class="btn dashx-ack" data-ack="${esc(it.id)}" type="button" aria-label="Acknowledge schedule notification"><span class="dashx-spin" aria-hidden="true"></span><span class="dashx-acklbl">Acknowledge</span></button>` : '';
          const from = it.from ? `<div class="small muted">From: ${esc(it.from)}</div>` : '';
          return `
            <div class="dashx-notif ${unreadCls}">
              <div class="top">
                <div><div class="t">${esc(it.title)}</div>${from}</div>
                <div style="display:flex;align-items:center;gap:10px">${topRight}${ackBtn}</div>
              </div>
              <div class="m">${esc(it.body||'')}</div>
            </div>
          `;
        }).join('');
      }

      function bindNotifCenter(model){
        const box = root.querySelector('#dashNotifs');
        if(!box) return;
        box.innerHTML = renderNotifs(model);

        (root.querySelectorAll('.dashx-filter[data-filter]')||[]).forEach(btn=>{
          btn.onclick = ()=>{
            state.filter = String(btn.getAttribute('data-filter')||'all');
            const next = buildModel();
            render(next);
          };
        });

        const inp = root.querySelector('#dashNotifSearch');
        if(inp){
          inp.oninput = ()=>{
            state.q = String(inp.value||'');
            const next = buildModel();
            const list = root.querySelector('#dashNotifs');
            if(list) list.innerHTML = renderNotifs(next);
          };
        }

        (box.querySelectorAll('[data-ack]')||[]).forEach(b=>{
          b.onclick = ()=>{
            const id = String(b.getAttribute('data-ack')||'');
            if(!id) return;
            try{
              if(b.dataset.busy==='1') return;
              b.dataset.busy='1'; b.disabled = true;
              const spin = b.querySelector('.dashx-spin');
              const lbl = b.querySelector('.dashx-acklbl');
              if(spin) spin.classList.add('on');
              if(lbl) lbl.textContent = 'Acknowledging…';
            }catch(_){ }

            try{
              Store.ackNotif && Store.ackNotif(id, me.id);
              UI.toast && UI.toast('Acknowledged.');
            }catch(e){
              try{ UI.toast && UI.toast('Failed to acknowledge. Try again.', 'warn'); }catch(_){ }
              try{
                b.dataset.busy='0'; b.disabled = false;
                const spin = b.querySelector('.dashx-spin');
                const lbl = b.querySelector('.dashx-acklbl');
                if(spin) spin.classList.remove('on');
                if(lbl) lbl.textContent = 'Acknowledge';
              }catch(_){ }
              return;
            }
            try{ const next = buildModel(); render(next); }catch(_){
              try{ const list = root.querySelector('#dashNotifs'); if(list){ const next = buildModel(); list.innerHTML = renderNotifs(next); } }catch(_){}
            }
          };
        });
      }

      function bindQuickActions(){
        const btn = root.querySelector('#dashToggleSidebar');
        if(btn){ btn.onclick = ()=>{ try{ const t = document.getElementById('sidebarToggle'); if(t) t.click(); }catch(_){ } }; }
      }

      function softUpdateHeader(){
        try{
          const now = root.querySelector('#dashNow');
          if(now) now.textContent = nowText();

          const parts = (UI.mailboxNowParts ? UI.mailboxNowParts() : (UI.manilaNow ? UI.manilaNow() : null)) || {};
          const duty = (UI.getDutyWindow ? UI.getDutyWindow(parts) : null);
          const left = duty && Number.isFinite(Number(duty.secLeft)) ? Number(duty.secLeft) : 0;
          const el = root.querySelector('#dashDutyLeft');
          if(el && UI && UI.formatDuration) el.textContent = UI.formatDuration(left);
        }catch(_){ }
      }

      function updateSyncBadge(){
        try{
          const b = root.querySelector('#dashSyncBadge');
          if(!b) return;
          const mode = String(state.sync.mode||'offline');
          const label = (mode==='cloud') ? 'Realtime' : (mode==='poll') ? 'Polling' : (mode==='connecting') ? 'Connecting' : 'Offline';
          b.textContent = label;
          b.classList.remove('ok','warn','bad');
          b.classList.add(mode==='cloud' ? 'ok' : (mode==='poll' || mode==='connecting') ? 'warn' : 'bad');
        }catch(_){ }
      }

      const model = buildModel();
      render(model);

      try{ if(root._dashTimer) clearInterval(root._dashTimer); }catch(_){ }
      root._dashTimer = setInterval(()=>{ softUpdateHeader(); }, 1000);

      const onStore = (ev)=>{
        try{
          const k = ev && ev.detail ? String(ev.detail.key||'') : '';
          if(!k) return;
          if(k==='ums_cases' || k==='ums_schedule_notifs' || k==='mums_mailbox_tables' || k==='mums_mailbox_state' || k==='ums_activity_logs'){
            const next = buildModel();
            render(next);
          }
        }catch(_){ }
      };
      window.addEventListener('mums:store', onStore);

      const onSync = (ev)=>{
        try{
          const d = (ev && ev.detail) ? ev.detail : {};
          state.sync = { mode: d.mode || 'offline', detail: d.detail || '', lastOkAt: d.lastOkAt || 0 };
          updateSyncBadge();
        }catch(_){ }
      };
      window.addEventListener('mums:syncstatus', onSync);

      const prevCleanup = root._cleanup;
      root._dashCleanup = ()=>{
        try{ if(root._dashTimer) clearInterval(root._dashTimer); }catch(_){ }
        try{ root._dashTimer = null; }catch(_){ }
        try{ window.removeEventListener('mums:store', onStore); }catch(_){ }
        try{ window.removeEventListener('mums:syncstatus', onSync); }catch(_){ }
      };
      root._cleanup = ()=>{
        try{ if(prevCleanup) prevCleanup(); }catch(_){ }
        try{ if(root._dashCleanup) root._dashCleanup(); }catch(_){ }
      };

    }catch(err){
      try{ console.error(err); }catch(_){ }
      try{ root.innerHTML = `<h2 style="margin:0 0 10px">Dashboard</h2><div class="card pad">Failed to load dashboard. Please reload.</div>`; }catch(_){ }
    }
  };

  UI.renderSchedule = function(root){
    try{
      const host = root || document.getElementById('main') || document.body;
      if(window.Pages && typeof window.Pages.my_schedule === 'function'){
        window.Pages.my_schedule(host);
        return;
      }
      host.innerHTML = `<div class="card pad">My Schedule module not loaded. Please reload.</div>`;
    }catch(err){
      try{ console.error(err); }catch(_){ }
      try{
        const host = root || document.getElementById('main') || document.body;
        host.innerHTML = `<div class="card pad">Failed to load My Schedule. Please reload.</div>`;
      }catch(_){ }
    }
  };

  // ENTERPRISE UPGRADE: God-Eye MS Teams Style Toast for Managers & Admins
  UI.initMailboxManagerToasts = function() {
    if(window._mbxToastEngineRunning) return;
    window._mbxToastEngineRunning = true;

    // Pre-populate from current confirmed state so refresh doesn't re-fire toasts
    const _initKnownAssignments = () => {
      const known = {};
      try {
        const state = window.Store?.getMailboxState?.() || {};
        const curKey = state.currentKey;
        if (curKey) {
          const t = window.Store?.getMailboxTable?.(curKey);
          (t && Array.isArray(t.assignments) ? t.assignments : []).forEach(a => {
            if (a && a.id) known[a.id] = Number(a.confirmedAt || 0) > 0;
          });
        }
        // Also scan all tables in case shift rotated
        const allTables = window.Store?.getMailboxTables?.() || {};
        Object.values(allTables).forEach(t => {
          (t && Array.isArray(t.assignments) ? t.assignments : []).forEach(a => {
            if (a && a.id) known[a.id] = Number(a.confirmedAt || 0) > 0;
          });
        });
      } catch (_) {}
      return known;
    };
    let knownAssignments = _initKnownAssignments();

    if (!document.getElementById('ms-teams-toast-styles')) {
        const s = document.createElement('style');
        s.id = 'ms-teams-toast-styles';
        s.textContent = `
            @keyframes toastSlideIn { from { transform: translateX(120%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
            @keyframes toastSlideOut { from { transform: translateX(0); opacity: 1; } to { transform: translateX(120%); opacity: 0; } }
            @keyframes toastProgress { from { transform: scaleX(1); } to { transform: scaleX(0); } }
            
            .ms-enterprise-toast {
                position: relative; background: linear-gradient(145deg, rgba(15,23,42,0.95), rgba(2,6,23,0.98));
                backdrop-filter: blur(12px); border: 1px solid rgba(16,185,129,0.3); border-left: 4px solid #10b981;
                border-radius: 12px; padding: 16px 20px; box-shadow: 0 15px 35px -5px rgba(0,0,0,0.6), 0 0 20px rgba(16,185,129,0.1);
                display: flex; align-items: center; gap: 16px; width: 360px; pointer-events: auto; overflow: hidden;
                animation: toastSlideIn 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
            }
            .ms-enterprise-toast.hiding { animation: toastSlideOut 0.4s cubic-bezier(0.6, -0.28, 0.735, 0.045) forwards; }
            
            .ms-toast-close {
                position: absolute; top: 8px; right: 8px; background: transparent; border: none;
                color: #94a3b8; cursor: pointer; font-size: 14px; padding: 4px; border-radius: 4px;
                transition: all 0.2s; line-height: 1; z-index: 10;
            }
            .ms-toast-close:hover { background: rgba(255,255,255,0.1); color: #f8fafc; }
            
            .ms-toast-progress {
                position: absolute; bottom: 0; left: 0; height: 3px; background: linear-gradient(90deg, #0ea5e9, #10b981);
                width: 100%; transform-origin: left; animation: toastProgress 6s linear forwards;
            }
        `;
        document.head.appendChild(s);
    }

    window.addEventListener('mums:store', (e) => {
        if(e?.detail?.key !== 'mums_mailbox_tables') return;

        if(!isCurrentMailboxManager()) return;

        const state = window.Store?.getMailboxState?.() || {};
        const curKey = state.currentKey;
        if(!curKey) return;
        
        const table = window.Store?.getMailboxTable?.(curKey);
        if(!table || !Array.isArray(table.assignments)) return;

        table.assignments.forEach(a => {
           if (!a || !a.id) return;
           const wasConfirmed = knownAssignments[a.id];
           const isConfirmed = Number(a.confirmedAt||0) > 0;

           if (!wasConfirmed && isConfirmed) {
               const assignee = window.Store?.getUsers?.().find(u => u.id === a.assigneeId);
               const name = assignee ? (assignee.name || assignee.username) : 'A team member';
               showTeamsToast(name, a.caseNo || 'Unknown Case');
           }
           knownAssignments[a.id] = isConfirmed;
        });
    });

    function isCurrentMailboxManager() {
        try {
            const u = window.Auth?.getUser?.();
            if (!u) return false;
            
            const role = String(u.role || '').toUpperCase();
            const SA = (window.Config && window.Config.ROLES && window.Config.ROLES.SUPER_ADMIN) ? window.Config.ROLES.SUPER_ADMIN : 'SUPER_ADMIN';
            if (role === SA) return true;

            const now = window.UI?.manilaNow?.();
            if (!now) return false;
            const nowMin = now.hh * 60 + now.mm;
            const dow = new Date(now.isoDate + 'T00:00:00+08:00').getDay();
            const blocks = window.Store?.getUserDayBlocks?.(u.id, dow) || [];
            
            for (const b of blocks) {
                if (b.role !== 'mailbox_manager' && b.role !== 'mailbox_call') continue;
                const sParts = String(b.start).split(':');
                const eParts = String(b.end).split(':');
                const s = (parseInt(sParts[0])||0)*60 + (parseInt(sParts[1])||0);
                const e = (parseInt(eParts[0])||0)*60 + (parseInt(eParts[1])||0);
                const wraps = e <= s;
                const hit = !wraps ? (nowMin >= s && nowMin < e) : (nowMin >= s || nowMin < e);
                if (hit) return true;
            }
            return false;
        } catch(e) {
            return false;
        }
    }

    function showTeamsToast(name, caseNo) {
        let container = document.getElementById('ms-teams-toast-container');
        if(!container) {
            container = document.createElement('div');
            container.id = 'ms-teams-toast-container';
            container.style.cssText = 'position:fixed; bottom:24px; right:24px; z-index:999999; display:flex; flex-direction:column; gap:10px; pointer-events:none;';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.className = 'ms-enterprise-toast';
        const initials = window.UI.initials ? window.UI.initials(name) : 'U';

        toast.innerHTML = `
            <div class="ms-toast-progress"></div>
            <button class="ms-toast-close" onclick="this.parentElement.classList.add('hiding'); setTimeout(() => this.parentElement.remove(), 400);">✕</button>
            
            <div style="position:relative;">
                <div style="width:42px; height:42px; border-radius:50%; background:linear-gradient(135deg, #0ea5e9, #38bdf8); display:flex; align-items:center; justify-content:center; color:#fff; font-weight:900; font-size:16px; box-shadow: 0 4px 10px rgba(14,165,233,0.3); border:2px solid rgba(255,255,255,0.1);">
                    ${initials}
                </div>
                <div style="position:absolute; bottom:-4px; right:-4px; background:#10b981; width:18px; height:18px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:900; color:#fff; border:2px solid #0f172a; box-shadow: 0 0 8px rgba(16,185,129,0.5);">✓</div>
            </div>
            
            <div style="flex:1; min-width:0; padding-right:12px;">
                <div style="font-size:11px; color:#10b981; font-weight:800; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:2px;">Task Acknowledged</div>
                <div style="font-size:14px; color:#f8fafc; font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                    ${window.UI.esc(name)}
                </div>
                <div style="font-size:12px; color:#94a3b8; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                    Reference: <strong style="color:#e2e8f0;">${window.UI.esc(caseNo)}</strong>
                </div>
            </div>
        `;

        container.appendChild(toast);
        try{ window.UI.playNotifSound?.(window.Auth?.getUser?.()?.id); }catch(e){}

        setTimeout(() => {
            if (!toast.classList.contains('hiding')) {
                toast.classList.add('hiding');
                setTimeout(() => toast.remove(), 400);
            }
        }, 6000);
    }
  };

  window.UI = UI;

  (function bindSyncStatus(){
    function root(){ return document.getElementById("realtimeSyncStatus"); }
    function set(mode, detail){
      var el = root();
      if (!el) return;
      el.classList.remove("ok","poll","off");
      if (mode === "realtime") el.classList.add("ok");
      else if (mode === "connecting" || mode === "polling") el.classList.add("poll");
      else el.classList.add("off");
      var state = el.querySelector(".state");
      if (state) {
        state.textContent = (mode === "realtime") ? "Connected" : (mode === "connecting") ? "Connecting" : (mode === "polling") ? "Polling" : "Offline";
      }
      if (typeof detail === "string" && detail) el.title = detail;
    }
    window.addEventListener("mums:syncstatus", function(e){
      try {
        var d = e && e.detail ? e.detail : {};
        set(String(d.mode||"offline"), String(d.detail||""));
      } catch (_) {}
    });
    document.addEventListener("DOMContentLoaded", function(){ set("offline", "Starting sync..."); });
  })();

  UI.initMailboxManagerToasts();

})();