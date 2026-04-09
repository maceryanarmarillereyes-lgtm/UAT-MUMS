/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */


// server/routes/studio/cache_bundle.js
// GET /api/studio/cache_bundle?bundle=connect_plus|catalog|qb_schema
//
// Downloads the full data for a cacheable bundle.
// Called ONLY during cache sync — not on every page load.
// This is the heavy endpoint; cache_manifest is the lightweight one.

const { getUserFromJwt, serviceSelect, serviceUpsert } = require('../../lib/supabase');
const { readStudioQbSettings } = require('../../lib/studio_quickbase');

function sendJson(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function simpleHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
    h = h >>> 0;
  }
  return h.toString(36).padStart(6, '0');
}

function normalizeRealm(r) {
  const s = String(r || '').trim();
  return (s && !s.includes('.')) ? `${s}.quickbase.com` : s;
}

// ── Connect+ — fetch CSV from Google Sheets via server ───────────────
async function fetchConnectPlus() {
  // Read the CSV URL from the stored settings
  const out = await serviceSelect(
    'mums_documents',
    `select=key,value&key=eq.ss_connectplus_settings&limit=1`
  );
  const row    = (Array.isArray(out.json) && out.json[0]) ? out.json[0] : null;
  const stored = (row && row.value && typeof row.value === 'object') ? row.value : {};
  const csvUrl = String(stored.csvUrl || '').trim();

  if (!csvUrl) {
    return { ok: false, message: 'Connect+ CSV URL not configured. Go to General Settings → Connect+ Settings.' };
  }

  // Normalize Google Sheets URL to CSV export format
  function normalizeCsvUrl(raw) {
    if (!raw) return '';
    if (raw.includes('output=csv')) return raw;
    try {
      const u = new URL(raw);
      if (u.pathname.includes('/pub')) { u.searchParams.set('output', 'csv'); return u.toString(); }
      if (u.pathname.includes('/pubhtml')) {
        const gid = u.searchParams.get('gid') || '';
        u.pathname = u.pathname.replace('/pubhtml', '/pub');
        u.searchParams.set('output', 'csv');
        if (gid) u.searchParams.set('gid', gid);
        return u.toString();
      }
      if (u.pathname.includes('/edit') || u.pathname.includes('/view')) {
        const gid = u.searchParams.get('gid') || '0';
        const m   = u.pathname.match(/\/d\/([^/]+)\//);
        if (m) return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`;
      }
    } catch (_) {}
    return raw;
  }

  const finalUrl = normalizeCsvUrl(csvUrl);

  try {
    const resp = await fetch(finalUrl, { headers: { 'User-Agent': 'MUMS-StudioCache/1.0' } });
    if (!resp.ok) throw new Error(`CSV fetch failed: HTTP ${resp.status}`);
    const text = await resp.text();

    // Parse CSV
    function parseCsv(raw) {
      const rows = []; let cur = ''; let inQ = false;
      for (let i = 0; i < raw.length; i++) {
        const c = raw[i];
        if (c === '"') { inQ = !inQ; cur += c; }
        else if (c === '\n' && !inQ) { rows.push(cur); cur = ''; }
        else if (c === '\r' && !inQ) {}
        else cur += c;
      }
      if (cur.trim()) rows.push(cur);

      return rows.map(function(row) {
        const fields = []; let f = ''; let q = false;
        for (let j = 0; j < row.length; j++) {
          const ch = row[j];
          if (ch === '"') {
            if (q && row[j+1] === '"') { f += '"'; j++; }
            else q = !q;
          } else if (ch === ',' && !q) { fields.push(f); f = ''; }
          else f += ch;
        }
        fields.push(f);
        return fields.map(v => v.replace(/^"|"$/g, '').trim());
      });
    }

    const parsed = parseCsv(text);
    if (!parsed.length) throw new Error('Empty CSV response');

    const header = parsed[0];
    const normHeader = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const findHeaderIndex = (aliases, fallbackIndex = -1) => {
      const aliasSet = aliases.map(normHeader);
      for (let i = 0; i < header.length; i++) {
        if (aliasSet.includes(normHeader(header[i]))) return i;
      }
      return fallbackIndex;
    };

    // Header-based map so Connect+ cache bundle stays aligned with
    // Connect+ Settings detected columns (column order can change).
    const colIdx = {
      site:      findHeaderIndex(['site'], 0),
      directory: findHeaderIndex(['directory'], 1),
      address1:  findHeaderIndex(['address 1', 'address1', 'address'], 2),
      country:   findHeaderIndex(['country'], 3),
      city:      findHeaderIndex(['city'], 4),
      state:     findHeaderIndex(['state/province/region', 'state province region', 'state', 'province', 'region'], 5),
      zip:       findHeaderIndex(['zip/postal code', 'zip postal code', 'zip', 'postal code', 'postal'], 6),
      timezone:  findHeaderIndex(['time zone', 'timezone'], 7),
      systems:   findHeaderIndex(['number of control systems', 'control systems', 'systems'], 8),
      url:       findHeaderIndex(['url connect+ link', 'url connect link', 'connect+ link', 'connect link', 'url'], 9),
      endUser:   findHeaderIndex(['end user', 'enduser', 'client', 'account', 'customer'], 10),
      endUser2:  findHeaderIndex(['end user2', 'enduser2', 'client 2', 'account 2', 'customer 2'], 11),
    };

    const records = [];
    for (let i = 1; i < parsed.length; i++) {
      const r = parsed[i];
      if (!r || !String(r[colIdx.site] || '').trim()) continue;

      let endUser = '';
      [colIdx.endUser, colIdx.endUser2].forEach((euIdx) => {
        if (endUser || typeof euIdx !== 'number' || euIdx < 0) return;
        const euVal = String(r[euIdx] || '').trim();
        if (euVal) endUser = euVal;
      });

      records.push({
        site:      String(r[colIdx.site] || '').trim(),
        directory: String(r[colIdx.directory] || '').trim(),
        address1:  String(r[colIdx.address1] || '').trim(),
        country:   String(r[colIdx.country] || '').trim(),
        city:      String(r[colIdx.city] || '').trim(),
        state:     String(r[colIdx.state] || '').trim(),
        zip:       String(r[colIdx.zip] || '').trim(),
        timezone:  String(r[colIdx.timezone] || '').trim(),
        systems:   String(r[colIdx.systems] || '').trim(),
        url:       String(r[colIdx.url] || '').trim(),
        endUser:   endUser,
        _search:   [
          r[colIdx.site], r[colIdx.directory], r[colIdx.address1], r[colIdx.country],
          r[colIdx.city], r[colIdx.state], r[colIdx.zip], r[colIdx.timezone],
          r[colIdx.systems], r[colIdx.url], endUser
        ].join(' ').toLowerCase(),
      });
    }

    const hash = simpleHash(String(records.length) + ':' + String(header.join(',')));

    // ── Write version document so cache_manifest can detect future changes ──
    const nowIso = new Date().toISOString();
    const versionDoc = {
      key:        'ss_connectplus_cache_version',
      value:      { hash, count: records.length, isCritical: false, updatedAt: nowIso },
      updated_at: nowIso,
      updated_by_user_id: null,
      updated_by_name:    'system',
      updated_by_client_id: null,
    };
    serviceUpsert('mums_documents', [versionDoc], 'key').catch(() => {});

    return { ok: true, records: records, count: records.length, hash: hash, header: header };
  } catch (err) {
    return { ok: false, message: String(err.message || err) };
  }
}

// ── Catalog — full items from support_catalog ────────────────────────
async function fetchCatalog() {
  const out = await serviceSelect(
    'support_catalog',
    'select=id,item_code,name,category,brand,part_number,specs,user_guide,troubleshooting,compatible_units,status,parent_id,assigned_to,assigned_to_name,created_at,updated_at&order=item_code.asc'
  );
  if (!out.ok) return { ok: false, message: 'DB error fetching catalog' };

  const items = Array.isArray(out.json) ? out.json : [];
  const latestDate = items.reduce((mx, i) => i.updated_at > mx ? i.updated_at : mx, '');
  const hash = simpleHash(`${items.length}:${latestDate}`);

  return { ok: true, records: items, count: items.length, hash: hash };
}

// ── QB Schema — field definitions only ──────────────────────────────
async function fetchQbSchema(userId) {
  const studioOut = await readStudioQbSettings(userId).catch(() => ({ ok: false }));
  const s = (studioOut.ok && studioOut.settings) ? studioOut.settings : {};

  const realm   = String(s.realm   || '').trim();
  const tableId = String(s.tableId || '').trim();
  const token   = String(s.qbToken || '').trim();

  if (!realm || !tableId || !token) {
    return { ok: false, message: 'Studio QB not configured. Go to General Settings → Studio Quickbase Settings.' };
  }

  try {
    const normRealm = normalizeRealm(realm);
    const resp = await fetch(
      `https://api.quickbase.com/v1/fields?tableId=${encodeURIComponent(tableId)}`,
      {
        method: 'GET',
        headers: {
          'QB-Realm-Hostname': normRealm,
          Authorization: `QB-USER-TOKEN ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      return { ok: false, message: `QB API ${resp.status}: ${txt.slice(0, 100)}` };
    }

    const raw    = await resp.json();
    const fields = Array.isArray(raw) ? raw : (raw.fields || []);
    const schema = fields.map(f => ({
      id:    Number(f.id),
      label: String(f.label || f.name || ''),
      type:  String(f.fieldType || f.type || ''),
    })).filter(f => Number.isFinite(f.id) && f.label);

    const ids  = schema.map(f => f.id).sort().join(',');
    const hash = simpleHash(`${schema.length}:${ids}`);

    return { ok: true, schema: schema, count: schema.length, hash: hash };
  } catch (err) {
    return { ok: false, message: String(err.message || err) };
  }
}


async function fetchPartsNumber() {
  const out = await serviceSelect('mums_documents', `select=key,value&key=eq.ss_parts_number_settings&limit=1`);
  const row = (Array.isArray(out.json) && out.json[0]) ? out.json[0] : null;
  const stored = (row && row.value && typeof row.value === 'object') ? row.value : {};
  const csvUrl = String(stored.csvUrl || '').trim();

  if (!csvUrl) return { ok: false, message: 'Parts Number CSV URL not configured. Go to General Settings → Part Number Settings.' };

  function normalizeCsvUrl(raw) {
    if (!raw) return '';
    if (raw.includes('output=csv')) return raw;
    try {
      const u = new URL(raw);
      if (u.pathname.includes('/pub')) { u.searchParams.set('output', 'csv'); return u.toString(); }
      if (u.pathname.includes('/pubhtml')) {
        const gid = u.searchParams.get('gid') || '';
        u.pathname = u.pathname.replace('/pubhtml', '/pub');
        u.searchParams.set('output', 'csv');
        if (gid) u.searchParams.set('gid', gid);
        return u.toString();
      }
      if (u.pathname.includes('/edit') || u.pathname.includes('/view')) {
        const gid = u.searchParams.get('gid') || '0';
        const m = u.pathname.match(/\/d\/([^/]+)\//);
        if (m) return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`;
      }
    } catch (_) {}
    return raw;
  }

  const finalUrl = normalizeCsvUrl(csvUrl);

  try {
    const resp = await fetch(finalUrl, { headers: { 'User-Agent': 'MUMS-StudioCache/1.0' } });
    if (!resp.ok) throw new Error(`CSV fetch failed: HTTP ${resp.status}`);
    const text = await resp.text();

    function parseCsv(raw) {
      const rows = []; let cur = ''; let inQ = false;
      for (let i = 0; i < raw.length; i++) {
        const c = raw[i];
        if (c === '"') { inQ = !inQ; cur += c; }
        else if (c === '\n' && !inQ) { rows.push(cur); cur = ''; }
        else if (c === '\r' && !inQ) {}
        else cur += c;
      }
      if (cur.trim()) rows.push(cur);
      return rows.map(function(row) {
        const fields = []; let f = ''; let q = false;
        for (let j = 0; j < row.length; j++) {
          const ch = row[j];
          if (ch === '"') {
            if (q && row[j+1] === '"') { f += '"'; j++; }
            else q = !q;
          } else if (ch === ',' && !q) { fields.push(f); f = ''; }
          else f += ch;
        }
        fields.push(f);
        return fields.map(v => v.replace(/^"|"$/g, '').trim());
      });
    }

    const parsed = parseCsv(text);
    if (!parsed.length) throw new Error('Empty CSV response');

    const header = parsed[0];
    const records = [];
    for (let i = 1; i < parsed.length; i++) {
      const r = parsed[i];
      if (!r || !r[0] || !String(r[0]).trim()) continue;
      const rowObj = {};
      header.forEach((h, idx) => { rowObj[h] = String(r[idx] || '').trim(); });
      records.push(rowObj);
    }

    const hash = simpleHash(String(records.length) + ':' + String(header.join(',')));
    const nowIso = new Date().toISOString();
    const versionDoc = {
      key: 'ss_parts_number_cache_version',
      value: { hash, count: records.length, isCritical: false, updatedAt: nowIso },
      updated_at: nowIso,
      updated_by_user_id: null, updated_by_name: 'system', updated_by_client_id: null,
    };
    serviceUpsert('mums_documents', [versionDoc], 'key').catch(() => {});

    return { ok: true, records: records, count: records.length, hash: hash, header: header };
  } catch (err) { return { ok: false, message: String(err.message || err) }; }
}

// ── Main handler ──────────────────────────────────────────────────────
module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');

    const auth = req.headers.authorization || '';
    const jwt  = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const user = await getUserFromJwt(jwt);
    if (!user) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    const bundleId = String(req.query && req.query.bundle || '').trim();

    if (!['connect_plus', 'parts_number', 'catalog', 'qb_schema'].includes(bundleId)) {
      return sendJson(res, 400, { ok: false, error: 'invalid_bundle', message: 'bundle must be connect_plus|parts_number|catalog|qb_schema' });
    }

    let result;
    if (bundleId === 'connect_plus') result = await fetchConnectPlus();
    else if (bundleId === 'parts_number') result = await fetchPartsNumber();
    else if (bundleId === 'catalog')  result = await fetchCatalog();
    else if (bundleId === 'qb_schema') result = await fetchQbSchema(user.id);

    if (!result.ok) {
      return sendJson(res, 400, { ok: false, error: 'bundle_fetch_failed', message: result.message });
    }

    return sendJson(res, 200, { ok: true, bundle: bundleId, ...result });

  } catch (err) {
    console.error('[studio/cache_bundle]', err);
    return sendJson(res, 500, {
      ok: false, error: 'internal_error',
      message: String(err && err.message || err),
    });
  }
};
