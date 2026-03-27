/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */
/*
  MUMS Phase 1 — Build/Version Source of Truth

  Governance:
  - Build sequence and cache-bust token MUST be defined here.
  - UI build labels should be rendered via data-build-label placeholders.
  - Packager reads SEQ from this file to create MUMS Phase 1-<SEQ>.zip,
    then bumps SEQ and cache-bust tokens for the next release.
*/
(function(){
  'use strict';

  // Single source of truth for release sequence.
  const SEQ = 637;

  const buildLabel = `MUMS Phase 1-${SEQ}`;
  const cacheBust = `p1-${SEQ}`;

  // Export globally (used by config.js and optional UI helpers)
  try{
    window.MUMS_VERSION = {
      seq: SEQ,
      buildLabel,
      cacheBust,
    };
  }catch(_){ /* non-browser */ }

  function applyBuildLabel(){
    try{
      const nodes = document.querySelectorAll('[data-build-label]');
      for(const n of nodes){
        n.textContent = buildLabel;
      }

      // Normalize title: remove any prior explicit build suffix, then append current build.
      const t = String(document.title || '');
      const cleaned = t.replace(/\s*\(Build\s+MUMS\s+Phase\s+1-\d+\)\s*/g, '').trim();
      const suffix = ` (Build ${buildLabel})`;
      document.title = cleaned.endsWith(suffix.trim()) ? cleaned : (cleaned + suffix);
    }catch(_){ /* ignore */ }
  }

  // Apply immediately and on DOM ready.
  try{
    if(document.readyState === 'loading'){
      document.addEventListener('DOMContentLoaded', applyBuildLabel);
    }else{
      applyBuildLabel();
    }
  }catch(_){ /* ignore */ }
})();
