/* Throttled MutationObserver — re-runs enforcement as YouTube lazy-loads. */
(function () {
  'use strict';

  var observer = null;
  var pending = false;
  var cb = null;
  var DELAY = 500;

  function onDomChange(fn) {
    cb = fn;
  }

  function start() {
    if (observer) return;
    try {
      observer = new MutationObserver(function () {
        if (pending) return;
        pending = true;
        setTimeout(function () {
          pending = false;
          if (cb) { try { cb(); } catch (e) {} }
        }, DELAY);
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['href', 'title']
      });
    } catch (e) {}
  }

  window.YTFOCUS = window.YTFOCUS || {};
  window.YTFOCUS.domObserver = { onDomChange: onDomChange, start: start };
})();
