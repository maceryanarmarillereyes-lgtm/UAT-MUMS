/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */


// server/routes/studio/qb_data.js
// GET /api/studio/qb_data — fetch Quickbase records using STUDIO QB settings
// Completely isolated from /api/quickbase/monitoring and global QB settings.
// Uses the requesting user's own Studio QB Settings stored in mums_documents.

const { getUserFromJwt, getProfileForUserId } = require('../../lib/supabase');
const { readStudioQbSettings } = require('../../lib/studio_quickbase');
const { queryQuickbaseRecords, listQuickbaseFields, normalizeQuickbaseCellValue } = require('../../lib/quickbase');

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

const REPORT_CACHE = new Map();
const FIELDS_CACHE = new Map();
const CACHE_TTL_MS = 30 * 1000;

function readCache(cache, key) {
  const hit = cache.get(key);
  if (!hit || (Date.now() - hit.at) > CACHE_TTL_MS) { cache.delete(key); return null; }
  return hit.value;
}
function writeCache(cache, key, value) { cache.set(key, { at: Date.now(), value }); }

function normalizeRealm(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  return (s.includes('.')) ? s : `${s}.quickbase.com`;
}

async function runQBReport({ realm, token, tableId, reportId, limit, extraWhere }) {
  const cacheKey = `${realm}:${tableId}:${reportId}:${limit}:${extraWhere || ''}`;
  const cached = readCache(REPORT_CACHE, cacheKey);
  if (cached) return cached;

  const url = `https://api.quickbase.com/v1/reports/${encodeURIComponent(reportId)}/run?tableId=${encodeURIComponent(tableId)}&skip=0&top=${Math.min(Number(limit) || 500, 1000)}`;
  const body = extraWhere ? { where: extraWhere } : {};
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'QB-Realm-Hostname': realm,
        Authorization: `QB-USER-TOKEN ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const rawText = await resp.text();
    let json; try { json = rawText ? JSON.parse(rawText) : {}; } catch (_) { json = {}; }
    if (!resp.ok) return { ok: false, status: resp.status, message: json?.message || 'Report run failed' };
    const records = Array.isArray(json.data) ? json.data : [];
    const fields = Array.isArray(json.fields)
      ? json.fields.map(f => ({ id: Number(f.id), label: String(f.label || '') })).filter(f => Number.isFinite(f.id))
      : [];
    const result = { ok: true, records, fields };
    writeCache(REPORT_CACHE, cacheKey, result);
    return result;
  } catch (err) {
    return { ok: false, status: 500, message: String(err?.message || err) };
  }
}

async function getFields({ realm, token, tableId }) {
  const cacheKey = `${realm}:${tableId}`;
  const cached = readCache(FIELDS_CACHE, cacheKey);
  if (cached) return cached;
  try {
    const out = await listQuickbaseFields({ config: { qb_realm: realm, qb_token: token, qb_table_id: tableId } });
    if (out && out.ok) writeCache(FIELDS_CACHE, cacheKey, out);
    return out;
  } catch (_) { return { ok: false, fields: [] }; }
}

function encLit(v) { return String(v == null ? '' : v).replace(/'/g, "\\'"); }
function buildSearchClause(term, fieldIds) {
  if (!term || !fieldIds.length) return '';
  const clauses = fieldIds.filter(n => Number.isFinite(n)).map(f => `{${f}.CT.'${encLit(term)}'}`);
  return clauses.length === 1 ? clauses[0] : `(${clauses.join(' OR ')})`;
}

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const auth = req.headers.authorization || '';
    const jwt = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const user = await getUserFromJwt(jwt);
    if (!user) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    // Load this user's Studio QB settings
    const settingsOut = await readStudioQbSettings(user.id);
    if (!settingsOut.ok) return sendJson(res, 500, { ok: false, error: 'settings_read_failed' });

    const s = settingsOut.settings;
    const realm = normalizeRealm(s.realm);
    const tableId = String(s.tableId || '').trim();
    const qid = String(s.qid || '').trim();
    const token = String(s.qbToken || '').trim();

    if (!realm || !tableId || !qid || !token) {
      return sendJson(res, 200, {
        ok: true, columns: [], records: [], allAvailableFields: [],
        warning: 'studio_qb_not_configured',
        message: 'Studio Quickbase is not configured. Go to General Settings → Studio Quickbase Settings to set up.',
      });
    }

    const query = req.query || {};
    const searchTerm = String(query.search || '').trim();

    // ── SINGLE RECORD FETCH (for Support Records case detail) ─────────────────
    // When ?recordId=461023 is passed, fetch ALL fields for that specific record
    // This gives the Support Records detail modal full QB data (assign, contact, age, notes, etc.)
    const recordIdParam = String(query.recordId || '').trim();
    if (recordIdParam) {
      // Get all available fields so we return EVERY column
      const fieldsOut = await getFields({ realm, token, tableId });
      const allFields = fieldsOut.ok
        ? (fieldsOut.fields || []).map(f => ({ id: Number(f?.id), label: String(f?.label || '').trim() })).filter(f => Number.isFinite(f.id) && f.label)
        : [];

      // Find likely Case # field IDs, from strict→loose matches.
      // Some QuickBase_S tables use labels like:
      // - "Case #"
      // - "Case Number"
      // - "Case No"
      // - "Case ID"
      const caseFieldCandidates = [];
      const addCaseCandidate = (id) => {
        const n = Number(id);
        if (Number.isFinite(n) && !caseFieldCandidates.includes(n)) caseFieldCandidates.push(n);
      };
      allFields.forEach((f) => {
        const label = String(f.label || '').trim().toLowerCase();
        if (!label) return;
        if (label === 'case #' || label === 'case number' || label === 'case no' || label === 'case id') addCaseCandidate(f.id);
      });
      allFields.forEach((f) => {
        const label = String(f.label || '').trim().toLowerCase();
        if (!label) return;
        if (label.includes('case #') || label.includes('case number') || label.includes('case no') || label.includes('case id')) addCaseCandidate(f.id);
      });
      allFields.forEach((f) => {
        const label = String(f.label || '').trim().toLowerCase();
        if (!label) return;
        if (label === 'case' || label.includes('case')) addCaseCandidate(f.id);
      });
      addCaseCandidate(3); // hard fallback (Record ID# or common case id field in many QB tables)

      const selectIds = allFields.map(f => f.id).filter(id => Number.isFinite(id));
      const safeSelectIds = selectIds.length ? selectIds : undefined;

      const url = `https://api.quickbase.com/v1/records/query`;
      try {
        // Try candidate case fields in order; stop at first hit.
        let json = null;
        let hitFieldId = null;
        for (const caseFieldId of caseFieldCandidates) {
          const whereClause = `{${caseFieldId}.EX.'${encLit(recordIdParam)}'}`;
          const body = { from: tableId, where: whereClause, options: { top: 1 } };
          if (safeSelectIds) body.select = safeSelectIds;

          const resp = await fetch(url, {
            method: 'POST',
            headers: { 'QB-Realm-Hostname': realm, Authorization: `QB-USER-TOKEN ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          const out = await resp.json().catch(() => ({}));
          if (!resp.ok) continue;
          if (Array.isArray(out.data) && out.data.length) {
            json = out;
            hitFieldId = caseFieldId;
            break;
          }
        }

        if (!json || !Array.isArray(json.data) || !json.data.length) {
          return sendJson(res, 404, {
            ok: false,
            error: 'record_not_found',
            message: `Case #${recordIdParam} not found`,
            debug: { triedCaseFieldIds: caseFieldCandidates },
          });
        }
        const row      = json.data[0];
        const fields   = Array.isArray(json.fields) ? json.fields : [];

        // ── QB value normalizer — handles all QB REST field types ─────────
        // QB REST API returns complex objects for many field types:
        //   User field:        { id: 49742, name: "Mace Ryan Reyes", email: "..." }
        //   Multi-user:        [{ id:.., name:.. }, ...]
        //   File attachment:   { url: "..", versions: [...] }
        //   Lookup/relation:   { value: "text" } or just the raw value
        // Using String() on these returns "[object Object]" — must extract .name
        function normalizeQbValue(raw) {
          if (raw == null || raw === '') return '';
          // User / lookup object: extract name first, then other text fields
          if (typeof raw === 'object' && !Array.isArray(raw)) {
            // File attachment — return URL
            if (raw.url) return String(raw.url);
            // User/staff record object
            if (raw.name) return String(raw.name);
            if (raw.userName) return String(raw.userName);
            if (raw.label)    return String(raw.label);
            if (raw.text)     return String(raw.text);
            // Nested value wrapper
            if (raw.value != null) return normalizeQbValue(raw.value);
            // Numeric id only (e.g. related record) — return as-is
            if (raw.id != null) return String(raw.id);
            return '';
          }
          // Array of values or user objects
          if (Array.isArray(raw)) {
            return raw.map(x => {
              if (x && typeof x === 'object') return x.name || x.label || x.value || x.id || '';
              return String(x || '');
            }).filter(Boolean).join(', ');
          }
          return String(raw);
        }

        // Build columnMap: fieldId → label
        const columnMap = {};
        const fieldValues = {};
        // Track relationship fields whose value is a bare numeric ID — need secondary lookup
        const relationshipPending = []; // { fid, numericId }

        fields.forEach(f => {
          const fid   = String(f.id);
          const label = String(f.label || f.name || '');
          columnMap[fid] = label;
          const cell = row[fid];
          const raw  = (cell && typeof cell === 'object' && 'value' in cell) ? cell.value : cell;
          const resolved = normalizeQbValue(raw);
          fieldValues[fid] = { value: resolved };

          // Detect QB relationship fields: label contains 'contact' and value is pure digits
          // QB returns bare numeric record IDs for relationship/lookup fields
          const labelLow = label.toLowerCase();
          const isRelField = labelLow.includes('contact') || labelLow.includes('related employee') || labelLow.includes('assigned to');
          if (isRelField && resolved && /^\d+$/.test(resolved)) {
            relationshipPending.push({ fid, numericId: resolved, label });
          }
        });

        // ── Secondary lookup: resolve bare numeric relationship IDs to names ──
        // For each pending relationship field, query field 6 (Name) of the related record
        if (relationshipPending.length > 0) {
          const resolvePromises = relationshipPending.map(async ({ fid, numericId, label }) => {
            try {
              // QB field 3 = Record ID#, field 6 = Full Name (standard QB contact table)
              const relUrl = `https://api.quickbase.com/v1/records/query`;
              const relBody = {
                from: tableId,
                select: [3, 6, 7], // Record ID, Name/Full Name, common name fields
                where: `{3.EX.'${encLit(numericId)}'}`,
                options: { top: 1 },
              };
              const relResp = await fetch(relUrl, {
                method: 'POST',
                headers: {
                  'QB-Realm-Hostname': realm,
                  Authorization: `QB-USER-TOKEN ${token}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(relBody),
              });
              if (!relResp.ok) return;
              const relJson = await relResp.json().catch(() => ({}));
              if (!Array.isArray(relJson.data) || !relJson.data.length) return;

              const relRow = relJson.data[0];
              // Try field 6 (Full Name), then 7, then any non-ID string value
              let resolvedName = '';
              const relFields = Array.isArray(relJson.fields) ? relJson.fields : [];
              for (const rf of relFields) {
                const rfid = String(rf.id);
                if (rfid === '3') continue; // skip Record ID#
                const rcell = relRow[rfid];
                const rraw = (rcell && typeof rcell === 'object' && 'value' in rcell) ? rcell.value : rcell;
                const rval = normalizeQbValue(rraw);
                if (rval && !/^\d+$/.test(rval)) { resolvedName = rval; break; }
              }
              if (resolvedName) {
                fieldValues[fid] = { value: resolvedName };
                console.log(`[qb_data] Resolved relationship field "${label}" (fid:${fid}): ${numericId} → "${resolvedName}"`);
              }
            } catch (relErr) {
              console.warn(`[qb_data] Secondary lookup failed for fid ${fid} id ${numericId}:`, relErr.message);
            }
          });
          await Promise.all(resolvePromises);
        }

        return sendJson(res, 200, {
          ok: true,
          recordId: recordIdParam,
          fields: fieldValues,
          columnMap,
          matchedCaseFieldId: hitFieldId,
        });
      } catch (fetchErr) {
        console.error('[qb_data] single record fetch error:', fetchErr);
        return sendJson(res, 500, { ok: false, error: 'fetch_error', message: String(fetchErr?.message || fetchErr) });
      }
    }
    const limit = Number(query.limit) || 500;
    const forceRefresh = String(query.forceRefresh || '').trim() === '1';

    // Get all available fields for column mapping
    const fieldsOut = await getFields({ realm, token, tableId });
    const allAvailableFields = fieldsOut.ok
      ? (fieldsOut.fields || []).map(f => ({ id: Number(f?.id), label: String(f?.label || '').trim() }))
          .filter(f => Number.isFinite(f.id) && f.label)
          .sort((a, b) => a.label.localeCompare(b.label))
      : [];

    // Build search clause if searching
    const searchFieldIds = allAvailableFields.slice(0, 20).map(f => f.id);
    const searchClause = searchTerm ? buildSearchClause(searchTerm, searchFieldIds) : '';

    // Run the report (uses QB's own filters, sorting, columns)
    const runOut = await runQBReport({
      realm,
      token,
      tableId,
      reportId: qid,
      limit,
      extraWhere: searchClause || undefined,
    });

    if (!runOut.ok) {
      return sendJson(res, runOut.status || 500, {
        ok: false,
        error: 'qb_run_failed',
        message: runOut.message || 'Failed to run report. Check Studio QB Settings (realm, token, QID).',
      });
    }

    // Column resolution: use report fields (or customColumns if set)
    const reportFields = Array.isArray(runOut.fields) && runOut.fields.length
      ? runOut.fields
      : allAvailableFields.slice(0, 15);

    const customCols = Array.isArray(s.customColumns) && s.customColumns.length
      ? s.customColumns.map(id => {
          const found = allAvailableFields.find(f => f.id === Number(id));
          return found || null;
        }).filter(Boolean)
      : null;

    const effectiveFields = customCols && customCols.length ? customCols : reportFields;

    // Find Case # field for record ID
    const caseFieldId = allAvailableFields.find(f => f.label.toLowerCase().includes('case #'))?.id
      || allAvailableFields.find(f => f.label.toLowerCase() === 'case')?.id
      || 3;

    const columns = effectiveFields
      .filter(f => Number(f.id) !== Number(caseFieldId))
      .map(f => ({ id: String(f.id), label: String(f.label) }));

    const records = (runOut.records || []).map(row => {
      const normalized = {};
      effectiveFields.forEach(f => {
        const fid = String(f.id);
        const cell = row?.[fid];
        const raw = (cell && typeof cell === 'object' && Object.prototype.hasOwnProperty.call(cell, 'value'))
          ? cell.value : cell;
        normalized[fid] = { value: normalizeQuickbaseCellValue(raw) ?? '' };
      });
      const caseCell = row?.[String(caseFieldId)];
      const qbRecordId = (caseCell && typeof caseCell === 'object' ? caseCell.value : caseCell) || row?.recordId || 'N/A';
      return { qbRecordId: String(qbRecordId), fields: normalized };
    });

    return sendJson(res, 200, {
      ok: true,
      columns,
      records,
      allAvailableFields,
      total: records.length,
    });
  } catch (err) {
    console.error('[studio/qb_data]', err);
    return sendJson(res, 500, { ok: false, error: 'internal_error', message: String(err?.message || err) });
  }
};
