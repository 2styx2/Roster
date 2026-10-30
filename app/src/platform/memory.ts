// A Platform held in memory, for tests: a State file and a clipboard you can look at.
import type { ConfigReport, ImportPreview } from "../config/types";
import type { Platform } from "./types";

export interface MemoryPlatform extends Platform {
  /** What was last saved to the State file (undefined if nothing was). */
  saved(): unknown;
  /** The clipboard's text. */
  clipboardText(): string;
  /** Whether the window is fullscreen now. */
  fullscreen(): boolean;
  /** Acts as a save of init.lua: the app gets `report` as a live change. */
  saveConfig(report: ConfigReport): void;
  /** Changes what's on disk with no save event; `:config reload` reads it. */
  writeConfig(report: ConfigReport): void;
  /** init.lua's text, or null while there's no file. */
  configFile(): string | null;
  /** The paths `:config` opened, in order. */
  opened(): string[];
  /** Makes the next `:config` fail with `message`. */
  failOpen(message: string): void;
  /** The `base` of each import written, in order. */
  imported(): string[];
  /** Makes the next import preview fail with `message`. */
  failImport(message: string): void;
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
    /** What `:config import-terminal` previews. */
    importPreview?: ImportPreview;
  } = {},
): MemoryPlatform {
  let state = start.state ?? {};
  let config = start.config ?? null;
  const watchers = new Set<(r: ConfigReport) => void>();
  let saved: unknown;
  let clip = start.clipboard ?? "";
  let full = false;
  let file = start.configFile ?? null;
  const opened: string[] = [];
  let openError: string | null = null;
  let importError: string | null = null;
  const imported: string[] = [];
  const path = () => config?.path ?? "/home/you/.config/roster/init.lua";
  const emit = (report: ConfigReport) => {
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
      async importPreview() {
        if (importError !== null) {
          const message = importError;
          importError = null;
          throw new Error(message);
        }
        if (!start.importPreview) throw new Error("no Windows Terminal settings.json found");
        return start.importPreview;
      },
      async importApply(base) {
        imported.push(base);
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
    writeConfig(report) {
      config = report;
    },
    configFile: () => file,
    opened: () => [...opened],
    imported: () => [...imported],
    failImport(message) {
      importError = message;
    },
    failOpen(message) {
      openError = message;
    },
    saved: () => saved,
    clipboardText: () => clip,
  };
}
