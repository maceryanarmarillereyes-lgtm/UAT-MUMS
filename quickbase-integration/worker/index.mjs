/**
 * worker/index.mjs
 * Cloudflare Worker module example. Configure secrets in Wrangler or Cloudflare dashboard:
 * QUICKBASE_REALM, QUICKBASE_TOKEN, QUICKBASE_TABLE_ID
 */
export default {
  async fetch(request, env) {
    const REALM = env.QUICKBASE_REALM;
    const TOKEN = env.QUICKBASE_TOKEN;
    const TABLE_ID = env.QUICKBASE_TABLE_ID;

    if (!REALM || !TOKEN || !TABLE_ID) {
      return new Response(JSON.stringify({ ok: false, error: 'missing env' }), { status: 500, headers: { 'Content-Type': 'application/json' }});
    }

    const qbRes = await fetch('https://api.quickbase.com/v1/records/query', {
      method: 'POST',
      headers: {
        'QB-Realm-Hostname': REALM,
        'Authorization': `QB-USER-TOKEN ${TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from: TABLE_ID })
    });

    const data = await qbRes.json();
    return new Response(JSON.stringify({ ok: true, data }), { headers: { 'Content-Type': 'application/json' }});
  }
};
