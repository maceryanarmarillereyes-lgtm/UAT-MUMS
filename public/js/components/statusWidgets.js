/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */


(function(){
  const MODULE = 'StatusWidgets';
  const ROOT_ID = 'right-sidebar-container';
  const WRAP_ID = 'status-widget-grid';
  const ACK_ENDPOINTS = ['/api/sync/push', '/functions/api/sync/push'];
  const SETTINGS_ENDPOINTS = ['/api/settings/global-theme', '/functions/api/settings/global-theme'];
  const DEFAULT_STATES = {
    cases: false,
    reminders: false,
    deadlines: false
  };
const WIDGETS = [
{ id:'cases', label:'Cases', color:'blue', targetPage:'pages/my_case.js', eventKey:'newCases' },
{ id:'reminders', label:'Reminders', color:'yellow', targetPage:'pages/my_reminders.js', eventKey:'newReminders' },
{ id:'deadlines', label:'Deadlines', color:'red', targetPage:'pages/team_reminders.js', eventKey:'newDeadlines' }
];

let state = loadState();
let __enabledMapCache = null;
let __enabledMapCacheAt = 0;
const ENABLED_MAP_TTL_MS = 60000;

function token(){
try{
if(window.CloudAuth && typeof window.CloudAuth.accessToken === 'function'){
return String(window.CloudAuth.accessToken() || '').trim();
}
}catch(_){ }
return '';
}

function headers(){
const h = { 'Content-Type':'application/json' };
const t = token();
if(t) h.Authorization = `Bearer ${t}`;
return h;
}

function loadState(){
try{
const raw = localStorage.getItem('mums_status_widgets_state');
const parsed = raw ? JSON.parse(raw) : {};
return Object.assign({}, DEFAULT_STATES, parsed);
}catch(_){
return Object.assign({}, DEFAULT_STATES);
}
}

function saveState(){
try{ localStorage.setItem('mums_status_widgets_state', JSON.stringify(state)); }catch(_){ }
}

function toPageId(targetPage){
const raw = String(targetPage || '').trim();
const m = raw.match(/pages\/([a-z0-9_-]+)\.js$/i);
return m ? String(m[1]) : '';
}

function routeTo(pageId){
const id = String(pageId || '').trim();
if(!id) return;

try{
  const navLink = document.querySelector(`#nav a.nav-item[data-page="${CSS.escape(id)}"]`);
  if(navLink){
    navLink.click();
    return;
  }
}catch(_){ }
try{
  const path = (id === 'distribution_monitoring') ? '/distribution/monitoring' : `/${id}`;
  history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}catch(_){
  try{ window.location.hash = `#${id}`; }catch(__){ }
}
}

async function fetchFirstJson(urls){
for(const url of urls){
try{
const res = await fetch(url, { method:'GET', headers: headers(), cache:'no-store' });
const data = await res.json().catch(()=>({}));
if(res.ok) return { ok:true, data };
}catch(_){ }
}
return { ok:false, data:{} };
}

function normalizeEnabledMap(payload){
const raw = payload && typeof payload === 'object' ? payload : {};
const source = raw.widgetSettings || raw.widgets || raw.statusWidgets || raw.settings || {};
if(!source || typeof source !== 'object') return null;

const out = {};
for(const w of WIDGETS){
  const v = source[w.id];
  if(typeof v === 'boolean') out[w.id] = v;
  else if(v && typeof v === 'object' && typeof v.enabled === 'boolean') out[w.id] = v.enabled;
}
return Object.keys(out).length ? out : null;
}

async function loadEnabledMap(){
const now = Date.now();
if(__enabledMapCache && (now - __enabledMapCacheAt) < ENABLED_MAP_TTL_MS){
  return __enabledMapCache;
}
const out = await fetchFirstJson(SETTINGS_ENDPOINTS);
if(!out.ok) return null;
const normalized = normalizeEnabledMap(out.data);
__enabledMapCache = normalized;
__enabledMapCacheAt = now;
return normalized;
}

function renderGrid(enabledMap){
const host = document.getElementById(ROOT_ID) || document.getElementById('rightbar');
if(!host) return;

const existing = document.getElementById(WRAP_ID);
if(existing) existing.remove();
const wrap = document.createElement('section');
wrap.id = WRAP_ID;
wrap.className = 'status-widget-grid';
wrap.setAttribute('aria-label', 'Programmable status widgets');
wrap.style.order = '-1';
const frag = document.createDocumentFragment();
for(const widget of WIDGETS){
  const enabled = !enabledMap || enabledMap[widget.id] !== false;
  if(!enabled) continue;
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = `status-widget-tile is-${widget.color}`;
  tile.dataset.widgetId = widget.id;
  tile.dataset.targetPage = widget.targetPage;
  tile.setAttribute('aria-label', widget.label);
  const active = !!state[widget.id];
  tile.classList.toggle('is-active', active);
  tile.innerHTML = `
    <span class="status-widget-title">${widget.label || 'N/A'}</span>
    <span class="status-widget-sub">${active ? 'New' : 'Idle'}</span>
  `;
  tile.addEventListener('click', (e)=>{
    const btn = e.currentTarget;
    // Tactile Flash Feedback
    btn.style.background = 'rgba(255,255,255,0.2)'; 
    setTimeout(async () => {
      btn.style.background = ''; // Reset
      await acknowledge(widget.id);
      routeTo(toPageId(tile.dataset.targetPage));
    }, 150);
  });
  frag.appendChild(tile);
}
wrap.appendChild(frag);
const targetHost = (host.id === ROOT_ID) ? host : (host.querySelector(`#${ROOT_ID}`) || host);
if(targetHost.firstChild) targetHost.insertBefore(wrap, targetHost.firstChild);
else targetHost.appendChild(wrap);
}

async function acknowledge(widgetId){
const id = String(widgetId || '').trim();
if(!id) return;

for(const url of ACK_ENDPOINTS){
  try{
    const res = await fetch(url, {
      method:'POST',
      headers: headers(),
      body: JSON.stringify({
        key: 'mums_user_events',
        op: 'merge',
        value: [{ id: `widget_ack_${id}`, widgetId: id, seenAt: Date.now() }]
      })
    });
    if(res.ok) break;
  }catch(_){ }
}
state[id] = false;
saveState();
refresh();
}

function applyIncoming(payload){
const src = payload && typeof payload === 'object' ? payload : {};
let changed = false;
WIDGETS.forEach((w)=>{
if(typeof src[w.eventKey] === 'boolean'){
state[w.id] = src[w.eventKey];
changed = true;
}
});
if(changed){
saveState();
refresh();
}
}

async function refresh(){
const enabledMap = await loadEnabledMap();
renderGrid(enabledMap);
}

function init(){
refresh();

const host = document.getElementById(ROOT_ID) || document.getElementById('rightbar');
if(host && !host.__statusWidgetObserver){
  host.__statusWidgetObserver = new MutationObserver(()=>{
    const el = document.getElementById(WRAP_ID);
    if(!el) return refresh();
    const parent = el.parentElement;
    if(parent && parent.firstChild !== el){
      parent.insertBefore(el, parent.firstChild);
    }
  });
  host.__statusWidgetObserver.observe(host, { childList:true, subtree:true });
}
// Normal Internal Sync Logic
window.addEventListener('mums:status-widgets', (ev)=>{
  applyIncoming(ev && ev.detail ? ev.detail : {});
});
// Realtime Global Listener
window.addEventListener('mums:realtime_alert', (ev) => {
  const row = ev && ev.detail ? ev.detail : {};
  const keyStr = String(row.key || row.action || '').toLowerCase();
  const valStr = typeof row.value === 'string' ? row.value : JSON.stringify(row.value || {});
  
  const currentUser = (window.Auth && window.Auth.getUser) ? window.Auth.getUser() : null;
  const myId = currentUser ? String(currentUser.id || '') : '';
  
  // Target checks to isolate signals intended for the logged-in user
  if(myId && valStr.includes(myId)){
     const changes = {};
     if(keyStr.includes('case') || valStr.includes('case_assigned')) changes.newCases = true;
     if(keyStr.includes('reminder')) changes.newReminders = true;
     if(keyStr.includes('deadline') || keyStr.includes('notif')) changes.newDeadlines = true;
     
     if(Object.keys(changes).length > 0) applyIncoming(changes);
  }
});
}

if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else setTimeout(init, 0);

window.Components = window.Components || {};
window.Components[MODULE] = { init, refresh, applyIncoming };
})();
