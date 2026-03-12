/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Do not modify existing UI/UX, layouts, or core logic in this file without explicitly asking Thunter BOY for clearance. If changes are required here, STOP and provide a RISK IMPACT REPORT first. */
function sendJson(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store'
    }
  });
}

function toNodeHeaders(request) {
  const out = {};
  request.headers.forEach((v, k) => {
    out[String(k).toLowerCase()] = v;
  });
  return out;
}

async function readBodyForNodeReq(request) {
  const m = String(request.method || 'GET').toUpperCase();
  if (m === 'GET' || m === 'HEAD') return undefined;
  const text = await request.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch (_) { return text; }
}

function createNodeRes() {
  const headers = new Headers();
  let statusCode = 200;
  let body = '';

  return {
    set statusCode(v) { statusCode = Number(v || 200); },
    setHeader(name, value) { try { headers.set(String(name), String(value)); } catch (_) {} },
    end(data) {
      if (typeof data === 'undefined' || data === null) return;
      body += (typeof data === 'string') ? data : String(data);
    },
    _toResponse() {
      if (!headers.has('cache-control')) headers.set('cache-control', 'no-store');
      return new Response(body || '', { status: statusCode || 200, headers });
    }
  };
}

if (typeof globalThis.process === 'undefined') globalThis.process = { env: {} };
if (!globalThis.process.env) globalThis.process.env = {};

function ensureProcessEnv(env) {
  if (!globalThis.process) globalThis.process = { env: {} };
  if (!globalThis.process.env) globalThis.process.env = {};
  globalThis.__MUMS_ENV = env || {};
  const src = env || {};
  for (const k of Object.keys(src)) {
    globalThis.process.env[k] = src[k] == null ? '' : String(src[k]);
  }
}

let mod = null;
async function loadHandler(env) {
  ensureProcessEnv(env);
  if (!mod) {
    const loaded = await import('../../../server/routes/quickbase/monitoring.js');
    mod = (loaded && (loaded.default || loaded)) || loaded;
  }
  return mod;
}

export async function onRequest(context) {
  const handler = await loadHandler(context.env);
  if (!handler) return sendJson(500, { ok: false, error: 'handler_missing' });

  const req = context.request;
  const url = new URL(req.url);

  const nodeReq = {
    method: req.method,
    url: req.url,
    headers: { ...toNodeHeaders(req), host: url.host },
    query: Object.fromEntries(url.searchParams.entries()),
    body: await readBodyForNodeReq(req),
    socket: { remoteAddress: '' }
  };

  const nodeRes = createNodeRes();
  try {
    await handler(nodeReq, nodeRes);
    return nodeRes._toResponse();
  } catch (e) {
    return sendJson(500, { ok: false, error: 'handler_failed', message: String(e?.message || e) });
  }
}
