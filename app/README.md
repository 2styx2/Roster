# The roster app

A fast, keyboard-first desktop app that gets you into a terminal on any Host in your team's roster Inventory in a few keystrokes. [roster](../README.md) (the CLI at the root of this repo) is the only backend: it knows the Hosts and the Logins, and the app reaches it through `roster serve`. The app is the nicest way to reach them.

> Status: **iteration 2.** Picker, Sessions (key and password), the Sidebar, the Lua Config, Themes, the lock screen with full vault sign-in, and clean connection errors. The app was a separate repo called roster-desk until it joined this one (decision Q56, ADR 0007); an old roster-desk Config and State are copied over the first time it starts ([config.md](../docs/app/config.md)).

## Where to look

| Path | What's in it |
|---|---|
| [docs/app/vision.md](../docs/app/vision.md) | Why this exists, how it compares with SecureCRT, Termius, Tabby and XPipe, and what makes it different |
| [docs/app/competitors.md](../docs/app/competitors.md) | Sourced competitor analysis (XPipe, Termix, Termius, RDM, Tabby, WezTerm and more): matrix, config and plugins, secrets model, positioning |
| [docs/app/architecture.md](../docs/app/architecture.md) | The processes, the `roster serve` API, how Sessions connect, and the backends |
| [docs/app/security.md](../docs/app/security.md) | Where secrets go and where they never go, and how locking works |
| [docs/app/keyboard.md](../docs/app/keyboard.md) | The leader key, the two focus modes, and the default bindings |
| [docs/app/config.md](../docs/app/config.md) | The Config (`init.lua`): where it lives, every option, the sandbox |
| [docs/app/themes.md](../docs/app/themes.md) | The bundled Themes and their tokens |
| [docs/app/roadmap.md](../docs/app/roadmap.md) | The iterations and what "done" means for each |
| [docs/app/dev/](../docs/app/dev/) | Researched, tested notes: Windows build loop from WSL, PTY and wsl.exe, xterm.js setup, test layout, vault sign-in |
| [docs/app/errors.md](../docs/app/errors.md) | Every way a connection can fail, with its message and fix |
| [docs/app/design/taste.md](../docs/app/design/taste.md) | roster's own design identity: what makes it look and feel like ours |
| [docs/app/decisions.md](../docs/app/decisions.md) | Every design question we asked and the answer |
| [docs/adr/](../docs/adr/) | Architecture decisions for the CLI and the app (0001–0002 roster serve and ssh, 0003–0006 the app, 0007 one repo) |
| [docs/app/spec/](../docs/app/spec/) | Product specs. Start with [0001](../docs/app/spec/0001-roster-app.md) |
| [tickets/](../tickets/) | Vertical-slice tickets with their blockers. [tickets/README.md](../tickets/README.md) is the board |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Branch model: Work branches → pull request to `dev` → `main` |
| [GLOSSARY.md](../GLOSSARY.md) | The words, for the CLI and the app |

## Stack

- Tauri: Rust core, system webview
- React, Vite and TypeScript (strict)
- xterm.js with the WebGL renderer
- roster (Python) as the backend, reached through `roster serve`

## Development

### Two builds

| | Dev build | Release build |
|---|---|---|
| Command | `app/scripts/app-dev.sh` (`--ci` the first time) | `app/scripts/app-build.sh --run` (`--installer` for the setup .exe/.msi) |
| For | working on the app: hot reload, devtools, the worst-case/fixture toggle (only with `?fixture=` or `VITE_ROSTER_APP_FIXTURES=1`) | using it day to day: optimised, no dev code, no fixtures, no fake backend |
| Windows copy | `%LOCALAPPDATA%\roster-app-dev` | `%LOCALAPPDATA%\roster-app-release` |
| Stop | `app/scripts/app-stop.sh` | `app/scripts/app-stop.sh --release` (or just close the window) |

Both use the installed `roster` (needs `roster serve`, API 3+) unless `ROSTER_APP_ROSTER` is set, and both share the same State and `init.lua`. The scripts and the app still read the old `ROSTER_DESK_*` env var names when the new ones aren't set.

Paths below are from the repo root.

```
Cargo.toml            workspace (repo root); default member is roster-core, so `cargo test` in WSL never builds Tauri
crates/roster-core/   Tauri-free core: Backend detection (detect.rs), `roster serve` JSON-RPC client (rpc.rs),
                      start-up and API-version check (backend.rs), the one Backend slot (slot.rs), error kinds (error.rs), Sessions:
                      session.prepare → command (wsl --exec …, env via WSLENV) and the PTY manager (session.rs),
                      the State file (state.rs), where the window reopens (window.rs), the Windows build (platform.rs),
                      the ROSTER_APP_* env vars with their old names (env.rs), the one-time copy from roster-desk (migrate.rs)
app/src-tauri/        thin Tauri shell: window + commands backend_connect, hosts_list, host_get,
                      session_open/write/resize/close (output over an ipc Channel as raw bytes),
                      state_load/state_save, platform_info, vault_status/unlock/lock, config_load, config_open,
                      config_reload, inventory_pull, host_verify_login, host_update, changes_diff, changes_discard,
                      changes_publish
                      (+ `config-changed` events after each save of init.lua);
                      clipboard-manager plugin
app/src/backend/      the one typed Backend client: types.ts (interface), tauri.ts (real), fake.ts (fixtures)
app/src/picker/       the Picker: match.ts (fuzzy ranking), Picker.tsx
app/src/platform/     State file, clipboard, Windows build: types.ts, tauri.ts, browser.ts, memory.ts (tests)
app/src/state/        appState.ts: the State's shape (recent Hosts), parsed leniently
app/src/session/      Sessions: tabs.ts (store: open/close/select/reconnect/replay/resize, outside React), Sessions.tsx
                      (terminal panes + the basic tab strip for `sessions = "tabs"`)
app/src/terminal/     TerminalView.tsx (xterm.js, WebGL → DOM; copy/paste, find, zoom), SearchBar.tsx,
                      options.ts (font, colour overrides, standard ANSI palette as data), keymap.ts (ticket 08's keys),
                      keys.ts (Leader filter), StubTerminal (tests)
app/src/errors/       clean connection errors (ticket 26, docs/app/errors.md): classify.ts (classifyExit: ssh's last lines +
                      exit code + askpass line → a Problem), catalog.ts (the rows as a Registry: where, fix, actions,
                      extras), ErrorPanel.tsx (the Session pane's error), CheckPanel.tsx (`:check HOST`)
app/src/edit/         editing a Host (ticket 10): form.ts (the draft, what changed, whether it needs a test login),
                      EditPanel.tsx (`:edit`: pull, the form, test login, save), ChangesPanel.tsx (`:changes`: the diff,
                      `:discard`, `:publish`: the message, the commit's hash)
app/src/lock/         the Lock: useVault.ts (lock state, idle lock), idle.ts (idle timer, injectable Clock), LockScreen.tsx
crates/roster-core/src/config/
                      the Lua Config (ticket 21, docs/app/config.md): schema.rs (every option and default), lua.rs
                      (sandboxed Lua 5.4, `require` in the config dir, the `roster` table), locate.rs (file:line
                      for schema errors), watch.rs (live reload), editor.rs (`:config`: the commented-out
                      starter file, made once, and opening it in the `editor`), mod.rs (load, Loader
                      keeping the last good one)
app/src/config/       the Config in the frontend: types.ts (the core's object), apply.ts (→ options, and keys,
                      Themes, Folders through the registries as "init.lua"), ConfigToast.tsx (errors, warnings)
examples/init.lua     every option with its default, commented (a Rust test loads it)
app/src/registry.ts   Registry: entries by id with a source (builtin/init.lua/Plugin), ADR 0006; registries.ts = the app's set
app/src/commands/     table.ts: the ONE command table (`:` names; keys, the command line and buttons all run these)
app/src/keymap.ts     keys → command lines, as a registry of bindings; Options (Leader, vim, layout, idle lock)
app/src/keyboard/     mode.ts (Terminal mode / App mode machine, key sequences), bindings.ts + BindingsPanel (␣ ?)
app/src/sidebar/      Sidebar.tsx (sections of rows, raised row, cursor), sections.ts (section registry, Sessions)
app/src/cmdline/      CommandLine.tsx (␣ :, Tab completion from the command table and Host names)
app/src/theme/        Themes (ticket 09): theme.ts (the colour-token set, AppearanceOptions, terminal colours), themes.ts
                      (Roster dark/light, Gruvbox Dark, Nord, Catppuccin Mocha, Tokyo Night as a registry; docs/app/themes.md),
                      useTheme.ts (tokens → CSS variables, follows the OS), picker.ts (`:theme` and the `themes` finder,
                      ticket 30), contrast.ts (WCAG ratios and OKLab ΔE for the contrast test)
app/src/chrome/       TitleBar.tsx (frameless window's bar: mark, minimize/maximize/close), Logo.tsx (the Gap orbit mark in Theme colours)
app/src/ui/           Keys.tsx (keycaps for every key hint), StateDot.tsx (state nodes: shape + words), CloseGlyph.tsx
app/src/styles.css    the whole look, written only against Theme tokens (no colour literals); styles.test.ts lints it
                      (no text in `--faint` or `--tone`, nothing under 11 px, :hover only for a real pointer)
app/assets/           logo.svg (Gap orbit app icon master) + logo-small.svg (16–32 px cut), logo-mark*.svg (no tile), logo-mono*.svg (one colour); `npm run icons` renders src-tauri/icons
docs/app/design/      taste.md, the interface review, Theme screenshots (themes/, made from the fake Backend)
app/src/App.tsx       connect → error screen, Lock gate, Standard layout; routes keys through mode.ts to commands
app/scripts/app-*.sh  Windows build loop from WSL (sync, tauri dev, stop)
```

**Checks** (run all before a commit):

```bash
cd app && npm ci       # once, in WSL
npm run check          # in app/: tsc --noEmit + eslint + Vitest (UI tests use the fake Backend)
cargo test             # at the root: roster-core only (WSL can't build app/src-tauri: no webkit2gtk)
cargo clippy -p roster-core --all-targets -- -D warnings && cargo fmt --check
```

Separately: `npm run typecheck`, `npm run lint`, `npm test`.

**UI in a plain browser** (fake Backend, no Tauri): in `app/`, `npm run dev -- --port 5179`, then open
`http://localhost:5179/?fixture=many-hosts`. Other fixtures: `few-hosts`, `slow`, `roster-too-old`,
`roster-missing`, `inventory-missing`, `no-wsl`. The app opens locked: the fake master password is
`correct horse`. `&theme=roster-light|gruvbox|nord|catppuccin-mocha|tokyo-night` picks a Theme (default: follow the OS). Vault fixtures: `locked` (the default), `not-logged-in`, `missing-cli`, `no-vault` (no lock screen). Sign-in fixtures (ticket 31; email `you@example.com`, codes `123456`, API key `user.fake-client` / `fake-client-secret`): `sign-in` (new-device code), `sign-in-2fa` (method picker), `sign-in-totp`, `sign-in-fido2` (unsupported), `sign-in-sso`, `sign-in-eu`, `sign-in-rate-limited`. Editing (ticket 10, API 5): `edit`, `edit-pending` (two Pending changes), `edit-diverged` (the pull fails).
Worst case (ticket 27): `worst-case` (1,284 Hosts, 50 Sessions, 100 Folders, long, odd and missing values),
`worst-case-empty`, `worst-case-one`, `worst-case-start`, `worst-case-vault`; a dev build shows a
"Demo data / Worst case" toggle at the bottom to switch between them (`&toggle=off` hides it; it works in
`tauri dev` too, and never ships).

**The real app on Windows** (from the WSL checkout; see `docs/app/dev/windows-build-loop.md`):

```bash
app/scripts/app-dev.sh --ci     # sync to %LOCALAPPDATA%\roster-app-dev\src, npm ci in src\app, tauri dev (opens the window)
app/scripts/app-dev.sh      # later runs; edits need only app/scripts/app-sync.sh (Vite HMR / cargo rebuild)
app/scripts/app-stop.sh     # stop node, the tauri CLI and the app (killing the WSL job leaves them running)
```

Parallel worktrees each get their own Windows copy with `ROSTER_APP_WIN_DIR=roster-app-dev-NN` (default
`roster-app-dev`) on all three scripts; only one `tauri dev` can hold port 1420 at a time, so give the others
`ROSTER_APP_WIN_PORT=14NN`. Two app windows at once also need separate WebView2 profiles, or the second fails
with WebView2 error 0x8007139F: `export WEBVIEW2_USER_DATA_FOLDER='C:\Users\you\AppData\Local\roster-app-dev-NN\webview2'
WSLENV=WEBVIEW2_USER_DATA_FOLDER` before `app/scripts/app-dev.sh`.

**Which roster runs.** On Windows the app probes the default WSL distro first, then only distros that are
already Running (`wsl -l -v`); it never starts a stopped non-default distro, because booting one can break WSL
interop for every distro (OracleLinux_9's systemd-binfmt removed `WSLInterop`, see `docs/app/dev/tauri-pty-wsl.md`).
To use a stopped distro, set `ROSTER_APP_WSL_DISTRO=<name>`: only that distro is probed, and started if needed
(`app/scripts/app-dev.sh` passes it through `WSLENV`). Each probe runs `bash -lc` to find
roster's absolute path (`~/.local/bin` added) and a `roster.yml` (`$ROSTER_CONFIG`, `~/roster.yml`,
`~/.config/roster/roster.yml`, `~/infra/roster.yml`), then starts
`wsl.exe -d <distro> --cd ~ --exec /usr/bin/env PATH=<login PATH> <roster> -c <roster.yml> serve` with no console window (the login PATH so roster finds `bw` in `~/.local/bin`). On Linux it starts
roster locally the same way. To use another roster command, set `roster_command` in `init.lua`
(docs/app/config.md), or `ROSTER_APP_ROSTER`, split on spaces, which wins over it (as `ROSTER_APP_WSL_DISTRO`
wins over `backend = "wsl:<distro>"`):

```bash
ROSTER_APP_ROSTER="uv run --project /home/you/work/roster roster" app/scripts/app-dev.sh
```

You need this while your installed roster predates `roster serve`: the app then shows "roster is too old".
`cargo run --example detect` (in WSL, or on Windows via cmd.exe) prints what detection finds without the UI.
