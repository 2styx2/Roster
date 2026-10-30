# 10: Edit a Host → Pending change → diff / discard

**Iteration:** 3 · **Repos:** roster + roster-desk · **Spec:** 0001 (stories 56, 58, 61–64)

**What to build:**
- `serve` gains `inventory.pull`, `host.update`, `changes.diff` and `changes.discard`.
- Before any edit, the app pulls the infra repo, fast-forward only, and reports clearly if it can't.
- An edit form changes a Host's fields. The write edits `roster.yml` text in place and keeps comments, the same way `discover --write` does. It keeps a `.bak` and refuses any result that wouldn't load.
- The app shows Pending changes as a diff and can discard them.

**Verified changes to a Login** (decision Q43): an edit that changes a Host's address, user or Login reference runs `host.verify_login` with the new values before it becomes a Pending change. Text-only edits (title, description, type) need no verify.

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] pytest: an update keeps the comments and the other Hosts byte-for-byte, refuses an invalid result, and the diff shows exactly the change.
- [ ] pytest: discard puts the file back as it was.
- [ ] The pull fails cleanly on a diverged or dirty repo.
- [ ] UI tests cover the edit form, the Pending changes count and the diff view.

**Note from ticket 02:** `serve` loads the Inventory once at startup. `inventory.pull` and every write must reload it, so `hosts.list` reflects the new file.
