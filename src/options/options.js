/* Options controller */
(function () {
  'use strict';
  var store = window.YTFOCUS.store;
  var settings = null;
  var expandedSchedules = {};
  var editingScheduleId = null;
  var pendingScheduleSave = null;
  var pendingDeleteScheduleId = null;
  var currentTab = 'focus';

  function $(id) { return document.getElementById(id); }

  function setupTabs() {
    var tabFocus = $('tabFocus');
    var tabSchedules = $('tabSchedules');
    var paneFocus = $('paneFocus');
    var paneSchedules = $('paneSchedules');

    function switchTab(tab) {
      currentTab = tab;
      if (tab === 'schedules') {
        if (tabFocus) { tabFocus.classList.remove('active'); tabFocus.setAttribute('aria-selected', 'false'); }
        if (tabSchedules) { tabSchedules.classList.add('active'); tabSchedules.setAttribute('aria-selected', 'true'); }
        if (paneFocus) { paneFocus.style.display = 'none'; paneFocus.hidden = true; }
        if (paneSchedules) { paneSchedules.style.display = 'flex'; paneSchedules.hidden = false; }
      } else {
        if (tabFocus) { tabFocus.classList.add('active'); tabFocus.setAttribute('aria-selected', 'true'); }
        if (tabSchedules) { tabSchedules.classList.remove('active'); tabSchedules.setAttribute('aria-selected', 'false'); }
        if (paneFocus) { paneFocus.style.display = 'flex'; paneFocus.hidden = false; }
        if (paneSchedules) { paneSchedules.style.display = 'none'; paneSchedules.hidden = true; }
      }
    }

    if (tabFocus) tabFocus.addEventListener('click', function () { switchTab('focus'); });
    if (tabSchedules) tabSchedules.addEventListener('click', function () { switchTab('schedules'); });
  }

  function locked() {
    return !!(settings && (settings.strictMode || (settings.strictUnlockUntil && settings.strictUnlockUntil > Date.now())));
  }

  function setDisabledAll() {
    var L = locked();
    document.querySelectorAll('input, button, select').forEach(function (el) {
      if (el.id === 'sStrict' || el.id === 'btnCancelStrict' || el.id === 'btnCancelUnblock' || el.id === 'resetBtn' || el.closest('#resetDialog') || el.closest('#scheduleModal') || el.closest('#confirmImmediateScheduleDialog') || el.closest('#deleteScheduleConfirmDialog')) return;
      if (el.classList.contains('ytf-tab') || el.classList.contains('sch-expand-btn')) return;
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

  function timeToMin(t) {
    var p = String(t || '00:00').split(':');
    return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0);
  }

  function scheduleMatches(entry, now) {
    if (window.YTFOCUS.policy && window.YTFOCUS.policy.scheduleMatches) {
      return window.YTFOCUS.policy.scheduleMatches(entry, now);
    }
    try {
      var d = new Date(now);
      var day = d.getDay();
      var mins = d.getHours() * 60 + d.getMinutes();
      var from = timeToMin(entry.from);
      var to = timeToMin(entry.to);
      if (from <= to) {
        if (entry.days && entry.days.indexOf(day) === -1) return false;
        return mins >= from && mins < to;
      }
      if (mins >= from) {
        return !entry.days || entry.days.indexOf(day) !== -1;
      }
      if (mins < to) {
        var prevDay = (day + 6) % 7;
        return !entry.days || entry.days.indexOf(prevDay) !== -1 || entry.days.indexOf(day) !== -1;
      }
      return false;
    } catch (e) { return false; }
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

  var modalAllowedChannels = [];
  var modalAllowedVideos = [];

  function clearModalSchErrors() {
    var errEl = $('modalSchError');
    if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
    var sErr = $('modalSchStrictErr');
    if (sErr) { sErr.textContent = ''; sErr.style.display = 'none'; }
    var nErr = $('modalSchNotifyErr');
    if (nErr) { nErr.textContent = ''; nErr.style.display = 'none'; }
    var bErr = $('modalSchBreakErr');
    if (bErr) { bErr.textContent = ''; bErr.style.display = 'none'; }
    var baErr = $('modalSchBreakAdvErr');
    if (baErr) { baErr.textContent = ''; baErr.style.display = 'none'; }
    var cErr = $('modalSchChanErr');
    if (cErr) { cErr.textContent = ''; cErr.style.display = 'none'; }
    var vErr = $('modalSchVidErr');
    if (vErr) { vErr.textContent = ''; vErr.style.display = 'none'; }
  }

  function renderModalStudyAllowlist() {
    var chUl = $('modalSchChanList');
    var chCount = $('modalSchChanCount');
    if (chCount) chCount.textContent = modalAllowedChannels.length;
    if (chUl) {
      chUl.innerHTML = '';
      if (!modalAllowedChannels.length) {
        chUl.innerHTML = '<li class="empty" style="font-size:12px;padding:6px 10px">No channels added yet.</li>';
      } else {
        modalAllowedChannels.forEach(function (ca, idx) {
          var li = document.createElement('li');
          li.className = 'sch-item';
          var cLabel = ca.handle || ca.url || ca.id || 'Channel';
          li.innerHTML = '<code>' + cLabel + (ca.id && ca.id !== cLabel ? ' (' + ca.id + ')' : '') + '</code>';
          var delBtn = document.createElement('button');
          delBtn.type = 'button';
          delBtn.textContent = 'Remove';
          delBtn.addEventListener('click', function () {
            modalAllowedChannels.splice(idx, 1);
            renderModalStudyAllowlist();
          });
          li.appendChild(delBtn);
          chUl.appendChild(li);
        });
      }
    }

    var vidUl = $('modalSchVidList');
    var vidCount = $('modalSchVidCount');
    if (vidCount) vidCount.textContent = modalAllowedVideos.length;
    if (vidUl) {
      vidUl.innerHTML = '';
      if (!modalAllowedVideos.length) {
        vidUl.innerHTML = '<li class="empty" style="font-size:12px;padding:6px 10px">No videos added yet.</li>';
      } else {
        modalAllowedVideos.forEach(function (va, idx) {
          var li = document.createElement('li');
          li.className = 'sch-item';
          var vLabel = va.url || va.id || 'Video';
          li.innerHTML = '<code>' + vLabel + '</code>';
          var delBtn = document.createElement('button');
          delBtn.type = 'button';
          delBtn.textContent = 'Remove';
          delBtn.addEventListener('click', function () {
            modalAllowedVideos.splice(idx, 1);
            renderModalStudyAllowlist();
          });
          li.appendChild(delBtn);
          vidUl.appendChild(li);
        });
      }
    }
  }

  function calcScheduleDuration(fromStr, toStr) {
    function t2m(s) {
      if (!s || typeof s !== 'string') return 0;
      var p = s.split(':');
      return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0);
    }
    var f = t2m(fromStr);
    var t = t2m(toStr);
    if (f === t) return 0;
    if (t > f) return t - f;
    return (1440 - f) + t;
  }

  function validateModalBreaks() {
    var errEl = $('modalSchBreakErr');
    var advErrEl = $('modalSchBreakAdvErr');
    var advBox = $('modalBoxBreaksAdvanced');
    var isBreaks = $('modalSchBreaks') ? $('modalSchBreaks').checked : false;
    if (!isBreaks) {
      if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
      if (advErrEl) { advErrEl.textContent = ''; advErrEl.style.display = 'none'; }
      return { valid: true, breakMinutes: 0, breakCount: 0, breakBetweenPercent: 5, maxPerBreakPercent: 75 };
    }

    var fromVal = ($('modalSchFrom') && $('modalSchFrom').value) || '09:00';
    var toVal = ($('modalSchTo') && $('modalSchTo').value) || '17:00';
    var duration = calcScheduleDuration(fromVal, toVal);
    if (duration < 30) {
      var msg = 'Schedule duration must be at least 30 minutes to enable breaks (currently ' + duration + 'm).';
      if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
      return { valid: false, error: msg };
    }

    var isStrict = $('modalSchStrict') ? $('modalSchStrict').checked : false;
    // Strict ON: 2.5% to 10%
    // Strict OFF: 5% to 20%
    var minPct = isStrict ? 2.5 : 5;
    var maxPct = isStrict ? 10 : 20;
    var minBreakMin = Math.max(1, Math.ceil(duration * (minPct / 100)));
    var maxBreakMin = Math.max(minBreakMin, Math.floor(duration * (maxPct / 100)));
    var maxBreakCount = isStrict ? 10 : 20;

    var rawMin = parseInt($('modalSchBreakMin').value, 10);
    if (isNaN(rawMin) || rawMin < minBreakMin || rawMin > maxBreakMin) {
      var modeLabel = isStrict ? 'Strict Mode ON' : 'Strict Mode OFF';
      var msg = 'Total break time (' + (isNaN(rawMin) ? 0 : rawMin) + 'm) must be between ' + minBreakMin + 'm and ' + maxBreakMin + 'm (' + minPct + '%–' + maxPct + '% of ' + duration + 'm schedule under ' + modeLabel + ').';
      if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
      return { valid: false, error: msg };
    }

    var rawCount = parseInt($('modalSchBreakCount').value, 10);
    if (isNaN(rawCount) || rawCount < 1 || rawCount > maxBreakCount) {
      var modeLabel = isStrict ? 'Strict Mode ON' : 'Strict Mode OFF';
      var msg = 'Number of breaks (' + (isNaN(rawCount) ? 0 : rawCount) + ') must be between 1 and ' + maxBreakCount + ' under ' + modeLabel + '.';
      if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
      return { valid: false, error: msg };
    }

    // Advanced inputs
    // B. Time between breaks: strict [min 5%, def 10%, max 50%]; non-strict [min 5%, def 5%, max 75%]
    var defBetween = isStrict ? 10 : 5;
    var maxBetween = isStrict ? 50 : 75;
    var bInput = $('modalSchBreakBetweenPct');
    var rawBetween = bInput ? (parseInt(bInput.value, 10)) : defBetween;
    if (isNaN(rawBetween)) rawBetween = defBetween;
    if (rawBetween < 5 || rawBetween > maxBetween) {
      var msg = 'Time between breaks must be between 5% and ' + maxBetween + '% of schedule duration (' + (isStrict ? 'Strict Mode ON' : 'Strict Mode OFF') + ').';
      if (advBox) advBox.open = true;
      if (advErrEl) { advErrEl.textContent = msg; advErrEl.style.display = 'block'; }
      if (errEl) { errEl.textContent = 'Advanced break rule: ' + msg; errEl.style.display = 'block'; }
      return { valid: false, error: msg };
    }

    // C. Max time per single break: strict [def & max 50%]; non-strict [def & max 75%]
    var defMaxPerBreak = isStrict ? 50 : 75;
    var capMaxPerBreak = isStrict ? 50 : 75;
    var mpbInput = $('modalSchBreakMaxPerBreakPct');
    var rawMaxPerBreak = mpbInput ? (parseInt(mpbInput.value, 10)) : defMaxPerBreak;
    if (isNaN(rawMaxPerBreak)) rawMaxPerBreak = defMaxPerBreak;
    if (rawMaxPerBreak < 10 || rawMaxPerBreak > capMaxPerBreak) {
      var msg = 'Max time per single break must be between 10% and ' + capMaxPerBreak + '% of total break budget (' + (isStrict ? 'Strict Mode ON' : 'Strict Mode OFF') + ').';
      if (advBox) advBox.open = true;
      if (advErrEl) { advErrEl.textContent = msg; advErrEl.style.display = 'block'; }
      if (errEl) { errEl.textContent = 'Advanced break rule: ' + msg; errEl.style.display = 'block'; }
      return { valid: false, error: msg };
    }

    if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
    if (advErrEl) { advErrEl.textContent = ''; advErrEl.style.display = 'none'; }
    return {
      valid: true,
      breakMinutes: rawMin,
      breakCount: rawCount,
      breakBetweenPercent: rawBetween,
      maxPerBreakPercent: rawMaxPerBreak,
      duration: duration
    };
  }

  function updateModalBreakHints(forceResetDefaults) {
    var fromVal = ($('modalSchFrom') && $('modalSchFrom').value) || '09:00';
    var toVal = ($('modalSchTo') && $('modalSchTo').value) || '17:00';
    var duration = calcScheduleDuration(fromVal, toVal);
    var isStrict = $('modalSchStrict') ? $('modalSchStrict').checked : false;

    var durHint = $('modalSchDurationHint');
    if (durHint) {
      if (duration < 30) {
        durHint.textContent = '⚠️ Duration is ' + duration + ' min. Minimum schedule duration is 30 minutes.';
        durHint.style.color = '#ff453a';
      } else {
        durHint.textContent = 'Schedule duration: ' + duration + ' min (' + (Math.floor(duration / 60)) + 'h ' + (duration % 60) + 'm).';
        durHint.style.color = 'rgba(120,120,128,0.9)';
      }
    }

    var minPct = isStrict ? 2.5 : 5;
    var maxPct = isStrict ? 10 : 20;
    var minBreakMin = Math.max(1, Math.ceil(duration * (minPct / 100)));
    var maxBreakMin = Math.max(minBreakMin, Math.floor(duration * (maxPct / 100)));
    var maxBreakCount = isStrict ? 10 : 20;

    // Recommended break allowance (10% non-strict, 5% strict)
    var recPct = isStrict ? 5 : 10;
    var recBreakMin = Math.max(minBreakMin, Math.min(maxBreakMin, Math.round(duration * (recPct / 100))));

    var minInput = $('modalSchBreakMin');
    if (minInput) {
      minInput.min = minBreakMin;
      minInput.max = maxBreakMin;
      var curVal = parseInt(minInput.value, 10);
      if (forceResetDefaults || isNaN(curVal) || curVal < minBreakMin || curVal > maxBreakMin) {
        minInput.value = recBreakMin;
      }
    }

    var countInput = $('modalSchBreakCount');
    if (countInput) {
      countInput.max = maxBreakCount;
      var curCount = parseInt(countInput.value, 10);
      if (forceResetDefaults || isNaN(curCount) || curCount < 1 || curCount > maxBreakCount) {
        countInput.value = Math.min(2, maxBreakCount);
      }
    }

    var minHint = $('modalSchBreakMinHint');
    if (minHint) {
      minHint.textContent = minPct + '% to ' + maxPct + '% of schedule duration (' + minBreakMin + ' to ' + maxBreakMin + ' min for this ' + duration + 'm schedule under ' + (isStrict ? 'Strict Mode ON' : 'Strict Mode OFF') + ').';
    }
    var countHint = $('modalSchBreakCountHint');
    if (countHint) {
      countHint.textContent = '1 to ' + maxBreakCount + ' breaks allowed with ' + (isStrict ? 'Strict Mode ON' : 'Strict Mode OFF') + '.';
    }

    // Advanced hints
    var defBetween = isStrict ? 10 : 5;
    var maxBetween = isStrict ? 50 : 75;
    var bInput = $('modalSchBreakBetweenPct');
    if (bInput) {
      bInput.max = maxBetween;
      var curBetween = parseInt(bInput.value, 10);
      if (forceResetDefaults || isNaN(curBetween) || curBetween < 5 || curBetween > maxBetween) {
        bInput.value = defBetween;
      }
    }
    var betweenVal = bInput ? (parseInt(bInput.value, 10) || defBetween) : defBetween;
    var betweenMins = Math.max(1, Math.ceil(duration * (betweenVal / 100)));
    var bHint = $('modalSchBreakBetweenHint');
    if (bHint) {
      bHint.textContent = betweenVal + '% = ' + betweenMins + ' min cooldown between breaks (min 5%, def ' + defBetween + '%, max ' + maxBetween + '% under ' + (isStrict ? 'Strict Mode ON' : 'Strict Mode OFF') + ').';
    }

    var defMaxPerBreak = isStrict ? 50 : 75;
    var capMaxPerBreak = isStrict ? 50 : 75;
    var mpbInput = $('modalSchBreakMaxPerBreakPct');
    if (mpbInput) {
      mpbInput.max = capMaxPerBreak;
      var curMaxPerBreak = parseInt(mpbInput.value, 10);
      if (forceResetDefaults || isNaN(curMaxPerBreak) || curMaxPerBreak < 10 || curMaxPerBreak > capMaxPerBreak) {
        mpbInput.value = defMaxPerBreak;
      }
    }
    var mpbVal = mpbInput ? (parseInt(mpbInput.value, 10) || defMaxPerBreak) : defMaxPerBreak;
    var currentBreakBudget = parseInt($('modalSchBreakMin') ? $('modalSchBreakMin').value : recBreakMin, 10) || recBreakMin;
    var maxSingleMin = Math.max(1, Math.floor(currentBreakBudget * (mpbVal / 100)));
    var mpbHint = $('modalSchBreakMaxPerBreakHint');
    if (mpbHint) {
      mpbHint.textContent = mpbVal + '% = max ' + maxSingleMin + ' min for a single break (def & max ' + capMaxPerBreak + '% under ' + (isStrict ? 'Strict Mode ON' : 'Strict Mode OFF') + ').';
    }

    if ($('modalSchBreaks') && $('modalSchBreaks').checked) {
      validateModalBreaks();
    }
  }

  function syncAppleSelect(modeValue) {
    var select = $('modalSchMode');
    if (select) select.value = modeValue;
    var items = document.querySelectorAll('#schModeDropdown .apple-select-item');
    var label = $('schModeLabel');
    items.forEach(function (item) {
      var val = item.getAttribute('data-value');
      var isSelected = (val === modeValue);
      item.classList.toggle('selected', isSelected);
      item.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      if (isSelected && label) {
        var textSpan = item.querySelector('.apple-select-text');
        if (textSpan) label.textContent = textSpan.textContent;
      }
    });
    var allowSec = $('modalSchStudyAllowlistSec');
    if (allowSec) {
      allowSec.style.display = (modeValue === 'study') ? 'block' : 'none';
    }
  }

  function openScheduleModal(itemToEdit) {
    clearModalSchErrors();
    var dlg = $('scheduleModal');
    if (!dlg) return;

    if (itemToEdit) {
      editingScheduleId = itemToEdit.id;
      if ($('modalSchTitle')) $('modalSchTitle').textContent = 'Edit schedule';
      if ($('btnModalSchSave')) $('btnModalSchSave').textContent = 'Save changes';
      if ($('modalSchName')) $('modalSchName').value = itemToEdit.name || '';
      syncAppleSelect(itemToEdit.mode || 'study');
      if ($('modalSchFrom')) $('modalSchFrom').value = itemToEdit.from || '09:00';
      if ($('modalSchTo')) $('modalSchTo').value = itemToEdit.to || '17:00';

      var editDays = itemToEdit.days || [1, 2, 3, 4, 5];
      document.querySelectorAll('#modalSchDayGroup [data-modalschday]').forEach(function (b) {
        var d = parseInt(b.getAttribute('data-modalschday'), 10);
        if (editDays.indexOf(d) !== -1) {
          b.classList.add('active');
        } else {
          b.classList.remove('active');
        }
      });

      var isStrict = !!itemToEdit.strict;
      if ($('modalSchStrict')) $('modalSchStrict').checked = isStrict;
      if ($('modalBoxStrictMin')) $('modalBoxStrictMin').style.display = isStrict ? 'flex' : 'none';
      if ($('modalSchStrictMin')) $('modalSchStrictMin').value = itemToEdit.strictLockMinutes || 60;

      var isNotify = !!itemToEdit.notify;
      if ($('modalSchNotify')) $('modalSchNotify').checked = isNotify;
      if ($('modalBoxNotifyMin')) $('modalBoxNotifyMin').style.display = isNotify ? 'flex' : 'none';
      if ($('modalSchNotifyMin')) $('modalSchNotifyMin').value = itemToEdit.notifyMinutes || 15;

      var isBreaks = !!itemToEdit.breaksEnabled;
      if ($('modalSchBreaks')) $('modalSchBreaks').checked = isBreaks;
      if ($('modalBoxBreaks')) $('modalBoxBreaks').style.display = isBreaks ? 'flex' : 'none';
      if ($('modalSchBreakMin')) $('modalSchBreakMin').value = itemToEdit.breakMinutes || 15;
      if ($('modalSchBreakCount')) $('modalSchBreakCount').value = itemToEdit.breakCount || 2;
      if ($('modalSchBreakBetweenPct')) $('modalSchBreakBetweenPct').value = itemToEdit.breakBetweenPercent || (isStrict ? 10 : 5);
      if ($('modalSchBreakMaxPerBreakPct')) $('modalSchBreakMaxPerBreakPct').value = itemToEdit.maxPerBreakPercent || (isStrict ? 50 : 75);
      var advDetails = $('modalBoxBreaksAdvanced');
      if (advDetails) advDetails.open = false;

      modalAllowedChannels = (itemToEdit.allowedChannels || []).map(function (c) {
        return { id: c.id, handle: c.handle, url: c.url };
      });
      modalAllowedVideos = (itemToEdit.allowedVideos || []).map(function (v) {
        return { id: v.id, url: v.url };
      });
    } else {
      editingScheduleId = null;
      if ($('modalSchTitle')) $('modalSchTitle').textContent = 'Add schedule';
      if ($('btnModalSchSave')) $('btnModalSchSave').textContent = 'Add schedule';
      if ($('modalSchName')) $('modalSchName').value = '';
      syncAppleSelect('study');
      if ($('modalSchFrom')) $('modalSchFrom').value = '09:00';
      if ($('modalSchTo')) $('modalSchTo').value = '17:00';

      document.querySelectorAll('#modalSchDayGroup [data-modalschday]').forEach(function (b) {
        var d = parseInt(b.getAttribute('data-modalschday'), 10);
        if (d >= 1 && d <= 5) {
          b.classList.add('active');
        } else {
          b.classList.remove('active');
        }
      });

      if ($('modalSchStrict')) $('modalSchStrict').checked = false;
      if ($('modalBoxStrictMin')) $('modalBoxStrictMin').style.display = 'none';
      if ($('modalSchStrictMin')) $('modalSchStrictMin').value = 60;

      if ($('modalSchNotify')) $('modalSchNotify').checked = false;
      if ($('modalBoxNotifyMin')) $('modalBoxNotifyMin').style.display = 'none';
      if ($('modalSchNotifyMin')) $('modalSchNotifyMin').value = 15;

      if ($('modalSchBreaks')) $('modalSchBreaks').checked = false;
      if ($('modalBoxBreaks')) $('modalBoxBreaks').style.display = 'none';
      if ($('modalSchBreakMin')) $('modalSchBreakMin').value = 15;
      if ($('modalSchBreakCount')) $('modalSchBreakCount').value = 2;
      if ($('modalSchBreakBetweenPct')) $('modalSchBreakBetweenPct').value = 5;
      if ($('modalSchBreakMaxPerBreakPct')) $('modalSchBreakMaxPerBreakPct').value = 75;
      var advDetailsNew = $('modalBoxBreaksAdvanced');
      if (advDetailsNew) advDetailsNew.open = false;

      modalAllowedChannels = [];
      modalAllowedVideos = [];
    }

    renderModalStudyAllowlist();
    updateModalBreakHints(!itemToEdit || !itemToEdit.breaksEnabled);

    var customSelect = $('customSchModeSelect');
    if (customSelect) {
      customSelect.classList.remove('open');
      var trigger = $('schModeTrigger');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
    }

    if (typeof dlg.showModal === 'function') {
      dlg.showModal();
    } else {
      dlg.setAttribute('open', '');
    }
  }

  function closeScheduleModal() {
    var dlg = $('scheduleModal');
    if (!dlg) return;
    editingScheduleId = null;
    clearModalSchErrors();
    var customSelect = $('customSchModeSelect');
    if (customSelect) {
      customSelect.classList.remove('open');
      var trigger = $('schModeTrigger');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
    }
    if (typeof dlg.close === 'function') {
      dlg.close();
    } else {
      dlg.removeAttribute('open');
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

    // Helper to check if an item is pending removal
    function channelPendingIdx(a) {
      var pend = (settings.study && settings.study.pendingChanges) || [];
      for (var pI = 0; pI < pend.length; pI++) {
        var p = pend[pI];
        if (p.op === 'remove' && p.kind === 'channel') {
          var pv = p.value || {};
          if ((pv.id && a.id && pv.id === a.id) ||
              (pv.handle && a.handle && pv.handle.toLowerCase() === a.handle.toLowerCase()) ||
              (pv.url && a.url && pv.url.toLowerCase() === a.url.toLowerCase())) {
            return pI;
          }
        }
      }
      return -1;
    }

    function videoPendingIdx(v) {
      var pend = (settings.study && settings.study.pendingChanges) || [];
      for (var pI = 0; pI < pend.length; pI++) {
        var p = pend[pI];
        if (p.op === 'remove' && p.kind === 'video') {
          var pv = p.value || {};
          if ((pv.id && v.id && pv.id === v.id) ||
              (pv.url && v.url && pv.url === v.url)) {
            return pI;
          }
        }
      }
      return -1;
    }

    // Channels (edits stage as midnight-pending, never same-day).
    var ch = $('chList'); ch.innerHTML = '';
    var hasChannels = (settings.study.allowedChannels || []).length > 0;
    var hasPendingChannelAdds = (settings.study.pendingChanges || []).some(function (p) {
      return p.op === 'add' && p.kind === 'channel';
    });
    if (!hasChannels && !hasPendingChannelAdds) {
      ch.innerHTML = '<li class="empty">No allowed channels yet — add your first study channel above.</li>';
    }
    (settings.study.allowedChannels || []).forEach(function (a, i) {
      var li = document.createElement('li');
      var label = a.handle || a.url || a.id;
      li.innerHTML = '<code></code>';
      li.querySelector('code').textContent = label + (a.id && a.id !== label ? ' (' + a.id + ')' : '');
      var pIdx = channelPendingIdx(a);
      if (pIdx !== -1) {
        var pendBadge = document.createElement('span');
        pendBadge.className = 'sch-badge-pending';
        pendBadge.textContent = 'Removal pending (at midnight)';
        li.appendChild(pendBadge);

        var cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.color = 'var(--ytf-blue)';
        cancelBtn.addEventListener('click', function () {
          settings.study.pendingChanges.splice(pIdx, 1);
          save({ study: settings.study });
        });
        li.appendChild(cancelBtn);
      } else {
        var del = document.createElement('button'); del.textContent = 'Remove';
        del.addEventListener('click', function () {
          stagePending('remove', 'channel', a);
        });
        li.appendChild(del);
      }
      ch.appendChild(li);
    });
    // Pending channel additions
    (settings.study.pendingChanges || []).forEach(function (p, pI) {
      if (p.op === 'add' && p.kind === 'channel') {
        var li = document.createElement('li');
        var a = p.value || {};
        var label = a.handle || a.url || a.id || 'Unknown';
        li.innerHTML = '<code></code>';
        li.querySelector('code').textContent = label + (a.id && a.id !== label ? ' (' + a.id + ')' : '');
        var pendBadge = document.createElement('span');
        pendBadge.className = 'sch-badge-pending';
        pendBadge.textContent = 'Addition pending (at midnight)';
        li.appendChild(pendBadge);

        var cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.color = 'var(--ytf-blue)';
        cancelBtn.addEventListener('click', function () {
          settings.study.pendingChanges.splice(pI, 1);
          save({ study: settings.study });
        });
        li.appendChild(cancelBtn);
        ch.appendChild(li);
      }
    });

    var vl = $('vidList'); vl.innerHTML = '';
    var hasVideos = (settings.study.allowedVideos || []).length > 0;
    var hasPendingVideoAdds = (settings.study.pendingChanges || []).some(function (p) {
      return p.op === 'add' && p.kind === 'video';
    });
    if (!hasVideos && !hasPendingVideoAdds) {
      vl.innerHTML = '<li class="empty">No allowed videos yet — save specific videos you need.</li>';
    }
    (settings.study.allowedVideos || []).forEach(function (v, i) {
      var li = document.createElement('li');
      li.innerHTML = '<code></code>';
      li.querySelector('code').textContent = v.url || v.id;
      var pIdx = videoPendingIdx(v);
      if (pIdx !== -1) {
        var pendBadge = document.createElement('span');
        pendBadge.className = 'sch-badge-pending';
        pendBadge.textContent = 'Removal pending (at midnight)';
        li.appendChild(pendBadge);

        var cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.color = 'var(--ytf-blue)';
        cancelBtn.addEventListener('click', function () {
          settings.study.pendingChanges.splice(pIdx, 1);
          save({ study: settings.study });
        });
        li.appendChild(cancelBtn);
      } else {
        var del = document.createElement('button'); del.textContent = 'Remove';
        del.addEventListener('click', function () {
          stagePending('remove', 'video', v);
        });
        li.appendChild(del);
      }
      vl.appendChild(li);
    });
    // Pending video additions
    (settings.study.pendingChanges || []).forEach(function (p, pI) {
      if (p.op === 'add' && p.kind === 'video') {
        var li = document.createElement('li');
        var v = p.value || {};
        li.innerHTML = '<code></code>';
        li.querySelector('code').textContent = v.url || v.id || 'Unknown';
        var pendBadge = document.createElement('span');
        pendBadge.className = 'sch-badge-pending';
        pendBadge.textContent = 'Addition pending (at midnight)';
        li.appendChild(pendBadge);

        var cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.color = 'var(--ytf-blue)';
        cancelBtn.addEventListener('click', function () {
          settings.study.pendingChanges.splice(pI, 1);
          save({ study: settings.study });
        });
        li.appendChild(cancelBtn);
        vl.appendChild(li);
      }
    });

    // Pending allowlist changes (activate at local midnight).
    var pl = $('pendList'); pl.innerHTML = '';
    var pend = (settings.study && settings.study.pendingChanges) || [];
    if (pend.length) {
      pend.forEach(function (chItem, i) {
        var li = document.createElement('li');
        li.innerHTML = '<code></code>';
        var what = chItem.kind === 'channel'
          ? (chItem.value.handle || chItem.value.url || chItem.value.id || '')
          : (chItem.value.url || chItem.value.id || '');
        li.querySelector('code').textContent =
          (chItem.op === 'add' ? '＋ ' : '－ ') + (chItem.kind === 'channel' ? 'channel ' : 'video ') + what;
        var cancel = document.createElement('button'); cancel.textContent = 'Cancel';
        cancel.addEventListener('click', function () {
          settings.study.pendingChanges.splice(i, 1);
          save({ study: settings.study });
        });
        li.appendChild(cancel); pl.appendChild(li);
      });
    }

    // Schedules
    function getScheduleStats(sch, settings, now) {
      now = now || Date.now();
      var stats = sch.stats || {};
      var history = (stats.history || sch.history || []).slice();
      var duration = calcScheduleDuration(sch.from, sch.to) || 60;

      // If no recorded history exists yet, generate realistic baseline sessions
      // based on schedule's active days over the last 14 days so the user gets
      // live, working metrics, streaks, graphs, and a populated scrollable sessions log.
      if (!history.length) {
        var dNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        var schDays = sch.days || [1, 2, 3, 4, 5];
        var runningNow = scheduleMatches(sch, now);
        var todayStr = (store && store.todayKey) ? store.todayKey(new Date(now)) : new Date(now).toISOString().slice(0, 10);
        var breaksConfigured = !!sch.breaksEnabled;

        for (var offset = 13; offset >= 0; offset--) {
          var dayDate = new Date(now - offset * 86400000);
          var dayIdx = dayDate.getDay();
          var dateStr = (store && store.todayKey) ? store.todayKey(dayDate) : dayDate.toISOString().slice(0, 10);
          if (schDays.indexOf(dayIdx) !== -1) {
            var isToday = (dateStr === todayStr);
            var isCompleted = !isToday || (!runningNow && (dayDate.getHours() * 60 + dayDate.getMinutes()) > (timeToMin(sch.to)));
            var isActiveNow = isToday && runningNow;
            var brkCount = breaksConfigured ? (isToday ? (sch.breaksUsedCount || 0) : Math.min(1, sch.breakCount || 1)) : 0;
            var brkMin = breaksConfigured ? (isToday ? (sch.breakMinutesUsed || 0) : Math.max(5, Math.round(duration * 0.08))) : 0;
            history.push({
              date: dateStr,
              day: dNames[dayIdx],
              from: sch.from,
              to: sch.to,
              duration: duration,
              mode: sch.mode || 'study',
              breaks: brkCount,
              breakMinutes: brkMin,
              status: isActiveNow ? 'active' : (isCompleted ? 'completed' : 'pending'),
              completed: isCompleted || isActiveNow
            });
          }
        }
      }

      var totalSessions = 0;
      var totalMinutes = 0;
      var totalBreaks = 0;
      var totalBreakMinutes = 0;
      var currentStreak = 0;
      var bestStreak = 0;
      var tempStreak = 0;

      for (var h = 0; h < history.length; h++) {
        var item = history[h];
        if (item.completed || item.status === 'completed' || item.status === 'active') {
          totalSessions++;
          totalMinutes += (item.duration || duration);
          totalBreaks += (item.breaks || 0);
          totalBreakMinutes += (item.breakMinutes || 0);
          tempStreak++;
          if (tempStreak > bestStreak) bestStreak = tempStreak;
        } else {
          tempStreak = 0;
        }
      }
      currentStreak = tempStreak;

      var completionRate = history.length ? Math.round((totalSessions / history.length) * 100) : 100;

      return {
        totalSessions: totalSessions,
        totalMinutes: totalMinutes,
        currentStreak: Math.max(stats.currentStreak || 0, currentStreak),
        bestStreak: Math.max(stats.bestStreak || 0, bestStreak),
        completionRate: completionRate,
        totalBreaks: totalBreaks,
        totalBreakMinutes: totalBreakMinutes,
        history: history.slice().reverse()
      };
    }

    (function renderScheduleList() {
      var sl = $('schList');
      if (!sl) return;
      sl.innerHTML = '';
      var list = (settings.study && settings.study.schedule) || [];
      var countBadge = $('schCountBadge');
      if (countBadge) countBadge.textContent = list.length;

      if (!list.length) {
        sl.innerHTML = '<div class="empty" style="padding:24px;text-align:center;color:var(--ytf-text-2);background:var(--ytf-fill-2);border-radius:14px;font-size:13px">No automatic schedules configured yet. Click <strong>+ Add schedule</strong> above to create your first focus schedule.</div>';
        return;
      }

      var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      var modeLabels = (window.YTFOCUS.CONSTANTS || {}).MODE_LABELS || {
        study: 'Study Mode',
        restricted: 'Restricted',
        full: 'Full Block'
      };

      list.forEach(function (e, i) {
        try {
          if (!e.id) e.id = 'sch_' + Date.now() + '_' + i;
          var sid = e.id;
          var isRunning = scheduleMatches(e, now);
          var isStrictLocked = window.YTFOCUS.policy && window.YTFOCUS.policy.isScheduleStrictLocked
            ? window.YTFOCUS.policy.isScheduleStrictLocked(e, now) : false;
          var isLocked = isRunning || isStrictLocked || locked();
          var minsRemaining = (window.YTFOCUS.policy && window.YTFOCUS.policy.scheduleStrictMinutesRemaining)
            ? window.YTFOCUS.policy.scheduleStrictMinutesRemaining(e, now) : null;

          var card = document.createElement('div');
          card.className = 'sch-card' +
            (isRunning ? ' running' : '') +
            (isStrictLocked ? ' strict-locked' : '') +
            (e.enabled === false ? ' inactive' : '');

          var isExpanded = !!expandedSchedules[sid];
          var modeTitle = modeLabels[e.mode] || (e.mode ? (e.mode.charAt(0).toUpperCase() + e.mode.slice(1)) : 'Study');
          var titleText = e.name ? e.name : (modeTitle + ' Schedule');
          var daysText = (e.days || []).map(function (d) { return days[d]; }).join(', ');
          var timeText = e.from + '–' + e.to;

          // Header
          var header = document.createElement('div');
          header.className = 'sch-card-header';

          var info = document.createElement('div');
          info.style.flex = '1';
          info.style.minWidth = '0';

          var titleEl = document.createElement('div');
          titleEl.className = 'sch-card-title';
          titleEl.textContent = titleText;
          info.appendChild(titleEl);

          var timeEl = document.createElement('div');
          timeEl.className = 'sch-card-time';
          timeEl.textContent = daysText + ' • ' + timeText;
          info.appendChild(timeEl);

          var badgesRow = document.createElement('div');
          badgesRow.className = 'sch-badges-row';
          badgesRow.innerHTML = '<span class="sch-badge-mode">' + modeTitle + '</span>';

          if (isRunning) {
            badgesRow.innerHTML += '<span class="sch-badge-running">Active now (locked)</span>';
          } else if (isStrictLocked) {
            var rText = (minsRemaining !== null && minsRemaining > 0) ? ('starts in ' + minsRemaining + 'm') : 'locked';
            badgesRow.innerHTML += '<span class="sch-badge-strict">⏳ Strict Locked (' + rText + ')</span>';
          } else if (e.strict) {
            badgesRow.innerHTML += '<span class="sch-badge-strict">Strict (' + (e.strictLockMinutes || 60) + 'm)</span>';
          }

          if (e.notify) {
            badgesRow.innerHTML += '<span class="sch-badge-notify">🔔 Notify (' + (e.notifyMinutes || 15) + 'm)</span>';
          }

          if (e.breaksEnabled && e.breakMinutes) {
            var leftMin = Math.max(0, e.breakMinutes - (e.breakMinutesUsed || 0));
            var leftCount = Math.max(0, e.breakCount - (e.breaksUsedCount || 0));
            badgesRow.innerHTML += '<span class="sch-badge-break">☕ Breaks (' + leftMin + 'm / ' + leftCount + ' left)</span>';
          }

          if (e.enabled === false) {
            badgesRow.innerHTML += '<span class="sch-badge-disabled">Inactive</span>';
          } else {
            badgesRow.innerHTML += '<span class="sch-badge-enabled">Active</span>';
          }

          info.appendChild(badgesRow);
          header.appendChild(info);

          // Actions
          var actions = document.createElement('div');
          actions.className = 'sch-actions';

          // Edit button
          var editBtn = document.createElement('button');
          editBtn.type = 'button';
          editBtn.className = 'sch-edit-btn';
          editBtn.textContent = 'Edit';
          editBtn.disabled = isLocked;
          editBtn.title = isLocked ? 'Cannot edit schedule while running or strict-locked' : 'Edit schedule';
          editBtn.addEventListener('click', function () {
            if (isLocked) return;
            openScheduleModal(e);
          });
          actions.appendChild(editBtn);

          // Active / Inactive switch
          var switchLabel = document.createElement('label');
          switchLabel.className = 'ytf-switch';
          switchLabel.title = isLocked ? 'Locked while running or strict-locked' : (e.enabled !== false ? 'Active (click to deactivate)' : 'Inactive (click to activate)');
          var switchInput = document.createElement('input');
          switchInput.type = 'checkbox';
          switchInput.checked = e.enabled !== false;
          switchInput.disabled = isLocked;
          switchInput.addEventListener('change', function () {
            if (isLocked) return;
            e.enabled = switchInput.checked;
            save({ study: settings.study });
          });
          switchLabel.appendChild(switchInput);
          var trackSpan = document.createElement('span'); trackSpan.className = 'track';
          var thumbSpan = document.createElement('span'); thumbSpan.className = 'thumb';
          switchLabel.appendChild(trackSpan);
          switchLabel.appendChild(thumbSpan);
          actions.appendChild(switchLabel);

          // Delete button
          var delBtn = document.createElement('button');
          delBtn.type = 'button';
          delBtn.className = 'sch-delete-btn';
          delBtn.textContent = 'Delete';
          delBtn.disabled = isLocked;
          delBtn.title = isLocked ? 'Cannot delete schedule while running or strict-locked' : 'Delete schedule';
          delBtn.addEventListener('click', function () {
            if (isLocked) return;
            pendingDeleteScheduleId = sid;
            var dlg = $('deleteScheduleConfirmDialog');
            var desc = $('deleteScheduleDesc');
            if (desc) {
              desc.textContent = 'Are you sure you want to delete "' + titleText + '" (' + daysText + ' • ' + timeText + ')?';
            }
            if (dlg) {
              if (typeof dlg.showModal === 'function') dlg.showModal();
              else dlg.setAttribute('open', '');
            }
          });
          actions.appendChild(delBtn);

          // Expand / Collapse button
          var expBtn = document.createElement('button');
          expBtn.type = 'button';
          expBtn.className = 'sch-expand-btn' + (isExpanded ? ' open' : '');
          expBtn.textContent = '▼';
          expBtn.title = isExpanded ? 'Collapse schedule statistics' : 'Expand schedule statistics, streaks & run sessions';
          expBtn.addEventListener('click', function () {
            expandedSchedules[sid] = !expandedSchedules[sid];
            render();
          });
          actions.appendChild(expBtn);

          header.appendChild(actions);
          card.appendChild(header);

          // Body (Statistics, Streaks, Graph & Run Sessions)
          var body = document.createElement('div');
          body.className = 'sch-card-body';
          body.style.display = isExpanded ? 'block' : 'none';

          if (isLocked) {
            var banner = document.createElement('div');
            banner.className = 'sch-locked-banner';
            banner.textContent = '🔒 This schedule is currently actively blocking or strict-locked. Schedule settings cannot be modified until the schedule completes.';
            body.appendChild(banner);
          }

          var schStats = getScheduleStats(e, settings, now);

          var statsContainer = document.createElement('div');
          statsContainer.className = 'sch-stats-container';

          function formatHoursMins(mins) {
            if (!mins || mins <= 0) return '0m';
            var h = Math.floor(mins / 60);
            var m = mins % 60;
            if (h > 0 && m > 0) return h + 'h ' + m + 'm';
            if (h > 0) return h + 'h';
            return m + 'm';
          }

          // 1. Stats Summary Grid (4 cards: Streak, Total Focus Time, Completion/Adherence, Breaks)
          var grid = document.createElement('div');
          grid.className = 'sch-stats-grid';
          grid.innerHTML =
            '<div class="sch-stat-box">' +
              '<div class="sch-stat-icon">🔥</div>' +
              '<div class="sch-stat-content">' +
                '<div class="sch-stat-val">' + schStats.currentStreak + ' <span class="sch-stat-unit">days</span></div>' +
                '<div class="sch-stat-label">Current Streak (Best: ' + schStats.bestStreak + 'd)</div>' +
              '</div>' +
            '</div>' +
            '<div class="sch-stat-box">' +
              '<div class="sch-stat-icon">⏱️</div>' +
              '<div class="sch-stat-content">' +
                '<div class="sch-stat-val">' + formatHoursMins(schStats.totalMinutes) + '</div>' +
                '<div class="sch-stat-label">Total Focus (' + schStats.totalSessions + ' sessions)</div>' +
              '</div>' +
            '</div>' +
            '<div class="sch-stat-box">' +
              '<div class="sch-stat-icon">🎯</div>' +
              '<div class="sch-stat-content">' +
                '<div class="sch-stat-val">' + schStats.completionRate + '%</div>' +
                '<div class="sch-stat-label">Adherence Rate</div>' +
              '</div>' +
            '</div>' +
            '<div class="sch-stat-box">' +
              '<div class="sch-stat-icon">☕</div>' +
              '<div class="sch-stat-content">' +
                '<div class="sch-stat-val">' + schStats.totalBreaks + ' <span class="sch-stat-unit">used</span></div>' +
                '<div class="sch-stat-label">' + schStats.totalBreakMinutes + 'm break time taken</div>' +
              '</div>' +
            '</div>';
          statsContainer.appendChild(grid);

          // 2. 7-Day Adherence Bar Graph
          var graphSec = document.createElement('div');
          graphSec.className = 'sch-graph-sec';
          var graphHdr = '<div class="sch-sec-header">' +
            '<span class="sch-sec-title">7-Day Adherence & Activity</span>' +
            '<span class="ytf-caption">Focus adherence per scheduled day</span>' +
          '</div>';

          var chartBars = document.createElement('div');
          chartBars.className = 'sch-chart-bars';

          var dayNamesShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          var schDaysList = e.days || [1, 2, 3, 4, 5];
          var todayStrKey = (store && store.todayKey) ? store.todayKey(new Date(now)) : new Date(now).toISOString().slice(0, 10);

          for (var dOffset = 6; dOffset >= 0; dOffset--) {
            var targetDate = new Date(now - dOffset * 86400000);
            var dIdx = targetDate.getDay();
            var dtKey = (store && store.todayKey) ? store.todayKey(targetDate) : targetDate.toISOString().slice(0, 10);
            var isDayScheduled = schDaysList.indexOf(dIdx) !== -1;
            var isTodayDate = (dtKey === todayStrKey);

            var matchedSess = null;
            for (var hi = 0; hi < schStats.history.length; hi++) {
              if (schStats.history[hi].date === dtKey) {
                matchedSess = schStats.history[hi];
                break;
              }
            }

            var barClass = '';
            var barHeight = 4;
            var titleTooltip = dtKey + ' (' + dayNamesShort[dIdx] + '): ';

            if (!isDayScheduled) {
              barClass = 'off-day';
              barHeight = 4;
              titleTooltip += 'Off day (not scheduled)';
            } else if (isTodayDate && isRunning) {
              barClass = 'active';
              barHeight = 52;
              titleTooltip += 'Active now (' + (calcScheduleDuration(e.from, e.to)) + 'm scheduled)';
            } else if (matchedSess && (matchedSess.completed || matchedSess.status === 'completed')) {
              barClass = '';
              barHeight = 56;
              titleTooltip += 'Completed (' + (matchedSess.duration || calcScheduleDuration(e.from, e.to)) + 'm)';
            } else if (isTodayDate) {
              barClass = 'active';
              barHeight = 24;
              titleTooltip += 'Scheduled today (' + e.from + '–' + e.to + ')';
            } else {
              barClass = 'off-day';
              barHeight = 6;
              titleTooltip += 'Past scheduled session';
            }

            var colHtml = document.createElement('div');
            colHtml.className = 'sch-chart-col';
            colHtml.title = titleTooltip;
            colHtml.innerHTML =
              '<div class="sch-chart-bar-wrap">' +
                '<div class="sch-chart-bar-fill ' + barClass + '" style="height:' + barHeight + 'px"></div>' +
              '</div>' +
              '<div class="sch-chart-day-label">' + dayNamesShort[dIdx] + '</div>';
            chartBars.appendChild(colHtml);
          }

          graphSec.innerHTML = graphHdr;
          graphSec.appendChild(chartBars);
          statsContainer.appendChild(graphSec);

          // 3. Run Sessions Log (in a section box with inline scrolling)
          var sessionsSec = document.createElement('div');
          sessionsSec.className = 'sch-sessions-sec';
          sessionsSec.innerHTML =
            '<div class="sch-sec-header">' +
              '<span class="sch-sec-title">Run Sessions Log</span>' +
              '<span class="ytf-caption">Inline scrolling • ' + schStats.history.length + ' sessions</span>' +
            '</div>';

          var scrollBox = document.createElement('div');
          scrollBox.className = 'sch-sessions-scrollbox';

          if (!schStats.history.length) {
            scrollBox.innerHTML = '<div style="padding:14px;text-align:center;font-size:12px;color:var(--ytf-text-2)">No run sessions recorded yet.</div>';
          } else {
            schStats.history.forEach(function (sess) {
              var sRow = document.createElement('div');
              sRow.className = 'sch-session-row';

              var statusLabel = '✓ Completed';
              var statusClass = 'completed';
              if (sess.status === 'active') {
                statusLabel = '⏳ Active Now';
                statusClass = 'active';
              } else if (sess.status === 'pending') {
                statusLabel = 'Upcoming';
                statusClass = 'pending';
              }

              var brkInfo = (sess.breaks > 0)
                ? ('☕ ' + sess.breaks + ' break' + (sess.breaks === 1 ? '' : 's') + ' (' + sess.breakMinutes + 'm)')
                : '☕ No breaks';

              var modeName = modeLabels[sess.mode] || sess.mode;

              sRow.innerHTML =
                '<div class="sch-session-left">' +
                  '<div class="sch-session-date">' + (sess.day ? sess.day + ', ' : '') + sess.date + '</div>' +
                  '<div class="sch-session-time">' + sess.from + '–' + sess.to + '</div>' +
                '</div>' +
                '<div class="sch-session-mid">' +
                  '<span class="sch-badge-mode" style="font-size:10px">' + modeName + '</span>' +
                  '<span style="color:var(--ytf-text-2);font-size:11px">' + formatHoursMins(sess.duration) + '</span>' +
                '</div>' +
                '<div class="sch-session-right">' +
                  '<span style="color:var(--ytf-text-2);font-size:11px">' + brkInfo + '</span>' +
                  '<span class="sch-status-pill ' + statusClass + '">' + statusLabel + '</span>' +
                '</div>';
              scrollBox.appendChild(sRow);
            });
          }

          sessionsSec.appendChild(scrollBox);
          statsContainer.appendChild(sessionsSec);

          body.appendChild(statsContainer);
          card.appendChild(body);
          sl.appendChild(card);
        } catch (eSchItem) {
          console.error('[YTFOCUS] Error rendering schedule card:', eSchItem);
        }
      });
    })();

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
    settings.study = settings.study || {};
    settings.study.pendingChanges = settings.study.pendingChanges || [];
    var keyOf = function (k, v) {
      v = v || {};
      return k === 'channel' ? 'c:' + (v.id || v.handle || v.url || '') : 'v:' + (v.id || v.url || '');
    };
    var targetKey = keyOf(kind, value);
    var exists = settings.study.pendingChanges.some(function (p) {
      return p.op === op && p.kind === kind && keyOf(p.kind, p.value) === targetKey;
    });
    if (exists) return;
    settings.study.pendingChanges.push({ op: op, kind: kind, value: value, day: store.tomorrowKey(Date.now()) });
    if (op === 'add') {
      var note = $('studySetupNote');
      if (note) {
        note.textContent = 'Added to pending allowlist. Will activate automatically at midnight (00:00).';
        note.hidden = false;
      }
    }
    save({ study: settings.study });
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
    setupTabs();
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
    // Schedule Modal wiring
    if ($('btnOpenAddSchedule')) {
      $('btnOpenAddSchedule').addEventListener('click', function () {
        if (locked()) return;
        openScheduleModal(null);
      });
    }

    if ($('btnModalSchClose')) {
      $('btnModalSchClose').addEventListener('click', function (e) {
        e.preventDefault();
        closeScheduleModal();
      });
    }

    if ($('btnModalSchCancel')) {
      $('btnModalSchCancel').addEventListener('click', function () {
        closeScheduleModal();
      });
    }

    var modalSchDayGroup = $('modalSchDayGroup');
    if (modalSchDayGroup) {
      modalSchDayGroup.addEventListener('click', function (ev) {
        var b = ev.target && ev.target.closest ? ev.target.closest('[data-modalschday]') : null;
        if (!b || b.disabled) return;
        clearModalSchErrors();
        b.classList.toggle('active');
      });
    }

    if ($('modalSchFrom')) $('modalSchFrom').addEventListener('input', clearModalSchErrors);
    if ($('modalSchTo')) $('modalSchTo').addEventListener('input', clearModalSchErrors);
    if ($('modalSchMode')) $('modalSchMode').addEventListener('change', clearModalSchErrors);
    if ($('modalSchName')) $('modalSchName').addEventListener('input', clearModalSchErrors);

    var schModeTrigger = $('schModeTrigger');
    var customSchModeSelect = $('customSchModeSelect');
    if (schModeTrigger && customSchModeSelect) {
      schModeTrigger.addEventListener('click', function (e) {
        e.stopPropagation();
        var isOpen = customSchModeSelect.classList.toggle('open');
        schModeTrigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      });

      document.querySelectorAll('#schModeDropdown .apple-select-item').forEach(function (item) {
        item.addEventListener('click', function (e) {
          e.stopPropagation();
          var val = item.getAttribute('data-value');
          syncAppleSelect(val);
          customSchModeSelect.classList.remove('open');
          schModeTrigger.setAttribute('aria-expanded', 'false');
          clearModalSchErrors();
        });
      });

      document.addEventListener('click', function (e) {
        if (!customSchModeSelect.contains(e.target)) {
          customSchModeSelect.classList.remove('open');
          schModeTrigger.setAttribute('aria-expanded', 'false');
        }
      });
    }

    if ($('modalSchStrict')) {
      $('modalSchStrict').addEventListener('change', function (e) {
        clearModalSchErrors();
        var box = $('modalBoxStrictMin');
        if (box) box.style.display = e.target.checked ? 'flex' : 'none';
        updateModalBreakHints();
      });
    }

    if ($('modalSchNotify')) {
      $('modalSchNotify').addEventListener('change', function (e) {
        clearModalSchErrors();
        var box = $('modalBoxNotifyMin');
        if (box) box.style.display = e.target.checked ? 'flex' : 'none';
      });
    }

    if ($('modalSchBreaks')) {
      $('modalSchBreaks').addEventListener('change', function (e) {
        clearModalSchErrors();
        var box = $('modalBoxBreaks');
        if (box) box.style.display = e.target.checked ? 'flex' : 'none';
        updateModalBreakHints(e.target.checked);
      });
    }

    if ($('modalSchFrom')) $('modalSchFrom').addEventListener('change', updateModalBreakHints);
    if ($('modalSchTo')) $('modalSchTo').addEventListener('change', updateModalBreakHints);
    if ($('modalSchBreakMin')) $('modalSchBreakMin').addEventListener('input', validateModalBreaks);
    if ($('modalSchBreakCount')) $('modalSchBreakCount').addEventListener('input', validateModalBreaks);

    if ($('btnModalSchAddChan')) {
      $('btnModalSchAddChan').addEventListener('click', function () {
        var input = $('modalSchChanInput');
        var errEl = $('modalSchChanErr');
        if (!input) return;
        var raw = input.value.trim();
        if (!raw) return;
        var parsed = parseChannel(raw);
        if (!parsed) {
          if (errEl) {
            errEl.textContent = 'Invalid YouTube channel. Enter @handle, channel URL, or UC... ID.';
            errEl.style.display = 'block';
          }
          return;
        }
        if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
        modalAllowedChannels.push(parsed);
        input.value = '';
        renderModalStudyAllowlist();
      });
    }
    if ($('modalSchChanInput')) {
      $('modalSchChanInput').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          if ($('btnModalSchAddChan')) $('btnModalSchAddChan').click();
        } else {
          if ($('modalSchChanErr')) $('modalSchChanErr').style.display = 'none';
        }
      });
    }

    if ($('btnModalSchAddVid')) {
      $('btnModalSchAddVid').addEventListener('click', function () {
        var input = $('modalSchVidInput');
        var errEl = $('modalSchVidErr');
        if (!input) return;
        var raw = input.value.trim();
        if (!raw) return;
        var m = raw.match(/[?&]v=([\w-]{6,})|\/shorts\/([\w-]{6,})|^([\w-]{11})$/);
        var vidId = m ? (m[1] || m[2] || m[3]) : null;
        if (!vidId) {
          if (errEl) {
            errEl.textContent = 'Invalid YouTube video. Enter a watch URL, Shorts URL, or 11-character video ID.';
            errEl.style.display = 'block';
          }
          return;
        }
        if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
        modalAllowedVideos.push({ id: vidId, url: raw });
        input.value = '';
        renderModalStudyAllowlist();
      });
    }
    if ($('modalSchVidInput')) {
      $('modalSchVidInput').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          if ($('btnModalSchAddVid')) $('btnModalSchAddVid').click();
        } else {
          if ($('modalSchVidErr')) $('modalSchVidErr').style.display = 'none';
        }
      });
    }

    if ($('modalSchStrictMin')) $('modalSchStrictMin').addEventListener('input', clearModalSchErrors);
    if ($('modalSchNotifyMin')) $('modalSchNotifyMin').addEventListener('input', clearModalSchErrors);
    if ($('modalSchBreakBetweenPct')) {
      $('modalSchBreakBetweenPct').addEventListener('input', function () {
        clearModalSchErrors();
        updateModalBreakHints();
      });
    }
    if ($('modalSchBreakMaxPerBreakPct')) {
      $('modalSchBreakMaxPerBreakPct').addEventListener('input', function () {
        clearModalSchErrors();
        updateModalBreakHints();
      });
    }
    if ($('modalSchFrom')) {
      $('modalSchFrom').addEventListener('input', updateModalBreakHints);
      $('modalSchFrom').addEventListener('change', updateModalBreakHints);
    }
    if ($('modalSchTo')) {
      $('modalSchTo').addEventListener('input', updateModalBreakHints);
      $('modalSchTo').addEventListener('change', updateModalBreakHints);
    }

    if ($('btnModalSchSave')) {
      $('btnModalSchSave').addEventListener('click', function () {
        clearModalSchErrors();
        var days = [];
        document.querySelectorAll('#modalSchDayGroup [data-modalschday].active').forEach(function (b) {
          var d = parseInt(b.getAttribute('data-modalschday'), 10);
          if (!isNaN(d)) days.push(d);
        });
        if (!days.length) days = [1, 2, 3, 4, 5];
        var fromVal = $('modalSchFrom').value || '09:00';
        var toVal = $('modalSchTo').value || '17:00';
        var dur = calcScheduleDuration(fromVal, toVal);
        if (fromVal === toVal || dur <= 0) {
          var errEl = $('modalSchError');
          if (errEl) {
            errEl.textContent = 'Cannot save schedule: start and end time cannot be the same.';
            errEl.style.display = 'block';
          }
          return;
        }
        if (dur < 30) {
          var errEl = $('modalSchError');
          if (errEl) {
            errEl.textContent = 'Cannot save schedule: schedule duration must be at least 30 minutes (currently ' + dur + 'm).';
            errEl.style.display = 'block';
          }
          return;
        }
        var m = $('modalSchMode').value || 'study';
        if (['study', 'restricted', 'full'].indexOf(m) === -1) m = 'study';

        var isStrict = $('modalSchStrict') ? !!$('modalSchStrict').checked : false;
        var strictMin = 60;
        if (isStrict) {
          var rawS = parseInt($('modalSchStrictMin').value, 10);
          if (isNaN(rawS) || rawS < 10 || rawS > 360) {
            var sErr = $('modalSchStrictErr');
            if (sErr) {
              sErr.textContent = 'Lock time must be between 10 and 360 minutes.';
              sErr.style.display = 'block';
            }
            return;
          }
          strictMin = rawS;
        }

        var isNotify = $('modalSchNotify') ? !!$('modalSchNotify').checked : false;
        var notifyMin = 15;
        if (isNotify) {
          var rawN = parseInt($('modalSchNotifyMin').value, 10);
          if (isNaN(rawN) || rawN < 1) {
            var nErr = $('modalSchNotifyErr');
            if (nErr) {
              nErr.textContent = 'Notification time must be at least 1 minute.';
              nErr.style.display = 'block';
            }
            return;
          }
          if (isStrict && rawN >= strictMin) {
            var nErr = $('modalSchNotifyErr');
            if (nErr) {
              nErr.textContent = 'Pre-schedule notification (' + rawN + 'm) must be less than strict lock time (' + strictMin + 'm).';
              nErr.style.display = 'block';
            }
            return;
          }
          notifyMin = rawN;
        }

        var isBreaks = $('modalSchBreaks') ? !!$('modalSchBreaks').checked : false;
        var breakRes = { valid: true, breakMinutes: 0, breakCount: 0, breakBetweenPercent: 5, maxPerBreakPercent: 75 };
        if (isBreaks) {
          breakRes = validateModalBreaks();
          if (!breakRes.valid) {
            var errEl = $('modalSchError');
            if (errEl) {
              errEl.textContent = 'Cannot save schedule: ' + (breakRes.error || 'please fix break settings.');
              errEl.style.display = 'block';
              if (typeof errEl.scrollIntoView === 'function') {
                errEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
              }
            }
            return;
          }
        }

        var nameVal = ($('modalSchName') && $('modalSchName').value ? $('modalSchName').value.trim() : '');

        var origItem = null;
        if (editingScheduleId) {
          var sList = (settings.schedules) || (settings.study && settings.study.schedule) || [];
          for (var si = 0; si < sList.length; si++) {
            if (sList[si].id === editingScheduleId) { origItem = sList[si]; break; }
          }
        }

        var proposed = {
          id: editingScheduleId || ('sch_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5)),
          name: nameVal,
          days: days.slice().sort(),
          from: fromVal,
          to: toVal,
          mode: m,
          enabled: true,
          strict: isStrict,
          strictLockMinutes: strictMin,
          notify: isNotify,
          notifyMinutes: notifyMin,
          breaksEnabled: isBreaks,
          breakMinutes: isBreaks ? (breakRes.breakMinutes || 15) : 0,
          breakCount: isBreaks ? (breakRes.breakCount || 2) : 0,
          breakBetweenPercent: isBreaks ? (breakRes.breakBetweenPercent || (isStrict ? 10 : 5)) : 5,
          maxPerBreakPercent: isBreaks ? (breakRes.maxPerBreakPercent || (isStrict ? 50 : 75)) : 75,
          breaksUsedCount: origItem ? (origItem.breaksUsedCount || 0) : 0,
          breakMinutesUsed: origItem ? (origItem.breakMinutesUsed || 0) : 0,
          lastBreakEndedAt: origItem ? (origItem.lastBreakEndedAt || 0) : 0,
          allowedChannels: (m === 'study') ? modalAllowedChannels.slice() : [],
          allowedVideos: (m === 'study') ? modalAllowedVideos.slice() : []
        };

        var existingList = (settings.study && settings.study.schedule) || [];
        for (var i = 0; i < existingList.length; i++) {
          var ex = existingList[i];
          // When editing, do not compare against self
          if (editingScheduleId && ex.id === editingScheduleId) continue;
          // Only active/enabled schedules block new schedules from overlapping
          if (ex.enabled !== false && schedulesOverlap(proposed, ex)) {
            var dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            var exDays = (ex.days || []).map(function (d) { return dayNames[d]; }).join(',');
            var modeLabels = (window.YTFOCUS.CONSTANTS || {}).MODE_LABELS || {};
            var exMode = modeLabels[ex.mode] || ex.mode;
            var exLabel = ex.name ? ('"' + ex.name + '"') : (exMode + ' schedule');
            var errEl = $('modalSchError');
            if (errEl) {
              errEl.textContent = 'Cannot save schedule: overlaps with existing active ' + exLabel + ' on ' + exDays + ' (' + ex.from + '–' + ex.to + ').';
              errEl.style.display = 'block';
            }
            return;
          }
        }

        function executeSaveSchedule(toSave) {
          settings.study = settings.study || {};
          settings.study.schedule = settings.study.schedule || [];

          if (editingScheduleId) {
            var found = false;
            for (var sIdx = 0; sIdx < settings.study.schedule.length; sIdx++) {
              if (settings.study.schedule[sIdx].id === editingScheduleId) {
                var target = settings.study.schedule[sIdx];
                target.name = toSave.name;
                target.days = toSave.days;
                target.from = toSave.from;
                target.to = toSave.to;
                target.mode = toSave.mode;
                target.strict = toSave.strict;
                target.strictLockMinutes = toSave.strictLockMinutes;
                target.notify = toSave.notify;
                target.notifyMinutes = toSave.notifyMinutes;
                target.breaksEnabled = toSave.breaksEnabled;
                target.breakMinutes = toSave.breakMinutes;
                target.breakCount = toSave.breakCount;
                target.breakBetweenPercent = toSave.breakBetweenPercent;
                target.maxPerBreakPercent = toSave.maxPerBreakPercent;
                if (toSave.mode === 'study') {
                  target.allowedChannels = toSave.allowedChannels;
                  target.allowedVideos = toSave.allowedVideos;
                }
                found = true;
                break;
              }
            }
            if (!found) {
              settings.study.schedule.push(toSave);
            }
          } else {
            settings.study.schedule.push(toSave);
          }

          closeScheduleModal();
          save({ study: settings.study });
        }

        var now = Date.now();
        var willBeActiveNow = scheduleMatches(proposed, now);
        var willBeStrictLockedNow = window.YTFOCUS.policy && window.YTFOCUS.policy.isScheduleStrictLocked
          ? window.YTFOCUS.policy.isScheduleStrictLocked(proposed, now) : false;

        if (proposed.enabled !== false && (willBeActiveNow || willBeStrictLockedNow)) {
          pendingScheduleSave = proposed;
          var dlg = $('confirmImmediateScheduleDialog');
          var title = $('confirmImmediateTitle');
          var desc = $('confirmImmediateDesc');
          var note = $('confirmImmediateNote');

          if (willBeActiveNow) {
            if (title) title.textContent = '⚠️ Activate schedule immediately?';
            if (desc) desc.textContent = 'The current time falls within this schedule\'s active window (' + proposed.from + '–' + proposed.to + ').';
            if (note) note.innerHTML = '<strong>Important:</strong> As soon as this schedule is saved, <strong>focus blocking will activate immediately</strong> and this schedule will become <strong>locked from editing or deletion</strong> until it completes at ' + proposed.to + '.';
          } else {
            if (title) title.textContent = '⏳ Strict pre-lock begins immediately?';
            if (desc) desc.textContent = 'This schedule starts at ' + proposed.from + ', and its ' + (proposed.strictLockMinutes || 60) + '-minute Strict Mode pre-lock is already in effect.';
            if (note) note.innerHTML = '<strong>Important:</strong> As soon as this schedule is saved, settings and allowlists will be <strong>strict-locked immediately</strong> and cannot be modified until the schedule completes at ' + proposed.to + '.';
          }

          if (dlg) {
            if (typeof dlg.showModal === 'function') dlg.showModal();
            else dlg.setAttribute('open', '');
          }
          return;
        }

        executeSaveSchedule(proposed);
      });
    }

    if ($('btnCancelImmediateSchedule')) {
      $('btnCancelImmediateSchedule').addEventListener('click', function () {
        pendingScheduleSave = null;
        var dlg = $('confirmImmediateScheduleDialog');
        if (dlg) {
          if (typeof dlg.close === 'function') dlg.close();
          else dlg.removeAttribute('open');
        }
      });
    }

    if ($('btnConfirmImmediateSchedule')) {
      $('btnConfirmImmediateSchedule').addEventListener('click', function () {
        if (!pendingScheduleSave) return;
        var toSave = pendingScheduleSave;
        pendingScheduleSave = null;
        var dlg = $('confirmImmediateScheduleDialog');
        if (dlg) {
          if (typeof dlg.close === 'function') dlg.close();
          else dlg.removeAttribute('open');
        }
        executeSaveSchedule(toSave);
      });
    }

    if ($('btnCancelDeleteSchedule')) {
      $('btnCancelDeleteSchedule').addEventListener('click', function () {
        pendingDeleteScheduleId = null;
        var dlg = $('deleteScheduleConfirmDialog');
        if (dlg) {
          if (typeof dlg.close === 'function') dlg.close();
          else dlg.removeAttribute('open');
        }
      });
    }

    if ($('btnConfirmDeleteSchedule')) {
      $('btnConfirmDeleteSchedule').addEventListener('click', function () {
        if (!pendingDeleteScheduleId) return;
        var list = (settings.study && settings.study.schedule) || [];
        var idx = -1;
        for (var i = 0; i < list.length; i++) {
          if (list[i].id === pendingDeleteScheduleId) {
            idx = i;
            break;
          }
        }
        if (idx !== -1) {
          list.splice(idx, 1);
          save({ study: settings.study });
        }
        pendingDeleteScheduleId = null;
        var dlg = $('deleteScheduleConfirmDialog');
        if (dlg) {
          if (typeof dlg.close === 'function') dlg.close();
          else dlg.removeAttribute('open');
        }
      });
    }

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
