# 27: Worst-case UI pass (`/break-ui`)

**Iteration:** 2 · **Repo:** roster-desk · **Decision:** Q47 · **Runs with:** ticket 09 (design pass)

**What to build:** Run the `break-ui` skill over every screen: the Sidebar (Sessions, Folders, Inventory), the Picker, the command line, the Key bindings panel, the lock screen, the error and `:check` panels, the status bar, and Focus mode once 22 lands. Feed each one worst-case data behind a "Demo data / Worst case" toggle:
- **Long and unbreakable text:** names like `server-10-19-77-202-very-long-discovered-name`, long group names and long error messages.
- **Short and odd text:** one-letter names, unicode, emoji and RTL text.
- **Volume:** 0, 1 and 500+ Hosts, 50 open Sessions, 100 Folders and huge counts.
- **Missing and broken data:** missing fields such as no address or no title, long fingerprints and SHA256 strings, and the `␣`/Leader keycaps at every size.
- **Window sizes:** narrow (800px), wide, and 150% Windows scaling.

Fix everything that breaks. Already seen:
- names truncated next to the "unreviewed" badge;
- the Leader hint rendering as `_ f` rather than a keycap;
- the Folders empty-state hint wrapping badly.

**Blocked by:** 09 (they ship together)

**Status:** ready-for-agent

- [ ] The worst-case fixture is selectable in the app (`?fixture=worst-case`, and a dev-only toggle) and in UI tests.
- [ ] A screenshot of each screen in the worst case, before and after, goes in `docs/design/break-ui/`.
- [ ] Every issue found is fixed, or listed with a reason.
- [ ] Truncated names always show the full name on hover and in the Host details. No text overlaps at 800px or at 150% scaling.
