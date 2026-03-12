/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Do not modify existing UI/UX, layouts, or core logic in this file without explicitly asking Thunter BOY for clearance. If changes are required here, STOP and provide a RISK IMPACT REPORT first. */
#!/usr/bin/env node
/*
  Smoke test: verify /api/env wiring for Cloudflare (Main) and Vercel (UAT).

  Usage:
    CLOUDFLARE_URL=https://your-pages-domain.example \
    VERCEL_URL=https://your-vercel-uat.example \
    EXPECTED_PROD_REF=xxxxxxxxxxxxxxx \
    EXPECTED_UAT_REF=yyyyyyyyyyyyyyy \
    node scripts/test-env.js

  Notes:
  - EXPECTED_*_REF should be the Supabase project ref (the subdomain in https://<ref>.supabase.co).
  - The script fails if keys are missing, if URLs are malformed, or refs mismatch.
*/

const REQUIRED_KEYS = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "USERNAME_EMAIL_DOMAIN"];

function die(msg) {
  console.error(`\n❌ ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`✅ ${msg}`);
}

function warn(msg) {
  console.warn(`⚠️  ${msg}`);
}

function normalizeBaseUrl(v) {
  if (!v) return "";
  let s = String(v).trim();
  // allow users to paste without scheme
  if (s && !/^https?:\/\//i.test(s)) s = `https://${s}`;
  // remove trailing slash
  s = s.replace(/\/+$/, "");
  return s;
}

function extractSupabaseRef(supabaseUrl) {
  try {
    const u = new URL(String(supabaseUrl));
    const host = u.hostname; // <ref>.supabase.co or <ref>.supabase.in
    const parts = host.split(".");
    if (parts.length < 3) return "";
    return parts[0];
  } catch {
    return "";
  }
}

async function fetchEnv(baseUrl) {
  const url = `${baseUrl}/api/env`;
  const r = await fetch(url, {
    method: "GET",
    headers: { "accept": "application/json" },
    redirect: "follow",
    cache: "no-store",
  });

  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // leave json as null
  }

  if (!r.ok) {
    const snippet = (text || "").slice(0, 300);
    die(`${url} returned HTTP ${r.status}. Body: ${snippet}`);
  }
  if (!json || typeof json !== "object") {
    die(`${url} did not return JSON. Body: ${(text || "").slice(0, 300)}`);
  }

  for (const k of REQUIRED_KEYS) {
    if (!json[k] || typeof json[k] !== "string") {
      die(`${url} missing required key: ${k}`);
    }
  }

  if (!/^https:\/\//.test(json.SUPABASE_URL) || !/supabase\./.test(json.SUPABASE_URL)) {
    die(`${url} returned an invalid SUPABASE_URL: ${json.SUPABASE_URL}`);
  }

  const ref = extractSupabaseRef(json.SUPABASE_URL);
  if (!ref) {
    die(`${url} could not extract project ref from SUPABASE_URL: ${json.SUPABASE_URL}`);
  }

  return { url, json, ref, status: r.status };
}

async function main() {
  const cfBase = normalizeBaseUrl(process.env.CLOUDFLARE_URL);
  const vercelBase = normalizeBaseUrl(process.env.VERCEL_URL);

  const expectedProdRef = (process.env.EXPECTED_PROD_REF || "").trim();
  const expectedUatRef = (process.env.EXPECTED_UAT_REF || "").trim();

  if (!cfBase) die("CLOUDFLARE_URL is required");
  if (!vercelBase) die("VERCEL_URL is required");

  console.log("\n🔎 Fetching runtime env...");
  const [cf, vc] = await Promise.all([fetchEnv(cfBase), fetchEnv(vercelBase)]);

  console.log("\n— Results —");
  console.log(`Cloudflare: ${cf.url}`);
  console.log(`  SUPABASE_URL: ${cf.json.SUPABASE_URL}`);
  console.log(`  ref: ${cf.ref}`);

  console.log(`Vercel:     ${vc.url}`);
  console.log(`  SUPABASE_URL: ${vc.json.SUPABASE_URL}`);
  console.log(`  ref: ${vc.ref}`);

  if (expectedProdRef) {
    if (cf.ref !== expectedProdRef) {
      die(`Cloudflare project ref mismatch. Expected ${expectedProdRef} but got ${cf.ref}`);
    }
    ok(`Cloudflare points to expected PROD ref: ${expectedProdRef}`);
  } else {
    warn("EXPECTED_PROD_REF not set — skipping PROD ref assertion.");
  }

  if (expectedUatRef) {
    if (vc.ref !== expectedUatRef) {
      die(`Vercel project ref mismatch. Expected ${expectedUatRef} but got ${vc.ref}`);
    }
    ok(`Vercel points to expected UAT ref: ${expectedUatRef}`);
  } else {
    warn("EXPECTED_UAT_REF not set — skipping UAT ref assertion.");
  }

  // Cross-check: do not allow both to point at the same project unless explicitly intended.
  if (cf.ref === vc.ref) {
    warn(`Both deployments point to the same Supabase project ref (${cf.ref}). If this is not intended, fix SUPABASE_URL.`);
  }

  ok("/api/env smoke test passed.");
}

main().catch((e) => {
  die(e && e.stack ? e.stack : String(e));
});
