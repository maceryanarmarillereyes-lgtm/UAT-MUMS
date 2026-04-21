(function () {
  // ─────────────────────────────────────────────────────────────────────────────
  // services-treeview.js — v1
  //
  // Responsibilities:
  //   • Loads & caches treeview folder definitions per sheet
  //   • Renders folder nodes under each sheet item in the left sidebar
  //   • Manages right-click context menu for folders
  //   • Drives servicesGrid.setTreeFilter() when a folder is selected
  //   • Opens creation / rename / delete modals (custom UI — no browser prompt)
  //
  // CONSTRAINTS (strictly followed):
  //   • Does NOT touch auth, RLS, or realtime channel names
  //   • Does NOT modify svc-main grid/layout CSS classes
  //   • Does NOT re-open existing realtime subscriptions
  // ─────────────────────────────────────────────────────────────────────────────

  // ── State ───────────────────────────────────────────────────────────────────
  var _cache = {};              // { sheetId: [folder, ...] }
  var _activeSheetId  = null;
  var _activeFolderId = null;   // null → "All Records"
  var _ctxMenu        = null;   // currently open context menu DOM node
  var _modal          = null;   // currently open modal
  var _loadTokens     = {};     // sheetId -> latest render token

  // ── Condition operators ──────────────────────────────────────────────────────
  var OPS = [
    { value: 'eq',       label: 'equals' },
    { value: 'neq',      label: 'not equals' },
    { value: 'contains', label: 'contains' },
    { value: 'starts',   label: 'starts with' },
    { value: 'ends',     label: 'ends with' },
    { value: 'empty',    label: 'is empty' },
    { value: 'notempty', label: 'is not empty' }
  ];

  var NO_VALUE_OPS = ['empty', 'notempty'];

  // ── Condition evaluator ──────────────────────────────────────────────────────
  function matchCondition(rowData, field, op, value) {
    var cellVal = (rowData[field] != null ? String(rowData[field]) : '').toLowerCase().trim();
    var cmp     = (value || '').toLowerCase().trim();
    switch (op) {
      case 'eq':       return cellVal === cmp;
      case 'neq':      return cellVal !== cmp;
      case 'contains': return cellVal.includes(cmp);
      case 'starts':   return cellVal.startsWith(cmp);
      case 'ends':     return cellVal.endsWith(cmp);
      case 'empty':    return cellVal === '';
      case 'notempty': return cellVal !== '';
      default:         return true;
    }
  }

  // ── Load folders for a sheet (uses cache) ───────────────────────────────────
  async function loadFolders(sheetId) {
    var folders = await window.servicesDB.listTreeFolders(sheetId);
    _cache[sheetId] = folders;
    return folders;
  }

  // ── Apply grid filter for selected folder ───────────────────────────────────
  function applyGridFilter(folderId, sheetId) {
    if (!window.servicesGrid) return;
    var folders = _cache[sheetId] || [];
    if (folderId === '__main__') {
      var stateMain = window.servicesGrid.getState && window.servicesGrid.getState();
      var colsMain = stateMain && stateMain.sheet && stateMain.sheet.column_defs;
      var matchers = folders
        .filter(function (f) { return !!(f && f.condition_field); })
        .map(function (f) { return buildFolderMatcher(f, colsMain); })
        .filter(Boolean);
      window.servicesGrid.setTreeFilter(function (row) {
        if (!matchers.length) return true; // no folders = main shows all
        return !matchers.some(function (fn) { return fn(row); });
      });
      return;
    }

    var folder  = folders.find(function (f) { return f.id === folderId; });
    if (!folderId || !folder || !folder.condition_field) {
      window.servicesGrid.setTreeFilter(null);
      return;
    }
    var state = window.servicesGrid.getState && window.servicesGrid.getState();
    var matcher = buildFolderMatcher(folder, state && state.sheet && state.sheet.column_defs);
    window.servicesGrid.setTreeFilter(matcher || null);
  }

  // ── Count matching rows for a folder (for badges) ───────────────────────────
  function countForFolder(folder, sheetId) {
    var state = window.servicesGrid && window.servicesGrid.getState();
    if (!state || state.sheet.id !== sheetId) return null;
    var rows = state.rows || [];
    if (!folder.condition_field) return rows.length;
    var resolvedField = resolveConditionField(folder.condition_field, state.sheet && state.sheet.column_defs);
    return rows.filter(function (r) {
      return matchCondition(r.data || {}, resolvedField, folder.condition_op || 'eq', folder.condition_value);
    }).length;
  }

  function countForMain(sheetId) {
    var state = window.servicesGrid && window.servicesGrid.getState();
    if (!state || !state.sheet || state.sheet.id !== sheetId) return null;
    var rows = state.rows || [];
    var folders = _cache[sheetId] || [];
    var cols = state.sheet.column_defs || [];
    var matchers = folders
      .filter(function (f) { return !!(f && f.condition_field); })
      .map(function (f) { return buildFolderMatcher(f, cols); })
      .filter(Boolean);
    if (!matchers.length) return rows.length;
    return rows.filter(function (row) {
      return !matchers.some(function (fn) { return fn(row); });
    }).length;
  }

  function resolveConditionField(rawField, columnDefs) {
    var want = String(rawField || '').trim();
    if (!want) return '';
    var cols = Array.isArray(columnDefs) ? columnDefs : [];
    var direct = cols.find(function (c) { return String(c && c.key || '') === want; });
    if (direct && direct.key) return direct.key;
    var wantNorm = want.toLowerCase();
    var byLabel = cols.find(function (c) {
      return String(c && c.label || '').trim().toLowerCase() === wantNorm;
    });
    if (byLabel && byLabel.key) return byLabel.key;
    return want;
  }

  function buildFolderMatcher(folder, columnDefs) {
    if (!folder || !folder.condition_field) return null;
    var resolvedField = resolveConditionField(folder.condition_field, columnDefs);
    return function (row) {
      return matchCondition(row && row.data ? row.data : {}, resolvedField, folder.condition_op || 'eq', folder.condition_value);
    };
  }

  // ── Render treeview nodes for one sheet ─────────────────────────────────────
  function renderTree(sheetId, containerEl) {
    var folders = _cache[sheetId] || [];
    containerEl.innerHTML = '';
    if (!folders.length) return;

    // ── "All Records" virtual node ─────────────────────────────────────────
    // BUG FIX: onSheetOpened sets _activeFolderId = '__main__', but old code
    // only checked for null. Now we unify: null OR '__main__' = All Records active.
    var allIsActive = _activeSheetId === sheetId &&
      (_activeFolderId === null || _activeFolderId === '__main__');
    var allNode = document.createElement('div');
    allNode.className = 'svc-tv-node' + (allIsActive ? ' svc-tv-active' : '');
    allNode.dataset.folderId = '__main__'; // unified key (was '__all__', caused mismatch with onSheetOpened)
    allNode.dataset.sheetId  = sheetId;
    allNode.innerHTML =
      '<span class="svc-tv-connector">└</span>' +
      '<span class="svc-tv-icon">📋</span>' +
      '<span class="svc-tv-label">All Records</span>' +
      '<span class="svc-tv-count">' + getRowCount(sheetId) + '</span>';
    allNode.addEventListener('click', function () { selectFolder(null, sheetId); });
    allNode.addEventListener('contextmenu', function (e) { e.preventDefault(); openFolderCtxMenu(e, null, sheetId); });
    containerEl.appendChild(allNode);

    // ── Folder nodes ───────────────────────────────────────────────────────
    folders.forEach(function (f, idx) {
      var isActive  = _activeSheetId === sheetId && _activeFolderId === f.id;
      var node      = document.createElement('div');
      node.className = 'svc-tv-node' + (isActive ? ' svc-tv-active' : '');
      node.dataset.folderId = f.id;
      node.dataset.sheetId  = sheetId;

      var isLast    = idx === folders.length - 1;
      var count     = countForFolder(f, sheetId);
      var countBadge = count !== null
        ? '<span class="svc-tv-count">' + count + '</span>'
        : '';

      // Per-folder isolated QB Update button
      var updateHtml =
        '<button class="svc-tv-folder-update-btn" ' +
          'data-folder-id="' + f.id + '" ' +
          'data-sheet-id="' + sheetId + '" ' +
          'title="QB Update: refresh lookup for \'' + eh(f.name) + '\' rows only" ' +
          'tabindex="-1">⟳</button>';

      node.innerHTML =
        '<span class="svc-tv-connector">' + (isLast ? '└' : '├') + '</span>' +
        '<span class="svc-tv-icon">' + (f.icon || '📁') + '</span>' +
        '<span class="svc-tv-label">' + eh(f.name) + '</span>' +
        countBadge +
        updateHtml;

      // Wire up per-folder update button — does NOT affect main sheet
      var ubtn = node.querySelector('.svc-tv-folder-update-btn');
      if (ubtn) {
        ubtn.addEventListener('click', function (e) {
          e.stopPropagation();
          runFolderUpdate(f, sheetId, ubtn);
        });
      }

      node.addEventListener('click', function (e) {
        // Ignore clicks on the Update button itself
        if (e.target && e.target.classList.contains('svc-tv-folder-update-btn')) return;
        selectFolder(f.id, sheetId);
      });
      node.addEventListener('contextmenu', function (e) { e.preventDefault(); openFolderCtxMenu(e, f, sheetId); });
      containerEl.appendChild(node);
    });
  }

  function getRowCount(sheetId) {
    var state = window.servicesGrid && window.servicesGrid.getState();
    if (!state || state.sheet.id !== sheetId) return '';
    return (state.rows || []).length;
  }

  // ── Select folder — updates active state + triggers grid filter ─────────────
  function selectFolder(folderId, sheetId) {
    _activeSheetId  = sheetId;
    _activeFolderId = folderId;
    applyGridFilter(folderId, sheetId);
    // Re-render all trees to update active state
    document.querySelectorAll('.svc-tv-container').forEach(function (c) {
      renderTree(c.dataset.sheetId, c);
    });
  }

  // ── Per-folder isolated QB Update ────────────────────────────────────────────
  // Refreshes QB lookup ONLY for rows matching this folder's condition.
  // Does NOT call refreshAllLinkedColumns (which touches all rows).
  // Does NOT save rows outside this folder — main sheet rows are untouched.
  function runFolderUpdate(folder, sheetId, btnEl) {
    if (!window.servicesGrid || !window.svcQbLookup) {
      window.svcToast && window.svcToast.show('error', 'Folder Update', 'Grid or QB Lookup not ready.');
      return;
    }
    var state = window.servicesGrid.getState();
    if (!state || !state.sheet || state.sheet.id !== sheetId) {
      window.svcToast && window.svcToast.show('error', 'Folder Update', 'Open this sheet first before updating.');
      return;
    }

    var cols        = state.sheet.column_defs || [];
    var matcher     = buildFolderMatcher(folder, cols);
    var folderRows  = matcher
      ? (state.rows || []).filter(matcher)
      : (state.rows || []);

    if (!folderRows.length) {
      window.svcToast && window.svcToast.show('info', folder.name, 'No matching rows to update.');
      return;
    }

    // Disable button + spinner
    var origText = btnEl.textContent;
    btnEl.disabled    = true;
    btnEl.textContent = '⏳';
    btnEl.classList.add('svc-tv-folder-update-btn--loading');

    var grid = document.getElementById('svcGrid');

    // Folder-scoped fast update: one QB bulk call + one DB bulk upsert via shared updater
    // without touching rows outside this folder.
    var stateSlice = Object.assign({}, state, { rows: folderRows });
    if (!window.svcQbLookup.refreshAllLinkedColumns) {
      btnEl.disabled    = false;
      btnEl.textContent = origText;
      btnEl.classList.remove('svc-tv-folder-update-btn--loading');
      window.svcToast && window.svcToast.show('error', 'Folder Update', 'QB Lookup module not ready.');
      return;
    }

    window.svcQbLookup.refreshAllLinkedColumns(stateSlice, grid)
      .then(function () {
        btnEl.disabled    = false;
        btnEl.textContent = origText;
        btnEl.classList.remove('svc-tv-folder-update-btn--loading');
        rerenderAllTrees(sheetId);
        window.svcToast && window.svcToast.show('success', folder.name, folderRows.length + ' rows updated.');
      })
      .catch(function (err) {
        btnEl.disabled    = false;
        btnEl.textContent = origText;
        btnEl.classList.remove('svc-tv-folder-update-btn--loading');
        window.svcToast && window.svcToast.show('error', 'Folder Update Failed', err && err.message ? err.message : 'Try again.');
      });
  }

  // ── Right-click context menu on a folder node ─────────────────────────────────
  function openFolderCtxMenu(e, folder, sheetId) {
    closeCtxMenu();
    var menu = document.createElement('div');
    menu.className = 'svc-col-ctx-menu svc-tv-ctx-menu';
    menu.style.left = e.clientX + 'px';
    menu.style.top  = e.clientY + 'px';

    // Close btn
    var closeBtn = document.createElement('button');
    closeBtn.className = 'ctx-close-btn';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', closeCtxMenu);
    menu.appendChild(closeBtn);

    // Section header
    var header = document.createElement('div');
    header.className = 'ctx-section-header';
    header.textContent = folder ? folder.name : 'All Records';
    menu.appendChild(header);

    // Add Folder
    appendCtxItem(menu, '📁', 'Add Folder', function () {
      closeCtxMenu();
      openFolderModal(null, sheetId);
    });

    // Separator
    appendCtxSep(menu);

    if (folder) {
      // Edit Condition
      appendCtxItem(menu, '⚙', 'Edit Condition', function () {
        closeCtxMenu();
        openFolderModal(folder, sheetId);
      });

      // Rename
      appendCtxItem(menu, '✏️', 'Rename', function () {
        closeCtxMenu();
        openRenameModal(folder, sheetId);
      });

      appendCtxSep(menu);

      // Delete
      var deleteItem = appendCtxItem(menu, '🗑', 'Delete Folder', async function () {
        closeCtxMenu();
        openConfirmDelete(folder, sheetId);
      });
      deleteItem.classList.add('ctx-item-danger');
    }

    document.body.appendChild(menu);
    _ctxMenu = menu;

    // Auto-flip if overflows right/bottom
    requestAnimationFrame(function () {
      var rect = menu.getBoundingClientRect();
      if (rect.right > window.innerWidth - 8)
        menu.style.left = (e.clientX - rect.width) + 'px';
      if (rect.bottom > window.innerHeight - 8)
        menu.style.top = (e.clientY - rect.height) + 'px';
    });
  }

  function appendCtxItem(menu, icon, label, onClick) {
    var item = document.createElement('div');
    item.className = 'ctx-item';
    item.innerHTML =
      '<span class="ctx-icon">' + icon + '</span>' +
      '<span class="ctx-label">' + eh(label) + '</span>';
    item.addEventListener('click', onClick);
    menu.appendChild(item);
    return item;
  }

  function appendCtxSep(menu) {
    var sep = document.createElement('div');
    sep.className = 'ctx-separator';
    menu.appendChild(sep);
  }

  function closeCtxMenu() {
    if (_ctxMenu) { _ctxMenu.remove(); _ctxMenu = null; }
  }

  // ── Sheet right-click — expose to sheet-manager ──────────────────────────────
  function openSheetCtxMenu(e, sheet, hasFolders, onRename, onDelete) {
    closeCtxMenu();
    var menu = document.createElement('div');
    menu.className = 'svc-col-ctx-menu svc-tv-ctx-menu';
    menu.style.left = e.clientX + 'px';
    menu.style.top  = e.clientY + 'px';

    var closeBtn = document.createElement('button');
    closeBtn.className = 'ctx-close-btn';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', closeCtxMenu);
    menu.appendChild(closeBtn);

    var header = document.createElement('div');
    header.className = 'ctx-section-header';
    header.textContent = sheet.title;
    menu.appendChild(header);

    appendCtxItem(menu, '✏️', 'Rename', function () { closeCtxMenu(); onRename(); });
    appendCtxSep(menu);
    var del = appendCtxItem(menu, '🗑', 'Delete Sheet', function () { closeCtxMenu(); onDelete(); });
    del.classList.add('ctx-item-danger');
    appendCtxSep(menu);
    appendCtxItem(menu, hasFolders ? '📂' : '📂', hasFolders ? 'Add Folder' : 'Enable TreeView', function () {
      closeCtxMenu();
      openFolderModal(null, sheet.id);
    });

    document.body.appendChild(menu);
    _ctxMenu = menu;

    requestAnimationFrame(function () {
      var rect = menu.getBoundingClientRect();
      if (rect.right > window.innerWidth - 8)
        menu.style.left = (e.clientX - rect.width) + 'px';
      if (rect.bottom > window.innerHeight - 8)
        menu.style.top = (e.clientY - rect.height) + 'px';
    });
  }

  // ── Modal: Create / Edit Folder ─────────────────────────────────────────────
  function openFolderModal(existingFolder, sheetId) {
    closeModal();

    var state = window.servicesGrid && window.servicesGrid.getState();
    var cols   = (state && state.sheet && state.sheet.id === sheetId)
      ? (state.sheet.column_defs || [])
      : [];

    var isEdit = !!existingFolder;

    var overlay = document.createElement('div');
    overlay.className = 'svc-tv-modal-overlay';

    var modal = document.createElement('div');
    modal.className = 'svc-tv-modal';

    // ── Header
    var hdr = document.createElement('div');
    hdr.className = 'svc-tv-modal-header';
    hdr.innerHTML =
      '<div class="svc-tv-modal-title">' +
        '<span class="svc-tv-modal-icon">📂</span>' +
        (isEdit ? 'Edit Folder' : 'New TreeView Folder') +
      '</div>';
    var xBtn = document.createElement('button');
    xBtn.className = 'svc-tv-modal-close';
    xBtn.textContent = '✕';
    xBtn.addEventListener('click', closeModal);
    hdr.appendChild(xBtn);
    modal.appendChild(hdr);

    // ── Body
    var body = document.createElement('div');
    body.className = 'svc-tv-modal-body';

    // Folder name
    body.innerHTML +=
      '<label class="svc-tv-modal-label">Folder Name</label>';
    var nameInput = document.createElement('input');
    nameInput.className = 'svc-tv-modal-input';
    nameInput.placeholder = 'e.g. Closed, In Progress…';
    nameInput.value = isEdit ? existingFolder.name : '';
    body.appendChild(nameInput);

    // Icon row
    body.appendChild(makeLabel('Folder Icon'));
    var iconRow = document.createElement('div');
    iconRow.className = 'svc-tv-icon-row';
    var ICONS = ['📁','📂','✅','❌','⏳','🔄','🟡','🟢','🔴','⭐','🗂','📌'];
    var selectedIcon = isEdit ? (existingFolder.icon || '📁') : '📁';
    ICONS.forEach(function (ic) {
      var btn = document.createElement('button');
      btn.className = 'svc-tv-icon-btn' + (ic === selectedIcon ? ' active' : '');
      btn.textContent = ic;
      btn.dataset.icon = ic;
      btn.addEventListener('click', function () {
        iconRow.querySelectorAll('.svc-tv-icon-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        selectedIcon = ic;
      });
      iconRow.appendChild(btn);
    });
    body.appendChild(iconRow);

    // Condition section
    var condHeader = document.createElement('div');
    condHeader.className = 'svc-tv-section-header';
    condHeader.innerHTML =
      '<span>Filter Condition</span>' +
      '<span class="svc-tv-section-hint">Rows matching this rule appear in this folder</span>';
    body.appendChild(condHeader);

    var condRow = document.createElement('div');
    condRow.className = 'svc-tv-cond-row';

    // Column selector
    var colSel = document.createElement('select');
    colSel.className = 'svc-tv-modal-select';
    var noColOpt = document.createElement('option');
    noColOpt.value = '';
    noColOpt.textContent = '— No filter (show all) —';
    colSel.appendChild(noColOpt);
    cols.forEach(function (c) {
      var opt = document.createElement('option');
      opt.value = c.key;
      opt.textContent = c.label || c.key;
      if (isEdit && existingFolder.condition_field === c.key) opt.selected = true;
      colSel.appendChild(opt);
    });
    if (cols.length === 0) {
      var hint = document.createElement('option');
      hint.value = '';
      hint.textContent = '⚠ Open sheet first to see columns';
      hint.disabled = true;
      colSel.appendChild(hint);
    }
    condRow.appendChild(colSel);

    // Operator selector
    var opSel = document.createElement('select');
    opSel.className = 'svc-tv-modal-select svc-tv-op-select';
    OPS.forEach(function (op) {
      var opt = document.createElement('option');
      opt.value = op.value;
      opt.textContent = op.label;
      if (isEdit && existingFolder.condition_op === op.value) opt.selected = true;
      opSel.appendChild(opt);
    });
    condRow.appendChild(opSel);

    // Value input
    var valInput = document.createElement('input');
    valInput.className = 'svc-tv-modal-input svc-tv-val-input';
    valInput.placeholder = 'Value…';
    valInput.value = isEdit ? (existingFolder.condition_value || '') : '';
    condRow.appendChild(valInput);

    body.appendChild(condRow);

    // Toggle value input visibility based on operator
    function syncOpUI() {
      var noVal = NO_VALUE_OPS.indexOf(opSel.value) !== -1;
      valInput.style.display = noVal ? 'none' : '';
      valInput.disabled = noVal;
    }
    opSel.addEventListener('change', syncOpUI);
    syncOpUI();

    // ── Condition preview pill
    var previewEl = document.createElement('div');
    previewEl.className = 'svc-tv-cond-preview';
    body.appendChild(previewEl);

    function updatePreview() {
      var colLabel = colSel.options[colSel.selectedIndex]
        ? colSel.options[colSel.selectedIndex].textContent : '?';
      var opLabel  = opSel.options[opSel.selectedIndex]
        ? opSel.options[opSel.selectedIndex].textContent : '?';
      if (!colSel.value) {
        previewEl.textContent = 'No condition — folder shows all rows';
        return;
      }
      var noVal = NO_VALUE_OPS.indexOf(opSel.value) !== -1;
      previewEl.textContent = '"' + colLabel + '" ' + opLabel + (noVal ? '' : ' "' + valInput.value + '"');
    }
    colSel.addEventListener('change', updatePreview);
    opSel.addEventListener('change', updatePreview);
    valInput.addEventListener('input', updatePreview);
    updatePreview();

    modal.appendChild(body);

    // ── Footer
    var footer = document.createElement('div');
    footer.className = 'svc-tv-modal-footer';

    var cancelBtn = document.createElement('button');
    cancelBtn.className = 'svc-btn ghost';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', closeModal);

    var saveBtn = document.createElement('button');
    saveBtn.className = 'svc-btn accent svc-tv-save-btn';
    saveBtn.textContent = isEdit ? '✓ Save Changes' : '✓ Create Folder';
    saveBtn.addEventListener('click', async function () {
      var name = nameInput.value.trim();
      if (!name) { nameInput.classList.add('svc-tv-input-error'); nameInput.focus(); return; }
      nameInput.classList.remove('svc-tv-input-error');
      saveBtn.disabled = true; saveBtn.textContent = '⏳ Saving…';

      var payload = {
        name: name,
        icon: selectedIcon,
        color: '#22D3EE',
        condition_field: colSel.value || null,
        condition_op: opSel.value,
        condition_value: NO_VALUE_OPS.indexOf(opSel.value) !== -1 ? '' : valInput.value.trim(),
        sort_order: isEdit ? existingFolder.sort_order : ((_cache[sheetId] || []).length)
      };

      try {
        var created = null;
        if (isEdit) {
          await window.servicesDB.updateTreeFolder(existingFolder.id, payload);
        } else {
          created = await window.servicesDB.createTreeFolder(sheetId, payload);
          if (!created || !created.id) throw new Error('TreeView folder was not saved. Check DB migration/policies.');
          if (!_cache[sheetId]) _cache[sheetId] = [];
          _cache[sheetId].push(created);
          _cache[sheetId].sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });
        }
        rerenderAllTrees(sheetId);
        closeModal();
        window.svcToast && window.svcToast.show('success', 'TreeView', isEdit ? 'Folder updated.' : 'Folder "' + name + '" created.');
        // async reconcile cache from DB, but do not block modal close UX
        loadFolders(sheetId).then(function () { rerenderAllTrees(sheetId); }).catch(function () {});
      } catch (err) {
        saveBtn.disabled = false;
        saveBtn.textContent = isEdit ? '✓ Save Changes' : '✓ Create Folder';
        window.svcToast && window.svcToast.show('error', 'Error', err && err.message ? err.message : 'Could not save folder.');
      }
    });

    footer.appendChild(cancelBtn);
    footer.appendChild(saveBtn);
    modal.appendChild(footer);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    _modal = overlay;

    // Animate in
    requestAnimationFrame(function () { overlay.classList.add('svc-tv-modal-open'); });
    nameInput.focus();

    // Close on overlay click
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });
    // ESC
    overlay.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
  }

  // ── Modal: Rename ────────────────────────────────────────────────────────────
  function openRenameModal(folder, sheetId) {
    closeModal();
    var overlay = makeSimpleModal('✏️ Rename Folder', function (modal) {
      var inp = document.createElement('input');
      inp.className = 'svc-tv-modal-input';
      inp.value = folder.name;
      modal.appendChild(inp);

      var footer = document.createElement('div');
      footer.className = 'svc-tv-modal-footer';
      var cancel = document.createElement('button');
      cancel.className = 'svc-btn ghost';
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', closeModal);
      var ok = document.createElement('button');
      ok.className = 'svc-btn accent';
      ok.textContent = '✓ Rename';
      ok.addEventListener('click', async function () {
        var n = inp.value.trim();
        if (!n) return;
        ok.disabled = true; ok.textContent = '⏳';
        try {
          await window.servicesDB.renameTreeFolder(folder.id, n);
          await loadFolders(sheetId);
          rerenderAllTrees(sheetId);
          closeModal();
        } catch (err) {
          ok.disabled = false; ok.textContent = '✓ Rename';
          window.svcToast && window.svcToast.show('error', 'Rename Failed', err && err.message ? err.message : 'Could not rename folder.');
        }
      });
      footer.appendChild(cancel);
      footer.appendChild(ok);
      modal.appendChild(footer);
      inp.focus();
      inp.select();
    });
    document.body.appendChild(overlay);
    _modal = overlay;
    requestAnimationFrame(function () { overlay.classList.add('svc-tv-modal-open'); });
  }

  // ── Modal: Confirm delete ────────────────────────────────────────────────────
  function openConfirmDelete(folder, sheetId) {
    closeModal();
    var overlay = makeSimpleModal('🗑 Delete Folder', function (modal) {
      var msg = document.createElement('p');
      msg.className = 'svc-tv-modal-msg';
      msg.textContent = 'Delete "' + folder.name + '"? This cannot be undone.';
      modal.appendChild(msg);

      var footer = document.createElement('div');
      footer.className = 'svc-tv-modal-footer';
      var cancel = document.createElement('button');
      cancel.className = 'svc-btn ghost';
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', closeModal);
      var del = document.createElement('button');
      del.className = 'svc-btn';
      del.style.cssText = 'background:rgba(248,113,113,0.1);color:#f87171;border-color:rgba(248,113,113,0.4)';
      del.textContent = '🗑 Delete';
      del.addEventListener('click', async function () {
        del.disabled = true; del.textContent = '⏳';
        try {
          await window.servicesDB.deleteTreeFolder(folder.id);
          // If deleted folder was selected, reset filter
          if (_activeFolderId === folder.id) {
            _activeFolderId = null;
            window.servicesGrid && window.servicesGrid.setTreeFilter(null);
          }
          await loadFolders(sheetId);
          rerenderAllTrees(sheetId);
          closeModal();
          window.svcToast && window.svcToast.show('info', 'Folder Deleted', '"' + folder.name + '" removed.');
        } catch (err) {
          del.disabled = false; del.textContent = '🗑 Delete';
          window.svcToast && window.svcToast.show('error', 'Delete Failed', err && err.message ? err.message : 'Could not delete folder.');
        }
      });
      footer.appendChild(cancel);
      footer.appendChild(del);
      modal.appendChild(footer);
    });
    document.body.appendChild(overlay);
    _modal = overlay;
    requestAnimationFrame(function () { overlay.classList.add('svc-tv-modal-open'); });
  }

  function makeSimpleModal(title, populate) {
    var overlay = document.createElement('div');
    overlay.className = 'svc-tv-modal-overlay';

    var modal = document.createElement('div');
    modal.className = 'svc-tv-modal svc-tv-modal-sm';

    var hdr = document.createElement('div');
    hdr.className = 'svc-tv-modal-header';
    hdr.innerHTML = '<div class="svc-tv-modal-title">' + title + '</div>';
    var xBtn = document.createElement('button');
    xBtn.className = 'svc-tv-modal-close';
    xBtn.textContent = '✕';
    xBtn.addEventListener('click', closeModal);
    hdr.appendChild(xBtn);

    var body = document.createElement('div');
    body.className = 'svc-tv-modal-body';

    modal.appendChild(hdr);
    modal.appendChild(body);
    populate(body);
    overlay.appendChild(modal);

    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });
    overlay.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
    return overlay;
  }

  function closeModal() {
    if (_modal) {
      _modal.classList.remove('svc-tv-modal-open');
      var m = _modal;
      _modal = null;
      setTimeout(function () { if (m.parentNode) m.remove(); }, 200);
    }
  }

  // ── Re-render all tree containers for a sheet ────────────────────────────────
  function rerenderAllTrees(sheetId) {
    document.querySelectorAll('.svc-tv-container[data-sheet-id="' + sheetId + '"]').forEach(function (c) {
      renderTree(sheetId, c);
    });
    updateSheetCountBadge(sheetId);
  }

  function updateSheetCountBadge(sheetId) {
    var mainCount = countForMain(sheetId);
    document.querySelectorAll('.svc-sheet-count[data-sheet-id="' + sheetId + '"]').forEach(function (el) {
      if (mainCount == null) {
        el.textContent = '';
        el.style.display = 'none';
      } else {
        el.textContent = String(mainCount);
        el.style.display = '';
      }
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function makeLabel(text) {
    var el = document.createElement('label');
    el.className = 'svc-tv-modal-label';
    el.textContent = text;
    return el;
  }

  function eh(s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Global click/esc to close menus and modals ───────────────────────────────
  document.addEventListener('click', function (e) {
    if (_ctxMenu && !_ctxMenu.contains(e.target)) closeCtxMenu();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeCtxMenu(); closeModal(); }
  });

  // ── Public API ───────────────────────────────────────────────────────────────
  window.servicesTreeview = {
    /**
     * loadAndRender(sheetId, containerEl)
     * Called by sheet-manager after creating the tree container for a sheet.
     */
    async loadAndRender(sheetId, containerEl) {
      var sid = String(sheetId);
      var token = Date.now() + ':' + Math.random().toString(36).slice(2);
      _loadTokens[sid] = token;
      await loadFolders(sheetId);
      if (_loadTokens[sid] !== token) return;
      var liveContainer = document.querySelector('.svc-tv-container[data-sheet-id="' + sid + '"]') || containerEl;
      if (!liveContainer || !liveContainer.isConnected) return;
      renderTree(sheetId, liveContainer);
      updateSheetCountBadge(sheetId);
      // BUG FIX 2: Re-apply active filter AFTER folders load.
      // onSheetOpened() runs applyGridFilter('__main__') BEFORE this
      // async loadAndRender() completes — so matchers are always empty
      // and folder conditions never auto-activate on initial sheet open.
      if (_activeSheetId === sid) {
        applyGridFilter(_activeFolderId || '__main__', sheetId);
      }
    },

    /**
     * hasFolders(sheetId) — sync, uses cache
     */
    hasFolders(sheetId) {
      return !!(_cache[sheetId] && _cache[sheetId].length > 0);
    },

    /**
     * getFolders(sheetId) — returns cached array
     */
    getFolders(sheetId) {
      return _cache[sheetId] || [];
    },

    countMain(sheetId) {
      return countForMain(sheetId);
    },

    /**
     * openSheetCtxMenu(e, sheet, onRename, onDelete)
     * Called by sheet-manager on right-click of a sheet item.
     */
    openSheetCtxMenu(e, sheet, onRename, onDelete) {
      var hasFolders = this.hasFolders(sheet.id);
      openSheetCtxMenu(e, sheet, hasFolders, onRename, onDelete);
    },

    /**
     * refreshTree(sheetId) — reloads folders from DB and re-renders
     */
    async refreshTree(sheetId) {
      await loadFolders(sheetId);
      rerenderAllTrees(sheetId);
    },

    /**
     * onSheetOpened(sheetId) — call when a sheet becomes active
     * Resets active folder to "All Records" for consistency
     */
    onSheetOpened(sheetId) {
      _activeSheetId  = sheetId;
      _activeFolderId = '__main__';
      applyGridFilter('__main__', sheetId);
      // BUG FIX: folderId on allNode is now '__main__' (was '__all__') — toggle works
      document.querySelectorAll('.svc-tv-node').forEach(function (n) {
        n.classList.toggle('svc-tv-active',
          n.dataset.sheetId === sheetId && n.dataset.folderId === '__main__');
      });
      updateSheetCountBadge(sheetId);
    },

    refreshCounts(sheetId) {
      rerenderAllTrees(sheetId);
    },

    /**
     * renderTree(sheetId, containerEl) — public re-render
     */
    renderTree: renderTree
  };
})();
