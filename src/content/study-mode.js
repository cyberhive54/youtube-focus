/* Study-mode enforcer — resolves channel identity after DOM loads and
   upgrades 'study-check' (pending) decisions to BLOCK when not allowlisted.
   Also best-effort filters search results to allowlisted channels. */
(function () {
  'use strict';

  function currentChannelMatches(settings) {
    var det = window.YTFOCUS.detector;
    var pol = window.YTFOCUS.policy;
    if (!det || !pol) return { known: false, allowed: false };
    var ref = det.getChannelRef();
    var ctx = { channelId: ref.id, handle: ref.handle, channelUrl: ref.url };
    var known = !!(ref.id || ref.handle || ref.url);
    var allowed = pol.isChannelAllowlisted(settings, ctx);
    return { known: known, allowed: allowed, ref: ref };
  }

  // Hide search results not from allowlisted channels (text/handle best-effort).
  function filterSearch(settings) {
    try {
      var list = (settings.study && settings.study.allowedChannels) || [];
      if (!list.length) return;
      var handles = list.map(function (a) { return String(a.handle || '').toLowerCase(); }).filter(Boolean);
      var names = list.map(function (a) { return String(a.url || '').toLowerCase(); }).filter(Boolean);
      document.querySelectorAll('ytd-video-renderer, ytd-channel-renderer').forEach(function (el) {
        if (el.hasAttribute('data-ytf-checked')) return;
        var text = (el.innerText || '').toLowerCase();
        var link = el.querySelector('a[href^="/@"], a[href^="/channel/"], a[href^="/c/"], a[href^="/user/"]');
        var href = link ? String(link.getAttribute('href') || '').toLowerCase().split('?')[0] : '';
        var ok = handles.some(function (h) { return href === h || text.indexOf(h.replace('/', '')) !== -1; }) ||
                 names.some(function (n) { return href === n; });
        // Also respect explicit allowed videos
        var vlink = el.querySelector('a[href*="watch?v="]');
        var vid = vlink ? (vlink.getAttribute('href').match(/[?&]v=([\w-]{6,})/) || [])[1] : null;
        if (vid && window.YTFOCUS.policy.isVideoAllowlisted(settings, vid)) ok = true;
        if (!ok && (el.tagName.toLowerCase() === 'ytd-video-renderer')) {
          el.style.display = 'none';
        }
        el.setAttribute('data-ytf-checked', '1');
      });
    } catch (e) {}
  }

  function clearSearchMarks() {
    try {
      document.querySelectorAll('[data-ytf-checked]').forEach(function (el) {
        el.removeAttribute('data-ytf-checked');
        if (el.tagName.toLowerCase() === 'ytd-video-renderer') el.style.display = '';
      });
    } catch (e) {}
  }

  window.YTFOCUS = window.YTFOCUS || {};
  window.YTFOCUS.study = {
    currentChannelMatches: currentChannelMatches,
    filterSearch: filterSearch,
    clearSearchMarks: clearSearchMarks
  };
})();
