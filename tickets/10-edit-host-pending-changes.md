# 10: Edit a Host → Pending change → diff / discard

**Iteration:** 3 · **Repos:** roster (CLI + app) · **Spec:** 0001 (stories 56, 58, 61–64)

**What to build:**
- `serve` gains `inventory.pull`, `host.update`, `changes.diff` and `changes.discard`.
- Before any edit, the app pulls the infra repo, fast-forward only, and reports clearly if it can't.
- An edit form changes a Host's fields. The write edits `roster.yml` text in place and keeps comments, the same way `discover --write` does. It keeps a `.bak` and refuses any result that wouldn't load.
- The app shows Pending changes as a diff and can discard them.

**Verified changes to a Login** (decision Q43): an edit that changes a Host's address, user or Login reference runs `host.verify_login` with the new values before it becomes a Pending change. Text-only edits (title, description, type) need no verify.

**Blocked by:** 04

**Status:** done (pending review)

- [x] pytest: an update keeps the comments and the other Hosts byte-for-byte, refuses an invalid result, and the diff shows exactly the change.
- [x] pytest: discard puts the file back as it was.
- [x] The pull fails cleanly on a diverged or dirty repo.
- [x] UI tests cover the edit form, the Pending changes count and the diff view.

**Note from ticket 02:** `serve` loads the Inventory once at startup. `inventory.pull` and every write must reload it, so `hosts.list` reflects the new file.

**Done:** `roster serve` API 4 (README "Editing: Pending changes"): `inventory.pull`, `host.verify_login`, `host.update`, `changes.diff`, `changes.discard`, codes 60-65 (docs/app/errors.md rows 34-39). `src/roster/edit.py` edits the text and checks the result (it loads, loads to exactly the values asked for, and nothing else changed); `src/roster/changes.py` is the git side; the `.bak` lives in the repo's git dir (`.git/roster/roster.yml.bak`) so Publish never picks it up. Every write and pull reloads the Inventory. In the app: `:edit [HOST]` (`␣ E`), `:changes` (`␣ c`), `:discard`, `:pull`, and a `changes` status-bar segment.

Left for later: Publish (12); add a Host (11); serve watching `roster.yml` (28). A new address with no recorded host key (for it or the Host's current address) can't pass the test login yet: record it with `roster setup` after editing by hand. Sessions use an edited address or user after `roster sync` rewrites this Box's ssh config.
