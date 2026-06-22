# Contributing

## Dev setup

Follow the [README](README.md) getting-started steps, then:

```sh
npm install
npm run dev       # Vite dev server at localhost:5173
npm test          # Vitest unit tests (~230 tests in src/lib/sr.test.js)
npx playwright test tests/a11y.spec.js   # WCAG AA tests — requires running dev server
npx playwright test tests/pas.spec.js    # PAS regression tests — requires running dev server
```

**Cloud sync (optional):** Copy `.env.example` → `.env` and populate `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Without these the app runs in offline/localStorage-only mode; all tests still pass.

## Branch model

This repo uses two long-lived branches:

| Branch | Deploys to | Purpose |
|--------|-----------|---------|
| `practice-journal-dev` | `/practice-journal/dev/` | Integration — preview of next release |
| `main` | `/practice-journal/` | Production |

**Feature work:**
1. Branch from `practice-journal-dev`: `git checkout -b feature/issue-<N>-<slug>`
2. Open a PR targeting **`practice-journal-dev`** — CI runs lint, unit tests, and the Playwright suite
3. After the PR merges, the dev sub-page updates automatically

**Releasing to production:**
- When `practice-journal-dev` is stable, open a PR from `practice-journal-dev` → `main`
- This is a squash merge; the commit message becomes the release summary

Branch prefixes: `feature/`, `fix/`, `chore/`

## Code conventions

- **File structure** — currently a single file (`practice-journal.jsx`). As the app grows, split by concern: data/storage, spaced-repetition logic, recorder, and UI components are the natural seams. Pure helpers live in `src/lib/sr.js` (tested via `sr.test.js`).
- **Inline styles** — no CSS files, no UI library. Use the `C` (colors) and `F` (fonts) token objects at the top of the file for all values.
- **Storage layers** — `localStorage` for SR state, settings, sessions, and badges (`pj_*_v1` keys); `IndexedDB` for binary data (`pj_attachments_v1` for sheet music, `pj_recordings_v1` for takes). If you change a stored data shape, bump the version suffix (e.g. `pj_items_v2`) and add a migration or clear the old key on load.
- **Drag interactions** — use `@dnd-kit/sortable` (already a dependency); avoid hand-rolled pointer/touch handlers.
- **Runtime dependencies** — keep them minimal. The current runtime deps are `@supabase/supabase-js` and `@dnd-kit/*`. Reach for a package only when hand-rolling would be unreasonable complexity.

## Pull requests

- Keep PRs focused — one concern per PR.
- No spec files or plan files in `main` (remove before or immediately after merge).
- Describe manual verification steps alongside any automated test coverage in the PR description.
- All views must pass WCAG 2.1 AA — the `tests/a11y.spec.js` Playwright suite checks this at desktop, tablet, and mobile viewports.
- If the PR touches `sync.js`, Supabase migrations, or cloud recording paths, include a manual smoke test confirming round-trip sync (sign in → mutate → sign in on a second browser).
