# Vision

## Why

Most of the day goes into getting a shell on hosts in the team Inventory. roster already knows every Host, how to reach it and which Login opens it. Today, though, reaching one means typing `roster hosts --find`, remembering exact names, switching terminals, and doing a separate vault step for password-only gear. roster-desk is **a GUI whose whole job is getting you into the terminal quickly, then getting out of the way**.

SecureCRT is the reference point for the skeleton: saved Hosts, tabs, and logging in for you. It is not the model for the look or the workflow. Those are our own taste: terminal first, keyboard first with vim keys, and quiet, fast motion.

## Who

It's a personal tool first. If it gets good enough, and does something the other tools don't, it may be open-sourced later, or even have a small subscription. Until then, choose what feels best to use every day over what would sell.

## What already exists (checked 2026-10-29)

| Tool | What it is | How we differ |
|---|---|---|
| **XPipe** | A cross-platform connection hub, open core plus a paid Pro tier. It reads passwords from Bitwarden through the `bw` CLI, and since v22 it also uses the SSH agents built into password managers. | Closest rival. Its Hosts are a personal list, with no team Inventory in git and no review gate. |
| **Termius** | A polished terminal that syncs hosts through its own vault, on desktop and mobile. Pro is about $10/month. | Its vault and hosts are its own, not your team's vault and your git Inventory. |
| **Tabby** | A free, open-source Electron terminal with SSH, SFTP and serial. | No Inventory, and no password manager integration in the same sense. |
| **SecureCRT, MobaXterm, Royal TS, Devolutions RDM** | Older session managers. | Saved sessions per person, a dated feel. |

## What makes it different (protect these)

1. **A team Inventory in git.** One `roster.yml` is shared by every Box, and changes are Published, not copied around.
2. **Per-service Logins.** One Host can have different vault items for SSH, its web UI and its API, with authenticated web calls through `roster web`.
3. **A review gate.** Discovered Hosts aren't connectable until a person marks them reviewed.
4. **Secrets never reach the UI.** Passwords go from the vault, through roster, into `ssh`, and nothing else.
5. **"Save to vault" on first login.** A password login becomes a properly named Vault item plus a Host for the whole team.
6. **The same model the AI uses.** Claude works through the same roster without ever seeing secrets.
