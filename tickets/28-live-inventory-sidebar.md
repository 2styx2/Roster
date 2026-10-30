# 28: Live Inventory: add, remove and rename Hosts and groups in the Sidebar, two-way with `roster.yml`

**Iteration:** 3 · **Repos:** roster (CLI + app) · **Decisions:** Q43, Q45, Q46

**What to build:**

**Two-way with the file:**
- **Watch:** `roster serve` watches `roster.yml` (and its directory, because editors write by rename). It reloads the file and sends a JSON-RPC notification, `inventory.changed`. The app updates the Sidebar in place, keeping folds, the cursor and open Sessions.
- **Broken edits:** a change that doesn't load keeps the last good Inventory and shows a clean error with the file and line (catalog row 1). It recovers by itself once the file is fixed.
- **Folders the same way:** the app writes `folders.yml` on every Folder change and watches it for outside edits. Folders that `init.lua` defines show as read-only, marked "from init.lua".

**Sidebar editing:** every action is a command, so it works in Focus mode as well.
- **Hosts:** `+` on a group heading, `:host add`, and `␣ n` open the add-Host form (ticket 11), with verify first per Q43. A row menu and `:host remove HOST` remove a Host after a confirm that names it; the vault is never touched. `:host rename` renames one. Dragging a Host to another group moves it.
- **Groups:** `+ Group` and `:group new|rename|delete`. Deleting a group that still has Hosts asks where they should go, or refuses.
- **Pending changes:** every Inventory edit becomes a Pending change (ticket 10). A badge shows the count, and Publish is ticket 12. A host or group being added shows as pending (dimmed, with a dot) until it's Published.

**Blocked by:** 10, 11

**Status:** ready-for-agent

- [ ] pytest: an outside edit to `roster.yml` sends `inventory.changed` within 1 s; a broken edit keeps the last good data and reports the line; host and group add, remove, rename and move keep comments, and the other entries stay byte-identical.
- [ ] App tests: the Sidebar updates in place on `inventory.changed`; every add, remove, rename and move works by key, mouse and `:` command; removal needs confirmation; `folders.yml` round-trips, and `init.lua` Folders are read-only.
- [ ] Manual check: edit `~/infra/roster.yml` in vim while the app is open and watch the Sidebar follow. Add and remove a Host and a group in the app, then see the diff in `roster.yml`.
