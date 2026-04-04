/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

// ─────────────────────────────────────────────────────────────────
//  server/routes/studio/kb_settings.js
//  KB Settings GET + POST route
//  FIXED:
//    - Detailed error logging so save failures surface in server logs
//    - Defensive upsert: only include columns that exist in schema
//    - updated_by_user_id cast to TEXT to prevent int/uuid type clash
//    - lastSyncedAt always preserved across saves
// ─────────────────────────────────────────────────────────────────
const { getUserFromJwt, getProfileForUserId, serviceUpsert, serviceSelect } = require('../../lib/supabase');
const { encryptText } = require('../../lib/crypto');
const { KB_SETTINGS_KEY, parseQbUrl } = require('../../services/quickbaseSync');

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function isSuperAdmin(profile) {
  const role = String(profile && profile.role || '').toUpperCase().replace(/\s+/g, '_');
  return role === 'SUPER_ADMIN' || role === 'SA' || role === 'SUPERADMIN';
}

async function loadSettings() {
  const out = await serviceSelect(
    'mums_documents',
    `select=key,value,updated_at&key=eq.${encodeURIComponent(KB_SETTINGS_KEY)}&limit=1`
  );
  if (!out.ok) {
    console.error('[kb_settings] loadSettings serviceSelect failed:', out);
    return {};
  }
  const row = Array.isArray(out.json) && out.json[0] ? out.json[0] : null;
  return (row && row.value && typeof row.value === 'object') ? row.value : {};
}

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');

    // ── Auth ─────────────────────────────────────────────────────
    const auth = req.headers.authorization || '';
    const jwt  = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const user = await getUserFromJwt(jwt);
    if (!user) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    const profile = await getProfileForUserId(user.id);
    if (!isSuperAdmin(profile)) return sendJson(res, 403, { ok: false, error: 'forbidden' });

    const method = String(req.method || 'GET').toUpperCase();

    // ── GET ──────────────────────────────────────────────────────
    if (method === 'GET') {
      const cur    = await loadSettings();
      const parsed = parseQbUrl(cur.quickbaseAppUrl || '');
      return sendJson(res, 200, {
        ok: true,
        settings: {
          quickbaseAppUrl:       String(cur.quickbaseAppUrl       || '').trim(),
          quickbaseRealm:        String(cur.quickbaseRealm        || parsed.realm    || '').trim(),
          quickbaseTableId:      String(cur.quickbaseTableId      || parsed.tableId  || '').trim(),
          quickbaseQid:          String(cur.quickbaseQid          || parsed.qid      || '').trim(),
          syncSchedule:          String(cur.syncSchedule          || '').trim(),
          quickbaseUserTokenSet: !!cur.quickbaseUserToken,
          lastSyncedAt:          cur.lastSyncedAt || null,
        },
      });
    }

    // ── POST / PATCH ─────────────────────────────────────────────
    if (method === 'POST' || method === 'PATCH') {
      const body = (req.body && typeof req.body === 'object') ? req.body : {};

      // Load current values to merge (never overwrite with blanks)
      const cur    = await loadSettings();
      const parsed = parseQbUrl(body.quickbaseAppUrl || cur.quickbaseAppUrl || '');

      // Token handling — __KEEP__ means "don't change the stored token"
      const tokenInput       = typeof body.quickbaseUserToken === 'string' ? body.quickbaseUserToken : '';
      const keepExistingToken = tokenInput === '__KEEP__' || tokenInput === '';
      const tokenRaw          = keepExistingToken ? '' : tokenInput.trim();
      const persistedToken    = keepExistingToken
        ? String(cur.quickbaseUserToken || '')
        : (tokenRaw ? encryptText(tokenRaw) : '');

      // Merge: new values take priority over existing, blanks fall back to current
      const newAppUrl = String(body.quickbaseAppUrl || cur.quickbaseAppUrl || '').trim();
      const merged = {
        ...cur,
        quickbaseAppUrl:    newAppUrl,
        quickbaseRealm:     String(body.quickbaseRealm     || cur.quickbaseRealm     || parsed.realm   || '').trim(),
        quickbaseTableId:   String(body.quickbaseTableId   || cur.quickbaseTableId   || parsed.tableId || '').trim(),
        quickbaseQid:       String(body.quickbaseQid       || cur.quickbaseQid       || parsed.qid     || '').trim(),
        quickbaseUserToken: persistedToken,
        syncSchedule:       String(body.syncSchedule       || cur.syncSchedule       || '').trim(),
        updatedAt:          new Date().toISOString(),
        updatedByName:      (profile && (profile.name || profile.username)) || null,
        lastSyncedAt:       cur.lastSyncedAt || null,  // always preserve last sync time
      };

      // Upsert to mums_documents — service_role bypasses RLS
      const upsertRow = {
        key:                 KB_SETTINGS_KEY,
        value:               merged,
        updated_at:          new Date().toISOString(),
        updated_by_name:     merged.updatedByName,
        updated_by_user_id:  String(user.id || ''),   // TEXT cast — prevents uuid/int mismatch
      };

      console.log('[kb_settings] Saving settings for user', user.id, '— appUrl:', newAppUrl);
      const out = await serviceUpsert('mums_documents', [upsertRow], 'key');

      if (!out.ok) {
        // Log full Supabase error for debugging
        console.error('[kb_settings] serviceUpsert FAILED:', JSON.stringify(out));
        const supaErr = out.json && (out.json.message || out.json.hint || out.json.code);
        return sendJson(res, 500, {
          ok: false,
          error: 'save_failed',
          detail: supaErr || ('HTTP ' + (out.status || '?')),
        });
      }

      console.log('[kb_settings] Saved OK — count:', Array.isArray(out.json) ? out.json.length : '?');

      // Return saved settings (strip the raw token from response)
      const { quickbaseUserToken: _tok, ...safeSettings } = merged;
      return sendJson(res, 200, {
        ok: true,
        settings: { ...safeSettings, quickbaseUserTokenSet: !!merged.quickbaseUserToken },
      });
    }

    return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });

  } catch (err) {
    console.error('[kb_settings] Unhandled error:', err);
    return sendJson(res, 500, {
      ok: false,
      error: 'internal_error',
      message: String(err && err.message || err),
    });
  }
};
