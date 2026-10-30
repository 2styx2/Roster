# 33: The terminal looks like your Windows Terminal

**Iteration:** 3 · **Repo:** roster (app) · **Decision:** Q55

**Why:** With "the same font", the user's Windows Terminal and the roster app look different. Measured on 2026-10-30:

| | Windows Terminal | The roster app |
|---|---|---|
| Font file | the installed Iosevka Nerd Font (Medium and Bold) | the bundled web Iosevka (no Nerd glyphs) |
| Size | 16 pt (about 21 px) | 14 px |
| Line height | about 1.2 | 1.0 |
| Rendering | DirectWrite with ClearType and hinting | xterm WebGL, grayscale, no hinting |

**What to build:**
1. **Prefer installed fonts.** The default terminal font list tries installed Iosevka Nerd Font, Iosevka Term and Iosevka (checked with `document.fonts.check` or by enumerating system fonts in Rust) before the bundled Iosevka. Nerd Font glyphs (powerline, prompt icons) render.
2. **Sizes in points.** `terminal.size` accepts `"16pt"` as well as px. Points are converted the way Windows Terminal does (pt × 96/72, DPI-aware), so the same number means the same size.
3. **A crisper renderer option.** `terminal.renderer = "webgl" | "dom"`. The DOM renderer gets the browser's text rendering, which is closer to ClearType. WebGL stays the default for speed. Measure and document the trade-off.
4. **`:config import-terminal`.** Read the default profile from Windows Terminal's `settings.json` (font face, size, weight, cell height, color scheme, cursor) and write the matching `terminal = { … }` block, plus a Theme for the color scheme, into `init.lua`. Show a diff first, and never overwrite without confirming. Linux (Alacritty, WezTerm, Kitty) is a later proposal.
5. **Defaults closer to Windows Terminal:** line height 1.2, and the size default derived from points.

**Blocked by:** 21 (done), 32 (`:config`)

**Status:** done (checked by the agent on Windows, 2026-10-30; owner review pending)

- [x] Side-by-side screenshots against Windows Terminal (same Host, `ls --color`, vim, the user's Nerd Font prompt) at 100% and 150%, with both renderers, in `docs/app/design/terminal-vs-wt/`. They use a stand-in Host (a local scene in WSL), not a real one. The README there has the measurements: same rows, same cells, bold, and the renderer trade-off. Line height stays 1.0, because that is already Windows Terminal's 27 px row.
- [x] Tests: font resolution order (`app/src/terminal/fonts.test.ts`), pt→px conversion and the new options (`crates/roster-core/tests/terminal.rs`), the WT `settings.json` parser with fixtures for profiles, defaults and schemes, and the import diff and its writing (`crates/roster-core/tests/wt.rs`, `tests/fixtures/wt/`), and the import through the App (`app/src/App.terminal.test.tsx`).
- [x] Manual check: `:config import-terminal` read this machine's real WT settings.json (default profile "Windows PowerShell", with Iosevka Nerd Font 16 pt from `profiles.defaults`, Campbell and a filled-box cursor) into a scratch `init.lua`. Afterwards the terminal matched WT row for row and cell for cell at 100% and 150% (see the screenshots). The remaining differences are documented: grayscale antialiasing versus ClearType, vim's background guess, and colour management on the 150% screen.
