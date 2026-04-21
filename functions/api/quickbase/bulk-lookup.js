export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    let { cases = [], fieldIds = [3, 25, 13] } = await request.json();

    if (!Array.isArray(cases) || cases.length === 0) {
      return new Response(JSON.stringify({ error: 'cases array required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const QB_REALM = env.QB_REALM_HOSTNAME;
    const QB_TOKEN = env.QB_USER_TOKEN;
    const QB_TABLE_ID = env.QB_SERVICES_TABLE_ID;

    if (!QB_REALM ||!QB_TOKEN ||!QB_TABLE_ID) {
      return new Response(JSON.stringify({ error: 'Missing Quickbase env vars' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const uniqueCases = [...new Set(cases.map(String).filter(Boolean))];
    fieldIds = [...new Set((Array.isArray(fieldIds) ? fieldIds : []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];

    if (!fieldIds.length) {
      return new Response(JSON.stringify({ error: 'fieldIds array required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const CHUNK_SIZE = 100;
    const chunks = [];
    for (let i = 0; i < uniqueCases.length; i += CHUNK_SIZE) {
      chunks.push(uniqueCases.slice(i, i + CHUNK_SIZE));
    }

    const start = Date.now();

    const results = await Promise.all(
      chunks.map(async (chunk) => {
        const where = chunk
         .map(c => `{3.EX.'${c.replace(/'/g, "''")}'}`)
         .join('OR');

        const body = {
          from: QB_TABLE_ID,
          select: fieldIds,
          where,
          options: { skip: 0, top: 100 }
        };

        const resp = await fetch('https://api.quickbase.com/v1/records/query', {
          method: 'POST',
          headers: {
            'QB-Realm-Hostname': QB_REALM,
            'Authorization': `QB-USER-TOKEN ${QB_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        });

        if (!resp.ok) {
          const err = await resp.text();
          throw new Error(`QB ${resp.status}: ${err}`);
        }

        const data = await resp.json();
        return data.data || [];
      })
    );

    const map = {};
    results.flat().forEach((rec) => {
      const caseVal = rec['3']?.value?.toString();
      if (!caseVal) return;

      map[caseVal] = {};
      fieldIds.forEach(fid => {
        const fieldData = rec[fid.toString()];
        let val = fieldData?.value;

        // FIX: Extract proper string from QB field types
        if (val && typeof val === 'object') {
          // User field: { email, name } or { id, name }
          val = val.name || val.email || val.display || JSON.stringify(val);
        }
        // Date field: keep ISO string
        // Text: direct

        map[caseVal][fid] = val || '';
      });
    });

    return new Response(JSON.stringify({
      ok: true,
      count: uniqueCases.length,
      duration_ms: Date.now() - start,
      data: map
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 's-maxage=30, stale-while-revalidate=60',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
