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

      // ALWAYS do real refresh - remove cache logic
      updateStatus('Starting fresh data sync...');

      let completed = 0;
      for (const sheet of sheets) {
        const item = sheetsEl ? sheetsEl.querySelector(`[data-id="${sheet.id}"]`) : null;
        if (item) item.classList.add('active');
        updateStatus(`Updating ${sheet.title || 'sheet'}...`);

        try {
          // ALWAYS fetch fresh from DB - NO CACHE
          updateStatus(`Fetching ${sheet.title || 'sheet'} from database...`);
          const rows = await window.servicesDB.listRows(sheet.id);

          // Verify we got fresh data
          console.log(`[LOADER] Fetched ${rows.length} rows for ${sheet.title || 'sheet'}`);

          localStorage.setItem(`svc_rows_${sheet.id}`, rows.length.toString());
          if (item) {
            const countEl = item.querySelector('.sheet-count');
            if (countEl) countEl.textContent = `${rows.length} rows`;
          }

          // FORCE QB SYNC - wait for completion
          updateStatus(`Syncing QuickBooks for ${sheet.title || 'sheet'}...`);
          try {
            // This MUST complete before continuing
            const qbClient = window.servicesQB || window.svcQbLookup;
            const qbResult = await qbClient?.refreshAllLinkedColumns?.(
              { sheet, rows },
              document.getElementById('svcGrid')
            );
            console.log(`[LOADER] QB sync DONE for ${sheet.title || 'sheet'}`, qbResult);
          } catch (qbErr) {
            console.error(`[LOADER] QB FAILED for ${sheet.title || 'sheet'}:`, qbErr);
            // Continue anyway but log it
          }

          // ONLY set timestamp AFTER successful fetch
          const updateTime = Date.now();
          localStorage.setItem(`svc_lastUpdate_${sheet.id}`, updateTime.toString());
          localStorage.setItem('svc_lastFullUpdate', updateTime.toString());

          await new Promise((r) => setTimeout(r, 100)); // Visual only
        } catch (err) {
          console.error('[LOADER] FAILED to refresh', sheet.title, err);
          updateStatus(`Error updating ${sheet.title || 'sheet'} - using cached`);
        }

        if (item) {
          item.classList.remove('active');
          item.classList.add('done');
        }
        completed += 1;
        updateProgress(completed, sheets.length);
      }

      // Set final timestamp AFTER all sheets done
      const finalUpdateTime = Date.now();
      localStorage.setItem('svc_lastFullRefresh', finalUpdateTime.toString());
      localStorage.setItem('svc_lastFullUpdate', finalUpdateTime.toString());

      console.log('[LOADER] All sheets updated at', new Date(finalUpdateTime).toLocaleTimeString());

      updateStatus('Finalizing...');
      await new Promise((r) => setTimeout(r, 250));

      const lastSheetId = localStorage.getItem('svc_lastSheetId');
      const targetSheet = sheets.find((sheet) => sheet.id === lastSheetId) || sheets[0];
      if (targetSheet) await window.servicesSheetManager.openSheet(targetSheet);

      setSyncState('synced');
      updateStatus('Ready!');

      updateStatus('Verifying data freshness...');

      // Verify the update actually happened
      const verifyTime = localStorage.getItem('svc_lastFullUpdate');
      const safeVerifyTime = Number.parseInt(verifyTime || '', 10);
      const age = Number.isFinite(safeVerifyTime) ? (Date.now() - safeVerifyTime) : Number.POSITIVE_INFINITY;
      console.log('[VERIFY] Data age:', Math.floor(age / 1000), 'seconds');

      if (age > 10000) { // More than 10 seconds old
        console.error('[VERIFY] WARNING: Data is stale! Age:', age);
        updateStatus('Warning: Data may be stale');
      } else {
        updateStatus(`Ready! Data updated ${Math.floor(age / 1000)}s ago`);
      }

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
      // Read the ACTUAL last update time (set by loader)
      const lastUpdate = localStorage.getItem('svc_lastFullUpdate');
      const parsedUpdate = Number.parseInt(lastUpdate || '', 10);
      this.startTime = Number.isFinite(parsedUpdate) ? parsedUpdate : Date.now();

      console.log('[TIMER] Initialized with start time:', new Date(this.startTime).toLocaleTimeString());
      console.log('[TIMER] Time since update:', Math.floor((Date.now() - this.startTime) / 1000), 'seconds');

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
