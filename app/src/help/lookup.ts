// Help from where you are (ticket 52): Neovim looks up the word under the cursor (`K`, `Ctrl+]`);
// roster has no cursor in its text, so the lookup keys ask what you're on instead: the command
// being typed (`Ctrl+]` and F1 in the command line), the selected result (F1 in a finder or the
// Picker), the selected Sidebar row (`:lookup`, ␣ F1), or a binding's option (F1 in the Key
// bindings panel). Each gives a topic for `:help`, which may end in ` /TEXT` to search the page.
import type { Commands } from "../commands/table";
import type { FinderItem, FinderSourceDef } from "../finder/sources";

/** The command a line runs, or starts to name: `conn` → `connect`. */
function commandOf(commands: Commands, line: string): string | null {
  const word = line.trim().split(/\s+/)[0] ?? "";
  if (!word) return null;
  const exact = commands.get(word);
  if (exact) return exact.id;
  const prefixed = commands
    .list()
    .filter((c) => c.id.startsWith(word))
    .sort((a, b) => a.id.length - b.id.length || a.id.localeCompare(b.id));
  return prefixed[0]?.id ?? null;
}

/** The command line's topic: the command typed (`:connect`), the commands page for an empty
 * line, null for something that names no command. */
export function lineTopic(commands: Commands, line: string): string | null {
  if (!line.trim()) return "commands";
  const id = commandOf(commands, line);
  return id ? `:${id}` : null;
}

/** A finder result's topic: the source's own (`themes#nord`), a help result's topic itself, else
 * the entry of the command Enter would run. */
export function itemTopic(commands: Commands, source: Pick<FinderSourceDef, "help">, item: FinderItem): string | null {
  const own = source.help?.(item);
  if (own) return own;
  const help = /^help\s+(.+)$/.exec(item.command.trim());
  if (help) return help[1] as string;
  return lineTopic(commands, item.command);
}

/** A Key bindings row's option (`leader`, `keys.cmdline`): its own topic when it has one, else
 * the `'keys'` option searched for the context. */
export function optionTopic(option: string, tags: ReadonlySet<string>): string {
  if (tags.has(option)) return option;
  const context = /^keys\.(\w+)$/.exec(option)?.[1];
  return context ? `'keys' /${context}` : option;
}
