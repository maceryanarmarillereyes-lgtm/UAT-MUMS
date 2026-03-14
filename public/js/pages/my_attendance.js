/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Strictly protects Enterprise UI/UX, Realtime Sync Logic, Core State Management, and Database/API Adapters. Do NOT modify existing logic or layout in this file without explicitly asking MACE for clearance. If overlapping changes are required, STOP and provide a RISK IMPACT REPORT first. */
(function(){
  function page(root) {
    if (!root) return;
    const user = (window.Auth && Auth.getUser) ? Auth.getUser() : null;
    if (!user) return;

    const state = { filter: 'all' };

    function renderHeader() {
      return `
      <div class="dashx-head" style="margin-bottom: 24px;">
        <div>
          <h2 class="ux-h1" style="color: #EAF2FF; text-shadow: 0 0 15px rgba(74,163,255,0.3);">My Attendance & Work Logs</h2>
          <div class="small muted" style="color: #A8B6D6;">Secure audit trail for shift confirmations and overtime.</div>
        </div>
        <div class="dashx-actions" style="display:flex; gap:10px;">
          <button class="btn ${state.filter === 'all' ? 'primary' : 'ghost'}" data-filter="all" style="border-radius:8px;">All Logs</button>
          <button class="btn ${state.filter === 'att' ? 'primary' : 'ghost'}" data-filter="att" style="border-radius:8px;">Attendance</button>
          <button class="btn ${state.filter === 'ot' ? 'primary' : 'ghost'}" data-filter="ot" style="border-radius:8px;">Overtime</button>
        </div>
      </div>
    `;
    }

    function renderHistory() {
      const isAurora = document.body.dataset.theme === 'aurora_midnight';
      const allLogs = (window.Store && Store.getAttendance) ? Store.getAttendance().filter(a => a.userId === user.id) : [];

      const logs = allLogs.filter(l => {
        if (state.filter === 'att') return l.mode === 'OFFICE' || l.mode === 'WFH';
        if (state.filter === 'ot') return l.isOvertime || l.mode === 'OVERTIME';
        return true;
      }).sort((a, b) => (b.ts || 0) - (a.ts || 0));

      if (isAurora) {
        const tableHeader = `
        <thead>
          <tr style="background: rgba(255,255,255,0.03); height:52px;">
            <th style="padding:0 20px; text-align:left; color:#A8B6D6; font-weight:700; border-bottom: 1px solid rgba(255,255,255,0.1); width:220px;">TIMESTAMP</th>
            <th style="padding:0 16px; text-align:center; color:#A8B6D6; font-weight:700; border-bottom: 1px solid rgba(255,255,255,0.1); width:140px;">TYPE</th>
            <th style="padding:0 16px; text-align:center; color:#A8B6D6; font-weight:700; border-bottom: 1px solid rgba(255,255,255,0.1); width:140px;">MODE</th>
            <th style="padding:0 20px; text-align:left; color:#A8B6D6; font-weight:700; border-bottom: 1px solid rgba(255,255,255,0.1);">REMARKS</th>
          </tr>
        </thead>`;

        const tableRows = logs.map(l => {
          const isOT = l.isOvertime || l.mode === 'OVERTIME';
          const typeColor = isOT ? '#BB86FC' : '#03DAC6';
          const modeColor = l.mode === 'OFFICE' ? '#4CAF50' : (l.mode === 'WFH' ? '#FFB74D' : '#BB86FC');

          return `
          <tr style="height:56px; border-bottom: 1px solid rgba(255,255,255,0.05); background: rgba(18,28,47,0.4); transition: background 0.2s;">
            <td style="padding:0 20px; font-weight:700; color:#EAF2FF; font-family: monospace;">${new Date(l.ts).toLocaleString()}</td>
            <td style="padding:0 12px; text-align:center;">
              <span style="display:inline-block; padding:4px 10px; border-radius:6px; background:rgba(${isOT ? '187,134,252' : '3,218,198'}, 0.1); color:${typeColor}; font-size:11px; font-weight:900; border:1px solid ${typeColor}; box-shadow: 0 0 10px rgba(${isOT ? '187,134,252' : '3,218,198'}, 0.2);">
                ${isOT ? 'OVERTIME' : 'REGULAR'}
              </span>
            </td>
            <td style="padding:0 12px; text-align:center;">
              <div style="display:inline-flex; align-items:center; gap:8px; padding:4px 10px; border-radius:6px; color:${modeColor}; font-size:11px; font-weight:950;">
                <span style="width:8px; height:8px; border-radius:50%; background:${modeColor}; box-shadow: 0 0 8px ${modeColor};"></span>
                ${UI.esc(l.mode || 'N/A')}
              </div>
            </td>
            <td style="padding:0 20px; color:#CBD5E1; font-size:13px; opacity:0.9;">${UI.esc(l.reason || 'Standard Shift Entry')}</td>
          </tr>
        `;
        }).join('') || `<tr><td colspan="4" style="padding:14px 20px;color:#A8B6D6;">No logs found.</td></tr>`;

        return `
        <div class="ux-card" style="padding:0; overflow:hidden; border: 1px solid rgba(255,255,255,0.08); background: #121C2F; box-shadow: 0 10px 40px rgba(0,0,0,0.4);">
          <table class="table" style="width:100%; border-collapse:collapse; background: transparent;">${tableHeader}<tbody>${tableRows}</tbody></table>
        </div>
      `;
      }

      return `
      <div class="ux-card pad">
        <div class="dashx-title">Activity Logs</div>
        <table class="table">
          <tbody>
            ${logs.map(l => `<tr><td>${new Date(l.ts).toLocaleString()}</td><td>${UI.esc(l.mode || 'N/A')}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">No activity logs found.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
    }

    function render() {
      root.innerHTML = `
      <div class="mysx" style="padding: 10px;">
        ${renderHeader()}
        <div id="attHistoryContainer">${renderHistory()}</div>
      </div>
    `;

      root.querySelectorAll('[data-filter]').forEach(btn => {
        btn.onclick = () => {
          state.filter = btn.dataset.filter;
          render();
        };
      });
    }

    render();
  }

  window.Pages = window.Pages || {};
  window.Pages.my_attendance = page;
})();
