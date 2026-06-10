// ── Default content ───────────────────────────────────────────────────────────

export const DEFAULT_EXCERPTS = [
  { id: "vanhal",         composer: "VanHal",     title: "Concerto",         detail: "First movement exposition" },
  { id: "haydn",          composer: "Haydn",      title: "Symphony No. 31",  detail: "\"Horn Signal\" · Mvt. IV Var. 7 w/ repeats" },
  { id: "mahler",         composer: "Mahler",     title: "Symphony No. 1",   detail: "\"Titan\" · Mvt. III mm. 3–10" },
  { id: "stravinsky",     composer: "Stravinsky", title: "Pulcinella Suite", detail: "Mvt. VII Vivo (complete)" },
  { id: "beethoven_ii",   composer: "Beethoven",  title: "Symphony No. 5",   detail: "Mvt. II mm. 114–123" },
  { id: "beethoven_iiia", composer: "Beethoven",  title: "Symphony No. 5",   detail: "Mvt. III mm. 1–100" },
  { id: "beethoven_iiib", composer: "Beethoven",  title: "Symphony No. 5",   detail: "Mvt. III pick-up m. 141–218" },
  { id: "brahms",         composer: "Brahms",     title: "Symphony No. 2",   detail: "Mvt. I mm. 118–156" },
  { id: "strauss",        composer: "Strauss",    title: "Ein Heldenleben",  detail: "[9] → downbeat of 6th m. of [12]" },
];

// ── Config ────────────────────────────────────────────────────────────────────

export const BUCKET = {
  hot:  { label: "Hot",  sessions: 1, up: "warm", dn: null   },
  warm: { label: "Warm", sessions: 2, up: "cold", dn: "hot"  },
  cold: { label: "Cold", sessions: 3, up: null,   dn: "warm" },
};

export const DEFAULT_SETTINGS = {
  intervals: { hot: 1, warm: 2, cold: 3 },
  pomodoro:  { work: 25, break: 5 },
};

/** Sessions between reviews for a bucket, honoring user settings (clamped 1–9). */
export const bucketSessions = (bucket, settings) => {
  const n = Number(settings?.intervals?.[bucket]);
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.round(n), 9) : BUCKET[bucket].sessions;
};

export const CRITERIA = [
  { id: "intonation", label: "Intonation" },
  { id: "rhythm",     label: "Rhythm"     },
  { id: "tone",       label: "Tone"       },
  { id: "expression", label: "Expression" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

export const newId      = () => `item_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
export const isDue      = (c) => (c.sessionsUntilDue ?? 0) === 0;
export const formatDue  = (n) => !n || n <= 0 ? "due now" : n === 1 ? "next session" : `in ${n} sessions`;
export const emptyDraft = () => ({ composer: "", title: "", detail: "", notes: "", tags: "" });
export const draftValid = (d) => d.composer.trim() && d.title.trim();

export const itemTags      = (item) => Array.isArray(item?.tags) ? item.tags : [];
export const parseTags     = (s) => [...new Set(String(s ?? "").split(",").map((t) => t.trim()).filter(Boolean))];
export const isCardPinned  = (card, items) => !!items.find((i) => i.id === card.id)?.pinned;
export const cardMatchesTag = (card, items, tag) => !tag || itemTags(items.find((i) => i.id === card.id)).includes(tag);
export const sessionPool   = (cards, items, tag) => cards.filter((c) => cardMatchesTag(c, items, tag)).filter((c) => isDue(c) || isCardPinned(c, items));
export const buildQueue    = (cards, items, tag, length) => {
  const pool   = sessionPool(cards, items, tag);
  const pinned = pool.filter((c) => isCardPinned(c, items));
  const rest   = pool.filter((c) => !isCardPinned(c, items));
  return [...shuffle(pinned), ...shuffle(rest)].slice(0, Math.max(length, pinned.length));
};

export const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export const getCriteria = (settings) => {
  const cs = Array.isArray(settings?.criteria)
    ? settings.criteria.filter((c) => c && typeof c.label === "string" && c.label.trim())
    : [];
  return cs.length ? cs.slice(0, 6) : CRITERIA;
};

export const advanceBucket = (cur, ups, total = 4) => {
  if (ups / total > 0.75) return BUCKET[cur].up ?? cur;
  if (ups / total <= 0.5) return BUCKET[cur].dn ?? cur;
  return cur;
};

// ── Pomodoro / metronome helpers ──────────────────────────────────────────────

export const pomodoroMinutes = (settings, phase) => {
  const d = settings?.pomodoro ?? {};
  const n = Number(phase === "break" ? d.break : d.work);
  const fallback = phase === "break" ? 5 : 25;
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.round(n), 120) : fallback;
};

export const nextPhase = (phase) => (phase === "work" ? "break" : "work");

export const fmtClock = (totalSeconds) => {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export const tapBpm = (taps) => {
  if (!taps || taps.length < 2) return null;
  const recent = taps.slice(-4);
  const gaps = recent.slice(1).map((t, i) => t - recent[i]);
  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  if (!avg) return null;
  return Math.max(30, Math.min(240, Math.round(60000 / avg)));
};

// ── Tuner helpers ─────────────────────────────────────────────────────────────

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export const freqToNote = (freq, a4 = 440) => {
  if (!Number.isFinite(freq) || freq <= 0) return null;
  const midi = 69 + 12 * Math.log2(freq / a4);
  const nearest = Math.round(midi);
  const cents = Math.round((midi - nearest) * 100);
  return { name: NOTE_NAMES[((nearest % 12) + 12) % 12], octave: Math.floor(nearest / 12) - 1, cents };
};

export function autoCorrelate(buf, sampleRate) {
  let SIZE = buf.length;
  let rms = 0;
  for (let i = 0; i < SIZE; i++) { const v = buf[i]; rms += v * v; }
  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.01) return -1;
  let r1 = 0, r2 = SIZE - 1;
  const thres = 0.2;
  for (let i = 0; i < SIZE / 2; i++) if (Math.abs(buf[i]) < thres) { r1 = i; break; }
  for (let i = 1; i < SIZE / 2; i++) if (Math.abs(buf[SIZE - i]) < thres) { r2 = SIZE - i; break; }
  buf = buf.slice(r1, r2);
  SIZE = buf.length;
  const c = new Array(SIZE).fill(0);
  for (let i = 0; i < SIZE; i++) for (let j = 0; j < SIZE - i; j++) c[i] += buf[j] * buf[j + i];
  let d = 0; while (c[d] > c[d + 1]) d++;
  let maxval = -1, maxpos = -1;
  for (let i = d; i < SIZE; i++) if (c[i] > maxval) { maxval = c[i]; maxpos = i; }
  let T0 = maxpos;
  if (T0 <= 0) return -1;
  const x1 = c[T0 - 1], x2 = c[T0], x3 = c[T0 + 1] ?? x2;
  const a = (x1 + x3 - 2 * x2) / 2, b = (x3 - x1) / 2;
  if (a) T0 = T0 - b / (2 * a);
  return sampleRate / T0;
}

// ── WAV encoder ───────────────────────────────────────────────────────────────

export function encodeWAV(Lchunks, Rchunks, sr) {
  const merge = (cs) => {
    const out = new Float32Array(cs.reduce((n, c) => n + c.length, 0));
    let o = 0; cs.forEach((c) => { out.set(c, o); o += c.length; });
    return out;
  };
  const L = merge(Lchunks), R = merge(Rchunks);
  const n = Math.min(L.length, R.length);
  const pcm = new Int16Array(n * 2);
  for (let i = 0; i < n; i++) {
    const l = Math.max(-1, Math.min(1, L[i]));
    const r = Math.max(-1, Math.min(1, R[i]));
    pcm[i * 2]     = l < 0 ? l * 0x8000 : l * 0x7fff;
    pcm[i * 2 + 1] = r < 0 ? r * 0x8000 : r * 0x7fff;
  }
  const db  = pcm.length * 2;
  const buf = new ArrayBuffer(44 + db);
  const v   = new DataView(buf);
  const ws  = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  ws(0, "RIFF"); v.setUint32(4, 36 + db, true);
  ws(8, "WAVE"); ws(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 4, true);
  v.setUint16(32, 4,  true); v.setUint16(34, 16, true);
  ws(36, "data"); v.setUint32(40, db, true);
  new Uint8Array(buf, 44).set(new Uint8Array(pcm.buffer));
  return new Blob([buf], { type: "audio/wav" });
}

// ── Storage ───────────────────────────────────────────────────────────────────

export const KEYS = {
  items:    "pj_items_v1",
  cards:    "pj_cards_v1",
  context:  "pj_context_v1",
  settings: "pj_settings_v1",
  sessions: "pj_sessions_v1",
  badges:   "pj_badges_v1",
  meta:     "pj_meta_v1",
  active:   "pj_active_session_v1",
};

export const load = (key, fallback) => { try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fallback; } catch { return fallback; } };
export const save = (key, val)       => { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} };

export const dayKey = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };

export const streakDays = (sessions, now = new Date()) => {
  const days = new Set(sessions.map((s) => dayKey(s.date)));
  const today = dayKey(now);
  let current = days.has(today) ? now : new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (!days.has(dayKey(current))) return 0;
  let count = 0;
  while (days.has(dayKey(current))) {
    count++;
    current = new Date(current.getFullYear(), current.getMonth(), current.getDate() - 1);
  }
  return count;
};

export const weeklyStats = (sessions, cards, items, now = new Date()) => {
  const day = now.getDay(); // 0=Sun, 1=Mon, ...6=Sat
  const daysSinceMonday = (day + 6) % 7;
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday);
  const thisSessions = sessions.filter((s) => { const d = new Date(s.date); return d >= weekStart && d <= now; });
  const itemSet = new Set(thisSessions.flatMap((s) => s.itemIds ?? []));
  const itemIds = new Set(items.map((i) => i.id));
  const buckets = { hot: 0, warm: 0, cold: 0 };
  for (const c of cards) { if (itemIds.has(c.id) && buckets[c.bucket] !== undefined) buckets[c.bucket]++; }
  return {
    sessionsThisWeek: thisSessions.length,
    itemsThisWeek:    itemSet.size,
    streak:           streakDays(sessions, now),
    buckets,
  };
};

export const BADGES = [
  { id: "first_session", label: "First Session", desc: "Logged your first session" },
  { id: "streak_7",      label: "Week Streak",   desc: "Practiced 7 days in a row" },
  { id: "streak_30",     label: "Month Streak",  desc: "Practiced 30 days in a row" },
  { id: "first_cold",    label: "Ice Cold",      desc: "An item reached Cold" },
  { id: "all_warm",      label: "Warmed Up",     desc: "Every item Warm or better" },
  { id: "sessions_100",  label: "Centurion",     desc: "Logged 100 sessions" },
];

export const computeBadges = (sessions, cards, now = new Date()) => {
  const earned = [];
  if (sessions.length >= 1)   earned.push("first_session");
  const streak = streakDays(sessions, now);
  if (streak >= 7)             earned.push("streak_7");
  if (streak >= 30)            earned.push("streak_30");
  if (cards.some((c) => c.bucket === "cold"))                        earned.push("first_cold");
  if (cards.length > 0 && !cards.some((c) => c.bucket === "hot"))   earned.push("all_warm");
  if (sessions.length >= 100)  earned.push("sessions_100");
  return earned;
};

export const bucketTransitions = (history) => {
  const seq = [];
  for (const h of history ?? []) {
    if (h.bucket && seq[seq.length - 1] !== h.bucket) seq.push(h.bucket);
  }
  return seq;
};

export const scoreColor = (ups, total) => {
  const r = ups / (total || 4);
  return r > 0.75 ? "pass" : r > 0.5 ? "warm" : "fail";
};

export const buildExport = (storage = localStorage) => {
  const data = {};
  for (const k of Object.values(KEYS)) {
    if (k === KEYS.active) continue;
    const raw = storage.getItem(k);
    if (raw !== null) {
      try { data[k] = JSON.parse(raw); } catch { /* skip corrupt */ }
    }
  }
  return { app: "practice-journal", version: 1, exported: new Date().toISOString(), data };
};

export const validImport = (obj) => !!(obj && obj.app === "practice-journal" && obj.data && typeof obj.data === "object" && !Array.isArray(obj.data));

export const restoreQueue = (queueIds, cards) => (queueIds ?? []).map((id) => cards.find((c) => c.id === id)).filter(Boolean);

export const syncCards = (items, cards) => {
  const ids     = new Set(items.map((e) => e.id));
  const kept    = cards.filter((c) => ids.has(c.id));
  const haveIds = new Set(kept.map((c) => c.id));
  const added   = items.filter((e) => !haveIds.has(e.id))
    .map((e) => ({ id: e.id, bucket: "hot", sessionsUntilDue: 0, history: [] }));
  return [...kept, ...added];
};
