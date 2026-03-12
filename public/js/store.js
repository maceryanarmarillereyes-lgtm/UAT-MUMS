/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Strictly protects Enterprise UI/UX, Realtime Sync Logic, Core State Management, and Database/API Adapters. Do NOT modify existing logic or layout in this file without explicitly asking Thunter BOY for clearance. If overlapping changes are required, STOP and provide a RISK IMPACT REPORT first. */
(function(){
  const KEYS = {
    users: 'ums_users',
    // Backstop to reduce risk of accidental overwrite/corruption wiping users
    users_backup: 'ums_users_backup',
    session: 'ums_session',
    announcements: 'ums_announcements',
    cases: 'ums_cases',
    rr: 'ums_rr',
    weekly: 'ums_weekly_schedules',
    // Canonical schedule docs (enterprise)
    schedule_blocks: 'mums_schedule_blocks',
    schedule_snapshots: 'mums_schedule_snapshots',
    auto: 'ums_auto_schedule_settings',
    logs: 'ums_activity_logs',
    locks: 'mums_schedule_lock_state',
    locks_legacy: 'ums_schedule_locks',
    master: 'ums_master_schedule',
    leaves: 'ums_member_leaves',
    // Notifications (Schedule updates, mailbox assigns, etc.)
    // v2 key is preferred, but we keep v1 for backward compatibility.
    notifs: 'ums_schedule_notifs',
    notifs_v2: 'mums_schedule_notifs',
    my_reminders: 'mums_my_reminders',
    team_reminders: 'mums_team_reminders',
    reminder_settings: 'mums_reminder_settings',
    team_config: 'mums_team_config',
    attendance: 'mums_attendance',
    audit: 'ums_audit',
    profile: 'ums_user_profiles',
    theme: 'mums_theme',
    mailbox_time_override: 'mums_mailbox_time_override',
    // Cloud-synced override (when scope = Global across devices)
    mailbox_time_override_cloud: 'mums_mailbox_time_override_cloud',
    mailbox_tables: 'mums_mailbox_tables',
    mailbox_state: 'mums_mailbox_state',
    // Device/browser-scoped UI widgets
    worldclocks: 'mums_worldclocks',
    quicklinks: 'mums_quicklinks',

    // Online presence (device/tab-local "best effort" roster)
    online: 'mums_online_users',
    // Release notes are stored separately to survive factory reset.
    // Backup key is used to protect notes from accidental deletion.
    release_notes: 'mums_release_notes',
    release_notes_backup: 'mums_release_notes_backup',

    // Privileges / Commands (role settings visibility + delegated privileges)
    role_settings_features: 'mums_role_settings_features',
    role_perm_overrides: 'mums_role_perm_overrides',
    user_extra_privs: 'mums_user_extra_privs',
  };

  // 6 months retention as requested
  const SIX_MONTHS_MS = 183 * 24 * 60 * 60 * 1000;

  // Safe localStorage parse cache.
  // Stores { raw: string, parsed: any } per key and is invalidated on write().
  // NOTE: This must be defined before read()/write() to avoid ReferenceError,
  // which would cause Store.read() to always fall back (breaking sessions).
  const _cacheMap = new Map();

  function read(key, fallback){
    try{
      const v = localStorage.getItem(key);
      if(!v) return fallback;
      const hit = _cacheMap.get(key);
      if(hit && hit.raw === v){
        const val = hit.parsed;
        if(Array.isArray(val)) return val.slice();
        if(val && typeof val === 'object') return Object.assign({}, val);
        return val;
      }
      const parsed = JSON.parse(v);
      _cacheMap.set(key, { raw: v, parsed });
      if(Array.isArray(parsed)) return parsed.slice();
      if(parsed && typeof parsed === 'object') return Object.assign({}, parsed);
      return parsed;
    }catch(e){
      return fallback;
    }
  }
  function write(key, value, opts){
    localStorage.setItem(key, JSON.stringify(value));
    try{ _cacheMap.delete(key); }catch(_){ }
// Notify same-tab listeners (used to keep UI in sync without reload).
    // NOTE: Some internal migrations/sanitizers run during boot and should not
    // emit store events (they can cause expensive re-renders / perceived freezes).
    const silent = !!(opts && opts.silent);
    const fromRealtime = !!(opts && opts.fromRealtime);
    if(!silent){
      try{ window.dispatchEvent(new CustomEvent('mums:store', { detail: { key, source: (fromRealtime ? 'realtime' : 'local') } })); }catch(e){}
      try{
        if(key === KEYS.mailbox_time_override_cloud){
          window.dispatchEvent(new CustomEvent('mums:store', { detail: { key:'mailbox_override_cloud', source:(fromRealtime ? 'realtime' : 'local') } }));
        }
      }catch(_){ }
    }
    // Optional cross-browser real-time sync (requires local relay server).
    // Avoid echo loops by not publishing updates that originated from the relay.
    if(!fromRealtime){
      try{ window.Realtime && Realtime.onLocalWrite && Realtime.onLocalWrite(key, value); }catch(_){}
    }
  }

  // Cross-tab real-time bridge.
  // - localStorage "storage" events do not fire in the same tab that wrote the value,
  //   but they do fire in other tabs/windows.
  // - We mirror those events into the app's internal "mums:store" / "mums:theme" events
  //   so UI stays in sync across tabs without requiring reload.
  (function bindCrossTabBridge(){
    try{
      if(window.__mumsStorageBridge) return;
      window.__mumsStorageBridge = true;
      window.addEventListener('storage', (e)=>{
        try{
          if(!e || e.storageArea !== localStorage) return;
          const k = String(e.key||'');
          if(!k) return;
          try{ window.dispatchEvent(new CustomEvent('mums:store', { detail: { key: k } })); }catch(_){ }
          if(k === KEYS.theme){
            const id = String(localStorage.getItem(KEYS.theme) || 'ocean');
            try{ window.dispatchEvent(new CustomEvent('mums:theme', { detail: { id } })); }catch(_){ }
          }
        }catch(_){ }
      });
    }catch(_){ }
  })();

  // Users caching to avoid repeated JSON.parse + migration work on hot paths.
  // (Auth.getUser() is called often for UI refresh intervals.)
  let _usersCache = null;
  let _usersRev = '';
  let _userListRefreshAt = 0;
  function usersRev(){
    try{ return String(localStorage.getItem('ums_users_rev') || ''); }catch(_){ return ''; }
  }
  function bumpUsersRev(){
    try{ localStorage.setItem('ums_users_rev', String(Date.now())); }catch(_){ }
  }

  // Normalize legacy/corrupt user records so UI logic doesn't crash and roster isn't hidden.
  // This addresses:
  // - missing username/email/role/teamId
  // - role strings in older formats ("member", "Super Admin", etc.)
  // - non-object/null entries in localStorage arrays
  function sanitizeUsers(list){
    const teams = (window.Config && Array.isArray(Config.TEAMS) && Config.TEAMS.length) ? Config.TEAMS : [{id:'morning'}];
    const teamIds = new Set(teams.map(t=>t.id));
    const defaultTeam = teams[0].id;

    const makeId = ()=>{
      try{ if(window.crypto && crypto.randomUUID) return crypto.randomUUID(); }catch(_){ }
      return 'id-'+Math.random().toString(16).slice(2)+'-'+Date.now().toString(16);
    };

    const normalizeRole = (role)=>{
      const r0 = String(role||'').trim();
      if(!r0) return (window.Config ? Config.ROLES.MEMBER : 'MEMBER');
      const u = r0.toUpperCase().replace(/\s+/g,'_').replace(/-+/g,'_');
      const map = {
        SUPERADMIN: 'SUPER_ADMIN',
        SUPER_ADMINISTRATOR: 'SUPER_ADMIN',
        SUPERADMINISTRATOR: 'SUPER_ADMIN',
        SUPER_ADMIN: 'SUPER_ADMIN',
        SUPERUSER: 'SUPER_USER',
        SUPER_USER: 'SUPER_USER',
        ADMINISTRATOR: 'ADMIN',
        ADMIN: 'ADMIN',
        TEAMLEAD: 'TEAM_LEAD',
        TEAM_LEAD: 'TEAM_LEAD',
        TEAMLEADER: 'TEAM_LEAD',
        LEAD: 'TEAM_LEAD',
        MEMBER: 'MEMBER',
        MEMBERS: 'MEMBER',
        USER: 'MEMBER'
      };
      return map[u] || (window.Config && Config.ROLES[u] ? u : 'MEMBER');
    };

    const out = [];
    for(const raw of (Array.isArray(list) ? list : [])){
      if(!raw || typeof raw !== 'object') continue;
      const u = { ...raw };

      u.id = String(u.id||'').trim() || makeId();

      // username: required across the app (sorting, filters, uniqueness checks)
      const email = String(u.email||'').trim();
      let username = String(u.username||'').trim();
      if(!username && email.includes('@')) username = email.split('@')[0];
      if(username.includes('@')) username = username.split('@')[0];
      if(!username) username = 'user_' + u.id.slice(0,6);
      u.username = username;

      // name: optional but improve UX
      u.name = String(u.name||'').trim() || username;

      // role/team normalization (prevents "members not visible" due to role mismatch)
      u.role = normalizeRole(u.role);

      // Email should be preserved across cloud sync.
      // NOTE: profiles table does not store email; in cloud mode it is attached by APIs.
      const domain = (window.Config && Config.USERNAME_EMAIL_DOMAIN) ? String(Config.USERNAME_EMAIL_DOMAIN) : 'mums.local';
      u.email = email || (username.includes('@') ? username : (username + '@' + domain));

      // Team normalization:
      // - Default for SUPER roles is Developer Access (teamId = '')
      // - SUPER roles may override their own team when teamOverride is true
      // - Non-SUPER roles default to the first configured team
      u.teamOverride = !!(u.teamOverride ?? u.team_override ?? false);
      let teamRaw = (u.teamId !== undefined ? u.teamId : (u.team_id !== undefined ? u.team_id : ''));
      teamRaw = (teamRaw === null || teamRaw === undefined) ? '' : String(teamRaw).trim();

      if(u.role === 'SUPER_ADMIN' || u.role === 'SUPER_USER'){
        if(u.teamOverride){
          u.teamId = teamRaw;
          if(!u.teamId || !teamIds.has(u.teamId)) u.teamId = '';
        } else {
          u.teamId = '';
        }
        if(!u.teamId && ('schedule' in u)) u.schedule = null;
      } else {
        u.teamId = teamRaw || defaultTeam;
        if(!teamIds.has(u.teamId)) u.teamId = defaultTeam;
      }

      u.status = String(u.status||'active');
      // back-compat for older password field
      if(!u.passwordHash && u.password){
        try{ u.passwordHash = (window.Auth && typeof Auth.hash === "function") ? Auth.hash(u.password) : u.password; }catch(_){ }
        delete u.password;
      }
      out.push(u);
    }

    // Deduplicate by (id) first, then username/email
    const byId = new Map();
    for(const u of out){ if(!byId.has(u.id)) byId.set(u.id, u); }
    const merged = Array.from(byId.values());
    const keyOf = (u)=>String(u.username||u.email||u.id||'').trim().toLowerCase();
    const seen = new Set();
    const finalList = [];
    for(const u of merged){
      const k = keyOf(u);
      if(!k || seen.has(k)) continue;
      seen.add(k);
      finalList.push(u);
    }
    return finalList;
  }


  // Normalize announcement records to avoid hidden items or runtime errors.
  function sanitizeAnnouncements(list){
    const out = [];
    for(const raw of (Array.isArray(list) ? list : [])){
      if(!raw || typeof raw !== 'object') continue;
      const a = { ...raw };
      a.id = String(a.id||'').trim() || ('ann-'+Math.random().toString(16).slice(2)+'-'+Date.now().toString(16));
      a.title = String(a.title||'').trim() || 'Announcement';
      a.short = String(a.short||'').trim();
      a.full = String(a.full||'').trim();
      // Full HTML is optional; keep only if string.
      if(a.fullHtml && typeof a.fullHtml !== 'string') delete a.fullHtml;

      // Start/end windows must be numeric ms. If missing, default to always-active window.
      const now = Date.now();
      const startAt = Number(a.startAt);
      const endAt = Number(a.endAt);
      a.startAt = Number.isFinite(startAt) ? startAt : (Number.isFinite(Number(a.createdAt)) ? Number(a.createdAt) : (now - 60*60*1000));
      a.endAt = Number.isFinite(endAt) ? endAt : (a.startAt + 24*60*60*1000);
      a.createdAt = Number.isFinite(Number(a.createdAt)) ? Number(a.createdAt) : a.startAt;

      a.createdBy = a.createdBy ? String(a.createdBy) : '';
      a.createdByName = a.createdByName ? String(a.createdByName) : '';

      out.push(a);
    }
    // Sort stable by start
    out.sort((x,y)=>Number(x.startAt||0)-Number(y.startAt||0));
    return out;
  }
  // Robust user loading:
  // - recover from backup if primary is empty/corrupt
  // - migrate from legacy keys if present
  function readUsersRobust(){
    const primaryRaw = localStorage.getItem(KEYS.users);
    let primary = null;
    try{ primary = primaryRaw ? JSON.parse(primaryRaw) : null; }catch(e){ primary = null; }
    if(!Array.isArray(primary)) primary = null;

    const backupRaw = localStorage.getItem(KEYS.users_backup);
    let backup = null;
    try{ backup = backupRaw ? JSON.parse(backupRaw) : null; }catch(e){ backup = null; }
    if(!Array.isArray(backup)) backup = null;

    const cloudMode = !!(window.CloudAuth && CloudAuth.isEnabled && CloudAuth.isEnabled());

    // Legacy keys from older builds / experiments (keep expanding to prevent "missing users" regressions)
    // In cloud mode, do NOT recover from legacy keys, as it can resurrect stale local users and create duplicates.
    const legacyKeys = cloudMode ? [] : [
      'users','vip_users','dashboard_users','umsUsers','ums_users_v1','ums_users_v2',
      // MUMS-branded builds
      'mums_users','mumsUsers','mums_users_v1','mums_users_v2',
      // Backups or alternate prefixes
      'users_backup','vip_users_backup','dashboard_users_backup','ums_users_backup','mums_users_backup'
    ];
    let legacy = [];
    for(const k of legacyKeys){
      const raw = localStorage.getItem(k);
      if(!raw) continue;
      try{
        const arr = JSON.parse(raw);
        if(Array.isArray(arr) && arr.length){ legacy = legacy.concat(arr); }
      }catch(e){ /* ignore */ }
    }

    // Choose best base: primary if non-empty, else backup if non-empty, else legacy.
    const baseSource = (primary && primary.length) ? 'primary'
      : (backup && backup.length) ? 'backup'
      : (legacy && legacy.length) ? 'legacy'
      : 'empty';

    let base = (baseSource==='primary') ? primary
      : (baseSource==='backup') ? backup
      : (baseSource==='legacy') ? legacy
      : [];

    // IMPORTANT:
    // Older builds used a variety of keys for experimentation. We only fall back to those legacy keys
    // when the primary/backup stores are missing or unusable.
    // We do NOT merge legacy keys into a healthy primary/backup store because it can resurrect
    // intentionally deleted users.

    // If primary was corrupted (raw exists but parse failed), preserve raw for debugging
    if(primaryRaw && !primary){
      try{ localStorage.setItem('ums_users_corrupt_'+Date.now(), primaryRaw); }catch(e){}
    }

    const cleaned = sanitizeUsers(base);
    // Persist sanitized roster to prevent repeat crashes across pages.
    // IMPORTANT: silent writes ...
    try{ write(KEYS.users, cleaned, { silent:true }); write(KEYS.users_backup, cleaned, { silent:true }); }catch(e){}
    return cleaned;
  }

  function uuid(){
    if(window.crypto && crypto.randomUUID) return crypto.randomUUID();
    // fallback
    return 'id-'+Math.random().toString(16).slice(2)+'-'+Date.now().toString(16);
  }

  const Store = {
    ensureSeed(){
      // Use robust loader so a corrupted/empty primary store doesn't wipe the roster.
      const users = readUsersRobust();
      const hasBootstrapAdmin = users.find(u => String(u.username||'').toLowerCase()==='supermace');

      const cloudMode = !!(window.CloudAuth && CloudAuth.isEnabled && CloudAuth.isEnabled());

      // Seed policy:
      // - If this is a brand-new install (no users at all), create a single SUPER_ADMIN bootstrap account.
      // - If users already exist and the bootstrap admin was intentionally deleted, do NOT resurrect it.
      // - If the bootstrap admin exists, keep it SUPER_ADMIN but remove team/schedule assignments.
      const mkBootstrapAdmin = (id)=>({
        id: id || uuid(),
        username: 'supermace',
        email: 'supermace@mums.local',
        name: 'Super Mace',
        role: (window.Config ? Config.ROLES.SUPER_ADMIN : 'SUPER_ADMIN'),
        // Requirement: Super Admin has no team/shift assignment
        teamId: '',
        // Requirement: Super Admin has no schedule assignment
        schedule: null,
        status: 'active',
        passwordHash: (window.Auth && typeof Auth.hash === "function") ? Auth.hash('supermace') : 'h0',
        createdAt: Date.now(),
      });

      let out = Array.isArray(users) ? users.slice() : [];

      if(cloudMode){
        // Cloud mode: local roster must not resurrect/seed stale users.
        // If any non-cloud entries exist, clear roster and let CloudUsers.refreshIntoLocalStore() repopulate.
        try{
          const hasNonCloud = (out||[]).some(u => !(u && u._cloud));
          if(hasNonCloud) out = [];
        }catch(_){ out = []; }
      } else {
      if(!out.length && !hasBootstrapAdmin){
        out = [mkBootstrapAdmin()];
      } else if(hasBootstrapAdmin){
        // Migrate bootstrap admin to the Super Admin policy (no team/schedule assignment).
        out = out.map(u=>{
          if(u && u.id===hasBootstrapAdmin.id){
            const keepHash = (u.passwordHash && String(u.passwordHash).trim()) ? u.passwordHash : ((window.Auth && typeof Auth.hash === "function") ? Auth.hash('supermace') : 'h0');
            return {
              ...u,
              username: 'supermace',
              role: (window.Config ? Config.ROLES.SUPER_ADMIN : 'SUPER_ADMIN'),
              email: u.email || 'supermace@mums.local',
              name: u.name || 'Super Mace',
              teamId: '',
              schedule: null,
              status: u.status || 'active',
              passwordHash: keepHash,
            };
          }
          return u;
        });
      }

      }

      // Write both primary + backup (sanitized by robust loader).
      write(KEYS.users, out);
      write(KEYS.users_backup, out);
      bumpUsersRev();
      _usersCache = out;
      _usersRev = usersRev();
      if(localStorage.getItem(KEYS.announcements)===null) write(KEYS.announcements, []);
      if(localStorage.getItem(KEYS.cases)===null) write(KEYS.cases, []);
      if(localStorage.getItem(KEYS.rr)===null) write(KEYS.rr, {});
      if(localStorage.getItem(KEYS.logs)===null) write(KEYS.logs, []);
      if(localStorage.getItem(KEYS.locks)===null) write(KEYS.locks, {});
      if(localStorage.getItem(KEYS.profile)===null) write(KEYS.profile, {});
      if(localStorage.getItem(KEYS.theme)===null) localStorage.setItem(KEYS.theme, 'ocean');
      if(localStorage.getItem(KEYS.quicklinks)===null) write(KEYS.quicklinks, Array.from({length:10}, ()=>({label:'', url:'', glowColor:''})));
      if(localStorage.getItem(KEYS.my_reminders)===null) write(KEYS.my_reminders, []);
      if(localStorage.getItem(KEYS.team_reminders)===null) write(KEYS.team_reminders, []);
      if(localStorage.getItem(KEYS.reminder_settings)===null) write(KEYS.reminder_settings, {
        snoozePresets: [5,10,15,30],
        categories: ['Work','Personal','Urgent'],
        escalationAfterMin: 2,
        maxVisible: 3
      });
      if(localStorage.getItem(KEYS.team_config)===null) write(KEYS.team_config, {});
      // Release notes: initialize once, and also seed the backup store.
      // Notes are intentionally not removed on factory reset.
      if(localStorage.getItem(KEYS.release_notes)===null){
        const init = [{
          id: uuid(),
          version: (document.querySelector('.brand-build') ? (document.querySelector('.brand-build').textContent||'').replace('Build:','').trim() : ''),
          date: Date.now(),
          title: 'Build initialized',
          body: 'Release notes are now available in-app. Future changes will append here (older notes are retained).',
          author: 'SYSTEM',
          tags:['init']
        }];
        write(KEYS.release_notes, init);
        write(KEYS.release_notes_backup, init);
      } else if(localStorage.getItem(KEYS.release_notes_backup)===null){
        // Create backup if a prior build already has notes.
        try{ write(KEYS.release_notes_backup, read(KEYS.release_notes, [])); }catch(_){ }
      }
    },

    // users
    getUsers(){
      let rev = usersRev();
      // If revision missing (older builds), create one so caching works reliably.
      if(!rev){ bumpUsersRev(); rev = usersRev(); }
      if(_usersCache && rev === _usersRev) return _usersCache;
      const loaded = readUsersRobust();
      _usersCache = loaded;
      _usersRev = usersRev() || rev;
      return loaded;
    },

    // Lookup by id (used by Auth session restore + various UI surfaces).
    // Some earlier builds exposed Store.getUserById(), so we keep this helper
    // to prevent login loops when session restoration expects it.
    getUserById(id){
      const uid = String(id||'').trim();
      if(!uid) return null;
      return Store.getUsers().find(u => String(u && u.id) === uid) || null;
    },
    saveUsers(list, opts){
      const arr = Array.isArray(list) ? list : [];
      const safe = (opts && opts.skipSanitize) ? arr : sanitizeUsers(arr);
      write(KEYS.users, safe, opts);
      write(KEYS.users_backup, safe, opts);
      bumpUsersRev();
      _usersCache = safe;
      _usersRev = usersRev();
      return safe;
    },

    // Authoritative overwrite for cloud roster sync.
    // Unlike importUsers(), this preserves additional fields such as email/teamOverride
    // and is intended to be called by CloudUsers.refreshIntoLocalStore().
    setUsers(list, opts){
      const safe = Store.saveUsers(list, opts);
      return Array.isArray(safe) ? safe.length : 0;
    },
    // Import users from an external JSON (e.g., to move data into a private/incognito browser).
    // Performs the same normalization used by the robust loader to prevent crashes / hidden members.
    importUsers(list){
      const normalized = sanitizeUsers(Array.isArray(list) ? list : []);
      Store.saveUsers(normalized);
      return normalized.length;
    },

    // Export a portable system snapshot for private/incognito browsers.
    // Includes users + announcements + release notes (and can be extended later).
    exportBundle(){
      const build = (window.Config && Config.BUILD) ? Config.BUILD : '';
      const bundle = {
        kind: 'mums_bundle',
        build,
        exportedAt: Date.now(),
        users: Store.getUsers(),
        announcements: Store.getAnnouncements(),
        releaseNotes: read(KEYS.release_notes, []),
        myReminders: read(KEYS.my_reminders, []),
        teamReminders: read(KEYS.team_reminders, []),
      };
      return bundle;
    },

    // Import a system snapshot.
    // Back-compat:
    // - If an array is provided, treat it as users[] (older exports).
    importBundle(data){
      // Older format: users array only
      if(Array.isArray(data)){
        const n = Store.importUsers(data);
        return { users: n, announcements: 0, releaseNotes: 0 };
      }
      const obj = (data && typeof data === 'object') ? data : null;
      if(!obj) throw new Error('Invalid JSON. Expected a MUMS bundle or users array.');

      let usersN = 0, annN = 0, rnN = 0, myRemN = 0, teamRemN = 0;
      if(Array.isArray(obj.users)){
        usersN = Store.importUsers(obj.users);
      }
      if(Array.isArray(obj.announcements)){
        const anns = sanitizeAnnouncements(obj.announcements);
        Store.saveAnnouncements(anns);
        annN = anns.length;
      }

      if(Array.isArray(obj.myReminders)){
        const cleaned = (obj.myReminders||[]).filter(x=>x && typeof x==='object').map(x=>({
          id: String(x.id||uuid()),
          userId: String(x.userId||''),
          short: String(x.short||''),
          details: String(x.details||''),
          alarmAt: Number(x.alarmAt||Date.now()),
          durationMin: Math.max(1, Number(x.durationMin||1)),
          repeat: String(x.repeat||'none'),
          priority: String(x.priority||'normal'),
          createdAt: Number(x.createdAt||Date.now()),
          updatedAt: Number(x.updatedAt||Date.now()),
          closedAt: x.closedAt ? Number(x.closedAt) : null,
          snoozeUntil: x.snoozeUntil ? Number(x.snoozeUntil) : null,
        }));
        write(KEYS.my_reminders, cleaned);
        myRemN = cleaned.length;
      }
      if(Array.isArray(obj.teamReminders)){
        const cleaned = (obj.teamReminders||[]).filter(x=>x && typeof x==='object').map(x=>({
          id: String(x.id||uuid()),
          teamId: String(x.teamId||''),
          createdBy: String(x.createdBy||''),
          short: String(x.short||''),
          details: String(x.details||''),
          alarmAt: Number(x.alarmAt||Date.now()),
          durationMin: Math.max(1, Number(x.durationMin||1)),
          repeat: String(x.repeat||'none'),
          priority: String(x.priority||'normal'),
          createdAt: Number(x.createdAt||Date.now()),
          updatedAt: Number(x.updatedAt||Date.now()),
          perUser: (x.perUser && typeof x.perUser==='object') ? x.perUser : {},
          ackLog: Array.isArray(x.ackLog) ? x.ackLog : [],
        }));
        write(KEYS.team_reminders, cleaned);
        teamRemN = cleaned.length;
      }
      if(Array.isArray(obj.releaseNotes)){
        // Keep release notes append-only by default; merge without deleting.
        const existing = read(KEYS.release_notes, []);
        const merged = Array.isArray(existing) ? existing.slice() : [];
        const seen = new Set(merged.map(x=>x && x.id ? String(x.id) : ''));
        for(const r of (Array.isArray(obj.releaseNotes)?obj.releaseNotes:[])){
          if(!r || typeof r !== 'object') continue;
          const id = String(r.id||'').trim();
          if(!id || seen.has(id)) continue;
          seen.add(id);
          merged.push(r);
        }
        write(KEYS.release_notes, merged);
        // Keep backup in sync for safety
        try{ write(KEYS.release_notes_backup, merged); }catch(_){ }
        rnN = merged.length;
      }
      return { users: usersN, announcements: annN, releaseNotes: rnN, myReminders: myRemN, teamReminders: teamRemN };
    },

    addUser(user){
      const users = Store.getUsers();
      users.unshift(user);
      Store.saveUsers(users);
    },
    updateUser(id, patch){
      const users = Store.getUsers().map(u => u.id===id ? { ...u, ...patch, id } : u);
      Store.saveUsers(users);
    },
    deleteUser(id){
      Store.saveUsers(Store.getUsers().filter(u=>u.id!==id));
      try{ Store.clearUserExtraPrivs && Store.clearUserExtraPrivs(id); }catch(_){ }
    },
    findUserByLogin(login, password){
      const l = String(login||'').trim().toLowerCase();
      const u = Store.getUsers().find(u => String(u.username||'').toLowerCase()===l || String(u.email||'').toLowerCase()===l) || null;
      if(!u) return null;
      // If a password is provided, validate it.
      if(typeof password === 'string' && password.length){
        const h = (window.Auth && Auth.hash) ? Auth.hash(password) : null;
        if(!h || String(u.passwordHash||'') !== String(h)) return null;
      }
      return u;
    },

    // user profile extras (photo, preferences)
    getProfiles(){
      const obj = read(KEYS.profile, {});
      return obj && typeof obj === 'object' ? obj : {};
    },
    saveProfiles(obj){ write(KEYS.profile, obj || {}); },
    getProfile(userId){
      const all = Store.getProfiles();
      return all[userId] || null;
    },
    setProfile(userId, patch){
      const all = Store.getProfiles();
      all[userId] = { ...(all[userId]||{}), ...(patch||{}), userId };
      Store.saveProfiles(all);
    },

    // World clocks (3 programmable digital clocks shown on bottom bar)
    // Saved per-user to prevent settings leaking across accounts on the same device/browser.
    // NOTE: Keys are normalized to match UI/components: hoursColor + minutesColor.
    getWorldClocks(){
      // Default pinned clocks (used only when there is no prior user/device configuration).
      // Users may pin additional clocks; the bottom bar is horizontally scrollable.
      const def = [
        { enabled: false, label: 'Manila', timeZone: 'Asia/Manila', offsetMinutes: null, hoursColor: '#EAF3FF', minutesColor: '#9BD1FF', alarmEnabled: false, alarmTime: '09:00', style: 'classic' },
        { enabled: false, label: 'UTC', timeZone: 'UTC', offsetMinutes: 0, hoursColor: '#EAF3FF', minutesColor: '#9BD1FF', alarmEnabled: false, alarmTime: '09:00', style: 'classic' },
        { enabled: false, label: 'New York', timeZone: 'America/New_York', offsetMinutes: null, hoursColor: '#EAF3FF', minutesColor: '#9BD1FF', alarmEnabled: false, alarmTime: '09:00', style: 'classic' },
      ];

      const baseClock = { enabled:false, label:'', timeZone:'UTC', offsetMinutes:0, hoursColor:'#EAF3FF', minutesColor:'#9BD1FF', alarmEnabled:false, alarmTime:'09:00', style:'classic' };

      const normalizeOne = (cur)=>{
        const c = Object.assign({}, baseClock, cur||{});
        // Back-compat: migrate old keys (hourColor/minColor) if present.
        if(c.hourColor && !c.hoursColor) c.hoursColor = c.hourColor;
        if(c.minColor && !c.minutesColor) c.minutesColor = c.minColor;
        delete c.hourColor; delete c.minColor;

        c.enabled = !!c.enabled;
        c.alarmEnabled = !!c.alarmEnabled;
        c.label = String(c.label||'').trim();
        c.timeZone = String(c.timeZone||'').trim() || 'UTC';

        // Support either IANA timeZone OR a fixed GMT offset in minutes.
        // offsetMinutes === null means: use timeZone.
        if(c.offsetMinutes === '' || c.offsetMinutes === undefined) c.offsetMinutes = null;
        if(c.offsetMinutes !== null){
          const n = Number(c.offsetMinutes);
          c.offsetMinutes = Number.isFinite(n) ? n : null;
        }

        c.hoursColor = String(c.hoursColor||'#EAF3FF').trim() || '#EAF3FF';
        c.minutesColor = String(c.minutesColor||'#9BD1FF').trim() || '#9BD1FF';
        c.alarmTime = String(c.alarmTime||'09:00').trim() || '09:00';
        c.style = String(c.style||'classic').trim() || 'classic';
        return c;
      };

      const normalize = (arr)=>{
        const list = Array.isArray(arr) ? arr : null;
        if(!list || list.length===0){
          return def.map(normalizeOne);
        }

        // Ensure we always have at least the first 3 defaults, but allow users to pin more.
        const out = [];
        const minLen = Math.max(3, list.length);
        for(let i=0;i<minLen;i++){
          const src = (i < list.length) ? list[i] : (def[i] || baseClock);
          const fallback = def[i] || baseClock;
          out.push(normalizeOne(Object.assign({}, fallback, src||{})));
        }
        return out;
      };

      try{
        const sess = Store.getSession && Store.getSession();
        const userId = (sess && sess.userId) ? String(sess.userId) : '';
        if(userId && Store.getProfile){
          const prof = Store.getProfile(userId) || {};
          if(Array.isArray(prof.worldClocks)) return normalize(prof.worldClocks);

          // Migration: if a legacy global worldclocks store exists, attach it to the user's profile once.
          const raw = localStorage.getItem(KEYS.worldclocks);
          if(raw){
            try{
              const legacyArr = JSON.parse(raw);
              if(Array.isArray(legacyArr)){
                try{ Store.setProfile(userId, { worldClocks: legacyArr }); }catch(_){ }
                return normalize(legacyArr);
              }
            }catch(_){ }
          }
        }
      }catch(_){ }

      // No session: fall back to device/browser global store (login screen / first run).
      try{
        const raw = localStorage.getItem(KEYS.worldclocks);
        const arr = raw ? JSON.parse(raw) : null;
        return normalize(arr);
      }catch(_){
        return def;
      }
    },

    saveWorldClocks(list){
      const out = Array.isArray(list) ? list : [];
      // Always keep a global copy as "last used" for the login screen / first-time profiles.
      try{ localStorage.setItem(KEYS.worldclocks, JSON.stringify(out)); }catch(_){ }

      // Persist per-user when a session exists.
      try{
        const sess = Store.getSession && Store.getSession();
        const userId = (sess && sess.userId) ? String(sess.userId) : '';
        if(userId && Store.setProfile) Store.setProfile(userId, { worldClocks: out });
      }catch(_){ }

      // Broadcast change so UI updates instantly without reload.
      try{ window.dispatchEvent(new CustomEvent('mums:store', { detail: { key: KEYS.worldclocks } })); }catch(_){ }
      try{ window.dispatchEvent(new CustomEvent('mums:worldclocks', { detail: { key: KEYS.worldclocks } })); }catch(_){ }
    },

    // Theme preference (saved per-user; falls back to last-used on this device/browser)
    // Fixes: theme leaking across accounts when switching users in the same browser.
    getTheme(){
      try{
        const sess = Store.getSession && Store.getSession();
        const userId = (sess && sess.userId) ? String(sess.userId) : '';
        if(userId){
          const prof = Store.getProfile ? (Store.getProfile(userId) || {}) : {};
          const t = (prof && prof.theme) ? String(prof.theme) : '';
          if(t) return t;
          // Migration: if a legacy global theme exists, store it onto the user's profile once.
          const legacy = String(localStorage.getItem(KEYS.theme) || '');
          if(legacy){
            try{ Store.setProfile(userId, { theme: legacy }); }catch(_){ }
            return legacy;
          }
        }
      }catch(_){ }
      return String(localStorage.getItem(KEYS.theme) || 'ocean');
    },
    setTheme(themeId){
      const id = String(themeId||'ocean');
      // Keep a global copy as "last used" for login page / first-time profiles.
      localStorage.setItem(KEYS.theme, id);
      // Save per user when a session exists.
      try{
        const sess = Store.getSession && Store.getSession();
        const userId = (sess && sess.userId) ? String(sess.userId) : '';
        if(userId && Store.setProfile) Store.setProfile(userId, { theme: id });
      }catch(_){ }
      try{ window.dispatchEvent(new CustomEvent('mums:theme', { detail: { id } })); }catch(e){}
    },

    // Release notes
    // - append-only for normal usage
    // - protected by a backup key
    // - can be deleted only by privileged users (UI-gated)
    getReleaseNotes(){
      // Recovery: if main store is missing/corrupt but backup exists, restore.
      let arr = read(KEYS.release_notes, null);
      if(!Array.isArray(arr)){
        const b = read(KEYS.release_notes_backup, []);
        if(Array.isArray(b) && b.length){
          try{ write(KEYS.release_notes, b); }catch(_){ }
          arr = b;
        }
      }
      if(!Array.isArray(arr)) arr = [];
      const list = Array.isArray(arr) ? arr : [];
      // Normalize + sort (newest first)
      return list
        .map(n=>({
          id: String(n && n.id || ''),
          version: String(n && n.version || ''),
          date: Number(n && n.date || 0),
          title: String(n && n.title || ''),
          body: String(n && n.body || ''),
          author: String(n && n.author || ''),
          tags: Array.isArray(n && n.tags) ? n.tags.map(String) : [],
        }))
        .filter(n=>n.version || n.title || n.body)
        .sort((a,b)=>(b.date||0)-(a.date||0));
    },
    // Persist notes.
    // opts.updateBackup (default true): when false, the backup snapshot is NOT overwritten.
    saveReleaseNotes(list, opts){
      const out = Array.isArray(list)?list:[];
      const o = opts || {};
      const updateBackup = (o.updateBackup===undefined) ? true : !!o.updateBackup;
      write(KEYS.release_notes, out);
      // Backup is intentionally protected. We do not overwrite it on destructive operations
      // unless explicitly requested.
      if(updateBackup){
        try{ write(KEYS.release_notes_backup, out); }catch(_){ }
      }
    },
    addReleaseNote(note){
      const list = Store.getReleaseNotes();
      const n = note || {};
      const id = String(n.id || uuid());
      const out = [{
        id,
        version: String(n.version||''),
        date: Number(n.date||Date.now()),
        title: String(n.title||''),
        body: String(n.body||''),
        author: String(n.author||''),
        tags: Array.isArray(n.tags)? n.tags.map(String):[],
      }, ...list];
      Store.saveReleaseNotes(out, { updateBackup:true });
    },

    deleteReleaseNote(noteId){
      const id = String(noteId||'').trim();
      if(!id) return;
      const list = Store.getReleaseNotes().filter(n=>n && String(n.id)!==id);
      // Do not overwrite backup on deletes (security requirement).
      Store.saveReleaseNotes(list, { updateBackup:false });
    },

    clearReleaseNotes(){
      // Clear visible list without wiping the protected backup.
      Store.saveReleaseNotes([], { updateBackup:false });
    },

    // Import notes from array/object. Mode:
    // - merge (default): prepend new unique ids
    // - replace: overwrite with imported list
    importReleaseNotes(payload, mode){
      const m = String(mode||'merge').toLowerCase();
      const normOne = (x)=>{
        if(!x || typeof x !== 'object') return null;
        const n = {
          id: String(x.id || uuid()),
          version: String(x.version||''),
          date: Number(x.date||Date.now()),
          title: String(x.title||''),
          body: String(x.body||x.text||''),
          author: String(x.author||''),
          tags: Array.isArray(x.tags) ? x.tags.map(String) : (String(x.tags||'').split(',').map(s=>s.trim()).filter(Boolean)),
        };
        if(!(n.title||n.body||n.version)) return null;
        return n;
      };
      let arr = [];
      if(Array.isArray(payload)) arr = payload;
      else if(payload && typeof payload === 'object') arr = [payload];
      const incoming = arr.map(normOne).filter(Boolean);
      if(!incoming.length) return;

      if(m === 'replace'){
        Store.saveReleaseNotes(incoming);
        return;
      }

      const cur = Store.getReleaseNotes();
      const seen = new Set(cur.map(n=>String(n.id||'')));
      const merged = [];
      for(const n of incoming){
        const id = String(n.id||'');
        if(id && seen.has(id)) continue;
        if(id) seen.add(id);
        merged.push(n);
      }
      Store.saveReleaseNotes([...merged, ...cur]);
    },

    // Quick links (10 circles) saved per-user
    // Requirement: Quick Links configuration must be individualized per user.
    getQuickLinks(){
      const normalize = (arr)=>{
        const list = Array.isArray(arr) ? arr.slice(0,10) : [];
        // Back-compat: older builds stored only {label,url}.
        for(let i=0;i<list.length;i++){
          const it = list[i]||{};
          list[i] = { label: String(it.label||''), url: String(it.url||''), glowColor: String(it.glowColor||it.glow||'') };
        }
        while(list.length < 10) list.push({ label:'', url:'', glowColor:'' });
        return list;
      };

      // Migration: older builds mistakenly stored quicklinks under the key "undefined"
      // due to missing KEYS.quicklinks. If present, move it to the correct key once.
      try{
        if(localStorage.getItem(KEYS.quicklinks) === null){
          const legacyRaw = localStorage.getItem('undefined');
          if(legacyRaw){
            try{
              const legacyArr = JSON.parse(legacyRaw);
              if(Array.isArray(legacyArr)){
                // Silent write to avoid unnecessary re-renders during boot.
                write(KEYS.quicklinks, legacyArr, { silent:true });
                try{ localStorage.removeItem('undefined'); }catch(_){ }
              }
            }catch(_){ }
          }
        }
      }catch(_){ }

      // Per-user store (preferred)
      try{
        const sess = Store.getSession && Store.getSession();
        const userId = (sess && sess.userId) ? String(sess.userId) : '';
        if(userId && Store.getProfile){
          const prof = Store.getProfile(userId) || {};
          if(Array.isArray(prof.quickLinks)) return normalize(prof.quickLinks);

          // Migration: if a legacy global quicklinks store exists, attach it to the user's profile once.
          const legacy = read(KEYS.quicklinks, null);
          if(Array.isArray(legacy)){
            try{ Store.setProfile(userId, { quickLinks: legacy }); }catch(_){ }
            return normalize(legacy);
          }
        }
      }catch(_){ }

      // No session: fall back to device/browser global store (login screen / first run).
      return normalize(read(KEYS.quicklinks, []));
    },

    saveQuickLinks(list){
      const normalize = (arr)=>{
        const out = Array.isArray(arr) ? arr.slice(0,10) : [];
        for(let i=0;i<out.length;i++){
          const it = out[i]||{};
          out[i] = { label: String(it.label||''), url: String(it.url||''), glowColor: String(it.glowColor||it.glow||'') };
        }
        while(out.length < 10) out.push({ label:'', url:'', glowColor:'' });
        return out;
      };

      const out = normalize(list);
      // Always keep a global copy as "last used" for login / first-time profiles.
      write(KEYS.quicklinks, out);

      // Persist per-user when a session exists.
      try{
        const sess = Store.getSession && Store.getSession();
        const userId = (sess && sess.userId) ? String(sess.userId) : '';
        if(userId && Store.setProfile) Store.setProfile(userId, { quickLinks: out });
      }catch(_){ }
    },

    setQuickLink(slotIndex, link){
      const i = Math.max(0, Math.min(9, Number(slotIndex||0)));
      const list = Store.getQuickLinks();
      list[i] = { label: String(link?.label||''), url: String(link?.url||''), glowColor: String(link?.glowColor||link?.glow||'') };
      Store.saveQuickLinks(list);
    },
    clearQuickLink(slotIndex){
      const i = Math.max(0, Math.min(9, Number(slotIndex||0)));
      const list = Store.getQuickLinks();
      list[i] = { label:'', url:'', glowColor:'' };
      Store.saveQuickLinks(list);
    },

    // session
    getSession() {
      // localStorage → sessionStorage → cookie
      try {
        const s = read(KEYS.session, null);
        if (s) return s;
      } catch (_) {}
      try {
        const v = sessionStorage.getItem(KEYS.session);
        if (v) return JSON.parse(v);
      } catch (_) {}
      try {
        const cv = _getCookie(KEYS.session);
        if (cv) return JSON.parse(cv);
      } catch (_) {}
      return null;
    },
    setSession(sess){ write(KEYS.session, sess); },
    clearSession(){ localStorage.removeItem(KEYS.session); },

    // announcements
    getAnnouncements(){ return sanitizeAnnouncements(read(KEYS.announcements, [])); },
    saveAnnouncements(list){ write(KEYS.announcements, sanitizeAnnouncements(list)); },

    // cases
    getCases(){ return read(KEYS.cases, []); },
    saveCases(list){ write(KEYS.cases, list); },

    // round robin pointers
    getRR(){ return read(KEYS.rr, {}); },
    saveRR(obj){ write(KEYS.rr, obj); },

    // Weekly per-user schedules (Sun..Sat) with time blocks.
    // Stored as: { [userId]: { teamId: "morning", days: { "0": [..], ... "6": [..] } } }
    // NOTE: `mums_schedule_blocks` is the canonical enterprise key.
    // `ums_weekly_schedules` is retained for backward compatibility.
    getWeekly(){ return read(KEYS.weekly, {}); },
    saveWeekly(obj){ write(KEYS.weekly, obj); },

    // Canonical schedule blocks (enterprise) — mirrors the weekly structure.
    getScheduleBlocks(){ return read(KEYS.schedule_blocks, {}); },
    saveScheduleBlocks(obj){ write(KEYS.schedule_blocks, obj); },

    // Schedule snapshots (enterprise) — append-only, used for rollback/audit.
    getScheduleSnapshots(){
      const list = read(KEYS.schedule_snapshots, []);
      return Array.isArray(list) ? list : [];
    },
    appendScheduleSnapshot(entry){
      try{
        const list = Store.getScheduleSnapshots();
        const e = entry ? { ...entry } : {};
        if (!e.id) e.id = 'snap_' + Math.random().toString(36).slice(2) + '_' + Date.now().toString(36);
        if (!e.ts) e.ts = Date.now();
        list.unshift(e);
        // Keep last 200 to avoid uncontrolled growth.
        while(list.length > 200) list.pop();
        write(KEYS.schedule_snapshots, list);
      } catch(_) {}
    },

    getUserDayBlocks(userId, dayIndex){
      const uid = String(userId || '');
      const di = String(dayIndex);
      // Prefer canonical enterprise blocks; fall back to legacy weekly.
      const allA = Store.getScheduleBlocks();
      const uA = allA && allA[uid];
      const daysA = (uA && uA.days) || null;
      const listA = daysA ? (daysA[di] || []) : null;
      if (Array.isArray(listA) && listA.length) return listA;

      const allB = Store.getWeekly();
      const uB = allB && allB[uid];
      const daysB = (uB && uB.days) || {};
      const listB = daysB[di] || [];
      return Array.isArray(listB) ? listB : [];
    },
    setUserDayBlocks(userId, teamId, dayIndex, blocks){
      const uid = String(userId || '');
      const di = String(dayIndex);
      const safeBlocks = Array.isArray(blocks) ? blocks : [];

      // Update canonical blocks.
      try{
        const allA = Store.getScheduleBlocks();
        if(!allA[uid]) allA[uid] = { teamId: teamId || null, days: {} };
        allA[uid].teamId = teamId || allA[uid].teamId || null;
        allA[uid].days[di] = safeBlocks;
        Store.saveScheduleBlocks(allA);
      }catch(_){ }

      // Update legacy weekly (compat).
      try{
        const allB = Store.getWeekly();
        if(!allB[uid]) allB[uid] = { teamId: teamId || null, days: {} };
        allB[uid].teamId = teamId || allB[uid].teamId || null;
        allB[uid].days[di] = safeBlocks;
        Store.saveWeekly(allB);
      }catch(_){ }
    },

    // Auto-schedule settings per team (shift)
    getAutoSettings(){ return read(KEYS.auto, {}); },
    saveAutoSettings(obj){ write(KEYS.auto, obj); },
    getTeamAutoSettings(teamId){
      const all = Store.getAutoSettings();
      return all[teamId] || null;
    },
    setTeamAutoSettings(teamId, settings){
      const all = Store.getAutoSettings();
      all[teamId] = settings;
      Store.saveAutoSettings(all);
    },


    // Activity logs (retained for ~6 months)
    getLogs(){
      const list = read(KEYS.logs, []);
      return Array.isArray(list) ? list : [];
    },
    saveLogs(list){
      const cutoff = Date.now() - SIX_MONTHS_MS;
      const cleaned = (list||[]).filter(x => (x && x.ts && x.ts >= cutoff));
      write(KEYS.logs, cleaned);
    },
    addLog(entry){
      const list = Store.getLogs();
      list.unshift(Store.normalizeLogEntry(entry));
      Store.saveLogs(list);
    },

    // --- Activity Logs: enterprise diagnostics + safe cleanup (offline-first) ---
    // Normalize error logs so developers can triage quickly, and allow safe auto-fix cleanup.
    normalizeLogEntry(entry){
      try{
        const e = entry ? {...entry} : {};
        if(!e.ts) e.ts = Date.now();
        e.action = String(e.action||'');
        e.msg = (e.msg==null) ? '' : String(e.msg);
        e.detail = (e.detail==null) ? '' : String(e.detail);
        // Attach build + route for repeatability.
        try{ e.build = e.build || (window.Config && Config.BUILD) || ''; }catch(_){ }
        try{ e.route = e.route || (window.location && window.location.hash) || ''; }catch(_){ }

        // Enrich fatal APP_ERROR logs.
        if(String(e.action).toUpperCase() === 'APP_ERROR'){
          const stack = String(e.detail||'');
          const top = Store._stackTopLine(stack);
          if(top) e.stackTop = top;
          const loc = Store._parseStackLocation(top || stack);
          if(loc){
            e.file = loc.file;
            e.line = loc.line;
            e.col = loc.col;
          }
          // Stable fingerprint (msg + top stack)
          e.fingerprint = e.fingerprint || Store._hash(`${String(e.msg||'')}` + '|' + `${String(e.stackTop||'')}`);
        }
        return e;
      }catch(_){
        return entry || {};
      }
    },

    // Remove duplicates and clear obviously-resolved errors from older builds.
    // This is intentionally conservative: it only clears errors that are from older builds
    // and match known "stale" patterns (e.g., old script errors after an update).
    autoFixLogs(opts){
      const o = opts || {};
      const currentBuild = (window.Config && Config.BUILD) ? String(Config.BUILD) : '';
      const now = Date.now();

      // When enabled, we clear *known-resolved* errors if the current runtime
      // contains the expected fixes. This helps keep Activity Logs focused on
      // currently reproducible issues.
      const smart = !!o.smartClearResolved;
      const wc = window.WorldClockUtils || {};
      const hasFormatter = typeof wc.formatTimePartsForClock === 'function';
      const hasOffsets = Array.isArray(wc.GMT_OFFSETS_MINUTES) && wc.GMT_OFFSETS_MINUTES.length > 0;
      const stableCut = Number(o.clearResolvedBefore||0) || 0;

      const list = (Store.getLogs()||[]).map(Store.normalizeLogEntry);
      const seen = new Set();
      const out = [];

      for(const e of list){
        if(!e) continue;
        const act = String(e.action||'').toUpperCase();
        const isErr = act === 'APP_ERROR' || act.includes('ERROR') || act.includes('EXCEPTION');

        // Optional: after a successful System Check, callers may request clearing
        // all prior error entries that are older than a reference timestamp.
        // This helps keep Activity Logs focused on currently reproducible issues.
        if(isErr && String(e.action||'').toUpperCase() === 'APP_ERROR' && o && Number.isFinite(Number(o.clearResolvedBefore))){
          const cut = Number(o.clearResolvedBefore);
          if((Number(e.ts)||0) && Number(e.ts) < cut) continue;
        }

        // Smart clear (only if caller supplied a stability cutoff): clear known-resolved
        // World Clock/GMT issues and generic old "Script error." noise.
        if(smart && stableCut && isErr && (Number(e.ts)||0) && Number(e.ts) < stableCut){
          const msgL = String(e.msg||'').toLowerCase();
          const detL = String(e.detail||'').toLowerCase();
          const stackL = String(e.stackTop||'').toLowerCase();

          // If the runtime now has the missing symbols, these prior errors are resolved.
          const resolvedWorldClock = (
            (hasFormatter && (detL.includes('formattimepartsforclock is not defined') || stackL.includes('formattimepartsforclock is not defined')))
            || (hasOffsets && (detL.includes('gmt_offsets_minutes is not defined') || stackL.includes('gmt_offsets_minutes is not defined')))
          );

          // Very generic script errors without a location are not actionable once fixed.
          const genericScriptError = (msgL === 'script error.' || msgL === 'error: script error.') && !e.file && !e.line && !e.stackTop;

          if(resolvedWorldClock || genericScriptError){
            continue;
          }
        }

        // Dedupe identical fingerprints (keep most recent).
        const fp = e.fingerprint || '';
        if(fp && seen.has(fp)) continue;
        if(fp) seen.add(fp);

        // Safe auto-clear: if from older build and the message is a generic/stale one.
        if(isErr && currentBuild && e.build && String(e.build) !== currentBuild){
          const msg = String(e.msg||'').toLowerCase();
          const det = String(e.detail||'').toLowerCase();
          const stale = (
            msg === 'script error.' ||
            msg.includes('unexpected token') ||
            det.includes('unexpected token') ||
            det.includes('formattimepartsforclock is not defined') ||
            det.includes('gmt_offsets_minutes is not defined')
          );
          if(stale && (now - Number(e.ts||now)) > 60 * 1000){
            // Cleared as resolved (older build + known stale pattern)
            continue;
          }
        }

        out.push(e);
      }

      Store.saveLogs(out);
      return out;
    },

    _stackTopLine(stack){
      try{
        const s = String(stack||'');
        const lines = s.split(/\n+/).map(x=>x.trim()).filter(Boolean);
        // Prefer the first "at ..." line.
        const at = lines.find(l=>l.startsWith('at '));
        return at || lines[0] || '';
      }catch(_){ return ''; }
    },
    _parseStackLocation(text){
      try{
        const s = String(text||'');
        // Matches: file:///.../app.js?v=...:593:17
        const m = /(https?:\/\/|file:\/\/\/)[^\s)]+:(\d+):(\d+)/.exec(s);
        if(!m) return null;
        const full = m[0];
        const file = full.replace(/:(\d+):(\d+)$/,'');
        return { file, line:Number(m[2]||0), col:Number(m[3]||0) };
      }catch(_){ return null; }
    },
    _hash(str){
      // Tiny non-crypto hash for fingerprints (stable across sessions).
      const s = String(str||'');
      let h = 2166136261;
      for(let i=0;i<s.length;i++){
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return (h>>>0).toString(16);
    },


    // Reminders (My / Team)
    getMyReminders(userId){
      const all = read(KEYS.my_reminders, []);
      return (all||[]).filter(r => r && String(r.userId)===String(userId))
        .sort((a,b)=> (a.alarmAt||0) - (b.alarmAt||0));
    },
    getAllMyReminders(){
      const all = read(KEYS.my_reminders, []);
      return (all||[]).filter(Boolean);
    },
    addMyReminder(userId, data){
      const all = read(KEYS.my_reminders, []);
      const now = Date.now();
      const r = {
        id: uuid(),
        userId: String(userId),
        short: String((data&&data.short)||'').trim(),
        details: String((data&&data.details)||'').trim(),
        alarmAt: Number((data&&data.alarmAt)||now),
        durationMin: Math.max(1, Number((data&&data.durationMin)||1)),
        repeat: String((data&&data.repeat)||'none'),
        priority: String((data&&data.priority)||'normal'),
        category: String((data&&data.category)||'').trim(),
        repeatDays: (data && Array.isArray(data.repeatDays)) ? data.repeatDays.map(x=>Number(x)).filter(x=>x>=0 && x<=6) : null,
        createdAt: now,
        updatedAt: now,
        closedAt: null,
        snoozeUntil: null,
      };
      all.unshift(r);
      write(KEYS.my_reminders, all);
      return r;
    },
    updateMyReminder(id, patch){
      const all = read(KEYS.my_reminders, []);
      const now = Date.now();
      const out = (all||[]).map(r => (r && String(r.id)===String(id)) ? ({...r, ...(patch||{}), updatedAt: now}) : r);
      write(KEYS.my_reminders, out);
      return out.find(r=>r && String(r.id)===String(id));
    },
    deleteMyReminder(id){
      const all = read(KEYS.my_reminders, []);
      const out = (all||[]).filter(r => r && String(r.id)!==String(id));
      write(KEYS.my_reminders, out);
      return true;
    },

    getTeamReminders(teamId){
      const all = read(KEYS.team_reminders, []);
      return (all||[]).filter(r => r && String(r.teamId)===String(teamId))
        .sort((a,b)=> (a.alarmAt||0) - (b.alarmAt||0));
    },
    getAllTeamReminders(){
      const all = read(KEYS.team_reminders, []);
      return (all||[]).filter(Boolean);
    },
    addTeamReminder(teamId, createdBy, data){
      const all = read(KEYS.team_reminders, []);
      const now = Date.now();
      const r = {
        id: uuid(),
        teamId: String(teamId),
        createdBy: String(createdBy||''),
        short: String((data&&data.short)||'').trim(),
        details: String((data&&data.details)||'').trim(),
        alarmAt: Number((data&&data.alarmAt)||now),
        durationMin: Math.max(1, Number((data&&data.durationMin)||1)),
        repeat: String((data&&data.repeat)||'none'),
        priority: String((data&&data.priority)||'normal'),
        category: String((data&&data.category)||'').trim(),
        repeatDays: (data && Array.isArray(data.repeatDays)) ? data.repeatDays.map(x=>Number(x)).filter(x=>x>=0 && x<=6) : null,
        createdAt: now,
        updatedAt: now,
        perUser: {}, // { userId: { closedAt, snoozeUntil } }
        ackLog: [], // {ts,userId,action,minutes?}
      };
      all.unshift(r);
      write(KEYS.team_reminders, all);
      return r;
    },
    updateTeamReminder(id, patch){
      const all = read(KEYS.team_reminders, []);
      const now = Date.now();
      const out = (all||[]).map(r => (r && String(r.id)===String(id)) ? ({...r, ...(patch||{}), updatedAt: now}) : r);
      write(KEYS.team_reminders, out);
      return out.find(r=>r && String(r.id)===String(id));
    },
    deleteTeamReminder(id){
      const all = read(KEYS.team_reminders, []);
      const out = (all||[]).filter(r => r && String(r.id)!==String(id));
      write(KEYS.team_reminders, out);
      return true;
    },
    closeTeamReminderForUser(id, userId){
      const all = read(KEYS.team_reminders, []);
      const now = Date.now();
      const uid = String(userId);
      const out = (all||[]).map(r=>{
        if(!r || String(r.id)!==String(id)) return r;
        const perUser = {...(r.perUser||{})};
        perUser[uid] = {...(perUser[uid]||{}), closedAt: now, snoozeUntil: null};
        const ackLog = Array.isArray(r.ackLog)? r.ackLog.slice() : [];
        ackLog.push({ ts: now, userId: uid, action: 'close' });
        return {...r, perUser, ackLog, updatedAt: now};
      });
      write(KEYS.team_reminders, out);
      return true;
    },
    snoozeTeamReminderForUser(id, userId, minutes){
      const all = read(KEYS.team_reminders, []);
      const now = Date.now();
      const uid = String(userId);
      const until = now + Math.max(1, Number(minutes||10)) * 60 * 1000;
      const out = (all||[]).map(r=>{
        if(!r || String(r.id)!==String(id)) return r;
        const perUser = {...(r.perUser||{})};
        perUser[uid] = {...(perUser[uid]||{}), snoozeUntil: until, closedAt: null};
        const ackLog = Array.isArray(r.ackLog)? r.ackLog.slice() : [];
        ackLog.push({ ts: now, userId: uid, action: 'snooze', minutes: Math.max(1, Number(minutes||10)) });
        return {...r, perUser, ackLog, updatedAt: now};
      });
      write(KEYS.team_reminders, out);
      return true;
    },

    // Reminder Settings (global / admin configurable)
    getReminderSettings(){
      const s = read(KEYS.reminder_settings, null);
      if(s && typeof s === 'object') return s;
      return { snoozePresets:[5,10,15,30], categories:['Work','Personal','Urgent'], escalationAfterMin:2, maxVisible:3 };
    },
    setReminderSettings(patch){
      const cur = Store.getReminderSettings();
      const next = Object.assign({}, cur, patch||{});
      // sanitize
      if(Array.isArray(next.snoozePresets)){
        next.snoozePresets = next.snoozePresets.map(x=>Math.max(1, Number(x)||0)).filter(Boolean).slice(0,8);
        if(!next.snoozePresets.length) next.snoozePresets = [5,10,15,30];
      }
      if(Array.isArray(next.categories)){
        next.categories = next.categories.map(x=>String(x||'').trim()).filter(Boolean).slice(0,12);
        if(!next.categories.length) next.categories = ['Work','Personal','Urgent'];
      }
      next.escalationAfterMin = Math.max(0, Number(next.escalationAfterMin||0));
      next.maxVisible = Math.max(1, Math.min(10, Number(next.maxVisible||3)));
      write(KEYS.reminder_settings, next);
      return next;
    },
    // Schedule locks (per team + weekStart ISO)
    // Stored as: { "<teamId>|<weekStartISO>": { lockedDays: {"1":true,...}, lockedAt, lockedBy } }
    getLocks(){
      // Primary lock store (cloud-synced)
      let obj = read(KEYS.locks, {});
      obj = (obj && typeof obj === 'object') ? obj : {};

      // One-time migrate legacy key -> new key to avoid "re-lock" regressions
      // when older builds still wrote to ums_schedule_locks.
      try{
        const hasAny = obj && Object.keys(obj).length > 0;
        if(!hasAny && KEYS.locks_legacy){
          const legacy = read(KEYS.locks_legacy, {});
          const legacyOk = legacy && typeof legacy === 'object' && Object.keys(legacy).length > 0;
          if(legacyOk){
            obj = legacy;
            write(KEYS.locks, obj);
            try{ localStorage.removeItem(KEYS.locks_legacy); }catch(_){ }
          }
        }
      }catch(_){ }

      return obj;
    },
    saveLocks(obj){ write(KEYS.locks, obj || {}); },
    getLock(teamId, weekStartISO){
      const key = `${teamId}|${weekStartISO}`;
      const all = Store.getLocks();
      return all[key] || null;
    },
    setLock(teamId, weekStartISO, lockObj){
      const key = `${teamId}|${weekStartISO}`;
      const all = Store.getLocks();
      all[key] = lockObj;
      Store.saveLocks(all);
    },
    clearLock(teamId, weekStartISO){
      const key = `${teamId}|${weekStartISO}`;
      const all = Store.getLocks();
      delete all[key];
      Store.saveLocks(all);
    },

    // Master schedule templates (per team)
    // Stored as: { [teamId]: { updatedAt, frequencyMonths, members: { [userId]: { restWeekdays:[0..6], startISO } } } }
    getMaster(){ return read(KEYS.master, {}); },
    saveMaster(obj){ write(KEYS.master, obj || {}); },
    getTeamMaster(teamId){
      const all = Store.getMaster();
      return all[teamId] || null;
    },
    setTeamMaster(teamId, data){
      const all = Store.getMaster();
      all[teamId] = data;
      Store.saveMaster(all);
    },
    setMasterMember(teamId, userId, patch){
      const all = Store.getMaster();
      if(!all[teamId]) all[teamId] = { updatedAt: Date.now(), frequencyMonths: 1, members: {} };
      if(!all[teamId].members) all[teamId].members = {};
      const prev = all[teamId].members[userId] || { restWeekdays: [], startISO: new Date().toISOString().slice(0,10) };
      all[teamId].members[userId] = Object.assign({}, prev, patch||{});
      all[teamId].updatedAt = Date.now();
      Store.saveMaster(all);
    },
    getMasterMember(teamId, userId){
      const t = Store.getTeamMaster(teamId);
      return (t && t.members && t.members[userId]) ? t.members[userId] : null;
    },

    // Member leave flags (per member per date)
    // Stored as: { [userId]: { [isoDate]: { type: 'SICK'|'EMERGENCY'|'VACATION'|'HOLIDAY', setAt, setBy } } }
    getLeaves(){ return read(KEYS.leaves, {}); },
    saveLeaves(obj){ write(KEYS.leaves, obj || {}); },
    getLeave(userId, isoDate){
      const all = Store.getLeaves();
      return (all[userId] && all[userId][isoDate]) ? all[userId][isoDate] : null;
    },
    setLeave(userId, isoDate, type, meta){
      const all = Store.getLeaves();
      if(!all[userId]) all[userId] = {};
      if(!type){
        delete all[userId][isoDate];
      } else {
        all[userId][isoDate] = Object.assign({ type, setAt: Date.now() }, meta||{});
      }
      Store.saveLeaves(all);
    },

    // Schedule update notifications + acknowledgements (team broadcast)
    // Stored as: [ { id, ts, teamId, weekStartISO, fromId, fromName, title, body, recipients:[userId], acks:{[userId]:ts} } ]
    getNotifs(){
      // Prefer v2 key when present; fall back to legacy v1.
      let list = null;
      if(KEYS.notifs_v2){
        const v2 = read(KEYS.notifs_v2, null);
        if(Array.isArray(v2)) list = v2;
      }
      if(!Array.isArray(list)) list = read(KEYS.notifs, []);

      // One-time migrate v1 -> v2 (best effort) to align with newer builds.
      try{
        if(KEYS.notifs_v2){
          const v1 = read(KEYS.notifs, []);
          const v2 = read(KEYS.notifs_v2, []);
          const v2Ok = Array.isArray(v2) && v2.length;
          const v1Ok = Array.isArray(v1) && v1.length;
          if(!v2Ok && v1Ok){
            write(KEYS.notifs_v2, v1);
          }
        }
      }catch(_){ }

      return Array.isArray(list) ? list : [];
    },
    saveNotifs(list){
      const safe = Array.isArray(list) ? list : [];
      write(KEYS.notifs, safe);
      // Also write v2 for forward compatibility / spec alignment.
      try{ if(KEYS.notifs_v2) write(KEYS.notifs_v2, safe); }catch(_){ }
    },
    addNotif(notif){
      const list = Store.getNotifs();
      const candidate = notif || {};
      const digest = candidate.snapshotDigest ? String(candidate.snapshotDigest) : '';
      if(digest){
        const dup = list.find(n=>n && n.teamId===candidate.teamId && n.weekStartISO===candidate.weekStartISO && String(n.snapshotDigest||'')===digest);
        if(dup) return;
      }
      list.unshift(candidate);
      Store.saveNotifs(list);
    },
    ackNotif(notifId, userId){
      const list = Store.getNotifs();
      const n = list.find(x=>x && x.id===notifId);
      if(!n) return;
      if(!n.acks) n.acks = {};
      if(!n.acks[userId]) n.acks[userId] = Date.now();
      Store.saveNotifs(list);
    },
    getTeamNotifs(teamId){
      return Store.getNotifs().filter(n=>n && n.teamId===teamId);
    },

    // Attendance (stored locally; retained for 12 months)
    getAttendance(){
      const list = read(KEYS.attendance, []);
      return Array.isArray(list) ? list : [];
    },
    saveAttendance(list){
      const keepMs = 366 * 24 * 60 * 60 * 1000;
      const cutoff = Date.now() - keepMs;
      const cleaned = (Array.isArray(list)?list:[])
        .filter(r => r && r.ts && r.ts >= cutoff)
        .slice(0, 5000);
      write(KEYS.attendance, cleaned);
      return true;
    },
    addAttendance(record){
      const r = record || {};
      const rec = {
        id: String(r.id || ('att_' + Math.random().toString(16).slice(2) + '_' + Date.now())),
        ts: Number(r.ts || Date.now()),
        shiftKey: String(r.shiftKey || ''),
        eventType: String(r.eventType || 'ATTENDANCE'),
        userId: String(r.userId || ''),
        username: String(r.username || ''),
        name: String(r.name || ''),
        teamId: String(r.teamId || ''),
        teamLabel: String(r.teamLabel || ''),
        mode: String(r.mode || ''), // OFFICE | WFH
        reason: String(r.reason || ''),
        scheduledEndTs: Number(r.scheduledEndTs || 0),
        overtimeMinutes: Number(r.overtimeMinutes || 0)
      };
      if(!rec.userId || !rec.shiftKey || !rec.mode) return false;
      const list = Store.getAttendance();
      // prevent duplicates per userId+shiftKey+eventType
      const exists = list.find(x=>x && x.userId===rec.userId && x.shiftKey===rec.shiftKey && String(x.eventType||'ATTENDANCE')===rec.eventType);
      if(exists) return true;
      list.unshift(rec);
      return Store.saveAttendance(list);
    },
    getUserAttendance(userId){
      const uid = String(userId||'');
      return Store.getAttendance().filter(r=>r && r.userId===uid);
    },
    hasAttendance(userId, shiftKey){
      const uid = String(userId||'');
      const sk = String(shiftKey||'');
      if(!uid || !sk) return false;
      return !!Store.getAttendance().find(r=>r && r.userId===uid && r.shiftKey===sk && String(r.eventType||'ATTENDANCE')==='ATTENDANCE');
    },
    hasOvertimeConfirmation(userId, shiftKey){
      const uid = String(userId||'');
      const sk = String(shiftKey||'');
      if(!uid || !sk) return false;
      return !!Store.getAttendance().find(r=>r && r.userId===uid && r.shiftKey===sk && String(r.eventType||'')==='OVERTIME_CONFIRMATION');
    },
    getWeeklyOvertimeMinutes(userId, refTs){
      const uid = String(userId||'');
      if(!uid) return 0;
      const endTs = Number(refTs||Date.now());
      const startTs = endTs - (7 * 24 * 60 * 60 * 1000);
      let total = 0;
      const list = Store.getAttendance();
      for(const r of list){
        if(!r || r.userId !== uid) continue;
        if(String(r.eventType||'') !== 'OVERTIME_CONFIRMATION') continue;
        const ts = Number(r.ts||0);
        if(ts < startTs || ts > endTs) continue;
        total += Math.max(0, Number(r.overtimeMinutes||0));
      }
      return total;
    },



    // Team Configuration (Schedule + Tasks + Coverage Meter)
    _defaultTeamTasks(){
      try{
        const Config = window.Config;
        const ids = ['mailbox_manager','back_office','call_onqueue','call_available','lunch','mailbox_call','block'];
        const colorMap = {
          mailbox_manager:'#4aa3ff',
          back_office:'#ff9f1c',
          call_onqueue:'#2ecc71',
          call_available:'#2ecc71',
          lunch:'#22d3ee',
          mailbox_call:'#00c853',
          block:'#ff6b6b'
        };
        return ids.map(id=>{
          const s = Config && Config.scheduleById ? Config.scheduleById(id) : null;
          return { id, label: (s && s.label) ? s.label : id, color: colorMap[id] || '#64748b' };
        });
      }catch(_){
        return [
          { id:'mailbox_manager', label:'Mailbox Manager', color:'#4aa3ff' },
          { id:'back_office', label:'Back Office', color:'#ff9f1c' },
          { id:'call_onqueue', label:'Call Available', color:'#2ecc71' },
          { id:'lunch', label:'Lunch', color:'#22d3ee' },
          { id:'block', label:'Block', color:'#ff6b6b' },
        ];
      }
    },
    getTeamConfig(teamId){
      const all = read(KEYS.team_config, {});
      const cfg = (all && all[teamId]) ? all[teamId] : {};
      const team = (window.Config && Config.teamById) ? Config.teamById(teamId) : { teamStart:'06:00', teamEnd:'15:00' };
      const schedule = cfg.schedule || {};
      const tasks = Array.isArray(cfg.tasks) && cfg.tasks.length ? cfg.tasks : Store._defaultTeamTasks();
      const coverageTaskId = cfg.coverageTaskId || 'call_onqueue';
      return {
        teamId,
        schedule: {
          start: schedule.start || team.teamStart || '06:00',
          end: schedule.end || team.teamEnd || '15:00'
        },
        tasks,
        coverageTaskId,
        wfhReasons: Array.isArray(cfg.wfhReasons) && cfg.wfhReasons.length ? cfg.wfhReasons.map(x=>String(x||'').trim()).filter(Boolean).slice(0, 30) : ['Health','Internet Issue','Family Emergency','Weather','Other'],
        mailboxBuckets: Array.isArray(cfg.mailboxBuckets) ? cfg.mailboxBuckets.map((b,i)=>({
          id: String(b && b.id ? b.id : ('b'+i)),
          start: String(b && b.start ? b.start : '00:00'),
          end: String(b && b.end ? b.end : '00:00')
        })) : []
      };
    },
    setTeamSchedule(teamId, start, end){
      const all = read(KEYS.team_config, {});
      all[teamId] = all[teamId] || {};
      all[teamId].schedule = { start, end };
      write(KEYS.team_config, all);
      return true;
    },
    setTeamTasks(teamId, tasks){
      const all = read(KEYS.team_config, {});
      all[teamId] = all[teamId] || {};
      all[teamId].tasks = Array.isArray(tasks) ? tasks : [];
      write(KEYS.team_config, all);
      return true;
    },
    setTeamCoverageTask(teamId, taskId){
      const all = read(KEYS.team_config, {});
      all[teamId] = all[teamId] || {};
      all[teamId].coverageTaskId = String(taskId||'');
      write(KEYS.team_config, all);
      return true;
    },
    getTeamWFHReasons(teamId){
      const cfg = Store.getTeamConfig(teamId);
      return Array.isArray(cfg.wfhReasons) ? cfg.wfhReasons.slice() : ['Other'];
    },
    setTeamWFHReasons(teamId, reasons){
      const all = read(KEYS.team_config, {});
      all[teamId] = all[teamId] || {};
      const out = (Array.isArray(reasons) ? reasons : [])
        .map(x=>String(x||'').trim())
        .filter(Boolean)
        .slice(0, 30);
      all[teamId].wfhReasons = out.length ? out : ['Other'];
      write(KEYS.team_config, all);
      return true;
    },


    getTeamMailboxBuckets(teamId){
      const cfg = Store.getTeamConfig(teamId);
      return Array.isArray(cfg.mailboxBuckets) ? cfg.mailboxBuckets.slice() : [];
    },
    setTeamMailboxBuckets(teamId, buckets){
      const all = read(KEYS.team_config, {});
      all[teamId] = all[teamId] || {};
      const out = (Array.isArray(buckets) ? buckets : []).map((b,i)=>({
        id: String(b && b.id ? b.id : ('b'+i)),
        start: String(b && b.start ? b.start : '00:00'),
        end: String(b && b.end ? b.end : '00:00')
      })).slice(0, 12);
      all[teamId].mailboxBuckets = out;
      write(KEYS.team_config, all);
      return true;
    },

    getTeamTasks(teamId){
      return Store.getTeamConfig(teamId).tasks || [];
    },
    getTeamTaskColor(teamId, taskId){
      const tasks = Store.getTeamTasks(teamId);
      const t = tasks.find(x=>x && x.id===taskId);
      return t && t.color ? t.color : null;
    },

    // Audit trail (per week)
    getAudit(){
      const list = read(KEYS.audit, []);
      return Array.isArray(list) ? list : [];
    },
    saveAudit(list){ write(KEYS.audit, Array.isArray(list)?list:[]); },
    addAudit(entry){
      const list = Store.getAudit();
      list.unshift(entry);
      // keep last 2000 entries
      if(list.length > 2000) list.length = 2000;
      Store.saveAudit(list);
    },
    getWeekAudit(teamId, weekStartISO){
      return Store.getAudit().filter(a=>a && a.teamId===teamId && a.weekStartISO===weekStartISO);
    },


    // Mailbox time override (Super Admin testing)
    // Stored on this device. Scope can be:
    // - sa_only: applies only to SUPER_ADMIN sessions
    // - global: applies to all sessions (entire users affected on this device)
    getMailboxTimeOverride(){
      const def = { enabled:false, ms:0, freeze:true, setAt:0, scope:'sa_only' };
      const normalize = (raw, fallbackScope)=>{
        if(!raw || typeof raw !== 'object') return null;
        const out = Object.assign({}, def, raw);
        out.enabled = !!out.enabled;
        out.ms = Number(out.ms)||0;
        out.freeze = (out.freeze !== false);
        out.setAt = Number(out.setAt)||0;
        const scope = String(out.scope || fallbackScope || 'sa_only');
        out.scope = (scope === 'global') ? 'global' : 'sa_only';
        return out;
      };

      // Cloud-global override (across devices/browsers) takes precedence.
      const c = normalize(read(KEYS.mailbox_time_override_cloud, null), 'global');
      if (c && c.enabled && c.scope === 'global') return c;

      const o = normalize(read(KEYS.mailbox_time_override, null), 'sa_only');
      return o || def;
    },
    saveMailboxTimeOverride(next, opts){
      const cur = Store.getMailboxTimeOverride();
      const o = Object.assign({}, cur, (next||{}));
      o.enabled = !!o.enabled;
      o.ms = Number(o.ms)||0;
      o.freeze = (o.freeze !== false);
      o.scope = (String(o.scope||'sa_only') === 'global') ? 'global' : 'sa_only';
      // Anchor start time so running mode can advance deterministically.
      const prevEnabled = !!cur.enabled;
      const prevFreeze = (cur.freeze !== false);
      const prevMs = Number(cur.ms)||0;
      const nextHasMs = (next && Object.prototype.hasOwnProperty.call(next,'ms'));
      const nextHasFreeze = (next && Object.prototype.hasOwnProperty.call(next,'freeze'));
      const msChanged = nextHasMs && (o.ms !== prevMs);
      const modeChangedToRun = nextHasFreeze && (o.freeze === false) && (prevFreeze !== false);
      if(o.enabled && o.ms>0){
        if(o.freeze){
          // Freeze mode does not need an anchor.
          o.setAt = 0;
        }else{
          // Running mode: keep anchor stable unless we changed the base time or just enabled/switch modes.
          if(!prevEnabled || msChanged || modeChangedToRun || !o.setAt){
            o.setAt = Date.now();
          }else{
            o.setAt = Number(o.setAt)||Date.now();
          }
        }
      }else{
        o.setAt = 0;
      }
      write(KEYS.mailbox_time_override, o, opts);

      // If user set Global scope, propagate to cloud so other devices/browsers are affected.
      // This requires Supabase env and an authenticated session.
      // ===== CODE UNTOUCHABLES =====
      // For global scope, override_iso MUST be sent as an ISO string derived from the base ms timestamp.
      // Do NOT revert to offset-based (Date.now()+ms) behavior.
      // Exception: Only change if required by documented time override semantics.
      // ==============================
      if (o.scope === 'global') {
        write(KEYS.mailbox_time_override_cloud, o, opts);
        const payload = {
          scope: 'global',
          enabled: !!o.enabled,
          freeze: !!o.freeze,
          override_iso: new Date(Number(o.ms) || Date.now()).toISOString(),
        };
        const getToken = ()=>{
          try{
            const t = (window.CloudAuth && CloudAuth.accessToken) ? String(CloudAuth.accessToken()||'').trim() : '';
            if(t) return t;
          }catch(_){ }
          try{
            const sess = (window.CloudAuth && CloudAuth.loadSession) ? CloudAuth.loadSession() : null;
            const t2 = sess && (sess.access_token || (sess.session && sess.session.access_token)) ? String(sess.access_token || (sess.session && sess.session.access_token) || '').trim() : '';
            return t2 || '';
          }catch(_){ return ''; }
        };
        const sendToCloud = (token)=>{
          if(!token) return false;
          fetch('/api/mailbox_override/set', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(payload)
          }).catch(() => {});
          return true;
        };
        const queuePending = ()=>{
          try{ window.__mumsMailboxOverridePending = payload; }catch(_){ }
          try{
            if(!window.__mumsMailboxOverridePendingListener){
              window.__mumsMailboxOverridePendingListener = true;
              window.addEventListener('mums:authtoken', ()=>{
                try{
                  const pending = window.__mumsMailboxOverridePending;
                  if(!pending) return;
                  const t = getToken();
                  if(sendToCloud(t)) window.__mumsMailboxOverridePending = null;
                }catch(_){ }
              });
            }
          }catch(_){ }
        };
        if (window.CloudAuth && CloudAuth.isEnabled && CloudAuth.isEnabled()) {
          const token = getToken();
          if(!sendToCloud(token)){
            queuePending();
            try{
              if(window.CloudAuth && CloudAuth.ensureFreshSession){
                CloudAuth.ensureFreshSession({ tryRefresh:true, clearOnFail:false, leewaySec: 60 })
                  .then(()=>{ try{ const fresh = getToken(); if(sendToCloud(fresh)) window.__mumsMailboxOverridePending = null; }catch(_){ } });
              }
            }catch(_){ }
          }
        } else {
          queuePending();
        }
      }

      return o;
    },

    // Disable / reset mailbox time override (device + cloud) safely.
    // - Clears local and cloud override keys to prevent stale override values from persisting.
    // - Best-effort propagates a global reset to the backend when CloudAuth is available.
    // - Dispatches mums:store events so Mailbox UI re-renders immediately.
    disableMailboxTimeOverride(opts){
      try{
        const curLocal = (function(){
          try{ const raw = localStorage.getItem(KEYS.mailbox_time_override); return raw ? JSON.parse(raw) : null; }catch(_){ return null; }
        })();
        const curCloud = (function(){
          try{ const raw = localStorage.getItem(KEYS.mailbox_time_override_cloud); return raw ? JSON.parse(raw) : null; }catch(_){ return null; }
        })();

        const shouldPropagateGlobal = !!(
          (opts && opts.propagateGlobal) ||
          (curCloud && curCloud.enabled && String(curCloud.scope||'') === 'global') ||
          (curLocal && curLocal.enabled && String(curLocal.scope||'') === 'global')
        );

        // Clear local + cloud storage keys to eliminate stale overrides.
        try{ localStorage.removeItem(KEYS.mailbox_time_override); }catch(_){ }
        try{ localStorage.removeItem(KEYS.mailbox_time_override_cloud); }catch(_){ }

        // Notify same-tab UI listeners.
        try{ window.dispatchEvent(new CustomEvent('mums:store', { detail:{ key:'mailbox_time_override', source:'local', reason:'disable' } })); }catch(_){ }
        try{ window.dispatchEvent(new CustomEvent('mums:store', { detail:{ key:'mailbox_override_cloud', source:'local', reason:'disable' } })); }catch(_){ }

        // Best-effort backend propagation (global scope reset) so other devices do not re-sync stale override.
        if(shouldPropagateGlobal && window.CloudAuth && CloudAuth.isEnabled && CloudAuth.isEnabled()){
          let token = '';
          try{ token = (CloudAuth.accessToken && CloudAuth.accessToken()) ? String(CloudAuth.accessToken()||'').trim() : ''; }catch(_){ token=''; }
          if(!token){
            try{
              const sess = CloudAuth.loadSession ? CloudAuth.loadSession() : null;
              token = sess && (sess.access_token || (sess.session && sess.session.access_token)) ? String(sess.access_token || (sess.session && sess.session.access_token) || '').trim() : '';
            }catch(_){ token=''; }
          }
          if(token){
            fetch('/api/mailbox_override/set', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                scope: 'global',
                enabled: false,
                freeze: true
              })
            }).catch(() => {});
          }
        }

        // Force a sync poll so cloud key stays consistent after reset.
        try{ if(window.Store && Store.startMailboxOverrideSync) Store.startMailboxOverrideSync({ force:true }); }catch(_){ }

        return true;
      }catch(_){
        return false;
      }
    },

    // Mailbox Counter tables (per shift)
    getMailboxState(){
      const def = { currentKey:'', previousKey:'', lastChangeAt:0, lastOkTs:0 };
      const d = read(KEYS.mailbox_state, null);
      if(!d || typeof d !== 'object') return def;
      const o = Object.assign({}, def, d);
      o.currentKey = String(o.currentKey||'');
      o.previousKey = String(o.previousKey||'');
      o.lastChangeAt = Number(o.lastChangeAt)||0;
      o.lastOkTs = Number(o.lastOkTs)||0;
      return o;
    },
    saveMailboxState(next, opts){
      const cur = Store.getMailboxState();
      const o = Object.assign({}, cur, (next||{}));
      o.currentKey = String(o.currentKey||'');
      o.previousKey = String(o.previousKey||'');
      o.lastChangeAt = Number(o.lastChangeAt)||0;
      o.lastOkTs = Number(o.lastOkTs)||0;
      write(KEYS.mailbox_state, o, opts);
      return o;
    },
    getMailboxTables(){
      const o = read(KEYS.mailbox_tables, {});
      return (o && typeof o === 'object') ? Object.assign({}, o) : {};
    },
    saveMailboxTables(obj, opts){
      const o = (obj && typeof obj === 'object') ? obj : {};
      write(KEYS.mailbox_tables, o, opts);
      return true;
    },
    getMailboxTable(shiftKey){
      const k = String(shiftKey||'');
      const all = Store.getMailboxTables();
      return all[k] || null;
    },
    saveMailboxTable(shiftKey, table, opts){
      const k = String(shiftKey||'');
      if(!k) return null;
      const all = Store.getMailboxTables();
      all[k] = table;
      // Keep at most 20 tables to avoid unbounded growth.
      const keys = Object.keys(all);
      if(keys.length > 20){
        keys.sort((a,b)=>{
          const ta = Number(all[a]?.meta?.createdAt)||0;
          const tb = Number(all[b]?.meta?.createdAt)||0;
          return tb - ta;
        });
        for(const kk of keys.slice(20)){
          delete all[kk];
        }
      }
      Store.saveMailboxTables(all, opts);
      return table;
    },

    factoryReset(){
      localStorage.removeItem(KEYS.users);
      localStorage.removeItem(KEYS.users_backup);
      localStorage.removeItem(KEYS.session);
      localStorage.removeItem(KEYS.announcements);
      localStorage.removeItem(KEYS.cases);
      localStorage.removeItem(KEYS.rr);
      localStorage.removeItem(KEYS.weekly);
      localStorage.removeItem(KEYS.auto);
      localStorage.removeItem(KEYS.logs);
      localStorage.removeItem(KEYS.locks);
      localStorage.removeItem(KEYS.master);
      localStorage.removeItem(KEYS.leaves);
      localStorage.removeItem(KEYS.notifs);
      localStorage.removeItem(KEYS.audit);
      localStorage.removeItem(KEYS.profile);
      localStorage.removeItem(KEYS.theme);
      localStorage.removeItem(KEYS.quicklinks);
      localStorage.removeItem(KEYS.my_reminders);
      localStorage.removeItem(KEYS.team_reminders);
      localStorage.removeItem(KEYS.reminder_settings);
      localStorage.removeItem(KEYS.mailbox_time_override);
      localStorage.removeItem(KEYS.mailbox_time_override_cloud);
      Store.ensureSeed();
    }
  };


  // --- Central UI state + reducer-style dispatch (recommended) ---
  // This avoids scattered UI updates and makes the app less crash-prone.
  const _subs = [];
  const _ui = { theme: null, worldClocks: null, quickLinks: null };

  function _syncUIState(){
    try{ _ui.theme = Store.getTheme ? Store.getTheme() : 'ocean'; }catch(_){ _ui.theme = 'ocean'; }
    try{ _ui.worldClocks = Store.getWorldClocks ? Store.getWorldClocks() : []; }catch(_){ _ui.worldClocks = []; }
    try{ _ui.quickLinks = Store.getQuickLinks ? Store.getQuickLinks() : []; }catch(_){ _ui.quickLinks = []; }
  }
  _syncUIState();

  // Unified state snapshot (UI-only).
  Store.getState = function(){
    _syncUIState();
    return {
      theme: _ui.theme,
      worldClocks: Array.isArray(_ui.worldClocks) ? _ui.worldClocks.slice() : _ui.worldClocks,
      quickLinks: Array.isArray(_ui.quickLinks) ? _ui.quickLinks.slice() : _ui.quickLinks,
      session: Store.getSession ? Store.getSession() : null,
    };
  };

  // Subscribe to reducer-style dispatch.
  Store.subscribe = function(fn){
    if(typeof fn !== 'function') return function(){};
    _subs.push(fn);
    return function(){
      const i = _subs.indexOf(fn);
      if(i >= 0) _subs.splice(i, 1);
    };
  };

  function _emitDispatch(action, payload){
    try{
      window.dispatchEvent(new CustomEvent('mums:dispatch', { detail: { action: action, payload: payload } }));
    }catch(_){ }
    // Call subscribers (safe)
    const snap = Store.getState();
    for(const fn of _subs.slice()){
      try{ fn(action, payload, snap); }catch(_){ }
    }
  }

  // Central reducer-style dispatcher.
  // Examples:
  //   Store.dispatch('UPDATE_THEME', {id:'aurora_light'})
  //   Store.dispatch('UPDATE_CLOCKS', clocksArray)
  Store.dispatch = function(action, payload){
    const type = String(action||'').trim().toUpperCase();
    try{
      if(type === 'UPDATE_THEME'){
        const id = (payload && payload.id) ? payload.id : payload;
        Store.setTheme(id);
      }else if(type === 'UPDATE_CLOCKS'){
        const list = (payload && payload.clocks) ? payload.clocks : payload;
        Store.saveWorldClocks(list);
      }else if(type === 'UPDATE_QUICKLINKS'){
        const list = (payload && payload.links) ? payload.links : payload;
        Store.saveQuickLinks(list);
      }else{
        console.warn('Store.dispatch: unknown action', action);
      }
    }catch(e){
      console.error('Store.dispatch error', e);
    }

    _syncUIState();
    _emitDispatch(type || action, payload);
  };

  // ===============================
  // Online presence (best-effort, offline-first)
  // - Uses localStorage + TTL to approximate "online" users across tabs.
  // - Not a real network presence. Suitable for on-device dashboards.
  // ===============================
  const PRESENCE_TTL_MS = 90 * 1000; // 90s freshness window

  function _readOnlineMap(){
    const obj = read(KEYS.online, {});
    return (obj && typeof obj === 'object') ? obj : {};
  }

  function _writeOnlineMap(map){
    write(KEYS.online, map);
  }

  function _compactOnlineMap(map){
    const now = Date.now();
    const out = {};
    Object.keys(map||{}).forEach(uid=>{
      const r = map[uid];
      if(!r || !r.lastSeen) return;
      if((now - Number(r.lastSeen)) <= PRESENCE_TTL_MS) out[uid] = r;
    });
    return out;
  }

  Store.setOnline = function(user, extra){
    try{
      if(!user || !user.id) return;
      const uid = String(user.id);
      const map = _readOnlineMap();
      const profile = (Store.getProfile ? Store.getProfile(uid) : null) || {};
      const rec = Object.assign({}, map[uid]||{}, {
        userId: uid,
        name: String(user.name || profile.name || profile.fullName || user.username || 'User'),
        username: String(user.username || ''),
        teamId: String(user.teamId || ''),
        role: String(user.role || ''),
        // Prefer explicit profile photo; store a tiny reference so UI can render avatars quickly.
        photo: profile.photo || profile.avatar || profile.photoDataUrl || '',
        lastSeen: Date.now(),
      }, extra||{});
      map[uid] = rec;
      _writeOnlineMap(_compactOnlineMap(map));
    }catch(e){ /* no-op */ }
  };

  Store.setOffline = function(userId){
    try{
      const uid = String(userId||'');
      if(!uid) return;
      const map = _readOnlineMap();
      if(map && map[uid]){
        delete map[uid];
        _writeOnlineMap(_compactOnlineMap(map));
      }
    }catch(e){ }
  };

  Store.getOnlineUsers = function(){
    try{
      const map = _compactOnlineMap(_readOnlineMap());
      const arr = Object.values(map);
      // Stable sort (team, then name)
      arr.sort((a,b)=>{
        const ta = String(a.teamId||'');
        const tb = String(b.teamId||'');
        if(ta!==tb) return ta.localeCompare(tb);
        return String(a.name||'').localeCompare(String(b.name||''));
      });
      return arr;
    }catch(e){ return []; }
  };

  // Starts a heartbeat for the current tab (call once after login)
  Store.startPresence = function(user){
    try{
      if(!user || !user.id) return;
      // Single tab heartbeat guard
      if(window.__mumsPresenceTimer) return;
      const uid = String(user.id);
      const update = ()=>{
        try{
          // Attach today's attendance mode for badge colors (OFFICE/WFH)
          let mode = '';
          try{
            const att = Store.getAttendance ? Store.getAttendance() : [];
            const last = (Array.isArray(att)?att:[]).find(r=>r && r.userId===uid);
            if(last && last.mode) mode = String(last.mode);
          }catch(_){ }
          Store.setOnline(user, { mode });
        }catch(_){ }
      };
      update();
      window.__mumsPresenceTimer = setInterval(update, 15000);

      // Best-effort cleanup on tab close
      window.addEventListener('beforeunload', ()=>{ try{ Store.setOffline(uid); }catch(_){ } });
    }catch(e){ }
  };

// Cloud-global mailbox override sync (cross-device). Polls the Vercel API (which reads Supabase).
// ===== CODE UNTOUCHABLES =====
// - MUST poll /api/mailbox_override/get?scope=global and accept { ok:true, override:{...} }.
// - MUST include Authorization bearer token so backend can enforce scope permissions.
// - MUST write returned override to KEYS.mailbox_time_override_cloud AND dispatch mums:store with key 'mailbox_override_cloud'.
// - MUST persist override in localStorage (cloud key) so other tabs reflect changes.
// - MUST gracefully handle malformed payloads by falling back to system Manila time (client-side).
// Exception: Only change if required by documented API contract changes.
// ==============================
Store.startMailboxOverrideSync = function(opts){
  try{
    // Singleton state
    if(!window.__mumsMailboxOverrideSync){
      window.__mumsMailboxOverrideSync = { timer:null, inflight:false, lastOkAt:0, lastErrAt:0, poll:null };
    }
    const S = window.__mumsMailboxOverrideSync;

    // Cross-tab sync: when override state changes in another tab, refresh UI and re-poll immediately.
    // ===== CODE UNTOUCHABLES =====
    // Storage events are the only reliable cross-tab signal. Do NOT remove this listener.
    // Exception: Only change if required by documented platform behavior changes.
    // ==============================
    try{
      if(!window.__mumsMailboxOverrideStorageListener){
        window.__mumsMailboxOverrideStorageListener = true;
        window.addEventListener('storage', (e)=>{
          try{
            if(!e || e.storageArea !== localStorage) return;
            const k = String(e.key||'');
            if(k === KEYS.mailbox_time_override_cloud || k === KEYS.mailbox_time_override){
              try{ window.dispatchEvent(new CustomEvent('mums:store', { detail:{ key:'mailbox_override_cloud', source:'storage' } })); }catch(_){ }
              try{ if(window.Store && Store.startMailboxOverrideSync) Store.startMailboxOverrideSync({ force:true }); }catch(_){ }
            }
          }catch(_){ }
        });
      }
    }catch(_){ }

    const getToken = ()=>{
      try{
        const t = (CloudAuth.accessToken && CloudAuth.accessToken()) ? String(CloudAuth.accessToken()||'').trim() : '';
        if(t) return t;
      }catch(_){ }
      try{
        const sess = CloudAuth.loadSession ? CloudAuth.loadSession() : null;
        const t2 = sess && (sess.access_token || (sess.session && sess.session.access_token)) ? String(sess.access_token || (sess.session && sess.session.access_token) || '').trim() : '';
        return t2 || '';
      }catch(_){ return ''; }
    };

    const normalize = (o)=>{
      const def = { enabled:false, ms:0, freeze:true, setAt:0, scope:'global' };
      if(!o || typeof o !== 'object') return def;
      const out = Object.assign({}, def, o);
      out.scope = (String(out.scope||'global').toLowerCase() === 'superadmin') ? 'superadmin' : 'global';
      out.enabled = !!out.enabled;
      out.freeze = (out.freeze !== false);
      out.ms = Number(out.ms);
      out.setAt = Number(out.setAt)||0;
      if(!Number.isFinite(out.ms) || out.ms <= 0){
        out.enabled = false;
        out.ms = 0;
        out.setAt = 0;
      }
      // Running mode needs a sane anchor.
      if(out.enabled && out.freeze === false){
        if(!Number.isFinite(out.setAt) || out.setAt <= 0) out.setAt = Date.now();
      }else{
        out.setAt = 0;
      }
      return out;
    };

    const poll = async (reason)=>{
      if(S.inflight) return;
      S.inflight = true;
      try{
        if(!window.CloudAuth || !CloudAuth.isEnabled || !CloudAuth.isEnabled()) return;
        const token = getToken();
        if(!token) return;

        const res = await fetch('/api/mailbox_override/get?scope=global', {
          method:'GET',
          cache:'no-store',
          headers: { 'Authorization': `Bearer ${token}` }
        });

        // Parse safely (may not be JSON in edge/WAF failures)
        const raw = await res.text();
        let json = null;
        try{ json = raw ? JSON.parse(raw) : null; }catch(_){ json = null; }

        if(res.ok && json && json.ok && json.override){
          const norm = normalize(json.override);

          // Persist across tabs
          write(KEYS.mailbox_time_override_cloud, norm);

          // Dispatch a stable key for UI listeners (avoid tying UI to storage key names)
          try{ window.dispatchEvent(new CustomEvent('mums:store', { detail:{ key:'mailbox_override_cloud', source:'cloud', reason:String(reason||'') } })); }catch(_){ }

          S.lastOkAt = Date.now();
        } else {
          // On auth failures, do not spam; mark error timestamp.
          S.lastErrAt = Date.now();
          // If server indicates override disabled explicitly, still persist to clear stale UI.
          if(json && json.ok && json.override){
            const norm = normalize(json.override);
            write(KEYS.mailbox_time_override_cloud, norm);
            try{ window.dispatchEvent(new CustomEvent('mums:store', { detail:{ key:'mailbox_override_cloud', source:'cloud', reason:'clear' } })); }catch(_){ }
          }
        }
      }catch(_){
        S.lastErrAt = Date.now();
      }finally{
        S.inflight = false;
      }
    };

    S.poll = poll;

    // Start timer once
    if(!S.timer){
      poll('start');
      S.timer = setInterval(()=>{ poll('interval'); }, 5000);
    }

    // Ensure we retry once auth/session is ready.
    try{
      if(!window.__mumsMailboxOverrideAuthListener){
        window.__mumsMailboxOverrideAuthListener = true;
        window.addEventListener('mums:auth', ()=>{ try{ poll('auth'); }catch(_){ } });
        window.addEventListener('mums:authtoken', ()=>{ try{ poll('authtoken'); }catch(_){ } });
      }
    }catch(_){ }

    // Force an immediate poll when requested
    if(opts && opts.force){
      poll('force');
    }
  }catch(_){ }
};


  // Data tools (offline)
  Store.exportAllData = function(){
    const out = { version: 1, exportedAt: new Date().toISOString(), items: {} };
    try{
      for(let i=0;i<localStorage.length;i++){
        const k = localStorage.key(i);
        if(!k) continue;
        if(k.startsWith('ums_') || k.startsWith('mums_')){
          out.items[k] = localStorage.getItem(k);
        }
      }
    }catch(e){
      console.error('exportAllData error', e);
    }
    return out;
  };

  Store.importAllData = function(payload){
    try{
      if(!payload || typeof payload !== 'object') throw new Error('Invalid payload');
      const items = payload.items || {};
      Object.keys(items).forEach((k)=>{
        if(!(k.startsWith('ums_') || k.startsWith('mums_'))) return;
        const v = items[k];
        if(typeof v === 'string') localStorage.setItem(k, v);
      });
      _syncUIState();
      try{ window.dispatchEvent(new CustomEvent('mums:store', { detail: { key:'*', source:'import' } })); }catch(e){}
      return { ok:true };
    }catch(e){
      console.error('importAllData error', e);
      return { ok:false, error: String(e && e.message || e) };
    }
  };

  Store.healthCheck = function(){
    const report = { ok:true, keysChecked:0, errors:[], sizeBytes:0 };
    try{
      // estimate size and validate json for known keys
      for(let i=0;i<localStorage.length;i++){
        const k = localStorage.key(i);
        if(!k) continue;
        const v = localStorage.getItem(k) || '';
        report.sizeBytes += (k.length + v.length) * 2;
        if(!(k.startsWith('ums_') || k.startsWith('mums_'))) continue;
        report.keysChecked++;
        // only validate JSON-looking payloads
        const t = v.trim();
        if(t.startsWith('{') || t.startsWith('[')){
          try{ JSON.parse(t); }catch(e){ report.ok=false; report.errors.push({key:k, error:'Invalid JSON'}); }
        }
      }
    }catch(e){
      report.ok=false;
      report.errors.push({key:'(storage)', error:String(e && e.message || e)});
    }
    return report;
  };

  // ------------------------------------------------------------
  // Privileges / Commands
  // ------------------------------------------------------------
  Store.getRoleSettingsFeatures = function(){
    // Which Settings cards are visible per role. Default: Members see only basics.
    const def = {
      SUPER_ADMIN: { profile:true, sound:true, theme:true, quicklinks:true, worldclocks:true, cursor:true, sidebar:true, datatools:true },
      SUPER_USER:  { profile:true, sound:true, theme:true, quicklinks:true, worldclocks:true, cursor:true, sidebar:true, datatools:true },
      ADMIN:       { profile:true, sound:true, theme:true, quicklinks:true, worldclocks:true, cursor:true, sidebar:true, datatools:true },
      TEAM_LEAD:   { profile:true, sound:true, theme:true, quicklinks:true, worldclocks:true, cursor:true, sidebar:true, datatools:true },
      MEMBER:      { profile:true, sound:true, theme:true, quicklinks:true, worldclocks:true, cursor:true, sidebar:true, datatools:false },
    };
    try{
      const raw = localStorage.getItem(KEYS.role_settings_features);
      const obj = raw ? JSON.parse(raw) : null;
      if(!obj || typeof obj !== 'object') return def;
      // merge with defaults for forward-compat
      const out = {};
      Object.keys(def).forEach(r=> out[r] = Object.assign({}, def[r], obj[r]||{}));
      return out;
    }catch(e){ return def; }
  };

  Store.setRoleSettingsFeatures = function(obj){
    try{ localStorage.setItem(KEYS.role_settings_features, JSON.stringify(obj||{})); }catch(_){}
  };

  Store.getRolePermOverrides = function(){
    try{
      const raw = localStorage.getItem(KEYS.role_perm_overrides);
      const obj = raw ? JSON.parse(raw) : null;
      return (obj && typeof obj === 'object') ? obj : {};
    }catch(e){ return {}; }
  };

  Store.setRolePermOverride = function(role, perm, value){
    const all = Store.getRolePermOverrides();
    all[role] = all[role] || {};
    all[role][perm] = value;
    try{ localStorage.setItem(KEYS.role_perm_overrides, JSON.stringify(all)); }catch(_){}
  };

  Store.getUserExtraPrivsMap = function(){
    try{
      const raw = localStorage.getItem(KEYS.user_extra_privs);
      const obj = raw ? JSON.parse(raw) : null;
      return (obj && typeof obj === 'object') ? obj : {};
    }catch(e){ return {}; }
  };

  Store.getUserExtraPrivs = function(userId){
    const map = Store.getUserExtraPrivsMap();
    const arr = map[userId];
    return Array.isArray(arr) ? arr : [];
  };

  Store.setUserExtraPrivs = function(userId, perms){
    const map = Store.getUserExtraPrivsMap();
    map[userId] = Array.from(new Set((perms||[]).filter(Boolean)));
    try{ localStorage.setItem(KEYS.user_extra_privs, JSON.stringify(map)); }catch(_){}
  };

  Store.clearUserExtraPrivs = function(userId){
    const map = Store.getUserExtraPrivsMap();
    delete map[userId];
    try{ localStorage.setItem(KEYS.user_extra_privs, JSON.stringify(map)); }catch(_){}
  };

  Store.userHasExtraPerm = function(userId, perm){
    const arr = Store.getUserExtraPrivs(userId);
    return arr.includes(perm);
  };



  // Cloud: refresh roster into local Store (used by realtime user_created events).
  // This respects RBAC because each client re-fetches via its own /api/users/list.
  let _refreshUserListInFlight = null;
  let _refreshUserListAt = 0;
  Store.refreshUserList = async function(opts){
    const now = Date.now();
    if(_refreshUserListInFlight) return _refreshUserListInFlight;
    if(now - _refreshUserListAt < 800) return { ok:true, skipped:true };
    _refreshUserListAt = now;

    _refreshUserListInFlight = (async ()=>{
      try{
        if(!(window.CloudAuth && CloudAuth.isEnabled && CloudAuth.isEnabled())){
          return { ok:false, error:'cloud_not_enabled' };
        }
        if(!(window.CloudUsers && typeof CloudUsers.refreshIntoLocalStore === 'function')){
          return { ok:false, error:'cloud_users_unavailable' };
        }
        return await CloudUsers.refreshIntoLocalStore();
      }catch(e){
        return { ok:false, error:String(e && (e.message||e) || 'refresh_failed') };
      }finally{
        _refreshUserListInFlight = null;
      }
    })();

    return _refreshUserListInFlight;
  };

  // Realtime bridge for User Management list updates
  (function bindUserManagementRealtime(){
    try{
      if(window.__mumsUserMgmtRealtimeBound) return;
      window.__mumsUserMgmtRealtimeBound = true;

      function isUsersPageActive(){
        const h = String(window.location.hash||'');
        const p = String(window.location.pathname||'');
        return /(^|#)users(\b|$)/i.test(h) || /\/users(\b|\/|$)/i.test(p);
      }

      window.addEventListener('mums:store', (e)=>{
        try{
          const key = e && e.detail && e.detail.key ? String(e.detail.key) : '';
          if(!key) return;

          // When a user_created event is synced (via mums_user_events), fan-out a stable key that UIs can listen to.
          if(key === 'mums_user_events'){
            const ev = read('mums_user_events', null);
            if(ev && ev.type === 'user_created'){
              try{ window.dispatchEvent(new CustomEvent('mums:store', { detail: { key: 'mums_user_list_updated', event: ev, source: 'mums_user_events' } })); }catch(_){ }
            }
            return;
          }

          if(key === 'mums_user_list_updated'){
            if(!isUsersPageActive()) return;
            // Refresh roster and let the Users page re-render without full reload.
            Store.refreshUserList && Store.refreshUserList({ reason:'mums_user_list_updated' });
            return;
          }
        }catch(_){ }
      });
    }catch(_){ }
  })();
  // Internal: raw write helper used by optional realtime relay.
  // Do not use in normal feature code; prefer Store.save* APIs.
  Store.__rawWrite = function(key, value, opts){
    write(key, value, opts);
  };

  // ---------------------------------------------------------------------------
  // Supabase keep-alive (best-effort)
  // - Pings /api/keep_alive at most once every 24h.
  // - Also tries again when tab becomes visible or window regains focus.
  // - Never blocks UI.
  // ---------------------------------------------------------------------------
  (function bindKeepAlive(){
    try{
      if(window.__mumsKeepAliveBound) return;
      window.__mumsKeepAliveBound = true;

      const LS_KEY = 'mums_keepalive_last_ts';
      const PERIOD_MS = 24 * 60 * 60 * 1000;

      function getLast(){
        try{ return Number(localStorage.getItem(LS_KEY) || 0) || 0; }catch(_){ return 0; }
      }
      function setLast(ts){
        try{ localStorage.setItem(LS_KEY, String(ts||0)); }catch(_){ }
      }

      async function tryAuthedInsert(reason){
        try{
          // Prefer authenticated Supabase insert (RLS-aligned).
          if(!(window.CloudAuth && CloudAuth.isEnabled && CloudAuth.isEnabled())) return false;
          if(!(window.supabase && typeof window.supabase.createClient === 'function')) return false;
          const env = (window.EnvRuntime && EnvRuntime.env && EnvRuntime.env()) || (window.MUMS_ENV || {});
          if(!env || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return false;

          const token = (CloudAuth.accessToken && CloudAuth.accessToken()) ? String(CloudAuth.accessToken()||'').trim() : '';
          if(!token) return false;

          const sbUser = (CloudAuth.getUser && typeof CloudAuth.getUser === 'function') ? CloudAuth.getUser() : null;
          const uid = sbUser && sbUser.id ? String(sbUser.id) : '';
          if(!uid) return false;

          // Reuse the shared Supabase client to avoid multiple GoTrueClient instances.
          // If the shared client does not exist yet, create it with a dummy storage (no local persistence)
          // and an Authorization header so RLS works for authed inserts.
          if(!window.__MUMS_SB_CLIENT){
            window.__MUMS_SB_CLIENT = window.supabase.createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
              auth: {
                persistSession: false,
                autoRefreshToken: false,
                detectSessionInUrl: false,
                storage: { getItem(){ return null; }, setItem(){}, removeItem(){} },
                // Explicit storageKey prevents any accidental collisions if another client is created elsewhere.
                storageKey: 'mums_shared'
              },
              realtime: { params: { eventsPerSecond: 10 } },
              global: { headers: { Authorization: 'Bearer ' + token } }
            });
          }
          // Track last token we applied; the realtime socket will be re-authed below.
          window.__MUMS_SB_CLIENT_TOKEN = token;

          const client = window.__MUMS_SB_CLIENT;
          try { client && client.realtime && client.realtime.setAuth && client.realtime.setAuth(token); } catch(_){ }

          const payload = [{ uid: uid, timestamp: new Date().toISOString() }];
          const out = await client.from('heartbeat').insert(payload);
          if(out && out.error) return false;
          return true;
        }catch(_){ return false; }
      }

      async function ping(reason){
        try{
          // Prefer authenticated Supabase insert (satisfies heartbeat RLS).
          const okDirect = await tryAuthedInsert(reason);
          if(okDirect){
            setLast(Date.now());
            return;
          }

          // Fallback: server-side keep-alive (service role) for anon/offline modes.
          if(typeof fetch !== 'function') return;
          if(navigator && navigator.onLine === false) return;
          const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
          const t = setTimeout(()=>{ try{ ctrl && ctrl.abort(); }catch(_){ } }, 6000);
          const r = await fetch('/api/keep_alive', {
            method: 'GET',
            cache: 'no-store',
            credentials: 'same-origin',
            headers: { 'X-MUMS-KeepAlive': '1', 'X-MUMS-Reason': String(reason||'') },
            signal: ctrl ? ctrl.signal : undefined
          }).catch(()=>null);
          clearTimeout(t);

          // If request failed, don't advance the timer.
          if(!r || !r.ok) return;

          // Advance timer on any 200 from the endpoint.
          setLast(Date.now());
        }catch(_){ }
      }

      Store.maybeKeepAlive = function(reason){
        try{
          const now = Date.now();
          const last = getLast();
          if(now - last < PERIOD_MS) return;
          // Fire-and-forget
          ping(reason || 'periodic');
        }catch(_){ }
      };

      // Boot ping (non-blocking)
      setTimeout(()=>{ Store.maybeKeepAlive('boot'); }, 1500);

      // Resume/visibility-based pings
      document.addEventListener('visibilitychange', ()=>{
        if(document.visibilityState === 'visible') Store.maybeKeepAlive('visibility');
      });
      window.addEventListener('focus', ()=>{ Store.maybeKeepAlive('focus'); });
    }catch(_){ }
  })();

window.Store = Store;
})();
