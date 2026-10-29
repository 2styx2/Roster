// The one command table (ticket 07, decision Q36): every app action is a command here, its id
// being its `:` command-line name. It's a Registry (ADR 0004): built-ins register as "builtin",
// and the Config and Plugins can add or shadow commands the same way. Keys (the keymap maps a key to a command line such as
// "session 1"), the command line and buttons (the Sidebar, the tab strip) all run commands
// through runLine, so a view mode only changes how commands are presented, never which exist.
// A command acts through CommandContext, which App provides.

import { BUILTIN, Registry, type Entry } from "../registry";

export type ListMove = "down" | "up" | "top" | "bottom" | "choose";

/** What commands can ask of the app. */
export interface CommandContext {
  openPicker(): void;
  /** Opens a Session to the Host (the app checks it exists and is reviewed). */
  connect(host: string): void;
  /** The Session `delta` places after the current one, wrapping. */
  selectRelative(delta: number): void;
  /** The Nth Session, counting from 1. */
  selectNth(n: number): void;
  /** Closes the Nth Session, or the current one. */
  close(n: number | null): void;
  toggleSidebar(): void;
  toggleStatusBar(): void;
  openCommandLine(): void;
  toggleKeys(): void;
  lock(): void;
  /** Back to Terminal mode. */
  toTerminal(): void;
  /** Moves the list cursor (the Sidebar in Standard), or chooses the row under it. */
  list(move: ListMove): void;
  /** A one-line message for the user. */
  say(message: string): void;
}

export interface CommandDef extends Entry {
  /** id: the `:` name, and what the keymap binds keys to. */
  area: string;
  /** What it does, for the Key bindings panel and completion. */
  label(arg?: string): string;
  arg?: "host" | "number";
  /** The argument may be left out. */
  optionalArg?: boolean;
  /** App mode goes on after it (moving a list); otherwise keys go back to the terminal. */
  staysInAppMode?: boolean;
  run(ctx: CommandContext, arg: string | undefined): void;
}

const list = (move: ListMove, label: string): CommandDef => ({
  id: move,
  source: BUILTIN,
  area: "Sidebar",
  label: () => label,
  staysInAppMode: move !== "choose",
  run: (ctx) => ctx.list(move),
});

export const builtinCommands: readonly CommandDef[] = [
  { id: "find", source: BUILTIN, area: "Hosts", label: () => "Find a Host", run: (ctx) => ctx.openPicker() },
  {
    id: "connect",
    source: BUILTIN,
    area: "Hosts",
    arg: "host",
    label: (h) => (h ? `Connect to ${h}` : "Open a Session to a Host"),
    run: (ctx, h) => ctx.connect(h ?? ""),
  },
  { id: "next", source: BUILTIN, area: "Sessions", label: () => "Next Session", run: (ctx) => ctx.selectRelative(1) },
  { id: "prev", source: BUILTIN, area: "Sessions", label: () => "Previous Session", run: (ctx) => ctx.selectRelative(-1) },
  {
    id: "session",
    source: BUILTIN,
    area: "Sessions",
    arg: "number",
    label: (n) => `Go to Session ${n ?? "N"}`,
    run: (ctx, n) => ctx.selectNth(Number(n)),
  },
  {
    id: "close",
    source: BUILTIN,
    area: "Sessions",
    arg: "number",
    optionalArg: true,
    label: (n) => (n ? `Close Session ${n}` : "Close the Session"),
    run: (ctx, n) => ctx.close(n === undefined ? null : Number(n)),
  },
  { id: "sidebar", source: BUILTIN, area: "Sidebar", label: () => "Show or hide the Sidebar", run: (ctx) => ctx.toggleSidebar() },
  list("down", "Move down"),
  list("up", "Move up"),
  list("top", "Go to the top"),
  list("bottom", "Go to the bottom"),
  list("choose", "Switch to it"),
  { id: "cmdline", source: BUILTIN, area: "App", label: () => "Command line", run: (ctx) => ctx.openCommandLine() },
  { id: "keys", source: BUILTIN, area: "App", label: () => "Key bindings", run: (ctx) => ctx.toggleKeys() },
  { id: "statusbar", source: BUILTIN, area: "App", label: () => "Show or hide the status bar", run: (ctx) => ctx.toggleStatusBar() },
  { id: "lock", source: BUILTIN, area: "App", label: () => "Lock", run: (ctx) => ctx.lock() },
  { id: "terminal", source: BUILTIN, area: "App", label: () => "Back to the terminal", run: (ctx) => ctx.toTerminal() },
];

export type CommandRegistry = Registry<CommandDef>;

/** What the functions below need of the registry. */
export type Commands = Pick<CommandRegistry, "get" | "list">;

/** A command registry holding the built-in commands. */
export function builtinCommandRegistry(): CommandRegistry {
  const registry = new Registry<CommandDef>();
  for (const c of builtinCommands) registry.register(c);
  return registry;
}

export type ParsedLine =
  | { kind: "empty" }
  | { kind: "ok"; command: CommandDef; arg: string | undefined }
  | { kind: "error"; message: string };

export function parseLine(commands: Commands, line: string): ParsedLine {
  const [name, ...rest] = line.trim().split(/\s+/).filter(Boolean);
  if (!name) return { kind: "empty" };
  const command = commands.get(name);
  if (!command) return { kind: "error", message: `Not a command: ${name}` };
  const arg = rest.length ? rest.join(" ") : undefined;
  if (!command.arg) {
    return arg === undefined ? { kind: "ok", command, arg } : { kind: "error", message: `${name} takes no argument` };
  }
  if (arg === undefined) {
    if (command.optionalArg) return { kind: "ok", command, arg };
    return { kind: "error", message: `${name} needs ${command.arg === "host" ? "a Host name" : "a number"}` };
  }
  if (command.arg === "number" && !/^[1-9]\d*$/.test(arg)) {
    return { kind: "error", message: `${name} needs a number` };
  }
  return { kind: "ok", command, arg };
}

/** Runs a command line; a bad one is said, not thrown. Returns the command that ran. */
export function runLine(commands: Commands, ctx: CommandContext, line: string): CommandDef | undefined {
  const parsed = parseLine(commands, line);
  if (parsed.kind === "error") ctx.say(parsed.message);
  if (parsed.kind !== "ok") return undefined;
  parsed.command.run(ctx, parsed.arg);
  return parsed.command;
}

/** Area and label of a command line (for the Key bindings panel). */
export function describeLine(commands: Commands, line: string): { area: string; label: string } {
  const parsed = parseLine(commands, line);
  if (parsed.kind !== "ok") return { area: "Other", label: `${line} (not a command)` };
  return { area: parsed.command.area, label: parsed.command.label(parsed.arg) };
}

/** Complete lines for what's typed so far: command names, then Host names after `connect`. */
export function complete(commands: Commands, input: string, hostNames: readonly string[]): string[] {
  const space = input.indexOf(" ");
  if (space < 0) {
    return commands
      .list()
      .filter((c) => c.id.startsWith(input))
      .map((c) => (c.arg && !c.optionalArg ? `${c.id} ` : c.id))
      .sort();
  }
  const command = commands.get(input.slice(0, space));
  if (command?.arg !== "host") return [];
  const word = input.slice(space + 1).trimStart().toLowerCase();
  const sorted = [...hostNames].sort();
  const lower = (h: string) => h.toLowerCase();
  const prefix = sorted.filter((h) => lower(h).startsWith(word));
  const inside = sorted.filter((h) => !lower(h).startsWith(word) && lower(h).includes(word));
  return [...prefix, ...inside].map((h) => `${command.id} ${h}`);
}
