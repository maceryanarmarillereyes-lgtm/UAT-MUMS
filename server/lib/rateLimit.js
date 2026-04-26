/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

const windowMap = new Map();

function limiterConfig(kind) {
  if (kind === 'sync/pull') {
    return { windowMs: 10000, limit: 2, retryAfterSeconds: 10 };
  }
  if (kind === 'sync/push') {
    return { windowMs: 5000, limit: 3, retryAfterSeconds: 5 };
  }
  return { windowMs: 60000, limit: 30, retryAfterSeconds: 60 };
}

function keyFor(userId, kind) {
  return `${kind}:${String(userId || 'anon')}`;
}

function checkRateLimit(userId, kind) {
  const cfg = limiterConfig(kind);
  const key = keyFor(userId, kind);
  const now = Date.now();
  const list = (windowMap.get(key) || []).filter((ts) => now - ts < cfg.windowMs);

  if (list.length >= cfg.limit) {
    const oldest = list[0] || now;
    const retryAfterMs = Math.max(250, cfg.windowMs - (now - oldest));
    windowMap.set(key, list);
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000))
    };
  }

  list.push(now);
  windowMap.set(key, list);
  return { allowed: true, retryAfterSeconds: cfg.retryAfterSeconds };
}

const breakerState = {
  recent503: [],
  openUntil: 0,
  threshold: Math.max(1, Number(process.env.CIRCUIT_BREAKER_THRESHOLD || 5)),
  windowMs: 30000,
  cooldownMs: 60000,
  lastLogAt: 0
};

function isCircuitOpen() {
  return breakerState.openUntil > Date.now();
}

function record503AndMaybeOpen() {
  const now = Date.now();
  breakerState.recent503 = breakerState.recent503.filter((ts) => now - ts < breakerState.windowMs);
  breakerState.recent503.push(now);
  if (breakerState.recent503.length >= breakerState.threshold) {
    breakerState.openUntil = now + breakerState.cooldownMs;
    breakerState.recent503 = [];
    return true;
  }
  return false;
}

function log503Dedup(message, meta) {
  const now = Date.now();
  if (now - breakerState.lastLogAt < 60000) return;
  breakerState.lastLogAt = now;
  console.warn(message, meta || {});
}

function __resetRateLimitForTests() {
  windowMap.clear();
  breakerState.recent503 = [];
  breakerState.openUntil = 0;
  breakerState.lastLogAt = 0;
}

module.exports = {
  checkRateLimit,
  isCircuitOpen,
  record503AndMaybeOpen,
  log503Dedup,
  __resetRateLimitForTests
};
