/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */
// Optional hotfix loader.
// If REMOTE_PATCH_URL is set (via Vercel env vars), the app will load a small JS patch
// without requiring a redeploy. Use for emergency bugfixes only.
// Security note: Only point this to a trusted, access-controlled URL.

(function(){
  try{
    const env = (window.EnvRuntime ? EnvRuntime.env() : {});
    const url = (env.REMOTE_PATCH_URL || '').trim();
    if (!url) return;

    const s = document.createElement('script');
    s.src = url;
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.onerror = () => console.warn('[remote_patch] failed to load');
    document.head.appendChild(s);
  } catch(e) {
    // ignore
  }
})();
