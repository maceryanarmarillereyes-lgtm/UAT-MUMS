/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

// server/routes/studio/oncall_settings.js
// GET  /api/studio/oncall_settings — read ICare Oncall Tech QB report link (global, shared)
// POST /api/studio/oncall_settings — save ICare Oncall Tech QB report link (any auth user)
// The QB token is shared from Studio QB Settings (readStudioQbSettings) — not stored separately.

const { getUserFromJwt, serviceSelect, serviceUpsert } = require('../../lib/supabase');

const DOC_KEY = 'ss_oncall_tech_settings';

function sendJson(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (req.body && typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch(_) { return {}; }
  }
  return new Promise((resolve) => {
    let d = '';
    req.on('data', c => { d += c; });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch(_) { resolve({}); } });
  });
}

function parseQbUrl(url) {
  const out = { realm: '', tableId: '', qid: '' };
  if (!url) return out;
  try {
    const u = new URL(url);
    // Realm from hostname: realm.quickbase.com
    const host = String(u.hostname || '').toLowerCase();
    const m = host.match(/^([a-z0-9-]+)\.quickbase\.com$/i);
    if (m) out.realm = m[1];

    const segs = u.pathname.split('/').filter(Boolean);

    // Primary: /table/{tableId}
    const ti = segs.findIndex(s => s.toLowerCase() === 'table');
    if (ti >= 0 && segs[ti + 1]) out.tableId = segs[ti + 1];

    // Legacy /db/{tableId}
    if (!out.tableId) {
      const di = segs.findIndex(s => s.toLowerCase() === 'db');
      if (di >= 0 && segs[di + 1]) out.tableId = segs[di + 1];
    }

    // Fallback: QB short URLs use /nav/app/{appId}/action/q — when no /table/ is present
    // the segment after /app/ may double as the tableId (single-table app or copied from nav)
    if (!out.tableId) {
      const ai = segs.findIndex(s => s.toLowerCase() === 'app');
      if (ai >= 0 && segs[ai + 1]) out.tableId = segs[ai + 1];
    }

    // QID from ?qid= param
    const rawQid = u.searchParams.get('qid') || '';
    const qm = rawQid.match(/-?\d+/);
    if (qm) out.qid = qm[0];
    if (!out.qid) {
      const rm = url.match(/[?&]qid=(-?\d+)/i);
      if (rm) out.qid = rm[1];
    }
  } catch(_) {}
  return out;
}

module.exports = async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    const jwt  = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const user = await getUserFromJwt(jwt);
    if (!user) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    // ── GET ───────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const out = await serviceSelect('mums_documents', `select=value&key=eq.${DOC_KEY}&limit=1`);
      if (!out.ok) return sendJson(res, 500, { ok: false, error: 'db_read_failed' });
      const row  = Array.isArray(out.json) && out.json[0] ? out.json[0] : null;
      const val  = (row && row.value) ? row.value : {};
      return sendJson(res, 200, { ok: true, settings: val });
    }

    // ── POST ──────────────────────────────────────────────────────────
    if (req.method === 'POST' || req.method === 'PATCH') {
      const body = await readBody(req);
      const reportLink = String(body.reportLink || '').trim();
      const parsed     = parseQbUrl(reportLink);

      const nowIso = new Date().toISOString();
      const doc = {
        key:                  DOC_KEY,
        value:                {
          reportLink,
          realm:    parsed.realm   || String(body.realm   || '').trim(),
          tableId:  parsed.tableId || String(body.tableId || '').trim(),
          qid:      parsed.qid     || String(body.qid     || '').trim(),
          updatedAt: nowIso,
        },
        updated_at:           nowIso,
        updated_by_user_id:   user.id,
      };

      const out = await serviceUpsert('mums_documents', [doc], 'key');
      if (!out.ok) return sendJson(res, 500, { ok: false, error: 'db_write_failed', detail: out.text });
      return sendJson(res, 200, { ok: true, settings: doc.value });
    }

    return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
  } catch(err) {
    console.error('[oncall_settings]', err);
    return sendJson(res, 500, { ok: false, error: 'internal_error', message: String(err.message || err) });
  }
};
