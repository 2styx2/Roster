# One repo: the desktop app lives in `app/` of the roster repo

The desktop app, built as the separate local repo roster-desk, now lives in the roster repo and is called the roster app. The Python CLI stays at the root (`pyproject.toml`, `src/roster/`, `tests/`, `install.sh`), so nothing changes for people who install or run it. The frontend and the Tauri shell go into `app/` (`app/src/`, `app/src-tauri/`), the Tauri-free Rust core into `crates/roster-core/` (it was `crates/desk-core`), and the Cargo workspace sits at the repo root with `roster-core` as its default member, so `cargo test` never needs WebKitGTK. The app's docs move to `docs/app/`, its ADRs join this folder after roster's own (0003–0006, each naming its old number), and its tickets go to `tickets/` at the root. Both histories are kept: the app's commits were merged with `--allow-unrelated-histories` after a commit of pure renames, so `git log --follow` reaches back past the move.

The two halves were always one product. `roster serve` exists only for the app (ADR 0001), most tickets change both sides (`vault.login`, clean errors, askpass), and the error codes, the catalog and the glossary have to agree. In two repos every such change was two branches, two reviews and a version check between them. In one repo a ticket is one branch and one pull request, CI checks both sides together, and the docs can link to each other.

## Consequences

- **The names change.** Product "roster"; the app's window and product name "Roster", binary `roster-app`, Tauri identifier `dev.roster.app`, config dir `roster` (`%APPDATA%\roster`, `$XDG_CONFIG_HOME/roster`). The app copies an old `roster-desk` Config dir and `dev.roster.desk` State into the new places once, at start-up, when the new ones are empty; it never moves or overwrites them. The development env vars become `ROSTER_APP_*`; the `ROSTER_DESK_*` names are still read as fallbacks.
- **On Linux the config dir is shared.** `~/.config/roster/` can also hold roster's own `roster.yml`. The app only ever reads `init.lua`, `folders.yml` and the Lua modules it requires there, and roster never reads those, so they don't collide.
- **One workflow.** App changes go through GitHub pull requests to `dev`, like the CLI. CI (GitHub Actions) runs the CLI's checks, the frontend's, and the Rust core's, and builds the Tauri crate on Linux with the WebKitGTK packages installed.
- **The app still talks to roster only through `roster serve`** (ADR 0001). Being in the same repo doesn't let the app import the CLI or read `roster.yml`; the process boundary and the secrets rule stay.

## Considered Options

- **Keep two repos**: independent release cycles, but every cross-cutting ticket was two branches and two reviews, and nothing checked that the two sides agreed.
- **The app at the root, the CLI in a subfolder**: puts the larger tree first, but moves `pyproject.toml`, `install.sh` and every documented install path for people who only use the CLI.
- **A git submodule or subtree for the app**: keeps the app's history apart, at the cost of a second checkout and pull step for every change.
