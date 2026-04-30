// server/routes/settings/global_dashboard_counters.js
// GET  /api/settings/global_dashboard_counters  — any authenticated user (reads counter config)
// POST /api/settings/global_dashboard_counters  — SUPER_ADMIN only (writes counter config)
//
// Stores counter definitions in mums_documents key-value table.
// Key: 'mums_global_dashboard_counters'
// Counter config shape:
// {
//   hero: { label, sublabel }            ← centre circle (filtered by user's qb_name)
//   counters: [                          ← up to 6 side pills (2 left, 2 right + overflow)
//     { id, label, sublabel, fieldId, operator, value, color }
//   ]
// }

const { getUserFromJwt, getProfileForUserId } = require('../../lib/supabase');
const { serviceSelect, serviceUpsert }         = require('../../lib/supabase');

const DOC_KEY = 'mums_global_dashboard_counters';

let _cache    = null;
let _cacheAt  = 0;
const TTL_MS  = 5 * 60 * 1000; // 5 min

function sendJson(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function isSuperAdmin(profile) {
  return String((profile && profile.role) || '').trim().toUpperCase().replace(/\s+/g,'_') === 'SUPER_ADMIN';
}

function normalizeCounters(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const hero = src.hero && typeof src.hero === 'object' ? src.hero : {};
  const counters = Array.isArray(src.counters) ? src.counters : [];
  return {
    hero: {
      label:    String(hero.label    || 'My Active Cases').trim(),
      sublabel: String(hero.sublabel || '').trim(),
      heroFieldId: String(hero.heroFieldId || '').trim(),
      heroOperator: String(hero.heroOperator || 'EX').trim(),
    },
    counters: counters.slice(0, 6).map((c, i) => ({
      id:        String(c.id        || 'ctr_' + i),
      label:     String(c.label     || 'Counter ' + (i+1)).trim(),
      sublabel:  String(c.sublabel  || '').trim(),
      fieldId:   String(c.fieldId   || '').trim(),
      operator:  String(c.operator  || 'EX').trim(),
      value:     String(c.value     || '').trim(),
      color:     String(c.color     || 'gold').trim(),
    })),
  };
}

async function readConfig() {
  const q = `select=key,value,updated_at,updated_by_name&key=eq.${encodeURIComponent(DOC_KEY)}&limit=1`;
  const out = await serviceSelect('mums_documents', q);
  if (!out.ok) return { ok:false, config: normalizeCounters({}) };
  const row = Array.isArray(out.json) && out.json[0] ? out.json[0] : null;
  return { ok:true, config: normalizeCounters(row && row.value), row };
}

async function writeConfig(next, actor) {
  const clean = normalizeCounters(next);
  const row = {
    key:                  DOC_KEY,
    value:                clean,
    updated_at:           new Date().toISOString(),
    updated_by_user_id:   actor && actor.userId ? String(actor.userId) : null,
    updated_by_name:      actor && actor.name   ? String(actor.name)   : null,
    updated_by_client_id: null,
  };
  const out = await serviceUpsert('mums_documents', [row], 'key');
  if (!out.ok) return { ok:false, config: clean };
  return { ok:true, config: clean };
}

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const jwt = (req.headers.authorization || '').replace(/^bearer /i, '');
    const user = await getUserFromJwt(jwt);
    if (!user) return sendJson(res, 401, { ok:false, error:'unauthorized' });

    const method = String(req.method || 'GET').toUpperCase();

    if (method === 'GET') {
      // Cache warm path
      if (_cache && (Date.now() - _cacheAt) < TTL_MS)
        return sendJson(res, 200, { ok:true, config: _cache, cached:true });
      const out = await readConfig();
      if (!out.ok) return sendJson(res, 500, { ok:false, error:'db_error' });
      _cache = out.config; _cacheAt = Date.now();
      return sendJson(res, 200, { ok:true, config: out.config });
    }

    if (method === 'POST' || method === 'PATCH') {
      _cache = null; _cacheAt = 0; // invalidate
      const profile = await getProfileForUserId(user.id);
      if (!isSuperAdmin(profile)) return sendJson(res, 403, { ok:false, error:'forbidden' });

      let body = {};
      try {
        if (req.body && typeof req.body === 'object') body = req.body;
        else {
          body = await new Promise((resolve, reject) => {
            let d = '';
            req.on('data', c => { d += c; });
            req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch(e) { reject(e); } });
          });
        }
      } catch (_) { return sendJson(res, 400, { ok:false, error:'invalid_json' }); }

      const out = await writeConfig(body, { userId: user.id, name: profile.name || profile.username });
      if (!out.ok) return sendJson(res, 500, { ok:false, error:'save_failed' });
      return sendJson(res, 200, { ok:true, config: out.config });
    }

    return sendJson(res, 405, { ok:false, error:'method_not_allowed' });
  } catch (err) {
    console.error('[global_dashboard_counters]', err);
    return sendJson(res, 500, { ok:false, error:'internal_error' });
  }
};
