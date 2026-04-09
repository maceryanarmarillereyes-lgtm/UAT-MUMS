/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */


module.exports = async (_req, res) => {
  try {
    const env = (typeof process !== 'undefined' && process && process.env)
      ? process.env
      : (globalThis.__MUMS_ENV || {});

    // Keep payload LIMITED to public values needed by the frontend.
    const out = {
      SUPABASE_URL: env.SUPABASE_URL || '',
      SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY || '',
      USERNAME_EMAIL_DOMAIN: env.USERNAME_EMAIL_DOMAIN || 'mums.local'
    };

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(JSON.stringify(out));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ error: 'env_failed', message: String(err && err.message ? err.message : err) }));
  }
};
