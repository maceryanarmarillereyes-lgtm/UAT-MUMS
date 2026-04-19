/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Do not modify existing UI/UX, layouts, or core logic in this file without explicitly asking MACE for clearance. If changes are required here, STOP and provide a RISK IMPACT REPORT first. */
// Single-function API router for Vercel Hobby plan.
//
// Vercel Hobby limits the number of Serverless Functions. This project previously
// exceeded that limit by defining each endpoint as a separate /api/*.js file.
//
// This handler routes all /api/* traffic (via vercel.json rewrites) to the
// corresponding implementation under /server/routes.
const { verifyJwtCached } = require('../server/lib/authCache');

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function normalizePath(raw) {
  if (!raw) return '';
  if (Array.isArray(raw)) raw = raw.join('/');
  raw = String(raw);
  raw = raw.replace(/^\/+/, '').replace(/\/+$/, '');
  return raw;
}

// Route table (string path => handler)
const ROUTES = {
  'env': require('../server/routes/env'),
  'health': require('../server/routes/health'),
  'debug/log': require('../server/routes/debug/log'),

  // Vendor bundles served as first-party scripts (avoid 3rd-party storage blocks)
  'vendor/supabase': require('../server/routes/vendor/supabase'),
  'vendor/supabase.js': require('../server/routes/vendor/supabase'),

  // Keep-alive ping for Supabase (prevents project pausing on free plans)
  'keep_alive': require('../server/routes/keep_alive'),
  // Back-compat alias if callers hit /api/keep_alive.js
  'keep_alive.js': require('../server/routes/keep_alive'),

  'mailbox_override/get': require('../server/routes/mailbox_override/get'),
  'mailbox_override/set': require('../server/routes/mailbox_override/set'),

  'mailbox/assign': require('../server/routes/mailbox/assign'),
  'mailbox/confirm': require('../server/routes/mailbox/confirm'),
  'mailbox/case_action': require('../server/routes/mailbox/case_action'),

  'presence/heartbeat': require('../server/routes/presence/heartbeat'),
  'presence/list': require('../server/routes/presence/list'),

  'sync/pull': require('../server/routes/sync/pull'),
  'sync/push': require('../server/routes/sync/push'),

  'theme_access/get': require('../server/routes/theme_access/get'),
  'theme_access/set': require('../server/routes/theme_access/set'),
  'settings/global_theme': require('../server/routes/settings/global_theme'),
  'settings/global-theme': require('../server/routes/settings/global_theme'),
  'settings/global_calendar': require('../server/routes/settings/global_calendar'),
  'calendar/records': require('../server/routes/calendar/records'),
  'catalog/items': require('../server/routes/catalog/items'),
  'catalog/comments': require('../server/routes/catalog/comments'),
  'catalog/history': require('../server/routes/catalog/history'),
  'settings/login_mode': require('../server/routes/settings/login_mode'),
  'settings/mailbox_status': require('../server/routes/settings/mailbox_status'),

  'overall_stats': require('../server/routes/overall_stats'),

  'users/create': require('../server/routes/users/create'),
  'users/ensure_profile': require('../server/routes/users/ensure_profile'),
  'users/list': require('../server/routes/users/list'),
  'users/resolve_email': require('../server/routes/users/resolve_email'),
  'users/me': require('../server/routes/users/me'),
  'users/update_me': require('../server/routes/users/update_me'),
  'users/update_user': require('../server/routes/users/update_user'),
  'users/upload_avatar': require('../server/routes/users/upload_avatar'),
  'users/remove_avatar': require('../server/routes/users/remove_avatar'),
  'users/delete': require('../server/routes/users/delete'),

  'member/schedule': require('../server/routes/member_schedule'),

  'tasks/assigned': require('../server/routes/tasks/assigned'),
  'tasks/distributions': require('../server/routes/tasks/distributions'),
  'tasks/distribution_items': require('../server/routes/tasks/distribution_items'),
  'tasks/item_status': require('../server/routes/tasks/item_status'),
  'tasks/workload_matrix': require('../server/routes/tasks/workload_matrix'),
  'tasks/members': require('../server/routes/tasks/members'),
  'tasks/monitoring': require('../server/routes/tasks/monitoring'),
  'tasks/reassign_pending': require('../server/routes/tasks/reassign_pending'),
  'tasks/distribution_export': require('../server/routes/tasks/distribution_export'),

  'quickbase/monitoring': require('../server/routes/quickbase/monitoring'),
  'quickbase_tabs': require('../server/routes/quickbase_tabs'),
  'quickbase_tabs/upsert': require('../server/routes/quickbase_tabs'),

  // Studio QB — completely isolated from MUMS global QB settings
  'studio/qb_settings': require('../server/routes/studio/qb_settings'),
  'studio/qb_data':     require('../server/routes/studio/qb_data'),
  'studio/yct_data':    require('../server/routes/studio/yct_data'),
  'studio/call_notes':  require('../server/routes/studio/call_notes'),
  'studio/se2_bookmarks': require('../server/routes/studio/se2_bookmarks'),
  'studio/home_apps': require('../server/routes/studio/home_apps'),
  // Back-compat alias for legacy clients still calling /api/home_apps
  'home_apps': require('../server/routes/studio/home_apps'),
  'studio/qb_settings_global': require('../server/routes/studio/qb_settings_global'),
  'studio/qb_monitoring':      require('../server/routes/studio/qb_monitoring'),
  'studio/qb_search':          require('../server/routes/studio/qb_search'),
  'studio/qb_export':          require('../server/routes/studio/qb_export'),
  'studio/cache_manifest':     require('../server/routes/studio/cache_manifest'),
  'studio/cache_bundle':       require('../server/routes/studio/cache_bundle'),
  'studio/csv_settings':       require('../server/routes/studio/csv_settings'),
  'studio/kb_settings':        require('../server/routes/studio/kb_settings'),
  'studio/kb_sync':            require('../server/routes/studio/kb_sync'),
  'studio/kb_download':        require('../server/routes/studio/kb_download'),
  'studio/daily_passwords':    require('../server/routes/studio/daily_passwords'),
  'studio/ctl_lab_config':    require('../server/routes/studio/ctl_lab_config'),
  'studio/ctl_lab_state':     require('../server/routes/studio/ctl_lab_state'),
  'studio/ctl_lab_log':       require('../server/routes/studio/ctl_lab_log'),
  'studio/oncall_settings':   require('../server/routes/studio/oncall_settings'),
  'studio/oncall_schedule':   require('../server/routes/studio/oncall_schedule'),
};

const DYNAMIC_ROUTES = [
  {
    pattern: /^member\/([^/]+)\/schedule$/,
    handler: ROUTES['member/schedule'],
    paramMap: (m) => ({ memberId: decodeURIComponent(m[1] || '') })
  },
  {
    pattern: /^quickbase_tabs\/([^/]+)$/,
    handler: ROUTES['quickbase_tabs'],
    paramMap: (m) => ({ tab_id: decodeURIComponent(m[1] || '') })
  }
];

function resolveRoute(routePath) {
  const exact = ROUTES[routePath];
  if (exact) return { handler: exact, params: {} };
  for (const entry of DYNAMIC_ROUTES) {
    const hit = routePath.match(entry.pattern);
    if (!hit) continue;
    return { handler: entry.handler, params: entry.paramMap(hit) };
  }
  return { handler: null, params: {} };
}

function setRouteCacheHeaders(req, res, routePath) {
  const method = String(req.method || '').toUpperCase();
  if (method !== 'GET') return;
  if (routePath.startsWith('settings/') || routePath.startsWith('catalog/')) {
    res.setHeader('Cache-Control', 'private, max-age=60, stale-while-revalidate=120');
  }
}

async function runAuthMiddleware(req, res, routePath) {
  const authRequiredRoutes = new Set(['sync/pull', 'sync/push']);
  if (!authRequiredRoutes.has(routePath)) return true;

  const auth = req.headers.authorization || '';
  const jwt = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
  const user = await verifyJwtCached(jwt);
  if (!user) {
    sendJson(res, 401, { ok: false, error: 'Unauthorized' });
    return false;
  }
  req.authUser = user;
  return true;
}

module.exports = async (req, res) => {
  try {
    // Prefer rewrite-provided query param `path`.
    let p = req.query && (req.query.path ?? req.query.p);

    // Fallback: derive path from URL (in case rewrites are not applied in some dev setups).
    if (!p) {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      // /api/<path>
      const m = url.pathname.match(/^\/api\/(.*)$/);
      p = m ? m[1] : '';
    }

    const routePath = normalizePath(p);
    const resolved = resolveRoute(routePath);
    const handler = resolved.handler;

    if (!handler) {
      res.setHeader('Cache-Control', 'no-store');
      return sendJson(res, 404, { ok: false, error: 'not_found', path: routePath });
    }

    setRouteCacheHeaders(req, res, routePath);
    const passedAuth = await runAuthMiddleware(req, res, routePath);
    if (!passedAuth) return;

    return await handler(req, res, resolved.params);
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: 'router_failed' });
  }
};
