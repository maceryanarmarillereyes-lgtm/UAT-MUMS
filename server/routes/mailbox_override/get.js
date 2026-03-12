/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Strictly protects Enterprise UI/UX, Realtime Sync Logic, Core State Management, and Database/API Adapters. Do NOT modify existing logic or layout in this file without explicitly asking Thunter BOY for clearance. If overlapping changes are required, STOP and provide a RISK IMPACT REPORT first. */
const { getUserFromJwt, getProfileForUserId, serviceSelect } = require('../../lib/supabase');

// ===== CODE UNTOUCHABLES =====
// Global mailbox override visibility is a PERMANENT behavior.
// - /api/mailbox_override/get MUST return { ok:true, override:{...} }.
// - Read rules:
//    * scope=global     => readable by ALL authenticated roles.
//    * scope=superadmin => readable ONLY by SUPER_ADMIN.
// - This ensures Global override status is visible to non-Super Admin users when active.
// Exception: Only change if required by documented Supabase/Auth behavior changes or security requirements.
// ==============================

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

// GET /api/mailbox_override/get?scope=global|superadmin
module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');

    const url = new URL(req.url, `http://${req.headers.host}`);
    const scope = (url.searchParams.get('scope') || 'global').toLowerCase();
    if (!['global', 'superadmin'].includes(scope)) {
      return sendJson(res, 400, { ok: false, error: 'invalid_scope', message: 'scope must be global or superadmin' });
    }

    // Auth required so we can enforce scope permissions.
    const auth = req.headers.authorization || '';
    const jwt = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const u = await getUserFromJwt(jwt);
    if (!u) return sendJson(res, 401, { ok: false, error: 'unauthorized', message: 'Missing or invalid bearer token.' });

    // Global scope must be readable by all authenticated users, even if a profile row is missing.
    // Only the superadmin scope requires role enforcement.
    let profile = null;
    if (scope === 'superadmin') {
      profile = await getProfileForUserId(u.id);
      if (!profile) return sendJson(res, 403, { ok: false, error: 'forbidden', message: 'Profile not found.' });
      if (profile.role !== 'SUPER_ADMIN') {
        return sendJson(res, 403, { ok: false, error: 'forbidden', message: 'Super Admin only.' });
      }
    }

    const out = await serviceSelect('mums_mailbox_override', `select=*&scope=eq.${encodeURIComponent(scope)}&limit=1`);
    if (!out.ok) {
      return sendJson(res, out.status || 500, {
        ok: false,
        error: 'db_error',
        message: 'Failed to read mailbox override.',
        details: out.json || out.text
      });
    }

    const row = (Array.isArray(out.json) && out.json[0]) ? out.json[0] : null;

    // Normalize DB row into client override object.
    const enabled = !!(row && row.enabled);
    const freeze = !!(row && (Object.prototype.hasOwnProperty.call(row, 'is_frozen') ? row.is_frozen : row.freeze));
    const override_iso = (row && row.override_iso) ? String(row.override_iso) : '';

    let ms = 0;
    if (enabled && override_iso) {
      const t = Date.parse(override_iso);
      ms = Number.isFinite(t) ? t : 0;
    }

    // Running mode uses updated_at as an anchor to advance deterministically.
    let setAt = 0;
    if (enabled && ms && freeze === false) {
      const anchor = row && (row.updated_at || row.created_at);
      const t = anchor ? Date.parse(String(anchor)) : Date.now();
      setAt = Number.isFinite(t) ? t : Date.now();
    }

    const override = {
      scope,
      enabled: enabled && !!ms,
      ms: ms || 0,
      freeze: freeze !== false,
      setAt: setAt || 0,
      // Useful metadata for diagnostics (safe to ignore on client)
      updated_at: row && row.updated_at ? String(row.updated_at) : null,
      updated_by: row && row.updated_by ? String(row.updated_by) : null
    };

    return sendJson(res, 200, { ok: true, override });
  } catch (e) {
    return sendJson(res, 500, { ok: false, error: 'server_error', message: String(e?.message || e) });
  }
};
