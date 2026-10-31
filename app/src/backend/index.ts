import { isTauri } from "@tauri-apps/api/core";
import type { FakeScenario } from "./fake";
import type { Backend } from "./types";

/** The `?fixture=` the page was opened with: in a plain browser always, inside Tauri only in a
 * dev build (the dev page's "Demo data / Worst case" toggle, ticket 27). */
export function fixtureParam(): string | null {
  const name = new URLSearchParams(globalThis.location?.search ?? "").get("fixture");
  return name !== null && (import.meta.env.DEV || !isTauri()) ? name : null;
}

export interface Started {
  backend: Backend;
  /** A fixture's State and open Sessions (the fake Backend only). */
  app?: FakeScenario["app"];
}

/** The real Backend inside Tauri; the fake one in a plain browser (`?fixture=<name>`), or in a
 * dev build that was given a fixture. */
export async function createBackend(): Promise<Started> {
  if (isTauri() && fixtureParam() === null) {
    const { tauriBackend } = await import("./tauri");
    return { backend: tauriBackend() };
  }
  const { fakeBackend, fixtureFromUrl } = await import("./fake");
  const scenario = fixtureFromUrl();
  return { backend: fakeBackend(scenario), ...(scenario.app ? { app: scenario.app } : {}) };
}
