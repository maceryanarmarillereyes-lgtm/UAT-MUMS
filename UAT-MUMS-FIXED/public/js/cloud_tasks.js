/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */
const CloudTasks = (() => {
  const authHeader = () => {
    const jwt = window.CloudAuth && CloudAuth.accessToken ? CloudAuth.accessToken() : '';
    return jwt ? { Authorization: `Bearer ${jwt}` } : {};
  };

  const parse = async (res) => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, status: res.status, message: data.message || data.error || `Failed (${res.status})`, data };
    return { ok: true, data };
  };

  const assigned = async () => parse(await fetch('/api/tasks/assigned', { headers: { ...authHeader() } }));
  const distributions = async () => parse(await fetch('/api/tasks/distributions', { headers: { ...authHeader() } }));
  const members = async () => parse(await fetch('/api/tasks/members', { headers: { ...authHeader() } }));

  const distributionItems = async (distributionId) => parse(await fetch(`/api/tasks/distribution_items?distribution_id=${encodeURIComponent(String(distributionId || ''))}`, { headers: { ...authHeader() } }));

  const createDistribution = async (payload) => parse(await fetch('/api/tasks/distributions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(payload || {})
  }));

  const deleteDistribution = async (distributionId) => parse(await fetch(`/api/tasks/distributions?distribution_id=${encodeURIComponent(String(distributionId || ''))}`, {
    method: 'DELETE',
    headers: { ...authHeader() }
  }));

  const updateItemStatus = async (payload) => parse(await fetch('/api/tasks/item_status', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(payload || {})
  }));

  const workloadMatrix = async (distributionTitle) => {
    const q = distributionTitle ? `?distribution_title=${encodeURIComponent(distributionTitle)}` : '';
    return parse(await fetch(`/api/tasks/workload_matrix${q}`, { headers: { ...authHeader() } }));
  };

  
  // Phase 3: Command Center (Team Lead Monitoring)
  const monitoring = async (limit, offset) => {
    const l = Math.max(1, Math.min(20, Number(limit || 20)));
    const o = Math.max(0, Number(offset || 0));
    const u = window.Auth && window.Auth.getUser ? window.Auth.getUser() : {};
    const tid = u.teamId || '';
    return parse(await fetch(`/api/tasks/monitoring?limit=${encodeURIComponent(String(l))}&offset=${encodeURIComponent(String(o))}&team_id=${encodeURIComponent(tid)}`, { headers: { ...authHeader() } }));
  };

  const reassignPending = async (payload) => parse(await fetch('/api/tasks/reassign_pending', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(payload || {})
  }));

  const exportDistribution = async (distributionId, format) => {
    const id = String(distributionId || '').trim();
    const fmt = String(format || 'csv').trim().toLowerCase();
    const res = await fetch(`/api/tasks/distribution_export?distribution_id=${encodeURIComponent(id)}&format=${encodeURIComponent(fmt)}`, { headers: { ...authHeader() } });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let msg = `Failed (${res.status})`;
      try {
        const j = text ? JSON.parse(text) : null;
        msg = (j && (j.message || j.error)) ? (j.message || j.error) : msg;
      } catch (_) {
        if (text) msg = text.slice(0, 240);
      }
      return { ok: false, status: res.status, message: msg, data: text };
    }
    const blob = await res.blob();
    return {
      ok: true,
      blob,
      contentType: res.headers.get('content-type') || '',
      disposition: res.headers.get('content-disposition') || ''
    };
  };

  return { assigned, distributions, members, distributionItems, createDistribution, deleteDistribution, updateItemStatus, workloadMatrix, monitoring, reassignPending, exportDistribution };
})();

window.CloudTasks = CloudTasks;
