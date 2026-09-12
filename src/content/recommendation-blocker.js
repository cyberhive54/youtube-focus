/* Recommendation enforcer — Up Next / related / end-screen / autoplay. */
(function () {
  'use strict';

  var STYLE_ID = 'ytf-hide-recs';

  function cssFor(mods) {
    var css = [];
    if (mods.indexOf('hide-up-next') !== -1) {
      css.push('#secondary.ytd-watch-flexy { display: none !important; }');
      css.push('ytd-watch-next-secondary-results-renderer { display: none !important; }');
    }
    if (mods.indexOf('hide-related') !== -1) {
      css.push('ytd-compact-video-renderer, ytd-compact-radio-renderer, ytd-compact-playlist-renderer { display: none !important; }');
    }
    if (mods.indexOf('hide-endscreen') !== -1) {
      css.push('.ytp-endscreen-content, .ytp-ce-element { display: none !important; }');
    }
    return css.join('\n');
  }

  function applyModifications(mods) {
    mods = mods || [];
    var css = cssFor(mods);
    var el = document.getElementById(STYLE_ID);
    if (!css) {
      // Nothing requested: remove any previously injected element. (Previously
      // this early-returned and left stale hiding CSS behind — e.g. disabling
      // "Hide Up Next" never un-hid it until an allow-type decision cleared it.)
      if (el) el.remove();
      return;
    }
    if (!el) {
      el = document.createElement('style');
      el.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(el);
    }
    if (el.textContent !== css) el.textContent = css;
    if (mods.indexOf('disable-autoplay') !== -1) disableAutoplay();
  }

  function clearStyle() {
    var el = document.getElementById(STYLE_ID);
    if (el) el.remove();
  }

  function disableAutoplay() {
    try {
      // YouTube autoplay toggle in watch page
      var toggle = document.querySelector('#autoplay-checkbox, ytd-toggle-button-renderer#toggle');
      if (toggle && toggle.getAttribute('aria-pressed') === 'true') {
        toggle.click();
      }
      document.querySelectorAll('video').forEach(function (v) {
        if (v && v.autoplay) { try { v.autoplay = false; } catch (e) {} }
      });
    } catch (e) {}
  }

  window.YTFOCUS = window.YTFOCUS || {};
  window.YTFOCUS.recs = {
    applyModifications: applyModifications,
    clearStyle: clearStyle,
    disableAutoplay: disableAutoplay
  };
})();
