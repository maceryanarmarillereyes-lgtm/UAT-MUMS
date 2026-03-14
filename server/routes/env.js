/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Strictly protects Enterprise UI/UX, Realtime Sync Logic, Core State Management, and Database/API Adapters. Do NOT modify existing logic or layout in this file without explicitly asking MACE for clearance. If overlapping changes are required, STOP and provide a RISK IMPACT REPORT first. */
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
