# 29: Interface review (`/interfaces:better-interface`) and fixes

**Iteration:** 2 (closing step) · **Repo:** roster (app)

**What to do:** Once 09, 27, 21 and 22 are merged, run the `interfaces:better-interface` skill over the whole app. It covers accessibility, layout, writing, typography, color and UI polish, and returns one ranked report.
1. Cover every screen and both view modes: the lock screen, Standard (Sidebar, terminal, status bar), Focus (finders, session bar), the Picker, the command line, the Key bindings panel, the error and `:check` panels, and the empty and worst-case states from 27. Use dark and light themes.
2. **Stop and show the user the ranked report.** The user picks which items to fix in this iteration. The rest become proposals for later iterations, written into `docs/app/design/interface-review.md`.
3. Implement the chosen items test-first (`/tdd`). Use the focused `interfaces:*` skills where a finding needs them, for example `better-accessibility` for focus and ARIA, `better-typography`, `better-colors` for contrast, and `better-writing` for copy.

**Blocked by:** 09, 27, 21, 22, 30, 31

**Status:** done (the user picked all 26 items; decisions in Q53)

- [x] The report is saved in `docs/app/design/interface-review.md`, with the user's picks marked.
- [x] Every picked item is fixed, each with a test where it's testable (accessibility names, focus order, contrast checks on the theme tokens, copy): `app/src/App.review.test.tsx`, `app/src/sidebar/Sidebar.a11y.test.tsx`, `app/src/theme/contrast.test.ts`, `app/src/styles.test.ts`.
- [x] Before and after screenshots of the changed screens are in `docs/app/design/review/` and `docs/app/design/review/after/` (same names), plus the Windows check in `docs/app/design/review/windows/`.
- [x] Items that weren't picked are recorded as proposals for later iterations: none were left; the new proposals that came up while fixing are at the end of the report.
