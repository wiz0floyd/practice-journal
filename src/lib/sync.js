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
    if (!localTs || row.updated_at >= localTs) {
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
    });
}

// ── Pull on sign-in ───────────────────────────────────────────────────────────

/**
 * Fetches all rows for the signed-in user and returns merged updates.
 * Returns null if Supabase is unavailable or the fetch fails.
 */
export async function pullUserData() {
  if (!supabase) return null;
  const { data, error } = await supabase.from(TABLE).select("key, value, updated_at");
  if (error) {
    console.warn("[sync] pull failed:", error.message);
    return null;
  }
  const localMeta = load(KEYS.meta, {});
  return mergeServerLocal(data ?? [], localMeta);
}
