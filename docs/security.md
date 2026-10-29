# Security model

roster-desk keeps roster's promise: **secrets are fetched when needed, kept in memory, and never written, printed or shown.**

## Where a password goes

| Step | Holds the secret? |
|---|---|
| Vault (Bitwarden, …) | yes, at rest |
| `roster serve` process memory | yes, while unlocked |
| Private askpass socket, one-time token | yes, in transit, once |
| `roster askpass` → `ssh` | yes, in transit |
| Rust core | **never** |
| Frontend, app State, Config, logs | **never** |
| Terminal output and scrollback | **never** (ssh reads the password itself) |

Two exceptions are typed by you and leave the UI straight away:
- **The master password:** sent once to `vault.unlock`, and the field clears.
- **A Quick Connect password:** sent once to `quick.prepare`, held under an askpass token.

## Locking

- Unlocking the vault is what unlocks the app. There is no separate app password.
- It locks after 15 minutes idle (configurable), or on demand with the leader key plus the lock key, or `:lock`.
- Locking calls `vault.lock`. That forgets the vault session key, every cached secret and every askpass token, and runs the provider's own lock.
- Sessions keep running while locked, with their content hidden until you unlock.
- The app always opens locked. If `roster serve` is still unlocked when the window (re)loads, the app calls `vault.lock` first.
- Idle means no key, click, pointer move or wheel anywhere in the window. The timer runs in the frontend (`src/lock/idle.ts`), where that input arrives, so no keystroke has to cross to Rust. It re-checks the clock when it fires, so a late timer (sleep, a throttled window) still locks.
- If no Host Login uses a vault with a master password (`vault.status` says `unsupported`), there is nothing to unlock, so there's no lock screen and no idle lock, and the lock key says "nothing to lock".
- If the vault CLI is missing or not logged in, the lock screen says what to install or run (roster's message) and offers "Check again". It doesn't ask for a password it can't use.
- The master password lives only in the lock screen's input (never in React state). It goes to the `vault_unlock` command and the field is emptied as soon as the call returns. The Rust core passes it to `serve`'s stdin inside the request and drops it; it's never logged or put in an error.

## Connections

- Unreviewed Hosts are never connected to (the same rule as `roster run`).
- Key-enrolled Hosts use `BatchMode=yes`, so a broken key fails instead of falling back to a password prompt.
- Host keys come from what `roster setup` recorded. The askpass helper refuses host-key prompts, so a mismatch stops the connection.
- Quick Connect shows the scanned fingerprint and asks you to confirm before connecting.

## Config

`init.lua` is the user's own code. It runs in the Rust core, which never holds a secret, with no access to `roster serve`'s vault. It can choose a Login *reference* or a Host, never read a password.

## Writes

- "Save to vault" saves only after the login succeeds, and refuses to create a duplicate Vault item name.
- Publish never force-pushes.
