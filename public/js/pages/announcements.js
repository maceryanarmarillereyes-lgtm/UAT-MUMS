/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Strictly protects Enterprise UI/UX, Realtime Sync Logic, Core State Management, and Database/API Adapters. Do NOT modify existing logic or layout in this file without explicitly asking MACE for clearance. If overlapping changes are required, STOP and provide a RISK IMPACT REPORT first. */
(window.Pages=window.Pages||{}, window.Pages.announcements = function(root){
  const actor = Auth.getUser();
  
const list = Store.getAnnouncements();

  function avatarHtml(userId, name){
    try{
      const prof = userId ? Store.getProfile(userId) : null;
      const photo = prof && prof.photoDataUrl ? prof.photoDataUrl : '';
      const initials = String(name||'').trim().split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase();
      return photo
        ? `<span class="mini-avatar"><img src="${photo}" alt="" /></span>`
        : `<span class="mini-avatar"><span class="initials">${UI.esc(initials||'—')}</span></span>`;
    }catch(_){
      return `<span class="mini-avatar"><span class="initials">—</span></span>`;
    }
  }


  root.innerHTML = `
    <div class="row" style="justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap">
      <div>
        <h2 style="margin:0 0 6px">Announcements</h2>
        <div class="small">Shown on the top bar during its active duration. Multiple announcements rotate every 3 seconds.</div>
      </div>
      <div class="row" style="gap:8px">
        <button class="btn" id="btnExportAnn">Export</button>
        <button class="btn" id="btnImportAnn">Import</button>
        <button class="btn primary" id="btnNewAnn">New Announcement</button>
      </div>
    </div>

    <table class="table" style="margin-top:10px">
      <thead>
        <tr><th>Title</th><th>Created By</th><th>Short</th><th>Start</th><th>End</th><th>Actions</th></tr>
      </thead>
      <tbody>
        ${list.map(a=>`<tr>
          <td>${UI.esc(a.title)}</td>
          <td><div class="row" style="gap:10px;align-items:center">${avatarHtml(a.createdBy, a.createdByName)}<div><div class="small">${UI.esc(a.createdByName||'—')}</div><div class="small muted" style="font-size:11px">${UI.esc(a.createdBy||'')}</div></div></div></td>
          <td class="small">${UI.esc(a.short)}</td>
          <td class="small">${new Date(a.startAt).toLocaleString('en-US', { timeZone: Config.TZ })}</td>
          <td class="small">${new Date(a.endAt).toLocaleString('en-US', { timeZone: Config.TZ })}</td>
          <td>
            <div class="row" style="gap:8px">
              <button class="btn" data-act="editAnn" data-id="${a.id}">Edit</button>
              <button class="btn danger" data-act="delAnn" data-id="${a.id}">Delete</button>
            </div>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>

    <div class="modal" id="annModal">
      <div class="panel">
        <div class="head">
          <div>
            <div class="announce-title" id="annTitle">New Announcement</div>
            <div class="small" id="annSub">Set duration. When time expires, it disappears from the top bar automatically.</div>
          </div>
          <button class="btn ghost" data-close="annModal">✕</button>
        </div>
        <div class="body">
          <div class="grid2">
            <div>
              <label class="small">Title</label>
              <input class="input" id="a_title" placeholder="Maintenance" />
            </div>
            <div>
              <label class="small">Short description</label>
              <input class="input" id="a_short" placeholder="We have ongoing maintenance" />
            </div>
            <div>
              <label class="small">Start (local time)</label>
              <input class="input" id="a_start" type="datetime-local" />
            </div>
            <div>
              <label class="small">End (local time)</label>
              <input class="input" id="a_end" type="datetime-local" />
            </div>
          </div>

          <div style="margin-top:10px">
            <label class="small">Full description (rich text)</label>
            <div class="editor">
              <div class="toolbar">
                <button class="tool" type="button" data-cmd="bold"><b>B</b></button>
                <button class="tool" type="button" data-cmd="italic"><i>I</i></button>
                <button class="tool" type="button" data-cmd="underline"><u>U</u></button>
                <button class="tool" type="button" data-cmd="insertUnorderedList">• List</button>
                <button class="tool" type="button" data-cmd="justifyLeft">Left</button>
                <button class="tool" type="button" data-cmd="justifyCenter">Center</button>
                <button class="tool" type="button" data-cmd="justifyRight">Right</button>

                <span class="tool" style="display:flex;gap:8px;align-items:center">
                  <label class="small" style="margin:0">Font</label>
                  <select id="a_font">
                    <option value="Arial">Arial</option>
                    <option value="Calibri">Calibri</option>
                    <option value="Verdana">Verdana</option>
                    <option value="Tahoma">Tahoma</option>
                    <option value="Times New Roman">Times New Roman</option>
                    <option value="Georgia">Georgia</option>
                  </select>
                </span>

                <span class="tool" style="display:flex;gap:8px;align-items:center">
                  <label class="small" style="margin:0">Size</label>
                  <select id="a_size">
                    <option value="2">Small</option>
                    <option value="3" selected>Normal</option>
                    <option value="4">Large</option>
                    <option value="5">X-Large</option>
                    <option value="6">XX-Large</option>
                  </select>
                </span>

                <span class="tool" style="display:flex;gap:8px;align-items:center">
                  <label class="small" style="margin:0">Text</label>
                  <input id="a_color" type="color" />
                </span>

                <span class="tool" style="display:flex;gap:8px;align-items:center">
                  <label class="small" style="margin:0">Highlight</label>
                  <input id="a_hl" type="color" value="#ffff00" />
                </span>
              </div>
              <div class="editable" id="a_editor" contenteditable="true"></div>
            </div>
          </div>

          <div class="attachments">
            <div class="row" style="justify-content:space-between;align-items:center">
              <div>
                <div class="section-title">Attachments</div>
                <div class="small">Files are saved locally in your browser storage. Keep attachments small.</div>
              </div>
              <div>
                <input class="input" id="a_files" type="file" multiple />
              </div>
            </div>
            <div class="attach-list" id="a_attachList"></div>
          </div>

          <div class="err" id="a_err"></div>
          <div class="row" style="justify-content:flex-end;margin-top:12px">
            <button class="btn" data-close="annModal">Cancel</button>
            <button class="btn primary" id="btnSaveAnn">Save</button>
          </div>
        </div>
      </div>
    </div>
  `;

  UI.el('#btnNewAnn').onclick = ()=>openAnn(null);
  UI.el('#btnExportAnn').onclick = ()=>UI.downloadJSON('announcements.json', Store.getAnnouncements());
  UI.el('#btnImportAnn').onclick = async()=>{
    const data = await UI.pickJSON();
    if(!Array.isArray(data)) return alert('Invalid JSON. Expected an array.');
    const cleaned = data.filter(x=>x && x.title).map(x=>({
      id: x.id || crypto.randomUUID(),
      title: String(x.title||''),
      short: String(x.short||''),
      full: String(x.full||''),
      fullHtml: String(x.fullHtml||''),
      attachments: Array.isArray(x.attachments) ? x.attachments : [],
      startAt: +x.startAt || Date.now(),
      endAt: +x.endAt || (Date.now()+3600_000),
      createdAt: x.createdAt || Date.now(),
      createdById: x.createdById || null,
      createdByName: x.createdByName || '',
    }));
    Store.saveAnnouncements(cleaned);
    window.location.reload();
  };

  
  const onClick = async (e)=>{
    const btn = e.target.closest('button');
    if(!btn) return;
    const act = btn.dataset.act;
    const id = btn.dataset.id;
    if(act==='editAnn'){
      const a = Store.getAnnouncements().find(x=>x.id===id);
      if(a) openAnn(a);
      return;
    }
    if(act==='delAnn'){
      if(await UI.confirm({ title:'Delete Announcement', message:'Delete announcement?', okText:'Delete', danger:true })){
        Store.saveAnnouncements(Store.getAnnouncements().filter(x=>x.id!==id));
        window.location.reload();
      }
      return;
    }
  };
  root.addEventListener('click', onClick);

  // Cleanup to prevent cross-page click handler collisions.
  root._cleanup = ()=>{
    try{ root.removeEventListener('click', onClick); }catch(_){}
  };
root.querySelectorAll('[data-close="annModal"]').forEach(b=>b.onclick=()=>UI.closeModal('annModal'));

  function toLocalInput(ms){
    const d = new Date(ms);
    const pad = n=>String(n).padStart(2,'0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function openAnn(ann){
    UI.el('#a_err').style.display='none';
    UI.el('#annTitle').textContent = ann ? 'Edit Announcement' : 'New Announcement';
    UI.el('#a_title').value = ann?.title || '';
    UI.el('#a_short').value = ann?.short || '';

    UI.el('#a_start').value = ann ? toLocalInput(ann.startAt) : toLocalInput(Date.now());
    UI.el('#a_end').value = ann ? toLocalInput(ann.endAt) : toLocalInput(Date.now()+3600_000);

    const editor = UI.el('#a_editor');
    editor.innerHTML = ann?.fullHtml || UI.esc(ann?.full||'').replace(/\n/g,'<br>');

    let pendingAttachments = Array.isArray(ann?.attachments) ? [...ann.attachments] : [];

    function renderAttachments(){
      const box = UI.el('#a_attachList');
      if(!pendingAttachments.length){ box.innerHTML = `<div class="small">No attachments</div>`; return; }
      box.innerHTML = pendingAttachments.map((f,idx)=>{
        return `
          <div class="attach-item">
            <div>
              <div>${UI.esc(f.name||'file')}</div>
              <div class="small">${UI.esc(f.type||'')}</div>
            </div>
            <div class="row" style="gap:8px">
              <button class="btn" type="button" data-aidx="${idx}" data-aact="download">Download</button>
              <button class="btn danger" type="button" data-aidx="${idx}" data-aact="remove">Remove</button>
            </div>
          </div>
        `;
      }).join('');
    }

    renderAttachments();

    UI.el('#a_attachList').onclick = (e)=>{
      const b = e.target.closest('button');
      if(!b) return;
      const idx = Number(b.dataset.aidx);
      const act = b.dataset.aact;
      const f = pendingAttachments[idx];
      if(!f) return;
      if(act==='remove'){
        pendingAttachments.splice(idx,1);
        renderAttachments();
      }
      if(act==='download'){
        const a = document.createElement('a');
        a.href = f.dataUrl;
        a.download = f.name||'attachment';
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    };

    UI.el('#a_files').value = '';
    UI.el('#a_files').onchange = async()=>{
      const files = Array.from(UI.el('#a_files').files||[]);
      for(const file of files){
        if(file.size > 1024*1024*2){
          alert(`Skipped ${file.name}: max 2MB per file.`);
          continue;
        }
        const dataUrl = await readAsDataUrl(file);
        pendingAttachments.push({ name:file.name, type:file.type, size:file.size, dataUrl });
      }
      renderAttachments();
    };

    // toolbar actions
    root.querySelectorAll('.toolbar [data-cmd]').forEach(btn=>{
      btn.onclick = ()=>{
        document.execCommand(btn.dataset.cmd, false, null);
        editor.focus();
      };
    });

    UI.el('#a_font').onchange = ()=>{ document.execCommand('fontName', false, UI.el('#a_font').value); editor.focus(); };
    UI.el('#a_size').onchange = ()=>{ document.execCommand('fontSize', false, UI.el('#a_size').value); editor.focus(); };
    UI.el('#a_color').onchange = ()=>{ document.execCommand('foreColor', false, UI.el('#a_color').value); editor.focus(); };
    UI.el('#a_hl').onchange = ()=>{ document.execCommand('hiliteColor', false, UI.el('#a_hl').value); editor.focus(); };

    UI.el('#btnSaveAnn').onclick = ()=>{
      const title = UI.el('#a_title').value.trim();
      const short = UI.el('#a_short').value.trim();
      const startAt = new Date(UI.el('#a_start').value).getTime();
      const endAt = new Date(UI.el('#a_end').value).getTime();
      const fullHtml = editor.innerHTML.trim();

      const err = msg=>{ const el=UI.el('#a_err'); el.textContent=msg; el.style.display='block'; };
      if(!title) return err('Title is required.');
      if(!short) return err('Short description is required.');
      if(!Number.isFinite(startAt) || !Number.isFinite(endAt)) return err('Start/End time required.');
      if(endAt<=startAt) return err('End must be after start.');

      
const list = Store.getAnnouncements();

  function avatarHtml(userId, name){
    try{
      const prof = userId ? Store.getProfile(userId) : null;
      const photo = prof && prof.photoDataUrl ? prof.photoDataUrl : '';
      const initials = String(name||'').trim().split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase();
      return photo
        ? `<span class="mini-avatar"><img src="${photo}" alt="" /></span>`
        : `<span class="mini-avatar"><span class="initials">${UI.esc(initials||'—')}</span></span>`;
    }catch(_){
      return `<span class="mini-avatar"><span class="initials">—</span></span>`;
    }
  }

      if(ann){
        const updated = list.map(x=>x.id===ann.id ? {
          ...x,
          title, short,
          fullHtml,
          attachments: pendingAttachments,
          startAt, endAt,
        } : x);
        Store.saveAnnouncements(updated);
        Store.addLog({
          ts: Date.now(),
          teamId: (actor && actor.teamId) || 'morning',
          actorId: actor ? actor.id : null,
          actorName: actor ? (actor.name||actor.username) : '',
          action: 'ANNOUNCEMENT_UPDATE',
          targetId: ann.id,
          targetName: title,
          msg: `${(actor && (actor.name||actor.username)) || 'User'} updated announcement`,
          detail: title
        });
      } else {
        const newAnn = {
          id: crypto.randomUUID(),
          title, short,
          full: '',
          fullHtml,
          attachments: pendingAttachments,
          startAt, endAt,
          createdAt: Date.now(),
          createdById: actor?.id || null,
          createdByName: actor?.name || actor?.username || '',
        };
        list.unshift(newAnn);
        Store.saveAnnouncements(list);
        Store.addLog({
          ts: Date.now(),
          teamId: (actor && actor.teamId) || 'morning',
          actorId: actor ? actor.id : null,
          actorName: actor ? (actor.name||actor.username) : '',
          action: 'ANNOUNCEMENT_CREATE',
          targetId: newAnn.id,
          targetName: title,
          msg: `${(actor && (actor.name||actor.username)) || 'User'} created announcement`,
          detail: title
        });
      }

      UI.closeModal('annModal');
      // Auto refresh so new announcement shows immediately
      window.location.reload();
    };

    UI.openModal('annModal');
  }

  function readAsDataUrl(file){
    return new Promise((resolve,reject)=>{
      const r = new FileReader();
      r.onload = ()=>resolve(String(r.result||''));
      r.onerror = ()=>reject(r.error);
      r.readAsDataURL(file);
    });
  }
});
