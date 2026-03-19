/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */
const { getUserFromJwt, getProfileForUserId, serviceSelect } = require('../../lib/supabase');

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function isMissingColumn(resp, columnName) {
  const needle1 = `column "${columnName}" does not exist`;
  const needle2 = `column ${columnName} does not exist`;
  const txt = String((resp && (resp.text || '')) || '');
  const j = resp && resp.json ? resp.json : null;
  const hay = (s) => String(s || '').toLowerCase();
  const n1 = needle1.toLowerCase();
  const n2 = needle2.toLowerCase();
  if (j && typeof j === 'object') {
    const code = String(j.code || '');
    const msg = hay(j.message || j.error);
    const details = hay(j.details);
    if (code === '42703' && (msg.includes(n1) || msg.includes(n2) || details.includes(n1) || details.includes(n2))) return true;
    if (msg.includes(n1) || msg.includes(n2) || details.includes(n1) || details.includes(n2)) return true;
  }
  const t = hay(txt);
  return t.includes(n1) || t.includes(n2);
}


// GET /api/users/list
// Role-aware listing:
// - SUPER_ADMIN: sees all users
// - TEAM_LEAD : sees only users in their team_id
// - MEMBER    : sees only themselves
module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');

    if (req.method && req.method !== 'GET') {
      return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
    }

    const auth = String(req.headers.authorization || '');
    const jwt = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const user = await getUserFromJwt(jwt);
    if (!user) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    const me = await getProfileForUserId(user.id);
    if (!me) return sendJson(res, 403, { ok: false, error: 'profile_not_found' });

    const myRole = String(me.role || 'MEMBER').toUpperCase();
    let filter = '';

    if (myRole === 'TEAM_LEAD') {
      const team = String(me.team_id || '').trim();
      filter = team ? `&team_id=eq.${encodeURIComponent(team)}` : '&team_id=is.null';
    } else if (myRole !== 'SUPER_ADMIN') {
      filter = `&user_id=eq.${encodeURIComponent(user.id)}`;
    }

    // FIX v3.9.26: Progressive column fallback — try full select first,
    // then gracefully degrade for missing optional columns on fresh/older schemas.
    // Prevents 400 errors when optional columns (qb_name, avatar_url, email) don't exist yet.
    const selectVariants = [
      'user_id,username,name,email,role,team_id,team_override,duty,avatar_url,qb_name,created_at,updated_at',
      'user_id,username,name,email,role,team_id,team_override,duty,avatar_url,created_at,updated_at',
      'user_id,username,name,email,role,team_id,team_override,duty,created_at,updated_at',
      'user_id,username,name,role,team_id,team_override,duty,created_at,updated_at',
      'user_id,username,name,role,team_id,duty,created_at,updated_at',
    ];

    let select = selectVariants[0];
    let out = null;
    for (const s of selectVariants) {
      select = s;
      out = await serviceSelect('mums_profiles', `select=${s}${filter}&order=name.asc`);
      if (out.ok) break;
      // Only retry on 400 with a missing-column message; stop on auth/network errors
      const isColErr = (out.status === 400) && (
        isMissingColumn(out, 'qb_name') ||
        isMissingColumn(out, 'avatar_url') ||
        isMissingColumn(out, 'email') ||
        isMissingColumn(out, 'team_override')
      );
      if (!isColErr) break;
    }

    if (!out.ok) {
      return sendJson(res, out.status || 500, { ok: false, error: 'db_error', details: out.json || out.text });
    }

    // Defensive de-duplication: older deployments may have created duplicate profile rows
    // (e.g., multiple "supermace" entries) before username preflight validation existed.
    // The UI expects a single authoritative row per username.
    const raw = Array.isArray(out.json) ? out.json : [];
    const byKey = new Map();
    const passthrough = [];
    for (const r of raw) {
      const key = String(r && (r.username || r.user_id) ? (r.username || r.user_id) : '').trim().toLowerCase();
      if (!key) { passthrough.push(r); continue; }
      const prev = byKey.get(key);
      if (!prev) { byKey.set(key, r); continue; }
      const tPrev = Date.parse(prev.updated_at || prev.created_at || '') || 0;
      const tCur = Date.parse(r.updated_at || r.created_at || '') || 0;
      if (tCur >= tPrev) byKey.set(key, r);
    }
    const rows = [...byKey.values(), ...passthrough].sort((a, b) => {
      const an = String((a && a.name) || '').toLowerCase();
      const bn = String((b && b.name) || '').toLowerCase();
      if (an < bn) return -1;
      if (an > bn) return 1;
      return 0;
    });

    return sendJson(res, 200, { ok: true, rows });
  } catch (e) {
    return sendJson(res, 500, { ok: false, error: 'server_error', message: e?.message || String(e) });
  }
};
