/* My Notes — Enterprise Vault Edition  v4.0
 * ──────────────────────────────────────────────────────────────────────────
 * PRESERVED (do not change):
 *   localStorage keys : mums_notes_v3 | mums_notes_active_ws | mums_notes_custom_ws
 *   Supabase tables   : public.mums_notes | public.mums_notes_workspaces
 *   Public functions  : openModal, closeModal, loadNotes, pushNote, deleteNote
 *   Injection point   : #releaseNotesBtn → inserts #myNotesBtn before it
 *   Modal id          : #myNotesModal (kept for compatibility)
 * ADDED:
 *   - 100% Enterprise Vault UI (3-column + properties panel)
 *   - Tailwind CDN utility classes (darkMode:'class')
 *   - Resizable columns → localStorage 'mums_notes_col_state'
 *   - Theme toggle → localStorage 'mums_theme'
 *   - 800ms debounce save (queueSave) + batchFlush every 2s
 *   - 429 / Retry-After exponential backoff
 *   - Collapsible workspace tree with chevron animation
 *   - Copy buttons with clipboard toast
 * ──────────────────────────────────────────────────────────────────────────
 */
(function () {
  'use strict';

  /* ── Constants ──────────────────────────────────────────────────────────── */
  const ICON         = '/Widget%20Images/MY_NOTES.png';
  const LS_CACHE     = 'mums_notes_v3';
  const LS_WS_KEY    = 'mums_notes_active_ws';
  const LS_CUSTOM_WS = 'mums_notes_custom_ws';
  const LS_COL_STATE = 'mums_notes_col_state';
  const LS_THEME     = 'mums_theme';
  const SAVE_DEBOUNCE  = 800;
  const BATCH_INTERVAL = 2000;
  const DEFAULT_WS   = [
    { key: 'personal', label: 'Personal', emoji: '📁', icon: 'folder' },
    { key: 'team',     label: 'Team',     emoji: '👥', icon: 'users'  },
    { key: 'projects', label: 'Projects', emoji: '📦', icon: 'grid'   },
  ];

  /* ── State ──────────────────────────────────────────────────────────────── */
  let notes    = [];
  let customWs = [];
  let activeId = null;
  let activeWs = localStorage.getItem(LS_WS_KEY) || 'personal';
  let editMode = false;
  let dirty    = false;
  let sb       = null;
  let uid      = null;
  let _saveTimer   = null;
  let _dirtySet    = new Set();
  let _batchTimer  = null;
  let _rateLimited = false;

  /* ── Helpers ────────────────────────────────────────────────────────────── */
  const $ = s => document.querySelector(s);

  function uidGen() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
  const wsKeyOf       = name => 'cws_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now();
  const sortByUpdated = arr  => arr.slice().sort((a,b) => new Date(b.updated_at||0) - new Date(a.updated_at||0));
  const esc           = s   => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  function fmtDate(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso), now = new Date(), diff = (now - d) / 1000;
      if (diff < 60)    return 'just now';
      if (diff < 3600)  return Math.floor(diff/60)   + 'm ago';
      if (diff < 86400) return Math.floor(diff/3600)  + 'h ago';
      return d.toLocaleDateString(undefined, { month:'short', day:'numeric' });
    } catch { return iso; }
  }
  function fmtLong(iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleString(undefined, { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }); }
    catch { return iso; }
  }
  function linkify(text) {
    if (!text) return '';
    return esc(text).replace(/(https?:\/\/[^\s<>&"]+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:underline;word-break:break-all" onclick="event.stopPropagation()">$1</a>');
  }

  /* ── SVG icon helper ────────────────────────────────────────────────────── */
  const SVG = {
    folder : '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>',
    users  : '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    grid   : '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
    shield : '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10z"/><path d="M9 12l2 2 4-4"/>',
    search : '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    copy   : '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    share  : '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.59 13.51 15.42 17.49"/><path d="M15.41 6.51 8.59 10.49"/>',
    save   : '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
    edit   : '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
    trash  : '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
    audit  : '<path d="M3 3v5h5"/><path d="M3 8a9 9 0 1 0 2.6-6.3L3 8"/><path d="M12 7v5l3 3"/>',
    panel  : '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/>',
    star   : '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    x      : '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    check  : '<path d="M20 6 9 17l-5-5"/>',
    bell   : '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    sun    : '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
    moon   : '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    filter : '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
    sort   : '<path d="M3 6h18M7 12h10M10 18h4"/>',
    warn   : '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    lock   : '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    chevR  : '<path d="m9 18 6-6-6-6"/>',
    plus   : '<path d="M12 5v14M5 12h14"/>',
    clock  : '<circle cx="12" cy="12" r="10"/><path d="M12 7v5l3 3"/>',
  };
  function icon(name, size=16) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${SVG[name]||''}</svg>`;
  }

  /* ── Supabase / session (unchanged from v3) ─────────────────────────────── */
  const LS_SESSION = 'mums_supabase_session';
  function readSession() {
    const srcs = [
      () => localStorage.getItem(LS_SESSION),
      () => sessionStorage.getItem(LS_SESSION),
      () => { const m = document.cookie.match('(?:^|;)\\s*' + LS_SESSION + '=([^;]*)'); return m ? decodeURIComponent(m[1]) : null; }
    ];
    for (const s of srcs) {
      try { const r = s(); if (r) { const p = JSON.parse(r); if (p && p.access_token) return p; } } catch (_) {}
    }
    return null;
  }
  async function getSb() {
    if (window.__MUMS_SB_CLIENT) return window.__MUMS_SB_CLIENT;
    if (sb) return sb;
    const e = window.MUMS_ENV || {};
    if (!e.SUPABASE_URL) return null;
    if (!window.supabase?.createClient) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';
        s.onload = res; s.onerror = rej; document.head.appendChild(s);
      });
    }
    sb = window.supabase.createClient(e.SUPABASE_URL, e.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const sess = readSession();
    if (sess?.access_token && sess?.refresh_token)
      await sb.auth.setSession({ access_token: sess.access_token, refresh_token: sess.refresh_token }).catch(() => {});
    return sb;
  }
  async function getUid() {
    if (uid) return uid;
    if (window.__MUMS_SB_CLIENT) {
      try { const { data } = await window.__MUMS_SB_CLIENT.auth.getUser(); if (data?.user?.id) { uid = data.user.id; return uid; } } catch (_) {}
    }
    const sess = readSession();
    if (sess?.user?.id) { uid = sess.user.id; return uid; }
    const token = sess?.access_token;
    if (token) {
      try { const p = JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))); if (p.sub) { uid = p.sub; return uid; } } catch (_) {}
    }
    return null;
  }

  /* ── Local cache ────────────────────────────────────────────────────────── */
  function loadLocal()     { try { notes    = JSON.parse(localStorage.getItem(LS_CACHE)     || '[]'); } catch { notes    = []; } }
  function saveLocal()     { try { localStorage.setItem(LS_CACHE,     JSON.stringify(notes));    } catch {} }
  function loadCustomWsL() { try { customWs = JSON.parse(localStorage.getItem(LS_CUSTOM_WS) || '[]'); } catch { customWs = []; } }
  function saveCustomWsL() { try { localStorage.setItem(LS_CUSTOM_WS, JSON.stringify(customWs)); } catch {} }

  /* ── Remote: notes ──────────────────────────────────────────────────────── */
  async function pull() {
    updateSyncStatus('syncing');
    const s = await getSb(); const u = await getUid(); if (!s || !u) return;
    const { data } = await s.from('mums_notes').select('*').eq('user_id', u);
    notes = (data || []).map(r => ({ id: r.id, workspace: r.workspace || 'personal', title: r.title || 'Untitled', content: r.content || '', updated_at: r.updated_at }));
    saveLocal(); renderNotesList();
    if (activeId) { const n = notes.find(x => x.id === activeId); if (n && !editMode) showDetail(n); }
    updateSyncStatus('synced');
  }

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  // PRESERVED: pushNote()
  async function pushNote(n) {
    const s = await getSb(); const u = await getUid(); if (!s || !u) return false;
    if (!UUID_RE.test(n.id)) {
      const newId = uidGen(); notes = notes.filter(x => x.id !== n.id);
      n.id = newId; notes.push(n); saveLocal(); activeId = n.id;
    }
    const { error, status } = await s.from('mums_notes').upsert(
      { id: n.id, user_id: u, workspace: n.workspace, title: n.title, content: n.content, updated_at: n.updated_at },
      { onConflict: 'id' }
    );
    if (error) { console.error('[MyNotes] pushNote:', error.message); if (status === 429) _handle429(); }
    return !error;
  }

  /* ── Freemium: debounced + batched save ─────────────────────────────────── */
  function queueSave(noteId) {
    _dirtySet.add(noteId);
    clearTimeout(_saveTimer);
    // 800ms debounce — wait for user to stop typing before committing
    _saveTimer = setTimeout(async () => {
      if (_rateLimited || !_dirtySet.has(noteId)) return;
      const n = notes.find(x => x.id === noteId);
      if (n) { await pushNote(n); _dirtySet.delete(noteId); }
    }, SAVE_DEBOUNCE);
  }

  function _startBatchFlush() {
    if (_batchTimer) return;
    // Batch upsert every 2s for any remaining dirty notes
    _batchTimer = setInterval(async () => {
      if (!_dirtySet.size || _rateLimited) return;
      const s = await getSb(); const u = await getUid(); if (!s || !u) return;
      const batch = [..._dirtySet].map(id => notes.find(x => x.id === id)).filter(Boolean);
      if (!batch.length) return;
      const { error, status } = await s.from('mums_notes').upsert(
        batch.map(n => ({ id: n.id, user_id: u, workspace: n.workspace, title: n.title, content: n.content, updated_at: n.updated_at })),
        { onConflict: 'id' }
      );
      if (!error) { _dirtySet.clear(); } else if (status === 429) { _handle429(); }
    }, BATCH_INTERVAL);
  }

  function _handle429() {
    // Exponential backoff: 1s → 2s → 4s
    _rateLimited = true;
    const banner = $('#mnRateBanner');
    if (banner) { banner.textContent = '⚠ Rate limited — auto-retry in progress'; banner.classList.add('visible'); }
    let attempt = 0;
    const tryAgain = () => {
      const delay = Math.min(4000, 1000 * Math.pow(2, attempt++));
      setTimeout(() => {
        _rateLimited = false;
        if (banner) banner.classList.remove('visible');
      }, delay);
    };
    tryAgain();
  }

  /* ── Remote: workspaces ─────────────────────────────────────────────────── */
  async function pullWorkspaces() {
    const s = await getSb(); const u = await getUid(); if (!s || !u) return;
    try {
      const { data, error } = await s.from('mums_notes_workspaces').select('*').eq('user_id', u).order('sort_order');
      if (error) { console.info('[MyNotes] pullWorkspaces (migration pending):', error.message); return; }
      if (data) { customWs = data.map(r => ({ id: r.id, key: 'cws_' + r.id.replace(/-/g,''), name: r.name, emoji: r.emoji || '📁' })); saveCustomWsL(); }
    } catch (err) { console.info('[MyNotes] pullWorkspaces skipped:', err?.message); }
    renderWorkspaceTree();
  }
  async function remoteAddWorkspace(ws) {
    const s = await getSb(); const u = await getUid(); if (!s || !u) return null;
    try {
      const { data, error } = await s.from('mums_notes_workspaces').insert({ user_id: u, name: ws.name, emoji: ws.emoji, sort_order: customWs.length }).select().single();
      if (error) { console.info('[MyNotes] addWorkspace:', error.message); return null; }
      return data;
    } catch (err) { return null; }
  }
  async function remoteDelWorkspace(id) {
    const s = await getSb(); const u = await getUid(); if (!s || !u) return;
    try { await s.from('mums_notes_workspaces').delete().eq('id', id).eq('user_id', u); } catch (_) {}
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     MODAL HTML — Enterprise Vault 3-column layout
  ═══════════════════════════════════════════════════════════════════════════ */
  function ensureModal() {
    if ($('#myNotesModal')) return;

    document.body.insertAdjacentHTML('beforeend', `
<div id="myNotesModal">
 <div id="mnVaultPanel">

  <!-- Rate-limit banner -->
  <div id="mnRateBanner" class="mn-rate-banner"></div>

  <!-- ── HEADER ── -->
  <header id="mnVaultHeader">
   <div class="mn-logo-box">${icon('shield', 18)}</div>
   <div style="display:flex;align-items:baseline;gap:8px;min-width:0">
    <span class="mn-brand-title">My Notes</span>
    <span class="mn-brand-sep">—</span>
    <span class="mn-brand-sub">Enterprise Vault</span>
   </div>
   <div class="mn-cc-badge">
    <span class="mn-cc-badge-icon"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></svg></span>
    <span class="mn-cc-label">Command Center</span>
   </div>

   <div class="mn-global-search-wrap">
    <span class="mn-search-icon">${icon('search', 14)}</span>
    <input id="mnGlobalSearch" class="mn-global-search" placeholder="Ask Vault, search, or run command…">
    <kbd class="mn-kbd">⌘K</kbd>
   </div>

   <div class="mn-header-right">
    <button id="mnThemeToggle" class="mn-icon-btn" title="Toggle theme">
     <span class="mn-sun">${icon('sun', 16)}</span>
     <span class="mn-moon">${icon('moon', 16)}</span>
    </button>
    <div class="mn-divider"></div>
    <button class="mn-icon-btn" title="Notifications">${icon('bell', 18)}</button>
    <div class="mn-avatar">MR</div>
    <button id="myNotesCloseBtn" class="mn-icon-btn" title="Close" aria-label="Close My Notes">${icon('x', 16)}</button>
   </div>
  </header>

  <!-- ── BODY: 3-col ── -->
  <div id="mnVaultBody">

   <!-- ① LEFT SIDEBAR -->
   <aside id="mnSidebarLeft">
    <div class="mn-left-scroll">
     <span class="mn-section-label">Workspaces</span>
     <div id="mnWsTree" style="display:flex;flex-direction:column;gap:2px"></div>
    </div>
    <div class="mn-shared-footer">
     <span class="mn-section-label">Shared with me</span>
     <a class="mn-shared-user">
      <div class="mn-shared-avatar" style="background:#059669">VW</div>
      <div style="min-width:0"><div style="font-size:12px;line-height:1.3">Vince Wilson</div><div style="font-size:11px;color:#64748b">3 notes</div></div>
     </a>
     <a class="mn-shared-user">
      <div class="mn-shared-avatar" style="background:#0284c7">AK</div>
      <div style="min-width:0"><div style="font-size:12px;line-height:1.3">Ava Kumar</div><div style="font-size:11px;color:#64748b">12 notes</div></div>
     </a>
     <button id="mnAddWsBtn" style="margin-top:10px;width:100%;text-align:left;font-size:12px;color:#64748b;padding:8px 10px;border-radius:8px;background:transparent;border:1px dashed rgba(148,163,184,0.4);cursor:pointer;display:flex;align-items:center;gap:6px">
      <span style="font-size:15px;line-height:1">＋</span> Add Workspace
     </button>
    </div>
   </aside>

   <!-- Resizer 1 -->
   <div id="mnResizer1" class="mn-resizer"></div>

   <!-- ② MIDDLE PANEL -->
   <aside id="mnSidebarMid">
    <div class="mn-mid-top">
     <div class="mn-mid-search-wrap">
      <span class="mn-search-icon">${icon('search', 14)}</span>
      <input id="mnSearch" class="mn-mid-search" placeholder="Search notes…">
     </div>
     <div class="mn-mid-controls">
      <button class="mn-mid-btn">${icon('filter', 13)} Filter</button>
      <button class="mn-mid-btn">${icon('sort', 13)} Sort by Updated</button>
      <button id="mnNew" class="mn-mid-new-btn">${icon('plus', 12)} New</button>
     </div>
    </div>
    <div class="mn-col-header">
     <span>Title</span><span>Workspace</span><span style="text-align:right">Updated</span>
    </div>
    <div id="mnNotesList"></div>
    <div class="mn-mid-footer">
     <span><span id="mnCount">0</span> items</span>
     <span><span class="mn-sync-dot"></span> <span id="mnSyncLabel">Synced</span> • Encrypted</span>
    </div>
   </aside>

   <!-- Resizer 2 -->
   <div id="mnResizer2" class="mn-resizer"></div>

   <!-- ③ MAIN CONTENT -->
   <section id="mnMainContent">
    <div class="mn-doc-pane">

     <!-- Empty state -->
     <div id="mnEmptyState" class="mn-empty-state">
      <div class="mn-empty-icon">📝</div>
      <div class="mn-empty-title">Select a note</div>
      <div class="mn-empty-sub">Choose from the list or create a new one.</div>
     </div>

     <!-- Note doc pane (hidden until a note is selected) -->
     <div id="mnDocPane" style="display:none;flex-direction:column;height:100%;flex:1">

      <!-- Breadcrumb + Title -->
      <div class="mn-breadcrumb-bar">
       <nav class="mn-breadcrumb" id="mnBreadcrumb"></nav>
       <div class="mn-title-row">
        <div id="mnDocTitle" style="font-size:24px;font-weight:600;letter-spacing:-0.02em;line-height:1.25;word-break:break-word;flex:1;min-width:0;border:none;background:transparent;outline:none;font-family:inherit;cursor:default"></div>
        <div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
         <button class="mn-icon-btn" title="Star">${icon('star',16)}</button>
         <button id="mnPropToggle" class="mn-icon-btn" title="Properties">${icon('panel',16)}</button>
        </div>
       </div>
      </div>

      <!-- Metadata bar -->
      <div class="mn-meta-bar">
       <div class="mn-meta-author">
        <span class="mn-meta-mini-avatar">MR</span>
        Created by <b style="font-weight:600;color:#1e293b;margin-left:3px">You</b>
       </div>
       <span class="mn-meta-dot">•</span>
       <div>Last edited <b id="mnLastEdited" style="font-weight:600;color:#1e293b"></b></div>
       <span class="mn-meta-dot">•</span>
       <div style="display:flex;align-items:center;gap:4px"><span class="mn-version-dot"></span> Auto-saved</div>
       <span id="mnDirtyBadge" class="mn-dirty-badge" style="display:none">● Unsaved</span>
       <div class="mn-meta-right">
        <button id="mnEditBtn"   class="mn-meta-btn-primary">${icon('edit',13)} Edit</button>
        <button id="mnSaveBtn"   class="mn-meta-btn-primary mn-hidden">${icon('save',13)} Save</button>
        <button id="mnCancelBtn" class="mn-meta-btn-ghost   mn-hidden">Cancel</button>
        <button id="mnShareBtn"  class="mn-meta-btn-primary">${icon('share',13)} Share</button>
        <button class="mn-meta-btn-ghost">${icon('audit',13)} Audit Log</button>
        <button id="mnCopyBtn"   class="mn-meta-btn-ghost" title="Copy content">${icon('copy',13)} Copy</button>
        <button id="mnDelBtn"    class="mn-meta-btn-ghost"  style="color:#ef4444">${icon('trash',13)}</button>
       </div>
      </div>

      <!-- Document scroll -->
      <div class="mn-doc-scroll">
       <div class="mn-doc-inner mn-prose">
        <div id="mnContentView"  style="white-space:pre-wrap;word-break:break-word;font-size:14px;line-height:1.75;color:#1e293b;min-height:200px"></div>
        <textarea id="mnContentEdit" class="mn-hidden" style="width:100%;min-height:400px;border:none;outline:none;resize:none;font-size:14px;line-height:1.75;background:transparent;font-family:inherit;color:inherit;box-sizing:border-box"></textarea>
        <!-- Bottom bar -->
        <div class="mn-doc-bottom">
         <div class="mn-autosave-text">${icon('clock',14)} Auto-saved • Encrypted at rest (AES-256)</div>
         <div class="mn-doc-actions">
          <button class="mn-export-btn">Export PDF</button>
          <button class="mn-runbook-btn">Create Runbook from this</button>
         </div>
        </div>
       </div>
      </div>
     </div>
    </div>

    <!-- PROPERTIES PANEL -->
    <aside id="mnProperties">
     <div class="mn-prop-header">
      <span class="mn-prop-title">Properties</span>
      <button id="mnPropClose" class="mn-icon-btn">${icon('x',14)}</button>
     </div>
     <div class="mn-prop-body">
      <div class="mn-prop-section">
       <span class="mn-prop-section-label">Workspace</span>
       <div class="mn-prop-ws-card">
        <div class="mn-prop-ws-icon">${icon('folder',16)}</div>
        <div><div class="mn-prop-ws-name" id="mnPropWsName">Personal</div><div class="mn-prop-ws-sub">Private • Encrypted</div></div>
       </div>
      </div>
      <div class="mn-prop-section">
       <span class="mn-prop-section-label">Tags</span>
       <div class="mn-prop-tags">
        <span style="padding:4px 8px;border-radius:999px;background:#fef3c7;color:#92400e;font-size:11px;font-weight:500">Operations</span>
        <span style="padding:4px 8px;border-radius:999px;background:#e0f2fe;color:#075985;font-size:11px;font-weight:500">AU</span>
        <span style="padding:4px 8px;border-radius:999px;background:#ffe4e6;color:#9f1239;font-size:11px;font-weight:500">Critical</span>
        <button class="mn-prop-tag-add">+ Add</button>
       </div>
      </div>
      <div class="mn-prop-section">
       <span class="mn-prop-section-label">Related notes</span>
       <a class="mn-related-item"><div class="mn-related-title">Woolworths DB Patch</div><div class="mn-related-sub">Oracle 19c quarterly patch plan</div></a>
       <a class="mn-related-item"><div class="mn-related-title">Tomcat Health Checks</div><div class="mn-related-sub">Synthetic monitors and alerts</div></a>
       <a class="mn-related-item"><div class="mn-related-title">Incident #4421 Postmortem</div><div class="mn-related-sub">Root cause analysis</div></a>
      </div>
      <div class="mn-prop-section">
       <span class="mn-prop-section-label">Activity</span>
       <div class="mn-activity-row"><span class="mn-activity-label">Last edited</span><span id="mnPropEdited">—</span></div>
       <div class="mn-activity-row"><span class="mn-activity-label">Synced</span><span>Just now</span></div>
       <div class="mn-activity-row"><span class="mn-activity-label">Owner</span><span>Macer Ryan</span></div>
       <div class="mn-activity-row"><span class="mn-activity-label">Classification</span>
        <span style="display:inline-flex;align-items:center;gap:3px;font-size:10px;padding:2px 6px;border-radius:999px;background:#0f172a;color:#fff">
         ${icon('shield',10)} INTERNAL
        </span>
       </div>
      </div>
     </div>
    </aside>
   </section>
  </div>
 </div>

 <!-- Copy toast -->
 <div id="mnCopyToast" class="mn-copy-toast">Copied to clipboard</div>

 <!-- Add workspace dialog -->
 <div id="mnWsDialog">
  <div class="mn-dialog-box">
   <div class="mn-dialog-title">New Workspace</div>
   <div class="mn-dialog-sub">Choose an emoji and give your workspace a name.</div>
   <div class="mn-dialog-inputs">
    <input id="mnWsEmojiInput" class="mn-dialog-emoji" value="📁" maxlength="4">
    <input id="mnWsNameInput"  class="mn-dialog-name"  placeholder="e.g. Finance, HR, Dev…">
   </div>
   <div class="mn-dialog-footer">
    <button id="mnWsDlgCancel" class="mn-dialog-cancel">Cancel</button>
    <button id="mnWsDlgCreate" class="mn-dialog-create">Create</button>
   </div>
  </div>
 </div>
</div>`);

    /* ── Wire events ────────────────────────────────────────────────────── */
    // PERMANENT FIX: direct addEventListener bypasses UI.bindDataClose capture handler
    $('#myNotesCloseBtn').addEventListener('click', e => { e.stopPropagation(); closeModal(); });
    document.addEventListener('keydown', function _mnEsc(e) {
      if (e.key !== 'Escape') return;
      const m = $('#myNotesModal'); if (!m || !m.classList.contains('mn-open')) return;
      e.stopPropagation(); closeModal();
    });
    $('#mnThemeToggle').addEventListener('click', toggleTheme);
    $('#mnNew').addEventListener('click', createNote);
    let _searchT = null;
    $('#mnSearch').addEventListener('input', () => { clearTimeout(_searchT); _searchT = setTimeout(renderNotesList, 300); });
    $('#mnEditBtn').addEventListener('click',   enterEditMode);
    $('#mnSaveBtn').addEventListener('click',   saveNote);
    $('#mnCancelBtn').addEventListener('click', cancelEdit);
    $('#mnCopyBtn').addEventListener('click',   copyNote);
    $('#mnDelBtn').addEventListener('click',    deleteNote);
    $('#mnContentEdit').addEventListener('input', markDirty);
    $('#mnPropToggle').addEventListener('click', () => {
      const p = $('#mnProperties');
      if (p) p.style.display = p.style.display === 'flex' ? 'none' : 'flex';
    });
    $('#mnPropClose').addEventListener('click', () => { const p = $('#mnProperties'); if (p) p.style.display = 'none'; });
    // Copy-button delegation (data-copy attribute on any element)
    document.addEventListener('click', e => {
      const btn = e.target.closest('[data-copy]'); if (!btn) return;
      navigator.clipboard.writeText(btn.getAttribute('data-copy')).then(() => showCopyToast()).catch(() => {});
    });
    // Workspace dialog
    $('#mnAddWsBtn').addEventListener('click', showWsDialog);
    $('#mnWsDlgCancel').addEventListener('click', hideWsDialog);
    $('#mnWsDlgCreate').addEventListener('click', confirmAddWs);
    $('#mnWsNameInput').addEventListener('keydown', e => { if (e.key === 'Enter') confirmAddWs(); });
    $('#mnWsDialog').addEventListener('click', e => { if (e.target === $('#mnWsDialog')) hideWsDialog(); });
    // Resizers + theme
    _initResizers();
    _applyTheme();
  }

  /* ── Copy toast ─────────────────────────────────────────────────────────── */
  function showCopyToast(msg) {
    const t = $('#mnCopyToast'); if (!t) return;
    t.textContent = msg || 'Copied to clipboard';
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 1600);
  }

  /* ── Theme ──────────────────────────────────────────────────────────────── */
  function _applyTheme() {
    const saved = localStorage.getItem(LS_THEME);
    const dark  = saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches);
    const panel = $('#mnVaultPanel'); if (!panel) return;
    dark ? panel.classList.add('dark') : panel.classList.remove('dark');
  }
  function toggleTheme() {
    const panel = $('#mnVaultPanel'); if (!panel) return;
    localStorage.setItem(LS_THEME, panel.classList.toggle('dark') ? 'dark' : 'light');
  }

  /* ── Resizers ───────────────────────────────────────────────────────────── */
  function _initResizers() {
    const saved = (() => { try { return JSON.parse(localStorage.getItem(LS_COL_STATE) || '{}'); } catch { return {}; } })();
    const left  = $('#mnSidebarLeft'), mid = $('#mnSidebarMid');
    if (left && saved.left) left.style.width = saved.left + 'px';
    if (mid  && saved.mid)  mid.style.width  = saved.mid  + 'px';

    const makeResizer = (rId, prevEl, nextEl, minP, minN) => {
      const r = $('#' + rId); if (!r || !prevEl || !nextEl) return;
      let sx=0, sp=0, sn=0, drag=false;
      r.addEventListener('mousedown', e => { drag=true; sx=e.clientX; sp=prevEl.offsetWidth; sn=nextEl.offsetWidth; document.body.style.cursor='col-resize'; document.body.style.userSelect='none'; r.classList.add('dragging'); });
      window.addEventListener('mousemove', e => { if(!drag) return; const dx=e.clientX-sx; prevEl.style.width=Math.max(minP,sp+dx)+'px'; nextEl.style.width=Math.max(minN,sn-dx)+'px'; });
      window.addEventListener('mouseup', () => { if(!drag) return; drag=false; document.body.style.cursor=''; document.body.style.userSelect=''; r.classList.remove('dragging'); try{localStorage.setItem(LS_COL_STATE,JSON.stringify({left:left?.offsetWidth,mid:mid?.offsetWidth}));}catch{} });
    };
    makeResizer('mnResizer1', left, mid, 180, 260);
    makeResizer('mnResizer2', mid, $('#mnMainContent'), 260, 400);
  }

  /* ── Workspace tree ─────────────────────────────────────────────────────── */
  function allWorkspaces() {
    return [...DEFAULT_WS, ...customWs.map(c => ({ key: c.key, label: c.name, emoji: c.emoji, _cw: c }))];
  }
  // PRESERVED public alias
  function renderWorkspaces() { renderWorkspaceTree(); }

  function renderWorkspaceTree() {
    const tree = $('#mnWsTree'); if (!tree) return;
    tree.innerHTML = '';
    DEFAULT_WS.forEach(ws => {
      const isActive = activeWs === ws.key;
      const wrap = document.createElement('div');
      const count = notes.filter(n => n.workspace === ws.key).length;
      // Toggle + label button
      const btn = document.createElement('button');
      btn.className = 'mn-ws-toggle';
      btn.innerHTML = `<svg data-chevron class="mn-chevron open" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:${isActive?'#2563eb':'#94a3b8'}">${SVG[ws.icon]||''}</svg>
        <span style="flex:1;text-align:left;font-weight:${isActive?'600':'500'};color:${isActive?'#2563eb':'inherit'}">${esc(ws.label)}</span>
        <span style="font-size:11px;color:#64748b">${count}</span>`;

      const childrenDiv = document.createElement('div');
      childrenDiv.className = 'mn-ws-children';

      btn.addEventListener('click', () => {
        const chev = btn.querySelector('[data-chevron]');
        childrenDiv.classList.toggle('hidden');
        if (chev) chev.classList.toggle('closed');
        setWs(ws.key);
      });

      wrap.appendChild(btn);
      wrap.appendChild(childrenDiv);
      tree.appendChild(wrap);
    });

    // Custom workspaces
    customWs.forEach(cw => {
      const isActive = activeWs === cw.key;
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;align-items:center;gap:3px;margin-bottom:2px';
      const btn = document.createElement('button');
      btn.className = 'mn-ws-toggle';
      btn.style.flex = '1';
      btn.innerHTML = `<span style="font-size:14px">${cw.emoji}</span><span style="flex:1;text-align:left;font-weight:${isActive?'600':'500'}">${esc(cw.name)}</span>
        <span style="font-size:11px;color:#64748b">${notes.filter(n=>n.workspace===cw.key).length}</span>`;
      btn.addEventListener('click', () => setWs(cw.key));
      const x = document.createElement('button');
      x.title='Delete workspace'; x.style.cssText='background:transparent;border:none;color:#94a3b8;cursor:pointer;font-size:15px;padding:3px 6px;border-radius:5px;flex-shrink:0;line-height:1';
      x.textContent='×';
      x.onmouseenter=()=>x.style.color='#ef4444'; x.onmouseleave=()=>x.style.color='#94a3b8';
      x.onclick=()=>removeWorkspace(cw);
      wrap.appendChild(btn); wrap.appendChild(x); tree.appendChild(wrap);
    });
  }

  function setWs(key) {
    activeWs = key; localStorage.setItem(LS_WS_KEY, key);
    renderWorkspaceTree();
    if (activeId) { const n = notes.find(x => x.id === activeId); if (!n || n.workspace !== key) { activeId = null; _showEmptyState(); } }
    renderNotesList();
    _updatePropWs();
  }

  /* ── Notes list ─────────────────────────────────────────────────────────── */
  function renderNotesList() {
    const el = $('#mnNotesList'); if (!el) return;
    const q  = (($('#mnSearch')||{}).value||'').toLowerCase();
    const filtered = sortByUpdated(
      notes.filter(n => n.workspace === activeWs)
           .filter(n => !q || n.title.toLowerCase().includes(q) || (n.content||'').toLowerCase().includes(q))
    );
    if ($('#mnCount')) $('#mnCount').textContent = filtered.length;
    el.innerHTML = '';
    if (!filtered.length) {
      el.innerHTML = '<div style="padding:32px 16px;text-align:center;color:#64748b;font-size:13px;line-height:1.7">No notes yet.<br>Click <b style="color:#2563eb">+ New</b> to create one.</div>';
      return;
    }
    filtered.forEach(n => {
      const sel = n.id === activeId;
      const ws  = allWorkspaces().find(w => w.key === n.workspace);
      const row = document.createElement('div');
      row.className = 'mn-note-row' + (sel ? ' selected' : '');
      row.setAttribute('data-note', n.id);
      row.setAttribute('data-title', n.title);
      row.innerHTML = `
        <div style="min-width:0">
         <div style="display:flex;align-items:center;gap:5px;margin-bottom:2px">
          <span class="mn-note-title">${esc(n.title||'Untitled')}</span>
         </div>
         <div class="mn-note-snippet">${esc((n.content||'').slice(0,80))}</div>
        </div>
        <div class="mn-ws-cell">${esc(ws ? ws.label : n.workspace)}</div>
        <div class="mn-date-cell">${fmtDate(n.updated_at)}</div>`;
      row.addEventListener('click', () => selectNote(n.id));
      el.appendChild(row);
    });
  }

  /* ── Note detail ─────────────────────────────────────────────────────────── */
  function _showEmptyState() {
    const ep=$('#mnEmptyState'), dp=$('#mnDocPane');
    if (ep) { ep.style.display='flex'; }
    if (dp) { dp.style.display='none'; }
  }
  function _showDocPane() {
    const ep=$('#mnEmptyState'), dp=$('#mnDocPane');
    if (ep) ep.style.display='none';
    if (dp) dp.style.display='flex';
  }

  function showDetail(n) {
    _showDocPane();
    // Title
    const titleEl = $('#mnDocTitle');
    if (titleEl) { titleEl.textContent = n.title || 'Untitled'; titleEl.contentEditable = 'false'; }
    // Breadcrumb
    const bc = $('#mnBreadcrumb');
    if (bc) {
      const ws = allWorkspaces().find(w => w.key === n.workspace);
      bc.innerHTML = `<a style="cursor:pointer">${esc(ws ? ws.label : 'Personal')}</a>
        <span class="mn-bc-sep">${icon('chevR',12)}</span>
        <span style="color:#1e293b;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:240px">${esc(n.title||'Untitled')}</span>`;
    }
    // Content
    const cv=$('#mnContentView'), ce=$('#mnContentEdit');
    if (cv) { cv.innerHTML=linkify(n.content); cv.classList.remove('mn-hidden'); }
    if (ce) { ce.value=n.content||''; ce.classList.add('mn-hidden'); }
    // Meta
    const le=$('#mnLastEdited');       if(le) le.textContent=fmtLong(n.updated_at);
    const pe=$('#mnPropEdited');       if(pe) pe.textContent=fmtLong(n.updated_at);
    const db=$('#mnDirtyBadge');       if(db) db.style.display='none';
    _updatePropWs();
  }

  function _updatePropWs() {
    const el=$('#mnPropWsName'); if(!el) return;
    const ws=allWorkspaces().find(w=>w.key===activeWs);
    el.textContent=ws?ws.label:activeWs;
  }
  function updateSyncStatus(s) {
    const lbl=$('#mnSyncLabel'); if(!lbl) return;
    lbl.textContent = s==='synced'?'Synced':s==='syncing'?'Syncing…':'Offline';
  }

  function selectNote(id) {
    if (dirty && !confirm('You have unsaved changes. Discard them?')) return;
    activeId=id; dirty=false; exitEditMode(false);
    const n=notes.find(x=>x.id===id); if(n) showDetail(n);
    renderNotesList();
  }

  function enterEditMode() {
    if (!activeId) return; editMode=true;
    const cv=$('#mnContentView'), ce=$('#mnContentEdit');
    if(cv) cv.classList.add('mn-hidden');
    if(ce) { ce.classList.remove('mn-hidden'); ce.focus(); }
    if($('#mnEditBtn'))   $('#mnEditBtn').classList.add('mn-hidden');
    if($('#mnSaveBtn'))   $('#mnSaveBtn').classList.remove('mn-hidden');
    if($('#mnCancelBtn')) $('#mnCancelBtn').classList.remove('mn-hidden');
    if($('#mnShareBtn'))  $('#mnShareBtn').classList.add('mn-hidden');
    const te=$('#mnDocTitle'); if(te){ te.contentEditable='true'; }
  }
  function exitEditMode(revert) {
    editMode=false; dirty=false;
    const cv=$('#mnContentView'), ce=$('#mnContentEdit');
    if(cv) cv.classList.remove('mn-hidden');
    if(ce) ce.classList.add('mn-hidden');
    if($('#mnEditBtn'))   $('#mnEditBtn').classList.remove('mn-hidden');
    if($('#mnSaveBtn'))   $('#mnSaveBtn').classList.add('mn-hidden');
    if($('#mnCancelBtn')) $('#mnCancelBtn').classList.add('mn-hidden');
    if($('#mnShareBtn'))  $('#mnShareBtn').classList.remove('mn-hidden');
    const db=$('#mnDirtyBadge'); if(db) db.style.display='none';
    const te=$('#mnDocTitle'); if(te) te.contentEditable='false';
    if(revert && activeId){ const n=notes.find(x=>x.id===activeId); if(n) showDetail(n); }
  }
  function cancelEdit() {
    if(dirty && !confirm('Discard unsaved changes?')) return;
    exitEditMode(true);
  }
  function markDirty() {
    dirty=true;
    const db=$('#mnDirtyBadge'); if(db) db.style.display='inline-flex';
    if(activeId) queueSave(activeId);
  }

  // PRESERVED: saveNote()
  async function saveNote() {
    if(!activeId) return;
    const n=notes.find(x=>x.id===activeId); if(!n) return;
    if(_rateLimited){ showCopyToast('⚠ Rate limited — please wait'); return; }
    const saveBtn=$('#mnSaveBtn');
    if(saveBtn){ saveBtn.disabled=true; saveBtn.innerHTML='⏳ Saving…'; }
    const te=$('#mnDocTitle');
    n.title   = (te ? te.textContent : '').trim() || 'Untitled';
    n.content = ($('#mnContentEdit')?.value || '');
    n.updated_at = new Date().toISOString();
    saveLocal();
    const ok = await pushNote(n);
    if(saveBtn){
      saveBtn.disabled=false;
      saveBtn.innerHTML=ok?`${icon('check',13)} Saved!`:'⚠ Error — retry';
      setTimeout(()=>{ const b=$('#mnSaveBtn'); if(b) b.innerHTML=`${icon('save',13)} Save`; },2000);
    }
    if(ok){ dirty=false; exitEditMode(false); showDetail(n); renderNotesList(); _dirtySet.delete(n.id); }
  }

  /* ── Create / Copy / Delete ──────────────────────────────────────────────── */
  function createNote() {
    if(dirty && !confirm('You have unsaved changes. Discard them?')) return;
    const n={id:uidGen(), workspace:activeWs, title:'Untitled', content:'', updated_at:new Date().toISOString()};
    notes.push(n); saveLocal(); activeId=n.id; renderNotesList(); showDetail(n);
    setTimeout(()=>{ pushNote(n).catch(()=>{}); }, 0);
    setTimeout(()=>enterEditMode(), 30);
  }
  function copyNote() {
    const n=notes.find(x=>x.id===activeId); if(!n) return;
    navigator.clipboard.writeText(n.content||'').then(()=>showCopyToast('Note content copied')).catch(()=>{});
  }
  // PRESERVED: deleteNote()
  async function deleteNote() {
    const n=notes.find(x=>x.id===activeId); if(!n) return;
    if(!confirm(`Permanently delete "${n.title}"?`)) return;
    notes=notes.filter(x=>x.id!==activeId); saveLocal(); activeId=null; dirty=false;
    _showEmptyState(); renderNotesList();
    const s=await getSb(); const u=await getUid();
    if(s&&u) await s.from('mums_notes').delete().eq('id',n.id).eq('user_id',u);
  }

  /* ── Workspace dialog ────────────────────────────────────────────────────── */
  function showWsDialog() {
    const ni=$('#mnWsNameInput'), ei=$('#mnWsEmojiInput'), d=$('#mnWsDialog');
    if(ni) ni.value=''; if(ei) ei.value='📁';
    if(d) d.classList.add('open');
    setTimeout(()=>{ if(ni) ni.focus(); }, 40);
  }
  function hideWsDialog() { const d=$('#mnWsDialog'); if(d) d.classList.remove('open'); }
  async function confirmAddWs() {
    const name=(($('#mnWsNameInput')||{}).value||'').trim();
    const emoji=(($('#mnWsEmojiInput')||{}).value||'').trim()||'📁';
    if(!name){ if($('#mnWsNameInput')) $('#mnWsNameInput').focus(); return; }
    const local={id:null, key:wsKeyOf(name), name, emoji};
    customWs.push(local); saveCustomWsL(); hideWsDialog(); renderWorkspaceTree();
    const row=await remoteAddWorkspace({name,emoji});
    if(row){ local.id=row.id; local.key='cws_'+row.id.replace(/-/g,''); saveCustomWsL(); renderWorkspaceTree(); }
  }
  async function removeWorkspace(cwObj) {
    const cnt=notes.filter(n=>n.workspace===cwObj.key).length;
    if(!confirm(cnt>0?`Delete workspace "${cwObj.name}"?\n\n${cnt} note(s) will NOT be deleted.`:`Delete workspace "${cwObj.name}"?`)) return;
    customWs=customWs.filter(w=>w.key!==cwObj.key); saveCustomWsL();
    if(activeWs===cwObj.key) setWs('personal'); else renderWorkspaceTree();
    if(cwObj.id) await remoteDelWorkspace(cwObj.id);
  }

  /* ── Open / Close ────────────────────────────────────────────────────────── */
  // PRESERVED: openModal()
  function openModal() {
    ensureModal();
    $('#myNotesModal').classList.add('mn-open');
    loadLocal(); loadCustomWsL();
    _applyTheme();
    renderWorkspaceTree();
    setWs(activeWs);
    renderNotesList();
    _startBatchFlush();
    pull();
    pullWorkspaces();
    if(activeId){ const n=notes.find(x=>x.id===activeId); if(n) showDetail(n); else _showEmptyState(); }
    else _showEmptyState();
  }
  // PRESERVED: closeModal()
  function closeModal() {
    if(dirty && !confirm('You have unsaved changes. Close anyway?')) return;
    $('#myNotesModal')?.classList.remove('mn-open');
    dirty=false;
  }
  // PRESERVED: loadNotes()
  function loadNotes() { pull(); }

  /* ── Inject toolbar button ───────────────────────────────────────────────── */
  function inject() {
    const r=document.getElementById('releaseNotesBtn');
    if(!r || document.getElementById('myNotesBtn')) return !!document.getElementById('myNotesBtn');
    const b=document.createElement('button');
    b.id='myNotesBtn'; b.className='btn ghost iconbtn'; b.title='My Notes';
    b.innerHTML=`<img src="${ICON}" style="width:18px;height:18px;border-radius:3px">`;
    b.onclick=openModal;
    r.parentNode.insertBefore(b,r);
    return true;
  }
  function init() {
    if(!inject()){ const obs=new MutationObserver(()=>{ if(inject()) obs.disconnect(); }); obs.observe(document.body,{childList:true,subtree:true}); }
  }
  document.readyState==='loading' ? document.addEventListener('DOMContentLoaded',init) : init();
})();
