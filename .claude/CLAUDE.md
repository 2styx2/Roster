# roster — notes for agents

- Module map: README "Development" (one line per file in `src/roster/`). Open only the module it points you to.
- How hosts, logins and vault items are named and added: `docs/adding-hosts.md`; setting up a box: `docs/new-box.md`.
- The live inventory is the infra repo's `roster.yml` (`~/infra`), not this repo; `examples/` holds the template.
- Vault: `roster bw <bw args>` runs the Bitwarden CLI with this box's session file, e.g. `roster bw list items --search proxmox`.
- Checks (same as CI): `uv run ruff check src tests` and `uv run pytest`. Tests use the stand-in CLIs in `tests/fakes/`.
