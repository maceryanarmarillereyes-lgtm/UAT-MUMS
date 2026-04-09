/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */


// server/routes/studio/qb_export.js
// GET /api/studio/qb_export?skip=N&top=1000
//
// Returns one page of QB records as JSON.
// Client (support_studio.html _qbsExportAll) calls this repeatedly,
// incrementing skip until fewer than top records are returned (= last page).
// This avoids server-side timeout: each call fetches exactly 1 page (~1-2s).

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

async function fetchQBPage({ realm, token, tableId, reportId, skip, top }) {
  const normRealm = normalizeRealm(realm);
  const url = `https://api.quickbase.com/v1/reports/${encodeURIComponent(reportId)}/run` +
    `?tableId=${encodeURIComponent(tableId)}&skip=${skip}&top=${top}`;

  // 25-second hard timeout per page — prevents Cloudflare 524/502 on slow QB responses
  const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => { try { ctrl.abort(); } catch(_) {} }, 25000) : null;

  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'QB-Realm-Hostname': normRealm,
        Authorization: `QB-USER-TOKEN ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
      signal: ctrl ? ctrl.signal : undefined,
    });
  } catch (fetchErr) {
    if (timer) clearTimeout(timer);
    const msg = String(fetchErr && fetchErr.name || '') === 'AbortError'
      ? 'QB API request timed out after 25s (skip=' + skip + ')'
      : String(fetchErr && fetchErr.message || fetchErr);
    throw new Error(msg);
  }
  if (timer) clearTimeout(timer);

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error('QB API ' + resp.status + ': ' + txt.slice(0, 300));
  }
  const json = await resp.json();
  return {
    records: Array.isArray(json.data) ? json.data : [],
    fields:  Array.isArray(json.fields) ? json.fields.map(f => ({ id: Number(f.id), label: String(f.label || '') })) : [],
    total:   json.metadata ? json.metadata.totalRecords : null,
  };
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
      return res.end(JSON.stringify({
        ok: false, error: 'not_configured',
        message: 'Configure Studio QB Settings in General Settings first.'
      }));
    }

    // Single-page chunk — client orchestrates pagination
    const skipN = Number(req.query && req.query.skip || 0);
    const topN  = Math.min(Number(req.query && req.query.top  || 1000), 1000);

    const page = await fetchQBPage({ realm, token, tableId, reportId: qid, skip: skipN, top: topN });

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({
      ok:      true,
      records: page.records,
      fields:  page.fields,
      total:   page.total,
      skip:    skipN,
      count:   page.records.length,
    }));

  } catch (err) {
    console.error('[studio/qb_export]', String(err));
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: false, error: 'export_failed', message: String(err && err.message || err) }));
    }
  }
};
