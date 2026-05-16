# Practice Journal

Anki-style spaced repetition practice tool for orchestra musicians. Track excerpts through a Hot → Warm → Cold review cycle, self-score each run against four criteria, and record takes as stereo WAV files — all in the browser with no backend.

## Features

- **Spaced repetition** — three review buckets (Hot/Warm/Cold) with automatic promotion and demotion based on self-assessment
- **Self-scoring rubric** — mark Intonation, Rhythm, Tone, and Expression pass/fail per item
- **Audio recording** — capture stereo WAV takes in-session; download any take directly
- **Repertoire editor** — add, edit, or remove practice items at any time
- **Offline-first** — all state persists to `localStorage`; no account or server required

## Getting started

Requires Node 18+.

```sh
git clone <repo-url>
cd practice-journal
npm create vite@latest . -- --template react
npm install
```

Replace the contents of `src/App.jsx` with:

```jsx
export { default } from "../practice-journal.jsx";
```

Then start the dev server:

```sh
npm run dev
```

The app runs at `http://localhost:5173` by default.

## Spaced repetition rules

| Bucket | Review interval | Promote if | Demote if |
|--------|----------------|------------|-----------|
| Hot    | every session  | 4/4 pass   | —         |
| Warm   | every 2        | 4/4 pass   | ≤ 2/4     |
| Cold   | every 3        | —          | ≤ 2/4     |

A score of 3/4 leaves the item in its current bucket.

## License

MIT — see [LICENSE](LICENSE).
