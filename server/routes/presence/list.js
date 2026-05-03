/**
 * @file list.js
 * @description List module
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


const DEFAULT_BOOTSTRAP_EMAIL = 'supermace@mums.local';

const { getUserFromJwt, getProfileForUserId, serviceSelect } = require('../../lib/supabase');
function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function toMs(v) {
  const t = Date.parse(String(v || ''));
  return Number.isFinite(t) ? t : 0;
}


function normalizeTeamId(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  const t = s.toLowerCase();
  if (t === 'developer access' || t === 'developer_access' || t === 'developer') return null;
  return s;
}

function envFromProcess() {
  return {
    // FIX: Default was 25s — caused users to vanish after one missed HB at 45s interval.
    // Must match PRESENCE_TTL_SECONDS in api/env.js (360s = 6min = 3 missed HBs).
    PRESENCE_TTL_SECONDS: Number(process.env.PRESENCE_TTL_SECONDS || 360)
  };
}

// GET /api/presence/list
// Returns online roster for authenticated users.
module.exports = async (req, res) => {
  try {
    // 30s cache — presence data is polled every 60s anyway.
    // Allows browser to deduplicate rapid calls (e.g. tab switch + poll coincidence).
    res.setHeader('Cache-Control', 'private, max-age=30');
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });

    const auth = String(req.headers.authorization || '');
    const jwt = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const authed = await getUserFromJwt(jwt);
    if (!authed) return sendJson(res, 401, { ok: false, error: 'unauthorized' });


// If profile is missing, treat account as removed and deny access.
// Exception: bootstrap SUPERADMIN_EMAIL may self-heal via heartbeat.
try {
  const profile = await getProfileForUserId(authed.id);
  if (!profile) {
    const email0 = String(authed.email || '').trim().toLowerCase();
    const bootstrapEmail0 = String(process.env.SUPERADMIN_EMAIL || DEFAULT_BOOTSTRAP_EMAIL).trim().toLowerCase();
    const isBootstrap0 = bootstrapEmail0 && email0 && (bootstrapEmail0 === email0);
    if (!isBootstrap0) {
      return sendJson(res, 403, { ok: false, error: 'account_removed', message: 'This account has been removed from the system.' });
    }
  }
} catch (_) {}

    const env = envFromProcess();
    const ttl = Number.isFinite(env.PRESENCE_TTL_SECONDS) ? env.PRESENCE_TTL_SECONDS : 360;
    const cutoff = new Date(Date.now() - ttl * 1000).toISOString();

    // Lean payload — omit 'route' field (not used by online bar renderer)
    // saves ~15-20 bytes per row × 30 users × thousands of fetches/month
    const select = 'client_id,user_id,name,role,team_id,last_seen';
    const q = `select=${select}&last_seen=gte.${encodeURIComponent(cutoff)}&order=last_seen.desc&limit=300`;

    const out = await serviceSelect('mums_presence', q);
    if (!out.ok) {
      return sendJson(res, 500, { ok: false, error: 'supabase_select_failede_list_failed', status: out.status, details: out.json || out.text });
    }

    const rowsRaw = (Array.isArray(out.json) ? out.json : [])
      // Filter out explicit offline markers (sent by watchdog on browser close / logout)
      .filter(r => String(r && r.route || '') !== '__offline__');

// De-duplicate by user_id (or client_id fallback), selecting the newest by last_seen.
// This prevents flicker when the same user has multiple tabs/devices.
const bestByKey = new Map();
for (const r of rowsRaw) {
  if (!r) continue;
  const key = String(r.user_id || r.userId || r.client_id || '').trim();
  if (!key) continue;
  const ts = toMs(r.last_seen || r.lastSeen);
  const prev = bestByKey.get(key);
  if (!prev || toMs(prev.last_seen || prev.lastSeen) < ts) {
    bestByKey.set(key, r);
  }
}
const rows = Array.from(bestByKey.values()).sort((a, b) => toMs(b.last_seen || b.lastSeen) - toMs(a.last_seen || a.lastSeen));

// IO-OPT: Override presence role/team/name using mums_profiles.
    // This prevents older clients (or multiple tabs) from causing role/shift flicker.
    // FIX: Cache the working SELECT column string after the first successful probe.
    // Original code re-tried up to 4 selects on EVERY list call (4x DB reads on old schemas).
    // After fix: probe only on first call, cache result, reuse forever = 1 DB read per list call.
    try {
      const ids = rows.map((r) => String(r.user_id || '').trim()).filter(Boolean);
      if (ids.length) {
        const base = 'user_id,name,role,team_id';

        // Use cached select string if available; otherwise probe once and cache result.
        if (!module.exports._knownProfileSelect) {
          const candidates = [
            base + ',team_override,avatar_url',
            base + ',avatar_url',
            base + ',team_override',
            base
          ];
          for (const sel of candidates) {
            const q = `select=${sel}&user_id=in.(${ids.join(',')})`;
            const probe = await serviceSelect('mums_profiles', q);
            if (probe.ok && Array.isArray(probe.json)) {
              module.exports._knownProfileSelect = sel; // cache for all future calls
              break;
            }
            const msg = String((probe.json && (probe.json.message || probe.json.error)) || probe.text || '');
            if (!((probe.status === 400) && /column .* does not exist/i.test(msg))) break;
          }
        }

        let profRows = null;
        if (module.exports._knownProfileSelect) {
          const q = `select=${module.exports._knownProfileSelect}&user_id=in.(${ids.join(',')})`;
          const profOut = await serviceSelect('mums_profiles', q);
          if (profOut.ok && Array.isArray(profOut.json)) {
            profRows = profOut.json;
          } else {
            // Column may have been dropped; reset cache so next call re-probes
            module.exports._knownProfileSelect = null;
          }
        }

        if (profRows) {
          const profilesById = {};
          for (const p of profRows) {
            if (p && p.user_id) profilesById[String(p.user_id)] = p;
          }

          for (const r of rows) {
            const p = profilesById[String(r.user_id || '')];
            if (!p) continue;

            const roleUpper = String(p.role || r.role || '').toUpperCase();
            const isDevAccess = (roleUpper === 'SUPER_ADMIN' || roleUpper === 'SUPER_USER');

            // team_override is optional; when absent, infer override ONLY if team_id points to a real shift.
            let teamOverride = false;
            if (p.team_override !== undefined) teamOverride = !!p.team_override;
            else if (p.teamOverride !== undefined) teamOverride = !!p.teamOverride;
            else if (isDevAccess) teamOverride = !!normalizeTeamId(p.team_id);

            r.name = p.name || r.name;
            r.role = p.role || r.role;

            const normTeam = normalizeTeamId(p.team_id != null ? p.team_id : r.team_id);
            // SUPER roles default to Developer Access (team_id NULL) unless team_override=true.
            r.team_id = (isDevAccess && !teamOverride) ? null : (normTeam != null ? normTeam : null);
            r.team_override = teamOverride;

            if (p.avatar_url !== undefined) r.avatar_url = p.avatar_url || r.avatar_url || '';
          }
        }
      }
    } catch (_) {}

    // Compact response — strip ttlSeconds (client doesn't use it at runtime)
    return sendJson(res, 200, { ok: true, rows });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: 'list_failed', message: String(err && err.message ? err.message : err) });
  }
};
