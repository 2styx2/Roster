# Keyboard

Keyboard first, with vim keys and full mouse support. Every binding lives in one keymap. Your `init.lua` (ticket 21) can change the Leader, rebind any key to an action, and turn vim bindings off.

## Two modes

- **Terminal mode:** every key goes to the shell, including Esc, Ctrl+C and Ctrl+W. Only the **Leader** (Ctrl+Space by default) is caught.
- **App mode:** after the Leader, or whenever the Picker, a panel or the command line has focus. Vim bindings apply. Esc goes back to the terminal you came from.

## Default bindings (draft; ticket 07 decides the final set)

| Keys | Action |
|---|---|
| `<leader> f` | Open the Picker |
| `<leader> :` | Command line (`:connect HOST`, `:lock`, `:info`, `:publish`, `:open SERVICE`, `:close`) |
| `<leader> 1`–`9` | Go to tab N |
| `<leader> gt` / `gT` | Next / previous tab |
| `<leader> dd` | Close the current tab |
| `<leader> e` | Toggle the Sidebar (Sessions, Folders, Inventory) |
| `<leader> ]` / `[` | Next / previous Session |
| `<leader> a` | Add the selected Host to a Folder |
| `<leader> s` | Toggle the status bar |
| `<leader> ?` | Key bindings panel: the resolved keymap and where each binding comes from (default or init.lua) |
| `<leader> L` | Lock |
| In lists: `j`/`k`, `gg`/`G`, `/`, `h`/`l`, Enter, Esc | Move, jump, filter, fold/unfold, open, back |
| In the Picker: Ctrl+N/P, arrow keys | Move (they also work with vim off) |
| In the Picker: `j`/`k` | Move, once you've moved with Ctrl+N/P or an arrow. Until then letters go to the query, and any other letter goes back to it |
| Terminal: Ctrl+Shift+C/V, select to copy, right-click to paste | Clipboard |

The platform's usual habits apply: ⌘ on macOS, Ctrl on Windows and Linux. Form fields stay ordinary text inputs in v1.
