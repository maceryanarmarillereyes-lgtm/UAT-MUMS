/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */


const { sendJson, requireAuthedUser, serviceUpdate } = require('./_common');

function normalizeTaskItemStatus(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return 'Pending';
  const upper = raw.toUpperCase();
  if (upper === 'PENDING') return 'Pending';
  if (upper === 'IN_PROGRESS' || upper === 'ONGOING') return 'Ongoing';
  if (upper === 'DONE' || upper === 'COMPLETED') return 'Completed';
  if (upper === 'WITH_PROBLEM' || upper === 'WITH PROBLEM') return 'With Problem';
  // Allow already-canonical values
  if (raw === 'Pending' || raw === 'Ongoing' || raw === 'Completed' || raw === 'With Problem') return raw;
  return raw;
}

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'PATCH') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });

    const auth = await requireAuthedUser(req);
    if (!auth) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const id = String(body.task_item_id || '').trim();
    if (!id) return sendJson(res, 400, { ok: false, error: 'missing_task_item_id' });

    const status = normalizeTaskItemStatus(body.status);
    const allowed = ['Pending', 'Ongoing', 'Completed', 'With Problem'];
    if (!allowed.includes(status)) return sendJson(res, 400, { ok: false, error: 'invalid_status' });

    const remarks = String(body.remarks || '');
    const problemNotes = String(body.problem_notes == null ? '' : body.problem_notes).trim();

    if (status === 'With Problem' && !problemNotes) {
      return sendJson(res, 400, { ok: false, error: 'problem_notes_required' });
    }

    const updatedAt = new Date().toISOString();

    // Keep patches minimal to reduce failures when PostgREST schema cache is stale
    // or optional columns (like problem_notes) don't exist yet.
    const includeProblemNotes = (status === 'With Problem');
    const mkPatch = (statusValue) => {
      const p = { status: statusValue, updated_at: updatedAt };
      if (remarks) p.remarks = remarks;
      if (includeProblemNotes) p.problem_notes = problemNotes;
      return p;
    };

    const uid = encodeURIComponent(String(auth.authed.id || ''));
    const match = { id: `eq.${encodeURIComponent(id)}`, assigned_to: `eq.${uid}` };

    const errTextOf = (out) => {
      try { return JSON.stringify(out?.json ?? out?.text ?? ''); } catch (_) { return String(out?.text || ''); }
    };
    const isSchemaCacheMissingColumn = (errText, columnName) => {
      const t = String(errText || '');
      const tl = t.toLowerCase();
      return (t.includes('PGRST204') || tl.includes('schema cache') || tl.includes('does not exist')) && t.includes(columnName);
    };
    const isInvalidEnumValue = (errText) => {
      const tl = String(errText || '').toLowerCase();
      return tl.includes('invalid input value for enum') || tl.includes('22p02');
    };
    const toLegacyEnum = (canonical) => {
      const c = String(canonical || '');
      if (c === 'With Problem') return 'WITH_PROBLEM';
      return c.toUpperCase();
    };

    // Attempt 1: canonical values (Pending/Ongoing/Completed/With Problem)
    let out = await serviceUpdate('task_items', mkPatch(status), match);

    // Attempt 2: legacy enum variants (PENDING/ONGOING/COMPLETED/WITH_PROBLEM)
    if (!out.ok) {
      const et = errTextOf(out);
      if (isInvalidEnumValue(et)) {
        out = await serviceUpdate('task_items', mkPatch(toLegacyEnum(status)), match);
      }
    }

    // If we're trying to write problem_notes but PostgREST can't see the column,
    // return a clear remediation message.
    if (!out.ok && includeProblemNotes) {
      const et = errTextOf(out);
      if (isSchemaCacheMissingColumn(et, 'problem_notes')) {
        return sendJson(res, 409, {
          ok: false,
          error: 'task_item_update_failed',
          message:
            "Your database API schema cache is stale or the DB is missing the 'problem_notes' column. " +
            "Run the latest migrations, then refresh PostgREST schema cache by executing: NOTIFY pgrst, 'reload schema'; in Supabase SQL Editor.",
          details: out.json || out.text
        });
      }
    }

    if (!out.ok) {
      return sendJson(res, out.status || 500, {
        ok: false,
        error: 'task_item_update_failed',
        message: (out.json && (out.json.message || out.json.error)) ? (out.json.message || out.json.error) : 'Failed to update task status.',
        details: out.json || out.text
      });
    }

    // Best-effort cleanup: if the user is moving away from "With Problem",
    // clear problem_notes when the column exists (ignore failures on older DBs).
    if (!includeProblemNotes) {
      try {
        await serviceUpdate('task_items', { problem_notes: null }, match);
      } catch (_) {}
    }

    const row = Array.isArray(out.json) ? out.json[0] : null;
    return sendJson(res, 200, { ok: true, row });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: 'item_status_failed', message: String(err && err.message ? err.message : err) });
  }
};
