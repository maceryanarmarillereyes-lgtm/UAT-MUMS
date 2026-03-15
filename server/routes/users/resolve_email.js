/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */
const { serviceSelect } = require('../../lib/supabase');

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function normalizeUsername(raw) {
  let v = String(raw || '').trim();
  if (!v) return '';
  if (v.includes('@')) v = v.split('@')[0].trim();
  return v.toLowerCase();
}

// GET /api/users/resolve_email?username=<localpart>
// Purpose: allow username-based login even if legacy accounts have a non-canonical auth email.
// Notes:
// - Does NOT require auth (used before login).
// - Returns the stored profile email if present, otherwise the canonical username@domain.
module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method && req.method !== 'GET') {
      return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
    }

    // Query param is expected via req.query; fall back to URL parsing.
    let q = (req && req.query) ? req.query : {};
    let username = normalizeUsername(q.username || q.user || q.login || q.identifier || '');
    if (!username) {
      try {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        username = normalizeUsername(url.searchParams.get('username') || url.searchParams.get('login') || url.searchParams.get('identifier') || '');
      } catch (_) {}
    }

    if (!username) {
      return sendJson(res, 400, { ok: false, error: 'missing_username' });
    }

    const domain = String(process.env.USERNAME_EMAIL_DOMAIN || 'mums.local').trim() || 'mums.local';
    const canonical = `${username}@${domain}`.toLowerCase();

    const out = await serviceSelect('mums_profiles', `select=username,email&username=eq.${encodeURIComponent(username)}&limit=1`);

    let found = false;
    let storedEmail = '';
    if (out.ok && Array.isArray(out.json) && out.json[0]) {
      found = true;
      storedEmail = String(out.json[0].email || '').trim();
    }

    const resolved = (storedEmail ? storedEmail : canonical).toLowerCase();
    return sendJson(res, 200, {
      ok: true,
      username,
      canonical,
      resolved_email: resolved,
      found,
      stored_email: storedEmail || null
    });
  } catch (e) {
    return sendJson(res, 500, { ok: false, error: 'resolve_email_failed', message: e?.message || String(e) });
  }
};
