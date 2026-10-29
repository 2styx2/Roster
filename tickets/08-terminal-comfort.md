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

**Status:** ready-for-agent

- [ ] UI tests cover the ended state, reconnect, and recent-use ranking.
- [ ] Truecolor and 256-colour test scripts render correctly. `ls --color`, a coloured PS1 from the user's real `.bashrc`, and a vim colourscheme all look the same as in Windows Terminal against the same Host.
- [ ] A test asserts that the Session environment adds only `TERM` and `COLORTERM`, plus ticket 06's askpass variables.
- [ ] Manual check: copy and paste both ways, find text in scrollback, zoom, kill `ssh` remotely and reconnect.
