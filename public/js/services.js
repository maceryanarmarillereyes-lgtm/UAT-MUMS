(function () {
  window.servicesApp = {
    async openSheet(sheet) {
      window.servicesSheetManager.setActive(sheet.id);
      await window.servicesGrid.load(sheet);
      // Sync chip: "Synced"
      setSyncState('synced');
    }
  };

  // ── Sync chip helper ─────────────────────────────────────────────
  const syncChip = document.getElementById('svcSyncIndicator');
  function setSyncState(state) {
    if (!syncChip) return;
    if (state === 'synced') {
      syncChip.textContent = '● Synced';
      syncChip.style.color = '#4ADE80';
      syncChip.style.background = 'rgba(34,197,94,0.1)';
      syncChip.style.borderColor = 'rgba(34,197,94,0.3)';
    } else {
      syncChip.textContent = '◌ Offline';
      syncChip.style.color = '#F87171';
      syncChip.style.background = 'rgba(248,113,113,0.1)';
      syncChip.style.borderColor = 'rgba(248,113,113,0.3)';
    }
  }

  // ── User chip ────────────────────────────────────────────────────
  (async () => {
    try {
      const c = window.servicesDB.client;
      if (!c) return;
      const { data } = await c.auth.getUser();
      if (data?.user) {
        const chip = document.getElementById('svcUserChip');
        if (chip) chip.textContent = data.user.email || data.user.id.slice(0, 8);
      }
    } catch (e) { /* not authenticated – fine */ }
  })();

  // ── Keyboard shortcuts ───────────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    const editable = document.activeElement?.isContentEditable;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || editable;

    // Ctrl+N — new sheet (suppress when typing in cells)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n' && !typing) {
      e.preventDefault();
      document.getElementById('svcNewSheetBtn').click();
    }

    // Ctrl+K — focus sheet search
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      const s = document.getElementById('svcSheetSearch');
      if (s) { s.focus(); s.select(); }
    }
  });

  // ── Initial load ─────────────────────────────────────────────────
  window.servicesSheetManager.refresh();
  setSyncState('synced');
})();
