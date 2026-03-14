/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Strictly protects Enterprise UI/UX, Realtime Sync Logic, Core State Management, and Database/API Adapters. Do NOT modify existing logic or layout in this file without explicitly asking MACE for clearance. If overlapping changes are required, STOP and provide a RISK IMPACT REPORT first. */
/**
 * Supabase server helpers
 *
 * Supports both:
 *  - Node runtimes (Vercel) where `process.env` exists
 *  - Cloudflare Workers/Pages Functions where `process` may not exist
 *
 * Important: we avoid reading env at module init time so Workers can populate env per-request.
 */

function envBag() {
  // Cloudflare Pages Functions entrypoints can set this per request:
  //   globalThis.__MUMS_ENV = context.env
  if (typeof globalThis !== 'undefined' && globalThis && globalThis.__MUMS_ENV) {
    return globalThis.__MUMS_ENV;
  }

  // Node / Vercel (avoid bare `process` identifier to prevent ReferenceError in Workers)
  const proc = typeof globalThis !== 'undefined' && globalThis ? globalThis.process : undefined;
  if (proc && proc.env) return proc.env;

  // Fallback
  return {};
}

function envValue(name) {
  const bag = envBag();
  const v = bag ? bag[name] : undefined;
  return v == null ? '' : String(v);
}

function requireEnv(name) {
  const v = envValue(name);
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function supabaseUrl() {
  return envValue('SUPABASE_URL').replace(/\/$/, '');
}

function supabaseAnonKey() {
  return envValue('SUPABASE_ANON_KEY');
}

function supabaseServiceRoleKey() {
  return envValue('SUPABASE_SERVICE_ROLE_KEY');
}

function isPlainObject(x) {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

/**
 * Fetch wrapper that always returns both text and parsed JSON (if any).
 */
async function fetchJson(url, opts) {
  const r = await fetch(url, opts);
  const text = await r.text().catch(() => '');
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_) {
    json = null;
  }
  return {
    ok: r.ok,
    status: r.status,
    text,
    json,
    headers: r.headers,
    // Back-compat surface used by older routes
    res: { ok: r.ok, status: r.status, headers: r.headers }
  };
}

function serviceHeaders(extra) {
  const url = supabaseUrl();
  const key = supabaseServiceRoleKey();
  if (!url) requireEnv('SUPABASE_URL');
  if (!key) requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  return Object.assign(
    {
      apikey: key,
      Authorization: `Bearer ${key}`
    },
    extra || {}
  );
}

function normalizeBodyAndHeaders(opts) {
  const o = Object.assign({ method: 'GET', headers: {} }, opts || {});
  const headers = Object.assign({}, o.headers || {});
  let body = o.body;

  // Allow callers to pass { body: <object|array> } without stringifying.
  if (isPlainObject(body) || Array.isArray(body)) {
    if (!headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/json';
    }
    body = JSON.stringify(body);
  }

  o.headers = headers;
  o.body = body;
  return o;
}

/**
 * Fetch any Supabase endpoint with the service role.
 * Path MUST start with '/'.
 */
async function serviceFetch(path, opts) {
  const base = supabaseUrl();
  if (!base) requireEnv('SUPABASE_URL');

  const p = String(path || '');
  if (!p.startsWith('/')) throw new Error('serviceFetch path must start with /');

  const o = normalizeBodyAndHeaders(opts);
  o.headers = serviceHeaders(o.headers);

  return fetchJson(base + p, o);
}

/**
 * Select rows using PostgREST.
 * - serviceSelect('table', 'select=*&id=eq.1')
 * - serviceSelect('/rest/v1/table?select=*')  // legacy path form
 */
async function serviceSelect(tableOrPath, queryMaybe) {
  const base = supabaseUrl();
  if (!base) requireEnv('SUPABASE_URL');

  const a = String(tableOrPath || '');
  if (a.startsWith('/')) {
    return serviceFetch(a, { method: 'GET' });
  }
  const table = a;
  const query = String(queryMaybe || 'select=*');
  const url = `${base}/rest/v1/${table}?${query}`;
  return fetchJson(url, { headers: serviceHeaders() });
}

async function serviceUpsert(table, rows, conflict) {
  const base = supabaseUrl();
  if (!base) requireEnv('SUPABASE_URL');

  const url = `${base}/rest/v1/${table}${conflict ? `?on_conflict=${encodeURIComponent(conflict)}` : ''}`;
  return fetchJson(url, {
    method: 'POST',
    headers: serviceHeaders({
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation'
    }),
    body: JSON.stringify(rows)
  });
}

async function serviceInsert(table, rows) {
  const base = supabaseUrl();
  if (!base) requireEnv('SUPABASE_URL');

  const url = `${base}/rest/v1/${table}`;
  return fetchJson(url, {
    method: 'POST',
    headers: serviceHeaders({
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    }),
    body: JSON.stringify(rows)
  });
}

function matchToQuery(match) {
  if (!match) return '';
  if (typeof match === 'string') return match;
  if (typeof match !== 'object') return '';

  // Example expected shape:
  //   { user_id: `eq.${id}` }
  // Convert into: user_id=eq.<id>
  return Object.keys(match)
    .filter((k) => Object.prototype.hasOwnProperty.call(match, k))
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(match[k]))}`)
    .join('&');
}

// serviceUpdate supports both call styles:
//  1) serviceUpdate('table', 'id=eq.1', { patch })           (legacy)
//  2) serviceUpdate('table', { patch }, { id: 'eq.1' })      (convenient)
async function serviceUpdate(table, arg2, arg3) {
  const base = supabaseUrl();
  if (!base) requireEnv('SUPABASE_URL');

  const legacy = typeof arg2 === 'string';
  const matchQuery = legacy ? String(arg2 || '') : matchToQuery(arg3);
  const patch = legacy ? (arg3 || {}) : (arg2 || {});

  const url = `${base}/rest/v1/${table}?${matchQuery}`;
  return fetchJson(url, {
    method: 'PATCH',
    headers: serviceHeaders({
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    }),
    body: JSON.stringify(patch)
  });
}

async function getUserFromJwt(jwt) {
  const base = supabaseUrl();
  const anon = supabaseAnonKey();
  if (!base) requireEnv('SUPABASE_URL');
  if (!anon) requireEnv('SUPABASE_ANON_KEY');

  const token = String(jwt || '').trim();
  if (!token) return null;

  const url = `${base}/auth/v1/user`;
  const out = await fetchJson(url, {
    headers: {
      apikey: anon,
      Authorization: `Bearer ${token}`
    }
  });

  if (!out.ok) return null;
  return out.json;
}

async function getProfileForUserId(userId) {
  const uid = String(userId || '').trim();
  if (!uid) return null;
  const out = await serviceSelect('mums_profiles', `select=*&user_id=eq.${encodeURIComponent(uid)}&limit=1`);
  if (!out.ok) return null;
  return out.json && out.json[0] ? out.json[0] : null;
}


async function updateProfileQuickbaseSettings(userId, quickbaseSettings) {
  const uid = String(userId || '').trim();
  if (!uid) throw new Error('Missing userId');

  const out = await serviceUpdate('mums_profiles', {
    quickbase_settings: quickbaseSettings,
    updated_at: new Date().toISOString()
  }, {
    user_id: `eq.${uid}`
  });

  if (!out.ok) {
    console.error('[updateProfileQuickbaseSettings] Error:', out.json || out.text);
    throw new Error((out.json && out.json.message) || out.text || 'quickbase_settings_update_failed');
  }

  const rows = Array.isArray(out.json) ? out.json : [];
  return rows[0] || null;
}

async function serviceDelete(table, filter) {
  const base = supabaseUrl();
  if (!base) requireEnv('SUPABASE_URL');
  const url = `${base}/rest/v1/${table}?${filter}`;
  return fetchJson(url, {
    method: 'DELETE',
    headers: serviceHeaders({ Prefer: 'return=representation' })
  });
}

module.exports = {
  serviceFetch,
  serviceHeaders,
  serviceSelect,
  serviceUpsert,
  serviceInsert,
  serviceUpdate,
  serviceDelete,
  getUserFromJwt,
  getProfileForUserId,
  updateProfileQuickbaseSettings
};
