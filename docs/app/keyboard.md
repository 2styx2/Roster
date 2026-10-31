# Keyboard

Keyboard first, with vim keys and full mouse support. Every binding lives in one keymap. Your `init.lua` ([docs/app/config.md](config.md)) can change the Leader, rebind any key to an action (`keys = { leader = { t = "next" } }`), and turn vim bindings off.

## Two modes

- **Terminal mode:** every key goes to the shell, including Esc, Ctrl+C and Ctrl+W. Only the **Leader** (Ctrl+Space by default), the keymap's `global` keys (F11) and its `terminal` keys (copy, paste, find, zoom; below) are caught. Ctrl+C is caught only while text is selected, as in Windows Terminal.
- **App mode:** after the Leader, or whenever the Picker, a panel or the command line has focus. Vim bindings apply. Esc goes back to the terminal you came from.

## How keys become actions

Every action is a command in one command table (`app/src/commands/table.ts`), named as the `:` command line names it. The keymap maps a key, or a sequence such as `d d`, to a command line (`session 1`, `close`), so a binding, a typed `:` command and a button (the Sidebar's rows, the tab strip) all run the same command. View modes (ticket 22) only change how commands are shown. Commands, bindings and Sidebar sections are registries (ADR 0006): each entry carries its source (`builtin`, `init.lua`, or a Plugin), which the Key bindings panel shows.

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
| `<leader> e` | `sidebar` | Show or hide the Sidebar, in Standard and Focus; also the Sidebar button at the left of the title bar. The State keeps the choice per mode unless `init.lua` sets `modes.<mode>.sidebar`, which wins (issue #54) |
| `<leader> t` | `finder tree` | The Sidebar's tree (Folders and the Inventory) as a finder |
| `<leader> s` | `statusbar` | Show or hide the status bar, and say the option that keeps it |
| `<leader> :` | `cmdline` | Command line, with Tab completion for commands and their arguments (see below) |
| `<leader> ?` | `help [TOPIC]` | Help, like Neovim's `:help` (ticket 37): with no topic, the topic finder; `:help terminal.size`, `:help :connect`, `:help E13` open a page at that entry. Tab completes topics. See [help.md](help.md) |
| `<leader> K` | `keys` | Key bindings panel: the resolved keymap, grouped, with each binding's source and its option in `init.lua` (`keys.leader`), filterable |
| `<leader> L` | `lock` | Lock |
| `<leader> E` | `edit [HOST]` | Edit the Host under the cursor, or the current Session's (ticket 10). Enter saves, Esc closes |
| `<leader> +`, `<leader> n` | `host add [GROUP]` | Add a Host (ticket 11), in GROUP or the cursor's group (also the `+` always shown on the Inventory heading, which starts in the cursor's group, and the `+` on a group heading). On a roster too old to add Hosts (API 6) the Inventory's `+` stays and says so, in its tooltip and when clicked: the form tests a Login first (host key confirmed, one login), then saves; Enter adds, Esc closes |
| `<leader> D` | `host remove [HOST]` | Remove the Host under the cursor from `roster.yml` (ticket 28), after a question that names it; its vault item stays. Also the × on its row |
| `<leader> R` | `host rename [HOST [NEW]]` | Rename a Host; what's left out, the command line asks for. Also the ✎ on its row |
| `<leader> M` | `host move [HOST [GROUP]]` | Move a Host to another group (Tab completes the groups). Also: drag it onto another group |
| `<leader> N` | `group new [NAME]` | Add an empty group. Also "New group" on the Inventory heading. `group rename [GROUP [NEW]]` and `group delete [GROUP [TO]]` have no key: the ✎ and × on a group heading run them; deleting a group with Hosts asks which group they go to |
| (no key) | `review [HOST]` | Mark an unreviewed Host reviewed, so it can be opened; also the ✓ button on its Sidebar row, Ctrl+R in the Picker, and "Mark reviewed" in `:edit` |
| (no key) | `host unreview [HOST]` (`unreview`) | Mark a reviewed Host unreviewed again (`reviewed: false`), for a review made by mistake, as a Pending change (API 9). While the review is still only a Pending change, the row's ↶ button (where the ✓ was) takes it back, leaving `roster.yml` as it was; `:discard` drops it with the rest. Also "Mark unreviewed" in `:edit`. `host review [HOST]` is `review` |
| `<leader> c` | `changes` | Show the Pending changes (the diff of `roster.yml`); `:discard` asks, then discards them; `:publish` shows the diff and the commit message (edit it; `Ctrl+Enter` publishes, `Esc` goes back) |
| `<leader> m` | `mode [standard\|focus]` | Switch the view mode (no argument: the other one) |
| F11 (any mode, no Leader) | `focus` | Focus on or off |
| `<leader> b` | `finder sessions` | Find a Session (the Finder over the `sessions` source) |
| — | `finder SOURCE` | The Finder over a finder source: `sessions`, `hosts`, `tree` (Folders and Inventory), `folders`, `inventory`. Enter runs the item's command, Esc closes; the Picker's keys move |
| Esc (App mode) | `terminal` | Back to the terminal, closing the topmost side panel (Key bindings, `:check`) if one is open |
| — | `hidepanel` | Close the topmost side panel (bind it in `init.lua`) |
| — | `hints [on\|off\|toggle]` | Show or hide every keycap hint (no word: toggle). The choice is kept in the State unless `init.lua` sets `ui.hints`, which wins ([config.md](config.md)). Hidden hints only go out of sight: every binding still works |
| — | `info` | Say the Backend, the Box and the Inventory's path whole (the status bar cuts them) |
| `<leader> S` | `source [PATH]` (`so`) | Reload the Config now, Neovim-style: `init.lua` and its modules; with PATH, only the file that owns it. Saving doesn't reload unless `auto_reload = true` (decision Q58) |
| — | `config [reload\|path]` | Open `init.lua` (made from the commented-out example the first time, never overwritten), read it again, or say where it is (ticket 32, [config.md](config.md)) |
| In the Sidebar (App mode): `j`/`k`, `g g`/`G`, arrows, Home/End, Enter | `down` `up` `top` `bottom` `choose` | Move, jump, choose: a Session switches, a Host opens (or goes to its Session), a group, Folder or heading folds and you stay in the Sidebar. `j`/`k`/`g g`/`G` only with vim on |
| In the Sidebar: `h` / `l`, ← / → | `fold` / `unfold` | Fold the row (or go to its parent); unfold it (or go to its first child). `h`/`l` only with vim on |
| — | `fold ID` / `unfold ID` / `togglefold ID` | Fold a row or section by id: `section:sessions`, `section:folders`, `section:inventory`, `group:subnet-42`, `folder:Lab ESXi`. A click on a heading, group or Folder runs `togglefold`. What's folded is kept in State |
| — | `open HOST` | Go to HOST's open Session, or open one (what a Host row in the tree runs) |
| `<leader> a` | `folder add` | Add the Host under the cursor (or on screen) to a Folder: opens the command line at `folder add HOST ` for the Folder's name (Tab completes; a new name creates the Folder) |
| `<leader> A` | `folder remove` | Remove the Host under the cursor from its Folder |
| — | `folder new NAME`, `folder rename NAME NEW`, `folder delete NAME`, `folder add HOST NAME`, `folder remove HOST NAME` | Folders (GLOSSARY), kept in State. Names may have spaces; quote one (`"Lab ESXi"`) only where it would be ambiguous. Without a name, `new` and `rename` open the command line for it |
| In the Picker: Ctrl+N/P, arrow keys | — | Move (they also work with vim off) |
| In the Picker and every finder: Tab / Shift+Tab | `picker.next` / `picker.prev` | Next / previous result, wrapping. Before you've moved, Tab first fills the query with what the matching names share (`es` → `esxi-0` when `esxi-01` and `esxi-02` match), as a shell does |
| In the Picker: `j`/`k` | — | Move, once you've moved with Ctrl+N/P or an arrow. Until then letters go to the query, and any other letter goes back to it |
| Terminal: Ctrl+Shift+C/V, Ctrl+Insert / Shift+Insert, Ctrl+C with a selection, select to copy, right-click; Ctrl+Shift+F; Ctrl+= / Ctrl+- / Ctrl+0 | — | Clipboard, find, zoom (ticket 08; the keymap's `terminal` table; see "Copy and paste" below) |

## Copy and paste

In a terminal, as in Windows Terminal. These are the keymap's `terminal` table (`keys.terminal` in `init.lua`), so each can be moved or unbound, and the Key bindings panel (`␣ K`) lists them:

| Keys | Action | What it does |
|---|---|---|
| Ctrl+Shift+C, Ctrl+Insert | `terminal.copy` | Copy the selection |
| Ctrl+C | `terminal.copyIfSelected` | With a selection: copy it and clear it. Without one, Ctrl+C goes to the shell as usual (its interrupt) |
| Ctrl+Shift+V, Shift+Insert | `terminal.paste` | Paste |
| Select with the mouse | (`terminal.copy_on_select`) | Copies the selection, unless `copy_on_select = false` |
| Right-click | (`terminal.right_click_paste`) | Copies the selection and clears it, or pastes when nothing is selected |

Ctrl+V is the shell's (`quoted-insert`, Vim's block selection). To paste with it anyway: `keys = { terminal = { ["Ctrl+v"] = "terminal.paste" } }`. A paste goes to the shell as xterm.js sends it: each line end as Enter, and the whole paste between bracketed-paste marks when the shell asked for them (bash, zsh, fish and Vim do), so several lines land in the prompt instead of running one by one. What's copied or pasted goes only between the clipboard and the terminal, never into a log or the State ([security.md](security.md)).

In every text field (the lock screen, the command line, the Picker and finders, the bindings filter, the add and edit forms) the usual editing keys belong to the field: Ctrl+C / Ctrl+X / Ctrl+V, Ctrl+Insert / Shift+Insert, Ctrl+A, Ctrl+Z / Ctrl+Shift+Z. The keymap never takes them there, and right-click shows the WebView's own Cut / Copy / Paste menu. The release build reads and writes the clipboard through Tauri's clipboard plugin (`clipboard-manager:allow-read-text` and `allow-write-text` in `app/src-tauri/capabilities/default.json`), since WebView2 won't let the page read it.

## Completion in the command line (ticket 34)

The command line completes like bash or zsh, and like Neovim's wildmenu. The candidates for what's typed show in a list above the line: command names (with what each does and its key), then each command's arguments: Hosts (`connect`, `open`, `edit`, `check`, `review`), Folders (`folder add HOST `), Themes, finder sources, view modes, `:config`'s subcommands, `:source`'s files, the Sidebar's rows for `fold` (`group:subnet-42`, `folder:Lab`, `section:sessions`) and the open Sessions' numbers for `session` and `close`. They come from each command's `complete` hook and the registries, so a command from the Config or a Plugin completes the same way.

| Keys (`keys.cmdline`) | Action | What it does |
|---|---|---|
| Tab, Ctrl+N | `cmdline.next` | First fills in the longest prefix the candidates share; once there's nothing more to fill, the next candidate (wrapping) |
| Shift+Tab, Ctrl+P | `cmdline.prev` | The previous candidate |
| Ctrl+Y | `cmdline.accept` | Accept the candidate in the line; the list then shows the next argument's |
| Enter | `cmdline.run` | Run the line. On a command that still needs its argument (`connect `) it only accepts it |
| Esc | `cmdline.cancel` | Cancel the completion, back to what you typed; a second Esc closes the line |

Typing anything also accepts the candidate. A click on one accepts it too.

With the mouse: click a Host to open it (or go to its Session), drag it onto a Folder (or the Folders heading) to add it, and drag it out of a Folder onto any other part of the Sidebar to remove it. Folder rows have rename (✎) and delete (×) buttons, and the Folders heading has + for a new one.

## View modes (ticket 22)

Standard and Focus (decision Q36) differ only in their layout (decision Q39, `app/src/view/layout.ts`); every command works in both. In Focus the window is fullscreen with only the terminal, and keys that act on Standard's pieces reach the same things another way:

| Keys | In Standard | In Focus |
|---|---|---|
| `<leader> e` (`sidebar`) | Show or hide the Sidebar | Show or hide the Sidebar, over the terminal (issue #54) |
| `<leader> t` (`finder tree`) | The tree finder: Folders and the Inventory, with paths | The same |
| `<leader> s` (`statusbar`) | Show or hide the status bar | Show or hide the session bar (`[box] 1:esxi-02* 2:orion3-`, off by default; option `focus.sessionbar = "top" \| "bottom" \| false`) |
| `<leader> ?`, `<leader> K`, `<leader> :`, `:check` | Panels beside the terminal | The same panels, over the terminal |

A hint shows for about 2 s on entering Focus. The session bar's numbers are what `<leader> N` takes; `*` is the Session on screen and `-` the one before it, which the Session finder selects first.

The platform's usual habits apply: ⌘ on macOS, Ctrl on Windows and Linux. Form fields stay ordinary text inputs in v1.
