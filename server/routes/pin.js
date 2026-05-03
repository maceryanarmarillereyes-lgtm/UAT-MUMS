/**
 * @file pin.js
 * @description Pin module
 * @module MUMS/MUMS
 * @version UAT
 */
/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */


/* PIN Security Routes — /api/pin/*
   Handles: setup, verify, reset (admin), policy (get/set)
   bcrypt is not available in Cloudflare Workers, so we use
   PBKDF2 via the Web Crypto API (available in both Node 18+ and CF Workers).
*/
const { getUserFromJwt, getProfileForUserId, serviceUpdate, serviceSelect, serviceUpsert, invalidateProfileCache } = require('../lib/supabase');

function sendJson(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req && typeof req.body !== 'undefined' && req.body !== null) {
    if (typeof req.body === 'object' && !Array.isArray(req.body)) return req.body;
    if (typeof req.body === 'string') {
      try { return req.body ? JSON.parse(req.body) : {}; } catch (_) { return {}; }
    }
  }
  return new Promise((resolve) => {
    let data = '';
    req.on('data', c => { data += c; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (_) { resolve({}); }
    });
  });
}

// ── PBKDF2 hash (Web Crypto — works in Node 18+ and Cloudflare Workers) ──────
async function hashPin(pin) {
  const enc = new TextEncoder();
  const saltArr = new Uint8Array(16);
  // Use deterministic salt seeded from pin+timestamp for storage
  // In production use crypto.getRandomValues but we need a storable salt
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(saltArr);
  } else {
    const nodeCrypto = require('crypto');
    const randBytes = nodeCrypto.randomBytes(16);
    for (let i = 0; i < 16; i++) saltArr[i] = randBytes[i];
  }
  const saltHex = Array.from(saltArr).map(b => b.toString(16).padStart(2, '0')).join('');
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltArr, iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  const hashHex = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2:${saltHex}:${hashHex}`;
}

async function verifyPin(pin, stored) {
  if (!stored || !stored.startsWith('pbkdf2:')) return false;
  const parts = stored.split(':');
  if (parts.length !== 3) return false;
  const saltHex = parts[1];
  const storedHash = parts[2];
  const saltArr = new Uint8Array(saltHex.match(/.{2}/g).map(b => parseInt(b, 16)));
  const enc = new TextEncoder();
  try {
    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: saltArr, iterations: 100000, hash: 'SHA-256' },
      keyMaterial, 256
    );
    const hashHex = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
    // Constant-time comparison
    if (hashHex.length !== storedHash.length) return false;
    let diff = 0;
    for (let i = 0; i < hashHex.length; i++) diff |= hashHex.charCodeAt(i) ^ storedHash.charCodeAt(i);
    return diff === 0;
  } catch (_) {
    return false;
  }
}

// ── Read global PIN policy ─────────────────────────────────────────────────
async function readPinPolicy() {
  const q = `select=key,value&key=eq.mums_pin_policy&limit=1`;
  const out = await serviceSelect('mums_documents', q);
  if (!out.ok) return { enabled: true, requireOnLogin: true, enforceOnFirstLogin: true, sessionExpiryHours: 3, autoLogoutOnFailures: true, maxFailedAttempts: 3 };
  const row = Array.isArray(out.json) && out.json[0] ? out.json[0] : null;
  const val = (row && row.value) ? row.value : {};
  return {
    enabled:               val.enabled !== false,
    requireOnLogin:        val.requireOnLogin !== false,
    enforceOnFirstLogin:   val.enforceOnFirstLogin !== false,
    sessionExpiryHours:    Number(val.sessionExpiryHours) || 3,
    autoLogoutOnFailures:  val.autoLogoutOnFailures !== false,
    maxFailedAttempts:     Number(val.maxFailedAttempts) || 3,
  };
}

// ── Role check ────────────────────────────────────────────────────────────
function canManagePin(actorRole) {
  const r = String(actorRole || '').toUpperCase();
  return r === 'SUPER_ADMIN' || r === 'SUPER_USER' || r === 'TEAM_LEAD';
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// Routes: POST /api/pin/setup  — create/update own PIN
//         POST /api/pin/verify — verify PIN on session start
//         POST /api/pin/reset  — admin reset another user's PIN
//         GET  /api/pin/policy — get PIN policy
//         POST /api/pin/policy — update PIN policy (SA/SU only)
//         GET  /api/pin/status — get own PIN status (set/not set)
// ══════════════════════════════════════════════════════════════════════════════
module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');

    const auth = String(req.headers.authorization || '');
    const jwt = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const authed = await getUserFromJwt(jwt);
    if (!authed) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    const actor = await getProfileForUserId(authed.id);
    if (!actor) return sendJson(res, 403, { ok: false, error: 'profile_missing' });

    // Extract action from URL path
    const url = String(req.url || '');
    const pathParts = url.split('?')[0].split('/').filter(Boolean);
    const action = pathParts[pathParts.length - 1]; // last segment

    const method = String(req.method || 'GET').toUpperCase();

    // ── GET /api/pin/policy ────────────────────────────────────────────────
    if (action === 'policy' && method === 'GET') {
      const policy = await readPinPolicy();
      return sendJson(res, 200, { ok: true, policy });
    }

    // ── POST /api/pin/policy ───────────────────────────────────────────────
    if (action === 'policy' && method === 'POST') {
      const actorRole = String(actor.role || '').toUpperCase();
      if (actorRole !== 'SUPER_ADMIN' && actorRole !== 'SUPER_USER') {
        return sendJson(res, 403, { ok: false, error: 'insufficient_permission' });
      }
      const body = await readBody(req);
      const current = await readPinPolicy();
      const next = {
        enabled:               body.enabled !== undefined ? !!body.enabled : current.enabled,
        requireOnLogin:        body.requireOnLogin !== undefined ? !!body.requireOnLogin : current.requireOnLogin,
        enforceOnFirstLogin:   body.enforceOnFirstLogin !== undefined ? !!body.enforceOnFirstLogin : current.enforceOnFirstLogin,
        sessionExpiryHours:    Number(body.sessionExpiryHours) || current.sessionExpiryHours,
        autoLogoutOnFailures:  body.autoLogoutOnFailures !== undefined ? !!body.autoLogoutOnFailures : current.autoLogoutOnFailures,
        maxFailedAttempts:     Number(body.maxFailedAttempts) || current.maxFailedAttempts,
      };
      const upsertOut = await serviceUpsert('mums_documents', [{ key: 'mums_pin_policy', value: next }], 'key');
      if (!upsertOut.ok) return sendJson(res, 500, { ok: false, error: 'policy_save_failed' });
      return sendJson(res, 200, { ok: true, policy: next });
    }

    // ── GET /api/pin/status ────────────────────────────────────────────────
    if (action === 'status' && method === 'GET') {
      const policy = await readPinPolicy();

      // FIX-PIN-1: Admin-mode — allow SA/SU/TL to read another user's PIN status
      // by passing ?target_user_id=<uuid> in the query string.
      const urlObj = new URL('http://x' + url); // parse query params
      const targetQp = urlObj.searchParams.get('target_user_id') || '';
      const actorRole = String(actor.role || '').toUpperCase();

      let subjectProfile = actor; // default: own profile

      if (targetQp && targetQp !== actor.user_id) {
        // Only elevated roles can read another user's PIN status
        if (!canManagePin(actorRole)) {
          return sendJson(res, 403, { ok: false, error: 'insufficient_permission' });
        }
        const targetProfile = await getProfileForUserId(targetQp);
        if (!targetProfile) {
          return sendJson(res, 404, { ok: false, error: 'target_user_not_found' });
        }
        subjectProfile = targetProfile;
      }

      const pinIsSet = !!(subjectProfile.pin_hash);
      return sendJson(res, 200, {
        ok: true,
        pinSet: pinIsSet,
        pinSetAt: subjectProfile.pin_set_at || null,
        pinLastUsedAt: subjectProfile.pin_last_used_at || null,
        pinFailCount: Number(subjectProfile.pin_fail_count) || 0,
        policy
      });
    }

    // ── POST /api/pin/setup ────────────────────────────────────────────────
    if (action === 'setup' && method === 'POST') {
      const body = await readBody(req);
      const pin = String(body.pin || '').trim();
      if (!pin || !/^\d{4}$/.test(pin)) {
        return sendJson(res, 400, { ok: false, error: 'invalid_pin', message: 'PIN must be exactly 4 digits.' });
      }
      const hashed = await hashPin(pin);
      const upd = await serviceUpdate('mums_profiles', {
        pin_hash: hashed,
        pin_set_at: new Date().toISOString(),
        pin_fail_count: 0,
        pin_last_fail_at: null
      }, { user_id: 'eq.' + actor.user_id });
      if (!upd.ok) return sendJson(res, 500, { ok: false, error: 'pin_save_failed' });
      // Invalidate cache so next status read is fresh
      invalidateProfileCache(actor.user_id);
      console.log(`[PIN] Setup by user ${actor.user_id}`);
      return sendJson(res, 200, { ok: true, message: 'PIN created successfully.' });
    }

    // ── POST /api/pin/verify ───────────────────────────────────────────────
    if (action === 'verify' && method === 'POST') {
      const body = await readBody(req);
      const pin = String(body.pin || '').trim();
      if (!pin || !/^\d{4}$/.test(pin)) {
        return sendJson(res, 400, { ok: false, error: 'invalid_pin' });
      }

      // Reload actor to get latest fail count and pin_hash
      const freshActor = await getProfileForUserId(authed.id);
      if (!freshActor || !freshActor.pin_hash) {
        return sendJson(res, 400, { ok: false, error: 'pin_not_set', message: 'No PIN configured.' });
      }

      const policy = await readPinPolicy();
      const correct = await verifyPin(pin, freshActor.pin_hash);

      if (correct) {
        // Reset fail count on success
        await serviceUpdate('mums_profiles', {
          pin_fail_count: 0,
          pin_last_fail_at: null,
          pin_last_used_at: new Date().toISOString()
        }, { user_id: 'eq.' + actor.user_id });
        console.log(`[PIN] Verified OK for user ${actor.user_id}`);
        return sendJson(res, 200, { ok: true, verified: true });
      } else {
        const newFailCount = (Number(freshActor.pin_fail_count) || 0) + 1;
        await serviceUpdate('mums_profiles', {
          pin_fail_count: newFailCount,
          pin_last_fail_at: new Date().toISOString()
        }, { user_id: 'eq.' + actor.user_id });
        const shouldLogout = policy.autoLogoutOnFailures && newFailCount >= (policy.maxFailedAttempts || 3);
        console.log(`[PIN] Failed attempt ${newFailCount} for user ${actor.user_id}`);
        return sendJson(res, 200, {
          ok: false,
          verified: false,
          failCount: newFailCount,
          maxAttempts: policy.maxFailedAttempts || 3,
          shouldLogout,
          message: shouldLogout
            ? 'Maximum attempts reached. You will be signed out.'
            : `Incorrect PIN. ${(policy.maxFailedAttempts || 3) - newFailCount} attempt(s) remaining.`
        });
      }
    }

    // ── POST /api/pin/reset ────────────────────────────────────────────────
    // Admin resets another user's PIN (clears it so they must create new one)
    if (action === 'reset' && method === 'POST') {
      const actorRole = String(actor.role || '').toUpperCase();
      if (!canManagePin(actorRole)) {
        return sendJson(res, 403, { ok: false, error: 'insufficient_permission',
          message: 'Only Team Lead, Super User, or Super Admin can reset PINs.' });
      }
      const body = await readBody(req);
      const targetUserId = String(body.user_id || body.userId || '').trim();
      if (!targetUserId) return sendJson(res, 400, { ok: false, error: 'missing_user_id' });

      const target = await getProfileForUserId(targetUserId);
      if (!target) return sendJson(res, 404, { ok: false, error: 'user_not_found' });

      // Team Lead can only reset members of their own team
      if (actorRole === 'TEAM_LEAD') {
        if (String(target.team_id || '') !== String(actor.team_id || '')) {
          return sendJson(res, 403, { ok: false, error: 'cross_team_forbidden' });
        }
        // Team Lead cannot reset other leads/admins
        const targetRole = String(target.role || '').toUpperCase();
        if (targetRole !== 'MEMBER') {
          return sendJson(res, 403, { ok: false, error: 'role_forbidden' });
        }
      }

      const upd = await serviceUpdate('mums_profiles', {
        pin_hash: null,
        pin_set_at: null,
        pin_fail_count: 0,
        pin_last_fail_at: null,
        pin_last_used_at: null
      }, { user_id: 'eq.' + targetUserId });
      if (!upd.ok) return sendJson(res, 500, { ok: false, error: 'reset_failed' });

      // FIX-PIN-2: Invalidate profile cache so the next /api/pin/status call
      // reads fresh data from the DB — not the stale cached profile with old pin_hash.
      invalidateProfileCache(targetUserId);
      invalidateProfileCache(actor.user_id);

      console.log(`[PIN] Reset by ${actor.user_id} (${actorRole}) for user ${targetUserId}`);
      return sendJson(res, 200, { ok: true, message: `PIN cleared for ${target.name || targetUserId}. User will be prompted to create a new PIN on next login.` });
    }

    return sendJson(res, 404, { ok: false, error: 'unknown_action' });

  } catch (err) {
    console.error('[PIN Route Error]', err);
    return sendJson(res, 500, { ok: false, error: 'server_error', message: String(err?.message || err) });
  }
};
