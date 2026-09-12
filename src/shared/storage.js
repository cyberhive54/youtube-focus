/* Storage helpers — classic script. Works in content scripts, popup, options.
   Background service worker loads it via importScripts. */
(function () {
  'use strict';

  function defaults() {
    // Deep clone so callers can mutate safely
    return JSON.parse(JSON.stringify(window.YTFOCUS.CONSTANTS.DEFAULTS));
  }

  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function deepMerge(base, over) {
    if (Array.isArray(over)) return over.slice();
    if (isPlainObject(base) && isPlainObject(over)) {
      var out = {};
      Object.keys(base).forEach(function (k) { out[k] = base[k]; });
      Object.keys(over).forEach(function (k) {
        out[k] = (k in base) ? deepMerge(base[k], over[k]) : over[k];
      });
      return out;
    }
    return over === undefined ? base : over;
  }

  function todayKey(d) {
    d = d || new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function blankDayStats() {
    return {
      shortsBlocked: 0,
      youtubeBlocked: 0,
      distractionsBlocked: 0,
      // DEFERRED (schema reserved, never written or displayed — no UI claims them):
      studyMinutes: 0,
      sessions: 0,
      bypassAttempts: 0
    };
  }

  function getDayStats(settings, key) {
    key = key || todayKey();
    if (!settings.stats) settings.stats = {};
    if (!settings.stats[key]) settings.stats[key] = blankDayStats();
    return settings.stats[key];
  }

  function bumpStat(settings, field, by) {
    var s = getDayStats(settings);
    s[field] = (s[field] || 0) + (by || 1);
    return s;
  }

  function getSettings() {
    var d = defaults();
    return chrome.storage.local.get(null).then(function (stored) {
      stored = stored || {};
      var merged = deepMerge(d, stored);
      // Migration 1: master switch. Fresh installs default OFF. Upgrades keep
      // protection ON only with definitive old-version usage traces (old code
      // wrote shorts.enabled; only real usage produces stats/streak). Never
      // infer from keys the new version writes itself (youtube/mode), or the
      // master would flip itself on after any settings change.
      if (!stored.blocking) {
        var dayCounts = function () {
          try {
            return Object.keys(stored.stats || {}).some(function (k) {
              var d = stored.stats[k] || {};
              return ((d.shortsBlocked || 0) + (d.youtubeBlocked || 0) + (d.distractionsBlocked || 0)) > 0;
            });
          } catch (e) { return false; }
        };
        var oldShorts = stored.youtube && stored.youtube.shorts;
        var prior = !!((oldShorts && ('enabled' in oldShorts)) || dayCounts() || (stored.streak || 0) > 0);
        merged.blocking = { enabled: prior };
      }
      // Migration 2: shorts.enabled -> shorts.independent (player-only scope).
      var sh = merged.youtube.shorts || {};
      var oldSh = (stored.youtube && stored.youtube.shorts) || {};
      if (!('independent' in oldSh)) {
        sh.independent = ('enabled' in oldSh) ? !!oldSh.enabled : false;
      }
      delete sh.enabled;
      merged.youtube.shorts = sh;
      // Migration 3: single-number streak -> {levelA, levelB} (value seeds B).
      if (typeof merged.streak === 'number') {
        merged.streak = { levelA: 0, levelB: merged.streak };
      }
      // Migration 4: minute-budget emergency -> percent-pool emergency.
      // minutesPerDay converts against the (possibly stored) daily quota.
      var emS = stored.emergency || {};
      if (emS.minutesPerDay !== undefined && emS.totalPercent === undefined) {
        var qMin = (stored.dailyQuota && stored.dailyQuota.minutes) || 60;
        var conv = Math.max(5, Math.min(400, Math.round((emS.minutesPerDay / qMin) * 100)));
        merged.emergency = merged.emergency || {};
        merged.emergency.totalPercent = conv;
        merged.emergency.optionPercents = [5, 10, 20, 100];
        merged.emergency.usedPoolMin = emS.usedMin || 0;
        merged.emergency.usedUses = emS.usedCount || 0;
        merged.emergency.poolDay = emS.usedDay || '';
        delete merged.emergency.minutesPerDay;
        delete merged.emergency.durations;
        delete merged.emergency.usedMin;
        delete merged.emergency.usedCount;
        delete merged.emergency.usedDay;
      }
      return merged;
    });
  }

  function saveSettings(patch) {
    // patch merged at top level; caller should pass full sub-objects
    return chrome.storage.local.set(patch);
  }

  function saveAll(settings) {
    return chrome.storage.local.set(settings);
  }

  function msUntilMidnight(now) {
    now = now || new Date();
    var mid = new Date(now);
    mid.setHours(24, 0, 0, 0);
    return mid.getTime() - now.getTime();
  }

  // ---- daily quota / usage (v2 model) ----------------------------------------
  function quotaMinutes(settings) {
    var m = settings && settings.dailyQuota && settings.dailyQuota.minutes;
    m = parseInt(m, 10);
    return (isNaN(m) || m <= 0) ? 60 : m;
  }

  function usageMsToday(settings, now) {
    var t = todayKey(now ? new Date(now) : undefined);
    var u = (settings && settings.usage) || {};
    if (!u.activeDay || u.activeDay !== t) return 0;
    return Math.max(0, u.activeMsToday || 0);
  }

  function usageRemainingMs(settings, now) {
    return Math.max(0, quotaMinutes(settings) * 60000 - usageMsToday(settings, now));
  }

  function usagePct(settings, now) {
    var q = quotaMinutes(settings) * 60000;
    if (q <= 0) return 0;
    return Math.min(1, usageMsToday(settings, now) / q);
  }

  function normalizeUsageDay(settings, now) {
    var t = todayKey(now ? new Date(now) : undefined);
    settings.usage = settings.usage || {};
    if (settings.usage.activeDay !== t) {
      settings.usage.activeMsToday = 0;
      settings.usage.activeDay = t;
      return true;
    }
    return false;
  }

  // ---- session grants (pure) --------------------------------------------------
  // A session never grants more than remains. Emergency grants are additionally
  // capped by remaining pool and require at least one use left (0 = denied).
  // Returns granted minutes, rounded down to 0.1.
  function sessionGrantMin(optionMin, quotaRemainingMs) {
    var o = Math.max(0, optionMin || 0);
    return Math.floor(Math.min(o * 60000, Math.max(0, quotaRemainingMs || 0)) / 60000 * 10) / 10;
  }

  function emergencyGrantMin(optionMin, poolRemainingMs, usesLeft) {
    if (!(usesLeft > 0)) return 0;
    var o = Math.max(0, optionMin || 0);
    return Math.floor(Math.min(o * 60000, Math.max(0, poolRemainingMs || 0)) / 60000 * 10) / 10;
  }

  // ---- reminders (pure) ---------------------------------------------------------
  function reminderCheckpointsMs(settings) {
    var q = quotaMinutes(settings) * 60000;
    var pcts = ((settings.reminders || {}).checkpointsPercent) || [25, 50, 75];
    return pcts.map(function (p) { return { pct: p, ms: q * p / 100 }; });
  }

  // Checkpoints newly crossed by usedMs that haven't fired today.
  function remindersDue(settings, usedMs) {
    var r = (settings.reminders || {});
    var fired = r.triggeredToday || [];
    return reminderCheckpointsMs(settings)
      .filter(function (c) { return usedMs >= c.ms && fired.indexOf(c.pct) === -1; })
      .map(function (c) { return c.pct; });
  }

  // ---- emergency pool (v2: percent-of-quota pool + uses) --------------------------
  var EM_OPTION_ALL = [5, 10, 20, 100];

  function emNum(v) {
    if (v === null || v === undefined || v === '') return Infinity;
    var n = parseInt(v, 10);
    return isNaN(n) ? Infinity : Math.max(0, n);
  }

  function emergencyOf(settings) {
    var e = (settings && settings.emergency) || {};
    var total = Math.max(0, parseInt(e.totalPercent, 10) || 0);
    var uses = emNum(e.maxUses);
    return {
      enabled: e.enabled === true,
      totalPercent: total,
      maxUses: uses,
      optionPercents: Array.isArray(e.optionPercents) && e.optionPercents.length ? e.optionPercents.slice() : EM_OPTION_ALL.slice(),
      usedPoolMin: Math.max(0, e.usedPoolMin || 0),
      usedUses: Math.max(0, e.usedUses || 0),
      poolDay: e.poolDay || '',
      poolCap: total > 0,
      useCap: uses !== Infinity
    };
  }

  // Emergency pool size in ms: totalPercent of the ORIGINAL daily quota.
  function emergencyPoolMs(settings) {
    return quotaMinutes(settings) * 60000 * emergencyOf(settings).totalPercent / 100;
  }

  function budgetOn(settings) {
    var e = emergencyOf(settings);
    return e.enabled && (e.poolCap || e.useCap);
  }

  // Normalize day rollover + apply due tomorrow-pending, in place.
  // Returns true if anything changed (caller persists).
  function emergencyRollover(settings, now) {
    var t = todayKey(now ? new Date(now) : undefined);
    settings.emergency = settings.emergency || {};
    var changed = false;
    if (settings.emergency.poolDay !== t) {
      settings.emergency.usedPoolMin = 0;
      settings.emergency.usedUses = 0;
      settings.emergency.poolDay = t;
      changed = true;
    }
    var p = settings.emergency.pending;
    if (p && settings.emergency.pendingDay && settings.emergency.pendingDay <= t) {
      ['enabled', 'totalPercent', 'maxUses', 'optionPercents'].forEach(function (k) {
        if (p[k] !== undefined) settings.emergency[k] = p[k];
      });
      settings.emergency.pending = null;
      settings.emergency.pendingDay = '';
      changed = true;
    }
    return changed;
  }

  function emergencyRemaining(settings, now) {
    // Pool minutes remaining (legacy name kept: minutes left in the pool).
    var e = emergencyOf(settings);
    if (!e.enabled || !e.poolCap) return Infinity;
    if (e.poolDay && e.poolDay !== todayKey(now ? new Date(now) : undefined)) return emergencyPoolMs(settings) / 60000;
    return Math.max(0, emergencyPoolMs(settings) / 60000 - e.usedPoolMin);
  }

  function emergencyUsesLeft(settings, now) {
    var e = emergencyOf(settings);
    if (!e.enabled || !e.useCap) return Infinity;
    if (e.poolDay && e.poolDay !== todayKey(now ? new Date(now) : undefined)) return e.maxUses;
    return Math.max(0, e.maxUses - e.usedUses);
  }

  function emergencyAffordable(settings, mins, now) {
    // Legacy minute-pill form: kept for the pause-sheet path where options are
    // already computed minutes. Pool-aware: denied when uses spent.
    var e = emergencyOf(settings);
    if (!e.enabled) return true;
    if (emergencyUsesLeft(settings, now) <= 0) return false;
    var m = parseInt(mins, 10);
    if (mins === 'rest') return !e.poolCap;
    if (isNaN(m) || m <= 0) return false;
    if (!e.poolCap) return true;
    return emergencyRemaining(settings, now) + 1e-6 >= m;
  }

  // Split a proposed emergency config into instant vs tomorrow parts.
  // live/proposed: {enabled, totalPercent, maxUses, optionPercents}.
  // Loosening (bigger pool, more uses, added options, disabling) → pending.
  // Tightening (smaller, removed options, enabling) → now.
  function splitEmergencyUpdate(live, proposed) {
    live = live || {};
    proposed = proposed || {};
    var nowApply = {};
    var pendApply = {};
    var hasPend = false;
    function numInf(v) {
      if (v === null || v === undefined || v === '') return Infinity;
      var n = parseInt(v, 10);
      return isNaN(n) ? Infinity : Math.max(0, n);
    }
    // enabled: turning OFF the budget is the ultimate loosening
    if (!!proposed.enabled !== !!live.enabled) {
      if (proposed.enabled === false) { pendApply.enabled = false; hasPend = true; }
      else nowApply.enabled = true;
    }
    // totalPercent (0/empty = no pool cap = Infinity)
    if (numInf(proposed.totalPercent) !== numInf(live.totalPercent)) {
      if (numInf(proposed.totalPercent) > numInf(live.totalPercent)) { pendApply.totalPercent = proposed.totalPercent; hasPend = true; }
      else nowApply.totalPercent = proposed.totalPercent;
    }
    // maxUses (null/empty = unlimited)
    if (numInf(proposed.maxUses) !== numInf(live.maxUses)) {
      if (numInf(proposed.maxUses) > numInf(live.maxUses)) { pendApply.maxUses = proposed.maxUses; hasPend = true; }
      else nowApply.maxUses = proposed.maxUses;
    }
    // optionPercents: removals now, additions pending (full target stored)
    var od = live.optionPercents || live.durations || [];
    var nd = proposed.optionPercents || proposed.durations || [];
    var removed = od.filter(function (d) { return nd.indexOf(d) === -1; });
    var added = nd.filter(function (d) { return od.indexOf(d) === -1; });
    if (removed.length) nowApply.optionPercents = od.filter(function (d) { return nd.indexOf(d) !== -1; });
    if (added.length) { pendApply.optionPercents = nd.slice(); hasPend = true; }
    return { now: nowApply, pending: hasPend ? pendApply : null };
  }

  function tomorrowKey(now) {
    var d = now ? new Date(now) : new Date();
    d.setDate(d.getDate() + 1);
    return todayKey(d);
  }

  // ---- input parsing (UI constraints live here so they are unit-testable) --
  // Minutes cap: 0 = no minute cap (intentional). Empty/NaN/negative are
  // invalid (caller reverts); clamp 0..600 per options HTML min/max.
  function parseMinuteCap(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (s === '') return { valid: false };
    var n = Number(s);
    if (!isFinite(n)) return { valid: false };
    n = Math.floor(n);
    if (n < 0) return { valid: false };
    if (n > 600) n = 600;
    return { valid: true, value: n };
  }

  // Shorts count cap: blank/empty = unlimited (null). 0 = none allowed.
  // Clamp 0..50 per options HTML min/max. NaN/negative invalid (revert).
  function parseShortsMax(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (s === '') return { valid: true, value: null };
    var n = Number(s);
    if (!isFinite(n)) return { valid: false };
    n = Math.floor(n);
    if (n < 0) return { valid: false };
    if (n > 50) n = 50;
    return { valid: true, value: n };
  }

  // ---- Strict enforcement boundary ----------------------------------------
  // Second layer behind disabled UI: drops protected keys from any UI-origin
  // patch while Strict is ON. System paths (counters, stats, snooze expiry,
  // refunds) write directly and are unaffected. Direct console writes bypass
  // this like any client-side guard — it stops product-path bypass, not devtools.
  // Always allowed: strictMode (legitimate exit), stats (telemetry).
  // snoozeUntil: allowed only when clearing/expired (lets pre-strict snoozes end).
  // Dropped under Strict: mode, blocking, youtube, study, presentation,
  // emergency, sessionLimits (caps live here; counters are written directly).
  function filterStrictPatch(settings, patch) {
    var out = {};
    var dropped = [];
    if (!settings || !settings.strictMode) {
      Object.keys(patch || {}).forEach(function (k) { out[k] = patch[k]; });
      return { applied: out, dropped: dropped };
    }
    Object.keys(patch || {}).forEach(function (k) {
      if (k === 'strictMode' || k === 'strictUnlockUntil' || k === 'stats') { out[k] = patch[k]; return; }
      if (k === 'snoozeUntil') {
        var v = patch[k];
        if (!v || v <= Date.now()) out[k] = v;
        else dropped.push(k);
        return;
      }
      dropped.push(k);
    });
    return { applied: out, dropped: dropped };
  }

  // ---- multi-tab counter merge ----------------------------------------------
  // sessionLimits is written by every tab (debounced). Whole-object blind
  // writes lose concurrent increments, which fails OPEN for limit enforcement.
  // Merge rule (same-day): caps from stored (options edits land there first),
  // counters take max(). Different days: whichever side is stamped today wins;
  // both stale -> memory (caller resets on next execute).
  function mergeSessionLimits(stored, memory, today) {
    stored = stored || {};
    memory = memory || {};
    today = today || todayKey();
    var sDay = stored.watchDay || stored.shortsSeenDay || stored.videosWatchedDay || '';
    var mDay = memory.watchDay || memory.shortsSeenDay || memory.videosWatchedDay || '';
    var out;
    if (sDay !== mDay) {
      if (mDay === today) out = memory;
      else if (sDay === today) out = stored;
      else out = memory;
    } else {
      out = {
        shortsMax: stored.shortsMax !== undefined ? stored.shortsMax : memory.shortsMax,
        shortsSeen: max(stored.shortsSeen, memory.shortsSeen),
        shortsSeenDay: stored.shortsSeenDay || memory.shortsSeenDay,
        videosMax: stored.videosMax !== undefined ? stored.videosMax : memory.videosMax,
        videosWatched: max(stored.videosWatched, memory.videosWatched),
        videosWatchedDay: stored.videosWatchedDay || memory.videosWatchedDay,
        watchMinutes: stored.watchMinutes !== undefined ? stored.watchMinutes : memory.watchMinutes,
        watchMsToday: max(stored.watchMsToday, memory.watchMsToday),
        watchDay: stored.watchDay || memory.watchDay
      };
    }
    function num(v) { v = parseInt(v, 10); return isNaN(v) ? 0 : v; }
    function max(a, b) { return Math.max(num(a), num(b)); }
    // Last-seen IDs (reload/new-tab revisit detection). Only same-day values
    // survive; live memory wins ties. See trackNavigationCounters.
    function sameDayId(side, dayKey, idKey) {
      return (side && side[dayKey] === today && side[idKey]) ? side[idKey] : '';
    }
    out.lastShortsId = sameDayId(memory, 'lastShortsDay', 'lastShortsId') ||
      sameDayId(stored, 'lastShortsDay', 'lastShortsId') || '';
    out.lastShortsDay = out.lastShortsId ? today : '';
    out.lastWatchId = sameDayId(memory, 'lastWatchDay', 'lastWatchId') ||
      sameDayId(stored, 'lastWatchDay', 'lastWatchId') || '';
    out.lastWatchDay = out.lastWatchId ? today : '';
    return out;
  }

  // Minutes to credit back when a snooze ends early (resume / master-off).
  // USES are intentionally never refunded: every started pause costs one use.
  function snoozeRefundMin(settings, now) {
    now = now || Date.now();
    if (!settings.snoozeUntil || settings.snoozeUntil <= now) return 0;
    return (settings.snoozeUntil - now) / 60000;
  }

  // Cancel an active snooze/session grant early, refunding unused pool minutes.
  // USES are intentionally never refunded: every started grant costs one use.
  // Returns a storage patch ({snoozeUntil, emergency}).
  function cancelSnoozePatch(settings, now) {
    now = now || Date.now();
    var refund = snoozeRefundMin(settings, now);
    settings.emergency = settings.emergency || {};
    emergencyRollover(settings, now);
    settings.emergency.usedPoolMin = Math.max(0, (settings.emergency.usedPoolMin || 0) - refund);
    settings.emergency.poolDay = todayKey(new Date(now));
    settings.snoozeUntil = 0;
    return { snoozeUntil: 0, emergency: settings.emergency };
  }

  // ---- study pending allowlist --------------------------------------------------
  // Additions/removals staged today activate at local midnight (never same-day,
  // so terminal blocking can't be bypassed by adding content). Mutates study in
  // place; returns true if anything changed (caller persists).
  function pendingKey(kind, value) {
    value = value || {};
    if (kind === 'channel') {
      return 'c:' + (value.id || value.handle || value.url || '');
    }
    return 'v:' + (value.id || value.url || '');
  }

  function applyPendingStudy(study, now) {
    if (!study || !study.pendingChanges || !study.pendingChanges.length) return false;
    var t = todayKey(now ? new Date(now) : undefined);
    var due = [];
    var later = [];
    study.pendingChanges.forEach(function (ch) {
      if (ch.day && ch.day <= t) due.push(ch);
      else later.push(ch);
    });
    if (!due.length) return false;
    study.allowedChannels = study.allowedChannels || [];
    study.allowedVideos = study.allowedVideos || [];
    function seen(list, kind, value) {
      var k = pendingKey(kind, value);
      return list.some(function (a) { return pendingKey(kind, a) === k; });
    }
    due.forEach(function (ch) {
      if (ch.kind === 'channel') {
        if (ch.op === 'add') {
          if (!seen(study.allowedChannels, 'channel', ch.value)) study.allowedChannels.push(ch.value);
        } else {
          study.allowedChannels = study.allowedChannels.filter(function (a) {
            return pendingKey('channel', a) !== pendingKey('channel', ch.value);
          });
        }
      } else {
        if (ch.op === 'add') {
          if (!seen(study.allowedVideos, 'video', ch.value)) study.allowedVideos.push(ch.value);
        } else {
          study.allowedVideos = study.allowedVideos.filter(function (v) {
            return pendingKey('video', v) !== pendingKey('video', ch.value);
          });
        }
      }
    });
    study.pendingChanges = later;
    return true;
  }

  // ---- streak day qualification (pure) --------------------------------------------
  // Study-timer previous mode: recorded when a timer starts a temporary
  // Study session, consumed once when the timer ends or expires. A manual
  // Study selection clears it, so expiry never restores over user intent.
  function restoreStudyPrevMode(study, mode) {
    if (!study) return null;
    var prev = study.prevMode || null;
    study.prevMode = null;
    return (prev && mode === 'study') ? prev : null;
  }

  // Level A: usage within quota AND zero emergency usage.
  // Level B: usage within quota AND emergency within allowance.
  function streakQualify(dayUsageMs, quotaMs, emUsedMin, emUsedUses, poolMs, maxUses) {
    var withinQuota = dayUsageMs <= quotaMs;
    var emUsed = (emUsedMin > 0) || (emUsedUses > 0);
    var withinAllowance = (emUsedUses <= maxUses) && (emUsedMin * 60000 <= poolMs);
    return { a: withinQuota && !emUsed, b: withinQuota && withinAllowance };
  }

  window.YTFOCUS = window.YTFOCUS || {};
  window.YTFOCUS.store = {
    defaults: defaults,
    deepMerge: deepMerge,
    todayKey: todayKey,
    blankDayStats: blankDayStats,
    getDayStats: getDayStats,
    bumpStat: bumpStat,
    getSettings: getSettings,
    saveSettings: saveSettings,
    saveAll: saveAll,
    msUntilMidnight: msUntilMidnight,
    quotaMinutes: quotaMinutes,
    usageMsToday: usageMsToday,
    usageRemainingMs: usageRemainingMs,
    usagePct: usagePct,
    normalizeUsageDay: normalizeUsageDay,
    sessionGrantMin: sessionGrantMin,
    emergencyGrantMin: emergencyGrantMin,
    reminderCheckpointsMs: reminderCheckpointsMs,
    remindersDue: remindersDue,
    emergencyOf: emergencyOf,
    budgetOn: budgetOn,
    emergencyPoolMs: emergencyPoolMs,
    emergencyRollover: emergencyRollover,
    emergencyRemaining: emergencyRemaining,
    emergencyUsesLeft: emergencyUsesLeft,
    emergencyAffordable: emergencyAffordable,
    splitEmergencyUpdate: splitEmergencyUpdate,
    tomorrowKey: tomorrowKey,
    parseMinuteCap: parseMinuteCap,
    parseShortsMax: parseShortsMax,
    filterStrictPatch: filterStrictPatch,
    mergeSessionLimits: mergeSessionLimits,
    snoozeRefundMin: snoozeRefundMin,
    cancelSnoozePatch: cancelSnoozePatch,
    pendingKey: pendingKey,
    applyPendingStudy: applyPendingStudy,
    restoreStudyPrevMode: restoreStudyPrevMode,
    streakQualify: streakQualify
  };
})();
