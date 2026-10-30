# 20: Linux build check

**Iteration:** 6 · **Repo:** roster (app) · **Spec:** 0001 (story 54) · **Further Notes:** WebKitGTK risk

**What to build:** Build and run the roster app on Linux under X11, Wayland and WSLg. Check that the terminal's WebGL renderer falls back to the DOM renderer where it has to. Measure typing latency and picker speed, and fix whatever stops the app feeling native.

**Blocked by:** 08

**Status:** ready-for-agent

- [ ] The app runs on the user's Linux VM under X11 and Wayland, and under WSLg.
- [ ] Typing latency is checked with a large paste and with `htop`. Results are noted in the docs.
- [ ] Platform shortcuts and light/dark behave correctly on Linux.
