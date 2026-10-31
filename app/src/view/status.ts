// Status bar segments and Host-row badges as registries (ADR 0006, ticket 23). The app's own
// segments (backend, box, path, changes, hints, mode) are drawn by App from the layout; these
// registries hold the ones Plugins add, the built-in `hosts` count among them (it's a Plugin on
// the public API: crates/roster-core/plugins/hosts). A segment is text, never markup.
import { Registry, type Entry } from "../registry";

export interface StatusSegmentDef extends Entry {
  text: string;
  /** Its tooltip. */
  title?: string;
  /** What clicking it runs. */
  command?: string;
}

export type StatusRegistry = Registry<StatusSegmentDef>;

/** A badge a Plugin puts on a Host's rows ("2 alerts"). Its id is `plugin:host`. */
export interface BadgeEntry extends Entry {
  host: string;
  text: string;
}

export type BadgeRegistry = Registry<BadgeEntry>;

/** Each Host's badges, joined: what the Inventory's rows show. */
export function badgesByHost(entries: readonly BadgeEntry[]): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const b of entries) out.set(b.host, out.has(b.host) ? `${out.get(b.host)} · ${b.text}` : b.text);
  return out;
}
