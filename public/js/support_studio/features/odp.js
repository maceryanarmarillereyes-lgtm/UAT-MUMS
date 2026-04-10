/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

/* ══════════════════════════════════════════════════════════════════
   ONE DAY PASSWORD — Engine v1.0
   - Manila Time (UTC+8) dates
   - Supabase Realtime subscription (postgres_changes on daily_passwords)
   - All authenticated users can read + write
   ══════════════════════════════════════════════════════════════════ */
(function() {
  'use strict';

  var _odpState = {
    view: { year: 0, month: 0 },
    rows: [],           // loaded month rows: { date, label, password, updated_by, is_today, is_yesterday }
    dirty: {},          // { date: newPassword } — user edits not yet saved
    saving: {},         // { date: true } — in-flight saves
    rtChannel: null,    // Supabase realtime channel
    sbClient: null,     // dedicated Supabase client for ODP realtime
    homeData: null,     // { today, yesterday }
    homeTimer: null,
    pollInterval: null,
  };

  /* ── Token helper (reuse same pattern as rest of file) ─────── */
  function _odpGetToken() {
    try {
      var raw = localStorage.getItem('mums_supabase_session') || sessionStorage.getItem('mums_supabase_session');
      if (raw) { try { var p = JSON.parse(raw); var t = p && (p.access_token || (p.session && p.session.access_token)); if (t) return String(t); } catch(_) {} }
      if (window.CloudAuth && typeof window.CloudAuth.accessToken === 'function') { var t2 = window.CloudAuth.accessToken(); if (t2) return String(t2); }
      if (window.Auth && typeof window.Auth.getSession === 'function') { var s = window.Auth.getSession(); if (s && s.access_token) return String(s.access_token); }
    } catch(_) {}
    return '';
  }

  function _odpAuthHeaders() {
    var t = _odpGetToken();
    return t ? { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
  }

  /* ── Manila Time helpers ───────────────────────────────────── */
  function _getManilaDateStr(offsetDays) {
    offsetDays = offsetDays || 0;
    var now = new Date();
    var manila = new Date(now.getTime() + (8 * 60 * 60 * 1000) + (offsetDays * 86400000));
    return manila.toISOString().slice(0, 10);
  }

  function _getManilaMonthYear() {
    var today = _getManilaDateStr(0);
    var parts = today.split('-');
    return { year: parseInt(parts[0], 10), month: parseInt(parts[1], 10) };
  }

  function _monthLabel(year, month) {
    var dt = new Date(Date.UTC(year, month - 1, 1));
    return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', timeZone: 'UTC' });
  }

  /* ── API calls ─────────────────────────────────────────────── */
  async function _odpFetchHome() {
    try {
      var r = await fetch('/api/studio/daily_passwords', { headers: _odpAuthHeaders() });
      if (!r.ok) return null;
      return await r.json();
    } catch(_) { return null; }
  }

  async function _odpFetchMonth(year, month) {
    try {
      var url = '/api/studio/daily_passwords?mode=month&year=' + year + '&month=' + month;
      var r = await fetch(url, { headers: _odpAuthHeaders() });
      if (!r.ok) return null;
      return await r.json();
    } catch(_) { return null; }
  }

  async function _odpSaveRow(date, password) {
    try {
      var r = await fetch('/api/studio/daily_passwords', {
        method: 'POST',
        headers: _odpAuthHeaders(),
        body: JSON.stringify({ date: date, password: password })
      });
      if (!r.ok) return null;
      return await r.json();
    } catch(_) { return null; }
  }

  /* ── Home card renderer ─────────────────────────────────────── */
  function _odpRenderHome(data) {
    if (!data || !data.ok) return;
    _odpState.homeData = data;

    // Yesterday cell
    var lbY = document.getElementById('hp-odp-label-yesterday');
    var pwY = document.getElementById('hp-odp-pw-yesterday');
    if (lbY) lbY.textContent = data.yesterday ? data.yesterday.label : '—';
    if (pwY) {
      var yPw = data.yesterday && data.yesterday.password ? data.yesterday.password : '';
      pwY.textContent = yPw || '—';
      pwY.classList.toggle('odp-empty', !yPw);
    }

    // Today cell
    var lbT = document.getElementById('hp-odp-label-today');
    var pwT = document.getElementById('hp-odp-pw-today');
    if (lbT) lbT.textContent = data.today ? data.today.label : '—';
    if (pwT) {
      var tPw = data.today && data.today.password ? data.today.password : '';
      pwT.textContent = tPw || '—';
      pwT.classList.toggle('odp-empty', !tPw);
    }

    // Keep legacy id in sync
    var legacyEl = document.getElementById('hp-oneday-pw');
    if (legacyEl) legacyEl.textContent = (data.today && data.today.password) ? data.today.password : '--';
  }

  /* ── Home data loader ───────────────────────────────────────── */
  async function _odpLoadHome() {
    var data = await _odpFetchHome();
    _odpRenderHome(data);
  }

  /* ── Modal renderer ─────────────────────────────────────────── */
  function _odpRenderTable() {
    var tbody = document.getElementById('odp-tbody');
    if (!tbody) return;

    var today     = _getManilaDateStr(0);
    var yesterday = _getManilaDateStr(-1);
    var rows      = _odpState.rows;

    // Should never be empty after client-side generation, but guard anyway
    if (!rows || rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:20px;color:var(--ss-muted);font-size:11px;">Click the arrows to navigate months.</td></tr>';
      return;
    }

    var html = '';
    rows.forEach(function(row) {
      var dateStr   = row.date;
      var isToday   = (dateStr === today);
      var isYest    = (dateStr === yesterday);
      var currentPw = Object.prototype.hasOwnProperty.call(_odpState.dirty, dateStr)
        ? _odpState.dirty[dateStr]
        : (row.password || '');

      var trClass = isToday ? 'odp-row-today' : (isYest ? 'odp-row-yesterday' : '');

      var badgeHtml = '';
      if (isToday)     badgeHtml = ' <span class="odp-badge-today">Today</span>';
      else if (isYest) badgeHtml = ' <span class="odp-badge-yesterday">Yesterday</span>';

      var metaHtml = '';
      if (row.updated_by) {
        var name = String(row.updated_by).split('@')[0];
        metaHtml = '<span class="odp-meta-txt" title="' + _esc(row.updated_by) + '">' + _esc(name) + '</span>';
      }

      var inputClass = 'odp-input' + (currentPw ? ' odp-has-val' : '');
      var saveBtnId  = 'odp-sbtn-' + dateStr;

      html += '<tr class="' + trClass + '" data-date="' + _esc(dateStr) + '">'
        // Column 1: Date
        + '<td style="width:42%;"><div class="odp-date-badge">'
        +   '<span class="odp-date-txt">' + _esc(row.label) + '</span>'
        +   badgeHtml
        + '</div>' + metaHtml + '</td>'
        // Column 2: Password input
        + '<td style="width:45%;">'
        +   '<input type="text"'
        +   ' id="odp-inp-' + _esc(dateStr) + '"'
        +   ' class="' + inputClass + '"'
        +   ' data-date="' + _esc(dateStr) + '"'
        +   ' value="' + _esc(currentPw) + '"'
        +   ' placeholder="Enter password…"'
        +   ' autocomplete="off" spellcheck="false"'
        +   ' oninput="window._odpOnInput(this)"'
        +   ' onkeydown="if(event.key===\'Enter\'){window._odpSaveSingleByEl(this.closest(\'tr\').querySelector(\'.odp-row-save-btn\'));}"'
        +   ' />'
        + '</td>'
        // Column 3: Save button
        + '<td style="width:13%;text-align:center;">'
        +   '<button id="' + _esc(saveBtnId) + '" class="odp-row-save-btn" data-date="' + _esc(dateStr) + '"'
        +   ' onclick="window._odpSaveSingleByEl(this)">'
        +   (currentPw ? '<i class="fas fa-floppy-disk"></i> Save' : 'Save')
        +   '</button>'
        + '</td>'
        + '</tr>';
    });

    tbody.innerHTML = html;
  }

  function _esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* ── Modal open/close ───────────────────────────────────────── */
  window._odpOpenModal = async function() {
    var modal = document.getElementById('odp-modal');
    if (!modal) return;
    modal.classList.add('odp-open');

    // Init view to current Manila month
    if (!_odpState.view.year) {
      var mv = _getManilaMonthYear();
      _odpState.view.year  = mv.year;
      _odpState.view.month = mv.month;
    }

    _odpUpdateNavLabel();
    await _odpLoadModalMonth();
  };

  window._odpCloseModal = function() {
    var modal = document.getElementById('odp-modal');
    if (modal) modal.classList.remove('odp-open');
    _odpState.dirty = {};
  };

  // Close on backdrop click
  document.addEventListener('DOMContentLoaded', function() {
    var modal = document.getElementById('odp-modal');
    if (modal) {
      modal.addEventListener('click', function(e) {
        if (e.target === modal) window._odpCloseModal();
      });
    }
  });

  /* ── Month navigation ───────────────────────────────────────── */
  window._odpNavMonth = async function(delta) {
    var s = _odpState.view;
    s.month += delta;
    if (s.month > 12) { s.month = 1;  s.year++; }
    if (s.month < 1)  { s.month = 12; s.year--; }
    _odpState.dirty = {};
    _odpUpdateNavLabel();
    await _odpLoadModalMonth();
  };

  function _odpUpdateNavLabel() {
    var el = document.getElementById('odp-nav-label');
    if (el) el.textContent = _monthLabel(_odpState.view.year, _odpState.view.month);
  }

  /* ── Client-side month row generator ───────────────────────── */
  function _odpBuildClientRows(year, month) {
    var today     = _getManilaDateStr(0);
    var yesterday = _getManilaDateStr(-1);
    var totalDays = new Date(year, month, 0).getDate();
    var rows = [];
    for (var d = 1; d <= totalDays; d++) {
      var mm = month < 10 ? '0' + month : String(month);
      var dd = d < 10 ? '0' + d : String(d);
      var dateStr = year + '-' + mm + '-' + dd;
      var dt = new Date(Date.UTC(year, month - 1, d));
      var label = dt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
      rows.push({
        date:         dateStr,
        label:        label,
        password:     '',
        updated_by:   '',
        updated_at:   null,
        is_today:     dateStr === today,
        is_yesterday: dateStr === yesterday,
      });
    }
    return rows;
  }

  async function _odpLoadModalMonth() {
    var tbody = document.getElementById('odp-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:24px;color:var(--ss-muted);font-size:11px;"><i class="fas fa-spinner fa-spin" style="margin-right:6px;"></i>Loading...</td></tr>';

    var year  = _odpState.view.year;
    var month = _odpState.view.month;

    // ALWAYS build full month rows client-side — table always shows all dates
    var clientRows = _odpBuildClientRows(year, month);

    // Overlay saved passwords from API if available
    try {
      var data = await _odpFetchMonth(year, month);
      if (data && data.ok && Array.isArray(data.rows) && data.rows.length > 0) {
        var pwMap = {};
        data.rows.forEach(function(r) {
          if (r.date) pwMap[r.date] = { password: r.password || '', updated_by: r.updated_by || '', updated_at: r.updated_at || null };
        });
        clientRows.forEach(function(row) {
          if (pwMap[row.date]) {
            row.password   = pwMap[row.date].password;
            row.updated_by = pwMap[row.date].updated_by;
            row.updated_at = pwMap[row.date].updated_at;
          }
        });
      }
    } catch(_) {
      // API failed — still render editable rows with empty passwords
    }

    _odpState.rows = clientRows;
    _odpRenderTable();
  }

  /* ── Input handler ──────────────────────────────────────────── */
  window._odpOnInput = function(input) {
    var dateStr = input.getAttribute('data-date');
    if (!dateStr) return;
    _odpState.dirty[dateStr] = input.value;
    input.classList.toggle('odp-has-val', !!input.value);
  };

  /* ── Save single row ────────────────────────────────────────── */
  // Helper: called from inline onclick via element reference (avoids quote-escaping issues)
  window._odpSaveSingleByEl = function(el) {
    var dateStr = el && el.getAttribute && el.getAttribute('data-date');
    if (dateStr) window._odpSaveSingle(dateStr);
  };

  window._odpSaveSingle = async function(dateStr) {
    var btn   = document.getElementById('odp-sbtn-' + dateStr) || document.querySelector('.odp-row-save-btn[data-date="' + dateStr + '"]');
    var input = document.getElementById('odp-inp-' + dateStr)   || document.querySelector('.odp-input[data-date="' + dateStr + '"]');
    if (!btn || !input) return;

    if (_odpState.saving[dateStr]) return;
    _odpState.saving[dateStr] = true;

    var pw = input.value.trim();
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

    var result = await _odpSaveRow(dateStr, pw);

    delete _odpState.saving[dateStr];

    if (result && result.ok) {
      delete _odpState.dirty[dateStr];
      // Update local row data
      var row = _odpState.rows.find(function(r) { return r.date === dateStr; });
      if (row) row.password = pw;

      btn.innerHTML = '<i class="fas fa-check"></i> Saved';
      btn.classList.add('odp-saved');
      input.classList.toggle('odp-has-val', !!pw);
      setTimeout(function() {
        btn.innerHTML = '<i class="fas fa-floppy-disk"></i> Save';
        btn.classList.remove('odp-saved');
        btn.disabled = false;
      }, 2000);

      _odpShowToast('Password for ' + dateStr + ' saved!');

      // Refresh home card if today or yesterday
      var today = _getManilaDateStr(0);
      var yest  = _getManilaDateStr(-1);
      if (dateStr === today || dateStr === yest) {
        _odpLoadHome();
      }
    } else {
      btn.innerHTML = '<i class="fas fa-times"></i> Error';
      btn.style.color = '#f85149';
      setTimeout(function() {
        btn.innerHTML = 'Save';
        btn.style.color = '';
        btn.disabled = false;
      }, 2000);
    }
  };

  /* ── Save all dirty rows ────────────────────────────────────── */
  window._odpSaveAll = async function() {
    var saveBtn = document.getElementById('odp-save-all-btn');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…'; }

    var dirtyDates = Object.keys(_odpState.dirty);
    if (dirtyDates.length === 0) {
      _odpShowToast('No changes to save');
      if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fas fa-cloud-arrow-up"></i> Save All Changes'; }
      return;
    }

    var success = 0;
    var fail = 0;
    for (var i = 0; i < dirtyDates.length; i++) {
      var d = dirtyDates[i];
      var pw = _odpState.dirty[d];
      var result = await _odpSaveRow(d, pw);
      if (result && result.ok) {
        delete _odpState.dirty[d];
        var row = _odpState.rows.find(function(r) { return r.date === d; });
        if (row) row.password = pw;
        success++;
      } else { fail++; }
    }

    _odpRenderTable();
    _odpLoadHome();

    if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fas fa-cloud-arrow-up"></i> Save All Changes'; }

    if (fail === 0) {
      _odpShowToast(success + ' password' + (success !== 1 ? 's' : '') + ' saved successfully!');
    } else {
      _odpShowToast(success + ' saved, ' + fail + ' failed. Check console.', true);
    }
  };

  /* ── Toast ──────────────────────────────────────────────────── */
  function _odpShowToast(msg, isError) {
    var toast = document.getElementById('odp-toast');
    var msgEl = document.getElementById('odp-toast-msg');
    if (!toast || !msgEl) return;
    msgEl.textContent = msg;
    toast.style.borderColor = isError ? 'rgba(248,81,73,.35)' : 'rgba(251,146,60,.3)';
    toast.style.color        = isError ? '#f85149' : 'var(--ss-orange)';
    toast.classList.add('odp-toast-show');
    clearTimeout(_odpState._toastTimer);
    _odpState._toastTimer = setTimeout(function() {
      toast.classList.remove('odp-toast-show');
    }, 3000);
  }

  /* ── Realtime subscription via Supabase ─────────────────────── */
  // Waits for Supabase SDK to be available before subscribing.
  // support_studio.html loads the SDK asynchronously — we must not
  // attempt createClient() before window.supabase exists.
  function _odpSetupRealtime() {
    // If SDK already loaded, go straight to subscribe
    if (window.supabase && typeof window.supabase.createClient === 'function') {
      _odpDoSubscribe();
    } else {
      // Listen for our custom event fired by the SDK loader onload
      window.addEventListener('mums:supabase_ready', function onSbReady() {
        window.removeEventListener('mums:supabase_ready', onSbReady);
        _odpDoSubscribe();
      });
      // Safety timeout: if SDK never loads in 8s, start polling fallback
      setTimeout(function() {
        if (!_odpState.rtChannel) {
          console.warn('[ODP] Supabase SDK not ready after 8s — using poll fallback');
          _odpStartPolling();
        }
      }, 8000);
    }
  }

  async function _odpDoSubscribe() {
    try {
      // Wait for env
      if (window.EnvRuntime && EnvRuntime.ready) {
        await EnvRuntime.ready();
      }
      var env = (window.EnvRuntime && EnvRuntime.env && EnvRuntime.env()) || (window.MUMS_ENV || {});
      if (!env || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
        console.warn('[ODP] No Supabase env — using poll fallback');
        _odpStartPolling();
        return;
      }

      var token = _odpGetToken();

      // Build a dedicated ODP realtime client so we don't interfere with __MUMS_SB_CLIENT
      if (_odpState.sbClient) {
        try { _odpState.sbClient.removeAllChannels(); } catch(_) {}
      }
      _odpState.sbClient = window.supabase.createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
          storage: { getItem: function(){ return null; }, setItem: function(){}, removeItem: function(){} },
          storageKey: 'mums_odp_rt'
        },
        realtime: { params: { eventsPerSecond: 10 } },
        global: { headers: token ? { Authorization: 'Bearer ' + token } : {} }
      });

      // FIX v3.9.30: Authorize the Realtime WebSocket socket explicitly.
      // Without setAuth(), the WS connection uses the anon key only — Supabase Realtime
      // rejects postgres_changes subscriptions on RLS-protected tables for anon role,
      // causing CHANNEL_ERROR. setAuth() passes the user JWT over the WS handshake.
      try {
        if (_odpState.sbClient.realtime && typeof _odpState.sbClient.realtime.setAuth === 'function') {
          _odpState.sbClient.realtime.setAuth(token);
        }
      } catch(_setAuthErr) {}

      _odpState.rtChannel = _odpState.sbClient
        .channel('odp-daily-passwords-v2')
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'daily_passwords'
        }, function(payload) {
          _odpHandleRealtimeEvent(payload);
        })
        .subscribe(function(status) {
          if (status === 'SUBSCRIBED') {
            console.log('[ODP] Realtime LIVE on daily_passwords');
            // Clear poll fallback if realtime connected
            if (_odpState.pollInterval) {
              clearInterval(_odpState.pollInterval);
              _odpState.pollInterval = null;
            }
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            console.warn('[ODP] Realtime status:', status, '— activating poll fallback');
            _odpStartPolling();
          }
        });

    } catch(err) {
      console.warn('[ODP] Realtime setup failed:', err);
      _odpStartPolling();
    }
  }

  function _odpHandleRealtimeEvent(payload) {
    try {
      var record = (payload && payload.new) ? payload.new : null;
      if (!record || !record.date) return;

      console.log('[ODP] Realtime event received for date:', record.date);

      var today = _getManilaDateStr(0);
      var yest  = _getManilaDateStr(-1);

      // Update home card if today or yesterday changed
      if (record.date === today || record.date === yest) {
        // Patch homeData directly from realtime payload — instant UI update, no API call needed
        var hd = _odpState.homeData || { ok: true, today: { date: today, label: '', password: '' }, yesterday: { date: yest, label: '', password: '' } };
        hd.ok = true;
        if (record.date === today) {
          if (!hd.today) hd.today = {};
          hd.today.date     = record.date;
          hd.today.label    = hd.today.label || record.date;
          hd.today.password = record.password || '';
        } else {
          if (!hd.yesterday) hd.yesterday = {};
          hd.yesterday.date     = record.date;
          hd.yesterday.label    = hd.yesterday.label || record.date;
          hd.yesterday.password = record.password || '';
        }
        _odpRenderHome(hd);

        // Also do a fresh API fetch after 500ms to ensure labels are correct
        setTimeout(_odpLoadHome, 500);
      }

      // Update modal table if visible and on matching month
      var modalOpen = document.getElementById('odp-modal') && document.getElementById('odp-modal').classList.contains('odp-open');
      if (modalOpen) {
        var dateParts = record.date.split('-');
        var ry = parseInt(dateParts[0], 10);
        var rm = parseInt(dateParts[1], 10);
        if (ry === _odpState.view.year && rm === _odpState.view.month) {
          var row = _odpState.rows.find(function(r) { return r.date === record.date; });
          if (row) {
            row.password    = record.password || '';
            row.updated_by  = record.updated_by || '';
            // Only re-render if not currently dirty for that date
            if (!Object.prototype.hasOwnProperty.call(_odpState.dirty, record.date)) {
              var inp = document.querySelector('.odp-input[data-date="' + record.date + '"]');
              if (inp) {
                inp.value = row.password;
                inp.classList.toggle('odp-has-val', !!row.password);
              }
            }
          }
        }
      }
    } catch(err) {
      console.warn('[ODP] RT event handler error:', err);
    }
  }

  /* ── Polling fallback (if Realtime unavailable) ─────────────── */
  function _odpStartPolling() {
    if (_odpState.pollInterval) return; // already polling
    // Poll every 15s as fallback when realtime is unavailable
    _odpState.pollInterval = setInterval(function() {
      _odpLoadHome();
    }, 15000);
    // Also refresh when tab regains focus (user switches back to window)
    if (!_odpState._visibilityBound) {
      _odpState._visibilityBound = true;
      document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'visible') {
          _odpLoadHome();
        }
      });
    }
  }

  /* ── Auto-refresh home card every 5min for date rollover ────── */
  function _odpScheduleHomeRefresh() {
    // Run at midnight Manila time (date might change)
    clearTimeout(_odpState.homeTimer);
    var manilaMs = Date.now() + (8 * 60 * 60 * 1000);
    var manilaDate = new Date(manilaMs);
    var msToMidnight = (
      (23 - manilaDate.getUTCHours()) * 3600000 +
      (59 - manilaDate.getUTCMinutes()) * 60000 +
      (60 - manilaDate.getUTCSeconds()) * 1000
    );
    _odpState.homeTimer = setTimeout(function() {
      _odpLoadHome();
      _odpScheduleHomeRefresh(); // reschedule for next midnight
    }, msToMidnight + 1000);
  }

  /* ── Init ───────────────────────────────────────────────────── */
  function _odpInit() {
    _odpLoadHome();
    _odpSetupRealtime();
    _odpScheduleHomeRefresh();
  }

  // Boot after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _odpInit);
  } else {
    // DOM already ready — wait a tick for other scripts to settle
    setTimeout(_odpInit, 200);
  }

  // Expose for external triggers
  window._odpRefreshHome = _odpLoadHome;

})();
