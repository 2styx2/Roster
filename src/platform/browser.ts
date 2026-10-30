// The Platform in a plain browser (`npm run dev`): State in localStorage, the browser clipboard.
import type { Platform } from "./types";

const KEY = "roster-desk.state";

export function browserPlatform(): Platform {
  return {
    async loadState() {
      try {
        return JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown;
      } catch {
        return {};
      }
    },
    async saveState(state) {
      try {
        localStorage.setItem(KEY, JSON.stringify(state));
      } catch {
        // storage blocked: State is only a convenience
      }
    },
    windowsBuild: async () => null,
    clipboard: {
      readText: () => navigator.clipboard.readText(),
      writeText: (text) => navigator.clipboard.writeText(text),
    },
  };
}
