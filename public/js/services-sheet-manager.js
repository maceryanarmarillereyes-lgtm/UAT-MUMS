(function () {
  // ─────────────────────────────────────────────────────────────────────────────
  // services-sheet-manager.js  — v2 (free-tier load reduction)
  //
  // OVERLOAD FIX-7: subscribeToSheets callback now debounced (500ms) so that
  //   burst realtime events (e.g. bulk sheet creates) do NOT fire a DB query
  //   for every individual event — only one listSheets() after the burst settles.
  //
  // OVERLOAD FIX-8: subscription is stored and reused; calling refresh() does
  //   NOT re-open the channel, preventing subscription accumulation.
  // ─────────────────────────────────────────────────────────────────────────────

  const listEl   = document.getElementById('svcSheetList');
  const newBtn   = document.getElementById('svcNewSheetBtn');
  const searchEl = document.getElementById('svcSheetSearch');

  let sheets   = [];
  let activeId = null;
  let _sheetsSubscription = null;   // FIX-8: single reference, never re-opened
  let _refreshDebounce    = null;   // FIX-7: debounce timer

  // ── refresh: 1 DB query, debounce-protected ───────────────────────────────────
  async function refresh() {
    sheets = await window.servicesDB.listSheets();
    render();
  }

  // FIX-7: Debounced wrapper used by realtime handler
  // Burst of events → only one listSheets() fires after 500ms quiet
  function debouncedRefresh() {
    clearTimeout(_refreshDebounce);
    _refreshDebounce = setTimeout(refresh, 500);
  }

  function render() {
    const q = (searchEl.value || '').toLowerCase();
    listEl.innerHTML = '';
    const filtered = sheets.filter(s => s.title.toLowerCase().includes(q));
    if (!filtered.length) {
      listEl.innerHTML =
        '<div style="padding:16px;color:var(--svc-text-dim);font-size:12px;text-align:center;">No sheets found.</div>';
      return;
    }
    filtered.forEach(s => {
      const el = document.createElement('div');
      el.className = 'svc-sheet-item' + (s.id === activeId ? ' active' : '');
      el.innerHTML = `
        <span class="icon">${s.icon || '📄'}</span>
        <span class="title">${eh(s.title)}</span>
        <span class="menu" data-id="${s.id}" title="Rename / Delete">⋯</span>`;
      el.addEventListener('click', (e) => {
        if (e.target.classList.contains('menu')) { e.stopPropagation(); openMenu(s); return; }
        window.servicesApp.openSheet(s);
      });
      listEl.appendChild(el);
    });
  }

  async function openMenu(sheet) {
    const action = prompt(`Sheet: "${sheet.title}"\n\nType:\n  R — Rename\n  D — Delete`, '');
    if (!action) return;
    if (action.trim().toUpperCase() === 'R') {
      const t = prompt('New title:', sheet.title);
      if (t && t.trim()) {
        await window.servicesDB.renameSheet(sheet.id, t.trim());
        await refresh();
      }
    } else if (action.trim().toUpperCase() === 'D') {
      if (confirm(`Delete "${sheet.title}"? This cannot be undone.`)) {
        await window.servicesDB.deleteSheet(sheet.id);
        if (activeId === sheet.id) {
          activeId = null;
          window.servicesGrid?.clear();
        }
        await refresh();
      }
    }
  }

  newBtn.addEventListener('click', async () => {
    const title = prompt('Sheet name:', 'Untitled Sheet');
    if (!title || !title.trim()) return;
    const created = await window.servicesDB.createSheet(title.trim());
    await refresh();
    if (created) window.servicesApp.openSheet(created);
  });

  searchEl.addEventListener('input', render);

  // FIX-8: Subscribe only ONCE. subscribeToSheets() singleton guard in
  // services-supabase.js ensures only one channel is ever open, but we also
  // guard here so this module never calls subscribeToSheets() twice.
  function startRealtimeSync() {
    if (_sheetsSubscription) return; // already subscribed
    _sheetsSubscription = window.servicesDB.subscribeToSheets(debouncedRefresh); // FIX-7
  }

  function eh(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  window.servicesSheetManager = {
    async refresh() {
      await refresh();
      startRealtimeSync(); // idempotent
    },
    setActive(id) { activeId = id; render(); }
  };
})();
