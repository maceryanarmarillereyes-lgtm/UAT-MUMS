/**
 * @file mailbox.js
 * @description Page: Mailbox — mailbox queue management and case assignment
 * @module MUMS/Pages
 * @version UAT
 */
/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */


/* 
 * File: public/js/pages/mailbox.js
 * 
 * === THUNTER FIX SUMMARY (March 6, 2026) ===
 * BUG #1 FIXED (Lines 806-812): Mgr label responsive display — removed hardcoded inline styles, added `.mbx-mgr-label` CSS class
 * BUG #2 FIXED (Lines 505-580): Added responsive CSS for mgr labels (mobile breakpoints, word-wrapping)
 * BUG #3 FIXED (Lines 219-230): Added legacy user.schedule/user.task fallback in _mbxDutyLabelForUser for MEMBER-role visibility
 * ======================================
 */

function _mbxIsoDow(isoDate){
  try{
    if(isoDate) return new Date(String(isoDate||'') + 'T00:00:00+08:00').getDay();
    if(window.UI && window.UI.manilaNowDate) return new Date(window.UI.manilaNowDate()).getDay();
    // Strict GMT+8 Fallback to guarantee global visibility sync across all agents
    const d = new Date();
    const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
    return new Date(utc + (3600000 * 8)).getDay();
  }catch(_){ return 1; }
}

function _mbxToSegments(startMin, endMin){
  if(!Number.isFinite(startMin) || !Number.isFinite(endMin)) return [];
  if(endMin > startMin) return [[startMin, endMin]];
  return [[startMin, 24*60],[0, endMin]];
}

function _mbxSegmentsOverlap(aSegs, bSegs){
  for(const a of (aSegs||[])){
    for(const b of (bSegs||[])){
      if(a[0] < b[1] && b[0] < a[1]) return true;
    }
  }
  return false;
}

function _mbxBlockHit(nowMin, s, e){
  const wraps = e <= s;
  return (!wraps && nowMin >= s && nowMin < e) || (wraps && (nowMin >= s || nowMin < e));
}

function _mbxInDutyWindow(nowMin, team){
  if(!team) return false;
  const s = _mbxParseHM(team.dutyStart||'00:00');
  const e = _mbxParseHM(team.dutyEnd||'00:00');
  return _mbxBlockHit(nowMin, s, e);
}

function eligibleForMailboxManager(user, opts){
  if(!user) return false;
  opts = opts || {};
  const r = String(user.role||'');
  const admin = (window.Config && window.Config.ROLES) ? window.Config.ROLES.ADMIN : 'ADMIN';
  const superAdmin = (window.Config && window.Config.ROLES) ? window.Config.ROLES.SUPER_ADMIN : 'SUPER_ADMIN';
  const superUser = (window.Config && window.Config.ROLES) ? window.Config.ROLES.SUPER_USER : 'SUPER_USER';
  const teamLead = (window.Config && window.Config.ROLES) ? window.Config.ROLES.TEAM_LEAD : 'TEAM_LEAD';

  if(r===superAdmin || r===superUser || r===admin || r===teamLead) return true;
  if(opts.teamId && String(user.teamId||'') !== String(opts.teamId||'')) return false;

  const UI = window.UI;
  const Store = window.Store;
  const nowParts = opts.nowParts || (UI && UI.mailboxNowParts ? UI.mailboxNowParts() : (UI ? UI.manilaNow() : null));
  if(!UI || !Store || !nowParts) return false;

  const nowMin = _mbxMinutesOfDayFromParts(nowParts);
  if(opts.dutyTeam && !_mbxInDutyWindow(nowMin, opts.dutyTeam)) return false;

  const roleSet = new Set(['mailbox_manager','mailbox_call']);
  const dow = _mbxIsoDow(nowParts.isoDate);
  const dows = [dow];

  try{
    if(opts.dutyTeam){
      const s = _mbxParseHM(opts.dutyTeam.dutyStart||'00:00');
      const e = _mbxParseHM(opts.dutyTeam.dutyEnd||'00:00');
      const wraps = e <= s;
      if(wraps && nowMin < e){
        dows.push((dow+6)%7);
      }
    }else{
      dows.push((dow+6)%7);
    }
  }catch(_){}

  for(const di of dows){
    const blocks = Store.getUserDayBlocks ? (Store.getUserDayBlocks(user.id, di) || []) : [];
    for(const b of blocks){
      const rr = String(b?.role||'');
      if(!roleSet.has(rr)) continue;
      const s = (UI.parseHM ? UI.parseHM(b.start) : _mbxParseHM(b.start));
      const e = (UI.parseHM ? UI.parseHM(b.end) : _mbxParseHM(b.end));
      if(!Number.isFinite(s) || !Number.isFinite(e)) continue;
      if(_mbxBlockHit(nowMin, s, e)) return true;
    }
  }

  try{
    const legacy = String(user.schedule||'').toLowerCase();
    if(legacy==='mailbox_manager' || legacy==='mailbox_call'){
      if(opts.dutyTeam) return _mbxInDutyWindow(nowMin, opts.dutyTeam);
      return true;
    }
  }catch(_){}
  try{
    const t = String(user.task||user.taskId||user.taskRole||user.primaryTask||'').toLowerCase();
    if(t==='mailbox_manager' || t==='mailbox manager'){
      if(opts.dutyTeam) return _mbxInDutyWindow(nowMin, opts.dutyTeam);
      return true;
    }
  }catch(_){}
  return false;
}

function _mbxMinutesOfDayFromParts(p){
  return (Number(p.hh)||0) * 60 + (Number(p.mm)||0);
}

function _mbxParseHM(hm){
  const raw = String(hm||'').trim();
  if(!raw) return 0;
  let mer = '';
  let base = raw;
  const merMatch = raw.match(/\b(am|pm)\b/i);
  if(merMatch){
    mer = merMatch[1].toLowerCase();
    base = raw.replace(/\b(am|pm)\b/i, '').trim();
  }
  const parts = base.split(':');
  let h = Number(parts[0]);
  let m = Number(parts[1]);
  if(!Number.isFinite(h)) h = 0;
  if(!Number.isFinite(m)) m = 0;
  h = Math.max(0, Math.min(23, h));
  m = Math.max(0, Math.min(59, m));
  if(mer){
    h = h % 12;
    if(mer === 'pm') h += 12;
  }
  return (h * 60) + m;
}

function _mbxFmt12(min){
  min = ((min% (24*60)) + (24*60)) % (24*60);
  let h = Math.floor(min/60);
  const m = min%60;
  const ampm = h>=12 ? 'PM' : 'AM';
  h = h%12; if(h===0) h=12;
  return `${h}:${String(m).padStart(2,'0')} ${ampm}`;
}

function _mbxBucketLabel(b){
  return `${_mbxFmt12(b.startMin)} - ${_mbxFmt12(b.endMin)}`;
}

function _mbxInBucket(nowMin, b){
  const start = b.startMin, end = b.endMin;
  if(end > start) return nowMin >= start && nowMin < end;
  return (nowMin >= start) || (nowMin < end);
}

function _mbxBuildDefaultBuckets(team){
  const start = _mbxParseHM(team?.dutyStart || '00:00');
  const end = _mbxParseHM(team?.dutyEnd || '00:00');
  const wraps = end <= start;
  const total = wraps ? (24*60 - start + end) : (end - start);
  const seg = Math.max(1, Math.floor(total / 3));
  const buckets = [];
  for(let i=0;i<3;i++){
    const s = (start + i*seg) % (24*60);
    const e = (i===2) ? end : ((start + (i+1)*seg) % (24*60));
    buckets.push({ id:`b${i}`, startMin:s, endMin:e });
  }
  return buckets;
}

function _mbxComputeShiftKey(team, nowParts){
  const UI = window.UI;
  const p = nowParts || (UI && UI.mailboxNowParts ? UI.mailboxNowParts() : (UI ? UI.manilaNow() : null));
  const nowMin = _mbxMinutesOfDayFromParts(p||{hh:0,mm:0});
  const start = _mbxParseHM(team?.dutyStart || '00:00');
  const end = _mbxParseHM(team?.dutyEnd || '00:00');
  const wraps = end <= start;

  let shiftDateISO = p && p.isoDate ? p.isoDate : (UI && UI.manilaNow ? UI.manilaNow().isoDate : '');
  if(wraps && nowMin < end){
    try{ shiftDateISO = UI.addDaysISO(shiftDateISO, -1); }catch(_){}
  }
  return `${team.id}|${shiftDateISO}T${team.dutyStart||'00:00'}`;
}

function _mbxRoleLabel(role){
  return String(role||'').replaceAll('_',' ').trim();
}

// FIXED BUG #3: Added legacy fallback for duty label visibility (Lines 219-230)
function _mbxDutyLabelForUser(user, nowParts){
  try{
    const Store = window.Store;
    const Config = window.Config;
    const UI = window.UI;
    if(!Store || !Config || !UI || !user) return '—';
    const p = nowParts || (UI.mailboxNowParts ? UI.mailboxNowParts() : UI.manilaNow());
    const nowMin = (UI && UI.minutesOfDay) ? UI.minutesOfDay(p) : ((Number(p.hh)||0)*60 + (Number(p.mm)||0));
    const dow = _mbxIsoDow(p.isoDate);
    const prevDow = (dow + 6) % 7;
    const todayBlocks = Store.getUserDayBlocks ? (Store.getUserDayBlocks(user.id, dow) || []) : [];
    const prevBlocks = Store.getUserDayBlocks ? (Store.getUserDayBlocks(user.id, prevDow) || []) : [];

    // NIGHT SHIFT FIX: Detect if we are in the post-midnight window of an overnight shift.
    // e.g. Night Shift 22:00-06:00. At 02:00 AM Thursday, prevDow=Wednesday.
    // Blocks "02:00-06:00" assigned on the Wed tab do NOT wrap midnight (e>s),
    // so the old overnight-spill check (e<=s && nowMin<e) MISSES them.
    // We also need to check: prevBlocks where s <= nowMin < e AND s < nightDutyEnd.
    let nightShiftDutyEndMin = -1;
    try{
      const teams = (Config && Array.isArray(Config.TEAMS)) ? Config.TEAMS : [];
      for(const t of teams){
        const ts = (UI.parseHM ? UI.parseHM(t.dutyStart||'00:00') : 0);
        const te = (UI.parseHM ? UI.parseHM(t.dutyEnd  ||'00:00') : 0);
        if(te <= ts && nowMin < te){ nightShiftDutyEndMin = te; break; }
      }
    }catch(_){}

    const rolePriority = (role)=>{
      const key = String(role||'').toLowerCase();
      if(key === 'mailbox_manager') return 100;
      if(key === 'mailbox_call' || key === 'call_available' || key === 'call_onqueue') return 80;
      if(key.includes('break') || key.includes('lunch')) return 20;
      return 50;
    };

    const getRoleLabel = (role)=>{
      const sc = Config.scheduleById ? Config.scheduleById(role) : null;
      return (sc && sc.label) ? sc.label : String(role||'—');
    };

    const activeRoles = [];

    // CROSS-SHIFT CONTAMINATION FIX:
    // When nightShiftDutyEndMin >= 0, we are in the post-midnight window of an overnight shift
    // (e.g. 00:00-06:00 on Wednesday while Tuesday night shift is still active).
    // todayBlocks = Wednesday blocks → these belong to the NEXT night shift (10PM Wed → 6AM Thu).
    // Processing them with _mbxBlockHit would falsely match blocks like "04:00-05:00" stored
    // on Wed for the upcoming shift, causing duplicate Mailbox Manager labels.
    // When in post-midnight: skip todayBlocks entirely — prevBlocks (Tue) is the correct source.
    if(nightShiftDutyEndMin < 0){
      for(const b of todayBlocks){
        const s = (UI && UI.parseHM) ? UI.parseHM(b.start) : _mbxParseHM(b.start);
        const e = (UI && UI.parseHM) ? UI.parseHM(b.end) : _mbxParseHM(b.end);
        if(!Number.isFinite(s) || !Number.isFinite(e)) continue;
        if(_mbxBlockHit(nowMin, s, e)) activeRoles.push(String(b.role||''));
      }
    }

    // Overnight spill from the previous day (e.g. 22:00-02:00) AND
    // NIGHT SHIFT FIX: straight post-midnight blocks on the previous day
    // that do NOT wrap (e.g. 02:00-06:00 assigned on the night-shift start day).
    for(const b of prevBlocks){
      const s = (UI && UI.parseHM) ? UI.parseHM(b.start) : _mbxParseHM(b.start);
      const e = (UI && UI.parseHM) ? UI.parseHM(b.end) : _mbxParseHM(b.end);
      if(!Number.isFinite(s) || !Number.isFinite(e)) continue;
      // Classic overnight spill: block wraps midnight (e<=s) and nowMin is before end
      if(e <= s && nowMin < e){ activeRoles.push(String(b.role||'')); continue; }
      // Night shift post-midnight continuation: block is straight (e>s) but lives in
      // the post-midnight window of an overnight shift on the previous day's tab.
      // Only applies when we detected an active overnight shift above.
      if(nightShiftDutyEndMin >= 0 && s <= nowMin && nowMin < e && e <= nightShiftDutyEndMin){
        activeRoles.push(String(b.role||''));
      }
    }

    if(activeRoles.length){
      const selectedRole = activeRoles
        .slice()
        .sort((a,b)=>rolePriority(b)-rolePriority(a))[0];
      return getRoleLabel(selectedRole);
    }

    // FIXED: Fallback to legacy user.schedule / user.task fields for MEMBER-role visibility
    try {
      const legacySched = String(user.schedule || '').toLowerCase().trim();
      const legacyTask  = String(user.task || user.taskRole || '').toLowerCase().trim();
      if (legacySched || legacyTask) {
        const roleId = legacySched || legacyTask;
        const sc     = Config && Config.scheduleById ? Config.scheduleById(roleId) : null;
        return sc && sc.label ? sc.label : roleId.replace(/_/g, ' ');
      }
    } catch (_) {}

    return '—';
  }catch(_){
    return '—';
  }
}

function _mbxMemberSortKey(u){
  const Config = window.Config;
  const TL = (Config && Config.ROLES) ? Config.ROLES.TEAM_LEAD : 'TEAM_LEAD';
  const w = (String(u?.role||'') === TL) ? 0 : 1;
  return { w, name: String(u?.name||u?.username||'').toLowerCase() };
}

function _mbxDutyTone(label){
  const t = String(label||'').toLowerCase().trim();
  if(!t || t === '—' || t === 'n/a' || t === 'no active duty' || t.includes('no active')) return 'idle';
  if(t.includes('mailbox manager')) return 'manager';
  if(t.includes('mailbox call') || t.includes('call available') || t.includes('call on queue') || t.includes('call_available') || t.includes('on queue')) return 'call';
  if(t.includes('back office') || t.includes('back_office') || t.includes('backoffice')) return 'backoffice';
  if(t.includes('break') || t.includes('lunch')) return 'break';
  if(t.includes('training') || t.includes('meeting') || t.includes('coaching')) return 'training';
  return 'active';
}

// ── Liquid status bar: returns timing data for the active schedule block ──────
// Returns { blockDurMin, elapsedMin, remainingMin, pct, blockStartMin, blockEndMin }
// pct = fraction REMAINING (1.0 = just started, 0.0 = about to end)
function _mbxGetBlockTiming(userId, nowParts){
  try{
    const Store = window.Store;
    const UI = window.UI;
    if(!Store || !UI || !userId) return null;
    const p = nowParts || (UI.mailboxNowParts ? UI.mailboxNowParts() : (UI.manilaNow ? UI.manilaNow() : null));
    if(!p) return null;
    const nowMin = (UI.minutesOfDay ? UI.minutesOfDay(p) : ((Number(p.hh)||0)*60 + (Number(p.mm)||0)));
    const dow    = _mbxIsoDow(p.isoDate);
    const prevDow = (dow + 6) % 7;

    const todayBlocks = (Store.getUserDayBlocks ? Store.getUserDayBlocks(userId, dow)    : []) || [];
    const prevBlocks  = (Store.getUserDayBlocks ? Store.getUserDayBlocks(userId, prevDow) : []) || [];

    // NIGHT SHIFT FIX: detect if we are in the post-midnight window of an overnight shift.
    // Straight blocks (e.g. 02:00-06:00) stored on the night-shift start day (prevDow)
    // do NOT wrap midnight, so the classic overnight check (e<=s) misses them entirely.
    let nightShiftDutyEndMin = -1;
    try{
      const Config = window.Config;
      const teams = (Config && Array.isArray(Config.TEAMS)) ? Config.TEAMS : [];
      for(const t of teams){
        const ts = (UI.parseHM ? UI.parseHM(t.dutyStart||'00:00') : 0);
        const te = (UI.parseHM ? UI.parseHM(t.dutyEnd  ||'00:00') : 0);
        if(te <= ts && nowMin < te){ nightShiftDutyEndMin = te; break; }
      }
    }catch(_){}

    const rolePriority = (role)=>{
      const k = String(role||'').toLowerCase();
      if(k === 'mailbox_manager') return 100;
      if(k === 'mailbox_call' || k === 'call_available' || k === 'call_onqueue') return 80;
      if(k.includes('break') || k.includes('lunch')) return 20;
      return 50;
    };

    let best = null;
    let bestPriority = -1;

    // mode: 'today' | 'overnight' | 'nightcont'
    const checkBlock = (b, mode) => {
      const s = _mbxParseHM(b.start);
      const e = _mbxParseHM(b.end);
      if(!Number.isFinite(s) || !Number.isFinite(e)) return;
      let hit = false;
      if(mode === 'overnight'){
        // classic: previous-day block wraps midnight, we're before its end
        hit = (e <= s) && nowMin < e;
      } else if(mode === 'nightcont'){
        // NIGHT SHIFT FIX: straight post-midnight block on the shift-start day
        // e.g. 02:00-06:00 assigned on Wed tab, active on Thu 02:00-06:00
        hit = (e > s) && (s <= nowMin) && (nowMin < e) && (e <= nightShiftDutyEndMin);
      } else {
        hit = _mbxBlockHit(nowMin, s, e);
      }
      if(!hit) return;
      const pri = rolePriority(b.role);
      if(pri <= bestPriority) return;
      bestPriority = pri;

      // Block duration
      let dur;
      if(mode === 'overnight'){
        dur = ((24*60) - s) + e;
      } else {
        dur = (e > s) ? (e - s) : ((24*60) - s + e);
      }
      dur = Math.max(1, dur);

      // Elapsed since block started
      let elapsed;
      if(mode === 'overnight'){
        elapsed = nowMin + ((24*60) - s);
      } else {
        if(e > s){
          elapsed = nowMin - s;
        } else {
          elapsed = (nowMin >= s) ? (nowMin - s) : (nowMin + (24*60) - s);
        }
      }
      elapsed = Math.max(0, Math.min(dur, elapsed));

      best = {
        blockDurMin: dur,
        elapsedMin: elapsed,
        remainingMin: Math.max(0, dur - elapsed),
        pct: Math.max(0, Math.min(1, (dur - elapsed) / dur)),
        blockStartMin: s,
        blockEndMin: e
      };
    };

    // CROSS-SHIFT CONTAMINATION FIX:
    // When in post-midnight of overnight shift (nightShiftDutyEndMin >= 0),
    // todayBlocks = new calendar day's blocks (next night shift, not yet started).
    // Processing them would cause false hits for upcoming shift blocks like "04:00-05:00".
    // Skip todayBlocks; prevBlocks (shift-start day) is the correct source.
    if(nightShiftDutyEndMin < 0){
      for(const b of todayBlocks) checkBlock(b, 'today');
    }
    for(const b of prevBlocks){
      checkBlock(b, 'overnight');
      if(nightShiftDutyEndMin >= 0) checkBlock(b, 'nightcont');
    }

    return best; // null = no active block
  }catch(_){ return null; }
}

function _mbxActorIdFromUser(user){
  if(!user || typeof user !== 'object') return '';
  const raw = String(user.id || user.userId || user.user_id || user.uid || user.sub || '').trim();
  if(!raw) return '';

  // HARDENING: Some sessions can carry a contaminated id token fragment
  // (e.g. uid accidentally appended with query pieces like ",liveTeamId-...").
  // This produced malformed /api/member/:uid/schedule URLs, spamming 404/failed
  // fetches and overloading client/Supabase sync loops. Keep only a valid UUID id.
  const clean = raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  if(clean && clean[0]) return clean[0].toLowerCase();

  // Fallback for non-UUID legacy ids: drop URL/query separators to avoid path pollution.
  return raw.split(/[?,&#\s]+/)[0].trim();
}

function _mbxReadJwt(){
  try{
    const token = (window.CloudAuth && CloudAuth.accessToken) ? String(CloudAuth.accessToken() || '').trim() : '';
    if(token) return token;
  }catch(_){ }

  // Best-effort fallback for delayed CloudAuth hydration.
  try{
    const session = window.CloudAuth && CloudAuth.readSession ? CloudAuth.readSession() : null;
    const token = session && session.access_token ? String(session.access_token || '').trim() : '';
    if(token) return token;
  }catch(_){ }

  return '';
}

(window.Pages=window.Pages||{}, window.Pages.mailbox = function(root){
  const me = (window.Auth && window.Auth.getUser) ? (window.Auth.getUser()||{}) : {};
  let isManager = false;

  window.__mbxUiState = window.__mbxUiState || {
    showArchive: true,         // BUG FIX 5: show Case Matrix by default
    showAnalytics: false,
    condFormatEnabled: true,   // gear: conditional formatting on/off
    isFullscreen: false        // fullscreen toggle
  };

  function getDuty(){
    const UI = window.UI;
    let nowParts = null;
    if(UI && UI.mailboxTimeInfo){
      const info = UI.mailboxTimeInfo();
      if(info && info.overrideEnabled && info.effectiveParts){
        nowParts = info.effectiveParts;
      }
    }
    if(!nowParts){
      nowParts = UI && UI.mailboxNowParts ? UI.mailboxNowParts() : null;
    }
    return UI ? UI.getDutyWindow(nowParts) : { current:{}, next:{}, secLeft:0 };
  }

  // =========================================================================
  // BOSS THUNTER: ABSOLUTE BLOCK SCANNER (ULTIMATE GHOST FIX)
  // =========================================================================
  function _mbxFindScheduledManagerForBucket(table, bucket){
    try{
      if(!table || !bucket) return '—';

      // ── Priority 1: Pre-computed cache (populated by sync, no timing issues) ──
      const cached = table.meta && table.meta.bucketManagers && table.meta.bucketManagers[bucket.id];
      if (cached && typeof cached === 'string' && cached !== '—') return cached;

      const teamId = String(table?.meta?.teamId||'');
      if(!teamId) return '—';

      const UI     = window.UI;
      const Store  = window.Store;
      const Config = window.Config;

      const shiftStartMin = _mbxParseHM(table?.meta?.dutyStart || '00:00');
      const shiftEndMin   = _mbxParseHM(table?.meta?.dutyEnd   || '00:00');
      const shiftKey      = String(table?.meta?.shiftKey||'');
      const shiftDatePart = (shiftKey.split('|')[1] || '').split('T')[0];
      let shiftDow = 0;
      try {
        shiftDow = new Date(`${shiftDatePart}T00:00:00+08:00`).getDay();
      } catch (_){
        shiftDow = UI && UI.manilaNowDate ? new Date(UI.manilaNowDate()).getDay() : new Date().getDay();
      }

      // NIGHT SHIFT FIX: Detect overnight (wrapping) shifts — e.g. 22:00-06:00.
      // For these shifts, a Team Lead assigns blocks for the FULL shift under a
      // single day tab in the Members page (e.g. [Wed] covers both 22:00-midnight
      // AND 00:00-06:00 of the following calendar day). The post-midnight portion
      // (00:00–dutyEnd) is stored on dayIndex=shiftDow with raw times like "02:00".
      // Without the extra dayRef below, those blocks land at offset=0 → minutes
      // 0–360, which is BEFORE the shift window 1320–1800 and are never matched.
      // Adding {dow:shiftDow, offset:1440} re-positions them correctly inside the
      // shift window so the manager/duty labels resolve correctly.
      const isOvernightShift = shiftEndMin <= shiftStartMin;

      let bStart = Number(bucket.startMin)||0;
      let bEnd   = Number(bucket.endMin)||0;
      if(bEnd <= bStart) bEnd += 1440;
      if(bStart < shiftStartMin){ bStart += 1440; bEnd += 1440; }

      // ── CANDIDATES: merge roster cache + Store.getUsers() ──────────────
      // _rosterByTeam[teamId] is populated by the server sync for ALL roles.
      // Store.getUsers() is populated for privileged roles via CloudUsers.
      // Combining both ensures we never miss a candidate.
      const cacheMembers = (_rosterByTeam && _rosterByTeam[teamId]) || [];
      const storeMembers = ((Store && Store.getUsers ? Store.getUsers() : []) || [])
        .filter(u => u && String(u.teamId||'') === teamId);

      // Dedupe by id — prefer cache entry (has reliable data)
      const byId = new Map();
      for (const u of cacheMembers) if (u && u.id) byId.set(String(u.id), u);
      for (const u of storeMembers) if (u && u.id && !byId.has(String(u.id))) byId.set(String(u.id), u);
      const candidates = [...byId.values()];

      const matched = [];

      for(const u of candidates){
        let isMgr = false;
        const uid = String(u.id || '');
        if(!uid) continue;

        // NIGHT SHIFT FIX: For overnight shifts, include a 3rd dayRef that reads
        // same-day (shiftDow) blocks with a +1440 offset. This catches post-midnight
        // blocks (e.g. 02:00-06:00) stored on the shift-start day in the Members page.
        // dayRef[0]: same-day offset=0    → catches 22:00–23:59 pre-midnight portion
        // dayRef[1]: same-day offset=1440 → catches 00:00–dutyEnd post-midnight portion
        //
        // CROSS-SHIFT CONTAMINATION FIX: For overnight shifts we intentionally do NOT
        // read next-calendar-day blocks. Each night shift stores its FULL block set
        // (both pre and post-midnight) on the shift-start day tab in the Members page.
        // Reading the next day's blocks (which belong to the FOLLOWING night shift)
        // caused duplicate Mailbox Manager labels when both shifts had manager blocks
        // in the 04:00-06:00 range (e.g. Tue night + Wed blocks both matched).
        const dayRefs = isOvernightShift
          ? [
              { dow: shiftDow, offset:    0 },  // pre-midnight  (22:00–23:59) on shift-start day
              { dow: shiftDow, offset: 1440 }   // post-midnight (00:00–06:00) on shift-start day
            ]
          : [
              { dow: shiftDow,           offset:    0 },
              { dow: (shiftDow + 1) % 7, offset: 1440 }
            ];

        for(const ref of dayRefs){
          const blocks = Store && Store.getUserDayBlocks
            ? (Store.getUserDayBlocks(uid, ref.dow) || []) : [];

          for(const b of blocks){
            let s = (UI && UI.parseHM) ? UI.parseHM(b.start) : _mbxParseHM(b.start);
            let e = (UI && UI.parseHM) ? UI.parseHM(b.end)   : _mbxParseHM(b.end);
            if(!Number.isFinite(s) || !Number.isFinite(e)) continue;
            if(e <= s) e += 1440;
            s += ref.offset;
            e += ref.offset;
            // BUCKET MANAGER DEDUP FIX: Use block START TIME to assign each manager to
            // exactly ONE bucket — the bucket where their Mailbox Manager window begins.
            // The old overlap check (s < bEnd && bStart < e) caused managers to appear
            // in MULTIPLE buckets when their block spanned a bucket boundary.
            // e.g. Jayson has MM block 01:00–04:00 → overlaps bucket2(12:40–3:20) AND
            // bucket3(3:20–6:00), making him appear in BOTH. With start-time check,
            // he only appears in bucket2 where his block starts (s=1500 ∈ [1480,1640)).
            if(!(s >= bStart && s < bEnd)) continue;

            const roleId = String(b.role || b.schedule || '').toLowerCase().trim();
            const sc     = Config && Config.scheduleById
              ? Config.scheduleById(b.role || b.schedule) : null;
            const lbl    = String(sc && sc.label ? sc.label : roleId).toLowerCase();

            if(roleId === 'mailbox_manager' || lbl.includes('mailbox manager') ||
               roleId === 'mailbox manager' || lbl.includes('mailbox_manager')){
              isMgr = true; break;
            }
          }
          if(isMgr) break;
        }

        // Fallback: user.schedule / user.task on the profile object (legacy)
        if(!isMgr){
          const legacyFields = [
            String(u.schedule || '').toLowerCase(),
            String(u.task     || '').toLowerCase(),
          ];
          if(legacyFields.some(f => f === 'mailbox_manager' || f.includes('mailbox manager'))){
            const nowMin = (() => {
              try{
                const p = UI && UI.mailboxNowParts ? UI.mailboxNowParts()
                  : (UI ? UI.manilaNow() : null);
                return p ? (Number(p.hh||0)*60 + Number(p.mm||0)) : -1;
              }catch(_){ return -1; }
            })();
            if(nowMin >= 0 && _mbxBlockHit(nowMin, bucket.startMin, bucket.endMin)){
              isMgr = true;
            }
          }
        }

        if(isMgr) matched.push(String(u.name || u.username || '—'));
      }

      // ONE MANAGER PER BUCKET rule: only show the single scheduled Mailbox Manager.
      // If multiple people have overlapping MM blocks in the same bucket,
      // take the first unique name only (earliest in the sorted roster).
      const unique = [...new Set(matched.filter(Boolean))];
      return unique.length > 0 ? unique[0] : '—';
    }catch(e){ return '—'; }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // _mbxPrecomputeBucketManagers
  // Pre-computes manager names from raw API schedule data into table.meta.bucketManagers.
  // Called synchronously after each API fetch. Eliminates Store.getUserDayBlocks timing
  // issues — the render simply reads table.meta.bucketManagers[bucket.id] directly.
  // Works for ALL user roles because it operates purely on API data + nameMap.
  // ════════════════════════════════════════════════════════════════════════════
  function _mbxPrecomputeBucketManagers(table, teamScheduleBlocks, nameMap) {
    try {
      if (!table || !Array.isArray(table.buckets) || !Array.isArray(teamScheduleBlocks)) return;
      if (!table.meta) table.meta = {};
      if (!table.meta.bucketManagers) table.meta.bucketManagers = {};

      const shiftKey = String(table.meta.shiftKey || '');
      const shiftDatePart = (shiftKey.split('|')[1] || '').split('T')[0];
      // Compute DOW using Manila timezone (UTC+8) to match how dayIndex is assigned.
      // We use UTC methods on a Manila-midnight timestamp to avoid local-TZ skew.
      let shiftDow = 0;
      try {
        const [y, mo, d] = shiftDatePart.split('-').map(Number);
        // Manila midnight in UTC = (d at 00:00+08:00) = previous day at 16:00 UTC
        const manilaMidnightUTC = Date.UTC(y, mo - 1, d, 0, 0, 0) - 8 * 3600 * 1000;
        shiftDow = new Date(manilaMidnightUTC + 8 * 3600 * 1000).getUTCDay();
      } catch (_) {
        shiftDow = new Date().getDay();
      }

      const shiftStartMin = _mbxParseHM(table.meta.dutyStart || '00:00');
      const shiftEndMin   = _mbxParseHM(table.meta.dutyEnd   || '00:00');
      // NIGHT SHIFT FIX: detect overnight shift (e.g. 22:00–06:00)
      const isOvernightShift = shiftEndMin <= shiftStartMin;

      for (const bkt of table.buckets) {
        let bS = Number(bkt.startMin) || 0;
        let bE = Number(bkt.endMin) || 0;
        if (bE <= bS) bE += 1440;
        if (bS < shiftStartMin) { bS += 1440; bE += 1440; }

        const mgrNames = [];
        // ONE MANAGER PER BUCKET: track earliest block-start per candidate so we
        // can pick the single manager whose window begins first in this bucket.
        let bestMgrName = null;
        let bestMgrStart = Infinity;
        // FIX-COLTIME: Also track the raw HH:MM strings of the winning block
        let bestMgrBlockStart = '';
        let bestMgrBlockEnd   = '';

        for (const row of teamScheduleBlocks) {
          const rDow = Number(row.dayIndex);
          // CROSS-SHIFT CONTAMINATION FIX: For overnight shifts, ONLY read same-day blocks.
          // Each night shift stores its full block set (pre AND post-midnight) on the
          // shift-start day tab. Next-day blocks belong to the FOLLOWING night shift.
          // Allowing isNextDay for overnight shifts caused next-shift's manager blocks
          // (e.g. Wed 04:00-05:00 Mailbox Manager) to bleed into the current Tue night shift.
          const isSameDow = (rDow === shiftDow);
          const isNextDay = (rDow === (shiftDow + 1) % 7);
          if(isOvernightShift){
            if(!isSameDow) continue;  // skip next-day rows — they belong to the next shift
          } else {
            if(!isSameDow && !isNextDay) continue;
          }

          // For overnight shifts: try both offsets on the same-day blocks.
          //   offset=0    → pre-midnight portion (22:00-23:59, maps to 1320-1439)
          //   offset=1440 → post-midnight portion (00:00-06:00, maps to 1440-1800)
          // For day shifts: offset=1440 only when row is from next calendar day.
          const offsetCandidates = isOvernightShift
            ? [0, 1440]
            : [isNextDay ? 1440 : 0];

          let matched = false;
          for (const offset of offsetCandidates) {
            let s = _mbxParseHM(String(row.start || ''));
            let e = _mbxParseHM(String(row.end || ''));
            if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
            if (e <= s) e += 1440;
            s += offset; e += offset;
            // BUCKET MANAGER DEDUP FIX: Match by block START TIME within the bucket window,
            // not by any overlap. This ensures each Mailbox Manager appears in exactly
            // ONE bucket (where their block starts), eliminating cross-bucket duplicates.
            if (!(s >= bS && s < bE)) continue;
            matched = true;
            break;
          }
          if (!matched) continue;

          const roleStr = String(row.schedule || row.role || '').toLowerCase().trim();
          const sc = window.Config && Config.scheduleById ? Config.scheduleById(row.schedule || row.role) : null;
          const lbl = String(sc && sc.label ? sc.label : roleStr).toLowerCase();
          const isMgr = roleStr === 'mailbox_manager' || lbl.includes('mailbox manager')
            || roleStr === 'mailbox manager' || lbl.includes('mailbox_manager');
          if (!isMgr) continue;

          const userId = String(row.userId || row.user_id || '');
          const uRec = nameMap.get(userId);
          const name = uRec ? String(uRec.name || uRec.username || '').trim() : '';
          if (!name || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(name)) continue;

          // ONE MANAGER PER BUCKET: track the candidate whose MM block starts
          // earliest within this bucket window — they are the designated manager.
          // Compute the adjusted start time (same logic as offsetCandidates above).
          let candidateStart = Infinity;
          for (const offset of offsetCandidates) {
            let cs = _mbxParseHM(String(row.start || ''));
            if (!Number.isFinite(cs)) continue;
            cs += offset;
            if (cs >= bS && cs < bE && cs < candidateStart) candidateStart = cs;
          }
          if (candidateStart < bestMgrStart) {
            bestMgrStart      = candidateStart;
            bestMgrName       = name;
            // FIX-COLTIME: Save the raw HH:MM times of this winning block
            bestMgrBlockStart = String(row.start || '');
            bestMgrBlockEnd   = String(row.end   || '');
          }
        }

        // Write exactly ONE manager name per bucket (or '—' if none found).
        // FIX-COLTIME: Also store the manager's actual block start/end times so
        // the column header can show their real scheduled window instead of the
        // fixed bucket split (e.g. "10:00 PM – 1:00 AM" not "10:00 PM – 12:40 AM").
        if (bestMgrName) {
          table.meta.bucketManagers[bkt.id] = bestMgrName;
          // Store raw block times for the winning manager (used by renderTable header)
          if (!table.meta.bucketManagerTimes) table.meta.bucketManagerTimes = {};
          table.meta.bucketManagerTimes[bkt.id] = {
            blockStart: bestMgrBlockStart,
            blockEnd:   bestMgrBlockEnd,
          };
        } else if (!table.meta.bucketManagers[bkt.id]) {
          table.meta.bucketManagers[bkt.id] = '—';
          if (!table.meta.bucketManagerTimes) table.meta.bucketManagerTimes = {};
          table.meta.bucketManagerTimes[bkt.id] = null;
        }
      }
    } catch (_) {}
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ROSTER + SCHEDULE SYNC  (works for ALL roles incl. MEMBER)
  // ════════════════════════════════════════════════════════════════════════════
  // Strategy: store fetched team members in an in-memory map (_rosterByTeam).
  // This completely bypasses Store.saveUsers / sanitizeUsers which can corrupt
  // or drop members that arrive without a username/email.  The cache is used
  // directly by renderTable and _mbxFindScheduledManagerForBucket.
  //
  // /api/users/list is role-restricted (MEMBER only sees themselves).
  // /api/member/:uid/schedule?includeTeam=1 returns teamMembers for ANY user
  // viewing their own profile — that is the source we use here.
  // ════════════════════════════════════════════════════════════════════════════

  const _rosterByTeam  = {};   // { teamId: [{id,name,role,teamId,...}] }
  const _scheduleReady = {};   // { teamId: true } once first fetch completes
  const _scheduleRefreshing = {}; // { teamId: true } while refresh fetch is in-flight
  const _syncInFlight  = {};   // guard against concurrent fetches per team
  let   _syncCooldown  = {};   // LOOP-GUARD: cooldown timestamps after failed fetches
  // _schedSyncPending: prevents re-triggering sync on every render while a sync
  // is in-flight or already completed.  This MUST be declared here — accessing an
  // undeclared variable throws a ReferenceError in strict mode (and in some browsers
  // even in sloppy mode), which caused render() to crash for MEMBER-role users and
  // prevented _bootRosterSync from ever running.
  let _schedSyncPending = false;
  let _periodicSyncTimer = null; // periodic schedule re-sync timer

  // ── MAILBOX DISABLE / ENABLE STATE ──────────────────────────────────────
  // null  = not yet fetched (will show loading, then load async)
  // true  = enabled  (normal operation)
  // false = disabled (show notice, stop all timers & network requests)
  let _mailboxEnabled = null;
  // _mbxStatusPromise: deduplicates concurrent _mbxLoadStatus() calls (see BUG FIX v4.1)

  let _mbxStatusPromise = null; // deduplicate concurrent status fetches

  async function _mbxLoadStatus() {
    // BUG FIX v4.1: Replace hard boolean lock (which silently dropped rapid toggle
    // re-fetches) with a shared Promise. Concurrent callers all await the same
    // in-flight fetch, so no status update is ever lost.
    if (_mbxStatusPromise) return _mbxStatusPromise;
    _mbxStatusPromise = (async () => {
      try {
        const jwt = _mbxReadJwt();
        const headers = jwt ? { Authorization: `Bearer ${jwt}` } : {};
        const res = await fetch('/api/settings/mailbox_status', { headers, cache: 'no-store' });
        if (!res.ok) { _mailboxEnabled = true; return; } // fail open
        const data = await res.json().catch(() => ({}));
        _mailboxEnabled = !(data && data.settings && data.settings.disabled === true);
      } catch (_) {
        _mailboxEnabled = true; // fail open — network error = treat as enabled
      } finally {
        _mbxStatusPromise = null; // clear so next call fetches fresh
      }
    })();
    return _mbxStatusPromise;
  }

  function _renderMailboxDisabled() {
    if (!root) return;
    const me = (window.Auth && window.Auth.getUser) ? (window.Auth.getUser() || {}) : {};
    const isSA = me.role === 'SUPER_ADMIN';
    root.innerHTML = `
      <div style="
        display:flex; flex-direction:column; align-items:center; justify-content:center;
        min-height:340px; gap:20px; padding:40px 24px; text-align:center;
      ">
        <div style="
          width:72px; height:72px; border-radius:18px;
          background:linear-gradient(145deg,rgba(239,68,68,.15),rgba(239,68,68,.05));
          border:1px solid rgba(239,68,68,.28);
          display:flex; align-items:center; justify-content:center;
          box-shadow:0 0 32px rgba(239,68,68,.12);
        ">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="1.6" stroke-linecap="round">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
            <line x1="2" y1="2" x2="22" y2="22" stroke="#ef4444" stroke-width="1.8"/>
          </svg>
        </div>
        <div>
          <div style="font-size:22px;font-weight:900;color:#f1f5f9;letter-spacing:-.02em;margin-bottom:8px;">
            Mailbox has been temporarily disabled
          </div>
          <div style="font-size:14px;color:#64748b;max-width:420px;line-height:1.6;">
            The Mailbox feature is currently unavailable. Please check back later or contact your administrator.
          </div>
        </div>
        ${isSA ? `
          <div style="
            margin-top:8px; padding:14px 20px;
            background:rgba(245,158,11,.07); border:1px solid rgba(245,158,11,.22);
            border-radius:10px; font-size:12px; color:#fcd34d; max-width:420px; line-height:1.55;
          ">
            <strong>Super Admin:</strong> Re-enable the Mailbox from
            <strong>Settings → Mailbox Control</strong>.
          </div>
        ` : ''}
      </div>
    `;
  }
  // ── END MAILBOX DISABLE / ENABLE STATE ───────────────────────────────────


  // REALTIME ROSTER RESYNC: Forces a fresh schedule block fetch for the active duty team.
  // Called when Supabase pushes schedule/config updates so ALL roles (including MEMBERs)
  // see the same data without a page refresh.
  function _mbxForceResync(reason){
    try{
      const duty = getDuty();
      let tid = String(duty && duty.current && duty.current.id ? duty.current.id : '');
      // Fallback: read the active shiftKey from mailbox state and extract team id
      if(!tid){
        try{
          const st = window.Store && Store.getMailboxState ? Store.getMailboxState() : {};
          const sk = String(st.currentKey || '');
          if(sk) tid = sk.split('|')[0]; // shiftKey = "teamId|date"
        }catch(_){}
      }
      if(!tid) return;
      // Keep last known-good scheduleReady so UI won't blink to empty roster
      // during periodic/realtime refreshes; clear only on hard reset paths.
      delete _syncInFlight[tid];
      if (_syncCooldown) delete _syncCooldown[tid]; // LOOP-GUARD: clear cooldown on manual resync
      _schedSyncPending = false;
      _mbxSyncTeamScheduleBlocks(tid).catch(()=>{});
    }catch(_){}
  }

  async function _mbxSyncTeamScheduleBlocks(teamId) {
    if (!teamId) return;
    if (_mailboxEnabled === false) return; // MAILBOX DISABLED — no Supabase calls
    if (_syncInFlight[teamId]) return;
    _syncInFlight[teamId] = true;
    _scheduleRefreshing[teamId] = true;

    try {
      const me  = (window.Auth && window.Auth.getUser) ? (window.Auth.getUser() || {}) : {};
      const uid = _mbxActorIdFromUser(me);
      if (!uid) return;

      const jwt = _mbxReadJwt();
      if (!jwt) return;

      // Always send hintTeamId so server resolves team even when DB team_id is NULL.
      const meTeamId = String(me.teamId || me.team_id || '').trim();
      const hintParam = meTeamId ? `&hintTeamId=${encodeURIComponent(meTeamId)}` : '';

      // ROSTER FIX: Always send resolveTeamId = the active duty team we want members for.
      // Without this, SUPER_ADMIN (teamId='developer') fetches Developer Access members only
      // instead of the actual shift team (Morning/Mid/Night). The resolveTeamId param tells
      // the server to return members and schedule blocks for the specified team regardless
      // of the requesting user's own team assignment.
      const resolveParam = teamId ? `&resolveTeamId=${encodeURIComponent(teamId)}` : '';

      const res = await fetch(
        `/api/member/${encodeURIComponent(uid)}/schedule?includeTeam=1${hintParam}${resolveParam}`,
        { headers: { Authorization: `Bearer ${jwt}` }, cache: 'no-store' }
      );
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));

      // ── 1. Roster: merge API members with Store members ──────────────────────
      const rawMembers = Array.isArray(data && data.teamMembers) ? data.teamMembers : [];
      const apiTeamId = String(data && data.teamId ? data.teamId : teamId).trim();

      const fromApi = rawMembers
        .filter(m => m && m.id)
        .map(m => ({
          id:       String(m.id),
          name:     String(m.name     || m.username || m.id),
          username: String(m.username || m.name     || m.id),
          role:     String(m.role     || 'MEMBER'),
          teamId:   String(m.teamId   || m.team_id  || apiTeamId),
          status:   'active'
        }));
      const fromStore = (window.Store && Store.getUsers ? Store.getUsers() : [])
        .filter(u => u && u.id && (String(u.teamId || '').trim().toLowerCase() === String(apiTeamId).toLowerCase()))
        .map(u => ({ id: String(u.id), name: String(u.name || u.username || u.id),
                     username: String(u.username || u.name || u.id),
                     role: String(u.role || 'MEMBER'), teamId: apiTeamId, status: 'active' }));

      const merged = new Map();
      for (const u of fromStore) merged.set(u.id, u);
      for (const u of fromApi) { if (!merged.has(u.id)) merged.set(u.id, u); }

      if (apiTeamId) {
        _rosterByTeam[apiTeamId] = [...merged.values()];
        _scheduleReady[apiTeamId] = true;
      }

      // ── 2. Pre-compute Mgr names from API data (no Store.getUserDayBlocks timing issues) ──
      const tsb = Array.isArray(data && data.teamScheduleBlocks) ? data.teamScheduleBlocks : [];

      // Build nameMap for the precompute
      const nameMapMain = new Map();
      for (const u of merged.values()) { if (u && u.id) nameMapMain.set(String(u.id), u); }

      // Helper: apply precomputed Mgr names to the current mailbox table
      const applyToTable = (targetTid, roster, schedBlocks) => {
        try {
          if (!window.Store || !Store.getMailboxState || !Store.getMailboxTable || !Store.saveMailboxTable) return;
          const curKey = Store.getMailboxState().currentKey;
          if (!curKey) return;
          const t = Store.getMailboxTable(curKey);
          // Case-insensitive compare — ensures 'Morning' === 'morning' never silently skips
          if (!t || String(t.meta && t.meta.teamId || '').toLowerCase() !== String(targetTid).toLowerCase()) return;

          // FIX-MB-2: Build nameMap using ONLY this team's roster.
          // Old code merged ALL _rosterByTeam entries into the nameMap, which
          // caused managers from OTHER teams (e.g. Night Shift) to be resolved as
          // Block Managers for the current shift's table.
          // Fix: restrict nameMap to the target team's roster only.
          const nm = new Map();
          for (const u of (roster || [])) { if (u && u.id) nm.set(String(u.id), u); }
          // Also include any additional users for the specific targetTid from _rosterByTeam
          // (in case the roster param doesn't cover all members yet) — but ONLY for targetTid.
          const targetRoster = _rosterByTeam[targetTid] || _rosterByTeam[String(targetTid).toLowerCase()] || [];
          for (const u of targetRoster) { if (u && u.id && !nm.has(String(u.id))) nm.set(String(u.id), u); }

          _mbxPrecomputeBucketManagers(t, schedBlocks, nm);

          // Also patch table.members with full roster — same shift-window filter as renderTable
          // FIX-MB-2: Apply the same isScheduledForShift logic here so members added during
          // sync also respect the shift window. Use a simplified overlap check against
          // the table's own dutyStart/dutyEnd to stay consistent.
          const nowP = window.UI && UI.mailboxNowParts ? UI.mailboxNowParts() : null;
          const existIds = new Set((t.members || []).map(m => m && String(m.id)));
          const tDutyStart = _mbxParseHM(t.meta && t.meta.dutyStart || '00:00');
          const tDutyEnd   = _mbxParseHM(t.meta && t.meta.dutyEnd   || '00:00');
          const tOvernight = tDutyEnd <= tDutyStart;
          // Compute shiftDow for this table
          const tShiftKey   = String(t.meta && t.meta.shiftKey || '');
          const tShiftDate  = (tShiftKey.split('|')[1] || '').split('T')[0];
          let   tShiftDow   = -1;
          try {
            const [ty, tmo, td] = tShiftDate.split('-').map(Number);
            const utc = Date.UTC(ty, tmo - 1, td, 0, 0, 0) - 8 * 3600 * 1000;
            tShiftDow = new Date(utc + 8 * 3600 * 1000).getUTCDay();
          } catch (_) { tShiftDow = new Date().getDay(); }

          // Helper: check if a user has any block in this table's shift window
          const hasBlockInShift = (uid) => {
            if (!window.Store || !Store.getUserDayBlocks) return true;
            const daysToCheck = tOvernight ? [tShiftDow] : [tShiftDow, (tShiftDow + 1) % 7];
            let winS = tDutyStart;
            let winE = tOvernight ? tDutyStart + ((1440 - tDutyStart) + tDutyEnd) : tDutyEnd;
            if (winE <= winS) winE += 1440;
            for (const di of daysToCheck) {
              const blocks = Store.getUserDayBlocks(uid, di) || [];
              for (const b of blocks) {
                let bs = _mbxParseHM(b.start);
                let be = _mbxParseHM(b.end);
                if (!Number.isFinite(bs) || !Number.isFinite(be)) continue;
                if (be <= bs) be += 1440;
                const offsets = tOvernight ? [0, 1440] : [0];
                for (const off of offsets) {
                  const s = bs + off, e = be + off;
                  if (!tOvernight && di === (tShiftDow + 1) % 7) {
                    if (s < (winE + 1440) && e > (winS + 1440)) return true;
                  } else {
                    if (s < winE && e > winS) return true;
                  }
                }
              }
            }
            return false;
          };

          for (const tm of (roster || [])) {
            if (!tm || !tm.id || existIds.has(String(tm.id))) continue;
            // FIX-MB-2: Only add member if they have blocks in this shift window
            if (!hasBlockInShift(String(tm.id))) continue;
            t.members = t.members || [];
            t.members.push({
              id: String(tm.id), name: String(tm.name || tm.id),
              username: String(tm.username || tm.name || tm.id),
              role: String(tm.role || 'MEMBER'), roleLabel: _mbxRoleLabel(tm.role || ''),
              dutyLabel: _mbxDutyLabelForUser({ id: String(tm.id), teamId: targetTid }, nowP)
            });
            existIds.add(String(tm.id));
          }

          Store.saveMailboxTable(curKey, t, { silent: true });
        } catch (_) {}
      };

      // ROSTER FIX: Always apply roster to the table, even when tsb is empty.
      // Previously guarded by tsb.length — if the shift had no schedule blocks today
      // (e.g. Sunday or fresh setup), the table.members was never patched with full roster.
      if (apiTeamId) {
        applyToTable(apiTeamId, [...merged.values()], tsb);
      }

      // ── 3. Cross-shift: if duty-window team ≠ user's own team, fetch duty team data ──
      // E.g. Morning MEMBER viewing Night Shift mailbox needs Night Shift manager names
      if (apiTeamId && teamId && apiTeamId !== teamId) {
        (async () => {
          try {
            const res2 = await fetch(
              `/api/member/${encodeURIComponent(uid)}/schedule?includeTeam=1&resolveTeamId=${encodeURIComponent(teamId)}`,
              { headers: { Authorization: `Bearer ${jwt}` }, cache: 'no-store' }
            );
            if (!res2.ok) return;
            const data2 = await res2.json().catch(() => ({}));
            const rows2 = Array.isArray(data2 && data2.teamMembers) ? data2.teamMembers : [];
            const tsb2  = Array.isArray(data2 && data2.teamScheduleBlocks) ? data2.teamScheduleBlocks : [];
            if (!rows2.length) return;

            _rosterByTeam[teamId] = rows2
              .filter(m => m && m.id)
              .map(m => ({
                id: String(m.id), name: String(m.name || m.username || m.id),
                username: String(m.username || m.name || m.id),
                role: String(m.role || 'MEMBER'), teamId, status: 'active'
              }));
            _scheduleReady[teamId] = true;

            if (tsb2.length) applyToTable(teamId, _rosterByTeam[teamId], tsb2);

            scheduleRender('cross-team-names-resolved');
          } catch (_) {}
        })();
      }

      _scheduleReady[teamId] = true;

      // ── 4. Hydrate Store.setUserDayBlocks (legacy compatibility) ─────────────
      if (tsb.length && window.Store && Store.setUserDayBlocks) {
        const bucket = new Map();
        for (const row of tsb) {
          const r = row && typeof row === 'object' ? row : {};
          const mid = String(r.userId || r.user_id || '').trim();
          const di  = Number(r.dayIndex);
          if (!mid || !Number.isInteger(di) || di < 0 || di > 6) continue;
          const k = `${mid}|${di}`;
          if (!bucket.has(k)) bucket.set(k, []);
          const sr = String(r.schedule || r.role || '').trim();
          bucket.get(k).push({ start: String(r.start || '00:00'), end: String(r.end || '00:00'), role: sr, schedule: sr, notes: String(r.notes || '') });
        }
        bucket.forEach((blocks, k) => {
          const [mid, day] = k.split('|');
          Store.setUserDayBlocks(mid, apiTeamId || teamId, Number(day), blocks);
        });
      }

      scheduleRender('roster-sync-complete');

      // REALTIME ALL-USER FIX: After re-syncing roster+blocks, push the current mailbox
      // table to cloud (mums_mailbox_tables). This triggers Supabase realtime delivery
      // to ALL connected clients so every user's page updates without a manual refresh.
      // LOOP-GUARD: Only push when we have real roster data (resolvedTeamMembers.length > 0).
      // Pushing an empty-roster table triggers remote clients' _mbxForceResync which
      // causes an infinite fetch storm when the network is saturated.
      try{
        if(window.Store && Store.getMailboxState && Store.getMailboxTable && Store.saveMailboxTable){
          const curKey = Store.getMailboxState().currentKey;
          if(curKey && Array.isArray(fromApi) && fromApi.length > 0){ // LOOP-GUARD: only push when we have real data
            const t = Store.getMailboxTable(curKey);
            if(t) Store.saveMailboxTable(curKey, t); // triggers write → Realtime push
          }
        }
      }catch(_){}

    } catch (_) {
      // Silently degrade
    } finally {
      _syncInFlight[teamId] = false;
      _scheduleRefreshing[teamId] = false;
      _schedSyncPending = false;
      // LOOP-GUARD: If _scheduleReady was never set (fetch failed), mark it with
      // a cooldown timestamp so render() doesn't immediately retry and cause
      // an infinite ERR_INSUFFICIENT_RESOURCES storm.
      // Format: _scheduleReady[teamId] stays falsy only during the cooldown window.
      if (!_scheduleReady[teamId]) {
        _scheduleReady[teamId] = false; // still falsy so next manual force-resync works
        // Prevent render() from re-triggering for 15 seconds after a failure
        _syncCooldown = _syncCooldown || {};
        _syncCooldown[teamId] = Date.now() + 15000;
      }
    }
  }

  // Convenience: reset sync state for a given team (used on shift-change)
  function _mbxResetSync(teamId) {
    if (teamId) {
      delete _rosterByTeam[teamId];
      delete _scheduleReady[teamId];
      delete _scheduleRefreshing[teamId];
      _syncInFlight[teamId] = false;
      _schedSyncPending = false; // also reset the pending flag on team reset
    }
  }

  function isPrivilegedRole(u){
    try{
      const r = String(u?.role||'');
      const R = (window.Config && window.Config.ROLES) ? window.Config.ROLES : {};
      return r === (R.SUPER_ADMIN||'SUPER_ADMIN') ||
             r === (R.SUPER_USER||'SUPER_USER') ||
             r === (R.ADMIN||'ADMIN') ||
             r === (R.TEAM_LEAD||'TEAM_LEAD');
    }catch(_){ return false; }
  }

  function canAssignNow(opts){
    try{
      if(isPrivilegedRole(me)) return true;
      const duty = opts?.duty || getDuty();
      const UI = window.UI;
      const nowParts = opts?.nowParts || (UI && UI.mailboxNowParts ? UI.mailboxNowParts() : (UI && UI.manilaNow ? UI.manilaNow() : null));
      const teamId = duty?.current?.id || me.teamId;
      if(eligibleForMailboxManager(me, { teamId, dutyTeam: duty?.current, nowParts })) return true;
      return eligibleForMailboxManager(me, { teamId, nowParts });
    }catch(_){
      return false;
    }
  }

  function ensureShiftTables(){
    const d = getDuty();
    const team = d.current || {};
    const UI = window.UI;
    const Store = window.Store;
    const shiftKey = _mbxComputeShiftKey(team, UI && UI.mailboxNowParts ? UI.mailboxNowParts() : null);
    const state = Store && Store.getMailboxState ? Store.getMailboxState() : { currentKey:'', previousKey:'' };

    if(state.currentKey !== shiftKey){
      const prev = state.currentKey;
      if(Store && Store.saveMailboxState) Store.saveMailboxState({ previousKey: prev, currentKey: shiftKey, lastChangeAt: Date.now() });

      try{
        const Auth = window.Auth;
        const actor = (Auth && Auth.getUser) ? Auth.getUser() : null;
        if(Store && Store.addLog) Store.addLog({
          ts: Date.now(),
          teamId: team.id,
          actorId: actor?.id || '',
          actorName: actor ? (actor.name||actor.username) : '',
          action:'MAILBOX_SHIFT_CHANGE',
          targetId: shiftKey,
          targetName: team.label || team.id,
          msg:`Mailbox shift changed to ${team.label||team.id}`,
          detail:`Previous: ${prev||'—'}`
        });
      }catch(_){}
    }

    let table = Store && Store.getMailboxTable ? Store.getMailboxTable(shiftKey) : null;
    // SCHEMA VERSION GUARD: if cached table is from an older schema version, discard it.
    // This auto-clears stale localStorage entries after any deploy that changes
    // bucketManagers computation logic — no manual cache flush needed by users.
    const CURRENT_SCHEMA_VER = 3;
    if(table && (!table.meta || (table.meta.schemaVer||0) < CURRENT_SCHEMA_VER)){
      table = null; // force rebuild with new logic
    }
    if(!table){
      const Config = window.Config;
      const teamObj = (Config && Config.teamById) ? Config.teamById(team.id) : team;
      const cfg = (Store && Store.getTeamConfig ? Store.getTeamConfig(team.id) : {}) || {};
      const rawBuckets = Array.isArray(cfg.mailboxBuckets) ? cfg.mailboxBuckets : null;
      let buckets;
      if(rawBuckets && rawBuckets.length){
        buckets = rawBuckets.map((x,i)=>({
          id: x.id || `b${i}`,
          startMin: _mbxParseHM(x.start),
          endMin: _mbxParseHM(x.end),
        }));
      }else{
        buckets = _mbxBuildDefaultBuckets(teamObj || team);
      }
      const nowParts = (UI && UI.mailboxNowParts ? UI.mailboxNowParts() : (UI && UI.manilaNow ? UI.manilaNow() : null));

      // REALTIME ALL-USER FIX: Build the member list from BOTH Store.getUsers() (admin path)
      // AND _rosterByTeam cache (populated by _mbxSyncTeamScheduleBlocks API fetch).
      // Store.getUsers() is empty for MEMBER-role users (restricted payload) → without the
      // roster cache fallback, MEMBERs would see an empty table on first render.
      const _tid = String(team.id || '').trim().toLowerCase();
      const fromStore = (Store && Store.getUsers ? Store.getUsers() : [])
        .filter(u=>u && String(u.teamId||'').trim().toLowerCase()===_tid && (!u.status || u.status==='active'))
        .map(u=>({ id:u.id, name:u.name||u.username||'—', username:u.username||'',
                   role:u.role||'', roleLabel:_mbxRoleLabel(u.role||''),
                   dutyLabel:_mbxDutyLabelForUser(u, nowParts) }));

      const fromRoster = (_rosterByTeam[team.id] || _rosterByTeam[_tid] || [])
        .map(u=>({ id:String(u.id), name:u.name||'—', username:u.username||'',
                   role:u.role||'', roleLabel:_mbxRoleLabel(u.role||''),
                   dutyLabel:_mbxDutyLabelForUser({id:String(u.id),teamId:team.id}, nowParts) }));

      // Merge, dedup by id (Store entry preferred when present — has richer data)
      const memberMap = new Map();
      for(const u of fromRoster) if(u.id) memberMap.set(u.id, u);
      for(const u of fromStore)  if(u.id) memberMap.set(u.id, u);

      const members = [...memberMap.values()]
        .filter(u => {
          // FIX-MB-1: Apply shift-window filter at table-creation time.
          // Only include members who have at least one schedule block in this
          // shift's duty window. If schedule data isn't ready yet, include all
          // (safe fallback — renderTable re-filters once data arrives).
          const _schedReady = !!(team.id && _scheduleReady && _scheduleReady[team.id]);
          if (!_schedReady) return true; // schedule data not loaded — keep all for now
          const Store2 = window.Store;
          if (!Store2 || !Store2.getUserDayBlocks) return true;

          const newDutyStart   = _mbxParseHM(team.dutyStart || '00:00');
          const newDutyEnd     = _mbxParseHM(team.dutyEnd   || '00:00');
          const newIsOvernight = newDutyEnd <= newDutyStart;
          let   newShiftDow    = -1;
          try {
            const [nsy, nsmo, nsd] = (shiftKey.split('|')[1] || '').split('T')[0].split('-').map(Number);
            const utc = Date.UTC(nsy, nsmo - 1, nsd, 0, 0, 0) - 8 * 3600 * 1000;
            newShiftDow = new Date(utc + 8 * 3600 * 1000).getUTCDay();
          } catch (_) { newShiftDow = new Date().getDay(); }

          const newWinS = newDutyStart;
          const newWinE = newIsOvernight
            ? newDutyStart + ((1440 - newDutyStart) + newDutyEnd)
            : newDutyEnd;
          const daysToCheck = newIsOvernight ? [newShiftDow] : [newShiftDow, (newShiftDow + 1) % 7];

          for (const di of daysToCheck) {
            const blocks = Store2.getUserDayBlocks(u.id, di) || [];
            for (const b of blocks) {
              let bs = _mbxParseHM(b.start);
              let be = _mbxParseHM(b.end);
              if (!Number.isFinite(bs) || !Number.isFinite(be)) continue;
              if (be <= bs) be += 1440;
              const offsets = newIsOvernight ? [0, 1440] : [0];
              for (const off of offsets) {
                const s = bs + off, e = be + off;
                if (s < newWinE && e > newWinS) return true;
              }
            }
          }
          return false;
        })
        .sort((a,b)=>{
          const ak=_mbxMemberSortKey(a), bk=_mbxMemberSortKey(b);
          if(ak.w!==bk.w) return ak.w-bk.w;
          return ak.name.localeCompare(bk.name);
        });

      table = {
        meta: {
          schemaVer: 3,   // SCHEMA VERSION: bump this whenever bucketManagers logic changes.
          shiftKey,
          teamId: team.id,
          teamLabel: team.label || team.id,
          dutyStart: team.dutyStart || '',
          dutyEnd: team.dutyEnd || '',
          bucketManagers: {},
          createdAt: Date.now()
        },
        buckets,
        members,
        counts: {}, 
        assignments: [] 
      };
      if(Store && Store.saveMailboxTable) Store.saveMailboxTable(shiftKey, table);
    }else{
      if(!table.meta) table.meta = {};
      // STALE CACHE FIX: Always reset bucketManagers on every table reuse.
      // Preserving old values caused stale "Name1 & Name2" strings to persist
      // across renders even after the logic was fixed, because the precompute
      // function only writes NEW values but never clears old ones.
      table.meta.bucketManagers = {};
      // FIX-COLTIME: Also clear the block-time cache whenever managers are reset
      table.meta.bucketManagerTimes = {};
      table.meta.schemaVer = 3; // stamp schema version on existing tables too
      
      // BOSS THUNTER: Force sync buckets from Team Config on reload
      const Config = window.Config;
      const teamObj = (Config && Config.teamById) ? Config.teamById(team.id) : team;
      const cfg = (Store && Store.getTeamConfig ? Store.getTeamConfig(team.id) : {}) || {};
      const rawBuckets = Array.isArray(cfg.mailboxBuckets) ? cfg.mailboxBuckets : null;
      if(rawBuckets && rawBuckets.length){
        table.buckets = rawBuckets.map((x,i)=>({
          id: x.id || `b${i}`,
          startMin: _mbxParseHM(x.start),
          endMin: _mbxParseHM(x.end),
        }));
      }else{
        table.buckets = _mbxBuildDefaultBuckets(teamObj || team);
      }

      const nowParts = (UI && UI.mailboxNowParts ? UI.mailboxNowParts() : (UI && UI.manilaNow ? UI.manilaNow() : null));
      const _eTid = String(team.id || '').trim().toLowerCase();
      const teamUsers = (Store && Store.getUsers ? Store.getUsers() : [])
        .filter(u=>u && String(u.teamId||'').trim().toLowerCase()===_eTid && (!u.status || u.status==='active'))
        .map(u=>({
          id: u.id,
          name: u.name||u.username||'—',
          username: u.username||'',
          role: u.role||'',
          roleLabel: _mbxRoleLabel(u.role||''),
          dutyLabel: _mbxDutyLabelForUser(u, nowParts)
        }))
        .sort((a,b)=>{
          const ak=_mbxMemberSortKey(a), bk=_mbxMemberSortKey(b);
          if(ak.w!==bk.w) return ak.w-bk.w;
          return ak.name.localeCompare(bk.name);
        });

      // Build merged member list: keep *all* persisted table members and merge
      // any currently visible team users from Store.getUsers().
      //
      // Why: MEMBER-role sessions can have a restricted Store.getUsers() payload
      // (often just the current user). If we prune to teamUsers-only here, we
      // hide valid shift members from the counter table and break cross-device
      // visibility for non-privileged users.
      const merged = [
        ...teamUsers,
        ...((table.members || []).filter(m => m && m.id))
      ];
      // Final dedup pass
      const seenMerge = new Set();
      table.members = merged.filter(m => {
        if (!m || !m.id || seenMerge.has(m.id)) return false;
        seenMerge.add(m.id);
        return true;
      });
      // Re-sort
      table.members.sort((a, b) => {
        const ak = _mbxMemberSortKey(a), bk = _mbxMemberSortKey(b);
        if (ak.w !== bk.w) return ak.w - bk.w;
        return ak.name.localeCompare(bk.name);
      });
      // Supplement table.members from in-memory roster cache (filled by server sync)
      // This ensures MEMBERs who can't call /api/users/list still see the full roster.
      const _tid = String(team.id || '');
      if (_tid && _rosterByTeam && _rosterByTeam[_tid]) {
        const nowP = (UI && UI.mailboxNowParts ? UI.mailboxNowParts() : null);
        const existAfterMerge = new Set(table.members.map(m => m && String(m.id)));
        let addedFromCache = false;
        for (const tm of _rosterByTeam[_tid]) {
          if (!tm || !tm.id || existAfterMerge.has(String(tm.id))) continue;
          table.members.push({
            id:        String(tm.id),
            name:      String(tm.name || tm.id),
            username:  String(tm.username || tm.name || tm.id),
            role:      String(tm.role || 'MEMBER'),
            roleLabel: _mbxRoleLabel(tm.role || ''),
            dutyLabel: _mbxDutyLabelForUser({ id: String(tm.id), teamId: _tid }, nowP)
          });
          existAfterMerge.add(String(tm.id));
          addedFromCache = true;
        }
        if (addedFromCache) {
          table.members.sort((a, b) => {
            const ak = _mbxMemberSortKey(a), bk = _mbxMemberSortKey(b);
            if (ak.w !== bk.w) return ak.w - bk.w;
            return ak.name.localeCompare(bk.name);
          });
        }
      }

      if(Store && Store.saveMailboxTable) Store.saveMailboxTable(shiftKey, table, { silent:true });
    }

    return { shiftKey, table, state: Store && Store.getMailboxState ? Store.getMailboxState() : state };
  }

  function computeActiveBucketId(table){
    const UI = window.UI;
    const p = UI && UI.mailboxNowParts ? UI.mailboxNowParts() : (UI && UI.manilaNow ? UI.manilaNow() : null);
    const nowMin = _mbxMinutesOfDayFromParts(p);
    const b = (table.buckets||[]).find(x=>_mbxInBucket(nowMin, x));
    return b ? b.id : ((table.buckets||[])[0]?.id || '');
  }

  // BUG 2 FIX: safeGetCount now reads from assignment-based cache (consistent with matrix)
  // Falls back to table.counts ONLY if assignment cache not built yet.
  function safeGetCount(table, userId, bucketId){
    if(table._assignCounts){
      const m = table._assignCounts[userId];
      return m ? (Number(m[bucketId]) || 0) : 0;
    }
    const c = (table.counts && table.counts[userId]) ? table.counts[userId] : null;
    return c ? (Number(c[bucketId])||0) : 0;
  }

  // Build _assignCounts cache on a table: per-member per-bucket counts from assignments.
  // Uses bucket.startMin / bucket.endMin (minutes since midnight Manila time).
  function _buildAssignCounts(table){
    const buckets  = table.buckets  || [];
    const members  = table.members  || [];
    const assigns  = table.assignments || [];
    if(!buckets.length || !assigns.length) return;

    // Init counters
    const counts = {};
    for(const m of members){
      counts[m.id] = {};
      for(const b of buckets) counts[m.id][b.id] = 0;
    }

    // Manila offset = UTC+8
    const MANILA_OFF = 8 * 60 * 60 * 1000;
    const DAY_MS     = 24 * 60 * 60 * 1000;

    // Deduplicate by assigneeId|caseNo (same logic as matrix)
    const seenKeys = new Set();

    for(const a of assigns){
      if(!a || !a.assigneeId || !a.caseNo || !counts[a.assigneeId]) continue;
      const key = String(a.assigneeId).trim() + '|' + String(a.caseNo).trim().toLowerCase();
      if(seenKeys.has(key)) continue;
      seenKeys.add(key);

      const ts = Number(a.assignedAt || a.createdAt || a.ts || 0);
      if(!ts) continue;
      const manilaMin = Math.floor(((ts + MANILA_OFF) % DAY_MS) / 60000);

      // Find which bucket this assignment belongs to
      let matched = false;
      for(const b of buckets){
        const s = b.startMin, e = b.endMin;
        const inRange = (e > s)
          ? (manilaMin >= s && manilaMin < e)           // normal range
          : (manilaMin >= s || manilaMin < e);           // crosses midnight
        if(inRange){
          counts[a.assigneeId][b.id]++;
          matched = true;
          break;
        }
      }
      // If no bucket matched (e.g. assignment from a different shift time),
      // count it in the last bucket as a fallback to avoid losing it
      if(!matched && buckets.length > 0){
        const lastBucket = buckets[buckets.length - 1];
        counts[a.assigneeId][lastBucket.id]++;
      }
    }

    // Always assign fresh (computeTotals calls this every render)
    table._assignCounts = counts;
  }

  function computeTotals(table){
    // BUG 2 FIX: Build assignment-based counts FIRST so safeGetCount reads from it
    _buildAssignCounts(table);

    const buckets = table.buckets || [];
    const members = table.members || [];
    const colTotals = {};
    for(const b of buckets) colTotals[b.id] = 0;
    const rowTotals = {};
    let shiftTotal = 0;

    for(const m of members){
      let rt = 0;
      for(const b of buckets){
        const v = safeGetCount(table, m.id, b.id);
        colTotals[b.id] += v;
        rt += v;
      }
      rowTotals[m.id] = rt;
      shiftTotal += rt;
    }

    // BUG FIX 2: Also compute assignment-based counts (source of truth for matrix)
    // These are used for the KPI stat and row Overall column to match the matrix.
    const assignRowTotals = {};
    const seenCases = new Map(); // key: assigneeId|caseNo → true
    for(const m of members) assignRowTotals[m.id] = 0;
    for(const a of (table.assignments || [])){
      if(!a || !a.assigneeId || !a.caseNo) continue;
      const key = String(a.assigneeId).trim() + '|' + String(a.caseNo).trim().toLowerCase();
      if(seenCases.has(key)) continue; // deduplicate same case assigned multiple times
      seenCases.set(key, true);
      if(assignRowTotals.hasOwnProperty(a.assigneeId)){
        assignRowTotals[a.assigneeId]++;
      }
    }
    const assignShiftTotal = Object.values(assignRowTotals).reduce((s,v)=>s+v, 0);

    return { colTotals, rowTotals, shiftTotal, assignRowTotals, assignShiftTotal };
  }

  function isMailboxRouteActive(){
    try{
      if(typeof window._currentPageId === 'string') return window._currentPageId === 'mailbox';
    }catch(_){ }
    try{
      const p = String(location.pathname||'').replace(/^\/+/, '').split('/')[0];
      const h = String(location.hash||'').replace(/^#\/?/, '').split('/')[0];
      return p === 'mailbox' || h === 'mailbox';
    }catch(_){
      return false;
    }
  }

  // FIXED BUG #2: Added responsive CSS for mgr labels (Lines 505-642)
  function ensureEnterpriseMailboxStyles() {
    if (document.getElementById('enterprise-mailbox-styles')) return;
    const style = document.createElement('style');
    style.id = 'enterprise-mailbox-styles';
    style.textContent = `
      .mbx-shell { display:flex; flex-direction:column; gap:20px; padding-bottom: 30px; }
      
      .mbx-header-bar { display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:16px; flex-wrap:wrap; gap:14px; }
      .mbx-main-title { font-size: 26px; font-weight: 900; color: #f8fafc; margin: 0; letter-spacing: -0.5px; }
      
      .btn-glass { padding: 8px 16px; border-radius: 8px; font-weight: 700; font-size: 13px; cursor: pointer; transition: all 0.2s; outline: none; display:inline-flex; align-items:center; justify-content:center; gap:6px; border:none; }
      .btn-glass-ghost { background: rgba(255,255,255,0.05); color: #cbd5e1; border: 1px solid rgba(255,255,255,0.1); }
      .btn-glass-ghost:hover { background: rgba(255,255,255,0.1); color: #f8fafc; border-color: rgba(255,255,255,0.2); }
      .btn-glass-primary { background: linear-gradient(145deg, #0ea5e9, #0284c7); color: #fff; border: 1px solid rgba(56,189,248,0.4); box-shadow: 0 4px 12px rgba(14,165,233,0.3); }
      .btn-glass-primary:hover:not(:disabled) { background: linear-gradient(145deg, #38bdf8, #0ea5e9); transform: translateY(-1px); box-shadow: 0 6px 16px rgba(14,165,233,0.4); }
      
      .mbx-summary-grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap:16px; }
      .mbx-stat-box { background:linear-gradient(145deg, rgba(30,41,59,0.4), rgba(15,23,42,0.6)); border:1px solid rgba(255,255,255,0.06); border-radius:12px; padding:20px; box-shadow: 0 8px 24px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.02); display:flex; flex-direction:column; justify-content:center; align-items:center; text-align:center; transition:transform 0.2s; }
      .mbx-stat-box:hover { transform: translateY(-2px); border-color: rgba(56,189,248,0.3); }
      .mbx-stat-lbl { font-size:11px; font-weight:800; color:#94a3b8; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:8px; }
      .mbx-stat-val { font-size:24px; font-weight:900; color:#f8fafc; letter-spacing:-0.5px; }
      .mbx-stat-sub { font-size:12px; color:#64748b; margin-top:4px; font-weight:600; }
      .timer-display { font-variant-numeric: tabular-nums; font-family: 'Courier New', Courier, monospace; color:#38bdf8; text-shadow: 0 0 10px rgba(56,189,248,0.3); }
      
      .mbx-analytics-panel { background:rgba(2,6,23,0.4); border:1px solid rgba(255,255,255,0.04); border-radius:14px; padding:24px; margin-top:24px; transition:all 0.3s ease; }
      .mbx-panel-head { display:flex; justify-content:space-between; align-items:flex-end; border-bottom:1px solid rgba(255,255,255,0.05); padding-bottom:12px; margin-bottom:16px; }
      .mbx-panel-title { font-size:18px; font-weight:800; color:#f8fafc; margin:0; }
      .mbx-panel-desc { font-size:12px; color:#94a3b8; margin-top:4px; }
      .mbx-analytics-grid { display:grid; grid-template-columns: repeat(3, 1fr); gap:20px; }
      @media (max-width: 900px) { .mbx-analytics-grid { grid-template-columns: 1fr; } }
      .mbx-ana-card { background:rgba(15,23,42,0.6); border:1px solid rgba(255,255,255,0.03); border-radius:10px; padding:16px; }
      .mbx-ana-row { display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.02); }
      .mbx-ana-row:last-child { border-bottom:none; }
      .mbx-ana-badge { background:rgba(56,189,248,0.1); color:#38bdf8; padding:4px 10px; border-radius:999px; font-size:12px; font-weight:800; }
      .mbx-ana-bar-wrap { height:6px; background:rgba(2,6,23,0.8); border-radius:999px; overflow:hidden; margin-top:6px; }
      .mbx-ana-bar-fill { height:100%; background:linear-gradient(90deg, #0ea5e9, #38bdf8); border-radius:999px; }
      
      /* ── ENHANCED CASE ASSIGNMENT TABLE (Phase 1-620) ─────────────────────── */

      /* Wrapper — gradient top accent + clean dark background */
      .mbx-counter-wrap {
        position: relative;
        border: 1px solid rgba(255,255,255,.08);
        border-radius: 12px;
        overflow-x: auto;
        background: #07111e;
        box-shadow: 0 8px 32px rgba(0,0,0,.35);
      }
      .mbx-counter-wrap::before {
        content: '';
        position: absolute;
        top: 0; left: 0; right: 0;
        height: 2px;
        background: linear-gradient(90deg, #0073ea 0%, #00c2cd 45%, #a25ddc 100%);
        border-radius: 12px 12px 0 0;
        z-index: 11;
        pointer-events: none;
      }

      /* Table base */
      .mbx-counter-table { width:100%; border-collapse:collapse; min-width:800px; }

      /* ── HEADER ── */
      .mbx-counter-table thead tr { background: #0a1520; }
      .mbx-counter-table th {
        background: #0a1520;
        padding: 14px 14px 10px;
        font-size: 10px;
        font-weight: 700;
        color: rgba(148,163,184,.65);
        text-transform: uppercase;
        letter-spacing: .12em;
        border-bottom: 1px solid rgba(255,255,255,.07);
        position: sticky;
        top: 0;
        z-index: 10;
        backdrop-filter: blur(8px);
        white-space: nowrap;
      }
      .mbx-counter-table th.active-head-col {
        background: rgba(0,115,234,.12);
        color: #60a5fa;
        border-bottom: 2px solid #0073ea;
      }

      /* Bucket time label in header */
      .mbx-th-time {
        font-size: 12px;
        font-weight: 900;
        color: rgba(225,235,250,.82);
        letter-spacing: .01em;
        text-transform: none;
        display: block;
        margin-bottom: 4px;
      }
      .mbx-th-time.is-active { color: #60a5fa; }

      /* Manager row in header */
      @keyframes mbxMgrPulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(0,115,234,.55), 0 0 8px rgba(56,189,248,.3); opacity: 1; }
        50%       { box-shadow: 0 0 0 4px rgba(0,115,234,.0), 0 0 14px rgba(56,189,248,.5); opacity: .88; }
      }
      @keyframes mbxMgrDotPulse {
        0%, 100% { transform: scale(1);   box-shadow: 0 0 0 0 rgba(56,189,248,.8); }
        50%       { transform: scale(1.35); box-shadow: 0 0 0 3px rgba(56,189,248,.0); }
      }
      @keyframes mbxMgrShimmer {
        0%   { background-position: -200% center; }
        100% { background-position:  200% center; }
      }
      .mbx-mgr-label {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        font-size: 10px;
        font-weight: 600;
        letter-spacing: .04em;
        text-transform: uppercase;
        color: rgba(148,163,184,.42);
        margin-top: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 100%;
        line-height: 1.3;
      }
      .mbx-mgr-label::before {
        content: '';
        display: inline-block;
        width: 5px; height: 5px;
        border-radius: 50%;
        background: currentColor;
        opacity: .65;
        flex-shrink: 0;
      }
      .mbx-mgr-label.active {
        color: transparent;
        background: linear-gradient(90deg,#60a5fa 0%,#93c5fd 30%,#ffffff 50%,#93c5fd 70%,#60a5fa 100%);
        background-size: 200% auto;
        -webkit-background-clip: text;
        background-clip: text;
        padding: 2px 8px;
        border-radius: 999px;
        border: 1px solid rgba(56,189,248,.28);
        background-color: rgba(0,115,234,.12);
        -webkit-box-decoration-break: clone;
        box-decoration-break: clone;
        box-shadow: 0 0 10px rgba(0,115,234,.25), inset 0 1px 0 rgba(255,255,255,.05);
        animation: mbxMgrShimmer 3s linear infinite, mbxMgrPulse 2.4s ease-in-out infinite;
        font-weight: 800;
        letter-spacing: .06em;
      }
      .mbx-mgr-label.active::before {
        background: #38bdf8;
        animation: mbxMgrDotPulse 1.8s ease-in-out infinite;
        box-shadow: 0 0 5px #38bdf8;
        opacity: 1;
        width: 6px; height: 6px;
      }
            .mbx-mgr-label.syncing  { color: rgba(253,171,61,.8); }
      .mbx-mgr-label.empty    { color: rgba(100,116,139,.4); }
      /* assigned = has a manager but NOT the currently active bucket — static, no animation */
      .mbx-mgr-label.assigned {
        color: rgba(148,163,184,.52);
        font-weight: 700;
      }
      .mbx-mgr-label.assigned::before {
        background: rgba(148,163,184,.4);
        opacity: 1;
      }

      @media (max-width: 768px) {
        .mbx-mgr-label { font-size: 9px; }
        .mbx-counter-table th { min-width: 120px !important; padding: 10px 8px !important; }
      }

      /* ── ROWS ── */
      .mbx-counter-table tbody tr {
        border-bottom: 1px solid rgba(255,255,255,.032);
        transition: background .14s;
      }
      .mbx-counter-table tbody tr:nth-child(even) { background: rgba(255,255,255,.011); }
      .mbx-counter-table tbody tr:hover { background: rgba(0,115,234,.05) !important; }
      .mbx-counter-table tbody tr:last-child { border-bottom: none; }
      .mbx-counter-table tr.mbx-assignable { cursor: pointer; }

      .mbx-counter-table td {
        padding: 11px 14px;
        font-size: 13px;
        color: #e2e8f0;
        vertical-align: middle;
      }

      /* Active column tint */
      .mbx-counter-table td.active-col {
        background: rgba(0,115,234,.06);
        border-left: 1px solid rgba(0,115,234,.12);
        border-right: 1px solid rgba(0,115,234,.12);
      }

      /* ── AGENT CELL ── */
      .mbx-agent-cell { display:flex; align-items:center; gap:10px; }
      .mbx-agent-avatar {
        width: 32px; height: 32px;
        border-radius: 8px;
        background: linear-gradient(135deg, #1e3a5f, rgba(0,115,234,.18));
        border: 1px solid rgba(0,115,234,.28);
        display: flex; align-items: center; justify-content: center;
        font-size: 11px; font-weight: 800;
        color: #60a5fa;
        flex-shrink: 0;
        letter-spacing: .02em;
        font-family: 'Plus Jakarta Sans', sans-serif;
      }
      .mbx-agent-avatar.is-lead {
        background: linear-gradient(135deg, #3b1e6e, rgba(162,93,220,.18));
        border-color: rgba(162,93,220,.32);
        color: #c084fc;
      }
      .mbx-agent-name {
        font-size: 13px; font-weight: 700;
        color: #e8edf5; letter-spacing: .01em;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .mbx-agent-role {
        font-size: 10px; font-weight: 600;
        text-transform: uppercase; letter-spacing: .08em;
        margin-top: 2px;
      }
      .mbx-agent-role.is-lead { color: rgba(192,132,252,.62); }
      .mbx-agent-role.is-member { color: rgba(148,163,184,.48); }

      /* ── COUNT CELLS ── */
      .mbx-count-td { text-align:center; }
      .mbx-count-badge {
        display: inline-flex;
        align-items: center; justify-content: center;
        min-width: 28px; height: 28px;
        border-radius: 6px;
        font-size: 14px; font-weight: 800;
        font-family: 'JetBrains Mono', 'Courier New', monospace;
        letter-spacing: -.02em;
        transition: all .14s;
      }
      .mbx-count-badge.is-zero  { color: rgba(100,116,139,.32); background: transparent; }
      .mbx-count-badge.has-val  { background: rgba(0,115,234,.12); color: #60a5fa; border: 1px solid rgba(0,115,234,.22); }
      .mbx-count-badge.is-active-col { background: rgba(0,115,234,.18); color: #93c5fd; border: 1px solid rgba(0,115,234,.32); }
      .mbx-count-badge.is-overall { background: rgba(0,194,205,.10); color: #22d3ee; border: 1px solid rgba(0,194,205,.22); min-width: 34px; font-size: 15px; }
      .mbx-count-badge.is-overall.is-zero { background: transparent; border: none; color: rgba(100,116,139,.3); }

      /* legacy .mbx-num — kept for compat */
      .mbx-num[data-zero="1"] { opacity: 1; }

      /* ── DUTY PILLS (enhanced) ── */
      /* ══════════════════════════════════════════════════════════════════════
         LIQUID PROGRESS STATUS BADGE — Phase 1-630
         Pill capsule with colored liquid fill that depletes as task time ends.
         Empty (drained) portion shows dark background — creating visible drain.
         ══════════════════════════════════════════════════════════════════════ */

      /* ── Outer capsule ───────────────────────────────────────────────────── */
      .mbx-liquid-badge {
        position: relative;
        display: inline-flex;
        align-items: center;
        height: 28px;
        min-width: 195px;
        max-width: 240px;
        border-radius: 8px;
        overflow: hidden;
        cursor: default;
        background: #060f1c;   /* dark "empty tank" base */
        border: 1px solid rgba(255,255,255,.10);
        box-shadow: inset 0 1px 0 rgba(255,255,255,.04), 0 2px 8px rgba(0,0,0,.3);
        transition: box-shadow 0.25s, border-color 0.25s;
      }
      .mbx-liquid-badge:hover {
        filter: brightness(1.08);
      }

      /* ── Liquid fill (the colored water) ─────────────────────────────────── */
      .mbx-liquid-fill {
        position: absolute;
        left: 0; top: 0; bottom: 0;
        /* width driven by JS – starts at correct pct from first render */
        width: 0%;
        border-radius: 8px;
        pointer-events: none;
        /* Fast initial draw, then slow drain between ticks */
        transition: width 0.6s ease-out;
      }
      /* Shimmer wave travelling across fill surface */
      .mbx-liquid-fill::after {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: 8px;
        background: linear-gradient(
          105deg,
          transparent 20%,
          rgba(255,255,255,.14) 45%,
          rgba(255,255,255,.22) 50%,
          rgba(255,255,255,.14) 55%,
          transparent 80%
        );
        background-size: 250% 100%;
        animation: mbxLiqShimmer 2.2s ease-in-out infinite;
      }
      /* Top-edge highlight on fill */
      .mbx-liquid-fill::before {
        content: '';
        position: absolute;
        top: 3px; left: 8%; right: 8%;
        height: 1px;
        background: rgba(255,255,255,.30);
        border-radius: 999px;
        filter: blur(0.5px);
      }
      @keyframes mbxLiqShimmer {
        0%   { background-position: 250% 0; opacity: .7; }
        50%  { opacity: 1; }
        100% { background-position: -250% 0; opacity: .7; }
      }

      /* ── Content row (on top of fill) ────────────────────────────────────── */
      .mbx-liquid-inner {
        position: relative;
        z-index: 2;
        display: flex;
        align-items: center;
        width: 100%;
        height: 100%;
        padding: 0 10px;
        gap: 7px;
      }

      /* Status dot */
      .mbx-liq-dot {
        width: 6px; height: 6px;
        border-radius: 50%;
        flex-shrink: 0;
        transition: background 0.3s, box-shadow 0.3s;
      }

      /* Status label */
      .mbx-liq-label {
        flex: 1;
        font-size: 10px;
        font-weight: 800;
        letter-spacing: .07em;
        text-transform: uppercase;
        color: #f0f6ff;
        text-shadow: 0 1px 4px rgba(0,0,0,.8);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        min-width: 0;
      }

      /* Time-remaining chip — monospace, semi-transparent dark */
      .mbx-liq-timer {
        font-size: 9.5px;
        font-weight: 700;
        font-family: 'JetBrains Mono', 'Fira Code', 'Courier New', monospace;
        letter-spacing: .02em;
        color: rgba(255,255,255,.88);
        background: rgba(0,0,0,.42);
        border: 1px solid rgba(255,255,255,.10);
        padding: 1px 6px;
        border-radius: 5px;
        flex-shrink: 0;
        white-space: nowrap;
        text-shadow: none;
        transition: color 0.3s;
      }

      /* ── Tone: IDLE / NO ACTIVE DUTY ─────────────────────────────────────── */
      .mbx-liquid-badge[data-tone="idle"] {
        border-color: rgba(100,116,139,.20);
      }
      .mbx-liquid-badge[data-tone="idle"] .mbx-liquid-fill {
        background: linear-gradient(90deg, rgba(30,44,60,.9), rgba(20,32,48,.6));
        width: 100% !important;   /* fully "drained" look = show subdued fill */
        transition: none;
      }
      .mbx-liquid-badge[data-tone="idle"] .mbx-liquid-fill::after,
      .mbx-liquid-badge[data-tone="idle"] .mbx-liquid-fill::before { display: none; }
      .mbx-liquid-badge[data-tone="idle"] .mbx-liq-label { color: rgba(148,163,184,.65); }
      .mbx-liquid-badge[data-tone="idle"] .mbx-liq-dot   { background: rgba(100,116,139,.5); }
      .mbx-liquid-badge[data-tone="idle"] .mbx-liq-timer { display: none; }

      /* ── Tone: CALL AVAILABLE (teal/green) ───────────────────────────────── */
      .mbx-liquid-badge[data-tone="call"],
      .mbx-liquid-badge[data-tone="active"] {
        border-color: rgba(0,202,114,.35);
        box-shadow: inset 0 1px 0 rgba(255,255,255,.04), 0 0 10px rgba(0,202,114,.15);
      }
      .mbx-liquid-badge[data-tone="call"]   .mbx-liquid-fill,
      .mbx-liquid-badge[data-tone="active"] .mbx-liquid-fill {
        background: linear-gradient(90deg, #005c38 0%, #00a85e 60%, #00ca72 100%);
      }
      .mbx-liquid-badge[data-tone="call"]   .mbx-liq-dot,
      .mbx-liquid-badge[data-tone="active"] .mbx-liq-dot {
        background: #00e5a0;
        box-shadow: 0 0 6px #00e5a0;
        animation: mbxLiqDotPulse 1.8s ease-in-out infinite;
      }

      /* ── Tone: MAILBOX MANAGER (electric blue) ───────────────────────────── */
      .mbx-liquid-badge[data-tone="manager"] {
        border-color: rgba(56,189,248,.35);
        box-shadow: inset 0 1px 0 rgba(255,255,255,.04), 0 0 12px rgba(0,115,234,.20);
      }
      .mbx-liquid-badge[data-tone="manager"] .mbx-liquid-fill {
        background: linear-gradient(90deg, #00308a 0%, #0060d0 60%, #0073ea 100%);
      }
      .mbx-liquid-badge[data-tone="manager"] .mbx-liq-dot {
        background: #38bdf8;
        box-shadow: 0 0 6px #38bdf8;
        animation: mbxLiqDotPulse 1.8s ease-in-out infinite;
      }

      /* ── Tone: BACK OFFICE (amber/gold) ──────────────────────────────────── */
      .mbx-liquid-badge[data-tone="backoffice"] {
        border-color: rgba(251,191,36,.30);
        box-shadow: inset 0 1px 0 rgba(255,255,255,.04), 0 0 8px rgba(251,191,36,.14);
      }
      .mbx-liquid-badge[data-tone="backoffice"] .mbx-liquid-fill {
        background: linear-gradient(90deg, #6b3400 0%, #c47000 60%, #f59e0b 100%);
      }
      .mbx-liquid-badge[data-tone="backoffice"] .mbx-liq-dot {
        background: #fbbf24;
        box-shadow: 0 0 5px #fbbf24;
        animation: mbxLiqDotPulse 2.2s ease-in-out infinite;
      }

      /* ── Tone: LUNCH / BREAK (violet) ────────────────────────────────────── */
      .mbx-liquid-badge[data-tone="break"] {
        border-color: rgba(167,139,250,.28);
        box-shadow: inset 0 1px 0 rgba(255,255,255,.04), 0 0 8px rgba(124,58,237,.15);
      }
      .mbx-liquid-badge[data-tone="break"] .mbx-liquid-fill {
        background: linear-gradient(90deg, #2e1065 0%, #5b21b6 60%, #7c3aed 100%);
      }
      .mbx-liquid-badge[data-tone="break"] .mbx-liq-dot {
        background: #a78bfa;
        box-shadow: 0 0 5px #a78bfa;
      }

      /* ── Tone: TRAINING / MEETING (slate blue) ───────────────────────────── */
      .mbx-liquid-badge[data-tone="training"] {
        border-color: rgba(99,102,241,.28);
        box-shadow: inset 0 1px 0 rgba(255,255,255,.04), 0 0 8px rgba(99,102,241,.14);
      }
      .mbx-liquid-badge[data-tone="training"] .mbx-liquid-fill {
        background: linear-gradient(90deg, #1e1b4b 0%, #3730a3 60%, #4f46e5 100%);
      }
      .mbx-liquid-badge[data-tone="training"] .mbx-liq-dot {
        background: #818cf8;
        box-shadow: 0 0 5px #818cf8;
      }

      /* ── URGENT state (<20% remaining) — red override ────────────────────── */
      .mbx-liquid-badge.mbx-liq-urgent {
        border-color: rgba(239,68,68,.55) !important;
        box-shadow: 0 0 14px rgba(239,68,68,.28) !important;
        animation: mbxUrgentBorderPulse 1.3s ease-in-out infinite;
      }
      .mbx-liquid-badge.mbx-liq-urgent .mbx-liquid-fill {
        background: linear-gradient(90deg, #7f1d1d 0%, #b91c1c 60%, #ef4444 100%) !important;
      }
      .mbx-liquid-badge.mbx-liq-urgent .mbx-liq-dot {
        background: #f87171 !important;
        box-shadow: 0 0 8px #ef4444 !important;
      }
      .mbx-liquid-badge.mbx-liq-urgent .mbx-liq-label  { color: #fecaca !important; }
      .mbx-liquid-badge.mbx-liq-urgent .mbx-liq-timer  { color: #fecaca !important; border-color: rgba(239,68,68,.3) !important; }
      /* Urgent wave is faster */
      .mbx-liquid-badge.mbx-liq-urgent .mbx-liquid-fill::after {
        animation-duration: 0.9s;
      }

      /* ── Keyframes ───────────────────────────────────────────────────────── */
      @keyframes mbxLiqDotPulse {
        0%,100% { transform: scale(1);    opacity: 1;  }
        50%      { transform: scale(1.5);  opacity: .75; }
      }
      @keyframes mbxUrgentBorderPulse {
        0%,100% { box-shadow: 0 0 10px rgba(239,68,68,.25); }
        50%      { box-shadow: 0 0 20px rgba(239,68,68,.50); }
      }
      @keyframes mbxDotPulse {
        0%,100% { box-shadow: 0 0 0 2px rgba(0,202,114,.3); }
        50%      { box-shadow: 0 0 0 4px rgba(0,202,114,.10); }
      }

      /* Legacy .duty-pill (hidden — replaced by mbx-liquid-badge) */
      .duty-pill { display: none; }



      /* ── FOOTER / SHIFT AGGREGATES ── */
      .mbx-counter-table tfoot tr {
        background: linear-gradient(180deg, #0f1f30 0%, #0a1520 100%);
        border-top: 2px solid rgba(0,115,234,.2);
      }
      .mbx-counter-table tfoot td { padding: 12px 14px; }
      .mbx-foot-label {
        font-size: 10px; font-weight: 800;
        color: rgba(148,163,184,.52);
        text-transform: uppercase; letter-spacing: .14em;
        display: flex; align-items: center; gap: 8px;
      }
      .mbx-foot-label::before {
        content: '';
        display: inline-block;
        width: 3px; height: 14px;
        border-radius: 2px;
        background: linear-gradient(180deg, #0073ea, #00c2cd);
        flex-shrink: 0;
      }
      .mbx-agg-badge {
        display: inline-flex;
        align-items: center; justify-content: center;
        min-width: 34px; height: 28px;
        border-radius: 6px;
        font-size: 14px; font-weight: 800;
        font-family: 'JetBrains Mono', 'Courier New', monospace;
        color: rgba(100,116,139,.38);
      }
      .mbx-agg-badge.has-total {
        background: rgba(0,194,205,.10);
        color: #22d3ee;
        border: 1px solid rgba(0,194,205,.22);
      }
      .mbx-agg-badge.grand-total {
        background: rgba(0,115,234,.15);
        color: #60a5fa;
        border: 1px solid rgba(0,115,234,.3);
        font-size: 17px; height: 32px; min-width: 40px;
      }
      
      .mbx-monitor-panel { border:1px solid rgba(255,255,255,0.06); border-radius:12px; background:rgba(15,23,42,0.4); overflow-x:auto; }
      .mbx-mon-table { width:100%; border-collapse:collapse; min-width:800px; }
      .mbx-mon-table th { background:rgba(15,23,42,0.9); padding:12px 10px; font-size:12px; font-weight:800; color:#cbd5e1; border-bottom:1px solid rgba(255,255,255,0.08); text-align:center; }
      .mbx-mon-table td { padding:10px; border:1px solid rgba(255,255,255,0.02); text-align:center; vertical-align:middle; transition:background 0.2s;}
      .mbx-mon-cell { cursor:pointer; }
      .mbx-mon-cell:hover { background:rgba(56,189,248,0.1) !important; box-shadow:inset 0 0 0 1px rgba(56,189,248,0.3); }
      .mbx-mon-cell.confirmed { background:rgba(16,185,129,0.05); }
      .mbx-case-badge { display:inline-flex; align-items:center; gap:6px; background:rgba(2,6,23,0.8); padding:4px 10px; border-radius:6px; border:1px solid rgba(255,255,255,0.05); font-size:12px; font-weight:700; color:#f8fafc; }
      .mbx-stat-wait { color:#fcd34d; animation: mbxPulse 1.5s infinite; }
      .mbx-stat-done { color:#10b981; }
      @keyframes mbxPulse { 0% { opacity:1; } 50% { opacity:0.5; } 100% { opacity:1; } }

      /* ── TOOLTIP ON ROW HOVER ─────────────────────────────────────────── */
      .mbx-counter-table tbody tr { position: relative; }
      .mbx-row-tooltip {
        position: fixed;
        z-index: 9000;
        pointer-events: none;
        background: rgba(10,21,32,.96);
        border: 1px solid rgba(0,115,234,.4);
        border-radius: 8px;
        padding: 7px 13px;
        font-size: 12px; font-weight: 700;
        color: #e8edf5;
        white-space: nowrap;
        box-shadow: 0 8px 24px rgba(0,0,0,.45), 0 0 0 1px rgba(0,115,234,.15);
        display: flex; align-items: center; gap: 7px;
        opacity: 0; transition: opacity .12s;
        backdrop-filter: blur(8px);
      }
      .mbx-row-tooltip.visible { opacity: 1; }
      .mbx-row-tooltip::before {
        content: '';
        width: 8px; height: 8px;
        border-radius: 50%;
        background: #0073ea;
        flex-shrink: 0;
        box-shadow: 0 0 0 3px rgba(0,115,234,.2);
      }

      /* ── FULLSCREEN ────────────────────────────────────────────────────── */
      .mbx-shell.is-fullscreen {
        position: fixed !important;
        inset: 0 !important;
        z-index: 8000 !important;
        background: #010409 !important;
        overflow-y: auto !important;
        padding: 24px !important;
        border-radius: 0 !important;
      }
      .mbx-shell.is-fullscreen .mbx-counter-wrap {
        max-height: calc(100vh - 280px);
        overflow-y: auto;
      }
      .mbx-fs-btn {
        background: rgba(255,255,255,.05);
        border: 1px solid rgba(255,255,255,.10);
        border-radius: 8px;
        color: #94a3b8;
        padding: 7px 13px;
        font-size: 12px; font-weight: 600;
        cursor: pointer; display:inline-flex; align-items:center; gap:6px;
        transition: all .18s; font-family: inherit;
      }
      .mbx-fs-btn:hover { background: rgba(255,255,255,.10); color: #f8fafc; }
      .mbx-fs-btn.active {
        background: rgba(0,115,234,.12);
        border-color: rgba(0,115,234,.35);
        color: #60a5fa;
      }

      /* ── GEAR / SETTINGS PANEL ─────────────────────────────────────────── */
      .mbx-gear-btn {
        background: rgba(255,255,255,.05);
        border: 1px solid rgba(255,255,255,.10);
        border-radius: 8px;
        color: #94a3b8;
        padding: 7px 11px;
        font-size: 14px;
        cursor: pointer; display:inline-flex; align-items:center; gap:5px;
        transition: all .18s; font-family: inherit;
        position: relative;
      }
      .mbx-gear-btn:hover { background: rgba(255,255,255,.10); color: #f8fafc; transform: rotate(30deg); }
      .mbx-gear-btn.panel-open { background: rgba(0,115,234,.12); border-color: rgba(0,115,234,.35); color: #60a5fa; }

      .mbx-settings-panel {
        display: none;
        position: absolute;
        top: calc(100% + 10px);
        right: 0;
        z-index: 8500;
        background: rgba(10,21,32,.97);
        border: 1px solid rgba(0,115,234,.3);
        border-radius: 12px;
        padding: 18px;
        width: 320px;
        box-shadow: 0 16px 48px rgba(0,0,0,.55), 0 0 0 1px rgba(0,115,234,.10);
        backdrop-filter: blur(14px);
      }
      .mbx-settings-panel.open { display: block; }
      .mbx-settings-title {
        font-size: 10px; font-weight: 800; letter-spacing: .14em;
        text-transform: uppercase; color: rgba(148,163,184,.55);
        margin-bottom: 14px; display: flex; align-items: center; gap: 7px;
      }
      .mbx-settings-title::before {
        content: '';
        width: 3px; height: 12px; border-radius: 2px;
        background: linear-gradient(180deg, #0073ea, #00c2cd);
        flex-shrink: 0;
      }
      .mbx-settings-row {
        display: flex; align-items: flex-start; justify-content: space-between;
        gap: 12px; padding: 11px 0;
        border-bottom: 1px solid rgba(255,255,255,.04);
      }
      .mbx-settings-row:last-child { border-bottom: none; padding-bottom: 0; }
      .mbx-settings-row-label strong {
        font-size: 12px; font-weight: 700; color: #c8d6e8; display: block;
      }
      .mbx-settings-row-label span {
        font-size: 10px; color: rgba(148,163,184,.5); line-height: 1.45;
      }
      /* Toggle switch */
      .mbx-toggle {
        position: relative; width: 38px; height: 22px; flex-shrink: 0; cursor: pointer;
      }
      .mbx-toggle input { opacity: 0; width: 0; height: 0; position: absolute; }
      .mbx-toggle-track {
        position: absolute; inset: 0;
        background: rgba(100,116,139,.3);
        border-radius: 999px;
        transition: background .2s;
        border: 1px solid rgba(255,255,255,.08);
      }
      .mbx-toggle input:checked + .mbx-toggle-track { background: #0073ea; border-color: rgba(0,115,234,.5); }
      .mbx-toggle-thumb {
        position: absolute; top: 3px; left: 3px;
        width: 14px; height: 14px; border-radius: 50%;
        background: #fff; transition: transform .2s;
        box-shadow: 0 1px 4px rgba(0,0,0,.3);
        pointer-events: none;
      }
      .mbx-toggle input:checked ~ .mbx-toggle-thumb { transform: translateX(16px); }

      /* CF legend swatches */
      .mbx-cf-legend {
        display: grid; grid-template-columns: 1fr 1fr;
        gap: 6px; margin-top: 10px;
      }
      .mbx-cf-swatch {
        display: flex; align-items: center; gap: 6px;
        font-size: 10px; font-weight: 600; color: rgba(148,163,184,.65);
      }
      .mbx-cf-dot {
        width: 20px; height: 20px; border-radius: 5px;
        display: flex; align-items: center; justify-content: center;
        font-size: 10px; font-weight: 800;
        flex-shrink: 0;
      }
      .mbx-cf-dot.gray   { background: rgba(100,116,139,.15); color: rgba(100,116,139,.45); }
      .mbx-cf-dot.orange { background: rgba(251,146,60,.15); color: #fb923c; border: 1px solid rgba(251,146,60,.3); }
      .mbx-cf-dot.blue   { background: rgba(0,115,234,.15);  color: #60a5fa; border: 1px solid rgba(0,115,234,.3); }
      .mbx-cf-dot.red    { background: rgba(239,68,68,.15);  color: #f87171; border: 1px solid rgba(239,68,68,.3); }

      /* ── CONDITIONAL FORMAT BADGE OVERRIDES ───────────────────────────── */
      .mbx-count-badge.cf-orange { background: rgba(251,146,60,.15) !important; color: #fb923c !important; border: 1px solid rgba(251,146,60,.32) !important; }
      .mbx-count-badge.cf-blue   { background: rgba(0,115,234,.15)  !important; color: #60a5fa !important; border: 1px solid rgba(0,115,234,.32) !important; }
      .mbx-count-badge.cf-red    { background: rgba(239,68,68,.15)  !important; color: #f87171 !important; border: 1px solid rgba(239,68,68,.32) !important; }

      /* Modals */
      .mbx-custom-backdrop { position:fixed; inset:0; background:rgba(2,6,23,0.85); backdrop-filter:blur(10px); z-index:99999; display:none; align-items:center; justify-content:center; padding:20px; opacity:0; pointer-events:none; transition:opacity 0.3s; }
      .mbx-custom-backdrop.is-open { display:flex !important; opacity:1; pointer-events:auto; }
      .mbx-modal-glass { width:min(550px, 95vw); background:linear-gradient(145deg, rgba(15,23,42,0.95), rgba(2,6,23,0.98)); border:1px solid rgba(56,189,248,0.3); border-radius:16px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.7); display:flex; flex-direction:column; overflow:hidden; }
      .mbx-modal-head { padding:20px 24px; border-bottom:1px solid rgba(255,255,255,0.06); display:flex; justify-content:space-between; align-items:center; background:rgba(15,23,42,0.6); }
      .mbx-modal-body { padding:24px; display:flex; flex-direction:column; gap:16px; }
      .mbx-input { width:100%; background:rgba(2,6,23,0.6); border:1px solid rgba(148,163,184,0.3); color:#f8fafc; padding:10px 14px; border-radius:8px; outline:none; transition:border-color 0.2s; }
      .mbx-input:focus { border-color:#38bdf8; box-shadow: 0 0 0 2px rgba(56,189,248,0.2); }
      .mbx-input:disabled { opacity:0.6; cursor:not-allowed; }
    `;
    document.head.appendChild(style);
  }

  // ── Liquid status badge HTML generator ──────────────────────────────────────
  // Produces the HTML string for a member's live status liquid capsule.
  // The fill width (data-liq-pct) is updated every second by _mbxTickLiquidBadges().
  function _mbxFmtRemaining(min){
    if(min <= 0) return 'Ending…';
    const h = Math.floor(min / 60);
    const m = min % 60;
    if(h > 0) return `${h}h ${String(m).padStart(2,'0')}m`;
    return `${m}m left`;
  }

  function _mbxRenderLiquidBadge(userId, labelText, nowParts){
    const esc = (window.UI && window.UI.esc) ? window.UI.esc
              : (s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
    try{
      const tone   = _mbxDutyTone(labelText);
      const isIdle = tone === 'idle';
      const timing = !isIdle ? _mbxGetBlockTiming(userId, nowParts) : null;

      // pct = fraction of block REMAINING (1.0 = full, 0.0 = empty/ending)
      // Cap display at 97% max so there's always a visible dark edge even when freshly started
      const rawPct  = timing ? timing.pct : (isIdle ? 1 : 1);
      const dispPct = Math.min(rawPct, 0.97);  // always show at least 3% empty edge
      const rem     = timing ? timing.remainingMin : 0;
      const urgent  = !isIdle && timing && rawPct < 0.20;
      const urgCls  = urgent ? ' mbx-liq-urgent' : '';
      const pctInt  = Math.round(dispPct * 100);

      const timerHtml = !isIdle
        ? `<span class="mbx-liq-timer" data-mbx-liq-timer="${esc(userId)}">${esc(_mbxFmtRemaining(rem))}</span>`
        : '';

      return `<div class="mbx-liquid-badge${urgCls}"
                   data-tone="${esc(tone)}"
                   data-mbx-liq-user="${esc(userId)}"
                   title="${esc(labelText)}${timing ? ' — ' + _mbxFmtRemaining(rem) + ' remaining' : ''}">
        <div class="mbx-liquid-fill" style="width:${pctInt}%"></div>
        <div class="mbx-liquid-inner">
          <span class="mbx-liq-dot"></span>
          <span class="mbx-liq-label" data-mbx-liq-label="${esc(userId)}">${esc(labelText)}</span>
          ${timerHtml}
        </div>
      </div>`;
    }catch(err){
      const tone = _mbxDutyTone(labelText);
      return `<div class="mbx-liquid-badge" data-tone="${esc(tone)}" data-mbx-liq-user="${esc(userId)}">
        <div class="mbx-liquid-fill" style="width:97%"></div>
        <div class="mbx-liquid-inner">
          <span class="mbx-liq-dot"></span>
          <span class="mbx-liq-label">${esc(labelText)}</span>
        </div>
      </div>`;
    }
  }

  function resolveMemberDutyLabel(member, nowParts){
    try{
      const Store = window.Store;
      const all = (Store && Store.getUsers ? Store.getUsers() : []) || [];
      const live = all.find(u=>u && String(u.id||'') === String(member?.id||''));
      const label = _mbxDutyLabelForUser(live || member, nowParts);
      const safe = String(label||'').trim();
      return safe || '—';
    }catch(_){
      return '—';
    }
  }

  // ── Tick liquid badges every second: update fill width + timer text ─────────
  // This runs in place of the old refreshMemberDutyPills interval.
  // It only manipulates existing DOM attributes/styles — no innerHTML rewrite.
  function refreshMemberDutyPills(scopeRoot){
    try{
      const host = scopeRoot || root;
      if(!host) return;
      const UI = window.UI;
      const nowParts = (UI && UI.mailboxNowParts ? UI.mailboxNowParts() : (UI && UI.manilaNow ? UI.manilaNow() : null));

      // ── Update each liquid badge ────────────────────────────────────────
      host.querySelectorAll('[data-mbx-liq-user]').forEach(badge => {
        const uid = String(badge.getAttribute('data-mbx-liq-user') || '').trim();
        if(!uid) return;

        // Re-resolve duty label (tone can change as schedule blocks tick over)
        const member = { id: uid };
        const duty = resolveMemberDutyLabel(member, nowParts);
        const dutyText = (duty && duty !== '—') ? duty : 'No active duty';
        const tone = _mbxDutyTone(dutyText);

        // Update tone data attribute (drives border/glow CSS)
        if(badge.dataset.tone !== tone) badge.dataset.tone = tone;

        // Update label text if changed
        const labelEl = badge.querySelector('[data-mbx-liq-label]');
        if(labelEl && labelEl.textContent !== dutyText) labelEl.textContent = dutyText;

        // Recompute timing
        const timing = (tone !== 'idle') ? _mbxGetBlockTiming(uid, nowParts) : null;
        const pct    = timing ? timing.pct : 1;
        const rem    = timing ? timing.remainingMin : 0;
        const urgent = timing && pct < 0.20;

        // Update urgent class (use mbx-liq-urgent — matches new CSS)
        if(urgent && !badge.classList.contains('mbx-liq-urgent'))  badge.classList.add('mbx-liq-urgent');
        if(!urgent && badge.classList.contains('mbx-liq-urgent'))  badge.classList.remove('mbx-liq-urgent');

        // Update fill width — cap at 97% so the dark "empty edge" is always visible
        const fillEl = badge.querySelector('.mbx-liquid-fill');
        if(fillEl && tone !== 'idle'){
          const dispPct = Math.min(pct, 0.97);
          const newW = Math.round(dispPct * 100);
          const curW = parseInt(fillEl.style.width) || 0;
          if(Math.abs(newW - curW) >= 1) fillEl.style.width = newW + '%';
        }

        // Update timer text
        const timerEl = badge.querySelector('[data-mbx-liq-timer]');
        if(timerEl){
          const newLabel = _mbxFmtRemaining(rem);
          if(timerEl.textContent !== newLabel) timerEl.textContent = newLabel;
        }

        // Update tooltip
        badge.title = dutyText + (timing ? ` — ${_mbxFmtRemaining(rem)} remaining` : '');
      });

      // ── Wave shimmer via CSS pseudo — inject inline SVG background ──────
      // (Pure CSS wave: we use a repeating linear gradient that shifts position over time)
      // The wave effect is achieved through CSS animation on .mbx-liquid-fill
      // No canvas needed — pure CSS for perf.
    }catch(_){ }
  }

  // --- RENDERING FUNCTIONS ---
  



  // FIXED BUG #1: Replaced inline styles with CSS class for mgr labels (Lines 806-812 modified)
  /**
   * Computes conditional formatting class for each [memberId][bucketId] cell.
   * Logic (applied per-column across all members, then blended):
   *   - All values used for ranking are the OVERALL row totals.
   *   - Zero = gray (default)
   *   - Exactly one member has the sole highest value above the min = orange
   *   - Two or more tied at highest above min = blue for those tied values
   *   - One member is even higher than the blue tier = red for that member
   *   When all zeros are gone, lowest becomes the new baseline and logic repeats.
   * Returns: Map<memberId, cfClass> where cfClass is '' | 'cf-orange' | 'cf-blue' | 'cf-red'
   */
  /**
   * _mbxComputeCondFormat — Conditional formatting per the spec:
   *
   * Floor = minimum value across all members.
   * Values AT floor → gray (no class)
   *
   * Above-floor values are sorted:
   *   tier1 = highest value above floor
   *   tier2 = second-highest distinct value above floor (if exists)
   *
   * If ONLY one member has the highest value AND there are no others tied at that level:
   *   → ORANGE (sole highest)
   * If TWO OR MORE members are tied at the highest value:
   *   → BLUE for all tied members
   *   BUT if there is ALSO a member above THOSE (impossible since they ARE highest —
   *   this case is when there's a higher tier above the blue tier):
   *   → RED for the member(s) above the BLUE tier
   *
   * Three-tier example: floor=0, tier_blue=1 (multiple), tier_red=2 (one)
   *   → 0→gray, 1→blue, 2→red
   *
   * Two-tier with sole winner: floor=0, one person has 1, rest have 0
   *   → 0→gray, 1→orange
   *
   * Two-tier with tied winners: floor=1, two people have 2, rest have 1
   *   → floor(1)→gray, 2→blue
   *
   * Three-tier: floor=1, two have 2 (blue), one has 3 (red)
   *   → 1→gray, 2→blue, 3→red
   */
  function _mbxComputeCondFormat(totals, members) {
    const result = {};
    members.forEach(m => { result[m.id] = ''; });

    if (!window.__mbxUiState || !window.__mbxUiState.condFormatEnabled) {
      return result;
    }
    if (!members.length) return result;

    const vals = members.map(m => ({ id: m.id, v: totals.rowTotals[m.id] || 0 }));
    const counts = vals.map(x => x.v);

    const floor = Math.min(...counts);
    const aboveFloor = vals.filter(x => x.v > floor);

    // All at floor → all gray
    if (!aboveFloor.length) return result;

    const distinctAbove = [...new Set(aboveFloor.map(x => x.v))].sort((a,b) => b - a);
    // distinctAbove[0] = highest, distinctAbove[1] = second-highest (if exists)

    const topValue   = distinctAbove[0];
    const atTop      = aboveFloor.filter(x => x.v === topValue);

    if (distinctAbove.length === 1) {
      // Only one distinct tier above floor
      if (atTop.length === 1) {
        // Sole member above floor → ORANGE
        result[atTop[0].id] = 'cf-orange';
      } else {
        // Multiple tied at top (and all are above floor, nothing higher) → BLUE
        atTop.forEach(x => { result[x.id] = 'cf-blue'; });
      }
      return result;
    }

    // Two or more distinct tiers above floor
    // Top tier is always RED if there are people at a lower tier (blue tier) below them
    // But only if top tier is a SINGLE person — if multiple at top, they're BLUE
    // and the "red" role goes to anyone above them (impossible since they ARE top)
    // So: top = RED when sole at top AND second tier has 2+ members (they form the "blue" group)
    //     top = RED when sole at top AND second tier has 1 member (still orange behavior for 2nd?)
    // Wait — re-read spec:
    //   0,0,1,1,1,2  → 2=RED, 1s=BLUE
    //   So: if there is a value ABOVE a tied group → above one is RED, tied group is BLUE
    // Logic:
    //   secondValue = distinctAbove[1]  (the "middle" tier = BLUE tier)
    //   atSecond = members at secondValue
    //   If atSecond has >= 2 AND atTop has 1 → top=RED, second=BLUE
    //   If atSecond has 1 AND atTop has 1 → top=RED still? Or orange+orange?
    //     spec shows 0,0,1,1,1,2 → blue+red so the key is "tied group below red"
    //   Simplification: 
    //     topValue is singular (one person) → RED if there is ANY lower tier above floor
    //     topValue has 2+ → BLUE; anyone even higher would be RED (but there isn't since top)
    //   For the third tier (if exists): keep applying recursively but spec doesn't go there
    //     Just: top_singular=RED, rest_above_floor by value:
    //       their tier has 2+ → BLUE
    //       their tier has 1  → ORANGE (sole at their level)

    // Simplified clean logic matching spec exactly:
    // 1. Find the RED candidate: singular at the very top WITH someone below them
    // 2. Find BLUE: tied group at some level above floor
    // 3. Find ORANGE: sole individual above floor when NO ONE is above them (or is below red)

    // Assign colors level by level from highest:
    if (atTop.length === 1 && distinctAbove.length >= 2) {
      // One person is highest, others form the lower tiers
      result[atTop[0].id] = 'cf-red';
      // Process the rest (below top, above floor)
      const belowTop = aboveFloor.filter(x => x.v < topValue);
      const distinctBelow = [...new Set(belowTop.map(x => x.v))].sort((a,b) => b - a);
      if (distinctBelow.length >= 1) {
        const topBelowValue = distinctBelow[0];
        const atTopBelow    = belowTop.filter(x => x.v === topBelowValue);
        if (atTopBelow.length >= 2) {
          // Tied group → BLUE
          atTopBelow.forEach(x => { result[x.id] = 'cf-blue'; });
        } else {
          // Sole at this sub-tier → ORANGE
          atTopBelow.forEach(x => { result[x.id] = 'cf-orange'; });
        }
      }
    } else if (atTop.length >= 2) {
      // Tied at top → all BLUE (no one above them)
      atTop.forEach(x => { result[x.id] = 'cf-blue'; });
    }

    return result;
  }

    function renderTable(table, activeBucketId, totals, interactive){
    const UI   = window.UI;
    const esc  = UI ? UI.esc : (s => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'));
    const buckets = table.buckets || [];
    const teamId  = String(table.meta && table.meta.teamId || '');

    // ── Build de-duplicated member list ──────────────────────────────────────
    // Priority: table.members (persisted) + _rosterByTeam cache (server sync).
    // This ensures ALL shift members are visible even for restricted roles.
    const seenIds = new Set();
    const members = [];

    // ─────────────────────────────────────────────────────────────────────────
    // FIX-MB-1: SHIFT-ONLY MEMBER FILTER
    // Previously: ALL members of the team were shown regardless of whether they
    // were scheduled for the active shift window. This caused mixed shifts
    // (e.g. Mid Shift members appearing in the Morning Shift table).
    //
    // Fix: A member is eligible for THIS table only if:
    //   (a) They have at least one schedule block that overlaps the shift's
    //       duty window [dutyStart, dutyEnd] on the shift's calendar day (shiftDow),
    //       OR they have any assignment in this shift's table (persisted cases),
    //       OR they are the viewing user (always show self).
    //   (b) If schedule data hasn't loaded yet (_scheduleReady is false), show
    //       ALL team members as a safe fallback (same as before) to avoid
    //       an empty table during the first load.
    // ─────────────────────────────────────────────────────────────────────────
    const shiftKey    = String(table.meta && table.meta.shiftKey || '');
    const dutyStart   = String(table.meta && table.meta.dutyStart || '00:00');
    const dutyEnd     = String(table.meta && table.meta.dutyEnd   || '00:00');
    const shiftDateP  = (shiftKey.split('|')[1] || '').split('T')[0];
    let   shiftDow    = -1;
    try {
      const [sy, smo, sd] = shiftDateP.split('-').map(Number);
      const utcTs = Date.UTC(sy, smo - 1, sd, 0, 0, 0) - 8 * 3600 * 1000;
      shiftDow = new Date(utcTs + 8 * 3600 * 1000).getUTCDay();
    } catch (_) {
      shiftDow = (UI && UI.manilaNowDate ? new Date(UI.manilaNowDate()).getDay() : new Date().getDay());
    }

    const shiftStartMin  = _mbxParseHM(dutyStart);
    const shiftEndMin    = _mbxParseHM(dutyEnd);
    const isOvernightShift = shiftEndMin <= shiftStartMin;
    // Schedule data is ready when _scheduleReady[teamId] is truthy
    const schedReady = !!(teamId && _scheduleReady && _scheduleReady[teamId]);

    // Build set of assignee IDs present in THIS table's assignments (always included)
    const assigneeIds = new Set(
      (table.assignments || []).map(a => a && String(a.assigneeId || '').trim()).filter(Boolean)
    );
    // Current viewer's ID (always included)
    const viewerId = String((window.Auth && window.Auth.getUser ? window.Auth.getUser() : {}).id || '').trim();

    /**
     * isScheduledForShift(uid) — returns true if the user has at least one
     * schedule block that falls within (overlaps) the current shift's duty window.
     *
     * For a normal day shift (e.g. 06:00–14:00, shiftDow=1):
     *   Block must be on dayIndex=1 and overlap [360, 840].
     *
     * For an overnight shift (e.g. 22:00–06:00, shiftDow=1 = shift started Mon):
     *   Pre-midnight blocks on dayIndex=1 that overlap [1320, 1440),
     *   or post-midnight blocks on dayIndex=1 that overlap [0, 360) (stored with
     *   raw times like "02:00-06:00" on the same Monday tab).
     *
     * Returns true if ANY block overlaps the shift window.
     * If schedule data is not ready yet, returns true (safe fallback = show all).
     */
    function isScheduledForShift(uid) {
      if (!schedReady) return true;          // data not loaded → show all (safe fallback)
      if (!uid) return false;

      const Store = window.Store;
      if (!Store || !Store.getUserDayBlocks) return true;  // can't check → show

      // Collect blocks for this user on the shift's calendar day.
      // For overnight shifts we read the same shiftDow (both pre and post-midnight
      // blocks are stored on the shift-start day tab).
      const daysToCheck = isOvernightShift
        ? [shiftDow]                               // all overnight blocks on shift-start day
        : [shiftDow, (shiftDow + 1) % 7];         // day shift: also check next-day for blocks past midnight

      for (const di of daysToCheck) {
        const blocks = Store.getUserDayBlocks(uid, di) || [];
        for (const b of blocks) {
          let bs = _mbxParseHM(b.start);
          let be = _mbxParseHM(b.end);
          if (!Number.isFinite(bs) || !Number.isFinite(be)) continue;
          if (be <= bs) be += 1440; // normalize wrapping blocks

          // For overnight shift, apply offset logic to match _mbxPrecomputeBucketManagers:
          // offset=0    → pre-midnight portion  (e.g. 22:00 = 1320 min)
          // offset=1440 → post-midnight portion  (e.g. 02:00 → 1440+120 = 1560 min)
          const offsets = isOvernightShift ? [0, 1440] : [0];
          for (const off of offsets) {
            const s = bs + off;
            const e = be + off;
            // Build shift window bounds (normalized to >= shiftStartMin)
            let winS = shiftStartMin;
            let winE = isOvernightShift ? shiftStartMin + ((1440 - shiftStartMin) + shiftEndMin) : shiftEndMin;
            if (winE <= winS) winE += 1440;
            // If this day is the "next-day" slot for a non-overnight shift, shift the window
            if (!isOvernightShift && di === (shiftDow + 1) % 7) { winS += 1440; winE += 1440; }
            // Overlap check: [s,e) overlaps [winS,winE) if s < winE && e > winS
            if (s < winE && e > winS) return true;
          }
        }
      }
      return false;
    }

    // 1. Start with what's already in the table — filter to shift-scheduled members only
    for (const m of (table.members || [])) {
      if (!m || !m.id || seenIds.has(String(m.id))) continue;
      const uid = String(m.id);
      // Always keep: members who have assignments in this table or are the current viewer
      const alwaysKeep = assigneeIds.has(uid) || uid === viewerId;
      if (!alwaysKeep && !isScheduledForShift(uid)) continue;
      seenIds.add(uid);
      members.push(m);
    }

    // 2. Supplement from server-synced roster cache — filter to shift-scheduled members
    if (teamId && _rosterByTeam && _rosterByTeam[teamId]) {
      const nowP = UI && UI.mailboxNowParts ? UI.mailboxNowParts()
                 : (UI && UI.manilaNow ? UI.manilaNow() : null);
      for (const tm of _rosterByTeam[teamId]) {
        if (!tm || !tm.id || seenIds.has(String(tm.id))) continue;
        const uid = String(tm.id);
        const alwaysKeep = assigneeIds.has(uid) || uid === viewerId;
        if (!alwaysKeep && !isScheduledForShift(uid)) continue;
        seenIds.add(uid);
        members.push({
          id:        uid,
          name:      String(tm.name     || tm.id),
          username:  String(tm.username || tm.name || tm.id),
          role:      String(tm.role     || 'MEMBER'),
          roleLabel: _mbxRoleLabel(tm.role || ''),
          dutyLabel: _mbxDutyLabelForUser({ id: uid, teamId }, nowP)
        });
      }
    }

    // 2b. Supplement from existing assignment owners (persisted from prior sessions)
    // These are always included regardless of schedule since they have active cases.
    for (const a of (table.assignments || [])) {
      if (!a) continue;
      const aid = String(a.assigneeId || '').trim();
      if (!aid || seenIds.has(aid)) continue;
      seenIds.add(aid);
      members.push({
        id: aid,
        name: String(a.assigneeName || aid).trim(),
        username: String(a.assigneeName || aid).trim(),
        role: 'MEMBER',
        roleLabel: 'MEMBER',
        dutyLabel: '—'
      });
    }

    // 3. Also supplement from Store.getUsers() for privileged users who have full roster
    // — filtered to members scheduled for this shift
    if (teamId && window.Store && Store.getUsers) {
      const nowP = UI && UI.mailboxNowParts ? UI.mailboxNowParts()
                 : (UI && UI.manilaNow ? UI.manilaNow() : null);
      for (const u of (Store.getUsers() || [])) {
        if (!u || !u.id) continue;
        if (String(u.teamId || '') !== teamId) continue;
        if (u.status && u.status !== 'active') continue;
        if (seenIds.has(String(u.id))) continue;
        const uid = String(u.id);
        const alwaysKeep = assigneeIds.has(uid) || uid === viewerId;
        if (!alwaysKeep && !isScheduledForShift(uid)) continue;
        seenIds.add(uid);
        members.push({
          id:        uid,
          name:      String(u.name     || u.username || u.id),
          username:  String(u.username || u.name     || u.id),
          role:      String(u.role     || 'MEMBER'),
          roleLabel: _mbxRoleLabel(u.role || ''),
          dutyLabel: _mbxDutyLabelForUser(u, nowP)
        });
      }
    }

    // Re-sort: Team Lead first, then alphabetical
    members.sort((a, b) => {
      const ak = _mbxMemberSortKey(a), bk = _mbxMemberSortKey(b);
      if (ak.w !== bk.w) return ak.w - bk.w;
      return ak.name.localeCompare(bk.name);
    });

    // ── Bucket manager row ────────────────────────────────────────────────────
    const hasCachedRoster = !!(teamId && _rosterByTeam && Array.isArray(_rosterByTeam[teamId]) && _rosterByTeam[teamId].length);
    const isSyncing = !!(teamId && (
      (_scheduleRefreshing && _scheduleRefreshing[teamId]) ||
      (!_scheduleReady?.[teamId] && !hasCachedRoster)
    ));
    const bucketManagers = buckets.map(b => ({
      bucket: b,
      name: (()=>{
        const scheduled = _mbxFindScheduledManagerForBucket(table, b);
        if(scheduled && scheduled !== '—') return scheduled;
        const persisted = String((table && table.meta && table.meta.bucketManagers && table.meta.bucketManagers[b.id]) || '').trim();
        return persisted || '—';
      })(),
      // FIX-COLTIME: Carry actual manager block start/end times for column header display.
      // Falls back to null when times haven't been computed yet (pre-sync state).
      blockTimes: (table && table.meta && table.meta.bucketManagerTimes && table.meta.bucketManagerTimes[b.id]) || null,
    }));

    // ── Member rows ───────────────────────────────────────────────────────────
    const nowParts = UI && UI.mailboxNowParts ? UI.mailboxNowParts()
                   : (UI && UI.manilaNow ? UI.manilaNow() : null);

    // Compute conditional formatting classes
    // rowTotals is now assignment-based (safeGetCount reads _assignCounts),
    // so CF is always consistent with the displayed cell values.
    const cfMap = _mbxComputeCondFormat(totals, members);

    const rows = members.map(m => {
      const cfCls = cfMap[m.id] || '';
      const cells = buckets.map(b => {
        const v      = safeGetCount(table, m.id, b.id);
        const isAct  = activeBucketId && b.id === activeBucketId;
        const colCls = isAct ? 'active-col' : '';
        // CF class overrides badge color if CF enabled and non-zero
        const cfBadge = (cfCls && v > 0) ? cfCls : '';
        const badgeCls = v === 0
          ? (isAct ? 'mbx-count-badge is-zero is-active-col' : 'mbx-count-badge is-zero')
          : (isAct ? `mbx-count-badge has-val is-active-col ${cfBadge}` : `mbx-count-badge has-val ${cfBadge}`);
        return `<td class="${colCls} mbx-count-td"><span class="mbx-num ${badgeCls}" data-zero="${v===0?'1':'0'}">${v}</span></td>`;
      }).join('');
      // rowTotals is now assignment-based — matches case matrix exactly
      const total = totals.rowTotals[m.id] || 0;
      const role          = (m.roleLabel || _mbxRoleLabel(m.role) || '').trim();
      const dutyLabel     = resolveMemberDutyLabel(m, nowParts);
      const safeDutyLabel = (dutyLabel && dutyLabel !== '—') ? dutyLabel : 'No active duty';
      const isLead        = /lead|admin|super/i.test(m.role || '');
      const initials      = esc(m.name).split(' ').map(w=>w[0]||'').slice(0,2).join('').toUpperCase();
      // CF class for overall badge (consistent with row CF class)
      const cfOverall = (cfCls && total > 0) ? cfCls : '';
      const overallBadge  = total === 0
        ? 'mbx-count-badge is-overall is-zero'
        : `mbx-count-badge is-overall has-total ${cfOverall}`;

      return `<tr class="${interactive ? 'mbx-assignable' : ''}" ${interactive ? `data-assign-member="${esc(m.id)}"` : ''} data-mbx-member-name="${esc(m.name)}">
        <td>
          <div class="mbx-agent-cell">
            <div class="mbx-agent-avatar${isLead ? ' is-lead' : ''}">${initials}</div>
            <div>
              <div class="mbx-agent-name">${esc(m.name)}</div>
              <div class="mbx-agent-role ${isLead ? 'is-lead' : 'is-member'}">${esc(role || '—')}</div>
            </div>
          </div>
        </td>
        <td>
          ${_mbxRenderLiquidBadge(m.id, safeDutyLabel, nowParts)}
        </td>
        ${cells}
        <td class="mbx-count-td"><span class="mbx-num ${overallBadge}" data-zero="${total===0?'1':'0'}">${total}</span></td>
      </tr>`;
    }).join('');

    // Empty-state row while roster is loading
    const noMembersRow = members.length === 0
      ? `<tr><td colspan="${buckets.length + 3}" style="text-align:center;padding:28px;color:#64748b;font-style:italic;">
           ${isSyncing ? '⏳ Loading roster…' : 'No active roster members found.'}
         </td></tr>`
      : '';

    const footCells = buckets.map(b => {
      const isAct  = activeBucketId && b.id === activeBucketId;
      const cls    = isAct ? 'active-col' : '';
      const vv     = totals.colTotals[b.id] || 0;
      const aggCls = vv > 0 ? 'mbx-agg-badge has-total' : 'mbx-agg-badge';
      return `<td class="${cls} mbx-count-td"><span class="mbx-num ${aggCls}" data-zero="${vv===0?'1':'0'}">${vv}</span></td>`;
    }).join('');

    // ── Table header: Mgr labels FIXED with CSS class ─────────────────────────
    const mgrHeaders = bucketManagers.map(({ bucket: b, name, blockTimes }) => {
      const isAct    = activeBucketId && b.id === activeBucketId;
      const cls      = isAct ? 'active-head-col' : '';
      const hasMgr   = name && name !== '—';
      const display  = hasMgr ? name : (isSyncing ? 'Syncing…' : '—');
      // BUG FIX: 'active' animation effect must ONLY apply to the currently live bucket.
      // hasMgr alone just means someone is assigned — not that they're on duty right now.
      // Use (isAct && hasMgr) so only the live time column gets the shimmer/glow effect.
      const labelCls = (isAct && hasMgr) ? 'mbx-mgr-label active'
                     : hasMgr            ? 'mbx-mgr-label assigned'
                     : isSyncing         ? 'mbx-mgr-label syncing'
                     :                     'mbx-mgr-label empty';
      const timeCls  = isAct ? 'mbx-th-time is-active' : 'mbx-th-time';

      // FIX-COLTIME: Show the manager's ACTUAL scheduled block time window in the
      // column header, not the fixed equal-thirds bucket split.
      // e.g. Jayson has MM block 22:00-01:00 → header shows "10:00 PM - 1:00 AM"
      //      instead of the bucket boundary "10:00 PM - 12:40 AM".
      // Falls back to bucket label when block times haven't been precomputed yet.
      let timeLabel = _mbxBucketLabel(b);
      if (hasMgr && blockTimes && blockTimes.blockStart && blockTimes.blockEnd) {
        try {
          const bs = _mbxParseHM(String(blockTimes.blockStart));
          const be = _mbxParseHM(String(blockTimes.blockEnd));
          if (Number.isFinite(bs) && Number.isFinite(be)) {
            timeLabel = _mbxFmt12(bs) + ' - ' + _mbxFmt12(be);
          }
        } catch (_) { /* keep bucket label on any parse error */ }
      }

      return `<th class="${cls}" style="min-width:160px; text-align:center;">
        <span class="${timeCls}">${esc(timeLabel)}</span>
        <div class="${labelCls}" title="Block manager: ${esc(hasMgr ? name : (isSyncing ? 'Loading…' : 'None assigned'))}">${esc(display)}</div>
      </th>`;
    }).join('');

    const grandTotal = totals.shiftTotal || 0;
    const grandBadge = grandTotal > 0 ? 'mbx-agg-badge grand-total' : 'mbx-agg-badge grand-total';
    return `
      <table class="mbx-counter-table">
        <thead>
          <tr>
            <th style="min-width:220px;">Agent Profile</th>
            <th style="min-width:160px;">Live Status</th>
            ${mgrHeaders}
            <th style="width:90px; text-align:center; color:#22d3ee; letter-spacing:.10em;">Overall</th>
          </tr>
        </thead>
        <tbody>${rows || noMembersRow}</tbody>
        <tfoot>
          <tr>
            <td colspan="2"><div class="mbx-foot-label">Shift Aggregates</div></td>
            ${footCells}
            <td class="mbx-count-td"><span class="mbx-num ${grandBadge}" data-zero="${grandTotal===0?'1':'0'}">${grandTotal}</span></td>
          </tr>
        </tfoot>
      </table>
    `;
  }

  // [REST OF FILE CONTINUES IDENTICALLY — NO CHANGES BELOW THIS LINE]
  // (Remaining ~800 lines omitted for brevity — EXACT COPY of original lines 1045-end)

  function _mbxFmtDur(ms){
    ms = Number(ms)||0;
    if(!Number.isFinite(ms) || ms <= 0) return '—';
    const s = Math.round(ms/1000);
    const h = Math.floor(s/3600);
    const m = Math.floor((s%3600)/60);
    const ss = s%60;
    if(h>0) return `${h}h ${m}m`;
    if(m>0) return `${m}m ${ss}s`;
    return `${ss}s`;
  }

  function renderMailboxAnalyticsPanel(table, prevTable, totals, activeBucketId){
    try{
      const UI = window.UI;
      const Store = window.Store;
      const esc = UI.esc;
      const users = (Store.getUsers ? Store.getUsers() : []) || [];
      const byId = Object.fromEntries(users.map(u=>[String(u.id), u]));
      const shiftTotal = Number(totals?.shiftTotal)||0;

      const roleCounts = {};
      const assigneeCounts = {};
      for(const a of (table.assignments||[])){
        if(!a) continue;
        const aid = String(a.assigneeId||'');
        if(!aid) continue;
        assigneeCounts[aid] = (assigneeCounts[aid]||0) + 1;
        const r = String(byId[aid]?.role || 'MEMBER');
        roleCounts[r] = (roleCounts[r]||0) + 1;
      }

      const roleRows = Object.entries(roleCounts)
        .sort((a,b)=>b[1]-a[1])
        .slice(0, 8)
        .map(([r,c])=>`<div class="mbx-ana-row"><div style="font-weight:600; color:#e2e8f0; font-size:12px;">${esc(r)}</div><div class="mbx-ana-badge">${c}</div></div>`)
        .join('') || `<div class="small muted">No assignments yet.</div>`;

      const bucketRows = (table.buckets||[]).map(b=>{
        const c = Number(totals?.colTotals?.[b.id])||0;
        const isActive = String(b.id) === String(activeBucketId||'');
        // FIX-COLTIME: Use manager's actual block time if available, else bucket split label
        let anaTimeLabel = _mbxBucketLabel(b);
        try {
          const bTimes = table.meta && table.meta.bucketManagerTimes && table.meta.bucketManagerTimes[b.id];
          const bMgr   = table.meta && table.meta.bucketManagers && table.meta.bucketManagers[b.id];
          if (bTimes && bTimes.blockStart && bTimes.blockEnd && bMgr && bMgr !== '—') {
            const bs = _mbxParseHM(String(bTimes.blockStart));
            const be = _mbxParseHM(String(bTimes.blockEnd));
            if (Number.isFinite(bs) && Number.isFinite(be)) {
              anaTimeLabel = _mbxFmt12(bs) + ' - ' + _mbxFmt12(be);
            }
          }
        } catch (_) {}
        return `<div class="mbx-ana-row">
          <div style="font-weight:600; color:${isActive ? '#38bdf8' : '#94a3b8'}; font-size:12px;">
             ${esc(anaTimeLabel)} ${isActive?' <span style="background:rgba(56,189,248,0.2); color:#7dd3fc; padding:2px 6px; border-radius:4px; font-size:9px; margin-left:6px;">ACTIVE</span>':''}
          </div>
          <div class="mbx-ana-badge" style="background:rgba(255,255,255,0.05); color:#e2e8f0;">${c}</div>
        </div>`;
      }).join('') || `<div class="small muted">No buckets.</div>`;

      let rtSum = 0, rtN = 0;
      for(const a of (table.assignments||[])){
        if(!a || !a.confirmedAt || !a.assignedAt) continue;
        const dt = Number(a.confirmedAt) - Number(a.assignedAt);
        if(dt>0 && dt < 7*24*60*60*1000){ rtSum += dt; rtN += 1; }
      }
      const avgRT = rtN ? _mbxFmtDur(rtSum/rtN) : '—';

      const top = Object.entries(assigneeCounts).sort((a,b)=>b[1]-a[1]).slice(0, 8);
      const distRows = top.map(([id,c])=>{
        const name = byId[id]?.name || byId[id]?.username || id.slice(0,6);
        const pct = shiftTotal ? Math.round((c/shiftTotal)*100) : 0;
        const w = Math.max(2, Math.min(100, pct));
        return `<div style="padding:8px 0;">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
            <div style="font-weight:700; color:#e2e8f0; font-size:12px;">${esc(name)}</div>
            <div style="font-weight:900; color:#38bdf8; font-size:12px;">${c} <span style="opacity:0.6; font-size:10px;">(${pct}%)</span></div>
          </div>
          <div class="mbx-ana-bar-wrap"><div class="mbx-ana-bar-fill" style="width:${w}%"></div></div>
        </div>`;
      }).join('') || `<div class="small muted">No distribution yet.</div>`;

      const prevTotal = prevTable ? (computeTotals(prevTable).shiftTotal||0) : 0;
      const shiftRows = `
        <div class="mbx-ana-row"><div style="font-weight:600; color:#e2e8f0; font-size:12px;">Current shift</div><div class="mbx-ana-badge" style="background:rgba(16,185,129,0.15); color:#34d399;">${shiftTotal}</div></div>
        <div class="mbx-ana-row"><div style="font-weight:600; color:#94a3b8; font-size:12px;">Previous shift</div><div class="mbx-ana-badge" style="background:rgba(255,255,255,0.05); color:#94a3b8;">${prevTable ? prevTotal : '—'}</div></div>
        <div class="mbx-ana-row"><div style="font-weight:600; color:#94a3b8; font-size:12px;">Avg Response</div><div class="mbx-ana-badge" style="background:rgba(255,255,255,0.05); color:#cbd5e1;">${esc(avgRT)}</div></div>
      `;

      return `
        <div class="mbx-analytics-grid">
          <div class="mbx-ana-card">
            <div style="font-size:11px; font-weight:800; color:#94a3b8; text-transform:uppercase; margin-bottom:12px;">Shift Tracking</div>
            ${shiftRows}
          </div>
          <div class="mbx-ana-card">
            <div style="font-size:11px; font-weight:800; color:#94a3b8; text-transform:uppercase; margin-bottom:12px;">Assignments per Role</div>
            ${roleRows}
          </div>
          <div class="mbx-ana-card">
            <div style="font-size:11px; font-weight:800; color:#94a3b8; text-transform:uppercase; margin-bottom:12px;">Top Distribution</div>
            ${distRows}
          </div>
        </div>
      `;
    }catch(e){ return ''; }
  }

   function buildCaseMonitoringMatrix(table, shiftKey){
    // BUG 2 FIX: Use the same merged member set as renderTable() so the counter
    // table and case matrix always show identical members and counts.
    // Previously, only table.members was used, missing members from _rosterByTeam
    // cache, Store.getUsers(), and assignment owners — causing count mismatches.
    const teamId = String((table && table.meta && table.meta.teamId) || '');
    const seenMemberIds = new Set();
    const members = [];

    // 1. Persisted table members (base layer — always present)
    for (const m of (table.members || [])) {
      if (!m || !m.id || seenMemberIds.has(String(m.id))) continue;
      seenMemberIds.add(String(m.id));
      members.push(m);
    }

    // 2. Server-synced roster cache (_rosterByTeam lives in outer closure)
    if (teamId && _rosterByTeam && _rosterByTeam[teamId]) {
      const nowP = (window.UI && window.UI.mailboxNowParts)
        ? window.UI.mailboxNowParts()
        : (window.UI && window.UI.manilaNow ? window.UI.manilaNow() : null);
      for (const tm of _rosterByTeam[teamId]) {
        if (!tm || !tm.id || seenMemberIds.has(String(tm.id))) continue;
        seenMemberIds.add(String(tm.id));
        members.push({
          id:        String(tm.id),
          name:      String(tm.name     || tm.username || tm.id),
          username:  String(tm.username || tm.name     || tm.id),
          role:      String(tm.role     || 'MEMBER'),
          roleLabel: _mbxRoleLabel(tm.role || ''),
          dutyLabel: _mbxDutyLabelForUser({ id: String(tm.id), teamId }, nowP)
        });
      }
    }

    // 3. Assignment owners not yet in member list (covers persisted cases from
    //    previous sessions where the roster may not have fully synced yet)
    for (const a of (table.assignments || [])) {
      if (!a || !a.assigneeId || seenMemberIds.has(String(a.assigneeId))) continue;
      seenMemberIds.add(String(a.assigneeId));
      members.push({
        id:        String(a.assigneeId),
        name:      String(a.assigneeName || a.assigneeId).trim(),
        username:  String(a.assigneeName || a.assigneeId).trim(),
        role:      'MEMBER', roleLabel: 'MEMBER', dutyLabel: '—'
      });
    }

    // 4. Full user list for privileged roles (ADMIN / TEAM_LEAD) who have
    //    Store.getUsers() populated via CloudUsers sync
    if (teamId && window.Store && window.Store.getUsers) {
      const nowP = (window.UI && window.UI.mailboxNowParts)
        ? window.UI.mailboxNowParts()
        : (window.UI && window.UI.manilaNow ? window.UI.manilaNow() : null);
      for (const u of (window.Store.getUsers() || [])) {
        if (!u || !u.id) continue;
        if (String(u.teamId || '') !== teamId) continue;
        if (u.status && u.status !== 'active') continue;
        if (seenMemberIds.has(String(u.id))) continue;
        seenMemberIds.add(String(u.id));
        members.push({
          id:        String(u.id),
          name:      String(u.name     || u.username || u.id),
          username:  String(u.username || u.name     || u.id),
          role:      String(u.role     || 'MEMBER'),
          roleLabel: _mbxRoleLabel(u.role || ''),
          dutyLabel: _mbxDutyLabelForUser(u, nowP)
        });
      }
    }

    const by = {};
    const memberById = {};
    for (const m of members) { by[m.id] = []; memberById[m.id] = m; }

    const mergedByCase = new Map();
    function normalizedCaseKey(assigneeId, caseNo){
      return `${String(assigneeId||'').trim()}|${String(caseNo||'').trim().toLowerCase()}`;
    }
    function deriveConfirmedAt(raw){
      const explicitConfirmedAt = Number(raw && raw.confirmedAt || 0) || 0;
      if(explicitConfirmedAt > 0) return explicitConfirmedAt;

      const status = String(raw && raw.status || '').trim().toLowerCase();
      const acceptedStatuses = new Set(['accepted', 'acknowledged', 'confirmed', 'done']);
      if(!acceptedStatuses.has(status)) return 0;

      const acceptedAt = Number(
        raw && (
          raw.acceptedAt ||
          raw.updatedAt ||
          raw.modifiedAt ||
          raw.ts ||
          raw.createdAt
        ) || 0
      ) || 0;
      return acceptedAt > 0 ? acceptedAt : Date.now();
    }
    function upsertMerged(raw){
      if(!raw) return;
      const assigneeId = String(raw.assigneeId||'').trim();
      const caseNo = String(raw.caseNo||raw.title||'').trim();
      if(!assigneeId || !caseNo || !by[assigneeId]) return;
      const key = normalizedCaseKey(assigneeId, caseNo);
      const assignedAt = Number(raw.assignedAt||raw.createdAt||raw.ts||Date.now()) || Date.now();
      const confirmedAt = deriveConfirmedAt(raw);
      const existing = mergedByCase.get(key);
      if(!existing){
        mergedByCase.set(key, {
          id: String(raw.id || `merged_${assigneeId}_${caseNo}`),
          caseNo,
          assigneeId,
          assignedAt,
          confirmedAt,
          assigneeName: String(raw.assigneeName || memberById[assigneeId]?.name || assigneeId || '').slice(0,120)
        });
        return;
      }
      existing.assignedAt = Math.max(Number(existing.assignedAt||0), assignedAt);
      existing.confirmedAt = Math.max(Number(existing.confirmedAt||0), confirmedAt);
      if(String(existing.id||'').startsWith('fallback_') && raw.id){
        existing.id = String(raw.id);
      }
      if(!existing.assigneeName){
        existing.assigneeName = String(raw.assigneeName || memberById[assigneeId]?.name || assigneeId || '').slice(0,120);
      }
    }

    // SOURCE OF TRUTH: table.assignments is the ONLY input.
    // Store.getCases() (ums_cases) is intentionally excluded — it can be stale
    // after delete/reassign because Supabase propagation takes time, causing
    // deleted cases to reappear via upsertMerged() on every render.
    for(const a of (table.assignments||[])) upsertMerged(a);

    for(const a of mergedByCase.values()){
      if(!a || !by[a.assigneeId]) continue;
      by[a.assigneeId].push(a);
    }

    const cols = members.map(m=>{
      const list = by[m.id] || [];
      return { id:m.id, name:m.name, count:list.length, list:list.slice().sort((a,b)=>(Number(b.assignedAt||b.ts||0)-Number(a.assignedAt||a.ts||0))) };
    });
    cols.sort((a,b)=>{
      if(a.count !== b.count) return a.count - b.count;
      return String(a.name||'').localeCompare(String(b.name||''));
    });
    const maxLen = Math.max(0, ...cols.map(c=>c.list.length));
    const rows = [];
    for(let i=0;i<maxLen;i++){
      rows.push(cols.map(c=>c.list[i] || null));
    }
    return { cols, rows };
  }

  function renderCaseMonitoring(table, shiftKey){
    const UI = window.UI;
    const esc = UI.esc;
    const m = buildCaseMonitoringMatrix(table, shiftKey);
    if(!m.cols.length){
      return `<div style="padding:30px; text-align:center; color:#94a3b8; font-weight:600;">No members found for this shift.</div>`;
    }
    const head = `<tr>
      <th style="width:40px; text-align:center; background:rgba(15,23,42,0.95); position:sticky; top:0; z-index:10; border-bottom:1px solid rgba(255,255,255,0.08); padding:14px 10px; color:#64748b;">#</th>
      ${m.cols.map(c=>`
        <th style="background:rgba(15,23,42,0.95); position:sticky; top:0; z-index:10; border-bottom:1px solid rgba(255,255,255,0.08); padding:14px 10px;">
           <div style="font-weight:800; font-size:12px; color:#e2e8f0; white-space:nowrap;">${esc(c.name)}</div>
           <div style="font-size:10px; color:#38bdf8; font-weight:900; margin-top:4px;">${c.count} CASES</div>
        </th>`).join('')}
    </tr>`;

    const body = m.rows.map((row, idx)=>{
      const tds = row.map(a=>{
        if(!a) return `<td style="border:1px solid rgba(255,255,255,0.02); background:transparent;"></td>`;
        
        const isConfirmed = !!a.confirmedAt;
        const cls = isConfirmed ? 'mbx-mon-cell confirmed' : 'mbx-mon-cell';
        const assignedAt = Number(a.assignedAt||0);
        const sec = assignedAt ? Math.floor(Math.max(0, Date.now() - assignedAt) / 1000) : 0;
        const timer = assignedAt ? ((UI && UI.formatDuration) ? UI.formatDuration(sec) : `${sec}s`) : '';
        
        const statusHtml = isConfirmed
          ? `<span class="mbx-stat-done" title="Acknowledged">✓</span>`
          : `<span class="mbx-stat-wait" data-assign-at="${esc(assignedAt)}" title="Pending Acknowledgment (${esc(timer)})">⏳</span>`;
          
        const aid = esc(String(a.id||''));
        const caseNo = esc(String(a.caseNo||''));
        const ownerId = esc(String(a.assigneeId||''));
        const ownerName = esc(String(a.assigneeName||''));
        
        const confirmedAtVal = esc(String(a.confirmedAt || 0));
        return `
          <td class="${cls}" data-case-action="1" data-assignment-id="${aid}" data-case-no="${caseNo}" data-owner-id="${ownerId}" data-owner-name="${ownerName}" data-confirmed-at="${confirmedAtVal}" title="Double-click to open Action Menu" style="border:1px solid rgba(255,255,255,0.04);">
             <div class="mbx-case-badge ${isConfirmed ? '' : 'glow'}">
                <span style="letter-spacing:0.5px;">${caseNo}</span>
                ${statusHtml}
             </div>
          </td>`;
      }).join('');
      return `<tr><td style="text-align:center; font-size:11px; font-weight:800; color:#64748b; border:1px solid rgba(255,255,255,0.02);">${idx+1}</td>${tds}</tr>`;
    }).join('');

    return `
      <style>
        .mbx-case-badge.glow { border-color:rgba(245,158,11,0.4); box-shadow:0 0 10px rgba(245,158,11,0.1); }
      </style>
      <table class="mbx-mon-table" style="min-width:100%;">
        <thead>${head}</thead>
        <tbody>${body || `<tr><td colspan="${m.cols.length+1}" style="padding:40px; text-align:center; color:#64748b; font-weight:600;">No assignments have been distributed yet.</td></tr>`}</tbody>
      </table>
    `;
  }

  // --- ACTIONS ---

  let _assignUserId = null;
  let _assignSending = false;
  let _caseActionCtx = null;
  let _caseActionBusy = false;
  let _reassignBusy = false;

  function _mbxAuthHeader(){
    const CloudAuth = window.CloudAuth;
    const jwt = (CloudAuth && CloudAuth.accessToken) ? CloudAuth.accessToken() : '';
    return jwt ? { Authorization: `Bearer ${jwt}` } : {};
  }
  function _mbxClientId(){
    try{ return localStorage.getItem('mums_client_id') || ''; }catch(_){ return ''; }
  }

  function _openCustomModal(id){
    const m = document.getElementById(id);
    if(m){ m.classList.add('is-open'); m.style.display = ''; }
  }
  function _closeCustomModal(id){
    const m = document.getElementById(id);
    if(!m) return;
    m.classList.remove('is-open');
    m.style.display = 'none';
  }
  // PERMANENT FIX: destroy modal from DOM so it's recreated clean on next open
  function _destroyModal(id){
    const m = document.getElementById(id);
    if(m) try{ m.remove(); }catch(_){}
  }

  function _populateCaseActionTargets(modal, ownerId){
    try{
      if(!modal) return;
      const sel = modal.querySelector('#mbxCaseActionReassign');
      if(!sel) return;
      const { table } = ensureShiftTables();
      const members = Array.isArray(table?.members) ? table.members : [];
      const options = members
        .filter(m=>m && String(m.id||'') && String(m.id||'') !== String(ownerId||''))
        .map(m=>{
          const id = String(m.id||'').trim();
          const name = String(m.name||m.username||id).trim() || id;
          return `<option value="${id.replace(/"/g,'&quot;')}">${name.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</option>`;
        })
        .join('');
      sel.innerHTML = `<option value="">Select member...</option>${options}`;
      sel.disabled = !options;
    }catch(_){ }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ensureCaseActionModalMounted — REBUILT (Enterprise-Grade Delete v2)
  //
  // ROOT CAUSE FIXES vs old implementation:
  //   FIX A) Reassign handler used `delCtx.shiftKey` — delCtx is ONLY defined
  //          inside the delete handler's closure. Caused silent ReferenceError
  //          that crashed modal setup. Fixed: use `ctx.shiftKey`.
  //   FIX B) Delete guard `!delCtx.assignmentId` silently blocked deletion when
  //          assignmentId was an empty string (locally-created assignments).
  //          Fixed: accept delete if caseNo+ownerId are present as fallback key.
  //   FIX C) Delete fired the API immediately — zero confirmation dialog.
  //          Fixed: full confirmation flow via UI.confirm() before any mutation.
  //
  // NEW Delete Flow (per product spec):
  //   1. User double-clicks case cell → Case Action modal opens
  //   2. User clicks "Delete Case" button
  //   3. Confirmation dialog: "Are you sure you want to delete Case #XXXXX?"
  //   4. User clicks YES → Case Action modal destroyed immediately
  //   5. Optimistic DOM removal: case cell yanked from table in real-time
  //   6. API call fires in background
  //   7. On success: store purge + scheduleRender + success toast (global)
  //   8. On API failure: scheduleRender restores cell + error toast
  // ═══════════════════════════════════════════════════════════════════════════════
  function ensureCaseActionModalMounted(){
    try{
      if(document.getElementById('mbxCaseActionModal')) return;

      const host = document.createElement('div');
      host.className = 'mbx-custom-backdrop';
      host.id = 'mbxCaseActionModal';
      host.innerHTML = `
        <div class="mbx-modal-glass" style="max-width:540px;">
          <div class="mbx-modal-head">
            <h3 style="color:#f8fafc; margin:0;">🧩 Case Action</h3>
            <button class="btn-glass btn-glass-ghost" type="button" id="mbxCaseActionCloseBtn">✕ Close</button>
          </div>
          <div class="mbx-modal-body">
            <div style="background:rgba(255,255,255,0.02); padding:12px; border-radius:8px; border:1px solid rgba(255,255,255,0.06); margin-bottom:12px;">
              <div style="font-size:12px; color:#94a3b8;">Case # <strong id="mbxCaseActionNo" style="color:#e2e8f0;">—</strong></div>
              <div style="font-size:12px; color:#94a3b8; margin-top:4px;">Current owner: <strong id="mbxCaseActionOwner" style="color:#38bdf8;">—</strong></div>
            </div>

            <!-- ACKNOWLEDGE: Shown only when current user is the assignee AND case is unconfirmed -->
            <div id="mbxCaseActionAckWrap" style="display:none; margin-bottom:10px;">
              <button id="mbxCaseActionAckBtn" class="btn-glass" type="button" style="width:100%; border-color:rgba(16,185,129,0.55); color:#6ee7b7; font-weight:800; font-size:13px; padding:11px 16px;">✓ Acknowledge Case</button>
            </div>

            <label style="display:block; font-size:11px; font-weight:800; color:#94a3b8; text-transform:uppercase; margin-bottom:6px;">Reassign to</label>
            <select id="mbxCaseActionReassign" class="mbx-input" style="margin-bottom:14px;"></select>

            <div style="display:flex; gap:10px;">
              <button id="mbxCaseActionReassignBtn" class="btn-glass btn-glass-primary" type="button" style="flex:1;">Reassign</button>
              <button id="mbxCaseActionDeleteBtn" class="btn-glass" type="button" style="flex:1; border-color:rgba(239,68,68,0.55); color:#fecaca;">🗑 Delete Case</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(host);

      // ── Close button: capture=true fires before global ui.js delegation ──
      const _closeBtn = host.querySelector('#mbxCaseActionCloseBtn');
      if(_closeBtn){
        _closeBtn.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          _caseActionCtx = null;
          _closeCustomModal('mbxCaseActionModal');
        }, true);
      }
      host.addEventListener('click', e=>{
        const t = e.target.closest('[data-close="mbxCaseActionModal"], #mbxCaseActionCloseBtn');
        if(t){
          e.preventDefault();
          e.stopPropagation();
          _caseActionCtx = null;
          _closeCustomModal('mbxCaseActionModal');
        }
      });

      // ── ACKNOWLEDGE HANDLER ─────────────────────────────────────────────
      // Allows the ASSIGNED USER to acknowledge their own case from within the
      // Mailbox page matrix. Calls POST /api/mailbox/confirm with the assignment ID.
      // The button is only visible when: current user === assigneeId AND confirmedAt=0.
      let _ackBusy = false;
      const ackBtn = host.querySelector('#mbxCaseActionAckBtn');
      if (ackBtn) {
        ackBtn.addEventListener('click', async () => {
          if (_ackBusy || _caseActionBusy || !_caseActionCtx?.assignmentId) return;
          const ctx = Object.assign({}, _caseActionCtx);
          try {
            _ackBusy = true;
            ackBtn.disabled = true;
            ackBtn.style.opacity = '0.6';
            ackBtn.textContent = '⏳ Acknowledging...';

            const { shiftKey: currentShiftKey } = ensureShiftTables();
            const shiftKey = String(ctx.shiftKey || currentShiftKey || '');

            const res = await fetch('/api/mailbox/confirm', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ..._mbxAuthHeader() },
              body: JSON.stringify({
                shiftKey,
                assignmentId: ctx.assignmentId,
                clientId: _mbxClientId()
              })
            });

            const rawText = await res.text().catch(() => '');
            if (!res.ok) throw new Error(rawText || `Server error ${res.status}`);

            // Destroy modal BEFORE parsing so errors don't leave it open
            _caseActionCtx = null;
            _destroyModal('mbxCaseActionModal');

            const data = (() => { try { return rawText ? JSON.parse(rawText) : {}; } catch (_) { return {}; } })();
            const Store = window.Store;
            if (Store && Store.saveMailboxTable && data && data.table) {
              Store.saveMailboxTable(shiftKey, data.table);
            }
            scheduleRender('case-ack-success');

            const UI = window.UI;
            if (UI && UI.showToast) UI.showToast(`✓ Case ${ctx.caseNo || ''} acknowledged`, 'success');
          } catch (e) {
            _ackBusy = false;
            ackBtn.disabled = false;
            ackBtn.style.opacity = '';
            ackBtn.textContent = '✓ Acknowledge Case';
            const UI = window.UI;
            if (UI && UI.showToast) UI.showToast(`Acknowledge failed: ${e.message}`, 'error');
            else alert(`Acknowledge failed: ${e.message}`);
          } finally {
            _ackBusy = false;
          }
        });
      }

      // ── REASSIGN HANDLER ─────────────────────────────────────────────────
      // FIX A applied: use ctx.shiftKey (NOT delCtx.shiftKey — delCtx lives
      // in a sibling closure scope, referencing it here was a ReferenceError).
      const reassignBtn = host.querySelector('#mbxCaseActionReassignBtn');
      if(reassignBtn){
        reassignBtn.addEventListener('click', async ()=>{
          if(_reassignBusy || _caseActionBusy || !_caseActionCtx?.assignmentId) return;
          const sel = host.querySelector('#mbxCaseActionReassign');
          const newAssigneeId = String(sel?.value||'').trim();
          if(!newAssigneeId){
            const UI = window.UI;
            if(UI && UI.showToast) UI.showToast('Please select a member to reassign to.','warn');
            else alert('Please select a new member for reassignment.');
            return;
          }

          // Snapshot context before async — prevents stale closure reference
          const ctx = Object.assign({}, _caseActionCtx);

          try{
            _reassignBusy = true;
            reassignBtn.disabled = true;
            reassignBtn.style.opacity = '0.6';
            reassignBtn.textContent = '⏳ Reassigning...';

            const { shiftKey: currentShiftKey } = ensureShiftTables();
            const shiftKey = String(ctx.shiftKey || currentShiftKey || ''); // FIX A: was delCtx.shiftKey
            const res = await fetch('/api/mailbox/case_action', {
              method:'POST',
              headers:{ 'Content-Type':'application/json', ..._mbxAuthHeader() },
              body: JSON.stringify({
                action: 'reassign',
                shiftKey,
                assignmentId: ctx.assignmentId,
                newAssigneeId,
                clientId: _mbxClientId()
              })
            });

            const rawText = await res.text().catch(()=>'');
            if(!res.ok) throw new Error(rawText || `Server error ${res.status}`);

            // Destroy modal BEFORE JSON.parse — parse errors must not leave modal open
            _caseActionCtx = null;
            _destroyModal('mbxCaseActionModal');

            const data = (()=>{ try{ return rawText ? JSON.parse(rawText) : {}; }catch(_){ return {}; } })();
            const Store = window.Store;
            if(Store && Store.saveMailboxTable && data && data.table) Store.saveMailboxTable(shiftKey, data.table);
            scheduleRender('case-reassign-success');

            const UI = window.UI;
            if(UI && UI.showToast) UI.showToast(`✓ Case ${ctx.caseNo || ''} reassigned successfully`, 'success');
          }catch(e){
            _reassignBusy = false;
            reassignBtn.disabled = false;
            reassignBtn.style.opacity = '';
            reassignBtn.textContent = 'Reassign';
            const UI = window.UI;
            if(UI && UI.showToast) UI.showToast(`Reassign failed: ${e.message}`, 'error');
            else alert(`Reassign failed: ${e.message}`);
          }finally{
            _reassignBusy = false;
          }
        });
      }

      // ── DELETE HANDLER — Enterprise-Grade v2 ─────────────────────────────
      const deleteBtn = host.querySelector('#mbxCaseActionDeleteBtn');
      if(deleteBtn){
        deleteBtn.addEventListener('click', async ()=>{
          if(_caseActionBusy || _reassignBusy) return;

          // Snapshot context immediately — stale reference prevention
          const delCtx = _caseActionCtx ? Object.assign({}, _caseActionCtx) : null;

          // FIX B: Accept delete by caseNo+ownerId even if assignmentId is empty
          // (handles locally-created assignments where id was never set server-side)
          const hasValidTarget = delCtx &&
            (String(delCtx.assignmentId||'').trim() ||
             (String(delCtx.caseNo||'').trim() && String(delCtx.ownerId||'').trim()));

          if(!hasValidTarget){
            const UI = window.UI;
            if(UI && UI.showToast) UI.showToast('No valid case target found for deletion.', 'warn');
            return;
          }

          // ── STEP 1: Confirmation Dialog (FIX C) ─────────────────────────
          // Show "Are you sure?" BEFORE any mutation or modal close
          const caseLabel = String(delCtx.caseNo || delCtx.assignmentId || '').trim();
          const UI = window.UI;
          let confirmed = false;

          if(UI && UI.confirm){
            confirmed = await UI.confirm({
              title:   'Delete Case',
              message: `Are you sure you want to delete Case #${caseLabel}?`,
              okText:  'Yes, Delete',
              danger:  true
            });
          } else {
            // Native fallback — non-blocking browsers still work
            confirmed = window.confirm(`Are you sure you want to delete Case #${caseLabel}?`);
          }

          if(!confirmed) return; // User cancelled — abort everything

          // ── STEP 2: Destroy Case Action Modal immediately after YES ──────
          _caseActionCtx = null;
          _destroyModal('mbxCaseActionModal');

          // ── STEP 3: Optimistic DOM Removal — real-time, zero flicker ────
          // Yank the cell from the matrix table instantly so the user sees
          // the deletion reflected immediately without waiting for re-render.
          try{
            const aid = String(delCtx.assignmentId || '').trim();
            const cno = String(delCtx.caseNo       || '').trim();
            const oid = String(delCtx.ownerId       || '').trim();

            if(root){
              let targetCell = null;

              // Primary lookup: by server assignment ID (most precise)
              if(aid){
                targetCell = root.querySelector(`[data-assignment-id="${CSS.escape(aid)}"]`);
              }
              // Fallback lookup: by caseNo + ownerId composite key
              if(!targetCell && cno && oid){
                targetCell = root.querySelector(
                  `[data-case-no="${CSS.escape(cno)}"][data-owner-id="${CSS.escape(oid)}"]`
                );
              }

              if(targetCell){
                const parentRow = targetCell.closest('tr');
                // Replace with blank cell to preserve table column geometry
                targetCell.outerHTML =
                  `<td style="border:1px solid rgba(255,255,255,0.02); background:transparent;"></td>`;

                // Remove the row entirely if all data cells are now empty
                if(parentRow){
                  const hasAnyBadge = parentRow.querySelector('.mbx-case-badge');
                  if(!hasAnyBadge) parentRow.remove();
                }
              }
            }
          }catch(_){ /* DOM removal is best-effort; re-render is the safety net */ }

          // ── STEP 4: API Call — persistent server delete ──────────────────
          try{
            _caseActionBusy = true;

            const { shiftKey: currentShiftKey } = ensureShiftTables();
            const shiftKey = String(delCtx.shiftKey || currentShiftKey || '');

            const res = await fetch('/api/mailbox/case_action', {
              method:  'POST',
              headers: { 'Content-Type': 'application/json', ..._mbxAuthHeader() },
              body:    JSON.stringify({
                action:       'delete',
                shiftKey,
                assignmentId: delCtx.assignmentId || '',
                caseNo:       delCtx.caseNo        || '',
                ownerId:      delCtx.ownerId        || '',
                clientId:     _mbxClientId()
              })
            });

            const rawText = await res.text().catch(()=>'');
            const data    = (()=>{ try{ return rawText ? JSON.parse(rawText) : {}; }catch(_){ return {}; } })();

            // CRITICAL: On ANY non-500 response (200, 404, 400), we perform the
            // local purge. Resurrection MUST be prevented even if the server ID
            // mismatch occurred (synthetic local_* / merged_* IDs before Realtime sync).
            //
            // 200 ok         → server confirmed delete; use server-returned table
            // 200 alreadyDeleted → already gone on server; local purge still needed
            // 404/400        → server could not match the ID; local purge is authoritative
            // 5xx            → true server error; do NOT purge (raise error to user)
            const isServerError = !res.ok && res.status >= 500;
            if(isServerError){
              throw new Error(
                (data && (data.error || data.message))
                  ? String(data.error || data.message)
                  : `Server error ${res.status}`
              );
            }

            // ── STEP 5: Store Purge — permanent local deletion ──────────────
            // Runs for all success AND benign-failure codes (200, 400, 404).
            const Store = window.Store;

            // Prefer server-confirmed table; if server couldn't match the ID,
            // fall back to local table (which we'll filter manually below).
            const ensured = ensureShiftTables();
            const table   = (data && data.table && Array.isArray(data.table.assignments))
              ? data.table
              : ensured.table;

            const delAid = String(delCtx.assignmentId || '').trim();
            const delCno = String(delCtx.caseNo        || '').trim().toLowerCase();
            const delOid = String(delCtx.ownerId        || '').trim();

            // Purge from table.assignments[] — dual-key filter (ID OR caseNo+owner)
            if(table && Array.isArray(table.assignments)){
              table.assignments = table.assignments.filter(a => {
                if(!a) return false;
                const aId  = String(a.id || a.assignmentId || '').trim();
                const aCno = String(a.caseNo                || '').trim().toLowerCase();
                if(delAid && aId === delAid) return false;
                if(delCno && aCno === delCno &&
                   String(a.assigneeId||'').trim() === delOid) return false;
                return true;
              });
            }

            // Purge from Store.getCases() (prevents notification resurrection)
            try{
              if(Store && Store.getCases && Store.saveCases){
                const allCases = Store.getCases() || [];
                const filtered = allCases.filter(c => {
                  if(!c || !c.caseNo) return true;
                  if(String(c.caseNo).trim().toLowerCase() === delCno &&
                     String(c.assigneeId||'').trim()         === delOid) return false;
                  return true;
                });
                if(filtered.length !== allCases.length) Store.saveCases(filtered);
              }
            }catch(_){}

            // Save updated table — WITHOUT fromRealtime:true so that onLocalWrite
            // fires → schedulePush(key, CLEAN_TABLE) → clearTimeout cancels any
            // stale debounced push that was queued with the OLD table (containing
            // the deleted case).  This is the root-cause fix for the resurrection
            // bug where the case reappeared ~300 ms after delete.
            if(Store && Store.saveMailboxTable){
              Store.saveMailboxTable(shiftKey, table);
            }

            // Purge related MAILBOX_ASSIGN / MAILBOX_REASSIGN notifications
            try{
              if(Store && Store.getNotifs && Store.saveNotifs){
                const _aId  = String(delCtx.assignmentId || '');
                const _cNo  = String(delCtx.caseNo        || '').trim().toLowerCase();
                const _list = Store.getNotifs() || [];
                const _kept = _list.filter(n => {
                  if(!n || !n.id) return false;
                  const nId = String(n.id);
                  if(_aId && nId === `mbx_assign_${_aId}`)             return false;
                  if(_aId && nId.startsWith(`mbx_reassign_${_aId}_`))  return false;
                  if(_aId && String(n.assignmentId || '') === _aId)     return false;
                  if(_cNo && n.caseNo &&
                     String(n.caseNo).trim().toLowerCase() === _cNo &&
                     (n.type === 'MAILBOX_ASSIGN' || n.type === 'MAILBOX_REASSIGN')) return false;
                  return true;
                });
                if(_kept.length !== _list.length) Store.saveNotifs(_kept);
              }
            }catch(_){}

            // Full re-render: syncs counters, column totals, and shift analytics
            scheduleRender('case-delete-success');

            if(UI && UI.showToast) UI.showToast(`✓ Case #${caseLabel} deleted successfully`, 'success');

          }catch(e){
            // Only true 5xx errors reach here — do NOT scheduleRender so the
            // optimistic DOM removal stays visible. Show an error toast instead.
            if(UI && UI.showToast) UI.showToast(`Delete failed: ${e.message}`, 'error');
            else alert(`Delete failed: ${e.message}`);
            // Force re-render so the table is consistent with current store state
            scheduleRender('case-delete-error');
          }finally{
            _caseActionBusy = false;
          }
        });
      }

    }catch(e){
      try{ console.warn('[MBX CaseAction] modal setup error:', e && e.message ? e.message : e); }catch(_){}
    }
  }

  function ensureAssignModalMounted(){
    try{
      if(document.getElementById('mbxAssignModal')) return;
      const UI = window.UI;
      const host = document.createElement('div');
      host.className = 'mbx-custom-backdrop'; 
      host.id = 'mbxAssignModal';
      host.innerHTML = `
        <div class="mbx-modal-glass">
          <div class="mbx-modal-head">
            <h3 style="color:#f8fafc; margin:0;">🎯 Route Case Assignment</h3>
            <button class="btn-glass btn-glass-ghost mbx-close-btn" type="button">✕ Cancel</button>
          </div>
          <div class="mbx-modal-body">
            <div style="background:rgba(255,255,255,0.02); padding:16px; border-radius:10px; border:1px solid rgba(255,255,255,0.05); display:grid; grid-template-columns:1fr 1fr; gap:16px;">
              <div>
                <label style="display:block; font-size:11px; font-weight:800; color:#94a3b8; text-transform:uppercase; margin-bottom:6px;">Receiving Agent</label>
                <input id="mbxAssignedTo" disabled class="mbx-input" style="font-weight:700;" />
              </div>
              <div>
                <label style="display:block; font-size:11px; font-weight:800; color:#94a3b8; text-transform:uppercase; margin-bottom:6px;">Time Block</label>
                <input id="mbxBucketLbl" disabled class="mbx-input" style="color:#38bdf8; font-weight:700;" />
              </div>
            </div>
            
            <div>
              <label style="display:block; font-size:11px; font-weight:800; color:#94a3b8; text-transform:uppercase; margin-bottom:6px;">Case Reference Number <span style="color:#ef4444">*</span></label>
              <input id="mbxCaseNo" placeholder="e.g. INC0001234" class="mbx-input" style="border:1px solid rgba(56,189,248,0.4); font-size:15px; font-weight:800;" />
            </div>
            <div>
              <label style="display:block; font-size:11px; font-weight:800; color:#94a3b8; text-transform:uppercase; margin-bottom:6px;">Short Description (Optional)</label>
              <input id="mbxDesc" placeholder="Context notes..." class="mbx-input" style="font-size:13px;" />
            </div>
            <div style="background:rgba(56,189,248,0.05); border:1px solid rgba(56,189,248,0.2); border-radius:8px; padding:12px; display:flex; align-items:center; gap:10px;">
              <div style="font-size:20px;">ℹ️</div>
              <div style="font-size:11px; color:#cbd5e1; line-height:1.5;">
                The agent will receive an instant notification and the case will appear in their <strong>Pending Actions</strong> panel. They must acknowledge it to complete the routing workflow.
              </div>
            </div>
            <div style="display:flex; gap:10px;">
              <button class="btn-glass btn-glass-ghost mbx-cancel-btn" type="button" style="flex:1;">Cancel</button>
              <button id="mbxAssignSubmit" class="btn-glass btn-glass-primary" type="button" style="flex:2;">Assign Case →</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(host);

      // FIXED BUG #2 & #3: Stop propagation on modal glass click + Direct button handlers
      const modalGlass = host.querySelector('.mbx-modal-glass');
      if(modalGlass){
        modalGlass.addEventListener('click', e => {
          e.stopPropagation(); // Prevent backdrop click from closing
        });
      }

      // FIXED BUG #3: Direct close button handlers (not delegation)
      const closeBtn = host.querySelector('.mbx-close-btn');
      const cancelBtn = host.querySelector('.mbx-cancel-btn');
      
      if(closeBtn){
        closeBtn.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          _closeCustomModal('mbxAssignModal');
        });
      }
      
      if(cancelBtn){
        cancelBtn.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          _closeCustomModal('mbxAssignModal');
        });
      }

      // FIXED BUG #1: Assignment submission handler
      const submitBtn = host.querySelector('#mbxAssignSubmit');
      if(submitBtn){
        submitBtn.addEventListener('click', async (e)=>{
          e.preventDefault();
          e.stopPropagation();
          
          if(_assignSending) return;
          const caseNo = (host.querySelector('#mbxCaseNo')?.value||'').trim();
          const desc = (host.querySelector('#mbxDesc')?.value||'').trim();
          if(!caseNo){ alert('Please enter a case number.'); return; }
          if(!_assignUserId){ alert('No agent selected.'); return; }

          try{
            _assignSending = true;
            submitBtn.disabled = true;
            submitBtn.textContent = 'Routing...';

            const {shiftKey, table} = ensureShiftTables();
            const activeBucket = computeActiveBucketId(table);
            if(!activeBucket){ alert('No active time block found.'); return; }

            const Store = window.Store;
            const users = (Store && Store.getUsers ? Store.getUsers() : []) || [];
            let targetUser = users.find(u=>u && String(u.id||'')=== String(_assignUserId||''));
            // MEMBER-ROLE FIX: Fallback to _rosterByTeam cache when Store.getUsers is restricted
            if (!targetUser) {
              const _duty = getDuty();
              const _tid = String(_duty && _duty.current && _duty.current.id ? _duty.current.id : '');
              const _roster = (_tid && _rosterByTeam && _rosterByTeam[_tid]) ? _rosterByTeam[_tid] : [];
              targetUser = _roster.find(u=>u && String(u.id||'')===String(_assignUserId||''));
            }
            const assigneeName = targetUser ? (targetUser.name||targetUser.username||_assignUserId) : _assignUserId;

            const payload = {
              shiftKey,
              assigneeId: _assignUserId,
              assigneeName,
              caseNo,
              desc,
              bucketId: activeBucket,
              assignedBy: (window.Auth && window.Auth.getUser) ? (window.Auth.getUser().id||'') : '',
              assignedAt: Date.now(),
              clientId: _mbxClientId()
            };

            const res = await fetch('/api/mailbox/assign', {
              method:'POST',
              headers:{ 'Content-Type':'application/json', ..._mbxAuthHeader() },
              body: JSON.stringify(payload)
            });

            if(!res.ok){
              const err = await res.text().catch(()=>'Network error');
              throw new Error(err);
            }

            const data = await res.json().catch(()=>({}));
            const assignment = data.assignment || { ...payload, id: `local_${Date.now()}` };

            if(!table.counts) table.counts = {};
            if(!table.counts[_assignUserId]) table.counts[_assignUserId] = {};
            table.counts[_assignUserId][activeBucket] = (Number(table.counts[_assignUserId][activeBucket])||0) + 1;
            if(!table.assignments) table.assignments = [];
            table.assignments.push(assignment);

            if(Store && Store.saveMailboxTable) Store.saveMailboxTable(shiftKey, table);

            _closeCustomModal('mbxAssignModal');
            scheduleRender('assign-success');

            const UI = window.UI;
            if(UI && UI.showToast) UI.showToast(`Case ${caseNo} assigned to ${assigneeName}`, 'success');

          }catch(e){
            alert(`Assignment failed: ${e.message}`);
          }finally{
            _assignSending = false;
            submitBtn.disabled = false;
            submitBtn.textContent = 'Assign Case →';
          }
        });
      }
    }catch(_){}
  }


  function attachAssignmentListeners(scopeRoot){
    try{
      const host = scopeRoot || root;
      if(!host) return;

      host.querySelectorAll('[data-assign-member]').forEach(row=>{
        row.addEventListener('click', e=>{
          if(e.target.closest('input, button, a')) return;
          const uid = String(row.getAttribute('data-assign-member')||'').trim();
          if(!uid) return;

          ensureAssignModalMounted();
          const modal = document.getElementById('mbxAssignModal');
          if(!modal) return;

          const {shiftKey, table} = ensureShiftTables();
          const activeBucket = computeActiveBucketId(table);
          const bucket = (table.buckets||[]).find(b=>b.id===activeBucket);
          // MEMBER-ROLE FIX: Also check _rosterByTeam cache for member name.
          // table.members may be sparse for MEMBER-role sessions (restricted Store.getUsers).
          let member = (table.members||[]).find(m=>String(m.id||'')===uid);
          if (!member) {
            const _mTid = String(table?.meta?.teamId || '');
            const _mRoster = (_mTid && _rosterByTeam && _rosterByTeam[_mTid]) ? _rosterByTeam[_mTid] : [];
            member = _mRoster.find(m=>String(m.id||'')===uid);
          }

          const assignedToInput = modal.querySelector('#mbxAssignedTo');
          const bucketLblInput = modal.querySelector('#mbxBucketLbl');
          const caseNoInput = modal.querySelector('#mbxCaseNo');
          const descInput = modal.querySelector('#mbxDesc');

          if(assignedToInput) assignedToInput.value = member ? (member.name||member.username||uid) : uid;
          if(bucketLblInput) bucketLblInput.value = bucket ? _mbxBucketLabel(bucket) : '—';
          if(caseNoInput) caseNoInput.value = '';
          if(descInput) descInput.value = '';

          _assignUserId = uid;
          _openCustomModal('mbxAssignModal');
        });
      });

      host.querySelectorAll('[data-case-action="1"]').forEach(cell=>{
        cell.addEventListener('dblclick', ()=>{
          const { shiftKey } = ensureShiftTables();
          ensureCaseActionModalMounted();
          const modal = document.getElementById('mbxCaseActionModal');
          if(!modal) return;

          _caseActionCtx = {
            assignmentId: cell.getAttribute('data-assignment-id')||'',
            caseNo: cell.getAttribute('data-case-no')||'',
            ownerId: cell.getAttribute('data-owner-id')||'',
            ownerName: cell.getAttribute('data-owner-name')||'',
            shiftKey: shiftKey
          };

          const noSpan = modal.querySelector('#mbxCaseActionNo');
          const ownerSpan = modal.querySelector('#mbxCaseActionOwner');
          if(noSpan) noSpan.textContent = _caseActionCtx.caseNo;
          if(ownerSpan) ownerSpan.textContent = _caseActionCtx.ownerName;
          _populateCaseActionTargets(modal, _caseActionCtx.ownerId);

          // ACKNOWLEDGE FEATURE: Show/hide ack button based on ownership + status
          // The button appears ONLY when the current user IS the assignee AND the
          // case is still pending (confirmedAt === 0). This lets the assignee
          // acknowledge their case directly from the Mailbox Matrix.
          try {
            const confirmedAt = Number(cell.getAttribute('data-confirmed-at') || 0);
            const currentUserId = String((window.Auth && window.Auth.getUser ? window.Auth.getUser() : {}).id || '').trim();
            const isMyCase = !!(currentUserId && _caseActionCtx.ownerId === currentUserId);
            const ackWrap = modal.querySelector('#mbxCaseActionAckWrap');
            if (ackWrap) ackWrap.style.display = (isMyCase && !confirmedAt) ? '' : 'none';
            // Reset ack button state on each open
            const ackBtnEl = modal.querySelector('#mbxCaseActionAckBtn');
            if (ackBtnEl) { ackBtnEl.disabled = false; ackBtnEl.style.opacity = ''; ackBtnEl.textContent = '✓ Acknowledge Case'; }
          } catch (_) {}

          _openCustomModal('mbxCaseActionModal');
        });
      });


    }catch(_){}
  }

  // --- RENDERING ORCHESTRATOR ---

  let _renderPending = false;
  let _renderTimer = null;

  function scheduleRender(reason){
    if(_renderPending) return;
    _renderPending = true;
    clearTimeout(_renderTimer);
    _renderTimer = setTimeout(()=>{ render(); _renderPending = false; }, 100);
  }

  function render(){
    try{
      if(!root || !isMailboxRouteActive()) return;

      // MAILBOX STATUS GATE: if disabled, show notice instead of normal UI
      if (_mailboxEnabled === false) {
        _renderMailboxDisabled();
        return;
      }
      const duty = getDuty();
      const {shiftKey, table, state} = ensureShiftTables();
      const activeBucketId = computeActiveBucketId(table);
      const totals = computeTotals(table);
      const prevTable = state.previousKey ? (window.Store && Store.getMailboxTable ? Store.getMailboxTable(state.previousKey) : null) : null;

      const canAssign = canAssignNow({ duty });
      isManager = canAssign;

      const UI = window.UI;
      const esc = UI ? UI.esc : (s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'));

      const currentLabel = duty.current?.label || '—';
      const nextLabel = duty.next?.label || '—';
      const secLeft = Number(duty.secLeft)||0;
      const timerDisplay = (UI && UI.formatDuration) ? UI.formatDuration(secLeft) : `${secLeft}s`;

      const showArchive = window.__mbxUiState?.showArchive || false;
      const showAnalytics = window.__mbxUiState?.showAnalytics || false;

      ensureEnterpriseMailboxStyles();

      // BOSS THUNTER: Auto-trigger roster sync for MEMBER-role users on first render.
      // OVERRIDE FIX: Also re-sync when active team changes due to time override
      // (e.g. override switches from Morning to Mid Shift — Mid roster may not be cached).
      const teamId = String(table?.meta?.teamId || '');
      // LOOP-GUARD: skip sync if within cooldown window after a failed fetch
      const _inCooldown = _syncCooldown && _syncCooldown[teamId] && Date.now() < _syncCooldown[teamId];
      if (teamId && !_schedSyncPending && !(_scheduleReady && _scheduleReady[teamId]) && !_inCooldown) {
        _schedSyncPending = true;
        _mbxSyncTeamScheduleBlocks(teamId).catch(() => {});
      }

      const isFullscreen = window.__mbxUiState.isFullscreen || false;
      const condFmtOn    = window.__mbxUiState.condFormatEnabled !== false;

      // OVERRIDE BANNER: Compute override state for banner display.
      // Uses UI.mailboxTimeInfo() which reads cloud localStorage — always fresh.
      const _overrideInfo = (UI && UI.mailboxTimeInfo) ? UI.mailboxTimeInfo() : null;
      const _overrideActive = !!(_overrideInfo && _overrideInfo.overrideEnabled);
      const _overrideFreeze = _overrideActive ? (_overrideInfo.freeze !== false) : true;
      const _overrideEffMs  = _overrideActive ? (Number(_overrideInfo.effectiveMs)||0) : 0;
      const _overrideInitTime = (() => {
        if (!_overrideActive || !_overrideEffMs) return '--:--:--';
        try {
          const p = UI.manilaParts(new Date(_overrideEffMs));
          return `${String(p.hh).padStart(2,'0')}:${String(p.mm).padStart(2,'0')}:${String(p.ss).padStart(2,'0')}`;
        } catch(_) { return '--:--:--'; }
      })();
      const _overrideBaseDate = (() => {
        if (!_overrideActive || !_overrideEffMs) return '';
        try {
          const p = UI.manilaParts(new Date(_overrideInfo.baseMs || _overrideEffMs));
          return p.isoDate + ' (Asia/Manila)';
        } catch(_) { return ''; }
      })();

      root.innerHTML = `
        <div class="mbx-shell${isFullscreen ? ' is-fullscreen' : ''}">
          <div class="mbx-header-bar">
            <h1 class="mbx-main-title"> Mailbox Control Center</h1>
            <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; position:relative;">
              <button class="btn-glass btn-glass-ghost" data-toggle-analytics>📊 ${showAnalytics?'Hide':'Show'} Analytics</button>
              <button class="btn-glass btn-glass-ghost" data-toggle-archive>📂 ${showArchive?'Hide':'Show'} Case Matrix</button>
              <button class="mbx-fs-btn${isFullscreen ? ' active' : ''}" data-toggle-fullscreen title="${isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;">
                  ${isFullscreen
                    ? '<path d="M5 1v4H1M9 1v4h4M5 13v-4H1M9 13v-4h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
                    : '<path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'}
                </svg>
                ${isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
              </button>
              <div style="position:relative;">
                <button class="mbx-gear-btn" data-toggle-settings title="Mailbox Settings">
                  <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M7.5 9.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" stroke="currentColor" stroke-width="1.4"/>
                    <path d="M12.2 9a1 1 0 0 0 .2 1.1l.04.04a1.2 1.2 0 0 1-1.7 1.7l-.04-.04a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.92V12.5a1.2 1.2 0 0 1-2.4 0v-.06A1 1 0 0 0 6 11.5a1 1 0 0 0-1.1.2l-.04.04a1.2 1.2 0 0 1-1.7-1.7l.04-.04A1 1 0 0 0 3.4 9a1 1 0 0 0-.92-.6H2.4a1.2 1.2 0 0 1 0-2.4h.06A1 1 0 0 0 3.4 5.4a1 1 0 0 0-.2-1.1l-.04-.04a1.2 1.2 0 0 1 1.7-1.7l.04.04A1 1 0 0 0 6 2.8a1 1 0 0 0 .6-.92V1.8a1.2 1.2 0 0 1 2.4 0v.06A1 1 0 0 0 9.6 2.8a1 1 0 0 0 1.1-.2l.04-.04a1.2 1.2 0 0 1 1.7 1.7l-.04.04A1 1 0 0 0 12.2 6a1 1 0 0 0 .92.6h.08a1.2 1.2 0 0 1 0 2.4h-.06A1 1 0 0 0 12.2 9Z" stroke="currentColor" stroke-width="1.4"/>
                  </svg>
                </button>
                <div class="mbx-settings-panel" id="mbx-settings-panel">
                  <div class="mbx-settings-title">Mailbox Settings</div>

                  <div class="mbx-settings-row">
                    <div class="mbx-settings-row-label">
                      <strong>Conditional Formatting</strong>
                      <span>Auto-color count badges based on relative assignment load</span>
                    </div>
                    <label class="mbx-toggle">
                      <input type="checkbox" id="mbx-cf-toggle" ${condFmtOn ? 'checked' : ''}>
                      <div class="mbx-toggle-track"></div>
                      <div class="mbx-toggle-thumb"></div>
                    </label>
                  </div>

                  <div class="mbx-cf-legend">
                    <div class="mbx-cf-swatch"><div class="mbx-cf-dot gray">0</div> Zero / lowest</div>
                    <div class="mbx-cf-swatch"><div class="mbx-cf-dot orange">1</div> Sole highest</div>
                    <div class="mbx-cf-swatch"><div class="mbx-cf-dot blue">1</div> Tied highest</div>
                    <div class="mbx-cf-swatch"><div class="mbx-cf-dot red">2</div> Above tied</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="mbx-summary-grid">
            <div class="mbx-stat-box">
              <div class="mbx-stat-lbl">Active Duty Window</div>
              <div class="mbx-stat-val">${esc(currentLabel)}</div>
              <div class="mbx-stat-sub">Next: ${esc(nextLabel)}</div>
            </div>
            <div class="mbx-stat-box">
              <div class="mbx-stat-lbl">Time Until Rotation</div>
              <div class="mbx-stat-val timer-display" data-timer="1">${esc(timerDisplay)}</div>
              <div class="mbx-stat-sub">Auto-switch enabled</div>
            </div>
            <div class="mbx-stat-box">
              <div class="mbx-stat-lbl">Shift Total Assignments</div>
              <div class="mbx-stat-val">${totals.shiftTotal||0}</div>
              <div class="mbx-stat-sub">Distributed across ${(table.members||[]).length} agents</div>
            </div>
          </div>

          ${_overrideActive ? `
          <div class="mbx-override-banner" style="display:flex;align-items:center;gap:10px;padding:10px 16px;margin:0 0 2px 0;background:rgba(245,158,11,0.10);border:1.5px solid rgba(245,158,11,0.40);border-radius:10px;flex-wrap:wrap;">
            <span class="override-label" style="flex-shrink:0;">⏱ GLOBAL TIME OVERRIDE ACTIVE</span>
            <span class="mbx-override-clock" data-override-clock="1" style="font-variant-numeric:tabular-nums;font-family:'Courier New',monospace;font-size:20px;font-weight:800;color:#f59e0b;letter-spacing:0.05em;flex-shrink:0;">${_overrideInitTime}</span>
            <span style="font-size:11px;color:var(--text-muted,#94a3b8);flex-shrink:0;">${_overrideBaseDate}</span>
            <span style="font-size:11px;padding:2px 8px;border-radius:999px;background:rgba(245,158,11,0.18);color:#f59e0b;font-weight:700;flex-shrink:0;">${_overrideFreeze ? '❄ FROZEN' : '▶ RUNNING'}</span>
          </div>
          ` : ''}

          <div class="mbx-counter-wrap">
            ${renderTable(table, activeBucketId, totals, canAssign)}
          </div>

          ${showAnalytics ? `
            <div class="mbx-analytics-panel">
              <div class="mbx-panel-head">
                <div>
                  <h3 class="mbx-panel-title">📈 Live Performance Insights</h3>
                  <div class="mbx-panel-desc">Real-time shift metrics and agent distribution analytics</div>
                </div>
              </div>
              ${renderMailboxAnalyticsPanel(table, prevTable, totals, activeBucketId)}
            </div>
          ` : ''}

          ${showArchive ? `
            <div class="mbx-analytics-panel">
              <div class="mbx-panel-head">
                <div>
                  <h3 class="mbx-panel-title">🗂️ Case Assignment Matrix (Live Monitor)</h3>
                  <div class="mbx-panel-desc">Chronological assignment tracker with acknowledgment status. Double-click any case for actions.</div>
                </div>
              </div>
              <div class="mbx-monitor-panel">
                ${renderCaseMonitoring(table, shiftKey)}
              </div>
            </div>
          ` : ''}
        </div>
      `;

      attachAssignmentListeners(root);

      root.querySelectorAll('[data-toggle-analytics]').forEach(btn=>{
        btn.addEventListener('click', ()=>{
          window.__mbxUiState.showAnalytics = !window.__mbxUiState.showAnalytics;
          scheduleRender('toggle-analytics');
        });
      });

      root.querySelectorAll('[data-toggle-archive]').forEach(btn=>{
        btn.addEventListener('click', ()=>{
          window.__mbxUiState.showArchive = !window.__mbxUiState.showArchive;
          scheduleRender('toggle-archive');
        });
      });

      // ── Fullscreen toggle ──────────────────────────────────────────────────
      root.querySelectorAll('[data-toggle-fullscreen]').forEach(btn => {
        btn.addEventListener('click', () => {
          window.__mbxUiState.isFullscreen = !window.__mbxUiState.isFullscreen;
          scheduleRender('toggle-fullscreen');
        });
      });

      // ── Gear settings panel toggle ─────────────────────────────────────────
      const gearBtn    = root.querySelector('.mbx-gear-btn');
      const settingsPanel = root.querySelector('#mbx-settings-panel');
      if (gearBtn && settingsPanel) {
        gearBtn.addEventListener('click', e => {
          e.stopPropagation();
          settingsPanel.classList.toggle('open');
          gearBtn.classList.toggle('panel-open', settingsPanel.classList.contains('open'));
        });
        // LEAK FIX: Remove old listener before adding new one.
        // render() can be called many times (debounced but frequent). Without
        // removing the old listener, every render stacks a new document-level
        // click handler → hundreds of listeners → performance degradation.
        if (window.__mbxPanelCloseListener) {
          document.removeEventListener('click', window.__mbxPanelCloseListener);
        }
        window.__mbxPanelCloseListener = function(e) {
          if (settingsPanel && gearBtn) {
            if (!settingsPanel.contains(e.target) && e.target !== gearBtn) {
              settingsPanel.classList.remove('open');
              gearBtn.classList.remove('panel-open');
            }
          }
        };
        document.addEventListener('click', window.__mbxPanelCloseListener);
      }

      // ── Conditional formatting toggle ──────────────────────────────────────
      const cfToggle = root.querySelector('#mbx-cf-toggle');
      if (cfToggle) {
        cfToggle.addEventListener('change', () => {
          window.__mbxUiState.condFormatEnabled = cfToggle.checked;
          scheduleRender('cf-toggle');
        });
      }

      // ── Row tooltip ────────────────────────────────────────────────────────
      (function attachRowTooltip() {
        // Create singleton tooltip element
        let tt = document.getElementById('mbx-row-tooltip');
        if (!tt) {
          tt = document.createElement('div');
          tt.id = 'mbx-row-tooltip';
          tt.className = 'mbx-row-tooltip';
          document.body.appendChild(tt);
        }

        const counterWrap = root.querySelector('.mbx-counter-wrap');
        if (!counterWrap) return;

        let currentRow = null;

        counterWrap.addEventListener('mouseover', e => {
          const row = e.target.closest('tr[data-mbx-member-name]');
          if (!row || row === currentRow) return;
          currentRow = row;
          const name = row.getAttribute('data-mbx-member-name') || '';
          if (!name) return;
          tt.textContent = name;
          tt.classList.add('visible');
        });

        counterWrap.addEventListener('mousemove', e => {
          if (!currentRow) return;
          const offset = 14;
          let x = e.clientX + offset;
          let y = e.clientY - 36;
          // Keep inside viewport
          const rect = tt.getBoundingClientRect();
          if (x + rect.width > window.innerWidth - 8) x = e.clientX - rect.width - offset;
          if (y < 8) y = e.clientY + offset;
          tt.style.left = x + 'px';
          tt.style.top  = y + 'px';
        });

        counterWrap.addEventListener('mouseout', e => {
          const row = e.target.closest('tr[data-mbx-member-name]');
          if (!row) return;
          const related = e.relatedTarget ? e.relatedTarget.closest('tr[data-mbx-member-name]') : null;
          if (related !== row) {
            currentRow = null;
            tt.classList.remove('visible');
          }
        });

        // DEDUP FIX: Removed duplicate mouseover listener (was firing twice per hover)
      })();

      refreshMemberDutyPills(root);

    }catch(e){
      console.error('[MAILBOX] Render crash:', e);
      if(root) root.innerHTML = `<div style="padding:40px; text-align:center; color:#ef4444;">⚠️ Render Error: ${String(e.message||e)}</div>`;
    }
  }

  // --- REALTIME LOOPS ---

  let _timerInterval = null;
  let _dutyPillInterval = null;

  function startRealtimeTimers(){
    clearInterval(_timerInterval);
    _timerInterval = setInterval(()=>{
      if(!root || !isMailboxRouteActive()) return;
      try{
        root.querySelectorAll('[data-timer="1"]').forEach(node=>{
          const duty = getDuty();
          const sec = Number(duty.secLeft)||0;
          const UI = window.UI;
          node.textContent = (UI && UI.formatDuration) ? UI.formatDuration(sec) : `${sec}s`;
        });

        // OVERRIDE CLOCK TICK: Update the override time display every second without full re-render.
        root.querySelectorAll('[data-override-clock="1"]').forEach(node=>{
          try{
            const oi = (window.UI && UI.mailboxTimeInfo) ? UI.mailboxTimeInfo() : null;
            if(!oi || !oi.overrideEnabled){ node.textContent = '--:--:--'; return; }
            const p = UI.manilaParts(new Date(oi.effectiveMs));
            node.textContent = `${String(p.hh).padStart(2,'0')}:${String(p.mm).padStart(2,'0')}:${String(p.ss).padStart(2,'0')}`;
          }catch(_){}
        });

        root.querySelectorAll('[data-assign-at]').forEach(node=>{
          const at = Number(node.getAttribute('data-assign-at'))||0;
          if(!at) return;
          const sec = Math.floor(Math.max(0, Date.now() - at) / 1000);
          const UI = window.UI;
          const dur = (UI && UI.formatDuration) ? UI.formatDuration(sec) : `${sec}s`;
          node.title = `Pending Acknowledgment (${dur})`;
        });
      }catch(_){}
    }, 1000);

    clearInterval(_dutyPillInterval);
    _dutyPillInterval = setInterval(()=>{
      if(!root || !isMailboxRouteActive()) return;
      refreshMemberDutyPills(root);
    }, 1000);

    // PERF OPT: Periodic schedule re-sync increased from 60s → 90s.
    // The 60s interval was causing noticeable API load per active tab.
    // Supabase Realtime + mums:store listeners handle instant updates;
    // this poll is a fallback for missed events only.
    clearInterval(_periodicSyncTimer);
    _periodicSyncTimer = setInterval(()=>{
      if(!root || !isMailboxRouteActive()) return;
      _mbxForceResync('periodic-90s');
    }, 90000);
  }

  function stopRealtimeTimers(){
    clearInterval(_timerInterval);
    clearInterval(_dutyPillInterval);
    clearInterval(_periodicSyncTimer);
    _periodicSyncTimer = null;
    // BUG FIX v4.1: Reset _mailboxEnabled to null so when _mountMailboxNormal() is
    // called on re-enable, render() sees a clean state and doesn't short-circuit
    // based on a stale disabled=false value from before the last status change.
    _mailboxEnabled = null;
    // Remove singleton tooltip on nav-away
    const tt = document.getElementById('mbx-row-tooltip');
    if (tt) { tt.classList.remove('visible'); }
    // Exit fullscreen state on nav-away
    if (window.__mbxUiState) window.__mbxUiState.isFullscreen = false;
  }

  // --- LIFECYCLE ---

  // ── MAILBOX STATUS LISTENER ──────────────────────────────────────────────
  // BUG FIX v4.1: Listener MUST be registered in mount() BEFORE the status
  // check — not inside _mountMailboxNormal(). When the mailbox page first loads
  // while ALREADY disabled, _mountMailboxNormal() is never called so its internal
  // mums_mailbox_status handler was never bound. This meant toggling ON from
  // Settings had no effect on the already-rendered disabled page.
  //
  // Additionally, the re-enable path now calls stopRealtimeTimers() +
  // _mountMailboxNormal() (full remount) instead of scheduleRender() so that
  // ALL timers and Supabase sync restart correctly when SA re-enables.
  //
  // _mbxStatusListenerBound guards against duplicate listeners if mount() is
  // ever called more than once on the same page instance.
  let _mbxStatusListenerBound = false;

  function _registerMailboxStatusListener() {
    if (_mbxStatusListenerBound) return;
    _mbxStatusListenerBound = true;

    window.addEventListener('mums:store', (e) => {
      try {
        const k = e && e.detail && e.detail.key;
        if (k !== 'mums_mailbox_status') return;

        // Re-fetch authoritative status from server (not just the event payload).
        // The event payload only carries { disabled } from the Settings panel broadcast;
        // re-fetching ensures the page always reflects the persisted Supabase value.
        _mbxLoadStatus().then(() => {
          if (_mailboxEnabled === false) {
            // ── DISABLE PATH ─────────────────────────────────────────────
            // Stop all timers, cancel periodic syncs, and show the disabled banner.
            // _mbxSyncTeamScheduleBlocks already checks _mailboxEnabled===false at its
            // top so any in-flight setTimeout callbacks are safely no-ops.
            stopRealtimeTimers();
            _renderMailboxDisabled();
          } else {
            // ── RE-ENABLE PATH ───────────────────────────────────────────
            // Full remount: stop any stale timers first (defensive), then boot the
            // mailbox normally so timers, Supabase sync, and socket listeners all
            // restart from a clean state. scheduleRender() alone was insufficient
            // because it only re-renders HTML — it does NOT restart the timer loop
            // or _mbxSyncTeamScheduleBlocks.
            stopRealtimeTimers();
            _mountMailboxNormal();
          }
        }).catch(() => {
          // If status re-fetch fails, fail open: show mailbox normally.
          stopRealtimeTimers();
          _mountMailboxNormal();
        });
      } catch (_) {}
    });
  }

  function mount(){
    // ── MAILBOX STATUS GATE: check if mailbox is disabled before doing ANYTHING ──
    // Register the status listener FIRST so that any Settings toggle that fires
    // while the page is open (including when currently disabled) is always caught.
    _registerMailboxStatusListener();

    // Fetch status. If disabled → show notice, stop here (no timers, no Supabase calls).
    // If enabled (or status fetch fails) → proceed with normal boot sequence.
    _mbxLoadStatus().then(() => {
      if (_mailboxEnabled === false) {
        // Mailbox is disabled — render notice and do NOT start any timers or network requests
        _renderMailboxDisabled();
        return;
      }
      // Mailbox is enabled — proceed with full boot
      _mountMailboxNormal();
    }).catch(() => {
      // On any error loading status, fail open (show mailbox normally)
      _mountMailboxNormal();
    });
  }

  function _mountMailboxNormal(){
    render();
    startRealtimeTimers();

    // REALTIME ALL-USER FIX: Immediately sync schedule blocks on mount for ALL roles.
    // This ensures MEMBERs (who have restricted Store.getUsers()) get full roster data
    // within seconds of opening the Mailbox page, without waiting for the first render cycle.
    // ROSTER FIX: Also prefetch ALL shift teams (morning/mid/night) so when the shift
    // rotates, the incoming team's roster is already cached — no lag, no empty member list.
    try{
      const duty = getDuty();
      const bootTid = duty && duty.current && duty.current.id ? String(duty.current.id) : '';
      if(bootTid && !_scheduleReady[bootTid]){
        _schedSyncPending = true;
        _mbxSyncTeamScheduleBlocks(bootTid).catch(()=>{});
      }
      // Prefetch other shift teams in background (staggered to avoid request storms)
      const Config = window.Config;
      const allTeams = (Config && Array.isArray(Config.TEAMS)) ? Config.TEAMS : [];
      let delay = 2000;
      for(const t of allTeams){
        const tid = String(t.id || '');
        if(!tid || tid === bootTid || _scheduleReady[tid]) continue;
        ((teamId, ms)=>{ setTimeout(()=>{ _mbxSyncTeamScheduleBlocks(teamId).catch(()=>{}); }, ms); })(tid, delay);
        delay += 2000; // stagger each team fetch by 2s
      }
    }catch(_){}

    if(window.CloudSocket && window.CloudSocket.on){
      window.CloudSocket.on('mailbox:update', ()=>scheduleRender('socket-update'));
      window.CloudSocket.on('mailbox:assign', ()=>scheduleRender('socket-assign'));
      window.CloudSocket.on('mailbox:confirm', ()=>{
        // Instantly patch confirmed cells without waiting for full re-render
        _patchConfirmedCells();
        scheduleRender('socket-confirm');
      });
    }

    // ── Instant in-place DOM patch for confirmed cells ──────────────────────
    // Updates ⏳→✓ on the matrix immediately when store changes.
    //
    // BUG 1 FIX: Dual-lookup strategy prevents silent failures:
    //   Primary:  data-assignment-id vs byId (mbx_srv_... IDs from table.assignments)
    //   Fallback: data-case-no + data-owner-id vs byCaseOwner (handles ums_cases IDs)
    // scheduleRender is called after any patch so counters stay consistent.
    function _patchConfirmedCells() {
      try {
        const Store = window.Store;
        const state = Store && Store.getMailboxState ? Store.getMailboxState() : {};
        const curKey = state.currentKey;
        if (!curKey) return;
        const table = Store && Store.getMailboxTable ? Store.getMailboxTable(curKey) : null;
        if (!table || !Array.isArray(table.assignments)) return;

        // Build DUAL lookup maps for robust matching across all ID formats
        const byId = {};          // server assignment ID → assignment
        const byCaseOwner = {};   // "assigneeId|caseNo_lower" → assignment (fallback)
        table.assignments.forEach(a => {
          if (!a) return;
          if (a.id) byId[String(a.id)] = a;
          if (a.assigneeId && a.caseNo) {
            const ck = String(a.assigneeId).trim() + '|' + String(a.caseNo).trim().toLowerCase();
            // Keep entry with the highest confirmedAt (most recent confirmation wins)
            if (!byCaseOwner[ck] || Number(a.confirmedAt || 0) > Number(byCaseOwner[ck].confirmedAt || 0)) {
              byCaseOwner[ck] = a;
            }
          }
        });

        let patched = false;
        root.querySelectorAll('[data-assignment-id]').forEach(cell => {
          const aid     = String(cell.getAttribute('data-assignment-id') || '').trim();
          const caseNo  = String(cell.getAttribute('data-case-no')       || '').trim();
          const ownerId = String(cell.getAttribute('data-owner-id')      || '').trim();

          // Primary lookup: by server assignment ID
          let a = aid ? byId[aid] : null;

          // Fallback: by assigneeId|caseNo (handles ums_cases-sourced IDs like mbx_<caseNo>)
          if (!a && ownerId && caseNo) {
            const ck = ownerId + '|' + caseNo.toLowerCase();
            const candidate = byCaseOwner[ck];
            if (candidate && Number(candidate.confirmedAt || 0) > 0) a = candidate;
          }

          if (!a) return;
          const isConfirmed = Number(a.confirmedAt || 0) > 0;
          if (!isConfirmed) return;

          // Already showing confirmed state? Skip (idempotent)
          if (cell.classList.contains('confirmed')) return;

          // ── Patch cell to confirmed state in-place ──────────────────────────
          cell.classList.add('confirmed');
          cell.style.background = 'rgba(16,185,129,0.05)';
          cell.style.transition  = 'background 0.3s';

          const badge = cell.querySelector('.mbx-case-badge');
          if (badge) {
            badge.classList.remove('glow');
            badge.style.borderColor = 'rgba(16,185,129,0.35)';
            badge.style.boxShadow   = '0 0 8px rgba(16,185,129,0.12)';
          }

          // Replace ⏳ spinner with green ✓ check
          const waitIcon = cell.querySelector('.mbx-stat-wait');
          if (waitIcon) {
            waitIcon.outerHTML = '<span class="mbx-stat-done" title="Acknowledged" style="color:#34d399;font-weight:900;font-size:15px;">✓</span>';
          }
          patched = true;
        });

        // After a successful in-place patch, queue a full re-render so the counter
        // table, Overall column, and shift totals all reflect the confirmed state.
        if (patched) scheduleRender('patch-confirm-rerender');

      } catch (_) {}
    }

    // BUG 1 FIX: Trigger BOTH _patchConfirmedCells (instant visual) AND scheduleRender
    // (full consistency) whenever mums_mailbox_tables changes in the store.
    // This covers: same-tab ACCEPT, cross-tab localStorage events, Supabase Realtime push,
    // and the 8-second polling fallback — all paths now update the matrix icon without refresh.
    window.addEventListener('mums:store', (e) => {
      try {
        const k = e && e.detail && e.detail.key;
        const src = e && e.detail && e.detail.source;
        if (k === 'mums_mailbox_tables') {
          _patchConfirmedCells();

          // CASE MATRIX ALL-USER FIX: When a remote mailbox_tables push arrives
          // (source='realtime' or 'storage' = cross-tab), augment the received table's
          // member list from the local _rosterByTeam cache BEFORE rendering.
          // This ensures MEMBERs see the full team in the Case Assignment Matrix
          // even when the pushed table was built by a SA with a different getUsers() scope.
          if(src === 'realtime' || src === 'storage'){
            try{
              const Store = window.Store;
              const UI    = window.UI;
              if(Store && Store.getMailboxState && Store.getMailboxTable && Store.saveMailboxTable){
                const curKey = Store.getMailboxState().currentKey;
                if(curKey){
                  const t = Store.getMailboxTable(curKey);
                  if(t && t.meta){
                    const tid = String(t.meta.teamId || '');
                    const rosterList = (tid && _rosterByTeam && _rosterByTeam[tid]) ? _rosterByTeam[tid] : [];
                    if(rosterList.length){
                      const nowP = UI && UI.mailboxNowParts ? UI.mailboxNowParts() : null;
                      const existIds = new Set((t.members || []).map(m => m && String(m.id)));
                      let added = false;
                      for(const tm of rosterList){
                        if(!tm || !tm.id || existIds.has(String(tm.id))) continue;
                        existIds.add(String(tm.id));
                        t.members = t.members || [];
                        t.members.push({
                          id:        String(tm.id),
                          name:      String(tm.name || tm.username || tm.id),
                          username:  String(tm.username || tm.name || tm.id),
                          role:      String(tm.role || 'MEMBER'),
                          roleLabel: _mbxRoleLabel(tm.role || ''),
                          dutyLabel: _mbxDutyLabelForUser({id:String(tm.id),teamId:tid}, nowP)
                        });
                        added = true;
                      }
                      // Sort and re-save silently (no new cloud push, just local augment)
                      if(added){
                        t.members.sort((a,b)=>{
                          const ak=_mbxMemberSortKey(a),bk=_mbxMemberSortKey(b);
                          if(ak.w!==bk.w) return ak.w-bk.w;
                          return ak.name.localeCompare(bk.name);
                        });
                        Store.saveMailboxTable(curKey, t, {silent:true});
                      }
                    }
                    // If roster is empty (first load), trigger a fetch to populate it
                    // LOOP-GUARD: Skip if we're in a cooldown window (recent fetch failure).
                    // Without this guard, every Realtime push would clear the cooldown and
                    // re-trigger a fetch immediately after failure → infinite loop.
                    const _noRosterCooldown = _syncCooldown && _syncCooldown[tid] && Date.now() < _syncCooldown[tid];
                    if(!rosterList.length && tid && !_noRosterCooldown){
                      _mbxForceResync('remote-table-no-roster');
                    }
                  }
                }
              }
            }catch(_){}
          }

          scheduleRender('store-mailbox-update');
        }
        // OVERRIDE FIX: Re-render immediately when global mailbox override is saved/cleared.
        if (
          k === 'mailbox_override_cloud' ||
          k === 'mailbox_time_override_cloud' ||
          k === 'mailbox_time_override' ||
          k === 'mums_mailbox_time_override_cloud'
        ) {
          scheduleRender('override-change');
        }
        // REALTIME ALL-USER FIX: When schedule blocks, snapshots, or team config change
        // (pushed by Supabase to ALL connected clients), force a fresh API re-sync so
        // EVERY role — MEMBER, TEAM_LEAD, SUPER_ADMIN — sees the updated duty labels,
        // manager names, and roster without needing a page refresh.
        // Covers: Team Lead updates schedule on Members page → all open Mailbox tabs refresh.
        if (
          k === 'mums_schedule_blocks'    ||
          k === 'mums_schedule_snapshots' ||
          k === 'ums_weekly_schedules'    ||
          k === 'mums_team_config'        ||
          k === 'mums_schedule_lock_state'
        ) {
          // LOOP-GUARD: Only force-resync on schedule changes if not in failure cooldown
          const _schedCurTeam = String((window.Store && Store.getMailboxState ? Store.getMailboxState().currentKey || '' : '').split('|')[0]);
          const _schedCooldownActive = _syncCooldown && _schedCurTeam && _syncCooldown[_schedCurTeam] && Date.now() < _syncCooldown[_schedCurTeam];
          if (!_schedCooldownActive) { _mbxForceResync(k); }
          scheduleRender('schedule-update');
        }
        // REALTIME SHIFT CHANGE FIX: When mailbox state changes (shift rotated),
        // re-sync the new duty team's roster immediately so member list is up to date.
        if (k === 'mums_mailbox_state') {
          // LOOP-GUARD: Don't force-resync on state change if in failure cooldown
          const _stateCurTeam = String((window.Store && Store.getMailboxState ? Store.getMailboxState().currentKey || '' : '').split('|')[0]);
          const _stateCooldownActive = _syncCooldown && _stateCurTeam && _syncCooldown[_stateCurTeam] && Date.now() < _syncCooldown[_stateCurTeam];
          if (!_stateCooldownActive) { _mbxForceResync('shift-state-change'); }
          scheduleRender('shift-state-change');
        }
        // CASE MATRIX ALL-USER FIX: ums_cases is synced to all clients via Supabase realtime.
        // When any case is confirmed/updated/deleted, trigger an in-place patch + re-render
        // so all open Mailbox tabs reflect the new acknowledgment state immediately.
        if (k === 'ums_cases') {
          _patchConfirmedCells();
          scheduleRender('cases-update');
        }
        // NOTE: 'mums_mailbox_status' is intentionally NOT handled here.
        // It is handled by _registerMailboxStatusListener() which is bound in mount()
        // BEFORE the status check. This ensures the disable/enable toggle works even
        // when the page first loaded while already disabled (and _mountMailboxNormal
        // was never called). See BUG FIX v4.1 comment above mount().
      } catch (_) {}
    });
  } // end _mountMailboxNormal

  function unmount(){
    stopRealtimeTimers();
    if(window.CloudSocket && window.CloudSocket.off){
      window.CloudSocket.off('mailbox:update');
      window.CloudSocket.off('mailbox:assign');
      window.CloudSocket.off('mailbox:confirm');
    }
  }

  mount();

  return { render, mount, unmount };
});
