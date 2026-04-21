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
  function setSyncState(state) {
    if (!syncChip) return;
    if (state === 'loading') {
      syncChip.textContent = '◌ Connecting…';
      syncChip.style.cssText = 'color:#94A3B8;background:rgba(148,163,184,0.1);border-color:rgba(148,163,184,0.3)';
    } else if (state === 'synced') {
      syncChip.textContent = '● Synced';
      syncChip.style.cssText = 'color:#4ADE80;background:rgba(34,197,94,0.1);border-color:rgba(34,197,94,0.3)';
    } else {
      syncChip.textContent = '✕ Auth Error';
      syncChip.style.cssText = 'color:#F87171;background:rgba(248,113,113,0.1);border-color:rgba(248,113,113,0.3)';
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
    // Step 1: inject session into Supabase client
    const authed = await window.servicesDB.init();
    if (!authed) return; // init() redirects to login if needed

    // Step 2: show user email
    try {
      const { data } = await window.servicesDB.client.auth.getUser();
      if (data?.user) {
        const chip = document.getElementById('svcUserChip');
        if (chip) chip.textContent = data.user.email || data.user.id.slice(0, 8);
      }
    } catch (_) {}

    // Step 3: load sheet list (now authenticated)
    await window.servicesSheetManager.refresh();

    setSyncState('synced');
  })();
})();
