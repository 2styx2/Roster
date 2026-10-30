# Help: `:help`

The app has its own docs inside it, the way Neovim's `:help` does (ticket 37, decision Q65). They open in a panel beside the terminal (over it in Focus or a narrow window), like the Key bindings panel.

## Opening it

| Keys or command | What it does |
|---|---|
| `␣ ?`, `:help` | The topic finder: every page and every entry on one, fuzzy-matched. Enter opens it |
| `:help TOPIC` | Opens TOPIC: a page (`:help options`), an option (`:help terminal.size`), a command (`:help :connect`, or `:help connect`), an error (`:help E13`), a Theme (`:help themes#nord`) or a guide's heading (`:help config#the-sandbox`). A topic that isn't exact opens the best fuzzy match. Tab completes topics |

## Moving around

| Keys | What it does |
|---|---|
| `j` / `k`, arrows | Scroll (`j` and `k` with vim keys on) |
| `Ctrl+d` / `Ctrl+u` | Half a page down, up |
| `g g` / `G` | Top, bottom |
| `Tab`, `Enter` | Next link, follow it. Code that names a topic (`:source`, `ui.hints`) is a link |
| `Ctrl+o` / `Ctrl+i` | Back, forward (also Alt+← and Alt+→, and the ‹ › buttons) |
| `/`, then `n` / `N` | Search the page; next and previous match. In the search field, Enter and Shift+Enter move too, and Esc leaves it |
| `?` | The topic finder |
| `Esc`, `q` | Close help; focus goes back where it was (the terminal) |

Prose is in Inter and anything you could type or paste (commands, options, values, file names) in Iosevka; keys are keycaps. The keys in help's tables are what the page is about, so they show even with `ui.hints = false`, as in the Key bindings panel. Only the footer's hint line hides.

## The pages

- **Generated** from what the app has now, every time they're shown, so they can't go stale: `commands` (the command table, with each command's keys and source), `keys` (the resolved keymap), `options` (every `init.lua` option with its value now and where it came from), `themes`, `finders` and `errors` (the error catalog).
- **Guides** written by hand: [config.md](config.md), [keyboard.md](keyboard.md), [themes.md](themes.md), [errors.md](errors.md) and this page. Links between them work in the app.

### Where an option's value came from

The `options` page says, for each option, one of:

- `default`: init.lua doesn't set it.
- `init.lua:12`: the file sets it, on that line (or just `init.lua` when the line can't be found, for a value built in a loop or a `require`d module). The core lists every value the file set, so an option set to its default value still says `init.lua`.
- `State (:theme)` or `State (:hints)`: init.lua leaves it to the app, and `:theme` or `:hints` made a choice the State keeps.

## How the docs stay in sync

The Markdown in `docs/app` is the only copy. The app imports it as text when it's built (`app/src/help/guides.ts`, Vite's `?raw`), so a build always carries the docs of its own commit, and there's nothing to copy by hand. The options page reads its names, defaults and descriptions from the option tables in [config.md](config.md), and a test (`app/src/help/options.test.ts`) fails CI if an option in the core's schema isn't in those tables, or if one in them isn't in the schema. So a new option needs its row in config.md before it can merge.

## Plugins add pages

Help pages are a registry (ADR 0006), like commands and Themes: `registries.help`. A page is an id (its topic), a title, a one-line summary, an order for the index and a function that returns its blocks: headings, paragraphs, lists, tables, code and entries, as plain data, never HTML. So a Plugin's page (ticket 23) looks like the built-in ones, gets its topics in the finder, and the index lists it with its source.
