# Contributing

## Dev setup

Follow the [README](README.md) getting-started steps. The only runtime dependency is React — keep it that way.

## Code conventions

- **File structure** — currently a single file (`practice-journal.jsx`). As the app grows, split by concern: data/storage, spaced-repetition logic, recorder, and UI components are the natural seams.
- **Inline styles** — no CSS files, no UI libraries. Use the `C` (colors) and `F` (fonts) token objects at the top of the file for all values.
- **No external dependencies** — the WAV encoder, spaced repetition logic, and recorder are intentionally hand-rolled. Reach for a package only when the alternative is unreasonable complexity.
- **localStorage keys are versioned** — if you change the shape of stored data, bump the version suffix (e.g. `pj_items_v2`) and add a migration or clear the old key on load.

## Pull requests

- Branch off `main`, name branches `feature/`, `fix/`, or `chore/` prefixed.
- Keep PRs focused — one concern per PR.
- No spec files or plan files in `main` (remove before or immediately after merge).
- There are no automated tests; describe manual verification steps in the PR description.
