(function () {
  const listEl = document.getElementById('svcSheetList');
  const newBtn = document.getElementById('svcNewSheetBtn');
  const searchEl = document.getElementById('svcSheetSearch');
  let sheets = [];
  let activeId = null;

  async function refresh() {
    sheets = await window.servicesDB.listSheets();
    render();
  }

  function render() {
    const q = (searchEl.value || '').toLowerCase();
    listEl.innerHTML = '';
    const filtered = sheets.filter(s => s.title.toLowerCase().includes(q));
    if (!filtered.length) {
      listEl.innerHTML = '<div style="padding:16px;color:var(--svc-text-dim);font-size:12px;text-align:center;">No sheets found.</div>';
      return;
    }
    filtered.forEach(s => {
      const el = document.createElement('div');
      el.className = 'svc-sheet-item' + (s.id === activeId ? ' active' : '');
      el.innerHTML = `
        <span class="icon">${s.icon || '📄'}</span>
        <span class="title">${escHtml(s.title)}</span>
        <span class="menu" data-id="${s.id}" title="Sheet options">⋯</span>`;
      el.addEventListener('click', (e) => {
        if (e.target.classList.contains('menu')) { e.stopPropagation(); openMenu(s); return; }
        window.servicesApp.openSheet(s);
      });
      listEl.appendChild(el);
    });
  }

  async function openMenu(sheet) {
    const action = prompt(`Sheet: "${sheet.title}"\n\nEnter action:\n  R — Rename\n  D — Delete`, '');
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
          window.servicesGrid && window.servicesGrid.clear();
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

  // Keyboard shortcut: Ctrl+N
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      newBtn.click();
    }
  });

  // Realtime: refresh sidebar when any sheet changes
  window.servicesDB.subscribeToSheets(() => refresh());

  function escHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  window.servicesSheetManager = {
    refresh,
    setActive(id) { activeId = id; render(); }
  };
})();
