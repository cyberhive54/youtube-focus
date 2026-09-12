/* Orchestrator — loads settings, builds context, runs pure policy engine,
   executes decisions via enforcers + Shadow overlay. Only file with side effects. */
(function () {
  'use strict';

  var settings = null;
  var lastBlockKey = null;
  var lastShortsId = null;
  var lastWatchId = null;
  var studyRetries = 0;
  var watchTimer = null;
  // Entry tracking for allow-first-short: the Short the user OPENED (feed
  // click, URL visit, reload) plays; any move to a DIFFERENT Short blocks.
  // Fresh entry = arriving at /shorts/* from a non-Shorts page (or full load).
  var lastRoute = null;
  var entryShortsId = null;
  // Visit-scoped state (per tab document — a new tab/reload starts a visit).
  var askedSession = false;   // session popup already offered this visit
  var offerUrl = null;        // entry URL the live offer belongs to (SPA away dismisses it)
  var hadGrant = false;       // a session/emergency grant was active
  var lastInteractTs = 0;     // last click/key/scroll/wheel/touch
  var provenance = { videoId: null }; // last same-tab search-result click

  function today() {
    return window.YTFOCUS.store.todayKey();
  }

  function resetDayCountersIfNeeded() {
    var t = today();
    var sl = settings.sessionLimits;
    if (sl.shortsSeenDay !== t) { sl.shortsSeen = 0; sl.shortsSeenDay = t; sl.lastShortsId = ''; sl.lastShortsDay = ''; }
    if (sl.videosWatchedDay !== t) { sl.videosWatched = 0; sl.videosWatchedDay = t; sl.lastWatchId = ''; sl.lastWatchDay = ''; }
    if (sl.watchDay !== t) { sl.watchMsToday = 0; sl.watchDay = t; }
  }

  function buildContext(url) {
    var det = window.YTFOCUS.detector;
    var route = det.classifyRoute(url);
    var origin = det.getOrigin(url);
    var videoId = det.getVideoId(url);
    var ref = det.getChannelRef();
    resetDayCountersIfNeeded();
    return {
      url: url,
      route: route,
      origin: origin,
      videoId: videoId,
      channelId: ref.id,
      handle: ref.handle,
      channelUrl: ref.url,
      isShort: route === 'shorts',
      provenanceVideoId: provenance.videoId,
      now: Date.now(),
      dayKey: today(),
      shortsSeen: settings.sessionLimits.shortsSeen || 0,
      videosWatched: settings.sessionLimits.videosWatched || 0,
      watchMsToday: settings.sessionLimits.watchMsToday || 0
    };
  }

  function trackNavigationCounters(ctx) {
    var dirty = false;
    var sl = settings.sessionLimits;
    var t = today();
    var pol = null;
    try { pol = window.YTFOCUS.policy; } catch (e0) {}
    if (ctx.route === 'shorts' && ctx.videoId) {
      // Fresh entry (not a scroll from another Short): this ID becomes the
      // allowed entry Short. Same-document reloads also count as entries.
      if (lastRoute !== 'shorts' || !lastShortsId) {
        entryShortsId = ctx.videoId;
      }
      // Reloads/new tabs share the day's persisted memory (P1: counters must
      // survive a reload — hydrate once per document).
      if (lastShortsId == null && sl.lastShortsId && sl.lastShortsDay === t) {
        lastShortsId = sl.lastShortsId;
      }
      ctx.isEntryShort = ctx.videoId === entryShortsId;
      // Returning to the entry Short is free (not a new presentation), and
      // study-allowlisted videos never consume the count.
      var vidAllowed = false;
      try { vidAllowed = pol && pol.isVideoAllowlisted(settings, ctx.videoId); } catch (e1) {}
      if (lastShortsId && ctx.videoId !== lastShortsId && ctx.videoId !== entryShortsId && !vidAllowed) {
        sl.shortsSeen = (sl.shortsSeen || 0) + 1;
        dirty = true;
      }
      if (lastShortsId !== ctx.videoId) {
        lastShortsId = ctx.videoId;
        sl.lastShortsId = ctx.videoId;
        sl.lastShortsDay = t;
        dirty = true;
      }
    } else if (ctx.route !== 'shorts') {
      // Keep lastShortsId for back-navigation detection (do not reset here).
    }
    if (ctx.route === 'watch' && ctx.videoId) {
      // Same persistence rule: a reload of the same video is a revisit
      // (no count); a different video after reload is new (count it).
      if (lastWatchId == null && sl.lastWatchId && sl.lastWatchDay === t) {
        lastWatchId = sl.lastWatchId;
      }
      var wAllowed = false;
      try { wAllowed = pol && pol.isVideoAllowlisted(settings, ctx.videoId); } catch (e2) {}
      if (lastWatchId && ctx.videoId !== lastWatchId && !wAllowed) {
        sl.videosWatched = (sl.videosWatched || 0) + 1;
        dirty = true;
      }
      if (lastWatchId !== ctx.videoId) {
        lastWatchId = ctx.videoId;
        sl.lastWatchId = ctx.videoId;
        sl.lastWatchDay = t;
        dirty = true;
      }
    }
    lastRoute = ctx.route;
    if (dirty) persistSoon();
  }

  var persistT = null;
  function persistSoon() {
    if (persistT) return;
    persistT = setTimeout(function () {
      persistT = null;
      if (!settings) return;
      // Read-modify-write with max-merge: other tabs may have incremented the
      // shared counters since our in-memory copy was synced. Blind whole-object
      // writes lose those increments (fail-open for limits). Caps come from
      // stored (options edits land there first).
      chrome.storage.local.get('sessionLimits').then(function (res) {
        try {
          settings.sessionLimits = window.YTFOCUS.store.mergeSessionLimits(
            res && res.sessionLimits, settings.sessionLimits, today());
        } catch (e) {}
        return chrome.storage.local.set({ sessionLimits: settings.sessionLimits });
      }).catch(function () {});
    }, 800);
  }

  function bumpBlocked(reason, screen) {
    var key = location.href + '|' + reason;
    if (key === lastBlockKey) return;
    lastBlockKey = key;
    try {
      var st = window.YTFOCUS.store;
      if (screen === 'shorts' || reason === 'shorts' || reason === 'study-shorts') {
        st.bumpStat(settings, 'shortsBlocked', 1);
      } else {
        st.bumpStat(settings, 'youtubeBlocked', 1);
      }
      st.bumpStat(settings, 'distractionsBlocked', 1);
      chrome.storage.local.set({ stats: settings.stats }).catch(function () {});
      chrome.runtime.sendMessage({ type: 'ytf:blocked', reason: reason }).catch(function () {});
    } catch (e) {}
  }

  function execute(url) {
    if (!settings) return;
    var pol = window.YTFOCUS.policy;
    var overlay = window.YTFOCUS.overlay;
    // Midnight-due allowlist edits activate on next run (cheap no-op when empty).
    try {
      if (window.YTFOCUS.store.applyPendingStudy(settings.study, Date.now())) {
        chrome.storage.local.set({ study: settings.study }).catch(function () {});
      }
    } catch (e) {}
    var ctx = buildContext(url);
    trackNavigationCounters(ctx);
    // Rebuild after counter increments (limits depend on them)
    ctx.shortsSeen = settings.sessionLimits.shortsSeen || 0;
    ctx.videosWatched = settings.sessionLimits.videosWatched || 0;
    ctx.watchMsToday = settings.sessionLimits.watchMsToday || 0;
    // Provenance reconciles against the CURRENT page: the exact clicked
    // video keeps it; any other video, or any non-search/non-watch page,
    // voids it (channel/playlist/history/direct URLs never inherit it).
    try {
      if (provenance.videoId) {
        if (ctx.route === 'watch' || ctx.route === 'shorts') {
          if (ctx.videoId !== provenance.videoId) provenance.videoId = null;
        } else if (ctx.route !== 'search') {
          provenance.videoId = null;
        }
      }
      ctx.provenanceVideoId = provenance.videoId;
    } catch (_pe) {}

    var decision;
    try {
      decision = pol.evaluateContext(ctx, settings);
    } catch (e) { return; }

    // Hiding styles reflect ACTIVE blocking only. When blocking is explicitly off
    // (snooze), the page is exempt (Watch Later, Studio), or master is OFF
    // (inactive), YouTube must be fully restored — otherwise a snoozed or
    // unblocked page would keep its feed/shelves hidden behind no overlay.
    // Policy-allowed pages (allowlisted study content, first short, shorts-off)
    // keep the user's stripping preferences. The independent Shorts block is
    // overlay-only by design (player scope): zero DOM hiding.
    var clearReasons = { snooze: 1, exception: 1, inactive: 1 };
    if (clearReasons[decision.reason]) {
      try {
        window.YTFOCUS.shorts.clearStyle();
        window.YTFOCUS.feed.clearStyle();
        window.YTFOCUS.recs.clearStyle();
      } catch (e) {}
    } else if (decision.reason === 'shorts-independent') {
      try {
        window.YTFOCUS.recs.applyModifications(decision.modifications || []);
      } catch (e) {}
    } else {
      try {
        window.YTFOCUS.shorts.applyModifications(decision.modifications || [], settings);
        window.YTFOCUS.feed.applyModifications(decision.modifications || [], settings);
        window.YTFOCUS.recs.applyModifications(decision.modifications || []);
      } catch (e) {}
      // A feed BLOCK must hide the column even when the user's feed toggles are
      // off: toggles shape Normal mode only, but Restricted/Study bind these
      // pages outright. Without this the card shows above a scrollable feed.
      if (decision.action === 'block' &&
          (ctx.route === 'home' || ctx.route === 'explore' || ctx.route === 'trending')) {
        try { window.YTFOCUS.feed.ensureStyle(); } catch (e2) {}
      }
    }

    // Fresh-visit session offer takes precedence over any allow AND any
    // mode block (except terminal/full/study/quota screens, which
    // maybeOfferSession itself excludes): entering YouTube always starts with
    // the session choice while quota remains. Exempt a playing entry Short
    // (allow-first promise beats the popup; the offer comes on the next
    // non-Shorts pass). SPA navigations share the visit (askedSession).
    if (!(ctx.route === 'shorts' && decision.reason === 'first-short') && maybeOfferSession(false)) return;

    // A live session offer must survive re-executes (observer churn, YT's
    // initial route resolution): re-rendering the underlying block strands
    // the visit with no choices. The offer belongs to its entry URL — any
    // navigation away (same- or cross-document) releases it so enforcement
    // runs for the new page. Only a grant, quota/mode change or expiry flow
    // otherwise dismisses it.
    try {
      var _sov = window.YTFOCUS.overlay;
      var _ssc = (_sov && _sov.currentScreen) ? _sov.currentScreen() : 'noapi';
      var _samePage = false;
      try {
        _samePage = !!offerUrl && location.href.split('#')[0] === offerUrl.split('#')[0];
      } catch (_su) { _samePage = false; }
      if (askedSession && _samePage && _ssc === 'session' && _offerStillValid()) return;
    } catch (_se) {}

    if (decision.action === 'allow') {
      overlay.hideBlockedScreen();
      // Unblock = sound back: restore videos WE muted (never the user's own).
      try { window.YTFOCUS.shorts.restoreMutedVideos(); } catch (e) {}
      lastBlockKey = null;
      // First-short scroll hook: watching short #1, block when ID changes
      if (ctx.route === 'shorts' && decision.reason === 'first-short') {
        window.YTFOCUS.shorts.hookScrollCounting(function () {
          try { return window.YTFOCUS.detector.getVideoId(location.href); }
          catch (e) { return null; }
        }, function () { execute(location.href); });
      }
      if (ctx.route === 'search' && decision.reason === 'study-search') {
        window.YTFOCUS.study.filterSearch(settings);
      } else if (ctx.route !== 'search') {
        window.YTFOCUS.study.clearSearchMarks();
      }
      // Upgrade path: study-check means channel unresolved — retry as DOM loads
      if (decision.reason === 'study-check') {
        if (studyRetries < 6) {
          studyRetries++;
          setTimeout(function () { execute(location.href); }, 1200);
        }
        // If retries exhausted and channel still unknown, block to be safe in study
        if (studyRetries >= 6) {
          var chk = window.YTFOCUS.study.currentChannelMatches(settings);
          if (!chk.known || !chk.allowed) {
            showBlock('study', 'study-channel', 'This isn’t on your allowlist yet.');
            return;
          }
        }
      } else {
        studyRetries = 0;
      }
      return;
    }

    if (decision.action === 'modify') {
      overlay.hideBlockedScreen();
      if ((decision.modifications || []).indexOf('filter-search') !== -1 && ctx.route === 'search') {
        window.YTFOCUS.study.filterSearch(settings);
      } else if (ctx.route === 'search') {
        // Search results previously hidden by allowlist filtering must come
        // back when the active policy no longer filters (e.g. strict-allowlist
        // turned off): stale display:none would otherwise persist.
        try { window.YTFOCUS.study.clearSearchMarks(); } catch (e3) {}
      }
      if ((decision.modifications || []).indexOf('study-pending') !== -1) {
        // Channel pending: retry, then block if not allowlisted
        if (studyRetries < 6) {
          studyRetries++;
          setTimeout(function () { execute(location.href); }, 1200);
        } else {
          var chk2 = window.YTFOCUS.study.currentChannelMatches(settings);
          if (!chk2.known || !chk2.allowed) {
            showBlock('study', 'study-channel', 'This isn’t on your allowlist yet.');
            return;
          }
        }
      }
      return;
    }

    // BLOCK
    showBlock(decision.screen || 'shorts', decision.reason, null);
  }

  // Per-screen presentation with safe fallback: unsupported route/setting
  // combos render the overlay wall instead of failing silently.
  var INLINE_SCREENS = { shorts: 1, restricted: 1, study: 1, full: 1, limit: 1 };
  function presentationFor(screen) {
    try {
      var p = (settings && settings.presentation) || {};
      if (p[screen] === 'inline' || p[screen] === 'overlay') return p[screen];
    } catch (e) {}
    var d = window.YTFOCUS.CONSTANTS.DEFAULTS.presentation || {};
    return d[screen] || 'overlay';
  }

  function showBlock(screen, reason, detail) {
    var overlay = window.YTFOCUS.overlay;
    // A block rendering over an already-fullscreen page must pull it out —
    // native fullscreen would otherwise hide the block itself.
    exitFullscreenIfBlocked();
    if (screen === 'shorts' || screen === 'study' || screen === 'full' || screen === 'limit') {
      window.YTFOCUS.shorts.pauseShortsVideo();
    }
    try {
      document.querySelectorAll('video').forEach(function (v) {
        try { v.pause(); } catch (e) {}
      });
    } catch (e) {}
    var opts = {
      screen: screen,
      reason: reason,
      detail: detail || undefined,
      strictMode: !!(settings && settings.strictMode),
      allowedChannels: (settings && settings.study && settings.study.allowedChannels) || [],
      allowedVideos: (settings && settings.study && settings.study.allowedVideos) || []
    };
    // Session + emergency choices for the pause sheet (computed minutes,
    // already capped). Session choices come from option percents of quota;
    // emergency choices from option percents of quota capped by pool + uses.
    // Screens: 'session' offers session choices; quota-exhausted offers
    // emergency; every other card offers whichever pool still has room.
    try {
      var st = window.YTFOCUS.store;
      var quotaMin = st.quotaMinutes(settings);
      var quotaRemMin = st.usageRemainingMs(settings, Date.now()) / 60000;
      opts.quotaRemainingMin = Math.max(0, Math.floor(quotaRemMin * 10) / 10);
      opts.quotaMin = quotaMin;
      var sessPcts = (((settings.session || {}).optionsPercent) || [5, 10, 20, 30]).slice(0, 4);
      opts.sessionChoices = sessPcts.map(function (p) {
        var fullMin = quotaMin * p / 100;
        var g = st.sessionGrantMin(fullMin, quotaRemMin * 60000);
        return { pct: p, fullMin: Math.floor(fullMin * 10) / 10, granted: g, ok: g > 0 };
      });
      // Fallback when remaining quota is smaller than every configured
      // option (mirrors the popup): offer the exact remainder, never more.
      // Only when the remainder itself grants something (sub-6s slivers are
      // unreachable via the 15s accrual quantum — all pills stay disabled).
      if (quotaRemMin > 0 && !opts.sessionChoices.some(function (x) { return x.ok; })) {
        var _fg = Math.floor(quotaRemMin * 10) / 10;
        if (_fg > 0) opts.sessionChoices.push({ pct: null, fullMin: _fg, granted: _fg, ok: true, fallback: true });
      }
      if (st.budgetOn(settings)) {
        var emPcts = (st.emergencyOf(settings).optionPercents || []).slice(0, 4);
        var poolRemMs = st.emergencyRemaining(settings, Date.now()) * 60000;
        var usesLeft = st.emergencyUsesLeft(settings, Date.now());
        opts.emergencyChoices = emPcts.map(function (p) {
          var fullMin = quotaMin * p / 100;
          var g = st.emergencyGrantMin(fullMin, poolRemMs, usesLeft);
          return { pct: p, fullMin: Math.floor(fullMin * 10) / 10, granted: g, ok: g > 0 };
        });
        opts.emergencyUsesLeft = usesLeft;
        opts.emergencyPoolMin = poolRemMs === Infinity ? null : Math.floor(poolRemMs / 6000) / 10;
      } else {
        opts.emergencyChoices = null;
      }
      // Only time-decision screens expose time choices. A content or mode
      // block must not quietly become an escape hatch through its card.
      if (screen === 'session') opts.pauseKind = 'session';
      else if (reason === 'quota-exhausted') opts.pauseKind = 'emergency';
      else opts.pauseKind = null;
      // "Why am I seeing this?" lines: quantitative, plain-language, no jargon.
      // (The card falls back to the rule subtitle when no lines apply.)
      try {
        var _why = [];
        var _usedMin = Math.max(0, quotaMin - quotaRemMin);
        if (screen === 'session' || reason === 'quota-exhausted') {
          _why.push(Math.floor(_usedMin) + ' / ' + quotaMin + ' min used.');
        }
        if (st.budgetOn(settings) && (screen === 'session' || reason === 'quota-exhausted' || reason === 'terminal-block')) {
          var _eu = Math.round((((settings.emergency || {}).usedPoolMin) || 0) * 10) / 10;
          var _ep = Math.floor(st.emergencyPoolMs(settings) / 60000 * 10) / 10;
          var _eul = st.emergencyUsesLeft(settings, Date.now());
          _why.push('Extra time: ' + _eu + ' / ' + _ep + ' min used' +
            (_eul !== Infinity ? ', ' + _eul + (_eul === 1 ? ' start' : ' starts') + ' left' : '') + '.');
        }
        if (reason === 'terminal-block' || reason === 'quota-exhausted' || screen === 'limit') {
          _why.push('Next reset: 12:00 AM.');
        }
        if (screen === 'study') {
          var _ac = ((settings.study || {}).allowedChannels || []).length;
          var _av = ((settings.study || {}).allowedVideos || []).length;
          if (_ac || _av) _why.push('Allowlisted: ' + _ac + ' channels, ' + _av + ' videos.');
        }
        if (reason === 'limit-shorts') {
          var _cap = settings.sessionLimits ? settings.sessionLimits.shortsMax : null;
          _why.push('Daily Shorts limit: ' + (_cap === null || _cap === undefined ? 'unlimited' : _cap) + '.');
        }
        opts.whyLines = _why;
      } catch (_we) {}
      // Terminal lock: the terminal wall offers no session/emergency sheet.
      try {
        if (window.YTFOCUS.policy.isTerminalActive(settings, Date.now())) opts.pauseKind = null;
      } catch (_te2) {}
      opts.masterOn = !!(window.YTFOCUS.policy && window.YTFOCUS.policy.isBlockingActive(settings, Date.now()));
    } catch (e) {}
    try {
      opts.route = window.YTFOCUS.detector.classifyRoute(location.href);
      opts.mode = window.YTFOCUS.policy.effectiveMode(settings, Date.now());
    } catch (e) {}
    var usedInline = false;
    if (presentationFor(screen) === 'inline' && INLINE_SCREENS[screen]) {
      try {
        var route = window.YTFOCUS.detector.classifyRoute(location.href);
        usedInline = overlay.showInlineCard(opts, route);
      } catch (e) { usedInline = false; }
    }
    if (!usedInline) {
      overlay.showBlockedScreen(opts);
    }
    bumpBlocked(reason, screen);
  }

  // Playback guard: with any block showing, space/k/f would unpause or
  // fullscreen the hidden video behind the card/wall — and native fullscreen
  // renders ABOVE all page content, so it would hide our block entirely.
  // Arrows still navigate (URL change → still blocked → card persists).
  function blockShowing() {
    try {
      var ov = window.YTFOCUS.overlay;
      return !!(ov && (ov.isShown() || ov.inlineIsShown()));
    } catch (e) { return false; }
  }

  function pauseAllVideos() {
    try {
      document.querySelectorAll('video').forEach(function (v) { v.pause(); });
    } catch (e) {}
  }

  function exitFullscreenIfBlocked() {
    try {
      if (blockShowing() && document.fullscreenElement && document.exitFullscreen) {
        var p = document.exitFullscreen();
        if (p && p.catch) p.catch(function () {});
      }
    } catch (e) {}
  }

  function guardShortsKeys() {
    document.addEventListener('keydown', function (e) {
      try {
        // Never break text entry: inputs, search boxes, comments.
        var det = window.YTFOCUS.detector;
        if (det && det.isEditableTarget(e.target)) return;
        if (!blockShowing()) return;
        if (e.key === ' ' || e.key === 'k' || e.key === 'f') {
          e.preventDefault();
          e.stopPropagation();
          pauseAllVideos();
        }
      } catch (e3) {}
    }, true);
    // Entering fullscreen (button, double-click, API) while blocked must bounce
    // straight back out — nothing may play above the block.
    document.addEventListener('fullscreenchange', function () {
      try {
        if (!blockShowing()) return;
        if (document.fullscreenElement) {
          exitFullscreenIfBlocked();
          pauseAllVideos();
        }
      } catch (e4) {}
    });
  }

  // ---- activity + heartbeat (v2 usage accounting) --------------------------------
  // Active = visible tab AND (video playing OR interaction within 2 min).
  // Hidden tabs and idle time never count. Study/Full/terminal/blocks never
  // accrue (only Normal/Restricted usage spends the quota).
  function noteInteraction() {
    lastInteractTs = Date.now();
  }

  function wireActivityListeners() {
    ['click', 'keydown', 'wheel', 'touchmove', 'scroll'].forEach(function (t) {
      try {
        window.addEventListener(t, noteInteraction, { passive: true });
        document.addEventListener(t, noteInteraction, { passive: true });
      } catch (e) {}
    });
  }

  function videoPlaying() {
    try {
      var vids = document.querySelectorAll('video');
      for (var i = 0; i < vids.length; i++) {
        var v = vids[i];
        if (v && !v.paused && !v.ended && v.currentTime > 0) return true;
      }
    } catch (e) {}
    return false;
  }

  function heartbeatActive() {
    try {
      if (document.visibilityState && document.visibilityState !== 'visible') return false;
    } catch (e) {}
    if (videoPlaying()) return true;
    return (Date.now() - lastInteractTs) < 2 * 60 * 1000;
  }

  function persistUsage() {
    if (!settings || !settings.usage) return;
    chrome.storage.local.set({ usage: settings.usage }).catch(function () {});
  }

  function startHeartbeat() {
    setInterval(function () {
      if (!settings) return;
      try {
        var now = Date.now();
        var store = window.YTFOCUS.store;
        var pol = window.YTFOCUS.policy;
        // Keep day-bound state fresh even on quiet pages.
        if (store.normalizeUsageDay(settings, now)) persistUsage();
        try {
          var _rt = store.todayKey(new Date(now));
          settings.reminders = settings.reminders || {};
          if (settings.reminders.triggeredDay !== _rt) {
            settings.reminders.triggeredToday = [];
            settings.reminders.triggeredDay = _rt;
            chrome.storage.local.set({ reminders: settings.reminders }).catch(function () {});
          }
        } catch (e0) {}
        if (store.emergencyRollover(settings, now)) {
          chrome.storage.local.set({ emergency: settings.emergency }).catch(function () {});
        }
        if (settings.study && store.applyPendingStudy(settings.study, now)) {
          chrome.storage.local.set({ study: settings.study }).catch(function () {});
        }
        // Session expiry: grant ended -> offer again if quota remains.
        var granted = settings.snoozeUntil && settings.snoozeUntil > now;
        if (hadGrant && !granted) {
          hadGrant = false;
          maybeOfferSession(true);
        } else if (granted) {
          hadGrant = true;
        }
        // Terminal latch: quota exhausted + emergency spent.
        maybeLatchTerminal(now);
        // Usage accrual.
        if (!heartbeatActive()) return;
        if (!pol.isBlockingActive(settings)) return;
        if (pol.isTerminalActive(settings, now)) return;
        var mode = pol.effectiveMode(settings, now);
        if (mode !== 'normal' && mode !== 'restricted') return;
        if (blockShowing()) return;
        settings.usage.activeMsToday = (settings.usage.activeMsToday || 0) + 15000;
        persistUsage();
        // Reminders: fire each newly-crossed checkpoint once per day.
        var due = [];
        try { due = store.remindersDue(settings, settings.usage.activeMsToday); } catch (e) {}
        if (due.length) {
          settings.reminders = settings.reminders || {};
          settings.reminders.triggeredToday = (settings.reminders.triggeredToday || []).concat(due);
          settings.reminders.triggeredDay = store.todayKey(new Date(now));
          chrome.storage.local.set({ reminders: settings.reminders }).catch(function () {});
          var qm = store.quotaMinutes(settings);
          // One consolidated reminder: the highest crossed checkpoint.
          var top = Math.max.apply(null, due);
          try {
            window.YTFOCUS.overlay.showReminderToast(
              'You’ve used ' + top + '% of today’s YouTube time (' + qm + ' min quota).');
          } catch (e2) {}
        }
      } catch (e) {}
    }, 15000);
  }

  // Terminal latch: quota exhausted AND emergency spent -> Full Block until
  // local midnight (allowlist excepted by the engine). Set here; enforced on
  // the next execute. SW tick mirrors this as backstop.
  function maybeLatchTerminal(now) {
    try {
      var store = window.YTFOCUS.store;
      var pol = window.YTFOCUS.policy;
      if (!pol.isBlockingActive(settings)) return false;
      if (pol.isTerminalActive(settings, now)) return true;
      var mode = pol.effectiveMode(settings, now);
      if (mode !== 'normal' && mode !== 'restricted') return false;
      if (store.usageRemainingMs(settings, now) > 0) return false;
      var e = store.emergencyOf(settings);
      if (!e.enabled) {
        // Extra-time disabled: quota exhaustion immediately latches terminal block
        var t = store.todayKey(new Date(now));
        settings.terminal = { active: true, day: t };
        chrome.storage.local.set({ terminal: settings.terminal }).catch(function () {});
        return true;
      }
      var spent = (e.useCap && store.emergencyUsesLeft(settings, now) <= 0) ||
        (e.poolCap && store.emergencyRemaining(settings, now) <= 0);
      // Unlimited emergency (no caps) never exhausts -> terminal unreachable.
      if (!e.useCap && !e.poolCap) return false;
      if (!spent) return false;
      var t = store.todayKey(new Date(now));
      settings.terminal = { active: true, day: t };
      chrome.storage.local.set({ terminal: settings.terminal }).catch(function () {});
      return true;
    } catch (e) { return false; }
  }

  // Session popup on fresh entry: pause + offer choices. Once per visit.
  // The execute() guard keeps a live offer across re-executes while every
  // offer condition (minus already-asked) still holds — exceptions fail
  // toward enforcement, never toward a stuck offer.
  function _offerStillValid() {
    try {
      if (!settings) return false;
      var _p = window.YTFOCUS.policy;
      var _now = Date.now();
      if (!_p || !_p.isBlockingActive(settings, _now)) return false;
      if (_p.isTerminalActive(settings, _now)) return false;
      var _m = _p.effectiveMode(settings, _now);
      if (_m !== 'normal' && _m !== 'restricted') return false;
      if (settings.snoozeUntil && settings.snoozeUntil > _now) return false;
      if (window.YTFOCUS.store.usageRemainingMs(settings, _now) <= 0) return false;
      return true;
    } catch (_e) { return false; }
  }

  function maybeOfferSession(fromExpiry) {
    try {
      if (askedSession && !fromExpiry) return false;
      if (!settings) return false;
      var store = window.YTFOCUS.store;
      var pol = window.YTFOCUS.policy;
      var now = Date.now();
      if (!pol.isBlockingActive(settings)) return false;
      if (pol.isTerminalActive(settings, now)) return false;
      var mode = pol.effectiveMode(settings, now);
      if (mode !== 'normal' && mode !== 'restricted') return false;
      if (store.usageRemainingMs(settings, now) <= 0) return false;
      if (settings.snoozeUntil && settings.snoozeUntil > now) return false;
      askedSession = true;
      try { offerUrl = location.href; } catch (_oe) { offerUrl = null; }
      pauseAllVideos();
      showBlock('session', fromExpiry ? 'session-expired' : 'session-start', null);
      return true;
    } catch (e) { return false; }
  }

  function startWatchTimer() {
    if (watchTimer) return;
    watchTimer = setInterval(function () {
      if (!settings) return;
      try {
        var route = window.YTFOCUS.detector.classifyRoute(location.href);
        if (route !== 'watch') return;
        var v = document.querySelector('video');
        if (v && !v.paused && !v.ended && v.currentTime > 0) {
          resetDayCountersIfNeeded();
          settings.sessionLimits.watchMsToday = (settings.sessionLimits.watchMsToday || 0) + 5000;
          persistSoon();
        }
      } catch (e) {}
    }, 5000);
  }

  // Restricted provenance: capture same-tab clicks on search-result video
  // links. Recorded on press (pointerdown/keydown) AND click capture: YT's
  // own handlers can run first at the same phase and SPA-navigate before a
  // document-level click listener runs, losing the search origin — press-time
  // location is always pre-navigation. Cleared lazily in execute() against
  // the current page (not onNavigate: YT emits intermediate navigations for
  // a single user action, and clearing there races the arrival). New tabs
  // start empty (per-document memory), which is what blocks new-tab opens.
  function _recordProvenanceClick(e) {
    try {
      var det = window.YTFOCUS.detector;
      if (!det) return;
      if (det.classifyRoute(location.href) !== 'search') return;
      var t = e.target;
      if (!t || !t.closest) return;
      var a = t.closest('a[href*="watch?v="]');
      if (!a) return;
      var id = det.getVideoId(a.getAttribute('href') || '');
      if (id) provenance.videoId = id;
    } catch (err) {}
  }
  function wireProvenanceTracking() {
    document.addEventListener('click', _recordProvenanceClick, true);
    document.addEventListener('pointerdown', _recordProvenanceClick, true);
    document.addEventListener('keydown', function (e) {
      try {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        _recordProvenanceClick(e);
      } catch (_ke) {}
    }, true);
  }

  function bumpBypassAttempt() {
    try {
      window.YTFOCUS.store.bumpStat(settings, 'bypassAttempts', 1);
      chrome.storage.local.set({ stats: settings.stats }).catch(function () {});
    } catch (err) {}
  }

  function wireOverlayEvents() {
    // Session/emergency grant starter (replaces free-form snooze: every pause
    // spends quota via the session or the emergency pool). Spend is allowed
    // even under Strict (config stays locked); unaffordable/tampered attempts
    // count as bypasses like the old strict tripwire did.
    document.addEventListener('ytf:grant', function (e) {
      if (!settings) return;
      var store = window.YTFOCUS.store;
      var d = (e && e.detail) || {};
      var kind = d.kind === 'emergency' ? 'emergency' : 'session';
      var wantMin = Math.max(0, parseFloat(d.minutes) || 0);
      if (!(wantMin > 0)) return;
      var now = Date.now();
      // Terminal Full Block is absolute: no grant path may unlock it. Only
      // allowlisted content opens until midnight (policy Gate 0).
      try {
        if (window.YTFOCUS.policy.isTerminalActive(settings, now)) return;
      } catch (_te) {}
      store.emergencyRollover(settings, now);
      var granted = 0;
      if (kind === 'emergency') {
        if (!store.budgetOn(settings)) return;
        var usesLeft = store.emergencyUsesLeft(settings, now);
        if (!(usesLeft > 0)) { bumpBypassAttempt(); return; }
        var poolRem = store.emergencyRemaining(settings, now);
        granted = store.emergencyGrantMin(wantMin, poolRem * 60000, usesLeft);
        if (!(granted > 0)) { bumpBypassAttempt(); return; }
        var em = settings.emergency || {};
        em.usedPoolMin = (em.usedPoolMin || 0) + granted;
        em.usedUses = (em.usedUses || 0) + 1;
        em.poolDay = store.todayKey(new Date(now));
        settings.emergency = em;
        chrome.storage.local.set({ emergency: em }).catch(function () {});
      } else {
        granted = store.sessionGrantMin(wantMin, store.usageRemainingMs(settings, now));
        if (!(granted > 0)) return;
        settings.session = settings.session || {};
        settings.session.lastGrant = { kind: 'session', min: granted, at: now };
        settings.usage = settings.usage || {};
        if (settings.usage.activeDay !== store.todayKey(new Date(now))) {
          settings.usage.activeMsToday = 0;
          settings.usage.sessionsToday = 0;
          settings.usage.activeDay = store.todayKey(new Date(now));
        }
        settings.usage.sessionsToday = (settings.usage.sessionsToday || 0) + 1;
      }
      settings.snoozeUntil = now + Math.round(granted * 60000);
      var patch = { snoozeUntil: settings.snoozeUntil, session: settings.session };
      if (kind === 'emergency') patch.emergency = settings.emergency;
      if (kind === 'session') patch.usage = settings.usage;
      chrome.storage.local.set(patch).catch(function () {});
      chrome.runtime.sendMessage({ type: 'ytf:snooze', until: settings.snoozeUntil }).catch(function () {});
      hadGrant = true;
      try { offerUrl = null; } catch (_oo) {}
      try { window.YTFOCUS.shorts.restoreMutedVideos(); } catch (e2) {}
      window.YTFOCUS.overlay.hideBlockedScreen();
      setTimeout(function () { execute(location.href); }, 300);
    });
    document.addEventListener('ytf:navigate', function (e) {
      var href = e.detail && e.detail.href;
      if (href) location.href = href;
    });
    document.addEventListener('ytf:switch-study', function () {
      var now = Date.now();
      var channels = (settings.study && settings.study.allowedChannels) || [];
      var videos = (settings.study && settings.study.allowedVideos) || [];
      if (channels.length === 0 && videos.length === 0) {
        chrome.runtime.sendMessage({ type: 'ytf:open-options' }).catch(function () {});
        return;
      }
      var sch = null;
      try { sch = window.YTFOCUS.policy && window.YTFOCUS.policy.activeSchedule(settings, now); } catch (e) {}
      if (sch) {
        if (!settings.study) settings.study = {};
        settings.study.scheduleOverrideMode = 'study';
        chrome.storage.local.set({ study: settings.study }).then(function () {
          var firstChan = channels[0];
          if (firstChan && (firstChan.url || firstChan.handle)) {
            location.href = 'https://www.youtube.com' + (firstChan.url || firstChan.handle);
          } else {
            execute(location.href);
          }
        });
      } else {
        chrome.storage.local.set({ mode: 'study' }).then(function () {
          var firstChan = channels[0];
          if (firstChan && (firstChan.url || firstChan.handle)) {
            location.href = 'https://www.youtube.com' + (firstChan.url || firstChan.handle);
          } else {
            execute(location.href);
          }
        });
      }
    });
  }

  function init() {
    window.YTFOCUS.store.getSettings().then(function (s) {
      settings = s;
      resetDayCountersIfNeeded();
      window.YTFOCUS.router.hookHistory();
      wireOverlayEvents();
      guardShortsKeys();
      wireActivityListeners();
      wireProvenanceTracking();
      execute(location.href);
      window.YTFOCUS.router.onNavigate(function (url) {
        lastBlockKey = null;
        studyRetries = 0;
        // A session offer belongs to its entry URL, not the destination:
        // navigating away dismisses it so the delayed re-execute enforces
        // for the new URL. Same-URL resolutions (YT's initial route setup,
        // popstate/hash noise) keep a live, still-valid offer. Other screens
        // persist untouched until that re-execute replaces them.
        try {
          var _nov = window.YTFOCUS.overlay;
          if (_nov && _nov.currentScreen && _nov.currentScreen() === 'session' &&
              url && offerUrl && url !== offerUrl) _nov.hideBlockedScreen();
        } catch (_ne) {}
        setTimeout(function () { execute(url); }, 250);
      });
      window.YTFOCUS.domObserver.onDomChange(function () { execute(location.href); });
      window.YTFOCUS.domObserver.start();
      startWatchTimer();
      startHeartbeat();
      // Foregrounding re-evaluates immediately: background tabs may have had
      // timers suspended, so enforcement could be stale when the user returns.
      // Event-driven, no polling.
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState !== 'visible' || !settings) return;
        try { execute(location.href); } catch (e) {}
      });
      // Schedule-boundary propagation: the service worker cannot push to tabs
      // (no tabs permission by design), so each tab re-evaluates once a minute.
      // An open tab then transitions into/out of scheduled modes with no
      // reload, navigation, or popup interaction. Cheap: execute() is already
      // observer-driven far more often than this.
      setInterval(function () {
        if (!settings) return;
        try { execute(location.href); } catch (e) {}
      }, 60000);
    }).catch(function () {});

    chrome.storage.onChanged.addListener(function (changes) {
      if (!settings) return;
      var keys = Object.keys(changes);
      // Options Reset clears storage: every key arrives with newValue
      // undefined. Merging that would hollow in-memory settings and leave
      // the tab fail-open, so refetch clean defaults instead — no reload.
      var wiped = keys.length > 0 && keys.every(function (k) { return changes[k] && changes[k].newValue === undefined; });
      if (wiped) {
        lastBlockKey = null;
        window.YTFOCUS.store.getSettings().then(function (s) {
          settings = s;
          try { execute(location.href); } catch (eW) {}
        }).catch(function () {});
        return;
      }
      keys.forEach(function (k) {
        settings[k] = changes[k].newValue;
      });
      // A settings change can legitimately produce a NEW block for the same
      // URL+reason (e.g. allowlist edited so the page blocks again). Invalidate
      // the dedupe key — except for high-frequency system keys (stats, counters,
      // emergency, snooze transitions) which must not cause recount loops.
      var enforcementKeys = ['mode', 'blocking', 'youtube', 'study', 'strictMode', 'presentation'];
      var invalidate = keys.some(function (k) { return enforcementKeys.indexOf(k) !== -1; });
      if (invalidate) lastBlockKey = null;
      // Snooze expired or settings changed -> re-evaluate immediately
      setTimeout(function () { execute(location.href); }, 100);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
