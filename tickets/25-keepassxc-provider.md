# 25: KeePassXC provider (local-only secrets)

**Iteration:** 4 · **Repos:** roster (+ roster-desk lock screen text) · **Decisions:** Q40, Q41

**What to build:** A roster password provider for KeePassXC, through `keepassxc-cli` and a local `.kdbx` database, so people without a team password manager have a local-only option that keeps roster's secret model.
- **Read:** `auth: kp:ENTRY` and `kp:ENTRY#FIELD`, where the database path comes from `providers:` in `roster.yml` or `init.lua`.
- **Unlock and lock:** through the master password with the ticket 01 interface (`unlock`, `lock`, `vault_status`), so the lock screen works the same as with Bitwarden. A key file is supported as an option.
- **Create:** the "create" capability (as in ticket 13) for "Save to vault", following the same `<host> <what it opens>` naming, with the address in the URL field.
- **Safety:** the password never appears on a command line or in output. `keepassxc-cli` reads it from stdin.

**Blocked by:** 13

**Status:** ready-for-agent

- [ ] A fake `keepassxc-cli` in `tests/fakes/` covers read, field read, wrong master password, a locked database, create, and a duplicate name refused.
- [ ] `vault.status`, `vault.unlock` and `vault.lock` work with `kp` exactly as with `bw`. The lock screen names KeePassXC.
- [ ] The README provider table and `docs/adding-hosts.md` cover KeePassXC. `roster providers` lists it.
- [ ] Manual check: a local `.kdbx` with one SSH Login opens a password Session in roster-desk, and "Save to vault" adds an entry to it.
