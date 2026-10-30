# 26: Clean connection errors and `check HOST`

**Iteration:** 1 · **Repos:** roster + roster-desk · **Doc:** `docs/errors.md` (the catalog is the definition of done)

**What to build:** Every row of `docs/errors.md` ends in a clean error: Host named, plain words, where the problem lives, the exact fix, and the raw message under Details. This holds whether the Host and its Vault item came from the app or were typed by hand into `roster.yml` or the vault.

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

**Status:** ready-for-agent

- [ ] pytest: rows 1–10 and 18 each produce their own code and message from `session.prepare`, askpass or `host.check`, with hand-edited `roster.yml` fixtures and fake vault items (missing, duplicate, no password, wrong field).
- [ ] pytest: `host.check` stops at the first failure and makes no connection when an earlier step fails.
- [ ] App tests: `classifyExit` maps real ssh stderr samples for rows 11–17 and 19–20 to the right row. Each row renders its message, fix action and Details.
- [ ] The password never appears in any message, Details text or log.
- [ ] Manual check: put deliberately broken entries in a scratch `roster.yml` and fake vault items (typo'd item name, duplicate, wrong port, unknown host) and see each clean error. Don't hammer 10.19.
