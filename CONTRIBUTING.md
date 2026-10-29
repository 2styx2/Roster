# Contributing to roster-desk

This is the same branch model as roster and Orion. **While roster-desk is a local prototype with no remote**, Claude (and you) merge Work branches into `dev`, and `dev` into `main`, directly with `--no-ff` merges, with no MR. Once the repo gets a remote, the MR rules below apply in full.

## Branches

| Branch | Cut from | Merges into | Who merges | How |
|---|---|---|---|---|
| `feat/*` `fix/*` `chore/*` `docs/*` | `dev` | `dev` | the maintainer (a human), after review | `--no-ff` merge commit `Merge branch 'feat/x' into 'dev'` |
| `dev` | — | `main` (Release) | the maintainer | merge commit, then tag `vMAJOR.MINOR.PATCH` |
| `hotfix/*` | `main` | `main`, then back-merge `main` → `dev` | the maintainer | merge commit |

- **Nobody commits directly to `main` or `dev`.** All work happens on Work branches. While the repo is a local prototype, finished Work branches are merged into `dev` straight away, with checks passing. After that, the review step comes back.
- **One Work branch per ticket**, named `feat/NN-short-slug` after `tickets/NN-*.md`, or `fix/…`, `docs/…`, `chore/…`.
- **A ticket that needs another ticket's unmerged work** is cut from that ticket's branch, so the branches stack. If it needs two, merge both into the new Work branch. Merging into a Work branch is fine. Merging into `dev` is not.
- **One iteration = one Release.** When an iteration's tickets have been reviewed into `dev` and you've tested `dev` by hand, `dev` merges into `main` and gets tagged: iteration 1 is `v0.1.0`, iteration 2 is `v0.2.0`, and so on.

## Commits

- Messages say what changed and why, scoped by area, and name the ticket: `feat(picker): fuzzy match on name, address, group (ticket 03)`.
- Every commit passes the checks: `npm run check` (tsc, lint, Vitest) and `cargo test` for the Rust crates. Each ticket keeps that one command in its README section.
- The ticket's `**Status:**` line and the board in `tickets/README.md` are updated on the Work branch, as part of the ticket.

## Changes in roster

Tickets that touch roster follow roster's own flow. Their roster Work branches have the same names (`feat/NN-…`), are cut from roster's `dev` (or stacked on the previous ticket's branch), and land in roster `dev` through a GitLab MR that you review.
