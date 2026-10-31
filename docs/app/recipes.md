# Recipes

Short `init.lua` snippets for things people often want. Each one works when pasted into the table your `init.lua` returns (or, for `roster.*` calls, above its `return`), then `:source`. They're one way to do it, not the only one: [Options](options) lists everything, and `:help` on any option says more. Anything a snippet leaves out keeps its default.

## Use Ctrl+b as the Leader

```lua
leader = "Ctrl+b",
```

tmux's prefix. The Leader is the one chord the terminal never sees, so pick one your shell doesn't need: Ctrl+b moves the cursor back a character in bash. See [leader](leader) and [Keyboard](keyboard.md).

## Bind a key to a Host you open all day

```lua
keys = { leader = { p = "connect esx-02" } },
```

`␣ p` now opens `esx-02`. An action is any command line, exactly what you'd type after `:`, so `"finder sessions"`, `"theme nord"` or `"mode focus"` work the same way. `false` unbinds a default: `["d d"] = false`.

## Paste with Ctrl+V

```lua
keys = { terminal = { ["Ctrl+v"] = "terminal.paste" } },
```

Ctrl+V belongs to the shell by default (its quoted insert, and Vim's block selection). See [Copy and paste](keyboard.md#copy-and-paste).

## A light Theme by day, a dark one at night

```lua
theme = "auto",
dark_theme = "tokyo-night",
light_theme = "roster-light",
```

`"auto"` follows the OS's light or dark setting. `:theme` previews every Theme live and keeps the one you choose; `:help themes` lists them.

## Your own Theme, from a bundled one

```lua
roster.themes.define("ember", {
  label = "Ember",
  base = "roster-dark",
  colors = { accent = "#e0803a" },
})
```

Then `theme = "ember"` in the returned table, or `:theme ember`. A Theme changes only the tokens it names; the rest come from `base`. [Themes](themes.md) lists every token.

## A bigger terminal font

```lua
terminal = { size = "15pt", font = { "Cascadia Mono", "Iosevka" } },
```

The first font that's installed is used, and the bundled Iosevka is always there. `Ctrl+=` and `Ctrl+-` zoom one Session; `Ctrl+0` comes back to `size`.

## The Sidebar on the right, with only Sessions and the Inventory

```lua
modes = { standard = { sidebar = { side = "right", sections = { "sessions", "inventory" } } } },
```

`sections` picks and orders them. `␣ e` still shows or hides the Sidebar.

## A quieter status bar and toolbar

```lua
modes = {
  standard = {
    statusbar = { "box", "hosts", "changes" },
    toolbar = { "find", "add", "help" },
  },
},
```

Each is a list of pieces in order, `false` for none, or `true` for the default set. The pieces are in [Your init.lua](config.md#layout).

## Start in Focus, with a session bar

```lua
default_mode = "focus",
modes = { focus = { sessionbar = "top" } },
```

Focus is fullscreen with only the terminal; F11 or `␣ m` switches. The session bar is a thin tmux-style line of open Sessions.

## Hide the keycap hints

```lua
ui = { hints = false },
```

Every binding still works, and `␣ K` and `:help` still show the keys. Leave it unset to let `:hints` decide.

## Reload when you save

```lua
auto_reload = true,
```

Otherwise saving does nothing until `:source` (`␣ S`), as in Neovim, so a half-written file never takes effect.

## Keep your Hosts in a Folder of your own

```lua
folders = { { name = "Lab", hosts = { "esx-02", "esx-03" } } },
```

Folders in `init.lua` are read-only in the app. Folders you make in the app (`␣ a`) are kept in `folders.yml` instead.

## Split init.lua into modules

```lua
-- lua/keys.lua
return { leader = { p = "connect esx-02" } }
```

```lua
-- init.lua
return { keys = require("keys") }
```

`require` loads only files from the config folder. A symlinked `init.lua` or `lua/` folder works, so the Config can live in your dotfiles repo.

## Something different on Windows

```lua
local on_windows = roster.os == "windows"
return {
  terminal = { font = on_windows and "Cascadia Mono" or "Iosevka" },
}
```

It's plain Lua: anything that returns the same table works.

## See also

[Your init.lua](config.md) · [Options](options) · [How far roster bends](extending.md) · [Keyboard](keyboard.md)
