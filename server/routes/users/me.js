/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */


const DEFAULT_BOOTSTRAP_EMAIL = 'supermace@mums.local';

const { getUserFromJwt, getProfileForUserId, serviceInsert, serviceUpdate } = require('../../lib/supabase');
const { normalizeSettings } = require('../../lib/normalize_settings');

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

// GET /api/users/me
// Returns the authenticated user's profile.
// IMPORTANT:
// - mums_profiles is the authoritative directory record for app access.
// - If the profile is missing, we treat the account as removed and block access.
// - Exception: the configured SUPERADMIN_EMAIL (bootstrap) may self-heal by creating a profile.
module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });

    const auth = String(req.headers.authorization || '');
    const jwt = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const authed = await getUserFromJwt(jwt);
    if (!authed) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    const email = String(authed.email || '').trim();
    const uname = email ? email.split('@')[0] : String(authed.id).slice(0, 8);
    const metaName = authed.user_metadata ? (authed.user_metadata.full_name || authed.user_metadata.name) : '';
    const defaultName = String(metaName || uname || 'User');

    let profile = await getProfileForUserId(authed.id);
    let created = false;
    let updated = false;

    // Bootstrap SUPER_ADMIN if configured.
    const bootstrapEmail = String(process.env.SUPERADMIN_EMAIL || DEFAULT_BOOTSTRAP_EMAIL).trim().toLowerCase();
    const isBootstrap = bootstrapEmail && email && bootstrapEmail === email.toLowerCase();

    if (!profile) {
      if (!isBootstrap) {
        return sendJson(res, 403, {
          ok: false,
          error: 'account_removed',
          message: 'This account has been removed from the system.'
        });
      }

      const insert = {
        user_id: authed.id,
        username: uname,
        name: defaultName,
        role: 'SUPER_ADMIN',
        // Default to Developer Access for SUPER_ADMIN (team_id NULL).
        team_id: null,
        duty: ''
      };
      const out = await serviceInsert('mums_profiles', [insert]);
      if (!out.ok) return sendJson(res, 500, { ok: false, error: 'profile_insert_failed', details: out.json || out.text });
      profile = out.json && out.json[0] ? out.json[0] : insert;
      created = true;
    } else if (isBootstrap) {
      const curRole = String(profile.role || '').toUpperCase();
      const needsRole = (curRole !== 'SUPER_ADMIN');

      if (needsRole) {
        // Promote to SUPER_ADMIN and default to Developer Access (team_id NULL, team_override=false).
        const out = await serviceUpdate(
          'mums_profiles',
          { role: 'SUPER_ADMIN', team_id: null, team_override: false },
          { user_id: `eq.${authed.id}` }
        );
        if (out.ok) {
          profile = Object.assign({}, profile, { role: 'SUPER_ADMIN', team_id: null, team_override: false });
          updated = true;
        }
      }
    }

    // Self-heal missing identifiers (common source of blank email/username in the UI).
    // We do this here (not in the client) so cloud roster stays authoritative.
    try {
      const patch = {};
      if (!String(profile.username || '').trim()) patch.username = uname;
      if (!String(profile.name || '').trim()) patch.name = defaultName;

      const roleUp = String(profile.role || '').toUpperCase();
      const tOverride = (profile.team_override !== undefined) ? !!profile.team_override : undefined;
      // If SUPER role has explicit team_override=false but a team is set, normalize back to Developer Access.
      if ((roleUp === 'SUPER_ADMIN' || roleUp === 'SUPER_USER') && tOverride === false && profile.team_id != null) {
        patch.team_id = null;
      }
      // If SUPER role has explicit team_override=true but no team_id, normalize override off.
      if ((roleUp === 'SUPER_ADMIN' || roleUp === 'SUPER_USER') && tOverride === true && profile.team_id == null) {
        patch.team_override = false;
      }

      if (Object.keys(patch).length) {
        const out = await serviceUpdate('mums_profiles', patch, { user_id: `eq.${authed.id}` });
        if (out.ok && Array.isArray(out.json) && out.json[0]) {
          profile = out.json[0];
          updated = true;
        } else {
          profile = Object.assign({}, profile, patch);
        }
      }
    } catch (_) {}

    // Best-effort: persist auth email into mums_profiles.email if the column exists.
    // This keeps the profile directory and UI consistent with the canonical login email.
    try {
      const curEmail = String(profile && profile.email ? profile.email : '').trim().toLowerCase();
      const want = String(email || '').trim().toLowerCase();
      if (want && (!curEmail || curEmail !== want)) {
        const out = await serviceUpdate('mums_profiles', { email: want }, { user_id: `eq.${authed.id}` });
        if (out && out.ok && Array.isArray(out.json) && out.json[0]) {
          profile = out.json[0];
          updated = true;
        } else {
          // If the column does not exist yet, ignore the DB error but still return email to the client.
          profile = Object.assign({}, profile, { email: want });
        }
      }
    } catch (_) {}


    const originalSettings = profile ? profile.settings : undefined;
    const normalizedSettings = normalizeSettings(originalSettings);
    if (originalSettings && typeof originalSettings !== 'object' && !Object.keys(normalizedSettings).length) {
      console.warn('normalizeSettings fallback', { userId: authed.id, originalType: typeof originalSettings });
    }

    const role = String(profile && profile.role ? profile.role : '').toUpperCase();
    const teamIdRaw = (profile && (profile.team_id === null || profile.team_id === undefined)) ? '' : String(profile.team_id || '').trim();
    let teamOverride = !!(profile && (profile.team_override ?? profile.teamOverride ?? false));
    if ((role === 'SUPER_ADMIN' || role === 'SUPER_USER') && (profile && profile.team_override === undefined && profile.teamOverride === undefined)) {
      teamOverride = !!teamIdRaw;
    }
    // Attach for frontend convenience (email may be persisted in profiles; auth email remains source of truth).
    try {
      // SECURITY + TOKEN-STATUS FIX:
      // Expose qb_token_set (boolean) so the frontend can show the correct placeholder
      // WITHOUT exposing the actual token value in the browser. The actual qb_token is
      // only read server-side (monitoring.js via getProfileForUserId with service role).
      const _hasQbToken = !!(profile && String(profile.qb_token || '').trim());
      profile = Object.assign({}, profile, {
        settingsRaw: originalSettings ?? null,
        settings: normalizedSettings,
        email,
        teamOverride,
        team_override: teamOverride,
        qb_token_set: _hasQbToken,
        qb_token: undefined  // never expose raw token to client
      });
    } catch (_) {}

    return sendJson(res, 200, { ok: true, email, teamOverride, profile, created, updated });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: 'me_failed', message: String(err && err.message ? err.message : err) });
  }
};
