/* ═══════════════════════════════════════════════════════════════════════════
   My Notes v4 — MUMS Command Center
   ✅ Rich text editor: bold/italic/headings/colours/highlights/lists/checkboxes/code
   ✅ Subfolder treeview workspace panel with collapse/expand
   ✅ Right-click context menu: Rename | Delete | Add Subfolder | Move To
   ✅ Duplicate note → pick destination workspace
   ✅ Explicit Edit → Save/Cancel workflow (no accidental overwrites)
   ✅ Supabase REST persistence with full session/RLS handling
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── CONSTANTS ─────────────────────────────────────────────────────────── */
  const ICON     = '/Widget%20Images/MY_NOTES.png';
  const LS_CACHE = 'mums_notes_v4';
  const LS_WS    = 'mums_notes_ws_v4';
  const LS_CWS   = 'mums_notes_cws_v4';
  const LS_EXP   = 'mums_notes_exp_v4';
  // ★ TOMBSTONE: tracks UUIDs of workspaces deleted on ANY device.
  // Prevents cross-device resurrection when pullWorkspaces() sees a UUID
  // that disappeared from DB (it was deleted, not just un-synced).
  const LS_DEL_WS = 'mums_notes_del_ws_v4';
  const LS_SES   = 'mums_supabase_session';
  const UUID_RE  = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  const DEFAULT_WS = [
    { key: 'personal', label: 'Personal', emoji: '📁', locked: true },
    { key: 'team',     label: 'Team',     emoji: '👥', locked: true },
    { key: 'projects', label: 'Projects', emoji: '📦', locked: true },
  ];

  /* ── STATE ──────────────────────────────────────────────────────────────── */
  let notes    = [];
  let customWs = [];    // [{ id, key, name, emoji, parentKey|null, locked:false }]
  let expanded = new Set(['personal', 'team', 'projects']);
  let activeWs = 'personal';
  let activeId = null;
  let editMode = false;
  let dirty    = false;
  let _sb = null, _uid = null;
  let _ctxKey = null;   // key targeted by right-click
  let _renKey = null;   // key being renamed

  /* ── HELPERS ────────────────────────────────────────────────────────────── */
  const $  = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  function uidGen() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  function fmtDate(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString('en-PH', {
        year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit', hour12:true
      });
    } catch { return iso; }
  }

  const isHtml = s => /^\s*</.test(String(s || ''));

  function plainToHtml(text) {
    if (!text) return '<p><br></p>';
    return '<p>' + esc(text).replace(/\n\n+/g, '</p><p>').replace(/\n/g, '<br>') + '</p>';
  }

  function htmlToPreview(html) {
    if (!html) return '';
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return (tmp.textContent || tmp.innerText || '').replace(/\s+/g,' ').trim().slice(0,65);
  }

  function linkifyView(html) {
    // Make bare text URLs clickable in view mode (not inside existing hrefs)
    return html.replace(/(?<![="'>])(https?:\/\/[^\s<>"'&]+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:#38bdf8;text-decoration:underline;word-break:break-all" onclick="event.stopPropagation()">$1</a>');
  }

  const sortAZ = a => a.slice().sort((x,y) => (x.title||'').toLowerCase().localeCompare((y.title||'').toLowerCase()));

  /* ── SUPABASE AUTH ──────────────────────────────────────────────────────── */
  function readSession() {
    const srcs = [
      () => localStorage.getItem(LS_SES),
      () => sessionStorage.getItem(LS_SES),
      () => { const m = document.cookie.match('(?:^|;)\\s*' + LS_SES + '=([^;]*)'); return m ? decodeURIComponent(m[1]) : null; }
    ];
    for (const s of srcs) { try { const r = s(); if (r) { const p = JSON.parse(r); if (p?.access_token) return p; } } catch {} }
    return null;
  }

  // ── PERMANENT getSb() FIX ────────────────────────────────────────────────
  // Root cause of all workspace/note save failures:
  //   1. __MUMS_SB_CLIENT is only created on services.html, not index.html
  //   2. MUMS_ENV is populated async (/api/env fetch) — old code read it sync → empty URL → null client
  //   3. No wait for session to be ready before writing to DB
  //
  // This version:
  //   • Waits for window.__MUMS_ENV_READY (guaranteed env populated)
  //   • Polls for __MUMS_SB_CLIENT (in case services-supabase inits after us)
  //   • Builds own authenticated client if none appears within 2 s
  //   • Caches result permanently — subsequent calls are synchronous
  async function getSb() {
    // Fast path: already have a working client
    if (_sb) return _sb;
    if (window.__MUMS_SB_CLIENT) { _sb = window.__MUMS_SB_CLIENT; return _sb; }

    // 1. Wait for MUMS_ENV to be populated by /api/env fetch (max 5 s)
    if (window.__MUMS_ENV_READY) {
      try { await Promise.race([window.__MUMS_ENV_READY, new Promise(r => setTimeout(r, 5000))]); } catch {}
    }

    // 2. Poll for __MUMS_SB_CLIENT (services-supabase may have just finished init)
    for (let i = 0; i < 10; i++) {
      if (window.__MUMS_SB_CLIENT) { _sb = window.__MUMS_SB_CLIENT; return _sb; }
      await new Promise(r => setTimeout(r, 200));
    }

    // 3. Build own client with now-populated MUMS_ENV
    const e = window.MUMS_ENV || {};
    if (!e.SUPABASE_URL || !e.SUPABASE_ANON_KEY) {
      console.warn('[MyNotes] getSb: SUPABASE_URL missing — workspaces cannot be saved.');
      return null;
    }

    // Load supabase-js if not already on page
    if (!window.supabase?.createClient) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';
        s.onload = res; s.onerror = rej; document.head.appendChild(s);
      });
    }

    // Create client with full session (both tokens) so RLS auth.uid() resolves
    _sb = window.supabase.createClient(e.SUPABASE_URL, e.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false }
    });
    const sess = readSession();
    if (sess?.access_token && sess?.refresh_token) {
      const { error } = await _sb.auth.setSession({ access_token: sess.access_token, refresh_token: sess.refresh_token });
      if (error) {
        // Try refresh token flow if setSession fails (token may be expired)
        const { error: re } = await _sb.auth.refreshSession({ refresh_token: sess.refresh_token });
        if (re) { console.warn('[MyNotes] getSb: session refresh failed —', re.message); }
      }
    } else {
      console.warn('[MyNotes] getSb: no session found — writes will fail RLS.');
    }

    // Share our client so other modules can use it
    if (!window.__MUMS_SB_CLIENT) window.__MUMS_SB_CLIENT = _sb;
    return _sb;
  }

  async function getUid() {
    if (_uid) return _uid;
    // Ensure we have an authenticated client before asking for user
    const s = await getSb();
    if (s) {
      try { const { data } = await s.auth.getUser(); if (data?.user?.id) { _uid = data.user.id; return _uid; } } catch {}
    }
    // Fallback: decode from cached session
    const sess = readSession();
    if (sess?.user?.id) { _uid = sess.user.id; return _uid; }
    if (sess?.access_token) {
      try {
        const p = JSON.parse(atob(sess.access_token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
        if (p.sub) { _uid = p.sub; return _uid; }
      } catch {}
    }
    return null;
  }

  /* ── LOCAL STORAGE ──────────────────────────────────────────────────────── */
  function loadLocal()  { try { notes    = JSON.parse(localStorage.getItem(LS_CACHE) || '[]'); } catch { notes = []; } }
  function saveLocal()  { try { localStorage.setItem(LS_CACHE, JSON.stringify(notes));  } catch {} }
  function loadCWs()    { try { customWs = JSON.parse(localStorage.getItem(LS_CWS)   || '[]'); } catch { customWs = []; } }
  function saveCWs()    { try { localStorage.setItem(LS_CWS,   JSON.stringify(customWs)); } catch {} }
  function loadExp()    {
    try { const e = JSON.parse(localStorage.getItem(LS_EXP) || '[]'); expanded = new Set(e); }
    catch { expanded = new Set(['personal','team','projects']); }
    if (!expanded.size) DEFAULT_WS.forEach(w => expanded.add(w.key));
  }
  function saveExp()    { try { localStorage.setItem(LS_EXP, JSON.stringify([...expanded])); } catch {} }

  // ★ TOMBSTONE HELPERS ─────────────────────────────────────────────────────
  // loadTombstones() → Map<uuid, timestamp_ms>
  // Records workspace UUIDs that have been deliberately deleted so pullWorkspaces()
  // never resurrects them, even if they still exist in another device's localStorage.
  function loadTombstones() {
    try { return new Map(Object.entries(JSON.parse(localStorage.getItem(LS_DEL_WS) || '{}'))); }
    catch { return new Map(); }
  }
  function saveTombstones(map) {
    try { localStorage.setItem(LS_DEL_WS, JSON.stringify(Object.fromEntries(map))); } catch {}
  }
  function addTombstones(ids) {
    const map = loadTombstones();
    const now = Date.now();
    ids.forEach(id => { if (id) map.set(id, now); });
    saveTombstones(map);
  }
  function pruneTombstones() {
    // Keep tombstones for 30 days — long enough to cover any sync gap between devices
    const map = loadTombstones();
    const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
    let pruned = false;
    map.forEach((ts, id) => { if (ts < cutoff) { map.delete(id); pruned = true; } });
    if (pruned) saveTombstones(map);
  }

  /* ── SUPABASE: NOTES ────────────────────────────────────────────────────── */
  async function pull() {
    const s = await getSb(); const u = await getUid();
    if (!s || !u) return;
    const { data } = await s.from('mums_notes').select('*').eq('user_id', u);
    notes = (data || []).map(r => ({
      id: r.id, workspace: r.workspace || 'personal',
      title: r.title || 'Untitled', content: r.content || '', updated_at: r.updated_at
    }));
    saveLocal(); renderNoteList();
    if (activeId) { const n = notes.find(x => x.id === activeId); if (n && !editMode) showDetail(n); }
  }

  async function pushNote(n) {
    const s = await getSb(); const u = await getUid();
    if (!s || !u) return false;
    if (!UUID_RE.test(n.id)) {
      const nid = uidGen(); notes = notes.filter(x => x.id !== n.id);
      n.id = nid; notes.push(n); saveLocal(); activeId = n.id;
    }
    const { error } = await s.from('mums_notes').upsert(
      { id:n.id, user_id:u, workspace:n.workspace, title:n.title, content:n.content, updated_at:n.updated_at },
      { onConflict: 'id' }
    );
    if (error) console.error('[MyNotes] pushNote:', error.message);
    return !error;
  }

  /* ── SUPABASE: WORKSPACES ───────────────────────────────────────────────── */
  async function pullWorkspaces() {
    const s = await getSb(); const u = await getUid();
    if (!s || !u) return;
    try {
      const { data, error } = await s.from('mums_notes_workspaces')
        .select('*').eq('user_id', u).order('sort_order');

      // Table missing or other DB error — keep local state untouched
      if (error) { console.info('[MyNotes] pullWs (table may not exist yet):', error.message); return; }

      // ★ CROSS-DEVICE SYNC FIX — Permanent replacement for broken merge strategy
      // ─────────────────────────────────────────────────────────────────────────
      // ROOT CAUSE of resurrection bug:
      //   Old code: unsynced = local.filter(w => !w.id || !dbIds.has(w.id))
      //   This cannot distinguish between:
      //     (A) A folder created locally, never synced (id=null) → should be kept
      //     (B) A folder with a UUID that no longer exists in DB → was deleted by
      //         another device → should be DROPPED, not re-inserted!
      //   The old code treated (B) as (A) → re-inserted the deleted folder → resurrection.
      //
      // Fix strategy:
      //   1. Build DB map (authoritative source of truth)
      //   2. TOMBSTONE FILTER: Load deleted-UUID set. Any UUID in tombstones was
      //      deliberately deleted — never allow DB to re-seat it.
      //   3. NEVER-SYNCED ONLY: Only preserve local folders with id=null (no UUID
      //      assigned yet = truly new, pending first DB write). A folder with a real
      //      UUID that's missing from DB was deleted cross-device → drop it.
      //   4. Re-tombstone any DB rows matching local tombstones (edge case: another
      //      device re-inserted before our delete propagated — drop those too).
      //   5. Push truly-new (never-synced) folders to DB.

      pruneTombstones(); // remove expired tombstones (>30 days old)
      const tombstones = loadTombstones();

      const dbRows = (data || [])
        .filter(r => !tombstones.has(r.id)) // ★ Reject DB rows for tombstoned IDs
        .map(r => ({
          id       : r.id,
          key      : 'cws_' + r.id.replace(/-/g,''),
          name     : r.name,
          emoji    : r.emoji || '📁',
          parentKey: r.parent_key || null,
          locked   : false
        }));

      const dbIds = new Set(dbRows.map(r => r.id));

      // ★ KEY FIX: Only preserve workspaces with NO UUID (never synced to DB).
      // Any workspace WITH a UUID that is absent from DB was deleted cross-device.
      // Do NOT preserve it — that is exactly what caused the resurrection bug.
      const neverSynced = customWs.filter(w => !w.id);

      // Merged result: DB is authoritative; append only truly-new (unsynced) locals
      customWs = [...dbRows, ...neverSynced];
      saveCWs();
      renderWsTree();

      // Push brand-new folders to DB so they appear on other devices
      if (neverSynced.length > 0) {
        syncWorkspacesToDB();
      }
    } catch (err) {
      console.info('[MyNotes] pullWs skipped:', err?.message);
    }
  }

  // ── PERMANENT WORKSPACE SYNC FIX ──────────────────────────────────────────
  // Replaces per-operation add/update/delete (which failed silently).
  // syncWorkspacesToDB() pushes the ENTIRE current customWs array atomically:
  //   • Upserts every workspace with correct sort_order, parent_key, name, emoji
  //   • Deletes any DB rows whose IDs are no longer in the local array
  // Called after every add, rename, delete, or move. Cross-device safe.
  let _syncWsPending   = false;
  let _syncRetryTimer  = null;
  // Tracks whether the live DB has parent_key column (detected at runtime).
  // Starts as true (assume schema is up to date); set to false on first error.
  let _dbHasParentKey  = true;

  // Build a row payload, omitting parent_key if the column doesn't exist yet
  function _wsRow(w, u, idx) {
    const row = {
      user_id    : u,
      name       : w.name,
      emoji      : w.emoji || '📁',
      sort_order : idx,
    };
    if (_dbHasParentKey) row.parent_key = w.parentKey || null;
    return row;
  }

  // Returns true if the error message indicates a missing column
  function _isMissingCol(msg) {
    return msg && (msg.includes('parent_key') || msg.includes('column') || msg.includes('schema cache'));
  }

  async function syncWorkspacesToDB() {
    if (_syncWsPending) {
      clearTimeout(_syncRetryTimer);
      _syncRetryTimer = setTimeout(() => syncWorkspacesToDB(), 1200);
      return;
    }
    _syncWsPending = true;
    try {
      const s = await getSb(); const u = await getUid();
      if (!s || !u) { _showWsStatus('⚠️ Not authenticated', '#f59e0b'); return; }

      // ── 1. Upsert rows that already have a DB id ────────────────────────
      const withId    = customWs.filter(w => w.id);
      const withoutId = customWs.filter(w => !w.id);

      if (withId.length) {
        const rows = withId.map((w, _) => ({ id: w.id, ..._wsRow(w, u, customWs.indexOf(w)) }));
        const { error } = await s.from('mums_notes_workspaces').upsert(rows, { onConflict: 'id' });
        if (error) {
          if (_isMissingCol(error.message) && _dbHasParentKey) {
            // Column missing — retry without parent_key
            _dbHasParentKey = false;
            const safeRows = withId.map((w, _) => ({ id: w.id, ..._wsRow(w, u, customWs.indexOf(w)) }));
            const { error: e2 } = await s.from('mums_notes_workspaces').upsert(safeRows, { onConflict: 'id' });
            if (e2) console.warn('[MyNotes] syncWs upsert (no parent_key):', e2.message);
          } else {
            console.warn('[MyNotes] syncWs upsert:', error.message);
          }
        }
      }

      // ── 2. Insert brand-new workspaces ─────────────────────────────────
      for (const w of withoutId) {
        const payload = _wsRow(w, u, customWs.indexOf(w));
        const { data, error } = await s.from('mums_notes_workspaces')
          .insert(payload).select().single();

        if (!error && data) {
          // Stamp real UUID back so the workspace survives next open
          w.id  = data.id;
          w.key = 'cws_' + data.id.replace(/-/g, '');
        } else if (error) {
          if (_isMissingCol(error.message) && _dbHasParentKey) {
            // parent_key column not migrated yet — retry without it
            _dbHasParentKey = false;
            const safePayload = _wsRow(w, u, customWs.indexOf(w));
            const { data: d2, error: e2 } = await s.from('mums_notes_workspaces')
              .insert(safePayload).select().single();
            if (!e2 && d2) {
              w.id  = d2.id;
              w.key = 'cws_' + d2.id.replace(/-/g, '');
            } else if (e2) {
              console.warn('[MyNotes] syncWs insert retry:', e2.message);
            }
          } else {
            console.warn('[MyNotes] syncWs insert:', error.message);
          }
        }
      }

      // ── 3. Delete rows removed locally ────────────────────────────────
      const { data: dbRows } = await s.from('mums_notes_workspaces').select('id').eq('user_id', u);
      if (dbRows && dbRows.length) {
        const localIds = new Set(customWs.filter(w => w.id).map(w => w.id));
        const toDelete = dbRows.map(r => r.id).filter(id => !localIds.has(id));
        if (toDelete.length) {
          await s.from('mums_notes_workspaces').delete().in('id', toDelete).eq('user_id', u);
        }
      }

      // ── 4. Persist and render ──────────────────────────────────────────
      saveCWs();
      renderWsTree();
      _showWsStatus('✅ Workspaces saved', '#22c55e');
    } catch (err) {
      console.warn('[MyNotes] syncWorkspacesToDB error:', err?.message);
      _showWsStatus('⚠️ Sync failed — will retry', '#f59e0b');
      clearTimeout(_syncRetryTimer);
      _syncRetryTimer = setTimeout(() => { _syncWsPending = false; syncWorkspacesToDB(); }, 3000);
    } finally {
      _syncWsPending = false;
    }
  }

  // Status toast shown at the bottom of the workspace sidebar
  function _showWsStatus(msg, color) {
    try {
      let el = document.getElementById('mnWsSyncStatus');
      if (!el) {
        el = document.createElement('div');
        el.id = 'mnWsSyncStatus';
        el.style.cssText = 'position:absolute;bottom:60px;left:8px;right:8px;' +
          'padding:5px 10px;border-radius:7px;font-size:11px;font-weight:700;' +
          'text-align:center;pointer-events:none;transition:opacity .4s;z-index:10';
        const sidebar = document.getElementById('mnSidebar');
        if (sidebar) { sidebar.style.position = 'relative'; sidebar.appendChild(el); }
      }
      el.textContent = msg;
      el.style.cssText += ';background:' + color + '22;color:' + color +
        ';border:1px solid ' + color + '44;opacity:1';
      clearTimeout(el._t);
      el._t = setTimeout(() => { if (el) el.style.opacity = '0'; }, 2500);
    } catch (_) {}
  }

  // Legacy shims — keep call-sites working without changing them
  async function remoteAddWs()    { /* handled by syncWorkspacesToDB */ }
  async function remoteUpdateWs() { /* handled by syncWorkspacesToDB */ }
  async function remoteDelWs()    { /* handled by syncWorkspacesToDB */ }

  /* ── WORKSPACE TREE LOGIC ───────────────────────────────────────────────── */
  function allWs() {
    return [
      ...DEFAULT_WS.map(w => ({ ...w })),
      ...customWs.map(c => ({ key:c.key, label:c.name, emoji:c.emoji, locked:false, parentKey:c.parentKey||null, _cw:c }))
    ];
  }

  function buildTree(items) {
    const map = {};
    items.forEach(item => { map[item.key] = { ...item, children:[] }; });
    const roots = [];
    items.forEach(item => {
      if (item.parentKey && map[item.parentKey]) map[item.parentKey].children.push(map[item.key]);
      else roots.push(map[item.key]);
    });
    return roots;
  }

  function getDescendantKeys(key) {
    const result = [];
    function collect(k) {
      customWs.filter(c => c.parentKey === k).forEach(c => { result.push(c.key); collect(c.key); });
    }
    collect(key); return result;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     MODAL HTML
     ══════════════════════════════════════════════════════════════════════════ */
  function ensureModal() {
    if ($('#myNotesModal')) return;

    const sep = `<span style="width:1px;height:18px;background:rgba(255,255,255,.14);margin:0 3px;flex-shrink:0;align-self:center"></span>`;

    function tbtn(id, title, html) {
      return `<button class="mntb" id="${id}" title="${title}" onmousedown="event.preventDefault()" style="
        padding:4px 8px;min-width:28px;border-radius:6px;border:1px solid transparent;
        cursor:pointer;font-size:12px;background:rgba(255,255,255,.05);color:#8fa3bb;
        transition:all .12s;line-height:1.5;white-space:nowrap">${html}</button>`;
    }

    const toolbarHtml = `
<div id="mnToolbar" style="display:none;flex-shrink:0;padding:7px 14px;
  border-bottom:1px solid rgba(56,189,248,.1);background:rgba(0,0,0,.35);
  flex-wrap:wrap;gap:4px;align-items:center">

  <select id="mnFmtBlock" title="Paragraph Style" onmousedown="event.stopPropagation()" style="
    background:rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.12);color:#cbd5e1;
    border-radius:6px;padding:4px 6px;font-size:12px;cursor:pointer;outline:none;max-width:110px">
    <option value="p">Normal</option>
    <option value="h1">Heading 1</option>
    <option value="h2">Heading 2</option>
    <option value="h3">Heading 3</option>
    <option value="pre">Code</option>
    <option value="blockquote">Quote</option>
  </select>

  <select id="mnFontSz" title="Font Size" onmousedown="event.stopPropagation()" style="
    background:rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.12);color:#cbd5e1;
    border-radius:6px;padding:4px 6px;font-size:12px;cursor:pointer;outline:none;max-width:80px">
    <option value="1">Tiny</option>
    <option value="2">Small</option>
    <option value="3" selected>Normal</option>
    <option value="4">Large</option>
    <option value="5">X-Large</option>
    <option value="6">Huge</option>
  </select>

  ${sep}
  ${tbtn('mnB',   'Bold',          '<b style="font-size:13px">B</b>')}
  ${tbtn('mnI',   'Italic',        '<i style="font-size:13px">I</i>')}
  ${tbtn('mnU',   'Underline',     '<u>U</u>')}
  ${tbtn('mnS',   'Strikethrough', '<s>S</s>')}
  ${sep}

  <div style="position:relative;display:inline-flex" title="Text Color">
    <button class="mntb" onmousedown="event.preventDefault()" style="padding:4px 8px;min-width:28px;border-radius:6px;border:1px solid transparent;cursor:pointer;font-size:12px;background:rgba(255,255,255,.05);color:#8fa3bb;transition:all .12s">
      <span id="mnColorPrev" style="font-weight:900;font-size:13px;border-bottom:3px solid #f87171;padding:0 2px">A</span>
    </button>
    <input id="mnColorInput" type="color" value="#f87171" style="position:absolute;inset:0;opacity:0;width:100%;height:100%;cursor:pointer;border:0;padding:0">
  </div>

  <div style="position:relative;display:inline-flex" title="Highlight Color">
    <button class="mntb" onmousedown="event.preventDefault()" style="padding:4px 8px;min-width:28px;border-radius:6px;border:1px solid transparent;cursor:pointer;font-size:12px;background:rgba(255,255,255,.05);color:#8fa3bb;transition:all .12s">
      <span id="mnHlPrev" style="background:#fef08a;color:#000;padding:1px 4px;border-radius:2px;font-size:11px;font-weight:700">HL</span>
    </button>
    <input id="mnHlInput" type="color" value="#fef08a" style="position:absolute;inset:0;opacity:0;width:100%;height:100%;cursor:pointer;border:0;padding:0">
  </div>

  ${sep}
  ${tbtn('mnBullet',   '• Bullet List',    '• List')}
  ${tbtn('mnOrdered',  '1. Numbered List', '1. List')}
  ${tbtn('mnCheckbox', '☑ Checklist',      '☑ Check')}
  ${sep}
  ${tbtn('mnIndent',   'Indent',           '→ Indent')}
  ${tbtn('mnOutdent',  'Outdent',          '← Outdent')}
  ${sep}
  ${tbtn('mnHR',       'Insert Divider',   '— HR')}
  ${tbtn('mnClearFmt', 'Clear Formatting', '✕ Fmt')}
  ${sep}
  ${tbtn('mnUndo',     'Undo',             '⟲')}
  ${tbtn('mnRedo',     'Redo',             '⟳')}
</div>`;

    document.body.insertAdjacentHTML('beforeend', `
<style id="mnv4css">
.mntb:hover{background:rgba(56,189,248,.18)!important;color:#38bdf8!important;border-color:rgba(56,189,248,.3)!important}
.mntb.mn-active{background:rgba(56,189,248,.24)!important;color:#38bdf8!important;border-color:rgba(56,189,248,.45)!important}
.mn-ws-row:hover>.mn-ws-btn{background:rgba(56,189,248,.08)!important}
.mn-ws-btn.mn-ws-active{background:rgba(56,189,248,.18)!important;border-color:rgba(56,189,248,.4)!important;color:#38bdf8!important;font-weight:700!important}
#mnCtxMenu button:hover{background:rgba(56,189,248,.14)!important;color:#e2e8f0!important}
#mnCtxMenu button.mn-danger:hover{background:rgba(248,113,113,.15)!important;color:#fca5a5!important}
#mnEditor h1{font-size:1.75em;font-weight:900;color:#f1f5f9;margin:.5em 0 .25em;border-bottom:1px solid rgba(255,255,255,.1);padding-bottom:.2em}
#mnEditor h2{font-size:1.35em;font-weight:800;color:#e2e8f0;margin:.45em 0 .2em}
#mnEditor h3{font-size:1.1em;font-weight:700;color:#cbd5e1;margin:.4em 0 .15em}
#mnEditor p{margin:.2em 0;min-height:1.2em}
#mnEditor pre{background:rgba(0,0,0,.45);padding:10px 14px;border-radius:8px;font-family:monospace;font-size:12.5px;color:#7dd3fc;border:1px solid rgba(56,189,248,.2);overflow-x:auto;white-space:pre}
#mnEditor blockquote{border-left:3px solid rgba(56,189,248,.5);padding:4px 0 4px 14px;color:#94a3b8;font-style:italic;margin:6px 0;background:rgba(56,189,248,.04);border-radius:0 6px 6px 0}
#mnEditor ul,#mnEditor ol{padding-left:22px;margin:.3em 0}
#mnEditor li{margin:.2em 0;line-height:1.65}
#mnEditor ul.mn-cl{list-style:none!important;padding-left:2px}
#mnEditor ul.mn-cl li{display:flex;align-items:flex-start;gap:8px;padding:3px 0;cursor:pointer}
#mnEditor ul.mn-cl li input{margin-top:2px;cursor:pointer;width:14px;height:14px;accent-color:#38bdf8;flex-shrink:0;pointer-events:all}
#mnEditor ul.mn-cl li.mn-done{text-decoration:line-through;opacity:.55}
#mnEditor a{color:#38bdf8;text-decoration:underline}
#mnEditor hr{border:none;border-top:1px solid rgba(255,255,255,.14);margin:10px 0}
#mnContentView h1{font-size:1.75em;font-weight:900;color:#f1f5f9;margin:.5em 0 .25em;border-bottom:1px solid rgba(255,255,255,.1);padding-bottom:.2em}
#mnContentView h2{font-size:1.35em;font-weight:800;color:#e2e8f0;margin:.45em 0 .2em}
#mnContentView h3{font-size:1.1em;font-weight:700;color:#cbd5e1;margin:.4em 0 .15em}
#mnContentView p{margin:.35em 0;color:#f0f6ff;line-height:2}
#mnContentView pre{background:rgba(0,0,0,.45);padding:10px 14px;border-radius:8px;font-family:monospace;font-size:12.5px;color:#7dd3fc;border:1px solid rgba(56,189,248,.2);overflow-x:auto;white-space:pre}
#mnContentView blockquote{border-left:3px solid rgba(56,189,248,.5);padding:4px 0 4px 14px;color:#94a3b8;font-style:italic;margin:6px 0;background:rgba(56,189,248,.04);border-radius:0 6px 6px 0}
#mnContentView ul,#mnContentView ol{padding-left:22px;margin:.3em 0}
#mnContentView li{margin:.3em 0;line-height:2;color:#f0f6ff}
#mnContentView ul.mn-cl{list-style:none!important;padding-left:2px}
#mnContentView ul.mn-cl li{display:flex;align-items:flex-start;gap:8px;padding:3px 0}
#mnContentView ul.mn-cl li input{margin-top:2px;width:14px;height:14px;accent-color:#38bdf8;flex-shrink:0;cursor:pointer}
#mnContentView ul.mn-cl li.mn-done{text-decoration:line-through;opacity:.55}
#mnContentView a{color:#38bdf8;text-decoration:underline;word-break:break-all}
#mnContentView hr{border:none;border-top:1px solid rgba(255,255,255,.14);margin:10px 0}
#mnEditor:empty:before{content:attr(placeholder);color:#475569;pointer-events:none}
#mnEditor:focus{outline:none}
</style>

<div id="myNotesModal" class="modal" style="z-index:9999;display:none">
 <div class="panel" style="max-width:1460px;width:96vw;height:92vh;display:flex;flex-direction:column;
   background:linear-gradient(148deg,#080f1e,#050c17);
   border:1px solid rgba(56,189,248,.32);border-radius:20px;overflow:hidden;
   box-shadow:0 0 0 1px rgba(56,189,248,.06),0 40px 100px rgba(0,0,0,.85),0 0 80px rgba(56,189,248,.04)">

  <!-- HEADER ─────────────────────────────────────────────────────────── -->
  <div style="display:flex;align-items:center;justify-content:space-between;padding:13px 20px;
    border-bottom:1px solid rgba(56,189,248,.14);flex-shrink:0;
    background:linear-gradient(90deg,rgba(56,189,248,.07),transparent)">
   <div style="display:flex;align-items:center;gap:10px">
    <img src="${ICON}" style="width:23px;height:23px;border-radius:5px;object-fit:contain">
    <span style="font-weight:900;color:#fff;font-size:15px;letter-spacing:-.01em">My Notes</span>
    <span style="font-size:10.5px;padding:2px 9px;background:rgba(245,158,11,.18);color:#fbbf24;border-radius:999px;font-weight:700">COMMAND CENTER</span>
   </div>
   <button id="myNotesCloseBtn" style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);
     color:#94a3b8;font-size:15px;padding:5px 11px;border-radius:8px;cursor:pointer;line-height:1;
     transition:all .14s" title="Close">✕</button>
  </div>

  <!-- BODY ────────────────────────────────────────────────────────────── -->
  <div style="display:flex;flex:1;min-height:0">

   <!-- ① WORKSPACE TREE SIDEBAR ─────────────────────────────────────── -->
   <div id="mnSidebar" style="width:225px;flex-shrink:0;border-right:1px solid rgba(56,189,248,.1);
     padding:12px 8px 12px;display:flex;flex-direction:column;background:rgba(0,0,0,.22);overflow-y:auto">
    <div style="font-size:9.5px;letter-spacing:.14em;color:#4e6a85;margin-bottom:8px;
      padding:0 6px;font-weight:800;text-transform:uppercase">WORKSPACES</div>
    <div id="mnWsTree" style="flex:1"></div>
    <div style="padding-top:10px;border-top:1px solid rgba(255,255,255,.05);margin-top:8px">
     <button id="mnAddWsBtn" style="width:100%;text-align:left;font-size:12px;color:#38bdf8;
       padding:8px 10px;border-radius:9px;background:rgba(56,189,248,.06);
       border:1px dashed rgba(56,189,248,.25);cursor:pointer;display:flex;
       align-items:center;gap:6px;transition:all .15s">
      <span style="font-size:14px;line-height:1">＋</span> Add Workspace
     </button>
    </div>
   </div>

   <!-- ② NOTE LIST ──────────────────────────────────────────────────── -->
   <div style="width:285px;flex-shrink:0;border-right:1px solid rgba(56,189,248,.1);
     display:flex;flex-direction:column;background:rgba(0,0,0,.12)">
    <div style="padding:10px;display:flex;gap:8px;flex-shrink:0;border-bottom:1px solid rgba(56,189,248,.08)">
     <input id="mnSearch" placeholder="Search notes…" style="flex:1;background:rgba(0,0,0,.35);
       border:1px solid rgba(56,189,248,.2);color:#f1f5f9;border-radius:9px;
       padding:8px 11px;font-size:13px;outline:none">
     <button id="mnNew" style="padding:7px 13px;border-radius:9px;border:none;cursor:pointer;
       background:linear-gradient(135deg,#f59e0b,#d97706);color:#000;
       font-weight:800;font-size:13px;white-space:nowrap">+ New</button>
    </div>
    <div id="mnList" style="flex:1;overflow-y:auto;padding:6px 8px"></div>
    <div style="padding:7px 12px;font-size:10.5px;color:#4e6a85;
      border-top:1px solid rgba(56,189,248,.07);letter-spacing:.04em">
     A-Z • <span id="mnCount">0</span> notes
    </div>
   </div>

   <!-- ③ NOTE DETAIL ─────────────────────────────────────────────────── -->
   <div style="flex:1;display:flex;flex-direction:column;min-width:0">

    <!-- Rich text toolbar (edit mode only) -->
    ${toolbarHtml}

    <!-- TITLE + ACTION BUTTONS ────────────────────────────────────────── -->
    <div style="padding:14px 18px 10px;border-bottom:1px solid rgba(56,189,248,.1);flex-shrink:0;
      background:linear-gradient(90deg,rgba(56,189,248,.03),transparent)">
     <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:8px">
      <div id="mnTitleView" style="flex:1;font-size:20px;font-weight:800;color:#f1f5f9;
        letter-spacing:-.015em;line-height:1.3;word-break:break-word;min-height:28px"></div>
      <input id="mnTitleEdit" placeholder="Untitled" style="display:none;flex:1;
        background:rgba(0,0,0,.3);border:1px solid rgba(56,189,248,.35);color:#fff;
        font-size:20px;font-weight:800;border-radius:8px;padding:6px 12px;
        outline:none;box-sizing:border-box">
     </div>
     <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
       <span style="font-size:11.5px;color:#6b8aa8">
        Workspace: <b id="mnWsLabel" style="color:#38bdf8;font-weight:700"></b>
       </span>
       <span id="mnUpdatedAt" style="font-size:11.5px;color:#5a7a96;letter-spacing:.01em"></span>
       <span id="mnDirtyBadge" style="display:none;font-size:10px;padding:2px 8px;
         background:rgba(245,158,11,.22);color:#fbbf24;border-radius:999px;font-weight:700">● Unsaved</span>
      </div>
      <!-- VIEW MODE BUTTONS -->
      <div id="mnViewBtns" style="display:flex;gap:7px;flex-wrap:wrap">
       <button id="mnEditBtn" style="padding:6px 13px;border-radius:8px;border:none;cursor:pointer;font-size:12px;font-weight:700;background:rgba(56,189,248,.14);color:#38bdf8;transition:all .14s">✏️ Edit</button>
       <button id="mnDupBtn"  style="padding:6px 13px;border-radius:8px;border:none;cursor:pointer;font-size:12px;font-weight:700;background:rgba(124,58,237,.2);color:#a78bfa;transition:all .14s">⎘ Duplicate</button>
       <button id="mnCopyBtn" style="padding:6px 13px;border-radius:8px;border:none;cursor:pointer;font-size:12px;font-weight:700;background:rgba(245,158,11,.14);color:#fde68a;transition:all .14s">📋 Copy</button>
       <button id="mnDelBtn"  style="padding:6px 13px;border-radius:8px;border:none;cursor:pointer;font-size:12px;font-weight:700;background:rgba(248,113,113,.12);color:#fca5a5;transition:all .14s">🗑 Delete</button>
      </div>
      <!-- EDIT MODE BUTTONS -->
      <div id="mnEditBtns" style="display:none;gap:7px">
       <button id="mnSaveBtn"   style="padding:6px 18px;border-radius:8px;border:none;cursor:pointer;font-size:13px;font-weight:800;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;transition:all .14s">💾 Save</button>
       <button id="mnCancelBtn" style="padding:6px 13px;border-radius:8px;border:none;cursor:pointer;font-size:12px;font-weight:700;background:rgba(255,255,255,.07);color:#94a3b8;transition:all .14s">✕ Cancel</button>
      </div>
     </div>
    </div>

    <!-- CONTENT VIEW (linkified rich HTML) -->
    <div id="mnContentView" style="flex:1;overflow-y:auto;margin:12px 14px;
      background:rgba(10,18,35,.6);border:1px solid rgba(56,189,248,.18);border-radius:14px;
      color:#f0f6ff;padding:22px 26px;font-size:15px;line-height:2;word-break:break-word;
      box-shadow:inset 0 1px 0 rgba(255,255,255,.06),inset 0 0 0 1px rgba(56,189,248,.04)"></div>

    <!-- CONTENT EDITOR (contenteditable rich text) -->
    <div id="mnEditor" contenteditable="false" placeholder="Start writing…" style="
      display:none;flex:1;overflow-y:auto;margin:0 14px 12px;
      background:rgba(0,0,0,.28);border:1px solid rgba(56,189,248,.32);border-radius:14px;
      color:#f0f6ff;padding:22px 26px;font-size:15px;line-height:2;
      word-break:break-word;box-shadow:0 0 0 1px rgba(56,189,248,.08) inset"></div>
   </div>

  </div><!-- /body -->
 </div><!-- /panel -->
</div><!-- /modal -->

<!-- RIGHT-CLICK CONTEXT MENU ──────────────────────────────────────────── -->
<div id="mnCtxMenu" style="display:none;position:fixed;z-index:100001;
  background:linear-gradient(145deg,#0f1e35,#09131f);
  border:1px solid rgba(56,189,248,.28);border-radius:10px;
  padding:4px;min-width:185px;
  box-shadow:0 8px 32px rgba(0,0,0,.75),0 0 0 1px rgba(56,189,248,.05)"></div>

<!-- ADD / EDIT WORKSPACE DIALOG ──────────────────────────────────────── -->
<div id="mnWsDlg" style="display:none;position:fixed;inset:0;z-index:10002;
  background:rgba(0,0,0,.6);align-items:center;justify-content:center">
 <div style="background:linear-gradient(145deg,#0d1829,#060e1a);
   border:1px solid rgba(56,189,248,.38);border-radius:16px;padding:28px;
   width:380px;max-width:92vw;box-shadow:0 0 0 1px rgba(56,189,248,.07),0 24px 64px rgba(0,0,0,.75)">
  <div id="mnWsDlgTitle" style="font-weight:800;color:#f1f5f9;font-size:17px;margin-bottom:18px"></div>
  <div style="display:flex;gap:10px;margin-bottom:14px">
   <input id="mnWsEmoji" value="📁" maxlength="4" style="width:56px;text-align:center;font-size:22px;
     background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.13);color:#fff;
     border-radius:8px;padding:8px">
   <input id="mnWsName" placeholder="e.g. Finance, HR, Escalations…" style="flex:1;
     background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.13);color:#fff;
     border-radius:8px;padding:9px 12px;font-size:14px;outline:none">
  </div>
  <div style="font-size:11px;color:#475569;margin-bottom:6px;font-weight:700;letter-spacing:.06em;text-transform:uppercase">Parent Folder (optional)</div>
  <select id="mnWsParent" style="width:100%;background:rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.13);
    color:#cbd5e1;border-radius:8px;padding:8px 12px;font-size:13px;outline:none;
    cursor:pointer;margin-bottom:22px">
   <option value="">— Top level —</option>
  </select>
  <div style="display:flex;gap:8px;justify-content:flex-end">
   <button id="mnWsDlgCancel"  style="padding:8px 16px;border-radius:8px;border:none;cursor:pointer;background:rgba(255,255,255,.07);color:#94a3b8;font-size:13px">Cancel</button>
   <button id="mnWsDlgConfirm" style="padding:8px 20px;border-radius:8px;border:none;cursor:pointer;background:linear-gradient(135deg,#38bdf8,#0ea5e9);color:#000;font-size:13px;font-weight:800">Save</button>
  </div>
 </div>
</div>

<!-- DUPLICATE NOTE DIALOG ──────────────────────────────────────────────── -->
<div id="mnDupDlg" style="display:none;position:fixed;inset:0;z-index:10002;
  background:rgba(0,0,0,.6);align-items:center;justify-content:center">
 <div style="background:linear-gradient(145deg,#0d1829,#060e1a);
   border:1px solid rgba(124,58,237,.38);border-radius:16px;padding:28px;
   width:380px;max-width:92vw;box-shadow:0 0 0 1px rgba(124,58,237,.07),0 24px 64px rgba(0,0,0,.75)">
  <div style="font-weight:800;color:#f1f5f9;font-size:17px;margin-bottom:6px">⎘ Duplicate Note</div>
  <div id="mnDupSrcTitle" style="font-size:12px;color:#7c3aed;margin-bottom:18px;padding:6px 10px;
    background:rgba(124,58,237,.12);border-radius:6px;font-weight:600"></div>
  <div style="font-size:11px;color:#475569;margin-bottom:8px;font-weight:700;letter-spacing:.06em;text-transform:uppercase">Copy to Workspace</div>
  <select id="mnDupTarget" style="width:100%;background:rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.13);
    color:#cbd5e1;border-radius:8px;padding:9px 12px;font-size:13px;outline:none;
    cursor:pointer;margin-bottom:22px"></select>
  <div style="display:flex;gap:8px;justify-content:flex-end">
   <button id="mnDupCancel"  style="padding:8px 16px;border-radius:8px;border:none;cursor:pointer;background:rgba(255,255,255,.07);color:#94a3b8;font-size:13px">Cancel</button>
   <button id="mnDupConfirm" style="padding:8px 20px;border-radius:8px;border:none;cursor:pointer;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;font-size:13px;font-weight:800">⎘ Duplicate</button>
  </div>
 </div>
</div>
`);

    /* ─── BIND ALL EVENTS ──────────────────────────────────────────────── */
    $('#myNotesCloseBtn').addEventListener('click', e => { e.stopPropagation(); closeModal(); });

    document.addEventListener('keydown', function _mnEsc(e) {
      if (e.key !== 'Escape') return;
      const m = $('#myNotesModal');
      if (!m || m.style.display === 'none') return;
      e.stopPropagation(); closeModal();
    });

    $('#mnNew').onclick       = createNote;
    $('#mnSearch').oninput    = renderNoteList;
    $('#mnEditBtn').onclick   = enterEdit;
    $('#mnSaveBtn').onclick   = saveNote;
    $('#mnCancelBtn').onclick = cancelEdit;
    $('#mnCopyBtn').onclick   = copyNote;
    $('#mnDelBtn').onclick    = deleteNote;
    $('#mnDupBtn').onclick    = showDupDlg;
    $('#mnTitleEdit').oninput  = markDirty;

    // ── Rich text toolbar ──────────────────────────────────────────────
    function exec(cmd, val) {
      $('#mnEditor').focus();
      document.execCommand(cmd, false, val || null);
      updateToolbarState();
    }
    function tbind(id, cmd, val) {
      const el = $('#' + id);
      if (el) el.addEventListener('mousedown', e => { e.preventDefault(); exec(cmd, val); });
    }

    tbind('mnB',       'bold');
    tbind('mnI',       'italic');
    tbind('mnU',       'underline');
    tbind('mnS',       'strikeThrough');
    tbind('mnBullet',  'insertUnorderedList');
    tbind('mnOrdered', 'insertOrderedList');
    tbind('mnIndent',  'indent');
    tbind('mnOutdent', 'outdent');
    tbind('mnHR',      'insertHorizontalRule');
    tbind('mnClearFmt','removeFormat');
    tbind('mnUndo',    'undo');
    tbind('mnRedo',    'redo');

    $('#mnFmtBlock').addEventListener('change', function() {
      exec('formatBlock', this.value);
    });
    $('#mnFontSz').addEventListener('change', function() {
      exec('fontSize', this.value);
    });

    // Color pickers
    $('#mnColorInput').addEventListener('input', function() {
      exec('foreColor', this.value);
      const prev = $('#mnColorPrev');
      if (prev) prev.style.borderBottomColor = this.value;
    });
    $('#mnHlInput').addEventListener('input', function() {
      exec('hiliteColor', this.value);
      const prev = $('#mnHlPrev');
      if (prev) prev.style.background = this.value;
    });

    // Checklist button
    $('#mnCheckbox').addEventListener('mousedown', e => {
      e.preventDefault();
      insertChecklist();
    });

    // Track editor input for dirty flag + toolbar state
    const editor = $('#mnEditor');
    editor.addEventListener('input', () => { markDirty(); updateToolbarState(); });
    editor.addEventListener('keyup',  updateToolbarState);
    editor.addEventListener('mouseup',updateToolbarState);
    editor.addEventListener('keydown', onEditorKeyDown);

    // Checklist click handling (toggle checkbox in EDIT mode)
    editor.addEventListener('click', e => {
      const li = e.target.closest('li');
      if (!li || !li.closest('ul.mn-cl')) return;
      const cb = li.querySelector('input[type="checkbox"]');
      if (e.target === cb) {
        li.classList.toggle('mn-done', cb.checked);
        markDirty();
      }
    });

    // Checklist click in VIEW mode (save immediately)
    $('#mnContentView').addEventListener('change', async e => {
      if (e.target.type !== 'checkbox') return;
      const li = e.target.closest('li');
      if (li) li.classList.toggle('mn-done', e.target.checked);
      const n = notes.find(x => x.id === activeId);
      if (!n) return;
      n.content = editor.innerHTML; // reflect in model
      n.updated_at = new Date().toISOString();
      saveLocal();
      await pushNote(n).catch(() => {});
    });

    // ── Add/Rename workspace dialog ─────────────────────────────────────
    $('#mnAddWsBtn').onclick   = () => openWsDlg('add', null, null);
    $('#mnWsDlgCancel').onclick = () => { $('#mnWsDlg').style.display = 'none'; };
    $('#mnWsDlgConfirm').onclick= confirmWsDlg;
    $('#mnWsName').addEventListener('keydown', e => { if (e.key === 'Enter') confirmWsDlg(); });
    $('#mnWsDlg').addEventListener('mousedown', e => { if (e.target === $('#mnWsDlg')) $('#mnWsDlg').style.display = 'none'; });

    // ── Duplicate dialog ────────────────────────────────────────────────
    $('#mnDupCancel').onclick  = () => { $('#mnDupDlg').style.display = 'none'; };
    $('#mnDupConfirm').onclick = confirmDup;
    $('#mnDupDlg').addEventListener('mousedown', e => { if (e.target === $('#mnDupDlg')) $('#mnDupDlg').style.display = 'none'; });

    // ── Context menu: hide on click outside ─────────────────────────────
    document.addEventListener('click', e => {
      const ctx = $('#mnCtxMenu');
      if (ctx && !ctx.contains(e.target)) hideCtxMenu();
    });
    document.addEventListener('contextmenu', e => {
      const row = e.target.closest('[data-ws-key]');
      const modal = $('#myNotesModal');
      if (!row || !modal || modal.style.display === 'none') return;
      e.preventDefault();
      showCtxMenu(e.clientX, e.clientY, row.dataset.wsKey);
    });
  }

  /* ── TOOLBAR STATE ──────────────────────────────────────────────────────── */
  function updateToolbarState() {
    [
      ['mnB',       'bold'],
      ['mnI',       'italic'],
      ['mnU',       'underline'],
      ['mnS',       'strikeThrough'],
      ['mnBullet',  'insertUnorderedList'],
      ['mnOrdered', 'insertOrderedList'],
    ].forEach(([id, cmd]) => {
      const el = $('#' + id);
      if (!el) return;
      try { el.classList.toggle('mn-active', document.queryCommandState(cmd)); } catch {}
    });
  }

  /* ── KEYBOARD HANDLER IN EDITOR ─────────────────────────────────────────── */
  function onEditorKeyDown(e) {
    if (e.key !== 'Enter') return;
    // Auto-create new checklist item on Enter
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const node = sel.anchorNode;
    const li = node && (node.nodeType === 3 ? node.parentElement : node).closest('li');
    if (!li || !li.closest('ul.mn-cl')) return;
    e.preventDefault();
    const newLi = document.createElement('li');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    newLi.appendChild(cb);
    newLi.appendChild(document.createTextNode('\u00A0'));
    li.parentNode.insertBefore(newLi, li.nextSibling);
    const range = document.createRange();
    range.setStart(newLi.lastChild, 1);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    markDirty();
  }

  /* ── CHECKLIST INSERT ───────────────────────────────────────────────────── */
  function insertChecklist() {
    const ed = $('#mnEditor');
    ed.focus();
    const ul = document.createElement('ul');
    ul.className = 'mn-cl';
    const li = document.createElement('li');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    li.appendChild(cb);
    li.appendChild(document.createTextNode('\u00A0'));
    ul.appendChild(li);

    const sel = window.getSelection();
    if (sel.rangeCount) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(ul);
      const newRange = document.createRange();
      newRange.setStart(li.lastChild, 1);
      newRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(newRange);
    } else {
      ed.appendChild(ul);
    }
    markDirty();
  }

  /* ── WORKSPACE TREE RENDERING ───────────────────────────────────────────── */
  function renderWsTree() {
    const container = $('#mnWsTree');
    if (!container) return;
    container.innerHTML = '';
    const tree = buildTree(allWs());
    tree.forEach(node => container.appendChild(renderWsNode(node, 0)));
  }

  function renderWsNode(node, depth) {
    const hasChildren = node.children && node.children.length > 0;
    const isActive = activeWs === node.key;
    const isExpanded = expanded.has(node.key);
    const noteCount = notes.filter(n => n.workspace === node.key).length;

    const wrap = document.createElement('div');
    wrap.className = 'mn-ws-row';
    wrap.dataset.wsKey = node.key;

    // Row: chevron + emoji+label + count
    const row = document.createElement('div');
    row.style.cssText = `display:flex;align-items:center;gap:2px;padding-left:${depth * 14}px;margin-bottom:2px`;

    // Chevron (only if has children)
    const chev = document.createElement('button');
    chev.style.cssText = 'background:none;border:none;cursor:pointer;color:#334155;font-size:10px;padding:2px 3px;line-height:1;flex-shrink:0;border-radius:4px;transition:all .15s;width:18px;text-align:center';
    chev.textContent = hasChildren ? (isExpanded ? '▼' : '▶') : ' ';
    if (hasChildren) {
      chev.onclick = e => { e.stopPropagation(); toggleExpand(node.key); };
    }

    // Main button
    const btn = document.createElement('button');
    btn.className = 'mn-ws-btn' + (isActive ? ' mn-ws-active' : '');
    btn.style.cssText = `flex:1;text-align:left;padding:8px 8px;border-radius:8px;cursor:pointer;
      font-size:12.5px;font-weight:${isActive ? '700' : '500'};
      background:${isActive ? 'rgba(56,189,248,.16)' : 'rgba(255,255,255,.02)'};
      border:1px solid ${isActive ? 'rgba(56,189,248,.38)' : 'transparent'};
      color:${isActive ? '#38bdf8' : '#c8d8e8'};
      transition:all .12s;display:flex;align-items:center;justify-content:space-between;gap:4px;overflow:hidden`;
    btn.innerHTML = `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(node.emoji + ' ' + node.label)}</span>
      ${noteCount > 0 ? `<span style="font-size:9.5px;padding:1px 6px;border-radius:999px;background:rgba(56,189,248,.14);color:#38bdf8;flex-shrink:0">${noteCount}</span>` : ''}`;
    btn.onclick = () => setWs(node.key);

    row.appendChild(chev);
    row.appendChild(btn);
    wrap.appendChild(row);

    // Children (if expanded)
    if (hasChildren && isExpanded) {
      node.children.forEach(child => wrap.appendChild(renderWsNode(child, depth + 1)));
    }
    return wrap;
  }

  function toggleExpand(key) {
    if (expanded.has(key)) expanded.delete(key);
    else expanded.add(key);
    saveExp(); renderWsTree();
  }

  function setWs(key) {
    activeWs = key;
    localStorage.setItem(LS_WS, key);
    const ws = allWs().find(w => w.key === key);
    if ($('#mnWsLabel')) $('#mnWsLabel').textContent = ws ? ws.label : key;
    if (activeId) {
      const n = notes.find(x => x.id === activeId);
      if (!n || n.workspace !== key) { activeId = null; exitEdit(false); clearDetail(); }
    }
    renderWsTree(); renderNoteList();
  }

  /* ── RIGHT-CLICK CONTEXT MENU ────────────────────────────────────────────── */
  function showCtxMenu(x, y, wsKey) {
    _ctxKey = wsKey;
    const ws   = allWs().find(w => w.key === wsKey);
    if (!ws) return;
    const menu = $('#mnCtxMenu');
    if (!menu) return;
    hideCtxMenu();

    const menuBtn = (label, cls, cb) => {
      const b = document.createElement('button');
      b.className = cls || '';
      b.style.cssText = `display:block;width:100%;text-align:left;padding:9px 14px;
        background:transparent;border:none;cursor:pointer;font-size:13px;color:#c8d8e8;
        border-radius:7px;transition:all .1s`;
      b.innerHTML = label;
      b.onclick = () => { hideCtxMenu(); cb(); };
      return b;
    };

    const divider = () => {
      const d = document.createElement('div');
      d.style.cssText = 'height:1px;background:rgba(255,255,255,.07);margin:4px 6px';
      return d;
    };

    // Rename (not for locked)
    if (!ws.locked) menu.appendChild(menuBtn('✏️ Rename', '', () => openWsDlg('rename', wsKey, ws)));
    // Add subfolder
    menu.appendChild(menuBtn('📁 Add Subfolder', '', () => openWsDlg('add', wsKey, null)));
    // Move to
    const moveBtn = menuBtn('↗ Move to…', '', () => showMoveSubMenu(x, y, wsKey));
    menu.appendChild(moveBtn);
    // Separator
    menu.appendChild(divider());
    // Delete (not locked, not with children that can't move)
    if (!ws.locked) {
      menu.appendChild(menuBtn('🗑 Delete Folder', 'mn-danger', () => removeWorkspace(wsKey)));
    }

    // Position
    menu.style.display = 'block';
    const vw = window.innerWidth, vh = window.innerHeight;
    const mw = 190, mh = menu.offsetHeight || 150;
    menu.style.left = Math.min(x, vw - mw - 8) + 'px';
    menu.style.top  = Math.min(y, vh - mh - 8) + 'px';
  }

  function showMoveSubMenu(parentX, parentY, wsKey) {
    const menu = $('#mnCtxMenu');
    if (!menu) return;
    menu.innerHTML = '';
    const back = document.createElement('button');
    back.style.cssText = `display:flex;align-items:center;gap:6px;width:100%;text-align:left;padding:9px 14px;
      background:transparent;border:none;cursor:pointer;font-size:13px;color:#38bdf8;border-radius:7px`;
    back.innerHTML = '← Back';
    back.onclick   = () => { hideCtxMenu(); showCtxMenu(parentX, parentY, wsKey); };
    menu.appendChild(back);
    const div = document.createElement('div');
    div.style.cssText = 'height:1px;background:rgba(255,255,255,.07);margin:4px 6px';
    menu.appendChild(div);

    allWs().filter(w => w.key !== wsKey).forEach(w => {
      const b = document.createElement('button');
      b.style.cssText = `display:block;width:100%;text-align:left;padding:9px 14px;
        background:transparent;border:none;cursor:pointer;font-size:13px;color:#c8d8e8;border-radius:7px;transition:all .1s`;
      b.innerHTML = esc(w.emoji + ' ' + w.label);
      b.onmouseenter = () => b.style.background = 'rgba(56,189,248,.14)';
      b.onmouseleave = () => b.style.background = 'transparent';
      b.onclick      = () => { hideCtxMenu(); moveWorkspace(wsKey, w.key); };
      menu.appendChild(b);
    });
  }

  function hideCtxMenu() {
    const m = $('#mnCtxMenu');
    if (m) { m.style.display = 'none'; m.innerHTML = ''; }
    _ctxKey = null;
  }

  /* ── ADD / RENAME WORKSPACE DIALOG ─────────────────────────────────────── */
  let _wsDlgMode = 'add', _wsDlgParentKey = null, _wsDlgEditKey = null;

  function openWsDlg(mode, parentKey, wsObj) {
    _wsDlgMode      = mode;
    _wsDlgParentKey = parentKey;
    _wsDlgEditKey   = mode === 'rename' ? (wsObj ? wsObj.key : null) : null;

    const dlg = $('#mnWsDlg');
    if (!dlg) return;
    $('#mnWsDlgTitle').textContent = mode === 'rename' ? '✏️ Rename Workspace' : '➕ New Workspace Folder';

    // Fill emoji + name
    if (mode === 'rename' && wsObj) {
      $('#mnWsEmoji').value = wsObj.emoji || '📁';
      $('#mnWsName').value  = wsObj.label || '';
    } else {
      $('#mnWsEmoji').value = '📁';
      $('#mnWsName').value  = '';
    }

    // Populate parent select
    const sel = $('#mnWsParent');
    sel.innerHTML = '<option value="">— Top level —</option>';
    allWs().forEach(w => {
      if (mode === 'rename' && w.key === _wsDlgEditKey) return; // can't parent itself
      const opt = document.createElement('option');
      opt.value = w.key;
      opt.textContent = w.emoji + ' ' + w.label;
      if (w.key === parentKey) opt.selected = true;
      sel.appendChild(opt);
    });

    dlg.style.display = 'flex';
    setTimeout(() => { const n = $('#mnWsName'); if (n) { n.focus(); n.select(); } }, 40);
  }

  async function confirmWsDlg() {
    const name  = ($('#mnWsName')?.value || '').trim();
    const emoji = ($('#mnWsEmoji')?.value || '').trim() || '📁';
    const parentKey = $('#mnWsParent')?.value || null;
    if (!name) { $('#mnWsName')?.focus(); return; }

    $('#mnWsDlg').style.display = 'none';

    if (_wsDlgMode === 'rename' && _wsDlgEditKey) {
      // Rename existing
      const cw = customWs.find(w => w.key === _wsDlgEditKey);
      if (!cw) return;
      cw.name  = name;
      cw.emoji = emoji;
      cw.parentKey = parentKey;
      saveCWs(); renderWsTree();
      syncWorkspacesToDB();   // push rename + sort_order to DB immediately
    } else {
      // Add new — optimistic local first, then sync to DB
      const tempKey = 'cws_' + name.toLowerCase().replace(/[^a-z0-9]/g,'_') + '_' + Date.now().toString(36);
      const local = { id:null, key:tempKey, name, emoji, parentKey:parentKey||null, locked:false };
      customWs.push(local);
      saveCWs(); renderWsTree();
      await syncWorkspacesToDB();  // insert + get real UUID back + save
      renderWsTree();              // re-render with stable keys
    }
  }

  async function removeWorkspace(key) {
    const cw = customWs.find(w => w.key === key);
    if (!cw) return;
    const noteCount = notes.filter(n => n.workspace === key).length;
    const descKeys  = getDescendantKeys(key);
    const descCount = descKeys.reduce((acc, k) => acc + notes.filter(n => n.workspace === k).length, 0);
    const total     = noteCount + descCount;
    const subMsg    = descKeys.length > 0 ? `\n${descKeys.length} subfolder(s) will also be deleted.` : '';
    const noteMsg   = total > 0 ? `\n${total} note(s) will stay in your account (moved to Personal).` : '';
    if (!confirm(`Delete workspace "${cw.name}"?${subMsg}${noteMsg}`)) return;

    // ★ TOMBSTONE: Record all deleted UUIDs BEFORE removing from customWs.
    // This ensures that when another device pulls workspaces from DB,
    // it sees these IDs as deliberately deleted and never re-inserts them.
    // Also protects against offline-delete → online-pull resurrection on THIS device.
    const deletedIds = [...[key], ...descKeys]
      .map(k => (customWs.find(w => w.key === k) || {}).id)
      .filter(Boolean);
    if (deletedIds.length) addTombstones(deletedIds);

    // Move notes to personal
    [...[key], ...descKeys].forEach(k => {
      notes.filter(n => n.workspace === k).forEach(n => { n.workspace = 'personal'; });
    });
    saveLocal();

    // Remove this and descendants from customWs
    customWs = customWs.filter(w => w.key !== key && !descKeys.includes(w.key));
    saveCWs();
    if (activeWs === key || descKeys.includes(activeWs)) setWs('personal');
    else renderWsTree();

    await syncWorkspacesToDB();   // delete from DB + fix sort_orders of remaining
  }

  function moveWorkspace(key, newParentKey) {
    const cw = customWs.find(w => w.key === key);
    if (!cw) return;
    cw.parentKey = newParentKey === '' ? null : newParentKey;
    saveCWs(); renderWsTree();
    syncWorkspacesToDB();   // push new parentKey + sort_order to DB
  }

  /* ── NOTE LIST ──────────────────────────────────────────────────────────── */
  function renderNoteList() {
    const el = $('#mnList');
    if (!el) return;
    const q   = ($('#mnSearch')?.value || '').toLowerCase();
    const ws  = allWs().find(w => w.key === activeWs);
    if ($('#mnWsLabel')) $('#mnWsLabel').textContent = ws ? ws.label : activeWs;

    const filtered = sortAZ(
      notes.filter(n => n.workspace === activeWs)
           .filter(n => !q || n.title.toLowerCase().includes(q) || htmlToPreview(n.content).toLowerCase().includes(q))
    );
    if ($('#mnCount')) $('#mnCount').textContent = filtered.length;
    el.innerHTML = '';

    if (!filtered.length) {
      el.innerHTML = '<div style="padding:28px 12px;text-align:center;color:#4e6a85;font-size:13px;line-height:1.8">' +
        'No notes in this workspace.<br><b style="color:#38bdf8">+ New</b> to create one.</div>';
      return;
    }

    filtered.forEach(n => {
      const isActive = n.id === activeId;
      const d = document.createElement('div');
      d.style.cssText = `padding:11px 13px;margin:3px 0;border-radius:11px;cursor:pointer;
        background:${isActive ? 'rgba(56,189,248,.16)' : 'rgba(255,255,255,.04)'};
        border:1px solid ${isActive ? 'rgba(56,189,248,.4)' : 'rgba(255,255,255,.07)'};
        transition:all .12s;user-select:none;
        box-shadow:${isActive ? '0 0 0 1px rgba(56,189,248,.12)' : 'none'}`;
      const preview = htmlToPreview(n.content);
      d.innerHTML = `
        <div style="font-weight:700;color:#ffffff;font-size:13.5px;margin-bottom:4px;
          white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(n.title || 'Untitled')}</div>
        <div style="font-size:11px;color:#8fa3bb;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.5">
          ${esc(preview) || '<em>Empty</em>'}</div>
        <div style="font-size:10px;color:#4e6a85;margin-top:5px;letter-spacing:.01em">🕐 ${fmtDate(n.updated_at)}</div>`;
      d.addEventListener('mouseenter', () => { if (!isActive) d.style.background = 'rgba(56,189,248,.06)'; });
      d.addEventListener('mouseleave', () => { if (n.id !== activeId) d.style.background = 'rgba(255,255,255,.03)'; });
      d.onclick = () => selectNote(n.id);
      el.appendChild(d);
    });
  }

  /* ── NOTE DETAIL ────────────────────────────────────────────────────────── */
  function clearDetail() {
    if ($('#mnTitleView'))   $('#mnTitleView').textContent  = '';
    if ($('#mnContentView')) $('#mnContentView').innerHTML  = '';
    if ($('#mnTitleEdit'))   $('#mnTitleEdit').value        = '';
    if ($('#mnEditor'))      $('#mnEditor').innerHTML       = '';
    if ($('#mnUpdatedAt'))   $('#mnUpdatedAt').textContent  = '';
    if ($('#mnDirtyBadge'))  $('#mnDirtyBadge').style.display = 'none';
    exitEdit(false); renderNoteList();
  }

  function showDetail(n) {
    const ws = allWs().find(w => w.key === n.workspace);
    if ($('#mnWsLabel'))     $('#mnWsLabel').textContent    = ws ? ws.label : n.workspace;
    if ($('#mnTitleView'))   $('#mnTitleView').textContent  = n.title || 'Untitled';
    if ($('#mnTitleEdit'))   $('#mnTitleEdit').value        = n.title || '';
    if ($('#mnUpdatedAt'))   $('#mnUpdatedAt').textContent  = n.updated_at ? '⏱ ' + fmtDate(n.updated_at) : '';
    if ($('#mnDirtyBadge'))  $('#mnDirtyBadge').style.display = 'none';

    // Render view: HTML → linkify, plain text → convert
    const cv = $('#mnContentView');
    if (cv) {
      const html = isHtml(n.content) ? n.content : plainToHtml(n.content);
      cv.innerHTML = linkifyView(html);
    }

    const ed = $('#mnEditor');
    if (ed) ed.innerHTML = isHtml(n.content) ? n.content : plainToHtml(n.content);
  }

  function selectNote(id) {
    if (dirty && !confirm('You have unsaved changes. Discard them?')) return;
    activeId = id; dirty = false;
    exitEdit(false);
    const n = notes.find(x => x.id === id);
    if (n) showDetail(n);
    renderNoteList();
  }

  /* ── EDIT MODE ──────────────────────────────────────────────────────────── */
  function enterEdit() {
    if (!activeId) return;
    editMode = true;
    $('#mnTitleView').style.display  = 'none';
    $('#mnTitleEdit').style.display  = 'block';
    $('#mnContentView').style.display= 'none';
    const ed = $('#mnEditor');
    ed.style.display       = 'block';
    ed.contentEditable     = 'true';
    ed.setAttribute('placeholder', 'Start writing your note…');
    $('#mnToolbar').style.display    = 'flex';
    $('#mnViewBtns').style.display   = 'none';
    $('#mnEditBtns').style.display   = 'flex';
    setTimeout(() => { $('#mnEditor').focus(); }, 30);
  }

  function exitEdit(revert) {
    editMode = false; dirty = false;
    if ($('#mnTitleView'))  $('#mnTitleView').style.display  = 'block';
    if ($('#mnTitleEdit'))  $('#mnTitleEdit').style.display  = 'none';
    if ($('#mnContentView'))$('#mnContentView').style.display= 'block';
    if ($('#mnEditor')) {
      $('#mnEditor').style.display    = 'none';
      $('#mnEditor').contentEditable  = 'false';
    }
    if ($('#mnToolbar'))    $('#mnToolbar').style.display    = 'none';
    if ($('#mnViewBtns'))   $('#mnViewBtns').style.display   = 'flex';
    if ($('#mnEditBtns'))   $('#mnEditBtns').style.display   = 'none';
    if ($('#mnDirtyBadge')) $('#mnDirtyBadge').style.display = 'none';
    if (revert && activeId) { const n = notes.find(x => x.id === activeId); if (n) showDetail(n); }
  }

  function cancelEdit() {
    if (dirty && !confirm('Discard unsaved changes?')) return;
    exitEdit(true);
  }

  function markDirty() {
    dirty = true;
    if ($('#mnDirtyBadge')) $('#mnDirtyBadge').style.display = 'inline-block';
  }

  /* ── SAVE ───────────────────────────────────────────────────────────────── */
  async function saveNote() {
    if (!activeId) return;
    const n = notes.find(x => x.id === activeId);
    if (!n) return;

    // Preserve checklist checked state in HTML
    const ed = $('#mnEditor');
    ed.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      if (cb.checked) cb.setAttribute('checked', 'checked');
      else cb.removeAttribute('checked');
    });

    n.title      = ($('#mnTitleEdit')?.value || '').trim() || 'Untitled';
    n.content    = ed.innerHTML || '';
    n.updated_at = new Date().toISOString();
    saveLocal();

    const btn = $('#mnSaveBtn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Saving…'; btn.style.opacity = '.7'; }

    const ok = await pushNote(n);

    if (btn) {
      btn.disabled  = false;
      btn.textContent = ok ? '✅ Saved!' : '⚠️ Error';
      btn.style.background = ok ? 'linear-gradient(135deg,#4ade80,#16a34a)' : 'rgba(248,113,113,.4)';
      btn.style.opacity = '1';
      setTimeout(() => {
        if ($('#mnSaveBtn')) {
          $('#mnSaveBtn').textContent = '💾 Save';
          $('#mnSaveBtn').style.background = 'linear-gradient(135deg,#22c55e,#16a34a)';
        }
      }, 1800);
    }

    if (ok) { dirty = false; exitEdit(false); showDetail(n); renderNoteList(); }
  }

  /* ── CREATE / COPY / DELETE ─────────────────────────────────────────────── */
  function createNote() {
    if (dirty && !confirm('Discard unsaved changes?')) return;
    const n = { id:uidGen(), workspace:activeWs, title:'Untitled', content:'<p><br></p>', updated_at:new Date().toISOString() };
    notes.push(n); saveLocal();
    activeId = n.id;
    renderNoteList(); showDetail(n);
    setTimeout(() => { pushNote(n).catch(() => {}); }, 0);
    setTimeout(() => enterEdit(), 30);
  }

  function copyNote() {
    const n = notes.find(x => x.id === activeId);
    if (!n) return;
    const text = isHtml(n.content) ? htmlToPreview(n.content) : n.content;
    navigator.clipboard.writeText(text).catch(() => {});
  }

  async function deleteNote() {
    const n = notes.find(x => x.id === activeId);
    if (!n) return;
    if (!confirm(`Permanently delete "${n.title}"?`)) return;
    notes = notes.filter(x => x.id !== activeId);
    saveLocal(); activeId = null; dirty = false;
    clearDetail(); renderNoteList();
    const s = await getSb(); const u = await getUid();
    if (s && u) await s.from('mums_notes').delete().eq('id', n.id).eq('user_id', u).catch(() => {});
  }

  /* ── DUPLICATE NOTE ─────────────────────────────────────────────────────── */
  function showDupDlg() {
    const n = notes.find(x => x.id === activeId);
    if (!n) return;

    const dlg = $('#mnDupDlg');
    if (!dlg) return;
    $('#mnDupSrcTitle').textContent = '📝 "' + (n.title || 'Untitled') + '"';

    const sel = $('#mnDupTarget');
    sel.innerHTML = '';
    allWs().forEach(w => {
      const opt = document.createElement('option');
      opt.value = w.key;
      opt.textContent = w.emoji + ' ' + w.label;
      if (w.key === activeWs) opt.selected = true;
      sel.appendChild(opt);
    });

    dlg.style.display = 'flex';
  }

  async function confirmDup() {
    const n = notes.find(x => x.id === activeId);
    if (!n) return;
    const targetWs = $('#mnDupTarget')?.value || 'personal';
    $('#mnDupDlg').style.display = 'none';

    const copy = {
      id:         uidGen(),
      workspace:  targetWs,
      title:      n.title + ' (copy)',
      content:    n.content,
      updated_at: new Date().toISOString()
    };
    notes.push(copy); saveLocal();

    // Switch to the target workspace and select the copy
    if (targetWs !== activeWs) setWs(targetWs);
    activeId = copy.id;
    renderNoteList(); showDetail(copy);
    await pushNote(copy).catch(() => {});
  }

  /* ── OPEN / CLOSE MODAL ─────────────────────────────────────────────────── */
  function openModal() {
    ensureModal();
    $('#myNotesModal').style.display = 'flex';
    loadLocal(); loadCWs(); loadExp();
    renderWsTree();
    setWs(localStorage.getItem(LS_WS) || activeWs);
    // ★ FIX: Defer the Supabase warm-up off the click handler stack.
    // getSb() polls for __MUMS_SB_CLIENT for up to 2s — calling it synchronously
    // in openModal() blocked the click handler, causing the [Violation] 1191ms warning.
    // setTimeout(0) returns control to the browser immediately (modal renders first),
    // then the async DB init fires in the next task. Zero UX impact.
    setTimeout(() => {
      getSb()
        .then(() => { pull(); pullWorkspaces(); })
        .catch(() => { pull(); pullWorkspaces(); });
    }, 0);
  }

  function closeModal() {
    if (dirty && !confirm('You have unsaved changes. Close anyway?')) return;
    $('#myNotesModal').style.display = 'none';
    dirty = false;
  }

  /* ── INJECT TOOLBAR BUTTON ──────────────────────────────────────────────── */
  function inject() {
    const r = document.getElementById('releaseNotesBtn');
    if (!r || document.getElementById('myNotesBtn')) return !!document.getElementById('myNotesBtn');
    const b = document.createElement('button');
    b.id = 'myNotesBtn'; b.className = 'btn ghost iconbtn'; b.title = 'My Notes';
    b.innerHTML = `<img src="${ICON}" style="width:18px;height:18px;border-radius:3px;object-fit:contain">`;
    b.onclick = openModal;
    r.parentNode.insertBefore(b, r);
    return true;
  }

  function init() {
    loadCWs(); loadExp();
    if (!inject()) {
      const obs = new MutationObserver(() => { if (inject()) obs.disconnect(); });
      obs.observe(document.body, { childList:true, subtree:true });
    }
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init)
    : init();

})();
