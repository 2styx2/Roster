# Roadmap

We work in iterations. Each one ends with a hands-on check on the Windows machine, against real Hosts (one key-enrolled, one password-only, one unreviewed), before the next one starts. Tickets and their blockers are in [../tickets/README.md](../tickets/README.md).

| # | Iteration | Tickets | Done when |
|---|---|---|---|
| 1 | **Thin slice** | 01–08, 17 | You can unlock, pick a Host, and get a working shell on both an enrolled and a password-only Host over the WSL backend, all from the keyboard |
| 2 | **Design pass + Lua config + Focus mode** (`/emil-design-eng`, `/animate`) | 09, 21, 22 | You're happy with how it looks and feels on Windows, and `init.lua` can restyle and rebind it with live reload |
| 3 | **Inventory writes** | 10–12 | You can add or edit a Host, see the diff, Publish, and another Box picks the change up |
| 4 | **Quick Connect + "Save to vault"** | 13–16 | A new box reached by IP and password becomes a Vault item plus a Host |
| 5 | **Host details** | 18 | Detail panel, opening web services |
| 6 | **Other platforms** | 19–20 | Native Windows backend; Linux under X11, Wayland and WSLg |

Later, not planned yet: split panes, broadcast input, SFTP, port forwarding, discover from the app, writing to other providers, MRs instead of pushing, macOS, packaging and distribution, open-sourcing.
