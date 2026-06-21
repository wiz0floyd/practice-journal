# Practice Journal

Spaced-repetition practice tool for orchestra musicians, built around the Kaplan PAS (Practice Audition System) method. Track excerpts through three review categories, self-score each run against a customizable rubric, record takes, and sync progress across devices — all in the browser.

## Features

### Spaced repetition
- **Kaplan categories** — three levels (c / b / a) with automatic promotion and demotion based on self-assessment
- **Configurable intervals** — override the default review cadence per category in Settings
- **Custom rubric** — 1–6 assessment criteria (default: Intonation, Rhythm, Tone, Expression); add, remove, or rename in Settings
- **Priority pins** — pinned items always enter the session regardless of SR due-date

### Repertoire
- **Composer — Title format** — consistent display with movement/section as a second line
- **Tag chips** — tag items and filter the session queue by tag from the dashboard
- **Per-card notes** — freeform notes per item, shown during assessment
- **Sheet music** — attach a PDF or image (≤ 15 MB) per item; displayed beside the rubric on wide screens
- **Expandable rows** — tap any item on the dashboard to reveal notes, tags, and an Edit link

### Practice session
- **Chromatic tuner** — note name, octave, and cents bar; microphone permission requested lazily
- **Strobe tuner** — 5-ring canvas display driven by FFT overtone magnitudes; rings freeze when in tune
- **Metronome** — BPM stepper, tap-tempo (last 4 taps), and an accented downbeat via Web Audio
- **Pomodoro timer** — configurable work/break cycles with a corner overlay that persists across views
- **Session notes** — write a free-text note after each session; stored in the history view

### Daily Practice Organizer (DPO)
- Kaplan PAS planning view — add segments, drag-and-drop to reorder, track berry criterion completions per row

### History & progress
- **History view** — total sessions, current streak, per-item score-trend squares, bucket transitions, and recent notes
- **Weekly stats panel** — sessions this week, items practiced, day streak, category distribution
- **Badges** — 6 achievement badges (First Session, Week Streak, Month Streak, Ice Cold, In Progress, Centurion); toasted on first earn

### Data & sync
- **Cloud sync** — sign in with Google (Supabase OAuth) to sync items, cards, settings, sessions, and badges across devices; last-write-wins with server timestamp
- **Offline queue** — failed writes are queued in localStorage and flushed on reconnect or sign-in
- **First-login migration** — detects local vs. cloud data on first sign-in and offers Merge / Use cloud / Keep local
- **Cloud recording storage** — opt-in upload of takes to Supabase Storage (Settings → Recordings); loads on demand on other devices
- **JSON backup** — export all data to a dated `.json` file; import restores the full snapshot
- **Session resume** — interrupted sessions are snapshotted and resumable from the dashboard on next visit

### Accessibility
- WCAG 2.1 AA compliant — tested by `@axe-core/playwright` across desktop, tablet, and mobile viewports

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

**Optional — cloud sync and auth:** Copy `.env.example` to `.env` and fill in your Supabase project URL and anon key. Without these the app works fully in offline/localStorage mode.

```sh
cp .env.example .env
# edit .env with your VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
```

Start the dev server:

```sh
npm run dev
```

The app runs at `http://localhost:5173` by default.

## Spaced repetition rules

Categories default to the following cadence (configurable in Settings → Review intervals):

| Category | Label | Default interval | Promote if | Demote if |
|----------|-------|-----------------|------------|-----------|
| c | Needs Work | every session | >75% pass | — |
| b | In Progress | every 2 sessions | >75% pass | ≤ 50% pass |
| a | Performance-Ready | every 3 sessions | — | ≤ 50% pass |

With the default 4-criterion rubric: promote at 4/4, demote at ≤ 2/4, stay at 3/4. Thresholds scale proportionally when criteria count changes.

## License

MIT — see [LICENSE](LICENSE).
