/* Popup controller — session-first daily decisions. Detailed config lives in Options. */
(function () {
  'use strict';
  var store = window.YTFOCUS.store;
  var settings = null;
  var flashUntil = 0; // "Applied ✓" flash window after a local change
  var openedAt = Date.now(); // cooldown anchor: wait-to-click after popup opens
  var selectedBreakDuration = 10;

  function $(id) { return document.getElementById(id); }

  function fmtUntil(ts) {
    var d = new Date(ts);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function fmtMin(m) {
    m = Math.max(0, m || 0);
    if (m >= 1) {
      var r = Math.floor(m * 10) / 10;
      return (r % 1 === 0 ? r.toFixed(0) : r) + ' min';
    }
    return Math.round(m * 60) + ' sec';
  }

  function modeLabel() {
    try {
      var labels = (window.YTFOCUS.CONSTANTS || {}).MODE_LABELS || {};
      return labels[settings.mode] || settings.mode || 'normal';
    } catch (e) { return (settings && settings.mode) || 'normal'; }
  }

  // Cooldown: first two choices clickable 3s after open, rest after 7s.
  function cooldownOk(index, now) {
    var wait = index < 2 ? 3000 : 7000;
    return (now - openedAt) >= wait;
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
          }).then(function (s) { settings = s; render(); });
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
          }).then(function (s) { settings = s; render(); });
        }
        stBox.style.display = 'none';
      }
    }

    var bTimer = $('schBreakTimer');
    if (bTimer && settings.activeBreak) {
      if (settings.activeBreak.endsAt > now) {
        bTimer.textContent = formatRemaining(settings.activeBreak.endsAt - now);
        needTicker = true;
      } else {
        chrome.storage.local.set({ activeBreak: null }).then(function () {
          return store.getSettings();
        }).then(function (s) { settings = s; render(); });
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
    var now = Date.now();
    var sch = null;
    try { sch = window.YTFOCUS.policy && window.YTFOCUS.policy.activeSchedule(settings, now); } catch (eSch) {}
    var activeSch = !!sch;
    var master = !!((settings.blocking && settings.blocking.enabled) || activeSch);
    var granted = settings.snoozeUntil && settings.snoozeUntil > now;
    var indieShorts = !!(settings.youtube && settings.youtube.shorts && settings.youtube.shorts.independent);
    var isStrictLocked = !!(settings.strictMode || (settings.strictUnlockUntil && settings.strictUnlockUntil > now));
    var locked = isStrictLocked || activeSch;
    var effMode = settings.mode || 'normal';
    try { effMode = (window.YTFOCUS.policy && window.YTFOCUS.policy.effectiveMode(settings, now)) || effMode; } catch (eEM) {}
    var effLabel = modeLabel();
    try {
      var labels = (window.YTFOCUS.CONSTANTS || {}).MODE_LABELS || {};
      effLabel = labels[effMode] || effMode;
    } catch (eEL) {}

    // Header: quota progress.
    var qMin = store.quotaMinutes(settings);
    var usedMin = 0;
    try { usedMin = store.usageMsToday(settings, now) / 60000; } catch (e) {}
    var remMin = Math.max(0, qMin - usedMin);
    $('quotaLine').textContent = Math.floor(usedMin) + ' / ' + qMin + ' min today';
    var nextRem = null;
    try {
      var cps = store.reminderCheckpointsMs(settings);
      var fired = ((settings.reminders || {}).triggeredToday) || [];
      for (var i = 0; i < cps.length; i++) {
        if (fired.indexOf(cps[i].pct) === -1) { nextRem = cps[i].pct; break; }
      }
    } catch (e2) {}
    $('quotaSubLine').textContent = fmtMin(remMin) + ' remaining' +
      (nextRem !== null ? ' · Next reminder: ' + nextRem + '%' : '') +
      (settings.strictMode ? ' · Strict on' : '');

    // Master
    $('tMaster').checked = master || (settings.unblockUntil && settings.unblockUntil > now);
    $('tMaster').disabled = locked;
    if (activeSch) {
      $('masterSub').textContent = 'Locked by schedule until ' + (sch.to || 'end') + ' (' + effLabel + ')';
    } else if (settings.unblockUntil && settings.unblockUntil > now) {
      $('masterSub').textContent = 'Unblocking in ' + formatRemaining(settings.unblockUntil - now);
    } else {
      $('masterSub').textContent = master
        ? ('On — enforcing ' + modeLabel())
        : (indieShorts ? 'Off — YouTube is normal, Shorts still blocked' : 'Off — YouTube is fully normal');
    }

    // Mode pills (locked during strict; during schedule follows transition matrix)
    document.querySelectorAll('#modeGroup .ytf-pill').forEach(function (b) {
      var pillMode = b.getAttribute('data-mode');
      b.classList.toggle('active', pillMode === effMode);
      if (isStrictLocked) {
        b.disabled = true;
      } else if (activeSch) {
        var allowed = window.YTFOCUS.policy && window.YTFOCUS.policy.isModeTransitionAllowed(effMode, pillMode);
        b.disabled = !allowed;
      } else {
        b.disabled = false;
      }
    });

    var jumpBox = $('studyJumpBox');
    if (jumpBox) {
      if (master && (effMode === 'full' || effMode === 'restricted') && effMode !== 'study') {
        jumpBox.style.display = 'block';
      } else {
        jumpBox.style.display = 'none';
      }
    }

    $('modeBadge').textContent = !master ? 'Off' : (granted ? 'Paused' : effLabel);
    var baseStatus = !master
      ? 'Blocking off'
      : (activeSch
        ? 'Schedule active until ' + (sch.to || 'end') + ' (' + effLabel + ')'
        : (isStrictLocked
          ? 'Strict Mode ON — hard lock'
          : (granted ? 'Session until ' + fmtUntil(settings.snoozeUntil) : 'Blocking active')));
    $('statusLine').textContent = (Date.now() < flashUntil ? '✓ Applied — ' : '') + baseStatus;

    // Grant choices: session pills while quota remains, emergency pills when
    // exhausted. Hidden entirely unless master is on with an eligible mode,
    // and never during terminal Full Block (locked until midnight).
    var gcard = $('sessionCard');
    var terminal = false;
    try { terminal = !!(window.YTFOCUS.policy && window.YTFOCUS.policy.isTerminalActive(settings, now)); } catch (eT2) {}
    var canOffer = master && !terminal && (effMode === 'normal' || effMode === 'restricted');
    var hasQuota = remMin > 0;
    var showSession = canOffer && hasQuota;
    var showEmergency = false;
    try { showEmergency = canOffer && !hasQuota && store.budgetOn(settings); } catch (e5) {}
    gcard.style.display = (showSession || showEmergency) ? '' : 'none';
    if (showSession || showEmergency) {
      var isEm = showEmergency && !showSession;
      $('grantTitle').textContent = isEm
        ? 'Today’s YouTube time is used up — extra-time options'
        : 'How long do you want to use YouTube?';
      var pills = [];
      if (isEm) {
        var emPcts = [];
        try { emPcts = (store.emergencyOf(settings).optionPercents || []).slice(0, 4); } catch (e6) {}
        pills = emPcts.map(function (p, i) {
          var fullMin = qMin * p / 100;
          var g = 0;
          try {
            g = store.emergencyGrantMin(fullMin,
              store.emergencyRemaining(settings, now) * 60000,
              store.emergencyUsesLeft(settings, now));
          } catch (e7) {}
          return { kind: 'emergency', pct: p, granted: g, ok: g > 0, cd: i < 2 ? 3 : 7 };
        });
      } else {
        var sessPcts = [];
        try { sessPcts = (((settings.session || {}).optionsPercent) || [5, 10, 20, 30]).slice(0, 4); } catch (e8) {}
        pills = sessPcts.map(function (p, i) {
          var fullMin = qMin * p / 100;
          var g = 0;
          try { g = store.sessionGrantMin(fullMin, remMin * 60000); } catch (e9) {}
          return { kind: 'session', pct: p, granted: g, ok: g > 0, cd: i < 2 ? 3 : 7 };
        });
        if (remMin > 0 && !pills.some(function (x) { return x.ok; })) {
          var _fg2 = Math.floor(remMin * 10) / 10;
          if (_fg2 > 0) pills.push({ kind: 'session', pct: null, granted: _fg2, ok: true, cd: 7, fallback: true });
        }
      }
      var gg = $('grantGroup');
      gg.innerHTML = pills.map(function (c) {
        var label = c.fallback ? ('Use remaining ' + fmtMin(c.granted)) : fmtMin(c.granted);
        var locked2 = !cooldownOk(pills.indexOf(c), now);
        var waitMs = locked2 ? Math.max(1, (pills.indexOf(c) < 2 ? 3000 : 7000) - (now - openedAt)) : 0;
        return '<button class="ytf-pill ytf-choice' + (locked2 && c.ok ? ' ytf-cooling' : '') + '" data-grant-kind="' + c.kind + '" data-grant-min="' + c.granted + '"' +
          (waitMs ? ' style="--ytf-cooldown-ms:' + Math.ceil(waitMs) + 'ms"' : '') +
          (waitMs ? ' aria-label="' + label + ', available in ' + Math.ceil(waitMs / 1000) + ' seconds"' : '') +
          ((!c.ok || locked2) ? ' disabled' : '') + '><span>' + label + '</span></button>';
      }).join('');
      var lineBits = [];
      if (isEm) {
        var u = Infinity, pm = Infinity;
        try { u = store.emergencyUsesLeft(settings, now); pm = store.emergencyRemaining(settings, now); } catch (e10) {}
        if (pm !== Infinity) lineBits.push(fmtMin(pm));
        if (u !== Infinity) lineBits.push(u + (u === 1 ? ' start' : ' starts'));
        $('grantLine').textContent = lineBits.length ? lineBits.join(' · ') + ' extra time left today' : '';
      } else {
        $('grantLine').textContent = fmtMin(remMin) + ' left today';
      }
    }
    $('resumeBtn').style.display = granted ? '' : 'none';

    // Schedule break card
    var breakCard = $('schBreakCard');
    var isBreak = false;
    try { isBreak = window.YTFOCUS.policy && window.YTFOCUS.policy.isScheduleBreakActive(settings, now); } catch (eB) {}

    if (breakCard) {
      if (activeSch && sch && sch.breaksEnabled) {
        breakCard.style.display = 'block';
        var bActiveBox = $('schBreakActiveBox');
        var bTriggerBox = $('schBreakTriggerBox');
        if (isBreak) {
          if (bActiveBox) bActiveBox.style.display = 'block';
          if (bTriggerBox) bTriggerBox.style.display = 'none';
          var bTimer = $('schBreakTimer');
          var remBreakMs = Math.max(0, (settings.activeBreak && settings.activeBreak.endsAt || 0) - now);
          if (bTimer) bTimer.textContent = formatRemaining(remBreakMs);
          $('modeBadge').textContent = 'Break';
          $('statusLine').textContent = (Date.now() < flashUntil ? '✓ Applied — ' : '') + '☕ Break active (' + formatRemaining(remBreakMs) + ')';
        } else {
          if (bActiveBox) bActiveBox.style.display = 'none';
          if (bTriggerBox) bTriggerBox.style.display = 'block';
          var totalBreakMin = sch.breakMinutes || 0;
          var usedBreakMin = sch.breakMinutesUsed || 0;
          var remBreakMin = Math.max(0, totalBreakMin - usedBreakMin);
          var totalBreakCount = sch.breakCount || 0;
          var usedBreakCount = sch.breaksUsedCount || 0;
          var remBreakCount = Math.max(0, totalBreakCount - usedBreakCount);
          var cooldownMs = (window.YTFOCUS.policy && window.YTFOCUS.policy.getScheduleBreakCooldownRemaining)
            ? window.YTFOCUS.policy.getScheduleBreakCooldownRemaining(sch, now) : 0;
          var maxSingleMin = (window.YTFOCUS.policy && window.YTFOCUS.policy.getMaxSingleBreakMinutes)
            ? window.YTFOCUS.policy.getMaxSingleBreakMinutes(sch) : remBreakMin;
          var maxChoice = Math.min(remBreakMin, maxSingleMin);

          var bSummary = $('schBreakSummary');
          if (bSummary) {
            var sumText = remBreakCount + ' break' + (remBreakCount === 1 ? '' : 's') + ' left · ' + remBreakMin + 'm remaining allowance';
            if (cooldownMs > 0) {
              sumText += ' · Cooldown active (' + Math.ceil(cooldownMs / 60000) + 'm)';
            }
            bSummary.textContent = sumText;
          }

          var bChoices = $('schBreakChoices');
          var startBtn = $('btnStartSchBreak');
          if (bChoices) {
            bChoices.innerHTML = '';
            if (remBreakCount > 0 && remBreakMin > 0) {
              var opts = [5, 10, 15, maxChoice].filter(function (v, i, arr) {
                return v > 0 && v <= maxChoice && arr.indexOf(v) === i;
              }).sort(function (a, b) { return a - b; });
              if (!opts.length && maxChoice > 0) opts = [maxChoice];

              opts.forEach(function (optVal) {
                var btn = document.createElement('button');
                btn.className = 'ytf-pill' + (selectedBreakDuration === optVal ? ' active' : '');
                btn.textContent = (optVal === maxChoice && opts.length > 1 ? 'Max (' + optVal + 'm)' : optVal + 'm');
                btn.disabled = cooldownMs > 0;
                btn.addEventListener('click', function () {
                  selectedBreakDuration = optVal;
                  render();
                });
                bChoices.appendChild(btn);
              });
              if (!selectedBreakDuration || selectedBreakDuration > maxChoice) {
                selectedBreakDuration = opts[0];
              }
              if (startBtn) {
                if (cooldownMs > 0) {
                  startBtn.disabled = true;
                  startBtn.textContent = '☕ Cooldown active (' + Math.ceil(cooldownMs / 60000) + 'm left)';
                } else {
                  startBtn.disabled = false;
                  startBtn.textContent = '☕ Start ' + selectedBreakDuration + ' min break';
                }
              }
            } else {
              bChoices.innerHTML = '<span class="ytf-caption">No breaks remaining for today.</span>';
              if (startBtn) {
                startBtn.disabled = true;
                startBtn.textContent = '☕ Break limit reached';
              }
            }
          }
        }
      } else {
        breakCard.style.display = 'none';
      }
    }
  }

  // Config writes go through the Strict filter; grant spends bypass it
  // (spending is allowed under Strict — only config is locked).
  function mutatePatch(patch, after) {
    var res = { applied: patch, dropped: [] };
    try {
      if (store.filterStrictPatch) res = store.filterStrictPatch(settings, patch);
    } catch (e) {}
    var keys = Object.keys(res.applied);
    var done = function () {
      return store.getSettings().then(function (s) {
        settings = s;
        flashUntil = Date.now() + 1500;
        render();
        setTimeout(render, 1600); // clear the flash
        // Re-render past cooldown unlocks (3s/7s from open).
        var wait = Date.now() - openedAt;
        if (wait < 7500) setTimeout(render, 7500 - wait + 100);
        chrome.runtime.sendMessage({ type: 'ytf:refresh-badge' }).catch(function () {});
        if (after) { try { after(); } catch (e2) {} }
      });
    };
    if (!keys.length) return done();
    return chrome.storage.local.set(res.applied).then(done).catch(function () {});
  }

  function startGrant(kind, minutes) {
    if (!settings) return;
    if (!settings.blocking || !settings.blocking.enabled) return;
    var now = Date.now();
    // Terminal Full Block is absolute: no grant path may unlock it.
    try {
      if (window.YTFOCUS.policy && window.YTFOCUS.policy.isTerminalActive(settings, now)) return;
    } catch (eT) {}
    try { store.emergencyRollover(settings, now); } catch (e) {}
    var granted = 0;
    if (kind === 'emergency') {
      var usesLeft = Infinity, poolRemMs = Infinity;
      try {
        usesLeft = store.emergencyUsesLeft(settings, now);
        poolRemMs = store.emergencyRemaining(settings, now) * 60000;
      } catch (e2) {}
      if (!(usesLeft > 0)) return;
      granted = store.emergencyGrantMin(minutes, poolRemMs, usesLeft);
      if (!(granted > 0)) return;
      var em = settings.emergency || {};
      em.usedPoolMin = (em.usedPoolMin || 0) + granted;
      em.usedUses = (em.usedUses || 0) + 1;
      em.poolDay = store.todayKey(new Date(now));
      settings.emergency = em;
      settings.snoozeUntil = now + Math.round(granted * 60000);
      settings.session = settings.session || {};
      settings.session.lastGrant = { kind: 'emergency', min: granted, at: now };
      chrome.storage.local.set({
        snoozeUntil: settings.snoozeUntil, emergency: em, session: settings.session
      }).then(function () {
        chrome.runtime.sendMessage({ type: 'ytf:snooze', until: settings.snoozeUntil }).catch(function () {});
        return store.getSettings();
      }).then(function (s) { settings = s; flashUntil = Date.now() + 1500; render(); });
    } else {
      granted = store.sessionGrantMin(minutes, store.usageRemainingMs(settings, now));
      if (!(granted > 0)) return;
      settings.snoozeUntil = now + Math.round(granted * 60000);
      settings.session = settings.session || {};
      settings.session.lastGrant = { kind: 'session', min: granted, at: now };
      settings.usage = settings.usage || {};
      if (settings.usage.activeDay !== store.todayKey(new Date(now))) {
        settings.usage.activeMsToday = 0;
        settings.usage.sessionsToday = 0;
        settings.usage.activeDay = store.todayKey(new Date(now));
      }
      settings.usage.sessionsToday = (settings.usage.sessionsToday || 0) + 1;
      chrome.storage.local.set({
        snoozeUntil: settings.snoozeUntil, session: settings.session, usage: settings.usage
      }).then(function () {
        chrome.runtime.sendMessage({ type: 'ytf:snooze', until: settings.snoozeUntil }).catch(function () {});
        return store.getSettings();
      }).then(function (s) { settings = s; flashUntil = Date.now() + 1500; render(); });
    }
  }

  function init() {
    openedAt = Date.now();
    store.getSettings().then(function (s) {
      settings = s;
      render();
      // Cooldown unlock ticks.
      setTimeout(render, 3200);
      setTimeout(render, 7300);
    });

    document.querySelectorAll('#modeGroup .ytf-pill').forEach(function (b) {
      b.addEventListener('click', function () {
        var now = Date.now();
        var schNow = null;
        try { schNow = window.YTFOCUS.policy && window.YTFOCUS.policy.activeSchedule(settings, now); } catch (eSN) {}
        if (settings.strictMode || (settings.strictUnlockUntil && settings.strictUnlockUntil > now)) return;
        var m = b.getAttribute('data-mode');
        if (schNow) {
          var curEff = (window.YTFOCUS.policy && window.YTFOCUS.policy.effectiveMode(settings, now)) || schNow.mode;
          if (!window.YTFOCUS.policy.isModeTransitionAllowed(curEff, m)) return;
          if (m === 'study' && !(((settings.study || {}).allowedChannels || []).length || ((settings.study || {}).allowedVideos || []).length)) {
            $('statusLine').textContent = 'Add an allowed channel or video before using Study Mode.';
            chrome.runtime.openOptionsPage();
            return;
          }
          settings.study = settings.study || {};
          settings.study.scheduleOverrideMode = m;
          mutatePatch({ study: settings.study });
          return;
        }
        if (m === 'study' && !(((settings.study || {}).allowedChannels || []).length || ((settings.study || {}).allowedVideos || []).length)) {
          $('statusLine').textContent = 'Add an allowed channel or video before using Study Mode.';
          chrome.runtime.openOptionsPage();
          return;
        }
        // Explicit mode choice wins over any pending timer restore.
        if (m === 'study' && settings.study) settings.study.prevMode = null;
        mutatePatch({ mode: m, study: settings.study });
      });
    });

    $('tMaster').addEventListener('change', function (e) {
      var schNow = null;
      try { schNow = window.YTFOCUS.policy && window.YTFOCUS.policy.activeSchedule(settings, Date.now()); } catch (eSN2) {}
      var isStrict = !!(settings.strictMode || (settings.strictUnlockUntil && settings.strictUnlockUntil > Date.now()));
      if (isStrict || schNow) { render(); return; }
      var want = e.target.checked;
      var now = Date.now();
      if (!want) {
        if (settings.unblockUntil && settings.unblockUntil > now) {
          mutatePatch({ unblockUntil: 0 });
          return;
        }
        var until = now + 5 * 60 * 1000;
        mutatePatch({ unblockUntil: until });
        return;
      }
      mutatePatch({ blocking: { enabled: true }, unblockUntil: 0 });
    });

    if ($('btnCancelUnblock')) {
      $('btnCancelUnblock').addEventListener('click', function () {
        mutatePatch({ unblockUntil: 0 });
      });
    }

    if ($('btnCancelStrict')) {
      $('btnCancelStrict').addEventListener('click', function () {
        mutatePatch({ strictUnlockUntil: 0 });
      });
    }

    if ($('studyJumpBtn')) {
      $('studyJumpBtn').addEventListener('click', function () {
        var now = Date.now();
        var sch = null;
        try { sch = window.YTFOCUS.policy && window.YTFOCUS.policy.activeSchedule(settings, now); } catch (e) {}
        var channels = (settings.study && settings.study.allowedChannels) || [];
        var videos = (settings.study && settings.study.allowedVideos) || [];
        if (channels.length === 0 && videos.length === 0) {
          chrome.runtime.openOptionsPage();
          return;
        }
        if (sch) {
          if (!settings.study) settings.study = {};
          settings.study.scheduleOverrideMode = 'study';
          mutatePatch({ study: settings.study });
        } else {
          mutatePatch({ mode: 'study' });
        }
      });
    }

    // Single delegated listener — grant pills re-render from settings.
    $('grantGroup').addEventListener('click', function (ev) {
      var b = ev.target && ev.target.closest ? ev.target.closest('[data-grant-kind]') : null;
      if (!b || b.disabled) return;
      startGrant(b.getAttribute('data-grant-kind'), parseFloat(b.getAttribute('data-grant-min')));
    });

    $('openOptions').addEventListener('click', function () {
      chrome.runtime.openOptionsPage();
    });

    if ($('btnStartSchBreak')) {
      $('btnStartSchBreak').addEventListener('click', function () {
        var now = Date.now();
        var sch = null;
        try { sch = window.YTFOCUS.policy && window.YTFOCUS.policy.activeSchedule(settings, now); } catch (e) {}
        if (!sch || !sch.breaksEnabled) return;
        var totalBreakMin = sch.breakMinutes || 0;
        var usedBreakMin = sch.breakMinutesUsed || 0;
        var remBreakMin = Math.max(0, totalBreakMin - usedBreakMin);
        var totalBreakCount = sch.breakCount || 0;
        var usedBreakCount = sch.breaksUsedCount || 0;
        var remBreakCount = Math.max(0, totalBreakCount - usedBreakCount);
        if (remBreakCount <= 0 || remBreakMin <= 0) return;

        var cooldownMs = (window.YTFOCUS.policy && window.YTFOCUS.policy.getScheduleBreakCooldownRemaining)
          ? window.YTFOCUS.policy.getScheduleBreakCooldownRemaining(sch, now) : 0;
        if (cooldownMs > 0) return;

        var maxSingleMin = (window.YTFOCUS.policy && window.YTFOCUS.policy.getMaxSingleBreakMinutes)
          ? window.YTFOCUS.policy.getMaxSingleBreakMinutes(sch) : remBreakMin;
        var dur = Math.min(remBreakMin, selectedBreakDuration || 5);
        if (maxSingleMin > 0) dur = Math.min(dur, maxSingleMin);

        var startedAt = now;
        var endsAt = now + dur * 60 * 1000;

        var updatedSchedules = (settings.schedules || []).map(function (s) {
          if (s.id === sch.id) {
            return Object.assign({}, s, {
              breaksUsedCount: (s.breaksUsedCount || 0) + 1,
              breakMinutesUsed: (s.breakMinutesUsed || 0) + dur
            });
          }
          return s;
        });

        var activeBreak = {
          scheduleId: sch.id,
          startedAt: startedAt,
          endsAt: endsAt,
          durationMinutes: dur
        };

        chrome.storage.local.set({ schedules: updatedSchedules, activeBreak: activeBreak }).then(function () {
          return store.getSettings();
        }).then(function (s) {
          settings = s;
          flashUntil = Date.now() + 1500;
          render();
          chrome.runtime.sendMessage({ type: 'ytf:refresh-badge' }).catch(function () {});
        }).catch(function () {});
      });
    }

    if ($('btnEndSchBreak')) {
      $('btnEndSchBreak').addEventListener('click', function () {
        var now = Date.now();
        if (!settings.activeBreak) return;
        var ab = settings.activeBreak;
        var elapsedMs = Math.max(0, now - (ab.startedAt || now));
        var elapsedMin = Math.min(ab.durationMinutes || 0, Math.ceil(elapsedMs / 60000));
        var refundMin = Math.max(0, (ab.durationMinutes || 0) - elapsedMin);

        var updatedSchedules = (settings.schedules || []).map(function (s) {
          if (s.id === ab.scheduleId) {
            var newUsed = Math.max(0, (s.breakMinutesUsed || 0) - refundMin);
            return Object.assign({}, s, { breakMinutesUsed: newUsed, lastBreakEndedAt: now });
          }
          return s;
        });

        chrome.storage.local.set({ schedules: updatedSchedules, activeBreak: null }).then(function () {
          return store.getSettings();
        }).then(function (s) {
          settings = s;
          flashUntil = Date.now() + 1500;
          render();
          chrome.runtime.sendMessage({ type: 'ytf:refresh-badge' }).catch(function () {});
        }).catch(function () {});
      });
    }

    $('resumeBtn').addEventListener('click', function () {
      // Early end refunds unused pool minutes (uses stay spent).Spend paths
      // bypass the Strict write filter (config stays locked, spending allowed).
      var patch = store.cancelSnoozePatch(settings, Date.now());
      chrome.storage.local.set(patch).then(function () {
        return store.getSettings();
      }).then(function (s) {
        settings = s;
        flashUntil = Date.now() + 1500;
        render();
        chrome.runtime.sendMessage({ type: 'ytf:refresh-badge' }).catch(function () {});
      }).catch(function () {});
    });

    chrome.storage.onChanged.addListener(function () {
      store.getSettings().then(function (s) { settings = s; render(); });
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
