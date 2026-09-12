/* YouTube route detector — classic script, no side effects (pure DOM reads).
   Priority for channel identity: channelId > canonical URL > handle > DOM text. */
(function () {
  'use strict';

  function classifyRoute(urlString) {
    var u;
    try { u = new URL(urlString); }
    catch (e) { return 'unknown'; }
    var path = u.pathname || '/';
    var host = u.hostname || '';

    if (host.indexOf('studio.youtube.com') !== -1) return 'studio';
    if (path.indexOf('/shorts/') === 0 || path === '/shorts') return 'shorts';
    if (path.indexOf('/watch') === 0) return 'watch';
    if (path.indexOf('/results') === 0) return 'search';
    if (path === '/' || path === '') return 'home';
    if (path.indexOf('/feed/subscriptions') === 0) return 'subscriptions';
    if (path.indexOf('/feed/explore') === 0) return 'explore';
    if (path.indexOf('/feed/trending') === 0) return 'trending';
    if (path.indexOf('/feed/watch_later') === 0) return 'watch-later';
    if (path.indexOf('/playlist') === 0) {
      // YouTube redirects /feed/watch_later -> /playlist?list=WL — keep the exception.
      if (u.search.indexOf('list=WL') !== -1) return 'watch-later';
      return 'playlist';
    }
    if (path.indexOf('/feed/library') === 0 || path.indexOf('/feed/history') === 0) return 'library';
    if (path.indexOf('/@') === 0) return 'channel';
    if (path.indexOf('/c/') === 0 || path.indexOf('/user/') === 0 ||
        path.indexOf('/channel/') === 0) return 'channel';
    return 'unknown';
  }

  function getOrigin(urlString) {
    try { return new URL(urlString).hostname; }
    catch (e) { return location.hostname; }
  }

  // Explicit route exception: Watch Later + Studio are never blocked.
  function isExceptionRoute(route, origin) {
    if (route === 'watch-later') return true;
    if (route === 'studio') return true;
    if (origin && origin.indexOf('studio.youtube.com') !== -1) return true;
    return false;
  }

  function getVideoId(urlString) {
    try {
      var u;
      try {
        u = new URL(urlString);
      } catch (e2) {
        // Relative hrefs (e.g. '/watch?v=…' from page anchors) need a base.
        var base = 'https://www.youtube.com/';
        try { if (typeof location !== 'undefined' && location.href) base = location.href; } catch (e3) {}
        u = new URL(urlString, base);
      }
      if (u.pathname.indexOf('/shorts/') === 0) {
        return u.pathname.split('/shorts/')[1].split('/')[0].split('?')[0] || null;
      }
      return u.searchParams.get('v');
    } catch (e) { return null; }
  }

  // Normalize channel identity. Returns {id, handle, url} with nulls for unknown.
  function getChannelRef() {
    var ref = { id: null, handle: null, url: null, name: null };
    try {
      // 1. Canonical link / meta (most stable after channelId)
      var canon = document.querySelector('link[rel="canonical"]');
      var href = canon ? canon.getAttribute('href') : '';
      if (href) {
        var m = href.match(/youtube\.com\/(@[^/?#]+|c\/[^/?#]+|user\/[^/?#]+|channel\/[^/?#]+)/);
        if (m) {
          ref.url = '/' + m[1];
          if (m[1].charAt(0) === '@') ref.handle = '/' + m[1];
        }
      }
      // 2. channelId from page data / meta
      var metaId = document.querySelector('meta[itemprop="channelId"]');
      if (metaId && metaId.getAttribute('content')) ref.id = metaId.getAttribute('content');
      if (!ref.id) {
        var ownerLink = document.querySelector('ytd-video-owner-renderer a[href*="/channel/"], #owner a[href*="/channel/"]');
        if (ownerLink) {
          var om = (ownerLink.getAttribute('href') || '').match(/\/channel\/(UC[\w-]+)/);
          if (om) ref.id = om[1];
        }
      }
      // 3. handle from URL or owner link
      if (!ref.handle) {
        var p = location.pathname;
        if (p.indexOf('/@') === 0) ref.handle = p.split('/').slice(0, 2).join('/');
        else {
          var hl = document.querySelector('ytd-video-owner-renderer a[href^="/@"], #owner a[href^="/@"]');
          if (hl) ref.handle = hl.getAttribute('href').split('?')[0];
        }
      }
      // 4. display name fallback (least stable)
      var nameEl = document.querySelector('ytd-video-owner-renderer #channel-name #text, ytd-channel-name #text');
      if (nameEl) ref.name = nameEl.textContent.trim() || null;
      if (!ref.url && ref.handle) ref.url = ref.handle;
      if (!ref.url) {
        var cp = location.pathname;
        if (cp.indexOf('/@') === 0 || cp.indexOf('/c/') === 0 ||
            cp.indexOf('/user/') === 0 || cp.indexOf('/channel/') === 0) {
          ref.url = cp.split('?')[0];
        }
      }
    } catch (e) { /* never throw from detection */ }
    return ref;
  }

  // True for text-entry targets. Used by the blocked-page key guard so the
  // blocker never swallows space/k/f while the user is typing.
  function isEditableTarget(el) {
    try {
      if (!el || !el.tagName) return false;
      var tag = el.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
      if (el.isContentEditable) return true;
      if (el.closest && el.closest('[contenteditable="true"], [role="textbox"]')) return true;
    } catch (e) {}
    return false;
  }

  function getSearchQuery(urlString) {
    try { return new URL(urlString).searchParams.get('search_query') || ''; }
    catch (e) { return ''; }
  }

  // YouTube theme first, OS fallback (YT theme may differ from OS theme).
  function detectYouTubeDark() {
    try {
      if (document.documentElement.hasAttribute('dark')) return true;
      var html = document.documentElement.getAttribute('dark');
      if (html !== null && html !== undefined) return true;
    } catch (e) {}
    try {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return true;
    } catch (e) {}
    return false;
  }

  window.YTFOCUS = window.YTFOCUS || {};
  window.YTFOCUS.detector = {
    classifyRoute: classifyRoute,
    getOrigin: getOrigin,
    isExceptionRoute: isExceptionRoute,
    getVideoId: getVideoId,
    getChannelRef: getChannelRef,
    getSearchQuery: getSearchQuery,
    isEditableTarget: isEditableTarget,
    detectYouTubeDark: detectYouTubeDark
  };
})();
