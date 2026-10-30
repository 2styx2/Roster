// The Config (GLOSSARY: Config) as the Rust core sends it: init.lua's table, checked against the
// schema and laid over the defaults (crates/roster-core/src/config/schema.rs, the source of truth;
// this mirrors it, camelCase). The frontend never runs Lua; it gets this object at start
// (`config_load`) and again after every save (`config-changed`). docs/app/config.md documents each
// option as it's written in init.lua.
import type { KeymapContext } from "../keymap";
import type { AnsiPalette, TerminalTheme } from "../terminal/options";
import type { TerminalColors, ThemeColors } from "../theme/theme";
import type { ViewMode } from "../view/layout";

/** A place in a Lua file. */
export interface ConfigLocation {
  /** Relative to the config dir: "init.lua", "lua/keys.lua". */
  file: string;
  line: number;
}

/** Why init.lua couldn't be used (a Lua or schema error), shown as `init.lua:12: message`. */
export interface ConfigError {
  file: string;
  line: number | null;
  message: string;
}

/** What the core read: the Config in effect (the last good one if the file is broken). */
export interface ConfigReport {
  config: Config;
  error: ConfigError | null;
  /** init.lua's full path. */
  path: string;
  /** Counts the core's reloads, from 1: the app keeps the highest it has seen. */
  version: number;
}

export interface ThemeDef {
  label?: string;
  appearance?: "dark" | "light";
  /** The Theme it starts from; Roster dark or light by `appearance` if left out. */
  base?: string;
  colors: Partial<ThemeColors>;
  terminal: Partial<TerminalColors>;
  /** "inherit": the base's; "standard": the neutral palette (decision Q37); or colours. */
  ansi: "inherit" | "standard" | Partial<AnsiPalette>;
}

export interface ModeConfig {
  fullscreen: boolean;
  titlebar: boolean;
  sidebar: { shown: boolean; side: "left" | "right"; sections: string[] | null };
  sessionbar: { shown: boolean; at: "top" | "bottom" };
  statusbar: { shown: boolean; segments: string[] | null };
}

export interface ConfigKey {
  context: KeymapContext;
  keys: string;
  /** null unbinds the key. */
  action: string | null;
}

export interface Config {
  theme: string;
  darkTheme: string;
  lightTheme: string;
  themes: Record<string, ThemeDef>;
  colors: Partial<ThemeColors>;
  fonts: { ui: string; mono: string; uiSize: number };
  terminal: {
    /** Families, most wanted first (ticket 33). */
    font: string[];
    /** In px: the core turns "16pt" into 21.33. */
    size: number;
    weight: number;
    boldWeight: number;
    lineHeight: number;
    /** A multiple of the font size (Windows Terminal's cellHeight); wins over lineHeight. */
    cellHeight: number | null;
    renderer: "webgl" | "dom";
    cursorStyle: "block" | "bar" | "underline";
    /** Bold text in the bright colours too. */
    boldIsBright: boolean;
    scrollback: number;
    copyOnSelect: boolean;
    rightClickPaste: boolean;
    colors: Partial<TerminalTheme>;
  };
  leader: string;
  vim: boolean;
  idleLockMinutes: number;
  defaultMode: ViewMode;
  sessions: "sidebar" | "tabs";
  keys: ConfigKey[];
  modes: Record<ViewMode, ModeConfig>;
  folders: { name: string; hosts: string[] }[];
  rosterCommand: string[] | null;
  backend: string;
  /** What `:config` opens init.lua with: the OS's app, or `$EDITOR` inside WSL (ticket 32). */
  editor: "os" | "wsl";
  /** Reload on every save (decision Q58); off: `:source` reloads. */
  autoReload: boolean;
  /** Where key bindings ("keys.leader.x"), Themes ("themes.mine") and Folders were set. */
  lines: Record<string, ConfigLocation>;
}

/** What `:config` did (ticket 32). */
export interface ConfigOpened {
  /** init.lua's full path. */
  path: string;
  /** The file was just made, from the example with every option commented out. */
  created: boolean;
}

/** One line of a diff of init.lua. */
export interface DiffLine {
  kind: "same" | "add" | "remove";
  text: string;
}

/** What `:config import-terminal` would write (roster-core wt.rs Preview), before it does. */
export interface ImportPreview {
  /** Windows Terminal's settings.json it read. */
  settingsPath: string;
  /** One line per thing it takes ("Font: Iosevka Nerd Font, 16 pt (21.3 px)"). */
  summary: string[];
  diff: DiffLine[];
  /** Options it sets that init.lua's own returned table also sets: those win. */
  overridden: string[];
  /** There's no init.lua yet: it's made from the commented-out example. */
  created: boolean;
  /** What the write checks init.lua against. */
  base: string;
  /** init.lua as this preview would leave it (a fingerprint): the write makes exactly that, or nothing. */
  result: string;
  /** The date in the block's comment. */
  date: string;
  /** The Config error the new file would have. */
  error: string | null;
}

/** What the write gets back from the preview the user confirmed. */
export type Previewed = Pick<ImportPreview, "base" | "result" | "date">;

/** Where the app gets the Config: the core in Tauri; tests push their own. */
export interface ConfigSource {
  /** The Config as the app starts (null: no config dir, use the defaults). */
  load(): Promise<ConfigReport | null>;
  /** Calls `onChange` after every reload (a `:source`, or a save with `auto_reload`); returns stop. */
  watch(onChange: (report: ConfigReport) => void): () => void;
  /** Calls `onStale` when a Config file was saved but not reloaded (`auto_reload` off). */
  watchStale(onStale: () => void): () => void;
  /** `:config`: makes init.lua if there's none (never overwriting one), then opens it in the
   * Config's `editor`. Rejects with why it couldn't. */
  open(): Promise<ConfigOpened>;
  /** `:config import-terminal` (ticket 33): the diff it would make. Rejects with why it can't. */
  importPreview(): Promise<ImportPreview>;
  /** Writes exactly what the preview showed: refused (nothing written) if init.lua or Windows
   * Terminal's settings changed since, with a message to run the import again. */
  importApply(previewed: Previewed): Promise<void>;
  /** `:source`: reads init.lua again now (watchers get it too). */
  reload(): Promise<ConfigReport | null>;
}
