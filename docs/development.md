# Development

```bash
uv sync                  # creates .venv with dev tools
uv run pytest            # no network or SSH server needed
uv run ruff check src tests
uv build                 # wheel + sdist in dist/
```

The tests use stand-in `bw`, `op`, `pass` and `ssh` commands from `tests/fakes/` (the `bw` one also creates and deletes items like `bw create item` / `bw delete item`, and signs in like `bw login`: prompts on its terminal, every two-step method, new-device codes, API key, SSO through `xdg-open`) (the `ssh` one asks `SSH_ASKPASS` for a password as real ssh does), and a local paramiko server for `roster check HOST`'s port and host-key steps, and give each test its own temporary HOME, so they never touch your real `~/.ssh` or vaults.

```
src/roster/
  cli.py            commands and argument parsing
  config.py         loading/validating roster.yml, search, --only
  example.py        the `roster init` template
  sshops.py         keys, fingerprints, ssh config, key install/removal, password logins
  resources.py      Wi-Fi networks, accounts and secrets with no address: the field schema per type
  claude.py         ROSTER.md, CLAUDE.md import, .claude/settings.json
  discover.py       nmap / built-in scanning, type guessing, merging into roster.yml
  serve.py          `roster serve`: JSON-RPC API for the desktop app, method table, the roster.yml watcher (inventory.changed)
  edit.py           editing one Host in roster.yml as text, adding, removing, renaming or moving one, and groups (comments and other entries kept), checked before it's written
  changes.py        Pending changes: the infra repo's git (pull fast-forward only, roster.yml's diff, discard, the .bak, publish)
  errors.py         the stable error codes and Problem (code, message, fix): what serve, askpass and check report
  diagnose.py       a Host's Login checked before ssh runs, `roster check HOST` / host.check's steps, host.verify_login, host.scan_key
  askpass.py        the askpass channel: serve's socket + one-time tokens, the `roster askpass` helper (stdlib only)
  providers/        password providers: registry + plugins + templates, builtin, bitwarden, onepassword,
                    keepassxc (a local .kdbx through keepassxc-cli);
                    bw_login: `bw login` driven a step at a time on a PTY (serve's vault.login)
examples/           commented roster.yml, plugin template
docs/               team guides: setting up a new box, adding hosts; docs/app/ for the app, docs/adr/ for decisions
tests/              pytest suite + fake password-manager CLIs
app/                the roster app (frontend + app/src-tauri); its Rust core is crates/roster-core (app/README.md)
```

The app's checks are in [app/README.md](../app/README.md#development) (`npm run check` in `app/`, `cargo test` at the root). CI runs both halves on every pull request (`.github/workflows/ci.yml`); [CONTRIBUTING.md](../CONTRIBUTING.md) has the branch model.

## Trying it safely

- `roster setup --dry-run` shows which hosts would get a key without touching them.
- `--only` lets you start with one host or group.
- `roster revoke` undoes `setup`.
- To experiment without real servers, run an SSH server in a container (for example the `linuxserver/openssh-server` image with password auth enabled), point a `roster.yml` at it, and run the full flow.
