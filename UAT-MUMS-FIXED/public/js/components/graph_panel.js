/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */
(function(){
  'use strict';

  // Graph Panel helpers (no modules; attaches to window)
  // Used by Members page graphical task status panel.

  const GP = (window.GraphPanel = window.GraphPanel || {});

  function clamp(n, a, b){
    n = Number(n);
    if(!Number.isFinite(n)) n = 0;
    return Math.max(a, Math.min(b, n));
  }

  function escAttr(s){
    return String(s || '')
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;')
      .replace(/'/g,'&#39;');
  }

  // Per-task layout defaults (Phase 1-504 landscape rebuild; still used in Phase 1-505)
  // The Members page passes callRole so we can normalize call variants.
  GP.getTaskLayout = function(taskId, ctx){
    const tid = String(taskId || '').trim();
    const callRole = String(ctx && ctx.callRole ? ctx.callRole : '').trim();
    const meta = ctx && ctx.meta ? ctx.meta : null;

    const isMailbox = (tid === 'mailbox_manager');
    const isCall = (tid === callRole || tid === 'call_available' || tid === 'call_onqueue');
    const isBackOffice = (tid === 'back_office' || tid === 'backoffice');

    if(isMailbox){
      return { key:'mailbox', cls:'gsp-task-mailbox', defaultMax: 20, barColor: '#f59e0b' };
    }
    if(isCall){
      return { key:'call', cls:'gsp-task-call', defaultMax: 25, barColor: '#16a34a' };
    }
    if(isBackOffice){
      return { key:'backoffice', cls:'gsp-task-backoffice', defaultMax: 20, barColor: '#f59e0b' };
    }

    // Fallback: use configured task color when available.
    const c = (meta && meta.color) ? String(meta.color) : '#4f8bff';
    return { key:'generic', cls:'gsp-task-generic', defaultMax: 20, barColor: c };
  };

  GP.defaultMaxHours = function(taskId, ctx){
    try{
      const lay = GP.getTaskLayout(taskId, ctx);
      const n = Number(lay && lay.defaultMax ? lay.defaultMax : 20);
      return (Number.isFinite(n) && n > 0) ? n : 20;
    }catch(_e){
      return 20;
    }
  };

  // Permanent, default visualization: landscape progress bar using percent width.
  GP.renderProgressBarHTML = function(data){
    const pct = clamp(data && data.pct, 0, 100);
    const color = String((data && data.color) || '#4f8bff');
    const title = String((data && data.title) || '');
    const pctText = String((data && data.pctText) || (Math.round(pct) + '%'));
    return (
      '<div class="gsp-progress" role="img" aria-label="Progress bar" title="' + escAttr(title) + '">' +
        '<div class="gsp-progress-track" style="--p:' + pct.toFixed(4) + ';--c:' + escAttr(color) + '">' +
          '<div class="gsp-progress-fill"></div>' +
          '<div class="gsp-progress-label">' + escAttr(pctText) + '</div>' +
        '</div>' +
      '</div>'
    );
  };

  // Resizable helper: adds 8 enterprise-grade resize handles (edges + corners).
  // The Members page persists geometry via its own saveGraphState().
  GP.enableResizable = function(panel, opts){
    try{
      if(!panel || panel._gspResizableEnabled) return;
      panel._gspResizableEnabled = true;

      const o = opts || {};
      const minW = Number.isFinite(o.minWidth) ? o.minWidth : 320;
      const minH = Number.isFinite(o.minHeight) ? o.minHeight : 240;
      const onResizeEnd = (typeof o.onResizeEnd === 'function') ? o.onResizeEnd : null;

      const dirs = ['n','s','e','w','ne','nw','se','sw'];
      for(const d of dirs){
        const h = document.createElement('div');
        h.className = 'gsp-resize-handle gsp-rh-' + d;
        h.dataset.dir = d;
        h.tabIndex = -1;
        panel.appendChild(h);
      }

      function viewportMax(){
        return {
          w: Math.max(320, window.innerWidth - 16),
          h: Math.max(240, window.innerHeight - 16),
        };
      }

      function ensureLeftTop(){
        // Ensure we resize from left/top coordinate space.
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        const r = panel.getBoundingClientRect();
        if(!panel.style.left) panel.style.left = Math.round(r.left) + 'px';
        if(!panel.style.top) panel.style.top = Math.round(r.top) + 'px';
      }

      let resizing = false;
      let dir = 'se';
      let sx = 0, sy = 0;
      let start = null;

      function onDown(e){
        if(e.button !== 0) return;
        const t = e.currentTarget;
        if(!t || !t.dataset) return;
        e.preventDefault();
        e.stopPropagation();
        ensureLeftTop();
        resizing = true;
        dir = String(t.dataset.dir || 'se');
        const r = panel.getBoundingClientRect();
        sx = e.clientX; sy = e.clientY;
        start = { left: r.left, top: r.top, width: r.width, height: r.height };
        try{ t.setPointerCapture(e.pointerId); }catch(_e){}
        panel.classList.add('gsp-resizing');
      }

      function onMove(e){
        if(!resizing || !start) return;
        e.preventDefault();
        e.stopPropagation();

        const dx = e.clientX - sx;
        const dy = e.clientY - sy;
        const isN = dir.includes('n');
        const isS = dir.includes('s');
        const isE = dir.includes('e');
        const isW = dir.includes('w');

        let left = start.left;
        let top = start.top;
        let width = start.width;
        let height = start.height;

        if(isE) width = start.width + dx;
        if(isS) height = start.height + dy;
        if(isW){ width = start.width - dx; left = start.left + dx; }
        if(isN){ height = start.height - dy; top = start.top + dy; }

        const vmax = viewportMax();
        width = clamp(width, minW, vmax.w);
        height = clamp(height, minH, vmax.h);

        // If clamped, adjust left/top so we don't drift.
        if(isW){ left = start.left + (start.width - width); }
        if(isN){ top = start.top + (start.height - height); }

        left = clamp(left, 8, Math.max(8, window.innerWidth - width - 8));
        top = clamp(top, 8, Math.max(8, window.innerHeight - height - 8));

        panel.style.left = Math.round(left) + 'px';
        panel.style.top = Math.round(top) + 'px';
        panel.style.width = Math.round(width) + 'px';
        panel.style.height = Math.round(height) + 'px';
      }

      function onUp(e){
        if(!resizing) return;
        resizing = false;
        start = null;
        panel.classList.remove('gsp-resizing');
        try{ e.currentTarget.releasePointerCapture(e.pointerId); }catch(_e){}
        if(onResizeEnd) {
          try{ onResizeEnd(); }catch(_e){}
        }
      }

      const handles = panel.querySelectorAll('.gsp-resize-handle');
      handles.forEach(h=>{
        h.addEventListener('pointerdown', onDown);
        h.addEventListener('pointermove', onMove);
        h.addEventListener('pointerup', onUp);
        h.addEventListener('pointercancel', onUp);
      });
    }catch(_e){
      // non-fatal
    }
  };
})();
