# Security model

The roster app keeps roster's promise: **secrets are fetched when needed, kept in memory, and never written, printed or shown.**

## Where a password goes

| Step | Holds the secret? |
|---|---|
| Vault (Bitwarden, …) | yes, at rest |
| `roster serve` process memory | yes, while unlocked |
| Private askpass socket, one-time token | yes, in transit, once |
| Session process env (the token only, never the password) | the token, for the Session's life |
| `roster askpass` → `ssh` | yes, in transit |
| Rust core | **never** |
| Frontend, app State, Config, logs | **never** |
| Terminal output and scrollback | **never** (ssh reads the password itself) |

A few exceptions are typed by you and leave the UI straight away:
- **The master password:** sent once to `vault.unlock`, and the field clears. Bitwarden turns it into a session key and roster drops it. KeePassXC (ticket 25) has no session: `keepassxc-cli` opens the `.kdbx` again on every call, so `serve` keeps the master password itself in memory until `vault.lock` and gives it to each `keepassxc-cli` call on its stdin, never on a command line or in an error.
- **A Quick Connect password:** sent once to `quick.prepare`, held under an askpass token.
- **Signing in (ticket 31):** the master password, a two-step or new-device code, or an API key's `client_secret`, each sent once to `vault.login`. The field empties as soon as the call returns. roster gives them to `bw` through an env var or `bw`'s own prompt, never on a command line. It holds the master password only for the sign-in's life, so it can restart `bw login` after a wrong code. That ends when the sign-in is done, cancelled or locked, or after 10 minutes idle. The app cancels a started sign-in whenever it's left other than by going on: Esc, a failure with no step to carry on from (a timeout, a refusal), or the lock screen going away. None of them ever reaches React state, the Rust core's logs or an error message.
- **A new Host's password (ticket 11):** typed into the add-Host form, it lives only in its input (never React state) and is sent once to `host.add`; the field empties when the call returns, pass or fail. roster uses it for the one test login, then saves it as the Vault item (`bw create item` on stdin) and forgets it. It never appears in a response, an error, stderr, `roster.yml` or the Pending change.

## No vault of our own

The roster app never stores secrets: there's no built-in vault, now or later (decision Q40). Passwords live in the user's password manager: Bitwarden, 1Password, `pass`, or KeePassXC for local-only use (Q41). roster fetches a password for one use and forgets it.

## Locking

- Unlocking the vault is what unlocks the app. There is no separate app password.
- It locks after 15 minutes idle (configurable), or on demand with the leader key plus the lock key, or `:lock`.
- Locking calls `vault.lock`. That forgets the vault session key (or KeePassXC's held master password), every cached secret and every askpass token, and runs the provider's own lock.
- Sessions keep running while locked, with their content hidden until you unlock.
- The app always opens locked. If `roster serve` is still unlocked when the window (re)loads, the app calls `vault.lock` first.
- Idle means no key, click, pointer move or wheel anywhere in the window. The timer runs in the frontend (`app/src/lock/idle.ts`), where that input arrives, so no keystroke has to cross to Rust. It re-checks the clock when it fires, so a late timer (sleep, a throttled window) still locks.
- If no Host Login uses a vault with a master password (`vault.status` says `unsupported`), there is nothing to unlock, so there's no lock screen and no idle lock, and the lock key says "nothing to lock".
- If the vault CLI is missing or not logged in, the lock screen says what to install or run (roster's message) and offers "Check again". It doesn't ask for a password it can't use.
- If an unlock fails without a clear answer (the call timed out, or `serve` was lost), `serve` may still finish the unlock. The app stays locked, asks `vault.status` (`serve` answers in order, so this comes after that unlock), and calls `vault.lock` if it says unlocked, unless a newer unlock attempt has started meanwhile.
- The master password lives only in the lock screen's input (never in React state). It goes to the `vault_unlock` command and the field is emptied as soon as the call returns. The Rust core passes it to `serve`'s stdin inside the request and drops it; it's never logged or put in an error.

## The askpass token

`session.prepare` hands back a one-time token (60 s, spent on first use) in the Session's env. The Rust core sets it on the Session's process and never in an argv: a command line is readable by any process and logged by process-creation auditing for the process's whole life, while the environment is only readable by the same user. On WSL that means setting it on `wsl.exe` and naming it in `WSLENV` (`docs/app/dev/tauri-pty-wsl.md`, section 2). It never appears in Debug output or error text: names only, and spawn errors are redacted.

## The webview

The built app runs under a Content Security Policy (`app/src-tauri/tauri.conf.json`): `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src ipc: http://ipc.localhost; object-src 'none'; base-uri 'none'`. So no remote script, style, font or connection, no inline script and no `eval`. Tauri adds hashes for its own inline scripts. `style-src` keeps `'unsafe-inline'` for the `<style>` elements xterm.js creates, and `dangerousDisableAssetCspModification: ["style-src"]` stops Tauri from adding a style nonce, which would void `'unsafe-inline'`. Fonts (Inter, Iosevka) are bundled, never fetched. On desktop, `tauri dev` loads the Vite dev server directly and Tauri adds no CSP header there (only to embedded assets), so HMR needs no `devCsp`.

## Connections

- Unreviewed Hosts are never connected to (the same rule as `roster run`).
- Key-enrolled Hosts use `BatchMode=yes`, so a broken key fails instead of falling back to a password prompt.
- Host keys come from what `roster setup` recorded. The askpass helper refuses host-key prompts, so a mismatch stops the connection.
- Quick Connect shows the scanned fingerprint and asks you to confirm before connecting.

## Config

`init.lua` is the user's own code. It runs in the Rust core, which never holds a secret, with no access to `roster serve`'s vault. It can choose a Login *reference* or a Host, never read a password.

Its `vault` table reaches `roster serve` through `vault.configure` (tickets 35, 41), and only as paths and choices: a KeePassXC database and key file. The schema has no other keys, and `serve` refuses any key it doesn't list, so nothing else, a secret above all, can ride along. Pointing at another database forgets the master password `serve` held for the old one, so it's never tried against a file it wasn't typed for.

It can't redirect a secret either. `roster_command` names the program that gets the master password, two-step codes and the API key's secret on its stdin, so init.lua may only name roster itself: `roster`, a path ending in `/roster`, or `uv run [--project <dir> | --directory <dir> | --frozen | --locked | --offline | --no-sync | -q] roster` (no `--with`, no other program). Anything else is a Config error, and starting the backend refuses it too. A wrapper needs the `ROSTER_APP_ROSTER` env var, which only the user sets, outside the Config. `:info` shows the command in use. The Lua sandbox has no `io`, so a Config can't write a program of its own to point at.

## Writes

- "Save to vault" saves only after the login succeeds, and refuses to create a duplicate Vault item name.
- The password it saves goes to `bw create item` as base64 JSON on stdin, never on a command line. bw's echo of the new item is read for its id only. Errors are cut from bw's stderr with the value removed.
- The undo after a failed add (`vault.undo_create`) can delete only items that this `roster serve` created itself, and Bitwarden keeps them in its trash.
- Publish never force-pushes.
