/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Do not modify existing UI/UX, layouts, or core logic in this file without explicitly asking MACE for clearance. If changes are required here, STOP and provide a RISK IMPACT REPORT first. */
// Cloudflare Pages Function: /api/env
// Returns ONLY public (safe) runtime config.
// Cache disabled to ensure fresh env across deploys.

export async function onRequest(context) {
  try {
    const env = context.env || {};
    const out = {
      SUPABASE_URL: env.SUPABASE_URL || '',
      SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY || '',
      USERNAME_EMAIL_DOMAIN: env.USERNAME_EMAIL_DOMAIN || 'mums.local',
      PRESENCE_TTL_SECONDS: Number(env.PRESENCE_TTL_SECONDS || 360),
      PRESENCE_POLL_MS: Number(env.PRESENCE_POLL_MS || 45000),
      PRESENCE_LIST_POLL_MS: Number(env.PRESENCE_LIST_POLL_MS || 90000),
      SYNC_RECONCILE_MS: Number(env.SYNC_RECONCILE_MS || 90000),
      MAILBOX_OVERRIDE_POLL_MS: Number(env.MAILBOX_OVERRIDE_POLL_MS || 60000)  /* FREE TIER: active=60s → idle=360s (was 10s → 60s) */,
      // DISK IO GUARD: set to 'false' in Cloudflare Pages env to disable WAL Realtime
      SYNC_ENABLE_SUPABASE_REALTIME: String(env.SYNC_ENABLE_SUPABASE_REALTIME || 'true')
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
