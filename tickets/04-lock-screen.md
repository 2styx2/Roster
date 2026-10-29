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
