/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Strictly protects Enterprise UI/UX, Realtime Sync Logic, Core State Management, and Database/API Adapters. Do NOT modify existing logic or layout in this file without explicitly asking MACE for clearance. If overlapping changes are required, STOP and provide a RISK IMPACT REPORT first. */
const { sendJson, requireAuthedUser, roleFlags, serviceSelect } = require('./_common');

const OWNER_COLUMNS = ['created_by', 'created_by_user_id', 'owner_id', 'user_id'];

function ownerIdFromDistribution(distribution) {
  const row = distribution && typeof distribution === 'object' ? distribution : {};
  for (const key of OWNER_COLUMNS) {
    const value = String(row[key] || '').trim();
    if (value) return value;
  }
  return '';
}

function sanitizeFileName(s) {
  return String(s || 'export')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'export';
}

function csvEscapeCell(v) {
  if (v == null) return '';
  const s = String(v);
  // Escape double-quotes and wrap if needed
  const needs = /[",\n\r\t]/.test(s);
  const t = s.replace(/"/g, '""');
  return needs ? `"${t}"` : t;
}

function normalizeStatus(raw){
  const s = String(raw || '').trim().toLowerCase();
  if(!s) return 'Pending';
  if(s === 'completed' || s === 'done') return 'Completed';
  if(s === 'ongoing' || s === 'in progress' || s === 'in_progress') return 'Ongoing';
  if(s === 'with problem' || s === 'with_problem' || s === 'problem') return 'With Problem';
  if(s === 'pending' || s === 'todo' || s === 'to do') return 'Pending';
  return raw;
}

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });

    const auth = await requireAuthedUser(req);
    if (!auth) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    const distributionId = String((req.query && req.query.distribution_id) || '').trim();
    if (!distributionId) return sendJson(res, 400, { ok: false, error: 'missing_distribution_id' });

    const format = String((req.query && req.query.format) || 'csv').trim().toLowerCase();
    const asExcel = format === 'xls' || format === 'xlsx' || format === 'excel';

    const d = await serviceSelect('task_distributions', `select=*&id=eq.${encodeURIComponent(distributionId)}&limit=1`);
    if (!d.ok) return sendJson(res, 500, { ok: false, error: 'distribution_fetch_failed', details: d.json || d.text });

    const distribution = Array.isArray(d.json) && d.json[0] ? d.json[0] : null;
    if (!distribution) return sendJson(res, 404, { ok: false, error: 'distribution_not_found' });

    const flags = roleFlags(auth.profile && auth.profile.role);
    const ownerId = ownerIdFromDistribution(distribution);
    const isOwner = ownerId && ownerId === String(auth.authed.id || '');
    if (!isOwner && !flags.isAdmin && !flags.isLead) return sendJson(res, 403, { ok: false, error: 'forbidden' });

    let out = await serviceSelect('task_items', `select=*&distribution_id=eq.${encodeURIComponent(distributionId)}&order=created_at.asc`);
    if (!out.ok) {
      const fallback = await serviceSelect('task_items', `select=*&task_distribution_id=eq.${encodeURIComponent(distributionId)}&order=created_at.asc`);
      out = fallback.ok ? fallback : out;
    }
    if (!out.ok) return sendJson(res, 500, { ok: false, error: 'items_fetch_failed', details: out.json || out.text });

    const rows = Array.isArray(out.json) ? out.json : [];

    const ids = [];
    rows.forEach((r) => {
      const a = String(r.assigned_to || '').trim();
      const t = String(r.transferred_from || '').trim();
      if (a) ids.push(a);
      if (t) ids.push(t);
    });
    if (ownerId) ids.push(ownerId);
    const uniq = Array.from(new Set(ids.filter(Boolean)));

    const profilesById = {};
    if (uniq.length) {
      const inList = uniq.join(',');
      const p = await serviceSelect('mums_profiles', `select=user_id,name,username&user_id=in.(${inList})`);
      if (p.ok && Array.isArray(p.json)) {
        p.json.forEach((pr) => {
          if (pr && pr.user_id) profilesById[String(pr.user_id)] = pr;
        });
      }
    }

    const distTitle = String(distribution.title || 'distribution');
    const fileBase = sanitizeFileName(`${distTitle}_${distributionId.slice(0, 8)}`);
    const fileName = `${fileBase}.${asExcel ? 'xls' : 'csv'}`;

    const headers = [
      'Distribution ID',
      'Distribution Title',
      'Task ID',
      'Case Number',
      'Site',
      'Task Description',
      'Reference URL',
      'Live Status',
      'Problem Notes',
      'Transferred From',
      'Current Owner',
      'Date Created',
      'Date Updated'
    ];

    const lines = [];
    lines.push(headers.map(csvEscapeCell).join(','));

    rows.forEach((r) => {
      const assignedTo = String(r.assigned_to || '').trim();
      const transferredFrom = String(r.transferred_from || '').trim();
      const ownerName = (profilesById[assignedTo] && (profilesById[assignedTo].name || profilesById[assignedTo].username)) || assignedTo;
      const fromName = transferredFrom ? ((profilesById[transferredFrom] && (profilesById[transferredFrom].name || profilesById[transferredFrom].username)) || transferredFrom) : '';

      const status = normalizeStatus(r.status);
      const problemNotes = status === 'With Problem' ? String(r.problem_notes || '') : String(r.problem_notes || '');

      const row = [
        distributionId,
        distTitle,
        String(r.id || ''),
        String(r.case_number || ''),
        String(r.site || ''),
        String(r.description || ''),
        String(r.reference_url || ''),
        status,
        problemNotes,
        fromName,
        ownerName,
        r.created_at || '',
        r.updated_at || ''
      ];

      lines.push(row.map(csvEscapeCell).join(','));
    });

    // Add UTF-8 BOM for Excel compatibility.
    const csv = '\ufeff' + lines.join('\r\n');

    res.statusCode = 200;
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', asExcel ? 'application/vnd.ms-excel; charset=utf-8' : 'text/csv; charset=utf-8');
    res.end(csv);
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: 'export_failed', message: String(err && err.message ? err.message : err) });
  }
};
