/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

const { getUserFromJwt, serviceSelect, serviceUpsert } = require('../../lib/supabase');

function sendJson(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function docKey(userId) {
  return `ss_home_apps_${String(userId).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

function safeText(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function safeUrl(value) {
  const raw = safeText(value, 800);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    const p = String(parsed.protocol || '').toLowerCase();
    if (p !== 'http:' && p !== 'https:') return '';
    return parsed.toString();
  } catch (_) {
    return '';
  }
}

function normalizeApps(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .map((item, idx) => {
      const label = safeText(item && item.label, 80);
      const link = safeUrl(item && item.link);
      const icon = safeUrl(item && item.icon);
      const description = safeText(item && item.description, 220);
      const position = Number.isFinite(Number(item && item.position)) ? Number(item.position) : idx + 1;
      return {
        id: safeText(item && item.id, 80) || ('app_' + Date.now() + '_' + idx),
        label,
        link,
        icon,
        description,
        position,
      };
    })
    .filter((item) => item.label && item.link)
    .slice(0, 30)
    .sort((a, b) => a.position - b.position)
    .map((item, idx) => Object.assign({}, item, { position: idx + 1 }));
}

module.exports = async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    const jwt = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const user = await getUserFromJwt(jwt);
    if (!user) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    const key = docKey(user.id);

    if (req.method === 'GET') {
      const out = await serviceSelect('mums_documents', `select=value&key=eq.${encodeURIComponent(key)}&limit=1`);
      if (!out.ok) {
        return sendJson(res, 500, { ok: false, error: 'db_read_failed', detail: out.text || '' });
      }
      const row = Array.isArray(out.json) && out.json[0] ? out.json[0] : null;
      const value = row ? row.value : null;
      const apps = normalizeApps(value && value.apps);
      return sendJson(res, 200, { ok: true, apps });
    }

    if (req.method === 'POST') {
      const body = (req.body && typeof req.body === 'object')
        ? req.body
        : await new Promise((resolve) => {
            let d = '';
            req.on('data', (c) => { d += c; });
            req.on('end', () => {
              try { resolve(d ? JSON.parse(d) : {}); } catch (_) { resolve({}); }
            });
          });

      if (!Array.isArray(body.apps)) {
        return sendJson(res, 400, { ok: false, error: 'apps_must_be_array' });
      }

      const apps = normalizeApps(body.apps);
      const nowIso = new Date().toISOString();

      const doc = {
        key,
        value: { apps },
        updated_at: nowIso,
        updated_by_user_id: user.id,
        updated_by_name: user.email || '',
        updated_by_client_id: null,
      };

      const out = await serviceUpsert('mums_documents', [doc], 'key');
      if (!out.ok) {
        return sendJson(res, 500, { ok: false, error: 'db_write_failed', detail: out.text ? out.text.slice(0, 300) : 'Unknown DB error' });
      }

      return sendJson(res, 200, { ok: true, saved: apps.length, apps });
    }

    return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
  } catch (err) {
    console.error('[studio/home_apps]', err);
    return sendJson(res, 500, { ok: false, error: 'internal_error', message: String(err && err.message ? err.message : err) });
  }
};
