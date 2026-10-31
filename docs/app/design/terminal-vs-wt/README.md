# The terminal next to Windows Terminal (ticket 33)

How the roster app's terminal compares with Windows Terminal (WT 1.24, DirectWrite) on the same machine, after `:config import-terminal` copied WT's default profile into `init.lua`: Iosevka Nerd Font (installed, Medium and Bold files only), 16 pt, Campbell. Measured 2026-10-30 on Windows 10.0.26200, on a 100% screen and a 150% one. Each image shows WT on top, then the app with the WebGL renderer (the default), then the DOM renderer.

Both terminals ran the same local scene in WSL: a stand-in `ssh` that prints a Nerd Font prompt, `ls --color` and a few SGR styles, or opens `vim` on a small file. No real Host was connected to, and the names are demo names.

| | 100% | 150% |
|---|---|---|
| `ls --color`, Nerd Font prompt | [ls-100.png](ls-100.png) | [ls-150.png](ls-150.png) |
| vim | [vim-100.png](vim-100.png) | [vim-150.png](vim-150.png) |

## What matches now

| | Windows Terminal | The app before | The app now |
|---|---|---|---|
| Font | installed Iosevka Nerd Font | bundled web Iosevka (no Nerd glyphs) | the first installed family in `terminal.font` (default: Iosevka Nerd Font, Iosevka Term, then the bundled Iosevka). `:info` names the one in use |
| Size | 16 pt = 21.33 px (DIPs) | 14 px | `"16pt"` = 21.33 CSS px. A CSS px is a DIP, so the display scale applies the same way. Default `"12pt"`, WT's own (since decision Q61, `"13pt"`) |
| Row height | 27 px at 100%, 40 px at 150% | 19 px at 14 px | the same: 27 and 40 px |
| Cell width | 11 px at 100% (10.67 rounded) | 10 px (xterm floors it) | 11 px. The WebGL renderer gets WT's rounding through xterm's `letterSpacing`; see below |
| Bold (SGR 1) | brighter, not heavier (`intenseTextStyle: "bright"`, WT's default) | heavier and brighter | as WT after the import: `bold_weight` = the normal weight, `bold_is_bright = true` |
| Colours | Campbell | Roster dark | Theme `wt-campbell`, made from the scheme by the import |

**Line height.** The ticket measured WT's line height as "about 1.2". That is WT's default cell height for this font: Iosevka's own line, about 1.27 × the font size. xterm's `lineHeight` multiplies the font's own height, so `line_height = 1.0` already gives the same 27 px rows, and the default stays 1.0. A WT `cellHeight` (a multiple of the font size) is imported as `terminal.cell_height`, which the app converts with the measured font height.

**Cell width.** Iosevka advances 0.5 em, which is 10.67 px at 21.33 px. xterm's WebGL renderer floors the advance to a device pixel (10), and WT rounds it (11). So the app adds the difference as `letterSpacing` in device px, recomputed when the window moves to a screen with another scale. At 150% the advance is 15.999 device px: xterm floors it to 15 and WT draws 16, and the app now draws 16 too. The DOM renderer lays text out at the font's own advance, so it gets no extra spacing and is 0.33 px narrower per cell than WT at 100%.

## What still differs

- **Antialiasing.** WT uses DirectWrite with ClearType. xterm's WebGL renderer draws grayscale glyphs into a texture atlas, so the strokes are a little softer. The DOM renderer uses the browser's own text rendering. That is closer to ClearType's weight, but Chromium in WebView2 still antialiases in grayscale on a transparent layer.
- **vim's colours.** vim picked its light-background colours in the app (strings red, keywords magenta) and its dark ones in WT. vim asks the terminal for its background (OSC 11) as it starts. xterm.js answers, but the answer reaches vim through ConPTY and the app's IPC later than it does in WT. `set background=dark` in a vimrc makes them the same. This is left open: it's vim's guess, not the app's rendering.
- **Colour management on the 150% screen.** On that screen (a laptop panel with its own colour profile), WebView2 colour-manages the page and WT doesn't, so the app's colours read slightly different there (the prompt's `#005F87` became `#315E83` in the screenshot). On the 100% screen they're identical.

## Renderer trade-off (`terminal.renderer`)

A stand-in Host printed 300,000 short lines (`seq`), then 20,000 coloured lines, and timed how long until the terminal had taken them. The PTY blocks while the terminal is behind, so the time measures the terminal. These are three runs each in the dev build (Vite dev server, debug Rust), at 100%, in a terminal about 210 × 46:

| | `seq 1 300000` | 20,000 coloured lines |
|---|---|---|
| `webgl` | 1.44 s, 1.57 s, 1.53 s | 0.36 s, 0.47 s, 0.38 s |
| `dom` | 1.42 s, 2.18 s, 2.83 s | 0.32 s, 0.54 s, 0.95 s |

WebGL stays about the same from run to run. The DOM renderer starts as fast but slows as the scrollback fills (it re-lays out DOM rows), up to about twice as slow by the third run. Its text is a little closer to ClearType, and it uses no WebGL context. **WebGL stays the default**, and `renderer = "dom"` is there for people who prefer the browser's text.

## How these were made

- WT ran in its own window (`wt --pos … --size 100,24 -w new new-tab --title … -- wsl.exe … ssh <demo host>`) and was captured by window rectangle with a per-monitor-DPI-aware PowerShell.
- The app was the dev build (`app/scripts/app-dev.sh`), with a scratch `%APPDATA%` and a scratch `roster.yml` of three `127.0.0.1` demo Hosts, captured over CDP.
- The images were composed from crops anchored on the prompt, so the three rows line up.
