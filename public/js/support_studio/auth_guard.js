/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

  (function() {
    'use strict';
    function _hasSession() {
      try {
        // Primary: CloudAuth session key
        var raw = localStorage.getItem('mums_supabase_session')
                || sessionStorage.getItem('mums_supabase_session');
        if (raw) {
          var p = JSON.parse(raw);
          if (p && p.access_token) return true;
          // Check expires_at if present — don't redirect on slightly-stale token
          // (CloudAuth will refresh it; just let the app handle 401s)
          if (p && p.refresh_token) return true;
        }
      } catch (_) {}
      try {
        // Legacy fallback keys
        var legacyKeys = ['mums_access_token', 'sb-access-token', 'supabase.auth.token'];
        for (var i = 0; i < legacyKeys.length; i++) {
          var v = localStorage.getItem(legacyKeys[i]) || sessionStorage.getItem(legacyKeys[i]);
          if (v && v.length > 20) return true;
        }
      } catch (_) {}
      return false;
    }

    if (!_hasSession()) {
      // Preserve the intended destination for redirect-back after login
      try {
        var dest = window.location.pathname + window.location.search + window.location.hash;
        if (dest && dest !== '/' && dest !== '/login.html') {
          sessionStorage.setItem('mums_redirect_after_login', dest);
        }
      } catch (_) {}
      window.location.replace('/login.html');
    }
  })();
