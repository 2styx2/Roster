# 34: Tab completion everywhere (command line and fuzzy finders)

**Iteration:** 3 · **Repo:** roster (app) · **Issue:** [#49](https://github.com/2styx2/roster/issues/49)

**Why:** Owner request (2026-10-30): Tab completion should work consistently wherever you type, the way a shell or Neovim behaves.

**What to build:**

**Command line (`:`).** Tab already completes commands and some Host names. Make it complete:
- everything: commands and their arguments (Hosts, Folders, groups, themes, finder sources, modes, `:config` subcommands);
- with a visible completion list under the line;
- Tab / Shift+Tab to cycle forward and back, with the longest common prefix filled first, like bash/zsh;
- Ctrl+Y / Enter to accept and Esc to cancel.

Completions come from the command table's `complete` hooks and the registries, so Plugins (T23) get the same behaviour for their commands.

**Fuzzy finders (Picker `␣ f`, `␣ b` and every finder source).**
- Tab moves through the results (down) and Shift+Tab moves back, like Telescope and fzf, alongside the existing arrows, Ctrl+N/P and j/k.
- Typing a prefix that several Hosts share and pressing Tab with an empty selection fills the query with the common part.
- Enter opens the selected result.

Every binding stays in the keymap registry, so `init.lua` can rebind any of them.

**Blocked by:** 07, 21, 22 (done)

**Status:** done (pending owner review)

How it came out (docs/app/keyboard.md "Completion in the command line"):
- A new keymap context, `cmdline` (`keys.cmdline` in init.lua; the Rust core accepts it): `cmdline.next` (Tab, Ctrl+N), `cmdline.prev` (Shift+Tab, Ctrl+P), `cmdline.accept` (Ctrl+Y), `cmdline.run` (Enter), `cmdline.cancel` (Esc). The `picker` context gains `picker.next` (Tab) and `picker.prev` (Shift+Tab), used by the Picker and every finder.
- Tab first fills the longest common prefix of the candidates that start with what's typed (`app/src/ui/completion.ts`), then cycles (wrapping). Enter on a candidate that still needs its argument (`connect `) accepts it instead of running. Esc while cycling goes back to what was typed; a second Esc closes.
- Completion hooks get a `CompletionContext` (Host names, the Sidebar's foldable row ids, the open Sessions), so `fold group:…` and `session N` / `close N` complete too, and a Plugin's hook can use the same data.
- The list is a listbox with `aria-activedescendant` on the input, `aria-setsize` / `aria-posinset` on a windowed list of 8 rows, and an "N above · +N more" count under it. No motion: it's a keyboard action used all day.

- [x] UI tests (`app/src/App.complete.test.tsx`): cycling, common-prefix fill, Shift+Tab, Esc, Ctrl+Y, Enter, a Plugin's command and a Config Theme, rebinding from init.lua, Focus mode, the Picker and a finder in Focus; unit tests in `app/src/ui/completion.test.ts`, `app/src/commands/table.test.ts`, `app/src/config/config.test.ts`, `crates/roster-core/tests/config.rs`.
- [x] The Key bindings panel lists Tab and Shift+Tab (and Ctrl+Y, Esc, Enter) under "Command line" (`keys.cmdline`) and "Picker" (`keys.picker`), with their source.
- [x] Manual check (agent, 2026-10-30): in a browser with the fake backend and in the Windows dev build (`?fixture=few-hosts`, driven over CDP): `:connect es` Tab → `connect esxi-2-00`, Tab / Shift+Tab cycle; `:theme ` Tab Tab → `theme roster-light` with the list showing; `:folder add esxi-2-001 ` Tab → the Folder's name (browser; on Windows no Folder was made, to leave the real State alone); in `␣ f`, `es` Tab fills `esxi-2-00`, then Tab and Shift+Tab move through the results.
