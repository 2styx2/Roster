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
    // A plain browser has no window to control: the title bar's buttons draw but do nothing.
    window: {
      minimize() {},
      toggleMaximize() {},
      close() {},
      watchMaximized: () => () => {},
      watchGeometry: () => () => {},
    },
    // The browser allows it only from a key or click; Focus works without it.
    async setFullscreen(on) {
      try {
        if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen();
        if (!on && document.fullscreenElement) await document.exitFullscreen();
      } catch {
        // refused: Focus still hides the chrome
      }
    },
  };
}
