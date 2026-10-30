# 39: Mesh: Host-to-Host access from one Box

**Iteration:** 6 · **Repo:** roster (CLI and app) · **Issue:** [#71](https://github.com/2styx2/roster/issues/71)

**Why:** Decision Q63 (owner, 2026-10-30). Installing and updating roster on every machine so they can reach each other is a chore. roster runs on one Box and sets up the Mesh itself, with nothing installed on the Hosts.

**What to build:** Read Q63 in `docs/app/decisions.md`: it holds every settled edge case. In short:

- **Inventory.** `mesh: true` cascades `defaults` → group → Host; top-level `links:` (Host or group → Host or group, one-way, `both: true`); unreviewed Hosts never join; each Host logs in to a peer as that peer's configured user. Validation with clean errors (unknown names, self-links).
- **`roster mesh`.** `--dry-run` plan (who reaches whom, what changes on which Host, password peers, unreachable links), then apply: a key made on each source Host, installed on its peers tagged `roster-mesh:<host>` with `from="<ip>"`, `no-agent-forwarding`, `no-X11-forwarding`; peers' recorded host keys into the source's `known_hosts`; an ssh config and a `ROSTER.md` of its peers on each source (imported from `~/.claude/CLAUDE.md` when Claude is installed). Idempotent ("already in the mesh"), one connection at a time. `roster setup` runs it for meshed groups.
- **Password peers.** `enroll: false` and appliances stay in the mesh: ssh asks the person; `ROSTER.md` tells Claude to ask the user. No password is ever copied to a Host.
- **ESXi** both ways, with persistent key and config locations; `roster check` notices a reboot that lost them.
- **Links across networks** are tested from the source (port 22 reachable) and reported, not assumed.
- **Removal and drift.** Removing a Host, a link or `mesh` removes exactly its tagged entries; down Hosts are "pending" and finished later; `roster check` reports drift; `--rotate HOST`.
- **`roster mesh cut HOST`.** Immediate and parallel: HOST's key off every peer, every peer off HOST, the Box's own access kept, `mesh: false` written as a Pending change. Every peer confirmed; down or silent peers get a loud "cut pending on N Hosts" warning until finished.
- **`roster serve`** methods for plan, apply, cut and status, with error codes in `docs/app/errors.md`.
- **App.** A mesh switch on groups and Hosts, Links in the Inventory editor, each Host's reach ("can reach 7 Hosts") and Links drawn on the network map, "mesh out of date" with a one-key apply after Publish, and a one-key Cut with its confirmation and warnings. UI follows `emil-design-eng`, `docs/app/design/taste.md`, and the `animate` skill for any motion.

**Blocked by:** 10, 26 (done). Plan it with a research step first (ESXi persistence, `authorized_keys` options on appliances).

**Status:** ready-for-agent

- [ ] `mesh: true` / `links:` parse, cascade and validate; unreviewed Hosts excluded.
- [ ] `roster mesh --dry-run` shows the full plan; apply is idempotent and touches nothing outside its tagged entries.
- [ ] Private keys never leave their Host; no password or vault access reaches any Host.
- [ ] Password peers prompt; `ROSTER.md` says so to Claude.
- [ ] ESXi works as source and target across a reboot.
- [ ] Unreachable cross-network links are reported, not written as working.
- [ ] Removal, `--rotate` and drift reporting work; down Hosts end "pending".
- [ ] `roster mesh cut` removes HOST everywhere in parallel, keeps the Box's access, records the Pending change, and warns per Host that didn't confirm.
- [ ] App: switches, Links, reach, out-of-date apply and Cut, tested through the typed client with the fake backend.
- [ ] Tests use stand-in ssh Hosts (tests/fakes); nothing touches real Hosts.
