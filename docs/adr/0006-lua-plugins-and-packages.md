# Lua plugins and packages, Neovim-style, built on the same registries the app uses

_Formerly roster-desk ADR 0004; renumbered when the app joined the roster repo (ADR 0007)._

The roster app can be extended the way Neovim is. A **Plugin** is Lua code, loaded through the same mlua runtime as the Config (ADR 0004), that adds to the app's registries: commands, key bindings, themes, Sidebar sections, Picker and finder sources, status-line segments, and event hooks (`on_session_open`, `on_session_exit`, `on_host_selected`, `on_lock`, …). A **Package** is a Plugin fetched from a git repo. `init.lua` lists the Packages it wants, and each is pinned to a commit in a lock file, the way lazy.nvim works. The built-in features use exactly these registries too, so a Plugin can do anything the app itself does, and the app's own code proves the API is complete.

## Boundaries

- **Never secrets.** Plugins run in the Rust core, which never holds a password (roster ADR 0001). They get Hosts and Login *references* through `roster serve`'s read methods, and can open Sessions through the normal command table. They never see a password, a vault session or an askpass token.
- **Inventory writes only as Pending changes.** A Plugin may call the same write methods as the UI, but changes always land as Pending changes that the user reviews and Publishes. A Plugin can never Publish by itself.
- **Declarative UI in v1.** Plugins add UI through the registries (commands, Sidebar sections, finder sources, status segments, themes). Plugin-supplied HTML/JS panels are not supported in v1; that would give arbitrary code the webview, and is a later decision.
- **Explicit trust.** Packages are third-party code. Nothing installs unless it's named in `init.lua`. Every Package is pinned to a commit in `roster.lock`, and updating shows a diff of what changed.

## Considered Options

- **JavaScript plugins in the webview (VS Code style)**: richer UI, but third-party code would run next to the terminal input and the master password field, and there'd be a second extension language beside the Lua config.
- **WASM components**: strong sandboxing, but far harder to write than a few lines of Lua, which is the whole appeal for people coming from Neovim.
- **No plugins, config only**: simpler, but the user wants the app to be extendable by the people using it.

## Consequences

- Every feature built from now on registers through a registry (commands, keymap, themes, Sidebar sections, finder sources, status segments, events) rather than being wired in directly. Tickets 07, 17, 21 and 22 follow this.
- The plugin API is versioned like `roster serve`'s (`roster.api_version`), and it's documented in [docs/plugins.md](../plugins.md). Permissions (decision Q81), how ticket 23 built it (Q82) and how ticket 24 built Packages (Q83) refine this ADR.
