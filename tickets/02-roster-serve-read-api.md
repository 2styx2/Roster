# 02: `roster serve`: read-only JSON-RPC API

**Iteration:** 1 · **Repo:** roster · **Spec:** 0001 · **ADR:** roster 0001

**What to build:** A new `roster serve` command that speaks JSON-RPC 2.0 over stdin/stdout, one JSON object per line, logging to stderr only. It exits when stdin closes. It answers `inventory.info`, `hosts.list` and `host.get` with the Host, group and resource objects that roster already builds when it loads the Inventory, with no new schema. It reports an API version so the app can refuse a roster that's too old. Errors are JSON-RPC errors with a stable code and roster's existing user-facing wording.

**Blocked by:** None (can start immediately)

**Status:** done (roster 3661f5b)

- [x] pytest starts `roster serve` as a subprocess against an example Inventory and gets `inventory.info`: path, Box, host count, providers, roster version, API version.
- [x] `hosts.list` returns every Host and group. It agrees with `roster hosts` on names, addresses, groups and the reviewed flag.
- [x] `host.get` for an unknown name returns an error, not a crash.
- [x] Malformed JSON and unknown methods return proper JSON-RPC errors, and the server keeps running.
- [x] Nothing but JSON-RPC responses is written to stdout.
- [x] Closing stdin ends the process with exit code 0.
- [x] The API methods are documented in the README.
