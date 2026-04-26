/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

function envValue(name) {
  const proc = typeof globalThis !== 'undefined' && globalThis ? globalThis.process : undefined;
  const env = proc && proc.env ? proc.env : {};
  const v = env[name];
  return v == null ? '' : String(v).trim();
}

const supabaseUrl = envValue('SUPABASE_DB_POOLER_URL') || envValue('SUPABASE_URL');
const serviceRoleKey = envValue('SUPABASE_SERVICE_ROLE_KEY');

if (!supabaseUrl) throw new Error('Missing env: SUPABASE_DB_POOLER_URL (or SUPABASE_URL fallback)');
if (!serviceRoleKey) throw new Error('Missing env: SUPABASE_SERVICE_ROLE_KEY');

const cleanUrl = supabaseUrl.replace(/\/$/, '');
const anonKey = envValue('SUPABASE_ANON_KEY');

const supabaseAdmin = {
  auth: {
    async getUser(token) {
      const jwt = String(token || '').trim();
      if (!jwt) return { data: { user: null }, error: { message: 'missing_token' } };

      const out = await fetch(`${cleanUrl}/auth/v1/user`, {
        method: 'GET',
        headers: {
          apikey: anonKey || serviceRoleKey,
          Authorization: `Bearer ${jwt}`,
          'x-connection-pool': 'transaction'
        }
      });

      const text = await out.text().catch(() => '');
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch (_) {}
      if (!out.ok || !json) {
        return { data: { user: null }, error: { message: 'auth_lookup_failed', status: out.status } };
      }
      return { data: { user: json }, error: null };
    }
  }
};

module.exports = { supabaseAdmin };
