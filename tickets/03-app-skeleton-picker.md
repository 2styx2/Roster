# 03: App skeleton: window → WSL backend → host picker

**Iteration:** 1 · **Repo:** roster-desk · **Spec:** 0001 (stories 10–19, 50, 53)

**What to build:** The first runnable roster-desk, built with Tauri, React, Vite and TypeScript (strict). On Windows it detects a WSL distro where roster is on the PATH and the Inventory resolves. It starts `roster serve` there through `wsl.exe` and checks the API version. Pressing the leader key (Ctrl+Space) and then `f`, or clicking, opens a fuzzy picker over the real Hosts. The picker matches name, address, type, product, title and group, and moves with `j`/`k`, Ctrl+N/P and the arrow keys. Unreviewed Hosts are shown but marked as not connectable. Esc closes the picker. All UI talks to the backend through one typed client interface, which is also the seam for a fake backend in tests.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] The app builds and starts on Windows. It finds your WSL distro without any configuration.
- [ ] If roster is missing, too old, or the Inventory isn't found, the app shows a clear message saying what to fix.
- [ ] The picker lists the real Inventory and filters as you type, without noticeable delay with hundreds of Hosts.
- [ ] Unreviewed Hosts are visibly marked.
- [ ] Vitest and Testing Library tests use the fake backend to cover filtering, ranking, keyboard navigation and Esc.
- [ ] `tsc --noEmit`, the linter, Vitest and `cargo test` all pass. The README says how to run each.
- [ ] Every library and version choice that lands matches `docs/adr/0001-tauri-over-electron.md`, or a new ADR explains why not.

**Build loop and layout:** follow `docs/dev/windows-build-loop.md` (rsync to `%LOCALAPPDATA%\roster-desk-dev\src`, then `npm ci` and `tauri dev` through cmd.exe) and `docs/dev/testing.md` (a Cargo workspace with a Tauri-free `desk-core` crate, Vitest with jsdom, and a fake backend whenever `isTauri()` is false). For development, the roster command can be overridden with the environment variable `ROSTER_DESK_ROSTER` until the Lua Config (ticket 21) exists, for example `uv run --project ~/work/roster roster`.
