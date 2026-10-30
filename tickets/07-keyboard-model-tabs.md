# 07: Keyboard model and the Session Sidebar

**Iteration:** 1 · **Repo:** roster-desk · **Spec:** 0001 (stories 34–43, 88–93) · **Decisions:** Q31–Q35

**What to build:** The full keyboard model, plus the **Sidebar** as the default way to see and switch Sessions. It replaces any tab strip that ticket 05 left behind.

**Keyboard model:** two focus modes.
- **Terminal mode:** every key goes to the PTY except the Leader.
- **App mode:** vim bindings apply.

**Bindings:** all of them live in one keymap table: plain data with defaults, overridden later by ticket 21's `init.lua`.
- `␣ ]` / `␣ [`: next / previous Session
- `␣ 1-9`: go to Session N
- `␣ d d`: close the current Session
- `␣ e`: toggle the Sidebar
- `␣ :`: the command line, with completion for commands and Host names (`:connect HOST`, `:lock`, `:close`)
- `␣ s`: toggle the status bar

**Key bindings panel (`␣ ?`):** a right-hand panel generated from the resolved keymap. It's grouped by area, shows where each binding comes from (`default` or, later, `init.lua`), and can be filtered.

**The Sidebar (left):**
- A **Sessions** section lists each open Session with a state dot: key, password, ended.
- The Session on screen uses the **raised** style (a lighter fill and a 1px outline; no underlines).
- `j`/`k` move, Enter switches, and the mouse works throughout.
- The Inventory tree and Folders sections come in ticket 17. Leave room for them.

Build every action as an entry in one mode-independent command table, used by keys, the `:` command line and buttons alike. Ticket 22's view modes then only change how actions are presented, never which ones exist (decision Q36). The layout options (Sidebar on/off and side, Sessions as Sidebar or tabs, status bar on/off) are read from the options table, so ticket 21 can expose them in the Config.

**Blocked by:** 05

**Status:** done

- [x] UI tests against the fake backend:
  - the Leader switching modes;
  - switching and closing Sessions from the Sidebar and by key;
  - the command line with completion;
  - changing the Leader;
  - the Key bindings panel listing the current bindings and their source;
  - hiding the status bar and the Sidebar.
- [x] With vim off, `j`/`k` do nothing special, and every mouse path still works.
- [x] No tab strip is shown by default. Setting the `sessions = "tabs"` option still renders a basic tab strip, so the layout stays modular.
- [x] Manual check: drive a whole session without the mouse: open the Picker, connect, switch Sessions, open the bindings panel, close a Session, lock.
