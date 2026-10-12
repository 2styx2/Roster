# Setting up roster on a new box

Use this to give another machine (your laptop, a teammate's box, a jump host, a box where Claude runs) the same access to the network. Each box gets its own SSH key, and passwords always come from the shared vault, so there's nothing secret to copy around.

You need three things:

1. **roster itself**: this repository.
2. **The team's `roster.yml`**: the host list. It holds hosts, users and vault item names, but no passwords. Get it from wherever your team keeps it (an infra repo, a shared drive, or a teammate).
3. **Access to the vault** the `roster.yml` points at, with the same items (`bw:...`, `op:...`).

## 1. Prerequisites

- Linux, macOS or WSL with Python 3.10 or newer
- The OpenSSH client (`ssh`, `ssh-keygen`, `ssh-keyscan`)
- [uv](https://docs.astral.sh/uv/): `curl -LsSf https://astral.sh/uv/install.sh | sh`
- Your password manager's CLI:
  - Bitwarden: `npm install -g @bitwarden/cli`, or the standalone binary from https://bitwarden.com/help/cli/
  - 1Password: https://developer.1password.com/docs/cli/get-started/
- Network access to the subnets in `roster.yml`
- Optional: `nmap`, if this box will run `roster discover`

## 2. Install roster

```bash
git clone git@github.com:2styx2/roster.git
cd roster
uv tool install .          # puts `roster` in ~/.local/bin
roster --help              # if not found: export PATH="$HOME/.local/bin:$PATH"
```

No git access on that box? Use `git archive --format=zip -o roster.zip HEAD` on a box that has it, copy the zip over, unzip it, and run `uv tool install .` inside.

## 3. Put the host list in place

```bash
mkdir -p ~/infra
cp /path/to/roster.yml ~/infra/
cd ~/infra                 # roster reads ./roster.yml; run roster commands from here
```

roster looks for its config in this order: `-c PATH`, `$ROSTER_CONFIG`, `./roster.yml`, `~/.config/roster/roster.yml`.

## 4. Unlock the vault

**Bitwarden**

```bash
bw login                   # once. Headless box: export BW_CLIENTID=... BW_CLIENTSECRET=...; bw login --apikey
bw sync

# let every roster run on this box (including Claude sessions) use the unlocked vault
mkdir -p ~/.config/roster
(umask 077; bw unlock --raw > ~/.config/roster/bw-session)
```

roster only uses the session file if only you can read it (mode 600). When the vault locks or the session expires, roster tells you; rerun the `bw unlock` line. `bw lock` ends the session.

**1Password:** use the desktop app integration, `eval $(op signin)`, or `OP_SERVICE_ACCOUNT_TOKEN` on a headless box.

## 5. Check that every credential can be found

```bash
roster providers           # the password manager you use should say [tool found]
roster auth-check          # every vault reference should say "ok"; nothing secret is printed
```

`auth-check` only checks that a value exists. The next step checks it against the hosts.

## 6. Run setup

```bash
roster setup --dry-run     # shows what it would do
roster setup
```

On this box, setup does the following:

1. Creates `~/.ssh/roster_ed25519`, tagged with this box's name (`box_name:` in roster.yml, or the hostname).
2. Records each host's fingerprint in `~/.ssh/roster_known_hosts`.
3. Installs the key on every `enroll: true` host that doesn't accept it yet. It logs in once with the vault password to do this.
4. Writes `~/.ssh/config.d/roster`, so `ssh <name>` works.
5. Writes `ROSTER.md`, `CLAUDE.md` and `.claude/settings.json` in the folder you ran it from.

Hosts with `reviewed: false` are skipped. If a host fails (no answer, wrong password), the rest carry on. Fix it, then run `roster setup` again: hosts that already work are skipped.

## 7. Test

```bash
roster check                              # SSH, web UIs and service ports on every host
ssh <key-host> hostname                   # key login
roster run <password-host> -- hostname    # password login (switches, ESXi, appliances)
roster web <host> [service] GET /path     # web API with the service's stored login
```

For ESXi or vCenter (`login: vsphere`), a read-only call that proves the login works:

```bash
echo '<urn:CurrentTime><urn:_this type="ServiceInstance">ServiceInstance</urn:_this></urn:CurrentTime>' > /tmp/ct.xml
roster web <esxi-host> api POST /sdk -d @/tmp/ct.xml      # HTTP 200 with <returnval>...
```

## 8. Use it with Claude

```bash
cd ~/infra && claude
```

`CLAUDE.md` imports `ROSTER.md`, so Claude knows the hosts and reaches them through `ssh`, `roster run` and `roster web` without seeing passwords. After editing `roster.yml`, run `roster sync` to refresh `ROSTER.md` and the SSH config.

## Keeping it up to date

```bash
cd ~/roster && git pull && uv tool install --force .     # new roster version
cp /path/to/updated/roster.yml ~/infra/ && roster sync   # new host list
roster setup                                             # new key hosts get this box's key
```

## Removing a box

```bash
roster revoke              # removes this box's key from every host
```

Then delete `~/.ssh/roster_ed25519*`, `~/.ssh/config.d/roster` and `~/.config/roster/bw-session`.
