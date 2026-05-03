/**
 * @file schema-check.js
 * @description Server startup: validates required Supabase schema tables exist on boot
 * @module MUMS/Server/Startup
 * @version UAT
 */
/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */


let columnEnsured = false;

function createFetchRpcClient(url, serviceRoleKey) {
  const baseUrl = String(url || '').replace(/\/$/, '');
  const apiKey = String(serviceRoleKey || '');

  return {
    async rpc(fn, args) {
      const name = String(fn || '').trim();
      if (!baseUrl || !apiKey || !name) {
        return {
          data: null,
          error: { message: 'Missing Supabase connection values.' },
          status: 400
        };
      }

      const endpoint = `${baseUrl}/rest/v1/rpc/${encodeURIComponent(name)}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: apiKey,
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(args || {})
      });

      const text = await response.text().catch(() => '');
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch (_) {
        data = null;
      }

      if (!response.ok) {
        return {
          data: null,
          error: data || { message: text || `Supabase RPC failed (${response.status})` },
          status: response.status
        };
      }

      return { data, error: null, status: response.status };
    }
  };
}

function createSupabaseClient(url, serviceRoleKey) {
  try {
    const supabaseLib = require('@supabase/supabase-js');
    if (supabaseLib && typeof supabaseLib.createClient === 'function') {
      return supabaseLib.createClient(url, serviceRoleKey);
    }
  } catch (_) {
    // Cloudflare bundling fallback handled below.
  }
  return createFetchRpcClient(url, serviceRoleKey);
}

async function ensureQuickbaseSettingsColumn() {
  if (columnEnsured) return true;

  try {
    const supabase = createSupabaseClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Check if column exists with correct type
    const { data } = await supabase.rpc('exec_sql', {
      sql: `
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'mums_profiles'
        AND column_name = 'quickbase_settings'
      `
    });

    if (!data || data.length === 0) {
      // Column doesn't exist, create it
      await supabase.rpc('exec_sql', {
        sql: `ALTER TABLE public.mums_profiles ADD COLUMN IF NOT EXISTS quickbase_settings JSONB DEFAULT '{}'::jsonb`
      });
    }

    columnEnsured = true;
    return true;
  } catch (err) {
    console.error('[ensureQuickbaseSettingsColumn] Error:', err);
    return false;
  }
}

module.exports = { ensureQuickbaseSettingsColumn };
