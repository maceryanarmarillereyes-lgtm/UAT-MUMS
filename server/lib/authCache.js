/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

const { supabaseAdmin } = require('./supabaseAdmin');

const MAX_ENTRIES = 500;
const POSITIVE_TTL_MS = Math.max(1000, Number(process.env.AUTH_CACHE_TTL_MS || 300000));
const NEGATIVE_TTL_MS = 60000;

const cache = new Map();
let customVerifier = null;

function now() {
  return Date.now();
}

function pruneExpired() {
  const t = now();
  for (const [key, value] of cache.entries()) {
    if (value.expiresAt <= t) cache.delete(key);
  }
}

function setEntry(token, payload) {
  if (!token) return;
  if (cache.has(token)) cache.delete(token);
  cache.set(token, payload);
  while (cache.size > MAX_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
}

function getEntry(token) {
  const entry = cache.get(token);
  if (!entry) return null;
  if (entry.expiresAt <= now()) {
    cache.delete(token);
    return null;
  }
  cache.delete(token);
  cache.set(token, entry);
  return entry;
}

async function verifyJwtCached(token) {
  const jwt = String(token || '').trim();
  if (!jwt) return null;

  const cached = getEntry(jwt);
  if (cached) return cached.user;

  pruneExpired();

  const verifier = customVerifier || ((token) => supabaseAdmin.auth.getUser(token));
  const { data, error } = await verifier(jwt);
  if (error || !data || !data.user) {
    setEntry(jwt, { user: null, expiresAt: now() + NEGATIVE_TTL_MS });
    return null;
  }

  setEntry(jwt, { user: data.user, expiresAt: now() + POSITIVE_TTL_MS });
  return data.user;
}

function __resetAuthCacheForTests() {
  cache.clear();
  customVerifier = null;
}

function __setAuthVerifierForTests(fn) {
  customVerifier = typeof fn === 'function' ? fn : null;
}

module.exports = {
  verifyJwtCached,
  __resetAuthCacheForTests,
  __setAuthVerifierForTests
};
