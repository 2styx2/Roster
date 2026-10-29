// The two focus modes (GLOSSARY, docs/keyboard.md) as a pure state machine over chords.
// Terminal mode: every key goes to the Session's shell, except the Leader, which enters App mode.
// App mode: the keymap applies (the Leader's table, plus list keys for the Sidebar); keys never
// reach the shell. Moving in a list keeps App mode; any other action, and Esc, goes back to the
// terminal. Overlays with their own input (the Picker, the command line, the bindings filter)
// handle their own keys; App counts them as App mode too.
import type { Action, KeyTable, Keymap } from "../keymap";

export interface KeyState {
  mode: "terminal" | "app";
  /** The chords of a sequence typed so far ("d" of "d d"). */
  pending: readonly string[];
}

export const terminalMode: KeyState = { mode: "terminal", pending: [] };
const appMode: KeyState = { mode: "app", pending: [] };

export interface PressContext {
  keymap: Keymap;
  leader: string;
  vim: boolean;
}

export interface PressResult {
  state: KeyState;
  action?: Action;
  /** True when the key is the app's: the caller stops it from reaching anything else. */
  consumed: boolean;
}

/** Actions after which App mode goes on (moving the Sidebar's cursor). */
const STAY_IN_APP: ReadonlySet<Action> = new Set(["list.down", "list.up", "list.top", "list.bottom"]);

/** The tables that apply in App mode, first match wins. */
export function appTables(keymap: Keymap, vim: boolean): KeyTable[] {
  return vim ? [keymap.leader, keymap.list, keymap.listVim] : [keymap.leader, keymap.list];
}

export function press(state: KeyState, chord: string, ctx: PressContext): PressResult {
  if (chord === ctx.leader) return { state: appMode, consumed: true };
  if (state.mode === "terminal") return { state, consumed: false };

  const seq = [...state.pending, chord].join(" ");
  const tables = appTables(ctx.keymap, ctx.vim);
  for (const table of tables) {
    const binding = table[seq];
    if (binding) {
      const next = STAY_IN_APP.has(binding.action) ? appMode : terminalMode;
      return { state: next, action: binding.action, consumed: true };
    }
  }
  const prefix = `${seq} `;
  if (tables.some((t) => Object.keys(t).some((k) => k.startsWith(prefix)))) {
    return { state: { mode: "app", pending: [...state.pending, chord] }, consumed: true };
  }
  return { state: appMode, consumed: true };
}
