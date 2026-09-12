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
