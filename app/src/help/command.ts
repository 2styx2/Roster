// `:help [TOPIC]` and the `help` finder (ticket 37), registered through the registries as a Plugin
// would (ADR 0006). HelpView is the help panel's state outside React (like ThemeChoice): which
// page and entry it shows, and the way back. App hands it the live HelpContext each render.
import { matching, type CommandDef } from "../commands/table";
import type { FinderItem, FinderSourceDef } from "../finder/sources";
import type { Registries } from "../registries";
import { BUILTIN } from "../registry";
import { findTopic, topics, type HelpContext, type Topic } from "./pages";

/** Where the help panel is: a page, and the entry or heading on it. */
export interface HelpPlace {
  page: string;
  anchor?: string;
}

export interface HelpSnapshot {
  /** Null while help is closed. */
  at: HelpPlace | null;
  canBack: boolean;
  canForward: boolean;
  /** Counts opens, so opening the same topic again scrolls to it again. */
  seq: number;
}

const place = (t: Topic | HelpPlace): HelpPlace => (t.anchor ? { page: t.page, anchor: t.anchor } : { page: t.page });

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

  /** Shows `to`; the place it leaves is where Ctrl+O goes back to. */
  open(to: Topic | HelpPlace) {
    if (this.snap.at) this.back.push(this.snap.at);
    this.forward = [];
    this.set(place(to));
  }

  /** Opens the topic `query` names; false when there's none. */
  openTopic(query: string): boolean {
    const ctx = this.context();
    const topic = ctx ? findTopic(ctx, query) : undefined;
    if (!topic) return false;
    this.open(topic);
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

/** Registers `:help` and the `help` finder; returns what removes them. */
export function registerHelp(registries: Registries, view: HelpView): () => void {
  const disposers = [registries.commands.register(helpCommand(view)), registries.finders.register(helpFinder(view))];
  return () => disposers.forEach((d) => d());
}
