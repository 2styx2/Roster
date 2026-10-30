# 11: Add a Host and mark it reviewed

**Iteration:** 3 · **Repos:** roster + roster-desk · **Spec:** 0001 (stories 57, 59–60)

**What to build:** `serve` gains `host.add` and `host.review`. The app has an add-Host form with name, address, group, type, user, Login and enroll, and a "mark reviewed" action on unreviewed Hosts in the picker and the forms. Login fields suggest Vault item names that follow `<host> <what it opens>`.

**Verified adds only** (decision Q43):
- **Test login first:** `host.add` with a Login (an existing Vault item reference, or a password typed into the form) runs a test login before anything is written. This is `serve`'s `host.verify_login`: ssh with askpass and BatchMode for keys, one attempt, a short timeout, and the host key scanned and confirmed by the user first.
- **On success:**
  1. If a password was typed, create the Vault item `<host> ssh`.
  2. Add the Host as a Pending change.
  3. If step 2 fails, delete the Vault item again.
- **On failure:** nothing is written. The form shows why: unreachable, host key refused, wrong user/password, or a timeout.
- **Hosts without a Login** can still be added unreviewed (`reviewed: false`), as `discover` adds them.

**Blocked by:** 10, 13

**Status:** ready-for-agent

- [ ] pytest: an added Host appears in the right group with comments kept. A duplicate or invalid name is refused with roster's wording.
- [ ] pytest (fake `bw` plus a local password/key SSH server, as in ticket 06's harness):
  - a failed verify (bad password, bad user, unreachable, host key refused) writes nothing to the vault or `roster.yml`;
  - a passing verify creates the item and then the Host;
  - a failure while adding the Host deletes the item it just created.
- [ ] The typed password never appears in serve's output, logs or the Pending change. It's held only for the verify and then the create.
- [ ] Marking a Host reviewed flips only that flag.
- [ ] UI tests cover the add form, validation messages and the suggestions.
