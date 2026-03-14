/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Strictly protects Enterprise UI/UX, Realtime Sync Logic, Core State Management, and Database/API Adapters. Do NOT modify existing logic or layout in this file without explicitly asking MACE for clearance. If overlapping changes are required, STOP and provide a RISK IMPACT REPORT first. */
(function(){
  const Config = {
    // Single source of truth for build label used by login + app.
    BUILD: (typeof window!=='undefined' && window.MUMS_VERSION && window.MUMS_VERSION.buildLabel) ? window.MUMS_VERSION.buildLabel : 'MUMS Phase 1',
    APP: {
      shortName: 'MUMS',
      fullName: 'MUMS User Management System'
    },
    TZ: 'Asia/Manila',
    USERNAME_EMAIL_DOMAIN: 'mums.local',
    ROLES: {
      SUPER_ADMIN: 'SUPER_ADMIN',
      SUPER_USER: 'SUPER_USER',
      ADMIN: 'ADMIN',
      TEAM_LEAD: 'TEAM_LEAD',
      MEMBER: 'MEMBER',
    },

    // Team schedule times + Mailbox duty times (24h HH:MM)
    TEAMS: [
      { id: 'morning', label: 'Morning Shift', teamStart: '06:00', teamEnd: '15:00', dutyStart: '06:00', dutyEnd: '15:00' },
      { id: 'mid', label: 'Mid Shift', teamStart: '13:00', teamEnd: '22:00', dutyStart: '15:00', dutyEnd: '22:00' },
      { id: 'night', label: 'Night Shift', teamStart: '22:00', teamEnd: '06:00', dutyStart: '22:00', dutyEnd: '06:00' },
    ],

    // Developer Access (unassigned shift). Stored as NULL in DB; represented as empty string in client.
    DEV_TEAM: { id:'', label:'Developer Access', teamStart:'00:00', teamEnd:'23:59', dutyStart:'00:00', dutyEnd:'23:59' },

    SCHEDULES: {
      mailbox_manager: { id: 'mailbox_manager', label: 'Mailbox Manager', icon: '📥' },
      back_office: { id: 'back_office', label: 'Back Office', icon: '🗄️' },
      call_available: { id: 'call_available', label: 'Call Available', icon: '📞' },
      // Renamed per ops terminology: "Call Available" (keep same id/icon for compatibility)
      call_onqueue: { id: 'call_onqueue', label: 'Call Available', icon: '📞' },
      mailbox_call: { id: 'mailbox_call', label: 'Mailbox Manager + Call', icon: '📥📞' },
      block: { id: 'block', label: 'Block', icon: '⛔' },
      lunch: { id: 'lunch', label: 'Lunch', icon: '🍽️' },
    },

    // Theme presets — Enterprise Collection
THEMES: [
  {
    id:'obsidian_edge',
    name:'Obsidian Edge',
    mode:'dark',
    bg:'#080a0d',
    panel:'#0d1117',
    panel2:'#111620',
    text:'#e6ecf8',
    muted:'#6a7a94',
    border:'rgba(255,255,255,.07)',
    accent:'#0ea5e9',
    accentRgb:'14,165,233',
    bgRad1:'#0d1117',
    bgRad3:'#05070a',
    font:"'DM Sans', ui-sans-serif, system-ui, -apple-system, Segoe UI, Arial, sans-serif",
    radius:'10px',
    shadow:'0 12px 36px rgba(0,0,0,.6)',
    description:'Pitch black + electric sky blue. Razor-clean, zero-clutter, Linear-inspired enterprise.'
  },
  {
    id:'slate_ultra',
    name:'Slate Ultra',
    mode:'dark',
    bg:'#0f1117',
    panel:'#161b27',
    panel2:'#1c2235',
    text:'#dde3f0',
    muted:'#6877a0',
    border:'rgba(104,119,160,.14)',
    accent:'#818cf8',
    accentRgb:'129,140,248',
    bgRad1:'#1c2235',
    bgRad3:'#0a0d14',
    font:"'Outfit', 'DM Sans', ui-sans-serif, system-ui, -apple-system, Segoe UI, Arial, sans-serif",
    radius:'12px',
    shadow:'0 14px 40px rgba(0,0,0,.5)',
    description:'Cool blue-slate + vivid indigo. Dense, professional, Notion-inspired command center.'
  },
  {
    id:'carbon_forge',
    name:'Carbon Forge',
    mode:'dark',
    bg:'#111211',
    panel:'#191b18',
    panel2:'#1f2120',
    text:'#e8f0e8',
    muted:'#6a7a68',
    border:'rgba(255,255,255,.07)',
    accent:'#22c55e',
    accentRgb:'34,197,94',
    bgRad1:'#1f2120',
    bgRad3:'#0a0b0a',
    font:"'IBM Plex Mono', 'Fira Code', monospace",
    radius:'6px',
    shadow:'0 10px 28px rgba(0,0,0,.6)',
    description:'Anthracite charcoal + vivid emerald. Data-forward, Bloomberg terminal meets modern Arc.'
  },
  {
    id:'ivory_executive',
    name:'Ivory Executive',
    mode:'light',
    bg:'#f5f5f2',
    panel:'#ffffff',
    panel2:'#f0efe9',
    text:'#1a1a2e',
    muted:'#8a8a9a',
    border:'#e4e4e0',
    accent:'#1e40af',
    accentRgb:'30,64,175',
    bgRad1:'#f0efe9',
    bgRad3:'#eaeae6',
    font:"'Manrope', 'DM Sans', ui-sans-serif, system-ui, -apple-system, Segoe UI, Arial, sans-serif",
    radius:'10px',
    shadow:'0 2px 12px rgba(26,26,46,.08), 0 1px 3px rgba(26,26,46,.05)',
    description:'Warm off-white + deep cobalt navy. Light mode. Premium executive clarity.'
  },
  {
    id:'deep_ocean',
    name:'Deep Ocean',
    mode:'dark',
    bg:'#060e18',
    panel:'#0b1825',
    panel2:'#102030',
    text:'#d8eaf8',
    muted:'#5a7a9a',
    border:'rgba(90,122,154,.18)',
    accent:'#f59e0b',
    accentRgb:'245,158,11',
    bgRad1:'#102030',
    bgRad3:'#030910',
    font:"'Syne', 'DM Sans', ui-sans-serif, system-ui, -apple-system, Segoe UI, Arial, sans-serif",
    radius:'12px',
    shadow:'0 14px 40px rgba(0,0,0,.6)',
    description:'Midnight teal navy + molten amber gold. Rich depth. Premium fintech energy.'
  },
  {
    id:'aurora_midnight',
    name:'Aurora Midnight',
    mode:'dark',
    bg:'#07091a',
    panel:'#0d1228',
    panel2:'#111730',
    text:'#e8eeff',
    muted:'#7282aa',
    border:'rgba(130,148,255,.14)',
    accent:'#7c6ff7',
    accentRgb:'124,111,247',
    bgRad1:'#161d3a',
    bgRad3:'#070a1e',
    font:"'Plus Jakarta Sans', ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
    radius:'14px',
    shadow:'0 18px 48px rgba(0,0,0,.55)',
    description:'Aurora Midnight — deep navy with purple/teal aurora accents.'
  },
  {
    id:'mono',
    name:'Monochrome',
    mode:'dark',
    bg:'#0b0c10',
    panel:'#13151b',
    panel2:'#0f1116',
    text:'#f3f4f6',
    muted:'#b7bcc6',
    border:'rgba(255,255,255,.10)',
    accent:'#a3a3a3',
    accentRgb:'163,163,163',
    bgRad1:'#1a1d26',
    bgRad3:'#050608',
    font:"'Inter', system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
    radius:'12px',
    shadow:'0 10px 24px rgba(0,0,0,.40)',
    description:'Minimalist grayscale palette for distraction-free focus.'
  },
  {
    id:'mums_light',
    name:'Mums – Light',
    mode:'light',
    bg:'#f6f7fb',
    panel:'#ffffff',
    panel2:'#f0f2f8',
    text:'#1f2633',
    muted:'#676879',
    border:'#e6e9ef',
    accent:'#0073ea',
    accentRgb:'0,115,234',
    bgRad1:'#f0f2f8',
    bgRad3:'#ecedf2',
    font:"'Figtree', 'DM Sans', ui-sans-serif, system-ui, -apple-system, Segoe UI, Arial, sans-serif",
    radius:'8px',
    shadow:'0 4px 16px rgba(31,38,51,.08), 0 1px 4px rgba(31,38,51,.04)',
    description:'Mums – Light — Clean white surfaces, vibrant status colors, bold typography.'
  },
  {
    id:'apex',
    name:'APEX',
    mode:'dark',
    bg:'#060d1e',
    panel:'#0a1628',
    panel2:'#0e1f3a',
    text:'#F0F4FF',
    muted:'#8AAAC8',
    border:'rgba(201,168,76,.16)',
    accent:'#C9A84C',
    accentRgb:'201,168,76',
    bgRad1:'#0d1e3d',
    bgRad3:'#040a15',
    font:"'DM Sans', ui-sans-serif, system-ui, -apple-system, Segoe UI, Arial, sans-serif",
    radius:'10px',
    shadow:'0 12px 36px rgba(0,0,0,.55), 0 4px 12px rgba(201,168,76,.06)',
    description:'APEX — Bloomberg Terminal / Ultra-Premium. Deep navy + gold. Elite investment banking tier.'
  },
  {
    id:'nexus',
    name:'NEXUS',
    mode:'dark',
    bg:'#0b1220',
    panel:'#101a2c',
    panel2:'#152338',
    text:'#E2EAF8',
    muted:'#6B8EAE',
    border:'rgba(0,212,255,.12)',
    accent:'#00D4FF',
    accentRgb:'0,212,255',
    bgRad1:'#162540',
    bgRad3:'#070d18',
    font:"'Syne', 'Outfit', ui-sans-serif, system-ui, -apple-system, Segoe UI, Arial, sans-serif",
    radius:'8px',
    shadow:'0 10px 32px rgba(0,0,0,.52), 0 4px 12px rgba(0,212,255,.06)',
    description:'NEXUS — Tactical Dark Glass. Slate-glass with electric cyan. High-contrast command platform.'
  }
],


    // Navigation is intentionally user-facing only.
    // Note: GMT Overview remains available via Settings → World Clocks, but is not shown in the main menu.
    NAV: [
      { id: 'dashboard', label: 'Dashboard', icon: '🏠', perm: 'view_dashboard' },
      { id: 'mailbox', label: 'Mailbox', icon: '📨', perm: 'view_mailbox' },
      { id: 'overall_stats', label: 'OVER ALL STATS', icon: '📊', perm: 'view_members' },

      {
        id: 'team',
        label: 'Team',
        icon: '👥',
        perm: 'view_members',
        children: [
          { id: 'members', label: 'Members', icon: '👥', perm: 'view_members' },
          { id: 'master_schedule', label: 'Master Schedule', icon: '📅', perm: 'view_master_schedule' },
          { id: 'team_config', label: 'Team Task Settings', icon: '🛠️', perm: 'manage_team_config' },
          { id: 'distribution_monitoring', label: 'Command Center', icon: '🛰️', perm: 'view_distribution_monitoring', route: '/distribution/monitoring' },
        ]
      },

      {
        id: 'admin',
        label: 'Administration',
        icon: '🧾',
        perm: 'create_users',
        children: [
          { id: 'users', label: 'User Management', icon: '👤', perm: 'create_users' },
          { id: 'announcements', label: 'Announcements', icon: '📣', perm: 'manage_announcements' },
          { id: 'logs', label: 'Activity Logs', icon: '🧾', perm: 'view_logs' },
          { id: 'privileges', label: 'Privileges', icon: '🔐', perm: 'manage_privileges' },
        ]
      },


      {
        id: 'my_record',
        label: 'My Records',
        icon: '🗂️',
        perm: 'view_my_record',
        children: [
          { id: 'my_attendance', label: 'My Attendance', icon: '📝', perm: 'view_my_record' },
          { id: 'my_schedule', label: 'My Schedule', icon: '📅', perm: 'view_my_record' },
          { id: 'my_case', label: 'My Case', icon: '📨', perm: 'view_my_record' },
          { id: 'my_task', label: 'My Task', icon: '✅', perm: 'view_my_record' },
          { id: 'my_quickbase', label: 'My Quickbase', icon: 'database' },
        ]
      },

      { id: 'my_reminders', label: 'My Reminders', icon: '⏰', perm: 'view_my_reminders' },
      { id: 'team_reminders', label: 'Team Reminders', icon: '🚨', perm: 'view_team_reminders' },
    ],

    // Permissions are intentionally flat strings to keep the app usable without a backend.
    // New: manage_release_notes (grants Add/Import/Export/Delete release notes).
	    PERMS: {
	      SUPER_ADMIN: ['*','create_users','view_logs','view_my_record','view_gmt_overview','view_distribution_monitoring'],
	      SUPER_USER: ['view_dashboard','view_mailbox','view_members','manage_release_notes','view_master_schedule','view_my_record','view_my_reminders','view_team_reminders','manage_team_reminders','create_users','view_logs','view_gmt_overview','view_distribution_monitoring'],
	      ADMIN: ['view_dashboard','view_mailbox','view_members','manage_users','manage_announcements','manage_release_notes','manage_members_scheduling','view_master_schedule','view_my_record','view_logs','view_gmt_overview','view_distribution_monitoring'],
	      TEAM_LEAD: ['view_dashboard','view_mailbox','view_members','manage_members_scheduling','manage_announcements','view_master_schedule','view_my_record','view_my_reminders','view_team_reminders','manage_team_reminders','create_users','manage_team_config','view_logs','view_gmt_overview','view_distribution_monitoring'],
	      MEMBER: ['view_dashboard','view_mailbox','view_my_record','view_my_reminders','view_team_reminders','view_gmt_overview'],
	    },

    can(roleOrUser, perm){
      const user = (roleOrUser && typeof roleOrUser === 'object') ? roleOrUser : null;
      const role = (typeof roleOrUser === 'string') ? roleOrUser : (roleOrUser && roleOrUser.role);
      const p = this.PERMS[role] || [];
      let allowed = p.includes('*') || p.includes(perm);

      // Apply role-level overrides (Super Admin configurable).
      try{
        if(window.Store && Store.getRolePermOverrides){
          const ov = Store.getRolePermOverrides();
          if(ov && ov[role] && Object.prototype.hasOwnProperty.call(ov[role], perm)){
            allowed = !!ov[role][perm];
          }
        }
      }catch(_){}

      // User delegated privileges override role restrictions.
      try{
        if(user && window.Store && Store.userHasExtraPerm && Store.userHasExtraPerm(user.id, perm)){
          return true;
        }
      }catch(_){}

      return allowed;
    },

    teamById(id){
      // Developer Access is the default when team_id is NULL.
      if(id===null || id===undefined || String(id).trim()==='') return this.DEV_TEAM;
      return this.TEAMS.find(t => t.id===id) || this.TEAMS[0];
    },

    scheduleById(id){
      return this.SCHEDULES[id] || null;
    },

    // Map a shift/team key to its configured window (used by Members Graph Panel).
    // Accepts keys like: 'morning' | 'mid' | 'night' | 'dev' | 'developer_access'
    shiftByKey(key){
      try{
        const raw = String(key || '').trim();
        const k = raw.toLowerCase().replace(/\s+/g,'_');
        const teams = Config.TEAMS || {};

        // direct id match (morning/mid/night/dev)
        let t = teams[k] || null;

        // common aliases
        if(!t){
          if(k.includes('morning')) t = teams.morning || null;
          else if(k.includes('mid')) t = teams.mid || null;
          else if(k.includes('night')) t = teams.night || null;
          else if(k.includes('dev')) t = teams.dev || null;
        }

        // role/team objects sometimes pass full label
        if(!t && raw){
          const rk = raw.toLowerCase();
          if(rk.includes('morning')) t = teams.morning || null;
          else if(rk.includes('mid')) t = teams.mid || null;
          else if(rk.includes('night')) t = teams.night || null;
          else if(rk.includes('developer')) t = teams.dev || null;
        }

        if(!t) t = teams.morning || { id:'morning', label:'Morning Shift', teamStart:'06:00', teamEnd:'15:00', dutyStart:'06:00', dutyEnd:'15:00' };

        const startHM = t.startHM || t.teamStart || '06:00';
        const endHM = t.endHM || t.teamEnd || '15:00';
        const parseHM = (hm)=>{
          const parts = String(hm||'').split(':');
          const h = parseInt(parts[0], 10);
          const m = parseInt(parts[1] || 0, 10);
          if(Number.isNaN(h) || Number.isNaN(m)) return 0;
          return h*60 + m;
        };
        const sm = parseHM(startHM);
        let em = parseHM(endHM);
        let lenMin = em - sm;
        if(lenMin <= 0) lenMin += 24*60;

        return {
          key: t.id || k,
          label: t.label || raw || k,
          startHM,
          endHM,
          dutyStart: t.dutyStart || startHM,
          dutyEnd: t.dutyEnd || endHM,
          lenMin,
        };
      }catch(_){ return null; }
    },
  };

  window.Config = Config;
})();
