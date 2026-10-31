# Roster

Roster is the team's shared map of the network: which hosts exist, how to reach them, and which vault login opens each one. It has two faces: the `roster` CLI (`src/roster/`) and the roster app, the desktop app in `app/`. Both use the same words.

## Language

**Inventory**:
The team's one list of hosts and resources, kept in `roster.yml` in the infra repo.
_Avoid_: config, host list, map file

**Host**:
A machine or device recorded in the Inventory, saved with its address, type, services and logins.
_Avoid_: session (SecureCRT's word for this), server, node

**Box**:
A machine that runs roster and connects to Hosts from there, such as a laptop, a jump host or a Claude box.
_Avoid_: client, workstation

**Session**:
One live terminal connection from a Box to a Host. A Host can have several Sessions open at once.
_Avoid_: connection profile, saved session

**Host key**:
The key a Host's sshd proves itself with. roster keeps the ones it trusts in its known hosts (`~/.ssh/roster_known_hosts`), recorded by `roster setup`, a verified add or edit, or a Session's question "roster hasn't seen this Host's key before" (Q60). A key that differs from the recorded one is never accepted. A Quick Connect's key, confirmed when you connect, is trusted for that Session only and never recorded there (Q67).
_Avoid_: fingerprint (that's the key's SHA256 digest, what the user compares), server key

**Login**:
A pointer from a Host, or one of its services, to the vault item that opens it. A Login never contains the password itself.
_Avoid_: credential, account (an account is a kind of resource)

**Vault item**:
One entry in the team's password manager, named `<host> <what it opens>`.
_Avoid_: secret, entry, password

**Save to**:
Where "Save to vault" puts a new Vault item: the personal vault, an organization's collection (Bitwarden), or a group (KeePassXC). Set by `save_to` in `roster.yml` (the team's default) and `init.lua` (this Box's), and chosen per Host in the add form.
_Avoid_: destination, location, folder (a Folder is the app's grouping of Hosts)

**Quick Connect**:
Opening a Session to an address that isn't a Host in the Inventory yet: `user@address[:port]`, typed in the Picker or after `:connect`. If you choose to save it, it becomes a Host with its own Vault item.
_Avoid_: ad-hoc session, direct connect

**Pending change**:
An edit to the Inventory made on this Box that hasn't been Published yet.
_Avoid_: draft, unsaved edit

**Publish**:
Committing the Pending changes and pushing them to the infra repo, so every Box picks them up.
_Avoid_: save, sync (sync means rewriting a Box's ssh config from the Inventory)

**Mesh**:
Host-to-Host access that one Box sets up: Hosts in a meshed group, or joined by a Link, can log in to each other with their own keys. Nothing is installed on the Hosts.
_Avoid_: VPN, tailnet, fleet

**Link**:
A one-way (or `both`) permission in the Inventory for one Host or group to reach another across groups or networks.
_Avoid_: route, peering

## The app

The desktop app's own words, on top of the ones above (which mean the same thing in the app).

**Backend**:
The roster install the app drives on this machine: either Local (roster on the same OS as the app) or WSL: <distro>.
_Avoid_: server, engine

**Picker**:
The fuzzy-search overlay for finding a Host, or typing a Quick Connect address, and opening a Session.
_Avoid_: launcher, search box, palette

**Leader**:
The one key chord that takes control back from a terminal so the next keys go to the app.
_Avoid_: prefix, hotkey

**Terminal mode**:
The focus state where every key, except the Leader, goes to the Session's shell.
_Avoid_: insert mode

**App mode**:
The focus state where keys drive the app (the Picker, tabs, panels, the command line) using the keymap.
_Avoid_: normal mode, command mode

**Lock**:
The state where the vault is forgotten and every Session's content is hidden. The vault master password ends it.
_Avoid_: logout, sleep

**Sign out**:
Signing the vault CLI out of its account on this Box (`vault.logout`), so a different account can sign in. Everything the Lock forgets is forgotten first, and the CLI's local copy of the vault goes too. Only for a provider with accounts (Bitwarden).
_Avoid_: logout (for the Lock), switch user

**Config**:
The user's `init.lua`: code that sets fonts, colors, keys and options, layered over the built-in defaults.
_Avoid_: settings, preferences, profile

**State**:
What the app remembers on its own between runs, such as window size, open panels and recently used Hosts. It's never written in the Config.
_Avoid_: settings, cache

**Sidebar**:
The left pane listing open Sessions, the user's Folders and the Inventory tree. It's the default way to see and switch Sessions.
_Avoid_: tab strip, session manager, explorer

**Folder**:
A personal grouping of Hosts in the Sidebar (for example "Lab ESXi"), kept on this Box and never in the Inventory.
_Avoid_: group (that's the Inventory's own grouping, shared by the team), favorite, collection

**Theme**:
A named set of colour tokens. The Config can pick one, change any token, or define a new one.
_Avoid_: skin, colour scheme

**View mode**:
How much of the app shows around the terminal: **Standard** (Sidebar and title bar) or **Focus** (fullscreen, fuzzy finders, optional session bar).
_Avoid_: layout, zen mode, presentation mode

**Plugin**:
Lua code that extends the app through its registries (commands, keys, themes, Sidebar sections, finder sources, status segments, event hooks). It never sees secrets.
_Avoid_: extension, addon, mod

**Package**:
A Plugin fetched from a git repo, named in the Config and pinned to a commit in the lock file.
_Avoid_: bundle, module

**Provider**:
The password manager a Login's reference points into (Bitwarden, 1Password, `pass`, KeePassXC, …). roster asks it for one secret at a time and never keeps a vault of its own.
_Avoid_: vault (the provider's own store), backend (that's the roster install the app drives)
