# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase. roster is **single-context**: one glossary and one ADR folder cover the CLI and the app.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root (one file for the CLI and the app).
- **`docs/adr/`**: read ADRs that touch the area you're about to work in.
- **`docs/app/decisions.md`**: the numbered decision log (`Q56`, `Q62`, …). Settled questions are not re-asked.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

```text
/
├── GLOSSARY.md
├── docs/
│   ├── adr/
│   │   ├── 0001-gui-talks-to-roster-serve.md
│   │   └── …
│   └── app/decisions.md
├── src/roster/        ← the CLI
├── app/               ← the desktop app
└── crates/roster-core/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR or decision, surface it explicitly rather than silently overriding:

> _Contradicts ADR 0001 (the app talks to `roster serve`), but worth reopening because…_
