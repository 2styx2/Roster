# Tickets

One file per ticket, numbered so that blockers come first. **Frontier** means every ticket whose blockers are all done. Change `**Status:**` as work moves: `ready-for-agent`, then `in-progress`, then `done`.

| # | Ticket | Iteration | Blocked by | Status |
|---|---|---|---|---|
| 01 | [Unlock and lock the vault without a terminal (prefactor)](01-vault-unlock-lock-prefactor.md) | 1 | — | done |
| 02 | [`roster serve`: read-only API](02-roster-serve-read-api.md) | 1 | — | done |
| 03 | [App skeleton: window → WSL backend → host picker](03-app-skeleton-picker.md) | 1 | 02 | done |
| 04 | [Lock screen and idle lock](04-lock-screen.md) | 1 | 01, 03 | done |
| 05 | [Sessions to key-enrolled Hosts](05-key-sessions.md) | 1 | 03 | done |
| 06 | [Sessions to password-only Hosts (askpass)](06-password-sessions-askpass.md) | 1 | 04, 05 | ready |
| 07 | [Keyboard model and the Session Sidebar](07-keyboard-model-tabs.md) | 1 | 05 | ready |
| 17 | [Inventory tree and Folders in the Sidebar](17-host-tree-panel.md) | 1 | 07 | ready |
| 08 | [Terminal comfort](08-terminal-comfort.md) | 1 | 05 | ready |
| 09 | [Design pass](09-design-pass.md) | 2 | 07, 08, 17 | ready |
| 21 | [Lua config (`init.lua`)](21-lua-config.md) | 2 | 09 | ready |
| 22 | [Focus mode](22-focus-mode.md) | 2 | 07, 17 | ready |
| 10 | [Edit a Host → Pending change → diff/discard](10-edit-host-pending-changes.md) | 3 | 04 | ready |
| 11 | [Add a Host and mark it reviewed](11-add-host-review.md) | 3 | 10 | ready |
| 12 | [Publish](12-publish.md) | 3 | 10 | ready |
| 13 | [Bitwarden can create Vault items (prefactor)](13-bitwarden-create-item.md) | 4 | 01 | ready |
| 14 | [Quick Connect](14-quick-connect.md) | 4 | 06 | ready |
| 15 | ["Save to vault" on Quick Connect](15-save-to-vault.md) | 4 | 11, 13, 14 | ready |
| 16 | ["Save to vault" for `auth: prompt` Hosts](16-save-to-vault-prompt-hosts.md) | 4 | 15 | ready |
| 23 | [Lua Plugin API](23-plugin-api.md) | 7 | 21, 22 | ready |
| 24 | [Packages (lazy.nvim-style)](24-package-manager.md) | 7 | 23 | ready |
| 18 | [Host details and web services](18-host-details-web.md) | 5 | 17 | ready |
| 19 | [Native Windows backend](19-native-windows-backend.md) | 6 | 06 | ready |
| 20 | [Linux build check](20-linux-build.md) | 6 | 08 | ready |

**Current frontier:** 06, 07, 08, then 17 (needs 07). Iterations run in order.
