/* Blocked-screen presentation — presentation layer ONLY (Shadow DOM).
   Enforcement lives in shorts-blocker / feed-blocker / study-mode / index.js.
   Two layouts share one card:
     - overlay wall: div#yt-focus-host {position:fixed; inset:0} on documentElement
     - inline card: div#yt-focus-inline-host mounted inside YouTube's own layout
       (Shorts slot / feed column), page chrome stays usable. */
(function () {
  'use strict';

  var HOST_ID = 'yt-focus-host';
  var INLINE_HOST_ID = 'yt-focus-inline-host';
  var SUPPRESS_STYLE_ID = 'ytf-inline-suppress';
  var fontRegistered = false;

  // @font-face inside a ShadowRoot <style> does not reliably register into
  // document.fonts (verified live: identical CSS registers from a document
  // stylesheet but not from shadow). Register programmatically instead — the
  // FontFaceSet is shared, so shadow text picks it up. Idempotent.
  function ensureFont() {
    if (fontRegistered) return;
    fontRegistered = true;
    try {
      if (typeof FontFace === 'undefined' || !document.fonts) return;
      var url = (chrome.runtime && chrome.runtime.getURL)
        ? chrome.runtime.getURL('assets/fonts/Inter-var-latin.woff2') : '';
      if (!url) { fontRegistered = false; return; }
      var face = new FontFace('YTF Inter', 'url("' + url + '")', { weight: '100 900', style: 'normal' });
      document.fonts.add(face);
      if (face.load) { face.load().catch(function () {}); }
    } catch (e) { fontRegistered = false; }
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Reason-specific copy: every block names the exact rule that fired, so the
  // card never reads as a generic wall. Values may be {title, sub} or a
  // function(opts) returning {title, sub} for dynamic bits (mode, route).
  // Anything not listed falls back to the screen default from copyFor().
  function modeName(opts) {
    try {
      var labels = (window.YTFOCUS.CONSTANTS || {}).MODE_LABELS || {};
      return labels[opts.mode] || opts.mode || 'current';
    } catch (e) { return 'current'; }
  }

  var REASON_COPY = {
    'shorts-independent': {
      title: 'Shorts is paused',
      sub: 'Block Shorts is on.'
    },
    'shorts': function (opts) {
      if (opts.mode && opts.mode !== 'normal') {
        return {
          title: 'Shorts is paused',
          sub: 'Blocked by ' + modeName(opts) + '.'
        };
      }
      return {
        title: 'Shorts is paused',
        sub: 'Block Shorts is on.'
      };
    },
    'study-shorts': {
      title: 'Shorts are off in Study Mode',
      sub: 'Study Mode blocks Shorts. Approved videos still play.'
    },
    'feed-hidden': function (opts) {
      if (opts.route === 'explore' || opts.route === 'trending') {
        return {
          title: 'Explore is hidden',
          sub: 'Hide Explore / Trending is on.'
        };
      }
      return {
        title: 'Home feed is hidden',
        sub: 'Hide Home feed is on.'
      };
    },
    'restricted-feed': {
      title: 'Blocked by Restricted mode',
      sub: 'Restricted mode blocks Home, Explore, and Trending.'
    },
    'search-blocked': {
      title: 'Search is blocked',
      sub: 'Your Search policy is set to Block.'
    },
    'study-feed': {
      title: 'Blocked by Study Mode',
      sub: 'Only approved channels and videos are available.'
    },
    'study-search-blocked': {
      title: 'Search is off in Study Mode',
      sub: 'Your Search policy blocks Search in Study Mode.'
    },
    'study-channel': {
      title: 'Not on your allowlist',
      sub: 'This channel is not approved for Study Mode.'
    },
    'limit-videos': {
      title: 'Video limit reached',
      sub: 'You reached today’s video limit. Resets at midnight.'
    },
    'limit-time': {
      title: 'Watch-time limit reached',
      sub: 'You reached today’s watch-time limit. Resets at midnight.'
    },
    'limit-shorts': {
      title: 'Shorts limit reached',
      sub: 'You reached today’s Shorts limit. Resets at midnight.'
    },
    'terminal-block': {
      title: 'YouTube is done for today',
      sub: 'Daily time and your extra-time limit are both used up. Only your allowed channels and videos open until midnight.'
    },
    'quota-exhausted': function (opts) {
      return {
        title: 'Today’s YouTube time is used up',
        sub: 'Daily limit reached. Choose extra time or return tomorrow.'
      };
    },
    'restricted-provenance': {
      title: 'Not opened from Search',
      sub: 'Restricted mode only allows videos opened from same-tab YouTube Search.'
    }
  };

  function baseCopyFor(screen, ctx) {
    ctx = ctx || {};
    switch (screen) {
      case 'study':
        return {
          icon: 'book',
          title: 'Not on your study list',
          sub: ctx.detail || 'Only approved channels and videos are available in Study Mode.'
        };
      case 'full':
        return {
          icon: 'moon',
          title: 'YouTube is fully blocked',
          sub: ctx.detail || 'Full Block is active.'
        };
      case 'limit':
        return {
          icon: 'timer',
          title: 'Session limit reached',
          sub: ctx.detail || 'You reached today’s video or watch-time limit. Resets at midnight.'
        };
      case 'session':
        return {
          icon: 'timer',
          title: 'How long do you want to use YouTube?',
          sub: ctx.detail || 'Choose a session. Your remaining time sets the maximum.'
        };
      case 'restricted':
        return {
          icon: 'grid',
          title: 'Discovery is stripped',
          sub: ctx.detail || 'Restricted mode hides Home, Explore and recommendations.'
        };
      case 'shorts':
      default:
        return {
          icon: 'pause',
          title: 'Shorts is paused',
          sub: ctx.detail || 'Shorts are blocked by your current Focus rule.'
        };
    }
  }

  // Wrapper: start from the screen default, then let the exact blocking reason
  // override title/sub so the card always names the rule that fired.
  function copyFor(screen, ctx) {
    var base = baseCopyFor(screen, ctx);
    try {
      var entry = ctx && ctx.reason && REASON_COPY[ctx.reason];
      if (entry) {
        var over = (typeof entry === 'function') ? entry(ctx) : entry;
        if (over) {
          if (over.title) base.title = over.title;
          if (over.sub) base.sub = over.sub;
        }
      }
    } catch (e) {}
    return base;
  }

  function iconSvg(kind) {
    var stroke = 'currentColor';
    if (kind === 'book') {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="' + stroke + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4H6.5A2.5 2.5 0 0 0 4 6.5v13z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/></svg>';
    }
    if (kind === 'moon') {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="' + stroke + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>';
    }
    if (kind === 'timer') {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="' + stroke + '" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/></svg>';
    }
    if (kind === 'grid') {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="' + stroke + '" stroke-width="1.8"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>';
    }
    return '<svg viewBox="0 0 24 24" fill="none" stroke="' + stroke + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/><line x1="4" y1="4" x2="20" y2="20"/></svg>';
  }

  function getHost() {
    var host = document.getElementById(HOST_ID);
    if (host) return host;
    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;';
    document.documentElement.appendChild(host);
    return host;
  }

  function hideBlockedScreen() {
    shownScreen = null;
    try {
      var host = document.getElementById(HOST_ID);
      if (host) host.remove();
    } catch (e) {}
    hideInlineCard();
    try { document.documentElement.style.removeProperty('overflow'); } catch (e) {}
  }

  function isShown() {
    return !!document.getElementById(HOST_ID);
  }

  // ---- inline layout ------------------------------------------------------

  // Inline anchors per route. Null = inline unsupported there (caller falls
  // back to the full overlay). Kept to pages with one stable content column.
  function findInlineAnchor(route) {
    var sels = null;
    if (route === 'shorts') {
      sels = ['ytd-shorts', 'ytd-app'];
    } else if (route === 'home' || route === 'explore' || route === 'trending') {
      sels = ['ytd-browse #primary', 'ytd-app'];
    } else if (route === 'search') {
      sels = ['ytd-two-column-search-results-renderer #primary', 'ytd-app'];
    } else {
      return null;
    }
    for (var i = 0; i < sels.length; i++) {
      try {
        var el = document.querySelector(sels[i]);
        if (el) return el;
      } catch (e) {}
    }
    return null;
  }

  // While the inline card owns the Shorts slot, the underlying player (and its
  // preloaded sibling + nav buttons) must not show or be heard.
  function ensureInlineSuppress(route) {
    clearInlineSuppress();
    var css = '';
    if (route === 'shorts') {
      css += 'ytd-shorts ytd-reel-video-renderer{display:none !important;}' +
        '#navigation-button-down,#navigation-button-up{display:none !important;}';
    }
    if (route === 'search') {
      // Search BLOCKS (policy=block): result sections must not sit scrollable
      // under the card. Results always live inside item-section-renderers;
      // the card mounts outside them. Scoped to the card's lifetime.
      css += 'ytd-two-column-search-results-renderer ytd-item-section-renderer{display:none !important;}';
    }
    if (!css) return;
    try {
      var el = document.createElement('style');
      el.id = SUPPRESS_STYLE_ID;
      el.textContent = css;
      (document.head || document.documentElement).appendChild(el);
    } catch (e) {}
  }

  function clearInlineSuppress() {
    try {
      var el = document.getElementById(SUPPRESS_STYLE_ID);
      if (el) el.remove();
    } catch (e) {}
  }

  function hideInlineCard() {
    shownScreen = null;
    try {
      var host = document.getElementById(INLINE_HOST_ID);
      if (host) host.remove();
    } catch (e) {}
    clearInlineSuppress();
  }

  function inlineIsShown() {
    return !!document.getElementById(INLINE_HOST_ID);
  }

  function emit(name, detail) {
    try { document.dispatchEvent(new CustomEvent(name, { detail: detail || {} })); } catch (e) {}
  }

  // ---- shared card ----------------------------------------------------------

  // Shared card model used by BOTH layouts (overlay wall + inline card).
  function prepareCard(opts, screen) {
    var copy = copyFor(screen, opts);
    return {
      screen: screen,
      copy: copy,
      strict: !!opts.strictMode,
      pauseKind: opts.pauseKind || null, // 'session' | 'emergency' | null(hidden)
      sessionChoices: opts.sessionChoices || [],
      emergencyChoices: opts.emergencyChoices || [],
      emergencyUsesLeft: opts.emergencyUsesLeft,
      emergencyPoolMin: opts.emergencyPoolMin,
      quotaRemainingMin: opts.quotaRemainingMin,
      masterOn: opts.masterOn !== false,
      allowedChannels: (opts.allowedChannels || []).slice(0, 6),
      allowedVideos: (opts.allowedVideos || []).slice(0, 3),
      whyLines: (opts.whyLines || []).slice(),
      schBreak: opts.schBreak || null
    };
  }

  function shortLabel(a) {
    var s = a.handle || a.url || a.id || '';
    s = String(s).replace(/^\//, '');
    return s.length > 24 ? s.slice(0, 23) + '…' : s;
  }

  function fmtMin(m) {
    m = Math.max(0, m || 0);
    if (m >= 1) {
      var r = Math.floor(m * 10) / 10;
      return (r % 1 === 0 ? r.toFixed(0) : r) + ' min';
    }
    var s = Math.round(m * 60);
    return s + ' sec';
  }

  function cardHTML(prep) {
    var copy = prep.copy;
    // Pause sheet: session choices (quota remains) or emergency choices
    // (quota exhausted). Each pill shows configured % + effective minutes.
    // Cooldown staggers unlock: first two choices 3s, rest 7s (handled in
    // wireCard against a per-card timestamp so re-renders don't reset it).
    var choices = prep.pauseKind === 'emergency' ? prep.emergencyChoices : prep.sessionChoices;
    choices = choices || [];
    var pills = choices.map(function (c, i) {
      var cd = i < 2 ? 3 : 7;
      var label = c.fallback ? ('Use remaining ' + fmtMin(c.granted)) : fmtMin(c.granted);
      return '<button class="ytf-pill ytf-choice" data-grant-kind="' + (prep.pauseKind || 'session') + '"' +
        ' data-grant-min="' + c.granted + '" data-cooldown-sec="' + cd + '"' +
        (c.ok ? '' : ' disabled') + '><span>' + label + '</span></button>';
    }).join('');
    var pauseLine = '';
    if (prep.pauseKind === 'emergency') {
      var bits = [];
      if (prep.emergencyPoolMin !== null && prep.emergencyPoolMin !== undefined) bits.push(fmtMin(prep.emergencyPoolMin));
      if (prep.emergencyUsesLeft !== null && prep.emergencyUsesLeft !== undefined && prep.emergencyUsesLeft !== Infinity) {
        bits.push(prep.emergencyUsesLeft + (prep.emergencyUsesLeft === 1 ? ' start' : ' starts'));
      }
      pauseLine = '<p>' + (bits.length ? 'Extra time remaining: ' + bits.join(' · ') : 'No extra-time starts left today') + '</p>';
    } else if (prep.pauseKind === 'session' && prep.quotaRemainingMin !== undefined) {
      pauseLine = '<p>' + fmtMin(prep.quotaRemainingMin) + ' left today</p>';
    }
    var pauseSheet = '';
    if (prep.masterOn && (prep.pauseKind === 'session' || prep.pauseKind === 'emergency')) {
      var pauseHead = prep.pauseKind === 'emergency'
        ? 'Extra-time options'
        : 'How long do you want to use YouTube?';
      pauseSheet = '<div class="ytf-snooze open">' +
          '<p>' + pauseHead + '</p>' + pauseLine +
          '<div class="ytf-pills">' + pills + '</div>' +
        '</div>';
    }

    // Study allowlist at a glance: tap a channel/video to open it directly.
    // (Deliberately navigation, not dismissal — a close-everything X would
    // defeat the blocker. "Turn off blocking…" remains the sanctioned peek.)
    var allowHtml = '';
    if (prep.screen === 'study') {
      var chans = prep.allowedChannels;
      var vids = prep.allowedVideos;
      if (chans.length || vids.length) {
        allowHtml = '<details class="ytf-allow"><summary>Allowed content (' + (chans.length + vids.length) + ')</summary><div class="ytf-pills">' +
          chans.map(function (a) {
            var href = 'https://www.youtube.com' + (a.url || a.handle || '');
            return '<button class="ytf-pill" data-goto="' + esc(href) + '">📚 ' + esc(shortLabel(a)) + '</button>';
          }).join('') +
          vids.map(function (v) {
            var href = v.url || ('https://www.youtube.com/watch?v=' + v.id);
            var label = v.id ? '▶ ' + v.id.slice(0, 11) : '▶ saved video';
            return '<button class="ytf-pill" data-goto="' + esc(href) + '">' + esc(label) + '</button>';
          }).join('') +
          '</div></details>';
      }
    }

    // Compact facts are available only when they add information beyond the
    // already-visible rule subtitle; Strict state is included when relevant.
    var whyHtml = '';
    try {
      var wl = (prep.whyLines && prep.whyLines.length) ? prep.whyLines.slice() : [];
      if (prep.strict) wl.push('Strict Mode is on: settings stay locked.');
      if (wl.length) {
        whyHtml = '<details class="ytf-why"><summary>Details</summary>' +
          wl.map(function (l) { return '<p>' + esc(l) + '</p>'; }).join('') + '</details>';
      }
    } catch (eWhy) { whyHtml = ''; }

    var studyActionHtml = '';
    if (prep.screen === 'full' || prep.screen === 'restricted') {
      studyActionHtml = '<div class="ytf-study-action"><button class="ytf-btn ytf-btn-primary" data-action="switch-study" type="button">📚 Switch to Study Mode</button></div>';
    }

    var schBreakHtml = '';
    if (prep.schBreak && prep.schBreak.allowed) {
      var sb = prep.schBreak;
      if (sb.onCooldown) {
        schBreakHtml = '<div class="ytf-break-sheet" style="margin-top:10px;text-align:center">' +
          '<span class="ytf-pill" style="opacity:0.8;cursor:default;font-size:12px;padding:6px 12px">☕ Break on cooldown (' + sb.cooldownMins + ' min remaining)</span>' +
        '</div>';
      } else if (sb.remCount > 0 && sb.remMin > 0) {
        schBreakHtml = '<div class="ytf-break-sheet" style="margin-top:12px;width:100%">' +
          '<div style="font-size:12px;color:rgba(120,120,128,0.95);margin-bottom:6px;text-align:center;font-weight:600">☕ ' + sb.remCount + ' break' + (sb.remCount === 1 ? '' : 's') + ' left (' + sb.remMin + 'm allowance)</div>' +
          '<div class="ytf-pills" style="justify-content:center;gap:6px">' +
            sb.choices.map(function (c) {
              return '<button type="button" class="ytf-pill ytf-choice" data-action="start-break" data-break-min="' + c + '"><span>Take ' + c + 'm break</span></button>';
            }).join('') +
          '</div>' +
        '</div>';
      } else {
        schBreakHtml = '<div class="ytf-break-sheet" style="margin-top:10px;text-align:center">' +
          '<span class="ytf-caption" style="font-size:12px">☕ Daily schedule break limit reached</span>' +
        '</div>';
      }
    }

    return '<section class="ytf-card" aria-labelledby="ytf-card-title">' +
        '<div class="ytf-icon">' + iconSvg(copy.icon) + '</div>' +
        '<h1 class="ytf-title" id="ytf-card-title">' + esc(copy.title) + '</h1>' +
        '<p class="ytf-sub">' + esc(copy.sub) + '</p>' +
        studyActionHtml +
        schBreakHtml +
        pauseSheet +
        allowHtml +
        whyHtml +
      '</section>';
  }

  // Wire events inside shadow root (isolated from YT). Shared by both layouts.
  // Cooldown anchor: first render of a given card keeps its timestamp so
  // re-renders (observer ticks) don't restart the wait-to-click timers.
  var grantCardKey = '';
  // Currently displayed card screen ('session', 'shorts', ...), or null when
  // no card is showing. Lets the orchestrator keep a live session offer from
  // being clobbered by re-executes. Toasts never touch this.
  var shownScreen = null;
  var grantCardAt = 0;

  function wireCard(wrap, prep) {
    wrap.querySelectorAll('[data-goto]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        emit('ytf:navigate', { href: btn.getAttribute('data-goto') });
      });
    });

    wrap.querySelectorAll('[data-action="switch-study"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        emit('ytf:switch-study');
      });
    });

    wrap.querySelectorAll('[data-action="start-break"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var min = parseInt(btn.getAttribute('data-break-min'), 10) || 5;
        emit('ytf:start-break', { durationMinutes: min });
      });
    });

    // Grant buttons: spend is allowed even under Strict (config stays locked).
    // Cooldown = wait-to-click after the card first appears (3s first two
    // choices, 7s the rest), anchored per card so re-renders don't reset it.
    try {
      var gkey = prep.screen + '|' + (prep.copy && prep.copy.title ? prep.copy.title : '');
      if (gkey !== grantCardKey) { grantCardKey = gkey; grantCardAt = Date.now(); }
      var elapsed = (Date.now() - grantCardAt) / 1000;
      wrap.querySelectorAll('[data-grant-kind]').forEach(function (btn) {
        var wait = parseInt(btn.getAttribute('data-cooldown-sec') || '0', 10) || 0;
        var left = wait - elapsed;
        if (left > 0 && !btn.disabled) {
          btn.disabled = true;
          btn.setAttribute('data-cooldown-wait', String(Math.ceil(left)));
          // A draining shade shows the cooldown without adding changing text
          // to every choice. The timer is still exact and unlocks normally.
          btn.classList.add('ytf-cooling');
          btn.style.setProperty('--ytf-cooldown-ms', Math.max(1, Math.ceil(left * 1000)) + 'ms');
          btn.setAttribute('aria-label', btn.textContent + ', available in ' + Math.ceil(left) + ' seconds');
          setTimeout(function () {
            try {
              btn.disabled = false;
              btn.classList.remove('ytf-cooling');
              btn.removeAttribute('data-cooldown-wait');
              btn.removeAttribute('aria-label');
            } catch (e) {}
          }, Math.max(1, Math.ceil(left * 1000)));
        }
        btn.addEventListener('click', function () {
          if (btn.disabled) return;
          emit('ytf:grant', {
            kind: btn.getAttribute('data-grant-kind'),
            minutes: parseFloat(btn.getAttribute('data-grant-min'))
          });
        });
      });
    } catch (e) {}

  }

  function styleForRoot(root) {
    var style = document.createElement('style');
    var cssText = window.YTFOCUS.shadowStyles || '';
    // Resolve the bundled font to an absolute extension URL (relative URLs would
    // resolve against youtube.com). Requires web_accessible_resources for fonts.
    try {
      var fontUrl = (chrome.runtime && chrome.runtime.getURL)
        ? chrome.runtime.getURL('assets/fonts/Inter-var-latin.woff2') : '';
      if (fontUrl) cssText = cssText.split('%%YTF_FONT_URL%%').join(fontUrl);
    } catch (e) {}
    style.textContent = cssText;
    root.appendChild(style);
  }

  function freshShadow(host) {
    var root = host.shadowRoot;
    if (!root) {
      try {
        root = host.attachShadow({ mode: 'open' });
      } catch (e) {
        return null;
      }
    }
    while (root.firstChild) root.removeChild(root.firstChild);
    styleForRoot(root);
    return root;
  }

  function showBlockedScreen(opts) {
    opts = opts || {};
    shownScreen = null;
    ensureFont();
    var screen = opts.screen || 'shorts';
    var det = window.YTFOCUS.detector;
    var dark = det ? det.detectYouTubeDark() : false;
    var prep = prepareCard(opts, screen);
    hideInlineCard(); // never show both layouts at once
    var host = getHost();
    // Idempotent re-render: a host keeps ONE shadow root across SPA navigations.
    // Re-attaching would throw InvalidStateError and abort enforcement.
    var root = freshShadow(host);
    if (!root) {
      // Extremely defensive: replace a wedged host entirely.
      host.remove();
      host = getHost();
      root = freshShadow(host);
      if (!root) return host;
    }
    var wrap = document.createElement('div');
    wrap.className = 'ytf-overlay';
    wrap.setAttribute('data-theme', dark ? 'dark' : 'light');
    wrap.innerHTML = cardHTML(prep);
    root.appendChild(wrap);

    // Wall layout locks background scroll; inline leaves the page usable.
    try { document.documentElement.style.setProperty('overflow', 'hidden'); } catch (e) {}

    wireCard(wrap, prep);

    shownScreen = screen;
    return host;
  }

  // Inline card. Returns true when mounted, false when unsupported here
  // (caller falls back to the overlay wall). Never throws.
  function showInlineCard(opts, route) {
    opts = opts || {};
    shownScreen = null;
    try {
      ensureFont();
      var anchor = findInlineAnchor(route);
      if (!anchor) return false;
      // Never show both layouts at once.
      try {
        var oh = document.getElementById(HOST_ID);
        if (oh) oh.remove();
      } catch (e) {}
      try { document.documentElement.style.removeProperty('overflow'); } catch (e2) {}
      var host = document.getElementById(INLINE_HOST_ID);
      if (!host || host.parentNode !== anchor) {
        if (host) host.remove();
        host = document.createElement('div');
        host.id = INLINE_HOST_ID;
        host.style.cssText = 'position:relative;display:block;width:100%;z-index:1;';
        try {
          anchor.insertBefore(host, anchor.firstChild);
        } catch (e3) {
          try { anchor.appendChild(host); } catch (e4) { return false; }
        }
      }
      var root = freshShadow(host);
      if (!root) { host.remove(); return false; }
      var det = window.YTFOCUS.detector;
      var dark = det ? det.detectYouTubeDark() : false;
      var prep = prepareCard(opts, opts.screen || 'shorts');
      var wrap = document.createElement('div');
      wrap.className = 'ytf-overlay ytf-inline';
      wrap.setAttribute('data-theme', dark ? 'dark' : 'light');
      wrap.innerHTML = cardHTML(prep);
      root.appendChild(wrap);
      ensureInlineSuppress(route);
      wireCard(wrap, prep);
      shownScreen = opts.screen || 'shorts';
      return true;
    } catch (e) {
      return false;
    }
  }

  var TOAST_HOST_ID = 'yt-focus-toast';

  // Non-blocking usage reminder (3–5s, auto-dismiss). Separate lightweight
  // host — never pauses video, never blocks, never interferes with cards.
  function showReminderToast(text) {
    try {
      ensureFont();
      var old = document.getElementById(TOAST_HOST_ID);
      if (old) old.remove();
      var det = window.YTFOCUS.detector;
      var dark = det ? det.detectYouTubeDark() : false;
      var host = document.createElement('div');
      host.id = TOAST_HOST_ID;
      host.style.cssText = 'position:fixed;left:0;right:0;bottom:28px;z-index:2147483646;' +
        'display:flex;justify-content:center;pointer-events:none;';
      document.documentElement.appendChild(host);
      var root = host.attachShadow({ mode: 'open' });
      var style = document.createElement('style');
      var cssText = window.YTFOCUS.shadowStyles || '';
      try {
        var fontUrl = (chrome.runtime && chrome.runtime.getURL)
          ? chrome.runtime.getURL('assets/fonts/Inter-var-latin.woff2') : '';
        if (fontUrl) cssText = cssText.split('%%YTF_FONT_URL%%').join(fontUrl);
      } catch (e) {}
      style.textContent = cssText +
        '.ytf-toast{pointer-events:auto;font-family:inherit;font-size:14px;font-weight:600;' +
        'padding:12px 20px;border-radius:980px;max-width:90vw;text-align:center;' +
        'border:1px solid rgba(120,120,128,0.35);box-shadow:0 8px 30px rgba(0,0,0,0.25);}' +
        '.ytf-toastwrap[data-theme="light"] .ytf-toast{background:rgba(255,255,255,0.96);color:#1d1d1f;}' +
        '.ytf-toastwrap[data-theme="dark"] .ytf-toast{background:rgba(28,28,30,0.96);color:#f5f5f7;}';
      root.appendChild(style);
      var wrap = document.createElement('div');
      wrap.className = 'ytf-toastwrap';
      wrap.setAttribute('data-theme', dark ? 'dark' : 'light');
      wrap.style.cssText = 'display:flex;justify-content:center;width:100%;';
      wrap.innerHTML = '<div class="ytf-toast">' + esc(text) + '</div>';
      root.appendChild(wrap);
      setTimeout(function () {
        try {
          var h = document.getElementById(TOAST_HOST_ID);
          if (h) h.remove();
        } catch (e3) {}
      }, 4500);
      return true;
    } catch (e) { return false; }
  }

  var NOTIFY_HOST_ID = 'yt-focus-center-notify';

  // 5-second center notification popup with 'x' close button for upcoming schedules
  function showCenterNotification(opts) {
    opts = opts || {};
    try {
      ensureFont();
      var old = document.getElementById(NOTIFY_HOST_ID);
      if (old) old.remove();

      var det = window.YTFOCUS.detector;
      var dark = det ? det.detectYouTubeDark() : false;

      var host = document.createElement('div');
      host.id = NOTIFY_HOST_ID;
      host.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2147483647;pointer-events:auto;';
      document.documentElement.appendChild(host);

      var root = host.attachShadow({ mode: 'open' });
      var style = document.createElement('style');
      var cssText = window.YTFOCUS.shadowStyles || '';
      try {
        var fontUrl = (chrome.runtime && chrome.runtime.getURL)
          ? chrome.runtime.getURL('assets/fonts/Inter-var-latin.woff2') : '';
        if (fontUrl) cssText = cssText.split('%%YTF_FONT_URL%%').join(fontUrl);
      } catch (e) {}

      style.textContent = cssText +
        '.ytf-notify-card{font-family:"YTF Inter",-apple-system,BlinkMacSystemFont,sans-serif;width:340px;max-width:92vw;' +
        'padding:18px 20px;border-radius:18px;border:1px solid rgba(120,120,128,0.28);' +
        'box-shadow:0 16px 40px rgba(0,0,0,0.35);box-sizing:border-box;animation:ytfFadeIn 0.25s cubic-bezier(0.16,1,0.3,1);}' +
        '@keyframes ytfFadeIn{from{opacity:0;transform:scale(0.95)}to{opacity:1;transform:scale(1)}}' +
        '.ytf-notify-wrap[data-theme="light"] .ytf-notify-card{background:rgba(255,255,255,0.96);backdrop-filter:blur(20px);color:#1d1d1f;}' +
        '.ytf-notify-wrap[data-theme="dark"] .ytf-notify-card{background:rgba(30,30,32,0.96);backdrop-filter:blur(20px);color:#f5f5f7;}' +
        '.ytf-notify-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;}' +
        '.ytf-notify-tag{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#0a84ff;}' +
        '.ytf-notify-close{border:0;background:rgba(120,120,128,0.15);color:inherit;font-size:15px;line-height:1;width:24px;height:24px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.15s;}' +
        '.ytf-notify-close:hover{background:rgba(120,120,128,0.3);}' +
        '.ytf-notify-title{font-size:16px;font-weight:700;line-height:1.25;margin:0 0 6px 0;}' +
        '.ytf-notify-desc{font-size:13px;line-height:1.45;color:rgba(120,120,128,0.9);margin:0;}' +
        '.ytf-notify-wrap[data-theme="dark"] .ytf-notify-desc{color:#a1a1a6;}' +
        '.ytf-notify-time{font-weight:700;color:inherit;}';

      root.appendChild(style);

      var title = opts.title || 'Upcoming Focus Schedule';
      var timeText = opts.from ? (' at ' + opts.from) : '';
      var mins = (opts.minutes !== undefined && opts.minutes !== null) ? opts.minutes : 15;
      var modeLabels = (window.YTFOCUS.CONSTANTS || {}).MODE_LABELS || {};
      var modeText = modeLabels[opts.mode] || (opts.mode ? (opts.mode.charAt(0).toUpperCase() + opts.mode.slice(1)) : 'Focus');

      var wrap = document.createElement('div');
      wrap.className = 'ytf-notify-wrap';
      wrap.setAttribute('data-theme', dark ? 'dark' : 'light');
      wrap.innerHTML =
        '<div class="ytf-notify-card" role="alert" aria-live="assertive">' +
          '<div class="ytf-notify-hdr">' +
            '<span class="ytf-notify-tag">🔔 ' + esc(modeText) + '</span>' +
            '<button type="button" class="ytf-notify-close" aria-label="Close notification">✕</button>' +
          '</div>' +
          '<h3 class="ytf-notify-title">' + esc(title) + '</h3>' +
          '<p class="ytf-notify-desc">Starts in <span class="ytf-notify-time">' + mins + ' minute' + (mins === 1 ? '' : 's') + '</span>' + esc(timeText) + '. Prepare to focus!</p>' +
        '</div>';

      root.appendChild(wrap);

      var timerId = setTimeout(function () {
        dismiss();
      }, 5000);

      function dismiss() {
        if (timerId) { clearTimeout(timerId); timerId = null; }
        try {
          var h = document.getElementById(NOTIFY_HOST_ID);
          if (h) h.remove();
        } catch (e3) {}
      }

      var closeBtn = wrap.querySelector('.ytf-notify-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          dismiss();
        });
      }

      return true;
    } catch (e) { return false; }
  }

  window.YTFOCUS = window.YTFOCUS || {};
  window.YTFOCUS.overlay = {
    showBlockedScreen: showBlockedScreen,
    hideBlockedScreen: hideBlockedScreen,
    isShown: isShown,
    currentScreen: function () { return shownScreen; },
    showInlineCard: showInlineCard,
    hideInlineCard: hideInlineCard,
    inlineIsShown: inlineIsShown,
    showReminderToast: showReminderToast,
    showCenterNotification: showCenterNotification
  };
})();
