// server/routes/studio/ctl_lab_state.js
// GET  /api/studio/ctl_lab_state  — load shared booking + queue state
// POST /api/studio/ctl_lab_state  — patch booking/queue state for one controller

const { getUserFromJwt, serviceSelect, serviceUpsert } = require('../../lib/supabase');

const DOC_KEY = 'ss_ctl_lab_state_v1';

function sendJson(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function safeStr(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max || 200);
}

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeBooking(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const startMs = safeNum(raw.startMs);
  const endMs = safeNum(raw.endMs);
  if (!endMs || endMs <= Date.now()) return null;
  return {
    user: safeStr(raw.user, 160) || 'Unknown',
    avatarUrl: safeStr(raw.avatarUrl, 500),
    task: safeStr(raw.task, 240),
    duration: safeStr(raw.duration, 80),
    backupFile: safeStr(raw.backupFile, 600),
    startMs,
    endMs,
  };
}

function normalizeQueueEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const notifiedAt = safeNum(raw.notifiedAt);
  const notifyExpiresAt = safeNum(raw.notifyExpiresAt);
  const now = Date.now();
  if (notifyExpiresAt && notifyExpiresAt <= now) return null;
  return {
    user: safeStr(raw.user, 160) || 'Unknown',
    avatarUrl: safeStr(raw.avatarUrl, 500),
    task: safeStr(raw.task, 240),
    duration: safeStr(raw.duration, 80),
    urgent: !!raw.urgent,
    wantsAlarm: !!raw.wantsAlarm,
    joinedAt: safeNum(raw.joinedAt) || Date.now(),
    notifiedAt: notifiedAt || 0,
    notifyExpiresAt: notifyExpiresAt || 0,
  };
}

function normalizeState(value) {
  const src = value && typeof value === 'object' ? value : {};
  const inBookings = src.bookings && typeof src.bookings === 'object' ? src.bookings : {};
  const inQueues = src.queues && typeof src.queues === 'object' ? src.queues : {};
  const inParticipants = Array.isArray(src.participants) ? src.participants : [];
  const bookings = {};
  const queues = {};
  const participants = [];

  Object.keys(inBookings).forEach((id) => {
    const key = safeStr(id, 80);
    if (!key) return;
    const booking = normalizeBooking(inBookings[id]);
    if (booking) bookings[key] = booking;
  });

  Object.keys(inQueues).forEach((id) => {
    const key = safeStr(id, 80);
    if (!key) return;
    const arr = Array.isArray(inQueues[id]) ? inQueues[id] : [];
    const normalized = arr.map(normalizeQueueEntry).filter(Boolean);
    // BUG 4 FIX: Server-side deduplication — keep last entry per user (case-insensitive)
    const seen = new Map();
    for (let i = normalized.length - 1; i >= 0; i--) {
      const userKey = String(normalized[i].user || '').trim().toLowerCase();
      if (!seen.has(userKey)) seen.set(userKey, normalized[i]);
    }
    const deduped = Array.from(seen.values()).reverse().slice(0, 30);
    if (deduped.length) queues[key] = deduped;
  });

  inParticipants.forEach((name) => {
    const n = safeStr(name, 160);
    if (n) participants.push(n);
  });

  return { bookings, queues, participants };
}

function collectUsersFromState(state) {
  const out = [];
  const s = state && typeof state === 'object' ? state : {};
  const bookings = s.bookings && typeof s.bookings === 'object' ? s.bookings : {};
  const queues = s.queues && typeof s.queues === 'object' ? s.queues : {};
  Object.keys(bookings).forEach((id) => {
    const b = bookings[id];
    const n = safeStr(b && b.user, 160);
    if (n) out.push(n);
  });
  Object.keys(queues).forEach((id) => {
    const arr = Array.isArray(queues[id]) ? queues[id] : [];
    arr.forEach((q) => {
      const n = safeStr(q && q.user, 160);
      if (n) out.push(n);
    });
  });
  return out;
}

function mergeParticipants(existing, derived, actor) {
  const uniq = new Set();
  const add = (name) => {
    const n = safeStr(name, 160);
    if (n) uniq.add(n);
  };
  (Array.isArray(existing) ? existing : []).forEach(add);
  (Array.isArray(derived) ? derived : []).forEach(add);
  add(actor);
  return Array.from(uniq).slice(0, 500);
}

async function readStateDoc() {
  const out = await serviceSelect(
    'mums_documents',
    `select=value,updated_at&key=eq.${encodeURIComponent(DOC_KEY)}&limit=1`
  );
  if (!out.ok) return { ok: false, error: 'db_read_failed' };

  const row = Array.isArray(out.json) && out.json[0] ? out.json[0] : null;
  const state = normalizeState(row && row.value);
  return { ok: true, state, updatedAt: row ? row.updated_at : null };
}

module.exports = async (req, res) => {
  try {
    const auth = String(req.headers.authorization || '');
    const jwt = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const user = await getUserFromJwt(jwt);
    if (!user) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    if (req.method === 'GET') {
      const current = await readStateDoc();
      if (!current.ok) return sendJson(res, 500, { ok: false, error: current.error });
      return sendJson(res, 200, {
        ok: true,
        bookings: current.state.bookings,
        queues: current.state.queues,
        participants: current.state.participants,
        updatedAt: current.updatedAt,
      });
    }

    if (req.method === 'POST') {
      const body = (req.body && typeof req.body === 'object')
        ? req.body
        : await new Promise((resolve) => {
            let d = '';
            req.on('data', (c) => { d += c; });
            req.on('end', () => {
              try { resolve(d ? JSON.parse(d) : {}); } catch (_) { resolve({}); }
            });
          });

      const current = await readStateDoc();
      if (!current.ok) return sendJson(res, 500, { ok: false, error: current.error });

      // BUG 1 FIX: Optimistic lock check.
      // If the client sent lockedSince and the server doc was written after that
      // timestamp AND the conflicting controller is being booked, reject with 409.
      const lockedSince = body && body.lockedSince ? Number(body.lockedSince) : 0;
      if (lockedSince && body && body.booking && body.booking.data && body.booking.id) {
        const serverId  = safeStr(body.booking.id, 80);
        const serverBook = current.state.bookings[serverId];
        const serverUpdatedAt = current.updatedAt ? Date.parse(current.updatedAt) : 0;
        // If server has a booking that was written AFTER our last read, reject
        if (serverBook && serverUpdatedAt > lockedSince) {
          return sendJson(res, 409, {
            ok: false,
            error: 'booking_conflict',
            booking: serverBook,
            message: 'Controller was just booked by ' + serverBook.user,
          });
        }
      }

      const next = {
        bookings: Object.assign({}, current.state.bookings),
        queues: Object.assign({}, current.state.queues),
      };

      const bookingPatch = body && body.booking && typeof body.booking === 'object' ? body.booking : null;
      if (bookingPatch) {
        const id = safeStr(bookingPatch.id, 80);
        if (id) {
          const normalized = normalizeBooking(bookingPatch.data);
          if (normalized) next.bookings[id] = normalized;
          else delete next.bookings[id];
        }
      }

      const queuePatch = body && body.queue && typeof body.queue === 'object' ? body.queue : null;
      if (queuePatch) {
        const id = safeStr(queuePatch.id, 80);
        if (id) {
          const arr = Array.isArray(queuePatch.items) ? queuePatch.items : [];
          const normalized = arr.map(normalizeQueueEntry).filter(Boolean).slice(0, 30);
          if (normalized.length) next.queues[id] = normalized;
          else delete next.queues[id];
        }
      }

      if (body && body.state && typeof body.state === 'object') {
        const full = normalizeState(body.state);
        next.bookings = full.bookings;
        next.queues = full.queues;
      }
      const derivedUsers = collectUsersFromState(next);
      next.participants = mergeParticipants(current.state.participants, derivedUsers, String(user.email || ''));

      const nowIso = new Date().toISOString();
      const doc = {
        key: DOC_KEY,
        value: next,
        updated_at: nowIso,
        updated_by_user_id: String(user.id || ''),
        updated_by_name: String(user.email || ''),
      };

      const out = await serviceUpsert('mums_documents', [doc], 'key');
      if (!out.ok) {
        return sendJson(res, 500, {
          ok: false,
          error: 'db_write_failed',
          detail: out.text ? out.text.slice(0, 300) : 'Unknown DB error',
        });
      }

      return sendJson(res, 200, {
        ok: true,
        bookings: next.bookings,
        queues: next.queues,
        participants: next.participants,
        updatedAt: nowIso,
      });
    }

    return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
  } catch (err) {
    console.error('[studio/ctl_lab_state]', err);
    return sendJson(res, 500, {
      ok: false,
      error: 'internal_error',
      message: String(err && err.message ? err.message : err),
    });
  }
};
