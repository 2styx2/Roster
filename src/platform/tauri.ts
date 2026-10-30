// The Platform inside Tauri: the State file and the Windows build come from src-tauri (desk-core
// state.rs, platform.rs); the window's controls from Tauri's window API (tauriWindow.ts); the
// clipboard from the clipboard-manager plugin, because WebView2 won't let the page read the
// clipboard itself.
import { invoke } from "@tauri-apps/api/core";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { tauriWindow } from "./tauriWindow";
import type { Platform } from "./types";

export function tauriPlatform(): Platform {
  return {
    loadState: () => invoke<unknown>("state_load"),
    saveState: (state) => invoke("state_save", { state }),
    windowsBuild: async () => (await invoke<{ windowsBuild: number | null }>("platform_info")).windowsBuild,
    clipboard: {
      readText: async () => (await readText()) ?? "",
      writeText: (text) => writeText(text),
    },
    window: tauriWindow(),
  };
}
