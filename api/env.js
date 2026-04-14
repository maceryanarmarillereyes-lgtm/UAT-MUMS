/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Do not modify existing UI/UX, layouts, or core logic in this file without explicitly asking MACE for clearance. If changes are required here, STOP and provide a RISK IMPACT REPORT first. */
// Vercel Serverless Function: /api/env
// Returns ONLY public (safe) runtime config.
// Cache disabled to ensure fresh env across deploys.

module.exports = async (_req, res) => {
  try {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');

    const out = {
      SUPABASE_URL: process.env.SUPABASE_URL || '',
      SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || '',
      USERNAME_EMAIL_DOMAIN: process.env.USERNAME_EMAIL_DOMAIN || 'mums.local',
      // ── EGRESS-OPTIMIZED PRESENCE CONFIG (Free Plan, 30 users) ────────────
      // Budget math: 5GB/month ÷ 22 work-days ÷ 8hr/day ÷ 30 users = ~950KB/user/hr
      // Strategy: reduce DB round-trips aggressively, use idle visual state instead.
      //
      // Presence heartbeat (HB):  30s interval → 2/min vs 20/min (10× reduction)
      // Presence list poll:        60s interval → 1/min vs 20/min (20× reduction)
      // Presence TTL:             300s (5min) — row stays "alive" between HBs
      // Frontend ACTIVE threshold: 90s — green within 90s, gray beyond
      //
      // Estimated monthly egress @ 30 users, 8hr/day, 22 days:
      //   Presence list  60s: ~5.3GB   (was ~211GB at 3s) ✅
      //   Presence HB    30s: ~0.06GB  (was ~0.6GB) ✅
      //   Total with sync: ~4.5–5GB   — fits inside Free Plan
      // ── CALIBRATED FOR: 30 users × 8hr/day × 30 days = 7,200 user-hrs/month ──
      // Budget: 5 GB Free Plan → target ~3.2 GB (~1.8 GB buffer)
      // Egress math (monthly):
      //   Presence HB    45s: ~0.16 GB   (300 bytes/call)
      //   Presence List  90s: ~1.10 GB   (4 KB/response, 30 users)
      //   Sync Reconcile 90s: ~0.55 GB   (2 KB/response)
      //   Offline Pull   90s: ~0.04 GB   (fires only ~8% when realtime drops)
      //   QB Refresh    300s: ~1.36 GB   (50 KB, ~33% of users on QB page)
      //   ─────────────────────────────────────────
      //   TOTAL:               ~3.21 GB  ✅ fits with 1.79 GB buffer
      PRESENCE_TTL_SECONDS: Number(process.env.PRESENCE_TTL_SECONDS || 600),
      PRESENCE_POLL_MS: Number(process.env.PRESENCE_POLL_MS || 120000),
      PRESENCE_LIST_POLL_MS: Number(process.env.PRESENCE_LIST_POLL_MS || 300000),
      SYNC_RECONCILE_MS: Number(process.env.SYNC_RECONCILE_MS || 180000),
      MAILBOX_OVERRIDE_POLL_MS: Number(process.env.MAILBOX_OVERRIDE_POLL_MS || 120000)  /* FREE TIER: active=120s → idle=720s (was 60s → 360s) */,
      // ── REALTIME KILL SWITCH (emergency use only, defaults ON):
      // Set SYNC_ENABLE_SUPABASE_REALTIME=false in Vercel/Cloudflare env ONLY
      // if Disk IO is critically exhausted and you need immediate relief.
      // Normal operation: leave unset (defaults to 'true' = Realtime enabled).
      SYNC_ENABLE_SUPABASE_REALTIME: String(process.env.SYNC_ENABLE_SUPABASE_REALTIME || 'true')
    };

    res.end(JSON.stringify(out));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ ok: false, error: 'env_failed', message: String(err?.message || err) }));
  }
};
