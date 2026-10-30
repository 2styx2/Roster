# Frontend toolchain: TypeScript 6.0, ESLint 10 with typescript-eslint, no extra runtime libraries

_Formerly roster-desk ADR 0003; renumbered when the app joined the roster repo (ADR 0007)._

Ticket 03 pinned the first versions. ADR 0003 fixes Tauri and the system webview; these are the choices under it.

- **TypeScript ~6.0.3, not 7.0.** TypeScript 7.0.2 is out, but typescript-eslint 8.72 supports `>=4.8.4 <6.1.0`, and create-tauri-app 4.7.5 pins ~6.0.3 too. Move to 7 when typescript-eslint supports it. `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are on.
- **Lint:** ESLint 10 flat config, typescript-eslint `strict`, and eslint-plugin-react-hooks 7. Tests may use non-null assertions.
- **Tests:** Vitest 5 with jsdom 30 and Testing Library, as verified in `docs/app/dev/testing.md`.
- **Exact versions** in `package.json` (except TypeScript's `~`), with `package-lock.json` committed, because the Windows build copy runs `npm ci` (`docs/app/dev/windows-build-loop.md`).
- **No fuzzy-search, state or UI library yet.** The Picker's matcher is about 60 lines (`app/src/picker/match.ts`) and ranks by roster's own fields, and React state covers the app so far. Add a library only when one of these stops being enough, and record why.
- **roster-core has no async runtime.** The JSON-RPC client uses std threads and channels; app/src-tauri runs calls on Tauri's blocking pool.

## Consequences

- Upgrading TypeScript means upgrading typescript-eslint in the same change.
- The Picker's ranking is ours to tune. Its tests (`match.test.ts`) are the spec.
