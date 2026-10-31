// `:help` (ticket 37): the help pages, a Registry (ADR 0006) like commands and Themes, so a Plugin
// (ticket 23) registers its own page the same way the built-ins do. Most built-in pages are
// generated each time they're shown from the live registries (the command table, the keymap,
// Themes, finder sources, the error catalog) and the Config in effect, so they can't go stale; the
// guides are docs/'s Markdown, bundled at build time (guides.ts). The index groups the pages the
// way Neovim's help.txt does (ticket 43, decision Q73): Getting started, Make it yours, Reference,
// Extending.
//
// A topic is what `:help TOPIC` takes and the topic finder lists: a page (`options`), an entry on
// one (`terminal.size`, `:connect`, `E13`, `themes#nord`) or a guide's heading (`config#the-sandbox`).
import { bindingRows } from "../keyboard/bindings";
import { describeLine, type Commands, type CommandDef } from "../commands/table";
import type { Config } from "../config/types";
import type { ErrorRow } from "../errors/catalog";
import type { Problem } from "../errors/classify";
import { searchItems, type FinderSourceDef } from "../finder/sources";
import type { Keymap, Options } from "../keymap";
import { BUILTIN, Registry, type Entry, type Source } from "../registry";
import type { Theme } from "../theme/theme";
import { code, h, keys, link, p, plain, text, type Block, type Inline } from "./doc";
import { configMarkdown, guideLink, guides, PARTS, type Guide } from "./guides";
import { inline, parseMarkdown, withoutDevNotes } from "./markdown";
import { luaValue, optionDocs, optionSource, optionValue, type StateChoices } from "./options";

/** Everything a page is generated from, read when it's shown. */
export interface HelpContext {
  commands: Commands;
  keymap: Keymap;
  options: Options;
  /** The Config in effect (the defaults when there's no init.lua). */
  config: Config;
  /** init.lua's full path, when there's a config dir. */
  configPath: string | null;
  /** The State's `:theme` and `:hints` choices. */
  state: StateChoices;
  /** The Theme on screen. */
  activeTheme: string | null;
  themes: readonly Theme[];
  finders: readonly FinderSourceDef[];
  errors: readonly ErrorRow[];
  /** Every help page, the Plugins' too. */
  pages: readonly HelpPage[];
}

export interface HelpPage extends Entry {
  title: string;
  /** One line, for the index and the topic finder. */
  summary: string;
  /** Lower comes first in the index. The built-ins use 0–100. */
  order: number;
  /** The index's group: "Getting started", "Make it yours", "Reference" or "Extending". A page
   * without one (a Plugin's) is listed under its source. */
  part?: string;
  /** Other names that find it or a place on it (`init.lua` → `config`), as tag → topic. */
  aliases?: Record<string, string>;
  body(ctx: HelpContext): Block[];
}

export type HelpRegistry = Registry<HelpPage>;

/** What helpContext reads from the registries. */
interface HelpRegistries {
  commands: { get(id: string): CommandDef | undefined; list(): readonly CommandDef[] };
  themes: { list(): readonly Theme[] };
  finders: { list(): readonly FinderSourceDef[] };
  errors: { list(): readonly ErrorRow[] };
  help: { list(): readonly HelpPage[] };
}

export function helpContext(
  r: HelpRegistries,
  live: Pick<HelpContext, "keymap" | "options" | "config" | "configPath" | "state" | "activeTheme">,
): HelpContext {
  return {
    ...live,
    commands: { get: (id) => r.commands.get(id), list: () => r.commands.list() },
    themes: r.themes.list(),
    finders: r.finders.list(),
    errors: r.errors.list(),
    pages: [...r.help.list()].sort((a, b) => a.order - b.order),
  };
}

// ---------- Topics ----------

export interface Topic {
  /** What `:help` takes: `options`, `terminal.size`, `config#the-sandbox`. */
  tag: string;
  page: string;
  /** The entry or heading on the page; none for the page itself. */
  anchor?: string;
  /** What the topic finder shows. */
  label: string;
  /** The page's title, for an entry on it. */
  path?: string;
  /** A page, a heading on one, an entry (an option, a command, an error…), or another name. */
  kind: "page" | "heading" | "entry" | "alias";
}

/** A page's blocks; an unknown page gives none. */
export function pageBody(ctx: HelpContext, id: string): Block[] {
  return ctx.pages.find((pg) => pg.id === id)?.body(ctx) ?? [];
}

/** Every topic: each page, then what's on it, then the aliases. Tags are unique, ignoring case:
 * the first wins, and the others are `clashes` (lint.test.ts fails CI on any). */
export function topicIndex(ctx: HelpContext): { topics: Topic[]; clashes: Topic[] } {
  const out: Topic[] = [];
  const clashes: Topic[] = [];
  const seen = new Set<string>();
  const add = (t: Topic) => {
    if (seen.has(t.tag.toLowerCase())) return void clashes.push(t);
    seen.add(t.tag.toLowerCase());
    out.push(t);
  };
  for (const pg of ctx.pages) add({ tag: pg.id, page: pg.id, label: pg.title, kind: "page" });
  for (const pg of ctx.pages) {
    for (const b of pg.body(ctx)) {
      if (b.t === "h" && b.level > 1) {
        const tag = headingTag(pg.id, b.anchor);
        add({ tag, page: pg.id, anchor: tag, label: plain(b.text), path: pg.title, kind: "heading" });
      } else if (b.t === "defs") {
        for (const d of b.items) {
          if (d.anchor) add({ tag: d.anchor, page: pg.id, anchor: d.anchor, label: d.anchor, path: plain(d.body).slice(0, 80) || pg.title, kind: "entry" });
        }
      } else if (b.t === "table" && b.anchors) {
        for (const a of b.anchors) if (a) add({ tag: a, page: pg.id, anchor: a, label: a, path: pg.title, kind: "entry" });
      }
    }
  }
  for (const pg of ctx.pages) {
    for (const [alias, to] of Object.entries(pg.aliases ?? {})) {
      const target = out.find((t) => t.tag === to);
      if (target) add({ ...target, tag: alias, label: alias, path: target.label, kind: "alias" });
      else clashes.push({ tag: alias, page: pg.id, label: `${alias} → ${to}, which isn't a topic`, kind: "alias" });
    }
  }
  return { topics: out, clashes };
}

/** A heading's topic: its anchor, which a page may write whole (`commands#hosts`) or as a slug. */
export const headingTag = (page: string, anchor: string): string => (anchor.includes("#") ? anchor : `${page}#${anchor}`);

/** Every topic (topicIndex's). */
export function topics(ctx: HelpContext): Topic[] {
  return topicIndex(ctx).topics;
}

/** The topic `:help QUERY` opens: a tag (any case), else `:QUERY` (a command), else the best
 * fuzzy match by the topic finder's scoring. */
export function findTopic(ctx: HelpContext, query: string): Topic | undefined {
  const q = query.trim();
  if (!q) return undefined;
  const all = topics(ctx);
  const exact = (tag: string) => all.find((t) => t.tag.toLowerCase() === tag.toLowerCase());
  const found = exact(q) ?? exact(`:${q.replace(/^:/, "")}`);
  if (found) return found;
  const items = all.map((t) => ({ id: t.tag, label: t.label, detail: t.tag, ...(t.path ? { path: t.path } : {}), command: "" }));
  const best = searchItems(items, q)[0];
  return best ? all.find((t) => t.tag === best.id) : undefined;
}

/** Where a link goes: a topic (the help panel opens it), a file in the repo that isn't bundled
 * (`file:examples/init.lua`), or a web address. Guides' links are already topics (guideLink). */
export function linkKind(href: string): "topic" | "file" | "web" {
  if (href.startsWith("file:")) return "file";
  if (/^[a-z]+:/i.test(href) && !href.startsWith(":")) return "web";
  return "topic";
}

/** A block's searchable text, with the topic of the place it's in: its own entry, else the
 * heading above it, else the page. What `:helpgrep` searches. */
export interface TextHit {
  page: string;
  /** The topic to open: an entry, a heading or the page. */
  tag: string;
  /** Where it is, for the finder: "Your init.lua › The sandbox". */
  where: string;
  text: string;
}

export function pageTexts(ctx: HelpContext): TextHit[] {
  const out: TextHit[] = [];
  for (const pg of ctx.pages) {
    let tag = pg.id;
    let where = pg.title;
    const push = (text: string, at = tag, place = where) => {
      const t = text.replace(/\s+/g, " ").trim();
      if (t) out.push({ page: pg.id, tag: at, where: place, text: t });
    };
    for (const b of pg.body(ctx)) {
      switch (b.t) {
        case "h":
          if (b.level > 1) {
            tag = headingTag(pg.id, b.anchor);
            where = `${pg.title} › ${plain(b.text)}`;
          }
          push(plain(b.text));
          break;
        case "p":
        case "quote":
          push(plain(b.text));
          break;
        case "list":
          for (const item of b.items) push(plain(item));
          break;
        case "pre":
          for (const line of b.text.split("\n")) push(line);
          break;
        case "table":
          b.rows.forEach((row, r) => push(row.map(plain).join(" · "), b.anchors?.[r] ?? tag));
          break;
        case "defs":
          for (const d of b.items) push(`${plain(d.term)} ${plain(d.meta)} ${plain(d.body)}`, d.anchor ?? tag);
          break;
      }
    }
  }
  return out;
}

// ---------- The built-in pages ----------

const SAMPLE: Problem = { code: 0 as Problem["code"], host: "HOST", message: "", details: "" };

/** A command's argument, as the docs write it: `HOST`, `N`, `[ARG]`. */
function argOf(c: CommandDef): string {
  if (!c.arg) return "";
  const word = c.arg === "host" ? "HOST" : c.arg === "number" ? "N" : "ARG";
  return c.optionalArg ? ` [${word}]` : ` ${word}`;
}

/** The keys bound to command `id` (any argument): after the Leader, and global ones. */
function keysFor(keymap: Keymap, id: string): string[] {
  const first = (action: string) => action.split(" ")[0];
  return [
    ...Object.entries(keymap.leader)
      .filter(([k, b]) => first(b.action) === id && k !== "Escape")
      .map(([k]) => `␣ ${k}`),
    ...Object.entries(keymap.global)
      .filter(([, b]) => first(b.action) === id)
      .map(([k]) => k),
  ];
}

const sourceText = (s: Source): Inline => text(s === BUILTIN ? "builtin" : s);

function commandsPage(ctx: HelpContext): Block[] {
  const byArea = new Map<string, CommandDef[]>();
  for (const c of ctx.commands.list()) byArea.set(c.area, [...(byArea.get(c.area) ?? []), c]);
  return [
    h(1, "Commands", "commands"),
    p(
      "Every action is a command in one table: a key, a typed ",
      code(":"),
      " line and a button all run the same one. Press ",
      keys("␣ :"),
      " for the command line; Tab completes. The Config and Plugins add commands here too, so this list is what's registered now.",
    ),
    ...[...byArea].flatMap(([area, list]): Block[] => [
      h(2, area, `commands#${area.toLowerCase()}`),
      {
        t: "defs",
        items: list.map((c) => ({
          anchor: `:${c.id}`,
          term: [code(`:${c.id}${argOf(c)}`)],
          meta: [...keysFor(ctx.keymap, c.id).map(keys), ...(c.source === BUILTIN ? [] : [sourceText(c.source)])],
          body: [text(c.label())],
        })),
      },
    ]),
  ];
}

function keysPage(ctx: HelpContext): Block[] {
  const rows = bindingRows(ctx.keymap, ctx.options, ctx.commands);
  const byArea = new Map<string, typeof rows>();
  for (const r of rows) byArea.set(r.area, [...(byArea.get(r.area) ?? []), r]);
  return [
    h(1, "Key bindings", "keys"),
    p(
      "The keymap in effect: the built-in bindings with init.lua's (and later Plugins') over them. ",
      keys("␣"),
      " is the Leader, ",
      code(ctx.options.leader),
      " now. Each row says its option in init.lua; ",
      link("keyboard", "Keyboard"),
      " explains the two modes, and ",
      link(":keys", [code(":keys")]),
      " shows the same table as a panel you can filter.",
    ),
    ...[...byArea].flatMap(([area, list]): Block[] => [
      h(2, area, `keys#${area.toLowerCase().replace(/\s+/g, "-")}`),
      {
        t: "table",
        head: [[text("Keys")], [text("What it does")], [text("Option")], [text("From")]],
        rows: list.map((r) => [r.keys.map(keys), [text(r.label)], r.options.map(code), [sourceText(r.source)]]),
      },
    ]),
  ];
}

function optionsPage(ctx: HelpContext): Block[] {
  const docs = optionDocs(withoutDevNotes(configMarkdown));
  const bySection = new Map<string, typeof docs>();
  for (const d of docs) bySection.set(d.section, [...(bySection.get(d.section) ?? []), d]);
  const where = (name: string): Inline[] => {
    const s = optionSource(ctx.config, name, ctx.state);
    if (s.kind === "init.lua") return [code(s.at ? `${s.at.file}:${s.at.line}` : "init.lua")];
    if (s.kind === "State") {
      if (name !== "theme") return [text("State (:hints)")];
      return [text(s.over ? `State (:theme, over ${s.over.file}:${s.over.line})` : "State (:theme)")];
    }
    return [text("default")];
  };
  const valueOf = (name: string): string => {
    const s = optionSource(ctx.config, name, ctx.state);
    return luaValue(s.kind === "State" ? s.value : optionValue(ctx.config, name));
  };
  return [
    h(1, "Options", "options"),
    p(
      "Every option init.lua takes, with the value in effect now and where it came from: ",
      code("default"),
      ", ",
      code("init.lua"),
      " (with its line), or the State (a choice ",
      code(":theme"),
      " or ",
      code(":hints"),
      " keeps when init.lua leaves it to them, or one ",
      code(":theme"),
      " made over init.lua's own). ",
      code(":config"),
      " opens init.lua",
      ...(ctx.configPath ? [text(" ("), code(ctx.configPath), text(")")] : []),
      "; ",
      code(":source"),
      " applies it. The descriptions are ",
      link("config#options", "the Config guide's"),
      ".",
    ),
    ...[...bySection].flatMap(([section, list]): Block[] => [
      h(2, section, `options#${section.toLowerCase().replace(/\s+/g, "-")}`),
      {
        t: "defs",
        items: list.map((d) => ({
          // An option named like a page (`keys`, `themes`) is `'keys'`, as Neovim writes options:
          // `:help keys` is the page.
          anchor: ctx.pages.some((pg) => pg.id === d.name) ? `'${d.name}'` : d.name,
          term: [code(d.name)],
          meta: [code(valueOf(d.name)), ...where(d.name)],
          body: [...fixLinks(configGuide, d.about), ...(d.about.length ? [text(". ")] : []), text("Default: "), ...fixLinks(configGuide, d.default)],
        })),
      },
    ]),
  ];
}

function themesPage(ctx: HelpContext): Block[] {
  return [
    h(1, "Themes", "themes"),
    p(
      "Every registered Theme: the bundled ones, init.lua's and Plugins'. ",
      code(":theme"),
      " picks one with a live preview and keeps it; ",
      code('theme = "<id>"'),
      " in init.lua sets the one to start with, until ",
      code(":theme"),
      " chooses another (it wins again when you change that line). ",
      link("themes-guide", "The Themes guide"),
      " lists the tokens.",
    ),
    {
      t: "defs",
      items: ctx.themes.map((th) => ({
        anchor: `themes#${th.id}`,
        term: [code(th.id)],
        meta: [
          text(th.appearance),
          ...(th.source === BUILTIN ? [] : [sourceText(th.source)]),
          ...(th.id === ctx.activeTheme ? [text("in use")] : []),
        ],
        body: [text(`${th.label}. `), code(`:theme ${th.id}`)],
      })),
    },
  ];
}

function findersPage(ctx: HelpContext): Block[] {
  return [
    h(1, "Finders", "finders"),
    p(
      "A finder is a fuzzy list over one source; Enter runs the item's command, Esc closes. ",
      code(":finder SOURCE"),
      " opens one. Type to filter; Tab first fills in what the matches share.",
    ),
    {
      t: "defs",
      items: ctx.finders.map((f) => ({
        anchor: `finders#${f.id}`,
        term: [code(`:finder ${f.id}`)],
        meta: [...keysForLine(ctx.keymap, `finder ${f.id}`).map(keys), ...(f.source === BUILTIN ? [] : [sourceText(f.source)])],
        body: [text(f.title)],
      })),
    },
  ];
}

/** The keys bound to exactly `line` after the Leader. */
function keysForLine(keymap: Keymap, line: string): string[] {
  return Object.entries(keymap.leader)
    .filter(([, b]) => b.action === line)
    .map(([k]) => `␣ ${k}`);
}

function errorsPage(ctx: HelpContext): Block[] {
  return [
    h(1, "Connection errors", "errors"),
    p(
      "Every way opening a Session can fail, as the app knows them: where the problem lives and the fix it offers. ",
      code(":check HOST"),
      " runs the same diagnostics on demand. ",
      link("errors-guide", "The errors guide"),
      " has each one's message and cause.",
    ),
    {
      t: "defs",
      items: ctx.errors.map((e) => ({
        anchor: e.row !== null ? `E${e.row}` : `errors#${e.id}`,
        term: e.row !== null ? [code(`E${e.row}`), text(` ${e.id}`)] : [code(e.id)],
        meta: [text(e.where.join(", ")), ...(e.source === BUILTIN ? [] : [sourceText(e.source)])],
        // The fixes are written with `code` in them, as the error panel shows them.
        body: [...inline(e.fix(SAMPLE)), ...(e.actions.length ? [text(` Offers: ${e.actions.map((a) => a.label).join(", ")}.`)] : [])],
      })),
    },
  ];
}

function indexPage(ctx: HelpContext): Block[] {
  const listed = ctx.pages.filter((pg) => pg.id !== "index");
  const groups = new Map<string, HelpPage[]>();
  for (const part of PARTS) groups.set(part, []);
  for (const pg of listed) {
    const group = pg.part ?? (pg.source === BUILTIN ? "Reference" : `From ${pg.source}`);
    groups.set(group, [...(groups.get(group) ?? []), pg]);
  }
  return [
    h(1, "roster help", "index"),
    p(
      "New to roster? Start with ",
      link("start", "Getting started"),
      ". To follow a link, Tab to it and press Enter, or click it. Try it here: ",
      link("help#links", [code("links")]),
      ". ",
      keys("Ctrl+o"),
      " comes back.",
    ),
    p(
      code(":help TOPIC"),
      " opens a page or an entry on one (",
      link("terminal.size", [code("terminal.size")]),
      ", ",
      link(":connect", [code(":connect")]),
      ", ",
      link("E13", [code("E13")]),
      "); ",
      keys("␣ ?"),
      " finds a topic and ",
      code(":helpgrep TEXT"),
      " searches every page. The pages that list commands, keys, options, Themes, finders and errors are made from what the app has now, so they always match it.",
    ),
    ...[...groups].flatMap(([group, pages]): Block[] =>
      pages.length
        ? [
            h(2, group, `index#${group.toLowerCase().replace(/\s+/g, "-")}`),
            {
              t: "defs",
              items: pages.map((pg) => ({
                term: [link(pg.id, [code(pg.id)])],
                meta: pg.source === BUILTIN ? [] : [sourceText(pg.source)],
                body: [link(pg.id, pg.title), text(`: ${pg.summary}`)],
              })),
            },
          ]
        : [],
    ),
    h(2, "Moving around", "index#moving-around"),
    helpKeysTable(),
  ];
}

/** Help's own keys, on the index and the quick reference. */
function helpKeysTable(): Block {
  return {
    t: "table",
    head: [[text("Keys")], [text("What it does")]],
    rows: [
      [[keys("Tab"), keys("↵")], [text("Next link, follow it ("), keys("Ctrl+]"), text(" follows it too)")]],
      [[keys("Ctrl+o"), keys("Ctrl+i")], [text("Back, forward")]],
      [[keys("j"), keys("k"), keys("↓"), keys("↑")], [text("Scroll (j and k with vim keys on)")]],
      [[keys("Ctrl+d"), keys("Ctrl+u")], [text("Half a page down, up")]],
      [[keys("g g"), keys("G")], [text("Top, bottom")]],
      [[keys("g O")], [text("The outline: this page's headings and entries")]],
      [[keys("/"), keys("n"), keys("N")], [text("Search this page; next, previous match")]],
      [[keys("?")], [text("Find a topic")]],
      [[code(":helpgrep TEXT")], [text("Search every page")]],
      [[keys("Esc")], [text("Close help, back where you were")]],
    ],
  };
}

/** The quick reference: the commands you'll use most, by area, with their keys now. */
const QUICKREF: readonly (readonly [string, readonly string[]])[] = [
  ["Hosts", ["find", "connect", "quick", "check", "edit", "host add", "review"]],
  ["Sessions", ["next", "prev", "session", "close", "reconnect", "finder sessions"]],
  ["View", ["sidebar", "statusbar", "mode", "focus", "finder tree"]],
  ["Pending changes", ["changes", "publish", "discard"]],
  ["Make it yours", ["config", "source", "theme", "hints", "keys"]],
  ["Help", ["help", "helpgrep"]],
];

/** The keys bound to `line`, or to it with an argument (`session` → `␣ 1` … `␣ 9`). */
function keysForCommandLine(keymap: Keymap, line: string): string[] {
  const hit = (action: string) => action === line || action.startsWith(`${line} `);
  return [
    ...Object.entries(keymap.leader)
      .filter(([k, b]) => hit(b.action) && k !== "Escape")
      .map(([k]) => `␣ ${k}`),
    ...Object.entries(keymap.global)
      .filter(([, b]) => hit(b.action))
      .map(([k]) => k),
  ];
}

function quickrefPage(ctx: HelpContext): Block[] {
  return [
    h(1, "Quick reference", "quickref"),
    p(
      "The commands you'll use most, with the keys they have now. ",
      keys("␣"),
      " is the Leader (",
      code(ctx.options.leader),
      "). Every command is in ",
      link("commands", "Commands"),
      " and every key in ",
      link("keys", "Key bindings"),
      ".",
    ),
    ...QUICKREF.flatMap(([area, lines]): Block[] => {
      const rows = lines.flatMap((line): Inline[][][] => {
        const id = line.split(" ")[0] as string;
        const c = ctx.commands.get(id);
        if (!c) return [];
        const bound = keysForCommandLine(ctx.keymap, line);
        const shown = bound.length > 3 ? [keys(bound[0] as string), text("…"), keys(bound[bound.length - 1] as string)] : bound.map(keys);
        const arg = line === id ? argOf(c) : "";
        return [[shown, [link(`:${id}`, [code(`:${line}${arg}`)])], [text(describeLine(ctx.commands, line).label)]]];
      });
      return rows.length
        ? [h(2, area, `quickref#${area.toLowerCase().replace(/\s+/g, "-")}`), { t: "table", head: [[text("Keys")], [text("Command")], [text("What it does")]], rows }]
        : [];
    }),
    h(2, "In help", "quickref#in-help"),
    helpKeysTable(),
  ];
}

/** Every topic in one list, by kind, A to Z: Neovim's index.txt, for when you'd rather read
 * than search. */
function allPage(ctx: HelpContext): Block[] {
  const all = topicIndex({ ...ctx, pages: ctx.pages.filter((pg) => pg.id !== "all") }).topics;
  const sorted = (list: Topic[]) => [...list].sort((a, b) => a.tag.localeCompare(b.tag, "en", { numeric: true }));
  const pageTitle = (id: string) => ctx.pages.find((pg) => pg.id === id)?.title ?? id;
  const entries = all.filter((t) => t.kind === "entry");
  const kinds: [string, string, Topic[]][] = [
    ["Pages", "pages", all.filter((t) => t.kind === "page")],
    ["Commands", "commands", entries.filter((t) => t.page === "commands")],
    ["Options", "options", entries.filter((t) => t.page === "options")],
    ["Errors", "errors", entries.filter((t) => t.page === "errors")],
    ["Themes and finders", "themes-and-finders", entries.filter((t) => t.page === "themes" || t.page === "finders")],
    ["Other entries", "other-entries", entries.filter((t) => !["commands", "options", "errors", "themes", "finders"].includes(t.page))],
    ["Other names", "other-names", all.filter((t) => t.kind === "alias")],
  ];
  const keyRows = bindingRows(ctx.keymap, ctx.options, ctx.commands);
  return [
    h(1, "Every topic", "all"),
    p(
      "Every page, command, key, option and error, A to Z, each a link. Guide sections are in each page's outline (",
      keys("g O"),
      "), and ",
      code(":helpgrep TEXT"),
      " searches all of the text.",
    ),
    ...kinds.flatMap(([title, slug, list]): Block[] =>
      list.length
        ? [
            h(2, title, `all#${slug}`),
            {
              t: "table",
              head: [[text("Topic")], [text("What")]],
              rows: sorted(list).map((t) => [
                [link(t.tag, [code(t.tag)])],
                [text(t.anchor ? (t.path && t.path !== pageTitle(t.page) ? t.path : pageTitle(t.page)) : t.label)],
              ]),
            },
          ]
        : [],
    ),
    h(2, "Keys", "all#keys"),
    {
      t: "table",
      head: [[text("Keys")], [text("What it does")], [text("Where")]],
      rows: keyRows.map((r) => [r.keys.map(keys), [text(r.label)], [text(r.area)]]),
    },
  ];
}

const guideCache = new Map<string, Block[]>();
const configGuide = guides.find((g) => g.id === "config") as Guide;

/** A guide's inlines with its links made help links (guideLink). */
function fixLinks(guide: Guide, inlines: readonly Inline[]): Inline[] {
  return inlines.map((i): Inline => {
    if (i.t === "link") return { ...i, href: guideLink(guide, i.href), children: fixLinks(guide, i.children) };
    if (i.t === "strong" || i.t === "em") return { ...i, children: fixLinks(guide, i.children) };
    return i;
  });
}

/** A guide's blocks: its notes for developers left out, its anchors made topics
 * (`config#the-sandbox`) and its links help links (guideLink). */
function guideBlocks(guide: Guide): Block[] {
  const cached = guideCache.get(guide.id);
  if (cached) return cached;
  const fix = (inlines: Inline[]) => fixLinks(guide, inlines);
  const blocks = parseMarkdown(withoutDevNotes(guide.markdown)).map((b): Block => {
    switch (b.t) {
      case "h":
        return { ...b, text: fix(b.text), anchor: `${guide.id}#${b.anchor}` };
      case "p":
      case "quote":
        return { ...b, text: fix(b.text) };
      case "list":
        return { ...b, items: b.items.map(fix) };
      case "table":
        return { ...b, head: b.head.map(fix), rows: b.rows.map((r) => r.map(fix)) };
      default:
        return b;
    }
  });
  guideCache.set(guide.id, blocks);
  return blocks;
}

const page = (id: string, order: number, part: string, title: string, summary: string, body: (ctx: HelpContext) => Block[], aliases?: Record<string, string>): HelpPage => ({
  id,
  source: BUILTIN,
  order,
  part,
  title,
  summary,
  body,
  ...(aliases ? { aliases } : {}),
});

export const builtinHelpPages: readonly HelpPage[] = [
  page("index", 0, "Getting started", "roster help", "Where to start", indexPage),
  page("quickref", 40, "Reference", "Quick reference", "The commands you'll use most, with their keys now", quickrefPage, { qr: "quickref", cheatsheet: "quickref" }),
  page("commands", 50, "Reference", "Commands", "Every command, with its keys and where it comes from", commandsPage),
  page("keys", 51, "Reference", "Key bindings", "The keymap in effect, with each binding's option and source", keysPage),
  page("options", 52, "Reference", "Options", "Every init.lua option, its value now and where it was set", optionsPage),
  page("themes", 53, "Reference", "Themes", "The registered Themes, and the one in use", themesPage),
  page("finders", 54, "Reference", "Finders", "The finder sources: Sessions, Hosts, the tree, Themes, help topics…", findersPage),
  page("errors", 60, "Reference", "Connection errors", "The error catalog: where each problem lives and its fix", errorsPage),
  page("all", 90, "Reference", "Every topic", "Every page, command, key, option and error, A to Z", allPage, { "help-index": "all" }),
  ...guides.map((g) => page(g.id, g.order, g.part, g.title, g.summary, () => guideBlocks(g), g.aliases)),
];

export function builtinHelpRegistry(): HelpRegistry {
  const registry = new Registry<HelpPage>();
  for (const pg of builtinHelpPages) registry.register(pg);
  return registry;
}

