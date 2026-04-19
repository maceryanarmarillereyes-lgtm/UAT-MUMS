(function () {
  // ─────────────────────────────────────────────────────────────────────────────
  // services-supabase.js
  //
  // ROOT CAUSE FIX (401 + Tracking Prevention):
  //   When services.html opens as a new page the CDN-loaded Supabase SDK cannot
  //   read its own localStorage due to Edge/Firefox Tracking Prevention, so
  //   auth.getSession() returns null → every RLS-protected query gets 401.
  //
  //   FIX: Our first-party code IS allowed to read same-origin localStorage.
  //   We read the MUMS session key ('mums_supabase_session') directly and
  //   call client.auth.setSession() ourselves before any query runs.
  //   All DB helpers are gated behind the `ready` promise so nothing fires
  //   before the session is confirmed.
  // ─────────────────────────────────────────────────────────────────────────────

  const LS_SESSION = 'mums_supabase_session'; // same key as cloud_auth.js

  // ── Read MUMS session from storage (first-party, never blocked) ──────────────
  function readMumsSession() {
    const sources = [
      () => localStorage.getItem(LS_SESSION),
      () => sessionStorage.getItem(LS_SESSION),
      () => {
        // Cookie fallback
        const match = document.cookie.match('(?:^|;)\\s*' + LS_SESSION + '=([^;]*)');
        return match ? decodeURIComponent(match[1]) : null;
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

  // ── Build / reuse the Supabase client ────────────────────────────────────────
  function buildClient(url, key) {
    if (window.__MUMS_SB_CLIENT) return window.__MUMS_SB_CLIENT;
    const client = window.supabase.createClient(url, key, {
      auth: {
        persistSession: false,   // Don't let SDK fight with tracking prevention
        autoRefreshToken: true,
        detectSessionInUrl: false
      },
      realtime: { params: { eventsPerSecond: 10 } }
    });
    window.__MUMS_SB_CLIENT = client;
    return client;
  }

  // ── Ready promise — resolves once session is injected ────────────────────────
  let _resolveReady;
  const _ready = new Promise(res => { _resolveReady = res; });

  // ── init() — MUST be called once before any DB operation ─────────────────────
  async function init() {
    const envObj = window.MUMS_ENV || {};
    const url = envObj.SUPABASE_URL;
    const key = envObj.SUPABASE_ANON_KEY;

    if (!url || !key) {
      console.error('[services] MUMS_ENV missing SUPABASE_URL / SUPABASE_ANON_KEY. ' +
                    'Ensure env_runtime.js loaded and Cloudflare env vars are set.');
      _resolveReady(false);
      return false;
    }

    const client = buildClient(url, key);

    // Inject session so RLS receives a valid JWT
    const sess = readMumsSession();
    if (sess && sess.access_token && sess.refresh_token) {
      try {
        const { error } = await client.auth.setSession({
          access_token:  sess.access_token,
          refresh_token: sess.refresh_token
        });
        if (error) {
          console.warn('[services] setSession error:', error.message);
          // Token may be expired — attempt refresh
          const { error: re } = await client.auth.refreshSession({ refresh_token: sess.refresh_token });
          if (re) {
            console.error('[services] Session refresh failed:', re.message,
                          '— redirecting to login.');
            _resolveReady(false);
            window.location.href = '/login.html?redirect=/services.html';
            return false;
          }
        }
      } catch (e) {
        console.error('[services] Unexpected auth error:', e);
      }
    } else {
      // No session at all → must log in first
      console.warn('[services] No MUMS session found — redirecting to login.');
      _resolveReady(false);
      window.location.href = '/login.html?redirect=/services.html';
      return false;
    }

    _resolveReady(true);
    return true;
  }

  // ── Helper: gate every call behind ready ─────────────────────────────────────
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
        .from('services_sheets')
        .select('*')
        .eq('is_archived', false)
        .order('sort_order', { ascending: true });
      if (error) console.error('[services] listSheets:', error.message);
      return data || [];
    },

    async createSheet(title = 'Untitled Sheet') {
      const c = await db(); if (!c) return null;
      const { data, error } = await c
        .from('services_sheets')
        .insert({ title })
        .select()
        .single();
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
      const { error } = await c.from('services_sheets').update({ is_archived: true }).eq('id', id);
      if (error) console.error('[services] deleteSheet:', error.message);
    },

    async listRows(sheetId) {
      const c = await db(); if (!c) return [];
      const { data, error } = await c
        .from('services_rows')
        .select('*')
        .eq('sheet_id', sheetId)
        .order('row_index', { ascending: true });
      if (error) console.error('[services] listRows:', error.message);
      return data || [];
    },

    async upsertRow(sheetId, rowIndex, data) {
      const c = await db(); if (!c) return;
      const { data: existing } = await c
        .from('services_rows')
        .select('id')
        .eq('sheet_id', sheetId)
        .eq('row_index', rowIndex)
        .maybeSingle();
      const { error } = existing
        ? await c.from('services_rows').update({ data }).eq('id', existing.id)
        : await c.from('services_rows').insert({ sheet_id: sheetId, row_index: rowIndex, data });
      if (error) console.error('[services] upsertRow:', error.message);
    },

    async updateColumns(sheetId, column_defs) {
      const c = await db(); if (!c) return;
      const { error } = await c.from('services_sheets').update({ column_defs }).eq('id', sheetId);
      if (error) console.error('[services] updateColumns:', error.message);
    },

    subscribeToSheet(sheetId, onRowChange) {
      const c = window.__MUMS_SB_CLIENT;
      if (!c) return { unsubscribe: () => {} };
      return c.channel(`services_rows_${sheetId}`)
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'services_rows', filter: `sheet_id=eq.${sheetId}` },
            onRowChange)
        .subscribe();
    },

    subscribeToSheets(onSheetChange) {
      const c = window.__MUMS_SB_CLIENT;
      if (!c) return { unsubscribe: () => {} };
      return c.channel('services_sheets_all')
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'services_sheets' },
            onSheetChange)
        .subscribe();
    }
  };
})();
