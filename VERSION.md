# YouTube Focus — Versioning

## Rules (always follow)

Version format: `MAJOR.MINOR.PATCH` (e.g. `2.1.0`).

| Change | Bump |
|---|---|
| Bug fix or little change (typo, copy, small selector fix, single-behavior correction) | **PATCH** (last digit): `2.1.0` → `2.1.1` |
| Major issue fixed, feature added, or significant behavior change | **MINOR** (middle digit): `2.1.x` → `2.2.0` (patch resets to `0`) |
| Patch digit reaches `9` | roll into next **MINOR**: `2.1.9` → `2.2.0` (never `2.1.10`) |
| Significant change (architecture rewrite, new product scope, store release generation) | **MAJOR** (first digit): `2.x.x` → `3.0.0` (minor + patch reset to `0`) |

Additional rules:
- Bump the version in `manifest.json` in the **same change** as the fix/feature — never batch it later.
- Add a row to the Changelog below with every bump. One line per release: what changed and why.
- Never go backwards. Never skip the log entry.
- Test suites live outside the repo (`C:\Users\ar54c\AppData\Local\Temp\opencode\`); note the unit counts in the changelog row when they change.

## Changelog

| Version | Date | Changes | Tests |
|---|---|---|---|
| 3.2.0 | 2026-09-15 | Soft black modal inputs; custom Apple-style dropdown for schedule mode with checkmarks and floating blur panel; fixed card section spacing on Focus & Limits tab (.ytf-tab-pane flex column gap: 16px); added immediate-activation confirmation warning dialog when schedule overlaps current time; added delete schedule confirmation dialog. | JS syntax checks; scratch validation passed; policy 136/136 |
| 3.1.0 | 2026-09-15 | Redesigned schedule creation and editing into a popup modal dialog (#scheduleModal); fixed crowded/touching buttons on schedule cards with spacious flex-start header, distinct button borders, 10px gap, dedicated schedule time & badges row, and new 'Edit' action. | JS syntax checks; node test_v3_schedules 6/6 passed; policy 136/136 |
| 3.0.0 | 2026-09-15 | Major release: Dedicated Schedules tab in Settings; per-schedule independent channel and video allowlists (editable instantly with zero midnight delays when idle; locked when blocking); per-schedule active/inactive toggle; configurable Strict Mode (10–360 min pre-lock); configurable pre-schedule notification (< strict lock mins); 5-second dismissible center notification popup on YouTube; inline validation errors and live UI feedback. | JS syntax checks; test_v3_schedules 6/6 passed; policy 136/136; recs 4/4 |
| 2.9.7 | 2026-09-15 | Fixed pending allowlist changes applying immediately instead of at midnight due to todayKey vs tomorrowKey stamping in stagePending. | JS syntax checks; node VM test passed |
| 2.9.6 | 2026-09-15 | Study Mode allowlist additions during active blocks now display with inline pending badges and instant setup note; versioning synced across manifest, docs, and update manifests. | JS syntax checks; node VM test passed |
| 2.9.5 | 2026-09-15 | Added instant visual feedback for Study Mode channel/video removals with inline 'Removal pending (at midnight)' status badge and immediate Cancel option. | JS syntax checks; node VM test passed |
| 2.9.4 | 2026-09-15 | Fixed stagePending scope ReferenceError in options controller preventing allowlist removals from executing. | JS syntax checks; node VM test passed |
| 2.9.3 | 2026-09-15 | Fixed scheduleMatches ReferenceError in options controller that caused schedule list to appear completely blank; corrected overnight schedule day rollover math across midnight. | JS syntax checks; overnight test passed |
| 2.9.2 | 2026-09-14 | Fixed background audio and video playback leak behind blocked and session overlay screens by enforcing capture listeners on play/playing/timeupdate and media muting. | JS syntax checks; browser verification |
| 2.9.1 | 2026-09-13 | Updated Brave enterprise policy target registry keys to support Brave and Brave-Browser paths. | PowerShell registry check |
| 2.9.0 | 2026-09-13 | 30-minute Strict Mode unlock cooldown & 5-minute Master Blocking cooldown with live countdown and cancel; direct '📚 Switch to Study Mode' action on Full Block and Restricted block screen overlays and popup; exact alarm wakeups and storage protections. | JS syntax checks; test_policy_suite passed (all 8 sections); recs 4/4 |
| 2.8.0 | 2026-09-13 | Settings polish, schedule mode transition rules, dynamic limit controls & 3-layer reset: allowed mode switching during active schedules follows transition matrix; locked daily quota editing during active blocking with 1-1440 range validation; active schedule deletion blocked and inactive schedules queued for midnight deletion with status badges; Apple-style dropdowns; max 4 session choices; conditional First Short toggle; dynamic dropdowns and sliders for Shorts, Videos, and Watch limits with Study allowlist immunity; extra-time semantics inverted to 'Allow extra time after daily limit' with max 4 choices; Appearance section removed; clean Analytics empty state; 3-layer destructive reset modal with 'RESET' confirmation. | JS syntax checks; test_policy_suite passed; recs 4/4 |
| 2.7.0 | 2026-09-13 | Schedule auto-activation & lock (Workaround A): automatic schedules now engage blocking in their configured mode even if Master Blocking was off; Master switch is locked and disabled during active schedule windows (popup and settings); inline schedule conflict validation rejects overlapping day and time ranges with an error message. | JS syntax checks; policy 136/136; mute 5/5; recs 4/4 |
| 2.6.1 | 2026-09-13 | Corrected project handoff and user guide for the compact popup, minutes-only time choices, draining cooldown shade, button-free content cards, and Settings-only Study timer. | Documentation-only update |
| 2.6.0 | 2026-09-13 | Removed all generic navigation buttons from YouTube-page cards. Time-decision cards now use a two-column, minutes-only choice grid and a draining visual cooldown overlay. Reduced the extension popup to Focus status, Blocking, mode, the current time decision, and Settings; Study selection now routes unconfigured users to setup. | JS syntax checks; policy 134/134; mute 5/5; recs 4/4. External storage harness remains blocked by its pre-existing duplicate `const T` syntax error. |
| 2.5.0 | 2026-09-13 | Simplified YouTube-page cards: removed false-close and duplicate actions, motivational filler, live stats, and Study intent shortcuts; every non-time card now offers one verified safe destination; session and extra-time choices appear directly only when a time decision is required; allowed Study content is collapsed behind one disclosure. | JS syntax checks; policy 134/134; mute 5/5; recs 4/4. External storage harness remains blocked by its pre-existing duplicate `const T` syntax error. |
| 2.4.0 | 2026-09-13 | First-run UX release: new installs open an accessible setup dialog; guided daily-limit, Study, and Full Block starting plans; visible mode explanations and Help in Settings/popup; Study now accepts its first approved item immediately when terminal block is inactive; Extra-time limit terminology replaces confusing emergency-pause language; visible keyboard focus and skip link added. | JS syntax checks; policy 134/134; mute 5/5; recs 4/4. External storage harness currently has a pre-existing duplicate `const T` syntax error. |
| 2.3.2 | 2026-09-12 | Settings UX polish (no behavior change): Start-here one-liner; Schedule moved after Focus; Shorts/Search/Feeds subgroups collapsible with live status summaries; Analytics empty state condensed to one line; copy cleanup. | policy 134/134, storage 0 FAIL, mute 5/5, recs 4/4; Brave headless OPTQA 26/26 |
| 2.3.1 | 2026-09-12 | Settings IA refactor (no behavior change): guided order Focus → Sessions → Reminders → Content controls → Study → Video & watch limits → Emergency → Schedule → Strict → Appearance → Analytics; Content controls grouped (Shorts/Search/Feeds); mode-owned rows step aside with per-group managed-by summaries; Appearance collapsed into disclosure; Analytics+Today merged into one summary (streak duplication removed); compact chart empty state; prominent daily-allowance status in Focus; trimmed repeated explanations. | policy 134/134, storage 0 FAIL, mute 5/5, recs 4/4; Brave headless OPTQA 19/19 |
| 1.0.0 | 2026-09-10 | Initial development baseline. All iteration before versioning discipline shipped under this number; no granular history was kept. | — |

## How to load (unpackaged, for personal use)

1. Open `chrome://extensions` (Chrome) or `brave://extensions` (Brave).
2. Enable **Developer mode** (top-right).
3. **Load unpacked** → select the `D:\youtube-focus` folder.
4. After any code change: hit the reload icon on the extension card, then refresh YouTube tabs (settings changes apply instantly, no reload needed).
