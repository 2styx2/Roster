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
