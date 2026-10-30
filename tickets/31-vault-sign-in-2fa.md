# 31: Vault sign-in with two-factor (every method the providers support)

**Iteration:** 2 · **Repos:** roster + roster-desk · **Decision:** Q52

**What to build:** The lock screen grows from "unlock" (master password on an already-logged-in CLI) into a full **sign-in** flow, so a new Box never needs a terminal. It must support every login method the provider's CLI supports, with a clean message for the ones it can't do.

**Step 0, research (write `docs/dev/vault-auth.md` first).** Verify against the official docs and the installed CLI versions; don't assume.
- **Bitwarden `bw`:**
  - `bw login` with email and master password, plus the two-step methods the CLI supports: authenticator TOTP, email code and YubiKey OTP (`--method`/`--code`). Find out how the CLI reports the methods available for an account.
  - The new-device verification email OTP.
  - API key login (`BW_CLIENTID`/`BW_CLIENTSECRET`, which skips two-step).
  - SSO (`bw login --sso`, which opens a browser).
  - Self-hosted and EU servers (`bw config server`).
  - Which methods the CLI *can't* do, such as FIDO2/WebAuthn and Duo, and what to tell the user when one of those is the account's only method.
- **1Password `op`:** sign-in, and integration with the 1Password desktop app (Windows Hello and biometrics), which makes 2FA the app's job. Also service accounts.
- **KeePassXC:** master password, key file, and YubiKey challenge-response (`--yubikey`).
- **Unlock vs login:** unlock alternatives such as PIN and biometrics, and which of them each CLI exposes.

**roster side (`roster serve`):**
- **`vault.login`:** a step-by-step method that walks the provider's flow: start returns what it needs, and next takes the answer, for example `{step: "two_factor", methods: [...]}` and then `{step: "new_device_code"}`.
- **Secrets:** passwords, codes and API secrets are passed as values, never as command-line arguments, and never logged or echoed.
- **SSO and browser flows:** these report a URL, or that a browser was opened, and wait for completion with a timeout.
- **Codes:** every failure, for example wrong code, code expired, method unsupported by the CLI, account locked or rate-limited, or server unreachable, gets a stable code and roster's wording, added to `docs/errors.md`.

**App side:**
- The lock screen becomes a small sign-in flow: server (cloud, EU or self-hosted URL), then email, then master password, then a two-step method picker if the account has several, then a code field, then the new-device code if asked. API key and SSO are alternatives on the first screen.
- Every field clears as soon as its step returns. Unlocking (the everyday case) stays one field.
- The flow is keyboard-first: Tab and Enter, with Esc going back a step.

**Blocked by:** 04 (done)

**Status:** done (the real-account check below is the user's manual step)

- [x] `docs/dev/vault-auth.md` holds the verified method matrix (provider × method × supported by its CLI) with sources.
- [x] pytest with extended fake `bw`/`op`/`keepassxc-cli` covering every supported method, plus the unsupported-method message. Nothing secret appears in the argv, stdout or stderr of any call (asserted).
- [x] App tests for every step and error, and for Esc going back. Fields are cleared.
- [ ] Manual check on a fresh Box (or after `bw logout`): sign in with the user's real account, including their real second factor, entirely from the app.

**What was built.** roster (branch `feat/31-vault-login`, stacked on `feat/26-clean-errors`): `vault.login` (start / answer / cancel) drives `bw login` on a PTY, so it can answer bw's own prompts, including the new-device code that has no flag. It also handles API key and SSO (the link comes back to the app), `bw config server` for cloud, EU and self-hosted, and codes 50-59 (README "Signing in: vault.login"). The fake `bw` signs in like the real one. pytest asserts that no secret appears in any argv, response or stderr. 1Password answers 13 with how it signs in (its desktop app integration, or a service account). KeePassXC has no provider yet (ticket 25), so it has no sign-in to test. roster-desk: the lock screen's `SignIn` (`src/lock/SignIn.tsx`), with catalog rows 22-33 (`docs/errors.md`), the `vault_login` command (100 s timeout), and the fake backend's `sign-in*` fixtures.

**Manual check (the user's, not done by an agent).** It needs your real account and second factor, and it changes this Box's real `bw` state:
1. In WSL: `bw logout` (or use a fresh Box). `bw status` should say `unauthenticated`.
2. Run the app against roster with this branch, e.g. `ROSTER_DESK_ROSTER="uv run --project ~/work/roster.worktrees/31 roster" scripts/win-dev.sh`.
3. The lock screen says **Sign in to Bitwarden**. Pick the server (cloud, EU or self-hosted) and press Enter. Type your email, then Enter. Type your master password, then Enter.
4. If the account has several two-step methods, pick one (number key or arrows, then Enter). Type the code, then Enter. Try one wrong code first: the same step stays, with "didn't accept that code", and an emailed method gets a fresh email.
5. If Bitwarden asks for the new-device code, type the code from the email.
6. The app unlocks. `bw status` in WSL then says `locked` (serve holds the session key, not your shell). Lock the app and unlock it again: a single master-password field.
7. Optional: `bw logout` again and try **Use an API key** (web vault: Account settings > Security > Keys), and **Use SSO** if your organization has it.

