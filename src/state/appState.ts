// The State (GLOSSARY): what the app remembers on its own between runs, kept in the State file
// (desk-core state.rs: `state.json` in the OS app-data dir). Never the Config, never secrets.
// Keys this version doesn't know are kept as they are, so an older and a newer app can share it.

export interface AppState {
  version: 1;
  /** Host names, most recently opened first (the Picker breaks ties with it). */
  recentHosts: string[];
  [other: string]: unknown;
}

/** How many recent Hosts are remembered. */
export const RECENT_LIMIT = 50;

export const emptyState: AppState = { version: 1, recentHosts: [] };

/** The State from the file's contents; whatever is missing or malformed starts empty. */
export function parseState(json: unknown): AppState {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return emptyState;
  const raw = json as Record<string, unknown>;
  const recent = Array.isArray(raw.recentHosts) ? raw.recentHosts.filter((n) => typeof n === "string") : [];
  return { ...raw, version: 1, recentHosts: recent.slice(0, RECENT_LIMIT) };
}

/** The State after opening a Session to `host`. */
export function usedHost(state: AppState, host: string): AppState {
  const recentHosts = [host, ...state.recentHosts.filter((n) => n !== host)].slice(0, RECENT_LIMIT);
  return { ...state, recentHosts };
}
