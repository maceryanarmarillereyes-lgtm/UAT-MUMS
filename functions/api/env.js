/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Do not modify existing UI/UX, layouts, or core logic in this file without explicitly asking Thunter BOY for clearance. If changes are required here, STOP and provide a RISK IMPACT REPORT first. */
// Cloudflare Pages Function: /api/env
// Returns ONLY public (safe) runtime config.
// Cache disabled to ensure fresh env across deploys.

export async function onRequest(context) {
  try {
    const env = context.env || {};
    const out = {
      SUPABASE_URL: env.SUPABASE_URL || '',
      SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY || '',
      USERNAME_EMAIL_DOMAIN: env.USERNAME_EMAIL_DOMAIN || 'mums.local'
    };

    return new Response(JSON.stringify(out), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store'
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: 'env_failed', message: String(err?.message || err) }), {
      status: 500,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store'
      }
    });
  }
}
