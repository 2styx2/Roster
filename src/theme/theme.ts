// Themes (GLOSSARY: Theme): named sets of colour tokens. Every colour the UI draws with is one of
// these tokens, set as a CSS variable on the document (`colors.raisedLine` → `--raised-line`), so
// components never hard-code a colour and the Config (ticket 21) or a Plugin (ticket 23) can
// change any token or register a whole new Theme (ADR 0002, ADR 0004).
//
// A Theme also colours the terminal's background, text, cursor and selection. Its 16 ANSI colours
// stay the neutral standard palette (decision Q37) unless the Theme brings its own `ansi`.
import type { Entry, Registry } from "../registry";
import { standardAnsi, type AnsiPalette, type TerminalTheme } from "../terminal/options";

/** The UI's colour tokens. Names are what the CSS reads, in kebab case (`--raised-line`). */
export interface ThemeColors {
  /** The one accent: the Picker's search pill, focus rings, key-login dots, "from init.lua". */
  accent: string;
  /** Text or glyphs drawn on an accent fill. */
  accentText: string;
  /** Accent-coloured text on `bg` (darker than `accent` in light themes, for contrast). */
  accentInk: string;
  /** The workspace behind the terminal and the lock screen. */
  bg: string;
  /** The title bar and the status bar. */
  chrome: string;
  /** The Sidebar and side panels (Key bindings, :check). */
  sidebar: string;
  /** Floating surfaces: the Picker, cards, error panels, the find bar. */
  panel: string;
  /** The raised style's fill (decision Q31): the item on screen, the selected row. */
  raised: string;
  /** The raised style's 1px outline. */
  raisedLine: string;
  /** A row or button under the pointer. */
  hover: string;
  /** Hairline borders between areas. */
  line: string;
  /** Borders of inputs and keycaps: a step stronger than `line`. */
  lineStrong: string;
  text: string;
  /** Secondary text: inactive rows, labels. */
  muted: string;
  /** Tertiary text: counts, addresses, section headings, hints. */
  faint: string;
  warn: string;
  error: string;
  /** The close button under the pointer (Windows' red), and its glyph. */
  danger: string;
  dangerText: string;
  /** Behind the Picker. */
  backdrop: string;
  /** The shadow under floating surfaces. */
  shadow: string;
}

/** The terminal's own colours, apart from the 16 ANSI ones. */
export type TerminalColors = Omit<TerminalTheme, keyof AnsiPalette>;

export interface Theme extends Entry {
  /** What a picker or the Config shows, e.g. "Roster dark". */
  label: string;
  /** Which OS appearance it suits: `theme = "auto"` picks one of each kind. */
  appearance: "dark" | "light";
  colors: ThemeColors;
  terminal: TerminalColors;
  /** The terminal's 16 colours. Leave it out to keep the standard palette (decision Q37). */
  ansi?: AnsiPalette;
}

export type ThemeRegistry = Registry<Theme>;

/** The `--kebab-case` CSS variable for a token name. */
export const cssVar = (token: string) => `--${token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

/** The CSS variables a Theme sets, with any tokens overridden. */
export function themeVariables(theme: Theme, overrides: Partial<ThemeColors> = {}): Record<string, string> {
  return Object.fromEntries(Object.entries({ ...theme.colors, ...overrides }).map(([k, v]) => [cssVar(k), v]));
}

/** The terminal's full theme: the Theme's colours and ANSI palette, then any overrides. */
export function terminalTheme(theme: Theme, overrides: Partial<TerminalTheme> = {}): TerminalTheme {
  return { ...(theme.ansi ?? standardAnsi), ...theme.terminal, ...overrides };
}

export interface AppearanceOptions {
  /** A Theme's id, or "auto" to follow the OS light/dark setting with `dark` and `light`. */
  theme: string;
  /** The Theme for a dark OS when `theme` is "auto". */
  dark: string;
  /** The Theme for a light OS when `theme` is "auto". */
  light: string;
  /** Font stacks (decision Q30). The terminal's font is a terminal option (ticket 08). Whether
   * the title bar shows is the view mode's layout (view/layout.ts, decision Q39). */
  fonts: { ui: string; mono: string };
  /** Tokens set over whichever Theme is in use (the Config's `colors`). */
  colors: Partial<ThemeColors>;
}

export const defaultAppearance: AppearanceOptions = {
  theme: "auto",
  dark: "roster-dark",
  light: "roster-light",
  fonts: {
    // The emoji fonts last, so a Host named "🦊-lab" draws its fox wherever one is installed.
    ui: '"Inter", system-ui, "Segoe UI", sans-serif, "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji"',
    mono: '"Iosevka", "Cascadia Mono", Consolas, ui-monospace, monospace, "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji"',
  },
  colors: {},
};

/** The Theme to use: the one named, or for "auto" the OS's kind; the default dark one if the
 * name isn't registered. */
export function resolveTheme(
  registry: Pick<ThemeRegistry, "get">,
  options: Pick<AppearanceOptions, "theme" | "dark" | "light">,
  prefersDark: boolean,
  fallback: Theme,
): Theme {
  const id = options.theme === "auto" ? (prefersDark ? options.dark : options.light) : options.theme;
  return registry.get(id) ?? fallback;
}
