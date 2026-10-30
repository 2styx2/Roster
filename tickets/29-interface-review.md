# 29: Interface review (`/interfaces:better-interface`) and fixes

**Iteration:** 2 (closing step) · **Repo:** roster-desk

**What to do:** Once 09, 27, 21 and 22 are merged, run the `interfaces:better-interface` skill over the whole app. It covers accessibility, layout, writing, typography, color and UI polish, and returns one ranked report.
1. Cover every screen and both view modes: the lock screen, Standard (Sidebar, terminal, status bar), Focus (finders, session bar), the Picker, the command line, the Key bindings panel, the error and `:check` panels, and the empty and worst-case states from 27. Use dark and light themes.
2. **Stop and show the user the ranked report.** The user picks which items to fix in this iteration. The rest become proposals for later iterations, written into `docs/design/interface-review.md`.
3. Implement the chosen items test-first (`/tdd`). Use the focused `interfaces:*` skills where a finding needs them, for example `better-accessibility` for focus and ARIA, `better-typography`, `better-colors` for contrast, and `better-writing` for copy.

**Blocked by:** 09, 27, 21, 22

**Status:** ready (waits for the rest of iteration 2)

- [ ] The report is saved in `docs/design/interface-review.md`, with the user's picks marked.
- [ ] Every picked item is fixed, each with a test where it's testable (accessibility names, focus order, contrast checks on the theme tokens, copy).
- [ ] Before and after screenshots of the changed screens are in `docs/design/`.
- [ ] Items that weren't picked are recorded as proposals for later iterations.
