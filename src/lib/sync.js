import { supabase, APP_ENV } from "./supabase.js";
import { KEYS, load, save } from "./sr.js";

const TABLE = "user_data";

// ── Synced keys (meta / active / migrated never sync) ────────────────────────

export const SYNC_KEYS = [KEYS.items, KEYS.cards, KEYS.context, KEYS.settings, KEYS.sessions, KEYS.badges, KEYS.plans];

// ── Pure helpers (testable) ───────────────────────────────────────────────────

/**
 * Given server rows [{key, value, updated_at}] and local state + meta,
 * returns a map of { key → value } for keys where the server is newer.
 * Server wins on tie or missing local timestamp (last-write-wins).
 */
export function mergeServerLocal(serverRows, localMeta) {
  const updates = {};
  for (const row of serverRows) {
    const localTs = localMeta[row.key];
    if (!localTs || new Date(row.updated_at) >= new Date(localTs)) {
      updates[row.key] = row.value;
    }
  }
  return updates;
}

/** Returns a new meta object with key stamped to now. */
export function stampMeta(meta, key) {
  return { ...meta, [key]: new Date().toISOString() };
}

/**
 * Decides which migration action to take on first sign-in.
 * - "upload"   → no cloud data; push local up.
 * - "pull"     → cloud data exists but local was never modified (fresh device).
 * - "conflict" → both sides have data; user must choose.
 */
export function migrationPlan(rows, localMeta) {
  const hasCloud = (rows ?? []).length > 0;
  const hasLocal = Object.keys(localMeta ?? {}).some((k) => SYNC_KEYS.includes(k));
  if (!hasCloud) return "upload";
  return hasLocal ? "conflict" : "pull";
}

/**
 * Merges two arrays by id: union of both, server wins on duplicate ids.
 * Items without an id property are skipped.
 */
export function mergeById(serverArr, localArr) {
  const map = new Map();
  for (const x of localArr ?? []) if (x && x.id != null) map.set(x.id, x);
  for (const x of serverArr ?? []) if (x && x.id != null) map.set(x.id, x);
  return [...map.values()];
}

// ── Pure queue helpers (testable) ─────────────────────────────────────────────

/** One pending write per key, latest wins. */
export const enqueueWrite = (queue, entry) => [...(queue ?? []).filter((q) => q.key !== entry.key), entry];

/** Drop entries older than 7 days. */
export const pruneQueue = (queue, now = new Date()) =>
  (queue ?? []).filter((q) => now - new Date(q.updated_at) < 7 * 24 * 3600 * 1000);

/**
 * Splits the queue into entries to push and entries to drop (server is newer).
 * Server wins when its timestamp is strictly newer than the queued entry.
 * Queue entry wins (push) on equal timestamps (>= rule).
 */
export const partitionQueue = (queue, serverRows) => {
  const serverTs = Object.fromEntries((serverRows ?? []).map((r) => [r.key, r.updated_at]));
  const push = [], drop = [];
  for (const q of queue ?? []) {
    const ts = serverTs[q.key];
    (!ts || new Date(q.updated_at) >= new Date(ts) ? push : drop).push(q);
  }
  return { push, drop };
};

// ── Status pub-sub ────────────────────────────────────────────────────────────

let statusListener = null;
export const onSyncStatus = (fn) => { statusListener = fn; };
const emitStatus = (s) => { try { statusListener?.(s); } catch { /* noop */ } };

// ── Queue persistence helpers (internal) ──────────────────────────────────────

const loadQueue = () => load(KEYS.queue, []);
const saveQueue = (q) => save(KEYS.queue, q);

// ── Upsert helper (fire-and-forget) ──────────────────────────────────────────

/**
 * Stamps the local meta timestamp for `key` and async-upserts to Supabase.
 * No-op when not signed in or Supabase is unavailable.
 * On failure, enqueues the write for later retry.
 */
export function stampAndUpsert(key, value, user) {
  const meta = load(KEYS.meta, {});
  const newMeta = stampMeta(meta, key);
  save(KEYS.meta, newMeta);
  if (!user || !supabase) return;
  emitStatus("syncing");
  supabase
    .from(TABLE)
    .upsert(
      { user_id: user.id, env: APP_ENV, key, value, updated_at: newMeta[key] },
      { onConflict: "user_id,env,key" }
    )
    .then(({ error }) => {
      if (error) {
        console.warn("[sync] upsert failed:", key, error.message);
        saveQueue(enqueueWrite(loadQueue(), { key, value, updated_at: newMeta[key] }));
        emitStatus("error");
      } else {
        emitStatus("idle");
      }
    })
    .catch((err) => {
      console.warn("[sync] upsert error:", key, err.message);
      saveQueue(enqueueWrite(loadQueue(), { key, value, updated_at: newMeta[key] }));
      emitStatus("error");
    });
}

// ── Queue flush ───────────────────────────────────────────────────────────────

/**
 * Flushes the offline write queue to Supabase.
 * Drops stale entries (>7 days) and entries where the server already has a newer write.
 * Returns true on success, false on failure.
 */
export async function flushQueue(user) {
  if (!supabase || !user) return false;
  const q = pruneQueue(loadQueue());
  if (!q.length) { saveQueue([]); emitStatus("idle"); return true; }
  emitStatus("syncing");
  const rows = await fetchAllRows(user);
  if (rows === null) { saveQueue(q); emitStatus("error"); return false; }
  const { push, drop } = partitionQueue(q, rows);
  if (drop.length) console.warn("[sync] dropped stale queued writes:", drop.map((d) => d.key));
  if (push.length) {
    const { error } = await supabase
      .from(TABLE)
      .upsert(
        push.map((p) => ({ user_id: user.id, env: APP_ENV, key: p.key, value: p.value, updated_at: p.updated_at })),
        { onConflict: "user_id,env,key" }
      );
    if (error) {
      console.warn("[sync] flush failed:", error.message);
      saveQueue(q);
      emitStatus("error");
      return false;
    }
  }
  saveQueue([]);
  emitStatus("idle");
  return true;
}

// ── Fetch all rows ────────────────────────────────────────────────────────────

/**
 * Fetches all rows for the signed-in user. Returns null on failure/unavailable.
 */
export async function fetchAllRows(user) {
  if (!supabase || !user) return null;
  const { data, error } = await supabase
    .from(TABLE)
    .select("key, value, updated_at")
    .eq("user_id", user.id)
    .eq("env", APP_ENV);
  if (error) {
    console.warn("[sync] fetch failed:", error.message);
    return null;
  }
  return data ?? [];
}

// ── Pull on sign-in ───────────────────────────────────────────────────────────

/**
 * Fetches all rows for the signed-in user and returns merged updates.
 * Also writes winning server timestamps into pj_meta_v1 so subsequent
 * pulls use the correct baseline. Returns null on failure.
 */
export async function pullUserData(user) {
  const rows = await fetchAllRows(user);
  if (rows === null) return null;
  const localMeta = load(KEYS.meta, {});
  const updates = mergeServerLocal(rows, localMeta);
  if (Object.keys(updates).length > 0) {
    const newMeta = { ...localMeta };
    for (const row of rows) {
      if (updates[row.key] !== undefined) {
        newMeta[row.key] = new Date(row.updated_at).toISOString();
      }
    }
    save(KEYS.meta, newMeta);
  }
  return updates;
}

// ── Upload all local data ─────────────────────────────────────────────────────

/**
 * Uploads all locally-stored SYNC_KEYS to Supabase, overwriting cloud.
 * Returns true on success, false on failure.
 */
export async function uploadAll(user) {
  if (!supabase || !user) return false;
  const now = new Date().toISOString();
  const meta = load(KEYS.meta, {});
  const rows = [];
  const newMeta = { ...meta };
  for (const key of SYNC_KEYS) {
    const raw = localStorage.getItem(key);
    if (raw === null) continue;
    let value;
    try { value = JSON.parse(raw); } catch { continue; }
    const ts = meta[key] ?? now;
    newMeta[key] = ts;
    rows.push({ user_id: user.id, env: APP_ENV, key, value, updated_at: ts });
  }
  if (!rows.length) return true;
  const { error } = await supabase.from(TABLE).upsert(rows, { onConflict: "user_id,env,key" });
  if (error) { console.warn("[sync] uploadAll failed:", error.message); return false; }
  save(KEYS.meta, newMeta);
  return true;
}

// ── Unconditional apply (used by "Use cloud") ─────────────────────────────────

/**
 * Writes all rows to localStorage and stamps meta. Returns a map of updates.
 */
export function applyRows(rows) {
  const newMeta = { ...load(KEYS.meta, {}) };
  const updates = {};
  for (const row of rows ?? []) {
    updates[row.key] = row.value;
    save(row.key, row.value);
    newMeta[row.key] = new Date(row.updated_at).toISOString();
  }
  save(KEYS.meta, newMeta);
  return updates;
}

// ── Migration flag ────────────────────────────────────────────────────────────

export const isMigrated = (userId) => !!load(KEYS.migrated, {})[userId];
export const setMigrated = (userId) => save(KEYS.migrated, { ...load(KEYS.migrated, {}), [userId]: new Date().toISOString() });
