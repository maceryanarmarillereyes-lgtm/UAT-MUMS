/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Strictly protects Enterprise UI/UX, Realtime Sync Logic, Core State Management, and Database/API Adapters. Do NOT modify existing logic or layout in this file without explicitly asking MACE for clearance. If overlapping changes are required, STOP and provide a RISK IMPACT REPORT first. */
(window.Pages=window.Pages||{}, window.Pages.privileges = function(root){
  const me = Auth.getUser();
  if(!me || !Config.can(me, 'manage_privileges')){
    root.innerHTML = `
      <div class="card">
        <h2 style="margin:0 0 6px">Privileges</h2>
        <div class="small muted">Access denied. Only Super Admin can manage privileges.</div>
      </div>`;
    return;
  }

  const FEATURES = [
    { key:'profile', label:'Profile' },
    { key:'sound', label:'Notification Sound' },
    { key:'theme', label:'Theme' },
    { key:'quicklinks', label:'Quick Links' },
    { key:'worldclocks', label:'World Clocks' },
    { key:'cursor', label:'Cursor' },
    { key:'sidebar', label:'Sidebar' },
    { key:'datatools', label:'Data Tools' },
  ];

  // Delegatable privileges (mapped to existing permissions/pages)
  const DELEGATE = [
    { perm:'view_master_schedule', label:'Master Schedule', page:'#master_schedule', desc:'View the Master Schedule page.' },
    { perm:'create_users', label:'User Management', page:'#users', desc:'Access User Management for create/edit/delete.' },
    { perm:'manage_announcements', label:'Announcement', page:'#announcements', desc:'Create and publish team announcements.' },
  ];

  const roles = [Config.ROLES.SUPER_ADMIN, Config.ROLES.SUPER_USER, Config.ROLES.ADMIN, Config.ROLES.TEAM_LEAD, Config.ROLES.MEMBER];

  const roleFeatures = Store.getRoleSettingsFeatures();
  const rolePermOv = Store.getRolePermOverrides();

  const users = Store.getUsers().slice().sort((a,b)=>String(a.username||'').localeCompare(String(b.username||'')));

  const safeRoleName = (r)=> String(r||'').replace(/_/g,' ').toLowerCase().replace(/\b\w/g, m=>m.toUpperCase());

  function effectiveRolePerm(role, perm){
    const base = (Config.PERMS[role]||[]).includes('*') || (Config.PERMS[role]||[]).includes(perm);
    const ov = rolePermOv && rolePermOv[role] && Object.prototype.hasOwnProperty.call(rolePermOv[role], perm) ? !!rolePermOv[role][perm] : null;
    return (ov===null) ? base : ov;
  }

  root.innerHTML = `
    <div class="row" style="justify-content:space-between;align-items:flex-end;gap:10px;flex-wrap:wrap">
      <div>
        <h2 style="margin:0 0 6px">Privileges</h2>
        <div class="small muted">Configure default privileges by role and delegate additional privileges to specific users. Delegated privileges appear under <b>Commands</b> for the target user.</div>
      </div>
      <button class="btn" id="pvExport">Export JSON</button>
    </div>

    <div class="grid2" style="margin-top:12px">
      <div class="card">
        <div class="announce-title">Role Settings Visibility</div>
        <div class="small muted" style="margin-top:6px">Select which Settings cards are visible per role.</div>
        <div style="overflow:auto;margin-top:10px">
          <table class="table">
            <thead>
              <tr>
                <th>Role</th>
                ${FEATURES.map(f=>`<th class="small">${UI.esc(f.label)}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${roles.map(r=>{
                const rf = roleFeatures[r] || {};
                return `<tr data-role="${r}">
                  <td><b>${UI.esc(safeRoleName(r))}</b></td>
                  ${FEATURES.map(f=>{
                    const ck = !!rf[f.key];
                    return `<td style="text-align:center"><input type="checkbox" data-kind="feat" data-key="${f.key}" ${ck?'checked':''}></td>`;
                  }).join('')}
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
        <div class="row" style="justify-content:flex-end;margin-top:10px">
          <button class="btn primary" id="pvSaveFeatures">Save</button>
        </div>
      </div>

      <div class="card">
        <div class="announce-title">Role Defaults</div>
        <div class="small muted" style="margin-top:6px">Set default privileges for roles (overrides can disable or enable).</div>

        <div style="margin-top:10px">
          <div class="small" style="font-weight:900;margin-bottom:8px">Team Lead</div>
          ${DELEGATE.filter(d=>['view_master_schedule','create_users'].includes(d.perm)).map(d=>{
            const ck = effectiveRolePerm(Config.ROLES.TEAM_LEAD, d.perm);
            return `<label class="row" style="gap:10px;align-items:center;margin:6px 0">
              <input type="checkbox" data-kind="roleperm" data-role="${Config.ROLES.TEAM_LEAD}" data-perm="${d.perm}" ${ck?'checked':''}>
              <div>
                <div style="font-weight:800">${UI.esc(d.label)}</div>
                <div class="small muted">${UI.esc(d.desc)}</div>
              </div>
            </label>`;
          }).join('')}
        </div>

        <div class="small muted" style="margin-top:10px">Note: Super Admin is always allowed. Role overrides are stored locally on this device/browser.</div>

        <div class="row" style="justify-content:flex-end;margin-top:10px">
          <button class="btn primary" id="pvSaveRolePerms">Save</button>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:12px">
      <div class="row" style="justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <div>
          <div class="announce-title">User Delegation</div>
          <div class="small muted" style="margin-top:6px">Assign additional privileges to a user. The user will see a <b>Commands</b> menu with the assigned privileges.</div>
        </div>
        <div class="row" style="gap:8px;align-items:center">
          <input class="input" id="pvSearch" placeholder="Search user..." style="max-width:260px">
          <label class="btn" style="cursor:pointer">
            Import JSON<input id="pvImport" type="file" accept="application/json" style="display:none">
          </label>
        </div>
      </div>

      <div style="overflow:auto;margin-top:10px">
        <table class="table" id="pvUsersTbl">
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th>Team</th>
              ${DELEGATE.map(d=>`<th class="small">${UI.esc(d.label)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${users.map(u=>{
              const extras = Store.getUserExtraPrivs(u.id);
              return `<tr data-user="${u.id}">
                <td>
                  <div style="font-weight:900">${UI.esc(u.name||u.username)}</div>
                  <div class="small muted">${UI.esc(u.username||'')}</div>
                </td>
                <td class="small">${UI.esc(safeRoleName(u.role))}</td>
                <td class="small">${UI.esc(Config.teamById(u.teamId).label)}</td>
                ${DELEGATE.map(d=>{
                  const ck = extras.includes(d.perm);
                  return `<td style="text-align:center"><input type="checkbox" data-kind="userperm" data-user="${u.id}" data-perm="${d.perm}" ${ck?'checked':''}></td>`;
                }).join('')}
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>

      <div class="row" style="justify-content:flex-end;margin-top:10px">
        <button class="btn primary" id="pvSaveUsers">Save</button>
      </div>
    </div>

    <div class="modal" id="pvJsonModal">
      <div class="panel">
        <div class="head">
          <div>
            <div class="announce-title">Privileges JSON</div>
            <div class="small muted">Export/import role visibility + delegated privileges.</div>
          </div>
          <button class="btn ghost" data-close="pvJsonModal">✕</button>
        </div>
        <div class="body">
          <textarea class="input" id="pvJsonText" style="height:320px;font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace"></textarea>
          <div class="row" style="justify-content:flex-end;gap:8px;margin-top:10px">
            <button class="btn" data-close="pvJsonModal">Close</button>
            <button class="btn primary" id="pvCopy">Copy</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const state = {
    roleFeatures: JSON.parse(JSON.stringify(roleFeatures)),
    rolePermOv: JSON.parse(JSON.stringify(rolePermOv||{})),
    userMap: users.reduce((acc,u)=>{
      acc[u.id] = Store.getUserExtraPrivs(u.id).slice();
      return acc;
    }, {})
  };

  // live edits
  root.querySelectorAll('tr[data-role] input[data-kind="feat"]').forEach(cb=>{
    cb.addEventListener('change', ()=>{
      const tr = cb.closest('tr[data-role]');
      const role = tr ? tr.dataset.role : null;
      if(!role) return;
      state.roleFeatures[role] = state.roleFeatures[role] || {};
      state.roleFeatures[role][cb.dataset.key] = cb.checked;
    });
  });

  root.querySelectorAll('input[data-kind="roleperm"]').forEach(cb=>{
    cb.addEventListener('change', ()=>{
      const role = cb.dataset.role;
      const perm = cb.dataset.perm;
      state.rolePermOv[role] = state.rolePermOv[role] || {};
      state.rolePermOv[role][perm] = cb.checked;
    });
  });

  root.querySelectorAll('input[data-kind="userperm"]').forEach(cb=>{
    cb.addEventListener('change', ()=>{
      const userId = cb.dataset.user;
      const perm = cb.dataset.perm;
      const arr = state.userMap[userId] || [];
      const has = arr.includes(perm);
      if(cb.checked && !has) arr.push(perm);
      if(!cb.checked && has) arr.splice(arr.indexOf(perm), 1);
      state.userMap[userId] = Array.from(new Set(arr));
    });
  });

  const saveFeaturesBtn = root.querySelector('#pvSaveFeatures');
  if(saveFeaturesBtn) saveFeaturesBtn.onclick = ()=>{
    Store.setRoleSettingsFeatures(state.roleFeatures);
    UI.toast && UI.toast('Role settings visibility saved.');
  };

  const saveRolePermsBtn = root.querySelector('#pvSaveRolePerms');
  if(saveRolePermsBtn) saveRolePermsBtn.onclick = ()=>{
    try{ localStorage.setItem('mums_role_perm_overrides', JSON.stringify(state.rolePermOv)); }catch(_){}
    UI.toast && UI.toast('Role defaults saved.');
  };

  const saveUsersBtn = root.querySelector('#pvSaveUsers');
  if(saveUsersBtn) saveUsersBtn.onclick = ()=>{
    Object.keys(state.userMap).forEach(uid=>{
      Store.setUserExtraPrivs(uid, state.userMap[uid]||[]);
    });
    UI.toast && UI.toast('Delegated privileges saved.');
  };

  // search filter
  const search = root.querySelector('#pvSearch');
  const filterRows = ()=>{
    const q = String(search.value||'').trim().toLowerCase();
    const rows = root.querySelectorAll('#pvUsersTbl tbody tr');
    rows.forEach(r=>{
      const uid = r.dataset.user;
      const u = users.find(x=>x.id===uid);
      const hay = `${u.name||''} ${u.username||''} ${u.role||''} ${u.teamId||''}`.toLowerCase();
      r.style.display = (!q || hay.includes(q)) ? '' : 'none';
    });
  };
  if(search) search.oninput = filterRows;

  // Export/import JSON for portability
  const exportBtn = root.querySelector('#pvExport');
  const jsonModal = 'pvJsonModal';
  if(exportBtn){
    exportBtn.onclick = ()=>{
      const payload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        roleSettingsFeatures: Store.getRoleSettingsFeatures(),
        rolePermOverrides: Store.getRolePermOverrides(),
        userExtraPrivs: Store.getUserExtraPrivsMap(),
      };
      const txt = JSON.stringify(payload, null, 2);
      const ta = root.querySelector('#pvJsonText');
      if(ta) ta.value = txt;
      UI.openModal(jsonModal);
    };
  }
  const copyBtn = root.querySelector('#pvCopy');
  if(copyBtn){
    copyBtn.onclick = async ()=>{
      const ta = root.querySelector('#pvJsonText');
      if(!ta) return;
      try{ await navigator.clipboard.writeText(ta.value||''); UI.toast && UI.toast('Copied.'); }catch(_){ }
    };
  }

  const importInput = root.querySelector('#pvImport');
  if(importInput){
    importInput.onchange = async ()=>{
      const file = importInput.files && importInput.files[0];
      if(!file) return;
      try{
        const txt = await file.text();
        const data = JSON.parse(txt);
        if(!data || typeof data !== 'object') throw new Error('Invalid JSON');
        if(data.roleSettingsFeatures) Store.setRoleSettingsFeatures(data.roleSettingsFeatures);
        if(data.rolePermOverrides) localStorage.setItem('mums_role_perm_overrides', JSON.stringify(data.rolePermOverrides));
        if(data.userExtraPrivs && typeof data.userExtraPrivs === 'object'){
          localStorage.setItem('mums_user_extra_privs', JSON.stringify(data.userExtraPrivs));
        }
        UI.toast && UI.toast('Imported. Reloading page…');
        setTimeout(()=>{ window.location.hash = '#privileges'; }, 150);
        setTimeout(()=>{ window.location.reload(); }, 300);
      }catch(e){
        alert('Import failed: ' + (e && e.message ? e.message : e));
      }finally{
        importInput.value = '';
      }
    };
  }
});