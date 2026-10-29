// Keys and options as plain data tables, so the Lua Config (ADR 0002, ticket 21) can override
// them later without code changes. Chords are written as chordOf() names them: modifiers in the
// order Ctrl, Alt, Meta, Shift, then the key ("Ctrl+Space", "Ctrl+n", "j", "G", "ArrowDown").
// A sequence is chords separated by spaces ("d d", "g g").

type Digit = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";

export type Action =
  | "picker.open"
  | "picker.down"
  | "picker.up"
  | "picker.choose"
  | "picker.close"
  | "session.next"
  | "session.prev"
  | `session.goto.${Digit}`
  | "session.close"
  | "sidebar.toggle"
  | "statusbar.toggle"
  | "cmdline.open"
  | "keys.toggle"
  | "app.lock"
  | "mode.terminal"
  | "list.down"
  | "list.up"
  | "list.top"
  | "list.bottom"
  | "list.choose";

/** Where a binding (or option) came from: the built-in defaults or the user's Config. */
export type Source = "default" | "init.lua";

export interface Binding {
  action: Action;
  source: Source;
}

/** Key (or sequence) → binding. */
export type KeyTable = Record<string, Binding>;

export interface Keymap {
  /** App mode (GLOSSARY): the keys after the Leader, until Esc or an action takes you back. */
  leader: KeyTable;
  /** App mode, in a list (the Sidebar), always. */
  list: KeyTable;
  /** App mode, in a list, when vim keys are on. */
  listVim: KeyTable;
  /** In the Picker, always. */
  picker: KeyTable;
  /** In the Picker's result list, when vim keys are on. */
  pickerVim: KeyTable;
}

export type KeymapContext = keyof Keymap;

/** What the Config hands over: per context, a key → action, or null to unbind a default. */
export type KeymapOverrides = Partial<Record<KeymapContext, Record<string, Action | null>>>;

export interface Options {
  /** The chord that takes the keyboard back from a terminal (GLOSSARY: Leader). */
  leader: string;
  /** vim keys (j/k in lists) on or off. */
  vim: boolean;
  /** The Sidebar (GLOSSARY): shown at start, and on which side. `␣ e` toggles it. */
  sidebar: { visible: boolean; side: "left" | "right" };
  /** Open Sessions listed in the Sidebar (the default) or in a basic tab strip. */
  sessions: "sidebar" | "tabs";
  /** The status bar, shown at start. `␣ s` toggles it. */
  statusBar: { visible: boolean };
}

export const defaultOptions: Options = {
  leader: "Ctrl+Space",
  vim: true,
  sidebar: { visible: true, side: "left" },
  sessions: "sidebar",
  statusBar: { visible: true },
};

const digits: Digit[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

export const defaultBindings: Record<KeymapContext, Record<string, Action>> = {
  leader: {
    f: "picker.open",
    "]": "session.next",
    "[": "session.prev",
    ...Object.fromEntries(digits.map((d) => [d, `session.goto.${d}` as const])),
    "d d": "session.close",
    e: "sidebar.toggle",
    s: "statusbar.toggle",
    ":": "cmdline.open",
    "?": "keys.toggle",
    L: "app.lock",
    Escape: "mode.terminal",
  },
  list: {
    ArrowDown: "list.down",
    ArrowUp: "list.up",
    Home: "list.top",
    End: "list.bottom",
    Enter: "list.choose",
  },
  listVim: { j: "list.down", k: "list.up", "g g": "list.top", G: "list.bottom" },
  picker: {
    ArrowDown: "picker.down",
    ArrowUp: "picker.up",
    "Ctrl+n": "picker.down",
    "Ctrl+p": "picker.up",
    Enter: "picker.choose",
    Escape: "picker.close",
  },
  pickerVim: { j: "picker.down", k: "picker.up" },
};

function tag(table: Record<string, Action>, source: Source): KeyTable {
  return Object.fromEntries(Object.entries(table).map(([k, action]) => [k, { action, source }]));
}

/** The defaults with the Config's bindings layered over them (ticket 21 passes those in). */
export function resolveKeymap(overrides: KeymapOverrides = {}): Keymap {
  const out = {} as Keymap;
  for (const context of Object.keys(defaultBindings) as KeymapContext[]) {
    const table = new Map(Object.entries(tag(defaultBindings[context], "default")));
    for (const [key, action] of Object.entries(overrides[context] ?? {})) {
      if (action === null) table.delete(key);
      else table.set(key, { action, source: "init.lua" });
    }
    out[context] = Object.fromEntries(table);
  }
  return out;
}

export const defaultKeymap: Keymap = resolveKeymap();

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/** The keymap name of a key event. */
export function chordOf(e: KeyLike): string {
  const key = e.key === " " ? "Space" : e.key;
  const printable = key.length === 1;
  const withMods = e.ctrlKey || e.altKey || e.metaKey;
  const mods = [
    e.ctrlKey && "Ctrl",
    e.altKey && "Alt",
    e.metaKey && "Meta",
    e.shiftKey && (withMods || !printable) && "Shift",
  ].filter(Boolean);
  const name = printable && withMods ? key.toLowerCase() : key;
  return [...mods, name].join("+");
}
