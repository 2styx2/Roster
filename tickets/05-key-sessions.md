# 05: Sessions to key-enrolled Hosts

**Iteration:** 1 · **Repos:** roster + roster-desk · **Spec:** 0001 (stories 16, 20, 23–26, 30, 33) · **ADR:** roster 0002

**What to build:** `serve` gains `session.prepare`. It refuses unreviewed Hosts with the same wording as `roster run`, and for enrolled Hosts it returns the ssh command, using `BatchMode=yes`, and the environment to set. Pressing Enter in the picker opens a new tab. The Rust session manager starts that command in a PTY, wrapped in `wsl.exe` on the WSL backend, and streams it to an xterm.js terminal using the WebGL renderer, falling back to canvas. Every key goes to the shell, Esc included, except the leader chord. Resizing works, and closing the tab ends `ssh` cleanly.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] pytest: `session.prepare` returns a command for an enrolled Host, refuses an unreviewed one, and returns no secret.
- [ ] Rust integration test: the session manager runs a stub command in a PTY and covers input, output, resize and exit status.
- [ ] Manual check on Windows: open a Session to a real enrolled Host. Vim, htop and tmux work remotely, colors and resize are right, and Esc reaches remote vim.
- [ ] A failed connection, such as a host that's down or a key mismatch, shows ssh's own message in the tab.
- [ ] Closing the tab leaves no `ssh` process running in WSL.
