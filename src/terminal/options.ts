// The terminal's look and behaviour as plain data, so the Config (ADR 0002, ticket 21) and
// Themes can override any of it. Its colours come from the Theme (theme/theme.ts terminalTheme),
// with `colors` from the Config over them. Decision Q37: the user's terminal config wins, so the 16 ANSI
// colours are a neutral, standard palette (Windows Terminal's default, Campbell), never tinted
// with the app's accent; remote prompts, LS_COLORS and vim schemes look as they do there.

export interface AnsiPalette {
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export interface TerminalTheme extends AnsiPalette {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  /** Scrollback search highlights. */
  searchMatch: string;
  searchActiveMatch: string;
}

export interface TerminalOptions {
  /** A monospace font stack. */
  fontFamily: string;
  /** Points; zoom moves it between minFontSize and maxFontSize, and resets to this. */
  fontSize: number;
  minFontSize: number;
  maxFontSize: number;
  lineHeight: number;
  scrollback: number;
  /** Selecting text copies it. */
  copyOnSelect: boolean;
  /** Right-click copies the selection, or pastes when nothing is selected (as Windows Terminal). */
  rightClickCopyPaste: boolean;
  /** Colours set over the Theme's (the Config's `terminal.colors`). */
  colors?: Partial<TerminalTheme>;
}

/** Windows Terminal's default scheme (Campbell): the neutral standard 16 colours. */
export const standardAnsi: AnsiPalette = {
  black: "#0c0c0c",
  red: "#c50f1f",
  green: "#13a10e",
  yellow: "#c19c00",
  blue: "#0037da",
  magenta: "#881798",
  cyan: "#3a96dd",
  white: "#cccccc",
  brightBlack: "#767676",
  brightRed: "#e74856",
  brightGreen: "#16c60c",
  brightYellow: "#f9f1a5",
  brightBlue: "#3b78ff",
  brightMagenta: "#b4009e",
  brightCyan: "#61d6d6",
  brightWhite: "#f2f2f2",
};

export const defaultTerminalOptions: TerminalOptions = {
  fontFamily: '"Iosevka", "Cascadia Mono", Consolas, ui-monospace, monospace',
  fontSize: 14,
  minFontSize: 6,
  maxFontSize: 40,
  lineHeight: 1,
  scrollback: 10000,
  copyOnSelect: true,
  rightClickCopyPaste: true,
};

export type ZoomAction = "terminal.zoomIn" | "terminal.zoomOut" | "terminal.zoomReset";

/** The font size after a zoom key. */
export function zoom(options: TerminalOptions, size: number, action: ZoomAction): number {
  const next = action === "terminal.zoomIn" ? size + 1 : action === "terminal.zoomOut" ? size - 1 : options.fontSize;
  return Math.min(options.maxFontSize, Math.max(options.minFontSize, next));
}
