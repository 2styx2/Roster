// A Platform held in memory, for tests: a State file and a clipboard you can look at.
import type { Platform } from "./types";

export interface MemoryPlatform extends Platform {
  /** What was last saved to the State file (undefined if nothing was). */
  saved(): unknown;
  /** The clipboard's text. */
  clipboardText(): string;
  /** Whether the window is fullscreen now. */
  fullscreen(): boolean;
}

export function memoryPlatform(start: { state?: unknown; windowsBuild?: number | null; clipboard?: string } = {}): MemoryPlatform {
  let state = start.state ?? {};
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
    saved: () => saved,
    clipboardText: () => clip,
  };
}
