/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Strictly protects Enterprise UI/UX, Realtime Sync Logic, Core State Management, and Database/API Adapters. Do NOT modify existing logic or layout in this file without explicitly asking MACE for clearance. If overlapping changes are required, STOP and provide a RISK IMPACT REPORT first. */
(window.Pages=window.Pages||{}, window.Pages.gmt_overview = function(root){
  const u = (window.Auth && Auth.getUser) ? Auth.getUser() : null;
  if(!u){
    root.innerHTML = `<div class="card pad"><div class="h2" style="margin:0 0 6px">Not signed in</div><div class="small muted">Please login again.</div></div>`;
    return;
  }

  const WU = window.WorldClockUtils || {};
  const OFFSETS = Array.isArray(WU.GMT_OFFSETS_MINUTES) ? WU.GMT_OFFSETS_MINUTES : [
    -720,-660,-600,-570,-540,-480,-420,-360,-300,-240,-210,-180,-120,-60,
    0,60,120,180,210,240,270,300,330,345,360,390,420,480,525,540,570,600,630,660,690,720,765,780,840
  ];
  const gmtLabel = (mins)=> (WU.gmtLabelFromMinutes ? WU.gmtLabelFromMinutes(mins) : (function(m){
    const mm = Number(m)||0;
    const sign = mm>=0?'+':'-';
    const abs = Math.abs(mm);
    const hh = String(Math.floor(abs/60)).padStart(2,'0');
    const mi = String(abs%60).padStart(2,'0');
    return `GMT${sign}${hh}:${mi}`;
  })(mins));
  const fmtParts = (now, clock)=> (WU.formatTimePartsForClock ? WU.formatTimePartsForClock(now, clock) : {hh:'00',mm:'00',ss:'00'});

  root.innerHTML = `
    <div class="page gmt-page">
      <div class="page-head">
        <div>
          <div class="h2" style="margin:0">GMT Overview</div>
          <div class="small muted" style="margin-top:6px">Enterprise time reference for all global GMT/UTC offsets. Pin offsets as World Clocks for fast access.</div>
        </div>
        <div class="row" style="gap:10px;flex-wrap:wrap;justify-content:flex-end">
          <button class="btn ghost" id="gmtOpenSettings" type="button">Open Settings</button>
          <button class="btn" id="gmtOpenClockModal" type="button">Configure World Clocks</button>
        </div>
      </div>

      <div class="gmt-page-layout" style="margin-top:14px">
        <div class="card pad">
          <div class="row" style="justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap">
            <div>
              <div class="settings-card-title">Pinned World Clocks</div>
              <div class="small muted" style="margin-top:6px">These clocks appear in the bottom bar across the app.</div>
            </div>
            <div class="row" style="gap:8px;flex-wrap:wrap">
              <button class="btn ghost" id="gmtDisableAll" type="button">Disable all</button>
              <button class="btn ghost" id="gmtEnableAll" type="button">Enable all</button>
            </div>
          </div>

          <div class="table" style="margin-top:12px;overflow:auto">
            <table style="width:100%;min-width:480px">
              <thead>
                <tr>
                  <th style="text-align:left">Clock</th>
                  <th style="text-align:left">Now</th>
                  <th style="text-align:left">Enabled</th>
                  <th style="text-align:right">Actions</th>
                </tr>
              </thead>
              <tbody id="gmtPinnedBody"></tbody>
            </table>
          </div>

          <div class="small muted" style="margin-top:10px">Tip: use <b>Configure World Clocks</b> to set style, colors, and alarms.</div>
        </div>

        <div class="card pad">
          <div class="row" style="justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap">
            <div>
              <div class="settings-card-title">All GMT offsets</div>
              <div class="small muted" style="margin-top:6px">Click an offset tile to pin it as a clock.</div>
            </div>
            <div style="min-width:260px;max-width:520px;flex:1">
              <input class="input" id="gmtSearch" placeholder="Search offsets (e.g., +08, 5:30, GMT+10)" />
            </div>
          </div>
          <div class="gmt-grid" id="gmtGrid" style="margin-top:12px"></div>
        </div>
      </div>
    </div>
  `;

  const $ = (sel)=>root.querySelector(sel);
  const pinnedBody = $('#gmtPinnedBody');
  const grid = $('#gmtGrid');
  const search = $('#gmtSearch');

  function getPinned(){
    try{ return (window.Store && Store.getWorldClocks) ? Store.getWorldClocks().slice() : []; }catch(_){ return []; }
  }

  function savePinned(next){
    try{ if(Store && Store.dispatch) Store.dispatch('UPDATE_CLOCKS', next); else Store.saveWorldClocks(next); }catch(e){ try{ Store.saveWorldClocks(next); }catch(_){} }
    try{ if(window.Renderers && Renderers.renderClocks) Renderers.renderClocks(); }catch(_){ }
  }

  function renderPinned(){
    const list = getPinned();
    const now = new Date();
    const rows = list.map((c, idx)=>{
      const label = String(c && (c.label || (WU.clockZoneLabel ? WU.clockZoneLabel(c) : 'Clock')) || 'Clock');
      const t = fmtParts(now, c);
      const tz = (WU.clockZoneLabel ? WU.clockZoneLabel(c) : (c.timeZone||'UTC'));
      return `
        <tr data-idx="${idx}">
          <td>
            <div style="font-weight:800">${UI.esc(label)}</div>
            <div class="small muted">${UI.esc(tz)}</div>
          </td>
          <td style="font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;font-weight:900">
            <span data-now="1">${UI.esc(t.hh)}:${UI.esc(t.mm)}:${UI.esc(t.ss)}</span>
          </td>
          <td>
            <label class="row small" style="gap:8px;align-items:center">
              <input type="checkbox" class="gmt-enabled" ${c && c.enabled ? 'checked' : ''} />
              <span class="muted">${c && c.enabled ? 'On' : 'Off'}</span>
            </label>
          </td>
          <td style="text-align:right">
            <button class="btn ghost gmt-remove" type="button">Remove</button>
          </td>
        </tr>
      `;
    }).join('');
    pinnedBody.innerHTML = rows || `<tr><td colspan="4" class="small muted">No pinned clocks yet. Click an offset tile to add one.</td></tr>`;
  }

  function renderGrid(){
    const q = String(search.value||'').trim().toLowerCase();
    const now = new Date();
    const pinned = getPinned();
    const isPinned = (mins)=> pinned.some(c=> Number(c && c.offsetMinutes) === Number(mins));

    const filtered = OFFSETS.filter((mins)=>{
      if(!q) return true;
      const label = gmtLabel(mins).toLowerCase();
      return label.includes(q) || String(mins).includes(q) || String(mins/60).includes(q);
    });

    const html = filtered.map((mins)=>{
      const t = fmtParts(now, { offsetMinutes: mins });
      const pinnedMark = isPinned(mins);
      return `
        <button class="gmt-tile" type="button" data-off="${mins}" title="Click to pin">
          <div class="gmt-tile-top">
            <div class="small" style="font-weight:900;display:flex;gap:8px;align-items:center">
              <span>${UI.esc(gmtLabel(mins))}</span>
              ${pinnedMark ? '<span class="chip" style="padding:2px 8px">Pinned</span>' : ''}
            </div>
            <div class="gmt-tile-time">${UI.esc(t.hh)}:${UI.esc(t.mm)}</div>
          </div>
          <div class="small muted">${pinnedMark ? 'Already pinned' : 'Click to pin'}</div>
        </button>
      `;
    }).join('');
    grid.innerHTML = html;
  }

  function pinOffset(mins){
    const m = Number(mins);
    if(!Number.isFinite(m)) return;
    const cur = getPinned();
    const exists = cur.some(c=> Number(c && c.offsetMinutes) === m);
    if(exists) return;
    cur.push({
      enabled: true,
      label: gmtLabel(m),
      timeZone: 'UTC',
      offsetMinutes: m,
      hoursColor: '#EAF3FF',
      minutesColor: '#9BD1FF',
      alarmEnabled: false,
      alarmTime: '09:00',
      style: 'classic'
    });
    savePinned(cur);
    renderPinned();
    renderGrid();
  }

  function setAllEnabled(on){
    const cur = getPinned();
    cur.forEach(c=>{ if(c) c.enabled = !!on; });
    savePinned(cur);
    renderPinned();
  }

  // Actions
  $('#gmtOpenSettings').onclick = ()=>{ try{ UI.openModal('settingsModal'); }catch(_){ } };
  $('#gmtOpenClockModal').onclick = ()=>{
    try{ UI.openModal('settingsModal'); }catch(_){ }
    try{ const btn = document.getElementById('openClocksBtn'); if(btn) btn.click(); }catch(_){ }
  };
  $('#gmtDisableAll').onclick = ()=>setAllEnabled(false);
  $('#gmtEnableAll').onclick = ()=>setAllEnabled(true);

  search.addEventListener('input', ()=>{ renderGrid(); });

  // Delegation
  root.addEventListener('click', (e)=>{
    const offBtn = e.target && e.target.closest ? e.target.closest('[data-off]') : null;
    if(offBtn){
      pinOffset(offBtn.getAttribute('data-off'));
      return;
    }
    const rm = e.target && e.target.closest ? e.target.closest('.gmt-remove') : null;
    if(rm){
      const tr = rm.closest('tr');
      const idx = tr ? Number(tr.getAttribute('data-idx')) : NaN;
      if(Number.isFinite(idx)){
        const cur = getPinned();
        cur.splice(idx, 1);
        savePinned(cur);
        renderPinned();
        renderGrid();
      }
      return;
    }
  });

  root.addEventListener('change', (e)=>{
    const box = e.target && e.target.classList && e.target.classList.contains('gmt-enabled') ? e.target : null;
    if(!box) return;
    const tr = box.closest('tr');
    const idx = tr ? Number(tr.getAttribute('data-idx')) : NaN;
    if(!Number.isFinite(idx)) return;
    const cur = getPinned();
    if(cur[idx]) cur[idx].enabled = !!box.checked;
    savePinned(cur);
    renderPinned();
  });

  // Initial paint
  renderPinned();
  renderGrid();

  // Lightweight ticker for visible time values (only while this page is active)
  let timer = null;
  function tick(){
    try{
      const now = new Date();
      // Update pinned seconds
      pinnedBody.querySelectorAll('tr[data-idx]').forEach((tr)=>{
        const idx = Number(tr.getAttribute('data-idx'));
        const cur = getPinned();
        const c = cur[idx];
        if(!c) return;
        const t = fmtParts(now, c);
        const span = tr.querySelector('[data-now]');
        if(span) span.textContent = `${t.hh}:${t.mm}:${t.ss}`;
      });
      // Update grid minute precision only (cheaper)
      grid.querySelectorAll('[data-off]').forEach((b)=>{
        const mins = Number(b.getAttribute('data-off'));
        if(!Number.isFinite(mins)) return;
        const t = fmtParts(now, { offsetMinutes: mins });
        const timeEl = b.querySelector('.gmt-tile-time');
        if(timeEl) timeEl.textContent = `${t.hh}:${t.mm}`;
      });
    }catch(_){ }
  }
  timer = setInterval(tick, 1000);
  root._cleanup = ()=>{ try{ if(timer) clearInterval(timer); }catch(_){} };
});
