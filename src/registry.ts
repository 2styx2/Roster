// A registry (ADR 0004): entries by id, each saying where it came from ("builtin", "init.lua",
// or a Plugin's name). The built-in features register here exactly as the Config (ticket 21) and
// Plugins (ticket 23) will. Registering an id again shadows the earlier entry until it's
// unregistered, so the Config can override a built-in and reloading it brings the built-in back.
// React reads a registry through useSyncExternalStore (subscribe + list).

/** Where an entry came from. */
export type Source = string;
export const BUILTIN: Source = "builtin";
export const CONFIG: Source = "init.lua";

export interface Entry {
  id: string;
  source: Source;
}

export class Registry<T extends Entry> {
  /** Per id, every registration, the last one in effect. Map order = first registration. */
  private readonly stacks = new Map<string, T[]>();
  private snap: readonly T[] = [];
  private readonly listeners = new Set<() => void>();

  /** Adds `entry`, shadowing any earlier one with its id. Returns a function that removes it. */
  register(entry: T): () => void {
    const stack = this.stacks.get(entry.id) ?? [];
    stack.push(entry);
    this.stacks.set(entry.id, stack);
    this.changed();
    return () => {
      const s = this.stacks.get(entry.id);
      const i = s?.lastIndexOf(entry) ?? -1;
      if (!s || i < 0) return;
      s.splice(i, 1);
      if (s.length === 0) this.stacks.delete(entry.id);
      this.changed();
    };
  }

  /** Removes every registration of `id`. */
  unregister(id: string) {
    if (this.stacks.delete(id)) this.changed();
  }

  /** Removes everything `source` registered (reloading the Config, unloading a Plugin). */
  unregisterSource(source: Source) {
    let any = false;
    for (const [id, stack] of this.stacks) {
      const kept = stack.filter((e) => e.source !== source);
      if (kept.length === stack.length) continue;
      any = true;
      if (kept.length) this.stacks.set(id, kept);
      else this.stacks.delete(id);
    }
    if (any) this.changed();
  }

  get(id: string): T | undefined {
    return this.stacks.get(id)?.at(-1);
  }

  /** The entries in effect; the same array until something changes. */
  list = (): readonly T[] => this.snap;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private changed() {
    this.snap = [...this.stacks.values()].map((s) => s[s.length - 1] as T);
    for (const l of this.listeners) l();
  }
}
