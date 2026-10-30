// The Sidebar section registry (ADR 0006). Each section is an entry that builds its rows from
// what the app knows right now; the Sidebar shows them in `order`. Ticket 07 registers Sessions;
// ticket 17 registers the Inventory the same way, and Folders (folders/) from outside, as a Plugin
// will. Sections only say what rows they have; buildSections folds them by State, finds each
// row's parent, and raises the on-screen Host's first row (the others are "also").
import type { Host, HostList } from "../backend/types";
import { statusText } from "../session/Sessions";
import type { Tab, TabsSnapshot } from "../session/tabs";
import { BUILTIN, Registry, type Entry } from "../registry";
import { headingId, type Dot, type SidebarRow, type SidebarSection } from "./Sidebar";

/** What a section can build from. */
export interface SidebarContext {
  sessions: TabsSnapshot;
  hosts: HostList;
  hostByName: ReadonlyMap<string, Host>;
  /** Where open Sessions are listed (the `sessions` option). */
  sessionsIn: "sidebar" | "tabs";
  /** The State (GLOSSARY) as it is now: a section may keep its own key in it (Folders does). */
  state: Readonly<Record<string, unknown>>;
  /** Ids of the folded rows and section headings (State's `folded`). */
  folded: ReadonlySet<string>;
  /** The Live Inventory (ticket 28): roster can add, remove, rename and move Hosts and groups
   * (API 8), and what's added and not Published yet (shown dimmed, with a dot). */
  live?: { pendingHosts: ReadonlySet<string>; pendingGroups: ReadonlySet<string> };
}

export interface SidebarSectionDef extends Entry {
  /** Lower comes first. Sessions is 100; ticket 17's Folders and Inventory follow it. */
  order: number;
  /** The section now, or null to leave it out. */
  build(ctx: SidebarContext): SidebarSection | null;
}

export type SidebarRegistry = Registry<SidebarSectionDef>;

/** The sections to show, in order, folded as State says, with the on-screen Host marked. */
export function buildSections(defs: readonly SidebarSectionDef[], ctx: SidebarContext): SidebarSection[] {
  const sections = [...defs]
    .sort((a, b) => a.order - b.order)
    .map((d) => d.build(ctx))
    .filter((s): s is SidebarSection => s !== null)
    .map((s) => foldSection(s, ctx.folded));
  const active = ctx.sessions.tabs.find((t) => t.id === ctx.sessions.active);
  return active ? markOnScreen(sections, active.host, isLive(active)) : sections;
}

/** Folds a section: drops the rows under a folded row, and gives each row its parent. */
function foldSection(section: SidebarSection, folded: ReadonlySet<string>): SidebarSection {
  const heading = headingId(section.id);
  const rows: SidebarRow[] = [];
  /** The open ancestors of the next row: [level, id]. */
  const stack: [number, string][] = [];
  let hiddenBelow: number | null = null;
  for (const row of section.rows) {
    const level = row.level ?? 0;
    if (hiddenBelow !== null && level > hiddenBelow) continue;
    hiddenBelow = null;
    while (stack.length && (stack.at(-1) as [number, string])[0] >= level) stack.pop();
    const isFolded = row.foldable === true && folded.has(row.id);
    rows.push({ ...row, parent: stack.at(-1)?.[1] ?? heading, ...(row.foldable ? { folded: isFolded } : {}) });
    if (isFolded) hiddenBelow = level;
    else if (row.foldable) stack.push([level, row.id]);
  }
  return { ...section, rows, folded: folded.has(heading) };
}

/** A Session that's connected or connecting: not ended, not refused. */
const isLive = (tab: Tab) => tab.status.state !== "ended" && tab.status.state !== "failed";

/** The on-screen Host is raised where it first shows (a section may have raised its own row
 * already: Sessions raises the tab on screen) and brighter ("also") everywhere else. The raised
 * row is `live` while its Session is (the accent bar, decision Q53). */
function markOnScreen(sections: SidebarSection[], host: string, live: boolean): SidebarSection[] {
  let seen = sections.some((s) => !s.folded && s.rows.some((r) => r.raised));
  return sections.map((s) =>
    s.folded
      ? s
      : {
          ...s,
          rows: s.rows.map((r) => {
            if (r.host !== host || r.raised) return r;
            if (seen) return { ...r, also: true };
            seen = true;
            return { ...r, raised: true, ...(live ? { live } : {}) };
          }),
        },
  );
}

function dotOf(tab: Tab, host: Host | undefined): Dot {
  if (tab.status.state === "ended" || tab.status.state === "failed") return "ended";
  // How the Session logged in, once it has; until then an enrolled Host will use this Box's key
  // (its `ssh.auth` is only the vault fallback).
  if (tab.auth) return tab.auth;
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
            label: tab.label,
            ...(tab.label !== tab.host ? { tail: tab.label.slice(tab.host.length) } : {}),
            host: tab.host,
            dot: dotOf(tab, hostByName.get(tab.host)),
            ...(statusText(tab) ? { note: statusText(tab) } : {}),
            ...(tab.auth ? { title: `${tab.auth} login` } : {}),
            raised: tab.id === sessions.active,
            ...(tab.id === sessions.active && isLive(tab) ? { live: true } : {}),
            command: `session ${i + 1}`,
            actions: [{ label: `Close ${tab.label}`, icon: "close", command: `close ${i + 1}` }],
          })),
        },
};

/** A Host's dot in the tree: how it would log in, or hollow and faint while it's unreviewed. */
export function hostDot(host: Host): Dot {
  if (!host.reviewed) return "off";
  return host.enroll || ["agent", "key", "none"].includes(host.ssh.auth) ? "key" : "password";
}

/** A Host as a tree row (the Inventory's, and a Plugin's such as Folders): Enter opens it, or
 * goes to its Session. */
export function hostRow(host: Host, id: string, level: number): SidebarRow {
  return {
    id,
    label: host.name,
    host: host.name,
    dot: hostDot(host),
    detail: host.ip,
    ...(host.reviewed
      ? {}
      : {
          badge: "unreviewed",
          title: "Not reviewed yet: can't be opened",
          actions: [{ label: `Mark ${host.name} reviewed`, icon: "review" as const, command: `review ${host.name}` }],
        }),
    level,
    command: `open ${host.name}`,
    drag: host.name,
  };
}

/** The Inventory's groups in roster.yml order, then any group a Host names that isn't declared. */
function groupsOf(hosts: HostList): [string, Host[]][] {
  const byGroup = new Map<string, Host[]>(Object.keys(hosts.groups).map((g) => [g, []]));
  for (const h of hosts.hosts) {
    const list = byGroup.get(h.group);
    if (list) list.push(h);
    else byGroup.set(h.group, [h]);
  }
  return [...byGroup];
}

/** Every Host, grouped as in roster.yml (the team's grouping), with counts. With the Live
 * Inventory (ticket 28) each group heading has `+` (a Host), rename and delete, each Host rename and
 * remove, a Host dropped on another group moves there, and the heading has "New group". */
export const inventorySection: SidebarSectionDef = {
  id: "inventory",
  source: BUILTIN,
  order: 300,
  build: ({ hosts, hostByName, live }) => ({
    id: "inventory",
    title: "Inventory",
    count: hosts.hosts.length,
    empty: live ? "No Hosts yet. Press `␣ n` to add one." : "No Hosts yet. Add them in roster.yml.",
    ...(live ? { actions: [{ label: "New group", icon: "add" as const, command: "group new" }] } : {}),
    rows: groupsOf(hosts).flatMap(([group, members]): SidebarRow[] => {
      const data = { group };
      const drop = (host: string) => (hostByName.has(host) && hostByName.get(host)?.group !== group ? `host move ${host} ${group}` : null);
      const pending = (yes: boolean) => (live && yes ? { pending: true } : {});
      return [
        {
          id: `group:${group}`,
          label: group,
          count: members.length,
          icon: "group" as const,
          ...(hosts.groups[group]?.title ? { title: hosts.groups[group].title } : {}),
          level: 0,
          foldable: true,
          data,
          command: `togglefold group:${group}`,
          ...pending(live?.pendingGroups.has(group) ?? false),
          ...(live
            ? {
                drop,
                actions: [
                  { label: `Add a Host to ${group}`, icon: "add" as const, command: `host add ${group}` },
                  { label: `Rename group ${group}`, icon: "edit" as const, command: `group rename ${group}` },
                  { label: `Delete group ${group}`, icon: "close" as const, command: `group delete ${group}` },
                ],
              }
            : {}),
        },
        ...members.map((h): SidebarRow => {
          const row = hostRow(h, `inventory:${h.name}`, 1);
          if (!live) return row;
          return {
            ...row,
            data,
            drop,
            ...pending(live.pendingHosts.has(h.name)),
            actions: [
              ...(row.actions ?? []),
              { label: `Rename ${h.name}`, icon: "edit" as const, command: `host rename ${h.name}` },
              { label: `Remove ${h.name} from the Inventory`, icon: "close" as const, command: `host remove ${h.name}` },
            ],
          };
        }),
      ];
    }),
  }),
};

export function builtinSidebarRegistry(): SidebarRegistry {
  const registry = new Registry<SidebarSectionDef>();
  registry.register(sessionsSection);
  registry.register(inventorySection);
  return registry;
}
