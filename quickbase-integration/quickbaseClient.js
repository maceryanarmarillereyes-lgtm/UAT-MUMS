/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Do not modify existing UI/UX, layouts, or core logic in this file without explicitly asking Thunter BOY for clearance. If changes are required here, STOP and provide a RISK IMPACT REPORT first. */
/**
 * quickbaseClient.js
 * Minimal Quickbase REST client using a User Token stored in env vars.
 */
const axios = require('axios');

const QB_REALM = process.env.QB_REALM;
const QB_TOKEN = process.env.QB_USER_TOKEN;

if (!QB_REALM || !QB_TOKEN) {
  console.warn('QB_REALM or QB_USER_TOKEN not set. Set them in env before running.');
}

const qb = axios.create({
  baseURL: 'https://api.quickbase.com/v1',
  headers: {
    'QB-Realm-Hostname': QB_REALM,
    'Authorization': `QB-USER-TOKEN ${QB_TOKEN}`,
    'Content-Type': 'application/json'
  },
  timeout: 10000
});

async function queryRecords(tableId, where = '', options = {}) {
  const body = { from: tableId };
  if (where) body.where = where;
  if (options.select) body.select = options.select;
  if (options.sortBy) body.sortBy = options.sortBy;
  if (options.options) body.options = options.options;
  const res = await qb.post('/records/query', body);
  return res.data;
}

module.exports = { queryRecords };
