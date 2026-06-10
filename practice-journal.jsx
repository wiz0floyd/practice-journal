import { useState, useEffect, useRef } from "react";
import {
  BUCKET, CRITERIA, DEFAULT_EXCERPTS, DEFAULT_SETTINGS,
  isDue, formatDue, draftValid, emptyDraft, newId, shuffle,
  advanceBucket, bucketSessions, encodeWAV, syncCards, KEYS, load, save, getCriteria,
  itemTags, parseTags, isCardPinned, cardMatchesTag, sessionPool, buildQueue,
  weeklyStats, streakDays, BADGES, computeBadges, bucketTransitions, scoreColor,
  pomodoroMinutes, nextPhase, fmtClock, tapBpm,
  buildExport, validImport, restoreQueue,
  freqToNote, autoCorrelate,
} from "./src/lib/sr.js";
import { supabase } from "./src/lib/supabase.js";
import { stampAndUpsert, pullUserData } from "./src/lib/sync.js";

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

// ── Tuner ─────────────────────────────────────────────────────────────────────

function Tuner() {
  const [open,    setOpen]    = useState(false);
  const [running, setRunning] = useState(false);
  const [mode,    setMode]    = useState("chromatic");
  const [reading, setReading] = useState(null);
  const [err,     setErr]     = useState("");

  const ctxRef      = useRef(null);
  const analyserRef = useRef(null);
  const streamRef   = useRef(null);
  const rafRef      = useRef(null);
  const bufRef      = useRef(null);
  const discRef     = useRef(null);
  const angleRef    = useRef(0);
  const lastSetRef  = useRef(0);
  const lastValidRef = useRef(0);

  const stop = () => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    if (ctxRef.current) { ctxRef.current.close(); ctxRef.current = null; }
    analyserRef.current = null;
    setRunning(false);
  };

  useEffect(() => () => stop(), []); // cleanup on unmount

  const start = async () => {
    setErr("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      streamRef.current = stream;
      const ctx = new AudioContext();
      ctxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyserRef.current = analyser;
      ctx.createMediaStreamSource(stream).connect(analyser);
      bufRef.current = new Float32Array(2048);
      setRunning(true);

      const loop = () => {
        analyserRef.current.getFloatTimeDomainData(bufRef.current);
        const f = autoCorrelate(bufRef.current, ctxRef.current.sampleRate);
        const now = performance.now();
        if (f > 0) {
          lastValidRef.current = now;
          const n = freqToNote(f);
          if (discRef.current) {
            if (Math.abs(n.cents) >= 2) {
              angleRef.current += Math.max(-6, Math.min(6, n.cents * 0.12));
            }
            discRef.current.style.transform = `rotate(${angleRef.current}deg)`;
          }
          if (now - lastSetRef.current > 100) {
            setReading({ ...n, freq: Math.round(f * 10) / 10 });
            lastSetRef.current = now;
          }
        } else {
          if (discRef.current) {
            discRef.current.style.transform = `rotate(${angleRef.current}deg)`;
          }
          if (now - lastValidRef.current > 300 && now - lastSetRef.current > 100) {
            setReading(null);
            lastSetRef.current = now;
          }
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    } catch (e) {
      setErr(e.message);
    }
  };

  const handleToggleOpen = () => {
    setOpen((o) => {
      if (o) stop();
      return !o;
    });
  };

  const cents = reading?.cents ?? 0;
  const clampedCents = Math.max(-50, Math.min(50, cents));

  return (
    <div style={{ marginTop: "1rem" }}>
      <button onClick={handleToggleOpen} style={inkBtn({ color: C.inkFaint })}>
        Tuner {open ? "▾" : "▸"}
      </button>
      {open && (
        <div style={{ marginTop: "1rem", paddingTop: "0.75rem", borderTop: `1px dashed ${C.rule}` }}>
          {/* Mode toggle + start/stop row */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
            <span>
              <button
                onClick={() => setMode("chromatic")}
                style={inkBtn({ color: mode === "chromatic" ? C.action : C.inkFaint })}
              >
                chromatic
              </button>
              {" · "}
              <button
                onClick={() => setMode("strobe")}
                style={inkBtn({ color: mode === "strobe" ? C.action : C.inkFaint })}
              >
                strobe
              </button>
            </span>
            <button
              onClick={running ? stop : start}
              style={{
                fontFamily: F.body,
                fontStyle: "italic",
                fontSize: "0.9rem",
                padding: "2px 10px",
                background: "transparent",
                border: `1px solid ${running ? C.fail : C.rule}`,
                color: running ? C.fail : C.inkMid,
                borderRadius: "1px",
                cursor: "pointer",
              }}
            >
              {running ? "Stop" : "Start"}
            </button>
          </div>

          {err && (
            <p style={{ fontFamily: F.stamp, fontSize: "0.6rem", color: C.fail, marginBottom: "0.5rem" }}>{err}</p>
          )}

          {/* Chromatic display */}
          {mode === "chromatic" && (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontFamily: F.display, fontSize: "2.2rem", fontWeight: 700, color: C.ink, lineHeight: 1.1 }}>
                {reading ? `${reading.name}${reading.octave}` : "—"}
              </div>
              {/* Cents bar */}
              <div style={{ position: "relative", height: "6px", background: C.rule, borderRadius: "1px", marginTop: "0.6rem" }}>
                {/* Center tick */}
                <div style={{ position: "absolute", left: "50%", width: "1px", height: "12px", top: "-3px", background: C.inkMid }} />
                {/* Needle */}
                <div style={{
                  position: "absolute",
                  width: "3px",
                  height: "12px",
                  top: "-3px",
                  borderRadius: "1px",
                  left: `calc(${50 + clampedCents}% - 1.5px)`,
                  background: reading && Math.abs(cents) <= 5 ? C.pass : C.fail,
                }} />
              </div>
              <p style={{ fontFamily: F.stamp, fontSize: "0.55rem", color: C.inkFaint, letterSpacing: "0.08em", marginTop: "0.5rem" }}>
                {reading
                  ? `${cents > 0 ? "+" : ""}${cents} cents · ${reading.freq} Hz`
                  : running ? "listening…" : "—"}
              </p>
            </div>
          )}

          {/* Strobe display */}
          {mode === "strobe" && (
            <div style={{ textAlign: "center" }}>
              <div style={{ position: "relative", width: "140px", height: "140px", margin: "0.75rem auto" }}>
                {/* Strobe disc */}
                <div
                  ref={discRef}
                  style={{
                    width: "140px",
                    height: "140px",
                    borderRadius: "50%",
                    border: `1px solid ${C.ruleDk}`,
                    background: `repeating-conic-gradient(${C.ink} 0deg 15deg, transparent 15deg 30deg)`,
                    position: "absolute",
                    top: 0,
                    left: 0,
                  }}
                />
                {/* Inner hole overlay */}
                <div style={{
                  position: "absolute",
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%, -50%)",
                  width: "64px",
                  height: "64px",
                  borderRadius: "50%",
                  background: C.paper,
                  border: `1px solid ${C.rule}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}>
                  <span style={{
                    fontFamily: F.display,
                    fontSize: "1.3rem",
                    fontWeight: 700,
                    color: reading && Math.abs(cents) <= 5 ? C.pass : C.ink,
                  }}>
                    {reading ? `${reading.name}${reading.octave}` : "—"}
                  </span>
                </div>
              </div>
              <p style={{ fontFamily: F.stamp, fontSize: "0.55rem", color: C.inkFaint, letterSpacing: "0.08em", marginTop: "0.25rem" }}>
                {reading
                  ? `${cents > 0 ? "+" : ""}${cents} cents · ${reading.freq} Hz`
                  : running ? "listening…" : "—"}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Metronome ─────────────────────────────────────────────────────────────────

function Metronome() {
  const [bpm,     setBpm]     = useState(80);
  const [beats,   setBeats]   = useState(4);
  const [running, setRunning] = useState(false);
  const [open,    setOpen]    = useState(false);

  const ctxRef         = useRef(null);
  const intervalRef    = useRef(null);
  const nextNoteRef    = useRef(0);
  const beatIndexRef   = useRef(0);
  const bpmRef         = useRef(bpm);
  const beatsRef       = useRef(beats);
  const tapsRef        = useRef([]);

  useEffect(() => { bpmRef.current = bpm; }, [bpm]);
  useEffect(() => { beatsRef.current = beats; }, [beats]);

  const schedule = () => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    while (nextNoteRef.current < ctx.currentTime + 0.1) {
      const t    = nextNoteRef.current;
      const freq = beatIndexRef.current % beatsRef.current === 0 ? 1000 : 760;
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.4, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.06);
      nextNoteRef.current += 60 / bpmRef.current;
      beatIndexRef.current++;
    }
  };

  const start = () => {
    if (!ctxRef.current) {
      ctxRef.current = new AudioContext();
    } else if (ctxRef.current.state === "suspended") {
      ctxRef.current.resume();
    }
    nextNoteRef.current = ctxRef.current.currentTime + 0.05;
    beatIndexRef.current = 0;
    intervalRef.current = setInterval(schedule, 25);
    setRunning(true);
  };

  const stop = () => {
    clearInterval(intervalRef.current);
    intervalRef.current = null;
    setRunning(false);
  };

  useEffect(() => {
    return () => {
      clearInterval(intervalRef.current);
      ctxRef.current?.close();
    };
  }, []);

  const handleTap = () => {
    const now = Date.now();
    const prev = tapsRef.current;
    if (prev.length > 0 && now - prev[prev.length - 1] > 3000) {
      tapsRef.current = [];
    }
    tapsRef.current = [...tapsRef.current, now];
    const b = tapBpm(tapsRef.current);
    if (b) setBpm(b);
  };

  const stepBtnStyle = {
    width: "2rem", height: "2rem",
    border: `1px solid ${C.rule}`,
    background: "transparent",
    color: C.inkMid,
    borderRadius: "1px",
    cursor: "pointer",
    fontFamily: F.display,
    fontSize: "1rem",
    fontWeight: 700,
    display: "flex", alignItems: "center", justifyContent: "center",
    lineHeight: 1,
  };

  return (
    <div style={{ marginTop: "1rem" }}>
      <button onClick={() => setOpen((o) => !o)} style={inkBtn({ color: C.inkFaint })}>
        Metronome {open ? "▾" : "▸"}
      </button>
      {open && (
        <div style={{ marginTop: "1rem", paddingTop: "0.75rem", borderTop: `1px dashed ${C.rule}` }}>
          {/* BPM row */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.6rem" }}>
            <button onClick={() => setBpm((v) => Math.max(30, v - 2))} style={stepBtnStyle}>−</button>
            <span style={{ fontFamily: F.display, fontSize: "1.4rem", fontWeight: 700, color: C.ink, minWidth: "3.5rem", textAlign: "center" }}>
              {bpm}
              <span style={{ fontFamily: F.stamp, fontSize: "0.55rem", color: C.inkFaint, marginLeft: "0.3rem", letterSpacing: "0.08em", verticalAlign: "middle" }}>bpm</span>
            </span>
            <button onClick={() => setBpm((v) => Math.min(240, v + 2))} style={stepBtnStyle}>+</button>
          </div>
          {/* Tap / beats / start row */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
            <button
              onClick={handleTap}
              style={{ fontFamily: F.stamp, fontSize: "0.6rem", letterSpacing: "0.1em", textTransform: "uppercase", padding: "3px 10px", background: "transparent", border: `1px solid ${C.rule}`, color: C.inkMid, borderRadius: "1px", cursor: "pointer" }}
            >
              tap
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
              <button onClick={() => setBeats((v) => Math.max(2, v - 1))} style={stepBtnStyle}>−</button>
              <span style={{ fontFamily: F.stamp, fontSize: "0.6rem", color: C.inkMid, letterSpacing: "0.05em", minWidth: "4.5rem", textAlign: "center" }}>
                {beats} beats/bar
              </span>
              <button onClick={() => setBeats((v) => Math.min(12, v + 1))} style={stepBtnStyle}>+</button>
            </div>
            <button
              onClick={running ? stop : start}
              style={{ fontFamily: F.body, fontStyle: "italic", fontSize: "0.95rem", padding: "3px 10px", background: "transparent", border: `1px solid ${running ? C.fail : C.rule}`, color: running ? C.fail : C.inkFaint, borderRadius: "1px", cursor: "pointer" }}
            >
              {running ? "Stop" : "Start"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Pomodoro hook ─────────────────────────────────────────────────────────────

function usePomodoro(settings) {
  const [phase,     setPhase]     = useState("idle");
  const [remaining, setRemaining] = useState(0);
  const [paused,    setPaused]    = useState(false);

  // Refs hold live mutable values for the interval callback without re-creating it.
  const endsAtRef   = useRef(null);  // ms timestamp when current phase ends
  const pausedRef   = useRef(false);
  const phaseRef    = useRef("idle");
  const settingsRef = useRef(settings);
  const audioCtxRef = useRef(null);

  useEffect(() => { settingsRef.current = settings; }, [settings]);

  const playBeeps = () => {
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") ctx.resume();
      for (let i = 0; i < 3; i++) {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.2);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.2 + 0.12);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.2);
        osc.stop(ctx.currentTime + i * 0.2 + 0.13);
      }
    } catch {}
  };

  // Single long-lived interval; reads live values from refs.
  useEffect(() => {
    const id = setInterval(() => {
      if (pausedRef.current || phaseRef.current === "idle") return;
      const rem = Math.max(0, (endsAtRef.current - Date.now()) / 1000);
      if (rem <= 0) {
        playBeeps();
        const np = nextPhase(phaseRef.current);
        phaseRef.current = np;
        endsAtRef.current = Date.now() + pomodoroMinutes(settingsRef.current, np) * 60 * 1000;
        setPhase(np);
        setRemaining(pomodoroMinutes(settingsRef.current, np) * 60);
      } else {
        setRemaining(rem);
      }
    }, 500);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    return () => { audioCtxRef.current?.close(); };
  }, []);

  const start = () => {
    const mins = pomodoroMinutes(settingsRef.current, "work");
    phaseRef.current = "work";
    endsAtRef.current = Date.now() + mins * 60 * 1000;
    pausedRef.current = false;
    setPhase("work");
    setRemaining(mins * 60);
    setPaused(false);
  };

  const pause = () => {
    const rem = Math.max(0, (endsAtRef.current - Date.now()) / 1000);
    endsAtRef.current = null;
    pausedRef.current = true;
    setRemaining(rem);
    setPaused(true);
  };

  const resume = () => {
    endsAtRef.current = Date.now() + remaining * 1000;
    pausedRef.current = false;
    setPaused(false);
  };

  const reset = () => {
    phaseRef.current = "idle";
    endsAtRef.current = null;
    pausedRef.current = false;
    setPhase("idle");
    setRemaining(0);
    setPaused(false);
  };

  return { phase, remaining, paused, start, pause, resume, reset };
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

// ── Cloud sync ────────────────────────────────────────────────────────────────

function useSync(user, setItems, setCards, setContext, setSettings, setSessions, setBadges, items, serverDataRef) {
  useEffect(() => {
    if (!user) return;
    pullUserData(user).then((updates) => {
      if (!updates) return;
      if (updates[KEYS.items] !== undefined) {
        serverDataRef.current[KEYS.items] = updates[KEYS.items];
        setItems(updates[KEYS.items]);
      }
      if (updates[KEYS.cards] !== undefined) {
        const effectiveItems = updates[KEYS.items] ?? items;
        const reconciledCards = syncCards(effectiveItems, updates[KEYS.cards]);
        serverDataRef.current[KEYS.cards] = reconciledCards;
        setCards(reconciledCards);
      }
      if (updates[KEYS.context] !== undefined) {
        serverDataRef.current[KEYS.context] = updates[KEYS.context];
        setContext(updates[KEYS.context]);
      }
      if (updates[KEYS.settings] !== undefined) {
        serverDataRef.current[KEYS.settings] = updates[KEYS.settings];
        setSettings(updates[KEYS.settings]);
      }
      if (updates[KEYS.sessions] !== undefined) {
        serverDataRef.current[KEYS.sessions] = updates[KEYS.sessions];
        setSessions(updates[KEYS.sessions]);
      }
      if (updates[KEYS.badges] !== undefined) {
        serverDataRef.current[KEYS.badges] = updates[KEYS.badges];
        setBadges(updates[KEYS.badges]);
      }
    });
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
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

// ── Pomodoro chip (used in assess + result views) ─────────────────────────────

function PomodoroChip({ pomo }) {
  if (pomo.phase === "idle") return null;
  const color = pomo.phase === "work" ? C.action : C.pass;
  return (
    <div style={{ position: "fixed", top: "0.75rem", right: "0.75rem", background: C.paperLt, border: `1px solid ${color}`, borderRadius: "2px", padding: "0.3rem 0.6rem", zIndex: 10, textAlign: "center" }}>
      <div style={{ fontFamily: F.stamp, fontSize: "0.5rem", textTransform: "uppercase", letterSpacing: "0.12em", color, marginBottom: "0.1rem" }}>{pomo.phase}</div>
      <div style={{ fontFamily: F.display, fontSize: "1rem", fontWeight: 700, color: C.ink }}>{fmtClock(pomo.remaining)}</div>
    </div>
  );
}

// ── Pomodoro controls (collapsible) ───────────────────────────────────────────

function PomodoroControls({ pomo }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: "1rem" }}>
      <button onClick={() => setOpen((o) => !o)} style={inkBtn({ color: C.inkFaint })}>
        Pomodoro {open ? "▾" : "▸"}
      </button>
      {open && (
        <div style={{ marginTop: "1rem", paddingTop: "0.75rem", borderTop: `1px dashed ${C.rule}` }}>
          <div style={{ marginBottom: "0.5rem" }}>
            {pomo.phase === "idle" ? (
              <span style={{ fontFamily: F.stamp, fontSize: "0.6rem", color: C.inkFaint, letterSpacing: "0.08em" }}>idle</span>
            ) : (
              <span style={{ fontFamily: F.display, fontSize: "1rem", fontWeight: 700, color: pomo.phase === "work" ? C.action : C.pass }}>
                {pomo.phase} · {fmtClock(pomo.remaining)}
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
            {pomo.phase === "idle" && (
              <button onClick={pomo.start} style={inkBtn({ color: C.action })}>Start work</button>
            )}
            {pomo.phase !== "idle" && !pomo.paused && (
              <button onClick={pomo.pause} style={inkBtn({ color: C.inkMid })}>Pause</button>
            )}
            {pomo.phase !== "idle" && pomo.paused && (
              <button onClick={pomo.resume} style={inkBtn({ color: C.action })}>Resume</button>
            )}
            {pomo.phase !== "idle" && (
              <button onClick={pomo.reset} style={inkBtn({ color: C.inkFaint })}>Reset</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  useFonts();
  const { user, signIn, signOut } = useAuth();

  const [items,         setItems]         = useState(() => load(KEYS.items,   DEFAULT_EXCERPTS));
  const [cards,         setCards]         = useState(() => syncCards(load(KEYS.items, DEFAULT_EXCERPTS), load(KEYS.cards, [])));
  const [context,       setContext]       = useState(() => load(KEYS.context, ""));
  const [settings,      setSettings]      = useState(() => load(KEYS.settings, DEFAULT_SETTINGS));
  const pomo = usePomodoro(settings);
  const [sessions,      setSessions]      = useState(() => load(KEYS.sessions, []));
  const [badges,        setBadges]        = useState(() => load(KEYS.badges, {}));
  const [toast,         setToast]         = useState(null);
  const [view,          setView]          = useState("dash");
  const [queue,         setQueue]         = useState([]);
  const [idx,           setIdx]           = useState(0);
  const [scores,        setScores]        = useState({});
  const [result,        setResult]        = useState(null);
  const [sessionLength, setSessionLength] = useState(4);
  const [tagFilter,     setTagFilter]     = useState(null);
  const [sessionNote,   setSessionNote]   = useState("");
  const [pendingResume, setPendingResume] = useState(() => load(KEYS.active, null));

  // Import file input ref
  const importRef = useRef(null);

  // Repertoire edit state
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState(emptyDraft());
  const [newDraft,  setNewDraft]  = useState(emptyDraft());
  const [showAdd,   setShowAdd]   = useState(false);

  // Keep a ref to the current user so save effects can read it without
  // re-running on sign-in (which would push stale local data before the pull).
  const userRef = useRef(user);
  useEffect(() => { userRef.current = user; });

  // Tracks server-applied values by reference to suppress round-trip upserts.
  const serverDataRef = useRef({});
  // Guards against upserts on first render (state loaded from localStorage, not mutated).
  // Must be set by the effect declared AFTER the save effects so it flips to true
  // only after the first render's save effects have already run.
  const isMounted = useRef(false);

  useSync(user, setItems, setCards, setContext, setSettings, setSessions, setBadges, items, serverDataRef);

  useEffect(() => {
    save(KEYS.items, items);
    if (!isMounted.current) return;
    if (items === serverDataRef.current[KEYS.items]) { delete serverDataRef.current[KEYS.items]; return; }
    stampAndUpsert(KEYS.items, items, userRef.current);
  }, [items]);
  useEffect(() => {
    save(KEYS.cards, cards);
    if (!isMounted.current) return;
    if (cards === serverDataRef.current[KEYS.cards]) { delete serverDataRef.current[KEYS.cards]; return; }
    stampAndUpsert(KEYS.cards, cards, userRef.current);
  }, [cards]);
  useEffect(() => {
    save(KEYS.context, context);
    if (!isMounted.current) return;
    if (context === serverDataRef.current[KEYS.context]) { delete serverDataRef.current[KEYS.context]; return; }
    stampAndUpsert(KEYS.context, context, userRef.current);
  }, [context]);
  useEffect(() => {
    save(KEYS.settings, settings);
    if (!isMounted.current) return;
    if (settings === serverDataRef.current[KEYS.settings]) { delete serverDataRef.current[KEYS.settings]; return; }
    stampAndUpsert(KEYS.settings, settings, userRef.current);
  }, [settings]);
  useEffect(() => {
    save(KEYS.sessions, sessions);
    if (!isMounted.current) return;
    if (sessions === serverDataRef.current[KEYS.sessions]) { delete serverDataRef.current[KEYS.sessions]; return; }
    stampAndUpsert(KEYS.sessions, sessions, userRef.current);
  }, [sessions]);
  useEffect(() => {
    save(KEYS.badges, badges);
    if (!isMounted.current) return;
    if (badges === serverDataRef.current[KEYS.badges]) { delete serverDataRef.current[KEYS.badges]; return; }
    stampAndUpsert(KEYS.badges, badges, userRef.current);
  }, [badges]);
  useEffect(() => { isMounted.current = true; }, []);

  // ── Active session snapshot (device-local, not synced) ────────────────────

  const clearActive = () => { try { localStorage.removeItem(KEYS.active); } catch {} };

  useEffect(() => {
    if (view === "assess" && queue.length) {
      save(KEYS.active, { stage: "assess", queueIds: queue.map((q) => q.id), idx, scores });
    } else if (view === "result" && queue.length && result) {
      save(KEYS.active, { stage: "result", queueIds: queue.map((q) => q.id), idx, result: { ...result, item: undefined, itemId: result.item.id } });
    } else if (view === "sessionNote" && queue.length) {
      save(KEYS.active, { stage: "note", queueIds: queue.map((q) => q.id) });
    }
  }, [view, queue, idx, scores, result]);

  // Badge award effect
  useEffect(() => {
    const earned = computeBadges(sessions, cards);
    const newIds = earned.filter((id) => !(id in badges));
    if (newIds.length > 0) {
      setBadges((p) => ({ ...p, ...Object.fromEntries(newIds.map((id) => [id, new Date().toISOString()])) })); // eslint-disable-line react-hooks/set-state-in-effect
      setToast(BADGES.find((b) => b.id === newIds[0]).label);
    }
  }, [sessions, cards]); // eslint-disable-line react-hooks/exhaustive-deps

  // Toast auto-dismiss
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  const criteria = getCriteria(settings);
  const dueCards = sessionPool(cards, items, tagFilter);
  const card     = queue[idx];
  const item     = card ? items.find((e) => e.id === card.id) : null;

  // ── Session ───────────────────────────────────────────────────────────────

  const startSession = () => {
    setQueue(buildQueue(cards, items, tagFilter, sessionLength));
    setIdx(0); setScores({}); setResult(null);
    setView("assess");
  };

  const toggleScore = (id, val) => setScores((p) => ({ ...p, [id]: p[id] === val ? undefined : val }));

  const allRated = criteria.every((c) => scores[c.id] !== undefined);

  const submit = () => {
    const ups    = criteria.filter((c) => scores[c.id] === true).length;
    const nb     = advanceBucket(card.bucket, ups, criteria.length);
    const failed = criteria.filter((c) => scores[c.id] === false).map((c) => c.label);
    setCards((prev) => prev.map((c) => c.id !== card.id ? c : {
      ...c, bucket: nb, sessionsUntilDue: bucketSessions(nb, settings),
      history: [...c.history, { date: new Date().toISOString(), scores: { ...scores }, ups, bucket: nb, total: criteria.length }],
    }));
    setResult({ item, oldBucket: card.bucket, newBucket: nb, ups, failed, total: criteria.length });
    setView("result");
  };

  const advance = () => {
    if (idx + 1 >= queue.length) {
      const sessionIds = new Set(queue.map((q) => q.id));
      setCards((prev) => prev.map((c) =>
        sessionIds.has(c.id) ? c : { ...c, sessionsUntilDue: Math.max(0, (c.sessionsUntilDue ?? 0) - 1) }
      ));
      setSessionNote(""); setView("sessionNote");
    } else {
      setIdx((i) => i + 1); setScores({}); setView("assess");
    }
  };

  // ── Repertoire ────────────────────────────────────────────────────────────

  const startEdit  = (it) => { setEditingId(it.id); setEditDraft({ composer: it.composer, title: it.title, detail: it.detail, notes: it.notes ?? "", tags: itemTags(it).join(", ") }); };
  const cancelEdit = ()   => { setEditingId(null); setEditDraft(emptyDraft()); };

  const saveEdit = () => {
    setItems((prev) => prev.map((e) => e.id !== editingId ? e : {
      ...e,
      composer: editDraft.composer,
      title:    editDraft.title,
      detail:   editDraft.detail,
      notes:    editDraft.notes.trim(),
      tags:     parseTags(editDraft.tags),
    }));
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
    setItems((prev) => [...prev, { id, composer: newDraft.composer.trim(), title: newDraft.title.trim(), detail: newDraft.detail.trim(), notes: newDraft.notes.trim(), tags: parseTags(newDraft.tags) }]);
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
      {sessions.length > 0 && (() => {
        const stats = weeklyStats(sessions, cards, items);
        return (
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1.25rem", padding: "0.75rem 0", borderBottom: `1px solid ${C.rule}` }}>
            {[
              { value: stats.sessionsThisWeek, label: "this week" },
              { value: stats.itemsThisWeek,    label: "items" },
              { value: stats.streak,           label: "day streak" },
              {
                value: (
                  <span>
                    <span style={{ color: C.hot }}>{stats.buckets.hot}</span>
                    {" · "}
                    <span style={{ color: C.warm }}>{stats.buckets.warm}</span>
                    {" · "}
                    <span style={{ color: C.cold }}>{stats.buckets.cold}</span>
                  </span>
                ),
                label: "buckets",
              },
            ].map(({ value, label }) => (
              <div key={label} style={{ textAlign: "center" }}>
                <div style={{ fontFamily: F.display, fontSize: "1.3rem", fontWeight: 700, color: C.ink }}>{value}</div>
                <div style={{ fontFamily: F.stamp, fontSize: "0.52rem", textTransform: "uppercase", letterSpacing: "0.12em", color: C.inkFaint }}>{label}</div>
              </div>
            ))}
          </div>
        );
      })()}
      <SessionSlider value={sessionLength} onChange={setSessionLength} dueCount={dueCards.length} maxItems={items.length} />

      {(() => {
        const allTags = [...new Set(items.flatMap((it) => itemTags(it)))].sort();
        return allTags.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginBottom: "1rem" }}>
            {allTags.map((tag) => {
              const active = tagFilter === tag;
              return (
                <button
                  key={tag}
                  onClick={() => setTagFilter(active ? null : tag)}
                  style={{
                    fontFamily: F.stamp, fontSize: "0.58rem", textTransform: "uppercase",
                    letterSpacing: "0.1em", padding: "2px 8px", borderRadius: "1px",
                    cursor: "pointer", border: `1px solid ${active ? C.action : C.ruleDk}`,
                    background: active ? C.action : "transparent",
                    color: active ? C.paperLt : C.inkMid,
                  }}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        ) : null;
      })()}

      {pendingResume && restoreQueue(pendingResume.queueIds, cards).length > 0 && (() => {
        const rq = restoreQueue(pendingResume.queueIds, cards);
        const discard = () => { clearActive(); setPendingResume(null); };
        const resume = () => {
          const q = restoreQueue(pendingResume.queueIds, cards);
          if (!q.length) { discard(); return; }
          setQueue(q);
          if (pendingResume.stage === "result") {
            const r = pendingResume.result;
            const it = items.find((x) => x.id === r.itemId);
            if (!it) {
              const i = Math.min(pendingResume.idx ?? 0, q.length - 1);
              setIdx(i); setScores(pendingResume.scores ?? {}); setResult(null); setView("assess");
            } else {
              setIdx(Math.min(pendingResume.idx ?? 0, q.length - 1));
              setScores({});
              setResult({ ...r, item: it });
              setView("result");
            }
          } else if (pendingResume.stage === "note") {
            setSessionNote(""); setView("sessionNote");
          } else {
            const i = Math.min(pendingResume.idx ?? 0, q.length - 1);
            setIdx(i); setScores(pendingResume.scores ?? {}); setResult(null); setView("assess");
          }
          setPendingResume(null);
        };
        return (
          <div style={{ border: `1.5px solid ${C.action}`, padding: "0.75rem", marginBottom: "1rem", borderRadius: "1px" }}>
            <p style={{ fontFamily: F.stamp, fontSize: "0.6rem", letterSpacing: "0.15em", textTransform: "uppercase", color: C.action, marginBottom: "0.3rem" }}>Interrupted session</p>
            <p style={{ fontStyle: "italic", fontSize: "0.95rem", color: C.inkMid, marginBottom: "0.75rem" }}>
              Resume where you left off — item {Math.min((pendingResume.idx ?? 0) + 1, rq.length)} of {rq.length}
            </p>
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
              <button onClick={resume} style={{ fontFamily: F.display, fontSize: "1rem", padding: "0.5rem 1rem", background: C.action, color: C.paperLt, border: "none", borderRadius: "1px", cursor: "pointer" }}>
                Resume session
              </button>
              <button onClick={discard} style={{ fontFamily: F.body, fontStyle: "italic", fontSize: "0.95rem", padding: "3px 10px", background: "transparent", border: `1px solid ${C.rule}`, color: C.inkFaint, borderRadius: "1px", cursor: "pointer" }}>
                discard
              </button>
            </div>
          </div>
        );
      })()}

      {dueCards.length > 0 ? (() => {
        const pinnedDueCount = dueCards.filter((c) => isCardPinned(c, items)).length;
        const sessionCount   = Math.min(dueCards.length, Math.max(Math.min(sessionLength, dueCards.length), pinnedDueCount));
        return (
          <button onClick={startSession} style={{ width: "100%", marginBottom: "1.75rem", fontFamily: F.display, fontSize: "1.05rem", padding: "0.8rem 1rem", background: C.action, color: C.paperLt, border: "none", borderRadius: "1px", cursor: "pointer" }}>
            Begin session — {sessionCount} {sessionCount === 1 ? "item" : "items"}
          </button>
        );
      })() : (
        <div style={{ marginBottom: "1.75rem", padding: "0.75rem", border: `1px solid ${C.rule}`, textAlign: "center", fontStyle: "italic", color: C.inkFaint, fontSize: "1rem" }}>
          Nothing due — complete a session to advance the queue
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.6rem" }}>
        <p style={{ fontFamily: F.stamp, fontSize: "0.6rem", letterSpacing: "0.15em", textTransform: "uppercase", color: C.inkFaint }}>Repertoire</p>
        <button onClick={() => { setEditingId(null); setShowAdd(false); setView("repertoire"); }} style={inkBtn({ color: C.inkFaint })}>Edit →</button>
      </div>

      {cards.filter((c) => !tagFilter || cardMatchesTag(c, items, tagFilter)).map((c) => {
        const it     = items.find((e) => e.id === c.id);
        if (!it) return null;
        const due    = isDue(c);
        const pinned = isCardPinned(c, items);
        return (
          <div key={c.id}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", padding: "0.65rem 0", opacity: due || pinned ? 1 : 0.5 }}>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: "1rem", lineHeight: 1.3, color: C.ink }}>
                  <span style={{ fontWeight: 600 }}>{it.composer}</span>
                  <span style={{ color: C.inkFaint }}> · </span>
                  <span style={{ fontStyle: "italic" }}>{it.title}</span>
                </p>
                {it.detail && <p style={{ fontSize: "0.85rem", color: C.inkFaint, marginTop: "0.1rem", fontStyle: "italic" }}>{it.detail}</p>}
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.3rem", flexShrink: 0 }}>
                <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <Badge bucket={c.bucket} />
                  {pinned && (
                    <span style={{ fontFamily: F.stamp, fontSize: "0.6rem", letterSpacing: "0.12em", textTransform: "uppercase", color: C.action, border: `1px solid ${C.action}`, padding: "1px 5px", borderRadius: "1px", display: "inline-block", lineHeight: 1.6 }}>
                      Pinned
                    </span>
                  )}
                </div>
                <span style={{ fontFamily: F.stamp, fontSize: "0.58rem", color: due ? C.warm : C.inkFaint, letterSpacing: "0.04em" }}>
                  {pinned && !due ? "pinned" : formatDue(c.sessionsUntilDue ?? 0)}
                </span>
              </div>
            </div>
            <div style={{ borderTop: `1px solid ${C.rule}` }} />
          </div>
        );
      })}

      {Object.keys(badges).length > 0 && (
        <div style={{ marginTop: "1.25rem" }}>
          <p style={{ fontFamily: F.stamp, fontSize: "0.55rem", letterSpacing: "0.12em", textTransform: "uppercase", color: C.inkFaint, marginBottom: "0.4rem" }}>Badges</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {Object.entries(badges).map(([id, earnedDate]) => {
              const badge = BADGES.find((b) => b.id === id);
              if (!badge) return null;
              return (
                <span
                  key={id}
                  title={`${badge.desc} · ${new Date(earnedDate).toLocaleDateString()}`}
                  style={{ fontFamily: F.stamp, fontSize: "0.6rem", letterSpacing: "0.12em", textTransform: "uppercase", color: C.action, border: `1px solid ${C.action}`, padding: "1px 5px", borderRadius: "1px", display: "inline-block", lineHeight: 1.6 }}
                >
                  {badge.label}
                </span>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ marginTop: "1.5rem", display: "flex", justifyContent: "center", gap: "1.75rem" }}>
        <button onClick={() => { if (window.confirm("Reset all cards to Hot?")) setCards(syncCards(items, [])); }} style={inkBtn({ color: C.inkFaint })}>
          Reset all cards
        </button>
        <button onClick={() => setView("settings")} style={inkBtn({ color: C.inkFaint })}>
          Settings
        </button>
        <button onClick={() => setView("history")} style={inkBtn({ color: C.inkFaint })}>
          History
        </button>
      </div>

      {toast && (
        <div style={{ position: "fixed", bottom: "1.5rem", left: "50%", transform: "translateX(-50%)", background: C.paperLt, border: `1.5px solid ${C.action}`, borderRadius: "2px", padding: "0.6rem 1.1rem", boxShadow: "0 2px 12px rgba(28,18,9,0.18)", zIndex: 10 }}>
          <p style={{ fontFamily: F.stamp, fontSize: "0.55rem", letterSpacing: "0.12em", textTransform: "uppercase", color: C.inkFaint, marginBottom: "0.2rem" }}>Badge earned</p>
          <p style={{ fontFamily: F.display, fontSize: "1.05rem", fontWeight: 700, color: C.action }}>{toast}</p>
        </div>
      )}
    </Page>
  );

  // ── Settings ──────────────────────────────────────────────────────────────

  if (view === "settings") return (
    <Page>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "1.25rem" }}>
        <button onClick={() => setView("dash")} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: F.body, fontStyle: "italic", fontSize: "0.95rem", color: C.inkFaint, padding: 0 }}>← Journal</button>
        <p style={{ fontFamily: F.stamp, fontSize: "0.6rem", letterSpacing: "0.14em", textTransform: "uppercase", color: C.inkFaint }}>Settings</p>
      </div>

      <Rule thick />

      <p style={{ fontFamily: F.stamp, fontSize: "0.6rem", letterSpacing: "0.15em", textTransform: "uppercase", color: C.inkFaint, marginBottom: "0.3rem" }}>Review intervals</p>
      <p style={{ fontStyle: "italic", fontSize: "0.95rem", color: C.inkMid, marginBottom: "0.75rem" }}>How many sessions pass before an item comes due again.</p>

      {Object.keys(BUCKET).map((b, i) => (
        <div key={b}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.65rem 0" }}>
            <Badge bucket={b} />
            <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
              <input
                type="number" min={1} max={9}
                value={bucketSessions(b, settings)}
                onChange={(e) => {
                  const v = Math.max(1, Math.min(9, parseInt(e.target.value, 10) || 1));
                  setSettings((s) => ({ ...s, intervals: { ...(s.intervals ?? {}), [b]: v } }));
                }}
                style={{ fontFamily: F.display, fontSize: "1.1rem", color: C.ink, background: "transparent", border: "none", borderBottom: `1px solid ${C.rule}`, outline: "none", width: "3rem", textAlign: "center", padding: "2px 0" }}
              />
              <span style={{ fontFamily: F.stamp, fontSize: "0.58rem", color: C.inkFaint, letterSpacing: "0.05em" }}>
                {bucketSessions(b, settings) === 1 ? "every session" : `every ${bucketSessions(b, settings)} sessions`}
              </span>
            </div>
          </div>
          {i < Object.keys(BUCKET).length - 1 && <div style={{ borderTop: `1px solid ${C.rule}` }} />}
        </div>
      ))}

      <Rule />
      <div style={{ textAlign: "center", marginTop: "1rem" }}>
        <button
          onClick={() => setSettings((s) => ({ ...s, intervals: { ...DEFAULT_SETTINGS.intervals } }))}
          style={inkBtn({ color: C.inkFaint })}
        >
          Restore default intervals
        </button>
      </div>

      <Rule thick />

      <p style={{ fontFamily: F.stamp, fontSize: "0.6rem", letterSpacing: "0.15em", textTransform: "uppercase", color: C.inkFaint, marginBottom: "0.3rem" }}>Assessment rubric</p>
      <p style={{ fontStyle: "italic", fontSize: "0.95rem", color: C.inkMid, marginBottom: "0.75rem" }}>Define 1–6 criteria to mark each assessment against.</p>

      {(settings.criteria ?? CRITERIA).map((c, i) => (
        <div key={c.id}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.5rem 0" }}>
            <div style={{ flex: 1 }}>
              <JournalInput
                value={c.label}
                placeholder="Criterion label"
                onChange={(v) => {
                  const base = settings.criteria ?? CRITERIA.map((cr) => ({ ...cr }));
                  const updated = base.map((cr, j) => j === i ? { ...cr, label: v } : cr);
                  setSettings((s) => ({ ...s, criteria: updated }));
                }}
              />
            </div>
            <button
              onClick={() => {
                const base = settings.criteria ?? CRITERIA.map((cr) => ({ ...cr }));
                const updated = base.filter((_, j) => j !== i);
                setSettings((s) => ({ ...s, criteria: updated }));
              }}
              disabled={(settings.criteria ?? CRITERIA).length <= 1}
              style={inkBtn({ color: C.fail, letterSpacing: 0, fontSize: "0.85rem", opacity: (settings.criteria ?? CRITERIA).length <= 1 ? 0.3 : 1, cursor: (settings.criteria ?? CRITERIA).length <= 1 ? "not-allowed" : "pointer" })}
            >
              ×
            </button>
          </div>
          {i < (settings.criteria ?? CRITERIA).length - 1 && <div style={{ borderTop: `1px solid ${C.rule}` }} />}
        </div>
      ))}

      {(settings.criteria ?? CRITERIA).length < 6 && (
        <div style={{ marginTop: "0.75rem" }}>
          <button
            onClick={() => {
              const base = settings.criteria ?? CRITERIA.map((cr) => ({ ...cr }));
              setSettings((s) => ({ ...s, criteria: [...base, { id: `crit_${Date.now().toString(36)}`, label: "" }] }));
            }}
            style={inkBtn({ color: C.inkMid, display: "flex", alignItems: "center", gap: "0.4rem" })}
          >
            <span style={{ fontSize: "1rem", fontFamily: F.display, lineHeight: 1 }}>+</span> Add criterion
          </button>
        </div>
      )}

      <Rule />
      <div style={{ textAlign: "center", marginTop: "1rem" }}>
        <button
          onClick={() => setSettings((s) => ({ ...s, criteria: CRITERIA.map((c) => ({ ...c })) }))}
          style={inkBtn({ color: C.inkFaint })}
        >
          Restore default rubric
        </button>
      </div>

      <Rule thick />

      <p style={{ fontFamily: F.stamp, fontSize: "0.6rem", letterSpacing: "0.15em", textTransform: "uppercase", color: C.inkFaint, marginBottom: "0.3rem" }}>Pomodoro timer</p>
      <p style={{ fontStyle: "italic", fontSize: "0.95rem", color: C.inkMid, marginBottom: "0.75rem" }}>Work and break lengths in minutes.</p>

      {[
        { key: "work",  label: "Work"  },
        { key: "break", label: "Break" },
      ].map(({ key, label }, i) => (
        <div key={key}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.65rem 0" }}>
            <span style={{ fontFamily: F.stamp, fontSize: "0.6rem", letterSpacing: "0.12em", textTransform: "uppercase", color: C.inkFaint }}>{label}</span>
            <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
              <input
                type="number" min={1} max={120}
                value={pomodoroMinutes(settings, key)}
                onChange={(e) => {
                  const v = Math.max(1, Math.min(120, parseInt(e.target.value, 10) || 1));
                  setSettings((s) => ({ ...s, pomodoro: { ...(s.pomodoro ?? {}), [key]: v } }));
                }}
                style={{ fontFamily: F.display, fontSize: "1.1rem", color: C.ink, background: "transparent", border: "none", borderBottom: `1px solid ${C.rule}`, outline: "none", width: "3rem", textAlign: "center", padding: "2px 0" }}
              />
              <span style={{ fontFamily: F.stamp, fontSize: "0.58rem", color: C.inkFaint, letterSpacing: "0.05em" }}>min</span>
            </div>
          </div>
          {i === 0 && <div style={{ borderTop: `1px solid ${C.rule}` }} />}
        </div>
      ))}

      <Rule thick />

      <p style={{ fontFamily: F.stamp, fontSize: "0.6rem", letterSpacing: "0.15em", textTransform: "uppercase", color: C.inkFaint, marginBottom: "0.3rem" }}>Backup</p>
      <p style={{ fontStyle: "italic", fontSize: "0.95rem", color: C.inkMid, marginBottom: "0.75rem" }}>Download all journal data as JSON, or restore from a backup file.</p>

      <input
        type="file"
        accept="application/json,.json"
        ref={importRef}
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files[0];
          if (!file) return;
          file.text().then((text) => {
            let parsed;
            try { parsed = JSON.parse(text); } catch { window.alert("Not a valid Practice Journal backup file."); return; }
            if (!validImport(parsed)) { window.alert("Not a valid Practice Journal backup file."); return; }
            if (window.confirm("Replace ALL current data with this backup? Items, history, sessions, badges, and settings will be overwritten.")) {
              for (const [k, v] of Object.entries(parsed.data)) {
                if (Object.values(KEYS).includes(k)) save(k, v);
              }
              window.location.reload();
            }
          });
          e.target.value = "";
        }}
      />

      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <button
          onClick={() => {
            const payload = buildExport();
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `practice-journal-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
          }}
          style={{ fontFamily: F.body, fontStyle: "italic", fontSize: "0.95rem", padding: "3px 10px", background: "transparent", border: `1px solid ${C.rule}`, color: C.inkFaint, borderRadius: "1px", cursor: "pointer" }}
        >
          Export data
        </button>
        <button
          onClick={() => importRef.current?.click()}
          style={{ fontFamily: F.body, fontStyle: "italic", fontSize: "0.95rem", padding: "3px 10px", background: "transparent", border: `1px solid ${C.rule}`, color: C.inkFaint, borderRadius: "1px", cursor: "pointer" }}
        >
          Import data…
        </button>
      </div>
    </Page>
  );

  // ── History ───────────────────────────────────────────────────────────────

  if (view === "history") return (
    <Page>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "1.25rem" }}>
        <button onClick={() => setView("dash")} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: F.body, fontStyle: "italic", fontSize: "0.95rem", color: C.inkFaint, padding: 0 }}>← Journal</button>
        <p style={{ fontFamily: F.stamp, fontSize: "0.6rem", letterSpacing: "0.14em", textTransform: "uppercase", color: C.inkFaint }}>History</p>
      </div>

      <Rule thick />

      <p style={{ fontFamily: F.display, fontSize: "1.3rem", fontWeight: 700, color: C.ink, marginBottom: "0.15rem" }}>
        {sessions.length} sessions logged
      </p>
      <p style={{ fontFamily: F.stamp, fontSize: "0.58rem", letterSpacing: "0.1em", textTransform: "uppercase", color: C.inkFaint, marginBottom: "1.25rem" }}>
        {streakDays(sessions)} day streak
      </p>

      {items.map((it) => {
        const c = cards.find((x) => x.id === it.id);
        if (!c) return null;
        const last10 = (c.history ?? []).slice(-10);
        const transitions = bucketTransitions(c.history);
        return (
          <div key={it.id}>
            <div style={{ padding: "0.75rem 0" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", marginBottom: "0.4rem" }}>
                <p style={{ fontSize: "1rem", lineHeight: 1.3, color: C.ink }}>
                  <span style={{ fontWeight: 600 }}>{it.composer}</span>
                  <span style={{ color: C.inkFaint }}> · </span>
                  <span style={{ fontStyle: "italic" }}>{it.title}</span>
                </p>
                <div style={{ flexShrink: 0, marginTop: "0.1rem" }}><Badge bucket={c.bucket} /></div>
              </div>
              <div style={{ marginBottom: "0.3rem" }}>
                {last10.length > 0 ? (
                  last10.map((h, i) => {
                    const col = scoreColor(h.ups, h.total);
                    const bg  = col === "pass" ? C.pass : col === "warm" ? C.warm : C.fail;
                    return (
                      <span
                        key={i}
                        title={`${new Date(h.date).toLocaleDateString()} · ${h.ups}/${h.total ?? 4}`}
                        style={{ display: "inline-block", width: 10, height: 10, borderRadius: 1, marginRight: 3, background: bg }}
                      />
                    );
                  })
                ) : (
                  <span style={{ fontStyle: "italic", fontSize: "0.9rem", color: C.inkFaint }}>no assessments yet</span>
                )}
              </div>
              <p style={{ fontFamily: F.stamp, fontSize: "0.55rem", letterSpacing: "0.08em", color: C.inkFaint }}>
                {(c.history ?? []).length} assessments
                {transitions.length > 1 && (
                  <span> · {transitions.map((b) => BUCKET[b].label).join(" → ")}</span>
                )}
              </p>
            </div>
            <div style={{ borderTop: `1px solid ${C.rule}` }} />
          </div>
        );
      })}

      {(() => {
        const notedSessions = [...sessions].reverse().filter((s) => s.note && s.note.trim()).slice(0, 5);
        if (!notedSessions.length) return null;
        return (
          <div style={{ marginTop: "1.25rem" }}>
            <p style={{ fontFamily: F.stamp, fontSize: "0.6rem", letterSpacing: "0.15em", textTransform: "uppercase", color: C.inkFaint, marginBottom: "0.5rem" }}>Recent notes</p>
            {notedSessions.map((s, i) => (
              <div key={s.date}>
                <div style={{ padding: "0.6rem 0" }}>
                  <p style={{ fontFamily: F.stamp, fontSize: "0.55rem", letterSpacing: "0.08em", textTransform: "uppercase", color: C.inkFaint, marginBottom: "0.2rem" }}>
                    {new Date(s.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </p>
                  <p style={{ fontStyle: "italic", fontFamily: F.body, fontSize: "1rem", color: C.inkMid, whiteSpace: "pre-wrap" }}>{s.note}</p>
                </div>
                {i < notedSessions.length - 1 && <div style={{ borderTop: `1px solid ${C.rule}` }} />}
              </div>
            ))}
          </div>
        );
      })()}
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
                <div style={{ marginBottom: "0.75rem" }}>
                  <p style={{ fontFamily: F.stamp, fontSize: "0.55rem", letterSpacing: "0.12em", textTransform: "uppercase", color: C.inkFaint, marginBottom: "0.2rem" }}>Notes</p>
                  <textarea
                    value={editDraft.notes}
                    onChange={(e) => setEditDraft((d) => ({ ...d, notes: e.target.value }))}
                    placeholder="Practice notes, tips, context…"
                    style={{ fontFamily: F.body, fontSize: "0.95rem", color: C.ink, background: "transparent", border: `1px solid ${C.rule}`, outline: "none", width: "100%", padding: "6px 8px", borderRadius: "1px", resize: "vertical", minHeight: "3.5rem" }}
                  />
                </div>
                <div style={{ marginBottom: "0.75rem" }}>
                  <p style={{ fontFamily: F.stamp, fontSize: "0.55rem", letterSpacing: "0.12em", textTransform: "uppercase", color: C.inkFaint, marginBottom: "0.2rem" }}>Tags</p>
                  <JournalInput value={editDraft.tags} onChange={(v) => setEditDraft((d) => ({ ...d, tags: v }))} placeholder="audition, etudes, … (comma-separated)" />
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
                  {itemTags(it).length > 0 && (
                    <p style={{ fontFamily: F.stamp, fontSize: "0.55rem", color: C.inkFaint, letterSpacing: "0.08em", marginTop: "0.15rem" }}>
                      {itemTags(it).join(" · ")}
                    </p>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexShrink: 0, paddingTop: "0.2rem" }}>
                  {card && <Badge bucket={card.bucket} />}
                  <button
                    onClick={() => setItems((prev) => prev.map((e) => e.id !== it.id ? e : { ...e, pinned: !e.pinned }))}
                    style={inkBtn({ color: it.pinned ? C.action : C.inkFaint })}
                  >
                    {it.pinned ? "pinned" : "pin"}
                  </button>
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
            <div style={{ marginBottom: "0.75rem" }}>
              <p style={{ fontFamily: F.stamp, fontSize: "0.55rem", letterSpacing: "0.12em", textTransform: "uppercase", color: C.inkFaint, marginBottom: "0.2rem" }}>Notes</p>
              <textarea
                value={newDraft.notes}
                onChange={(e) => setNewDraft((d) => ({ ...d, notes: e.target.value }))}
                placeholder="Practice notes, tips, context…"
                style={{ fontFamily: F.body, fontSize: "0.95rem", color: C.ink, background: "transparent", border: `1px solid ${C.rule}`, outline: "none", width: "100%", padding: "6px 8px", borderRadius: "1px", resize: "vertical", minHeight: "3.5rem" }}
              />
            </div>
            <div style={{ marginBottom: "0.75rem" }}>
              <p style={{ fontFamily: F.stamp, fontSize: "0.55rem", letterSpacing: "0.12em", textTransform: "uppercase", color: C.inkFaint, marginBottom: "0.2rem" }}>Tags</p>
              <JournalInput value={newDraft.tags} onChange={(v) => setNewDraft((d) => ({ ...d, tags: v }))} placeholder="audition, etudes, … (comma-separated)" />
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
      <PomodoroChip pomo={pomo} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "1.25rem" }}>
        <button onClick={() => { clearActive(); setView("dash"); }} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: F.body, fontStyle: "italic", fontSize: "0.95rem", color: C.inkFaint, padding: 0 }}>← Journal</button>
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

      {item.notes && (
        <div style={{ marginTop: "0.6rem", paddingLeft: "0.75rem", borderLeft: `2px solid ${C.rule}` }}>
          <p style={{ fontFamily: F.stamp, fontSize: "0.55rem", letterSpacing: "0.12em", textTransform: "uppercase", color: C.inkFaint, marginBottom: "0.2rem" }}>Notes</p>
          <p style={{ fontStyle: "italic", fontFamily: F.body, fontSize: "0.95rem", color: C.inkMid, whiteSpace: "pre-wrap" }}>{item.notes}</p>
        </div>
      )}

      <Rule thick />
      <p style={{ fontStyle: "italic", fontSize: "0.95rem", color: C.inkMid, marginBottom: "1rem" }}>Play through cold, then mark each criterion:</p>

      <div style={{ marginBottom: "1.5rem" }}>
        {criteria.map((c, i) => (
          <div key={c.id}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.65rem 0" }}>
              <span style={{ fontSize: "1.1rem", color: C.ink }}>{c.label}</span>
              <div style={{ display: "flex", gap: "0.4rem" }}>
                <MarkButton active={scores[c.id] === true}  variant="pass" onClick={() => toggleScore(c.id, true)}>✓</MarkButton>
                <MarkButton active={scores[c.id] === false} variant="fail" onClick={() => toggleScore(c.id, false)}>✗</MarkButton>
              </div>
            </div>
            {i < criteria.length - 1 && <div style={{ borderTop: `1px solid ${C.rule}` }} />}
          </div>
        ))}
      </div>

      <button onClick={submit} disabled={!allRated} style={{ width: "100%", fontFamily: F.display, fontSize: "1rem", padding: "0.75rem", background: allRated ? C.action : "transparent", color: allRated ? C.paperLt : C.inkFaint, border: `1px solid ${allRated ? C.action : C.rule}`, borderRadius: "1px", cursor: allRated ? "pointer" : "not-allowed" }}>
        {allRated ? "Record assessment" : `Mark all criteria · ${Object.values(scores).filter((v) => v !== undefined).length} / ${criteria.length}`}
      </button>

      <PomodoroControls pomo={pomo} />
      <Tuner />
      <Metronome />
      <Recorder itemId={item.id} />
    </Page>
  );

  // ── Result ────────────────────────────────────────────────────────────────

  if (view === "result" && result) {
    const { item, oldBucket, newBucket, ups, failed, total = 4 } = result;
    const promoted = BUCKET[oldBucket].up === newBucket;
    const demoted  = BUCKET[oldBucket].dn === newBucket;
    return (
      <Page>
        <PomodoroChip pomo={pomo} />
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
          <p style={{ fontFamily: F.stamp, fontSize: "0.6rem", color: C.inkFaint, letterSpacing: "0.05em" }}>{ups}/{total} · {formatDue(bucketSessions(newBucket, settings))}</p>
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

  // ── Session note ──────────────────────────────────────────────────────────

  if (view === "sessionNote") {
    const closeSession = (note) => {
      clearActive();
      setSessions((p) => [...p, { date: new Date().toISOString(), note: note.trim(), itemIds: queue.map((q) => q.id) }]);
      setView("dash");
    };
    return (
      <Page>
        <p style={{ fontFamily: F.stamp, fontSize: "0.6rem", letterSpacing: "0.14em", textTransform: "uppercase", color: C.inkFaint, marginBottom: "1rem" }}>Session complete</p>
        <Rule thick />
        <p style={{ fontStyle: "italic", fontSize: "1rem", color: C.inkMid, marginBottom: "0.75rem" }}>How did it go? Leave a note for your future self.</p>
        <textarea
          value={sessionNote}
          onChange={(e) => setSessionNote(e.target.value)}
          style={{ fontFamily: F.body, fontSize: "1rem", color: C.ink, background: "transparent", border: `1px solid ${C.rule}`, outline: "none", width: "100%", padding: "8px 10px", borderRadius: "1px", resize: "vertical", minHeight: "6rem" }}
        />
        <button
          onClick={() => closeSession(sessionNote)}
          style={{ width: "100%", marginTop: "1rem", fontFamily: F.display, fontSize: "1rem", padding: "0.75rem", background: C.action, color: C.paperLt, border: "none", borderRadius: "1px", cursor: "pointer" }}
        >
          Close session
        </button>
        <div style={{ textAlign: "center", marginTop: "0.75rem" }}>
          <button onClick={() => closeSession("")} style={inkBtn({ color: C.ink })}>skip note</button>
        </div>
      </Page>
    );
  }

  return null;
}
