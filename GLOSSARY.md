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
