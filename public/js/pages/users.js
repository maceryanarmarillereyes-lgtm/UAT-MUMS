/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Strictly protects Enterprise UI/UX, Realtime Sync Logic, Core State Management, and Database/API Adapters. Do NOT modify existing logic or layout in this file without explicitly asking Thunter BOY for clearance. If overlapping changes are required, STOP and provide a RISK IMPACT REPORT first. */
// ===== CODE UNTOUCHABLES =====
// Save button must disable immediately (dataset.busy=1).
// Cooldown UI must auto re-enable after retry window.
// Do NOT strip these behaviors in future versions.
// Exception: Only change if required by UX specification updates
// or documented frontend behavior changes.
// ==============================

function canEdit(actor, row) {
  if (!actor || !row) return false;
  const aRole = (actor.role || '').toUpperCase();
  const rRole = (row.role || '').toUpperCase();

  if (aRole === 'SUPER_ADMIN') return true;

  if (aRole === 'TEAM_LEAD') {
    // Team lead can edit members of their own team only.
    if (rRole !== 'MEMBER') return false;
    return (actor.team_id || '') === (row.team_id || '');
  }

  // Regular members can only edit themselves (limited fields enforced server-side/RLS).
  return actor.user_id && row.user_id && actor.user_id === row.user_id;
}

function canSchedule(actor, target){
  // Schedule changes are an additional setting (NOT part of creation)
  // Allowed: SUPER_ADMIN / ADMIN, or TEAM_LEAD for members in their own team.
  if(!actor || !target) return false;
  if(target.role!==Config.ROLES.MEMBER) return false;
  if(actor.role===Config.ROLES.SUPER_ADMIN) return true;
  if(actor.role===Config.ROLES.ADMIN) return true;
  if(actor.role===Config.ROLES.TEAM_LEAD) return target.teamId===actor.teamId;
  return false;
}

function canCreateRole(actor, targetRole) {
  if (!actor) return false;
  const aRole = (actor.role || '').toUpperCase();
  const tRole = (targetRole || '').toUpperCase();

  if (aRole === 'SUPER_ADMIN') {
    // SUPER_ADMIN can assign any role (including SUPER_ADMIN for display in edit mode).
    // Creation of new SUPER_ADMIN accounts is blocked at the save step, not here.
    return true;
  }
  if (aRole === 'TEAM_LEAD') {
    // Team lead can only create MEMBER accounts.
    return tRole === 'MEMBER';
  }
  return false;
}

(window.Pages=window.Pages||{}, window.Pages.users = function(root){
  const actor = Auth.getUser();
  let users = Store.getUsers();

  const isCloudMode = !!(window.CloudAuth && CloudAuth.isEnabled && CloudAuth.isEnabled() && window.CloudUsers && typeof CloudUsers.refreshIntoLocalStore === 'function');

  function renderRows(){
    const tbody = root.querySelector('tbody[data-users-tbody]');
    if(!tbody) return;
    // Always re-read to reflect realtime changes.
    users = Store.getUsers();

    // Requirement: Team Leads should only see users belonging to their own shift/team.
    // (Admins/Super Admins retain full visibility.)
    let visible = users;
    try{
      if(actor && actor.role===Config.ROLES.TEAM_LEAD){
        visible = (users||[]).filter(u => (u && (u.teamId===actor.teamId || u.id===actor.id)));
      }
    }catch(_){ visible = users; }

    tbody.innerHTML = visible.map(u=>{
      const isSuper = String(u.role||'')===String(Config.ROLES.SUPER_ADMIN);
      const team = Config.teamById(u.teamId);
      const sched = isSuper ? null : Config.scheduleById(u.schedule);
      const can = canEdit(actor,u);
      return `
            <tr>
              <td>${UI.esc(u.name||u.username)}</td>
              <td><div class=\"small\">${UI.esc(u.username)}</div><div class=\"small\">${UI.esc(u.email||'')}</div></td>
              <td>${UI.esc(u.role)}</td>
              <td>${UI.esc(team ? team.label : '—')}</td>
              <td>${sched ? UI.schedulePill(sched.id) : '<span class="small">—</span>'}</td>
              <td>
                <div class=\"row\" style=\"gap:8px\">
                  <button class=\"btn\" data-act=\"profileUser\" data-id=\"${u.id}\">Profile</button>
                  <button class=\"btn\" data-act=\"editUser\" data-id=\"${u.id}\" ${can?'':'disabled'}>Edit</button>
                  <button class=\"btn danger\" data-act=\"delUser\" data-id=\"${u.id}\" ${can && u.username!=='MUMS'?'':'disabled'}>Delete</button>
                </div>
              </td>
            </tr>
          `;
    }).join('');
  }

  root.innerHTML = `
    <div class="row" style="justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap">
      <div>
        <h2 style="margin:0 0 6px">User Management</h2>
        <div class="small">Create users and assign roles, teams, and schedules. Super User (MUMS) controls everything.</div>
      </div>
      <div class="row" style="gap:8px">
        <button class="btn" id="btnExportUsers">Export Users</button>
        <button class="btn" id="btnImportUsers">Import Users</button>
        <button class="btn primary" id="btnAddUser">Add User</button>
      </div>
    </div>

    <table class="table" style="margin-top:10px">
      <thead>
        <tr><th>Name</th><th>Login</th><th>Role</th><th>Team</th><th>Schedule</th><th>Actions</th></tr>
      </thead>
      <tbody data-users-tbody></tbody>
    </table>

    <div class="modal" id="profileModal" aria-hidden="true">
      <div class="panel">
        <div class="head">
          <div>
            <div class="announce-title" id="p_title">User Profile</div>
            <div class="small" id="p_sub">Manage account and scheduling.</div>
          </div>
          <button class="btn ghost" data-close="profileModal">✕</button>
        </div>
        <div class="body">
          <div class="tabs">
            <button class="tab active" id="tabAccount" type="button">Account</button>
            <button class="tab" id="tabScheduling" type="button">Scheduling</button>
          </div>

          <div id="panelAccount"></div>
          <div id="panelScheduling" style="display:none"></div>
        </div>
      </div>
    </div>

    <div class="modal" id="userModal" aria-hidden="true">
      <div class="panel">
        <div class="head">
          <div>
            <div class="announce-title" id="userModalTitle">Add User</div>
            <div class="small">Whitelist users for Microsoft invite-only sign-in.</div>
          </div>
          <button class="btn ghost" data-close="userModal">✕</button>
        </div>
        <div class="body">
          <div class="grid2">
            <div>
              <label class="small">Full name</label>
              <input class="input" id="u_name" placeholder="Juan Dela Cruz" />
            </div>
            <div>
              <label class="small">Username</label>
              <input class="input" id="u_username" placeholder="jdelacruz" />
            </div>
            <div>
              <label class="small">Microsoft Email Address</label>
              <input class="input" id="u_email" type="text" placeholder="user@copeland.com" autocomplete="off" />
            </div>
            <div>
              <label class="small">Role</label>
              <select class="select" id="u_role"></select>
            </div>
            <div id="u_password_wrap">
              <label class="small">Password <span class="muted" style="font-weight:400;font-size:11px">(min 8 chars — user logs in with this)</span></label>
              <div style="position:relative">
                <input class="input" id="u_password" type="password" placeholder="Set login password" autocomplete="new-password" style="padding-right:38px" />
                <button type="button" id="u_password_toggle" title="Show/hide password"
                  style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:0;cursor:pointer;opacity:.6;padding:4px;color:var(--text)">
                  👁
                </button>
              </div>
            </div>
            <div>
              <label class="small">Team</label>
              <select class="select" id="u_team"></select>
            </div>
            <div id="u_qb_name_wrap">
              <label class="small">Quickbase Name <span class="muted" style="font-size:11px">(Assigned To column — auto-filters QB data)</span></label>
              <select class="select" id="u_qb_name">
                <option value="">— Not Assigned —</option>
              </select>
            </div>
            <!-- Schedule and Status removed from creation (managed in Profile > Scheduling) -->
          </div>
          <div class="err" id="u_err"></div>
          <div class="row" style="justify-content:flex-end;margin-top:12px">
            <button class="btn" data-close="userModal">Cancel</button>
            <button class="btn primary" id="btnSaveUser">Save</button>
          </div>
        </div>
      </div>
    </div>
  `;

  // ── Cloud-mode roster loader ─────────────────────────────────────────────────
  // FIX: previously used a bare try/catch that swallowed API failures, leaving
  // the table silently empty. Now we:
  //   1. Detect and display API failures with a retry button.
  //   2. Auto-retry once after 2 s (handles transient token-refresh races).
  //   3. Always call renderRows() only after the store is confirmed to be updated.
  // ─────────────────────────────────────────────────────────────────────────────
  if(isCloudMode){
    const showUsersError = (msg, canRetry) => {
      const tbody = root.querySelector('tbody[data-users-tbody]');
      if(!tbody) return;
      const safeMsg = (typeof UI !== 'undefined' && UI.esc) ? UI.esc(String(msg||'Unknown error')) : String(msg||'Unknown error');
      tbody.innerHTML = `<tr><td colspan="6">
        <div class="err" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <span>⚠ Could not load users: ${safeMsg}</span>
          ${canRetry ? '<button class="btn" id="btnRetryUsers">Retry</button>' : ''}
        </div>
      </td></tr>`;
      if(canRetry){
        const retryBtn = root.querySelector('#btnRetryUsers');
        if(retryBtn) retryBtn.onclick = loadCloudRoster;
      }
    };

    async function loadCloudRoster(){
      const tbody = root.querySelector('tbody[data-users-tbody]');
      if(tbody){ tbody.innerHTML = '<tr><td colspan="6"><span class="small">Loading cloud roster…</span></td></tr>'; }

      let result = null;
      try{
        result = await CloudUsers.refreshIntoLocalStore();
      }catch(err){
        showUsersError(String(err && err.message ? err.message : err), true);
        return;
      }

      // refreshIntoLocalStore returns {ok:false} on API failure (no throw).
      if(!result || !result.ok){
        const errMsg = (result && result.message) ? result.message : 'API returned an error. Check your connection and session.';
        // Auto-retry once after 2 s (handles a Supabase token-refresh race on page load).
        let retried = false;
        const autoRetry = setTimeout(async()=>{
          if(retried) return;
          retried = true;
          let r2 = null;
          try{ r2 = await CloudUsers.refreshIntoLocalStore(); }catch(_){ }
          if(r2 && r2.ok){
            renderRows();
          } else {
            showUsersError(errMsg, true);
          }
        }, 2000);
        // Show temporary error while auto-retry is pending.
        if(tbody){ tbody.innerHTML = '<tr><td colspan="6"><span class="small">Retrying…</span></td></tr>'; }
        return;
      }

      // Success — render.
      renderRows();
    }

    loadCloudRoster();
  } else {
    renderRows();
  }

  // Realtime user list updates: keep this page in sync across devices without reload.
  // Security: we use a minimal event payload and each client refreshes via its own RBAC-filtered API.
  let _pendingUsersScrollTop = null;
  let _lastUsersToastAt = 0;
  const mumsUserMgmtStoreListener = async (e)=>{
    try{
      const k = e && e.detail && e.detail.key ? String(e.detail.key) : '';
      if(!k) return;
      if(!root || !document.body.contains(root)) return;

      // A user_created or user_deleted event has been received via realtime fan-out.
      if(k === 'mums_user_list_updated' || k === 'mums_user_events'){
        const scroller = root.closest('.main') || document.scrollingElement || document.documentElement;
        if(_pendingUsersScrollTop === null) _pendingUsersScrollTop = scroller ? (scroller.scrollTop||0) : 0;

        // Cloud mode: refresh roster (RBAC-safe). The subsequent ums_users write will trigger the re-render.
        if(isCloudMode && window.Store && typeof Store.refreshUserList === 'function'){
          try{ await Store.refreshUserList({ reason: k }); }catch(_){ }
        } else {
          // Local / non-cloud: re-render immediately from store.
          const prevTop = (_pendingUsersScrollTop !== null) ? _pendingUsersScrollTop : 0;
          _pendingUsersScrollTop = null;
          renderRows();
          try{ if(scroller) scroller.scrollTop = prevTop; }catch(_){ }
          return;
        }

        // Optional toast (throttled to avoid spam during batch operations).
        const now = Date.now();
        if(now - _lastUsersToastAt > 1200){
          _lastUsersToastAt = now;
          try{ UI.toast && UI.toast('User list updated'); }catch(_){ }
        }
        return;
      }

      // Roster changed locally (after cloud refresh). Re-render while preserving scroll.
      // NOTE: source==='cloud_refresh' means the write was silent and the cache is
      // fully updated — safe to render. Any other source also goes here.
      if(k === 'ums_users'){
        const scroller = root.closest('.main') || document.scrollingElement || document.documentElement;
        const prevTop = (_pendingUsersScrollTop !== null) ? _pendingUsersScrollTop : (scroller ? (scroller.scrollTop||0) : 0);
        _pendingUsersScrollTop = null;
        // Guard: only render if store has actual users (skip empty intermediate writes)
        const storeUsers = (window.Store && typeof Store.getUsers === 'function') ? Store.getUsers() : [];
        if(storeUsers && storeUsers.length > 0){
          renderRows();
          try{ if(scroller) scroller.scrollTop = prevTop; }catch(_){ }
        } else if(e && e.detail && e.detail.source === 'cloud_refresh'){
          // cloud_refresh always fires after the store is populated — render regardless
          renderRows();
          try{ if(scroller) scroller.scrollTop = prevTop; }catch(_){ }
        }
        // If store is empty and not from cloud_refresh, skip — a follow-up event or
        // the loadCloudRoster() IIFE will call renderRows() once data is ready.
      }
    }catch(_){ }
  };
  // Register listener for BOTH cloud and local modes so realtime updates work everywhere.
  try{ window.addEventListener('mums:store', mumsUserMgmtStoreListener); }catch(_){ }

// UI permission hardening: only SUPER_ADMIN and TEAM_LEAD can create/import/export users.
const createAllowed = !!actor && ['SUPER_ADMIN', 'TEAM_LEAD'].includes((actor.role || '').toUpperCase());
if (!createAllowed) {
  const hide = (id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  };
  hide('btnAddUser');
  hide('btnImportUsers');
  hide('btnExportUsers');
}

  if(isCloudMode){
    // Cloud mode: roster is authoritative from Supabase; importing/exporting local rosters can reintroduce duplicates.
    const hide2 = (id)=>{ const el=document.getElementById(id); if(el) el.style.display='none'; };
    hide2('btnImportUsers');
    hide2('btnExportUsers');
  }


  // fill selects
  const roleSel = UI.el('#u_role');
  const teamSel = UI.el('#u_team');
  // schedule assignment is handled in the Profile modal

  roleSel.innerHTML = Object.values(Config.ROLES)
    .filter(r=>canCreateRole(actor,r))
    .map(r=>`<option value="${r}">${r}</option>`).join('');

  teamSel.innerHTML = `<option value="">Developer Access</option>` + Config.TEAMS.map(t=>`<option value="${t.id}">${t.label}</option>`).join('');

  // ── QB Name dropdown: load Assigned To names from Global QB Settings report ──
  const qbNameSel = UI.el('#u_qb_name');
  const qbNameWrap = document.getElementById('u_qb_name_wrap');
  // Only SUPER_ADMIN can set QB names
  if (qbNameWrap) qbNameWrap.style.display = (actor && actor.role === Config.ROLES.SUPER_ADMIN) ? '' : 'none';

  async function loadQbNameOptions(currentQbName) {
    if (!qbNameSel) return;
    try {
      const tok = window.CloudAuth && typeof CloudAuth.accessToken === 'function' ? CloudAuth.accessToken() : '';
      // Fetch global QB settings to get realm/tableId/qid
      const settingsRes = await fetch('/api/settings/global_quickbase', { headers: { Authorization: 'Bearer ' + tok } });
      const settingsData = await settingsRes.json();
      if (!settingsData.ok || !settingsData.settings || !settingsData.settings.realm) {
        qbNameSel.innerHTML = '<option value="">— Global QB not configured —</option>';
        return;
      }
      const { realm, tableId, qid } = settingsData.settings;
      if (!realm || !tableId || !qid) { qbNameSel.innerHTML = '<option value="">— Global QB not configured —</option>'; return; }
      // Fetch QB data to get the list of Assigned To names (field #13)
      const params = new URLSearchParams({ realm, tableId, qid, limit: 500 });
      const dataRes = await fetch('/api/quickbase/monitoring?' + params.toString(), { headers: { Authorization: 'Bearer ' + tok } });
      const data = await dataRes.json();
      // Extract unique values from Assigned To column (label contains "Assigned to" or field id 13)
      const assignedField = (data.allAvailableFields || []).find(f =>
        String(f.label || '').toLowerCase().includes('assigned to') || Number(f.id) === 13
      );
      const assignedFid = assignedField ? String(assignedField.id) : '13';
      const names = new Set();
      (data.records || []).forEach(row => {
        const val = row[assignedFid];
        if (val && typeof val === 'object' && val.value) names.add(String(val.value).trim());
        else if (val && typeof val === 'string') names.add(val.trim());
      });
      const sorted = Array.from(names).filter(Boolean).sort((a, b) => a.localeCompare(b));
      qbNameSel.innerHTML = '<option value="">— Not Assigned —</option>' + sorted.map(n => `<option value="${n.replace(/"/g,'&quot;')}" ${n === currentQbName ? 'selected' : ''}>${n.replace(/</g,'&lt;')}</option>`).join('');
    } catch (e) {
      qbNameSel.innerHTML = '<option value="">— Error loading names —</option>';
    }
  }

  // (no schedule select in Add User)

  // events
  const btnAddUser = document.getElementById('btnAddUser');
  if (btnAddUser) btnAddUser.onclick = ()=>openUserModal(actor, null);
  const btnExportUsers = document.getElementById('btnExportUsers');
  if (btnExportUsers) btnExportUsers.onclick = ()=>UI.downloadJSON('users.json', Store.getUsers());
  const btnImportUsers = document.getElementById('btnImportUsers');
  if (btnImportUsers) btnImportUsers.onclick = async()=>{
    const data = await UI.pickJSON();
    if(!Array.isArray(data)) return alert('Invalid JSON. Expected an array of users.');
    // apply restrictions
    const incoming = data.filter(u=>u && u.username);
    const cleaned = incoming.map(u=>({
      id: u.id || crypto.randomUUID(),
      username: String(u.username),
      email: u.email||'',
      name: u.name||u.username,
      role: u.role||Config.ROLES.MEMBER,
      teamId: u.teamId||Config.TEAMS[0].id,
      schedule: u.schedule||'back_office',
      status: u.status||'active',
      passwordHash: u.passwordHash || '',
      createdAt: u.createdAt || Date.now(),
    }));

    const existing = Store.getUsers();
    const meys = existing.find(u=>u.username==='MUMS');

    let finalUsers = cleaned;
    // Enforce: only SUPER_ADMIN can import SUPER_ADMIN
    if(actor.role!==Config.ROLES.SUPER_ADMIN){
      finalUsers = finalUsers.map(u=> (u.role===Config.ROLES.SUPER_ADMIN ? { ...u, role: Config.ROLES.MEMBER } : u));
    }
    // Team lead imports only their team
    if(actor.role===Config.ROLES.TEAM_LEAD){
      finalUsers = finalUsers.map(u=>({ ...u, role: Config.ROLES.MEMBER, teamId: actor.teamId }));
    }

    // keep MUMS always
    finalUsers = [meys, ...finalUsers.filter(u=>u.username!=='MUMS')];
    Store.saveUsers(finalUsers);
    window.location.hash = '#users';
  };

  
  // Event delegation (scoped to this page) — important: remove on route change to avoid cross-page collisions.
  const onClick = async (e)=>{
    const btn = e.target.closest('button');
    if(!btn) return;
    const act = btn.dataset.act;
    const id = btn.dataset.id;
    if(!act || !id) return;

    if(act==='editUser'){
      const u = Store.getUsers().find(x=>x.id===id);
      // Team Lead visibility guard (defense-in-depth; list is filtered but we guard actions too).
      if(actor && actor.role===Config.ROLES.TEAM_LEAD && u && u.id!==actor.id && u.teamId!==actor.teamId) return;
      if(u) openUserModal(actor, u);
      return;
    }
    if(act==='profileUser'){
      const u = Store.getUsers().find(x=>x.id===id);
      // Team Lead visibility guard (defense-in-depth; list is filtered but we guard actions too).
      if(actor && actor.role===Config.ROLES.TEAM_LEAD && u && u.id!==actor.id && u.teamId!==actor.teamId) return;
      if(u) openProfileModal(actor, u);
      return;
    }
    if(act==='delUser'){
      const u = Store.getUsers().find(x=>x.id===id);
      // Team Lead visibility guard (defense-in-depth; list is filtered but we guard actions too).
      if(actor && actor.role===Config.ROLES.TEAM_LEAD && u && u.id!==actor.id && u.teamId!==actor.teamId) return;
      if(!u) return;
      if(u.username==='MUMS') return;

      const ok = await UI.confirm({ title:'Delete User', message:`Delete ${u.username}?`, okText:'Delete', danger:true });
      if(!ok) return;

      // Delete + immediate UI refresh (no hash reload).
      // Cloud mode: enforce deletion in the backend/auth system as well.
      const isCloud = !!(window.CloudAuth && CloudAuth.isEnabled && CloudAuth.isEnabled() && window.CloudUsers && typeof CloudUsers.deleteUser === 'function');
      if(isCloud){
        const out = await CloudUsers.deleteUser(id);
        if(!out.ok){
          const msg = out.message || 'Delete failed.';
          try{ UI.toast ? UI.toast(msg, 'error') : alert(msg); }catch(_){ alert(msg); }
          return;
        }
        // Optimistic local removal first so UI updates instantly.
        try{ Store.deleteUser(id); }catch(_){ }
        // Refresh from cloud so roster is authoritative.
        try{ CloudUsers.refreshIntoLocalStore && (await CloudUsers.refreshIntoLocalStore()); }catch(_){ }
        // Broadcast to other sessions so they update without a page refresh.
        try{
          const rawWrite = (typeof Store.__rawWrite === 'function') ? Store.__rawWrite : (typeof Store.__writeRaw === 'function') ? Store.__writeRaw : null;
          if(rawWrite) rawWrite('mums_user_events', { type:'user_deleted', ts: Date.now(), userId: id });
          // Also fire the list-updated key so any open Users page on other tabs refreshes.
          if(rawWrite) rawWrite('mums_user_list_updated', { ts: Date.now(), reason:'user_deleted', userId: id });
        }catch(_){}
      }else{
        Store.deleteUser(id);
        // Local mode: fire a store event so any other listener on this tab re-renders.
        try{
          window.dispatchEvent(new CustomEvent('mums:store', { detail:{ key:'ums_users', reason:'user_deleted' } }));
        }catch(_){}
      }
      try{ UI.toast && UI.toast(`User "${u.name||u.username}" deleted.`, 'success'); }catch(_){}
      try{
        Store.addLog({
          ts: Date.now(),
          teamId: u.teamId || (actor && actor.teamId) || 'system',
          actorId: (actor && actor.id) || 'system',
          actorName: (actor && (actor.name||actor.username)) || 'SYSTEM',
          action: 'USER_DELETE',
          targetId: u.id,
          targetName: u.name || u.username,
          msg: `${(actor && (actor.name||actor.username)) || 'SYSTEM'} deleted user ${u.name||u.username}`,
          detail: `Username=${u.username}, Role=${u.role}, Team=${Config.teamById(u.teamId).label}`
        });
      }catch(_){}

      // If the current user deleted themselves, force logout to avoid inconsistent state.
      try{
        const cur = Auth.getUser();
        if(cur && cur.id===id){
          Auth.logout();
          window.location.href = '/login.html';
          return;
        }
      }catch(_){}

      renderRows();
      return;
    }
  };
  root.addEventListener('click', onClick);

  // ensure cleanup runs on route change
  root._cleanup = ()=>{
    try{ root.removeEventListener('click', onClick); }catch(_){}
    try{ window.removeEventListener('mums:store', mumsUserMgmtStoreListener); }catch(_){}
  };
// modal close
  root.querySelectorAll('[data-close="userModal"]').forEach(b=>b.onclick=()=>UI.closeModal('userModal'));
  root.querySelectorAll('[data-close="profileModal"]').forEach(b=>b.onclick=()=>UI.closeModal('profileModal'));


function applyDevOptionForRole(role){
  const isSuper = String(role || '').toUpperCase() === String(Config.ROLES.SUPER_ADMIN);
  const sel = UI.el('#u_team');
  if (!sel) return;

  // FIX: style.display on <option> is ignored by Chrome on Windows.
  // Correct approach: physically remove or re-insert the Developer Access option.
  let devOpt = sel.querySelector('option[value=""]');

  if (isSuper) {
    // Ensure Developer Access option exists at the top
    if (!devOpt) {
      devOpt = document.createElement('option');
      devOpt.value = '';
      devOpt.textContent = 'Developer Access';
      sel.insertBefore(devOpt, sel.firstChild);
    }
    devOpt.disabled = false;
  } else {
    // Remove Developer Access option entirely for non-SUPER_ADMIN
    if (devOpt) devOpt.remove();
    // If value is empty (Developer Access), force to first shift
    if (sel.value === '') {
      sel.value = (Config.TEAMS[0] && Config.TEAMS[0].id) || 'morning';
    }
  }
}

function openUserModal(actor, user){
  UI.el('#u_err').style.display='none';
  UI.el('#userModalTitle').textContent = user ? 'Edit User' : 'Add User';

  const isEdit = !!user;
  const isCloud = !!(window.CloudAuth && CloudAuth.isEnabled && CloudAuth.isEnabled() && window.CloudUsers);

  UI.el('#u_name').value = user?.name || '';
  UI.el('#u_username').value = user?.username || '';
  UI.el('#u_role').value = user?.role || roleSel.value;
  // Password: only shown when creating (not editing) — editing uses Supabase Admin separately
  const pwWrap = document.getElementById('u_password_wrap');
  const pwField = document.getElementById('u_password');
  if (pwWrap) pwWrap.style.display = isEdit ? 'none' : '';
  if (pwField) { pwField.value = ''; pwField.required = !isEdit; }
  // Toggle show/hide password
  const pwToggle = document.getElementById('u_password_toggle');
  if (pwToggle && !pwToggle.__bound) {
    pwToggle.__bound = true;
    pwToggle.addEventListener('click', () => {
      if (!pwField) return;
      pwField.type = pwField.type === 'password' ? 'text' : 'password';
      pwToggle.textContent = pwField.type === 'password' ? '👁' : '🙈';
    });
  }

  // Team: SUPER_ADMIN may be Developer Access (empty string); others must be shift team.
  // FIX: explicitly check for empty string '' (Developer Access) — falsy check was treating it as no team.
  const resolvedTeam = (user && user.teamId !== undefined && user.teamId !== null)
    ? user.teamId
    : ((Config.TEAMS[0] && Config.TEAMS[0].id) || 'morning');
  UI.el('#u_team').value = resolvedTeam;

  // Email is required and explicitly managed as the Microsoft identity.
  UI.el('#u_email').value = (user && user.email) ? String(user.email).trim() : '';
  UI.el('#u_email').readOnly = false;

  // QB Name — load options and pre-select current value
  if (actor && actor.role === Config.ROLES.SUPER_ADMIN) {
    const currentQbName = (user && user.qb_name) ? String(user.qb_name) : '';
    loadQbNameOptions(currentQbName);
  }

  // Cloud mode: prevent editing username/email for existing users to avoid breaking auth mapping.
  UI.el('#u_username').readOnly = (isCloud && isEdit);

  // Lock TL create/edit constraints
  const isTL = actor && actor.role===Config.ROLES.TEAM_LEAD;
  if(isTL){
    UI.el('#u_team').value = actor.teamId;
    UI.el('#u_team').disabled = true;
    UI.el('#u_role').value = Config.ROLES.MEMBER;
    UI.el('#u_role').disabled = true;
  }else{
    UI.el('#u_team').disabled = false;
    UI.el('#u_role').disabled = false;
  }

  // Lock editing SUPER_ADMIN role (bootstrap-only); SUPER_ADMIN team remains editable for SUPER_ADMIN actor.
  if(isEdit && user?.role===Config.ROLES.SUPER_ADMIN){
    UI.el('#u_role').disabled = true;
  }

  applyDevOptionForRole(UI.el('#u_role').value);
  UI.el('#u_role').onchange = ()=>applyDevOptionForRole(UI.el('#u_role').value);

  // Permission hardening: only SUPER_ADMIN can edit SUPER_ADMIN
  if(isEdit && user?.role===Config.ROLES.SUPER_ADMIN && actor.role!==Config.ROLES.SUPER_ADMIN){
    UI.el('#btnSaveUser').disabled=true;
  } else {
    UI.el('#btnSaveUser').disabled=false;
  }

  const btnSaveUser = UI.el('#btnSaveUser');

  // v4: Cooldown UI for auth rate limits (429). This prevents users from hammering the endpoint.
  const baseSaveText = (btnSaveUser && btnSaveUser.textContent) ? String(btnSaveUser.textContent) : 'Save';
  try { btnSaveUser.dataset.base_text = baseSaveText; } catch (_) {}
  let saveCooldownTimer = null;
  const startSaveCooldown = (seconds, message) => {
    const s = Math.max(1, parseInt(String(seconds || '0'), 10) || 0);
    if (!s) return;
    const until = Date.now() + s * 1000;
    try { btnSaveUser.dataset.cooldown_until = String(until); } catch (_) {}
    try { btnSaveUser.disabled = true; } catch (_) {}

    if (message) {
      try {
        const el = UI.el('#u_err');
        el.textContent = message;
        el.style.display = 'block';
      } catch (_) {}
    }

    try { if (saveCooldownTimer) clearInterval(saveCooldownTimer); } catch (_) {}
    saveCooldownTimer = setInterval(() => {
      const rem = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      if (rem <= 0) {
        try { clearInterval(saveCooldownTimer); } catch (_) {}
        saveCooldownTimer = null;
        try { delete btnSaveUser.dataset.cooldown_until; } catch (_) {}
        try { btnSaveUser.textContent = btnSaveUser.dataset.base_text || baseSaveText; } catch (_) {}
        try { btnSaveUser.disabled = false; } catch (_) {}
        return;
      }
      try { btnSaveUser.textContent = `Retry in ${rem}s`; } catch (_) {}
      try { btnSaveUser.disabled = true; } catch (_) {}
    }, 250);
  };

  btnSaveUser.onclick = async ()=>{
    const err = (msg)=>{ const el=UI.el('#u_err'); el.textContent=msg; el.style.display='block'; };

    // If a cooldown is active, short-circuit immediately with a clear message.
    try {
      const until = parseInt(String(btnSaveUser.dataset.cooldown_until || '0'), 10);
      if (Number.isFinite(until) && until > Date.now()) {
        const rem = Math.max(1, Math.ceil((until - Date.now()) / 1000));
        return err(`Please wait ${rem}s before retrying.`);
      }
    } catch (_) {}

    // Prevent double-submits / rapid retries that can create duplicate requests.
    try {
      if (btnSaveUser.dataset.busy === '1') return;
      btnSaveUser.dataset.busy = '1';
      btnSaveUser.disabled = true;
    } catch (_) {}

    try {
      const name = UI.el('#u_name').value.trim();
      const username = UI.el('#u_username').value.trim();
      const email = UI.el('#u_email').value.trim().toLowerCase();
      const role = UI.el('#u_role').value;
      const teamId = UI.el('#u_team').value;
      const qbName = (actor && actor.role === Config.ROLES.SUPER_ADMIN && UI.el('#u_qb_name'))
        ? String(UI.el('#u_qb_name').value || '').trim()
        : undefined;

      const password = isEdit ? '' : (UI.el('#u_password') ? UI.el('#u_password').value.trim() : '');

      if(!name) return err('Name is required.');
      if(!username) return err('Username is required.');
      if(!/^[a-zA-Z0-9._-]{3,}$/.test(username)) return err('Username must be at least 3 characters and use letters/numbers/._-');
      if(!email) return err('Microsoft Email Address is required.');
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err('Enter a valid Microsoft Email Address.');
      if(!isEdit && !password) return err('Password is required. The new user will log in with this password.');
      if(!isEdit && password.length < 8) return err('Password must be at least 8 characters.');

      // Role restrictions
      if(!canCreateRole(actor, role) && (user?.role!==role)) return err('You do not have permission to set that role.');
      // Block creating NEW SUPER_ADMIN accounts (editing existing one is fine)
      if(!isEdit && String(role||'').toUpperCase() === String(Config.ROLES.SUPER_ADMIN)){
        return err('Cannot create new Super Admin accounts. Contact system administrator.');
      }
      if(actor.role===Config.ROLES.TEAM_LEAD && teamId!==actor.teamId) return err('Team Lead can only manage users in their team.');

      // Developer Access restriction
      // FIX: SUPER_ADMIN role CAN have Developer Access (empty teamId). Only block for non-SUPER_ADMIN roles.
      const isSuperAdminRole = String(role||'').toUpperCase() === String(Config.ROLES.SUPER_ADMIN);
      const isEditingExistingSuperAdmin = isEdit && user && String(user.role||'').toUpperCase() === String(Config.ROLES.SUPER_ADMIN);
      if(!isSuperAdminRole && !isEditingExistingSuperAdmin && String(teamId||'')===''){
        return err('Developer Access is reserved for Super Admin. Choose Morning/Mid/Night shift.');
      }


      let createdEvent = null;

      if(isCloud){
        if(isEdit){
          // Self edits use update_me (supports SUPER_ADMIN team override)
          if(actor && user && actor.id===user.id && window.CloudUsers && typeof CloudUsers.updateMe === 'function'){
            const patch = { name };
            if(String(user.role||'').toUpperCase()===String(Config.ROLES.SUPER_ADMIN)){
              if(String(teamId)===''){
                patch.team_override = false;
                patch.team_id = null;
              } else {
                patch.team_override = true;
                patch.team_id = teamId;
              }
            }
            const out = await CloudUsers.updateMe(patch);
            if(!out.ok) return err(out.message || 'Update failed.');
          } else if(window.CloudUsers && typeof CloudUsers.updateUser === 'function'){
            const payload = { user_id: user.id, name };
            if(actor && actor.role===Config.ROLES.SUPER_ADMIN && qbName !== undefined){
              payload.qb_name = qbName;
            }
            if(actor && actor.role===Config.ROLES.SUPER_ADMIN){
              payload.role = role;
              if(String(user.role||'').toUpperCase()===String(Config.ROLES.SUPER_ADMIN)){
                if(String(teamId)===''){
                  payload.team_override = false;
                  payload.team_id = null;
                } else {
                  payload.team_override = true;
                  payload.team_id = teamId;
                }
              } else {
                payload.team_id = teamId;
              }
            }
            const out = await CloudUsers.updateUser(payload);
            if(!out.ok) return err(out.message || 'Update failed.');
          }
        } else {
          const createPayload = { email, username, full_name: name, name, role, team_id: teamId, team: teamId, password };
        if (qbName !== undefined) createPayload.qb_name = qbName;
        const out = await CloudUsers.create(createPayload);
          if(!out.ok) {
            let msg = out.message || 'Create failed.';

            // If the upstream auth provider rate-limits, respect Retry-After.
            if (out.status === 429) {
              const raRaw = out.retryAfter || (out.data && (out.data.retry_after || out.data.retryAfter)) || '';
              const ra = parseInt(String(raRaw || '').trim(), 10);
              const wait = (Number.isFinite(ra) && ra > 0) ? ra : 10;
              const msg2 = `${msg} Please retry in ${wait}s.`;
              startSaveCooldown(wait, msg2);
              return;
            }

            return err(msg);
          }

          // Prepare a realtime user_created event (minimal payload) so other sessions can refresh their user list.
          // RBAC-safe: other clients re-fetch via their own /api/users/list filtering.
          try{
            const data = (out && out.data) ? out.data : null;
            const prof = (data && data.profile) ? data.profile : null;
            const uid = String((data && data.user && (data.user.id || data.user.user_id)) || (prof && (prof.user_id || prof.id)) || '').trim();
            const teamRaw = (prof && (prof.team_id !== undefined)) ? prof.team_id : teamId;
            const teamNorm = (teamRaw === null || teamRaw === undefined) ? '' : String(teamRaw);
            createdEvent = { type: 'user_created', ts: Date.now(), userId: uid, teamId: teamNorm };
          }catch(_){ createdEvent = { type:'user_created', ts: Date.now(), userId:'', teamId: String(teamId||'') }; }
        }

        try { await CloudUsers.refreshIntoLocalStore(); } catch(_) {}

        // Broadcast to other devices via realtime/sync queue.
        try{
          if(window.Store){
            const rawWrite = (typeof Store.__rawWrite === 'function') ? Store.__rawWrite : (typeof Store.__writeRaw === 'function') ? Store.__writeRaw : null;
            if(rawWrite){
              if(createdEvent) rawWrite('mums_user_events', createdEvent);
              // Also write the list-updated key so any open User Management page refreshes.
              rawWrite('mums_user_list_updated', { ts: Date.now(), reason: isEdit ? 'user_updated' : 'user_created' });
            }
          }
        }catch(_){ }

        UI.closeModal('userModal');
        try{ UI.toast && UI.toast(isEdit ? 'User updated.' : 'User created.', 'success'); }catch(_){}
        renderRows();
        return;
      }

      // Local/offline persistence
      if(isEdit){
        const patch = { name, username, email: (email || user?.email || ''), role, teamId };
        Store.updateUser(user.id, patch);
        // Notify other listeners on same tab.
        try{ window.dispatchEvent(new CustomEvent('mums:store', { detail:{ key:'ums_users', reason:'user_updated' } })); }catch(_){}
      } else {
        const newUser = {
          id: crypto.randomUUID(),
          name, username, email,
          role, teamId,
          schedule: null,
          status: 'active',
          passwordHash: '',
          createdAt: Date.now(),
        };
        Store.addUser(newUser);
        // Notify other listeners on same tab.
        try{ window.dispatchEvent(new CustomEvent('mums:store', { detail:{ key:'ums_users', reason:'user_created' } })); }catch(_){}
      }

      UI.closeModal('userModal');
      try{ UI.toast && UI.toast(isEdit ? 'User updated.' : 'User created.', 'success'); }catch(_){}
      try { renderRows(); } catch (_) {}
    } finally {
      try {
        btnSaveUser.dataset.busy = '0';

        // Keep the button disabled during any server-directed cooldown window.
        const until = parseInt(String(btnSaveUser.dataset.cooldown_until || '0'), 10);
        if (Number.isFinite(until) && until > Date.now()) {
          const rem = Math.max(1, Math.ceil((until - Date.now()) / 1000));
          btnSaveUser.disabled = true;
          // If a timer isn't running (e.g., older browsers), set a fallback label.
          if (!String(btnSaveUser.textContent || '').startsWith('Retry in')) {
            btnSaveUser.textContent = `Retry in ${rem}s`;
          }
        } else {
          try { delete btnSaveUser.dataset.cooldown_until; } catch (_) {}
          btnSaveUser.disabled = false;
          try { btnSaveUser.textContent = btnSaveUser.dataset.base_text || baseSaveText; } catch (_) {}
        }
      } catch (_) {}
    }
  };

  UI.openModal('userModal');
}

  function openProfileModal(actor, user){
    const isSuper = String(user?.role||'')===String(Config.ROLES.SUPER_ADMIN);
    const team = Config.teamById(user.teamId);
    const sched = isSuper ? null : Config.scheduleById(user.schedule);
    const canSched = canSchedule(actor, user);

    UI.el('#p_title').textContent = `${user.name||user.username}`;
    UI.el('#p_sub').textContent = `Role: ${user.role} • Team: ${team ? team.label : '—'}`;

    const account = UI.el('#panelAccount');
    const scheduling = UI.el('#panelScheduling');

    account.innerHTML = `
      <div class="kv"><div class="small">Username</div><div>${UI.esc(user.username)}</div></div>
      <div class="kv"><div class="small">Email</div><div>${UI.esc(user.email||'—')}</div></div>
      <div class="kv"><div class="small">Role</div><div>${UI.esc(user.role)}</div></div>
      <div class="kv"><div class="small">Team</div><div>${UI.esc(team ? team.label : '—')}</div></div>
      <div class="kv"><div class="small">Status</div><div>${UI.esc(user.status||'active')}</div></div>
    `;

    scheduling.innerHTML = `
      <div class="small" style="margin-bottom:10px">Scheduling is a separate admin setting (not part of user creation).</div>
      <div class="grid2">
        <div>
          <label class="small">Current Schedule</label>
          <div>${sched ? UI.schedulePill(sched.id) : '<span class="small">—</span>'}</div>
        </div>
        <div>
          <label class="small">Assign Schedule</label>
          <select class="select" id="p_schedule" ${canSched ? '' : 'disabled'}>
            <option value="">— None —</option>
            ${Object.values(Config.SCHEDULES).map(s=>`<option value="${s.id}">${s.icon} ${s.label}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="row" style="justify-content:flex-end;margin-top:12px">
        <button class="btn primary" id="btnApplySchedule" ${canSched ? '' : 'disabled'}>Apply</button>
      </div>
      ${canSched?'' : '<div class="err" style="display:block;margin-top:10px">You do not have permission to change scheduling for this user.</div>'}
    `;

    // Super Admin accounts intentionally have no team/shift scheduling assignment.
    if(isSuper){
      scheduling.innerHTML = `
        <div class="card pad" style="border-style:dashed">
          <div style="font-weight:800">Scheduling</div>
          <div class="small muted" style="margin-top:6px">
            Super Admin accounts are not assigned to a specific team/shift or schedule.
          </div>
        </div>
      `;
    }


    // tabs
    const tabAccount = UI.el('#tabAccount');
    const tabScheduling = UI.el('#tabScheduling');
    tabAccount.onclick = ()=>{ tabAccount.classList.add('active'); tabScheduling.classList.remove('active'); account.style.display='block'; scheduling.style.display='none'; };
    tabScheduling.onclick = ()=>{ tabScheduling.classList.add('active'); tabAccount.classList.remove('active'); account.style.display='none'; scheduling.style.display='block'; };

    // default select
    const sel = scheduling.querySelector('#p_schedule');
    if(sel) sel.value = user.schedule || '';

    const applyBtn = scheduling.querySelector('#btnApplySchedule');
    if(applyBtn) applyBtn.onclick = ()=>{
      if(!canSched) return;
      const newSched = sel.value || null;
      Store.updateUser(user.id, { schedule: newSched });
      // Realtime update: close modal and re-render the table in-place.
      // No page reload needed — Store.updateUser triggers 'ums_users' store event
      // which the listener picks up, or we call renderRows() directly as a fallback.
      UI.closeModal('profileModal');
      try{ renderRows(); }catch(_){}
      try{ UI.toast && UI.toast('Schedule updated.', 'success'); }catch(_){}
    };

    // open modal
    UI.openModal('profileModal');
    // default to Account tab
    tabAccount.onclick();
  }
}
);
