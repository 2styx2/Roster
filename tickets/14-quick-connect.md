# 14: Quick Connect

**Iteration:** 4 · **Repos:** roster + roster-desk · **Spec:** 0001 (stories 68–69)

**What to build:** Typing `user@address[:port]` in the picker or `:connect` opens a Session to a box that isn't in the Inventory. `quick.prepare` scans the box's host key first, and the app shows the fingerprint for you to confirm. Once confirmed, it's used for this Session only. You type the password into a masked field. It's sent once to `serve`, held under an askpass token, and then cleared in the UI.

**Blocked by:** 06

**Status:** ready-for-agent

- [ ] pytest: `quick.prepare` returns the scanned fingerprint and a Session command. A wrong fingerprint or a changed key is refused.
- [ ] The typed password never appears in app state after the call, nor in any log.
- [ ] Manual check: Quick Connect to a real box by IP with a password.
