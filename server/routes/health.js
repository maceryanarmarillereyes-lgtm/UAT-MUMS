/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Strictly protects Enterprise UI/UX, Realtime Sync Logic, Core State Management, and Database/API Adapters. Do NOT modify existing logic or layout in this file without explicitly asking Thunter BOY for clearance. If overlapping changes are required, STOP and provide a RISK IMPACT REPORT first. */
module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');

    if (req.method && req.method !== 'GET') {
      res.statusCode = 405;
      return res.end(JSON.stringify({ ok: false, error: 'method_not_allowed' }));
    }

    const hasSupabaseUrl = !!process.env.SUPABASE_URL;
    const hasAnon = !!process.env.SUPABASE_ANON_KEY;
    const hasService = !!process.env.SUPABASE_SERVICE_ROLE_KEY;

    return res.end(
      JSON.stringify({
        ok: true,
        time: new Date().toISOString(),
        env: {
          SUPABASE_URL: hasSupabaseUrl,
          SUPABASE_ANON_KEY: hasAnon,
          SUPABASE_SERVICE_ROLE_KEY: hasService
        }
      })
    );
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok: false, error: 'server_error', message: String(e?.message || e) }));
  }
};
