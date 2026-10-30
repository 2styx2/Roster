// folders.yml (decision Q46): the Folders made in the app, next to init.lua, as plain data both the
// app and you edit. The app writes it on every Folder change, keeping your comments and the order of
// what it didn't change; edits made outside the app apply on `:source` (or at once with
// `auto_reload = true`, decision Q58). A file that doesn't parse keeps the last good Folders and
// says the line. The first time there's no file, the Folders the State held (before ticket 28) are
// written into it, once, and leave the State.
//
//   # Folders: your own groupings of Hosts …
//   Lab ESXi:
//     - esxi-02
//     - esxi-03
//   Night shift: []
import { Document, isMap, isScalar, isSeq, LineCounter, Pair, parseDocument, Scalar, YAMLMap, YAMLSeq } from "yaml";
import type { FoldersSource } from "../platform/types";
import { parseFolders, STATE_KEY, type Folder, type FolderStore } from "./folders";

export const FOLDERS_FILE = "folders.yml";

/** The comment a new folders.yml starts with. */
export const HEADER = [
  " Folders: your own groupings of Hosts, for the roster app (they never go into roster.yml).",
  " The app writes this file on every Folder change, keeping comments. Edit it by hand too,",
  " then :source applies it (or at once, with auto_reload = true in init.lua). Each Folder is",
  " its name and its Hosts:",
  "   Lab ESXi:",
  "     - esxi-02",
].join("\n");

/** Why the text isn't Folders, at a line (from 1) when there's one to point at. */
export interface FoldersError {
  line: number | null;
  message: string;
}

export type Parsed = { folders: Folder[] } | { error: FoldersError };

/** folders.yml's text as Folders, or what's wrong with it (the first problem). */
export function parseFoldersYml(text: string): Parsed {
  const lines = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lines, uniqueKeys: false });
  const err = doc.errors[0];
  if (err) return { error: { line: err.linePos?.[0].line ?? null, message: (err.message.split("\n")[0] ?? err.message).replace(/ at line \d+, column \d+:?$/, "") } };
  const at = (node: unknown) => {
    const range = (node as { range?: [number, number, number] } | null)?.range;
    return range ? lines.linePos(range[0]).line : null;
  };
  const contents = doc.contents;
  if (contents === null || (isScalar(contents) && contents.value === null)) return { folders: [] };
  if (!isMap(contents)) return { error: { line: at(contents), message: "folders.yml should be Folder names, each with its list of Hosts" } };
  const seen = new Set<string>();
  const folders: Folder[] = [];
  for (const pair of contents.items) {
    const key = pair.key;
    const name = isScalar(key) ? String(key.value ?? "").trim() : "";
    if (!name) return { error: { line: at(key), message: "a Folder needs a name" } };
    if (name.includes('"')) return { error: { line: at(key), message: `the Folder name ${name} can't contain a double quote` } };
    if (seen.has(name.toLowerCase())) return { error: { line: at(key), message: `there are two Folders named ${name}` } };
    seen.add(name.toLowerCase());
    const value = pair.value;
    let hosts: string[] = [];
    if (isSeq(value)) {
      for (const item of value.items) {
        if (!isScalar(item) || typeof item.value !== "string" || !item.value.trim()) {
          return { error: { line: at(item), message: `${name}: each Host is a name (a line like "- esxi-02")` } };
        }
        hosts.push(item.value.trim());
      }
    } else if (!(value === null || (isScalar(value) && value.value === null))) {
      return { error: { line: at(value), message: `${name}: its Hosts should be a list ("- esxi-02" lines, or [] for none)` } };
    }
    hosts = [...new Set(hosts)];
    folders.push({ name, hosts });
  }
  return { folders };
}

/** A sequence of `hosts`, reusing the old one's nodes (and their comments) for Hosts it still has. */
function hostsNode(old: unknown, hosts: readonly string[]): YAMLSeq {
  const seq = isSeq(old) ? old : new YAMLSeq();
  const kept = new Map<string, unknown>();
  if (isSeq(old)) for (const item of old.items) if (isScalar(item) && typeof item.value === "string") kept.set(item.value.trim(), item);
  seq.items = hosts.map((h) => kept.get(h) ?? new Scalar(h));
  seq.flow = hosts.length === 0;
  return seq;
}

/** `folders` as folders.yml's text: `previous` changed as little as it takes (comments, order and
 * spelling of what's still there kept), or a new file with the HEADER. */
export function foldersYml(previous: string | null, folders: readonly Folder[]): string {
  const doc = previous !== null && !("error" in parseFoldersYml(previous)) ? parseDocument(previous, { uniqueKeys: false }) : null;
  const map = doc && isMap(doc.contents) ? (doc.contents as YAMLMap) : null;
  const out: Document = doc ?? new Document();
  if (!doc) out.commentBefore = HEADER;
  const pairs = map ? [...map.items] : [];
  const nameOf = (p: Pair) => (isScalar(p.key) ? String(p.key.value ?? "").trim() : "");
  const lower = (s: string) => s.toLowerCase();
  const unmatchedOld = pairs.filter((p) => !folders.some((f) => lower(f.name) === lower(nameOf(p))));
  const unmatchedNew = folders.filter((f) => !pairs.some((p) => lower(nameOf(p)) === lower(f.name)));
  // One gone and one new where it was: a rename, which keeps the entry (and its comments).
  const renamed = unmatchedOld.length === 1 && unmatchedNew.length === 1 ? unmatchedOld[0] : undefined;
  const items = folders.map((f) => {
    const pair = pairs.find((p) => lower(nameOf(p)) === lower(f.name)) ?? (renamed && f === unmatchedNew[0] ? renamed : undefined);
    if (!pair) return new Pair(new Scalar(f.name), hostsNode(null, f.hosts));
    if (nameOf(pair) !== f.name) {
      const key = isScalar(pair.key) ? pair.key : new Scalar(f.name);
      key.value = f.name;
      pair.key = key;
    }
    pair.value = hostsNode(pair.value, f.hosts);
    return pair;
  });
  const next = map ?? new YAMLMap();
  next.items = items;
  out.contents = next;
  return out.toString();
}

/** The Folders store for the `folder` command and the Sidebar: folders.yml through the platform.
 * `get`/`set` hold the one key Folders use (FolderStore), so the command works on it unchanged. */
export class FoldersFile implements FolderStore {
  private folders: Folder[] = [];
  /** What the app last read or wrote: its own writes aren't outside edits. */
  private text: string | null = null;
  private path: string = FOLDERS_FILE;
  private writing: Promise<void> = Promise.resolve();
  private ready: Promise<void> | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly source: FoldersSource;
  private readonly state: { load(): Promise<void>; get(key: string): unknown; set(key: string, value: unknown): void };

  constructor(
    source: FoldersSource,
    state: { load(): Promise<void>; get(key: string): unknown; set(key: string, value: unknown): void },
  ) {
    this.source = source;
    this.state = state;
  }

  /** Reads folders.yml once; with no file yet, moves the State's Folders into a new one. Says
   * what went wrong (a broken file keeps no Folders until it's fixed). */
  load(): Promise<void> {
    this.ready ??= this.first();
    return this.ready;
  }

  private async first() {
    const { path, text } = await this.source.read();
    this.path = path;
    if (text !== null) {
      this.take(text);
      return;
    }
    await this.state.load();
    const old = parseFolders(this.state.get(STATE_KEY));
    if (old.length === 0) return;
    const made = foldersYml(null, old);
    await this.source.write(made);
    this.text = made;
    this.folders = old;
    this.state.set(STATE_KEY, undefined);
    this.changed();
  }

  /** Applies TEXT; returns what's wrong with it instead (the Folders stay as they were). */
  private take(text: string): string | null {
    const parsed = parseFoldersYml(text);
    this.text = text;
    if ("error" in parsed) {
      const { line, message } = parsed.error;
      return `${FOLDERS_FILE}${line ? `:${line}` : ""} has an error (${message}): the last good Folders are still in use`;
    }
    this.folders = parsed.folders;
    this.changed();
    return null;
  }

  /** `:source`: reads folders.yml again now. Null, or why it couldn't be used. */
  async reload(): Promise<string | null> {
    await this.load();
    await this.writing;
    const { text } = await this.source.read();
    if (text === null) return null;
    return this.take(text);
  }

  /** folders.yml was saved: whether that's an outside edit (not what the app has). */
  async isOutsideEdit(): Promise<boolean> {
    await this.load();
    await this.writing;
    const { text } = await this.source.read();
    return text !== null && text !== this.text;
  }

  where(): string {
    return this.path;
  }

  get(key: string): unknown {
    return key === STATE_KEY ? this.folders : undefined;
  }

  set(key: string, value: unknown) {
    if (key !== STATE_KEY) return;
    this.folders = parseFolders(value);
    this.changed();
    const folders = this.folders;
    this.writing = this.writing
      .then(() => this.load())
      .then(async () => {
        const text = foldersYml(this.text, folders);
        await this.source.write(text);
        this.text = text;
      })
      .catch(() => {});
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private changed() {
    for (const l of this.listeners) l();
  }
}
