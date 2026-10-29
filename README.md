# roster-desk

A fast, keyboard-first desktop app that gets you into a terminal on any Host in your team's roster Inventory in a few keystrokes. [roster](../roster) is the only backend: it knows the Hosts and the Logins. roster-desk is the nicest way to reach them.

> Status: **design settled, nothing built yet.** It's a personal project first, local only, with no remote.

## Where to look

| Path | What's in it |
|---|---|
| [docs/vision.md](docs/vision.md) | Why this exists, how it compares with SecureCRT, Termius, Tabby and XPipe, and what makes it different |
| [docs/architecture.md](docs/architecture.md) | The processes, the `roster serve` API, how Sessions connect, and the backends |
| [docs/security.md](docs/security.md) | Where secrets go and where they never go, and how locking works |
| [docs/keyboard.md](docs/keyboard.md) | The leader key, the two focus modes, and the default bindings |
| [docs/roadmap.md](docs/roadmap.md) | The iterations and what "done" means for each |
| [docs/decisions.md](docs/decisions.md) | Every design question we asked (Q1–Q22) and the answer |
| [docs/adr/](docs/adr/) | Architecture decisions for roster-desk. roster's own ADRs live in `../roster/docs/adr/` |
| [GLOSSARY.md](GLOSSARY.md) | roster-desk terms. Shared terms (Host, Session, Login…) live in roster's `GLOSSARY.md` |
| [spec/](spec/) | Product specs. Start with [0001](spec/0001-roster-desk.md) |
| [tickets/](tickets/) | Vertical-slice tickets with their blockers. [tickets/README.md](tickets/README.md) is the board |

## Stack

- Tauri: Rust core, system webview
- React, Vite and TypeScript (strict)
- xterm.js with the WebGL renderer
- roster (Python) as the backend, reached through `roster serve`
