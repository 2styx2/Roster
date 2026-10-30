# 24: Packages (lazy.nvim-style)

**Iteration:** 7 · **Repo:** roster (app) · **Spec:** 0001 (story 96) · **ADR:** 0006

**What to build:**
- **Declaring Packages:** `init.lua` declares Packages as `{ "owner/repo", tag = …, config = function() … end }`, or with a full git URL. The app clones each one into its data dir and pins the commit in `roster.lock`, next to `init.lua`, so the lock file can live in dotfiles.
- **Loading:** the app loads each Package as a Plugin (ticket 23).
- **Commands:**
  - `:packages`: lists installed Packages, their state and any errors.
  - `:packages update`: shows each Package's diff and new commit before applying it.
  - `:packages clean`: removes Packages no longer listed.
- **Trust:** nothing installs that isn't named in `init.lua`.

**Blocked by:** 23

**Status:** ready-for-agent

- [ ] Tests with a local bare git repo as the Package source: install, the lock is written, reinstalling from the lock gives the same commit, update shows the diff, clean removes it.
- [ ] Offline start works from the lock and the existing clones.
- [ ] Manual check: install a small example Package from a git URL that adds a command and a theme.
