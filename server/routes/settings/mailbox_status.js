/**
 * @file mailbox_status.js
 * @description Server lib: mailbox status flag persistence and broadcast helper
 * @module MUMS/Server/Lib
 * @version UAT
 */
/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

// GET  /api/settings/mailbox_status  — public (any client can read to show disabled banner)
// POST /api/settings/mailbox_status  — Super Admin only

const { getUserFromJwt, getProfileForUserId } = require('../../lib/supabase');
const { readMailboxStatus, writeMailboxStatus } = require('../../lib/mailbox_status');

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function isSuperAdmin(profile) {
  const role = String((profile && profile.role) || '').trim().toUpperCase().replace(/\s+/g, '_');
  return role === 'SUPER_ADMIN';
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    try {
      if (req && typeof req.body !== 'undefined' && req.body !== null) {
        if (typeof req.body === 'object' && !Array.isArray(req.body)) return resolve(req.body);
        if (typeof req.body === 'string') {
          try { return resolve(req.body ? JSON.parse(req.body) : {}); } catch (_) { return resolve({}); }
        }
      }
    } catch (_) {}
    let data = '';
    req.on('data', c => { data += c; });
    req.on('end', () => {
      const raw = String(data || '').trim();
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
    });
  });
}

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const method = String(req.method || 'GET').toUpperCase();

    if (method === 'OPTIONS') {
      res.statusCode = 204;
      return res.end();
    }

    // ── GET: public — any client can check mailbox status ──────────────────
    if (method === 'GET') {
      const result = await readMailboxStatus();
      return sendJson(res, 200, {
        ok: true,
        settings: result.settings
      });
    }

    // ── POST: Super Admin only ─────────────────────────────────────────────
    if (method !== 'POST') {
      return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
    }

    const auth = String(req.headers.authorization || '');
    const jwt = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    if (!jwt) return sendJson(res, 401, { ok: false, error: 'unauthorized', message: 'Missing bearer token.' });

    const user = await getUserFromJwt(jwt);
    if (!user) return sendJson(res, 401, { ok: false, error: 'unauthorized', message: 'Invalid token.' });

    const profile = await getProfileForUserId(user.id);
    if (!profile) return sendJson(res, 403, { ok: false, error: 'profile_missing' });
    if (!isSuperAdmin(profile)) {
      return sendJson(res, 403, { ok: false, error: 'forbidden', message: 'Only Super Admin can change mailbox status.' });
    }

    let body = {};
    try { body = await readBody(req); } catch (_) {
      return sendJson(res, 400, { ok: false, error: 'invalid_json' });
    }

    // Accept: { disabled: true|false }
    const disabled = body.disabled === true || String(body.disabled || '').toLowerCase() === 'true';

    const actor = {
      userId: user.id,
      name: String(profile.name || profile.username || 'Super Admin')
    };

    const result = await writeMailboxStatus({ disabled }, actor);
    if (!result.ok) {
      return sendJson(res, result.status || 500, {
        ok: false,
        error: 'save_failed',
        details: result.details,
        message: 'Failed to save mailbox status.'
      });
    }

    return sendJson(res, 200, {
      ok: true,
      settings: result.settings,
      message: disabled ? 'Mailbox has been disabled.' : 'Mailbox has been enabled.'
    });

  } catch (e) {
    return sendJson(res, 500, { ok: false, error: 'server_error', message: String(e && e.message ? e.message : e) });
  }
};
