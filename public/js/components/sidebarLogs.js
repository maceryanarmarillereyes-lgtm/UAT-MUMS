/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Strictly protects Enterprise UI/UX, Realtime Sync Logic, Core State Management, and Database/API Adapters. Do NOT modify existing logic or layout in this file without explicitly asking MACE for clearance. If overlapping changes are required, STOP and provide a RISK IMPACT REPORT first. */
(function(){
  // Left sidebar Activity Logs widget
  // - Keeps content inside the overlay background
  // - Shows latest 6 logs based on role visibility
  window.Components = window.Components || {};

  function canSeeLog(me, entry){
    try{
      const Config = window.Config;
      if(!me || !entry || !Config) return false;
      const isSuper = me.role === Config.ROLES.SUPER_ADMIN;
      const isAdmin = isSuper || me.role === Config.ROLES.ADMIN;
      const isLead = me.role === Config.ROLES.TEAM_LEAD;
      if(isAdmin) return true;
      if(isLead){
        const showAll = localStorage.getItem('ums_logs_show_all') === '1';
        return showAll ? true : (entry.teamId === me.teamId);
      }
      return entry.teamId === me.teamId;
    }catch(e){
      return false;
    }
  }

  function fmtHHMM(ts){
    try{
      const UI = window.UI;
      if(UI && UI.manilaParts){
        const p = UI.manilaParts(new Date(ts));
        const hh = String(p.hh).padStart(2,'0');
        const mm = String(p.mm).padStart(2,'0');
        return `${hh}:${mm}`;
      }
    }catch(_){ }
    try{
      const d = new Date(ts);
      const hh = String(d.getHours()).padStart(2,'0');
      const mm = String(d.getMinutes()).padStart(2,'0');
      return `${hh}:${mm}`;
    }catch(e){
      return '--:--';
    }
  }

  const SidebarLogs = {
    _lastUser: null,

    render(user){
      try{
        this._lastUser = user || this._lastUser;
        const UI = window.UI;
        const Store = window.Store;
        if(!UI || !Store) return;

        const listEl = UI.el('#sideLogsList');
        const hintEl = UI.el('#sideLogsHint');
        const viewAllBtn = UI.el('#sideLogsViewAll');

        if(viewAllBtn) viewAllBtn.onclick = ()=>{ window.location.hash = '#logs'; };

        if(!listEl || !hintEl) return;

        const logs = Store.getLogs().filter(l=>canSeeLog(this._lastUser, l)).slice(0,6);
        hintEl.textContent = logs.length ? `Updated ${logs.length} item${logs.length>1?'s':''}` : 'No activity';

        if(!logs.length){
          listEl.innerHTML = '<div class="log-empty">No recent activity.</div>';
          return;
        }

        listEl.innerHTML = logs.map(e=>{
          const teamClass = `team-${e.teamId}`;
          return `<div class="logline ${teamClass}" title="${UI.esc(e.detail||'')}">
            <span class="t">${fmtHHMM(e.ts)}</span>
            <span class="tl-dot" aria-hidden="true"></span>
            <span class="m">${UI.esc(e.msg||e.action||'Activity updated')}</span>
          </div>`;
        }).join('');
      }catch(e){
        console.error('SidebarLogs.render error', e);
      }
    },

    refresh(){
      try{
        const u = this._lastUser || (window.Auth && Auth.getUser ? Auth.getUser() : null);
        if(u) this.render(u);
      }catch(e){
        console.error('SidebarLogs.refresh error', e);
      }
    }
  };

  window.Components.SidebarLogs = SidebarLogs;
})();
