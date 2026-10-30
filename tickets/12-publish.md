# 12: Publish

**Iteration:** 3 · **Repos:** roster + roster-desk · **Spec:** 0001 (stories 65–67)

**What to build:** `serve` gains `changes.publish`, which commits the Pending changes with a message describing them and pushes to infra `main`. If the remote has moved, or the push fails, it stops and says so, and never forces. After a successful Publish it runs `roster sync`. The app's Publish button and `:publish` show the diff for one last look before publishing.

**Blocked by:** 10

**Status:** ready-for-agent

- [ ] pytest against a local bare repo: Publish commits and pushes, a diverged remote is refused, and sync runs afterwards.
- [ ] The commit message names the Hosts that changed.
- [ ] Manual check: Publish a real change to infra, then `roster-pull` on another Box picks it up.
