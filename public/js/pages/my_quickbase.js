/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Strictly protects Enterprise UI/UX, Realtime Sync Logic, Core State Management, and Database/API Adapters. Do NOT modify existing logic or layout in this file without explicitly asking Thunter BOY for clearance. If overlapping changes are required, STOP and provide a RISK IMPACT REPORT first. */
/**
 * public/js/pages/my_quickbase.js
 * High Level Enterprise Quickbase Dashboard + Settings Modal
 */
(function(){
  window.Pages = window.Pages || {};

  function esc(v) {
    if (window.UI && typeof window.UI.esc === 'function') return window.UI.esc(v);
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  const ENABLE_QID_URL_MATCH_VALIDATION = true;

  function parseQuickbaseReportUrl(url) {
    const value = String(url || '').trim();
    if (!value) return null;
    try {
      const u = new URL(value);
      const segments = String(u.pathname || '').split('/').filter(Boolean);
      const appIndex = segments.findIndex((segment) => String(segment).toLowerCase() === 'app');
      const tableIndex = segments.findIndex((segment) => String(segment).toLowerCase() === 'table');
      const appId = appIndex >= 0 ? String(segments[appIndex + 1] || '').trim() : '';
      const tableId = tableIndex >= 0
        ? String(segments[tableIndex + 1] || '').trim()
        : (() => {
          const dbIndex = segments.findIndex((segment) => String(segment).toLowerCase() === 'db');
          return dbIndex >= 0 ? String(segments[dbIndex + 1] || '').trim() : '';
        })();
      const rawQid = String(u.searchParams.get('qid') || '').trim();
      const qidMatch = rawQid.match(/-?\d+/);
      const qid = qidMatch && qidMatch[0] ? qidMatch[0] : '';
      const out = {};
      if (appId) out.appId = appId;
      if (tableId) out.tableId = tableId;
      if (qid) out.qid = qid;
      return Object.keys(out).length ? out : null;
    } catch (_) {
      return null;
    }
  }

  function parseQuickbaseLink(link) {
    const out = { realm: '', appId: '', tableId: '', qid: '' };
    const value = String(link || '').trim();
    if (!value) return out;

    const parsedGeneric = parseQuickbaseReportUrl(value);
    if (parsedGeneric) {
      out.appId = String(parsedGeneric.appId || '').trim();
      out.tableId = String(parsedGeneric.tableId || '').trim();
      out.qid = String(parsedGeneric.qid || '').trim();
    }

    try {
      const urlObj = new URL(value);
      const host = String(urlObj.hostname || '').trim().toLowerCase();
      const realmMatch = host.match(/^([a-z0-9-]+)\.quickbase\.com$/i);
      out.realm = realmMatch && realmMatch[1] ? String(realmMatch[1]).trim() : host;
    } catch (_) {}
    const dbMatch = value.match(/\/db\/([a-zA-Z0-9]+)/i);
    if (dbMatch && dbMatch[1]) out.tableId = String(dbMatch[1]).trim();
    if (!out.tableId) {
      const tableMatch = value.match(/\/table\/([a-zA-Z0-9]+)/i);
      if (tableMatch && tableMatch[1]) out.tableId = String(tableMatch[1]).trim();
    }
    if (!out.qid) {
      const qidParamMatch = value.match(/[?&]qid=(-?\d+)/i);
      if (qidParamMatch && qidParamMatch[1]) out.qid = String(qidParamMatch[1]).trim();
    }
    if (!out.qid) {
      const reportMatch = value.match(/\/report\/(-?\d+)/i);
      if (reportMatch && reportMatch[1]) out.qid = String(reportMatch[1]).trim();
    }
    return out;
  }

  function normalizeFilters(raw) {
    const operatorMap = {
      'IS EQUAL TO': 'EX',
      'IS (EXACT)': 'EX',
      EX: 'EX',
      '=': 'EX',
      'IS NOT': 'XEX',
      'NOT EQUAL TO': 'XEX',
      'IS NOT EQUAL TO': 'XEX',
      XEX: 'XEX',
      '!=': 'XEX',
      '<>': 'XEX',
      CONTAINS: 'CT',
      CT: 'CT',
      'DOES NOT CONTAIN': 'XCT',
      XCT: 'XCT'
    };
    const toOperator = (value) => {
      const key = String(value == null ? 'EX' : value).trim().toUpperCase();
      return operatorMap[key] || key || 'EX';
    };
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((f) => f && typeof f === 'object')
      .map((f) => ({
        fieldId: String((f.fieldId ?? f.field_id ?? f.fid ?? f.id ?? '')).trim(),
        operator: toOperator(f.operator),
        value: String((f.value ?? '')).trim()
      }))
      .filter((f) => f.fieldId && f.value);
  }

  function normalizeFilterMatch(raw) {
    const value = String(raw || '').trim().toUpperCase();
    return value === 'ANY' ? 'ANY' : 'ALL';
  }

  function normalizeCounterColor(value) {
    const allowedColors = new Set(['default', 'blue', 'green', 'red', 'purple', 'orange']);
    const normalized = String(value || 'default').trim().toLowerCase();
    return allowedColors.has(normalized) ? normalized : 'default';
  }

  function normalizeDashboardCounters(raw) {
    let source = raw;
    if (typeof source === 'string') {
      try {
        source = JSON.parse(source);
      } catch (_) {
        source = [];
      }
    }
    if (!Array.isArray(source)) return [];
    const allowedOperators = new Set(['EX', 'XEX', 'CT']);
    const operatorMap = {
      'IS EQUAL TO': 'EX',
      '=': 'EX',
      EX: 'EX',
      'IS NOT EQUAL TO': 'XEX',
      'IS NOT': 'XEX',
      '!=': 'XEX',
      XEX: 'XEX',
      CONTAINS: 'CT',
      CT: 'CT'
    };
    return source
      .filter((item) => item && typeof item === 'object')
      .map((item) => {
        const opKey = String(item.operator || '').trim().toUpperCase();
        const normalizedOperator = operatorMap[opKey] || opKey || 'EX';
        return {
          fieldId: String(item.fieldId ?? item.field_id ?? '').trim(),
          operator: allowedOperators.has(normalizedOperator) ? normalizedOperator : 'EX',
          value: String(item.value ?? '').trim(),
          label: String(item.label ?? '').trim(),
          color: normalizeCounterColor(item.color)
        };
      })
      .filter((item) => item.fieldId);
  }

  function getCounterGlassStyle(color) {
    const palette = {
      blue: 'background: rgba(33, 150, 243, 0.1); border: 1px solid rgba(33, 150, 243, 0.3); box-shadow: 0 4px 15px rgba(33, 150, 243, 0.1);',
      green: 'background: rgba(76, 175, 80, 0.1); border: 1px solid rgba(76, 175, 80, 0.3); box-shadow: 0 4px 15px rgba(76, 175, 80, 0.1);',
      red: 'background: rgba(244, 67, 54, 0.1); border: 1px solid rgba(244, 67, 54, 0.3); box-shadow: 0 4px 15px rgba(244, 67, 54, 0.1);',
      purple: 'background: rgba(156, 39, 176, 0.1); border: 1px solid rgba(156, 39, 176, 0.3); box-shadow: 0 4px 15px rgba(156, 39, 176, 0.1);',
      orange: 'background: rgba(255, 152, 0, 0.1); border: 1px solid rgba(255, 152, 0, 0.3); box-shadow: 0 4px 15px rgba(255, 152, 0, 0.1);',
      default: 'background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12); box-shadow: 0 4px 15px rgba(255,255,255,0.05);'
    };
    return palette[normalizeCounterColor(color)] || palette.default;
  }

  function counterToFilter(counter) {
    if (!counter || typeof counter !== 'object') return null;
    const fieldId = String(counter.fieldId || '').trim();
    const value = String(counter.value || '').trim();
    const operator = String(counter.operator || 'EX').trim().toUpperCase();
    if (!fieldId || !value) return null;
    return { fieldId, operator, value };
  }

  function rowsToCsv(rows, columns) {
    const safeRows = Array.isArray(rows) ? rows : [];
    const safeColumns = Array.isArray(columns) ? columns : [];
    const headers = ['Case #'].concat(safeColumns.map((c) => String(c && c.label || c && c.id || 'Field')));
    const escapeCsv = (value) => {
      const text = String(value == null ? '' : value);
      const escaped = text.replace(/"/g, '""');
      if (/[,\n"]/g.test(escaped)) return `"${escaped}"`;
      return escaped;
    };
    const body = safeRows.map((row) => {
      const list = [String(row && row.qbRecordId || 'N/A')];
      safeColumns.forEach((col) => {
        const fid = String(col && col.id || '').trim();
        const val = row && row.fields && row.fields[fid] ? row.fields[fid].value : '';
        list.push(String(val == null ? '' : val));
      });
      return list.map(escapeCsv).join(',');
    });
    return [headers.map(escapeCsv).join(',')].concat(body).join('\n');
  }


  function parseQuickbaseSettings(raw) {
    if (!raw) return {};
    if (typeof raw === 'object') return raw;
    try {
      const parsed = JSON.parse(String(raw));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function generateUUID() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    } catch (_) {}
    return `qb-tab-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  }

  function deepClone(obj) {
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch (_) {
      return obj;
    }
  }

  function createDefaultSettings(source, defaults) {
    const src = source && typeof source === 'object' ? source : {};
    const base = defaults && typeof defaults === 'object' ? defaults : {};
    const reportLink = String(src.reportLink || src.qb_report_link || base.reportLink || '').trim();
    const parsed = parseQuickbaseLink(reportLink);
    const hasReportLink = !!reportLink;
    return {
      reportLink,
      qid: hasReportLink ? String(src.qid || src.qb_qid || parsed.qid || base.qid || '').trim() : '',
      tableId: hasReportLink ? String(src.tableId || src.qb_table_id || parsed.tableId || base.tableId || '').trim() : '',
      realm: hasReportLink ? String(src.realm || src.qb_realm || parsed.realm || base.realm || '').trim() : '',
      // bypassGlobal: when true, this tab uses its own reportLink + profile.qb_token
      // instead of the Global QB Settings. Each tab is independent.
      bypassGlobal: !!(src.bypassGlobal || base.bypassGlobal || false),
      dashboard_counters: deepClone(normalizeDashboardCounters(src.dashboard_counters || src.dashboardCounters || base.dashboard_counters || [])),
      customColumns: deepClone(Array.isArray(src.customColumns || src.qb_custom_columns || base.customColumns)
        ? (src.customColumns || src.qb_custom_columns || base.customColumns).map((v) => String(v))
        : []),
      customFilters: deepClone(normalizeFilters(src.customFilters || src.qb_custom_filters || base.customFilters || [])),
      filterMatch: normalizeFilterMatch(src.filterMatch || src.qb_filter_match || base.filterMatch)
    };
  }

  function createTabMeta(source, defaults) {
    const src = source && typeof source === 'object' ? source : {};
    const base = defaults && typeof defaults === 'object' ? defaults : {};
    return {
      id: String(src.id || src.tabId || base.id || generateUUID()),
      tabName: String(src.tabName || src.name || base.tabName || 'Main Report').trim() || 'Main Report'
    };
  }

  function buildDefaultTab(source, defaults) {
    const src = source && typeof source === 'object' ? deepClone(source) : {};
    const base = defaults && typeof defaults === 'object' ? deepClone(defaults) : {};
    const reportLink = String(src.reportLink || src.qb_report_link || '').trim();
    const parsed = parseQuickbaseLink(reportLink);
    const hasReportLink = !!reportLink;
    return {
      id: String(src.id || generateUUID()),
      tabName: String(src.tabName || src.name || base.tabName || 'New Report').trim() || 'New Report',
      reportLink,
      qid: hasReportLink ? String(src.qid || src.qb_qid || parsed.qid || '').trim() : '',
      tableId: hasReportLink ? String(src.tableId || src.qb_table_id || parsed.tableId || '').trim() : '',
      realm: hasReportLink ? String(src.realm || src.qb_realm || parsed.realm || '').trim() : '',
      bypassGlobal: !!(src.bypassGlobal || base.bypassGlobal || false),
      dashboard_counters: deepClone(normalizeDashboardCounters(src.dashboard_counters || src.dashboardCounters || [])),
      customColumns: deepClone(Array.isArray(src.customColumns || src.qb_custom_columns) ? (src.customColumns || src.qb_custom_columns).map((v) => String(v)) : []),
      customFilters: deepClone(normalizeFilters(src.customFilters || src.qb_custom_filters || [])),
      filterMatch: normalizeFilterMatch(src.filterMatch || src.qb_filter_match || 'ALL')
    };
  }

  function normalizeQuickbaseSettingsWithTabs(rawSettings, fallbackConfig) {
    const flat = normalizeQuickbaseConfig(fallbackConfig);
    const rawMissing = rawSettings == null;
    let parseFailed = false;
    let settings = {};
    if (!rawMissing && typeof rawSettings === 'string') {
      try {
        const parsed = JSON.parse(String(rawSettings));
        settings = parsed && typeof parsed === 'object' ? parsed : {};
      } catch (_) {
        parseFailed = true;
      }
    } else {
      settings = parseQuickbaseSettings(rawSettings);
    }

    // FIX: [Issue 1] - Preserve tab-based settings when serialized quickbase_settings has a tabs array.
    if (!parseFailed && Array.isArray(settings.tabs)) {
      const tabs = [];
      const settingsByTabId = {};
      settings.tabs.forEach((tab, idx) => {
        const tabMeta = createTabMeta(tab, { tabName: idx === 0 ? 'Main Report' : `Report ${idx + 1}` });
        const tabSettings = createDefaultSettings(tab, {});
        const isolatedTabSettings = createDefaultSettings(tabSettings, {});
        tabs.push(Object.assign({}, tabMeta, deepClone(isolatedTabSettings) || createDefaultSettings({}, {})));
        settingsByTabId[tabMeta.id] = deepClone(isolatedTabSettings) || createDefaultSettings({}, {});
      });
      // FIX: [Issue 1] - Defensive default when tabs array exists but is empty.
      const safeTabs = tabs.length ? tabs : [buildDefaultTab(settings, { tabName: 'Main Report' })];
      if (!tabs.length) settingsByTabId[safeTabs[0].id] = createDefaultSettings(settings, {});
      const maxIndex = safeTabs.length - 1;
      const activeTabIndex = Math.min(Math.max(Number(settings.activeTabIndex || 0), 0), maxIndex);
      return { activeTabIndex, tabs: safeTabs, settingsByTabId };
    }

    if (!rawMissing && parseFailed) {
      const tab = buildDefaultTab({}, { tabName: 'Main Report' });
      return { activeTabIndex: 0, tabs: [tab], settingsByTabId: { [tab.id]: createDefaultSettings({}, {}) } };
    }

    const primaryTab = buildDefaultTab(settings, { tabName: 'Main Report' });
    return {
      activeTabIndex: 0,
      tabs: [primaryTab],
      settingsByTabId: {
        [primaryTab.id]: createDefaultSettings(settings, {
          reportLink: flat.reportLink,
          qid: flat.qid,
          tableId: flat.tableId,
          customColumns: flat.customColumns,
          customFilters: flat.customFilters,
          filterMatch: flat.filterMatch,
          dashboard_counters: flat.dashboardCounters
        })
      }
    };
  }

  function normalizeQuickbaseConfig(raw) {
    const cfg = raw && typeof raw === 'object' ? raw : {};
    return {
      reportLink: String(cfg.reportLink || cfg.qb_report_link || '').trim(),
      qid: String(cfg.qid || cfg.qb_qid || '').trim(),
      tableId: String(cfg.tableId || cfg.qb_table_id || '').trim(),
      realm: String(cfg.realm || cfg.qb_realm || '').trim(),
      customColumns: Array.isArray(cfg.customColumns || cfg.qb_custom_columns)
        ? (cfg.customColumns || cfg.qb_custom_columns).map((v) => String(v))
        : [],
      customFilters: normalizeFilters(cfg.customFilters || cfg.qb_custom_filters),
      filterMatch: normalizeFilterMatch(cfg.filterMatch || cfg.qb_filter_match),
      dashboardCounters: normalizeDashboardCounters(cfg.dashboardCounters || cfg.dashboard_counters || cfg.qb_dashboard_counters)
    };
  }

  function hasUsableQuickbaseSettings(rawSettings) {
    const parsed = parseQuickbaseSettings(rawSettings);
    if (Array.isArray(parsed && parsed.tabs) && parsed.tabs.length > 0) return true;
    const cfg = normalizeQuickbaseConfig(parsed);
    return Boolean(
      String(cfg.reportLink || '').trim() ||
      String(cfg.qid || '').trim() ||
      String(cfg.tableId || '').trim() ||
      (Array.isArray(cfg.customColumns) && cfg.customColumns.length) ||
      (Array.isArray(cfg.customFilters) && cfg.customFilters.length) ||
      (Array.isArray(cfg.dashboardCounters) && cfg.dashboardCounters.length)
    );
  }

  function chooseInitialQuickbaseSettingsSource(options) {
    const opts = options && typeof options === 'object' ? options : {};
    const hasBackendTabs = hasPersistedQuickbaseTabs(opts.backendQuickbaseSettings);
    const hasWindowMeTabs = hasPersistedQuickbaseTabs(opts.windowMeQuickbaseSettings);
    // ISOLATION FIX: Always prefer backend (Supabase) as the authoritative source.
    // Backend tab IDs are the canonical IDs — local cache may have mismatched IDs
    // causing settingsByTabId lookups to fail on tab switch.
    if (hasBackendTabs) return deepClone(opts.backendQuickbaseSettings);
    if (hasWindowMeTabs) return deepClone(opts.windowMeQuickbaseSettings);
    // Only use local if backend has no usable config
    const hasLocalTabs = hasPersistedQuickbaseTabs(opts.localQuickbaseSettings);
    if (hasLocalTabs) return deepClone(opts.localQuickbaseSettings);
    return deepClone(opts.backendQuickbaseSettings);
  }

  function getQuickbaseSettingsLocalKey(userId) {
    const safeUserId = String(userId || 'anonymous').trim() || 'anonymous';
    return `mums_my_quickbase_settings:${safeUserId}`;
  }

  function getQuickbaseTabsLocalKey(userId) {
    const safeUserId = String(userId || 'anonymous').trim() || 'anonymous';
    return `myQuickbase.tabs:${safeUserId}`;
  }

  function getQuickbaseTabSettingsLocalKey(userId, tabId) {
    const safeUserId = String(userId || 'anonymous').trim() || 'anonymous';
    const safeTabId = String(tabId || '').trim();
    return `myQuickbase.tab.${safeUserId}.${safeTabId}.settings`;
  }

  function readQuickbaseSettingsLocal(userId) {
    try {
      if (!window.localStorage) return null;
      const rawTabs = localStorage.getItem(getQuickbaseTabsLocalKey(userId));
      if (rawTabs) {
        const parsedTabs = JSON.parse(rawTabs);
        const tabs = Array.isArray(parsedTabs && parsedTabs.tabs) ? parsedTabs.tabs.map((tab, idx) => createTabMeta(tab, { tabName: idx === 0 ? 'Main Report' : `Report ${idx + 1}` })) : [];
        if (!tabs.length) return null;
        const settingsByTabId = {};
        const hydratedTabs = [];
        tabs.forEach((tab) => {
          const tabSettingsRaw = localStorage.getItem(getQuickbaseTabSettingsLocalKey(userId, tab.id));
          const parsedSettings = parseQuickbaseSettings(tabSettingsRaw);
          const normalizedSettings = createDefaultSettings(parsedSettings, {});
          settingsByTabId[tab.id] = deepClone(normalizedSettings) || createDefaultSettings({}, {});
          hydratedTabs.push(Object.assign({}, tab, deepClone(normalizedSettings) || createDefaultSettings({}, {})));
        });
        const maxIndex = tabs.length - 1;
        const activeTabIndex = Math.min(Math.max(Number(parsedTabs && parsedTabs.activeTabIndex || 0), 0), maxIndex);
        return { activeTabIndex, tabs: hydratedTabs, settingsByTabId };
      }

      const rawLegacy = localStorage.getItem(getQuickbaseSettingsLocalKey(userId));
      if (!rawLegacy) return null;
      const parsed = JSON.parse(rawLegacy);
      const settings = parsed && typeof parsed === 'object' && parsed.settings ? parsed.settings : parsed;
      return normalizeQuickbaseSettingsWithTabs(settings, {});
    } catch (_) {
      return null;
    }
  }

  function writeQuickbaseSettingsLocal(userId, settings) {
    try {
      if (!window.localStorage) return;
      const normalized = normalizeQuickbaseSettingsWithTabs(settings, {});
      const payload = {
        savedAt: Date.now(),
        activeTabIndex: normalized.activeTabIndex,
        tabs: normalized.tabs.map((tab) => {
          const tabMeta = createTabMeta(tab, {});
          const tabId = String(tabMeta.id || '').trim();
          const tabSettings = normalized.settingsByTabId && normalized.settingsByTabId[tabId]
            ? normalized.settingsByTabId[tabId]
            : createDefaultSettings(tab, {});
          return buildDefaultTab(Object.assign({}, tabMeta, tabSettings), {});
        })
      };
      localStorage.setItem(getQuickbaseTabsLocalKey(userId), JSON.stringify(payload));
      normalized.tabs.forEach((tab) => {
        const tabId = String(tab.id || '').trim();
        if (!tabId) return;
        const tabSettings = normalized.settingsByTabId && normalized.settingsByTabId[tabId]
          ? normalized.settingsByTabId[tabId]
          : createDefaultSettings({}, {});
        localStorage.setItem(getQuickbaseTabSettingsLocalKey(userId, tabId), JSON.stringify(tabSettings));
      });
    } catch (_) {}
  }

  function getProfileQuickbaseConfig(profile) {
    const p = profile && typeof profile === 'object' ? profile : {};
    const quickbaseSettings = parseQuickbaseSettings(p.quickbase_settings);
    const quickbaseConfig = parseQuickbaseSettings(p.quickbase_config);
    const settingsFromTabs = Array.isArray(quickbaseSettings.tabs) && quickbaseSettings.tabs.length
      ? (() => {
        const maxIndex = quickbaseSettings.tabs.length - 1;
        const idx = Math.min(Math.max(Number(quickbaseSettings.activeTabIndex || 0), 0), maxIndex);
        return quickbaseSettings.tabs[idx] || quickbaseSettings.tabs[0] || {};
      })()
      : null;
    const source = Object.keys(quickbaseSettings).length
      ? (settingsFromTabs || quickbaseSettings)
      : Object.keys(quickbaseConfig).length
        ? quickbaseConfig
        : normalizeQuickbaseConfig(p);
    return normalizeQuickbaseConfig(source);
  }

  function hasPersistedQuickbaseTabs(settings) {
    if (!settings || !Array.isArray(settings.tabs)) return false;
    return settings.tabs.some((tab) => {
      const rawTab = tab && typeof tab === 'object' ? tab : {};
      const normalizedTab = createDefaultSettings(rawTab, {});
      const hasReportConfig = !!String(normalizedTab.reportLink || normalizedTab.qid || normalizedTab.tableId || '').trim();
      const hasCustomColumns = Array.isArray(normalizedTab.customColumns) && normalizedTab.customColumns.length > 0;
      const hasFilterConfig = Array.isArray(normalizedTab.customFilters) && normalizedTab.customFilters.length > 0;
      const hasDashboardCounters = Array.isArray(normalizedTab.dashboard_counters) && normalizedTab.dashboard_counters.length > 0;
      return hasReportConfig || hasCustomColumns || hasFilterConfig || hasDashboardCounters;
    });
  }


  function renderDashboardCounters(root, records, settings, state, onCounterToggle) {
    const host = root.querySelector('#qbDashboardCounters');
    if (!host) return;
    try {
      const rows = Array.isArray(records) ? records : [];
      const dashboardCounters = normalizeDashboardCounters(settings && settings.dashboard_counters);
      if (!dashboardCounters.length) {
        host.innerHTML = '';
        host.classList.remove('qb-counters-many');
        return;
      }
      // Smart sizing: when >4 counters, switch to fill mode so they share space evenly
      if (dashboardCounters.length > 4) {
        host.classList.add('qb-counters-many');
      } else {
        host.classList.remove('qb-counters-many');
      }
      const widgets = dashboardCounters.map((counter, widgetsIndex) => {
        const matcherValue = String(counter.value || '').toLowerCase();
        const matchedRows = rows.filter((record) => {
          const fields = record && record.fields ? record.fields : {};
          const field = fields[String(counter.fieldId)] || null;
          const sourceValue = String(field && field.value != null ? field.value : '').toLowerCase();
          if (counter.operator === 'XEX') return sourceValue !== matcherValue;
          if (counter.operator === 'CT') return sourceValue.includes(matcherValue);
          return sourceValue === matcherValue;
        });

        const label = counter.label || 'N/A';
        return `
          <div class="qb-counter-widget ${state && state.activeCounterIndex === widgetsIndex ? 'is-active' : ''}" data-counter-idx="${widgetsIndex}" style="${getCounterGlassStyle(counter.color)}">
            <div class="qb-counter-label">${esc(label)}</div>
            <div class="qb-counter-value">${esc(String(matchedRows.length))}</div>
          </div>
        `;
      }).join('');

      host.innerHTML = widgets;
      host.querySelectorAll('[data-counter-idx]').forEach((el) => {
        el.onclick = () => {
          if (typeof onCounterToggle === 'function') onCounterToggle(Number(el.getAttribute('data-counter-idx')));
        };
      });
    } catch (_) {
      host.innerHTML = '';
    }
  }

  function renderRecords(root, payload, options) {
    const host = root.querySelector('#qbDataBody');
    const meta = root.querySelector('#qbDataMeta');
    if (!host || !meta) return;

    const columns = Array.isArray(payload && payload.columns) ? payload.columns : [];
    const rows = Array.isArray(payload && payload.records) ? payload.records : [];
    const opts = options && typeof options === 'object' ? options : {};

    if (!columns.length || !rows.length) {
      const emptyBySearch = !!opts.userInitiatedSearch;
      meta.textContent = 'No Quickbase Records Found';
      host.innerHTML = `<div class="card pad"><div class="small muted">${emptyBySearch ? 'No records match your filters.' : 'No records loaded. Open ⚙️ Settings to configure report, columns, and filters.'}</div></div>`;
      return;
    }

    const pageSize = Number(opts.pageSize || 100);
    const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
    const activePage = Math.min(Math.max(Number(opts.page || 1), 1), totalPages);
    // FIX: [Issue 2] - Pagination for large record sets to avoid DOM-heavy render blocking.
    const visibleRows = rows.slice((activePage - 1) * pageSize, activePage * pageSize);
    meta.innerHTML = `${rows.length} record${rows.length === 1 ? '' : 's'} loaded${rows.length > pageSize ? ` • Page ${activePage}/${totalPages}` : ''}`;
    const toDurationLabel = (value) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric < 0) return String(value == null ? 'N/A' : value);
      const hours = numeric / (1000 * 60 * 60);
      if (hours < 24) {
        const roundedHours = Math.max(1, Math.round(hours));
        return `${roundedHours} hr${roundedHours === 1 ? '' : 's'}`;
      }
      const days = Math.floor(hours / 24);
      const remainingHours = Math.round(hours - (days * 24));
      if (remainingHours <= 0) return `${days} day${days === 1 ? '' : 's'}`;
      return `${days} day${days === 1 ? '' : 's'} ${remainingHours} hr${remainingHours === 1 ? '' : 's'}`;
    };

    const headers = columns.map((c) => `<th>${esc(c.label || c.id || 'Field')}</th>`).join('');
    const rowStartIndex = (activePage - 1) * pageSize;

    // ── SCROLL POSITION SAVE ─────────────────────────────────────────────────
    // Capture current scroll before innerHTML wipes the DOM. This prevents
    // auto-refresh (10s interval) and realtime data updates from jumping the
    // user back to the top while they're actively scrolling through records.
    const existingTableInner = host.querySelector('.qb-table-inner');
    const savedScrollTop  = existingTableInner ? existingTableInner.scrollTop  : 0;
    const savedScrollLeft = existingTableInner ? existingTableInner.scrollLeft : 0;

    // ── CASE STATUS COLOR BADGE RENDERER ────────────────────────────────
    function renderStatusBadge(rawStatus) {
      const s = String(rawStatus || '').trim();
      if (!s || s === 'N/A') return `<span class="qb-status-badge qb-status-default">${esc(s || '—')}</span>`;
      const sl = s.toLowerCase();
      let cls = 'qb-status-default';
      if (sl.includes('investigating'))                                 cls = 'qb-status-investigating';
      else if (sl.includes('waiting for customer') || sl.includes('waiting'))  cls = 'qb-status-waiting';
      else if (sl.includes('soft close') || sl.includes('soft-close')) cls = 'qb-status-soft-close';
      else if (sl.includes('initial inquiry'))                          cls = 'qb-status-initial';
      else if (sl.includes('response received') || sl.includes('for support')) cls = 'qb-status-response';
      else if (sl.includes('closed') || sl.startsWith('c -'))          cls = 'qb-status-closed';
      else if (sl.startsWith('s -'))                                    cls = 'qb-status-soft-close';
      else if (sl.startsWith('o -'))                                    cls = 'qb-status-investigating';
      return `<span class="qb-status-badge ${cls}"><span class="qb-status-dot"></span>${esc(s)}</span>`;
    }

    const body = visibleRows.map((r, rowIdx) => {
      const globalRowNum = rowStartIndex + rowIdx + 1;
      const cells = columns.map((c) => {
        const field = r && r.fields ? r.fields[String(c.id)] : null;
        const rawValue = field && field.value != null ? field.value : 'N/A';
        const normalizedLabel = String(c && c.label || '').trim().toLowerCase();
        // Case Status gets color badge treatment
        if (normalizedLabel === 'case status' || normalizedLabel === 'status') {
          return `<td>${renderStatusBadge(String(rawValue))}</td>`;
        }
        const value = (normalizedLabel === 'last update days' || normalizedLabel === 'age')
          ? toDurationLabel(rawValue)
          : String(rawValue);
        return `<td>${esc(value)}</td>`;
      }).join('');
      return `<tr><td class="qb-row-num-cell"><span class="qb-row-num-pill">${globalRowNum}</span></td><td class="qb-case-id">${esc(String(r && r.qbRecordId || 'N/A'))}</td>${cells}</tr>`;
    }).join('');

    host.innerHTML = `<div class="qb-table-inner"><table class="qb-data-table"><thead><tr><th class="qb-row-num-th">#</th><th>Case #</th>${headers}</tr></thead><tbody>${body}</tbody></table></div>`;
    // ── SCROLL POSITION PRESERVATION ──────────────────────────────────────────
    // After innerHTML replaces the inner DOM, restore saved scroll so that
    // auto-refresh (every 10s) and data updates don't jump the user back to top.
    if (savedScrollTop > 0 || savedScrollLeft > 0) {
      const newTableInner = host.querySelector('.qb-table-inner');
      if (newTableInner) {
        newTableInner.scrollTop = savedScrollTop;
        newTableInner.scrollLeft = savedScrollLeft;
      }
    }
    if (rows.length > pageSize && typeof opts.onPageChange === 'function') {
      const pager = document.createElement('div');
      pager.style.cssText = 'display:flex;gap:8px;align-items:center;justify-content:flex-end;margin-top:8px;';
      pager.innerHTML = `
        <button type="button" class="btn" data-page-nav="prev" ${activePage <= 1 ? 'disabled' : ''}>Prev</button>
        <span class="small muted">Page ${activePage} of ${totalPages}</span>
        <button type="button" class="btn" data-page-nav="next" ${activePage >= totalPages ? 'disabled' : ''}>Next</button>
      `;
      host.appendChild(pager);
      pager.querySelectorAll('[data-page-nav]').forEach((btn) => {
        btn.onclick = () => {
          const direction = btn.getAttribute('data-page-nav');
          const nextPage = direction === 'next' ? activePage + 1 : activePage - 1;
          opts.onPageChange(nextPage);
        };
      });
    }
  }

  function renderEmptyState(root, message) {
    const host = root.querySelector('#qbDataBody');
    const meta = root.querySelector('#qbDataMeta');
    if (meta) meta.textContent = 'No Quickbase Records Found';
    if (host) host.innerHTML = `<div class="card pad"><div class="small muted">${esc(String(message || 'No records loaded.'))}</div></div>`;
  }


  function shouldApplyInitialFilters(searchInput) {
    return String(searchInput || '').trim().length > 0;
  }

  function filterRecordsBySearch(payload, searchTerm) {
    const source = payload && typeof payload === 'object' ? payload : {};
    const columns = Array.isArray(source.columns) ? source.columns : [];
    const records = Array.isArray(source.records) ? source.records : [];
    const term = String(searchTerm || '').trim().toLowerCase();
    if (!term) {
      return { columns, records };
    }

    const filtered = records.filter((row) => {
      const caseId = String(row && row.qbRecordId || '').toLowerCase();
      if (caseId.includes(term)) return true;
      return columns.some((col) => {
        const fid = String(col && col.id || '').trim();
        if (!fid) return false;
        const cellValue = row && row.fields && row.fields[fid] ? row.fields[fid].value : '';
        return String(cellValue == null ? '' : cellValue).toLowerCase().includes(term);
      });
    });

    return { columns, records: filtered };
  }

  function filterRecordsByCounter(payload, counter) {
    const source = payload && typeof payload === 'object' ? payload : {};
    const columns = Array.isArray(source.columns) ? source.columns : [];
    const records = Array.isArray(source.records) ? source.records : [];
    const activeFilter = counterToFilter(counter);
    if (!activeFilter) return { columns, records };

    const targetFieldId = String(activeFilter.fieldId || '').trim();
    const matcherValue = String(activeFilter.value || '').toLowerCase();
    const op = String(activeFilter.operator || 'EX').toUpperCase();

    const filtered = records.filter((record) => {
      const fields = record && record.fields ? record.fields : {};
      const field = fields[targetFieldId] || null;
      const sourceValue = String(field && field.value != null ? field.value : '').toLowerCase();
      if (op === 'XEX') return sourceValue !== matcherValue;
      if (op === 'CT') return sourceValue.includes(matcherValue);
      return sourceValue === matcherValue;
    });

    return { columns, records: filtered };
  }

  function shouldApplyServerFilters(options) {
    const opts = options && typeof options === 'object' ? options : {};
    return opts.applyFilters !== false;
  }

  if (window.__MUMS_TEST_HOOKS__) {
    window.__MUMS_TEST_HOOKS__.myQuickbase = {
      shouldApplyInitialFilters,
      filterRecordsBySearch,
      filterRecordsByCounter,
      shouldApplyServerFilters,
      getQuickbaseSettingsLocalKey,
      getQuickbaseTabsLocalKey,
      getQuickbaseTabSettingsLocalKey,
      readQuickbaseSettingsLocal,
      writeQuickbaseSettingsLocal,
      normalizeQuickbaseSettingsWithTabs,
      createDefaultSettings,
      parseQuickbaseReportUrl,
      hasPersistedQuickbaseTabs,
      hasUsableQuickbaseSettings,
      chooseInitialQuickbaseSettingsSource
    };
  }

  window.Pages.my_quickbase = async function(root) {
    // ── STALE INSTANCE KILL ────────────────────────────────────────────
    // If a previous invocation of this page left a cleanup registered on root
    // (e.g. user navigated away then back while an interval was still live),
    // destroy it NOW — before any new state is created.
    // Without this, two independent closures share the same DOM and call
    // renderTabBar() with different state.activeTabIndex values, producing the
    // "tabs alternate every ~2 s" bug.
    if (typeof root._cleanup === 'function') {
      try { root._cleanup(); } catch (_) {}
      root._cleanup = null;
    }

    // ── LAYOUT GUARD — SYNCHRONOUS SETUP ──────────────────────────────
    // app.js calls window.Pages[id](main) WITHOUT await. Our function has
    // multiple awaits before root._cleanup is ever set, so app.js's cleanup
    // capture fires while cleanup is still null — meaning cleanup NEVER runs
    // when the user navigates away. We protect against this with THREE layers:
    //
    //  Layer 1 – Inline styles (not CSS class): Overflow/padding are set as
    //    root.style properties. Inline styles are unambiguously ours to clear.
    //
    //  Layer 2 – MutationObserver on root.childList: When app.js calls
    //    main.innerHTML = '' (navigation), our shell #qbPageShell disappears.
    //    The observer fires SYNCHRONOUSLY — calls root._cleanup() immediately,
    //    guaranteed regardless of whether app.js captured the cleanup reference.
    //
    //  Layer 3 – Preliminary root._cleanup set SYNCHRONOUSLY before first
    //    await so that app.js DOES capture a real cleanup function on the same
    //    microtask tick. setupAutoRefresh() chains onto this later.
    //
    // CSS .page-qb class is still added for theme/skin rules but must NOT
    // be the sole carrier of overflow/padding — those must be inline.
    root.classList.add('page-qb');
    root.style.padding  = '0';
    root.style.overflow = 'clip';     // Does NOT trap position:fixed children

    // ── PROMOTE TIMER VARS — must be declared BEFORE first await so that
    // the preliminary cleanup (below) and MutationObserver can reference them.
    let quickbaseRefreshTimer = null;
    let autosaveTimer         = null;
    let quickbaseLoadInFlight = null;
    let lastQuickbaseLoadAt   = 0;
    let modalBindingsActive   = false;

    // ── PRELIMINARY CLEANUP (Layer 3) ─────────────────────────────────
    // Set on root SYNCHRONOUSLY — app.js runs `cleanup = main._cleanup`
    // on the same tick as calling window.Pages[id](main), so this reference
    // IS captured.  setupAutoRefresh() will wrap this via its prevCleanup chain.
    root._cleanup = function _qbPreliminaryCleanup() {
      try { if (quickbaseRefreshTimer) { clearInterval(quickbaseRefreshTimer); quickbaseRefreshTimer = null; } } catch (_) {}
      try { if (autosaveTimer) { clearTimeout(autosaveTimer); autosaveTimer = null; } } catch (_) {}
      try { root.style.padding  = ''; } catch (_) {}
      try { root.style.overflow = ''; } catch (_) {}
      try { document.body.style.overflow = ''; } catch (_) {}
      try { root.classList.remove('page-qb'); } catch (_) {}
    };

    // ── MUTATION OBSERVER (Layer 2) ────────────────────────────────────
    // Install synchronously. When #qbPageShell vanishes (navigation), fire the
    // FULL root._cleanup() — not just style resets — so timers are always killed.
    let _qbLayoutGuardObs = null;
    try {
      _qbLayoutGuardObs = new MutationObserver(function() {
        if (!root.querySelector('#qbPageShell')) {
          // Shell is gone — app.js navigated away. Run FULL cleanup NOW.
          try {
            if (typeof root._cleanup === 'function') { root._cleanup(); root._cleanup = null; }
          } catch (_) {}
          // Belt-and-suspenders: ensure styles are cleared even if cleanup threw.
          try { root.style.padding  = ''; } catch (_) {}
          try { root.style.overflow = ''; } catch (_) {}
          try { document.body.style.overflow = ''; } catch (_) {}
          try { root.classList.remove('page-qb'); } catch (_) {}
          try { if (_qbLayoutGuardObs) { _qbLayoutGuardObs.disconnect(); _qbLayoutGuardObs = null; } } catch (_) {}
        }
      });
      _qbLayoutGuardObs.observe(root, { childList: true });
    } catch (_) {}

    const AUTO_REFRESH_MS = 300000; // 5-min auto-refresh — was 60s (5× reduction). Egress optimization for Free Plan.
    const me = (window.Auth && Auth.getUser) ? Auth.getUser() : null;
    const tabManager = (window.TabManager && typeof window.TabManager.init === 'function')
      ? window.TabManager.init({ userId: me && me.id, apiBaseUrl: '/api' })
      : null;
    let profile = (me && window.Store && Store.getProfile) ? (Store.getProfile(me.id) || {}) : {};

    // ── GLOBAL QB SETTINGS — fetched once on page load ─────────────────────
    // Report Config (realm/tableId/qid/token) now comes from Global QB Settings.
    // Per-tab settings only customize columns + filters.
    let globalQbSettings = { reportLink: '', realm: '', tableId: '', qid: '', customColumns: [], filterConfig: [], filterMatch: 'ALL' };
    async function fetchGlobalQbSettings() {
      try {
        const tok = window.CloudAuth && typeof CloudAuth.accessToken === 'function' ? CloudAuth.accessToken() : '';
        const r = await fetch('/api/settings/global_quickbase', { headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' } });
        const d = await r.json();
        if (d.ok && d.settings) globalQbSettings = Object.assign(globalQbSettings, d.settings);
      } catch (_) {}
    }
    await fetchGlobalQbSettings();

    async function refreshProfileFromCloud() {
      if (!me || !window.CloudUsers || typeof window.CloudUsers.me !== 'function') return;
      try {
        const out = await window.CloudUsers.me();
        const cloudProfile = out && out.ok && out.profile && typeof out.profile === 'object' ? out.profile : null;
        if (!cloudProfile) return;
        profile = cloudProfile;
        if (window.Store && typeof Store.setProfile === 'function') {
          Store.setProfile(me.id, Object.assign({}, cloudProfile, { updatedAt: Date.now() }));
        }
      } catch (_) {}
    }

    await refreshProfileFromCloud();
    profile = (me && window.Store && Store.getProfile) ? (Store.getProfile(me.id) || {}) : {};

    // FIX: If Store has no qb_name, check Store.getUsers() first (populated by
    // refreshIntoLocalStore which maps qb_name into the users array).
    // Then fallback to a direct /api/users/me fetch.
    // This handles: SA sets qb_name → realtime sync arrives → user opens My QB.
    if (me && !String(profile.qb_name || '').trim()) {
      try {
        // 1. Check Store.getUsers() — refreshIntoLocalStore maps qb_name here
        const storeUser = window.Store && Store.getUsers
          ? (Store.getUsers() || []).find(u => u && String(u.id || '') === String(me.id || ''))
          : null;
        if (storeUser && String(storeUser.qb_name || '').trim()) {
          profile = Object.assign({}, profile, { qb_name: storeUser.qb_name });
        }
      } catch(_) {}
    }
    if (me && !String(profile.qb_name || '').trim()) {
      try {
        // 2. Final fallback: direct API call — catches cold-start / stale Store
        const tok = window.CloudAuth && typeof CloudAuth.accessToken === 'function' ? CloudAuth.accessToken() : '';
        const r = await fetch('/api/users/me', { headers: { Authorization: 'Bearer ' + tok } });
        const d = await r.json().catch(() => ({}));
        if (d.ok && d.profile && String(d.profile.qb_name || '').trim()) {
          profile = Object.assign({}, profile, { qb_name: d.profile.qb_name });
          if (window.Store && typeof Store.setProfile === 'function') {
            Store.setProfile(me.id, Object.assign({}, profile, { updatedAt: Date.now() }));
          }
        }
      } catch(_) {}
    }

    // ── QB NAME GUARD — blocks ALL data loading when no qb_name is assigned ──
    // Privacy rule: a user MUST have a Quickbase Name assigned before they can
    // see ANY records. This applies to every role including SUPER_ADMIN.
    // Without this guard the monitoring API returns all records for SUPER_ADMIN
    // (data leak). The correct fix is on the frontend: block the call entirely.
    const _userQbName = String(profile.qb_name || '').trim();
    if (!_userQbName) {
      root.classList.add('page-qb');
      root.style.padding  = '0';
      root.style.overflow = 'clip';
      root.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;min-height:320px;gap:16px;padding:40px;text-align:center;">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="1.5" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          <div style="font-size:17px;font-weight:700;color:rgba(255,255,255,0.85);">Quickbase Name Not Assigned</div>
          <div style="font-size:13px;color:rgba(255,255,255,0.45);max-width:380px;line-height:1.6;">
            Your Quickbase Name has not been configured yet.<br>
            Contact your <strong style="color:rgba(255,255,255,0.7);">Super Admin</strong> to assign your name in User Management → Edit User → Quickbase Name.
          </div>
        </div>`;
      root._cleanup = function() {
        try { root.style.padding = ''; } catch(_) {}
        try { root.style.overflow = ''; } catch(_) {}
        try { root.classList.remove('page-qb'); } catch(_) {}
      };
      return;
    }

    const cloudMe = window.me && typeof window.me === 'object' ? window.me : {};
    const profileWithCloudFallback = Object.assign({}, cloudMe, profile);
    if (
      cloudMe
      && Object.prototype.hasOwnProperty.call(cloudMe, 'quickbase_settings')
      && hasUsableQuickbaseSettings(cloudMe.quickbase_settings)
    ) {
      profileWithCloudFallback.quickbase_settings = cloudMe.quickbase_settings;
    }
    const quickbaseConfig = getProfileQuickbaseConfig(profileWithCloudFallback);
    const windowMeQuickbaseSettingsRaw = cloudMe && Object.prototype.hasOwnProperty.call(cloudMe, 'quickbase_settings')
      ? cloudMe.quickbase_settings
      : null;
    const parsedWindowMeQuickbaseSettings = parseQuickbaseSettings(windowMeQuickbaseSettingsRaw);
    const localQuickbaseSettings = readQuickbaseSettingsLocal(me && me.id);
    const backendQuickbaseSettings = normalizeQuickbaseSettingsWithTabs(profileWithCloudFallback.quickbase_settings, quickbaseConfig);
    const windowMeQuickbaseSettings = normalizeQuickbaseSettingsWithTabs(windowMeQuickbaseSettingsRaw, quickbaseConfig);
    const quickbaseSettings = chooseInitialQuickbaseSettingsSource({
      backendQuickbaseSettings,
      windowMeQuickbaseSettings,
      localQuickbaseSettings
    });
    const initialTabMeta = quickbaseSettings.tabs[quickbaseSettings.activeTabIndex] || quickbaseSettings.tabs[0] || createTabMeta({}, { tabName: 'Main Report' });
    const initialTabId = String(initialTabMeta.id || '').trim();
    const initialTabSettings = createDefaultSettings((quickbaseSettings.settingsByTabId && quickbaseSettings.settingsByTabId[initialTabId]) || {}, {});
    const initialLink = String(initialTabSettings.reportLink || '').trim();
    const parsedFromLink = parseQuickbaseLink(initialLink);
    const state = {
      quickbaseSettings,
      activeTabIndex: quickbaseSettings.activeTabIndex,
      modalDraft: null,
      tabName: String(initialTabMeta.tabName || 'Main Report').trim(),
      reportLink: initialLink,
      qid: String(initialTabSettings.qid || parsedFromLink.qid || '').trim(),
      tableId: String(initialTabSettings.tableId || parsedFromLink.tableId || '').trim(),
      realm: String(initialTabSettings.realm || parsedFromLink.realm || '').trim(),
      customColumns: Array.isArray(initialTabSettings.customColumns) ? initialTabSettings.customColumns.map((v) => String(v)) : [],
      customFilters: normalizeFilters(initialTabSettings.customFilters),
      filterMatch: normalizeFilterMatch(initialTabSettings.filterMatch),
      dashboardCounters: normalizeDashboardCounters(initialTabSettings.dashboard_counters),
      allAvailableFields: [],
      isSaving: false,
      activeCounterIndex: -1,
      searchTerm: '',
      searchDebounceTimer: null,
      baseRecords: [],
      rawPayload: { columns: [], records: [] },
      currentPayload: { columns: [], records: [] },
      hasUserSearched: false,
      didInitialDefaultRender: false,
      isDefaultReportMode: false,
      currentPage: 1,
      pageSize: 100,
      qbCache: {},
      _tabDataCache: {},
      settingsModalView: 'custom-columns',  // report-config moved to Global QB Settings
      settingsEditingTabId: ''
    };

    function syncTabManagerFromState(tabId) {
      if (!tabManager) return;
      const safeTabId = String(tabId || '').trim();
      if (!safeTabId) return;
      const tabMeta = Array.isArray(state.quickbaseSettings.tabs)
        ? state.quickbaseSettings.tabs.find((tab) => String(tab && tab.id || '').trim() === safeTabId)
        : null;
      const tabSettings = state.quickbaseSettings.settingsByTabId && state.quickbaseSettings.settingsByTabId[safeTabId]
        ? state.quickbaseSettings.settingsByTabId[safeTabId]
        : createDefaultSettings({}, {});
      tabManager.updateTabLocal(safeTabId, Object.assign({}, tabSettings, {
        tabName: String(tabMeta && tabMeta.tabName || tabSettings.tabName || 'New Tab').trim()
      }));
    }

    const cleanupHandlers = [];
    // NOTE: quickbaseRefreshTimer, autosaveTimer, quickbaseLoadInFlight,
    // lastQuickbaseLoadAt, modalBindingsActive are declared ABOVE (before the
    // first await) so that the preliminary root._cleanup and MutationObserver
    // can reference them.  Do NOT re-declare them here.

    const QUICKBASE_CACHE_TTL_MS = 55 * 1000; // 55s — slightly under 60s refresh interval
    const QUICKBASE_BACKGROUND_LIMIT = 500;

    function getQuickbaseCacheKey({ tabId, tableId, qid, filters, filterMatch }) {
      const hashBase = JSON.stringify({ tabId, tableId, qid, filters, filterMatch });
      return `qb_cache:${hashBase}`;
    }

    function readQuickbaseCache(cacheKey, tabId) {
      const now = Date.now();
      const safeTabId = String(tabId || '').trim();
      if (safeTabId && state._tabDataCache && state._tabDataCache[safeTabId]) {
        const tabEntry = state._tabDataCache[safeTabId][cacheKey];
        if (tabEntry && (now - tabEntry.savedAt) < QUICKBASE_CACHE_TTL_MS) return tabEntry.payload;
      }
      const memoryEntry = state.qbCache[cacheKey];
      if (memoryEntry && (now - memoryEntry.savedAt) < QUICKBASE_CACHE_TTL_MS) return memoryEntry.payload;
      try {
        const raw = sessionStorage.getItem(cacheKey);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || (now - Number(parsed.savedAt || 0)) >= QUICKBASE_CACHE_TTL_MS) {
          sessionStorage.removeItem(cacheKey);
          return null;
        }
        state.qbCache[cacheKey] = parsed;
        return parsed.payload || null;
      } catch (_) {
        return null;
      }
    }

    function writeQuickbaseCache(cacheKey, payload, tabId) {
      const entry = { savedAt: Date.now(), payload };
      state.qbCache[cacheKey] = entry;
      const safeTabId = String(tabId || '').trim();
      if (safeTabId) {
        if (!state._tabDataCache || typeof state._tabDataCache !== 'object') state._tabDataCache = {};
        if (!state._tabDataCache[safeTabId] || typeof state._tabDataCache[safeTabId] !== 'object') {
          state._tabDataCache[safeTabId] = {};
        }
        state._tabDataCache[safeTabId][cacheKey] = entry;
      }
      try {
        sessionStorage.setItem(cacheKey, JSON.stringify(entry));
      } catch (_) {}
    }

    function mergeRecordsById(existingRecords, incomingRecords) {
      const merged = [];
      const seen = new Set();
      (Array.isArray(existingRecords) ? existingRecords : []).concat(Array.isArray(incomingRecords) ? incomingRecords : []).forEach((record) => {
        const id = String(record && record.qbRecordId || '');
        if (!id || seen.has(id)) return;
        seen.add(id);
        merged.push(record);
      });
      return merged;
    }

    // FIX[Bug1]: Seed TabManager with all tabs from Supabase state so isolation works correctly.
    // TabManager uses a separate localStorage key; tabs loaded from Supabase profile won't be in
    // TabManager's internal Map unless we explicitly seed them here.
    if (tabManager && Array.isArray(state.quickbaseSettings.tabs) && me && me.id) {
      const lsKey = `mums_quickbase_tabs_${String(me.id || 'anonymous').trim()}`;
      try {
        const raw = window.localStorage && window.localStorage.getItem(lsKey);
        const existingRows = JSON.parse(raw || '[]');
        const safeRows = Array.isArray(existingRows) ? existingRows : [];
        let changed = false;
        state.quickbaseSettings.tabs.forEach((tab) => {
          const tabId = String(tab && tab.id || '').trim();
          if (!tabId) return;
          const alreadyExists = safeRows.some((r) => String(r && r.tab_id || '').trim() === tabId);
          if (!alreadyExists) {
            const tabSettings = (state.quickbaseSettings.settingsByTabId && state.quickbaseSettings.settingsByTabId[tabId]) || {};
            safeRows.push({
              tab_id: tabId,
              tab_name: String(tab.tabName || 'Report').trim(),
              settings_json: JSON.parse(JSON.stringify(tabSettings)),
              meta: { createdAt: Date.now(), updatedAt: Date.now() }
            });
            changed = true;
          }
        });
        if (changed && window.localStorage) {
          window.localStorage.setItem(lsKey, JSON.stringify(safeRows));
        }
      } catch (_) {}
      // Reload TabManager from updated localStorage so getTab() returns correct data
      tabManager.init({ userId: me.id, apiBaseUrl: '/api' });
      // Now push latest Supabase settings into TabManager for each tab
      state.quickbaseSettings.tabs.forEach((tab) => {
        const tabId = String(tab && tab.id || '').trim();
        if (!tabId) return;
        const tabSettings = (state.quickbaseSettings.settingsByTabId && state.quickbaseSettings.settingsByTabId[tabId]) || {};
        if (tabSettings.reportLink || tabSettings.qid || tabSettings.tableId) {
          tabManager.updateTabLocal(tabId, Object.assign({}, tabSettings, {
            tabName: String(tab.tabName || 'Report').trim()
          }));
        }
      });
    }

    // FIX[Bug1]: Ensure active tab state is immediately aligned after profile load.
    state.activeTabIndex = quickbaseSettings.activeTabIndex;
    state.quickbaseSettings.activeTabIndex = quickbaseSettings.activeTabIndex;
    syncStateFromActiveTab();

    function getActiveTabMeta() {
      const tabs = Array.isArray(state.quickbaseSettings && state.quickbaseSettings.tabs) ? state.quickbaseSettings.tabs : [];
      if (!tabs.length) {
        const firstTab = createTabMeta({}, { tabName: 'Main Report' });
        state.quickbaseSettings = {
          activeTabIndex: 0,
          tabs: [firstTab],
          settingsByTabId: { [firstTab.id]: createDefaultSettings({}, {}) }
        };
      }
      const safeTabs = state.quickbaseSettings.tabs;
      const safeIndex = Math.min(Math.max(Number(state.activeTabIndex || 0), 0), safeTabs.length - 1);
      state.activeTabIndex = safeIndex;
      state.quickbaseSettings.activeTabIndex = safeIndex;
      return safeTabs[safeIndex];
    }

    function getActiveTabId() {
      return String((getActiveTabMeta() || {}).id || '').trim();
    }

    function getActiveTab() {
      const meta = getActiveTabMeta();
      const tabId = String(meta && meta.id || '').trim();
      const settings = createDefaultSettings((state.quickbaseSettings.settingsByTabId && state.quickbaseSettings.settingsByTabId[tabId]) || {}, {});
      return Object.assign({}, meta, settings);
    }

    function getActiveTabKey() {
      const activeTabId = getActiveTabId();
      return String(activeTabId || state.activeTabIndex);
    }

    function getActiveSearchTerm() {
      if (!state.quickbaseSettings || !state.quickbaseSettings.tabs || !state.quickbaseSettings.tabs[state.activeTabIndex]) return '';
      if (!state.searchByTab || typeof state.searchByTab !== 'object') state.searchByTab = {};
      return String(state.searchByTab[getActiveTabKey()] || '').trim();
    }

    function setActiveSearchTerm(value) {
      if (!state.quickbaseSettings || !state.quickbaseSettings.tabs || !state.quickbaseSettings.tabs[state.activeTabIndex]) return;
      if (!state.searchByTab || typeof state.searchByTab !== 'object') state.searchByTab = {};
      state.searchByTab[getActiveTabKey()] = String(value || '').trim();
    }

    function getActiveUserSearched() {
      if (!state.quickbaseSettings || !state.quickbaseSettings.tabs || !state.quickbaseSettings.tabs[state.activeTabIndex]) return false;
      if (!state.userSearchedByTab || typeof state.userSearchedByTab !== 'object') state.userSearchedByTab = {};
      return !!state.userSearchedByTab[getActiveTabKey()];
    }

    function setActiveUserSearched(value) {
      if (!state.quickbaseSettings || !state.quickbaseSettings.tabs || !state.quickbaseSettings.tabs[state.activeTabIndex]) return;
      if (!state.userSearchedByTab || typeof state.userSearchedByTab !== 'object') state.userSearchedByTab = {};
      state.userSearchedByTab[getActiveTabKey()] = !!value;
    }

    function syncStateFromActiveTab() {
      const activeTabId = getActiveTabId();
      const freshSettings = state.quickbaseSettings.settingsByTabId && state.quickbaseSettings.settingsByTabId[activeTabId]
        ? createDefaultSettings(state.quickbaseSettings.settingsByTabId[activeTabId], {})
        : createDefaultSettings({}, {});
      const activeTabMeta = getActiveTabMeta();
      const parsed = parseQuickbaseLink(freshSettings.reportLink);
      state.tabName = String(activeTabMeta.tabName || 'Main Report').trim() || 'Main Report';
      state.reportLink = String(freshSettings.reportLink || '').trim();
      state.qid = String(freshSettings.qid || parsed.qid || '').trim();
      state.tableId = String(freshSettings.tableId || parsed.tableId || '').trim();
      state.realm = String(freshSettings.realm || parsed.realm || '').trim();
      state.customColumns = deepClone(Array.isArray(freshSettings.customColumns) ? freshSettings.customColumns : []);
      state.customFilters = deepClone(normalizeFilters(freshSettings.customFilters || []));
      state.filterMatch = normalizeFilterMatch(freshSettings.filterMatch || 'ALL');
      state.dashboardCounters = deepClone(normalizeDashboardCounters(freshSettings.dashboard_counters || []));
      state.activeCounterIndex = -1;
      const headerSearch = root.querySelector('#qbHeaderSearch');
      if (headerSearch) headerSearch.value = getActiveSearchTerm();
      const instanceTitle = root.querySelector('#qbInstanceTitle');
      if (instanceTitle) instanceTitle.textContent = state.tabName || 'Main Report';
      const activeTabRecordCache = state._tabDataCache && state._tabDataCache[activeTabId] && Array.isArray(state._tabDataCache[activeTabId].cachedRows)
        ? state._tabDataCache[activeTabId].cachedRows
        : [];
      state.baseRecords = activeTabRecordCache.slice();
      state.rawPayload = {
        columns: Array.isArray(state.rawPayload && state.rawPayload.columns) ? state.rawPayload.columns : [],
        records: state.baseRecords.slice()
      };
    }

    function syncSettingsInputsFromState() {
      const tabNameEl = root.querySelector('#qbTabName');
      if (tabNameEl) tabNameEl.value = String(state.tabName || 'Main Report');

      const reportLinkEl = root.querySelector('#qbReportLink');
      if (reportLinkEl) reportLinkEl.value = String(state.reportLink || '');

      const qidEl = root.querySelector('#qbQid');
      if (qidEl) qidEl.value = String(state.qid || '');

      const tabBaseQidEl = root.querySelector('#qbTabBaseQid');
      if (tabBaseQidEl) tabBaseQidEl.value = String(state.qid || '');

      const tableIdEl = root.querySelector('#qbTableId');
      if (tableIdEl) tableIdEl.value = String(state.tableId || '');

      const filterMatchEl = root.querySelector('#qbFilterMatch');
      if (filterMatchEl) filterMatchEl.value = normalizeFilterMatch(state.filterMatch);
    }

    function syncActiveTabFromState() {
      const activeMeta = getActiveTabMeta();
      const tabId = String(activeMeta && activeMeta.id || '').trim() || generateUUID();
      const nextMeta = createTabMeta({
        id: tabId,
        tabName: String(state.tabName || 'Main Report').trim() || 'Main Report'
      });

      // ── BYPASS GUARD ─────────────────────────────────────────────────────
      // Read existing bypassGlobal from settingsByTabId BEFORE building nextSettings.
      // syncActiveTabFromState rebuilds settings from state.reportLink etc, but bypass
      // tabs store their config in settingsByTabId — not in state.reportLink.
      // Without this guard, every sync call wipes bypassGlobal and the bypass reportLink.
      const _existingTabSettings = state.quickbaseSettings.settingsByTabId && state.quickbaseSettings.settingsByTabId[tabId];
      const _isBypassTab = !!(_existingTabSettings && _existingTabSettings.bypassGlobal);

      let nextSettings;
      if (_isBypassTab) {
        // Bypass tab: preserve all bypass-specific fields, only sync non-report fields
        nextSettings = deepClone(createDefaultSettings({
          reportLink: String(_existingTabSettings.reportLink || '').trim(),
          qid: String(_existingTabSettings.qid || '').trim(),
          tableId: String(_existingTabSettings.tableId || '').trim(),
          realm: String(_existingTabSettings.realm || '').trim(),
          bypassGlobal: true,
          customColumns: Array.isArray(state.customColumns) ? state.customColumns.map((v) => String(v)) : [],
          customFilters: normalizeFilters(state.customFilters),
          filterMatch: normalizeFilterMatch(state.filterMatch),
          dashboard_counters: normalizeDashboardCounters(state.dashboardCounters)
        }, {}));
      } else {
        nextSettings = deepClone(createDefaultSettings({
          reportLink: String(state.reportLink || '').trim(),
          qid: String(state.qid || '').trim(),
          tableId: String(state.tableId || '').trim(),
          realm: String(state.realm || '').trim(),
          bypassGlobal: false,
          customColumns: Array.isArray(state.customColumns) ? state.customColumns.map((v) => String(v)) : [],
          customFilters: normalizeFilters(state.customFilters),
          filterMatch: normalizeFilterMatch(state.filterMatch),
          dashboard_counters: normalizeDashboardCounters(state.dashboardCounters)
        }, {}));
      }

      // ISOLATION: Write only to this tab's slot — never mutate another tab's settings
      state.quickbaseSettings.tabs[state.activeTabIndex] = deepClone(nextMeta);
      state.quickbaseSettings.settingsByTabId = Object.assign({}, state.quickbaseSettings.settingsByTabId || {}, {
        [tabId]: nextSettings
      });
      state.quickbaseSettings.activeTabIndex = state.activeTabIndex;
      state.modalDraft = deepClone(Object.assign({}, nextMeta, nextSettings));
    }


    function updateTabSettings(tabId, partialUpdate) {
      const safeTabId = String(tabId || '').trim();
      if (!safeTabId) return;
      const nextPartial = partialUpdate && typeof partialUpdate === 'object' ? deepClone(partialUpdate) : {};
      const prevSettings = state.quickbaseSettings.settingsByTabId && state.quickbaseSettings.settingsByTabId[safeTabId]
        ? deepClone(state.quickbaseSettings.settingsByTabId[safeTabId])
        : createDefaultSettings({}, {});
      // ISOLATION: always produce a fresh object — no reference sharing across tabs
      // Preserve bypassGlobal from prevSettings unless explicitly overriding
      const nextSettings = createDefaultSettings(Object.assign({}, prevSettings, nextPartial, {
        bypassGlobal: Object.prototype.hasOwnProperty.call(nextPartial, 'bypassGlobal')
          ? !!nextPartial.bypassGlobal
          : !!prevSettings.bypassGlobal
      }), {});
      state.quickbaseSettings.settingsByTabId = Object.assign({}, state.quickbaseSettings.settingsByTabId || {}, {
        [safeTabId]: deepClone(nextSettings)
      });
      const tabIndex = Array.isArray(state.quickbaseSettings.tabs)
        ? state.quickbaseSettings.tabs.findIndex((tab) => String(tab && tab.id || '').trim() === safeTabId)
        : -1;
      if (tabIndex >= 0) {
        const tabMeta = createTabMeta(state.quickbaseSettings.tabs[tabIndex], {});
        state.quickbaseSettings.tabs[tabIndex] = deepClone(tabMeta);
      }
    }

    function handleReportLinkChange(tabId, value) {
      const safeTabId = String(tabId || '').trim();
      if (!safeTabId) return;
      const reportLink = String(value || '').trim();
      updateTabSettings(safeTabId, { reportLink });
      const parsed = parseQuickbaseReportUrl(reportLink);
      const parsedLink = parseQuickbaseLink(reportLink);
      const updates = {};
      if (!reportLink) {
        updates.qid = '';
        updates.tableId = '';
        updates.realm = '';
      } else {
        if (parsed && parsed.qid) {
          updates.qid = parsed.qid;
        }
        if (parsed && parsed.tableId) {
          updates.tableId = parsed.tableId;
        }
        if (parsedLink && parsedLink.realm) {
          updates.realm = parsedLink.realm;
        }
      }
      if (Object.keys(updates).length) updateTabSettings(safeTabId, updates);

      if (safeTabId === getActiveTabId()) {
        state.reportLink = reportLink;
        if (Object.prototype.hasOwnProperty.call(updates, 'qid')) state.qid = String(updates.qid || '').trim();
        if (Object.prototype.hasOwnProperty.call(updates, 'tableId')) state.tableId = String(updates.tableId || '').trim();
        if (Object.prototype.hasOwnProperty.call(updates, 'realm')) state.realm = String(updates.realm || '').trim();
        syncSettingsInputsFromState();
      }
    }

    function validateQidMatchesUrl(tabSettings) {
      const tab = tabSettings && typeof tabSettings === 'object' ? tabSettings : {};
      const reportLink = String(tab.reportLink || '').trim();
      const qid = String(tab.qid || '').trim();
      if (!reportLink) return { ok: true };
      if (!ENABLE_QID_URL_MATCH_VALIDATION) return { ok: true };
      const parsed = parseQuickbaseReportUrl(reportLink);
      if (parsed && parsed.qid && qid && parsed.qid !== qid) {
        return { ok: false, field: 'qid', message: 'QID must match the qid value inside the Report Link URL.' };
      }
      return { ok: true };
    }

    function validateQuickbaseTabSettings(tabSettings) {
      return validateQidMatchesUrl(tabSettings);
    }

    /**
     * My Quickbase per-tab settings isolation – migration note
     * - Internal state now stores per-tab settings in settingsByTabId with cloned objects (no shared references).
     * - Report Link parsing auto-syncs qid/tableId for each tab independently.
     * - Save payload stays backward compatible: profile.quickbase_settings preserves legacy { activeTabIndex, tabs } shape.
     * - Future readers must not rely on object identity being shared across tabs.
     */
    function serializeQuickbaseSettingsForSave(quickbaseSettingsState, activeTabIndex) {
      const settingsState = quickbaseSettingsState && typeof quickbaseSettingsState === 'object' ? quickbaseSettingsState : {};
      const tabs = Array.isArray(settingsState.tabs) ? settingsState.tabs : [];
      const settingsByTabId = settingsState.settingsByTabId && typeof settingsState.settingsByTabId === 'object'
        ? settingsState.settingsByTabId
        : {};

      return {
        activeTabIndex: Number.isFinite(Number(activeTabIndex)) ? Number(activeTabIndex) : 0,
        tabs: tabs.map((tab) => {
          const tabMeta = createTabMeta(tab, {});
          const tabId = String(tabMeta.id || '').trim();
          const tabSettings = createDefaultSettings(settingsByTabId[tabId] || tab || {}, {});
          return buildDefaultTab(Object.assign({}, tabMeta, tabSettings), {});
        })
      };
    }


    function captureSettingsDraftFromInputs() {
      const tabNameEl = root.querySelector('#qbTabName');
      const reportLinkEl = root.querySelector('#qbReportLink');
      const tabBaseQidEl = root.querySelector('#qbTabBaseQid');
      const qidEl = root.querySelector('#qbQid');
      const tableIdEl = root.querySelector('#qbTableId');
      const filterMatchEl = root.querySelector('#qbFilterMatch');

      const reportLink = String(reportLinkEl && reportLinkEl.value || state.reportLink || '').trim();
      const parsed = parseQuickbaseLink(reportLink);
      const hasReportLink = !!reportLink;
      const resolvedQid = hasReportLink
        ? String(tabBaseQidEl && tabBaseQidEl.value || qidEl && qidEl.value || parsed.qid || state.qid || '').trim()
        : '';
      const resolvedTableId = hasReportLink
        ? String(tableIdEl && tableIdEl.value || parsed.tableId || state.tableId || '').trim()
        : '';
      const resolvedRealm = hasReportLink ? String(parsed.realm || state.realm || '').trim() : '';

      state.tabName = String(tabNameEl && tabNameEl.value || state.tabName || 'Main Report').trim() || 'Main Report';
      state.reportLink = reportLink;
      state.qid = resolvedQid;
      state.tableId = resolvedTableId;
      state.realm = resolvedRealm;
      state.filterMatch = normalizeFilterMatch(String(filterMatchEl && filterMatchEl.value || state.filterMatch || 'ALL'));
      syncActiveTabFromState();
    }

    function scrapeModalCounterInputs() {
      const rows = Array.from(root.querySelectorAll('#qbCounterRows [data-counter-idx]'));
      return rows
        .map((row) => {
          const fieldId = String((row.querySelector('[data-counter-f="fieldId"]') || {}).value || '').trim();
          const operator = String((row.querySelector('[data-counter-f="operator"]') || {}).value || 'EX').trim().toUpperCase();
          const value = String((row.querySelector('[data-counter-f="value"]') || {}).value || '').trim();
          const label = String((row.querySelector('[data-counter-f="label"]') || {}).value || '').trim();
          const color = String((row.querySelector('[data-counter-f="color"]') || {}).value || 'default').trim().toLowerCase();
          return { fieldId, operator, value, label, color };
        })
        .filter((counter) => counter.fieldId && counter.value);
    }

    function renderTabBar() {
      const tabBar = root.querySelector('#qbTabBar');
      if (!tabBar) return;
      const tabs = state.quickbaseSettings.tabs || [];
      tabBar.innerHTML = tabs.map((tab, idx) => {
        const isActive = idx === state.activeTabIndex;
        const tabId = String(tab && tab.id || '').trim();
        // Check if this tab has fresh cache data
        const tabSettings = state.quickbaseSettings.settingsByTabId && state.quickbaseSettings.settingsByTabId[tabId]
          ? createDefaultSettings(state.quickbaseSettings.settingsByTabId[tabId], {})
          : null;
        const hasCachedData = !!(state._tabDataCache && state._tabDataCache[tabId] && Array.isArray(state._tabDataCache[tabId].cachedRows) && state._tabDataCache[tabId].cachedRows.length);
        const cacheBadge = isActive ? '' : hasCachedData
          ? '<span class="qb-tab-cache-badge qb-tab-badge-cached">◎</span>'
          : '';
        const activeBadge = isActive && hasCachedData ? '<span class="qb-tab-cache-badge qb-tab-badge-live">●</span>' : '';
        return `<button type="button" data-tab-idx="${idx}" class="qb-tab-btn${isActive ? ' qb-tab-btn-active' : ''}" title="${esc(tab.tabName || `Report ${idx + 1}`)}">${activeBadge}<span class="qb-tab-label">${esc(tab.tabName || `Report ${idx + 1}`)}</span>${cacheBadge}</button>`;
      }).join('') + '<button type="button" id="qbAddTabBtn" title="Add New Tab" aria-label="Add New Tab" class="qb-tab-add-btn">+</button>';
    }

    function setSettingsModalView(viewKey) {
      const allowedViews = new Set(['report-config', 'custom-columns', 'filter-config', 'dashboard-counters']);
      const nextView = allowedViews.has(String(viewKey || '').trim()) ? String(viewKey).trim() : 'custom-columns';
      state.settingsModalView = nextView;

      root.querySelectorAll('[data-qb-settings-view]').forEach((section) => {
        const sectionView = String(section.getAttribute('data-qb-settings-view') || '').trim();
        section.style.display = sectionView === nextView ? 'block' : 'none';
      });

      root.querySelectorAll('[data-qb-settings-tab]').forEach((btn) => {
        const tabView = String(btn.getAttribute('data-qb-settings-tab') || '').trim();
        const isActive = tabView === nextView;
        btn.classList.toggle('active', isActive);
        // Support both old inline style tabs and new class-based tabs
        if (!btn.classList.contains('qb-modal-tab')) {
          btn.style.color = isActive ? '#fff' : 'rgba(226,232,240,0.78)';
          btn.style.borderBottom = isActive ? '2px solid #2196F3' : '2px solid transparent';
          btn.style.background = 'transparent';
        }
      });
    }

    function _isSettingsModalOpen() {
      const modal = root.querySelector('#qbSettingsModal');
      if (!modal) return false;
      const d = modal.style.display;
      return d === 'flex' || d === 'block';
    }

    function scrapeModalSettingsIntoActiveTab() {
      const activeTab = getActiveTab();

      // ── MODAL GUARD ────────────────────────────────────────────────────────
      // persistQuickbaseSettings() calls this function before every save — even
      // from the auto-save timer (queuePersistQuickbaseSettings) when the modal
      // is CLOSED. When closed, #qbCounterRows has no [data-counter-idx] rows,
      // so scrapeModalCounterInputs() returns [] and WIPES saved counters.
      //
      // FIX: Only scrape DOM inputs when the modal is actually OPEN and visible.
      // When closed, preserve the existing in-memory values from state / activeTab.
      if (!_isSettingsModalOpen()) {
        // Modal is closed — use in-memory state, do not touch DOM
        syncActiveTabFromState();
        return;
      }

      const tabNameInput = String((root.querySelector('#qbTabName') || {}).value || '').trim();
      const tabBaseQidInput = String((root.querySelector('#qbTabBaseQid') || {}).value || '').trim();
      const reportLink = String((root.querySelector('#qbReportLink') || {}).value || '').trim();
      const qidInput = String((root.querySelector('#qbQid') || {}).value || '').trim();
      const tableIdInput = String((root.querySelector('#qbTableId') || {}).value || '').trim();
      const parsed = parseQuickbaseLink(reportLink);
      const hasReportLink = !!reportLink;
      // Scrape counters ONLY while modal is open — guaranteed DOM rows exist
      const scrapedCounters = normalizeDashboardCounters(scrapeModalCounterInputs());
      // If scrape returned empty but state has counters (e.g. modal on different tab),
      // fall back to existing state counters to prevent an accidental wipe
      const safeCounters = scrapedCounters.length > 0
        ? scrapedCounters
        : deepClone(state.dashboardCounters || activeTab.dashboard_counters || []);

      activeTab.tabName = tabNameInput || activeTab.tabName || 'Main Report';
      activeTab.dashboard_counters = safeCounters;
      state.tabName = activeTab.tabName;
      state.dashboardCounters = safeCounters;

      // ── BYPASS GUARD ────────────────────────────────────────────────────
      // When tab is in bypass mode, reportLink/qid/tableId/realm come from
      // #qbBypassReportLink (Report Config section), NOT from #qbReportLink.
      // Scraping #qbReportLink (which is empty for bypass tabs) would wipe the
      // bypass settings. Only update these fields for non-bypass tabs.
      const _activeTabId = String(getActiveTabId() || '').trim();
      const _activeTabSettings = state.quickbaseSettings.settingsByTabId && state.quickbaseSettings.settingsByTabId[_activeTabId];
      const _isActiveBypassed = !!(_activeTabSettings && _activeTabSettings.bypassGlobal);

      if (!_isActiveBypassed) {
        // Non-bypass: scrape normally from the standard report link inputs
        activeTab.reportLink = reportLink;
        activeTab.qid = hasReportLink ? (tabBaseQidInput || qidInput || parsed.qid || '') : '';
        activeTab.tableId = hasReportLink ? (tableIdInput || parsed.tableId || '') : '';
        activeTab.realm = hasReportLink ? (parsed.realm || '') : '';
        state.reportLink = activeTab.reportLink;
        state.qid = activeTab.qid;
        state.tableId = activeTab.tableId;
        state.realm = activeTab.realm;
      }
      // For bypass tabs: reportLink/qid/tableId/realm are preserved from
      // state.quickbaseSettings.settingsByTabId (already updated in save handler)

      syncActiveTabFromState();
    }

    function scrapeModalTabSnapshot() {
      // Only call when modal is OPEN — returns current state snapshot when closed
      if (!_isSettingsModalOpen()) {
        const activeTab = getActiveTab();
        return {
          tabName: String(state.tabName || activeTab.tabName || 'Main Report').trim(),
          reportLink: String(state.reportLink || activeTab.reportLink || '').trim(),
          qid: String(state.qid || activeTab.qid || '').trim(),
          tableId: String(state.tableId || activeTab.tableId || '').trim(),
          realm: String(state.realm || activeTab.realm || '').trim(),
          dashboard_counters: deepClone(state.dashboardCounters || activeTab.dashboard_counters || [])
        };
      }
      const tabName = String((root.querySelector('#qbTabName') || {}).value || '').trim() || 'Main Report';
      const reportLink = String((root.querySelector('#qbReportLink') || {}).value || '').trim();
      const baseQid = String((root.querySelector('#qbTabBaseQid') || {}).value || '').trim();
      const qid = String((root.querySelector('#qbQid') || {}).value || '').trim();
      const tableId = String((root.querySelector('#qbTableId') || {}).value || '').trim();
      const parsed = parseQuickbaseLink(reportLink);
      const hasReportLink = !!reportLink;
      const scrapedCounters = normalizeDashboardCounters(scrapeModalCounterInputs());
      const safeCounters = scrapedCounters.length > 0
        ? scrapedCounters
        : deepClone(state.dashboardCounters || []);
      return {
        tabName,
        reportLink,
        qid: hasReportLink ? (baseQid || qid || parsed.qid || '') : '',
        tableId: hasReportLink ? (tableId || parsed.tableId || '') : '',
        realm: hasReportLink ? (parsed.realm || '') : '',
        dashboard_counters: safeCounters
      };
    }

    async function persistQuickbaseSettings(settingsPayload) {
      if (!me) return;
      scrapeModalSettingsIntoActiveTab();
      syncActiveTabFromState();
      const activeTab = getActiveTab();
      // For bypass tabs: use settingsByTabId as source of truth for reportLink/qid/realm/tableId
      const _persistTabId = String(getActiveTabId() || '').trim();
      const _persistTabSettings = _persistTabId && state.quickbaseSettings.settingsByTabId
        ? (state.quickbaseSettings.settingsByTabId[_persistTabId] || {})
        : {};
      const _isBypassPersist = !!(_persistTabSettings.bypassGlobal);
      const _effectiveRL = _isBypassPersist
        ? String(_persistTabSettings.reportLink || activeTab.reportLink || '').trim()
        : String(activeTab.reportLink || '').trim();
      const parsed = parseQuickbaseLink(_effectiveRL);
      const activeSettingsObject = {
        reportLink: _effectiveRL,
        qid: (_isBypassPersist ? _persistTabSettings.qid : activeTab.qid) || parsed.qid || '',
        realm: (_isBypassPersist ? _persistTabSettings.realm : activeTab.realm) || parsed.realm || '',
        tableId: (_isBypassPersist ? _persistTabSettings.tableId : activeTab.tableId) || parsed.tableId || '',
        customColumns: activeTab.customColumns,
        customFilters: activeTab.customFilters,
        filterMatch: activeTab.filterMatch,
        dashboardCounters: normalizeDashboardCounters(activeTab.dashboard_counters)
      };

      const serializedQuickbaseSettings = settingsPayload || serializeQuickbaseSettingsForSave(state.quickbaseSettings, state.activeTabIndex);

      // Ensure payload is an object, not a string
      const normalizedPayload = typeof serializedQuickbaseSettings === 'string'
        ? JSON.parse(serializedQuickbaseSettings)
        : serializedQuickbaseSettings;

      const payload = {
        qb_report_link: activeSettingsObject.reportLink,
        qb_qid: activeSettingsObject.qid,
        qb_realm: activeSettingsObject.realm,
        qb_table_id: activeSettingsObject.tableId,
        qb_custom_columns: activeSettingsObject.customColumns,
        qb_custom_filters: activeSettingsObject.customFilters,
        qb_filter_match: activeSettingsObject.filterMatch,
        qb_dashboard_counters: activeSettingsObject.dashboardCounters,
        quickbase_config: activeSettingsObject,
        quickbase_settings: normalizedPayload
      };
      writeQuickbaseSettingsLocal(me.id, normalizedPayload);
      const authToken = window.CloudAuth && typeof CloudAuth.accessToken === 'function' ? CloudAuth.accessToken() : '';
      const response = await fetch('/api/users/update_me', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        throw new Error(data.message || data.error || 'Failed to save settings');
      }

      // Update local cache after successful save
      if (window.Store && Store.setProfileField) {
        Store.setProfileField('quickbase_settings', normalizedPayload);
      } else if (window.Store && Store.setProfile) {
        Store.setProfile(me.id, Object.assign({}, payload, { updatedAt: Date.now() }));
      }

      console.log('[Cloud Sync] Multi-Tab Settings Saved');
      writeQuickbaseSettingsLocal(me.id, normalizedPayload);
      return data;
    }

    function queuePersistQuickbaseSettings() {
      if (!me) return;
      if (autosaveTimer) clearTimeout(autosaveTimer);
      autosaveTimer = setTimeout(async () => {
        try {
          await persistQuickbaseSettings();
        } catch (_) {}
      }, 700);
    }


    root.innerHTML = `
      <div class="qb-page-shell" id="qbPageShell">

        <!-- TAB BAR -->
        <div class="qb-tabbar-wrap">
          <div id="qbTabBar" class="qb-tabs-inner"></div>
          <button type="button" class="qb-fullscreen-btn" id="qbFullscreenBtn" title="Toggle Fullscreen" aria-label="Toggle Fullscreen">
            <svg id="qbFsIconExpand" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
            <svg id="qbFsIconCollapse" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display:none;"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="10" y1="14" x2="3" y2="21"/><line x1="21" y1="3" x2="14" y2="10"/></svg>
          </button>
        </div>

        <!-- HEADER CARD -->
        <div class="qb-header-card">
          <div class="qb-header-left">
            <div class="qb-instance-title" id="qbInstanceTitle">${esc(state.tabName || 'Main Report')}</div>
            <div class="qb-instance-sub">Active tab instance dashboard</div>
          </div>
          <div class="qb-search-wrap">
            <div class="qb-search-row">
              <span class="qb-search-ico">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              </span>
              <input class="qb-search-input" id="qbHeaderSearch" type="search" placeholder="Search across active tab records…" />
            </div>
            <div id="qbSearchScopeTag" class="qb-search-scope-tag" aria-live="polite"></div>
          </div>
          <div class="qb-header-actions">
            <button class="qb-btn qb-btn-ghost" id="qbExportCsvBtn" type="button">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Export CSV
            </button>
            <button class="qb-btn qb-btn-ghost" id="qbReloadBtn" type="button">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
              Reload
            </button>
            <button class="qb-btn qb-btn-force-refresh" id="qbForceRefreshBtn" type="button" title="Force live fetch from Quickbase — bypasses 5-min auto-refresh">
              <svg id="qbForceRefreshIcon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/></svg>
              <span id="qbForceRefreshLabel">Active</span>
            </button>
            <button class="qb-btn qb-btn-primary" id="qbOpenSettingsBtn" type="button">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              Settings
            </button>
          </div>
        </div>

        <!-- DASHBOARD COUNTERS -->
        <div id="qbDashboardCounters" class="qb-dashboard-counters"></div>

        <!-- TABLE CARD -->
        <div class="qb-table-card">
          <div class="qb-table-head">
            <div class="qb-table-title">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="9" x2="9" y2="21"/></svg>
              Quickbase Records
            </div>
            <div class="qb-table-meta">
              <span id="qbDataMeta" class="qb-meta-text">Loading…</span>
              <span id="qbFreshBadge" class="qb-fresh-badge" style="display:none;">● Live</span>
              <button id="qbCacheBadge" type="button" class="qb-cache-badge" style="display:none;cursor:pointer;background:none;border:none;padding:2px 8px;font:inherit;" title="Click to refresh live data">◎ Cached — click to refresh</button>
            </div>
          </div>
          <div id="qbDataBody" class="qb-data-body"></div>
        </div>

      </div>

      <!-- SETTINGS MODAL -->
      <div class="modal" id="qbSettingsModal" aria-hidden="true" style="position:fixed;inset:0;align-items:center;justify-content:center;z-index:9999;background:rgba(0,0,0,0.75);backdrop-filter:blur(8px);padding:12px;box-sizing:border-box;overflow:auto;">
        <div class="qb-modal-panel">
          <div id="qbSettingsSavingLock" style="display:none;position:absolute;inset:0;z-index:90;align-items:center;justify-content:center;background:rgba(2,6,23,.8);backdrop-filter:blur(4px);border-radius:18px;">
            <div style="display:flex;align-items:center;gap:10px;padding:12px 20px;border-radius:999px;border:1px solid rgba(255,255,255,.2);background:rgba(15,23,42,.95);font-weight:700;font-size:13px;letter-spacing:.02em;">
              <svg class="qb-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
              Saving settings…
            </div>
          </div>

          <div class="qb-modal-header">
            <div>
              <div class="qb-modal-title">Quickbase Settings</div>
              <div class="qb-modal-sub">Configure report, columns, filters and counters per tab</div>
            </div>
            <button class="qb-modal-close" id="qbCloseSettingsBtn" type="button" aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          <!-- BYPASS GLOBAL TOGGLE -->
          <div id="qbBypassRow" class="qb-bypass-row">
            <div class="qb-bypass-info">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              <div>
                <div class="qb-bypass-label">Use Personal QB Config for this tab</div>
                <div class="qb-bypass-desc">Bypass Global QB Settings — use your own Report URL &amp; QB Token for this tab only</div>
              </div>
            </div>
            <label class="qb-toggle" title="Toggle personal QB config for this tab">
              <input type="checkbox" id="qbBypassToggle" />
              <span class="qb-toggle-track"><span class="qb-toggle-thumb"></span></span>
            </label>
          </div>

          <div class="qb-modal-tabs">
            <button type="button" class="qb-modal-tab qb-bypass-only" id="qbTabReportConfig" data-qb-settings-tab="report-config" style="display:none">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="margin-right:4px"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              Report Config
            </button>
            <button type="button" class="qb-modal-tab active" data-qb-settings-tab="custom-columns">Custom Columns</button>
            <button type="button" class="qb-modal-tab" data-qb-settings-tab="filter-config">Filter Config</button>
            <button type="button" class="qb-modal-tab" data-qb-settings-tab="dashboard-counters">Dashboard Counters</button>
          </div>

          <div class="qb-modal-body">

            <!-- REPORT CONFIG (only visible when bypassGlobal=true) -->
            <section class="qb-modal-section qb-bypass-only" data-qb-settings-view="report-config" style="display:none;">
              <div class="qb-section-title"><span class="qb-section-num qb-bypass-num">★</span>Personal Report Config</div>
              <div class="qb-bypass-notice">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                This tab uses your personal QB config. Other tabs still use Global QB Settings.
              </div>
              <div class="qb-field" style="margin-bottom:14px;">
                <label class="qb-field-label">Report Link (URL)</label>
                <input class="qb-field-input" id="qbBypassReportLink" type="text" placeholder="https://yourcompany.quickbase.com/nav/app/..." autocomplete="off" />
                <div style="margin-top:6px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
                  <div>
                    <div class="qb-field-label" style="font-size:10px;margin-bottom:3px;">Realm (auto-filled)</div>
                    <input class="qb-field-input" id="qbBypassRealm" type="text" placeholder="Auto" readonly style="font-size:11px;opacity:.7;"/>
                  </div>
                  <div>
                    <div class="qb-field-label" style="font-size:10px;margin-bottom:3px;">Table ID (auto-filled)</div>
                    <input class="qb-field-input" id="qbBypassTableId" type="text" placeholder="Auto" readonly style="font-size:11px;opacity:.7;"/>
                  </div>
                  <div>
                    <div class="qb-field-label" style="font-size:10px;margin-bottom:3px;">QID (auto-filled)</div>
                    <input class="qb-field-input" id="qbBypassQid" type="text" placeholder="Auto" readonly style="font-size:11px;opacity:.7;"/>
                  </div>
                </div>
              </div>
              <div class="qb-field">
                <label class="qb-field-label">
                  Personal QB Token
                  <span style="font-size:10px;opacity:.6;margin-left:6px;">(Secured — stored in your profile)</span>
                </label>
                <!-- AUTOFILL TRAP: Hidden dummy field absorbs browser password-manager autofill.
                     Chrome/Edge inject credentials into the FIRST password field they find.
                     This invisible field takes the hit so #qbBypassToken stays clean. -->
                <input type="password" aria-hidden="true" tabindex="-1" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden;" autocomplete="current-password" />
                <input class="qb-field-input" id="qbBypassToken" type="password" placeholder="Enter your personal QB User Token" autocomplete="new-password" data-lpignore="true" data-1p-ignore />
                <div style="margin-top:5px;font-size:11px;opacity:.55;">
                  ⚡ Realm, Table ID and QID auto-fill from the Report Link URL
                </div>
              </div>
            </section>

            <section class="qb-modal-section" data-qb-settings-view="custom-columns">
              <div class="qb-section-title"><span class="qb-section-num">1</span>Custom Columns</div>
              <div class="qb-field" style="margin-bottom:14px;">
                <label class="qb-field-label">Tab Name</label>
                <input class="qb-field-input" id="qbTabName" value="${esc(state.tabName)}" placeholder="e.g. My Cases" />
              </div>
              <div class="qb-field" style="margin-bottom:12px;">
                <label class="qb-field-label">Search Columns</label>
                <input type="text" id="qbColumnSearch" placeholder="Filter available fields…" class="qb-field-input" />
              </div>
              <div style="position:relative;">
                <div class="qb-columns-scroll">
                  <div id="qbColumnGrid" class="qb-col-grid"></div>
                </div>
                <div id="qbSelectedFloatingPanel" style="display:none;position:absolute;top:12px;right:14px;z-index:40;min-width:240px;max-width:320px;background:linear-gradient(140deg,rgba(15,23,42,.95),rgba(30,41,59,.9));backdrop-filter:blur(14px);border:1px solid rgba(148,163,184,.3);border-radius:14px;box-shadow:0 16px 40px rgba(0,0,0,.5);">
                  <div id="qbSelectedFloatingHandle" style="padding:10px 14px;cursor:move;border-bottom:1px solid rgba(148,163,184,.2);font-weight:700;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:rgba(148,163,184,.9);">Selected Columns</div>
                  <div id="qbSelectedFloatingList" style="display:grid;gap:6px;padding:10px 14px;max-height:230px;overflow:auto;font-size:12px;"></div>
                </div>
              </div>
            </section>

            <section class="qb-modal-section" data-qb-settings-view="filter-config" style="display:none;">
              <div class="qb-section-header">
                <div class="qb-section-title" style="margin-bottom:0;"><span class="qb-section-num">2</span>Filter Config</div>
                <button class="qb-btn qb-btn-ghost qb-btn-sm" id="qbAddFilterBtn" type="button">+ Add Filter</button>
              </div>
              <div class="qb-filter-match-row">
                <span class="qb-field-label" style="margin:0;">Match</span>
                <select class="qb-field-input qb-select-sm" id="qbFilterMatch">
                  <option value="ALL" ${state.filterMatch === 'ALL' ? 'selected' : ''}>ALL of the following rules</option>
                  <option value="ANY" ${state.filterMatch === 'ANY' ? 'selected' : ''}>ANY of the following rules</option>
                </select>
              </div>
              <div id="qbFilterRows" class="qb-filter-rows"></div>
            </section>

            <section class="qb-modal-section" data-qb-settings-view="dashboard-counters" style="display:none;">
              <div class="qb-section-header">
                <div class="qb-section-title" style="margin-bottom:0;"><span class="qb-section-num">3</span>Dashboard Counter Filters</div>
                <button class="qb-btn qb-btn-primary qb-btn-sm" id="qbAddCounterBtn" type="button">+ Add Counter</button>
              </div>
              <div id="qbCounterRows" class="qb-counter-rows"></div>
            </section>

          </div>

          <div class="qb-modal-footer">
            <button class="qb-btn qb-btn-ghost" id="qbCancelSettingsBtn" type="button">Cancel</button>
            <button class="qb-btn qb-btn-primary" id="qbSaveSettingsBtn" type="button">Save Settings</button>
          </div>
        </div>
      </div>
    `;


    function renderSelectedFloatingPanel() {
      const panel = root.querySelector('#qbSelectedFloatingPanel');
      const list = root.querySelector('#qbSelectedFloatingList');
      if (!panel || !list) return;

      if (!state.customColumns.length) {
        panel.style.display = 'none';
        list.innerHTML = '';
        return;
      }

      const byId = new Map(state.allAvailableFields.map((f) => [String(f.id), String(f.label || `Field #${f.id}`)]));
      list.innerHTML = state.customColumns
        .map((id, idx) => `<div style="display:flex;gap:8px;align-items:flex-start;"><span style="min-width:18px;color:#38bdf8;font-weight:700;">${idx + 1}.</span><span>${esc(byId.get(String(id)) || `Field #${id}`)}</span></div>`)
        .join('');
      panel.style.display = 'block';
    }

    function applyColumnSearch() {
      const input = root.querySelector('#qbColumnSearch');
      const query = String(input && input.value || '').trim().toLowerCase();
      root.querySelectorAll('#qbColumnGrid .qb-col-card').forEach((card) => {
        const haystack = String(card.getAttribute('data-col-label') || '').toLowerCase();
        card.style.display = !query || haystack.includes(query) ? 'flex' : 'none';
      });
    }

    function renderColumnGrid() {
      const grid = root.querySelector('#qbColumnGrid');
      if (!grid) return;
      if (!state.allAvailableFields.length) {
        grid.innerHTML = '<div class="small muted">Load data first to fetch available Quickbase fields.</div>';
        renderSelectedFloatingPanel();
        return;
      }

      const selectedById = new Map();
      state.customColumns.forEach((id, idx) => selectedById.set(String(id), idx + 1));

      grid.innerHTML = state.allAvailableFields.map((f) => {
        const id = String(f.id);
        const order = selectedById.get(id);
        const label = String(f.label || `Field #${id}`);
        return `
          <button type="button" data-col-id="${esc(id)}" data-col-label="${esc(`${label} #${id}`)}" class="qb-col-card" style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 10px;border-radius:10px;border:1px solid ${order ? 'rgba(56,189,248,.72)' : 'rgba(148,163,184,.25)'};background:${order ? 'rgba(14,116,144,.45)' : 'rgba(15,23,42,.45)'};color:inherit;cursor:pointer;text-align:left;min-height:40px;">
            <span class="small" style="font-weight:${order ? '700' : '500'};">${esc(label)} <span class="muted">(#${esc(id)})</span></span>
            ${order ? `<span style="display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;padding:0 7px;border-radius:999px;background:rgba(14,165,233,.22);border:1px solid rgba(56,189,248,.55);font-size:12px;font-weight:700;">${order}</span>` : ''}
          </button>
        `;
      }).join('');
      applyColumnSearch();
      renderSelectedFloatingPanel();

      grid.querySelectorAll('.qb-col-card').forEach((el) => {
        el.addEventListener('click', () => {
          const id = String(el.getAttribute('data-col-id') || '').trim();
          if (!id) return;
          if (!state.customColumns.includes(id)) {
            state.customColumns.push(id);
          } else {
            state.customColumns = state.customColumns.filter((v) => v !== id);
          }
          syncActiveTabFromState();
          queuePersistQuickbaseSettings();
          renderColumnGrid();
        });
      });
    }

    function filterRowTemplate(f, idx) {
      const knownFields = Array.isArray(state.allAvailableFields) ? state.allAvailableFields.slice() : [];
      const selectedFieldId = String(f.fieldId || '').trim();
      if (selectedFieldId && !knownFields.some((x) => String(x && x.id) === selectedFieldId)) {
        knownFields.unshift({ id: selectedFieldId, label: `Field #${selectedFieldId}` });
      }
      const fieldOptions = knownFields.map((x) => `<option value="${esc(String(x.id))}" ${String(f.fieldId) === String(x.id) ? 'selected' : ''}>${esc(x.label)} (#${esc(String(x.id))})</option>`).join('');
      const activeValue = String(f.value || '').trim();
      return `
        <div class="row" data-filter-idx="${idx}" style="gap:8px;align-items:center;flex-wrap:wrap;">
          <select class="input" data-f="fieldId" style="max-width:300px;"><option value="">Select field</option>${fieldOptions}</select>
          <select class="input" data-f="operator" style="max-width:120px;">
            <option value="EX" ${f.operator === 'EX' ? 'selected' : ''}>Is (Exact)</option>
            <option value="XEX" ${f.operator === 'XEX' ? 'selected' : ''}>Is Not</option>
            <option value="CT" ${f.operator === 'CT' ? 'selected' : ''}>Contains</option>
            <option value="XCT" ${f.operator === 'XCT' ? 'selected' : ''}>Does Not Contain</option>
            <option value="SW" ${f.operator === 'SW' ? 'selected' : ''}>Starts With</option>
            <option value="XSW" ${f.operator === 'XSW' ? 'selected' : ''}>Does Not Start With</option>
            <option value="BF" ${f.operator === 'BF' ? 'selected' : ''}>Before</option>
            <option value="AF" ${f.operator === 'AF' ? 'selected' : ''}>After</option>
            <option value="IR" ${f.operator === 'IR' ? 'selected' : ''}>In Range</option>
            <option value="XIR" ${f.operator === 'XIR' ? 'selected' : ''}>Not In Range</option>
          </select>
          <input type="text" class="input" data-f="value" value="${esc(activeValue)}" placeholder="Filter value" style="min-width:220px;" />
          <button class="btn" data-remove-filter="${idx}" type="button">Remove</button>
        </div>
      `;
    }

    function renderFilters() {
      const rows = root.querySelector('#qbFilterRows');
      if (!rows) return;
      if (!state.customFilters.length) {
        rows.innerHTML = '<div class="small muted">No custom filters configured.</div>';
      } else {
        rows.innerHTML = state.customFilters.map((f, idx) => filterRowTemplate(f, idx)).join('');
      }

      rows.querySelectorAll('[data-remove-filter]').forEach((btn) => {
        btn.onclick = () => {
          const idx = Number(btn.getAttribute('data-remove-filter'));
          state.customFilters = state.customFilters.filter((_, i) => i !== idx);
          syncActiveTabFromState();
          queuePersistQuickbaseSettings();
          renderFilters();
        };
      });

      rows.querySelectorAll('[data-filter-idx]').forEach((row) => {
        const idx = Number(row.getAttribute('data-filter-idx'));
        row.querySelectorAll('[data-f]').forEach((input) => {
          const key = String(input.getAttribute('data-f') || '');
          const eventName = input.tagName === 'SELECT' ? 'change' : 'input';
          input.addEventListener(eventName, () => {
            if (!state.customFilters[idx]) return;
            if (key === 'fieldId') {
              state.customFilters[idx].fieldId = String(input.value || '').trim();
              syncActiveTabFromState();
              queuePersistQuickbaseSettings();
              return;
            }
            if (key === 'value') {
              state.customFilters[idx].value = String(input.value || '').trim();
              syncActiveTabFromState();
              queuePersistQuickbaseSettings();
              return;
            }
            state.customFilters[idx][key] = String(input.value || '').trim();
            syncActiveTabFromState();
            queuePersistQuickbaseSettings();
          });
        });
      });

      const match = root.querySelector('#qbFilterMatch');
      if (match) {
        match.onchange = () => {
          state.filterMatch = normalizeFilterMatch(match.value);
          syncActiveTabFromState();
          queuePersistQuickbaseSettings();
        };
      }
    }


    function getCounterTargetFields() {
      const candidates = [];
      const addFromSource = (list) => {
        if (!Array.isArray(list)) return;
        list.forEach((item) => {
          if (!item || typeof item !== 'object') return;
          const id = String(item.id ?? item.fieldId ?? item.fid ?? '').trim();
          if (!id) return;
          const label = String(item.label ?? item.name ?? item.title ?? '').trim() || `Field #${id}`;
          candidates.push({ id, label });
        });
      };

      addFromSource(state.allAvailableFields);
      if (!candidates.length) {
        addFromSource(state.rawPayload && state.rawPayload.columns);
      }

      const seen = new Set();
      return candidates.filter((field) => {
        if (seen.has(field.id)) return false;
        seen.add(field.id);
        return true;
      });
    }

    function counterRowTemplate(counter, idx) {
      const targetFields = getCounterTargetFields();
      const fieldOptions = targetFields
        .map((x) => `<option value="${esc(String(x.id))}" ${String(counter.fieldId) === String(x.id) ? 'selected' : ''}>${esc(x.label)} (#${esc(String(x.id))})</option>`)
        .join('');
      return `
        <div data-counter-idx="${idx}" style="display:grid;gap:8px;padding:10px;border-radius:12px;background:rgba(15,23,42,.35);border:1px solid rgba(255,255,255,.12);">
          <div class="row" style="justify-content:space-between;align-items:center;">
            <div class="small muted" style="font-weight:700;">Counter ${idx + 1}</div>
            <button class="btn" data-remove-counter="${idx}" type="button" aria-label="Delete counter">🗑️</button>
          </div>
          <div class="grid cols-2" style="gap:8px;">
            <label class="field"><div class="label">Target Field</div><select class="input" data-counter-f="fieldId"><option value="">Select field</option>${fieldOptions}</select></label>
            <label class="field"><div class="label">Operator</div><select class="input" data-counter-f="operator">
              <option value="EX" ${counter.operator === 'EX' ? 'selected' : ''}>Is Equal To</option>
              <option value="XEX" ${counter.operator === 'XEX' ? 'selected' : ''}>Is Not Equal To</option>
              <option value="CT" ${counter.operator === 'CT' ? 'selected' : ''}>Contains</option>
            </select></label>
          </div>
          <label class="field"><div class="label">Glass Color</div><select class="input" data-counter-f="color">
            <option value="default" ${normalizeCounterColor(counter.color) === 'default' ? 'selected' : ''}>Default (Dark)</option>
            <option value="blue" ${normalizeCounterColor(counter.color) === 'blue' ? 'selected' : ''}>Blue</option>
            <option value="green" ${normalizeCounterColor(counter.color) === 'green' ? 'selected' : ''}>Green</option>
            <option value="red" ${normalizeCounterColor(counter.color) === 'red' ? 'selected' : ''}>Red</option>
            <option value="purple" ${normalizeCounterColor(counter.color) === 'purple' ? 'selected' : ''}>Purple</option>
            <option value="orange" ${normalizeCounterColor(counter.color) === 'orange' ? 'selected' : ''}>Orange</option>
          </select></label>
          <label class="field"><div class="label">Value</div><input type="text" class="input" data-counter-f="value" value="${esc(counter.value || '')}" placeholder="e.g. Open" /></label>
          <label class="field"><div class="label">Label</div><input type="text" class="input" data-counter-f="label" value="${esc(counter.label || '')}" placeholder="e.g. Open Cases" /></label>
        </div>
      `;
    }

    function renderCounterFilters() {
      const rows = root.querySelector('#qbCounterRows');
      if (!rows) return;
      if (!state.dashboardCounters.length) {
        rows.innerHTML = '<div class="small muted">No dashboard counter filters configured.</div>';
      } else {
        rows.innerHTML = state.dashboardCounters.map((counter, idx) => counterRowTemplate(counter, idx)).join('');
      }

      rows.querySelectorAll('[data-remove-counter]').forEach((btn) => {
        btn.onclick = () => {
          const idx = Number(btn.getAttribute('data-remove-counter'));
          state.dashboardCounters = state.dashboardCounters.filter((_, i) => i !== idx);
          syncActiveTabFromState();
          queuePersistQuickbaseSettings();
          renderCounterFilters();
        };
      });

      rows.querySelectorAll('[data-counter-idx]').forEach((row) => {
        const idx = Number(row.getAttribute('data-counter-idx'));
        row.querySelectorAll('[data-counter-f]').forEach((input) => {
          const key = String(input.getAttribute('data-counter-f') || '').trim();
          const eventName = input.tagName === 'SELECT' ? 'change' : 'input';
          input.addEventListener(eventName, () => {
            if (!state.dashboardCounters[idx]) return;
            state.dashboardCounters[idx][key] = String(input.value || '').trim();
            syncActiveTabFromState();
            queuePersistQuickbaseSettings();
          });
        });
      });
    }

    function bindColumnSearch() {
      const input = root.querySelector('#qbColumnSearch');
      if (!input || modalBindingsActive) return;
      const onKeyUp = () => applyColumnSearch();
      input.addEventListener('keyup', onKeyUp);
      cleanupHandlers.push(() => input.removeEventListener('keyup', onKeyUp));
    }

    function bindFloatingDrag() {
      const panel = root.querySelector('#qbSelectedFloatingPanel');
      const handle = root.querySelector('#qbSelectedFloatingHandle');
      if (!panel || !handle || modalBindingsActive) return;

      let dragging = false;
      let startX = 0;
      let startY = 0;
      let originLeft = 0;
      let originTop = 0;

      const onMouseMove = (event) => {
        if (!dragging) return;
        const nextLeft = originLeft + (event.clientX - startX);
        const nextTop = originTop + (event.clientY - startY);
        panel.style.left = `${Math.max(6, nextLeft)}px`;
        panel.style.top = `${Math.max(6, nextTop)}px`;
        panel.style.right = 'auto';
      };
      const onMouseUp = () => {
        dragging = false;
      };
      const onMouseDown = (event) => {
        dragging = true;
        startX = event.clientX;
        startY = event.clientY;
        originLeft = panel.offsetLeft;
        originTop = panel.offsetTop;
        event.preventDefault();
      };

      handle.addEventListener('mousedown', onMouseDown);
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      cleanupHandlers.push(() => {
        handle.removeEventListener('mousedown', onMouseDown);
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      });
    }

    function bindReportLinkAutoExtract() {
      const reportLinkEl = root.querySelector('#qbReportLink');
      const tableIdEl = root.querySelector('#qbTableId');
      const qidEl = root.querySelector('#qbQid');
      const tabBaseQidEl = root.querySelector('#qbTabBaseQid');
      if (!reportLinkEl || !tableIdEl || !qidEl || !tabBaseQidEl || modalBindingsActive) return;

      let lastAutoFillToastAt = 0;
      let fetchFieldsTimer = null;
      let lastFetchedLink = '';
      const applyAutoExtract = async () => {
        const nextLink = String(reportLinkEl.value || '').trim();
        const prevLink = String(state.reportLink || '').trim();
        const prevQid = String(state.qid || '').trim();
        const prevTableId = String(state.tableId || '').trim();
        const prevRealm = String(state.realm || '').trim();
        handleReportLinkChange(getActiveTabId(), nextLink);
        const didAutoFill = prevQid !== String(state.qid || '').trim()
          || prevTableId !== String(state.tableId || '').trim()
          || prevRealm !== String(state.realm || '').trim();
        syncActiveTabFromState();
        queuePersistQuickbaseSettings();
        if (didAutoFill && window.UI && UI.toast && (Date.now() - lastAutoFillToastAt) > 1200) {
          UI.toast('Auto-filled from Link');
          lastAutoFillToastAt = Date.now();
        }
        // FIX: [Issue 3] - Real-time field detection should refresh for any changed/pasted link,
        // even when qid/tableId stay the same (realm-only change, or repasting same link after tab switch).
        if (fetchFieldsTimer) clearTimeout(fetchFieldsTimer);
        const normalizedNextLink = String(nextLink || '').trim();
        const shouldRefreshFields = !!normalizedNextLink && (normalizedNextLink !== prevLink || normalizedNextLink !== lastFetchedLink);
        if (shouldRefreshFields) {
          fetchFieldsTimer = setTimeout(async () => {
            try {
              await refreshAvailableFieldsForActiveTab(getActiveTabId());
              lastFetchedLink = normalizedNextLink;
              renderColumnGrid();
              renderFilters();
              renderCounterFilters();
            } catch (_) {}
          }, 250);
        }
      };

      const onPaste = () => setTimeout(applyAutoExtract, 0);
      reportLinkEl.addEventListener('input', applyAutoExtract);
      reportLinkEl.addEventListener('paste', onPaste);
      cleanupHandlers.push(() => {
        if (fetchFieldsTimer) clearTimeout(fetchFieldsTimer);
        reportLinkEl.removeEventListener('input', applyAutoExtract);
        reportLinkEl.removeEventListener('paste', onPaste);
      });
    }

    function cleanupModalBindings() {
      while (cleanupHandlers.length) {
        const fn = cleanupHandlers.pop();
        if (typeof fn === 'function') fn();
      }
      modalBindingsActive = false;
    }


    async function refreshAvailableFieldsForActiveTab(tabId) {
      const safeTabId = String(tabId || getActiveTabId() || '').trim();
      if (!safeTabId) return;
      const managerSettings = tabManager && typeof tabManager.getTab === 'function'
        ? ((tabManager.getTab(safeTabId) || {}).settings || {})
        : {};
      const fallbackSettings = state.quickbaseSettings.settingsByTabId && state.quickbaseSettings.settingsByTabId[safeTabId]
        ? state.quickbaseSettings.settingsByTabId[safeTabId]
        : {};
      const tabSettings = createDefaultSettings(Object.assign({}, fallbackSettings, managerSettings), {});
      // FIX[QB-NameFilter]: Fall back to globalQbSettings for qid/tableId/realm.
      // New users / new tabs have empty tab-level settings — without this fallback
      // the field list stays empty and the Settings modal shows "Load data first".
      const _isBypassTab = !!(tabSettings.bypassGlobal);
      const parsed = parseQuickbaseLink(String(
        _isBypassTab ? (tabSettings.reportLink || '') : (globalQbSettings.reportLink || tabSettings.reportLink || '')
      ));
      const qid = _isBypassTab
        ? String(tabSettings.qid || parsed.qid || '').trim()
        : String(globalQbSettings.qid || tabSettings.qid || parsed.qid || '').trim();
      const tableId = _isBypassTab
        ? String(tabSettings.tableId || parsed.tableId || '').trim()
        : String(globalQbSettings.tableId || tabSettings.tableId || parsed.tableId || '').trim();
      const realm = _isBypassTab
        ? String(tabSettings.realm || parsed.realm || '').trim()
        : String(globalQbSettings.realm || tabSettings.realm || parsed.realm || '').trim();

      if (!qid || !tableId || !realm) {
        state.allAvailableFields = [];
        renderColumnGrid();
        renderFilters();
        renderCounterFilters();
        return;
      }

      try {
        const data = await window.QuickbaseAdapter.fetchMonitoringData({
          bust: Date.now(),
          limit: 1,
          qid,
          tableId,
          realm,
          customFilters: [],
          filterMatch: 'ALL',
          search: ''
        });
        state.allAvailableFields = Array.isArray(data && data.allAvailableFields) ? data.allAvailableFields : [];
      } catch (_) {
        state.allAvailableFields = [];
      }
      renderColumnGrid();
      renderFilters();
      renderCounterFilters();
    }

    async function loadQuickbaseData(options) {
      const opts = options && typeof options === 'object' ? options : {};
      const silent = !!opts.silent;
      const forceRefresh = !!opts.forceRefresh;
      const host = root.querySelector('#qbDataBody');
      const meta = root.querySelector('#qbDataMeta');
      const reloadBtn = root.querySelector('#qbReloadBtn');

      const activeTabId = String(getActiveTabId() || '').trim();
      const stateTabSettingsForGuard = state.quickbaseSettings.settingsByTabId && state.quickbaseSettings.settingsByTabId[activeTabId]
        ? createDefaultSettings(state.quickbaseSettings.settingsByTabId[activeTabId], {})
        : createDefaultSettings({}, {});
      // FIX[QB-NameFilter]: Use globalQbSettings.reportLink as primary source.
      // The outer guard was only checking the tab-level reportLink and returning
      // early before the inner logic could apply the global report link.
      // Members with a qb_name set should auto-load using the global report config.
      const _guardBypassed = !!(stateTabSettingsForGuard.bypassGlobal);
      const activeReportLink = _guardBypassed
        ? String(stateTabSettingsForGuard.reportLink || '').trim()
        : String(globalQbSettings.reportLink || stateTabSettingsForGuard.reportLink || '').trim();
      if (!activeReportLink) {
        const recordsContainer = document.querySelector('[data-qb-records-container]')
          || document.querySelector('.qb-records-body')
          || document.querySelector('#qbRecordsBody')
          || document.querySelector('.quickbase-records-container')
          || host;
        if (recordsContainer) {
          recordsContainer.innerHTML = '<div style="padding:40px;text-align:center;color:rgba(255,255,255,0.5);font-size:15px;">No records Loaded — Please configure a Report Link in Settings.</div>';
        }
        if (meta) meta.textContent = 'No Report Link configured';
        return;
      }

      if (quickbaseLoadInFlight) return quickbaseLoadInFlight;

      if (!silent) {
        if (host) host.innerHTML = '<div class="small muted" style="padding:8px;">Loading Quickbase data...</div>';
        if (meta) meta.textContent = 'Loading...';
      }

      // Stale-response guard: stamp this load with the current tab ID.
      // If the tab changes while the fetch is in-flight, the response is discarded.
      const loadToken = activeTabId;
      state._currentLoadToken = loadToken;

      quickbaseLoadInFlight = (async () => {
        if (reloadBtn) reloadBtn.disabled = true;
        const startedAt = performance.now();
        try {
          if (!window.QuickbaseAdapter || typeof window.QuickbaseAdapter.fetchMonitoringData !== 'function') {
            throw new Error('Quickbase adapter unavailable');
          }
          // Snapshot tab ID for stale-response check inside the async block
          const thisLoadTabId = loadToken;

          // ── ALWAYS use state.quickbaseSettings.settingsByTabId as the single source of truth.
          // TabManager (managerTab) is a secondary write-through cache and MUST NOT override
          // state.settingsByTabId — it may not be seeded for all tabs and can return stale defaults.
          const freshTabSettings = state.quickbaseSettings.settingsByTabId && state.quickbaseSettings.settingsByTabId[thisLoadTabId]
            ? createDefaultSettings(state.quickbaseSettings.settingsByTabId[thisLoadTabId], {})
            : createDefaultSettings({}, {});

          // ── BYPASS or GLOBAL report config resolution ────────────────────
          // Per-tab isolation: each tab independently decides if it bypasses global.
          // bypassGlobal=true → use tab's own reportLink + profile.qb_token (via server)
          // bypassGlobal=false → use Global QB Settings as usual
          const isTabBypassed = !!(freshTabSettings.bypassGlobal);
          const globalReportLink = String(globalQbSettings.reportLink || '').trim();
          const effectiveReportLink = isTabBypassed
            ? String(freshTabSettings.reportLink || '').trim()
            : (globalReportLink || String(freshTabSettings.reportLink || '').trim());

          const reportLink = effectiveReportLink;
          if (!reportLink) {
            state.allAvailableFields = [];
            state.baseRecords = [];
            state.rawPayload = { columns: [], records: [] };
            state.currentPayload = { columns: [], records: [] };
            renderColumnGrid();
            renderFilters();
            applySearchAndRender();
            const emptyMsg = isTabBypassed
              ? 'No records — configure your personal Report Link in Settings → Report Config tab.'
              : 'No records Loaded — Please configure a Report Link in Settings.';
            renderEmptyState(root, emptyMsg);
            return;
          }
          const shouldApplyFilters = shouldApplyServerFilters(opts);
          const tabCustomFilters = Array.isArray(freshTabSettings.customFilters) ? normalizeFilters(freshTabSettings.customFilters) : [];

          const tabFilterMatch = normalizeFilterMatch(freshTabSettings.filterMatch);
          const mergedFilters = shouldApplyFilters ? tabCustomFilters : [];
          // Derive qid/tableId/realm — bypass tab uses its own, non-bypass uses global first
          const _tabParsed = parseQuickbaseLink(effectiveReportLink);
          const activeQid = isTabBypassed
            ? String(freshTabSettings.qid || _tabParsed.qid || '').trim()
            : String(globalQbSettings.qid || freshTabSettings.qid || _tabParsed.qid || '').trim();
          const activeTableId = isTabBypassed
            ? String(freshTabSettings.tableId || _tabParsed.tableId || '').trim()
            : String(globalQbSettings.tableId || freshTabSettings.tableId || _tabParsed.tableId || '').trim();
          const activeRealm = isTabBypassed
            ? String(freshTabSettings.realm || _tabParsed.realm || '').trim()
            : String(globalQbSettings.realm || freshTabSettings.realm || _tabParsed.realm || '').trim();
          const hasExplicitLoadMore = Number(opts.offset || 0) >= 100;
          const hasActiveSearch = !!String(getActiveSearchTerm() || '').trim();
          // BYPASS FIX: For bypass mode, fetch the full report in one shot (limit 500).
          // The server uses /v1/reports/{id}/run which handles pagination on QB's side.
          // For global mode: keep the 100-record first-load + background progressive fetch.
          const requestLimit = isTabBypassed ? 500 : 100;
          const cacheKey = getQuickbaseCacheKey({
            tabId: activeTabId,
            tableId: activeTableId,
            qid: activeQid || '',
            filters: mergedFilters,
            filterMatch: tabFilterMatch
          });
          // FIX: [Issue 2] - Reuse cache if fetched within 2 minutes.
          const cachedPayload = forceRefresh ? null : readQuickbaseCache(cacheKey, thisLoadTabId);
          if (cachedPayload) {
            // ── STALE GUARD (cache hit path) ──────────────────────────────
            // Cache hit is also async — verify we're still on the same tab
            // before writing to shared state.
            if (state._currentLoadToken !== thisLoadTabId) {
              console.info('[Quickbase] discarding stale cache hit for tab', thisLoadTabId);
              return;
            }
            state.allAvailableFields = Array.isArray(cachedPayload.allAvailableFields) ? cachedPayload.allAvailableFields : [];
            state.baseRecords = Array.isArray(cachedPayload.records) ? cachedPayload.records.slice() : [];
            state._loadedForTabId = thisLoadTabId;
            if (thisLoadTabId) {
              state._tabDataCache = Object.assign({}, state._tabDataCache || {}, {
                [thisLoadTabId]: Object.assign({}, state._tabDataCache && state._tabDataCache[thisLoadTabId] || {}, {
                  cachedRows: state.baseRecords.slice()
                })
              });
            }
            state.rawPayload = {
              columns: Array.isArray(cachedPayload.columns) ? cachedPayload.columns : [],
              records: state.baseRecords.slice()
            };
            renderColumnGrid();
            renderFilters();
            state.currentPage = 1;
            state.isDefaultReportMode = !shouldApplyFilters && !getActiveSearchTerm();
            applySearchAndRender();
            lastQuickbaseLoadAt = Date.now();
            if (typeof updateDataFreshnessBadge === 'function') updateDataFreshnessBadge(true);
            renderTabBar();
            console.info(`[Quickbase] cache hit (${state.baseRecords.length} records) in ${Math.round(performance.now() - startedAt)}ms`);
            return;
          }
          const requestPayload = {
            bust: Date.now(),
            limit: requestLimit,
            qid: activeQid || '',
            tableId: activeTableId,
            realm: activeRealm
          };
          if (!requestPayload.qid || !requestPayload.tableId || !requestPayload.realm) {
            state.allAvailableFields = [];
            state.baseRecords = [];
            state.rawPayload = { columns: [], records: [] };
            state.currentPayload = { columns: [], records: [] };
            renderColumnGrid();
            renderFilters();
            applySearchAndRender();
            lastQuickbaseLoadAt = Date.now();
            return;
          }
          const data = await window.QuickbaseAdapter.fetchMonitoringData({
            ...requestPayload,
            tab_id: activeTabId,
            reportLink,
            bypassGlobal: isTabBypassed,
            customColumns: Array.isArray(freshTabSettings.customColumns) ? freshTabSettings.customColumns : [],
            customFilters: mergedFilters,
            filterMatch: tabFilterMatch,
            search: ''
          });

          // ── STALE-RESPONSE GUARD ─────────────────────────────────────────
          // If the user switched tabs while this fetch was in-flight, discard
          // the response — it belongs to a different tab.
          if (state._currentLoadToken !== thisLoadTabId) {
            console.info('[Quickbase] discarding stale response for tab', thisLoadTabId, '(now on', state._currentLoadToken, ')');
            return;
          }

          state.allAvailableFields = Array.isArray(data && data.allAvailableFields) ? data.allAvailableFields : [];
          renderColumnGrid();
          renderFilters();
          const incomingColumns = Array.isArray(data && data.columns) ? data.columns : [];
          const incomingRecords = Array.isArray(data && data.records) ? data.records : [];
          state.baseRecords = incomingRecords.slice();
          state._loadedForTabId = thisLoadTabId;
          if (thisLoadTabId) {
            state._tabDataCache = Object.assign({}, state._tabDataCache || {}, {
              [thisLoadTabId]: Object.assign({}, state._tabDataCache && state._tabDataCache[thisLoadTabId] || {}, {
                cachedRows: incomingRecords.slice()
              })
            });
          }
          state.rawPayload = { columns: incomingColumns, records: state.baseRecords.slice() };
          state.isDefaultReportMode = !shouldApplyFilters && !getActiveSearchTerm();
          state.currentPage = 1;
          applySearchAndRender();
          if (typeof updateDataFreshnessBadge === 'function') updateDataFreshnessBadge(false);
          renderTabBar();
          writeQuickbaseCache(cacheKey, {
            columns: incomingColumns,
            records: state.baseRecords.slice(),
            allAvailableFields: state.allAvailableFields
          }, thisLoadTabId);
          // BYPASS FIX: Progressive background fetch is DISABLED for bypass mode.
          // Bypass tabs use POST /v1/reports/{id}/run (server-side) which already returns
          // the complete report dataset in one call. The background fetch uses the old
          // /v1/records/query path which ignores report filters → fetches 500 raw table
          // records → merges them with correct 80 bypass records → corrupts the display.
          // For global mode: progressive fetch still works as before (no change).
          if (!isTabBypassed && requestLimit < QUICKBASE_BACKGROUND_LIMIT && !hasExplicitLoadMore && !hasActiveSearch) {
            setTimeout(async () => {
              try {
                const bgData = await window.QuickbaseAdapter.fetchMonitoringData({
                  ...requestPayload,
                  tab_id: activeTabId,
                  reportLink,
                  bust: Date.now(),
                  limit: QUICKBASE_BACKGROUND_LIMIT,
                  customColumns: Array.isArray(freshTabSettings.customColumns) ? freshTabSettings.customColumns : [],
                  customFilters: mergedFilters,
                  filterMatch: tabFilterMatch,
                  search: ''
                });
                const bgRecords = Array.isArray(bgData && bgData.records) ? bgData.records : [];
                if (!bgRecords.length) return;
                state.baseRecords = mergeRecordsById(state.baseRecords, bgRecords);
                if (activeTabId) {
                  state._tabDataCache = Object.assign({}, state._tabDataCache || {}, {
                    [activeTabId]: Object.assign({}, state._tabDataCache && state._tabDataCache[activeTabId] || {}, {
                      cachedRows: state.baseRecords.slice()
                    })
                  });
                }
                state.rawPayload = { columns: incomingColumns, records: state.baseRecords.slice() };
                writeQuickbaseCache(cacheKey, {
                  columns: incomingColumns,
                  records: state.baseRecords.slice(),
                  allAvailableFields: state.allAvailableFields
                }, activeTabId);
                applySearchAndRender();
                console.info(`[Quickbase] progressive load merged ${bgRecords.length} records`);
              } catch (_) {}
            }, 0);
          }
          lastQuickbaseLoadAt = Date.now();
          console.info(`[Quickbase] loaded ${state.baseRecords.length} records in ${Math.round(performance.now() - startedAt)}ms`);
        } catch (err) {
          if (meta) meta.textContent = 'Check Connection';
          if (host) host.innerHTML = `<div class="small" style="padding:10px;color:#fecaca;">${esc(String(err && err.message || 'Unable to load Quickbase records'))}</div>`;
          renderDashboardCounters(root, [], { dashboard_counters: [] }, state);
        } finally {
          quickbaseLoadInFlight = null;
          if (reloadBtn) reloadBtn.disabled = false;
        }
      })();

      return quickbaseLoadInFlight;
    }

    function applySearchAndRender() {
      // ── TAB OWNERSHIP GUARD ─────────────────────────────────────────────
      // Never render data from a different tab. _loadedForTabId tracks which
      // tab's records are currently in state.baseRecords. If it doesn't match
      // the active tab, skip rendering stale data.
      const _renderForTabId = getActiveTabId();
      if (state._loadedForTabId && state._loadedForTabId !== _renderForTabId) {
        console.info('[Quickbase] applySearchAndRender skipped — data is for tab', state._loadedForTabId, 'but active is', _renderForTabId);
        return;
      }

      const normalizedSearch = getActiveSearchTerm();
      const activeCounter = state.activeCounterIndex >= 0 ? state.dashboardCounters[state.activeCounterIndex] : null;
      state.searchTerm = normalizedSearch;

      const activeTabId = _renderForTabId;
      const freshTabSettings = state.quickbaseSettings.settingsByTabId && state.quickbaseSettings.settingsByTabId[activeTabId]
        ? createDefaultSettings(state.quickbaseSettings.settingsByTabId[activeTabId], {})
        : createDefaultSettings({}, {});

      let filteredBase = Array.isArray(state.baseRecords) ? state.baseRecords : [];
      if (Array.isArray(freshTabSettings.customFilters) && freshTabSettings.customFilters.length > 0) {
        const filterMatch = normalizeFilterMatch(freshTabSettings.filterMatch);

        // INCLUSION operators (EX, CT): same-field values → OR'd (record passes if it matches ANY value)
        // EXCLUSION operators (XEX, XCT): each must individually pass → AND'd
        // e.g. Status!=Resolved AND Status!=Bug — using some() here would be always-true
        var CLIENT_INCLUSION_OPS = { EX: 1, CT: 1, SW: 1, TV: 1, BF: 1, AF: 1, LT: 1, LTE: 1, GT: 1, GTE: 1, IR: 1 };

        var inclusionByField = new Map();
        var exclusionFilters = [];
        freshTabSettings.customFilters.forEach(function(filter) {
          var fid = String(filter.fieldId || '').trim();
          if (!fid) return;
          var op = String(filter.operator || 'EX').trim().toUpperCase();
          if (CLIENT_INCLUSION_OPS[op]) {
            if (!inclusionByField.has(fid)) inclusionByField.set(fid, []);
            inclusionByField.get(fid).push(filter);
          } else {
            exclusionFilters.push(filter);
          }
        });

        function evalFilter(filter, record) {
          var field = record && record.fields ? record.fields[String(filter.fieldId)] : null;
          var sourceValue = String(field && field.value != null ? field.value : '').toLowerCase();
          var matcherValue = String(filter.value || '').toLowerCase();
          var op = String(filter.operator || 'EX').trim().toUpperCase();
          if (op === 'XEX') return sourceValue !== matcherValue;
          if (op === 'CT') return sourceValue.includes(matcherValue);
          if (op === 'XCT') return !sourceValue.includes(matcherValue);
          if (op === 'SW') return sourceValue.startsWith(matcherValue);
          if (op === 'XSW') return !sourceValue.startsWith(matcherValue);
          return sourceValue === matcherValue;
        }

        filteredBase = filteredBase.filter(function(record) {
          if (filterMatch === 'ANY') {
            // ANY mode: record passes if any single filter condition is true
            return freshTabSettings.customFilters.some(function(f) { return evalFilter(f, record); });
          } else {
            // ALL mode, two-phase evaluation:
            // Phase 1 — INCLUSION: each field group needs at least one match (OR within field)
            var inclusionOk = Array.from(inclusionByField.entries()).every(function(entry) {
              return entry[1].some(function(f) { return evalFilter(f, record); });
            });
            if (!inclusionOk) return false;
            // Phase 2 — EXCLUSION: every exclusion must individually pass (AND'd)
            return exclusionFilters.every(function(f) { return evalFilter(f, record); });
          }
        });
      }

      const basePayload = {
        columns: Array.isArray(state.rawPayload && state.rawPayload.columns) ? state.rawPayload.columns : [],
        records: filteredBase
      };
      const counterFilteredPayload = filterRecordsByCounter(basePayload, activeCounter);
      state.currentPayload = normalizedSearch
        ? filterRecordsBySearch(counterFilteredPayload, normalizedSearch)
        : counterFilteredPayload;
      const totalRows = Array.isArray(state.currentPayload.records) ? state.currentPayload.records.length : 0;
      const maxPage = Math.max(1, Math.ceil(totalRows / state.pageSize));
      state.currentPage = Math.min(Math.max(state.currentPage, 1), maxPage);
      renderRecords(root, state.currentPayload, {
        userInitiatedSearch: !!getActiveUserSearched() && !!normalizedSearch.length,
        page: state.currentPage,
        pageSize: state.pageSize,
        onPageChange: (nextPage) => {
          state.currentPage = nextPage;
          applySearchAndRender();
        }
      });
      renderDashboardCounters(root, state.baseRecords, { dashboard_counters: state.dashboardCounters }, state, (idx) => {
        state.activeCounterIndex = state.activeCounterIndex === idx ? -1 : idx;
        state.currentPage = 1;
        applySearchAndRender();
      });

      // ── SEARCH SCOPE INDICATOR ────────────────────────────────────────────
      // When a counter filter is active, show a scoped-search tag below the
      // search input so the user knows the search operates on the filtered
      // subset ONLY. Releasing the counter automatically resets the scope.
      const _scopeTagEl   = root.querySelector('#qbSearchScopeTag');
      const _searchInputEl = root.querySelector('#qbHeaderSearch');
      if (activeCounter) {
        const _cLabel       = String(activeCounter.label || activeCounter.value || 'Filter').trim();
        const _cCount       = Array.isArray(counterFilteredPayload.records) ? counterFilteredPayload.records.length : 0;
        const _cColor       = normalizeCounterColor(activeCounter.color);
        const _colorMap     = { blue: '#60a5fa', green: '#4ade80', red: '#f87171', purple: '#c084fc', orange: '#fb923c', default: '#94a3b8' };
        const _accentColor  = _colorMap[_cColor] || _colorMap.default;
        if (_scopeTagEl) {
          _scopeTagEl.innerHTML = `
            <svg class="qb-scope-ico" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="${_accentColor}" stroke-width="2.5" stroke-linecap="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
            <span style="color:rgba(148,163,184,.75);">Scope:</span>
            <span class="qb-scope-lbl" style="color:${_accentColor};" title="${esc(_cLabel)}">${esc(_cLabel)}</span>
            <span class="qb-scope-count">&nbsp;(${_cCount} record${_cCount === 1 ? '' : 's'})</span>
            <button class="qb-scope-dismiss" type="button" title="Clear counter filter" data-qb-scope-dismiss="1">×</button>
          `;
          _scopeTagEl.classList.add('is-visible');
          _scopeTagEl.style.borderColor = `${_accentColor}44`;
          _scopeTagEl.style.background  = `${_accentColor}12`;
          // Bind dismiss — clears the counter filter without removing search text
          const _dismissBtn = _scopeTagEl.querySelector('[data-qb-scope-dismiss]');
          if (_dismissBtn) {
            _dismissBtn.onclick = (e) => {
              e.stopPropagation();
              state.activeCounterIndex = -1;
              state.currentPage = 1;
              applySearchAndRender();
            };
          }
        }
        if (_searchInputEl) {
          _searchInputEl.placeholder = `Search within "${_cLabel}"…`;
          _searchInputEl.classList.add('qb-search-scoped');
        }
      } else {
        if (_scopeTagEl) {
          _scopeTagEl.classList.remove('is-visible');
          _scopeTagEl.innerHTML = '';
          _scopeTagEl.style.borderColor = '';
          _scopeTagEl.style.background  = '';
        }
        if (_searchInputEl) {
          _searchInputEl.placeholder = 'Search across active tab records…';
          _searchInputEl.classList.remove('qb-search-scoped');
        }
      }
    }

    function setupAutoRefresh() {
      if (quickbaseRefreshTimer) clearInterval(quickbaseRefreshTimer);
      quickbaseRefreshTimer = setInterval(() => {
        if (document.hidden) return;
        // forceRefresh:true bypasses the 2-min cache so every tick fetches live data
        loadQuickbaseData({ silent: true, forceRefresh: true });
      }, AUTO_REFRESH_MS);

      const onVisibilityChange = () => {
        if (document.hidden) return;
        const shouldRefresh = !lastQuickbaseLoadAt || (Date.now() - lastQuickbaseLoadAt) >= AUTO_REFRESH_MS;
        if (shouldRefresh) loadQuickbaseData({ silent: true, forceRefresh: true });
      };

      document.addEventListener('visibilitychange', onVisibilityChange);
      window.addEventListener('focus', onVisibilityChange);

      const prevCleanup = root._cleanup;
      root._cleanup = () => {
        try { if (prevCleanup) prevCleanup(); } catch (_) {}
        try { cleanupModalBindings(); } catch (_) {}
        try { if (quickbaseRefreshTimer) clearInterval(quickbaseRefreshTimer); } catch (_) {}
        try { if (state.searchDebounceTimer) clearTimeout(state.searchDebounceTimer); } catch (_) {}
        try { if (autosaveTimer) clearTimeout(autosaveTimer); } catch (_) {}
        // Layer 3: Standard cleanup — clear inline layout styles and remove class.
        // (Layers 1+2 already handled by MutationObserver the moment shell was removed.)
        try { root.style.padding  = ''; } catch (_) {}
        try { root.style.overflow = ''; } catch (_) {}
        try { document.body.style.overflow = ''; } catch (_) {}
        try { root.classList.remove('page-qb'); } catch (_) {}
        try { if (_qbLayoutGuardObs) { _qbLayoutGuardObs.disconnect(); _qbLayoutGuardObs = null; } } catch (_) {}
        quickbaseRefreshTimer = null;
        document.removeEventListener('visibilitychange', onVisibilityChange);
        window.removeEventListener('focus', onVisibilityChange);
      };
    }

    function openSettings() {
      const currentTab = deepClone(getActiveTab() || {});
      state.settingsEditingTabId = String(currentTab.id || getActiveTabId() || '').trim();
      state.modalDraft = {
        tabName: deepClone(currentTab.tabName) || '',
        reportLink: deepClone(currentTab.reportLink) || '',
        qid: deepClone(currentTab.qid) || '',
        tableId: deepClone(currentTab.tableId) || '',
        realm: deepClone(currentTab.realm) || '',
        customColumns: deepClone(currentTab.customColumns || []),
        customFilters: deepClone(currentTab.customFilters || []),
        filterMatch: currentTab.filterMatch || 'ALL',
        dashboard_counters: deepClone(currentTab.dashboard_counters || [])
      };
      syncSettingsInputsFromState();
      renderColumnGrid();
      renderFilters();
      renderCounterFilters();
      setSettingsModalView('report-config');
      if (window.UI && UI.openModal) UI.openModal('qbSettingsModal');
      bindColumnSearch();
      bindFloatingDrag();
      bindReportLinkAutoExtract();
      modalBindingsActive = true;
      // Sync bypass UI state when opening settings modal
      const _openTabId = state.settingsEditingTabId || getActiveTabId();
      const _openTabSettings = createDefaultSettings((state.quickbaseSettings.settingsByTabId && state.quickbaseSettings.settingsByTabId[_openTabId]) || {}, {});
      const _isBypassed = !!_openTabSettings.bypassGlobal;
      applyBypassUIState(_isBypassed);
      syncBypassInputsFromState();

      // TOKEN MASK FIX: Apply masked-dots or empty state on every modal open.
      // Force-clear any browser autofill first, then re-apply correct visual state.
      const _tokEl = root.querySelector('#qbBypassToken');
      if (_tokEl) {
        // Wipe any browser-autofilled value first
        _tokEl.value = '';
        _tokEl.removeAttribute('data-token-masked');
        // Then apply the correct visual state (dots if saved, empty if not)
        _applyTokenSavedUI(_tokEl);
      }

      // FIX[Bug2]: If reportLink is already configured, prefetch fields in realtime so
      // Custom Columns, Filter Config, and Dashboard Counter dropdowns populate immediately
      // without requiring the user to re-type or re-paste the link.
      // FIX[QB-NameFilter]: Also check globalQbSettings.reportLink — members with a
      // qb_name set never have a tab-level reportLink but global settings does.
      const existingReportLink = String(
        _isBypassed ? (_openTabSettings.reportLink || '') : (globalQbSettings.reportLink || state.reportLink || '')
      ).trim();
      if (existingReportLink && state.allAvailableFields.length === 0) {
        refreshAvailableFieldsForActiveTab(state.settingsEditingTabId || getActiveTabId()).catch(() => {});
      }
    }

    function closeSettings() {
      if (state.isSaving) return;
      state.settingsEditingTabId = '';
      cleanupModalBindings();
      if (window.UI && UI.closeModal) UI.closeModal('qbSettingsModal');
    }

    async function deleteTabAtIndex(tabIndex) {
      const tabs = Array.isArray(state.quickbaseSettings && state.quickbaseSettings.tabs) ? state.quickbaseSettings.tabs : [];
      if (tabs.length <= 1) {
        if (window.UI && UI.toast) UI.toast('At least one tab must remain.', 'error');
        return;
      }
      const idx = Number(tabIndex);
      if (!Number.isFinite(idx) || idx < 0 || idx >= tabs.length) return;
      const target = tabs[idx] || {};
      const targetTabId = String(target.id || '').trim();
      const isDeletingActiveTab = state.activeTabIndex === idx;
      if (!targetTabId) return;

      try {
        if (tabManager) await tabManager.deleteTab(targetTabId);
        delete state.quickbaseSettings.settingsByTabId[targetTabId];
        if (state._tabDataCache && Object.prototype.hasOwnProperty.call(state._tabDataCache, targetTabId)) {
          delete state._tabDataCache[targetTabId];
        }
        state.quickbaseSettings.tabs = tabs.filter((_, i) => i !== idx);
        const nextLen = state.quickbaseSettings.tabs.length;
        if (!nextLen) {
          state.activeTabIndex = 0;
        } else if (isDeletingActiveTab) {
          state.activeTabIndex = 0;
        } else if (state.activeTabIndex > idx) {
          state.activeTabIndex = Math.max(0, state.activeTabIndex - 1);
        }
        state.activeTabIndex = Math.min(state.activeTabIndex, Math.max(0, nextLen - 1));
        state.quickbaseSettings.activeTabIndex = state.activeTabIndex;
        syncStateFromActiveTab();
        syncSettingsInputsFromState();
        queuePersistQuickbaseSettings();
        await persistQuickbaseSettings();
        renderTabBar();
        renderColumnGrid();
        renderFilters();
        renderCounterFilters();
        await loadQuickbaseData({ applyFilters: true, forceRefresh: true });
        if (window.UI && UI.toast) UI.toast('Tab deleted successfully.');
      } catch (err) {
        if (window.UI && UI.toast) UI.toast('Failed to delete tab: ' + String(err && err.message || err), 'error');
      }
    }

    async function renderDefaultReport() {
      state.didInitialDefaultRender = true;
      setActiveUserSearched(false);
      setActiveSearchTerm('');
      state.searchTerm = '';
      return loadQuickbaseData({ applyFilters: true });
    }

    root.querySelector('#qbOpenSettingsBtn').onclick = openSettings;
    root.querySelector('#qbCloseSettingsBtn').onclick = closeSettings;
    root.querySelector('#qbCancelSettingsBtn').onclick = closeSettings;
    root.querySelector('#qbSettingsModal').addEventListener('mousedown', (event) => {
      if (state.isSaving) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.target && event.target.id === 'qbSettingsModal') cleanupModalBindings();
    });
    root.querySelector('#qbReloadBtn').onclick = () => loadQuickbaseData({ applyFilters: true });

    // ── BYPASS TOGGLE LOGIC ───────────────────────────────────────────────────
    // Controls per-tab bypass of Global QB Settings.
    // When ON: shows Report Config tab, allows personal reportLink + qb_token.
    // Isolation: each tab stores its own bypassGlobal flag independently.

    function getActiveTabBypassState() {
      const tabId = getActiveTabId();
      const s = state.quickbaseSettings.settingsByTabId && state.quickbaseSettings.settingsByTabId[tabId];
      return !!(s && s.bypassGlobal);
    }

    function applyBypassUIState(isBypassed) {
      const toggle = root.querySelector('#qbBypassToggle');
      const reportConfigTab = root.querySelector('#qbTabReportConfig');
      const bypassOnlyEls = root.querySelectorAll('.qb-bypass-only');
      if (toggle) toggle.checked = !!isBypassed;
      bypassOnlyEls.forEach(el => { el.style.display = isBypassed ? '' : 'none'; });
      if (reportConfigTab) {
        reportConfigTab.style.display = isBypassed ? '' : 'none';
      }
      // If bypass just turned on, auto-switch to Report Config tab
      if (isBypassed) {
        const currentView = state.settingsModalView;
        if (currentView !== 'report-config') setSettingsModalView('report-config');
      } else {
        // If bypass turned off while on report-config, switch to custom-columns
        if (state.settingsModalView === 'report-config') setSettingsModalView('custom-columns');
      }
    }

    // Sentinel value used internally to mark "token is saved in DB".
    // This is NEVER sent to the server — it's stripped in the save handler.
    // Its only purpose is to show the password dots so users see the token is saved.
    const _QB_TOKEN_SAVED_SENTINEL = '__QB_TOKEN_SAVED__';

    function _applyTokenSavedUI(tokEl) {
      if (!tokEl) return;
      const _hasRealToken = !!(profile && (profile.qb_token_set || String(profile.qb_token || '').trim()));
      if (_hasRealToken) {
        // Show masked dots so user clearly sees a token is stored
        tokEl.value = _QB_TOKEN_SAVED_SENTINEL;
        tokEl.placeholder = '';
        tokEl.setAttribute('data-token-masked', '1');
        // On focus: clear so user can type a new token
        if (!tokEl._maskFocusBound) {
          tokEl._maskFocusBound = true;
          tokEl.addEventListener('focus', function _clearOnFocus() {
            if (tokEl.value === _QB_TOKEN_SAVED_SENTINEL) {
              tokEl.value = '';
              tokEl.removeAttribute('data-token-masked');
            }
          });
          tokEl.addEventListener('blur', function _restoreOnBlur() {
            if (tokEl.value === '') {
              const _stillHasToken = !!(profile && (profile.qb_token_set || String(profile.qb_token || '').trim()));
              if (_stillHasToken) {
                tokEl.value = _QB_TOKEN_SAVED_SENTINEL;
                tokEl.setAttribute('data-token-masked', '1');
              }
            }
          });
        }
      } else {
        tokEl.value = '';
        tokEl.placeholder = 'Enter your personal QB User Token';
        tokEl.removeAttribute('data-token-masked');
      }
    }

    function syncBypassInputsFromState() {
      const tabId = getActiveTabId();
      const s = createDefaultSettings((state.quickbaseSettings.settingsByTabId && state.quickbaseSettings.settingsByTabId[tabId]) || {}, {});
      const rlEl = root.querySelector('#qbBypassReportLink');
      const realmEl = root.querySelector('#qbBypassRealm');
      const tableEl = root.querySelector('#qbBypassTableId');
      const qidEl = root.querySelector('#qbBypassQid');
      if (rlEl) rlEl.value = s.reportLink || '';
      if (realmEl) realmEl.value = s.realm || '';
      if (tableEl) tableEl.value = s.tableId || '';
      if (qidEl) qidEl.value = s.qid || '';
      // TOKEN MASK FIX: Show masked dots (password field filled) when token is saved in DB.
      // Empty field = confusing to users ("did my token save?"). Filled dots = clear confirmation.
      // The sentinel value is stripped before any save — never reaches the server.
      _applyTokenSavedUI(root.querySelector('#qbBypassToken'));
    }

    // Wire bypass toggle
    const bypassToggle = root.querySelector('#qbBypassToggle');
    if (bypassToggle) {
      bypassToggle.addEventListener('change', () => {
        const tabId = getActiveTabId();
        const isBypassed = bypassToggle.checked;
        // Update state for this tab only
        const prev = createDefaultSettings((state.quickbaseSettings.settingsByTabId && state.quickbaseSettings.settingsByTabId[tabId]) || {}, {});
        const next = Object.assign({}, prev, { bypassGlobal: isBypassed });
        state.quickbaseSettings.settingsByTabId = Object.assign({}, state.quickbaseSettings.settingsByTabId || {}, { [tabId]: next });
        applyBypassUIState(isBypassed);
        syncBypassInputsFromState();
        queuePersistQuickbaseSettings();
      });
    }

    // Wire bypass Report Link auto-extract
    const bypassRLInput = root.querySelector('#qbBypassReportLink');
    if (bypassRLInput) {
      bypassRLInput.addEventListener('input', () => {
        const tabId = getActiveTabId();
        const link = bypassRLInput.value.trim();
        const parsed = parseQuickbaseLink(link);
        const realmEl = root.querySelector('#qbBypassRealm');
        const tableEl = root.querySelector('#qbBypassTableId');
        const qidEl = root.querySelector('#qbBypassQid');
        if (realmEl) realmEl.value = parsed.realm || '';
        if (tableEl) tableEl.value = parsed.tableId || '';
        if (qidEl) qidEl.value = parsed.qid || '';
        // Update tab settings with parsed values
        const prev = createDefaultSettings((state.quickbaseSettings.settingsByTabId && state.quickbaseSettings.settingsByTabId[tabId]) || {}, {});
        const next = Object.assign({}, prev, {
          bypassGlobal: true,
          reportLink: link,
          realm: parsed.realm || prev.realm,
          tableId: parsed.tableId || prev.tableId,
          qid: parsed.qid || prev.qid
        });
        state.quickbaseSettings.settingsByTabId = Object.assign({}, state.quickbaseSettings.settingsByTabId || {}, { [tabId]: next });
      });
    }

    // ── FORCE REFRESH "ACTIVE" BUTTON — wired once ──────────────────────────
    // Manual force-fetch from Quickbase. Bypasses the 300s auto-refresh.
    // Use case: user needs latest data immediately without waiting for next cycle.
    // Behavior:
    //   1. Kills any in-flight request (same as cache badge)
    //   2. Clears ALL tab caches (not just active tab)
    //   3. Triggers live fetch: forceRefresh:true + applyFilters:true
    //   4. Button shows spinning animation + "Fetching…" label while loading
    //   5. Reverts to "Active" with pulse animation on success
    const _forceRefreshBtn = root.querySelector('#qbForceRefreshBtn');
    const _forceRefreshIcon = root.querySelector('#qbForceRefreshIcon');
    const _forceRefreshLabel = root.querySelector('#qbForceRefreshLabel');
    let _forceRefreshCooldown = false;

    if (_forceRefreshBtn) {
      _forceRefreshBtn.addEventListener('click', async () => {
        if (_forceRefreshCooldown) return;
        _forceRefreshCooldown = true;

        // Visual: spinning state
        _forceRefreshBtn.classList.add('qb-force-fetching');
        if (_forceRefreshIcon) _forceRefreshIcon.classList.add('qb-spin');
        if (_forceRefreshLabel) _forceRefreshLabel.textContent = 'Fetching…';
        _forceRefreshBtn.disabled = true;

        try {
          // Kill inflight + clear ALL caches across all tabs
          quickbaseLoadInFlight = null;
          if (state.qbCache) { Object.keys(state.qbCache).forEach(k => { delete state.qbCache[k]; }); }
          if (state._tabDataCache) { Object.keys(state._tabDataCache).forEach(k => { delete state._tabDataCache[k]; }); }

          await loadQuickbaseData({ forceRefresh: true, applyFilters: true, silent: false });

          // Visual: success pulse
          _forceRefreshBtn.classList.remove('qb-force-fetching');
          _forceRefreshBtn.classList.add('qb-force-success');
          if (_forceRefreshIcon) _forceRefreshIcon.classList.remove('qb-spin');
          if (_forceRefreshLabel) _forceRefreshLabel.textContent = 'Active';
          setTimeout(() => { _forceRefreshBtn.classList.remove('qb-force-success'); }, 1500);
        } catch (_) {
          _forceRefreshBtn.classList.remove('qb-force-fetching');
          if (_forceRefreshIcon) _forceRefreshIcon.classList.remove('qb-spin');
          if (_forceRefreshLabel) _forceRefreshLabel.textContent = 'Active';
        } finally {
          _forceRefreshBtn.disabled = false;
          // 10s cooldown — prevent spam clicking
          setTimeout(() => { _forceRefreshCooldown = false; }, 10000);
        }
      });
    }

    // ── CACHE BADGE CLICK — wired once, permanent. ─────────────────────────
    // Cannot use onclick set inside updateDataFreshnessBadge because the
    // quickbaseLoadInFlight guard silently blocks re-entry. Fix: kill the
    // inflight reference first, then call forceRefresh.
    const _cacheBadgeBtn = root.querySelector('#qbCacheBadge');
    if (_cacheBadgeBtn) {
      _cacheBadgeBtn.addEventListener('click', () => {
        // Kill any in-flight promise so the guard doesn't block us
        quickbaseLoadInFlight = null;
        // Clear all QB cache entries for the active tab
        const _tabId = getActiveTabId();
        if (state.qbCache) {
          Object.keys(state.qbCache).forEach(k => { delete state.qbCache[k]; });
        }
        if (state._tabDataCache && _tabId) {
          delete state._tabDataCache[_tabId];
        }
        loadQuickbaseData({ forceRefresh: true, silent: false });
      });
    }
    root.querySelector('#qbSettingsModal').addEventListener('click', (event) => {
      const target = event.target;
      if (!target || !(target instanceof HTMLElement)) return;
      const tabBtn = target.closest('[data-qb-settings-tab]');
      if (!tabBtn) return;
      const nextView = String(tabBtn.getAttribute('data-qb-settings-tab') || '').trim();
      if (!nextView) return;
      setSettingsModalView(nextView);
    });
    root.querySelector('#qbTabBar').oncontextmenu = async (event) => {
      const target = event.target;
      if (!target || !(target instanceof HTMLElement)) return;
      const tabBtn = target.closest('[data-tab-idx]');
      if (!tabBtn) return;
      event.preventDefault();
      const idx = Number(tabBtn.getAttribute('data-tab-idx'));
      if (!Number.isFinite(idx)) return;
      const tabs = Array.isArray(state.quickbaseSettings && state.quickbaseSettings.tabs) ? state.quickbaseSettings.tabs : [];
      const tab = tabs[idx] || {};
      const label = String(tab.tabName || `Report ${idx + 1}`);
      const confirmed = window.confirm(`Delete tab "${label}"? This cannot be undone.`);
      if (!confirmed) return;
      await deleteTabAtIndex(idx);
    };

    root.querySelector('#qbTabBar').onclick = async (event) => {
      const target = event.target;
      if (!target || !(target instanceof HTMLElement)) return;
      if (target.id === 'qbAddTabBtn') {
        // Only capture modal inputs when modal is actually open
        const isModalOpenForAdd = (() => {
          const modal = root.querySelector('#qbSettingsModal');
          if (!modal) return false;
          const display = modal.style.display;
          return display === 'flex' || display === 'block';
        })();
        if (isModalOpenForAdd) captureSettingsDraftFromInputs();
        // Reset inflight before new tab load
        quickbaseLoadInFlight = null;
        const managedTabId = tabManager ? tabManager.createTab({ tabName: 'New Report' }) : '';
        // ISOLATION: always create a fresh empty settings object — never inherit from any other tab
        const newTabId = managedTabId || generateUUID();
        const newTab = {
          id: newTabId,
          tabName: 'New Report',
          reportLink: '',
          qid: '',
          tableId: '',
          realm: '',
          dashboard_counters: [],
          customColumns: [],
          customFilters: [],
          filterMatch: 'ALL'
        };
        // ISOLATION: new tab settings are a standalone empty object — deepClone to prevent reference sharing
        const newTabSettings = deepClone(createDefaultSettings({}, {}));
        state.quickbaseSettings.tabs.push(deepClone(newTab));
        state.quickbaseSettings.settingsByTabId = Object.assign({}, state.quickbaseSettings.settingsByTabId || {}, {
          [newTabId]: newTabSettings
        });
        state.activeTabIndex = state.quickbaseSettings.tabs.length - 1;
        if (tabManager) {
          tabManager.clearNewTabFields();
          syncTabManagerFromState(newTabId);
        }
        state.modalDraft = deepClone(Object.assign({}, newTab, state.quickbaseSettings.settingsByTabId[newTabId])) || buildDefaultTab();
        syncStateFromActiveTab();
        syncSettingsInputsFromState();
        queuePersistQuickbaseSettings();
        renderTabBar();
        renderColumnGrid();
        renderFilters();
        renderCounterFilters();
        try {
          await persistQuickbaseSettings();
          await loadQuickbaseData({ applyFilters: true });
          if (window.UI && UI.toast) UI.toast('New tab added and synced.');
        } catch (err) {
          if (window.UI && UI.toast) UI.toast('Failed to add tab: ' + String(err && err.message || err), 'error');
        }
        return;
      }
      const idx = Number(target.getAttribute('data-tab-idx'));
      if (!Number.isFinite(idx) || idx === state.activeTabIndex) return;

      // FIX[TabSwitch-1]: Only capture modal inputs when the modal is actually OPEN.
      // Calling captureSettingsDraftFromInputs() when modal is closed reads stale DOM
      // values and overwrites the current tab's settings with garbage.
      const isModalOpen = (() => {
        const modal = root.querySelector('#qbSettingsModal');
        if (!modal) return false;
        const display = modal.style.display;
        return display === 'flex' || display === 'block';
      })();
      if (isModalOpen) captureSettingsDraftFromInputs();

      // FIX[TabSwitch-2]: Cancel any inflight request for the previous tab.
      // If we don't reset this, loadQuickbaseData returns the old promise which
      // renders the WRONG tab's data, leaving the new tab stuck on "Loading...".
      quickbaseLoadInFlight = null;
      // Clear tab data ownership so applySearchAndRender doesn't block the new tab's load
      state._loadedForTabId = null;

      // ISOLATION: clear stale data from previous tab before switching
      state.allAvailableFields = [];
      state.baseRecords = [];
      state.rawPayload = { columns: [], records: [] };
      state.currentPayload = { columns: [], records: [] };
      state.currentPage = 1;
      state.activeCounterIndex = -1;

      renderEmptyState(root, 'Loading records for selected tab...');
      renderDashboardCounters(root, [], { dashboard_counters: [] }, state);

      // Switch to the new tab index
      state.activeTabIndex = idx;
      state.quickbaseSettings.activeTabIndex = idx;

      // FIX[TabSwitch-3]: syncStateFromActiveTab() reads directly from
      // state.quickbaseSettings.settingsByTabId which is the authoritative source.
      // Do NOT override state with tabManager.getTab() after this — TabManager is
      // a secondary cache and may return empty defaults if the tab was not seeded.
      syncStateFromActiveTab();

      // ── FIX BUG 2: Render dashboard counters immediately after sync ──────
      // Counters are stored in state.dashboardCounters after syncStateFromActiveTab().
      // We render them right away so they appear even before records finish loading.
      // Pass baseRecords from cache (may be empty if no cache — that's OK, count = 0).
      renderDashboardCounters(root, state.baseRecords, { dashboard_counters: state.dashboardCounters }, state, (idx) => {
        state.activeCounterIndex = state.activeCounterIndex === idx ? -1 : idx;
        state.currentPage = 1;
        applySearchAndRender();
      });

      // SMART LOADING: if fresh cache exists for this tab, render immediately
      // without showing a loading spinner. Only show loading if no cache.
      const switchTabId = getActiveTabId();
      const switchTabSettings = state.quickbaseSettings.settingsByTabId && state.quickbaseSettings.settingsByTabId[switchTabId]
        ? createDefaultSettings(state.quickbaseSettings.settingsByTabId[switchTabId], {})
        : createDefaultSettings({}, {});
      const switchParsed = parseQuickbaseLink(String(switchTabSettings.reportLink || ''));
      const switchCacheKey = getQuickbaseCacheKey({
        tabId: switchTabId,
        tableId: String(switchTabSettings.tableId || switchParsed.tableId || '').trim(),
        qid: String(switchTabSettings.qid || switchParsed.qid || '').trim(),
        filters: normalizeFilters(switchTabSettings.customFilters || []),
        filterMatch: normalizeFilterMatch(switchTabSettings.filterMatch || 'ALL')
      });
      const switchCacheHit = readQuickbaseCache(switchCacheKey, switchTabId);
      if (!switchCacheHit) {
        // No cache — show loading placeholder
        renderEmptyState(root, 'Loading records for selected tab…');
        renderDashboardCounters(root, [], { dashboard_counters: [] }, state);
      }
      // If cache hit — leave the previous content visible during load (smooth transition)

      const newActiveTabId = getActiveTabId();
      state.settingsEditingTabId = newActiveTabId;
      state.modalDraft = deepClone(getActiveTab()) || buildDefaultTab();

      syncSettingsInputsFromState();
      queuePersistQuickbaseSettings();
      renderTabBar();
      renderColumnGrid();
      renderFilters();
      renderCounterFilters();
      await loadQuickbaseData({ applyFilters: true });
    };
    root.querySelector('#qbAddFilterBtn').onclick = () => {
      state.customFilters.push({ fieldId: '', operator: 'EX', value: '' });
      syncActiveTabFromState();
      queuePersistQuickbaseSettings();
      renderFilters();
    };
    root.querySelector('#qbAddCounterBtn').onclick = () => {
      state.dashboardCounters.push({ fieldId: '', operator: 'EX', value: '', label: '', color: 'default' });
      syncActiveTabFromState();
      queuePersistQuickbaseSettings();
      renderCounterFilters();
    };


    const headerSearch = root.querySelector('#qbHeaderSearch');
    if (headerSearch) {
      headerSearch.value = getActiveSearchTerm();
      state.searchTerm = getActiveSearchTerm();
      headerSearch.oninput = () => {
        const nextValue = String(headerSearch.value || '').trim();
        setActiveSearchTerm(nextValue);
        setActiveUserSearched(nextValue.length > 0);
        state.searchTerm = nextValue;
        state.hasUserSearched = nextValue.length > 0;
        if (state.searchDebounceTimer) clearTimeout(state.searchDebounceTimer);
        state.searchDebounceTimer = setTimeout(() => {
          applySearchAndRender();
        }, 500);
      };
    }

    const exportBtn = root.querySelector('#qbExportCsvBtn');
    if (exportBtn) {
      exportBtn.onclick = () => {
        const rows = state.currentPayload && Array.isArray(state.currentPayload.records) ? state.currentPayload.records : [];
        const columns = state.currentPayload && Array.isArray(state.currentPayload.columns) ? state.currentPayload.columns : [];
        const csv = rowsToCsv(rows, columns);
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'my_quickbase_export.csv';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      };
    }

    const saveBtn = root.querySelector('#qbSaveSettingsBtn');
    const saveLock = root.querySelector('#qbSettingsSavingLock');
    saveBtn.onclick = async () => {
      if (!me) return;
      const tabSnapshot = scrapeModalTabSnapshot();
      const activeIdx = Number(state.activeTabIndex || 0);
      const saveTabId = String(getActiveTabId() || '').trim();

      // ── BYPASS: Read bypass toggle + personal config inputs ─────────────
      const bypassToggleEl = root.querySelector('#qbBypassToggle');
      const isBypass = !!(bypassToggleEl && bypassToggleEl.checked);
      const bypassRL   = String((root.querySelector('#qbBypassReportLink') || {}).value || '').trim();
      const bypassTokEl = root.querySelector('#qbBypassToken');
      // SENTINEL STRIP: If value is the masked-dots sentinel, treat as empty (no new token entered).
      // The sentinel is only a visual indicator — it must NEVER be sent to the server.
      const _rawTokVal = String((bypassTokEl && bypassTokEl.value) || '').trim();
      const bypassTok  = (_rawTokVal === _QB_TOKEN_SAVED_SENTINEL) ? '' : _rawTokVal;

      // If bypass ON, merge personal report config into snapshot
      if (isBypass && bypassRL) {
        const parsedBypass = parseQuickbaseLink(bypassRL);
        tabSnapshot.reportLink = bypassRL;
        tabSnapshot.realm      = parsedBypass.realm || tabSnapshot.realm;
        tabSnapshot.tableId    = parsedBypass.tableId || tabSnapshot.tableId;
        tabSnapshot.qid        = parsedBypass.qid || tabSnapshot.qid;
      }
      // Always carry bypassGlobal flag in the tab snapshot
      tabSnapshot.bypassGlobal = isBypass;

      if (Array.isArray(state.quickbaseSettings.tabs) && state.quickbaseSettings.tabs[activeIdx]) {
        state.quickbaseSettings.tabs[activeIdx] = deepClone({
          ...state.quickbaseSettings.tabs[activeIdx],
          ...tabSnapshot
        });
      }
      const activeTabId = saveTabId;
      if (activeTabId) {
        state.quickbaseSettings.settingsByTabId = state.quickbaseSettings.settingsByTabId || {};
        const prevTabSettings = createDefaultSettings(state.quickbaseSettings.settingsByTabId[activeTabId] || {}, {});
        const _newBypassRL = (isBypass && bypassRL) ? bypassRL : (tabSnapshot.reportLink || prevTabSettings.reportLink || '');
        const _newParsed   = parseQuickbaseLink(_newBypassRL);
        state.quickbaseSettings.settingsByTabId[activeTabId] = createDefaultSettings({
          ...prevTabSettings,
          ...tabSnapshot,
          bypassGlobal: isBypass,
          // When bypass, persist the bypass reportLink into the tab's own settings
          reportLink: isBypass ? _newBypassRL : (tabSnapshot.reportLink || prevTabSettings.reportLink || ''),
          qid:        isBypass ? (_newParsed.qid || prevTabSettings.qid || '') : (tabSnapshot.qid || prevTabSettings.qid || ''),
          tableId:    isBypass ? (_newParsed.tableId || prevTabSettings.tableId || '') : (tabSnapshot.tableId || prevTabSettings.tableId || ''),
          realm:      isBypass ? (_newParsed.realm || prevTabSettings.realm || '') : (tabSnapshot.realm || prevTabSettings.realm || ''),
          customColumns: deepClone(state.customColumns || prevTabSettings.customColumns || []),
          customFilters: deepClone(state.customFilters || prevTabSettings.customFilters || []),
          filterMatch: state.filterMatch || prevTabSettings.filterMatch || 'ALL',
          dashboard_counters: deepClone(state.dashboardCounters || prevTabSettings.dashboard_counters || [])
        }, {});
      }
      state.tabName = tabSnapshot.tabName;
      // Bypass tab: keep its own reportLink/qid/tableId/realm isolated from global state
      if (tabSnapshot.bypassGlobal) {
        // Only update per-tab settings, don't stomp global state.reportLink
        const _btid = String(getActiveTabId() || '').trim();
        if (_btid) {
          state.quickbaseSettings.settingsByTabId = state.quickbaseSettings.settingsByTabId || {};
          state.quickbaseSettings.settingsByTabId[_btid] = Object.assign(
            {},
            state.quickbaseSettings.settingsByTabId[_btid] || {},
            {
              bypassGlobal: true,
              reportLink: tabSnapshot.reportLink,
              qid: tabSnapshot.qid,
              tableId: tabSnapshot.tableId,
              realm: tabSnapshot.realm
            }
          );
        }
      } else {
        state.reportLink = tabSnapshot.reportLink;
        state.qid = tabSnapshot.qid;
        state.tableId = tabSnapshot.tableId;
        state.realm = tabSnapshot.realm;
      }
      state.dashboardCounters = normalizeDashboardCounters(tabSnapshot.dashboard_counters);
      syncActiveTabFromState();

      // Read bypass state once — used in validation AND pendingTabSettings below
      const _bypassToggleAtSave = root.querySelector('#qbBypassToggle');
      const _isBypassAtSave = !!(_bypassToggleAtSave && _bypassToggleAtSave.checked);
      const _bypassRLAtSave = String((root.querySelector('#qbBypassReportLink') || {}).value || '').trim();

      state.isSaving = true;
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
      if (saveLock) saveLock.style.display = 'flex';
      try {
        // Bypass tab: validate against personal reportLink, not global
        const _validationTab = _isBypassAtSave
          ? Object.assign({}, getActiveTab(), { reportLink: _bypassRLAtSave, bypassGlobal: true })
          : getActiveTab();
        const validation = validateQuickbaseTabSettings(_validationTab);
        if (!validation.ok) throw new Error(validation.message);
        const nextActiveTabId = String(getActiveTabId() || '').trim();
        const targetTabId = String(state.settingsEditingTabId || nextActiveTabId || '').trim();
        const pendingTabSettings = {
          tabName: deepClone(state.tabName) || '',
          // When bypass ON: use the bypass reportLink from the Report Config input
          reportLink: _isBypassAtSave
            ? (_bypassRLAtSave || deepClone(state.reportLink) || '')
            : (deepClone(state.reportLink) || ''),
          qid: deepClone(state.qid) || '',
          tableId: deepClone(state.tableId) || '',
          realm: deepClone(state.realm) || '',
          bypassGlobal: _isBypassAtSave,
          customColumns: deepClone(state.customColumns || []),
          customFilters: deepClone(state.customFilters || []),
          filterMatch: state.filterMatch || 'ALL',
          dashboard_counters: deepClone(state.dashboardCounters || [])
        };
        // Sync parsed fields from bypass reportLink
        if (_isBypassAtSave && _bypassRLAtSave) {
          const _p = parseQuickbaseLink(_bypassRLAtSave);
          if (_p.qid) pendingTabSettings.qid = _p.qid;
          if (_p.tableId) pendingTabSettings.tableId = _p.tableId;
          if (_p.realm) pendingTabSettings.realm = _p.realm;
        }
        const tabIndex = state.quickbaseSettings.tabs.findIndex((t) => String(t && t.id || '').trim() === targetTabId);
        if (tabIndex !== -1) {
          state.quickbaseSettings.tabs[tabIndex] = deepClone({
            ...state.quickbaseSettings.tabs[tabIndex],
            tabName: pendingTabSettings.tabName,
            reportLink: pendingTabSettings.reportLink,
            qid: pendingTabSettings.qid,
            tableId: pendingTabSettings.tableId,
            realm: pendingTabSettings.realm,
            bypassGlobal: pendingTabSettings.bypassGlobal,
            customColumns: deepClone(pendingTabSettings.customColumns || []),
            customFilters: deepClone(pendingTabSettings.customFilters || []),
            filterMatch: pendingTabSettings.filterMatch || 'ALL',
            dashboard_counters: deepClone(pendingTabSettings.dashboard_counters || []),
            id: targetTabId
          });
        }
        if (tabManager && targetTabId) {
          const currentManagedTab = tabManager.getTab(targetTabId);
          const currentManagedSettings = currentManagedTab && currentManagedTab.settings ? currentManagedTab.settings : {};
          const managedSettings = {
            ...currentManagedSettings,
            ...pendingTabSettings,
            tabName: String(pendingTabSettings.tabName || 'Main Report').trim() || 'Main Report',
            reportLink: String(pendingTabSettings.reportLink || '').trim(),
            baseReportQid: String(pendingTabSettings.qid || '').trim(),
            qid: String(pendingTabSettings.qid || '').trim(),
            tableId: String(pendingTabSettings.tableId || '').trim(),
            realm: String(pendingTabSettings.realm || '').trim(),
            bypassGlobal: !!pendingTabSettings.bypassGlobal,
            customColumns: deepClone(pendingTabSettings.customColumns || []),
            customFilters: deepClone(pendingTabSettings.customFilters || []),
            filterMatch: pendingTabSettings.filterMatch || 'ALL',
            dashboard_counters: deepClone(pendingTabSettings.dashboard_counters || [])
          };
          tabManager.updateTabLocal(targetTabId, managedSettings);
          await tabManager.saveTab(targetTabId);
        }
        // ── BYPASS TOKEN SAVE: store personal QB token in profile if changed ──
        // Token is stored in profile.qb_token (server-side, service-role).
        // Only saved when bypass is ON and user entered a new token.
        if (isBypass && bypassTok && bypassTok.length > 0) {
          try {
            const tok = window.CloudAuth && typeof CloudAuth.accessToken === 'function' ? CloudAuth.accessToken() : '';
            const tokRes = await fetch('/api/users/update_me', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
              body: JSON.stringify({ qb_token: bypassTok })
            });
            const tokData = await tokRes.json().catch(() => ({}));
            if (tokRes.ok && tokData.ok) {
              // TOKEN FIX: Update local profile cache so syncBypassInputsFromState reads
              // the correct state on next open — set qb_token_set:true (never store actual value).
              profile = Object.assign({}, profile, { qb_token_set: true });
              if (window.Store && typeof Store.setProfile === 'function' && me) {
                Store.setProfile(me.id, Object.assign({}, profile, { qb_token_set: true, updatedAt: Date.now() }));
              }
              // Restore masked-dots visual so user sees the token is saved
              if (bypassTokEl) _applyTokenSavedUI(bypassTokEl);
              console.log('[Bypass] QB token saved to profile');
            } else {
              console.warn('[Bypass] QB token save failed:', tokData);
              if (window.UI && UI.toast) UI.toast('⚠️ Settings saved but QB token failed to save. Please re-enter it.', 'error');
            }
          } catch(tokErr) {
            console.error('[Bypass] QB token save error:', tokErr);
          }
        }

        await persistQuickbaseSettings();
        await refreshAvailableFieldsForActiveTab(targetTabId || getActiveTabId());
        const savedSettings = tabManager && targetTabId && typeof tabManager.getTab === 'function'
          ? ((tabManager.getTab(targetTabId) || {}).settings || {})
          : {};
        const newReportLink = String(savedSettings.reportLink || '').trim();
        if (newReportLink && typeof populateFieldDropdowns === 'function') {
          populateFieldDropdowns(savedSettings.realm, savedSettings.tableId, savedSettings.qid);
        }
        renderTabBar();
        if (window.UI && UI.toast) UI.toast('Quickbase settings saved successfully!');
        closeSettings();
        // FIX[Bug1]: Render counters immediately with current cached records so they
        // appear INSTANTLY after save — no page refresh needed.
        const _savedCounters = deepClone(state.dashboardCounters || []);
        if (_savedCounters.length) {
          renderDashboardCounters(root, state.baseRecords, { dashboard_counters: _savedCounters }, state, (idx) => {
            state.activeCounterIndex = state.activeCounterIndex === idx ? -1 : idx;
            state.currentPage = 1;
            applySearchAndRender();
          });
        }
        await loadQuickbaseData({ forceRefresh: true });
      } catch (err) {
        if (window.UI && UI.toast) UI.toast('Failed to save settings: ' + String(err && err.message || err), 'error');
      } finally {
        state.isSaving = false;
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Settings';
        if (saveLock) saveLock.style.display = 'none';
      }
    };

    const searchInput = document.querySelector('#quickbase-search')?.value || root.querySelector('#qbHeaderSearch')?.value || '';
    syncStateFromActiveTab();
    renderTabBar();
    if (shouldApplyInitialFilters(searchInput)) {
      setActiveSearchTerm(String(searchInput).trim());
      setActiveUserSearched(true);
      state.searchTerm = String(searchInput).trim();
      state.hasUserSearched = true;
      await loadQuickbaseData({ applyFilters: true });
    } else {
      await renderDefaultReport();
    }
    setupAutoRefresh();

    // ── FULLSCREEN TOGGLE + DYNAMIC SHELL HEIGHT ──────────────────────
    const fsBtn = root.querySelector('#qbFullscreenBtn');
    const fsExpand = root.querySelector('#qbFsIconExpand');
    const fsCollapse = root.querySelector('#qbFsIconCollapse');
    const qbShell = root.querySelector('#qbPageShell');

    // ── RESIZEOBSERVER: Dynamically fit shell height to container ──────
    // Sets shell.style.height = root.offsetHeight so the QB page always fills
    // its grid cell exactly — regardless of topbar, theme, or density changes.
    // More robust than calc(100vh - Npx) which can't know the real available
    // height at runtime. Skipped when fullscreen is active (CSS uses 100vh).
    let _qbShellResizeObs = null;
    function _fitQbShellHeight() {
      if (!qbShell || qbShell.classList.contains('qb-is-fullscreen')) return;
      const h = root.offsetHeight;
      if (h > 0) qbShell.style.height = h + 'px';
    }
    if (window.ResizeObserver) {
      _qbShellResizeObs = new ResizeObserver(_fitQbShellHeight);
      _qbShellResizeObs.observe(root);
    }
    // Initial fit — defer one frame so layout has settled after page render
    requestAnimationFrame(_fitQbShellHeight);

    if (fsBtn && qbShell) {
      // CSS-only in-browser fullscreen: position:fixed inset:0 z-index:100000
      //
      // ROOT CAUSE FIX (aurora_midnight theme):
      //   aurora_midnight adds `position: relative` to .main.card.
      //   My previous fix set overflow:clip on .main.card.pad.page-qb.
      //   In Chrome 108+ / Safari 16+, position:relative + overflow:clip/hidden
      //   creates a clipping context that TRAPS position:fixed descendants.
      //   → The fullscreen shell was being clipped inside #main.
      //
      // SOLUTION: On fullscreen enter, set root.style.overflow = 'visible'
      //   so the fixed-position shell is no longer clipped by its parent.
      //   Restore on exit. The ResizeObserver handles re-fitting the height.
      let _qbIsFs = false;

      function _applyQbFs(enable) {
        _qbIsFs = enable;
        qbShell.classList.toggle('qb-is-fullscreen', enable);
        if (enable) {
          // Clear JS-set inline height so CSS height:100vh !important takes over
          qbShell.style.height = '';
          // Unlock parent overflow so fixed child escapes the clipping context
          root.style.overflow = 'visible';
        } else {
          // Restore overflow:clip (NOT '' — empty would fall back to CSS which
          // might re-apply overflow:hidden from other rules and trap fixed children)
          root.style.overflow = 'clip';
          // Re-measure shell height for normal mode
          requestAnimationFrame(_fitQbShellHeight);
        }
        if (fsExpand)   fsExpand.style.display   = enable ? 'none' : '';
        if (fsCollapse) fsCollapse.style.display  = enable ? '' : 'none';
        // Lock/unlock body scroll when in fullscreen
        try { document.body.style.overflow = enable ? 'hidden' : ''; } catch (_) {}
      }

      fsBtn.onclick = () => _applyQbFs(!_qbIsFs);

      // Escape key closes fullscreen (mimics native fullscreen UX)
      const _qbEscHandler = (e) => {
        if (e.key === 'Escape' && _qbIsFs) _applyQbFs(false);
      };
      document.addEventListener('keydown', _qbEscHandler);

      // Cleanup on page navigation away
      const prevCleanupFs = root._cleanup;
      root._cleanup = () => {
        try { if (prevCleanupFs) prevCleanupFs(); } catch (_) {}
        try { if (_qbShellResizeObs) _qbShellResizeObs.disconnect(); } catch (_) {}
        document.removeEventListener('keydown', _qbEscHandler);
        // Restore body scroll + ALL parent inline styles if navigating away
        try { document.body.style.overflow = ''; } catch (_) {}
        try { root.style.overflow = ''; } catch (_) {}
        try { root.style.padding  = ''; } catch (_) {}
      };
    }

    // ── FRESH / CACHED BADGE UPDATER ───────────────────────────────────
    function updateDataFreshnessBadge(fromCache) {
      const freshBadge = root.querySelector('#qbFreshBadge');
      const cacheBadge = root.querySelector('#qbCacheBadge');
      if (!freshBadge || !cacheBadge) return;
      if (fromCache) {
        freshBadge.style.display = 'none';
        cacheBadge.style.display = '';
        // Click handler is wired ONCE at init time (after root.innerHTML).
        // No onclick re-assignment here — avoids the quickbaseLoadInFlight block.
      } else {
        freshBadge.style.display = '';
        cacheBadge.style.display = 'none';
      }
    }
  };
})();
