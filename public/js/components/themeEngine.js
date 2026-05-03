/**
 * @file themeEngine.js
 * @description Component: theme engine — applies CSS variable theme presets from Config.THEMES
 * @module MUMS/Components
 * @version UAT
 */
/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */


// Theme Engine Controller
// Enterprise-grade theme management with strict token-based theme isolation.
(function(){
  'use strict';

  const THEME_STORAGE_KEY   = 'mums_theme_preference';
  const BRIGHTNESS_STORAGE  = 'mums_brightness_v1';
  const DEFAULT_THEME_ID    = 'apex';
  const THEME_ALIAS = {
    aurora_midnight: 'mums_dark',
    mono: 'classic_style'
  };

  const ThemeEngine = {
    currentTheme:      null,
    globalDefault:     null,
    globalBrightness:  130,
    globalContrast:    100,
    globalScale:       100,
    globalSidebar:     100,
    forcedTheme:       false,
    forcedBrightness:  false,
    userRole:          null,

    async init(){
      try {
        const user = (window.Auth && Auth.getUser) ? Auth.getUser() : {};
        const rawRole = String(user?.role || '').trim().toUpperCase();
        this.userRole = rawRole.replace(/\s+/g, '_');

        // Load global appearance defaults for all users.
        // Forced flags are intended to be enforced tenant-wide.
        await this.loadGlobalDefault();

        this.currentTheme = this.getUserTheme();

        // Apply forced theme override from Super Admin
        if (this.forcedTheme) {
          const forced = this.normalizeThemeId(this.globalDefault);
          if (forced && this.isValidTheme(forced)) {
            localStorage.setItem(THEME_STORAGE_KEY, forced);
            this.currentTheme = forced;
          }
        }

        // Apply forced brightness/contrast/scale/sidebar override from Super Admin
        if (this.forcedBrightness) {
          this._applyForcedAppearance();
        }

        this.applyTheme(this.currentTheme, { persist: false });
        this.renderThemeGrid();
        this.setupEventListeners();
      } catch(err){
        console.error('[ThemeEngine] Init error:', err);
      }
    },

    _applyForcedAppearance(){
      try {
        const app = document.getElementById('app') || document.body;
        const filters = [];
        if (typeof this.globalBrightness === 'number' && this.globalBrightness !== 100) {
          filters.push(`brightness(${this.globalBrightness / 100})`);
        }
        if (typeof this.globalContrast === 'number' && this.globalContrast !== 100) {
          filters.push(`contrast(${this.globalContrast / 100})`);
        }
        app.style.filter = filters.length ? filters.join(' ') : '';
        document.documentElement.style.setProperty('--mums-brightness', (this.globalBrightness || 100) / 100);
        document.documentElement.style.setProperty('--mums-contrast',   (this.globalContrast  || 100) / 100);

        if (typeof this.globalScale === 'number') {
          document.documentElement.style.fontSize = `${this.globalScale}%`;
        }
        if (typeof this.globalSidebar === 'number') {
          document.documentElement.style.setProperty('--sidebar-opacity', this.globalSidebar / 100);
        }

        // Persist so page refreshes keep the forced values
        localStorage.setItem(BRIGHTNESS_STORAGE, JSON.stringify({
          value: this.globalBrightness, contrast: this.globalContrast,
          scale: this.globalScale, sidebarOpacity: this.globalSidebar,
          useDefault: false, forced: true
        }));
      } catch(_) {}
    },

    async loadGlobalDefault(){
      try {
        const token = window.CloudAuth?.getAccessToken?.() || window.CloudAuth?.accessToken?.();
        if (!token) return;

        const res = await fetch('/api/settings/global-theme', {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });

        if (res.ok) {
          const data = await res.json();
          this.globalDefault = this.normalizeThemeId(data.defaultTheme || DEFAULT_THEME_ID);
          this.globalBrightness = typeof data.brightness     === 'number' ? data.brightness     : 130;
          this.globalContrast   = typeof data.contrast       === 'number' ? data.contrast       : 100;
          this.globalScale      = typeof data.scale          === 'number' ? data.scale          : 100;
          this.globalSidebar    = typeof data.sidebarOpacity === 'number' ? data.sidebarOpacity : 100;
          this.forcedTheme      = data.forcedTheme      === true;
          this.forcedBrightness = data.forcedBrightness === true;
        }
      } catch(err){
        console.warn('[ThemeEngine] Failed to load global default:', err);
        this.globalDefault = DEFAULT_THEME_ID;
      }
    },

    normalizeThemeId(id){
      const raw = String(id || '').trim();
      if (!raw) return DEFAULT_THEME_ID;
      return THEME_ALIAS[raw] || raw;
    },

    getAvailableThemes(){
      const configThemes = Array.isArray(window.Config?.THEMES) ? window.Config.THEMES : [];
      const normalized = configThemes.map((t) => ({ ...t, id: this.normalizeThemeId(t?.id) }));
      const fallback = [
        { id: 'mums_dark', name: 'MUMS Dark', description: 'Default enterprise dark theme.' },
        { id: 'aurora_light', name: 'Aurora Light', description: 'Clean high-clarity light mode.' },
        { id: 'monday_workspace', name: 'Monday Workspace', description: 'Modern SaaS productivity look.' },
        { id: 'classic_style', name: 'Classic Style', description: 'Timeless admin dashboard style.' },
        { id: 'mums_light', name: 'Mums – Light', description: 'Monday.com-inspired Work OS. Clean white surfaces, vibrant status colors, bold Figtree typography.' }
      ];
      const byId = new Map();
      [...fallback, ...normalized].forEach((t) => {
        const id = this.normalizeThemeId(t?.id);
        if (!id) return;
        byId.set(id, { ...t, id });
      });
      return [...byId.values()];
    },

    isValidTheme(id){
      const normalized = this.normalizeThemeId(id);
      return this.getAvailableThemes().some(t => t.id === normalized);
    },

    getUserTheme(){
      const stored = this.normalizeThemeId(localStorage.getItem(THEME_STORAGE_KEY));
      if (this.isValidTheme(stored)) return stored;

      const globalTheme = this.normalizeThemeId(this.globalDefault);
      if (this.isValidTheme(globalTheme)) return globalTheme;

      return DEFAULT_THEME_ID;
    },

    applyTheme(themeId, opts = {}){
      const normalizedThemeId = this.normalizeThemeId(themeId);
      const theme = this.getAvailableThemes().find(t => t.id === normalizedThemeId);
      if (!theme) {
        console.warn('[ThemeEngine] Theme not found:', themeId);
        return;
      }

      document.body?.setAttribute('data-theme', normalizedThemeId);
      if (theme.mode) document.body?.setAttribute('data-mode', theme.mode);

      if (opts.persist !== false) {
        localStorage.setItem(THEME_STORAGE_KEY, normalizedThemeId);
      }
      this.currentTheme = normalizedThemeId;

      try { window.dispatchEvent(new CustomEvent('mums:theme', { detail: { id: normalizedThemeId } })); } catch(_){ }
    },

    renderThemeGrid(){
      const grid = document.getElementById('themeGrid');
      if (!grid) return;

      grid.classList.remove('theme-grid');
      grid.classList.add('th-grid');

      const themes = this.getAvailableThemes();

      grid.innerHTML = themes.map(theme => {
        const themeId = String(theme?.id || '').trim();
        const themeName = String(theme?.name || 'N/A').trim() || 'N/A';
        const themeDescription = String(theme?.description || 'Enterprise UI System').trim() || 'Enterprise UI System';
        const isActive = this.currentTheme === theme.id;
        const isHidden = Boolean(theme?.hidden || theme?.isHidden);

        return `
          <div class="th-card ${isActive ? 'is-active' : ''} ${isHidden ? 'is-hidden' : ''}" data-id="${themeId}">
            <div class="th-swatch"></div>
            <div class="th-info">
              <div class="th-title">${themeName}</div>
              <div class="th-desc">${themeDescription}</div>
              <div class="th-badges">
                ${isActive ? '<span class="th-badge th-badge-active">Active</span>' : '<span class="th-badge th-badge-default">Inactive</span>'}
              </div>
            </div>
            <button class="th-admin-btn edit-btn">Edit</button>
            <button class="th-admin-btn del del-btn">Del</button>
          </div>
        `;
      }).join('');

      if (this.userRole === 'SUPER_ADMIN') {
        const adminPanel = document.getElementById('themeAdminPanel');
        if (adminPanel) {
          adminPanel.style.display = 'block';
          const select = document.getElementById('globalThemeSelect');
          if (select && this.globalDefault) {
            select.value = this.normalizeThemeId(this.globalDefault);
          }
        }
      }
    },

    setupEventListeners(){
      document.getElementById('themeGrid')?.addEventListener('click', (e) => {
        if (e.target.closest('.th-admin-btn')) return;
        const card = e.target.closest('.th-card');
        if (!card) return;
        this.applyTheme(card.dataset.id);
        this.renderThemeGrid();
      });

      document.getElementById('saveGlobalThemeBtn')?.addEventListener('click', async () => {
        await this.saveGlobalDefault();
      });
    },

    async saveGlobalDefault(){
      const select = document.getElementById('globalThemeSelect');
      const statusEl = document.getElementById('globalThemeStatus');
      const btn = document.getElementById('saveGlobalThemeBtn');
      if (!select || !statusEl || !btn) return;

      const themeId = this.normalizeThemeId(select.value);
      btn.disabled = true;
      btn.textContent = 'Saving...';

      try {
        const token = window.CloudAuth?.getAccessToken?.();
        if (!token) throw new Error('Not authenticated');

        const res = await fetch('/api/settings/global-theme', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ themeId })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to save');

        this.globalDefault = themeId;
        statusEl.textContent = `✓ Global default set to ${themeId}`;
        statusEl.style.display = 'block';
        statusEl.style.color = '#34d399';
        setTimeout(() => { statusEl.style.display = 'none'; }, 3000);
      } catch(err){
        statusEl.textContent = `✗ Error: ${err.message}`;
        statusEl.style.display = 'block';
        statusEl.style.color = '#fb7185';
      } finally {
        btn.disabled = false;
        btn.textContent = 'Save Default';
      }
    }
  };

  window.ThemeEngine = ThemeEngine;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ThemeEngine.init());
  } else {
    ThemeEngine.init();
  }
})();
