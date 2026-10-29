import { isTauri } from "@tauri-apps/api/core";
import type { Backend } from "./types";

/** The real Backend inside Tauri; the fake one in a plain browser (`?fixture=<name>`). */
export async function createBackend(): Promise<Backend> {
  if (isTauri()) {
    const { tauriBackend } = await import("./tauri");
    return tauriBackend();
  }
  const { fakeBackend, fixtureFromUrl } = await import("./fake");
  return fakeBackend(fixtureFromUrl());
}
