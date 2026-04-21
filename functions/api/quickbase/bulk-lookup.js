export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // Support GET for single case (for detail view)
  if (request.method === 'GET') {
    const caseNum = (url.searchParams.get('case') || '').trim();
    if (!caseNum) return new Response('Missing case', { status: 400 });

    const cache = caches.default;
    const useFresh = url.searchParams.get('fresh') === '1';
    const cacheKey = new Request(`https://cache.qb/single/${encodeURIComponent(caseNum)}`);

    if (!useFresh) {
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
    }

    const qbRes = await fetch('https://api.quickbase.com/v1/records/query', {
      method: 'POST',
      headers: {
        'QB-Realm-Hostname': env.QB_REALM_HOSTNAME,
        'Authorization': `QB-USER-TOKEN ${env.QB_USER_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: env.QB_SERVICES_TABLE_ID,
        select: [3, 6, 7, 8, 13, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40],
        where: `{3.EX.'${caseNum.replace(/'/g, "''")}'}`,
        options: { top: 1 }
      })
    });

    const data = await qbRes.json();
    const response = new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300'
      }
    });

    if (!useFresh) {
      await cache.put(cacheKey, response.clone());
    }

    return response;
  }

  // POST - bulk
  if (request.method === 'POST') {
    const body = await request.json();
    const { cases = [], fieldIds = [3, 25, 13], checkOnly = false } = body;

    if (!Array.isArray(cases) || !cases.length) {
      return new Response(JSON.stringify({ ok: false, error: 'cases array required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const normalizedCases = [...new Set(cases.map((v) => String(v || '').trim()).filter(Boolean))];
    const normalizedFieldIds = [...new Set((Array.isArray(fieldIds) ? fieldIds : []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
    if (!normalizedFieldIds.length) normalizedFieldIds.push(3, 25, 13);

    const cache = caches.default;
    const sortedFields = [...normalizedFieldIds].sort((a, b) => a - b).join('-');
    const caseHash = btoa(normalizedCases.join('|')).slice(0, 16);
    const cacheKey = new Request(`https://cache.qb/bulk/${env.QB_SERVICES_TABLE_ID}/${sortedFields}/${caseHash}`);

    const cachedRes = await cache.match(cacheKey);
    if (cachedRes) {
      const cached = await cachedRes.json();
      if (Date.now() - (cached.cachedAt || 0) < 300000) {
        if (checkOnly) {
          return new Response(JSON.stringify({ ok: true, hash: cached.hash, fromCache: true }), {
            headers: { 'Content-Type': 'application/json', 'X-Cache': 'HIT' }
          });
        }
        return new Response(JSON.stringify({ ...cached, fromCache: true }), {
          headers: { 'Content-Type': 'application/json', 'X-Cache': 'HIT' }
        });
      }
    }

    const qbResponse = await fetch('https://api.quickbase.com/v1/records/query', {
      method: 'POST',
      headers: {
        'QB-Realm-Hostname': env.QB_REALM_HOSTNAME,
        'Authorization': `QB-USER-TOKEN ${env.QB_USER_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: env.QB_SERVICES_TABLE_ID,
        select: normalizedFieldIds,
        where: `{3.OAF.'${normalizedCases.map((c) => c.replace(/'/g, "''")).join("','")}'}`,
        options: { top: 1000 }
      })
    });

    const qbData = await qbResponse.json();
    const map = {};
    (qbData.data || []).forEach((rec) => {
      const cn = rec['3']?.value?.toString();
      if (!cn) return;
      map[cn] = {};
      normalizedFieldIds.forEach((fid) => {
        let v = rec[fid.toString()]?.value;
        if (v && typeof v === 'object') v = v.name || v.email || v.display || '';
        map[cn][fid] = v || '';
      });
    });

    const hash = btoa(JSON.stringify(map)).slice(0, 16);
    const result = { ok: true, count: normalizedCases.length, data: map, hash, cachedAt: Date.now() };
    await cache.put(cacheKey, new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300'
      }
    }));

    return new Response(JSON.stringify({ ...result, fromCache: false }), {
      headers: { 'Content-Type': 'application/json', 'X-Cache': 'MISS' }
    });
  }

  return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json' }
  });
}
