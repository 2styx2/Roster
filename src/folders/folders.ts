// Folders (GLOSSARY): the user's own groupings of Hosts, kept in this Box's State under `folders`
// and nowhere else: never sent to `roster serve`, never in roster.yml (decision Q34).
//
// This module stands apart from the app on purpose (ADR 0004): registerFolders adds a Sidebar
// section, one `folder` command and two key bindings through the public registries, and keeps
// its data through the State store's get/set, exactly as a Plugin would. Ticket 23 re-implements
// it as an internal Plugin on the Lua API, with the same commands.
//
//   folder new NAME            folder rename NAME NEW     folder delete NAME
//   folder add [HOST [NAME]]   folder remove [HOST NAME]
//
// Names may have spaces ("Lab ESXi"); quote one only where it would be ambiguous.
import type { Host } from "../backend/types";
import type { CommandContext, CommandDef } from "../commands/table";
import { registerBindings } from "../keymap";
import { sectionFinder } from "../finder/sources";
import type { Registries } from "../registries";
import { BUILTIN } from "../registry";
import type { SidebarRow, SidebarSection } from "../sidebar/Sidebar";
import { hostRow, type SidebarContext, type SidebarSectionDef } from "../sidebar/sections";

export interface Folder {
  name: string;
  /** Host names, in the order they were added. */
  hosts: string[];
}

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

/** Where Folders keep their data: one State key (StateStore's get/set). */
export interface FolderStore {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

function runFolder(store: FolderStore, ctx: CommandContext, arg: string) {
  const folders = parseFolders(store.get(STATE_KEY));
  const names = folders.map((f) => f.name);
  const [sub, rest] = firstWord(arg);
  const apply = (outcome: Outcome) => {
    if ("error" in outcome) return ctx.say(outcome.error);
    store.set(STATE_KEY, outcome.folders);
    ctx.say(outcome.message);
  };
  const cursorFolder = () => ctx.cursorRow()?.data?.folder ?? null;
  switch (sub) {
    case "new":
      if (!rest) return ctx.openCommandLine("folder new ");
      return apply(createFolder(folders, unquote(rest)));
    case "rename": {
      if (!rest) {
        const f = cursorFolder();
        return f ? ctx.openCommandLine(`folder rename ${quote(f)} `) : ctx.say("folder rename needs a Folder name and a new name");
      }
      const [name, to] = splitName(rest, names);
      if (!to) return ctx.openCommandLine(`folder rename ${quote(name)} `);
      return apply(renameFolder(folders, name, unquote(to)));
    }
    case "delete": {
      const name = rest ? unquote(rest) : cursorFolder();
      if (!name) return ctx.say("folder delete needs a Folder name");
      return apply(deleteFolder(folders, name));
    }
    case "add": {
      const [given, name] = firstWord(rest);
      const host = given || ctx.selectedHost();
      if (!host) return ctx.say("No Host selected: move to one in the Sidebar, or use folder add HOST NAME");
      if (!ctx.hostNames().includes(host)) return ctx.say(`No Host named ${host}`);
      if (!name) return ctx.openCommandLine(`folder add ${host} `);
      return apply(addToFolder(folders, host, unquote(name)));
    }
    case "remove": {
      if (!rest) {
        const row = ctx.cursorRow();
        const folder = row?.data?.folder;
        if (!row?.host || !folder) return ctx.say("Move to a Host in a Folder first, or use folder remove HOST NAME");
        return apply(removeFromFolder(folders, row.host, folder));
      }
      const [host, name] = firstWord(rest);
      if (!name) return ctx.say("folder remove needs a Host and a Folder name");
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

/** The `folder` command, keeping its data in `store`. */
export function folderCommand(store: FolderStore): CommandDef {
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
    run: (ctx, arg) => runFolder(store, ctx, arg ?? ""),
    complete: (arg, hostNames) => completeFolder(store, arg, hostNames),
  };
}

const addTo = (folder: Folder) => (host: string) =>
  folder.hosts.includes(host) ? null : `folder add ${host} ${folder.name}`;

function folderRows(folder: Folder, hostByName: ReadonlyMap<string, Host>): SidebarRow[] {
  const id = `folder:${folder.name}`;
  const data = { folder: folder.name };
  const drop = addTo(folder);
  const head: SidebarRow = {
    id,
    label: folder.name,
    detail: String(folder.hosts.length),
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

/** The Folders section, between Sessions and the Inventory. */
export function foldersSection(): SidebarSectionDef {
  return {
    id: "folders",
    source: BUILTIN,
    order: 200,
    build: ({ state, hostByName }: SidebarContext): SidebarSection => {
      const folders = parseFolders(state[STATE_KEY]);
      return {
        id: "folders",
        title: "Folders",
        count: folders.length,
        empty: "No Folders yet. Drag a Host here, or ␣ a.",
        actions: [{ label: "New Folder", icon: "add", command: "folder new" }],
        drop: (host) => `folder add ${host}`,
        rows: folders.flatMap((f) => folderRows(f, hostByName)),
      };
    },
  };
}

/** Registers Folders: the section, the `folder` command, and ␣ a / ␣ A. Returns what undoes it. */
export function registerFolders(registries: Registries, store: FolderStore): () => void {
  const disposers = [
    registries.sidebar.register(foldersSection()),
    registries.commands.register(folderCommand(store)),
    registries.finders.register(sectionFinder("folders", "Find in the Folders", "Folders")),
    registerBindings(registries.keymap, { leader: { a: "folder add", A: "folder remove" } }, BUILTIN),
  ];
  return () => disposers.forEach((d) => d());
}
