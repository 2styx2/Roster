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

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] UI tests cover the ended state, reconnect, and recent-use ranking.
- [ ] Manual check: copy and paste both ways, find text in scrollback, zoom, kill `ssh` remotely and reconnect.
