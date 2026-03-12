// server/routes/quickbase/assigned_to_names.js
// GET /api/quickbase/assigned_to_names
// Returns unique "Assigned To" (#13) names from the global QB report.
// SUPER_ADMIN only. Used to populate the QB Name dropdown in User Management.
// This route uses the GLOBAL QB token + config — not the user's own settings.

const { getUserFromJwt, getProfileForUserId, serviceSelect, serviceUpsert } = require('../../lib/supabase');
const { readGlobalQuickbaseSettings } = require('../../lib/global_quickbase');
const { queryQuickbaseRecords, listQuickbaseFields } = require('../../lib/quickbase');

const ASSIGNED_TO_FIELD_ID = 13; // Quickbase standard field
const NAMES_CACHE_KEY = 'mums_global_qb_assigned_to_names';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min in-memory

let _memCache = null;
let _memCacheAt = 0;

function sendJson(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function isSuperAdmin(profile) {
  return String((profile && profile.role) || '').trim().toUpperCase().replace(/\s+/g, '_') === 'SUPER_ADMIN';
}

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const auth = req.headers.authorization || '';
    const jwt = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const user = await getUserFromJwt(jwt);
    if (!user) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    const profile = await getProfileForUserId(user.id);
    if (!isSuperAdmin(profile)) return sendJson(res, 403, { ok: false, error: 'forbidden', message: 'Super Admin only.' });

    // Return memory cache if fresh (with sanitization guard)
    if (_memCache && (Date.now() - _memCacheAt) < CACHE_TTL_MS) {
      const sanitizedCache = _memCache.filter(n => typeof n === 'string' && n.trim() && n !== '[object Object]');
      return sendJson(res, 200, { ok: true, names: sanitizedCache, cached: true });
    }

    // Load persisted names from mums_documents (always returned even if QB fetch fails)
    let persistedNames = [];
    try {
      const dbOut = await serviceSelect('mums_documents', `select=value&key=eq.${encodeURIComponent(NAMES_CACHE_KEY)}&limit=1`);
      if (dbOut.ok && Array.isArray(dbOut.json) && dbOut.json[0] && Array.isArray(dbOut.json[0].value)) {
        // Sanitize: only keep plain non-empty strings (guards against old [object Object] cache entries)
        persistedNames = dbOut.json[0].value
          .filter(n => typeof n === 'string' && n.trim() && n !== '[object Object]')
          .map(n => n.trim());
      }
    } catch (_) {}

    // Get global QB settings
    const globalOut = await readGlobalQuickbaseSettings();
    if (!globalOut.ok || !globalOut.settings || !globalOut.settings.qbToken || !globalOut.settings.realm || !globalOut.settings.tableId) {
      // Return persisted names if QB not configured
      return sendJson(res, 200, { ok: true, names: persistedNames, warning: 'global_qb_not_configured' });
    }

    const { qbToken, realm, tableId, qid } = globalOut.settings;

    // Fetch ALL records from QB (no user filter) using the assigned to field only
    // We use a high limit to get all assignee names across all cases
    const config = { qb_token: qbToken, qb_realm: realm, qb_table_id: tableId, qb_qid: qid };

    let fieldMapOut = null;
    try {
      fieldMapOut = await listQuickbaseFields({ config });
    } catch (_) {}

    // Find the actual Assigned To field ID (may differ from 13 if labels are different)
    let assignedToFid = ASSIGNED_TO_FIELD_ID;
    if (fieldMapOut && fieldMapOut.ok && Array.isArray(fieldMapOut.fields)) {
      const f = fieldMapOut.fields.find(x =>
        String(x.label || '').toLowerCase().includes('assigned to') ||
        Number(x.id) === ASSIGNED_TO_FIELD_ID
      );
      if (f) assignedToFid = Number(f.id);
    }

    // Query QB — select only the Assigned To field, high limit
    const out = await queryQuickbaseRecords({
      config,
      where: null, // No filter — get ALL names
      select: [assignedToFid],
      limit: 1000,
      allowEmptySelect: false,
      enableQueryIdFallback: !!qid
    });

    if (!out.ok) {
      // Return persisted names on error
      return sendJson(res, 200, { ok: true, names: persistedNames, warning: 'qb_fetch_failed', message: out.message });
    }

    // Extract unique names
    // FIX: Use mappedRecords (not raw records). QB "Assigned To" is a User-type field
    // that returns nested objects: { value: { id, name, email } }.
    // queryQuickbaseRecords().mappedRecords already runs normalizeQuickbaseCellValue()
    // on every cell, resolving nested User objects to plain strings.
    // Using raw out.records + String(cell.value) produced "[object Object]" in the dropdown.
    const namesSet = new Set(persistedNames); // always keep persisted names
    const sourceRecords = Array.isArray(out.mappedRecords) ? out.mappedRecords : [];
    sourceRecords.forEach(row => {
      if (!row) return;
      const val = String(row[String(assignedToFid)] || row[assignedToFid] || '').trim();
      if (val) namesSet.add(val);
    });

    const sorted = Array.from(namesSet).filter(Boolean).sort((a, b) => a.localeCompare(b));

    // Persist to mums_documents so names survive even when cases are closed
    try {
      const nowIso = new Date().toISOString();
      await serviceUpsert('mums_documents', [{
        key: NAMES_CACHE_KEY,
        value: sorted,
        updated_at: nowIso,
        updated_by_user_id: user.id,
        updated_by_name: profile.name || profile.username,
        updated_by_client_id: null
      }], 'key');
    } catch (_) {}

    // Update memory cache
    _memCache = sorted;
    _memCacheAt = Date.now();

    return sendJson(res, 200, { ok: true, names: sorted });
  } catch (err) {
    console.error('[assigned_to_names]', err);
    return sendJson(res, 500, { ok: false, error: 'internal_error', message: String(err.message || err) });
  }
};
