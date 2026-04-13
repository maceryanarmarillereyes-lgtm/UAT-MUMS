/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */


/* File: public/js/app.js */

(function(){
  let cleanup = null;
  let annTimer = null;
  let notifCleanup = null;

  // State for Super Admin Theme Manager
  let __themeEditMode = false;
  let __themeMeta = {};
  let __themeMetaLoaded = false;
  let __themeMetaLoading = null;
  let __globalThemeSettings = { defaultTheme: 'apex', brightness: 130, forcedTheme: false, forcedBrightness: false };
  let __globalThemeLoaded = false;
  let __globalThemeLoading = null;

  function getBearerToken(){
    try{
      const t = (window.CloudAuth && CloudAuth.accessToken) ? String(CloudAuth.accessToken()||'').trim() : '';
      if(t) return t;
    }catch(_){ }
    try{
      const sess = (window.CloudAuth && CloudAuth.loadSession) ? CloudAuth.loadSession() : null;
      const t2 = sess && sess.access_token ? String(sess.access_token).trim() : '';
      return t2 || '';
    }catch(_){ }
    return '';
  }

  function normalizeThemeMeta(raw){
    const out = {};
    const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    Object.keys(src).forEach((themeId)=>{
      const id = String(themeId||'').trim();
      if(!id) return;
      const node = src[themeId];
      if(!node || typeof node !== 'object' || Array.isArray(node)) return;
      const hidden = !!node.hidden;
      const deleted = !!node.deleted;
      if(!hidden && !deleted) return;
      out[id] = { hidden, deleted };
    });
    return out;
  }

  function getThemeCatalog(){
    return (Config && Array.isArray(Config.THEMES)) ? Config.THEMES : [];
  }

  function isValidThemeId(themeId){
    const id = String(themeId||'').trim();
    if(!id) return false;
    return getThemeCatalog().some(t => String(t && t.id || '').trim() === id);
  }

  function getThemeName(themeId){
    const id = String(themeId||'').trim();
    const found = getThemeCatalog().find(t => String(t && t.id || '').trim() === id);
    return found && found.name ? String(found.name) : id || 'Unknown Theme';
  }

  async function loadGlobalThemeSettings(force){
    if(__globalThemeLoaded && !force) return __globalThemeSettings;
    if(__globalThemeLoading) return __globalThemeLoading;

    __globalThemeLoading = (async ()=>{
      try{
        const token = getBearerToken();
        const headers = { 'Content-Type': 'application/json' };
        if(token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch('/api/settings/global-theme', { method: 'GET', headers, cache: 'no-store' });
        const data = await res.json().catch(()=>({}));
        if(res.ok && data && data.ok){
          const normalized = String(data.defaultTheme || '').trim();
          __globalThemeSettings = {
            defaultTheme:    isValidThemeId(normalized) ? normalized : 'apex',
            brightness:      typeof data.brightness === 'number' ? data.brightness : 130,
            forcedTheme:     data.forcedTheme      === true,
            forcedBrightness:data.forcedBrightness === true,
            forcedAt:        data.forcedAt         || null,
            forcedByName:    data.forcedByName     || null,
          };
          __globalThemeLoaded = true;
        } else {
          console.warn('Failed to load global theme settings:', data.error || res.status);
        }
      }catch(e){
        console.warn('loadGlobalThemeSettings error:', e);
      }finally{
        __globalThemeLoading = null;
      }
      return __globalThemeSettings;
    })();

    return __globalThemeLoading;
  }

  function resolveEffectiveThemeForUser(){
    const fromStore = String((Store && Store.getTheme) ? (Store.getTheme() || '') : '').trim();
    if(isValidThemeId(fromStore)) return fromStore;

    const fromGlobal = String(__globalThemeSettings && __globalThemeSettings.defaultTheme || '').trim();
    if(isValidThemeId(fromGlobal)) return fromGlobal;

    const catalog = getThemeCatalog();
    return catalog[0] && catalog[0].id ? String(catalog[0].id) : 'apex';
  }

  async function loadThemeMeta(force){
    if(__themeMetaLoaded && !force) return __themeMeta;
    if(__themeMetaLoading) return __themeMetaLoading;

    __themeMetaLoading = (async ()=>{
      try{
        const token = getBearerToken();
        const headers = { 'Content-Type': 'application/json' };
        if(token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch('/api/theme_access/get', { method: 'GET', headers, cache: 'no-store' });
        const data = await res.json().catch(()=>({}));
        if(res.ok && data.ok && data.meta){
          __themeMeta = normalizeThemeMeta(data.meta);
          __themeMetaLoaded = true;
        } else {
          console.warn('Failed to load theme meta:', data.error || res.status);
        }
      }catch(e){
        console.error('loadThemeMeta error:', e);
      }finally{
        __themeMetaLoading = null;
      }
      return __themeMeta;
    })();

    return __themeMetaLoading;
  }

  async function saveThemeMeta(newMeta){
    try{
      const token = getBearerToken();
      const headers = { 'Content-Type': 'application/json' };
      if(token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/theme_access/set', {
        method: 'POST',
        headers,
        body: JSON.stringify({ meta: newMeta })
      });
      const data = await res.json().catch(()=>({}));
      if(!res.ok || !data.ok){
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      __themeMeta = normalizeThemeMeta(data.meta || newMeta);
      return { ok: true };
    }catch(e){
      console.error('saveThemeMeta error:', e);
      return { ok: false, message: e.message };
    }
  }

  function showFatalError(err){
    try{
      console.error(err);
      try{
        if(window.Store && Store.addLog){
          const u = (window.Auth && Auth.getUser) ? Auth.getUser() : null;
          Store.addLog({
            ts: Date.now(),
            teamId: (u && u.teamId) ? u.teamId : 'system',
            actorId: (u && u.id) ? u.id : 'system',
            actorName: (u && u.name) ? u.name : 'SYSTEM',
            action: 'APP_ERROR',
            msg: String(err && (err.message||err)) ,
            detail: String((err && err.stack) ? err.stack : '')
          });
        }
      }catch(__){}
      const main = document.getElementById('main');
      if(main){
        main.innerHTML = `
          <div class="card pad" style="border:1px solid rgba(255,80,80,.35)">
            <div class="h2" style="margin:0 0 8px">Something went wrong</div>
            <div class="small" style="white-space:pre-wrap;opacity:.9">${UI && UI.esc ? UI.esc(String(err && (err.stack||err.message||err))) : String(err)}</div>
            <div class="small muted" style="margin-top:10px">Tip: try Logout → Login, or hard refresh (Ctrl+Shift+R). If it still happens, send the console error screenshot.</div>
          </div>
        `;
      }
    }catch(_){ }
  }

  try{
    if(!window.__mumsGlobalErrorBound){
      window.__mumsGlobalErrorBound = true;
      window.addEventListener('error', (ev)=>{
        try{
          if(ev && ev.target && (ev.target.tagName === 'SCRIPT' || ev.target.tagName === 'LINK')) return;
          const err = (ev && ev.error) ? ev.error : new Error(String(ev && ev.message || 'Unknown error'));
          showFatalError(err);
        }catch(_){ }
      });
      window.addEventListener('unhandledrejection', (ev)=>{
        try{
          const reason = ev && ev.reason;
          const err = (reason instanceof Error) ? reason : new Error(String(reason || 'Unhandled promise rejection'));
          showFatalError(err);
        }catch(_){ }
      });
    }
  }catch(_){ }

  function fitText(el, minPx, maxPx){
    try{
      if(!el) return;
      const min = Number(minPx||12);
      const max = Number(maxPx||22);
      el.style.fontSize = max + 'px';
      void el.offsetHeight;
      let cur = max;
      while(cur > min && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1)){
        cur -= 1;
        el.style.fontSize = cur + 'px';
      }
    }catch(e){ }
  }

  function applyTheme(themeId){
    const themes = (Config && Array.isArray(Config.THEMES)) ? Config.THEMES : [];
    const t = themes.find(x=>x.id===themeId) || themes[0];
    if(!t) return;

    let modePref = (t.mode ? String(t.mode) : (String(t.id||'').includes('light') ? 'light' : 'dark'));
    let mode = modePref;
    if(modePref === 'auto'){
      try{
        mode = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
      }catch(_){ mode = 'light'; }
    }

    let tt = t;
    if(modePref === 'auto' && mode === 'dark' && t.dark && typeof t.dark === 'object'){
      try{ tt = Object.assign({}, t, t.dark); }catch(_){ tt = t; }
    }

    const r = document.documentElement;
    r.style.setProperty('--bg', tt.bg);
    r.style.setProperty('--panel', tt.panel);
    r.style.setProperty('--panel2', tt.panel2);
    r.style.setProperty('--text', tt.text);
    r.style.setProperty('--muted', tt.muted);
    r.style.setProperty('--border', tt.border);
    r.style.setProperty('--accent', tt.accent);

    try{
      const hex = String(tt.accent||'').trim();
      const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
      if(m){
        const s = m[1];
        const rr = parseInt(s.slice(0,2), 16);
        const gg = parseInt(s.slice(2,4), 16);
        const bb = parseInt(s.slice(4,6), 16);
        r.style.setProperty('--accent-rgb', `${rr},${gg},${bb}`);
      }else{
        r.style.setProperty('--accent-rgb', '74,163,255');
      }
    }catch(_){ r.style.setProperty('--accent-rgb', '74,163,255'); }

    r.style.setProperty('--bgRad1', tt.bgRad1);
    r.style.setProperty('--bgRad3', tt.bgRad3);

    try{
      if(tt.font) r.style.setProperty('--font', tt.font); else r.style.removeProperty('--font');
      if(tt.radius) r.style.setProperty('--radius', tt.radius); else r.style.removeProperty('--radius');
      if(tt.shadow) r.style.setProperty('--shadow', tt.shadow); else r.style.removeProperty('--shadow');
    }catch(_){ }
    try{
      document.body.dataset.theme = t.id;
      document.body.dataset.mode = mode;
      document.documentElement.dataset.mode = mode;
      
      try{
        r.style.setProperty("--surface-0", tt.bg);
        r.style.setProperty("--surface-1", tt.panel);
        r.style.setProperty("--surface-2", tt.panel2);
        r.style.setProperty("--text-0", tt.text);
        r.style.setProperty("--text-muted", tt.muted);
        r.style.setProperty("--border-0", tt.border);
        const isLight = mode === "light";
        r.style.setProperty("--control-bg", isLight ? "rgba(255,255,255,.92)" : "rgba(18,24,38,.92)");
        r.style.setProperty("--control-border", isLight ? "rgba(15,23,42,.12)" : tt.border);
        r.style.setProperty("--control-text", tt.text);
        r.style.setProperty("--overlay-scrim", isLight ? "rgba(15,23,42,.40)" : "rgba(0,0,0,.55)");
        r.style.setProperty("--btn-glass-top", isLight ? "rgba(15,23,42,.04)" : "rgba(255,255,255,.08)");
        r.style.setProperty("--btn-glass-bot", isLight ? "rgba(15,23,42,.02)" : "rgba(255,255,255,.02)");
        r.style.setProperty("--accent-contrast", chooseAccentText(tt.accent));
      }catch(_){ }

      try{ window.dispatchEvent(new CustomEvent("mums:themeApplied", { detail: { id: t.id, mode } })); }catch(_){ }
      try{ if(typeof renderThemeAudit === "function") renderThemeAudit(); }catch(_){ }

    }catch(e){}
  }

  function _parseColor(str){
    const s = String(str||'').trim();
    let m = /^#?([0-9a-f]{3})$/i.exec(s);
    if(m){
      const h = m[1];
      return [int(h[0]*2), int(h[1]*2), int(h[2]*2)];
    }
    m = /^#?([0-9a-f]{6})$/i.exec(s);
    if(m){
      const h = m[1];
      return [int(h.slice(0,2)), int(h.slice(2,4)), int(h.slice(4,6))];
    }
    m = /^rgba?\(([^)]+)\)$/i.exec(s);
    if(m){
      const parts = m[1].split(',').map(x=>parseFloat(x));
      if(parts.length>=3) return [clamp(parts[0]), clamp(parts[1]), clamp(parts[2])];
    }
    return [255,255,255];

    function int(hex){ return parseInt(hex,16); }
    function clamp(n){ n = Number(n); if(!Number.isFinite(n)) return 0; return Math.max(0, Math.min(255, n)); }
  }

  function applySettingsVisibility(user){
    try{
      if(!user || !window.Store || !Store.getRoleSettingsFeatures) return;

      const rawRole = String(user.role||'').trim();
      const role = (Store && Store.normalizeRole) ? Store.normalizeRole(rawRole)
        : rawRole.toUpperCase().replace(/\s+/g,'_').replace(/-+/g,'_');

      const all = Store.getRoleSettingsFeatures();
      const feats = (all && all[role]) ? all[role] : null;

      const hasAny = feats && typeof feats==='object' && Object.keys(feats).length>0;
      if(!hasAny){
        document.querySelectorAll('.settings-card').forEach(c=>{ try{ c.style.display=''; }catch(_){ } });
        return;
      }

      const map = {
        profile: 'openProfileBtn',
        sound: 'openSoundBtn',
        theme: 'openThemeBtn',
        quicklinks: 'openLinksBtn',
        worldclocks: 'openClocksBtn',
        cursor: 'openCursorBtn',
        sidebar: 'openSidebarBtn',
        datatools: 'openDataToolsBtn',
      };

      Object.keys(map).forEach(key=>{
        const allowed = (key in feats) ? !!feats[key] : true;
        const btn = document.getElementById(map[key]);
        if(!btn) return;
        const card = btn.closest ? btn.closest('.settings-card') : null;
        if(card) card.style.display = allowed ? '' : 'none';
      });
    }catch(e){ }
  };

  function bindSystemCheckModal(currentUser){
    if(window.__mumsSystemCheck && window.__mumsSystemCheck.bound) return;

    const els = {
      state: document.getElementById('syscheckState'),
      countdown: document.getElementById('syscheckCountdown'),
      fill: document.getElementById('syscheckFill'),
      hint: document.getElementById('syscheckHint'),
      list: document.getElementById('syscheckList'),
      critPill: document.getElementById('syscheckCriticalPill'),
      minorPill: document.getElementById('syscheckMinorPill'),
      runBtn: document.getElementById('syscheckRunBtn'),
      clearBtn: document.getElementById('syscheckClearResolvedBtn'),
    };
    if(!els.runBtn || !els.list) return;

    let running = false;
    let timer = null;
    let remaining = 0;

    function setState(s){ if(els.state) els.state.textContent = s; }
    function setHint(s){ if(els.hint) els.hint.textContent = s; }
    function setProgress(p){ if(els.fill) els.fill.style.width = `${Math.max(0, Math.min(100, p))}%`; }

    function renderFindings(findings){
      const crit = findings.filter(f=>f.severity==='Critical').length;
      const minor = findings.filter(f=>f.severity==='Minor').length;
      if(els.critPill) els.critPill.textContent = `Critical: ${crit}`;
      if(els.minorPill) els.minorPill.textContent = `Minor: ${minor}`;
      els.list.innerHTML = findings.map(f=>{
        const cls = (f.severity==='Critical') ? 'crit' : 'minor';
        const sev = (f.severity==='Critical') ? `<span class="sev crit">CRITICAL</span>` : `<span class="sev minor">MINOR</span>`;
        const rec = f.recommendation ? `<div class="small" style="margin-top:8px"><b>Recommendation:</b> ${UI.esc(f.recommendation)}</div>` : '';
        const impact = f.impact ? `<div class="small muted" style="margin-top:6px">${UI.esc(f.impact)}</div>` : '';
        const detail = f.details ? `<details style="margin-top:10px"><summary class="small" style="cursor:pointer;font-weight:900">Details</summary><div class="small muted" style="margin-top:8px;white-space:pre-wrap">${UI.esc(String(f.details))}</div></details>` : '';
        return `<div class="syscheck-item ${cls}"><div class="t"><div><div style="font-weight:950">${UI.esc(f.title||'Finding')}</div>${impact}</div>${sev}</div>${rec}${detail}</div>`;
      }).join('');
    }

    function reset(){
      running = false;
      if(timer){ clearInterval(timer); timer=null; }
      remaining = 0;
      if(els.countdown) els.countdown.textContent = '—';
      setState('Ready');
      setHint('Press Run to start diagnostics.');
      setProgress(0);
      renderFindings([]);
    }

    function makeFinding(severity, title, impact, recommendation, details){
      return { severity, title, impact, recommendation, details };
    }

    async function run(){
      if(running) return;
      running = true;
      setState('Running');
      setHint('Initializing checks...');
      setProgress(0);
      renderFindings([]);

      const findings = [];
      const steps = [];
      const addStep = (label, fn)=> steps.push({ label, fn });

      addStep('Core globals', ()=>{
        const missing = [];
        ['Config','Store','UI','Auth','Pages'].forEach(k=>{ if(!window[k]) missing.push(k); });
        if(missing.length){
          findings.push(makeFinding('Critical', 'Missing core globals', 'The app may fail to route or render pages.', 'Verify script load order and ensure all bundled JS files are present.', `Missing: ${missing.join(', ')}`));
        }
      });

      addStep('Navigation integrity', ()=>{
        try{
          const nav = (window.Config && Config.NAV) ? Config.NAV : [];
          const flat = [];
          (nav||[]).forEach(i=>{ if(i && i.children) i.children.forEach(c=>flat.push(c.id)); else if(i) flat.push(i.id); });
          if(flat.includes('gmt_overview')){
            findings.push(makeFinding('Minor', 'GMT Overview is still present in the main navigation', 'Users may access the page outside Settings > World Clocks.', 'Remove the GMT Overview entry from Config.NAV.', 'Config.NAV contains gmt_overview'));
          }
        }catch(e){
          findings.push(makeFinding('Minor', 'Navigation integrity check failed', 'Unable to validate navigation items.', 'Review Config.NAV structure.', String(e)));
        }
      });

      addStep('User record sanity', ()=>{
        try{
          const users = (Store && Store.getUsers) ? Store.getUsers() : [];
          const ids = new Set();
          const dup = [];
          (users||[]).forEach(u=>{ if(!u) return; const id = String(u.id||''); if(ids.has(id)) dup.push(id); ids.add(id); });
          if(dup.length){
            findings.push(makeFinding('Critical', 'Duplicate user IDs found', 'May cause permission and routing inconsistencies.', 'Clean local storage users list and ensure user deletion is permanent.', `Duplicate IDs: ${dup.join(', ')}`));
          }
          const sa = (users||[]).find(u=>String(u.role||'').toUpperCase()==='SUPER_ADMIN');
          if(sa && (sa.teamId || sa.shiftId)){
            findings.push(makeFinding('Minor', 'Super Admin still has team/shift assigned', 'UI may show incorrect shift context for the Super Admin account.', 'Clear teamId/shiftId for SUPER_ADMIN in the users store.', JSON.stringify({teamId:sa.teamId, shiftId:sa.shiftId})));
          }
        }catch(e){
          findings.push(makeFinding('Minor', 'User record sanity check failed', 'Unable to validate users store.', 'Review users storage schema.', String(e)));
        }
      });

      addStep('World Clocks config', ()=>{
        try{
          const list = (Store && Store.getWorldClocks) ? Store.getWorldClocks() : [];
          if(!Array.isArray(list)){
            findings.push(makeFinding('Critical', 'World clocks config is not an array', 'Clocks modal and bottom bar may fail to render.', 'Reset world clocks config in local storage and re-save via Settings.', typeof list));
            return;
          }
          const offs = (window.WorldClockUtils && Array.isArray(WorldClockUtils.GMT_OFFSETS_MINUTES)) ? WorldClockUtils.GMT_OFFSETS_MINUTES : null;
          if(!offs || !offs.length){
            findings.push(makeFinding('Critical', 'GMT offsets list missing', 'GMT Overview and pinned offset clocks may fail.', 'Ensure WorldClockUtils.GMT_OFFSETS_MINUTES is defined (app.js) and loaded before any GMT pages.', 'WorldClockUtils.GMT_OFFSETS_MINUTES is missing/empty'));
          }

          if(window.WorldClockUtils && typeof WorldClockUtils.formatTimePartsForClock==='function'){
            const sample = list[0] || { timeZone:'UTC', offsetMinutes:0 };
            try{ WorldClockUtils.formatTimePartsForClock(new Date(), sample); }catch(ex){
              findings.push(makeFinding('Critical', 'World clock formatter threw an exception', 'Clock rendering may crash pages.', 'Validate timeZone / offsetMinutes values in world clocks settings.', String(ex)));
            }
          }
        }catch(e){
          findings.push(makeFinding('Minor', 'World clocks check failed', 'Unable to validate world clocks configuration.', 'Review Store.getWorldClocks and clock schemas.', String(e)));
        }
      });

      addStep('Page smoke tests', async ()=>{
        try{
          const pageIds = Object.keys(window.Pages||{});
          const allow = new Set(['dashboard','logs','gmt_overview','master_schedule','my_schedule']);
          const root = document.createElement('div');
          root.style.cssText = 'position:fixed;left:-99999px;top:-99999px;width:1200px;height:800px;overflow:hidden;';
          document.body.appendChild(root);
          for(const id of pageIds){
            if(!allow.has(id)) continue;
            root.innerHTML = '';
            try{ await Promise.resolve(window.Pages[id](root)); }
            catch(ex){
              findings.push(makeFinding('Minor', `Smoke test failed: ${id}`, 'This page may throw errors for some users.', 'Open Activity Logs for the stack trace and fix the offending module.', String(ex && (ex.stack||ex))));
            }
          }
          root.remove();
        }catch(e){
          findings.push(makeFinding('Minor', 'Page smoke tests failed', 'Unable to run render smoke tests.', 'Check that Pages registry exists and functions are callable.', String(e)));
        }
      });

      remaining = Math.max(6, Math.ceil(steps.length * 1.2));
      if(els.countdown) els.countdown.textContent = String(remaining);
      if(timer) clearInterval(timer);
      timer = setInterval(()=>{
        remaining = Math.max(0, remaining-1);
        if(els.countdown) els.countdown.textContent = String(remaining);
        if(remaining<=0 && timer){ clearInterval(timer); timer=null; }
      }, 1000);

      for(let i=0;i<steps.length;i++){
        const step = steps[i];
        setHint(`Running: ${step.label} (${i+1}/${steps.length})`);
        try{ await Promise.resolve(step.fn()); }
        catch(e){ findings.push(makeFinding('Minor', `System check step failed: ${step.label}`, 'A diagnostics step threw unexpectedly.', 'Review the system check implementation and ensure it is safe for offline use.', String(e && (e.stack||e)))); }
        setProgress(Math.round(((i+1)/steps.length)*100));
        await new Promise(r=>setTimeout(r, 150));
      }

      renderFindings(findings);
      const critCount = findings.filter(f=>f.severity==='Critical').length;
      setState(critCount===0 ? 'Completed' : 'Completed with issues');
      setHint(critCount===0 ? 'No critical findings. You can clear resolved error logs now.' : 'Resolve critical findings before clearing error logs.');

      try{
        if(critCount===0){
          const okTs = Date.now();
          localStorage.setItem('mums_syscheck_last_ok_ts', String(okTs));
        }
      }catch(_){ }

      try{
        if(critCount===0 && window.Store && Store.autoFixLogs){
          const cut = Number(localStorage.getItem('mums_syscheck_last_ok_ts')||0) || Number(window.__mumsBootTs||0) || Date.now();
          Store.autoFixLogs({ clearResolvedBefore: cut, smartClearResolved: true });
        }
      }catch(_){ }

      running = false;
    }

    els.runBtn.onclick = run;
    if(els.clearBtn){
      els.clearBtn.onclick = ()=>{
        try{
          const cut = Number(localStorage.getItem('mums_syscheck_last_ok_ts')||0) || Number(window.__mumsBootTs||0) || Date.now();
          if(window.Store && Store.autoFixLogs) Store.autoFixLogs({ clearResolvedBefore: cut, smartClearResolved: true });
          UI.toast && UI.toast('Resolved errors cleared from Activity Logs.');
        }catch(e){ console.error(e); }
      };
    }

    window.__mumsSystemCheck = { bound:true, reset, run };
    reset();
  }

  function _relLum(rgb){
    const srgb = rgb.map(v=>v/255).map(v=> v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4));
    return 0.2126*srgb[0] + 0.7152*srgb[1] + 0.0722*srgb[2];
  }

  function _contrast(c1, c2){
    const L1 = _relLum(_parseColor(c1));
    const L2 = _relLum(_parseColor(c2));
    const hi = Math.max(L1,L2);
    const lo = Math.min(L1,L2);
    return (hi+0.05)/(lo+0.05);
  }

  function chooseAccentText(accent){
    const a = String(accent||'');
    const onWhite = _contrast('#ffffff', a);
    const onDark = _contrast('#0b1220', a);
    return (onDark > onWhite) ? '#0b1220' : '#ffffff';
  }

  function renderThemeAudit(){
    const audit = document.getElementById('themeAudit');
    const inner = document.getElementById('themeAuditInner');
    if(!audit || !inner) return;

    const user = (window.Auth && Auth.getUser) ? Auth.getUser() : null;
    const can = (window.Config && Config.can) ? Config.can(user, 'manage_release_notes') : false;
    if(!can){
      audit.style.display = 'none';
      inner.innerHTML = '';
      return;
    }

    const cs = getComputedStyle(document.documentElement);
    const bg = cs.getPropertyValue('--bg').trim() || '#0b1220';
    const panel = cs.getPropertyValue('--panel').trim() || '#121c2f';
    const text = cs.getPropertyValue('--text').trim() || '#eaf2ff';
    const muted = cs.getPropertyValue('--muted').trim() || '#a8b6d6';
    const border = cs.getPropertyValue('--border').trim() || 'rgba(255,255,255,.08)';
    const accent = cs.getPropertyValue('--accent').trim() || '#4aa3ff';

    const rows = [
      { k: 'Text on Panel', v: _contrast(text, panel), min: 4.5 },
      { k: 'Muted on Panel', v: _contrast(muted, panel), min: 3.0 },
      { k: 'Text on Background', v: _contrast(text, bg), min: 4.5 },
      { k: 'Accent on Panel', v: _contrast(accent, panel), min: 3.0 },
      { k: 'Border on Panel', v: _contrast(border, panel), min: 1.8 },
    ];

    inner.innerHTML = `
      <div class="theme-lab-grid">
        ${rows.map(row=>{
          const ratio = (Math.round(row.v*100)/100).toFixed(2);
          const b = (row.v >= row.min) ? {label:'✅ PASS', col:'#10b981', bg:'rgba(16,185,129,0.1)'} 
                  : (row.v >= Math.max(3.0, row.min)) ? {label:'⚠️ WARN', col:'#fbbf24', bg:'rgba(245,158,11,0.1)'} 
                  : {label:'❌ FAIL', col:'#ef4444', bg:'rgba(239,68,68,0.1)'};
          return `
            <div class="theme-lab-card">
               <div class="theme-lab-copy">
                  <div class="theme-lab-k">${UI.esc(row.k)}</div>
                  <div class="theme-lab-v">Ratio: ${ratio}:1</div>
               </div>
               <div class="theme-lab-status" style="background:${b.bg}; color:${b.col}; border-color:${b.col}; box-shadow:0 0 15px ${b.bg};">
                  ${b.label}
               </div>
            </div>
          `;
        }).join('')}
      </div>
      <div class="theme-lab-guide small muted">
        <strong>Diagnostic Guidance:</strong> If any parameter fails WCAG 2.1 AA standards, adjust your <code>Config.THEMES</code> definitions. Muted text requires 3.0:1, while standard text requires 4.5:1 against the active panel background.
      </div>
    `;

    audit.style.display = 'block';
  }

  // =========================================================================
  // BOSS THUNTER: ULTIMATE COMPACT BENTO MANAGER + API SYNC
  // =========================================================================
  function renderThemeGrid(){
    const grid = document.getElementById('themeGrid');
    if(!grid) return;
    
    const user = (window.Auth && window.Auth.getUser) ? window.Auth.getUser() : null;
    const rawRole = String(user?.role || '').trim().toUpperCase().replace(/\s+/g,'_');
    const saRole = (window.Config && Config.ROLES && Config.ROLES.SUPER_ADMIN) ? String(Config.ROLES.SUPER_ADMIN).toUpperCase() : 'SUPER_ADMIN';
    const isSA = (rawRole === saRole) || (rawRole === 'SUPER_ADMIN');

    // ENSURE DATA IS LOADED BEFORE RENDERING UI
    if (!__themeMetaLoaded) {
      if (!__themeMetaLoading) {
        grid.innerHTML = '<div class="muted" style="padding:40px; text-align:center; font-size:14px; display:flex; justify-content:center; align-items:center;"><div class="mbx-spinner" style="margin-right:10px;"></div> Syncing Global Theme Policy...</div>';
        loadThemeMeta().then(() => renderThemeGrid());
      }
      return;
    }

    const cur = resolveEffectiveThemeForUser();
    const rawThemes = getThemeCatalog();
    const globalDefault = String(__globalThemeSettings && __globalThemeSettings.defaultTheme || '').trim() || 'apex';

    // BULLETPROOF FILTERING LOGIC
    const visibleThemes = rawThemes.filter(t => {
        const m = __themeMeta[t.id] || {};
        if (m.deleted) return false;
        if (m.hidden) {
            if (!isSA) return false;
            if (isSA && !__themeEditMode) return false;
        }
        return true;
    });

    const summaryHtml = `
      <div class="th-summary">
        <div class="th-summary-item">
          <span class="th-summary-label">Your Active Theme</span>
          <span class="th-summary-value">${UI.esc(getThemeName(cur))}</span>
        </div>
        <div class="th-summary-item">
          <span class="th-summary-label">Org Default</span>
          <span class="th-summary-value">${UI.esc(getThemeName(globalDefault))}</span>
        </div>
      </div>
    `;

    // SUPER ADMIN CONTROL BAR
    const forcedThemeActive      = !!(__globalThemeSettings && __globalThemeSettings.forcedTheme);
    const forcedBrightnessActive = !!(__globalThemeSettings && __globalThemeSettings.forcedBrightness);
    const forcedAt               = (__globalThemeSettings && __globalThemeSettings.forcedAt) || null;
    const forcedByName           = (__globalThemeSettings && __globalThemeSettings.forcedByName) || null;
    const forcedBothActive       = forcedThemeActive && forcedBrightnessActive;

    const adminBarHtml = isSA ? `
      <div class="th-toolbar">
        <div class="th-toolbar-controls">
          <div class="th-global-default-panel">
            <label class="small muted" for="globalDefaultThemeSelect">Global Default Theme</label>
            <div class="th-global-default-row">
              <select class="input" id="globalDefaultThemeSelect">
                ${rawThemes.filter(t => !(__themeMeta[t.id] && __themeMeta[t.id].deleted)).map(t => `<option value="${UI.esc(t.id)}" ${t.id === globalDefault ? 'selected' : ''}>${UI.esc(t.name || t.id)}</option>`).join('')}
              </select>
              <button class="btn-glass btn-glass-primary" id="saveGlobalDefaultThemeBtn">Save Default</button>
            </div>
            <div class="small" id="globalDefaultThemeStatus" aria-live="polite" style="display:none"></div>
          </div>
          <div class="th-toolbar-actions">
            <button class="btn-glass ${__themeEditMode ? 'btn-glass-danger' : 'btn-glass-primary'}" id="toggleThemeEditBtn">
              ${__themeEditMode ? '✅ Done Editing' : '⚙️ Manage Themes'}
            </button>
          </div>
        </div>

        <!-- ── SUPER ADMIN: Force All Users panel ─────────────────────── -->
        <div class="th-force-panel" style="margin-top:14px;padding:14px 16px;background:rgba(201,168,76,.06);border:1px solid rgba(201,168,76,.22);border-radius:10px;">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;">
            <div>
              <div style="font-size:12px;font-weight:800;color:#C9A84C;display:flex;align-items:center;gap:6px;margin-bottom:4px;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                Force All Users — APEX + 130% Brightness
              </div>
              <div style="font-size:11px;color:rgba(201,168,76,.7);line-height:1.5;max-width:480px;">
                Overwrites every user's localStorage theme and brightness on their next page load.
                Fixes accounts stuck on dark/dim setups. Cannot be undone per-user — they can re-customize after.
              </div>
              ${forcedBothActive ? `<div style="font-size:10px;color:#C9A84C;margin-top:6px;display:flex;align-items:center;gap:5px;">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#C9A84C" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                <strong>ACTIVE</strong> — forced on${forcedByName ? ' by ' + UI.esc(forcedByName) : ''}${forcedAt ? ' · ' + new Date(forcedAt).toLocaleString() : ''}
              </div>` : '<div style="font-size:10px;color:rgba(255,255,255,.3);margin-top:5px;">Status: Not currently forced</div>'}
            </div>
            <div style="display:flex;flex-direction:column;gap:8px;min-width:160px;">
              <button class="btn-glass btn-glass-primary" id="forceAllUsersApexBtn"
                style="background:rgba(201,168,76,.15);border-color:rgba(201,168,76,.4);color:#C9A84C;font-weight:800;font-size:12px;padding:9px 18px;">
                🛡️ ${forcedBothActive ? 'Re-Force All Users' : 'Force All Users'}
              </button>
              ${forcedBothActive ? `<button class="btn-glass" id="clearForceAllBtn"
                style="font-size:11px;padding:6px 14px;color:rgba(255,255,255,.4);">
                ✕ Clear Force
              </button>` : ''}
            </div>
          </div>
          <div id="forceAllUsersStatus" style="display:none;font-size:11px;margin-top:8px;padding:6px 10px;border-radius:5px;"></div>
        </div>

      </div>
    ` : summaryHtml;

    // BUILD COMPACT BENTO CARDS
    const cardsHtml = visibleThemes.map(t => {
      const m = __themeMeta[t.id] || {};
      const active = t.id === cur;
      const isHidden = !!m.hidden;
      const isGlobalDefault = t.id === globalDefault;

      const mode = String(t.mode || '').trim() || 'N/A';
      const adminHtml = `
          <div class="th-admin-bar">
              <button class="th-admin-btn" data-hide-theme="${UI.esc(t.id)}" onclick="event.stopPropagation()">
                  ${isHidden ? '👁️ Unhide' : '👀 Hide'}
              </button>
              <button class="th-admin-btn del" data-del-theme="${UI.esc(t.id)}" onclick="event.stopPropagation()">
                  🗑️ Delete
              </button>
          </div>
      `;

      return `
        <div class="th-card ${active?'is-active':''} ${isHidden?'is-hidden':''} ${__themeEditMode?'show-admin th-jiggle':''}" data-theme="${UI.esc(t.id)}" tabindex="0" role="button" aria-label="Apply theme ${UI.esc(t.name || t.id)}">
           <div class="th-swatch" style="--t-bg:${t.bg || '#0b1220'}; --t-panel:${t.panel || '#121c2f'}; --t-acc:${t.accent || '#4aa3ff'};"></div>
           <div class="th-info">
              <div class="th-title">${UI.esc(t.name || 'Untitled Theme')}</div>
              <div class="th-meta">ID: ${UI.esc(t.id || 'n/a')}</div>
              <div class="th-mode">Mode: ${UI.esc(mode.toUpperCase())}</div>
              <div class="th-desc">${UI.esc(t.description || 'Enterprise-ready appearance profile.')}</div>
              <div class="th-badges">
                ${active ? '<div class="th-badge th-badge-active">ACTIVE</div>' : ''}
                ${isGlobalDefault ? '<div class="th-badge th-badge-default">GLOBAL DEFAULT</div>' : ''}
                ${isHidden ? '<div class="th-badge th-badge-hidden">HIDDEN</div>' : ''}
              </div>
            </div>
            ${isSA ? adminHtml : ''}
        </div>
      `;
    }).join('') || '<div class="muted th-empty">No themes available.</div>';

    grid.innerHTML = adminBarHtml + `<div class="th-grid">${cardsHtml}</div>`;

    // EVENT BINDINGS
    const toggleBtn = document.getElementById('toggleThemeEditBtn');
    if(toggleBtn) {
        toggleBtn.onclick = () => {
            __themeEditMode = !__themeEditMode;
            renderThemeGrid();
        };
    }

    // ── Force All Users button ─────────────────────────────────────────
    const forceAllBtn = document.getElementById('forceAllUsersApexBtn');
    if(forceAllBtn){
      forceAllBtn.onclick = async () => {
        const statusEl = document.getElementById('forceAllUsersStatus');
        const token = getBearerToken();
        if(!token){ if(statusEl){ statusEl.textContent='Session expired.'; statusEl.style.cssText='display:block;background:rgba(248,81,73,.12);color:#f85149;'; } return; }
        forceAllBtn.disabled = true;
        forceAllBtn.textContent = '⏳ Forcing...';
        if(statusEl){ statusEl.style.display='none'; }
        try{
          const res = await fetch('/api/settings/global-theme', {
            method: 'POST',
            headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${token}` },
            body: JSON.stringify({ action:'force_all', themeId:'apex', brightness:130 })
          });
          const data = await res.json().catch(()=>({}));
          if(!res.ok || !data.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
          __globalThemeSettings = {
            defaultTheme:'apex', brightness:130,
            forcedTheme:true, forcedBrightness:true,
            forcedAt: data.forcedAt, forcedByName: data.forcedByName
          };
          __globalThemeLoaded = true;
          if(statusEl){ statusEl.textContent='✓ All users will get APEX + 130% brightness on next page load.'; statusEl.style.cssText='display:block;background:rgba(63,185,80,.1);color:#3fb950;border-radius:5px;'; }
          renderThemeGrid();
        }catch(err){
          if(statusEl){ statusEl.textContent='✗ Error: '+String(err&&err.message||err); statusEl.style.cssText='display:block;background:rgba(248,81,73,.1);color:#f85149;border-radius:5px;'; }
        }finally{
          forceAllBtn.disabled = false;
          forceAllBtn.textContent = '🛡️ Force All Users';
        }
      };
    }

    // ── Clear Force button ──────────────────────────────────────────────
    const clearForceBtn = document.getElementById('clearForceAllBtn');
    if(clearForceBtn){
      clearForceBtn.onclick = async () => {
        const statusEl = document.getElementById('forceAllUsersStatus');
        const token = getBearerToken();
        if(!token) return;
        clearForceBtn.disabled = true;
        try{
          const res = await fetch('/api/settings/global-theme', {
            method: 'POST',
            headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${token}` },
            body: JSON.stringify({ forcedTheme:false, forcedBrightness:false })
          });
          const data = await res.json().catch(()=>({}));
          if(!res.ok || !data.ok) throw new Error(data.message||data.error||`HTTP ${res.status}`);
          __globalThemeSettings = Object.assign({}, __globalThemeSettings, { forcedTheme:false, forcedBrightness:false, forcedAt:null, forcedByName:null });
          if(statusEl){ statusEl.textContent='Force cleared — users can now freely customize.'; statusEl.style.cssText='display:block;background:rgba(139,148,158,.1);color:#8b949e;border-radius:5px;'; }
          renderThemeGrid();
        }catch(err){
          if(statusEl){ statusEl.textContent='✗ Error: '+String(err&&err.message||err); statusEl.style.cssText='display:block;background:rgba(248,81,73,.1);color:#f85149;border-radius:5px;'; }
        }finally{ clearForceBtn.disabled = false; }
      };
    }

    const saveDefaultBtn = document.getElementById('saveGlobalDefaultThemeBtn');
    if(saveDefaultBtn){
      saveDefaultBtn.onclick = async () => {
        const select = document.getElementById('globalDefaultThemeSelect');
        const status = document.getElementById('globalDefaultThemeStatus');
        const selectedTheme = String(select && select.value || '').trim();
        if(!isValidThemeId(selectedTheme)){
          if(status){
            status.style.display = 'block';
            status.style.color = '#fda4af';
            status.textContent = 'Invalid theme selection.';
          }
          return;
        }

        const token = getBearerToken();
        if(!token){
          if(status){
            status.style.display = 'block';
            status.style.color = '#fda4af';
            status.textContent = 'Session expired. Please login again.';
          }
          return;
        }

        saveDefaultBtn.disabled = true;
        saveDefaultBtn.textContent = 'Saving...';
        if(status){
          status.style.display = 'block';
          status.style.color = '#93c5fd';
          status.textContent = 'Syncing global default theme...';
        }

        try{
          const res = await fetch('/api/settings/global-theme', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ themeId: selectedTheme })
          });
          const data = await res.json().catch(()=>({}));
          if(!res.ok || !data.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);

          __globalThemeSettings = { defaultTheme: selectedTheme };
          __globalThemeLoaded = true;

          if(status){
            status.style.color = '#34d399';
            status.textContent = `Global default set to ${getThemeName(selectedTheme)}.`;
          }
          renderThemeGrid();
        }catch(e){
          if(status){
            status.style.color = '#fda4af';
            status.textContent = `Failed to save: ${String(e && e.message || e)}`;
          }
        }finally{
          saveDefaultBtn.disabled = false;
          saveDefaultBtn.textContent = 'Save Default';
        }
      };
    }

    grid.querySelectorAll('.th-card').forEach(tile => {
      const pick = (e) => {
        if(__themeEditMode) return; 
        const id = tile.dataset.theme;
        try{ if(Store && Store.dispatch) Store.dispatch('UPDATE_THEME', { id:id }); else Store.setTheme(id); }catch(_){ try{ Store.setTheme(id); }catch(__){} }
        try{ applyTheme(id); }catch(_){ }
        renderThemeGrid(); 
      };
      tile.onclick = pick;
      tile.onkeydown = (e)=>{ if(e.key==='Enter' || e.key===' '){ e.preventDefault(); pick(e); } };
    });

    if (isSA) {
        grid.querySelectorAll('[data-hide-theme]').forEach(btn => {
            btn.onclick = async (e) => {
                e.stopPropagation();
                if(btn.dataset.busy) return;

                const tid = btn.getAttribute('data-hide-theme');
                const nextMeta = JSON.parse(JSON.stringify(__themeMeta));
                nextMeta[tid] = nextMeta[tid] || {};
                nextMeta[tid].hidden = !nextMeta[tid].hidden;

                btn.dataset.busy = '1';
                const originalText = btn.innerHTML;
                btn.innerHTML = '<span class="mbx-spinner"></span> Sync...';

                const res = await saveThemeMeta(nextMeta);
                if(!res.ok){
                    try{ UI.toast('Sync failed: ' + res.message, 'error'); }catch(_){}
                    btn.innerHTML = originalText;
                    delete btn.dataset.busy;
                    return;
                }
                renderThemeGrid();
            };
        });
        
        grid.querySelectorAll('[data-del-theme]').forEach(btn => {
            btn.onclick = async (e) => {
                e.stopPropagation();
                if(btn.dataset.busy) return;

                const tid = btn.getAttribute('data-del-theme');
                const ok = await UI.confirm({ title: 'Delete Theme Globally', message: 'Hide and delete this theme for all users?', okText: 'Yes, Delete', danger: true });
                if (!ok) return;
                
                const nextMeta = JSON.parse(JSON.stringify(__themeMeta));
                nextMeta[tid] = nextMeta[tid] || {};
                nextMeta[tid].deleted = true;

                btn.dataset.busy = '1';
                const originalText = btn.innerHTML;
                btn.innerHTML = '<span class="mbx-spinner"></span> Purging...';
                
                if(cur === tid) {
                    const fallbackId = isValidThemeId(globalDefault) ? globalDefault : resolveEffectiveThemeForUser();
                    Store.dispatch ? Store.dispatch('UPDATE_THEME', { id:fallbackId }) : Store.setTheme(fallbackId);
                    applyTheme(fallbackId);
                }

                const res = await saveThemeMeta(nextMeta);
                if(!res.ok){
                    try{ UI.toast('Delete sync failed: ' + res.message, 'error'); }catch(_){}
                    btn.innerHTML = originalText;
                    delete btn.dataset.busy;
                    return;
                }
                renderThemeGrid();
            };
        });
    }

    try{ renderThemeAudit(); }catch(_){ }
  }


  // Bottom quick links
  function normalizeUrl(u){
    const s = String(u||'').trim();
    if(!s) return '';
    if(/^https?:\/\//i.test(s)) return s;
    return 'https://' + s;
  }

  function renderQuickLinksBar(){
    const wrap = document.getElementById('quickLinksInner');
    if(!wrap) return;
    const links = Store.getQuickLinks();

    wrap.innerHTML = links.map((l, idx)=>{
      const has = !!(l && l.url);
      const label = String(l?.label||'').trim();
      const url = normalizeUrl(l?.url||'');
      const glow = String(l?.glowColor||l?.glow||'').trim();
      const glowCss = has ? (glow || 'var(--accent)') : '';
      const tip = (label || url || `Link ${idx+1}`).trim();
      const num = String(idx+1);
      const shownLabel = label || '';
      return `
        <div class="qitem" data-idx="${idx}" ${has?`data-has="1"`:''} data-tip="${UI.esc(tip)}">
          <div class="qlabel">${UI.esc(shownLabel)}</div>
          <button class="qcircle ${has?'filled glowing':''}" ${has?`style="--glow:${UI.esc(glowCss)}"`:''} type="button" data-idx="${idx}" aria-label="Quick link ${idx+1}">
            <span class="qtxt">${UI.esc(num)}</span>
          </button>
        </div>
      `;
    }).join('');

    wrap.querySelectorAll('.qcircle').forEach(btn=>{
      btn.onclick = ()=>{
        const idx = Number(btn.dataset.idx||0);
        const links = Store.getQuickLinks();
        const l = links[idx] || {};
        const url = normalizeUrl(l.url);
        if(!url) return;
        window.open(url, '_blank', 'noopener');
      };
    });
  }

  const CLOCK_STYLES = [
    {id:'classic', name:'Classic'},
    {id:'neon', name:'Neon'},
    {id:'mono', name:'Monochrome'},
    {id:'glass', name:'Glass'},
    {id:'bold', name:'Bold'},
    {id:'minimal', name:'Minimal'},
    {id:'terminal', name:'Terminal'},
    {id:'chip', name:'Chip'},
    {id:'rounded', name:'Rounded'},
    {id:'outline', name:'Outline'},
  ];

  function tzLabel(tz){
    const map = {
      'Asia/Manila':'Manila',
      'UTC':'UTC',
      'America/Los_Angeles':'Los Angeles',
      'America/New_York':'New York',
      'Europe/London':'London',
      'Europe/Paris':'Paris',
      'Asia/Tokyo':'Tokyo',
      'Asia/Singapore':'Singapore',
      'Australia/Sydney':'Sydney'
    };
    const key = String(tz||'').trim();
    return map[key] || key || 'UTC';
  }

  function formatTimeParts(date, tz){
    try{
      const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false });
      const parts = Object.fromEntries(fmt.formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
      return { hh: parts.hour||'00', mm: parts.minute||'00', ss: parts.second||'00' };
    }catch(e){
      const d = date;
      return { hh: String(d.getHours()).padStart(2,'0'), mm: String(d.getMinutes()).padStart(2,'0'), ss: String(d.getSeconds()).padStart(2,'0') };
    }
  }

  const GMT_OFFSETS_MINUTES = [
    -720,-660,-600,-570,-540,-480,-420,-360,-300,-240,-210,-180,-120,-60,
    0,60,120,180,210,240,270,300,330,345,360,390,420,480,525,540,570,600,630,660,690,720,765,780,840
  ];

  function _pad2(n){ return String(n).padStart(2,'0'); }

  function gmtLabelFromMinutes(mins){
    const m = Number(mins)||0;
    const sign = m>=0 ? '+' : '-';
    const abs = Math.abs(m);
    const hh = Math.floor(abs/60);
    const mm = abs%60;
    return `GMT${sign}${_pad2(hh)}:${_pad2(mm)}`;
  }

  function formatTimePartsForClock(now, clock){
    const c = clock || {};
    const off = (c.offsetMinutes === 0 || c.offsetMinutes) ? Number(c.offsetMinutes) : null;
    if(off !== null && Number.isFinite(off)){
      const ms = now.getTime() + off*60*1000;
      const d = new Date(ms);
      return { hh:_pad2(d.getUTCHours()), mm:_pad2(d.getUTCMinutes()), ss:_pad2(d.getUTCSeconds()) };
    }
    const tz = c.timeZone || 'Asia/Manila';
    return formatTimeParts(now, tz);
  }

  window.WorldClockUtils = window.WorldClockUtils || {};
  window.WorldClockUtils.GMT_OFFSETS_MINUTES = GMT_OFFSETS_MINUTES.slice();
  window.WorldClockUtils.gmtLabelFromMinutes = gmtLabelFromMinutes;
  window.WorldClockUtils.formatTimePartsForClock = formatTimePartsForClock;
  window.WorldClockUtils.clockZoneLabel = clockZoneLabel;

  function clockZoneLabel(clock){
    const c = clock || {};
    const off = (c.offsetMinutes === 0 || c.offsetMinutes) ? Number(c.offsetMinutes) : null;
    if(off !== null && Number.isFinite(off)) return gmtLabelFromMinutes(off);
    return tzLabel(c.timeZone || 'Asia/Manila');
  }

  function parseClockZoneValue(val){
    const v = String(val||'').trim();
    if(v.startsWith('offset:')){
      const n = Number(v.slice(7));
      return { timeZone: 'UTC', offsetMinutes: Number.isFinite(n) ? n : 0 };
    }
    return { timeZone: v || 'Asia/Manila', offsetMinutes: null };
  }

  function ensureGmtOverviewUI(){
    const modal = document.getElementById('clocksModal');
    if(!modal) return null;
    const body = modal.querySelector('.body');
    if(!body) return null;

    let panel = modal.querySelector('#gmtOverviewPanel');
    if(panel) return panel;

    panel = document.createElement('div');
    panel.id = 'gmtOverviewPanel';
    panel.className = 'gmt-overview';
    panel.innerHTML = `
      <div class="gmt-head">
        <div>
          <div class="settings-card-title">GMT Overview</div>
          <div class="small muted" style="margin-top:6px">View current time for all commonly used GMT/UTC offsets. Click an offset to pin it as a clock.</div>
        </div>
        <div class="gmt-controls">
          <input class="input" id="gmtSearch" placeholder="Search offsets (e.g., +08, 5:30, GMT+10)..." />
        </div>
      </div>
      <div class="gmt-grid" id="gmtOverviewGrid" aria-label="GMT overview"></div>
    `;
    body.appendChild(panel);

    panel.addEventListener('click', (e)=>{
      const tile = e.target && (e.target.closest ? e.target.closest('[data-gmtoff]') : null);
      if(!tile) return;
      const mins = Number(tile.getAttribute('data-gmtoff'));
      if(!Number.isFinite(mins)) return;

      try{
        const cur = Store.getWorldClocks().slice();
        const exists = cur.some(c=> Number(c && c.offsetMinutes) === mins);
        if(!exists){
          cur.push({
            enabled: true,
            label: gmtLabelFromMinutes(mins),
            timeZone: 'UTC',
            offsetMinutes: mins,
            hoursColor: '#EAF3FF',
            minutesColor: '#9BD1FF',
            alarmEnabled: false,
            alarmTime: '09:00',
            style: 'classic'
          });
          try{ if(Store && Store.dispatch) Store.dispatch('UPDATE_CLOCKS', cur); }catch(_){ try{ Store.saveWorldClocks(cur); }catch(__){} }
          refreshWorldClocksNow();
          try{ renderClocksGrid(); renderClocksPreviewStrip(); }catch(_){ }
        }
      }catch(err){ console.error(err); }
    });

    const search = panel.querySelector('#gmtSearch');
    if(search){
      search.addEventListener('input', ()=>{
        try{ renderGmtOverview(); }catch(_){ }
      });
    }

    return panel;
  }
  
  function renderGmtOverview(){
    const panel = ensureGmtOverviewUI();
    if(!panel) return;
    const grid = panel.querySelector('#gmtOverviewGrid');
    if(!grid) return;

    const q = String(panel.querySelector('#gmtSearch')?.value||'').trim().toLowerCase();
    const now = new Date();

    const filtered = GMT_OFFSETS_MINUTES.filter(mins=>{
      if(!q) return true;
      const label = gmtLabelFromMinutes(mins).toLowerCase();
      return label.includes(q) || String(mins).includes(q) || String(mins/60).includes(q);
    });

    grid.innerHTML = filtered.map(mins=>{
      const ms = now.getTime() + mins*60*1000;
      const d = new Date(ms);
      const hh = _pad2(d.getUTCHours());
      const mm = _pad2(d.getUTCMinutes());
      const dateHint = UI && UI.manilaParts ? (()=>{ 
        try{
          const man = UI.manilaParts(now).isoDate;
          const od  = UI.manilaParts(new Date(ms)).isoDate;
          if(od === man) return '';
          return od > man ? ' (+1d)' : ' (-1d)';
        }catch(_){ return ''; }
      })() : '';
      return `
        <button class="gmt-tile" type="button" data-gmtoff="${mins}">
          <div class="gmt-tile-top">
            <div class="small" style="font-weight:900">${UI.esc(gmtLabelFromMinutes(mins))}${UI.esc(dateHint)}</div>
            <div class="gmt-tile-time">${hh}:${mm}</div>
          </div>
          <div class="small muted">Click to pin</div>
        </button>
      `;
    }).join('');
  }

  function startGmtOverviewTicker(){
    try{
      if(window.__mumsGmtOverviewTimer) return;
      window.__mumsGmtOverviewTimer = setInterval(()=>{
        const modal = document.getElementById('clocksModal');
        if(!modal || !modal.classList.contains('open')) return;
        try{ renderGmtOverview(); }catch(_){ }
      }, 30000);
    }catch(_){ }
  }

function renderWorldClocksBar(){
    const wrap = document.getElementById('worldClocks');
    if(!wrap) return;
    const list = Store.getWorldClocks();
    const now = new Date();
    wrap.innerHTML = list.map((c, i)=>{
      const on = !!c.enabled;
      if(!on) return '';
      const t = formatTimePartsForClock(now, c);
      const tz = c.timeZone || 'Asia/Manila';
      const label = String(c.label||clockZoneLabel(c)||`Clock ${i+1}`);
      const hcol = c.hoursColor || '#EAF3FF';
      const mcol = c.minutesColor || '#9BD1FF';
      const style = String(c.style||'classic');
      return `
        <div class="wclock wc-${style}" data-idx="${i}" title="${UI.esc(label)} (${UI.esc(clockZoneLabel(c))})">
          <div class="wc-label">${UI.esc(label)}</div>
          <div class="wc-time"><span class="wc-h" style="color:${UI.esc(hcol)}">${UI.esc(t.hh)}</span><span class="wc-sep">:</span><span class="wc-m" style="color:${UI.esc(mcol)}">${UI.esc(t.mm)}</span><span class="wc-sec">:${UI.esc(t.ss)}</span></div>
        </div>
      `;
    }).join('');
  }

  function _bucketForUser(u){
    try{
      if(!u) return 'mid';
      let teamId = u.teamId || '';
      const rawRole = String(u.role || '').trim();
      let role = (window.Store && Store.normalizeRole) ? Store.normalizeRole(rawRole)
        : rawRole.toUpperCase().replace(/\s+/g,'_').replace(/-+/g,'_');

      try{
        const uid = u.id || u.user_id || u.userId || '';
        if ((!teamId || !role) && uid && window.Store && Store.getUserById) {
          const su = Store.getUserById(uid);
          if (su) {
            if (!teamId && su.teamId) teamId = su.teamId;
            if (!role && su.role) {
              const rr = String(su.role||'').trim();
              role = (window.Store && Store.normalizeRole) ? Store.normalizeRole(rr)
                : rr.toUpperCase().replace(/\s+/g,'_').replace(/-+/g,'_');
            }
            if (!u.name && su.name) u.name = su.name;
            if (!u.username && su.username) u.username = su.username;
            if (!u.photo && (su.photo || su.avatar || su.photoDataUrl || su.avatar_url || su.avatarUrl)) {
              u.photo = su.photo || su.avatar || su.photoDataUrl || su.avatar_url || su.avatarUrl;
            }
          }
        }
      }catch(_){ }

      if(role === 'SUPER_ADMIN' || role === 'SUPER_USER'){
        let teamOverride = !!(u.teamOverride ?? u.team_override ?? false);
        try{
          const uid = u.id || u.user_id || u.userId || '';
          if(uid && window.Store && Store.getUserById){
            const su = Store.getUserById(uid);
            if(su){
              if(!teamOverride && su.teamOverride !== undefined) teamOverride = !!su.teamOverride;
              if(!teamId && su.teamId) teamId = su.teamId;
            }
          }
        }catch(_){ }

        if(teamOverride && teamId){
          const t0 = Config.teamById ? Config.teamById(teamId) : null;
          const label0 = String((t0 && t0.label) || '').toLowerCase();
          if(label0.includes('morning')) return 'morning';
          if(label0.includes('mid')) return 'mid';
          if(label0.includes('night')) return 'night';
        }
        return 'dev';
      }

      if(!teamId) return 'mid';

      const t = Config.teamById ? Config.teamById(teamId) : null;
      const label = String((t && t.label) || '').toLowerCase();
      if(label.includes('morning')) return 'morning';
      if(label.includes('mid')) return 'mid';
      if(label.includes('night')) return 'night';
    }catch(_){ }
    return 'mid';
  }

  function _initials(name){
    const s = String(name||'').trim();
    if(!s) return 'U';
    const parts = s.split(/\s+/).filter(Boolean);
    const a = (parts[0]||'').slice(0,1);
    const b = (parts.length>1 ? parts[parts.length-1] : '').slice(0,1);
    return (a + b).toUpperCase();
  }

  function _normalizeDailyWorkMode(modeRaw){
    const mode = String(modeRaw || '').trim().toUpperCase();
    if(!mode) return '';
    if(mode === 'OFFICE' || mode === 'IN_OFFICE' || mode === 'IN OFFICE') return 'OFFICE';
    if(mode === 'WFH' || mode === 'WFM' || mode === 'WORK_FROM_HOME' || mode === 'WORK FROM HOME') return 'WFH';
    return '';
  }

  function renderOnlineUsersBar(){
    const host = document.getElementById('onlineUsersBar');
    if(!host) return;

    const isMobile = !!(window.matchMedia && window.matchMedia('(max-width: 768px)').matches) || (window.innerWidth <= 768);

    let list = [];
    try{ list = (window.Store && Store.getOnlineUsers) ? Store.getOnlineUsers() : []; }catch(_){ list=[]; }
    const latestModeByUser = {};
    try{
      const attendance = (window.Store && Store.getAttendance) ? Store.getAttendance() : [];
      (Array.isArray(attendance) ? attendance : []).forEach(rec=>{
        if(!rec) return;
        const uid = String(rec.userId || rec.id || '').trim();
        if(!uid || latestModeByUser[uid]) return;
        const normalized = _normalizeDailyWorkMode(rec.mode);
        if(normalized) latestModeByUser[uid] = normalized;
      });
    }catch(_){ }

    const buckets = { morning:[], mid:[], night:[], dev:[] };
    list.forEach(u=>{
      const b = _bucketForUser(u);
      (buckets[b]||buckets.mid).push(u);
    });

    // Active threshold: heartbeat within last 90s → full green
    // (Allows one missed 60s beat before turning gray — prevents flicker on slow networks)
    // Idle threshold: beyond 90s but still in roster (TTL=300s) → grayed out
    const ACTIVE_THRESHOLD_MS = 90 * 1000; // 90s = 2× 45s HB interval — green if beat within 90s
    const _nowTs = Date.now();

    function pills(arr){
      return (arr||[]).slice(0, 18).map(u=>{
        const uid = String(u.userId || u.id || '').trim();
        const mode = _normalizeDailyWorkMode(u.mode) || (uid ? latestModeByUser[uid] : '');
        const red = mode === 'WFH';
        const photo = u.photo ? String(u.photo) : '';
        const nm = String(u.name||u.username||'User');
        // Determine if user is active or idle based on last heartbeat time
        const lastSeen = Number(u.lastSeen || u.last_seen || 0);
        const isIdle = lastSeen > 0 && (_nowTs - lastSeen) > ACTIVE_THRESHOLD_MS;
        const idleLabel = isIdle ? ' · Away' : '';
        const pillClass = isIdle ? 'is-idle' : (red ? 'is-red' : '');
        const titleLabel = UI.esc(nm + idleLabel);
        return `
          <div class="online-pill ${pillClass}" title="${titleLabel}">
            ${photo ? `<img src="${UI.esc(photo)}" alt="${UI.esc(nm)}" />` : `<span class="ini">${UI.esc(_initials(nm))}</span>`}
          </div>
        `;
      }).join('');
    }

    function sec(title, arr){
      const items = pills(arr);
      // Active count (green) vs total (includes idle/grayed)
      const activeCount = arr.filter(u => {
        const lastSeen = Number(u.lastSeen || u.last_seen || 0);
        return lastSeen <= 0 || (_nowTs - lastSeen) <= ACTIVE_THRESHOLD_MS;
      }).length;
      const totalCount = arr.length;
      // Show "2 / 3" when there are idle users, "2" when all active
      const countDisplay = (totalCount > activeCount && totalCount > 0)
        ? `${activeCount}<span style="opacity:.45;font-weight:500">/${totalCount}</span>`
        : String(totalCount);

      if(isMobile){
        return `
          <details class="onlinebar-acc" ${arr.length ? 'open' : ''}>
            <summary>
              <span class="onlinebar-title">${UI.esc(title)}</span>
              <span class="onlinebar-count">${countDisplay}</span>
            </summary>
            <div class="onlinebar-badges">
              <div class="onlinebar-list">${items || '<span class="small" style="opacity:.7">—</span>'}</div>
            </div>
          </details>
        `;
      }

      return `
        <div class="onlinebar-sec">
          <div class="onlinebar-head">
            <div class="onlinebar-title">${UI.esc(title)}</div>
            <div class="onlinebar-count">${countDisplay}</div>
          </div>
          <div class="onlinebar-list">${items || '<span class="small" style="opacity:.7">—</span>'}</div>
        </div>
      `;
    }

    const head = isMobile ? `
      <div class="mob-sheet-head">
        <div class="mob-sheet-title">User Online</div>
        <div class="mob-sheet-actions">
          <button class="mob-sheet-close" type="button" aria-label="Close" data-close-onlinebar="1">✕</button>
        </div>
      </div>
    ` : '';

    host.innerHTML = `
      ${head}
      <div class="onlinebar-inner">
        ${sec('Morning Shift', buckets.morning)}
        ${sec('Mid Shift', buckets.mid)}
        ${sec('Night Shift', buckets.night)}
        ${sec('Developer Access', buckets.dev)}
      </div>
    `;

    if(isMobile && !host.__mobCloseBound){
      host.__mobCloseBound = true;
      host.addEventListener('click', (e)=>{
        const btn = e.target && e.target.closest ? e.target.closest('[data-close-onlinebar]') : null;
        if(!btn) return;
        document.body.classList.remove('mobile-online-open');
        try{
          const t = document.getElementById('toggleUserOnlineBar');
          if(t) t.setAttribute('aria-expanded','false');
        }catch(_){}
      });
    }
  }

  function refreshWorldClocksNow(){
  try{ renderWorldClocksBar(); }catch(e){ console.error(e); }
  try{ renderClocksPreviewStrip(); }catch(_){ }
  try{ updateWorldClocksTimes(); }catch(_){ }
  try{ updateClocksPreviewTimes(); }catch(_){ }
}

  function renderClocksPreviewStrip(){
    const strip = document.getElementById('clocksPreviewStrip');
    if(!strip) return;
    const list = Store.getWorldClocks();
    const now = new Date();

    strip.innerHTML = list.map((c,i)=>{
      const t = formatTimePartsForClock(now, c);
      const tz = c.timeZone || 'Asia/Manila';
      const label = String(c.label||clockZoneLabel(c)||`Clock ${i+1}`);
      const hcol = c.hoursColor || '#EAF3FF';
      const mcol = c.minutesColor || '#9BD1FF';
      const style = String(c.style||'classic');
      const on = !!c.enabled;
      return `
        <div class="wclock wc-${style} wclock-preview ${on?'':'is-off'}" draggable="true" data-idx="${i}" title="Drag to reorder • ${UI.esc(label)} (${UI.esc(clockZoneLabel(c))})">
          <div class="wc-label">${UI.esc(label)}</div>
          <div class="wc-time">
            <span class="wc-h" style="color:${UI.esc(hcol)}">${UI.esc(t.hh)}</span><span class="wc-sep">:</span><span class="wc-m" style="color:${UI.esc(mcol)}">${UI.esc(t.mm)}</span><span class="wc-sec">:${UI.esc(t.ss)}</span>
          </div>
          <div class="wc-drag" aria-hidden="true">↔</div>
        </div>
      `;
    }).join('');

    strip.querySelectorAll('.wclock-preview').forEach(el=>{
      el.addEventListener('dragstart', (e)=>{
        try{ e.dataTransfer.setData('text/plain', String(el.dataset.idx||'')); }catch(_){}
        el.classList.add('dragging');
      });
      el.addEventListener('dragend', ()=>{ el.classList.remove('dragging'); });
      el.addEventListener('dragover', (e)=>{ e.preventDefault(); el.classList.add('dragover'); });
      el.addEventListener('dragleave', ()=>{ el.classList.remove('dragover'); });
      el.addEventListener('drop', (e)=>{
        e.preventDefault();
        el.classList.remove('dragover');
        let from = -1;
        try{ from = Number(e.dataTransfer.getData('text/plain')); }catch(_){}
        const to = Number(el.dataset.idx||-1);
        if(!Number.isFinite(from) || !Number.isFinite(to) || from<0 || to<0 || from===to) return;
        try{
          const cur = Store.getWorldClocks().slice();
          if(from>=cur.length || to>=cur.length) return;
          const item = cur.splice(from,1)[0];
          cur.splice(to,0,item);
          try{ if(Store && Store.dispatch) Store.dispatch('UPDATE_CLOCKS', cur); else Store.saveWorldClocks(cur); }catch(_){ try{ Store.saveWorldClocks(cur); }catch(__){} }
          renderClocksGrid();
          renderWorldClocksBar();
          renderClocksPreviewStrip();
        }catch(err){ console.error(err); }
      });
    });
  }

function updateWorldClocksTimes(){
  const wrap = document.getElementById('worldClocks');
  if(!wrap) return;
  const list = Store.getWorldClocks();
  if(!Array.isArray(list) || list.length===0) return;
  const now = new Date();
  wrap.querySelectorAll('.wclock').forEach(el=>{
    const i = Number(el.dataset.idx||-1);
    if(!(i>=0)) return;
    const c = list[i];
    if(!c || !c.enabled) return;
    const t = formatTimePartsForClock(now, c);
      const tz = c.timeZone || 'Asia/Manila';
    const h = el.querySelector('.wc-h');
    const m = el.querySelector('.wc-m');
    const s = el.querySelector('.wc-sec');
    if(h) h.textContent = t.hh;
    if(m) m.textContent = t.mm;
    if(s) s.textContent = ':' + t.ss;
  });
}

function updateClocksPreviewTimes(){
  const strip = document.getElementById('clocksPreviewStrip');
  if(!strip) return;
  const list = Store.getWorldClocks();
  if(!Array.isArray(list) || list.length===0) return;
  const now = new Date();
  strip.querySelectorAll('.wclock-preview').forEach(el=>{
    const i = Number(el.dataset.idx||-1);
    if(!(i>=0)) return;
    const c = list[i];
    if(!c) return;
    const t = formatTimePartsForClock(now, c);
      const tz = c.timeZone || 'Asia/Manila';
    const h = el.querySelector('.wc-h');
    const m = el.querySelector('.wc-m');
    const s = el.querySelector('.wc-sec');
    if(h) h.textContent = t.hh;
    if(m) m.textContent = t.mm;
    if(s) s.textContent = ':' + t.ss;
  });
}

  const _alarmState = { lastKey: null };
  function checkWorldClockAlarms(){
    const list = Store.getWorldClocks();
    const now = new Date();
    const user = Auth && Auth.getUser ? Auth.getUser() : null;
    const userId = user ? user.id : 'anon';

    for(let i=0;i<list.length;i++){
      const c = list[i] || {};
      if(!c.enabled || !c.alarmEnabled || !c.alarmTime) continue;
      const t = formatTimePartsForClock(now, c);
      const tz = c.timeZone || 'Asia/Manila';
      const hm = `${t.hh}:${t.mm}`;
      if(hm === c.alarmTime && t.ss === '00'){
        const key = `${i}|${tz}|${c.alarmTime}|${UI.manilaNow().isoDate}`;
        if(_alarmState.lastKey === key) continue;
        _alarmState.lastKey = key;
        try{ UI.playNotifSound(userId); }catch(e){}
      }
    }
  }

  function renderClocksGrid(){
    const grid = document.getElementById('clocksGrid');
    if(!grid) return;
    const list = Store.getWorldClocks();
    const namedTimeZones = [
      'Asia/Manila','UTC','America/Los_Angeles','America/New_York',
      'Europe/London','Europe/Paris','Asia/Tokyo','Asia/Singapore','Australia/Sydney'
    ];

    const offsetOpts = GMT_OFFSETS_MINUTES.map(mins=>{
      const v = `offset:${mins}`;
      return { value: v, label: gmtLabelFromMinutes(mins) };
    });
    const styleOpts = CLOCK_STYLES.map(s=>`<option value="${UI.esc(s.id)}">${UI.esc(s.name)}</option>`).join('');

    grid.innerHTML = list.map((c, i)=>{
      const selTz = (c && (c.offsetMinutes === 0 || c.offsetMinutes) && Number.isFinite(Number(c.offsetMinutes)))
        ? (`offset:${Number(c.offsetMinutes)}`)
        : (c.timeZone || 'Asia/Manila');

      const gmtGroup = offsetOpts.map(o=>`<option value="${UI.esc(o.value)}" ${o.value===selTz?'selected':''}>${UI.esc(o.label)}</option>`).join('');
      const namedGroup = namedTimeZones.map(z=>`<option value="${UI.esc(z)}" ${z===selTz?'selected':''}>${UI.esc(tzLabel(z))}</option>`).join('');
      const tzOpts = `<optgroup label="GMT / UTC offsets">${gmtGroup}</optgroup><optgroup label="Named time zones">${namedGroup}</optgroup>`;
      return `
        <div class="clock-card" data-idx="${i}">
          <div class="row" style="justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
              <div class="chip">Clock ${i+1}</div>
              <label class="small" style="display:flex;gap:8px;align-items:center">
                <input type="checkbox" class="clk-enabled" ${c.enabled?'checked':''} />
                Enabled
              </label>
              <label class="small" style="display:flex;gap:8px;align-items:center">
                <input type="checkbox" class="clk-alarmEnabled" ${c.alarmEnabled?'checked':''} />
                Alarm enabled
              </label>
            </div>
            <div class="small muted" style="white-space:nowrap">Alarm uses Notification Sound</div>
          </div>

          <div style="display:grid;grid-template-columns:1.2fr 1fr;gap:12px;margin-top:10px">
            <label class="small">Label
              <input class="input clk-label" value="${UI.esc(c.label||'')}" placeholder="e.g. Support HQ" />
            </label>
            <label class="small">Time zone
              <select class="input clk-tz">${tzOpts}</select>
            </label>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:10px">
            <label class="small">Hours color
              <input class="input clk-hc" type="color" value="${UI.esc(c.hoursColor||'#EAF3FF')}" />
            </label>
            <label class="small">Minutes color
              <input class="input clk-mc" type="color" value="${UI.esc(c.minutesColor||'#9BD1FF')}" />
            </label>
            <label class="small">Clock design
              <select class="input clk-style">${styleOpts}</select>
            </label>
          </div>

          <div style="display:grid;grid-template-columns:1fr;gap:10px;margin-top:10px">
            <label class="small">Alarm time
              <input class="input clk-alarm" type="time" value="${UI.esc(c.alarmTime||'')}" style="max-width:180px" ${c.alarmEnabled?'':'disabled'} />
            </label>
          </div>
        </div>
      `;
    }).join('');

    grid.querySelectorAll('.clock-card').forEach(card=>{
      const i = Number(card.dataset.idx||0);
      const s = (list[i] && list[i].style) ? list[i].style : 'classic';
      const sel = card.querySelector('.clk-style');
      if(sel) sel.value = s;
    });

    try{ renderClocksPreviewStrip(); }catch(e){ }

    if(!grid.__liveBind){
      grid.__liveBind = true;
      let t = null;
      const commit = ()=>{
        try{
          const next = Store.getWorldClocks();
          grid.querySelectorAll('.clock-card').forEach(card=>{
            const i = Number(card.dataset.idx||0);
            if(!next[i]) next[i] = {};
            const q = (sel)=>card.querySelector(sel);
            const alarmOn = !!q('.clk-alarmEnabled')?.checked;
            const alarmInput = q('.clk-alarm');
            try{ if(alarmInput) alarmInput.disabled = !alarmOn; }catch(_){ }
            next[i] = {
              enabled: !!q('.clk-enabled')?.checked,
              label: String(q('.clk-label')?.value||'').trim(),
              timeZone: parseClockZoneValue(String(q('.clk-tz')?.value||'Asia/Manila')).timeZone,
              offsetMinutes: parseClockZoneValue(String(q('.clk-tz')?.value||'Asia/Manila')).offsetMinutes,
              hoursColor: String(q('.clk-hc')?.value||'#EAF3FF'),
              minutesColor: String(q('.clk-mc')?.value||'#9BD1FF'),
              style: String(q('.clk-style')?.value||'classic'),
              alarmEnabled: alarmOn,
              alarmTime: alarmOn ? String(alarmInput?.value||'').trim() : '',
            };
          });
          try{ if(Store && Store.dispatch) Store.dispatch('UPDATE_CLOCKS', next); else Store.saveWorldClocks(next); }catch(_){ try{ Store.saveWorldClocks(next); }catch(__){} }
          refreshWorldClocksNow();
          try{ renderClocksPreviewStrip(); }catch(_){ }
        }catch(e){ console.error(e); }
      };
      grid.__commitClocks = ()=>{ try{ clearTimeout(t); }catch(_){ } try{ commit(); }catch(_){ } };
      grid.addEventListener('input', ()=>{ clearTimeout(t); t = setTimeout(commit, 150); });
      grid.addEventListener('change', ()=>{ clearTimeout(t); t = setTimeout(commit, 0); });
    }
  }

  function renderLinksGrid(){
    const grid = document.getElementById('linksGrid');
    if(!grid) return;
    const links = Store.getQuickLinks();
    grid.innerHTML = links.map((l, idx)=>{
      const label = String(l?.label||'');
      const url = String(l?.url||'');
      const glowColor = String(l?.glowColor||l?.glow||'');
      return `
        <div class="link-row" data-idx="${idx}">
          <div class="lr-head">
            <div class="lr-slot">Link ${idx+1}</div>
            <div class="lr-actions">
              <button class="btn tiny" type="button" data-save>Save</button>
              <button class="btn tiny danger" type="button" data-del>Delete</button>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr;gap:10px;margin-top:10px">
            <label class="small">Label
              <input class="input" data-label value="${UI.esc(label)}" placeholder="e.g., Zendesk" />
            </label>
            <label class="small">URL
              <input class="input" data-url value="${UI.esc(url)}" placeholder="https://..." />
            </label>
            <label class="small">Glow color (for filled circles)
              <div class="row" style="gap:10px;align-items:center">
                <input type="color" data-glow value="${UI.esc((glowColor||'').trim()||'#4f46e5')}" style="width:44px;height:34px;border-radius:10px;border:1px solid var(--border);background:transparent;padding:0" />
                <input class="input" data-glowText value="${UI.esc((glowColor||'').trim())}" placeholder="#4f46e5 (optional)" />
              </div>
            </label>
          </div>
        </div>
      `;
    }).join('');

    grid.querySelectorAll('.link-row').forEach(row=>{
      const idx = Number(row.dataset.idx||0);
      const getVals = ()=>({
        label: String(row.querySelector('[data-label]')?.value||'').trim(),
        url: String(row.querySelector('[data-url]')?.value||'').trim(),
        glowColor: String((row.querySelector('[data-glowText]')?.value||row.querySelector('[data-glow]')?.value||'')).trim()
      });
      const saveBtn = row.querySelector('[data-save]');
      const delBtn = row.querySelector('[data-del]');
      const glowPick = row.querySelector('[data-glow]');
      const glowTxt = row.querySelector('[data-glowText]');
      if(glowPick && glowTxt){
        glowPick.oninput = ()=>{ try{ glowTxt.value = String(glowPick.value||'').trim(); }catch(_){ } };
        glowTxt.oninput = ()=>{
          const v = String(glowTxt.value||'').trim();
          if(/^#([0-9a-fA-F]{6})$/.test(v)) glowPick.value = v;
        };
      }
      if(saveBtn) saveBtn.onclick = ()=>{
        const v = getVals();
        const url = normalizeUrl(v.url);
        if(!url){ alert('Please enter a valid URL.'); return; }
        Store.setQuickLink(idx, { label: v.label, url, glowColor: v.glowColor });
        renderQuickLinksBar();
        renderLinksGrid();
      };
      if(delBtn) delBtn.onclick = async ()=>{
        const ok = await UI.confirm({ title:'Delete Quick Link', message:'Delete this quick link?', okText:'Delete', danger:true });
        if(!ok) return;
        Store.clearQuickLink(idx);
        renderQuickLinksBar();
        renderLinksGrid();
      };
    });
  }

  function renderNav(user){
    const nav = UI.el('#nav');

    const iconFor = (id)=>{
      const map = {
        dashboard: 'dashboard',
            gmt_overview: 'dashboard',
        mailbox: 'mailbox',
        team: 'members',
        members: 'members',
        master_schedule: 'schedule',
        team_config: 'tasks',
        admin: 'users',
        users: 'users',
        announcements: 'announce',
        logs: 'dashboard',
        my_reminders: 'reminder_me',
        team_reminders: 'reminder_team',
        my_record: 'schedule',
        my_attendance: 'schedule',
        my_schedule: 'schedule',
        my_case: 'mailbox',
        my_task: 'tasks',
        system: 'dashboard',
        system_overview: 'dashboard',
        system_requests: 'dashboard',
        system_realtime: 'dashboard',
        system_timers: 'dashboard',
        system_supabase: 'dashboard',
        system_cloudflare: 'dashboard',
        system_queue: 'dashboard',
      };
      return map[id] || 'dashboard';
    };

    function canAccessNavItem(n){
      const id = String(n && n.id || '').trim();
      if(id === 'my_quickbase') return true;
      if(id === 'manila_calendar') return true;
      return !!Config.can(user, n.perm);
    }

    function renderItem(n, depth){
      const padVal = (12 + depth*12);
      const pad = `style="padding-left:${padVal}px"`;
      const hasKids = Array.isArray(n.children) && n.children.length;
      const depthClass = depth > 0 ? ' nav-subitem' : '';

      if(!hasKids){
        if(!canAccessNavItem(n)) return '';
        const href = (n && n.route) ? String(n.route) : (`/${n.id}`);
        return `<a class="nav-item depth-${depth}${depthClass}" href="${href}" data-page="${n.id}" data-label="${UI.esc(n.label)}" ${pad} title="${UI.esc(n.label)}">
          <span class="nav-ico" data-ico="${iconFor(n.id)}" aria-hidden="true"></span>
          <span class="nav-label">${UI.esc(n.label)}</span>
        </a>`;
      }

      const key = `nav_group_${n.id}`;
      const open = localStorage.getItem(key);
      const isOpen = open === null ? true : (open === '1');
      const kidsHtml = n.children
        .map(k => renderItem(k, depth+1))
        .filter(Boolean)
        .join('');
      if(!canAccessNavItem(n) && !kidsHtml) return '';
      if(!kidsHtml) return '';

      const special = n.id === 'my_record' ? ' is-record-group' : '';
      return `
        <div class="nav-group${special}" data-group="${n.id}">
          <button class="nav-group-head depth-${depth}" type="button" data-toggle="${n.id}" aria-expanded="${isOpen?'true':'false'}" ${pad} data-label="${UI.esc(n.label)}" title="${UI.esc(n.label)}">
            <span class="nav-ico" data-ico="${iconFor(n.id)}" aria-hidden="true"></span>
            <span class="nav-label">${UI.esc(n.label)}</span>
            <span class="chev">▾</span>
          </button>
          <div class="nav-group-kids depth-${depth+1}" style="display:${isOpen?'block':'none'}">${kidsHtml}</div>
        </div>
      `;
    }

    function sectionFor(item){
      const id = String(item && item.id || '');
      if(id === 'my_record') return 'records';
      if(id === 'my_reminders' || id === 'team_reminders') return 'notifications';
      if(id === 'system') return 'system';
      return 'main';
    }

    const sectionLabel = {
      main: 'MAIN',
      records: 'RECORDS',
      notifications: 'NOTIFICATIONS',
      system: 'SYSTEM'
    };

    const navItems = Array.isArray(Config.NAV) ? [...Config.NAV] : [];

    try{
      const extras = (window.Store && Store.getUserExtraPrivs) ? Store.getUserExtraPrivs(user.id) : [];
      const kids = [];
      if(extras && extras.length){
        kids.push({ id: 'commands', label: 'Commands', icon: '⚡', perm: 'view_dashboard' });
        if(extras.includes('view_master_schedule')) kids.push({ id: 'master_schedule', label: 'Master Schedule', icon: '📅', perm: 'view_master_schedule' });
        if(extras.includes('create_users')) kids.push({ id: 'users', label: 'User Management', icon: '👤', perm: 'create_users' });
        if(extras.includes('manage_announcements')) kids.push({ id: 'announcements', label: 'Announcement', icon: '📣', perm: 'manage_announcements' });
        navItems.push({ id: 'commands_group', label: 'Commands', icon: '⚡', perm: 'view_dashboard', children: kids });
      }
    }catch(_){ }

    const visible = navItems.map(item=>({ item, html: renderItem(item,0) })).filter(x=>x.html);
    let navHtml = '';
    let lastSection = '';
    visible.forEach(({ item, html })=>{
      const section = sectionFor(item);
      if(section !== lastSection){
        navHtml += `<div class="nav-section-label" data-section="${section}">${sectionLabel[section] || 'MAIN'}</div>`;
        lastSection = section;
      }
      navHtml += html;
    });

    nav.innerHTML = navHtml;

    if(!nav.innerHTML.trim()){
      nav.innerHTML = `
        <div class="small muted" style="padding:10px 6px">
          No menu items available for this account.<br/>
          Check the user role/permissions in <b>User Management</b>.
        </div>
      `;
      return;
    }

    nav.querySelectorAll('[data-toggle]').forEach(btn=>{
      btn.onclick = ()=>{
        const id = btn.dataset.toggle;
        const wrap = nav.querySelector(`.nav-group[data-group="${CSS.escape(id)}"]`);
        if(!wrap) return;
        const kids = wrap.querySelector('.nav-group-kids');
        const open = kids.style.display !== 'none';
        kids.style.display = open ? 'none' : 'block';
        btn.setAttribute('aria-expanded', open ? 'false' : 'true');
        localStorage.setItem(`nav_group_${id}`, open ? '0' : '1');
      };
    });

    if(!nav.__routeBound){
      nav.__routeBound = true;
      nav.__lastNavAt = 0;
      nav.__lastNavPage = '';
      nav.addEventListener('click', (e)=>{
        const a = e.target && e.target.closest ? e.target.closest('a.nav-item') : null;
        if(!a) return;

        const href = String(a.getAttribute('href') || '');
        if(!(href.startsWith('/') || href.startsWith('#'))) return;

        if(e.defaultPrevented) return;
        if(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        if(typeof e.button === 'number' && e.button !== 0) return;

        const pageId = _routePageIdFromHref(href);
        if(!pageId) return;

        e.preventDefault();
        e.stopPropagation();

        const now = Date.now();
        const sinceLastTap = now - Number(nav.__lastNavAt || 0);
        const isSameTarget = nav.__lastNavPage === pageId;
        nav.__lastNavAt = now;
        nav.__lastNavPage = pageId;

        // Keep accidental double-click protection, but do not block intentional
        // fast page switching. Only suppress near-identical taps.
        if(isSameTarget && sinceLastTap < 80) return;

        try{ setActiveNav(pageId); }catch(_){ }

        if(href.startsWith('#') || String(window.location.protocol||'') === 'file:'){
          window.location.hash = '#' + pageId;
        }else{
          navigateToPageId(pageId);
        }

        try{ if(_isMobileViewport()) closeMobileDrawers(); }catch(_){ }
      });
    }
  }

  // Global avatar onerror handler — safe to call from inline HTML attributes.
  function mumsAvatarFallback(img) {
    try {
      const alt = String(img && img.alt || '');
      const parent = img && img.parentElement;
      if (parent) parent.innerHTML = '<div class="initials">' + alt + '</div>';
    } catch(_) {}
  }
  window.mumsAvatarFallback = mumsAvatarFallback;

  function renderUserCard(user){
    const el = UI.el('#userCard');
    if(!el) return;
    const team = Config.teamById(user.teamId);
    const prof = Store.getProfile(user.id) || {};
    const initials = UI.initials(user.name||user.username);
    const _rawSrc = prof.photoDataUrl || '';
    // Cache-bust Supabase storage URLs to prevent stale CDN responses after upload
    const _bustedSrc = (_rawSrc && !_rawSrc.startsWith('data:'))
      ? _rawSrc + (_rawSrc.includes('?') ? '&_v=' : '?_v=') + (prof.updatedAt || Date.now())
      : _rawSrc;
    const _avatarFallback = `<div class="initials">${UI.esc(initials)}</div>`;
    const avatarHtml = _bustedSrc
      ? `<img src="${UI.esc(_bustedSrc)}" alt="${UI.esc(initials)}" class="mums-avatar-img" onerror="mumsAvatarFallback(this)" />`
      : _avatarFallback;

    let shiftLabel = (team && team.label) ? String(team.label) : '';
    try{
      const r = String(user.role||'').toUpperCase();
      const isSuper = (window.Config && Config.ROLES) ? (r === String(Config.ROLES.SUPER_ADMIN) || r === String(Config.ROLES.SUPER_USER)) : (r === 'SUPER_ADMIN' || r === 'SUPER_USER');
      const override = !!(user.teamOverride ?? user.team_override ?? false);
      const tid = (user.teamId === null || user.teamId === undefined) ? '' : String(user.teamId);
      if(isSuper && !override && !tid){
        shiftLabel = 'Developer Access';
      }
    }catch(_){ }

    let isActive = true;
    try{
      const online = (window.Store && Store.getOnlineUsers) ? Store.getOnlineUsers() : [];
      isActive = online.some(rec => String(rec.userId || rec.id || '') === String(user.id));
    }catch(_){ }

    const roleLabel = String(user.role||'').replaceAll('_',' ');
    const safeRole = UI.esc(roleLabel || 'Member');
    const safeShift = UI.esc(shiftLabel || 'N/A');
    const subtitle = `${safeRole} • ${safeShift}`;

    el.innerHTML = `
      <div class="sp-compact sp-compact-v3" role="group" aria-label="User profile">
        <div class="sp-row">
          <div class="sp-photo sp-photo-sm sp-photo-circle" aria-hidden="true">
            ${avatarHtml}
            <span class="sp-presence-dot ${isActive ? 'is-active' : 'is-idle'}" title="${isActive ? 'Active' : 'Away'}"></span>
          </div>
          <div class="sp-info sp-info-row">
            <div class="sp-name sp-name-strong">${UI.esc(user.name||user.username||'Unknown User')}</div>
            <div class="sp-meta sp-meta-subtitle" title="Timezone: Asia/Manila">${subtitle}</div>
          </div>
        </div>
      </div>
    `;

    const nm = el.querySelector('.sp-name');
    const sub = el.querySelector('.sp-meta-subtitle');
    requestAnimationFrame(()=>{
      try{
        if(nm) fitText(nm, 15, 24);
        if(sub) fitText(sub, 11, 14);
      }catch(err){ console.error('Profile RAF error', err); }
    });
  }

  function cloudProfileEnabled(){
    try{
      return !!(window.CloudUsers && window.MUMS_ENV && MUMS_ENV.SUPABASE_URL && MUMS_ENV.SUPABASE_ANON_KEY);
    }catch(_){ return false; }
  }

  function openCropModal(dataUrl, opts){
    opts = opts || {};
    const onDone = typeof opts.onDone === 'function' ? opts.onDone : function(){};
    const onCancel = typeof opts.onCancel === 'function' ? opts.onCancel : function(){};
    const canvas = UI.el('#cropCanvas');
    const zoomEl = UI.el('#cropZoom');
    const btnCancel = UI.el('#cropCancel');
    const btnSave = UI.el('#cropSave');
    if(!canvas || !zoomEl || !btnCancel || !btnSave){
      onCancel();
      return;
    }

    const ctx = canvas.getContext('2d');
    const size = canvas.width || 320;

    const state = {
      img: null,
      baseScale: 1,
      zoom: 1,
      offX: 0,
      offY: 0,
      dragging: false,
      lastX: 0,
      lastY: 0
    };

    function clamp(){
      if(!state.img) return;
      const scale = state.baseScale * state.zoom;
      const maxX = Math.max(0, (state.img.width * scale - size) / 2);
      const maxY = Math.max(0, (state.img.height * scale - size) / 2);
      state.offX = Math.max(-maxX, Math.min(maxX, state.offX));
      state.offY = Math.max(-maxY, Math.min(maxY, state.offY));
    }

    function draw(){
      if(!state.img) return;
      const scale = state.baseScale * state.zoom;
      clamp();
      ctx.clearRect(0,0,size,size);
      ctx.fillStyle = '#0b0f16';
      ctx.fillRect(0,0,size,size);

      ctx.save();
      ctx.translate(size/2 + state.offX, size/2 + state.offY);
      ctx.scale(scale, scale);
      ctx.drawImage(state.img, -state.img.width/2, -state.img.height/2);
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 2;
      ctx.strokeRect(1,1,size-2,size-2);
      ctx.restore();
    }

    function pointToCanvas(e){
      const r = canvas.getBoundingClientRect();
      const sx = size / (r.width || size);
      const sy = size / (r.height || size);
      return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
    }

    canvas.onpointerdown = (e)=>{
      try{ canvas.setPointerCapture(e.pointerId); }catch(_){}
      const p = pointToCanvas(e);
      state.dragging = true;
      state.lastX = p.x;
      state.lastY = p.y;
    };
    canvas.onpointermove = (e)=>{
      if(!state.dragging) return;
      const p = pointToCanvas(e);
      const dx = p.x - state.lastX;
      const dy = p.y - state.lastY;
      state.lastX = p.x;
      state.lastY = p.y;
      state.offX += dx;
      state.offY += dy;
      draw();
    };
    canvas.onpointerup = ()=>{ state.dragging = false; };
    canvas.onpointercancel = ()=>{ state.dragging = false; };

    zoomEl.oninput = ()=>{
      state.zoom = Math.max(1, Math.min(3, Number(zoomEl.value||1)));
      draw();
    };

    btnCancel.onclick = ()=>{
      UI.closeModal('cropModal');
      onCancel();
    };

    btnSave.onclick = ()=>{
      if(!state.img){
        UI.closeModal('cropModal');
        onCancel();
        return;
      }
      const outSize = 512;
      const out = document.createElement('canvas');
      out.width = outSize;
      out.height = outSize;
      const octx = out.getContext('2d');
      const k = outSize / size;
      const baseOut = state.baseScale * k;
      const scaleOut = baseOut * state.zoom;
      const offX = state.offX * k;
      const offY = state.offY * k;

      const maxX = Math.max(0, (state.img.width * scaleOut - outSize) / 2);
      const maxY = Math.max(0, (state.img.height * scaleOut - outSize) / 2);
      const cx = Math.max(-maxX, Math.min(maxX, offX));
      const cy = Math.max(-maxY, Math.min(maxY, offY));

      octx.fillStyle = '#0b0f16';
      octx.fillRect(0,0,outSize,outSize);
      octx.save();
      octx.translate(outSize/2 + cx, outSize/2 + cy);
      octx.scale(scaleOut, scaleOut);
      octx.drawImage(state.img, -state.img.width/2, -state.img.height/2);
      octx.restore();

      let png = '';
      try{ png = out.toDataURL('image/png'); }catch(_){ png = ''; }
      UI.closeModal('cropModal');
      if(png) onDone(png);
      else onCancel();
    };

    const img = new Image();
    img.onload = ()=>{
      state.img = img;
      state.zoom = 1;
      zoomEl.value = '1';
      state.offX = 0;
      state.offY = 0;
      state.baseScale = Math.max(size / img.width, size / img.height);
      draw();
    };
    img.onerror = ()=>{
      UI.closeModal('cropModal');
      onCancel();
    };
    img.src = dataUrl;

    UI.openModal('cropModal');
  }

  function openProfileModal(user){
    const prof = Store.getProfile(user.id) || {};
    const roleUpper0 = String(user && user.role ? user.role : '').trim().toUpperCase();
    const isSuperAdmin0 = (roleUpper0 === 'SUPER_ADMIN');
    const isSuperRole0 = (roleUpper0 === 'SUPER_ADMIN' || roleUpper0 === 'SUPER_USER');
    const inferredOverride0 = isSuperRole0 ? !!(user.teamOverride ?? user.team_override ?? false) || !!(user.teamId) : false;
    const teamForLabel = (!user.teamId && isSuperRole0 && !inferredOverride0) ? { id:'', label:'Developer Access' } : Config.teamById(user.teamId);

    const nameEl = UI.el('#profileName');
    const emailEl = UI.el('#profileEmail');
    const roleEl = UI.el('#profileRole');
    const teamEl = UI.el('#profileTeam');
    // QB Integration section removed — token is managed globally by SUPER_ADMIN in Global QB Settings
    const qbTokenEl = null; // field removed from UI

    let teamSel = UI.el('#profileTeamSelect');
    if(isSuperRole0){
      try{
        if(!teamSel){
          teamSel = document.createElement('select');
          teamSel.id = 'profileTeamSelect';
          teamSel.className = 'input';

          const opt0 = document.createElement('option');
          opt0.value = '';
          opt0.textContent = 'Developer Access';
          teamSel.appendChild(opt0);

          (Config && Array.isArray(Config.TEAMS) ? Config.TEAMS : []).forEach(t=>{
            if(!t || !t.id) return;
            const o = document.createElement('option');
            o.value = String(t.id);
            o.textContent = String(t.label || t.id);
            teamSel.appendChild(o);
          });

          if(teamEl && teamEl.parentElement){
            teamEl.parentElement.appendChild(teamSel);
          }
        }
      }catch(_){ }
    }

    if(nameEl) nameEl.value = user.name||'';
    if(emailEl) {
      let em = user.email||'';
      if(!em){
        try{
          const su = (window.Store && typeof Store.getUserById === 'function') ? Store.getUserById(user.id) : null;
          if(su && su.email) em = String(su.email);
        }catch(_){ }
      }
      if(!em){
        try{
          const cu = (window.CloudAuth && typeof CloudAuth.getUser === 'function') ? CloudAuth.getUser() : null;
          if(cu && cu.email) em = String(cu.email);
        }catch(_){ }
      }
      if(!em){
        try{
          const domain = (window.Config && Config.USERNAME_EMAIL_DOMAIN) ? String(Config.USERNAME_EMAIL_DOMAIN) : 'mums.local';
          const un = String(user.username||'').trim();
          if(un) em = `${un}@${domain}`;
        }catch(_){ }
      }
      emailEl.value = em;
    }
    if(roleEl) roleEl.value = user.role||'';
    if(teamEl) teamEl.value = (teamForLabel && teamForLabel.label) ? teamForLabel.label : '';
    // qbTokenEl removed

    try{
      if(isSuperRole0 && teamSel){
        if(teamEl) teamEl.style.display = 'none';
        teamSel.style.display = '';

        let teamId = String(user.teamId || '').trim();
        let teamOverride = !!(user.teamOverride ?? user.team_override ?? false);
        if(isSuperRole0 && (user.teamOverride === undefined && user.team_override === undefined)) teamOverride = !!teamId;
        teamSel.value = (teamOverride && teamId) ? teamId : '';
      } else {
        if(teamEl) teamEl.style.display = '';
        if(teamSel) teamSel.style.display = 'none';
      }
    }catch(_){ }

    renderProfileAvatar(prof.photoDataUrl, user);

    const layoutSel = UI.el('#profileLayout');
    if(layoutSel){
      layoutSel.value = localStorage.getItem('mums_profile_layout') || 'banner';
    }

    if(cloudProfileEnabled()){
      try{
        CloudUsers.me().then(out=>{
          try{
            if(!out || !out.ok || !out.profile) return;
            const p = out.profile;
            if(nameEl && (String(nameEl.value||'').trim() === String(user.name||'').trim())){
              if(p.name) nameEl.value = p.name;
            }
            if(p.avatar_url){
              Store.setProfile(user.id, { photoDataUrl: p.avatar_url, updatedAt: Date.now() });
              renderProfileAvatar(p.avatar_url, user);
              renderUserCard(user);
            }

            if(emailEl && p.email) emailEl.value = p.email;
            // qbTokenEl removed — QB token is now global-only
            if(isSuperRole0 && teamSel){
              const roleUp = String(p.role || user.role || '').toUpperCase();
              const isSuperRole = (roleUp === 'SUPER_ADMIN' || roleUp === 'SUPER_USER');
              const teamIdRaw = (p.team_id === null || p.team_id === undefined) ? '' : String(p.team_id||'').trim();
              let tOverride = !!(p.team_override ?? p.teamOverride ?? false);
              if(isSuperRole && (p.team_override === undefined && p.teamOverride === undefined)) tOverride = !!teamIdRaw;
              teamSel.value = (tOverride && teamIdRaw) ? teamIdRaw : '';
            }
          }catch(_){ }
        }).catch(()=>{});
      }catch(_){ }
    }

    const input = UI.el('#profilePhotoInput');
    if(input){
      input.value = '';
      input.onchange = async()=>{
        try{
          const f = input.files && input.files[0];
          if(!f) return;
          const dataUrl = await UI.readImageAsDataUrl(f, 1400);
          openCropModal(dataUrl, {
            onDone: async (croppedPng)=>{
              if(!croppedPng) return;
              if(cloudProfileEnabled()){
                const up = await CloudUsers.uploadAvatar(croppedPng);
                if(!up.ok){
                  await UI.alert({ title:'Upload failed', message: up.message || 'Could not upload avatar.' });
                  return;
                }
                const url = up.url || (up.data && (up.data.url || up.data.publicUrl)) || '';
                Store.setProfile(user.id, { photoDataUrl: url, updatedAt: Date.now() });
                renderProfileAvatar(url, user);
                renderUserCard(user);
              } else {
                Store.setProfile(user.id, { photoDataUrl: croppedPng, updatedAt: Date.now() });
                renderProfileAvatar(croppedPng, user);
                renderUserCard(user);
              }
            },
            onCancel: ()=>{}
          });
        } catch (e){
          console.error('Photo upload error', e);
        }
      };
    }

    const rm = UI.el('#profileRemovePhoto');
    if(rm){
      rm.onclick = async ()=>{
        const hasPhoto = !!(Store.getProfile(user.id)||{}).photoDataUrl;
        if(!hasPhoto) return;
        const ok = await UI.confirm({ title:'Remove Profile Photo', message:'Remove your profile photo?', okText:'Remove', danger:true });
        if(!ok) return;

        if(cloudProfileEnabled()){
          const out = await CloudUsers.removeAvatar();
          if(!out.ok){
            await UI.alert({ title:'Remove failed', message: out.message || 'Could not remove avatar.' });
            return;
          }
        }

        Store.setProfile(user.id, { photoDataUrl: null, updatedAt: Date.now() });
        renderProfileAvatar(null, user);
        renderUserCard(Store.getUsers().find(u=>u.id===user.id) || user);
      };
    }

    UI.el('#profileSave').onclick = async ()=>{
      const name = String((nameEl && nameEl.value) || '').trim();
      const qbToken = ''; // QB token field removed from profile UI

      let teamIdSel = '';
      let teamOverrideSel = false;
      try{
        if(isSuperRole0 && teamSel){
          teamIdSel = String(teamSel.value||'').trim();
          teamOverrideSel = !!teamIdSel;
        }
      }catch(_){ }

      if(cloudProfileEnabled()){
        const payload = { name: name || (user.name||user.username), qb_token: qbToken };
        if(isSuperRole0){
          payload.team_id = teamOverrideSel ? teamIdSel : null;
          payload.team_override = !!teamOverrideSel;
        }

        const out = await CloudUsers.updateMe(payload);
        if(!out.ok){
          await UI.alert({ title:'Save failed', message: out.message || 'Could not update profile.' });
          return;
        }

        try{ await CloudUsers.refreshIntoLocalStore(); }catch(_){ }
      }

      const localPatch = { name: name || user.username };
      if(isSuperRole0){
        localPatch.teamOverride = !!teamOverrideSel;
        localPatch.teamId = teamOverrideSel ? teamIdSel : '';
      }
      Store.updateUser(user.id, localPatch);
      try{ Store.setProfile(user.id, { qb_token: qbToken, updatedAt: Date.now() }); }catch(_){ }

      if(layoutSel){
        localStorage.setItem('mums_profile_layout', String(layoutSel.value||'card'));
      }

      const updated = Store.getUsers().find(u=>u.id===user.id);
      if(updated){ renderUserCard(updated); }
      UI.closeModal('profileModal');
    };

    UI.openModal('profileModal');
  }

  function renderProfileAvatar(photoDataUrl, user){
    const box = UI.el('#profileAvatar');
    if(!box) return;
    const initStr = UI.esc(UI.initials((user&&(user.name||user.username))||''));
    const fallbackHtml = `<div class="initials" style="font-size:28px">${initStr}</div>`;
    if(photoDataUrl){
      const img = document.createElement('img');
      img.alt = 'User photo';
      img.className = 'mums-avatar-img';
      img.onerror = () => { box.innerHTML = fallbackHtml; };
      img.onload = () => { box.innerHTML = ''; box.appendChild(img); };
      // Show initials immediately while image loads (no broken-img flash)
      box.innerHTML = fallbackHtml;
      img.src = photoDataUrl; // set AFTER event handlers are bound
    } else {
      box.innerHTML = fallbackHtml;
    }
  }

  function canSeeLog(me, entry){
    const isSuper = me.role === Config.ROLES.SUPER_ADMIN;
    const isAdmin = isSuper || me.role === Config.ROLES.ADMIN;
    const isLead = me.role === Config.ROLES.TEAM_LEAD;
    if(isAdmin) return true;
    if(isLead){
      const showAll = localStorage.getItem('ums_logs_show_all') === '1';
      return showAll ? true : (entry.teamId === me.teamId);
    }
    return entry.teamId === me.teamId;
  }

  function renderSideLogs(user){
    try{
      if(window.Components && Components.SidebarLogs){
        Components.SidebarLogs.render(user);
        return;
      }
    }catch(_){ }
    const box = UI.el('#sideLogs');
    const list = UI.el('#sideLogsList');
    const hint = UI.el('#sideLogsHint');
    const viewAllBtn = UI.el('#sideLogsViewAll');
    if(!box) return;

    const openLogs = ()=>{ try{ navigateToPageId('logs'); }catch(_){ window.location.hash = '#logs'; } };
    if(viewAllBtn) viewAllBtn.onclick = openLogs;

    if(!list || !hint) return;

    const logs = Store.getLogs().filter(l=>canSeeLog(user,l)).slice(0,6);
    if(hint) hint.textContent = logs.length ? `Updated ${logs.length} item${logs.length>1?'s':''}` : 'No activity';

    const fmt = (ts)=>{
      try{
        const p = UI.manilaParts(new Date(ts));
        const hh = String(p.hh).padStart(2,'0');
        const mm = String(p.mm).padStart(2,'0');
        return `${hh}:${mm}`;
      }catch(e){
        const d = new Date(ts);
        const hh = String(d.getHours()).padStart(2,'0');
        const mm = String(d.getMinutes()).padStart(2,'0');
        return `${hh}:${mm}`;
      }
    };

    if(!logs.length){
      list.innerHTML = '<div class="log-empty">No recent activity.</div>';
      return;
    }

    list.innerHTML = logs.map((e, idx)=>{
      const teamClass = `team-${e.teamId}`;
      const msg = UI.esc(e.msg||e.action||'Activity updated');
      return `<div class="logline ${teamClass}" title="${UI.esc(e.detail||'')}">
        <span class="t">${fmt(e.ts)}</span>
        <span class="tl-dot" aria-hidden="true"></span>
        <span class="m">${msg}</span>
      </div>`;
    }).join('');
  }

  function setActiveNav(page){
    UI.els('#nav a').forEach(a=>a.classList.toggle('active', a.dataset.page===page));
    UI.els('#nav .nav-group').forEach(g=>g.classList.remove('active'));
    const active = UI.el(`#nav a[data-page="${CSS.escape(page)}"]`);
    if(active){
      const group = active.closest('.nav-group');
      if(group){
        group.classList.add('active');
        const kids = group.querySelector('.nav-group-kids');
        const head = group.querySelector('.nav-group-head');
        if(kids && kids.style.display==='none'){
          kids.style.display = 'block';
          if(head) head.setAttribute('aria-expanded','true');
          const id = group.getAttribute('data-group');
          if(id) localStorage.setItem(`nav_group_${id}`,'1');
        }
      }
    }
  }

  function renderRightNow(){
    const chip = UI.el('#summaryNowChip');
    if(chip) chip.textContent = 'Asia/Manila';
  }

  function mkGuideSvg(title, lines){
    const esc = UI.esc;
    let arr = [];
    if(Array.isArray(lines)) arr = lines;
    else if(typeof lines === 'string') arr = lines.split('\n');
    else if(lines != null) arr = [String(lines)];
    const safeLines = arr.slice(0,6).map(x=>esc(x));
    const lineY = [54,76,98,120,142,164];
    const text = safeLines.map((t,i)=>`<text x="28" y="${lineY[i]}" font-size="12" fill="rgba(255,255,255,.82)" font-family="system-ui,-apple-system,Segoe UI,Roboto">${t}</text>`).join('');
    return `
      <svg viewBox="0 0 520 200" width="100%" height="140" aria-hidden="true">
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="rgba(255,255,255,.10)"/>
            <stop offset="1" stop-color="rgba(0,0,0,.05)"/>
          </linearGradient>
        </defs>
        <rect x="10" y="10" width="500" height="180" rx="18" fill="url(#g)" stroke="rgba(255,255,255,.12)"/>
        <rect x="24" y="26" width="472" height="28" rx="10" fill="rgba(0,0,0,.18)" stroke="rgba(255,255,255,.10)"/>
        <text x="36" y="46" font-size="13" fill="rgba(255,255,255,.92)" font-weight="700" font-family="system-ui,-apple-system,Segoe UI,Roboto">${esc(title)}</text>
        ${text}
        <rect x="24" y="158" width="180" height="18" rx="9" fill="rgba(255,255,255,.07)"/>
        <rect x="212" y="158" width="120" height="18" rx="9" fill="rgba(255,255,255,.06)"/>
        <rect x="340" y="158" width="156" height="18" rx="9" fill="rgba(255,255,255,.05)"/>
      </svg>
    `;
  }

  const GUIDES = {
    dashboard: {
      title: 'Dashboard',
      guide: [
        { q:'What is this page for?', a:'Dashboard gives you a quick overview of your day and system status in MUMS.' },
        { q:'Manila time', a:'All time-based logic (duty, schedules, announcements) follows Asia/Manila time.' },
      ],
      notes: [
        'If you are a Team Lead, use Members > Assign Tasks to update schedules.',
        'Use Announcements to broadcast updates to your team.'
      ],
      legends: [
        ['🔒','Locked week (cannot edit until unlocked)'],
        ['📣','Announcement broadcast'],
      ]
    },
    mailbox: {
      title: 'Mailbox',
      guide: [
        { q:'What is Mailbox duty?', a:'Mailbox duty indicates the member responsible for mailbox handling at the current hour.' },
        { q:'How is duty computed?', a:'Duty is derived from the scheduled task blocks and Manila time.' },
      ],
      notes: [
        'If duty looks incorrect, confirm the week and day selector on Assign Tasks.'
      ],
      legends: [
        ['📥','Mailbox Manager'],
        ['📞','Call-related tasks']
      ]
    },
    members: {
      title: 'Assign Tasks',
      guide: [
        { q:'How do I assign tasks to members?', a:'Select a member row, choose a task, then click-and-drag on the hour grid. All scheduling is strictly 1-hour blocks (no minutes).' },
        { q:'What is Paint mode?', a:'Paint lets you click-and-drag across multiple hours to fill quickly with the selected task. It still enforces 1-hour blocks.' },
        { q:'How do SL / EL / VL / HL work?', a:'Use the leave buttons on a member to set Sick Leave (SL), Emergency Leave (EL), Vacation Leave (VL), or Holiday Leave (HL). When active, the member is greyed out and excluded from Auto Schedule.' },
        { q:'What is the Coverage Meter?', a:'Coverage Meter shows OK Hours and Health% for the selected day grid. OK Hours = hours with valid active coverage; Health% = (OK Hours / required hours) × 100.' },
        { q:'How do I delete schedule blocks?', a:'Click one or more blocks to select them, then press Delete/Backspace to remove immediately. You can also use Delete Selected or Clear All.' },
        { q:'What does Clear All do?', a:'Clear All deletes ALL assigned blocks for the selected member for the entire week (Sun–Sat). You will be asked to confirm.' },
        { q:'What does Send do?', a:'Send notifies members that the schedule was updated and requires acknowledgement. Team Lead can see who acknowledged.' },
      ],
      manual: [
        {title:'Assign blocks', caption:'Assign 1-hour blocks via drag or Paint', svg: mkGuideSvg('Assign Tasks','Drag on the hour grid — snaps to hours only')},
        {title:'Leave buttons', caption:'SL/EL/VL/HL grey out a member for the selected date', svg: mkGuideSvg('Leave Controls','Click to set; click again to remove (confirm)')},
        {title:'Coverage Meter', caption:'OK Hours and Health% for the selected day grid', svg: mkGuideSvg('Coverage Meter','Shows day label and health trend signals')},
        {title:'Send & Acknowledge', caption:'Send updates to members and track acknowledgements', svg: mkGuideSvg('Send','Members receive pop-up + beep, then acknowledge')}
      ],
      notes: [
        'Active members appear on top. Members on Rest Day or Leave appear below.',
        'Rest Day is driven by Master Schedule and follows Manila calendar date (no timezone shifts).',
        'Locked weeks cannot be edited. Unlock (Mon–Fri) if you need changes.'
      ],
      legends: [
        ['SL','Sick Leave'],
        ['EL','Emergency Leave'],
        ['VL','Vacation Leave'],
        ['HL','Holiday Leave'],
        ['🖌','Paint mode'],
        ['🧹','Clear All'],
        ['⌫','Delete selected blocks'],
        ['ON REST DAY','Member is not schedulable on that date'],
      ]
    },
    master_schedule: {
      title: 'Master Schedule',
      guide: [
        { q:'What is Master Schedule?', a:'Master Schedule defines each member\'s fixed Rest Day pattern (e.g., Friday & Saturday) and frequency (monthly/quarterly). It drives the Rest Day greying in Assign Tasks.' },
        { q:'How do I set Rest Days?', a:'Select a member, choose rest weekdays, choose frequency, then save. The Assign Tasks page updates automatically.' },
      ],
      manual: [
        {title:'Rest days', caption:'Set fixed rest weekdays per member', svg: mkGuideSvg('Master Schedule','Choose weekdays and save rule')} ,
        {title:'Frequency', caption:'Monthly / Every 2 months / Every 3 months / Quarterly', svg: mkGuideSvg('Frequency','Controls when fixed pattern repeats')}
      ],
      notes: [
        'Rest Day is a calendar rule (weekday-based) computed in Manila time.',
        'Members on Rest Day are shown as disabled in Assign Tasks with “ON REST DAY”.'
      ],
      legends: [
        ['Fri/Sat','Example Rest Day selection'],
        ['Monthly','Rule frequency example']
      ]
    },
    users: {
      title: 'User Management',
      guide: [
        { q:'What is this page for?', a:'User Management is where Admin/Super User maintains the user roster, roles, and team assignment.' },
        { q:'Why do users sometimes look missing?', a:'MUMS includes recovery/migration logic for older stored user keys. If a browser profile was reset, re-import or re-create users as needed.' },
      ],
      manual: [
        {title:'Roles', caption:'Assign MEMBER, TEAM_LEAD, ADMIN, SUPER_ADMIN', svg: mkGuideSvg('User Management','Roles control what pages are visible')} ,
        {title:'Roster', caption:'Create and maintain user list', svg: mkGuideSvg('User Roster','Existing users are recovered via migration/backup')}
      ],
      notes: [
        'For production multi-user shared data, connect to online backend later (realtime roster + schedules).'
      ],
      legends: [
        ['TEAM_LEAD','Can manage schedules for own team'],
        ['ADMIN','Can manage users + teams'],
        ['SUPER_ADMIN','Full access (MUMS)']
      ]
    },
    announcements: {
      title: 'Announcements',
      guide: [
        { q:'How does the announcement bar work?', a:'The top bar rotates one announcement every 3 seconds. Clicking it opens the full message.' },
        { q:'What is shown on the bar?', a:'Page › Announcement details › Creator full name › Broadcast time (Manila).' },
      ],
      manual: [
        {title:'Broadcast', caption:'Create announcement with creator and timestamp', svg: mkGuideSvg('Announcements','Rotates 1 item every 3 seconds')} ,
        {title:'Format', caption:'Page › Announcement: Details › User › Time', svg: mkGuideSvg('Announcement Bar','Shows who sent it and when (Manila)')}
      ],
      notes: [
        'Members can control notification sound in Settings > Sound.'
      ],
      legends: [
        ['📣','Announcement'],
        ['🔔','Notification sound (if enabled)']
      ]
    },
    logs: {
      title: 'Activity Logs',
      guide: [
        { q:'What is recorded?', a:'Important actions like schedule edits, leaves, sends, locks/unlocks, and exports are tracked for visibility.' },
      ],
      notes: [
        'Team Leads usually see their team logs unless “show all” is enabled (Admin only).' 
      ],
      legends: [
        ['🕒','Time of action'],
        ['Team tag','Which team the action belongs to']
      ]
    }
  };

  function buildGuideKB(){
    const kb=[];
    const guides=GUIDES||{};
    const sections=[['guide','GUIDE'],['notes','NOTES'],['legends','LEGENDS'],['manual','MANUAL']];
    const norm=(s)=>String(s||'').toLowerCase();
    Object.keys(guides).forEach(pageId=>{
      const g=guides[pageId]||{};
      const pageTitle=g.title||pageId;
      sections.forEach(([key,label])=>{
        const items=g[key]||[];
        if(key==='notes'){
          items.forEach((t,i)=>{
            const q=label+' '+(i+1);
            const a=String(t||'');
            const blob=norm([pageId,pageTitle,label,q,a].join(' '));
            kb.push({pageId,pageTitle,section:label,q,aShort:a,aLong:'',steps:[],tips:[],tags:[],blob});
          });
          return;
        }
        if(key==='legends'){
          items.forEach((r,i)=>{
            const q=String((r&&r[0])|| (label+' '+(i+1)));
            const a=String((r&&r[1])||'');
            const blob=norm([pageId,pageTitle,label,q,a].join(' '));
            kb.push({pageId,pageTitle,section:label,q,aShort:a,aLong:'',steps:[],tips:[],tags:[],blob});
          });
          return;
        }
        if(key==='manual'){
          items.forEach((it,i)=>{
            const q=String(it?.title || ('Manual '+(i+1)));
            const a=String(it?.caption || '');
            const blob=norm([pageId,pageTitle,label,q,a].join(' '));
            kb.push({pageId,pageTitle,section:label,q,aShort:a,aLong:'',steps:[],tips:[],tags:[],blob});
          });
          return;
        }
        items.forEach((it,i)=>{
          if(!it) return;
          const q=String(it.q || ('Guide '+(i+1)));
          const a=String(it.a || it.a_short || '');
          const aLong=String(it.a_long || '');
          const steps=Array.isArray(it.steps)?it.steps:[];
          const tips=Array.isArray(it.tips)?it.tips:[];
          const tags=Array.isArray(it.tags)?it.tags:[];
          const blob=norm([pageId,pageTitle,label,q,a,aLong,steps.join(' '),tips.join(' '),tags.join(' ')].join(' '));
          kb.push({pageId,pageTitle,section:label,q,aShort:a,aLong,steps,tips,tags,blob});
        });
      });
    });
    return kb;
  }

  const _guideKB = buildGuideKB();

  function _tokenize(s){
    return String(s||'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(Boolean).filter(w=>w.length>1);
  }

  function _scoreGuideItem(tokens, item, currentPageId){
    let score=0;
    if(item.pageId===currentPageId) score+=20;
    const blob=item.blob||'';
    const q=String(item.q||'').toLowerCase();
    for(const t of tokens){
      if(blob.includes(t)) score+=3;
      if(q.includes(t)) score+=4;
    }
    const joined=tokens.join(' ');
    if(joined.includes('paint') && blob.includes('paint')) score+=8;
    if(joined.includes('coverage') && blob.includes('coverage')) score+=8;
    if(joined.includes('clear') && blob.includes('clear')) score+=6;
    if((joined.includes('sl')||joined.includes('el')||joined.includes('vl')||joined.includes('hl')) && item.section==='LEGENDS') score+=6;
    return score;
  }

  function updateAnnouncementBar(){
    const bar = UI.el('#announceBar');
    const active = UI.activeAnnouncements();

    const titleEl = UI.el('#announceTitle');
    const msgEl = UI.el('#announceMsg');
    const metaEl = UI.el('#announceMeta');
    const avatarEl = UI.el('#announceAvatar');
    const whoEl = UI.el('#announceWho');

    if(!active.length){
      bar.style.visibility='hidden';
      bar.dataset.count='0';
      bar.dataset.idx='0';
      if(avatarEl) avatarEl.innerHTML = '';
      if(whoEl) whoEl.textContent = '';
      return;
    }

    bar.style.visibility='visible';
    const count = active.length;
    const idx = Number(bar.dataset.idx||0) % count;
    const a = active[idx];

    bar.dataset.count = String(count);
    bar.dataset.idx = String(idx);

    const who = a.createdByName || '—';
    if(whoEl) whoEl.textContent = who;

    const tms = a.startAt || a.createdAt;
    let when = '—';
    if(tms){
      const ts = new Date(tms);
      const p = UI.manilaParts(ts);
      const pad = n => String(n).padStart(2,'0');
      when = `${p.isoDate} ${pad(p.hh)}:${pad(p.mm)}`;
    }

    if(titleEl) titleEl.textContent = String(a.title||'Announcement');
    if(msgEl) msgEl.textContent = String(a.short || '').trim() || '—';
    if(metaEl) metaEl.textContent = when ? `Active from ${when}` : '';

    try{
      const pid = String(a.createdBy||'');
      const prof = pid ? Store.getProfile(pid) : null;
      const photo = prof && prof.photoDataUrl ? prof.photoDataUrl : '';
      const initials = String(who||'—').trim().split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase();
      if(avatarEl){
        avatarEl.innerHTML = photo
          ? `<img src="${photo}" alt="" />`
          : `<div class="initials">${UI.esc(initials || '—')}</div>`;
      }
    }catch(_){}

    bar.onclick = ()=>{
      UI.el('#annModalTitle').textContent = a.title || 'Announcement';
      const body = UI.el('#annModalBody');
      if(a.fullHtml){ body.innerHTML = a.fullHtml; }
      else { body.textContent = a.full || a.short || ''; }
      UI.openModal('topAnnModal');
    };
  }

  function startAnnouncementRotation(){
    if(annTimer) return;
    updateAnnouncementBar();
    // PERF FIX v4.0: Increased from 3s to 8s — 3s caused unnecessary DOM thrashing.
    annTimer = setInterval(()=>{
      try{
      const bar = UI.el('#announceBar');
      const count = Number(bar.dataset.count||0);
      if(count<=1){ updateAnnouncementBar(); return; }
      bar.dataset.idx = String((Number(bar.dataset.idx||0)+1)%count);
      updateAnnouncementBar();
    
      }catch(e){ console.error('Announcement interval error', e); }
    }, 8000);
  }

  
  function _normalizeRouteSegment(raw){
    try{
      let s = String(raw||'').trim();
      if(!s) return '';
      if(s.startsWith('#')) s = s.slice(1);
      if(s.startsWith('/')) s = s.slice(1);
      return s.split('?')[0].split('#')[0].split('/')[0] || '';
    }catch(_){ return ''; }
  }

  function _normalizeRoutePath(raw){
    try{
      let s = String(raw||'').trim();
      if(!s) return '';
      if(s.startsWith('#')) s = s.slice(1);
      if(s.startsWith('/')) s = s.slice(1);
      s = s.split('?')[0].split('#')[0];
      s = s.replace(/\/+$/g,'');
      return s;
    }catch(_){ return ''; }
  }

  function _routePageIdFromRoutePath(routePath){
    try{
      const rp = String(routePath||'').trim().toLowerCase();
      if(rp === 'distribution/monitoring') return 'distribution_monitoring';
      // System sub-pages all resolve to main 'system' page (tab driven internally)
      if(rp.startsWith('system/') || rp === 'system') return 'system';
      // Backward compatibility for legacy System submenu URLs like /system_overview
      if(rp.startsWith('system_')) return 'system';
      return String(routePath||'').split('/')[0] || '';
    }catch(_){ return ''; }
  }

  function _routePathForPageId(pageId){
    try{
      const id = String(pageId||'').trim();
      if(id === 'distribution_monitoring') return '/distribution/monitoring';
      if(id.startsWith('system_')){
        const tab = id.slice('system_'.length).trim().toLowerCase();
        return tab ? ('/system/' + tab) : '/system';
      }
      return '/' + id;
    }catch(_){ return '/' + String(pageId||''); }
  }

  function _routePageIdFromHref(href){
    try{
      const h = String(href||'').trim();
      if(!h) return '';

      if(h[0] === '#'){
        const routePath = _normalizeRoutePath(h);
        return _routePageIdFromRoutePath(routePath);
      }
      if(h[0] === '/'){
        const routePath = _normalizeRoutePath(h);
        return _routePageIdFromRoutePath(routePath);
      }
      return '';
    }catch(_){ return ''; }
  }

  function resolveRoutePageId(){
    try{
      const pages = window.Pages || {};
      const hashPath = _normalizeRoutePath(window.location.hash||'');
      const hashId = _routePageIdFromRoutePath(hashPath);

      const proto = String(window.location.protocol||'');
      if(proto !== 'file:'){
        const path = _normalizeRoutePath(window.location.pathname||'/');
        const pathId = _routePageIdFromRoutePath(path);

        if(pathId && !pathId.includes('.') && pages[pathId]) return pathId;
        if(hashId && pages[hashId]) return hashId;
      }else{
        if(hashId && pages[hashId]) return hashId;
      }

      if(pages['dashboard']) return 'dashboard';
      const keys = Object.keys(pages);
      return keys.length ? keys[0] : 'dashboard';
    }catch(_){
      return 'dashboard';
    }
  }

  const NAV_RENDER = {
    seq: 0,
    queued: false,
    queuedReason: '',
    inFlight: false,
    lastPageId: '',
    lastHref: ''
  };

  function requestRouteRender(reason){
    NAV_RENDER.queuedReason = String(reason||'route');
    if(NAV_RENDER.queued) return;
    NAV_RENDER.queued = true;
    Promise.resolve().then(()=>{
      NAV_RENDER.queued = false;
      route(NAV_RENDER.queuedReason || 'route');
    });
  }


  function navigateToPageId(pageId, opts){
    const pages = window.Pages || {};
    const requestedId = String(pageId||'').trim();
    let id = requestedId;
    if(!id || !pages[id]){
      if(id.startsWith('system_') && pages['system']) id = 'system';
      else id = pages['dashboard'] ? 'dashboard' : (Object.keys(pages)[0] || 'dashboard');
    }

    const proto = String(window.location.protocol||'');
    if(proto === 'file:'){
      window.location.hash = '#' + id;
      return;
    }

    try{
      const url = _routePathForPageId(requestedId || id);
      const currentPath = _normalizeRoutePath(window.location.pathname||'/');
      const targetPath = _normalizeRoutePath(url);
      if(currentPath === targetPath && NAV_RENDER.lastPageId === id){
        requestRouteRender('navigate:same-page-refresh');
        return;
      }
      if(opts && opts.replace) history.replaceState({},'', url);
      else history.pushState({},'', url);
      try{ if(window.location.hash) history.replaceState({},'', url); }catch(_){ }
      requestRouteRender('navigate:' + id);
    }catch(_){
      window.location.hash = '#' + id;
    }
  }

  function route(reason){
    const runSeq = ++NAV_RENDER.seq;
    NAV_RENDER.inFlight = true;
    try{
      const user = Auth.getUser();
      if(!user) return;
      renderUserCard(user);
      renderSideLogs(user);

      const pageId = resolveRoutePageId();
      NAV_RENDER.lastPageId = pageId;
      NAV_RENDER.lastHref = String(window.location.pathname || window.location.hash || '');

      if(runSeq !== NAV_RENDER.seq) return;

	      try{ window._currentPageId = pageId; }catch(_){ }
	      try{ window.__mumsRouteSeq = runSeq; }catch(_){ }
      try{
        const menu = (Config && Array.isArray(Config.NAV)) ? Config.NAV : [];
        const flat = [];
        menu.forEach((item)=>{
          if(!item) return;
          flat.push(item);
          if(Array.isArray(item.children)) item.children.forEach(child=> flat.push(child));
        });
        const m = flat.find(x=>x && x.id===pageId) || null;
        window._currentPageLabel = m ? (m.label||pageId) : pageId;
      }catch(e){ window._currentPageLabel = pageId; }

      if(runSeq !== NAV_RENDER.seq) return;

      setActiveNav(pageId);

      const main = UI.el('#main');
      if(!main) return;
      if(cleanup){ try{ cleanup(); }catch(e){} cleanup=null; }
      main.innerHTML = '';
      main.dataset.routeSeq = String(runSeq);

      try{
        window.Pages[pageId](main);
      }catch(pageErr){
        showFatalError(pageErr);
      }
      if(runSeq !== NAV_RENDER.seq) return;
      if(main._cleanup){ cleanup = main._cleanup; main._cleanup = null; }

      updateAnnouncementBar();
    }catch(e){
      showFatalError(e);
    }finally{
      if(runSeq === NAV_RENDER.seq) NAV_RENDER.inFlight = false;
    }
  }

  const ReminderEngine = (function(){
    let started = false;
    let timer = null;
    let ticking = false;

    let showAll = false;
    const expanded = new Set();
    let lastSignature = '';

    const KEYS = {
      my: 'mums_my_reminders',
      team: 'mums_team_reminders',
      settings: 'mums_reminder_settings',
      prefsPrefix: 'mums_reminder_prefs_'
    };

    function getSettings(){
      try{
        if(window.Store && typeof Store.getReminderSettings === 'function'){
          return Store.getReminderSettings();
        }
      }catch(_){}
      return { snoozePresets:[5,10,15,30], categories:['Work','Personal','Urgent'], escalationAfterMin:2, maxVisible:3 };
    }

    function getPrefs(userId){
      try{
        const raw = localStorage.getItem(KEYS.prefsPrefix + String(userId));
        if(!raw) return { muteUntil: 0 };
        const o = JSON.parse(raw);
        return (o && typeof o === 'object') ? { muteUntil: Number(o.muteUntil||0) } : { muteUntil: 0 };
      }catch(_){ return { muteUntil: 0 }; }
    }
    function setPrefs(userId, patch){
      try{
        const cur = getPrefs(userId);
        const next = Object.assign({}, cur, patch||{});
        next.muteUntil = Number(next.muteUntil||0);
        localStorage.setItem(KEYS.prefsPrefix + String(userId), JSON.stringify(next));
        try{ window.dispatchEvent(new CustomEvent('mums:store', { detail:{ key: KEYS.prefsPrefix + String(userId) }})); }catch(_){}
      }catch(_){}
    }

    const Audio = (function(){
      let ctx = null;
      let osc = null;
      let gain = null;
      let running = false;
      let locked = false;
      let pulseTimer = null;
      let curInterval = 650;

      function ensure(){
        if(ctx) return;
        try{
          const AC = window.AudioContext || window.webkitAudioContext;
          if(!AC) return;
          ctx = new AC();
          gain = ctx.createGain();
          gain.gain.value = 0.0001;
          gain.connect(ctx.destination);
          osc = ctx.createOscillator();
          osc.type = 'sine';
          osc.frequency.value = 880;
          osc.connect(gain);
          osc.start();
        }catch(e){
          ctx=null; osc=null; gain=null;
        }
      }
      async function unlock(){
        try{
          ensure();
          if(!ctx) return false;
          if(ctx.state === 'suspended') await ctx.resume();
          locked = false;
          return true;
        }catch(e){
          locked = true;
          return false;
        }
      }
      async function start(mode){
        ensure();
        if(!ctx || !gain) { locked=true; return; }
        try{
          if(ctx.state === 'suspended') await ctx.resume();
          locked = false;
        }catch(e){ locked=true; }
        const interval = (mode && mode.interval) ? Number(mode.interval) : 650;
        const amp = (mode && mode.amp) ? Number(mode.amp) : 0.04;

        if(running && interval === curInterval) return;

        running = true;
        curInterval = interval;

        try{ if(pulseTimer) clearInterval(pulseTimer); }catch(_){}
        pulseTimer = null;

        let on = false;
        const pulse = ()=>{
          if(!running) return;
          try{
            on = !on;
            gain.gain.setTargetAtTime(on ? amp : 0.0001, ctx.currentTime, 0.01);
          }catch(e){}
        };
        pulse();
        pulseTimer = setInterval(pulse, curInterval);
      }
      function stop(){
        running = false;
        try{ if(pulseTimer) clearInterval(pulseTimer); }catch(_){}
        pulseTimer = null;
        try{
          if(gain && ctx) gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.01);
        }catch(e){}
      }
      function isLocked(){ return !!locked; }
      return { start, stop, unlock, isLocked };
    })();

    function repeatLabel(r){
      const rep = String(r.repeat||'none');
      if(rep === 'custom') return 'Custom';
      if(rep === 'daily') return 'Daily';
      if(rep === 'weekly') return 'Weekly';
      return 'One-time';
    }

    function nextAlarmAtForReminder(r, now){
      const rep = String(r.repeat||'none');
      const base = Number(r.alarmAt||now);
      if(rep === 'none') return base;

      const baseDate = new Date(base);
      const hh = baseDate.getHours();
      const mm = baseDate.getMinutes();

      const makeCandidate = (d)=>{
        const dt = new Date(d);
        dt.setHours(hh, mm, 0, 0);
        return dt.getTime();
      };

      if(rep === 'daily'){
        let t = makeCandidate(now);
        if(t <= now + 500) t += 24*60*60*1000;
        return t;
      }

      if(rep === 'weekly'){
        const targetDow = baseDate.getDay();
        const d0 = new Date(now);
        d0.setHours(0,0,0,0);
        for(let i=0;i<14;i++){
          const d = new Date(d0.getTime() + i*24*60*60*1000);
          if(d.getDay() === targetDow){
            const t = makeCandidate(d.getTime());
            if(t > now + 500) return t;
          }
        }
        return base + 7*24*60*60*1000;
      }

      if(rep === 'custom'){
        const days = Array.isArray(r.repeatDays) ? r.repeatDays.map(x=>Number(x)).filter(x=>x>=0 && x<=6) : [];
        if(!days.length) return base;
        const set = new Set(days);
        const d0 = new Date(now);
        d0.setHours(0,0,0,0);
        for(let i=0;i<21;i++){
          const d = new Date(d0.getTime() + i*24*60*60*1000);
          if(set.has(d.getDay())){
            const t = makeCandidate(d.getTime());
            if(t > now + 500) return t;
          }
        }
        return base + 7*24*60*60*1000;
      }

      return base;
    }

    function getActiveForUser(user){
      const now = Date.now();
      const active = [];
      try{
        const my = (Store.getMyReminders && Store.getMyReminders(user.id)) || [];
        my.forEach(r=>{
          if(!r || r.closedAt) return;
          const dueAt = (r.snoozeUntil && r.snoozeUntil>now) ? r.snoozeUntil : r.alarmAt;
          if(now >= Number(dueAt||0)){
            const ageMin = Math.max(0, (now - Number(dueAt||now)) / 60000);
            active.push({ kind:'my', r, dueAt, ageMin });
          }
        });

        const team = (Store.getTeamReminders && Store.getTeamReminders(user.teamId)) || [];
        team.forEach(r=>{
          if(!r) return;
          const st = (r.perUser && r.perUser[String(user.id)]) ? r.perUser[String(user.id)] : {};
          if(st && st.closedAt) return;
          const dueAt = (st && st.snoozeUntil && st.snoozeUntil>now) ? st.snoozeUntil : r.alarmAt;
          if(now >= Number(dueAt||0)){
            const ageMin = Math.max(0, (now - Number(dueAt||now)) / 60000);
            active.push({ kind:'team', r, dueAt, ageMin });
          }
        });
      }catch(e){}

      active.sort((a,b)=>{
        const pa = (a.r && a.r.priority==='high') ? 0 : 1;
        const pb = (b.r && b.r.priority==='high') ? 0 : 1;
        if(pa!==pb) return pa-pb;
        return (a.dueAt||0)-(b.dueAt||0);
      });
      return active;
    }

    function getNextDueForUser(user){
      const now = Date.now();
      let min = null;
      try{
        const my = (Store.getMyReminders && Store.getMyReminders(user.id)) || [];
        my.forEach(r=>{
          if(!r || r.closedAt) return;
          const dueAt = (r.snoozeUntil && r.snoozeUntil>now) ? r.snoozeUntil : r.alarmAt;
          const t = Number(dueAt||0);
          if(!t) return;
          if(min===null || t < min) min = t;
        });

        const team = (Store.getTeamReminders && Store.getTeamReminders(user.teamId)) || [];
        team.forEach(r=>{
          if(!r) return;
          const st = (r.perUser && r.perUser[String(user.id)]) ? r.perUser[String(user.id)] : {};
          if(st && st.closedAt) return;
          const dueAt = (st && st.snoozeUntil && st.snoozeUntil>now) ? st.snoozeUntil : r.alarmAt;
          const t = Number(dueAt||0);
          if(!t) return;
          if(min===null || t < min) min = t;
        });
      }catch(_){}
      return min;
    }

    function signatureFor(active, settings){
      const parts = active.map(a=>{
        const r = a.r||{};
        return [
          a.kind, r.id,
          Number(a.dueAt||0),
          String(r.short||''),
          String(r.details||''),
          String(r.priority||'normal'),
          String(r.category||''),
          String(r.repeat||'none'),
          Array.isArray(r.repeatDays)? r.repeatDays.join('.') : '',
          Math.floor(a.ageMin*10)/10
        ].join('|');
      });
      return [String(showAll), String(Audio.isLocked()), String(settings.escalationAfterMin||0), String(settings.maxVisible||3), parts.join(';;')].join('::');
    }

    function renderCards(user, active){
      const host = UI.el('#reminderFloatHost');
      if(!host) return;

      const settings = getSettings();
      const sig = signatureFor(active, settings);

      if(sig === lastSignature){
        return;
      }
      lastSignature = sig;

      host.innerHTML = '';
      if(!active.length) return;

      const maxVisible = Math.max(1, Number(settings.maxVisible||3));
      const now = Date.now();

      const visible = showAll ? active : active.slice(0, maxVisible);
      const hiddenCount = showAll ? 0 : Math.max(0, active.length - visible.length);

      if(hiddenCount > 0){
        const more = document.createElement('div');
        more.className = 'reminder-card more';
        more.innerHTML = `
          <div class="rc-top">
            <div class="rc-badge">Reminders</div>
            <div style="min-width:0;flex:1 1 auto">
              <div class="rc-title">+${hiddenCount} more</div>
              <div class="rc-meta">Click to expand the full list</div>
            </div>
            <div class="rc-actions">
              <button class="rc-close" type="button" title="Show all">Show</button>
            </div>
          </div>
        `;
        more.addEventListener('click', (e)=>{
          e.stopPropagation();
          showAll = true;
          tickSoon(0);
        });
        host.appendChild(more);
      }

      const presets = Array.isArray(settings.snoozePresets) ? settings.snoozePresets : [5,10];

      visible.forEach(item=>{
        const r = item.r;
        const kind = item.kind;
        const isMy = kind==='my';
        const cls = isMy ? 'my' : 'team';
        const pri = (r.priority==='high') ? 'high' : 'normal';
        const dueLabel = new Date(item.dueAt||r.alarmAt||now).toLocaleString();
        const badge = isMy ? 'My Reminder' : 'Team Reminder';
        const cat = String(r.category||'').trim();
        const escalated = (Number(settings.escalationAfterMin||0) > 0) && (item.ageMin >= Number(settings.escalationAfterMin||0));

        const snoozeButtons = presets.slice(0, 6).map(m=>{
          const mm = Math.max(1, Number(m||0));
          return `<button class="reminder-pill" data-act="snooze" data-min="${UI.esc(String(mm))}" type="button">Snooze ${UI.esc(String(mm))}m</button>`;
        }).join('');

        const key = `${kind}:${String(r.id||'')}`;

        const card = document.createElement('div');
        card.className = `reminder-card ${cls} ${pri}${escalated ? ' escalated' : ''}${expanded.has(key) ? ' expanded' : ''}`;
        card.setAttribute('data-kind', kind);
        card.setAttribute('data-id', String(r.id||''));
        card.innerHTML = `
          <div class="rc-top">
            <div class="rc-badge">${UI.esc(badge)}</div>
            <div style="min-width:0;flex:1 1 auto">
              <div class="rc-title">${UI.esc(r.short||'Reminder')}</div>
              <div class="rc-meta">${UI.esc(dueLabel)}${cat ? ` • ${UI.esc(cat)}` : ''}${r.priority==='high' ? ' • HIGH' : ''}${Audio.isLocked() ? ' • Sound blocked (click)' : ''}${escalated ? ' • Escalated' : ''}</div>
            </div>
            <div class="rc-actions">
              <button class="rc-close" type="button" title="Close alarm">Close</button>
            </div>
          </div>

          <div class="rc-body">
            <div class="rc-details">${UI.esc(r.details||'')}</div>
            <div class="rc-row">
              <div><b>Repeat:</b> ${UI.esc(repeatLabel(r))}</div>
              <div><b>Duration:</b> ${UI.esc(String(r.durationMin||1))}m</div>
            </div>
            <div class="rc-pills">
              ${snoozeButtons}
              <button class="reminder-pill" data-act="mute" data-min="15" type="button">Mute 15m</button>
              <button class="reminder-pill primary" data-act="open" type="button">${isMy ? 'Open My Reminders' : 'Open Team Reminders'}</button>
            </div>
          </div>
        `;
        host.appendChild(card);

        const handleCardAction = async (e)=>{
          try{
            const closeBtn = e.target && e.target.closest && e.target.closest('.rc-close');
            const pill = e.target && e.target.closest && e.target.closest('.reminder-pill');
            if(closeBtn){
              e.stopPropagation();
              await Audio.unlock();
              handleClose(user, kind, r);
              tickSoon(50);
              return;
            }
            if(pill){
              e.stopPropagation();
              await Audio.unlock();
              const act = pill.getAttribute('data-act');
              if(act==='snooze'){
                const min = Number(pill.getAttribute('data-min')||10);
                handleSnooze(user, kind, r, min);
              }else if(act==='open'){
                openReminderPage(isMy);
              }else if(act==='mute'){
                const min = Math.max(1, Number(pill.getAttribute('data-min')||15));
                const until = Date.now() + min*60*1000;
                setPrefs(user.id, { muteUntil: until });
              }
              tickSoon(50);
              return;
            }
            await Audio.unlock();
            if(expanded.has(key)) expanded.delete(key); else expanded.add(key);
            tickSoon(0);
          }catch(_){}
        };

        card.addEventListener('click', handleCardAction);
        const closeEl = card.querySelector('.rc-close');
        if(closeEl) closeEl.addEventListener('click', handleCardAction);
        card.querySelectorAll('.reminder-pill').forEach(btn=> btn.addEventListener('click', handleCardAction));
      });
    }

    function handleClose(user, kind, r){
      const now = Date.now();
      if(kind==='my'){
        if((r.repeat||'none')==='none'){
          Store.updateMyReminder(r.id, { closedAt: now, snoozeUntil: null });
        }else{
          const t = nextAlarmAtForReminder(r, now);
          Store.updateMyReminder(r.id, { alarmAt: t, snoozeUntil: null, closedAt: null });
        }
      }else{
        Store.closeTeamReminderForUser(r.id, user.id);
        try{
          const all = Store.getAllTeamReminders ? Store.getAllTeamReminders() : [];
          const cur = all.find(x=>x && String(x.id)===String(r.id));
          if(cur && (cur.repeat||'none')!=='none'){
            const users = (Store.getUsers && Store.getUsers()) || [];
            const members = users.filter(u => u && u.status==='active' && String(u.teamId)===String(cur.teamId));
            const ids = members.map(u=>String(u.id));
            const perUser = cur.perUser || {};
            const allClosed = ids.length ? ids.every(id=> perUser[id] && perUser[id].closedAt ) : true;
            if(allClosed){
              const t = nextAlarmAtForReminder(cur, now);
              const ackLog = Array.isArray(cur.ackLog) ? cur.ackLog.slice() : [];
              ackLog.push({ ts: now, userId: String(user.id), action:'repeat_reset' });
              Store.updateTeamReminder(cur.id, { alarmAt: t, perUser: {}, ackLog });
            }
          }
        }catch(_){}
      }
    }

    function handleSnooze(user, kind, r, minutes){
      const now = Date.now();
      const until = now + Math.max(1, Number(minutes||10))*60*1000;
      if(kind==='my'){
        Store.updateMyReminder(r.id, { snoozeUntil: until, closedAt: null });
      }else{
        Store.snoozeTeamReminderForUser(r.id, user.id, Math.max(1, Number(minutes||10)));
      }
    }

    function openReminderPage(isMy){
      const targetHash = isMy ? '#my_reminders' : '#team_reminders';
      if(window.location.hash === targetHash){
        try{ window.dispatchEvent(new Event('hashchange')); }catch(_){}
        try{ window.dispatchEvent(new Event('popstate')); }catch(_){}
        return;
      }
      window.location.hash = targetHash;
    }

    function computeNextDelay(user, active){
      const now = Date.now();
      if(active.length){
        return 1000;
      }
      const nextDue = getNextDueForUser(user);
      if(nextDue === null) return 60000;
      const dt = Math.max(250, Math.min(60000, Number(nextDue) - now));
      return dt;
    }

    async function tick(){
      if(ticking) return;
      ticking = true;
      try{
        const user = Auth.getUser();
        if(!user) return;

        const settings = getSettings();
        const prefs = getPrefs(user.id);
        const now = Date.now();

        const active = getActiveForUser(user);

        renderCards(user, active);

        const muted = (prefs.muteUntil && Number(prefs.muteUntil) > now);

        if(active.length && !muted){
          const escalated = active.some(a => Number(settings.escalationAfterMin||0) > 0 && a.ageMin >= Number(settings.escalationAfterMin||0));
          await Audio.start(escalated ? { interval: 350, amp: 0.06 } : { interval: 650, amp: 0.04 });
        }else{
          Audio.stop();
          if(!active.length) showAll = false;
        }

        if(started){
          scheduleNext(computeNextDelay(user, active));
        }
      }catch(_){
        if(started) scheduleNext(2000);
      }finally{
        ticking = false;
      }
    }

    function scheduleNext(ms){
      try{ if(timer) clearTimeout(timer); }catch(_){}
      timer = setTimeout(()=>tick(), Math.max(0, Number(ms||0)));
    }
    function tickSoon(ms){
      if(!started) return;
      scheduleNext(Math.max(0, Number(ms||0)));
    }

    function start(){
      if(started) return;
      started = true;
      lastSignature = '';
      tickSoon(0);

      window.addEventListener('pointerdown', ()=>{ Audio.unlock(); }, { passive:true });
      window.addEventListener('hashchange', ()=>{ showAll = false; tickSoon(0); }, { passive:true });

      window.addEventListener('mums:store', (e)=>{
        try{
          const k = e && e.detail ? String(e.detail.key||'') : '';
          if(k === KEYS.settings || k === KEYS.my || k === KEYS.team || k.startsWith(KEYS.prefsPrefix)){
            tickSoon(0);
          }
        }catch(_){}
      });
    }

    function stop(){
      started = false;
      try{ if(timer) clearTimeout(timer); }catch(_){}
      timer = null;
      try{ Audio.stop(); }catch(_){}
    }

    return { start, stop, tickSoon, setPrefs, getPrefs };
  })();
  window.ReminderEngine = ReminderEngine;

  function openDataToolsModal(){
    try{
      const summary = document.getElementById('storageHealthSummary');
      const details = document.getElementById('healthDetails');
      const rep = Store.healthCheck ? Store.healthCheck() : {ok:true,keysChecked:0,errors:[],sizeBytes:0};
      const mb = (rep.sizeBytes/1024/1024).toFixed(2);
      if(summary) summary.textContent = rep.ok ? `OK • ${rep.keysChecked} keys • ~${mb} MB` : `Issues • ${rep.errors.length} errors • ~${mb} MB`;
      if(details) details.textContent = rep.ok ? '' : rep.errors.map(e=>`${e.key}: ${e.error}`).join('\n');

      const runBtn = document.getElementById('runHealthCheckBtn');
      if(runBtn){
        runBtn.onclick = ()=>{
          const r = Store.healthCheck();
          const mb2 = (r.sizeBytes/1024/1024).toFixed(2);
          if(summary) summary.textContent = r.ok ? `OK • ${r.keysChecked} keys • ~${mb2} MB` : `Issues • ${r.errors.length} errors • ~${mb2} MB`;
          if(details) details.textContent = r.ok ? '' : r.errors.map(e=>`${e.key}: ${e.error}`).join('\n');
        };
      }

      const exportBtn = document.getElementById('exportAllBtn');
      if(exportBtn){
        exportBtn.onclick = ()=>{
          const data = Store.exportAllData();
          UI.downloadJSON(data, `mums_export_${new Date().toISOString().slice(0,10)}.json`);
        };
      }

      const impInput = document.getElementById('importAllInput');
      if(impInput){
        impInput.onchange = async ()=>{
          const f = impInput.files && impInput.files[0];
          if(!f) return;
          const txt = await f.text();
          let obj=null;
          try{ obj = JSON.parse(txt); }catch(e){ alert('Invalid JSON'); return; }
          const res = Store.importAllData(obj);
          if(!res.ok){ alert('Import failed: '+(res.error||'')); return; }
          alert('Import successful. Reloading...');
          location.reload();
        };
      }

      const resetBtn = document.getElementById('factoryResetBtn2');
      if(resetBtn){
        resetBtn.onclick = async ()=>{
          const ok = await UI.confirm({ title:'Factory Reset', message:'Factory reset local data? This will clear offline storage for this app.', okText:'Reset', danger:true });
          if(!ok) return;
          try{ Store.factoryReset && Store.factoryReset(); }catch(e){}
          alert('Reset complete. Reloading...');
          location.href = '/login';
        };
      }

      UI.openModal('dataHealthModal');
    }catch(e){ console.error(e); }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MUMS NOTIFICATION SYSTEM — v3.9.47
  // Scans QB records for Case Notes with today's Manila date.
  // Excludes entries where the tech name in [DATE TIME NAME] matches the
  // current user's QB Name (they wrote it themselves — no need to notify them).
  // ══════════════════════════════════════════════════════════════════════════
  (function _initMumsNotifications() {

    // ── Manila today string ──────────────────────────────────────────────
    function _manilaToday() {
      try {
        const parts = {};
        new Intl.DateTimeFormat('en-US', { timeZone:'Asia/Manila', year:'2-digit', month:'short', day:'2-digit' })
          .formatToParts(new Date()).forEach(p => { parts[p.type] = p.value; });
        return parts.month.toUpperCase().slice(0,3) + '-' + parts.day.replace(/^0/,'') + '-' + parts.year;
      } catch(_) { return ''; }
    }

    // ── Relative time label ──────────────────────────────────────────────
    function _relTime(dateObj) {
      if (!dateObj) return '';
      const diff = Date.now() - dateObj.getTime();
      const mins = Math.round(diff / 60000);
      if (mins < 1) return 'Just now';
      if (mins < 60) return mins + ' min ago';
      const hrs = Math.round(mins / 60);
      if (hrs < 24) return hrs + 'h ago';
      return 'Yesterday';
    }

    // ── Parse [MON-DD-YY HH:MM AM/PM NAME] bracket → { dateStr, time, who, dateObj } ──
    // NOTE: Input is already PHT-converted text. dateObj is for sorting/relTime display only.
    function _parseBracket(bracketText) {
      // Pattern: MON-DD-YY HH:MM AM/PM Name Here
      const re = /^([A-Z]{3}-\d{1,2}-\d{2})\s+(\d{1,2}:\d{2}(?:\s*(?:AM|PM))?)\s+(.+)$/i;
      const m = re.exec(bracketText.trim());
      if (!m) return null;
      const MMAP = {JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11};
      const dateParts = m[1].split('-');
      const mon = dateParts[0].toUpperCase();
      if (!(mon in MMAP)) return null;
      const dd = parseInt(dateParts[1], 10);
      const yy = parseInt(dateParts[2], 10);
      const year = yy < 50 ? 2000+yy : 1900+yy;
      const timeParts = m[2].trim().split(/[\s:]/);
      let hh = parseInt(timeParts[0], 10);
      const mi = parseInt(timeParts[1], 10);
      const ap = (m[2].match(/PM/i) ? 'PM' : (m[2].match(/AM/i) ? 'AM' : ''));
      if (ap === 'PM' && hh < 12) hh += 12;
      if (ap === 'AM' && hh === 12) hh = 0;
      // Timestamps are already PHT (UTC+8) — convert to UTC for accurate sorting
      const dateObj = new Date(Date.UTC(year, MMAP[mon], dd, hh - 8, mi, 0)); // PHT → UTC
      return { dateStr: m[1], timeStr: m[2].trim(), who: m[3].trim(), dateObj, bracketDateToken: m[1] };
    }

    // ── Get current user's QB name ───────────────────────────────────────
    function _myQbName() {
      try {
        const user = (window.Auth && Auth.getUser) ? Auth.getUser() : null;
        if (!user) return '';
        // Check qb_name on profile
        const prof = (window.Store && Store.getProfile) ? Store.getProfile(user.id || user.user_id) : null;
        const qbName = String((prof && prof.qb_name) || (user && user.qb_name) || '').trim().toLowerCase();
        return qbName;
      } catch(_) { return ''; }
    }

    // ── Colour index for avatar — keyed on reporter NAME (not case ID) ────
    // Same person always gets the same colour across all notifications.
    function _colIdx(str) {
      let h = 0;
      for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffffffff;
      return (Math.abs(h) % 4) + 1; // 1-4
    }

    // ── Escape HTML ───────────────────────────────────────────────────────
    function _esc(s) {
      return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    // ── Include me preference ─────────────────────────────────────────────
    // LS key: mums_notif_include_me — 'true' = include own updates in notifications
    // Default: 'false' (exclude own updates — original behaviour)
    var LS_INCLUDE_ME = 'mums_notif_include_me';

    function _isIncludeMeOn() {
      try { return localStorage.getItem(LS_INCLUDE_ME) === 'true'; } catch(_) { return false; }
    }

    function _syncIncludeMeCheckbox() {
      var cb = document.getElementById('mnpIncludeMe');
      var hint = document.getElementById('mnpIncludeMeHint');
      if (!cb) return;
      var on = _isIncludeMeOn();
      cb.checked = on;
      if (hint) hint.textContent = on
        ? 'Your own case note updates are included'
        : 'Your own updates are excluded by default';
    }

    window.__mumsNotifToggleIncludeMe = function(checked) {
      try { localStorage.setItem(LS_INCLUDE_ME, checked ? 'true' : 'false'); } catch(_) {}
      var hint = document.getElementById('mnpIncludeMeHint');
      if (hint) hint.textContent = checked
        ? 'Your own case note updates are included'
        : 'Your own updates are excluded by default';
      // Re-build notifications with new preference
      const qb = window.__mumsQbRecords;
      if (qb && Array.isArray(qb.records)) {
        window.__mumsNotifRefresh(qb.records, qb.columns);
      }
    };

    // ── Core: scan records and build notification items ───────────────────
    // IMPORTANT: QB stores case note timestamps in EST (UTC-5).
    // We must convert them to PHT (UTC+8) before comparing against Manila today.
    // _convertCNtoPHT mirrors the logic in my_quickbase.js _convertNotesESTtoPHT.
    // DST-aware Eastern Time → PHT converter for notification system
    // QB uses Eastern Time (ET): EDT(UTC-4) Mar-Nov, EST(UTC-5) Dec-Feb
    function _etOffsetH(year, month, day) {
      if (month > 2 && month < 10) return 4;
      if (month === 2) { const d = new Date(year,2,1); const s2 = ((7-d.getDay())%7)+8; return day>=s2?4:5; }
      if (month === 10) { const d = new Date(year,10,1); const s1 = ((7-d.getDay())%7)+1; return day<s1?4:5; }
      return 5;
    }
    function _convertCNtoPHT(text) {
      if (!text) return text;
      const _MMAP = {JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11};
      const _MN   = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
      return text.replace(
        /\[([A-Z]{3})-(\d{1,2})-(\d{2})\s+(\d{1,2}):(\d{2})\s*(AM|PM)([\s\S]*?)\]/gi,
        function(full, mon, dd, yy, hh, mi, ap, rest) {
          try {
            const monU = mon.toUpperCase();
            if (!(_MMAP[monU] !== undefined)) return full;
            const year = parseInt(yy) < 50 ? 2000+parseInt(yy) : 1900+parseInt(yy);
            const month = _MMAP[monU], day = parseInt(dd);
            let h = parseInt(hh);
            if (ap.toUpperCase()==='PM' && h<12) h+=12;
            if (ap.toUpperCase()==='AM' && h===12) h=0;
            const offsetH = _etOffsetH(year, month, day);
            const utcMs = Date.UTC(year, month, day, h+offsetH, parseInt(mi), 0);
            const phtMs = utcMs + 8*3600*1000;
            const p     = new Date(phtMs);
            const ph    = p.getUTCHours(), pm2 = p.getUTCMinutes();
            const pap   = ph>=12?'PM':'AM';
            const ph12  = ph%12||12;
            return '['+_MN[p.getUTCMonth()]+'-'+p.getUTCDate()+'-'+
              String(p.getUTCFullYear()).slice(-2)+' '+ph12+':'+
              String(pm2).padStart(2,'0')+' '+pap+rest+']';
          } catch(_) { return full; }
        }
      );
    }

    function _buildNotifications(records, columns) {
      const today = _manilaToday();
      if (!today || !Array.isArray(records)) return [];
      const myQb = _myQbName();

      // Find Case Notes column
      const cnCol = columns.find(c => ['case notes','notes'].includes(String(c&&c.label||'').trim().toLowerCase()));
      // Find Case # / record id column
      const caseNumCol = columns.find(c => String(c&&c.label||'').trim().toLowerCase() === 'case #');
      // Find Short Description column
      const descCol = columns.find(c => {
        const lbl = String(c&&c.label||'').trim().toLowerCase();
        return lbl.includes('short description') || lbl.includes('concern') || lbl === 'description' || lbl === 'subject';
      });

      if (!cnCol) return [];

      const items = [];
      const todayRe = new RegExp('\\[(' + today.replace(/-/g,'\\-') + '\\s[^\\]]+)\\]', 'gi');

      records.forEach(row => {
        const cnRaw = row && row.fields && row.fields[String(cnCol.id)] ? String(row.fields[String(cnCol.id)].value || '') : '';
        if (!cnRaw) return;
        // Convert EST→PHT so timestamps match Manila today correctly
        const cnVal = _convertCNtoPHT(cnRaw);

        // Find all today brackets
        const matches = [];
        let m;
        const re = new RegExp('\\[(' + today.replace(/-/g,'\\-') + '\\s[^\\]]+)\\]', 'gi');
        while ((m = re.exec(cnVal)) !== null) {
          const parsed = _parseBracket(m[1]);
          if (!parsed) continue;
          // Check include-me preference:
          // - includeMeOn=false (default): exclude entries where WHO matches current user → they wrote it
          // - includeMeOn=true: include ALL entries (user wants to see their own updates too)
          const includeMeOn = _isIncludeMeOn();
          if (!includeMeOn && myQb) {
            if (parsed.who.toLowerCase().includes(myQb) || myQb.includes(parsed.who.toLowerCase())) continue;
            // Partial word match (at least 4 chars)
            if (myQb.length >= 4 && parsed.who.toLowerCase().split(' ').some(part => part.length >= 4 && myQb.includes(part))) continue;
          }
          matches.push(parsed);
        }
        if (!matches.length) return;

        // Get the most recent today-bracket
        const newest = matches.reduce((a,b) => (!a || (b.dateObj > a.dateObj)) ? b : a, null);
        if (!newest) return;

        const caseId = String(row.qbRecordId || (caseNumCol && row.fields && row.fields[String(caseNumCol.id)] ? row.fields[String(caseNumCol.id)].value : '') || 'N/A');
        const shortDesc = descCol && row.fields && row.fields[String(descCol.id)] ? String(row.fields[String(descCol.id)].value || '') : '';

        // Build the first line of the note (after the last bracket entry)
        // Extract text after [DATE TIME NAME]
        const afterBracket = cnVal.slice(cnVal.lastIndexOf(']') + 1).trim().replace(/^-+\s*/, '').trim();
        const noteLine = afterBracket.slice(0, 120) || cnVal.slice(0, 120);

        items.push({
          caseId,
          shortDesc,
          who: newest.who,
          timeStr: newest.timeStr,
          dateToken: today,
          dateObj: newest.dateObj,
          noteLine,
          colIdx: _colIdx(newest.who), // keyed on name: same person = same color
        });
      });

      // Sort by most recent first
      items.sort((a, b) => b.dateObj - a.dateObj);
      return items;
    }

    // ── Render items into panel ────────────────────────────────────────────
    let _allItems = [];
    let _readSet = new Set();

    function _render(filter) {
      const list = document.getElementById('mnpList');
      const empty = document.getElementById('mnpEmpty');
      const meta = document.getElementById('mnpMeta');
      const badge = document.getElementById('mumsNotifBadge');
      const bellBtn = document.getElementById('mumsNotifBtn');
      const tabCt = document.getElementById('mnpTabCt');
      if (!list) return;

      const toShow = filter === 'unread'
        ? _allItems.filter(it => !_readSet.has(it.caseId))
        : _allItems;

      const unreadCount = _allItems.filter(it => !_readSet.has(it.caseId)).length;

      // Update badge
      if (badge) {
        badge.textContent = unreadCount > 9 ? '9+' : String(unreadCount);
        badge.style.display = unreadCount > 0 ? '' : 'none';
      }
      if (bellBtn) {
        bellBtn.classList.toggle('has-unread', unreadCount > 0);
      }
      if (meta) meta.textContent = unreadCount > 0 ? unreadCount + ' UNREAD' : 'ALL READ';
      if (tabCt) {
        tabCt.textContent = String(unreadCount);
        tabCt.style.display = unreadCount > 0 ? '' : 'none';
      }

      if (!toShow.length) {
        if (empty) empty.style.display = '';
        // Remove all item nodes
        Array.from(list.querySelectorAll('.mnp-item, .mnp-divider')).forEach(el => el.remove());
        return;
      }
      if (empty) empty.style.display = 'none';

      // ── Avatar initials from reporter name ───────────────────────────────
      // Generates 1-2 letter initials from a "First Last" name string.
      // Falls back to first 2 chars if name has only one word.
      function _initials(name) {
        const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return '?';
        if (parts.length === 1) return parts[0].slice(0,2).toUpperCase();
        return (parts[0][0] + parts[parts.length-1][0]).toUpperCase();
      }

      // Build HTML
      let html = '';
      toShow.forEach((item, idx) => {
        const isUnread = !_readSet.has(item.caseId);
        // Color is keyed on reporter name — same person = same color always
        const c = 'mnp-c' + item.colIdx;
        const avatarInitials = _initials(item.who);
        html += `
<div class="mnp-item${isUnread ? ' mnp-unread' : ''}" data-case="${_esc(item.caseId)}" onclick="window.__mumsNotifOpenCase('${_esc(item.caseId)}')">
  <div class="mnp-icon ${c}" title="${_esc(item.who)}" style="font-family:inherit;font-size:12px;font-weight:700;letter-spacing:-.01em;">${_esc(avatarInitials)}</div>
  <div class="mnp-body">
    <div class="mnp-row">
      <span class="mnp-casenum">CASE #${_esc(item.caseId)}</span>
      <span class="mnp-ts">${_esc(_relTime(item.dateObj))}</span>
      ${isUnread ? '<div class="mnp-unread-dot"></div>' : ''}
    </div>
    <div class="mnp-desc">${_esc(item.shortDesc || '(No description)')}</div>
    <div class="mnp-note">
      <span class="mnp-note-time">[${_esc(item.dateToken)} ${_esc(item.timeStr)}]</span>
      <span class="mnp-note-who"> ${_esc(item.who)}</span>
      ${item.noteLine ? '— ' + _esc(item.noteLine.slice(0,80)) : ''}
    </div>
  </div>
</div>
${idx < toShow.length - 1 ? '<div class="mnp-divider"></div>' : ''}`;
      });
      list.innerHTML = html + (empty ? empty.outerHTML : '');
      if (empty) {
        const newEmpty = list.querySelector('.mnp-empty');
        if (newEmpty) newEmpty.style.display = 'none';
      }
    }

    // ── Public interface ──────────────────────────────────────────────────
    let _activeTab = 'all';

    window.__mumsNotifTabAll = function() {
      _activeTab = 'all';
      document.getElementById('mnpTabAll').classList.add('mnp-tab-on');
      document.getElementById('mnpTabUnread').classList.remove('mnp-tab-on');
      _render('all');
    };
    window.__mumsNotifTabUnread = function() {
      _activeTab = 'unread';
      document.getElementById('mnpTabUnread').classList.add('mnp-tab-on');
      document.getElementById('mnpTabAll').classList.remove('mnp-tab-on');
      _render('unread');
    };
    window.__mumsNotifMarkAll = function() {
      _allItems.forEach(it => _readSet.add(it.caseId));
      _render(_activeTab);
    };
    window.__mumsNotifRead = function(caseId) {
      _readSet.add(caseId);
      _render(_activeTab);
    };
    window.__mumsNotifOpenCase = function(caseId) {
      _readSet.add(caseId);
      _render(_activeTab);
      _closePanel();
      // Open Case Detail View for this case#
      _openCaseDetail(caseId);
    };
    window.__mumsNotifRefresh = function(records, columns) {
      _allItems = _buildNotifications(records, columns);
      _render(_activeTab);
    };

    // ── Bell toggle ───────────────────────────────────────────────────────
    let _panelOpen = false;
    function _openPanel() {
      const panel = document.getElementById('mumsNotifPanel');
      if (!panel) return;
      _panelOpen = true;
      panel.style.display = '';
      panel.style.animation = 'mnpPanelIn .25s cubic-bezier(.34,1.2,.64,1) both';
      document.getElementById('mumsNotifBtn').setAttribute('aria-expanded','true');
      // Sync include-me checkbox state
      _syncIncludeMeCheckbox();
      _render(_activeTab);
      setTimeout(() => document.addEventListener('click', _closeOnOutside), 10);
    }
    function _closePanel() {
      const panel = document.getElementById('mumsNotifPanel');
      if (!panel) return;
      _panelOpen = false;
      panel.style.display = 'none';
      document.getElementById('mumsNotifBtn').setAttribute('aria-expanded','false');
      document.removeEventListener('click', _closeOnOutside);
    }
    function _closeOnOutside(e) {
      const wrap = document.getElementById('mumsNotifWrap');
      if (wrap && !wrap.contains(e.target)) _closePanel();
    }

    function _bindBell() {
      const btn = document.getElementById('mumsNotifBtn');
      if (!btn || btn.__mumsNotifBound) return;
      btn.__mumsNotifBound = true;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        _panelOpen ? _closePanel() : _openPanel();
      });
    }

    // ── Open Case Detail by case ID ──────────────────────────────────────
    function _openCaseDetail(caseId) {
      var _tryOpen = function() {
        try {
          var mainEl = document.getElementById('main');
          if (!mainEl) return false;
          // root._qbcdOpen is set on the main element by _initQbCaseDetailModal
          if (typeof mainEl._qbcdOpen !== 'function') return false;
          // Find the snap matching this case ID from host._qbRowSnaps
          var host = mainEl.querySelector('#qbDataBody');
          if (!host) return false;
          var snaps = host._qbRowSnaps || [];
          if (!snaps.length) return false;
          var snap = snaps.find(function(s) { return s && String(s.recordId) === String(caseId); });
          if (!snap) return false;
          mainEl._qbcdOpen(snap, snaps);
          return true;
        } catch(_) { return false; }
      };

      // Try immediately (already on QB page with records loaded)
      if (_tryOpen()) return;

      // Navigate to my_quickbase first, then open after records load
      var _pendingCase = String(caseId);
      var _onRecords = function() {
        // Wait one tick for _qbcdOpen to be bound after render
        setTimeout(function() {
          if (!_tryOpen()) {
            // Retry up to 3x with 300ms delay
            var retries = 0;
            var retry = setInterval(function() {
              if (_tryOpen() || ++retries >= 6) clearInterval(retry);
            }, 300);
          }
          window.removeEventListener('mums:qb_records_loaded', _onRecords);
        }, 200);
      };
      window.addEventListener('mums:qb_records_loaded', _onRecords);

      // Navigate to my_quickbase
      try {
        if (window.App && typeof App.navigate === 'function') {
          App.navigate('my_quickbase');
        } else {
          var navBtn = document.querySelector('[data-page="my_quickbase"], a[href*="my_quickbase"]');
          if (navBtn) navBtn.click();
        }
      } catch(_) {}
    }

    // ── Listen for QB records loaded event ────────────────────────────────
    window.addEventListener('mums:qb_records_loaded', function(e) {
      const { records, columns } = e.detail || {};
      if (Array.isArray(records) && Array.isArray(columns)) {
        window.__mumsNotifRefresh(records, columns);
      }
    });

    // ── Auto-refresh every 60 seconds (picks up live sync updates) ────────
    setInterval(function() {
      const qb = window.__mumsQbRecords;
      if (qb && Array.isArray(qb.records)) {
        window.__mumsNotifRefresh(qb.records, qb.columns);
      }
    }, 60000);

    // Bind on DOMContentLoaded (or immediately if already loaded)
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _bindBell);
    } else {
      _bindBell();
      // Retry after app boot (bell may not exist yet at this point)
      setTimeout(_bindBell, 800);
    }
    // Also bind release notes button at same time
    setTimeout(function() {
      if (window.__mumsBindReleaseNotes) window.__mumsBindReleaseNotes();
    }, 900);

    // ── AUTO-FETCH QB records for notifications on login ───────────────────
    // Fetches latest QB records in the background so notification bell works
    // WITHOUT requiring the user to open My Quickbase first.
    // Runs once on boot after auth is ready, then every 5 minutes.
    function _autoFetchQBForNotif() {
      try {
        const tok = (window.CloudAuth && typeof CloudAuth.accessToken === 'function')
          ? CloudAuth.accessToken() : '';
        if (!tok) return; // not authenticated yet

        fetch('/api/quickbase/monitoring', {
          headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' }
        })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(d) {
          if (!d || !d.ok) return;
          const records = Array.isArray(d.records) ? d.records : [];
          const columns = Array.isArray(d.columns) ? d.columns : [];
          if (records.length && columns.length) {
            // Store globally so My Quickbase page can use the cache too
            window.__mumsQbRecords = {
              records: records,
              columns: columns,
              loadedAt: Date.now(),
            };
            // Update notification bell
            if (typeof window.__mumsNotifRefresh === 'function') {
              window.__mumsNotifRefresh(records, columns);
            }
          }
        })
        .catch(function() {}); // silent fail — bell will update when QB page opens
      } catch(_) {}
    }

    // Run after auth hydration (wait for token to be available)
    setTimeout(function() { _autoFetchQBForNotif(); }, 3000);
    // Refresh every 5 minutes
    setInterval(_autoFetchQBForNotif, 5 * 60 * 1000);

  })();
  // ══════════════════════════════════════════════════════════════════════════
  // END NOTIFICATION SYSTEM
  // ══════════════════════════════════════════════════════════════════════════

  // ══════════════════════════════════════════════════════════════════════════
  // RELEASE NOTES SYSTEM — v3.9.47
  // Viewer: all users. Admin panel: Super Admin only (publish HTML files).
  // Storage: mums_documents key='mums_release_notes' in Supabase.
  // ══════════════════════════════════════════════════════════════════════════
  (function _initReleaseNotes() {
    console.info('[ReleaseNotes] System initializing v3.9.47');

    function _tok() {
      try { return (window.CloudAuth && CloudAuth.accessToken) ? CloudAuth.accessToken() : ''; } catch(_) { return ''; }
    }
    function _headers() {
      const t = _tok();
      const h = { 'Content-Type': 'application/json' };
      if (t) h['Authorization'] = 'Bearer ' + t;
      return h;
    }
    function _esc(s) {
      return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
    function _fmtDate(iso) {
      try {
        return new Date(iso).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
      } catch(_) { return iso || '—'; }
    }
    function _tagClass(t) {
      const map = { feature:'rn-tag-feature', fix:'rn-tag-fix', security:'rn-tag-security', breaking:'rn-tag-breaking', ui:'rn-tag-ui' };
      return map[String(t).toLowerCase()] || 'rn-tag-feature';
    }

    // ── Load notes list ────────────────────────────────────────────────
    async function _loadNotes() {
      try {
        const r = await fetch('/api/settings/release_notes', { headers: _headers() });
        const d = await r.json().catch(() => ({}));
        return d.ok ? (d.notes || []) : [];
      } catch(_) { return []; }
    }

    // ── Load single note full content ──────────────────────────────────
    async function _loadNoteContent(noteId) {
      try {
        const r = await fetch('/api/settings/release_notes?noteId=' + encodeURIComponent(noteId), { headers: _headers() });
        const d = await r.json().catch(() => ({}));
        return d.ok ? d.note : null;
      } catch(_) { return null; }
    }

    // ── Render sidebar ─────────────────────────────────────────────────
    function _renderSidebar(notes, activeId) {
      const sb = document.getElementById('rnSidebar');
      if (!sb) return;
      if (!notes.length) {
        sb.innerHTML = '<div class="rn-sidebar-loading">No release notes yet.</div>';
        return;
      }
      sb.innerHTML = notes.map((n, i) => {
        const tags = (n.tags || []).map(t => `<span class="rn-tag ${_tagClass(t)}">${_esc(t)}</span>`).join('');
        const isNew = n.isNew ? '<span class="rn-new-badge">NEW</span>' : '';
        return `
<div class="rn-note-item${n.id === activeId ? ' active' : ''}" onclick="window.__rnSelectNote('${_esc(n.id)}')">
  <div class="rn-note-version">v${_esc(n.version)} ${isNew}</div>
  <div class="rn-note-title">${_esc(n.title)}</div>
  <div class="rn-note-date">${_fmtDate(n.publishedAt)}</div>
  ${tags ? '<div class="rn-note-tags">' + tags + '</div>' : ''}
</div>
${i < notes.length - 1 ? '<div class="rn-sidebar-divider"></div>' : ''}`;
      }).join('');
    }

    // ── Show note in iframe ────────────────────────────────────────────
    var _cachedNoteContent = {};
    async function _showNote(noteId) {
      const iframe = document.getElementById('rnIframe');
      const empty  = document.getElementById('rnContentEmpty');
      if (!iframe || !empty) return;

      iframe.style.display = 'none';
      empty.style.display = 'flex';

      // Load content (cache it)
      let note = _cachedNoteContent[noteId];
      if (!note) {
        note = await _loadNoteContent(noteId);
        if (note) _cachedNoteContent[noteId] = note;
      }
      if (!note || !note.htmlContent) return;

      // Inject HTML into sandboxed iframe
      empty.style.display = 'none';
      iframe.style.display = 'block';
      const blob = new Blob([note.htmlContent], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      iframe.onload = () => { try { URL.revokeObjectURL(url); } catch(_) {} };
      iframe.src = url;
    }

    // ── Main open handler ──────────────────────────────────────────────
    var _notesList = [];
    var _activeNoteId = null;

    window.__rnSelectNote = function(noteId) {
      _activeNoteId = noteId;
      _renderSidebar(_notesList, noteId);
      _showNote(noteId);
    };

    function _openViewer() {
      var m = document.getElementById('releaseNotesModal');
      if (!m) { console.error('[ReleaseNotes] Modal element not found'); return; }

      // Re-append to body to escape .app overflow:hidden stacking context
      if (m.parentElement !== document.body) {
        document.body.appendChild(m);
      }

      m.style.cssText = 'display:flex!important;position:fixed!important;inset:0!important;' +
        'z-index:2147483100!important;align-items:center!important;justify-content:center!important;' +
        'background:rgba(6,12,24,.88)!important;padding:16px!important;box-sizing:border-box!important;';
      m.classList.add('open');
      try { document.body.classList.add('modal-open'); } catch(_) {}
      console.info('[ReleaseNotes] Modal opened');

      // Show Publish button for Super Admin
      try {
        var user = (window.Auth && Auth.getUser) ? Auth.getUser() : null;
        var role = String((user && user.role) || '').toUpperCase();
        var isSA = role === 'SUPER_ADMIN';
        var publishBtn = document.getElementById('rnPublishToggleBtn');
        if (publishBtn) publishBtn.style.display = isSA ? 'inline-flex' : 'none';
      } catch(_) {}

      // Load notes
      var sb = document.getElementById('rnSidebar');
      if (sb) sb.innerHTML = '<div class="rn-sidebar-loading">Loading\u2026</div>';
      _loadNotes().then(function(notes) {
        _notesList = notes;
        _renderSidebar(_notesList, _activeNoteId);
        if (_notesList.length && !_activeNoteId) {
          _activeNoteId = _notesList[0].id;
          _renderSidebar(_notesList, _activeNoteId);
          _showNote(_activeNoteId);
        }
      });
      var dot = document.getElementById('rnNewDot');
      if (dot) dot.style.display = 'none';
    }

    function _closeViewer() {
      var m = document.getElementById('releaseNotesModal');
      if (!m) return;
      m.removeAttribute('style');
      m.classList.remove('open');
      try { if (!document.querySelector('.modal.open')) document.body.classList.remove('modal-open'); } catch(_) {}
      // Reset publish panel
      var pp = document.getElementById('rnPublishPanel');
      if (pp) pp.style.display = 'none';
    }

    // ── Publish panel toggle (SA only) ────────────────────────────────
    var _publishPanelOpen = false;
    window.__rnTogglePublishPanel = function() {
      var pp = document.getElementById('rnPublishPanel');
      if (!pp) return;
      _publishPanelOpen = !_publishPanelOpen;
      pp.style.display = _publishPanelOpen ? '' : 'none';
      var btn = document.getElementById('rnPublishToggleBtn');
      if (btn) {
        btn.style.background = _publishPanelOpen ? 'rgba(34,211,238,.22)' : 'rgba(34,211,238,.12)';
        btn.innerHTML = _publishPanelOpen
          ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg> Close'
          : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Publish Note';
      }
    };

    // ── File loaded handler ───────────────────────────────────────────
    var _rnHtmlContent = '';
    var _rnSelectedTags = [];
    window.__rnFileLoaded = function(input) {
      var file = input && input.files && input.files[0];
      if (!file) return;
      var lbl = document.getElementById('rnFileChosen');
      if (lbl) lbl.textContent = file.name;
      var reader = new FileReader();
      reader.onload = function(e) {
        _rnHtmlContent = e.target.result;
        var pw = document.getElementById('rnPreviewWrap');
        var pf = document.getElementById('rnPreviewIframe');
        if (pw && pf) {
          pw.style.display = '';
          var blob = new Blob([_rnHtmlContent], { type: 'text/html' });
          var url = URL.createObjectURL(blob);
          pf.onload = function() { try { URL.revokeObjectURL(url); } catch(_) {} };
          pf.src = url;
        }
      };
      reader.readAsText(file);
    };
    window.__rnToggleTag = function(tag, btn) {
      var idx = _rnSelectedTags.indexOf(tag);
      if (idx >= 0) { _rnSelectedTags.splice(idx, 1); btn.classList.remove('selected'); }
      else { _rnSelectedTags.push(tag); btn.classList.add('selected'); }
    };
    window.__rnPublish = async function() {
      var version = (document.getElementById('rnVersion') || {}).value || '';
      var title   = (document.getElementById('rnTitle')   || {}).value || '';
      if (!version.trim() || !title.trim() || !_rnHtmlContent) {
        if (window.UI && UI.toast) UI.toast('Fill in version, title and choose an HTML file.', 'error');
        else alert('Fill in version, title and choose an HTML file.');
        return;
      }
      var btn = document.getElementById('rnPublishBtn');
      if (btn) { btn.disabled = true; btn.textContent = 'Publishing\u2026'; }
      try {
        var r = await fetch('/api/settings/release_notes', {
          method: 'POST', headers: _headers(),
          body: JSON.stringify({ version: version.trim(), title: title.trim(), tags: _rnSelectedTags, htmlContent: _rnHtmlContent })
        });
        var d = await r.json().catch(function() { return {}; });
        if (d.ok) {
          _rnHtmlContent = ''; _rnSelectedTags = [];
          if (document.getElementById('rnVersion')) document.getElementById('rnVersion').value = '';
          if (document.getElementById('rnTitle'))   document.getElementById('rnTitle').value = '';
          if (document.getElementById('rnFileChosen')) document.getElementById('rnFileChosen').textContent = '';
          if (document.getElementById('rnPreviewWrap')) document.getElementById('rnPreviewWrap').style.display = 'none';
          if (document.getElementById('rnFileInput')) document.getElementById('rnFileInput').value = '';
          if (window.UI && UI.toast) UI.toast('Release note published! \uD83D\uDE80', 'success');
          // Close publish panel and reload sidebar
          window.__rnTogglePublishPanel();
          _activeNoteId = null;
          _loadNotes().then(function(notes) {
            _notesList = notes;
            _renderSidebar(_notesList, null);
          });
        } else {
          if (window.UI && UI.toast) UI.toast('Error: ' + (d.message || 'unknown'), 'error');
        }
      } catch(e) {
        if (window.UI && UI.toast) UI.toast('Network error.', 'error');
      }
      if (btn) { btn.disabled = false; btn.textContent = 'Publish \u2192'; }
    };

    // ── Check for new notes on load ────────────────────────────────────
    async function _checkNew() {
      const notes = await _loadNotes();
      const hasNew = notes.some(n => n.isNew);
      const dot = document.getElementById('rnNewDot');
      if (dot) dot.style.display = hasNew ? '' : 'none';
    }

    // ── Bind bell button ───────────────────────────────────────────────
    function _bindBtn() {
      var btn = document.getElementById('releaseNotesBtn');
      if (!btn || btn.__rnBound) return;
      btn.__rnBound = true;
      btn.addEventListener('click', _openViewer);
      // Wire all close buttons — use direct DOM close
      document.querySelectorAll('[data-close="releaseNotesModal"]').forEach(function(b) {
        b.onclick = _closeViewer;
      });
      setTimeout(_checkNew, 2000);
    }

    // Expose globally so boot() can call it after hydration
    window.__mumsBindReleaseNotes = _bindBtn;
    // Expose open/close globally — onclick attribute on button uses these directly
    window.__mumsOpenReleaseNotes  = _openViewer;
    window.__mumsCloseReleaseNotes = _closeViewer;
    console.info('[ReleaseNotes] window.__mumsOpenReleaseNotes ready ✓');

    // Try to bind now (if DOM already ready) and after delays
    _bindBtn();
    setTimeout(_bindBtn, 500);
    setTimeout(_bindBtn, 1500);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _bindBtn);
    }

    // ── ADMIN PANEL RENDERER ───────────────────────────────────────────
    window.__mumsRenderReleaseNotes = async function() {
      const body = document.getElementById('rnAdminPanelBody');
      if (!body) return;

      body.innerHTML = '<div style="text-align:center;padding:32px;color:var(--muted);font-size:12px">Loading…</div>';

      const notes = await _loadNotes();

      var _selectedTags = [];
      var _htmlContent = '';
      var _fileName = '';

      function _refreshAdmin() {
        body.innerHTML = `
<div class="rn-admin-wrap">
  <!-- Compose new note -->
  <div class="rn-compose-card">
    <div class="rn-compose-head">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      Publish New Release Note
    </div>
    <div class="rn-compose-body">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="rn-field">
          <div class="rn-label">Version</div>
          <input class="rn-input" id="rnVersion" placeholder="e.g. 3.9.47" />
        </div>
        <div class="rn-field">
          <div class="rn-label">Title</div>
          <input class="rn-input" id="rnTitle" placeholder="e.g. Case Notes Sort + Notification Bell" />
        </div>
      </div>
      <div class="rn-field">
        <div class="rn-label">Summary (shown in list)</div>
        <textarea class="rn-textarea" id="rnSummary" placeholder="Brief description of what's new in this build…" rows="2"></textarea>
      </div>
      <div class="rn-field">
        <div class="rn-label">Tags</div>
        <div class="rn-tags-row">
          ${['Feature','Fix','Security','UI','Breaking'].map(t =>
            `<button type="button" class="rn-tag-toggle" onclick="window.__rnToggleTag('${t}',this)">${t}</button>`
          ).join('')}
        </div>
      </div>
      <div class="rn-field">
        <div class="rn-label">HTML Content File (.html)</div>
        <div class="rn-upload-zone" id="rnDropZone">
          <input type="file" id="rnFileInput" accept=".html,text/html" onchange="window.__rnFileLoaded(this)" />
          <div class="rn-upload-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(34,211,238,.5)" stroke-width="1.5" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          </div>
          <div class="rn-upload-text">Drop your HTML mockup here or click to browse</div>
          <div class="rn-upload-hint">Accepts .html files — rich formatting, images, custom CSS supported</div>
        </div>
        <div id="rnFileStatus" style="display:none" class="rn-file-loaded">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
          <span class="rn-file-name" id="rnFileName"></span>
          <button class="rn-file-clear" onclick="window.__rnClearFile()" title="Remove file">✕</button>
        </div>
      </div>
      <div id="rnPreviewWrap" class="rn-preview-wrap" style="display:none">
        <div class="rn-preview-head">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          Preview
        </div>
        <iframe id="rnPreviewIframe" class="rn-preview-iframe" sandbox="allow-same-origin allow-scripts" title="Preview"></iframe>
      </div>
      <div style="display:flex;justify-content:flex-end;padding-top:4px">
        <button class="rn-publish-btn" id="rnPublishBtn" onclick="window.__rnPublish()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M22 2L11 13"/><path d="M22 2L15 22l-4-9-9-4 20-7z"/></svg>
          Publish Release Note
        </button>
      </div>
    </div>
  </div>

  <!-- Published list -->
  <div class="rn-compose-card">
    <div class="rn-compose-head">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      Published Notes (${notes.length})
    </div>
    <div class="rn-compose-body">
      ${notes.length ? '<div class="rn-published-list">' + notes.map(n => `
<div class="rn-published-item">
  <div class="rn-pi-ver">v${_esc(n.version)}</div>
  <div class="rn-pi-title">${_esc(n.title)}</div>
  <div class="rn-pi-date">${_fmtDate(n.publishedAt)}</div>
  <button class="rn-pi-del" onclick="window.__rnDelete('${_esc(n.id)}','${_esc(n.title)}')" title="Delete">🗑</button>
</div>`).join('') + '</div>'
  : '<div style="font-size:12px;color:var(--muted);text-align:center;padding:16px">No release notes published yet.</div>'}
    </div>
  </div>
</div>`;

        // Restore state
        _selectedTags.forEach(t => {
          body.querySelectorAll('.rn-tag-toggle').forEach(btn => {
            if (btn.textContent === t) btn.classList.add('selected');
          });
        });
        if (_fileName) {
          document.getElementById('rnDropZone').style.display = 'none';
          const fs = document.getElementById('rnFileStatus');
          if (fs) fs.style.display = '';
          const fn = document.getElementById('rnFileName');
          if (fn) fn.textContent = _fileName;
          const pw = document.getElementById('rnPreviewWrap');
          if (pw && _htmlContent) {
            pw.style.display = '';
            const iframe = document.getElementById('rnPreviewIframe');
            if (iframe) {
              const blob = new Blob([_htmlContent], { type:'text/html' });
              iframe.src = URL.createObjectURL(blob);
            }
          }
        }
      }

      // Global helpers for admin panel interactions
      window.__rnToggleTag = function(tag, btn) {
        const idx = _selectedTags.indexOf(tag);
        if (idx >= 0) { _selectedTags.splice(idx, 1); btn.classList.remove('selected'); }
        else { _selectedTags.push(tag); btn.classList.add('selected'); }
      };

      window.__rnFileLoaded = function(input) {
        const file = input.files[0];
        if (!file) return;
        _fileName = file.name;
        const reader = new FileReader();
        reader.onload = function(e) {
          _htmlContent = e.target.result;
          // Show file status
          document.getElementById('rnDropZone').style.display = 'none';
          const fs = document.getElementById('rnFileStatus');
          if (fs) { fs.style.display = ''; document.getElementById('rnFileName').textContent = _fileName; }
          // Show preview
          const pw = document.getElementById('rnPreviewWrap');
          if (pw) {
            pw.style.display = '';
            const iframe = document.getElementById('rnPreviewIframe');
            if (iframe) {
              const blob = new Blob([_htmlContent], { type:'text/html' });
              const url = URL.createObjectURL(blob);
              iframe.onload = () => { try { URL.revokeObjectURL(url); } catch(_) {} };
              iframe.src = url;
            }
          }
        };
        reader.readAsText(file);
      };

      window.__rnClearFile = function() {
        _htmlContent = ''; _fileName = '';
        document.getElementById('rnDropZone').style.display = '';
        const fs = document.getElementById('rnFileStatus'); if (fs) fs.style.display = 'none';
        const pw = document.getElementById('rnPreviewWrap'); if (pw) pw.style.display = 'none';
        const fi = document.getElementById('rnFileInput'); if (fi) fi.value = '';
      };

      window.__rnPublish = async function() {
        const version = (document.getElementById('rnVersion') || {}).value || '';
        const title   = (document.getElementById('rnTitle')   || {}).value || '';
        const summary = (document.getElementById('rnSummary') || {}).value || '';
        if (!version.trim() || !title.trim() || !_htmlContent) {
          alert('Please fill in version, title and attach an HTML file.');
          return;
        }
        const btn = document.getElementById('rnPublishBtn');
        if (btn) { btn.disabled = true; btn.textContent = 'Publishing…'; }
        try {
          const r = await fetch('/api/settings/release_notes', {
            method: 'POST', headers: _headers(),
            body: JSON.stringify({ version: version.trim(), title: title.trim(), summary: summary.trim(), tags: _selectedTags, htmlContent: _htmlContent })
          });
          const d = await r.json().catch(() => ({}));
          if (d.ok) {
            _htmlContent = ''; _fileName = ''; _selectedTags = [];
            if (window.UI && UI.toast) UI.toast('Release note published successfully! 🚀', 'success');
            window.__mumsRenderReleaseNotes();
          } else {
            if (window.UI && UI.toast) UI.toast('Failed: ' + (d.message || 'unknown error'), 'error');
          }
        } catch(e) {
          if (window.UI && UI.toast) UI.toast('Network error publishing.', 'error');
        }
        if (btn) { btn.disabled = false; }
      };

      window.__rnDelete = async function(id, title) {
        if (!confirm('Delete release note "' + title + '"?')) return;
        try {
          const r = await fetch('/api/settings/release_notes', {
            method: 'POST', headers: _headers(),
            body: JSON.stringify({ action:'delete', id })
          });
          const d = await r.json().catch(() => ({}));
          if (d.ok) {
            if (window.UI && UI.toast) UI.toast('Release note deleted.', 'success');
            window.__mumsRenderReleaseNotes();
          }
        } catch(e) {}
      };

      _refreshAdmin();
    };

  })();
  // ══════════════════════════════════════════════════════════════════════════
  // END RELEASE NOTES SYSTEM
  // ══════════════════════════════════════════════════════════════════════════

  function bindGlobalSearch(user){
    const topInput = document.getElementById('globalSearchInput');
    const topBtn = document.getElementById('globalSearchBtn');
    const modalInput = document.getElementById('globalSearchModalInput');
    const resultsEl = document.getElementById('globalSearchResults');
    const modalId = 'globalSearchModal';
    const roleLabel = String((user && (user.roleLabel || user.role)) || '').trim();
    const menuNodes = Array.from(document.querySelectorAll('#leftNav a.nav-item, #leftNav button.nav-item'));

    function listItems(query){
      const q = String(query || '').trim().toLowerCase();
      return menuNodes
        .map((node)=>{
          const label = String((node.textContent || '').replace(/\s+/g, ' ').trim());
          if(!label) return null;
          const href = node.getAttribute('href') || '';
          return { node, label, href, haystack: `${label} ${href}`.toLowerCase() };
        })
        .filter(Boolean)
        .filter((item)=> !q || item.haystack.includes(q))
        .slice(0, 12);
    }

    function render(query){
      if(!resultsEl) return;
      const items = listItems(query);
      if(!items.length){
        resultsEl.innerHTML = '<div class="muted" style="padding:10px">No matches found.</div>';
        return;
      }

      resultsEl.innerHTML = items.map((item)=>{
        const hint = item.href ? ` <span class="muted">${item.href}</span>` : '';
        return `<button class="gresult" type="button" data-label="${encodeURIComponent(item.label)}">${item.label}${hint}</button>`;
      }).join('');

      Array.from(resultsEl.querySelectorAll('[data-label]')).forEach((btn)=>{
        btn.onclick = ()=>{
          const label = decodeURIComponent(String(btn.getAttribute('data-label') || ''));
          const target = items.find((it)=>it.label === label);
          if(!target) return;
          try{ target.node.click(); }catch(_){ if(target.href) location.hash = target.href; }
          UI.closeModal(modalId);
        };
      });
    }

    function open(query){
      UI.openModal(modalId);
      if(modalInput){
        modalInput.value = query || '';
        render(modalInput.value);
        setTimeout(()=>{ try{ modalInput.focus(); modalInput.select(); }catch(_){} }, 0);
      }else{
        render(query || '');
      }
    }

    if(topBtn) topBtn.onclick = ()=> open(topInput ? topInput.value : '');
    if(topInput){
      topInput.onkeydown = (e)=>{ if(e.key === 'Enter'){ e.preventDefault(); open(topInput.value); } };
    }
    if(modalInput){
      modalInput.oninput = ()=> render(modalInput.value);
      modalInput.onkeydown = (e)=>{ if(e.key === 'Escape') UI.closeModal(modalId); };
    }

    document.addEventListener('keydown', (e)=>{
      if((e.ctrlKey || e.metaKey) && String(e.key || '').toLowerCase() === 'k'){
        e.preventDefault();
        open(topInput ? topInput.value : '');
      }
    });

    if(topInput && !topInput.placeholder){
      topInput.placeholder = roleLabel ? `Search (${roleLabel})` : 'Search…';
    }

    render('');
  }


  function setupClassicTopbarClock(){
    let timer = null;
    let fmt = null;

    function ensureFormatter(){
      if(fmt) return fmt;
      try{
        fmt = new Intl.DateTimeFormat('en-US', {
          weekday:'short', year:'numeric', month:'short', day:'2-digit',
          hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false,
          timeZone:'Asia/Manila'
        });
      }catch(_){
        fmt = null;
      }
      return fmt;
    }

    function tick(){
      const el = document.getElementById('classicManilaClock');
      if(!el) return;
      try{
        const f = ensureFormatter();
        el.textContent = f ? f.format(new Date()) : new Date().toISOString().replace('T',' ').slice(0,19);
      }catch(_){
        el.textContent = new Date().toISOString().replace('T',' ').slice(0,19);
      }
    }

    function apply(){
      const isClassic = (document.body && document.body.dataset && document.body.dataset.theme==='classic_style');
      const host = document.querySelector('.topbar-center');
      let el = document.getElementById('classicManilaClock');

      if(!isClassic){
        if(el) el.style.display = 'none';
        if(timer){ clearInterval(timer); timer=null; }
        return;
      }

      if(!host) return;
      if(!el){
        el = document.createElement('div');
        el.id = 'classicManilaClock';
        el.className = 'classic-clock';
        host.insertBefore(el, host.firstChild);
      }
      el.style.display = '';
      tick();
      if(!timer){ timer = setInterval(tick, 1000); }
    }

    window.addEventListener('mums:themeApplied', apply);
    apply();
  }

  // ── SIDEBAR STATE ─────────────────────────────────────────────────────────────
  // applySidebarState([collapsed]) — reads localStorage when called with no arg.
  function applySidebarState(collapsed) {
    try {
      const pref = (collapsed !== undefined)
        ? collapsed
        : (localStorage.getItem('mums_sidebar_default') === 'collapsed');
      document.body.classList.toggle('sidebar-collapsed', !!pref);
      // Keep hover-expand in sync (only meaningful while collapsed).
      const hoverOn = (localStorage.getItem('mums_sidebar_hover') ?? '1') === '1';
      document.body.classList.toggle('sidebar-hoverable', !!pref && hoverOn);
      // Persist the current state so future loads start correctly.
      localStorage.setItem('mums_sidebar_default', pref ? 'collapsed' : 'expanded');
    } catch (_) {}
  }

  // bindSidebarToggle() — wires the #sidebarToggle hamburger button.
  function bindSidebarToggle() {
    const btn = document.getElementById('sidebarToggle');
    if (!btn || btn.__sidebarBound) return;
    btn.__sidebarBound = true;
    let lastClick = 0;
    btn.addEventListener('click', () => {
      const now = Date.now();
      const isCollapsed = document.body.classList.contains('sidebar-collapsed');
      // Double-click within 400 ms → pin as rail (collapsed) permanently.
      if (now - lastClick < 400) {
        applySidebarState(true);
      } else {
        applySidebarState(!isCollapsed);
      }
      lastClick = now;
    });
  }

  // ── RIGHTBAR STATE ────────────────────────────────────────────────────────────
  function applyRightbarState(collapsed) {
    try {
      const pref = (collapsed !== undefined)
        ? collapsed
        : (localStorage.getItem('mums_rightbar_default') === 'collapsed');
      document.body.classList.toggle('rightbar-collapsed', !!pref);
      localStorage.setItem('mums_rightbar_default', pref ? 'collapsed' : 'expanded');
    } catch (_) {}
  }

  function bindRightbarToggle() {
    const btn = document.getElementById('toggleRightPanelBtn');
    if (!btn || btn.__rightbarBound) return;
    btn.__rightbarBound = true;
    btn.addEventListener('click', () => {
      const now = document.body.classList.contains('rightbar-collapsed');
      applyRightbarState(!now);
    });
  }

  // ── DENSITY ───────────────────────────────────────────────────────────────────
  function applyDensity() {
    try {
      const d = localStorage.getItem('mums_density') || 'normal';
      document.body.classList.toggle('density-compact', d === 'compact');
    } catch (_) {}
  }

  // ── BOTTOM BARS VISIBILITY ────────────────────────────────────────────────────
  // Persists per user via localStorage. Keys: mums_bar_online | mums_bar_quicklinks
  //
  // LAYOUT STRATEGY (correct approach):
  // ─ Toggling CSS classes (online-bar-hidden / quicklinks-bar-hidden) on <body>
  //   drives the CSS variables --mums-dock-h and --mums-onlinebar-h to 0px.
  // ─ The existing rule:
  //     .app { padding-bottom: calc(var(--mums-dock-h) + var(--mums-onlinebar-h) + 18px) }
  //   automatically recalculates — no padding-bottom override needed.
  // ─ Sidebars (.side/.right) are grid items in the 1fr row and auto-expand
  //   as the available grid height grows. No explicit height override required.
  // ─ The bars themselves use transform:translateY(100%) for smooth slide-out.

  // ══════════════════════════════════════════════════════════════════════════
  // ══════════════════════════════════════════════════════════════════════════
  //  BOTTOM BARS VISIBILITY SYSTEM — v5 FINAL FIX
  //
  //  BUG IN v4: Wrote measured heights back to --mums-dock-h/--mums-onlinebar-h.
  //  Those SAME vars drive bar sizing:
  //    .quicklinks-bar { height: var(--mums-dock-h) }
  //    .onlinebar-sec  { min-height: var(--mums-onlinebar-h) }
  //  Result: ResizeObserver measured bar → wrote to var → bar grew → RO fired
  //  again → infinite loop → grid row 3 ballooned → row 2 collapsed → blank screen.
  //
  //  PERMANENT FIX: New isolated variable --mums-bar-spacer.
  //  • --mums-dock-h / --mums-onlinebar-h: UNTOUCHED — still drive bar sizing.
  //  • --mums-bar-spacer: ONLY written by JS, ONLY used in grid-template-rows.
  //  • Zero circular dependency. Zero feedback loop.
  //
  //  .app grid-template-rows: auto  1fr  var(--mums-bar-spacer)
  //    Row 3 = exact sum of measured bar heights → row 2 (1fr) always bounded.
  //    Bars hidden → spacer = 0 → row 2 expands to fill full viewport height.
  // ══════════════════════════════════════════════════════════════════════════

  const BAR_KEYS = {
    online:     'mums_bar_online',
    quicklinks: 'mums_bar_quicklinks',
  };

  // Cached measured heights — set by ResizeObserver, read by _commitSpacer
  var _measuredBarH = { online: 0, quicklinks: 0 };
  var _barRO        = { online: null, quicklinks: null };
  var _barRAF       = null;

  // Write ONLY to --mums-bar-spacer on <html> inline style.
  // <html> inline style = highest CSS specificity, no :root override can beat it.
  // --mums-bar-spacer is NOT used inside bars → zero circular dependency.
  function _commitSpacer() {
    try {
      var onlineShow     = localStorage.getItem(BAR_KEYS.online)     !== '0';
      var quicklinksShow = localStorage.getItem(BAR_KEYS.quicklinks) !== '0';
      var qlH     = quicklinksShow ? _measuredBarH.quicklinks : 0;
      var onlineH = onlineShow     ? _measuredBarH.online     : 0;
      document.documentElement.style.setProperty('--mums-bar-spacer', (qlH + onlineH) + 'px');
      // Sync online bar's bottom so it floats directly above quicklinks bar
      try {
        var ob = document.getElementById('onlineUsersBar') || document.querySelector('.online-users-bar');
        if (ob) ob.style.bottom = qlH + 'px';
      } catch(_) {}
    } catch (_) {}
  }

  // Measure one bar's ACTUAL rendered height and cache it
  function _measureOne(key, el) {
    if (!el) return;
    try {
      _measuredBarH[key] = Math.ceil(el.getBoundingClientRect().height || 0);
      _commitSpacer();
    } catch (_) {}
  }

  // Attach ResizeObserver — fires whenever bar resizes (content/theme/window)
  function _watchBar(key, el) {
    if (!el) return;
    try {
      if (_barRO[key]) { try { _barRO[key].disconnect(); } catch(_){} }
      if (typeof ResizeObserver !== 'undefined') {
        _barRO[key] = new ResizeObserver(function() {
          if (_barRAF) cancelAnimationFrame(_barRAF);
          _barRAF = requestAnimationFrame(function() { _measureOne(key, el); });
        });
        _barRO[key].observe(el);
      }
      _measureOne(key, el); // immediate measurement on attach
    } catch (_) {}
  }

  function _initBarObservers() {
    try {
      var ql = document.getElementById('quickLinksBar')  || document.querySelector('.quicklinks-bar');
      var ob = document.getElementById('onlineUsersBar') || document.querySelector('.online-users-bar');
      _watchBar('quicklinks', ql);
      _watchBar('online',     ob);
    } catch (_) {}
  }

  function applyBarVisibility() {
    try {
      var onlineShow     = localStorage.getItem(BAR_KEYS.online)     !== '0';
      var quicklinksShow = localStorage.getItem(BAR_KEYS.quicklinks) !== '0';
      document.body.classList.toggle('online-bar-hidden',     !onlineShow);
      document.body.classList.toggle('quicklinks-bar-hidden', !quicklinksShow);
      _commitSpacer(); // immediate snap
      // Re-measure after slide animation settles (280ms) for exact pixel fit
      setTimeout(function() {
        try {
          var ql = document.getElementById('quickLinksBar')  || document.querySelector('.quicklinks-bar');
          var ob = document.getElementById('onlineUsersBar') || document.querySelector('.online-users-bar');
          if (quicklinksShow && ql) _measureOne('quicklinks', ql);
          if (onlineShow     && ob) _measureOne('online',     ob);
          _commitSpacer();
        } catch (_) {}
      }, 320);
    } catch (_) {}
  }

  function setBarVisibility(barKey, visible) {
    try {
      localStorage.setItem(BAR_KEYS[barKey], visible ? '1' : '0');
      applyBarVisibility();
      _syncBarVisibilityCheckboxes();
    } catch (_) {}
  }

  function _syncBarVisibilityCheckboxes() {
    try {
      var onlineChk     = document.getElementById('toggleOnlineBar');
      var quicklinksChk = document.getElementById('toggleQuickLinksBar');
      if (onlineChk)     onlineChk.checked     = localStorage.getItem(BAR_KEYS.online)     !== '0';
      if (quicklinksChk) quicklinksChk.checked = localStorage.getItem(BAR_KEYS.quicklinks) !== '0';
    } catch (_) {}
  }

  function bindBarVisibilityControls() {
    try {
      var onlineChk     = document.getElementById('toggleOnlineBar');
      var quicklinksChk = document.getElementById('toggleQuickLinksBar');
      if (onlineChk && !onlineChk.__barBound) {
        onlineChk.__barBound = true;
        onlineChk.checked = localStorage.getItem(BAR_KEYS.online) !== '0';
        onlineChk.addEventListener('change', function() { setBarVisibility('online', onlineChk.checked); });
      }
      if (quicklinksChk && !quicklinksChk.__barBound) {
        quicklinksChk.__barBound = true;
        quicklinksChk.checked = localStorage.getItem(BAR_KEYS.quicklinks) !== '0';
        quicklinksChk.addEventListener('change', function() { setBarVisibility('quicklinks', quicklinksChk.checked); });
      }
      _initBarObservers();
    } catch (_) {}
  }

  // ── MAIN SETTINGS NAV (Mockup C — Two-column layout) ─────────────────────────
  (function initMainSettingsSystem(){
    var _msInited = false;

    window.initMainSettings = function(user) {
      // Update user chip
      try {
        var chip = document.getElementById('stngsUserChip');
        if (chip && user) {
          var u = window.Auth && Auth.getUser ? Auth.getUser() : user;
          var name = (u && (u.username || u.name || u.email || '')).split('@')[0] || 'user';
          var role = (u && u.role) || '';
          chip.textContent = name + (role ? ' · ' + role : '');
        }
      } catch(_) {}

      // Show admin items
      try {
        var isSA = user && (user.role === 'SUPER_ADMIN' || user.role === 'SUPER_USER' || user.role === 'ADMIN');
        var adminEls = document.querySelectorAll('.ms-admin-section');
        adminEls.forEach(function(el) {
          el.style.display = isSA ? '' : 'none';
        });
        var adminLabel = document.getElementById('stngsAdminLabel');
        if (adminLabel) adminLabel.style.display = isSA ? '' : 'none';
        // Also show stngsAdminRow for legacy compat
        var adminRow = document.getElementById('stngsAdminRow');
        if (adminRow) adminRow.style.display = isSA ? '' : 'none';
      } catch(_) {}

      // Init nav if first open
      if (!_msInited) {
        _msInited = true;
        _bindMsNav();
        _bindMsSearch();
        // Sync toggles
        try{ bindBarVisibilityControls(); }catch(_){}
        try{ _syncMsBarToggles(); }catch(_){}
        try{ initBrightnessControl(); }catch(_){}

        // ── APPEARANCE DEFAULTS PANEL (Super Admin) ────────────────────
        (function initAppearanceDefaultsPanel(){
          const forceBtn = document.getElementById('forceApexBrightnessBtn');
          const clearBtn = document.getElementById('clearForceApexBtn');
          const statusEl = document.getElementById('appearanceForceStatus');
          const infoEl   = document.getElementById('appearanceForcedInfo');

          function refreshPanelState(){
            if(!infoEl || !clearBtn) return;
            const forced = __globalThemeSettings && __globalThemeSettings.forcedTheme && __globalThemeSettings.forcedBrightness;
            if(forced){
              const at   = __globalThemeSettings.forcedAt    ? new Date(__globalThemeSettings.forcedAt).toLocaleString()    : '';
              const who  = __globalThemeSettings.forcedByName || '';
              infoEl.innerHTML = '✅ <strong>ACTIVE</strong> — All users get APEX + 130% on next load.' +
                (who ? ' Forced by ' + UI.esc(who) + '.' : '') + (at ? ' Set: ' + UI.esc(at) : '');
              infoEl.style.cssText = 'display:block;font-size:10px;color:#C9A84C;margin-bottom:10px;padding:6px 10px;background:rgba(201,168,76,.08);border-radius:5px;border:1px solid rgba(201,168,76,.2);';
              clearBtn.style.display = '';
            } else {
              infoEl.style.display = 'none';
              clearBtn.style.display = 'none';
            }
          }

          if(forceBtn && !forceBtn.__apexBound){
            forceBtn.__apexBound = true;
            forceBtn.onclick = async () => {
              const token = getBearerToken();
              if(!token){ if(statusEl){ statusEl.textContent='Session expired.'; statusEl.style.cssText='display:block;background:rgba(248,81,73,.1);color:#f85149;border-radius:5px;'; } return; }
              forceBtn.disabled = true;
              forceBtn.innerHTML = '⏳ Applying…';
              if(statusEl) statusEl.style.display = 'none';
              try{
                const res = await fetch('/api/settings/global-theme',{
                  method:'POST',
                  headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},
                  body:JSON.stringify({action:'force_all',themeId:'apex',brightness:130})
                });
                const data = await res.json().catch(()=>({}));
                if(!res.ok||!data.ok) throw new Error(data.message||data.error||'HTTP '+res.status);
                __globalThemeSettings = Object.assign({},__globalThemeSettings,{
                  defaultTheme:'apex',brightness:130,
                  forcedTheme:true,forcedBrightness:true,
                  forcedAt:data.forcedAt||new Date().toISOString(),forcedByName:data.forcedByName||null
                });
                __globalThemeLoaded = true;
                if(statusEl){ statusEl.textContent='✓ Force applied. All users will get APEX + 130% on next page load.'; statusEl.style.cssText='display:block;background:rgba(63,185,80,.1);color:#3fb950;border-radius:5px;'; }
                refreshPanelState();
                try{ renderThemeGrid(); }catch(_){}
              }catch(err){
                if(statusEl){ statusEl.textContent='✗ '+String(err&&err.message||err); statusEl.style.cssText='display:block;background:rgba(248,81,73,.1);color:#f85149;border-radius:5px;'; }
              }finally{
                forceBtn.disabled=false;
                forceBtn.innerHTML='🛡️ Force APEX + 130% for All Users';
              }
            };
          }

          if(clearBtn && !clearBtn.__apexBound){
            clearBtn.__apexBound = true;
            clearBtn.onclick = async () => {
              const token = getBearerToken();
              if(!token) return;
              clearBtn.disabled = true;
              try{
                const res = await fetch('/api/settings/global-theme',{
                  method:'POST',
                  headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},
                  body:JSON.stringify({forcedTheme:false,forcedBrightness:false})
                });
                const data = await res.json().catch(()=>({}));
                if(!res.ok||!data.ok) throw new Error(data.message||data.error||'HTTP '+res.status);
                __globalThemeSettings = Object.assign({},__globalThemeSettings,{forcedTheme:false,forcedBrightness:false,forcedAt:null,forcedByName:null});
                if(statusEl){ statusEl.textContent='Force cleared — users may now customize freely.'; statusEl.style.cssText='display:block;background:rgba(139,148,158,.1);color:#8b949e;border-radius:5px;'; }
                refreshPanelState();
                try{ renderThemeGrid(); }catch(_){}
              }catch(err){
                if(statusEl){ statusEl.textContent='✗ '+String(err&&err.message||err); statusEl.style.cssText='display:block;background:rgba(248,81,73,.1);color:#f85149;border-radius:5px;'; }
              }finally{ clearBtn.disabled = false; }
            };
          }

          refreshPanelState();
        })();
      }

      // Always sync brightness badge + toggles
      try{ _syncMsBrightnessBadge(); }catch(_){}
      try{ _syncMsBarToggles(); }catch(_){}

      // Always open Profile panel on settings open + populate fields
      try {
        _msSelectPanel('profile');
        var _defaultUser = (window.Auth && Auth.getUser) ? Auth.getUser() : null;
        if (_defaultUser) setTimeout(function(){ try{ openProfileModal(_defaultUser); }catch(_){} }, 80);
      } catch(_) {}
    };

    function _msSelectPanel(panelId) {
      try {
        // Hide all panels
        document.querySelectorAll('.ms-panel').forEach(function(p) { p.style.display = 'none'; });
        // Show target
        var target = document.getElementById('msp_' + panelId);
        if (target) target.style.display = '';
        // Update nav active state
        document.querySelectorAll('.ms-nav-item').forEach(function(btn) {
          btn.classList.toggle('ms-active', btn.dataset.panel === panelId);
        });
      } catch(_) {}
    }

    function _bindMsNav() {
      document.querySelectorAll('.ms-nav-item[data-panel]').forEach(function(btn) {
        if (btn.__msNavBound) return;
        btn.__msNavBound = true;
        btn.addEventListener('click', function() {
          var panel = btn.dataset.panel;
          _msSelectPanel(panel);
          // Special: panels that open sub-modals
          // Inline panel init — trigger JS that panels need after showing
          var _panelUser = (window.Auth && Auth.getUser) ? Auth.getUser() : user;
          var panelInits = {
            profile: function(){
              try{ openProfileModal(_panelUser); }catch(_){}
            },
            theme: function(){
              // renderThemeGrid is a scoped inner function accessible here
              try{ renderThemeGrid(); }catch(_){}
            },
            links: function(){
              // renderLinksGrid is scoped inner function — now also on window.App
              try{ renderLinksGrid(); }catch(_){}
            },
            clocks: function(){
              // renderClocksGrid + update preview strip
              try{ renderClocksGrid(); }catch(_){}
              try{ const strip = document.getElementById('clocksPreviewStrip');
                if(strip && window.__mumsRenderClocksPreview) window.__mumsRenderClocksPreview();
              }catch(_){}
            },
            notifications: function(){
              // Sound settings are wired at boot; just sync the checkbox value
              try{
                const sndEn = document.getElementById('sndEnabled');
                if(sndEn) sndEn.checked = (localStorage.getItem('mums_sound_enabled') !== '0');
                const sndType = document.getElementById('sndType');
                if(sndType) sndType.value = (localStorage.getItem('mums_sound_type')||'beep');
                const sndVol = document.getElementById('sndVol');
                if(sndVol) sndVol.value = (localStorage.getItem('mums_sound_vol')||'65');
                if(UI.bindSoundSettingsModal) UI.bindSoundSettingsModal(_panelUser);
              }catch(_){}
            },
            cursor: function(){
              // Sync cursor dropdown to saved value
              try{
                const curSel = document.getElementById('cursorModeSelect');
                if(curSel) curSel.value = (localStorage.getItem('mums_cursor_mode')||'custom');
              }catch(_){}
            },
            sidebar: function(){
              // Sync sidebar selects to saved values
              try{
                const den = document.getElementById('densitySelect');
                if(den) den.value = (localStorage.getItem('mums_density')||'normal');
                const sb = document.getElementById('sidebarDefaultSelect');
                if(sb) sb.value = (localStorage.getItem('mums_sidebar_default')||'expanded');
                const hov = document.getElementById('sidebarHoverExpandToggle');
                if(hov) hov.checked = ((localStorage.getItem('mums_sidebar_hover')?? '1') === '1');
              }catch(_){}
            },
            bottombars: function(){
              try{ bindBarVisibilityControls(); _syncMsBarToggles(); }catch(_){}
            },
            brightness: function(){
              try{ initBrightnessControl(); _syncMsBrightnessBadge(); }catch(_){}
            },
            mailboxtime: function(){
              // Run the original bind so open() / clock are initialized
              try{ if(typeof bindMailboxTimeModal === 'function') bindMailboxTimeModal(); }catch(_){}
              // Always call open() to refresh draft from Store (bypasses __bound guard)
              try{
                var _mbModal = document.getElementById('mailboxTimeModal');
                if(_mbModal && typeof _mbModal.__open === 'function') _mbModal.__open();
              }catch(_){}
              // FIX[PANEL-DIRECT]: Wire Save/Reset buttons with a DIRECT server API call
              // This is a belt-and-suspenders override of the existing onclick handlers.
              // It guarantees the DB is written regardless of draft/Store state issues.
              try{
                var _saveBtn  = document.getElementById('mbTimeSave');
                var _resetBtn = document.getElementById('mbTimeReset');
                var _enabledEl = document.getElementById('mbTimeEnabled');
                var _inputEl   = document.getElementById('mbTimeInput');
                var _scopeEl   = document.getElementById('mbTimeScope');
                var _freezeEl  = document.getElementById('mbTimeFreeze');
                var _errEl     = document.getElementById('mbTimeErr');

                var _getToken = function(){
                  try{
                    var t = (window.CloudAuth && CloudAuth.accessToken) ? String(CloudAuth.accessToken()||'').trim() : '';
                    if(t) return t;
                    var sess = (window.CloudAuth && CloudAuth.loadSession) ? CloudAuth.loadSession() : null;
                    return (sess && (sess.access_token || (sess.session && sess.session.access_token)))
                      ? String(sess.access_token || sess.session.access_token).trim() : '';
                  }catch(e){ return ''; }
                };

                var _callOverrideApi = function(payload, onOk, onErr){
                  var token = _getToken();
                  if(!token){ if(onErr) onErr('Not authenticated'); return; }
                  fetch('/api/mailbox_override/set', {
                    method:'POST',
                    headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
                    body: JSON.stringify(payload)
                  }).then(function(r){
                    return r.json().then(function(d){
                      if(r.ok && d && d.ok){ if(onOk) onOk(d); }
                      else{ if(onErr) onErr((d && d.message) || ('HTTP '+r.status)); }
                    });
                  }).catch(function(e){ if(onErr) onErr(String(e && e.message || e)); });
                };

                if(_resetBtn){
                  _resetBtn.onclick = function(){
                    _resetBtn.disabled = true;
                    _resetBtn.textContent = 'Clearing…';
                    _callOverrideApi(
                      {scope:'global', enabled:false, freeze:true, override_iso:''},
                      function(){
                        _callOverrideApi({scope:'superadmin', enabled:false, freeze:true, override_iso:''}, null, null);
                        try{ if(window.Store && Store.disableMailboxTimeOverride) Store.disableMailboxTimeOverride({propagateGlobal:true, forceScope:'global'}); }catch(_){}
                        try{ if(window.UI && UI.toast) UI.toast('Override cleared. Mailbox now uses system Manila time.','success'); }catch(_){}
                        try{ if(_mbModal && typeof _mbModal.__open === 'function') _mbModal.__open(); }catch(_){}
                        _resetBtn.disabled = false;
                        _resetBtn.textContent = 'Return to normal time';
                      },
                      function(err){
                        try{ if(window.UI && UI.toast) UI.toast('Error clearing override: '+err,'error'); }catch(_){}
                        _resetBtn.disabled = false;
                        _resetBtn.textContent = 'Return to normal time';
                      }
                    );
                  };
                }

                if(_saveBtn){
                  _saveBtn.onclick = function(){
                    var isEnabled = _enabledEl ? !!_enabledEl.checked : false;
                    if(!isEnabled){
                      // Treat same as reset
                      if(_resetBtn) _resetBtn.onclick();
                      return;
                    }
                    // Parse date from input
                    var inputVal = _inputEl ? String(_inputEl.value||'').trim() : '';
                    var MIN_MS = Date.UTC(2020,0,1);
                    var ms = 0;
                    if(inputVal){
                      try{
                        var parts = inputVal.split('T');
                        if(parts.length < 2) parts = inputVal.split(' ');
                        var d = parts[0].trim(), t = (parts[1]||'').trim();
                        var dp = d.split(/[-\/]/).map(Number);
                        var tp = t.split(':').map(Number);
                        // Handle MM/DD/YYYY or YYYY-MM-DD
                        var y,m,day,hh,mm;
                        if(dp[0] > 31){ y=dp[0];m=dp[1];day=dp[2]; }
                        else{ m=dp[0];day=dp[1];y=dp[2]; }
                        hh=tp[0]||0; mm=tp[1]||0;
                        // Handle AM/PM
                        var tStr = (parts[1]||'').toUpperCase();
                        if(tStr.includes('PM') && hh < 12) hh+=12;
                        if(tStr.includes('AM') && hh===12) hh=0;
                        ms = Date.UTC(y,m-1,day,hh-8,mm,0,0);
                        if(!Number.isFinite(ms) || ms < MIN_MS) ms = 0;
                      }catch(e){ ms = 0; }
                    }
                    if(!ms || ms < MIN_MS){
                      // Try Store's current draft
                      try{
                        var cur = Store.getMailboxTimeOverride ? Store.getMailboxTimeOverride() : null;
                        if(cur && cur.ms && cur.ms > MIN_MS) ms = cur.ms;
                      }catch(_){}
                    }
                    if(!ms || ms < MIN_MS){
                      if(_errEl) _errEl.textContent = 'Please select a valid Manila date & time.';
                      try{ if(window.UI && UI.toast) UI.toast('Please select a valid date & time first.','warn'); }catch(_){}
                      return;
                    }
                    var scope = (_scopeEl && _scopeEl.value === 'global') ? 'global' : 'superadmin';
                    var freeze = _freezeEl ? !!_freezeEl.checked : true;
                    var isoStr = new Date(ms).toISOString();
                    _saveBtn.disabled = true;
                    _saveBtn.textContent = 'Saving…';
                    _callOverrideApi(
                      {scope:scope, enabled:true, freeze:freeze, override_iso:isoStr},
                      function(){
                        try{ if(window.Store && Store.saveMailboxTimeOverride) Store.saveMailboxTimeOverride({enabled:true,ms:ms,freeze:freeze,scope:scope,setAt:freeze?0:Date.now()}); }catch(_){}
                        try{ window.dispatchEvent(new CustomEvent('mums:store',{detail:{key:'mailbox_override_cloud',source:'local'}})); }catch(_){}
                        try{ window.dispatchEvent(new CustomEvent('mums:store',{detail:{key:'mailbox_time_override',source:'local'}})); }catch(_){}
                        try{ if(window.UI && UI.toast) UI.toast('Override saved! ('+scope[0].toUpperCase()+scope.slice(1)+' scope)','success'); }catch(_){}
                        try{ if(_mbModal && typeof _mbModal.__open === 'function') _mbModal.__open(); }catch(_){}
                        _saveBtn.disabled = false;
                        _saveBtn.textContent = 'Save';
                      },
                      function(err){
                        try{ if(window.UI && UI.toast) UI.toast('Save failed: '+err,'error'); }catch(_){}
                        if(_errEl) _errEl.textContent = 'Save failed: '+err;
                        _saveBtn.disabled = false;
                        _saveBtn.textContent = 'Save';
                      }
                    );
                  };
                }
              }catch(_){}
            },
            systemcheck: function(){
              try{ if(typeof bindSystemCheckModal === 'function') bindSystemCheckModal(_panelUser); }catch(_){}
            },
            globalqb: function(){
              // loadGqbSettings is scoped inside isSA block — access via window proxy
              try{ if(window.__mumsLoadGqbSettings) window.__mumsLoadGqbSettings();
              else if(typeof loadGqbSettings === 'function') loadGqbSettings(); }catch(_){}
            },
            calendar: function(){
              try{ if(window.__mumsLoadCalSettings) window.__mumsLoadCalSettings();
              else if(typeof loadCalSettings === 'function') loadCalSettings(); }catch(_){}
            },
            pinsecurity: function(){
              try{ if(window.__mumsRenderPinSettings) window.__mumsRenderPinSettings(); }catch(_){}
            },
            releasenotes: function(){
              try{ if(window.__mumsRenderReleaseNotes) window.__mumsRenderReleaseNotes(); }catch(_){}
            },
            loginmode: function(){
              // Load current login mode status from server
              try{ if(window.__mumsLoadLoginMode) window.__mumsLoadLoginMode(); }catch(_){}
            },
            data: function(){
              // Data health elements are already wired at boot; just sync health summary
              try{
                const sum = document.getElementById('storageHealthSummary');
                if(sum && sum.textContent === '—') {
                  const kb = Math.round(JSON.stringify(localStorage).length/1024);
                  sum.textContent = kb + ' KB used across ' + localStorage.length + ' keys';
                }
              }catch(_){}
            },
          };
          if (panelInits[panel]) {
            setTimeout(panelInits[panel], 60);
          }
        });
      });

      // Action buttons wired separately (they have their own IDs used by app.js)
      function wire(id, fn) {
        var el = document.getElementById(id);
        if (el && !el.__msWired) { el.__msWired = true; el.addEventListener('click', fn); }
      }
      wire('openMailboxTimeBtn', function(){ try{ UI.openModal('mailboxTimeModal'); if(window.bindMailboxTimeModal) bindMailboxTimeModal(); }catch(_){} });
      wire('openSystemCheckBtn', function(){ try{ UI.openModal('systemCheckModal'); }catch(_){} });
      wire('openGlobalQbSettingsBtn', function(){ try{ UI.openModal('globalQbModal'); }catch(_){} });
      wire('openCalendarSettingsBtn', function(){ /* inline — no modal needed */ });
      wire('openGmtOverviewPageBtn', function(){ try{ if(window.App&&App.navigate) App.navigate('gmt_overview'); else{ try{ document.querySelector('[data-page="gmt_overview"]')&&document.querySelector('[data-page="gmt_overview"]').click(); }catch(_){} } }catch(e){} });
    }


    // ── PIN SECURITY SETTINGS PANEL RENDERER ────────────────────────────────
    window.__mumsRenderPinSettings = async function() {
      var body = document.getElementById('pinSettingsPanelBody');
      if (!body) return;

      body.innerHTML = '<div style="text-align:center;padding:32px;color:var(--muted);font-size:12px">Loading…</div>';

      try {
        var tok = (window.CloudAuth && typeof CloudAuth.accessToken === 'function') ? CloudAuth.accessToken() : '';
        var res = await fetch('/api/pin/policy', { headers: { 'Authorization': 'Bearer ' + tok } });
        var data = await res.json().catch(function() { return {}; });
        var p = (data.ok && data.policy) ? data.policy : { enabled:true, requireOnLogin:true, enforceOnFirstLogin:true, sessionExpiryHours:3, autoLogoutOnFailures:true, maxFailedAttempts:3 };

        // Also get user count stats from Store
        var allUsers = (window.Store && Store.getUsers) ? Store.getUsers() : [];
        var pinSetCount = allUsers.filter(function(u) { return u && u.pin_hash; }).length;
        var pendingCount = allUsers.filter(function(u) { return u && !u.pin_hash; }).length;

        function tog(id, checked) {
          return '<div class="tog-wrap" style="width:42px;height:23px;border-radius:99px;border:1px solid rgba(255,255,255,' + (checked?'.14':'.07') + ');background:rgba(' + (checked?'56,189,248,.2':'255,255,255,.04') + ');cursor:pointer;position:relative;transition:.25s;flex-shrink:0" id="' + id + '" data-on="' + (checked?'1':'0') + '" onclick="window.__mumsTogglePin(this)">' +
            '<div style="position:absolute;top:3px;left:' + (checked?'20':'3') + 'px;width:15px;height:15px;border-radius:50%;background:' + (checked?'#38bdf8':'#475569') + ';transition:.25s;' + (checked?'box-shadow:0 0 10px rgba(56,189,248,.45)':'') + '"></div>' +
            '</div>';
        }
        function statChip(num, label, color) {
          return '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:14px 16px">' +
            '<div style="font-size:22px;font-weight:800;color:' + color + ';font-family:monospace;margin-bottom:4px">' + num + '</div>' +
            '<div style="font-size:10px;color:var(--muted);letter-spacing:.06em;text-transform:uppercase;font-family:monospace">' + label + '</div>' +
            '</div>';
        }
        function row(id, name, desc, checked) {
          return '<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:1px solid rgba(255,255,255,.03)">' +
            '<div style="flex:1;margin-right:20px">' +
              '<div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:3px">' + name + '</div>' +
              '<div style="font-size:11px;color:var(--muted);line-height:1.55">' + desc + '</div>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:10px;flex-shrink:0">' +
              '<span style="font-family:monospace;font-size:9px;font-weight:700;padding:3px 8px;border-radius:5px;letter-spacing:.05em;background:rgba(' + (checked?'16,185,129,.1':'255,255,255,.04') + ');border:1px solid rgba(' + (checked?'16,185,129,.2':'255,255,255,.1') + ');color:' + (checked?'#10b981':'var(--muted)') + '" id="ts_' + id + '">' + (checked?'ON':'OFF') + '</span>' +
              tog('tog_' + id, checked) +
            '</div>' +
          '</div>';
        }
        function rbadge(label, color, bg, border) {
          return '<span style="display:inline-flex;align-items:center;padding:2px 7px;border-radius:5px;font-size:9px;font-family:monospace;font-weight:700;background:' + bg + ';color:' + color + ';border:1px solid ' + border + ';margin-right:3px">' + label + '</span>';
        }

        body.innerHTML =
          '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:24px">' +
            statChip(pinSetCount, 'Users with PIN', '#38bdf8') +
            statChip(pendingCount, 'Pending Setup', '#f59e0b') +
            statChip(0, 'Failed Today', '#f43f5e') +
          '</div>' +

          '<div style="background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.07);border-radius:14px;overflow:hidden;margin-bottom:16px">' +
            '<div style="padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.06);display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.02)">' +
              '<div style="width:34px;height:34px;border-radius:10px;background:rgba(56,189,248,.1);border:1px solid rgba(56,189,248,.18);display:flex;align-items:center;justify-content:center;flex-shrink:0"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>' +
              '<div><div style="font-size:13px;font-weight:700;color:var(--text)">PIN Authentication Policy</div><div style="font-size:10.5px;color:var(--muted);margin-top:1px">Core login security settings</div></div>' +
            '</div>' +
            '<div style="padding:0 18px">' +
              row('enabled',             'Enable Security PIN System',            'Master switch. When off, no PIN is required for any user.',               p.enabled) +
              row('requireOnLogin',      'Require PIN on Every Login',            'Users must enter their PIN at the start of each new session.',            p.requireOnLogin) +
              row('enforceOnFirstLogin', 'Force PIN Setup on First Login',        'Block access until new users create their Security PIN.',                 p.enforceOnFirstLogin) +
              row('sessionExpiry',       '3-Hour Session Expiry',                 'Sessions auto-expire after 3 hours. Users re-authenticate with PIN.',     p.sessionExpiryHours === 3) +
              '<div style="padding:14px 0;border-bottom:0">' +
                row('autoLogout',        'Auto-Logout on 3 Wrong PINs',           'Sign out after 3 consecutive failures. No lockout — user can log back in immediately.',  p.autoLogoutOnFailures) +
              '</div>' +
            '</div>' +
          '</div>' +

          '<div style="background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.07);border-radius:14px;overflow:hidden;margin-bottom:20px">' +
            '<div style="padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.06);display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.02)">' +
              '<div style="width:34px;height:34px;border-radius:10px;background:rgba(99,102,241,.1);border:1px solid rgba(99,102,241,.18);display:flex;align-items:center;justify-content:center;flex-shrink:0"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" stroke-linecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div>' +
              '<div><div style="font-size:13px;font-weight:700;color:var(--text)">PIN Reset Permissions</div><div style="font-size:10.5px;color:var(--muted);margin-top:1px">Role-based PIN management access</div></div>' +
            '</div>' +
            '<div style="padding:0 18px">' +
              '<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:1px solid rgba(255,255,255,.03)">' +
                '<div style="flex:1;margin-right:20px"><div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:3px">' + rbadge('Team Lead','#38bdf8','rgba(56,189,248,.1)','rgba(56,189,248,.2)') + 'Can Reset Member PINs</div><div style="font-size:11px;color:var(--muted);line-height:1.55">Team Leads can send reset requests for their team members.</div></div>' +
                '<div style="display:flex;align-items:center;gap:10px;flex-shrink:0"><span style="font-family:monospace;font-size:9px;font-weight:700;padding:3px 8px;border-radius:5px;letter-spacing:.05em;background:rgba(16,185,129,.1);border:1px solid rgba(16,185,129,.2);color:#10b981">ON</span>' +
                '<div style="width:42px;height:23px;border-radius:99px;border:1px solid rgba(56,189,248,.14);background:rgba(56,189,248,.2);position:relative;opacity:.5;cursor:not-allowed"><div style="position:absolute;top:3px;left:20px;width:15px;height:15px;border-radius:50%;background:#38bdf8;box-shadow:0 0 10px rgba(56,189,248,.45)"></div></div>' +
                '</div>' +
              '</div>' +
              '<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:0">' +
                '<div style="flex:1;margin-right:20px"><div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:3px">' + rbadge('Super User','#6366f1','rgba(99,102,241,.1)','rgba(99,102,241,.2)') + rbadge('Super Admin','#10b981','rgba(16,185,129,.1)','rgba(16,185,129,.2)') + 'Full PIN Control</div><div style="font-size:11px;color:var(--muted);line-height:1.55">Can reset or force-clear any user&#39;s PIN via User Management.</div></div>' +
                '<div style="display:flex;align-items:center;gap:10px;flex-shrink:0"><span style="font-family:monospace;font-size:9px;font-weight:700;padding:3px 8px;border-radius:5px;letter-spacing:.05em;background:rgba(16,185,129,.1);border:1px solid rgba(16,185,129,.2);color:#10b981">ON</span>' +
                '<div style="width:42px;height:23px;border-radius:99px;border:1px solid rgba(56,189,248,.14);background:rgba(56,189,248,.2);position:relative;opacity:.5;cursor:not-allowed"><div style="position:absolute;top:3px;left:20px;width:15px;height:15px;border-radius:50%;background:#38bdf8;box-shadow:0 0 10px rgba(56,189,248,.45)"></div></div>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +

          '<div style="display:flex;justify-content:flex-end">' +
            '<button id="pinSaveBtn" onclick="window.__mumsSavePinPolicy()" style="height:38px;padding:0 22px;border-radius:10px;border:none;background:linear-gradient(135deg,rgba(56,189,248,.85),rgba(56,189,248,.65));color:#06111e;font-size:12.5px;font-weight:700;cursor:pointer;transition:.15s;font-family:var(--font,sans-serif)">Save PIN Policy</button>' +
          '</div>';

        // Store current policy for save
        window.__mumsPinCurrentPolicy = JSON.parse(JSON.stringify(p));

      } catch(e) {
        body.innerHTML = '<div style="color:var(--rose,#fb7185);padding:20px;font-size:12px">Failed to load PIN settings: ' + (e && e.message || e) + '</div>';
      }
    };

    // Toggle handler
    window.__mumsTogglePin = function(el) {
      var isOn = el.getAttribute('data-on') === '1';
      var newOn = !isOn;
      el.setAttribute('data-on', newOn ? '1' : '0');
      el.style.background = newOn ? 'rgba(56,189,248,.2)' : 'rgba(255,255,255,.04)';
      el.style.borderColor = newOn ? 'rgba(56,189,248,.14)' : 'rgba(255,255,255,.07)';
      var dot = el.querySelector('div');
      if (dot) { dot.style.left = newOn ? '20px' : '3px'; dot.style.background = newOn ? '#38bdf8' : '#475569'; dot.style.boxShadow = newOn ? '0 0 10px rgba(56,189,248,.45)' : 'none'; }
      var id = el.id.replace('tog_','');
      var ts = document.getElementById('ts_' + id);
      if (ts) { ts.textContent = newOn ? 'ON' : 'OFF'; ts.style.background = newOn?'rgba(16,185,129,.1)':'rgba(255,255,255,.04)'; ts.style.borderColor = newOn?'rgba(16,185,129,.2)':'rgba(255,255,255,.1)'; ts.style.color = newOn?'#10b981':'var(--muted)'; }
      if (window.__mumsPinCurrentPolicy) {
        var fieldMap = { enabled:'enabled', requireOnLogin:'requireOnLogin', enforceOnFirstLogin:'enforceOnFirstLogin', sessionExpiry:'sessionExpiryHours', autoLogout:'autoLogoutOnFailures' };
        var field = fieldMap[id];
        if (field) {
          if (field === 'sessionExpiryHours') window.__mumsPinCurrentPolicy[field] = newOn ? 3 : 0;
          else window.__mumsPinCurrentPolicy[field] = newOn;
        }
      }
    };

    // Save handler
    window.__mumsSavePinPolicy = async function() {
      var btn = document.getElementById('pinSaveBtn');
      if (!btn) return;
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        var tok = (window.CloudAuth && typeof CloudAuth.accessToken === 'function') ? CloudAuth.accessToken() : '';
        var res = await fetch('/api/pin/policy', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' },
          body: JSON.stringify(window.__mumsPinCurrentPolicy || {})
        });
        var data = await res.json().catch(function() { return {}; });
        if (data.ok) {
          // Update PinController policy cache
          if (window.PinController && typeof PinController.reloadPolicy === 'function') PinController.reloadPolicy();
          try{ if(window.UI && UI.toast) UI.toast('PIN policy saved.', 'success'); }catch(_){}
        } else {
          try{ if(window.UI && UI.toast) UI.toast('Failed to save: ' + (data.message||'unknown error'), 'error'); }catch(_){}
        }
      } catch(e) {
        try{ if(window.UI && UI.toast) UI.toast('Network error saving PIN policy.', 'error'); }catch(_){}
      }
      btn.disabled = false; btn.textContent = 'Save PIN Policy';
    };
    // ── END PIN SETTINGS RENDERER ────────────────────────────────────────────

    function _bindMsSearch() {
      var inp = document.getElementById('msSearchInput');
      if (!inp || inp.__msBound) return;
      inp.__msBound = true;
      inp.addEventListener('input', function() {
        var q = inp.value.toLowerCase().trim();
        document.querySelectorAll('.ms-nav-item[data-panel]').forEach(function(btn) {
          var name = (btn.querySelector('.ms-ni-name')||{}).textContent || '';
          var sub  = (btn.querySelector('.ms-ni-sub')||{}).textContent  || '';
          btn.style.display = (!q || (name+sub).toLowerCase().includes(q)) ? '' : 'none';
        });
        // Show/hide group labels based on whether any items below are visible
        document.querySelectorAll('.ms-grp-label').forEach(function(lbl) {
          var next = lbl.nextElementSibling;
          var anyVisible = false;
          while (next && !next.classList.contains('ms-grp-label')) {
            if (next.style.display !== 'none') anyVisible = true;
            next = next.nextElementSibling;
          }
          lbl.style.display = anyVisible ? '' : 'none';
        });
      });
    }

    function _syncMsBarToggles() {
      try {
        var onlineChk = document.getElementById('toggleOnlineBar');
        var qlChk = document.getElementById('toggleQuickLinksBar');
        // FIX: was using wrong keys. Must match outer BAR_KEYS object.
        if (onlineChk) onlineChk.checked = localStorage.getItem('mums_bar_online')     !== '0';
        if (qlChk)     qlChk.checked     = localStorage.getItem('mums_bar_quicklinks') !== '0';
      } catch(_) {}
    }

    function _syncMsBrightnessBadge() {
      try {
        var tag = document.getElementById('msBrightnessTag');
        var raw = JSON.parse(localStorage.getItem('mums_brightness_v1') || '{}');
        var val = raw.useDefault ? 130 : (Number(raw.value) || 130);
        var label = document.getElementById('brightnessStatusLabel');
        if (tag) {
          if (!raw.useDefault && val !== 100) {
            tag.textContent = val + '%';
            tag.style.display = '';
          } else {
            tag.style.display = 'none';
          }
        }
        if (label) label.textContent = raw.useDefault ? 'default (130%)' : val + '%';
      } catch(_) {}
    }
  })();

  // ── BRIGHTNESS CONTROL ────────────────────────────────────────────────────────
  (function initBrightnessSystem() {
    const LS_KEY = 'mums_brightness_v1';
    const DEFAULT_VAL = 130;
    const APP_EL_ID = 'app'; // root app element to apply filter on

    function clamp(v) { return Math.max(40, Math.min(130, Number(v) || DEFAULT_VAL)); }

    function getStoredBrightness() {
      try {
        const raw = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
        return {
          value: clamp(raw.value ?? DEFAULT_VAL),
          useDefault: raw.useDefault === true
        };
      } catch(_) { return { value: DEFAULT_VAL, useDefault: false }; }
    }

    function saveBrightness(value, useDefault) {
      try { localStorage.setItem(LS_KEY, JSON.stringify({ value, useDefault })); } catch(_) {}
    }

    function applyBrightness(value, useDefault) {
      const app = document.getElementById(APP_EL_ID) || document.body;
      const effective = useDefault ? DEFAULT_VAL : clamp(value);
      // Set CSS variable and data attribute for selector hook
      document.documentElement.style.setProperty('--mums-brightness', effective / 100);
      app.setAttribute('data-brightness', String(effective));
      // Apply filter proportionally to ALL UI elements via root element
      // FIX: Clear filter only at true neutral (100%), not at DEFAULT_VAL.
      // Previously this was `effective === DEFAULT_VAL` which incorrectly
      // skipped the CSS filter when brightness was 130, making it look like 100%.
      if (effective === 100) {
        app.style.filter = '';
      } else {
        app.style.filter = `brightness(${effective / 100})`;
      }
    }

    function updateSliderTrack(slider) {
      try {
        const min = Number(slider.min || 40);
        const max = Number(slider.max || 130);
        const val = Number(slider.value || DEFAULT_VAL);
        const pct = ((val - min) / (max - min) * 100).toFixed(1) + '%';
        slider.style.setProperty('--sval', pct);
      } catch(_) {}
    }

    // Apply on page load (before settings modal is ever opened)
    const stored = getStoredBrightness();
    applyBrightness(stored.value, stored.useDefault);

    // Expose for settings modal
    window.initBrightnessControl = function() {
      try {
        const slider    = document.getElementById('brightnessSlider');
        const valLabel  = document.getElementById('brightnessVal');
        const useDefChk = document.getElementById('brightnessUseDefault');
        if (!slider || !valLabel || !useDefChk) return;

        const cur = getStoredBrightness();

        // Init state
        slider.value    = cur.value;
        useDefChk.checked = cur.useDefault;
        slider.disabled = cur.useDefault;
        valLabel.textContent = cur.useDefault ? DEFAULT_VAL + '%' : cur.value + '%';
        updateSliderTrack(slider);

        // Guard: bind only once per element
        if (slider.__brightBound) return;
        slider.__brightBound = true;

        slider.addEventListener('input', () => {
          if (useDefChk.checked) return;
          const v = clamp(slider.value);
          valLabel.textContent = v + '%';
          updateSliderTrack(slider);
          applyBrightness(v, false);
          saveBrightness(v, false);
        });

        useDefChk.addEventListener('change', () => {
          const isDefault = useDefChk.checked;
          slider.disabled = isDefault;
          if (isDefault) {
            valLabel.textContent = DEFAULT_VAL + '%';
            applyBrightness(DEFAULT_VAL, true);
            saveBrightness(Number(slider.value), true);
          } else {
            const v = clamp(slider.value);
            valLabel.textContent = v + '%';
            applyBrightness(v, false);
            saveBrightness(v, false);
          }
          updateSliderTrack(slider);
        });
      } catch(_) {}
    };
  })();

  // ── NAV KEYBOARD ─────────────────────────────────────────────────────────────
  function bindNavKeyboard() {
    try {
      document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
          e.preventDefault();
          const inp = document.getElementById('globalSearchInput');
          if (inp) { inp.focus(); inp.select(); }
        }
        // [ / ] keys to toggle sidebar quickly.
        if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key === '[') {
          const active = document.activeElement;
          if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
          const isCollapsed = document.body.classList.contains('sidebar-collapsed');
          applySidebarState(!isCollapsed);
        }
      });
    } catch (_) {}
  }

  // ── MOBILE STUBS ─────────────────────────────────────────────────────────────
  // These are no-ops on desktop; extend when mobile breakpoints are added.
  function bindMobilePanelToggle() { /* mobile panel toggle placeholder */ }
  function bindMobileBottomSheets() { /* mobile bottom sheet placeholder */ }
  function bindMobileFabStack() { /* mobile FAB stack placeholder */ }
  // ─────────────────────────────────────────────────────────────────────────────

async function boot(){
    if(window.__mumsBooted) return;
    window.__mumsBooted = true;
    try{ UI.bindDataClose && UI.bindDataClose(); }catch(_){ }
    window.addEventListener('error', (e)=>{ showFatalError(e.error || e.message || e); });
    window.addEventListener('unhandledrejection', (e)=>{ showFatalError(e.reason || e); });

    Store.ensureSeed();

    try{ await Promise.all([loadThemeMeta(), loadGlobalThemeSettings()]); }catch(_){ }

    // ── FORCED DEFAULTS: Super Admin may push APEX+130% to ALL users ──────
    try{
      if(__globalThemeSettings && __globalThemeSettings.forcedTheme){
        const ft = String(__globalThemeSettings.defaultTheme || 'apex').trim();
        if(isValidThemeId(ft)){
          try{ if(Store && Store.dispatch) Store.dispatch('UPDATE_THEME',{id:ft}); else Store.setTheme(ft); }catch(_){}
          try{ localStorage.setItem('mums_theme_preference', ft); }catch(_){}
        }
      }
      if(__globalThemeSettings && __globalThemeSettings.forcedBrightness){
        const fb = typeof __globalThemeSettings.brightness === 'number' ? __globalThemeSettings.brightness : 130;
        try{
          localStorage.setItem('mums_brightness_v1', JSON.stringify({ value: fb, useDefault: false }));
          const appEl = document.getElementById('app') || document.body;
          appEl.style.filter = fb === 100 ? '' : `brightness(${fb/100})`;
          document.documentElement.style.setProperty('--mums-brightness', fb/100);
          appEl.setAttribute('data-brightness', String(fb));
        }catch(_){}
      }
    }catch(_){}

    const effectiveTheme = resolveEffectiveThemeForUser();
    try{
      if(Store && Store.dispatch) Store.dispatch('UPDATE_THEME', { id: effectiveTheme });
      else if(Store && Store.setTheme) Store.setTheme(effectiveTheme);
    }catch(_){ }
    applyTheme(effectiveTheme);
    try{ setupClassicTopbarClock(); }catch(_){ }
    try{
      const d = (localStorage.getItem('mums_density')||'normal');
      localStorage.setItem('mums_density', d);
      document.body.classList.toggle('density-compact', d==='compact');
    }catch(e){}

    try{
      const cursorMode = 'system';
      localStorage.setItem('mums_cursor_mode', cursorMode);
    }catch(e){}
    try{ applySidebarState(); }catch(e){}
    try{ bindSidebarToggle(); }catch(e){}
    try{ bindMobilePanelToggle(); }catch(e){}
    try{ bindMobileBottomSheets(); }catch(e){}
    try{ bindMobileFabStack(); }catch(e){}
    try{ applyRightbarState(); }catch(e){}
    try{ bindRightbarToggle(); }catch(e){}
    try{ applyDensity(); }catch(e){}
    try{ applyBarVisibility(); }catch(e){}
    // Start ResizeObserver on both fixed bars — measures ACTUAL rendered heights
    // and writes them to --mums-dock-h / --mums-onlinebar-h on <html> inline style.
    // This permanently fixes sidebars/main overflowing behind the fixed bars.
    try{ _initBarObservers(); }catch(e){}
    try{ bindNavKeyboard(); }catch(e){}

    try{
      const curSel = document.getElementById('cursorModeSelect');
      if(curSel){
        curSel.value = (localStorage.getItem('mums_cursor_mode')||'custom');
        curSel.onchange = ()=>{ try{ UI.setCursorMode(curSel.value); }catch(e){} };
      }
      const densSel = document.getElementById('densitySelect');
      if(densSel){
        densSel.value = (localStorage.getItem('mums_density')||'normal');
        densSel.onchange = ()=>{
          const v = (densSel.value==='compact') ? 'compact' : 'normal';
          localStorage.setItem('mums_density', v);
          document.body.classList.toggle('density-compact', v==='compact');
        };

      const toggleRP = document.getElementById('toggleRightPanelBtn');
      if(toggleRP){
        toggleRP.onclick = ()=>{
          try{
            const now = document.body.classList.contains('rightbar-collapsed');
            applyRightbarState(!now);
          }catch(_){}
        };
      }

      }

      const hoverT = document.getElementById('sidebarHoverExpandToggle');
      if(hoverT){
        const on = (localStorage.getItem('mums_sidebar_hover') ?? '1');
        hoverT.checked = on==='1';
        hoverT.onchange = ()=>{
          localStorage.setItem('mums_sidebar_hover', hoverT.checked ? '1' : '0');
          const isCollapsed = document.body.classList.contains('sidebar-collapsed');
          document.body.classList.toggle('sidebar-hoverable', isCollapsed && hoverT.checked);
        };
      }

      const sbSel = document.getElementById('sidebarDefaultSelect');
      if(sbSel){
        sbSel.value = (localStorage.getItem('mums_sidebar_default')||'expanded');
        sbSel.onchange = ()=>{
          const v = (sbSel.value==='collapsed') ? 'collapsed' : 'expanded';
          localStorage.setItem('mums_sidebar_default', v);
          applySidebarState(v==='collapsed');
        };
      }
    }catch(e){}


    // FIX-ENV-WAIT: Wait for /api/env to resolve before Auth.requireUser().
    // On fast devices / defer execution, boot() runs within ~50ms of DOMContentLoaded,
    // but /api/env is an async fetch that can take 200-600ms on cold starts.
    // Without this wait, ensureFreshSession() calls apiFetch() with an empty SUPABASE_URL,
    // throws "Supabase env missing", hits the catch block in requireUser → hardFail()
    // → user is redirected back to /login.html → stuck-on-login loop on fresh devices.
    // Max wait: 4 seconds (matches login.html guard). After timeout, proceed anyway —
    // local-mode fallback handles offline scenarios.
    try {
      const envReady = window.__MUMS_ENV_READY || (window.EnvRuntime && EnvRuntime.ready && EnvRuntime.ready());
      if (envReady && typeof envReady.then === 'function') {
        await Promise.race([
          envReady,
          new Promise(function(resolve){ setTimeout(resolve, 4000); })
        ]);
      }
    } catch(_) {}

    const user = await Auth.requireUser();
    if(!user) return;

    // ── SECURITY PIN GATE ──────────────────────────────────────────────────
    // Must pass PIN verification before the app renders.
    // PinController.gate() checks policy → shows overlay if needed.
    if (window.PinController && typeof PinController.gate === 'function') {
      await new Promise((resolve) => {
        PinController.gate(resolve);
      });
    }
    // ── END PIN GATE ──────────────────────────────────────────────────────

    // Realtime Guard: initialize realtime only after auth has been resolved.
    try{
      if(window.Realtime && typeof window.Realtime.init === 'function'){
        window.Realtime.init();
      }
    }catch(_){ }

    const roleUpper = String(user.role||'').trim().toUpperCase().replace(/\s+/g,'_');
    const isSA = roleUpper === String((Config && Config.ROLES ? Config.ROLES.SUPER_ADMIN : 'SUPER_ADMIN'));
    const isSU = roleUpper === 'SUPER_USER';

    try{ window.__mumsBootTs = Date.now(); }catch(_){ }
    try{ if(window.Store && Store.autoFixLogs) Store.autoFixLogs(); }catch(e){ console.error(e); }

    function normalizeRole(v){
      const raw = String(v||'').trim();
      if(!raw) return (Config?.ROLES?.MEMBER) || 'MEMBER';
      const up = raw.toUpperCase().replace(/\s+/g,'_');
      const map = {
        'TEAMLEAD':'TEAM_LEAD',
        'TEAM-LEAD':'TEAM_LEAD',
        'TEAM_LEAD':'TEAM_LEAD',
        'LEAD':'TEAM_LEAD',
        'TL':'TEAM_LEAD',
        'SUPERADMIN':'SUPER_ADMIN',
        'SUPER-ADMIN':'SUPER_ADMIN',
        'SUPER_ADMIN':'SUPER_ADMIN',
        'ADMIN':'ADMIN',
        'MEMBER':'MEMBER'
      };
      const norm = map[up] || up;
      return (Config && Config.PERMS && Config.PERMS[norm]) ? norm : ((Config?.ROLES?.MEMBER) || 'MEMBER');
    }

    const __bootPatch = {};
    let __bootPatchTimer = null;
    function deferBootUserPatch(patch){
      try{
        Object.assign(__bootPatch, patch || {});
        if(__bootPatchTimer) return;
        __bootPatchTimer = setTimeout(function(){
          __bootPatchTimer = null;
          try{
            const p = Object.assign({}, __bootPatch);
            Object.keys(__bootPatch).forEach(k=>{ try{ delete __bootPatch[k]; }catch(_){} });
            if(window.Store && Store.updateUser) Store.updateUser(user.id, p);
          }catch(_){ }
        }, 0);
      }catch(_){ }
    }

    const fixedRole = normalizeRole(user.role);
    if(fixedRole !== user.role){
      user.role = fixedRole;
      try{ deferBootUserPatch({ role: fixedRole }); }catch(e){}
    }

    const isSuperRole = fixedRole === 'SUPER_ADMIN' || fixedRole === 'SUPER_USER';
    const teamOverride = !!user.teamOverride;
    const teams = (Config?.TEAMS||[]);
    const isValidTeam = (tid)=> !!teams.find(t=>t.id===tid);

    if(isSuperRole && !teamOverride){
      if(String(user.teamId||'') !== ''){
        user.teamId = '';
        try{ deferBootUserPatch({ teamId: '' }); }catch(e){}
      }
    } else {
      if(!user.teamId || !isValidTeam(user.teamId)){
        user.teamId = (teams[0] && teams[0].id) ? teams[0].id : 'morning';
        try{ deferBootUserPatch({ teamId: user.teamId }); }catch(e){}
      }
    }

    try{ applySettingsVisibility(user); }catch(e){ console.error(e); }

    try{
      if(isSuperRole && !teamOverride){
        // Skip enforcement.
      } else {
      const team = (Config && Config.teamById) ? Config.teamById(user.teamId) : null;
      const nowP = UI.manilaNow();
      const nowMin = UI.minutesOfDay(nowP);
      const meta = UI.shiftMeta(team || { id:user.teamId, teamStart:'06:00', teamEnd:'15:00' });
      const inShift = (!meta.wraps) ? (nowMin>=meta.start && nowMin<meta.end) : ((nowMin>=meta.start) || (nowMin<meta.end));
      const afterShift = (!meta.wraps) ? (nowMin>=meta.end) : (nowMin>=meta.end && nowMin<meta.start);
      if(inShift){
        let shiftDateISO = nowP.isoDate;
        if(meta.wraps && nowMin < meta.end){
          shiftDateISO = UI.addDaysISO(nowP.isoDate, -1);
        }
        const shiftKey = `${user.teamId}|${shiftDateISO}T${String(Store.getTeamConfig(user.teamId)?.schedule?.start || team?.teamStart || '00:00')}`;
        if(!Store.hasAttendance(user.id, shiftKey)){
          const rec = await UI.attendancePrompt(user, team);
          if(rec){
            rec.shiftKey = shiftKey;
            try{ Store.addAttendance(rec); }catch(e){ console.error(e); }
            UI.toast('Attendance saved.');
          }
        }
      }

      if(afterShift){
        const shiftDateISO = nowP.isoDate;
        const schedEndMin = Number(meta.end || 0);
        const endHH = String(Math.floor(schedEndMin / 60)).padStart(2, '0');
        const endMM = String(schedEndMin % 60).padStart(2, '0');
        const shiftKey = `${user.teamId}|${shiftDateISO}T${String(Store.getTeamConfig(user.teamId)?.schedule?.start || team?.teamStart || '00:00')}`;
        if(Store.hasAttendance(user.id, shiftKey) && !Store.hasOvertimeConfirmation(user.id, shiftKey)){
          const scheduledEndTs = Date.parse(`${shiftDateISO}T${endHH}:${endMM}:00+08:00`) || Date.now();
          const overtimeMinutes = Math.max(0, Math.floor((Date.now() - scheduledEndTs) / 60000));
          const out = await UI.overtimePrompt(user, team, { scheduledEndTs, overtimeMinutes });
          if(out && out.action === 'YES'){
            const rec = {
              id: 'att_ot_' + Math.random().toString(16).slice(2) + '_' + Date.now(),
              ts: Date.now(),
              shiftKey,
              eventType: 'OVERTIME_CONFIRMATION',
              userId: user.id,
              username: user.username || '',
              name: user.name || user.username || '',
              teamId: String(user.teamId || ''),
              teamLabel: String((team && team.label) || ''),
              mode: 'OVERTIME',
              reason: String(out.reason || ''),
              scheduledEndTs,
              overtimeMinutes
            };
            try{ Store.addAttendance(rec); }catch(e){ console.error(e); }

            try{
              const users = (Store && Store.getUsers) ? (Store.getUsers()||[]) : [];
              const leads = users.filter(u=>u && u.id !== user.id && String(u.teamId||'')===String(user.teamId||'') && String(u.role||'')==='TEAM_LEAD' && String(u.status||'active')==='active');
              if(leads.length){
                const weekOtMins = Store.getWeeklyOvertimeMinutes(user.id, Date.now());
                const leadMsg = `${String(user.name || user.username || 'Team Member')} has confirmed working beyond scheduled hours. This has been recorded in the Attendance system under Overtime.`;
                const details = `Employee: ${String(user.name || user.username || 'N/A')}\nReason: ${String(out.reason || 'N/A')}\nCurrent Overtime (7 days): ${Math.floor(weekOtMins/60)}h ${weekOtMins%60}m`;
                Store.addNotif({
                  id: 'ot_notif_' + Math.random().toString(16).slice(2) + '_' + Date.now(),
                  ts: Date.now(),
                  type: 'OVERTIME_ALERT',
                  title: 'Overtime Alert – Team Member',
                  body: leadMsg,
                  detailText: details,
                  teamId: String(user.teamId || ''),
                  fromName: String(user.name || user.username || 'Member'),
                  recipients: leads.map(l=>l.id),
                  acks: {}
                });
              }
            }catch(e){ console.error(e); }

            UI.toast('Overtime recorded and Team Lead notified.', 'ok');
          }else if(out && out.action === 'NO'){
            UI.toast('Shift marked as completed.', 'ok');
          }
        }
      }
      }
    }catch(e){ console.error(e); }

    UI.el('#logoutBtn').onclick = ()=>{
      // Send explicit offline marker so user disappears from roster immediately
      // instead of waiting for TTL expiry on the 8-hour window
      try{ if(typeof window.__mumsPresenceOffline === 'function') window.__mumsPresenceOffline(); }catch(_){ }
      try{ const u = Auth.getUser && Auth.getUser(); if(u && Store && Store.setOffline) Store.setOffline(u.id); }catch(_){ }
      Auth.logout();
      window.location.href='/login';
    };

    try{ bindGlobalSearch(user); }catch(e){ console.error(e); }



    const settingsBtn = document.getElementById('settingsBtn');
    if(settingsBtn){
      settingsBtn.onclick = ()=>{
        UI.openModal('settingsModal');
        try{ initMainSettings(user); }catch(_){}
      };
    }
    const openSoundBtn = document.getElementById('openSoundBtn');
    if(openSoundBtn){
      openSoundBtn.onclick = ()=>{ try{ UI.bindSoundSettingsModal && UI.bindSoundSettingsModal(user); }catch(e){} };
    }
    const openProfileBtn = document.getElementById('openProfileBtn');
    if(openProfileBtn){
      openProfileBtn.onclick = ()=>{ try{ _msSelectPanel('profile'); setTimeout(function(){ try{ openProfileModal(Auth.getUser()||user); }catch(_){} }, 60); }catch(_){} };
    }

    const openThemeBtn = document.getElementById('openThemeBtn');
    if(openThemeBtn){
      openThemeBtn.onclick = ()=>{ try{ __themeEditMode = false; renderThemeGrid(); }catch(_){} };
    }

    const openCursorBtn = document.getElementById('openCursorBtn');
    if(openCursorBtn){
      openCursorBtn.onclick = ()=>{};
    }

    const openSidebarBtn = document.getElementById('openSidebarBtn');
    if(openSidebarBtn){
      openSidebarBtn.onclick = ()=>{};
    }

    const openDataToolsBtn = document.getElementById('openDataToolsBtn');
    if(openDataToolsBtn){
      openDataToolsBtn.onclick = ()=>{ try{ if(window.bindDataHealthModal) bindDataHealthModal(); }catch(_){} };
    }

    const openLinksBtn = document.getElementById('openLinksBtn');
    if(openLinksBtn){
      openLinksBtn.onclick = ()=>{ try{ renderLinksGrid(); }catch(_){} };
    }

    try{
      const card = document.getElementById('timeOverrideCard');
      const openMailboxTimeBtn = document.getElementById('openMailboxTimeBtn');
      const modal = document.getElementById('mailboxTimeModal');

      const isGlobalOverrideActive = () => {
        try{
          const o = (window.Store && Store.getMailboxTimeOverride) ? Store.getMailboxTimeOverride() : null;
          return !!(o && o.enabled && o.ms && String(o.scope||'') === 'global');
        }catch(_){ return false; }
      };

      const refreshOverrideCard = () => {
        try{
          const active = isGlobalOverrideActive();
          const canView = isSA || active;
          if(card) { card.style.display = canView ? '' : 'none'; if(canView) _revealAdminSection(); }
          if(openMailboxTimeBtn) openMailboxTimeBtn.disabled = (!isSA && !active);
        }catch(_){ }
      };

      refreshOverrideCard();
      try{
        if(!window.__mumsMailboxOverrideCardListener){
          window.__mumsMailboxOverrideCardListener = true;
          window.addEventListener('mums:store', (ev)=>{
            try{
              const k = ev && ev.detail && ev.detail.key;
              if(k === 'mailbox_override_cloud' || k === 'mailbox_time_override_cloud' || k === '*') refreshOverrideCard();
            }catch(_){ }
          });
        }
      }catch(_){ }

      function fmtManilaLocal(ms){
        try{
          const p = UI.manilaParts(new Date(ms));
          const pad = (n)=>String(n).padStart(2,'0');
          return `${p.isoDate}T${pad(p.hh)}:${pad(p.mm)}`;
        }catch(_){ return ''; }
      }

      function parseManilaLocal(str){
        const s = String(str||'').trim();
        if(!s) return 0;
        const parts = s.split('T');
        if(parts.length < 2) return 0;
        const d = parts[0];
        const t = parts[1];
        const dp = d.split('-').map(n=>Number(n));
        const tp = t.split(':').map(n=>Number(n));
        if(dp.length < 3 || tp.length < 2) return 0;
        const y = dp[0], m = dp[1], da = dp[2];
        const hh = tp[0], mm = tp[1];
        if(!y || !m || (!da && da !== 0)) return 0;
        if([y,m,da,hh,mm].some(x=>Number.isNaN(x))) return 0;
        // FIX[EPOCH-BUG]: Reject obviously invalid years (before 2020 or after 2099).
        if(y < 2020 || y > 2099) return 0;
        const result = Date.UTC(y, m-1, da, hh-8, mm, 0, 0);
        // Guard: parsed result must be a valid post-2020 timestamp.
        if(!Number.isFinite(result) || result <= Date.UTC(2020,0,1)) return 0;
        return result;
      }

      function bindMailboxTimeModal(){
        if(!modal) return;
        // FIX[BUG#2]: Original guard 'if(modal.__bound) return' permanently blocks rebind
        // even after soft DOM refreshes where the modal element is reused but handlers
        // are lost. Guard now checks: skip ONLY if bound AND still connected to DOM.
        if(modal.__bound && modal.isConnected) return;
        // Reset bound flag — re-entering means a fresh bind is needed.
        modal.__bound = false;
        modal.__bound = true;

        const enabledEl = document.getElementById('mbTimeEnabled');
        const freezeEl = document.getElementById('mbTimeFreeze');
        const inputEl = document.getElementById('mbTimeInput');
        const scopeEl = document.getElementById('mbTimeScope');
        const sysEl = document.getElementById('mbTimeSys');
        const effEl = document.getElementById('mbTimeEffective');
        const errEl = document.getElementById('mbTimeErr');
        const clockEl = document.getElementById('mbTimeClock');
        const clockDateEl = document.getElementById('mbTimeClockDate');
        const saveBtn = document.getElementById('mbTimeSave');
        const resetBtn = document.getElementById('mbTimeReset');
        const setNowBtn = document.getElementById('mbTimeSetNow');

        const canEdit = !!isSA;
        const readOnly = !canEdit;
        try{
          if(readOnly){
            [enabledEl, freezeEl, inputEl, scopeEl].forEach(el=>{ try{ if(el) el.disabled = true; }catch(_){ } });
            try{ if(setNowBtn) setNowBtn.disabled = true; }catch(_){ }
            try{ modal.querySelectorAll('[data-mbshift]').forEach(b=>{ try{ b.disabled = true; }catch(_){ } }); }catch(_){ }
            try{ if(saveBtn) { saveBtn.disabled = true; saveBtn.style.display = 'none'; } }catch(_){ }
            try{ if(resetBtn){ resetBtn.disabled = true; resetBtn.style.display = 'none'; } }catch(_){ }
          }
        }catch(_){ }

        let draft = Store.getMailboxTimeOverride ? Store.getMailboxTimeOverride() : { enabled:false, ms:0, freeze:true, setAt:0, scope:'sa_only' };
        draft = {
          enabled: !!draft.enabled,
          ms: Number(draft.ms)||0,
          freeze: (draft.freeze !== false),
          setAt: Number(draft.setAt)||0,
          scope: (String(draft.scope||'sa_only') === 'global') ? 'global' : 'sa_only',
        };
        // FIX[EPOCH-BUG]: Bind-time guard — treat ms=0/epoch as unset
        if(!draft.ms || draft.ms <= Date.UTC(2020,0,1)) draft.ms = Date.now();
        if(!draft.freeze && !draft.setAt) draft.setAt = Date.now();

        // FIX[EPOCH-BUG]: Min valid ms = year 2020. Any ms before this is treated as unset.
        const MIN_VALID_OVERRIDE_MS = Date.UTC(2020, 0, 1);
        function safeDraftMs(ms){
          const n = Number(ms)||0;
          return (n > MIN_VALID_OVERRIDE_MS) ? n : Date.now();
        }

        function effectiveMs(){
          if(!draft.enabled) return Date.now();
          if(!draft.ms || draft.ms <= MIN_VALID_OVERRIDE_MS) return Date.now();
          if(draft.freeze) return draft.ms;
          // FIX[BUG#3b]: Use draft.setAt as anchor for running clock.
          const anchor = (Number(draft.setAt) > 0) ? Number(draft.setAt) : Date.now();
          return draft.ms + Math.max(0, Date.now() - anchor);
        }

        function render(){
          try{ if(errEl) errEl.textContent=''; }catch(_){ }
          const sys = UI.manilaNow();
          if(sysEl){
            sysEl.textContent = `System Manila time: ${sys.iso.replace('T',' ')}`;
          }
          if(enabledEl) enabledEl.checked = !!draft.enabled;
          if(freezeEl) freezeEl.checked = !!draft.freeze;
          // INPUT OVERWRITE FIX: Only write back to inputEl if the user is NOT
          // actively editing it. Overwriting while user is picking a time resets
          // the picker back to the old value mid-selection.
          // __userEditing is set by onfocus/onblur on inputEl for reliable detection.
          if(inputEl && !inputEl.__userEditing && document.activeElement !== inputEl){
            inputEl.value = fmtManilaLocal(safeDraftMs(draft.ms));
          }
          if(scopeEl) scopeEl.value = (String(draft.scope||'sa_only') === 'global') ? 'global' : 'sa_only';

          const on = !!draft.enabled;
          if(effEl){
            if(!on) {
              effEl.textContent = 'Override OFF — Mailbox uses system Manila time.';
            } else {
              const scopeLbl = (String(draft.scope||'sa_only') === 'global') ? 'GLOBAL' : 'Super Admin-only';
              const modeLbl = draft.freeze ? 'Frozen clock' : 'Running clock';
              if(readOnly && scopeLbl === 'GLOBAL') effEl.textContent = `${scopeLbl} override active — ${modeLbl} (read-only view).`;
              else effEl.textContent = `${scopeLbl} override active — ${modeLbl}.`;
            }
          }

          const ms = effectiveMs();
          const p = UI.manilaParts(new Date(ms));
          const pad = (n)=>String(n).padStart(2,'0');
          if(clockEl) clockEl.textContent = `${pad(p.hh)}:${pad(p.mm)}:${pad(p.ss)}`;
          if(clockDateEl) clockDateEl.textContent = `${p.isoDate} (Asia/Manila)`;
        }

        function startClock(){
          try{ if(modal.__clockInt) clearInterval(modal.__clockInt); }catch(_){ }
          modal.__clockInt = setInterval(()=>{ try{ render(); }catch(e){ } }, 1000);
        }

        function stopClock(){
          try{ if(modal.__clockInt) clearInterval(modal.__clockInt); }catch(_){ }
          modal.__clockInt = null;
        }

        function open(){
          // FIX[BUG#3c]: Always stop any existing clock before opening to prevent double-interval leak.
          stopClock();
          try{ if(window.Store && Store.startMailboxOverrideSync) Store.startMailboxOverrideSync({ force:true }); }catch(_){ }
          let o = Store.getMailboxTimeOverride ? Store.getMailboxTimeOverride() : { enabled:false, ms:0, freeze:true, setAt:0, scope:'sa_only' };
          draft = {
            enabled: !!o.enabled,
            ms: Number(o.ms)||0,
            freeze: (o.freeze !== false),
            setAt: Number(o.setAt)||0,
            scope: (String(o.scope||'sa_only') === 'global') ? 'global' : 'sa_only',
          };
          // FIX[EPOCH-BUG]: Guarantee draft.ms is always a valid (post-2020) timestamp.
          // Store may return ms:0 (epoch) when no override has been set or after a reset.
          if(!draft.ms || draft.ms <= MIN_VALID_OVERRIDE_MS) draft.ms = Date.now();
          if(!draft.freeze && !draft.setAt) draft.setAt = Date.now();
          render();
          startClock();
        }

        modal.__open = open;

        if(enabledEl){
          enabledEl.onchange = ()=>{
            draft.enabled = !!enabledEl.checked;
            if(draft.enabled && !draft.ms) draft.ms = Date.now();
            if(draft.enabled && !draft.freeze) draft.setAt = Date.now();
            render();
          };
        }
        if(freezeEl){
          freezeEl.onchange = ()=>{
            draft.freeze = !!freezeEl.checked;
            if(!draft.freeze) draft.setAt = Date.now();
            else draft.setAt = 0;
            render();
          };
        }
        if(inputEl){
          // INPUT EVENT FIX: datetime-local fires 'input' on every scroll/keypress
          // but 'change' only on blur. We need both so draft.ms updates immediately
          // when user scrolls the hour/minute column in the picker.
          const _onInputChange = ()=>{
            const ms = parseManilaLocal(inputEl.value);
            // FIX[EPOCH-BUG]: Only accept parsed ms if it's a real post-2020 timestamp.
            // parseManilaLocal returns 0 for empty/invalid input — must not write 0 into draft.
            if(ms && ms > MIN_VALID_OVERRIDE_MS){
              draft.ms = ms;
              if(draft.enabled && !draft.freeze) draft.setAt = Date.now();
            }
            // Don't call render() from inside input event — it will overwrite the picker
          };
          inputEl.onchange = ()=>{
            _onInputChange();
            render(); // safe on change (picker has committed)
          };
          inputEl.oninput = _onInputChange; // update draft silently, no render()
          // FOCUS PROTECTION: While the picker is open, completely block render()
          // from overwriting inputEl.value — the 1-second clock ticker calls render()
          // every second which fights with the user's active picker selection.
          inputEl.onfocus = ()=>{ inputEl.__userEditing = true; };
          inputEl.onblur  = ()=>{
            inputEl.__userEditing = false;
            // Commit whatever value is in the picker on blur
            const ms = parseManilaLocal(inputEl.value);
            if(ms && ms > MIN_VALID_OVERRIDE_MS){
              draft.ms = ms;
              if(draft.enabled && !draft.freeze) draft.setAt = Date.now();
            }
            render();
          };
        }

        if(scopeEl){
          scopeEl.onchange = ()=>{
            const v = String(scopeEl.value||'sa_only');
            draft.scope = (v === 'global') ? 'global' : 'sa_only';
            render();
          };
        }

        if(setNowBtn){
          setNowBtn.onclick = ()=>{
            draft.ms = Date.now();
            if(draft.enabled && !draft.freeze) draft.setAt = Date.now();
            render();
          };
        }

        modal.querySelectorAll('[data-mbshift]').forEach(btn=>{
          btn.onclick = ()=>{
            const delta = Number(btn.getAttribute('data-mbshift')||0);
            // FIX[EPOCH-BUG]: If draft.ms is epoch/invalid, start from now before shifting.
            draft.ms = (Number(draft.ms) > MIN_VALID_OVERRIDE_MS) ? Number(draft.ms) : Date.now();
            draft.ms += delta;
            if(draft.enabled && !draft.freeze) draft.setAt = Date.now();
            render();
          };
        });

        if(saveBtn){
          saveBtn.onclick = ()=>{
            try{ if(errEl) errEl.textContent=''; }catch(_){ }
            if(!draft.enabled){
              // FIX[GHOST-OVERRIDE-PERMANENT]: Always propagate to BOTH global AND superadmin
              // scopes on the server, regardless of what draft.scope shows.
              // The DB may have scope='global' while draft loaded with stale 'sa_only'.
              // Clearing both scopes is safe (idempotent) and ensures the DB is always clean.
              if(Store.disableMailboxTimeOverride){
                Store.disableMailboxTimeOverride({ propagateGlobal:true, forceScope:'global' });
              } else {
                Store.saveMailboxTimeOverride({ enabled:false, ms:0, freeze:true, setAt:0, scope:'sa_only' });
              }
              try{
                if(window.UI && UI.toast) UI.toast('Mailbox time override removed. System Manila time is now active.', 'success');
              }catch(_){ }
              try{ draft = Store.getMailboxTimeOverride ? Store.getMailboxTimeOverride() : draft; }catch(_){ }
              // FIX[EPOCH-BUG]: After disabling, Store returns ms:0. Reset to now for clean input display.
              if(!draft.ms || draft.ms <= MIN_VALID_OVERRIDE_MS) draft.ms = Date.now();
              render();
              return;
            }
            // FIX[EPOCH-BUG]: Reject epoch/zero ms even if draft guard somehow missed it.
            // SAVE INPUT FIX: Also try reading inputEl.value directly — if the picker scrolled
            // but 'change'/'input' didn't fire (browser-specific), draft.ms may be stale.
            // Reading the input value at Save time is the last-resort authoritative source.
            if(!draft.ms || draft.ms <= MIN_VALID_OVERRIDE_MS){
              try{
                if(inputEl && inputEl.value){
                  const fromInput = parseManilaLocal(inputEl.value);
                  if(fromInput && fromInput > MIN_VALID_OVERRIDE_MS) draft.ms = fromInput;
                }
              }catch(_){}
            }
            if(!draft.ms || draft.ms <= MIN_VALID_OVERRIDE_MS){
              if(errEl) errEl.textContent = 'Please select a valid Manila date & time.';
              return;
            }
            const payload = { enabled:true, ms: Number(draft.ms)||0, freeze: !!draft.freeze, scope: (draft.scope==='global'?'global':'sa_only') };
            if(!draft.freeze) payload.setAt = Number(draft.setAt)||Date.now();
            const saved = Store.saveMailboxTimeOverride(payload);
            try{ draft = Object.assign({}, draft, saved||{}); }catch(_){ }
            try{
              const scopeLbl = (String(draft.scope||'sa_only') === 'global') ? 'Global' : 'Super Admin';
              if(window.UI && UI.toast) UI.toast(`Mailbox time override applied (${scopeLbl} scope).`, 'success');
            }catch(_){ }
            // OVERRIDE REALTIME FIX: Force-dispatch so mailbox page re-renders immediately
            // without requiring a page refresh — covers same-tab save for both global & sa_only.
            try{ window.dispatchEvent(new CustomEvent('mums:store', { detail:{ key:'mailbox_override_cloud', source:'local', reason:'save' } })); }catch(_){}
            try{ window.dispatchEvent(new CustomEvent('mums:store', { detail:{ key:'mailbox_time_override', source:'local', reason:'save' } })); }catch(_){}
            render();
          };
        }

        if(resetBtn){
          resetBtn.onclick = ()=>{
            // FIX[GHOST-OVERRIDE-PERMANENT]: Always clear BOTH global and superadmin scopes.
            if(Store.disableMailboxTimeOverride){
              Store.disableMailboxTimeOverride({ propagateGlobal:true, forceScope:'global' });
            } else {
              Store.saveMailboxTimeOverride({ enabled:false, ms:0, freeze:true, setAt:0, scope:'sa_only' });
            }
            draft = Store.getMailboxTimeOverride ? Store.getMailboxTimeOverride() : {};
            try{ if(window.UI && UI.toast) UI.toast('Mailbox time override removed. System Manila time is now active.', 'success'); }catch(_){ }
            // FIX[EPOCH-BUG]: Ensure draft.ms is never epoch after reset.
            if(!draft.ms || draft.ms <= MIN_VALID_OVERRIDE_MS) draft.ms = Date.now();
            // OVERRIDE REALTIME FIX: Force-dispatch so mailbox page removes banner immediately.
            try{ window.dispatchEvent(new CustomEvent('mums:store', { detail:{ key:'mailbox_override_cloud', source:'local', reason:'reset' } })); }catch(_){}
            try{ window.dispatchEvent(new CustomEvent('mums:store', { detail:{ key:'mailbox_time_override', source:'local', reason:'reset' } })); }catch(_){}
            render();
          };
        }

        UI.els('[data-close="mailboxTimeModal"]').forEach(b=>b.onclick=()=>{ stopClock(); UI.closeModal('mailboxTimeModal'); });

        // FIX[BUG#3]: Patch UI.closeModal to always call stopClock when mailboxTimeModal closes.
        // Previously only data-close buttons stopped the clock — programmatic closes leaked the interval.
        // We store stopClock on the modal element so any close path can access it.
        modal.__stopClock = stopClock;
        if(!window.__mumsMailboxTimeClosePatched){
          window.__mumsMailboxTimeClosePatched = true;
          const _origClose = UI.closeModal.bind(UI);
          UI.closeModal = function(id){
            if(id === 'mailboxTimeModal'){
              try{
                const m = document.getElementById('mailboxTimeModal');
                if(m && typeof m.__stopClock === 'function') m.__stopClock();
              }catch(_){}
            }
            return _origClose(id);
          };
        }
      }

      try{
        if(!window.__mumsMailboxOverrideRealtimeToastBound){
          window.__mumsMailboxOverrideRealtimeToastBound = true;
          window.addEventListener('mums:realtime_alert', (ev)=>{
            try{
              const row = ev && ev.detail ? ev.detail : null;
              if(!row) return;
              const action = String(row.action||'').toLowerCase();
              const scope = String(row.scope||'').toLowerCase();
              if(!['set','reset','freeze'].includes(action)) return;
              if(!['global','superadmin'].includes(scope)) return;
              const actor = String(row.actor_name || row.updated_by_name || 'System');
              const scopeLbl = (scope === 'global') ? 'Global' : 'Super Admin';
              let msg = `${scopeLbl} mailbox time override was updated by ${actor}.`;
              if(action === 'reset') msg = `${scopeLbl} mailbox time override was removed by ${actor}.`;
              else if(action === 'freeze') msg = `${scopeLbl} mailbox time override mode changed by ${actor}.`;
              if(window.UI && UI.toast) UI.toast(msg, 'info');
            }catch(_){ }
          });
        }
      }catch(_){ }

      if(openMailboxTimeBtn){
        bindMailboxTimeModal();
        openMailboxTimeBtn.onclick = ()=>{
          const active = isGlobalOverrideActive();
          if(!isSA && !active){
            try{ UI.toast && UI.toast('Global mailbox override is not active.', 'warn'); }catch(_){ }
            return;
          }
          try{ if(modal && typeof modal.__open === 'function') modal.__open(); }catch(_){ }
        };
      }

    }catch(e){ console.error('Mailbox time override init error', e); }

    const openClocksBtn = document.getElementById('openClocksBtn');
    if(openClocksBtn){
      openClocksBtn.onclick = ()=>{};
    }

    const openGmtOverviewPageBtn = document.getElementById('openGmtOverviewPageBtn');
    if(openGmtOverviewPageBtn){
      openGmtOverviewPageBtn.onclick = ()=>{ window.location.hash = '#gmt_overview'; };
    }

    // Helper: show admin section header + row when any admin card is visible
    function _revealAdminSection(){
      try{
        const lbl = document.getElementById('stngsAdminLabel');
        const row = document.getElementById('stngsAdminRow');
        if(lbl) lbl.style.display = '';
        if(row) row.style.display = '';
      }catch(_){}
    }

    try{
      const sysCard = document.getElementById('systemCheckCard');
      const openSysBtn = document.getElementById('openSystemCheckBtn');
      if(sysCard && (isSA || isSU)){ sysCard.style.display = ''; _revealAdminSection(); }
      if(openSysBtn && (isSA || isSU)){
        bindSystemCheckModal(user);
        openSysBtn.onclick = ()=>{ try{ if(window.__mumsSystemCheck && typeof window.__mumsSystemCheck.reset === 'function') window.__mumsSystemCheck.reset(); }catch(_){ } };
      }
    }catch(_){ }

    // ── Global Quickbase Settings (Super Admin only) ──────────────────────────
    try {
      if (isSA) {
        const gqbCard = document.getElementById('globalQbSettingsCard');
        const openGqbBtn = document.getElementById('openGlobalQbSettingsBtn');
        if (gqbCard) { gqbCard.style.display = ''; _revealAdminSection(); }

        function parseQbLink(url) {
          const out = { realm: '', tableId: '', qid: '' };
          try {
            const u = new URL(url);
            const host = u.hostname;
            const m = host.match(/^([a-z0-9-]+)\.quickbase\.com$/i);
            if (m) out.realm = m[1] + '.quickbase.com';
            // Handle /db/<tableId> format
            const dbm = u.pathname.match(/\/db\/([a-zA-Z0-9]+)/);
            if (dbm) out.tableId = dbm[1];
            // Handle /nav/app/<appId>/table/<tableId>/... format
            const navM = u.pathname.match(/\/table\/([a-zA-Z0-9]+)/);
            if (!out.tableId && navM) out.tableId = navM[1];
            else if (navM) out.tableId = navM[1]; // /table/ is more specific
            // QID from ?qid= or ?a=q&qid= params
            out.qid = u.searchParams.get('qid') || u.searchParams.get('QID') || '';
          } catch (_) {}
          return out;
        }

        let gqbState = { reportLink:'', realm:'', tableId:'', qid:'', qbToken:'', customColumns:[], filterConfig:[], filterMatch:'ALL' };
        let gqbAvailableFields = [];
        let gqbActiveTab = 'report-config';

        function gqbShowTab(tab) {
          gqbActiveTab = tab;
          ['report-config','custom-columns','filter-config'].forEach(t => {
            const sec = document.getElementById('gqbSection-' + t);
            if (sec) sec.style.display = (t === tab) ? '' : 'none';
            const btn = document.querySelector('[data-gqb-tab="' + t + '"]');
            if (btn) {
              btn.style.borderBottom = (t === tab) ? '2px solid var(--primary)' : '2px solid transparent';
              btn.style.color = (t === tab) ? 'var(--primary)' : '';
              btn.classList.toggle('active', t === tab);
            }
          });
          if (tab === 'custom-columns') renderGqbColumns();
          if (tab === 'filter-config') renderGqbFilters();
        }

        // ── Column Grid (matches existing QB settings style) ──────────────────
        function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

        function renderGqbSelectedPanel() {
          const panel = document.getElementById('gqbSelectedFloatingPanel');
          const list = document.getElementById('gqbSelectedFloatingList');
          if (!panel || !list) return;
          if (!gqbState.customColumns.length) { panel.style.display = 'none'; list.innerHTML = ''; return; }
          const byId = new Map(gqbAvailableFields.map(f => [String(f.id), String(f.label || 'Field #' + f.id)]));
          list.innerHTML = gqbState.customColumns.map((id, idx) =>
            `<div style="display:flex;gap:8px;align-items:flex-start;"><span style="min-width:18px;color:#38bdf8;font-weight:700;">${idx+1}.</span><span>${esc(byId.get(String(id)) || 'Field #'+id)}</span></div>`
          ).join('');
          panel.style.display = 'block';
        }

        function applyGqbColumnSearch() {
          const input = document.getElementById('gqbColumnSearch');
          const query = String(input && input.value || '').trim().toLowerCase();
          document.querySelectorAll('#gqbColumnGrid .qb-col-card').forEach(card => {
            const hay = String(card.getAttribute('data-col-label') || '').toLowerCase();
            card.style.display = !query || hay.includes(query) ? 'flex' : 'none';
          });
        }

        function renderGqbColumns() {
          const grid = document.getElementById('gqbColumnGrid');
          if (!grid) return;
          if (!gqbAvailableFields.length) {
            grid.innerHTML = '<div class="small muted" style="padding:16px;text-align:center">Load Report Config first to populate columns.</div>';
            renderGqbSelectedPanel(); return;
          }
          const selectedById = new Map();
          gqbState.customColumns.forEach((id, idx) => selectedById.set(String(id), idx + 1));
          grid.innerHTML = gqbAvailableFields.map(f => {
            const id = String(f.id); const order = selectedById.get(id);
            const label = String(f.label || 'Field #' + id);
            return `<button type="button" data-col-id="${esc(id)}" data-col-label="${esc(label+' #'+id)}" class="qb-col-card" style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 10px;border-radius:10px;border:1px solid ${order?'rgba(56,189,248,.72)':'rgba(148,163,184,.25)'};background:${order?'rgba(14,116,144,.45)':'rgba(15,23,42,.45)'};color:inherit;cursor:pointer;text-align:left;min-height:40px;">
              <span class="small" style="font-weight:${order?'700':'500'};">${esc(label)} <span class="muted">(#${esc(id)})</span></span>
              ${order ? `<span style="display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;padding:0 7px;border-radius:999px;background:rgba(14,165,233,.22);border:1px solid rgba(56,189,248,.55);font-size:12px;font-weight:700;">${order}</span>` : ''}
            </button>`;
          }).join('');
          applyGqbColumnSearch();
          renderGqbSelectedPanel();
          grid.querySelectorAll('.qb-col-card').forEach(el => {
            el.addEventListener('click', () => {
              const id = String(el.getAttribute('data-col-id') || '').trim();
              if (!id) return;
              const numId = Number(id);
              const idx = gqbState.customColumns.indexOf(numId);
              if (idx === -1) gqbState.customColumns.push(numId);
              else gqbState.customColumns.splice(idx, 1);
              renderGqbColumns();
            });
          });
        }

        const gqbColSearch = document.getElementById('gqbColumnSearch');
        if (gqbColSearch) gqbColSearch.oninput = applyGqbColumnSearch;

        // ── Filter Rows (matches existing QB settings style) ───────────────────
        function gqbFilterRowTemplate(f, idx) {
          const knownFields = gqbAvailableFields.slice();
          const selFid = String(f.fieldId || '').trim();
          if (selFid && !knownFields.some(x => String(x.id) === selFid)) {
            knownFields.unshift({ id: selFid, label: 'Field #' + selFid });
          }
          const fieldOpts = knownFields.map(x =>
            `<option value="${esc(String(x.id))}" ${String(f.fieldId) === String(x.id) ? 'selected' : ''}>${esc(x.label)} (#${esc(String(x.id))})</option>`
          ).join('');
          const v = String(f.value || '').trim();
          return `<div class="row" data-gqb-filter-idx="${idx}" style="gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px;">
            <select class="input" data-gf="fieldId" style="max-width:300px;"><option value="">Select field</option>${fieldOpts}</select>
            <select class="input" data-gf="operator" style="max-width:140px;">
              <option value="EX"  ${f.operator==='EX'  ?'selected':''}>Is (Exact)</option>
              <option value="XEX" ${f.operator==='XEX' ?'selected':''}>Is Not</option>
              <option value="CT"  ${f.operator==='CT'  ?'selected':''}>Contains</option>
              <option value="XCT" ${f.operator==='XCT' ?'selected':''}>Does Not Contain</option>
              <option value="SW"  ${f.operator==='SW'  ?'selected':''}>Starts With</option>
              <option value="XSW" ${f.operator==='XSW' ?'selected':''}>Does Not Start With</option>
              <option value="BF"  ${f.operator==='BF'  ?'selected':''}>Before</option>
              <option value="AF"  ${f.operator==='AF'  ?'selected':''}>After</option>
            </select>
            <input type="text" class="input" data-gf="value" value="${esc(v)}" placeholder="Filter value" style="min-width:200px;" />
            <button class="btn" data-gqb-remove-filter="${idx}" type="button">Remove</button>
          </div>`;
        }

        function renderGqbFilters() {
          const container = document.getElementById('gqbFilterRows');
          if (!container) return;
          const filters = Array.isArray(gqbState.filterConfig) ? gqbState.filterConfig : [];
          container.innerHTML = filters.length
            ? filters.map((f, i) => gqbFilterRowTemplate(f, i)).join('')
            : '<div class="small muted">No global filters configured. Click + Add Filter.</div>';

          container.querySelectorAll('[data-gqb-filter-idx]').forEach(row => {
            const idx = Number(row.getAttribute('data-gqb-filter-idx'));
            row.querySelectorAll('[data-gf]').forEach(input => {
              const key = input.getAttribute('data-gf');
              input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', () => {
                if (!gqbState.filterConfig[idx]) return;
                gqbState.filterConfig[idx][key] = String(input.value || '').trim();
              });
            });
          });
          container.querySelectorAll('[data-gqb-remove-filter]').forEach(btn => {
            btn.onclick = () => {
              gqbState.filterConfig.splice(Number(btn.getAttribute('data-gqb-remove-filter')), 1);
              renderGqbFilters();
            };
          });
          const fm = document.getElementById('gqbFilterMatch');
          if (fm) fm.value = gqbState.filterMatch || 'ALL';
        }

        async function loadGqbSettings() {
          try {
            const tok = getBearerToken();
            const r = await fetch('/api/settings/global_quickbase', { headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' } });
            const d = await r.json();
            if (d.ok && d.settings) {
              gqbState = { ...gqbState, ...d.settings, customColumns: Array.isArray(d.settings.customColumns) ? d.settings.customColumns : [], filterConfig: Array.isArray(d.settings.filterConfig) ? d.settings.filterConfig : [] };
              const rl = document.getElementById('gqbReportLink'); if (rl) rl.value = gqbState.reportLink;
              const rv = document.getElementById('gqbRealm'); if (rv) rv.value = gqbState.realm;
              const tv = document.getElementById('gqbTableId'); if (tv) tv.value = gqbState.tableId;
              const qv = document.getElementById('gqbQid'); if (qv) qv.value = gqbState.qid;
              const tok2 = document.getElementById('gqbToken'); if (tok2) tok2.value = gqbState.qbToken || '';
              const fm = document.getElementById('gqbFilterMatch'); if (fm) fm.value = gqbState.filterMatch || 'ALL';
            }
          } catch (_) {}
        }

        async function fetchGqbFields() {
          if (!gqbState.realm || !gqbState.tableId || !gqbState.qbToken) return;
          try {
            const tok = getBearerToken();
            const params = new URLSearchParams({ realm: gqbState.realm, tableId: gqbState.tableId, qid: gqbState.qid || '1' });
            const r = await fetch('/api/quickbase/monitoring?' + params.toString(), { headers: { 'Authorization': 'Bearer ' + tok } });
            const d = await r.json();
            if (d.allAvailableFields && Array.isArray(d.allAvailableFields)) {
              gqbAvailableFields = d.allAvailableFields;
              renderGqbColumns(); // always update since fields just loaded
            }
          } catch (_) {}
        }

        const rlInput = document.getElementById('gqbReportLink');
        if (rlInput) {
          rlInput.oninput = () => {
            const parsed = parseQbLink(rlInput.value.trim());
            gqbState.reportLink = rlInput.value.trim();
            gqbState.realm = parsed.realm; gqbState.tableId = parsed.tableId; gqbState.qid = parsed.qid;
            const rv = document.getElementById('gqbRealm'); if (rv) rv.value = parsed.realm;
            const tv = document.getElementById('gqbTableId'); if (tv) tv.value = parsed.tableId;
            const qv = document.getElementById('gqbQid'); if (qv) qv.value = parsed.qid;
          };
        }
        const tokInput = document.getElementById('gqbToken');
        if (tokInput) tokInput.oninput = () => { gqbState.qbToken = tokInput.value.trim(); };

        document.querySelectorAll('[data-gqb-tab]').forEach(btn => {
          btn.onclick = () => {
            const targetTab = btn.dataset.gqbTab;
            // Auto-fetch fields when switching to Custom Columns or Filter Config
            if (targetTab === 'custom-columns' || targetTab === 'filter-config') {
              if (!gqbAvailableFields.length) fetchGqbFields();
            }
            gqbShowTab(targetTab);
          };
        });

        const addFilterBtn = document.getElementById('gqbAddFilterBtn');
        if (addFilterBtn) addFilterBtn.onclick = () => {
          if (!Array.isArray(gqbState.filterConfig)) gqbState.filterConfig = [];
          gqbState.filterConfig.push({ fieldId: '', operator: 'EX', value: '' });
          renderGqbFilters();
          // Scroll to bottom of filter rows
          const fr = document.getElementById('gqbFilterRows');
          if (fr) fr.scrollTop = fr.scrollHeight;
        };

        const gqbFmSel = document.getElementById('gqbFilterMatch');
        if (gqbFmSel) gqbFmSel.onchange = () => { gqbState.filterMatch = gqbFmSel.value || 'ALL'; };

        const saveBtn = document.getElementById('gqbSaveBtn');
        if (saveBtn) saveBtn.onclick = async () => {
          const msg = document.getElementById('gqbSaveMsg');
          try {
            const tok = getBearerToken();
            const r = await fetch('/api/settings/global_quickbase', {
              method: 'POST',
              headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' },
              body: JSON.stringify(gqbState)
            });
            const d = await r.json();
            if (msg) { msg.textContent = d.ok ? '✅ Saved!' : '❌ ' + (d.message || 'Error'); msg.style.opacity = '1'; setTimeout(()=>{ msg.style.opacity='0'; }, 3000); }
          } catch (e) {
            if (msg) { msg.textContent = '❌ Network error'; msg.style.opacity = '1'; setTimeout(()=>{ msg.style.opacity='0'; }, 3000); }
          }
        };

        document.querySelectorAll('[data-close="globalQbModal"]').forEach(b => b.onclick = () => { UI.closeModal('globalQbModal'); });

        window.__mumsLoadGqbSettings = loadGqbSettings;
        if (openGqbBtn) openGqbBtn.onclick = async () => {
          await loadGqbSettings();
          gqbShowTab('report-config');
          // Auto-fetch fields in background so columns are ready when user switches tab
          if (gqbState.realm && gqbState.tableId) setTimeout(() => fetchGqbFields(), 300);
        };
      }
    } catch (_) {}

    // ── Manila Calendar Settings (Super Admin only) ──────────────────────────
    try {
      if (isSA) {
        const calCard = document.getElementById('calendarSettingsCard');
        const calOpenBtn = document.getElementById('openCalendarSettingsBtn');
        if (calCard) { calCard.style.display = ''; _revealAdminSection(); }

        function parseCalLink(url) {
          const out = { realm: '', tableId: '', qid: '' };
          try {
            const u = new URL(url);
            const host = u.hostname;
            const m = host.match(/^([a-z0-9-]+)\.quickbase\.com$/i);
            if (m) out.realm = m[1] + '.quickbase.com';
            const navM = u.pathname.match(/\/table\/([a-zA-Z0-9]+)/);
            if (navM) out.tableId = navM[1];
            out.qid = u.searchParams.get('qid') || u.searchParams.get('QID') || '';
          } catch (_) {}
          return out;
        }

        async function loadCalSettings() {
          try {
            const tok = getBearerToken();
            const r = await fetch('/api/settings/global_calendar', { headers: { 'Authorization': 'Bearer ' + tok } });
            const d = await r.json();
            if (d.ok && d.settings) {
              const s = d.settings;
              const el = (id) => document.getElementById(id);
              if (el('calRL')) el('calRL').value = s.reportLink || '';
              if (el('calRealm')) el('calRealm').value = s.realm || '';
              if (el('calTableId')) el('calTableId').value = s.tableId || '';
              if (el('calQid')) el('calQid').value = s.qid || '';
              if (el('calToken')) el('calToken').value = s.qbToken ? '••••••••••••••' : '';
              if (el('calFEmployee')) el('calFEmployee').value = s.fieldEmployee || '';
              if (el('calFNote')) el('calFNote').value = s.fieldNote || '';
              if (el('calFStart')) el('calFStart').value = s.fieldStartDate || '';
              if (el('calFEnd')) el('calFEnd').value = s.fieldEndDate || '';
            }
          } catch (_) {}
        }

        const calRLInput = document.getElementById('calRL');
        if (calRLInput) {
          calRLInput.oninput = () => {
            const p = parseCalLink(calRLInput.value.trim());
            const el = (id) => document.getElementById(id);
            if (el('calRealm')) el('calRealm').value = p.realm;
            if (el('calTableId')) el('calTableId').value = p.tableId;
            if (el('calQid')) el('calQid').value = p.qid;
          };
        }

        const calSaveBtn = document.getElementById('calSaveBtn');
        if (calSaveBtn) {
          calSaveBtn.onclick = async () => {
            const el = (id) => document.getElementById(id);
            const msg = el('calSaveMsg');
            const rawToken = el('calToken') ? el('calToken').value.trim() : '';
            const payload = {
              reportLink: el('calRL') ? el('calRL').value.trim() : '',
              realm: el('calRealm') ? el('calRealm').value.trim() : '',
              tableId: el('calTableId') ? el('calTableId').value.trim() : '',
              qid: el('calQid') ? el('calQid').value.trim() : '',
              fieldEmployee: el('calFEmployee') ? el('calFEmployee').value.trim() : '',
              fieldNote: el('calFNote') ? el('calFNote').value.trim() : '',
              fieldStartDate: el('calFStart') ? el('calFStart').value.trim() : '',
              fieldEndDate: el('calFEnd') ? el('calFEnd').value.trim() : '',
            };
            // Only send token if user actually changed it (not the masked placeholder)
            if (rawToken && !rawToken.startsWith('•')) payload.qbToken = rawToken;
            try {
              calSaveBtn.disabled = true;
              calSaveBtn.textContent = 'Saving…';
              const tok = getBearerToken();
              const r = await fetch('/api/settings/global_calendar', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
              });
              const d = await r.json();
              if (msg) { msg.textContent = d.ok ? '✅ Saved!' : '❌ ' + (d.message || 'Error'); msg.style.opacity = '1'; setTimeout(() => { msg.style.opacity = '0'; }, 3000); }
            } catch (e) {
              if (msg) { msg.textContent = '❌ Network error'; msg.style.opacity = '1'; setTimeout(() => { msg.style.opacity = '0'; }, 3000); }
            } finally {
              calSaveBtn.disabled = false;
              calSaveBtn.textContent = 'Save Calendar Settings';
            }
          };
        }

        document.querySelectorAll('[data-close="calendarSettingsModal"]').forEach(b => b.onclick = () => { UI.closeModal('calendarSettingsModal'); });

        window.__mumsLoadCalSettings = loadCalSettings;
        if (calOpenBtn) calOpenBtn.onclick = async () => {
          await loadCalSettings();
        };
      }
    } catch (_) {}

        // ── Login Mode Control (Super Admin only) ─────────────────────────────────
    try{
      if(isSA){
        const lmCard    = document.getElementById('msp_loginmode') || document.getElementById('loginModeCard');
        const lmStatus  = document.getElementById('loginModeStatus');
        const lmSaveBtn = document.getElementById('saveLoginModeBtn');
        const lmSaveMsg = document.getElementById('loginModeSaveMsg');
        const lmRadios  = ()=> document.querySelectorAll('input[name="loginModeChoice"]');
        const lmOptLabels = { both: document.getElementById('loginModeOpt_both'), password: document.getElementById('loginModeOpt_password'), microsoft: document.getElementById('loginModeOpt_microsoft') };

        if(lmCard){ lmCard.style.display = ''; _revealAdminSection(); }

        // Highlight active option label
        const highlightSelected = (mode) => {
          ['both','password','microsoft'].forEach(m => {
            const lbl = lmOptLabels[m];
            if(!lbl) return;
            if(m === mode){
              lbl.style.background = 'rgba(37,99,235,.10)';
              lbl.style.borderColor = 'rgba(37,99,235,.30)';
            } else {
              lbl.style.background = '';
              lbl.style.borderColor = 'transparent';
            }
          });
        };

        const modeLabels = { both: 'Both (Microsoft + Password)', password: 'Password only', microsoft: 'Microsoft OAuth only' };

        // Load current setting from server
        window.__mumsLoadLoginMode = window.__mumsLoadLoginMode || null;
        const loadLoginMode = async () => {
          if(lmStatus) lmStatus.textContent = 'Loading…';
          try{
            const jwt = (window.CloudAuth && CloudAuth.accessToken) ? CloudAuth.accessToken() : '';
            const r = await fetch('/api/settings/login_mode', {
              headers: jwt ? { Authorization: `Bearer ${jwt}` } : {}
            });
            const data = await r.json().catch(()=> ({}));
            const mode = (data && data.settings && data.settings.mode) ? data.settings.mode : 'both';
            // Set radio
            lmRadios().forEach(radio => { radio.checked = (radio.value === mode); });
            highlightSelected(mode);
            const updatedBy = (data && data.settings && data.settings.updatedByName) ? data.settings.updatedByName : null;
            const updatedAt = (data && data.settings && data.settings.updatedAt) ? new Date(data.settings.updatedAt).toLocaleString() : null;
            if(lmStatus){
              lmStatus.textContent = `Current: ${modeLabels[mode] || mode}` + (updatedBy ? ` — last changed by ${updatedBy}` : '') + (updatedAt ? ` on ${updatedAt}` : '');
            }
          }catch(e){
            if(lmStatus) lmStatus.textContent = 'Could not load setting.';
          }
        };

        // Highlight on radio change
        lmRadios().forEach(radio => {
          radio.addEventListener('change', () => { highlightSelected(radio.value); });
        });
        lmOptLabels['both'] && lmOptLabels['both'].addEventListener('click', () => highlightSelected('both'));
        lmOptLabels['password'] && lmOptLabels['password'].addEventListener('click', () => highlightSelected('password'));
        lmOptLabels['microsoft'] && lmOptLabels['microsoft'].addEventListener('click', () => highlightSelected('microsoft'));

        // Save
        if(lmSaveBtn){
          lmSaveBtn.addEventListener('click', async ()=>{
            const selected = [...lmRadios()].find(r => r.checked);
            if(!selected){ if(lmSaveMsg){ lmSaveMsg.textContent='Please select a mode.'; lmSaveMsg.style.opacity='1'; lmSaveMsg.style.color='var(--danger)'; setTimeout(()=>{ lmSaveMsg.style.opacity='0'; }, 2500); } return; }
            lmSaveBtn.disabled = true;
            lmSaveBtn.textContent = 'Saving…';
            try{
              const jwt = (window.CloudAuth && CloudAuth.accessToken) ? CloudAuth.accessToken() : '';
              const r = await fetch('/api/settings/login_mode', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
                body: JSON.stringify({ mode: selected.value })
              });
              const data = await r.json().catch(()=> ({}));
              if(r.ok && data && data.ok){
                if(lmSaveMsg){ lmSaveMsg.textContent = `✓ Saved: ${modeLabels[selected.value] || selected.value}`; lmSaveMsg.style.opacity='1'; lmSaveMsg.style.color='var(--success,#22c55e)'; setTimeout(()=>{ lmSaveMsg.style.opacity='0'; }, 3000); }
                await loadLoginMode();
              } else {
                const msg = (data && data.message) ? data.message : 'Save failed.';
                if(lmSaveMsg){ lmSaveMsg.textContent = '✗ ' + msg; lmSaveMsg.style.opacity='1'; lmSaveMsg.style.color='var(--danger)'; setTimeout(()=>{ lmSaveMsg.style.opacity='0'; }, 4000); }
              }
            }catch(e){
              if(lmSaveMsg){ lmSaveMsg.textContent = '✗ Network error.'; lmSaveMsg.style.opacity='1'; lmSaveMsg.style.color='var(--danger)'; setTimeout(()=>{ lmSaveMsg.style.opacity='0'; }, 4000); }
            }finally{
              lmSaveBtn.disabled = false;
              lmSaveBtn.textContent = 'Save';
            }
          });
        }

        // Load on settings modal open
        const settingsBtn2 = document.getElementById('settingsBtn');
        if(settingsBtn2 && !settingsBtn2.__lmBound){
          settingsBtn2.__lmBound = true;
          const origOnClick = settingsBtn2.onclick;
          settingsBtn2.addEventListener('click', ()=>{ loadLoginMode(); });
        }
        window.__mumsLoadLoginMode = loadLoginMode;
        loadLoginMode();
      }
    }catch(e){ console.error('[LoginMode]', e); }
    
    UI.els('[data-close="settingsModal"]').forEach(b=>b.onclick=()=>UI.closeModal('settingsModal'));
    UI.els('[data-close="systemCheckModal"]').forEach(b=>b.onclick=()=>UI.closeModal('systemCheckModal'));
    UI.els('[data-close="soundSettingsModal"]').forEach(b=>b.onclick=()=>UI.closeModal('soundSettingsModal'));

    UI.els('[data-close="profileModal"]').forEach(b=>b.onclick=()=>UI.closeModal('profileModal'));
    UI.els('[data-close="themeModal"]').forEach(b=>b.onclick=()=>UI.closeModal('themeModal'));
    UI.els('[data-close="linksModal"]').forEach(b=>b.onclick=()=>UI.closeModal('linksModal'));
    UI.els('[data-close="dataHealthModal"]').forEach(b=>b.onclick=()=>UI.closeModal('dataHealthModal'));
    
    UI.els('[data-close="clocksModal"]').forEach(b=>b.onclick=()=>{
      try{
        const grid = document.getElementById('clocksGrid');
        if(grid && typeof grid.__commitClocks === 'function') grid.__commitClocks();
      }catch(_){ }
      UI.closeModal('clocksModal');
      try{ refreshWorldClocksNow(); }catch(_){ }
    });

    const clocksSave = document.getElementById('clocksSave');
    if(clocksSave){
      clocksSave.onclick = ()=>{
        const grid = document.getElementById('clocksGrid');
        if(!grid) return;
        const next = Store.getWorldClocks();
        grid.querySelectorAll('.clock-card').forEach(card=>{
          const i = Number(card.dataset.idx||0);
          if(!next[i]) next[i] = {};
          const q = (sel)=>card.querySelector(sel);
          const alarmOn = !!q('.clk-alarmEnabled')?.checked;
          const alarmInput = q('.clk-alarm');
          next[i] = {
            enabled: !!q('.clk-enabled')?.checked,
            label: String(q('.clk-label')?.value||'').trim(),
            timeZone: parseClockZoneValue(String(q('.clk-tz')?.value||'Asia/Manila')).timeZone,
              offsetMinutes: parseClockZoneValue(String(q('.clk-tz')?.value||'Asia/Manila')).offsetMinutes,
            hoursColor: String(q('.clk-hc')?.value||'#EAF3FF'),
            minutesColor: String(q('.clk-mc')?.value||'#9BD1FF'),
            style: String(q('.clk-style')?.value||'classic'),
            alarmEnabled: alarmOn,
            alarmTime: alarmOn ? String(alarmInput?.value||'').trim() : '',
          };
        });
        try{ if(Store && Store.dispatch) Store.dispatch('UPDATE_CLOCKS', next); else Store.saveWorldClocks(next); }catch(_){ try{ Store.saveWorldClocks(next); }catch(__){} }
        refreshWorldClocksNow();
        UI.closeModal('clocksModal');
      };
    }

    try{ renderNav(user); }catch(e){ showFatalError(e); return; }
    try{ renderUserCard(user); }catch(e){ console.error(e); }
    try{ renderSideLogs(user); }catch(e){ console.error(e); }
    try{ renderRightNow(); }catch(e){ console.error(e); }

    window.addEventListener('hashchange', route);
    window.addEventListener('popstate', route);

    try{
      const proto = String(window.location.protocol||'');
      const pages = window.Pages || {};
      const hasHash = !!(window.location.hash && window.location.hash.length > 1);
      const path = _normalizeRoutePath(window.location.pathname||'/');
      const pathPageId = _routePageIdFromRoutePath(path);
      const hasPathPage = !!(proto !== 'file:' && pathPageId && !pathPageId.includes('.') && pages[pathPageId]);

      if(proto === 'file:'){
        if(!hasHash) window.location.hash = '#dashboard';
      }else{
        if(!hasHash && !hasPathPage){
          const p = String(window.location.pathname||'/');
          if(p === '/' || p.endsWith('.html')){
            try{ history.replaceState({},'', '/dashboard'); }catch(_){ }
          }
        }
      }
    }catch(_){ }

    try{ route(); }catch(e){ showFatalError(e); return; }

    try{ if(window.ReminderEngine) ReminderEngine.start(); }catch(e){ console.error(e); }

    try{ renderQuickLinksBar(); renderWorldClocksBar(); renderOnlineUsersBar(); }catch(e){ console.error(e); }

    try{ if(window.Store && Store.startPresence) Store.startPresence(user); }catch(e){ console.error(e); }
    try{ if(window.Store && Store.startMailboxOverrideSync) Store.startMailboxOverrideSync(); }catch(e){ console.error(e); }

    try{
      if(!window.__mumsOnlineBarTimer){
        window.__mumsOnlineBarTimer = setInterval(()=>{ try{ renderOnlineUsersBar(); }catch(_){ } }, 60000); // local render, no DB — 60s
      }
    }catch(_){ }

    window.Renderers = window.Renderers || {};
    window.Renderers.renderClocks = ()=>{ try{ renderWorldClocksBar(); }catch(_){ } try{ renderClocksPreviewStrip(); }catch(_){ } };
    window.Renderers.renderSidebarLogs = ()=>{
      try{
        const u = (window.Auth && Auth.getUser) ? Auth.getUser() : user;
        if(window.Components && Components.SidebarLogs) Components.SidebarLogs.render(u);
        else renderSideLogs(u);
      }catch(_){ }
    };
    window.Renderers.renderCoverageMeter = ()=>{ try{ if(window.Components && Components.CoverageMeter) Components.CoverageMeter.refresh(); }catch(_){ } };

    try{
      if(Store && Store.subscribe && !window.__mumsStoreSub){
        window.__mumsStoreSub = Store.subscribe((action)=>{
          const a = String(action||'');
          if(a === 'UPDATE_THEME' || a === 'UPDATE_CLOCKS' || a === 'UPDATE_QUICKLINKS'){
            try{ window.Renderers.renderClocks && window.Renderers.renderClocks(); }catch(_){ }
            try{ window.Renderers.renderCoverageMeter && window.Renderers.renderCoverageMeter(); }catch(_){ }
            try{ window.Renderers.renderSidebarLogs && window.Renderers.renderSidebarLogs(); }catch(_){ }
          }
        });
      }
    }catch(e){ console.error(e); }
    try{
      if(!window.__mumsClockTimer){
        window.__mumsClockTick = 0;
        window.__mumsClockTimer = setInterval(()=>{
          try{ updateWorldClocksTimes(); }catch(_){}
          try{ updateClocksPreviewTimes(); }catch(_){}
          try{
            window.__mumsClockTick = (window.__mumsClockTick||0) + 1;
            if(window.__mumsClockTick % 5 === 0){
              checkWorldClockAlarms();
            }
          }catch(_){}
        }, 1000);
      }
    }catch(e){ console.error(e); }
    
    try{ startAnnouncementRotation(); }catch(e){ console.error(e); }

    window.addEventListener('mums:theme', (e)=>{
      try{ applyTheme((e && e.detail && e.detail.id) || Store.getTheme()); }catch(_){}
    });

    try{
      if(!window.__mumsNavDelegated){
        window.__mumsNavDelegated = true;
        document.addEventListener('click', (e)=>{
          const a = e.target && e.target.closest ? e.target.closest('a.nav-item') : null;
          if(!a) return;
          const href = String(a.getAttribute('href')||'');
          if(!(href.startsWith('/') || href.startsWith('#'))) return;

          if(e.defaultPrevented) return;
          if(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          if(typeof e.button === 'number' && e.button !== 0) return;

          const pageId = _routePageIdFromHref(href);
          if(!pageId) return;

          e.preventDefault();
          if(href.startsWith('#') || String(window.location.protocol||'') === 'file:'){
            window.location.hash = '#' + pageId;
          }else{
            navigateToPageId(pageId);
          }
          try{ if(_isMobileViewport()) closeMobileDrawers(); }catch(_){ }
        });
      }
    }catch(_){ }
    window.addEventListener('mums:store', (e)=>{
      const key = e && e.detail && e.detail.key;
      if(key === 'mums_quicklinks' || key === 'mums_worldclocks'){
        try{ renderQuickLinksBar(); }catch(_){ }
        try{ refreshWorldClocksNow(); }catch(_){ }
      }
      if(key === 'mums_worldclocks'){
        try{ refreshWorldClocksNow(); }catch(_){ }
      }

      if(key === 'mums_online_users' || key === 'mums_attendance' || key === 'ums_user_profiles' || key === 'ums_users'){
        try{ renderOnlineUsersBar(); }catch(_){ }
      }

      if(key === 'ums_activity_logs'){
        try{ window.Renderers && Renderers.renderSidebarLogs && Renderers.renderSidebarLogs(); }catch(_){ }
      }
      if(key === 'ums_auto_schedule_settings' || key === 'ums_member_leaves' || key === 'ums_schedule_locks' || key === 'mums_schedule_lock_state'){
        try{ window.Renderers && Renderers.renderCoverageMeter && Renderers.renderCoverageMeter(); }catch(_){ }
      }
    });



    try{ if(notifCleanup) notifCleanup(); }catch(e){}
    try{ notifCleanup = UI.startScheduleNotifListener(user); }catch(e){ console.error(e); }

    UI.els('[data-close="topAnnModal"]').forEach(b=>b.onclick=()=>UI.closeModal('topAnnModal'));

    setInterval(()=>{ try{ renderSideLogs(Auth.getUser()||user); }catch(e){} }, 300000); // local render, no DB — 5min
    setInterval(()=>{ try{ renderUserCard(Auth.getUser()||user); }catch(e){} }, 60000);

    window.addEventListener('mums:store', ()=>{
      try{ renderUserCard(Auth.getUser()||user); }catch(e){}
    });

    // PERF-FIX-08: Register beforeunload cleanup for all persistent timers and realtime channels.
    // Prevents interval accumulation across browser tab restores + reduces Supabase channel leaks.
    if(!window.__mumsBeforeUnloadBound){
      window.__mumsBeforeUnloadBound = true;
      window.addEventListener('beforeunload', ()=>{
        try{ if(window.__mumsOnlineBarTimer){ clearInterval(window.__mumsOnlineBarTimer); window.__mumsOnlineBarTimer = null; } }catch(_){}
        try{ if(window.__mumsClockTimer){ clearInterval(window.__mumsClockTimer); window.__mumsClockTimer = null; } }catch(_){}
        try{ if(window.__mumsGmtOverviewTimer){ clearInterval(window.__mumsGmtOverviewTimer); window.__mumsGmtOverviewTimer = null; } }catch(_){}
        // Realtime channel cleanup — prevents ghost subscriptions after tab sleep/restore
        try{
          if(window.Realtime && typeof Realtime.destroy === 'function') Realtime.destroy();
          else if(window.__supabase && typeof window.__supabase.removeAllChannels === 'function') window.__supabase.removeAllChannels();
        }catch(_){}
      }, { once: false, passive: true });
    }

  } 



  window.App = { boot, renderLinksGrid, navigate: navigateToPageId };
  (function(){
    let started = false;
    function start(){
      if(started) return;
      started = true;
      try{ window.App && window.App.boot && window.App.boot(); }catch(e){ try{ console.error(e); }catch(_){} }
    }
    if(document.readyState === 'loading'){
      document.addEventListener('DOMContentLoaded', start);
    }else{
      setTimeout(start, 0);
    }
  })();
})();
