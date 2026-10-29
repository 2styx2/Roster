# 05: Sessions to key-enrolled Hosts

**Iteration:** 1 · **Repos:** roster + roster-desk · **Spec:** 0001 (stories 16, 20, 23–26, 30, 33) · **ADR:** roster 0002

**What to build:** `serve` gains `session.prepare`. It refuses unreviewed Hosts with the same wording as `roster run`, and for enrolled Hosts it returns the ssh command, using `BatchMode=yes`, and the environment to set. Pressing Enter in the picker opens a new tab. The Rust session manager starts that command in a PTY, wrapped in `wsl.exe` on the WSL backend, and streams it to an xterm.js terminal using the WebGL renderer, falling back to the DOM renderer. Every key goes to the shell, Esc included, except the leader chord. Resizing works, and closing the tab ends `ssh` cleanly.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] pytest: `session.prepare` returns a command for an enrolled Host, refuses an unreviewed one, and returns no secret.
- [ ] Rust integration test: the session manager runs a stub command in a PTY and covers input, output, resize and exit status.
- [ ] Manual check on Windows: open a Session to a real enrolled Host. Vim, htop and tmux work remotely, colors and resize are right, and Esc reaches remote vim.
- [ ] A failed connection, such as a host that's down or a key mismatch, shows ssh's own message in the tab.
- [ ] Closing the tab leaves no `ssh` process running in WSL.

**Notes from research** (`docs/dev/tauri-pty-wsl.md`, `docs/dev/xterm-setup.md`):
- Call WSL as `wsl.exe -d <distro> --cd ~ --exec <argv…>`, never `--`, which runs through a shell and loses quoting. Windows-side environment variables don't cross into WSL, so pass them as `env K=V`.
- `roster` is on PATH only in interactive shells. Resolve its absolute path once at startup, and have `session.prepare` return absolute paths.
- ConPTY asks for the cursor position (`ESC[6n`) and waits for an answer. xterm.js answers it, but a bare Rust test must write `\x1b[1;1R` first or it hangs.
- The xterm.js key handler must swallow Ctrl+Space (otherwise NUL goes to the shell). WebView2's own browser shortcuts (Ctrl+F, Ctrl+R…) need turning off through `with_webview`.
