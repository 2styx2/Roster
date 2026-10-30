// `:help` (ticket 37): the help pages, a Registry (ADR 0006) like commands and Themes, so a Plugin
// (ticket 23) registers its own page the same way the built-ins do. Most built-in pages are
// generated each time they're shown from the live registries (the command table, the keymap,
// Themes, finder sources, the error catalog) and the Config in effect, so they can't go stale; the
// guides are docs/app's Markdown, bundled at build time (guides.ts).
//
// A topic is what `:help TOPIC` takes and the topic finder lists: a page (`options`), an entry on
// one (`terminal.size`, `:connect`, `E13`, `themes#nord`) or a guide's heading (`config#the-sandbox`).
import { bindingRows } from "../keyboard/bindings";
import type { Commands, CommandDef } from "../commands/table";
import type { Config } from "../config/types";
import type { ErrorRow } from "../errors/catalog";
import type { Problem } from "../errors/classify";
import { searchItems, type FinderSourceDef } from "../finder/sources";
import type { Keymap, Options } from "../keymap";
import { BUILTIN, Registry, type Entry, type Source } from "../registry";
import type { Theme } from "../theme/theme";
import { code, h, keys, link, p, plain, text, type Block, type Inline } from "./doc";
import { configMarkdown, guides } from "./guides";
import { inline, parseMarkdown } from "./markdown";
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
}

/** A page's blocks; an unknown page gives none. */
export function pageBody(ctx: HelpContext, id: string): Block[] {
  return ctx.pages.find((pg) => pg.id === id)?.body(ctx) ?? [];
}

/** Every topic: each page, then what's on it. Tags are unique (the first wins). */
export function topics(ctx: HelpContext): Topic[] {
  const out: Topic[] = [];
  const seen = new Set<string>();
  const add = (t: Topic) => {
    if (seen.has(t.tag.toLowerCase())) return;
    seen.add(t.tag.toLowerCase());
    out.push(t);
  };
  for (const pg of ctx.pages) add({ tag: pg.id, page: pg.id, label: pg.title });
  for (const pg of ctx.pages) {
    for (const b of pg.body(ctx)) {
      if (b.t === "h" && b.level > 1) {
        add({ tag: `${pg.id}#${b.anchor}`, page: pg.id, anchor: `${pg.id}#${b.anchor}`, label: plain(b.text), path: pg.title });
      } else if (b.t === "defs") {
        for (const d of b.items) {
          if (d.anchor) add({ tag: d.anchor, page: pg.id, anchor: d.anchor, label: d.anchor, path: plain(d.body).slice(0, 80) || pg.title });
        }
      } else if (b.t === "table" && b.anchors) {
        for (const a of b.anchors) if (a) add({ tag: a, page: pg.id, anchor: a, label: a, path: pg.title });
      }
    }
  }
  for (const pg of ctx.pages) {
    for (const [alias, to] of Object.entries(pg.aliases ?? {})) {
      const target = out.find((t) => t.tag === to);
      if (target) add({ ...target, tag: alias, label: alias, path: target.label });
    }
  }
  return out;
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

/** Where a link goes: a topic, or a guide's Markdown file (`keyboard.md#two-modes`); null when
 * it's neither (a file that isn't bundled). */
export function linkTarget(href: string): string | null {
  const m = /^(?:\.\/)?([\w-]+\.md)(?:#(.*))?$/.exec(href);
  if (!m) return /[/:]\/|\.\w+$|\//.test(href) && !href.startsWith(":") ? null : href;
  const guide = guides.find((g) => g.file === m[1]);
  if (!guide) return null;
  return m[2] ? `${guide.id}#${m[2]}` : guide.id;
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
  const docs = optionDocs(configMarkdown);
  const bySection = new Map<string, typeof docs>();
  for (const d of docs) bySection.set(d.section, [...(bySection.get(d.section) ?? []), d]);
  const where = (name: string): Inline[] => {
    const s = optionSource(ctx.config, name, ctx.state);
    if (s.kind === "init.lua") return [code(s.at ? `${s.at.file}:${s.at.line}` : "init.lua")];
    if (s.kind === "State") return [text(name === "theme" ? "State (:theme)" : "State (:hints)")];
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
      " keeps when init.lua leaves it to them). ",
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
          anchor: d.name,
          term: [code(d.name)],
          meta: [code(valueOf(d.name)), ...where(d.name)],
          body: [...d.about, ...(d.about.length ? [text(". ")] : []), text("Default: "), ...d.default],
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
      " picks one with a live preview; ",
      code('theme = "<id>"'),
      " in init.lua sets it for good. ",
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
  return [
    h(1, "roster help", "index"),
    p(
      "Built-in docs, like Neovim's ",
      code(":help"),
      ". ",
      code(":help TOPIC"),
      " opens a page or an entry on one (",
      link("terminal.size", [code("terminal.size")]),
      ", ",
      link(":connect", [code(":connect")]),
      ", ",
      link("E13", [code("E13")]),
      "); ",
      keys("␣ ?"),
      " or ",
      code(":help"),
      " alone finds a topic. The pages that list commands, keys, options, Themes, finders and errors are made from what the app has now, so they always match it.",
    ),
    {
      t: "defs",
      items: ctx.pages
        .filter((pg) => pg.id !== "index")
        .map((pg) => ({
          term: [link(pg.id, [code(pg.id)])],
          meta: pg.source === BUILTIN ? [] : [sourceText(pg.source)],
          body: [text(pg.summary)],
        })),
    },
    h(2, "Moving around", "index#moving-around"),
    {
      t: "table",
      head: [[text("Keys")], [text("What it does")]],
      rows: [
        [[keys("j"), keys("k"), keys("↓"), keys("↑")], [text("Scroll (j and k with vim keys on)")]],
        [[keys("Ctrl+d"), keys("Ctrl+u")], [text("Half a page down, up")]],
        [[keys("g g"), keys("G")], [text("Top, bottom")]],
        [[keys("Tab"), keys("↵")], [text("Next link, follow it")]],
        [[keys("Ctrl+o"), keys("Ctrl+i")], [text("Back, forward")]],
        [[keys("/"), keys("n"), keys("N")], [text("Search this page; next, previous match")]],
        [[keys("?")], [text("Find a topic")]],
        [[keys("Esc")], [text("Close help, back where you were")]],
      ],
    },
  ];
}

const guideCache = new Map<string, Block[]>();

/** A guide's blocks, its anchors made topics (`config#the-sandbox`) and its links help links. */
function guideBlocks(id: string, markdown: string): Block[] {
  const cached = guideCache.get(id);
  if (cached) return cached;
  const fix = (inlines: Inline[]): Inline[] =>
    inlines.flatMap((i): Inline[] => {
      if (i.t === "link") {
        const to = linkTarget(i.href.startsWith("#") ? `${guides.find((g) => g.id === id)?.file}${i.href}` : i.href);
        return to ? [{ ...i, href: to, children: fix(i.children) }] : fix(i.children);
      }
      if (i.t === "strong" || i.t === "em") return [{ ...i, children: fix(i.children) }];
      return [i];
    });
  const blocks = parseMarkdown(markdown).map((b): Block => {
    switch (b.t) {
      case "h":
        return { ...b, text: fix(b.text) };
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
  guideCache.set(id, blocks);
  return blocks;
}

const page = (id: string, order: number, title: string, summary: string, body: (ctx: HelpContext) => Block[], aliases?: Record<string, string>): HelpPage => ({
  id,
  source: BUILTIN,
  order,
  title,
  summary,
  body,
  ...(aliases ? { aliases } : {}),
});

const SUMMARIES: Record<string, string> = {
  config: "How init.lua works: where it lives, :config and :source, errors, the sandbox, the roster table, folders.yml",
  keyboard: "The Leader, Terminal mode and App mode, the default bindings, copy and paste, completion, view modes",
  "themes-guide": "The bundled Themes, their colour tokens, and making your own",
  "errors-guide": "Every connection error: what happened, the cause, where it lives, the fix",
  help: "This help: topics, links, search, and how a Plugin adds a page",
};

const ALIASES: Record<string, Record<string, string>> = {
  config: { "init.lua": "config", "folders.yml": "config#foldersyml", sandbox: "config#the-sandbox" },
  keyboard: { leader: "keyboard#two-modes" },
};

export const builtinHelpPages: readonly HelpPage[] = [
  page("index", 0, "roster help", "Where to start", indexPage),
  page("commands", 10, "Commands", "Every command, with its keys and where it comes from", commandsPage),
  page("keys", 11, "Key bindings", "The keymap in effect, with each binding's option and source", keysPage),
  page("options", 12, "Options", "Every init.lua option, its value now and where it was set", optionsPage),
  page("themes", 13, "Themes", "The registered Themes, and the one in use", themesPage),
  page("finders", 14, "Finders", "The finder sources: Sessions, Hosts, the tree, Themes, help topics…", findersPage),
  page("errors", 15, "Connection errors", "The error catalog: where each problem lives and its fix", errorsPage),
  ...guides.map((g, k) =>
    page(g.id, 50 + k, g.title, SUMMARIES[g.id] ?? g.title, () => guideBlocks(g.id, g.markdown), ALIASES[g.id]),
  ),
];

export function builtinHelpRegistry(): HelpRegistry {
  const registry = new Registry<HelpPage>();
  for (const pg of builtinHelpPages) registry.register(pg);
  return registry;
}

