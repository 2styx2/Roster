# 19: Native Windows backend

**Iteration:** 6 · **Repos:** roster + roster-desk · **Spec:** 0001 (stories 51, 55)

**What to build:** Make roster run natively on Windows:
- Process launching: no reliance on `os.execvp`.
- Windows paths for config and the key.
- Windows' built-in OpenSSH.
- The askpass channel as a named pipe that only the user can open.

Add the Settings switch between Local and WSL: <distro>, keeping auto-detection as the default.

**Blocked by:** 06

**Status:** ready-for-agent

- [ ] The roster test suite passes on Windows in CI, or at least locally.
- [ ] The app connects with native roster to both an enrolled Host and a password-only Host.
- [ ] Switching the Backend in Settings restarts `serve` and works both ways.
