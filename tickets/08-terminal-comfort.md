# 08: Terminal comfort

**Iteration:** 1 · **Repo:** roster-desk · **Spec:** 0001 (stories 12, 17, 27–29, 31–32)

**What to build:** Make the terminal pleasant to live in:
- Copy on selection or Ctrl+Shift+C; paste with Ctrl+Shift+V or right-click.
- Search the scrollback.
- Zoom the font in and out, with a configurable monospace font.
- When a Session ends, its tab shows "ended" and one key reconnects it.
- Several Sessions to the same Host at once.
- A picker key that connects in the current tab when that tab's Session has ended.
- The picker ranks equal matches by recent use, remembered in the app's State file. That's State, not Config.

**Your terminal config wins** (decision Q37):
- Sessions get `TERM=xterm-256color` and `COLORTERM=truecolor` and nothing else from the app: no PS1, no sourced files, no output rewriting.
- Remote `.bashrc`, prompt colours, `LS_COLORS`, vim and truecolor themes render as they would in Windows Terminal.
- The ANSI 16-colour palette is a neutral standard one by default. It isn't tinted with the accent, it lives in the options and theme data, and ticket 21 can override it.

**Blocked by:** 05

**Status:** done

- [x] UI tests cover the ended state, reconnect, and recent-use ranking. (`Sessions.test.tsx`, `tabs.test.ts`, `App.test.tsx`)
- [x] Truecolor and 256-colour test scripts render correctly. `ls --color`, a coloured PS1 from the user's real `.bashrc`, and a vim colourscheme all look the same as in Windows Terminal against the same Host. (2026-10-29, build-02, screenshots side by side: same 16 colours, gradient, LS_COLORS, the `~/.bashrc` prompt with its `(1)` exit code, vim `desert` with `termguicolors`. Only the window background differs: WT's Campbell is #0c0c0c, ours #16181d.)
- [x] A test asserts that the Session environment adds only `TERM` and `COLORTERM`, plus ticket 06's askpass variables. (`crates/desk-core/tests/session_command.rs`)
- [x] Manual check: copy and paste both ways, find text in scrollback, zoom, kill `ssh` remotely and reconnect. (2026-10-29 on Windows 10.0.26200 against build-02.)

**Done notes:**
- Keys (one data block, `src/terminal/keymap.ts`, merged into `keymap.ts`; Windows Terminal's defaults): in a terminal Ctrl+Shift+C/V copy/paste, Ctrl+Shift+F find, Ctrl+= / Ctrl+- / Ctrl+0 and Ctrl+wheel zoom. Leader then `r` reconnects an ended or refused tab (also a Reconnect / Retry button). Ctrl+Enter in the Picker connects in the current tab when its Session has ended, else opens a new tab. Select-to-copy, and right-click copies the selection or pastes (both switchable in `options.ts`).
- Reconnect reruns `session.prepare`, keeps the tab and its scrollback, and prints a dim `[reconnecting to …]` line (the app's own line, not a rewrite of remote output).
- Several Sessions to one Host already worked; tabs are now labelled `host`, `host (2)`, …
- State file: `state.json` in the OS local app-data dir (`%LOCALAPPDATA%\dev.roster.desk\` on Windows), `{ "version": 1, "recentHosts": [...] }`, at most 50 names, unknown keys kept. Atomic save; a corrupt file is moved to `state.json.bad`.
- `windowsPty` uses the real build from `RtlGetVersion` (`platform_info`, 26200 here).
- Clipboard goes through `tauri-plugin-clipboard-manager` 2.5.0 (WebView2 won't let the page read the clipboard).
- `COLORTERM=truecolor` is set on the local ssh, but ssh only forwards it with `SendEnv COLORTERM` and a matching `AcceptEnv` on the Host. Windows Terminal has the same limit, and Q37 rules out adding ssh options. Truecolor escapes render either way; only programs that check `$COLORTERM` notice.
- Ticket 05's open item, WebView2 browser shortcuts: checked with real keys (WScript.Shell SendKeys after a real click into the window, so SendInput-level and not CDP). Ctrl+R reaches bash (reverse-i-search) and the page doesn't reload. F5 doesn't reload. Ctrl+F opens no find bar. Ctrl+Shift+C opens no devtools. Ctrl+= reaches our zoom, not the page zoom. CDP key events skip the browser's accelerator handling, so only a real-key path proves this. SendKeys only lands once the WebView has OS focus (click first).
