# 04: Lock screen and idle lock

**Iteration:** 1 · **Repos:** roster (CLI + app) · **Spec:** 0001 (stories 1–9)

**What to build:** `serve` gains `vault.status`, `vault.unlock` and `vault.lock`, built on ticket 01. The app opens on a lock screen that asks for the master password of the Inventory's provider. The password field clears as soon as the call returns. Errors are worded for a person:
- wrong password
- `bw` not installed
- `bw` not logged in, with the exact command to run

The leader key followed by the lock key, or `:lock`, locks the app. So does 15 minutes without input, a timeout you can change. Locking calls `vault.lock`, so secrets really are forgotten. Open Sessions keep running behind the lock screen, with their content hidden.

**Blocked by:** 01, 03

**Status:** done (app side on `feat/04-lock-screen`; roster side in roster MR !15). The manual real-vault check is left for the user, see below.

- [x] pytest covers serve unlock with the right and wrong password, lock clearing secrets, and the status states, all with the fake `bw`.
- [x] No serve response ever contains the master password or the session key. The test checks stdout for both.
- [x] The app's unlock, wrong-password and missing/not-logged-in flows are covered by UI tests against the fake backend.
- [x] The idle timer locks the app after the configured time. A test drives it with a fake clock.
- [ ] Manual check on Windows: unlock with the real vault, lock, unlock again.

**Note from ticket 01:** `roster.providers.unlock(name, password)`, `lock(name)` and `vault_status(name)` exist now. After `lock`, a later `get_secret` takes the old CLI path, which unlocks again by itself if `BW_PASSWORD` is set and reads the bw-session file if one exists. `roster serve` must clear `BW_PASSWORD` (and not load the session file) at startup, so that only the lock screen can unlock it.

- [x] A serve test: with `BW_PASSWORD` set and a session file present, a lookup after `vault.lock` still reports locked.

**Roster side is done** (roster MR !15):
- `vault.status` returns `{provider, status, message?, providers[]}`. `status` is one of locked, unlocked, not-logged-in, missing-cli or unsupported.
- `vault.unlock {password, provider?}`
- `vault.lock` returns `{locked: [...]}`.
- **Codes:** 10 wrong password, 11 not logged in, 12 CLI missing, 13 unsupported, 14 locked.
- `serve` ignores `BW_PASSWORD`/`BW_SESSION` and the bw-session file.

**App side is done** (`feat/04-lock-screen`):
- Backend client: `vaultStatus()`, `unlockVault(password)`, `lockVault()`, plus `VaultError` (codes 10 to 14). Tauri commands: `vault_status`, `vault_unlock`, `vault_lock`.
- `app/src/lock/`: `useVault` (lock state), `LockGate`/`LockScreen` (it covers and inerts the app, and children stay mounted so Sessions keep running), and `idle.ts` (the idle timer, with an injectable Clock).
- `<leader> L` is `app.lock` in the keymap. `idleLockMinutes: 15` is in the options table, for the Lua Config to override later. `:lock` comes with the command line (ticket 07).
- Decisions (in `docs/app/security.md`):
  - The app always opens locked, and calls `vault.lock` if serve was left unlocked.
  - If the vault is `unsupported`, there's no lock screen and no idle lock, and the lock key says "nothing to lock".
  - For `not-logged-in` and `missing-cli`, the lock screen shows roster's message and a "Check again" button, with no password field.
  - The idle timer lives in the frontend, tested with a manual Clock (`app/src/lock/idle.test.ts`, plus App tests).
- Fake backend: the master password is `correct horse`. Fixtures: `locked`, `not-logged-in`, `missing-cli` and `no-vault`.
- Fix found on Windows: `wsl.exe --exec` gave serve a bare PATH without `~/.local/bin`, so roster couldn't find `bw` and the lock screen said "not installed". detect now has the probe report the login shell's PATH, and serve starts as `/usr/bin/env PATH=<login PATH> roster ... serve`. Ticket 06 needs this too: askpass lookups run inside serve.
- Checked in the real app on Windows, against the real roster (serve-stack) and the real vault:
  - It opens on "Unlock Bitwarden", with the app hidden.
  - A wrong password shows "Wrong master password. Try again." and the field is empty once bw answers (about 5 to 8 s).
  - The Leader is ignored while locked.
- Checked in a plain browser against the fake: unlock, then Ctrl+Space then L locks, and unlock again. Also the not-logged-in screen.
- [ ] **Manual check for the user, still open:** in the real app, unlock with your Bitwarden master password, lock with Ctrl+Space then L, and unlock again.
