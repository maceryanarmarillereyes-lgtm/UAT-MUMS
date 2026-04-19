// server/routes/studio/qb_fields.js
// GET /api/studio/qb_fields[?forceRefresh=1]
//
// Lightweight endpoint: returns allAvailableFields from user's Studio QB settings.
// Used exclusively by the Services Page QB Lookup field picker.
// Does NOT run any QB report — only fetches field metadata (fast, cheap).
// Completely isolated from qb_data, qb_search, and global QB settings.

const { getUserFromJwt }        = require('../../lib/supabase');
const { readStudioQbSettings }  = require('../../lib/studio_quickbase');

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

// 5-minute in-process field cache — avoids hammering QB API on every picker open
const FIELDS_CACHE  = new Map();
const FIELDS_TTL_MS = 5 * 60 * 1000;

function normalizeRealm(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  return s.includes('.') ? s : `${s}.quickbase.com`;
}

async function fetchFieldsFromQB({ realm, token, tableId }) {
  const cacheKey = `qbfields:${realm}:${tableId}`;
  const hit      = FIELDS_CACHE.get(cacheKey);
  if (hit && (Date.now() - hit.at) < FIELDS_TTL_MS) return hit.fields;

  const resp = await fetch(
    `https://api.quickbase.com/v1/fields?tableId=${encodeURIComponent(tableId)}`,
    {
      method : 'GET',
      headers: {
        'QB-Realm-Hostname': realm,
        Authorization      : `QB-USER-TOKEN ${token}`,
        'Content-Type'     : 'application/json',
      },
    }
  );

  if (!resp.ok) {
    const msg = await resp.text().catch(() => '');
    throw new Error(`QB fields API error ${resp.status}: ${msg.slice(0, 120)}`);
  }

  const raw = await resp.text();
  let arr = [];
  try { arr = raw ? JSON.parse(raw) : []; } catch (_) { arr = []; }
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

    // ── Auth ──────────────────────────────────────────────────────────────────
    const auth = req.headers.authorization || '';
    const jwt  = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const user = await getUserFromJwt(jwt);
    if (!user) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    // ── Load user's Studio QB settings ────────────────────────────────────────
    const settingsOut = await readStudioQbSettings(user.id);
    if (!settingsOut.ok) return sendJson(res, 500, { ok: false, error: 'settings_read_failed' });

    const s       = settingsOut.settings || {};
    const realm   = normalizeRealm(s.realm);
    const tableId = String(s.tableId || '').trim();
    const token   = String(s.qbToken  || '').trim();

    if (!realm || !tableId || !token) {
      return sendJson(res, 200, {
        ok     : true,
        fields : [],
        total  : 0,
        warning: 'studio_qb_not_configured',
        message: 'Studio Quickbase is not configured. Go to General Settings → Studio Quickbase Settings.',
      });
    }

    // Optional forceRefresh busts the server-side cache
    const forceRefresh = String(req.query?.forceRefresh || '').trim() === '1';
    if (forceRefresh) {
      FIELDS_CACHE.delete(`qbfields:${realm}:${tableId}`);
    }

    const fields = await fetchFieldsFromQB({ realm, token, tableId });

    return sendJson(res, 200, {
      ok    : true,
      fields,
      total : fields.length,
    });

  } catch (err) {
    console.error('[studio/qb_fields]', err);
    return sendJson(res, 500, { ok: false, error: 'internal_error', message: String(err?.message || err) });
  }
};
