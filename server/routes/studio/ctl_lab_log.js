/**
 * @file ctl_lab_log.js
 * @description Ctl Lab Log module
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

const { getUserFromJwt } = require('../../lib/supabase');

const DEFAULT_SHEETS_ENDPOINT = 'https://script.google.com/macros/s/AKfycbwqLf7vypKtM978oGn5_qovvLwmjzjDvwNM1WnvyykjT71TxxxJ6KFjF-BogbGLXWA5ow/exec';
const REQUEST_TIMEOUT_MS = 10000;

function sendJson(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function safeStr(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max || 500);
}

function normalizePayload(src) {
  return {
    timestamp: safeStr(src && src.timestamp, 120),
    user: safeStr(src && src.user, 160),
    controller: safeStr(src && src.controller, 240),
    task: safeStr(src && src.task, 240),
    duration: safeStr(src && src.duration, 80),
    backupFile: safeStr(src && src.backupFile, 1200),
    note: safeStr(src && src.note, 240),
  };
}

function parseBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    if (typeof req.body === 'string') {
      try { return resolve(JSON.parse(req.body)); } catch (_) { return resolve({}); }
    }
    let d = '';
    req.on('data', (c) => { d += c; });
    req.on('end', () => {
      try { resolve(d ? JSON.parse(d) : {}); } catch (_) { resolve({}); }
    });
  });
}

async function postToSheet(endpoint, payload) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  try {
    const form = new URLSearchParams(payload);
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: form.toString(),
      signal: ac.signal,
    });
    const text = await r.text().catch(() => '');
    return { ok: r.ok, status: r.status, text };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });

    const auth = String(req.headers.authorization || '');
    const jwt = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const user = await getUserFromJwt(jwt);
    if (!user) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    const body = await parseBody(req);
    const payload = normalizePayload(body);
    if (!payload.task || !payload.user || !payload.controller) {
      return sendJson(res, 400, { ok: false, error: 'invalid_payload' });
    }

    const endpoint = safeStr(process.env.CTL_SHEETS_ENDPOINT || process.env.SHEETS_ENDPOINT || DEFAULT_SHEETS_ENDPOINT, 1200);
    if (!endpoint) return sendJson(res, 500, { ok: false, error: 'sheet_endpoint_missing' });

    const out = await postToSheet(endpoint, payload);
    if (!out.ok) {
      return sendJson(res, 502, {
        ok: false,
        error: 'sheet_write_failed',
        status: out.status,
        detail: safeStr(out.text, 300),
      });
    }

    return sendJson(res, 200, { ok: true, status: out.status });
  } catch (err) {
    const isAbort = err && (err.name === 'AbortError' || String(err.message || '').toLowerCase().includes('aborted'));
    return sendJson(res, isAbort ? 504 : 500, {
      ok: false,
      error: isAbort ? 'sheet_timeout' : 'internal_error',
      message: safeStr(err && err.message ? err.message : err, 220),
    });
  }
};
