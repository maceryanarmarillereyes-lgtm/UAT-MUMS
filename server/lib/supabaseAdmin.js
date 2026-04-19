const { createClient } = require('@supabase/supabase-js');

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

const supabaseAdmin = createClient(supabaseUrl.replace(/\/$/, ''), serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false
  },
  db: { schema: 'public' },
  global: {
    headers: {
      'x-connection-pool': 'transaction'
    }
  }
});

module.exports = { supabaseAdmin };
