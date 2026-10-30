# 32: `:config`, and configuration made discoverable

**Iteration:** 3 · **Repo:** roster (app) · **Decision:** Q54 (taste: "Made to be made yours")

**What to build:**
- **`:config`** opens `init.lua` in the user's editor (the OS default, or `$EDITOR` inside WSL if set in the Config). If the file doesn't exist yet, it first creates one from `examples/init.lua`, with everything commented out.
- **`:config reload`** reloads the file, and **`:config path`** shows where it is.
- **Owner decision Q58 (Neovim-style):** **`:source`** (`:so`, `␣ S`) reloads the Config now, `:source PATH` only the file that owns it, and a save no longer reloads unless `auto_reload = true`. `:config reload` is `:source init.lua`. What `:source` reloads is a registry, for ticket 28's `folders.yml` and `roster.yml`.
- **Show the option name everywhere a configurable thing appears.** In the Key bindings panel, the theme finder and the layout pieces, show its Config name (`theme`, `keys.leader`, `modes.focus.sessionbar`, …) with "change in init.lua", next to the source labels (`builtin`, `init.lua`, Plugin) that already exist.

**Blocked by:** 21 (done), 29

**Status:** done (manual check by the agent on Windows, 2026-10-30; owner review pending)

- [x] UI tests for `:source` and `auto_reload` (`app/src/App.source.test.tsx`; the core's rule in `crates/roster-core/tests/config.rs`).
- [x] UI tests (`app/src/App.configcmd.test.tsx`; the file itself in `crates/roster-core/tests/config.rs`): `:config` creates the file once and never overwrites it; option names appear in the Key bindings panel and the theme finder.
- [x] Manual check on Windows (dev build, a scratch `%APPDATA%`): `:config path` showed `…\appdata\roster\init.lua`; the first `:config` made the commented-out file and opened it (Notepad, as `.lua` has no app on that machine; the "Pick an app" dialog is skipped); a save with `theme = "nord"` applied live and removing it went back; `:config reload` said "Reloaded init.lua"; `editor = "wsl"` opened it in nvim (`$EDITOR`) in the Backend's distro. After Q58: a save left the Theme alone and showed "init.lua changed ␣ S apply" in the status bar, `␣ S` (then `␣ c s`; moved to `␣ S` because ticket 10 took `␣ c`) applied it, `:so` too, and with `auto_reload = true` sourced once, saves applied at once.
