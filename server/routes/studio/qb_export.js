// server/routes/studio/qb_export.js
// GET /api/studio/qb_export?format=csv|xlsx
//
// Exports ALL QB records (22,316+) to CSV or XLSX by paginating
// through the QB report in batches of 1000.
// Uses Studio QB Settings (isolated, per-user token).
//
// NOTE FOR AI: This is a streaming export — do NOT add a size limit.
// QB API supports skip+top pagination. Max per request = 1000.
// We loop until QB returns < 1000 records (last page).

const { getUserFromJwt } = require('../../lib/supabase');
const { readStudioQbSettings } = require('../../lib/studio_quickbase');

function parseQbUrl(url) {
  const out = { realm: '', tableId: '', qid: '' };
  if (!url) return out;
  try {
    const u = new URL(url);
    const m = u.hostname.match(/^([a-z0-9-]+)\.quickbase\.com$/i);
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
    if (!out.qid) { const rm = url.match(/[?&]qid=(-?\d+)/i); if (rm) out.qid = rm[1]; }
  } catch (_) {}
  return out;
}

function normalizeRealm(r) {
  const s = String(r || '').trim();
  return (s && !s.includes('.')) ? `${s}.quickbase.com` : s;
}

// Fetch one page of QB records
async function fetchQBPage({ realm, token, tableId, reportId, skip, top = 1000 }) {
  const normRealm = normalizeRealm(realm);
  const url = `https://api.quickbase.com/v1/reports/${encodeURIComponent(reportId)}/run` +
    `?tableId=${encodeURIComponent(tableId)}&skip=${skip}&top=${top}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'QB-Realm-Hostname': normRealm,
      Authorization: `QB-USER-TOKEN ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`QB API ${resp.status}: ${txt.slice(0, 200)}`);
  }
  const json = await resp.json();
  return {
    records: Array.isArray(json.data) ? json.data : [],
    fields:  Array.isArray(json.fields) ? json.fields : [],
    total:   json.metadata?.totalRecords ?? null,
  };
}

// Escape a value for CSV
function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const auth = req.headers.authorization || '';
    const jwt  = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const user = await getUserFromJwt(jwt);
    if (!user) {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
    }

    // Read Studio QB settings
    const studioOut = await readStudioQbSettings(user.id);
    const s = (studioOut.ok && studioOut.settings) ? studioOut.settings : {};
    let realm   = String(s.realm   || '').trim();
    let tableId = String(s.tableId || '').trim();
    let qid     = String(s.qid     || '').trim();
    const token = String(s.qbToken || '').trim();
    const rl    = String(s.reportLink || '').trim();

    if (rl && (!realm || !tableId || !qid)) {
      const p = parseQbUrl(rl);
      if (!realm)   realm   = p.realm;
      if (!tableId) tableId = p.tableId;
      if (!qid)     qid     = p.qid;
    }

    if (!token || !realm || !tableId || !qid) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ ok: false, error: 'not_configured', message: 'Go to General Settings → Studio Quickbase Settings and configure the QB connection first.' }));
    }

    const format = String(req.query?.format || 'csv').toLowerCase();

    // ── Fetch all pages ──────────────────────────────────────────────
    const PAGE_SIZE = 1000;
    let allRecords = [];
    let fields     = [];
    let skip       = 0;
    let pageNum    = 0;
    let hasMore    = true;
    const MAX_PAGES = 50; // safety: up to 50,000 records

    console.log(`[studio/qb_export] Starting export — realm=${realm} table=${tableId} qid=${qid}`);

    while (hasMore && pageNum < MAX_PAGES) {
      const page = await fetchQBPage({ realm, token, tableId, reportId: qid, skip, top: PAGE_SIZE });

      if (!fields.length && page.fields.length) {
        fields = page.fields; // grab field definitions from first page
      }

      allRecords = allRecords.concat(page.records);
      console.log(`[studio/qb_export] Page ${pageNum + 1}: ${page.records.length} records (total so far: ${allRecords.length})`);

      if (page.records.length < PAGE_SIZE) {
        hasMore = false; // last page
      } else {
        skip += PAGE_SIZE;
        pageNum++;
      }
    }

    console.log(`[studio/qb_export] ✅ ${allRecords.length} records fetched. Building ${format.toUpperCase()}…`);

    // ── Build column list ─────────────────────────────────────────────
    const cols = fields.map(f => ({ id: String(f.id), label: String(f.label || f.name || `Field ${f.id}`) }));

    // ── Generate CSV ──────────────────────────────────────────────────
    const headerRow = cols.map(c => csvCell(c.label)).join(',');
    const dataRows  = allRecords.map(row => {
      return cols.map(col => {
        const cell = row?.[col.id];
        const raw  = (cell && typeof cell === 'object' && Object.prototype.hasOwnProperty.call(cell, 'value'))
          ? cell.value : cell;
        return csvCell(raw);
      }).join(',');
    });

    const csvContent = [headerRow, ...dataRows].join('\r\n');
    const filename   = `quickbase_export_${new Date().toISOString().slice(0,10)}.csv`;

    if (format === 'csv') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-Record-Count', String(allRecords.length));
      // Add UTF-8 BOM so Excel opens with correct encoding
      return res.end('\uFEFF' + csvContent);
    }

    // ── Generate XLSX (manual XML-based) ─────────────────────────────
    // Build a minimal XLSX without external deps using SpreadsheetML
    const xmlRows = [
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`,
      `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"`,
      ` xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">`,
      `<Worksheet ss:Name="QB Export">`,
      `<Table>`,
      // Header row
      `<Row>` + cols.map(c => `<Cell><Data ss:Type="String">${_xlEsc(c.label)}</Data></Cell>`).join('') + `</Row>`,
      // Data rows
      ...allRecords.map(row =>
        `<Row>` + cols.map(col => {
          const cell = row?.[col.id];
          const raw  = (cell && typeof cell === 'object') ? cell.value : cell;
          const val  = raw == null ? '' : String(raw);
          const num  = !isNaN(val) && val.trim() !== '' && val.length < 15;
          return `<Cell><Data ss:Type="${num ? 'Number' : 'String'}">${_xlEsc(val)}</Data></Cell>`;
        }).join('') + `</Row>`
      ),
      `</Table></Worksheet></Workbook>`,
    ].join('\n');

    const xlsxFilename = `quickbase_export_${new Date().toISOString().slice(0,10)}.xls`;
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${xlsxFilename}"`);
    res.setHeader('X-Record-Count', String(allRecords.length));
    return res.end('\uFEFF' + xmlRows);

  } catch (err) {
    console.error('[studio/qb_export]', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: false, error: 'export_failed', message: String(err?.message || err) }));
    }
  }
};

function _xlEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ''); // strip illegal XML chars
}
