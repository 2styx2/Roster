# Deprecated names

Old names that still work, and what replaces each one, newest Release first. Use the new name: an old one goes away in a later Release, and [What's new](news.md) says when, under **Removed**. `:help` on an old name lands on its row here, so a name in your fingers or an old script still finds its way.

An old name stays for at least one minor Release after the one that deprecates it: deprecated in 0.1, it works through 0.2 at least. When `init.lua` sets a deprecated option, roster still applies it under its new name and warns, naming the replacement and the row here.

## Deprecated in 0.3

### Plugin API

| Old | New | Notes |
|---|---|---|
| `roster.keymap.set(context, keys, false)` | `roster.keymap.del(context, keys)` | Since `roster.api_version` 3 it takes the Plugin's own binding off, as `del` does; in 2 it claimed the keys with no action |

## Deprecated in 0.1

### CLI

Nothing.

### App

| Old | New | Notes |
|---|---|---|
| `ROSTER_DESK_ROSTER` | `ROSTER_APP_ROSTER` | The command that runs roster, for development. Read only when the new one isn't set |
| `ROSTER_DESK_WSL_DISTRO` | `ROSTER_APP_WSL_DISTRO` | The one WSL distro to use. Read only when the new one isn't set |

### init.lua options

Nothing.

### serve API

Nothing.

### Keys

| Old | New | Notes |
|---|---|---|
| `␣ ?` (Key bindings) | `␣ K` | `␣ ?` finds a help topic now. `keys = { leader = { ["?"] = "keys" } }` in `init.lua` brings the old key back |

## See also

[What's new](news.md) · [Key bindings](keys) · [Options](options)
