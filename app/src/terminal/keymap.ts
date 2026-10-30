// Ticket 08's keys, as one data block for the keymap (src/keymap.ts merges it in). Kept apart so
// the keyboard model (ticket 07) can take it over as it is, and the Config can override it.

/** Keys caught in a terminal before the shell sees them (Windows Terminal's defaults). */
export type TerminalAction =
  | "terminal.copy"
  | "terminal.paste"
  | "terminal.search"
  | "terminal.zoomIn"
  | "terminal.zoomOut"
  | "terminal.zoomReset";

export type TerminalKeysAction = TerminalAction | "session.reconnect" | "picker.chooseHere";

export const terminalKeys = {
  /** In Terminal mode: these chords never reach the shell. */
  terminal: {
    "Ctrl+Shift+c": "terminal.copy",
    "Ctrl+Shift+v": "terminal.paste",
    "Ctrl+Shift+f": "terminal.search",
    "Ctrl+=": "terminal.zoomIn",
    "Ctrl++": "terminal.zoomIn",
    "Ctrl+Shift++": "terminal.zoomIn",
    "Ctrl+-": "terminal.zoomOut",
    "Ctrl+0": "terminal.zoomReset",
  },
  /** After the Leader: reconnect the current tab when its Session has ended (or was refused). */
  leader: { r: "session.reconnect" },
  /** In the Picker: open the Host in the current tab if its Session has ended. */
  picker: { "Ctrl+Enter": "picker.chooseHere" },
} as const satisfies Record<string, Record<string, TerminalKeysAction>>;
