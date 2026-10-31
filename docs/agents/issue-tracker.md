# Issue tracker: GitHub

Issues and tickets for roster (the CLI and the app together) live as GitHub issues on `2styx2/roster`. Use the `gh` CLI for all operations; it infers the repo from the clone.

## roster's conventions

- **Tickets are GitHub issues only** (Q64): never ticket files, never a PR to file or change a ticket. There is no `tickets/` folder.
- **Tickets** are issues titled `TNN: …`. The ticket number is not the issue number (T01 is #1). Take the next free number from the highest existing `T` title: `gh issue list --state all --search "in:title T" --limit 200 --json title`.
- **Iterations** are milestones (`Iteration 4 — Quick Connect`, …). Every ticket goes in its iteration's milestone (`--milestone "<title>"`). Stay inside the current iteration.
- **Area labels:** `app` (desktop, `app/` and `crates/`), `cli` (roster CLI and `roster serve`). Other labels: `iteration`, `decision` (needs the owner), `follow-up` (follow-up or manual check).
- **Blockers:** put `Blocked by #N, #N` at the top of the body (and add the native dependency, below).
- **Closing:** `Closes #N` in a PR does not fire on `dev`, so close the issue by hand once its PR is merged.
- Decisions are not issues; they go in `docs/app/decisions.md` (and `docs/adr/`) through a PR.

## Conventions

- **Create an issue**: `gh issue create --title "..." --milestone "..." --label "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --json number,title,body,labels,milestone,comments`.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label`, `--milestone` and `--state` filters.
- **Make an issue a sub-issue of a parent**: `gh issue create --parent <parent> ...`, or `gh issue edit <parent> --add-sub-issue <child>` afterwards. Without sub-issues, put `Part of #<parent>` at the top of the child body.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh api --paginate 'repos/{owner}/{repo}/pulls?state=open' --jq '.[] | select(.author_association | IN("OWNER","MEMBER","COLLABORATOR") | not) | {number, title, author: .user.login, author_association, labels: [.labels[].name]}'`.
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either: resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue, following roster's conventions above (a `TNN:` title and a milestone for a ticket).

## When a skill says "fetch the relevant ticket"

Read it as in **Read an issue** above. A ticket named `TNN` is found by title: `gh issue list --state all --search "TNN in:title"`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (see **Make an issue a sub-issue of a parent**). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's **native issue dependencies**, the canonical, UI-visible representation. Add an edge with `gh api --method POST repos/2styx2/roster/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/2styx2/roster/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only, the live gate). Keep the `Blocked by: #<n>, #<n>` line at the top of the child body too (roster's convention). A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me`, the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.
