# 18: Host details and web services

**Iteration:** 5 · **Repos:** roster (CLI + app) · **Spec:** 0001 (stories 79–80)

**What to build:** A Host detail panel, opened with `:info` or from the tree or picker, showing what `roster info` shows:
- address, type, product, description
- services, and which Vault item each Login uses (by name only)
- whether it's enrolled and reviewed

Any web service can be opened in the default browser from the panel or with `:open SERVICE`.

**Blocked by:** 17

**Status:** ready-for-agent

- [ ] The panel matches `roster info` for the same Host. No secret values are shown.
- [ ] Opening a web service launches the default browser at the service's URL.
