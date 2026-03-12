/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Strictly protects Enterprise UI/UX, Realtime Sync Logic, Core State Management, and Database/API Adapters. Do NOT modify existing logic or layout in this file without explicitly asking Thunter BOY for clearance. If overlapping changes are required, STOP and provide a RISK IMPACT REPORT first. */
const { sendJson, requireAuthedUser, serviceSelect } = require('./_common');

const ASSIGNEE_COLUMNS = ['assigned_to', 'assignee_user_id', 'assigned_user_id'];
const ITEM_DISTRIBUTION_COLUMNS = ['distribution_id', 'task_distribution_id'];
const OWNER_COLUMNS = ['created_by', 'created_by_user_id', 'owner_id', 'user_id'];

function normStatus(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return 'Pending';
  const upper = raw.toUpperCase();
  if (upper === 'PENDING') return 'Pending';
  if (upper === 'IN_PROGRESS' || upper === 'ONGOING') return 'Ongoing';
  if (upper === 'DONE' || upper === 'COMPLETED') return 'Completed';
  if (upper === 'WITH_PROBLEM' || upper === 'WITH PROBLEM') return 'With Problem';
  return raw;
}

function itemDeadlineValue(item) {
  return item && (item.deadline || item.deadline_at || item.due_at || item.created_at || 0);
}

function ownerIdFromDistribution(distribution) {
  const row = distribution && typeof distribution === 'object' ? distribution : {};
  for (const key of OWNER_COLUMNS) {
    const value = String(row[key] || '').trim();
    if (value) return value;
  }
  return '';
}

async function selectAssignedItems(uid) {
  for (const key of ASSIGNEE_COLUMNS) {
    const out = await serviceSelect('task_items', `select=*&${encodeURIComponent(key)}=eq.${encodeURIComponent(uid)}&order=created_at.desc`);
    if (out.ok) return { out, assigneeColumn: key };
  }
  return { out: { ok: false, json: null, text: 'assignee_column_not_found' }, assigneeColumn: ASSIGNEE_COLUMNS[0] };
}

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });

    const auth = await requireAuthedUser(req);
    if (!auth) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    const uid = String(auth.authed.id || '');
    const assignedResult = await selectAssignedItems(uid);
    const out = assignedResult.out;
    if (!out.ok) return sendJson(res, 500, { ok: false, error: 'assigned_query_failed', details: out.json || out.text });

    const rows = Array.isArray(out.json) ? out.json : [];
    const distIds = Array.from(new Set(rows.map((r) => {
      for (const key of ITEM_DISTRIBUTION_COLUMNS) {
        const value = String(r[key] || '').trim();
        if (value) return value;
      }
      return '';
    }).filter(Boolean)));

    let distMap = {};
    if (distIds.length) {
      const list = distIds.map((id) => encodeURIComponent(id)).join(',');
      const d = await serviceSelect('task_distributions', `select=*&id=in.(${list})`);
      if (d.ok && Array.isArray(d.json)) {
        distMap = d.json.reduce((acc, cur) => {
          acc[String(cur.id)] = cur;
          return acc;
        }, {});
      }
    }

    const creatorIds = Array.from(new Set(Object.values(distMap).map((d) => ownerIdFromDistribution(d)).filter(Boolean)));
    let nameByUid = {};
    if (creatorIds.length) {
      const list = creatorIds.map((id) => encodeURIComponent(id)).join(',');
      const p = await serviceSelect('mums_profiles', `select=user_id,name,username&user_id=in.(${list})`);
      const prow = p.ok && Array.isArray(p.json) ? p.json : [];
      nameByUid = prow.reduce((acc, cur) => {
        acc[String(cur.user_id)] = String(cur.name || cur.username || cur.user_id || 'N/A');
        return acc;
      }, {});
    }

    const grouped = rows.reduce((acc, row) => {
      let distributionId = 'unassigned';
      for (const key of ITEM_DISTRIBUTION_COLUMNS) {
        const value = String(row[key] || '').trim();
        if (value) {
          distributionId = value;
          break;
        }
      }

      const dist = distMap[distributionId] || {};
      const creatorId = ownerIdFromDistribution(dist);
      const creatorName = nameByUid[creatorId] || creatorId || 'N/A';
      const status = normStatus(row.status);

      if (!acc[distributionId]) {
        acc[distributionId] = {
          distribution_id: distributionId,
          project_title: String(dist.title || 'Untitled Distribution'),
          assigner_name: creatorName,
          assigned_at: dist.created_at || row.created_at || null,
          pending_count: 0,
          total_count: 0,
          done_count: 0,
          items: []
        };
      }

      const item = Object.assign({}, row, {
        status,
        creator_name: creatorName,
        distribution_title: dist.title || ''
      });

      acc[distributionId].items.push(item);
      acc[distributionId].total_count += 1;
      if (status === 'Completed') acc[distributionId].done_count += 1;
      if (status !== 'Completed') acc[distributionId].pending_count += 1;
      return acc;
    }, {});

    const groups = Object.values(grouped)
      .map((group) => {
        group.items.sort((a, b) => {
          const aTime = new Date(itemDeadlineValue(a)).getTime();
          const bTime = new Date(itemDeadlineValue(b)).getTime();
          return aTime - bTime;
        });
        return group;
      })
      .sort((a, b) => {
        const aDate = new Date(a.assigned_at || (a.items[0] && a.items[0].created_at) || 0).getTime();
        const bDate = new Date(b.assigned_at || (b.items[0] && b.items[0].created_at) || 0).getTime();
        return bDate - aDate;
      });

    return sendJson(res, 200, { ok: true, groups });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: 'assigned_failed', message: String(err && err.message ? err.message : err) });
  }
};
