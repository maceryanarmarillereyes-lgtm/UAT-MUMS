/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

// server/routes/studio/qb_monitoring.js
// Proxy for /api/quickbase/monitoring using Studio QB Settings (per-user, isolated).
// Injects studio token/config by patching req.query + profile before calling monitoring handler.

const { getUserFromJwt, getProfileForUserId } = require('../../lib/supabase');
const { readStudioQbSettings } = require('../../lib/studio_quickbase');
const monitoringHandler = require('../quickbase/monitoring');

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function parseQbUrl(url) {
  const out = { realm: '', tableId: '', qid: '' };
  if (!url) return out;
  try {
    const u = new URL(url);
    const host = String(u.hostname || '').toLowerCase();
    const m = host.match(/^([a-z0-9-]+)\.quickbase\.com$/i);
    if (m) out.realm = m[1];
    const segs = u.pathname.split('/').filter(Boolean);
    const ti = segs.indexOf('table');
    if (ti >= 0 && segs[ti + 1]) out.tableId = segs[ti + 1];
    if (!out.tableId) {
      const di = segs.indexOf('db');
      if (di >= 0 && segs[di + 1]) out.tableId = segs[di + 1];
    }
    const rawQid = u.searchParams.get('qid') || '';
    const qm = rawQid.match(/-?\d+/);
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
    const jwt = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const user = await getUserFromJwt(jwt);
    if (!user) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    const studioOut = await readStudioQbSettings(user.id);
    const s = (studioOut.ok && studioOut.settings) ? studioOut.settings : {};

    let studioToken   = String(s.qbToken   || '').trim();
    let studioRealm   = String(s.realm     || '').trim();
    let studioTableId = String(s.tableId   || '').trim();
    let studioQid     = String(s.qid       || '').trim();
    const reportLink  = String(s.reportLink || '').trim();

    // Derive from reportLink when stored fields are empty
    if (reportLink && (!studioRealm || !studioTableId || !studioQid)) {
      const parsed = parseQbUrl(reportLink);
      if (!studioRealm   && parsed.realm)   studioRealm   = parsed.realm;
      if (!studioTableId && parsed.tableId) studioTableId = parsed.tableId;
      if (!studioQid     && parsed.qid)     studioQid     = parsed.qid;
    }

    if (!studioToken || !studioRealm || !studioTableId || !studioQid) {
      return sendJson(res, 200, {
        ok: true, columns: [], records: [], allAvailableFields: [],
        warning: 'studio_qb_not_configured',
        message: 'Studio QB not configured. Go to General Settings → Studio Quickbase Settings.',
      });
    }

    // Override request query with Studio QB params
    // Preserve all incoming params (search, searchFields, limit, skip, where, etc.)
    // When search term present: increase limit so QB searches across all records
    var incomingQuery = req.query || {};
    var searchTerm = String(incomingQuery.search || '').trim();
    var requestedLimit = Number(incomingQuery.limit) || 0;
    // For search requests: allow up to 10000 records (QB processes server-side)
    // For initial load: use standard 500 limit
    var effectiveLimit = searchTerm
      ? Math.min(requestedLimit || 10000, 10000)
      : Math.min(requestedLimit || 500, 500);

    req.query = Object.assign({}, incomingQuery, {
      qid:          studioQid,
      tableId:      studioTableId,
      realm:        studioRealm,
      bypassGlobal: 'true',
      limit:        String(effectiveLimit),
    });

    // Patch supabase lib temporarily so monitoring handler gets studio token in profile
    const supabaseLib = require('../../lib/supabase');
    const _origGetProfile = supabaseLib.getProfileForUserId;
    let _patched = true;

    supabaseLib.getProfileForUserId = async function patchedGet(uid) {
      const profile = await _origGetProfile(uid);
      if (profile && String(profile.user_id || profile.id || '') === String(user.id)) {
        return Object.assign({}, profile, {
          qb_token:    studioToken,
          qb_realm:    studioRealm,
          qb_table_id: studioTableId,
          qb_qid:      studioQid,
        });
      }
      return profile;
    };

    try {
      await monitoringHandler(req, res);
    } finally {
      if (_patched) {
        supabaseLib.getProfileForUserId = _origGetProfile;
      }
    }
  } catch (err) {
    console.error('[studio/qb_monitoring]', err);
    try {
      sendJson(res, 500, { ok: false, error: 'internal_error', message: String(err?.message || err) });
    } catch (_) {}
  }
};
