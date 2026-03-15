/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */
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
