# recent-alerts

A roster Plugin that watches what your Sessions print and lists the lines that look like trouble (`ERROR`, `panic`, `disk full`) in the Sidebar, with the Host and time of each.

It's also the template for writing your own: copy this folder, rename it, and change what you need. Everything it does goes through roster's public Plugin API ([docs/plugins.md](../../../docs/plugins.md), `:help plugins`), and it asks for one permission.

## What it adds

| Where | What |
|---|---|
| Sidebar | A **Recent alerts** section, newest first: the line, its Host and the time. Enter goes to the Host's Session; the buttons show the details, copy the line or dismiss it |
| Inventory | A badge on each Host that has alerts: `2 alerts` |
| Status bar | `⚠ 3`, which opens the finder |
| Finder | `:finder alerts` (and `␣ w w`): search the alerts; Enter shows one's details |
| Floating window | An alert's details: Host, Session, time, the pattern, and the lines before it. `Esc` closes it |
| Notices | One when new alerts arrive (several at once make one notice) |
| Commands | `:alerts` shows them all; `:alerts clear` dismisses them all |
| Help | `:help recent-alerts` |

The alerts live in memory: they're gone when the app restarts.

## Permissions

It asks for **`terminal.read`** only: the `terminal_output` event, the text your Sessions print. That's everything a server prints, so the install prompt flags it: a password you type at a prompt that echoes it would be visible too. It never sees what you type, a vault password or what you type at roster's own password prompts.

Without `terminal.read` (Cancel it in the update prompt, or turn it off in `:plugins`) it still loads, and its section says what it's missing. It can't type into a Session, open one, read the Inventory or reach the network: those functions aren't in its sandbox.

## Install

As a Package, in your `init.lua`:

```lua
packages = {
  { "someone/recent-alerts", tag = "v1.0.0", config = {
    patterns = { "ERROR", "panic", "disk full" }, -- plain text, matched as is (not Lua patterns)
    leader = "w w",                               -- the keys after the Leader that open its finder
    max = 100,                                    -- how many alerts it keeps
    notify = true,                                -- a notice for each new alert
  } },
},
```

The app clones it, shows who wrote it and where it's from (unverified), and asks before it runs. Or, from a folder on this machine: `:plugins install ~/plugins/recent-alerts`.

A setting it can't use is named in a notice, and the default is used instead.

## How it's made

```
recent-alerts/
  roster-plugin.lua            the manifest: name, version, author, api, permissions
  init.lua                     the Plugin: the section, badges, status, finder, command, key, help page
  lua/recent-alerts/match.lua  the pure part: settings, splitting output into lines, matching
```

- **The manifest** is read before any of its code runs, for the install prompt. Ask for as little as you can: each permission is a line the user has to accept.
- **`roster.plugin.config`** is the table from init.lua's `config = { … }`. Check it: anyone can write anything there.
- **`roster.plugin.permissions`** says what it was granted. Listening for an event it may not hear is an error, so it only calls `roster.on("terminal_output", …)` when it has `terminal.read`.
- **One `show()` draws everything** from its own state: the section, the finder, the status segment and the badges. Each `set` replaces the last, so there's nothing to keep in step.
- **`terminal_output` comes in batches**, a few times a second, without colours or escape sequences. A line can be split across two batches, so it keeps the unfinished end of each Session's output until the rest arrives, and forgets it on `session_exit`.
- **Everything is in name order** (the badges, the rows), so the same alerts always make the same changes.
- **Copying** (`roster.clipboard.copy`) works only inside an action the user chose; at load or on an event it's an error.

## Testing it

roster's CI runs this Plugin end to end: `crates/roster-core/tests/recent_alerts.rs` makes a git repo from this folder, installs it as a Package and drives it through the Plugin host (every slot, what it can't reach, revoking, updates, removal, and versions that throw, loop or use too much memory). It records what the Lua did in `app/src/plugins/recent-alerts.transcript.json`; the app's tests replay that against their stand-in for this Plugin (`app/src/backend/fakeRecentAlerts.ts`) and then test the UI with it. Change the Lua, run `ROSTER_UPDATE_TRANSCRIPT=1 cargo test -p roster-core --test recent_alerts`, and update the stand-in to match.
