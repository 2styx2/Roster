# 22: Focus mode (fullscreen, tmux-like)

**Iteration:** 2 · **Repo:** roster-desk · **Spec:** 0001 (story 94) · **Decision:** Q36

**What to build:** A second view mode next to Standard.
- **Entering Focus:** `␣ m` or F11. The window goes OS-fullscreen, and the title bar, Sidebar and status bar are hidden, so only the terminal shows.
- **Status line:** a thin, tmux-style line at the bottom. Its position can be top or bottom, or it can be hidden, through options and `init.lua`. It lists Sessions as `0:esxi-02* 1:net-sw-core-01 2:orion3-`, with the current one marked and the previous one marked with `-`, plus the Host's address and login type.
- **Keys:** all Session keys work as in Standard: `␣ ]` / `␣ [`, `␣ 0-9`, `␣ f` (the Picker opens over the terminal), `␣ d d`, and `␣ r` to reconnect.
- **Leaving:** a hint shows for about 2 s on entering, explaining how to leave.
- **Restoring:** `␣ m` or F11 restores Standard with the same Session on screen.

The prototype is `prototype-shell.html?mode=focus` on branch `prototype/logos`. The starting mode can be set in `init.lua` (`default_mode`). Split panes stay out of scope.

**Blocked by:** 07, 17

**Status:** ready-for-agent

- [ ] UI tests: entering and leaving Focus keeps the active Session; the status line lists Sessions in order with the current and previous ones marked; every Session key works in Focus; the status line can be hidden.
- [ ] The terminal's cols and rows are recalculated on entering and leaving, and the remote side sees the new size (`stty size`).
- [ ] Manual check on Windows: fullscreen with F11, then switch Sessions, open the Picker and close a Session, all without leaving Focus.
