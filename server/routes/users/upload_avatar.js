/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

const { getUserFromJwt, getProfileForUserId, serviceFetch, serviceUpdate } = require('../../lib/supabase');

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    try {
      if (req && typeof req.body !== 'undefined' && req.body !== null) {
        if (typeof req.body === 'object' && !Array.isArray(req.body)) return resolve(req.body);
        if (typeof req.body === 'string') {
          try { return resolve(req.body ? JSON.parse(req.body) : {}); } catch (e) { return reject(e); }
        }
      }
    } catch (_) {}

    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); }
    });
  });
}

function base64ToBytes(b64) {
  const raw = String(b64 || '').replace(/\s/g, '');
  // Node (Vercel) path
  try {
    if (typeof Buffer !== 'undefined') {
      return new Uint8Array(Buffer.from(raw, 'base64'));
    }
  } catch (_) {}

  // Worker/Browser path
  const bin = (typeof atob === 'function') ? atob(raw) : '';
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function encodePath(p) {
  return String(p || '')
    .split('/')
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

function parseDataUrl(dataUrl) {
  const s = String(dataUrl || '');
  const m = s.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  const contentType = String(m[1] || '').trim() || 'application/octet-stream';
  const b64 = String(m[2] || '');
  const buf = base64ToBytes(b64);
  let ext = 'bin';
  if (contentType.includes('png')) ext = 'png';
  else if (contentType.includes('jpeg') || contentType.includes('jpg')) ext = 'jpg';
  else if (contentType.includes('webp')) ext = 'webp';
  return { contentType, buf, ext };
}

// POST /api/users/upload_avatar
// Body: { dataUrl: "data:image/png;base64,..." }
// Server-side upload (service role) to Supabase Storage.
module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });

    const auth = String(req.headers.authorization || '');
    const jwt = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const authed = await getUserFromJwt(jwt);
    if (!authed) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    const body = await readBody(req);
    const parsed = parseDataUrl(body.dataUrl || body.data_url);
    if (!parsed || !parsed.buf || !parsed.buf.length) return sendJson(res, 400, { ok: false, error: 'invalid_image' });

    // Hard cap to keep payloads sane (client should already compress/crop).
    const maxBytes = 2.2 * 1024 * 1024;
    if (parsed.buf.length > maxBytes) return sendJson(res, 413, { ok: false, error: 'image_too_large', maxBytes: Math.floor(maxBytes) });

    const prof = await getProfileForUserId(authed.id);
    if (!prof) return sendJson(res, 404, { ok: false, error: 'profile_missing', message: 'Profile not found. Call /api/users/me first.' });

    const bucket = String(process.env.SUPABASE_PUBLIC_BUCKET || 'public').trim() || 'public';
    const rand = Math.random().toString(36).slice(2, 10);
    const path = `avatars/${authed.id}/${Date.now()}_${rand}.${parsed.ext}`;

    // Upload to Storage.
    const up = await serviceFetch(`/storage/v1/object/${encodeURIComponent(bucket)}/${encodePath(path)}`, {
      method: 'POST',
      headers: {
        'Content-Type': parsed.contentType,
        'x-upsert': 'true'
      },
      body: parsed.buf
    });

    if (!up.ok) {
      const errText = up.text || (up.json ? JSON.stringify(up.json) : '');
      return sendJson(res, 500, { ok: false, error: 'storage_upload_failed', status: up.status, details: errText });
    }

    const base = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
    const publicUrl = `${base}/storage/v1/object/public/${bucket}/${path}`;

    const out = await serviceUpdate('mums_profiles', { avatar_url: publicUrl }, { user_id: `eq.${authed.id}` });
    if (!out.ok) return sendJson(res, 500, { ok: false, error: 'profile_update_failed', details: out.json || out.text });

    return sendJson(res, 200, { ok: true, url: publicUrl, path, bucket });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: 'upload_avatar_failed', message: String(err && err.message ? err.message : err) });
  }
};
