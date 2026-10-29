# roster-desk

The desktop app's own language. Shared domain terms (**Inventory**, **Host**, **Box**, **Session**, **Login**, **Vault item**, **Quick Connect**, **Pending change**, **Publish**) are defined in roster's `GLOSSARY.md` and mean the same thing here.

## Language

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
