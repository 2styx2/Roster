# roster: notes for agents

One repo, two halves: the Python CLI at the root (`src/roster/`, `tests/`) and the desktop app, the roster app, in `app/` (frontend `app/src/`, Tauri shell `app/src-tauri/`) with its Rust core in `crates/roster-core/`. Decision Q56 and ADR 0007 explain the layout.

## The CLI

- Module map: README "Development" (one line per file in `src/roster/`). Open only the module it points you to.
- How hosts, logins and vault items are named and added: `docs/adding-hosts.md`; setting up a box: `docs/new-box.md`.
- The live inventory is the infra repo's `roster.yml` (`~/infra`), not this repo; `examples/` holds the template.
- Vault: `roster bw <bw args>` runs the Bitwarden CLI with this box's session file, e.g. `roster bw list items --search proxmox`.
- Checks (same as CI): `uv run ruff check src tests` and `uv run pytest`. Tests use the stand-in CLIs in `tests/fakes/`.

## The app

- Start at `app/README.md` (module map, the two builds, fixtures). The design rationale is in `docs/app/`, and the decisions are in `docs/app/decisions.md` and `docs/adr/`. Don't re-ask settled questions.
- Vocabulary: `GLOSSARY.md` (one file for the CLI and the app).
- Work comes from `tickets/`. Pick from the frontier in `tickets/README.md`, stay inside the current iteration, and update the ticket's Status line.
- The app reaches roster only through `roster serve` (ADR 0001). Never read `roster.yml` or a vault from the app. Secrets must never reach the Rust core or the frontend (`docs/app/security.md`).
- TypeScript is strict and required. UI tests go through the typed backend client with a fake backend.
- Checks (same as CI): in `app/`, `npm ci` once, then `npm run check`; at the root, `cargo test`, `cargo clippy -p roster-core --all-targets -- -D warnings` and `cargo fmt --check` (WSL can't build `app/src-tauri`: no webkit2gtk; CI can).
- Windows builds from WSL: `app/scripts/app-dev.sh`, `app-build.sh`, `app-stop.sh` (`docs/app/dev/windows-build-loop.md`). Warn the user before opening a window on their desktop.
- **Taste:** `docs/app/design/taste.md` is roster's own design identity: the network-map motif and the Gap orbit mark, the accent (apricot) means live, Iosevka for data and Inter for talk, an honest voice, motion that confirms. Read it before any UI work. It wins over references (except on accessibility).
- **Design rule:** every UI or design change follows the core of the `emil-design-eng` skill (call it first). **Every** animation or transition, new or changed, goes through the `animate` skill. The `interfaces:*` skills are for reviews and focused fixes; when they disagree on motion, `animate` wins.

## Workflow (both halves)

- Branch model: `CONTRIBUTING.md`. Work only on Work branches (`feat/NN-slug` after the ticket, `fix/…`, `docs/…`, `chore/…`) cut from `dev`. Changes land through a GitHub pull request to `dev` (`gh pr create --base dev`); the maintainer reviews and merges. Never push to `dev` or `main` directly.
- Commits and pull requests carry no `Co-Authored-By` trailer and no Claude/AI attribution line.
