/**
 * @file release_notes.js
 * @description Release Notes module
 * @module MUMS/MUMS
 * @version UAT
 */
/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */


const { getUserFromJwt, getProfileForUserId, serviceSelect, serviceUpsert } = require('../../lib/supabase');

const DOC_KEY = 'mums_release_notes';

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
    let data = '';
    req.on('data', c => { data += c; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch(_) { resolve({}); }
    });
  });
}

function isSuperAdmin(profile) {
  return String(profile && profile.role || '').toUpperCase() === 'SUPER_ADMIN';
}

// Read current notes array from mums_documents
async function readNotes() {
  const q = `select=key,value&key=eq.${encodeURIComponent(DOC_KEY)}&limit=1`;
  const out = await serviceSelect('mums_documents', q);
  if (!out.ok) return [];
  const row = (Array.isArray(out.json) && out.json[0]) ? out.json[0] : null;
  const val = row && row.value;
  return Array.isArray(val) ? val : [];
}

// Write notes array back
async function writeNotes(notes, actor) {
  return serviceUpsert('mums_documents', [{
    key: DOC_KEY,
    value: notes,
    updated_at: new Date().toISOString(),
    updated_by_user_id: actor ? actor.user_id : null,
    updated_by_name: actor ? (actor.name || null) : null,
    updated_by_client_id: null
  }], 'key');
}

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');

    const auth = String(req.headers.authorization || '');
    const jwt = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const authed = await getUserFromJwt(jwt);
    if (!authed) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    const profile = await getProfileForUserId(authed.id);
    if (!profile) return sendJson(res, 403, { ok: false, error: 'profile_missing' });

    const method = String(req.method || 'GET').toUpperCase();

    // ── GET: return all notes or single note ───────────────────────────────
    if (method === 'GET') {
      const noteId = String((req.query && (req.query.noteId || req.query.note_id)) || '').trim();
      const notes = await readNotes();
      if (noteId) {
        // Return full note with htmlContent
        const note = notes.find(n => String(n.id) === noteId);
        if (!note) return sendJson(res, 404, { ok: false, error: 'not_found' });
        return sendJson(res, 200, { ok: true, note });
      }
      // Return list view (strip htmlContent for bandwidth)
      const listView = notes.map(n => ({
        id: n.id,
        version: n.version,
        title: n.title,
        summary: n.summary,
        publishedAt: n.publishedAt,
        publishedBy: n.publishedBy,
        isNew: n.isNew,
        tags: n.tags || [],
        hasContent: !!(n.htmlContent),
      }));
      return sendJson(res, 200, { ok: true, notes: listView });
    }

    // ── POST: publish new note (SA only) ──────────────────────────────────
    if (method === 'POST') {
      if (!isSuperAdmin(profile)) {
        return sendJson(res, 403, { ok: false, error: 'super_admin_required' });
      }
      const body = await readBody(req);

      // Validate required fields
      const version = String(body.version || '').trim();
      const title   = String(body.title || '').trim();
      const htmlContent = String(body.htmlContent || '').trim();
      const summary = String(body.summary || '').trim();
      const tags    = Array.isArray(body.tags) ? body.tags.map(String).filter(Boolean).slice(0, 5) : [];
      const action  = String(body.action || 'publish').trim();

      if (action === 'delete') {
        const deleteId = String(body.id || '').trim();
        if (!deleteId) return sendJson(res, 400, { ok: false, error: 'missing_id' });
        const notes = await readNotes();
        const filtered = notes.filter(n => String(n.id) !== deleteId);
        const out = await writeNotes(filtered, profile);
        if (!out.ok) return sendJson(res, 500, { ok: false, error: 'save_failed' });
        return sendJson(res, 200, { ok: true, message: 'Note deleted.' });
      }

      if (!version || !title || !htmlContent) {
        return sendJson(res, 400, { ok: false, error: 'missing_fields',
          message: 'version, title and htmlContent are required.' });
      }
      if (htmlContent.length > 500000) {
        return sendJson(res, 400, { ok: false, error: 'content_too_large',
          message: 'HTML content must be under 500 KB.' });
      }

      const notes = await readNotes();

      // If updating existing (same id)
      const existingIdx = body.id ? notes.findIndex(n => String(n.id) === String(body.id)) : -1;

      const noteEntry = {
        id:          body.id || String(Date.now()),
        version,
        title,
        summary,
        htmlContent,
        tags,
        publishedAt: new Date().toISOString(),
        publishedBy: profile.name || profile.username || 'Super Admin',
        isNew:       true,
      };

      let updated;
      if (existingIdx >= 0) {
        updated = notes.slice();
        updated[existingIdx] = { ...updated[existingIdx], ...noteEntry };
      } else {
        // Prepend — newest first
        updated = [noteEntry, ...notes];
      }

      // Keep max 50 release notes
      if (updated.length > 50) updated = updated.slice(0, 50);

      const out = await writeNotes(updated, profile);
      if (!out.ok) return sendJson(res, 500, { ok: false, error: 'save_failed',
        message: 'Failed to save release note to database.' });

      console.log('[Release Notes] Published:', version, 'by', noteEntry.publishedBy);
      return sendJson(res, 200, { ok: true, message: 'Release note published.', id: noteEntry.id });
    }

    return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });

  } catch (err) {
    console.error('[Release Notes Route Error]', err);
    return sendJson(res, 500, { ok: false, error: 'server_error', message: String(err?.message || err) });
  }
};
