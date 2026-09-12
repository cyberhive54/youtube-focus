/* Shorts enforcer — executes BLOCK/MODIFY decisions for Shorts.
   Owns: video pause, first-short scroll counting, shelves/tab CSS hiding. */
(function () {
  'use strict';

  var STYLE_ID = 'ytf-hide-shorts';
  var SHELF_CSS = [
    'ytd-reel-shelf-renderer { display: none !important; }',
    'ytd-rich-shelf-renderer[is-shorts] { display: none !important; }',
    'ytd-rich-section-renderer:has(a[href^="/shorts/"]) { display: none !important; }',
    'ytm-shorts-lockup-view-model-v2, ytm-shorts-lockup-view-model { display: none !important; }',
    'a[href^="/shorts/"].yt-simple-endpoint.ytd-thumbnail { display: none !important; }',
    'ytd-guide-entry-renderer:has(a[title="Shorts"]), ytd-mini-guide-entry-renderer:has(a[title="Shorts"]) { display: none !important; }',
    'tp-yt-paper-tab:has(a[title="Shorts"]) { display: none !important; }',
    'ytd-guide-entry-renderer:has(a[href="/shorts"]) { display: none !important; }'
  ].join('\n');

  var TAB_ONLY_CSS = [
    'ytd-guide-entry-renderer:has(a[title="Shorts"]), ytd-mini-guide-entry-renderer:has(a[title="Shorts"]) { display: none !important; }',
    'tp-yt-paper-tab:has(a[title="Shorts"]) { display: none !important; }'
  ].join('\n');

  function ensureStyle(css) {
    var el = document.getElementById(STYLE_ID);
    if (!el) {
      el = document.createElement('style');
      el.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(el);
    }
    if (el.textContent !== css) el.textContent = css;
  }

  function clearStyle() {
    var el = document.getElementById(STYLE_ID);
    if (el) el.remove();
  }

  function applyModifications(mods, settings) {
    mods = mods || [];
    var yt = (settings && settings.youtube) || {};
    var needShelves = mods.indexOf('hide-shelves') !== -1 ||
      (yt.recommendations && yt.recommendations.hideShelves);
    var needTab = mods.indexOf('hide-shorts-tab') !== -1 ||
      (yt.sidebar && yt.sidebar.hideShorts);
    if (needShelves) ensureStyle(SHELF_CSS);
    else if (needTab) ensureStyle(TAB_ONLY_CSS);
    // If neither requested, leave existing style (cheap) — cleared on allow-all.
  }

  function pauseShortsVideo() {
    try {
      document.querySelectorAll('video').forEach(function (v) {
        try {
          v.pause();
          // Mute only videos that aren't already muted, and flag exactly those
          // — so unblock can restore OUR mute without touching the user's own.
          if (!v.muted && !v.__ytfMuted) {
            v.muted = true;
            v.__ytfMuted = true;
          }
        } catch (e) {}
      });
    } catch (e) {}
  }

  // Restore sound on videos WE muted (see pauseShortsVideo). Never touches
  // videos the user muted themselves (no flag) or other pages' elements.
  function restoreMutedVideos() {
    try {
      document.querySelectorAll('video').forEach(function (v) {
        try {
          if (v.__ytfMuted) {
            v.muted = false;
            try { delete v.__ytfMuted; } catch (e) { v.__ytfMuted = false; }
          }
        } catch (e) {}
      });
    } catch (e) {}
  }

  // Observe swipe/scroll to 2nd short when allowFirstShort is on.
  // Calls onSecondShort() once the shorts ID changes or explicit next-short nav occurs.
  var scrollHooked = false;
  function hookScrollCounting(getShortsId, onSecondShort) {
    if (scrollHooked) return;
    scrollHooked = true;
    var firstId = null;
    try { firstId = getShortsId(); } catch (e) {}
    var fired = false;
    function fire() {
      if (fired) return;
      fired = true;
      try { onSecondShort(); } catch (e) {}
    }
    function check() {
      var cur = null;
      try { cur = getShortsId(); } catch (e) {}
      if (cur && firstId && cur !== firstId) fire();
    }
    window.addEventListener('wheel', function () { setTimeout(check, 350); }, { passive: true });
    window.addEventListener('touchmove', function () { setTimeout(check, 350); }, { passive: true });
    window.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'PageDown' || e.key === ' ') {
        setTimeout(check, 350);
      }
    });
    // Down-nav buttons inside Shorts player
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (t && t.closest && t.closest('#navigation-button-down, [aria-label="Next"], [aria-label="Next video"]')) {
        setTimeout(check, 500);
      }
    });
  }

  window.YTFOCUS = window.YTFOCUS || {};
  window.YTFOCUS.shorts = {
    applyModifications: applyModifications,
    pauseShortsVideo: pauseShortsVideo,
    restoreMutedVideos: restoreMutedVideos,
    hookScrollCounting: hookScrollCounting,
    clearStyle: clearStyle
  };
})();
