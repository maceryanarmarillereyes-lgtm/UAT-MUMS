/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

      (function() {
        'use strict';

        // ── Category metadata (loaded immediately, entries lazy) ──────
        const SR_CATS_INIT = [{"id":"e2e3_gateway","label":"E2 / E3 Gateway","icon":"fa-server","color":"#58a6ff","tags":["E2","E3","E300","Gateway","Onboarding"],"count":2471,"resolved":2258,"entries":1311},{"id":"connect_plus","label":"Connect+ / Network","icon":"fa-wifi","color":"#22d3ee","tags":["Connect+","VPN","Network","Offline","IP"],"count":1192,"resolved":1162,"entries":766},{"id":"programming","label":"Programming & Configuration","icon":"fa-code","color":"#a78bfa","tags":["Programming","PCR","Circuit","XR75"],"count":1940,"resolved":1771,"entries":1111},{"id":"temperature_haccp","label":"Temperature & HACCP","icon":"fa-thermometer-half","color":"#f97316","tags":["Temperature","HACCP","Probe","Food Safety"],"count":560,"resolved":554,"entries":466},{"id":"alarms","label":"Alarms & Alerts","icon":"fa-bell","color":"#f85149","tags":["Alarm","Alert","Azure","Proof Failure"],"count":1176,"resolved":1160,"entries":582},{"id":"floorplan_screens","label":"Floor Plans & Custom Screens","icon":"fa-layer-group","color":"#3fb950","tags":["Floor Plan","Custom Screen","Remapping","Widget"],"count":938,"resolved":866,"entries":730},{"id":"firmware","label":"Firmware & Software Updates","icon":"fa-microchip","color":"#d29922","tags":["Firmware","Software","Upgrade","Version"],"count":330,"resolved":327,"entries":266},{"id":"refrigeration","label":"Refrigeration & HVAC","icon":"fa-snowflake","color":"#60a5fa","tags":["Refrigeration","Rack","Compressor","Solenoid"],"count":1647,"resolved":1418,"entries":995},{"id":"password_credentials","label":"Passwords & Credentials","icon":"fa-key","color":"#fbbf24","tags":["Password","Daily Password","XWEB","Wizmate"],"count":424,"resolved":417,"entries":293},{"id":"controller_hardware","label":"Controllers & Hardware","icon":"fa-cogs","color":"#6ee7b7","tags":["Controller","License Key","XR75","CC200"],"count":2611,"resolved":2389,"entries":1557},{"id":"site_supervisor","label":"Site Supervisor","icon":"fa-desktop","color":"#e879f9","tags":["Site Supervisor","SS300","HMI","Display"],"count":736,"resolved":643,"entries":495},{"id":"data_reports","label":"Data, Reports & Exports","icon":"fa-chart-bar","color":"#818cf8","tags":["Reports","Data Export","API","Logs"],"count":371,"resolved":367,"entries":304},{"id":"parts_products","label":"Parts & Product Inquiries","icon":"fa-boxes","color":"#fb923c","tags":["Part Numbers","License Keys","XR75","CC200","XM679","RGA","Warranty"],"count":7502,"resolved":7502,"entries":5049,"subcats":[{"id":"parts_xr_controllers","label":"XR Case Controllers","icon":"fa-microchip","color":"#f97316","tags":["XR75","XR35","XR77","XR20","XR170","Dixell","Replacement"],"keywords":["xr75","xr35","xr77","xr20","xr170","xr60","dixell xr"],"count":490,"resolved":490,"entries":378},{"id":"parts_xm_controllers","label":"XM Controllers","icon":"fa-microchip","color":"#a78bfa","tags":["XM679","XM678","XM660","XM452","ADF File","Wiring"],"keywords":["xm679","xm678","xm660","xm452","xm67"],"count":245,"resolved":245,"entries":216},{"id":"parts_cc200","label":"CC200 Case Controllers","icon":"fa-th","color":"#22d3ee","tags":["CC200","CC100","PWM","BACnet","Solenoid","Relay"],"keywords":["cc200","cc100"],"count":569,"resolved":569,"entries":421},{"id":"parts_license_keys","label":"License Keys","icon":"fa-key","color":"#fbbf24","tags":["License Key","E2","E3","Sporlan","MAC Address","Job#"],"keywords":["license key","licence key","licensing key"],"count":1838,"resolved":1838,"entries":1134},{"id":"parts_rga_warranty","label":"RGA & Warranty Returns","icon":"fa-undo-alt","color":"#f85149","tags":["RGA","Warranty","Defective","Replacement","Credit Memo","Return"],"keywords":["rga","warranty","defective","replacement part","credit memo","return auth"],"count":728,"resolved":728,"entries":478},{"id":"parts_probes_sensors","label":"Probes, Sensors & Thermometers","icon":"fa-thermometer-half","color":"#3fb950","tags":["Probe","Sensor","Cooper-Atkins","HACCP","55032","37100","Defective"],"keywords":["probe","sensor","thermometer","cooper-atkins","cooper atkins","haccp manager","50014","55032","37100","50004"],"count":1106,"resolved":1106,"entries":845},{"id":"parts_sporlan_danfoss","label":"Sporlan / Danfoss / Alco Valves","icon":"fa-cog","color":"#60a5fa","tags":["Sporlan","Danfoss","Alco","EEV","Transducer","ESR Board"],"keywords":["sporlan","danfoss","alco","esr board","eev"],"count":331,"resolved":331,"entries":225},{"id":"parts_site_supervisor","label":"Site Supervisor Parts & Docs","icon":"fa-desktop","color":"#e879f9","tags":["SS300","818-7240","Display","HMI","Manual","Replacement"],"keywords":["site supervisor","ss300","ss1 ","818-7240","818-"],"count":418,"resolved":418,"entries":362},{"id":"parts_walmart_jobs","label":"Walmart Job Numbers (WM-NHM / WM-SUP)","icon":"fa-briefcase","color":"#6ee7b7","tags":["WM-NHM","WM-SUP","Job#","PCR","Programming","New Installation"],"keywords":["wm-nhm","wm-sup","job#","job #"],"count":951,"resolved":951,"entries":362},{"id":"parts_part_number_inquiry","label":"Part Number & Product Inquiry","icon":"fa-search","color":"#818cf8","tags":["Part Number","Model Number","P&A","Quote","SKU","Catalog"],"keywords":["part number","part no","p/n","model number","p & a","p&a","quote request","catalog number","ordering"],"count":826,"resolved":826,"entries":628}]}];

        let srFlat  = null;
        let srCats  = SR_CATS_INIT;
        let srLoaded   = false;
        let srQuery    = '';
        let srFilter   = null;   // active category id
        let srPage     = 0;
        let srView     = 'compact'; // 'compact' | 'detailed'
        const PAGE_SZ  = 50;
        let srCache    = [];     // filtered results cache

        const $ = id => document.getElementById(id);

        // ── INIT ───────────────────────────────────────────────────────
        window._srInit = function() {
          _srBuildSidebar(SR_CATS_INIT);
          _srBuildQuickList();
          _srBuildTagBar();
          _srShowWelcome(SR_CATS_INIT);

          const inp = $('sr-search-input');
          if (inp) {
            let timer;
            inp.addEventListener('input', function() {
              clearTimeout(timer);
              timer = setTimeout(() => {
                srQuery = this.value.trim();
                srPage  = 0;
                $('sr-clear-btn').style.display = srQuery ? 'block' : 'none';
                _srRender();
              }, 120);
            });
            inp.addEventListener('keydown', e => { if (e.key === 'Escape') window._srClear(); });
            setTimeout(() => inp.focus(), 80);
          }

          if (srLoaded) { _srRender(); return; }

          // Lazy load KB JSON
          fetch('/support_records_kb.json')
            .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
            .then(data => {
              srFlat  = data.flat;
              srCats  = data.cats;
              srLoaded = true;
              window.__studioSrRecords = Array.isArray(srFlat) ? srFlat.slice() : [];
              _srBuildSidebar(srCats);
              _srShowWelcome(srCats);
              _srRender();
            })
            .catch(err => {
              $('sr-loading').innerHTML = `
                <i class="fas fa-exclamation-circle" style="font-size:28px;color:#f85149;margin-bottom:10px;"></i>
                <div style="font-size:13px;color:var(--ss-muted);font-weight:600;">Could not load Support Records</div>
                <div style="font-size:11px;color:rgba(255,255,255,.25);margin-top:4px;">Place <code style="font-family:monospace;font-size:10px;">support_records_kb.json</code> in <code style="font-family:monospace;font-size:10px;">/public/</code></div>
                <button onclick="window._srInit()" style="margin-top:14px;background:rgba(168,85,247,.15);border:1px solid rgba(168,85,247,.35);color:#c084fc;padding:7px 18px;border-radius:6px;cursor:pointer;font-size:12px;font-family:var(--ss-font);">
                  <i class="fas fa-redo" style="margin-right:6px;"></i>Retry
                </button>`;
            });
        };

        // ── SIDEBAR ────────────────────────────────────────────────────
        function _srBuildSidebar(cats) {
          // Stats mini
          const sm = $('sr-stats-mini');
          if (sm) {
            const total    = cats.reduce((a,c) => a + c.count, 0);
            const resolved = cats.reduce((a,c) => a + c.resolved, 0);
            const entries  = cats.reduce((a,c) => a + c.entries, 0);
            const pct      = Math.round(resolved/total*100);
            sm.innerHTML = `
              <div style="background:rgba(63,185,80,.08);border:1px solid rgba(63,185,80,.15);border-radius:6px;padding:6px 8px;text-align:center;">
                <div style="font-size:14px;font-weight:800;color:#3fb950;">${pct}%</div>
                <div style="font-size:9px;color:rgba(255,255,255,.35);margin-top:1px;">Resolution</div>
              </div>
              <div style="background:rgba(168,85,247,.08);border:1px solid rgba(168,85,247,.15);border-radius:6px;padding:6px 8px;text-align:center;">
                <div style="font-size:14px;font-weight:800;color:#a78bfa;">${entries.toLocaleString()}</div>
                <div style="font-size:9px;color:rgba(255,255,255,.35);margin-top:1px;">KB Entries</div>
              </div>`;
          }

          // Category filter list
          const cf = $('sr-cat-filter');
          if (!cf) return;
          cf.innerHTML = '';

          // All button
          const allBtn = document.createElement('button');
          allBtn.className = 'sr-cat-btn';
          allBtn.dataset.cat = '';
          allBtn.innerHTML = `
            <span style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;">
              <span style="width:20px;height:20px;border-radius:5px;background:rgba(168,85,247,.15);border:1px solid rgba(168,85,247,.25);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                <i class="fas fa-th-large" style="font-size:9px;color:#a78bfa;"></i>
              </span>
              <span style="font-size:11px;color:#c084fc;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">All Categories</span>
            </span>
            <span style="font-size:9px;font-weight:700;color:#a78bfa;background:rgba(168,85,247,.12);border-radius:8px;padding:1px 6px;flex-shrink:0;">${cats.reduce((a,c)=>a+c.entries,0).toLocaleString()}</span>`;
          _styleAllBtn(allBtn, true);
          allBtn.onclick = () => window._srClearFilter();
          cf.appendChild(allBtn);

          // Separator
          const sep = document.createElement('div');
          sep.style.cssText = 'height:1px;background:rgba(255,255,255,.04);margin:4px 0;';
          cf.appendChild(sep);

          // Category buttons
          cats.forEach(cat => {
            const btn = document.createElement('button');
            btn.className = 'sr-cat-btn';
            btn.dataset.cat = cat.id;
            btn.innerHTML = `
              <span style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;">
                <span style="width:20px;height:20px;border-radius:5px;background:${cat.color}15;border:1px solid ${cat.color}28;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                  <i class="fas ${cat.icon}" style="font-size:9px;color:${cat.color};"></i>
                </span>
                <span style="font-size:11px;color:var(--ss-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">${cat.label}</span>
              </span>
              <span class="sr-cat-count" style="font-size:9px;font-weight:600;color:rgba(255,255,255,.25);background:rgba(255,255,255,.05);border-radius:8px;padding:1px 5px;flex-shrink:0;">${cat.entries}</span>`;
            btn.style.cssText = `width:100%;display:flex;align-items:center;justify-content:space-between;background:transparent;border:1px solid transparent;border-radius:6px;padding:5px 8px;cursor:pointer;font-family:var(--ss-font);transition:all .12s;text-align:left;`;
            btn.onmouseover = () => { if (srFilter !== cat.id) { btn.style.background='rgba(255,255,255,.04)'; btn.querySelector('.sr-cat-count').style.color='rgba(255,255,255,.5)'; } };
            btn.onmouseout  = () => { if (srFilter !== cat.id) { btn.style.background='transparent'; btn.querySelector('.sr-cat-count').style.color='rgba(255,255,255,.25)'; } };
            btn.onclick = () => window._srCatClick(cat.id, cat.label, cat.color);
            cf.appendChild(btn);
          });

          // Update result count
          const countEl = $('sr-result-count');
          if (countEl && !srFilter && !srQuery) {
            const total = cats.reduce((a,c)=>a+c.entries,0);
            countEl.textContent = total.toLocaleString() + ' Records';
          }
        }

        function _styleAllBtn(btn, active) {
          btn.style.cssText = `width:100%;display:flex;align-items:center;justify-content:space-between;background:${active?'rgba(168,85,247,.1)':'transparent'};border:1px solid ${active?'rgba(168,85,247,.25)':'transparent'};border-radius:6px;padding:5px 8px;cursor:pointer;font-family:var(--ss-font);transition:all .12s;text-align:left;`;
        }

        // ── QUICK SEARCHES ─────────────────────────────────────────────
        function _srBuildQuickList() {
          const el = $('sr-quick-list');
          if (!el) return;
          const searches = [
            { q: 'E2 firmware', icon: 'fa-server',        color: '#58a6ff' },
            { q: 'E3 onboarding', icon: 'fa-server',      color: '#58a6ff' },
            { q: 'connect+ offline', icon: 'fa-wifi',     color: '#22d3ee' },
            { q: 'daily password', icon: 'fa-key',        color: '#fbbf24' },
            { q: 'solenoid reverse', icon: 'fa-cog',      color: '#60a5fa' },
            { q: 'custom screen remap', icon: 'fa-layer-group', color: '#3fb950' },
            { q: 'vpn tunnel inactive', icon: 'fa-wifi',  color: '#22d3ee' },
            { q: 'pcr setpoint', icon: 'fa-code',         color: '#a78bfa' },
            { q: 'floor plan reset', icon: 'fa-layer-group', color: '#3fb950' },
            { q: 'license key', icon: 'fa-key',           color: '#fbbf24' },
            { q: 'XR75 replacement', icon: 'fa-microchip','color': '#f97316' },
            { q: 'CC200 solenoid', icon: 'fa-th',         color: '#22d3ee' },
            { q: 'proof failure alarm', icon: 'fa-bell',  color: '#f85149' },
            { q: 'RGA defective', icon: 'fa-undo-alt',    color: '#f85149' },
            { q: 'haccp temperature', icon: 'fa-thermometer-half', color: '#f97316' },
            { q: 'xweb password', icon: 'fa-key',         color: '#fbbf24' },
          ];
          el.innerHTML = searches.map(s => `
            <button onclick="window._srQuickSearch('${s.q}')"
              style="display:flex;align-items:center;gap:7px;width:100%;background:transparent;border:1px solid transparent;border-radius:5px;padding:4px 6px;cursor:pointer;font-family:var(--ss-font);transition:all .12s;text-align:left;"
              onmouseover="this.style.background='rgba(255,255,255,.04)';this.style.borderColor='rgba(255,255,255,.07)';"
              onmouseout="this.style.background='transparent';this.style.borderColor='transparent';">
              <i class="fas ${s.icon}" style="font-size:9px;color:${s.color};opacity:.7;width:12px;flex-shrink:0;"></i>
              <span style="font-size:10px;color:var(--ss-muted);">${s.q}</span>
            </button>`).join('');
        }

        // ── TAG BAR ────────────────────────────────────────────────────
        function _srBuildTagBar() {
          const el = $('sr-tag-bar');
          if (!el) return;
          const existingLabel = el.querySelector('span');
          const tags = [
            'E2 firmware','E3 offline manager','connect+ latency','daily password',
            'solenoid reverse','custom screen','floor plan','pcr setpoint',
            'license key','vpn tunnel','proof failure','haccp',
            'XR75','CC200','XM679 wiring','RGA warranty',
          ];
          const pills = tags.map(t => `
            <button onclick="window._srQuickSearch('${t}')"
              style="background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);color:var(--ss-muted);padding:3px 9px;border-radius:12px;font-size:10px;font-weight:600;cursor:pointer;font-family:var(--ss-font);transition:all .12s;white-space:nowrap;"
              onmouseover="this.style.background='rgba(168,85,247,.12)';this.style.borderColor='rgba(168,85,247,.3)';this.style.color='#c084fc';"
              onmouseout="this.style.background='rgba(255,255,255,.05)';this.style.borderColor='rgba(255,255,255,.08)';this.style.color='var(--ss-muted)';"
            >${t}</button>`).join('');
          el.innerHTML = (existingLabel ? existingLabel.outerHTML : '') + pills;
        }

        window._srQuickSearch = function(q) {
          const inp = $('sr-search-input');
          if (inp) { inp.value = q; srQuery = q; srPage = 0; $('sr-clear-btn').style.display='block'; _srRender(); inp.focus(); }
        };

        // ── WELCOME ────────────────────────────────────────────────────
        function _srShowWelcome(cats) {
          const ws = $('sr-welcome-stats');
          if (ws) {
            const total    = cats.reduce((a,c)=>a+c.count,0);
            const resolved = cats.reduce((a,c)=>a+c.resolved,0);
            const entries  = cats.reduce((a,c)=>a+c.entries,0);
            const pct      = Math.round(resolved/total*100);
            ws.innerHTML = [
              { label:'Total Cases', val:total.toLocaleString(), color:'#58a6ff' },
              { label:'Resolved',    val:resolved.toLocaleString(), color:'#3fb950' },
              { label:'KB Entries',  val:entries.toLocaleString(), color:'#a78bfa' },
              { label:'Resolution Rate', val:pct+'%', color:'#fbbf24' },
            ].map(s => `
              <div style="background:var(--ss-surface2);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:14px;text-align:center;">
                <div style="font-size:20px;font-weight:800;color:${s.color};margin-bottom:3px;">${s.val}</div>
                <div style="font-size:10px;color:var(--ss-muted);">${s.label}</div>
              </div>`).join('');
          }
          const wc = $('sr-welcome-cats');
          if (wc) {
            wc.innerHTML = cats.map(cat => {
              const pct = Math.round(cat.resolved/(cat.count||1)*100);
              return `
                <div onclick="window._srCatClick('${cat.id}','${cat.label}','${cat.color}')"
                  style="background:var(--ss-surface2);border:1px solid rgba(255,255,255,.07);border-radius:8px;padding:12px;cursor:pointer;transition:all .15s;position:relative;overflow:hidden;"
                  onmouseover="this.style.borderColor='${cat.color}44';this.style.background='rgba(255,255,255,.03)';"
                  onmouseout="this.style.borderColor='rgba(255,255,255,.07)';this.style.background='var(--ss-surface2)';">
                  <div style="position:absolute;top:0;left:0;right:0;height:2px;background:${cat.color};opacity:.4;"></div>
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                    <div style="width:28px;height:28px;border-radius:7px;background:${cat.color}15;border:1px solid ${cat.color}28;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                      <i class="fas ${cat.icon}" style="color:${cat.color};font-size:11px;"></i>
                    </div>
                    <div style="min-width:0;">
                      <div style="font-size:11px;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${cat.label}</div>
                      <div style="font-size:9px;color:var(--ss-muted);">${cat.entries} entries · ${pct}% resolved</div>
                    </div>
                  </div>
                  <div style="height:2px;background:rgba(255,255,255,.05);border-radius:1px;overflow:hidden;">
                    <div style="height:100%;width:${pct}%;background:${cat.color};opacity:.5;"></div>
                  </div>
                </div>`;
            }).join('');
          }
        }

        // ── FILTER ─────────────────────────────────────────────────────
        window._srSetFilter = function(catId, catLabel, catColor) {
          srFilter = catId; srPage = 0;
          // Active filter badge
          const af = $('sr-active-filter'), fl = $('sr-filter-label');
          if (af && fl) {
            af.style.display = 'flex';
            af.style.background = catColor + '15';
            af.style.borderColor = catColor + '40';
            af.style.color = catColor;
            fl.textContent = catLabel;
          }
          // Breadcrumb
          const bc = $('sr-breadcrumb');
          if (bc) bc.innerHTML = `<span style="color:rgba(255,255,255,.2);">›</span><span style="color:${catColor};font-weight:600;">${catLabel}</span>`;
          // Highlight sidebar button
          document.querySelectorAll('#sr-cat-filter .sr-cat-btn').forEach(b => {
            const isActive = b.dataset.cat === catId;
            if (isActive) {
              b.style.background = catColor + '15';
              b.style.borderColor = catColor + '30';
              b.querySelector('span span:last-child,span').style && (b.querySelector('.sr-cat-count').style.color = catColor);
              const lbl = b.querySelectorAll('span')[2];
              if (lbl) lbl.style.color = catColor;
              b.classList.add('active-cat');
            } else if (!b.dataset.cat) {
              _styleAllBtn(b, false);
            } else {
              b.style.background = 'transparent';
              b.style.borderColor = 'transparent';
              b.classList.remove('active-cat');
              const lbl = b.querySelectorAll('span')[2];
              if (lbl) lbl.style.color = 'var(--ss-muted)';
            }
          });
          _srRender();
        };

        window._srClearFilter = function() {
          srFilter = null; srPage = 0;
          const af = $('sr-active-filter'); if (af) af.style.display = 'none';
          const bc = $('sr-breadcrumb'); if (bc) bc.innerHTML = '';
          document.querySelectorAll('#sr-cat-filter .sr-cat-btn').forEach(b => {
            if (!b.dataset.cat) { _styleAllBtn(b, true); }
            else {
              b.style.background = 'transparent'; b.style.borderColor = 'transparent';
              b.classList.remove('active-cat');
              const lbl = b.querySelectorAll('span')[2];
              if (lbl) lbl.style.color = 'var(--ss-muted)';
            }
          });
          // Always rebuild full welcome grid (in case we came from subcat view)
          _srShowWelcome(srCats);
          _srRender();
        };

        window._srClear = function() {
          const inp = $('sr-search-input'); if (inp) inp.value = '';
          srQuery = ''; srPage = 0; $('sr-clear-btn').style.display = 'none'; _srRender();
        };

        window._srSetView = function(v) {
          srView = v;
          document.body.classList.toggle('sr-compact', v === 'compact');
          $('sr-view-compact').style.background  = v==='compact' ? 'rgba(168,85,247,.2)' : 'transparent';
          $('sr-view-compact').style.color       = v==='compact' ? '#c084fc' : 'var(--ss-muted)';
          $('sr-view-detailed').style.background = v==='detailed' ? 'rgba(168,85,247,.2)' : 'transparent';
          $('sr-view-detailed').style.color      = v==='detailed' ? '#c084fc' : 'var(--ss-muted)';
        };
        window._srSetView('compact'); // default

        // ── PAGINATION ─────────────────────────────────────────────────
        window._srNextPage = function() {
          const max = Math.ceil(srCache.length/PAGE_SZ)-1;
          if (srPage < max) { srPage++; _srRenderCards(); _scrollTop(); }
        };
        window._srPrevPage = function() {
          if (srPage > 0) { srPage--; _srRenderCards(); _scrollTop(); }
        };
        function _scrollTop() { const c=$('sr-content'); if(c) c.scrollTop=0; }

        // ── SEARCH ─────────────────────────────────────────────────────
        function _srSearch(q, cat) {
          if (!srFlat) return [];
          let pool;
          if (!cat) {
            pool = srFlat;
          } else if (cat === 'parts_products') {
            pool = srFlat.filter(e => e.id.startsWith('parts_'));
          } else {
            pool = srFlat.filter(e => e.id === cat);
          }
          if (!q || q.length < 1) return pool;

          const qClean = q.trim();
          const terms  = qClean.toLowerCase().split(/\s+/).filter(Boolean);

          // FIX BUG 2: Pure-numeric query = case# search — check e.case first
          // If user types "458697", find that exact case# immediately
          if (/^\d+$/.test(qClean)) {
            const exactCase = pool.filter(e => String(e.case || '') === qClean);
            if (exactCase.length) return exactCase;
            // Fall through to substring search if no exact match
          }

          return pool.filter(e => {
            // FIX BUG 2: Include e.case in haystack so case# is searchable
            const hay = (
              (e.title || '') + ' ' +
              (e.res   || '') + ' ' +
              (e.cat   || '') + ' ' +
              (e.eu    || '') + ' ' +
              (e.case  || '')          // ← was missing — added case number
            ).toLowerCase();
            return terms.every(t => hay.includes(t));
          });
        }

        function _hl(text, q) {
          if (!q || !text) return text || '';
          const terms = q.split(/\s+/).filter(t => t.length > 1);
          let r = text;
          terms.forEach(t => {
            const re = new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + ')', 'gi');
            r = r.replace(re, '<mark style="background:rgba(168,85,247,.3);color:#e9d5ff;border-radius:2px;padding:0 1px;">$1</mark>');
          });
          return r;
        }

        // ── RENDER MAIN ────────────────────────────────────────────────
        function _srRender() {
          const loading  = $('sr-loading');
          const welcome  = $('sr-welcome');
          const content  = $('sr-content');
          const pBar     = $('sr-pagination-bar');
          const countEl  = $('sr-result-count');

          const hasQ = srQuery.length >= 1;
          const hasF = !!srFilter;

          // Show welcome when nothing active and loaded
          if (!hasQ && !hasF) {
            if (loading)  loading.style.display  = 'none';
            if (welcome)  welcome.style.display   = 'block';
            if (content)  content.style.display   = 'none';
            if (pBar)     pBar.style.display       = 'none';
            if (countEl)  {
              const total = srFlat ? srFlat.length : srCats.reduce((a,c)=>a+c.entries,0);
              countEl.textContent = total.toLocaleString() + ' Records';
            }
            return;
          }

          if (!srLoaded) {
            if (loading) loading.style.display = 'flex';
            if (welcome) welcome.style.display = 'none';
            if (content) content.style.display = 'none';
            return;
          }

          if (loading) loading.style.display = 'none';
          if (welcome) welcome.style.display = 'none';
          if (content) content.style.display = 'flex';

          // FIX BUG 2: When query is a pure case# (all digits), search ALL categories
          // regardless of active category filter. Case# is unique — always cross-category.
          const isCaseNumSearch = srQuery && /^\d+$/.test(srQuery.trim());
          srCache = _srSearch(srQuery, isCaseNumSearch ? null : srFilter);

          if (countEl) countEl.textContent = srCache.length.toLocaleString() + ' Result' + (srCache.length !== 1 ? 's' : '');
          _srRenderCards();
        }

        // ── RENDER RESULT CARDS ─────────────────────────────────────────
        function _srRenderCards() {
          const resArea = $('sr-results');
          const emptyEl = $('sr-empty');
          const pBar    = $('sr-pagination-bar');
          const pInfo   = $('sr-page-info');
          const prevBtn = $('sr-prev-btn');
          const nextBtn = $('sr-next-btn');
          const q       = srQuery;

          if (srCache.length === 0) {
            if (resArea) resArea.innerHTML = '';
            if (emptyEl) emptyEl.style.display = 'block';
            if (pBar)    pBar.style.display = 'none';
            return;
          }
          if (emptyEl) emptyEl.style.display = 'none';

          const pageData = srCache.slice(srPage*PAGE_SZ, (srPage+1)*PAGE_SZ);
          const maxPage  = Math.ceil(srCache.length/PAGE_SZ)-1;

          if (pBar) pBar.style.display = srCache.length > PAGE_SZ ? 'flex' : 'none';
          if (pInfo) pInfo.textContent = `Showing ${srPage*PAGE_SZ+1}–${Math.min((srPage+1)*PAGE_SZ,srCache.length)} of ${srCache.length.toLocaleString()}`;
          if (prevBtn) { prevBtn.disabled = srPage===0; prevBtn.style.opacity = srPage===0?'.35':'1'; }
          if (nextBtn) { nextBtn.disabled = srPage>=maxPage; nextBtn.style.opacity = srPage>=maxPage?'.35':'1'; }

          // Store full cache reference for detail modal prev/next navigation
          if (resArea) resArea._srFullCache = srCache;

          resArea.innerHTML = pageData.map((e,i) => {
            const globalIdx = srPage*PAGE_SZ + i;
            const tHL = _hl(e.title, q);
            const resShort = e.res.length > 220 ? e.res.slice(0,220)+'…' : e.res;
            const rHL  = _hl(resShort, q);
            const rHLFull = _hl(e.res.length > 500 ? e.res.slice(0,500)+'…' : e.res, q);
            return `
              <div class="sr-card" data-sr-idx="${globalIdx}"
                style="--sr-card-accent:${e.color};background:var(--ss-surface2);border:1px solid rgba(255,255,255,.06);border-radius:9px;padding:11px 14px;cursor:pointer;position:relative;transition:border-color .15s,background .15s,box-shadow .15s;"
                onclick="window._srOpenDetail(${globalIdx})"
                onmouseover="this.style.borderColor='${e.color}55';this.style.background='rgba(255,255,255,.03)';this.style.boxShadow='0 4px 20px rgba(0,0,0,.3)'"
                onmouseout="this.style.borderColor='rgba(255,255,255,.06)';this.style.background='var(--ss-surface2)';this.style.boxShadow=''">

                <!-- Card header: category pill + end user + CASE # BADGE (premium) -->
                <div style="display:flex;align-items:center;gap:7px;margin-bottom:8px;flex-wrap:wrap;">
                  <span style="background:${e.color}18;border:1px solid ${e.color}35;color:${e.color};padding:3px 9px;border-radius:7px;font-size:9px;font-weight:700;display:inline-flex;align-items:center;gap:4px;flex-shrink:0;letter-spacing:.02em;">
                    <i class="fas ${e.icon}" style="font-size:8px;"></i>${e.cat}
                  </span>
                  ${e.eu ? `<span style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);color:rgba(255,255,255,.45);padding:3px 8px;border-radius:7px;font-size:9px;font-weight:600;">${e.eu}</span>` : ''}
                  <!-- CASE # — premium badge -->
                  <span onclick="event.stopPropagation();window._srOpenDetail(${globalIdx})"
                    style="margin-left:auto;display:inline-flex;align-items:center;gap:4px;background:rgba(88,166,255,.12);border:1px solid rgba(88,166,255,.3);color:#58a6ff;padding:3px 9px;border-radius:6px;font-size:10px;font-weight:800;font-family:var(--ss-mono,'JetBrains Mono',monospace);letter-spacing:.02em;flex-shrink:0;cursor:pointer;"
                    onmouseover="this.style.background='rgba(88,166,255,.22)';this.style.borderColor='rgba(88,166,255,.55)'"
                    onmouseout="this.style.background='rgba(88,166,255,.12)';this.style.borderColor='rgba(88,166,255,.3)'"
                    title="View Case #${e.case} detail">
                    <i class="fas fa-hashtag" style="font-size:8px;opacity:.7;"></i>${e.case}
                  </span>
                </div>

                <!-- Title -->
                <div style="font-size:12px;font-weight:700;color:#e6edf3;margin-bottom:7px;line-height:1.4;">${tHL}</div>

                <!-- Resolution — compact view -->
                <div class="sr-res-short" style="font-size:11px;color:#8b949e;line-height:1.55;padding:7px 11px;background:rgba(0,0,0,.2);border-radius:6px;border-left:2px solid ${e.color}60;">
                  <span style="display:inline-block;width:7px;height:7px;background:#3fb950;border-radius:50%;margin-right:6px;flex-shrink:0;vertical-align:middle;opacity:.8;"></span>${rHL}
                </div>

                <!-- Resolution — detailed view -->
                <div class="sr-res-full" style="font-size:11px;color:#8b949e;line-height:1.65;padding:9px 12px;background:rgba(0,0,0,.22);border-radius:6px;border-left:3px solid ${e.color};">
                  <div style="display:flex;align-items:center;gap:5px;margin-bottom:5px;">
                    <span style="display:inline-block;width:7px;height:7px;background:#3fb950;border-radius:50%;flex-shrink:0;opacity:.8;"></span>
                    <span style="font-size:9px;font-weight:700;color:rgba(255,255,255,.25);letter-spacing:.06em;text-transform:uppercase;">Resolution</span>
                  </div>
                  <span style="color:#adbac7;">${rHLFull}</span>
                </div>

                <!-- Footer hint -->
                <div style="display:flex;align-items:center;justify-content:flex-end;margin-top:8px;padding-top:6px;border-top:1px solid rgba(255,255,255,.04);">
                  <span style="font-size:9px;font-weight:700;color:${e.color};opacity:.6;display:inline-flex;align-items:center;gap:4px;">
                    <i class="fas fa-expand-alt" style="font-size:7px;"></i> View Full Case Detail
                  </span>
                </div>
              </div>`;
          }).join('');
        }

        window._srRender = _srRender;

        // ── SR CASE DETAIL OPENER ──────────────────────────────────────────
        // Opens #qbCaseDetailModal from a Support Records KB entry.
        // Step 1: Opens immediately with summary data from support_records_kb.json
        // Step 2: Fetches FULL record from QBS (QuickBase_S) and refreshes modal
        window._srOpenDetail = function(globalIdx) {
          const resArea = $('sr-results');
          const cache   = (resArea && resArea._srFullCache) ? resArea._srFullCache : srCache;
          const e       = cache[globalIdx];
          if (!e) return;

          // Build allSnaps for prev/next navigation
          const allSnaps = cache.map(function(entry, idx) {
            return _srBuildSnap(entry, idx);
          });

          const snap = allSnaps[globalIdx];

          // Step 1: Open modal immediately with summary data
          if (typeof window._qbsOpenCaseDetail === 'function') {
            window._qbsOpenCaseDetail(snap, allSnaps);
          } else if (typeof window.__studioQbCdOpen === 'function') {
            window.__studioQbCdOpen(snap);
          }

          // Step 2: Fetch full record from QBS and refresh modal
          const caseNum = String(e.case || '').trim();
          if (!caseNum) return;

          // Show loading state on key fields
          var loadingFields = ['qbcdAssigned','qbcdContact','qbcdKpiAge','qbcdKpiLast','qbcdNotes','qbcdLatest'];
          loadingFields.forEach(function(id) {
            var el = document.getElementById(id);
            if (el && (el.textContent === '—' || el.textContent === '')) {
              el.textContent = '…';
              el.style.opacity = '0.5';
            }
          });

          // Get auth token for API call
          function _getToken() {
            try {
              var raw = localStorage.getItem('mums_supabase_session') || sessionStorage.getItem('mums_supabase_session');
              if (raw) { var p = JSON.parse(raw); if (p && p.access_token) return p.access_token; }
            } catch(_) {}
            return '';
          }

          var tok = _getToken();
          fetch('/api/studio/qb_data?recordId=' + encodeURIComponent(caseNum), {
            headers: tok ? { 'Authorization': 'Bearer ' + tok } : {}
          })
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (!data.ok || !data.fields) {
              // Restore loading indicators back to summary data
              loadingFields.forEach(function(id) {
                var el = document.getElementById(id);
                if (el && el.textContent === '…') { el.textContent = '—'; el.style.opacity = ''; }
              });
              return;
            }

            // Build a FULL snap from the QBS record and re-populate the modal
            var fullSnap = {
              rowNum:    snap.rowNum,
              recordId:  String(data.recordId || caseNum),
              qbRecordId: String(data.recordId || caseNum),
              fields:    data.fields,
              columnMap: data.columnMap,
            };

            // Replace this snap in allSnaps for proper prev/next navigation with full data
            allSnaps[globalIdx] = fullSnap;

            // Re-populate the modal with full data
            if (typeof window._qbsOpenCaseDetail === 'function') {
              window._qbsOpenCaseDetail(fullSnap, allSnaps);
            } else if (typeof window.__studioQbCdOpen === 'function') {
              window.__studioQbCdOpen(fullSnap);
            }

            // Remove loading opacity
            loadingFields.forEach(function(id) {
              var el = document.getElementById(id);
              if (el) el.style.opacity = '';
            });
          })
          .catch(function(err) {
            console.warn('[SR] Failed to fetch full case record:', err);
            loadingFields.forEach(function(id) {
              var el = document.getElementById(id);
              if (el && el.textContent === '…') { el.textContent = '—'; el.style.opacity = ''; }
            });
          });
        };

        function _srBuildSnap(e, idx) {
          // Map KB entry fields to columnMap labels that _populate() keyword-matches:
          // desc:    'Short Description'
          // notes:   'Case Notes'       → full resolution text
          // latest:  'Latest Update on the Case'
          // type:    'Type'
          // endUser: 'End User'
          // status:  'Case Status'
          return {
            rowNum:    idx + 1,
            recordId:  String(e.case || '—'),
            qbRecordId: String(e.case || ''),
            fields: {
              'sr_f1': { value: e.title  || '—' },
              'sr_f2': { value: e.res    || '' },
              'sr_f3': { value: e.res    || '' },
              'sr_f4': { value: e.cat    || '—' },
              'sr_f5': { value: e.eu     || '—' },
              'sr_f6': { value: 'C - Resolved' },
            },
            columnMap: {
              'sr_f1': 'Short Description',
              'sr_f2': 'Case Notes',
              'sr_f3': 'Latest Update on the Case',
              'sr_f4': 'Type',
              'sr_f5': 'End User',
              'sr_f6': 'Case Status',
            },
          };
        }

        window._srCatClick = function(catId, catLabel, catColor) {
          const cat = srCats.find(c => c.id === catId);
          if (cat && cat.subcats && cat.subcats.length > 0) {
            _srShowSubcatWelcome(cat);
          } else {
            window._srSetFilter(catId, catLabel, catColor);
          }
        };

        function _srShowSubcatWelcome(cat) {
          const welcome  = $('sr-welcome');
          const wc       = $('sr-welcome-cats');
          const content  = $('sr-content');
          const pBar     = $('sr-pagination-bar');
          const countEl  = $('sr-result-count');
          const bc       = $('sr-breadcrumb');

          // Hide results, show welcome
          if (content) content.style.display = 'none';
          if (pBar)    pBar.style.display = 'none';
          if (welcome) welcome.style.display = 'block';

          // Breadcrumb
          if (bc) bc.innerHTML = `<span style="color:rgba(255,255,255,.2);">›</span><span style="color:${cat.color};font-weight:700;">${cat.label}</span>`;

          // Result count badge
          if (countEl) countEl.textContent = cat.entries.toLocaleString() + ' Entries';

          // Filter badge in sidebar
          const af = $('sr-active-filter'), fl = $('sr-filter-label');
          if (af && fl) {
            af.style.display = 'flex';
            af.style.background = cat.color + '15';
            af.style.borderColor = cat.color + '40';
            af.style.color = cat.color;
            fl.textContent = cat.label;
          }

          // Highlight sidebar button
          document.querySelectorAll('#sr-cat-filter .sr-cat-btn').forEach(b => {
            const isActive = b.dataset.cat === cat.id;
            if (isActive) {
              b.style.background  = cat.color + '15';
              b.style.borderColor = cat.color + '30';
              b.classList.add('active-cat');
              const lbl = b.querySelectorAll('span')[2];
              if (lbl) lbl.style.color = cat.color;
            } else if (!b.dataset.cat) {
              _styleAllBtn(b, false);
            } else {
              b.style.background  = 'transparent';
              b.style.borderColor = 'transparent';
              b.classList.remove('active-cat');
              const lbl = b.querySelectorAll('span')[2];
              if (lbl) lbl.style.color = 'var(--ss-muted)';
            }
          });

          // Subcats stat grid (entry counts per subcat)
          const ws = $('sr-welcome-stats');
          if (ws) ws.innerHTML = cat.subcats.map(s => `
            <div onclick="window._srSetFilter('${s.id}','${s.label}','${s.color}')"
              style="background:var(--ss-surface2);border:1px solid ${s.color}20;border-radius:8px;padding:10px;text-align:center;cursor:pointer;transition:all .14s;"
              onmouseover="this.style.borderColor='${s.color}55'" onmouseout="this.style.borderColor='${s.color}20'">
              <div style="font-size:16px;font-weight:800;color:${s.color};">${s.entries.toLocaleString()}</div>
              <div style="font-size:8.5px;color:var(--ss-muted);margin-top:3px;line-height:1.3;">${s.label}</div>
            </div>`).join('');

          // Subcategory cards with Back button
          if (wc) wc.innerHTML = `
            <div style="grid-column:1/-1;display:flex;align-items:center;gap:10px;margin-bottom:4px;">
              <button onclick="window._srClearFilter()"
                style="background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);color:var(--ss-muted);
                       padding:5px 12px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;
                       font-family:var(--ss-font);display:flex;align-items:center;gap:6px;transition:all .12s;"
                onmouseover="this.style.background='rgba(255,255,255,.09)'" onmouseout="this.style.background='rgba(255,255,255,.05)'">
                <i class="fas fa-arrow-left" style="font-size:9px;"></i> Back to All Categories
              </button>
              <span style="font-size:9px;font-weight:700;color:rgba(255,255,255,.25);letter-spacing:.08em;text-transform:uppercase;">
                <i class="fas ${cat.icon}" style="color:${cat.color};margin-right:4px;"></i>${cat.label} — Select a sub-category
              </span>
            </div>
            ${cat.subcats.map(sub => `
            <div onclick="window._srSetFilter('${sub.id}','${sub.label}','${sub.color}')"
              style="background:var(--ss-surface2);border:1px solid rgba(255,255,255,.07);border-radius:8px;padding:12px;
                     cursor:pointer;transition:all .15s;position:relative;overflow:hidden;"
              onmouseover="this.style.borderColor='${sub.color}44';this.style.background='rgba(255,255,255,.03)';"
              onmouseout="this.style.borderColor='rgba(255,255,255,.07)';this.style.background='var(--ss-surface2)';">
              <div style="position:absolute;top:0;left:0;right:0;height:2px;background:${sub.color};opacity:.45;"></div>
              <div style="display:flex;align-items:flex-start;gap:9px;margin-bottom:8px;">
                <div style="width:28px;height:28px;border-radius:7px;background:${sub.color}18;border:1px solid ${sub.color}28;
                            display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                  <i class="fas ${sub.icon}" style="color:${sub.color};font-size:11px;"></i>
                </div>
                <div style="min-width:0;flex:1;">
                  <div style="font-size:11px;font-weight:700;color:#fff;line-height:1.3;">${sub.label}</div>
                  <div style="font-size:9px;color:var(--ss-muted);margin-top:2px;">${sub.entries.toLocaleString()} KB entries</div>
                </div>
              </div>
              <div style="display:flex;gap:3px;flex-wrap:wrap;">
                ${sub.tags.slice(0,4).map(t => `<span style="background:${sub.color}14;border:1px solid ${sub.color}22;color:${sub.color};padding:2px 6px;border-radius:6px;font-size:8px;font-weight:600;">${t}</span>`).join('')}
              </div>
            </div>`).join('')}`;
        }

      })();

/* ═══════════════════════════════════════════════════════════════════
   KNOWLEDGE BASE — Premium JS Engine v2
   Multi-table | Sort | Pagination | Sidebar nav | Export CSV
═══════════════════════════════════════════════════════════════════ */
(function(){
  'use strict';

  const PER_PAGE = 50;

  const state = {
    all:         [],   // full dataset from server
    filtered:    [],   // after search + type + product + family filters
    tables:      [],   // table metadata [{id,name,count}]
    page:        1,
    perPage:     PER_PAGE,
    sortKey:     '',
    sortDir:     1,    // 1=asc -1=desc
    tableFilter: '',   // active table_id filter from sidebar
    initialized: false
  };

  /* ── Utils ─────────────────────────────────────────────────── */
  function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function fmtDate(v){ if(!v) return '—'; const d=new Date(v); return isNaN(d.getTime()) ? esc(v) : d.toLocaleDateString(); }

  function kbGetToken(){
    try{
      const raw=localStorage.getItem('mums_supabase_session')||sessionStorage.getItem('mums_supabase_session');
      if(raw){ try{ const p=JSON.parse(raw); const t=p&&(p.access_token||(p.session&&p.session.access_token)); if(t) return String(t); }catch(_){} }
      if(window.CloudAuth&&typeof window.CloudAuth.accessToken==='function'){ const t2=window.CloudAuth.accessToken(); if(t2) return String(t2); }
      const m=document.cookie.match(/(?:^|;)\s*sb-access-token=([^;]+)/); if(m) return decodeURIComponent(m[1]);
      if(window.opener&&window.opener.CloudAuth&&typeof window.opener.CloudAuth.accessToken==='function'){ const t4=window.opener.CloudAuth.accessToken(); if(t4) return String(t4); }
    }catch(_){}
    return '';
  }
  function authHeaders(){ try{ const t=kbGetToken(); return t?{Authorization:'Bearer '+t}:{}; }catch(_){ return {}; } }



  /* ── Sort helpers ───────────────────────────────────────────── */
  function applySort(arr){
    if(!state.sortKey) return arr;
    const k=state.sortKey, d=state.sortDir;
    return [...arr].sort((a,b)=>{
      let av=String(a[k]||'').toLowerCase(), bv=String(b[k]||'').toLowerCase();
      if(k==='created_at'){ av=new Date(a[k]||0).getTime(); bv=new Date(b[k]||0).getTime(); }
      if(av<bv) return -d; if(av>bv) return d; return 0;
    });
  }

  /* ── Sidebar table list ─────────────────────────────────────── */
  function renderSidebar(){
    const el=document.getElementById('kb-sidebar-table-list');
    if(!el) return;

    // Build type counts from filtered (or all if no table filter)
    const source = state.all;
    const typeCounts = {};
    source.forEach(it=>{
      const k=it.table_name||it.type||'Other';
      typeCounts[k]=(typeCounts[k]||0)+1;
    });

    let html='';
    // "All" pill
    const totalCount=source.length;
    const allActive=!state.tableFilter;
    html+=`<div class="prem-filter-item${allActive?' active':''}" style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;padding:7px 14px;margin:1px 6px;border-radius:6px;font-size:11px;font-weight:${allActive?'700':'500'};color:${allActive?'#22d3ee':'var(--ss-muted)'};background:${allActive?'rgba(34,211,238,.1)':'transparent'};border:1px solid ${allActive?'rgba(34,211,238,.25)':'transparent'};transition:all .15s;" onclick="window._kbSetTableFilter('')"><span><i class='fas fa-layer-group' style='margin-right:6px;font-size:10px;opacity:.7;'></i>All Documents</span><span style="background:rgba(255,255,255,.07);border-radius:10px;padding:1px 7px;font-size:10px;">${totalCount.toLocaleString()}</span></div>`;

    // Per-table pills
    const tableNames=Object.entries(typeCounts).sort((a,b)=>b[1]-a[1]);
    tableNames.forEach(([name,cnt])=>{
      const matchTable=state.tables.find(t=>t.name===name);
      const tId=matchTable?matchTable.id:'';
      const isActive=state.tableFilter&&(state.tableFilter===tId||state.tableFilter===name);
      const icon=getTableIcon(name);
      html+=`<div class="prem-filter-item${isActive?' active':''}" style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;padding:7px 14px;margin:1px 6px;border-radius:6px;font-size:11px;font-weight:${isActive?'700':'500'};color:${isActive?'#22d3ee':'var(--ss-muted)'};background:${isActive?'rgba(34,211,238,.1)':'transparent'};border:1px solid ${isActive?'rgba(34,211,238,.25)':'transparent'};transition:all .15s;" onclick="window._kbSetTableFilter('${esc(tId||name)}')"><span style="display:flex;align-items:center;gap:7px;"><i class='${icon}' style='font-size:10px;opacity:.7;'></i>${esc(name)}</span><span style="background:rgba(255,255,255,.07);border-radius:10px;padding:1px 7px;font-size:10px;">${cnt.toLocaleString()}</span></div>`;
    });

    el.innerHTML=html;
  }

  function getTableIcon(name){
    const n=String(name||'').toLowerCase();
    if(n.includes('troubleshoot')) return 'fas fa-tools';
    if(n.includes('work instruct')||n.includes('instruction')) return 'fas fa-file-alt';
    if(n.includes('education')||n.includes('training')||n.includes('course')) return 'fas fa-graduation-cap';
    if(n.includes('drawing')||n.includes('cad')||n.includes('dwg')) return 'fas fa-drafting-compass';
    if(n.includes('video')) return 'fas fa-play-circle';
    if(n.includes('product')) return 'fas fa-microchip';
    if(n.includes('scope')) return 'fas fa-file-contract';
    if(n.includes('faq')) return 'fas fa-question-circle';
    if(n.includes('documentation')) return 'fas fa-book-open';
    if(n.includes('material')) return 'fas fa-folder-open';
    return 'fas fa-file';
  }

  /* ── Active filter pill ─────────────────────────────────────── */
  function updateFilterPill(){
    const pill=document.getElementById('kb-active-filter');
    const lbl=document.getElementById('kb-filter-label');
    if(!pill||!lbl) return;
    if(state.tableFilter){
      const t=state.tables.find(t=>t.id===state.tableFilter||t.name===state.tableFilter);
      lbl.textContent=t?t.name:state.tableFilter;
      pill.style.display='flex';
    } else {
      pill.style.display='none';
    }
  }

  /* ── Filter + sort pipeline ─────────────────────────────────── */
  function applyFilters(){
    const q=String((document.getElementById('kb-search-input')||{}).value||'').toLowerCase().trim();
    const p=String((document.getElementById('kb-filter-product')||{}).value||'').toLowerCase().trim();
    const f=String((document.getElementById('kb-filter-family')||{}).value||'').toLowerCase().trim();
    const tf=state.tableFilter;

    state.filtered=state.all.filter(it=>{
      if(tf){
        const matchById=it.table_id&&it.table_id===tf;
        const matchByName=it.table_name&&it.table_name===tf;
        if(!matchById&&!matchByName) return false;
      }
      if(q){
        const blob=[it.title,it.doc_number,it.related_product,it.product_family,it.type,it.table_name].join(' ').toLowerCase();
        if(!blob.includes(q)) return false;
      }
      if(p&&!String(it.related_product||'').toLowerCase().includes(p)) return false;
      if(f&&!String(it.product_family||'').toLowerCase().includes(f)) return false;
      return true;
    });

    state.filtered=applySort(state.filtered);
    state.page=1;
    renderTable();
    renderCharts();
    updateFilterPill();

    // Update status
    const statusEl=document.getElementById('kb-status');
    const countEl=document.getElementById('kb-search-count');
    if(statusEl) statusEl.textContent=q?'Results for "'+q+'"':'';
    if(countEl) countEl.textContent=state.filtered.length!==state.all.length?state.filtered.length.toLocaleString()+' of '+state.all.length.toLocaleString():state.all.length.toLocaleString()+' items';

    // Update count badge
    const badge=document.getElementById('kb-record-count');
    if(badge) badge.textContent=state.filtered.length.toLocaleString()+' / '+state.all.length.toLocaleString();
  }

  /* ── Table render ───────────────────────────────────────────── */
  function renderTable(){
    const body=document.getElementById('kb-table-body');
    if(!body) return;

    const start=(state.page-1)*state.perPage;
    const rows=state.filtered.slice(start, start+state.perPage);

    if(!rows.length){
      body.innerHTML='<tr><td colspan="9" style="text-align:center;padding:48px 20px;color:var(--ss-muted);"><i class="fas fa-search" style="display:block;font-size:24px;opacity:.2;margin-bottom:12px;"></i>No results found. Try a different filter or click Sync Now.</td></tr>';
      renderPagination();
      return;
    }

    body.innerHTML=rows.map((it,idx)=>{
      const rowNum=start+idx+1;

      // Download buttons — routed through server proxy
      // kb_download.js calls api.quickbase.com/v1/files with QB-USER-TOKEN
      // No QB browser session required — MUMS JWT auth is enough
      const dls=Array.isArray(it.download_url)&&it.download_url.length
        ? it.download_url.map((u,i)=>{
            const dlUrl='/api/studio/kb_download?url='+encodeURIComponent(u);
            return `<a class="prem-tb-btn" style="padding:3px 9px;margin:0 3px 3px 0;display:inline-flex;align-items:center;gap:4px;font-size:10px;background:rgba(34,211,238,.1);border-color:rgba(34,211,238,.25);color:#22d3ee;" href="${esc(dlUrl)}" target="_blank" rel="noopener"><i class="fas fa-download" style="font-size:9px;"></i>${it.download_url.length>1?'File '+(i+1):'Download'}</a>`;
          }).join('')
        : '<span style="opacity:.35;font-size:10px;">—</span>';

      // Type badge colour
      const typeColor=getTypeBadgeColor(it.type||it.table_name||'');

      // Source link
      const srcLink=it.source_link
        ? `<a href="${esc(it.source_link)}" target="_blank" rel="noopener" class="prem-tb-btn" style="padding:3px 9px;font-size:10px;display:inline-flex;align-items:center;gap:4px;"><i class="fas fa-external-link-alt" style="font-size:9px;"></i> Open</a>`
        : '<span style="opacity:.35;">—</span>';

      return `<tr>
        <td style="color:var(--ss-muted);font-size:10px;padding:8px 10px;width:36px;">${rowNum}</td>
        <td style="padding:8px 10px;max-width:300px;">
          <div style="font-weight:600;color:#e6edf3;font-size:11px;line-height:1.4;">${esc(it.title||'—')}</div>
          ${it.table_name?`<div style="font-size:9px;color:var(--ss-muted);margin-top:2px;"><i class="fas fa-folder" style="margin-right:3px;opacity:.5;"></i>${esc(it.table_name)}</div>`:''}
        </td>
        <td style="padding:8px 10px;font-size:10px;color:var(--ss-muted);font-family:'JetBrains Mono',monospace;white-space:nowrap;">${esc(it.doc_number||'—')}</td>
        <td style="padding:8px 10px;font-size:10px;color:#c9d1d9;max-width:130px;">${esc(it.related_product||'—')}</td>
        <td style="padding:8px 10px;font-size:10px;color:#c9d1d9;max-width:150px;">${esc(it.product_family||'—')}</td>
        <td style="padding:8px 10px;">
          <span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:9px;font-weight:700;letter-spacing:.03em;background:${typeColor.bg};color:${typeColor.fg};border:1px solid ${typeColor.border};">${esc(it.type||it.table_name||'—')}</span>
        </td>
        <td style="padding:8px 10px;">${dls}</td>
        <td style="padding:8px 10px;font-size:10px;color:var(--ss-muted);white-space:nowrap;">${fmtDate(it.created_at)}</td>
        <td style="padding:8px 10px;">${srcLink}</td>
      </tr>`;
    }).join('');

    renderPagination();
    updateSortIndicators();
  }

  function getTypeBadgeColor(type){
    const t=String(type||'').toLowerCase();
    if(t.includes('troubleshoot')||t.includes('phone'))  return {fg:'#22d3ee',bg:'rgba(34,211,238,.1)',border:'rgba(34,211,238,.25)'};
    if(t.includes('education')||t.includes('training'))  return {fg:'#a78bfa',bg:'rgba(167,139,250,.1)',border:'rgba(167,139,250,.25)'};
    if(t.includes('fast track')||t.includes('fast'))     return {fg:'#fb923c',bg:'rgba(251,146,60,.1)',border:'rgba(251,146,60,.25)'};
    if(t.includes('application')||t.includes('engineer')) return {fg:'#34d399',bg:'rgba(52,211,153,.1)',border:'rgba(52,211,153,.25)'};
    if(t.includes('escalation'))                          return {fg:'#f87171',bg:'rgba(248,113,113,.1)',border:'rgba(248,113,113,.25)'};
    if(t.includes('ticketing'))                           return {fg:'#60a5fa',bg:'rgba(96,165,250,.1)',border:'rgba(96,165,250,.25)'};
    if(t.includes('knowledge'))                           return {fg:'#22d3ee',bg:'rgba(34,211,238,.1)',border:'rgba(34,211,238,.25)'};
    if(t.includes('support'))                             return {fg:'#e2e8f0',bg:'rgba(226,232,240,.08)',border:'rgba(226,232,240,.15)'};
    return {fg:'#8b949e',bg:'rgba(139,148,158,.1)',border:'rgba(139,148,158,.2)'};
  }

  /* ── Pagination ─────────────────────────────────────────────── */
  function renderPagination(){
    const total=state.filtered.length;
    const totalPages=Math.max(1,Math.ceil(total/state.perPage));
    const cur=state.page;
    const start=(cur-1)*state.perPage+1;
    const end=Math.min(cur*state.perPage,total);

    const info=document.getElementById('kb-page-info');
    if(info) info.textContent=total?`${start.toLocaleString()}–${end.toLocaleString()} of ${total.toLocaleString()}`:'No results';

    const prev=document.getElementById('kb-prev-btn');
    const next=document.getElementById('kb-next-btn');
    if(prev) prev.disabled=cur<=1;
    if(next) next.disabled=cur>=totalPages;

    // Page number buttons (max 7 visible)
    const btns=document.getElementById('kb-page-btns');
    if(!btns) return;
    let pages=[];
    if(totalPages<=7){ for(let i=1;i<=totalPages;i++) pages.push(i); }
    else {
      pages=[1];
      if(cur>3) pages.push('…');
      for(let i=Math.max(2,cur-1);i<=Math.min(totalPages-1,cur+1);i++) pages.push(i);
      if(cur<totalPages-2) pages.push('…');
      pages.push(totalPages);
    }
    btns.innerHTML=pages.map(p=>{
      if(p==='…') return `<span style="padding:3px 6px;font-size:10px;color:var(--ss-muted);">…</span>`;
      const isActive=p===cur;
      return `<button onclick="window._kbGoPage(${p})" style="min-width:26px;padding:3px 7px;border-radius:4px;font-size:10px;font-weight:${isActive?'800':'500'};background:${isActive?'rgba(34,211,238,.2)':'rgba(255,255,255,.04)'};border:1px solid ${isActive?'rgba(34,211,238,.4)':'rgba(255,255,255,.08)'};color:${isActive?'#22d3ee':'var(--ss-muted)'};cursor:${isActive?'default':'pointer'};font-family:var(--ss-font);">${p}</button>`;
    }).join('');
  }

  /* ── Sort indicators ────────────────────────────────────────── */
  function updateSortIndicators(){
    ['title','doc_number','related_product','product_family','type','created_at'].forEach(k=>{
      const el=document.getElementById('kb-sort-'+k);
      if(!el) return;
      if(state.sortKey===k){ el.textContent=state.sortDir===1?'↑':'↓'; el.style.opacity='1'; el.style.color='#22d3ee'; }
      else { el.textContent='⇅'; el.style.opacity='.4'; el.style.color=''; }
    });
  }

  /* ── Charts ─────────────────────────────────────────────────── */
  function bars(el, arr, color){
    if(!el) return;
    const log=!!(document.getElementById('kb-log-toggle')&&document.getElementById('kb-log-toggle').checked);
    const vals=arr.length?arr:[0];
    const max=Math.max(...vals.map(n=>log?Math.log10((n||0)+1):(n||0)))||1;
    el.innerHTML=vals.map((n,i)=>{
      const v=log?Math.log10((n||0)+1):(n||0);
      const h=Math.max(3,Math.round((v/max)*52));
      const c=color||'rgba(34,211,238,.8)';
      return `<div title="${n}" style="flex:1;background:${c};border-radius:3px 3px 0 0;height:${h}px;min-width:3px;transition:height .2s;"></div>`;
    }).join('');
  }

  function renderCharts(){
    const byMonth={}, byEdu={};
    state.filtered.forEach(it=>{
      const d=new Date(it.created_at||Date.now());
      const k=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
      byMonth[k]=(byMonth[k]||0)+1;
      const t=String(it.type||it.table_name||'').toLowerCase();
      if(t.includes('education')||t.includes('training')||t.includes('fast track')||t.includes('course')) byEdu[k]=(byEdu[k]||0)+1;
    });
    const keys=Object.keys(byMonth).sort().slice(-12);
    bars(document.getElementById('kb-chart-troubleshooting'),keys.map(k=>byMonth[k]||0),'rgba(34,211,238,.75)');
    bars(document.getElementById('kb-chart-education'),keys.map(k=>byEdu[k]||0),'rgba(167,139,250,.75)');
    const tsLbl=document.getElementById('kb-chart-ts-label');
    const eduLbl=document.getElementById('kb-chart-edu-label');
    if(tsLbl) tsLbl.textContent=keys.length?keys[0].replace('-','/')+' – '+keys[keys.length-1].replace('-','/'):'';
    if(eduLbl) eduLbl.textContent=Object.values(byEdu).reduce((a,b)=>a+b,0)+' edu items';
  }

  /* ── Stats update ───────────────────────────────────────────── */
  function updateStats(){
    const totEl=document.getElementById('kb-stats-total');
    const prodEl=document.getElementById('kb-stats-products');
    if(totEl) totEl.textContent=state.all.length.toLocaleString();
    if(prodEl) prodEl.textContent=new Set(state.all.map(i=>String(i.related_product||'').trim()).filter(Boolean)).size.toLocaleString();
    const badge=document.getElementById('kb-record-count');
    if(badge) badge.textContent=state.all.length.toLocaleString()+' items';
  }

  /* ── Export CSV ─────────────────────────────────────────────── */
  function exportCsv(){
    const cols=['title','doc_number','related_product','product_family','type','table_name','created_at','source_link'];
    const header=cols.join(',');
    const rows=state.filtered.map(it=>cols.map(c=>{
      const v=String(it[c]||'').replace(/"/g,'""');
      return v.includes(',')||v.includes('"')||v.includes('\n')?`"${v}"`:v;
    }).join(','));
    const csv=[header,...rows].join('\n');
    const blob=new Blob([csv],{type:'text/csv'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download='knowledge_base_export_'+new Date().toISOString().slice(0,10)+'.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* ── Load data ──────────────────────────────────────────────── */
  async function load(){
    const body=document.getElementById('kb-table-body');
    if(body) body.innerHTML='<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--ss-muted);"><i class="fas fa-spinner fa-spin" style="font-size:18px;opacity:.35;display:block;margin-bottom:10px;"></i>Loading Knowledge Base…</td></tr>';
    try{
      const res=await fetch('/api/studio/kb_sync',{headers:Object.assign({'Content-Type':'application/json'},authHeaders())});
      const json=await res.json();
      state.all=Array.isArray(json.items)?json.items:[];
      state.tables=Array.isArray(json.tables)?json.tables:[];
      updateStats();
      const syncEl=document.getElementById('kb-last-sync');
      if(syncEl) syncEl.textContent='Last synced: '+(json.syncedAt?new Date(json.syncedAt).toLocaleString():'—');
      renderSidebar();
      applyFilters();
    }catch(err){
      console.error('[KB] load failed',err);
      if(body) body.innerHTML='<tr><td colspan="9" style="text-align:center;padding:40px;color:#f85149;"><i class="fas fa-exclamation-triangle" style="display:block;font-size:20px;margin-bottom:10px;"></i>Failed to load Knowledge Base. Check sync settings.</td></tr>';
    }
  }

  /* ── Sync Now ───────────────────────────────────────────────── */
  async function syncNow(){
    const btn=document.getElementById('kb-sync-btn');
    const msg=document.getElementById('kb-settings-msg');
    try{
      if(btn){ btn.disabled=true; btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> Syncing…'; }
      if(msg) msg.textContent='Syncing…';
      const res=await fetch('/api/studio/kb_sync',{method:'POST',headers:Object.assign({'Content-Type':'application/json'},authHeaders())});
      const j=await res.json();
      if(!res.ok||!j.ok) throw new Error('sync_failed');
      if(msg) msg.textContent='✓ Sync complete — '+((j.tables||[]).length)+' table(s), '+(j.count||0)+' items';
      await load();
    }catch(err){
      if(msg) msg.textContent='✕ Sync failed: '+String(err&&err.message||err);
    }finally{
      if(btn){ btn.disabled=false; btn.innerHTML='<i class="fas fa-sync-alt"></i> Sync Now'; }
    }
  }

  /* ── Settings load/save ─────────────────────────────────────── */
  async function loadSettings(){
    const msg=document.getElementById('kb-settings-msg');
    try{
      if(msg){ msg.style.color='var(--ss-muted)'; msg.textContent='Loading…'; }
      const res=await fetch('/api/studio/kb_settings',{headers:authHeaders()});
      if(!res.ok){
        const reason=res.status===401?'Unauthorized — please log in again':res.status===403?'Forbidden — Super Admin only':('HTTP '+res.status);
        if(msg){ msg.style.color='#f85149'; msg.textContent='✕ Load failed: '+reason; }
        return;
      }
      const j=await res.json();
      const d=j&&j.settings||{};
      document.getElementById('kb-settings-app-url').value=d.quickbaseAppUrl||'';
      // FIX: show placeholder hint when token is already set vs not configured
      const tokenEl=document.getElementById('kb-settings-token');
      if(tokenEl){
        tokenEl.value=d.quickbaseUserTokenSet?'__KEEP__':'';
        tokenEl.placeholder=d.quickbaseUserTokenSet?'Token saved — enter new value to replace':'Enter Quickbase User Token';
      }
      document.getElementById('kb-settings-schedule').value=d.syncSchedule||'';
      // Show last synced time if available
      if(msg){
        if(d.lastSyncedAt){
          const dt=new Date(d.lastSyncedAt);
          msg.style.color='#3fb950';
          msg.textContent='✓ Settings loaded — Last sync: '+dt.toLocaleString();
        } else {
          msg.style.color='var(--ss-muted)';
          msg.textContent=d.quickbaseAppUrl?'✓ Settings loaded — not yet synced':'No settings configured yet';
        }
      }
    }catch(err){
      if(msg){ msg.style.color='#f85149'; msg.textContent='✕ Load error: '+String(err&&err.message||err); }
      console.error('[KB Settings] loadSettings error:', err);
    }
  }
  async function saveSettings(){
    const msg=document.getElementById('kb-settings-msg');
    const appUrl=(document.getElementById('kb-settings-app-url').value||'').trim();
    const tokenVal=(document.getElementById('kb-settings-token').value||'').trim();
    const schedule=document.getElementById('kb-settings-schedule').value||'';

    // FIX BUG 2a: validate App URL before sending — empty URL is a common mis-save
    if(!appUrl){
      if(msg){ msg.style.color='#f85149'; msg.textContent='✕ Quickbase App URL is required'; }
      return;
    }

    const body={
      quickbaseAppUrl: appUrl,
      // FIX BUG 2b: if user cleared the token field, default to __KEEP__ (don't wipe existing token)
      quickbaseUserToken: tokenVal||'__KEEP__',
      syncSchedule: schedule,
    };
    try{
      if(msg){ msg.style.color='var(--ss-muted)'; msg.textContent='Saving…'; }
      const res=await fetch('/api/studio/kb_settings',{method:'POST',headers:Object.assign({'Content-Type':'application/json'},authHeaders()),body:JSON.stringify(body)});
      const j=await res.json().catch(()=>({}));
      // FIX BUG 2c: show actual error from server, not generic "save_failed"
      if(!res.ok||!j.ok){
        const reason=j.error||j.message||('HTTP '+res.status);
        throw new Error(reason);
      }
      if(msg){ msg.style.color='#3fb950'; msg.textContent='✓ Settings saved'; }
      // FIX BUG 2d: reload fields from server to confirm round-trip persistence
      setTimeout(()=>{ loadSettings(); }, 400);
    }catch(err){
      if(msg){ msg.style.color='#f85149'; msg.textContent='✕ Save failed: '+String(err&&err.message||err); }
      console.error('[KB Settings] saveSettings error:', err);
    }
  }

  /* ── Public API ─────────────────────────────────────────────── */
  window._kbLoad            = load;
  window._kbInit            = function(){ if(!state.initialized){ state.initialized=true; load(); } };
  window._kbSyncNow         = syncNow;
  window._kbApplyFilters    = function(){ state.page=1; applyFilters(); };
  window._kbOnSearch        = function(v){ state.page=1; applyFilters(); };
  window._kbRenderCharts    = renderCharts;
  window._kbLoadSettings    = loadSettings;
  window._kbSaveSettings    = saveSettings;
  window._kbExportCsv       = exportCsv;
  window._kbSort            = function(key){ if(state.sortKey===key){ state.sortDir*=-1; } else { state.sortKey=key; state.sortDir=1; } state.page=1; applyFilters(); };
  window._kbChangePage      = function(d){ const tp=Math.ceil(state.filtered.length/state.perPage)||1; state.page=Math.max(1,Math.min(tp,state.page+d)); renderTable(); };
  window._kbGoPage          = function(p){ state.page=p; renderTable(); };
  window._kbSetTableFilter  = function(tf){
    state.tableFilter=tf; state.page=1;
    applyFilters(); renderSidebar(); updateFilterPill();
  };
  window._kbClearTableFilter= function(){ window._kbSetTableFilter(''); };
  window._kbToggleSection   = function(){
    const el=document.getElementById('kb-sidebar-table-list');
    const btn=document.getElementById('kb-cat-toggle-btn');
    if(!el) return;
    const hidden=el.style.display==='none';
    el.style.display=hidden?'':'none';
    if(btn) btn.textContent=hidden?'▾':'▸';
  };

})();
