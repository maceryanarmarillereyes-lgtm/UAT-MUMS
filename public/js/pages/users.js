/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */


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

    <div class="modal" id="userProfileModal" aria-hidden="true">
      <div class="panel">
        <div class="head">
          <div>
            <div class="announce-title" id="p_title">User Profile</div>
            <div class="small" id="p_sub">Manage account and scheduling.</div>
          </div>
          <button class="btn ghost" data-close="userProfileModal">✕</button>
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
              <label class="small" style="display:flex;justify-content:space-between;align-items:center">
                <span>Quickbase Name <span class="muted" style="font-size:11px">(Assigned To — auto-filters QB data)</span></span>
                <button type="button" id="u_qb_name_toggle" class="btn ghost" style="font-size:11px;padding:2px 8px;margin-left:8px">✏️ Enter manually</button>
              </label>
              <select class="select" id="u_qb_name" style="margin-top:4px">
                <option value="">— Not Assigned —</option>
              </select>
              <div id="u_qb_name_manual_wrap" style="display:none;margin-top:4px">
                <input class="input" id="u_qb_name_manual" type="text" placeholder="Type exact name as it appears in Quickbase" />
                <div class="small muted" style="margin-top:3px">Must match exactly the name in the "Assigned To" column</div>
              </div>
            </div>
            <!-- Schedule and Status removed from creation (managed in Profile > Scheduling) -->

            <!-- ── SECURITY PIN BLOCK (edit mode only, TL/SU/SA) ── -->
            <div id="u_pin_block" style="display:none;grid-column:span 2">
              <div style="
                background:linear-gradient(135deg,rgba(56,189,248,.04),rgba(99,102,241,.03));
                border:1px solid rgba(56,189,248,.14);border-radius:14px;padding:16px 18px;
              ">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
                  <div style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;color:var(--text)">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--primary,#38bdf8)" stroke-width="2" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    Security PIN
                  </div>
                  <div id="u_pin_status_badge" style="display:flex;align-items:center;gap:5px;padding:3px 10px;border-radius:99px;font-size:9px;font-weight:700;font-family:monospace;letter-spacing:.04em;background:rgba(16,185,129,.1);border:1px solid rgba(16,185,129,.22);color:#10b981">
                    <div style="width:6px;height:6px;border-radius:50%;background:#10b981;box-shadow:0 0 6px #10b981"></div>
                    <span id="u_pin_status_text">CHECKING…</span>
                  </div>
                </div>
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px">
                  <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:10px;padding:10px 12px">
                    <div style="font-size:9px;color:var(--muted);margin-bottom:3px;font-family:monospace;letter-spacing:.05em;text-transform:uppercase">PIN Set</div>
                    <div id="u_pin_set_date" style="font-size:12px;font-weight:600;color:var(--text)">—</div>
                  </div>
                  <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:10px;padding:10px 12px">
                    <div style="font-size:9px;color:var(--muted);margin-bottom:3px;font-family:monospace;letter-spacing:.05em;text-transform:uppercase">Last Used</div>
                    <div id="u_pin_last_used" style="font-size:12px;font-weight:600;color:#10b981">—</div>
                  </div>
                  <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:10px;padding:10px 12px">
                    <div style="font-size:9px;color:var(--muted);margin-bottom:3px;font-family:monospace;letter-spacing:.05em;text-transform:uppercase">Failed</div>
                    <div id="u_pin_fail_count" style="font-size:12px;font-weight:600;color:#f59e0b">0</div>
                  </div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
                  <button id="u_pin_reset_btn" type="button" style="
                    height:38px;border-radius:10px;font-size:11.5px;font-weight:700;cursor:pointer;
                    display:flex;align-items:center;justify-content:center;gap:7px;transition:.15s;
                    border:1px solid rgba(245,158,11,.25);background:rgba(245,158,11,.07);color:#f59e0b;
                    font-family:var(--font,sans-serif);
                  ">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                    Send Reset Request
                  </button>
                  <button id="u_pin_clear_btn" type="button" style="
                    height:38px;border-radius:10px;font-size:11.5px;font-weight:700;cursor:pointer;
                    display:flex;align-items:center;justify-content:center;gap:7px;transition:.15s;
                    border:1px solid rgba(244,63,94,.2);background:rgba(244,63,94,.06);color:#f43f5e;
                    font-family:var(--font,sans-serif);
                  ">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    Force Clear PIN
                  </button>
                </div>
                <div style="margin-top:9px;font-size:10px;color:var(--muted);line-height:1.6">
                  Access: 
                  <span style="display:inline-flex;align-items:center;padding:2px 7px;border-radius:5px;font-size:9px;font-family:monospace;font-weight:700;background:rgba(56,189,248,.1);color:#38bdf8;border:1px solid rgba(56,189,248,.2);margin-right:3px">Team Lead</span>
                  <span style="display:inline-flex;align-items:center;padding:2px 7px;border-radius:5px;font-size:9px;font-family:monospace;font-weight:700;background:rgba(99,102,241,.1);color:#6366f1;border:1px solid rgba(99,102,241,.2);margin-right:3px">Super User</span>
                  <span style="display:inline-flex;align-items:center;padding:2px 7px;border-radius:5px;font-size:9px;font-family:monospace;font-weight:700;background:rgba(16,185,129,.1);color:#10b981;border:1px solid rgba(16,185,129,.2);margin-right:3px">Super Admin</span>
                  can reset or clear this user's PIN.
                </div>
              </div>
            </div>
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

  // ── QB Name: manual input toggle ─────────────────────────────────────────
  const qbNameManualWrap = document.getElementById('u_qb_name_manual_wrap');
  const qbNameManualInput = document.getElementById('u_qb_name_manual');
  const qbNameToggleBtn = document.getElementById('u_qb_name_toggle');

  if (qbNameToggleBtn) {
    qbNameToggleBtn.onclick = () => {
      const isManual = qbNameManualWrap && qbNameManualWrap.style.display !== 'none';
      if (qbNameManualWrap) qbNameManualWrap.style.display = isManual ? 'none' : '';
      if (qbNameSel) qbNameSel.style.display = isManual ? '' : 'none';
      qbNameToggleBtn.textContent = isManual ? '✏️ Enter manually' : '↩ Pick from list';
    };
  }

  let _qbLoadToken = 0;
  let _qbLoadAbort = null;

  async function loadQbNameOptions(currentQbName, _ownerToken) {
    if (!qbNameSel) return;
    // Cancel in-flight request from previous user edit
    if (_qbLoadAbort) { try { _qbLoadAbort.abort(); } catch(_) {} }
    const abortCtrl = new AbortController();
    _qbLoadAbort = abortCtrl;
    const myToken = _ownerToken;

    // Always show current name immediately — don't wait for network
    if (currentQbName) {
      qbNameSel.innerHTML = `<option value="">— Not Assigned —</option><option value="${currentQbName.replace(/"/g,'&quot;')}" selected>${currentQbName.replace(/</g,'&lt;')}</option>`;
      if (qbNameManualInput) qbNameManualInput.value = currentQbName;
    } else {
      qbNameSel.innerHTML = '<option value="">— Not Assigned —</option><option value="" disabled>Loading names…</option>';
    }

    try {
      const tok = window.CloudAuth && typeof CloudAuth.accessToken === 'function' ? CloudAuth.accessToken() : '';
      const res = await fetch('/api/quickbase/assigned_to_names', {
        headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
        signal: abortCtrl.signal
      });
      // STALE-GUARD: Another user was opened while fetch was in-flight
      if (myToken !== _qbLoadToken) return;
      // STALE-GUARD: Another user was opened while this fetch was in-flight — discard
      if (myToken !== _qbLoadToken) return;
      const data = await res.json();

      const names = Array.isArray(data.names) ? data.names : [];

      // Always include the currently assigned name even if not in live list
      const allNames = new Set(names);
      if (currentQbName) allNames.add(currentQbName);
      const sorted = Array.from(allNames).filter(Boolean).sort((a, b) => a.localeCompare(b));

      if (data.ok && sorted.length) {
        qbNameSel.innerHTML = '<option value="">— Not Assigned —</option>' +
          sorted.map(n =>
            `<option value="${n.replace(/"/g,'&quot;')}" ${n === currentQbName ? 'selected' : ''}>${n.replace(/</g,'&lt;')}</option>`
          ).join('');
      } else if (currentQbName) {
        // Keep showing current name at minimum
        qbNameSel.innerHTML = `<option value="">— Not Assigned —</option><option value="${currentQbName.replace(/"/g,'&quot;')}" selected>${currentQbName.replace(/</g,'&lt;')}</option>`;
      } else {
        const msg = data.warning === 'global_qb_not_configured' ? '— Global QB not configured —' : '— No names found —';
        qbNameSel.innerHTML = `<option value="">${msg}</option>`;
      }
    } catch (e) {
      // Keep showing current name on network error
      if (currentQbName) {
        qbNameSel.innerHTML = `<option value="">— Not Assigned —</option><option value="${currentQbName.replace(/"/g,'&quot;')}" selected>${currentQbName.replace(/</g,'&lt;')}</option>`;
      } else {
        qbNameSel.innerHTML = '<option value="">— Network error —</option>';
      }
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
        // Optimistic local removal so UI updates instantly (no flash of deleted user).
        try{ Store.deleteUser(id); }catch(_){ }

        // FIX-DELETE-RACE: Broadcast FIRST so other tabs/sessions get the signal immediately.
        // We do this BEFORE the authoritative re-fetch so the echo from our own rawWrite
        // arrives AFTER Store.refreshUserList() has stamped _refreshUserListAt, making the
        // debounce block the echo and preventing a second redundant fetch from overwriting
        // the correctly-updated store with a potentially-stale result.
        try{
          const rawWrite = (typeof Store.__rawWrite === 'function') ? Store.__rawWrite : (typeof Store.__writeRaw === 'function') ? Store.__writeRaw : null;
          if(rawWrite) rawWrite('mums_user_events', { type:'user_deleted', ts: Date.now(), userId: id }, { silent: true });
          // Use silent:true so the rawWrite itself does NOT fire mums:store on THIS tab.
          // Other tabs get it via the localStorage storage event (cross-tab bridge).
          // This tab does the authoritative refresh below — no duplicate fetch needed.
          if(rawWrite) rawWrite('mums_user_list_updated', { ts: Date.now(), reason:'user_deleted', userId: id }, { silent: true });
        }catch(_){}

        // Single authoritative re-fetch via Store.refreshUserList().
        // - Stamps _refreshUserListAt so the 800ms debounce blocks any echo-triggered calls.
        // - Replaces the old direct refreshIntoLocalStore() call which bypassed the debounce,
        //   allowing a second async fetch to race and re-add the deleted user to the store.
        try{
          if(window.Store && typeof Store.refreshUserList === 'function'){
            await Store.refreshUserList({ reason: 'user_deleted' });
          } else if(window.CloudUsers && typeof CloudUsers.refreshIntoLocalStore === 'function'){
            await CloudUsers.refreshIntoLocalStore();
          }
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
  root.querySelectorAll('[data-close="userProfileModal"]').forEach(b=>b.onclick=()=>UI.closeModal('profileModal'));


function applyDevOptionForRole(role){
  const roleUpper = String(role || '').toUpperCase();
  const isSuperRole = (
    roleUpper === String(Config.ROLES.SUPER_ADMIN) ||
    roleUpper === 'SUPER_USER'
  );
  const sel = UI.el('#u_team');
  if (!sel) return;

  // FIX: style.display on <option> is ignored by Chrome on Windows.
  // Correct approach: physically remove or re-insert the Developer Access option.
  let devOpt = sel.querySelector('option[value=""]');

  if (isSuperRole) {
    // Ensure Developer Access option exists at the top
    if (!devOpt) {
      devOpt = document.createElement('option');
      devOpt.value = '';
      devOpt.textContent = 'Developer Access';
      sel.insertBefore(devOpt, sel.firstChild);
    }
    devOpt.disabled = false;
  } else {
    // Remove Developer Access option entirely for non-super roles
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
  // FIX: preserve Developer Access (empty string) for SUPER_ADMIN and SUPER_USER.
  // Only default to first shift for roles that cannot have Developer Access.
  const editRoleUpper = String((user && user.role) || '').toUpperCase();
  const editIsSuperRole = (
    editRoleUpper === String(Config.ROLES.SUPER_ADMIN) ||
    editRoleUpper === 'SUPER_USER'
  );
  const resolvedTeam = (user && user.teamId !== undefined && user.teamId !== null)
    ? user.teamId
    : (editIsSuperRole ? '' : ((Config.TEAMS[0] && Config.TEAMS[0].id) || 'morning'));
  UI.el('#u_team').value = resolvedTeam;

  // Email is required and explicitly managed as the Microsoft identity.
  UI.el('#u_email').value = (user && user.email) ? String(user.email).trim() : '';
  UI.el('#u_email').readOnly = false;

  // QB Name — load options and pre-select current value
  if (actor && actor.role === Config.ROLES.SUPER_ADMIN) {
    const currentQbName = (user && user.qb_name) ? String(user.qb_name) : '';

    // FIX[QBNAME-STALE]: Reset toggle to default "Pick from list" mode on each user open.
    // Without this: if SA was in manual mode for User A, opening User B keeps manual mode
    // visible and the manual input retains User A's value until async fetch completes.
    const _resetManualWrap  = document.getElementById('u_qb_name_manual_wrap');
    const _resetSel         = document.getElementById('u_qb_name');
    const _resetToggleBtn   = document.getElementById('u_qb_name_toggle');
    const _resetManualInput = document.getElementById('u_qb_name_manual');
    if (_resetManualWrap)  _resetManualWrap.style.display  = 'none';  // hide manual input
    if (_resetSel)         _resetSel.style.display         = '';       // show dropdown
    if (_resetToggleBtn)   _resetToggleBtn.textContent     = '✏️ Enter manually';
    if (_resetManualInput) _resetManualInput.value         = '';       // clear stale value

    // FIX[QBNAME-RACE]: Increment token so any in-flight async fetch from a previous
    // user edit can detect it's stale and discard its result.
    _qbLoadToken = (_qbLoadToken || 0) + 1;
    const _thisUserToken = _qbLoadToken;

    loadQbNameOptions(currentQbName, _thisUserToken);
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
      // QB Name: read from manual input if visible, otherwise from dropdown
      let qbName = undefined;
      if (actor && actor.role === Config.ROLES.SUPER_ADMIN) {
        const manualWrap    = document.getElementById('u_qb_name_manual_wrap');
        const manualInput   = document.getElementById('u_qb_name_manual');
        const dropdownSel   = document.getElementById('u_qb_name');
        const isManual      = manualWrap && manualWrap.style.display !== 'none';
        if (isManual) {
          // FIX[QBNAME-STALE]: Read from manual input — the reset in openUserModal
          // guarantees this value was typed by SA explicitly for THIS user.
          qbName = String((manualInput && manualInput.value) || '').trim();
        } else {
          // Dropdown value is always bound to the current user's options
          qbName = String((dropdownSel && dropdownSel.value) || '').trim();
        }
      }

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

      // Developer Access restriction — allowed for SUPER_ADMIN and SUPER_USER
      const targetRoleUpper = String(role||'').toUpperCase();
      const isSuperRole = (
        targetRoleUpper === String(Config.ROLES.SUPER_ADMIN) ||
        targetRoleUpper === 'SUPER_USER'
      );
      const isEditingExistingSuperRole = isEdit && user && (
        String(user.role||'').toUpperCase() === String(Config.ROLES.SUPER_ADMIN) ||
        String(user.role||'').toUpperCase() === 'SUPER_USER'
      );
      if(!isSuperRole && !isEditingExistingSuperRole && String(teamId||'')===''){
        return err('Developer Access is reserved for Super Admin and Super User roles. Choose Morning/Mid/Night shift.');
      }


      let createdEvent = null;

      if(isCloud){
        if(isEdit){
          // Self edits use update_me (supports SUPER_ADMIN team override)
          if(actor && user && actor.id===user.id && window.CloudUsers && typeof CloudUsers.updateMe === 'function'){
            const patch = { name };
            // FIX: Include qb_name in self-edit patch for SUPER_ADMIN.
            // Previously qb_name was excluded from updateMe — SA editing own
            // account never saved the QB Name. update_me route now accepts qb_name.
            if(actor.role === Config.ROLES.SUPER_ADMIN && qbName !== undefined){
              patch.qb_name = qbName;
            }
            const selfRoleUpper = String(user.role||'').toUpperCase();
            const selfIsSuperRole = (
              selfRoleUpper === String(Config.ROLES.SUPER_ADMIN) ||
              selfRoleUpper === 'SUPER_USER'
            );
            if(selfIsSuperRole){
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
              const targetRoleUp = String(user.role||'').toUpperCase();
              const targetIsSuperRole = (
                targetRoleUp === String(Config.ROLES.SUPER_ADMIN) ||
                targetRoleUp === 'SUPER_USER'
              );
              if(targetIsSuperRole){
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

        // ── REFRESH STORE after save ─────────────────────────────────────────
        // refreshIntoLocalStore() fetches /api/users/list and maps qb_name into
        // the Store.getUsers() array. This MUST be awaited BEFORE renderRows() and
        // BEFORE Edit modal re-opens, otherwise Store still has the stale user object
        // (without qb_name) and the QB Name dropdown shows "— Not Assigned —".
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

  // ── PIN SECURITY BLOCK: show/hide and load status ──────────────────────
  var pinBlock = document.getElementById('u_pin_block');
  var _pinIsEdit = !!user;
  var _pinActorRole = String(actor && actor.role || '').toUpperCase();
  var canManagePins = _pinIsEdit && (_pinActorRole === 'SUPER_ADMIN' || _pinActorRole === 'SUPER_USER' || _pinActorRole === 'TEAM_LEAD');
  if (pinBlock) {
    pinBlock.style.display = canManagePins ? '' : 'none';
    if (canManagePins && user && user.user_id) {
      // Load PIN status for this user
      _loadUserPinStatus(user.user_id, user.name);
      // Wire Reset and Clear buttons
      const resetBtn = document.getElementById('u_pin_reset_btn');
      const clearBtn = document.getElementById('u_pin_clear_btn');
      if (resetBtn) {
        resetBtn.onclick = () => _resetUserPin(user.user_id, user.name, false);
      }
      if (clearBtn) {
        clearBtn.onclick = () => _resetUserPin(user.user_id, user.name, true);
      }
    }
  }
  // ── END PIN BLOCK ─────────────────────────────────────────────────────

  UI.openModal('userModal');
}

// ── PIN helper: load status for a target user ──────────────────────────────
async function _loadUserPinStatus(targetUserId, targetName) {
  const badge = document.getElementById('u_pin_status_badge');
  const statusText = document.getElementById('u_pin_status_text');
  const setPill = document.getElementById('u_pin_set_date');
  const lastUsed = document.getElementById('u_pin_last_used');
  const failCount = document.getElementById('u_pin_fail_count');

  try {
    const tok = window.CloudAuth && typeof CloudAuth.accessToken === 'function' ? CloudAuth.accessToken() : '';
    const res = await fetch('/api/pin/status?target_user_id=' + encodeURIComponent(targetUserId), {
      headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' }
    });
    const data = await res.json().catch(function() { return {}; });

    // Use own status endpoint — admin reading another user requires a different approach
    // Since we only have own-status endpoint, we read from the users list profile data
    // which is already in Store — fall back to Store
    const storeUsers = window.Store && Store.getUsers ? Store.getUsers() : [];
    const targetProfile = storeUsers.find(function(u) {
      return String(u && (u.user_id || u.id || '')) === String(targetUserId);
    });

    const pinSet = !!(targetProfile && targetProfile.pin_hash) || (data.ok && data.pinSet);
    const pinSetAt = (targetProfile && targetProfile.pin_set_at) || (data.ok && data.pinSetAt) || null;
    const pinLastUsed = (targetProfile && targetProfile.pin_last_used_at) || null;
    const fails = (targetProfile && targetProfile.pin_fail_count) || 0;

    if (badge && statusText) {
      if (pinSet) {
        badge.style.background = 'rgba(16,185,129,.1)';
        badge.style.border = '1px solid rgba(16,185,129,.22)';
        badge.style.color = '#10b981';
        statusText.textContent = 'PIN ACTIVE';
        var dot = badge.querySelector('div');
        if (dot) { dot.style.background = '#10b981'; dot.style.boxShadow = '0 0 6px #10b981'; }
      } else {
        badge.style.background = 'rgba(244,63,94,.08)';
        badge.style.border = '1px solid rgba(244,63,94,.2)';
        badge.style.color = '#f43f5e';
        statusText.textContent = 'NOT SET';
        var dot2 = badge.querySelector('div');
        if (dot2) { dot2.style.background = '#f43f5e'; dot2.style.boxShadow = 'none'; }
      }
    }
    if (setPill) {
      setPill.textContent = pinSetAt ? new Date(pinSetAt).toLocaleDateString() : (pinSet ? 'Set' : '—');
    }
    if (lastUsed) {
      lastUsed.textContent = pinLastUsed ? new Date(pinLastUsed).toLocaleDateString() : '—';
      lastUsed.style.color = pinLastUsed ? '#10b981' : 'var(--muted)';
    }
    if (failCount) {
      failCount.textContent = String(fails || 0);
      failCount.style.color = fails > 0 ? '#f43f5e' : '#f59e0b';
    }
  } catch(e) {
    if (statusText) statusText.textContent = 'UNKNOWN';
  }
}

// ── PIN helper: reset or clear a user's PIN ────────────────────────────────
async function _resetUserPin(targetUserId, targetName, forceClear) {
  const label = forceClear ? 'Force Clear' : 'Reset';
  const confirmMsg = forceClear
    ? ('Force clear PIN for ' + (targetName || 'this user') + '? They will be prompted to create a new PIN on next login.')
    : ('Send PIN reset for ' + (targetName || 'this user') + '? Their current PIN will be cleared.');
  if (!window.confirm(confirmMsg)) return;

  const resetBtn = document.getElementById('u_pin_reset_btn');
  const clearBtn = document.getElementById('u_pin_clear_btn');
  var btn = forceClear ? clearBtn : resetBtn;
  if (btn) { btn.disabled = true; btn.textContent = label + 'ing…'; }

  try {
    const tok = window.CloudAuth && typeof CloudAuth.accessToken === 'function' ? CloudAuth.accessToken() : '';
    const res = await fetch('/api/pin/reset', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: targetUserId })
    });
    const data = await res.json().catch(function() { return {}; });
    if (data.ok) {
      if (window.UI && UI.toast) UI.toast(data.message || 'PIN cleared successfully.', 'success');
      // Refresh PIN status display
      _loadUserPinStatus(targetUserId, targetName);
    } else {
      if (window.UI && UI.toast) UI.toast((data.message || 'Failed to reset PIN.'), 'error');
    }
  } catch(e) {
    if (window.UI && UI.toast) UI.toast('Network error. Please try again.', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = forceClear
        ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Force Clear PIN'
        : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Send Reset Request';
    }
  }
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
