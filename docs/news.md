# What's new

What changed in each Release of roster, the CLI and the app together, newest first: what's new, what changed, what's gone and what's on its way out. The app says once, on its first start after an upgrade, "roster 0.2.0: what's new: `:help news`". [Deprecated names](deprecated.md) lists every old name that still works, and what replaces it.

Each Release has the same sections, left out when empty: **Breaking** (something you have to change), **New**, **Changed**, **Removed** and **Deprecated**. Inside a section the bullets are grouped by area: the CLI, the app, and the `roster serve` API with the API version that brought the change.

## Unreleased

### Breaking

**App**

- Plugin API 3 (`roster.api_version` 3): `roster.inventory.host(name)` gives `nil` for a name that isn't a Host, where it raised an error (code 2), so a Plugin that wrapped it in `pcall` checks for `nil` now. A `cmd:` or `env:` Login reference reaches a Plugin cut to its kind (`cmd:`, `env:`): it says how a secret is fetched, and a Plugin never needs it. See [`roster.inventory.host()`](plugin-api.md#rosterinventoryhostname) and [`LoginRef`](plugin-api.md#loginref).

### New

**App**

- Plugins can add a section to `:check` that runs each time, like Neovim's `vim.health`: `roster.health.set(id, { check = function() … end })`. Its OK, WARNING and ERROR lines show under the Plugin's name on [Health](health); one that fails or doesn't answer in time is an ERROR line of its own. See [Health sections](plugins.md#health-sections).
- `:check %` checks the Host of the Session on screen, as Vim's `%` is the current file. See [Health](health).
- Plugin API 3: `roster.inventory.groups()`, `roster.keymap.del`, `roster.themes.remove` and `coroutine`. A row's, a button's, a finder item's or a status segment's function is told which one ran it and, with `inventory.read` or `terminal.read`, the Session on screen ([`HandlerContext`](plugin-api.md#handlercontext)).
- `:plugins types PATH` writes the Plugin API's types for this app (`types/roster.lua`) into a Plugin's folder, for lua-language-server. See [Types in your editor](plugins.md#types-in-your-editor).
- Plugins get timers: `roster.defer(ms, fn)` runs a function once, later, and `roster.every(ms, fn)` again and again until `roster.cancel(timer)`, on the Plugin's own thread; they end with the Plugin. recent-alerts uses one so its rows say "4 min ago" and stay true. See [Timers](plugin-api.md#rosterdeferms-fn).
- `roster.has(permission)` tells a Plugin whether it was granted a permission, before it listens for an event that needs one. A finder's `items` can be a function, run each time the finder opens.
- `?fixture=recent-alerts` in a plain browser (`npm run dev`) shows the example Plugin running with alerts, for checking Plugin UI headless.
- Plugin graphs: a Plugin's view can hold a graph of nodes, edges and clusters, drawn as roster's network map (Topology will be the first). Move between nodes with `h` `j` `k` `l`, search with `/`, collapse a cluster to its count with `o`, zoom and pan; selecting a node lights up what it can reach and what can reach it, with the counts. Each node keeps its place between openings, 2,000 nodes stay smooth, and `t` lists every node and edge as a table.
- Plugin views and tables: a Plugin can add a side panel or a full view (`roster.views`), opened with `:view ID`, a key it binds, the `views` finder or its own command, with Esc taking you back. Its table sorts, moves with vim keys, runs actions on the selected row with a key or a button, takes rows changed in place as a scan finds them, and stays smooth at thousands of rows. A Plugin can also add a section to a Host's details (`roster.details`). See [Views, tables and Host-details sections](plugins.md#views-tables-and-host-details-sections).
- Packages from a folder of a repo: `dir = "plugins/NAME"` in a Package's line in `init.lua` loads the Plugin from that folder, so one repo can hold several Plugins. The install and update prompts show the folder, `roster.lock` keeps it, and `:packages update` shows only what changed in it. A folder outside the repo (`..`, a full path, a symlink that leads out) is refused. roster's own optional Plugins will live this way, in its repo's `plugins/` folder, none bundled in the app. See [Packages](plugins.md#packages) and [First-party Plugins](plugins.md#first-party-plugins).
- Each Plugin has a data folder of its own: `roster.storage.read`, `write`, `list`, `remove`, `read_json` and `write_json` keep files there by name, with no permission to ask for. It's never the config folder or on the network, a write is all or nothing, a link there is never followed, and it holds up to 10 MB; `:plugins remove` and `:packages clean` remove it. See [A Plugin's own files](plugins.md#a-plugins-own-files).
- Plugin API 3 also gets what Folders needed, for any Plugin: `roster.echo` (the message line), `roster.cmdline` (the command line with one of its commands typed in), a command's `complete`, the Host and row under the Sidebar's cursor in a command, Sidebar rows that fold, draw as the Inventory's Hosts and take drag and drop, and a finder over a Plugin's own section.
- Plugins can talk to web services: `network:api.example.com` in a manifest grants `roster.http.request` and `roster.http.get` for that site only (`*.example.com` for the names under a domain, `http://` and `:PORT` when written). The requests run in roster's core, don't block the Plugin, follow redirects only to its sites, and never reach this computer or a private network by name. The install prompt and `:packages update` show every site, flagged, and an update that adds one asks again. See [The network](plugins.md#the-network).

- The Mesh controls, the first first-party Plugin (`plugins/mesh`): `:mesh` shows every Host in the Mesh with what it **can reach**, "Mesh out of date" in the status bar after a Publish, `:mesh plan` and an apply you confirm after looking at the plan, a Cut you confirm by typing the Host's name with a warning per Host that was down, Links through a jump Host and why a `no-via` one is left out, and a Mesh section in each Host's details. Install it with `{ "https://github.com/2styx2/roster", dir = "plugins/mesh" }` in `init.lua`'s `packages`. See [the Mesh controls](../plugins/mesh/README.md) and [The Mesh in the app](mesh.md#in-the-app).
- Plugins can ask, show progress and act for you: `roster.confirm` asks a question the app draws (a stronger form, starting on Cancel and asking you to type a Host's name, for a Mesh Cut), `roster.progress` shows something long in the status bar with a stop button and `:cancel`, `roster.toolbar` adds a toolbar control, a Sidebar section can have buttons on its heading ("Dismiss all"), a floating window can have buttons and links, `roster.cmd(line)` runs a command line, and `roster.sessions.show(session, line)` goes to a Session by its id and finds the line in it. A table filters with `/`, an action can apply only to some rows, and `roster.views.update` can change its columns, sort and actions. See [Asking, progress, the toolbar and going places](plugins.md#asking-progress-the-toolbar-and-going-places).

- **Discover from the app**, as a first-party Plugin: `{ "https://github.com/2styx2/roster", dir = "plugins/discover" }` in `init.lua`'s `packages`. `:discover 10.0.0.0/24` (or the toolbar's **Scan**) asks first, then scans from the Box through `roster serve`, with its progress in the status bar and a stop button; what answers fills a table as it's found, with the name each would get, what it looks like and its open ports. Keep the ones you want (`m`) and add them (`A`): they go in a new group, unreviewed, as Pending changes. A Plugin can start a scan or an add only from something you did. `:check` says whether the Box's roster can scan. See [discover](../plugins/discover/README.md).

**CLI**

- `roster serve` scans a network for the app (API 18): `discover.plan`, `discover.start`, `discover.status`, `discover.stop` and `discover.add`, codes 120-123. The scan runs in the background, a batch at a time, and can be stopped. See [Discover](serve-api.md#discover-discoverplan-discoverstart-discoverstatus-discoverstop-discoveradd).
- Mesh Links through a jump Host: `via: HOST` on a `links:` entry sends it through that Host with `ProxyJump`, and the peer's `from=` names the address it actually sees. `roster mesh --dry-run` shows the hop, and the reachability test runs through it. See [Through a jump Host](mesh.md#through-a-jump-host).
- `mesh_dir:` on a Host, group or `defaults` says where a Mesh source keeps its files, for an ESXi Host with no datastore roster would pick; roster checks it on the Host first. See [`mesh_dir:`](mesh.md#esxi).

**serve API (API 17)**

- Mesh jobs: `background: true` on `mesh.plan`, `mesh.apply` and `mesh.cut` answers at once and runs the Mesh in the background; `mesh.job` says how far it has got and how it ended, and `mesh.stop` stops it before its next Host. `brief: true` on `mesh.status` and `mesh.job` keeps the answer small when a meshed group of hundreds of Hosts makes every pair a Link, and marks a `no-via` Link without connecting. Error code 111: a Mesh run while a job runs. See [The Mesh](serve-api.md#the-mesh-meshplan-meshapply-meshcut-meshstatus).

### Changed

**App**

- A Plugin's error about data that can't be handed over names the function and where in the table (`roster.sidebar.set: rows.3.label: a thread can't be a Plugin value`), and every `remove` checks its id as `set` does. `session_exit` names the Host of a tab closed while its Session ran.
- A command line a Plugin hands over (a row's, a button's, a finder item's, a status segment's) runs only if it's one of that Plugin's own commands or one of [the few of roster's a Plugin may run](plugin-api.md#command-lines-a-plugin-may-run): a button can no longer run `:plugins grant …` whatever its label says. `roster.sessions` is there for every Plugin now (for `show`); `roster.sessions.open` still needs `sessions.open`.

- `terminal_output` sends the lines a Session's terminal commits, read from a terminal of its own, instead of the raw output with a one-second repaint filter: a progress bar arrives as it ended, a wrapped line comes whole, the screen ConPTY prints again after a resize is never output, and what full-screen programs (`vim`, `top`) draw isn't sent. See [Events](plugin-api.md#events).
- In a Plugin, `pairs` visits keys in order (numbers, then text), so the same state makes the same changes on every machine. An empty table reaches the app as `{}`, which it takes as an empty list.
- A Plugin's Leader key that's taken is refused with a notice naming what has it and a few free keys like it (`␣ f is taken (by builtin: find). Free after the Leader: a, g, h`).
- Folders is a built-in Plugin on the public API now, like the Host count: `:plugins` lists `folders`. It works as before (`␣ a`, `␣ A`, `:folder`, drag and drop, init.lua's Folders), and keeps your Folders in its own data folder instead of `folders.yml`. At the first start, `folders.yml`'s Folders move in, every Host included; one that doesn't parse moves nothing until it's fixed. After that the app doesn't read or write `folders.yml`: `:check` says so, and you can delete it. A Folder that was folded opens once (its id is `folders:NAME` now). See [`folders.yml`](app/config.md#foldersyml).
- A Plugin whose manifest, `init.lua` or a module is a symlink (or a junction) leading outside its folder doesn't load, for a local Plugin and a Package alike. See [A Plugin's files](app/errors.md#a-plugins-files).
- `init.lua`'s `modes` no longer warn "no section named …" or "no segment named …" for a Plugin's section or status segment: the names are checked once the Plugins have loaded.

**CLI**

- The Mesh gives a new `authorized_keys` it makes on ESXi (a user other than root) the sticky bit, so ESXi keeps it across a reboot.
- Publish's generated commit message names the `links:` that changed (`roster: add link orion-2 -> storage`), as it does Hosts and groups, rather than "roster: edit roster.yml".

### Deprecated

**App**

- `folders.yml`: Folders made in the app are kept by the Folders Plugin now. It's read once, to move its Folders in, and then no longer; hand-written Folders go in `init.lua`. See [Deprecated names](deprecated.md).
- `roster.keymap.set(context, keys, false)`: use `roster.keymap.del(context, keys)`. It takes the Plugin's own binding off now, rather than claiming the keys with no action. See [Deprecated names](deprecated.md).

## v0.2.0

### New

**App**

- `:tutor`, like Neovim's `:Tutor`: four short lessons you do rather than read, on a demo Inventory of made-up Hosts under a "Demo Inventory" banner, so nothing you try reaches your network. Each step ticks itself when you do it, and `:tutor` comes back where you left off; your own Sessions keep running behind it. Plugins can ship tutorials too (`roster.tutor.set`). See [the tutor](app/help.md#the-tutor).
- Host details: `␣ i`, `:info HOST`, the ⓘ on a Host's row and `Ctrl+i` in the Picker show what `roster info HOST` shows (address, services, the Vault item each Login uses by name) in a side panel, and `:open SERVICE` opens a web service in your browser. See [`:info`](:info) and [`:details`](:details).
- Sign out of the vault to use another account: `:vault signout`, or "Use a different account" on the lock screen. It asks first, naming the account. See [Signing out](app/errors.md#signing-out).
- Help, redone the way Neovim's is: an index grouped as Getting started, Make it yours, Reference, Extending and What's new; [Getting started](app/start.md); `:helpgrep TEXT` searches every page; `g O` is a page's outline; `Ctrl+]` follows a link; the generated [Quick reference](quickref) and [Every topic](all) pages, [Recipes](app/recipes.md), [How far roster bends](app/extending.md), and the CLI's docs in help too ([The roster command](cli-reference.md)).
- Help from where you are: in the command line, `Ctrl+]` or `F1` opens help on the command you're typing, and Esc in help brings the line back as you left it. In App mode, `␣ F1` opens help on what's selected (a Host's row: `:connect`), and `F1` does the same in the Picker, every finder and the Key bindings panel. See [Help from where you are](app/help.md#help-from-where-you-are).
- Health: `:check` with no Host checks this Box (roster, `roster.yml`, ssh, the vault, askpass, the infra repo) without connecting anywhere, and shows the result as the [Health](health) page, each check with its fix and help topic. `:help health` shows the last one.
- The docs on the web and on paper: every `:help` page is a website, [2styx2.github.io/roster/](https://2styx2.github.io/roster/), with a stable address for every topic (`tag.html?t=terminal.size`), and one PDF on each Release. Both are made from the same pages as help in the app. See [On the web and on paper](app/help.md#on-the-web-and-on-paper).
- What's new: this page, `:help news`, and the status line says once after an upgrade that it's there. Old names that still work are on [Deprecated names](deprecated.md), and `:help` on an old name lands on its row.
- roster on Windows without WSL: `backend = "local"` in `init.lua` runs the roster installed on Windows itself, with Windows' own OpenSSH, and `"auto"` takes it when it finds your Inventory there. Changing `backend` and `:source` starts roster again on the new one, both ways. See [`backend`](backend).
- Plugins: Lua that adds commands, keys, Themes, Sidebar sections, finders, status segments, badges, floating windows and help pages, drawn in roster's own style. `:plugins install PATH` asks first, naming every permission it wants and why a risky one is risky; `:plugins` lists them with their permissions as switches, and turning one off takes it away at once. A Plugin never sees a password or the vault, and can't Publish. See [Writing a Plugin](plugins.md).
- Packages: name Plugins from git repos in `init.lua` (`packages = { { "owner/repo", tag = "v1.0.0" } }`), the way lazy.nvim does it. The app fetches them into its own data folder, asks before running one, and pins each commit in `roster.lock` next to `init.lua`, so your dotfiles get the same versions everywhere, offline included. `:packages update` shows each new commit and its diff, and asks again for any new permission, before applying it; `:packages clean` removes what `init.lua` no longer names. See [Packages](plugins.md#packages).
- recent-alerts, an example Plugin to copy: it lists the lines your Sessions print with `ERROR`, `panic` or `disk full` in the Sidebar, with the Host and time, a badge on the Host, a `⚠` count, a finder and `:alerts`. It asks only for `terminal.read`. Plugins can now copy text with `roster.clipboard.copy`, only when you choose one of their actions. See [A first Plugin](plugins.md#a-first-plugin).
- The Plugin API reference: every `roster.*` function with its parameters, returns, errors, permission and an example, and every type (a Host, a Sidebar row, an event) with all its fields, generated from the app itself so it can't go stale. `:help roster.inventory.host()` or `:help roster-Host` opens one entry. Its types also come as `roster.lua` for lua-language-server, so your editor completes `roster.` and checks your Plugin. See [The Plugin API](plugin-api.md).

**CLI**

- The Mesh: `mesh:` on a group or Host and top-level `links:` in `roster.yml` say which Hosts reach which, and `roster mesh` sets it up from this Box, one Host at a time (a key made on each source, tagged entries on its peers; `--dry-run` shows the plan). `roster mesh status` shows who reaches whom without connecting, and `roster mesh cut HOST` takes a Host out everywhere at once. `roster check` reports the Mesh's drift. See [The Mesh](mesh.md).
- `roster check --box`: this Box's health, like Neovim's `:checkhealth`, each check `ok`, `warn` or `error` with its fix. Local only: it never connects to a Host. See [`roster check --box`](cli-reference.md#roster-check---box).
- roster runs on Windows itself: `uv tool install .` there, and it uses Windows' built-in OpenSSH, keeps its files in `%APPDATA%\roster`, and gives password Sessions their password over a named pipe only you can open. See [On Windows](cli-reference.md#on-windows).
- A man page: `man roster` after `roster man --install`, generated from the parser and [The roster command](cli-reference.md#commands). The Release's files carry it too.

**serve API (API 14 to 16)**

- API 14: `vault.logout` signs the vault CLI out, after forgetting every secret roster holds.
- API 15: the Mesh's `mesh.plan`, `mesh.apply`, `mesh.cut` and `mesh.status`, and error code 110. See [The Mesh](serve-api.md#the-mesh-meshplan-meshapply-meshcut-meshstatus).
- API 16: `box.check`, this Box's health. See [This Box's health](serve-api.md#this-boxs-health-boxcheck).

### Changed

**App**

- The finders say how many results a query left, and "No matches", to a screen reader once you stop typing; help's search count is announced as it changes; the outline's section sits at the right, as in `:helpgrep`.
- Linux: when WebGL can't start or loses its context, the terminal draws with the DOM renderer instead, and `:info` names the renderer in use and how fast the Picker opened. The Enter that finishes an input-method word (IBus, Fcitx) no longer also opens a Host. See [Linux and WSLg](app/dev/linux.md).
- A Sidebar row's buttons (ⓘ, rename, remove…) show only on the row you clicked, or under the App-mode cursor, never on hover, so a row's address stays in view until you click it. In App mode the cursor starts on the row you clicked.
- `:edit`, `:host add` and Save to vault open at once instead of waiting on "Pulling the infra repo…". They pull in the background only when the last pull is older than [`pull_fresh_minutes`](pull_fresh_minutes) (5 by default), and Save waits for that pull. A pull that changed the Host you're editing updates the fields you hadn't touched and says so. A pull that fails blocks the save, not the form.
- Code in `:help`, on the docs website and in its PDF is coloured: Lua, shell, YAML, JSON and TOML, each from your Theme's new syntax colours (`syntax_keyword`, `syntax_string`, … in `colors` or a Theme of your own; a Theme that leaves them out gets its base's). A `:command` in a sentence reads as one, and a shell line like `roster sync --dry-run` is coloured as in a block. Headings, code and tables on the help pages were retuned for reading, and the PDF prints code in a palette that holds in greyscale. See [Code's colours](app/themes.md#codes-colours).

**CLI**

- `roster setup` and `roster revoke` rewrite a Host's `authorized_keys` as a new file moved into place, keeping its mode: a run cut short (a timeout, a dropped connection) leaves the old file whole, where before it could leave it empty and lock everyone out.

## v0.1.0

The first Release, after iteration 4: the CLI and the app, built and tested together.

### New

**CLI**

- One `roster.yml` for a team's Hosts, their Logins and Resources, with the secrets in a vault: Bitwarden, 1Password, `pass`, KeePassXC (local only), environment variables or a command. See [`roster.yml`](cli-reference.md#rosteryml) and [Password providers](cli-reference.md#password-providers).
- `roster setup`, `sync`, `check`, `hosts`, `info`, `run`, `web`, `discover` and the rest: [Commands](cli-reference.md#commands).
- `roster serve`, the JSON-RPC API the app talks to roster through, at API 13: [The roster serve API](serve-api.md).

**App**

- The Picker (`␣ f`) and Sessions, with key or password Logins; the Sidebar with Sessions, Folders and the Inventory; Focus mode (`F11`).
- The Live Inventory: add, edit, rename, move and remove Hosts and groups, then `:changes` and `:publish` to the infra repo. Quick Connect to a box that isn't in the Inventory, and Save to vault after a Session's own login.
- Your [`init.lua`](app/config.md): the Leader, every key, Themes, fonts, the layout of each view mode, this Box's vault settings; `:source` reloads it.
- The lock screen with the full vault sign-in, the idle lock, and a clean message and fix for every way a Session can fail ([Connection errors](app/errors.md)).
- `:help`, the docs inside the app, Neovim-style.

### Deprecated

**App**

- The development env vars `ROSTER_DESK_ROSTER` and `ROSTER_DESK_WSL_DISTRO`, from when the app was called roster-desk: use `ROSTER_APP_ROSTER` and `ROSTER_APP_WSL_DISTRO`. See [Deprecated names](deprecated.md).

## See also

[Deprecated names](deprecated.md) · [Getting started](app/start.md) · [Cutting a Release](releasing.md)
