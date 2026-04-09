/* ═══════════════════════════════════════════════════════════════════
   PRODUCT CATALOG MODULE — Support Studio
   v3: TreeView + Sub-Items + Edit Mode + Right-click Menu
   Roles: SUPER_ADMIN + SUPER_USER = full manage rights
═══════════════════════════════════════════════════════════════════ */
(function() {
  'use strict';

  function getToken() {
    try {
      // Primary: CloudAuth session key (mums_supabase_session)
      var raw = localStorage.getItem('mums_supabase_session') || sessionStorage.getItem('mums_supabase_session');
      if (raw) {
        try {
          var parsed = JSON.parse(raw);
          var t = parsed && (parsed.access_token || (parsed.session && parsed.session.access_token));
          if (t) return String(t);
        } catch(_) {}
      }
      // CloudAuth API
      if (window.CloudAuth && typeof window.CloudAuth.accessToken === 'function') {
        var t2 = window.CloudAuth.accessToken();
        if (t2) return t2;
      }
      // Auth API
      if (window.Auth && typeof window.Auth.getSession === 'function') {
        var s = window.Auth.getSession();
        var t3 = s && s.access_token;
        if (t3) return String(t3);
      }
      // Legacy
      const legacyKeys = ['mums_access_token','sb-access-token','supabase.auth.token'];
      for (const k of legacyKeys) { const v = localStorage.getItem(k); if (v) return v; }
      if (window.opener && window.opener.CloudAuth) {
        const t4 = window.opener.CloudAuth.accessToken();
        if (t4) return t4;
      }
    } catch(_) {}
    return '';
  }

  async function apiFetch(url, opts) {
    const tok = getToken();
    const headers = { 'Content-Type': 'application/json' };
    if (tok) headers['Authorization'] = 'Bearer ' + tok;
    return fetch(url, { ...opts, headers: { ...headers, ...((opts && opts.headers) || {}) } });
  }

  const state = {
    items: [], currentItem: null, users: [],
    currentUserId: null, currentUserName: '',
    isSA: false, isSU: false, canManage: false,
    isAssigned: false, editMode: false,
    expandedNodes: new Set(), ctxTargetItem: null,
    quillSpecs: null, quillGuide: null, quillTs: null,
  };

  async function init() {
    await loadCurrentUser();
    setupCatalogTab();
  }

  async function loadCurrentUser() {
    try {
      const r = await apiFetch('/api/users/me');
      const d = await r.json();
      if (d.ok && d.profile) {
        state.currentUserId   = d.profile.user_id || d.profile.id;
        state.currentUserName = d.profile.name || d.profile.username || 'Me';
        const role = String(d.profile.role || '').toUpperCase().replace(/\s+/g,'_');
        state.isSA = role === 'SUPER_ADMIN';
        state.isSU = role === 'SUPER_USER';
        state.canManage = state.isSA || state.isSU;
      }
    } catch(_) {}
  }

  function setupCatalogTab() {
    const addBtn = document.getElementById('cat-add-btn');
    if (addBtn && state.canManage) addBtn.classList.add('visible');

    window._catInit = function() { if (!state.items.length) loadItems(); };

    const searchEl = document.getElementById('cat-search');
    if (searchEl) searchEl.addEventListener('input', () => renderTree(searchEl.value));

    document.querySelectorAll('.cat-dtab').forEach(btn =>
      btn.addEventListener('click', () => switchDetailTab(btn.dataset.dtab)));

    document.getElementById('cat-save-specs-btn').addEventListener('click', saveSpecs);
    document.getElementById('cat-save-guide-btn').addEventListener('click',
      () => saveRichField('user_guide', state.quillGuide, 'cat-guide-msg'));
    document.getElementById('cat-save-ts-btn').addEventListener('click',
      () => saveRichField('troubleshooting', state.quillTs, 'cat-ts-msg'));
    document.getElementById('cat-post-comment-btn').addEventListener('click', postComment);

    const editBtn = document.getElementById('cat-edit-mode-btn');
    if (editBtn) editBtn.addEventListener('click', toggleEditMode);

    const delBtn = document.getElementById('cat-detail-delete-btn');
    if (delBtn) delBtn.addEventListener('click', () => {
      if (state.currentItem) deleteItemWithConfirm(state.currentItem);
    });

    const crumbBtn = document.getElementById('cdd-parent-crumb');
    if (crumbBtn) crumbBtn.addEventListener('click', () => {
      if (state.currentItem && state.currentItem.parent_id) {
        const parent = state.items.find(i => i.id === state.currentItem.parent_id);
        if (parent) selectItem(parent);
      }
    });

    if (addBtn) addBtn.addEventListener('click', () => openAddModal());
    document.getElementById('cat-modal-close-btn').addEventListener('click',  closeAddModal);
    document.getElementById('cat-modal-cancel-btn').addEventListener('click', closeAddModal);
    document.getElementById('cat-modal-save-btn').addEventListener('click',   createItem);

    document.getElementById('cat-sub-modal-close').addEventListener('click',  closeSubModal);
    document.getElementById('cat-sub-modal-cancel').addEventListener('click', closeSubModal);
    document.getElementById('cat-sub-modal-save').addEventListener('click',   createSubItem);

    setupContextMenu();
    // initEditors wrapped in try-catch: if Quill CDN fails (tracking prevention etc.)
    // event listeners above still work — editors just degrade to plain textarea
    try { initEditors(); } catch(e) { console.warn('[Catalog] Quill init failed, rich text unavailable:', e); }
  }

  function initEditors() {
    if (typeof Quill === 'undefined') throw new Error('Quill not loaded');
    const tb = [
      [{ header:[1,2,3,false] }],
      ['bold','italic','underline'],
      [{ list:'ordered' },{ list:'bullet' }],
      ['blockquote','code-block'],['clean']
    ];
    state.quillSpecs = new Quill('#cat-specs-editor',{ theme:'snow', placeholder:'Enter basic specs…', modules:{ toolbar:tb } });
    state.quillGuide = new Quill('#cat-guide-editor',{ theme:'snow', placeholder:'Write the user guide…', modules:{ toolbar:tb } });
    state.quillTs    = new Quill('#cat-ts-editor',   { theme:'snow', placeholder:'Troubleshooting steps…', modules:{ toolbar:tb } });
  }

  /* ── Edit Mode ─────────────────────────────────────────────── */
  function toggleEditMode() {
    const canEdit = state.canManage || state.isAssigned;
    if (!canEdit) return;
    state.editMode = !state.editMode;
    applyEditMode();
  }

  function applyEditMode() {
    const btn   = document.getElementById('cat-edit-mode-btn');
    const icon  = document.getElementById('cat-edit-mode-icon');
    const label = document.getElementById('cat-edit-mode-label');
    const canEdit = state.canManage || state.isAssigned;
    if (!canEdit) {
      if (btn) btn.style.display = 'none';
      setEditorsReadonly(true);
      return;
    }
    if (btn) {
      btn.style.display = '';
      btn.classList.toggle('editing', state.editMode);
      if (icon)  icon.className  = state.editMode ? 'fas fa-lock-open' : 'fas fa-lock';
      if (label) label.textContent = state.editMode ? 'Editing' : 'Edit Mode';
    }
    setEditorsReadonly(!state.editMode);
    const delBtn = document.getElementById('cat-detail-delete-btn');
    if (delBtn) delBtn.classList.toggle('visible', state.canManage);
  }

  function setEditorsReadonly(readonly) {
    [state.quillSpecs, state.quillGuide, state.quillTs].forEach(q => { if (q) q.enable(!readonly); });
    document.querySelectorAll('.cat-editor-wrap').forEach(el => el.classList.toggle('cat-readonly', readonly));
    ['cat-specs-save-row','cat-guide-save-row','cat-ts-save-row'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = readonly ? 'none' : 'flex';
    });
    const aw = document.getElementById('cdf-assign-wrap');
    if (aw) aw.style.display = state.canManage ? '' : 'none';
    ['cdf-name','cdf-category','cdf-brand','cdf-part_number','cdf-compatible_units','cdf-status'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      if (el.tagName === 'SELECT') el.disabled = readonly;
      else el.readOnly = readonly;
    });
  }

  /* ── Context Menu ──────────────────────────────────────────── */
  function setupContextMenu() {
    const menu = document.getElementById('cat-ctx-menu');
    if (!menu) return;
    document.addEventListener('click', () => closeCtxMenu());
    document.addEventListener('contextmenu', e => {
      const row = e.target.closest('.cat-item-row');
      if (!row) return closeCtxMenu();
      e.preventDefault();
      const item = state.items.find(i => i.id === row.dataset.id);
      if (!item) return;
      state.ctxTargetItem = item;
      const lbl = document.getElementById('cat-ctx-item-label');
      if (lbl) lbl.textContent = item.item_code + ' — ' + item.name;
      document.getElementById('ctx-add-sub').style.display = state.canManage ? '' : 'none';
      document.getElementById('ctx-delete').style.display  = state.canManage ? '' : 'none';
      const sep = menu.querySelector('.cat-ctx-sep');
      if (sep) sep.style.display = state.canManage ? '' : 'none';
      const x = Math.min(e.clientX, window.innerWidth  - 210);
      const y = Math.min(e.clientY, window.innerHeight - 160);
      menu.style.left = x + 'px';
      menu.style.top  = y + 'px';
      menu.classList.add('open');
    });
    document.getElementById('ctx-view').addEventListener('click',    () => { if (state.ctxTargetItem) selectItem(state.ctxTargetItem); closeCtxMenu(); });
    document.getElementById('ctx-add-sub').addEventListener('click', () => { if (state.ctxTargetItem) openSubModal(state.ctxTargetItem); closeCtxMenu(); });
    document.getElementById('ctx-delete').addEventListener('click',  () => { if (state.ctxTargetItem) deleteItemWithConfirm(state.ctxTargetItem); closeCtxMenu(); });
  }
  function closeCtxMenu() {
    const m = document.getElementById('cat-ctx-menu');
    if (m) m.classList.remove('open');
  }

  /* ── Load items ────────────────────────────────────────────── */
  async function loadItems() {
    const list = document.getElementById('cat-list');

    // ── Cache-first: serve from IndexedDB instantly ──────────────────
    const cacheAvail = typeof window.StudioCache !== 'undefined';
    if (cacheAvail) {
      try {
        const cached = await window.StudioCache.getBundle('catalog');
        if (cached && Array.isArray(cached.data) && cached.data.length > 0) {
          state.items = cached.data;
          renderTree('');
          // Quietly refresh in background to keep role flags and data current
          // Guard: capture catalog canvas ref at call time — skip update if user navigated away
          const _catCanvas = document.getElementById('canvas-catalog');
          apiFetch('/api/catalog/items').then(r => r.json()).then(d => {
            if (!document.getElementById('canvas-catalog') || document.getElementById('canvas-catalog') !== _catCanvas) return;
            if (d.ok && d.role) {
              state.isSA = d.role.isSA; state.isSU = d.role.isSU; state.canManage = d.role.canManage;
              const addBtn = document.getElementById('cat-add-btn');
              if (addBtn) addBtn.classList.toggle('visible', state.canManage);
            }
            // Silently update state + cache with latest server data
            if (d.ok && d.items) {
              state.items = d.items;
              window.StudioCache.setBundle('catalog', d.items, '', d.items.length).catch(() => {});
            }
          }).catch(() => {});
          return;
        }
      } catch(_) {}
    }

    // ── No cache — load from network ────────────────────────────────
    if (list) list.innerHTML = '<div class="cat-panel-empty"><i class="fas fa-spinner fa-spin"></i> Loading…</div>';
    try {
      const r = await apiFetch('/api/catalog/items');
      const d = await r.json();
      if (!d.ok) throw new Error(d.message || 'Failed to load');
      state.items = d.items || [];
      if (d.role) {
        state.isSA = d.role.isSA; state.isSU = d.role.isSU; state.canManage = d.role.canManage;
        const addBtn = document.getElementById('cat-add-btn');
        if (addBtn) addBtn.classList.toggle('visible', state.canManage);
      }
      renderTree('');
      // Write to cache for next visit
      if (cacheAvail) window.StudioCache.setBundle('catalog', state.items, '', state.items.length).catch(() => {});
    } catch(e) {
      if (list) list.innerHTML = '<div class="cat-panel-empty" style="color:#f85149;">⚠ ' + esc(String(e.message)) + '</div>';
    }
  }

  /* ── Tree Render ───────────────────────────────────────────── */
  function renderTree(query) {
    const list = document.getElementById('cat-list');
    if (!list) return;
    const q = String(query || '').toLowerCase().trim();
    if (q) {
      const filtered = state.items.filter(i =>
        i.item_code.toLowerCase().includes(q) ||
        i.name.toLowerCase().includes(q) ||
        (i.category||'').toLowerCase().includes(q));
      list.innerHTML = filtered.length
        ? filtered.map(i => renderItemRow(i, false, false, false)).join('')
        : '<div class="cat-panel-empty">No results.</div>';
      return;
    }
    const roots    = state.items.filter(i => !i.parent_id);
    const childMap = {};
    state.items.forEach(i => {
      if (i.parent_id) {
        if (!childMap[i.parent_id]) childMap[i.parent_id] = [];
        childMap[i.parent_id].push(i);
      }
    });
    if (!roots.length) { list.innerHTML = '<div class="cat-panel-empty">No items yet.</div>'; return; }
    let html = '';
    roots.forEach(root => {
      const children = childMap[root.id] || [];
      const hasKids  = children.length > 0;
      const expanded = state.expandedNodes.has(root.id);
      html += '<div class="cat-tree-node" data-nodeid="' + esc(root.id) + '">';
      html += renderItemRow(root, false, hasKids, expanded);
      if (hasKids && expanded) {
        html += '<div class="cat-subtree">';
        children.forEach(child => { html += renderItemRow(child, true, false, false); });
        html += '</div>';
      }
      html += '</div>';
    });
    list.innerHTML = html;
    list.querySelectorAll('.cat-chevron:not(.leaf)').forEach(ch => {
      ch.addEventListener('click', e => {
        e.stopPropagation();
        const nid = ch.dataset.nodeid;
        if (state.expandedNodes.has(nid)) state.expandedNodes.delete(nid);
        else state.expandedNodes.add(nid);
        renderTree(document.getElementById('cat-search').value);
        if (state.currentItem) {
          const r = list.querySelector('[data-id="' + esc(state.currentItem.id) + '"]');
          if (r) r.classList.add('active');
        }
      });
    });
  }

  function renderItemRow(item, isChild, hasKids, expanded) {
    const isActive = state.currentItem && state.currentItem.id === item.id;
    const ini      = item.assigned_to_name ? item.assigned_to_name.slice(0,2).toUpperCase() : '—';
    const assigned = !!item.assigned_to;
    const chevCls  = hasKids ? ('cat-chevron' + (expanded ? ' open' : '')) : 'cat-chevron leaf';
    return '<div class="cat-item-row' + (isActive?' active':'') + (isChild?' is-child':'') + '"' +
      ' data-id="' + esc(item.id) + '"' +
      ' onclick="window._catSelectItem(this.dataset.id)"' +
      ' title="' + esc(item.item_code) + ' — ' + esc(item.name) + '">' +
      '<span class="' + esc(chevCls) + '" data-nodeid="' + esc(item.id) + '"><i class="fas fa-chevron-right"></i></span>' +
      '<span class="cat-item-code">' + esc(item.item_code) + '</span>' +
      '<span class="cat-item-name">'  + esc(item.name)      + '</span>' +
      '<span class="cat-item-avatar' + (assigned?'':' unassigned') + '" title="' + esc(item.assigned_to_name||'Unassigned') + '">' + esc(ini) + '</span>' +
      '</div>';
  }

  window._catSelectItem = function(id) {
    const item = state.items.find(i => i.id === id);
    if (!item) return;
    if (item.parent_id) state.expandedNodes.add(item.parent_id);
    selectItem(item);
  };

  /* ── Select item ───────────────────────────────────────────── */
  async function selectItem(item) {
    state.currentItem = item;
    state.isAssigned  = item.assigned_to && String(item.assigned_to) === String(state.currentUserId);
    state.editMode    = false;
    document.querySelectorAll('.cat-item-row').forEach(r =>
      r.classList.toggle('active', r.dataset.id === item.id));
    document.getElementById('cat-detail-empty').style.display = 'none';
    const view = document.getElementById('cat-detail-view');
    view.style.display = 'flex';

    const crumb = document.getElementById('cdd-parent-crumb');
    const crumbLabel = document.getElementById('cdd-parent-label');
    if (item.parent_id) {
      const parent = state.items.find(i => i.id === item.parent_id);
      if (crumb && crumbLabel && parent) {
        crumbLabel.textContent = parent.item_code + ' — ' + parent.name;
        crumb.classList.add('visible');
      }
    } else {
      if (crumb) crumb.classList.remove('visible');
    }

    document.getElementById('cdd-code').textContent     = item.item_code;
    document.getElementById('cdd-name').textContent     = item.name;
    const statusEl = document.getElementById('cdd-status');
    statusEl.textContent = item.status || 'Active';
    statusEl.className   = 'cat-status-badge ' + (item.status === 'Active' ? 'cat-status-active' : 'cat-status-disc');
    document.getElementById('cdd-category').textContent = item.category  || '—';
    document.getElementById('cdd-brand').textContent    = item.brand     || '—';
    document.getElementById('cdd-part').textContent     = item.part_number || '—';
    document.getElementById('cdd-assigned').textContent = item.assigned_to_name || 'Unassigned';

    document.getElementById('cdf-code').value             = item.item_code;
    document.getElementById('cdf-name').value             = item.name;
    document.getElementById('cdf-category').value         = item.category || 'Controller';
    document.getElementById('cdf-brand').value            = item.brand    || '';
    document.getElementById('cdf-part_number').value      = item.part_number || '';
    document.getElementById('cdf-compatible_units').value = item.compatible_units || '';
    document.getElementById('cdf-status').value           = item.status   || 'Active';

    if (state.quillSpecs) state.quillSpecs.root.innerHTML = item.specs         || '';
    if (state.quillGuide) state.quillGuide.root.innerHTML = item.user_guide    || '';
    if (state.quillTs)    state.quillTs.root.innerHTML    = item.troubleshooting || '';

    if (state.canManage) await loadUsersIntoSelect('cdf-assigned_to', item.assigned_to);

    applyEditMode();
    switchDetailTab('specs');
    loadComments(item.id);
    loadHistory(item.id);
  }

  function switchDetailTab(tab) {
    document.querySelectorAll('.cat-dtab').forEach(b => b.classList.toggle('active', b.dataset.dtab === tab));
    document.querySelectorAll('.cat-dpanel').forEach(p => p.classList.toggle('active', p.id === 'cdp-' + tab));
    if (tab === 'comments' && state.currentItem) loadComments(state.currentItem.id);
    if (tab === 'history'  && state.currentItem) loadHistory(state.currentItem.id);
  }

  /* ── Save specs ────────────────────────────────────────────── */
  async function saveSpecs() {
    if (!state.currentItem) return;
    const btn = document.getElementById('cat-save-specs-btn');
    const msg = document.getElementById('cat-specs-msg');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const payload = {
        id: state.currentItem.id,
        name:             document.getElementById('cdf-name').value.trim(),
        category:         document.getElementById('cdf-category').value,
        brand:            document.getElementById('cdf-brand').value.trim(),
        part_number:      document.getElementById('cdf-part_number').value.trim(),
        compatible_units: document.getElementById('cdf-compatible_units').value.trim(),
        status:           document.getElementById('cdf-status').value,
        specs:            state.quillSpecs ? state.quillSpecs.root.innerHTML : '',
      };
      if (state.canManage) {
        const sel = document.getElementById('cdf-assigned_to');
        if (sel) {
          payload.assigned_to      = sel.value || null;
          payload.assigned_to_name = sel.value ? (sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : '') : '';
        }
      }
      const r = await apiFetch('/api/catalog/items', { method:'PATCH', body:JSON.stringify(payload) });
      const d = await r.json();
      if (!d.ok) throw new Error(d.message || 'Save failed');
      const idx = state.items.findIndex(i => i.id === state.currentItem.id);
      if (idx > -1) { state.items[idx] = { ...state.items[idx], ...payload }; state.currentItem = state.items[idx]; }
      renderTree(document.getElementById('cat-search').value);
      document.getElementById('cdd-name').textContent     = payload.name;
      document.getElementById('cdd-category').textContent = payload.category;
      document.getElementById('cdd-brand').textContent    = payload.brand || '—';
      document.getElementById('cdd-part').textContent     = payload.part_number || '—';
      const se = document.getElementById('cdd-status');
      se.textContent = payload.status;
      se.className   = 'cat-status-badge ' + (payload.status==='Active' ? 'cat-status-active' : 'cat-status-disc');
      showMsg(msg, '✓ Saved!', true);
    } catch(e) { showMsg(msg, '✗ ' + e.message, false); }
    finally { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save Changes'; }
  }

  async function saveRichField(field, quill, msgId) {
    if (!state.currentItem || !quill) return;
    const btnId = field === 'user_guide' ? 'cat-save-guide-btn' : 'cat-save-ts-btn';
    const btn   = document.getElementById(btnId);
    const msg   = document.getElementById(msgId);
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
      const payload = { id: state.currentItem.id, [field]: quill.root.innerHTML };
      const r = await apiFetch('/api/catalog/items', { method:'PATCH', body:JSON.stringify(payload) });
      const d = await r.json();
      if (!d.ok) throw new Error(d.message || 'Save failed');
      const idx = state.items.findIndex(i => i.id === state.currentItem.id);
      if (idx > -1) { state.items[idx][field] = payload[field]; state.currentItem[field] = payload[field]; }
      showMsg(msg, '✓ Saved!', true);
    } catch(e) { showMsg(msg, '✗ ' + e.message, false); }
    finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save"></i> Save ' + (field==='user_guide' ? 'User Guide' : 'Troubleshooting Guide');
      }
    }
  }

  /* ── Delete item ───────────────────────────────────────────── */
  async function deleteItemWithConfirm(item) {
    if (!state.canManage) return;
    const children = state.items.filter(i => i.parent_id === item.id);
    const warn = children.length ? '\n\nWarning: This will also delete ' + children.length + ' sub-item(s).' : '';
    if (!confirm('Delete "' + item.item_code + ' — ' + item.name + '"?' + warn + '\n\nThis cannot be undone.')) return;
    try {
      const r = await apiFetch('/api/catalog/items', { method:'DELETE', body:JSON.stringify({ id: item.id }) });
      const d = await r.json();
      if (!d.ok) throw new Error(d.message || 'Delete failed');
      if (state.currentItem && (state.currentItem.id === item.id || state.currentItem.parent_id === item.id)) {
        state.currentItem = null;
        document.getElementById('cat-detail-empty').style.display = '';
        document.getElementById('cat-detail-view').style.display  = 'none';
      }
      await loadItems();
    } catch(e) { alert('Delete failed: ' + e.message); }
  }

  /* ── Comments ──────────────────────────────────────────────── */
  async function loadComments(itemId) {
    const list = document.getElementById('cat-comment-list');
    if (!list) return;
    list.innerHTML = '<div class="cat-panel-empty"><i class="fas fa-spinner fa-spin"></i></div>';
    try {
      const r = await apiFetch('/api/catalog/comments?item_id=' + itemId);
      const d = await r.json();
      if (!d.ok) throw new Error('Failed');
      const comments = d.comments || [];
      const badge    = document.getElementById('cat-comment-badge');
      const unacked  = comments.filter(c => !c.is_acknowledged).length;
      if (badge) { badge.textContent = unacked; badge.style.display = unacked > 0 ? '' : 'none'; }
      if (!comments.length) { list.innerHTML = '<div class="cat-panel-empty">No comments yet.</div>'; return; }
      list.innerHTML = comments.map(c => renderComment(c)).join('');
      list.querySelectorAll('[data-ack-id]').forEach(btn =>
        btn.addEventListener('click', () => acknowledgeComment(btn.dataset.ackId)));
    } catch(_) { list.innerHTML = '<div class="cat-panel-empty">Failed to load comments.</div>'; }
  }

  function renderComment(c) {
    const ini     = String(c.user_name||'?').slice(0,2).toUpperCase();
    const dt      = new Date(c.created_at);
    const timeStr = dt.toLocaleDateString('en-PH',{ month:'short', day:'numeric' }) + ' ' +
                    dt.toLocaleTimeString('en-PH',{ hour:'2-digit', minute:'2-digit' });
    const canAck  = (state.canManage || state.isAssigned) && !c.is_acknowledged;
    const ackHtml = c.is_acknowledged
      ? '<span class="cat-ack-badge"><i class="fas fa-check-circle"></i> Acknowledged by ' + esc(c.acknowledged_name||'') + ' &middot; Updated</span>'
      : (canAck ? '<button class="cat-btn-ack" data-ack-id="' + esc(c.id) + '"><i class="fas fa-check"></i> Acknowledge &amp; Mark Updated</button>' : '');
    return '<div class="cat-comment-card' + (c.is_acknowledged?' acknowledged':'') + '" id="cc-' + esc(c.id) + '">' +
      '<div class="cat-comment-head">' +
        '<div class="cat-comment-avatar">' + esc(ini) + '</div>' +
        '<span class="cat-comment-author">' + esc(c.user_name) + '</span>' +
        '<span class="cat-comment-time">'   + esc(timeStr) + '</span>' +
      '</div>' +
      '<div class="cat-comment-body">' + esc(c.comment) + '</div>' +
      '<div class="cat-comment-footer">' + ackHtml + '</div>' +
      '</div>';
  }

  async function postComment() {
    const input   = document.getElementById('cat-comment-input');
    const comment = String(input && input.value || '').trim();
    if (!comment || !state.currentItem) return;
    const btn = document.getElementById('cat-post-comment-btn');
    btn.disabled = true; btn.textContent = 'Posting…';
    try {
      const r = await apiFetch('/api/catalog/comments',{ method:'POST', body:JSON.stringify({ item_id: state.currentItem.id, comment }) });
      const d = await r.json();
      if (!d.ok) throw new Error(d.message || 'Failed');
      input.value = '';
      await loadComments(state.currentItem.id);
    } catch(e) { alert('Failed to post comment: ' + e.message); }
    finally { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Post'; }
  }

  async function acknowledgeComment(commentId) {
    try {
      const r = await apiFetch('/api/catalog/comments',{ method:'PATCH', body:JSON.stringify({ id: commentId }) });
      const d = await r.json();
      if (!d.ok) throw new Error(d.message || 'Failed');
      if (state.currentItem) await loadComments(state.currentItem.id);
    } catch(e) { alert('Failed to acknowledge: ' + e.message); }
  }

  /* ── History ───────────────────────────────────────────────── */
  async function loadHistory(itemId) {
    const list = document.getElementById('cat-history-list');
    if (!list) return;
    list.innerHTML = '<div class="cat-panel-empty"><i class="fas fa-spinner fa-spin"></i></div>';
    try {
      const hr = await apiFetch('/api/catalog/history?item_id=' + itemId);
      const hd = await hr.json();
      if (hd.ok && hd.history && hd.history.length) {
        list.innerHTML = hd.history.map(h => {
          const dt      = new Date(h.edited_at);
          const timeStr = dt.toLocaleDateString('en-PH',{ month:'short', day:'numeric', year:'numeric' }) + ' ' +
                          dt.toLocaleTimeString('en-PH',{ hour:'2-digit', minute:'2-digit' });
          return '<div class="cat-history-row">' +
            '<span class="cat-history-time">'  + esc(timeStr)                           + '</span>' +
            '<span class="cat-history-who">'   + esc(h.edited_by_name)                  + '</span>' +
            '<span class="cat-history-field">' + esc(h.field_changed)                   + '</span>' +
            '<span class="cat-history-val">'   + esc(String(h.new_value||'').slice(0,80)) + '</span>' +
            '</div>';
        }).join('');
      } else { list.innerHTML = '<div class="cat-panel-empty">No edit history yet.</div>'; }
    } catch(_) { list.innerHTML = '<div class="cat-panel-empty">Could not load history.</div>'; }
  }

  /* ── Add Root Item Modal ───────────────────────────────────── */
  async function openAddModal() {
    if (!state.canManage) return;
    await loadUsersIntoSelect('cmi-assigned_to', null);
    ['cmi-code','cmi-name','cmi-brand'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
    const msgEl = document.getElementById('cat-modal-msg');
    if (msgEl) { msgEl.className = 'cat-save-msg'; msgEl.textContent = ''; }
    document.getElementById('cat-add-modal').classList.add('open');
  }
  function closeAddModal() { document.getElementById('cat-add-modal').classList.remove('open'); }
  window._catCloseAddModal = closeAddModal;

  async function createItem() {
    const code = document.getElementById('cmi-code').value.trim().toUpperCase();
    const name = document.getElementById('cmi-name').value.trim();
    const msg  = document.getElementById('cat-modal-msg');
    if (!code || !name) { showMsg(msg, '✗ Item code and name are required', false); return; }
    if (code.endsWith('-')) { showMsg(msg, '✗ Remove trailing dash from item code', false); return; }
    if (/--/.test(code)) { showMsg(msg, '✗ Code cannot have consecutive dashes', false); return; }
    const btn = document.getElementById('cat-modal-save-btn');
    btn.disabled = true; btn.textContent = 'Creating…';
    try {
      const sel = document.getElementById('cmi-assigned_to');
      const r = await apiFetch('/api/catalog/items', { method:'POST', body:JSON.stringify({
        item_code: code, name,
        category:         document.getElementById('cmi-category').value,
        brand:            document.getElementById('cmi-brand').value.trim(),
        assigned_to:      sel && sel.value ? sel.value : null,
        assigned_to_name: sel && sel.value ? (sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : '') : '',
        parent_id: null,
      })});
      const d = await r.json();
      if (!d.ok) {
        if (r.status === 409 || d.error === 'duplicate_code') {
          showMsg(msg, '✗ Item code "' + code + '" already exists — use a unique code', false);
          return;
        }
        throw new Error(d.message || d.error || 'Create failed');
      }
      await loadItems(); closeAddModal();
      const newItem = state.items.find(i => i.item_code === code);
      if (newItem) selectItem(newItem);
    } catch(e) { showMsg(msg, '✗ ' + e.message, false); }
    finally { btn.disabled = false; btn.innerHTML = '<i class="fas fa-plus"></i> Create Item'; }
  }
  window._catDoCreateItem = function(btnEl) { createItem(btnEl); };

  /* ── Add Sub-Item Modal ────────────────────────────────────── */
  async function openSubModal(parentItem) {
    if (!state.canManage || !parentItem) return;
    await loadUsersIntoSelect('csmi-assigned_to', null);
    const lbl = document.getElementById('cat-sub-parent-label');
    if (lbl) lbl.textContent = parentItem.item_code + ' — ' + parentItem.name;
    document.getElementById('csmi-code').value  = parentItem.item_code + '-';
    document.getElementById('csmi-name').value  = '';
    document.getElementById('csmi-brand').value = parentItem.brand || '';
    const cat = document.getElementById('csmi-category');
    if (cat) cat.value = parentItem.category || 'Controller';
    const msgEl = document.getElementById('cat-sub-modal-msg');
    if (msgEl) { msgEl.className='cat-save-msg'; msgEl.textContent=''; }
    document.getElementById('cat-sub-modal').dataset.parentId = parentItem.id;
    document.getElementById('cat-sub-modal').classList.add('open');
  }
  function closeSubModal() {
    document.getElementById('cat-sub-modal').classList.remove('open');
    hideSubError();
  }
  window._catCloseSubModal = closeSubModal;

  function showSubError(text) {
    // Primary: show banner in modal
    const wrap = document.getElementById('cat-sub-modal-msg');
    const span = document.getElementById('cat-sub-modal-msg-text');
    if (wrap && span) {
      span.textContent = text;
      wrap.style.cssText = 'display:flex !important;background:rgba(248,81,73,.1);border:1px solid rgba(248,81,73,.3);border-radius:7px;padding:7px 12px;font-size:11px;font-weight:600;color:#f85149;margin-bottom:10px;align-items:center;gap:7px;';
      clearTimeout(wrap._hideT);
      wrap._hideT = setTimeout(() => { wrap.style.display = 'none'; }, 5000);
    } else {
      // Guaranteed fallback — always visible
      alert('[Add Sub-Item] ' + text);
    }
  }
  function hideSubError() {
    const wrap = document.getElementById('cat-sub-modal-msg');
    if (wrap) wrap.style.display = 'none';
  }

  async function createSubItem(btnEl) {
    hideSubError();
    const codeRaw  = (document.getElementById('csmi-code').value || '').trim();
    const code     = codeRaw.toUpperCase();
    const name     = (document.getElementById('csmi-name').value || '').trim();

    // Get parentId — stored in modal dataset
    const modalEl  = document.getElementById('cat-sub-modal');
    const parentId = modalEl ? (modalEl.dataset.parentId || modalEl.getAttribute('data-parent-id')) : null;

    // Validations
    if (!code) { showSubError('Sub-item code is required'); return; }
    if (!name) { showSubError('Name is required'); return; }
    if (!parentId) { showSubError('No parent item found — close and try again'); return; }
    // Reject trailing dashes — prevents dirty codes like CTR-001- or CTR-001--
    if (code.endsWith('-')) { showSubError('Add a suffix after the dash — e.g. CTR-001-A or CTR-001-200'); return; }
    if (/--/.test(code)) { showSubError('Code cannot have consecutive dashes'); return; }

    // Check local duplicates
    if (state.items.some(function(i) { return i.item_code === code; })) {
      showSubError('Code "' + code + '" already exists — use a unique code');
      return;
    }

    // Lock button + show spinner
    const btn = btnEl || document.getElementById('cat-sub-modal-save');
    const origHtml = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Adding…'; }

    try {
      const sel      = document.getElementById('csmi-assigned_to');
      const catEl    = document.getElementById('csmi-category');
      const brandEl  = document.getElementById('csmi-brand');
      const payload  = {
        item_code:        code,
        name:             name,
        category:         catEl    ? catEl.value                           : 'Controller',
        brand:            brandEl  ? (brandEl.value || '').trim()          : '',
        assigned_to:      sel && sel.value ? sel.value                     : null,
        assigned_to_name: sel && sel.value && sel.options[sel.selectedIndex]
                          ? sel.options[sel.selectedIndex].text : '',
        parent_id:        parentId,
      };

      const r = await apiFetch('/api/catalog/items', { method: 'POST', body: JSON.stringify(payload) });
      const d = await r.json();

      if (!d.ok) {
        if (r.status === 409 || d.error === 'duplicate_code') {
          showSubError('Code "' + code + '" already exists — use a unique code');
          return;
        }
        showSubError(d.message || d.error || 'Server error — please try again');
        return;
      }

      // Success
      state.expandedNodes.add(parentId);
      await loadItems();
      closeSubModal();
      const newItem = state.items.find(function(i) { return i.item_code === code; });
      if (newItem) selectItem(newItem);

    } catch(e) {
      showSubError(e.message || 'Network error — please try again');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = origHtml || '<i class="fas fa-code-branch"></i> Add Sub-Item'; }
    }
  }
  // Expose globally — onclick attribute primary trigger
  window._catDoAddSubItem = function(btnEl) { createSubItem(btnEl); };

    /* ── Users dropdown ────────────────────────────────────────── */
  async function loadUsersIntoSelect(selectId, currentValue) {
    if (state.users.length === 0) {
      try {
        const r = await apiFetch('/api/users/list');
        const d = await r.json();
        if (d.ok && Array.isArray(d.users)) state.users = d.users;
      } catch(_) {}
    }
    const sel = document.getElementById(selectId);
    if (!sel) return;
    sel.innerHTML = '<option value="">— Unassigned —</option>' +
      state.users.map(u =>
        '<option value="' + esc(u.id||u.user_id) + '"' + (String(u.id||u.user_id)===String(currentValue||'')?'selected':'') + '>' + esc(u.name||u.username) + '</option>'
      ).join('');
  }

  /* ── Helpers ───────────────────────────────────────────────── */
  function esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function showMsg(el, text, ok) {
    if (!el) return;
    el.textContent = text;
    el.className   = 'cat-save-msg ' + (ok ? 'ok' : 'err');
    setTimeout(() => { if (el) { el.textContent=''; el.className='cat-save-msg'; } }, 3500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else setTimeout(init, 200);

})();
