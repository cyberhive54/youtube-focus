/* Feed enforcer — hides Home / Explore / Trending discovery surfaces
   when decisions say MODIFY or BLOCK (BLOCK is rendered as overlay by index.js). */
(function () {
  'use strict';

  var STYLE_ID = 'ytf-hide-feed';
  // NOTE: every #primary rule excludes our inline host, so the inline card can
  // live inside the column it replaces (overlay mode is unaffected — its host
  // lives on documentElement, never inside #primary).
  var CSS = [
    /* Home feed grid */
    'ytd-browse[page-subtype="home"] #primary > :not(#yt-focus-inline-host) { display: none !important; }',
    /* Explore / trending */
    'ytd-browse[page-subtype="explore"] #primary > :not(#yt-focus-inline-host), ytd-browse[page-subtype="trending"] #primary > :not(#yt-focus-inline-host) { display: none !important; }',
    'a[href="/feed/explore"], a[href="/feed/trending"] { display: none !important; }'
  ].join('\n');

  var EXPLORE_TAB_CSS = 'a[href="/feed/explore"], a[href="/feed/trending"] { display: none !important; }';

  function ensureStyle() {
    var el = document.getElementById(STYLE_ID);
    if (!el) {
      el = document.createElement('style');
      el.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(el);
    }
    if (el.textContent !== CSS) el.textContent = CSS;
  }

  function ensureExploreTabHidden() {
    var el = document.getElementById(STYLE_ID);
    if (!el) {
      el = document.createElement('style');
      el.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(el);
    }
    if (el.textContent.indexOf('/feed/explore') === -1) el.textContent += '\n' + EXPLORE_TAB_CSS;
  }

  function clearStyle() {
    var el = document.getElementById(STYLE_ID);
    if (el) el.remove();
  }

  function applyModifications(mods, settings) {
    mods = mods || [];
    var yt = (settings && settings.youtube) || {};
    if ((yt.homeFeed && yt.homeFeed.hide) || (yt.explore && yt.explore.hide)) ensureStyle();
    if (yt.sidebar && yt.sidebar.hideExplore) ensureExploreTabHidden();
  }

  window.YTFOCUS = window.YTFOCUS || {};
  window.YTFOCUS.feed = {
    applyModifications: applyModifications,
    ensureStyle: ensureStyle,
    clearStyle: clearStyle
  };
})();
