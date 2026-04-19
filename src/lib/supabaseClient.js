import { createClient } from '@supabase/supabase-js';

function fetchWithTimeout(timeoutMs) {
  return async (input, init = {}) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  };
}

const storage = typeof window !== 'undefined' ? window.localStorage : undefined;
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage,
    storageKey: 'mums-auth',
    flowType: 'pkce'
  },
  realtime: { params: { eventsPerSecond: 2 } },
  global: { fetch: fetchWithTimeout(15000) }
});

export { fetchWithTimeout };
