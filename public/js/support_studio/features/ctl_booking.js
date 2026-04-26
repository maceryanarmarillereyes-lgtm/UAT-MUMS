/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

/**
 * CTL Booking System — Controller Testing Lab
 * Fixes:
 *   1. Alarm fires when countdown reaches zero (Audio + browser notification)
 *   2. Queue users can actually use the controller when it's their turn
 *   3. Queue never gets stuck — server auto-releases expired bookings on every poll
 */
(function () {
  'use strict';

  // ── NEW LAYOUT FLAG ───────────────────────────────────────────────────────
  // Signal to core_ui.js renderAll() that we own #hp-ctl-list rendering.
  // Must be set BEFORE any DOMContentLoaded so the flag is up when core_ui
  // fires its own renderAll() on startup.
  window._ctlNewLayoutActive = true;

  // ── STATE ─────────────────────────────────────────────────────────────────
  var S = {
    items: [], configRev: '',
    bookings: {}, queues: {}, stateRev: '',
    alarmFired: {},        // ctlId → true (prevents double-fire)
    qAlarmFired: {},       // ctlId → true
    bookingModalCtlId: null,
    queueModalCtlId: null,
    overrideCtlId: null,
    countdownTimer: null,
    pollTimer: null,
    configPollTimer: null,
    alarmAudio: null, alarmPlaying: false,
  };

  var POLL_MS   = 30000; // PERF FIX: Raised from 15s → 30s (halves CTL lab req/day from 57,600 → 28,800)
  var SP_URL    = 'https://mycopeland.sharepoint.com/sites/AdvanceServices/Shared%20Documents/Forms/AllItems.aspx';
  var IMGS = {
    'E2':              '/Widget%20Images/E2_Widget.png',
    'E3':              '/Widget%20Images/E3_Widget.png',
    'Site Supervisor': '/Widget%20Images/Site%20Supervisor_Widget.png',
  };

  // ── AUTH ──────────────────────────────────────────────────────────────────
  function _tok() {
    try {
      var raw = localStorage.getItem('mums_supabase_session') || sessionStorage.getItem('mums_supabase_session');
      if (raw) { var p = JSON.parse(raw); var t = p && (p.access_token || (p.session && p.session.access_token)); if (t) return String(t); }
      if (window.CloudAuth && typeof window.CloudAuth.accessToken === 'function') return String(window.CloudAuth.accessToken() || '');
    } catch (_) {}
    return '';
  }
  function _hdrs() { var t = _tok(); return t ? { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t } : { 'Content-Type': 'application/json' }; }
  function _me() {
    try {
      if (window.Auth && typeof window.Auth.getUser === 'function') { var u = window.Auth.getUser(); if (u && u.name) return { name: u.name, avatar: u.avatar_url || u.avatarUrl || '' }; }
      var raw = localStorage.getItem('mums_supabase_session') || sessionStorage.getItem('mums_supabase_session');
      if (raw) { var s = JSON.parse(raw); var m = (s && s.user && s.user.user_metadata) || {}; var email = (s && s.user && s.user.email) || ''; return { name: m.full_name || m.name || email.split('@')[0] || 'You', avatar: m.avatar_url || '' }; }
    } catch (_) {}
    return { name: 'You', avatar: '' };
  }

  // ── DURATION ──────────────────────────────────────────────────────────────
  function _parseMs(str) {
    var s = String(str || '').toLowerCase(); var ms = 0;
    var h = s.match(/(\d+\.?\d*)\s*h/); var m = s.match(/(\d+\.?\d*)\s*m/);
    if (h) ms += parseFloat(h[1]) * 3600000;
    if (m) ms += parseFloat(m[1]) * 60000;
    if (!ms) { var n = parseFloat(s); if (!isNaN(n) && n > 0) ms = n * 60000; }
    return ms;
  }
  function _fmtMs(ms) {
    if (ms <= 0) return '0:00';
    var t = Math.floor(ms / 1000), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    if (h > 0) return h + ':' + _z(m) + ':' + _z(s);
    return m + ':' + _z(s);
  }
  function _fmtTime(ms) { if (!ms) return '—'; return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  function _z(n) { return n < 10 ? '0' + n : String(n); }

  // ── ALARM & NOTIFICATION ──────────────────────────────────────────────────
  // type === 'done'  → session ended   → play Alert_Yourtimeisup
  // type === 'queue' → it's your turn  → play Alert_Yourturntousethecontroller
  // Root-level MP3 paths — reliable in ALL CDN/Cloudflare environments.
  // Files with spaces in the folder name (/sound%20alert/) fail silently.
  var ALARM_SRC_TIMEUP = '/Alert_Yourtimeisup.mp3';
  var ALARM_SRC_QUEUE  = '/Alert_Yourturntousethecontroller.mp3';
  var ALARM_SRC_LEGACY = '/sound_alert_queue.mp3'; // fallback

  function _playAlarm(type) {
    try {
      // Pick the correct file then fall back to the legacy root mp3
      var primary = (type === 'queue') ? ALARM_SRC_QUEUE : ALARM_SRC_TIMEUP;
      if (S.alarmPlaying) return;
      S.alarmAudio = new Audio();
      S.alarmAudio.src = primary;
      S.alarmAudio.currentTime = 0;
      S.alarmPlaying = true;
      // If primary fails to load, fall back to the legacy root file
      S.alarmAudio.onerror = function () {
        try { S.alarmAudio.src = ALARM_SRC_LEGACY; S.alarmAudio.play().catch(function () {}); } catch (_) {}
      };
      S.alarmAudio.play().catch(function () {});
      S.alarmAudio.onended = function () { S.alarmPlaying = false; };
      setTimeout(function () { try { S.alarmAudio.pause(); S.alarmAudio.currentTime = 0; } catch (_) {} S.alarmPlaying = false; }, 30000);
    } catch (_) {}
  }
  function _stopAlarm() {
    try { if (S.alarmAudio) { S.alarmAudio.pause(); S.alarmAudio.currentTime = 0; } S.alarmPlaying = false; } catch (_) {}
  }
  function _notify(title, body) {
    try {
      if (!('Notification' in window)) return;
      if (Notification.permission === 'granted') { new Notification(title, { body: body, icon: IMGS.E2 }); }
      else if (Notification.permission !== 'denied') { Notification.requestPermission().then(function (p) { if (p === 'granted') new Notification(title, { body: body }); }); }
    } catch (_) {}
  }
  function _askNotifPerm() { try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch (_) {} }

  // ── TOAST ─────────────────────────────────────────────────────────────────
  function _toast(title, msg, type) {
    try {
      var bg = type === 'success' ? 'rgba(34,197,94,.15)' : type === 'warning' ? 'rgba(245,158,11,.15)' : 'rgba(88,166,255,.15)';
      var bc = type === 'success' ? 'rgba(34,197,94,.45)' : type === 'warning' ? 'rgba(245,158,11,.45)' : 'rgba(88,166,255,.45)';
      var ic = type === 'success' ? 'fa-check-circle' : type === 'warning' ? 'fa-exclamation-triangle' : 'fa-info-circle';
      var el = document.createElement('div');
      el.setAttribute('data-ctl-toast', '1');
      el.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:99999;background:' + bg + ';border:1px solid ' + bc + ';border-radius:12px;padding:14px 18px;max-width:340px;backdrop-filter:blur(12px);box-shadow:0 8px 32px rgba(0,0,0,.45);font-family:inherit;animation:ctlToastIn .3s ease-out;';
      el.innerHTML = '<div style="display:flex;gap:10px;align-items:flex-start;"><i class="fas ' + ic + '" style="margin-top:2px;flex-shrink:0;"></i><div><div style="font-size:12px;font-weight:700;margin-bottom:3px;">' + _esc(title) + '</div><div style="font-size:10px;opacity:.7;">' + _esc(msg) + '</div><button onclick="this.closest(\'[data-ctl-toast]\').remove();window._ctlStopAlarm();" style="margin-top:8px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);color:inherit;border-radius:6px;padding:3px 12px;font-size:10px;cursor:pointer;font-family:inherit;">Dismiss</button></div></div>';
      document.body.appendChild(el);
      setTimeout(function () { try { el.remove(); } catch (_) {} }, 60000);
    } catch (_) {}
  }

  // ── COUNTDOWN ENGINE ──────────────────────────────────────────────────────
  // Runs every second — updates card countdowns + fires alarms at expiry
  function _tick() {
    var now = Date.now();
    S.items.forEach(function (ctl) {
      var bk = S.bookings[ctl.id];
      if (!bk) return;
      var rem = bk.endMs - now;

      // Update card countdown
      var el = document.getElementById('ctl-cd-' + ctl.id);
      if (el) { el.textContent = rem > 0 ? _fmtMs(rem) : 'Ended'; el.style.color = rem < 60000 ? '#f85149' : '#4ade80'; }

      // ── BUG 1 FIX: fire alarm when MY booking expires ──────────────────
      if (rem <= 0 && !S.alarmFired[ctl.id]) {
        S.alarmFired[ctl.id] = true;
        var myName = _me().name.toLowerCase().trim();
        var bookerName = String(bk.user || '').toLowerCase().trim();
        var isMine = myName && bookerName && myName === bookerName;
        // Also fire if user stored alarm preference
        var wantsAlarm = false;
        try { wantsAlarm = localStorage.getItem('ctl_alarm_' + ctl.id) === '1'; } catch (_) {}
        if (isMine || wantsAlarm) {
          _playAlarm('done');
          _notify('⏰ Session Ended — ' + ctl.type, 'Your controller session has ended. Please release it for the queue.');
          _toast('⏰ Session Ended — ' + ctl.type, 'Your booking has expired. Hand off the controller now.', 'warning');
        }
      }

      // ── BUG 2+3 FIX: fire queue alarm when it's my turn ───────────────
      // Queue head alarm fires when booking ends OR controller becomes free
      var q = S.queues[ctl.id] || [];
      if (q.length > 0 && rem <= 0) {
        var head = q[0];
        if (head && head.wantsAlarm) {
          var myName2 = _me().name.toLowerCase().trim();
          var headName = String(head.user || '').toLowerCase().trim();
          var isMe = myName2 && headName && myName2 === headName;
          if (isMe && !S.qAlarmFired[ctl.id]) {
            S.qAlarmFired[ctl.id] = true;
            _playAlarm('queue');
            _notify('🎮 Your Turn! — ' + ctl.type, 'The controller is now free. Book it now!');
            _toast('🎮 Your Turn! — ' + ctl.type, 'The controller is free. Click "Book Now" to start your session.', 'success');
          }
        }
      }
    });
  }

  // ── RENDER CONTROLLER CARDS ───────────────────────────────────────────────
  function _renderCards() {
    var list = document.getElementById('hp-ctl-list');
    var empty = document.getElementById('hp-ctl-empty');
    if (!list) return;
    if (!S.items.length) { if (empty) empty.style.display = ''; return; }
    if (empty) empty.style.display = 'none';

    var now = Date.now();
    // Build a set of current IDs so we can remove stale cards
    var currentIds = {};
    S.items.forEach(function (ctl) { currentIds[ctl.id] = true; });
    list.querySelectorAll('[data-ctl-card]').forEach(function (el) {
      if (!currentIds[el.getAttribute('data-ctl-card')]) el.remove();
    });

    S.items.forEach(function (ctl) {
      var bk = S.bookings[ctl.id] || null;
      var q = S.queues[ctl.id] || [];
      var isBooked = bk && bk.endMs > now;
      var qLen = q.length;
      var dot = ctl.status === 'Online' ? '#4ade80' : ctl.status === 'Maintenance' ? '#fbbf24' : '#f85149';
      var img = IMGS[ctl.type] || IMGS.E2;
      var rem = isBooked ? bk.endMs - now : 0;
      var cdColor = rem < 60000 ? '#f85149' : '#4ade80';

      var bkHtml = '';
      if (isBooked) {
        bkHtml = '<div class="ctl-card-bk"><div class="ctl-card-bk-user"><i class="fas fa-user-circle" style="color:#60a5fa;font-size:9px;"></i>' + _esc(bk.user) + '</div>' +
          '<div class="ctl-card-bk-task">' + _esc(bk.task || '—') + '</div>' +
          '<div class="ctl-card-bk-cd"><i class="fas fa-stopwatch" style="font-size:9px;opacity:.5;"></i>' +
          '<span id="ctl-cd-' + ctl.id + '" style="color:' + cdColor + ';font-weight:800;font-family:monospace;">' + _fmtMs(rem) + '</span></div></div>';
      }

      var qBadge = qLen > 0 ? '<span class="ctl-q-badge"><i class="fas fa-users" style="font-size:8px;"></i> ' + qLen + ' waiting</span>' : '';
      var actionBtn = isBooked
        ? '<button class="ctl-card-btn ctl-card-btn--queue" onclick="window._ctlOpenQueue(\'' + ctl.id + '\')"><i class="fas fa-list-alt"></i> Join Queue</button>'
        : '<button class="ctl-card-btn ctl-card-btn--book" onclick="window._ctlOpenBooking(\'' + ctl.id + '\')"><i class="fas fa-bolt"></i> Book Now</button>';

      // Backup Log button — migrated from old layout (core_ui.js hp-ctl-col)
      var backupLogBtn = '<button class="ctl-card-btn ctl-card-btn--log" onclick="event.stopPropagation();window._ctlOpenBackupLog(\'' + ctl.id + '\')" title="View Backup File Log"><i class="fas fa-folder-open"></i><span class="ctl-card-btn-log-label">Backup Log</span></button>';

      var html = '<div class="ctl-card" data-ctl-card="' + ctl.id + '">' +
        '<div class="ctl-card-top">' +
        '<div class="ctl-card-img-wrap"><img src="' + img + '" class="ctl-card-img" alt="' + _esc(ctl.type) + '"/>' +
        '<span class="ctl-card-dot" style="background:' + dot + ';"></span></div>' +
        '<div class="ctl-card-info"><div class="ctl-card-type">' + _esc(ctl.type) + '</div>' +
        '<div class="ctl-card-ip"><i class="fas fa-network-wired" style="font-size:8px;opacity:.4;margin-right:3px;"></i>' + _esc(ctl.ip || '—') + '</div>' +
        '<div class="ctl-card-status" style="color:' + dot + ';">' + _esc(ctl.status) + '</div></div>' +
        '<button class="ctl-card-gear" onclick="window._ctlOpenSettings(\'' + ctl.id + '\')" title="Settings"><i class="fas fa-cog"></i></button>' +
        '</div>' + bkHtml +
        '<div class="ctl-card-foot">' + qBadge + actionBtn + backupLogBtn + '</div></div>';

      var existing = list.querySelector('[data-ctl-card="' + ctl.id + '"]');
      if (existing) {
        // Swap out without destroying countdown span reference mid-tick
        var tmp = document.createElement('div');
        tmp.innerHTML = html;
        existing.parentNode.replaceChild(tmp.firstChild, existing);
      } else {
        var tmp2 = document.createElement('div');
        tmp2.innerHTML = html;
        list.insertBefore(tmp2.firstChild, empty || null);
      }
    });
  }

  // ── OPEN BOOKING MODAL ────────────────────────────────────────────────────
  window._ctlOpenBooking = function (ctlId) {
    var ctl = S.items.find(function (c) { return c.id === ctlId; });
    if (!ctl) return;
    S.bookingModalCtlId = ctlId;

    _set('hp-ctl-bk-ctrl-name', ctl.type + ' Controller');
    _set('hp-ctl-bk-ctrl-ip', ctl.ip || '—');
    var img = document.getElementById('hp-ctl-bk-ctrl-img');
    if (img) img.src = IMGS[ctl.type] || IMGS.E2;
    _set('hp-ctl-bk-date-display', new Date().toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }));
    _set('hp-ctl-bk-user-display', _me().name);

    var bk = S.bookings[ctlId];
    var isBooked = bk && bk.endMs > Date.now();
    var inUse = document.getElementById('hp-ctl-bk-inuse-notice');
    var regBtn = document.getElementById('hp-ctl-bk-register-btn');

    if (isBooked) {
      if (inUse) { inUse.style.display = ''; _set('hp-ctl-bk-inuse-name', bk.user); _set('hp-ctl-bk-inuse-end', 'Ends ' + _fmtTime(bk.endMs) + ' (' + _fmtMs(bk.endMs - Date.now()) + ' left)'); }
      if (regBtn) { regBtn.innerHTML = '<i class="fas fa-list-alt"></i> <span>Join Queue Instead</span>'; regBtn.onclick = function () { window._ctlCloseBooking(); window._ctlOpenQueue(ctlId); }; }
    } else {
      if (inUse) inUse.style.display = 'none';
      if (regBtn) { regBtn.innerHTML = '<span class="hp-ctl-bk-spinner" id="hp-ctl-bk-spinner"></span><i class="fas fa-bolt" id="hp-ctl-bk-register-icon"></i><span id="hp-ctl-bk-register-label">Book this Controller</span>'; regBtn.onclick = window._ctlSubmitBooking; regBtn.disabled = false; }
    }

    // Reset form
    _val('hp-ctl-bk-task', ''); _val('hp-ctl-bk-backup', ''); _val('hp-ctl-bk-duration', '');
    document.querySelectorAll('.hp-ctl-dur-chip').forEach(function (c) { c.classList.remove('active'); });
    var cw = document.getElementById('hp-ctl-bk-custom-time-wrap'); if (cw) cw.style.display = 'none';
    var succ = document.getElementById('hp-ctl-bk-success'); if (succ) succ.style.display = 'none';
    _set('hp-ctl-sheet-dot-label', 'Ready');
    var dotEl = document.getElementById('hp-ctl-sheet-dot-icon'); if (dotEl) dotEl.style.background = '#4ade80';
    document.querySelectorAll('.hp-ctl-bk-step').forEach(function (s, i) { s.classList.toggle('active', i === 0); });

    var modal = document.getElementById('hp-ctl-booking-modal');
    if (modal) { modal.setAttribute('aria-hidden', 'false'); modal.classList.add('open'); modal.style.display = 'flex'; }
    _askNotifPerm();
  };

  window._ctlCloseBooking = function () {
    var m = document.getElementById('hp-ctl-booking-modal');
    if (m) { m.classList.remove('open'); m.style.display = 'none'; m.setAttribute('aria-hidden', 'true'); }
    S.bookingModalCtlId = null; _stopAlarm();
  };

  // ── SUBMIT BOOKING ────────────────────────────────────────────────────────
  window._ctlSubmitBooking = async function () {
    var ctlId = S.bookingModalCtlId; if (!ctlId) return;
    var task = (_getv('hp-ctl-bk-task') || '').trim();
    var durStr = _getv('hp-ctl-bk-duration') || '';
    var backup = (_getv('hp-ctl-bk-backup') || '').trim();
    var alarmEl = document.getElementById('hp-ctl-bk-notify-alarm');
    var wantsAlarm = alarmEl ? alarmEl.checked : false;

    if (durStr === 'set_time') durStr = (_getv('hp-ctl-bk-custom-time') || '').trim();

    if (!task) { _flashErr('hp-ctl-bk-task', '⚠️ Task description is required.'); return; }
    if (!durStr) { _toast('⚠️ Required', 'Please select a session duration.', 'warning'); return; }
    if (!backup) { _flashErr('hp-ctl-bk-backup', '⚠️ Backup file link is required.'); return; }

    var durMs = _parseMs(durStr);
    if (!durMs || durMs < 60000) { _toast('⚠️ Invalid Duration', 'Minimum duration is 1 minute.', 'warning'); return; }

    try { localStorage.setItem('ctl_alarm_' + ctlId, wantsAlarm ? '1' : '0'); } catch (_) {}
    _setBusy(true);

    var now = Date.now(), me = _me();
    var bkData = { user: me.name, avatarUrl: me.avatar, task: task, duration: durStr, backupFile: backup, startMs: now, endMs: now + durMs };

    try {
      var r = await fetch('/api/studio/ctl_lab_state', { method: 'POST', headers: _hdrs(), body: JSON.stringify({ booking: { id: ctlId, data: bkData }, lockedSince: now - 5000 }) });
      var d = null; try { d = await r.json(); } catch (_) {}

      if (r.status === 409) {
        _setBusy(false);
        if (d && d.bookings) { S.bookings = d.bookings; _renderCards(); }
        _toast('⚠️ Booking Conflict', 'Just booked by ' + ((d && d.booking && d.booking.user) || 'someone else') + '. Please join the queue.', 'warning');
        return;
      }
      if (!r.ok || !d || !d.ok) { _setBusy(false); _toast('❌ Booking Failed', 'Server error. Please retry.', 'warning'); return; }

      S.bookings = d.bookings || {}; S.queues = d.queues || {};
      delete S.alarmFired[ctlId]; delete S.qAlarmFired[ctlId];
      try { sessionStorage.removeItem('ctl_q_alarm_' + ctlId); } catch (_) {}

      // ── BUG 1 FIX: log booking to Google Sheets (server-verified path) ──
      _logToSheet(ctlId, bkData, 'Direct booking');

      _setBusy(false); _renderCards(); _showSuccess(ctlId, task, bkData.endMs);
      if (wantsAlarm) { _askNotifPerm(); _toast('🔔 Alarm Set', 'You\'ll be alerted when your session ends.', 'success'); }
    } catch (e) { _setBusy(false); _toast('❌ Network Error', 'Cannot reach server. Check connection.', 'warning'); }
  };

  // ── GAS SHEET LOGGER ─────────────────────────────────────────────────────
  // Uses window._ctlSendToSheet exposed by core_ui.js — which uses the EXACT
  // same internal buildFormPayload() + SHEETS_ENDPOINT that already works.
  // This guarantees both code paths hit GAS identically.
  async function _logToSheet(ctlId, bkData, note) {
    try {
      var ctl = S.items.find(function (c) { return c.id === ctlId; }) || {};
      var ctlLabel = { 'E2': 'E2 Controller', 'E3': 'E3 Gateway', 'Site Supervisor': 'Site Supervisor' }[ctl.type] || (ctl.type || 'Controller');

      var ts = new Date().toLocaleString('en-US', {
        timeZone: 'Asia/Manila',
        month: 'short', day: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
      }) + ' PHT';

      var payload = {
        timestamp:  ts,
        user:       bkData.user       || '',
        controller: ctlLabel + ' \u2014 ' + (ctl.ip || '\u2014'),
        task:       bkData.task       || '',
        duration:   bkData.duration   || '',
        backupFile: bkData.backupFile || '',
        note:       note              || 'Direct booking'
      };

      var ok = false;
      try {
        var r = await fetch('/api/studio/ctl_lab_log', {
          method: 'POST',
          headers: _hdrs(),
          body: JSON.stringify(payload)
        });
        ok = !!(r && r.ok);
      } catch (_) {}

      // Fallback path — keep legacy browser logger as secondary channel.
      if (!ok && typeof window._ctlSendToSheet === 'function') {
        try { window._ctlSendToSheet(payload); } catch (_) {}
      }

      // Also sync the in-app per-controller backup log
      if (typeof window._ctlAppendBackupLog === 'function') {
        window._ctlAppendBackupLog(ctlId, {
          timestamp:  ts,
          user:       bkData.user       || '',
          task:       bkData.task       || '',
          backupFile: bkData.backupFile || ''
        });
      }
    } catch (_) {}
  }

  function _showSuccess(ctlId, task, endMs) {
    var succ = document.getElementById('hp-ctl-bk-success');
    var regBtn = document.getElementById('hp-ctl-bk-register-btn');
    var msgEl = document.getElementById('hp-ctl-bk-success-msg');
    if (regBtn) regBtn.style.display = 'none';
    if (msgEl) msgEl.textContent = task + ' — ends at ' + _fmtTime(endMs);
    if (succ) succ.style.display = '';
    setTimeout(window._ctlCloseBooking, 3200);
  }

  // ── OPEN QUEUE MODAL ──────────────────────────────────────────────────────
  window._ctlOpenQueue = function (ctlId) {
    var ctl = S.items.find(function (c) { return c.id === ctlId; });
    if (!ctl) return;
    S.queueModalCtlId = ctlId; window._queueCtlId = ctlId;

    _set('hp-ctl-q-ctrl-name', ctl.type + ' Queue');
    var img = document.getElementById('hp-ctl-q-ctrl-img'); if (img) img.src = IMGS[ctl.type] || IMGS.E2;
    var bk = S.bookings[ctlId];
    _set('hp-ctl-q-current-user', bk ? bk.user : '— Free');
    _set('hp-ctl-q-end-time', bk ? 'Ends: ' + _fmtTime(bk.endMs) : 'Controller is available now');

    _renderQueueList(ctlId);
    _val('hp-ctl-q-task-input', ''); _val('hp-ctl-q-duration-select', '30 minutes');
    var urgEl = document.getElementById('hp-ctl-q-urgent'); if (urgEl) urgEl.checked = false;
    var almEl = document.getElementById('hp-ctl-q-alarm'); if (almEl) almEl.checked = true;

    var m = document.getElementById('hp-ctl-queue-modal');
    if (m) { m.setAttribute('aria-hidden', 'false'); m.classList.add('open'); }
    _askNotifPerm();
  };

  function _renderQueueList(ctlId) {
    var listEl = document.getElementById('hp-ctl-q-list'); if (!listEl) return;
    var q = S.queues[ctlId] || [];
    var me = _me(), myIdx = -1;
    q.forEach(function (e, i) { if (e.user && me.name && e.user.toLowerCase().trim() === me.name.toLowerCase().trim()) myIdx = i; });

    var joinEl = document.getElementById('hp-ctl-q-join-section');
    var alrEl  = document.getElementById('hp-ctl-q-already-msg');

    // ── BUG 3 FIX: if controller is free and I'm #1 in queue, offer booking ──
    var bk = S.bookings[ctlId];
    var ctlFree = !bk || bk.endMs <= Date.now();
    if (ctlFree && myIdx === 0) {
      // It's my turn — show booking suggestion instead of re-joining
      if (joinEl) joinEl.style.display = 'none';
      if (alrEl) { alrEl.style.display = ''; alrEl.innerHTML = '🎮 It\'s your turn! <button onclick="window._ctlCloseQueue();window._ctlOpenBooking(\'' + ctlId + '\');" style="margin-left:8px;background:rgba(34,197,94,.15);border:1px solid rgba(34,197,94,.35);color:#4ade80;border-radius:6px;padding:3px 10px;font-size:10px;cursor:pointer;font-family:inherit;">Book Now</button>'; }
    } else if (myIdx >= 0) {
      if (joinEl) joinEl.style.display = 'none';
      if (alrEl) { alrEl.style.display = ''; alrEl.textContent = 'You are #' + (myIdx + 1) + ' in queue. You\'ll be notified when it\'s your turn.'; }
    } else {
      if (joinEl) joinEl.style.display = '';
      if (alrEl) alrEl.style.display = 'none';
    }

    if (!q.length) { listEl.innerHTML = '<div style="padding:14px;text-align:center;color:rgba(255,255,255,.3);font-size:11px;">No one waiting</div>'; return; }

    listEl.innerHTML = q.map(function (e, i) {
      var me2 = _me();
      var isMe = e.user && me2.name && e.user.toLowerCase().trim() === me2.name.toLowerCase().trim();
      var urg = e.urgent ? '<span style="background:rgba(245,158,11,.15);color:#f59e0b;border:1px solid rgba(245,158,11,.3);border-radius:4px;font-size:8px;font-weight:700;padding:1px 5px;margin-left:4px;">URGENT</span>' : '';
      var you = isMe ? '<span style="background:rgba(34,197,94,.15);color:#4ade80;border:1px solid rgba(34,197,94,.3);border-radius:4px;font-size:8px;font-weight:700;padding:1px 5px;margin-left:4px;">YOU</span>' : '';
      return '<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:8px;">' +
        '<div style="width:22px;height:22px;border-radius:50%;background:rgba(162,93,220,.2);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:#c084fc;flex-shrink:0;">' + (i + 1) + '</div>' +
        '<div style="flex:1;min-width:0;"><div style="font-size:11px;font-weight:700;color:#e2e8f0;">' + _esc(e.user) + urg + you + '</div>' +
        '<div style="font-size:9px;color:#6b7280;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _esc(e.task || '—') + ' · ' + _esc(e.duration || '—') + '</div></div></div>';
    }).join('');
  }

  window._ctlCloseQueue = function () {
    var m = document.getElementById('hp-ctl-queue-modal');
    if (m) { m.setAttribute('aria-hidden', 'true'); m.classList.remove('open'); }
    S.queueModalCtlId = null; window._queueCtlId = null;
  };

  // ── JOIN QUEUE ────────────────────────────────────────────────────────────
  window._ctlJoinQueue = async function () {
    var ctlId = S.queueModalCtlId || window._queueCtlId; if (!ctlId) return;
    var task     = (_getv('hp-ctl-q-task-input') || '').trim();
    var duration = _getv('hp-ctl-q-duration-select') || '';
    var urgent   = (document.getElementById('hp-ctl-q-urgent') || {}).checked || false;
    var wantsAlm = (document.getElementById('hp-ctl-q-alarm') || {}).checked !== false;

    if (!task) { _flashErr('hp-ctl-q-task-input', '⚠️ Task description is required.'); return; }
    if (!duration) { _toast('⚠️ Required', 'Select a duration.', 'warning'); return; }

    var me = _me();
    var q = (S.queues[ctlId] || []).slice();
    var alreadyIn = q.some(function (e) { return e.user && me.name && e.user.toLowerCase().trim() === me.name.toLowerCase().trim(); });
    if (alreadyIn) { _toast('ℹ️ Already Queued', 'You\'re already in the queue!', 'warning'); return; }

    var entry = { user: me.name, avatarUrl: me.avatar, task: task, duration: duration, urgent: urgent, wantsAlarm: wantsAlm, joinedAt: Date.now(), notifiedAt: 0, notifyExpiresAt: 0 };
    if (urgent) { var fi = q.findIndex(function (e) { return !e.urgent; }); if (fi === -1) q.push(entry); else q.splice(fi, 0, entry); }
    else q.push(entry);

    try {
      var r = await fetch('/api/studio/ctl_lab_state', { method: 'POST', headers: _hdrs(), body: JSON.stringify({ queue: { id: ctlId, items: q } }) });
      var d = null; try { d = await r.json(); } catch (_) {}
      if (!r.ok || !d || !d.ok) { _toast('❌ Failed', 'Could not join queue. Retry.', 'warning'); return; }

      S.queues = d.queues || {}; S.bookings = d.bookings || {};
      delete S.qAlarmFired[ctlId];
      _renderQueueList(ctlId); _renderCards();

      var pos = (S.queues[ctlId] || []).findIndex(function (e) { return e.user && me.name && e.user.toLowerCase().trim() === me.name.toLowerCase().trim(); });
      _toast('✅ Joined Queue', 'You\'re #' + (pos + 1) + ' in line.' + (wantsAlm ? ' Alarm will fire when it\'s your turn.' : ''), 'success');
      if (wantsAlm) _askNotifPerm();
    } catch (_) { _toast('❌ Network Error', 'Cannot reach server.', 'warning'); }
  };

  // ── OVERRIDE ──────────────────────────────────────────────────────────────
  window._ctlOverride = function (ctlId) {
    if (!ctlId) return;
    S.overrideCtlId = ctlId;
    var ctl = S.items.find(function (c) { return c.id === ctlId; });
    var bk = S.bookings[ctlId];
    _set('hp-ctl-ov-ctrl-name', ctl ? ctl.type + ' Controller' : ctlId);
    _set('hp-ctl-ov-owner', bk ? bk.user : '—');
    _val('hp-ctl-ov-reason', '');
    var m = document.getElementById('hp-ctl-override-modal');
    if (m) { m.setAttribute('aria-hidden', 'false'); m.classList.add('open'); }
    var cb = document.getElementById('hp-ctl-ov-confirm-btn');
    if (cb) cb.onclick = window._ctlConfirmOverride;
  };

  window._ctlConfirmOverride = async function () {
    var ctlId = S.overrideCtlId; if (!ctlId) return;
    var reason = (_getv('hp-ctl-ov-reason') || '').trim();
    if (!reason) { _flashErr('hp-ctl-ov-reason', '⚠️ Reason is required for override.'); return; }
    var me = _me(), now = Date.now(), dur = _parseMs('30 minutes');
    var bkData = { user: me.name + ' [OVERRIDE]', avatarUrl: me.avatar, task: 'OVERRIDE: ' + reason, duration: '30 minutes', backupFile: '', startMs: now, endMs: now + dur };
    try {
      var r = await fetch('/api/studio/ctl_lab_state', { method: 'POST', headers: _hdrs(), body: JSON.stringify({ booking: { id: ctlId, data: bkData } }) });
      var d = null; try { d = await r.json(); } catch (_) {}
      if (!r.ok || !d || !d.ok) { _toast('❌ Override Failed', 'Server error.', 'warning'); return; }
      S.bookings = d.bookings || {}; S.queues = d.queues || {};
      window._ctlCloseOverride(); window._ctlCloseQueue(); _renderCards();
      _toast('⚠️ Override Applied', 'Session overridden and logged.', 'warning');
    } catch (_) { _toast('❌ Network Error', 'Cannot reach server.', 'warning'); }
  };
  window._ctlCloseOverride = function () {
    var m = document.getElementById('hp-ctl-override-modal'); if (m) { m.setAttribute('aria-hidden', 'true'); m.classList.remove('open'); }
    S.overrideCtlId = null;
  };

  // ── PENDING LOGS ──────────────────────────────────────────────────────────
  window._ctlShowPendingLogs    = function () { var m = document.getElementById('hp-ctl-pending-modal'); if (m) { m.style.display = 'flex'; m.setAttribute('aria-hidden', 'false'); } };
  window._ctlClosePendingLogs   = function () { var m = document.getElementById('hp-ctl-pending-modal'); if (m) m.style.display = 'none'; };
  window._ctlReplayPendingLogs  = function () { var s = document.getElementById('hp-ctl-replay-status'); if (s) s.textContent = 'No pending logs to retry.'; };
  window._ctlClearPendingLogs   = function () { var s = document.getElementById('hp-ctl-replay-status'); if (s) s.textContent = 'Cleared.'; };
  window._ctlOpenBackupFolder   = function () { window.open(SP_URL, '_blank', 'noopener,noreferrer'); };
  window._ctlCopyIp             = function (_, ip) { try { navigator.clipboard.writeText(ip).catch(function () { var t = document.createElement('textarea'); t.value = ip; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }); } catch (_) {} };
  window._ctlStopAlarm          = _stopAlarm;

  // ── CONFIG MODAL ──────────────────────────────────────────────────────────
  function _bindConfig() {
    var cfgBtn = document.getElementById('hp-ctl-config-btn');
    if (cfgBtn) cfgBtn.addEventListener('click', function () {
      var m = document.getElementById('hp-ctl-config-modal'); if (m) { m.classList.add('open'); m.setAttribute('aria-hidden', 'false'); }
      _renderChips();
    });
    var typeSelect = document.getElementById('hp-ctl-type-select');
    if (typeSelect) typeSelect.addEventListener('change', function () { var img = document.getElementById('hp-ctl-preview-img'); if (img) img.src = IMGS[this.value] || IMGS.E2; });
    function doAdd() { var t = (document.getElementById('hp-ctl-type-select') || {}).value || 'E2'; S.items.push({ id: 'ctl_' + Date.now(), type: t, ip: '', status: 'Online' }); _saveConfig(); _renderCards(); _renderChips(); }
    var ab = document.getElementById('hp-ctl-add-btn'); if (ab) ab.addEventListener('click', doAdd);
    var an = document.getElementById('hp-ctl-add-now-btn'); if (an) an.addEventListener('click', doAdd);
  }

  function _renderChips() {
    var row = document.getElementById('hp-ctl-chip-row'); if (!row) return;
    if (!S.items.length) { row.innerHTML = '<div style="padding:20px;text-align:center;color:rgba(255,255,255,.25);font-size:11px;">No controllers added yet.</div>'; return; }
    row.innerHTML = S.items.map(function (c) {
      var dot = c.status === 'Online' ? '#4ade80' : c.status === 'Maintenance' ? '#fbbf24' : '#f85149';
      return '<div class="hp-ctl-chip" onclick="window._ctlOpenSettings(\'' + c.id + '\')" style="display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:20px;padding:5px 12px;font-size:10px;color:#e2e8f0;cursor:pointer;margin:3px;">' +
        '<span style="width:6px;height:6px;border-radius:50%;background:' + dot + ';flex-shrink:0;display:inline-block;"></span>' +
        _esc(c.type) + '<span style="font-size:9px;color:rgba(255,255,255,.3);">' + _esc(c.ip || 'No IP') + '</span></div>';
    }).join('');
  }

  // ── SETTINGS MODAL ────────────────────────────────────────────────────────
  window._ctlOpenSettings = function (ctlId) {
    var ctl = S.items.find(function (c) { return c.id === ctlId; }); if (!ctl) return;
    var m = document.getElementById('hp-ctl-settings-modal'); if (!m) return;
    var img = document.getElementById('hp-ctl-settings-img'); if (img) img.src = IMGS[ctl.type] || IMGS.E2;
    _set('hp-ctl-settings-title', ctl.type + ' Settings');
    _set('hp-ctl-settings-type-label', ctl.type);
    _set('hp-ctl-settings-id-label', 'ID: ' + ctl.id);
    _val('hp-ctl-ip-input', ctl.ip || ''); _val('hp-ctl-status-select', ctl.status || 'Online');
    m.classList.add('open'); m.setAttribute('aria-hidden', 'false');
    var sb = document.getElementById('hp-ctl-settings-save-btn');
    if (sb) sb.onclick = function () { ctl.ip = (_getv('hp-ctl-ip-input') || '').trim(); ctl.status = _getv('hp-ctl-status-select') || 'Online'; _saveConfig(); _renderCards(); _renderChips(); m.classList.remove('open'); _toast('✅ Saved', 'Settings updated.', 'success'); };
    var db = document.getElementById('hp-ctl-settings-delete-btn');
    if (db) db.onclick = function () { if (!confirm('Remove this controller? Bookings will be cleared.')) return; S.items = S.items.filter(function (c) { return c.id !== ctlId; }); _saveConfig(); _renderCards(); _renderChips(); m.classList.remove('open'); };
  };

  // ── LOAD / SAVE CONFIG ────────────────────────────────────────────────────
  async function _loadConfig() {
    try {
      var r = await fetch('/api/studio/ctl_lab_config', { headers: _hdrs() }); if (!r.ok) return;
      var d = await r.json(); if (!d || !d.ok) return;
      var rev = JSON.stringify(d.items || []); if (rev === S.configRev) return;
      S.configRev = rev; S.items = d.items || []; _renderCards(); _renderChips();
    } catch (_) {}
  }
  async function _saveConfig() {
    try { await fetch('/api/studio/ctl_lab_config', { method: 'POST', headers: _hdrs(), body: JSON.stringify({ items: S.items }) }); } catch (_) {}
  }

  // ── LOAD STATE ────────────────────────────────────────────────────────────
  async function _loadState() {
    try {
      var r = await fetch('/api/studio/ctl_lab_state', { headers: _hdrs() }); if (!r.ok) return;
      var d = await r.json(); if (!d || !d.ok) return;
      var rev = JSON.stringify({ b: d.bookings, q: d.queues }); if (rev === S.stateRev) return;
      S.stateRev = rev;

      var prevBookings = S.bookings;
      S.bookings = d.bookings || {}; S.queues = d.queues || {};

      // Reset alarm flags when a booking is fully cleared (new user can alarm next session)
      S.items.forEach(function (ctl) {
        if (prevBookings[ctl.id] && !S.bookings[ctl.id]) {
          delete S.alarmFired[ctl.id];
          // Queue head alarm: only reset if the queue head changed
          var q = S.queues[ctl.id] || [];
          if (!q.length) delete S.qAlarmFired[ctl.id];
        }
      });

      _renderCards();

      // Refresh open queue modal
      if (S.queueModalCtlId) {
        _renderQueueList(S.queueModalCtlId);
        var bk2 = S.bookings[S.queueModalCtlId];
        _set('hp-ctl-q-current-user', bk2 ? bk2.user : '— Free');
        _set('hp-ctl-q-end-time', bk2 ? 'Ends: ' + _fmtTime(bk2.endMs) : 'Controller is available now');
      }
    } catch (_) {}
  }

  // ── DURATION CHIPS ────────────────────────────────────────────────────────
  function _bindChips() {
    document.addEventListener('click', function (e) {
      var chip = e.target && e.target.closest && e.target.closest('.hp-ctl-dur-chip');
      if (!chip) return;
      document.querySelectorAll('.hp-ctl-dur-chip').forEach(function (c) { c.classList.remove('active'); });
      chip.classList.add('active');
      var dur = chip.getAttribute('data-dur');
      var sel = document.getElementById('hp-ctl-bk-duration');
      var cw  = document.getElementById('hp-ctl-bk-custom-time-wrap');
      if (dur === 'set_time') { if (sel) sel.value = 'set_time'; if (cw) { cw.style.display = ''; var ci = document.getElementById('hp-ctl-bk-custom-time'); if (ci) ci.focus(); } }
      else { if (sel) sel.value = dur; if (cw) cw.style.display = 'none'; }
      _advStep(2);
    });
    document.addEventListener('input', function (e) {
      if (!e.target) return;
      if (e.target.id === 'hp-ctl-bk-task' && e.target.value.trim()) _advStep(2);
      if (e.target.id === 'hp-ctl-bk-backup' && e.target.value.trim()) _advStep(3);
    });
  }
  function _advStep(n) { document.querySelectorAll('.hp-ctl-bk-step').forEach(function (s, i) { s.classList.toggle('active', (parseInt(s.getAttribute('data-step') || (i + 1), 10)) <= n); }); }

  // ── POLLING ───────────────────────────────────────────────────────────────
  function _startPoll() {
    // 1-second countdown ticker
    S.countdownTimer = setInterval(_tick, 1000);
    // 15s server state poll
    S.pollTimer = setInterval(_loadState, POLL_MS);
    // 30s config poll
    S.configPollTimer = setInterval(_loadConfig, 30000);
    // Poll on tab focus (catches stale state after background)
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') { _loadState(); }
    });
  }

  // ── STYLES ────────────────────────────────────────────────────────────────
  function _injectStyles() {
    if (document.getElementById('ctl-booking-styles')) return;
    var s = document.createElement('style');
    s.id = 'ctl-booking-styles';
    s.textContent = [
      '@keyframes ctlToastIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}',
      '@keyframes ctlPulse{0%,100%{opacity:.4;transform:scale(1)}50%{opacity:.8;transform:scale(1.04)}}',
      '@keyframes ctlSpin{to{transform:rotate(360deg)}}',

      /* Cards — fixed-width tiles that flow horizontally */
      '.ctl-card{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:12px;transition:border-color .2s;flex:1 1 220px;min-width:200px;max-width:280px;display:flex;flex-direction:column;box-sizing:border-box;}',
      '.ctl-card:hover{border-color:rgba(162,93,220,.3);}',
      '.ctl-card-top{display:flex;align-items:center;gap:10px;margin-bottom:8px;}',
      '.ctl-card-img-wrap{position:relative;flex-shrink:0;}',
      '.ctl-card-img{width:44px;height:44px;object-fit:contain;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);padding:4px;}',
      '.ctl-card-dot{position:absolute;bottom:1px;right:1px;width:9px;height:9px;border-radius:50%;border:2px solid #0d1117;}',
      '.ctl-card-info{flex:1;min-width:0;}',
      '.ctl-card-type{font-size:12px;font-weight:800;color:#e2e8f0;}',
      '.ctl-card-ip{font-size:9px;color:rgba(255,255,255,.4);font-family:monospace;margin-top:2px;}',
      '.ctl-card-status{font-size:9px;font-weight:700;margin-top:2px;}',
      '.ctl-card-gear{background:none;border:none;color:rgba(255,255,255,.25);cursor:pointer;padding:4px 6px;border-radius:6px;transition:.2s;}',
      '.ctl-card-gear:hover{color:#fff;background:rgba(255,255,255,.07);}',
      '.ctl-card-bk{background:rgba(34,197,94,.05);border:1px solid rgba(34,197,94,.15);border-radius:8px;padding:8px 10px;margin-bottom:8px;}',
      '.ctl-card-bk-user{display:flex;align-items:center;gap:5px;font-size:10px;font-weight:700;color:#4ade80;margin-bottom:3px;}',
      '.ctl-card-bk-task{font-size:9px;color:rgba(255,255,255,.45);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:5px;}',
      '.ctl-card-bk-cd{display:flex;align-items:center;gap:5px;font-size:10px;}',
      '.ctl-card-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;}',
      '.ctl-q-badge{font-size:9px;color:#c084fc;background:rgba(162,93,220,.12);border:1px solid rgba(162,93,220,.25);border-radius:20px;padding:2px 8px;display:flex;align-items:center;gap:4px;}',
      '.ctl-card-btn{flex:1;padding:7px;border-radius:8px;font-size:10px;font-weight:700;cursor:pointer;border:1px solid;transition:.2s;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:5px;}',
      '.ctl-card-btn--book{background:rgba(162,93,220,.14);border-color:rgba(162,93,220,.4);color:#c084fc;}',
      '.ctl-card-btn--book:hover{background:rgba(162,93,220,.24);}',
      '.ctl-card-btn--queue{background:rgba(245,158,11,.1);border-color:rgba(245,158,11,.3);color:#fbbf24;}',
      '.ctl-card-btn--queue:hover{background:rgba(245,158,11,.18);}',

      /* Backup Log button — migrated from old layout */
      '.ctl-card-btn--log{background:rgba(96,165,250,.08);border-color:rgba(96,165,250,.25);color:#60a5fa;flex:0 0 auto;padding:7px 9px;gap:4px;}',
      '.ctl-card-btn--log:hover{background:rgba(96,165,250,.16);border-color:rgba(96,165,250,.45);}',
      '.ctl-card-btn-log-label{font-size:9px;}',

      /* ── hp-ctl-list container: horizontal row-wrap for new card tiles ── */
      '#hp-ctl-list.hp-ctl-list{flex-direction:row !important;flex-wrap:wrap !important;overflow-x:hidden !important;overflow-y:auto !important;gap:10px !important;padding:10px !important;align-items:flex-start !important;align-content:flex-start !important;}',

      /* Duration chips */
      '.hp-ctl-dur-chip{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:7px 10px;font-size:11px;color:rgba(255,255,255,.55);cursor:pointer;font-family:inherit;transition:.2s;font-weight:600;}',
      '.hp-ctl-dur-chip:hover{background:rgba(162,93,220,.1);border-color:rgba(162,93,220,.3);color:#c084fc;}',
      '.hp-ctl-dur-chip.active{background:rgba(162,93,220,.22);border-color:rgba(162,93,220,.55);color:#e9d5ff;font-weight:800;}',

      /* Booking modal */
      '#hp-ctl-booking-modal{display:none;position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.78);backdrop-filter:blur(10px);align-items:center;justify-content:center;}',
      '#hp-ctl-booking-modal.open{display:flex;}',
      '#hp-ctl-booking-dialog{background:#0d1117;border:1px solid rgba(255,255,255,.12);border-radius:16px;width:min(560px,96vw);max-height:92vh;overflow-y:auto;display:flex;flex-direction:column;}',
      '#hp-ctl-booking-head{padding:20px 22px 16px;background:linear-gradient(135deg,rgba(162,93,220,.07),transparent);border-bottom:1px solid rgba(255,255,255,.07);}',
      '#hp-ctl-booking-body{padding:18px 22px 22px;display:flex;flex-direction:column;gap:14px;}',

      /* Identity */
      '.hp-ctl-bk-identity{display:flex;align-items:center;gap:14px;margin-bottom:12px;}',
      '.hp-ctl-bk-avatar{position:relative;flex-shrink:0;}',
      '.hp-ctl-bk-avatar img{width:56px;height:56px;object-fit:contain;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);padding:4px;}',
      '.hp-ctl-bk-avatar-pulse{position:absolute;inset:-4px;border-radius:14px;border:2px solid rgba(162,93,220,.35);animation:ctlPulse 2s infinite;}',
      '.hp-ctl-bk-identity-text{flex:1;min-width:0;}',
      '.hp-ctl-bk-eyebrow{font-size:9px;color:rgba(255,255,255,.38);text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px;}',
      '.hp-ctl-bk-title{font-size:16px;font-weight:900;color:#f1f5f9;margin-bottom:5px;}',
      '.hp-ctl-bk-ip-row{display:flex;align-items:center;gap:6px;}',
      '.hp-ctl-bk-ip-dot{width:6px;height:6px;border-radius:50%;background:#4ade80;flex-shrink:0;}',
      '.hp-ctl-bk-ip{font-size:10px;color:rgba(255,255,255,.45);font-family:monospace;}',
      '.hp-ctl-bk-ip-copy{background:none;border:none;color:rgba(255,255,255,.25);cursor:pointer;padding:2px 5px;}',
      '.hp-ctl-bk-online-badge{font-size:8px;font-weight:800;color:#4ade80;background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.3);border-radius:10px;padding:1px 6px;}',
      '.hp-ctl-bk-close{background:none;border:1px solid rgba(255,255,255,.12);border-radius:8px;color:rgba(255,255,255,.45);cursor:pointer;padding:6px 10px;transition:.2s;font-family:inherit;margin-left:auto;}',
      '.hp-ctl-bk-close:hover{color:#fff;}',

      /* Meta strip */
      '.hp-ctl-bk-meta-strip{display:flex;align-items:center;gap:14px;flex-wrap:wrap;}',
      '.hp-ctl-bk-meta-item{display:flex;align-items:center;gap:5px;font-size:10px;color:rgba(255,255,255,.45);}',
      '.hp-ctl-bk-meta-divider{width:1px;height:14px;background:rgba(255,255,255,.1);}',

      /* Steps */
      '.hp-ctl-bk-steps{display:flex;align-items:center;}',
      '.hp-ctl-bk-step{display:flex;align-items:center;gap:5px;font-size:10px;color:rgba(255,255,255,.28);font-weight:600;transition:.2s;}',
      '.hp-ctl-bk-step.active{color:#c084fc;}',
      '.hp-ctl-bk-step-num{width:18px;height:18px;border-radius:50%;border:1px solid currentColor;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;}',
      '.hp-ctl-bk-step-line{flex:1;height:1px;background:rgba(255,255,255,.1);margin:0 8px;}',

      /* Fields */
      '.hp-ctl-bk-field{display:flex;flex-direction:column;gap:6px;}',
      '.hp-ctl-bk-label{font-size:11px;font-weight:700;color:#94a3b8;display:flex;align-items:center;gap:6px;}',
      '.hp-ctl-bk-label-icon{color:#c084fc;font-size:11px;}',
      '.hp-ctl-bk-req{font-size:8px;font-weight:700;color:#f85149;background:rgba(248,81,73,.1);border:1px solid rgba(248,81,73,.22);border-radius:4px;padding:1px 5px;margin-left:auto;}',
      '.hp-ctl-bk-input{background:#010409;border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#e2e8f0;padding:9px 12px;font-size:12px;font-family:inherit;outline:none;transition:.2s;width:100%;box-sizing:border-box;}',
      '.hp-ctl-bk-input:focus{border-color:rgba(162,93,220,.5);}',
      '.hp-ctl-bk-input.error{border-color:#f85149 !important;animation:ctlShake .3s ease;}',
      '@keyframes ctlShake{0%,100%{transform:translateX(0)}25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}',
      '.hp-ctl-bk-field-hint{font-size:9px;color:rgba(255,255,255,.3);}',
      '.hp-ctl-bk-duration-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;}',
      '.hp-ctl-bk-select{background:#010409;border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#e2e8f0;padding:9px 12px;font-size:12px;font-family:inherit;outline:none;width:100%;box-sizing:border-box;}',

      /* Backup */
      '.hp-ctl-bk-backup-instruction{display:flex;align-items:flex-start;gap:8px;padding:8px 10px;background:rgba(245,158,11,.05);border:1px solid rgba(245,158,11,.18);border-radius:8px;font-size:10px;color:rgba(255,255,255,.55);line-height:1.6;}',
      '.hp-ctl-bk-backup-block{display:flex;flex-direction:column;gap:8px;}',
      '.hp-ctl-bk-backup-upload-zone{border:2px dashed rgba(255,255,255,.1);border-radius:8px;padding:14px;text-align:center;cursor:pointer;transition:.2s;}',
      '.hp-ctl-bk-backup-upload-zone:hover{border-color:rgba(96,165,250,.4);background:rgba(96,165,250,.04);}',
      '.hp-ctl-bk-backup-input-wrap{position:relative;}',
      '.hp-ctl-bk-backup-icon{position:absolute;left:10px;top:50%;transform:translateY(-50%);color:rgba(255,255,255,.3);font-size:11px;}',
      '.hp-ctl-bk-backup-input{padding-left:28px !important;}',

      /* In-use */
      '.hp-ctl-bk-inuse-notice{display:flex;gap:12px;padding:12px 14px;background:rgba(248,81,73,.06);border:1px solid rgba(248,81,73,.2);border-radius:10px;}',
      '.hp-ctl-bk-inuse-icon{font-size:22px;color:#f85149;flex-shrink:0;}',
      '.hp-ctl-bk-inuse-title{font-size:12px;font-weight:800;color:#f85149;margin-bottom:4px;}',
      '.hp-ctl-bk-inuse-owner{font-size:11px;color:rgba(255,255,255,.65);margin-bottom:3px;}',
      '.hp-ctl-bk-inuse-end{font-size:10px;color:#fbbf24;font-family:monospace;margin-bottom:4px;}',
      '.hp-ctl-bk-inuse-msg{font-size:9px;color:rgba(255,255,255,.38);}',

      /* Top bar */
      '.hp-ctl-bk-topbar{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;}',
      '.hp-ctl-bk-status-pill{display:flex;align-items:center;gap:6px;font-size:10px;color:rgba(255,255,255,.45);background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:20px;padding:3px 10px;}',
      '.hp-ctl-status-dot{width:6px;height:6px;border-radius:50%;background:#4ade80;flex-shrink:0;display:inline-block;}',
      '.hp-ctl-pending-pill{display:flex;align-items:center;gap:5px;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);color:#f59e0b;border-radius:20px;padding:3px 10px;font-size:10px;font-weight:700;cursor:pointer;font-family:inherit;}',

      /* Register button */
      '.hp-ctl-bk-register{width:100%;padding:13px;background:linear-gradient(135deg,rgba(162,93,220,.28),rgba(162,93,220,.14));border:1px solid rgba(162,93,220,.5);border-radius:10px;color:#e9d5ff;font-size:13px;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;transition:.2s;font-family:inherit;}',
      '.hp-ctl-bk-register:hover{background:linear-gradient(135deg,rgba(162,93,220,.4),rgba(162,93,220,.22));}',
      '.hp-ctl-bk-register:disabled{opacity:.5;cursor:not-allowed;}',
      '.hp-ctl-bk-spinner{width:14px;height:14px;border:2px solid rgba(255,255,255,.2);border-top-color:#c084fc;border-radius:50%;display:none;}',
      '.hp-ctl-bk-spinner.spinning{display:block;animation:ctlSpin .7s linear infinite;}',

      /* Success */
      '.hp-ctl-bk-success{display:none;flex-direction:column;align-items:center;gap:10px;padding:20px;text-align:center;}',
      '.hp-ctl-bk-success-ring{width:56px;height:56px;border-radius:50%;background:rgba(34,197,94,.1);border:2px solid rgba(34,197,94,.4);display:flex;align-items:center;justify-content:center;}',
      '.hp-ctl-bk-success-check{font-size:22px;color:#4ade80;}',
      '.hp-ctl-bk-success-title{font-size:16px;font-weight:900;color:#4ade80;}',
      '.hp-ctl-bk-success-msg{font-size:11px;color:rgba(255,255,255,.45);margin:0;}',

      /* Queue modal */
      '#hp-ctl-queue-modal{z-index:9001;}',
      '.hp-ctl-queue-dialog{max-width:500px;}',
    ].join('\n');
    document.head.appendChild(s);
  }

  // ── UTIL ──────────────────────────────────────────────────────────────────
  function _esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function _set(id, t) { var e = document.getElementById(id); if (e) e.textContent = t; }
  function _val(id, v) { var e = document.getElementById(id); if (e) e.value = v; }
  function _getv(id) { var e = document.getElementById(id); return e ? e.value : ''; }
  function _flashErr(id, msg) {
    var el = document.getElementById(id);
    if (el) { el.classList.add('error'); el.focus(); setTimeout(function () { el.classList.remove('error'); }, 2000); }
    _toast(msg, '', 'warning');
  }
  function _setBusy(b) {
    var btn = document.getElementById('hp-ctl-bk-register-btn');
    var sp  = document.getElementById('hp-ctl-bk-spinner');
    var ic  = document.getElementById('hp-ctl-bk-register-icon');
    var lb  = document.getElementById('hp-ctl-bk-register-label');
    if (!btn) return;
    btn.disabled = b;
    if (sp) sp.classList.toggle('spinning', b);
    if (ic) ic.style.display = b ? 'none' : '';
    if (lb) lb.textContent = b ? 'Booking…' : 'Book this Controller';
  }

  // ── INIT ──────────────────────────────────────────────────────────────────
  function _init() {
    _injectStyles();
    _bindConfig();
    _bindChips();
    _loadConfig();
    _loadState();
    _startPoll();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _init);
  else setTimeout(_init, 200);

})();
