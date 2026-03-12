/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Do not modify existing UI/UX, layouts, or core logic in this file without explicitly asking Thunter BOY for clearance. If changes are required here, STOP and provide a RISK IMPACT REPORT first. */
// Vercel Serverless Function: /api/env
// Returns ONLY public (safe) runtime config.
// Cache disabled to ensure fresh env across deploys.

module.exports = async (_req, res) => {
  try {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');

    const out = {
      SUPABASE_URL: process.env.SUPABASE_URL || '',
      SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || '',
      USERNAME_EMAIL_DOMAIN: process.env.USERNAME_EMAIL_DOMAIN || 'mums.local',
      // Presence tuning — Two-state model:
      // - Active (green): last_seen within 45s (frontend threshold)
      // - Idle/Away (gray): last_seen 45s–8hr (still in roster, just backgrounded)
      // - Removed: last_seen > 8hr OR explicit __offline__ route (logout/browser close)
      // 28800s = 8 hours — keeps users on roster for a full work shift even with throttled tabs
      PRESENCE_TTL_SECONDS: Number(process.env.PRESENCE_TTL_SECONDS || 28800),
      PRESENCE_POLL_MS: Number(process.env.PRESENCE_POLL_MS || 5000)
    };

    res.end(JSON.stringify(out));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ ok: false, error: 'env_failed', message: String(err?.message || err) }));
  }
};
