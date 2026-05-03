/**
 * @file services-dashboard.js
 * @description Services module: dashboard metrics aggregation and rendering
 * @module MUMS/Services
 * @version UAT
 */
/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

(function () {
  const rowsEl    = document.getElementById('svcStatRows');
  const colsEl    = document.getElementById('svcStatCols');
  const filledEl  = document.getElementById('svcStatFilled');
  const updatedEl = document.getElementById('svcStatUpdated');
  const activityEl = document.getElementById('svcActivityList');

  function fmt(ts) {
    if (!ts) return '—';
    try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
    catch { return '—'; }
  }

  window.servicesDashboard = {
    update(current) {
      if (!current) return;
      const cols = current.sheet.column_defs || [];
      const rows = current.rows || [];

      rowsEl.textContent  = rows.length;
      colsEl.textContent  = cols.length;

      const totalCells = rows.length * cols.length;
      const filled = rows.reduce((s, r) =>
        s + Object.values(r.data || {}).filter(v => v !== '' && v != null).length, 0);
      filledEl.textContent  = totalCells ? Math.round((filled / totalCells) * 100) + '%' : '0%';
      updatedEl.textContent = fmt(current.sheet.updated_at);

      activityEl.innerHTML = '';
      const recent = rows
        .filter(r => r.updated_at)
        .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
        .slice(0, 5);

      if (!recent.length) {
        activityEl.innerHTML = '<li class="muted">No activity yet.</li>';
      } else {
        recent.forEach(r => {
          const li = document.createElement('li');
          li.textContent = `Row ${r.row_index + 1} · ${fmt(r.updated_at)}`;
          activityEl.appendChild(li);
        });
      }
    },

    reset() {
      rowsEl.textContent    = '0';
      colsEl.textContent    = '0';
      filledEl.textContent  = '0%';
      updatedEl.textContent = '—';
      activityEl.innerHTML  = '<li class="muted">No activity yet.</li>';
    }
  };
})();
