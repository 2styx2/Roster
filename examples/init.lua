-- The roster app's Config: init.lua (ADR 0004, docs/app/config.md).
--
-- Copy this file to
--   Windows: %APPDATA%\roster\init.lua
--   Linux:   $XDG_CONFIG_HOME/roster/init.lua   (~/.config/roster/init.lua)
-- (A Config in the old roster-desk folder is copied there once, the first time the app starts.)
-- and change what you like. It's plain Lua 5.4: it returns a table, and anything you leave out
-- keeps its default. Every value below IS the default, unless a comment says otherwise, so
-- deleting a line changes nothing.
--
-- Saving the file applies it at once. A mistake (a Lua error, or a name or value the app doesn't
-- know) shows a message with the file and line, and the last good Config stays in use.
--
-- The Lua here runs in a sandbox: no io, no os.execute or os.getenv, no debug, no C modules, and
-- `require` loads only files from this folder (`require("keys")` reads keys.lua or lua/keys.lua).
-- It never sees a password: the app's core holds none (docs/app/security.md).

-- `roster` is the app's Lua table (also `require("roster")`):
--   roster.os                              "windows", "linux" or "macos"
--   roster.api_version                     1
--   roster.keymap.set(context, keys, action) a key binding, like `keys` below
--   roster.themes.define(id, theme)        a Theme, like `themes` below
local on_windows = roster.os == "windows"

-- A Theme of your own, here as a call (it could equally go in `themes` below). It starts from a
-- bundled Theme and changes only the tokens it names. Pick it with `theme = "roster-ember"`.
roster.themes.define("roster-ember", {
  label = "Roster ember",
  base = "roster-dark",
  colors = { accent = "#e0803a", accent_ink = "#f0a060" },
})

return {
  -- Themes -------------------------------------------------------------------------------------
  -- "auto" follows the OS light/dark setting with dark_theme and light_theme. Or name a Theme:
  -- the bundled ones are "roster-dark", "roster-light", "gruvbox" and "nord".
  theme = "auto",
  dark_theme = "roster-dark",
  light_theme = "roster-light",

  -- New Themes, by id. Each starts from `base` (default: roster-dark, or roster-light when
  -- appearance = "light") and changes only what it sets.
  themes = {
    ["paper"] = {
      label = "Paper",
      appearance = "light", -- "dark" or "light": which OS setting it suits under theme = "auto"
      base = "roster-light",
      colors = { accent = "#3a6ee0", bg = "#fbfaf7" }, -- any UI token, see `colors` below
      terminal = { background = "#fbfaf7", foreground = "#202020" }, -- see `terminal.colors` below
      -- The terminal's 16 colours: a table of them, false for the standard palette (decision Q37),
      -- or leave it out to keep the base's.
      ansi = false,
    },
  },

  -- Colour tokens set over whichever Theme is in use. Every token:
  --   accent, accent_text, accent_ink, tone, bg, chrome, sidebar, panel, raised, raised_line,
  --   hover, line, line_strong, text, muted, faint, warn, error, danger, danger_text, backdrop,
  --   shadow
  -- e.g. colors = { accent = "#e0803a" }
  colors = {},

  -- Fonts --------------------------------------------------------------------------------------
  -- A family name, or a whole CSS font stack (anything with a comma is used as it is).
  -- Inter and Iosevka ship with the app.
  fonts = {
    ui = "Inter",
    mono = "Iosevka", -- the wordmark and code-like text in the UI
    ui_size = 14, -- px, 11 to 20: the UI's text (Sidebar, Picker, panels); the scale and rows follow
  },

  -- The terminal ------------------------------------------------------------------------------
  terminal = {
    -- Font families, most wanted first: the first one installed is used, and the bundled
    -- Iosevka (no Nerd Font icons) is always there. A name, a CSS stack, or a list.
    -- e.g. font = on_windows and "Cascadia Mono" or "Iosevka" (logic is fine)
    font = { "Iosevka Nerd Font", "Iosevka Term", "Iosevka" },
    -- A number is px; "16pt" is points, as Windows Terminal counts them (16 pt = 21.33 px at any
    -- display scale). 6 to 72 px. Ctrl+= / Ctrl+- zoom, Ctrl+0 comes back here.
    size = "12pt",
    weight = 500, -- 100 to 900; the bundled Iosevka ships at 400, 500 (medium) and 700
    bold_weight = 700,
    line_height = 1.0, -- a multiple of the font's own line height, 0.5 to 3
    -- cell_height = 1.2, -- or a multiple of the font size, as Windows Terminal's cellHeight (wins)
    scrollback = 10000, -- lines, at most 1000000
    copy_on_select = true,
    right_click_paste = true, -- right-click copies the selection, or pastes when there's none
    -- "webgl" (fast, the default) or "dom" (the browser's own text rendering: closer to
    -- Windows Terminal's ClearType, slower with a lot of output). docs/app/config.md compares them.
    renderer = "webgl",
    cursor_style = "block", -- "block", "bar" or "underline"
    -- Over the Theme's: background, foreground, cursor, cursor_accent, selection_background,
    -- search_match, search_active_match, and the 16 ANSI colours: black, red, green, yellow,
    -- blue, magenta, cyan, white, bright_black, bright_red, bright_green, bright_yellow,
    -- bright_blue, bright_magenta, bright_cyan, bright_white.
    colors = {},
  },

  -- Keys ---------------------------------------------------------------------------------------
  -- The chord that takes the keyboard back from a terminal (App mode). Written as
  -- "Ctrl+Space", "ctrl+b", "C-b" or "<C-b>"; it should have Ctrl, Alt or Meta.
  leader = "Ctrl+Space",
  vim = true, -- j/k/h/l/gg/G in lists and the Picker

  -- Key bindings, per context: key or sequence = action. An action is a command line, exactly
  -- what you'd type after `:` ("close", "session 1", "finder sessions"); false unbinds a default.
  -- Contexts: leader (after the Leader), list and list_vim (the Sidebar), picker and picker_vim,
  -- terminal (before the shell sees the key: terminal.copy, terminal.paste, terminal.search,
  -- terminal.zoomIn, …), global (everywhere, no Leader; keep it to keys a shell doesn't use).
  -- The Key bindings panel (Leader ?) lists every binding and where it comes from.
  keys = {
    leader = {
      -- t = "next",          -- Leader t: the next Session
      -- ["d d"] = false,     -- unbind Leader d d
    },
    global = {
      -- F12 = "keys",
    },
  },

  -- Layout -------------------------------------------------------------------------------------
  default_mode = "standard", -- the view mode at start: "standard" or "focus" (Leader m, F11)
  sessions = "sidebar", -- open Sessions in the Sidebar, or "tabs" for a tab strip

  -- Each view mode's pieces (decision Q39). Any piece can be turned off in any mode; a piece
  -- left out keeps that mode's default.
  --   titlebar   true / false
  --   sidebar    false, true, or { side = "left" | "right", sections = { "sessions", "folders", "inventory" } }
  --              (sections picks and orders them; leave it out for all). Leader e shows or hides it.
  --   sessionbar false, "bottom" or "top": the thin tmux-style bar of open Sessions
  --   statusbar  false, true, or a list of segments in order:
  --              "backend", "box", "hosts", "path", "changes", "hints", "mode" (the last two sit on the right).
  --              Leader s shows or hides it (in Focus, the session bar).
  --   fullscreen OS fullscreen
  modes = {
    standard = {
      fullscreen = false,
      titlebar = true,
      sidebar = { side = "left" },
      sessionbar = false,
      statusbar = true,
    },
    focus = {
      fullscreen = true,
      titlebar = false,
      sidebar = false, -- Focus reaches the tree with Leader e as a finder instead
      sessionbar = false, -- e.g. "bottom"
      statusbar = false,
    },
  },

  -- Folders ------------------------------------------------------------------------------------
  -- Personal groupings of Hosts in the Sidebar. These show first, marked "from init.lua", and can
  -- only be changed here; Folders made in the app are kept by the app.
  folders = {
    -- { name = "Lab ESXi", hosts = { "esxi-02", "esxi-03" } },
  },

  -- Other ----------------------------------------------------------------------------------------
  idle_lock_minutes = 15, -- lock after this many minutes without input (1 to 1440)

  -- What :config opens this file with: "os" (the app Windows or your desktop opens .lua files
  -- with; Notepad if there's none), or "wsl" ($EDITOR inside the Backend's WSL distro, vi if
  -- it's unset, in a console window of its own). :config reload reads it again, :config path
  -- says where it is.
  editor = "os",

  -- Which roster runs (read when the backend starts: Retry, or restart the app, after changing).
  -- "auto" detects it: on Windows, the default WSL distro, then running ones. "wsl:<distro>"
  -- uses that distro. ("local", native Windows roster, comes with ticket 19.)
  -- The ROSTER_APP_WSL_DISTRO env var wins over this.
  backend = "auto",
  -- The command that runs roster, for development: a command line or a list of words. The
  -- ROSTER_APP_ROSTER env var wins over this. Leave it out for "roster". It must run roster
  -- itself ("roster", a path to it, or "uv run --project <dir> roster"): it gets the master
  -- password. For any other wrapper, set ROSTER_APP_ROSTER instead (docs/app/config.md).
  -- roster_command = "uv run --project /home/you/work/roster roster",
}
