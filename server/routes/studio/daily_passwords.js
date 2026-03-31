/* @AI_CRITICAL_GUARD v3.0: Studio — daily_passwords route
   GET  /api/studio/daily_passwords  → returns today + yesterday password (Manila Time)
   POST /api/studio/daily_passwords  → upsert password for a date (any authed user)
   GET  /api/studio/daily_passwords?mode=month&year=YYYY&month=MM → full month data
*/
const { getUserFromJwt, serviceSelect, serviceUpsert } = require('../../lib/supabase');

function sendJson(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (req.body && typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch(_) { return {}; }
  }
  return new Promise((resolve) => {
    let data = '';
    req.on('data', c => { data += c; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch(_) { resolve({}); }
    });
  });
}

// Manila Time (UTC+8) date string "YYYY-MM-DD"
function getManilaDateStr(offsetDays = 0) {
  const now = new Date();
  // Manila = UTC+8
  const manila = new Date(now.getTime() + (8 * 60 * 60 * 1000) + (offsetDays * 86400000));
  return manila.toISOString().slice(0, 10);
}

// Format date string to "March 31, 2026"
function formatDateLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

// Get all days in a given month as date strings
function getDaysInMonth(year, month) {
  const days = [];
  const totalDays = new Date(year, month, 0).getDate(); // month here is 1-indexed, JS Date adjusts
  for (let d = 1; d <= totalDays; d++) {
    const mm = String(month).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    days.push(`${year}-${mm}-${dd}`);
  }
  return days;
}

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');

    // Auth check
    const authHeader = req.headers['authorization'] || req.headers['Authorization'] || '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!jwt) return sendJson(res, 401, { error: 'Unauthorized' });

    const user = await getUserFromJwt(jwt);
    if (!user || !user.id) return sendJson(res, 401, { error: 'Unauthorized' });

    // ── GET ──────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      // Parse query params safely from req.url (req.query.path is the route path in Vercel, not query params)
      let qp = {};
      try {
        const rawUrl = String(req.url || '');
        const qIdx = rawUrl.indexOf('?');
        if (qIdx !== -1) {
          const qs = rawUrl.slice(qIdx + 1);
          qs.split('&').forEach(pair => {
            const [k, v] = pair.split('=');
            if (k) qp[decodeURIComponent(k)] = v ? decodeURIComponent(v) : '';
          });
        }
      } catch(_) {}
      const mode = String(qp.mode || 'home');

      if (mode === 'month') {
        // Return full month data for the editor
        const manilaToday = getManilaDateStr(0);
        const [ty, tm] = manilaToday.split('-').map(Number);
        const year  = parseInt(qp.year  || ty, 10);
        const month = parseInt(qp.month || tm, 10);

        const days = getDaysInMonth(year, month);
        const startDate = days[0];
        const endDate   = days[days.length - 1];

        const out = await serviceSelect('daily_passwords',
          `select=date,password,updated_by,updated_at&date=gte.${startDate}&date=lte.${endDate}&order=date.asc`
        );

        const map = {};
        if (out.ok && Array.isArray(out.json)) {
          out.json.forEach(r => { map[r.date] = r; });
        }

        const rows = days.map(dateStr => ({
          date:        dateStr,
          label:       formatDateLabel(dateStr),
          password:    map[dateStr] ? map[dateStr].password : '',
          updated_by:  map[dateStr] ? map[dateStr].updated_by : null,
          updated_at:  map[dateStr] ? map[dateStr].updated_at : null,
          is_today:    dateStr === manilaToday,
          is_yesterday: dateStr === getManilaDateStr(-1),
        }));

        return sendJson(res, 200, { ok: true, rows, year, month });
      }

      // Default: home view — today + yesterday
      const today     = getManilaDateStr(0);
      const yesterday = getManilaDateStr(-1);

      const out = await serviceSelect('daily_passwords',
        `select=date,password&date=in.(${today},${yesterday})`
      );

      const map = {};
      if (out.ok && Array.isArray(out.json)) {
        out.json.forEach(r => { map[r.date] = r.password || ''; });
      }

      return sendJson(res, 200, {
        ok: true,
        today:     { date: today,     label: formatDateLabel(today),     password: map[today]     || '' },
        yesterday: { date: yesterday, label: formatDateLabel(yesterday), password: map[yesterday] || '' },
      });
    }

    // ── POST (upsert) ─────────────────────────────────────────────────
    if (req.method === 'POST') {
      const body = await readBody(req);
      const date     = String(body.date     || '').trim();
      const password = String(body.password || '').trim();

      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return sendJson(res, 400, { error: 'Invalid or missing date (YYYY-MM-DD required)' });
      }

      // Determine who's updating
      const updatedBy = user.email || user.id || 'Unknown';

      const upsertResult = await serviceUpsert('daily_passwords', [{
        date,
        password,
        updated_by: updatedBy,
        updated_at: new Date().toISOString(),
      }], 'date');

      if (!upsertResult.ok) {
        console.error('[daily_passwords] Upsert failed:', upsertResult.json || upsertResult.text);
        return sendJson(res, 500, { error: 'Failed to save password' });
      }

      return sendJson(res, 200, { ok: true, date, password });
    }

    return sendJson(res, 405, { error: 'Method not allowed' });

  } catch (err) {
    console.error('[daily_passwords] Error:', err);
    return sendJson(res, 500, { error: 'Internal server error' });
  }
};
