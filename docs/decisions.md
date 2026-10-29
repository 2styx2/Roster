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
| Q36 | View modes | **Three modes**, cycled with `␣ m`; `init.lua` picks the starting one.
1. **Standard**, the everyday layout: Sidebar tree A, title bar, optional status bar.
2. **Tmux**: still a window, but no Sidebar. The terminal plus one thin status sliver showing the Box and the Sessions (`0:esxi-02* 1:net-sw-core-01 2:orion3-`), with the address, login type and uptime of the current one.
3. **Focus**: true OS fullscreen with no chrome at all. You get around like in Neovim: `␣ b` fuzzy-finds open Sessions (Telescope's buffer list), `␣ f` fuzzy-finds Hosts, and `␣ ]` / `␣ [` cycle Sessions.

Prototype: `prototype-shell.html?mode=standard|tmux|focus`. This replaces the earlier two-mode and Compact/Mini ideas. Split panes are still out of scope. |
| Q37 | Your terminal config wins | **The terminal never fights the user's own setup.** Remote `.bashrc`, prompt, `LS_COLORS`, vim colour schemes and truecolor themes must render exactly as they do in any good terminal. The app sets `TERM=xterm-256color` and `COLORTERM=truecolor`, injects nothing else (no PS1, no sourced files, no output rewriting), and passes every escape sequence through. The 16-colour ANSI palette defaults to a neutral, standard one rather than the app accent. Themes and `init.lua` can change it, and a theme can say "leave the ANSI palette alone". |
| Q22 | Build order | A thin slice first, then test it, then the next iteration. See [roadmap.md](roadmap.md). |
