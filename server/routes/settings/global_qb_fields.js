/**
 * @file global_qb_fields.js
 * @description Global Qb Fields module
 * @module MUMS/MUMS
 * @version UAT
 */
// server/routes/settings/global_qb_fields.js
// GET /api/settings/global_qb_fields[?forceRefresh=1]
//
// Returns the full QB field list using the GLOBAL QB Settings
// (realm / tableId / qbToken stored by Super Admin in Global Quickbase Settings).
//
// Used exclusively by Global Dashboard Counters settings UI to power
// the field-picker dropdowns — same UX as My Quickbase → Dashboard Counters tab.
//
// ISOLATED from studio/qb_fields (which uses Studio QB, not Global QB).
// Does NOT affect any other feature, route, or realtime logic.

const { getUserFromJwt }                = require('../../lib/supabase');
const { readGlobalQuickbaseSettings }   = require('../../lib/global_quickbase');

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

// 5-minute in-process cache — keyed by realm:tableId
// Avoids hammering QB API every time admin opens the settings panel
const FIELDS_CACHE  = new Map();
const FIELDS_TTL_MS = 5 * 60 * 1000;

async function fetchFieldsFromQB({ realm, token, tableId }) {
  const cacheKey = `global_qbfields:${realm}:${tableId}`;
  const hit      = FIELDS_CACHE.get(cacheKey);
  if (hit && (Date.now() - hit.at) < FIELDS_TTL_MS) return hit.fields;

  const resp = await fetch(
    `https://api.quickbase.com/v1/fields?tableId=${encodeURIComponent(tableId)}`,
    {
      method : 'GET',
      headers: {
        'QB-Realm-Hostname': realm,
        'Authorization'    : `QB-USER-TOKEN ${token}`,
        'Content-Type'     : 'application/json',
      },
    }
  );

  if (!resp.ok) {
    const msg = await resp.text().catch(() => '');
    throw new Error(`QB fields API error ${resp.status}: ${msg.slice(0, 200)}`);
  }

  let arr = [];
  try { arr = await resp.json(); } catch (_) { arr = []; }
  if (!Array.isArray(arr)) arr = arr.fields || [];

  const fields = arr
    .map(f => ({
      id   : Number(f.id),
      label: String(f.label || f.name || '').trim(),
      type : String(f.fieldType || f.type || '').toLowerCase(),
    }))
    .filter(f => Number.isFinite(f.id) && f.label)
    .sort((a, b) => a.label.localeCompare(b.label));

  FIELDS_CACHE.set(cacheKey, { at: Date.now(), fields });
  return fields;
}

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');

    // ── Auth (any authenticated user can read field list for UI) ──────────────
    const auth = req.headers.authorization || '';
    const jwt  = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const user = await getUserFromJwt(jwt);
    if (!user) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    // ── Load GLOBAL QB settings (realm / tableId / qbToken) ──────────────────
    const out = await readGlobalQuickbaseSettings();
    if (!out.ok) return sendJson(res, 500, { ok: false, error: 'settings_read_failed' });

    const s       = out.settings || {};
    const realm   = normalizeRealm(s.realm);
    const tableId = String(s.tableId || '').trim();
    const token   = String(s.qbToken  || '').trim();

    if (!realm || !tableId || !token) {
      return sendJson(res, 200, {
        ok     : true,
        fields : [],
        total  : 0,
        warning: 'global_qb_not_configured',
        message: 'Global Quickbase is not configured. Go to Settings → Global Quickbase.',
      });
    }

    // Optional forceRefresh busts the server-side cache
    const forceRefresh = String((req.query && req.query.forceRefresh) || '').trim() === '1';
    if (forceRefresh) {
      FIELDS_CACHE.delete(`global_qbfields:${realm}:${tableId}`);
    }

    const fields = await fetchFieldsFromQB({ realm, token, tableId });

    return sendJson(res, 200, {
      ok    : true,
      fields,
      total : fields.length,
    });

  } catch (err) {
    console.error('[settings/global_qb_fields]', err);
    return sendJson(res, 500, { ok: false, error: 'internal_error', message: String(err && err.message || err) });
  }
};
