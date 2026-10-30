// The Sidebar section registry (ADR 0004). Each section is an entry that builds its rows from
// what the app knows right now; the Sidebar shows them in `order`. Ticket 07 registers Sessions;
// ticket 17 registers Folders and Inventory the same way, and later the Config and Plugins can.
import type { Host, HostList } from "../backend/types";
import { statusText } from "../session/Sessions";
import type { Tab, TabsSnapshot } from "../session/tabs";
import { BUILTIN, Registry, type Entry } from "../registry";
import type { Dot, SidebarSection } from "./Sidebar";

/** What a section can build from. */
export interface SidebarContext {
  sessions: TabsSnapshot;
  hosts: HostList;
  hostByName: ReadonlyMap<string, Host>;
  /** Where open Sessions are listed (the `sessions` option). */
  sessionsIn: "sidebar" | "tabs";
}

export interface SidebarSectionDef extends Entry {
  /** Lower comes first. Sessions is 100; ticket 17's Folders and Inventory follow it. */
  order: number;
  /** The section now, or null to leave it out. */
  build(ctx: SidebarContext): SidebarSection | null;
}

export type SidebarRegistry = Registry<SidebarSectionDef>;

/** The sections to show, in order. */
export function buildSections(defs: readonly SidebarSectionDef[], ctx: SidebarContext): SidebarSection[] {
  return [...defs]
    .sort((a, b) => a.order - b.order)
    .map((d) => d.build(ctx))
    .filter((s): s is SidebarSection => s !== null);
}

function dotOf(tab: Tab, host: Host | undefined): Dot {
  if (tab.status.state === "ended" || tab.status.state === "failed") return "ended";
  // An enrolled Host logs in with this Box's key; its `ssh.auth` is only the vault fallback.
  return host?.enroll ? "key" : "password";
}

/** Open Sessions in tab order, with their state dot; rows run `session N` and `close N`. */
export const sessionsSection: SidebarSectionDef = {
  id: "sessions",
  source: BUILTIN,
  order: 100,
  build: ({ sessions, hostByName, sessionsIn }) =>
    sessionsIn !== "sidebar"
      ? null
      : {
          id: "sessions",
          title: "Sessions",
          count: sessions.tabs.length,
          empty: "No Sessions open.",
          rows: sessions.tabs.map((tab, i) => ({
            id: `session-${tab.id}`,
            label: tab.host,
            dot: dotOf(tab, hostByName.get(tab.host)),
            ...(statusText(tab) ? { note: statusText(tab) } : {}),
            raised: tab.id === sessions.active,
            command: `session ${i + 1}`,
            closeCommand: `close ${i + 1}`,
            closeLabel: `Close ${tab.host}`,
          })),
        },
};

export function builtinSidebarRegistry(): SidebarRegistry {
  const registry = new Registry<SidebarSectionDef>();
  registry.register(sessionsSection);
  return registry;
}
