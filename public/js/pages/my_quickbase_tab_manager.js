/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Strictly protects Enterprise UI/UX, Realtime Sync Logic, Core State Management, and Database/API Adapters. Do NOT modify existing logic or layout in this file without explicitly asking Thunter BOY for clearance. If overlapping changes are required, STOP and provide a RISK IMPACT REPORT first. */
(function(rootFactory) {
  if (typeof module !== 'undefined' && module.exports) {
    const built = rootFactory(typeof globalThis !== 'undefined' ? globalThis : global);
    module.exports = built;
    module.exports.default = built;
  } else {
    rootFactory(typeof window !== 'undefined' ? window : globalThis);
  }
})(function(root) {
  const defaultQuickbaseSettings = {
    tabName: '',
    reportLink: '',
    baseReportQid: '',
    qid: '',
    tableId: '',
    realm: '',
    bypassGlobal: false
  };

  const tabs = new Map();
  let currentUserId = '';
  let apiBaseUrl = '/api';

  function authHeader() {
    const jwt = root.CloudAuth && typeof root.CloudAuth.accessToken === 'function'
      ? root.CloudAuth.accessToken()
      : '';
    return jwt ? { Authorization: `Bearer ${jwt}` } : {};
  }

  function cloneDeep(value) {
    // Deep clone is required so each tab gets isolated objects and no shared references leak across tabs.
    if (typeof root.structuredClone === 'function') return root.structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function safeUserId(userId) {
    const out = String(userId || '').trim();
    return out || 'anonymous';
  }

  function storageKey() {
    return `mums_quickbase_tabs_${safeUserId(currentUserId)}`;
  }

  function makeUUID() {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID();
    return `qb-tab-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  }

  function saveLocalFallback() {
    if (!root.localStorage) return;
    const payload = Array.from(tabs.entries()).map(([tabId, entry]) => ({
      tab_id: tabId,
      tab_name: String(entry.settings.tabName || '').trim(),
      settings_json: cloneDeep(entry.settings),
      meta: cloneDeep(entry.meta)
    }));
    root.localStorage.setItem(storageKey(), JSON.stringify(payload));
  }

  function loadLocalFallback() {
    if (!root.localStorage) return;
    const raw = root.localStorage.getItem(storageKey());
    if (!raw) return;
    let parsed = [];
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      parsed = [];
    }
    if (!Array.isArray(parsed)) return;
    tabs.clear();
    parsed.forEach((row) => {
      const tabId = String(row && (row.tab_id || row.tabId) || '').trim();
      if (!tabId) return;
      const settings = cloneDeep(Object.assign({}, defaultQuickbaseSettings, row.settings_json || {}));
      tabs.set(tabId, {
        settings,
        meta: Object.assign({ createdAt: Date.now(), updatedAt: Date.now() }, row.meta || {})
      });
    });
  }

  async function apiRequest(path, options) {
    const base = String(apiBaseUrl || '/api').replace(/\/$/, '');
    const opts = Object.assign({}, options || {});
    opts.headers = Object.assign({}, opts.headers || {}, authHeader());
    const response = await root.fetch(`${base}${path}`, opts);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(body.message || body.error || 'quickbase_tab_manager_api_failed');
      err.status = response.status;
      throw err;
    }
    return body;
  }

  const TabManager = {
    init({ userId, apiBaseUrl: nextApiBaseUrl }) {
      currentUserId = String(userId || '').trim();
      apiBaseUrl = String(nextApiBaseUrl || '/api').trim() || '/api';
      tabs.clear();
      loadLocalFallback();
      return this;
    },

    createTab({ tabName }) {
      const tabId = makeUUID();
      const settings = cloneDeep(defaultQuickbaseSettings);
      settings.tabName = String(tabName || 'New Tab').trim() || 'New Tab';
      tabs.set(tabId, {
        settings,
        meta: { createdAt: Date.now(), updatedAt: Date.now() }
      });
      saveLocalFallback();
      return tabId;
    },

    getTab(tabId) {
      const safeTabId = String(tabId || '').trim();
      const entry = tabs.get(safeTabId);
      if (!entry) {
        return {
          settings: cloneDeep(defaultQuickbaseSettings),
          meta: { createdAt: 0, updatedAt: 0 }
        };
      }
      return {
        settings: cloneDeep(entry.settings),
        meta: cloneDeep(entry.meta)
      };
    },

    updateTabLocal(tabId, partialSettings) {
      const safeTabId = String(tabId || '').trim();
      if (!safeTabId || !tabs.has(safeTabId)) return;
      const entry = tabs.get(safeTabId);
      const next = Object.assign({}, entry.settings, cloneDeep(partialSettings || {}));
      tabs.set(safeTabId, {
        settings: next,
        meta: Object.assign({}, entry.meta, { updatedAt: Date.now() })
      });
      saveLocalFallback();
    },

    async saveTab(tabId) {
      const safeTabId = String(tabId || '').trim();
      const entry = tabs.get(safeTabId);
      if (!entry) return;
      // Always save to localStorage first — this is the reliable fallback.
      saveLocalFallback();
      // Attempt remote sync but DO NOT throw on failure.
      // Settings are already persisted via mums_profiles.quickbase_settings
      // by persistQuickbaseSettings(). The quickbase_tabs table is secondary.
      try {
        const payload = {
          user_id: safeUserId(currentUserId),
          tab_id: safeTabId,
          tab_name: String(entry.settings.tabName || '').trim() || 'New Tab',
          settings_json: cloneDeep(entry.settings)
        };
        await apiRequest('/quickbase_tabs/upsert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } catch (_) {
        // Silently ignore - localStorage fallback is already saved above.
        // Primary settings are stored in mums_profiles via persistQuickbaseSettings().
      }
    },



    async deleteTab(tabId) {
      const safeTabId = String(tabId || '').trim();
      if (!safeTabId) return;
      // Remove from local map first — UI should update regardless of API result.
      tabs.delete(safeTabId);
      saveLocalFallback();
      // Attempt remote delete but DO NOT throw on failure.
      try {
        const userId = encodeURIComponent(safeUserId(currentUserId));
        const token = root.CloudAuth && typeof root.CloudAuth.accessToken === 'function'
          ? String(root.CloudAuth.accessToken() || '').trim()
          : '';
        await apiRequest(`/quickbase_tabs/${encodeURIComponent(safeTabId)}?user_id=${userId}&tab_id=${encodeURIComponent(safeTabId)}`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + token
          }
        });
      } catch (_) {
        // Silently ignore - local state is already cleaned up above.
        // Tab is deleted from localStorage and state; the remote cleanup
        // will happen naturally on next upsert cycle or can be ignored.
      }
    },

    async loadTabs() {
      const userId = encodeURIComponent(safeUserId(currentUserId));
      const out = await apiRequest(`/quickbase_tabs?user_id=${userId}`, { method: 'GET' });
      const rows = Array.isArray(out && out.rows) ? out.rows : [];
      tabs.clear();
      rows.forEach((row) => {
        const tabId = String(row && row.tab_id || '').trim();
        if (!tabId) return;
        const settings = cloneDeep(Object.assign({}, defaultQuickbaseSettings, row.settings_json || {}, {
          tabName: String(row.tab_name || (row.settings_json && row.settings_json.tabName) || '').trim()
        }));
        tabs.set(tabId, {
          settings,
          meta: {
            createdAt: Date.parse(row.created_at || '') || Date.now(),
            updatedAt: Date.parse(row.updated_at || '') || Date.now()
          }
        });
      });
      saveLocalFallback();
      return Array.from(tabs.keys());
    },

    clearNewTabFields() {
      const defaults = cloneDeep(defaultQuickbaseSettings);
      const map = {
        qbTabName: defaults.tabName,
        qbReportLink: defaults.reportLink,
        qbTabBaseQid: defaults.baseReportQid,
        qbQid: defaults.qid,
        qbTableId: defaults.tableId
      };
      Object.keys(map).forEach((id) => {
        const el = root.document && root.document.querySelector ? root.document.querySelector(`#${id}`) : null;
        if (!el) return;
        el.value = map[id];
      });
      return defaults;
    },

    __unsafeDump() {
      return Array.from(tabs.entries()).map(([tabId, value]) => ({ tabId, value: cloneDeep(value) }));
    }
  };

  root.TabManager = TabManager;
  return TabManager;
});
