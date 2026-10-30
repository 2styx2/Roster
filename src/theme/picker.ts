// The Theme picker (ticket 30, decision Q51): `:theme` opens the `themes` finder over every
// registered Theme (bundled, init.lua's, a Plugin's) and previews the one under the cursor live;
// Enter runs `theme ID`, which keeps the choice in the State; Esc reverts. `:theme ID` chooses
// straight away. If init.lua names a Theme (`theme = "nord"`), the Config wins: a choice isn't
// kept, and the finder says to change it there. `theme = "auto"` (the default) leaves the choice
// to the State.
//
// It registers its finder source and command through the registries, as a Plugin would (ADR 0004).
import type { CommandDef } from "../commands/table";
import type { FinderItem, FinderSourceDef } from "../finder/sources";
import type { Registries } from "../registries";
import { BUILTIN } from "../registry";
import type { AppearanceOptions, ThemeRegistry } from "./theme";

/** The State key holding the chosen Theme's id. */
export const THEME_KEY = "theme";

export interface Chosen {
  /** The Theme init.lua names, or null for `theme = "auto"` (or no init.lua). */
  configTheme: string | null;
  /** The State's choice, if it's a registered Theme. */
  stored: string | null;
  /** The Theme the picker is previewing. */
  preview: string | null;
}

/** The appearance with the picker's choice applied: a preview, else init.lua's Theme, else the
 * State's choice, else the Config's (`auto` follows the OS). */
export function chosenAppearance(base: AppearanceOptions, c: Chosen): AppearanceOptions {
  const id = c.preview ?? c.configTheme ?? c.stored;
  return id && id !== base.theme ? { ...base, theme: id } : base;
}

const setInConfig = (id: string) => `The Theme is set in init.lua (theme = "${id}"). Change it there.`;

/** The picker's state outside React: the preview, plus what App tells it (init.lua's Theme and
 * the Theme on screen). The choice itself lives in the State. */
export class ThemeChoice {
  private previewId: string | null = null;
  private configId: string | null = null;
  private activeId = "";
  private readonly listeners = new Set<() => void>();
  private readonly state: { get(key: string): unknown; set(key: string, value: unknown): void };
  readonly themes: Pick<ThemeRegistry, "get" | "list">;

  constructor(
    state: { get(key: string): unknown; set(key: string, value: unknown): void },
    themes: Pick<ThemeRegistry, "get" | "list">,
  ) {
    this.state = state;
    this.themes = themes;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** The Theme being previewed, or null. */
  previewing = (): string | null => this.previewId;

  preview(id: string | null) {
    if (id === this.previewId) return;
    this.previewId = id;
    for (const l of this.listeners) l();
  }

  /** The State's choice, if that Theme is registered. */
  stored(): string | null {
    const id = this.state.get(THEME_KEY);
    return typeof id === "string" && this.themes.get(id) ? id : null;
  }

  /** init.lua's Theme, or null when it says `auto`. */
  configTheme = (): string | null => this.configId;
  setConfigTheme(id: string | null) {
    this.configId = id;
  }

  /** The Theme on screen (where the finder starts). */
  active = (): string => this.activeId;
  setActive(id: string) {
    this.activeId = id;
  }

  /** Keeps `id` in the State; returns what to tell the user ("" when it's done). */
  choose(id: string): string {
    if (!this.themes.get(id)) {
      return `No Theme named ${id} (${this.themes.list().map((t) => t.id).join(", ")})`;
    }
    if (this.configId) return setInConfig(this.configId);
    this.state.set(THEME_KEY, id);
    return "";
  }
}

export function themesFinder(choice: ThemeChoice): FinderSourceDef {
  return {
    id: "themes",
    source: BUILTIN,
    title: "Choose a Theme",
    prompt: "Themes",
    items: () =>
      choice.themes.list().map((t) => ({
        id: `theme:${t.id}`,
        label: t.label,
        // The Theme in use says so, and the finder opens on it: Esc after a preview goes back to it.
        detail: [t.appearance, ...(t.source === BUILTIN ? [] : [t.source]), ...(t.id === choice.active() ? ["current"] : [])].join(" · "),
        command: `theme ${t.id}`,
      })),
    initial: (items) => Math.max(0, items.findIndex((i) => i.command === `theme ${choice.active()}`)),
    move: (item: FinderItem | undefined) => {
      if (item) choice.preview(item.command.slice("theme ".length));
    },
    close: () => choice.preview(null),
    note: () => {
      const id = choice.configTheme();
      return id ? `${setInConfig(id)} This only previews.` : undefined;
    },
  };
}

export function themeCommand(choice: ThemeChoice): CommandDef {
  return {
    id: "theme",
    source: BUILTIN,
    area: "View",
    arg: "text",
    optionalArg: true,
    label: (id) => (id ? `Theme ${choice.themes.get(id)?.label ?? id}` : "Choose a Theme"),
    run: (ctx, id) => {
      if (!id) return ctx.openFinder("themes");
      const message = choice.choose(id);
      if (message) ctx.say(message);
    },
    complete: (arg) =>
      choice.themes
        .list()
        .map((t) => t.id)
        .filter((id) => id.startsWith(arg)),
  };
}

/** Registers the `themes` finder and the `theme` command; returns what removes them. */
export function registerThemePicker(registries: Registries, choice: ThemeChoice): () => void {
  const disposers = [registries.finders.register(themesFinder(choice)), registries.commands.register(themeCommand(choice))];
  return () => disposers.forEach((d) => d());
}
