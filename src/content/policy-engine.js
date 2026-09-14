/* Pure policy engine — NO side effects.
   evaluateContext(context, settings) -> decision.
   Never touches DOM, storage, alarms. Enforcers execute the decision.

   context: { url, route, origin, videoId, channelId, handle, channelUrl,
              isShort, isEntryShort, now, dayKey, shortsSeen, videosWatched, watchMsToday }
   isEntryShort: true when this Short is the one the user opened (fresh entry
   from a non-Shorts page, URL visit or reload) — as opposed to a Short reached
   by scrolling/swiping to the next one. Computed by the content script, which
   tracks entry transitions; the engine stays pure.
   decision: { action: 'allow'|'modify'|'block', reason, screen?, modifications? }
*/
(function () {
  'use strict';

  function timeToMin(t) {
    var p = String(t || '00:00').split(':');
    return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0);
  }

  function scheduleMatches(entry, now) {
    if (!entry || entry.enabled === false) return false;
    // now: epoch ms. Uses LOCAL day/time of the browser.
    try {
      var d = new Date(now);
      var day = d.getDay();
      var mins = d.getHours() * 60 + d.getMinutes();
      var from = timeToMin(entry.from);
      var to = timeToMin(entry.to);
      if (from <= to) {
        if (entry.days && entry.days.indexOf(day) === -1) return false;
        return mins >= from && mins < to;
      }
      // Overnight range (e.g. 22:00 to 05:00)
      if (mins >= from) {
        return !entry.days || entry.days.indexOf(day) !== -1;
      }
      if (mins < to) {
        var prevDay = (day + 6) % 7;
        return !entry.days || entry.days.indexOf(prevDay) !== -1 || entry.days.indexOf(day) !== -1;
      }
      return false;
    } catch (e) { return false; }
  }

  function isScheduleStrictLocked(entry, now) {
    if (!entry || !entry.strict || entry.enabled === false) return false;
    try {
      var d = new Date(now);
      var day = d.getDay();
      var mins = d.getHours() * 60 + d.getMinutes();
      var from = timeToMin(entry.from);
      var days = entry.days || [];
      if (!days.length) return false;

      // Active running check
      if (scheduleMatches(entry, now)) return true;

      // User-configurable pre-commitment window (10 to 360 mins, default 60)
      var lockBuffer = parseInt(entry.strictLockMinutes, 10);
      if (isNaN(lockBuffer) || lockBuffer < 10) lockBuffer = 60;
      if (lockBuffer > 360) lockBuffer = 360;

      var lockFrom = from - lockBuffer;
      if (lockFrom >= 0) {
        if (days.indexOf(day) !== -1 && mins >= lockFrom && mins < from) return true;
      } else {
        var rolledFrom = lockFrom + 1440;
        var nextDay = (day + 1) % 7;
        if (days.indexOf(nextDay) !== -1 && mins >= rolledFrom) return true;
        if (days.indexOf(day) !== -1 && mins < from) return true;
      }
      return false;
    } catch (e) { return false; }
  }

  function scheduleStrictMinutesRemaining(entry, now) {
    if (!entry || !entry.strict || entry.enabled === false) return null;
    try {
      var d = new Date(now);
      var day = d.getDay();
      var mins = d.getHours() * 60 + d.getMinutes();
      var from = timeToMin(entry.from);
      var days = entry.days || [];
      if (!days.length) return null;
      if (scheduleMatches(entry, now)) return 0; // Already running

      var lockBuffer = parseInt(entry.strictLockMinutes, 10);
      if (isNaN(lockBuffer) || lockBuffer < 10) lockBuffer = 60;
      if (lockBuffer > 360) lockBuffer = 360;

      var lockFrom = from - lockBuffer;
      if (lockFrom >= 0) {
        if (days.indexOf(day) !== -1 && mins >= lockFrom && mins < from) {
          return from - mins;
        }
      } else {
        var rolledFrom = lockFrom + 1440;
        var nextDay = (day + 1) % 7;
        if (days.indexOf(nextDay) !== -1 && mins >= rolledFrom) {
          return (1440 - mins) + from;
        }
        if (days.indexOf(day) !== -1 && mins < from) {
          return from - mins;
        }
      }
      return null;
    } catch (e) { return null; }
  }

  function isScheduleDueNotification(entry, now) {
    if (!entry || !entry.notify || entry.enabled === false) return false;
    try {
      var d = new Date(now);
      var day = d.getDay();
      var mins = d.getHours() * 60 + d.getMinutes();
      var from = timeToMin(entry.from);
      var days = entry.days || [];
      if (!days.length) return false;

      var notifyMin = parseInt(entry.notifyMinutes, 10);
      if (isNaN(notifyMin) || notifyMin < 1) notifyMin = 15;

      var notifyFrom = from - notifyMin;
      if (notifyFrom >= 0) {
        if (days.indexOf(day) !== -1 && mins >= notifyFrom && mins < from) return true;
      } else {
        var rolledFrom = notifyFrom + 1440;
        var nextDay = (day + 1) % 7;
        if (days.indexOf(nextDay) !== -1 && mins >= rolledFrom) return true;
        if (days.indexOf(day) !== -1 && mins < from) return true;
      }
      return false;
    } catch (e) { return false; }
  }

  function calcScheduleDuration(fromStr, toStr) {
    function t2m(s) {
      if (!s || typeof s !== 'string') return 0;
      var p = s.split(':');
      return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0);
    }
    var f = t2m(fromStr);
    var t = t2m(toStr);
    if (f === t) return 0;
    if (t > f) return t - f;
    return (1440 - f) + t;
  }

  function getScheduleBreakCooldownRemaining(schedule, now) {
    if (!schedule || !schedule.breaksEnabled || !schedule.lastBreakEndedAt) return 0;
    now = (now !== undefined && now !== null) ? now : Date.now();
    var duration = calcScheduleDuration(schedule.from, schedule.to);
    var defPct = (schedule.strict || schedule.strictMode) ? 10 : 5;
    var pct = schedule.breakBetweenPercent || defPct;
    var requiredCooldownMs = Math.ceil(duration * (pct / 100)) * 60 * 1000;
    var cooldownEnd = schedule.lastBreakEndedAt + requiredCooldownMs;
    if (now < cooldownEnd) {
      return cooldownEnd - now;
    }
    return 0;
  }

  function getMaxSingleBreakMinutes(schedule) {
    if (!schedule || !schedule.breaksEnabled) return 0;
    var totalMin = schedule.breakMinutes || 0;
    var defPct = (schedule.strict || schedule.strictMode) ? 50 : 75;
    var pct = schedule.maxPerBreakPercent || defPct;
    return Math.max(1, Math.floor(totalMin * (pct / 100)));
  }

  function isScheduleBreakActive(settings, now) {
    now = now || Date.now();
    var b = settings && settings.activeBreak;
    if (!b || !b.endsAt || now >= b.endsAt) return false;
    var sch = activeSchedule(settings, now);
    if (!sch || sch.id !== b.scheduleId) return false;
    return true;
  }

  function scheduledMode(settings, now) {
    var sch = (settings && settings.schedules) || (settings && settings.study && settings.study.schedule) || [];
    var want = null;
    for (var i = 0; i < sch.length; i++) {
      if (scheduleMatches(sch[i], now)) {
        if (sch[i].mode === 'full') { want = 'full'; break; }
        want = sch[i].mode || 'study';
      }
    }
    if (want && isScheduleBreakActive(settings, now)) return 'normal';
    return want;
  }

  function isStudyActive(settings, now) {
    if (settings.mode === 'study') return true;
    if (settings.study && settings.study.manualUntil && now < settings.study.manualUntil) return true;
    var sm = scheduledMode(settings, now);
    return sm === 'study' || sm === 'full' && settings.mode === 'study';
  }

  function isModeTransitionAllowed(currentMode, targetMode) {
    if (!currentMode || !targetMode) return false;
    if (currentMode === targetMode) return true;
    if (currentMode === 'normal') return true; // normal to any mode allowed
    if (currentMode === 'restricted') return targetMode !== 'normal'; // restricted to any except normal
    if (currentMode === 'study') return targetMode !== 'normal'; // study to any except normal
    if (currentMode === 'full') return targetMode === 'study'; // full block to study mode jump only
    return false;
  }

  function effectiveMode(settings, now) {
    if (isScheduleBreakActive(settings, now)) {
      if (settings && settings.mode === 'full' && settings.blocking && settings.blocking.enabled) return 'full';
      return 'normal';
    }
    // Full is the strictest — explicit Full Block always wins.
    if (settings && settings.mode === 'full') return 'full';
    var sm = scheduledMode(settings, now);
    // Explicit study timer always wins if active.
    if (settings && settings.study && settings.study.manualUntil && now < settings.study.manualUntil) return 'study';
    var override = settings && settings.study && settings.study.scheduleOverrideMode;
    if (sm && override && isModeTransitionAllowed(sm, override)) {
      if (override === 'study') return 'study';
      if (sm === 'full' && override !== 'study') return 'full';
      return override;
    }
    if (sm) return sm;
    return (settings && settings.mode) || 'normal';
  }

  function isVideoAllowlisted(settings, videoId, now) {
    if (!videoId) return false;
    var vs = (settings && settings.study && settings.study.allowedVideos) || [];
    for (var i = 0; i < vs.length; i++) {
      if (vs[i].id === videoId || (vs[i].url && vs[i].url.indexOf(videoId) !== -1)) return true;
    }
    var sch = activeSchedule(settings, now || Date.now());
    if (sch && sch.allowedVideos) {
      for (var j = 0; j < sch.allowedVideos.length; j++) {
        var sv = sch.allowedVideos[j];
        if (sv.id === videoId || (sv.url && sv.url.indexOf(videoId) !== -1)) return true;
      }
    }
    return false;
  }

  function isChannelAllowlisted(settings, ctx, now) {
    var list = (settings && settings.study && settings.study.allowedChannels) || [];
    function matchChan(a) {
      if (!a) return false;
      if (ctx.channelId && a.id && ctx.channelId === a.id) return true;
      if (ctx.handle && a.handle && ctx.handle.toLowerCase() === String(a.handle).toLowerCase()) return true;
      if (ctx.channelUrl && a.url && ctx.channelUrl.toLowerCase() === String(a.url).toLowerCase()) return true;
      return false;
    }
    for (var i = 0; i < list.length; i++) {
      if (matchChan(list[i])) return true;
    }
    var sch = activeSchedule(settings, now || ctx.now || Date.now());
    if (sch && sch.allowedChannels) {
      for (var j = 0; j < sch.allowedChannels.length; j++) {
        if (matchChan(sch.allowedChannels[j])) return true;
      }
    }
    return false;
  }

  function activeSchedule(settings, now) {
    var sch = (settings && settings.schedules) || (settings && settings.study && settings.study.schedule) || [];
    var matched = null;
    for (var i = 0; i < sch.length; i++) {
      if (scheduleMatches(sch[i], now)) {
        if (sch[i].mode === 'full') return sch[i]; // full wins
        matched = sch[i];
      }
    }
    return matched;
  }

  // Master switch / schedule activation: blocking is ACTIVE when master is enabled
  // OR when an active schedule window matches (Workaround A: schedule auto-activation).
  function isBlockingActive(settings, now) {
    if (settings && settings.blocking && settings.blocking.enabled) return true;
    var t = (now !== undefined && now !== null) ? now : Date.now();
    if (scheduledMode(settings, t)) return true;
    return false;
  }

  // Governance: which user toggles are currently OVERRULED by the active mode's
  // binding rules (so the UI can lock them with a named reason instead of
  // silently accepting taps that do nothing). Pure — safe for popup/options.
  // Truth table mirrors the gates above:
  //  - shorts.independent: overruled iff a binding shorts rule is active
  //  - allowFirstShort: honored in normal/inactive; Restricted owns its entry
  //    rule (always allows first Short); dead in study/full
  //  - home/explore feed toggles: read ONLY by the normal gate
  //  - rec/sidebar/autoplay prefs: consulted everywhere except full block
  //  - search policy, limits, allowlist, schedules: never mode-locked
  function governance(settings, now) {
    now = now || Date.now();
    var active = isBlockingActive(settings, now);
    var mode = effectiveMode(settings, now);
    var sch = activeSchedule(settings, now);
    var boundMode = active && (mode === 'restricted' || mode === 'study' || mode === 'full');
    return {
      active: active,
      mode: mode,
      activeSchedule: sch,
      shorts: boundMode,
      first: active && (mode === 'study' || mode === 'full'),
      feeds: boundMode,
      recs: active && mode === 'full'
    };
  }

  // Per-mode shorts rules. A mode with a rule BINDS Shorts while active;
  // a mode with no rule (normal) leaves Shorts to the independent toggle.
  // Fixed by design: restricted/study/full always block Shorts when active.
  function shortsRuleFor(mode) {
    if (mode === 'restricted' || mode === 'study' || mode === 'full') return 'block';
    return null;
  }

  function independentShorts(settings) {
    return !!((settings.youtube && settings.youtube.shorts) || {}).independent;
  }

  function allowFirstShort(settings) {
    return !!((settings.youtube && settings.youtube.shorts) || {}).allowFirstShort;
  }

  // ---- daily quota / terminal model (v2, pure duplicates of store math) -------
  // The engine stays dependency-free (SW-tested pattern); tiny logic duplicated
  // rather than importing the store.
  function quotaMinutes(settings) {
    var m = settings && settings.dailyQuota && settings.dailyQuota.minutes;
    m = parseInt(m, 10);
    return (isNaN(m) || m <= 0) ? 60 : m;
  }

  function usageMsToday(settings, now) {
    var t;
    try {
      var d = now ? new Date(now) : new Date();
      t = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    } catch (e) { return 0; }
    var u = (settings && settings.usage) || {};
    if (!u.activeDay || u.activeDay !== t) return 0;
    return Math.max(0, u.activeMsToday || 0);
  }

  function usageRemainingMs(settings, now) {
    return Math.max(0, quotaMinutes(settings) * 60000 - usageMsToday(settings, now));
  }

  function isTerminalActive(settings, now) {
    var t;
    try {
      var d = now ? new Date(now) : new Date();
      t = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    } catch (e) { return false; }
    var term = (settings && settings.terminal) || {};
    return !!(term.active && term.day && term.day === t);
  }

  // Restricted provenance: a watch page is allowed only when this exact video
  // was just clicked from a same-tab search result (tracked by the content
  // script in ctx.provenanceVideoId). Everything else is unprovenanced.
  function provenanceOk(ctx) {
    return !!(ctx.provenanceVideoId && ctx.videoId && ctx.provenanceVideoId === ctx.videoId);
  }

  function channelUnknown(ctx) {
    return !ctx.channelId && !ctx.handle && !ctx.channelUrl;
  }

  function recModifications(settings) {
    var mods = [];
    var r = (settings.youtube && settings.youtube.recommendations) || {};
    var sb = (settings.youtube && settings.youtube.sidebar) || {};
    if (r.hideShelves) mods.push('hide-shelves');
    if (r.hideUpNext) mods.push('hide-up-next');
    if (r.hideRelated) mods.push('hide-related');
    if (r.hideEndScreen) mods.push('hide-endscreen');
    if (sb.hideShorts) mods.push('hide-shorts-tab');
    if (sb.hideExplore) mods.push('hide-explore-tab');
    if (settings.youtube && settings.youtube.autoplay && settings.youtube.autoplay.disable) {
      mods.push('disable-autoplay');
    }
    return mods;
  }

  function evaluateContext(ctx, settings) {
    var now = ctx.now || Date.now();
    var yt = settings.youtube || {};
    var limits = settings.sessionLimits || {};
    var det = window.YTFOCUS.detector;

    // Gate 0: terminal Full Block has absolute precedence — locked until
    // local midnight. Only explicit exceptions and allowlisted study content
    // open. Snooze/grants never bypass it (a grant taken before the latch
    // simply expires unused; quota/config changes cannot unlock it).
    if (isTerminalActive(settings, now)) {
      if (det && det.isExceptionRoute(ctx.route, ctx.origin)) {
        return { action: 'allow', reason: 'exception' };
      }
      if (isVideoAllowlisted(settings, ctx.videoId)) return { action: 'allow', reason: 'terminal-allowlist' };
      if ((ctx.route === 'watch' || ctx.route === 'channel') && isChannelAllowlisted(settings, ctx)) {
        return { action: 'allow', reason: 'terminal-allowlist' };
      }
      return { action: 'block', reason: 'terminal-block', screen: 'full' };
    }

    // Gate 0b: snooze is state, not a mode — never mutates settings.mode.
    if (settings.snoozeUntil && now < settings.snoozeUntil) {
      return { action: 'allow', reason: 'snooze' };
    }

    // Gate 1: explicit exceptions (Watch Later, Studio) are always allowed.
    if (det && det.isExceptionRoute(ctx.route, ctx.origin)) {
      return { action: 'allow', reason: 'exception' };
    }

    // (Terminal precedence is handled at Gate 0 above.)

    var mode = effectiveMode(settings, now);
    var active = isBlockingActive(settings, now);

    // Gate 1.5: master OFF — YouTube is fully normal except the independent
    // Shorts switch (player-only). No limits, no CSS modifications, no rules.
    if (!active) {
      if (ctx.route === 'shorts' && independentShorts(settings)) {
        if (allowFirstShort(settings) && ctx.isEntryShort) {
          return { action: 'allow', reason: 'first-short' };
        }
        return { action: 'block', reason: 'shorts-independent', screen: 'shorts' };
      }
      return { action: 'allow', reason: 'inactive' };
    }

    // Gate 2: session limits apply only while blocking is active
    // (except snooze/exception above).
    // Shorts count cap: 0 = none allowed; N = N distinct presentations, then
    // block; null/undefined = unlimited. The entry Short is exempt from the
    // count (returning to it stays allowed); cap 0 still blocks everything.
    // Study-allowlisted Shorts and channels bypass like the video/time limits do.
    var isShortAllowed = isVideoAllowlisted(settings, ctx.videoId) || isChannelAllowlisted(settings, ctx);
    if (ctx.route === 'shorts' && !isShortAllowed) {
      var smax = (limits.shortsMax === null || limits.shortsMax === undefined) ? null : limits.shortsMax;
      if (smax === 0 || (!ctx.isEntryShort && typeof smax === 'number' && smax > 0 && (ctx.shortsSeen || 0) >= smax)) {
        return { action: 'block', reason: 'limit-shorts', screen: 'shorts' };
      }
    }
    var isWatchAllowed = isVideoAllowlisted(settings, ctx.videoId) || isChannelAllowlisted(settings, ctx);
    if (ctx.route === 'watch' && typeof limits.videosMax === 'number' && limits.videosMax >= 0) {
      if ((ctx.videosWatched || 0) >= limits.videosMax && !isWatchAllowed) {
        return { action: 'block', reason: 'limit-videos', screen: 'limit' };
      }
    }
    if (ctx.route === 'watch' && typeof limits.watchMinutes === 'number' && limits.watchMinutes > 0) {
      if ((ctx.watchMsToday || 0) >= limits.watchMinutes * 60000 && !isWatchAllowed) {
        return { action: 'block', reason: 'limit-time', screen: 'limit' };
      }
    }

    // Gate 3: full block.
    if (mode === 'full') {
      return { action: 'block', reason: 'full-block', screen: 'full' };
    }

    // Gate 3.5: daily quota exhausted (Normal/Restricted only — Study never
    // consumes, Full handled above).
    // When extra time is OFF (emergency.enabled === false), no extra time is granted:
    // YouTube blocks immediately as terminal-block until midnight.
    if ((mode === 'normal' || mode === 'restricted') && usageRemainingMs(settings, now) <= 0) {
      var emEnabled = !settings.emergency || settings.emergency.enabled !== false;
      if (!emEnabled) {
        return { action: 'block', reason: 'terminal-block', screen: 'full' };
      }
      return { action: 'block', reason: 'quota-exhausted', screen: 'limit' };
    }

    // Gate 4: study mode — only allowlisted channels/videos. Study consumes
    // neither global quota nor session/emergency allowance.
    if (mode === 'study') {
      if (ctx.route === 'shorts') {
        // Channel must be allowed (or the video itself allowlisted) first —
        // unlisted stays blocked regardless of the Shorts toggles.
        if (!isVideoAllowlisted(settings, ctx.videoId) && !isChannelAllowlisted(settings, ctx)) {
          return { action: 'block', reason: 'study-shorts', screen: 'study' };
        }
        // Allowed content: Block Shorts ON blocks everything; OFF applies
        // allow-first (entry plays, next blocks, back-to-entry plays again).
        if (independentShorts(settings)) {
          return { action: 'block', reason: 'shorts', screen: 'shorts' };
        }
        if (allowFirstShort(settings) && ctx.isEntryShort) {
          return { action: 'allow', reason: 'first-short' };
        }
        return { action: 'block', reason: 'shorts', screen: 'shorts' };
      }
      if (ctx.route === 'home' || ctx.route === 'explore' || ctx.route === 'trending') {
        return { action: 'block', reason: 'study-feed', screen: 'study' };
      }
      if (ctx.route === 'search') {
        var sp = (yt.search && yt.search.policy) || 'allow-clean';
        if (sp === 'block') return { action: 'block', reason: 'study-search-blocked', screen: 'study' };
        return { action: 'modify', reason: 'study-search', modifications: ['hide-shelves', 'filter-search', 'hide-up-next'] };
      }
      if (ctx.route === 'watch') {
        if (isVideoAllowlisted(settings, ctx.videoId)) return { action: 'allow', reason: 'study-allowlisted-video' };
        if (isChannelAllowlisted(settings, ctx)) {
          return { action: 'modify', reason: 'study-channel-ok', modifications: recModifications(settings) };
        }
        if (channelUnknown(ctx)) {
          // Channel not resolved yet — strip distractions, study-mode.js upgrades to block once resolved.
          return { action: 'modify', reason: 'study-check', modifications: recModifications(settings).concat(['study-pending']) };
        }
        return { action: 'block', reason: 'study-channel', screen: 'study' };
      }
      if (ctx.route === 'channel') {
        if (isChannelAllowlisted(settings, ctx)) return { action: 'allow', reason: 'study-channel-ok' };
        if (channelUnknown(ctx)) {
          return { action: 'modify', reason: 'study-check', modifications: ['study-pending'] };
        }
        return { action: 'block', reason: 'study-channel', screen: 'study' };
      }
      // subscriptions/playlist/library: allow page, strip recs
      return { action: 'modify', reason: 'study-strip', modifications: recModifications(settings) };
    }

    // Gate 5: restricted mode — discovery stripped, shorts rule binds.
    // Watch pages require same-tab search-click provenance (no URL-allow).
    if (mode === 'restricted') {
      if (ctx.route === 'shorts') {
        // Restricted owns first-short: the entry Short always plays,
        // independent of the Normal/Study allow-first preference.
        if (ctx.isEntryShort) {
          return { action: 'allow', reason: 'first-short' };
        }
        return { action: 'block', reason: 'shorts', screen: 'shorts' };
      }
      if (ctx.route === 'watch') {
        if (provenanceOk(ctx)) {
          return { action: 'modify', reason: 'restricted-strip', modifications: recModifications(settings) };
        }
        return { action: 'block', reason: 'restricted-provenance', screen: 'restricted' };
      }
      if (ctx.route === 'home' || ctx.route === 'explore' || ctx.route === 'trending') {
        return { action: 'block', reason: 'restricted-feed', screen: 'restricted' };
      }
      if (ctx.route === 'search' && yt.search && yt.search.policy === 'block') {
        return { action: 'block', reason: 'search-blocked', screen: 'restricted' };
      }
      // strict-allowlist: search shows only allowlisted channels/videos
      // (same allowlist filter as Study search).
      if (ctx.route === 'search' && yt.search && yt.search.policy === 'strict-allowlist') {
        return { action: 'modify', reason: 'search-allowlist', modifications: ['hide-shelves', 'filter-search', 'hide-up-next'] };
      }
      var rmods = recModifications(settings);
      if (ctx.route === 'search' || ctx.route === 'subscriptions') {
        return { action: 'modify', reason: 'restricted-strip', modifications: rmods };
      }
      return { action: 'allow', reason: 'restricted-allow' };
    }

    // Gate 6: normal mode — no shorts rule, independent toggle decides.
    if (ctx.route === 'shorts') {
      if (!independentShorts(settings)) {
        return { action: 'allow', reason: 'shorts-off' };
      }
      if (allowFirstShort(settings) && ctx.isEntryShort) {
        return { action: 'allow', reason: 'first-short' };
      }
      return { action: 'block', reason: 'shorts', screen: 'shorts' };
    }
    if ((ctx.route === 'home' && yt.homeFeed && yt.homeFeed.hide) ||
        ((ctx.route === 'explore' || ctx.route === 'trending') && yt.explore && yt.explore.hide)) {
      return { action: 'block', reason: 'feed-hidden', screen: 'restricted' };
    }
    if (ctx.route === 'search' && yt.search && yt.search.policy === 'block') {
      return { action: 'block', reason: 'search-blocked', screen: 'restricted' };
    }
    // strict-allowlist: search shows only allowlisted channels/videos.
    if (ctx.route === 'search' && yt.search && yt.search.policy === 'strict-allowlist') {
      return { action: 'modify', reason: 'search-allowlist', modifications: ['hide-shelves', 'filter-search', 'hide-up-next'] };
    }
    if (ctx.route === 'watch' || ctx.route === 'search') {
      var mods = recModifications(settings);
      // In normal mode only apply modifications the user enabled; if none, plain allow.
      if (mods.length) return { action: 'modify', reason: 'normal-strip', modifications: mods };
    }
    return { action: 'allow', reason: 'allow' };
  }

  window.YTFOCUS = window.YTFOCUS || {};
  window.YTFOCUS.policy = {
    evaluateContext: evaluateContext,
    effectiveMode: effectiveMode,
    scheduledMode: scheduledMode,
    activeSchedule: activeSchedule,
    scheduleMatches: scheduleMatches,
    isModeTransitionAllowed: isModeTransitionAllowed,
    isStudyActive: isStudyActive,
    isBlockingActive: isBlockingActive,
    isTerminalActive: isTerminalActive,
    usageRemainingMs: usageRemainingMs,
    quotaMinutes: quotaMinutes,
    provenanceOk: provenanceOk,
    governance: governance,
    shortsRuleFor: shortsRuleFor,
    isVideoAllowlisted: isVideoAllowlisted,
    isChannelAllowlisted: isChannelAllowlisted,
    isScheduleStrictLocked: isScheduleStrictLocked,
    scheduleStrictMinutesRemaining: scheduleStrictMinutesRemaining,
    isScheduleDueNotification: isScheduleDueNotification,
    isScheduleBreakActive: isScheduleBreakActive,
    getScheduleBreakCooldownRemaining: getScheduleBreakCooldownRemaining,
    getMaxSingleBreakMinutes: getMaxSingleBreakMinutes,
    calcScheduleDuration: calcScheduleDuration
  };
})();
