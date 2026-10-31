# The Config: `init.lua`

The roster app is configured by one Lua file, the way WezTerm and Neovim are (ADR 0004). There's no Settings screen. [`examples/init.lua`](../../examples/init.lua) has every option with its default value and a comment; copy it and change what you like.

| OS | Where |
|---|---|
| Windows | `%APPDATA%\roster\init.lua` |
| Linux | `$XDG_CONFIG_HOME/roster/init.lua`, else `~/.config/roster/init.lua` (the folder roster itself may also keep a `roster.yml` in) |

## `:config`

| Command | What it does |
|---|---|
| `:config` | Opens `init.lua` with the `editor` below. If there's no file yet, it first makes one from [`examples/init.lua`](../../examples/init.lua) with every line commented out, so it changes nothing until you uncomment something. A file that's there is never overwritten |
| `:source` (`:so`, `␣ S`) | Reloads the Config now, as Neovim's `:source` does: `init.lua` with its modules, `folders.yml` and `roster.yml` (ticket 28). `:source PATH` reloads only the file that owns PATH (`:source lua/keys.lua` is `init.lua` again). Tab completes the files |
| `:config reload` | The same as `:source init.lua` |
| `:config path` | Says where the file is |
| `:config import-terminal` | Copies Windows Terminal's default profile into `init.lua` (ticket 33): font, size, weight, cell height, cursor, how bold text looks, and a Theme made from its colour scheme, which it defines but doesn't set as `theme`: the app chooses it as `:theme` does, so `:theme` can still change it (decision Q69). It reads `settings.json` (Store, Preview or unpackaged), shows the change as a diff, and on Enter writes exactly that diff: if `init.lua` or Windows Terminal's `settings.json` changed since the preview, it writes nothing and asks you to run the import again to see the new diff. The block goes between `-- >>> Windows Terminal >>>` and `-- <<< Windows Terminal <<<` lines, before the file's `return`, and running the import again replaces it. It uses `roster.set`, so a value the file's own returned table sets wins, and the diff names those. Windows only |

Everything configurable says its name where it shows, so you can tell where to change it: each row of the Key bindings panel (`␣ K`) names its option (`keys.leader`, `keys.list_vim`, `leader`) under its label, next to its source (`builtin`, `init.lua`, a Plugin), and the filter finds rows by it; the `:theme` finder says `theme = "<id>"` for the Theme under the cursor; and `␣ e` / `␣ s` say which `modes.<mode>.<piece>` keeps what they just showed or hid.

**Moving from roster-desk.** The app was called roster-desk until it joined the roster repo (decision Q56). The first time the roster app starts, if its config folder has no `init.lua` and no `folders.yml` yet, it copies everything from the old `roster-desk` folder (`%APPDATA%\roster-desk`, `~/.config/roster-desk`) into it, never overwriting a file. The State moves the same way, from the old app-data folder (`dev.roster.desk`) to the new one (`dev.roster.app`), when there's no State there yet. The old folders are left as they are; delete them once you're happy. The development env vars were renamed too (`ROSTER_DESK_*` → `ROSTER_APP_*`); the old names still work when the new ones aren't set.

## How it works

- The Rust core runs the file with Lua 5.4 (mlua, built in). The file returns a table. Anything it leaves out keeps the built-in default.
- The table is checked against a schema (`crates/roster-core/src/config/schema.rs`, the source of truth) and sent to the frontend as one typed object (`app/src/config/types.ts`). The frontend never runs Lua.
- The frontend applies it **through the registries** (ADR 0006), with source `init.lua`. Plugins use the same registries ([plugins.md](../plugins.md)). Key bindings, Themes and Folders are registry entries. Everything else becomes the app's options (`app/src/config/apply.ts`).
- **Startup doesn't wait on it for long.** The window shows after at most 0.3 s; a Config that takes longer applies when it's done, the same way a `:source` does. Starting the backend waits for it, so `roster_command` and `backend` are always the file's.
- **`:source` reloads it (decision Q58).** Saving doesn't apply it by itself, as in Neovim: a half-written Config never takes effect mid-edit. The status bar says "init.lua changed" until you `:source` (`␣ S`).
- **`auto_reload = true` reloads on every save** instead. The core watches the folder, so editors that save by renaming a temp file over it work too. Any `.lua` file in the folder counts, including the modules it `require`s. If `init.lua`, a module or `lua/` is a symlink (stow, chezmoi), saving the file it points to counts too. Events that keep coming (a sync tool) still reload within half a second. Turning it on takes one `:source`, since the Config in effect decides.
- **Errors.** A Lua error (syntax or runtime), or a name or value the schema doesn't accept, shows a message with the file and line, for example `init.lua:12: terminal.size: 400 is out of range (6 to 72 px, 4.5 to 54 pt)`. The last good Config stays in use. A misspelled name is an error, not silently ignored.
- **Warnings.** Some things only the app can check: an action that isn't a command, a Theme name that isn't registered, a Sidebar section or status segment it doesn't know. These show as a warning, and the rest of the Config still applies.
- **Line numbers** come from Lua for Lua errors and for `roster.*` calls. For a value in the returned table, the core finds the key in the source (`size =`, `["d d"] =`) after its parent keys. That's a best effort: a value built in a loop or in a required module may get its parent's line, or no line.

## The sandbox

The Lua code runs in the Rust core, which never holds a secret (docs/app/security.md), and it gets less than the core has:

- **Libraries:** the base functions, `string` (without `string.dump`), `table`, `math`, `utf8`, and an `os` with only `time`, `clock`, `date` and `difftime`.
- **Not there:** `io`, `os.execute`, `os.getenv`, `os.remove`, `os.exit`, `debug`, `package` (so no C modules), `dofile`, `loadfile`, `collectgarbage`. `load` takes text only, never bytecode.
- **`require(name)`** loads only `name.lua`, `name/init.lua`, `lua/name.lua` or `lua/name/init.lua` from the config folder (`.` in a name is a `/`). A name with `..` or a slash is refused, and so is a file (or a symlink) that resolves outside the folder. `require("roster")` returns the API table.
- **Limits:** 1 second of run time (an instruction hook checks a deadline, so `while true do end` stops with its line) and 64 MB of memory. Running out of time can't be caught: `pcall` and `xpcall` raise it again, so the run ends. The table it returns (with what it gave the `roster` calls) may hold at most 100,000 values and 16 MB of text, counting a table used in several places once per place.
- **One C call can't be stopped** by the instruction hook (a pattern that backtracks, say), so `string.find`, `match`, `gmatch` and `gsub` take text up to 64 KB and patterns up to 256 bytes, `string.rep` makes at most 1 MB, and a watchdog gives up on the whole run after 2 seconds of wall-clock time ("init.lua: took too long to run"). The last good Config stays in use.
- `print(...)` writes to the core's stderr (the `tauri dev` console).

## The `roster` table

A global, and also `require("roster")`. It's kept small. A Plugin gets the same module with more in it: commands, Sidebar sections, finders, status segments, events ([plugins.md](../plugins.md)).

| Name | What |
|---|---|
| `roster.os` | `"windows"`, `"linux"` or `"macos"`, for `if roster.os == "windows" then … end` |
| `roster.api_version` | `2`. Raised when this module changes (it went to 2 with Plugins; nothing in `init.lua`'s changed) |
| `roster.keymap.set(context, keys, action)` | A key binding, as in `keys` below. `action` is a command line, or `false` to unbind |
| `roster.themes.define(id, theme)` | A Theme, as in `themes` below |
| `roster.set(name, value)` | Any option by its dotted name: `roster.set("terminal.size", "16pt")`. What `:config import-terminal` writes |

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

The bundled Themes are `roster-dark`, `roster-light`, `gruvbox`, `nord`, `catppuccin-mocha` and `tokyo-night` ([themes.md](themes.md)). `"auto"` leaves the Theme to the `:theme` picker, whose choice is kept in the State. A `theme` that names one is used until `:theme` chooses another: like Neovim's `:colorscheme`, that choice applies at once and stays, at start-up and on `:source`, until the file's `theme` changes to a different value, when the file wins again (decision Q69). Deleting the line unpins it.

UI tokens (`colors`, `themes.*.colors`): `accent`, `accent_text`, `accent_ink`, `tone`, `bg`, `chrome`, `sidebar`, `panel`, `raised`, `raised_line`, `hover`, `line`, `line_strong`, `text`, `muted`, `faint`, `warn`, `error`, `danger`, `danger_text`, `backdrop`, `shadow`. `app/src/theme/theme.ts` says what each one colours.

Terminal colours (`themes.*.terminal`): `background`, `foreground`, `cursor`, `cursor_accent`, `selection_background`, `search_match`, `search_active_match`. ANSI colours (`themes.*.ansi`): `black`, `red`, `green`, `yellow`, `blue`, `magenta`, `cyan`, `white`, and `bright_` versions of each. `terminal.colors` takes both sets.

### Fonts and the terminal

| Option | Default | |
|---|---|---|
| `fonts.ui` | `"Inter"` | A family name, or a CSS font stack (anything with a comma is used as it is). A name gets the usual fallbacks |
| `fonts.mono` | `"Iosevka"` | The wordmark and code-like UI text |
| `fonts.ui_size` | `15` | The UI's text size in px, 11 to 20: Sidebar rows, the Picker, panels. The smaller steps (headings, addresses, counts, the status bar) and the row height follow it, and so does the Sidebar's width; nothing goes under 11 px. The terminal has its own `terminal.size`. |
| `ui.hints` | unset | `false` hides every keycap hint: the status bar's, empty states', panels' and the Picker's footers, the command line's shortcut column, the Sidebar's Find button. The bindings work as before, and the keys stay in what a screen reader says. Unset, `:hints on\|off\|toggle` decides and the State keeps its choice; set, it wins. The Key bindings panel (`␣ K`) and `:help` always show the keys: they're what they list |
| `terminal.font` | `{ "Iosevka Nerd Font", "Iosevka Term", "Iosevka" }` | Families, most wanted first: the first one installed is used (installed fonts are matched by name; the CSP's `font-src` doesn't restrict them). The bundled Iosevka (no Nerd Font glyphs) is always there. A name, a CSS stack, or a list. `:info` says which one is in use |
| `terminal.size` | `"13pt"` | 13 pt is 17.33 px, a step above Windows Terminal's own 12 pt (decision Q61). A number is px; `"16pt"` is points, converted as Windows Terminal does (× 96/72, so 16 pt is 21.33 px, and the display scale applies to both the same way); `"21px"` works too. 6 to 72 px. Zoom keys move it a px at a time, and Ctrl+0 comes back to it |
| `terminal.weight` | `500` | 100 to 900. Iosevka ships at 400, 500 (medium, the default) and 700 |
| `terminal.bold_weight` | `700` | The weight of bold (SGR 1) text |
| `terminal.bold_is_bright` | `true` | Bold text in the bright ANSI colours too |
| `terminal.line_height` | `1.0` | A multiple of the font's own line height, 0.5 to 3. 1.0 gives the same rows as Windows Terminal's default ([terminal-vs-wt](design/terminal-vs-wt/README.md)) |
| `terminal.cell_height` | none | A multiple of the font size, as Windows Terminal's `cellHeight`, 0.5 to 3. Wins over `line_height` |
| `terminal.renderer` | `"webgl"` | `"webgl"` (fast, the default) or `"dom"`: the browser's own text rendering, a little closer to ClearType and slower with a lot of output (measured in [terminal-vs-wt](design/terminal-vs-wt/README.md)) |
| `terminal.cursor_style` | `"block"` | `"block"`, `"bar"` or `"underline"` |
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

Contexts: `leader` (after the Leader), `list` and `list_vim` (the Sidebar), `picker` and `picker_vim` (the Picker and every finder; actions `picker.down`, `picker.up`, `picker.next` (Tab: first fills the query with what the matching names share, then the next result, wrapping), `picker.prev` (Shift+Tab), `picker.choose`, `picker.chooseHere`, `picker.review` (Ctrl+R: mark an unreviewed Host reviewed), `picker.info` (Ctrl+I: the Host's details, ticket 18), `picker.help` (F1: help on the selected result, ticket 52), `picker.close`), `cmdline` (the `:` command line: `cmdline.next` (Tab, Ctrl+N), `cmdline.prev` (Shift+Tab, Ctrl+P), `cmdline.accept` (Ctrl+Y), `cmdline.run` (Enter), `cmdline.cancel` (Esc), `cmdline.help` (Ctrl+], F1: help on the command typed, ticket 52)), `terminal` (before the shell sees the key: `terminal.copy`, `terminal.copyIfSelected` (Ctrl+C: copies only while something is selected), `terminal.paste`, `terminal.search`, `terminal.zoomIn`, `terminal.zoomOut`, `terminal.zoomReset`, …), and `global` (everywhere with no Leader, like F11; keep it to keys a shell doesn't use). The Key bindings panel (`␣ K`) lists every binding with its source: `builtin` or `init.lua`.

### Layout

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
| `statusbar` | `false`, `true`, or segments in order: `"backend"`, `"box"`, `"hosts"`, `"path"`, `"changes"` (the Pending changes count, shown only when there are some), `"hints"`, `"mode"`. `hints` and `mode` sit on the right | `true` | `false` |
| `fullscreen` | `true` / `false`: OS fullscreen | `false` | `true` |
| `toolbar` | `false`, `true`, or controls in order: `"sidebar"` (the Sidebar's toggle, at the left), `"find"`, `"quick"` (Quick Connect, shown only with a roster that has it, API 12), `"add"` (Add Host), `"changes"` (with the Pending changes count), `"publish"` (shown only while there are Pending changes), `"details"` (Host details for the selected Host, ticket 18, by the window's buttons), and `"cmdline"`, `"keys"`, `"help"` (`:help`'s topic finder), `"lock"`, `"mode"`, which aren't in the default set. In the title bar; a bar of its own when the mode has none (decision Q65) | `true` (sidebar, find, quick, add, changes, publish, details) | `false` |

`␣ e` (or the Sidebar button at the left of the title bar) shows or hides the Sidebar, in Standard and in Focus (over the terminal there), and the State keeps that per mode, unless `init.lua` sets that mode's `sidebar`, which wins at the next start or `:source` (issue #54). `␣ s` shows or hides the mode's bar (the status bar in Standard, the session bar in Focus). `␣ t` finds in the Sidebar's tree. A reload that changes `modes` resets what `␣ s` toggled. A reload that changes anything else keeps it.

The option names in the app are `Options.defaultMode` ← `default_mode`, `Options.focus.sessionbar` ← `modes.focus.sessionbar` (`"top"`, `"bottom"` or `false`), `Options.sidebar` ← `modes.standard.sidebar`, and `Options.statusBar` ← `modes.standard.statusbar`. The earlier `focus.status_line = true` is now `modes.focus.sessionbar = "bottom"`.

### Folders

| Option | Default | |
|---|---|---|
| `folders` | `{}` | Folders kept in the Config, each `{ name = "…", hosts = { "…" } }`: read-only in the app |

```lua
folders = { { name = "Lab ESXi", hosts = { "esxi-02", "esxi-03" } } },
```

They show first in the Folders section, marked "from init.lua", and only `init.lua` can change them: `folder add`, `rename`, `delete` and `remove` say so. A Folder made in the app with the same name is hidden behind it. Names must be unique, ignoring case, and can't contain a double quote. Folders made in the app live in `folders.yml` (below).

### `folders.yml`

The Folders you make in the app (decision Q46) are kept in `folders.yml`, next to `init.lua`: plain data that you and the app both edit. Each Folder is its name and a list of Hosts:

```yaml
Lab ESXi:
  - esxi-02
  - esxi-03   # comments are kept
Night shift: []
```

The app writes it on every Folder change, keeping your comments and the order of what it didn't touch. An edit you make yourself applies on `:source` (the status bar says "folders.yml changed"), or at once with `auto_reload = true`. A file that doesn't parse keeps the last good Folders and says the line (`folders.yml:3 has an error …`). The first time the app finds no `folders.yml`, it writes the Folders the State held (from older versions) into a new one, once, and takes them out of the State. Folders never go into `roster.yml` or to `roster serve`.

### The vault

```lua
vault = {
  save_to = { organization = "My Team", collection = "Infra logins" },
  kp = { database = "~/roster.kdbx", key_file = "~/roster.keyx" },
},
```

This Box's own vault settings. They win over `roster.yml`'s `providers:` (the team's), so a setting that's personal doesn't have to go into the Inventory. The app sends them to `roster serve` (`vault.configure`, [serve-api.md](../serve-api.md#this-boxs-settings-vaultconfigure)) when it starts, before the lock screen asks where the vault stands, and again on every `:source`. Leave one out and `roster.yml`'s applies. They're paths and choices, never a secret: init.lua can't hold or send a password (docs/app/security.md). Needs roster's API 10; an older roster just uses `roster.yml`.

| Option | Default | |
|---|---|---|
| `vault.save_to` | unset | Where "Save to vault" puts a new password by default (ticket 35): `"personal"`, `{ organization = …, collection = … }` (Bitwarden, names or ids) or `{ group = … }` (KeePassXC). Wins over `roster.yml`'s `providers: <name>: save_to:` (the team's default). The add form's **Save to** starts on it, says where it's set, and can pick another place for one Host. A name that isn't there shows in the form as roster's message naming `vault.save_to in init.lua` |
| `vault.kp.database` | unset | KeePassXC's `.kdbx` (ticket 41). Wins over `providers: kp: database:`. A path on the Box roster runs on (inside WSL for a WSL Backend): absolute, or starting with `~`. A Windows path (`C:\Users\…`, `\\server\…`) is an error that names the WSL path it most likely means (`/mnt/c/Users/…`; a `\\wsl$\<distro>\…` share is that distro's own `/…`). Changing it on `:source` locks the app, since the master password was for the old database |
| `vault.kp.key_file` | unset | A key file used with that database's master password, on the same Box, as `database` (never a Windows path). Wins over `providers: kp: key_file:` |

### Other

| Option | Default | |
|---|---|---|
| `idle_lock_minutes` | `15` | Lock after this many minutes without input, 1 to 1440 |
| `auto_reload` | `false` | Reload on every save of a `.lua` file of the Config, of `folders.yml`, and of `roster.yml` (roster's watcher; the Sidebar follows within a second). Off: `:source` reloads (decision Q58), and the status bar says which file changed |
| `editor` | `"os"` | What `:config` opens `init.lua` with: `"os"` (the app the desktop opens `.lua` files with; on Windows, the app registered to *edit* `.lua` files, else Notepad, and never the one that *opens* them, which with Lua installed is the interpreter and would run the file), or `"wsl"` (`$EDITOR` inside the Backend's WSL distro, `vi` if it's unset, in a console window of its own; Windows only). It's a choice, not a command line: like `roster_command`, a Config can't name a program of its own to run |
| `backend` | `"auto"` | `"auto"`, `"wsl"`, `"wsl:<distro>"`, or `"local"` (native Windows roster isn't there yet; on Linux, roster always runs locally) |
| `roster_command` | `"roster"` | The command that runs roster, for development: a command line (split on spaces) or a list of words. It must be roster itself: `"roster"`, a path ending in `/roster`, or `"uv run --project <dir> roster"` (`uv run` takes only `--project`, `--directory`, `--frozen`, `--locked`, `--offline`, `--no-sync` and `-q`). Anything else is an error; see below |

**Why `roster_command` is limited.** The program it names gets the master password, two-step codes and the API key's secret on its stdin. A Config is code that may come from dotfiles or, later, Packages, so it can't put another program in front of them (docs/app/security.md). For a wrapper (a script that sets something up, then runs roster), set the `ROSTER_APP_ROSTER` env var yourself, outside the Config: it takes any command. `:info` and the status bar's path tooltip show the command in use.

`backend` and `roster_command` are read when the backend starts. After changing them, use Retry on the error screen or restart the app. The env vars still win, for development: `ROSTER_APP_ROSTER` over `roster_command`, and `ROSTER_APP_WSL_DISTRO` over `backend = "wsl:<distro>"`.

## Not in v1

- Lua functions as actions or values in `init.lua`. Hooks, custom `:` commands and finder sources are for Plugins ([plugins.md](../plugins.md)).
- A Settings screen (decision Q24).
- Window size, recent Hosts and folded rows. Those are State, which the app keeps by itself.

## See also

[Recipes](recipes.md) · [Options](options) · [Keyboard](keyboard.md) · [Themes](themes.md) · [How far roster bends](extending.md)
