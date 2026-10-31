# Writing a Plugin

A Plugin is a folder of Lua that adds to roster the way the app's own features do: commands, key bindings, Themes, Sidebar sections, finders, status segments, badges on Hosts, floating windows, notices and help pages. It runs in the same sandbox as your `init.lua` ([config.md](app/config.md#the-sandbox)), and it only gets the functions for the permissions you granted it. It never sees a password, the vault or what you type at a login prompt, and it can't Publish (ADR 0006, decision Q81).

A Plugin draws nothing itself. It hands the app data (rows, text, items) and the app draws them in roster's own style, with its keys and Theme, so a Plugin looks native and can't do anything else on screen.

## A first Plugin

[`examples/plugins/pinned`](../examples/plugins/pinned) is a complete one: a Sidebar section of the Hosts you pin with `:pin HOST`, a status segment, a finder, a key and a help page. Copy the folder to start your own.

```
pinned/
  roster-plugin.lua   the manifest: who it is and what it asks for
  init.lua            its code
  lua/pinned/*.lua    its own modules, if it has any: require("pinned.util")
```

The manifest is read before any of the Plugin's code runs, for the install prompt:

```lua
return {
  name = "pinned",              -- lower case letters, digits and -; how it's known everywhere
  version = "1.0.0",
  description = "A Sidebar section of the Hosts you pin",
  author = "you",
  api = 2,                      -- the roster.api_version it's written for
  permissions = { "inventory.read" },
}
```

And a few lines of `init.lua`:

```lua
local roster = require("roster")

roster.commands.add("hello", {
  desc = "Say hello",
  run = function(a) roster.notify("hello " .. a.args) end,
})
roster.keymap.set("leader", "h h", "hello world")
```

`:plugins install ~/plugins/pinned` installs it. To share it, push the folder to a git repo: others name it in `init.lua` as a [Package](#packages). A path is `~/…`, a full path, or a folder under the config folder (`plugins/pinned`).

## Installing and trusting

- **`:plugins install PATH`** reads the manifest and asks first: who wrote it, where it's from (unverified), and every permission it asks for, with the risky ones flagged and explained. Cancel (`Esc`) installs nothing.
- **An update that asks for a new permission asks again** at the next start. Until you answer, it doesn't run. "Not now" runs it without the new permission.
- **`:plugins`** lists every Plugin: whether it's running or why it stopped, its permissions as switches, and what it did lately. Turning a switch off takes the permission away at once: the Plugin is loaded again without it, with no restart. Turning it on grants it.
- **`:plugins remove NAME`** unloads it and takes everything it added away. **`:plugins reload NAME`** loads it again, after you've changed it or once it was stopped.
- `:plugins revoke NAME PERMISSION` and `:plugins grant NAME PERMISSION` do what the switches do.

What you granted is kept in the app's State, which neither `init.lua` nor a Plugin can write.

Every Plugin is made the same way, with the same API, the same prompts and the same install path. The one built into the app, `hosts` (the status bar's Host count), is written on this API too: `:plugins` lists it, and revoking its permission takes the count away.

## Packages

A Package is a Plugin from a git repo, named in `init.lua` and pinned to a commit, the way lazy.nvim does it for Neovim ([config.md](app/config.md#packages)):

```lua
packages = {
  { "someone/recent-alerts", tag = "v1.2.0", config = { patterns = { "ERROR", "panic" } } },
  "https://git.example.com/team/roster-extras.git",
},
```

- **Nothing installs that isn't named there.** At start, and on `:source` after you change the list, the app clones each new one into its own data folder (next to the State, never the config folder) and asks first, with the same prompt as `:plugins install`: who wrote it, its git URL and commit as the unverified source, and every permission. Cancel removes the clone and installs nothing; it asks again at the next start while `init.lua` still names it.
- **`roster.lock`**, next to `init.lua`, pins each installed Package's commit. Put it in your dotfiles with `init.lua`: on another machine the app clones exactly those commits (and asks, since what you granted is per Box). With the clones and the lock in place, the app starts without the network.
- **`:packages`** lists them: the commit each is at, what `init.lua` asks for, and whether it runs.
- **`:packages update`** fetches each one and shows what's new before anything changes: the commits, the diff, and any permission the new version asks for. Enter updates (and grants what it newly asks for); Esc keeps the version it has.
- **`:packages clean`** removes the clones and lock lines of Packages `init.lua` no longer names, with everything they added. **`:plugins remove NAME`** takes one out at once, clone and lock line included.
- **`config`** is a table of settings the Package reads as `roster.plugin.config` (a `config = function() … end` as in lazy.nvim isn't possible: the Package's code runs in a Lua state of its own, which a function from `init.lua` can't move into).

The app runs your system's `git` (it must be installed) with no shell, no credentials of roster's and no way to ask for any: a private repo works when your own git setup (an ssh agent, say) already gets in. Only `https`, `ssh` and `file` URLs, no submodules, and no hooks.

## Permissions

A function a permission gives isn't there without it: `roster.inventory` is `nil` until `inventory.read` is granted. Each of them checks the grant again when it's called.

| Permission | What it adds | Why it's flagged |
|---|---|---|
| none | Commands, keys, Themes, Sidebar sections, status segments, finders, badges, floats, notices, help pages, the `lock` and `unlock` events | |
| `inventory.read` | `roster.inventory.hosts()`, `roster.inventory.host(name)`: Hosts with their Login *references* (a vault item's name, never its password); the events that name a Host | |
| `inventory.write` | `roster.inventory.update(host, changes)`, `rename(host, to)`, `move(host, group)`, `review(host, reviewed)`: as Pending changes, which you review and Publish | Can change Hosts |
| `sessions.open` | `roster.sessions.open(host)`, as `:connect HOST` | Can open Sessions on your Hosts |
| `terminal.read` | The `terminal_output` event: what your Sessions print | Sees everything your Sessions print, including anything a server echoes back. A password you type at a prompt that echoes it would be visible too |
| `terminal.write` | `roster.terminal.send(session, text)` | Can type into your Sessions, as if you typed it |
| `serve:METHOD` | `roster.serve.call(method, params)` for that method only: `inventory.info`, `hosts.list`, `host.get`, `host.check`, `changes.diff`, and the `mesh.*` and `discover.*` methods | Any method that can change something (`mesh.apply`, `mesh.cut`, …): everything but `inventory.info`, `hosts.list`, `host.get`, `changes.diff`, `mesh.status` and `mesh.plan` |

No permission reaches a secret. The vault, a session's password, askpass and the master password live only in `roster serve` and never pass through the app; the serve methods that touch them (`vault.*`, `session.*`, `quick.*`, `host.add`, `host.save_login`, `changes.publish`) can't be granted at all, and a manifest that asks for one doesn't install. `network` isn't available yet.

## The `roster` module

`require("roster")` (also the global `roster`). `roster.api_version` is `2`; a manifest with a higher `api` asks for a newer app.

| Name | What |
|---|---|
| `roster.plugin` | `{ name, version, permissions, config }`: the Plugin itself, what it was granted, and its settings from `init.lua` when it's a Package (else `{}`) |
| `roster.os` | `"windows"`, `"linux"` or `"macos"` |
| `roster.commands.add(name, { desc, run })` | `:name ARGS` runs `run({ args = "ARGS", words = { … } })`, or `run` is a command line. A name roster or another Plugin has is refused |
| `roster.commands.remove(name)` | |
| `roster.keymap.set(context, keys, action)` | A key after the Leader (`"leader"`) or in the Sidebar (`"list"`, `"list_vim"`), bound to a command line (one of yours, or the app's). Never in the terminal, never over a key that's bound already, never one that would hide one (`"a z"` when `a` is bound) |
| `roster.themes.define(id, theme)` | A Theme, as `init.lua`'s `themes` takes it ([config.md](app/config.md#themes-and-colours)) |
| `roster.sidebar.set(id, { title, order, empty, rows })` | A Sidebar section; setting it again replaces it. `order`: Sessions is 100, the Inventory 300; yours default to 400 |
| `roster.status.set(id, { text, title, run })` | A status bar segment, after the app's own (a layout can place it: `modes.standard.statusbar`) |
| `roster.finders.set(id, { title, items })` | A finder: `:finder id`. Items are `{ label, detail, path, run }` |
| `roster.help.set(topic, { title, summary, markdown })` | A help page, as Markdown: `:help topic`. It's listed under your Plugin's name |
| `roster.health.set(id, { title, checks })` | A section of `:check` (this Box's health): checks are `{ level = "ok"\|"warn"\|"error", message, fix }`, as the Plugin last set them |
| `roster.sidebar.remove(id)`, `roster.status.remove(id)`, `roster.finders.remove(id)`, `roster.help.remove(id)`, `roster.health.remove(id)` | |
| `roster.badges.set(host, text)` | A badge on the Host's Inventory row (`"2 alerts"`); `nil` takes it off |
| `roster.float.open({ title, lines })`, `roster.float.close()` | A floating window over the terminal; `Esc` closes it |
| `roster.notify(text, level)` | A notice, `"info"` (the default), `"warn"` or `"error"`, naming your Plugin |
| `roster.on(event, function(e) … end)` | Runs on an event (below) |

A Sidebar row is `{ id, label, detail, note, host, badge, count, level, title, run, actions }`. With `host`, the row is that Host's: Enter opens it and it lights up while it's on screen. `actions` are buttons on the row: `{ label, icon, run }`, with `icon` one of `close`, `edit`, `add`, `addGroup`, `review`, `unreview`, `info`. Everywhere, `run` is a function or a command line; a function runs in your Plugin when the user chooses the thing.

### Events

| Event | `e` | Needs |
|---|---|---|
| `lock`, `unlock` | `{}` | nothing |
| `host_selected` | `{ host }`: the Session on screen changed | `inventory.read` or `terminal.read` |
| `session_open`, `session_exit` | `{ session, host }`, and `code` at exit | `inventory.read` or `terminal.read` |
| `inventory_changed` | `{}` | `inventory.read` |
| `terminal_output` | `{ session, host, text }`: what a Session printed, as text without colours or escape sequences, a few times a second | `terminal.read` |

Subscribing to an event your Plugin may not hear is an error. What you type into a Session is never an event.

## Limits

Your Plugin runs in its own Lua state, on its own thread, with the sandbox's libraries (no `io`, no `os.execute`, `require` from its own folder only) and:

- **32 MB** of memory;
- **1 second** to run `init.lua`, and **a quarter of a second** for each call (a command, an action, an event). Time spent waiting for roster serve doesn't count. Running out can't be caught with `pcall`;
- at most 1,000 UI changes in one call, and 2,000 rows in a section, items in a finder or lines in a float. Text is cut to 500 characters (a help page to 200,000).

An error shows a notice naming your Plugin with the file and line: `pinned: init.lua:12: attempt to index a nil value`. An error while loading stops the Plugin; so does a third error after that, and so does a call that doesn't answer within two seconds of its budget (a long pattern match, say). When it stops, everything it added goes away and the rest of the app carries on. `:plugins` says why, and `:plugins reload NAME` tries again.

## For roster's developers: how it's built

The Lua runs in roster-core (`crates/roster-core/src/plugin/`), never in the frontend, and it reaches roster only through `roster serve`'s methods its permissions name. Each call into a Plugin answers with the result and a list of **ops**: plain data such as `{ "op": "section", "id": "pinned", "spec": { … } }`, with each Lua function replaced by `{ "handler": N }`. The frontend (`app/src/plugins/`) checks every op (`ops.ts`), puts it into the registries with the Plugin's name as its source, and runs a handler with `:plugins call NAME N`. Packages (ticket 24) are `crates/roster-core/src/package/`: git as a subprocess (`git.rs`), the clones in the app's data folder and `roster.lock`; the frontend loads one as the Plugin `package:NAME`, which the Tauri side turns into its clone and its settings from `init.lua` (`PluginHost::load_with`).

## See also

[How far roster bends](app/extending.md) · [Your init.lua](app/config.md) · [Where secrets go](app/security.md) · [Plugins and Packages, as decided](adr/0006-lua-plugins-and-packages.md)
