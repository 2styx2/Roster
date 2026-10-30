# 22: Focus mode

**Iteration:** 2 · **Repo:** roster (app) · **Spec:** 0001 (story 94) · **Decision:** Q36

**What to build:** The second view mode next to Standard (decision Q36), toggled with `␣ m` or F11: fullscreen with no chrome, plus Telescope-style fuzzy finders. `␣ b` lists open Sessions and `␣ f` lists Hosts, in an overlay with Esc to close.
- **Entering Focus:** `␣ m` or F11. The window goes OS-fullscreen, and the title bar, Sidebar and status bar are hidden, so only the terminal shows.
- **Layout comes from data:** Focus's layout is read from the per-mode layout table (decision Q39). The session bar, status segments and anything a Plugin adds are placed according to the Config. Ship sensible defaults and hard-code nothing.
- **Optional session bar:** a thin tmux-style line, `[box] 0:esxi-02* 1:net-sw-core-01 2:orion3-`, with the current Session's address and login type. It's off by default and turned on with `focus.status_line = true`. It can sit at the top or the bottom.
- **Keys:** all Session keys work as in Standard: `␣ ]` / `␣ [`, `␣ 0-9`, `␣ f` (the Picker opens over the terminal), `␣ d d`, and `␣ r` to reconnect.
- **Leaving:** a hint shows for about 2 s on entering, explaining how to leave.
- **Restoring:** `␣ m` or F11 restores Standard with the same Session on screen.

The prototype is `prototype-shell.html?mode=focus` on branch `prototype/logos`. The starting mode can be set in `init.lua` (`default_mode`). Split panes stay out of scope.

**Every mode keeps all of roster** (decision Q36): a mode changes only presentation. Everything the Sidebar offers in Standard is reachable in Focus through overlays and finders: the Folders and Inventory tree as a fuzzy finder (`␣ e` opens the tree as an overlay), Host details, the command line, Quick Connect, the Key bindings panel, Lock, and later Inventory edits and Publish. Build every action as a mode-independent command (the `:` command table), and have each mode only decide how it's presented.

**Blocked by:** 07, 17

**Status:** done

- [x] UI tests: `␣ m` toggles Standard ↔ Focus and keeps the active Session. In Focus, `␣ b` fuzzy-finds Sessions and `␣ f` fuzzy-finds Hosts, Enter switches and Esc closes. Every Session key works in both modes. The optional session bar lists Sessions in order with the current one (`*`) and the previous one (`-`) marked.
- [x] A test walks the full command table and checks that every action can be invoked in both modes, by key and by `:` command.
- [x] The terminal's cols and rows are recalculated on entering and leaving, and the remote side sees the new size (`stty size`).
- [x] Manual check on Windows: fullscreen with F11, then switch Sessions, open the Picker and close a Session, all without leaving Focus.

**Done (2026-10-29):** `app/src/view/layout.ts` (the per-mode layout table: `fullscreen`, `pieces` placed top/bottom/left/right with `shown`, `tree: "sidebar" | "finder"`, `bar`, `hint`; `defaultLayouts(options)`; App takes a `layouts` prop for ticket 21), `app/src/finder/` (finder source registry, `finder SOURCE` command, the Finder overlay), `app/src/view/SessionBar.tsx`, `mode` / `focus` commands, `␣ m`, `␣ b`, and F11 in a new `global` keymap context. Options: `defaultMode` and `focus.sessionbar = "top" | "bottom" | false` (init.lua names are ticket 21's). The session bar numbers Sessions from 1, like `␣ N` and `session N`. UI tests: `app/src/App.focus.test.tsx` (including the walk over the whole command table in both modes, by key and by `:`). Checked on Windows (WebView2) with a scratch copy of the real Inventory (vault references removed, so no lock screen) and two Sessions (orion3, app-01): F11 goes OS-fullscreen (1100×700 → 2560×1440) and back; `stty size` 42 105 → 89 316 in Focus (88 318 with the session bar) → 42 105 again; `␣ b` lists both with the previous one selected and Enter switches; the Picker, the tree finder (`␣ e`), the session bar (`␣ s`) and the Key bindings panel (over the terminal) all work in Focus; `␣ d d` closed a Session without leaving Focus; the hint shows on entering and is gone after 2 s.
