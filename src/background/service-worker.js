/* Background service worker — timers, badge, streak. No DOM access.
   Standalone (no imports): service workers have no `window`, so shared
   content-script files are NOT imported here. Minimal logic is inlined. */
'use strict';

function todayKey(d) {
  d = d || new Date();
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + m + '-' + day;
}

function timeToMin(t) {
  var p = String(t || '00:00').split(':');
  return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0);
}

function scheduleMatches(entry, now) {
  try {
    var d = new Date(now);
    if (entry.days && entry.days.indexOf(d.getDay()) === -1) return false;
    var mins = d.getHours() * 60 + d.getMinutes();
    var from = timeToMin(entry.from);
    var to = timeToMin(entry.to);
    if (from <= to) return mins >= from && mins < to;
    return mins >= from || mins < to;
  } catch (e) { return false; }
}

function activeSchedule(s, now) {
  var sch = (s && s.study && s.study.schedule) || [];
  var matched = null;
  for (var i = 0; i < sch.length; i++) {
    if (scheduleMatches(sch[i], now)) {
      if (sch[i].mode === 'full') return sch[i];
      matched = sch[i];
    }
  }
  return matched;
}

function isBlockingActive(s, now) {
  if (s && s.blocking && s.blocking.enabled) return true;
  var t = (now !== undefined && now !== null) ? now : Date.now();
  var sch = (s && s.study && s.study.schedule) || [];
  for (var i = 0; i < sch.length; i++) {
    if (scheduleMatches(sch[i], t)) return true;
  }
  return false;
}

function scheduledMode(s, now) {
  var sch = (s && s.study && s.study.schedule) || [];
  var want = null;
  for (var i = 0; i < sch.length; i++) {
    if (scheduleMatches(sch[i], now)) {
      if (sch[i].mode === 'full') return 'full';
      want = sch[i].mode || 'study';
    }
  }
  return want;
}

function isModeTransitionAllowed(currentMode, targetMode) {
  if (!currentMode || !targetMode) return false;
  if (currentMode === targetMode) return true;
  if (currentMode === 'normal') return true;
  if (currentMode === 'restricted') return targetMode !== 'normal';
  if (currentMode === 'study') return targetMode !== 'normal';
  if (currentMode === 'full') return targetMode === 'study';
  return false;
}

function effectiveMode(s, now) {
  var sm = scheduledMode(s, now);
  if (s.study && s.study.manualUntil && now < s.study.manualUntil) return 'study';
  var override = s && s.study && s.study.scheduleOverrideMode;
  if (sm && override && isModeTransitionAllowed(sm, override)) {
    if (override === 'study') return 'study';
    if (sm === 'full' && override !== 'study') return 'full';
    if (s.mode === 'full') return 'full';
    return override;
  }
  if (sm === 'full' || (s && s.mode === 'full')) return 'full';
  if (sm) return sm;
  return s.mode || 'normal';
}

  function getSettings() {
    return chrome.storage.local.get(null).then(function (s) { return s || {}; });
  }

  // Local-midnight rollover for every daily key. Inline copies (SW is standalone):
  // usage + history, reminders, emergency usage + pending, terminal latch,
  // study pending allowlist, Level A/B streak finalization. History pruned.
  function midnightRollover(s, now, today) {
    var patch = {};
    var changed = false;
    // Usage day reset (+history snapshot before wiping).
    var u = s.usage || {};
    if (u.activeDay && u.activeDay !== today) {
      try {
        var hist = s.usageHistory || {};
        hist[u.activeDay] = {
          activeMs: u.activeMsToday || 0,
          watchMs: (s.sessionLimits && s.sessionLimits.watchMsToday) || 0
        };
        var cutoff = new Date(now - 60 * 86400000);
        var ck = todayKey(cutoff);
        Object.keys(hist).forEach(function (k) { if (k < ck) delete hist[k]; });
        patch.usageHistory = hist;
      } catch (e) {}
      u = { activeMsToday: 0, activeDay: today, sessionsToday: 0 };
      patch.usage = u;
      changed = true;
    } else if (!u.activeDay) {
      patch.usage = { activeMsToday: 0, activeDay: today, sessionsToday: 0 };
      changed = true;
    }
    // Reminders reset.
    var r = s.reminders || {};
    if (r.triggeredDay !== today) {
      patch.reminders = {
        checkpointsPercent: r.checkpointsPercent || [25, 50, 75],
        triggeredToday: [],
        triggeredDay: today
      };
      changed = true;
    }
    // Emergency usage reset + pending apply.
    var em = s.emergency || {};
    var emChanged = false;
    if (em.poolDay !== today) {
      em.usedPoolMin = 0;
      em.usedUses = 0;
      em.poolDay = today;
      emChanged = true;
    }
    var p = em.pending;
    if (p && em.pendingDay && em.pendingDay <= today) {
      ['enabled', 'totalPercent', 'maxUses', 'optionPercents'].forEach(function (k) {
        if (p[k] !== undefined) em[k] = p[k];
      });
      em.pending = null;
      em.pendingDay = '';
      emChanged = true;
    }
    if (emChanged) { patch.emergency = em; changed = true; }
    // Terminal latch clears with the day.
    if (s.terminal && (s.terminal.active || s.terminal.day) && s.terminal.day !== today) {
      patch.terminal = { active: false, day: '' };
      changed = true;
    }
    // Study pending allowlist activates.
    try {
      var st = s.study || { allowedChannels: [], allowedVideos: [], pendingChanges: [] };
      var list = st.pendingChanges || [];
      var due = list.filter(function (ch) { return ch.day && ch.day <= today; });
      if (due.length) {
        var key = function (kind, v) {
          v = v || {};
          return kind === 'channel' ? 'c:' + (v.id || v.handle || v.url || '') : 'v:' + (v.id || v.url || '');
        };
        st.allowedChannels = st.allowedChannels || [];
        st.allowedVideos = st.allowedVideos || [];
        due.forEach(function (ch) {
          var arr = ch.kind === 'channel' ? st.allowedChannels : st.allowedVideos;
          var k = key(ch.kind, ch.value);
          var at = -1;
          for (var i = 0; i < arr.length; i++) {
            if (key(ch.kind, arr[i]) === k) { at = i; break; }
          }
          if (ch.op === 'add') { if (at === -1) arr.push(ch.value); }
          else if (at !== -1) { arr.splice(at, 1); }
        });
        st.pendingChanges = list.filter(function (ch) { return !(ch.day && ch.day <= today); });
        patch.study = st;
        changed = true;
      }
      if (st.schedule && st.schedule.length) {
        var cleanSch = st.schedule.filter(function (sch) { return !sch.pendingRemoval; });
        if (cleanSch.length !== st.schedule.length) {
          st.schedule = cleanSch;
          patch.study = st;
          changed = true;
        }
      }
    } catch (e) {}
    return { patch: patch, changed: changed };
  }

  // Streak finalize for the finished day (pure logic, inline copy).
  // A: within quota AND zero emergency use. B: within quota AND within allowance.
  function streakForDay(dayUsageMs, quotaMs, emMin, emUses, poolMs, maxUses, prevA, prevB) {
    var withinQuota = dayUsageMs <= quotaMs;
    var emUsed = (emMin > 0) || (emUses > 0);
    var useCapped = maxUses !== null && maxUses !== undefined && maxUses !== '' && isFinite(Number(maxUses));
    var unlimited = !(poolMs > 0) && !useCapped;
    var withinAllowance = unlimited ||
      ((useCapped ? emUses <= Number(maxUses) : true) && (emMin * 60000 <= poolMs));
    return {
      a: (withinQuota && !emUsed) ? (prevA + 1) : 0,
      b: (withinQuota && withinAllowance) ? (prevB + 1) : 0
    };
  }

chrome.runtime.onInstalled.addListener(function (details) {
  getSettings().then(function (s) {
    var t = todayKey();
    var sl = s.sessionLimits || {};
    if (!sl.shortsSeenDay) {
      sl.shortsSeenDay = t;
      sl.videosWatchedDay = t;
      sl.watchDay = t;
      return chrome.storage.local.set({ sessionLimits: sl });
    }
  }).catch(function () {});
  chrome.alarms.create('ytf-schedule', { periodInMinutes: 1 });
  // A first install should lead somewhere useful. Updates preserve the user's
  // flow and never open a surprise tab.
  if (details && details.reason === 'install') {
    chrome.runtime.openOptionsPage().catch(function () {});
  }
});

chrome.runtime.onStartup.addListener(function () {
  chrome.alarms.create('ytf-schedule', { periodInMinutes: 1 });
  refreshBadge().catch(function () {});
});

chrome.runtime.onMessage.addListener(function (msg) {
  if (!msg || !msg.type) return;
  if (msg.type === 'ytf:open-options') {
    chrome.runtime.openOptionsPage().catch(function () {});
  }
  if (msg.type === 'ytf:snooze' && msg.until) {
    chrome.alarms.create('ytf-snooze-end', { when: msg.until });
    refreshBadge().catch(function () {});
  }
  if (msg.type === 'ytf:blocked' || msg.type === 'ytf:refresh-badge') {
    refreshBadge().catch(function () {});
  }
});

chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm.name === 'ytf-snooze-end') {
    chrome.storage.local.set({ snoozeUntil: 0 }).catch(function () {});
    refreshBadge().catch(function () {});
  }
  if (alarm.name === 'ytf-unblock-end') {
    getSettings().then(function (s) {
      if (s.unblockUntil && Date.now() >= s.unblockUntil) {
        return chrome.storage.local.set({ blocking: { enabled: false }, unblockUntil: 0 });
      }
    }).then(refreshBadge).catch(function () {});
  }
  if (alarm.name === 'ytf-strict-end') {
    getSettings().then(function (s) {
      if (s.strictUnlockUntil && Date.now() >= s.strictUnlockUntil) {
        return chrome.storage.local.set({ strictMode: false, strictUnlockUntil: 0 });
      }
    }).then(refreshBadge).catch(function () {});
  }
  if (alarm.name === 'ytf-schedule') {
    getSettings().then(function (s) {
      var now = Date.now();
      var patch = {};
      if (s.snoozeUntil && now >= s.snoozeUntil) {
        patch.snoozeUntil = 0;
        if (s.session) { s.session.activeUntil = 0; patch.session = s.session; }
      }
      if (s.study && s.study.manualUntil && now >= s.study.manualUntil) {
        s.study.manualUntil = 0;
        // Restore a mode the timer itself replaced (never a manual Study:
        // explicit study picks clear prevMode when chosen).
        var prev = (s.study && s.study.prevMode) || null;
        if (s.study) s.study.prevMode = null;
        if (prev && s.mode === 'study') { patch.mode = s.mode = prev; }
        patch.study = s.study;
      }
      if (s.strictUnlockUntil && now >= s.strictUnlockUntil) {
        patch.strictMode = false;
        patch.strictUnlockUntil = 0;
      }
      if (s.unblockUntil && now >= s.unblockUntil) {
        patch.blocking = { enabled: false };
        patch.unblockUntil = 0;
      }
      if (s.study && s.study.scheduleOverrideMode) {
        var curSm = scheduledMode(s, now);
        if (!curSm) {
          s.study.scheduleOverrideMode = null;
          patch.study = s.study;
        }
      }
      var t = todayKey();
      if (s.lastCleanDay !== t) {
        // Finalize yesterday's streaks BEFORE midnightRollover wipes counters.
        try {
          var yKey = todayKey(new Date(now - 86400000));
          var quotaMs = (((s.dailyQuota || {}).minutes) || 60) * 60000;
          var dayUse = 0;
          if (s.usage && s.usage.activeDay === yKey) dayUse = s.usage.activeMsToday || 0;
          var em = s.emergency || {};
          var poolMs = quotaMs * ((em.totalPercent || 0)) / 100;
          var prev = (s.streak && typeof s.streak === 'object') ? s.streak :
            { levelA: 0, levelB: (typeof s.streak === 'number' ? s.streak : 0) };
          var next = streakForDay(dayUse, quotaMs, em.usedPoolMin || 0, em.usedUses || 0,
            poolMs, em.maxUses, prev.levelA || 0, prev.levelB || 0);
          // Only finalize when yesterday actually has usage data or any blocks;
          // a day with zero YouTube qualifies Level A literally (within quota,
          // no emergency) — spec-literal, keep.
          patch.streak = next;
        } catch (e) {}
        patch.lastCleanDay = t;
      }
      var ro = midnightRollover(s, now, t);
      if (ro.changed) {
        Object.keys(ro.patch).forEach(function (k) { patch[k] = ro.patch[k]; });
      }
      if (Object.keys(patch).length) return chrome.storage.local.set(patch);
    }).then(refreshBadge).catch(function () {});
  }
});

chrome.storage.onChanged.addListener(function (changes) {
  if (changes.snoozeUntil || changes.mode || changes.study || changes.strictMode || changes.blocking || changes.unblockUntil || changes.strictUnlockUntil) {
    refreshBadge().catch(function () {});
    if (changes.snoozeUntil && changes.snoozeUntil.newValue) {
      chrome.alarms.create('ytf-snooze-end', { when: changes.snoozeUntil.newValue });
    }
    if (changes.unblockUntil) {
      if (changes.unblockUntil.newValue) chrome.alarms.create('ytf-unblock-end', { when: changes.unblockUntil.newValue });
      else chrome.alarms.clear('ytf-unblock-end').catch(function () {});
    }
    if (changes.strictUnlockUntil) {
      if (changes.strictUnlockUntil.newValue) chrome.alarms.create('ytf-strict-end', { when: changes.strictUnlockUntil.newValue });
      else chrome.alarms.clear('ytf-strict-end').catch(function () {});
    }
  }
});

function refreshBadge() {
  return getSettings().then(function (s) {
    var now = Date.now();
    var text = '';
    var color = '#0071E3';
    var active = isBlockingActive(s, now);
    if (!active) {
      text = 'OFF';
      color = '#8E8E93';
    } else if (s.snoozeUntil && now < s.snoozeUntil) {
      text = 'OFF';
      color = '#8E8E93';
    } else {
      var mode = effectiveMode(s, now);
      if (mode === 'full') { text = 'FULL'; color = '#D70015'; }
      else if (mode === 'study') { text = 'STU'; color = '#1D8127'; }
      else if (mode === 'restricted') { text = 'RES'; color = '#0071E3'; }
    }
    return chrome.action.setBadgeText({ text: text }).then(function () {
      return chrome.action.setBadgeBackgroundColor({ color: color });
    });
  });
}
