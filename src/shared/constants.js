/* Shared constants — classic script, attaches to window.YTFOCUS */
(function () {
  'use strict';
  var C = {
    MODES: ['normal', 'restricted', 'study', 'full'],
    MODE_LABELS: {
      normal: 'Normal',
      restricted: 'Restricted',
      study: 'Study Mode',
      full: 'Full Block'
    },
    SEARCH_POLICIES: ['allow', 'allow-clean', 'block', 'strict-allowlist'],
    SNOOZE_OPTIONS_MIN: [2, 5, 10, 15, 30, 60],
    SNOOZE_REST_OF_DAY: 'rest-of-day',
    ROUTES: [
      'shorts', 'watch', 'search', 'home', 'subscriptions',
      'explore', 'trending', 'channel', 'playlist', 'watch-later',
      'studio', 'library', 'history', 'unknown'
    ],
    DEFAULTS: {
      mode: 'normal',
      // Master switch (default OFF). Blocking is ACTIVE only when this is on
      // (and not snoozed). Schedules / manual sessions only pick the mode —
      // they take effect solely while master is on.
      blocking: { enabled: false },
      // Emergency pool: totalPercent of the ORIGINAL daily quota + maxUses.
      // optionPercents are also of the original quota (100% allowed — the grant
      // is still capped by remaining pool). One choice spends one use. Uses are
      // never refunded; pool minutes refund on early end. Loosening applies
      // tomorrow via pending; tightening is instant.
      emergency: { enabled: true, totalPercent: 50, maxUses: 3, optionPercents: [5, 10, 20, 100], usedPoolMin: 0, usedUses: 0, poolDay: '', pending: null, pendingDay: '' },
      // Per-screen presentation. 'inline' mounts the card inside YouTube's own
      // layout (Shorts player / feed column) keeping header+sidebar usable;
      // 'overlay' takes over the full viewport (the wall). Inline is only
      // supported on shorts + browse/search pages — anything else falls back
      // to overlay automatically.
      presentation: { shorts: 'inline', restricted: 'inline', study: 'overlay', full: 'overlay', limit: 'overlay' },
      strictMode: false,
      strictUnlockUntil: 0,
      unblockUntil: 0,
      snoozeUntil: 0,
      // --- Daily quota model (v2) ---
      // Quota gates Normal/Restricted. Study never consumes it. Full consumes nothing.
      dailyQuota: { minutes: 60 },
      // Active YouTube usage today (visible tab + playing-or-recently-active).
      // Separate from video playback (sessionLimits.watchMsToday).
      usage: { activeMsToday: 0, activeDay: '', sessionsToday: 0 },
      // Session choices as percentages of the daily quota (human minutes shown).
      session: { optionsPercent: [5, 10, 20, 30], activeUntil: 0, lastChoiceMin: 0 },
      // Reminder checkpoints as percentages of cumulative daily usage.
      reminders: { checkpointsPercent: [25, 50, 75], triggeredToday: [], triggeredDay: '' },
      youtube: {
        // Independent Shorts switch (default OFF, player-only scope).
        // Used when blocking is inactive, or when the active mode has no
        // shorts rule. Modes restricted/study/full carry a binding 'block'
        // rule that overrides this toggle while they are active.
        shorts: { independent: false, allowFirstShort: false },
        homeFeed: { hide: true },
        explore: { hide: true },
        recommendations: {
          hideUpNext: true,
          hideRelated: true,
          hideEndScreen: true,
          hideShelves: true
        },
        sidebar: { hideShorts: true, hideExplore: true },
        autoplay: { disable: true },
        search: { policy: 'allow-clean' }
      },
      sessionLimits: {
        shortsMax: 1,
        shortsSeen: 0,
        shortsSeenDay: '',
        // Last-seen IDs let reloads/new tabs distinguish revisit vs new
        // content (day-scoped like the counters). See trackNavigationCounters.
        lastShortsId: '',
        lastShortsDay: '',
        videosMax: 5,
        videosWatched: 0,
        videosWatchedDay: '',
        lastWatchId: '',
        lastWatchDay: '',
        watchMinutes: 30,
        watchMsToday: 0,
        watchDay: ''
      },
      study: {
        allowedChannels: [],
        allowedVideos: [],
        // Pending allowlist edits activate at local midnight (never same-day,
        // so terminal blocking can't be bypassed by adding content).
        // Entries: {op:'add'|'remove', kind:'channel'|'video', value:{...}}.
        pendingChanges: [],
        manualUntil: 0,
        schedule: []
      },
      stats: {},
      // Two-level streaks. Level A: usage within quota AND zero emergency.
      // Level B: usage within quota AND emergency within allowance.
      streak: { levelA: 0, levelB: 0 },
      // Terminal auto Full Block latch (quota + emergency exhausted). Cleared
      // at local midnight. While set, only allowlisted content opens.
      terminal: { active: false, day: '' },
      lastCleanDay: '',
      onboarded: false
    }
  };
  window.YTFOCUS = window.YTFOCUS || {};
  window.YTFOCUS.CONSTANTS = C;
})();
