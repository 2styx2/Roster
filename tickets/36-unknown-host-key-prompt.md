# 36: Ask before trusting an unknown host key

**Iteration:** 4 · **Repo:** roster (CLI `serve` and app) · **Issue:** #45 (decision), [#64](https://github.com/2styx2/roster/issues/64)

**Why:** Decision Q60 (owner, 2026-10-30). Sessions use `StrictHostKeyChecking accept-new`, so a Host with no recorded key is trusted on first contact without the user seeing it.

**What to build:** Opening a Session to a Host whose host key isn't in roster's known hosts shows a calm question before anything connects: the Host, its address and port, the key type and its SHA256 fingerprint, and the plain fact that roster hasn't seen this key before. **Trust and connect** records the key in roster's known hosts and opens the Session; **Cancel** connects nothing and records nothing. Every later Session to that Host connects without asking. A key that differs from the recorded one is still refused with the existing clean error (Q44): never a question.

- `roster serve` gains a way to fetch a Host's offered key and fingerprint without logging in, and a way to record a key the user confirmed. The record step re-fetches and refuses if the key changed in between.
- Session ssh options use strict checking against roster's known hosts once the app has asked, so ssh never trusts a key on its own.
- The question is a normal app dialog: keyboard first (Enter trusts, Esc cancels), the fingerprint in Iosevka, the voice from `docs/app/design/taste.md`. Any motion goes through the `animate` skill.
- New error codes for "couldn't fetch the key" (unreachable, timeout) go into `docs/app/errors.md`.
- The CLI's `roster ssh` keeps its current behaviour.

**Blocked by:** 05, 26 (done)

**Status:** ready-for-agent

- [ ] A Session to a Host with no recorded key asks first, showing type and SHA256 fingerprint; nothing connects before the answer.
- [ ] Trust records the key and connects; the next Session doesn't ask.
- [ ] Cancel records nothing and leaves no Session.
- [ ] A changed key is refused (Q44), never offered as a question.
- [ ] A key that changes between the question and the trust is refused.
- [ ] Hosts added or edited through the app (key already recorded) never see the question.
- [ ] Tests: serve (fake ssh/keyscan), Rust core, and UI through the typed client with the fake backend.
