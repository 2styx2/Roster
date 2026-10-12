# Roster

**Your password manager knows the secrets. Roster knows your network: every host, what it is, how to reach it, and which login goes with which service.**

A password manager holds an item like `ESXI web`, but it doesn't know that the item opens both SSH and the SOAP API on one ESXi host. It doesn't know that two boxes with the same web title are different machines, or that one address is really a second interface of a box you already have. It doesn't know that the core switch only takes a password over SSH. That knowledge usually lives in someone's head, a stale wiki page, or a dozen `~/.ssh/config` files that all differ.

Roster keeps it in one file, `roster.yml`:

- **Hosts and what they are:** name, address, type, product, title, description.
- **How to reach them:** SSH port and user, whether the box takes a key or only a password, web UIs and other services.
- **Which login goes where:** each host's default login, plus SSH-only or per-service overrides. These point at password-manager items (`bw:ESXI web`, `op:Network gear`) and never contain a password.

From that one file, any box (a laptop, a jump host, a box where Claude runs) gets the same access:

```
roster discover 10.0.1.0/24 --write     # scan the network into roster.yml
roster setup                            # one time on each box: key, fingerprints, ssh config
roster hosts --find orion              # what's out there
ssh orion-dev-01 uptime                # key login just works
roster run net-sw-core-01 -- show ver   # password-only gear; the password is fetched for you
roster run --sudo orion-dev-01 -- id  # as root; sudo gets the stored password
roster web esxi api POST /sdk -d @q.xml # web API call made with the service's stored login
```

### Why it exists

- **One source of truth for the team.** The host list lives in git and the logins live in the shared vault. Adding a host takes one change to `roster.yml`, and rotating a password takes one vault edit. Every box picks the change up.
- **No passwords on disk.** Passwords are fetched from Bitwarden, 1Password, `pass`, an environment variable or any command. They are kept in memory for one run and never written or printed. Each box gets its own SSH key, so you can revoke one box without touching the others.
- **Claude works on the network without seeing secrets.** `roster setup` writes `ROSTER.md`, which tells Claude which hosts exist and how to reach them. Claude uses `ssh`, `roster run` and `roster web`: roster supplies the credentials and Claude sees only the output.
- **Scans become inventory safely.** `roster discover` turns an nmap sweep into `roster.yml` entries marked `reviewed: false`. Nothing logs in to them until a person has reviewed them.

### What `roster setup` does on a box

1. Creates an SSH key for that box, tagged with the box's name.
2. Records every host's fingerprint.
3. Installs the key on each host that accepts keys, using the password from your password manager once.
4. Writes SSH config entries, so `ssh orion-dev-01` just works.
5. Writes `ROSTER.md`, so Claude knows which hosts exist and how to reach them.

## Documentation

| Doc | For |
|---|---|
| This README | Concepts, `roster.yml` reference, providers, commands, security model |
| [docs/new-box.md](docs/new-box.md) | Setting up roster on another box (a teammate's machine, a jump host, a Claude box) |
| [docs/adding-hosts.md](docs/adding-hosts.md) | Adding a network or host, wiring it to vault items, and testing the logins |
| [examples/roster.example.yml](examples/roster.example.yml) | Fully commented `roster.yml` (also produced by `roster init`) |

## Install

Requires Python 3.10+, the OpenSSH client, and [uv](https://docs.astral.sh/uv/). nmap is optional but recommended for `discover`. You also need your password manager's CLI (`bw` or `op`).

```bash
git clone git@github.com:2styx2/roster.git
cd roster

# install the `roster` command for your user (recommended, especially on boxes Claude uses)
uv tool install .
roster --help

# or try it from the project folder without installing
uv sync
uv run roster --help
```

If you don't install it as a tool, Claude's instructions automatically use the full path to the project's Python, so Claude can still run it. To update later, run `git pull && uv tool install --force .`.

## Quick start

```bash
mkdir ~/infra && cd ~/infra

# Option A: start from a scan
roster discover 10.0.1.0/24 10.0.2.0/24            # preview
roster discover 10.0.1.0/24 10.0.2.0/24 --write    # write roster.yml

# Option B: start from the commented example
roster init

# edit roster.yml: names, titles, users, password sources; set reviewed: true on scanned groups
roster providers        # are the password managers you reference installed?
roster auth-check       # can every group's password be found? (prints nothing secret)
roster setup --dry-run  # what would happen
roster setup            # do it
roster check            # SSH, web UI and service ports on every host
```

Then start Claude Code in that folder. `CLAUDE.md` imports `ROSTER.md`, which lists the hosts and tells Claude how to reach them.

## roster.yml

Settings cascade `defaults` → group → host, with the most specific winning. Run `roster init` to get a fully commented example; there is also one at `examples/roster.example.yml`.

```yaml
defaults:
  user: admin
  auth: prompt

groups:
  orion:
    title: Product Orion              # describes the group itself
    product: orion                    # cascades to the hosts
    user: deploy
    auth: bw:Orion servers            # where the password lives
    hosts:
      orion-dev-01:
        ip: 10.0.1.15
        type: dev
        title: Orion - dev box (main)
        description: Shared dev environment; full stack under /srv/orion.
        web: "https://10.0.1.15:8443"
        services: { postgres: 5432 }

  network:
    enroll: false                      # switches/routers: no key, log in by password
    user: netops
    auth: op:Network gear
    hosts:
      net-sw-core-01: { ip: 10.0.0.2, type: switch, title: "Core switch, rack A" }
```

| Field | Meaning |
|---|---|
| `ip`, `port`, `user` | How to reach it over SSH (port defaults to 22). `user` is also the box's default login |
| `title`, `description`, `type`, `product` | Who the box is; searchable with `roster hosts --find` |
| `web` | Web UI URL; listed for Claude and checked by `roster check` |
| `services` | Other ports to know about and check, e.g. `{ postgres: 5432 }`, or long form with its own login (below) |
| `auth` | Where the password comes from (see below); the default for every service on the box |
| `ssh` | Optional `{ port, user, auth }` that override the defaults for SSH only |
| `enroll` | `true` installs a key (default); `false` for gear that only takes passwords |
| `reviewed` | `false` on scanned hosts; `setup` skips them until you flip it |

### One login per box, overrides per service

A host's `user` + `auth` are its default login for everything on it. An `ssh:` block or a long-form service entry can override them. This is useful when a web UI uses a different account from SSH:

```yaml
      orion3:
        ip: 10.19.1.211
        user: admin                  # default login for every service on this box
        auth: bw:Orion3
        ssh: { user: sshuser, auth: "bw:Orion3 SSH" }      # SSH only; port defaults to 22
        services:
          https:
            port: 443                # url is derived (https://10.19.1.211) unless you give one
            user: webadmin
            auth: "bw:Orion web"
            # verify: false          # self-signed certificate
          postgres: 5432             # short form: inherits admin / bw:Orion3
```

- For SSH, the first match wins: the host's `ssh:` block, then the host's `port`/`user`/`auth`, then the group's `ssh:` block, then the group's keys, then `defaults:` in the same order.
- A service uses its own `user`/`auth` if it sets them, otherwise the host's default login.
- `ssh:` and `services:` work at host, group and `defaults:` level. Service entries with the same name merge field by field, so a group can define `modbus: { port: 502, user: mb }` and one host can override just its `auth`.
- A service accepts `port`, `url`, `scheme`, `user`, `auth` and `verify`. `web: "https://..."` still works and becomes a service named `web`.
- `roster info HOST` shows each service's login as a reference (`webadmin, auth bw:Orion web (own login)`), never the password. `roster auth-check` tests every reference in use, service ones included.

### Web APIs with stored logins: `roster web`

`roster web esxi GET /folder` or `roster web orion3 https GET /api/status` sends a request to that service, logged in with its `user`/`auth`. Without SERVICE it uses the host's web UI. The response status goes to stderr and the body to stdout.

- `login: basic` (default) sends HTTP Basic; `login: bearer` sends the `auth` value as a bearer token; `login: none` sends nothing. Generic HTML form logins aren't supported.
- `login: vsphere` (ESXi, vCenter) logs in through the SOAP API, sends the request with the session cookie, then logs out. Send SOAP bodies to `/sdk`, e.g. `roster web esxi POST /sdk -d @call.xml`. The right `SOAPAction` header is added for you.
- `login: unifi` (UniFi OS consoles: UDM, Cloud Key, UniFi OS Server) logs in through `/api/auth/login`, sends the request with the session cookie and CSRF token, then logs out. Paths: `/api/...` for UniFi OS, `/proxy/network/api/s/default/...` for the Network app, e.g. `roster web unifi GET /proxy/network/api/s/default/stat/health`.
- `login: openvpnas` (OpenVPN Access Server admin API, port 943) logs in through `/api/auth/login/userpassword` and sends the token as `X-OpenVPN-As-AuthToken`. Access Server has no logout call, so the token just expires. Example: `roster web vpn admin GET /api/server/info`. The old XML-RPC `/RPC2` API is often locked down by the relay level, so use `/api/...`.
- Only paths are accepted, and redirects are reported, not followed, so the credentials never go anywhere but the service's own address.
- The password, the token and the Authorization header are never printed. If a response happens to contain the password, it is masked.
- `verify: false` on the service (or `-k`) accepts a self-signed certificate.
- Hosts with `reviewed: false` are refused.

**Naming tip:** use `<product>-<role>-<nn>` (`orion-web-01`, `net-sw-core-01`). A product's boxes then sort together, and `ssh orion-<Tab>` shows only that product.

## Password providers

`auth:` takes the form `PROVIDER:WHAT`. Passwords are fetched only when needed, kept in memory for that run, and never printed.

| auth | Source |
|---|---|
| `prompt` | Ask once per group when `setup` runs |
| `agent` | No password; an SSH key you already have gets in |
| `env:VAR` | Environment variable |
| `cmd:COMMAND` | Any command that prints the password |
| `bw:ITEM`, `bw:ITEM#FIELD` | Bitwarden CLI (login password, custom field, `#username`, `#notes`) |
| `op:ITEM`, `op:VAULT/ITEM#FIELD`, `op:op://…` | 1Password CLI |

**Bitwarden:** run `bw login` once. A locked vault is unlocked once per run, using a master password prompt, `BW_PASSWORD`, or an existing `BW_SESSION`. For headless boxes, set `BW_CLIENTID`/`BW_CLIENTSECRET`.

**1Password:** use one of these:
- the 1Password app integration,
- `OP_SERVICE_ACCOUNT_TOKEN` for headless boxes,
- or `eval $(op signin)`.

Set a default vault under `providers: op: vault:`.

**Adding your own:**

- **Command template, no code:**
  ```yaml
  providers:
    vault:
      command: vault kv get -field={field} {item}   # auth: vault:secret/infra/web
  ```
- **Python plugin, for anything that needs login or unlock logic:** drop a `.py` file into `~/.config/roster/providers/` or a `providers/` folder next to `roster.yml`. `examples/providers/pass_store.py` is a complete, documented example for `pass`. Copy it to get started.

## Discover

```bash
roster discover 10.0.1.0/24 [more networks] [--write] [--top-ports 1000] [--no-ping] [--os]
```

With nmap installed, discover collects open ports, service versions, web page titles, and hardware vendor. It uses these to guess each host's type: `server`, `db`, `network`, `bmc`, `windows`, or `appliance`. It then fills in a name, title, SSH port, web URL, services, and a description. Without nmap, it falls back to a built-in TCP scanner.

`--write` adds new hosts to a `discovered-YYYYMMDD` group with `reviewed: false`:
- It keeps your comments.
- It saves `roster.yml.bak`.
- It refuses to write a file that wouldn't load.
- It never overwrites hosts that are already in the file.

Let your security team know before scanning big ranges.

## Commands

| Command | What it does |
|---|---|
| `init` | Write the commented example `roster.yml` |
| `discover CIDR…` | Scan networks; `--write` adds the results to `roster.yml` |
| `setup` | One-time per box: key, fingerprints, key install, SSH config, Claude files (`--only`, `--dry-run`) |
| `sync` | Rewrite the SSH config and Claude files after editing `roster.yml` |
| `check` | Reachability of SSH, web UIs and services |
| `hosts [--find TEXT]` | List or search hosts |
| `info HOST` | Everything about one host; fuzzy names work (`roster info core switch`) |
| `run [--sudo] HOST -- CMD` | Run a command; password-only hosts get their password from the provider. `--sudo` runs it as root, handing sudo the login's password (never shown) |
| `web HOST [SERVICE] METHOD PATH` | HTTP request to a host's web service, logged in with its stored credentials (`-d BODY`, `-H 'Name: value'`, `-k`) |
| `providers` | Available providers, whether their tools are installed, unknown ones in use |
| `auth-check` | Test every password source in use (SSH and services) without printing anything secret |
| `revoke` | Remove this box's key from every host |

`--only` accepts host names, groups, types and products: `roster check --only orion`, `roster setup --only switch,router`.

Config lookup order: `-c PATH`, then `$ROSTER_CONFIG`, then `./roster.yml`, then `~/.config/roster/roster.yml`.

## How Claude uses it

`roster setup` and `roster sync` write three things:

- **`ROSTER.md`** holds the hosts table (or a summary for big inventories), how to connect, and rules. The rules tell Claude to:
  - never read keys or fetch passwords,
  - ask before changing state on a host,
  - ask you to unlock a locked password manager rather than trying itself,
  - leave unreviewed hosts alone.
- **`CLAUDE.md`** gets an `@ROSTER.md` line added, and its existing content is kept.
- **`.claude/settings.json`** gets deny rules for reading and editing `~/.ssh`. These are a guardrail, not a wall.

For Bitwarden, `(umask 077; bw unlock --raw > ~/.config/roster/bw-session)` lets every roster run on this box use the unlocked vault, including Claude sessions that don't inherit your shell's environment. roster ignores the file unless only you can read it. `bw lock` ends the session, and the file goes stale with it.

For password-only gear, start Claude from a shell where your password manager is unlocked, for example `export BW_SESSION=$(bw unlock --raw)`. `roster run` can then fetch the password without Claude ever seeing it.

Web UIs: Claude won't type passwords into login pages. Sign in once in the browser Claude uses.

## Security model

- **Each box gets its own key.** The key is tagged `roster-managed:<box>` in `authorized_keys`, so `revoke` removes exactly that box's key, and running `setup` again replaces it cleanly. Keys tagged `fleet-managed` by the earlier script are recognized too.
- **The key has no passphrase,** so automation can use it. Anyone with access to the box can reach the fleet, so treat these boxes accordingly.
- **Host fingerprints are recorded on first contact** in `~/.ssh/roster_known_hosts`.
- **Passwords exist only in memory,** for one run.
- **Scanned hosts are never touched until you mark them reviewed.**
- **At larger scale,** consider an SSH certificate authority, so new boxes only need their key signed instead of installed everywhere.

## Development

```bash
uv sync                  # creates .venv with dev tools
uv run pytest            # 98 tests, no network or SSH server needed
uv run ruff check src tests
uv build                 # wheel + sdist in dist/
```

The tests use stand-in `bw`, `op` and `pass` commands from `tests/fakes/`, and give each test its own temporary HOME, so they never touch your real `~/.ssh` or vaults.

```
src/roster/
  cli.py            commands and argument parsing
  config.py         loading/validating roster.yml, search, --only
  example.py        the `roster init` template
  sshops.py         keys, fingerprints, ssh config, key install/removal, password logins
  claude.py         ROSTER.md, CLAUDE.md import, .claude/settings.json
  discover.py       nmap / built-in scanning, type guessing, merging into roster.yml
  providers/        password providers: registry + plugins + templates, builtin, bitwarden, onepassword
examples/           commented roster.yml, plugin template
docs/               team guides: setting up a new box, adding hosts
tests/              pytest suite + fake password-manager CLIs
```

### Trying it safely

- `roster setup --dry-run` shows which hosts would get a key without touching them.
- `--only` lets you start with one host or group.
- `roster revoke` undoes `setup`.
- To experiment without real servers, run an SSH server in a container (for example the `linuxserver/openssh-server` image with password auth enabled), point a `roster.yml` at it, and run the full flow.
