// The command line's commands (`␣ :`), as data: each one either runs a keymap Action or, for
// `connect`, takes a Host name. Completion and parsing are pure; App runs the result.
import type { Action } from "../keymap";

export interface CommandDef {
  name: string;
  help: string;
  /** What it does when it takes no argument. */
  action?: Action;
  /** The argument it takes, completed from the Inventory. */
  arg?: "host";
}

export const commands: readonly CommandDef[] = [
  { name: "connect", arg: "host", help: "Open a Session to HOST" },
  { name: "close", action: "session.close", help: "Close the current Session" },
  { name: "lock", action: "app.lock", help: "Lock the app" },
  { name: "find", action: "picker.open", help: "Find a Host" },
  { name: "keys", action: "keys.toggle", help: "Show or hide the key bindings" },
  { name: "sidebar", action: "sidebar.toggle", help: "Show or hide the Sidebar" },
  { name: "statusbar", action: "statusbar.toggle", help: "Show or hide the status bar" },
];

const byName = new Map(commands.map((c) => [c.name, c]));

/** Complete lines for what's typed so far: command names, then Host names after `connect`. */
export function complete(input: string, hostNames: readonly string[]): string[] {
  const space = input.indexOf(" ");
  if (space < 0) {
    return commands
      .filter((c) => c.name.startsWith(input))
      .map((c) => (c.arg ? `${c.name} ` : c.name))
      .sort();
  }
  const cmd = byName.get(input.slice(0, space));
  if (cmd?.arg !== "host") return [];
  const word = input.slice(space + 1).trimStart().toLowerCase();
  const sorted = [...hostNames].sort();
  const prefix = sorted.filter((h) => h.toLowerCase().startsWith(word));
  const inside = sorted.filter((h) => !h.toLowerCase().startsWith(word) && h.toLowerCase().includes(word));
  return [...prefix, ...inside].map((h) => `${cmd.name} ${h}`);
}

export type Parsed =
  | { kind: "empty" }
  | { kind: "action"; action: Action }
  | { kind: "connect"; host: string }
  | { kind: "error"; message: string };

export function parseCommand(input: string): Parsed {
  const [name, ...rest] = input.trim().split(/\s+/).filter(Boolean);
  if (!name) return { kind: "empty" };
  const cmd = byName.get(name);
  if (!cmd) return { kind: "error", message: `Not a command: ${name}` };
  const arg = rest.join(" ");
  if (cmd.arg === "host") {
    return arg ? { kind: "connect", host: arg } : { kind: "error", message: `${name} needs a Host name` };
  }
  if (arg) return { kind: "error", message: `${name} takes no argument` };
  return cmd.action ? { kind: "action", action: cmd.action } : { kind: "error", message: `Not a command: ${name}` };
}
