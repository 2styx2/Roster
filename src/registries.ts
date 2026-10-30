// The app's registries (ADR 0004), holding the built-ins. The Config (ticket 21) and Plugins
// (ticket 23) register into these same objects; App reads them live.
import { builtinCommandRegistry, type CommandRegistry } from "./commands/table";
import { builtinErrorRegistry, type ErrorRegistry } from "./errors/catalog";
import { finderCommand } from "./finder/command";
import { builtinFinderRegistry, type FinderRegistry } from "./finder/sources";
import { builtinKeymap, type KeymapRegistry } from "./keymap";
import { builtinSidebarRegistry, type SidebarRegistry } from "./sidebar/sections";

export interface Registries {
  commands: CommandRegistry;
  keymap: KeymapRegistry;
  sidebar: SidebarRegistry;
  /** The connection-error catalog (docs/errors.md), ticket 26. */
  errors: ErrorRegistry;
  /** What the Finder overlay searches (ticket 22): Sessions, Hosts, the Sidebar's tree. */
  finders: FinderRegistry;
}

export function builtinRegistries(): Registries {
  const finders = builtinFinderRegistry();
  const commands = builtinCommandRegistry();
  commands.register(finderCommand(finders));
  return { commands, keymap: builtinKeymap(), sidebar: builtinSidebarRegistry(), errors: builtinErrorRegistry(), finders };
}
