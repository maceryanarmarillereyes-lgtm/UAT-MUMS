/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Do not modify existing UI/UX, layouts, or core logic in this file without explicitly asking Thunter BOY for clearance. If changes are required here, STOP and provide a RISK IMPACT REPORT first. */
// Cloudflare Pages Functions catch-all router for /api/*.
//
// Keeps behavior in sync with Vercel's /api/handler.js routing, while allowing
// a single repo to deploy to both platforms.
//
// IMPORTANT:
// - Server routes are implemented as Node-style (req, res) handlers in /server/routes.
// - This file adapts the Cloudflare Request/Response model to that interface.

let ROUTES = null;

// Pre-create a minimal `process.env` polyfill so any accidental early imports
// that reference `process.env` won't crash in Workers.
if (typeof globalThis.process === 'undefined') globalThis.process = { env: {} };
if (!globalThis.process.env) globalThis.process.env = {};

function ensureProcessEnv(env) {
  // Cloudflare Workers don't provide process.env; map context.env into a minimal process.env.
  // This MUST happen before importing server route modules because some read env at module init.
  if (!globalThis.process) globalThis.process = { env: {} };
  if (!globalThis.process.env) globalThis.process.env = {};
  // Also expose env via a stable global name that doesn't depend on Node globals.
  globalThis.__MUMS_ENV = env || {};
  const src = env || {};
  for (const k of Object.keys(src)) {
    // Ensure env values are strings (Vercel/Node behavior).
    globalThis.process.env[k] = src[k] == null ? '' : String(src[k]);
  }
}

function unwrapCjs(mod) {
  return (mod && (mod.default || mod)) || mod;
}

async function getRoutes(env) {
  if (ROUTES) return ROUTES;
  ensureProcessEnv(env);

  // Static imports via dynamic import (one-time) so env is available at module init.
  ROUTES = {
    env: unwrapCjs(await import('../../server/routes/env.js')),
    'env.js': unwrapCjs(await import('../../server/routes/env.js')),
    health: unwrapCjs(await import('../../server/routes/health.js')),

    // Vendor bundles served as first-party scripts (avoid 3rd-party storage blocks)
    'vendor/supabase.js': unwrapCjs(await import('../../server/routes/vendor/supabase.js')),
    keep_alive: unwrapCjs(await import('../../server/routes/keep_alive.js')),
    'keep_alive.js': unwrapCjs(await import('../../server/routes/keep_alive.js')),
    'debug/log': unwrapCjs(await import('../../server/routes/debug/log.js')),

    'mailbox_override/get': unwrapCjs(await import('../../server/routes/mailbox_override/get.js')),
    'mailbox_override/set': unwrapCjs(await import('../../server/routes/mailbox_override/set.js')),

    'presence/heartbeat': unwrapCjs(await import('../../server/routes/presence/heartbeat.js')),
    'presence/list': unwrapCjs(await import('../../server/routes/presence/list.js')),

    'sync/pull': unwrapCjs(await import('../../server/routes/sync/pull.js')),
    'sync/push': unwrapCjs(await import('../../server/routes/sync/push.js')),

    'theme_access/get': unwrapCjs(await import('../../server/routes/theme_access/get.js')),
    'theme_access/set': unwrapCjs(await import('../../server/routes/theme_access/set.js')),

    'settings/global_theme': unwrapCjs(await import('../../server/routes/settings/global_theme.js')),
    'settings/global-theme': unwrapCjs(await import('../../server/routes/settings/global_theme.js')),
    'settings/login_mode': unwrapCjs(await import('../../server/routes/settings/login_mode.js')),
    'settings/global_quickbase': unwrapCjs(await import('../../server/routes/settings/global_quickbase.js')),

    overall_stats: unwrapCjs(await import('../../server/routes/overall_stats.js')),

    'users/list': unwrapCjs(await import('../../server/routes/users/list.js')),
    'users/create': unwrapCjs(await import('../../server/routes/users/create.js')),
    'users/ensure_profile': unwrapCjs(await import('../../server/routes/users/ensure_profile.js')),
    'users/me': unwrapCjs(await import('../../server/routes/users/me.js')),
    'users/update_me': unwrapCjs(await import('../../server/routes/users/update_me.js')),
    'users/upload_avatar': unwrapCjs(await import('../../server/routes/users/upload_avatar.js')),
    'users/remove_avatar': unwrapCjs(await import('../../server/routes/users/remove_avatar.js')),
    'users/resolve_email': unwrapCjs(await import('../../server/routes/users/resolve_email.js')),
    'users/update_user': unwrapCjs(await import('../../server/routes/users/update_user.js')),
    'users/delete': unwrapCjs(await import('../../server/routes/users/delete.js')),

    'mailbox/assign': unwrapCjs(await import('../../server/routes/mailbox/assign.js')),
    'mailbox/confirm': unwrapCjs(await import('../../server/routes/mailbox/confirm.js')),
    'mailbox/case_action': unwrapCjs(await import('../../server/routes/mailbox/case_action.js')),

    'member/schedule': unwrapCjs(await import('../../server/routes/member_schedule.js')),

    'tasks/assigned': unwrapCjs(await import('../../server/routes/tasks/assigned.js')),
    'tasks/distributions': unwrapCjs(await import('../../server/routes/tasks/distributions.js')),
    'tasks/distribution_items': unwrapCjs(await import('../../server/routes/tasks/distribution_items.js')),
    'tasks/item_status': unwrapCjs(await import('../../server/routes/tasks/item_status.js')),
    'tasks/workload_matrix': unwrapCjs(await import('../../server/routes/tasks/workload_matrix.js')),
    'tasks/members': unwrapCjs(await import('../../server/routes/tasks/members.js')),
    'tasks/monitoring': unwrapCjs(await import('../../server/routes/tasks/monitoring.js')),
    'tasks/reassign_pending': unwrapCjs(await import('../../server/routes/tasks/reassign_pending.js')),

    'quickbase/monitoring': unwrapCjs(await import('../../server/routes/quickbase/monitoring.js')),
    'quickbase/assigned_to_names': unwrapCjs(await import('../../server/routes/quickbase/assigned_to_names.js')),
    'quickbase_tabs': unwrapCjs(await import('../../server/routes/quickbase_tabs.js')),
    'quickbase_tabs/upsert': unwrapCjs(await import('../../server/routes/quickbase_tabs.js'))
  };

  return ROUTES;
}

function toNodeHeaders(request) {
  const out = {};
  request.headers.forEach((v, k) => {
    out[String(k).toLowerCase()] = v;
  });
  return out;
}

function toQueryObject(url) {
  const q = {};
  for (const [k, v] of url.searchParams.entries()) {
    if (Object.prototype.hasOwnProperty.call(q, k)) {
      // Preserve multiple values in an array (best-effort).
      const cur = q[k];
      q[k] = Array.isArray(cur) ? [...cur, v] : [cur, v];
    } else {
      q[k] = v;
    }
  }
  return q;
}

async function readBodyForNodeReq(request) {
  const m = String(request.method || 'GET').toUpperCase();
  if (m === 'GET' || m === 'HEAD') return undefined;

  const text = await request.text();
  if (!text) return {};
  const ct = String(request.headers.get('content-type') || '').toLowerCase();

  if (!ct || ct.includes('application/json')) {
    try {
      return JSON.parse(text);
    } catch (_) {
      return text;
    }
  }

  // Leave other content-types as raw string; route-specific readers can parse if needed.
  return text;
}

function createNodeRes() {
  const headers = new Headers();
  let statusCode = 200;
  let ended = false;
  let body = '';

  return {
    get statusCode() { return statusCode; },
    set statusCode(v) { statusCode = Number(v || 200); },
    setHeader(name, value) {
      try { headers.set(String(name), String(value)); } catch (_) {}
    },
    getHeader(name) {
      try { return headers.get(String(name)); } catch (_) { return null; }
    },
    end(data) {
      ended = true;
      if (typeof data === 'undefined' || data === null) return;
      if (typeof data === 'string') { body += data; return; }
      // Best-effort stringification
      try { body += String(data); } catch (_) {}
    },
    _toResponse() {
      if (!headers.has('cache-control')) headers.set('cache-control', 'no-store');
      return new Response(body || '', { status: statusCode || 200, headers });
    },
    _isEnded() { return ended; }
  };
}

function normalizeRoutePath(p) {
  const raw = String(p || '').replace(/^\/+/, '').replace(/\/+$/, '');
  return raw;
}

function resolveRoute(routePath, routes) {
  const exact = routes[routePath];
  if (exact) return { handler: exact, params: {} };

  const dynamicPatterns = [
    {
      re: /^member\/([^/]+)\/schedule$/,
      map: (m) => ({ memberId: decodeURIComponent(m[1] || '') }),
      handler: routes['member/schedule']
    },
    {
      re: /^quickbase_tabs\/([^/]+)$/,
      map: (m) => ({ tab_id: decodeURIComponent(m[1] || '') }),
      handler: routes['quickbase_tabs']
    }
  ];

  for (const entry of dynamicPatterns) {
    const hit = routePath.match(entry.re);
    if (!hit || !entry.handler) continue;
    return { handler: entry.handler, params: entry.map(hit) };
  }
  return { handler: null, params: {} };
}

export async function onRequest(context) {
  const request = context.request;
  const url = new URL(request.url);

  // Ensure `process.env` and `__MUMS_ENV` are available for this request.
  ensureProcessEnv(context.env);

  // Catch-all param: /api/<path>
  let p = context.params ? context.params.path : '';
  if (Array.isArray(p)) p = p.join('/');
  const routePath = normalizeRoutePath(p);

  const routes = await getRoutes(context.env);
  const resolved = resolveRoute(routePath, routes);
  const handler = resolved.handler;

  if (!handler) {
    return new Response(JSON.stringify({ ok: false, error: 'not_found', path: routePath }), {
      status: 404,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
    });
  }

  const headers = toNodeHeaders(request);
  headers.host = url.host;

  const nodeReq = {
    method: request.method,
    url: request.url,
    headers,
    query: toQueryObject(url),
    body: await readBodyForNodeReq(request),
    socket: { remoteAddress: '' }
  };

  const nodeRes = createNodeRes();
  try {
    await handler(nodeReq, nodeRes, resolved.params);
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: 'handler_failed', message: String(err?.message || err) }), {
      status: 500,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
    });
  }
  return nodeRes._toResponse();
}
