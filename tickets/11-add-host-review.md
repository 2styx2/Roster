# 11: Add a Host and mark it reviewed

**Iteration:** 3 · **Repos:** roster + roster-desk · **Spec:** 0001 (stories 57, 59–60)

**What to build:** `serve` gains `host.add` and `host.review`. The app has an add-Host form with name, address, group, type, user, Login and enroll, and a "mark reviewed" action on unreviewed Hosts in the picker and the forms. Login fields suggest Vault item names that follow `<host> <what it opens>`.

**Blocked by:** 10

**Status:** ready-for-agent

- [ ] pytest: an added Host appears in the right group with comments kept. A duplicate or invalid name is refused with roster's wording.
- [ ] Marking a Host reviewed flips only that flag.
- [ ] UI tests cover the add form, validation messages and the suggestions.
