// The Config (GLOSSARY: Config) as the Rust core sends it: init.lua's table, checked against the
// schema and laid over the defaults (crates/desk-core/src/config/schema.rs, the source of truth;
// this mirrors it, camelCase). The frontend never runs Lua; it gets this object at start
// (`config_load`) and again after every save (`config-changed`). docs/config.md documents each
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
  fonts: { ui: string; mono: string };
  terminal: {
    font: string;
    size: number;
    weight: number;
    boldWeight: number;
    lineHeight: number;
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
  /** Where key bindings ("keys.leader.x"), Themes ("themes.mine") and Folders were set. */
  lines: Record<string, ConfigLocation>;
}

/** Where the app gets the Config: the core in Tauri; tests push their own. */
export interface ConfigSource {
  /** The Config as the app starts (null: no config dir, use the defaults). */
  load(): Promise<ConfigReport | null>;
  /** Calls `onChange` after every save of init.lua; returns stop. */
  watch(onChange: (report: ConfigReport) => void): () => void;
}
