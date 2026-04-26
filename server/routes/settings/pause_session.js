/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

const { getUserFromJwt, getProfileForUserId } = require('../../lib/supabase');
const { serviceSelect, serviceUpsert } = require('../../lib/supabase');

const SETTING_KEY = 'pause_session';
const ALLOWED_TIMEOUTS = new Set([1, 5, 10, 30, 60]);
const DEFAULT_SETTINGS = Object.freeze({ enabled: true, timeout_minutes: 10 });

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function coerceBoolean(v) {
  if (v === true || v === false) return v;
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes' || s === 'on') return true;
  if (s === 'false' || s === '0' || s === 'no' || s === 'off') return false;
  return null;
}

function isSuperAdmin(profile) {
  const role = String((profile && profile.role) || '').trim().toUpperCase().replace(/\s+/g, '_');
  return role === 'SUPER_ADMIN';
}

function normalizeSettings(raw) {
  const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  const enabled = src.enabled !== undefined ? src.enabled === true : DEFAULT_SETTINGS.enabled;
  const timeoutRaw = Number(src.timeout_minutes);
  const timeout = ALLOWED_TIMEOUTS.has(timeoutRaw) ? timeoutRaw : DEFAULT_SETTINGS.timeout_minutes;
  return {
    enabled,
    timeout_minutes: timeout
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    try {
      if (req && typeof req.body !== 'undefined' && req.body !== null) {
        if (typeof req.body === 'object' && !Array.isArray(req.body)) {
          // Node runtime usually provides plain object for JSON.
          if (
            Object.prototype.hasOwnProperty.call(req.body, 'enabled') ||
            Object.prototype.hasOwnProperty.call(req.body, 'timeout_minutes')
          ) {
            return resolve(req.body);
          }
          // Some adapters can pass Uint8Array/Buffer-like body objects.
          const td = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;
          const maybeBytes = (req.body instanceof Uint8Array)
            ? req.body
            : (req.body && req.body.buffer instanceof ArrayBuffer ? new Uint8Array(req.body.buffer) : null);
          if (td && maybeBytes) {
            const asText = td.decode(maybeBytes).trim();
            if (!asText) return resolve({});
            try { return resolve(JSON.parse(asText)); } catch (_) { return resolve({}); }
          }
        }
        if (typeof req.body === 'string') {
          try { return resolve(req.body ? JSON.parse(req.body) : {}); } catch (_) { return resolve({}); }
        }
      }
    } catch (_) {}

    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      const raw = String(data || '').trim();
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
    });
  });
}

async function readPauseSessionSettings() {
  const q = `select=setting_key,setting_value,updated_at,updated_by_name&setting_key=eq.${encodeURIComponent(SETTING_KEY)}&limit=1`;
  const out = await serviceSelect('mums_global_settings', q);
  if (!out.ok) {
    return { ok: false, status: out.status || 500, details: out.json || out.text };
  }

  const row = (Array.isArray(out.json) && out.json[0]) ? out.json[0] : null;
  const settings = normalizeSettings(row && row.setting_value);
  return { ok: true, status: 200, row, settings };
}

async function writePauseSessionSettings(nextSettings, actor) {
  const clean = normalizeSettings(nextSettings);
  const nowIso = new Date().toISOString();

  const row = {
    setting_key: SETTING_KEY,
    setting_value: clean,
    updated_at: nowIso,
    updated_by_name: (actor && actor.name) ? String(actor.name) : null,
    updated_by_user_id: (actor && actor.userId) ? String(actor.userId) : null
  };

  const out = await serviceUpsert('mums_global_settings', [row], 'setting_key');
  if (!out.ok) {
    return { ok: false, status: out.status || 500, details: out.json || out.text, settings: clean };
  }

  const saved = (Array.isArray(out.json) && out.json[0]) ? out.json[0] : row;
  return { ok: true, status: 200, row: saved, settings: clean };
}

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');

    const auth = String(req.headers.authorization || '');
    const jwt = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    if (!jwt) return sendJson(res, 401, { ok: false, error: 'unauthorized', message: 'Missing bearer token.' });

    const user = await getUserFromJwt(jwt);
    if (!user) return sendJson(res, 401, { ok: false, error: 'unauthorized', message: 'Invalid token.' });

    const method = String(req.method || 'GET').toUpperCase();

    if (method === 'GET') {
      const out = await readPauseSessionSettings();
      if (!out.ok) {
        return sendJson(res, out.status || 500, {
          ok: false,
          error: 'read_failed',
          message: 'Failed to read pause session settings.',
          details: out.details
        });
      }

      return sendJson(res, 200, {
        ok: true,
        settings: out.settings,
        updatedAt: out.row && out.row.updated_at ? out.row.updated_at : null,
        updatedByName: out.row && out.row.updated_by_name ? out.row.updated_by_name : null
      });
    }

    if (method !== 'POST') {
      return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
    }

    const profile = await getProfileForUserId(user.id);
    if (!isSuperAdmin(profile)) {
      return sendJson(res, 403, { ok: false, error: 'forbidden', message: 'Only Super Admin can update pause session settings.' });
    }

    let body = {};
    try { body = await readBody(req); } catch (_) {
      return sendJson(res, 400, { ok: false, error: 'invalid_json' });
    }

    const enabled = coerceBoolean(body.enabled);
    if (enabled === null) {
      return sendJson(res, 400, { ok: false, error: 'invalid_enabled', message: 'enabled must be a boolean.' });
    }

    const timeout = Number(body.timeout_minutes);
    if (!ALLOWED_TIMEOUTS.has(timeout)) {
      return sendJson(res, 400, {
        ok: false,
        error: 'invalid_timeout',
        message: 'timeout_minutes must be one of: 1, 5, 10, 30, 60.'
      });
    }

    const out = await writePauseSessionSettings({ enabled, timeout_minutes: timeout }, {
      userId: user.id,
      name: String((profile && (profile.name || profile.username)) || 'Super Admin')
    });

    if (!out.ok) {
      return sendJson(res, out.status || 500, {
        ok: false,
        error: 'save_failed',
        message: 'Failed to save pause session settings.',
        details: out.details
      });
    }

    return sendJson(res, 200, {
      ok: true,
      settings: out.settings,
      message: 'Pause session settings saved.'
    });
  } catch (e) {
    return sendJson(res, 500, { ok: false, error: 'server_error', message: String((e && e.message) || e) });
  }
};
