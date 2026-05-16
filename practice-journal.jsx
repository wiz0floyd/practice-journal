import { useState, useEffect, useRef } from "react";
import {
  BUCKET, CRITERIA, DEFAULT_EXCERPTS,
  isDue, formatDue, draftValid, emptyDraft, newId, shuffle,
  advanceBucket, encodeWAV, syncCards, KEYS, load, save,
} from "./src/lib/sr.js";
import { supabase } from "./src/lib/supabase.js";

const longDate = () => new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

// ── Design tokens ─────────────────────────────────────────────────────────────

const C = {
  paper:   "#f5eed9", paperLt: "#faf6ec",
  ink:     "#1c1209", inkMid:  "#4a3d2c", inkFaint: "#9a8a72",
  rule:    "#d8cdb5", ruleDk:  "#b5a58a",
  action:  "#4a1a28",
  hot:     "#8b1a1a", warm: "#7a5017", cold: "#1a3d5c",
  pass:    "#1a4a1a", fail: "#7a1a1a",
};

const F = {
  display: "'Playfair Display', Georgia, serif",
  body:    "'Crimson Text', Georgia, serif",
  stamp:   "'Special Elite', 'Courier New', monospace",
};

// ── Font loader ───────────────────────────────────────────────────────────────

function useFonts() {
  useEffect(() => {
    const link = document.createElement("link");
    link.rel  = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Crimson+Text:ital,wght@0,400;0,600;1,400;1,600&family=Special+Elite&display=swap";
    document.head.appendChild(link);
    return () => { try { document.head.removeChild(link); } catch {} };
  }, []);
}

// ── Primitives ────────────────────────────────────────────────────────────────

const Rule = ({ thick } = {}) => (
  <div style={{ borderTop: `${thick ? "1.5px" : "1px"} solid ${thick ? C.ruleDk : C.rule}`, margin: thick ? "1.25rem 0" : "0.75rem 0" }} />
);

function Badge({ bucket }) {
  const color = { hot: C.hot, warm: C.warm, cold: C.cold }[bucket];
  return (
    <span style={{ fontFamily: F.stamp, fontSize: "0.6rem", letterSpacing: "0.12em", textTransform: "uppercase", color, border: `1px solid ${color}`, padding: "1px 5px", borderRadius: "1px", display: "inline-block", lineHeight: 1.6 }}>
      {BUCKET[bucket].label}
    </span>
  );
}

function MarkButton({ active, variant, onClick, children }) {
  const ac = variant === "pass" ? C.pass : C.fail;
  return (
    <button onClick={onClick} style={{ width: "2.6rem", height: "2.6rem", border: `1.5px solid ${active ? ac : C.rule}`, background: active ? ac : "transparent", color: active ? C.paperLt : C.inkFaint, borderRadius: "1px", cursor: "pointer", fontFamily: F.display, fontSize: "1.15rem", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.1s", lineHeight: 1 }}>
      {children}
    </button>
  );
}

function JournalInput({ value, onChange, placeholder, style = {} }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{ fontFamily: F.body, fontSize: "1rem", color: C.ink, background: "transparent", border: "none", borderBottom: `1px solid ${C.rule}`, outline: "none", width: "100%", padding: "3px 0 2px", borderRadius: 0, ...style }}
    />
  );
}

const inkBtn = (extra = {}) => ({
  background: "none", border: "none", cursor: "pointer",
  fontFamily: F.stamp, fontSize: "0.6rem", letterSpacing: "0.1em",
  textTransform: "uppercase", padding: 0, ...extra,
});

// ── Editable context line ─────────────────────────────────────────────────────

function ContextLine({ value, onChange }) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(value);
  const inputRef = useRef(null);

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const commit = () => { onChange(draft.trim()); setEditing(false); };
  const cancel = () => { setDraft(value); setEditing(false); };

  if (editing) return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.25rem" }}>
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") cancel(); }}
        placeholder="Orchestra · instrument · date…"
        style={{ fontFamily: F.body, fontStyle: "italic", fontSize: "1.05rem", color: C.inkMid, background: "transparent", border: "none", borderBottom: `1px solid ${C.ruleDk}`, outline: "none", flex: 1, padding: "2px 0" }}
      />
      <button onClick={commit} style={inkBtn({ color: C.action })}>save</button>
      <button onClick={cancel} style={inkBtn({ color: C.inkFaint })}>×</button>
    </div>
  );

  return (
    <button
      onClick={() => { setDraft(value); setEditing(true); }}
      style={{ background: "none", border: "none", cursor: "text", padding: 0, display: "block", textAlign: "left", marginTop: "0.25rem" }}
    >
      <span style={{ fontFamily: F.body, fontStyle: "italic", fontSize: "1.05rem", color: value ? C.inkMid : C.inkFaint }}>
        {value || "Add context…"}
      </span>
    </button>
  );
}

// ── Session slider ────────────────────────────────────────────────────────────

function SessionSlider({ value, onChange, dueCount, maxItems }) {
  const max       = Math.max(maxItems, 1);
  const effective = Math.min(value, dueCount);
  const label     = dueCount === 0 ? "nothing due" : value >= dueCount ? `all ${dueCount} due` : `${effective} of ${dueCount} due`;

  return (
    <div style={{ marginBottom: "1.25rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.5rem" }}>
        <p style={{ fontFamily: F.stamp, fontSize: "0.6rem", letterSpacing: "0.15em", textTransform: "uppercase", color: C.inkFaint }}>Items per session</p>
        <span style={{ fontFamily: F.stamp, fontSize: "0.65rem", color: C.inkMid, letterSpacing: "0.04em" }}>
          {value >= max ? "all" : value} · {label}
        </span>
      </div>
      <div style={{ position: "relative", paddingBottom: "1rem" }}>
        <input type="range" min={1} max={max} value={Math.min(value, max)} onChange={(e) => onChange(Number(e.target.value))} style={{ width: "100%", margin: 0 }} />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.15rem" }}>
          {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
            <span key={n} style={{ fontFamily: F.stamp, fontSize: "0.5rem", color: n === Math.min(value, max) ? C.inkMid : C.rule, lineHeight: 1, userSelect: "none" }}>
              {n === max ? "all" : n}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Recorder ──────────────────────────────────────────────────────────────────

function Recorder({ itemId }) {
  const [state, setState] = useState("idle");
  const [recs,  setRecs]  = useState([]);
  const [err,   setErr]   = useState("");
  const ctxRef = useRef(null), procRef = useRef(null), streamRef = useRef(null);
  const chunks = useRef({ L: [], R: [] });

  const start = async () => {
    setErr("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 2, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      streamRef.current = stream;
      const audioCtx = new AudioContext(); ctxRef.current = audioCtx;
      const src  = audioCtx.createMediaStreamSource(stream);
      const proc = audioCtx.createScriptProcessor(4096, 2, 2); procRef.current = proc;
      chunks.current = { L: [], R: [] };
      proc.onaudioprocess = (e) => {
        chunks.current.L.push(new Float32Array(e.inputBuffer.getChannelData(0)));
        chunks.current.R.push(new Float32Array(e.inputBuffer.getChannelData(1)));
      };
      const sink = audioCtx.createGain(); sink.gain.value = 0;
      src.connect(proc); proc.connect(sink); sink.connect(audioCtx.destination);
      setState("recording");
    } catch (e) { setErr(e.message); }
  };

  const stop = () => {
    const sr = ctxRef.current?.sampleRate ?? 48000;
    procRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    ctxRef.current?.close();
    const url = URL.createObjectURL(encodeWAV(chunks.current.L, chunks.current.R, sr));
    const ts  = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    setRecs((p) => [...p, { url, ts }]);
    procRef.current = null; ctxRef.current = null; streamRef.current = null;
    setState("idle");
  };

  return (
    <div style={{ marginTop: "1.5rem", paddingTop: "1rem", borderTop: `1px dashed ${C.rule}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: recs.length ? "0.75rem" : 0 }}>
        <button onClick={state === "idle" ? start : stop} style={{ fontFamily: F.body, fontStyle: "italic", fontSize: "0.95rem", padding: "3px 10px", background: "transparent", border: `1px solid ${state === "recording" ? C.fail : C.rule}`, color: state === "recording" ? C.fail : C.inkFaint, borderRadius: "1px", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: state === "recording" ? C.fail : C.ruleDk, animation: state === "recording" ? "recpulse 1s infinite" : "none" }} />
          {state === "recording" ? "Stop recording" : "Record take"}
        </button>
        {err && <span style={{ fontFamily: F.stamp, fontSize: "0.6rem", color: C.fail }}>{err}</span>}
      </div>
      {recs.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          {recs.map((r, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ fontFamily: F.stamp, fontSize: "0.6rem", color: C.inkFaint, flexShrink: 0 }}>{i + 1}.</span>
              <audio src={r.url} controls style={{ flex: 1, height: "26px", minWidth: 0 }} />
              <a href={r.url} download={`take_${itemId}_${r.ts.replace(/:/g, "")}.wav`} style={{ fontFamily: F.stamp, fontSize: "0.6rem", color: C.inkMid, textDecoration: "none", border: `1px solid ${C.rule}`, padding: "2px 5px", borderRadius: "1px", flexShrink: 0 }}>↓ wav</a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Page shell ────────────────────────────────────────────────────────────────

function Page({ children }) {
  return (
    <div style={{ minHeight: "100vh", background: C.paper, fontFamily: F.body, color: C.ink }}>
      <style>{`
        @keyframes recpulse { 0%,100%{opacity:1} 50%{opacity:0.2} }
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        button { appearance: none; }
        audio  { accent-color: ${C.action}; }
        body   { background: ${C.paper}; }
        input::placeholder { color: ${C.inkFaint}; font-style: italic; font-family: ${F.body}; }
        input[type="range"] { -webkit-appearance: none; appearance: none; width: 100%; height: 1px; background: ${C.ruleDk}; outline: none; border: none; cursor: pointer; }
        input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 11px; height: 11px; background: ${C.action}; border-radius: 1px; cursor: pointer; }
        input[type="range"]::-moz-range-thumb { width: 11px; height: 11px; background: ${C.action}; border-radius: 1px; cursor: pointer; border: none; }
        input[type="range"]::-webkit-slider-runnable-track { background: ${C.ruleDk}; height: 1px; }
        input[type="range"]::-moz-range-track { background: ${C.ruleDk}; height: 1px; }
      `}</style>
      <div style={{ maxWidth: 420, margin: "0 auto", padding: "2.25rem 1.5rem 3rem" }}>
        {children}
      </div>
    </div>
  );
}

// ── Auth ──────────────────────────────────────────────────────────────────────

function useAuth() {
  const [user, setUser] = useState(null);
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);
  const signIn = () => supabase?.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin + import.meta.env.BASE_URL },
  });
  const signOut = () => supabase?.auth.signOut();
  return { user, signIn, signOut };
}

function AccountButton({ user, signIn, signOut }) {
  if (!supabase) return null;
  if (!user) return (
    <button onClick={signIn} style={{
      fontFamily: F.stamp, fontSize: "0.58rem", letterSpacing: "0.1em",
      textTransform: "uppercase", color: C.action, background: "none",
      border: `1px solid ${C.action}`, borderRadius: "2px",
      padding: "0.25rem 0.5rem", cursor: "pointer",
    }}>
      Sign in
    </button>
  );
  return (
    <img
      src={user.user_metadata?.avatar_url}
      alt={user.user_metadata?.full_name ?? "Account"}
      title={`${user.user_metadata?.full_name ?? user.email} · click to sign out`}
      onClick={signOut}
      style={{ width: 28, height: 28, borderRadius: "50%", cursor: "pointer",
               border: `2px solid ${C.rule}`, display: "block" }}
    />
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  useFonts();
  const { user, signIn, signOut } = useAuth();

  const [items,         setItems]         = useState(() => load(KEYS.items,   DEFAULT_EXCERPTS));
  const [cards,         setCards]         = useState(() => syncCards(load(KEYS.items, DEFAULT_EXCERPTS), load(KEYS.cards, [])));
  const [context,       setContext]       = useState(() => load(KEYS.context, ""));
  const [view,          setView]          = useState("dash");
  const [queue,         setQueue]         = useState([]);
  const [idx,           setIdx]           = useState(0);
  const [scores,        setScores]        = useState({});
  const [result,        setResult]        = useState(null);
  const [sessionLength, setSessionLength] = useState(4);

  // Repertoire edit state
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState(emptyDraft());
  const [newDraft,  setNewDraft]  = useState(emptyDraft());
  const [showAdd,   setShowAdd]   = useState(false);

  useEffect(() => { save(KEYS.items, items); }, [items]);
  useEffect(() => { save(KEYS.cards,   cards);   }, [cards]);
  useEffect(() => { save(KEYS.context, context); }, [context]);

  const dueCards = cards.filter(isDue);
  const card     = queue[idx];
  const item     = card ? items.find((e) => e.id === card.id) : null;

  // ── Session ───────────────────────────────────────────────────────────────

  const startSession = () => {
    setQueue(shuffle(dueCards).slice(0, sessionLength));
    setIdx(0); setScores({}); setResult(null);
    setView("assess");
  };

  const toggleScore = (id, val) => setScores((p) => ({ ...p, [id]: p[id] === val ? undefined : val }));

  const allRated = CRITERIA.every((c) => scores[c.id] !== undefined);

  const submit = () => {
    const ups    = CRITERIA.filter((c) => scores[c.id] === true).length;
    const nb     = advanceBucket(card.bucket, ups);
    const failed = CRITERIA.filter((c) => scores[c.id] === false).map((c) => c.label);
    setCards((prev) => prev.map((c) => c.id !== card.id ? c : {
      ...c, bucket: nb, sessionsUntilDue: BUCKET[nb].sessions,
      history: [...c.history, { date: new Date().toISOString(), scores: { ...scores }, ups }],
    }));
    setResult({ item, oldBucket: card.bucket, newBucket: nb, ups, failed });
    setView("result");
  };

  const advance = () => {
    if (idx + 1 >= queue.length) {
      const sessionIds = new Set(queue.map((q) => q.id));
      setCards((prev) => prev.map((c) =>
        sessionIds.has(c.id) ? c : { ...c, sessionsUntilDue: Math.max(0, (c.sessionsUntilDue ?? 0) - 1) }
      ));
      setView("dash");
    } else {
      setIdx((i) => i + 1); setScores({}); setView("assess");
    }
  };

  // ── Repertoire ────────────────────────────────────────────────────────────

  const startEdit  = (it) => { setEditingId(it.id); setEditDraft({ composer: it.composer, title: it.title, detail: it.detail }); };
  const cancelEdit = ()   => { setEditingId(null); setEditDraft(emptyDraft()); };

  const saveEdit = () => {
    setItems((prev) => prev.map((e) => e.id !== editingId ? e : { ...e, ...editDraft }));
    cancelEdit();
  };

  const deleteItem = (id) => {
    if (!window.confirm("Remove this item?")) return;
    setItems((prev) => prev.filter((e) => e.id !== id));
    setCards((prev) => prev.filter((c) => c.id !== id));
  };

  const addItem = () => {
    if (!draftValid(newDraft)) return;
    const id = newId();
    setItems((prev) => [...prev, { id, composer: newDraft.composer.trim(), title: newDraft.title.trim(), detail: newDraft.detail.trim() }]);
    setCards((prev) => [...prev, { id, bucket: "hot", sessionsUntilDue: 0, history: [] }]);
    setNewDraft(emptyDraft()); setShowAdd(false);
  };

  // ── Dashboard ─────────────────────────────────────────────────────────────

  if (view === "dash") return (
    <Page>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.4rem" }}>
        <p style={{ fontFamily: F.stamp, fontSize: "0.6rem", letterSpacing: "0.16em", textTransform: "uppercase", color: C.inkFaint, margin: 0 }}>
          Practice Journal
        </p>
        <AccountButton user={user} signIn={signIn} signOut={signOut} />
      </div>
      <h1 style={{ fontFamily: F.display, fontSize: "2rem", fontWeight: 700, color: C.ink, lineHeight: 1.1 }}>
        {longDate()}
      </h1>
      <ContextLine value={context} onChange={setContext} />

      <Rule thick />
      <SessionSlider value={sessionLength} onChange={setSessionLength} dueCount={dueCards.length} maxItems={items.length} />

      {dueCards.length > 0 ? (
        <button onClick={startSession} style={{ width: "100%", marginBottom: "1.75rem", fontFamily: F.display, fontSize: "1.05rem", padding: "0.8rem 1rem", background: C.action, color: C.paperLt, border: "none", borderRadius: "1px", cursor: "pointer" }}>
          Begin session — {Math.min(sessionLength, dueCards.length)} {Math.min(sessionLength, dueCards.length) === 1 ? "item" : "items"}
        </button>
      ) : (
        <div style={{ marginBottom: "1.75rem", padding: "0.75rem", border: `1px solid ${C.rule}`, textAlign: "center", fontStyle: "italic", color: C.inkFaint, fontSize: "1rem" }}>
          Nothing due — complete a session to advance the queue
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.6rem" }}>
        <p style={{ fontFamily: F.stamp, fontSize: "0.6rem", letterSpacing: "0.15em", textTransform: "uppercase", color: C.inkFaint }}>Repertoire</p>
        <button onClick={() => { setEditingId(null); setShowAdd(false); setView("repertoire"); }} style={inkBtn({ color: C.inkFaint })}>Edit →</button>
      </div>

      {cards.map((c) => {
        const it  = items.find((e) => e.id === c.id);
        if (!it) return null;
        const due = isDue(c);
        return (
          <div key={c.id}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", padding: "0.65rem 0", opacity: due ? 1 : 0.5 }}>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: "1rem", lineHeight: 1.3, color: C.ink }}>
                  <span style={{ fontWeight: 600 }}>{it.composer}</span>
                  <span style={{ color: C.inkFaint }}> · </span>
                  <span style={{ fontStyle: "italic" }}>{it.title}</span>
                </p>
                {it.detail && <p style={{ fontSize: "0.85rem", color: C.inkFaint, marginTop: "0.1rem", fontStyle: "italic" }}>{it.detail}</p>}
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.3rem", flexShrink: 0 }}>
                <Badge bucket={c.bucket} />
                <span style={{ fontFamily: F.stamp, fontSize: "0.58rem", color: due ? C.warm : C.inkFaint, letterSpacing: "0.04em" }}>
                  {formatDue(c.sessionsUntilDue ?? 0)}
                </span>
              </div>
            </div>
            <div style={{ borderTop: `1px solid ${C.rule}` }} />
          </div>
        );
      })}

      <div style={{ marginTop: "1.5rem", textAlign: "center" }}>
        <button onClick={() => { if (window.confirm("Reset all cards to Hot?")) setCards(syncCards(items, [])); }} style={inkBtn({ color: C.inkFaint })}>
          Reset all cards
        </button>
      </div>
    </Page>
  );

  // ── Repertoire ────────────────────────────────────────────────────────────

  if (view === "repertoire") return (
    <Page>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "1.25rem" }}>
        <button onClick={() => { cancelEdit(); setShowAdd(false); setView("dash"); }} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: F.body, fontStyle: "italic", fontSize: "0.95rem", color: C.inkFaint, padding: 0 }}>← Journal</button>
        <p style={{ fontFamily: F.stamp, fontSize: "0.6rem", letterSpacing: "0.14em", textTransform: "uppercase", color: C.inkFaint }}>Repertoire</p>
      </div>

      <Rule thick />

      {items.map((it) => {
        const isEditing = editingId === it.id;
        const card = cards.find((c) => c.id === it.id);
        return (
          <div key={it.id}>
            {isEditing ? (
              <div style={{ padding: "0.9rem 0" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: "0.75rem", marginBottom: "0.6rem" }}>
                  <div>
                    <p style={{ fontFamily: F.stamp, fontSize: "0.55rem", letterSpacing: "0.12em", textTransform: "uppercase", color: C.inkFaint, marginBottom: "0.2rem" }}>Composer</p>
                    <JournalInput value={editDraft.composer} onChange={(v) => setEditDraft((d) => ({ ...d, composer: v }))} placeholder="Composer" />
                  </div>
                  <div>
                    <p style={{ fontFamily: F.stamp, fontSize: "0.55rem", letterSpacing: "0.12em", textTransform: "uppercase", color: C.inkFaint, marginBottom: "0.2rem" }}>Work</p>
                    <JournalInput value={editDraft.title} onChange={(v) => setEditDraft((d) => ({ ...d, title: v }))} placeholder="Title" />
                  </div>
                </div>
                <div style={{ marginBottom: "0.75rem" }}>
                  <p style={{ fontFamily: F.stamp, fontSize: "0.55rem", letterSpacing: "0.12em", textTransform: "uppercase", color: C.inkFaint, marginBottom: "0.2rem" }}>Detail</p>
                  <JournalInput value={editDraft.detail} onChange={(v) => setEditDraft((d) => ({ ...d, detail: v }))} placeholder="Mvt., measures, etc." />
                </div>
                <div style={{ display: "flex", gap: "1rem" }}>
                  <button onClick={saveEdit} disabled={!draftValid(editDraft)} style={inkBtn({ color: draftValid(editDraft) ? C.action : C.inkFaint })}>Save</button>
                  <button onClick={cancelEdit} style={inkBtn({ color: C.inkFaint })}>Cancel</button>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.75rem", padding: "0.65rem 0" }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: "1rem", lineHeight: 1.3 }}>
                    <span style={{ fontWeight: 600 }}>{it.composer}</span>
                    <span style={{ color: C.inkFaint }}> · </span>
                    <span style={{ fontStyle: "italic" }}>{it.title}</span>
                  </p>
                  {it.detail && <p style={{ fontSize: "0.85rem", color: C.inkFaint, marginTop: "0.1rem", fontStyle: "italic" }}>{it.detail}</p>}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexShrink: 0, paddingTop: "0.2rem" }}>
                  {card && <Badge bucket={card.bucket} />}
                  <button onClick={() => startEdit(it)} style={inkBtn({ color: C.inkFaint })}>edit</button>
                  <button onClick={() => deleteItem(it.id)} style={inkBtn({ color: C.fail, letterSpacing: 0, fontSize: "0.85rem" })}>×</button>
                </div>
              </div>
            )}
            <div style={{ borderTop: `1px solid ${C.rule}` }} />
          </div>
        );
      })}

      <div style={{ marginTop: "1.25rem" }}>
        {!showAdd ? (
          <button onClick={() => setShowAdd(true)} style={inkBtn({ color: C.inkMid, display: "flex", alignItems: "center", gap: "0.4rem" })}>
            <span style={{ fontSize: "1rem", fontFamily: F.display, lineHeight: 1 }}>+</span> Add item
          </button>
        ) : (
          <div style={{ paddingTop: "0.75rem" }}>
            <p style={{ fontFamily: F.stamp, fontSize: "0.6rem", letterSpacing: "0.14em", textTransform: "uppercase", color: C.inkFaint, marginBottom: "0.75rem" }}>New item</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: "0.75rem", marginBottom: "0.6rem" }}>
              <div>
                <p style={{ fontFamily: F.stamp, fontSize: "0.55rem", letterSpacing: "0.12em", textTransform: "uppercase", color: C.inkFaint, marginBottom: "0.2rem" }}>Composer</p>
                <JournalInput value={newDraft.composer} onChange={(v) => setNewDraft((d) => ({ ...d, composer: v }))} placeholder="Composer" />
              </div>
              <div>
                <p style={{ fontFamily: F.stamp, fontSize: "0.55rem", letterSpacing: "0.12em", textTransform: "uppercase", color: C.inkFaint, marginBottom: "0.2rem" }}>Work</p>
                <JournalInput value={newDraft.title} onChange={(v) => setNewDraft((d) => ({ ...d, title: v }))} placeholder="Title" />
              </div>
            </div>
            <div style={{ marginBottom: "0.75rem" }}>
              <p style={{ fontFamily: F.stamp, fontSize: "0.55rem", letterSpacing: "0.12em", textTransform: "uppercase", color: C.inkFaint, marginBottom: "0.2rem" }}>Detail</p>
              <JournalInput value={newDraft.detail} onChange={(v) => setNewDraft((d) => ({ ...d, detail: v }))} placeholder="Mvt., measures, etc." />
            </div>
            <div style={{ display: "flex", gap: "1rem" }}>
              <button onClick={addItem} disabled={!draftValid(newDraft)} style={inkBtn({ color: draftValid(newDraft) ? C.action : C.inkFaint })}>Add to repertoire</button>
              <button onClick={() => { setShowAdd(false); setNewDraft(emptyDraft()); }} style={inkBtn({ color: C.inkFaint })}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </Page>
  );

  // ── Assessment ────────────────────────────────────────────────────────────

  if (view === "assess" && item) return (
    <Page>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "1.25rem" }}>
        <button onClick={() => setView("dash")} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: F.body, fontStyle: "italic", fontSize: "0.95rem", color: C.inkFaint, padding: 0 }}>← Journal</button>
        <span style={{ fontFamily: F.stamp, fontSize: "0.6rem", color: C.inkFaint, letterSpacing: "0.08em" }}>{idx + 1} of {queue.length}</span>
      </div>

      <div style={{ display: "flex", gap: "4px", marginBottom: "1.5rem" }}>
        {queue.map((_, i) => <div key={i} style={{ height: 2, flex: 1, borderRadius: 1, background: i < idx ? C.inkMid : i === idx ? C.action : C.rule }} />)}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <p style={{ fontFamily: F.stamp, fontSize: "0.65rem", letterSpacing: "0.12em", textTransform: "uppercase", color: C.inkFaint, marginBottom: "0.3rem" }}>{item.composer}</p>
          <h2 style={{ fontFamily: F.display, fontSize: "1.55rem", fontWeight: 700, lineHeight: 1.15, color: C.ink }}>{item.title}</h2>
          {item.detail && <p style={{ fontStyle: "italic", fontSize: "1rem", color: C.inkMid, marginTop: "0.2rem" }}>{item.detail}</p>}
        </div>
        <div style={{ marginTop: "0.2rem", flexShrink: 0, marginLeft: "0.75rem" }}><Badge bucket={card.bucket} /></div>
      </div>

      <Rule thick />
      <p style={{ fontStyle: "italic", fontSize: "0.95rem", color: C.inkMid, marginBottom: "1rem" }}>Play through cold, then mark each criterion:</p>

      <div style={{ marginBottom: "1.5rem" }}>
        {CRITERIA.map((c, i) => (
          <div key={c.id}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.65rem 0" }}>
              <span style={{ fontSize: "1.1rem", color: C.ink }}>{c.label}</span>
              <div style={{ display: "flex", gap: "0.4rem" }}>
                <MarkButton active={scores[c.id] === true}  variant="pass" onClick={() => toggleScore(c.id, true)}>✓</MarkButton>
                <MarkButton active={scores[c.id] === false} variant="fail" onClick={() => toggleScore(c.id, false)}>✗</MarkButton>
              </div>
            </div>
            {i < CRITERIA.length - 1 && <div style={{ borderTop: `1px solid ${C.rule}` }} />}
          </div>
        ))}
      </div>

      <button onClick={submit} disabled={!allRated} style={{ width: "100%", fontFamily: F.display, fontSize: "1rem", padding: "0.75rem", background: allRated ? C.action : "transparent", color: allRated ? C.paperLt : C.inkFaint, border: `1px solid ${allRated ? C.action : C.rule}`, borderRadius: "1px", cursor: allRated ? "pointer" : "not-allowed" }}>
        {allRated ? "Record assessment" : `Mark all criteria · ${Object.values(scores).filter((v) => v !== undefined).length} / 4`}
      </button>

      <Recorder itemId={item.id} />
    </Page>
  );

  // ── Result ────────────────────────────────────────────────────────────────

  if (view === "result" && result) {
    const { item, oldBucket, newBucket, ups, failed } = result;
    const promoted = BUCKET[oldBucket].up === newBucket;
    const demoted  = BUCKET[oldBucket].dn === newBucket;
    return (
      <Page>
        <p style={{ fontFamily: F.stamp, fontSize: "0.6rem", letterSpacing: "0.14em", textTransform: "uppercase", color: C.inkFaint, marginBottom: "1rem" }}>Assessment</p>
        <Rule thick />
        <p style={{ fontFamily: F.stamp, fontSize: "0.65rem", letterSpacing: "0.1em", textTransform: "uppercase", color: C.inkFaint, marginBottom: "0.3rem" }}>{item.composer}</p>
        <h2 style={{ fontFamily: F.display, fontSize: "1.4rem", fontWeight: 700, lineHeight: 1.2, color: C.ink }}>{item.title}</h2>
        {item.detail && <p style={{ fontStyle: "italic", fontSize: "0.95rem", color: C.inkMid, marginTop: "0.15rem", marginBottom: "0.75rem" }}>{item.detail}</p>}
        <Rule />
        <div style={{ marginBottom: "1rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.35rem", flexWrap: "wrap" }}>
            <Badge bucket={oldBucket} />
            {oldBucket !== newBucket && <><span style={{ color: C.inkFaint, fontSize: "0.8rem" }}>→</span><Badge bucket={newBucket} /></>}
            <span style={{ fontStyle: "italic", fontSize: "0.95rem", color: promoted ? C.pass : demoted ? C.fail : C.inkFaint }}>
              {promoted ? "promoted" : demoted ? "demoted" : "unchanged"}
            </span>
          </div>
          <p style={{ fontFamily: F.stamp, fontSize: "0.6rem", color: C.inkFaint, letterSpacing: "0.05em" }}>{ups}/4 · {formatDue(BUCKET[newBucket].sessions)}</p>
        </div>
        <Rule />
        <div style={{ marginBottom: "1.5rem" }}>
          {failed.length > 0 ? (
            <>
              <p style={{ fontFamily: F.stamp, fontSize: "0.6rem", letterSpacing: "0.12em", textTransform: "uppercase", color: C.inkFaint, marginBottom: "0.6rem" }}>Work on today</p>
              {failed.map((f) => (
                <p key={f} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "1.05rem", color: C.fail, marginBottom: "0.3rem" }}>
                  <span style={{ fontFamily: F.display, fontWeight: 700, fontSize: "0.9rem" }}>✗</span>{f}
                </p>
              ))}
            </>
          ) : (
            <p style={{ fontStyle: "italic", fontSize: "1.05rem", color: C.pass }}>Clean pass — all criteria met.</p>
          )}
        </div>
        <button onClick={advance} style={{ width: "100%", fontFamily: F.display, fontSize: "1rem", padding: "0.75rem", background: C.action, color: C.paperLt, border: "none", borderRadius: "1px", cursor: "pointer" }}>
          {idx + 1 >= queue.length ? "Close session" : "Next item →"}
        </button>
      </Page>
    );
  }

  return null;
}
