(function () {
  function getClient() {
    if (window.servicesDB && window.servicesDB.client) return window.servicesDB.client;
    if (window.supabase && window.servicesDB && window.servicesDB.url && window.servicesDB.anon) {
      return window.supabase.createClient(window.servicesDB.url, window.servicesDB.anon);
    }
    return null;
  }

  var BackupManager = {
    save: async function (sheet, name) {
      var client = getClient();
      if (!client) throw new Error('Supabase client unavailable');
      var userOut = await client.auth.getUser();
      var uid = userOut && userOut.data && userOut.data.user ? userOut.data.user.id : null;
      var backup = {
        sheet_id: sheet.id,
        user_id: uid,
        name: name || ('Backup ' + new Date().toLocaleString()),
        data: { rows: sheet.rows || [], columns: sheet.column_defs || [] },
        row_count: (sheet.rows || []).length
      };
      return await client.from('services_backups').insert(backup);
    },

    list: async function (sheetId) {
      var client = getClient();
      if (!client) throw new Error('Supabase client unavailable');
      return await client.from('services_backups')
        .select('*')
        .eq('sheet_id', sheetId)
        .order('created_at', { ascending: false })
        .limit(20);
    },

    restore: async function (backupId) {
      var client = getClient();
      if (!client) throw new Error('Supabase client unavailable');
      var out = await client.from('services_backups').select('*').eq('id', backupId).single();
      return out && out.data ? out.data.data : null;
    }
  };

  window.BackupManager = BackupManager;
})();
