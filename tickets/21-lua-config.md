# 21: Lua config (`init.lua`)

**Iteration:** 2 · **Repo:** roster (app) · **Spec:** 0001 (stories 5, 40–41, 47, 51, 81–87) · **ADR:** 0004

**What to build:** The app reads `~/.config/roster/init.lua` (`%APPDATA%\roster\init.lua` on Windows; `roster-desk` while the app had that name). The Rust core evaluates it with mlua (Lua 5.4 built in). The file returns a table that's layered over the built-in defaults, checked against a schema, and sent to the frontend as a typed Config object. The frontend never runs Lua.

v1 options:
- terminal and UI fonts, and font size
- colors and theme tokens, overriding the ones defined in ticket 09
- leader key
- keymap, mapping a key or chord to an action name from ticket 07's action table
- vim on/off
- idle lock timeout
- roster command, for development
- backend (used by ticket 19)
- **themes**: pick a bundled theme or define one as a Lua table of color tokens, and override any single token
- **layout, per view mode** (decisions Q33 and Q39):
  ```lua
  modes = {
    standard = { titlebar = true, sidebar = { side = "left", sections = { "sessions", "folders", "inventory" } }, statusbar = { "backend", "hosts" } },
    focus = { sessionbar = "bottom", statusbar = false },
  }
  ```
  - Pieces: the title bar, the Sidebar and its sections, the session bar, the status bar and its segments.
  - Sessions can be shown as `sidebar` or as `tabs`.
  - Any piece can be turned off in any mode.
- **Folders**: personal Folders defined in Lua, merged with the ones made in the app

Saving the file reloads it live. An error, whether a Lua error or a schema error, shows a toast with the file and line, and the last good Config stays active. An example `init.lua` documenting every option ships in the repo. There's no Settings screen.

Build the Config loader as the first user of the registries that ticket 23 will expose to Plugins (ADR 0006). Config values go *through* the registries, never around them.

**Blocked by:** 09

**Status:** done

- [x] Rust tests (no Tauri, runnable in WSL): defaults with no file; a partial table merges over the defaults; Lua logic such as `if os == ...` works; a schema error and a Lua syntax error each report file and line; reload keeps the last good Config on error.
- [x] Lua has no access to roster's secrets or the vault. It runs with only a safe set of libraries (no `os.execute`, `io.popen` or `require` outside the config dir).
- [x] UI tests: a Config change rebinds the leader and a key, swaps the font and theme, and turns vim off.
- [x] Manual check on Windows: edit `init.lua` while the app runs and see font, colors and keys change live. A typo shows the error toast and nothing breaks.
- [x] `docs/app/config.md` and `examples/init.lua` cover every option.

**Done (2026-10-29):** `crates/roster-core/src/config/` (schema.rs: every option and default, unknown names refused, shorthands normalized; lua.rs: the sandbox, `require` confined to the config dir, the `roster` table; locate.rs: file:line for schema errors; watch.rs: live reload; mod.rs: `load`, `Loader` keeping the last good Config, `backend_plan`), `app/src-tauri` (`config_load`, `config-changed` events, the backend start reads `roster_command` / `backend` with the env vars winning), `app/src/config/` (types.ts, apply.ts: the Config becomes Options, appearance, terminal options and layouts, and its keys, Themes and Folders go through the registries as "init.lua"; ConfigToast.tsx), a `folders` registry for init.lua's read-only Folders, per-mode `sections` / `segments` in the layout. Option names settled: `default_mode` → `Options.defaultMode`, `modes.focus.sessionbar = "bottom" | "top" | false` → `Options.focus.sessionbar` (Q36's `focus.status_line` is this). The terminal defaults to Iosevka 500 with bold 700 (Q49; the 500 face is now bundled), set with `terminal.weight` / `bold_weight`. Rust tests: `crates/roster-core/tests/config.rs` (26). The Rust defaults are written to `tests/fixtures/config-defaults.json`, and `app/src/config/config.test.ts` checks they equal the TypeScript defaults. UI tests: `app/src/App.config.test.tsx`. Docs: `docs/app/config.md`, `examples/init.lua` (a Rust test loads it and gets the defaults).

Checked on Windows (WebView2, build copy `roster-desk-dev-21`) with a real `%APPDATA%\roster-desk\init.lua` (there was none before, and the folder was removed afterwards). Its `roster_command` pointed at serve-stack roster with a scratch Inventory without vault references (91 Hosts, so no lock screen), and the status bar showed that command. One Session ran to build-02. Each save applied live: a rename-save (vim style) to `size = 16, weight = 400`, then in one in-place save Cascadia Mono, a Theme defined with `roster.themes.define` (accent, Sidebar, terminal background) plus `colors.warn`, Leader `ctrl+b` (Ctrl+Space then went to the shell), `t = "keys"` (opened Key bindings, which listed both as `init.lua`), vim off (`j` did nothing, arrows moved), the Sidebar on the right with Folders first, a Lua Folder marked "from init.lua", and Focus with the session bar at the bottom. A syntax error showed `init.lua:13: unexpected symbol near ','`, and a schema error showed `init.lua:11: terminal.size: 400 is out of range (6 to 40)`. Both kept the last good Config (Theme, side and Leader unchanged), and fixing the file cleared the toast. Iosevka renders at 500 with bold visibly at 700. With Cascadia Mono at 500, bold looked no heavier: Windows matches 500 to one of Cascadia's heavier faces, so pick `weight = 400` for it.
