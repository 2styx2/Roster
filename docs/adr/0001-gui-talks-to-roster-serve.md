# The desktop app talks to roster only through `roster serve`

The desktop app (in `app/`; until 2026-10-30 the separate roster-desk repo, see ADR 0007) never reads `roster.yml` or a vault itself. It starts one `roster serve` process per launch and speaks JSON-RPC to it over stdin/stdout. That process holds the unlocked vault for the app's lifetime, answers queries with the same host, group and resource objects `load_config` already builds, and makes every Inventory write. roster stays the one place that understands the Inventory and touches secrets, so the CLI and the app cannot drift apart, and the Rust and UI layers never hold a password.

## Considered Options

- **A `roster … --json` subprocess per action**: each call would need to unlock the vault again or leave a session file on disk, and would pay Python's startup time on every click.
- **An HTTP API on localhost**: easier to poke with curl, but any local process could call it while the vault is unlocked, so it would need tokens and hardening. With stdio, only the parent app can talk to it. A user-only local socket can be added later if other clients need it.
- **Rewriting the backend in Rust inside the app**: it would fork roster's model into two implementations.
