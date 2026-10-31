// The app's registries (ADR 0006), holding the built-ins. The Config (ticket 21) and Plugins
// (ticket 23) register into these same objects; App reads them live.
import { builtinCommandRegistry, type CommandRegistry } from "./commands/table";
import { builtinErrorRegistry, type ErrorRegistry } from "./errors/catalog";
import { finderCommand } from "./finder/command";
import { builtinHelpRegistry, type HelpRegistry } from "./help/pages";
import { builtinHealthRegistry, type HealthRegistry } from "./health/health";
import { folderRegistry, type FolderRegistry } from "./folders/folders";
import { builtinFinderRegistry, type FinderRegistry } from "./finder/sources";
import { reloaderRegistry, sourceCommands, type ReloaderRegistry } from "./config/source";
import { builtinKeymap, type KeymapRegistry } from "./keymap";
import { builtinSidebarRegistry, type SidebarRegistry } from "./sidebar/sections";
import { builtinToolbarRegistry, type ToolbarRegistry } from "./chrome/toolbar";
import type { ThemeRegistry } from "./theme/theme";
import { builtinThemeRegistry } from "./theme/themes";

export interface Registries {
  commands: CommandRegistry;
  keymap: KeymapRegistry;
  sidebar: SidebarRegistry;
  /** The connection-error catalog (docs/app/errors.md), ticket 26. */
  errors: ErrorRegistry;
  /** Themes (GLOSSARY): the bundled ones, ticket 09; the Config and Plugins add more. */
  themes: ThemeRegistry;
  /** What the Finder overlay searches (ticket 22): Sessions, Hosts, the Sidebar's tree. */
  finders: FinderRegistry;
  /** Folders defined in init.lua (ticket 21) or by Plugins: read-only in the app. The Folders
   * made in the app live in the State. */
  folders: FolderRegistry;
  /** What `:source` reloads (decision Q58): init.lua; ticket 28 adds folders.yml and roster.yml. */
  reloaders: ReloaderRegistry;
  /** The toolbar's controls (decision Q65): the built-ins, and what Plugins add. */
  toolbar: ToolbarRegistry;
  /** `:help`'s pages (ticket 37): generated from the registries above, plus the guides. */
  help: HelpRegistry;
  /** `:check`'s sections with no Host (ticket 49): roster's, the app's, and what Plugins add. */
  health: HealthRegistry;
}

export function builtinRegistries(): Registries {
  const finders = builtinFinderRegistry();
  const commands = builtinCommandRegistry();
  commands.register(finderCommand(finders));
  const reloaders = reloaderRegistry();
  for (const c of sourceCommands(reloaders)) commands.register(c);
  return {
    commands,
    keymap: builtinKeymap(),
    sidebar: builtinSidebarRegistry(),
    errors: builtinErrorRegistry(),
    themes: builtinThemeRegistry(),
    finders,
    folders: folderRegistry(),
    reloaders,
    toolbar: builtinToolbarRegistry(),
    help: builtinHelpRegistry(),
    health: builtinHealthRegistry(),
  };
}
