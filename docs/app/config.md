# The Config: `init.lua`

roster-desk is configured by one Lua file, the way WezTerm and Neovim are (ADR 0002). There's no Settings screen. [`examples/init.lua`](../examples/init.lua) has every option with its default value and a comment; copy it and change what you like.

| OS | Where |
|---|---|
| Windows | `%APPDATA%\roster-desk\init.lua` |
| Linux | `$XDG_CONFIG_HOME/roster-desk/init.lua`, else `~/.config/roster-desk/init.lua` |

## How it works

- The Rust core runs the file with Lua 5.4 (mlua, built in). The file returns a table. Anything it leaves out keeps the built-in default.
- The table is checked against a schema (`crates/desk-core/src/config/schema.rs`, the source of truth) and sent to the frontend as one typed object (`src/config/types.ts`). The frontend never runs Lua.
- The frontend applies it **through the registries** (ADR 0004), with source `init.lua`. Plugins (ticket 23) will use the same registries. Key bindings, Themes and Folders are registry entries. Everything else becomes the app's options (`src/config/apply.ts`).
- **Startup doesn't wait on it for long.** The window shows after at most 0.3 s; a Config that takes longer applies when it's done, the same way a save does. Starting the backend waits for it, so `roster_command` and `backend` are always the file's.
- **Saving reloads it live.** The core watches the folder, so editors that save by renaming a temp file over it work too. Any `.lua` file in the folder counts, including the modules it `require`s. If `init.lua`, a module or `lua/` is a symlink (stow, chezmoi), saving the file it points to counts too. Events that keep coming (a sync tool) still reload within half a second.
- **Errors.** A Lua error (syntax or runtime), or a name or value the schema doesn't accept, shows a message with the file and line, for example `init.lua:12: terminal.size: 400 is out of range (6 to 40)`. The last good Config stays in use. A misspelled name is an error, not silently ignored.
- **Warnings.** Some things only the app can check: an action that isn't a command, a Theme name that isn't registered, a Sidebar section or status segment it doesn't know. These show as a warning, and the rest of the Config still applies.
- **Line numbers** come from Lua for Lua errors and for `roster.*` calls. For a value in the returned table, the core finds the key in the source (`size =`, `["d d"] =`) after its parent keys. That's a best effort: a value built in a loop or in a required module may get its parent's line, or no line.

## The sandbox

The Lua code runs in the Rust core, which never holds a secret (docs/security.md), and it gets less than the core has:

- **Libraries:** the base functions, `string` (without `string.dump`), `table`, `math`, `utf8`, and an `os` with only `time`, `clock`, `date` and `difftime`.
- **Not there:** `io`, `os.execute`, `os.getenv`, `os.remove`, `os.exit`, `debug`, `package` (so no C modules), `dofile`, `loadfile`, `collectgarbage`. `load` takes text only, never bytecode.
- **`require(name)`** loads only `name.lua`, `name/init.lua`, `lua/name.lua` or `lua/name/init.lua` from the config folder (`.` in a name is a `/`). A name with `..` or a slash is refused, and so is a file (or a symlink) that resolves outside the folder. `require("roster")` returns the API table.
- **Limits:** 1 second of run time (an instruction hook checks a deadline, so `while true do end` stops with its line) and 64 MB of memory. Running out of time can't be caught: `pcall` and `xpcall` raise it again, so the run ends. The table it returns (with what it gave the `roster` calls) may hold at most 100,000 values and 16 MB of text, counting a table used in several places once per place.
- **One C call can't be stopped** by the instruction hook (a pattern that backtracks, say), so `string.find`, `match`, `gmatch` and `gsub` take text up to 64 KB and patterns up to 256 bytes, `string.rep` makes at most 1 MB, and a watchdog gives up on the whole run after 2 seconds of wall-clock time ("init.lua: took too long to run"). The last good Config stays in use.
- `print(...)` writes to the core's stderr (the `tauri dev` console).

## The `roster` table

A global, and also `require("roster")`. It's kept small. It's the start of the Plugin API (ticket 23), which will add commands, hooks, Sidebar sections and finder sources under the same names.

| Name | What |
|---|---|
| `roster.os` | `"windows"`, `"linux"` or `"macos"`, for `if roster.os == "windows" then … end` |
| `roster.api_version` | `1`. Raised when this table changes |
| `roster.keymap.set(context, keys, action)` | A key binding, as in `keys` below. `action` is a command line, or `false` to unbind |
| `roster.themes.define(id, theme)` | A Theme, as in `themes` below |

Calls and the returned table go to the same place. If both set the same key or Theme, the returned table wins. A call's errors point at the call's line.

## Options

Names are snake_case in Lua. The frontend's object is camelCase (`bold_weight` → `boldWeight`).

### Themes and colours

| Option | Default | |
|---|---|---|
| `theme` | `"auto"` | A Theme id, or `"auto"` to follow the OS light/dark setting |
| `dark_theme` / `light_theme` | `"roster-dark"` / `"roster-light"` | What `"auto"` picks |
| `themes` | `{}` | New Themes by id: `{ label, appearance = "dark"\|"light", base, colors = {…}, terminal = {…}, ansi = {…}\|false }`. Each starts from `base` (default: Roster dark, or Roster light for `appearance = "light"`) and changes only what it sets. `ansi = false` uses the standard palette (decision Q37). Leave `ansi` out to keep the base's |
| `colors` | `{}` | Tokens set over whichever Theme is in use |

The bundled Themes are `roster-dark`, `roster-light`, `gruvbox`, `nord`, `catppuccin-mocha` and `tokyo-night` ([themes.md](themes.md)). A `theme` that names one wins over the `:theme` picker's choice, which is kept in the State; `"auto"` leaves it to the picker.

UI tokens (`colors`, `themes.*.colors`): `accent`, `accent_text`, `accent_ink`, `bg`, `chrome`, `sidebar`, `panel`, `raised`, `raised_line`, `hover`, `line`, `line_strong`, `text`, `muted`, `faint`, `warn`, `error`, `danger`, `danger_text`, `backdrop`, `shadow`. `src/theme/theme.ts` says what each one colours.

Terminal colours (`themes.*.terminal`): `background`, `foreground`, `cursor`, `cursor_accent`, `selection_background`, `search_match`, `search_active_match`. ANSI colours (`themes.*.ansi`): `black`, `red`, `green`, `yellow`, `blue`, `magenta`, `cyan`, `white`, and `bright_` versions of each. `terminal.colors` takes both sets.

### Fonts and the terminal

| Option | Default | |
|---|---|---|
| `fonts.ui` | `"Inter"` | A family name, or a CSS font stack (anything with a comma is used as it is). A name gets the usual fallbacks |
| `fonts.mono` | `"Iosevka"` | The wordmark and code-like UI text |
| `terminal.font` | `"Iosevka"` | Same rules as the UI fonts. Inter and Iosevka ship with the app. Any other font must be installed |
| `terminal.size` | `14` | Points, 6 to 40. Zoom keys move it, and Ctrl+0 comes back to it |
| `terminal.weight` | `500` | 100 to 900. Iosevka ships at 400, 500 (medium, the default) and 700 |
| `terminal.bold_weight` | `700` | |
| `terminal.line_height` | `1.0` | 0.5 to 3 |
| `terminal.scrollback` | `10000` | Lines, at most 1,000,000 |
| `terminal.copy_on_select` | `true` | |
| `terminal.right_click_paste` | `true` | Right-click copies the selection, or pastes when there's none |
| `terminal.colors` | `{}` | Any terminal or ANSI colour, set over the Theme's |

### Keys

| Option | Default | |
|---|---|---|
| `leader` | `"Ctrl+Space"` | The chord that takes the keyboard back from a terminal. Written `"Ctrl+Space"`, `"ctrl+b"`, `"C-b"` or `"<C-b>"`. Without Ctrl, Alt or Meta it gives a warning, because the key would never reach the shell |
| `vim` | `true` | j/k/h/l/gg/G in lists and the Picker |
| `keys` | `{}` | Per context, `key = action`. The action is a command line, exactly what you'd type after `:` (`"close"`, `"session 1"`, `"finder sessions"`). `false` unbinds a default. Sequences are chords separated by spaces: `["d d"]` |

Contexts: `leader` (after the Leader), `list` and `list_vim` (the Sidebar), `picker` and `picker_vim` (actions `picker.down`, `picker.up`, `picker.choose`, `picker.chooseHere`, `picker.close`), `terminal` (before the shell sees the key: `terminal.copy`, `terminal.paste`, `terminal.search`, `terminal.zoomIn`, `terminal.zoomOut`, `terminal.zoomReset`, …), and `global` (everywhere with no Leader, like F11; keep it to keys a shell doesn't use). The Key bindings panel (`␣ ?`) lists every binding with its source: `builtin` or `init.lua`.

### Layout (decisions Q36, Q39)

| Option | Default | |
|---|---|---|
| `default_mode` | `"standard"` | The view mode at start: `"standard"` or `"focus"`. Read at start only |
| `sessions` | `"sidebar"` | Open Sessions in the Sidebar, or `"tabs"` for a tab strip |
| `modes.standard`, `modes.focus` | as prototyped | Each mode's pieces. A piece left out keeps that mode's default |

The pieces of a mode:

| Piece | Takes | Standard | Focus |
|---|---|---|---|
| `titlebar` | `true` / `false` | `true` | `false` |
| `sidebar` | `false`, `true`, or `{ side = "left"\|"right", sections = { "sessions", "folders", "inventory" } }`. `sections` picks and orders them. Leave it out for all | `{ side = "left" }` | `false` |
| `sessionbar` | `false`, `"bottom"` or `"top"`: the thin tmux-style bar of open Sessions | `false` | `false` |
| `statusbar` | `false`, `true`, or segments in order: `"backend"`, `"box"`, `"hosts"`, `"path"`, `"hints"`, `"mode"`. `hints` and `mode` sit on the right | `true` | `false` |
| `fullscreen` | `true` / `false`: OS fullscreen | `false` | `true` |

`␣ e` shows or hides the Sidebar, and `␣ s` the mode's bar (the status bar in Standard, the session bar in Focus). Focus without a Sidebar reaches the tree with `␣ e` as a finder. A save that changes `modes` resets what those keys toggled. A save that changes anything else keeps it.

The option names in the app are `Options.defaultMode` ← `default_mode`, `Options.focus.sessionbar` ← `modes.focus.sessionbar` (`"top"`, `"bottom"` or `false`), `Options.sidebar` ← `modes.standard.sidebar`, and `Options.statusBar` ← `modes.standard.statusbar`. Decision Q36's earlier `focus.status_line = true` is now `modes.focus.sessionbar = "bottom"`.

### Folders (decision Q46)

```lua
folders = { { name = "Lab ESXi", hosts = { "esxi-02", "esxi-03" } } },
```

They show first in the Folders section, marked "from init.lua", and only `init.lua` can change them: `folder add`, `rename`, `delete` and `remove` say so. A Folder made in the app with the same name is hidden behind it. Names must be unique, ignoring case, and can't contain a double quote. Folders made in the app stay in the State. Ticket 28 moves them to `folders.yml`.

### Other

| Option | Default | |
|---|---|---|
| `idle_lock_minutes` | `15` | Lock after this many minutes without input, 1 to 1440 |
| `backend` | `"auto"` | `"auto"`, `"wsl"`, `"wsl:<distro>"`, or `"local"` (native Windows roster is ticket 19; on Linux, roster always runs locally) |
| `roster_command` | `"roster"` | The command that runs roster, for development: a command line (split on spaces) or a list of words. It must be roster itself: `"roster"`, a path ending in `/roster`, or `"uv run --project <dir> roster"` (`uv run` takes only `--project`, `--directory`, `--frozen`, `--locked`, `--offline`, `--no-sync` and `-q`). Anything else is an error; see below |

**Why `roster_command` is limited.** The program it names gets the master password, two-step codes and the API key's secret on its stdin. A Config is code that may come from dotfiles or, later, Packages, so it can't put another program in front of them (docs/security.md). For a wrapper (a script that sets something up, then runs roster), set the `ROSTER_DESK_ROSTER` env var yourself, outside the Config: it takes any command. `:info` and the status bar's path tooltip show the command in use.

`backend` and `roster_command` are read when the backend starts. After changing them, use Retry on the error screen or restart the app. The env vars still win, for development: `ROSTER_DESK_ROSTER` over `roster_command`, and `ROSTER_DESK_WSL_DISTRO` over `backend = "wsl:<distro>"`.

## Not in v1

- Lua functions as actions or values. Hooks (`on_session_open`), custom `:` commands and finder sources come with Plugins (ticket 23).
- A Settings screen (decision Q24).
- Window size, recent Hosts and folded rows. Those are State, which the app keeps by itself.
