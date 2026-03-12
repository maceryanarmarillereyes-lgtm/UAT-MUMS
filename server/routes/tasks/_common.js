/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Strictly protects Enterprise UI/UX, Realtime Sync Logic, Core State Management, and Database/API Adapters. Do NOT modify existing logic or layout in this file without explicitly asking Thunter BOY for clearance. If overlapping changes are required, STOP and provide a RISK IMPACT REPORT first. */
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
