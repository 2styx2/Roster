# 04: Lock screen and idle lock

**Iteration:** 1 · **Repos:** roster + roster-desk · **Spec:** 0001 (stories 1–9)

**What to build:** `serve` gains `vault.status`, `vault.unlock` and `vault.lock`, built on ticket 01. The app opens on a lock screen that asks for the master password of the Inventory's provider. The password field clears as soon as the call returns. Errors are worded for a person:
- wrong password
- `bw` not installed
- `bw` not logged in, with the exact command to run

The leader key followed by the lock key, or `:lock`, locks the app. So does 15 minutes without input, a timeout you can change. Locking calls `vault.lock`, so secrets really are forgotten. Open Sessions keep running behind the lock screen, with their content hidden.

**Blocked by:** 01, 03

**Status:** ready-for-agent

- [ ] pytest covers serve unlock with the right and wrong password, lock clearing secrets, and the status states, all with the fake `bw`.
- [ ] No serve response ever contains the master password or the session key. The test checks stdout for both.
- [ ] The app's unlock, wrong-password and missing/not-logged-in flows are covered by UI tests against the fake backend.
- [ ] The idle timer locks the app after the configured time. A test drives it with a fake clock.
- [ ] Manual check on Windows: unlock with the real vault, lock, unlock again.

**Note from ticket 01:** `roster.providers.unlock(name, password)`, `lock(name)` and `vault_status(name)` exist now. After `lock`, a later `get_secret` takes the old CLI path, which unlocks again by itself if `BW_PASSWORD` is set and reads the bw-session file if one exists. `roster serve` must clear `BW_PASSWORD` (and not load the session file) at startup, so that only the lock screen can unlock it.

- [ ] A serve test: with `BW_PASSWORD` set and a session file present, a lookup after `vault.lock` still reports locked.

**Roster side is done** (roster MR !15):
- `vault.status` returns `{provider, status, message?, providers[]}`. `status` is one of locked, unlocked, not-logged-in, missing-cli or unsupported.
- `vault.unlock {password, provider?}`
- `vault.lock` returns `{locked: [...]}`.
- **Codes:** 10 wrong password, 11 not logged in, 12 CLI missing, 13 unsupported, 14 locked.
- `serve` ignores `BW_PASSWORD`/`BW_SESSION` and the bw-session file.
