# 21: Lua config (`init.lua`)

**Iteration:** 2 · **Repo:** roster-desk · **Spec:** 0001 (stories 5, 40–41, 47, 51, 81–87) · **ADR:** roster-desk 0002

**What to build:** The app reads `~/.config/roster-desk/init.lua` (`%APPDATA%\roster-desk\init.lua` on Windows). The Rust core evaluates it with mlua (Lua 5.4 built in). The file returns a table that's layered over the built-in defaults, checked against a schema, and sent to the frontend as a typed Config object. The frontend never runs Lua.

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

Build the Config loader as the first user of the registries that ticket 23 will expose to Plugins (ADR 0004). Config values go *through* the registries, never around them.

**Blocked by:** 09

**Status:** ready-for-agent

- [ ] Rust tests (no Tauri, runnable in WSL): defaults with no file; a partial table merges over the defaults; Lua logic such as `if os == ...` works; a schema error and a Lua syntax error each report file and line; reload keeps the last good Config on error.
- [ ] Lua has no access to roster's secrets or the vault. It runs with only a safe set of libraries (no `os.execute`, `io.popen` or `require` outside the config dir).
- [ ] UI tests: a Config change rebinds the leader and a key, swaps the font and theme, and turns vim off.
- [ ] Manual check on Windows: edit `init.lua` while the app runs and see font, colors and keys change live. A typo shows the error toast and nothing breaks.
- [ ] `docs/config.md` and `examples/init.lua` cover every option.
