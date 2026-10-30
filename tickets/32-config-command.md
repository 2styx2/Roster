# 32: `:config`, and configuration made discoverable

**Iteration:** 3 · **Repo:** roster (app) · **Decision:** Q54 (taste: "Made to be made yours")

**What to build:**
- **`:config`** opens `init.lua` in the user's editor (the OS default, or `$EDITOR` inside WSL if set in the Config). If the file doesn't exist yet, it first creates one from `examples/init.lua`, with everything commented out.
- **`:config reload`** reloads the file, and **`:config path`** shows where it is.
- **Show the option name everywhere a configurable thing appears.** In the Key bindings panel, the theme finder and the layout pieces, show its Config name (`theme`, `keys.leader`, `modes.focus.sessionbar`, …) with "change in init.lua", next to the source labels (`builtin`, `init.lua`, Plugin) that already exist.

**Blocked by:** 21 (done), 29

**Status:** ready-for-agent

- [ ] UI tests: `:config` creates the file once and never overwrites it; option names appear in the Key bindings panel and the theme finder.
- [ ] Manual check on Windows: `:config` opens the file, an edit applies live on save, and `:config path` shows the right path.
