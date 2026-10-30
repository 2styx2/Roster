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
  /** Acts as a save of init.lua: the app gets `report` as a live change. */
  saveConfig(report: ConfigReport): void;
}

export function memoryPlatform(
  start: { state?: unknown; windowsBuild?: number | null; clipboard?: string; config?: ConfigReport } = {},
): MemoryPlatform {
  let state = start.state ?? {};
  let config = start.config ?? null;
  const watchers = new Set<(r: ConfigReport) => void>();
  let saved: unknown;
  let clip = start.clipboard ?? "";
  let full = false;
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
    },
    saveConfig(report) {
      config = report;
      for (const w of watchers) w(report);
    },
    saved: () => saved,
    clipboardText: () => clip,
  };
}
