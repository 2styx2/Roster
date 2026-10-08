# Roster

Give a box, and Claude running on it, access to every host on your network from one YAML file.

You describe your network once in `roster.yml`: hosts, what they are, how to reach them, and where their passwords live. Running `roster setup` on a box then does the following:

1. Creates an SSH key for that box.
2. Records every host's fingerprint.
3. Installs the key on each host, using a password from your password manager one time.
4. Writes SSH config entries so `ssh orion-dev-01` just works.
5. Writes instructions telling Claude which hosts exist and how to reach them.

No password is ever written to disk, and Claude never sees one.

```
roster discover 10.0.1.0/24 --write     # scan the network into roster.yml
roster setup                            # one time on each box
roster hosts --find orion              # what's there
roster run net-sw-core-01 -- show ver   # password-only gear, password fetched for you
```

## Install

Requires Python 3.10+, the OpenSSH client, and [uv](https://docs.astral.sh/uv/). nmap is optional but recommended for `discover`.

```bash
# try it from the project folder
uv sync
uv run roster --help

# or install the `roster` command for your user (recommended on boxes Claude uses)
uv tool install .
roster --help
```

If you don't install it as a tool, Claude's instructions automatically use the full path to the project's Python, so Claude can still run it.

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
| `ip`, `port`, `user` | How to reach it over SSH (port defaults to 22) |
| `title`, `description`, `type`, `product` | Who the box is; searchable with `roster hosts --find` |
| `web` | Web UI URL; listed for Claude and checked by `roster check` |
| `services` | Other ports to know about and check, e.g. `{ postgres: 5432 }` |
| `auth` | Where the password comes from (see below) |
| `enroll` | `true` installs a key (default); `false` for gear that only takes passwords |
| `reviewed` | `false` on scanned hosts; `setup` skips them until you flip it |

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
| `run HOST -- CMD` | Run a command; password-only hosts get their password from the provider |
| `providers` | Available providers, whether their tools are installed, unknown ones in use |
| `auth-check` | Test every group's password source without printing anything secret |
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
uv run pytest            # 53 tests, no network or SSH server needed
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
tests/              pytest suite + fake password-manager CLIs
```

### Trying it safely

- `roster setup --dry-run` shows which hosts would get a key without touching them.
- `--only` lets you start with one host or group.
- `roster revoke` undoes `setup`.
- To experiment without real servers, run an SSH server in a container (for example the `linuxserver/openssh-server` image with password auth enabled), point a `roster.yml` at it, and run the full flow.
