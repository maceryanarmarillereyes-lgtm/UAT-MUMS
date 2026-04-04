/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */

(window.Pages = window.Pages || {}, window.Pages.my_schedule = function (root) {
  // ---------------------------------------------------------------------------
  // My Schedule — Enterprise Calendar (13126-09)
  // - Weekly / Daily / Team views
  // - Pixel-perfect hour ruler alignment (shared row height grid)
  // - TEAM TASK color coding + badges (.task-label / .task-color)
  // - Team tabular view inspired by enterprise scheduling systems
  // ---------------------------------------------------------------------------

  // BUG FIX: document.contains(root) is PERMANENTLY TRUE because root=#main is never
  // removed from the DOM (only its innerHTML is cleared on navigation).
  // We use a per-mount stamp: capture the routeSeq at mount time and compare
  // it against root.dataset.routeSeq in every async callback/timer.
  // When the router navigates away, it increments routeSeq → old stamp != current → bail.
  const _mountSeq = String(root && root.dataset && root.dataset.routeSeq ? root.dataset.routeSeq : Date.now());
  function _isMounted() {
    // Returns true only if this page instance is still the live render
    try {
      return root && root.dataset && String(root.dataset.routeSeq || '') === _mountSeq;
    } catch(_) { return false; }
  }

  const session = (window.Store && Store.getSession) ? Store.getSession() : null;
  const sessionUserId = session && (session.userId || session.user_id || session.uid || session.id);
  let me = (window.Auth && Auth.user) ? Auth.user : null;
  // Backfill user profile from Store when Auth.user is not yet hydrated (fixes 'No blocks' on My Schedule).
  try{
    if((!me || !me.id) && sessionUserId && window.Store && Store.getUserById){
      const prof = Store.getUserById(String(sessionUserId));
      if(prof) me = prof;
    }
    if(me && !me.id && sessionUserId) me.id = String(sessionUserId);
  }catch(_){ }
  if(!me) me = { id: String(sessionUserId || ''), role: 'MEMBER' };
  if (me && me.teamId == null && me.team_id != null) me.teamId = me.team_id;
  if (me && me.team_id == null && me.teamId != null) me.team_id = me.teamId;
  const role = (me && me.role) ? String(me.role) : 'MEMBER';
  const canEditSelf = (role === 'TEAM_LEAD' || role === 'SUPER_ADMIN');

  const tzManila = 'Asia/Manila';
  let localTZ = '';
  try { localTZ = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (_) { localTZ = ''; }

  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  function currentTeamId() {
    let raw = (me && (me.teamId != null ? me.teamId : me.team_id));
    if (raw == null || raw === '') {
      try {
        const uid = String((me && me.id) || sessionUserId || '');
        const profile = (uid && window.Store && Store.getUserById) ? Store.getUserById(uid) : null;
        const fallbackTeamId = profile && (profile.teamId != null ? profile.teamId : profile.team_id);
        if (fallbackTeamId != null && fallbackTeamId !== '') {
          raw = fallbackTeamId;
          if (me) {
            me.teamId = fallbackTeamId;
            me.team_id = fallbackTeamId;
          }
        }
      } catch (_) { }
    }
    return String(raw == null ? '' : raw);
  }

  function getBearerToken() {
    try {
      const t = (window.CloudAuth && CloudAuth.accessToken) ? String(CloudAuth.accessToken() || '').trim() : '';
      if (t) return t;
    } catch (_) { }
    try {
      const sess = (window.CloudAuth && CloudAuth.loadSession) ? CloudAuth.loadSession() : null;
      const t2 = sess && sess.access_token ? String(sess.access_token).trim() : '';
      if (t2) return t2;
    } catch (_) { }
    return '';
  }

  let teamThemePalette = {};
  let themePaletteLoadedFor = '';


  function esc(s) { return (window.UI && UI.esc) ? UI.esc(s) : String(s || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function hm(min) {
    let m = ((min % (24 * 60)) + (24 * 60)) % (24 * 60);
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${pad2(h)}:${pad2(mm)}`;
  }

  function hmShort(min) {
    let m = ((min % (24 * 60)) + (24 * 60)) % (24 * 60);
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${h}:${pad2(mm)}`;
  }

  function parseHM(s) {
    const m = String(s || '').trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return 0;
    return (Number(m[1]) || 0) * 60 + (Number(m[2]) || 0);
  }

  function addDaysISO(iso, delta) {
    try {
      const d = new Date(`${iso}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + Number(delta || 0));
      return d.toISOString().slice(0, 10);
    } catch (_) {
      return iso;
    }
  }

  function weekdayFromISO(iso) {
    try {
      const d = new Date(`${iso}T00:00:00Z`);
      return d.getUTCDay();
    } catch (_) {
      return 0;
    }
  }

  function formatDateLong(iso) {
    try {
      // Use UTC midnight so TZ formatting does not shift the day.
      const d = new Date(`${iso}T00:00:00Z`);
      return new Intl.DateTimeFormat('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
        timeZone: tzManila,
      }).format(d);
    } catch (_) {
      return String(iso || '');
    }
  }

  function nowISOManila() {
    try {
      if (window.UI && UI.manilaNow) {
        const p = UI.manilaNow();
        if (p && p.isoDate) return String(p.isoDate);
      }
    } catch (_) { }
    return new Date().toISOString().slice(0, 10);
  }

  const todayISO = nowISOManila();
  const todayWD = weekdayFromISO(todayISO);
  const weekStartSunISO = addDaysISO(todayISO, -todayWD);

  function isTodayISO(iso) {
    return String(iso || '') === String(todayISO || '');
  }

  function isoForDay(dayIdx) {
    return addDaysISO(weekStartSunISO, Number(dayIdx || 0));
  }

  function getTeam() {
    try {
      const tid = currentTeamId();
      if (window.Store && Store.getTeamConfig && tid !== '') {
        const cfg = Store.getTeamConfig(tid);
        if (cfg) return { id: tid, label: cfg.label || cfg.name || tid, cfg };
      }
    } catch (_) { }
    const tid = currentTeamId();
    return { id: tid, label: tid, cfg: null };
  }

  function inferTeamShift(team) {
    // Align with existing conventions used across app:
    // - Team config schedule.start/end or defaults per shift key
    const cfg = (team && team.cfg) ? team.cfg : null;
    const s = (cfg && cfg.schedule && cfg.schedule.start) ? String(cfg.schedule.start) : (me.shift === 'MID' ? '15:00' : (me.shift === 'NIGHT' ? '22:00' : '06:00'));
    const e = (cfg && cfg.schedule && cfg.schedule.end) ? String(cfg.schedule.end) : (me.shift === 'MID' ? '22:00' : (me.shift === 'NIGHT' ? '06:00' : '15:00'));
    const startMin = parseHM(s);
    let endMin = parseHM(e);
    let lenMin = endMin - startMin;
    if (lenMin <= 0) lenMin += (24 * 60);
    return { startHM: s, endHM: e, startMin, endMin, lenMin };
  }

  function shiftKey() {
    try {
      const t = getTeam();
      const cfg = t && t.cfg ? t.cfg : null;
      const sk = (cfg && cfg.shiftKey) ? String(cfg.shiftKey) : ((me && me.shift) ? String(me.shift).toLowerCase() : '');
      return sk || 'shift';
    } catch (_) {
      return 'shift';
    }
  }

  function getTeamTasks() {
    try {
      const tid = currentTeamId();
      if (window.Store && Store.getTeamTasks && tid !== '') return Store.getTeamTasks(tid) || [];
    } catch (_) { }
    return [];
  }

  function taskLabel(taskId) {
    const id = String(taskId || '');
    const tasks = getTeamTasks();
    const t = tasks.find(x => String(x && (x.id || x.taskId || x.label || x.name)) === id) || null;
    if (t) return String(t.label || t.name || t.id || id);
    // If schedule stores label directly
    if (id && !/^[0-9a-f\-]{6,}$/i.test(id)) return id;
    return id;
  }

  function isRenderableColor(color) {
    const value = String(color || '').trim();
    if (!value) return false;
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) return true;
    if (/^(rgb|rgba|hsl|hsla)\(/i.test(value)) return true;
    return false;
  }

  function rgbaFromColor(color, alpha) {
    const c = String(color || '').trim();
    const a = Number.isFinite(Number(alpha)) ? Number(alpha) : 1;
    if ((window.UI && UI.hexToRgba) && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c)) {
      try { return UI.hexToRgba(c, a); } catch (_) { }
    }
    const hex = c.replace('#', '');
    if (/^[0-9a-f]{3}$/i.test(hex)) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      return `rgba(${r},${g},${b},${a})`;
    }
    if (/^[0-9a-f]{6}$/i.test(hex)) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return `rgba(${r},${g},${b},${a})`;
    }
    if (/^(rgb|rgba|hsl|hsla)\(/i.test(c)) return c;
    return `rgba(147,197,253,${a})`;
  }

  function semanticTaskColor(labelOrId) {
    const key = String(labelOrId || '').trim().toLowerCase();
    if (key === 'mailbox_manager' || key.includes('mailbox')) return '#c4b5fd';
    if (key === 'back_office' || key.includes('back office') || key.includes('admin')) return '#fdba74';
    if (key === 'call_onqueue' || key === 'call_available' || key.includes('call')) return '#86efac';
    if (key === 'lunch' || key.includes('lunch') || key.includes('break')) return '#94a3b8';
    return '#93c5fd';
  }

  function normalizeTaskKey(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[_\s-]+/g, ' ')
      .replace(/\s+/g, ' ');
  }

  function normalizeTaskCssKey(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function paletteTaskAliases(taskKey) {
    const k = normalizeTaskCssKey(taskKey);
    if (!k) return [];
    if (k === 'call_onqueue') return ['call_onqueue', 'call_available'];
    if (k === 'call_available') return ['call_available', 'call_onqueue'];
    return [k];
  }

  function themeColorForTask(taskIdOrLabel) {
    const keys = paletteTaskAliases(taskIdOrLabel);
    for (const key of keys) {
      const paletteKey = `task_${key}`;
      const c = teamThemePalette && teamThemePalette[paletteKey];
      if (isRenderableColor(c)) return String(c);
    }
    return '';
  }

  function findTeamTaskMeta(taskIdOrLabel) {
    const wanted = normalizeTaskKey(taskIdOrLabel);
    if (!wanted) return null;
    const tasks = getTeamTasks();
    for (const task of tasks) {
      if (!task) continue;
      const id = String(task.id || task.taskId || '');
      const label = String(task.label || task.name || '');
      const aliases = [
        normalizeTaskKey(id),
        normalizeTaskKey(label),
      ].filter(Boolean);
      if (aliases.includes(wanted)) return task;
    }
    return null;
  }

  function normalizeTaskColor(labelOrId, rawColor) {
    if (isRenderableColor(rawColor)) return String(rawColor);
    return semanticTaskColor(labelOrId);
  }

  function taskColor(taskId) {
    const label = taskLabel(taskId);
    const fromTheme = themeColorForTask(taskId) || themeColorForTask(label);
    if (isRenderableColor(fromTheme)) return String(fromTheme);
    const teamTask = findTeamTaskMeta(taskId) || findTeamTaskMeta(label);
    const configuredColor = teamTask ? String(teamTask.color || teamTask.colour || '') : '';
    return normalizeTaskColor(label || taskId, configuredColor) || 'rgba(255,255,255,.18)';
  }

  function taskTypeAttr(taskIdOrLabel) {
    const keys = paletteTaskAliases(taskIdOrLabel);
    return keys[0] || 'block';
  }

  function buildThemeStyleVars(hours) {
    const out = [`--schx-hours:${hours}`];
    const pairs = Object.entries(teamThemePalette || {});
    for (const [k, v] of pairs) {
      if (!String(k || '').startsWith('task_')) continue;
      if (!isRenderableColor(v)) continue;
      const taskKey = normalizeTaskCssKey(String(k).slice(5));
      if (!taskKey) continue;
      out.push(`--theme-${taskKey}:${String(v)}`);
    }
    return out.join(';');
  }

  function scheduleLegendItems() {
    const defaults = [
      { id: 'mailbox_manager', label: 'Mailbox Manager' },
      { id: 'call_available', label: 'Call Available' },
      { id: 'back_office', label: 'Back Office' },
      { id: 'lunch', label: 'Lunch / Break' },
    ];
    const tasks = getTeamTasks();
    return defaults.map(def => {
      const hit = tasks.find(t => {
        const tid = String(t && (t.id || t.taskId || '')).toLowerCase();
        const lbl = String(t && (t.label || t.name || '')).toLowerCase();
        if (def.id === 'call_available') return tid === 'call_available' || tid === 'call_onqueue' || lbl.includes('call available');
        if (def.id === 'lunch') return tid === 'lunch' || lbl.includes('lunch') || lbl.includes('break');
        return tid === def.id || lbl.includes(def.label.toLowerCase());
      }) || null;
      const raw = hit ? (hit.color || hit.colour || '') : '';
      const label = hit ? String(hit.label || hit.name || def.label) : def.label;
      const color = normalizeTaskColor(def.id, raw);
      return { label, color };
    });
  }

  function taskVars(color) {
    const c = String(color || '#93c5fd');
    const bg = (window.UI && UI.hexToRgba) ? UI.hexToRgba(c, 0.18) : 'rgba(80,160,255,0.18)';
    const border = c;
    const text = '#FFFFFF';
    return { color: c, bg, border, text };
  }

  function shiftLabel(sk) {
    const key = String(sk || '').toLowerCase();
    if (key.includes('night')) return 'night';
    if (key.includes('mid')) return 'mid';
    return 'morning';
  }

  function taskIcon(label) {
    const key = String(label || '').trim().toLowerCase();
    if (key.includes('call')) return '📞';
    if (key.includes('mailbox')) return '📥';
    if (key.includes('lunch') || key.includes('break')) return '☕';
    if (key.includes('back office') || key.includes('admin')) return '🗂️';
    return '•';
  }

  function normalizeBlock(b) {
    const o = b || {};
    const actionItemsRaw = Array.isArray(o.actionItems) ? o.actionItems : (Array.isArray(o.subTasks) ? o.subTasks : []);
    const actionItems = actionItemsRaw
      .map(normalizeActionItem)
      .filter(item => !!item.description);
    return {
      start: String(o.start || o.s || '00:00'),
      end: String(o.end || o.e || '00:00'),
      schedule: String(o.schedule || o.task || o.role || o.label || ''),
      notes: String(o.notes || ''),
      actionItems,
    };
  }

  function normalizeActionItem(raw) {
    const item = raw && typeof raw === 'object' ? raw : {};
    const descriptionRaw = String(item.description || item.detail || item.text || '').trim();
    const shortRaw = String(item.shortDescription || item.short || '').trim();
    const fullRaw = String(item.fullDescription || item.full || '').trim();
    const autoShort = shortRaw || String(descriptionRaw.split(':')[0] || '').trim();
    const autoFull = fullRaw || String(descriptionRaw.includes(':') ? descriptionRaw.split(':').slice(1).join(':') : descriptionRaw).trim();
    const description = String(descriptionRaw || composeActionItemDescription(autoShort, autoFull)).trim().slice(0, 500);
    const shortDescription = String(autoShort || descriptionRaw || '').trim().slice(0, 80);
    const fullDescription = String(autoFull || description).trim().slice(0, 500);
    const priorityRaw = String(item.priority || 'normal').trim().toLowerCase();
    const priority = (priorityRaw === 'low' || priorityRaw === 'high') ? priorityRaw : 'normal';
    return {
      id: String(item.id || `ai_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`),
      description,
      shortDescription,
      fullDescription,
      completed: !!(item.completed || item.done || item.status === 'completed'),
      priority,
      createdAt: Number(item.createdAt || Date.now()),
    };
  }

  function collectBlockActionShortLabels(block) {
    const list = Array.isArray(block && block.actionItems) ? block.actionItems : [];
    const labels = list
      .map(normalizeActionItem)
      .map(item => String(item.shortDescription || item.description || '').trim())
      .filter(Boolean)
      .slice(0, 3);
    return labels;
  }

  function getBlocksForUserDay(userId, dayIdx) {
    try {
      if (window.Store && Store.getUserDayBlocks) {
        const list = Store.getUserDayBlocks(String(userId || ''), Number(dayIdx || 0)) || [];
        return Array.isArray(list) ? list : [];
      }
    } catch (_) { }
    return [];
  }

  function getMyBlocks(dayIdx) {
    return getBlocksForUserDay(me.id, dayIdx);
  }

  // Time conversion: Manila schedule times -> local display label
  function localTimeLabel(isoDate, hmStr) {
    try {
      if (!UI.parseManilaDateTimeLocal) return '';
      const ms = UI.parseManilaDateTimeLocal(`${isoDate}T${hmStr}`);
      if (!ms) return '';
      return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (_) { return ''; }
  }

  function localRangeLabel(isoDate, startHM, endHM) {
    try {
      const sMin = parseHM(startHM);
      const eMin = parseHM(endHM);
      const wraps = eMin <= sMin;
      const a = localTimeLabel(isoDate, startHM);
      const b = localTimeLabel(wraps ? addDaysISO(isoDate, 1) : isoDate, endHM);
      if (!a || !b) return '';
      return `${a}–${b}`;
    } catch (_) { return ''; }
  }

  function computeOffset(shift, hmStr) {
    const m = parseHM(hmStr);
    let off = m - shift.startMin;
    if (off < 0) off += (24 * 60);
    return off;
  }

  function clampShiftRange(shift, startOff, endOff) {
    let s = Math.max(0, Math.min(shift.lenMin, startOff));
    let e = endOff;
    if (e <= s) e += (24 * 60);
    e = Math.max(0, Math.min(shift.lenMin, e));
    if (e <= s) e = Math.min(shift.lenMin, s + 15);
    return { s, e, dur: e - s };
  }

  function blockMetrics(shift, b) {
    const startOff = computeOffset(shift, b.start);
    const endOff = computeOffset(shift, b.end);
    const r = clampShiftRange(shift, startOff, endOff);
    const topH = r.s / 60;
    const heightH = Math.max(0.25, r.dur / 60);
    return { topH, heightH, durMin: r.dur, startOff: r.s, endOff: r.e };
  }

  function nowManilaParts() {
    try { return UI.manilaNow ? UI.manilaNow() : null; } catch (_) { return null; }
  }

  function computeCountdown(shift) {
    const parts = nowManilaParts() || { isoDate: todayISO, hh: new Date().getHours(), mm: new Date().getMinutes() };
    const nowMin = (Number(parts.hh) || 0) * 60 + (Number(parts.mm) || 0);
    const wd = weekdayFromISO(parts.isoDate || todayISO);
    const blocks = getMyBlocks(wd).map(normalizeBlock).sort((a, b) => parseHM(a.start) - parseHM(b.start));
    if (!blocks.length) return { label: '—', active: null, next: null, wd, isoDate: parts.isoDate || todayISO, blocks, secLeft: 0, state: 'idle' };

    const inBlock = (b) => {
      const s = parseHM(b.start);
      const e = parseHM(b.end);
      if (e > s) return nowMin >= s && nowMin < e;
      return (nowMin >= s) || (nowMin < e);
    };

    const active = blocks.find(inBlock) || null;
    const after = blocks.filter(b => parseHM(b.start) > nowMin);
    const next = after[0] || (active ? null : blocks[0] || null);

    let label = '—';
    let secLeft = 0;
    let state = 'idle';
    try {
      const nowMs = Date.now();
      const fmt = (sec) => (UI.formatDuration ? UI.formatDuration(sec) : `${Math.round(sec / 60)}m`);
      if (active && UI.parseManilaDateTimeLocal) {
        const eMin = parseHM(active.end);
        const sMin = parseHM(active.start);
        const wraps = eMin <= sMin;
        const endISO = wraps && nowMin >= sMin ? addDaysISO(parts.isoDate, 1) : parts.isoDate;
        const endMs = UI.parseManilaDateTimeLocal(`${endISO}T${active.end}`);
        const left = Math.max(0, Math.floor((endMs - nowMs) / 1000));
        secLeft = left;
        state = 'active';
        label = `Ends in ${fmt(left)}`;
      } else if (next && UI.parseManilaDateTimeLocal) {
        const nMin = parseHM(next.start);
        const startISO = (nMin < nowMin) ? addDaysISO(parts.isoDate, 1) : parts.isoDate;
        const startMs = UI.parseManilaDateTimeLocal(`${startISO}T${next.start}`);
        const left = Math.max(0, Math.floor((startMs - nowMs) / 1000));
        secLeft = left;
        state = 'next';
        label = `Starts in ${fmt(left)}`;
      }
    } catch (_) { }

    return { label, active, next, wd, isoDate: parts.isoDate || todayISO, blocks, secLeft, state };
  }

  function computeCountdownTone(countdown) {
    const sec = Number(countdown && countdown.secLeft) || 0;
    if (!countdown || countdown.state === 'idle') return 'muted';
    if (sec <= 3600) return 'warn';
    if (sec <= 3 * 3600) return 'focus';
    return 'ok';
  }

  function currentTimeOffsetMinutes(shift) {
    try {
      const p = nowManilaParts();
      let hh = p ? Number(p.hh) : NaN;
      let mm = p ? Number(p.mm) : NaN;
      if (!Number.isFinite(hh) || !Number.isFinite(mm)) {
        const now = new Date();
        const manila = new Intl.DateTimeFormat('en-US', {
          timeZone: tzManila,
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).formatToParts(now);
        hh = Number((manila.find(x => x.type === 'hour') || {}).value || 0);
        mm = Number((manila.find(x => x.type === 'minute') || {}).value || 0);
      }
      const nowMin = (hh || 0) * 60 + (mm || 0);
      let off = nowMin - shift.startMin;
      if (off < 0) off += (24 * 60);
      if (off < 0 || off > shift.lenMin) return null;
      return off;
    } catch (_) {
      return null;
    }
  }

  function currentWeekStartMondayISO() {
    const wd = weekdayFromISO(todayISO);
    const delta = (wd === 0) ? -6 : (1 - wd);
    return addDaysISO(todayISO, delta);
  }

  function findAuditForBlock(dayIdx, b) {
    try {
      if (!Store.getWeekAudit) return null;
      const weekStartISO = currentWeekStartMondayISO();
      const list = Store.getWeekAudit(currentTeamId(), weekStartISO) || [];
      if (!list.length) return null;
      const needle = `${b.start}-${b.end}`;
      const dayName = DAYS[dayIdx] || String(dayIdx);
      const hit = list.find(a => a && a.targetId === me.id && String(a.detail || '').includes(needle) && String(a.detail || '').includes(dayName));
      return hit || null;
    } catch (_) { return null; }
  }

  function formatTs(ts) {
    try {
      return new Date(Number(ts || 0)).toLocaleString('en-CA', {
        timeZone: tzManila,
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    } catch (_) { return ''; }
  }

  // Persistent state
  let viewMode = 'week';
  let focusDay = todayWD;
  try {
    const stored = String(localStorage.getItem('mums_sched_view') || '').toLowerCase();
    if (stored === 'day' || stored === 'week' || stored === 'team') viewMode = stored;
  } catch (_) { }
  // Always start on the current Manila day when the page opens.
  // This avoids stale focus from previous sessions and reduces date confusion.
  focusDay = todayWD;

  let tickTimer = null;
  let storeListener = null;
  let selectedBlockKey = '';
  let teamMembersCache = [];
  let _tmState = {
    loading: false,
    loaded: false,
    teamId: '',
    retryCount: 0,
    retryTimer: null,
    _lastFetchAt: 0,  // FIX-LOOP: tracks last fetch timestamp for rate-limit guard
  };

  // Resolve the current user's teamId from every available source (most-reliable first)
  function _resolveMyTeamId() {
    // Source 1: module-init `me` object (populated from Store at page load)
    const fromMe = currentTeamId();
    if (fromMe) return fromMe;

    // Source 2: Auth.getUser() live (may have teamId set via reconcileFromOnline)
    try {
      const u = (window.Auth && Auth.getUser) ? Auth.getUser() : null;
      const t = u && String(u.teamId || u.team_id || '').trim();
      if (t) return t;
    } catch (_) {}

    // Source 3: My own entry in the online presence map
    try {
      const myUid = String((me && me.id) || '');
      if (myUid && window.Store && Store.getOnlineUsers) {
        const onlineMe = Store.getOnlineUsers().find(u => String(u.userId || u.id || '') === myUid);
        const t = onlineMe && String(onlineMe.teamId || '').trim();
        if (t) return t;
      }
    } catch (_) {}

    // Source 4: My own entry in the local schedule blocks cache
    try {
      const myUid = String((me && me.id) || '');
      if (myUid && window.Store && Store.getScheduleBlocks) {
        const blocks = Store.getScheduleBlocks();
        const t = blocks && blocks[myUid] && String(blocks[myUid].teamId || '').trim();
        if (t) return t;
      }
    } catch (_) {}

    return '';
  }

  function setViewMode(mode) {
    const m = String(mode || '').toLowerCase();
    viewMode = (m === 'day' || m === 'team') ? m : 'week';
    try { localStorage.setItem('mums_sched_view', viewMode); } catch (_) { }
    if (viewMode === 'team') {
      // Reset retry counter when user actively switches to team tab
      _tmState.retryCount = 0;
      refreshTeamMembers();
    }
    render();
  }

  function setFocusDay(d) {
    focusDay = Math.max(0, Math.min(6, Number(d) || 0));
    try { localStorage.setItem('mums_sched_day', String(focusDay)); } catch (_) { }
    selectedBlockKey = '';
    render();
  }

  function blockKey(dayIdx, b, idx) {
    const bb = b || {};
    return `${Number(dayIdx || 0)}|${String(bb.start || '')}|${String(bb.end || '')}|${String(bb.schedule || '')}|${Number(idx || 0)}`;
  }

  function blockStatus(dayIso, block) {
    const now = nowManilaParts();
    if (!now) return 'Scheduled';
    const targetIso = String(dayIso || '');
    const todayIso = String(now.isoDate || '');
    if (targetIso < todayIso) return 'Completed';
    if (targetIso > todayIso) return 'Scheduled';
    const nowMin = (Number(now.hh) || 0) * 60 + (Number(now.mm) || 0);
    const s = parseHM(block.start);
    const e = parseHM(block.end);
    const wraps = e <= s;
    const active = wraps ? (nowMin >= s || nowMin < e) : (nowMin >= s && nowMin < e);
    if (active) return 'In Progress';
    if (nowMin >= s) return 'Completed';
    return 'Scheduled';
  }

  function isDayCompleted(dayIso, blocks) {
    const now = nowManilaParts();
    if (!now) return false;
    const targetIso = String(dayIso || '');
    const todayIso = String(now.isoDate || '');
    if (targetIso < todayIso) return true;
    if (targetIso > todayIso) return false;
    const list = Array.isArray(blocks) ? blocks : [];
    if (!list.length) return false;
    return list.every(b => blockStatus(targetIso, b) === 'Completed');
  }

  function formatNowTimeBadge() {
    const now = nowManilaParts();
    if (!now) return 'Now';
    const hh = Number(now.hh) || 0;
    const mm = Number(now.mm) || 0;
    const period = hh >= 12 ? 'PM' : 'AM';
    const h12 = (hh % 12) || 12;
    return `${h12}:${pad2(mm)} ${period}`;
  }

  function render() {
    // BUG FIX: Use _isMounted() instead of document.contains(root).
    // root=#main is ALWAYS in document, so document.contains never protects us.
    // _isMounted() checks the routeSeq stamp set by the router at page mount time.
    if (!_isMounted()) return;
    const host = root || document.getElementById('main') || document.body;
    const team = getTeam();
    const teamLabel = (window.Config && Config.teamLabel && currentTeamId() !== '') ? Config.teamLabel(currentTeamId()) : (team ? (team.label || team.id) : (currentTeamId() || '—'));
    const shift = inferTeamShift(team);
    const sk = shiftKey();

    const week = Array.from({ length: 7 }, (_, d) => {
      const iso = isoForDay(d);
      const blocks = getMyBlocks(d).map(normalizeBlock).sort((a, b) => parseHM(a.start) - parseHM(b.start));
      return { dayIdx: d, iso, dayLabel: DAYS[d], blocks };
    });

    const mode = viewMode;
    const visibleDays = (mode === 'day') ? [week[focusDay]] : week;
    const countdown = computeCountdown(shift);

    const todayLong = formatDateLong(todayISO);
    const focusISO = isoForDay(focusDay);
    const focusLong = formatDateLong(focusISO);

    const tzLine = (localTZ && localTZ !== tzManila)
      ? `Local: <b>${esc(localTZ)}</b> • Manila: <b>${esc(tzManila)}</b>`
      : `Timezone: <b>${esc(tzManila)}</b>`;

    const totalWeekBlocks = week.reduce((n, d) => n + d.blocks.length, 0);
    const todayBlocks = week[todayWD] ? week[todayWD].blocks : [];

    const hours = Math.max(1, Math.ceil(shift.lenMin / 60));
    const countdownTone = computeCountdownTone(countdown);
    const nowOffset = currentTimeOffsetMinutes(shift);

    host.innerHTML = `
      <div class="schx" data-shift="${esc(sk)}" style="${esc(buildThemeStyleVars(hours))}">
        <div class="schx-header">
          <div>
            <div class="ux-h1">My Schedule</div>
            <div class="small muted">${esc(todayLong)} • ${tzLine}</div>
          </div>
          <div class="schx-actions">
            <div class="schx-toggle" role="tablist" aria-label="Schedule view">
              <button class="btn ghost small ${mode === 'week' ? 'active' : ''}" type="button" data-view="week" role="tab" aria-selected="${mode === 'week'}">Weekly</button>
              <button class="btn ghost small ${mode === 'day' ? 'active' : ''}" type="button" data-view="day" role="tab" aria-selected="${mode === 'day'}">Daily</button>
              <button class="btn ghost small ${mode === 'team' ? 'active' : ''}" type="button" data-view="team" role="tab" aria-selected="${mode === 'team'}">Team</button>
            </div>
            <span class="ux-chip"><span class="dot"></span>${esc(role || '')}${teamLabel ? ` • ${esc(teamLabel)}` : ''}</span>
            <a class="btn" href="/my_attendance">Attendance</a>
            <a class="btn" href="/mailbox">Mailbox</a>
            <button class="btn schx-header-cta" type="button" data-act="new-action-item" aria-label="New Action Item">
              <span class="schx-action-cta-icon" aria-hidden="true">＋</span>
              <span>New Action Item</span>
            </button>
          </div>
        </div>

        <div class="schx-kpis">
          <div class="schx-kpi">
            <div class="small muted">Shift status</div>
            <div class="big">${esc(shiftLabel(sk))}</div>
            <div class="small muted">${esc(shift.startHM)}–${esc(shift.endHM)}</div>
          </div>
          <div class="schx-kpi">
            <div class="small muted">Today</div>
            <div class="big">${todayBlocks.length} block${todayBlocks.length === 1 ? '' : 's'}</div>
            <div class="small muted">${countdown.active ? `Active: ${esc(taskLabel(countdown.active.schedule))}` : (todayBlocks.length ? 'No active block' : 'No blocks')}</div>
          </div>
          <div class="schx-kpi countdown ${esc(countdownTone)}">
            <div class="small muted">Countdown</div>
            <div class="big" id="schxCountdown">${esc(countdown.label)}</div>
            <div class="small muted">Auto-updates in real time</div>
          </div>
          <div class="schx-kpi">
            <div class="small muted">This week</div>
            <div class="big">${totalWeekBlocks} total</div>
            <div class="small muted">${esc(formatDateLong(weekStartSunISO))} → ${esc(formatDateLong(isoForDay(6)))}</div>
          </div>
        </div>

        <div class="schx-legend" aria-label="Schedule legend and actions">
          <div class="schx-legend-items">
            ${scheduleLegendItems().map(item => `<span class="legend-item"><span class="legend-dot" style="background:${esc(item.color)}"></span>${esc(item.label)}</span>`).join('')}
          </div>
        </div>

        ${(mode === 'day' || mode === 'team') ? renderDayTabs(week) : ''}

        <div class="schx-cal" aria-label="Schedule calendar">
          ${mode === 'team'
      ? renderTeamView(shift, hours, focusISO, focusLong)
      : `
            <div class="${mode === 'day' ? 'schx-day-layout' : ''}">
            <div class="schx-grid" style="--shift-len:${shift.lenMin}">
              <div class="schedule-ruler schx-ruler" aria-hidden="true">
                <!-- Spacer matches the day header + gap so tick labels align with grid lines -->
                <div class="schx-ruler-spacer" aria-hidden="true"></div>
                <div class="schx-ruler-body schx-ruler-grid" aria-hidden="true">
                  ${renderRuler(shift, hours)}
                </div>
              </div>

              <div class="schx-cols ${mode === 'day' ? 'day' : 'week'}" id="schxCols" aria-label="${mode === 'day' ? 'Daily calendar' : 'Weekly calendar'}">
                ${nowOffset != null ? `<div class="schx-nowline" aria-hidden="true" style="top:calc(var(--schx-head-h) + var(--schx-head-gap) + ${(nowOffset / 60)} * var(--schx-row-h))"><span class="schx-nowline-dot"></span><span class="schx-nowline-badge">${esc(formatNowTimeBadge())}</span></div>` : ''}
                ${visibleDays.map(d => renderDay(d, shift, hours)).join('')}
              </div>
            </div>
            ${mode === 'day' ? renderDayContextPanel(week[focusDay]) : ''}
            </div>

            <div class="schx-foot">
              <div class="small muted">Tip: ${mode === 'day' ? 'Swipe left/right on the day canvas to change day.' : 'On smaller screens, switch to Daily view for maximum readability.'}</div>
              <div class="ux-row" style="justify-content:flex-end">
                <a class="btn" href="/master_schedule">Master Schedule</a>
                ${canEditSelf ? '<a class="btn" href="/members">Edit Team Schedules</a>' : ''}
              </div>
            </div>
          `
    }
        </div>

        <details class="schx-audit" style="margin-top:14px">
          <summary class="mysx-summary">Audit trail (best-effort)</summary>
          <div class="small muted" style="margin-top:10px">Shows the latest schedule audit events recorded for this week (Team Lead actions).</div>
          <div style="margin-top:10px">${renderAuditList()}</div>
        </details>

        <div id="schxTooltip" class="mysx-tooltip" role="tooltip" aria-hidden="true"></div>
      </div>
    `;

    bindViewToggle(host);
    bindDayTabs(host);
    bindTooltip(host);
    bindBlockSelection(host);
    bindNewActionItem(host, week);
    bindSwipe(host);
    startTickLoop(host, shift);
  }

  function minutesToTimeInput(min) {
    const safe = Number.isFinite(Number(min)) ? Number(min) : 0;
    const normalized = ((safe % (24 * 60)) + (24 * 60)) % (24 * 60);
    return hm(normalized);
  }

  function composeActionItemDescription(shortText, fullText) {
    const shortValue = String(shortText || '').trim();
    const fullValue = String(fullText || '').trim();
    if (shortValue && fullValue) return `${shortValue}: ${fullValue}`;
    return shortValue || fullValue || '';
  }

  function isWithinBlockWindow(block, minuteValue) {
    const b = normalizeBlock(block);
    const start = parseHM(b.start);
    const end = parseHM(b.end);
    const minute = Number(minuteValue);
    if (!Number.isFinite(minute)) return false;
    if (end === start) return minute === start;
    if (end > start) return minute >= start && minute < end;
    return minute >= start || minute < end;
  }

  function buildStandaloneActionBlock(timeValue, shortText, fullText) {
    const startMin = parseHM(timeValue);
    const endMin = startMin + 60;
    const shortValue = String(shortText || '').trim();
    const fullValue = String(fullText || '').trim();
    const detail = composeActionItemDescription(shortValue, fullValue);
    const actionItem = normalizeActionItem({ description: detail, completed: false, priority: 'normal' });
    return normalizeBlock({
      start: minutesToTimeInput(startMin),
      end: minutesToTimeInput(endMin),
      schedule: shortValue || 'Action Item',
      notes: fullValue,
      actionItems: [actionItem],
    });
  }

  function buildActionItemModal() {
    const defaultDate = isoForDay(focusDay);
    const shift = inferTeamShift(getTeam());
    const defaultTime = String(shift && shift.startHM ? shift.startHM : '09:00');
    return `
      <div class="modal" id="schxActionModal" aria-hidden="true" role="dialog" aria-label="New Action Item">
        <div class="panel schx-modal-panel">
          <div class="head">
            <strong>New Action Item</strong>
            <button class="btn ghost tiny" type="button" data-act="close-action-modal" aria-label="Close">✕</button>
          </div>
          <div class="body">
            <form id="schxActionForm" class="schx-action-form" novalidate>
              <label class="small muted" for="schxActionDate">Date</label>
              <input id="schxActionDate" type="date" value="${esc(defaultDate)}" required>

              <label class="small muted" for="schxActionTime">Time</label>
              <input id="schxActionTime" type="time" value="${esc(defaultTime)}" required>

              <label class="small muted" for="schxActionShort">Short Description</label>
              <input id="schxActionShort" type="text" maxlength="80" placeholder="Quick title" required>

              <label class="small muted" for="schxActionFull">Full Description</label>
              <textarea id="schxActionFull" maxlength="500" rows="4" placeholder="Add full details" required></textarea>
              <div class="small muted"><span id="schxDetailsCount">0</span>/500</div>

              <div class="ux-row" style="justify-content:flex-end; margin-top:8px;">
                <button class="btn ghost" type="button" data-act="close-action-modal">Cancel</button>
                <button class="btn primary" type="submit">Save</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    `;
  }

  function bindNewActionItem(host, week) {
    const openBtn = host.querySelector('[data-act="new-action-item"]');
    if (!openBtn) return;

    const staleModal = document.getElementById('schxActionModal');
    if (staleModal) {
      staleModal.remove();
      document.body.classList.remove('modal-open');
    }

    const modalWrap = document.createElement('div');
    modalWrap.innerHTML = buildActionItemModal();
    const modal = modalWrap.firstElementChild;
    if (!modal) return;
    document.body.appendChild(modal);

    const close = () => {
      document.body.classList.remove('modal-open');
      modal.remove();
    };

    const show = () => {
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
      document.body.classList.add('modal-open');
      const first = modal.querySelector('#schxActionDate');
      if (first) first.focus();
    };

    openBtn.addEventListener('click', show);

    modal.addEventListener('click', (e) => {
      if (e.target === modal) close();
    });
    modal.querySelectorAll('[data-act="close-action-modal"]').forEach(btn => btn.addEventListener('click', close));

    const detailsEl = modal.querySelector('#schxActionFull');
    const countEl = modal.querySelector('#schxDetailsCount');
    if (detailsEl && countEl) {
      detailsEl.addEventListener('input', () => {
        const len = String(detailsEl.value || '').slice(0, 500).length;
        countEl.textContent = String(len);
      });
    }

    const form = modal.querySelector('#schxActionForm');
    if (!form) return;
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const actionDate = String((modal.querySelector('#schxActionDate') || {}).value || '').trim();
      const actionTime = String((modal.querySelector('#schxActionTime') || {}).value || '').trim();
      const shortDescription = String((modal.querySelector('#schxActionShort') || {}).value || '').trim();
      const fullDescription = String((modal.querySelector('#schxActionFull') || {}).value || '').trim();

      if (!actionDate) {
        if (window.UI && UI.toast) UI.toast('Please select a date.', 'warn');
        return;
      }
      if (!actionTime || !/^\d{2}:\d{2}$/.test(actionTime)) {
        if (window.UI && UI.toast) UI.toast('Please select a valid time.', 'warn');
        return;
      }
      if (!shortDescription) {
        if (window.UI && UI.toast) UI.toast('Short description is required.', 'warn');
        return;
      }
      if (!fullDescription) {
        if (window.UI && UI.toast) UI.toast('Full description is required.', 'warn');
        return;
      }
      if (shortDescription.length > 80) {
        if (window.UI && UI.toast) UI.toast('Short description must be 80 characters or less.', 'warn');
        return;
      }
      if (fullDescription.length > 500) {
        if (window.UI && UI.toast) UI.toast('Full description must be 500 characters or less.', 'warn');
        return;
      }

      const dayIdx = week.findIndex(day => String(day && day.iso || '') === actionDate);
      if (dayIdx < 0) {
        if (window.UI && UI.toast) UI.toast('Selected date is outside the visible week.', 'warn');
        return;
      }

      const current = getMyBlocks(dayIdx).map(normalizeBlock);
      const minuteValue = parseHM(actionTime);
      const matchIndex = current.findIndex(block => isWithinBlockWindow(block, minuteValue));
      const combined = composeActionItemDescription(shortDescription, fullDescription);
      const appended = normalizeActionItem({ description: combined, completed: false, priority: 'normal' });

      let nextBlocks = [];
      if (matchIndex >= 0) {
        nextBlocks = current.map((b, idx) => {
          if (idx !== matchIndex) return b;
          const existing = Array.isArray(b.actionItems) ? b.actionItems.map(normalizeActionItem).filter(item => !!item.description) : [];
          const nextNotes = [String(b.notes || '').trim(), fullDescription].filter(Boolean).join('\n');
          return {
            ...b,
            actionItems: [...existing, appended],
            notes: nextNotes,
          };
        });
      } else {
        nextBlocks = [...current, buildStandaloneActionBlock(actionTime, shortDescription, fullDescription)]
          .sort((a, b) => parseHM(a.start) - parseHM(b.start));
      }

      if (window.Store && Store.setUserDayBlocks) {
        Store.setUserDayBlocks(me.id, currentTeamId(), dayIdx, nextBlocks);
      }
      if (window.UI && UI.toast) {
        UI.toast(matchIndex >= 0 ? 'Action item linked to existing task block.' : 'Action item added to your schedule.', 'ok');
      }
      close();
      render();
    });
  }


  function renderDayTabs(week) {
    return `
      <div class="schx-daytabs" role="tablist" aria-label="Focus day">
        ${week.map(d => {
      const active = d.dayIdx === focusDay ? 'active' : '';
      const today = isTodayISO(d.iso) ? 'is-today' : '';
      const dot = d.blocks.length ? '<span class="dot" aria-hidden="true"></span>' : '';
      const date = String(d.iso || '').slice(-2);
      return `<button class="schx-daytab ${active} ${today}" type="button" data-day="${d.dayIdx}" role="tab" aria-selected="${d.dayIdx === focusDay}"><span class="schx-daytab-date">${esc(date)}</span> <span>${esc(d.dayLabel.slice(0, 3))}</span>${dot}</button>`;
    }).join('')}
      </div>
    `;
  }

  // Ruler is rendered as fixed-height rows (shared unit system with the calendar grid)
  // to avoid pixel drift on zoom/resizes and keep labels aligned with grid lines.
  function renderRuler(shift, hours) {
    const rows = [];
    for (let i = 0; i < hours; i++) {
      const label = hm(shift.startMin + (i * 60));
      rows.push(`<div class="schx-ruler-row" aria-hidden="true"><span class="schx-tick-label">${esc(label)}</span></div>`);
    }

    // Add the end boundary label (e.g., 15:00) pinned to the bottom grid line.
    const endLabel = hm(shift.startMin + (hours * 60));
    rows.push(`<div class="schx-ruler-end" aria-hidden="true"><span class="schx-tick-label">${esc(endLabel)}</span></div>`);
    return rows.join('');
  }

  function renderDay(day, shift, hours) {
    const d = day;
    const todayClass = isTodayISO(d.iso) ? 'is-today' : '';
    const blocks = (d.blocks || []).map(normalizeBlock);
    const dayCompletedClass = isDayCompleted(d.iso, blocks) ? 'is-completed' : '';

    const blocksHtml = blocks.map((b, idx) => {
      const label = taskLabel(b.schedule) || 'Block';
      const c = taskColor(b.schedule);
      const vars = taskVars(c);
      const m = blockMetrics(shift, b);
      const compact = m.heightH < 1.2;
      const bKey = blockKey(d.dayIdx, b, idx);
      const selected = (viewMode === 'day' && selectedBlockKey === bKey) ? 'is-selected' : '';
      const status = blockStatus(d.iso, b);
      const doneClass = status === 'Completed' ? 'is-completed' : '';
      const liveClass = (viewMode === 'week' && status === 'In Progress') ? 'is-live-current' : '';
      const localRange = (localTZ && localTZ !== tzManila) ? localRangeLabel(d.iso, b.start, b.end) : '';
      const audit = findAuditForBlock(d.dayIdx, b);
      const auditLine = audit ? `Assigned by ${audit.actorName || '—'} • ${formatTs(audit.ts)}` : '';

      const tooltipLines = [
        `${label}`,
        `${formatDateLong(d.iso)}`,
        `${b.start}–${b.end} (Manila)`,
      ];
      if (localRange) tooltipLines.push(`${localRange} (${localTZ})`);
      if (auditLine) tooltipLines.push(auditLine);
      if (b.notes) tooltipLines.push(`Notes: ${b.notes}`);

      return `
        <div
          class="schedule-block schx-block ${selected} ${compact ? 'compact' : ''} ${doneClass} ${liveClass}"
          data-task-type="${esc(taskTypeAttr(b.schedule))}"
          data-block-key="${esc(bKey)}"
          data-day="${d.dayIdx}"
          style="top:calc(${m.topH} * var(--schx-row-h));height:calc(${m.heightH} * var(--schx-row-h));--task-color:${esc(vars.color)};--task-text:${esc(vars.text)}"
          role="button"
          tabindex="0"
          data-tooltip="${esc(tooltipLines.join('\n'))}"
          aria-label="${esc(label)}"
          aria-current="${liveClass ? 'time' : 'false'}"
        >
          <div class="schx-bmeta">
            <span class="schx-time-range">${esc(`${b.start} - ${b.end}`)}</span>
            <span class="schx-status-tag">${esc(status)}</span>
          </div>
          <div class="schx-btop minimal">
            <span class="schx-status-icon" aria-hidden="true">${esc(taskIcon(label))}</span>
            <span class="schx-block-title">${esc(label)}</span>
          </div>
          <div class="schx-bfoot">${esc(status)}</div>
        </div>
      `;
    }).join('');

    const lines = renderGridLines(hours);

    return `
      <section class="schx-day ${todayClass} ${dayCompletedClass}" aria-label="${esc(d.dayLabel)} schedule">
        <header class="schx-dayhead ${todayClass} ${dayCompletedClass}">
          <div class="schx-dayname">${esc(d.dayLabel.slice(0, 3))}</div>
          <div class="schx-daydate">${esc(formatDateLong(d.iso))}</div>
        </header>
        <div class="schx-daybody" data-day="${d.dayIdx}" style="--shift-len:${shift.lenMin}" aria-label="${esc(d.dayLabel)} blocks">
          ${lines}
          <div class="schx-vline" aria-hidden="true"></div>
          ${blocksHtml || `<div class="schx-empty small muted">No blocks</div>`}
        </div>
      </section>
    `;
  }

  function renderDayContextPanel(day) {
    const d = day || { dayIdx: focusDay, blocks: [], iso: isoForDay(focusDay), dayLabel: DAYS[focusDay] || 'Day' };
    const blocks = (d.blocks || []).map(normalizeBlock);
    if (!selectedBlockKey && blocks.length) selectedBlockKey = blockKey(d.dayIdx, blocks[0], 0);
    const idx = blocks.findIndex((b, i) => blockKey(d.dayIdx, b, i) === selectedBlockKey);
    const activeIdx = idx >= 0 ? idx : (blocks.length ? 0 : -1);
    const block = activeIdx >= 0 ? blocks[activeIdx] : null;
    const label = block ? (taskLabel(block.schedule) || 'Block') : 'No selected task';
    const status = block ? blockStatus(d.iso, block) : 'N/A';
    return `
      <aside class="schx-context" aria-label="Task context panel">
        <div class="schx-context-head">
          <div class="small muted">Context panel</div>
          <div class="schx-context-date">${esc(formatDateLong(d.iso || isoForDay(focusDay)))}</div>
        </div>
        <div class="schx-context-card">
          <div class="schx-context-title">${esc(label)}</div>
          <div class="small muted">${block ? esc(`${block.start} - ${block.end} • ${status}`) : 'Select a block to see details.'}</div>
          <div class="small muted" style="margin-top:10px;">Granular details are hidden in this view.</div>
        </div>
      </aside>
    `;
  }

  function renderGridLines(hours) {
    const lines = [];
    for (let i = 0; i <= hours; i++) {
      lines.push(`<div class="schx-line" style="top:calc(${i} * var(--schx-row-h))" aria-hidden="true"></div>`);
    }
    return `<div class="schx-lines" aria-hidden="true">${lines.join('')}</div>`;
  }

  function getTeamMembers() {
    const nameOf = (u) => String(u.fullName || u.name || u.displayName || u.username || u.email || u.id || '');
    const dedupSort = (arr) => {
      const seen = new Set();
      return arr.filter(u => {
        if (!u || !u.id) return false;
        if (seen.has(u.id)) return false;
        seen.add(u.id);
        return true;
      }).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    };

    try {
      // ── 1. API cache (authoritative, set by refreshTeamMembers) ───────────
      const cached = Array.isArray(teamMembersCache) ? teamMembersCache.filter(Boolean) : [];
      if (cached.length) return dedupSort(cached);

      // ── 2. Store.getUsers() filtered by liveTeamId ────────────────────────
      // TEAM_LEAD: refreshIntoLocalStore loaded all team members (full team from /api/users/list)
      // MEMBER: only contains self — filtered out below if teamId mismatch is resolved
      const liveTeamId = _resolveMyTeamId();
      if (liveTeamId && window.Store && Store.getUsers) {
        const storeUsers = (Store.getUsers() || []).filter(u => {
          if (!u || u.deleted || u.isDeleted) return false;
          const uTeam = String((u.teamId != null ? u.teamId : u.team_id) || '').trim();
          return uTeam === liveTeamId;
        });
        if (storeUsers.length > 1) return dedupSort(storeUsers); // >1 means TEAM_LEAD with full roster
      }

      // ── 3. Store.getOnlineUsers() filtered by liveTeamId ─────────────────
      // All currently-online users have their teamId set from their session start
      if (liveTeamId && window.Store && Store.getOnlineUsers) {
        const onlineTeam = (Store.getOnlineUsers() || []).filter(u => {
          const uTeam = String(u && (u.teamId || u.team_id) || '').trim();
          return uTeam === liveTeamId;
        }).map(u => ({
          id: String(u.userId || u.id || ''),
          teamId: liveTeamId,
          role: String(u.role || 'MEMBER'),
          name: String(u.name || u.username || u.id || ''),
          fullName: String(u.name || u.username || u.id || ''),
          username: String(u.username || ''),
          avatarUrl: String(u.photo || u.avatar || u.avatarUrl || ''),
        })).filter(u => !!u.id);
        if (onlineTeam.length) return dedupSort(onlineTeam);
      }

      return [];
    } catch (_) {
      return [];
    }
  }

  function avatarInitials(member) {
    const source = String((member && (member.fullName || member.name || member.username || member.email || member.id)) || '').trim();
    if (!source) return 'N/A';
    const parts = source.split(/\s+/).filter(Boolean).slice(0, 2);
    if (!parts.length) return source.slice(0, 2).toUpperCase();
    return parts.map((p) => p.slice(0, 1).toUpperCase()).join('');
  }

  function renderTeamView(shift, hours, focusISO, focusLong) {
    if (_tmState.loading) {
      return `
        <div class="team-schedule-head">
          <div>
            <div class="mysx-section-title">Team Schedule</div>
            <div class="small muted">${esc(focusLong)} • ${esc(tzManila)}${(localTZ && localTZ !== tzManila) ? ` • Local: ${esc(localTZ)}` : ''}</div>
          </div>
        </div>
        <div class="small muted" style="padding:16px;border:1px solid rgba(148,163,184,.2);border-radius:14px;display:flex;align-items:center;gap:10px;">
          <span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(148,163,184,.4);border-top-color:#38bdf8;border-radius:50%;animation:spin .8s linear infinite;"></span>
          Loading team schedules…
        </div>
      `;
    }

    const members = getTeamMembers();
    // FIX-LOOP: Never call refreshTeamMembers() from inside render()/renderTeamView().
    // Doing so creates an infinite loop:
    //   render → renderTeamView → refreshTeamMembers → render (finally) → renderTeamView → ...
    // Team data loading is triggered only from: initial mount, store events, retry timers.
    // The spinner state is shown via _tmState.loading — no need to re-trigger from here.
    const cols = hours;
    const colLabels = Array.from({ length: cols }, (_, i) => hm(shift.startMin + i * 60));
    const hourPx = 120;
    const timelineWidth = cols * hourPx;
    const nowOffset = currentTimeOffsetMinutes(shift);
    const coverage = computeTeamCoverage(members, shift, cols, focusDay);

    const header = `
      <div class="team-schedule-head">
        <div>
          <div class="mysx-section-title">Team Schedule</div>
          <div class="small muted">${esc(focusLong)} • ${esc(tzManila)}${(localTZ && localTZ !== tzManila) ? ` • Local: ${esc(localTZ)}` : ''}</div>
        </div>
      </div>

      <div class="team-schedule-wrap" role="table" aria-label="Team schedule table">
        <div class="team-schedule-grid" role="rowgroup" style="--tsg-hours:${cols};--tsg-hour-px:${hourPx}px;--tsg-timeline-w:${timelineWidth}px">
          <div class="team-schedule-row team-schedule-header" role="row">
            <div class="tsg-h ts-name" role="columnheader">MEMBER</div>
            <div class="tsg-timeline-head" role="columnheader" aria-label="Timeline header">
              <div class="tsg-hour-grid" style="width:${timelineWidth}px">
                ${colLabels.map(t => `<div class="tsg-hour-cell">${esc(t)}</div>`).join('')}
              </div>
            </div>
          </div>
          <div class="team-schedule-body">
            ${members.map(m => renderTeamRow(m, shift, focusDay, focusISO, timelineWidth)).join('') || `<div class="small muted" style="padding:12px">No team members found.</div>`}
            ${renderCoverageRow(coverage, shift, timelineWidth)}
            ${nowOffset != null ? `<div class="tsg-nowline" aria-hidden="true" style="left:calc(var(--tsg-name-w) + ${(nowOffset / shift.lenMin) * 100}%);"><span>${esc(formatNowTimeBadge())}</span></div>` : ''}
          </div>
        </div>
      </div>
    `;

    return header;
  }

  // ── Rest Day / Leave helpers — mirrors Members page logic exactly ────────────
  // Returns true if the given ISO date is the member's rest day.
  // Reads from Store.getTeamMaster() → member.restWeekdays (same source as Members page).
  function isMemberRestDay(member, isoDate) {
    try {
      const teamId = String((member && (member.teamId || member.team_id)) || '').trim() || currentTeamId();
      const userId = String((member && member.id) || '').trim();
      if (!teamId || !userId) return false;
      const teamMaster = (window.Store && Store.getTeamMaster) ? Store.getTeamMaster(teamId) : null;
      const memberMeta = teamMaster && teamMaster.members && teamMaster.members[userId];
      if (!memberMeta || !Array.isArray(memberMeta.restWeekdays) || !memberMeta.restWeekdays.length) return false;
      const wd = weekdayFromISO(isoDate);
      return memberMeta.restWeekdays.includes(wd);
    } catch (_) {
      return false;
    }
  }

  // Returns leave object { type, setAt, setBy } or null.
  // Reads from Store.getLeave() — same source as Members page.
  function getMemberLeave(member, isoDate) {
    try {
      const userId = String((member && member.id) || '').trim();
      if (!userId || !isoDate) return null;
      return (window.Store && Store.getLeave) ? (Store.getLeave(userId, String(isoDate)) || null) : null;
    } catch (_) {
      return null;
    }
  }

  function leaveLabel(type) {
    const map = {
      SICK: 'On Sick Leave',
      EMERGENCY: 'On Emergency Leave',
      VACATION: 'On Vacation Leave',
      HOLIDAY: 'On Holiday Leave',
    };
    return map[String(type || '').toUpperCase()] || 'On Leave';
  }

  // ── getEffectiveBlocksForUserDay ─────────────────────────────────────────────
  // Returns blocks for a user/day, respecting rest days and leaves.
  // If rest day or on leave → returns [] so coverage count is accurate.
  function getEffectiveBlocksForUserDay(member, isoDate, dayIdx) {
    try {
      if (isMemberRestDay(member, isoDate)) return [];
      if (getMemberLeave(member, isoDate)) return [];
      return getBlocksForUserDay(member.id, dayIdx);
    } catch (_) {
      return getBlocksForUserDay(member.id, dayIdx);
    }
  }

  function renderTeamRow(member, shift, dayIdx, iso, timelineWidth) {
    const nameOf = (u) => String(u.fullName || u.name || u.displayName || u.username || u.email || u.id || '');
    const memberName = nameOf(member) || 'N/A';
    const avatarUrl = String((member && (member.avatarUrl || member.avatar_url)) || '').trim();
    const avatar = avatarUrl
      ? `<img src="${esc(avatarUrl)}" alt="${esc(memberName)} avatar" class="tsg-avatar-img" loading="lazy" />`
      : `<span class="tsg-avatar-fallback" aria-hidden="true">${esc(avatarInitials(member))}</span>`;

    // ── Rest day & leave guard (mirrors Members page logic) ──────────────────
    const restDay = isMemberRestDay(member, iso);
    const leave   = getMemberLeave(member, iso);
    const inactive = restDay || !!leave;

    let timelineContent = '';
    if (inactive) {
      const inactiveText = leave ? leaveLabel(leave.type) : 'Rest Day';
      const inactiveCls  = leave ? 'tsg-on-leave' : 'tsg-rest-day';
      timelineContent = `<div class="${inactiveCls}" aria-label="${esc(memberName)} ${esc(inactiveText)}">${esc(inactiveText)}</div>`;
    } else {
      const blocks = getBlocksForUserDay(member.id, dayIdx).map(normalizeBlock).sort((a, b) => parseHM(a.start) - parseHM(b.start));
      const bars = blocks.map((b) => {
        const startOff = computeOffset(shift, b.start);
        const endOff = computeOffset(shift, b.end);
        const r = clampShiftRange(shift, startOff, endOff);
        const widthPct = (r.dur / shift.lenMin) * 100;
        if (widthPct <= 0) return '';
        const leftPct = (r.s / shift.lenMin) * 100;
        const taskId = b.schedule;
        const label = taskLabel(taskId) || 'N/A';
        const color = taskColor(taskId);
        const vars = taskVars(color);
        const tooltip = [
          memberName,
          label,
          formatDateLong(iso),
          `${b.start}–${b.end} (Manila)`,
        ].join('\n');
        return `
          <div
            class="tsg-block"
            role="cell"
            tabindex="0"
            data-task-type="${esc(taskTypeAttr(taskId))}"
            style="left:${leftPct}%;width:${widthPct}%;--task-color:${esc(vars.color)};--task-text:${esc(vars.text)}"
            data-tooltip="${esc(tooltip)}"
            aria-label="${esc(memberName)} ${esc(label)} ${esc(b.start)} to ${esc(b.end)}"
          >
            <span class="tsg-block-label">${esc(label)}</span>
          </div>
        `;
      }).filter(Boolean).join('');
      timelineContent = bars || '<div class="tsg-rest-day">No Schedule</div>';
    }

    return `
      <div class="team-schedule-row member-row${inactive ? ' is-inactive' : ''}" role="row">
        <div class="tsg-name" role="rowheader"><span class="tsg-avatar">${avatar}</span><span class="tsg-member-name">${esc(memberName)}</span></div>
        <div class="tsg-timeline" role="cell" aria-label="${esc(memberName)} timeline">
          <div class="tsg-hour-grid" style="width:${timelineWidth}px">
            ${timelineContent}
          </div>
        </div>
      </div>
    `;
  }

  function isCoverageActiveTask(taskId) {
    const key = normalizeTaskKey(taskLabel(taskId) || taskId);
    return !(key.includes('lunch') || key.includes('break'));
  }

  function computeTeamCoverage(members, shift, cols, dayIdx) {
    // focusISO is needed to check rest days/leaves accurately via calendar date
    const focusISO = isoForDay(dayIdx);
    const counts = Array.from({ length: cols }, () => 0);
    (members || []).forEach(member => {
      // Skip rest days and leaves from coverage count — same as Members page
      if (isMemberRestDay(member, focusISO)) return;
      if (getMemberLeave(member, focusISO)) return;
      const blocks = getBlocksForUserDay(member.id, dayIdx).map(normalizeBlock);
      const slots = Array.from({ length: cols }, () => false);
      blocks.forEach((b) => {
        if (!isCoverageActiveTask(b.schedule)) return;
        const startOff = computeOffset(shift, b.start);
        const endOff = computeOffset(shift, b.end);
        const r = clampShiftRange(shift, startOff, endOff);
        const c0 = Math.max(0, Math.floor(r.s / 60));
        const c1 = Math.min(cols, Math.ceil(r.e / 60));
        for (let i = c0; i < c1; i++) slots[i] = true;
      });
      slots.forEach((active, i) => {
        if (active) counts[i] += 1;
      });
    });
    return counts;
  }

  function renderCoverageRow(coverage, shift, timelineWidth) {
    const cells = (coverage || []).map((count, idx) => {
      const label = hm(shift.startMin + idx * 60);
      return `<div class="tsg-coverage-cell">${esc(label)}: <strong>${Number(count || 0)}</strong> Active</div>`;
    }).join('');
    return `
      <div class="team-schedule-row tsg-coverage" role="row">
        <div class="tsg-name" role="rowheader">Total Active Agents</div>
        <div class="tsg-timeline" role="cell" aria-label="Coverage summary">
          <div class="tsg-hour-grid tsg-coverage-grid" style="width:${timelineWidth}px">${cells}</div>
        </div>
      </div>
    `;
  }

  function renderAuditList() {
    try {
      const weekStartISO = currentWeekStartMondayISO();
      const list = Store.getWeekAudit ? (Store.getWeekAudit(currentTeamId(), weekStartISO) || []) : [];
      const mine = list.filter(a => a && a.targetId === me.id).slice(0, 25);
      if (!mine.length) return `<div class="small muted">No audit entries recorded for your schedule yet this week.</div>`;
      return `<div class="mysx-audit">
        ${mine.map(a => {
        return `<div class="mysx-audit-row">
            <div class="mysx-audit-main">
              <div class="mysx-audit-action">${esc(a.action || '')}</div>
              <div class="small muted">${esc(a.detail || '')}</div>
              <div class="small muted">Actor: ${esc(a.actorName || '—')}</div>
            </div>
            <div class="mysx-audit-ts small muted">${esc(formatTs(a.ts))}</div>
          </div>`;
      }).join('')}
      </div>`;
    } catch (_) {
      return `<div class="small muted">Audit unavailable.</div>`;
    }
  }

  function bindViewToggle(host) {
    const box = host.querySelector('.schx-toggle');
    if (!box) return;
    box.querySelectorAll('button[data-view]').forEach(btn => {
      btn.onclick = () => setViewMode(btn.dataset.view);
    });
  }

  function bindDayTabs(host) {
    const tabs = host.querySelector('.schx-daytabs');
    if (!tabs) return;
    tabs.querySelectorAll('button[data-day]').forEach(btn => {
      btn.onclick = () => setFocusDay(btn.dataset.day);
    });
  }

  function bindTooltip(host) {
    const tip = host.querySelector('#schxTooltip');
    if (!tip) return;

    function show(ev, text) {
      if (!text) return;
      tip.textContent = text;
      tip.setAttribute('aria-hidden', 'false');
      tip.style.opacity = '1';
      const x = (ev && (ev.clientX || 0)) + 12;
      const y = (ev && (ev.clientY || 0)) + 12;
      tip.style.left = `${x}px`;
      tip.style.top = `${y}px`;
    }

    function hide() {
      tip.setAttribute('aria-hidden', 'true');
      tip.style.opacity = '0';
    }

    // Bind to any element with data-tooltip
    host.querySelectorAll('[data-tooltip]').forEach(el => {
      const text = el.getAttribute('data-tooltip') || '';
      el.addEventListener('mouseenter', (ev) => show(ev, text));
      el.addEventListener('mousemove', (ev) => show(ev, text));
      el.addEventListener('mouseleave', hide);
      el.addEventListener('focus', (ev) => show(ev, text));
      el.addEventListener('blur', hide);
      el.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') hide();
      });
    });
  }

  function bindBlockSelection(host) {
    host.querySelectorAll('.schx-block[data-block-key]').forEach(el => {
      const select = () => {
        selectedBlockKey = String(el.getAttribute('data-block-key') || '');
        render();
      };
      el.addEventListener('click', select);
      el.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          select();
        }
      });
    });
  }

  function bindSwipe(host) {
    if (viewMode !== 'day') return;
    const body = host.querySelector('.schx-daybody');
    if (!body) return;
    let x0 = null;
    body.addEventListener('touchstart', (e) => {
      if (!e.touches || !e.touches[0]) return;
      x0 = e.touches[0].clientX;
    }, { passive: true });
    body.addEventListener('touchend', (e) => {
      if (x0 == null) return;
      const x1 = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0].clientX : x0;
      const dx = x1 - x0;
      x0 = null;
      if (Math.abs(dx) < 60) return;
      if (dx < 0) setFocusDay((focusDay + 1) % 7);
      else setFocusDay((focusDay + 6) % 7);
    }, { passive: true });
  }

  function startTickLoop(host, shift) {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    const el = host.querySelector('#schxCountdown');
    const tick = () => {
      placeTeamNowLine(host, shift);
      if (!el) return;
      try {
        const c = computeCountdown(shift);
        el.textContent = c.label || '—';
      } catch (_) { }
    };
    tick();
    if (!el) return;
    tickTimer = setInterval(() => {
      if (!_isMounted()) { clearInterval(tickTimer); tickTimer = null; return; }
      tick();
    }, 1000);
  }

  function placeTeamNowLine(host, shift) {
    try {
      if (viewMode !== 'team') return;
      const line = host.querySelector('.tsg-nowline');
      if (!line) return;

      const nameCol = host.querySelector('.team-schedule-header .tsg-h.ts-name');
      const timelineGrid = host.querySelector('.team-schedule-header .tsg-timeline-head .tsg-hour-grid');
      const firstHourCell = timelineGrid ? timelineGrid.querySelector('.tsg-hour-cell') : null;
      const badge = line.querySelector('span');
      if (badge) badge.textContent = formatNowTimeBadge();

      const nowOffset = currentTimeOffsetMinutes(shift);
      if (nowOffset == null || !nameCol || !timelineGrid || !firstHourCell) {
        line.style.display = 'none';
        return;
      }

      const nameWidth = Number(nameCol.getBoundingClientRect().width) || 0;
      const hourWidth = Number(firstHourCell.getBoundingClientRect().width) || 0;
      const timelineWidth = Number(timelineGrid.scrollWidth || timelineGrid.getBoundingClientRect().width) || 0;
      if (nameWidth <= 0 || hourWidth <= 0 || timelineWidth <= 0) {
        line.style.display = 'none';
        return;
      }

      const offsetInTimeline = (nowOffset / 60) * hourWidth;
      const clampedOffset = Math.max(0, Math.min(timelineWidth, offsetInTimeline));
      line.style.left = `${nameWidth + clampedOffset}px`;
      line.style.display = '';
    } catch (_) { }
  }

  // ── Personal Schedule Loader ─────────────────────────────────────────────────
  // Fetches the current user's own schedule blocks from the API and hydrates
  // localStorage so getMyBlocks() returns real data (not just realtime leftovers).
  async function loadMyScheduleBlocks() {
    const uid = String((me && me.id) || sessionUserId || '').trim();
    if (!uid) return;
    const liveTeamId = _resolveMyTeamId();
    const jwt = getBearerToken();
    const headers = jwt ? { Authorization: `Bearer ${jwt}` } : {};
    const params = new URLSearchParams({ includeTeam: '0' });
    if (liveTeamId) params.set('hintTeamId', liveTeamId);
    try {
      const res = await fetch(`/api/member/${encodeURIComponent(uid)}/schedule?${params}`, { headers, cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      const rawBlocks = Array.isArray(data && data.scheduleBlocks) ? data.scheduleBlocks : [];
      if (!rawBlocks.length) return;
      // Resolve effective teamId
      const effectiveTeamId = String(data.teamId || liveTeamId || '');
      // Persist team on me if resolved
      if (effectiveTeamId && me) { me.teamId = effectiveTeamId; me.team_id = effectiveTeamId; }
      // Group by dayIndex and store via Store API
      if (window.Store && Store.setUserDayBlocks) {
        const byDay = {};
        rawBlocks.forEach(b => {
          const d = Number(b && b.dayIndex);
          if (!Number.isFinite(d) || d < 0 || d > 6) return;
          if (!byDay[d]) byDay[d] = [];
          byDay[d].push(b);
        });
        Object.entries(byDay).forEach(([d, blocks]) => {
          Store.setUserDayBlocks(uid, effectiveTeamId, Number(d), blocks);
        });
      }
      // Re-render so new blocks are shown immediately
      if (_isMounted()) render();
    } catch (_) {}
  }

  // ── Team Members Loader ─────────────────────────────────────────────────────
  async function refreshTeamMembers() {
    // FIX-LOOP-GUARD: Use _isMounted() — document.contains(root) is always true for #main
    if (!_isMounted()) {
      clearTimeout(_tmState.retryTimer);
      return;
    }
    if (_tmState.loading) return;
    // FIX-LOOP-GUARD: Rate-limit consecutive calls (min 2s between fetches).
    // Prevents rapid re-entry from retry timers or store events during network failures.
    const _now = Date.now();
    if (_tmState._lastFetchAt && (_now - _tmState._lastFetchAt) < 2000) return;
    _tmState._lastFetchAt = _now;

    const liveUser = (window.Auth && Auth.getUser) ? Auth.getUser() : me;
    const uid = String((liveUser && liveUser.id) || (me && me.id) || '').trim();

    if (!uid) {
      if (_tmState.retryCount < 8) {
        _tmState.retryCount++;
        clearTimeout(_tmState.retryTimer);
        _tmState.retryTimer = setTimeout(() => {
          if (!_isMounted()) return;
          if (viewMode === 'team') refreshTeamMembers();
        }, 400);
      }
      return;
    }

    // Resolve teamId from all available sources
    const liveTeamId = _resolveMyTeamId();

    // Cache hit: already loaded real members for this team
    if (_tmState.loaded && _tmState.teamId === liveTeamId && teamMembersCache.length > 0) return;

    _tmState.loading = true;
    render();

    try {
      const jwt = getBearerToken();
      const headers = jwt ? { Authorization: `Bearer ${jwt}` } : {};

      const buildUrl = (extra) => {
        const p = new URLSearchParams({ includeTeam: '1' });
        if (liveTeamId) p.set('hintTeamId', liveTeamId);
        Object.entries(extra || {}).forEach(([k, v]) => { if (v) p.set(k, v); });
        return `/api/member/${encodeURIComponent(uid)}/schedule?${p}`;
      };

      // Resolve teamId for each member row: DB → presence map → own presence entry
      let _presenceMap = null;
      const getPresenceMap = () => {
        if (_presenceMap) return _presenceMap;
        _presenceMap = {};
        try {
          if (window.Store && Store.getOnlineUsers) {
            (Store.getOnlineUsers() || []).forEach(u => {
              const uid = String(u.userId || u.id || '');
              if (uid) _presenceMap[uid] = String(u.teamId || '').trim();
            });
          }
        } catch (_) {}
        return _presenceMap;
      };

      const mapRow = (row) => {
        const r = row && typeof row === 'object' ? row : {};
        const uid = String(r.id || r.user_id || '');
        const dbTeamId = String(r.teamId || r.team_id || '').trim();
        // Enrich from presence map when DB has no teamId (handles allProfiles fallback)
        const presenceTeamId = (!dbTeamId && uid) ? (getPresenceMap()[uid] || '') : '';
        const teamId = dbTeamId || presenceTeamId;
        return {
          id:        uid,
          teamId,
          role:      String(r.role || 'MEMBER'),
          name:      String(r.name || r.username || r.id || ''),
          fullName:  String(r.name || r.username || r.id || ''),
          username:  String(r.username || ''),
          avatarUrl: String(r.avatarUrl || r.avatar_url || ''),
        };
      };

      // ── Fetch ─────────────────────────────────────────────────────────────
      // FIX[SCHEDULE-LATENCY]: Include resolveTeamId on first call to avoid double fetch
      const res = await fetch(buildUrl(liveTeamId ? { resolveTeamId: liveTeamId } : {}), { headers, cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));

      const resolvedTeamId = String((data && data.teamId) || liveTeamId || '').trim();
      const rawMembers = Array.isArray(data && data.teamMembers) ? data.teamMembers : [];

      // Server may return ALL profiles (allProfiles fallback) when DB team_id is NULL for everyone.
      // Filter down to just the members in liveTeamId.
      const filterTeamId = resolvedTeamId || liveTeamId;
      const members = rawMembers
        .map(mapRow)
        .filter(m => {
          if (!m.id) return false;
          if (!filterTeamId) return true;  // no filter possible
          // If DB teamId is empty, server used allProfiles fallback — trust the server
          // (server already applies team_id filter; empty here means NULL in DB, not cross-team)
          if (!m.teamId) { m.teamId = filterTeamId; return true; }
          return m.teamId === filterTeamId;
        });

      // Also try resolveTeamId retry if result is empty or UUID-only names
      const isUuidOnly = members.length > 0 &&
        members.every(m => /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(m.name));

      let finalMembers = members;
      let finalBlocks  = data.teamScheduleBlocks;

      if ((members.length === 0 || isUuidOnly) && resolvedTeamId) {
        try {
          const res2 = await fetch(buildUrl({ resolveTeamId: resolvedTeamId }), { headers, cache: 'no-store' });
          if (res2.ok) {
            const d2 = await res2.json().catch(() => ({}));
            const m2 = (Array.isArray(d2.teamMembers) ? d2.teamMembers : [])
              .map(mapRow)
              .filter(m => {
                if (!m.id) return false;
                if (!filterTeamId) return true;
                if (!m.teamId) { m.teamId = filterTeamId; return true; }
                return m.teamId === filterTeamId;
              });
            if (m2.length > (isUuidOnly ? 0 : members.length)) {
              finalMembers = m2;
              finalBlocks  = d2.teamScheduleBlocks;
            }
          }
        } catch (_) {}
      }

      if (finalMembers.length > 0) {
        teamMembersCache = finalMembers;
        _tmState.loaded  = true;
        _tmState.teamId  = filterTeamId;
        _tmState.retryCount = 0;
        clearTimeout(_tmState.retryTimer);

        if (filterTeamId && me) { me.teamId = filterTeamId; me.team_id = filterTeamId; }
        _hydrateTeamScheduleBlocks(finalBlocks, filterTeamId);
      } else {
        // Empty — schedule retry with backoff (max 6 retries)
        _tmState.retryCount++;
        if (_tmState.retryCount <= 6) {
          const delay = Math.min(600 * _tmState.retryCount, 4000);
          clearTimeout(_tmState.retryTimer);
          _tmState.retryTimer = setTimeout(() => {
            if (!_isMounted()) return;
            if (viewMode === 'team') refreshTeamMembers();
          }, delay);
        } else {
          // FIX-LOOP: After max retries with no members, mark loaded=true so
          // renderTeamView no longer attempts to trigger refreshTeamMembers.
          _tmState.loaded = true;
        }
      }

      render();
    } catch (_) {
      // Swallow fetch errors — retry timer will re-attempt after backoff delay
    } finally {
      _tmState.loading = false;
      // FIX-LOOP: Do NOT call render() here. This was the re-entry point that
      // restarted the infinite loop after every failed/empty fetch:
      //   finally(loading=false) → render() → renderTeamView → refreshTeamMembers() → ...
      // Successful paths already called render() inside the try block above.
      // Retry paths use setTimeout so they're deferred, not synchronous re-entry.
    }
  }

    function _hydrateTeamScheduleBlocks(teamScheduleBlocks, resolvedTeamId) {
    try {
      if (!window.Store || !Store.setUserDayBlocks) return;
      const tsb = Array.isArray(teamScheduleBlocks) ? teamScheduleBlocks : [];
      if (!tsb.length) return;
      const effectiveTeam = resolvedTeamId || currentTeamId() || '';
      const bucket = new Map();
      tsb.forEach((row) => {
        const r = row && typeof row === 'object' ? row : {};
        const memberId = String(r.userId || r.user_id || '').trim();
        const dayIdx = Number(r.dayIndex);
        if (!memberId || !Number.isInteger(dayIdx) || dayIdx < 0 || dayIdx > 6) return;
        const key = `${memberId}|${dayIdx}`;
        if (!bucket.has(key)) bucket.set(key, []);
        const sr = String(r.schedule || r.role || '').trim();
        bucket.get(key).push({ start: String(r.start || '00:00'), end: String(r.end || '00:00'), schedule: sr, role: sr, notes: String(r.notes || '') });
      });
      bucket.forEach((blocks, key) => {
        const [memberId, day] = key.split('|');
        // Use member's own teamId if available in cache, else fall back to resolved
        const cached = Array.isArray(teamMembersCache) ? teamMembersCache.find(m => String(m.id) === memberId) : null;
        const memberTeamId = (cached && cached.teamId) || effectiveTeam;
        if (!memberTeamId) return;
        Store.setUserDayBlocks(memberId, memberTeamId, Number(day), blocks);
      });
    } catch (_) {}
  }

    // Register cleanup so the router can cancel timers when navigating away.
    // app.js calls root._cleanup() before clearing main.innerHTML on navigation.
    root._cleanup = function() {
      try { clearTimeout(_tmState.retryTimer); _tmState.retryTimer = null; } catch(_) {}
      try { clearInterval(tickTimer); tickTimer = null; } catch(_) {}
      // FIX-LOOP: Reset rate-limit timestamp on cleanup so fresh mount can fetch immediately
      try { _tmState._lastFetchAt = 0; } catch(_) {}
      // Remove store listener to prevent re-renders after navigation
      try {
        if (storeListener) {
          window.removeEventListener('mums:store', storeListener);
          storeListener = null;
        }
      } catch(_) {}
      // Invalidate state so any in-flight fetch callbacks skip render()
      _tmState.loaded  = false;
      _tmState.loading = false;
    };

    // ── Store listener: re-render when realtime pushes schedule updates ──────
    storeListener = function(e) {
      try {
        const key = e && e.detail && e.detail.key;
        const scheduleKeys = new Set(['mums_schedule_blocks', 'ums_weekly_schedules', '*']);
        if (!scheduleKeys.has(key)) return;
        if (!_isMounted()) return;
        // Team view re-renders itself via refreshTeamMembers; personal views re-render here
        if (viewMode !== 'team') render();
        else {
          // For team view, also re-render since new blocks may have arrived
          render();
        }
      } catch (_) {}
    };
    try { window.addEventListener('mums:store', storeListener); } catch(_) {}

    // ── Fire initial load ────────────────────────────────────────────────────
    if (viewMode === 'team') {
      _tmState.retryCount = 0;
      refreshTeamMembers();
    }

    // Initial render (always — shows skeleton/empty state then fills in)
    render();

    // Fetch personal schedule blocks from API (fills in blocks for Week/Day view)
    loadMyScheduleBlocks();
});
