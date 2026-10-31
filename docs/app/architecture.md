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
| `quick.prepare`, `quick.save` | 4 | Quick Connect (ticket 14, API 12: `quick.prepare`) and "Save to vault" (ticket 15) |
| `host.scan_key {host}`, `host.trust_key` | 4 | Ask before trusting a Host's new host key (ticket 36, API 11) |

## How a Session connects

1. The frontend asks for a Session to a Host. The core calls `session.prepare`.
2. `serve` checks the Host is reviewed, its Login, and that its host key is recorded. With no key recorded it refuses with 44, and the app asks first (ticket 36): `host.scan_key` fetches the key, the connect card shows its type and fingerprint, and Trust runs `host.trust_key` (which fetches it again and records it only if it's unchanged) and then step 1 again; Cancel records nothing. The command always has `-o StrictHostKeyChecking=yes`, so ssh never trusts a key on its own:
   - **Key-enrolled Host:** returns `ssh -o StrictHostKeyChecking=yes -o BatchMode=yes HOST`.
   - **Password Login:** creates a one-time token, valid for 60 seconds, used once, and cleared on lock. It returns `ssh` with `SSH_ASKPASS=roster askpass`, `SSH_ASKPASS_REQUIRE=force`, `NumberOfPasswordPrompts=1` and the token in the environment.
3. The core starts that command in a PTY (ConPTY on Windows), wrapped in `wsl.exe -d <distro> --` on the WSL backend.
4. If `ssh` asks for a password, it runs `roster askpass`. The helper sends the token over serve's private socket and prints the password. It refuses every other kind of prompt, such as host-key questions.

The askpass socket (on native Windows, a named pipe only the user can open) is the one deliberate exception to stdio-only. If it grows beyond that, write a new ADR.


## How a Quick Connect connects (ticket 14)

1. The user types `user@address[:port]` in the Picker (offered as the first row), after `:connect` or `:quick`, or from the toolbar's Quick Connect control. The app parses it (`app/src/quick/target.ts`), with the same rules as serve: nothing ssh could read as an option.
2. The tab asks first: `host.scan_key {address, port}` fetches the key (key exchange only), and the connect card shows its type and fingerprint with a masked password field. A key that differs from one roster recorded for the address is refused (43), never asked about. Cancel (Esc) connects nothing.
3. Enter sends the confirmed fingerprint and the password (or none: this Box's keys) through the core's `quick_session_open` to `quick.prepare`. serve fetches the key again (23 if it's not the one shown), writes it under a one-off alias to its own known-hosts file, mints an askpass token for the password, and returns `ssh -o StrictHostKeyChecking=yes -o UserKnownHostsFile=<serve's file> -o HostKeyAlias=roster-quick-<id> … -p PORT -l USER -- ADDRESS`. Then the PTY starts as in step 3 above.
4. The result's `quick` id stays on the tab. A reconnect asks again, key and password; nothing about the box is kept between Sessions.
5. With "Save to vault" ticked (ticket 15, API 13), `quick.prepare` gets `save: true`: serve holds the password under `held` and ssh gets a `LocalCommand` that tells serve once it has logged in. serve's `session.logged_in` notification reaches the frontend through the `roster-notification` event; the tab then offers the save, and `:save` (or the offer's button) opens the side panel, which pulls in the background when the last pull is stale (decision Q88), waits for that pull on Save, and calls `quick.save` with the id, the Host's name, its group and the Save to choice. The tab tells serve to forget the password (`vault.forget_typed`) when its Session ends unsaved or the offer is turned down (decision Q68). A Host whose Login is `auth: prompt` (ticket 16) goes the same way: `session.prepare` answers 39, the connect card asks for the password (with the same tick), `session.prepare {host, password, save}` opens the Session, and the save is `host.save_login`, which points the Host's Login at the new item.

## Backends

| Mode | App runs on | roster and ssh run on |
|---|---|---|
| WSL: <distro> | Windows | the WSL distro (auto-detected when roster and `~/infra` are there) |
| Local | Windows | Windows itself: roster installed with `uv tool install`, Windows' built-in OpenSSH, askpass over a named pipe (ticket 19) |
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
