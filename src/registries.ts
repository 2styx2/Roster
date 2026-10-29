// The app's registries (ADR 0004), holding the built-ins. The Config (ticket 21) and Plugins
// (ticket 23) register into these same objects; App reads them live.
import { builtinCommandRegistry, type CommandRegistry } from "./commands/table";
import { builtinKeymap, type KeymapRegistry } from "./keymap";
import { builtinSidebarRegistry, type SidebarRegistry } from "./sidebar/sections";

export interface Registries {
  commands: CommandRegistry;
  keymap: KeymapRegistry;
  sidebar: SidebarRegistry;
}

export function builtinRegistries(): Registries {
  return { commands: builtinCommandRegistry(), keymap: builtinKeymap(), sidebar: builtinSidebarRegistry() };
}
