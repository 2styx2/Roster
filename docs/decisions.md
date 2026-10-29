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
| Q22 | Build order | A thin slice first, then test it, then the next iteration. See [roadmap.md](roadmap.md). |
