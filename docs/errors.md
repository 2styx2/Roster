# Connection errors: the catalog

Every way opening a Session can fail must end in a **clean error**, never a hang or a raw stack trace. A clean error:
- names the Host;
- says what went wrong, in plain words;
- says where the problem lives: `roster.yml`, the vault, this Box, the network, or the Host;
- gives the exact fix;
- keeps the raw message (ssh's stderr, or roster's message) one click away under "Details".

Edits made by hand to `roster.yml` or the vault get the same treatment as anything made in the app. Ticket 26 builds this; `roster check HOST` and `:check HOST` run the same diagnostics on demand.

| # | What happened | Typical cause | Where it lives | Message (short) | Fix offered |
|---|---|---|---|---|---|
| 1 | `roster.yml` doesn't load | Bad YAML or a missing field after a hand edit | Inventory | "roster.yml has an error at line N: …" | Open the file; show roster's message |
| 2 | Host not in this Box's ssh config | `roster.yml` was edited but `roster sync` wasn't run | Box | "esxi-02 isn't in this Box's ssh config yet" | Button: run `roster sync` |
| 3 | Host is `reviewed: false` | Came from `discover` | Inventory | "esxi-02 hasn't been reviewed" | Review it (ticket 11) |
| 4 | No user set | Hand edit left the user out, or `CHANGE-ME` | Inventory | "No SSH user for esxi-02" | Edit the Host |
| 5 | Login points at a provider that isn't set up | `auth: kp:…` with no KeePassXC configured, or a typo in the prefix | Inventory | "esxi-02's Login uses `kp:`, which isn't set up on this Box" | Show the provider list (`roster providers`) |
| 6 | Vault CLI missing / not logged in | New Box | Box | roster's wording, e.g. "Bitwarden CLI isn't logged in - run `bw login` once" | Show the command |
| 7 | Vault locked | Idle lock, or locked elsewhere | Vault | (lock screen) | Unlock; the Session opens afterwards (ticket 06) |
| 8 | Vault item not found | Typo in `bw:NAME`, item renamed or deleted | Vault / Inventory | "No vault item named 'esxi-02 ssh' (Login of esxi-02)" | Show near-matching item names; edit the Login |
| 9 | Several vault items match | Duplicate names | Vault | "Two vault items are named 'esxi-02 ssh'" | List them (name, last edited, URI); fix in the vault |
| 10 | Item has no password / no such field | Item made without a password, or `#FIELD` typo | Vault | "Vault item 'esxi-02 ssh' has no password" | Edit the item in the vault |
| 11 | Wrong password or user | Password rotated on the Host but not in the vault, or the reverse | Vault / Host | "esxi-02 refused the password for user root" | Check the item; with Q43, re-save after a successful login |
| 12 | Key refused | `enroll: true` but the key isn't installed (setup not run, key removed) | Box / Host | "esxi-02 didn't accept this Box's key" | Run `roster setup --only esxi-02`, or set `enroll: false` |
| 13 | Host key changed | Reinstalled box, or IP reused, or a MITM | Host / network | "esxi-02's host key changed. Not connecting." | Show old and new fingerprints and how to verify. **Never auto-accept.** |
| 14 | Host key unknown | Fingerprints not recorded for this Host | Box | "No recorded host key for esxi-02" | Run `roster setup`/`sync` to record it, after verifying it |
| 15 | Name doesn't resolve | Typo in `ip:` or a DNS name | Inventory / network | "Can't resolve 'esxi02.lab'" | Edit the address |
| 16 | Connection refused | Wrong port, or sshd not running | Inventory / Host | "esxi-02:2222 refused the connection" | Check the port in `roster.yml`; is sshd up? |
| 17 | Timeout / unreachable | Host down, routing, firewall, **or the 10.19.x SSH rate limiter** (times out for about 4 minutes after many connections) | Network | "esxi-02 didn't answer within 10 s" | Retry later. For 10.19.x, mention the rate limiter and suggest waiting a few minutes, not hammering. |
| 18 | Unexpected password prompt | Password expired or change required, OTP, or unusual keyboard-interactive wording | Host | "esxi-02 asked something roster won't answer: '<prompt>'" | Log in by hand once (Quick Connect) to handle it |
| 19 | Too many auth failures | The ssh agent offers many keys before the password | Box | "esxi-02 cut the connection after too many key attempts" | Fix: `IdentitiesOnly` in roster's ssh config (roster-side) |
| 20 | Session dropped | Network blip, Host reboot | Network / Host | "Session ended (code 255): connection reset" | Reconnect (`␣ r`) |
| 21 | `roster serve` died | Crash, WSL restart | Box | "Lost the connection to roster" | Restart the backend; open Sessions keep running |

Cases 8–10 and 18 used to show only `roster askpass: …` followed by `Permission denied`. They now need their own messages.

**What a Session's error is read from.** ssh's failures (rows 11-19, and roster askpass's `roster askpass: [CODE] …` line) can only come before the login. After it, the terminal shows the Host's output, where a nested `ssh` can print the same messages and anything can print a fake askpass line. So the app classifies only what the Session printed in its pre-auth window: the first 30 s or 8 KB, whichever comes first (`src/session/tabs.ts`). ssh doesn't report a successful login, and roster's ssh config has `ConnectTimeout 10`, so the window outlasts every pre-auth failure. A Session that ends with 255 after the window is row 20, and only ssh's own drop lines (`Timeout, server … not responding`, `closed by remote host`, `Connection reset`) pick its message.
