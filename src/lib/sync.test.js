import { describe, it, expect } from "vitest";
import { mergeServerLocal, stampMeta } from "./sync.js";

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
