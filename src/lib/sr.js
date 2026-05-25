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
export const emptyDraft = () => ({ composer: "", title: "", detail: "" });
export const draftValid = (d) => d.composer.trim() && d.title.trim();

export const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export const advanceBucket = (cur, ups) => {
  if (ups === 4) return BUCKET[cur].up ?? cur;
  if (ups <= 2)  return BUCKET[cur].dn ?? cur;
  return cur;
};

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
  items:   "pj_items_v1",
  cards:   "pj_cards_v1",
  context: "pj_context_v1",
  meta:    "pj_meta_v1",
};

export const load = (key, fallback) => { try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fallback; } catch { return fallback; } };
export const save = (key, val)       => { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} };

export const syncCards = (items, cards) => {
  const ids     = new Set(items.map((e) => e.id));
  const kept    = cards.filter((c) => ids.has(c.id));
  const haveIds = new Set(kept.map((c) => c.id));
  const added   = items.filter((e) => !haveIds.has(e.id))
    .map((e) => ({ id: e.id, bucket: "hot", sessionsUntilDue: 0, history: [] }));
  return [...kept, ...added];
};
