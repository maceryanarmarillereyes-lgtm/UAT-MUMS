(function () {
  // ─────────────────────────────────────────────────────────────────────────────
  // services-supabase.js  — v3 (free-tier load reduction)
  //
  // OVERLOAD FIXES applied here:
  //   FIX-1: upsertRow now uses a single ON CONFLICT query (was SELECT + write = 2x)
  //   FIX-2: Singleton channel guards prevent duplicate realtime subscriptions
  //   FIX-3: persistSession:false stops SDK fighting browser tracking prevention
  //   FIX-4: eventsPerSecond throttled to 4 (was 10) — free tier websocket limit
  // ─────────────────────────────────────────────────────────────────────────────

  const LS_SESSION = 'mums_supabase_session';
  const CACHE_TTL = 30 * 1000; // 30 seconds only

  // ── Read MUMS session from same-origin storage (never blocked) ───────────────
  function readMumsSession() {
    const sources = [
      () => localStorage.getItem(LS_SESSION),
      () => sessionStorage.getItem(LS_SESSION),
      () => {
        const m = document.cookie.match('(?:^|;)\\s*' + LS_SESSION + '=([^;]*)');
        return m ? decodeURIComponent(m[1]) : null;
      }
    ];
    for (const src of sources) {
      try {
        const raw = src();
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.access_token) return parsed;
        }
      } catch (_) {}
    }
    return null;
  }

  // ── Single Supabase client (shared with main app if already created) ─────────
  function buildClient(url, key) {
    if (window.__MUMS_SB_CLIENT) return window.__MUMS_SB_CLIENT;
    window.__MUMS_SB_CLIENT = window.supabase.createClient(url, key, {
      auth: {
        persistSession: false,    // FIX-3: don't fight tracking prevention
        autoRefreshToken: true,
        detectSessionInUrl: false
      },
      realtime: {
        params: { eventsPerSecond: 4 }  // FIX-4: free tier is ~4 events/s safe
      }
    });
    return window.__MUMS_SB_CLIENT;
  }

  // ── Ready promise ─────────────────────────────────────────────────────────────
  let _resolveReady;
  const _ready = new Promise(res => { _resolveReady = res; });

  // ── FIX-2: Singleton channel references — prevents stale subscriptions ────────
  // Each key maps to exactly one live Supabase channel.
  // Calling subscribe again auto-removes the old channel first.
  const _channels = new Map();

  function openChannel(key, setup) {
    const c = window.__MUMS_SB_CLIENT;
    if (!c) return { unsubscribe: () => {} };
    // Remove previous channel with this key
    const prev = _channels.get(key);
    if (prev) {
      try { c.removeChannel(prev); } catch (_) {}
    }
    const ch = setup(c, key);
    _channels.set(key, ch);
    return {
      unsubscribe() {
        try { c.removeChannel(ch); } catch (_) {}
        _channels.delete(key);
      }
    };
  }

  // ── init() ────────────────────────────────────────────────────────────────────
  async function init() {
    const envObj = window.MUMS_ENV || {};
    const url = envObj.SUPABASE_URL;
    const key = envObj.SUPABASE_ANON_KEY;

    if (!url || !key) {
      console.error('[services] MUMS_ENV missing SUPABASE_URL / SUPABASE_ANON_KEY.');
      _resolveReady(false);
      return false;
    }

    const client = buildClient(url, key);

    const sess = readMumsSession();
    if (sess && sess.access_token && sess.refresh_token) {
      try {
        const { error } = await client.auth.setSession({
          access_token:  sess.access_token,
          refresh_token: sess.refresh_token
        });
        if (error) {
          const { error: re } = await client.auth.refreshSession({
            refresh_token: sess.refresh_token
          });
          if (re) {
            console.error('[services] Session refresh failed — redirecting to login.');
            _resolveReady(false);
            window.location.href = '/login.html?redirect=/services.html';
            return false;
          }
        }
      } catch (e) {
        console.error('[services] Auth error:', e);
      }
    } else {
      console.warn('[services] No MUMS session — redirecting to login.');
      _resolveReady(false);
      window.location.href = '/login.html?redirect=/services.html';
      return false;
    }

    _resolveReady(true);
    return true;
  }

  async function db() {
    await _ready;
    return window.__MUMS_SB_CLIENT;
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  window.servicesDB = {
    init,
    ready: _ready,
    get client() { return window.__MUMS_SB_CLIENT; },

    async listSheets() {
      const c = await db(); if (!c) return [];
      const { data, error } = await c
        .from('services_sheets').select('*')
        .eq('is_archived', false)
        .order('sort_order', { ascending: true });
      if (error) console.error('[services] listSheets:', error.message);
      return data || [];
    },

    async createSheet(title = 'Untitled Sheet') {
      const c = await db(); if (!c) return null;
      const { data, error } = await c
        .from('services_sheets').insert({ title }).select().single();
      if (error) console.error('[services] createSheet:', error.message);
      return data;
    },

    async renameSheet(id, title) {
      const c = await db(); if (!c) return;
      const { error } = await c.from('services_sheets').update({ title }).eq('id', id);
      if (error) console.error('[services] renameSheet:', error.message);
    },

    async deleteSheet(id) {
      const c = await db(); if (!c) return;
      const { error } = await c.from('services_sheets')
        .update({ is_archived: true }).eq('id', id);
      if (error) console.error('[services] deleteSheet:', error.message);
    },

    async listRows(sheetId, force = false) {
      const c = await db(); if (!c) return [];

      const KEY = `mums_rows_${sheetId}_v4`; // Bump version to invalidate old cache
      const cached = localStorage.getItem(KEY);
      if (!force && cached) {
        try {
          const { ts, rows } = JSON.parse(cached);
          if (Date.now() - ts < CACHE_TTL) return rows || [];
        } catch (_) {}
      }

      const { data, error } = await c
        .from('services_rows')
        .select('*')
        .eq('sheet_id', sheetId)
        .order('id', { ascending: true })
        .limit(1000);

      if (error) {
        console.error('[DB] Fetch failed:', error);
        throw error;
      }

      try {
        localStorage.setItem(KEY, JSON.stringify({ ts: Date.now(), rows: data || [] }));
      } catch (_) {}

      return data || [];
    },

    // FIX-1: Single-query UPSERT using ON CONFLICT (sheet_id, row_index)
    // Previous: SELECT to check existence + INSERT or UPDATE = 2 PostgREST calls
    // Now:      1 call. Requires unique constraint uq_services_rows_sheet_row
    async upsertRow(sheetId, rowIndex, data) {
      const c = await db(); if (!c) return;
      const { error } = await c.from('services_rows')
        .upsert(
          { sheet_id: sheetId, row_index: rowIndex, data },
          { onConflict: 'sheet_id,row_index', ignoreDuplicates: false }
        );
      if (error) console.error('[services] upsertRow:', error.message);
    },

    // ── QB → SHEET BRIDGE ──────────────────────────────────────────────────────
    // Appends a new row at the bottom of the sheet with the QB case number.
    // Sets data._qb_sent=true, _qb_ack=false so the Services grid can highlight it.
    async sendCaseToSheet(sheetId, caseNum, description) {
      const c = await db(); if (!c) return { ok: false, error: 'No DB client' };
      // FIX: Resolve the actual first column key of this sheet.
      // Default column_defs use col_a/col_b/col_c — writing to col_0 was silently
      // discarded because no column had that key, so case# never appeared in the grid.
      let firstColKey = 'col_a'; // safe default matches DB default column_defs
      try {
        const { data: sheetMeta } = await c
          .from('services_sheets')
          .select('column_defs')
          .eq('id', sheetId)
          .limit(1)
          .single();
        if (sheetMeta && Array.isArray(sheetMeta.column_defs) && sheetMeta.column_defs.length > 0) {
          firstColKey = sheetMeta.column_defs[0].key || 'col_a';
        }
      } catch (_) {}
      // Find current max row_index for this sheet
      const { data: existing, error: fetchErr } = await c
        .from('services_rows')
        .select('row_index')
        .eq('sheet_id', sheetId)
        .order('row_index', { ascending: false })
        .limit(1);
      if (fetchErr) return { ok: false, error: fetchErr.message };
      var nextIdx = existing && existing.length > 0 ? (existing[0].row_index + 1) : 0;
      var rowData = {
        _qb_sent: true,
        _qb_ack: false,
        _qb_case_num: String(caseNum),
        _qb_sent_at: new Date().toISOString(),
        _qb_desc: String(description || ''),
      };
      // Write to the real first column key — this is what the grid renders
      rowData[firstColKey] = String(caseNum);
      var { error: upsertErr } = await c.from('services_rows')
        .upsert(
          { sheet_id: sheetId, row_index: nextIdx, data: rowData },
          { onConflict: 'sheet_id,row_index', ignoreDuplicates: false }
        );
      if (upsertErr) return { ok: false, error: upsertErr.message };
      return { ok: true, rowIndex: nextIdx };
    },

    // Acknowledge a QB-sent row (clears the cyan blink)
    async ackQbRow(sheetId, rowIndex) {
      const c = await db(); if (!c) return;
      // Fetch current data first
      const { data: rows } = await c.from('services_rows')
        .select('data').eq('sheet_id', sheetId).eq('row_index', rowIndex).limit(1);
      if (!rows || !rows.length) return;
      var merged = Object.assign({}, rows[0].data, { _qb_ack: true });
      await c.from('services_rows')
        .update({ data: merged })
        .eq('sheet_id', sheetId).eq('row_index', rowIndex);
    },

    // Delete a QB-sent row from the sheet
    async deleteQbRow(sheetId, rowIndex) {
      const c = await db(); if (!c) return;
      await c.from('services_rows')
        .delete()
        .eq('sheet_id', sheetId).eq('row_index', rowIndex);
    },

    async updateColumns(sheetId, column_defs) {
      const c = await db(); if (!c) return;
      const { error } = await c.from('services_sheets')
        .update({ column_defs }).eq('id', sheetId);
      if (error) console.error('[services] updateColumns:', error.message);
    },

    // FIX-2: singleton channel per sheet — old channel removed before new one opens
    subscribeToSheet(sheetId, onRowChange) {
      return openChannel(`rows_${sheetId}`, (c, key) =>
        c.channel(key)
          .on('postgres_changes',
              { event: '*', schema: 'public', table: 'services_rows',
                filter: `sheet_id=eq.${sheetId}` },
              onRowChange)
          .subscribe()
      );
    },

    // FIX-2: singleton sheets channel — never stacks
    subscribeToSheets(onSheetChange) {
      return openChannel('sheets_global', (c, key) =>
        c.channel(key)
          .on('postgres_changes',
              { event: '*', schema: 'public', table: 'services_sheets' },
              onSheetChange)
          .subscribe()
      );
    },

    // ── TreeView Folder CRUD ──────────────────────────────────────────────────
    async listTreeFolders(sheetId) {
      const c = await db(); if (!c) return [];
      const { data, error } = await c
        .from('services_treeview_folders').select('*')
        .eq('sheet_id', sheetId)
        .order('sort_order', { ascending: true });
      if (error) {
        console.error('[services] listTreeFolders:', error.message);
        throw new Error(error.message || 'list_tree_folders_failed');
      }
      return data || [];
    },

    async createTreeFolder(sheetId, { name, icon = '📁', color = '#22D3EE',
      condition_field = null, condition_op = 'eq', condition_value = '', sort_order = 0 } = {}) {
      const c = await db(); if (!c) return null;
      const { data, error } = await c
        .from('services_treeview_folders')
        .insert({ sheet_id: sheetId, name, icon, color, condition_field, condition_op, condition_value, sort_order })
        .select().single();
      if (error) {
        console.error('[services] createTreeFolder:', error.message);
        throw new Error(error.message || 'create_tree_folder_failed');
      }
      return data;
    },

    async renameTreeFolder(id, name) {
      const c = await db(); if (!c) return;
      const { error } = await c.from('services_treeview_folders').update({ name }).eq('id', id);
      if (error) {
        console.error('[services] renameTreeFolder:', error.message);
        throw new Error(error.message || 'rename_tree_folder_failed');
      }
    },

    async updateTreeFolder(id, patch) {
      const c = await db(); if (!c) return;
      const { error } = await c.from('services_treeview_folders').update(patch).eq('id', id);
      if (error) {
        console.error('[services] updateTreeFolder:', error.message);
        throw new Error(error.message || 'update_tree_folder_failed');
      }
    },

    async deleteTreeFolder(id) {
      const c = await db(); if (!c) return;
      const { error } = await c.from('services_treeview_folders').delete().eq('id', id);
      if (error) {
        console.error('[services] deleteTreeFolder:', error.message);
        throw new Error(error.message || 'delete_tree_folder_failed');
      }
    },

    // Graceful teardown — call on page unload to free server-side channels
    cleanup() {
      const c = window.__MUMS_SB_CLIENT;
      if (!c) return;
      _channels.forEach((ch) => { try { c.removeChannel(ch); } catch (_) {} });
      _channels.clear();
    }
  };

  // Auto-cleanup on page unload so server-side channels don't accumulate
  window.addEventListener('beforeunload', () => window.servicesDB.cleanup());
})();

// ─────────────────────────────────────────────────────────────────────────────
// ADDITIVE PATCH — bulkUpsertRows()
// Single batch upsert using ON CONFLICT(sheet_id,row_index).
// Used by the SAVE button and CSV/XLSX import. Does NOT touch auth, RLS,
// or realtime channels — purely a new write helper.
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  const _orig = window.servicesDB;
  if (!_orig) { console.error('[services] bulkUpsertRows patch: servicesDB not found'); return; }

  _orig.bulkUpsertRows = async function bulkUpsertRows(sheetId, rowsArray) {
    if (!rowsArray || rowsArray.length === 0) return { error: null };
    if (_orig.ready) await _orig.ready;
    const c = _orig.client;
    if (!c || typeof c.from !== 'function') {
      console.error('[services] bulkUpsertRows: invalid client instance');
      return { error: 'No Supabase client' };
    }
    const payload = rowsArray.map(function (r) {
      return { sheet_id: sheetId, row_index: r.row_index, data: r.data || {} };
    });
    const { error } = await c
      .from('services_rows')
      .upsert(payload, { onConflict: 'sheet_id,row_index', ignoreDuplicates: false });
    if (error) console.error('[services] bulkUpsertRows:', error.message);
    return { error: error || null };
  };
})();
