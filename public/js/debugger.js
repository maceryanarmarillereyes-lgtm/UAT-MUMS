/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Strictly protects Enterprise UI/UX, Realtime Sync Logic, Core State Management, and Database/API Adapters. Do NOT modify existing logic or layout in this file without explicitly asking Thunter BOY for clearance. If overlapping changes are required, STOP and provide a RISK IMPACT REPORT first. */
/* MUMS Debugger (client-side)
   Enable: add ?debug=1 or set localStorage.DEBUG_MUMS=1
*/
(function(){
  const qs = new URLSearchParams(location.search || '');
  const enabled = (qs.get('debug') === '1') || (localStorage.getItem('DEBUG_MUMS') === '1');
  const MAX = 500;

  function nowIso(){ try{return new Date().toISOString();}catch(_){return '';} }

  function safeJson(v){
    try { return JSON.parse(JSON.stringify(v)); } catch(_) { 
      try { return String(v); } catch(__) { return '[unserializable]'; }
    }
  }

  function load(){
    if(!enabled) return [];
    try {
      const raw = localStorage.getItem('MUMS_DEBUG_LOG') || '[]';
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch(_) { return []; }
  }

  function save(arr){
    if(!enabled) return;
    try { localStorage.setItem('MUMS_DEBUG_LOG', JSON.stringify(arr.slice(-MAX))); } catch(_) {}
  }

  function push(entry){
    if(!enabled) return;
    const arr = load();
    arr.push(entry);
    save(arr);
  }

  function basicCtx(){
    const ctx = {
      href: location.href,
      referrer: document.referrer || '',
      ua: navigator.userAgent,
      ts: nowIso(),
      debug: enabled ? 1 : 0
    };
    return ctx;
  }

  function log(level, msg, data){
    const entry = { level, msg, data: safeJson(data), ...basicCtx() };
    push(entry);
    try {
      // Console visibility
      const fn = (level === 'error') ? console.error : (level === 'warn') ? console.warn : console.log;
      fn('[MUMS]', msg, data || '');
    } catch(_) {}
    // Optional server capture (best-effort)
    try {
      fetch('/api/debug/log', {
        method: 'POST',
        headers: {'content-type':'application/json'},
        body: JSON.stringify(entry),
        keepalive: true
      }).catch(()=>{});
    } catch(_) {}
  }

  function stack(){
    try { return (new Error('stack')).stack; } catch(_) { return ''; }
  }

  function redirect(target, reason, extra){
    const u = new URL(target, location.origin);
    // preserve debug flag across navigation
    if(enabled) u.searchParams.set('debug', '1');
    log('warn', 'redirect', {target: u.toString(), reason, extra, stack: stack()});
    try { location.href = u.toString(); } catch(_) {}
  }

  function storageProbe(){
    const res = {};
    const probes = [
      ['localStorage', ()=>localStorage],
      ['sessionStorage', ()=>sessionStorage]
    ];
    probes.forEach(([name, get])=>{
      try{
        const s = get();
        const k = '__mums_probe__';
        s.setItem(k, '1');
        s.removeItem(k);
        res[name] = 'ok';
      }catch(e){
        res[name] = 'blocked:' + (e && e.name ? e.name : 'error');
      }
    });
    try{
      res.cookieEnabled = navigator.cookieEnabled;
      res.cookieLen = (document.cookie||'').length;
    }catch(_){}
    return res;
  }

  function snapshot(label, extra){
    const snap = {
      label,
      storage: storageProbe(),
      extra: safeJson(extra)
    };
    log('info', 'snapshot:' + label, snap);
    return snap;
  }

  function getLog(){ return load(); }
  function clear(){ try{ localStorage.removeItem('MUMS_DEBUG_LOG'); }catch(_){} }

  // Global error hooks
  if(enabled){
    window.addEventListener('error', (e)=>{
      log('error', 'window.error', {message: e.message, filename: e.filename, lineno: e.lineno, colno: e.colno, stack: (e.error && e.error.stack) || ''});
    });
    window.addEventListener('unhandledrejection', (e)=>{
      log('error', 'unhandledrejection', {reason: (e.reason && (e.reason.stack || e.reason.message)) || String(e.reason)});
    });
  }

  // Tiny overlay (optional)
  function overlay(){
    if(!enabled) return;
    try{
      const el = document.createElement('div');
      el.id = 'mums-debug-overlay';
      el.style.cssText = 'position:fixed;z-index:99999;bottom:12px;right:12px;max-width:42vw;min-width:220px;padding:10px 12px;border-radius:10px;background:rgba(0,0,0,.82);color:#fff;font:12px/1.35 system-ui,-apple-system,Segoe UI,Roboto,Arial;box-shadow:0 8px 28px rgba(0,0,0,.35)';
      el.innerHTML = '<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:6px;"><b>MUMS Debug</b><div style="display:flex;gap:6px;"><a href="/debug.html?debug=1" style="color:#9ad;text-decoration:underline" target="_blank">open</a><button id="mumsdbg-clear" style="font:inherit;border:0;border-radius:6px;padding:2px 8px;cursor:pointer">clear</button></div></div><div id="mumsdbg-last" style="opacity:.9">enabled</div>';
      document.body.appendChild(el);
      el.querySelector('#mumsdbg-clear').onclick = function(){ clear(); log('info','log cleared'); };
      const last = el.querySelector('#mumsdbg-last');
      const arr = load();
      const latest = arr[arr.length-1];
      if(latest) last.textContent = latest.level + ': ' + latest.msg;
    }catch(_){}
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', overlay);
  else overlay();

  window.MUMS_DEBUG = { enabled, log, warn:(m,d)=>log('warn',m,d), error:(m,d)=>log('error',m,d), redirect, snapshot, getLog, clear };
})();
