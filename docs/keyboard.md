# Keyboard

Keyboard first, with vim keys and full mouse support. Every binding lives in one keymap. Your `init.lua` (ticket 21) can change the Leader, rebind any key to an action, and turn vim bindings off.

## Two modes

- **Terminal mode:** every key goes to the shell, including Esc, Ctrl+C and Ctrl+W. Only the **Leader** (Ctrl+Space by default) is caught.
- **App mode:** after the Leader, or whenever the Picker, a panel or the command line has focus. Vim bindings apply. Esc goes back to the terminal you came from.

## How keys become actions

Every action is a command in one command table (`src/commands/table.ts`), named as the `:` command line names it. The keymap maps a key, or a sequence such as `d d`, to a command line (`session 1`, `close`), so a binding, a typed `:` command and a button (the Sidebar's rows, the tab strip) all run the same command. View modes (ticket 22) only change how commands are shown. Commands, bindings and Sidebar sections are registries (ADR 0004): each entry carries its source (`builtin`, `init.lua`, or a Plugin), which the Key bindings panel shows.

After the Leader you're in App mode until Esc, or until a command that isn't list movement runs: `␣ ]` switches and hands the keys straight back to the new Session's terminal, while `␣ j` / `␣ k` move the Sidebar's cursor and stay in App mode until Enter (switch) or Esc. An unbound key in App mode is swallowed, never sent to the shell. The Picker, the command line and the bindings filter take their own keys.

## Default bindings (ticket 07)

| Keys | Command | Action |
|---|---|---|
| `<leader> f` | `find` | Open the Picker |
| — | `connect HOST` | Open a Session to HOST |
| In the Picker: Ctrl+Enter | `here HOST` | Open HOST in the current tab if its Session has ended (else a new one) |
| `<leader> r` | `reconnect` | Reconnect the current Session if it has ended or was refused |
| `<leader> ]` / `[` | `next` / `prev` | Next / previous Session (wraps) |
| `<leader> 1`–`9` | `session N` | Go to Session N |
| `<leader> d d` | `close [N]` | Close the current Session (or Session N) |
| `<leader> e` | `sidebar` | Show or hide the Sidebar |
| `<leader> s` | `statusbar` | Show or hide the status bar |
| `<leader> :` | `cmdline` | Command line, with Tab completion for commands and Host names |
| `<leader> ?` | `keys` | Key bindings panel: the resolved keymap, grouped, with each binding's source, filterable |
| `<leader> L` | `lock` | Lock |
| Esc (App mode) | `terminal` | Back to the terminal |
| In the Sidebar (App mode): `j`/`k`, `g g`/`G`, arrows, Home/End, Enter | `down` `up` `top` `bottom` `choose` | Move, jump, switch. `j`/`k`/`g g`/`G` only with vim on |
| In the Picker: Ctrl+N/P, arrow keys | — | Move (they also work with vim off) |
| In the Picker: `j`/`k` | — | Move, once you've moved with Ctrl+N/P or an arrow. Until then letters go to the query, and any other letter goes back to it |
| Terminal: Ctrl+Shift+C/V, select to copy, right-click to paste; Ctrl+Shift+F; Ctrl+= / Ctrl+- / Ctrl+0 | — | Clipboard, find, zoom (ticket 08; the keymap's `terminal` table) |

Later: `<leader> a` (add to a Folder, ticket 17), `<leader> m` (view mode, ticket 22), `<leader> b` (Session finder, ticket 22).

The platform's usual habits apply: ⌘ on macOS, Ctrl on Windows and Linux. Form fields stay ordinary text inputs in v1.
