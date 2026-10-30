# 12: Publish

**Iteration:** 3 · **Repos:** roster (CLI + app) · **Spec:** 0001 (stories 65–67)

**What to build:** `serve` gains `changes.publish`, which commits the Pending changes with a message describing them and pushes to infra `main`. If the remote has moved, or the push fails, it stops and says so, and never forces. After a successful Publish it runs `roster sync`. The app's Publish button and `:publish` show the diff for one last look before publishing.

**Blocked by:** 10

**Status:** done (pending review; the manual check on the real infra repo is for the maintainer)

- [x] pytest against a local bare repo: Publish commits and pushes, a diverged remote is refused, and sync runs afterwards (also: nothing pending, other dirty files, local commits, no upstream, a refused commit, a rejected push undone).
- [x] The commit message names the Hosts (and groups) that changed; the app shows it, editable.
- [ ] Manual check (maintainer): Publish a real change to infra, then `roster-pull` on another Box picks it up.

**Built (PR for #13):** `changes.publish {message?}` (API 6, codes 80-86, docs/app/errors.md rows 44-50), `changes.diff` gains `message` and `groups`, and errors carry git's words in `data.details`. The app: Publish… in `:changes` and `:publish`, the diff with the editable message, the commit's hash after, catalog rows for every refusal. Publish fast-forwards over upstream commits that leave `roster.yml` alone and refuses everything else that moved (decision Q13's note).
