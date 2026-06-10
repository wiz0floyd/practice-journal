import { describe, it, expect } from "vitest";
import { mergeServerLocal, stampMeta, migrationPlan, mergeById, SYNC_KEYS, uploadAll, fetchAllRows } from "./sync.js";

describe("mergeServerLocal", () => {
  it("returns server value when no local timestamp exists", () => {
    const rows = [{ key: "pj_items_v1", value: ["a"], updated_at: "2026-05-25T10:00:00Z" }];
    const updates = mergeServerLocal(rows, {});
    expect(updates["pj_items_v1"]).toEqual(["a"]);
  });

  it("returns server value when server is newer", () => {
    const rows = [{ key: "pj_cards_v1", value: ["b"], updated_at: "2026-05-25T12:00:00Z" }];
    const localMeta = { "pj_cards_v1": "2026-05-25T10:00:00Z" };
    const updates = mergeServerLocal(rows, localMeta);
    expect(updates["pj_cards_v1"]).toEqual(["b"]);
  });

  it("omits key when local is newer", () => {
    const rows = [{ key: "pj_items_v1", value: ["old"], updated_at: "2026-05-25T08:00:00Z" }];
    const localMeta = { "pj_items_v1": "2026-05-25T10:00:00Z" };
    const updates = mergeServerLocal(rows, localMeta);
    expect(updates["pj_items_v1"]).toBeUndefined();
  });

  it("server wins on equal timestamps", () => {
    const ts = "2026-05-25T10:00:00Z";
    const rows = [{ key: "pj_context_v1", value: "server", updated_at: ts }];
    const localMeta = { "pj_context_v1": ts };
    const updates = mergeServerLocal(rows, localMeta);
    expect(updates["pj_context_v1"]).toBe("server");
  });

  it("handles multiple rows independently", () => {
    const rows = [
      { key: "pj_items_v1", value: ["new-item"], updated_at: "2026-05-25T12:00:00Z" },
      { key: "pj_cards_v1", value: ["old-card"], updated_at: "2026-05-25T08:00:00Z" },
    ];
    const localMeta = {
      "pj_items_v1": "2026-05-25T10:00:00Z",
      "pj_cards_v1": "2026-05-25T10:00:00Z",
    };
    const updates = mergeServerLocal(rows, localMeta);
    expect(updates["pj_items_v1"]).toEqual(["new-item"]);
    expect(updates["pj_cards_v1"]).toBeUndefined();
  });

  it("returns empty object when server has no rows", () => {
    expect(mergeServerLocal([], {})).toEqual({});
  });

  it("local wins when local timestamp is newer (offline edits survive sign-in)", () => {
    // Simulates: user edits while signed out (local T2 > server T1), then signs in.
    // Server must NOT overwrite the offline change.
    const rows = [{ key: "pj_items_v1", value: ["server-data"], updated_at: "2026-05-25T10:00:00Z" }];
    const localMeta = { "pj_items_v1": "2026-05-25T12:00:00Z" };
    const updates = mergeServerLocal(rows, localMeta);
    expect(updates["pj_items_v1"]).toBeUndefined();
  });
});

describe("stampMeta", () => {
  it("adds a key with an ISO timestamp", () => {
    const result = stampMeta({}, "pj_items_v1");
    expect(result["pj_items_v1"]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("preserves existing keys", () => {
    const meta = { "pj_cards_v1": "2026-05-25T10:00:00Z" };
    const result = stampMeta(meta, "pj_items_v1");
    expect(result["pj_cards_v1"]).toBe("2026-05-25T10:00:00Z");
    expect(result["pj_items_v1"]).toBeDefined();
  });

  it("does not mutate the input", () => {
    const meta = { "pj_items_v1": "old" };
    stampMeta(meta, "pj_items_v1");
    expect(meta["pj_items_v1"]).toBe("old");
  });
});

describe("migrationPlan", () => {
  it("returns 'upload' when no cloud rows exist", () => {
    expect(migrationPlan([], {})).toBe("upload");
  });

  it("returns 'upload' when rows is null/undefined", () => {
    expect(migrationPlan(null, {})).toBe("upload");
    expect(migrationPlan(undefined, {})).toBe("upload");
  });

  it("returns 'pull' when cloud rows exist but local meta has no synced keys", () => {
    const rows = [{ key: "pj_items_v1", value: [], updated_at: "2026-05-25T10:00:00Z" }];
    // meta only has pj_meta_v1 which is not in SYNC_KEYS
    expect(migrationPlan(rows, { "pj_meta_v1": "2026-05-25T10:00:00Z" })).toBe("pull");
  });

  it("returns 'pull' when cloud rows exist and local meta is empty", () => {
    const rows = [{ key: "pj_items_v1", value: [], updated_at: "2026-05-25T10:00:00Z" }];
    expect(migrationPlan(rows, {})).toBe("pull");
  });

  it("returns 'conflict' when cloud rows exist and local meta has a synced key", () => {
    const rows = [{ key: "pj_items_v1", value: [], updated_at: "2026-05-25T10:00:00Z" }];
    const localMeta = { [SYNC_KEYS[0]]: "2026-05-25T09:00:00Z" };
    expect(migrationPlan(rows, localMeta)).toBe("conflict");
  });

  it("returns 'pull' when meta only has keys not in SYNC_KEYS", () => {
    const rows = [{ key: "pj_items_v1", value: [], updated_at: "2026-05-25T10:00:00Z" }];
    expect(migrationPlan(rows, { "pj_active_session_v1": "2026-05-25T10:00:00Z" })).toBe("pull");
  });
});

describe("mergeById", () => {
  it("returns union of both arrays when ids are different", () => {
    const server = [{ id: "a", v: "server-a" }];
    const local  = [{ id: "b", v: "local-b" }];
    const result = mergeById(server, local);
    expect(result.map((x) => x.id).sort()).toEqual(["a", "b"]);
  });

  it("server wins on duplicate ids", () => {
    const server = [{ id: "a", v: "server" }];
    const local  = [{ id: "a", v: "local" }];
    const result = mergeById(server, local);
    expect(result).toHaveLength(1);
    expect(result[0].v).toBe("server");
  });

  it("handles undefined/null arrays gracefully", () => {
    expect(() => mergeById(undefined, undefined)).not.toThrow();
    expect(mergeById(null, null)).toEqual([]);
    expect(mergeById([{ id: "x" }], null)).toHaveLength(1);
    expect(mergeById(null, [{ id: "x" }])).toHaveLength(1);
  });

  it("skips items without an id property", () => {
    const server = [{ v: "no-id" }];
    const local  = [{ id: "keep", v: "has-id" }];
    const result = mergeById(server, local);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("keep");
  });
});

describe("uploadAll / fetchAllRows null-supabase guard", () => {
  it("uploadAll returns false when user is null (no-supabase guard path)", async () => {
    // Exercises the `!supabase || !user` guard that protects both null-supabase
    // and null-user scenarios — either causes an immediate safe return.
    const result = await uploadAll(null);
    expect(result).toBe(false);
  });

  it("fetchAllRows returns null when user is null (no-supabase guard path)", async () => {
    const result = await fetchAllRows(null);
    expect(result).toBeNull();
  });
});
