/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */
const { getUserFromJwt, getProfileForUserId, serviceFetch, serviceSelect, serviceInsert, serviceUpdate, serviceUpsert } = require('../../lib/supabase');

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

async function requireAuthedUser(req) {
  const auth = String((req && req.headers && req.headers.authorization) || '');
  const jwt = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
  const authed = await getUserFromJwt(jwt);
  if (!authed) return null;
  const profile = await getProfileForUserId(authed.id);
  return { authed, profile };
}

function roleFlags(roleRaw) {
  const role = String(roleRaw || '').toUpperCase();
  return {
    isAdmin: role === 'SUPER_ADMIN' || role === 'SUPER_USER' || role === 'ADMIN',
    isLead: role === 'TEAM_LEAD'
  };
}

function escLike(v) {
  return encodeURIComponent(String(v || '').replace(/%/g, '\\%').replace(/,/g, '\\,'));
}

module.exports = {
  sendJson,
  requireAuthedUser,
  roleFlags,
  escLike,
  serviceFetch,
  serviceSelect,
  serviceInsert,
  serviceUpdate,
  serviceUpsert
};
