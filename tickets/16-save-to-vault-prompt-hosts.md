# 16: "Save to vault" for Hosts with `auth: prompt`

**Iteration:** 4 · **Repos:** roster + roster-desk · **Spec:** 0001 (story 76)

**What to build:** When an existing Host whose Login is still `auth: prompt` needs a password, the app asks for it with the same masked field and "Save to vault" checkbox. After a successful login, it creates `<host> ssh` and updates the Host's Login to point at it, as a Pending change.

**Blocked by:** 15

**Status:** ready-for-agent

- [ ] pytest: the Host's Login is updated with comments kept. A duplicate Vault item is refused.
- [ ] Manual check on a real `auth: prompt` Host.
