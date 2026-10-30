# Architecture

Decisions: ADR 0001 (`roster serve`), ADR 0002 (system ssh and askpass), ADR 0003 (Tauri).

## Processes

```
┌──────────────── roster app (Tauri) ──────────────────┐
│  Frontend (React + TS, xterm.js)                     │
│     │  one typed client: backend calls, Session I/O  │
│  Rust core                                           │
│   ├─ backend runner ── stdin/stdout JSON-RPC ──┐     │
│   ├─ session manager ── PTY per Session ──┐    │     │
│   └─ idle-lock timer, Config (init.lua)   │    │     │
└───────────────────────────────────────────┼────┼─────┘
              (on the WSL backend, both run through wsl.exe)
                                            │    │
              ssh HOST  ◄─ SSH_ASKPASS ─────┘    ▼
                 │        roster askpass ──► roster serve (Python)
                 │          (one-time token,      ├─ Inventory (~/infra/roster.yml)
                 ▼           private socket)      └─ vault provider (bw, op, pass…)
               Host
```

- **roster serve** is the only thing that reads the Inventory or touches secrets. There is one per app launch, and it exits when stdin closes.
- **The Rust core** manages processes and PTYs. It never holds a password.
- **The frontend** draws everything. It holds no secrets: the master password field clears once the unlock call returns.

## The `roster serve` API

JSON-RPC 2.0, one JSON object per line on stdin/stdout. Logging goes to stderr. Results are roster's existing Host, group and resource objects. Logins come back as references (`bw:esxi-02 ssh+web`), never as values. The API has a version number, and the app refuses a roster that's too old.

| Method | Iteration | Purpose |
|---|---|---|
| `inventory.info` | 1 | Path, Box, host count, providers, versions |
| `hosts.list`, `host.get` | 1 | Read Hosts and groups |
| `vault.status`, `vault.unlock`, `vault.lock` | 1 | Lock screen and Lock |
| `session.prepare` | 1 | ssh command and environment for a Host (plus an askpass token for password Logins) |
| `inventory.pull`, `host.update`, `host.add`, `host.review` | 3 | Inventory writes, keeping comments |
| `changes.diff`, `changes.discard`, `changes.publish` | 3 | Pending changes and Publish |
| `vault.create_item` | 4 | Bitwarden only |
| `quick.prepare`, `quick.save` | 4 | Quick Connect and "Save to vault" |

## How a Session connects

1. The frontend asks for a Session to a Host. The core calls `session.prepare`.
2. `serve` checks the Host is reviewed:
   - **Key-enrolled Host:** returns `ssh -o BatchMode=yes HOST`.
   - **Password Login:** creates a one-time token, valid for 60 seconds, used once, and cleared on lock. It returns `ssh` with `SSH_ASKPASS=roster askpass`, `SSH_ASKPASS_REQUIRE=force`, `NumberOfPasswordPrompts=1` and the token in the environment.
3. The core starts that command in a PTY (ConPTY on Windows), wrapped in `wsl.exe -d <distro> --` on the WSL backend.
4. If `ssh` asks for a password, it runs `roster askpass`. The helper sends the token over serve's private socket and prints the password. It refuses every other kind of prompt, such as host-key questions.

The askpass socket is the one deliberate exception to stdio-only. If it grows beyond that, write a new ADR.

## Backends

| Mode | App runs on | roster and ssh run on |
|---|---|---|
| WSL: <distro> | Windows | the WSL distro (auto-detected when roster and `~/infra` are there) |
| Local | Windows | Windows (iteration 6: roster ported, built-in OpenSSH, named-pipe askpass) |
| Local | Linux (X11, Wayland, WSLg) | Linux |

## Config (`init.lua`)

This follows WezTerm's model (ADR 0004):
- `~/.config/roster/init.lua` (`%APPDATA%\roster\init.lua` on Windows) returns a table, and the Rust core runs it with mlua (Lua 5.4 built in).
- It's layered: built-in defaults, then `init.lua`. There's no Settings screen.
- Saving the file reloads it. An error shows a toast with the file and line, and the last good Config stays active.
- The core checks the result against a schema and sends a plain typed object to the frontend, which never runs Lua.
- **v1 covers values only:** fonts, colors and theme tokens, Themes, leader key, keymap (key → action name), vim on/off, per-mode layout, Folders, idle timeout, backend, roster command. Every option, the sandbox and the small `roster` table are in [config.md](config.md); the code is `crates/roster-core/src/config/` and `app/src/config/`.
- **Later:** event hooks (`on_session_open`), custom `:` commands, and extra Picker sources.
- **State** (window size, recent Hosts, open panels) is saved separately by the app and never put in `init.lua`.

## Inventory writes

Writes edit `roster.yml` text in place, keeping comments, the same way `discover --write` does. Each one is checked by loading it and keeps a `.bak`. Pending changes are the uncommitted diff in `~/infra`. Publish commits and pushes to `main`, refuses a non-fast-forward, then runs `roster sync`.
