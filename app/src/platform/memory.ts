// A Platform held in memory, for tests: a State file and a clipboard you can look at.
import type { ConfigReport } from "../config/types";
import type { Platform } from "./types";

export interface MemoryPlatform extends Platform {
  /** What was last saved to the State file (undefined if nothing was). */
  saved(): unknown;
  /** The clipboard's text. */
  clipboardText(): string;
  /** Whether the window is fullscreen now. */
  fullscreen(): boolean;
  /** Acts as the core reloading init.lua: the app gets `report` as a live change. */
  saveConfig(report: ConfigReport): void;
  /** Acts as a save of init.lua, as the core's watcher sees it (roster-core Loader::on_save):
   * applied at once if the Config in effect has `auto_reload`, else only noticed. */
  fileSaved(report: ConfigReport): void;
  /** Changes what's on disk with no save event; `:source` reads it. */
  writeConfig(report: ConfigReport): void;
  /** init.lua's text, or null while there's no file. */
  configFile(): string | null;
  /** The paths `:config` opened, in order. */
  opened(): string[];
  /** Makes the next `:config` fail with `message`. */
  failOpen(message: string): void;
}

/** What the core writes the first time (roster-core config/editor.rs starter): commented out. */
const STARTER = "-- Made by the roster app's :config from its example (examples/init.lua).\n";

export function memoryPlatform(
  start: {
    state?: unknown;
    windowsBuild?: number | null;
    clipboard?: string;
    config?: ConfigReport;
    /** init.lua's text (default: no file). */
    configFile?: string | null;
  } = {},
): MemoryPlatform {
  let state = start.state ?? {};
  let config = start.config ?? null;
  const watchers = new Set<(r: ConfigReport) => void>();
  const staleWatchers = new Set<() => void>();
  /** The report in effect (the core's Loader::current). */
  let applied = config;
  let saved: unknown;
  let clip = start.clipboard ?? "";
  let full = false;
  let file = start.configFile ?? null;
  const opened: string[] = [];
  let openError: string | null = null;
  const path = () => config?.path ?? "/home/you/.config/roster/init.lua";
  const emit = (report: ConfigReport) => {
    applied = report;
    for (const w of watchers) w(report);
  };
  return {
    loadState: async () => state,
    async saveState(s) {
      state = structuredClone(s);
      saved = state;
    },
    windowsBuild: async () => start.windowsBuild ?? null,
    clipboard: {
      readText: async () => clip,
      async writeText(text) {
        clip = text;
      },
    },
    async setFullscreen(on) {
      full = on;
    },
    fullscreen: () => full,
    config: {
      load: async () => config,
      watch(onChange) {
        watchers.add(onChange);
        return () => watchers.delete(onChange);
      },
      watchStale(onStale) {
        staleWatchers.add(onStale);
        return () => staleWatchers.delete(onStale);
      },
      async open() {
        if (openError !== null) {
          const message = openError;
          openError = null;
          throw new Error(message);
        }
        const created = file === null;
        if (created) file = STARTER;
        opened.push(path());
        return { path: path(), created };
      },
      async reload() {
        if (config) emit(config);
        return config;
      },
    },
    saveConfig(report) {
      config = report;
      emit(report);
    },
    fileSaved(report) {
      config = report;
      if (applied?.config.autoReload) emit(report);
      else for (const w of staleWatchers) w();
    },
    writeConfig(report) {
      config = report;
    },
    configFile: () => file,
    opened: () => [...opened],
    failOpen(message) {
      openError = message;
    },
    saved: () => saved,
    clipboardText: () => clip,
  };
}
