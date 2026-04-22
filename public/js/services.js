(function () {
  // AI MAINTENANCE NOTE: If you edit Services modules, update /SERVICES_BLUEPRINT.md in same commit.
  // ─────────────────────────────────────────────────────────────────────────────
  // services.js — Orchestrator
  //
  // BOOT ORDER (critical — must not fire DB calls before session is injected):
  //   1. servicesDB.init()  → reads mums_supabase_session, calls setSession()
  //   2. servicesSheetManager.refresh() → only after init() resolves true
  //   3. Show user chip
  // ─────────────────────────────────────────────────────────────────────────────

  window.servicesApp = {
    async openSheet(sheet) {
      window.servicesSheetManager.setActive(sheet.id);
      await window.servicesGrid.load(sheet);
      setSyncState('synced');
    }
  };
  window.Notify = window.Notify || null;
  window.BackupManager = window.BackupManager || null;

  // ── Sync chip ─────────────────────────────────────────────────────────────────
  const syncChip = document.getElementById('svcSyncIndicator');
  const syncBadge = document.getElementById('syncBadge');
  function setSyncState(state) {
    const chipLabel = syncChip || (syncBadge ? syncBadge.querySelector('span:last-child') : null);
    const chipEl = syncChip || syncBadge;
    if (!chipEl || !chipLabel) return;

    if (state === 'loading') {
      chipLabel.textContent = 'Connecting…';
      chipEl.style.cssText = 'color:#94A3B8;background:rgba(148,163,184,0.1);border-color:rgba(148,163,184,0.3)';
    } else if (state === 'synced') {
      chipLabel.textContent = 'Synced';
      chipEl.style.cssText = 'color:#4ADE80;background:rgba(34,197,94,0.1);border-color:rgba(34,197,94,0.3)';
    } else {
      chipLabel.textContent = 'Auth Error';
      chipEl.style.cssText = 'color:#F87171;background:rgba(248,113,113,0.1);border-color:rgba(248,113,113,0.3)';
    }
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    const editable = document.activeElement?.isContentEditable;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || editable;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n' && !typing) {
      e.preventDefault();
      document.getElementById('svcNewSheetBtn').click();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      const s = document.getElementById('svcSheetSearch');
      if (s) { s.focus(); s.select(); }
    }
  });


  // ── Right sidebar collapse toggle ──────────────────────────────────────────
  (function () {
    var toggleBtn  = document.getElementById('svcRightToggle');
    var rightPanel = document.getElementById('svcRight');
    var mainEl     = document.querySelector('.svc-main');
    if (!toggleBtn || !rightPanel || !mainEl) return;
    if (toggleBtn.dataset.bound === '1') return;
    toggleBtn.dataset.bound = '1';

    var isCollapsed = true;

    // Restore persisted state
    try {
      var stored = localStorage.getItem('svc.rightCollapsed');
      if (stored === '0') isCollapsed = false; // user explicitly expanded before
    } catch (_) {}

    function applyState() {
      if (isCollapsed) {
        rightPanel.classList.add('collapsed');
        mainEl.classList.add('right-collapsed');
        toggleBtn.textContent = '«';
        toggleBtn.title = 'Show sidebar';
      } else {
        rightPanel.classList.remove('collapsed');
        mainEl.classList.remove('right-collapsed');
        toggleBtn.textContent = '»';
        toggleBtn.title = 'Hide sidebar';
      }
      try { localStorage.setItem('svc.rightCollapsed', isCollapsed ? '1' : '0'); } catch (_) {}
    }

    applyState();
    toggleBtn.addEventListener('click', function () {
      isCollapsed = !isCollapsed;
      applyState();
    });
  })();

  // ── Boot sequence ─────────────────────────────────────────────────────────────
  setSyncState('loading');

  (async () => {
    const loader = document.getElementById('svcLoadingScreen');
    const statusEl = document.getElementById('loaderStatus');
    const progressFill = document.getElementById('progressFill');
    const progressCurrent = document.getElementById('progressCurrent');
    const progressTotal = document.getElementById('progressTotal');
    const sheetsEl = document.getElementById('loaderSheets');
    const appEl = document.getElementById('app');

    const updateStatus = (msg) => { if (statusEl) statusEl.textContent = msg; };
    const updateProgress = (c, t) => {
      const safeTotal = Math.max(Number(t) || 0, 1);
      if (progressFill) progressFill.style.width = `${Math.round((c / safeTotal) * 100)}%`;
      if (progressCurrent) progressCurrent.textContent = String(c);
      if (progressTotal) progressTotal.textContent = String(t);
    };

    try {
      updateStatus('Authenticating...');
      const authed = await window.servicesDB.init();
      if (!authed) {
        if (loader) loader.classList.add('hidden');
        return;
      }

      try {
        const { data } = await window.servicesDB.client.auth.getUser();
        if (data?.user) {
          const chip = document.getElementById('svcUserChip');
          if (chip) chip.textContent = data.user.email || data.user.id.slice(0, 8);
        }
      } catch (_) {}

      updateStatus('Loading sheets...');
      await window.servicesSheetManager.refresh();
      const sheets = window.servicesSheetManager.getSheets() || [];
      updateProgress(0, sheets.length);

      if (sheetsEl) {
        sheetsEl.innerHTML = sheets.map((sheet) => `
          <div class="sheet-item" data-id="${sheet.id}">
            <div class="sheet-icon"></div>
            <div class="sheet-name">${sheet.title || 'Untitled Sheet'}</div>
            <div class="sheet-count">—</div>
          </div>
        `).join('');
      }

      const lastFullRefresh = localStorage.getItem('svc_lastFullRefresh');
      const lastRefreshTs = Number.parseInt(lastFullRefresh || '', 10);
      const shouldRefreshAll = !Number.isFinite(lastRefreshTs) || (Date.now() - lastRefreshTs) > 300000;

      if (!shouldRefreshAll) {
        updateStatus('Using cached data (updated recently)');
        await new Promise((r) => setTimeout(r, 600));
      } else {
        updateStatus('Refreshing all sheets...');
      }

      let completed = 0;
      for (const sheet of sheets) {
        const item = sheetsEl ? sheetsEl.querySelector(`[data-id="${sheet.id}"]`) : null;
        if (item) item.classList.add('active');
        updateStatus(`Updating ${sheet.title || 'sheet'}...`);

        try {
          if (shouldRefreshAll) {
            const rows = await window.servicesDB.listRows(sheet.id);
            localStorage.setItem(`svc_rows_${sheet.id}`, String(rows.length));
            const countEl = item ? item.querySelector('.sheet-count') : null;
            if (countEl) countEl.textContent = `${rows.length} rows`;

            updateStatus(`Syncing QB for ${sheet.title || 'sheet'}...`);
            try {
              const qbClient = window.servicesQB || window.svcQbLookup;
              await qbClient?.refreshAllLinkedColumns?.({ sheet, rows }, null);
              console.log('[LOADER] QB sync complete for', sheet.title);
            } catch (qbErr) {
              console.warn('[LOADER] QB sync failed (non-blocking):', qbErr && qbErr.message ? qbErr.message : qbErr);
            }

            localStorage.setItem(`svc_lastUpdate_${sheet.id}`, Date.now().toString());
          } else {
            const cached = localStorage.getItem(`svc_rows_${sheet.id}`);
            const countEl = item ? item.querySelector('.sheet-count') : null;
            if (cached && countEl) countEl.textContent = `${cached} rows`;
          }
          await new Promise((r) => setTimeout(r, 150));
        } catch (err) {
          console.warn('Refresh failed', sheet.title, err);
        }

        if (item) {
          item.classList.remove('active');
          item.classList.add('done');
        }
        completed += 1;
        updateProgress(completed, sheets.length);
      }

      if (shouldRefreshAll) {
        localStorage.setItem('svc_lastFullRefresh', Date.now().toString());
        localStorage.setItem('svc_lastFullUpdate', Date.now().toString());
      }

      updateStatus('Finalizing...');
      await new Promise((r) => setTimeout(r, 250));

      const lastSheetId = localStorage.getItem('svc_lastSheetId');
      const targetSheet = sheets.find((sheet) => sheet.id === lastSheetId) || sheets[0];
      if (targetSheet) await window.servicesSheetManager.openSheet(targetSheet);

      setSyncState('synced');
      updateStatus('Ready!');
      await new Promise((r) => setTimeout(r, 350));

      if (loader) loader.classList.add('hidden');
      if (appEl) appEl.style.visibility = 'visible';

      setTimeout(async () => {
        for (const sheet of sheets) {
          try {
            const rows = await window.servicesDB.listRows(sheet.id);
            await window.svcQbLookup?.refreshAllLinkedColumns?.({ sheet, rows }, document.getElementById('svcGrid'));
          } catch (_) {}
        }
      }, 2000);

    } catch (err) {
      setSyncState('error');
      console.error('Init failed:', err);
      updateStatus('Error loading. Retrying...');
      setTimeout(() => location.reload(), 2000);
    }
  })();

  // ENTERPRISE UPDATE TIMER
  class UpdateTimer {
    constructor() {
      this.startTime = Number.parseInt(localStorage.getItem('svc_lastFullUpdate') || Date.now().toString(), 10);
      this.timerEl = document.getElementById('timerValue');
      this.containerEl = document.getElementById('updateTimer');
      this.interval = null;
      this.start();
    }

    start() {
      this.update();
      this.interval = setInterval(() => this.update(), 1000);
    }

    update() {
      const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
      const h = Math.floor(elapsed / 3600).toString().padStart(2, '0');
      const m = Math.floor((elapsed % 3600) / 60).toString().padStart(2, '0');
      const s = (elapsed % 60).toString().padStart(2, '0');

      if (this.timerEl) this.timerEl.textContent = `${h}:${m}:${s}`;

      if (this.containerEl) {
        this.containerEl.classList.remove('fresh', 'stale', 'old');
        if (elapsed < 300) {
          this.containerEl.classList.add('fresh');
          this.containerEl.title = 'Data is fresh (< 5 min)';
        } else if (elapsed < 1800) {
          this.containerEl.classList.add('stale');
          this.containerEl.title = 'Data is stale (5-30 min)';
        } else {
          this.containerEl.classList.add('old');
          this.containerEl.title = 'Data is old (> 30 min) - Refresh recommended';
        }
      }
    }

    reset() {
      this.startTime = Date.now();
      localStorage.setItem('svc_lastFullUpdate', this.startTime.toString());
      this.update();
      console.log('[TIMER] Reset to 00:00:00');
    }

    stop() {
      if (this.interval) clearInterval(this.interval);
    }
  }

  window.updateTimer = null;
  setTimeout(() => {
    window.updateTimer = new UpdateTimer();
  }, 1000);

})();
