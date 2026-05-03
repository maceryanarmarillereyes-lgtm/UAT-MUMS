/**
 * @file services-sheet-manager.js
 * @description Services module: sheet/column state persistence and restore
 * @module MUMS/Services
 * @version UAT
 */
/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

(function () {
  // ─────────────────────────────────────────────────────────────────────────────
  // services-sheet-manager.js  — v3 (treeview + proper context menu)
  //
  // Changes vs v2:
  //   • Replaced prompt()-based openMenu() with a premium DOM context menu via
  //     window.servicesTreeview.openSheetCtxMenu() — zero browser dialogs
  //   • Each sheet item gets a collapsible .svc-tv-container for its treeview
  //   • servicesTreeview.loadAndRender() populates the container after render
  //   • Rename / Delete now use the same custom modal pattern (no prompt/confirm)
  //
  // OVERLOAD FIX-7 / FIX-8: debounce + singleton channel preserved from v2.
  // ─────────────────────────────────────────────────────────────────────────────

  const listEl   = document.getElementById('svcSheetList');
  const newBtn   = document.getElementById('svcNewSheetBtn');
  const searchEl = document.getElementById('svcSheetSearch');

  let sheets   = [];
  let activeId = null;
  let _sheetsSubscription = null;
  let _refreshDebounce    = null;

  async function refresh() {
    sheets = await window.servicesDB.listSheets();
    render();
  }

  function debouncedRefresh() {
    if (window.__MUMS_PAUSED) return;
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
      const wrapper = document.createElement('div');
      wrapper.className = 'svc-sheet-wrapper';
      wrapper.dataset.sheetId = s.id;

      const el = document.createElement('div');
      el.className = 'svc-sheet-item' + (s.id === activeId ? ' active' : '');
      var mainCount = '';
      try {
        if (window.servicesTreeview && typeof window.servicesTreeview.countMain === 'function') {
          var c = window.servicesTreeview.countMain(s.id);
          if (c != null) mainCount = String(c);
        }
      } catch (_) {}
      el.innerHTML =
        `<span class="icon">${s.icon || '📄'}</span>` +
        `<span class="title">${eh(s.title)}</span>` +
        `<span class="svc-sheet-count svc-tv-count" data-sheet-id="${s.id}" style="${mainCount ? '' : 'display:none;'}">${mainCount}</span>` +
        `<span class="menu" data-id="${s.id}" title="Options (or right-click)">⋯</span>`;

      el.addEventListener('click', (e) => {
        if (e.target.classList.contains('menu')) { e.stopPropagation(); showSheetMenu(e, s); return; }
        openSheet(s);
      });

      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showSheetMenu(e, s);
      });

      wrapper.appendChild(el);

      const tvContainer = document.createElement('div');
      tvContainer.className = 'svc-tv-container';
      tvContainer.dataset.sheetId = s.id;
      wrapper.appendChild(tvContainer);

      listEl.appendChild(wrapper);

      if (window.servicesTreeview) {
        window.servicesTreeview.loadAndRender(s.id, tvContainer);
      }
    });
  }

  function openSheet(s) {
    window.servicesApp.openSheet(s);
    window.servicesTreeview && window.servicesTreeview.onSheetOpened(s.id);
    // Persist last opened
    localStorage.setItem('svc_lastSheetId', s.id);
  }

  function showSheetMenu(e, sheet) {
    if (!window.servicesTreeview) return;
    window.servicesTreeview.openSheetCtxMenu(
      e, sheet,
      () => openRenameModal(sheet),
      () => openDeleteModal(sheet)
    );
  }

  function openRenameModal(sheet) {
    var existing = document.getElementById('svcSheetRenameModal');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'svcSheetRenameModal';
    overlay.className = 'svc-tv-modal-overlay';

    var modal = document.createElement('div');
    modal.className = 'svc-tv-modal svc-tv-modal-sm';

    var hdr = document.createElement('div');
    hdr.className = 'svc-tv-modal-header';
    hdr.innerHTML = '<div class="svc-tv-modal-title">✏️ Rename Sheet</div>';
    var xBtn = document.createElement('button');
    xBtn.className = 'svc-tv-modal-close'; xBtn.textContent = '✕';
    xBtn.addEventListener('click', () => overlay.remove());
    hdr.appendChild(xBtn);

    var body = document.createElement('div');
    body.className = 'svc-tv-modal-body';

    var inp = document.createElement('input');
    inp.className = 'svc-tv-modal-input';
    inp.value = sheet.title;
    body.appendChild(inp);

    var footer = document.createElement('div');
    footer.className = 'svc-tv-modal-footer';
    var cancel = document.createElement('button');
    cancel.className = 'svc-btn ghost'; cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => overlay.remove());
    var ok = document.createElement('button');
    ok.className = 'svc-btn accent'; ok.textContent = '✓ Rename';
    ok.addEventListener('click', async () => {
      const t = inp.value.trim();
      if (!t) { inp.classList.add('svc-tv-input-error'); inp.focus(); return; }
      ok.disabled = true; ok.textContent = '⏳';
      await window.servicesDB.renameSheet(sheet.id, t);
      await refresh();
      overlay.remove();
    });
    footer.appendChild(cancel);
    footer.appendChild(ok);
    body.appendChild(footer);

    modal.appendChild(hdr);
    modal.appendChild(body);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('svc-tv-modal-open'));
    inp.focus(); inp.select();
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok.click(); });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') overlay.remove(); });
  }

  function openDeleteModal(sheet) {
    var existing = document.getElementById('svcSheetDeleteModal');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'svcSheetDeleteModal';
    overlay.className = 'svc-tv-modal-overlay';

    var modal = document.createElement('div');
    modal.className = 'svc-tv-modal svc-tv-modal-sm';

    var hdr = document.createElement('div');
    hdr.className = 'svc-tv-modal-header';
    hdr.innerHTML = '<div class="svc-tv-modal-title">🗑 Delete Sheet</div>';
    var xBtn = document.createElement('button');
    xBtn.className = 'svc-tv-modal-close'; xBtn.textContent = '✕';
    xBtn.addEventListener('click', () => overlay.remove());
    hdr.appendChild(xBtn);

    var body = document.createElement('div');
    body.className = 'svc-tv-modal-body';

    var msg = document.createElement('p');
    msg.className = 'svc-tv-modal-msg';
    msg.innerHTML = 'Delete <strong>' + eh(sheet.title) + '</strong>?<br><span style="color:var(--svc-danger);font-size:12px;">This cannot be undone — all rows will be lost.</span>';
    body.appendChild(msg);

    var footer = document.createElement('div');
    footer.className = 'svc-tv-modal-footer';
    var cancel = document.createElement('button');
    cancel.className = 'svc-btn ghost'; cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => overlay.remove());
    var del = document.createElement('button');
    del.className = 'svc-btn';
    del.style.cssText = 'background:rgba(248,113,113,0.1);color:#f87171;border-color:rgba(248,113,113,0.4)';
    del.textContent = '🗑 Delete';
    del.addEventListener('click', async () => {
      del.disabled = true; del.textContent = '⏳';
      await window.servicesDB.deleteSheet(sheet.id);
      if (activeId === sheet.id) {
        activeId = null;
        window.servicesGrid && window.servicesGrid.clear();
      }
      await refresh();
      overlay.remove();
    });
    footer.appendChild(cancel);
    footer.appendChild(del);
    body.appendChild(footer);

    modal.appendChild(hdr);
    modal.appendChild(body);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('svc-tv-modal-open'));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') overlay.remove(); });
  }

  newBtn.addEventListener('click', () => {
    var existing = document.getElementById('svcNewSheetModal');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'svcNewSheetModal';
    overlay.className = 'svc-tv-modal-overlay';

    var modal = document.createElement('div');
    modal.className = 'svc-tv-modal svc-tv-modal-sm';

    var hdr = document.createElement('div');
    hdr.className = 'svc-tv-modal-header';
    hdr.innerHTML = '<div class="svc-tv-modal-title">📋 New Sheet</div>';
    var xBtn = document.createElement('button');
    xBtn.className = 'svc-tv-modal-close'; xBtn.textContent = '✕';
    xBtn.addEventListener('click', () => overlay.remove());
    hdr.appendChild(xBtn);

    var body = document.createElement('div');
    body.className = 'svc-tv-modal-body';

    var inp = document.createElement('input');
    inp.className = 'svc-tv-modal-input';
    inp.placeholder = 'Sheet name…';
    inp.value = 'Untitled Sheet';
    body.appendChild(inp);

    var footer = document.createElement('div');
    footer.className = 'svc-tv-modal-footer';
    var cancel = document.createElement('button');
    cancel.className = 'svc-btn ghost'; cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => overlay.remove());
    var ok = document.createElement('button');
    ok.className = 'svc-btn accent'; ok.textContent = '✓ Create';
    ok.addEventListener('click', async () => {
      const t = inp.value.trim();
      if (!t) { inp.classList.add('svc-tv-input-error'); inp.focus(); return; }
      ok.disabled = true; ok.textContent = '⏳';
      const created = await window.servicesDB.createSheet(t);
      await refresh();
      if (created) openSheet(created);
      overlay.remove();
    });
    footer.appendChild(cancel);
    footer.appendChild(ok);
    body.appendChild(footer);

    modal.appendChild(hdr);
    modal.appendChild(body);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('svc-tv-modal-open'));
    inp.focus(); inp.select();
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok.click(); });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') overlay.remove(); });
  });

  searchEl.addEventListener('input', render);

  function startRealtimeSync() {
    if (_sheetsSubscription) return;
    _sheetsSubscription = window.servicesDB.subscribeToSheets(debouncedRefresh);
  }

  function eh(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  window.servicesSheetManager = {
    async refresh() {
      await refresh();
      startRealtimeSync();
    },
    setActive(id) { activeId = id; render(); },
    openSheet,
    getSheets() { return sheets.slice(); }
  };
})();
