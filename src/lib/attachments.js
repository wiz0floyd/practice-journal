const DB_NAME = "pj_attachments_v1", STORE = "attachments";

function openDB() {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("indexedDB unavailable"));
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: "itemId" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const tx = (db, mode) => db.transaction(STORE, mode).objectStore(STORE);

export async function getAttachment(itemId) {
  if (typeof indexedDB === "undefined") return undefined;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, "readonly").get(itemId);
    req.onsuccess = () => resolve(req.result ?? undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function saveAttachment(att) {
  if (typeof indexedDB === "undefined") return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, "readwrite").put(att);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function deleteAttachment(itemId) {
  if (typeof indexedDB === "undefined") return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, "readwrite").delete(itemId);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
