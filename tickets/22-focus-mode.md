# 22: Tmux and Focus view modes

**Iteration:** 2 · **Repo:** roster-desk · **Spec:** 0001 (story 94) · **Decision:** Q36

**What to build:** Two more view modes next to Standard (decision Q36), cycled with `␣ m`.

**Tmux mode:** still a window, with the title bar reduced to a thin drag strip and no Sidebar. The terminal sits above one status sliver: `[box] 0:esxi-02* 1:net-sw-core-01 2:orion3-`, plus the address, login type and uptime of the current Session.

**Focus mode** (described below): fullscreen with no chrome, plus Telescope-style fuzzy finders. `␣ b` lists open Sessions and `␣ f` lists Hosts, in an overlay with Esc to close.
- **Entering Focus:** `␣ m` or F11. The window goes OS-fullscreen, and the title bar, Sidebar and status bar are hidden, so only the terminal shows.
- **No status line in Focus:** the Telescope-style finders replace it.
- **Status line options:** in Tmux mode the status line can sit at the top or bottom, or be hidden, through options and `init.lua`.
- **Keys:** all Session keys work as in Standard: `␣ ]` / `␣ [`, `␣ 0-9`, `␣ f` (the Picker opens over the terminal), `␣ d d`, and `␣ r` to reconnect.
- **Leaving:** a hint shows for about 2 s on entering, explaining how to leave.
- **Restoring:** `␣ m` or F11 restores Standard with the same Session on screen.

The prototype is `prototype-shell.html?mode=focus` on branch `prototype/logos`. The starting mode can be set in `init.lua` (`default_mode`). Split panes stay out of scope.

**Blocked by:** 07, 17

**Status:** ready-for-agent

- [ ] UI tests: `␣ m` cycles Standard → Tmux → Focus and keeps the active Session. Tmux's sliver lists Sessions in order with the current and previous ones marked. In Focus, `␣ b` fuzzy-finds Sessions and `␣ f` fuzzy-finds Hosts, Enter switches and Esc closes. Every Session key works in all three modes.
- [ ] The terminal's cols and rows are recalculated on entering and leaving, and the remote side sees the new size (`stty size`).
- [ ] Manual check on Windows: fullscreen with F11, then switch Sessions, open the Picker and close a Session, all without leaving Focus.
