# 27: Worst-case UI pass (`/break-ui`)

**Iteration:** 2 · **Repo:** roster (app) · **Decision:** Q47 · **Runs with:** ticket 09 (design pass)

**What to build:** Run the `break-ui` skill over every screen: the Sidebar (Sessions, Folders, Inventory), the Picker, the command line, the Key bindings panel, the lock screen, the error and `:check` panels, the status bar, and Focus mode once 22 lands. Feed each one worst-case data behind a "Demo data / Worst case" toggle:
- **Long and unbreakable text:** names like `server-10-19-77-202-very-long-discovered-name`, long group names and long error messages.
- **Short and odd text:** one-letter names, unicode, emoji and RTL text.
- **Volume:** 0, 1 and 500+ Hosts, 50 open Sessions, 100 Folders and huge counts.
- **Missing and broken data:** missing fields such as no address or no title, long fingerprints and SHA256 strings, and the `␣`/Leader keycaps at every size.
- **Window sizes:** narrow (800px), wide, and 150% Windows scaling.

Fix everything that breaks. Already seen:
- names truncated next to the "unreviewed" badge;
- the Leader hint rendering as `_ f` rather than a keycap;
- the Folders empty-state hint wrapping badly.

**Blocked by:** 09 (they ship together)

**Status:** done

- [x] The worst-case fixture is selectable in the app (`?fixture=worst-case`, and a dev-only toggle) and in UI tests.
- [x] A screenshot of each screen in the worst case, before and after, goes in `docs/app/design/break-ui/`.
- [x] Every issue found is fixed, or listed with a reason.
- [x] Truncated names always show the full name on hover and in the Host details. No text overlaps at 800px or at 150% scaling.

## What broke, and what was done

Fixtures: `app/src/backend/worstCase.ts` (`?fixture=worst-case`, `-empty`, `-one`, `-start`, `-vault`), built
into the App by `app/src/backend/fixtureProps.ts` for the dev page and `app/src/App.worst.test.tsx`. The toggle is
`app/src/dev/FixtureToggle.tsx` (dev builds only). Screenshots were in `docs/app/design/break-ui/before/` and `after/`
(not carried over into the roster repo; the fixtures above reproduce every screen)
(Playwright Chromium: `-wide-dark`/`-wide-light` 1180×740, `-narrow` 800×600, `-scaled` 800×500 CSS px at
1.5×), and `windows-worst-*-150.png` (the real WebView2 window at 150 % Windows scaling, 1180 and 800 px).
The "before" dark shots predate the neutral dark background (029067c); "after" uses it.

| # | Severity | Where | Worst case | What happened | Fix |
|---|---|---|---|---|---|
| 1 | Broken | Sidebar Sessions, tab strip, session bar | one Host opened 3× with a long name | the " (2)" was cut, so the three rows looked identical | `tail` kept out of the cut (`.sb-tail`, `.tab-tail`, session bar) |
| 2 | Broken | 50 Sessions | 50 terminals | each held a WebGL context; the browser keeps ~16, so older terminals showed lost white canvases | WebGL only while a terminal is on screen (TerminalView) |
| 3 | Broken | Focus session bar | 50 Sessions | the current Session ran off the end, the address was pushed out | tabs scroll to the current one; box, number, " (2)", mark and address keep their place |
| 4 | Broken | Finder (Focus) | 1,361 tree items | the query row collapsed to ~20 px | `flex: none` on the Picker's and Finder's header |
| 5 | Broken | Key bindings panel | a Plugin's long name and `Ctrl+Shift+Alt+PageDown` | the table grew past the panel; the source was cut off with no tooltip | chords wrap between keycaps, the source is capped with a tooltip |
| 6 | Ugly | Sidebar | long name next to "unreviewed" (seen in 09) | the badge squeezed the name to ~13 chars | the name wins; the badge, address and note drop out whole when they don't fit; the reason is in the tooltip |
| 7 | Ugly | Sidebar | IPv6 / long names | addresses cut to "10.1…", "fe80…" | shown whole or not at all (wrapping line box) |
| 8 | Broken | Sidebar Folders/Inventory | a long Folder or group name | its Host count vanished | counts are their own element (`count`), never cut |
| 9 | Ugly | everywhere | 1,284 Hosts, 1 Host | "1284 hosts", "1 hosts", "200 of 1284" | `app/src/ui/format.ts` (Intl.NumberFormat, Intl.PluralRules) |
| 10 | Broken | status bar | long Box name and path at 800 px | the path vanished first but "hide this bar" was cut mid-word | the path gets only the leftover room, hints drop out whole, then the Box name is cut with a tooltip |
| 11 | Ugly | Focus hint | ␣ m and F11 | "␣ m F11" read as one sequence | "␣ m or F11" |
| 12 | Ugly | Folders empty state (seen in 09) | 248 px Sidebar | "press" and its keycaps split across lines | the word before keycaps stays with them; `text-wrap: balance` |
| 13 | Ugly | command line | Arabic / CJK Folder names | taller rows | fixed line height |
| 14 | Ugly | error panel heading | long Host name | the "·" wrapped alone | the title part never wraps; the Host name breaks anywhere |
| 15 | Fragile | Picker, finders, `:check`, status notices | IPv6 with zone, long paths and messages | cut without a tooltip | tooltips (the UI test checks every ellipsis rule in styles.css) |
| 16 | Ugly | Sidebar rows | a row whose address wrapped | label shifted up (font shorthand reset the line height) | `font-family`/`font-size` instead of `font` |
| 17 | Fragile | window | terminal helper overflow + scrollIntoView | the whole window scrolled 13 px, hiding the title bar | `.window-body { overflow: clip }` |
| 18 | Ugly | RTL names | `خادم-الإنتاج-٠١` | digits and neighbours reordered | bidi isolation on names |
| 19 | Ugly | emoji names | `🦊-fox-lab` | tofu where the font stack had no emoji font | emoji fonts end the UI stacks (Windows already drew it) |

Left as is, with the reason:
- **Host details** (the second half of "full name … in the Host details") don't exist yet: ticket 18. Until
  then the full name is in every tooltip, the Picker's wider column, the finders and the `:check` heading.
- **An unreviewed long name shows no badge on hover** (it would cut the name): the faint hollow dot and the
  tooltip ("Not reviewed yet: can't be opened") say it. A design call worth checking in ticket 29.
- **SHA256 fingerprints wrap** in the 320 px `:check` panel and stay whole and copyable; a wider panel is
  ticket 29's call.
- **Command-line completions wrap** rather than cut: the end (the Folder name) is the part that differs.
- **Headless Chromium at 1.5×** sometimes leaves the terminal blank right after 50 Sessions open in one tick
  (no context loss; it draws after the next switch). WebView2 at 150 % draws it (windows-worst-*-150.png).
- **The Sidebar renders all 1,284 Hosts** (no virtualization): it stays responsive in Chromium and WebView2;
  revisit if real Inventories grow past a few thousand.
