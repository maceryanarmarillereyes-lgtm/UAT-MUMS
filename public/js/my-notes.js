/* My Notes v2 - Cloudflare Pages + Supabase */
(function(){
  const ICON = '/Widget%20Images/MY_NOTES.png';
  const LS_CACHE = 'mums_notes_v2';
  const LS_WS = 'mums_notes_ws';
  const DEBOUNCE = 800;
  let notes=[], activeId=null, activeWs=localStorage.getItem(LS_WS)||'personal', saveTimer=null, sb=null, uid=null;

  const $=s=>document.querySelector(s);
  const uidGen=()=>'n_'+Math.random().toString(36).slice(2,8)+Date.now().toString(36);
  const now=()=>new Date().toISOString();
  const sortAZ=a=>a.slice().sort((x,y)=>x.title.toLowerCase().localeCompare(y.title.toLowerCase()));

  async function getSb(){ if(sb) return sb; const e=window.EnvRuntime?.env?.()||window.MUMS_ENV||{}; if(!e.SUPABASE_URL) return null; if(!window.supabase?.createClient){ await new Promise((r,j)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';s.onload=r;s.onerror=j;document.head.appendChild(s);}); } sb=window.supabase.createClient(e.SUPABASE_URL,e.SUPABASE_ANON_KEY,{auth:{persistSession:false}}); const t=window.CloudAuth?.accessToken?.()||''; if(t) sb.auth.setSession({access_token:t,refresh_token:''}).catch(()=>{}); return sb; }
  async function getUid(){ if(uid) return uid; const u=window.CloudAuth?.getUser?.(); uid=u?.id||null; return uid; }

  function loadLocal(){ try{notes=JSON.parse(localStorage.getItem(LS_CACHE)||'[]')}catch{notes=[]} }
  function saveLocal(){ try{localStorage.setItem(LS_CACHE,JSON.stringify(notes))}catch{} }

  async function pull(){ const s=await getSb(); const u=await getUid(); if(!s||!u) return; const {data}=await s.from('mums_notes').select('*').eq('user_id',u); notes=(data||[]).map(r=>({id:r.id,workspace:r.workspace||'personal',title:r.title||'Untitled',content:r.content||'',updated_at:r.updated_at})); saveLocal(); render(); }
  async function push(n){ const s=await getSb(); const u=await getUid(); if(!s||!u) return; await s.from('mums_notes').upsert({id:n.id,user_id:u,workspace:n.workspace,title:n.title,content:n.content,updated_at:now()},{onConflict:'id'}); }
  function schedule(n){ clearTimeout(saveTimer); saveTimer=setTimeout(()=>push(n),DEBOUNCE); }

  function ensureModal(){
    if($('#myNotesModal')) return;
    document.body.insertAdjacentHTML('beforeend',`
<div class="modal" id="myNotesModal" style="z-index:9999;display:none">
 <div class="panel" style="max-width:1400px;width:95vw;height:90vh;display:flex;flex-direction:column;background:linear-gradient(145deg,rgba(15,23,42,.96),rgba(2,6,23,.98));border:1px solid rgba(56,189,248,.3);border-radius:18px">
  <div style="display:flex;justify-content:space-between;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.08)">
   <div style="display:flex;align-items:center;gap:10px"><img src="${ICON}" style="width:24px;height:24px"><div style="font-weight:900;color:#fff">My Notes</div><span style="font-size:11px;padding:2px 8px;background:rgba(245,158,11,.18);color:#fbbf24;border-radius:999px">COMMAND CENTER</span></div>
   <button class="btn ghost" data-close="1">✕</button>
  </div>
  <div style="display:flex;flex:1;min-height:0">
   <div style="width:210px;border-right:1px solid rgba(255,255,255,.06);padding:12px">
    <div style="font-size:11px;color:#64748b;margin-bottom:8px">WORKSPACES</div>
    <button class="ws" data-ws="personal" style="width:100%;text-align:left;padding:10px;margin-bottom:6px;border-radius:8px;background:transparent;border:1px solid transparent;color:#cbd5e1;cursor:pointer">📁 Personal</button>
    <button class="ws" data-ws="team" style="width:100%;text-align:left;padding:10px;margin-bottom:6px;border-radius:8px;background:transparent;border:1px solid transparent;color:#cbd5e1;cursor:pointer">👥 Team</button>
    <button class="ws" data-ws="projects" style="width:100%;text-align:left;padding:10px;border-radius:8px;background:transparent;border:1px solid transparent;color:#cbd5e1;cursor:pointer">📦 Projects</button>
   </div>
   <div style="width:320px;border-right:1px solid rgba(255,255,255,.06);display:flex;flex-direction:column">
    <div style="padding:10px;display:flex;gap:8px"><input id="mnSearch" placeholder="Search..." style="flex:1;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.1);color:#fff;border-radius:8px;padding:8px"><button id="mnNew" class="btn primary">+ New</button></div>
    <div id="mnList" style="flex:1;overflow:auto;padding:8px"></div>
    <div style="padding:8px;font-size:11px;color:#7c8ba1">A-Z • <span id="mnCount">0</span></div>
   </div>
   <div style="flex:1;display:flex;flex-direction:column">
    <div style="padding:12px;display:flex;gap:10px;border-bottom:1px solid rgba(255,255,255,.06)"><input id="mnTitle" placeholder="Untitled" style="flex:1;background:transparent;border:0;color:#fff;font-size:20px;font-weight:800;outline:none"><button id="mnCopy" class="btn" style="background:rgba(245,158,11,.2);color:#fde68a">📋 Copy</button><button id="mnDel" class="btn ghost" style="color:#fca5a5">Delete</button></div>
    <div style="padding:0 14px 8px;font-size:11px;color:#64748b">Workspace: <b id="mnWs">personal</b></div>
    <textarea id="mnContent" style="flex:1;margin:0 12px 12px;background:rgba(0,0,0,.2);border:1px solid rgba(255,255,255,.1);border-radius:12px;color:#e2e8f0;padding:14px"></textarea>
   </div>
  </div>
 </div>
</div>`);
    $('#myNotesModal').onclick=e=>{if(e.target.dataset.close) close()};
    $('#mnNew').onclick=create; $('#mnSearch').oninput=render; $('#mnTitle').oninput=edit; $('#mnContent').oninput=edit; $('#mnCopy').onclick=copy; $('#mnDel').onclick=del;
    document.querySelectorAll('.ws').forEach(b=>b.onclick=()=>setWs(b.dataset.ws));
  }

  function open(){ ensureModal(); $('#myNotesModal').style.display='flex'; loadLocal(); pull(); setWs(activeWs); }
  function close(){ $('#myNotesModal').style.display='none'; }
  function setWs(w){ activeWs=w; localStorage.setItem(LS_WS,w); document.querySelectorAll('.ws').forEach(b=>{ const a=b.dataset.ws===w; b.style.background=a?'rgba(56,189,248,.18)':'transparent'; b.style.borderColor=a?'rgba(56,189,248,.4)':'transparent'; }); $('#mnWs').textContent=w; render(); }
  function render(){ const q=($('#mnSearch').value||'').toLowerCase(); const l=$('#mnList'); l.innerHTML=''; const f=sortAZ(notes.filter(n=>n.workspace===activeWs).filter(n=>!q||n.title.toLowerCase().includes(q)||n.content.toLowerCase().includes(q))); $('#mnCount').textContent=f.length; f.forEach(n=>{ const d=document.createElement('div'); d.style.cssText='padding:8px;margin:3px 0;border-radius:8px;cursor:pointer;background:'+(n.id===activeId?'rgba(56,189,248,.15)':'transparent'); d.innerHTML=`<b>${n.title}</b><div style="font-size:12px;opacity:.7">${(n.content||'').slice(0,50)}</div>`; d.onclick=()=>select(n.id); l.appendChild(d); }); }
  function select(id){ activeId=id; const n=notes.find(x=>x.id===id); $('#mnTitle').value=n.title; $('#mnContent').value=n.content; render(); }
  function create(){ const n={id:uidGen(),workspace:activeWs,title:'Untitled',content:'',updated_at:now()}; notes.push(n); saveLocal(); render(); select(n.id); push(n); }
  function edit(){ const n=notes.find(x=>x.id===activeId); if(!n) return; n.title=$('#mnTitle').value; n.content=$('#mnContent').value; n.updated_at=now(); saveLocal(); render(); schedule(n); }
  function copy(){ const n=notes.find(x=>x.id===activeId); if(n) navigator.clipboard.writeText(n.content||''); }
  async function del(){ const n=notes.find(x=>x.id===activeId); if(!n) return; notes=notes.filter(x=>x.id!==activeId); saveLocal(); render(); const s=await getSb(); const u=await getUid(); if(s) await s.from('mums_notes').delete().eq('id',n.id).eq('user_id',u); }

  function inject(){ const r=document.getElementById('releaseNotesBtn'); if(!r||document.getElementById('myNotesBtn')) return; const b=document.createElement('button'); b.id='myNotesBtn'; b.className='btn ghost iconbtn'; b.title='My Notes'; b.innerHTML=`<img src="${ICON}" style="width:18px;height:18px">`; b.onclick=open; r.parentNode.insertBefore(b,r); }
  function init(){ if(!inject()){ const o=new MutationObserver(()=>{if(inject())o.disconnect()}); o.observe(document.body,{childList:true,subtree:true}); } }
  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',init):init();
})();
