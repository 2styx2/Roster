# 01: Prefactor: unlock and lock the vault without a terminal

**Iteration:** 1 · **Repo:** roster · **Spec:** 0001 (Implementation Decisions › `roster serve`)

**What to build:** Give roster's password providers two plain operations that `roster serve` can call. *Unlock with this master password* takes the password as a value and uses the provider's environment-variable unlock path. *Lock* forgets the session key, every cached secret and the provider state, and runs the provider's own lock. Neither may need a TTY or touch the bw-session file. Today's CLI behavior must not change at all: the session file, `BW_PASSWORD` and interactive prompts all keep working.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Unlocking Bitwarden with a given master password succeeds against the fake `bw`, with no TTY and no session file written.
- [ ] A wrong master password gives a clear, non-secret error.
- [ ] Locking clears the session key from the process environment, the secret cache and the provider state. The next secret lookup reports "locked".
- [ ] "Not logged in" and "CLI missing" can be told apart as distinct states.
- [ ] Every existing test still passes. `ruff check` is clean.
