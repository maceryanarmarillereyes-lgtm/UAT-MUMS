/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */


// Debug log sink.
//
// IMPORTANT:
// - This project uses a single-function API router (api/handler.js) in CommonJS.
// - Keeping this route in CommonJS avoids Vercel's ESM->CJS compilation warning.

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');

    if ((req.method || 'GET') !== 'POST') {
      res.statusCode = 405;
      return res.end(JSON.stringify({ ok: false, error: 'method_not_allowed' }));
    }

    // Allow unauthenticated; this is a debug sink only.
    const body = req.body || {};

    // Avoid logging secrets in full: redact tokens if present.
    const redacted = JSON.parse(
      JSON.stringify(body, (k, v) => {
        if (typeof v === 'string' && v.length > 80 && /eyJ[a-zA-Z0-9_-]+\./.test(v)) {
          return v.slice(0, 20) + '…(redacted jwt)…' + v.slice(-8);
        }
        if (/(anon|service|secret|token|password)/i.test(k) && typeof v === 'string') {
          return v.slice(0, 6) + '…(redacted)…';
        }
        return v;
      })
    );

    console.log('[MUMS_DEBUG]', JSON.stringify(redacted));
    res.statusCode = 200;
    return res.end(JSON.stringify({ ok: true }));
  } catch (e) {
    console.error('[MUMS_DEBUG] handler error', e);
    res.statusCode = 200;
    return res.end(JSON.stringify({ ok: false }));
  }
};
