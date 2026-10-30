# Design decisions log (2026-10-29)

These came from a grilling session in which each question was asked with a recommended answer. The lasting, hard-to-reverse ones are also ADRs.

| # | Question | Decision |
|---|---|---|
| — | Is this worth building? | Yes as a team or personal tool. XPipe is the closest rival. The value is roster's model (team Inventory in git, per-service Logins, review gate, secrets kept from the UI), not "another SSH client". See [vision.md](vision.md). |
| Q1 | Who is it for? | The team eventually. It starts as a personal project and may be open-sourced or sold later. |
| Q2 | Platform | Cross-platform, anywhere with a display (Windows, X11, Wayland, WSLg). **Tauri.** |
| Q3 | v1 scope | Host finding, terminal tabs with automatic login, Host details, opening web services. |
| Q4 | Inventory writes | **Yes**, the app writes to the Inventory (it was read-only at first, then changed). |
| Q5 | Secrets | Never shown in the GUI. The app must really unlock the vault (Bitwarden or whatever provider the Inventory uses). |
| Q6 | Terms | **Host** is the saved entry. **Session** is one live terminal connection. |
| Q7 | Repo | A separate repo, **local only** while experimenting. |
| Q8 | "Native" | Native window chrome, shortcuts, fonts and light/dark. Our own design inside. SecureCRT is a skeleton, not a style guide. |
| Q9 | Frontend | React + Vite + **TypeScript (required)** + xterm.js (WebGL). Get it right on Windows first, then the Linux VM. |
| Q10 | API | `roster serve`, JSON-RPC over stdio, returning roster's **existing objects** (roster ADR 0001). |
| Q11 | Session transport | System `ssh` in a PTY, with passwords through SSH_ASKPASS (roster ADR 0002). |
| Q12 | App lock | Unlocking the vault is the app lock. Locks after 15 minutes idle (configurable). |
| Q13 | Write flow | Edit through roster, keeping comments, then diff, then **Publish** (commit and push to infra `main`, pulling first). |
| Q14 | Backends | All three: native Windows, the Windows app with roster in WSL, and Linux. Auto-detected per machine. |
| Q15 | Name and location | `roster-desk` in `~/work/roster-desk`. |
| — | Keyboard | Vim keys, mostly keyboard, mouse fully supported. |
| Q16 | Backend setting | Local or WSL: <distro>. The Windows default is auto-detected, and the Config can override it (`backend =`). Originally a Settings screen option, then replaced by Q24. |
| Q17 | Layout | Terminal first: the Picker overlay is the main way to find Hosts, side panels are closed by default, and there's one thin tab strip. |
| Q18 | Leader | Ctrl+Space, configurable. |
| Q19 | Vim scope | Vim keys in the app everywhere except the terminal. Can be turned off. Form fields stay ordinary inputs. |
| Q20 | Quick Connect | "Save to vault" saves only after the login succeeds. It creates the Vault item `<host> ssh` and the Host (reviewed, not enrolled) as a Pending change. The same checkbox appears for `auth: prompt` Hosts. |
| Q21 | Vault writes | Bitwarden only. Other providers come later, when needed. |
| Q23 | Config language | **Lua**: `init.lua` in the user config dir, run with mlua (Lua 5.4 built in). See [ADR 0002](adr/0002-lua-config-file-only.md). |
| Q24 | Settings screen | **None. The config file is the only place to change settings**, as in WezTerm and Neovim. Remembered things like window size and recent Hosts are State, not Config. |
| Q25 | When | **Iteration 2**, with the design pass (ticket 21). In iteration 1 the keymap and options are built as data tables with defaults, ready for the Config to override. |
| Q26 | Window chrome | **A custom title bar like Slack's** (frameless window; our own bar with app icon, tabs, the Picker search, and minimize, maximize and close). It replaces Q8's "native title bar". The rest of Q8 stays: platform shortcuts, system font and OS light/dark. It lands in iteration 2's design pass (ticket 09). |
| Q27 | Visual direction | **Linear is the main reference**: lean, dense and quiet, with a muted palette and one accent, thin 1px borders, small type, fast and subtle motion, and keyboard-first with a command palette. Tabby and Warp are secondary references. |
| Q28 | Logo | Five concepts are prototyped on branch `prototype/logos` (`npm run proto:logos`). The user picks one or more to refine. |
| Q29 | Logo + accent | **D1 "Network R"** (seven nodes joined into an R, with the accent node at the end of the leg) and **jade `#1f9d68`** as the default accent. Prototype: branch `prototype/logos`. |
| Q30 | Fonts | **Inter** (Linear's UI font) for the UI. **Iosevka** for the terminal and the wordmark. Both are defaults the Config can change. |
| Q31 | Active item | The **raised** style: a slightly lighter fill plus a 1px outline. No underlines. |
| Q32 | Layout | **Title bar 3, extended:** the bar holds only the mark and minimize, maximize and close. **Sessions, personal Folders and the Inventory tree live in a left sidebar**, like SecureCRT's Session Manager or an editor's file tree, in place of a tab strip. The status bar can be hidden. A **Key bindings panel** (`␣ ?`) lists the resolved keymap and where each binding comes from. Prototype: `prototype-shell.html` (A tree / B explorer). This replaces Q17's tab strip, Q26's tabs in the bar, and "side panels closed by default". The Picker stays on `␣ f`. |
| Q33 | Modularity | **Everything above is only a default.** The Config (`init.lua`) can change every color token (themes are sets of tokens; several ship), the fonts, the keymap, and the layout pieces: sidebar on/off and side, Sessions as a sidebar or as tabs, status bar on/off, what the title bar shows. The app behaves like an editor you configure. |
| Q34 | Folders | **Personal:** kept in this Box's State (drag, or `␣ a`) and definable in `init.lua`. They're never written to `roster.yml`. Teammates see only the Inventory's groups. |
| Q35 | When | The **sidebar is built in iteration 1**: ticket 07 builds Sessions in the sidebar instead of a tab strip, and ticket 17 (Inventory tree and Folders) moves to iteration 1. Colors, fonts, the title bar and polish stay in iteration 2 (09). Themes and layout options land in 21. |
| Q36 | View modes | **Two modes** (simplified from three on 2026-10-29, so both can be done really well), toggled with `␣ m` or F11. `init.lua` picks the starting one.
1. **Standard**, the everyday layout: Sidebar tree A, title bar, optional status bar.
2. **Focus**: true OS fullscreen with no chrome at all. You get around like in Neovim: `␣ b` fuzzy-finds open Sessions (Telescope's buffer list), `␣ f` fuzzy-finds Hosts, and `␣ ]` / `␣ [` cycle Sessions.

**Every mode keeps all of roster:** the Picker, `:` command line, Quick Connect, Host details, the Key bindings panel, Lock, Inventory edits and Publish all work in every mode. Modes change how things are shown, never what you can do. What the Sidebar shows in Standard is reached through overlays and finders in Tmux and Focus. Prototype: `prototype-shell.html?mode=standard|focus`. Focus can optionally show the thin tmux-style session bar (`[box] 0:esxi-02* 1:…`): off by default, turned on with `focus.status_line = true` in `init.lua`. The Tmux mode, Compact rail and Mini window ideas were dropped. Split panes are still out of scope. |
| Q37 | Your terminal config wins | **The terminal never fights the user's own setup.** Remote `.bashrc`, prompt, `LS_COLORS`, vim colour schemes and truecolor themes must render exactly as they do in any good terminal. The app sets `TERM=xterm-256color` and `COLORTERM=truecolor`, injects nothing else (no PS1, no sourced files, no output rewriting), and passes every escape sequence through. The 16-colour ANSI palette defaults to a neutral, standard one rather than the app accent. Themes and `init.lua` can change it, and a theme can say "leave the ANSI palette alone". |
| Q38 | Plugins and packages | **Neovim-style extensibility:**
- **Plugins** are Lua, run in the same runtime as the Config. They add commands, keys, themes, Sidebar sections, finder sources, status segments and event hooks.
- **Packages** are Plugins from git repos, listed in `init.lua` and pinned in `roster-desk.lock` (lazy.nvim-style).
- The built-in features use the same registries.
- Plugins never see secrets, and their Inventory writes only become Pending changes.
- No plugin HTML/JS in v1.

See [ADR 0004](adr/0004-lua-plugins-and-packages.md). Tickets 23–24, iteration 7. |
| Q39 | Per-mode layout | **Each view mode has its own layout table** in `init.lua`: which pieces show, where they go, and in what order. The pieces are the title bar, Sidebar (and its sections), session bar, status bar and its segments, and finders. For example, Focus can show the session bar at the bottom, and Standard can hide the status bar. Plugins can add pieces and segments to any mode. The defaults are the two modes as prototyped. |
| Q40 | No built-in vault | **roster-desk will never have its own secret store.** Secrets stay in the user's password manager. roster and roster-desk only hold Login *references*, and never learn or keep a password beyond one lookup. Building a vault would mean owning encryption, recovery, sync, sharing and breach liability, and it would turn the product into the thing (Termius's vault) we set out to differ from. |
| Q41 | Local-only option | People without a team password manager get **local providers** instead of a vault: **KeePassXC** (`keepassxc-cli`, a local `.kdbx` file) is added, next to the existing `pass`. Both can read Logins and, like Bitwarden in ticket 13, create Vault items for "Save to vault". Ticket 25. |
| Q42 | Syncing your setup | `init.lua`, `roster-desk.lock`, themes and personal Folders are plain files that sync through **git (dotfiles)**, the way the Inventory does. There's no vendor cloud. A `:config sync` helper that pulls and pushes that repo is a later proposal, not planned yet. |
| Q43 | Verified adds only | **A Host with a Login enters the Inventory, and a password enters the vault, only after a test login just succeeded with exactly those credentials.** That means the address was reachable, the host key was confirmed, and the user and password (or key) were accepted. This applies to the add-Host form (ticket 11), Quick Connect "Save to vault" (15), filling in `auth: prompt` Hosts (16), and changing a Host's Login in an edit (10). The order is always: verify, then create the Vault item, then add the Pending change. If the second step fails, the first is undone, so a failure leaves neither a stray Vault item nor a Pending change. Hosts *without* a Login (from `discover`) still enter as `reviewed: false` through the review gate. |
| Q44 | Clean errors everywhere | Every way a connection can fail, including entries made by hand in `roster.yml` or the vault, ends in a clean error with the Host, plain words, where the problem lives, the fix, and the raw message under Details. The catalog is `docs/errors.md`. `roster check HOST` / `:check HOST` run the diagnostics. A changed host key is never accepted automatically. Ticket 26, iteration 1. |
| Q22 | Build order | A thin slice first, then test it, then the next iteration. See [roadmap.md](roadmap.md). |
