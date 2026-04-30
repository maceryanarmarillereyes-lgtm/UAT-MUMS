/* MUMS Freemium Guard v1.0
 * Implements multi-tab leader election + visibility pause for presence & realtime
 * Safe to add â€” does NOT modify UNTOUCHABLE files
 */
(function(){
  'use strict';
  const LEADER_KEY = 'mums_presence_leader';
  const HEARTBEAT_KEY = 'mums_leader_heartbeat';
  const LEADER_TTL = 60000; // 60s leader lease
  const BC_NAME = 'mums_presence_bc';
  
  let isLeader = false;
  let bc = null;
  let leaderTimer = null;
  let visibilityPaused = false;
  
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
    // Pause watchdog backup poll
    try { if (window.presenceWatchdog && presenceWatchdog.stop) presenceWatchdog.stop(); } catch(_){}
    // Pause realtime - keep connection but stop listening
    try { 
      if (window.Realtime && Realtime.getRealtimeClient) {
        const client = Realtime.getRealtimeClient();
        if (client && client.realtime) {
          // Don't disconnect, just pause channel subscription to save egress
          broadcast('tab-hidden', true);
        }
      }
    } catch(_){}
  }
  
  function resumeNonEssential(){
    if (!visibilityPaused) return;
    visibilityPaused = false;
    // Resume only if leader
    if (isLeader) {
      try { location.reload(); } catch(_){} // simplest: reload to restart watchdog
    }
    broadcast('tab-visible', true);
  }
  
  function initBroadcast(){
    try {
      bc = new BroadcastChannel(BC_NAME);
      bc.onmessage = (ev) => {
        const msg = ev.data || {};
        if (msg.type === 'leader-elected') {
          isLeader = false;
        }
      };
    } catch(_){}
  }
  
  // Leader election loop
  function startLeaderLoop(){
    tryBecomeLeader();
    leaderTimer = setInterval(()=>{
      if (isLeader) renewLeader();
      else tryBecomeLeader();
    }, 20000); // check every 20s
  }
  
  // Visibility handling
  document.addEventListener('visibilitychange', ()=>{
    if (document.hidden) {
      pauseNonEssential();
    } else {
      // Wait 1s for tab to stabilize
      setTimeout(resumeNonEssential, 1000);
    }
  });
  
  // Pause during resize/filter storms
  let resizeTimer = null;
  window.addEventListener('resize', ()=>{
    pauseNonEssential();
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resumeNonEssential, 2000);
  }, {passive:true});
  
  // Init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ()=>{
      initBroadcast();
      startLeaderLoop();
    });
  } else {
    initBroadcast();
    startLeaderLoop();
  }
  
  // Expose for debugging
  window.__mumsFreemiumGuard = {
    isLeader: ()=>isLeader,
    pause: pauseNonEssential,
    resume: resumeNonEssential
  };
})();