/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Strictly protects Enterprise UI/UX, Realtime Sync Logic, Core State Management, and Database/API Adapters. Do NOT modify existing logic or layout in this file without explicitly asking MACE for clearance. If overlapping changes are required, STOP and provide a RISK IMPACT REPORT first. */
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
