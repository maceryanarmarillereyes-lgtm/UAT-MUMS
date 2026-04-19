(function () {
  // Re-use credentials from MUMS_ENV (same pattern as realtime.js / dashboard.js)
  function getEnv() {
    return window.MUMS_ENV || {};
  }

  function getClient() {
    // Re-use the existing shared Supabase client if available
    if (window.__MUMS_SB_CLIENT) return window.__MUMS_SB_CLIENT;
    const env = getEnv();
    const url = env.SUPABASE_URL;
    const key = env.SUPABASE_ANON_KEY;
    if (!url || !key) {
      console.error('[services] Missing Supabase credentials in MUMS_ENV.');
      return null;
    }
    window.__MUMS_SB_CLIENT = window.supabase.createClient(url, key, {
      realtime: { params: { eventsPerSecond: 10 } }
    });
    return window.__MUMS_SB_CLIENT;
  }

  window.servicesDB = {
    get client() { return getClient(); },

    async listSheets() {
      const c = getClient(); if (!c) return [];
      const { data, error } = await c.from('services_sheets')
        .select('*').eq('is_archived', false).order('sort_order', { ascending: true });
      if (error) console.error('[services] listSheets:', error);
      return data || [];
    },

    async createSheet(title = 'Untitled Sheet') {
      const c = getClient(); if (!c) return null;
      const { data, error } = await c.from('services_sheets')
        .insert({ title }).select().single();
      if (error) console.error('[services] createSheet:', error);
      return data;
    },

    async renameSheet(id, title) {
      const c = getClient(); if (!c) return;
      return c.from('services_sheets').update({ title }).eq('id', id);
    },

    async deleteSheet(id) {
      const c = getClient(); if (!c) return;
      return c.from('services_sheets').update({ is_archived: true }).eq('id', id);
    },

    async listRows(sheetId) {
      const c = getClient(); if (!c) return [];
      const { data, error } = await c.from('services_rows')
        .select('*').eq('sheet_id', sheetId).order('row_index', { ascending: true });
      if (error) console.error('[services] listRows:', error);
      return data || [];
    },

    async upsertRow(sheetId, rowIndex, data) {
      const c = getClient(); if (!c) return;
      const { data: existing } = await c.from('services_rows')
        .select('id').eq('sheet_id', sheetId).eq('row_index', rowIndex).maybeSingle();
      if (existing) {
        return c.from('services_rows').update({ data }).eq('id', existing.id);
      }
      return c.from('services_rows').insert({ sheet_id: sheetId, row_index: rowIndex, data });
    },

    async updateColumns(sheetId, column_defs) {
      const c = getClient(); if (!c) return;
      return c.from('services_sheets').update({ column_defs }).eq('id', sheetId);
    },

    subscribeToSheet(sheetId, onRowChange) {
      const c = getClient(); if (!c) return { unsubscribe: () => {} };
      return c.channel(`services_rows_${sheetId}`)
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'services_rows', filter: `sheet_id=eq.${sheetId}` },
            onRowChange)
        .subscribe();
    },

    subscribeToSheets(onSheetChange) {
      const c = getClient(); if (!c) return { unsubscribe: () => {} };
      return c.channel('services_sheets_all')
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'services_sheets' },
            onSheetChange)
        .subscribe();
    }
  };
})();
