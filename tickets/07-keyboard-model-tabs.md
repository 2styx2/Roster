# 07: Keyboard model and tabs

**Iteration:** 1 · **Repo:** roster-desk · **Spec:** 0001 (stories 34–43)

**What to build:** The full keyboard model with two focus modes.
- **Terminal mode:** every key goes to the PTY except the leader.
- **App mode:** vim bindings apply.

All bindings live in one keymap table:
- tabs: `gt`/`gT`, `<leader> 1-9`, `<leader>` then `dd` to close
- the `:` command line, with completion of commands and Host names (`:connect HOST`, `:lock`, `:close`)
- `<leader> ?` opens a help overlay generated from the keymap

The keymap and the options (leader key, vim on/off) are plain data tables with defaults, which ticket 21's `init.lua` will override. Until then they can be changed in one defaults file in the code, and there is no Settings screen. A thin tab strip shows each Session's Host name and state. Click focuses a tab, middle-click closes it and drag reorders. Every action can also be reached from a menu or button.

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] UI tests against the fake backend cover: the leader switching modes, tab switching and closing, the command line with completion, and changing the leader key.
- [ ] With vim off, `j`/`k`/`gt` do nothing special and all mouse paths still work.
- [ ] The help overlay lists the current bindings, including any you've changed.
- [ ] Manual check: drive a whole session, from opening the picker through connecting, switching tabs, closing and locking, without touching the mouse.
