# 26: Clean connection errors and `check HOST`

**Iteration:** 1 · **Repos:** roster (CLI + app) · **Doc:** `docs/app/errors.md` (the catalog is the definition of done)

**What to build:** Every row of `docs/app/errors.md` ends in a clean error: Host named, plain words, where the problem lives, the exact fix, and the raw message under Details. This holds whether the Host and its Vault item came from the app or were typed by hand into `roster.yml` or the vault.

**roster side:**
- **Stable codes:** `session.prepare` and the askpass channel return a stable code plus roster's wording for every Inventory- and vault-side case (rows 1–10, 18), instead of failing later inside ssh. For example, item not found, several items match, and no password are distinct codes. Wherever possible the check happens at prepare time: confirm the Login's vault item exists and is unique without handing the secret to anyone but serve.
- **`host.check {host}`** (and the CLI `roster check HOST`) runs the diagnostics in order, stopping at the first failure:
  1. Inventory entry.
  2. ssh config entry.
  3. Provider ready.
  4. Vault item resolves, uniquely, and has a password/field.
  5. DNS.
  6. TCP port.
  7. Host key matches the recorded one.
  8. Auth: one attempt with BatchMode or askpass.

  Each step reports ok, or fail with its catalog row. It must respect the 10.19 rate limiter: one connection attempt at most, and none at all if an earlier step failed.

**App side:**
- **Classify:** a `classifyExit` turns ssh's stderr, exit code and askpass lines into catalog rows.
- **Show:** the tab shows the clean error with its fix action (run sync, unlock, reconnect, open `:check`), plus a "Details" disclosure holding the raw text.
- **`:check HOST`:** shows the diagnostic steps as a list, with the failing step expanded.
- **Never automatic:** a changed or unknown host key is never accepted automatically.

**Blocked by:** 07 (for the UI placement). The roster side can start now.

**Status:** done

- [x] pytest: rows 1–10 and 18 each produce their own code and message from `session.prepare`, askpass or `host.check`, with hand-edited `roster.yml` fixtures and fake vault items (missing, duplicate, no password, wrong field). (roster MR !17)
- [x] pytest: `host.check` stops at the first failure and makes no connection when an earlier step fails. (roster MR !17)
- [x] App tests: `classifyExit` maps real ssh stderr samples for rows 11–17 and 19–20 to the right row. Each row renders its message, fix action and Details. (`app/src/errors/*.test.ts*`; the catalog test checks every docs/app/errors.md row and roster code has a row, and that no action accepts a host key.)
- [x] The password never appears in any message, Details text or log.
- [x] Manual check: put deliberately broken entries in a scratch `roster.yml` and fake vault items (typo'd item name, duplicate, wrong port, unknown host) and see each clean error. Don't hammer 10.19.

**Checked on Windows (2026-10-29), partly.** A scratch `roster.yml` (uncommitted), roster's fake `bw` with its own items, a scratch HOME for serve, and a `ssh` wrapper running the real OpenSSH 10 with the scratch config against a stand-in sshd on 127.0.0.1:2222 (paramiko, refuses every login). Seen in the real window, each with the right message, where, fix, action and Details: 15 unresolvable name, 16 wrong port, 4 `CHANGE-ME`, 2 not synced (`roster sync` to copy), 8 typo'd item (near name shown), 9 duplicate (table), 10 no password, 12 key not installed, 11 password refused (through real askpass), 13 host key changed (offered fingerprint and known_hosts line; `:check` shows recorded and offered; no accept button). `:check` run on four Hosts: all eight steps listed, the failing one expanded, the login step reached through askpass. The DOM never held the master or an item password. **Not seen live** (unit tests only): 17 timeout / 10.19 rate limiter (no 10.19 connection was made), 19 too many auth failures, 20 dropped Session, 21 lost `serve`, askpass 36–38, and 14 (ticket 06's lock-screen path, unchanged). Note from roster's side: its ssh blocks say `StrictHostKeyChecking accept-new`, so a Session to a Host with no recorded key records it on first contact; only `:check` reports 44 for that.
