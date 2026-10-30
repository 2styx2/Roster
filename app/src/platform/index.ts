import { isTauri } from "@tauri-apps/api/core";
import type { Platform } from "./types";

/** The real Platform inside Tauri; the browser's in a plain browser. */
export async function createPlatform(): Promise<Platform> {
  if (isTauri()) {
    const { tauriPlatform } = await import("./tauri");
    return tauriPlatform();
  }
  const { browserPlatform } = await import("./browser");
  return browserPlatform();
}
