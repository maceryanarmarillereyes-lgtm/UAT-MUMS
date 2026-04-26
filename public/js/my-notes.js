/* My Notes v3 — MUMS Command Center
 * Features:
 *  1. Edit → Save workflow (explicit Save to Supabase, no accidental overwrites)
 *  2. Last-modified timestamp displayed per note
 *  3. Add / Delete custom workspace folders (Supabase-backed)
 *  4. Clickable URLs in view mode
 */
(function () {
  'use strict';

  /* ── Constants ─────────────────────────────────────────────────────────── */
  const ICON         = '/Widget%20Images/MY_NOTES.png';
  const LS_CACHE     = 'mums_notes_v3';
  const LS_WS_KEY    = 'mums_notes_active_ws';
  const LS_CUSTOM_WS = 'mums_notes_custom_ws';
  const DEFAULT_WS   = [
    { key: 'personal', label: 'Personal', emoji: '📁' },
    { key: 'team',     label: 'Team',     emoji: '👥' },
    { key: 'projects', label: 'Projects', emoji: '📦' },
  ];

  /* ── State ──────────────────────────────────────────────────────────────── */
  let notes    = [];
  let customWs = [];          // [{ id, key, name, emoji }]
  let activeId = null;
  let activeWs = localStorage.getItem(LS_WS_KEY) || 'personal';
  let editMode = false;
  let dirty    = false;       // unsaved changes in current edit session
  let sb       = null;
  let uid      = null;

  /* ── Helpers ────────────────────────────────────────────────────────────── */
  const $ = s => document.querySelector(s);
  // Generates a proper RFC-4122 v4 UUID required by Supabase uuid columns.
  // Uses crypto.randomUUID() (Chrome 92+, Firefox 95+, Safari 15.4+) with a
  // pure-JS fallback for older environments.
  function uidGen() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    // Fallback: manual v4 UUID
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
  const wsKeyOf = name => 'cws_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now();
  const sortAZ  = arr => arr.slice().sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
  const esc     = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  function fmtDate(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString(undefined, {
        year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'
      });
    } catch { return iso; }
  }

  /* Detect http/https URLs and make them clickable (view-mode only) */
  function linkify(text) {
    if (!text) return '';
    const safe = esc(text);
    return safe.replace(/(https?:\/\/[^\s<>&"]+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer" ' +
      'style="color:#38bdf8;text-decoration:underline;word-break:break-all" ' +
      'onclick="event.stopPropagation()">$1</a>');
  }

  /* ── Supabase ───────────────────────────────────────────────────────────── */
  // PERMANENT FIX: Reuse the app-wide shared client (window.__MUMS_SB_CLIENT)
  // instead of spawning a second GoTrueClient. That client is already fully
  // authenticated (access_token + refresh_token) by services-supabase.js.
  // Creating a second client with an empty refresh_token caused the RLS
  // "new row violates row-level security" 401 errors because auth.uid()
  // returned null for every request.
  const LS_SESSION = 'mums_supabase_session';

  function readSession() {
    const sources = [
      () => localStorage.getItem(LS_SESSION),
      () => sessionStorage.getItem(LS_SESSION),
      () => { const m = document.cookie.match('(?:^|;)\\s*' + LS_SESSION + '=([^;]*)'); return m ? decodeURIComponent(m[1]) : null; }
    ];
    for (const src of sources) {
      try { const r = src(); if (r) { const p = JSON.parse(r); if (p && p.access_token) return p; } } catch (_) {}
    }
    return null;
  }

  async function getSb() {
    // Prefer the already-authenticated shared client
    if (window.__MUMS_SB_CLIENT) return window.__MUMS_SB_CLIENT;

    // Fallback: build our own client (e.g. page loaded without services-supabase)
    if (sb) return sb;
    const e = window.MUMS_ENV || {};
    if (!e.SUPABASE_URL) return null;
    if (!window.supabase?.createClient) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
    }
    sb = window.supabase.createClient(e.SUPABASE_URL, e.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    // Restore full session (both tokens) so auth.uid() works and RLS passes
    const sess = readSession();
    if (sess && sess.access_token && sess.refresh_token) {
      await sb.auth.setSession({ access_token: sess.access_token, refresh_token: sess.refresh_token }).catch(() => {});
    }
    return sb;
  }

  async function getUid() {
    if (uid) return uid;
    // Try the shared client first (most reliable)
    if (window.__MUMS_SB_CLIENT) {
      try {
        const { data } = await window.__MUMS_SB_CLIENT.auth.getUser();
        if (data?.user?.id) { uid = data.user.id; return uid; }
      } catch (_) {}
    }
    // Fallback: read from cached session token
    const sess = readSession();
    if (sess && sess.user && sess.user.id) { uid = sess.user.id; return uid; }
    // Last resort: decode sub from JWT without verifying (read-only, no crypto needed)
    const token = sess && sess.access_token;
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
        if (payload.sub) { uid = payload.sub; return uid; }
      } catch (_) {}
    }
    return null;
  }

  /* ── Local cache ────────────────────────────────────────────────────────── */
  function loadLocal()       { try { notes    = JSON.parse(localStorage.getItem(LS_CACHE)     || '[]'); } catch { notes    = []; } }
  function saveLocal()       { try { localStorage.setItem(LS_CACHE,     JSON.stringify(notes));    } catch {} }
  function loadCustomWsL()   { try { customWs = JSON.parse(localStorage.getItem(LS_CUSTOM_WS) || '[]'); } catch { customWs = []; } }
  function saveCustomWsL()   { try { localStorage.setItem(LS_CUSTOM_WS, JSON.stringify(customWs)); } catch {} }

  /* ── Remote: notes ──────────────────────────────────────────────────────── */
  async function pull() {
    const s = await getSb(); const u = await getUid();
    if (!s || !u) return;
    const { data } = await s.from('mums_notes').select('*').eq('user_id', u);
    notes = (data || []).map(r => ({
      id: r.id, workspace: r.workspace || 'personal',
      title: r.title || 'Untitled', content: r.content || '',
      updated_at: r.updated_at
    }));
    saveLocal(); render();
    // Refresh detail if a note is open
    if (activeId) { const n = notes.find(x => x.id === activeId); if (n && !editMode) showDetail(n); }
  }

  // UUID v4 pattern (8-4-4-4-12 hex)
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  async function pushNote(n) {
    const s = await getSb(); const u = await getUid();
    if (!s || !u) return false;
    // Guard: if note has a legacy non-UUID id (from old uidGen), mint a proper one.
    // This silently migrates any notes created before the uuid fix.
    if (!UUID_RE.test(n.id)) {
      const newId = uidGen();
      // Remove old local-only record, adopt the new uuid
      notes = notes.filter(x => x.id !== n.id);
      n.id = newId;
      notes.push(n);
      saveLocal();
      activeId = n.id;
    }
    const { error } = await s.from('mums_notes').upsert(
      { id: n.id, user_id: u, workspace: n.workspace, title: n.title, content: n.content, updated_at: n.updated_at },
      { onConflict: 'id' }
    );
    if (error) console.error('[MyNotes] pushNote:', error.message);
    return !error;
  }

  /* ── Remote: custom workspaces ──────────────────────────────────────────── */
  async function pullWorkspaces() {
    const s = await getSb(); const u = await getUid();
    if (!s || !u) return;
    try {
      const { data, error } = await s.from('mums_notes_workspaces').select('*').eq('user_id', u).order('sort_order');
      // Table may not exist yet if the migration hasn't been applied — fail silently
      if (error) { console.info('[MyNotes] pullWorkspaces (migration pending):', error.message); return; }
      if (data) {
        customWs = data.map(r => ({ id: r.id, key: 'cws_' + r.id.replace(/-/g,''), name: r.name, emoji: r.emoji || '📁' }));
        saveCustomWsL();
      }
    } catch (err) {
      console.info('[MyNotes] pullWorkspaces skipped:', err && err.message);
    }
    renderWorkspaces();
  }

  async function remoteAddWorkspace(ws) {
    const s = await getSb(); const u = await getUid();
    if (!s || !u) return null;
    try {
      const { data, error } = await s.from('mums_notes_workspaces')
        .insert({ user_id: u, name: ws.name, emoji: ws.emoji, sort_order: customWs.length })
        .select().single();
      // Workspace table may not exist yet — workspace stays local-only until migration runs
      if (error) { console.info('[MyNotes] addWorkspace (migration pending):', error.message); return null; }
      return data;
    } catch (err) {
      console.info('[MyNotes] addWorkspace skipped:', err && err.message);
      return null;
    }
  }

  async function remoteDelWorkspace(id) {
    const s = await getSb(); const u = await getUid();
    if (!s || !u) return;
    try {
      await s.from('mums_notes_workspaces').delete().eq('id', id).eq('user_id', u);
    } catch (err) {
      console.info('[MyNotes] remoteDelWorkspace skipped:', err && err.message);
    }
  }

  /* ── Modal HTML ─────────────────────────────────────────────────────────── */
  function ensureModal() {
    if ($('#myNotesModal')) return;
    document.body.insertAdjacentHTML('beforeend', `
<div id="myNotesModal" class="modal" style="z-index:9999;display:none">
 <div class="panel" style="max-width:1400px;width:95vw;height:90vh;display:flex;flex-direction:column;
   background:linear-gradient(145deg,rgba(15,23,42,.97),rgba(2,6,23,.99));
   border:1px solid rgba(56,189,248,.25);border-radius:18px;overflow:hidden">

  <!-- Header -->
  <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;
    border-bottom:1px solid rgba(255,255,255,.07);flex-shrink:0">
   <div style="display:flex;align-items:center;gap:10px">
    <img src="${ICON}" style="width:24px;height:24px;border-radius:4px">
    <span style="font-weight:900;color:#fff;font-size:15px">My Notes</span>
    <span style="font-size:11px;padding:2px 9px;background:rgba(245,158,11,.18);color:#fbbf24;border-radius:999px;font-weight:700">COMMAND CENTER</span>
   </div>
   <button class="btn ghost" data-close="1" style="color:#94a3b8;font-size:18px;padding:4px 10px">✕</button>
  </div>

  <!-- Body -->
  <div style="display:flex;flex:1;min-height:0">

   <!-- ① Workspace sidebar -->
   <div id="mnWsSidebar" style="width:210px;flex-shrink:0;border-right:1px solid rgba(255,255,255,.06);
     padding:12px;display:flex;flex-direction:column;gap:2px;overflow-y:auto">
    <div style="font-size:10px;letter-spacing:.1em;color:#475569;margin-bottom:8px;font-weight:700">WORKSPACES</div>
    <div id="mnDefaultWsList"></div>
    <div id="mnCustomWsList" style="margin-top:4px"></div>
    <div style="margin-top:auto;padding-top:10px;border-top:1px solid rgba(255,255,255,.05)">
     <button id="mnAddWsBtn" style="width:100%;text-align:left;font-size:12px;color:#64748b;
       padding:8px 10px;border-radius:8px;background:transparent;border:1px dashed rgba(255,255,255,.1);
       cursor:pointer;display:flex;align-items:center;gap:6px;transition:border-color .15s">
      <span style="font-size:15px;line-height:1">＋</span> Add Workspace
     </button>
    </div>
   </div>

   <!-- ② Notes list -->
   <div style="width:300px;flex-shrink:0;border-right:1px solid rgba(255,255,255,.06);display:flex;flex-direction:column">
    <div style="padding:10px;display:flex;gap:8px;flex-shrink:0">
     <input id="mnSearch" placeholder="Search..." style="flex:1;background:rgba(0,0,0,.3);
       border:1px solid rgba(255,255,255,.1);color:#fff;border-radius:8px;padding:8px 10px;font-size:13px">
     <button id="mnNew" class="btn primary" style="white-space:nowrap;padding:8px 14px;font-size:13px">+ New</button>
    </div>
    <div id="mnList" style="flex:1;overflow-y:auto;padding:0 8px 8px"></div>
    <div style="padding:8px 12px;font-size:11px;color:#475569;border-top:1px solid rgba(255,255,255,.05)">
     A-Z • <span id="mnCount">0</span>
    </div>
   </div>

   <!-- ③ Note detail -->
   <div style="flex:1;display:flex;flex-direction:column;min-width:0">

    <!-- Detail header bar -->
    <div style="padding:12px 14px 10px;border-bottom:1px solid rgba(255,255,255,.06);flex-shrink:0">
     <div id="mnTitleView" style="font-size:20px;font-weight:800;color:#fff;margin-bottom:4px;word-break:break-word;min-height:28px"></div>
     <input id="mnTitleEdit" placeholder="Untitled" style="display:none;width:100%;background:transparent;
       border:0;border-bottom:1px solid rgba(56,189,248,.4);color:#fff;font-size:20px;font-weight:800;
       outline:none;padding-bottom:4px;margin-bottom:4px;box-sizing:border-box">

     <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-top:6px">
      <div style="display:flex;align-items:center;gap:0;flex-wrap:wrap">
       <span style="font-size:11px;color:#475569">Workspace: <b id="mnWsLabel" style="color:#64748b"></b></span>
       <span id="mnUpdatedAt" style="font-size:11px;color:#475569;margin-left:14px"></span>
       <span id="mnDirtyBadge" style="display:none;font-size:11px;padding:1px 7px;
         background:rgba(245,158,11,.2);color:#fbbf24;border-radius:999px;margin-left:10px;font-weight:700">● Unsaved</span>
      </div>
      <!-- View mode buttons -->
      <div id="mnViewBtns" style="display:flex;gap:8px">
       <button id="mnEditBtn"  class="btn" style="background:rgba(56,189,248,.14);color:#38bdf8;padding:7px 14px;font-size:13px">✏️ Edit</button>
       <button id="mnCopyBtn"  class="btn" style="background:rgba(245,158,11,.14);color:#fde68a;padding:7px 14px;font-size:13px">📋 Copy</button>
       <button id="mnDelBtn"   class="btn ghost" style="color:#fca5a5;padding:7px 14px;font-size:13px">Delete</button>
      </div>
      <!-- Edit mode buttons -->
      <div id="mnEditBtns" style="display:none;gap:8px">
       <button id="mnSaveBtn"   class="btn primary" style="padding:7px 18px;font-size:13px;font-weight:700">💾 Save</button>
       <button id="mnCancelBtn" class="btn ghost"   style="color:#94a3b8;padding:7px 14px;font-size:13px">Cancel</button>
      </div>
     </div>
    </div>

    <!-- Content view (linkified) -->
    <div id="mnContentView" style="flex:1;overflow-y:auto;margin:12px;
      background:rgba(0,0,0,.18);border:1px solid rgba(255,255,255,.08);border-radius:12px;
      color:#e2e8f0;padding:16px;font-size:14px;line-height:1.7;
      white-space:pre-wrap;word-break:break-word"></div>

    <!-- Content edit -->
    <textarea id="mnContentEdit" placeholder="Start writing your note here..." style="
      display:none;flex:1;margin:12px;resize:none;
      background:rgba(0,0,0,.22);border:1px solid rgba(56,189,248,.3);border-radius:12px;
      color:#e2e8f0;padding:16px;font-size:14px;line-height:1.7;outline:none;
      font-family:inherit"></textarea>
   </div>
  </div>
 </div>
</div>

<!-- Add-workspace dialog -->
<div id="mnWsDialog" style="display:none;position:fixed;inset:0;z-index:10001;
  background:rgba(0,0,0,.65);align-items:center;justify-content:center">
 <div style="background:linear-gradient(145deg,rgba(15,23,42,.99),rgba(2,6,23,1));
   border:1px solid rgba(56,189,248,.3);border-radius:14px;padding:26px;
   width:340px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,.5)">
  <div style="font-weight:800;color:#fff;margin-bottom:6px;font-size:16px">New Workspace</div>
  <div style="font-size:12px;color:#475569;margin-bottom:16px">Choose an emoji and give your workspace a name.</div>
  <div style="display:flex;gap:10px;margin-bottom:16px">
   <input id="mnWsEmojiInput" value="📁" maxlength="4" style="width:56px;text-align:center;font-size:22px;
     background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.15);color:#fff;
     border-radius:8px;padding:8px">
   <input id="mnWsNameInput" placeholder="e.g. Finance, HR, Dev..." style="flex:1;
     background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.15);color:#fff;
     border-radius:8px;padding:8px 12px;font-size:14px">
  </div>
  <div style="display:flex;gap:8px;justify-content:flex-end">
   <button id="mnWsDlgCancel" class="btn ghost" style="color:#94a3b8;padding:8px 16px">Cancel</button>
   <button id="mnWsDlgCreate" class="btn primary" style="padding:8px 18px;font-weight:700">Create</button>
  </div>
 </div>
</div>`);

    /* ── Event bindings ── */
    $('#myNotesModal').onclick = e => { if (e.target.dataset.close) closeModal(); };
    $('#mnNew').onclick        = createNote;
    $('#mnSearch').oninput     = render;
    $('#mnEditBtn').onclick    = enterEditMode;
    $('#mnSaveBtn').onclick    = saveNote;
    $('#mnCancelBtn').onclick  = cancelEdit;
    $('#mnCopyBtn').onclick    = copyNote;
    $('#mnDelBtn').onclick     = deleteNote;
    $('#mnTitleEdit').oninput   = markDirty;
    $('#mnContentEdit').oninput = markDirty;

    $('#mnAddWsBtn').onclick  = showWsDialog;
    $('#mnWsDlgCancel').onclick = hideWsDialog;
    $('#mnWsDlgCreate').onclick = confirmAddWs;
    $('#mnWsNameInput').addEventListener('keydown', e => { if (e.key === 'Enter') confirmAddWs(); });
    $('#mnWsDialog').onclick   = e => { if (e.target === $('#mnWsDialog')) hideWsDialog(); };
  }

  /* ── Workspace sidebar ──────────────────────────────────────────────────── */
  function allWorkspaces() {
    return [...DEFAULT_WS, ...customWs.map(c => ({ key: c.key, label: c.name, emoji: c.emoji, _cw: c }))];
  }

  function renderWorkspaces() {
    const defEl = $('#mnDefaultWsList');
    const cusEl = $('#mnCustomWsList');
    if (!defEl || !cusEl) return;
    defEl.innerHTML = '';
    DEFAULT_WS.forEach(ws => defEl.appendChild(buildWsBtn(ws, false)));
    cusEl.innerHTML = '';
    customWs.forEach(cw => cusEl.appendChild(buildWsBtn({ key: cw.key, label: cw.name, emoji: cw.emoji }, true, cw)));
  }

  function buildWsBtn(ws, deletable, cwObj) {
    const active = activeWs === ws.key;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;align-items:center;gap:3px;margin-bottom:2px';

    const btn = document.createElement('button');
    btn.dataset.ws = ws.key;
    btn.style.cssText = `
      flex:1;text-align:left;padding:9px 10px;border-radius:8px;cursor:pointer;font-size:13px;
      background:${active ? 'rgba(56,189,248,.18)' : 'rgba(255,255,255,.02)'};
      border:1px solid ${active ? 'rgba(56,189,248,.35)' : 'transparent'};
      color:${active ? '#38bdf8' : '#cbd5e1'};
      font-weight:${active ? '700' : '500'};transition:all .12s`;
    btn.textContent = ws.emoji + '  ' + ws.label;
    btn.onclick = () => setWs(ws.key);
    wrap.appendChild(btn);

    if (deletable && cwObj) {
      const x = document.createElement('button');
      x.title = 'Delete workspace';
      x.style.cssText = 'background:transparent;border:none;color:#334155;cursor:pointer;' +
        'font-size:16px;padding:3px 6px;border-radius:6px;flex-shrink:0;line-height:1;transition:color .1s';
      x.textContent = '×';
      x.onmouseenter = () => x.style.color = '#fca5a5';
      x.onmouseleave = () => x.style.color = '#334155';
      x.onclick = () => removeWorkspace(cwObj);
      wrap.appendChild(x);
    }
    return wrap;
  }

  function setWs(key) {
    activeWs = key;
    localStorage.setItem(LS_WS_KEY, key);
    renderWorkspaces();
    const ws = allWorkspaces().find(w => w.key === key);
    if ($('#mnWsLabel')) $('#mnWsLabel').textContent = ws ? ws.label : key;
    // If active note not in this workspace, deselect
    if (activeId) {
      const n = notes.find(x => x.id === activeId);
      if (!n || n.workspace !== key) { activeId = null; exitEditMode(false); clearDetail(); }
    }
    render();
  }

  /* ── Add workspace dialog ───────────────────────────────────────────────── */
  function showWsDialog() {
    if ($('#mnWsNameInput'))  $('#mnWsNameInput').value  = '';
    if ($('#mnWsEmojiInput')) $('#mnWsEmojiInput').value = '📁';
    const d = $('#mnWsDialog'); if (d) d.style.display = 'flex';
    setTimeout(() => { if ($('#mnWsNameInput')) $('#mnWsNameInput').focus(); }, 40);
  }
  function hideWsDialog() { const d = $('#mnWsDialog'); if (d) d.style.display = 'none'; }

  async function confirmAddWs() {
    const name  = (($('#mnWsNameInput')  || {}).value || '').trim();
    const emoji = (($('#mnWsEmojiInput') || {}).value || '').trim() || '📁';
    if (!name) { if ($('#mnWsNameInput')) $('#mnWsNameInput').focus(); return; }

    // Optimistic: add locally first
    const tempKey = wsKeyOf(name);
    const local   = { id: null, key: tempKey, name, emoji };
    customWs.push(local);
    saveCustomWsL();
    hideWsDialog();
    renderWorkspaces();

    // Push to Supabase → replace temp key with stable db-derived key
    const row = await remoteAddWorkspace({ name, emoji });
    if (row) {
      local.id  = row.id;
      local.key = 'cws_' + row.id.replace(/-/g, '');
      saveCustomWsL();
      renderWorkspaces();
    }
  }

  async function removeWorkspace(cwObj) {
    const noteCount = notes.filter(n => n.workspace === cwObj.key).length;
    const msg = noteCount > 0
      ? `Delete workspace "${cwObj.name}"?\n\n${noteCount} note(s) in this workspace will NOT be deleted — they stay in your account.`
      : `Delete workspace "${cwObj.name}"?`;
    if (!confirm(msg)) return;

    customWs = customWs.filter(w => w.key !== cwObj.key);
    saveCustomWsL();
    if (activeWs === cwObj.key) setWs('personal');
    else renderWorkspaces();

    if (cwObj.id) await remoteDelWorkspace(cwObj.id);
  }

  /* ── Notes list ─────────────────────────────────────────────────────────── */
  function render() {
    const el  = $('#mnList');
    if (!el) return;
    const q   = (($('#mnSearch') || {}).value || '').toLowerCase();
    const ws  = allWorkspaces().find(w => w.key === activeWs);
    if ($('#mnWsLabel')) $('#mnWsLabel').textContent = ws ? ws.label : activeWs;

    const filtered = sortAZ(
      notes.filter(n => n.workspace === activeWs)
           .filter(n => !q || n.title.toLowerCase().includes(q) || (n.content||'').toLowerCase().includes(q))
    );
    if ($('#mnCount')) $('#mnCount').textContent = filtered.length;
    el.innerHTML = '';

    if (!filtered.length) {
      el.innerHTML = '<div style="padding:24px 12px;text-align:center;color:#475569;font-size:13px;line-height:1.6">' +
        'No notes yet.<br><b style="color:#64748b">+ New</b> to create one.</div>';
      return;
    }

    filtered.forEach(n => {
      const active = n.id === activeId;
      const d = document.createElement('div');
      d.style.cssText = `
        padding:10px 12px;margin:2px 0;border-radius:9px;cursor:pointer;
        background:${active ? 'rgba(56,189,248,.13)' : 'rgba(255,255,255,.02)'};
        border:1px solid ${active ? 'rgba(56,189,248,.28)' : 'transparent'};
        transition:background .1s;user-select:none`;
      d.innerHTML = `
        <div style="font-weight:700;color:#e2e8f0;font-size:13px;margin-bottom:3px;
          white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(n.title||'Untitled')}</div>
        <div style="font-size:11px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          ${esc((n.content||'').slice(0,60))}</div>
        <div style="font-size:10px;color:#334155;margin-top:5px">🕐 ${fmtDate(n.updated_at)}</div>`;
      d.onclick = () => selectNote(n.id);
      el.appendChild(d);
    });
  }

  /* ── Note detail ────────────────────────────────────────────────────────── */
  function clearDetail() {
    if ($('#mnTitleView'))    $('#mnTitleView').textContent  = '';
    if ($('#mnContentView'))  $('#mnContentView').innerHTML  = '';
    if ($('#mnTitleEdit'))    $('#mnTitleEdit').value        = '';
    if ($('#mnContentEdit'))  $('#mnContentEdit').value      = '';
    if ($('#mnUpdatedAt'))    $('#mnUpdatedAt').textContent  = '';
    if ($('#mnDirtyBadge'))   $('#mnDirtyBadge').style.display = 'none';
    exitEditMode(false);
    render();
  }

  function showDetail(n) {
    if ($('#mnTitleView'))    $('#mnTitleView').textContent  = n.title || 'Untitled';
    if ($('#mnContentView'))  $('#mnContentView').innerHTML  = linkify(n.content);
    if ($('#mnTitleEdit'))    $('#mnTitleEdit').value        = n.title || '';
    if ($('#mnContentEdit'))  $('#mnContentEdit').value      = n.content || '';
    if ($('#mnUpdatedAt'))    $('#mnUpdatedAt').textContent  = n.updated_at ? '🕐 Last updated: ' + fmtDate(n.updated_at) : '';
    if ($('#mnDirtyBadge'))   $('#mnDirtyBadge').style.display = 'none';
  }

  function selectNote(id) {
    if (dirty && !confirm('You have unsaved changes. Discard them?')) return;
    activeId = id;
    dirty    = false;
    exitEditMode(false);
    const n = notes.find(x => x.id === id);
    if (n) showDetail(n);
    render();
  }

  function enterEditMode() {
    if (!activeId) return;
    editMode = true;
    // Swap views
    if ($('#mnTitleView'))    $('#mnTitleView').style.display    = 'none';
    if ($('#mnTitleEdit'))    { $('#mnTitleEdit').style.display  = 'block'; }
    if ($('#mnContentView'))  $('#mnContentView').style.display  = 'none';
    if ($('#mnContentEdit'))  { $('#mnContentEdit').style.display = 'block'; }
    // Swap button bars
    if ($('#mnViewBtns'))  $('#mnViewBtns').style.display  = 'none';
    if ($('#mnEditBtns'))  $('#mnEditBtns').style.display  = 'flex';
    if ($('#mnTitleEdit')) $('#mnTitleEdit').focus();
  }

  function exitEditMode(revert) {
    editMode = false;
    dirty    = false;
    if ($('#mnTitleView'))    $('#mnTitleView').style.display    = 'block';
    if ($('#mnTitleEdit'))    $('#mnTitleEdit').style.display    = 'none';
    if ($('#mnContentView'))  $('#mnContentView').style.display  = 'block';
    if ($('#mnContentEdit'))  $('#mnContentEdit').style.display  = 'none';
    if ($('#mnViewBtns'))     $('#mnViewBtns').style.display     = 'flex';
    if ($('#mnEditBtns'))     $('#mnEditBtns').style.display     = 'none';
    if ($('#mnDirtyBadge'))   $('#mnDirtyBadge').style.display   = 'none';
    if (revert && activeId) { const n = notes.find(x => x.id === activeId); if (n) showDetail(n); }
  }

  function cancelEdit() {
    if (dirty && !confirm('Discard unsaved changes?')) return;
    exitEditMode(true);
  }

  function markDirty() {
    dirty = true;
    if ($('#mnDirtyBadge')) $('#mnDirtyBadge').style.display = 'inline-block';
  }

  async function saveNote() {
    if (!activeId) return;
    const n = notes.find(x => x.id === activeId);
    if (!n) return;

    const saveBtn = $('#mnSaveBtn');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '⏳ Saving…'; }

    n.title      = ($('#mnTitleEdit').value   || '').trim() || 'Untitled';
    n.content    = ($('#mnContentEdit').value || '');
    n.updated_at = new Date().toISOString();
    saveLocal();

    const ok = await pushNote(n);

    if (saveBtn) {
      saveBtn.disabled    = false;
      saveBtn.textContent = ok ? '✅ Saved!' : '⚠️ Error — retry';
      setTimeout(() => { if ($('#mnSaveBtn')) $('#mnSaveBtn').textContent = '💾 Save'; }, 2000);
    }

    if (ok) {
      dirty = false;
      exitEditMode(false);
      showDetail(n);
      render();
    }
  }

  /* ── Create / Copy / Delete ─────────────────────────────────────────────── */
  function createNote() {
    if (dirty && !confirm('You have unsaved changes. Discard them?')) return;
    const n = { id: uidGen(), workspace: activeWs, title: 'Untitled', content: '', updated_at: new Date().toISOString() };
    notes.push(n);
    saveLocal();
    activeId = n.id;
    render();
    showDetail(n);
    pushNote(n);                    // save empty note immediately
    setTimeout(() => enterEditMode(), 30);  // auto-open edit mode
  }

  function copyNote() {
    const n = notes.find(x => x.id === activeId);
    if (!n) return;
    navigator.clipboard.writeText(n.content || '').catch(() => {});
  }

  async function deleteNote() {
    const n = notes.find(x => x.id === activeId);
    if (!n) return;
    if (!confirm(`Permanently delete "${n.title}"?`)) return;
    notes = notes.filter(x => x.id !== activeId);
    saveLocal();
    activeId = null;
    dirty    = false;
    clearDetail();
    render();
    const s = await getSb(); const u = await getUid();
    if (s && u) await s.from('mums_notes').delete().eq('id', n.id).eq('user_id', u);
  }

  /* ── Open / Close ───────────────────────────────────────────────────────── */
  function openModal() {
    ensureModal();
    $('#myNotesModal').style.display = 'flex';
    loadLocal();
    loadCustomWsL();
    renderWorkspaces();
    setWs(activeWs);
    pull();
    pullWorkspaces();
  }

  function closeModal() {
    if (dirty && !confirm('You have unsaved changes. Close anyway?')) return;
    $('#myNotesModal').style.display = 'none';
    dirty = false;
  }

  /* ── Inject toolbar button ──────────────────────────────────────────────── */
  function inject() {
    const r = document.getElementById('releaseNotesBtn');
    if (!r || document.getElementById('myNotesBtn')) return !!document.getElementById('myNotesBtn');
    const b = document.createElement('button');
    b.id = 'myNotesBtn'; b.className = 'btn ghost iconbtn'; b.title = 'My Notes';
    b.innerHTML = `<img src="${ICON}" style="width:18px;height:18px;border-radius:3px">`;
    b.onclick = openModal;
    r.parentNode.insertBefore(b, r);
    return true;
  }

  function init() {
    if (!inject()) {
      const obs = new MutationObserver(() => { if (inject()) obs.disconnect(); });
      obs.observe(document.body, { childList: true, subtree: true });
    }
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init)
    : init();
})();
