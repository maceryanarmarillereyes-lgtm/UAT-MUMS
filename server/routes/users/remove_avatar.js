/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

const { getUserFromJwt, getProfileForUserId, serviceFetch, serviceUpdate } = require('../../lib/supabase');

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function encodePath(p) {
  return String(p || '')
    .split('/')
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

function extractStoragePath(publicUrl, bucket) {
  const s = String(publicUrl || '');
  const b = String(bucket || '');
  const marker = `/storage/v1/object/public/${b}/`;
  const idx = s.indexOf(marker);
  if (idx < 0) return null;
  return s.slice(idx + marker.length);
}

// POST /api/users/remove_avatar
// Clears the avatar_url on the profile and attempts to delete the stored object.
module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });

    const auth = String(req.headers.authorization || '');
    const jwt = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const authed = await getUserFromJwt(jwt);
    if (!authed) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    const prof = await getProfileForUserId(authed.id);
    if (!prof) return sendJson(res, 404, { ok: false, error: 'profile_missing' });

    const bucket = String(process.env.SUPABASE_PUBLIC_BUCKET || 'public').trim() || 'public';
    const path = extractStoragePath(prof.avatar_url, bucket);

    // Best-effort delete (ignore failures; clearing pointer is the main goal).
    let deleted = false;
    if (path) {
      try {
        const del = await serviceFetch(`/storage/v1/object/${encodeURIComponent(bucket)}/${encodePath(path)}`, { method: 'DELETE' });
        deleted = !!del.ok;
      } catch (_) {}
    }

    const out = await serviceUpdate('mums_profiles', { avatar_url: null }, { user_id: `eq.${authed.id}` });
    if (!out.ok) return sendJson(res, 500, { ok: false, error: 'profile_update_failed', details: out.json || out.text });

    return sendJson(res, 200, { ok: true, deleted, bucket, path: path || null });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: 'remove_avatar_failed', message: String(err && err.message ? err.message : err) });
  }
};
