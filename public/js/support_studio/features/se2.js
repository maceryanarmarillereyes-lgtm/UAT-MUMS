/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

/* ══════════════════════════════════════════════════════════════════════════
   SEARCH ENGINE 2 — Advanced Enterprise Search v2.0 (PERMANENT BUG FIX)
   ══════════════════════════════════════════════════════════════════════════
   BUGFIX LOG:
   BUG 1 FIXED: '' (empty string concat) in onclick HTML strings → was generating
     onclick="window._se2FilterCat(qb)" (bare variable, not string) → ReferenceError.
     Fixed to use \\' (escaped single quote) for proper JS strings in HTML attrs.
     Same fix applied to _renderChips and _se2OpenInQbs.
   BUG 2 FIXED: QB records never reached SE2 — window.__studioQbRecords only
     populates AFTER QBS tab is visited. Added multi-path QB source discovery:
     reads from qbs-root._qbRowSnaps (set by my_quickbase on data load) AND
     window.__studioQbRecords/Columns with proper field extraction.
   BUG 3 FIXED: _run() bailed when _state.loaded=false with no retry callback.
     _loadData now stores a "pending query" slot and always fires search on complete.
   BUG 4 FIXED: Pre-load race — second 12MB fetch triggered when preload in-flight.
     Shared __se2KbPromise sentinel prevents duplicate fetches.
   BUG 5 FIXED: Inline onclick with bare variable names replaced with data-src
     delegated event listeners on the cats container — no inline JS strings.
   ══════════════════════════════════════════════════════════════════════════ */
(function() {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────────────
  var SE2_CHIPS = [
    'E3 offline','Walmart','license key','firmware update','floor plan','HACCP',
    'temperature alarm','XR75','CS remapping','Connect+','E2 to E3','rack alarm',
    'offline delay','Modbus','probe failure','Woolworths','remote access'
  ];

  // Source definitions
  var SOURCES = {
    qb:    { label:'QuickBase_S',          shortLabel:'QuickBase_S',          color:'#58a6ff', icon:'fa-link'         },
    qbd:   { label:'Deep Search',          shortLabel:'Deep Search',          color:'#3b82f6', icon:'fa-search'       },
    kb:    { label:'Knowledge Base',       shortLabel:'Knowledge Base',       color:'#10b981', icon:'fa-book'         },
    parts: { label:'Part Number',          shortLabel:'Part Number',          color:'#f59e0b', icon:'fa-barcode'      },
    ctrl:  { label:'Product Controllers',  shortLabel:'Product Controllers',  color:'#a78bfa', icon:'fa-microchip'    },
    net:   { label:'Connect+',             shortLabel:'Connect+',             color:'#22d3ee', icon:'fa-plug'         },
    ci:    { label:'Contact Information',  shortLabel:'Contact Information',  color:'#14b8a6', icon:'fa-address-book' },
    sr:    { label:'Support Records',      shortLabel:'Support Records',      color:'#f43f5e', icon:'fa-book-open'    }
  };

  var CAT_MAP = {
    e2e3_gateway:'qb', alarms:'qb', floorplan_screens:'qb', firmware:'qb',
    refrigeration:'qb', password_credentials:'qb', data_reports:'qb',
    temperature_haccp:'qb', site_supervisor:'ctrl', programming:'ctrl',
    controller_hardware:'ctrl', connect_plus:'net',
    parts_xr_controllers:'parts', parts_xm_controllers:'parts', parts_cc200:'parts',
    parts_license_keys:'parts', parts_rga_warranty:'parts', parts_probes_sensors:'parts',
    parts_sporlan_danfoss:'parts', parts_site_supervisor:'parts',
    parts_walmart_jobs:'parts', parts_part_number_inquiry:'parts', parts_products:'parts'
  };

  // ── Synonym / NLP expansion ────────────────────────────────────────────────
  var SYNONYMS = {
    'temp':'temperature','temperatures':'temperature','cold':'refrigeration',
    'cooling':'refrigeration','freezing':'refrigeration','warm':'temperature',
    'alert':'alarm','alerts':'alarm','notification':'alarm',
    'offline':'connect','network':'connect','vpn':'connect','connection':'connect',
    'wifi':'connect','internet':'connect','disconnect':'connect',
    'fw':'firmware','update':'firmware','upgrade':'firmware','version':'firmware',
    'controller':'ctrl','e2':'gateway','e3':'gateway','e300':'gateway',
    'rack':'refrigeration','compressor':'refrigeration',
    'map':'floor','floorplan':'floor','remapping':'floor','custom screen':'floor',
    'part':'parts','xr':'xr75','xr-75':'xr75','serial':'license',
    'license key':'license','key':'license','activation':'license',
    'food safety':'haccp','probe':'haccp','sensor':'haccp',
    'problem':'error','issue':'error','broken':'error','fail':'error',
    'not working':'error','down':'offline','dead':'error',
    'password':'credentials','login':'credentials','access':'credentials',
    'report':'data','export':'data','log':'data','audit':'data',
    'walmart':'woolworths','supermarket':'woolworths',
    'configure':'programming','configuration':'programming','setup':'programming'
  };

  var Q_STRIP = [
    /^(how (do|can|to)|what (is|are)|where (is|can)|why (is|does)|when (do|does)|who (is|has)|is there|can i|should i)\s+/i,
    /\s*(please|help|need|want|looking for|trying to|how to)\s*/gi,
    /\s*\?+\s*$/g
  ];

  // ── State ──────────────────────────────────────────────────────────────────
  var _state = {
    allRecords: [],
    results:    [],
    query:      '',
    activeCat:  null,
    loaded:     false,
    loading:    false,
    detailIdx:  -1,
    deepData:   null,
    deepLoading:false,
    pendingQuery: '',
    qbQuery: '',
    qbQueryLoading: false,
    qbQueryReady: false,
    qbQuerySeq: 0,
    qbQueryResults: [],
    sortOrder:  'newest',
    monitor:    { sources:{}, total:0, warnings:[] }
  };
  var _se2Bookmarks = [];
  var _se2BookmarkFolders = [{ id: 'default', name: 'General', createdAt: new Date().toISOString() }];
  var _se2BookmarkSelectedFolder = 'default';
  var _se2BookmarksLoaded = false;
  var _se2BookmarksSaving = false;

  function _se2FolderName(folderId) {
    var f = _se2BookmarkFolders.find(function(x) { return x && x.id === folderId; });
    return f ? String(f.name || '') : 'General';
  }

  function _se2BookmarkId(record) {
    var src = record ? _getSource(record) : 'sr';
    var anchor = String(record && (record.case || record.caseNum || record.partNo || record.email || record.phone || record.title || record.site || record.res || '') || '').trim();
    if (!anchor) anchor = JSON.stringify(record || {});
    return src + '::' + anchor.toLowerCase();
  }

  function _se2EnsureDefaultFolder() {
    if (!_se2BookmarkFolders.some(function(f) { return f && f.id === 'default'; })) {
      _se2BookmarkFolders.unshift({ id: 'default', name: 'General', createdAt: new Date().toISOString() });
    }
  }

  function _se2NormalizeFolderId(folderId) {
    var id = String(folderId || '').trim();
    if (!id) return 'default';
    return _se2BookmarkFolders.some(function(f) { return f && f.id === id; }) ? id : 'default';
  }

  function _se2IsBookmarked(record) {
    var id = _se2BookmarkId(record);
    return _se2Bookmarks.some(function(b) { return b && b.bookmarkId === id; });
  }

  function _se2SanitizeBookmark(record) {
    var r = record && typeof record === 'object' ? record : {};
    return {
      bookmarkId: _se2BookmarkId(r),
      title: String(r.title || r.site || r.partNo || '(untitled)'),
      case: String(r.case || r.caseNum || ''),
      cat: String(r.cat || ''),
      source: String(_getSource(r)),
      status: String(r.status || ''),
      eu: String(r.eu || ''),
      res: String(r.res || r.notes || ''),
      partNo: String(r.partNo || ''),
      brand: String(r.brand || ''),
      site: String(r.site || ''),
      desc: String(r.desc || ''),
      folderId: 'default',
      createdAt: new Date().toISOString()
    };
  }

  function _se2RenderBookmarkButton(record) {
    var btn = el('se2-dh-bookmark-btn');
    if (!btn) return;
    var on = _se2IsBookmarked(record);
    btn.classList.toggle('active', on);
    btn.setAttribute('title', on ? 'Remove bookmark' : 'Save bookmark');
  }

  function _se2PersistBookmarks() {
    if (_se2BookmarksSaving) return;
    var token = _sessionToken();
    if (!token) return;
    _se2BookmarksSaving = true;
    fetch('/api/studio/se2_bookmarks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({
        folders: _se2BookmarkFolders.slice(0, 100),
        bookmarks: _se2Bookmarks.slice(0, 500)
      })
    })
      .catch(function(err) { console.warn('[SE2 bookmarks] save failed', err); })
      .finally(function() { _se2BookmarksSaving = false; });
  }

  function _se2FilteredBookmarks() {
    if (_se2BookmarkSelectedFolder === 'all') return _se2Bookmarks.slice();
    return _se2Bookmarks.filter(function(b) { return _se2NormalizeFolderId(b.folderId) === _se2BookmarkSelectedFolder; });
  }

  window._se2SetBookmarkFolderFilter = function(folderId) {
    _se2BookmarkSelectedFolder = _se2NormalizeFolderId(folderId || 'default');
    _se2RenderBookmarksPanel();
  };

  function _se2RenderFolderControls() {
    var host = document.getElementById('ci-bookmarks-folder-controls');
    if (!host) return;
    var options = ['<option value="all">All folders</option>'].concat(_se2BookmarkFolders.map(function(f) {
      return '<option value="' + esc(f.id) + '"' + (_se2BookmarkSelectedFolder === f.id ? ' selected' : '') + '>' + esc(f.name) + '</option>';
    }));

    host.innerHTML =
      '<select id="ci-bookmarks-folder-select" style="flex:1;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:6px;color:#e6edf3;font-size:10px;padding:4px 7px;">' + options.join('') + '</select>' +
      '<button id="ci-bookmarks-folder-add" style="background:rgba(63,185,80,.12);border:1px solid rgba(63,185,80,.28);border-radius:5px;color:#3fb950;font-size:10px;font-weight:700;padding:4px 7px;cursor:pointer;">+ Folder</button>' +
      '<button id="ci-bookmarks-folder-rename" style="background:rgba(88,166,255,.12);border:1px solid rgba(88,166,255,.28);border-radius:5px;color:#58a6ff;font-size:10px;font-weight:700;padding:4px 7px;cursor:pointer;">Rename</button>' +
      '<button id="ci-bookmarks-folder-delete" style="background:rgba(248,81,73,.08);border:1px solid rgba(248,81,73,.22);border-radius:5px;color:#f85149;font-size:10px;font-weight:700;padding:4px 7px;cursor:pointer;">Delete</button>';

    var sel = document.getElementById('ci-bookmarks-folder-select');
    if (sel) {
      sel.value = _se2BookmarkSelectedFolder;
      sel.onchange = function() {
        _se2BookmarkSelectedFolder = String(sel.value || 'all');
        _se2RenderBookmarksPanel();
      };
    }

    var addBtn = document.getElementById('ci-bookmarks-folder-add');
    if (addBtn) addBtn.onclick = function() {
      var name = prompt('Folder name');
      if (!name) return;
      name = String(name).trim();
      if (!name) return;
      var id = 'fld_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
      _se2BookmarkFolders.push({ id: id, name: name.slice(0, 60), createdAt: new Date().toISOString() });
      _se2BookmarkSelectedFolder = id;
      _se2RenderBookmarksPanel();
      _se2PersistBookmarks();
    };

    var renameBtn = document.getElementById('ci-bookmarks-folder-rename');
    if (renameBtn) renameBtn.onclick = function() {
      if (_se2BookmarkSelectedFolder === 'all' || _se2BookmarkSelectedFolder === 'default') {
        alert('Select a custom folder to rename.');
        return;
      }
      var folder = _se2BookmarkFolders.find(function(f) { return f && f.id === _se2BookmarkSelectedFolder; });
      if (!folder) return;
      var name = prompt('Rename folder', folder.name || '');
      if (!name) return;
      folder.name = String(name).trim().slice(0, 60) || folder.name;
      _se2RenderBookmarksPanel();
      _se2PersistBookmarks();
    };

    var delBtn = document.getElementById('ci-bookmarks-folder-delete');
    if (delBtn) delBtn.onclick = function() {
      if (_se2BookmarkSelectedFolder === 'all' || _se2BookmarkSelectedFolder === 'default') {
        alert('Select a custom folder to delete.');
        return;
      }
      var folderId = _se2BookmarkSelectedFolder;
      if (!confirm('Delete this folder? Bookmarks inside it will be moved to General.')) return;
      _se2BookmarkFolders = _se2BookmarkFolders.filter(function(f) { return f && f.id !== folderId; });
      _se2Bookmarks = _se2Bookmarks.map(function(b) {
        if (b && b.folderId === folderId) return Object.assign({}, b, { folderId: 'default' });
        return b;
      });
      _se2BookmarkSelectedFolder = 'all';
      _se2RenderBookmarksPanel();
      _se2PersistBookmarks();
    };
  }

  function _se2CloseBookmarkMenu() {
    var m = document.getElementById('ci-bookmark-item-menu');
    if (m) m.style.display = 'none';
  }

  window._se2MoveBookmarkToFolder = function(bookmarkId, folderId) {
    _se2Bookmarks = _se2Bookmarks.map(function(b) {
      if (b && b.bookmarkId === bookmarkId) return Object.assign({}, b, { folderId: _se2NormalizeFolderId(folderId) });
      return b;
    });
    _se2RenderBookmarksPanel();
    _se2PersistBookmarks();
    _se2CloseBookmarkMenu();
  };

  window._se2MoveBookmarkToFolderFromMenu = function(btn) {
    if (!btn) return;
    var bookmarkId = decodeURIComponent(String(btn.getAttribute('data-bookmark-id') || ''));
    var folderId = decodeURIComponent(String(btn.getAttribute('data-folder-id') || ''));
    if (!bookmarkId || !folderId) return;
    window._se2MoveBookmarkToFolder(bookmarkId, folderId);
  };

  window._se2OpenBookmarkItemMenu = function(evt, idx) {
    if (!evt) return;
    evt.preventDefault();
    var list = _se2FilteredBookmarks();
    var item = list[idx];
    if (!item) return;

    var menu = document.getElementById('ci-bookmark-item-menu');
    if (!menu) {
      menu = document.createElement('div');
      menu.id = 'ci-bookmark-item-menu';
      menu.style.position = 'fixed';
      menu.style.zIndex = '9800';
      menu.style.minWidth = '190px';
      menu.style.background = '#0d1117';
      menu.style.border = '1px solid rgba(255,255,255,.14)';
      menu.style.borderRadius = '8px';
      menu.style.boxShadow = '0 12px 28px rgba(0,0,0,.45)';
      menu.style.padding = '6px';
      menu.style.display = 'none';
      document.body.appendChild(menu);
      document.addEventListener('click', _se2CloseBookmarkMenu, true);
      window.addEventListener('resize', _se2CloseBookmarkMenu);
      window.addEventListener('scroll', _se2CloseBookmarkMenu, true);
    }

    var buttons = _se2BookmarkFolders.map(function(f) {
      var isActive = _se2NormalizeFolderId(item.folderId) === f.id;
      var bid = encodeURIComponent(String(item.bookmarkId || ''));
      var fid = encodeURIComponent(String(f.id || ''));
      return '<button data-bookmark-id="' + esc(bid) + '" data-folder-id="' + esc(fid) + '" onclick="window._se2MoveBookmarkToFolderFromMenu(this)" style="width:100%;text-align:left;background:' + (isActive ? 'rgba(88,166,255,.14)' : 'rgba(255,255,255,.03)') + ';border:1px solid ' + (isActive ? 'rgba(88,166,255,.35)' : 'rgba(255,255,255,.08)') + ';color:' + (isActive ? '#58a6ff' : '#c9d1d9') + ';font-size:11px;border-radius:6px;padding:6px 8px;cursor:pointer;margin-top:4px;">Move to: ' + esc(f.name) + '</button>';
    }).join('');

    menu.innerHTML =
      '<div style="font-size:10px;color:#7d8590;font-weight:700;letter-spacing:.05em;text-transform:uppercase;padding:3px 4px;">Move to folder</div>' +
      buttons;

    menu.style.left = Math.max(8, Math.min(window.innerWidth - 220, evt.clientX + 4)) + 'px';
    menu.style.top  = Math.max(8, Math.min(window.innerHeight - 240, evt.clientY + 4)) + 'px';
    menu.style.display = 'block';
  };

  function _se2RenderBookmarksPanel() {
    _se2EnsureDefaultFolder();
    var list = document.getElementById('ci-bookmarks-list');
    var count = document.getElementById('ci-bookmarks-count');
    var filtered = _se2FilteredBookmarks();
    if (count) count.textContent = _se2Bookmarks.length + ' saved';
    _se2RenderFolderControls();
    if (!list) return;
    if (!filtered.length) {
      list.innerHTML = '<div class="ss-empty-note" style="padding:8px 0;font-size:10px;">No bookmarks in this folder.</div>';
      return;
    }
    list.innerHTML = filtered.map(function(b, idx) {
      var src = SOURCES[b.source] || { label: 'Record', color: '#58a6ff' };
      var top = [b.case ? ('#' + b.case) : '', b.eu, b.cat].filter(Boolean).join(' · ');
      var folderName = _se2FolderName(_se2NormalizeFolderId(b.folderId));
      return '' +
        '<div class="ci-note-card" style="cursor:default;" oncontextmenu="window._se2OpenBookmarkItemMenu(event,' + idx + ')">' +
          '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:6px;">' +
            '<div style="min-width:0;flex:1;">' +
              '<div class="ci-note-time" style="margin-bottom:4px;display:flex;align-items:center;gap:6px;">' +
                '<span style="color:' + src.color + ';font-weight:700;">' + esc(src.label) + '</span>' +
                '<span style="font-size:9px;color:#7d8590;">📁 ' + esc(folderName) + '</span>' +
              '</div>' +
              '<div class="ci-note-caller" style="color:#e6edf3;">' + esc(b.title || '(untitled)') + '</div>' +
              (top ? ('<div style="font-size:10px;color:var(--ss-muted);margin-top:3px;line-height:1.4;">' + esc(top) + '</div>') : '') +
            '</div>' +
            '<div style="display:flex;gap:5px;">' +
              '<button onclick="window._se2OpenBookmark(' + idx + ')" style="background:rgba(88,166,255,.1);border:1px solid rgba(88,166,255,.25);border-radius:5px;color:#58a6ff;font-size:10px;font-weight:700;padding:3px 7px;cursor:pointer;font-family:var(--ss-font);">Open</button>' +
              '<button onclick="window._se2RemoveBookmarkByIndex(' + idx + ')" style="background:rgba(248,81,73,.08);border:1px solid rgba(248,81,73,.2);border-radius:5px;color:#f85149;font-size:10px;font-weight:700;padding:3px 7px;cursor:pointer;font-family:var(--ss-font);">Remove</button>' +
            '</div>' +
          '</div>' +
        '</div>';
    }).join('');
  }

  window._ssRenderBookmarks = _se2RenderBookmarksPanel;
  window._se2EnsureBookmarksLoaded = function() {
    if (_se2BookmarksLoaded) return Promise.resolve(_se2Bookmarks);
    var token = _sessionToken();
    if (!token) { _se2RenderBookmarksPanel(); return Promise.resolve(_se2Bookmarks); }
    return fetch('/api/studio/se2_bookmarks', { headers: { Authorization: 'Bearer ' + token } })
      .then(function(r) { return r.ok ? r.json() : Promise.reject(new Error('bookmarks_http_' + r.status)); })
      .then(function(j) {
        _se2BookmarkFolders = Array.isArray(j && j.folders) && j.folders.length ? j.folders : [{ id: 'default', name: 'General', createdAt: new Date().toISOString() }];
        _se2Bookmarks = Array.isArray(j && j.bookmarks) ? j.bookmarks : [];
        _se2EnsureDefaultFolder();
        _se2Bookmarks = _se2Bookmarks.map(function(b) {
          return Object.assign({}, b, { folderId: _se2NormalizeFolderId(b.folderId) });
        });
        _se2BookmarksLoaded = true;
        _se2RenderBookmarksPanel();
        _se2RenderBookmarkButton(_state.results[_state.detailIdx] || null);
        return _se2Bookmarks;
      })
      .catch(function(err) {
        console.warn('[SE2 bookmarks] load failed', err);
        _se2BookmarksLoaded = true;
        _se2RenderBookmarksPanel();
        return _se2Bookmarks;
      });
  };

  window._se2ToggleBookmarkFromDetail = function() {
    var record = _state.results[_state.detailIdx];
    if (!record) return;
    if (!_se2BookmarksLoaded) {
      window._se2EnsureBookmarksLoaded().then(function() { window._se2ToggleBookmarkFromDetail(); });
      return;
    }
    var id = _se2BookmarkId(record);
    var idx = _se2Bookmarks.findIndex(function(b) { return b && b.bookmarkId === id; });
    if (idx >= 0) _se2Bookmarks.splice(idx, 1);
    else _se2Bookmarks.unshift(_se2SanitizeBookmark(record));
    _se2RenderBookmarkButton(record);
    _se2RenderBookmarksPanel();
    _se2PersistBookmarks();
  };

  window._se2RemoveBookmarkByIndex = function(idx) {
    var filtered = _se2FilteredBookmarks();
    var target = filtered[idx];
    if (!target) return;
    _se2Bookmarks = _se2Bookmarks.filter(function(b) { return !(b && b.bookmarkId === target.bookmarkId); });
    _se2RenderBookmarksPanel();
    _se2RenderBookmarkButton(_state.results[_state.detailIdx] || null);
    _se2PersistBookmarks();
  };

  window._se2OpenBookmark = function(idx) {
    var filtered = _se2FilteredBookmarks();
    var rec = filtered[idx];
    if (!rec) return;
    if (typeof window.activateTab === 'function') window.activateTab('search_engine_2');
    var mapped = {
      title: rec.title || '(untitled)',
      case: rec.case || '',
      caseNum: rec.case || '',
      cat: rec.cat || '',
      status: rec.status || '',
      eu: rec.eu || '',
      res: rec.res || '',
      notes: rec.res || '',
      partNo: rec.partNo || '',
      brand: rec.brand || '',
      site: rec.site || '',
      desc: rec.desc || '',
      _src: rec.source || 'sr'
    };
    _state.results = [mapped];
    _state.detailIdx = 0;
    setTimeout(function() { window._se2OpenDetail(0); }, 50);
  };

  window._se2ToggleSort = function() {
    // Product decision: Search Engine 2 must always stay newest → oldest.
    _state.sortOrder = 'newest';
    var lbl = el('se2-sort-label');
    if (lbl) lbl.textContent = 'Newest first';
    _run();
  };

  // ── DOM helpers ────────────────────────────────────────────────────────────
  function el(id) { return document.getElementById(id); }
  function _ensureSe2SearchVisible() {
    var center = el('se2-center');
    if (!center) return;
    var hero = el('se2-hero');
    var wrap = el('se2-search-wrap');
    var filterRow = el('se2-filter-row');
    if (!hero) {
      hero = document.createElement('div');
      hero.id = 'se2-hero';
      hero.innerHTML =
        '<div id="se2-hero-icon">🔍</div>' +
        '<div id="se2-hero-title">Search Support Studio</div>' +
        '<div id="se2-hero-sub">Total indexed: <strong id="se2-hero-count">—</strong> records &mdash; type anything above to search across all data sources</div>';
      center.insertBefore(hero, center.firstChild || null);
    }
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'se2-search-wrap';
      wrap.innerHTML =
        '<i class="fas fa-search" style="color:#06b6d4;font-size:18px;flex-shrink:0;"></i>' +
        '<input id="se2-q" type="text" autocomplete="off" spellcheck="false" placeholder="Search support records, cases, parts, knowledge base..."/>' +
        '<span id="se2-ai-chip"><i class="fas fa-brain" style="font-size:9px;"></i> Smart</span>' +
        '<button class="se2-clear" id="se2-clear" onclick="window._se2Clear()">&#10005;</button>' +
        '<span id="se2-kbd">&#8984;K</span>';
      center.insertBefore(wrap, filterRow || null);
    }
    if (hero.nextElementSibling !== wrap) {
      center.insertBefore(wrap, hero.nextElementSibling);
    }

    // Permanent hardening: if any stale script/theme moves the bar or hides it,
    // pin it back to the canonical spot and force visibility.
    if (wrap.parentElement !== center) {
      center.insertBefore(wrap, filterRow || center.firstChild || null);
    } else if (filterRow && wrap.nextElementSibling !== filterRow) {
      center.insertBefore(wrap, filterRow);
    }
    wrap.style.display = 'flex';
    wrap.style.visibility = 'visible';
    wrap.style.opacity = '1';
    wrap.style.pointerEvents = 'auto';
  }
  function esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function _normalizeDateValue(raw) {
    var txt = String(raw || '').trim();
    if (!txt) return '';
    var d = new Date(txt);
    if (!isNaN(d.getTime())) return d.toISOString();
    var m = txt.match(/([A-Z]{3})-(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM))?/i);
    if (m) {
      var monthMap = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
      var mon = monthMap[String(m[1] || '').toLowerCase()];
      if (typeof mon === 'number') {
        var year = 2000 + Number(m[3] || 0);
        var hour = Number(m[4] || 0);
        var min = Number(m[5] || 0);
        var ap = String(m[6] || '').toUpperCase();
        if (ap === 'PM' && hour < 12) hour += 12;
        if (ap === 'AM' && hour === 12) hour = 0;
        var parsed = new Date(year, mon, Number(m[2] || 1), hour, min, 0, 0);
        if (!isNaN(parsed.getTime())) return parsed.toISOString();
      }
    }
    return '';
  }
  function hl(text, terms) {
    var s = esc(text);
    if (!terms || !terms.length) return s;
    terms.forEach(function(t) {
      if (!t || t.length < 2) return;
      try {
        var escaped = t.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
        s = s.replace(new RegExp('(' + escaped + ')', 'gi'), '<mark>$1</mark>');
      } catch(_) {}
    });
    return s;
  }

  // ── Source helpers ─────────────────────────────────────────────────────────
  function _getSource(record) {
    if (record && record._src && SOURCES[record._src]) return record._src;
    var g = CAT_MAP[(record && (record._id || record.id)) || ''];
    if (g && SOURCES[g]) return g;
    var cat = (record.cat || '').toLowerCase();
    if (cat.includes('knowledge') || cat.includes('guide') || cat.includes('manual')) return 'kb';
    if (cat.includes('part') || cat.includes('controller')) return 'parts';
    if (cat.includes('connect') || cat.includes('network')) return 'net';
    return 'sr';
  }

  function _toArray(maybe) {
    return Array.isArray(maybe) ? maybe : [];
  }

  function _extractBundleData(row) {
    if (!row) return [];
    if (Array.isArray(row)) return row;
    if (Array.isArray(row.data)) return row.data;
    if (Array.isArray(row.records)) return row.records;
    return [];
  }

  function _sessionToken() {
    try {
      var raw = localStorage.getItem('mums_supabase_session') || sessionStorage.getItem('mums_supabase_session');
      if (!raw) return '';
      var parsed = JSON.parse(raw);
      return parsed && parsed.access_token ? String(parsed.access_token) : '';
    } catch(_) { return ''; }
  }

  function _fetchBundleApi(bundleId) {
    var token = _sessionToken();
    var headers = token ? { Authorization:'Bearer ' + token } : {};
    return fetch('/api/studio/cache_bundle?bundle=' + encodeURIComponent(bundleId), { headers: headers })
      .then(function(r) { return r.ok ? r.json() : Promise.reject(new Error('bundle_http_' + r.status)); })
      .then(function(j) { return (j && j.ok) ? _extractBundleData(j.records || j.data || []) : []; })
      .catch(function() { return []; });
  }

  function _loadBundleRecords(bundleId, seedRecords) {
    var seeded = _toArray(seedRecords);
    if (seeded.length) return Promise.resolve(seeded);
    if (window.StudioCache && typeof window.StudioCache.getBundle === 'function') {
      return window.StudioCache.getBundle(bundleId)
        .then(function(row) {
          var fromCache = _extractBundleData(row);
          if (fromCache.length) return fromCache;
          return _fetchBundleApi(bundleId);
        })
        .catch(function() { return _fetchBundleApi(bundleId); });
    }
    return _fetchBundleApi(bundleId);
  }

  function _rowValueByRegex(row, regexes) {
    var obj = (row && typeof row === 'object') ? row : {};
    var keys = Object.keys(obj);
    for (var i = 0; i < regexes.length; i++) {
      var rx = regexes[i];
      var key = keys.find(function(k) { return rx.test(String(k || '')); });
      if (key) {
        var val = String(obj[key] || '').trim();
        if (val) return val;
      }
    }
    return '';
  }

  function _rowSearchBlob(row) {
    var obj = (row && typeof row === 'object') ? row : {};
    return Object.keys(obj).map(function(k) { return obj[k]; }).filter(function(v) {
      return v != null && String(v).trim() !== '';
    }).join(' · ');
  }

  function _parseSimpleCsvObjects(text) {
    var rows = [];
    var cur = '';
    var inQ = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (ch === '"') {
        if (inQ && text[i + 1] === '"') { cur += '"'; i++; continue; }
        inQ = !inQ;
        continue;
      }
      if (ch === '\n' && !inQ) { rows.push(cur); cur = ''; continue; }
      if (ch === '\r' && !inQ) continue;
      cur += ch;
    }
    if (cur) rows.push(cur);
    if (!rows.length) return [];

    function parseLine(line) {
      var out = [];
      var cell = '';
      var q = false;
      for (var j = 0; j < line.length; j++) {
        var c = line[j];
        if (c === '"') {
          if (q && line[j + 1] === '"') { cell += '"'; j++; }
          else q = !q;
        } else if (c === ',' && !q) {
          out.push(cell.trim());
          cell = '';
        } else {
          cell += c;
        }
      }
      out.push(cell.trim());
      return out;
    }

    var header = parseLine(rows[0]);
    var mapped = [];
    for (var r = 1; r < rows.length; r++) {
      var line = rows[r];
      if (!line || !line.trim()) continue;
      var cols = parseLine(line);
      var obj = {};
      for (var h = 0; h < header.length; h++) obj[header[h]] = cols[h] || '';
      mapped.push(obj);
    }
    return mapped;
  }

  function _loadContactInformationRecords(seedRecords) {
    var seeded = _toArray(seedRecords);
    if (seeded.length) return Promise.resolve(seeded);
    var cachePromise = (window.StudioCache && typeof window.StudioCache.getBundle === 'function')
      ? window.StudioCache.getBundle('contact_information')
          .then(function(row) { return _extractBundleData(row); })
          .catch(function() { return []; })
      : Promise.resolve([]);

    return cachePromise.then(function(fromCache) {
      if (Array.isArray(fromCache) && fromCache.length) return fromCache;
      var csvUrl = String(window._ctiCsvUrl || '').trim();
      if (!csvUrl) {
        try {
          var raw = localStorage.getItem('ss_contact_information_settings');
          if (raw) {
            var cfg = JSON.parse(raw);
            csvUrl = String((cfg && cfg.csvUrl) || '').trim();
          }
        } catch (_) {}
      }
      if (!csvUrl) return [];
      return fetch(csvUrl, { cache: 'no-store' })
        .then(function(resp) {
          return resp.ok ? resp.text() : Promise.reject(new Error('contact_csv_http_' + resp.status));
        })
        .then(function(text) { return _parseSimpleCsvObjects(text); })
        .catch(function() { return []; });
    });
  }

  function _mapGenericRecords(records, src, cat) {
    return _toArray(records).map(function(r) {
      var keys = Object.keys(r || {});
      var title = String(r.title || r.name || r.site || r.partNo || r.part_number || r.email || r.phone || r.id || '(record)');
      var text = keys.map(function(k) { return r[k]; }).join(' · ');
      return { _src: src || 'sr', title: title, res: text.slice(0, 480), cat: cat || 'Support Records', _raw: r };
    });
  }

  function _mapSupportRecords(records, forcedSrc) {
    return _toArray(records).map(function(r) {
      var resolved = forcedSrc || 'sr';
      if (!SOURCES[resolved]) resolved = 'sr';
      return Object.assign({}, r, { _id: r.id, _src: resolved });
    });
  }

  function _sourceFromStoreKey(key) {
    var k = String(key || '').toLowerCase();
    if (k.includes('qb')) return 'qb';
    if (k.includes('cp') || k.includes('connect')) return 'net';
    if (k.includes('part')) return 'parts';
    if (k.includes('contact') || k.includes('ci')) return 'ci';
    if (k.includes('controller') || k.includes('product')) return 'ctrl';
    if (k.includes('knowledge') || k.includes('kb')) return 'kb';
    if (k.includes('support') || k.includes('sr')) return 'sr';
    return 'sr';
  }

  function _collectFutureTabRecords() {
    var out = [];
    var known = {
      __studioCpRecords:1, __studioPnRecords:1, __studioCiRecords:1,
      __studioQbRecords:1, __studioSrRecords:1, __se2ConnectData:1, __se2PartsData:1
    };
    Object.keys(window).forEach(function(k) {
      if (known[k]) return;
      if (!/^__studio.*Records$/i.test(k)) return;
      var arr = window[k];
      if (!Array.isArray(arr) || !arr.length) return;
      var cat = k.replace(/^__studio/i, '').replace(/Records$/i, '').replace(/_/g, ' ').trim() || 'Support Records';
      out = out.concat(_mapGenericRecords(arr, _sourceFromStoreKey(k), cat));
    });
    return out;
  }

  // ── Query engine ───────────────────────────────────────────────────────────
  // NOISE TOKENS: carry minimal signal — suppress from scoring to prevent false positives
  var SE2_NOISE_TOKENS = new Set([
    'part','number','parts','numbers','type','model','unit','item','product',
    'controller','control','system','device','equipment','serial','code',
    'information','info','details','data','record','report','list','catalog',
    'request','inquiry','question','support','service','case','ticket',
    'replacement','upgrade','update','version','new','old','latest'
  ]);
  // PART NUMBER pattern — alphanumeric codes like XR77, 845-1300, XBL650BQB100
  var SE2_PART_NO_RX = /^[A-Za-z]{1,6}[\-\d][\w\-]{2,}$|^\d{3,4}[-\s]\d{3,4}$|^[A-Za-z]\d{3,}$|^[A-Za-z]{2,4}\d{2,4}$/;
  // Question-prefix strip (more thorough than Q_STRIP)
  var SE2_Q_PREFIX_RX = /^(?:how\s+(?:do|can|to|does|would|should)\s+|what\s+(?:is|are|was|were|does|do)\s+|where\s+(?:is|can|do|are)\s+|why\s+(?:is|does|do|did)\s+|who\s+(?:is|has|can)\s+|is\s+there\s+|can\s+(?:i|you)\s+|should\s+i\s+|do\s+you\s+(?:have|know)\s+)/i;

  function _normaliseQuery(raw) {
    var q = String(raw || '').trim();
    // Strip question prefixes first (BUG FIX: "what is xr77" → "xr77")
    q = q.replace(SE2_Q_PREFIX_RX, '').trim();
    // Then apply original Q_STRIP patterns
    Q_STRIP.forEach(function(rx) { q = q.replace(rx, ' '); });
    q = q.trim();

    // Detect part-number codes in the query (BUG FIX: route to parts mode)
    var rawWords = q.toLowerCase().split(/\s+/).filter(Boolean);
    var isPartNoQuery = rawWords.some(function(w) { return SE2_PART_NO_RX.test(w); });
    var partNoCodes = rawWords.filter(function(w) { return SE2_PART_NO_RX.test(w); });

    // Build tokens — exclude stop words and noise tokens
    var stopSet = new Set(['the','a','an','is','are','was','were','to','for','in','on','of','and','or',
      'but','not','with','this','that','from','by','at','be','been','have','has','had',
      'do','does','did','will','would','could','should','may','might','can','its','it','as',
      'so','if','then','than','when','where','how','what','which','who','there','their',
      'they','them','our','your','we','us','i','my','me','he','she','his','her','him',
      'about','after','before','also','any','some','all','more','most','just','up','out',
      'get','got','per','find','search','show','tell','give','explain','list',
      'paano','pano','saan','bakit','ano','ang','mga','yung','sa','ng','ni','na',
      'please','pls','paki','kasi','daw','raw','help','fix','resolve','issue','error','problem']);

    var tokens = rawWords.filter(function(w) {
      return w.length >= 2 && !stopSet.has(w);
    });

    // Expand tokens with synonyms — skip noise expansion
    var expanded = tokens.slice();
    tokens.forEach(function(w) {
      if (SYNONYMS[w] && !SE2_NOISE_TOKENS.has(w)) {
        var syn = SYNONYMS[w];
        if (typeof syn === 'string') expanded.push(syn);
      }
    });
    // Put part-number codes at front of expanded list for priority scoring
    if (partNoCodes.length) {
      partNoCodes.forEach(function(code) {
        if (expanded.indexOf(code) < 0) expanded.unshift(code);
      });
    }

    return {
      original: q,
      tokens: Array.from(new Set(expanded.filter(Boolean))),
      isNumeric: /^\d{4,}$/.test(q.trim()),
      isPartNoQuery: isPartNoQuery,
      partNoCodes: partNoCodes
    };
  }

  function _normLoose(v) {
    return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  }

  function _toNewestRank(r) {
    var idx = _ensureRecordIndex(r);
    var d = idx.newestRank || 0;
    if (d > 0) return d;
    d = new Date((r && r.date) || 0).getTime() || 0;
    if (d > 0) return d;
    var n = Number((r && (r.case || r.id || (r._snap && r._snap.recordId))) || 0) || 0;
    return n;
  }

  function _ensureRecordIndex(r) {
    if (!r || typeof r !== 'object') {
      return {
        haystack: '', normHaystack: '', titleHay: '', normTitle: '',
        phoneDigitHay: '', emailHay: '', newestRank: 0
      };
    }
    if (r.__se2idx) return r.__se2idx;
    var titleHay = String(r.title || '').toLowerCase();
    var haystack = [
      r.title || '', r.res || '', r.cat || '',
      r.case || '', r.eu || '', r.id || '',
      r.site || '', r.directory || '', r.endUser || '', r.assignedTo || '',
      r.searchBlob || '', r.partNo || '', r.desc || '', r.brand || ''
    ].join(' ').toLowerCase();
    var newestRank = new Date((r && r.date) || 0).getTime() || 0;
    if (!newestRank) newestRank = Number((r && (r.case || r.id || (r._snap && r._snap.recordId))) || 0) || 0;
    r.__se2idx = {
      titleHay: titleHay,
      normTitle: _normLoose(titleHay),
      haystack: haystack,
      normHaystack: _normLoose(haystack),
      phoneDigitHay: String([r.phone || '', r.title || '', r.res || '', r.searchBlob || ''].join(' ')).replace(/\D+/g, ''),
      emailHay: String([r.email || '', r.title || '', r.res || '', r.searchBlob || ''].join(' ')).toLowerCase().replace(/[^a-z0-9]+/g, ''),
      newestRank: newestRank
    };
    return r.__se2idx;
  }

  function _scoreRecord(r, parsed) {
    var tokens = parsed.tokens;
    var original = parsed.original.toLowerCase();
    var idx = _ensureRecordIndex(r);
    var haystack = idx.haystack;
    var normHaystack = idx.normHaystack;
    var normOriginal = _normLoose(original);
    var phoneDigits = String(original || '').replace(/\D+/g, '');

    // Structured phone query path (e.g., +1(954)553-5645):
    // require contiguous digit match to prevent broad fuzzy hits.
    if (!/[a-z]/i.test(original) && phoneDigits.length >= 7) {
      var digitHay = idx.phoneDigitHay;
      var candidates = [phoneDigits];
      if (phoneDigits.length === 11 && phoneDigits.charAt(0) === '1') candidates.push(phoneDigits.slice(1));
      if (phoneDigits.length >= 10) candidates.push(phoneDigits.slice(-10));
      var okPhone = candidates.some(function(c) { return c && digitHay.indexOf(c) !== -1; });
      return okPhone ? 15000 : 0;
    }

    // Structured email query path: punctuation-insensitive exact containment.
    if (original.indexOf('@') !== -1) {
      var emailNeedle = String(original || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
      var emailHay = idx.emailHay;
      return (emailNeedle && emailHay.indexOf(emailNeedle) !== -1) ? 14000 : 0;
    }

    if (parsed.isNumeric && (r.case === parsed.original || r.id === parsed.original)) return 10000;

    var score = 0;
    var titleHay = idx.titleHay;
    var normTitle = idx.normTitle;
    // BUG FIX (2026-04-09): Part-number exact-match scoring
    // When query has alphanumeric part codes (e.g. "xr77"), exact-match the title.
    // Non-parts records get 0.08x multiplier so they don't pollute the results.
    if (parsed.isPartNoQuery) {
      var isPartsRec = String(r._src || '') === 'parts' ||
        String(r._id || r.id || '').startsWith('parts_') ||
        String(r.cat || '').toLowerCase().includes('part');
      var partScore = 0;
      (parsed.partNoCodes || []).forEach(function(code) {
        var codeNorm = code.toLowerCase().replace(/[^a-z0-9]/g, '');
        var titleNorm = titleHay.replace(/[^a-z0-9]/g, '');
        if (titleHay === code || titleHay.startsWith(code + ' ') || titleHay.endsWith(' ' + code)) {
          partScore += 10000;
        } else if (titleNorm.startsWith(codeNorm) || titleNorm.includes(codeNorm)) {
          partScore += 5000;
        } else if (haystack.includes(code)) {
          partScore += isPartsRec ? 500 : 10;
        }
      });
      if (partScore === 0 && !isPartsRec) return 0;
      if (!isPartsRec) partScore *= 0.08;
      return partScore;
    }

    // Standard keyword scoring
    if (titleHay.includes(original)) score += 500;
    else if (haystack.includes(original)) score += 200;
    else if (normOriginal && (normTitle.includes(normOriginal) || normHaystack.includes(normOriginal))) score += 220;

    tokens.forEach(function(t) {
      if (t.length < 2) return;
      // BUG FIX: Noise tokens get minimal weight
      var noiseW = SE2_NOISE_TOKENS.has(t) ? 0.05 : 1.0;
      var normT = _normLoose(t);
      if (titleHay.includes(t) || (normT && normTitle.includes(normT))) score += 80 * noiseW;
      else if (haystack.includes(t) || (normT && normHaystack.includes(normT))) score += 20 * noiseW;
      if (titleHay.startsWith(t) || (normT && normTitle.startsWith(normT))) score += 40 * noiseW;
    });

    return score;
  }

  function _search(query) {
    var parsed = _normaliseQuery(query);
    if (!parsed.tokens.length && !parsed.original) return [];
    var qKey = String(query || '').trim().toLowerCase();
    var hasLiveQb = qKey && _state.qbQuery === qKey && Array.isArray(_state.qbQueryResults);
    var results = [];
    _state.allRecords.forEach(function(r) {
      if (hasLiveQb && _getSource(r) === 'qb') return;
      var score = _scoreRecord(r, parsed);
      if (score > 0) results.push({ r: r, score: score });
    });
    if (hasLiveQb) {
      _state.qbQueryResults.forEach(function(r) {
        var score = _scoreRecord(r, parsed);
        if (score > 0) results.push({ r: r, score: score + 5 });
      });
    }
    // BUG FIX: Sort by score for part-number queries to surface exact matches
    if (parsed.isPartNoQuery) {
      results.sort(function(a, b) { return b.score - a.score; });
    }
    return results.map(function(x) { return x.r; });
  }

  // ── Counts ─────────────────────────────────────────────────────────────────
  function _countsByCat(records) {
    var c = {};
    Object.keys(SOURCES).forEach(function(k) { c[k] = 0; });
    (records || _state.allRecords).forEach(function(r) { var s = _getSource(r); c[s] = (c[s]||0) + 1; });
    return c;
  }

  // ── Render category strip ──────────────────────────────────────────────────
  // FIX BUG 1+5: No more inline onclick with unquoted variables.
  // Use data-src attributes + delegated listener on container.
  // ── Source icon map for metric cards ──
  var METRIC_ICONS = {
    qb:    { icon:'fa-bolt',         color:'#58a6ff', bg:'rgba(88,166,255,.12)',   change:'↑ 12% this week' },
    kb:    { icon:'fa-book',         color:'#10b981', bg:'rgba(16,185,129,.12)',   change:'↑ 5% this week'  },
    parts: { icon:'fa-barcode',      color:'#f59e0b', bg:'rgba(245,158,11,.12)',   change:'↑ 8% this week'  },
    ctrl:  { icon:'fa-microchip',    color:'#a78bfa', bg:'rgba(167,139,250,.12)',  change:'↑ 3% this week'  },
    net:   { icon:'fa-plug',         color:'#22d3ee', bg:'rgba(34,211,238,.12)',   change:'↑ 6% this week'  },
    ci:    { icon:'fa-address-book', color:'#8b5cf6', bg:'rgba(139,92,246,.12)',   change:'↑ 15% this week' },
    sr:    { icon:'fa-book-open',    color:'#f43f5e', bg:'rgba(244,63,94,.12)',    change:'↑ 2% this week'  },
  };

  function _renderCats(counts) {
    var total = _state.allRecords.length;
    var hasQ  = !!(_state.query && _state.query.trim());

    // ── Stats grid: large metric cards (no search) / compact (searching) ──
    var grid = el('se2-stats-grid');
    if (grid) {
      // UX update: left sidebar already contains source result bars;
      // remove center result cards to reduce visual noise.
      grid.style.display = 'none';
      grid.innerHTML = '';
    }

    // ── Left panel source chips: update counts + active state ──
    var srcIds = { qb:'qb', qbd:'qbd', kb:'kb', parts:'parts', ctrl:'ctrl', net:'net', ci:'ci', sr:'sr' };
    Object.keys(srcIds).forEach(function(key) {
      var countEl = el('se2-lp-' + key);
      if (countEl) {
        var n = counts ? (counts[key]||0) : 0;
        countEl.textContent = (typeof n === 'number') ? n.toLocaleString() : '—';
      }
    });
    // Update total
    var totalEl = el('se2-lp-total');
    if (totalEl) totalEl.textContent = total > 0 ? total.toLocaleString() : '—';

    // Active state on left panel chips
    document.querySelectorAll('.se2-src-chip').forEach(function(chip) {
      var s2 = chip.getAttribute('data-src2');
      var isActive2 = (s2 === 'all' && !_state.activeCat) || (s2 === _state.activeCat);
      chip.classList.toggle('active', !!isActive2);
    });

    // Auto-sort Data Source chips when searching: highest counts first.
    var srcWrap = el('se2-lp-sources');
    if (srcWrap) {
      var allChip = srcWrap.querySelector('.se2-src-chip[data-src2="all"]');
      var chips = Array.from(srcWrap.querySelectorAll('.se2-src-chip')).filter(function(chip) {
        return chip.getAttribute('data-src2') !== 'all';
      });
      var defaultOrder = ['qb','qbd','kb','parts','ctrl','net','ci','sr'];
      chips.sort(function(a, b) {
        var ak = a.getAttribute('data-src2') || '';
        var bk = b.getAttribute('data-src2') || '';
        if (hasQ) {
          var ac = Number((counts && counts[ak]) || 0);
          var bc = Number((counts && counts[bk]) || 0);
          if (_state.activeCat && ak === _state.activeCat && bk !== _state.activeCat) return -1;
          if (_state.activeCat && bk === _state.activeCat && ak !== _state.activeCat) return 1;
          if (bc !== ac) return bc - ac;
          var al = (SOURCES[ak] && (SOURCES[ak].shortLabel || SOURCES[ak].label)) || ak;
          var bl = (SOURCES[bk] && (SOURCES[bk].shortLabel || SOURCES[bk].label)) || bk;
          return String(al).localeCompare(String(bl));
        }
        return defaultOrder.indexOf(ak) - defaultOrder.indexOf(bk);
      });
      chips.forEach(function(chip) { srcWrap.appendChild(chip); });
      if (allChip) srcWrap.insertBefore(allChip, srcWrap.firstChild);
    }

    // ── Hero section: show/hide + update count ──
    var hero = el('se2-hero');
    if (hero) hero.style.display = hasQ ? 'none' : 'flex';
    var heroCount = el('se2-hero-count');
    if (heroCount && total > 0) heroCount.textContent = total.toLocaleString();

    // ── Status bar ──
    var sbIndexed = el('se2-sb-indexed');
    if (sbIndexed) sbIndexed.textContent = total > 0 ? total.toLocaleString() : '—';
    var sbStatus = el('se2-sb-status');
    if (sbStatus) {
      sbStatus.textContent = _state.loaded ? ('Indexed ' + Object.keys(SOURCES).length + ' sources · Ready') : 'Loading sources…';
    }
    var healthSub = el('se2-health-sub');
    if (healthSub) {
      healthSub.textContent = _state.loaded ? (total.toLocaleString() + ' records indexed') : 'Loading…';
    }

    // Filter tab row (visible during search)
    var filterRow = el('se2-filter-row');
    if (filterRow) {
      var q = _state.query.trim();
      if (q) {
        filterRow.style.display = 'flex';
        var totalN = counts ? Object.values(counts).reduce(function(a,b){return a+b;},0) : 0;
        var allBtn = '<button class="se2-filter-btn ' + (!_state.activeCat ? 'active' : 'inactive') + '" data-se2-filter="all"' +
          (!_state.activeCat ? ' style="background:rgba(88,166,255,.18);border-color:rgba(88,166,255,.35);color:#fff;"' : '') + '>' +
          '<i class="fas fa-layer-group" style="font-size:10px;"></i> All' +
          (totalN > 0 ? '<span class="se2-filter-count">' + totalN.toLocaleString() + '</span>' : '') + '</button>';
        var tabBtns = Object.keys(SOURCES).map(function(key) {
          var src = SOURCES[key]; var n = counts ? (counts[key]||0) : 0; if (!n) return '';
          var isA = _state.activeCat === key;
          return '<button class="se2-filter-btn ' + (isA ? 'active' : 'inactive') + '" data-se2-filter="' + esc(key) + '"' +
            (isA ? ' style="background:' + src.color + '22;border-color:' + src.color + '55;color:' + src.color + ';"' : '') + '>' +
            '<i class="fas ' + src.icon + '" style="font-size:10px;"></i> ' + esc(src.shortLabel || src.label) +
            '<span class="se2-filter-count">' + n.toLocaleString() + '</span></button>';
        }).filter(Boolean).join('');
        filterRow.innerHTML = allBtn + tabBtns;
        filterRow.onclick = function(e) {
          var btn = e.target.closest('.se2-filter-btn');
          if (!btn) return;
          var f = btn.getAttribute('data-se2-filter');
          window._se2FilterCat(f === 'all' ? null : f);
        };
      } else {
        filterRow.style.display = 'none';
      }
    }
  }

  // ── Render suggestion chips ────────────────────────────────────────────────
  // FIX BUG 1: Use data-q attribute + delegated listener
  function _renderChips() {
    var row = el('se2-chip-row');
    if (!row) return;
    row.innerHTML = SE2_CHIPS.map(function(c) {
      return '<div class="se2-chip" data-q="' + esc(c) + '">' + esc(c) + '</div>';
    }).join('');
    // FIX: delegated listener, no inline onclick
    row.onclick = function(e) {
      var chip = e.target.closest('.se2-chip');
      if (chip) window._se2SetQ(chip.getAttribute('data-q'));
    };
  }

  // ── Render results ─────────────────────────────────────────────────────────
  function _renderResults(results, tokens) {
    var body = el('se2-body');
    if (!body) return;
    if (!results.length) {
      body.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:280px;gap:14px;text-align:center;padding:30px;">' +
        '<div style="width:64px;height:64px;border-radius:18px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);display:grid;place-items:center;font-size:26px;margin-bottom:4px;">&#128269;</div>' +
        '<div style="font-size:18px;font-weight:800;color:#e6edf3;">No results found</div>' +
        '<div style="font-size:12px;color:#7d8590;max-width:360px;line-height:1.65;">Try different keywords, partial words, or a case number.</div>' +
        (_state.allRecords.length === 0 ? '<div style="margin-top:6px;font-size:11px;color:#f85149;">Data not loaded &mdash; check network.</div>' : '') + '</div>';
      return;
    }
    var grouped = {};
    results.forEach(function(r) { var s2 = _getSource(r); if (!grouped[s2]) grouped[s2]=[]; grouped[s2].push(r); });
    var LIMIT = 50;
    var html = '';
    ['qb','qbd','parts','ctrl','net','kb','ci','sr'].forEach(function(key) {
      var rows = grouped[key]; if (!rows || !rows.length) return;
      var src = SOURCES[key];
      html += '<div class="se2-group" style="color:' + src.color + ';">' +
        '<span class="se2-group-dot" style="background:' + src.color + ';box-shadow:0 0 6px ' + src.color + '66;"></span>' +
        esc(src.label) + ' <span class="se2-group-count">' + rows.length.toLocaleString() + '</span>' +
        (rows.length > LIMIT ? '<span style="font-size:9px;opacity:.45;margin-left:4px;">showing ' + LIMIT + '</span>' : '') + '</div>';
      rows.slice(0, LIMIT).forEach(function(r) {
        var gi = results.indexOf(r);
        // BUG FIX: For parts records, show brand + type in meta; use desc as body
        var isParts = String(r._src || '') === 'parts' || String(r._id || r.id || '').startsWith('parts_');
        var titleHl = hl(r.title || r.site || r.partNo || '(no title)', tokens);
        var bodyText = isParts
          ? ([r.brand, r.cat, r.desc].filter(Boolean).join(' · ') || r.res || '').slice(0, 200)
          : (r.res || r.desc || r.notes || r.directory || '').slice(0, 280);
        var bodyHl = hl(bodyText, tokens);
        var caseNum = r.case || r.caseNum || '';
        var endUser = r.eu || r.endUser || r.directory || '';
        var age = r.age || '';
        var brandChip = (isParts && r.brand) ? '<span class="se2-eu-chip" style="color:#f59e0b;background:rgba(245,158,11,.1);border-color:rgba(245,158,11,.2);"><i class="fas fa-tag" style="font-size:8px;margin-right:3px;"></i>' + esc(r.brand) + '</span>' : '';
        html += '<div class="se2-card" data-se2-idx="' + gi + '" style="animation:se2CardIn .22s ease both;animation-delay:' + Math.min(gi*12,350) + 'ms;">' +
          '<div class="se2-card-meta">' +
            '<span class="se2-badge" style="color:' + src.color + ';background:' + src.color + '1a;border:1px solid ' + src.color + '33;">' +
              '<i class="fas ' + src.icon + '" style="font-size:8px;margin-right:3px;"></i>' + esc(src.shortLabel || src.label) + '</span>' +
            (caseNum ? '<span class="se2-case-num">#' + hl(caseNum, tokens) + '</span>' : '') +
            brandChip +
            (endUser && !isParts ? '<span class="se2-eu-chip"><i class="fas fa-user" style="font-size:8px;margin-right:3px;"></i>' + hl(endUser, tokens) + '</span>' : '') +
            (age ? '<span class="se2-age-chip" style="margin-left:auto;">' + esc(age) + '</span>' : '') +
          '</div>' +
          '<div class="se2-card-title">' + titleHl + '</div>' +
          (bodyText ? '<div class="se2-card-body">' + bodyHl + '</div>' : '') +
          '<button class="se2-view-btn" data-se2-view="' + gi + '">View Details &rarr;</button></div>';
      });
    });
    body.innerHTML = html;
    body.onclick = function(e) {
      var vb = e.target.closest('[data-se2-view]');
      if (vb) { e.stopPropagation(); window._se2OpenDetail(parseInt(vb.getAttribute('data-se2-view'),10)); return; }
      var card = e.target.closest('.se2-card');
      if (card) window._se2OpenDetail(parseInt(card.getAttribute('data-se2-idx'),10));
    };
  }

  // ── Summary bar ────────────────────────────────────────────────────────────
  function _renderSummary(results, query) {
    var s = el('se2-summary-text') || el('se2-summary');
    if (!s) return;
    if (!query) {
      s.innerHTML = _state.allRecords.length > 0
        ? 'Total indexed: <strong>' + _state.allRecords.length.toLocaleString() + '</strong> records &nbsp;&middot;&nbsp; Ready to search'
        : (_state.loading ? '<span style="color:#58a6ff;">Loading data sources&hellip;</span>' : 'Ready &mdash; type to search across all sources');
      var mon = _state.monitor || {};
      if (mon.total && mon.total > 0) {
        s.innerHTML += ' &nbsp;&middot;&nbsp; <span style="font-size:10px;color:#7d8590;">Monitor: ' + mon.total.toLocaleString() + ' loaded</span>';
      }
    } else {
      var parsed = _normaliseQuery(query);
      var aiOn = parsed.tokens.length > parsed.original.split(' ').length;
      var primarySource = '';
      var ranked = Object.keys(SOURCES).map(function(k) {
        return { key: k, n: Number((_countsByCat(results)[k]) || 0) };
      }).filter(function(x) { return x.n > 0; }).sort(function(a, b) { return b.n - a.n; });
      if (ranked.length) {
        var top = ranked[0];
        var srcTop = SOURCES[top.key] || {};
        primarySource = '<span style="font-size:10px;color:#9ca3af;">Top Source</span>' +
          '<span style="font-size:12px;font-weight:800;color:' + esc(srcTop.color || '#c9d1d9') + ';">' +
          esc(srcTop.shortLabel || srcTop.label || top.key) + ' · ' + top.n.toLocaleString() + '</span>';
      } else {
        primarySource = '<span style="font-size:10px;color:#9ca3af;">Top Source</span><span style="font-size:12px;font-weight:800;color:#c9d1d9;">—</span>';
      }
      s.innerHTML =
        '<div style="display:grid;grid-template-columns:repeat(3,minmax(140px,1fr));gap:8px;align-items:stretch;">' +
          '<div style="padding:8px 10px;border-radius:10px;background:rgba(56,189,248,.08);border:1px solid rgba(56,189,248,.24);display:flex;flex-direction:column;gap:2px;">' +
            '<span style="font-size:10px;color:#7dd3fc;">Found</span>' +
            '<span style="font-size:18px;font-weight:900;color:#e6edf3;line-height:1;">' + results.length.toLocaleString() + '</span>' +
          '</div>' +
          '<div style="padding:8px 10px;border-radius:10px;background:rgba(99,102,241,.08);border:1px solid rgba(99,102,241,.24);display:flex;flex-direction:column;gap:2px;min-width:0;">' +
            '<span style="font-size:10px;color:#a5b4fc;">Query</span>' +
            '<span style="font-size:12px;font-weight:800;color:#e6edf3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(parsed.original) + '</span>' +
          '</div>' +
          '<div style="padding:8px 10px;border-radius:10px;background:rgba(16,185,129,.08);border:1px solid rgba(16,185,129,.24);display:flex;flex-direction:column;gap:2px;">' +
            primarySource +
          '</div>' +
        '</div>' +
        (aiOn ? '<div style="margin-top:6px;font-size:10px;color:#c084fc;">Smart query expansion active</div>' : '');
      var chip = el('se2-ai-chip');
      if (chip) chip.classList.toggle('on', aiOn);
    }
  }

  function _renderLoadingWidget(msg) {
    var body = el('se2-body');
    if (!body) return;
    var label = esc(msg || 'Loading all data sources…');
    body.innerHTML =
      '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:260px;gap:16px;text-align:center;">' +
        '<div style="position:relative;width:76px;height:76px;border-radius:50%;border:1px solid rgba(6,182,212,.25);background:radial-gradient(circle at 30% 30%, rgba(6,182,212,.22), rgba(6,182,212,.04));display:grid;place-items:center;box-shadow:0 0 0 8px rgba(6,182,212,.05),0 0 40px rgba(59,130,246,.18);">' +
          '<div class="se2-spin" style="width:24px;height:24px;border:2px solid rgba(6,182,212,.25);border-top-color:#22d3ee;border-radius:50%;"></div>' +
        '</div>' +
        '<div style="font-size:13px;font-weight:700;color:#7dd3fc;letter-spacing:.01em;">' + label + '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(4,minmax(90px,1fr));gap:8px;width:min(620px,92%);">' +
          Object.keys(SOURCES).map(function(key) {
            var src = SOURCES[key] || {};
            return '<div style="padding:7px 8px;border-radius:8px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);display:flex;align-items:center;justify-content:space-between;gap:8px;">' +
              '<span style="font-size:10px;color:#cbd5e1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(src.shortLabel || src.label || key) + '</span>' +
              '<span style="width:7px;height:7px;border-radius:50%;background:' + esc(src.color || '#22d3ee') + ';box-shadow:0 0 0 4px rgba(34,211,238,.14);animation:se2pulse 1.4s ease-in-out infinite;"></span>' +
            '</div>';
          }).join('') +
        '</div>' +
      '</div>';
  }

  // ── Main run ───────────────────────────────────────────────────────────────
  function _run() {
    _ensureSe2SearchVisible();

    var q = _state.query.trim();
    var clearBtn = el('se2-clear');
    if (clearBtn) clearBtn.style.display = q ? 'block' : 'none';

    if (!_state.loaded) {
      // FIX BUG 3: store pending query so _loadData.then() will run it
      if (q) _state.pendingQuery = q;
      var bodyEl = el('se2-body');
      _renderLoadingWidget('Gathering source data…');
      _renderSummary([], '');
      return;
    }

    if (!q) {
      _state.qbQuery = '';
      _state.qbQueryLoading = false;
      _state.qbQueryReady = false;
      _state.qbQueryResults = [];
      var allCounts = _countsByCat();
      _renderCats(allCounts);
      _renderSummary([], '');
      var body = el('se2-body');
      if (body) {
        body.innerHTML = '<div id="se2-empty"><div class="se2-chips" id="se2-chip-row"></div></div>';
        _renderChips();
      }
      if (_state.activeCat) _state.activeCat = null;
      document.querySelectorAll('.se2-cat').forEach(function(c) { c.classList.remove('active'); });
      return;
    }

    _ensureQbLiveQuery(q);
    var allResults = _search(q);
    var visibilityCounts = _countsByCat(allResults);
    var results = allResults.slice();
    if (_state.activeCat) {
      results = results.filter(function(r) { return _getSource(r) === _state.activeCat; });
    }
    // Product decision: always keep Search Engine 2 sorted newest → oldest.
    // Fallback when date is missing: use numeric case/id descending.
    // BUG FIX (2026-04-09): Part-number queries sort by score (exact match first),
    // not by newest→oldest. Support case queries keep newest→oldest.
    var parsedQ = _normaliseQuery(_state.query);
    if (parsedQ.isPartNoQuery) {
      // Keep the score-sorted order from _search()
      // (already sorted in _search when isPartNoQuery=true)
    } else {
      results = results.slice().sort(function(a, b) { return _toNewestRank(b) - _toNewestRank(a); });
    }
    _state.results = results;
    _renderCats(visibilityCounts);
    _renderSummary(results, q);
    _renderResults(results, _normaliseQuery(q).tokens);
    var sortBtn = el('se2-sort-btn');
    if (sortBtn) sortBtn.style.display = results.length > 1 ? 'inline-flex' : 'none';
  }

  // ── QB record extraction helper ────────────────────────────────────────────
  // FIX BUG 2: Multi-path QB data discovery
  function _extractQbRecords() {
    // Path 1: QBS root snap array (most reliable — set by my_quickbase.js on data load)
    var qbRoot = document.getElementById('qbs-root');
    var snaps = (qbRoot && Array.isArray(qbRoot._qbRowSnaps) && qbRoot._qbRowSnaps.length > 0)
      ? qbRoot._qbRowSnaps : [];

    // Path 2: window.__studioQbRecords + columns (set by fetch-patch at page top)
    if (!snaps.length && window.__studioQbRecords && Array.isArray(window.__studioQbRecords) && window.__studioQbRecords.length > 0) {
      var rawRecs = window.__studioQbRecords;
      var rawCols = window.__studioQbColumns || [];
      var colMap = {};
      rawCols.forEach(function(c) { colMap[String(c.id)] = c.label || ''; });
      snaps = rawRecs.map(function(r, i) {
        return { rowNum: i+1, recordId: String(r.qbRecordId || i), fields: r.fields || r, columnMap: colMap };
      });
    }

    if (!snaps.length) return [];

    return snaps.map(function(snap) {
      function fv(keys) {
        if (!snap.columnMap) return '';
        var fid = Object.keys(snap.columnMap).find(function(id) {
          return keys.some(function(k) { return (snap.columnMap[id]||'').toLowerCase().includes(k); });
        });
        if (!fid) return '';
        var f = (snap.fields||{})[fid];
        return f && f.value != null ? String(f.value) : '';
      }
      var caseNum = snap.recordId || fv(['case #','case number','record id']);
      var title   = fv(['short description','description','subject','concern','title']);
      var endUser = fv(['end user','client','account','customer']);
      var assignedTo = fv(['assigned to','assignee','owner']);
      var status  = fv(['case status','status']);
      var notes   = fv(['case notes','notes','latest update']);
      var type    = fv(['type','category']);
      var dateVal = fv(['date', 'created', 'modified', 'last update', 'updated']);
      var allFieldText = Object.keys(snap.fields || {}).map(function(fid) {
        var cell = snap.fields[fid];
        return (cell && cell.value != null) ? String(cell.value) : '';
      }).filter(Boolean).join(' · ');
      var parsedDate = _normalizeDateValue(dateVal) || _normalizeDateValue(notes) || _normalizeDateValue(allFieldText);
      return {
        _src: 'qb',
        title: title || ('QB Case #' + caseNum),
        eu: endUser,
        assignedTo: assignedTo,
        res: (notes || allFieldText).slice(0, 1200),
        searchBlob: allFieldText,
        date: parsedDate,
        cat: type || 'QB Case',
        case: caseNum,
        status: status,
        _snap: snap
      };
    }).filter(function(r) { return r.title || r.case; });
  }

  function _mapQbRowsToSe2(rows, fallbackColumnMap, sourceKey) {
    var safeRows = Array.isArray(rows) ? rows : [];
    var globalColumnMap = (fallbackColumnMap && typeof fallbackColumnMap === 'object') ? fallbackColumnMap : {};
    var qbSource = SOURCES[sourceKey] ? sourceKey : 'qb';
    return safeRows.map(function(r) {
      var fields = (r && r.fields && typeof r.fields === 'object') ? r.fields : {};
      var colMap = (r && r.columnMap && typeof r.columnMap === 'object') ? r.columnMap : globalColumnMap;
      function pickValue(labels) {
        if (!colMap) return '';
        var fid = Object.keys(colMap).find(function(id) {
          var lbl = String(colMap[id] || '').toLowerCase();
          return labels.some(function(k) { return lbl.indexOf(k) !== -1; });
        });
        if (!fid || !fields[fid]) return '';
        var cell = fields[fid];
        return (cell && cell.value != null) ? String(cell.value) : '';
      }
      var caseNum = String((r && r.qbRecordId) || pickValue(['case #', 'case number', 'record id']) || '');
      var title = pickValue(['short description', 'description', 'subject', 'concern', 'title']);
      var endUser = pickValue(['end user', 'client', 'account', 'customer']);
      var assignedTo = pickValue(['assigned to', 'assignee', 'owner']);
      var status = pickValue(['case status', 'status']);
      var notes = pickValue(['case notes', 'notes', 'latest update']);
      var type = pickValue(['type', 'category']);
      var dateVal = pickValue(['date', 'created', 'modified', 'last update', 'updated']);
      var allFieldText = Object.keys(fields).map(function(fid) {
        var cell = fields[fid];
        return (cell && cell.value != null) ? String(cell.value) : '';
      }).filter(Boolean).join(' · ');
      var parsedDate = _normalizeDateValue(dateVal) || _normalizeDateValue(notes) || _normalizeDateValue(allFieldText);

      return {
        _src: qbSource,
        title: title || ('QB Case #' + caseNum),
        eu: endUser,
        assignedTo: assignedTo,
        res: (notes || allFieldText).slice(0, 1200),
        searchBlob: allFieldText,
        date: parsedDate,
        cat: type || 'QB Case',
        case: caseNum,
        status: status,
        _snap: { recordId: caseNum, fields: fields, columnMap: colMap, rowNum: r && r.rowNum ? r.rowNum : 0 }
      };
    }).filter(function(row) { return row.title || row.case; });
  }

  // ── QB deep search hydration (all records) ─────────────────────────────────
  // Permanent fix: Search Engine 2 now hydrates QB dataset from the same deep
  // search API used by QuickBase_S so data volume is not limited to visible snaps.
  function _fetchQbDeepRecords() {
    if (Array.isArray(window.__se2QbCache) && window.__se2QbCache.length > 0) {
      return Promise.resolve(window.__se2QbCache);
    }
    if (window.__se2QbPromise) return window.__se2QbPromise;

    var token = _sessionToken();
    var headers = token ? { Authorization: 'Bearer ' + token } : {};
    var pageSize = 2000;
    var maxRows = 30000;
    var latestColumnMap = {};
    var latestColumns = [];

    function fetchPage(skip, acc) {
      return fetch('/api/studio/qb_search?skip=' + skip + '&top=' + pageSize, { headers: headers })
        .then(function(r) { return r.ok ? r.json() : Promise.reject(new Error('qb_search_http_' + r.status)); })
        .then(function(j) {
          if (!j || !j.ok) throw new Error((j && (j.error || j.message)) || 'qb_search_failed');
          var rows = Array.isArray(j.records) ? j.records : [];
          if (j.columnMap && typeof j.columnMap === 'object') latestColumnMap = j.columnMap;
          if (Array.isArray(j.columns)) latestColumns = j.columns;

          var merged = acc.concat(rows);
          if (merged.length > maxRows) merged = merged.slice(0, maxRows);

          var total = Number(j.total || 0);
          var hasMoreByPage = rows.length >= pageSize;
          var hasMoreByTotal = total > 0 ? merged.length < Math.min(total, maxRows) : hasMoreByPage;
          if (hasMoreByPage && hasMoreByTotal && merged.length < maxRows) {
            return fetchPage(skip + rows.length, merged);
          }
          return merged;
        });
    }

    var p = fetchPage(0, [])
      .then(function(rows) {
        // Keep existing globals synced so other Search Studio flows can reuse them.
        window.__studioQbRecords = rows;
        window.__studioQbColumns = latestColumns;
        window.__studioQbDeepRecords = rows;
        window.__studioQbDeepColumns = latestColumns;

        // Deep source must be isolated as qbd for SE2 Data Source filters.
        var mapped = _mapQbRowsToSe2(rows, latestColumnMap, 'qbd');

        window.__se2QbCache = mapped;
        window.__se2QbPromise = null;
        return mapped;
      })
      .catch(function(err) {
        window.__se2QbPromise = null;
        console.warn('[SE2] QB deep search hydrate failed; using local snaps fallback:', err && err.message ? err.message : err);
        return _extractQbRecords();
      });

    window.__se2QbPromise = p;
    return p;
  }

  function _ensureQbLiveQuery(rawQuery) {
    var q = String(rawQuery || '').trim();
    var key = q.toLowerCase();
    if (!q) return;
    if (_state.qbQueryLoading && _state.qbQuery === key) return;
    if (_state.qbQuery === key && _state.qbQueryReady) return;

    _state.qbQueryLoading = true;
    _state.qbQueryReady = false;
    _state.qbQuery = key;
    var seq = ++_state.qbQuerySeq;
    var token = _sessionToken();
    var headers = token ? { Authorization: 'Bearer ' + token } : {};

    var pageSize = 1000;
    var maxRows = 10000;
    var latestColumnMap = {};
    function fetchPage(skip, acc) {
      if (seq !== _state.qbQuerySeq) return Promise.reject(new Error('qb_live_stale'));
      return fetch('/api/studio/qb_search?q=' + encodeURIComponent(q) + '&skip=' + skip + '&top=' + pageSize, { headers: headers })
        .then(function(r) { return r.ok ? r.json() : Promise.reject(new Error('qb_live_http_' + r.status)); })
        .then(function(j) {
          if (seq !== _state.qbQuerySeq) throw new Error('qb_live_stale');
          if (!j || !j.ok) throw new Error((j && (j.error || j.message)) || 'qb_live_failed');
          var rows = Array.isArray(j.records) ? j.records : [];
          latestColumnMap = (j.columnMap && typeof j.columnMap === 'object') ? j.columnMap : latestColumnMap;
          var merged = acc.concat(rows);
          if (merged.length > maxRows) merged = merged.slice(0, maxRows);
          var total = Number(j.total || 0);
          var hasMoreByPage = rows.length >= pageSize;
          var hasMoreByTotal = total > 0 ? merged.length < Math.min(total, maxRows) : hasMoreByPage;
          if (hasMoreByPage && hasMoreByTotal && merged.length < maxRows) {
            return fetchPage(skip + rows.length, merged);
          }
          return { rows: merged, columnMap: latestColumnMap };
        });
    }

    fetchPage(0, [])
      .then(function(out) {
        if (seq !== _state.qbQuerySeq) return;
        var mapped = _mapQbRowsToSe2((out && out.rows) || [], (out && out.columnMap) || {}, 'qbd');
        _state.qbQueryResults = mapped;
        _state.qbQueryReady = true;
      })
      .catch(function(err) {
        if (seq !== _state.qbQuerySeq) return;
        if (String(err && err.message || '') === 'qb_live_stale') return;
        _state.qbQueryResults = [];
        _state.qbQueryReady = true;
      })
      .finally(function() {
        if (seq !== _state.qbQuerySeq) return;
        _state.qbQueryLoading = false;
        if (String(_state.query || '').trim().toLowerCase() === key) _run();
      });
  }

  // ── Data loading ───────────────────────────────────────────────────────────
  // FIX BUG 4: Shared promise sentinel prevents duplicate 12MB fetches
  function _loadData() {
    if (_state.loading) return;
    _state.loading = true;
    _renderSummary([], ''); // show "Loading data sources…"

    var body = el('se2-body');
    _renderLoadingWidget('Loading all data sources…');

    // ── KB JSON — use shared promise to prevent duplicate fetches (FIX BUG 4)
    var kbPromise;
    if (window.__se2KbLoaded && Array.isArray(window.__se2KbCache) && window.__se2KbCache.length > 0) {
      kbPromise = Promise.resolve(window.__se2KbCache);
    } else if (Array.isArray(window.__studioSrRecords) && window.__studioSrRecords.length > 0) {
      kbPromise = Promise.resolve(_mapSupportRecords(window.__studioSrRecords, 'sr'));
    } else if (window.__se2KbPromise) {
      // Pre-load already in-flight — reuse it instead of re-fetching
      kbPromise = window.__se2KbPromise;
    } else {
      kbPromise = _fetchKbJson();
    }

    // ── Connect+ sites (full bundle aware)
    var cpPromise = _loadBundleRecords('connect_plus', window.__se2ConnectData || window.__studioCpRecords)
      .then(function(cpData) {
      return _toArray(cpData).map(function(r) {
        return { _src:'net', title:r.site||r.name||'', eu:r.endUser||r.directory||'',
          res:[r.directory,r.city,r.state,r.country].filter(Boolean).join(' · '),
          cat:'Connect+ Site', site:r.site, directory:r.directory, endUser:r.endUser, url:r.url };
      });
    });

    // ── Parts Number (full bundle aware)
    var pnPromise = _loadBundleRecords('parts_number', window.__se2PartsData || window.__studioPnRecords)
      .then(function(pnData) {
      return _toArray(pnData).map(function(r) {
        var row = r && typeof r === 'object' ? r : {};
        var partNo = row.partNo || row.part_number || row.partnumber ||
          _rowValueByRegex(row, [/^part\s*number$/i, /part\s*#|part\s*no|partno|p\/?n/i, /model/i]);
        var desc = row.desc || row.description ||
          _rowValueByRegex(row, [/^description$/i, /\bdesc\b/i, /details?/i, /product/i]);
        var brand = row.brand || row.manufacturer ||
          _rowValueByRegex(row, [/^brand$/i, /manufacturer|maker|vendor|source/i]);
        var pType = row.type || row.category ||
          _rowValueByRegex(row, [/^type$/i, /category|group|class/i]);
        var blob = _rowSearchBlob(row);
        return {
          _src:'parts',
          title: partNo || desc || brand || row.name || 'Part Number Record',
          res: [brand, pType, desc].filter(Boolean).join(' · ') || blob.slice(0, 1200),
          cat:'Part Number',
          partNo: String(partNo || ''),
          desc: String(desc || ''),
          brand: String(brand || ''),
          searchBlob: blob
        };
      });
    });

    // ── Contact Information
    var ciPromise = _loadContactInformationRecords(window.__studioCiRecords || [])
      .then(function(ciData) {
        return _toArray(ciData).map(function(r) {
          var row = r && typeof r === 'object' ? r : {};
          var keys = Object.keys(row);
          function pickByRx(rx) {
            var k = keys.find(function(name) { return rx.test(String(name || '')); });
            return k ? String(row[k] || '').trim() : '';
          }
          var fullName = row.name || row.full_name || pickByRx(/full\s*name|contact.*name|name/i) || [row.first_name, row.last_name].filter(Boolean).join(' ');
          var email = row.email || pickByRx(/e[\s\-_]*mail|email/i);
          var phone = row.phone || row.mobile || pickByRx(/mobile|phone|contact number/i);
          var company = row.company || row.organization || pickByRx(/company|account|organi[sz]ation|end\s*user/i);
          var dept = row.department || pickByRx(/department|team|group/i);
          var title = fullName || email || phone || company || 'Contact';
          var resText = keys.map(function(k) { return row[k]; }).filter(function(v) { return v != null && String(v).trim() !== ''; }).join(' · ');
          return {
            _src:'ci',
            title: String(title),
            res: String(resText || [email, phone, dept, company].filter(Boolean).join(' · ')),
            cat: 'Contact Information',
            eu: String(company || ''),
            email: String(email || ''),
            phone: String(phone || '')
          };
        });
      });

    // ── QB records — permanent fix: hydrate from deep search API (22k+), then fallback
    var qbPromise = _fetchQbDeepRecords();
    var futurePromise = Promise.resolve(_collectFutureTabRecords());

    Promise.all([kbPromise, cpPromise, pnPromise, ciPromise, qbPromise, futurePromise])
      .then(function(sources) {
        var merged = [];
        sources.forEach(function(s) { if (Array.isArray(s)) merged = merged.concat(s); });
        window.__studioCpRecords = sources[1];
        window.__studioPnRecords = sources[2];
        window.__studioCiRecords = sources[3];
        _state.allRecords = merged;
        _state.loaded     = true;
        _state.loading    = false;
        _state.monitor = {
          sources: {
            kb: sources[0].length, cp: sources[1].length, pn: sources[2].length,
            ci: sources[3].length, qb: sources[4].length, future: sources[5].length
          },
          total: merged.length,
          warnings: []
        };
        console.info('[SE2 monitor] loaded counts', _state.monitor.sources, 'total=', _state.monitor.total);

        var counts = _countsByCat();
        _renderCats(counts);

        // Restore empty welcome state with record count
        var body2 = el('se2-body');
        if (body2) {
          body2.innerHTML = '<div id="se2-empty"><div class="se2-chips" id="se2-chip-row"></div></div>';
          _renderChips();
          var heroC = el('se2-hero-count');
          if (heroC) heroC.textContent = merged.length.toLocaleString();
          var sbI = el('se2-sb-indexed'); if (sbI) sbI.textContent = merged.length.toLocaleString();
          var sbS = el('se2-sb-status'); if (sbS) sbS.textContent = 'Indexed ' + Object.keys(SOURCES).length + ' sources · Ready';
          var hSub = el('se2-health-sub'); if (hSub) hSub.textContent = merged.length.toLocaleString() + ' records indexed';
        }

        // FIX BUG 3: Always run search if there's a pending or current query
        var qEl = el('se2-q');
        var pendingQ = _state.pendingQuery || (qEl && qEl.value ? qEl.value.trim() : '');
        _state.pendingQuery = '';
        _renderSummary([], '');

        if (qEl) qEl.focus();

        if (pendingQ) {
          _state.query = pendingQ;
          if (qEl && !qEl.value) qEl.value = pendingQ;
          _run();
        }

        // Schedule a QB refresh 3 seconds later — QB tab may not have loaded yet
        setTimeout(function() {
          var freshQb = _extractQbRecords();
          if (freshQb.length > 0) {
            var nonQb = _state.allRecords.filter(function(r) { return r._src !== 'qb'; });
            _state.allRecords = nonQb.concat(freshQb);
            if (_state.query) _run();
            else {
              var s = el('se2-summary');
              if (s) s.innerHTML = 'Total indexed: <strong>' + _state.allRecords.length.toLocaleString() + '</strong> records &nbsp;·&nbsp; Ready to search';
            }
          }
        }, 3000);
      })
      .catch(function(err) {
        _state.loading = false;
        var body3 = el('se2-body');
        if (body3) body3.innerHTML = '<div style="padding:40px;text-align:center;">' +
          '<div style="font-size:32px;margin-bottom:12px;">⚠️</div>' +
          '<div style="color:#f85149;font-weight:700;margin-bottom:6px;">Failed to load data sources</div>' +
          '<div style="font-size:11px;color:#7d8590;margin-bottom:14px;">' + esc(String(err&&err.message||err)) + '</div>' +
          '<button onclick="window._se2Reload()" style="background:rgba(88,166,255,.12);border:1px solid rgba(88,166,255,.3);color:#58a6ff;padding:8px 18px;border-radius:7px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">↻ Retry</button>' +
          '</div>';
      });
  }

  // ── KB JSON fetch (shared, deduped) ───────────────────────────────────────
  function _fetchKbJson() {
    var p = fetch('/support_records_kb.json')
      .then(function(r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
      .then(function(j) {
        var flat = Array.isArray(j.flat) ? j.flat : (Array.isArray(j) ? j : []);
        var mapped = _mapSupportRecords(flat, 'sr');
        window.__studioSrRecords = flat;
        window.__se2KbCache  = mapped;
        window.__se2KbLoaded = true;
        window.__se2KbPromise = null;
        return mapped;
      })
      .catch(function(err) {
        console.warn('[SE2] KB JSON load failed:', err.message);
        var fallback = _mapSupportRecords(window.__studioSrRecords || [], 'sr');
        window.__se2KbCache  = fallback;
        window.__se2KbLoaded = false;
        window.__se2KbPromise = null;
        return fallback;
      });
    window.__se2KbPromise = p; // FIX BUG 4: store promise so parallel calls reuse it
    return p;
  }

  // ── Detail Drawer ──────────────────────────────────────────────────────────
  window._se2OpenDetail = function(idx) {
    var r = _state.results[idx];
    if (!r) return;
    _state.detailIdx = idx;
    _state.deepData  = null;

    var drawer = el('se2-detail');
    if (drawer) drawer.classList.add('open');

    var src = SOURCES[_getSource(r)] || { label:'Record', color:'#58a6ff' };
    var caseNum = r.case || r.caseNum || '';

    var titleEl = el('se2-dh-title');
    if (titleEl) titleEl.textContent = r.title || r.site || r.partNo || '(untitled)';

    var metaEl = el('se2-dh-meta');
    if (metaEl) {
      metaEl.innerHTML =
        '<span class="se2-badge" style="color:' + src.color + ';background:' + src.color + '18;border:1px solid ' + src.color + '35;">' + esc(src.label) + '</span>' +
        (caseNum ? '<span class="se2-case-num">#' + esc(caseNum) + '</span>' : '') +
        (r.eu ? '<span class="se2-eu-chip">' + esc(r.eu) + '</span>' : '') +
        (r.status ? '<span class="se2-age-chip">' + esc(r.status) + '</span>' : '');
    }

    var total = _state.results.length;
    var posEl = el('se2-dh-pos');
    if (posEl) posEl.textContent = (idx + 1) + ' of ' + total.toLocaleString();
    var prevBtn = el('se2-dh-prev'); if (prevBtn) prevBtn.disabled = idx <= 0;
    var nextBtn = el('se2-dh-next'); if (nextBtn) nextBtn.disabled = idx >= total - 1;
    _se2RenderBookmarkButton(r);
    if (!_se2BookmarksLoaded) window._se2EnsureBookmarksLoaded();

    var bodyEl = el('se2-drawer-body');
    if (!bodyEl) return;

    var html = '';

    // Resolution / notes
    if (r.res || r.notes) {
      html += '<div class="se2-sec-title" style="color:#58a6ff;"><i class="fas fa-comment-alt" style="margin-right:6px;"></i>Resolution / Notes</div>';
      html += '<div class="se2-notes-box">' + esc(r.res || r.notes || '') + '</div>';
    }

    // Key-value grid
    html += '<div class="se2-sec-title" style="color:#7d8590;"><i class="fas fa-tag" style="margin-right:6px;"></i>Details</div>';
    html += '<div class="se2-kv-grid">';
    if (caseNum) html += '<div class="se2-kv"><div class="se2-kv-label">Case #</div><div class="se2-kv-value" style="font-family:monospace;color:#58a6ff;">' + esc(caseNum) + '</div></div>';
    if (r.eu) html += '<div class="se2-kv"><div class="se2-kv-label">End User</div><div class="se2-kv-value">' + esc(r.eu) + '</div></div>';
    if (r.cat) html += '<div class="se2-kv"><div class="se2-kv-label">Category</div><div class="se2-kv-value">' + esc(r.cat) + '</div></div>';
    if (r.status) html += '<div class="se2-kv"><div class="se2-kv-label">Status</div><div class="se2-kv-value">' + esc(r.status) + '</div></div>';
    if (r.partNo) html += '<div class="se2-kv"><div class="se2-kv-label">Part #</div><div class="se2-kv-value" style="font-family:monospace;">' + esc(r.partNo) + '</div></div>';
    if (r.brand) html += '<div class="se2-kv"><div class="se2-kv-label">Brand</div><div class="se2-kv-value">' + esc(r.brand) + '</div></div>';
    if (r.site) html += '<div class="se2-kv se2-kv-full"><div class="se2-kv-label">Site</div><div class="se2-kv-value">' + esc(r.site) + '</div></div>';
    if (r.desc && r.desc !== r.res) html += '<div class="se2-kv se2-kv-full"><div class="se2-kv-label">Description</div><div class="se2-kv-value">' + esc(r.desc) + '</div></div>';
    if (r.url) html += '<div class="se2-kv se2-kv-full"><div class="se2-kv-label">Link</div><div class="se2-kv-value"><a href="' + esc(r.url) + '" target="_blank" style="color:#22d3ee;text-decoration:none;">' + esc(r.url) + '</a></div></div>';
    html += '<div class="se2-kv"><div class="se2-kv-label">Source</div><div class="se2-kv-value" style="color:' + src.color + ';">' + esc(src.label) + '</div></div>';
    html += '</div>';

    bodyEl.innerHTML = html;

    // Footer — show QB deep-fetch only for QB records
    var footer = el('se2-drawer-footer');
    if (footer) {
      footer.style.display = (_getSource(r) === 'qb' && caseNum) ? 'flex' : 'none';
    }
  };

  window._se2Nav = function(dir) {
    var next = _state.detailIdx + dir;
    if (next < 0 || next >= _state.results.length) return;
    window._se2OpenDetail(next);
  };

  window._se2CloseDetail = function() {
    var d = el('se2-detail');
    if (d) d.classList.remove('open');
  };

  window._se2DeepFetch = function() {
    var r = _state.results[_state.detailIdx];
    if (!r || !r.case) return;
    var caseNum = r.case;
    var bodyEl = el('se2-drawer-body');
    if (!bodyEl) return;
    bodyEl.innerHTML = '<div class="se2-loading-overlay"><div class="se2-spin"></div><span>Fetching QB case #' + esc(caseNum) + '…</span></div>';

    if (typeof window._qbsDeepSearch === 'function') {
      window._qbsDeepSearch(caseNum, 0);
      window._se2CloseDetail();
      if (typeof window.activateTab === 'function') {
        // Navigate to QBS tab and trigger search
        setTimeout(function() { window.activateTab('qbs'); }, 100);
      }
    } else {
      bodyEl.innerHTML = '<div style="padding:20px;text-align:center;color:#7d8590;font-size:12px;">Open the QuickBase_S tab and search for case #' + esc(caseNum) + ' to see full details.</div>';
    }
  };

  // FIX BUG 1: _se2OpenInQbs no longer uses broken onclick string
  window._se2OpenInQbs = function(caseNum) {
    window._se2CloseDetail();
    if (typeof window.activateTab === 'function') {
      window.activateTab('qbs');
      setTimeout(function() {
        if (typeof window._qbsDeepSearch === 'function') {
          window._qbsDeepSearch(String(caseNum), 0);
        }
      }, 600);
    }
  };

  window._se2FilterCat = function(cat) {
    if (cat === 'all') cat = null;
    _state.activeCat = (_state.activeCat === cat) ? null : cat;
    _run();
  };

  window._se2SetQ = function(val) {
    var qEl = el('se2-q');
    if (qEl) { qEl.value = val; qEl.focus(); }
    _state.query = String(val || '');
    _run();
  };

  window._se2Clear = function() {
    var qEl = el('se2-q');
    if (qEl) { qEl.value = ''; qEl.focus(); }
    _state.query = '';
    _state.activeCat = null;
    _run();
  };

  window._se2Reload = function() {
    _state.loaded = false;
    _state.loading = false;
    _state.allRecords = [];
    _state.qbQuery = '';
    _state.qbQueryLoading = false;
    _state.qbQueryReady = false;
    _state.qbQueryResults = [];
    window.__se2KbLoaded = false;
    window.__se2KbPromise = null;
    window.__se2QbCache = null;
    window.__se2QbPromise = null;
    _loadData();
  };

  // Keyboard nav
  document.addEventListener('keydown', function(e) {
    var d = el('se2-detail');
    if (!d || !d.classList.contains('open')) return;
    if (e.key === 'Escape')     { window._se2CloseDetail(); return; }
    if (e.key === 'ArrowLeft')  window._se2Nav(-1);
    if (e.key === 'ArrowRight') window._se2Nav(1);
  });

  // ── Main init ──────────────────────────────────────────────────────────────
  var _se2Inited = false;

  function _se2Init() {
    _ensureSe2SearchVisible();

    if (_se2Inited) {
      // Re-visit: refresh QB data and re-run current search
      var freshQb = _extractQbRecords();
      if (freshQb.length > 0) {
        var nonQb = _state.allRecords.filter(function(r) { return r._src !== 'qb'; });
        if (nonQb.length > 0 && freshQb.length !== (_state.allRecords.length - nonQb.length)) {
          _state.allRecords = nonQb.concat(freshQb);
        }
      }
      var qEl2 = el('se2-q');
      if (qEl2) qEl2.focus();
      if (_state.loaded) _run();
      return;
    }
    _se2Inited = true;

    var qEl = el('se2-q');
    var _se2Debounce = null;
    if (qEl && !qEl._se2Bound) {
      qEl._se2Bound = true;
      qEl.addEventListener('input', function() {
        clearTimeout(_se2Debounce);
        var val = qEl.value;
        _se2Debounce = setTimeout(function() {
          _state.query = val;
          _run();
        }, 200);
      });
      qEl.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') window._se2Clear();
      });
      setTimeout(function() { qEl.focus(); }, 100);
    }

    _renderChips();
    _loadData();
    window._se2EnsureBookmarksLoaded();
  }

  window.addEventListener('mums:authtoken', function() {
    setTimeout(function() { window._se2EnsureBookmarksLoaded(); }, 180);
  });

  // ═══════════════════════════════════════════════════════════════════
  // ACTIVATION — 4-layer strategy
  // Layer 1: Background pre-load KB JSON at page startup
  // Layer 2: Direct click listener on SE2 tab button
  // Layer 3: MutationObserver on canvas active class
  // Layer 4: activateTab wrapper + _openSearchEngine2 hook
  // ═══════════════════════════════════════════════════════════════════

  // Layer 1: Pre-load KB JSON in background
  (function _se2PreLoad() {
    if (window.__se2KbLoaded || window.__se2KbPromise) return; // already started
    window.__se2KbPromise = _fetchKbJson();
  })();

  // Layer 2: Direct click listener
  function _se2AttachClickListener() {
    var btn = document.getElementById('ss-tab-search_engine_2');
    if (!btn) { setTimeout(_se2AttachClickListener, 200); return; }
    btn.addEventListener('click', function() { setTimeout(_se2Init, 80); }, false);
  }

  // Layer 3: MutationObserver
  function _se2AttachObserver() {
    var canvas = document.getElementById('canvas-search_engine_2');
    if (!canvas) { setTimeout(_se2AttachObserver, 300); return; }
    var obs = new MutationObserver(function(mutations) {
      mutations.forEach(function(m) {
        if (m.type === 'attributes' && m.attributeName === 'class') {
          if (canvas.classList.contains('active')) setTimeout(_se2Init, 80);
        }
      });
    });
    obs.observe(canvas, { attributes: true, attributeFilter: ['class'] });
    if (canvas.classList.contains('active')) setTimeout(_se2Init, 80);
  }

  // Layer 4: activateTab + _openSearchEngine2 hooks
  var _origActivateTab = window.activateTab;
  window.activateTab = function(target) {
    if (typeof _origActivateTab === 'function') _origActivateTab(target);
    if (target === 'search_engine_2') setTimeout(_se2Init, 80);
  };
  window._openSearchEngine2 = function() {
    if (typeof window.activateTab === 'function') window.activateTab('search_engine_2');
    return false;
  };

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      _se2AttachClickListener();
      _se2AttachObserver();
    });
  } else {
    _se2AttachClickListener();
    _se2AttachObserver();
  }

})();

(function() {
  'use strict';

  var searchInput = document.getElementById('ss-search');

  function openSearchEngine2WithQuery(raw) {
    var q = String(raw || '').trim();
    if (!q) return false;

    var se2Tab = document.querySelector('.ss-tab[data-tab="search_engine_2"]');
    if (se2Tab) se2Tab.click();

    function applyQuery(retries) {
      if (typeof window._se2SetQ === 'function') {
        window._se2SetQ(q);
        return;
      }
      var input = document.getElementById('se2-q');
      if (input) {
        input.value = q;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
        return;
      }
      if (retries > 0) setTimeout(function() { applyQuery(retries - 1); }, 120);
    }

    setTimeout(function() { applyQuery(20); }, 120);
    return true;
  }

  window._ssGlobalSearchGo = function() {
    if (!searchInput) return;
    var q = String(searchInput.value || '').trim();
    if (!q) { searchInput.focus(); return; }
    openSearchEngine2WithQuery(q);
  };

  function boot() {
    if (!searchInput) return;
    var legacy = document.getElementById('ss-omnibar-dropdown');
    if (legacy && legacy.parentNode) legacy.parentNode.removeChild(legacy);
    searchInput.addEventListener('keydown', function(e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      window._ssGlobalSearchGo();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})();
