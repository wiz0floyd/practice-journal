# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working in this repository.

## Dev environment

No build toolchain is configured. Scaffold with Vite to run the app:

```sh
npm create vite@latest . -- --template react
npm install
npm run dev
```

Replace `src/App.jsx` with an import of `practice-journal.jsx` as the default export. No additional dependencies are needed — React is the only runtime requirement.

## Architecture

Single exported component (`App`) in `practice-journal.jsx`. All state, logic, and UI live in one file with no sub-files or external UI libraries.

### Data model

Two parallel arrays persisted to localStorage:
- **items** (`pj_items_v1`) — repertoire entries: `{ id, composer, title, detail }`
- **cards** (`pj_cards_v1`) — SR state per item: `{ id, bucket, sessionsUntilDue, history[] }`
- **context** (`pj_context_v1`) — freeform annotation string (orchestra/instrument/date)

`syncCards(items, cards)` reconciles the two arrays whenever items are added or deleted.

### Spaced-repetition logic

Three buckets with review intervals — **Hot** (every session), **Warm** (every 2), **Cold** (every 3). Bucket advancement after each assessment:
- 4/4 criteria passed → promote
- ≤ 2/4 → demote
- 3/4 → unchanged

`advanceBucket(currentBucket, upsCount)` (line 50) owns this rule. `sessionsUntilDue` resets to `BUCKET[newBucket].sessions` after assessment; the `advance()` function decrements it for all non-session cards when a session ends.

### View routing

String state machine via `view`: `dash → assess → result → dash` (abort returns directly to `dash`). Repertoire editor is a parallel branch: `dash ↔ repertoire`. Each view is an early-return `if` branch inside `App`.

**Verification navigation:** `Tuner`, `Metronome`, and `Recorder` only render in the `assess` view. To reach them when verifying: click "Begin session" on the dashboard first, then interact with those components.

### Recording

`Recorder` uses `ScriptProcessor` (4096-sample buffer, stereo) to accumulate raw PCM into `chunks.current.{L,R}`. On stop, `encodeWAV()` writes a stereo 16-bit WAV blob and vends an object URL. Recordings are session-scoped — they are not persisted to localStorage.

### Design system

All tokens are at the top of the file:
- `C` — color palette (parchment `#f5eed9`, burgundy action `#4a1a28`, per-bucket colors)
- `F` — font stacks (Playfair Display, Crimson Text, Special Elite — injected from Google Fonts by `useFonts()`)

Styling is entirely inline; no CSS files or UI libraries are used.
