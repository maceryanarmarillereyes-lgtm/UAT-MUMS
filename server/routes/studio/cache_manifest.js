// server/routes/studio/cache_manifest.js
// GET /api/studio/cache_manifest
//
// Ultra-lightweight endpoint — called on every Support Studio page load.
// Returns version hashes + counts for each cacheable bundle.
// NEVER returns actual records — just hashes for comparison.
//
// Bundles:
//   connect_plus → hash from stored connectplus version key in mums_documents
//   catalog      → hash from COUNT(*) + MAX(updated_at) of support_catalog
//   qb_schema    → hash from QB fields API (server-cached 1h)
//
// Response size: ~300 bytes — designed to be as fast as possible.

const { getUserFromJwt }  = require('../../lib/supabase');
const { serviceSelect }   = require('../../lib/supabase');
const { readStudioQbSettings } = require('../../lib/studio_quickbase');

function sendJson(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

// ── Simple hash: base36 of a number ──────────────────────────────────
function simpleHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
    h = h >>> 0; // keep unsigned 32-bit
  }
  return h.toString(36).padStart(6, '0');
}

// ── Server-side field cache (avoid hitting QB API on every page load) ─
const _schemaCache = new Map();
const SCHEMA_CACHE_TTL = 60 * 60 * 1000; // 1 hour

function getCachedSchema(realm, token, tableId) {
  const key = `${realm}:${tableId}`;
  const hit = _schemaCache.get(key);
  if (hit && (Date.now() - hit.at) < SCHEMA_CACHE_TTL) return Promise.resolve(hit);
  return null;
}

function setCachedSchema(realm, token, tableId, data) {
  const key = `${realm}:${tableId}`;
  _schemaCache.set(key, { ...data, at: Date.now() });
}

function normalizeRealm(r) {
  const s = String(r || '').trim();
  return (s && !s.includes('.')) ? `${s}.quickbase.com` : s;
}

// ── Fetch QB schema info (field count + last modified hash) ──────────
async function getQbSchemaHash(studioSettings) {
  const { realm, tableId, qbToken } = studioSettings;
  if (!realm || !tableId || !qbToken) {
    return { hash: 'unconfigured', count: 0, isCritical: false };
  }

  const cached = getCachedSchema(realm, qbToken, tableId);
  if (cached) return cached;

  try {
    const normRealm = normalizeRealm(realm);
    const resp = await fetch(
      `https://api.quickbase.com/v1/fields?tableId=${encodeURIComponent(tableId)}`,
      {
        method: 'GET',
        headers: {
          'QB-Realm-Hostname': normRealm,
          Authorization: `QB-USER-TOKEN ${qbToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    if (!resp.ok) return { hash: 'qb_error', count: 0, isCritical: false };

    const fields = await resp.json();
    const arr    = Array.isArray(fields) ? fields : (fields.fields || []);
    const count  = arr.length;
    // Hash: field count + sorted field IDs
    const ids    = arr.map(f => Number(f.id)).sort().join(',');
    const hash   = simpleHash(`${count}:${ids}`);
    const result = { hash, count, isCritical: false, lastUpdatedAt: new Date().toISOString() };

    setCachedSchema(realm, qbToken, tableId, result);
    return result;
  } catch (_) {
    return { hash: 'qb_error', count: 0, isCritical: false };
  }
}

// ── Catalog hash from DB ──────────────────────────────────────────────
async function getCatalogHash() {
  try {
    // Get count + max updated_at in one query
    const out = await serviceSelect(
      'support_catalog',
      'select=id,updated_at&order=updated_at.desc&limit=1'
    );
    if (!out.ok || !Array.isArray(out.json)) {
      return { hash: 'db_error', count: 0, isCritical: false };
    }

    // Also get total count
    const countOut = await serviceSelect(
      'support_catalog',
      'select=id'
    );
    const count      = Array.isArray(countOut.json) ? countOut.json.length : 0;
    const latestRow  = out.json[0];
    const latestDate = latestRow ? String(latestRow.updated_at || '') : '';
    const hash       = simpleHash(`${count}:${latestDate}`);

    return {
      hash,
      count,
      isCritical: false,
      lastUpdatedAt: latestDate || null,
    };
  } catch (_) {
    return { hash: 'db_error', count: 0, isCritical: false };
  }
}

// ── Connect+ hash from stored version document ────────────────────────
async function getConnectPlusHash() {
  try {
    const out = await serviceSelect(
      'mums_documents',
      `select=key,value,updated_at&key=eq.ss_connectplus_cache_version&limit=1`
    );
    const row = (Array.isArray(out.json) && out.json[0]) ? out.json[0] : null;

    if (row && row.value) {
      const v     = row.value;
      const count = Number(v.count || 0);
      const hash  = String(v.hash || simpleHash(String(row.updated_at || '')));
      return {
        hash,
        count,
        isCritical: !!(v.isCritical),
        lastUpdatedAt: String(row.updated_at || ''),
      };
    }

    // No version document yet — generate a hash from today's date
    // This causes clients to re-download once per day at minimum
    const today = new Date().toISOString().slice(0, 10);
    return {
      hash:  simpleHash('connectplus:' + today),
      count: 0,
      isCritical: false,
      lastUpdatedAt: null,
    };
  } catch (_) {
    return { hash: 'db_error', count: 0, isCritical: false };
  }
}

// ── Main handler ──────────────────────────────────────────────────────
module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');

    const auth = req.headers.authorization || '';
    const jwt  = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const user = await getUserFromJwt(jwt);
    if (!user) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    // Read studio QB settings for schema hash (non-blocking: if missing, skip)
    const studioOut = await readStudioQbSettings(user.id).catch(() => ({ ok: false }));
    const studioSettings = (studioOut.ok && studioOut.settings) ? studioOut.settings : {};

    // All 3 hashes in parallel — fast
    const [cpHash, catHash, schHash] = await Promise.all([
      getConnectPlusHash(),
      getCatalogHash(),
      getQbSchemaHash(studioSettings),
    ]);

    return sendJson(res, 200, {
      ok:          true,
      generatedAt: new Date().toISOString(),
      bundles: {
        connect_plus: cpHash,
        catalog:      catHash,
        qb_schema:    schHash,
      },
    });

  } catch (err) {
    console.error('[studio/cache_manifest]', err);
    return sendJson(res, 500, {
      ok:    false,
      error: 'internal_error',
      message: String(err && err.message || err),
    });
  }
};
