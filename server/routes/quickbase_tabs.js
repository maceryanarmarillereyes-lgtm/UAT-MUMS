/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

const { sendJson, serviceSelect, serviceUpsert, serviceFetch, requireAuthedUser } = require('./tasks/_common');

function normalizeUserId(raw) {
  return String(raw || '').trim();
}

function normalizeTabId(raw) {
  return String(raw || '').trim();
}


function tabIdFromUrlPath(url) {
  const raw = String(url || '').split('?')[0];
  const match = raw.match(/\/quickbase_tabs\/([^/]+)$/i);
  return normalizeTabId(match && match[1] ? decodeURIComponent(match[1]) : '');
}

function normalizeRow(row) {
  const src = row && typeof row === 'object' ? row : {};
  const settings = src.settings_json && typeof src.settings_json === 'object' ? src.settings_json : {};
  return {
    user_id: String(src.user_id || '').trim(),
    tab_id: String(src.tab_id || '').trim(),
    tab_name: String(src.tab_name || settings.tabName || '').trim(),
    settings_json: settings,
    created_at: src.created_at || null,
    updated_at: src.updated_at || null
  };
}

async function listTabs(req, res) {
  // Auth check — only allow access to own tabs
  const auth = await requireAuthedUser(req).catch(() => null);
  if (!auth) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
  const userId = normalizeUserId(req?.query?.user_id || auth.authed.id);
  if (!userId) return sendJson(res, 400, { ok: false, error: 'missing_user_id' });

  const q = `select=user_id,tab_id,tab_name,settings_json,created_at,updated_at&user_id=eq.${encodeURIComponent(userId)}&order=updated_at.desc`;
  const out = await serviceSelect('quickbase_tabs', q);
  if (!out.ok) return sendJson(res, 500, { ok: false, error: 'quickbase_tabs_list_failed', details: out.json || out.text });

  const rows = Array.isArray(out.json) ? out.json.map(normalizeRow) : [];
  return sendJson(res, 200, { ok: true, rows });
}

async function getTab(req, res, params) {
  const userId = normalizeUserId(req?.query?.user_id);
  const tabId = normalizeTabId(params?.tab_id || req?.query?.tab_id);
  if (!userId || !tabId) return sendJson(res, 400, { ok: false, error: 'missing_user_or_tab_id' });

  const q = `select=user_id,tab_id,tab_name,settings_json,created_at,updated_at&user_id=eq.${encodeURIComponent(userId)}&tab_id=eq.${encodeURIComponent(tabId)}&limit=1`;
  const out = await serviceSelect('quickbase_tabs', q);
  if (!out.ok) return sendJson(res, 500, { ok: false, error: 'quickbase_tabs_get_failed', details: out.json || out.text });

  const row = Array.isArray(out.json) && out.json[0] ? normalizeRow(out.json[0]) : null;
  return sendJson(res, 200, { ok: true, row });
}

async function upsertTab(req, res) {
  const body = req && req.body && typeof req.body === 'object' ? req.body : {};
  const userId = normalizeUserId(body.user_id);
  const tabId = normalizeTabId(body.tab_id);
  const tabName = String(body.tab_name || '').trim();
  const settingsJson = body.settings_json && typeof body.settings_json === 'object' ? body.settings_json : {};

  if (!userId || !tabId) return sendJson(res, 400, { ok: false, error: 'missing_user_or_tab_id' });

  const row = {
    user_id: userId,
    tab_id: tabId,
    tab_name: tabName,
    settings_json: settingsJson,
    updated_at: new Date().toISOString()
  };

  const out = await serviceUpsert('quickbase_tabs', [row], 'user_id,tab_id');
  if (!out.ok) return sendJson(res, 500, { ok: false, error: 'quickbase_tabs_upsert_failed', details: out.json || out.text });

  const saved = Array.isArray(out.json) && out.json[0] ? normalizeRow(out.json[0]) : normalizeRow(row);
  return sendJson(res, 200, { ok: true, row: saved });
}

async function deleteTab(req, res, params) {
  const userId = normalizeUserId(req?.query?.user_id || req?.body?.user_id);
  const tabId = normalizeTabId(params?.tab_id || req?.query?.tab_id || req?.body?.tab_id || tabIdFromUrlPath(req?.url));
  if (!userId || !tabId) return sendJson(res, 400, { ok: false, error: 'missing_user_or_tab_id' });

  const q = `user_id=eq.${encodeURIComponent(userId)}&tab_id=eq.${encodeURIComponent(tabId)}`;
  const out = await serviceFetch(`/rest/v1/quickbase_tabs?${q}`, { method: 'DELETE' });
  if (!out.ok) return sendJson(res, 500, { ok: false, error: 'quickbase_tabs_delete_failed', details: out.json || out.text });

  return sendJson(res, 200, { ok: true, deleted: { user_id: userId, tab_id: tabId } });
}

module.exports = async (req, res, params) => {
  try {
    const method = String(req?.method || 'GET').toUpperCase();

    if (method === 'GET' && params && params.tab_id) return getTab(req, res, params);
    if (method === 'GET') return listTabs(req, res);
    if (method === 'DELETE') return deleteTab(req, res, params);
    if (method === 'POST') {
      const p = String(params && params.tab_id || '').trim();
      const routePath = String(req?.query?.path || '').trim();
      if (p || /quickbase_tabs\/upsert$/i.test(routePath) || /\/upsert$/i.test(String(req?.url || ''))) {
        return upsertTab(req, res);
      }
      return upsertTab(req, res);
    }

    return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: 'quickbase_tabs_failed', message: String(err && err.message ? err.message : err) });
  }
};
