// The hand-written guides, bundled from docs/app at build time (ticket 37). The Markdown in
// docs/app is the one copy: Vite reads it as text (`?raw`) when the app is built, so a guide in
// the app is always the docs of the commit it was built from, and there's nothing to copy by
// hand. options.ts reads config.md's option tables the same way, and help.test.ts fails CI when
// an option in the core's schema isn't in them (or one in them isn't in the schema).
import config from "../../../docs/app/config.md?raw";
import errors from "../../../docs/app/errors.md?raw";
import help from "../../../docs/app/help.md?raw";
import keyboard from "../../../docs/app/keyboard.md?raw";
import themes from "../../../docs/app/themes.md?raw";

export interface Guide {
  /** The help topic, and what `[…](<file>)` links in the other guides go to. */
  id: string;
  file: string;
  title: string;
  markdown: string;
}

export const guides: readonly Guide[] = [
  { id: "help", file: "help.md", title: "Help: :help", markdown: help },
  { id: "config", file: "config.md", title: "The Config: init.lua", markdown: config },
  { id: "keyboard", file: "keyboard.md", title: "Keyboard", markdown: keyboard },
  { id: "themes-guide", file: "themes.md", title: "Themes: the bundled ones and their tokens", markdown: themes },
  { id: "errors-guide", file: "errors.md", title: "Connection errors: every way a Session can fail", markdown: errors },
];

export const configMarkdown = config;
