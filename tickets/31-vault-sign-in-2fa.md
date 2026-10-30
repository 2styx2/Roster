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

**Status:** ready-for-agent

- [ ] `docs/dev/vault-auth.md` holds the verified method matrix (provider × method × supported by its CLI) with sources.
- [ ] pytest with extended fake `bw`/`op`/`keepassxc-cli` covering every supported method, plus the unsupported-method message. Nothing secret appears in the argv, stdout or stderr of any call (asserted).
- [ ] App tests for every step and error, and for Esc going back. Fields are cleared.
- [ ] Manual check on a fresh Box (or after `bw logout`): sign in with the user's real account, including their real second factor, entirely from the app.
