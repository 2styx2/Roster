# 17: Inventory tree and Folders in the Sidebar

**Iteration:** 1 (moved up from 5; decision Q35) · **Repo:** roster-desk · **Spec:** 0001 (story 78, 88–93) · **Decisions:** Q32–Q34

**What to build:** Two more Sidebar sections under Sessions. The prototype is `prototype-shell.html` on branch `prototype/logos`; variant A is the tree style.

**Folders:** the user's personal groupings of Hosts.
- Create, rename and delete Folders.
- Add a Host to a Folder with `␣ a` or by dragging. Remove it the same ways.
- Saved in this Box's State file, never in the Inventory. Ticket 21 also lets `init.lua` define them.

**Inventory:** every Host grouped as in `roster.yml` (subnet-1, subnet-42, …) with counts.
- Each Host shows its state dot and address.
- Unreviewed Hosts carry a badge and can't be connected.

**Behaviour:**
- `j`/`k` move, `h`/`l` fold and unfold, Enter opens a Session, or jumps to it if one is already open.
- The mouse works throughout.
- The Host on screen is **raised** where it first appears, and only brighter where it appears again.
- Whether each section is folded is remembered in State.

**Blocked by:** 07

**Status:** ready-for-agent

- [ ] UI tests: keyboard navigation and folding; connecting; jumping to an open Session; adding a Host to a Folder and removing it; Folders surviving a restart through State; unreviewed Hosts can't be connected.
- [ ] Folders are never sent to `roster serve` and never touch `roster.yml`.
- [ ] Manual check on Windows with the real Inventory (91 Hosts): the tree scrolls smoothly and folding is instant.
