/* Options controller */
(function () {
  'use strict';
  var store = window.YTFOCUS.store;
  var settings = null;

  function $(id) { return document.getElementById(id); }

  function locked() {
    return !!(settings && (settings.strictMode || (settings.strictUnlockUntil && settings.strictUnlockUntil > Date.now())));
  }

  function setDisabledAll() {
    var L = locked();
    document.querySelectorAll('input, button, select').forEach(function (el) {
      if (el.id === 'sStrict' || el.id === 'btnCancelStrict' || el.id === 'btnCancelUnblock' || el.id === 'resetBtn' || el.closest('#resetDialog')) return;
      // Strict locks everything except Strict toggle itself (and reset with confirm).
      el.disabled = L;
    });
    var sch = null;
    try { sch = window.YTFOCUS.policy && window.YTFOCUS.policy.activeSchedule(settings, Date.now()); } catch (eS) {}
    if (sch && $('sMaster')) $('sMaster').disabled = true;
    var active = false;
    try { active = window.YTFOCUS.policy && window.YTFOCUS.policy.isBlockingActive(settings, Date.now()); } catch (eB) {}
    if ($('lQuotaMin')) $('lQuotaMin').disabled = L || active;
  }

  // Lock + annotate a control overruled by the active mode. No-op under Strict
  // (setDisabledAll already owns that state) and when ungoverned (note removed).
  // A fully mode-owned row steps aside entirely (gov-owned hides it; a per-group
  // summary line below names the count) instead of presenting a dead toggle.
  function setGov(id, governed, why, govLabel) {
    var el = $(id);
    if (!el) return;
    var on = governed && !locked();
    if (on) el.disabled = true;
    var row = el.closest ? el.closest('.ytf-row') : null;
    if (row) row.classList.toggle('gov-owned', !!on);
    var cell = row ? row.querySelector('div') : null;
    var note = row ? row.querySelector('.govnote') : null;
    if (on && cell && govLabel) {
      var text = '🔒 Managed by ' + govLabel + ' — ' + why;
      if (!note) {
        note = document.createElement('div');
        note.className = 'ytf-caption govnote';
        cell.appendChild(note);
      }
      if (note.textContent !== text) note.textContent = text;
    } else if (note) {
      note.remove();
    }
  }

  function formatRemaining(ms) {
    if (ms <= 0) return '00:00';
    var totalSec = Math.ceil(ms / 1000);
    var min = Math.floor(totalSec / 60);
    var sec = totalSec % 60;
    return (min < 10 ? '0' : '') + min + ':' + (sec < 10 ? '0' : '') + sec;
  }

  var cooldownInterval = null;
  function updateCooldowns() {
    if (!settings) return;
    var now = Date.now();
    var needTicker = false;

    var ubBox = $('unblockStatusBox');
    var ubTimer = $('unblockTimer');
    if (ubBox && ubTimer) {
      if (settings.unblockUntil && settings.unblockUntil > now) {
        ubBox.style.display = 'flex';
        ubTimer.textContent = formatRemaining(settings.unblockUntil - now);
        needTicker = true;
      } else {
        if (settings.unblockUntil && settings.unblockUntil <= now) {
          var cancelSnooze = (settings.snoozeUntil && settings.snoozeUntil > now) ? store.cancelSnoozePatch(settings, now) : {};
          var p1 = Object.assign({}, cancelSnooze, { blocking: { enabled: false }, unblockUntil: 0, snoozeUntil: 0 });
          chrome.storage.local.set(p1).then(function () {
            return store.getSettings();
          }).then(function (s) { settings = s; render(); flashSaved(); });
        }
        ubBox.style.display = 'none';
      }
    }

    var stBox = $('strictStatusBox');
    var stTimer = $('strictTimer');
    if (stBox && stTimer) {
      if (settings.strictUnlockUntil && settings.strictUnlockUntil > now) {
        stBox.style.display = 'flex';
        stTimer.textContent = formatRemaining(settings.strictUnlockUntil - now);
        needTicker = true;
      } else {
        if (settings.strictUnlockUntil && settings.strictUnlockUntil <= now) {
          chrome.storage.local.set({ strictMode: false, strictUnlockUntil: 0 }).then(function () {
            return store.getSettings();
          }).then(function (s) { settings = s; render(); flashSaved(); });
        }
        stBox.style.display = 'none';
      }
    }

    if (needTicker && !cooldownInterval) {
      cooldownInterval = setInterval(updateCooldowns, 1000);
    } else if (!needTicker && cooldownInterval) {
      clearInterval(cooldownInterval);
      cooldownInterval = null;
    }
  }

  function render() {
    if (!settings) return;
    updateCooldowns();
    var yt = settings.youtube, r = yt.recommendations, sb = yt.sidebar;
    var now = Date.now();
    var sch = null;
    try { sch = window.YTFOCUS.policy && window.YTFOCUS.policy.activeSchedule(settings, now); } catch (eSch) {}
    var activeSch = !!sch;
    var master = !!((settings.blocking && settings.blocking.enabled) || activeSch);
    var effMode = settings.mode || 'normal';
    try { effMode = (window.YTFOCUS.policy && window.YTFOCUS.policy.effectiveMode(settings, now)) || effMode; } catch (eEM) {}
    var modeBadgeLabels = {};
    try { modeBadgeLabels = (window.YTFOCUS.CONSTANTS || {}).MODE_LABELS || {}; } catch (e2b) {}
    var effLabel = modeBadgeLabels[effMode] || effMode;
    $('modeBadge').textContent = !master ? 'off' : effLabel;
    var modeHints = {
      normal: 'Normal keeps YouTube useful and applies your chosen distraction controls.',
      restricted: 'Restricted allows Search and Subscriptions; videos must be opened from YouTube Search in this tab.',
      study: 'Study Mode allows only approved channels and videos. Add one before turning it on.',
      full: 'Full Block allows only Watch Later and YouTube Studio.'
    };
    $('modeHint').textContent = modeHints[settings.mode] || '';
    document.querySelectorAll('#modeGroup .ytf-pill').forEach(function (b) {
      var pm = b.getAttribute('data-mode');
      b.classList.toggle('active', activeSch ? pm === effMode : pm === settings.mode);
      if (locked()) {
        b.disabled = true;
      } else if (activeSch) {
        var allowed = window.YTFOCUS.policy && window.YTFOCUS.policy.isModeTransitionAllowed(effMode, pm);
        b.disabled = !allowed;
      } else {
        b.disabled = false;
      }
    });
    document.querySelectorAll('#searchGroup .ytf-pill').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-sp') === yt.search.policy);
    });
    $('sMaster').checked = master;
    if (activeSch) {
      $('sMaster').disabled = true;
      var sub = $('masterSub');
      if (sub) sub.textContent = '🔒 Locked on by schedule until ' + (sch.to || 'end') + ' (' + effLabel + ').';
    } else if (!locked()) {
      var sub = $('masterSub');
      if (sub) sub.textContent = 'The master switch. When off, YouTube is normal unless an automatic schedule is active. While a schedule runs, blocking is locked on.';
    }
    // Emergency pool rollover (day + pending apply)
    var emRollover = false;
    try { emRollover = store.emergencyRollover(settings, Date.now()); } catch (e) {}
    var em = settings.emergency || {};
    var emOn = (em.enabled === true);
    $('sEmOn').checked = emOn;
    $('lEmTotal').value = (em.totalPercent === undefined || em.totalPercent === null) ? 50 : em.totalPercent;
    $('lEmUses').value = (em.maxUses !== undefined && em.maxUses !== null) ? em.maxUses : 0;
    (function renderEmLeft() {
      var bits = [];
      var remMin = Infinity, usesLeft = Infinity;
      try {
        remMin = store.emergencyRemaining(settings, Date.now());
        usesLeft = store.emergencyUsesLeft(settings, Date.now());
      } catch (e2) {}
      if (remMin !== Infinity) bits.push(Math.floor(remMin) + ' min');
      if (usesLeft !== Infinity) bits.push(usesLeft + (usesLeft === 1 ? ' start' : ' starts'));
      $('emLeftLine').textContent = bits.length
        ? bits.join(' · ') + ' left today · resets at midnight'
        : 'No extra-time limit';
    })();
    // Emergency option pills show configured percents as active.
    (function renderEmOpts() {
      var live = [];
      try { live = store.emergencyOf(settings).optionPercents || []; } catch (e4) {}
      document.querySelectorAll('#emOptGroup .ytf-pill').forEach(function (b) {
        var v = parseInt(b.getAttribute('data-emopt'), 10);
        b.classList.toggle('active', live.indexOf(v) !== -1);
      });
    })();
    // Pending line (human summary of tomorrow's staged loosening).
    (function renderPending() {
      var p = settings.emergency && settings.emergency.pending;
      if (!p) { $('emPendingLine').textContent = ''; return; }
      var bits = [];
      if (p.enabled === false) bits.push('limit off');
      if (p.totalPercent !== undefined) bits.push(p.totalPercent + '% pool');
      if (p.maxUses !== undefined) bits.push((p.maxUses === null ? '∞' : p.maxUses) + ' starts');
      if (p.optionPercents) bits.push('lengths ' + p.optionPercents.join(',') + '%');
      $('emPendingLine').textContent = bits.length ? '⏳ Pending tomorrow: ' + bits.join(' · ') : '';
    })();
    if (emRollover) {
      chrome.storage.local.set({ emergency: settings.emergency }).catch(function () {});
    }
    setDisabledAll(); // strict baseline first; governance locks layer on top
    $('lEmTotal').disabled = locked() || !((settings.emergency || {}).enabled === true);
    $('lEmUses').disabled = locked() || !((settings.emergency || {}).enabled === true);
    // Governance: lock controls the active mode overrules, with a named note.
    var gov = { shorts: false, first: false, feeds: false, recs: false, mode: settings.mode };
    try {
      if (window.YTFOCUS.policy) gov = window.YTFOCUS.policy.governance(settings, Date.now());
    } catch (e) {}
    var govLabel = '';
    try {
      var labels = (window.YTFOCUS.CONSTANTS || {}).MODE_LABELS || {};
      govLabel = labels[gov.mode] || gov.mode || '';
    } catch (e2) {}
    setGov('sShorts', gov.shorts, 'Shorts always blocked', govLabel);
    setGov('sFirst', gov.first, 'no effect here', govLabel);
    setGov('sHome', gov.feeds, 'hidden by the mode anyway', govLabel);
    setGov('sExplore', gov.feeds, 'hidden by the mode anyway', govLabel);
    setGov('sUpNext', gov.recs, 'hidden by the mode anyway', govLabel);
    setGov('sRelated', gov.recs, 'hidden by the mode anyway', govLabel);
    setGov('sEnd', gov.recs, 'hidden by the mode anyway', govLabel);
    setGov('sShelves', gov.recs, 'hidden by the mode anyway', govLabel);
    setGov('sTab', gov.recs, 'hidden by the mode anyway', govLabel);
    setGov('sAutoplay', gov.recs, 'hidden by the mode anyway', govLabel);
    // Mode-owned rows are hidden (see setGov); one compact line per group
    // says how many stepped aside. They return automatically on mode change —
    // no settings are touched, so nothing can be lost.
    (function renderGovSums() {
      var groups = [
        ['govsum-shorts', ['sShorts', 'sFirst']],
        ['govsum-feeds', ['sHome', 'sExplore']],
        ['govsum-recs', ['sUpNext', 'sRelated', 'sEnd', 'sShelves', 'sTab', 'sAutoplay']]
      ];
      var label = govLabel || 'the active mode';
      groups.forEach(function (gr) {
        var box = $(gr[0]);
        if (!box) return;
        var n = 0;
        gr[1].forEach(function (id) {
          var e = $(id);
          var r = e && e.closest ? e.closest('.ytf-row') : null;
          if (r && r.classList.contains('gov-owned')) n++;
        });
        if (n > 0) {
          box.style.display = '';
          box.textContent = '🔒 ' + n + ' setting' + (n === 1 ? '' : 's') + ' managed by ' + label + ' — change mode to adjust ' + (n === 1 ? 'it' : 'them') + '.';
        } else {
          box.style.display = 'none';
          box.textContent = '';
        }
      });
    })();
    $('lQuotaMin').value = store.quotaMinutes(settings);
    var isBlockOn = false;
    try { isBlockOn = window.YTFOCUS.policy && window.YTFOCUS.policy.isBlockingActive(settings, now); } catch (eQ) {}
    $('lQuotaMin').disabled = locked() || isBlockOn;
    // Prominent daily allowance status (the core model, answered first).
    try {
      var _fq = store.quotaMinutes(settings);
      var _fu = Math.floor(store.usageMsToday(settings, Date.now()) / 60000);
      $('focusStatus').textContent = 'YouTube time ' + _fu + ' / ' + _fq + ' min today · ' + Math.max(0, _fq - _fu) + ' min remaining';
    } catch (eFS) { try { $('focusStatus').textContent = '–'; } catch (eFS2) {} }
    // Session + reminder option pills reflect configured sets.
    (function renderSessRem() {
      var sessLive = (((settings.session || {}).optionsPercent) || [5, 10, 20, 30]);
      document.querySelectorAll('#sessOptGroup .ytf-pill').forEach(function (b) {
        b.classList.toggle('active', sessLive.indexOf(parseInt(b.getAttribute('data-sessopt'), 10)) !== -1);
      });
      var remLive = (((settings.reminders || {}).checkpointsPercent) || [25, 50, 75]);
      document.querySelectorAll('#remGroup .ytf-pill').forEach(function (b) {
        b.classList.toggle('active', remLive.indexOf(parseInt(b.getAttribute('data-rem'), 10)) !== -1);
      });
    })();
    // Study timer line.
    try {
      var _stU = settings.study && settings.study.manualUntil;
      $('stTimerLine').textContent = (_stU && _stU > Date.now())
        ? 'Study session until ' + new Date(_stU).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        : '';
    } catch (e9) {}
    $('sShorts').checked = gov.shorts ? true : !!(yt.shorts && yt.shorts.independent);
    var rowFirst = $('rowFirstShort');
    if (rowFirst) {
      var isShortsOn = gov.shorts ? true : !!(yt.shorts && yt.shorts.independent);
      rowFirst.style.display = isShortsOn ? '' : 'none';
    }
    $('sFirst').checked = gov.first ? false : !!yt.shorts.allowFirstShort;
    $('sHome').checked = gov.feeds ? true : !!yt.homeFeed.hide;
    $('sExplore').checked = gov.feeds ? true : !!yt.explore.hide;
    $('sUpNext').checked = gov.recs ? true : !!r.hideUpNext;
    $('sRelated').checked = gov.recs ? true : !!r.hideRelated;
    $('sEnd').checked = gov.recs ? true : !!r.hideEndScreen;
    $('sShelves').checked = gov.recs ? true : !!r.hideShelves;
    $('sTab').checked = gov.recs ? true : !!sb.hideShorts;
    $('sAutoplay').checked = gov.recs ? true : !!(yt.autoplay && yt.autoplay.disable);
    // Collapsible subgroup summaries: live state, never hard-coded numbers.
    // Placed after checkbox states above so the feeds count reads true values.
    (function renderGroupSums() {
      function setSum(id, text) {
        var el = $(id);
        if (!el) return;
        var t = text ? ' · ' + text : '';
        if (el.textContent !== t) el.textContent = t;
      }
      var sh = (settings.youtube && settings.youtube.shorts) || {};
      var sBlocked = gov.shorts ? true : !!sh.independent;
      var sFirst = !!sh.allowFirstShort || (master && gov.mode === 'restricted');
      var sTxt = sBlocked ? 'Blocked' : 'Allowed';
      if (sBlocked && sFirst) sTxt += ', First Short allowed';
      if (gov.shorts) sTxt += ' (managed by ' + (govLabel || 'the active mode') + ')';
      setSum('sum-shorts', sTxt);
      var spMap = { allow: 'Allow', 'allow-clean': 'Hide distractions', block: 'Block search', 'strict-allowlist': 'Study: allowed only' };
      var sp = (settings.youtube && settings.youtube.search && settings.youtube.search.policy) || 'allow-clean';
      setSum('sum-search', spMap[sp] || sp);
      var feedIds = ['sHome', 'sExplore', 'sUpNext', 'sRelated', 'sEnd', 'sShelves', 'sTab', 'sAutoplay'];
      var hidden = 0, managed = 0;
      feedIds.forEach(function (id) {
        var e = $(id);
        if (e && e.checked) hidden++;
        var r = e && e.closest ? e.closest('.ytf-row') : null;
        if (r && r.classList.contains('gov-owned')) managed++;
      });
      var fTxt = hidden + ' of ' + feedIds.length + ' hidden';
      if (managed > 0) fTxt += ' (' + managed + ' managed by ' + (govLabel || 'the active mode') + ')';
      setSum('sum-feeds', fTxt);
    })();
    $('sStrict').checked = !!settings.strictMode;
    var _sm = settings.sessionLimits.shortsMax;
    $('lShorts').value = (_sm === null || _sm === undefined) ? '' : _sm;
    var selShorts = $('selShortsLimit');
    var boxShorts = $('boxShortsSlider');
    var rngShorts = $('rngShorts');
    var badgeShorts = $('badgeShortsVal');
    if (selShorts) {
      if (_sm === 0) {
        selShorts.value = 'block-all';
        if (boxShorts) boxShorts.style.display = 'none';
      } else if (typeof _sm === 'number' && _sm > 0) {
        selShorts.value = 'set-number';
        if (boxShorts) boxShorts.style.display = 'flex';
        if (rngShorts) rngShorts.value = _sm;
        if (badgeShorts) badgeShorts.textContent = _sm;
      } else {
        selShorts.value = 'no-cap';
        if (boxShorts) boxShorts.style.display = 'none';
      }
    }

    var _vm = settings.sessionLimits.videosMax;
    $('lVideos').value = (_vm === null || _vm === undefined) ? '' : _vm;
    var selVideos = $('selVideosLimit');
    var boxVideos = $('boxVideosSlider');
    var rngVideos = $('rngVideos');
    var badgeVideos = $('badgeVideosVal');
    var warnVideos = $('warnBlockAllVideos');
    if (selVideos) {
      if (_vm === 0) {
        selVideos.value = 'block-all';
        if (boxVideos) boxVideos.style.display = 'none';
        if (warnVideos) warnVideos.style.display = 'block';
      } else if (typeof _vm === 'number' && _vm > 0) {
        selVideos.value = 'set-limit';
        if (boxVideos) boxVideos.style.display = 'flex';
        if (rngVideos) rngVideos.value = _vm;
        if (badgeVideos) badgeVideos.textContent = _vm;
        if (warnVideos) warnVideos.style.display = 'none';
      } else {
        selVideos.value = 'no-limit';
        if (boxVideos) boxVideos.style.display = 'none';
        if (warnVideos) warnVideos.style.display = 'none';
      }
    }

    var _wm = settings.sessionLimits.watchMinutes;
    $('lMins').value = (_wm === null || _wm === undefined) ? '' : _wm;
    var selMins = $('selMinsLimit');
    var boxMins = $('boxMinsSlider');
    var rngMins = $('rngMins');
    var badgeMins = $('badgeMinsVal');
    if (selMins) {
      if (typeof _wm === 'number' && _wm > 0) {
        selMins.value = 'set-limit';
        if (boxMins) boxMins.style.display = 'flex';
        if (rngMins) rngMins.value = _wm;
        if (badgeMins) badgeMins.textContent = _wm + 'm';
      } else {
        selMins.value = 'no-limit';
        if (boxMins) boxMins.style.display = 'none';
      }
    }

    // Channels (edits stage as midnight-pending, never same-day).
    var ch = $('chList'); ch.innerHTML = '';
    if (!(settings.study.allowedChannels || []).length) {
      ch.innerHTML = '<li class="empty">No allowed channels yet — add your first study channel above.</li>';
    }
    (settings.study.allowedChannels || []).forEach(function (a, i) {
      var li = document.createElement('li');
      var label = a.handle || a.url || a.id;
      li.innerHTML = '<code></code>';
      li.querySelector('code').textContent = label + (a.id && a.id !== label ? ' (' + a.id + ')' : '');
      var del = document.createElement('button'); del.textContent = 'Remove';
      del.addEventListener('click', function () {
        stagePending('remove', 'channel', a);
      });
      li.appendChild(del); ch.appendChild(li);
    });
    var vl = $('vidList'); vl.innerHTML = '';
    if (!(settings.study.allowedVideos || []).length) {
      vl.innerHTML = '<li class="empty">No allowed videos yet — save specific videos you need.</li>';
    }
    // Pending allowlist changes (activate at local midnight).
    var pl = $('pendList'); pl.innerHTML = '';
    var pend = (settings.study && settings.study.pendingChanges) || [];
    if (pend.length) {
      pend.forEach(function (ch, i) {
        var li = document.createElement('li');
        li.innerHTML = '<code></code>';
        var what = ch.kind === 'channel'
          ? (ch.value.handle || ch.value.url || ch.value.id || '')
          : (ch.value.url || ch.value.id || '');
        li.querySelector('code').textContent =
          (ch.op === 'add' ? '＋ ' : '－ ') + (ch.kind === 'channel' ? 'channel ' : 'video ') + what;
        var cancel = document.createElement('button'); cancel.textContent = 'Cancel';
        cancel.addEventListener('click', function () {
          settings.study.pendingChanges.splice(i, 1);
          save({ study: settings.study });
        });
        li.appendChild(cancel); pl.appendChild(li);
      });
    }
    (settings.study.allowedVideos || []).forEach(function (v, i) {
      var li = document.createElement('li');
      li.innerHTML = '<code></code>';
      li.querySelector('code').textContent = v.url || v.id;
      var del = document.createElement('button'); del.textContent = 'Remove';
      del.addEventListener('click', function () {
        stagePending('remove', 'video', v);
      });
      li.appendChild(del); vl.appendChild(li);
    });

    // Schedules
    var sl = $('schList'); sl.innerHTML = '';
    if (!(settings.study.schedule || []).length) {
      sl.innerHTML = '<li class="empty">No automatic schedules — blocking follows your master switch and timers.</li>';
    }
    var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var modeLabels = (window.YTFOCUS.CONSTANTS || {}).MODE_LABELS || {};
    (settings.study.schedule || []).forEach(function (e, i) {
      var li = document.createElement('li');
      li.innerHTML = '<code></code>';
      var mText = modeLabels[e.mode] || e.mode;
      li.querySelector('code').textContent =
        mText + ' • ' + e.days.map(function (d) { return days[d]; }).join(',') + ' • ' + e.from + '–' + e.to;
      var isRunning = scheduleMatches(e, now);
      if (isRunning) {
        var runBadge = document.createElement('span');
        runBadge.className = 'sch-badge-running';
        runBadge.textContent = 'Active now (locked)';
        li.appendChild(runBadge);
      } else if (e.pendingRemoval) {
        var pendBadge = document.createElement('span');
        pendBadge.className = 'sch-badge-pending';
        pendBadge.textContent = 'Removal pending (at midnight)';
        li.appendChild(pendBadge);

        var cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.color = 'var(--ytf-blue)';
        cancelBtn.addEventListener('click', function () {
          delete e.pendingRemoval;
          save({ study: settings.study });
        });
        li.appendChild(cancelBtn);
      } else {
        var del = document.createElement('button');
        del.textContent = 'Remove';
        del.addEventListener('click', function () {
          e.pendingRemoval = true;
          var errEl = $('schError');
          if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
          save({ study: settings.study });
        });
        li.appendChild(del);
      }
      sl.appendChild(li);
    });

    // Analytics: today, streaks, 14-day chart, history.
    (function renderAnalytics() {
      try {
        var now = Date.now();
        var qMin = store.quotaMinutes(settings);
        var usedMin = 0, watchMin = 0, sessN = 0;
        try { usedMin = store.usageMsToday(settings, now) / 60000; } catch (e) {}
        try {
          var sl = settings.sessionLimits || {};
          var wd = store.todayKey(new Date(now));
          if (sl.watchDay === wd) watchMin = (sl.watchMsToday || 0) / 60000;
        } catch (e2) {}
        try {
          var uu = settings.usage || {};
          if (uu.activeDay === store.todayKey(new Date(now))) sessN = uu.sessionsToday || 0;
        } catch (e3) {}
        var remMin = Math.max(0, qMin - usedMin);
        var emU = 0, emM = 0;
        try {
          var ee = settings.emergency || {};
          emU = ee.usedUses || 0; emM = ee.usedPoolMin || 0;
        } catch (e4) {}
        var rFired = (((settings.reminders || {}).triggeredToday) || []).join(', ') || 'none yet';
        $('anToday').textContent =
          'YouTube time ' + Math.floor(usedMin) + ' / ' + qMin + ' min (' + fmtInt(remMin) + ' left)' +
          ' · Watch time ' + Math.floor(watchMin) + ' min' +
          ' · Sessions ' + sessN +
          ' · Extra time ' + Math.floor(emM) + ' min, ' + emU + ' starts' +
          ' · Reminders: ' + rFired +
          ' · Shorts watched ' + (settings.sessionLimits.shortsSeen || 0);
        function fmtInt(x) { return Math.floor(x) + ' min'; }
        var stk = settings.streak || { levelA: 0, levelB: 0 };
        $('anStreaks').textContent =
          'Level A streak (no extra time used): ' + (stk.levelA || 0) + ' days' +
          ' · Level B streak (within the extra-time limit): ' + (stk.levelB || 0) + ' days';
        // History: usageHistory (usage+watch) joined with stats (blocks).
        var hist = settings.usageHistory || {};
        var stats = settings.stats || {};
        var days = {};
        Object.keys(hist).forEach(function (k) { days[k] = true; });
        Object.keys(stats).forEach(function (k) { days[k] = true; });
        var sorted = Object.keys(days).sort().reverse().slice(0, 14);
        var ul = $('anHistory'); ul.innerHTML = '';
        if (!sorted.length) {
          ul.innerHTML = '<li class="empty">No history yet — come back tomorrow.</li>';
        }
        sorted.forEach(function (k) {
          var h = hist[k] || {};
          var stt = stats[k] || {};
          var li = document.createElement('li');
          li.innerHTML = '<code></code>';
          li.querySelector('code').textContent = k +
            ' · ' + Math.floor((h.activeMs || 0) / 60000) + ' min used' +
            ' · ' + (stt.distractionsBlocked || 0) + ' blocked';
          ul.appendChild(li);
        });
        // Canvas: daily usage bars vs quota line, last 14 days.
        // No history yet: compact empty state instead of a large blank chart.
        try {
          var cv = $('anChart');
          var emptyBox = $('anChartEmpty');
          var capBox = $('anChartCap');
          if (!sorted.length) {
            cv.style.display = 'none';
            if (capBox) capBox.style.display = 'none';
            if (emptyBox) emptyBox.style.display = '';
          } else {
            cv.style.display = '';
            if (capBox) capBox.style.display = '';
            if (emptyBox) emptyBox.style.display = 'none';
            var ctx2d = cv.getContext('2d');
            var W = cv.width, H = cv.height;
            ctx2d.clearRect(0, 0, W, H);
            var asc = sorted.slice().reverse();
            var maxV = qMin;
            asc.forEach(function (k) {
              var h = (settings.usageHistory || {})[k] || {};
              maxV = Math.max(maxV, (h.activeMs || 0) / 60000);
            });
            if (maxV <= 0) maxV = 1;
            var n = Math.max(asc.length, 1);
            var bw = Math.min(40, (W - 20) / n * 0.55);
            asc.forEach(function (k, i) {
              var h = (settings.usageHistory || {})[k] || {};
              var v = (h.activeMs || 0) / 60000;
              var bh = Math.max(2, (v / maxV) * (H - 30));
              var x = 10 + (i + 0.5) * ((W - 20) / n) - bw / 2;
              ctx2d.fillStyle = v <= qMin ? '#0a84ff' : '#d70015';
              ctx2d.fillRect(x, H - 15 - bh, bw, bh);
            });
            // quota line
            var qy = H - 15 - (qMin / maxV) * (H - 30);
            ctx2d.strokeStyle = '#34c759';
            ctx2d.lineWidth = 2;
            ctx2d.beginPath();
            ctx2d.moveTo(5, qy);
            ctx2d.lineTo(W - 5, qy);
            ctx2d.stroke();
            ctx2d.fillStyle = '#888';
            ctx2d.font = '11px sans-serif';
            ctx2d.fillText('quota ' + qMin + 'm', 8, Math.max(12, qy - 4));
          }
        } catch (e5) {}

        // Global empty state for Analytics section
        var anEmptyBox = $('anEmptyBox');
        var anContentBox = $('anContentBox');
        var isTotallyEmpty = (Math.floor(usedMin) === 0 && Math.floor(watchMin) === 0 && sessN === 0 && (!sorted || sorted.length === 0));
        if (isTotallyEmpty) {
          if (anEmptyBox) anEmptyBox.style.display = '';
          if (anContentBox) anContentBox.style.display = 'none';
        } else {
          if (anEmptyBox) anEmptyBox.style.display = 'none';
          if (anContentBox) anContentBox.style.display = '';
        }
      } catch (e6) {}
    })();

    // Stats (blocked-counts only here — streaks live in Analytics above).
    try {
      var s = store.getDayStats(settings, store.todayKey());
      $('statsBox').textContent =
        (s.shortsBlocked || 0) + ' Shorts blocked • ' +
        (s.youtubeBlocked || 0) + ' pages blocked • ' +
        (s.distractionsBlocked || 0) + ' distractions blocked • ' +
        (s.bypassAttempts || 0) + ' override attempts';
    } catch (e) {}

  }

  var saveT = null;
  function flashSaved() {
    var pill = $('savedPill');
    if (!pill) return;
    pill.classList.add('show');
    if (saveT) clearTimeout(saveT);
    saveT = setTimeout(function () { pill.classList.remove('show'); }, 1400);
  }

  function save(patch) {
    if (locked() && !('strictMode' in patch) && !('strictUnlockUntil' in patch)) {
      // Second layer lives in filterStrictPatch (storage.js): even if a
      // handler misses its locked() check, protected keys cannot be written.
      var res = { applied: {}, dropped: Object.keys(patch || {}) };
      try {
        if (store.filterStrictPatch) res = store.filterStrictPatch(settings, patch);
      } catch (e) {}
      if (!Object.keys(res.applied).length) {
        render();
        return Promise.resolve();
      }
      return chrome.storage.local.set(res.applied).then(function () {
        return store.getSettings();
      }).then(function (s) {
        settings = s; render();
        flashSaved();
        chrome.runtime.sendMessage({ type: 'ytf:refresh-badge' }).catch(function () {});
      });
    }
    return chrome.storage.local.set(patch).then(function () {
      return store.getSettings();
    }).then(function (s) {
      settings = s; render();
      flashSaved();
      chrome.runtime.sendMessage({ type: 'ytf:refresh-badge' }).catch(function () {});
    });
  }

  // Emergency edits with tomorrow-semantics: build the proposed full config
  // from UI controls, split into now vs pending, persist both. Tightening
  // applies instantly; loosening lands in `pending` for midnight rollover.
  function saveEmergency(proposedPartial) {
    if (locked()) { render(); return; }
    var live = Object.assign({}, settings.emergency || {});
    var proposed = Object.assign({}, live, proposedPartial);
    var split = store.splitEmergencyUpdate(live, proposed);
    var em = Object.assign({}, live, split.now);
    if (split.pending) {
      em.pending = split.pending;
      em.pendingDay = store.tomorrowKey(Date.now());
    } else {
      em.pending = null;
      em.pendingDay = '';
    }
    settings.emergency = em;
    save({ emergency: em });
  }

  function pendingSummary() {
    var p = settings.emergency && settings.emergency.pending;
    if (!p) return '';
    var bits = [];
    if (p.enabled === false) bits.push('limit off');
    if (p.totalPercent !== undefined) bits.push(p.totalPercent + '% pool');
    if (p.maxUses !== undefined) bits.push((p.maxUses === null ? '∞' : p.maxUses) + ' starts');
    if (p.optionPercents) bits.push('lengths ' + p.optionPercents.join(',') + '%');
    // Legacy keys (pre-v3 pending objects): still describe honestly if present.
    if (p.minutesPerDay !== undefined) bits.push(p.minutesPerDay + ' min/day');
    if (p.durations) bits.push('lengths ' + p.durations.join(','));
    if (!bits.length) return '';
    return '⏳ Pending tomorrow: ' + bits.join(' · ');
  }

  function parseChannel(input) {
    input = (input || '').trim();
    if (!input) return null;
    var out = { id: null, handle: null, url: null };
    var m = input.match(/(UC[\w-]{10,})/);
    if (m) out.id = m[1];
    var h = input.match(/@[\w.-]+/);
    if (h) { out.handle = '/' + h[0]; out.url = '/' + h[0]; }
    var c = input.match(/youtube\.com\/((c|user|channel)\/[^/?#\s]+|@[^/?#\s]+)/);
    if (c) {
      out.url = '/' + c[1];
      if (c[1].charAt(0) === '@') out.handle = '/' + c[1];
      var cm = c[1].match(/channel\/(UC[\w-]+)/);
      if (cm) out.id = cm[1];
    }
    if (!out.handle && !out.url && !out.id) {
      // bare handle without @
      if (/^[\w.-]+$/.test(input)) { out.handle = '/@' + input; out.url = '/@' + input; }
      else return null;
    }
    return out;
  }

  function hasStudyAllowlist() {
    var study = (settings && settings.study) || {};
    return !!((study.allowedChannels || []).length || (study.allowedVideos || []).length);
  }

  function terminalActive() {
    try {
      return !!(window.YTFOCUS.policy && window.YTFOCUS.policy.isTerminalActive(settings, Date.now()));
    } catch (e) { return false; }
  }

  function showStudySetup(message) {
    var note = $('studySetupNote');
    if (note) {
      note.textContent = message || 'Add at least one allowed channel or video before turning on Study Mode.';
      note.hidden = false;
    }
    var section = $('chInput');
    if (section) {
      section.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(function () { section.focus(); }, 250);
    }
  }

  function selectMode(m) {
    if (m === 'study' && !hasStudyAllowlist()) {
      showStudySetup('Add one allowed channel or video first. Your first item works today; later changes activate at midnight.');
      return Promise.resolve(false);
    }
    if (m === 'study' && settings.study) settings.study.prevMode = null;
    return save({ mode: m, study: settings.study }).then(function () { return true; });
  }

  function addInitialStudyEntry(kind, value) {
    if (hasStudyAllowlist() || terminalActive()) return false;
    settings.study = settings.study || {};
    var key = kind === 'channel' ? 'allowedChannels' : 'allowedVideos';
    settings.study[key] = settings.study[key] || [];
    settings.study[key].push(value);
    return save({ study: settings.study });
  }

  function finishWelcome(plan) {
    settings.blocking = { enabled: true };
    settings.mode = plan === 'full' ? 'full' : 'normal';
    return save({ blocking: settings.blocking, mode: settings.mode, onboarded: true }).then(function () {
      var dialog = $('welcomeDialog');
      if (dialog && dialog.open) dialog.close();
    });
  }

  function startPlan(plan, fromWelcome) {
    if (plan === 'study') {
      if (fromWelcome) {
        $('welcomePlans').hidden = true;
        $('welcomeStudy').hidden = false;
        $('welcomeChannel').focus();
      } else {
        showStudySetup('Add one allowed channel or video first, then choose Study Mode. Your first item works today.');
      }
      return;
    }
    finishWelcome(plan);
  }

  function init() {
    store.getSettings().then(function (s) { settings = s; render(); });

    document.querySelectorAll('#modeGroup .ytf-pill').forEach(function (b) {
      b.addEventListener('click', function () {
        var m = b.getAttribute('data-mode');
        var now = Date.now();
        var schNow = null;
        try { schNow = window.YTFOCUS.policy && window.YTFOCUS.policy.activeSchedule(settings, now); } catch (e) {}
        if (schNow) {
          var curEff = (window.YTFOCUS.policy && window.YTFOCUS.policy.effectiveMode(settings, now)) || schNow.mode;
          if (!window.YTFOCUS.policy.isModeTransitionAllowed(curEff, m)) return;
          if (m === 'study' && !hasStudyAllowlist()) {
            showStudySetup('Add one allowed channel or video first.');
            return;
          }
          settings.study = settings.study || {};
          settings.study.scheduleOverrideMode = m;
          save({ study: settings.study });
          return;
        }
        selectMode(m);
      });
    });
    document.querySelectorAll('#searchGroup .ytf-pill').forEach(function (b) {
      b.addEventListener('click', function () {
        settings.youtube.search.policy = b.getAttribute('data-sp');
        save({ youtube: settings.youtube });
      });
    });

    function bindToggle(id, fn) {
      $(id).addEventListener('change', function (e) { fn(e.target.checked); });
    }
    bindToggle('sEmOn', function (v) {
      saveEmergency({ enabled: v });
    });
    $('lEmTotal').addEventListener('change', function () {
      var v = parseInt($('lEmTotal').value, 10);
      if (isNaN(v) || v < 0) v = 0;
      if (v > 400) v = 400;
      saveEmergency({ totalPercent: v });
    });
    $('lEmUses').addEventListener('change', function () {
      var v = parseInt($('lEmUses').value, 10);
      if (isNaN(v) || v < 0) v = 0;
      if (v > 50) v = 50;
      saveEmergency({ maxUses: v === 0 ? null : v });
    });
    // Emergency option percents (max 4 choices).
    $('emOptGroup').addEventListener('click', function (ev) {
      if (locked()) return;
      var b = ev.target && ev.target.closest ? ev.target.closest('[data-emopt]') : null;
      if (!b || b.disabled) return;
      var v = parseInt(b.getAttribute('data-emopt'), 10);
      if (isNaN(v)) return;
      var cur = (((settings.emergency || {}).optionPercents) || []).slice();
      var proposed;
      if (cur.indexOf(v) === -1) {
        if (cur.length >= 4) return;
        proposed = cur.concat([v]).sort(function (a, b2) { return a - b2; });
      } else {
        proposed = cur.filter(function (d) { return d !== v; });
      }
      saveEmergency({ optionPercents: proposed });
    });
    // Daily quota input: numbers only, 1-1440, inline error, locked when blocking active.
    var qInput = $('lQuotaMin');
    var qErr = $('quotaError');
    if (qInput) {
      qInput.addEventListener('keydown', function (e) {
        if (e.key === 'e' || e.key === 'E' || e.key === '+' || e.key === '-' || e.key === '.') {
          e.preventDefault();
        }
      });
      qInput.addEventListener('input', function () {
        var raw = qInput.value.trim();
        var v = parseInt(raw, 10);
        if (!/^\d+$/.test(raw) || isNaN(v) || v < 1 || v > 1440) {
          if (qErr) { qErr.textContent = 'Must be a number between 1 and 1440 minutes.'; qErr.style.display = 'block'; }
        } else {
          if (qErr) qErr.style.display = 'none';
        }
      });
      qInput.addEventListener('change', function () {
        var isBlockOn = false;
        try { isBlockOn = window.YTFOCUS.policy && window.YTFOCUS.policy.isBlockingActive(settings, Date.now()); } catch (eQ) {}
        if (locked() || isBlockOn) { render(); return; }
        var raw = qInput.value.trim();
        var v = parseInt(raw, 10);
        if (!/^\d+$/.test(raw) || isNaN(v) || v < 1 || v > 1440) {
          if (qErr) { qErr.textContent = 'Must be a number between 1 and 1440 minutes.'; qErr.style.display = 'block'; }
          render();
          return;
        }
        if (qErr) qErr.style.display = 'none';
        settings.dailyQuota = { minutes: v };
        save({ dailyQuota: settings.dailyQuota });
      });
    }
    // Session option percents: instant multi-toggle (max 4 choices).
    $('sessOptGroup').addEventListener('click', function (ev) {
      if (locked()) return;
      var b = ev.target && ev.target.closest ? ev.target.closest('[data-sessopt]') : null;
      if (!b || b.disabled) return;
      var v = parseInt(b.getAttribute('data-sessopt'), 10);
      if (isNaN(v)) return;
      settings.session = settings.session || {};
      var cur = (((settings.session || {}).optionsPercent) || [5, 10, 20, 30]).slice();
      if (cur.indexOf(v) === -1) {
        if (cur.length >= 4) return;
        cur.push(v);
        cur.sort(function (a, b2) { return a - b2; });
      } else {
        if (cur.length <= 1) return;
        cur = cur.filter(function (d) { return d !== v; });
      }
      settings.session.optionsPercent = cur;
      save({ session: settings.session });
    });
    // Reminder checkpoints: instant multi-toggle.
    $('remGroup').addEventListener('click', function (ev) {
      if (locked()) return;
      var b = ev.target && ev.target.closest ? ev.target.closest('[data-rem]') : null;
      if (!b || b.disabled) return;
      var v = parseInt(b.getAttribute('data-rem'), 10);
      if (isNaN(v)) return;
      settings.reminders = settings.reminders || {};
      var cur = ((settings.reminders || {}).checkpointsPercent || [25, 50, 75]).slice();
      var proposed = cur.indexOf(v) === -1
        ? cur.concat([v]).sort(function (a, b2) { return a - b2; })
        : cur.filter(function (d) { return d !== v; });
      settings.reminders.checkpointsPercent = proposed;
      save({ reminders: settings.reminders });
    });
    // Study timer (same as popup).
    $('stTimerGroup').addEventListener('click', function (ev) {
      var b = ev.target && ev.target.closest ? ev.target.closest('[data-sttimer]') : null;
      if (!b || b.disabled) return;
      var mins = parseInt(b.getAttribute('data-sttimer'), 10);
      if (locked() && mins > 0) { render(); return; }
      if (mins > 0) {
        if (settings.mode !== 'study') settings.study.prevMode = settings.mode;
        settings.study.manualUntil = Date.now() + mins * 60000;
        settings.mode = 'study';
      } else {
        var back = null;
        try { back = store.restoreStudyPrevMode(settings.study, settings.mode); } catch (eR) {}
        settings.study.manualUntil = 0;
        if (back) settings.mode = back;
      }
      save({ study: settings.study, mode: settings.mode });
    });
    bindToggle('sMaster', function (v) {
      if (locked()) { render(); return; }
      var schNow = null;
      try { schNow = window.YTFOCUS.policy && window.YTFOCUS.policy.activeSchedule(settings, Date.now()); } catch (eS2) {}
      if (schNow) { render(); return; }
      var now = Date.now();
      if (!v) {
        if (settings.unblockUntil && settings.unblockUntil > now) {
          save({ unblockUntil: 0 });
          return;
        }
        var until = now + 5 * 60 * 1000;
        save({ unblockUntil: until });
      } else {
        var patch = { blocking: { enabled: true }, unblockUntil: 0 };
        save(patch);
      }
    });
    if ($('btnCancelUnblock')) {
      $('btnCancelUnblock').addEventListener('click', function () {
        save({ unblockUntil: 0 });
      });
    }
    bindToggle('sShorts', function (v) { settings.youtube.shorts.independent = v; save({ youtube: settings.youtube }); });
    bindToggle('sFirst', function (v) { settings.youtube.shorts.allowFirstShort = v; save({ youtube: settings.youtube }); });
    bindToggle('sHome', function (v) { settings.youtube.homeFeed.hide = v; save({ youtube: settings.youtube }); });
    bindToggle('sExplore', function (v) { settings.youtube.explore.hide = v; save({ youtube: settings.youtube }); });
    bindToggle('sUpNext', function (v) { settings.youtube.recommendations.hideUpNext = v; save({ youtube: settings.youtube }); });
    bindToggle('sRelated', function (v) { settings.youtube.recommendations.hideRelated = v; save({ youtube: settings.youtube }); });
    bindToggle('sEnd', function (v) { settings.youtube.recommendations.hideEndScreen = v; save({ youtube: settings.youtube }); });
    bindToggle('sShelves', function (v) { settings.youtube.recommendations.hideShelves = v; save({ youtube: settings.youtube }); });
    bindToggle('sTab', function (v) { settings.youtube.sidebar.hideShorts = v; save({ youtube: settings.youtube }); });
    bindToggle('sAutoplay', function (v) { settings.youtube.autoplay.disable = v; save({ youtube: settings.youtube }); });
    $('sStrict').addEventListener('change', function (e) {
      var now = Date.now();
      if (settings.strictMode) {
        if (!e.target.checked) {
          if (settings.strictUnlockUntil && settings.strictUnlockUntil > now) {
            save({ strictUnlockUntil: 0 });
            return;
          }
          var until = now + 30 * 60 * 1000;
          save({ strictUnlockUntil: until });
        } else {
          if (settings.strictUnlockUntil && settings.strictUnlockUntil > now) {
            save({ strictUnlockUntil: 0 });
          }
        }
      } else {
        if (e.target.checked) {
          save({ strictMode: true, strictUnlockUntil: 0 });
        }
      }
    });
    if ($('btnCancelStrict')) {
      $('btnCancelStrict').addEventListener('click', function () {
        save({ strictUnlockUntil: 0 });
      });
    }

    // Shorts limit dropdown & slider
    if ($('selShortsLimit')) {
      $('selShortsLimit').addEventListener('change', function () {
        if (locked()) { render(); return; }
        var val = $('selShortsLimit').value;
        if (val === 'no-cap') {
          settings.sessionLimits.shortsMax = null;
          if ($('boxShortsSlider')) $('boxShortsSlider').style.display = 'none';
        } else if (val === 'block-all') {
          settings.sessionLimits.shortsMax = 0;
          if ($('boxShortsSlider')) $('boxShortsSlider').style.display = 'none';
        } else if (val === 'set-number') {
          var num = parseInt($('rngShorts').value, 10) || 20;
          settings.sessionLimits.shortsMax = num;
          if ($('boxShortsSlider')) $('boxShortsSlider').style.display = 'flex';
          if ($('badgeShortsVal')) $('badgeShortsVal').textContent = num;
        }
        save({ sessionLimits: settings.sessionLimits });
      });
    }
    if ($('rngShorts')) {
      $('rngShorts').addEventListener('input', function () {
        var num = parseInt($('rngShorts').value, 10) || 1;
        if ($('badgeShortsVal')) $('badgeShortsVal').textContent = num;
      });
      $('rngShorts').addEventListener('change', function () {
        if (locked()) { render(); return; }
        var num = parseInt($('rngShorts').value, 10) || 1;
        settings.sessionLimits.shortsMax = num;
        save({ sessionLimits: settings.sessionLimits });
      });
    }

    // Videos limit dropdown & slider
    if ($('selVideosLimit')) {
      $('selVideosLimit').addEventListener('change', function () {
        if (locked()) { render(); return; }
        var val = $('selVideosLimit').value;
        if (val === 'no-limit') {
          settings.sessionLimits.videosMax = null;
          if ($('boxVideosSlider')) $('boxVideosSlider').style.display = 'none';
          if ($('warnBlockAllVideos')) $('warnBlockAllVideos').style.display = 'none';
        } else if (val === 'block-all') {
          settings.sessionLimits.videosMax = 0;
          if ($('boxVideosSlider')) $('boxVideosSlider').style.display = 'none';
          if ($('warnBlockAllVideos')) $('warnBlockAllVideos').style.display = 'block';
        } else if (val === 'set-limit') {
          var num = parseInt($('rngVideos').value, 10) || 10;
          settings.sessionLimits.videosMax = num;
          if ($('boxVideosSlider')) $('boxVideosSlider').style.display = 'flex';
          if ($('badgeVideosVal')) $('badgeVideosVal').textContent = num;
          if ($('warnBlockAllVideos')) $('warnBlockAllVideos').style.display = 'none';
        }
        save({ sessionLimits: settings.sessionLimits });
      });
    }
    if ($('rngVideos')) {
      $('rngVideos').addEventListener('input', function () {
        var num = parseInt($('rngVideos').value, 10) || 1;
        if ($('badgeVideosVal')) $('badgeVideosVal').textContent = num;
      });
      $('rngVideos').addEventListener('change', function () {
        if (locked()) { render(); return; }
        var num = parseInt($('rngVideos').value, 10) || 1;
        settings.sessionLimits.videosMax = num;
        save({ sessionLimits: settings.sessionLimits });
      });
    }

    // Watch minutes limit dropdown & slider
    if ($('selMinsLimit')) {
      $('selMinsLimit').addEventListener('change', function () {
        if (locked()) { render(); return; }
        var val = $('selMinsLimit').value;
        if (val === 'no-limit') {
          settings.sessionLimits.watchMinutes = 0;
          if ($('boxMinsSlider')) $('boxMinsSlider').style.display = 'none';
        } else if (val === 'set-limit') {
          var num = parseInt($('rngMins').value, 10) || 60;
          settings.sessionLimits.watchMinutes = num;
          if ($('boxMinsSlider')) $('boxMinsSlider').style.display = 'flex';
          if ($('badgeMinsVal')) $('badgeMinsVal').textContent = num + 'm';
        }
        save({ sessionLimits: settings.sessionLimits });
      });
    }
    if ($('rngMins')) {
      $('rngMins').addEventListener('input', function () {
        var num = parseInt($('rngMins').value, 10) || 5;
        if ($('badgeMinsVal')) $('badgeMinsVal').textContent = num + 'm';
      });
      $('rngMins').addEventListener('change', function () {
        if (locked()) { render(); return; }
        var num = parseInt($('rngMins').value, 10) || 5;
        settings.sessionLimits.watchMinutes = num;
        save({ sessionLimits: settings.sessionLimits });
      });
    }

    // Allowlist edits stage for midnight, except the first safe starter item;
    // terminal blocking never permits a same-day allowlist change.
    function stagePending(op, kind, value) {
      // A brand-new Study list is safe to seed immediately when terminal block
      // is inactive: there is no existing rule to weaken, and it lets a new
      // user begin Study Mode without an arbitrary overnight delay.
      if (op === 'add' && !hasStudyAllowlist() && !terminalActive()) {
        addInitialStudyEntry(kind, value);
        var note = $('studySetupNote');
        if (note) {
          note.textContent = 'Your first allowed item is ready now. You can turn on Study Mode.';
          note.hidden = false;
        }
        return;
      }
      settings.study.pendingChanges = settings.study.pendingChanges || [];
      settings.study.pendingChanges.push({ op: op, kind: kind, value: value, day: store.todayKey() });
      save({ study: settings.study });
    }
    $('chAdd').addEventListener('click', function () {
      var p = parseChannel($('chInput').value);
      if (!p) { $('chInput').focus(); return; }
      $('chInput').value = '';
      stagePending('add', 'channel', p);
    });
    $('vidAdd').addEventListener('click', function () {
      var v = ($('vidInput').value || '').trim();
      if (!v) return;
      var m = v.match(/[?&]v=([\w-]{6,})|\/shorts\/([\w-]{6,})|^([\w-]{11})$/);
      var id = m ? (m[1] || m[2] || m[3]) : null;
      if (!id) { $('vidInput').focus(); return; }
      $('vidInput').value = '';
      stagePending('add', 'video', { id: id, url: v });
    });
    function timeToMin(t) {
      var p = String(t || '00:00').split(':');
      return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0);
    }
    function timeMatches(fromMin, toMin, m) {
      if (fromMin === toMin) return false;
      if (fromMin < toMin) return m >= fromMin && m < toMin;
      return m >= fromMin || m < toMin;
    }
    function schedulesOverlap(a, b) {
      var aDays = a.days || [];
      var bDays = b.days || [];
      var hasShared = aDays.some(function (d) { return bDays.indexOf(d) !== -1; });
      if (!hasShared) return false;
      var aFrom = timeToMin(a.from);
      var aTo = timeToMin(a.to);
      var bFrom = timeToMin(b.from);
      var bTo = timeToMin(b.to);
      if (aFrom === aTo || bFrom === bTo) return false;
      for (var m = 0; m < 1440; m++) {
        if (timeMatches(aFrom, aTo, m) && timeMatches(bFrom, bTo, m)) return true;
      }
      return false;
    }
    function clearSchError() {
      var errEl = $('schError');
      if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
    }

    // Schedule day picker (Mon–Fri preselected); toggle to choose days.
    var schDayGroup = $('schDayGroup');
    if (schDayGroup) schDayGroup.addEventListener('click', function (ev) {
      var b = ev.target && ev.target.closest ? ev.target.closest('[data-schday]') : null;
      if (!b || b.disabled) return;
      clearSchError();
      b.classList.toggle('active');
    });
    if ($('schFrom')) $('schFrom').addEventListener('input', clearSchError);
    if ($('schTo')) $('schTo').addEventListener('input', clearSchError);
    if ($('schMode')) $('schMode').addEventListener('change', clearSchError);

    $('schAdd').addEventListener('click', function () {
      clearSchError();
      var days = [];
      document.querySelectorAll('#schDayGroup [data-schday].active').forEach(function (b) {
        var d = parseInt(b.getAttribute('data-schday'), 10);
        if (!isNaN(d)) days.push(d);
      });
      if (!days.length) days = [1, 2, 3, 4, 5];
      var fromVal = $('schFrom').value || '09:00';
      var toVal = $('schTo').value || '17:00';
      if (fromVal === toVal) {
        var errEl = $('schError');
        if (errEl) {
          errEl.textContent = 'Cannot add schedule: start and end time cannot be the same.';
          errEl.style.display = 'block';
        }
        return;
      }
      var m = $('schMode').value || 'study';
      if (['normal', 'restricted', 'study', 'full'].indexOf(m) === -1) m = 'study';
      var proposed = {
        days: days.slice().sort(),
        from: fromVal,
        to: toVal,
        mode: m
      };
      var existingList = (settings.study && settings.study.schedule) || [];
      for (var i = 0; i < existingList.length; i++) {
        if (schedulesOverlap(proposed, existingList[i])) {
          var ex = existingList[i];
          var dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          var exDays = (ex.days || []).map(function (d) { return dayNames[d]; }).join(',');
          var modeLabels = (window.YTFOCUS.CONSTANTS || {}).MODE_LABELS || {};
          var exMode = modeLabels[ex.mode] || ex.mode;
          var errEl = $('schError');
          if (errEl) {
            errEl.textContent = 'Cannot add schedule: overlaps with existing ' + exDays + ' ' + ex.from + '–' + ex.to + ' (' + exMode + ').';
            errEl.style.display = 'block';
          }
          return;
        }
      }
      settings.study = settings.study || {};
      settings.study.schedule = settings.study.schedule || [];
      settings.study.schedule.push(proposed);
      save({ study: settings.study });
    });

    var resetDialog = $('resetDialog');
    var resetL1 = $('resetLayer1');
    var resetL2 = $('resetLayer2');
    var resetInput = $('resetConfirmInput');
    var resetBtnFinal = $('resetBtnFinal');

    $('resetBtn').addEventListener('click', function () {
      if (resetDialog) {
        if (resetL1) resetL1.hidden = false;
        if (resetL2) resetL2.hidden = true;
        if (resetInput) resetInput.value = '';
        if (resetBtnFinal) resetBtnFinal.disabled = true;
        resetDialog.showModal();
      }
    });
    if ($('resetBtnCancel1')) {
      $('resetBtnCancel1').addEventListener('click', function () {
        if (resetDialog) resetDialog.close();
      });
    }
    if ($('resetBtnCancel2')) {
      $('resetBtnCancel2').addEventListener('click', function () {
        if (resetDialog) resetDialog.close();
      });
    }
    if ($('resetBtnNext1')) {
      $('resetBtnNext1').addEventListener('click', function () {
        if (resetL1) resetL1.hidden = true;
        if (resetL2) resetL2.hidden = false;
        if (resetInput) { resetInput.value = ''; resetInput.focus(); }
        if (resetBtnFinal) resetBtnFinal.disabled = true;
      });
    }
    if (resetInput) {
      resetInput.addEventListener('input', function () {
        var ok = (resetInput.value || '').trim().toUpperCase() === 'RESET';
        if (resetBtnFinal) resetBtnFinal.disabled = !ok;
      });
    }
    if (resetBtnFinal) {
      resetBtnFinal.addEventListener('click', function () {
        if ((resetInput.value || '').trim().toUpperCase() !== 'RESET') return;
        chrome.storage.local.clear().then(function () {
          return store.getSettings();
        }).then(function (s) {
          settings = s;
          render();
          if (resetDialog) resetDialog.close();
        });
      });
    }

    document.querySelectorAll('[data-start-plan]').forEach(function (button) {
      button.addEventListener('click', function () {
        startPlan(button.getAttribute('data-start-plan'), false);
      });
    });
    document.querySelectorAll('[data-welcome-plan]').forEach(function (button) {
      button.addEventListener('click', function () {
        startPlan(button.getAttribute('data-welcome-plan'), true);
      });
    });
    $('welcomeStudyBack').addEventListener('click', function () {
      $('welcomeStudy').hidden = true;
      $('welcomePlans').hidden = false;
      $('welcomeStudyError').hidden = true;
    });
    $('welcomeStudyStart').addEventListener('click', function () {
      var channel = parseChannel($('welcomeChannel').value);
      var error = $('welcomeStudyError');
      if (!channel) {
        error.textContent = 'Enter a valid YouTube channel URL, @handle, or channel ID.';
        error.hidden = false;
        $('welcomeChannel').focus();
        return;
      }
      if (terminalActive()) {
        error.textContent = 'Study setup is locked until midnight because today’s terminal block is active.';
        error.hidden = false;
        return;
      }
      addInitialStudyEntry('channel', channel).then(function () {
        settings.blocking = { enabled: true };
        settings.mode = 'study';
        return save({ blocking: settings.blocking, mode: settings.mode, onboarded: true });
      }).then(function () {
        var dialog = $('welcomeDialog');
        if (dialog && dialog.open) dialog.close();
      });
    });
    $('helpBtn').addEventListener('click', function () {
      var dialog = $('helpDialog');
      if (dialog && !dialog.open) dialog.showModal();
    });

    chrome.storage.onChanged.addListener(function () {
      store.getSettings().then(function (s) { settings = s; render(); });
    });

    // New installs are opened by the service worker; keep the welcome flow
    // available until the user deliberately chooses a plan.
    store.getSettings().then(function (s) {
      settings = s;
      if (!settings.onboarded) {
        var dialog = $('welcomeDialog');
        if (dialog && !dialog.open) dialog.showModal();
      }
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
