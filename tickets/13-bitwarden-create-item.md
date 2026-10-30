# 13: Prefactor: Bitwarden can create Vault items

**Iteration:** 3 (moved up: ticket 11's verified adds need it) · **Repo:** roster · **Spec:** 0001 (stories 73, 75, 77)

**What to build:** Add an optional "create" capability to the provider interface and implement it for Bitwarden only. It creates a login item with a name, a username, the password, and the address in the URI field. It refuses if an item with that exact name already exists. `vault.create_item` exposes it through `serve`, and `vault.status` reports whether the provider can write.

**Blocked by:** 01

**Status:** done

- [x] The fake `bw` supports create. pytest covers a successful create, a refused duplicate, and the item's fields.
- [x] The password is passed to `bw` without ever appearing in a command line.
- [x] Other providers report that they can't write.
