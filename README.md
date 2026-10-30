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
| [app/README.md](app/README.md) | The roster app: the desktop app in `app/` (Tauri, React, xterm.js) that opens terminals on your Hosts through `roster serve` |
| [docs/app/](docs/app/) | The app's design: spec, architecture, security, Config (`init.lua`), themes, keyboard, errors catalog, decisions |
| [docs/adr/](docs/adr/) | Architecture decisions for the CLI and the app |
| [tickets/](tickets/) | Work tickets; [tickets/README.md](tickets/README.md) is the board |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Branch model and pull requests; [GLOSSARY.md](GLOSSARY.md) has the words |

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
| `check [HOST]` | Reachability of SSH, web UIs and services. With one HOST: why a Session to it would or wouldn't open, step by step (see [`roster check HOST`](#roster-check-host)) |
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

### `roster check HOST`

Runs the same diagnostics as the app's `:check HOST` (`host.check` below), in this order, and stops at the first failure:

| Step | Checks | Fails with |
|---|---|---|
| `inventory` | `roster.yml` loads, the Host is in it, it's reviewed, its user isn't `CHANGE-ME` | `1`, `2`, `20`, `30` |
| `ssh-config` | `ssh` is installed, and roster's ssh config has the Host's block exactly as `roster.yml` now says (stale, including one written before `IdentitiesOnly`: run `roster sync`) | `21` |
| `provider` | A password Login's provider is set up on this box and can answer | `31`, `11`, `12`, `14` |
| `vault-item` | The Login's vault item exists, is the only match, and has the password or `#FIELD` | `32`, `33`, `34`, `35` |
| `dns` | The Host's address resolves | `40` |
| `tcp` | The ssh port accepts a connection (5 s) | `41`, `42` |
| `host-key` | Over that same connection, the key the Host offers matches the one recorded in `~/.ssh/roster_known_hosts`. It's never recorded or accepted here | `43`, `44` |
| `auth` | One real login with the system ssh: `BatchMode` with the key, or one password prompt through askpass. `StrictHostKeyChecking=yes`, `ControlPath=none` | `45`, `46`, `47`, `36`, `48` |

Key Hosts skip `provider` and `vault-item`. Nothing touches the network once a local step has failed, and a whole check makes at most one TCP connection (port and host key) and one login, so it's safe to run against the 10.19.x rate limiter. It prints one line per step (`ok`, `FAIL` with the code, `skip`), then the fix and ssh's own message under a failure, and exits 1 if a step failed. It never prints a password.

```
ok   inventory   root@10.0.0.6:22 (password login)
ok   ssh-config  Host esx
ok   provider    bw is ready
FAIL vault-item  [33] 2 vault items are named 'esx ssh' (ssh Login of esx): 'esx ssh' (edited 2026-09-01, ssh://10.0.0.6); 'esx ssh' (edited 2026-10-20, https://10.0.0.6)
                 fix: delete or rename the extra items in the vault, or use the item's id in auth:
skip dns         an earlier step failed
...
```

## `roster serve` API

`roster serve` is the backend for the desktop app (the roster app, [`app/`](app/README.md)). It speaks JSON-RPC 2.0 on stdin/stdout, one JSON object per line, handles requests one at a time, and exits with code 0 when stdin closes. Its one other channel is the private askpass socket for password Sessions (below). Only responses go to stdout; warnings and logs go to stderr. It finds `roster.yml` the same way every other command does (`-c PATH`, `$ROSTER_CONFIG`, ...).

Results are the objects roster builds when it loads `roster.yml`, with no extra schema. Logins come back as references (`bw:esxi-02 ssh+web`), never as values.

| Method | Params | Result |
|---|---|---|
| `inventory.info` | none | `{path, box, host_count, providers: [names], roster_version, api_version}` |
| `hosts.list` | none | `{hosts: [Host, ...], groups: {name: {title, description}}, error}`, hosts in `roster.yml` order. `error` (API 8) is `null`, or why `roster.yml` as it is now doesn't load while these are the last good ones |
| `host.get` | `{name}` (exact Host name) | one Host |

A Host has `name`, `group`, `ip`, `ssh: {user, port, auth}`, `login: {user, auth}` (the default for its services), `services: {name: {port, url, scheme, user, auth, verify, login, override}}`, `web`, `enroll`, `reviewed`, `title`, `description`, `type`, `product`, `mac`, plus the older flat `user`, `port` and `auth`.

### Sessions: `session.prepare`

| Method | Params | Result |
|---|---|---|
| `session.prepare` | `{host}` (exact Host name) | key-enrolled: `{argv: [/abs/path/ssh, "-o", "BatchMode=yes", NAME], env: {}, host: NAME, auth: "key"}`<br>password-only: `{argv: [/abs/path/ssh, "-o", "NumberOfPasswordPrompts=1", "-o", "PreferredAuthentications=password,keyboard-interactive", NAME], env: {SSH_ASKPASS, SSH_ASKPASS_REQUIRE: "force", ROSTER_ASKPASS_SOCKET, ROSTER_ASKPASS_TOKEN}, host: NAME, auth: "password"}` |

`session.prepare` tells the app what to start in a PTY to open a Session. It never holds a secret. The app runs `argv` exactly as given, with `env` added (on WSL: `wsl.exe -d DISTRO --cd ~ --exec env K=V ... ARGV...`). `argv[0]` is an absolute path, because PATH under `wsl.exe --exec` is minimal.

The command is the same one `roster run` uses: `ssh -o BatchMode=yes NAME`, where `NAME` is the `Host` alias that `roster setup` / `roster sync` write to `~/.ssh/config.d/roster`. The key, user, port, `known_hosts` and connection sharing all come from that config, so a Session behaves exactly like `ssh NAME` in a terminal (ADR 0002). There's no fallback to `-i KEY -p PORT user@ip`. Without roster's config there's no recorded host key and no installed key either, so `session.prepare` refuses with code `21` and says to run `roster sync`, or `roster setup` on a box that isn't set up yet. A failed login after that (host down, key not installed) is ssh's own message in the tab.

It refuses unreviewed Hosts with the same message as `roster run`, and Hosts whose user is still discover's `CHANGE-ME` (code `30`).

#### Password Sessions: the askpass channel

A Host with `enroll: false` whose ssh Login is a vault reference (not `agent`/`key`/`none`) gets a password Session. The password goes from the provider to `serve`, over a private socket, to `roster askpass`, and into `ssh`. It never passes through the app.

- While `serve` runs, it listens on a Unix socket in a fresh directory: `$XDG_RUNTIME_DIR/roster-askpass-XXXX/` (or the temp dir if there's no runtime dir). The directory is `0700` and the socket is `0600`. `serve` also checks that the peer's uid is its own, and removes the directory when it exits (stdin closed or SIGTERM). Next to the socket is `askpass`, a `0700` two-line script that runs `<serve's python> -I -m roster.askpass`. `SSH_ASKPASS` has to be one absolute executable, because ssh runs it without a shell or your login PATH.
- `session.prepare` resolves the Login first, inside `serve`: the provider is set up, the vault answers, and the vault item exists, is the only match and has the password (or `#FIELD`). Whatever is wrong comes back as its own code before ssh starts: `31` provider not set up, `14` locked, `11` not logged in, `12` no CLI, `32` no such item, `33` several items, `34` no password or field, `35` the provider failed some other way. The password stays in `serve`'s memory; the result never holds it. Then it mints a random one-time token tied to that Host's ssh Login. The token is spent on first use (even if the lookup then fails), and it expires after 60 seconds or on `vault.lock`. Unlocking again doesn't bring it back, so open the Session again.
- The `env` to add to the ssh command:

  | Variable | Value |
  |---|---|
  | `SSH_ASKPASS` | absolute path of the `askpass` script |
  | `SSH_ASKPASS_REQUIRE` | `force`: use the helper even with a terminal and no `DISPLAY` (OpenSSH 8.4+; `DISPLAY` isn't needed) |
  | `ROSTER_ASKPASS_SOCKET` | the socket's path |
  | `ROSTER_ASKPASS_TOKEN` | the one-time token |

- When ssh prompts, it runs `roster askpass PROMPT`. The helper answers only these prompts, compared whole and ignoring case and extra spaces: `user@host's password:`, `Password:`, `(user@host) Password:` and `Password for user@host:`. Every other prompt is refused: host-key `yes/no`, key passphrases, verification codes, and `New password:` / `(current) UNIX password:` from an expired-password change. The helper reports the prompt's text (never an answer) to `serve`, which logs it, doesn't spend the token, and gives back the reason. For an allowed prompt, the helper sends the token and prints the password to ssh. Whenever the helper doesn't print a password, it writes one line to the terminal (ssh's stderr) and exits 1, so ssh fails; with `NumberOfPasswordPrompts=1` ssh then stops with its own `Permission denied`. The line is what the app's classifier reads:

  ```
  roster askpass: [CODE] REASON
  ```

  `CODE` is one of the codes below, and `REASON` is the same wording `session.prepare` gives for it:

  | Code | Line, for example |
  |---|---|
  | `36` | `roster askpass: [36] esx asked something roster won't answer: 'New password:' - log in by hand once to deal with it` |
  | `37` | `roster askpass: [37] the askpass token is used up, expired or cleared by a lock - open the Session again` |
  | `38` | `roster askpass: [38] can't reach roster serve (Connection refused)` |
  | `32`, `33`, `34`, `35`, `14`, ... | the vault item went away (or the vault was locked) between `session.prepare` and ssh's prompt, e.g. `roster askpass: [32] no vault item named 'esx ssh' (ssh Login of esx) - did you mean: 'esx root'` |
- `serve`'s stderr records each use (`askpass: esx: password handed to ssh`, `askpass: esx: refused an unexpected prompt: 'New password:'`, or why it refused), never the password.
- The protocol is one exchange per connection. The helper sends `TOKEN\n`, or `prompt TOKEN PROMPT\n` for a prompt it won't answer (the prompt on one line, at most 300 characters). `serve` replies `ok\nPASSWORD` or `no CODE\nREASON` and closes the connection.
- `ROSTER_ASKPASS_TTL` (seconds, given to `serve`) can shorten the 60-second lifetime, for tests. It can't lengthen it.

### Diagnostics: `host.check`

| Method | Params | Result |
|---|---|---|
| `host.check` | `{host}` (exact Host name) | `{host, ok, steps: [{step, status, message, code?, fix?, details?, data?}, ...]}` |

It runs the steps of [`roster check HOST`](#roster-check-host) in order: `inventory`, `ssh-config`, `provider`, `vault-item`, `dns`, `tcp`, `host-key`, `auth`. Every step is in `steps`, in that order. `status` is `ok`, `fail` or `skipped`; after the first `fail`, every later step is `skipped` with no network touched, and a key Host's `provider` and `vault-item` are `skipped` too. A failed step has the `code` (from the tables below), roster's `message` naming the Host, the `fix` in a sentence and, where there is one, the raw text under `details` (ssh's stderr, the resolver's error). `data` carries what the code's row says: `near`, `matches`, `line`, or for `43` the `recorded` and `offered` SHA256 fingerprints. A whole check makes at most one TCP connection and one login attempt. The password login goes through `serve`'s askpass channel like a Session's. `host.check` itself only fails for bad params (`-32602`); a `roster.yml` that doesn't load is a failed `inventory` step.

`api_version` is currently 8 (2 added `host.check` and codes 30-48; 3 added `vault.login`, `vault.status`'s `sign_in` and codes 50-59; 4 added `vault.create_item`, `vault.undo_create`, `can_write` and codes 60-63; 5 added `inventory.pull`, `host.verify_login`, `host.update`, `changes.diff`, `changes.discard` and codes 70-75; 6 added `host.scan_key`, `host.add`, `host.review` and codes 80-81; 7 added `changes.publish`, codes 90-96, `changes.diff`'s `message` and `groups`, and `data.details` on errors; 8 added the Live Inventory: `host.remove`, `host.rename`, `host.move`, `group.new`, `group.rename`, `group.delete`, `inventory.reload`, `inventory.watch`, the `inventory.changed` notification, `hosts.list`'s `error`, and codes 100-103). It goes up when a method or a result changes in a way the app has to know about. The app should refuse a roster whose `api_version` is too old.

Errors are JSON-RPC errors. The `code` is stable; the `message` uses roster's usual wording, names the Host, and is ready to show to a person. Where roster knows the fix, `data.fix` says it in a sentence. Ranges: 1-9 general, 10-19 the vault, 20-29 `session.*`, 30-39 a Host's Login and askpass, 40-49 the network and the Host (`host.check`), 50-59 signing the vault in (`vault.login`), 60-69 saving to the vault (`vault.create_item`), 70-79 editing the Inventory, 80-89 adding a Host (`host.add`), 90-99 publishing (`changes.publish`), 100-109 the Live Inventory (removing, renaming and moving Hosts and groups). When roster has another program's raw words (git's, ssh's), `data.details` carries them. [`docs/app/errors.md`](docs/app/errors.md) is the catalog the codes come from.

| Code | Meaning |
|---|---|
| `1` | The Inventory didn't load: no `roster.yml`, or it's invalid (including a Host with no user at all). Every method that needs it returns this, and `serve` keeps running. `data` has `path` (or `null`), `roster_version`, `api_version`, `fix`, and `line` for a YAML error. |
| `2` | Unknown host (`host.get`, `session.prepare`) |
| `3` | Any other refusal roster would print as `error: ...` on the command line |
| `20` | `session.prepare`: the Host isn't reviewed (`reviewed: false`); same message as `roster run` |
| `21` | `session.prepare`: this box can't run `ssh NAME` yet. Either there's no `ssh` on PATH, or the Host isn't in roster's ssh config (run `roster sync`, or `roster setup`) |
| `22` | `session.prepare`: a password Session, but the process has no askpass channel. Only seen when serve's code is used in-process, never from `roster serve` |
| `11`, `12`, `14` | `session.prepare` for a password-only Host whose vault isn't logged in, isn't installed, or is locked (see [Vault](#vault-the-lock-screen)) |
| `30` | The Host's ssh user is discover's placeholder `CHANGE-ME`: "no SSH user for esx (user: CHANGE-ME in roster.yml)" |
| `31` | The Login's provider isn't set up on this box: "kp's ssh Login uses 'kp:', which isn't set up on this box". `data.provider` |
| `32` | No vault item by that name: "no vault item named 'esx shh' (ssh Login of esx) - did you mean: 'esx ssh'". `data.near` lists similar item names (names only) |
| `33` | Several vault items match: "2 vault items are named 'esx ssh' (ssh Login of esx): ...". `data.matches` is `[{name, revised, uris}]`: names, last-edited dates and URIs, never a value |
| `34` | The item has no password, or no such `#FIELD`: "vault item 'esx ssh' has no password (ssh Login of esx)". `data.field` |
| `35` | The provider failed some other way; the message is the provider's |
| `36` | askpass: the Host asked something roster won't answer (an expired password, an OTP); the prompt is in the message |
| `37` | askpass: the token is used up, expired or cleared by `vault.lock` |
| `38` | askpass: the helper couldn't reach `serve` |
| `40` | `host.check`: the address doesn't resolve |
| `41` | `host.check`: the ssh port refused the connection |
| `42` | `host.check`: no answer in time. For 10.19.x the fix mentions the rate limiter (wait a few minutes) |
| `43` | `host.check`: the Host's key isn't the recorded one. Never accepted automatically |
| `44` | `host.check`: no recorded host key for the Host |
| `45` | `host.check`: the Host refused the password for that user |
| `46` | `host.check`: the Host refused this box's key |
| `47` | `host.check`: the Host cut the connection after too many key attempts. roster's ssh config sets `IdentitiesOnly yes` for key and password Hosts (and `PubkeyAuthentication no` for password Hosts) so the agent's keys can't use up the Host's tries; an older config fails the `ssh-config` step instead |
| `48` | `host.check`: the login failed some other way; `details` has ssh's message |
| `50`-`59` | `vault.login`: see [Signing in](#signing-in-vaultlogin) |
| `70` | `roster.yml` isn't committed in a git repo (or git isn't installed), so it has no Pending changes |
| `71` | `inventory.pull`: uncommitted changes, Pending changes or other files (`data.files`) |
| `72` | `inventory.pull`: this box's branch and its upstream have diverged (`data.ahead`, `data.behind`) |
| `73` | `inventory.pull`: the fetch or the fast-forward failed; `details` has git's message |
| `74` | `host.update`: the result wouldn't load, loads differently than asked, or changes another entry; nothing written |
| `75` | `host.update`: the address, user or Login changed without a `host.verify_login` of those values that just succeeded |
| `80` | `host.add`: a bad name, group, address, user or port, or no user to log in as (none given, none inherited). `data.field` names it; the message is roster's (`bad host name 'a b' (use letters, digits, . _ -)`) |
| `81` | `host.add`: a Host by that name is already in the Inventory: "host 'esx' is already in the Inventory (group lab)". `data.group` |
| `90` | `changes.publish`: no Pending changes, nothing to publish |
| `91` | `changes.publish`: other files in the infra repo are uncommitted too (`data.files`); nothing published |
| `92` | `changes.publish`: someone published `roster.yml` to the upstream since this box pulled (`data.behind`); nothing published |
| `93` | `changes.publish`: this box has commits of its own that aren't on the upstream (`data.ahead`); roster pushes only its own |
| `94` | `changes.publish`: the branch has no upstream to push to |
| `95` | `changes.publish`: git refused the commit (no identity, a hook); `details` has git's message; the Pending changes are kept |
| `96` | `changes.publish`: the push failed or was rejected (`data.rejected`: the upstream moved meanwhile); the commit is undone, the Pending changes are kept |
| `100` | `host.rename`, `group.new`, `group.rename`: that name is already a Host's or a group's (`data.kind`, `data.group`) |
| `101` | No group by that name in `roster.yml` (`data.group`); the message lists the groups |
| `102` | `group.delete`: the group still has Hosts and no `to` says where they go (`data.hosts`) |
| `103` | `host.move`, `group.delete`: the Host would come out different in its new group (a service or Login it inherits there that roster can't write on the Host); `data.fields` |
| `-32700` | Not valid JSON |
| `-32600` | Not a JSON-RPC 2.0 request object (batches aren't supported) |
| `-32601` | Unknown method |
| `-32602` | Bad params, e.g. `host.get` without a `name` |
| `-32603` | Unexpected failure inside roster; details go to stderr |

Requests without an `id` (notifications) run but get no reply. `serve` sends one notification of its own, `inventory.changed` (see [The Live Inventory](#the-live-inventory-hosts-and-groups-and-outside-edits)), and only after `inventory.watch`.

### Editing: Pending changes

A Pending change is an edit to `roster.yml` made on this box and not Published yet: `roster.yml`'s uncommitted diff in the infra repo (a git clone). These methods need `roster.yml` committed in a git repo (`70` otherwise). Publishing commits and pushes them (`changes.publish`).

| Method | Params | Result |
|---|---|---|
| `inventory.pull` | none | `{updated, upstream, commits, ahead, from?, to?, message?}`: the repo fast-forwarded to its upstream (`upstream: null` when the branch has none: nothing to pull). Refuses uncommitted changes (`71`, `data.files`) and a diverged branch (`72`, `data.ahead`/`behind`); a failed fetch is `73`. Never merges, rebases or stashes |
| `host.verify_login` | `{host, changes}` | `{host, ok, steps}` like `host.check`, with steps `user`, `provider`, `vault-item`, `dns`, `tcp`, `host-key`, `auth`, run against the Host as `changes` would leave it |
| `host.update` | `{host, changes}` | `{changed, host, backup}`: the edit written into `roster.yml`, `host` as it loads now, `backup` the file as it was |
| `changes.diff` | none | `{path, repo, diff, hosts: [{host, change: changed\|added\|removed, fields}], groups: [{group, change}], count, message}`: git's diff of `roster.yml` against the last commit, and the commit message `changes.publish` would write |
| `changes.discard` | none | `{discarded, backup}`: `roster.yml` back as the last commit has it (index and working tree) |
| `changes.publish` | `{message?}` | `{commit, upstream, message, hosts, groups: [{group, change}], pulled, sync: {ok, error?, fix?}}`: commits `roster.yml` alone and pushes it to the branch's upstream, then runs `roster sync` |

`changes` is `{field: value}` with fields `title`, `description`, `type` (text, one line), `ip`, `user`, `auth` (strings) and `port` (a number). `host.update` edits `roster.yml` as text, like `discover --write`: only the changed values' text changes, so comments, order, quoting and every other entry stay byte for byte. `user`, `port` and `auth` go into the Host's `ssh:` block if it has one; a short `name: 10.0.0.1` entry grows into a block when it needs more than its address. The result must load, must load to exactly the values asked for, and must leave every other Host, group and resource as it was (`74` otherwise, nothing written). What it replaced is kept as `roster.yml.bak` in the repo's git dir (`.git/roster/`), never in the working tree. Every write and pull loads `roster.yml` again, so `hosts.list` shows the file as it now is.

**Publishing (ticket 12, decision Q13).** `changes.publish` refuses when there's nothing pending (`90`), when another file in the infra repo is uncommitted (`91`; `folders.yml` and anything personal never go in), and when `roster.yml` doesn't load (`1`). It fetches first (`73` if that fails). New upstream commits that leave `roster.yml` alone are fast-forwarded over (`pulled` counts them); if someone else published `roster.yml` meanwhile (`92`) or this box has commits of its own (`93`), it stops. It commits `roster.yml` only, with `message` if given, else one naming every Host and group that changed (`roster: change esx (title), add web-01`; past 72 characters the subject gives the counts and the body lists them). The author is whatever git identity the infra repo has; roster never sets one. It pushes `HEAD` to the upstream branch, never forced; a rejected push (`96`) undoes the commit, so the Pending changes stay as they were. Then it runs `roster sync` (ssh config and the Claude files); a failed sync doesn't undo the Publish and shows in `sync`.

**Verified changes (decision Q43).** A change to `ip`, `port`, `user` or `auth` is refused (`75`) unless `host.verify_login` with exactly those values succeeded in the last 10 minutes; the success is used up by the save. The test login makes one TCP connection and one login attempt (a password Login is looked up from the vault into roster's memory; a key Host uses this box's roster key). The host key must match one recorded in `~/.ssh/roster_known_hosts`, for the new address or, for a Host that moved, its current one; it's never recorded or accepted. A Host with no stored Login (`auth: prompt`, `agent`, `none`) gets every step but the login.

### Adding a Host: `host.add`

| Method | Params | Result |
|---|---|---|
| `host.scan_key` | `{address, port?}` | `{address, port, key_type, fingerprint, recorded: none\|match\|changed}`: the host key the address offers, and how it compares with the one in `~/.ssh/roster_known_hosts`. One connection, key exchange only: never logs in, never records anything. `40`-`42` when it can't get there |
| `host.add` | `{name, group, address, user?, port?, type?, title?, description?, enroll?, auth? \| password + item?, host_key?, provider?}` | `{added: true, host, backup, verify, item, warnings}`: `host` as `roster.yml` has it now, `verify` the test login (`{host, ok, steps}`, or `null` without a Login), `item` the Vault item it made (`{provider, id, name}`, or `null`) |
| `host.review` | `{host}` | `{changed, host, backup}`: `reviewed: true` set on that Host and nothing else (`changed: false` if it already was) |

`host.add` writes the Host into `roster.yml` as text at the end of its group (or in a new group after the last one), like `host.update`: comments and every other entry stay byte for byte, a group of one-line `{ip: ...}` entries gets one more, and only what the Host doesn't inherit from its group or `defaults:` is written. The result must load with exactly the values asked for and nothing else changed (`74` otherwise). It's a Pending change, with the backup in `.git/roster/`.

**Verified adds (decision Q43).** A Host with a Login gets one test login before anything is written. The Login is either `auth`, an existing vault reference (`bw:esx-02 ssh`, looked up into roster's memory), or `password`, typed into the form, with `item` the Vault item to save it as (default `<name> ssh`, see [docs/adding-hosts.md](docs/adding-hosts.md)) in `provider` (default: the one `vault.status` names; choosing the target is ticket 35). In order:

1. The name, group and user are checked and the add is tried as text (`80`, `81`, `74`), before the network. For a typed password, the provider must be able to save (`61`) and be unlocked (`14`, `11`, `12`).
2. The test login, as `host.verify_login`'s steps (`user`, `provider`, `vault-item`, `dns`, `tcp`, `host-key`, `auth`): one connection and one attempt with the password, even for `enroll: true` (this Box's key isn't on the new Host yet). The host key must be the recorded one for the address, or, for an address with none, the `host_key` fingerprint the user confirmed after `host.scan_key`. Without either it's `44`; a different key is `43`, and no login is tried. A failed step is the error: its own code (`40`-`48`, `30`-`35`), the message "esx-02 wasn't added: ... - nothing was saved", and `data.step` and `data.steps`.
3. For a typed password, the Vault item (`vault.create_item`'s rules: `60` if the name is taken, `62` if the vault refuses). The password then leaves roster's memory.
4. The Host, written into `roster.yml` with `reviewed: true`. If this fails in any way (an edit that wouldn't load, a full disk, an unwritable `.git/roster/`), the Vault item from step 3 is deleted again: the error says "the vault item 'esx-02 ssh' was taken back out" and has `data.undone`, or, if even that fails, `data.left` with the item to delete by hand.
5. A host key confirmed with `host_key` is recorded in `~/.ssh/roster_known_hosts`, so Sessions and later test logins find it. The Host is already written by now, so a failure here doesn't undo the add: it succeeds with the failure in `warnings` (a list of sentences, empty when all went well).

The typed password is never in a response, an error, stderr, `roster.yml` or the Pending change; only the item's name is. A Host **without** a Login (no `auth`, no `password`, and none inherited) is added `reviewed: false` with no network at all, as `discover` adds Hosts; `host.review` (or `reviewed: true` by hand) lets it be opened.

### The Live Inventory: Hosts and groups, and outside edits

Removing, renaming and moving Hosts and adding, renaming and deleting groups (ticket 28, decision Q45). Each is a text edit of `roster.yml` like `host.update`: only the entry's own lines change (from its key's line through its value's last line, comments on those lines included), every other byte stays, and the result must load to exactly what was asked, with nothing else changed (`74` otherwise, nothing written). Each is a Pending change with the backup in `.git/roster/`. A `roster.yml` that doesn't load right now refuses them with `1` and its line. A bad name is `80`, an unknown Host `2`.

| Method | Params | Result |
|---|---|---|
| `host.remove` | `{host}` | `{removed, group, backup}`: the Host's entry taken out. Its group stays, even empty. **Never touches the vault**: its vault item, if any, stays |
| `host.rename` | `{host, to}` | `{changed, host, backup}`: only its key changes. Its vault item keeps its name. `100` if `to` is taken |
| `host.move` | `{host, group}` | `{changed, host, pinned, backup}`: its lines cut and added at the end of `group`'s `hosts:`, re-indented. What it inherited from its old group (user, port, Login, `enroll`, `reviewed`, `type`, …) and wouldn't from the new one is written on the Host (`pinned` names those fields), so it stays the same Host. `101` no such group, `103` if it would still come out different |
| `group.new` | `{name, title?}` | `{group, backup}`: `NAME:` with `hosts: {}` (and its `title:`) after the last group. `100` if taken |
| `group.rename` | `{group, to}` | `{changed, group, backup}`: only its key changes; its Hosts follow. `100` if taken |
| `group.delete` | `{group, to?}` | `{deleted, moved, to, backup}`: the group's entry taken out. A group that still has Hosts is refused (`102`, `data.hosts`) unless `to` names the group they move to first (as `host.move` moves them) |
| `inventory.reload` | none | `{changed, host_count, error}`: `:source` for `roster.yml`, read again now |
| `inventory.watch` | `{auto}` | `{watching, auto, path?}`: start noticing outside edits of `roster.yml`; `auto` (the app's `auto_reload`) applies them |

**Reloading is Neovim-style (decision Q58).** An edit made outside the app (in vim, a `git pull` in a terminal) isn't applied by itself unless the app asked for it with `inventory.watch {auto: true}`. `serve` looks at `roster.yml` every 0.2 s (its size, time and inode, so an editor that saves by renaming a new file over it counts too); a change that has settled and differs from what `serve` last loaded (its own writes don't count) is sent as a JSON-RPC notification, a message with no `id`:

```json
{"jsonrpc": "2.0", "method": "inventory.changed", "params": {"applied": true, "error": null}}
```

With `auto`, `applied` is `true`: `serve` loaded it, within a second of the save. Without, `applied` is `false` and the edit waits for `inventory.reload` (`:source`); it's reported once. **A file that doesn't load keeps the last good Inventory**: `hosts.list` keeps answering with it, plus `error: {message, path, line?, fix}` (catalog row 1), and so do the notification and `inventory.reload`. It recovers by itself once the file loads again. `hosts.list`'s `error` is `null` while the file loads.

### Vault: the lock screen

`serve` starts locked, and only `vault.unlock` unlocks it. At startup it drops any `BW_PASSWORD` and `BW_SESSION` it inherited, and providers stop unlocking by themselves: no bw-session file, no `BW_PASSWORD`, no prompt. The master password goes to the provider in an environment variable, never on a command line. The session key stays in `serve`'s memory and is never written to the bw-session file. Neither ever appears in a response or on stderr.

| Method | Params | Result |
|---|---|---|
| `vault.status` | none | `{provider, status, message?, sign_in?, providers: [{provider, status, message?, sign_in?}, ...]}` |
| `vault.unlock` | `{password, provider?}` | `{provider, status: "unlocked"}` |
| `vault.lock` | none | `{locked: [names]}` |

- `vault.status`: `providers` lists every provider the Host Logins use (ssh and services), sorted by name. `provider` and `status` describe the vault the lock screen unlocks: the most used of those providers that takes a master password (in practice `bw`). If none does, `provider` is `null` and `status` is `unsupported`.
- `status` is one of:
  - `locked`
  - `unlocked`
  - `not-logged-in`: the CLI isn't logged in on this box
  - `missing-cli`: the CLI isn't installed
  - `unsupported`: no master password, e.g. `env` or `prompt`

  For `not-logged-in` and `missing-cli`, `message` says what to run or install. For `not-logged-in`, a provider the app can sign in (`bw`) also has `sign_in: {methods: ["password", "apikey", "sso"], server}`, where `server` is what `bw config server` is set to (`null`: bitwarden.com). See `vault.login` below.
- `vault.unlock` unlocks `provider`, or by default the one `vault.status` names.
- `vault.lock` forgets every cached secret, session key and askpass token, then runs the provider's own lock (`bw lock`). It locks the providers `vault.unlock` opened and those the Inventory uses. `locked` names the ones that have a lock of their own. It never fails; if a provider's lock fails, a warning goes to stderr. After it, any lookup reports code `14` until the next `vault.unlock`.

| Code | Meaning |
|---|---|
| `10` | Wrong master password: `Bitwarden unlock failed (wrong master password?)` |
| `11` | The vault CLI isn't logged in on this box. The message says what to run, e.g. ``Bitwarden CLI isn't logged in on this box - run `bw login` once`` |
| `12` | The vault CLI isn't installed: `` `bw` is not installed on this box (...) `` |
| `13` | The provider has no master password, or no Host Login uses one |
| `14` | A secret was needed but the vault is locked: `Bitwarden vault is locked - unlock it first` |

### Signing in: `vault.login`

A new Box's vault CLI isn't logged in (`vault.status`: `not-logged-in`). `vault.login` signs it in from the app, a step at a time, and leaves the vault unlocked. [`docs/app/dev/vault-auth.md`](docs/app/dev/vault-auth.md) has the research: which methods each CLI can do, and why it works this way.

| Params | Result |
|---|---|
| `{action: "start", method: "password", email, password, server?, provider?}` | the first step |
| `{action: "start", method: "apikey", client_id, client_secret, server?}` | `master_password` |
| `{action: "start", method: "sso", identifier?, server?}` | `sso` |
| `{action: "answer", login, ...the step's answer}` | the next step |
| `{action: "cancel"}` | `{cancelled: true \| false}` |

`action` defaults to `start`. `server` is `cloud` (bitwarden.com), `eu` (`https://vault.bitwarden.eu`), or a self-hosted `https://` URL. Leave it out to keep what `bw config server` says; roster only runs `bw config server` when that changes. A `start` ends any sign-in in progress, and so do `cancel`, `vault.lock`, and 10 minutes without an answer. Every result has `step` and `login`, the sign-in's id, which `answer` sends back:

| `step` | Also has | Answer with |
|---|---|---|
| `two_factor_method` | `methods: [{index, id, kind, name}]` in bw's order. `kind` is `authenticator`, `email`, `yubikey` or `other`; `id` is bw's method number (0, 1, 3). FIDO2 and Duo never appear: the CLI can't do them | `{method: index}` |
| `two_factor_code` | `method` (as above, or `null` when the account has one method and bw picked it), `sent: true` when bw has just emailed the code | `{code}` |
| `new_device_code` | `email`: Bitwarden emailed a one-time code because this Box is new | `{code}` |
| `sso` | `url` to open in a browser (roster opens it on the Box too: `wslview`, `explorer.exe` on WSL, else `xdg-open`), `expires_in` seconds (5 minutes) | `{}`: waits up to 20 s for the browser, then answers `sso` again (with the time left) or the next step |
| `master_password` | after an API key or SSO, which only log in: the vault still needs the master password | `{password}` |
| `done` | `provider`, `status: "unlocked"` | |

How it works, and what never happens to a secret:
- `bw login` can't take a new-device code from a flag, and it's one-shot. So the password and SSO flows run `bw login` on a PTY and type at bw's own prompts. The bw process lives between calls.
- The master password goes to bw in an environment variable (`--passwordenv`). The API key goes in `BW_CLIENTID` and `BW_CLIENTSECRET`. The email and every code are typed at bw's prompts. None of them is ever in a command line (`--code` and a positional password are never used), and none ever appears in a response or on stderr. An error quotes bw's own words with every value the person typed cut out.
- A wrong code ends the bw process. roster holds the master password in memory for the sign-in's life, so it runs bw again itself and answers code `50`, with `data.step` set to the step to show next. The person types only a new code. For Email and new-device codes, that sends a fresh one, and the message says so.
- A failure with `data.step` (`50`, and `10` at `master_password`) keeps the sign-in going: show that step again. Any other failure ends it.

| Code | Meaning |
|---|---|
| `10` | The email or master password wasn't accepted: "Bitwarden didn't accept that email and master password (on bitwarden.com)". At the `master_password` step, the usual unlock message, with `data.step` |
| `12` | `bw` isn't installed |
| `13` | The provider has no sign-in roster can drive. For `op`: "1Password signs in through its desktop app, not here: turn on ... "Integrate with 1Password CLI" ..., or set OP_SERVICE_ACCOUNT_TOKEN for a service account" |
| `50` | The two-step or new-device code was wrong or expired (the server doesn't tell those apart). `data.step` and `data.login`: carry on there |
| `51` | The CLI can't do the account's two-step method, which happens when FIDO2 and Duo are its only methods: "... sign in with an API key instead, or add an authenticator app, email or YubiKey OTP as a second method in the web vault". Also SSO for accounts with trusted-device or passkey (PRF) decryption, in bw's words |
| `52` | The server refused: too many attempts. Wait a few minutes |
| `53` | The server didn't answer (DNS, refused, TLS, no answer in 40 s): "can't reach the Bitwarden server vault.example.com (...)" |
| `54` | The CLI is already logged in on this box, so unlock instead. To switch account, run `bw logout` first |
| `55` | No sign-in in progress: finished, cancelled, replaced by a newer `start`, or 10 minutes without an answer |
| `56` | SSO failed in the browser, or wasn't finished within 5 minutes |
| `57` | `server` isn't `cloud`, `eu` or an `http(s)://` URL |
| `58` | The API key wasn't accepted, or it's an organization key (the CLI takes only personal ones) |
| `59` | The sign-in failed some other way; the message has bw's words |

`ROSTER_SSO_TIMEOUT` (seconds, given to `serve`) can shorten the 5-minute SSO wait, for tests, and `ROSTER_NO_BROWSER=1` stops roster from opening the link on the Box.

### Saving to the vault: `vault.create_item`

"Save to vault" (the add-Host form, Quick Connect) creates the Vault item a new Login points at. Decision Q43's order is: verify the login, create the Vault item, then add the Pending change. If that last step fails, `vault.undo_create` takes the item back out, so nothing stray is left.

| Method | Params | Result |
|---|---|---|
| `vault.create_item` | `{name, password, username?, uri?, provider?}` | `{provider, id, name}` |
| `vault.undo_create` | `{id}` (from `vault.create_item`) | `{provider, id}` |

- `vault.create_item` makes a login item: `name` (`<host> <what it opens>`, [docs/adding-hosts.md](docs/adding-hosts.md)), `username` in its username field, the password, and the address in its URI field (`uri`, e.g. `ssh://10.0.0.5`). `provider` defaults to the one `vault.status` names. It runs `bw sync` first, then refuses a name an item already has exactly (code `60`), because Logins look items up by exact name. A longer name, like `esx ssh+web` next to `esx ssh`, is a different item.
- Only providers whose `can_write` is `true` in `vault.status` (today only `bw`) can save. Every other provider answers `61`.
- The password goes to `bw create item` as base64 JSON on its stdin (what `bw encode` makes; bw 2026.9.1 reads stdin when no argument is given). It is never on a command line, and never in a response, an error or stderr. bw prints the new item back, password included, and roster keeps only its id.
- `vault.undo_create` deletes only items this `serve` created and hasn't undone yet (`63` for any other id), so it can't be pointed at an existing item. Bitwarden moves the item to its trash (`bw delete item ID`, not `--permanent`), where it can be restored for 30 days.
- While the vault is locked, both answer `14`.

| Code | Meaning |
|---|---|
| `60` | An item named exactly that already exists. `data.matches`: `[{name, revised, uris}]` |
| `61` | The provider can only read Logins: "provider 'op' can't save to the vault - ..." |
| `62` | The vault CLI refused the create or delete (no rights to the collection, an organization policy, the server). The message has bw's words with any value cut out |
| `63` | `vault.undo_create`: this `serve` didn't create that item, or it's already undone |

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
  providers/        password providers: registry + plugins + templates, builtin, bitwarden, onepassword;
                    bw_login: `bw login` driven a step at a time on a PTY (serve's vault.login)
examples/           commented roster.yml, plugin template
docs/               team guides: setting up a new box, adding hosts; docs/app/ for the app, docs/adr/ for decisions
tests/              pytest suite + fake password-manager CLIs
app/                the roster app (frontend + app/src-tauri); its Rust core is crates/roster-core (app/README.md)
```

The app's checks are in [app/README.md](app/README.md#development) (`npm run check` in `app/`, `cargo test` at the root). CI runs both halves on every pull request (`.github/workflows/ci.yml`); [CONTRIBUTING.md](CONTRIBUTING.md) has the branch model.

### Trying it safely

- `roster setup --dry-run` shows which hosts would get a key without touching them.
- `--only` lets you start with one host or group.
- `roster revoke` undoes `setup`.
- To experiment without real servers, run an SSH server in a container (for example the `linuxserver/openssh-server` image with password auth enabled), point a `roster.yml` at it, and run the full flow.
