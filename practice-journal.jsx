import { useState, useEffect, useRef, useCallback } from "react";
import { DndContext, closestCenter } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, arrayMove, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  BUCKET, CRITERIA, DEFAULT_EXCERPTS, DEFAULT_SETTINGS, BERRIES, SEGMENT_TYPES,
  isDue, formatDue, draftValid, emptyDraft, newId, shuffle,
  advanceBucket, bucketSessions, syncCards, KEYS, load, save, getCriteria,
  itemTags, parseTags, isCardPinned, cardMatchesTag, sessionPool, buildQueue,
  weeklyStats, streakDays, BADGES, computeBadges, bucketTransitions, scoreColor,
  pomodoroMinutes, nextPhase, fmtClock, tapBpm,
  buildExport, validImport, restoreQueue,
  freqToNote, autoCorrelate,
  recordingLimit, fmtBytes,
  validAttachment,
  recordingStorageMode,
} from "./src/lib/sr.js";
import { listRecordings, saveRecording, deleteRecording, recordingUsage } from "./src/lib/recordings.js";
import {
  cloudEnabled, uploadRecording, listCloudRecordings, downloadRecording,
  pruneCloud, cloudUsage,
} from "./src/lib/cloudRecordings.js";
import { getAttachment, saveAttachment, deleteAttachment } from "./src/lib/attachments.js";
import { supabase } from "./src/lib/supabase.js";
import {
  stampAndUpsert, pullUserData, fetchAllRows, uploadAll, applyRows,
  migrationPlan, mergeById, isMigrated, setMigrated, SYNC_KEYS,
  flushQueue, onSyncStatus,
} from "./src/lib/sync.js";

const longDate = () => new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

// ── Design tokens ─────────────────────────────────────────────────────────────

const C = {
  paper:   "#f5eed9", paperLt: "#faf6ec",
  ink:     "#1c1209", inkMid:  "#4a3d2c", inkFaint: "#76684f",
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
  const color = { c: C.hot, b: C.warm, a: C.cold }[bucket];
  return (
    <span style={{ fontFamily: F.stamp, fontSize: "0.6rem", letterSpacing: "0.12em", textTransform: "uppercase", color, border: `1px solid ${color}`, padding: "1px 5px", borderRadius: "1px", display: "inline-block", lineHeight: 1.6 }}>
      {BUCKET[bucket].label}
    </span>
  );
}

function MarkButton({ active, variant, onClick, children, label }) {
  const ac = variant === "pass" ? C.pass : C.fail;
  return (
    <button
      onClick={onClick}
      aria-label={label ? `${label}: ${variant === "pass" ? "pass" : "fail"}` : undefined}
      aria-pressed={active}
      style={{ width: "2.6rem", height: "2.6rem", border: `1.5px solid ${active ? ac : C.rule}`, background: active ? ac : "transparent", color: active ? C.paperLt : C.inkFaint, borderRadius: "1px", cursor: "pointer", fontFamily: F.display, fontSize: "1.15rem", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.1s", lineHeight: 1 }}>
      <span aria-hidden="true">{children}</span>
    </button>
  );
}

function JournalInput({ value, onChange, placeholder, style = {}, ariaLabel }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel ?? placeholder}
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
        aria-label="Journal context"
        style={{ fontFamily: F.body, fontStyle: "italic", fontSize: "1.05rem", color: C.inkMid, background: "transparent", border: "none", borderBottom: `1px solid ${C.ruleDk}`, outline: "none", flex: 1, padding: "2px 0" }}
      />
      <button onClick={commit} aria-label="Save context" style={inkBtn({ color: C.action })}>save</button>
      <button onClick={cancel} aria-label="Cancel editing context" style={inkBtn({ color: C.inkFaint })}>×</button>
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
        <input type="range" min={1} max={max} value={Math.min(value, max)} onChange={(e) => onChange(Number(e.target.value))} aria-label="Items per session" style={{ width: "100%", margin: 0 }} />
        <div aria-hidden="true" style={{ display: "flex", justifyContent: "space-between", marginTop: "0.15rem" }}>
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

// ── Recordings shared hook ────────────────────────────────────────────────────

function useRecordings(itemId) {
  const [recs,   setRecs] = useState([]);
  const urlsRef           = useRef(new Map());

  useEffect(() => {
    let alive = true;
    listRecordings(itemId).then((r) => { if (alive) setRecs(r); }).catch(() => {});
    return () => { alive = false; };
  }, [itemId]);

  // Revoke all cached object URLs on unmount
  useEffect(() => {
    const urls = urlsRef.current;
    return () => { urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, []);

  const urlFor = (rec) => {
    if (!urlsRef.current.has(rec.id)) urlsRef.current.set(rec.id, URL.createObjectURL(rec.blob));
    return urlsRef.current.get(rec.id);
  };

  const removeRec = (id) => {
    deleteRecording(id)
      .then(() => listRecordings(itemId))
      .then(setRecs)
      .catch(() => {});
    const u = urlsRef.current.get(id);
    if (u) { URL.revokeObjectURL(u); urlsRef.current.delete(id); }
  };

  return { recs, setRecs, urlFor, removeRec };
}

// ── Recording rows (shared between Recorder and RecordingList) ────────────────

function RecordingRows({ itemId, recs, urlFor, removeRec }) {
  if (!recs.length) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
      {recs.map((r, i) => (
        <div key={r.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span aria-hidden="true" style={{ fontFamily: F.stamp, fontSize: "0.6rem", color: C.inkFaint, flexShrink: 0 }}>{i + 1}.</span>
          <audio src={urlFor(r)} controls aria-label={`Recording from ${r.date ? new Date(r.date).toLocaleDateString() : `take ${i + 1}`}`} style={{ flex: 1, height: "26px", minWidth: 0 }} />
          <span style={{ fontFamily: F.stamp, fontSize: "0.6rem", color: C.inkFaint, flexShrink: 0 }}>{fmtClock(r.durationMs / 1000)}</span>
          <a
            href={urlFor(r)}
            download={`take_${itemId}_${r.date.slice(0, 19).replace(/[:T]/g, "")}.webm`}
            aria-label={`Download recording from ${r.date ? new Date(r.date).toLocaleDateString() : `take ${i + 1}`}`}
            style={{ fontFamily: F.stamp, fontSize: "0.6rem", color: C.inkMid, textDecoration: "none", border: `1px solid ${C.rule}`, padding: "2px 5px", borderRadius: "1px", flexShrink: 0 }}
          >↓ webm</a>
          <button
            onClick={() => removeRec(r.id)}
            aria-label="Delete recording"
            style={{ ...inkBtn({ color: C.fail, letterSpacing: 0, fontSize: "0.85rem" }), flexShrink: 0 }}
          >×</button>
        </div>
      ))}
    </div>
  );
}

// ── Recorder ──────────────────────────────────────────────────────────────────

function Recorder({ itemId, limit, cloudOn, user }) {
  const [state,     setState]     = useState("idle");
  const [err,       setErr]       = useState("");
  const [uploading, setUploading] = useState(false);
  const { recs, setRecs, urlFor, removeRec } = useRecordings(itemId);

  const mediaRecorderRef = useRef(null);
  const streamRef        = useRef(null);
  const chunksRef        = useRef([]);
  const startedAtRef     = useRef(0);
  const limitRef         = useRef(limit);
  const cloudOnRef       = useRef(cloudOn);
  const userRef          = useRef(user);

  useEffect(() => { limitRef.current  = limit; },   [limit]);
  useEffect(() => { cloudOnRef.current = cloudOn; }, [cloudOn]);
  useEffect(() => { userRef.current    = user; },    [user]);

  // Cleanup on unmount: stop any active recording
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const start = async () => {
    setErr("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "";
      const recorder = new MediaRecorder(stream, {
        ...(mime ? { mimeType: mime } : {}),
        audioBitsPerSecond: 320_000,
      });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };

      recorder.onstop = () => {
        const finalMime = mime || "audio/webm";
        const rec = {
          id:         newId().replace("item_", "rec_"),
          itemId,
          date:       new Date().toISOString(),
          blob:       new Blob(chunksRef.current, { type: finalMime }),
          durationMs: Math.round(performance.now() - startedAtRef.current),
          format:     finalMime,
        };
        saveRecording(rec, limitRef.current)
          .then(() => listRecordings(itemId))
          .then(setRecs)
          .catch((e) => setErr(e.message));
        if (cloudOnRef.current && userRef.current) {
          setUploading(true);
          uploadRecording(userRef.current, rec)
            .then((ok) => ok && pruneCloud(userRef.current, itemId, limitRef.current))
            .catch(() => {})
            .finally(() => setUploading(false));
        }
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      };

      recorder.start();
      startedAtRef.current = performance.now();
      setState("recording");
    } catch (e) {
      setErr(e.message);
    }
  };

  const stop = () => {
    mediaRecorderRef.current?.stop();
    setState("idle");
  };

  return (
    <div style={{ marginTop: "1.5rem", paddingTop: "1rem", borderTop: `1px dashed ${C.rule}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: recs.length ? "0.75rem" : 0 }}>
        <button
          onClick={state === "idle" ? start : stop}
          style={{ fontFamily: F.body, fontStyle: "italic", fontSize: "0.95rem", padding: "3px 10px", background: "transparent", border: `1px solid ${state === "recording" ? C.fail : C.rule}`, color: state === "recording" ? C.fail : C.inkFaint, borderRadius: "1px", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px" }}
        >
          <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: state === "recording" ? C.fail : C.ruleDk, animation: state === "recording" ? "recpulse 1s infinite" : "none" }} />
          {state === "recording" ? "Stop recording" : "Record take"}
        </button>
        {err && <span style={{ fontFamily: F.stamp, fontSize: "0.6rem", color: C.fail }}>{err}</span>}
        {uploading && (
          <span style={{ fontFamily: F.stamp, fontSize: "0.6rem", color: C.inkFaint }}>
            <span style={{ display: "inline-block", animation: "syncspin 1.2s linear infinite" }}>↻</span>
            {" uploading"}
          </span>
        )}
      </div>
      <RecordingRows itemId={itemId} recs={recs} urlFor={urlFor} removeRec={removeRec} />
    </div>
  );
}

// ── RecordingList (history view — no capture controls) ────────────────────────

function RecordingList({ itemId, user }) {
  const { recs, urlFor, removeRec } = useRecordings(itemId);
  const [cloudRecs, setCloudRecs]   = useState([]);
  const [loadedMap, setLoadedMap]   = useState({});
  const cloudUrlsRef                = useRef(new Map());

  useEffect(() => {
    let alive = true;
    listCloudRecordings(user ?? null, itemId)
      .then((rs) => { if (alive) setCloudRecs(user ? rs : []); })
      .catch(() => {});
    return () => { alive = false; };
  }, [user, itemId]);

  // Revoke cloud object URLs on unmount
  useEffect(() => {
    const urls = cloudUrlsRef.current;
    return () => { urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, []);

  const localIds  = new Set(recs.map((r) => r.id));
  const cloudOnly = cloudRecs.filter((r) => !localIds.has(r.id));

  const handleLoad = (r) => {
    if (loadedMap[r.id]) return; // already loading/loaded
    downloadRecording(r.path)
      .then((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        cloudUrlsRef.current.set(r.id, url);
        setLoadedMap((m) => ({ ...m, [r.id]: url }));
      })
      .catch(() => {});
  };

  const hasAny = recs.length > 0 || cloudOnly.length > 0;
  if (!hasAny) return null;

  return (
    <div style={{ marginTop: "0.5rem" }}>
      <RecordingRows itemId={itemId} recs={recs} urlFor={urlFor} removeRec={removeRec} />
      {cloudOnly.map((r) => (
        <div key={r.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.4rem" }}>
          <span aria-hidden="true" style={{ fontFamily: F.stamp, fontSize: "0.6rem", color: C.inkFaint, flexShrink: 0 }}>☁</span>
          <span style={{ fontFamily: F.stamp, fontSize: "0.6rem", color: C.inkFaint, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {r.date ? new Date(r.date).toLocaleDateString() : r.name}
          </span>
          <span style={{ fontFamily: F.stamp, fontSize: "0.6rem", color: C.inkFaint, flexShrink: 0 }}>{fmtBytes(r.size)}</span>
          {loadedMap[r.id] ? (
            <audio src={loadedMap[r.id]} controls aria-label={`Cloud recording from ${r.date ? new Date(r.date).toLocaleDateString() : r.name}`} style={{ flex: 1, height: "26px", minWidth: 0 }} />
          ) : (
            <button
              onClick={() => handleLoad(r)}
              style={{ fontFamily: F.stamp, fontSize: "0.6rem", color: C.inkMid, background: "transparent", border: `1px solid ${C.rule}`, padding: "2px 5px", borderRadius: "1px", cursor: "pointer", flexShrink: 0 }}
            >load</button>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Recordings settings section ───────────────────────────────────────────────

function RecordingsSettings({ settings, setSettings, user }) {
  const [usage,       setUsage]       = useState(null);
  const [cloudUsageB, setCloudUsageB] = useState(null);
  const mode = recordingStorageMode(settings);

  useEffect(() => { recordingUsage().then(setUsage).catch(() => {}); }, []);

  useEffect(() => {
    let alive = true;
    const fetch = user && mode === "cloud"
      ? cloudUsage(user)
      : Promise.resolve(null);
    fetch.then((n) => { if (alive) setCloudUsageB(n); }).catch(() => {});
    return () => { alive = false; };
  }, [user, mode]);

  return (
    <>
      <p style={{ fontFamily: F.stamp, fontSize: "0.6rem", letterSpacing: "0.15em", textTransform: "uppercase", color: C.inkFaint, marginBottom: "0.3rem" }}>Recordings</p>
      <p style={{ fontStyle: "italic", fontSize: "0.95rem", color: C.inkMid, marginBottom: "0.75rem" }}>Keep the most recent takes per item; older ones are pruned automatically.</p>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.65rem 0" }}>
        <span style={{ fontFamily: F.stamp, fontSize: "0.6rem", letterSpacing: "0.12em", textTransform: "uppercase", color: C.inkFaint }}>Takes kept per item</span>
        <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
          <input
            type="number" min={1} max={20}
            value={recordingLimit(settings)}
            aria-label="Recordings kept per item"
            onChange={(e) => {
              const v = Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 1));
              setSettings((s) => ({ ...s, recordingLimit: v }));
            }}
            style={{ fontFamily: F.display, fontSize: "1.1rem", color: C.ink, background: "transparent", border: "none", borderBottom: `1px solid ${C.rule}`, outline: "none", width: "3rem", textAlign: "center", padding: "2px 0" }}
          />
          <span style={{ fontFamily: F.stamp, fontSize: "0.58rem", color: C.inkFaint, letterSpacing: "0.05em" }}>takes</span>
        </div>
      </div>
      {usage !== null && (
        <p style={{ fontFamily: F.stamp, fontSize: "0.55rem", color: C.inkFaint, letterSpacing: "0.08em", marginTop: "0.25rem" }}>
          storage used: {fmtBytes(usage)}
        </p>
      )}
      {user && (
        <div style={{ marginTop: "0.75rem" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.65rem 0" }}>
            <span style={{ fontFamily: F.stamp, fontSize: "0.6rem", letterSpacing: "0.12em", textTransform: "uppercase", color: C.inkFaint }}>Recording storage</span>
            <span>
              <button
                onClick={() => setSettings((s) => ({ ...s, recordingStorage: "local" }))}
                aria-pressed={mode === "local"}
                style={inkBtn({ color: mode === "local" ? C.action : C.inkFaint })}
              >Local only</button>
              {" · "}
              <button
                onClick={() => setSettings((s) => ({ ...s, recordingStorage: "cloud" }))}
                aria-pressed={mode === "cloud"}
                style={inkBtn({ color: mode === "cloud" ? C.action : C.inkFaint })}
              >Cloud</button>
            </span>
          </div>
          <p style={{ fontStyle: "italic", fontSize: "0.85rem", color: C.inkFaint, marginTop: "0.15rem" }}>
            Cloud uploads are opt-in; recordings stay on this device by default.
          </p>
          {mode === "cloud" && cloudUsageB !== null && (
            <p style={{ fontFamily: F.stamp, fontSize: "0.55rem", color: C.inkFaint, letterSpacing: "0.08em", marginTop: "0.25rem" }}>
              cloud storage: {fmtBytes(cloudUsageB)} of 1 GB
            </p>
          )}
        </div>
      )}
    </>
  );
}

// ── Strobe canvas renderer ────────────────────────────────────────────────────

function drawStrobeCanvas(canvas, phases, amps, note, inTune) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.offsetWidth || 160;
  const cssH = canvas.offsetHeight || 160;
  const pw = Math.round(cssW * dpr);
  const ph = Math.round(cssH * dpr);
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width  = pw;
    canvas.height = ph;
  }
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, pw, ph);
  ctx.save();
  ctx.scale(dpr, dpr);

  const cx = cssW / 2, cy = cssH / 2;
  const HARMONICS = 5;
  const SEGMENTS  = 12;
  const GAP       = 1.5;
  const holeR     = 22;
  const outerR    = cssW * 0.475;
  const bandW     = (outerR - holeR) / HARMONICS;

  // Rings: ring 1 (fundamental) innermost, ring 5 outermost
  for (let k = 1; k <= HARMONICS; k++) {
    const r0 = holeR + (k - 1) * bandW + GAP;
    const r1 = holeR + k * bandW;
    const phase = phases[k - 1];
    const alpha = 0.2 + amps[k - 1] * 0.8;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(phase);
    ctx.fillStyle = `rgba(28,18,9,${alpha.toFixed(3)})`; // C.ink

    for (let seg = 0; seg < SEGMENTS; seg += 2) {
      const a0 = (seg / SEGMENTS) * Math.PI * 2 - Math.PI / 2;
      const a1 = ((seg + 1) / SEGMENTS) * Math.PI * 2 - Math.PI / 2;
      ctx.beginPath();
      ctx.arc(0, 0, r1, a0, a1);
      ctx.arc(0, 0, r0, a1, a0, true);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // Harmonic label on the right edge of each ring
    const labelR = (r0 + r1) / 2;
    ctx.save();
    ctx.font = `${Math.round(bandW * 0.48)}px 'Special Elite', monospace`;
    ctx.fillStyle = `rgba(118,104,79,${(0.5 + amps[k - 1] * 0.5).toFixed(2)})`; // C.inkFaint
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(`${k}×`, cx + labelR + 3, cy);
    ctx.restore();
  }

  // Center hole
  ctx.beginPath();
  ctx.arc(cx, cy, holeR - GAP, 0, Math.PI * 2);
  ctx.fillStyle = "#f5eed9"; // C.paper
  ctx.fill();
  ctx.strokeStyle = "#d8cdb5"; // C.rule
  ctx.lineWidth = 1;
  ctx.stroke();

  // Note name
  const noteLabel = note ? `${note.name}${note.octave}` : "—";
  ctx.font = `bold ${Math.round(holeR * 0.9)}px 'Playfair Display', Georgia, serif`;
  ctx.fillStyle = inTune ? "#1a4a1a" : "#1c1209"; // C.pass : C.ink
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(noteLabel, cx, cy);

  ctx.restore();
}

// ── Tuner ─────────────────────────────────────────────────────────────────────

function Tuner() {
  const [open,    setOpen]    = useState(false);
  const [running, setRunning] = useState(false);
  const [mode,    setMode]    = useState("chromatic");
  const [reading, setReading] = useState(null);
  const [err,     setErr]     = useState("");

  const ctxRef       = useRef(null);
  const analyserRef  = useRef(null);
  const streamRef    = useRef(null);
  const rafRef       = useRef(null);
  const bufRef       = useRef(null);
  const canvasRef    = useRef(null);
  const phaseRef     = useRef(new Float64Array(5));
  const modeRef      = useRef(mode);
  const freqDataRef  = useRef(null);
  const lastSetRef   = useRef(0);
  const lastValidRef = useRef(0);
  const freqHistRef  = useRef([]);

  const stop = () => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    analyserRef.current = null;
    freqHistRef.current = [];
    setRunning(false);
  };

  useEffect(() => () => {
    stop();
    if (ctxRef.current) { ctxRef.current.close(); ctxRef.current = null; }
  }, []); // cleanup on unmount: stop rAF/tracks, then close ctx

  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => {
    phaseRef.current.fill(0);
    if (mode === "strobe") {
      const id = setTimeout(() => {
        if (canvasRef.current) {
          drawStrobeCanvas(canvasRef.current, phaseRef.current, new Float32Array(5), null, false);
        }
      }, 0);
      return () => clearTimeout(id);
    }
  }, [mode]);

  const start = async () => {
    setErr("");
    try {
      // Create/reuse AudioContext SYNCHRONOUSLY before any await so the gesture
      // context is preserved on Chrome for Android (suspended after await).
      if (!ctxRef.current || ctxRef.current.state === "closed") ctxRef.current = new AudioContext();
      const ctx = ctxRef.current;
      if (ctx.state === "suspended") ctx.resume();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      streamRef.current = stream;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 4096;
      analyserRef.current = analyser;
      ctx.createMediaStreamSource(stream).connect(analyser);
      bufRef.current     = new Float32Array(analyser.fftSize);
      freqDataRef.current = new Float32Array(analyser.frequencyBinCount);

      // Ensure context is running after wiring; bail if it still isn't.
      await ctx.resume();
      if (ctx.state !== "running") {
        setErr(`audio context ${ctx.state}`);
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        analyserRef.current = null;
        return;
      }

      setRunning(true);

      const loop = () => {
        analyserRef.current.getFloatTimeDomainData(bufRef.current);
        const f = autoCorrelate(bufRef.current, ctxRef.current.sampleRate);
        const now = performance.now();
        if (f > 0) {
          lastValidRef.current = now;
          const hist = freqHistRef.current;
          hist.push(f);
          if (hist.length > 8) hist.shift();
          const smoothedF = hist.reduce((a, b) => a + b, 0) / hist.length;
          const n = freqToNote(smoothedF);
          if (modeRef.current === "strobe" && canvasRef.current && freqDataRef.current) {
            analyserRef.current.getFloatFrequencyData(freqDataRef.current);
            const binWidth = ctxRef.current.sampleRate / analyserRef.current.fftSize;
            const phases = phaseRef.current;
            const amps   = new Float32Array(5);
            for (let k = 1; k <= 5; k++) {
              const targetBin = Math.round((k * smoothedF) / binWidth);
              let maxDb = -Infinity;
              for (let b = Math.max(0, targetBin - 3); b <= Math.min(freqDataRef.current.length - 1, targetBin + 3); b++) {
                if (freqDataRef.current[b] > maxDb) maxDb = freqDataRef.current[b];
              }
              amps[k - 1] = Math.max(0, Math.min(1, (maxDb + 100) / 80));
              const delta = Math.max(-(4 + k), Math.min(4 + k, n.cents * 0.06 * k));
              phases[k - 1] += (delta * Math.PI) / 180;
            }
            drawStrobeCanvas(canvasRef.current, phases, amps, n, Math.abs(n.cents) <= 5);
          }
          if (now - lastSetRef.current > 100) {
            setReading({ ...n, freq: Math.round(smoothedF * 10) / 10 });
            lastSetRef.current = now;
          }
        } else {
          if (modeRef.current === "strobe" && canvasRef.current) {
            const amps = new Float32Array(5);
            drawStrobeCanvas(canvasRef.current, phaseRef.current, amps, null, false);
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
      <button onClick={handleToggleOpen} aria-expanded={open} style={inkBtn({ color: C.inkFaint })}>
        Tuner {open ? "▾" : "▸"}
      </button>
      {open && (
        <div style={{ marginTop: "1rem", paddingTop: "0.75rem", borderTop: `1px dashed ${C.rule}` }}>
          {/* Mode toggle + start/stop row */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
            <span>
              <button
                onClick={() => setMode("chromatic")}
                aria-pressed={mode === "chromatic"}
                style={inkBtn({ color: mode === "chromatic" ? C.action : C.inkFaint, padding: "8px 6px" })}
              >
                chromatic
              </button>
              {" · "}
              <button
                onClick={() => setMode("strobe")}
                aria-pressed={mode === "strobe"}
                style={inkBtn({ color: mode === "strobe" ? C.action : C.inkFaint, padding: "8px 6px" })}
              >
                strobe
              </button>
            </span>
            <button
              onClick={running ? stop : start}
              aria-label={running ? "Stop tuner" : "Start tuner"}
              style={{
                fontFamily: F.body,
                fontStyle: "italic",
                fontSize: "0.9rem",
                padding: "8px 14px",
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
              <canvas
                ref={canvasRef}
                aria-hidden="true"
                style={{ width: "160px", height: "160px", display: "block", margin: "0.75rem auto" }}
              />
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
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} style={inkBtn({ color: C.inkFaint })}>
        Metronome {open ? "▾" : "▸"}
      </button>
      {open && (
        <div style={{ marginTop: "1rem", paddingTop: "0.75rem", borderTop: `1px dashed ${C.rule}` }}>
          {/* BPM row */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.6rem" }}>
            <button onClick={() => setBpm((v) => Math.max(30, v - 2))} aria-label="Decrease tempo" style={stepBtnStyle}>−</button>
            <span style={{ fontFamily: F.display, fontSize: "1.4rem", fontWeight: 700, color: C.ink, minWidth: "3.5rem", textAlign: "center" }}>
              {bpm}
              <span style={{ fontFamily: F.stamp, fontSize: "0.55rem", color: C.inkFaint, marginLeft: "0.3rem", letterSpacing: "0.08em", verticalAlign: "middle" }}>bpm</span>
            </span>
            <button onClick={() => setBpm((v) => Math.min(240, v + 2))} aria-label="Increase tempo" style={stepBtnStyle}>+</button>
          </div>
          {/* Tap / beats / start row */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
            <button
              onClick={handleTap}
              aria-label="Tap tempo"
              style={{ fontFamily: F.stamp, fontSize: "0.6rem", letterSpacing: "0.1em", textTransform: "uppercase", padding: "3px 10px", background: "transparent", border: `1px solid ${C.rule}`, color: C.inkMid, borderRadius: "1px", cursor: "pointer" }}
            >
              tap
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
              <button onClick={() => setBeats((v) => Math.max(2, v - 1))} aria-label="Fewer beats per bar" style={stepBtnStyle}>−</button>
              <span style={{ fontFamily: F.stamp, fontSize: "0.6rem", color: C.inkMid, letterSpacing: "0.05em", minWidth: "4.5rem", textAlign: "center" }}>
                {beats} beats/bar
              </span>
              <button onClick={() => setBeats((v) => Math.min(12, v + 1))} aria-label="More beats per bar" style={stepBtnStyle}>+</button>
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

// ── Media query hook ──────────────────────────────────────────────────────────

function useMediaQuery(q) {
  const [m, setM] = useState(() => typeof window !== "undefined" && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const h = (e) => setM(e.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, [q]);
  return m;
}

// ── Attachment hook ───────────────────────────────────────────────────────────

function useAttachment(itemId) {
  const [att, setAtt] = useState(undefined);
  const [url, setUrl] = useState(null);

  useEffect(() => {
    let alive = true;
    if (!itemId) {
      Promise.resolve().then(() => { if (alive) { setAtt(undefined); setUrl(null); } });
      return () => { alive = false; };
    }
    getAttachment(itemId).then((rec) => {
      if (!alive) return;
      setAtt(rec);
      if (rec?.blob) {
        setUrl(URL.createObjectURL(rec.blob));
      } else {
        setUrl(null);
      }
    }).catch(() => {});
    return () => { alive = false; };
  }, [itemId]);

  // Revoke URL on unmount
  useEffect(() => {
    return () => {
      setUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    };
  }, []);

  const reload = (id) => {
    const target = id ?? itemId;
    if (!target) {
      setAtt(undefined);
      setUrl(null);
      return;
    }
    getAttachment(target).then((rec) => {
      setAtt(rec);
      if (rec?.blob) {
        setUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(rec.blob); });
      } else {
        setUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
      }
    }).catch(() => {});
  };

  return { att, url, reload };
}

// ── Page shell ────────────────────────────────────────────────────────────────

function Page({ children, wide }) {
  return (
    <div style={{ minHeight: "100vh", background: C.paper, fontFamily: F.body, color: C.ink }}>
      <style>{`
        @keyframes recpulse { 0%,100%{opacity:1} 50%{opacity:0.2} }
        @keyframes syncspin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
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
        *:focus-visible { outline: 2px solid ${C.action}; outline-offset: 2px; }
        button:focus-visible, a:focus-visible, input:focus-visible, textarea:focus-visible { outline: 2px solid ${C.action}; outline-offset: 2px; }
        @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; } }
      `}</style>
      <div style={{ maxWidth: wide ? 960 : 420, margin: "0 auto", padding: "2.25rem 1.5rem 3rem" }}>
        {children}
      </div>
    </div>
  );
}

// ── Cloud sync ────────────────────────────────────────────────────────────────

function useSync(user, applyUpdates, setConflict, notify) {
  useEffect(() => {
    if (!user) return;
    (async () => {
      if (isMigrated(user.id)) {
        const updates = await pullUserData(user);
        if (updates) applyUpdates(updates);
        return;
      }
      const rows = await fetchAllRows(user);
      if (rows === null) return; // offline/unconfigured: try again next sign-in, no flag set
      const plan = migrationPlan(rows, load(KEYS.meta, {}));
      if (plan === "upload") {
        const ok = await uploadAll(user);
        if (ok) { setMigrated(user.id); notify("Your local data has been saved to your account."); }
      } else if (plan === "pull") {
        const updates = applyRows(rows);
        applyUpdates(updates);
        setMigrated(user.id);
        const n = (updates[KEYS.items] ?? []).length;
        notify(`Synced ${n} item${n === 1 ? "" : "s"} from your account.`);
      } else {
        setConflict(rows); // modal decides; flag set on choice
      }
    })();
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
}

// ── Conflict modal ────────────────────────────────────────────────────────────

function ConflictModal({ conflict, onKeepLocal, onUseCloud, onMerge }) {
  const [busy, setBusy] = useState(false);
  const firstBtnRef = useRef(null);

  useEffect(() => { firstBtnRef.current?.focus(); }, []);

  const handle = (fn) => async () => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  const borderedBtn = { background: "transparent", border: `1px solid ${C.ruleDk}`, borderRadius: "2px", padding: "0.5rem 0.75rem", width: "100%", cursor: "pointer", fontFamily: F.body, fontStyle: "italic", fontSize: "1rem", color: C.ink, opacity: busy ? 0.6 : 1 };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(28,18,9,0.45)", zIndex: 20, display: "flex", alignItems: "center", justifyContent: "center", padding: "1.5rem" }}>
      <div role="dialog" aria-modal="true" aria-labelledby="conflict-title" style={{ background: C.paper, border: `1.5px solid ${C.ruleDk}`, borderRadius: "2px", padding: "1.5rem", maxWidth: 360, width: "100%" }}>
        <p style={{ fontFamily: F.stamp, fontSize: "0.55rem", letterSpacing: "0.12em", textTransform: "uppercase", color: C.inkFaint, marginBottom: "0.5rem" }}>Account sync</p>
        <h2 id="conflict-title" style={{ fontFamily: F.display, fontSize: "1.35rem", fontWeight: 700, color: C.ink, marginBottom: "0.6rem" }}>Two journals found</h2>
        <p style={{ fontFamily: F.body, fontStyle: "italic", fontSize: "1rem", color: C.inkMid, marginBottom: "1.1rem" }}>This account already has journal data, and this device has its own. Which should win?</p>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <button
            ref={firstBtnRef}
            disabled={busy}
            onClick={handle(onMerge)}
            style={{ background: C.action, border: "none", borderRadius: "2px", padding: "0.55rem 0.75rem", width: "100%", cursor: busy ? "not-allowed" : "pointer", fontFamily: F.display, fontSize: "1rem", fontWeight: 700, color: C.paperLt, opacity: busy ? 0.6 : 1 }}
          >
            Merge (keep everything)
          </button>
          <button disabled={busy} onClick={handle(onUseCloud)} style={borderedBtn}>Use cloud data</button>
          <button disabled={busy} onClick={handle(onKeepLocal)} style={borderedBtn}>Keep this device&apos;s data</button>
        </div>
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

// ── Score (sheet music) field ─────────────────────────────────────────────────

function ScoreField({ itemId }) {
  const { att, reload } = useAttachment(itemId);
  const inputRef = useRef(null);

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!validAttachment(file)) {
      window.alert("Use a PDF, PNG, or JPG up to 15 MB.");
      e.target.value = "";
      return;
    }
    saveAttachment({ itemId, name: file.name, type: file.type, blob: file, date: new Date().toISOString() })
      .then(() => reload(itemId));
    e.target.value = "";
  };

  const handleRemove = () => {
    deleteAttachment(itemId).then(() => reload(itemId));
  };

  return (
    <div style={{ marginBottom: "0.75rem" }}>
      <p style={{ fontFamily: F.stamp, fontSize: "0.55rem", letterSpacing: "0.12em", textTransform: "uppercase", color: C.inkFaint, marginBottom: "0.2rem" }}>Sheet music</p>
      <input
        type="file"
        accept="application/pdf,image/png,image/jpeg"
        ref={inputRef}
        aria-hidden="true"
        tabIndex={-1}
        style={{ display: "none" }}
        onChange={handleFile}
      />
      {att ? (
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <span style={{ fontFamily: F.body, fontStyle: "italic", fontSize: "0.95rem", color: C.inkMid }}>{att.name}</span>
          <button onClick={() => inputRef.current?.click()} style={inkBtn({ color: C.inkMid })}>replace</button>
          <button onClick={handleRemove} style={inkBtn({ color: C.fail })}>remove</button>
        </div>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          style={{ fontFamily: F.body, fontStyle: "italic", fontSize: "0.95rem", padding: "3px 10px", background: "transparent", border: `1px solid ${C.rule}`, color: C.inkFaint, borderRadius: "1px", cursor: "pointer" }}
        >
          Attach PDF or image…
        </button>
      )}
    </div>
  );
}

// ── Mobile score (sheet music) collapsible ────────────────────────────────────

function MobileScoreSection({ score, scoreUrl }) {
  const [open, setOpen] = useState(false);
  if (!score || !scoreUrl) return null;
  return (
    <div style={{ marginTop: "1rem" }}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} style={inkBtn({ color: C.inkFaint })}>
        Sheet music {open ? "▾" : "▸"}
      </button>
      {open && (
        <div style={{ marginTop: "1rem", paddingTop: "0.75rem", borderTop: `1px dashed ${C.rule}` }}>
          {score.type === "application/pdf"
            ? <iframe src={scoreUrl} title="Sheet music" style={{ width: "100%", height: "60vh", border: `1px solid ${C.rule}`, borderRadius: "1px", background: C.paperLt }} />
            : <img src={scoreUrl} alt="Sheet music" style={{ width: "100%", maxHeight: "60vh", objectFit: "contain", border: `1px solid ${C.rule}`, borderRadius: "1px" }} />
          }
        </div>
      )}
    </div>
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
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} style={inkBtn({ color: C.inkFaint })}>
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

// ── DPO sortable row ──────────────────────────────────────────────────────────
// Must be a module-level component so useSortable hook is not called inside .map()

function DPORow({ row, index, items, cards, updateRow, removeRow }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: row.rowId });

  const it = row.type === "repertoire" ? items.find((x) => x.id === row.itemId) : null;
  const rowCard = row.type === "repertoire" ? cards.find((c) => c.id === row.itemId) : null;

  const cellStyle = { fontFamily: F.body, fontSize: "0.9rem", color: C.ink, verticalAlign: "top", padding: "0.4rem 0.3rem" };
  const inputStyle = { fontFamily: F.body, fontSize: "0.9rem", color: C.ink, background: "transparent", border: "none", borderBottom: `1px solid ${C.rule}`, outline: "none", width: "100%", padding: "1px 0" };
  const numInputStyle = { ...inputStyle, width: "3rem", textAlign: "center" };

  return (
    <tr
      ref={setNodeRef}
      style={{
        borderBottom: `1px solid ${C.rule}`,
        opacity: isDragging ? 0.4 : 1,
        transform: CSS.Transform.toString(transform),
        transition,
      }}
    >
      <td
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        style={{ ...cellStyle, cursor: "grab", color: C.inkFaint, fontSize: "1.1rem", userSelect: "none", touchAction: "none", textAlign: "center", width: "1.5rem" }}
      >⠿</td>
      <td style={{ ...cellStyle, color: C.inkFaint, textAlign: "center", fontSize: "0.8rem" }}>{index + 1}</td>
      <td style={cellStyle}>
        {row.type === "segment" ? (
          <span style={{ fontFamily: F.stamp, fontSize: "0.62rem", letterSpacing: "0.1em", textTransform: "uppercase", color: C.inkFaint, border: `1px solid ${C.rule}`, padding: "1px 5px", borderRadius: "1px" }}>{row.segmentType}</span>
        ) : it ? (
          <div>
            <span style={{ fontSize: "0.75rem", color: C.inkFaint, fontFamily: F.stamp }}>{it.composer}</span>
            <br />
            <span style={{ fontStyle: "italic" }}>{it.title}</span>
            {rowCard && <span style={{ marginLeft: "0.4rem" }}><Badge bucket={rowCard.bucket} /></span>}
          </div>
        ) : (
          <span style={{ color: C.inkFaint, fontStyle: "italic" }}>unknown item</span>
        )}
      </td>
      <td style={{ ...cellStyle, textAlign: "center" }}>
        <input
          type="number" min={1} max={120}
          value={row.minutes}
          aria-label="Minutes for this item"
          onChange={(e) => updateRow(row.rowId, { minutes: Math.max(1, parseInt(e.target.value, 10) || 1) })}
          style={numInputStyle}
        />
      </td>
      <td style={cellStyle}>
        <input
          type="text"
          placeholder="today's goal…"
          value={row.strategy}
          onChange={(e) => updateRow(row.rowId, { strategy: e.target.value })}
          style={inputStyle}
        />
      </td>
      <td style={{ ...cellStyle, textAlign: "right" }}>
        <button onClick={() => removeRow(row.rowId)} aria-label="Remove row" style={{ background: "none", border: "none", cursor: "pointer", color: C.inkFaint, fontSize: "0.85rem", padding: "0 2px" }}>×</button>
      </td>
    </tr>
  );
}

const SAFE_VIEWS = ["dash", "repertoire", "settings", "history", "plan"]; // views safe to restore from history state

export default function App() {
  useFonts();
  const { user, signIn, signOut } = useAuth();
  const isDesktop = useMediaQuery("(min-width: 768px)");

  const [items,         setItems]         = useState(() => load(KEYS.items,   DEFAULT_EXCERPTS));
  const [cards,         setCards]         = useState(() => syncCards(load(KEYS.items, DEFAULT_EXCERPTS), load(KEYS.cards, [])));
  const [context,       setContext]       = useState(() => load(KEYS.context, ""));
  const [settings,      setSettings]      = useState(() => load(KEYS.settings, DEFAULT_SETTINGS));
  const pomo = usePomodoro(settings);
  const [sessions,      setSessions]      = useState(() => load(KEYS.sessions, []));
  const [badges,        setBadges]        = useState(() => load(KEYS.badges, {}));
  const [plans,         setPlans]         = useState(() => load(KEYS.plans, []));
  const [toast,         setToast]         = useState(null);
  const [conflict,      setConflict]      = useState(null);
  const [view,          setView]          = useState("dash");
  const [queue,         setQueue]         = useState([]);
  const [idx,           setIdx]           = useState(0);
  const [scores,        setScores]        = useState({});
  const [result,        setResult]        = useState(null);
  const [sessionLength, setSessionLength] = useState(4);
  const [tagFilter,     setTagFilter]     = useState(null);
  const [sessionNote,   setSessionNote]   = useState("");
  const [berries,       setBerries]       = useState({});
  const [draftPlan,     setDraftPlan]     = useState(null);
  const [pendingResume, setPendingResume] = useState(() => load(KEYS.active, null));
  const [syncStatus,    setSyncStatus]    = useState("idle");

  // ── SPA back-navigation (fix #41) ────────────────────────────────────────
  const popNavRef  = useRef(false);
  const lastViewRef = useRef(view);
  // Push a history entry on every view change (except changes triggered by popstate).
  useEffect(() => {
    if (lastViewRef.current === view) return;
    lastViewRef.current = view;
    if (popNavRef.current) { popNavRef.current = false; return; }
    window.history.pushState({ pjView: view }, "");
  }, [view]);
  // Seed the initial history entry and handle popstate.
  useEffect(() => {
    window.history.replaceState({ pjView: "dash" }, "");
    const onPop = (e) => {
      const v = e.state?.pjView;
      popNavRef.current = true;
      setView(SAFE_VIEWS.includes(v) ? v : "dash");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Import file input ref
  const importRef = useRef(null);

  // Dashboard piece selection (inline detail expand)
  const [selectedPieceId, setSelectedPieceId] = useState(null);

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

  const applyUpdates = useCallback((updates) => {
    if (updates[KEYS.items] !== undefined) {
      serverDataRef.current[KEYS.items] = updates[KEYS.items];
      setItems(updates[KEYS.items]);
    }
    if (updates[KEYS.cards] !== undefined) {
      const effectiveItems = updates[KEYS.items] ?? load(KEYS.items, DEFAULT_EXCERPTS);
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
    if (updates[KEYS.plans] !== undefined) {
      serverDataRef.current[KEYS.plans] = updates[KEYS.plans];
      setPlans(updates[KEYS.plans]);
    }
  }, []);

  const notify = useCallback((message) => setToast({ kind: "info", label: message }), []);

  useSync(user, applyUpdates, setConflict, notify);

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
  useEffect(() => {
    save(KEYS.plans, plans);
    if (!isMounted.current) return;
    if (plans === serverDataRef.current[KEYS.plans]) { delete serverDataRef.current[KEYS.plans]; return; }
    stampAndUpsert(KEYS.plans, plans, userRef.current);
  }, [plans]);
  useEffect(() => { isMounted.current = true; }, []);

  // ── Sync status listener ──────────────────────────────────────────────────

  useEffect(() => {
    onSyncStatus(setSyncStatus);
    return () => onSyncStatus(null);
  }, []);

  // ── Offline queue flush (on sign-in and reconnect) ────────────────────────

  useEffect(() => {
    if (user) flushQueue(user);
    const h = () => { if (userRef.current) flushQueue(userRef.current); };
    window.addEventListener("online", h);
    return () => window.removeEventListener("online", h);
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
      setToast({ kind: "badge", label: BADGES.find((b) => b.id === newIds[0]).label });
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

  // Unconditional top-level hooks (rules of hooks: no conditionals)
  const { att: score, url: scoreUrl } = useAttachment(item?.id);

  // ── Session ───────────────────────────────────────────────────────────────

  const startSession = () => {
    const dueItems = buildQueue(cards, items, tagFilter, sessionLength);
    const rows = dueItems.map((card) => ({
      rowId: newId(),
      type: "repertoire",
      itemId: card.id,
      minutes: 10,
      strategy: "",
    }));
    setDraftPlan({
      id: newId(),
      date: new Date().toISOString(),
      totalMinutes: 60,
      rows,
    });
    setIdx(0); setScores({}); setBerries({}); setResult(null);
    setView("plan");
  };

  const beginFromPlan = (plan) => {
    const repertoireRows = plan.rows.filter((r) => r.type === "repertoire");
    const orderedQueue = repertoireRows
      .map((r) => cards.find((c) => c.id === r.itemId))
      .filter(Boolean);
    setQueue(orderedQueue);
    setIdx(0); setScores({}); setBerries({}); setResult(null);
    const savedPlan = { ...plan, date: new Date().toISOString() };
    setPlans((prev) => [...prev.filter((p) => p.id !== savedPlan.id), savedPlan]);
    setDraftPlan(savedPlan);
    setView("assess");
  };

  const toggleScore = (id, val) => {
    setScores((p) => ({ ...p, [id]: p[id] === val ? undefined : val }));
    if (val === true) setBerries((p) => ({ ...p, [id]: [] }));
  };

  const toggleBerry = (criterionId, berry) =>
    setBerries((p) => {
      const cur = p[criterionId] ?? [];
      return { ...p, [criterionId]: cur.includes(berry) ? cur.filter((b) => b !== berry) : [...cur, berry] };
    });

  const allRated = criteria.every((c) => scores[c.id] !== undefined);

  const submit = () => {
    const ups    = criteria.filter((c) => scores[c.id] === true).length;
    const nb     = advanceBucket(card.bucket, ups, criteria.length);
    const failed = criteria.filter((c) => scores[c.id] === false).map((c) => c.label);
    const failedBerries = Object.fromEntries(
      criteria
        .filter((c) => scores[c.id] === false && (berries[c.id] ?? []).length > 0)
        .map((c) => [c.id, berries[c.id]])
    );
    setCards((prev) => prev.map((c) => c.id !== card.id ? c : {
      ...c, bucket: nb, sessionsUntilDue: bucketSessions(nb, settings),
      history: [...c.history, {
        date: new Date().toISOString(), scores: { ...scores }, ups, bucket: nb,
        total: criteria.length, berries: Object.keys(failedBerries).length ? failedBerries : undefined,
      }],
    }));
    setResult({ item, oldBucket: card.bucket, newBucket: nb, ups, failed, total: criteria.length, berries: failedBerries });
    setBerries({});
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
      setIdx((i) => i + 1); setScores({}); setBerries({}); setView("assess");
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
    setCards((prev) => [...prev, { id, bucket: "c", sessionsUntilDue: 0, history: [] }]);
    setNewDraft(emptyDraft()); setShowAdd(false);
  };

  // ── Daily Practice Organizer (DPO) ────────────────────────────────────────

  if (view === "plan" && draftPlan) {
    const plan = draftPlan;
    const setPlan = setDraftPlan;

    const totalMins = plan.totalMinutes || 0;
    const practiceMins = Math.round(totalMins * 0.8);
    const allocatedMins = plan.rows.reduce((s, r) => s + (Number(r.minutes) || 0), 0);
    const overBudget = allocatedMins > practiceMins;

    const updateRow = (rowId, patch) =>
      setPlan((p) => ({ ...p, rows: p.rows.map((r) => r.rowId === rowId ? { ...r, ...patch } : r) }));
    const removeRow = (rowId) =>
      setPlan((p) => ({ ...p, rows: p.rows.filter((r) => r.rowId !== rowId) }));
    const handleDragEnd = ({ active, over }) => {
      if (!over || active.id === over.id) return;
      setPlan((p) => {
        const fi = p.rows.findIndex((r) => r.rowId === active.id);
        const ti = p.rows.findIndex((r) => r.rowId === over.id);
        return { ...p, rows: arrayMove(p.rows, fi, ti) };
      });
    };
    const addSegment = (segType) =>
      setPlan((p) => ({
        ...p,
        rows: [...p.rows, { rowId: newId(), type: "segment", segmentType: segType, minutes: 10, strategy: "" }],
      }));
    const addRepertoireItem = (itemId) =>
      setPlan((p) => ({
        ...p,
        rows: [...p.rows, { rowId: newId(), type: "repertoire", itemId, minutes: 10, strategy: "" }],
      }));

    const itemsInPlan = new Set(plan.rows.filter((r) => r.type === "repertoire").map((r) => r.itemId));
    const addableItems = items.filter((it) => !itemsInPlan.has(it.id));

    const cellStyle = { fontFamily: F.body, fontSize: "0.9rem", color: C.ink, verticalAlign: "top", padding: "0.4rem 0.3rem" };
    const inputStyle = { fontFamily: F.body, fontSize: "0.9rem", color: C.ink, background: "transparent", border: "none", borderBottom: `1px solid ${C.rule}`, outline: "none", width: "100%", padding: "1px 0" };
    const numInputStyle = { ...inputStyle, width: "3rem", textAlign: "center" };

    return (
      <Page>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.4rem" }}>
          <button onClick={() => setView("dash")} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: F.body, fontStyle: "italic", fontSize: "0.95rem", color: C.inkFaint, padding: 0 }}>← Journal</button>
          <p style={{ fontFamily: F.stamp, fontSize: "0.6rem", letterSpacing: "0.14em", textTransform: "uppercase", color: C.inkFaint }}>Daily Practice Organizer</p>
        </div>

        <Rule thick />

        <div style={{ display: "flex", gap: "1rem", alignItems: "baseline", marginBottom: "0.5rem" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "0.3rem" }}>
            <span style={{ fontFamily: F.stamp, fontSize: "0.6rem", letterSpacing: "0.1em", textTransform: "uppercase", color: C.inkFaint }}>Total time</span>
            <input
              type="number" min={1} max={480}
              value={totalMins}
              aria-label="Total time available in minutes"
              onChange={(e) => setPlan((p) => ({ ...p, totalMinutes: Math.max(1, parseInt(e.target.value, 10) || 1) }))}
              style={{ ...numInputStyle, width: "3.5rem" }}
            />
            <span style={{ fontFamily: F.stamp, fontSize: "0.58rem", color: C.inkFaint }}>min</span>
          </div>
          <div style={{ fontStyle: "italic", fontSize: "0.9rem", color: C.inkMid }}>
            Practice time (−20%): <strong style={{ color: C.ink }}>{practiceMins} min</strong>
          </div>
        </div>

        <Rule />

        <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={plan.rows.map((r) => r.rowId)} strategy={verticalListSortingStrategy}>
            <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "0.75rem" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.ruleDk}` }}>
                  <th style={{ ...cellStyle, width: "1.5rem" }} />
                  <th style={{ ...cellStyle, width: "1.5rem", color: C.inkFaint, fontFamily: F.stamp, fontSize: "0.55rem", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: "normal" }}>#</th>
                  <th style={{ ...cellStyle, color: C.inkFaint, fontFamily: F.stamp, fontSize: "0.55rem", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: "normal" }}>Item</th>
                  <th style={{ ...cellStyle, width: "3.5rem", color: C.inkFaint, fontFamily: F.stamp, fontSize: "0.55rem", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: "normal", textAlign: "center" }}>Min</th>
                  <th style={{ ...cellStyle, color: C.inkFaint, fontFamily: F.stamp, fontSize: "0.55rem", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: "normal" }}>Strategy / Goal</th>
                  <th style={{ ...cellStyle, width: "2rem" }}></th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((row, i) => (
                  <DPORow
                    key={row.rowId}
                    row={row}
                    index={i}
                    items={items}
                    cards={cards}
                    updateRow={updateRow}
                    removeRow={removeRow}
                  />
                ))}
              </tbody>
            </table>
          </SortableContext>
        </DndContext>

        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
          {SEGMENT_TYPES.map((seg) => (
            <button key={seg} onClick={() => addSegment(seg)} style={{ fontFamily: F.stamp, fontSize: "0.6rem", letterSpacing: "0.1em", textTransform: "uppercase", background: "transparent", border: `1px solid ${C.rule}`, borderRadius: "1px", padding: "2px 7px", cursor: "pointer", color: C.inkMid }}>+ {seg}</button>
          ))}
          {addableItems.length > 0 && (
            <select
              value=""
              aria-label="Add repertoire piece"
              onChange={(e) => { if (e.target.value) addRepertoireItem(e.target.value); }}
              style={{ fontFamily: F.stamp, fontSize: "0.6rem", letterSpacing: "0.1em", background: "transparent", border: `1px solid ${C.rule}`, borderRadius: "1px", padding: "2px 5px", color: C.inkMid, cursor: "pointer" }}
            >
              <option value="">+ Piece…</option>
              {addableItems.map((it) => (
                <option key={it.id} value={it.id}>{it.composer} — {it.title}</option>
              ))}
            </select>
          )}
        </div>

        <Rule />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <span style={{ fontFamily: F.stamp, fontSize: "0.6rem", letterSpacing: "0.1em", color: overBudget ? C.fail : C.inkFaint }}>
            {allocatedMins} / {practiceMins} min allocated{overBudget ? " — over budget" : ""}
          </span>
          <button
            onClick={() => beginFromPlan(plan)}
            disabled={plan.rows.filter((r) => r.type === "repertoire").length === 0}
            style={{ fontFamily: F.display, fontSize: "1rem", padding: "0.65rem 1.2rem", background: plan.rows.filter((r) => r.type === "repertoire").length > 0 ? C.action : "transparent", color: plan.rows.filter((r) => r.type === "repertoire").length > 0 ? C.paperLt : C.inkFaint, border: `1px solid ${plan.rows.filter((r) => r.type === "repertoire").length > 0 ? C.action : C.rule}`, borderRadius: "1px", cursor: plan.rows.filter((r) => r.type === "repertoire").length > 0 ? "pointer" : "not-allowed" }}
          >Begin session →</button>
        </div>
      </Page>
    );
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────

  if (view === "dash") return (
    <Page>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.4rem" }}>
        <p style={{ fontFamily: F.stamp, fontSize: "0.6rem", letterSpacing: "0.16em", textTransform: "uppercase", color: C.inkFaint, margin: 0 }}>
          Practice Journal
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          {syncStatus === "syncing" && (
            <span title="Syncing…" style={{ fontFamily: F.stamp, fontSize: "0.75rem", color: C.inkFaint, display: "inline-block", animation: "syncspin 1.2s linear infinite", lineHeight: 1 }}>↻</span>
          )}
          {syncStatus === "error" && (
            <button onClick={() => user && flushQueue(user)} aria-label="Retry sync" title="Sync failed — click to retry" style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}>
              <span aria-hidden="true" style={{ fontFamily: F.stamp, fontSize: "0.75rem", color: C.warm, lineHeight: 1 }}>⚠</span>
            </button>
          )}
          <AccountButton user={user} signIn={signIn} signOut={signOut} />
        </div>
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
                    <span style={{ color: C.hot }}>{stats.buckets.c}</span>
                    {" · "}
                    <span style={{ color: C.warm }}>{stats.buckets.b}</span>
                    {" · "}
                    <span style={{ color: C.cold }}>{stats.buckets.a}</span>
                  </span>
                ),
                label: "categories",
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
                  aria-pressed={tagFilter === tag}
                  style={{
                    fontFamily: F.stamp, fontSize: "0.58rem", textTransform: "uppercase",
                    letterSpacing: "0.1em", padding: "6px 12px", borderRadius: "1px",
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
        const it      = items.find((e) => e.id === c.id);
        if (!it) return null;
        const due     = isDue(c);
        const pinned  = isCardPinned(c, items);
        const open    = selectedPieceId === c.id;
        const tags    = itemTags(it);
        return (
          <div key={c.id}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => setSelectedPieceId(open ? null : c.id)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedPieceId(open ? null : c.id); } }}
              aria-expanded={open}
              style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", padding: "0.85rem 0", opacity: due || pinned ? 1 : 0.5, cursor: "pointer" }}
            >
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
            {open && (
              <div style={{ paddingBottom: "0.85rem" }}>
                {it.notes && (
                  <p style={{ fontSize: "0.85rem", color: C.inkMid, marginBottom: "0.5rem" }}>{it.notes}</p>
                )}
                {tags.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginBottom: "0.6rem" }}>
                    {tags.map((tag) => (
                      <span key={tag} style={{ fontFamily: F.stamp, fontSize: "0.58rem", textTransform: "uppercase", letterSpacing: "0.1em", padding: "2px 8px", borderRadius: "1px", border: `1px solid ${C.ruleDk}`, color: C.inkMid }}>
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); startEdit(it); setView("repertoire"); }}
                  style={inkBtn({ color: C.action, padding: "8px 0" })}
                >
                  Edit →
                </button>
              </div>
            )}
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
        <button onClick={() => { if (window.confirm("Reset all cards to Hot?")) setCards(syncCards(items, [])); }} style={inkBtn({ color: C.inkFaint, padding: "8px 4px" })}>
          Reset all cards
        </button>
        <button onClick={() => setView("settings")} style={inkBtn({ color: C.inkFaint, padding: "8px 4px" })}>
          Settings
        </button>
        <button onClick={() => setView("history")} style={inkBtn({ color: C.inkFaint, padding: "8px 4px" })}>
          History
        </button>
      </div>

      {toast && (
        <div role="status" aria-live="polite" style={{ position: "fixed", bottom: "1.5rem", left: "50%", transform: "translateX(-50%)", background: C.paperLt, border: `1.5px solid ${C.action}`, borderRadius: "2px", padding: "0.6rem 1.1rem", boxShadow: "0 2px 12px rgba(28,18,9,0.18)", zIndex: 10 }}>
          <p style={{ fontFamily: F.stamp, fontSize: "0.55rem", letterSpacing: "0.12em", textTransform: "uppercase", color: C.inkFaint, marginBottom: "0.2rem" }}>{toast.kind === "badge" ? "Badge earned" : "Account"}</p>
          <p style={{ fontFamily: F.display, fontSize: "1.05rem", fontWeight: 700, color: C.action }}>{toast.label}</p>
        </div>
      )}

      {conflict && (
        <ConflictModal
          conflict={conflict}
          onKeepLocal={async () => {
            await uploadAll(user);
            setMigrated(user.id);
            setConflict(null);
          }}
          onUseCloud={() => {
            const updates = applyRows(conflict);
            applyUpdates(updates);
            setMigrated(user.id);
            setConflict(null);
          }}
          onMerge={() => {
            const serverByKey = Object.fromEntries(conflict.map((r) => [r.key, r.value]));
            const mergedItems = mergeById(serverByKey[KEYS.items], load(KEYS.items, []));
            const mergedCards = syncCards(mergedItems, mergeById(serverByKey[KEYS.cards], load(KEYS.cards, [])));
            const seen = new Set();
            const mergedSessions = [...(serverByKey[KEYS.sessions] ?? []), ...load(KEYS.sessions, [])].filter((s) => !seen.has(s.date) && seen.add(s.date));
            const mergedBadges = { ...load(KEYS.badges, {}), ...(serverByKey[KEYS.badges] ?? {}) };
            const mergedContext = serverByKey[KEYS.context] !== undefined ? serverByKey[KEYS.context] : load(KEYS.context, "");
            const mergedSettings = serverByKey[KEYS.settings] !== undefined ? serverByKey[KEYS.settings] : load(KEYS.settings, DEFAULT_SETTINGS);
            setItems(mergedItems);
            setCards(mergedCards);
            setSessions(mergedSessions);
            setBadges(mergedBadges);
            setContext(mergedContext);
            setSettings(mergedSettings);
            setMigrated(user.id);
            setConflict(null);
          }}
        />
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
                aria-label={`${b.charAt(0).toUpperCase() + b.slice(1)} interval`}
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
                ariaLabel={`Criterion ${i + 1} label`}
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
              aria-label={`Remove criterion ${i + 1}`}
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
        { key: "work",  label: "Work",  ariaLabel: "Work minutes"  },
        { key: "break", label: "Break", ariaLabel: "Break minutes" },
      ].map(({ key, label, ariaLabel }, i) => (
        <div key={key}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.65rem 0" }}>
            <span style={{ fontFamily: F.stamp, fontSize: "0.6rem", letterSpacing: "0.12em", textTransform: "uppercase", color: C.inkFaint }}>{label}</span>
            <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
              <input
                type="number" min={1} max={120}
                value={pomodoroMinutes(settings, key)}
                aria-label={ariaLabel}
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

      <RecordingsSettings settings={settings} setSettings={setSettings} user={user} />

      <Rule thick />

      <p style={{ fontFamily: F.stamp, fontSize: "0.6rem", letterSpacing: "0.15em", textTransform: "uppercase", color: C.inkFaint, marginBottom: "0.3rem" }}>Backup</p>
      <p style={{ fontStyle: "italic", fontSize: "0.95rem", color: C.inkMid, marginBottom: "0.75rem" }}>Download all journal data as JSON, or restore from a backup file.</p>

      <input
        type="file"
        accept="application/json,.json"
        ref={importRef}
        aria-hidden="true"
        tabIndex={-1}
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
                  <span> · {transitions.map((b) => { const k = {hot:"c",warm:"b",cold:"a"}[b] ?? b; return BUCKET[k]?.label ?? b; }).join(" → ")}</span>
                )}
              </p>
              <RecordingList itemId={it.id} user={user} />
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
                    aria-label="Notes"
                    style={{ fontFamily: F.body, fontSize: "0.95rem", color: C.ink, background: "transparent", border: `1px solid ${C.rule}`, outline: "none", width: "100%", padding: "6px 8px", borderRadius: "1px", resize: "vertical", minHeight: "3.5rem" }}
                  />
                </div>
                <div style={{ marginBottom: "0.75rem" }}>
                  <p style={{ fontFamily: F.stamp, fontSize: "0.55rem", letterSpacing: "0.12em", textTransform: "uppercase", color: C.inkFaint, marginBottom: "0.2rem" }}>Tags</p>
                  <JournalInput value={editDraft.tags} onChange={(v) => setEditDraft((d) => ({ ...d, tags: v }))} placeholder="audition, etudes, … (comma-separated)" />
                </div>
                <ScoreField itemId={it.id} />
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
                    aria-label={it.pinned ? "Unpin item" : "Pin item"}
                    aria-pressed={!!it.pinned}
                    style={inkBtn({ color: it.pinned ? C.action : C.inkFaint })}
                  >
                    {it.pinned ? "pinned" : "pin"}
                  </button>
                  <button onClick={() => startEdit(it)} aria-label={`Edit ${it.composer} ${it.title}`} style={inkBtn({ color: C.inkFaint })}>edit</button>
                  <button onClick={() => deleteItem(it.id)} aria-label={`Delete ${it.composer} ${it.title}`} style={inkBtn({ color: C.fail, letterSpacing: 0, fontSize: "0.85rem" })}>×</button>
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
                aria-label="Notes"
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

  if (view === "assess" && item) {
    const scoreViewer = score && scoreUrl ? (
      score.type === "application/pdf"
        ? <iframe src={scoreUrl} title="Sheet music" style={{ width: "100%", height: "82vh", border: `1px solid ${C.rule}`, borderRadius: "1px", background: C.paperLt }} />
        : <img src={scoreUrl} alt="Sheet music" style={{ width: "100%", border: `1px solid ${C.rule}`, borderRadius: "1px" }} />
    ) : null;

    const mobileScoreSection = score && !isDesktop ? (
      <MobileScoreSection score={score} scoreUrl={scoreUrl} />
    ) : null;

    const assessInner = (
      <>
        <PomodoroChip pomo={pomo} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "1.25rem" }}>
          <button onClick={() => { clearActive(); setView("dash"); }} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: F.body, fontStyle: "italic", fontSize: "0.95rem", color: C.inkFaint, padding: 0 }}>← Journal</button>
          <span style={{ fontFamily: F.stamp, fontSize: "0.6rem", color: C.inkFaint, letterSpacing: "0.08em" }}>{idx + 1} of {queue.length}</span>
        </div>

        <div aria-hidden="true" style={{ display: "flex", gap: "4px", marginBottom: "1.5rem" }}>
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

        {(() => {
          const planRow = draftPlan?.rows?.find((r) => r.type === "repertoire" && r.itemId === item.id);
          return planRow?.strategy?.trim() ? (
            <div style={{ marginTop: "0.6rem", paddingLeft: "0.75rem", borderLeft: `2px solid ${C.action}` }}>
              <p style={{ fontFamily: F.stamp, fontSize: "0.55rem", letterSpacing: "0.12em", textTransform: "uppercase", color: C.inkFaint, marginBottom: "0.2rem" }}>Today's goal</p>
              <p style={{ fontStyle: "italic", fontFamily: F.body, fontSize: "0.95rem", color: C.inkMid }}>{planRow.strategy}</p>
            </div>
          ) : null;
        })()}

        {item.notes && (
          <div style={{ marginTop: "0.6rem", paddingLeft: "0.75rem", borderLeft: `2px solid ${C.rule}` }}>
            <p style={{ fontFamily: F.stamp, fontSize: "0.55rem", letterSpacing: "0.12em", textTransform: "uppercase", color: C.inkFaint, marginBottom: "0.2rem" }}>Notes</p>
            <p style={{ fontStyle: "italic", fontFamily: F.body, fontSize: "0.95rem", color: C.inkMid, whiteSpace: "pre-wrap" }}>{item.notes}</p>
          </div>
        )}

        <Rule thick />
        <p style={{ fontStyle: "italic", fontSize: "0.95rem", color: C.inkMid, marginBottom: "1rem" }}>Play through once, then mark each criterion:</p>

        <div style={{ marginBottom: "1.5rem" }}>
          {criteria.map((c, i) => {
            const failed = scores[c.id] === false;
            const berryList = BERRIES[c.id] ?? [];
            const selectedBerries = berries[c.id] ?? [];
            return (
              <div key={c.id}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.65rem 0" }}>
                  <span style={{ fontSize: "1.1rem", color: C.ink }}>{c.label}</span>
                  <div style={{ display: "flex", gap: "0.4rem" }}>
                    <MarkButton active={scores[c.id] === true}  variant="pass" label={c.label} onClick={() => toggleScore(c.id, true)}>✓</MarkButton>
                    <MarkButton active={scores[c.id] === false} variant="fail" label={c.label} onClick={() => toggleScore(c.id, false)}>✗</MarkButton>
                  </div>
                </div>
                {failed && berryList.length > 0 && (
                  <div style={{ paddingBottom: "0.5rem", paddingLeft: "0.25rem" }}>
                    <p style={{ fontFamily: F.stamp, fontSize: "0.52rem", letterSpacing: "0.1em", textTransform: "uppercase", color: C.inkFaint, marginBottom: "0.3rem" }}>Specify weakness (optional):</p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
                      {berryList.map((berry) => (
                        <button
                          key={berry}
                          onClick={() => toggleBerry(c.id, berry)}
                          aria-pressed={selectedBerries.includes(berry)}
                          style={{ fontFamily: F.stamp, fontSize: "0.58rem", letterSpacing: "0.08em", background: selectedBerries.includes(berry) ? C.action : "transparent", color: selectedBerries.includes(berry) ? C.paperLt : C.inkMid, border: `1px solid ${selectedBerries.includes(berry) ? C.action : C.rule}`, borderRadius: "1px", padding: "2px 7px", cursor: "pointer" }}
                        >{berry}</button>
                      ))}
                    </div>
                  </div>
                )}
                {i < criteria.length - 1 && <div style={{ borderTop: `1px solid ${C.rule}` }} />}
              </div>
            );
          })}
        </div>

        <button onClick={submit} disabled={!allRated} style={{ width: "100%", fontFamily: F.display, fontSize: "1rem", padding: "0.75rem", background: allRated ? C.action : "transparent", color: allRated ? C.paperLt : C.inkFaint, border: `1px solid ${allRated ? C.action : C.rule}`, borderRadius: "1px", cursor: allRated ? "pointer" : "not-allowed" }}>
          {allRated ? "Record assessment" : `Mark all criteria · ${Object.values(scores).filter((v) => v !== undefined).length} / ${criteria.length}`}
        </button>

        {mobileScoreSection}
        <PomodoroControls pomo={pomo} />
        <Tuner />
        <Metronome />
        <Recorder itemId={item.id} limit={recordingLimit(settings)} cloudOn={cloudEnabled(settings, user)} user={user} />
      </>
    );

    if (isDesktop && score) {
      return (
        <Page wide>
          <div style={{ display: "flex", gap: "2rem", alignItems: "flex-start" }}>
            <div style={{ flex: "0 0 380px", minWidth: 0 }}>
              {assessInner}
            </div>
            <div style={{ flex: 1, minWidth: 0, position: "sticky", top: "1rem" }}>
              {scoreViewer}
            </div>
          </div>
        </Page>
      );
    }

    return <Page>{assessInner}</Page>;
  }

  // ── Result ────────────────────────────────────────────────────────────────

  if (view === "result" && result) {
    const { item, oldBucket, newBucket, ups, failed, total = 4, berries: resultBerries = {} } = result;
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
              {failed.map((f) => {
                const criterionId = criteria.find((c) => c.label === f)?.id;
                const selectedBerries = criterionId ? (resultBerries[criterionId] ?? []) : [];
                return (
                  <div key={f} style={{ marginBottom: "0.5rem" }}>
                    <p style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "1.05rem", color: C.fail }}>
                      <span style={{ fontFamily: F.display, fontWeight: 700, fontSize: "0.9rem" }}>✗</span>{f}
                    </p>
                    {selectedBerries.length > 0 && (
                      <p style={{ fontFamily: F.stamp, fontSize: "0.62rem", color: C.inkMid, paddingLeft: "1.5rem", letterSpacing: "0.05em" }}>
                        {selectedBerries.join(" · ")}
                      </p>
                    )}
                  </div>
                );
              })}
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
          aria-label="Session note"
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
