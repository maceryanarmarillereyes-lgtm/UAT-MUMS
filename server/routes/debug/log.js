/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Strictly protects Enterprise UI/UX, Realtime Sync Logic, Core State Management, and Database/API Adapters. Do NOT modify existing logic or layout in this file without explicitly asking MACE for clearance. If overlapping changes are required, STOP and provide a RISK IMPACT REPORT first. */
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
