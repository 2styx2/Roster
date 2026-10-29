# roster-desk: notes for agents

- Start at `README.md`. The design rationale is in `docs/`, and the decisions are in `docs/decisions.md` and `docs/adr/`. Don't re-ask settled questions.
- Vocabulary: `GLOSSARY.md` here, plus roster's `GLOSSARY.md` (`../roster`) for Host, Session, Login, Pending change, Publish and so on.
- Work comes from `tickets/`. Pick from the frontier in `tickets/README.md`, stay inside the current iteration, and update the ticket's Status line.
- The backend is roster (`../roster`), reached only through `roster serve`. Never read `roster.yml` or a vault from this repo. Secrets must never reach the Rust core or the frontend (`docs/security.md`).
- TypeScript is strict and required. UI tests go through the typed backend client with a fake backend.
- UI and motion work uses the `/emil-design-eng` and `/animate` skills.
- The repo is local only while experimenting: don't add a remote or push.
- Branch workflow (same as roster and Orion): `CONTRIBUTING.md`. Work only on `feat/NN-slug` Work branches; never commit to or merge into `dev` or `main`.
