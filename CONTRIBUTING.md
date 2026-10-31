# Contributing to roster

One branch model for the whole repo: the Python CLI at the root and the roster app in `app/` + `crates/roster-core/`. Every change, to either half, reaches `dev` through a GitHub pull request that the maintainer reviews and merges.

## Branches

| Branch | Cut from | Merges into | Who merges | How |
|---|---|---|---|---|
| `feat/*` `fix/*` `chore/*` `docs/*` | `dev` | `dev` | the maintainer (a human), after review | pull request (`gh pr create --base dev`), merged with a merge commit |
| `dev` | — | `main` (Release) | the maintainer | pull request, merge commit, then tag `vMAJOR.MINOR.PATCH` |
| `hotfix/*` | `main` | `main`, then back-merge `main` → `dev` | the maintainer | pull request, merge commit |

- **Nobody commits directly to `main` or `dev`.** All work happens on Work branches and lands through a pull request with CI green. GitHub enforces it: `main` and `dev` take changes only through an approved pull request, can't be force-pushed or deleted, and only the maintainer can bypass that (for an urgent hotfix).
- **The repo is public.** Nothing from a real network goes in: no real host names, address ranges, company names, emails or secrets, in code, tests, docs, commits, issues or pull requests. Use made-up examples.
- **One Work branch per ticket**, named `feat/NN-short-slug` after ticket TNN (a GitHub issue), or `fix/…`, `docs/…`, `chore/…`. A ticket that changes both the CLI and the app is one branch and one pull request.
- **A ticket that needs another ticket's unmerged work** is cut from that ticket's branch, so the branches stack; open its pull request against `dev` once the first one is merged (or against the first branch, retargeted later). If it needs two, merge both into the new Work branch. Merging into a Work branch is fine. Merging into `dev` is not.
- **First Release of the app after iteration 4** (decisions Q48, Q70). Iterations 1–4 all build up on `dev`, and each one is tested by hand before the next starts. After iteration 4, `dev` merges into `main` and is tagged `v0.1.0`. After iteration 7, the next Release is tagged `v0.2.0`. How to cut one: [docs/releasing.md](docs/releasing.md).

## Docs

**Docs ship with the change, in the same pull request.** A feature isn't done until `:help` can answer a question about it. roster's docs follow the model of Neovim's: one source for the in-app `:help` (and, later, the docs website and PDF), complete, and never stale. For each kind of change:

- **New or changed command** (app `:name`, or `roster NAME`): the command has a `label` and an `area`, so `:help commands` lists it. Default keys go in `docs/app/keyboard.md`'s table. A CLI command gets its section in `docs/cli-reference.md`.
- **New `init.lua` option:** one row in `docs/app/config.md`'s option tables (Option | Default | What it does). That row is the only copy; `options.test.ts` fails without it.
- **New failure** (a roster error code, or a new way a Session or edit can fail): a row in `docs/app/errors.md` (what happened, cause, where it lives, message, fix) and its catalog entry. The code goes in `docs/serve-api.md` if serve returns it.
- **New or changed `roster serve` method or result:** its row in `docs/serve-api.md`, with the API version that added it, and `API_VERSION` bumped if the app must know.
- **New concept or word:** an entry in `GLOSSARY.md`, with what to avoid. Use that word everywhere.
- **New guide or section:** Markdown under `docs/app/`, bundled into `:help` through `app/src/help/guides.ts`. Headings are names, not sentences: each `##`/`###` becomes a topic `page#slug`, so renaming one means keeping the old slug as an alias. Link commands, options and errors by topic (`` [`:connect`](:connect) ``, `` [`terminal.size`](terminal.size) ``, `[E13](E13)`), and other guides by file (`[x](keyboard.md#two-modes)`).
- **A Plugin-facing registry or API:** say on that registry's page how a Plugin uses it.

Write in the present tense and the active voice, and say exactly what happens. Write keys in keymap notation (`␣ f`, `Ctrl+Shift+c`). Use made-up names only (`esx-02`, `10.0.0.5`): the docs are public. When a check fails, fix the doc; don't silence the check.

## Commits

- Messages say what changed and why, scoped by area, and name the ticket: `feat(picker): fuzzy match on name, address, group (ticket 03)`.
- No `Co-Authored-By` trailers and no AI attribution lines in commits or pull request descriptions.
- Every commit passes the checks of the half it touches; CI (`.github/workflows/ci.yml`) runs all of them on every pull request:
  - CLI: `uv run ruff check src tests` and `uv run pytest`.
  - App: in `app/`, `npm run check` (tsc, ESLint, Vitest); at the root, `cargo test`, `cargo clippy -p roster-core --all-targets -- -D warnings` and `cargo fmt --check`.
- Tickets are GitHub issues, grouped by iteration milestones; the issue is the ticket and its open or closed state is its status. Filing or changing a ticket needs no pull request. Merges into `dev` don't fire "Closes #N", so the issue is closed when its pull request is merged.

## License of contributions

roster is licensed under the GNU General Public License, version 3 or (at your option) any later version (`GPL-3.0-or-later`, see [LICENSE](LICENSE)).

By opening a pull request you agree that:

- your contribution is your own work (or you have the right to submit it), and it's licensed to everyone under `GPL-3.0-or-later`, like the rest of roster;
- the maintainer may also license your contribution under other terms, including a commercial license, so roster can be offered under a separate license to anyone who can't use the GPL. You keep the copyright in your contribution.
