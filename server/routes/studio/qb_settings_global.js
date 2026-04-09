/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */


// server/routes/studio/qb_settings_global.js
// GET /api/studio/qb_settings_global — returns Studio QB settings in global_quickbase format
// POST /api/studio/qb_settings_global — saves to Studio QB settings
//   Super Admin saves also write to the global fallback key.
// Called by Pages.my_quickbase (via fetch patch) — isolated from MUMS Global QB.

const { getUserFromJwt, getProfileForUserId } = require('../../lib/supabase');
const {
  readStudioQbSettings,
  writeStudioQbSettings,
  writeGlobalStudioQbSettings,
} = require('../../lib/studio_quickbase');

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function isSuperAdmin(profile) {
  if (!profile) return false;
  const role = String(profile.role || '').toUpperCase().replace(/\s+/g, '_');
  return role === 'SUPER_ADMIN' || role === 'SA' || role === 'SUPERADMIN';
}

function parseQbUrl(url) {
  const out = { realm: '', tableId: '', qid: '' };
  if (!url) return out;
  try {
    const u    = new URL(url);
    const host = String(u.hostname || '').toLowerCase();
    const m    = host.match(/^([a-z0-9-]+)\.quickbase\.com$/i);
    if (m) out.realm = m[1];
    const segs = u.pathname.split('/').filter(Boolean);
    const ti   = segs.indexOf('table');
    if (ti >= 0 && segs[ti + 1]) out.tableId = segs[ti + 1];
    if (!out.tableId) {
      const di = segs.indexOf('db');
      if (di >= 0 && segs[di + 1]) out.tableId = segs[di + 1];
    }
    const rawQid = u.searchParams.get('qid') || '';
    const qm     = rawQid.match(/-?\d+/);
    if (qm) out.qid = qm[0];
    if (!out.qid) {
      const rm = url.match(/[?&]qid=(-?\d+)/i);
      if (rm) out.qid = rm[1];
    }
  } catch (_) {}
  return out;
}

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const auth = req.headers.authorization || '';
    const jwt  = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const user = await getUserFromJwt(jwt);
    if (!user) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    const method = String(req.method || 'GET').toUpperCase();

    if (method === 'GET') {
      const out = await readStudioQbSettings(user.id);
      if (!out.ok) return sendJson(res, 500, { ok: false, error: 'db_error' });
      const s = out.settings;

      let realm      = String(s.realm   || '').trim();
      let tableId    = String(s.tableId || '').trim();
      let qid        = String(s.qid     || '').trim();
      const reportLink = String(s.reportLink || '').trim();
      if (reportLink && (!realm || !tableId || !qid)) {
        const parsed = parseQbUrl(reportLink);
        if (!realm   && parsed.realm)   realm   = parsed.realm;
        if (!tableId && parsed.tableId) tableId = parsed.tableId;
        if (!qid     && parsed.qid)     qid     = parsed.qid;
      }

      const settings = {
        reportLink,
        realm,
        tableId,
        qid,
        qbToken:       '',
        qbTokenSet:    !!(s.qbToken),
        customColumns: Array.isArray(s.customColumns) ? s.customColumns : [],
        filterConfig:  Array.isArray(s.filterConfig)  ? s.filterConfig  : [],
        filterMatch:   s.filterMatch || 'ALL',
      };
      return sendJson(res, 200, { ok: true, settings });
    }

    if (method === 'POST' || method === 'PATCH') {
      const profile = await getProfileForUserId(user.id);
      let body = {};
      try {
        if (req.body && typeof req.body === 'object') body = req.body;
        else body = await new Promise((resolve, reject) => {
          let d = '';
          req.on('data', c => { d += c; });
          req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(e); } });
        });
      } catch (_) { return sendJson(res, 400, { ok: false, error: 'invalid_json' }); }

      // Restore sentinel token
      if (body.qbToken === '__QB_TOKEN_SAVED__') {
        const existing = await readStudioQbSettings(user.id);
        body.qbToken   = (existing.ok && existing.settings) ? existing.settings.qbToken : '';
      }

      // Auto-derive realm/tableId/qid from reportLink if not provided
      if (body.reportLink && (!body.realm || !body.tableId || !body.qid)) {
        const parsed = parseQbUrl(body.reportLink);
        if (!body.realm   && parsed.realm)   body.realm   = parsed.realm;
        if (!body.tableId && parsed.tableId) body.tableId = parsed.tableId;
        if (!body.qid     && parsed.qid)     body.qid     = parsed.qid;
      }

      const actorName = (profile && (profile.name || profile.username)) || '';

      // Write to user's personal key
      const saveOut = await writeStudioQbSettings(user.id, body, actorName);
      if (!saveOut.ok) return sendJson(res, 500, { ok: false, error: 'save_failed' });

      // Super Admin saves ALSO update the global fallback so all other users get data.
      if (isSuperAdmin(profile)) {
        await writeGlobalStudioQbSettings(body, actorName).catch(() => {});
      }

      const saved = { ...saveOut.settings };
      if (saved.qbToken) { saved.qbTokenSet = true; delete saved.qbToken; }
      return sendJson(res, 200, { ok: true, settings: saved });
    }

    return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
  } catch (err) {
    console.error('[studio/qb_settings_global]', err);
    return sendJson(res, 500, { ok: false, error: 'internal_error' });
  }
};