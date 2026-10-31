# What's new

What changed in each Release of roster, the CLI and the app together, newest first: what's new, what changed, what's gone and what's on its way out. The app says once, on its first start after an upgrade, "roster 0.2.0: what's new: `:help news`". [Deprecated names](deprecated.md) lists every old name that still works, and what replaces it.

Each Release has the same sections, left out when empty: **Breaking** (something you have to change), **New**, **Changed**, **Removed** and **Deprecated**. Inside a section the bullets are grouped by area: the CLI, the app, and the `roster serve` API with the API version that brought the change.

## Unreleased

### New

**App**

- Host details: `␣ i`, `:info HOST`, the ⓘ on a Host's row and `Ctrl+i` in the Picker show what `roster info HOST` shows (address, services, the Vault item each Login uses by name) in a side panel, and `:open SERVICE` opens a web service in your browser. See [`:info`](:info) and [`:details`](:details).
- Sign out of the vault to use another account: `:vault signout`, or "Use a different account" on the lock screen. It asks first, naming the account. See [Signing out](app/errors.md#signing-out).
- Help, redone the way Neovim's is: an index grouped as Getting started, Make it yours, Reference, Extending and What's new; [Getting started](app/start.md); `:helpgrep TEXT` searches every page; `g O` is a page's outline; `Ctrl+]` follows a link; the generated [Quick reference](quickref) and [Every topic](all) pages, [Recipes](app/recipes.md), [How far roster bends](app/extending.md), and the CLI's docs in help too ([The roster command](cli-reference.md)).
- Help from where you are: in the command line, `Ctrl+]` or `F1` opens help on the command you're typing, and Esc in help brings the line back as you left it. In App mode, `␣ F1` opens help on what's selected (a Host's row: `:connect`), and `F1` does the same in the Picker, every finder and the Key bindings panel. See [Help from where you are](app/help.md#help-from-where-you-are).
- Health: `:check` with no Host checks this Box (roster, `roster.yml`, ssh, the vault, askpass, the infra repo) without connecting anywhere, and shows the result as the [Health](health) page, each check with its fix and help topic. `:help health` shows the last one.
- What's new: this page, `:help news`, and the status line says once after an upgrade that it's there. Old names that still work are on [Deprecated names](deprecated.md), and `:help` on an old name lands on its row.
- roster on Windows without WSL: `backend = "local"` in `init.lua` runs the roster installed on Windows itself, with Windows' own OpenSSH, and `"auto"` takes it when it finds your Inventory there. Changing `backend` and `:source` starts roster again on the new one, both ways. See [`backend`](backend).
- Plugins: Lua that adds commands, keys, Themes, Sidebar sections, finders, status segments, badges, floating windows and help pages, drawn in roster's own style. `:plugins install PATH` asks first, naming every permission it wants and why a risky one is risky; `:plugins` lists them with their permissions as switches, and turning one off takes it away at once. A Plugin never sees a password or the vault, and can't Publish. See [Writing a Plugin](plugins.md).
- Packages: name Plugins from git repos in `init.lua` (`packages = { { "owner/repo", tag = "v1.0.0" } }`), the way lazy.nvim does it. The app fetches them into its own data folder, asks before running one, and pins each commit in `roster.lock` next to `init.lua`, so your dotfiles get the same versions everywhere, offline included. `:packages update` shows each new commit and its diff, and asks again for any new permission, before applying it; `:packages clean` removes what `init.lua` no longer names. See [Packages](plugins.md#packages).

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
