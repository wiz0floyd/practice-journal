import { keepNewest } from "./sr.js";

const DB_NAME = "pj_recordings_v1", STORE = "recordings";

function openDB() {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("indexedDB unavailable"));
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      const store = db.createObjectStore(STORE, { keyPath: "id" });
      store.createIndex("itemId", "itemId", { unique: false });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const tx = (db, mode) => db.transaction(STORE, mode).objectStore(STORE);

export async function listRecordings(itemId) {
  if (typeof indexedDB === "undefined") return [];
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, "readonly").index("itemId").getAll(itemId);
    req.onsuccess = () => resolve((req.result ?? []).sort((a, b) => new Date(b.date) - new Date(a.date)));
    req.onerror = () => reject(req.error);
  });
}

export async function saveRecording(rec, limit) {
  if (typeof indexedDB === "undefined") return;
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const req = tx(db, "readwrite").put(rec);
    req.onsuccess = resolve;
    req.onerror = () => reject(req.error);
  });
  const all = await listRecordings(rec.itemId);
  const keep = new Set(keepNewest(all, limit).map((r) => r.id));
  await Promise.all(all.filter((r) => !keep.has(r.id)).map((r) => deleteRecording(r.id)));
}

export async function deleteRecording(id) {
  if (typeof indexedDB === "undefined") return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, "readwrite").delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function recordingUsage() {
  if (typeof indexedDB === "undefined") return null;
  try {
    const est = await navigator.storage?.estimate?.();
    return est?.usage ?? null;
  } catch {
    return null;
  }
}
