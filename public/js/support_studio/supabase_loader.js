/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

(function(){
  // FIX v3.9.30: Source order updated.
  // 1. /api/vendor/supabase  — CF Pages catch-all + Vercel (no .js, now aliased in route map)
  // 2. /functions/vendor/supabase.js — CF Pages file-based route (fallback)
  // 3. jsDelivr CDN — last resort if both server-side proxies fail
  var sources = [
    '/api/vendor/supabase',
    '/functions/vendor/supabase.js',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.0/dist/umd/supabase.min.js'
  ];
  function loadAt(i) {
    if (i >= sources.length) return;
    var s = document.createElement('script');
    s.src = sources[i];
    s.onload = function() {
      try { window.__MUMS_SUPABASE_SRC = sources[i]; } catch(_) {}
      try { window.dispatchEvent(new CustomEvent('mums:supabase_ready')); } catch(_) {}
    };
    s.onerror = function() { loadAt(i + 1); };
    document.head.appendChild(s);
  }
  if (window.supabase && typeof window.supabase.createClient === 'function') {
    try { window.dispatchEvent(new CustomEvent('mums:supabase_ready')); } catch(_) {}
  } else {
    loadAt(0);
  }
})();
