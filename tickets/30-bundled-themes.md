# 30: Bundled themes and a `:theme` picker

**Iteration:** 2 · **Repo:** roster-desk · **Decision:** Q51

**What to build:** Ship a few complete alternatives to Roster dark and light. Each has its own background, surfaces, accent (primary), text, and terminal colors, taken from the official palette definitions:
- **Gruvbox Dark:** already bundled. Finish it from the official palette, using the medium variant with yellow/orange accent options.
- **Nord:** already bundled. Finish it from nordtheme.com, with a frost blue accent.
- **Catppuccin Mocha:** new. Mauve accent, based on catppuccin/palette.
- **Tokyo Night:** new. Blue/purple accent, based on the folke/tokyonight.nvim palette.

Each theme brings its own `ansi` 16 colors from the same source, so the terminal matches. Roster dark and light keep the neutral Campbell ANSI palette (Q37).

**The `:theme` picker:** a finder source (ticket 22's registry) listing every registered theme, including user and Plugin themes, with a live preview as you move. Enter keeps the choice in State and Esc reverts. If `init.lua` sets `theme`, the Config wins, and the picker shows a note to change it there. Also add `:theme NAME`.

**Blocked by:** 21

**Status:** ready-for-agent

- [ ] Every theme passes a contrast test: body text at least 4.5:1 on bg/sidebar/raised, secondary text at least 3:1, and the accent on its button text at least 4.5:1.
- [ ] Each theme credits its palette source and license in `docs/themes.md`, with screenshots of Standard and the Picker in each theme.
- [ ] UI tests: the picker previews live, Esc reverts, Enter persists in State, `init.lua` wins, and `:theme NAME` works in both modes.
- [ ] Manual check on Windows: switch through every theme with a Session open, and the terminal colors follow.
