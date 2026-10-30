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

**Status:** done pending user review

- [ ] A custom title bar replaces the OS frame: drag, double-click to maximize, minimize/maximize/close, resize from the edges, and Snap on Windows all work.
- [ ] Side by side with Linear, the look and feel is close enough for the user.
- [ ] The chosen logo ships as the app and taskbar icon at every size.
- [ ] A design review with the user on Windows, iterated until they approve it.
- [ ] Light and dark both checked. Reduced-motion turns the animations off.
- [ ] Typing latency and picker speed are no worse than before the pass.

**Built (2026-10-29), waiting for the user's design review.** Screenshots for the review are in [`docs/design/`](../docs/design/): `*-dark.png` / `*-light.png` from the fake Backend in Chromium (lock, empty, standard, session-ended, picker, keys-panel, sidebar-folders, error-panel, backend-error, sidebar-hover-unreviewed), `theme-gruvbox.png` and `theme-nord.png`, and `windows-*.png` from the real app on Windows (WebView2) with the real 91-Host Inventory (a scratch copy without vault references, so no lock screen) and one key Session to build-02.

- **Tokens and Themes** (`src/theme/`): a Theme is `{id, label, appearance, colors, terminal, ansi?}`; `colors` is the UI's whole token set (accent, accentText, accentInk, bg, chrome, sidebar, panel, raised, raisedLine, hover, line, lineStrong, text, muted, faint, warn, error, danger, dangerText, backdrop, shadow), set on `:root` as CSS variables (`raisedLine` → `--raised-line`). `styles.css` names no colour. Themes live in a registry (ADR 0004): Roster dark (default), Roster light, Gruvbox, Nord. `AppearanceOptions` (`theme = "auto"` follows the OS, `dark`/`light`, `fonts.ui`/`fonts.mono`, `titleBar.visible`) is what ticket 21's Config sets. The terminal takes its background, text, cursor and selection from the Theme; its 16 colours stay the standard (Campbell) palette unless a Theme brings `ansi` (Gruvbox and Nord do; the Roster Themes don't), decision Q37. The terminal options' new `colors` sit over the Theme's.
- **Fonts:** Inter 400/500/600 and Iosevka 400/700 from `@fontsource`, bundled (CSP `font-src 'self'`); the app waits for them (at most 1.5 s) so xterm measures the right font. Iosevka is the terminal's default family; family and size stay terminal options.
- **Logo D1:** `assets/logo.svg` (master) and `assets/logo-small.svg` (heavier strokes for 16–32 px); `npm run icons` renders `src-tauri/icons` and repacks `icon.ico` with the small cut at 16/24/32. The mark in the title bar, lock screen and empty state is drawn in Theme colours (`src/chrome/Logo.tsx`).
- **Title bar** (`src/chrome/TitleBar.tsx`): `decorations: false`; the bar is a `data-tauri-drag-region` with the mark, then minimize, maximize/restore and close (close red on hover). It sits above every screen, the lock and error screens too. The window starts hidden and is shown after it's put back where the State says (`window` key, saved as it settles; desk-core `window.rs` drops a place whose monitor is gone).
- **Components:** keycaps for every key hint (`src/ui/Keys.tsx`; the Leader is a space-bar cap with the chord as its tooltip, which fixes "_ f"); raised selection everywhere (Sidebar, Picker, command line, tabs); a Host's whole name shows on hover, and the "unreviewed" badge gives way to the name (it shows on hover, raised or under the cursor); tidy empty states (keycaps inside the Folders hint); Linear-style Picker with a key-hint footer; the Key bindings panel's source in its own column.
- **Motion:** press feedback on buttons (scale 0.97, 120 ms) and an ease-in for system-raised notes and Session errors (opacity + 4 px, 150 ms, `cubic-bezier(0.23, 1, 0.32, 1)`, `@starting-style`, so interruptible). The Picker, panels, command line and find bar open instantly (they're keys, used all day); the lock cover stays instant. Under `prefers-reduced-motion` the movement and press scale are off and only fades remain (checked: `--dur-move` 0 ms, `--press-scale` 1).

**Checked on Windows 11 (build 26200), real app:** drag region and double-click maximize/restore (CDP double-click; `is_maximized` true, then false and back to the same rect); the three buttons (maximize shows the restore glyph, close ends the app); resizing from the edges (Tauri's undecorated resizing: `WM_NCHITTEST` on the frame gives LEFT, RIGHT, BOTTOM, BOTTOMRIGHT, TOPLEFT; the top edge is Tauri's `TAURI_DRAG_RESIZE_BORDERS` strip); window size and place saved to the State and restored on the next start (moved to 300,200 984×641, closed, reopened at exactly that); the D1 icon in the exe and as the window's taskbar icon (`WM_GETICON`); Inter and Iosevka loaded; light and dark follow the OS live (terminal included); no console errors and no CSP violations in a `tauri build --debug` exe, whose CSP is enforced (a fetch to the internet is blocked).

**Not achieved: Windows 11 Snap Layouts on hovering maximize.** Windows shows the Snap Layouts flyout only when the window answers `WM_NCHITTEST` with `HTMAXBUTTON`. With `decorations: false` the maximize button is HTML inside WebView2's child window, so the top-level window never sees that hit test. Making it work means a native child window over the button that returns `HTTRANSPARENT`, a subclassed top-level window that returns `HTMAXBUTTON` there and handles `WM_NCLBUTTONUP`, and hover state sent back to the page (what Electron's window-controls overlay does), or faking Win+Z on hover. Neither is in Tauri 2.12. Dragging the bar uses Windows' own move loop, so snapping to a screen edge (and Windows' Snap bar at the top) and the Win+arrow keys should still work; those need a human with a mouse to confirm, as does Win+Z. Left for a later ticket.

**Not checked:** typing latency and Picker speed measured side by side (the Picker and the Sidebar rows don't animate, and nothing in the key path changed); Linux (ticket 20).

