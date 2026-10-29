# 06: Sessions to password-only Hosts (askpass channel)

**Iteration:** 1 · **Repos:** roster + roster-desk · **Spec:** 0001 (Implementation Decisions › askpass channel; stories 21–22, 24) · **ADR:** roster 0002

**What to build:** While it runs, `serve` listens on a private askpass channel: a Unix socket in a user-only runtime directory. For password-only Hosts, `session.prepare` creates a one-time token for that Host's ssh Login. The token expires when used, after 60 seconds, or on lock. It returns an ssh command with `SSH_ASKPASS` pointing at a new `roster askpass` helper, `SSH_ASKPASS_REQUIRE=force` and `NumberOfPasswordPrompts=1`. The helper sends the token over the channel and prints the password to ssh. It answers only password prompts and refuses host-key and every other prompt. The password goes from roster to ssh and never passes through the Rust core or the UI.

**Blocked by:** 04, 05

**Status:** ready-for-agent

- [ ] pytest: a token gives the fake vault's password once. A reused token, an expired token, or a token after lock gives nothing.
- [ ] pytest: the helper refuses a host-key or yes/no prompt.
- [ ] pytest: the channel's socket and directory can only be accessed by the user.
- [ ] No serve stdout and no app log contains the password. The tests check both.
- [ ] Manual check on Windows: a real password-only Host opens to a shell without you typing anything. A wrong vault password shows a clear failure in the tab.

**Note from research:** `SSH_ASKPASS` must be an absolute path. ssh runs it without your login PATH, and `roster` lives in `~/.local/bin`.

**Roster side is done** (roster MR !16, stacked on !15 and !14):
- For a password Host, `session.prepare` returns `auth: "password"` and an env with `SSH_ASKPASS`, `SSH_ASKPASS_REQUIRE=force`, `ROSTER_ASKPASS_SOCKET` and `ROSTER_ASKPASS_TOKEN`.
- Pass the env as `wsl.exe -d D --cd ~ --exec env K=V … <argv>`. Paths are WSL-side and only valid while that `serve` is alive. Don't set DISPLAY.
- **Tokens:** one per Session, valid for 60 s, so call `prepare` right before spawning. Never log the env.
- **Error codes:**
  - 14: vault locked. Show the lock screen.
  - 11 and 12: vault CLI not logged in, or not installed.
  - 20: Host not reviewed.
  - 21: this Box's ssh config isn't set up.
  - 22: no askpass channel. It only happens in-process, never through `roster serve`.
- **ControlMaster:** an existing shared connection skips the prompt. That's fine: the token simply expires.
- **Manual check:** confirm the real prompt wording on password gear (ESXi, switches). The helper only answers `user@host's password:`, `Password:`, `(user@host) Password:` and `Password for X:`.
