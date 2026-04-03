/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

const { sendJson, requireAuthedUser, serviceFetch, serviceSelect, serviceInsert, serviceUpsert } = require('./_common');

const OWNER_COLUMNS = ['created_by', 'created_by_user_id', 'owner_id', 'user_id'];
const ITEM_DISTRIBUTION_COLUMNS = ['distribution_id', 'task_distribution_id'];

function safeString(x, max = 240) {
  const s = x == null ? '' : String(x);
  return s.length > max ? s.slice(0, max) : s;
}

function normalizeDeadlineAt(value) {
  if (!value) return null;
  const t = Date.parse(String(value));
  return Number.isFinite(t) ? t : null;
}

async function getDocValue(key) {
  const q = `select=key,value&key=eq.${encodeURIComponent(key)}&limit=1`;
  const out = await serviceSelect('mums_documents', q);
  if (!out.ok) return { ok: false, error: 'select_failed', details: out.json || out.text };
  const row = Array.isArray(out.json) ? out.json[0] : null;
  return { ok: true, value: row ? row.value : null };
}

async function upsertDoc(key, value, actor, profile) {
  const row = {
    key,
    value,
    updated_at: new Date().toISOString(),
    updated_by_user_id: actor?.id || null,
    updated_by_name: profile?.name || null,
    updated_by_client_id: 'server:tasks'
  };
  const up = await serviceUpsert('mums_documents', [row], 'key');
  if (!up.ok) return { ok: false, error: 'upsert_failed', details: up.json || up.text };
  return { ok: true };
}

function ownerIdFromDistribution(distribution) {
  const row = distribution && typeof distribution === 'object' ? distribution : {};
  for (const key of OWNER_COLUMNS) {
    const value = String(row[key] || '').trim();
    if (value) return value;
  }
  return '';
}

function sanitizeCell(value, fallback = '') {
  const out = String(value == null ? '' : value).trim();
  return out || fallback;
}

function normalizeStatus(value) {
  const s = String(value || '').toUpperCase();
  if (s === 'COMPLETED') return 'COMPLETED';
  return 'ONGOING';
}

const TASK_ITEM_STATUS_MAP = {
  PENDING: 'Pending',
  'IN_PROGRESS': 'Ongoing',
  ONGOING: 'Ongoing',
  DONE: 'Completed',
  COMPLETED: 'Completed',
  WITH_PROBLEM: 'With Problem',
  'WITH PROBLEM': 'With Problem'
};

function normalizeTaskItemStatus(value, fallback = 'Pending') {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return fallback;
  const upper = raw.toUpperCase();
  return TASK_ITEM_STATUS_MAP[upper] || raw;
}


function normalizeReferenceUrl(value) {
  const url = sanitizeCell(value);
  return /^https?:\/\//i.test(url) ? url : '';
}

function normalizeDeadlineAt(value) {
  const raw = sanitizeCell(value);
  if (!raw) return null;

  const shortMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (shortMatch) {
    const mm = Number(shortMatch[1]);
    const dd = Number(shortMatch[2]);
    const yyyy = shortMatch[3].length === 2 ? 2000 + Number(shortMatch[3]) : Number(shortMatch[3]);
    const d = new Date(Date.UTC(yyyy, mm - 1, dd));
    const valid = d.getUTCFullYear() === yyyy && d.getUTCMonth() + 1 === mm && d.getUTCDate() === dd;
    if (valid) return d.toISOString();
    return null;
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();

  return null;
}

function normalizeDeadlineDate(value) {
  const iso = normalizeDeadlineAt(value);
  if (!iso) return null;
  return iso.slice(0, 10);
}

function dedupeRows(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const sig = [row.caseNumber, row.site, row.description, row.assignedTo, row.deadline, row.referenceUrl]
      .map((v) => String(v || '').toLowerCase())
      .join('||');
    if (!sig || seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });
}

function normalizeIncomingRows(items, globalDescription, globalReferenceUrl) {
  const normalized = [];
  const defaultDescription = sanitizeCell(globalDescription, 'N/A');
  const defaultReferenceUrl = normalizeReferenceUrl(globalReferenceUrl);

  (Array.isArray(items) ? items : []).forEach((item) => {
    const src = item && typeof item === 'object' ? item : {};
    const row = {
      caseNumber: sanitizeCell(src.case_number, 'N/A'),
      site: sanitizeCell(src.site, 'N/A'),
      description: sanitizeCell(src.description, defaultDescription),
      assignedTo: sanitizeCell(src.assigned_to, ''),
      deadline: sanitizeCell(src.deadline, ''),
      referenceUrl: normalizeReferenceUrl(src.reference_url) || defaultReferenceUrl
    };

    if (!row.description || !row.assignedTo) return;
    normalized.push(row);
  });

  return dedupeRows(normalized);
}

async function queryDistributionsByOwner(uid) {
  for (const key of OWNER_COLUMNS) {
    const out = await serviceSelect('task_distributions', `select=*&${encodeURIComponent(key)}=eq.${encodeURIComponent(uid)}&order=created_at.desc`);
    if (out.ok) return out;
  }
  return { ok: false, json: null, text: 'owner_column_not_found' };
}


async function enforceRetentionForOwner(uid) {
  try {
    const ownerId = String(uid || '').trim();
    if (!ownerId) return;

    // FIFO retention: keep only the newest 50 distributions per creator.
    for (const ownerKey of OWNER_COLUMNS) {
      const q = `select=id,created_at&${encodeURIComponent(ownerKey)}=eq.${encodeURIComponent(ownerId)}&order=created_at.asc&limit=50`;
      const out = await serviceSelect('task_distributions', q);
      if (!out.ok) {
        const errText = JSON.stringify(out.json || out.text || '');
        const err = errText.toLowerCase();
        // If this ownerKey doesn't exist, try the next.
        if (err.includes('does not exist') || err.includes('schema cache') || err.includes('could not find')) continue;
        // Unknown error: don't block creation.
        return;
      }

      const rows = Array.isArray(out.json) ? out.json : [];
      if (rows.length < 50) return;

      const oldest = rows[0] && rows[0].id ? String(rows[0].id) : '';
      if (!oldest) return;

      await serviceFetch(`/rest/v1/task_distributions?id=eq.${encodeURIComponent(oldest)}`, { method: 'DELETE' });
      return;
    }
  } catch (_) {
    // Non-fatal
  }
}

async function queryItemsForDistributionIds(ids) {
  if (!ids.length) return { items: [], distributionColumn: ITEM_DISTRIBUTION_COLUMNS[0] };

  const encodedIds = ids.map((id) => encodeURIComponent(id)).join(',');
  for (const key of ITEM_DISTRIBUTION_COLUMNS) {
    const out = await serviceSelect('task_items', `select=id,status,${key}&${encodeURIComponent(key)}=in.(${encodedIds})`);
    if (out.ok) return { items: Array.isArray(out.json) ? out.json : [], distributionColumn: key };
  }

  return { items: [], distributionColumn: ITEM_DISTRIBUTION_COLUMNS[0] };
}

async function insertDistributionRow(title, uid, metadata) {
  const base = {
    title,
    description: sanitizeCell(metadata && metadata.description, ''),
    reference_url: normalizeReferenceUrl(metadata && metadata.reference_url),
    enable_daily_alerts: metadata && metadata.enable_daily_alerts ? true : undefined,
    status: normalizeStatus(metadata && metadata.status)
  };

  const optionalColumns = ['title', 'description', 'reference_url', 'enable_daily_alerts', 'status'];

  const extractMissingColumn = (errorText) => {
    const match = errorText.match(/column\s+"?([a-zA-Z0-9_]+)"?\s+of\s+relation\s+"?task_distributions"?\s+does\s+not\s+exist/i);
    if (match) return String(match[1] || '').trim();

    // PostgREST schema cache format (e.g. PGRST204):
    // "Could not find the '<col>' column of 'task_distributions' in the schema cache"
    const cacheMatch = errorText.match(/Could\s+not\s+find\s+the\s+'([^']+)'\s+column\s+of\s+'task_distributions'\s+in\s+the\s+schema\s+cache/i);
    return cacheMatch ? String(cacheMatch[1] || '').trim() : '';
  };

  for (const ownerKey of OWNER_COLUMNS) {
    const dropColumns = new Set();

    while (true) {
      const row = { [ownerKey]: uid };

      optionalColumns.forEach((key) => {
        if (dropColumns.has(key)) return;
        const value = base[key];
        if (!value) return;
        row[key] = value;
      });

      const out = await serviceInsert('task_distributions', [row]);
      if (out.ok) return { row: out.json && out.json[0] ? out.json[0] : null, ownerKey };

      const errText = JSON.stringify(out.json || out.text || '');
      const err = errText.toLowerCase();
      const missingOwnerColumn = err.includes('column') && err.includes(ownerKey.toLowerCase());
      if (missingOwnerColumn) break;

      const missingColumn = extractMissingColumn(errText);
      if (missingColumn && !dropColumns.has(missingColumn)) {
        dropColumns.add(missingColumn);
        continue;
      }

      return { row: null, ownerKey, error: out.json || out.text || 'distribution_insert_failed' };
    }
  }

  return { row: null, ownerKey: OWNER_COLUMNS[0], error: 'distribution_owner_column_not_found' };
}

async function insertTaskItems(distributionId, rows, assignedBy) {
  const payloadBase = rows.map((row) => {
    const deadlineText = sanitizeCell(row.deadline);
    const deadlineAt = normalizeDeadlineAt(deadlineText);
    const deadlineDate = normalizeDeadlineDate(deadlineText);
    return {
      case_number: row.caseNumber,
      case_no: row.caseNumber,
      site: row.site,
      // Some deployments enforce NOT NULL on task_description.
      // Always provide BOTH task_description and description for schema compatibility.
      task_description: row.description,
      description: row.description,
      assigned_to: row.assignedTo,
      assignee_user_id: row.assignedTo,
      assigned_by: assignedBy,
      deadline: deadlineDate,
      due_at: deadlineAt,
      deadline_at: deadlineAt,
      reference_url: row.referenceUrl,
      status: 'Pending',
      remarks: ''
    };
  });

  // Keep task_description in the payload; older schemas can drop it, newer schemas require it.
  const optionalColumns = ['case_no', 'assignee_user_id', 'deadline', 'due_at', 'deadline_at', 'reference_url', 'remarks', 'assigned_by', 'task_description'];
  const requiredColumns = ['case_number', 'site', 'description', 'assigned_to', 'status'];
  const buildPayload = (distributionKey, dropColumns) => payloadBase.map((item) => {
    const next = {};
    [...requiredColumns, ...optionalColumns].forEach((column) => {
      if (dropColumns.has(column)) return;
      if (!Object.prototype.hasOwnProperty.call(item, column)) return;
      const value = item[column];
      if (value === '') return;
      next[column] = value;
    });
    next[distributionKey] = distributionId;
    return next;
  });

  const extractMissingColumn = (errorText) => {
    const match = errorText.match(/column\s+"?([a-zA-Z0-9_]+)"?\s+of\s+relation\s+"?task_items"?\s+does\s+not\s+exist/);
    if (match) return String(match[1] || '').trim();

    // PostgREST schema cache format (e.g. PGRST204):
    // "Could not find the '<col>' column of 'task_items' in the schema cache"
    const cacheMatch = errorText.match(/Could\s+not\s+find\s+the\s+'([^']+)'\s+column\s+of\s+'task_items'\s+in\s+the\s+schema\s+cache/i);
    return cacheMatch ? String(cacheMatch[1] || '').trim() : '';
  };

  for (const distributionKey of ITEM_DISTRIBUTION_COLUMNS) {
    const dropColumns = new Set();
    while (true) {
      const payload = buildPayload(distributionKey, dropColumns);
      const out = await serviceInsert('task_items', payload);
      if (out.ok) return { ok: true, out };

      const errText = JSON.stringify(out.json || out.text || '');
      const err = errText.toLowerCase();

      // Surface a clearer message for common constraint failures.
      if (err.includes('violates not-null constraint')) {
        return {
          ok: false,
          out: {
            ok: false,
            json: out.json,
            text: 'task_items_not_null_violation'
          }
        };
      }
      const missingDistributionKey = err.includes('column') && err.includes(distributionKey.toLowerCase());
      if (missingDistributionKey) break;

      const missingColumn = extractMissingColumn(errText);
      if (missingColumn && !dropColumns.has(missingColumn)) {
        dropColumns.add(missingColumn);
        continue;
      }

      if ((err.includes('invalid input syntax') || err.includes('date/time field value out of range')) && !dropColumns.has('deadline_at')) {
        dropColumns.add('deadline_at');
        dropColumns.add('due_at');
        continue;
      }

      return { ok: false, out };
    }
  }

  return { ok: false, out: { json: null, text: 'task_item_distribution_column_not_found' } };
}

async function rollbackDistribution(distributionId) {
  for (const key of ITEM_DISTRIBUTION_COLUMNS) {
    await serviceFetch(`/rest/v1/task_items?${encodeURIComponent(key)}=eq.${encodeURIComponent(distributionId)}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' }
    });
  }

  await serviceFetch(`/rest/v1/task_distributions?id=eq.${encodeURIComponent(distributionId)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' }
  });
}

async function deleteDistribution(distributionId) {
  for (const key of ITEM_DISTRIBUTION_COLUMNS) {
    const out = await serviceFetch(`/rest/v1/task_items?${encodeURIComponent(key)}=eq.${encodeURIComponent(distributionId)}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' }
    });
    if (out.ok) break;

    const err = JSON.stringify(out.json || out.text || '').toLowerCase();
    const missingColumn = err.includes('column') && err.includes(key.toLowerCase());
    if (!missingColumn) return out;
  }

  return serviceFetch(`/rest/v1/task_distributions?id=eq.${encodeURIComponent(distributionId)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' }
  });
}

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const auth = await requireAuthedUser(req);
    if (!auth) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
    const uid = String(auth.authed.id || '');

    if (req.method === 'GET') {
      const out = await queryDistributionsByOwner(uid);
      if (!out.ok) return sendJson(res, 500, { ok: false, error: 'distribution_query_failed', details: out.json || out.text });

      const rows = Array.isArray(out.json) ? out.json : [];
      const ids = rows.map((r) => String(r.id || '')).filter(Boolean);
      const itemData = await queryItemsForDistributionIds(ids);

      const groupedStats = itemData.items.reduce((acc, item) => {
        const distributionId = String(item[itemData.distributionColumn] || '');
        if (!distributionId) return acc;

        const canonical = normalizeTaskItemStatus(item.status, 'Pending');
        if (!acc[distributionId]) acc[distributionId] = { total_count: 0, pending_count: 0, done_count: 0 };
        acc[distributionId].total_count += 1;
        if (canonical === 'Completed') acc[distributionId].done_count += 1;
        else acc[distributionId].pending_count += 1;
        return acc;
      }, {});

      return sendJson(res, 200, {
        ok: true,
        rows: rows.map((row) => {
          const stats = groupedStats[String(row.id)] || { total_count: 0, pending_count: 0, done_count: 0 };
          const status = stats.pending_count === 0 ? 'COMPLETED' : 'ONGOING';
          return Object.assign({}, row, {
            distribution_id: String(row.id || ''),
            total_count: stats.total_count,
            pending_count: stats.pending_count,
            done_count: stats.done_count,
            total_items: stats.total_count,
            pending_items: stats.pending_count,
            done_items: stats.done_count,
            status
          });
        })
      });
    }

    if (req.method === 'POST') {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const title = sanitizeCell(body.title);
      const description = sanitizeCell(body.description, '');
      const referenceUrl = normalizeReferenceUrl(body.reference_url);
      const status = normalizeStatus(body.status);
      const enableDailyAlerts = (() => {
        const raw = body.enable_daily_alerts;
        if (typeof raw === 'boolean') return raw;
        const s = String(raw || '').trim().toLowerCase();
        return s === 'true' || s === '1' || s === 'yes' || s === 'on';
      })();
      const normalizedRows = normalizeIncomingRows(body.items, description, referenceUrl);

      if (!title) return sendJson(res, 400, { ok: false, error: 'missing_title' });
      if (!normalizedRows.length) return sendJson(res, 400, { ok: false, error: 'valid_items_required' });

      await enforceRetentionForOwner(uid);

      const created = await insertDistributionRow(title, uid, { description, reference_url: referenceUrl, status, enable_daily_alerts: enableDailyAlerts });
      if (!created.row) {
        return sendJson(res, 500, {
          ok: false,
          error: 'distribution_create_failed',
          details: created.error || 'distribution_insert_failed'
        });
      }

      const distributionId = String(created.row.id || '');
      if (!distributionId) {
        return sendJson(res, 500, {
          ok: false,
          error: 'distribution_id_missing'
        });
      }

      const insertedItems = await insertTaskItems(distributionId, normalizedRows, uid);
      if (!insertedItems.ok) {
        await rollbackDistribution(distributionId);
        return sendJson(res, 500, {
          ok: false,
          error: 'task_items_create_failed',
          details: insertedItems.out && (insertedItems.out.json || insertedItems.out.text)
        });
      }

      // Best-effort: create notifications for all assignees in this distribution.
      // Uses the existing mums_schedule_notifs document so it shows in the global notifications panel.
      try {
        const counts = {};
        let earliestDeadlineAt = null;

        normalizedRows.forEach((r) => {
          const assignee = String(r.assignedTo || '').trim();
          if (!assignee) return;
          counts[assignee] = (counts[assignee] || 0) + 1;
          const t = normalizeDeadlineAt(r.deadline);
          if (t && (!earliestDeadlineAt || t < earliestDeadlineAt)) earliestDeadlineAt = t;
        });

        const recipients = Object.keys(counts);
        if (recipients.length) {
          const deadlineStr = earliestDeadlineAt ? new Date(earliestDeadlineAt).toISOString().slice(0, 10) : 'Not set';
          const distTitle = safeString(title, 120);

          const userSummaries = {};
          const userMessages = {};
          recipients.forEach((rid) => {
            const x = counts[rid] || 0;
            const summary = `You have ${x} new tasks from ${distTitle}. Deadline: ${deadlineStr}.`;
            userSummaries[rid] = summary;
            userMessages[rid] = summary;
          });

          const notif = {
            id: `task_dist_${distributionId}_${Date.now()}`,
            type: 'TASK_DISTRIBUTION',
            ts: Date.now(),
            title: `New tasks from ${distTitle}`,
            distribution_id: distributionId,
            distribution_title: distTitle,
            deadline: deadlineStr,
            recipients,
            userSummaries,
            userMessages,
            // Store uses (teamId, weekStartISO, snapshotDigest) as the dedupe tuple. We map the distribution id here.
            teamId: 'TASK_DISTRIBUTION',
            weekStartISO: distributionId,
            snapshotDigest: `dist:${distributionId}:${recipients.join(',')}:${deadlineStr}`
          };

          const docKey = 'mums_schedule_notifs';
          const existing = await getDocValue(docKey);
          const docVal = (existing.ok && existing.value && typeof existing.value === 'object') ? existing.value : {};
          const prevNotifs = Array.isArray(docVal.notifs) ? docVal.notifs : [];
          const notifs = [notif].concat(prevNotifs).slice(0, 200);
          docVal.notifs = notifs;
          docVal.updatedAt = new Date().toISOString();
          await upsertDoc(docKey, docVal, auth.authed, auth.profile);
        }
      } catch (e) {
        // Ignore notification failures so distribution creation remains usable.
        // (Notifications are non-critical and can be regenerated or added later.)
      }

      return sendJson(res, 200, {
        ok: true,
        distribution: created.row,
        items: Array.isArray(insertedItems.out.json) ? insertedItems.out.json : []
      });
    }

    if (req.method === 'DELETE') {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const queryId = req.query && req.query.distribution_id;
      const distributionId = sanitizeCell(body.distribution_id || queryId);
      if (!distributionId) return sendJson(res, 400, { ok: false, error: 'missing_distribution_id' });

      const selected = await serviceSelect('task_distributions', `select=*&id=eq.${encodeURIComponent(distributionId)}&limit=1`);
      if (!selected.ok) return sendJson(res, 500, { ok: false, error: 'distribution_fetch_failed', details: selected.json || selected.text });

      const distribution = Array.isArray(selected.json) && selected.json[0] ? selected.json[0] : null;
      if (!distribution) return sendJson(res, 404, { ok: false, error: 'distribution_not_found' });

      const ownerId = ownerIdFromDistribution(distribution);
      if (ownerId && ownerId !== uid) return sendJson(res, 403, { ok: false, error: 'forbidden' });

      const deleted = await deleteDistribution(distributionId);
      if (!deleted.ok) return sendJson(res, 500, { ok: false, error: 'distribution_delete_failed', details: deleted.json || deleted.text });

      return sendJson(res, 200, { ok: true, deleted_distribution_id: distributionId });
    }

    return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: 'distributions_failed', message: String(err && err.message ? err.message : err) });
  }
};


