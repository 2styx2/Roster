// The bundled Themes. Roster dark and Roster light are the defaults (decision Q57: Apricot flare
// on Ink and Paper, Sea glass as the second tone) and keep the standard ANSI palette (decision
// Q37). Gruvbox Dark, Nord, Catppuccin Mocha and Tokyo Night (decision Q51, ticket 30) come from
// their official palettes, second tone included, and bring their own ANSI colours from the same
// source. docs/app/themes.md credits each source and lists where a token isn't a palette colour.
import { BUILTIN, Registry } from "../registry";
import type { Theme, ThemeRegistry } from "./theme";

// Apricot flare on Ink and Paper (decision Q57). The accent is apricot (#ff9a70 dark, the deeper
// #9b411a light, so white text reads on it), Ink #0f1011 is Roster dark's background and Paper
// #e8e8ea is Roster light's chrome. The second tone, Sea glass, marks this Box and unreviewed
// Hosts: shapes only, never text. warn is yellow and error raspberry, so neither reads as the
// apricot (Q57 replaces Q29's jade and the old amber and red).
const INK = "#0f1011";
const PAPER = "#e8e8ea";

export const rosterDark: Theme = {
  id: "roster-dark",
  source: BUILTIN,
  label: "Roster dark",
  appearance: "dark",
  colors: {
    accent: "#ff9a70",
    accentText: INK,
    accentInk: "#ffa076",
    tone: "#82ccd5",
    bg: INK,
    chrome: "#141617",
    sidebar: "#141617",
    panel: "#171819",
    raised: "#1e1f20",
    raisedLine: "#2c2d2e",
    hover: "#18191a",
    line: "#1f2021",
    lineStrong: "#282a2b",
    text: PAPER,
    muted: "#98989a",
    faint: "#69696a",
    warn: "#e9c944",
    error: "#e25a98",
    danger: "#b9205c",
    dangerText: "#ffffff",
    backdrop: "rgb(0 0 0 / 0.5)",
    shadow: "rgb(0 0 0 / 0.5)",
  },
  terminal: {
    background: INK,
    foreground: "#d4d4d6",
    cursor: "#d4d4d6",
    cursorAccent: INK,
    selectionBackground: "#493128",
    searchMatch: "#4c441f",
    searchActiveMatch: "#a89235",
  },
};

export const rosterLight: Theme = {
  id: "roster-light",
  source: BUILTIN,
  label: "Roster light",
  appearance: "light",
  colors: {
    accent: "#9b411a",
    accentText: "#ffffff",
    accentInk: "#9b411a",
    tone: "#296d82",
    bg: "#f2f2f4",
    chrome: PAPER,
    sidebar: PAPER,
    panel: "#f7f7f9",
    raised: "#fcfcfe",
    raisedLine: "#c7c7c9",
    hover: "#ededef",
    line: "#d4d4d6",
    lineStrong: "#c4c4c6",
    text: "#1e1f20",
    muted: "#5a5b5c",
    faint: "#8b8c8e",
    warn: "#5d580c",
    error: "#a11d6c",
    danger: "#b9205c",
    dangerText: "#ffffff",
    backdrop: "rgb(15 17 21 / 0.22)",
    shadow: "rgb(15 17 21 / 0.16)",
  },
  terminal: {
    background: "#f2f2f4",
    foreground: "#2a2b2d",
    cursor: "#2a2b2d",
    cursorAccent: "#f2f2f4",
    selectionBackground: "#e1cfc8",
    searchMatch: "#eee2ae",
    searchActiveMatch: "#e9c944",
  },
};

// Gruvbox Dark, medium contrast (morhetz/gruvbox, colors/gruvbox.vim, MIT/X11): bg0 #282828,
// yellow accent (bright_yellow; orange is the documented alternative, docs/app/themes.md), aqua
// (bright_aqua) second tone. The ANSI palette is the one gruvbox.vim gives Neovim's terminal.
export const gruvbox: Theme = {
  id: "gruvbox",
  source: BUILTIN,
  label: "Gruvbox Dark",
  appearance: "dark",
  colors: {
    accent: "#fabd2f",
    accentText: "#282828",
    accentInk: "#fabd2f",
    tone: "#8ec07c",
    bg: "#282828",
    chrome: "#1d2021",
    sidebar: "#1d2021",
    panel: "#32302f",
    raised: "#3c3836",
    raisedLine: "#504945",
    hover: "#32302f",
    line: "#3c3836",
    lineStrong: "#504945",
    text: "#ebdbb2",
    muted: "#aea08c",
    faint: "#7c6f64",
    warn: "#fe8019",
    error: "#fc7b6c",
    danger: "#cc241d",
    dangerText: "#fbf1c7",
    backdrop: "rgb(0 0 0 / 0.5)",
    shadow: "rgb(0 0 0 / 0.5)",
  },
  terminal: {
    background: "#282828",
    foreground: "#ebdbb2",
    cursor: "#ebdbb2",
    cursorAccent: "#282828",
    selectionBackground: "#504945",
    searchMatch: "#665c54",
    searchActiveMatch: "#d79921",
  },
  ansi: {
    black: "#282828",
    red: "#cc241d",
    green: "#98971a",
    yellow: "#d79921",
    blue: "#458588",
    magenta: "#b16286",
    cyan: "#689d6a",
    white: "#a89984",
    brightBlack: "#928374",
    brightRed: "#fb4934",
    brightGreen: "#b8bb26",
    brightYellow: "#fabd2f",
    brightBlue: "#83a598",
    brightMagenta: "#d3869b",
    brightCyan: "#8ec07c",
    brightWhite: "#ebdbb2",
  },
};

// Nord (nordtheme/nord, src/nord.css, MIT): Polar Night surfaces, Snow Storm text, frost blue
// (nord8) accent, Aurora purple (nord15) second tone. Terminal and ANSI colours and the muted text (dim_foreground) from the official
// nordtheme/alacritty port. `faint` is derived (between nord3 and nord4): nord3 is too dark for text.
export const nord: Theme = {
  id: "nord",
  source: BUILTIN,
  label: "Nord",
  appearance: "dark",
  colors: {
    accent: "#88c0d0",
    accentText: "#2e3440",
    accentInk: "#8fc4d3",
    tone: "#b48ead",
    bg: "#2e3440",
    chrome: "#2e3440",
    sidebar: "#2e3440",
    panel: "#3b4252",
    raised: "#434c5e",
    raisedLine: "#4c566a",
    hover: "#3b4252",
    line: "#3b4252",
    lineStrong: "#4c566a",
    text: "#eceff4",
    muted: "#b7bcc5",
    faint: "#7b88a1",
    warn: "#ebcb8b",
    error: "#dfb0b5",
    danger: "#bf616a",
    dangerText: "#2e3440",
    backdrop: "rgb(0 0 0 / 0.4)",
    shadow: "rgb(0 0 0 / 0.4)",
  },
  terminal: {
    background: "#2e3440",
    foreground: "#d8dee9",
    cursor: "#d8dee9",
    cursorAccent: "#2e3440",
    selectionBackground: "#4c566a",
    searchMatch: "#434c5e",
    searchActiveMatch: "#5e81ac",
  },
  ansi: {
    black: "#3b4252",
    red: "#bf616a",
    green: "#a3be8c",
    yellow: "#ebcb8b",
    blue: "#81a1c1",
    magenta: "#b48ead",
    cyan: "#88c0d0",
    white: "#e5e9f0",
    brightBlack: "#4c566a",
    brightRed: "#bf616a",
    brightGreen: "#a3be8c",
    brightYellow: "#ebcb8b",
    brightBlue: "#81a1c1",
    brightMagenta: "#b48ead",
    brightCyan: "#8fbcbb",
    brightWhite: "#eceff4",
  },
};

// Catppuccin Mocha (catppuccin/palette, palette.json, MIT): base/mantle/surface0-2 surfaces,
// mauve accent with crust text on it, teal second tone, and the palette's own `ansiColors` for the terminal.
export const catppuccinMocha: Theme = {
  id: "catppuccin-mocha",
  source: BUILTIN,
  label: "Catppuccin Mocha",
  appearance: "dark",
  colors: {
    accent: "#cba6f7",
    accentText: "#11111b",
    accentInk: "#cca7f7",
    tone: "#94e2d5",
    bg: "#1e1e2e",
    chrome: "#181825",
    sidebar: "#181825",
    panel: "#181825",
    raised: "#45475a",
    raisedLine: "#585b70",
    hover: "#313244",
    line: "#313244",
    lineStrong: "#45475a",
    text: "#cdd6f4",
    muted: "#afb6ce",
    faint: "#7f849c",
    warn: "#f9e2af",
    error: "#f59db5",
    danger: "#f38ba8",
    dangerText: "#11111b",
    backdrop: "rgb(17 17 27 / 0.6)",
    shadow: "rgb(17 17 27 / 0.6)",
  },
  terminal: {
    background: "#1e1e2e",
    foreground: "#cdd6f4",
    cursor: "#f5e0dc",
    cursorAccent: "#1e1e2e",
    selectionBackground: "#585b70",
    searchMatch: "#45475a",
    searchActiveMatch: "#7f849c",
  },
  ansi: {
    black: "#45475a",
    red: "#f38ba8",
    green: "#a6e3a1",
    yellow: "#f9e2af",
    blue: "#89b4fa",
    magenta: "#f5c2e7",
    cyan: "#94e2d5",
    white: "#a6adc8",
    brightBlack: "#585b70",
    brightRed: "#f37799",
    brightGreen: "#89d88b",
    brightYellow: "#ebd391",
    brightBlue: "#74a8fc",
    brightMagenta: "#f2aede",
    brightCyan: "#6bd7ca",
    brightWhite: "#bac2de",
  },
};

// Tokyo Night, the "night" style (folke/tokyonight.nvim, lua/tokyonight/colors/night.lua over
// storm.lua, Apache-2.0): bg #1a1b26, blue accent (purple, #bb9af7, is the documented
// alternative), teal second tone. Terminal and ANSI colours from the repo's extras/kitty/tokyonight_night.conf.
// `hover` is storm's bg_dark (#1f2335), which night overrides: night has no step between bg and
// bg_highlight.
export const tokyoNight: Theme = {
  id: "tokyo-night",
  source: BUILTIN,
  label: "Tokyo Night",
  appearance: "dark",
  colors: {
    accent: "#7aa2f7",
    accentText: "#16161e",
    accentInk: "#7aa2f7",
    tone: "#1abc9c",
    bg: "#1a1b26",
    chrome: "#16161e",
    sidebar: "#16161e",
    panel: "#16161e",
    raised: "#292e42",
    raisedLine: "#3b4261",
    hover: "#1f2335",
    line: "#292e42",
    lineStrong: "#3b4261",
    text: "#c0caf5",
    muted: "#a9b1d6",
    faint: "#737aa2",
    warn: "#e0af68",
    error: "#f7768e",
    danger: "#db4b4b",
    dangerText: "#16161e",
    backdrop: "rgb(0 0 0 / 0.5)",
    shadow: "rgb(0 0 0 / 0.5)",
  },
  terminal: {
    background: "#1a1b26",
    foreground: "#c0caf5",
    cursor: "#c0caf5",
    cursorAccent: "#1a1b26",
    selectionBackground: "#283457",
    searchMatch: "#3d59a1",
    searchActiveMatch: "#ff9e64",
  },
  ansi: {
    black: "#15161e",
    red: "#f7768e",
    green: "#9ece6a",
    yellow: "#e0af68",
    blue: "#7aa2f7",
    magenta: "#bb9af7",
    cyan: "#7dcfff",
    white: "#a9b1d6",
    brightBlack: "#414868",
    brightRed: "#ff899d",
    brightGreen: "#9fe044",
    brightYellow: "#faba4a",
    brightBlue: "#8db0ff",
    brightMagenta: "#c7a9ff",
    brightCyan: "#a4daff",
    brightWhite: "#c0caf5",
  },
};

export const bundledThemes: readonly Theme[] = [rosterDark, rosterLight, gruvbox, nord, catppuccinMocha, tokyoNight];

/** A Theme registry holding the bundled Themes. */
export function builtinThemeRegistry(): ThemeRegistry {
  const registry = new Registry<Theme>();
  for (const t of bundledThemes) registry.register(t);
  return registry;
}
