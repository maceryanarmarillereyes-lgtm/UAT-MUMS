// server/routes/studio/cache_bundle.js
// GET /api/studio/cache_bundle?bundle=connect_plus|catalog|qb_schema
//
// Downloads the full data for a cacheable bundle.
// Called ONLY during cache sync — not on every page load.
// This is the heavy endpoint; cache_manifest is the lightweight one.

const { getUserFromJwt }       = require('../../lib/supabase');
const { serviceSelect }        = require('../../lib/supabase');
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
    const records = [];
    for (let i = 1; i < parsed.length; i++) {
      const r = parsed[i];
      if (!r || !r[0] || !String(r[0]).trim()) continue;
      records.push({
        site:      String(r[0] || '').trim(),
        directory: String(r[1] || '').trim(),
        address1:  String(r[2] || '').trim(),
        country:   String(r[3] || '').trim(),
        city:      String(r[4] || '').trim(),
        state:     String(r[5] || '').trim(),
        zip:       String(r[6] || '').trim(),
        timezone:  String(r[7] || '').trim(),
        systems:   String(r[8] || '').trim(),
        url:       String(r[9] || '').trim(),
        _search:   [r[0],r[1],r[2],r[3],r[4],r[5],r[6],r[7],r[9]].join(' ').toLowerCase(),
      });
    }

    const hash = simpleHash(String(records.length) + ':' + String(header.join(',')));

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

// ── Main handler ──────────────────────────────────────────────────────
module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');

    const auth = req.headers.authorization || '';
    const jwt  = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const user = await getUserFromJwt(jwt);
    if (!user) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    const bundleId = String(req.query && req.query.bundle || '').trim();

    if (!['connect_plus', 'catalog', 'qb_schema'].includes(bundleId)) {
      return sendJson(res, 400, { ok: false, error: 'invalid_bundle', message: 'bundle must be connect_plus|catalog|qb_schema' });
    }

    let result;
    if (bundleId === 'connect_plus') result = await fetchConnectPlus();
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
