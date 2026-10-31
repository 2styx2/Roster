// `:help [TOPIC]` and the `help` finder (ticket 37), registered through the registries as a Plugin
// would (ADR 0006). HelpView is the help panel's state outside React (like ThemeChoice): which
// page and entry it shows, and the way back. App hands it the live HelpContext each render.
import { matching, type CommandDef } from "../commands/table";
import type { FinderItem, FinderSourceDef } from "../finder/sources";
import type { Registries } from "../registries";
import { BUILTIN } from "../registry";
import { plain } from "./doc";
import { findTopic, headingTag, pageBody, pageTexts, topics, type HelpContext, type Topic } from "./pages";

/** Where the help panel is: a page, and the entry or heading on it. */
export interface HelpPlace {
  page: string;
  anchor?: string;
  /** Text to search the page for on arriving (`:help config#the-sandbox /require`, and what
   * `:helpgrep` opens), its first match from the anchor on. */
  search?: string;
}

export interface HelpSnapshot {
  /** Null while help is closed. */
  at: HelpPlace | null;
  canBack: boolean;
  canForward: boolean;
  /** Counts opens, so opening the same topic again scrolls to it again. */
  seq: number;
}

const place = (t: Topic | HelpPlace, search?: string): HelpPlace => ({
  page: t.page,
  ...(t.anchor ? { anchor: t.anchor } : {}),
  ...(search ? { search } : {}),
});

export class HelpView {
  private snap: HelpSnapshot = { at: null, canBack: false, canForward: false, seq: 0 };
  private back: HelpPlace[] = [];
  private forward: HelpPlace[] = [];
  private readonly listeners = new Set<() => void>();
  private ctx: (() => HelpContext) | null = null;

  /** What topics are resolved against: App sets it every render. */
  setContext(ctx: () => HelpContext) {
    this.ctx = ctx;
  }

  context(): HelpContext | null {
    return this.ctx?.() ?? null;
  }

  snapshot = (): HelpSnapshot => this.snap;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Shows `to`, searching it for `search`; the place it leaves is where Ctrl+O goes back to. */
  open(to: Topic | HelpPlace, search?: string) {
    if (this.snap.at) this.back.push(this.snap.at);
    this.forward = [];
    this.set(place(to, search));
  }

  /** Opens the topic `query` names; false when there's none. `TOPIC /TEXT` also searches the
   * page for TEXT, from the topic on. */
  openTopic(query: string): boolean {
    const ctx = this.context();
    const m = /^(.*?)\s+\/(.+)$/.exec(query.trim());
    const topic = ctx ? findTopic(ctx, m ? (m[1] as string) : query) : undefined;
    if (!topic) return false;
    this.open(topic, m?.[2]?.trim());
    return true;
  }

  goBack() {
    const to = this.back.pop();
    if (!to || !this.snap.at) return;
    this.forward.push(this.snap.at);
    this.set(to);
  }

  goForward() {
    const to = this.forward.pop();
    if (!to || !this.snap.at) return;
    this.back.push(this.snap.at);
    this.set(to);
  }

  close() {
    if (!this.snap.at) return;
    this.back = [];
    this.forward = [];
    this.snap = { at: null, canBack: false, canForward: false, seq: this.snap.seq };
    this.changed();
  }

  private set(at: HelpPlace) {
    this.snap = { at, canBack: this.back.length > 0, canForward: this.forward.length > 0, seq: this.snap.seq + 1 };
    this.changed();
  }

  private changed() {
    for (const l of this.listeners) l();
  }
}

export function helpCommand(view: HelpView): CommandDef {
  return {
    id: "help",
    source: BUILTIN,
    area: "App",
    arg: "text",
    optionalArg: true,
    label: (topic) => (topic ? `Help on ${topic}` : "Help: find a topic"),
    run: (ctx, topic) => {
      if (topic === undefined) return ctx.openFinder("help");
      if (!view.openTopic(topic)) ctx.say(`No help for ${topic}. :help alone lists the topics.`);
    },
    complete: (arg) => {
      const ctx = view.context();
      return ctx ? matching(topics(ctx).map((t) => t.tag), arg) : [];
    },
  };
}

/** The topic finder (`␣ ?`): every topic, fuzzy-matched; Enter runs `help TAG`. */
export function helpFinder(view: HelpView): FinderSourceDef {
  return {
    id: "help",
    source: BUILTIN,
    title: "Find a help topic",
    prompt: "Help",
    items: (): FinderItem[] => {
      const ctx = view.context();
      if (!ctx) return [];
      return topics(ctx).map((t) => ({
        id: t.tag,
        label: t.label,
        ...(t.label !== t.tag ? { detail: t.tag } : {}),
        ...(t.path ? { path: t.path } : {}),
        command: `help ${t.tag}`,
      }));
    },
  };
}

/** `:helpgrep [TEXT]`: searches the text of every page (Neovim's `:helpgrep`), in a finder. */
export function helpgrepCommand(): CommandDef {
  return {
    id: "helpgrep",
    source: BUILTIN,
    area: "App",
    arg: "text",
    optionalArg: true,
    label: (text) => (text ? `Search every help page for ${text}` : "Search every help page"),
    run: (ctx, text) => ctx.openFinder("helpgrep", text),
  };
}

/** Up to `width` characters of `text` around its first match of `term`. */
function snippet(text: string, term: string, width = 80): string {
  if (text.length <= width) return text;
  const at = Math.max(0, text.toLowerCase().indexOf(term.toLowerCase()));
  let from = Math.max(0, Math.min(at - 30, text.length - width));
  // Start at a word, not in one.
  if (from > 0) from = text.indexOf(" ", from) + 1 || from;
  return `${from > 0 ? "…" : ""}${text.slice(from, from + width).trim()}${from + width < text.length ? "…" : ""}`;
}

/** The `helpgrep` finder: every paragraph, list item, table row and entry of every page that
 * has all the words typed, as typed (not fuzzy: this is text). Enter opens the page there and
 * searches it for the first word, so n and N go on from there. */
export function helpgrepFinder(view: HelpView): FinderSourceDef {
  const search = (query: string): FinderItem[] => {
    const ctx = view.context();
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!ctx || terms.length === 0) return [];
    const out: FinderItem[] = [];
    const seen = new Set<string>();
    const headings = new Set<string>();
    pageTexts(ctx).forEach((hit, k) => {
      // The index and `all` only repeat other pages' titles and summaries.
      if (hit.page === "index" || hit.page === "all") return;
      const lower = hit.text.toLowerCase();
      if (!terms.every((t) => lower.includes(t))) return;
      const label = snippet(hit.text, terms[0] as string);
      const key = `${hit.tag}\n${label}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ id: `${k}`, label, path: hit.where, command: `help ${hit.tag} /${query.trim().split(/\s+/)[0]}` });
      if (hit.heading) headings.add(`${k}`);
    });
    // A heading that has the words comes first: it's what the text is about.
    return [...out.filter((i) => headings.has(i.id)), ...out.filter((i) => !headings.has(i.id))];
  };
  return {
    id: "helpgrep",
    source: BUILTIN,
    title: "Search every help page",
    prompt: "Help text",
    prose: true,
    empty: "Type words to search every help page.",
    items: () => [],
    search: (_ctx, query) => search(query),
  };
}

/** The `outline` finder (`g O` in help): the open page's headings and entries, in page order. */
export function outlineFinder(view: HelpView): FinderSourceDef {
  return {
    id: "outline",
    source: BUILTIN,
    title: "This help page's outline",
    prompt: "Outline",
    prose: true,
    items: (): FinderItem[] => {
      const ctx = view.context();
      const at = view.snapshot().at;
      if (!ctx || !at) return [];
      const items: FinderItem[] = [];
      // What a heading or entry sits under, as the finder's faint path.
      let section = "";
      let under = "";
      for (const b of pageBody(ctx, at.page)) {
        if (b.t === "h") {
          const tag = b.level === 1 ? at.page : headingTag(at.page, b.anchor);
          if (b.level <= 2) section = b.level === 2 ? plain(b.text) : "";
          items.push({ id: tag, label: plain(b.text), ...(b.level > 2 && section ? { path: section } : {}), command: `help ${tag}` });
          under = b.level === 1 ? "" : plain(b.text);
        } else if (b.t === "defs") {
          for (const d of b.items) {
            if (d.anchor) items.push({ id: d.anchor, label: plain(d.term), ...(under ? { path: under } : {}), command: `help ${d.anchor}` });
          }
        }
      }
      return items;
    },
  };
}

/** Registers `:help`, `:helpgrep` and their finders; returns what removes them. */
export function registerHelp(registries: Registries, view: HelpView): () => void {
  const disposers = [
    registries.commands.register(helpCommand(view)),
    registries.commands.register(helpgrepCommand()),
    registries.finders.register(helpFinder(view)),
    registries.finders.register(helpgrepFinder(view)),
    registries.finders.register(outlineFinder(view)),
  ];
  return () => disposers.forEach((d) => d());
}
