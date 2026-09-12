/* SPA router — YouTube doesn't reload on navigation.
   Patches history + listens to yt-navigate-finish / popstate. */
(function () {
  'use strict';

  var listeners = [];
  var lastUrl = location.href;

  function emit(url) {
    lastUrl = url;
    listeners.forEach(function (cb) {
      try { cb(url); } catch (e) {}
    });
  }

  function hookHistory() {
    try {
      var origPush = history.pushState;
      history.pushState = function () {
        var r = origPush.apply(this, arguments);
        setTimeout(function () { if (location.href !== lastUrl) emit(location.href); }, 0);
        return r;
      };
      var origReplace = history.replaceState;
      history.replaceState = function () {
        var r = origReplace.apply(this, arguments);
        setTimeout(function () { if (location.href !== lastUrl) emit(location.href); }, 0);
        return r;
      };
    } catch (e) {}
    window.addEventListener('popstate', function () { emit(location.href); });
    window.addEventListener('hashchange', function () { emit(location.href); });
    document.addEventListener('yt-navigate-finish', function () {
      setTimeout(function () { emit(location.href); }, 50);
    });
  }

  function onNavigate(cb) {
    listeners.push(cb);
  }

  window.YTFOCUS = window.YTFOCUS || {};
  window.YTFOCUS.router = {
    onNavigate: onNavigate,
    hookHistory: hookHistory,
    currentUrl: function () { return location.href; }
  };
})();
