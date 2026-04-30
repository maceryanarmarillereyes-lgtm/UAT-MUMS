// server/routes/settings/global_qb_count.js
// GET /api/settings/global_qb_count?realm=&tableId=&qid=&where=
//
// Lightweight QB record COUNT for the Dashboard page counters.
// Uses Global QB Settings token (server-side) — never exposed to client.
//
// WHY NOT use /api/quickbase/monitoring?
//   The monitoring route applies a mandatory PRIVACY FILTER (Assigned-To = user's qb_name)
//   plus report-level filters. Dashboard counters need CUSTOM WHERE clauses that are
//   independent of those filters (e.g. "Type = Graphical Screen Service" across ALL users).
//   This endpoint provides a clean direct-QB count with only the caller's WHERE clause.
//
// SECURITY:
//   - Auth required (any authenticated user can read QB counts — same as monitoring)
//   - QB token is NEVER sent to client (resolved server-side from global_quickbase settings)
//   - Only count is returned — no record data leaked
//
// ISOLATED: does not touch monitoring, realtime, My Quickbase, or any other feature.

const { getUserFromJwt }              = require('../../lib/supabase');
const { readGlobalQuickbaseSettings } = require('../../lib/global_quickbase');

function sendJson(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function normalizeRealm(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  return s.includes('.') ? s : `${s}.quickbase.com`;
}

// ── QB Records query (count only) ────────────────────────────────────────────
// Uses POST /v1/records/query with numRecords:1 — QB returns totalRecords in metadata.
// This is cheap: QB executes the filter but only returns 1 row.
async function countViaQbApi({ realm, token, tableId, qid, where }) {
  const normalizedRealm = normalizeRealm(realm);
  if (!normalizedRealm || !tableId || !token) return null;

  try {
    // QB /v1/records/query: numRecords=0 skips row data but returns metadata.totalRecords
    const body = {
      from: tableId,
      where: where || undefined,
      options: { skip: 0, top: 0 },   // top=0 → metadata only, no rows
    };
    // If QID is provided, run through the report instead (applies report filters)
    // For dashboard counters we want a clean count → use records/query without qid
    const url = `https://api.quickbase.com/v1/records/query`;
    const resp = await fetch(url, {
      method : 'POST',
      headers: {
        'QB-Realm-Hostname': normalizedRealm,
        'Authorization'    : `QB-USER-TOKEN ${token}`,
        'Content-Type'     : 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      const parsed = (() => { try { return JSON.parse(txt); } catch (_) { return {}; } })();
      console.error('[global_qb_count] QB API error', resp.status, parsed.message || txt.slice(0, 120));
      return null;
    }

    const json = await resp.json();
    // QB returns metadata.totalRecords — the count we need
    if (json && json.metadata && typeof json.metadata.totalRecords === 'number') {
      return json.metadata.totalRecords;
    }
    // Fallback: count data rows if metadata missing
    if (Array.isArray(json.data)) return json.data.length;
    return 0;

  } catch (err) {
    console.error('[global_qb_count] exception:', err && err.message || err);
    return null;
  }
}

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');

    // ── Auth ─────────────────────────────────────────────────────────────────
    const auth = req.headers.authorization || '';
    const jwt  = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const user = await getUserFromJwt(jwt);
    if (!user) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    // ── Params ───────────────────────────────────────────────────────────────
    const q         = req.query || {};
    const realm     = String(q.realm   || '').trim();
    const tableId   = String(q.tableId || '').trim();
    const qid       = String(q.qid     || '').trim();
    const where     = String(q.where   || '').trim();

    // ── Resolve QB Token from Global Settings (never from client) ────────────
    const globalOut = await readGlobalQuickbaseSettings();
    if (!globalOut.ok) return sendJson(res, 500, { ok: false, error: 'settings_read_failed' });

    const gs    = globalOut.settings || {};
    const token = String(gs.qbToken || '').trim();
    // Use client-provided realm/tableId if present, fall back to global settings
    const effectiveRealm   = realm   || String(gs.realm   || '').trim();
    const effectiveTableId = tableId || String(gs.tableId || '').trim();

    if (!token) {
      return sendJson(res, 200, {
        ok: false, count: null,
        warning: 'global_qb_not_configured',
        message: 'Global QB token not set. Configure in Settings → Global Quickbase.',
      });
    }
    if (!effectiveRealm || !effectiveTableId) {
      return sendJson(res, 200, {
        ok: false, count: null,
        warning: 'missing_params',
        message: 'realm and tableId are required.',
      });
    }

    // ── Count ────────────────────────────────────────────────────────────────
    const count = await countViaQbApi({
      realm  : effectiveRealm,
      token,
      tableId: effectiveTableId,
      qid,
      where,
    });

    return sendJson(res, 200, {
      ok   : count !== null,
      count: count,
    });

  } catch (err) {
    console.error('[global_qb_count]', err);
    return sendJson(res, 500, { ok: false, error: 'internal_error', message: String(err && err.message || err) });
  }
};
