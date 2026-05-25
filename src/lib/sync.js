import { supabase } from "./supabase.js";
import { KEYS, load, save } from "./sr.js";

const TABLE = "user_data";

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

// ── Upsert helper (fire-and-forget) ──────────────────────────────────────────

/**
 * Stamps the local meta timestamp for `key` and async-upserts to Supabase.
 * No-op when not signed in or Supabase is unavailable.
 * Errors are silently swallowed here — issue #19 will add an offline queue.
 */
export function stampAndUpsert(key, value, user) {
  const meta = load(KEYS.meta, {});
  const newMeta = stampMeta(meta, key);
  save(KEYS.meta, newMeta);
  if (!user || !supabase) return;
  supabase
    .from(TABLE)
    .upsert(
      { user_id: user.id, key, value, updated_at: newMeta[key] },
      { onConflict: "user_id,key" }
    )
    .then(({ error }) => {
      if (error) console.warn("[sync] upsert failed:", key, error.message);
    })
    .catch((err) => console.warn("[sync] upsert error:", key, err.message));
}

// ── Pull on sign-in ───────────────────────────────────────────────────────────

/**
 * Fetches all rows for the signed-in user and returns merged updates.
 * Also writes winning server timestamps into pj_meta_v1 so subsequent
 * pulls use the correct baseline. Returns null on failure.
 */
export async function pullUserData(user) {
  if (!supabase || !user) return null;
  const { data, error } = await supabase
    .from(TABLE)
    .select("key, value, updated_at")
    .eq("user_id", user.id);
  if (error) {
    console.warn("[sync] pull failed:", error.message);
    return null;
  }
  const rows = data ?? [];
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
