# 15: "Save to vault" on Quick Connect

**Iteration:** 4 · **Repos:** roster + roster-desk · **Spec:** 0001 (stories 70–75)

**What to build:** A "Save to vault" checkbox on the Quick Connect password prompt. Only after the Session reaches a shell, the app asks for a Host name, pre-filled from the box's hostname. Then `quick.save`:
1. Creates the Vault item `<host> ssh`, with the username in the username field and the address in the URI field.
2. Adds the Host as a Pending change, with `auth: "bw:<host> ssh"`, `reviewed: true` and `enroll: false`.

If a Vault item with that name already exists, nothing is created and the app says why.

**Blocked by:** 11, 13, 14

**Status:** ready-for-agent

- [ ] A failed login never saves anything.
- [ ] pytest: `quick.save` creates the item and the Host. A duplicate item name leaves both the vault and the Inventory untouched.
- [ ] Manual check: save a real box, Publish it, and reconnect from the picker with no password prompt.
