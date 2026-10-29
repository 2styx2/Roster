# 09: Design pass with /emil-design-eng and /animate

**Iteration:** 2 · **Repo:** roster-desk · **Spec:** 0001 (stories 44–49)

**What to build:** Give iteration 1 its real look and feel, using the `/emil-design-eng` and `/animate` skills:
- **Native where the OS owns it:** native window frame and title bar, platform shortcut habits, the system UI font, and light/dark that follows the OS.
- **Our own design inside:** color tokens, spacing, typography, and the picker, tabs and lock screen designs.
- **Motion:** quick, interruptible and purposeful. It turns off under the OS reduced-motion setting.
- **Window state:** the window remembers its size, position and panels.

**Direction (decided after the ticket was written):**
- **Linear is the main reference.** That means lean density, a muted dark-first palette with one accent, 1px hairline borders, small type (about 13px UI), quiet hover states, and fast motion of 150 ms or less. The command palette and Picker should feel like Linear's ⌘K. Study linear.app's app shell before designing.
- **Custom title bar, Slack-style**, in place of the native frame:
  - Tauri `decorations: false` with a `data-tauri-drag-region` bar holding the app icon, the tab strip, a Picker search pill showing the leader hint, and our own minimize, maximize and close buttons.
  - Windows controls sit on the right. Keep snap behavior: double-click maximizes, and check Windows 11 Snap Layouts on hover over maximize.
  - Linux puts them on the right too. On macOS, later, the traffic lights go on the left.
  - Close is red on hover.
- **The logo:** whichever concept the user picks from `prototype/logos` becomes the app icon at every size and appears in the title bar.

**Settled after round 3 of the prototype** (decisions Q29–Q35; `prototype-shell.html` and `prototype-logos.html` on branch `prototype/logos`):
- **Logo:** D1 (Network R). Ship it as the app and taskbar icon at every size.
- **Accent:** jade `#1f9d68`. The **Roster dark** and **Roster light** themes are built from color tokens, and a couple of extra themes (for example Gruvbox and Nord) ship to prove the token set is complete.
- **Fonts:** Inter for the UI and Iosevka for the terminal and wordmark, bundled with the app (no network).
- **Selection:** the raised style for the selected item everywhere. No underlines.
- **Title bar:** the bare bar from the prototype: the mark on the left, then minimize, maximize and close. It replaces the Slack-style bar with tabs and search described above.

**Blocked by:** 07, 08, 17

**Status:** ready-for-agent

- [ ] A custom title bar replaces the OS frame: drag, double-click to maximize, minimize/maximize/close, resize from the edges, and Snap on Windows all work.
- [ ] Side by side with Linear, the look and feel is close enough for the user.
- [ ] The chosen logo ships as the app and taskbar icon at every size.
- [ ] A design review with the user on Windows, iterated until they approve it.
- [ ] Light and dark both checked. Reduced-motion turns the animations off.
- [ ] Typing latency and picker speed are no worse than before the pass.
