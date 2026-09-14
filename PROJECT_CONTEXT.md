# PROJECT_CONTEXT.md — YouTube Focus handoff (v2.9.6)

> Read this first, then inspect the referenced source files before modifying anything.
> Code is the ultimate source of truth. Certainty labels: **CODE** = read in current
> source · **UNIT** = automated unit test · **BROWSER** = browser automation ·
> **MANUAL** = verified by hand · **DOC** = documentation only · **NOT VERIFIED** =
> unknown. D:\youtube-focus has no git repo and no build step; source loads directly.

## Quick Project Summary

- **Project:** YouTube Focus ("YT Focus") — personal-use Chrome/Brave MV3 extension.
- **Purpose:** daily active-time quota for YouTube spent through per-visit sessions,
  with emergency allowance, terminal Full Block, Normal/Restricted/Study/Full modes,
  Shorts controls, Study allowlist, schedules, Strict lock with 30-min unlock cooldown,
  5-min unblocking cooldown, direct Study Mode escape hatch, local analytics/streaks.
- **Version:** 2.9.6 (`manifest.json:5`; `VERSION.md` head row matches) — CODE.
- **Platform:** MV3, permissions `storage` + `alarms` only, host `*.youtube.com`.
  No backend/accounts; no network calls in `src/` (grep fetch/XHR/Beacon: zero).
- **Architecture:** pure policy engine decides; single orchestrator enforces via CSS
  + Shadow DOM overlay; shared store; standalone service worker; popup + options UI.
- **Status:** personal-use dogfooding baseline (see Verification baseline).
- **Model:** quota → session ceiling → reminders → emergency pool+uses → terminal
  Full Block → local midnight. Study bypasses quota entirely.
- **Code:** `D:\youtube-focus\src/` (content, shared, popup, options, background).
  Tests/QA live **outside** the repo (temp dir — back up before relying on it).
- **Caveats:** terminal latch needs an open tab; video/Shorts counters miss full
  reloads; headless logged-out QA only; harnesses live in a temp dir that can vanish.

## Source-of-truth matrix

| Area | Source of truth | Tests | Browser | Notes |
|---|---|---|---|---|
| Daily quota | `storage.js:147` `usageRemainingMs`; `index.js:552` heartbeat | UNIT math+gate | QB61 H, smoke | 15 s ticks, visible+active only; input locked during active blocking |
| Sessions | `index.js:660` `maybeOfferSession`; grant handler | UNIT grant math | QB61 A/FB, smoke | per-doc visit; snooze gate; max 4 configured choices |
| Cooldown | `popup.js:33`; `blocked-screen.js:448` | — | QB61 H | 3 s/7 s + draining shade on locked minute choices |
| Reminders | `storage.js:191`; toast `blocked-screen.js:678` | UNIT due-logic | QB61 single-50 toast | 4.5 s, once/day/checkpoint |
| Emergency / Extra time | `storage.js:172-272`; Gate 3.5; grant path | UNIT; policy | QB61 H uses:1/pool:3 | Inverted semantics: switch allows extra time; when off, quota exhaustion latches terminal block immediately |
| Terminal | `policy-engine.js:237` Gate 0; `index.js:604` latch | UNIT ×7 | QB61 T set ×7 | open tab needed; allowlist opens |
| Restricted | Gate 5; `index.js:719` + reconcile | UNIT | QB61 E real-click | press capture, lazy page-match |
| Study | Gate 4; `storage.js:469` pending | UNIT | QB61 F/J video allowlist | channel/video allowlist immune to quota, limits, and block-all caps |
| Shorts | Gate 2 `policy.js:281`; counters `index.js:61-110` | UNIT cap vectors | QB61 S seen 0→1→2 | dropdown (no cap, block all, slider 1-500); First Short conditionally hidden |
| Master/Strict | `policy.js:98-103`; `storage.js:369` filter | UNIT | QB61 I/K | OFF = normal except indie Shorts; auto-activates & locks on schedule; 5m unblock & 30m strict unlock cooldown with cancel |
| Schedules | `policy.js:35-79`; SW `:30-75`; `options.js` | UNIT ×5 | QB61 SCH live | transition matrix allows jumping during schedule; active cannot be deleted; inactive queues for midnight removal |
| Midnight/streaks | SW `:76` rollover, `:166` streak | UNIT streak math | NOT VERIFIED live | local timezone throughout; purges pendingRemoval schedules |
| Popup/options/overlay | `src/popup`, `src/options`, `src/content/overlay` | UNIT | OPTQA 26/26, smoke | 3-layer reset safety; Switch to Study Mode button on cards + popup; live cooldown timers |
| Analytics | `options.js` renderAnalytics | — | OPTQA values | clean empty state when no activity or history |

## Architecture (CODE — manifest + module reads)

`manifest.json`: MV3, `storage`+`alarms`, `*.youtube.com` hosts, 13 content scripts
in fixed order (constants→storage→detector→policy→shadow-styles→blocked-screen→
shorts/feed/recs→study→router→observer→index), `document_idle`, top-frame only;
popup `src/popup/popup.html`, options page, fonts-only web-accessible resources.

- `policy-engine.js` — PURE `evaluateContext(ctx, settings)`: Gate 0 terminal
  (absolute; exceptions + allowlist open) → 0b snooze → 1 exceptions → 1.5
  master-off → 2 session limits → 3 full → 3.5 quota → 4 study → 5 restricted →
  6 normal. Exports `effectiveMode` (full > manual-study > scheduled > stored),
  `scheduledMode`, `governance`, allowlist matchers. Zero chrome.* calls.
- `index.js` — the ONLY side-effect file. `init` → `getSettings` → `execute(url)`,
  retriggered by router.onNavigate (250 ms), domObserver (500 ms throttle), 60 s
  interval, `storage.onChanged` (100 ms), 15 s heartbeat, 5 s watch timer.
  Owns: per-document `askedSession`/`offerUrl`/provenance, offer guard
  (`_offerStillValid` + same-page check), `ytf:grant` handler (terminal-refusing),
  accrual, latch, toasts, wipe-refetch on Reset.
- `youtube-detector.js` — route/videoId (absolute + relative hrefs)/channel refs.
  Pure. `getVideoId` falls back to `location` base for relative hrefs.
- `shorts/feed/recommendation-blocker.js` — CSS hiding + video mute/pause only.
- `study-mode.js` — channel resolve, search-result filtering. `router.js` —
  history patch + popstate/hashchange/yt-navigate-finish. `observer.js` — observer.
- `overlay/blocked-screen.js` — Shadow DOM wall (`#yt-focus-host`) / inline card
  (`#yt-focus-inline-host`) / toast; EMITS `ytf:grant/navigate`, never
  decides policy. Tracks `currentScreen` for the offer guard.
- `shared/storage.js` — `getSettings` (defaults + 4 migrations), all quota/session/
  emergency/reminder/streak/strict/pending math; `window.YTFOCUS.store`.
- `background/service-worker.js` — standalone, no imports: 1-min tick (expiry,
  streak finalize, midnight rollover), snooze-end alarm, badge
  (OFF/FULL/STU/RES), onInstalled/onStartup.
- popup = compact daily control surface: quota/status, Blocking, mode, the
  current session or Extra-time decision, and Settings. Options = single
  untabbed page, full reload+render on any storage change; Strict disables all
  inputs except itself.

## Product model (CODE unless noted)

- **Daily quota** — `dailyQuota.minutes` (default 60, `constants.js`). Remaining =
  `max(0, quota − usedToday)` (`storage.js:147`). Applies to Normal/Restricted
  only. Accrual (`index.js:552`): every 15 s +15000 ms iff visible tab AND
  (video playing OR interaction < 2 min: click/keydown/wheel/touchmove/scroll —
  `mousemove` NOT tracked) AND master on AND not terminal AND mode normal/
  restricted AND no card showing. Stored `usage.{activeMsToday,activeDay,
  sessionsToday}`; blind whole-object writes (multi-tab: last-writer-wins,
  fail-open). BROWSER: accrual observed headless.
- **Watch metrics (separate)** — `sessionLimits.watchMsToday` (+5 s/5 s tick,
  watch route + actually playing, `index.js:605-620`, NO visibility check),
  `videosWatched` (distinct IDs, same-doc + persisted cross-reload),
  `shortsSeen`. Caps `videosMax` (0 = block all), `watchMinutes` (0 = off),
  `shortsMax` (0 = block all, null = unlimited). Study *video*-allowlisted
  bypasses all three gates (channel-only allowlist does not).
- **Sessions** — entry offer `How long do you want to use YouTube?`
  (`index.js:660`) when: master on, no terminal, mode normal/restricted,
  remaining > 0, no active grant; once per document (`askedSession`); entry
  Shorts exempt. Choices = % of quota with computed minutes; grant =
  `min(option, remaining)` floored to 0.1 (`storage.js:172`); fallback
  `Use remaining X` pill when all floor to 0 (only reachable with tiny quotas).
  Grant sets `snoozeUntil` (Gate 0b allow) + `sessionsToday+1`; unused allowance
  never consumed (accrual-only). Expiry tick re-offers `session-expired`.
  BROWSER: offer/grant/cleared/fallback(0.5 min) all green.
- **Cooldown** — wait-to-click: first two minute choices 3 s, rest 7 s; the
  per-card anchor survives re-renders (`blocked-screen.js:448-499`), while the
  popup mirrors from open time (`popup.js:33`). A dark shade drains across each
  locked choice; labels stay minutes-only. Console-dispatched `ytf:grant`
  bypasses it (P2, self-bypass class).
- **Reminders** — `%` checkpoints of cumulative usage (`storage.js:184-197`,
  `>=` inclusive, fired recorded per day); single consolidated toast = highest
  crossed (`index.js` tick); 4.5 s non-blocking (`blocked-screen.js:678`).
  BROWSER: one `50%` toast for a double crossing. Never touches quota/session.
- **Emergency** — pool = `totalPercent × original quota` (`storage.js:226`);
  options = % of original quota (100% allowed, pool-capped at render AND grant);
  grant = min(option, pool-left), requires a use left (`storage.js:177-181`);
  cost = minutes + 1 use, no use refunds, minute refunds on early end
  (`cancelSnoozePatch`, `storage.js:446`). Ends on pool-out OR uses-out.
  Loosening stages for tomorrow (`splitEmergencyUpdate`, `storage.js:291`).
  BROWSER: 5% → uses:1 pool:3; pool-capped `100% · 30 min` labels.
- **Terminal Full Block** — latch (`index.js:618`): master on, mode
  normal/restricted, remaining ≤ 0, emergency enabled+capped+spent → persists to
  local midnight. **Must have an open tab ticking — service worker does NOT
  latch** (comment claiming a backstop is wrong). Gate 0: exceptions
  (Watch Later/Studio) + allowlisted video (any route) + allowlisted channel
  (watch/channel) open; everything else `terminal-block` wall. Grants refused,
  no pills offered, quota/mode/reload cannot unlock (BROWSER T-set ×7). Clears
  at midnight (SW). Manual full = mode switch, consumes nothing, exits by mode.
- **Allowlist/midnight** — channels: exact id → case-insensitive handle → URL;
  videos: exact id or URL-contains-id (`policy-engine.js:63-82`). The first
  allowlist item is active immediately only while terminal Full Block is
  inactive, so new users can begin Study Mode; every later edit stages to
  `pendingChanges` for local midnight (`applyPendingStudy`, `storage.js:469`;
  also execute/heartbeat/SW paths). Under Strict, staging UI is locked entirely.

## Modes, Shorts, master, precedence, timer, schedules, Strict (CODE)

- **Normal** — user toggles (feeds/recs/autoplay/search) + quota + sessions.
  BROWSER: feed block, shorts on/off, watch strip.
- **Restricted** — feeds/shorts mode-owned; watch needs same-tab search
  provenance (`provenanceOk`: exact videoId equality). Provenance: recorded on
  press+click capture on search pages, reconciled lazily against the current
  page in `execute` (intermediate YT navigations made event-time clearing
  racy — do not move it back). New tabs start empty → direct/history/channel/
  playlist/Google/recommendation opens block. **Entry Short always allowed,
  independent of the allowFirstShort preference.** BROWSER: real-click allow +
  direct-URL block.
- **Study** — no quota/sessions/emergency consumption. Gate 4: unlisted
  channel+video → block; allowed + Block Shorts ON → block; OFF → allow-first
  (entry plays, next blocks, back-to-entry plays); unknown channel →
  strip-then-retry (6×1.2 s) then safe-block. Search filtered to allowlist
  (`filterSearch`, best-effort text/handle, hides only video renderers).
  `strict-allowlist` search policy enforces the same filter in ANY mode
  (Gate 5/6 `search-allowlist` modify). BROWSER: video allowlist allow/block;
  channel matching + Study Shorts = code-only.
- **Full** — Gate 3 blocks all but exceptions. BROWSER: wall + Watch-Later open.
- **Shorts matrix** — Normal: independent toggle + allow-first + cap. Entry =
  first short seen from a non-shorts page (per document; reload = new entry).
  Entry is exempt from the count cap (cap 0 still blocks all); returns to entry
  don't increment; cross-reload counting via persisted day-stamped
  `lastShortsId/lastWatchId` (`sessionLimits`, max-merged). BROWSER: seen 0→1
  (block) → back-A free → reload no-double → new short counts.
- **Master** — OFF = fully normal except independent Shorts player-only block
  (Gate 1.5). Auto-activates into configured mode during scheduled windows, and
  locks ON during active schedules (Workaround A). BROWSER.
- **Precedence** (verified `policy-engine.js:54-61`, SW mirror `:45-60`):
  terminal > explicit full > manual study timer > scheduled (any mode) >
  stored mode. SW copy is badge/tick-only and equivalent.
- **Study timer** — 25/50/90 from Options; sets manualUntil + mode=study,
  records prevMode (explicit study picks clear it); SW expiry + manual End
  restore via one-shot `restoreStudyPrevMode` (`storage.js:512`). E2E BROWSER
  (restore to normal). Manual End under Strict can't write (filter drops it;
  SW expiry still restores) — accepted edge.
- **Schedules** — `{days[0-6],from,to,mode}` any of 4 modes; Mon–Fri default
  picker; overnight support; 1-min SW tick + 60 s tab re-eval. Auto-activates
  blocking into scheduled mode, locks master switch during window, rejects
  overlapping day/time ranges inline. BROWSER: live activation without reload.
  Schedule *edits* under Strict are dropped.
- **Strict** — UI locks all inputs except Strict toggle (+Reset with confirm);
  every handler reverts; `filterStrictPatch` drops all but
  `strictMode`/`stats`/clearing-`snoozeUntil`. Spending (grants) intentionally
  allowed. BROWSER: master toggle revert. Extension disable/uninstall is
  unstoppable (stated in UI).

## Settings UI, overlay, analytics (CODE + BROWSER OPTQA 26/26)

Order: Start here (one-liner) → Focus (master, quota, mode, live `focusStatus`
`X / Q min today · R remaining`) → Schedule → Sessions → Reminders → Content
controls (Shorts/Search/Feeds subgroups, collapsed `<details>` with live
summaries from real settings: `Blocked · First Short allowed`, policy label,
`N of 8 hidden (+M managed)`) → Study → Video & watch limits → Emergency →
Strict → Appearance (collapsed) → Analytics (merged Today: usage line, streaks,
`Blocked today` counts, usage-vs-quota chart with one-line empty state,
14-day history) → Advanced (Reset). Untabbed by design — do not add tabs.
Mode-owned rows get `gov-owned` (CSS display:none) + per-group
`N settings managed by X` lines; values preserved, rows return on mode switch
(BROWSER: Full hides 10, Restricted 3). Strict shows rows locked instead.
Time-related cards expose a compact `Details` expander with real numbers
(BROWSER-verified `60 / 60 min used. Extra time: 0 / 30 min used, 3 starts
left. Next reset: 12:00 AM.`). Content cards are intentionally button-free;
session and extra-time cards show only aligned minute choices, with a visual
cooldown shade. Overlay = Shadow DOM wall/inline/toast; policy never runs inside it.
`userguide.md` mirrors this model (checked against code).

## Tests and QA — what exists NOW (verified this session)

- `C:\...\opencode\policy-test.cjs` (node, eval-loads repo source):
  `node policy-test.cjs` → **136 passed, 0 failed** (today). Covers all gates,
  schedule auto-activation, schedule lock, terminal precedence, caps, provenance,
  schedules, strict-allowlist.
- `storage-test.cjs` (173 lines, stubbed chrome.storage): **0 FAIL** (today).
  Migrations M1–M4, emergency/quota/reminder/streak math, merge last-IDs.
- `mute-test.cjs` → **5/5**; `recs-test.cjs` → **4/4** (today).
- `cdp.ps1` (CDP connect/nav/eval/close) + `qb60.ps1` (137-line suite),
  `qb61a/b`, `optqa.ps1`, `handoff-smoke.ps1`. Run:
  `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File <script>`.
- BROWSER history (same code for content/policy/storage/SW/popup — still valid):
  QB61a 36/36 (+ST 2/2), QB61b 41/41, OPTQA 19/19 then 26/26. Today: handoff
  smoke 5/5 (offer→grant→restricted block, zero page exceptions, Brave
  headless, logged-out, live youtube.com, `--load-extension`, ext id
  `jjdfahkmmiiomhhkiebcffjkbndbigej`).
- WARNING: `qb51–qb60` results were never saved to JSON (conversation output
  only); temp dir (33+ `cdp-brave*` profiles, `ff-*`, old logs) can vanish.
- Limits (evidenced): headless only; logged-out only; no real playback/scroll;
  branded-Chrome CLI rejects `--load-extension` (use Brave/headed manual load);
  synthetic pushState to YT URLs causes reloads (suite uses replaceState+churn
  and real clicks instead).

## Known issues / risks (classified now)

- **Confirmed, accepted:** no SW terminal-latch backstop (needs open tab);
  counters miss full-reload navs only for *first-sight* (by design: reload =
  new entry); toast shows only highest crossed checkpoint; console-dispatched
  grants bypass cooldown (self-bypass); multi-tab accrual races fail-open;
  End-session restore under Strict waits for SW expiry.
- **Resolved:** terminal bypass, back-to-A cap, reload counters, reset fail-open,
  stale search marks, `sl` alias shadowing in old QA (harness-only).
- **NOT VERIFIED live:** midnight tick, schedule clock edges beyond one case,
  channel-allowlist matching, Study Shorts playback, reminder toast timing past
  one case, hide-effect pixels, videosMax/watchMinutes enforcement, logged-in.

## Version, decisions, working guide

- 2.7.0; `VERSION.md` rules: bump `manifest.json` + changelog row in the SAME
  change (PATCH = behavior-preserving, MINOR = fixes/features). Dogfood
  baseline, not frozen.
- Historical decisions (regression guards): Shadow DOM isolation; untabbed
  single-page settings; quota-first; sessions as ceilings; separate emergency
  pool (% of original quota, capped display); midnight pending allowlist;
  terminal absolute precedence; lazy (not event-time) provenance clearing;
  usage-vs-watch separation; condensed (never misleadingly editable)
  mode-owned UI; no backend/cloud/accounts — keep it that way.
- **Do not break:** snooze never bypasses terminal; entry-short exemption (cap 0
  excepted); reload = new entry but counters persist; Reset must refetch (never
  merge `undefined`); `filterStrictPatch` allowlist is exhaustive by default-deny;
  SW stays import-free (no `window`); content `index.js` stays the only
  side-effect file; overlay never decides policy.
- **Workflow:** 1) read this file, 2) inspect referenced source before touching,
  3) preserve semantics unless asked, 4) run unit suites before/after
  (`node policy-test.cjs` etc.), 5) verify live on Brave headless where the
  change touches behavior, 6) bump version + changelog + userguide deltas in the
  same change, 7) never add frameworks/permissions/DNR/complexity for personal-
  use scope. When ambiguous, report — don't invent.
