# Themes

A Theme (GLOSSARY) is a named set of colour tokens: 21 UI tokens, the terminal's own colours and,
optionally, its 16 ANSI colours. `src/theme/theme.ts` says what each token colours,
`src/theme/themes.ts` holds the bundled ones, and [config.md](config.md) shows how `init.lua`
picks, changes or defines one. Decisions Q29, Q37, Q50 and Q51.

## Choosing one: `:theme`

- `:theme` (or `:finder themes`) opens a finder over every registered Theme: the bundled ones,
  `init.lua`'s and, later, a Plugin's. The Theme under the cursor is previewed live, terminal
  included. **Enter** keeps it, **Esc** puts the old one back.
- `:theme ID` (`:theme nord`) switches straight away. It completes Theme ids.
- The choice is kept in the State (key `theme`), not the Config. A stored Theme that's no longer
  registered is ignored.
- **`init.lua` wins.** If it names a Theme (`theme = "nord"`), that's the one shown, the finder
  says "set in init.lua" and only previews, and a choice isn't kept. `theme = "auto"` (the
  default) leaves the choice to the picker; without a choice it follows the OS with
  `dark_theme` / `light_theme`.

Order of precedence: a preview, then `init.lua`'s `theme`, then the State's choice, then `auto`.

## Bundled Themes

| id | Label | Source | License |
|---|---|---|---|
| `roster-dark` | Roster dark | Our own (Q29, Q50) | — |
| `roster-light` | Roster light | Our own (Q29) | — |
| `gruvbox` | Gruvbox Dark | [morhetz/gruvbox](https://github.com/morhetz/gruvbox), `colors/gruvbox.vim` | MIT/X11 (README, `package.json`) |
| `nord` | Nord | [nordtheme.com](https://www.nordtheme.com/docs/colors-and-palettes), [nordtheme/nord](https://github.com/nordtheme/nord) `src/nord.css`, terminal colours from [nordtheme/alacritty](https://github.com/nordtheme/alacritty) | MIT (© Sven Greb) |
| `catppuccin-mocha` | Catppuccin Mocha | [catppuccin/palette](https://github.com/catppuccin/palette), `palette.json` (`mocha.colors`, `mocha.ansiColors`) | MIT (© Catppuccin) |
| `tokyo-night` | Tokyo Night | [folke/tokyonight.nvim](https://github.com/folke/tokyonight.nvim), the **night** style: `lua/tokyonight/colors/night.lua` over `storm.lua`; terminal and ANSI colours from `extras/kitty/tokyonight_night.conf` | Apache-2.0 (the repo's `LICENSE`; the generated extras say MIT) |

All four are permissive, and only colour values are used, no code. Roster dark and light keep the
neutral standard ANSI palette (Q37); the others bring their own from the same source.

### How each palette maps to the tokens

**Gruvbox Dark**, medium contrast (`bg0` = `dark0`): bg `#282828`, chrome and Sidebar
`dark0_hard` `#1d2021`, panel and hover `dark0_soft`, raised `dark1`, lines `dark1`/`dark2`, text
`light1`, muted `light4`, faint `dark4`. Accent `bright_yellow` `#fabd2f` with `dark0` text; warn
`bright_orange`, error `bright_red`, danger `neutral_red`. Terminal: `bg0`/`fg1`, ANSI as
`gruvbox.vim` sets `g:terminal_color_0..15`. For the orange accent, in `init.lua`:
`colors = { accent = "#fe8019", accent_ink = "#fe8019" }` (`#282828` on it is 5.84:1).

**Nord**: bg, chrome and Sidebar `nord0` (as Nord's own editor ports do, with hairlines between),
panel and hover `nord1`, raised `nord2`, raised line `nord3`, text `nord6`, accent frost `nord8`
`#88c0d0` with `nord0` text; warn `nord13`, error and danger `nord11`. Terminal and ANSI from the
official Alacritty port; search matches `nord2`, the active one `nord10`.

**Catppuccin Mocha**: bg `base`, chrome, Sidebar and panel `mantle`, hover and lines `surface0`,
raised `surface1` (line `surface2`), text `text`, muted `subtext0`, faint `overlay1`. Accent
`mauve` with `crust` text; warn `yellow`, error and danger `red`. Cursor `rosewater`, selection
`surface2` (the Windows Terminal port's). ANSI from `ansiColors`.

**Tokyo Night** (night, not storm: closest to Roster dark's near-black): bg `#1a1b26`, chrome,
Sidebar and panel `bg_dark` `#16161e`, raised and lines `bg_highlight`, raised line and strong
lines `fg_gutter`, text `fg`, muted `fg_dark`, faint `dark5`. Accent `blue` `#7aa2f7` with
`bg_dark` text (for purple: `accent = "#bb9af7"`); warn `yellow`, error `red`, danger `red1`.
Search matches `blue0`, the active one `orange`, as the Neovim theme does.

### Where a token isn't a palette colour

| Theme | Token | Value | Why |
|---|---|---|---|
| Nord | `faint` | `#7b88a1` | Nord has no colour between `nord3` (1.7:1 on `nord0`, too dark for text) and `nord4`; this sits between them |
| Nord | `muted` | `#a5abb6` | Not in the 16-colour palette: the Alacritty port's `dim_foreground` (`nord4` is too close to the body text) |
| Tokyo Night | `hover` | `#1f2335` | storm's `bg_dark`: night has no step between `bg` and `bg_highlight` |
| all four | `backdrop`, `shadow` | translucent black (Catppuccin: `crust`) | overlays, not colours |

### Roster dark and light (ticket 30)

The contrast test found white on jade `#1f9d68` at 3.45:1. Roster dark keeps the jade fill and
puts near-black `#08090a` text on it (5.77:1). Roster light fills with the darker jade `#17845a`
(its `accent_ink` already), with white text (4.68:1). The backgrounds (Q50) are unchanged.

## The contrast test

`src/theme/contrast.test.ts` measures WCAG 2 ratios for every bundled Theme:

- body text (`text`) at least **4.5:1** on `bg`, `sidebar`, `raised` and `panel`;
- secondary text (`muted`) at least **3:1** on the same surfaces;
- the accent's button text (`accent_text` on `accent`) at least **4.5:1**;
- terminal foreground at least **4.5:1** on the terminal background.

Measured (lowest surface in brackets):

| Theme | text | muted | accent text |
|---|---|---|---|
| Roster dark | 15.4 (raised) | 5.24 (raised) | 5.77 |
| Roster light | 13.6 (raised) | 4.97 (raised) | 4.68 |
| Gruvbox Dark | 8.45 (raised) | 4.17 (raised) | 8.69 |
| Nord | 7.49 (raised) | 3.74 (raised) | 6.24 |
| Catppuccin Mocha | 6.31 (raised) | 4.10 (raised) | 9.23 |
| Tokyo Night | 8.32 (raised) | 6.36 (raised) | 7.14 |

`faint` (counts, addresses, hints) isn't held to a ratio, as in Roster dark.

## Screenshots

Standard with a Session open, and the picker, in each Theme (browser, fake Backend), in
[design/themes/](design/themes/): `<id>-standard.png` and `<id>-picker.png`.

| Theme | Standard | Picker |
|---|---|---|
| Roster dark | ![](design/themes/roster-dark-standard.png) | ![](design/themes/roster-dark-picker.png) |
| Roster light | ![](design/themes/roster-light-standard.png) | ![](design/themes/roster-light-picker.png) |
| Gruvbox Dark | ![](design/themes/gruvbox-standard.png) | ![](design/themes/gruvbox-picker.png) |
| Nord | ![](design/themes/nord-standard.png) | ![](design/themes/nord-picker.png) |
| Catppuccin Mocha | ![](design/themes/catppuccin-mocha-standard.png) | ![](design/themes/catppuccin-mocha-picker.png) |
| Tokyo Night | ![](design/themes/tokyo-night-standard.png) | ![](design/themes/tokyo-night-picker.png) |
