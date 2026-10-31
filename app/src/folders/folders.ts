// Folders (GLOSSARY): the user's own groupings of Hosts, kept in `folders.yml` next to init.lua
// (decision Q46; file.ts), or in this Box's State under `folders` where there's no config folder (a
// plain browser). Never sent to `roster serve`, never in roster.yml (decision Q34).
//
// This module stands apart from the app on purpose (ADR 0006): registerFolders adds a Sidebar
// section, one `folder` command and two key bindings through the public registries, and keeps
// its data through the State store's get/set, exactly as a Plugin would. Ticket 23 re-implements
// it as an internal Plugin on the Lua API, with the same commands.
//
//   folder new NAME            folder rename NAME NEW     folder delete NAME
//   folder add [HOST [NAME]]   folder remove [HOST NAME]
//
// Names may have spaces ("Lab ESXi"); quote one only where it would be ambiguous.
//
// Folders can also be defined in init.lua (ticket 21, decision Q46): the Config registers them in
// the `folders` registry (as a Plugin could), and they show first, marked "from init.lua", and
// can only be changed there. A Folder in the State with the same name is hidden behind it.
import type { Host } from "../backend/types";
import type { CommandContext, CommandDef } from "../commands/table";
import { registerBindings } from "../keymap";
import { sectionFinder } from "../finder/sources";
import type { Registries } from "../registries";
import { BUILTIN, Registry, type Entry } from "../registry";
import type { SidebarRow, SidebarSection } from "../sidebar/Sidebar";
import { hostRow, type SidebarContext, type SidebarSectionDef } from "../sidebar/sections";

export interface Folder {
  name: string;
  /** Host names, in the order they were added. */
  hosts: string[];
}

/** A Folder from the Config or a Plugin (read-only in the app). Its id is the name, lower case. */
export interface FolderEntry extends Entry {
  name: string;
  hosts: string[];
}

export type FolderRegistry = Registry<FolderEntry>;

/** Folders the app can't change, by name: none, unless the Config or a Plugin defines some. */
type Fixed = Pick<FolderRegistry, "list">;
const noFixed: Fixed = { list: () => [] };

const fixedNamed = (fixed: Fixed, name: string) =>
  fixed.list().find((f) => f.name.toLowerCase() === name.trim().toLowerCase());

/** The State key. */
export const STATE_KEY = "folders";

/** The Folders from the State (untrusted); anything malformed is dropped. */
export function parseFolders(json: unknown): Folder[] {
  if (!Array.isArray(json)) return [];
  const seen = new Set<string>();
  const out: Folder[] = [];
  for (const f of json) {
    if (typeof f !== "object" || f === null) continue;
    const { name, hosts } = f as Record<string, unknown>;
    if (typeof name !== "string" || !name.trim() || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const list = Array.isArray(hosts) ? hosts.filter((h): h is string => typeof h === "string") : [];
    out.push({ name, hosts: [...new Set(list)] });
  }
  return out;
}

/** What a change did: the new Folders and what to tell the user, or why it can't. */
export type Outcome = { folders: Folder[]; message: string } | { error: string };

const find = (folders: readonly Folder[], name: string) =>
  folders.find((f) => f.name.toLowerCase() === name.trim().toLowerCase());

function badName(name: string): string | null {
  if (!name.trim()) return "A Folder needs a name";
  if (name.includes('"')) return "A Folder name can't contain a double quote";
  return null;
}

export function createFolder(folders: readonly Folder[], name: string): Outcome {
  const bad = badName(name);
  if (bad) return { error: bad };
  if (find(folders, name)) return { error: `There's already a Folder named ${name.trim()}` };
  return { folders: [...folders, { name: name.trim(), hosts: [] }], message: `Created Folder ${name.trim()}` };
}

export function renameFolder(folders: readonly Folder[], name: string, to: string): Outcome {
  const folder = find(folders, name);
  if (!folder) return { error: `No Folder named ${name}` };
  const bad = badName(to);
  if (bad) return { error: bad };
  const clash = find(folders, to);
  if (clash && clash !== folder) return { error: `There's already a Folder named ${to.trim()}` };
  return {
    folders: folders.map((f) => (f === folder ? { ...f, name: to.trim() } : f)),
    message: `Renamed Folder ${folder.name} to ${to.trim()}`,
  };
}

export function deleteFolder(folders: readonly Folder[], name: string): Outcome {
  const folder = find(folders, name);
  if (!folder) return { error: `No Folder named ${name}` };
  return { folders: folders.filter((f) => f !== folder), message: `Deleted Folder ${folder.name}` };
}

/** Adds a Host to a Folder, creating the Folder if there isn't one by that name. */
export function addToFolder(folders: readonly Folder[], host: string, name: string): Outcome {
  const folder = find(folders, name);
  if (!folder) {
    const created = createFolder(folders, name);
    if ("error" in created) return created;
    return addToFolder(created.folders, host, name);
  }
  if (folder.hosts.includes(host)) return { error: `${host} is already in ${folder.name}` };
  return {
    folders: folders.map((f) => (f === folder ? { ...f, hosts: [...f.hosts, host] } : f)),
    message: `Added ${host} to ${folder.name}`,
  };
}

export function removeFromFolder(folders: readonly Folder[], host: string, name: string): Outcome {
  const folder = find(folders, name);
  if (!folder) return { error: `No Folder named ${name}` };
  if (!folder.hosts.includes(host)) return { error: `${host} isn't in ${folder.name}` };
  return {
    folders: folders.map((f) => (f === folder ? { ...f, hosts: f.hosts.filter((h) => h !== host) } : f)),
    message: `Removed ${host} from ${folder.name}`,
  };
}

const unquote = (s: string) => {
  const t = s.trim();
  return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t;
};

/** Quotes a name that has spaces, for a command line that names it before something else. */
export const quote = (name: string) => (/\s/.test(name) ? `"${name}"` : name);

/** Splits "NAME REST" where NAME may be quoted, or an existing Folder's name with spaces. */
export function splitName(text: string, names: readonly string[]): [string, string] {
  const t = text.trim();
  if (t.startsWith('"')) {
    const end = t.indexOf('"', 1);
    if (end > 0) return [t.slice(1, end), t.slice(end + 1).trim()];
  }
  const lower = t.toLowerCase();
  const known = [...names]
    .sort((a, b) => b.length - a.length)
    .find((n) => lower === n.toLowerCase() || lower.startsWith(`${n.toLowerCase()} `));
  if (known) return [t.slice(0, known.length), t.slice(known.length).trim()];
  const space = t.search(/\s/);
  return space < 0 ? [t, ""] : [t.slice(0, space), t.slice(space).trim()];
}

const firstWord = (text: string): [string, string] => {
  const t = text.trim();
  const space = t.search(/\s/);
  return space < 0 ? [t, ""] : [t.slice(0, space), t.slice(space).trim()];
};

const SUBCOMMANDS = ["new", "rename", "delete", "add", "remove"] as const;

/** Where Folders keep their data: one key (StateStore's get/set, or folders.yml's FoldersFile). */
export interface FolderStore {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  /** Calls `listener` after every change; returns stop. (The State's changes rebuild the Sidebar
   * without it.) */
  subscribe?(listener: () => void): () => void;
}

function runFolder(store: FolderStore, fixed: Fixed, ctx: CommandContext, arg: string) {
  const folders = parseFolders(store.get(STATE_KEY));
  const names = [...fixed.list().map((f) => f.name), ...folders.map((f) => f.name)];
  const [sub, rest] = firstWord(arg);
  const apply = (outcome: Outcome) => {
    if ("error" in outcome) return ctx.say(outcome.error);
    store.set(STATE_KEY, outcome.folders);
    ctx.say(outcome.message);
  };
  const cursorFolder = () => ctx.cursorRow()?.data?.folder ?? null;
  /** A Folder from init.lua can only be changed there. */
  const fromConfig = (name: string) => {
    const f = fixedNamed(fixed, name);
    if (!f) return false;
    ctx.say(`${f.name} is defined in ${f.source}: change it there`);
    return true;
  };
  switch (sub) {
    case "new":
      if (!rest) return ctx.openCommandLine("folder new ");
      if (fromConfig(unquote(rest))) return;
      return apply(createFolder(folders, unquote(rest)));
    case "rename": {
      if (!rest) {
        const f = cursorFolder();
        return f ? ctx.openCommandLine(`folder rename ${quote(f)} `) : ctx.say("folder rename needs a Folder name and a new name");
      }
      const [name, to] = splitName(rest, names);
      if (fromConfig(name)) return;
      if (!to) return ctx.openCommandLine(`folder rename ${quote(name)} `);
      if (fromConfig(unquote(to))) return;
      return apply(renameFolder(folders, name, unquote(to)));
    }
    case "delete": {
      const name = rest ? unquote(rest) : cursorFolder();
      if (!name) return ctx.say("folder delete needs a Folder name");
      if (fromConfig(name)) return;
      return apply(deleteFolder(folders, name));
    }
    case "add": {
      const [given, name] = firstWord(rest);
      const host = given || ctx.selectedHost();
      if (!host) return ctx.say("No Host selected: move to one in the Sidebar, or use folder add HOST NAME");
      if (!ctx.hostNames().includes(host)) return ctx.say(`No Host named ${host}`);
      if (!name) return ctx.openCommandLine(`folder add ${host} `);
      if (fromConfig(unquote(name))) return;
      return apply(addToFolder(folders, host, unquote(name)));
    }
    case "remove": {
      if (!rest) {
        const row = ctx.cursorRow();
        const folder = row?.data?.folder;
        if (!row?.host || !folder) return ctx.say("Move to a Host in a Folder first, or use folder remove HOST NAME");
        if (fromConfig(folder)) return;
        return apply(removeFromFolder(folders, row.host, folder));
      }
      const [host, name] = firstWord(rest);
      if (!name) return ctx.say("folder remove needs a Host and a Folder name");
      if (fromConfig(unquote(name))) return;
      return apply(removeFromFolder(folders, host, unquote(name)));
    }
    default:
      return ctx.say(`folder: say ${SUBCOMMANDS.join(", ")}`);
  }
}

function completeFolder(store: FolderStore, arg: string, hostNames: readonly string[]): string[] {
  const folders = parseFolders(store.get(STATE_KEY));
  const space = arg.search(/\s/);
  if (space < 0) return SUBCOMMANDS.filter((s) => s.startsWith(arg)).map((s) => `${s} `);
  const sub = arg.slice(0, space);
  const rest = arg.slice(space).trimStart();
  const startsWith = (word: string) => (s: string) => s.toLowerCase().startsWith(word.toLowerCase());
  if (sub === "rename" || sub === "delete") {
    return folders.map((f) => f.name).filter(startsWith(rest)).map((n) => `${sub} ${sub === "rename" ? `${quote(n)} ` : n}`);
  }
  if (sub !== "add" && sub !== "remove") return [];
  const hostSpace = rest.search(/\s/);
  if (hostSpace < 0) {
    const pool = sub === "remove" ? [...new Set(folders.flatMap((f) => f.hosts))] : hostNames;
    return pool.filter(startsWith(rest)).map((h) => `${sub} ${h} `);
  }
  const host = rest.slice(0, hostSpace);
  const word = rest.slice(hostSpace).trimStart();
  return folders
    .filter((f) => (sub === "remove") === f.hosts.includes(host))
    .map((f) => f.name)
    .filter(startsWith(word))
    .map((n) => `${sub} ${host} ${n}`);
}

/** The `folder` command, keeping its data in `store`; `fixed` Folders (init.lua's) it won't change. */
export function folderCommand(store: FolderStore, fixed: Fixed = noFixed): CommandDef {
  return {
    id: "folder",
    source: BUILTIN,
    area: "Folders",
    arg: "text",
    label: (arg) => {
      const [sub] = firstWord(arg ?? "");
      if (sub === "add") return "Add a Host to a Folder";
      if (sub === "remove") return "Remove a Host from its Folder";
      if (sub === "new") return "New Folder";
      if (sub === "rename") return "Rename a Folder";
      if (sub === "delete") return "Delete a Folder";
      return "Folders: new, rename, delete, add, remove";
    },
    run: (ctx, arg) => runFolder(store, fixed, ctx, arg ?? ""),
    complete: (arg, hostNames) => completeFolder(store, arg, hostNames),
  };
}

const addTo = (folder: Folder) => (host: string) =>
  folder.hosts.includes(host) ? null : `folder add ${host} ${folder.name}`;

/** A Folder from init.lua: marked, and nothing on it changes it (no rename, delete or drop). */
function fixedRows(folder: FolderEntry, hostByName: ReadonlyMap<string, Host>): SidebarRow[] {
  const id = `folder:${folder.name}`;
  const data = { folder: folder.name };
  const head: SidebarRow = {
    id,
    label: folder.name,
    detail: String(folder.hosts.length),
    note: `from ${folder.source}`,
    title: `Defined in ${folder.source}: change it there`,
    icon: "folder",
    level: 0,
    foldable: true,
    data,
    command: `togglefold ${id}`,
  };
  const hosts = folder.hosts.map((name): SidebarRow => {
    const host = hostByName.get(name);
    const rowId = `${id}/${name}`;
    const base: SidebarRow = host
      ? hostRow(host, rowId, 1)
      : { id: rowId, label: name, host: name, dot: "off", note: "not in the Inventory", level: 1, command: `open ${name}` };
    return { ...base, data, drag: name };
  });
  return [head, ...hosts];
}

function folderRows(folder: Folder, hostByName: ReadonlyMap<string, Host>): SidebarRow[] {
  const id = `folder:${folder.name}`;
  const data = { folder: folder.name };
  const drop = addTo(folder);
  const head: SidebarRow = {
    id,
    label: folder.name,
    count: folder.hosts.length,
    icon: "folder",
    level: 0,
    foldable: true,
    data,
    command: `togglefold ${id}`,
    drop,
    actions: [
      { label: `Rename ${folder.name}`, icon: "edit", command: `folder rename ${quote(folder.name)}` },
      { label: `Delete Folder ${folder.name}`, icon: "close", command: `folder delete ${folder.name}` },
    ],
  };
  const hosts = folder.hosts.map((name): SidebarRow => {
    const host = hostByName.get(name);
    const rowId = `${id}/${name}`;
    const base: SidebarRow = host
      ? hostRow(host, rowId, 1)
      : { id: rowId, label: name, host: name, dot: "off", note: "not in the Inventory", level: 1, command: `open ${name}` };
    return {
      ...base,
      data,
      drag: name,
      dragOut: `folder remove ${name} ${folder.name}`,
      drop,
      actions: [{ label: `Remove ${name} from ${folder.name}`, icon: "close", command: `folder remove ${name} ${folder.name}` }],
    };
  });
  return [head, ...hosts];
}

/** The Folders section, between Sessions and the Inventory: init.lua's first, then the State's. */
export function foldersSection(fixed: Fixed = noFixed, store?: Pick<FolderStore, "get">): SidebarSectionDef {
  return {
    id: "folders",
    source: BUILTIN,
    order: 200,
    build: ({ state, hostByName }: SidebarContext): SidebarSection => {
      const pinned = fixed.list();
      const folders = parseFolders(store ? store.get(STATE_KEY) : state[STATE_KEY]).filter((f) => !fixedNamed(fixed, f.name));
      return {
        id: "folders",
        title: "Folders",
        count: pinned.length + folders.length,
        empty: "No Folders yet. Drag a Host here or press `␣ a`.",
        actions: [{ label: "New Folder", icon: "add", command: "folder new" }],
        drop: (host) => `folder add ${host}`,
        rows: [...pinned.flatMap((f) => fixedRows(f, hostByName)), ...folders.flatMap((f) => folderRows(f, hostByName))],
      };
    },
  };
}

/** Registers Folders: the section, the `folder` command, and ␣ a / ␣ A. Returns what undoes it. */
export function registerFolders(registries: Registries, store: FolderStore): () => void {
  const fixed = registries.folders;
  // The section builds from the `folders` registry; registering it again when that changes is
  // what tells the Sidebar to rebuild.
  let section = registries.sidebar.register(foldersSection(fixed, store));
  const rebuild = () => {
    section();
    section = registries.sidebar.register(foldersSection(fixed, store));
  };
  const unwatch = fixed.subscribe(rebuild);
  const unwatchStore = store.subscribe?.(rebuild) ?? (() => {});
  const disposers = [
    () => {
      unwatch();
      unwatchStore();
      section();
    },
    registries.commands.register(folderCommand(store, fixed)),
    registries.finders.register(sectionFinder("folders", "Find in the Folders", "Folders")),
    registerBindings(registries.keymap, { leader: { a: "folder add", A: "folder remove" } }, BUILTIN),
  ];
  return () => disposers.forEach((d) => d());
}

/** An empty `folders` registry: init.lua and Plugins add to it. */
export const folderRegistry = (): FolderRegistry => new Registry<FolderEntry>();
