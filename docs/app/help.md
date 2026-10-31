# Help: `:help`

The app has its own docs inside it, the way Neovim's `:help` does (ticket 37, decisions Q66 and Q73). They open in a panel beside the terminal (over it in Focus or a narrow window), like the Key bindings panel. New to roster? `:help start` is the place to begin.

## Opening it

| Keys or command | What it does |
|---|---|
| `␣ ?`, `:help` | The topic finder: every page and every entry on one, fuzzy-matched. Enter opens it |
| `:help TOPIC` | Opens TOPIC: a page (`:help options`), an option (`:help terminal.size`), a command (`:help :connect`, or `:help connect`), an error (`:help E13`), a Theme (`:help themes#nord`), a guide's heading (`:help config#the-sandbox`) or another name for one (`:help roster.yml`, `:help init.lua`). A topic that isn't exact opens the best fuzzy match. Tab completes topics |
| `:help TOPIC /TEXT` | Opens TOPIC and searches the page for TEXT, from the topic on |
| `:helpgrep TEXT` | Searches the text of every page (see [Searching every page](#searching-every-page)) |

## Links

You followed a link, or typed `:help links`. `Ctrl+o` goes back to where you were, and `Ctrl+i` forward again: help keeps the way you came, like a browser's back and forward (Neovim's jump list). The ‹ and › buttons at the top do the same.

To follow a link, Tab to it and press Enter (or `Ctrl+]`, as in Neovim), or click it. Code that names a topic is a link too: `:source`, `ui.hints`, `:help options`. A link to a file that isn't in help, such as `examples/init.lua`, shows as its text; hover it to see the path.

## Moving around

| Keys | What it does |
|---|---|
| `Tab`, `Enter` | Next link, follow it. `Ctrl+]` follows it too |
| `Ctrl+o` / `Ctrl+i` | Back, forward (also Alt+← and Alt+→, and the ‹ › buttons) |
| `j` / `k`, arrows | Scroll (`j` and `k` with vim keys on) |
| `Ctrl+d` / `Ctrl+u` | Half a page down, up |
| `g g` / `G` | Top, bottom (with vim keys on) |
| `g O` | The outline of this page (below) |
| `/`, then `n` / `N` | Search the page; next and previous match. In the search field, Enter and Shift+Enter move too, and Esc leaves it |
| `?` | The topic finder |
| `Esc`, `q` | Close help; focus goes back where it was (the terminal) |

Prose is in Inter and anything you could type or paste (commands, options, values, file names) in Iosevka; keys are keycaps. The keys in help's tables are what the page is about, so they show even with `ui.hints = false`, as in the Key bindings panel. Only the footer's hint line hides.

## The outline

`g O` (or the Outline button) lists the open page's headings and entries in a finder: type to narrow it, Enter to jump there. It's Neovim's `gO`, and the quickest way around a long page such as [Your init.lua](config.md).

## Searching every page

`:helpgrep TEXT` searches the text of every page, generated ones included, the way Neovim's `:helpgrep` does. Each paragraph, list item, table row and entry that has all the words you typed is a result, with the page and heading it's under. Enter opens that place and searches the page for your first word, so `n` and `N` go on from there. `:helpgrep` alone opens the same finder empty.

`/` searches only the page you're on; `␣ ?` matches topic names, not text.

## Help from where you are

Help has no cursor of its own to look a word up under, as Neovim's `K` and `Ctrl+]` do, so the lookup keys work from where you already are:

| Where | Keys | Opens help on |
|---|---|---|
| The command line | `Ctrl+]`, `F1` | The command you're typing: `:conn` opens `:connect`. With nothing typed, the [Commands](commands) page. Esc in help brings the command line back with your text and the cursor where they were |
| App mode | `␣ F1` (`:lookup`) | What's selected: a Host's row in the Sidebar opens `:connect`, any other row the command it runs. With nothing selected, the topic finder |
| The Picker, every finder | `F1` | The selected result: a Host opens `:connect`, a Theme its entry (`themes#nord`), a help topic itself, anything else the command Enter would run |
| The Key bindings panel | `F1` | The option of the first binding shown, so type to narrow it first (`keys.cmdline`) |

They're `cmdline.help` and `picker.help` in the keymap, and the `lookup` command, so `init.lua` can move them ([Keyboard](keyboard.md#default-bindings)).

## The pages

The [index](index) groups them, like Neovim's `help.txt`:

- **Getting started:** [Getting started](start.md), this page, [Set up a Box](../new-box.md) and [Add your Hosts](../adding-hosts.md).
- **Make it yours:** [Your init.lua](config.md), [Recipes](recipes.md), [Keyboard](keyboard.md), [Themes](themes.md).
- **Reference**, mostly generated from what the app has now, every time it's shown, so it can't go stale: `quickref` (the commands you'll use most, with their keys now), `commands`, `keys`, `options` (each with the value in effect and where it came from), `themes`, `finders`, `errors`, `health` (this Box's health, as the last `:check` with no Host found it), `all` (every topic, A to Z), and the guides [Connection errors](errors.md), [The roster command](../cli-reference.md) and [The roster serve API](../serve-api.md).
- **Extending:** [How far roster bends](extending.md).
- **What's new:** [What's new](../news.md), the changes in each Release, and [Deprecated names](../deprecated.md), every old name that still works and what replaces it. `:help` on an old name (`:help ROSTER_DESK_ROSTER`) lands on its row there.

### Where an option's value came from

The `options` page says, for each option, one of:

- `default`: init.lua doesn't set it.
- `init.lua:12`: the file sets it, on that line (or just `init.lua` when the line can't be found, for a value built in a loop or a `require`d module). The core lists every value the file set, so an option set to its default value still says `init.lua`.
- `State (:theme)` or `State (:hints)`: init.lua leaves it to the app, and `:theme` or `:hints` made a choice the State keeps.
- `State (:theme, over init.lua:12)`: init.lua sets `theme` on that line, and a `:theme` choice made over that same value is in effect.

## How the docs stay in sync

The Markdown in `docs/` is the only copy. The app imports it as text when it's built (`app/src/help/guides.ts`, Vite's `?raw`), so a build always carries the docs of its own commit, and there's nothing to copy by hand. The options page reads its names, defaults and descriptions from the option tables in [config.md](config.md), and a test (`app/src/help/options.test.ts`) fails CI if an option in the core's schema isn't in those tables, or if one in them isn't in the schema. So a new option needs its row in config.md before it can merge.

CI also checks the docs themselves, the way Neovim's `make lintdoc` does: every link in every page goes to a topic, a heading or a file that exists, no two topics share a name, and every relative link in `docs/` and the READMEs resolves (`app/src/help/lint.test.ts`, `tests/test_docs.py`). Every `roster serve` method and error code is in [serve-api.md](../serve-api.md), and every `roster` command in [cli-reference.md](../cli-reference.md).

## Writing help

What a guide in `docs/` needs so it reads well in `:help`, on GitHub, and stays linked:

- **Headings are names**, not sentences: each `##` and `###` becomes a topic, `page#slug` (`config#the-sandbox`). Renaming one breaks links to it, and CI says which; add the old name to the guide's `aliases` in `guides.ts` if people may have it in their fingers.
- **Link by topic or by file.** Another guide by its file (`[Keyboard](keyboard.md#two-modes)`), so the link works on GitHub too. A generated page, command, option or error by its topic: `[Options](options)`, `` `:connect` ``, `` `terminal.size` `` (a code span that names a topic is already a link), `[E13](E13)`.
- **Code is anything you could type**: commands, options, values, file names. Keys are written in keymap notation, `␣ f`, `Ctrl+Shift+c`.
- **An option is a row** in config.md's Options tables (Option, Default, What it does), and nowhere else.
- **One word means one thing**, the one in `GLOSSARY.md`.
- **Present tense, active voice**, and say exactly what happens.
- **Notes for developers** stay out of the way: help leaves out a parenthetical that only names a ticket, a decision, an ADR or an issue, such as `(decision QNN)`, so they can stay in the Markdown for whoever reads it on GitHub. Anywhere else in a sentence, write it in words or leave it to `docs/app/decisions.md`; a test fails on one that would show in help.
- **New guides** go in `guides.ts` with a part of the index, a title and a one-line summary.

## Plugins add pages

Help pages are a registry (ADR 0006), like commands and Themes: `registries.help`. A page is an id (its topic), a title, a one-line summary, an order for the index and a function that returns its blocks: headings, paragraphs, lists, tables, code and entries, as plain data, never HTML. So a Plugin's page (ticket 23) looks like the built-in ones, gets its topics in the finder and in `:helpgrep`, and the index lists it under its source.

## See also

[Getting started](start.md) · [Every topic](all) · [Quick reference](quickref) · [Keyboard](keyboard.md)
