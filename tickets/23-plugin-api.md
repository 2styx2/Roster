# 23: Lua Plugin API

**Iteration:** 7 · **Repo:** roster (app) · **Spec:** 0001 (stories 97–98) · **ADR:** 0006

**What to build:** Expose the app's registries to Lua: commands, keymap, themes, Sidebar sections, finder sources (for `␣ f`, `␣ b` and Plugin-defined finders), status-line segments, and events (`on_session_open`, `on_session_exit`, `on_host_selected`, `on_lock`, `on_unlock`, `on_config_reload`). The API is a `roster` Lua module with a version number. Plugins can read Hosts, groups and Login references through `roster serve`'s read methods, open Sessions through commands, and propose Inventory edits, which only become Pending changes. Errors in a Plugin are isolated: a toast names the Plugin and the line, the Plugin is disabled, and the app keeps running.

**Blocked by:** 21, 22

**Status:** ready-for-agent

- [ ] At least one built-in feature (for example the Folders Sidebar section) is re-implemented as an internal Plugin on the public API, proving the registries are complete.
- [ ] Tests: a Plugin adds a command, a key, a theme, a Sidebar section, a finder source and a status segment, and reacts to `on_session_open`. A Plugin can't read a password, vault session or askpass token by any API path (asserted). A Plugin's Inventory edit becomes a Pending change and can't Publish.
- [ ] A crashing or slow Plugin can't freeze the UI. Hooks have a time budget, and repeat offenders are disabled.
- [ ] `docs/plugins.md` with the API reference and an example Plugin.
