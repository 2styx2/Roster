# The Mesh: Hosts that reach each other

roster runs on one Box and sets up Host-to-Host access itself: Hosts in a meshed group, or joined by a Link, can `ssh` to each other with keys roster makes on them. Nothing is installed on the Hosts, and no password, vault or copy of roster ever reaches one. Each Host logs in to a peer as **that peer's** user from `roster.yml`.

The Mesh isn't a VPN: a VPN makes the network path, and the Mesh decides who may log in where over the network you already have. The two combine.

## Saying who reaches whom

`mesh: true` on a group lets its Hosts reach each other, both ways. It cascades like every other setting (`defaults` → group → Host), so `mesh: true` in `defaults` meshes every group, including ones `discover` adds later. `mesh: false` opts a group or a Host out, of its group's Mesh and of every Link. Unreviewed Hosts never join.

`links:` at the top of `roster.yml` add one-way reach across groups and networks, from a Host or group to a Host or group. `both: true` makes it two-way.

```yaml
groups:
  lab:
    mesh: true                      # every lab Host reaches every other lab Host
    hosts:
      orion-2: 10.0.0.2
      esx-02: { ip: 10.0.0.12, user: root }
      sw-1: { ip: 10.0.0.20, enroll: false, auth: prompt }
  storage:
    hosts:
      nas-1: 10.0.0.30

links:
  - { from: orion-2, to: storage }            # orion-2 reaches every storage Host
  - { from: lab, to: nas-1, both: true }      # and nas-1 reaches the lab back
```

A Link that names something that isn't a Host or a group, links a name to itself, or has a key other than `from`, `to` and `both` stops `roster.yml` from loading, with the entry's number in the message. A name that is both a Host's and a group's is refused too.

Editing `roster.yml` from roster keeps `links:` in step: renaming a Host or a group (`host.rename`, `group.rename` in the app) renames it in `links:` too, and removing a Host or deleting a group takes out the `links:` entries that name it, line and all (the next `roster mesh` removes what they gave). An entry in a one-line list (`links: [{ from: a, to: b }]`) can't be taken out that way: the edit is refused and says so, and you take it out by hand.

**Password peers.** A Host with `enroll: false` (switches, appliances) stays in the Mesh as a password peer: its peers get an ssh config entry for it, and ssh asks the person for the password. roster never copies a password to a Host, and the `ROSTER.md` there tells Claude to ask the user to log in. A password Host can't reach others: roster only logs in to it with a password, so it never writes files on it (`roster mesh` lists those Links as `skipped`).

## roster mesh

```
roster mesh --dry-run        # the plan: who reaches whom, what changes on which Host
roster mesh                  # apply it, one Host at a time
roster mesh --rotate esx-02  # replace esx-02's Mesh key everywhere
roster mesh status           # who reaches whom and what's unfinished, without connecting
roster mesh cut orion-2      # take orion-2 out of the Mesh now, everywhere
```

`roster mesh` connects to each Host it needs, through this Box's own key, **one connection at a time** (rate limiters). It runs in two passes:

1. On each source (a Host that reaches peers): makes its key there if it has none, reads the public half back, and tests from there whether each peer's ssh port answers (`nc -z`, else bash's `/dev/tcp`).
2. On every Host it visits: writes the source's files, and puts each source's public key in the peer's `authorized_keys`.

On a source it writes:

| What | Where (Linux) | What's in it |
|---|---|---|
| The Mesh key | `~/.ssh/roster-mesh/id_ed25519` | Made on the Host with `ssh-keygen`. The private key never leaves it |
| Known hosts | `~/.ssh/roster-mesh/known_hosts` | The peers' host keys as this Box recorded them, so ssh checks them strictly |
| ssh config | `~/.ssh/roster-mesh/config`, included from the top of `~/.ssh/config` | A `Host PEER` block per peer, so `ssh PEER` works |
| `ROSTER.md` | `~/ROSTER.md` | The Host's peers only, for Claude there; imported from `~/.claude/CLAUDE.md` (an `@~/ROSTER.md` line) when Claude is installed |

On a peer it adds one line per source to `authorized_keys`:

```
from="10.0.0.2",no-agent-forwarding,no-X11-forwarding ssh-ed25519 AAAA… roster-mesh:orion-2
```

`from=` accepts the key only from the source's address, and the `roster-mesh:SOURCE` tag is how roster finds exactly its own lines again. Everything else in the file, including this Box's own `roster-managed` key, is never touched. Every file roster changes on a Host (`authorized_keys`, `~/.ssh/config`, `~/.claude/CLAUDE.md` and its own) is written to a new file beside it and moved into place, keeping the old one's mode and owner, so a run cut short (a timeout, a dropped connection) leaves each file as it was or as it should be, never half written. A `~/ROSTER.md` that roster didn't write is left alone, with a warning.

**Idempotent.** The Mesh comes from `roster.yml` only, so applying it again, from this Box or any other, changes nothing and says `already in the mesh`.

**Links across networks are tested, not assumed.** A peer whose port the source can't reach is reported (`orion-3 can't reach 10.0.9.9:22`) and left out of that source's files and of the peer's `authorized_keys`. A peer whose host key this Box hasn't recorded is left out too (`roster setup --only PEER` records it). If the source has neither `nc` nor bash, the Link is written and shown as not tested. A source behind NAT reaches its peers from another address than the one in `roster.yml`; `from=` refuses it there, so keep such Links out until a `via:` hop exists. `from=` also holds the address as `roster.yml` writes it: a DNS name matches only where sshd has `UseDNS yes`, so give meshed Hosts their addresses.

**Down Hosts.** A Host that doesn't answer is *pending*: everything else is applied, its Sources' keys stay on their peers as they were, and the next `roster mesh` finishes it. `roster mesh` and `roster mesh status` list what's pending until then. From the app, an apply or a cut that runs out of time (serve's deadline for it) stops there rather than outlast the app's wait: the Hosts it didn't get to are pending, `out of time`, and the next run finishes them.

**Removing.** Taking a Host out of `roster.yml`, a Link, or `mesh: true` removes exactly its tagged entries on the next apply, and a Host that is no longer a source loses its Mesh files (the key, known hosts, config, the two `Include` lines, `ROSTER.md` and the import line). A Host taken out of `roster.yml` altogether can't be reached any more, so its own Mesh files stay there; `roster mesh` says so.

**Rotating.** `roster mesh --rotate HOST` makes a new key on HOST and replaces its line on every peer, in the same run. `--dry-run` shows it first.

`roster setup` applies the Mesh after setting up the Box when `roster.yml` has one (not with `--only`, since the Mesh covers every Host). `roster sync` says `mesh out of date` when `roster.yml` changed the Mesh since the last complete apply on this Box; nothing applies it by itself.

## Cut

`roster mesh cut HOST` takes HOST out of the Mesh **now**, without waiting for a Publish: on every Host at once (in parallel), HOST's key comes out of `authorized_keys`, every peer's key comes out of HOST's, and HOST's own Mesh files go. This Box's own access stays, so you can investigate; `roster revoke` is separate.

It then writes `mesh: false` for HOST in `roster.yml` as a Pending change, so the cut survives the next Publish. (When `roster.yml` isn't in a git repo, it's written straight to the file.)

Every Host is confirmed. One that's down or doesn't answer gets a loud warning, `CUT PENDING ON 2 HOSTS`, on every `roster mesh` run until the cut is finished there, by `roster mesh cut HOST` again or by the next `roster mesh`.

## roster check

`roster check` (without `--only`) also checks the Mesh, read-only: whatever a `roster mesh` would change is **drift**, something on a Host that isn't what roster wrote, and is listed per Host (`nas-1: add key from orion-2`). Links that don't work (unreachable, no recorded host key) and pending Hosts make it fail too.

## ESXi

ESXi works as a source and as a peer, with everything kept where it survives a reboot:

- **As a peer**, keys go into `/etc/ssh/keys-USER/authorized_keys`, ESXi's own file, which it keeps across reboots. roster runs `/sbin/auto-backup.sh` after changing it, so it doesn't wait for the hourly backup.
- **As a source**, ESXi's home and the rest of `/etc` are rebuilt from the boot image on every boot: a new file there doesn't survive. So the key, known hosts, config and `ROSTER.md` go in `.roster-mesh` on the first datastore (`/vmfs/volumes/<datastore>/.roster-mesh`, by its fixed id). The `Include` in `~/.ssh/config` is lost at a reboot: `ssh -F /vmfs/volumes/…/.roster-mesh/config PEER` always works, and `ROSTER.md` there says so. `roster check` reports the lost `Include` as drift, and `roster mesh` puts it back.

## Appliances

Appliances that run Dropbear rather than OpenSSH ignore a whole `authorized_keys` line that has an option Dropbear doesn't know, and Dropbear doesn't list `from=`. Keep them `enroll: false`: they're password peers, which needs nothing on them.

## Where it's kept on this Box

`~/.config/roster/mesh.json` remembers what an apply or a cut couldn't finish (pending Hosts, cuts pending), the Hosts it wrote on, and what `roster.yml` looked like at the last complete apply (for `mesh out of date`). It's only bookkeeping: delete it and the next `roster mesh` still makes the Mesh what `roster.yml` says.
