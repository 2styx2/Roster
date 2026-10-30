# roster-desk

A fast, keyboard-first desktop app that gets you into a terminal on any Host in your team's roster Inventory in a few keystrokes. [roster](../roster) is the only backend: it knows the Hosts and the Logins. roster-desk is the nicest way to reach them.

> Status: **iteration 1 in progress.** The app starts, finds roster in WSL and has a Host Picker; Sessions come next. It's a personal project first, local only, with no remote.

## Where to look

| Path | What's in it |
|---|---|
| [docs/vision.md](docs/vision.md) | Why this exists, how it compares with SecureCRT, Termius, Tabby and XPipe, and what makes it different |
| [docs/competitors.md](docs/competitors.md) | Sourced competitor analysis (XPipe, Termix, Termius, RDM, Tabby, WezTerm and more): matrix, config and plugins, secrets model, positioning |
| [docs/architecture.md](docs/architecture.md) | The processes, the `roster serve` API, how Sessions connect, and the backends |
| [docs/security.md](docs/security.md) | Where secrets go and where they never go, and how locking works |
| [docs/keyboard.md](docs/keyboard.md) | The leader key, the two focus modes, and the default bindings |
| [docs/roadmap.md](docs/roadmap.md) | The iterations and what "done" means for each |
| [docs/dev/](docs/dev/) | Researched, tested notes: Windows build loop from WSL, PTY and wsl.exe, xterm.js setup, test layout |
| [docs/errors.md](docs/errors.md) | Every way a connection can fail, with its message and fix |
| [docs/design/taste.md](docs/design/taste.md) | roster's own design identity: what makes it look and feel like ours |
| [docs/decisions.md](docs/decisions.md) | Every design question we asked (Q1–Q22) and the answer |
| [docs/adr/](docs/adr/) | Architecture decisions for roster-desk. roster's own ADRs live in `../roster/docs/adr/` |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Branch model: Work branches → `dev` → `main`, the same as roster and Orion |
| [GLOSSARY.md](GLOSSARY.md) | roster-desk terms. Shared terms (Host, Session, Login…) live in roster's `GLOSSARY.md` |
| [spec/](spec/) | Product specs. Start with [0001](spec/0001-roster-desk.md) |
| [tickets/](tickets/) | Vertical-slice tickets with their blockers. [tickets/README.md](tickets/README.md) is the board |

## Stack

- Tauri: Rust core, system webview
- React, Vite and TypeScript (strict)
- xterm.js with the WebGL renderer
- roster (Python) as the backend, reached through `roster serve`

## Development

```
Cargo.toml            workspace; default member is desk-core, so `cargo test` in WSL never builds Tauri
crates/desk-core/     Tauri-free core: Backend detection (detect.rs), `roster serve` JSON-RPC client (rpc.rs),
                      start-up and API-version check (backend.rs), the one Backend slot (slot.rs), error kinds (error.rs), Sessions:
                      session.prepare → command (wsl --exec …, env via WSLENV) and the PTY manager (session.rs),
                      the State file (state.rs), where the window reopens (window.rs), the Windows build (platform.rs)
src-tauri/            thin Tauri shell: window + commands backend_connect, hosts_list, host_get,
                      session_open/write/resize/close (output over an ipc Channel as raw bytes),
                      state_load/state_save, platform_info, vault_status/unlock/lock, config_load
                      (+ `config-changed` events after each save of init.lua);
                      clipboard-manager plugin
src/backend/          the one typed Backend client: types.ts (interface), tauri.ts (real), fake.ts (fixtures)
src/picker/           the Picker: match.ts (fuzzy ranking), Picker.tsx
src/platform/         State file, clipboard, Windows build: types.ts, tauri.ts, browser.ts, memory.ts (tests)
src/state/            appState.ts: the State's shape (recent Hosts), parsed leniently
src/session/          Sessions: tabs.ts (store: open/close/select/reconnect/replay/resize, outside React), Sessions.tsx
                      (terminal panes + the basic tab strip for `sessions = "tabs"`)
src/terminal/         TerminalView.tsx (xterm.js, WebGL → DOM; copy/paste, find, zoom), SearchBar.tsx,
                      options.ts (font, colour overrides, standard ANSI palette as data), keymap.ts (ticket 08's keys),
                      keys.ts (Leader filter), StubTerminal (tests)
src/errors/           clean connection errors (ticket 26, docs/errors.md): classify.ts (classifyExit: ssh's last lines +
                      exit code + askpass line → a Problem), catalog.ts (the rows as a Registry: where, fix, actions,
                      extras), ErrorPanel.tsx (the Session pane's error), CheckPanel.tsx (`:check HOST`)
src/lock/             the Lock: useVault.ts (lock state, idle lock), idle.ts (idle timer, injectable Clock), LockScreen.tsx
crates/desk-core/src/config/
                      the Lua Config (ticket 21, docs/config.md): schema.rs (every option and default), lua.rs
                      (sandboxed Lua 5.4, `require` in the config dir, the `roster` table), locate.rs (file:line
                      for schema errors), watch.rs (live reload), mod.rs (load, Loader keeping the last good one)
src/config/           the Config in the frontend: types.ts (the core's object), apply.ts (→ options, and keys,
                      Themes, Folders through the registries as "init.lua"), ConfigToast.tsx (errors, warnings)
examples/init.lua     every option with its default, commented (a Rust test loads it)
src/registry.ts       Registry: entries by id with a source (builtin/init.lua/Plugin), ADR 0004; registries.ts = the app's set
src/commands/         table.ts: the ONE command table (`:` names; keys, the command line and buttons all run these)
src/keymap.ts         keys → command lines, as a registry of bindings; Options (Leader, vim, layout, idle lock)
src/keyboard/         mode.ts (Terminal mode / App mode machine, key sequences), bindings.ts + BindingsPanel (␣ ?)
src/sidebar/          Sidebar.tsx (sections of rows, raised row, cursor), sections.ts (section registry, Sessions)
src/cmdline/          CommandLine.tsx (␣ :, Tab completion from the command table and Host names)
src/theme/            Themes (ticket 09): theme.ts (the colour-token set, AppearanceOptions, terminal colours), themes.ts
                      (Roster dark/light, Gruvbox Dark, Nord, Catppuccin Mocha, Tokyo Night as a registry; docs/themes.md),
                      useTheme.ts (tokens → CSS variables, follows the OS), picker.ts (`:theme` and the `themes` finder,
                      ticket 30), contrast.ts (WCAG ratios for the contrast test)
src/chrome/           TitleBar.tsx (frameless window's bar: mark, minimize/maximize/close), Logo.tsx (mark D1 in Theme colours)
src/ui/               Keys.tsx (keycaps for every key hint), StateDot.tsx (state nodes: shape + words), CloseGlyph.tsx
src/styles.css        the whole look, written only against Theme tokens (no colour literals); styles.test.ts lints it
                      (no text in `--faint`, nothing under 11 px, :hover only for a real pointer)
assets/               logo.svg (D1 master) + logo-small.svg (16–32 px cut); `npm run icons` renders src-tauri/icons
docs/design/          screenshots for the design review (dark, light, Gruvbox, Nord)
src/App.tsx           connect → error screen, Lock gate, Standard layout; routes keys through mode.ts to commands
scripts/win-*.sh      Windows build loop from WSL (sync, tauri dev, stop)
```

**Checks** (run all before a commit):

```bash
npm ci                 # once, in WSL
npm run check          # tsc --noEmit + eslint + Vitest (UI tests use the fake Backend)
cargo test             # desk-core only (WSL can't build src-tauri: no webkit2gtk)
```

Separately: `npm run typecheck`, `npm run lint`, `npm test`.

**UI in a plain browser** (fake Backend, no Tauri): `npm run dev -- --port 5179`, then open
`http://localhost:5179/?fixture=many-hosts`. Other fixtures: `few-hosts`, `slow`, `roster-too-old`,
`roster-missing`, `inventory-missing`, `no-wsl`. The app opens locked: the fake master password is
`correct horse`. `&theme=roster-light|gruvbox|nord|catppuccin-mocha|tokyo-night` picks a Theme (default: follow the OS). Vault fixtures: `locked` (the default), `not-logged-in`, `missing-cli`, `no-vault` (no lock screen). Sign-in fixtures (ticket 31; email `you@example.com`, codes `123456`, API key `user.fake-client` / `fake-client-secret`): `sign-in` (new-device code), `sign-in-2fa` (method picker), `sign-in-totp`, `sign-in-fido2` (unsupported), `sign-in-sso`, `sign-in-eu`, `sign-in-rate-limited`.
Worst case (ticket 27): `worst-case` (1,284 Hosts, 50 Sessions, 100 Folders, long, odd and missing values),
`worst-case-empty`, `worst-case-one`, `worst-case-start`, `worst-case-vault`; a dev build shows a
"Demo data / Worst case" toggle at the bottom to switch between them (`&toggle=off` hides it; it works in
`tauri dev` too, and never ships). Screenshots: `docs/design/break-ui/`.

**The real app on Windows** (from the WSL checkout; see `docs/dev/windows-build-loop.md`):

```bash
scripts/win-dev.sh --ci     # sync to %LOCALAPPDATA%\roster-desk-dev\src, npm ci, tauri dev (opens the window)
scripts/win-dev.sh          # later runs; edits need only scripts/win-sync.sh (Vite HMR / cargo rebuild)
scripts/win-stop.sh         # stop node, the tauri CLI and the app (killing the WSL job leaves them running)
```

Parallel worktrees each get their own Windows copy with `ROSTER_DESK_WIN_DIR=roster-desk-dev-NN` (default
`roster-desk-dev`) on all three scripts; only one `tauri dev` can hold port 1420 at a time, so give the others
`ROSTER_DESK_WIN_PORT=14NN`. Two app windows at once also need separate WebView2 profiles, or the second fails
with WebView2 error 0x8007139F: `export WEBVIEW2_USER_DATA_FOLDER='C:\Users\you\AppData\Local\roster-desk-dev-NN\webview2'
WSLENV=WEBVIEW2_USER_DATA_FOLDER` before `scripts/win-dev.sh`.

**Which roster runs.** On Windows the app probes the default WSL distro first, then only distros that are
already Running (`wsl -l -v`); it never starts a stopped non-default distro, because booting one can break WSL
interop for every distro (OracleLinux_9's systemd-binfmt removed `WSLInterop`, see `docs/dev/tauri-pty-wsl.md`).
To use a stopped distro, set `ROSTER_DESK_WSL_DISTRO=<name>`: only that distro is probed, and started if needed
(`scripts/win-dev.sh` passes it through `WSLENV`). Each probe runs `bash -lc` to find
roster's absolute path (`~/.local/bin` added) and a `roster.yml` (`$ROSTER_CONFIG`, `~/roster.yml`,
`~/.config/roster/roster.yml`, `~/infra/roster.yml`), then starts
`wsl.exe -d <distro> --cd ~ --exec /usr/bin/env PATH=<login PATH> <roster> -c <roster.yml> serve` with no console window (the login PATH so roster finds `bw` in `~/.local/bin`). On Linux it starts
roster locally the same way. To use another roster command, set `roster_command` in `init.lua`
(docs/config.md), or `ROSTER_DESK_ROSTER`, split on spaces, which wins over it (as `ROSTER_DESK_WSL_DISTRO`
wins over `backend = "wsl:<distro>"`):

```bash
ROSTER_DESK_ROSTER="uv run --project /home/you/work/roster roster" scripts/win-dev.sh
```

You need this while your installed roster predates `roster serve`: the app then shows "roster is too old".
`cargo run --example detect` (in WSL, or on Windows via cmd.exe) prints what detection finds without the UI.
