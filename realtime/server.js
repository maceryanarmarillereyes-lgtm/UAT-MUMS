/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Do not modify existing UI/UX, layouts, or core logic in this file without explicitly asking Thunter BOY for clearance. If changes are required here, STOP and provide a RISK IMPACT REPORT first. */

/**
 * MUMS Realtime Relay Server
 * - Pure local development/testing utility.
 * - Broadcasts selected store keys across clients so Edge + Incognito can stay in sync.
 *
 * Usage:
 *   cd dashboard/realtime
 *   npm install
 *   npm start
 */
const http = require('http');
const WebSocket = require('ws');

const BASE_PORT = process.env.PORT ? Number(process.env.PORT) : 17601;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('MUMS realtime relay is running.\n');
});

const wss = new WebSocket.Server({ server });

/** In-memory state (latest value per key). */
const snapshot = Object.create(null);

function safeSend(ws, obj){
  try{ ws.send(JSON.stringify(obj)); }catch(_){}
}

function broadcast(fromClientId, obj){
  const data = JSON.stringify(obj);
  for(const client of wss.clients){
    if(client.readyState !== WebSocket.OPEN) continue;
    try{
      // If message includes a clientId, let clients self-filter echoes.
      client.send(data);
    }catch(_){}
  }
}

wss.on('connection', (ws) => {
  ws._clientId = null;

  // send snapshot once connected (client will ignore echo loops)
  safeSend(ws, { t:'snapshot', data: snapshot, ts: Date.now() });

  ws.on('message', (raw) => {
    let msg;
    try{ msg = JSON.parse(String(raw||'{}')); }catch(_){ return; }
    if(!msg || typeof msg !== 'object') return;

    if(msg.t === 'hello'){
      ws._clientId = String(msg.clientId||'') || null;
      return;
    }

    if(msg.t === 'store:update'){
      const key = String(msg.key||'');
      if(!key) return;
      snapshot[key] = msg.value;
      broadcast(ws._clientId, { t:'store:update', key, value: msg.value, clientId: msg.clientId||null, ts: Date.now() });
      return;
    }
  });
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`[mums-realtime] port ${BASE_PORT} is already in use.`);
    console.error('[mums-realtime] Close the other process, or run: set PORT=17602 && npm start');
    process.exit(1);
  }
  console.error('[mums-realtime] server error:', err);
  process.exit(1);
});

server.listen(BASE_PORT, () => {
  console.log(`[mums-realtime] listening on http://localhost:${BASE_PORT} (ws://localhost:${BASE_PORT})`);
});
