/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */


// First-party proxy for Supabase UMD bundle.
//
// Why:
// - Some browsers (e.g., Edge InPrivate / Tracking Prevention) block third-party
//   scripts loaded from CDNs from using storage APIs.
// - Supabase's browser SDK probes storage during init.
// - Serving the SDK from the same origin avoids the 3rd-party context and
//   prevents console noise / potential initialization failures.
//
// This route fetches the pinned Supabase UMD bundle from jsDelivr server-side,
// then serves it as first-party JavaScript.

const SUPABASE_VERSION = '2.49.0';
const SUPABASE_UMD_URL = `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@${SUPABASE_VERSION}/dist/umd/supabase.min.js`;

function sendJs(res, statusCode, body, extraHeaders) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  // Long cache: version is pinned.
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=2592000, stale-while-revalidate=86400');
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) {
      try { res.setHeader(k, v); } catch (_) {}
    }
  }
  res.end(body || '');
}

async function fetchText(url) {
  const r = await fetch(url, {
    // Avoid any surprises with content negotiation.
    headers: {
      'Accept': 'application/javascript,text/javascript,*/*;q=0.9'
    }
  });
  const text = await r.text();
  return { ok: r.ok, status: r.status, text, headers: r.headers };
}

module.exports = async (req, res) => {
  try {
    // Allow cache-busting while keeping a stable upstream URL.
    const out = await fetchText(SUPABASE_UMD_URL);

    if (!out.ok || !out.text) {
      // Return a JS payload too (helps debugging when opened directly), but
      // keep a failing status so browser <script> triggers onerror and can
      // fall back to other sources.
      return sendJs(
        res,
        502,
        `console.warn('[MUMS] Failed to load Supabase SDK (proxy). Status: ${out.status}');\n`,
        { 'X-MUMS-Vendor': 'supabase', 'X-MUMS-Upstream-Status': String(out.status || '') }
      );
    }

    const pass = {};
    // Preserve upstream ETag if present (helps CDN/browser caching).
    try {
      const etag = out.headers && out.headers.get ? out.headers.get('etag') : null;
      if (etag) pass.ETag = etag;
    } catch (_) {}

    // Tag for easier debugging.
    pass['X-MUMS-Vendor'] = 'supabase';
    pass['X-MUMS-Vendor-Version'] = SUPABASE_VERSION;

    return sendJs(res, 200, out.text, pass);
  } catch (err) {
    return sendJs(
      res,
      502,
      `console.warn('[MUMS] Supabase SDK proxy exception: ${String(err && (err.message || err) || 'unknown')}');\n`,
      { 'X-MUMS-Vendor': 'supabase', 'X-MUMS-Upstream-Status': 'exception' }
    );
  }
};
