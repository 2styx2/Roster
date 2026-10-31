# Writing a Plugin

A Plugin is a folder of Lua that adds to roster the way the app's own features do: commands, key bindings, Themes, Sidebar sections, finders, status segments, toolbar controls, badges on Hosts, floating windows, views (side panels and full views with tables), sections of a Host's details, questions the app asks for it, progress, notices and help pages. It runs in the same sandbox as your `init.lua` ([config.md](app/config.md#the-sandbox)), and it only gets the functions for the permissions you granted it. It never sees a password, the vault or what you type at a login prompt, and it can't Publish (ADR 0006, decision Q81).

A Plugin draws nothing itself. It hands the app data (rows, text, items) and the app draws them in roster's own style, with its keys and Theme, so a Plugin looks native and can't do anything else on screen.

## A first Plugin

[`examples/plugins/recent-alerts`](../examples/plugins/recent-alerts) is the worked example, built the way an author outside roster would build one: it watches what your Sessions print and lists the lines with `ERROR`, `panic` or `disk full` in a Sidebar section, with a badge on each Host that has some, a status segment with the count, a finder, a floating window with an alert's details, a notice when one arrives, `:alerts` and `:alerts clear`, a Leader key from its settings and its own help page. It asks for one permission, `terminal.read`. Copy the folder to start your own; its [README](../examples/plugins/recent-alerts/README.md) is the template for yours. [`examples/plugins/pinned`](../examples/plugins/pinned) is a smaller one that reads the Inventory.

```text
recent-alerts/
  roster-plugin.lua            the manifest: who it is and what it asks for
  init.lua                     its code
  lua/recent-alerts/match.lua  its own modules, if it has any: require("recent-alerts.match")
  README.md                    what it does, what it asks for and why, and its settings
```

The manifest is read before any of the Plugin's code runs, for the install prompt:

```lua
return {
  name = "recent-alerts",       -- lower case letters, digits and -; how it's known everywhere
  version = "1.0.0",
  description = "Lines your Sessions print that look like trouble",
  author = "you",
  api = 3,                      -- the roster.api_version it's written for
  permissions = { "terminal.read" },
}
```

And the heart of its `init.lua`, shortened:

```lua
local roster = require("roster")
local settings = roster.plugin.config          -- init.lua's config = { … }, when it's a Package
local alerts = {}

local function show()
  local rows = {}
  for i = #alerts, 1, -1 do
    local a = alerts[i]
    rows[#rows + 1] = { id = tostring(a.id), label = a.text, detail = a.host, host = a.host,
      actions = { { label = "Copy " .. a.text, icon = "copy", run = function() roster.clipboard.copy(a.text) end } } }
  end
  roster.sidebar.set("recent-alerts", { title = "Recent alerts", empty = "No alerts.", rows = rows })
  roster.status.set("alerts", { text = "⚠ " .. #alerts, run = "finder alerts" })
end

roster.commands.add("alerts", {
  desc = "Recent alerts",
  run = function(a) if a.words[1] == "clear" then alerts = {} show() end end,
})
roster.keymap.set("leader", settings.leader or "w w", "finder alerts")

-- Only with terminal.read: listening for an event it may not hear is an error.
if roster.has("terminal.read") then
  roster.on("terminal_output", function(e)
    for line in e.text:gmatch("[^\n]+") do
      if line:find("ERROR", 1, true) then
        alerts[#alerts + 1] = { id = #alerts + 1, host = e.host, text = line }
      end
    end
    show()
  end)
end
show()
```

Some things it shows that every Plugin meets:

- **Draw everything from your own state in one function.** Each `set` replaces what was there, so calling `show()` after any change keeps the section, finder, status and badges in step.
- **Check `roster.plugin.config`**: anyone can write anything in init.lua. Name a bad setting in a notice and use the default.
- **Ask only for what you need**, and keep working without it: check with `roster.has("terminal.read")`, and say what's missing (its section reads "Allow terminal.read in :plugins to see alerts.").
- **`terminal_output` comes as whole lines**, the way the terminal shows them once the Session moves past them; recent-alerts still keeps an unfinished end, which costs nothing.
- **Keep what you show true with a timer**: its rows say "just now", then "4 min ago", and `roster.every(30000, show)` draws them again while there are alerts; it cancels the timer when there are none.
- **Keys after the Leader that roster uses are refused** (`a` is Folders', `f` the Picker's; `:keys` lists them all), with a notice that names what has the key and a few free ones like it. Make yours a setting.
- **The same state makes the same changes**: `pairs` visits keys in order (numbers, then text), so badges set from a table of Hosts come out in name order on every machine.

`:plugins install ~/plugins/recent-alerts` installs it. To share it, push the folder to a git repo: others name it in `init.lua` as a [Package](#packages). A path is `~/…`, a full path, or a folder under the config folder (`plugins/pinned`).

## Installing and trusting

- **`:plugins install PATH`** reads the manifest and asks first: who wrote it, where it's from (unverified), and every permission it asks for, with the risky ones flagged and explained. Cancel (`Esc`) installs nothing.
- **An update that asks for a new permission asks again** at the next start. Until you answer, it doesn't run. "Not now" runs it without the new permission.
- **`:plugins`** lists every Plugin: whether it's running or why it stopped, its permissions as switches, and what it did lately. Turning a switch off takes the permission away at once: the Plugin is loaded again without it, with no restart. Turning it on grants it.
- **`:plugins remove NAME`** unloads it and takes everything it added away. **`:plugins reload NAME`** loads it again, after you've changed it or once it was stopped.
- `:plugins revoke NAME PERMISSION` and `:plugins grant NAME PERMISSION` do what the switches do.
- **`:plugins types PATH`** writes the API's types for this app as `types/roster.lua` in the Plugin folder PATH, over an older copy ([Types in your editor](#types-in-your-editor)).

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
- **`dir`** loads the Plugin from a folder of the repo instead of its top, for a repo that holds several: `{ "https://git.example.com/team/roster-extras.git", dir = "plugins/alerts" }`. The clone is the whole repo; the Package is named after the folder (`alerts`) unless `name =` says otherwise. The prompts show the folder next to the git URL, `roster.lock` keeps it (another folder is other code, so it asks again), and `:packages update` shows only the commits, diff and manifest of that folder: a commit elsewhere in the repo isn't an update to it. The folder must be inside the repo: a full path, `..`, a backslash, `.git`, or a symlink that leads out of the clone is refused ([errors](app/errors.md#packages)). Two Packages from one repo each get a clone of their own, so each is pinned and updated on its own (decision Q94).

The app runs your system's `git` (it must be installed) with no shell, no credentials of roster's and no way to ask for any: a private repo works when your own git setup (an ssh agent, say) already gets in. Only `https`, `ssh` and `file` URLs, no submodules, and no hooks.

### First-party Plugins

Optional Plugins the roster project writes live in roster's repo, one folder each under [`plugins/`](../plugins/README.md), and install as Packages like any other (decisions Q81 and Q94): the same prompt, the same permissions, pinned in `roster.lock`. None is bundled in the app. What sets them apart is that they're reviewed like the core, tested in CI with it, and security-reviewed against [a checklist](../plugins/README.md#security-review). To install one, name it with `dir`:

```lua
packages = {
  { "https://github.com/2styx2/roster", dir = "plugins/NAME" },
},
```

| Plugin | What it does | Its line in `init.lua` |
|---|---|---|
| [mesh](../plugins/mesh/README.md) | The Mesh controls: each Host's reach, plan and apply, Cut | `{ "https://github.com/2styx2/roster", dir = "plugins/mesh" }` |
| [discover](../plugins/discover/README.md) | Scan a network from the app (`:discover 10.0.0.0/24`, the toolbar's **Scan**), watch what answers come in, keep the ones you want and add them, unreviewed, as Pending changes. The scan runs in `roster serve` ([`discover.*`](serve-api.md#discover-discoverplan-discoverstart-discoverstatus-discoverstop-discoveradd)); it asks before scanning and before adding | `{ "https://github.com/2styx2/roster", dir = "plugins/discover" }` |

[`mesh`](../plugins/mesh/README.md) is also the worked example of a Plugin that runs something long in roster serve: every Mesh run is a job it starts with `background = true`, follows with a timer polling `mesh.job` for its progress, and stops with `mesh.stop`, because a call into serve may not wait more than a couple of seconds. The Topology view is planned next.

## Permissions

A function a permission gives isn't there without it: `roster.inventory` is `nil` until `inventory.read` is granted. Each of them checks the grant again when it's called.

| Permission | What it adds | Why it's flagged |
|---|---|---|
| none | Commands, keys, Themes, Sidebar sections, status segments, toolbar controls, finders, badges, floats, views and their tables, Host-details sections, questions (`roster.confirm`), progress, notices, help pages, `roster.cmd` for [the commands that only show something](plugin-api.md#command-lines-a-plugin-may-run), going to a Session (`roster.sessions.show`), the `lock` and `unlock` events | |
| `inventory.read` | `roster.inventory.hosts()`, `roster.inventory.host(name)`, `roster.inventory.groups()`: Hosts with their Login *references* (a vault item's name, never its password; a `cmd:` or `env:` one cut to `cmd:` or `env:`, since it says how a secret is fetched); the events that name a Host; the Session on screen in a handler's context | |
| `inventory.write` | `roster.inventory.update(host, changes)`, `rename(host, to)`, `move(host, group)`, `review(host, reviewed)`: as Pending changes, which you review and Publish | Can change Hosts |
| `sessions.open` | `roster.sessions.open(host)`, as `:connect HOST`; `:open` and `:connect` in `roster.cmd` and a `run` line | Can open Sessions on your Hosts |
| `terminal.read` | The `terminal_output` event: what your Sessions print | Sees everything your Sessions print, including anything a server echoes back. A password you type at a prompt that echoes it would be visible too |
| `terminal.write` | `roster.terminal.send(session, text)` | Can type into your Sessions, as if you typed it |
| `serve:METHOD` | `roster.serve.call(method, params)` for that method only: `inventory.info`, `hosts.list`, `host.get`, `host.check`, `changes.diff`, and the `mesh.*` and `discover.*` methods. `discover.start` (a scan) and `discover.add` work only in a call the user started, never at load, on an event or from a timer | Any method that can change something or reach the network (`mesh.apply`, `mesh.cut`, `discover.start`, `discover.add`, …): everything but `inventory.info`, `hosts.list`, `host.get`, `changes.diff`, `mesh.status`, `mesh.plan`, `mesh.job`, `mesh.stop`, `discover.plan`, `discover.status` and `discover.stop`. `discover.start` says it scans networks from this computer |
| `network:SITE` | `roster.http.request(request, done)` and `roster.http.get(url, done)`, to that site only | Always: anything the Plugin can read could leave this computer. Also said: plain `http://`, and an address on this computer or a private network |

No permission reaches a secret, nor how one is fetched: a `cmd:COMMAND` or `env:VAR` Login reference reaches a Plugin as `cmd:` or `env:`, from `roster.inventory` and `roster.serve.call` alike (decision Q92), since a command line can carry a secret pasted into it. The vault, a session's password, askpass and the master password live only in `roster serve` and never pass through the app; the serve methods that touch them (`vault.*`, `session.*`, `quick.*`, `host.add`, `host.save_login`, `changes.publish`) can't be granted at all, and a manifest that asks for one doesn't install.

### The network

A Plugin that talks to a web service lists each site it needs, one permission each, and the install prompt shows every one of them, flagged:

```lua
permissions = { "terminal.read", "network:hooks.example.com", "network:*.status.example.org" },
```

| You write | It reaches |
|---|---|
| `network:api.example.com` | `https://api.example.com` on port 443, exactly: not `example.com`, not `x.api.example.com`, not plain http |
| `network:*.example.com` | any name under `example.com` (`a.example.com`, `a.b.example.com`), over https; **not** `example.com` itself, so list that too if you need it. `*.` only at the start, before two names or more (no `*.com`) |
| `network:http://api.example.com` | plain http to that name on port 80, and only that: anyone on the way can read and change it, and the prompt says so |
| `network:api.example.com:8443` | that name on port 8443 instead of 443 |
| `network:10.0.0.5`, `network:http://10.0.0.5:8080`, `network:[fd00::5]` | that address exactly: the only way to reach this computer or a private network |

Sites are written in lower case, with no path, user or password; a name is ASCII (punycode, `xn--…`, for others). A bare `network` doesn't install: it has to say where.

The requests run in roster's core, never in the app's window, and don't wait: `done` gets the answer later, as a call of its own. A redirect is followed only to a site the Plugin may reach. A name that resolves to an address on this computer or a private network (`localhost`, `10.…`, `192.168.…`, link-local, …) is refused, so a site can't be pointed inside your network later: list the address itself if that's what you mean. No cookies, proxy or credentials of roster's go along; a token of the Plugin's own goes in a header (from `roster.plugin.config`, say). At most 4 requests at once, a 256 KB body out, a 1 MB body back, 30 seconds each. An update that adds a site asks again, like any new permission; `:plugins` turns each site off on its own. What can go wrong is in [A Plugin's network requests](app/errors.md#a-plugins-network-requests).

## The `roster` module

`require("roster")` (also the global `roster`) is the whole API. **[The Plugin API](plugin-api.md)** is its reference: every function with its parameters, returns, errors, permission and an example, and every type with all its fields (`:help plugin-api`; `:help roster.inventory.host()` for one function, `:help roster-Host` for one type). In short:

| Area | Functions | Permission |
|---|---|---|
| The Plugin and the app | [`roster.plugin`](plugin-api.md#rosterplugin), [`roster.api_version`](plugin-api.md#rosterapi_version), [`roster.os`](plugin-api.md#rosteros), [`roster.has`](plugin-api.md#rosterhaspermission), [`roster.notify`](plugin-api.md#rosternotifytext-level), [`roster.on`](plugin-api.md#rosteronevent-listener) | none |
| Timers | [`roster.defer`](plugin-api.md#rosterdeferms-fn), [`roster.every`](plugin-api.md#rostereveryms-fn), [`roster.cancel`](plugin-api.md#rostercanceltimer) | none |
| Commands and keys | [`roster.commands`](plugin-api.md#rostercommands), [`roster.keymap`](plugin-api.md#rosterkeymap) | none |
| What the app draws for you | [`roster.sidebar`](plugin-api.md#rostersidebar), [`roster.status`](plugin-api.md#rosterstatus), [`roster.toolbar`](plugin-api.md#rostertoolbar), [`roster.finders`](plugin-api.md#rosterfinders), [`roster.badges`](plugin-api.md#rosterbadges), [`roster.float`](plugin-api.md#rosterfloat), [`roster.views`](plugin-api.md#rosterviews), [`roster.details`](plugin-api.md#rosterdetails), [`roster.progress`](plugin-api.md#rosterprogress), [`roster.themes`](plugin-api.md#rosterthemes) | none |
| Asking, and acting for the user | [`roster.confirm`](plugin-api.md#rosterconfirmquestion), [`roster.cmd`](plugin-api.md#rostercmdline), [`roster.sessions.show`](plugin-api.md#rostersessionsshowsession-line) | none, in a call the user started |
| Help, health and tutorials | [`roster.help`](plugin-api.md#rosterhelp), [`roster.health`](plugin-api.md#rosterhealth) ([below](#health-sections)), [`roster.tutor`](plugin-api.md#rostertutor) | none |
| The clipboard | [`roster.clipboard`](plugin-api.md#rosterclipboard) | none, in a call the user started |
| Hosts | [`roster.inventory`](plugin-api.md#rosterinventory) | `inventory.read`, `inventory.write` |
| Sessions | [`roster.sessions.open`](plugin-api.md#rostersessionsopenhost), [`roster.terminal`](plugin-api.md#rosterterminal) | `sessions.open`, `terminal.write` |
| roster serve | [`roster.serve`](plugin-api.md#rosterserve) | `serve:<method>` |
| HTTP | [`roster.http`](plugin-api.md#rosterhttp) | `network:<site>` |

Everywhere a Plugin hands the app something to run (a row, a button, a finder item, a status segment, a toolbar control, a command), `run` is a function or a command line; a function runs in your Plugin when the user chooses the thing. It's told which thing that was: a [`HandlerContext`](plugin-api.md#handlercontext) such as `{ section = "pinned", row = "esx-02", action = 1 }` for a row's first button, `{ finder = "pinned", item = "3" }`, `{ toolbar = "alerts" }`, `{ progress = "sync" }` for its `cancel`, or `{ confirm = "yes" }`, with the Session on screen (`session`, `session_host`) when the Plugin has `inventory.read` or `terminal.read`. So one function can serve every row. A command line runs only if it's one of your own commands or one of [the few of roster's a Plugin may run](plugin-api.md#command-lines-a-plugin-may-run) (`finder`, `view`, `help`, `info`, and `open` or `connect` with `sessions.open`); anything else, `:plugins grant …` above all, is refused with a notice when the user presses the button, whatever its label says. [Events](plugin-api.md#events) come through `roster.on`; a Quick Connect Session's `host` is `nil` in them, since it isn't on a Host: don't badge it or make a row go to it. What you type into a Session is never an event, but the shell echoes it back, so it's in `terminal_output` like anything else the Session prints (recent-alerts skips a line that looks like a prompt and a command).

`terminal_output` is the lines a Session's terminal commits: the app runs each Session's output through a terminal of its own (never shown) and sends a line when the cursor moves past it, as it reads then. So there are no escape sequences, a progress bar arrives as it ended, and a wrapped line comes whole. A line drawn again with the same text in the same row isn't sent again: after the app resizes a Session (a panel, Focus, the window), ConPTY prints the whole screen again on Windows, and that isn't new output. What a full-screen program (`vim`, `top`, `less`) draws isn't sent at all.

A finder's `items` can be a function: it runs in your Plugin each time the finder opens, so a list that's costly to build, or changes often, is built only when someone looks. Until it first answers, the finder says "Loading…".

Timers (`roster.defer(ms, fn)` once, `roster.every(ms, fn)` again and again, `roster.cancel(timer)`) keep their clock in the app, which runs `fn` in your Plugin when it's time, on its own thread, like an action. A timer isn't something the user did, so it can't copy to the clipboard. Every timer ends with the Plugin: removing, reloading, revoking a permission (which reloads it) or its being stopped cancels them all.

Lua can't tell an empty list from an empty table of fields: `{}` reaches the app as `{}`, and the app takes it as an empty list wherever it wants one (`rows = {}`).

Text you hand the app (a label, a notice, a float's lines, a badge, what you copy) that isn't valid UTF-8, such as a line you cut in the middle of a character, is shown with `�` where it breaks; it isn't an error. A name that isn't (an id, a table key) is.

A tutorial (`roster.tutor.set`) runs on the demo Inventory, where your Plugin isn't loaded: a step can wait for your command being run there, but your command won't do anything there yet. Its steps wait for the app's own events ([`StepMatch`](plugin-api.md#stepmatch)).

### Health sections

`roster.health.set` adds a section to `:check` (this Box's health, shown on `:help health`), as Neovim's `vim.health` does. With `check`, a function, each `:check` calls it and shows the lines it returns, under the section's title and your Plugin's name:

```lua
roster.health.set("recent-alerts", {
  title = "Recent alerts",
  check = function()
    if not granted("terminal.read") then
      return { { level = "warn", message = "terminal.read isn't granted, so no alerts", fix = "allow it in :plugins" } }
    end
    return { { level = "ok", message = #alerts .. " alerts since the app started" } }
  end,
})
```

Each line is a [`HealthCheck`](plugin-api.md#healthcheck): `ok`, `warn` or `error`, a message and an optional fix, shown as `OK`, `WARNING` and `ERROR` like roster's own. The function runs like any call into your Plugin: with your permissions, a quarter of a second of Lua, and `roster serve`'s answers not counted against it, so check what you can see locally and keep it quick. One that raises, returns something that isn't a list of lines, or doesn't answer within three seconds is an `ERROR` line of its own section, and the rest of `:check` goes on. Without `check`, `checks = { … }` shows those lines as you last set them.

### Types in your editor

[`examples/plugins/types/roster.lua`](../examples/plugins/types/roster.lua) declares the whole API for [lua-language-server](https://luals.github.io/), generated with the reference, so your editor completes `roster.` and checks what you hand the app. `:plugins types PATH` writes the copy for this app into your Plugin's folder as `types/roster.lua`, so it matches the API the app has; [Editor support](plugin-api.md#editor-support) says how to point the editor there; the example Plugins are annotated that way, and CI checks them with it.

## Views, tables and Host-details sections

A **view** is a side panel beside the terminal (`place = "panel"`, over it in Focus or a narrow window) or a full view over the whole window (`place = "full"`, as Topology is). It holds a few lines of text, facts (label and value, as a Host's details show them) and a table, top to bottom. `roster.views.set` adds it; it opens with `:view ID`, a key you bind to `view ID`, the `views` finder (`:view` alone), or `roster.views.open` in one of your actions or commands, never on its own at load or on an event. `Esc` closes it and puts the user back where they were. One view is open at a time.

A **table**'s rows are plain data: an `id`, the `cells` by column, and optionally the `host` it's about and a `tone` (`"muted"`, `"warn"`, `"error"`). What a row can do belongs to the table: `open` for `Enter`, and `actions`, each with a one-letter `key` and a button on the selected row. A function there gets the row it ran on (`e.row`, `e.host`, `e.view`). The app sorts it (`s`, `S`, a heading's click), moves with `j`/`k`, `g g`/`G` and `Ctrl+D`/`Ctrl+U`, keeps the selection on its row, and draws only the rows on screen, so thousands stay smooth.

```lua
local found = {}
roster.views.set("discover", {
  title = "Discover",
  place = "panel",
  text = "Scanning 10.0.0.0/24",
  table = {
    columns = {
      { id = "address", label = "Address", kind = "data" },
      { id = "ports", label = "Ports", kind = "number" },
      { id = "title", label = "Title" },
    },
    sort = "address",
    empty = "Nothing found yet.",
    actions = {
      { label = "Keep", key = "a", icon = "add", run = function(e) found[e.row].keep = true end },
    },
  },
})
roster.commands.add("discover", { desc = "Scan a network", run = function() roster.views.open("discover") end })
roster.keymap.set("leader", "y d", "view discover")

-- As results come in: only the rows that changed.
local function arrived(host)
  found[host.address] = host
  roster.views.update("discover", {
    text = "Scanning 10.0.0.0/24: " .. host.percent .. "%",
    rows = { { id = host.address, cells = { address = host.address, ports = #host.ports, title = host.title } } },
  })
end
```

`roster.views.update` replaces a row whose `id` is there already where it stands, adds new ones at the end, takes away the ids in `remove`, and leaves the rest alone, so a scan doesn't send its whole table each time (a table holds up to 10,000 rows). It's plain data only: the table's functions stay those `roster.views.set` gave. Setting the view again replaces it all.

A **Host-details section** is the same text, facts and table in one Host's details (`:info HOST`), after roster's own, with your Plugin's name on it. Set it per Host, as a badge: `roster.details.set("mesh", "esx-02", { title = "Mesh", facts = { { label = "reach", value = "can reach 7 Hosts" } } })`; `nil` takes that Host's away, `roster.details.remove("mesh")` every Host's. A table action there gets the Host as `e.host`.

Nothing in a view moves: it opens from a key as often as a click, as every side panel does, and a row that changes is simply changed.

### Graphs

A view can hold a **graph** instead of a table: nodes, edges and clusters, as plain data, which the app lays out and draws as roster's own network map (Topology is the first). A **node** has an `id`, a `label`, a `shape` (`"dot"`, `"ring"`, `"dashed"`, `"hollow"`, `"square"`, as roster draws key, password, unreviewed, ended and this Box), a `state` (`"live"` in the accent, `"down"` crossed out), a `mark` (`"warn"`, `"error"`) and a short `note`, the `cluster` it's in, the `host` it is, a `kind` and a `detail` line. An **edge** goes `from` one node or cluster `to` another, one way (`dir = "one"`, an arrow) or `"both"`, with a `style` (`"solid"`, `"dashed"`, `"dotted"`), a `tone` (`"live"`, `"muted"`, `"warn"`, `"error"`) and `cut = true` to draw it broken. An edge to a **cluster** reaches every node in it, so one edge stands for a group's Links; a cluster with `mesh = true` has every node reaching every other without an edge per pair. As with a table, what a node does belongs to the graph: `open` for `Enter` and `actions` with a key each, and a function there gets the node (`e.node`, `e.host`, `e.view`).

```lua
roster.views.set("map", {
  title = "Map",
  place = "full",
  graph = {
    clusters = { { id = "lab", title = "lab", mesh = true }, { id = "web", title = "web" } },
    nodes = {
      { id = "box", label = "devbox", shape = "square" },
      { id = "esx-02", cluster = "lab", host = "esx-02", detail = "10.0.0.5", state = "live" },
      { id = "nas-01", cluster = "lab", host = "nas-01", shape = "ring", mark = "warn", note = "out of date" },
      { id = "web-1", cluster = "web", host = "web-1", state = "down" },
    },
    edges = {
      { from = "box", to = "lab" },
      { from = "box", to = "web" },
      { from = "lab", to = "web", dir = "both" },
      { from = "nas-01", to = "web-1", style = "dashed", cut = true },
    },
    open = function(e) roster.notify("would open " .. e.host) end,
    actions = {
      { label = "Check", key = "c", run = function(e) check(e.host) end },
    },
  },
})

-- A Session connects: the node turns live, and its edge from this Box draws in.
roster.views.update("map", {
  nodes = { { id = "web-1", cluster = "web", host = "web-1", state = "live" } },
  edges = { { id = "live:web-1", from = "box", to = "web-1", tone = "live" } },
})
```

The user moves with `h` `j` `k` `l` (or the arrows) to the nearest node that way, searches with `/` (for every word typed, as a table's filter; `n`/`N` go through the matches), collapses a cluster to its count with `o` (`O` for all), zooms with `+` `-` and `0`, and pans with `H` `J` `K` `L` or a drag. Selecting a node lights up what it can reach and what can reach it, however many hops away, and says how many. `t` turns the graph into a table of every node, then of every edge, so nothing is only in the drawing. Each node keeps its place between openings (the app saves positions and collapsed clusters in its State); a new node takes a free place in its cluster without moving the others, and the user can drag one somewhere else. Above 300 nodes, clusters start collapsed unless one says otherwise (`collapsed = false`). A graph holds up to 5,000 nodes, 10,000 edges and 500 clusters. `roster.views.update` adds or replaces `nodes`, `edges` and `clusters` by `id`, and takes away nodes and clusters in `remove` (a node's edges go with it) and edges in `remove_edges`. The only motion is an edge that turns live drawing in from its start, as a Session's does on connect, and not under reduced motion.

## Asking, progress, the toolbar and going places

What the first-party Plugins need around their views: Mesh controls asks before a Cut, Discover shows a long scan and lets you stop it, recent-alerts goes to the line that alerted. All of it is drawn by the app; the Plugin hands over data and functions.

```lua
-- A control in the toolbar, by the window's buttons.
roster.toolbar.set("scan", { label = "Scan a network", text = "Scan", icon = "map", run = "discover" })

-- Ask first. The app draws the question with your Plugin's name on it; only the user answers.
local function cut(e)
  roster.confirm({
    title = "Cut " .. e.host .. " from the Mesh?",
    text = "Its key is taken off every Host it can reach.",
    action = "Cut",
    danger = true,        -- the stronger form: the keys start on Cancel
    typed = e.host,       -- and the user types the Host's name first
    run = function() roster.serve.call("mesh.cut", { host = e.host }) end,
  })
end

-- Something long: how far it has got, and a way to stop it.
roster.progress.set("scan", { title = "Scanning 10.0.0.0/24", done = 40, total = 256,
  cancel = function() roster.serve.call("discover.stop") end })
roster.progress.remove("scan")   -- when it's over

-- A section's own buttons, a float's buttons and links.
roster.sidebar.set("alerts", { title = "Alerts", rows = rows,
  actions = { { label = "Dismiss all", icon = "close", run = clear } } })
roster.float.open({ title = "esx-02", lines = { a.text },
  actions = { { label = "Go to the line", key = "g", run = function() roster.sessions.show(a.session, a.text) end } },
  links = { { label = "Runbook", url = "https://wiki.example.com/disk-full" } } })

-- Run a command line: your own finder, say.
roster.commands.add("alerts", { run = function() roster.cmd("finder alerts") end })
```

- **A question** (`roster.confirm`) is a panel like the app's own Remove Host question, with "Asked by" your Plugin under it. `run` is called only when the user confirms; `cancel`, if you give one, when they press `Esc` or Cancel. Nothing a Plugin does can answer it, and no other piece of a Plugin can look like it (a float or a view is always marked as the Plugin's). The plain form confirms with `Enter`; the stronger one (`danger`) starts on Cancel, so a stray `Enter` only declines, and with `typed` its button works only once that word is typed. Asking again replaces the question.
- **Progress** (`roster.progress`) shows in the status bar: the title, a hairline that fills as `done` reaches `total` (or an edge that travels along it when you only know it's going), the share, and a stop button when there's a `cancel`. `:cancel ID` (or `:cancel` alone, for the latest) does what the button does: the app calls `cancel` once and shows "stopping…" until you set or remove the progress. You may set it any time, from an event too. The status bar is hidden in Focus; `:cancel` still works there.
- **A toolbar control** (`roster.toolbar`) sits after roster's own controls. If `init.lua` picks the toolbar's controls (`modes.<mode>.toolbar`), list your control's id there to show it.
- **A section's buttons** go on its heading and show while the heading is selected, as the Inventory's do; at most four.
- **A float's buttons** are at its foot, each with a key while it has focus (`q` closes it, like `Esc`); **its links** open in the browser and show the address's host beside the label. Only `https://` and `http://` addresses.
- **`roster.cmd(line)`** runs a command line as if the user typed it.
- **`roster.sessions.show(session, line)`** goes to the Session with that id (the one events carry, so two Sessions to one Host are told apart) and, with `line`, opens the terminal's search on that text from the bottom, highlighted, so `Enter` goes on up and `Esc` closes it. A Session that has ended is said in a notice.

`roster.confirm`, `roster.cmd` and `roster.sessions.show`, like `roster.clipboard.copy` and `roster.views.open`, work **only in a call the user started**: an action, a command, a finder item, a toolbar control or a question's answer. At load, in an event listener or a timer they're errors, so a Plugin never asks, runs or moves you anywhere on its own. `roster.cmd` reaches only your own commands and [the commands of roster's that only show something](plugin-api.md#command-lines-a-plugin-may-run), each with the permission it needs: never `:plugins`, `:packages`, `:publish`, `:source`, the editor or the vault, nor another Plugin's commands, which would run with that Plugin's permissions.

A table's rows can be filtered: `/` in any table opens a filter that keeps the rows saying every word typed (`Enter` keeps it and goes back to the rows, `Esc` clears it). An action with `when = { state = "up" }` shows and runs only on the rows whose cells match, so Cut is there only on a Host that's up; a cell needn't be a column. And `roster.views.update` can change the table's `columns`, `sort` and `actions` as well as its rows: new actions' functions replace the old ones', and `open` stays as `roster.views.set` gave it.

## Limits

Your Plugin runs in its own Lua state, on its own thread, with the sandbox's libraries and `coroutine` (no `io`, no `os.execute`, `require` from its own folder only) and:

- **32 MB** of memory;
- **1 second** to run `init.lua`, and **a quarter of a second** for each call (a command, an action, an event, a `:check` section, an HTTP request's answer). Time spent waiting for roster serve doesn't count; an HTTP request doesn't wait at all; a coroutine's time is the call's. Running out can't be caught with `pcall` or `coroutine.resume`;
- at most 1,000 UI changes in one call, and 2,000 rows in a section, items in a finder, lines in a float or rows in one `set` or `update` of a table (10,000 in a table after updates). Text is cut to 500 characters (a help page to 200,000);
- at most 100 timers waiting at once; a deferred function waits at least 50 ms, and a repeating one at least a second between runs, counted from when the last run ended. A timer's run has a call's budget, and an error in it counts like any other.

An error shows a notice naming your Plugin with the file and line: `pinned: init.lua:12: attempt to index a nil value`. An error while loading stops the Plugin; so does a third error after that, and so does a call that doesn't answer within two seconds of its budget (a long pattern match, say). When it stops, everything it added goes away and the rest of the app carries on. `:plugins` says why, and `:plugins reload NAME` tries again.

## For roster's developers: how it's built

The Lua runs in roster-core (`crates/roster-core/src/plugin/`), never in the frontend, and it reaches roster only through `roster serve`'s methods its permissions name. Each call into a Plugin answers with the result and a list of **ops**: plain data such as `{ "op": "section", "id": "pinned", "spec": { … } }`, with each Lua function replaced by `{ "handler": N }`. The frontend (`app/src/plugins/`) checks every op (`ops.ts`), puts it into the registries with the Plugin's name as its source, and runs a handler with `:plugins call NAME N CONTEXT` (what ran it, as URI-encoded JSON, to which the manager adds the Session on screen when the Plugin may know it). A table's functions are called with the row instead (`{ row, host, view | section }`), and its rows carry no functions, so `roster.views.update` can change some of them without touching the rest; views and Host-details sections are the `views` and `details` registries (`app/src/view/views.ts`), drawn by `ViewContent.tsx` and `ui/DataTable.tsx` over the pure table model in `ui/table.ts`. A graph's functions are called with the node (`{ node, host, view }`, plus the Session on screen as any handler's context), and its nodes and edges are plain data too: `plugins/graphOps.ts` checks them, and `app/src/graph/` lays them out, keeps their places in the State and draws them on a canvas (ticket 77). A question, progress and toolbar control are the ops `confirm`, `progress` and `toolbar` (ticket 78); the question and progress live in the manager's snapshot, drawn by `PluginsPanel.tsx`, and the controls go into the toolbar registry. `roster.cmd` is the op `cmd`; a command line a Plugin hands over runs as `:plugins run NAME LINE`, and both pass `plugins/cmd.ts`, the app's side of the core's rule (`COMMANDS` in api.rs, in `plugin-api.json`). The one exception to "each call answers": an HTTP request's answer (`network`, `plugin/network.rs`) runs the Plugin's function on its own thread later, and the Tauri side sends what it did to the frontend as the `plugin-reply` event, applied like a call's reply. Packages (ticket 24) are `crates/roster-core/src/package/`: git as a subprocess (`git.rs`), the clones in the app's data folder and `roster.lock`; the frontend loads one as the Plugin `package:NAME`, which the Tauri side turns into its clone and its settings from `init.lua` (`PluginHost::load_with`). A timer is an op too (`{ "op": "timer", "id", "ms", "every", "run" }`): the frontend keeps the clock and calls the handler back, and the core, which knows the handler is a timer, runs it as one (never as a call the user started). `terminal_output` comes from `committed.ts`, a terminal (xterm's, never opened) per Session. `?fixture=recent-alerts` in a plain browser starts the app with recent-alerts installed and alerts in two Sessions, for looking at Plugin UI headless. Packages (ticket 24) are `crates/roster-core/src/package/`: git as a subprocess (`git.rs`), the clones in the app's data folder and `roster.lock`; the frontend loads one as the Plugin `package:NAME`, which the Tauri side turns into its clone and its settings from `init.lua` (`PluginHost::load_with`).

The API is declared once, in `crates/roster-core/src/plugin/api.rs` (decision Q89): each function, value, type and event with its parameters, returns, errors, permission and `Since`. `cargo run -p roster-core --example gen_plugin_api` writes [the reference](plugin-api.md), the stubs (`examples/plugins/types/roster.lua`) and the same as data (`crates/roster-core/tests/fixtures/plugin-api.json`, which the help's topics read). A change to the API isn't done until api.rs says it: `crates/roster-core/tests/plugin_api.rs` fails when the runtime has a function or value api.rs lacks (or the other way round) for any grants, or a generated file is stale; `app/src/plugins/api.test.ts` fails when `ops.ts` reads a field a type doesn't list; `tests/test_plugin_api.py` when a Host, group or service from roster serve has a field the Host type doesn't.

## See also

[The Plugin API](plugin-api.md) · [How far roster bends](app/extending.md) · [Your init.lua](app/config.md) · [Where secrets go](app/security.md) · [Plugins and Packages, as decided](adr/0006-lua-plugins-and-packages.md)
