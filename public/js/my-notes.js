/* My Notes - Command Center Pro v1.0 */
(function(){
  const DBG = window.MUMS_DEBUG || {log(){},warn(){},error(){}};
  const LS_KEY = 'mums_notes_cache_v1';
  const DEBOUNCE_MS = 800;
  let notes = [], activeId = null, saveTimer = null, sb = null, userId = null;
  const $ = (s, r=document) => r.querySelector(s);
  function uid(){ return 'n_'+Math.random().toString(36).slice(2,9)+Date.now().toString(36); }
  function nowISO(){ return new Date().toISOString(); }
  function sortAZ(arr){ return arr.slice().sort((a,b)=> String(a.title||'').toLowerCase().localeCompare(String(b.title||'').toLowerCase())); }

  async function getSb(){
    if(sb) return sb;
    const e = (window.EnvRuntime?.env?.() || window.MUMS_ENV || {});
    if(!e.SUPABASE_URL || !e.SUPABASE_ANON_KEY) return null;
    if(!window.supabase?.createClient){
      await new Promise((res,rej)=>{ const s=document.createElement('script'); s.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js'; s.onload=res; s.onerror=rej; document.head.appendChild(s); });
    }
    sb = window.supabase.createClient(e.SUPABASE_URL, e.SUPABASE_ANON_KEY, {auth:{persistSession:false}});
    const token = window.CloudAuth?.accessToken?.() || '';
    if(token) sb.auth.setSession({access_token:token, refresh_token:''}).catch(()=>{});
    return sb;
  }
  async function getUserId(){ if(userId) return userId; const u = window.CloudAuth?.getUser?.(); userId = u?.id || null; return userId; }
  function loadLocal(){ try{ const raw = localStorage.getItem(LS_KEY); if(raw){ notes = JSON.parse(raw)||[]; } }catch{} notes = sortAZ(notes); }
  function saveLocal(){ try{ localStorage.setItem(LS_KEY, JSON.stringify(notes)); }catch{} }

  async function pullFromCloud(){ const s = await getSb(); const uidv = await getUserId(); if(!s||!uidv) return; const {data,error} = await s.from('mums_notes').select('*').eq('user_id',uidv).order('title',{ascending:true}); if(error){ DBG.warn('notes.pull',error); return; } notes = (data||[]).map(r=>({id:r.id,title:r.title,content:r.content||'',updated_at:r.updated_at})); notes = sortAZ(notes); saveLocal(); renderList(); }
  async function pushToCloud(note){ const s = await getSb(); const uidv = await getUserId(); if(!s||!uidv) return; const payload = {id:note.id,user_id:uidv,title:note.title,content:note.content,updated_at:nowISO()}; const {error} = await s.from('mums_notes').upsert(payload,{onConflict:'id'}); if(error) DBG.warn('notes.push',error); }
  async function removeFromCloud(id){ const s = await getSb(); const uidv = await getUserId(); if(!s||!uidv) return; const {error} = await s.from('mums_notes').delete().eq('id', id).eq('user_id', uidv); if(error) DBG.warn('notes.delete', error); }
  function scheduleSave(note){ clearTimeout(saveTimer); saveTimer = setTimeout(()=>{ pushToCloud(note); }, DEBOUNCE_MS); }

  function ensureModal(){
    if($('#myNotesModal')) return;
    const html = `
    <div class="modal" id="myNotesModal" style="z-index:9999;display:none;position:fixed;inset:0;background:rgba(2,6,23,.72)">
      <div class="panel" style="max-width:1400px;width:95vw;height:90vh;display:flex;flex-direction:column;background:linear-gradient(145deg,rgba(15,23,42,.95),rgba(2,6,23,.98));backdrop-filter:blur(24px);border:1px solid rgba(56,189,248,.25);border-radius:16px;box-shadow:0 30px 60px -12px rgba(0,0,0,.8);position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)">
        <div class="head" style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.08)">
          <div style="display:flex;align-items:center;gap:10px">
            <img src="public/Widget Images/MY_NOTES.png" style="width:22px;height:22px">
            <div style="font-weight:900;font-size:18px;color:#f8fafc">My Notes</div>
            <span style="font-size:11px;padding:2px 8px;border-radius:999px;background:rgba(245,158,11,.15);color:#fbbf24;border:1px solid rgba(245,158,11,.3)">PREMIUM</span>
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            <div class="sync-status"><span class="dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#22c55e"></span><span class="state" style="color:#86efac;margin-left:6px">Supabase</span></div>
            <button class="btn ghost" data-close="myNotesModal">✕</button>
          </div>
        </div>
        <div style="display:flex;flex:1;min-height:0">
          <div style="width:200px;border-right:1px solid rgba(255,255,255,.06);padding:12px;display:flex;flex-direction:column;gap:6px">
            <div style="font-size:11px;text-transform:uppercase;color:#64748b;padding:0 8px 6px">Workspaces</div>
            <button class="btn ghost" style="justify-content:flex-start;background:rgba(56,189,248,.15);color:#7dd3fc">📁 Personal</button>
            <button class="btn ghost" style="justify-content:flex-start;opacity:.6">👥 Team</button>
            <button class="btn ghost" style="justify-content:flex-start;opacity:.6">📦 Projects</button>
          </div>
          <div style="width:300px;border-right:1px solid rgba(255,255,255,.06);display:flex;flex-direction:column;min-width:0">
            <div style="padding:10px;display:flex;gap:8px">
              <input id="notesSearch" placeholder="Search notes..." style="flex:1;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.1);color:#e2e8f0;border-radius:8px;padding:8px 10px">
              <button id="notesNew" class="btn primary" style="padding:8px 12px">+ New</button>
            </div>
            <div id="notesList" style="flex:1;overflow:auto;padding:0 8px 8px"></div>
          </div>
          <div style="flex:1;display:flex;flex-direction:column;min-width:0">
            <div style="padding:10px;border-bottom:1px solid rgba(255,255,255,.06)">
              <input id="noteTitle" placeholder="Untitled note" style="width:100%;background:rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.1);color:#f8fafc;border-radius:8px;padding:10px 12px;font-size:14px;font-weight:700">
            </div>
            <div style="flex:1;padding:10px;display:flex;min-height:0">
              <textarea id="noteContent" placeholder="Write your note here..." style="width:100%;height:100%;resize:none;background:rgba(0,0,0,.24);border:1px solid rgba(255,255,255,.08);color:#e2e8f0;border-radius:10px;padding:12px"></textarea>
            </div>
            <div style="padding:10px;border-top:1px solid rgba(255,255,255,.06);display:flex;justify-content:space-between;align-items:center">
              <div id="noteMeta" style="font-size:12px;color:#94a3b8">Ready</div>
              <div style="display:flex;gap:8px">
                <button id="notesDelete" class="btn ghost">Delete</button>
                <button id="notesDuplicate" class="btn ghost">Duplicate</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', html);

    $('#myNotesModal [data-close="myNotesModal"]').addEventListener('click', close);
    $('#myNotesModal').addEventListener('click', (e)=>{ if(e.target.id==='myNotesModal') close(); });
    $('#notesNew').addEventListener('click', newNote);
    $('#notesSearch').addEventListener('input', renderList);
    $('#noteTitle').addEventListener('input', onEdit);
    $('#noteContent').addEventListener('input', onEdit);
    $('#notesDelete').addEventListener('click', delNote);
    $('#notesDuplicate').addEventListener('click', duplicateNote);
  }

  function renderList(){
    const q = String($('#notesSearch')?.value || '').trim().toLowerCase();
    const list = $('#notesList');
    if(!list) return;
    const filtered = notes.filter(n=> !q || String(n.title||'').toLowerCase().includes(q) || String(n.content||'').toLowerCase().includes(q));
    list.innerHTML = filtered.map(n=>`
      <button class="btn ghost note-item" data-id="${n.id}" style="width:100%;justify-content:flex-start;display:block;text-align:left;margin:0 0 6px;background:${n.id===activeId?'rgba(56,189,248,.16)':'rgba(255,255,255,.02)'};border:1px solid rgba(255,255,255,.08)">
        <div style="font-weight:700;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(n.title || 'Untitled')}</div>
        <div style="font-size:11px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc((n.content||'').replace(/\n/g,' '))}</div>
      </button>
    `).join('') || '<div style="color:#94a3b8;padding:8px">No notes found.</div>';
    list.querySelectorAll('.note-item').forEach(btn=>btn.addEventListener('click', ()=>select(btn.dataset.id)));
    renderActive();
  }

  function esc(v){ return String(v||'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
  function active(){ return notes.find(n=>n.id===activeId) || null; }

  function renderActive(){
    const n = active();
    const ti = $('#noteTitle');
    const tc = $('#noteContent');
    const meta = $('#noteMeta');
    if(!ti || !tc || !meta) return;
    if(!n){ ti.value=''; tc.value=''; meta.textContent='No note selected'; return; }
    ti.value = n.title || '';
    tc.value = n.content || '';
    meta.textContent = `Updated ${new Date(n.updated_at || Date.now()).toLocaleString()}`;
  }

  function select(id){ activeId = id; renderList(); }

  function newNote(){
    const n = { id: uid(), title: 'Untitled', content: '', updated_at: nowISO() };
    notes = sortAZ([n, ...notes]);
    activeId = n.id;
    saveLocal();
    renderList();
    pushToCloud(n);
  }

  function onEdit(){
    const n = active();
    if(!n) return;
    n.title = String($('#noteTitle')?.value || 'Untitled').trim() || 'Untitled';
    n.content = String($('#noteContent')?.value || '');
    n.updated_at = nowISO();
    notes = sortAZ(notes);
    saveLocal();
    renderList();
    scheduleSave(n);
  }

  function delNote(){
    const n = active();
    if(!n) return;
    const id = n.id;
    notes = notes.filter(x=>x.id!==id);
    activeId = notes[0]?.id || null;
    saveLocal();
    renderList();
    removeFromCloud(id);
  }

  function duplicateNote(){
    const n = active();
    if(!n) return;
    const cp = { id: uid(), title: `${n.title || 'Untitled'} (Copy)`, content: n.content || '', updated_at: nowISO() };
    notes = sortAZ([cp, ...notes]);
    activeId = cp.id;
    saveLocal();
    renderList();
    pushToCloud(cp);
  }

  function open(){ ensureModal(); $('#myNotesModal').style.display = 'block'; if(!notes.length){ loadLocal(); if(!notes.length) newNote(); else { activeId = notes[0].id; renderList(); } } pullFromCloud().catch(()=>{}); }
  function close(){ const m = $('#myNotesModal'); if(m) m.style.display='none'; }

  window.MyNotesCommandCenter = { open, close, refresh: pullFromCloud };
})();
