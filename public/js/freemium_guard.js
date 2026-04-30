/* MUMS Freemium Guard v1.1
 * Implements multi-tab leader election + visibility pause + 800ms debounce
 * Safe to add â€” does NOT modify UNTOUCHABLE files
 */
(function(){
  'use strict';
  const LEADER_KEY = 'mums_presence_leader';
  const HEARTBEAT_KEY = 'mums_leader_heartbeat';
  const LEADER_TTL = 60000;
  const BC_NAME = 'mums_presence_bc';
  
  let isLeader = false;
  let bc = null;
  let leaderTimer = null;
  let visibilityPaused = false;
  const extraDebounce = new Map();
  
  function now(){ return Date.now(); }
  
  function tryBecomeLeader(){
    try {
      const current = localStorage.getItem(LEADER_KEY);
      const lastBeat = Number(localStorage.getItem(HEARTBEAT_KEY) || 0);
      if (!current || (now() - lastBeat) > LEADER_TTL) {
        const myId = (window.Realtime && Realtime.clientId) ? Realtime.clientId() : Math.random().toString(36);
        localStorage.setItem(LEADER_KEY, myId);
        localStorage.setItem(HEARTBEAT_KEY, String(now()));
        isLeader = true;
        broadcast('leader-elected', myId);
        return true;
      }
      isLeader = (current === ((window.Realtime && Realtime.clientId) ? Realtime.clientId() : ''));
      return isLeader;
    } catch(_){ return false; }
  }
  
  function renewLeader(){
    if (!isLeader) return;
    try { localStorage.setItem(HEARTBEAT_KEY, String(now())); } catch(_){}
  }
  
  function broadcast(type, data){
    try { if (bc) bc.postMessage({type, data, ts: now()}); } catch(_){}
  }
  
  function pauseNonEssential(){
    if (visibilityPaused) return;
    visibilityPaused = true;
    try { if (window.presenceWatchdog && presenceWatchdog.stop) presenceWatchdog.stop(); } catch(_){}
  }
  
  function resumeNonEssential(){
    if (!visibilityPaused) return;
    visibilityPaused = false;
    if (isLeader) { try { location.reload(); } catch(_){} }
    broadcast('tab-visible', true);
  }
  
  function initBroadcast(){
    try {
      bc = new BroadcastChannel(BC_NAME);
      bc.onmessage = (ev) => {
        const msg = ev.data || {};
        if (msg.type === 'leader-elected') { isLeader = false; }
      };
    } catch(_){}
  }
  
  function startLeaderLoop(){
    tryBecomeLeader();
    leaderTimer = setInterval(()=>{
      if (isLeader) renewLeader();
      else tryBecomeLeader();
    }, 20000);
  }
  
  // Wrap Realtime.onLocalWrite to add 800ms debounce and leader-only push
  function wrapRealtime(){
    try {
      if (!window.Realtime || !Realtime.onLocalWrite) return;
      const original = Realtime.onLocalWrite.bind(Realtime);
      Realtime.onLocalWrite = function(key, value){
        // Only leader tab pushes to Supabase
        if (!isLeader) return;
        // Extra 800ms debounce on top of existing 300ms
        if (extraDebounce.has(key)) clearTimeout(extraDebounce.get(key));
        extraDebounce.set(key, setTimeout(()=>{
          extraDebounce.delete(key);
          try { original(key, value); } catch(_){}
        }, 800));
      };
    } catch(_){}
  }
  
  document.addEventListener('visibilitychange', ()=>{
    if (document.hidden) { pauseNonEssential(); } 
    else { setTimeout(resumeNonEssential, 1000); }
  });
  
  let resizeTimer = null;
  window.addEventListener('resize', ()=>{
    pauseNonEssential();
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resumeNonEssential, 2000);
  }, {passive:true});
  
  function init(){
    initBroadcast();
    startLeaderLoop();
    // Wait for Realtime to be available
    const wait = setInterval(()=>{
      if (window.Realtime && Realtime.onLocalWrite) {
        clearInterval(wait);
        wrapRealtime();
      }
    }, 200);
  }
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
  
  window.__mumsFreemiumGuard = {
    isLeader: ()=>isLeader,
    pause: pauseNonEssential,
    resume: resumeNonEssential
  };
})();
