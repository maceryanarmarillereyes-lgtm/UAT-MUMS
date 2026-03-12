/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Do not modify existing UI/UX, layouts, or core logic in this file without explicitly asking Thunter BOY for clearance. If changes are required here, STOP and provide a RISK IMPACT REPORT first. */
// Cloudflare Pages Function: serve vendor assets as first-party resources.
//
// Route (via file-based routing):
//   /functions/vendor/:file
//
// Why this file exists:
// - Cloudflare Pages strips the `.js` extension from function routes.
// - The UI loader intentionally requests `/functions/vendor/supabase.js`.
// - Using a dynamic segment lets us support that exact URL, where `:file` becomes
//   `supabase.js`.
//
// Dual-platform architecture (see AGENTS.md):
// - Vercel UAT:  /api/vendor/supabase.js
// - Cloudflare:  /functions/vendor/supabase.js

const SUPABASE_VERSION = '2.49.0';
const SUPABASE_UMD_URL = `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@${SUPABASE_VERSION}/dist/umd/supabase.min.js`;

async function serveSupabaseUMD() {
  const r = await fetch(SUPABASE_UMD_URL, {
    headers: { Accept: 'application/javascript,text/javascript,*/*;q=0.9' }
  });
  const text = await r.text();

  if (!r.ok || !text) {
    return new Response(
      `console.warn('[MUMS] Failed to load Supabase SDK (Cloudflare proxy). Status: ${r.status}');\n`,
      {
        status: 502,
        headers: {
          'content-type': 'application/javascript; charset=utf-8',
          'cache-control': 'public, max-age=60, s-maxage=60',
          'x-mums-vendor': 'supabase',
          'x-mums-upstream-status': String(r.status || '')
        }
      }
    );
  }

  const headers = {
    'content-type': 'application/javascript; charset=utf-8',
    // Version is pinned, safe to cache.
    'cache-control': 'public, max-age=86400, s-maxage=2592000, stale-while-revalidate=86400',
    'x-mums-vendor': 'supabase',
    'x-mums-vendor-version': SUPABASE_VERSION
  };

  try {
    const etag = r.headers.get('etag');
    if (etag) headers.etag = etag;
  } catch (_) {}

  return new Response(text, { status: 200, headers });
}

export async function onRequest(context) {
  try {
    const file = (context && context.params && context.params.file) || '';

    // Support the exact URL used by the UI loader.
    if (file === 'supabase.js') {
      return await serveSupabaseUMD();
    }

    // Explicit 404 for any other vendor requests.
    return new Response('Not Found', {
      status: 404,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store'
      }
    });
  } catch (err) {
    return new Response(
      `console.warn('[MUMS] Vendor proxy exception (Cloudflare): ${String(err && (err.message || err) || 'unknown')}');\n`,
      {
        status: 502,
        headers: {
          'content-type': 'application/javascript; charset=utf-8',
          'cache-control': 'public, max-age=60, s-maxage=60',
          'x-mums-upstream-status': 'exception'
        }
      }
    );
  }
}
