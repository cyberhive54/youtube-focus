# YouTube Focus — User Guide

YouTube Focus gives you a daily YouTube budget and makes you spend it on purpose: every visit starts with a choice, and when the day's time is gone, your Extra-time limit decides whether more time is available.

## Getting started

On first install, YouTube Focus opens a short setup screen. Choose one plan:

- **Use a daily limit**: starts Normal mode with a 60-minute daily budget and the default distraction controls.
- **Study only**: add one allowed channel, then start Study Mode immediately.
- **Block YouTube**: starts Full Block; only Watch Later and YouTube Studio stay available.

You can also click the extension icon any time. (If you don't see it, open the puzzle-piece menu and pin YouTube Focus.) The popup is deliberately compact: it shows your time, Blocking switch, mode, current session or Extra-time choice, and Settings. Use Settings → **How it works** for the guide.

## Your daily limit and sessions

**Daily YouTube limit** (Settings → Focus) is how much *active* YouTube time you get per day. Watching, searching and browsing count; background tabs and idle time don't.

When you open YouTube, it asks **"How long do you want to use YouTube?"** Choose an exact number of minutes. Session lengths are configured as shares of your daily limit in Settings, but YouTube and the popup show minutes only. A session never grants more time than you have left. While a session runs, YouTube is fully normal. When the time is up, videos pause and the choice appears again — even if you were only browsing or searching. **End session early** (popup) stops it and spends only what you used.

- Session choices are configurable under Settings → Sessions (tap to toggle, up to 4 active choices). Removing a length applies now; adding one applies tomorrow.
- Choices unlock a few seconds after the card appears (first two after 3 seconds; the rest after 7). A dark shade drains from each locked minute choice, then it becomes available.
- Each started session is counted (visible under Settings → Analytics).
- If your remaining time is smaller than every choice, a “Use remaining …” pill offers the exact remainder instead.
- The **Daily YouTube limit** input is locked against changes whenever blocking or an automatic schedule is running. It accepts numbers only, between 1 and 1440 minutes.

Short notes under Settings → Reminders appear as your usage crosses a share of your limit (e.g. 50%). Each fires once per day and never blocks anything.

## The four modes

### Normal

YouTube works normally, with the distractions you choose turned off (Home feed, Up Next, autoplay, and so on — see Settings → Content controls). Search behavior is set under Settings → Search: Allow, Hide distractions, Block search, or “Study: allowed only”, which hides every result that isn't from your allowlisted channels or videos. The daily limit still applies.

### Restricted

Discovery stripped: Home, Explore, Trending and Shorts are blocked outright. Search and Subscriptions stay usable, cleaned up. **Watch pages only play when opened from a YouTube search in the same tab** — direct links, channels and recommendations stay blocked. The Short you opened plays (first per visit, always — even with Allow the first Short off); moving to another Short is blocked.

### Study

Only your chosen channels and videos are available — everything else shows a Study screen. Study time never touches your daily limit, sessions, or Extra-time limit. All allowlisted channels and videos are completely immune to video count caps, watch time limits, and Shorts caps.

### Full Block

Blocks YouTube completely, except Watch Later and YouTube Studio. A direct **"📚 Switch to Study Mode"** button appears on the block card and popup so you can easily transition into your approved educational channels without hitting a dead end.

## Cooldowns & Impulse Protection

### 5-Minute Unblocking Cooldown
When Master Blocking is on, toggling it OFF does not unblock immediately. A 5-minute cooling-off countdown begins, and YouTube remains blocked. If your urge passes, click **Cancel** at any time to stay focused. Once the 5 minutes elapse, blocking turns off. (Note: when an automatic schedule is running, blocking is locked and cannot be disabled).

### 30-Minute Strict Mode Unlock Cooldown
Strict Mode locks your Focus settings — mode, switches, schedules, allowed channels, and limits — so a moment of temptation can't rewrite the rules. Toggling Strict Mode OFF initiates a **30-minute unlock cooldown**. During these 30 minutes, your settings remain locked. You can click **Cancel** at any time to remain strictly protected. When 30 minutes pass, Strict Mode unlocks.

Deliberate exception: **spending approved time is not configuration**. Starting a session or extra-time session still works under Strict — only the rules are locked, not the day you already budgeted.

- **Block Shorts** stops Shorts from playing — even when the master Blocking switch is off. Only the player is blocked; shelves and the Shorts tab are controlled under Content controls → Feeds & discovery.
- **Allow the first Short**: visible when Block Shorts is enabled. Lets the Short you opened play while blocking subsequent swipes.
- **Daily Shorts limit**: dropdown with `No cap`, `Block all Shorts`, or `Set daily limit` (slider 1–500). Study-allowlisted channels and videos bypass this limit.
- **Videos per day**: dropdown with `No limit`, `Block all videos` (with warning), or `Set daily limit` (slider 1–100).
- **Daily watch limit**: dropdown with `No limit` or `Set daily limit` (slider 5–600 minutes).

## When the day's time runs out

The card changes to **"Today's YouTube time is used up"**. Settings → **Extra time after daily limit** controls whether additional time is permitted:
- **When OFF**: YouTube blocks immediately upon daily limit exhaustion for the rest of the day as a terminal block.
- **When ON**: Extra time can be unlocked in sessions from a configured pool and start limit (choose up to 4 active duration choices).
- Each started extra-time session spends its minutes **and** one start. Ending early refunds unused minutes, never starts.
- Lengths you can't afford are greyed out, with the remaining pool and starts shown.
- **0** max starts means unlimited starts. Loosening the limit (a bigger pool, more starts, new lengths, or enabling the allowance) takes effect **tomorrow**; tightening applies instantly.

When daily time **and** any allowed extra time are both spent (or extra time is disabled), YouTube is done for today — **only your allowed study channels and videos open until midnight**. This terminal block cannot be lifted early.

## Study Mode

- Add allowed channels (paste a channel URL, `@handle`, or channel ID) and specific allowed videos under Settings → Study Mode. Your very first allowed item is active immediately, so you can start Study Mode today; later edits activate at midnight.
- Matching prefers the channel's exact ID, then its link, then its handle.
- After the first item, additions and removals made today activate at **00:00** ("Waiting for midnight"), so a block can't be bypassed by changing the list. While terminal block is active, all allowlist edits wait for midnight.
- **Study timer**: start a 25/50/90-minute Study session from Settings. In Study Mode, nothing you watch touches your daily limit. When a timer you started expires (or you end it), your previous mode is restored — unless you picked Study yourself meanwhile.

## Schedules

Under Settings → Schedule, set automatic windows in any mode (Normal, Restricted, Study, Full Block) on any days — e.g. weekdays 09:00–17:00. Overnight ranges (e.g. 22:30 → 07:00) work.
- **Auto-activation & Master lock**: While a schedule runs, blocking turns on automatically and cannot be toggled off. Overlapping schedules are rejected with an inline error.
- **Schedule Mode Switching**: During an active schedule, you can switch modes according to intentional focus rules:
  - From **Normal**: switch to any mode.
  - From **Restricted**: jump to Study or Full Block (cannot downgrade to Normal).
  - From **Study**: jump to Restricted or Full Block (cannot downgrade to Normal).
  - From **Full Block**: jump to Study Mode only.
- **Schedule Deletions**: An active running schedule cannot be removed. Inactive schedules mark **"Removal pending (at midnight)"** and continue functioning until 00:00 local midnight, preventing impulsive deletions. You can cancel pending removals before midnight.

## Strict Mode

Strict Mode locks your Focus settings — mode, switches, schedules, allowed channels, and limits — so a moment of temptation can't rewrite the rules. Flipping a locked toggle just flips back; only the Strict switch itself stays tappable, plus Reset.

Deliberate exception: **spending approved time is not configuration**. Starting a session or extra-time session still works under Strict — only the rules are locked, not the day you already budgeted.

## Advanced & Reset Safety

Settings → Advanced contains a **3-Layer Reset Flow** to protect against accidental data loss:
1. **Warning**: Explains that all settings, schedules, Study channels, and history will be permanently erased.
2. **Typed Confirmation**: Requires typing `"RESET"` in capital letters.
3. **Destructive Action**: Permanently clears local storage and restores defaults.

## Statistics

- Settings → Analytics shows what actually happened: today's usage vs quota, sessions, extra-time use and reminders; focus streaks; what got blocked today; usage-vs-quota for the last 14 days; and per-day history.
- When there is no activity or history recorded yet, a clean placeholder card explains how to get started.

## Troubleshooting

- **Nothing is blocked**: check the master **Blocking** switch is on (the popup badge reads `Off` when it's off), and that you're not inside a session (popup shows "Session until …").
- **A session or Extra-time choice is shaded**: wait for the shade to drain, or choose another length if you cannot afford it. The Extra-time limit resets at midnight.
- **A toggle flips straight back**: Strict Mode is on, or the active mode overrules it (e.g. feeds in Restricted — the note names the mode).
- **A change didn't seem to apply**: most settings apply instantly and show “✓ Saved.” To keep today’s block meaningful, later allowlist edits and looser Extra-time limits apply at midnight. If a YouTube tab looks stale, refresh that tab once.
- **YouTube changed and something no longer hides**: reload the extension on the extensions page, then refresh the YouTube tab.

## Privacy

Everything YouTube Focus knows lives only in your browser's local extension storage: your settings, allowlists, schedules, and local counters. The extension makes no network requests, has no accounts, sends no analytics, and loads its font from inside its own package. Uninstalling or resetting removes everything.
