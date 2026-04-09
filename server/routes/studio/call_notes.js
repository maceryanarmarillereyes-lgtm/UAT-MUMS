/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */


// server/routes/studio/call_notes.js
// GET /api/studio/call_notes  — load this user's call notes
// POST /api/studio/call_notes — save (replace) this user's call notes
//
// Notes are stored per-user in mums_documents with key:
//   "ss_call_notes_<user_id>"
// This ensures notes are private (only visible to the owner) and
// persist across devices / sessions (backed by Supabase).

const { getUserFromJwt, serviceSelect, serviceUpsert } = require('../../lib/supabase');

function sendJson(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function docKey(userId) {
  return `ss_call_notes_${String(userId).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

module.exports = async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    const jwt  = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const user = await getUserFromJwt(jwt);
    if (!user) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    const key = docKey(user.id);

    // ── GET: return this user's notes ────────────────────────────────
    if (req.method === 'GET') {
      const out = await serviceSelect('mums_documents',
        `select=value&key=eq.${encodeURIComponent(key)}&limit=1`);
      if (!out.ok) {
        return sendJson(res, 500, { ok: false, error: 'db_read_failed', detail: out.text || '' });
      }
      const row   = Array.isArray(out.json) && out.json[0] ? out.json[0] : null;
      const notes = (row && Array.isArray(row.value)) ? row.value : [];
      return sendJson(res, 200, { ok: true, notes });
    }

    // ── POST: upsert this user's notes ──────────────────────────────
    if (req.method === 'POST') {
      let body = {};
      if (req.body && typeof req.body === 'object') {
        body = req.body;
      } else {
        body = await new Promise((resolve) => {
          let d = '';
          req.on('data', c => d += c);
          req.on('end',  () => {
            try { resolve(d ? JSON.parse(d) : {}); }
            catch(_) { resolve({}); }
          });
        });
      }

      if (!Array.isArray(body.notes)) {
        return sendJson(res, 400, { ok: false, error: 'notes_must_be_array' });
      }

      // Keep at most 200 notes per user
      const notes = body.notes.slice(0, 200);
      const nowIso = new Date().toISOString();
      const doc = {
        key,
        value:              notes,
        updated_at:         nowIso,
        updated_by_user_id: user.id,
        updated_by_name:    user.email || '',
        updated_by_client_id: null,
      };

      const out = await serviceUpsert('mums_documents', [doc], 'key');
      if (!out.ok) {
        return sendJson(res, 500, {
          ok: false,
          error: 'db_write_failed',
          detail: out.text ? out.text.slice(0, 300) : 'Unknown DB error',
        });
      }
      return sendJson(res, 200, { ok: true, saved: notes.length });
    }

    return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
  } catch (err) {
    console.error('[studio/call_notes]', err);
    return sendJson(res, 500, { ok: false, error: 'internal_error', message: String(err?.message || err) });
  }
};
