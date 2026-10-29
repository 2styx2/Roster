# Roster

**Your password manager knows the secrets. Roster knows your network: every host, what it is, how to reach it, and which login goes with which service.**

A password manager holds an item like `ESXI web`, but it doesn't know that the item opens both SSH and the SOAP API on one ESXi host. It doesn't know that two boxes with the same web title are different machines, or that one address is really a second interface of a box you already have. It doesn't know that the core switch only takes a password over SSH. That knowledge usually lives in someone's head, a stale wiki page, or a dozen `~/.ssh/config` files that all differ.

Roster keeps it in one file, `roster.yml`:

- **Hosts and what they are:** name, address, type, product, title, description.
- **How to reach them:** SSH port and user, whether the box takes a key or only a password, web UIs and other services.
- **Which login goes where:** each host's default login, plus SSH-only or per-service overrides. These point at password-manager items (`bw:esxi-02 ssh+web`, `op:Network gear`) and never contain a password.

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

**The easy way: the installer.** It walks through each stage, asks before every change and shows its progress. The stages are:

1. Prerequisites
2. uv
3. roster
4. the Bitwarden CLI
5. the config folder (clones [yourteam/infra](https://example.com/yourteam/infra) into `~/infra`)
6. making roster work from any directory
7. unlocking the vault
8. `roster setup`
9. auto-updates from cron

```bash
git clone git@github.com:2styx2/roster.git
cd roster
./install.sh              # interactive; safe to re-run
./install.sh --dry-run    # show what it would do, change nothing
./install.sh --yes        # take every default (skips steps that need you, like bw login)
```

Each step's output goes to `~/.cache/roster/install.log`, and is shown only if the step fails.

**By hand:**

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

To run roster commands from any directory, point `ROSTER_CONFIG` at your map in `~/.bashrc` (the installer does this for you):

```bash
export ROSTER_CONFIG="$HOME/infra/roster.yml"
```

Use the variable, not a symlink. roster writes `ROSTER.md` and the Claude files next to the config's path, so they stay in `~/infra`.

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
        auth: "bw:orion3 db"
        ssh: { user: sshuser, auth: "bw:orion3 ssh" }      # SSH only; port defaults to 22
        services:
          https:
            port: 443                # url is derived (https://10.19.1.211) unless you give one
            user: webadmin
            auth: "bw:orion3 web"
            # verify: false          # self-signed certificate
          postgres: 5432             # short form: inherits admin / bw:orion3 db
```

- For SSH, the first match wins: the host's `ssh:` block, then the host's `port`/`user`/`auth`, then the group's `ssh:` block, then the group's keys, then `defaults:` in the same order.
- A service uses its own `user`/`auth` if it sets them, otherwise the host's default login.
- `ssh:` and `services:` work at host, group and `defaults:` level. Service entries with the same name merge field by field, so a group can define `modbus: { port: 502, user: mb }` and one host can override just its `auth`.
- A service accepts `port`, `url`, `scheme`, `user`, `auth` and `verify`. `web: "https://..."` still works and becomes a service named `web`.
- `roster info HOST` shows each service's login as a reference (`webadmin, auth bw:orion3 web (own login)`), never the password. `roster auth-check` tests every reference in use, service ones included.

### Web APIs with stored logins: `roster web`

`roster web esxi GET /folder` or `roster web orion3 https GET /api/status` sends a request to that service, logged in with its `user`/`auth`. Without SERVICE it uses the host's web UI. The response status goes to stderr and the body to stdout.

- `login: basic` (default) sends HTTP Basic; `login: bearer` sends the `auth` value as a bearer token; `login: none` sends nothing. Generic HTML form logins aren't supported.
- `login: vsphere` (ESXi, vCenter) logs in through the SOAP API, sends the request with the session cookie, then logs out. Send SOAP bodies to `/sdk`, e.g. `roster web esxi POST /sdk -d @call.xml`. The right `SOAPAction` header is added for you.
- `login: unifi` (UniFi OS consoles: UDM, Cloud Key, UniFi OS Server) logs in through `/api/auth/login` and sends the request with the session cookie and CSRF token. The session is kept for up to 10 minutes (never past the token's expiry) in a private file under `$XDG_RUNTIME_DIR/roster/sessions/`, so a loop of calls logs in once instead of tripping UniFi OS's login limit (HTTP 429); if the console rejects a kept session, roster logs in again and retries once. Paths: `/api/...` for UniFi OS, `/proxy/network/api/s/default/...` for the Network app, e.g. `roster web unifi GET /proxy/network/api/s/default/stat/health`.
- `login: openvpnas` (OpenVPN Access Server admin API, port 943) logs in through `/api/auth/login/userpassword` and sends the token as `X-OpenVPN-As-AuthToken`. Access Server has no logout call, so the token just expires. Example: `roster web vpn admin GET /api/server/info`. The old XML-RPC `/RPC2` API is often locked down by the relay level, so use `/api/...`.
- `login: hub` (Hub web UI) logs in through `/api/auth/login` and sends the access token as a bearer token. The token expires after an hour; there is no logout call. Example: `roster web lab-hub2 GET /api/auth/me`.
- Only paths are accepted, and redirects are reported, not followed, so the credentials never go anywhere but the service's own address.
- The password, the token and the Authorization header are never printed. If a response happens to contain the password, it is masked.
- `verify: false` on the service (or `-k`) accepts a self-signed certificate.
- Hosts with `reviewed: false` are refused.

**Naming tip:** use `<product>-<role>-<nn>` (`orion-web-01`, `net-sw-core-01`). A product's boxes then sort together, and `ssh orion-<Tab>` shows only that product.

## Resources: secrets with no address

Some things need a secret but aren't hosts: a Wi-Fi network, a vendor portal, an API key. List them under `resources:` (next to `groups:`). Like everything else in `roster.yml`, they hold vault references, never values.

```yaml
resources:
  lab-guest:
    type: wifi
    ssid: Lab-Guest
    auth: "bw:wifi lab-guest"
    group: subnet-42
    title: Contoso guest Wi-Fi
```

Every resource has the same fields, plus the fixed fields of its type. Anything else is an error, so every resource of a type looks the same in every view.

| Type | Its own fields | Use for |
|---|---|---|
| (every type) | `title`, `description`, `group` (an existing group), `user`, `auth` | |
| `wifi` | `ssid` (required), `security` (`wpa2` default, `wpa3`, `wpa`, `wep`, `open`, `wpa2-enterprise`, `wpa3-enterprise`), `hidden` | Wi-Fi networks; `auth` is the password (not needed for `open`) |
| `account` | `url` (required) | Website, portal or SaaS logins |
| `secret` | none | API keys, license keys, PSKs |

- `roster resources` lists them (`--only NAME,TYPE,GROUP`, `--find TEXT`), and `roster info NAME` shows every field. Both show where the secret comes from, never the secret itself.
- `roster reveal NAME` prints the secret, for a person to type in. `roster reveal NAME --wifi` prints a `WIFI:T:WPA;S:…;P:…;;` string instead; pipe it to `qrencode -t ansiutf8` and phones can join by scanning it.
- `roster auth-check` checks resource references too, and ROSTER.md lists resources for Claude. Claude is told never to run `reveal` and to send the user to it instead.
- Old roster versions ignore `resources:`, so you can add it to a shared map before every box has upgraded.

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

**Naming vault items:** name each item `<roster host name> <what it opens>` (`orion3 ssh`, `esxi-02 ssh+web`, `shared hub web`, `wifi lab-guest`), and put the address in the item's URI field. The full convention is in [docs/adding-hosts.md](docs/adding-hosts.md#2-add-the-logins-to-the-vault).

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
| `hosts [--find TEXT] [--all] [--long]` | The hosts and resources you can use: name, IP, user, logins (`ssh (key), web (admin), api`, `wifi`) and title. Unreviewed scanned hosts are hidden unless you pass `--all`, `--find` or `--only`. `--long` shows the full table (type, product, web URL, scan description) |
| `info NAME` | Everything about one host or resource; fuzzy names work (`roster info core switch`) |
| `resources [--find TEXT]` | List or search Wi-Fi networks, accounts and secrets that aren't hosts |
| `reveal NAME [--wifi]` | Print a resource's secret for a person to use (`--wifi`: a QR-ready `WIFI:` string) |
| `run [--sudo] HOST -- CMD` | Run a command; password-only hosts get their password from the provider. `--sudo` runs it as root, handing sudo the login's password (never shown) |
| `web HOST [SERVICE] METHOD PATH` | HTTP request to a host's web service, logged in with its stored credentials (`-d BODY`, `-H 'Name: value'`, `-k`) |
| `bw BW_ARGS…` | The Bitwarden CLI with this box's vault session from `~/.config/roster/bw-session` (never prompts), e.g. `roster bw list items --search proxmox` |
| `providers` | Available providers, whether their tools are installed, unknown ones in use |
| `auth-check` | Test every password source in use (SSH, services and resources) without printing anything secret |
| `revoke` | Remove this box's key from every host |
| `serve` | The JSON-RPC API the desktop app talks to, on stdin/stdout (see [`roster serve` API](#roster-serve-api)) |
| `askpass PROMPT` | The `SSH_ASKPASS` helper for a `serve` password Session. ssh runs it, not you |

`--only` accepts host names, groups, types and products: `roster check --only orion`, `roster setup --only switch,router`.

Config lookup order: `-c PATH`, then `$ROSTER_CONFIG`, then `./roster.yml`, then `~/.config/roster/roster.yml`.

## `roster serve` API

`roster serve` is the backend for the desktop app (roster-desk). It speaks JSON-RPC 2.0 on stdin/stdout, one JSON object per line, handles requests one at a time, and exits with code 0 when stdin closes. Its one other channel is the private askpass socket for password Sessions (below). Only responses go to stdout; warnings and logs go to stderr. It finds `roster.yml` the same way every other command does (`-c PATH`, `$ROSTER_CONFIG`, ...).

Results are the objects roster builds when it loads `roster.yml`, with no extra schema. Logins come back as references (`bw:esxi-02 ssh+web`), never as values.

| Method | Params | Result |
|---|---|---|
| `inventory.info` | none | `{path, box, host_count, providers: [names], roster_version, api_version}` |
| `hosts.list` | none | `{hosts: [Host, ...], groups: {name: {title, description}}}`, hosts in `roster.yml` order |
| `host.get` | `{name}` (exact Host name) | one Host |

A Host has `name`, `group`, `ip`, `ssh: {user, port, auth}`, `login: {user, auth}` (the default for its services), `services: {name: {port, url, scheme, user, auth, verify, login, override}}`, `web`, `enroll`, `reviewed`, `title`, `description`, `type`, `product`, `mac`, plus the older flat `user`, `port` and `auth`.

### Sessions: `session.prepare`

| Method | Params | Result |
|---|---|---|
| `session.prepare` | `{host}` (exact Host name) | key-enrolled: `{argv: [/abs/path/ssh, "-o", "BatchMode=yes", NAME], env: {}, host: NAME, auth: "key"}`<br>password-only: `{argv: [/abs/path/ssh, "-o", "NumberOfPasswordPrompts=1", "-o", "PreferredAuthentications=password,keyboard-interactive", NAME], env: {SSH_ASKPASS, SSH_ASKPASS_REQUIRE: "force", ROSTER_ASKPASS_SOCKET, ROSTER_ASKPASS_TOKEN}, host: NAME, auth: "password"}` |

`session.prepare` tells the app what to start in a PTY to open a Session. It never holds a secret. The app runs `argv` exactly as given, with `env` added (on WSL: `wsl.exe -d DISTRO --cd ~ --exec env K=V ... ARGV...`). `argv[0]` is an absolute path, because PATH under `wsl.exe --exec` is minimal.

The command is the same one `roster run` uses: `ssh -o BatchMode=yes NAME`, where `NAME` is the `Host` alias that `roster setup` / `roster sync` write to `~/.ssh/config.d/roster`. The key, user, port, `known_hosts` and connection sharing all come from that config, so a Session behaves exactly like `ssh NAME` in a terminal (ADR 0002). There's no fallback to `-i KEY -p PORT user@ip`. Without roster's config there's no recorded host key and no installed key either, so `session.prepare` refuses with code `21` and says to run `roster sync`, or `roster setup` on a box that isn't set up yet. A failed login after that (host down, key not installed) is ssh's own message in the tab.

It refuses unreviewed Hosts with the same message as `roster run`.

#### Password Sessions: the askpass channel

A Host with `enroll: false` whose ssh Login is a vault reference (not `agent`/`key`/`none`) gets a password Session. The password goes from the provider to `serve`, over a private socket, to `roster askpass`, and into `ssh`. It never passes through the app.

- While `serve` runs, it listens on a Unix socket in a fresh directory: `$XDG_RUNTIME_DIR/roster-askpass-XXXX/` (or the temp dir if there's no runtime dir). The directory is `0700` and the socket is `0600`. `serve` also checks that the peer's uid is its own, and removes the directory when it exits (stdin closed or SIGTERM). Next to the socket is `askpass`, a `0700` two-line script that runs `<serve's python> -I -m roster.askpass`. `SSH_ASKPASS` has to be one absolute executable, because ssh runs it without a shell or your login PATH.
- `session.prepare` looks nothing up. It mints a random one-time token tied to that Host's ssh Login. The token is spent on first use (even if the lookup then fails), and it expires after 60 seconds or on `vault.lock`. Unlocking again doesn't bring it back, so open the Session again. If the Login's vault can't answer right now, `session.prepare` refuses with the vault error (`14` locked, `11` not logged in, `12` no CLI) instead of handing out a token that could only fail at ssh's prompt.
- The `env` to add to the ssh command:

  | Variable | Value |
  |---|---|
  | `SSH_ASKPASS` | absolute path of the `askpass` script |
  | `SSH_ASKPASS_REQUIRE` | `force`: use the helper even with a terminal and no `DISPLAY` (OpenSSH 8.4+; `DISPLAY` isn't needed) |
  | `ROSTER_ASKPASS_SOCKET` | the socket's path |
  | `ROSTER_ASKPASS_TOKEN` | the one-time token |

- When ssh prompts, it runs `roster askpass PROMPT`. The helper answers only these prompts, compared whole and ignoring case and extra spaces: `user@host's password:`, `Password:`, `(user@host) Password:` and `Password for user@host:`. Every other prompt is refused without contacting the socket: host-key `yes/no`, key passphrases, verification codes, and `New password:` / `(current) UNIX password:` from an expired-password change. The helper exits 1 and prints nothing, so ssh fails. For an allowed prompt, the helper sends the token and prints the password to ssh. If `serve` refuses the token (used, expired, locked, or the vault item lookup failed), the helper writes a one-line reason starting `roster askpass:` to the terminal and exits 1. With `NumberOfPasswordPrompts=1`, ssh then stops with its own `Permission denied`.
- `serve`'s stderr records each use (`askpass: esx: password handed to ssh`, or why it refused), never the password.
- The protocol is one exchange per connection. The helper sends `TOKEN\n`. `serve` replies `ok\nPASSWORD` or `no\nREASON` and closes the connection.
- `ROSTER_ASKPASS_TTL` (seconds, given to `serve`) can shorten the 60-second lifetime, for tests. It can't lengthen it.

`api_version` is currently 1. It goes up when a method or a result changes in a way the app has to know about. The app should refuse a roster whose `api_version` is too old.

Errors are JSON-RPC errors. The `code` is stable; the `message` uses roster's usual wording and is ready to show to a person.

| Code | Meaning |
|---|---|
| `1` | The Inventory didn't load: no `roster.yml`, or it's invalid. Every method that needs it returns this, and `serve` keeps running. `data` has `path` (or `null`), `roster_version` and `api_version`. |
| `2` | Unknown host (`host.get`, `session.prepare`) |
| `3` | Any other refusal roster would print as `error: ...` on the command line |
| `20` | `session.prepare`: the Host isn't reviewed (`reviewed: false`); same message as `roster run` |
| `21` | `session.prepare`: this box can't run `ssh NAME` yet. Either there's no `ssh` on PATH, or the Host isn't in roster's ssh config (run `roster sync`, or `roster setup`) |
| `22` | `session.prepare`: a password Session, but the process has no askpass channel. Only seen when serve's code is used in-process, never from `roster serve` |
| `11`, `12`, `14` | `session.prepare` for a password-only Host whose vault isn't logged in, isn't installed, or is locked (see [Vault](#vault-the-lock-screen)) |
| `-32700` | Not valid JSON |
| `-32600` | Not a JSON-RPC 2.0 request object (batches aren't supported) |
| `-32601` | Unknown method |
| `-32602` | Bad params, e.g. `host.get` without a `name` |
| `-32603` | Unexpected failure inside roster; details go to stderr |

Requests without an `id` (notifications) run but get no reply.

### Vault: the lock screen

`serve` starts locked, and only `vault.unlock` unlocks it. At startup it drops any `BW_PASSWORD` and `BW_SESSION` it inherited, and providers stop unlocking by themselves: no bw-session file, no `BW_PASSWORD`, no prompt. The master password goes to the provider in an environment variable, never on a command line. The session key stays in `serve`'s memory and is never written to the bw-session file. Neither ever appears in a response or on stderr.

| Method | Params | Result |
|---|---|---|
| `vault.status` | none | `{provider, status, message?, providers: [{provider, status, message?}, ...]}` |
| `vault.unlock` | `{password, provider?}` | `{provider, status: "unlocked"}` |
| `vault.lock` | none | `{locked: [names]}` |

- `vault.status`: `providers` lists every provider the Host Logins use (ssh and services), sorted by name. `provider` and `status` describe the vault the lock screen unlocks: the most used of those providers that takes a master password (in practice `bw`). If none does, `provider` is `null` and `status` is `unsupported`.
- `status` is one of:
  - `locked`
  - `unlocked`
  - `not-logged-in`: the CLI isn't logged in on this box
  - `missing-cli`: the CLI isn't installed
  - `unsupported`: no master password, e.g. `env` or `prompt`

  For `not-logged-in` and `missing-cli`, `message` says what to run or install.
- `vault.unlock` unlocks `provider`, or by default the one `vault.status` names.
- `vault.lock` forgets every cached secret, session key and askpass token, then runs the provider's own lock (`bw lock`). It locks the providers `vault.unlock` opened and those the Inventory uses. `locked` names the ones that have a lock of their own. It never fails; if a provider's lock fails, a warning goes to stderr. After it, any lookup reports code `14` until the next `vault.unlock`.

| Code | Meaning |
|---|---|
| `10` | Wrong master password: `Bitwarden unlock failed (wrong master password?)` |
| `11` | The vault CLI isn't logged in on this box. The message says what to run, e.g. ``Bitwarden CLI isn't logged in on this box - run `bw login` once`` |
| `12` | The vault CLI isn't installed: `` `bw` is not installed on this box (...) `` |
| `13` | The provider has no master password, or no Host Login uses one |
| `14` | A secret was needed but the vault is locked: `Bitwarden vault is locked - unlock it first` |

## How Claude uses it

`roster setup` and `roster sync` write three things:

- **`ROSTER.md`** holds the hosts table (or a summary for big inventories), how to connect, and rules. The rules tell Claude to:
  - never read keys or fetch passwords,
  - ask before changing state on a host,
  - ask you to unlock a locked password manager rather than trying itself,
  - leave unreviewed hosts alone.
- **`CLAUDE.md`** gets an `@ROSTER.md` line added, and its existing content is kept.
- **`.claude/settings.json`** gets deny rules for reading and editing `~/.ssh`. These are a guardrail, not a wall.

For Bitwarden, `(umask 077; bw unlock --raw > ~/.config/roster/bw-session)` lets every roster run on this box use the unlocked vault, including Claude sessions that don't inherit your shell's environment, and `roster bw …` runs any other `bw` command with it. roster ignores the file unless only you can read it. `bw lock` ends the session, and the file goes stale with it.

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
uv run pytest            # 178 tests, no network or SSH server needed
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
  resources.py      Wi-Fi networks, accounts and secrets with no address: the field schema per type
  claude.py         ROSTER.md, CLAUDE.md import, .claude/settings.json
  discover.py       nmap / built-in scanning, type guessing, merging into roster.yml
  serve.py          `roster serve`: JSON-RPC API for the desktop app, method table, error codes
  askpass.py        the askpass channel: serve's socket + one-time tokens, the `roster askpass` helper (stdlib only)
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
