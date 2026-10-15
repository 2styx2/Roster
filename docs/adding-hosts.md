# Adding hosts and their logins

The usual flow for bringing a new network or box into roster: scan it, review it, point each host at its vault item, then prove each login works. Passwords stay in the vault the whole time. `roster.yml` only gets the item's name.

## 1. Scan the network

```bash
cd ~/infra
roster discover 10.19.77.0/24             # preview, nothing written
roster discover 10.19.77.0/24 --write     # adds a discovered-YYYYMMDD group
```

`--write` does the following:

- Adds new hosts to the group with `reviewed: false`, `user: CHANGE-ME` (unless `defaults:` sets a user) and `auth: prompt`.
- Keeps your comments and saves `roster.yml.bak`.
- Never overwrites hosts that are already in the file.
- Refuses to write a file that wouldn't load.

Each host gets a guessed `type`, a `title` from its web page, its services, and a description of every open port.

Tell your security team before scanning big ranges.

## 2. Add the logins to the vault

Make one vault item per distinct login, with the username in the item's username field. Name it after the box or role so it's easy to match later, for example `ESXI web(10.19.77.206)` or `UNIFI web (10.19.77.1)`. Put the address in the name when two boxes share a role. Several hosts can point at the same item.

To see what's in the vault without exposing passwords (Bitwarden):

```bash
bw list items | jq -r '.[] | [.revisionDate[0:16], .name, (.login.username // "-")] | @tsv' | sort -r | head -20
```

## 3. Work out which box is which

Discovered hosts are named by address (`server-10-19-77-202`), and several can share a web title. Ways to tell them apart before any login:

| Clue | How |
|---|---|
| TLS certificate name | `echo \| openssl s_client -connect IP:443 2>/dev/null \| openssl x509 -noout -subject -ext subjectAltName` |
| Same machine on two addresses | Compare SSH host keys: `ssh-keyscan -t ed25519 IP1 IP2 \| ssh-keygen -lf -`. Matching fingerprints mean one box. |
| Real hostname | After a login works: `roster run HOST -- hostname` |

Certificates can mislead: a cert copied from another box names that box. The SSH host key and the hostname after login are the reliable clues.

## 4. Fill in the hosts

For each host you're bringing in, set its login and mark it reviewed:

```yaml
      server-10-19-77-202:
        reviewed: true
        user: ops
        auth: "bw:lab-hub3"
        enroll: false            # password logins for now; true = setup installs the key
        ip: "10.19.77.202"
        ...
```

- **`enroll: true`** for Linux servers you want key logins on. `roster setup` installs this box's key using the vault password once.
- **`enroll: false`** for gear that only takes passwords: switches, routers, ESXi (it keeps root keys outside `~/.ssh`), and appliances. Logins then go through `roster run`.
- A different login for the web UI or API goes in a service entry:

```yaml
        services:
          https: { url: "https://10.19.77.206", verify: false }
          api:   { url: "https://10.19.77.206", verify: false, login: vsphere }   # ESXi / vCenter SOAP API
          admin: { port: 8443, user: webadmin, auth: "bw:Some web item" }        # its own login
```

- Rename hosts to something people will search for, ideally the box's real hostname (`lab-hub3`, `esxi-02`). Set a real `title` and fix the guessed `type`. Don't shorten names: `hub2` and `lab-hub2` are different machines. Hosts you're not bringing in can stay `reviewed: false`. roster leaves them alone.

## 5. Test every login

```bash
roster auth-check --only discovered-20261012     # every vault reference resolves ("ok")
roster setup --only HOST1,HOST2                  # records fingerprints, installs keys on enroll: true hosts
roster run HOST -- hostname                      # SSH password login
ssh HOST hostname                                # SSH key login (enroll: true)
roster web HOST [SERVICE] GET /path              # web API with basic or bearer auth
roster web ESXI api POST /sdk -d @/tmp/ct.xml    # vSphere login (see docs/new-box.md for ct.xml)
roster sync                                      # refresh ROSTER.md and the SSH config
```

What the errors mean:

| Message | Meaning |
|---|---|
| `host key not recorded` | `roster setup --only HOST` hasn't been run for it yet, or the SSH port didn't answer when it ran |
| `no answer on SSH port` | SSH is off or filtered. ESXi often switches SSH off: enable it under Host → Actions → Services. |
| `login refused (wrong user or password?)` | Wrong item, wrong user, or a different box from the one you think. Check the host key (step 3). |
| bw "locked" / session expired | Run `(umask 077; bw unlock --raw > ~/.config/roster/bw-session)` again |

## Limits to know about

- **Generic form logins aren't supported by `roster web`.** Most appliance web UIs fall in this group, so use a browser for those. Supported: HTTP Basic, bearer tokens, `login: vsphere` (ESXi, vCenter), `login: openvpnas` (OpenVPN Access Server admin), `login: hub` (Hub web UI) and `login: unifi` (UniFi OS consoles: `services: { web: { url: "https://IP", verify: false, login: unifi } }`).
- **Old network gear** that offers SSH protocol 1.99 or old key exchange algorithms may need legacy options. Gear with telnet only can't be reached through roster.
- **Unreviewed hosts are refused** by `run`, `web` and `setup`, on purpose.

## 6. Share it

Commit and push the updated `roster.yml` to [yourteam/infra](https://example.com/yourteam/infra). Every box picks it up with `~/infra/bin/roster-pull`; add `--setup` to install keys on new key hosts. Vault items need to be shared with them (a shared Bitwarden collection or 1Password vault), or `auth-check` will fail on their box.

## Things that aren't hosts

A Wi-Fi network, a vendor portal or an API key goes under `resources:` instead of a group. It gets a fixed set of fields per type (`wifi`, `account`, `secret`) and an `auth:` vault reference, just like a host. See "Resources" in the README. Check it with `roster auth-check --only <name>` and `roster info <name>`.
