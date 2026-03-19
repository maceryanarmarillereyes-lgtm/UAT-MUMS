/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */
function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

module.exports = async (req, res) => {
  try {
    if (String(req.method || '').toUpperCase() !== 'POST') {
      return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
    }

    const body = (req && req.body && typeof req.body === 'object') ? req.body : {};
    const email = String(body.email || '').trim();
    const password = String(body.password || '');
    if (!email || !password) {
      return sendJson(res, 400, { ok: false, error: 'missing_credentials' });
    }

    const env = (typeof process !== 'undefined' && process && process.env)
      ? process.env
      : (globalThis.__MUMS_ENV || {});

    const base = String(env.SUPABASE_URL || '').replace(/\/$/, '');
    const anon = String(env.SUPABASE_ANON_KEY || '');
    if (!base || !anon) {
      return sendJson(res, 500, { ok: false, error: 'supabase_env_missing' });
    }

    const supabaseRes = await fetch(`${base}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: anon,
        Authorization: `Bearer ${anon}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password })
    });
    const outText = await supabaseRes.text().catch(() => '');

    // Preserve Supabase status/body shape so frontend keeps existing handling.
    res.statusCode = Number(supabaseRes.status || 500);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(outText || JSON.stringify({ ok: false, error: 'auth_proxy_failed' }));
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: 'auth_proxy_exception', message: String(err?.message || err) });
  }
};
