// Keys and options as plain data tables, so the Lua Config (ADR 0002, ticket 21) can override
// them later without code changes. Chords are written as chordOf() names them: modifiers in the
// order Ctrl, Alt, Meta, Shift, then the key ("Ctrl+Space", "Ctrl+n", "j", "G", "ArrowDown").

export type Action =
  | "picker.open"
  | "picker.down"
  | "picker.up"
  | "picker.choose"
  | "picker.close"
  | "app.lock";

export interface Options {
  /** The chord that takes the keyboard back from a terminal (GLOSSARY: Leader). */
  leader: string;
  /** vim keys (j/k in lists) on or off. */
  vim: boolean;
  /** Lock after this many minutes without input (docs/security.md). */
  idleLockMinutes: number;
}

export interface Keymap {
  /** The key pressed after the Leader. */
  leader: Record<string, Action>;
  /** In the Picker, always. */
  picker: Record<string, Action>;
  /** In the Picker's result list, when vim keys are on. */
  pickerVim: Record<string, Action>;
}

export const defaultOptions: Options = { leader: "Ctrl+Space", vim: true, idleLockMinutes: 15 };

export const defaultKeymap: Keymap = {
  leader: { f: "picker.open", L: "app.lock" },
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
