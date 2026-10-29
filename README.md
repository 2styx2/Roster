# roster-desk

A fast, keyboard-first desktop app that gets you into a terminal on any Host in your team's roster Inventory in a few keystrokes. [roster](../roster) is the only backend: it knows the Hosts and the Logins. roster-desk is the nicest way to reach them.

> Status: **iteration 1 in progress.** The app starts, finds roster in WSL and has a Host Picker; Sessions come next. It's a personal project first, local only, with no remote.

## Where to look

| Path | What's in it |
|---|---|
| [docs/vision.md](docs/vision.md) | Why this exists, how it compares with SecureCRT, Termius, Tabby and XPipe, and what makes it different |
| [docs/architecture.md](docs/architecture.md) | The processes, the `roster serve` API, how Sessions connect, and the backends |
| [docs/security.md](docs/security.md) | Where secrets go and where they never go, and how locking works |
| [docs/keyboard.md](docs/keyboard.md) | The leader key, the two focus modes, and the default bindings |
| [docs/roadmap.md](docs/roadmap.md) | The iterations and what "done" means for each |
| [docs/dev/](docs/dev/) | Researched, tested notes: Windows build loop from WSL, PTY and wsl.exe, xterm.js setup, test layout |
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
                      start-up and API-version check (backend.rs), error kinds (error.rs), Sessions:
                      session.prepare → command (wsl --exec env K=V …) and the PTY manager (session.rs)
src-tauri/            thin Tauri shell: window + commands backend_connect, hosts_list, host_get,
                      session_open/write/resize/close (output over an ipc Channel as raw bytes)
src/backend/          the one typed Backend client: types.ts (interface), tauri.ts (real), fake.ts (fixtures)
src/picker/           the Picker: match.ts (fuzzy ranking), Picker.tsx
src/session/          Session tabs: tabs.ts (store: open/close/replay/resize, outside React), Sessions.tsx
src/terminal/         TerminalView.tsx (xterm.js, WebGL → DOM), keys.ts (Leader filter), StubTerminal (tests)
src/App.tsx           connect → error screen or empty state; Leader handling. keymap.ts = keys/options as data
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
`roster-missing`, `inventory-missing`, `no-wsl`.

**The real app on Windows** (from the WSL checkout; see `docs/dev/windows-build-loop.md`):

```bash
scripts/win-dev.sh --ci     # sync to %LOCALAPPDATA%\roster-desk-dev\src, npm ci, tauri dev (opens the window)
scripts/win-dev.sh          # later runs; edits need only scripts/win-sync.sh (Vite HMR / cargo rebuild)
scripts/win-stop.sh         # stop node, the tauri CLI and the app (killing the WSL job leaves them running)
```

Parallel worktrees each get their own Windows copy with `ROSTER_DESK_WIN_DIR=roster-desk-dev-NN` (default
`roster-desk-dev`) on all three scripts; only one `tauri dev` can hold port 1420 at a time.

**Which roster runs.** On Windows the app probes the default WSL distro first, then only distros that are
already Running (`wsl -l -v`); it never starts a stopped non-default distro, because booting one can break WSL
interop for every distro (OracleLinux_9's systemd-binfmt removed `WSLInterop`, see `docs/dev/tauri-pty-wsl.md`).
To use a stopped distro, set `ROSTER_DESK_WSL_DISTRO=<name>`: only that distro is probed, and started if needed
(`scripts/win-dev.sh` passes it through `WSLENV`). Each probe runs `bash -lc` to find
roster's absolute path (`~/.local/bin` added) and a `roster.yml` (`$ROSTER_CONFIG`, `~/roster.yml`,
`~/.config/roster/roster.yml`, `~/infra/roster.yml`), then starts
`wsl.exe -d <distro> --cd ~ --exec <roster> -c <roster.yml> serve` with no console window. On Linux it starts
roster locally the same way. To use another roster command (until the Lua Config, ticket 21), set
`ROSTER_DESK_ROSTER`, split on spaces:

```bash
ROSTER_DESK_ROSTER="uv run --project /home/you/work/roster roster" scripts/win-dev.sh
```

You need this while your installed roster predates `roster serve`: the app then shows "roster is too old".
`cargo run --example detect` (in WSL, or on Windows via cmd.exe) prints what detection finds without the UI.
