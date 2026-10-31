// What's new (ticket 47): on the first start after an upgrade, the status line says once that
// `:help news` (docs/news.md) has this version's notes. Not a popup: it belongs in place, like
// every other message. The State keeps the last version seen (`newsSeen`), so it's said once.
import type { AppState } from "../state/appState";

/** The State's key for the last version whose news was offered. */
export const NEWS_KEY = "newsSeen";

/** MAJOR.MINOR.PATCH as numbers; anything else counts as 0.0.0. */
function parts(v: string): number[] {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
}

function newer(a: string, than: string): boolean {
  const [x, y] = [parts(a), parts(than)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}

/** Whether a State was used before: a first start has nothing in it yet. */
function used(state: AppState): boolean {
  return state.recentHosts.length > 0 || state.folded.length > 0 || Object.keys(state).some((k) => !["version", "recentHosts", "folded"].includes(k));
}

/** What to say for `version` given the State (null: nothing), and the version to keep as seen.
 * An upgrade says it; so does an older app's State, which has no version seen but was used. A
 * first start and an older build on a newer State say nothing. */
export function newsNote(state: AppState, version: string): { note: string | null; seen: string } {
  const seen = typeof state[NEWS_KEY] === "string" ? (state[NEWS_KEY] as string) : null;
  if (seen !== null && !newer(version, seen)) return { note: null, seen };
  const upgraded = seen !== null || used(state);
  return { note: upgraded ? `roster ${version}: what's new: :help news` : null, seen: version };
}
