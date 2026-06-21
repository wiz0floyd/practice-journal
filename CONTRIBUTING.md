# Contributing

## Dev setup

Follow the [README](README.md) getting-started steps.

```sh
npm install
npm run dev       # Vite dev server at localhost:5173
npm test          # Vitest unit tests
npx playwright test   # Playwright end-to-end + WCAG tests (requires running dev server)
```

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

- **File structure** — currently a single file (`practice-journal.jsx`). As the app grows, split by concern: data/storage, spaced-repetition logic, recorder, and UI components are the natural seams.
- **Inline styles** — no CSS files, no UI library. Use the `C` (colors) and `F` (fonts) token objects at the top of the file for all values.
- **Runtime dependencies** — keep them minimal. Reach for a package only when hand-rolling would be unreasonable complexity.
- **localStorage keys are versioned** — if you change the shape of stored data, bump the version suffix (e.g. `pj_items_v2`) and add a migration or clear the old key on load.

## Pull requests

- Keep PRs focused — one concern per PR.
- No spec files or plan files in `main` (remove before or immediately after merge).
- Describe manual verification steps alongside any automated test coverage in the PR description.
- All views must pass WCAG 2.1 AA — the `tests/a11y.spec.js` Playwright suite checks this at desktop, tablet, and mobile viewports.
