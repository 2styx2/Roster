# Connection errors: the catalog

Every way opening a Session can fail must end in a **clean error**, never a hang or a raw stack trace. A clean error:
- names the Host;
- says what went wrong, in plain words;
- says where the problem lives: `roster.yml`, the vault, this Box, the network, or the Host;
- gives the exact fix;
- keeps the raw message (ssh's stderr, or roster's message) one click away under "Details".

Edits made by hand to `roster.yml` or the vault get the same treatment as anything made in the app. `roster check HOST` and `:check HOST` run the same diagnostics on demand.

| # | What happened | Typical cause | Where it lives | Message (short) | Fix offered |
|---|---|---|---|---|---|
| 1 | `roster.yml` doesn't load | Bad YAML or a missing field after a hand edit | Inventory | "roster.yml has an error at line N: …" | Open the file; show roster's message |
| 2 | Host not in this Box's ssh config | `roster.yml` was edited but `roster sync` wasn't run | Box | "esxi-02 isn't in this Box's ssh config yet" | Button: run `roster sync` |
| 3 | Host is `reviewed: false` | Came from `discover` | Inventory | "esxi-02 hasn't been reviewed" | Review it (ticket 11) |
| 4 | No user set | Hand edit left the user out, or `CHANGE-ME` | Inventory | "No SSH user for esxi-02" | Edit the Host |
| 5 | Login points at a provider that isn't set up | `auth: keeper:…` (a provider roster doesn't have), or a typo in the prefix | Inventory | "esxi-02's Login uses `keeper:`, which isn't set up on this Box" | Show the provider list (`roster providers`) |
| 6 | Vault CLI missing / not logged in | New Box; for KeePassXC, no `providers: kp: database:` (or `vault.kp.database` in init.lua) or the `.kdbx` (or key file) isn't on this Box | Box | roster's wording, e.g. "Bitwarden CLI isn't logged in - run `bw login` once", "KeePassXC database /home/you/roster.kdbx isn't there - …" | Show the command |
| 7 | Vault locked | Idle lock, or locked elsewhere | Vault | (lock screen) | Unlock; the Session opens afterwards (ticket 06) |
| 8 | Vault item not found | Typo in `bw:NAME`, item renamed or deleted | Vault / Inventory | "No vault item named 'esxi-02 ssh' (Login of esxi-02)" | Show near-matching item names; edit the Login |
| 9 | Several vault items match | Duplicate names | Vault | "Two vault items are named 'esxi-02 ssh'" | List them (name, last edited, URI); fix in the vault |
| 10 | Item has no password / no such field | Item made without a password, or `#FIELD` typo | Vault | "Vault item 'esxi-02 ssh' has no password" | Edit the item in the vault |
| 11 | Wrong password or user | Password rotated on the Host but not in the vault, or the reverse | Vault / Host | "esxi-02 refused the password for user root" | Check the item; save it again after a successful login |
| 12 | Key refused | `enroll: true` but the key isn't installed (setup not run, key removed) | Box / Host | "esxi-02 didn't accept this Box's key" | Run `roster setup --only esxi-02`, or set `enroll: false` |
| 13 | Host key changed | Reinstalled box, or IP reused, or a MITM | Host / network | "esxi-02's host key changed. Not connecting." | Show old and new fingerprints and how to verify. **Never auto-accept.** |
| 14 | Host key unknown | Fingerprints not recorded for this Host | Box | "No recorded host key for esxi-02" | Opening a Session asks first (rows 60-63, ticket 36); `:check` says to run `roster setup --only esxi-02` after verifying it |
| 15 | Name doesn't resolve | Typo in `ip:` or a DNS name | Inventory / network | "Can't resolve 'esxi02.lab'" | Edit the address |
| 16 | Connection refused | Wrong port, or sshd not running | Inventory / Host | "esxi-02:2222 refused the connection" | Check the port in `roster.yml`; is sshd up? |
| 17 | Timeout / unreachable | Host down, routing, firewall, **or the 10.19.x SSH rate limiter** (times out for about 4 minutes after many connections) | Network | "esxi-02 didn't answer within 10 s" | Retry later. For 10.19.x, mention the rate limiter and suggest waiting a few minutes, not hammering. |
| 18 | Unexpected password prompt | Password expired or change required, OTP, or unusual keyboard-interactive wording | Host | "esxi-02 asked something roster won't answer: '<prompt>'" | Log in by hand once (Quick Connect) to handle it |
| 19 | Too many auth failures | The ssh agent offers many keys before the password | Box | "esxi-02 cut the connection after too many key attempts" | Fix: `IdentitiesOnly` in roster's ssh config (roster-side) |
| 20 | Session dropped | Network blip, Host reboot | Network / Host | "Session ended (code 255): connection reset" | Reconnect (`␣ r`) |
| 21 | `roster serve` died | Crash, WSL restart | Box | "Lost the connection to roster" | Restart the backend; open Sessions keep running |

## Signing in

The lock screen signs a new Box's vault CLI in through roster's `vault.login` (roster's docs/serve-api.md "Signing in: vault.login"; the research is in `docs/app/dev/vault-auth.md`). Its failures come from the same catalog, keyed by roster's code. The lock screen shows the message, where it lives, the fix, and roster's text under Details. A 50, and a 10 at the master-password step, keep the sign-in on its step with the field emptied. Every other failure ends the sign-in and goes back to the screen it started from: the server choice for 53 and 57, the unlock form for 54.

| # | Code | What happened | Where it lives | Message (short) | Fix offered |
|---|---|---|---|---|---|
| 22 | 10 | Wrong email or master password (or the account is on another server) | Vault, sign-in form | "Bitwarden didn't accept that email and master password (on bitwarden.com)" | Check the email, the password and the server |
| 23 | 13 | The provider has no sign-in roster can drive (1Password, `env`, …) | Box | "1Password signs in through its desktop app, not here: …" | Set it up on the Box the way the message says |
| 24 | 50 | Two-step or new-device code wrong or expired (Bitwarden doesn't tell those apart) | Sign-in form | "Bitwarden didn't accept that code (wrong or expired) - a new code is on its way to your email" | Type the current code (stays on the step) |
| 25 | 51 | The account's only two-step methods are ones the CLI can't do (FIDO2/WebAuthn, Duo), or SSO with trusted-device or passkey decryption | Vault | "the Bitwarden CLI can't do this account's two-step login: FIDO2 security keys and Duo aren't supported by the CLI - …" | Use an API key, or add an authenticator app, email or YubiKey OTP in the web vault |
| 26 | 52 | Too many attempts | Vault | "bitwarden.com refused: too many sign-in attempts" | Wait a few minutes |
| 27 | 53 | Server unreachable: DNS, refused, TLS, no answer in 40 s | Network, sign-in form | "can't reach the Bitwarden server vault.example.com (…)" | Check the address and the network |
| 28 | 54 | The CLI is already logged in on this Box | Box | "the Bitwarden CLI is already logged in on this box as … - unlock it instead" | Unlock (the app switches to the unlock form); "Use a different account" or `:vault signout` to switch account (ticket 42) |
| 29 | 55 | No sign-in in progress: finished, cancelled, replaced, or 10 minutes idle | roster | "no sign-in in progress (…) - start again" | Start again |
| 30 | 56 | SSO failed in the browser or wasn't finished within 5 minutes | Vault | "the SSO sign-in failed in the browser - try again" | Start SSO again |
| 31 | 57 | The self-hosted address isn't one | Sign-in form | "'vault example com' isn't a server address - …" | Pick cloud or EU, or type an https:// address |
| 32 | 58 | API key not accepted, or an organization key | Sign-in form | "Bitwarden didn't accept that API key (client_id or client_secret)" | Copy the personal key again from the web vault |
| 33 | 59 | Anything else; bw's own words | Vault | "Bitwarden sign-in failed: …" | See Details; `bw login` in a terminal shows the same |

## Signing out

"Use a different account" on the lock screen and `:vault signout` sign the vault CLI out through roster's `vault.logout` (roster's docs/serve-api.md "Signing out"), after asking "Sign out of you@example.com on this Box?". roster forgets every secret it holds first (askpass tokens, typed passwords held for "Save to vault", session keys), then runs `bw logout`, so a failure here never leaves a secret behind. The lock screen shows the message in place of the question; Esc goes back to the unlock form.

| # | Code | What happened | Where it lives | Message (short) | Fix offered |
|---|---|---|---|---|---|
| 71 | 15 | The CLI was already signed out (in a terminal, or a moment ago) | Box | "the Bitwarden CLI isn't signed in on this box - there's no account to sign out of" | None needed: the app goes straight to the sign-in form |
| 72 | 16 | `bw logout` failed some other way | Vault / Box | "`bw logout` failed: …" (bw's words) | See Details; `roster bw logout` in a terminal shows the same |
| — | 13 | The provider has no account: KeePassXC, `pass`, `env`, `cmd` | Box | "KeePassXC has no account to sign out of: it opens a local database file. To use another one, change vault.kp.database in init.lua" | No link on the lock screen; `:vault signout` says this |

## Saving to the vault

"Save to vault" creates a Vault item through roster's `vault.create_item` (roster's docs/serve-api.md "Saving to the vault"). It runs after the test login succeeds and before the Pending change is added (Q43); if adding the Pending change fails, `vault.undo_create` removes the item again.

| # | Code | What happened | Where it lives | Message (short) | Fix offered |
|---|---|---|---|---|---|
| 34 | 60 | An item with exactly that name already exists | Vault | "a Bitwarden item named 'esx-02 ssh' already exists - …" | Point the Login at the existing item, or pick another name |
| 35 | 61 | The provider can only read Logins (1Password, `pass`, `env`, …) | Box | "provider 'op' can't save to the vault - …" | Save to `bw` or `kp`, or make the item by hand |
| 36 | 62 | The vault CLI refused: no rights to the collection, an organization policy, the server; for KeePassXC a read-only `.kdbx`, a missing `group`, or a title with `/` | Vault | "Bitwarden didn't create 'esx-02 ssh': …" | See Details; check your rights |
| 37 | 63 | An undo for an item this `roster serve` didn't create, or one already undone | roster | "item … wasn't created by this roster serve …" | Nothing to undo |
| 58 | 64 | `save_to` names an organization, collection or KeePassXC group that isn't there, an organization you're only invited to, or a shape the provider doesn't have (ticket 35) | `roster.yml`, init.lua, or the form's Save to | "no Bitwarden organization 'My Tem' that you can save to (yours: My Team) - fix providers: bw: save_to: organization: in roster.yml" | Fix that setting, or pick another place in Save to. In the form it shows under Save to, which then needs a choice |
| 59 | 65 | The collection is one you may only read. bw's CLI doesn't say so beforehand: the item came back outside it, so roster took it out again | Vault | "you can only read the Bitwarden collection My Team / Audit, so nothing can be saved there; 'esx-02 ssh' was taken back out" | Pick a place you can write to, or ask an organization admin. That collection isn't offered again until the vault is locked |

## Editing the Inventory

`:edit HOST` pulls the infra repo first (fast-forward only), then writes the edit into `roster.yml` through roster's `host.update` as a Pending change. A change to the address, port, user or Login first passes `host.verify_login` (decision Q43): one connection, one login attempt, and the host key compared with the recorded one (for the new address, or the Host's current one if it moved), never accepted. A Host that moved gets that key recorded for its new address once the edit is written. A failed test login shows its steps like `:check`, with rows 4-17 for the failing step. A failed pull keeps the form shut.

| # | Code | What happened | Where it lives | Message (short) | Fix offered |
|---|---|---|---|---|---|
| 38 | 70 | `roster.yml` isn't committed in a git repo, so it can't have Pending changes | `roster.yml`, Box | "/home/you/roster.yml isn't in a git repo, so it can't have Pending changes" | Keep it in the infra repo, or edit by hand |
| 39 | 71 | The pull found uncommitted changes: Pending changes, or other files | Infra repo | "roster.yml has Pending changes, so roster won't pull over them" | Publish or discard them; button: Show Pending changes |
| 40 | 72 | This Box's branch and its upstream both have new commits | Infra repo | "this box's infra repo and origin/main have diverged (1 local and 2 new commits there)" | Merge or rebase in a terminal (`git pull --rebase`) |
| 41 | 73 | The fetch or the fast-forward failed: network, access, a file in the way | Network, infra repo | "couldn't fetch origin/main for the infra repo" | Check the network and access; git's words under Details |
| 42 | 74 | The edit's result wouldn't load, would load differently, or would change another entry (a YAML alias) | `roster.yml` | "can't make that edit: the result wouldn't load - nothing was written" | Make the edit by hand; nothing was written |
| 43 | 75 | An address, user or Login change without a test login that just succeeded | roster | "esx's new address, user or Login hasn't passed a test login" | Test the login, then save again |

## Adding a Host

`:host add` (Leader `+`) pulls first, like `:edit`, then adds the Host through roster's `host.add` as a Pending change. A Host with a Login is a verified add (decision Q43): the address's host key is scanned (`host.scan_key`) and shown for the user to confirm, then one test login runs, then a typed password is saved to the vault (rows 34-36), then the Host is written; if writing the Host fails, the new Vault item is taken back out. A failed test login shows its steps like `:check`, with rows 4-17 for the failing step, and nothing is written. A key the user doesn't trust, or one that differs from the recorded key (row 13), ends it there, with no login tried. A Host without a Login goes in unreviewed, with no network at all.

| # | Code | What happened | Where it lives | Message (short) | Fix offered |
|---|---|---|---|---|---|
| 44 | 80 | A bad name, group, address, user or port, or no user to log in as | `roster.yml` (the form's field) | "bad host name 'nas 1' (use letters, digits, . _ -)" | Fix that field; nothing was written |
| 45 | 81 | A Host by that name is already in the Inventory | `roster.yml` | "host 'esx' is already in the Inventory (group lab)" | Pick another name, or `:edit` that Host |

## Publishing

`:publish` (or Publish… in `:changes`) keeps the diff on screen for a last look, with roster's commit message (it names every Host and group that changed) ready to edit. Publish runs roster's `changes.publish`: fetch, commit `roster.yml` alone with the infra repo's own git identity, push to the branch's upstream, then `roster sync` (decision Q13). It never forces. Every refusal below leaves the Pending changes as they were, and the panel shows the row with git's words under Details. A fetch that fails is row 41 (code 73); a `roster.yml` that doesn't load is row 1. A `roster sync` that fails after the push doesn't undo the Publish: the panel says so and offers `roster sync` to copy.

| # | Code | What happened | Where it lives | Message (short) | Fix offered |
|---|---|---|---|---|---|
| 46 | 90 | Nothing pending | `roster.yml` | "roster.yml has no Pending changes, so there's nothing to publish" | Edit a Host first |
| 47 | 91 | Other files in the infra repo are uncommitted too | Infra repo | "the infra repo has other uncommitted changes (README.md), so roster won't publish" | Commit, stash or undo them in a terminal |
| 48 | 92 | Someone else published `roster.yml` since this Box pulled (new upstream commits that leave `roster.yml` alone are fast-forwarded over instead) | Infra repo | "someone published roster.yml to origin/main since this box pulled (1 new commit), so roster won't publish over it" | Discard, `:pull`, and make the change again; or `git stash && git pull --ff-only && git stash pop` |
| 49 | 93 | This Box has commits of its own that aren't on the upstream | Infra repo | "this box's infra repo has 1 commit that isn't on origin/main, and roster publishes only its own" | Push or drop them in a terminal |
| 50 | 94 | The branch has no upstream | Infra repo | "this branch of the infra repo has no upstream, so there's nowhere to publish to" | `git push -u origin main` |
| 51 | 95 | git refused the commit: no identity, a hook | Infra repo, Box | "git didn't make the commit, so nothing was published" | Set the repo's `user.name`/`user.email`; git's words under Details |
| 52 | 96 | The push failed, was rejected because the upstream moved meanwhile, or didn't finish in 60 s and didn't get there; the commit is undone. (One that didn't finish but did get there is a Publish.) If roster can't even check, it says so | Network, infra repo | "origin/main moved while roster was publishing, so the push was refused; nothing was published" | Publish again (it fetches first); check your rights to push; for "couldn't check", look at the upstream's last commit first |


## The Live Inventory

Removing, renaming and moving Hosts and groups in the Sidebar (decision Q45) goes through roster's `host.remove`, `host.rename`, `host.move` and `group.new|rename|delete`, each a Pending change. A bad name is row 44 (code 80), an unknown Host code 2, a result that wouldn't load row 42 (74). An outside edit of `roster.yml` that doesn't load is row 1: the last good Inventory stays on screen, and the message names the line (`roster.yml:12 has an error (…): the last good Inventory is still in use`); it recovers once the file loads. `folders.yml` does the same with the last good Folders.

| # | Code | What happened | Where it lives | Message (short) | Fix offered |
|---|---|---|---|---|---|
| 53 | 100 | The new name is already a Host's or a group's | `roster.yml` | "host 'esx' is already in the Inventory (group lab)" | Pick another name; nothing was written |
| 54 | 101 | No group by that name | `roster.yml` | "no group named 'dmz' in roster.yml (groups: lab, other)" | Pick one of the groups, or `:group new` it first |
| 55 | 102 | Deleting a group that still has Hosts, without saying where they go | `roster.yml` | "group lab still has 2 Hosts (esx, nas) - say which group they go to, or move them first" | `:group delete lab OTHER` (the app asks with the command line) |
| 56 | 103 | A moved Host would come out different in its new group (a service or Login it inherits there) | `roster.yml` | "esx would come out different in group other (services it inherits there) - nothing was written" | Move it by hand, setting those on the Host itself |
| 57 | none (not an error) | One service entry roster can't use: a bad port or url, an unknown setting, a `login:` type that's neither roster's nor in `web_login_names:`. The file still loads; only that service is left out, and the Host lists it in `problems` (`{service, message, fix}`) | `roster.yml` | "roster.yml loaded, but left out lab-hub2's service web: login: 'appliance' isn't a login type roster knows (roster info lab-hub2 says how to fix it)" | The fix from roster (`roster info HOST`, or the warning `roster hosts` prints); `roster web HOST SERVICE` on it stops with the same words |

## Trusting a new host key

A Session to a Host whose host key isn't in roster's known hosts asks before anything connects (decision Q60): `session.prepare` refuses with 44, the app fetches the key (`host.scan_key {host}`: one connection, key exchange only) and shows the Host, its address and port, the key type and the SHA256 fingerprint, with "roster hasn't seen this Host's key before". **Trust and connect** (Enter) runs `host.trust_key`, which fetches the key again and records it only if it's still the one shown, then opens the Session. **Cancel** (Esc) records nothing and connects nothing. Sessions check host keys strictly (`StrictHostKeyChecking=yes`), so a key that differs from a recorded one is row 13, never a question. Every failure below ends with nothing recorded and no Session; the question's pane shows it like any refused Session.

| # | Code | What happened | Where it lives | Message (short) | Fix offered |
|---|---|---|---|---|---|
| 60 | 44 (from `session.prepare`, not shown as an error) | No key recorded for the Host's address: it reached `roster.yml` by a hand edit or a teammate's Publish | Box | The question: "roster hasn't seen this Host's key before" | Compare the fingerprint with the Host's console or owner, then Trust and connect, or Cancel |
| 61 | 40, 41, 42 | Couldn't fetch the key: the address doesn't resolve, the port refused, or no answer (on 10.19.x often the SSH rate limiter) | Network / Host | "esxi-02 (10.19.77.10:22) didn't answer within 5 s" | Rows 15-17's fixes: check the address or port; for 10.19.x wait a few minutes, don't retry in a loop |
| 62 | 23 | The key changed between the question and Trust | Host / network | "esxi-02's host key changed while roster was asking - nothing was recorded" | Don't trust it blindly: compare the new fingerprint with the Host's console or owner, then open the Session again to see it |
| 63 | 43 | A different key got recorded for the address meanwhile (another Session's question, `roster setup`) | Host / network | "esxi-02's host key changed - not connecting" | Row 13's: compare the fingerprints; never accepted automatically |

## Quick Connect

A Session to `user@address[:port]`, a box that isn't in the Inventory (decision Q67). The tab fetches the key (`host.scan_key {address, port}`) and asks for it to be confirmed, with the password, in the connect card; `quick.prepare` then fetches it again and returns the Session's command. Its Problems name the box as `user@address`, and leave out the fixes that only apply to a Host (`:check`, `roster setup --only`). Every failure below connects nothing and records nothing.

| # | Code | What happened | Where it lives | Message (short) | Fix offered |
|---|---|---|---|---|---|
| 64 | 40, 41, 42 | Couldn't fetch the key: the name doesn't resolve, the port refused, or no answer (on 10.19.x and 10.19.x often the SSH rate limiter) | Network / the box | "root@10.0.0.5 (10.0.0.5:22) didn't answer within 5 s" | Rows 15-17's: check the address or port; for a rate-limited network wait a few minutes, don't retry in a loop |
| 65 | 43 | roster recorded a different key for that address (a Host there, or `roster setup`) | the box / network | "root@10.0.0.5's host key changed - not connecting" | Compare the fingerprints with the box's console or owner; if the change is expected (a reinstall), delete its line in `~/.ssh/roster_known_hosts`. Never asked about |
| 66 | 23 | The key changed between the question and Enter | the box / network | "root@10.0.0.5's host key changed while roster was asking - not connecting" | Row 62's: compare it, then Retry, which asks again with the new key |
| 67 | none (ssh's) | The box refused the password, or this Box's keys when it was left empty | the box | Rows 11-12's, naming `root@10.0.0.5` | Check the user and password, then Reconnect (it asks again) |

## Save to vault after a Session's login

"Save to vault", ticked under a Session's password, saves that password only once the Session logged in with it (decision Q68): roster holds it, and ssh tells roster after the login. Then `quick.save` (a Quick Connect becomes a Host) makes the Vault item `<host> ssh` and adds the Host, and `host.save_login` (an `auth: prompt` Host) makes it and points the Host's Login at it; a Host that changed since its Session logged in is row 43 (75). Their failures reuse rows 34-37 and 58-59 for the vault (an item by that name, 60, leaves the vault and the Inventory as they were) and rows 44-45 for the Host's name and group (80, 81); if the Host can't be written, the new item is taken back out, as with `host.add`.

| # | Code | What happened | Where it lives | Message (short) | Fix offered |
|---|---|---|---|---|---|
| 68 | 66 | The Session hasn't logged in with the typed password: not yet, or the box refused it | roster | "root@10.0.0.5 hasn't logged in with that password - roster saves it only after the login succeeded" | Wait for the login; a refused password saves nothing, so check it and connect again |
| 69 | 67 | No typed password held for that Session: saved already, or forgotten (the Session ended, the vault locked, 10 minutes passed, or Not now) | roster | "there's no typed password to save for that Session: …" | Connect again with Save to vault ticked |
| 70 | 39 (from `session.prepare`, not shown as an error) | The Host's Login is `auth: prompt`: roster has no password to look up | `roster.yml` | The question: "esx's Login is auth: prompt: roster has no saved password for it", with the password field and the Save to vault tick | Type the password; tick Save to vault to keep it |

Cases 8–10 and 18 used to show only `roster askpass: …` followed by `Permission denied`. They now need their own messages.

**What a Session's error is read from.** ssh's failures (rows 11-19, and roster askpass's `roster askpass: [CODE] …` line) can only come before the login. After it, the terminal shows the Host's output, where a nested `ssh` can print the same messages and anything can print a fake askpass line. So the app classifies only what the Session printed in its pre-auth window: the first 30 s or 8 KB, whichever comes first (`app/src/session/tabs.ts`). ssh doesn't report a successful login, and roster's ssh config has `ConnectTimeout 10`, so the window outlasts every pre-auth failure. A Session that ends with 255 after the window is row 20, and only ssh's own drop lines (`Timeout, server … not responding`, `closed by remote host`, `Connection reset`) pick its message.

## See also

[The error catalog](errors) · [`roster check HOST`](../cli-reference.md#roster-check-host) · [The roster serve API](../serve-api.md)
