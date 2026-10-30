// `:help options` (ticket 37): every init.lua option, as docs/app/config.md's tables describe it
// (the one copy of what each does and its default), with the value in effect from the Config the
// core sent and where that value came from: the default, init.lua (the core lists what the file
// set, `Config.set`, with its line), or the State (a choice `:theme` or `:hints` keeps when
// init.lua leaves it to them).
import type { Config, ConfigLocation } from "../config/types";
import { plain, type Inline } from "./doc";
import { parseMarkdown } from "./markdown";

export interface OptionDoc {
  /** The Lua name, dot-separated: `terminal.size`, `modes.focus.sidebar`. */
  name: string;
  default: Inline[];
  about: Inline[];
  /** config.md's `###` heading it's under ("Fonts and the terminal"). */
  section: string;
}

/** The options in config.md's "Options" tables. A row may name two (`dark_theme` / `light_theme`),
 * and the pieces table names a piece of each mode (`modes.standard.titlebar`). */
export function optionDocs(markdown: string): OptionDoc[] {
  const cached = docsCache.get(markdown);
  if (cached) return cached;
  const out: OptionDoc[] = [];
  let inOptions = false;
  let section = "";
  for (const b of parseMarkdown(markdown)) {
    if (b.t === "h") {
      if (b.level === 2) inOptions = plain(b.text) === "Options";
      if (b.level === 3) section = plain(b.text).replace(/\s*\(.*\)$/, "");
      continue;
    }
    if (!inOptions || b.t !== "table") continue;
    const head = b.head.map((c) => plain(c));
    if (head[0] === "Option") {
      for (const [names = [], def = [], about = []] of b.rows) {
        const codes = names.filter((i) => i.t === "code").map((i) => (i.t === "code" ? i.text : ""));
        const defaults = splitDefaults(def, codes.length);
        codes.forEach((name, k) => out.push({ name, default: defaults[k] ?? def, about, section }));
      }
    } else if (head[0] === "Piece") {
      const modes = head.slice(2).map((m) => m.toLowerCase());
      for (const [piece = [], takes = [], ...defaults] of b.rows) {
        modes.forEach((mode, k) =>
          out.push({ name: `modes.${mode}.${plain(piece)}`, default: defaults[k] ?? [], about: takes, section }),
        );
      }
    }
  }
  docsCache.set(markdown, out);
  return out;
}

const docsCache = new Map<string, OptionDoc[]>();

/** `"roster-dark"` / `"roster-light"` → one default per name, when the cell has one per name. */
function splitDefaults(cell: Inline[], count: number): Inline[][] {
  if (count < 2) return [cell];
  const codes = cell.filter((i) => i.t === "code");
  return codes.length === count ? codes.map((c) => [c]) : [cell];
}

const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** The option's value in `config`, by its Lua name; undefined when the Config has no such name. */
export function optionValue(config: Config, name: string): unknown {
  let v: unknown = config;
  for (const seg of name.split(".")) {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return undefined;
    const o = v as Record<string, unknown>;
    const key = camel(seg);
    if (!(key in o)) return undefined;
    v = o[key];
  }
  return v;
}

/** Every value's Lua path in the Config (a table's values; a list is one value), apart from what
 * the core adds about the file (`lines`, `set`). */
export function leafPaths(config: Config): string[] {
  const out: string[] = [];
  const walk = (v: unknown, path: string[]) => {
    if (v !== null && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length > 0) {
      for (const [k, child] of Object.entries(v)) walk(child, [...path, snake(k)]);
    } else out.push(path.join("."));
  };
  for (const [k, v] of Object.entries(config)) if (k !== "lines" && k !== "set") walk(v, [snake(k)]);
  return out;
}

/** A value as init.lua would write it: `"13pt"`, `true`, `{ "a", "b" }`, `{ side = "left" }`. */
export function luaValue(v: unknown, max = 160): string {
  const write = (x: unknown): string => {
    if (x === null || x === undefined) return "unset";
    if (typeof x === "string") return JSON.stringify(x);
    if (typeof x === "number") return String(Math.round(x * 100) / 100);
    if (typeof x === "boolean") return String(x);
    if (Array.isArray(x)) return x.length ? `{ ${x.map(write).join(", ")} }` : "{}";
    const entries = Object.entries(x as Record<string, unknown>);
    if (!entries.length) return "{}";
    const key = (k: string) => (/^[A-Za-z_]\w*$/.test(k) ? snake(k) : `["${k}"]`);
    return `{ ${entries.map(([k, val]) => `${key(k)} = ${write(val)}`).join(", ")} }`;
  };
  const s = write(v);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** What the State holds for the options the app also lets you choose (`:theme`, `:hints`). */
export interface StateChoices {
  theme?: string | null;
  hints?: boolean | null;
}

export type OptionSource =
  | { kind: "default" }
  | { kind: "init.lua"; at?: ConfigLocation }
  | { kind: "State"; value: unknown };

/** Which option names a State choice stands in for, when init.lua doesn't set them. */
const STATE_KEYS: Record<string, keyof StateChoices> = { theme: "theme", "ui.hints": "hints" };

export function optionSource(config: Config, name: string, state: StateChoices = {}): OptionSource {
  const set = config.set ?? [];
  if (set.some((p) => p === name || p.startsWith(`${name}.`))) {
    const at = config.lines[name];
    return at ? { kind: "init.lua", at } : { kind: "init.lua" };
  }
  const key = STATE_KEYS[name];
  const stored = key ? state[key] : undefined;
  if (stored !== undefined && stored !== null) return { kind: "State", value: stored };
  return { kind: "default" };
}
