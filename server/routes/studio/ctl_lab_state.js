// server/routes/studio/ctl_lab_state.js
// GET  /api/studio/ctl_lab_state  — load shared booking + queue state
// POST /api/studio/ctl_lab_state  — patch booking/queue state for one controller
//
// BUG FIXES (2026-04-13):
//   BUG 1: Alarm never fired — client countdown reached 0 but booking stayed
//          in DB. Fix: server drops expired bookings on every read AND auto-
//          promotes the queue head into the booking slot.
//   BUG 2: Queue users couldn't use the controller — no auto-promotion logic.
//          Fix: _promoteQueue() moves queue head → booking when slot opens.
//   BUG 3: Stuck "Waiting" state — expired booking stayed in DB, queue never
//          advanced. Fix: normalizeBooking() returns null for expired sessions,
//          causing the slot to be vacant; _promoteQueue() fills it from queue.

const { getUserFromJwt, serviceSelect, serviceUpsert } = require('../../lib/supabase');

const DOC_KEY = 'ss_ctl_lab_state_v1';

function sendJson(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}
function safeStr(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 200); }
function safeNum(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

// ── NORMALIZE BOOKING ──────────────────────────────────────────────────────
// Returns null if booking is expired — this is the root fix for BUG 1 & 3.
function normalizeBooking(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const startMs = safeNum(raw.startMs);
  const endMs   = safeNum(raw.endMs);
  // BUG FIX: Drop expired bookings server-side (was only checked client-side before)
  if (!endMs || endMs <= Date.now()) return null;
  return {
    user:       safeStr(raw.user, 160) || 'Unknown',
    avatarUrl:  safeStr(raw.avatarUrl, 500),
    task:       safeStr(raw.task, 240),
    duration:   safeStr(raw.duration, 80),
    backupFile: safeStr(raw.backupFile, 600),
    startMs, endMs,
  };
}

// ── NORMALIZE QUEUE ENTRY ─────────────────────────────────────────────────
function normalizeQueueEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    user:            safeStr(raw.user, 160) || 'Unknown',
    avatarUrl:       safeStr(raw.avatarUrl, 500),
    task:            safeStr(raw.task, 240),
    duration:        safeStr(raw.duration, 80),
    urgent:          !!raw.urgent,
    wantsAlarm:      !!raw.wantsAlarm,
    joinedAt:        safeNum(raw.joinedAt) || Date.now(),
    notifiedAt:      safeNum(raw.notifiedAt) || 0,
    notifyExpiresAt: safeNum(raw.notifyExpiresAt) || 0,
  };
}

// ── AUTO-PROMOTE QUEUE → BOOKING ──────────────────────────────────────────
// BUG 2 + 3 FIX: When a booking slot is vacant, automatically move the first
// person in the queue into the booking position.
// The promoted user's duration is used to set the new endMs.
// This runs on EVERY read and write so the state is always consistent.
function _promoteQueue(bookings, queues) {
  const changed = [];

  Object.keys(queues).forEach((ctlId) => {
    const q = queues[ctlId];
    if (!Array.isArray(q) || q.length === 0) return;

    // Only promote if slot is vacant
    const existing = bookings[ctlId];
    if (existing) return; // Slot occupied, no promotion needed

    // Promote queue head
    const head = q[0];
    if (!head) return;

    const durMs = _parseDurMs(head.duration) || (30 * 60 * 1000); // fallback 30 min
    const now   = Date.now();
    const endMs = now + durMs;

    bookings[ctlId] = {
      user:       head.user,
      avatarUrl:  head.avatarUrl || '',
      task:       head.task,
      duration:   head.duration,
      backupFile: '',
      startMs:    now,
      endMs:      endMs,
    };

    // Remove head from queue
    queues[ctlId] = q.slice(1);
    if (queues[ctlId].length === 0) delete queues[ctlId];

    changed.push(ctlId);
  });

  return changed;
}

// Duration string → milliseconds
function _parseDurMs(str) {
  const s = String(str || '').toLowerCase();
  let ms = 0;
  const h = s.match(/(\d+\.?\d*)\s*h/);
  const m = s.match(/(\d+\.?\d*)\s*m/);
  if (h) ms += parseFloat(h[1]) * 3600000;
  if (m) ms += parseFloat(m[1]) * 60000;
  if (!ms) { const n = parseFloat(s); if (!isNaN(n) && n > 0) ms = n * 60000; }
  return ms;
}

// ── NORMALIZE FULL STATE ──────────────────────────────────────────────────
function normalizeState(value) {
  const src = value && typeof value === 'object' ? value : {};
  const inBookings   = src.bookings    && typeof src.bookings    === 'object' ? src.bookings    : {};
  const inQueues     = src.queues      && typeof src.queues      === 'object' ? src.queues      : {};
  const inParticipants = Array.isArray(src.participants) ? src.participants : [];

  const bookings = {};
  const queues   = {};
  const participants = [];

  // Process bookings — drops expired ones automatically
  Object.keys(inBookings).forEach((id) => {
    const key = safeStr(id, 80); if (!key) return;
    const booking = normalizeBooking(inBookings[id]);
    if (booking) bookings[key] = booking;
    // If booking dropped (expired) — queue head gets promoted below
  });

  // Process queues — deduplicate by user
  Object.keys(inQueues).forEach((id) => {
    const key = safeStr(id, 80); if (!key) return;
    const arr = Array.isArray(inQueues[id]) ? inQueues[id] : [];
    const normalized = arr.map(normalizeQueueEntry).filter(Boolean);
    const seen = new Map();
    for (let i = normalized.length - 1; i >= 0; i--) {
      const uk = String(normalized[i].user || '').trim().toLowerCase();
      if (!seen.has(uk)) seen.set(uk, normalized[i]);
    }
    const deduped = Array.from(seen.values()).reverse().slice(0, 30);
    if (deduped.length) queues[key] = deduped;
  });

  // BUG FIX: Auto-promote queue head when slot is vacant
  _promoteQueue(bookings, queues);

  inParticipants.forEach((name) => { const n = safeStr(name, 160); if (n) participants.push(n); });
  return { bookings, queues, participants };
}

function collectUsers(state) {
  const out = [];
  const bk = (state && state.bookings) || {};
  const q  = (state && state.queues)   || {};
  Object.values(bk).forEach((b) => { const n = safeStr(b && b.user, 160); if (n) out.push(n); });
  Object.values(q).forEach((arr) => { (Array.isArray(arr) ? arr : []).forEach((e) => { const n = safeStr(e && e.user, 160); if (n) out.push(n); }); });
  return out;
}

function mergeParticipants(existing, derived, actor) {
  const uniq = new Set();
  const add = (n) => { const s = safeStr(n, 160); if (s) uniq.add(s); };
  (Array.isArray(existing) ? existing : []).forEach(add);
  (Array.isArray(derived)  ? derived  : []).forEach(add);
  add(actor);
  return Array.from(uniq).slice(0, 500);
}

async function readStateDoc() {
  const out = await serviceSelect(
    'mums_documents',
    `select=value,updated_at&key=eq.${encodeURIComponent(DOC_KEY)}&limit=1`
  );
  if (!out.ok) return { ok: false, error: 'db_read_failed' };
  const row   = Array.isArray(out.json) && out.json[0] ? out.json[0] : null;
  const state = normalizeState(row && row.value);
  return { ok: true, state, updatedAt: row ? row.updated_at : null };
}

module.exports = async (req, res) => {
  try {
    const auth = String(req.headers.authorization || '');
    const jwt  = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
    const user = await getUserFromJwt(jwt);
    if (!user) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    // ── GET ──────────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const ifNoneMatch = req.headers['if-none-match'];

      const current = await readStateDoc();
      if (!current.ok) return sendJson(res, 500, { ok: false, error: current.error });

      const updatedAt = current.updatedAt;
      if (updatedAt && ifNoneMatch === `"${updatedAt}"`) {
        res.statusCode = 304;
        res.setHeader('Cache-Control', 'no-store');
        res.end();
        return;
      }

      res.setHeader('ETag', `"${updatedAt}"`);
      return sendJson(res, 200, {
        ok: true,
        bookings:     current.state.bookings,
        queues:       current.state.queues,
        participants: current.state.participants,
        updatedAt:    updatedAt,
      });
    }

    // ── POST ─────────────────────────────────────────────────────────────────
    if (req.method === 'POST') {
      const body = (req.body && typeof req.body === 'object')
        ? req.body
        : await new Promise((resolve) => {
            let d = '';
            req.on('data', (c) => { d += c; });
            req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (_) { resolve({}); } });
          });

      const current = await readStateDoc();
      if (!current.ok) return sendJson(res, 500, { ok: false, error: current.error });

      // ── Optimistic lock (conflict detection) ──────────────────────────────
      const lockedSince = body && body.lockedSince ? Number(body.lockedSince) : 0;
      if (lockedSince && body && body.booking && body.booking.data && body.booking.id) {
        const id          = safeStr(body.booking.id, 80);
        const serverBook  = current.state.bookings[id];
        const serverTs    = current.updatedAt ? Date.parse(current.updatedAt) : 0;
        if (serverBook && serverTs > lockedSince) {
          return sendJson(res, 409, { ok: false, error: 'booking_conflict', booking: serverBook, message: 'Booked by ' + serverBook.user });
        }
      }

      const next = {
        bookings: Object.assign({}, current.state.bookings),
        queues:   Object.assign({}, current.state.queues),
      };

      // Booking patch
      const bookingPatch = body && body.booking && typeof body.booking === 'object' ? body.booking : null;
      if (bookingPatch) {
        const id = safeStr(bookingPatch.id, 80);
        if (id) {
          const normalized = normalizeBooking(bookingPatch.data);
          if (normalized) next.bookings[id] = normalized;
          else delete next.bookings[id]; // explicit release
        }
      }

      // Queue patch
      const queuePatch = body && body.queue && typeof body.queue === 'object' ? body.queue : null;
      if (queuePatch) {
        const id = safeStr(queuePatch.id, 80);
        if (id) {
          const arr        = Array.isArray(queuePatch.items) ? queuePatch.items : [];
          const normalized = arr.map(normalizeQueueEntry).filter(Boolean).slice(0, 30);
          if (normalized.length) next.queues[id] = normalized;
          else delete next.queues[id];
        }
      }

      // Full state replacement
      if (body && body.state && typeof body.state === 'object') {
        const full = normalizeState(body.state);
        next.bookings = full.bookings;
        next.queues   = full.queues;
      }

      // BUG FIX: Always auto-promote after any write
      _promoteQueue(next.bookings, next.queues);

      const derived = collectUsers(next);
      next.participants = mergeParticipants(current.state.participants, derived, String(user.email || ''));

      const nowIso = new Date().toISOString();
      const doc = {
        key:                  DOC_KEY,
        value:                next,
        updated_at:           nowIso,
        updated_by_user_id:   String(user.id    || ''),
        updated_by_name:      String(user.email  || ''),
      };

      const out = await serviceUpsert('mums_documents', [doc], 'key');
      if (!out.ok) return sendJson(res, 500, { ok: false, error: 'db_write_failed', detail: out.text ? out.text.slice(0, 300) : 'DB error' });

      return sendJson(res, 200, {
        ok: true,
        bookings:     next.bookings,
        queues:       next.queues,
        participants: next.participants,
        updatedAt:    nowIso,
      });
    }

    return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
  } catch (err) {
    console.error('[studio/ctl_lab_state]', err);
    return sendJson(res, 500, { ok: false, error: 'internal_error', message: String(err && err.message ? err.message : err) });
  }
};
