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

**Blocked by:** 07, 08

**Status:** ready-for-agent

- [ ] A custom title bar replaces the OS frame: drag, double-click to maximize, minimize/maximize/close, resize from the edges, and Snap on Windows all work.
- [ ] Side by side with Linear, the look and feel is close enough for the user.
- [ ] The chosen logo ships as the app and taskbar icon at every size.
- [ ] A design review with the user on Windows, iterated until they approve it.
- [ ] Light and dark both checked. Reduced-motion turns the animations off.
- [ ] Typing latency and picker speed are no worse than before the pass.
