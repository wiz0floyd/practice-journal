import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabase to be null so we test the no-client code paths
vi.mock("./supabase.js", () => ({ supabase: null }));

import {
  cloudEnabled,
  uploadRecording,
  listCloudRecordings,
  downloadRecording,
  deleteCloudRecording,
  cloudUsage,
} from "./cloudRecordings.js";

describe("cloudEnabled (supabase mocked null)", () => {
  it("returns false when supabase client is null", () => {
    expect(cloudEnabled({ recordingStorage: "cloud" }, { id: "u" })).toBe(false);
  });
  it("returns false when user is null", () => {
    expect(cloudEnabled({ recordingStorage: "cloud" }, null)).toBe(false);
  });
  it("returns false when storage mode is local", () => {
    expect(cloudEnabled({ recordingStorage: "local" }, { id: "u" })).toBe(false);
  });
  it("returns false when settings are undefined", () => {
    expect(cloudEnabled(undefined, { id: "u" })).toBe(false);
  });
});

describe("uploadRecording (supabase mocked null)", () => {
  it("returns false when user is null", async () => {
    expect(await uploadRecording(null, { id: "r1", itemId: "i1", blob: new Blob(), format: "audio/webm" })).toBe(false);
  });
  it("returns false when user is undefined", async () => {
    expect(await uploadRecording(undefined, { id: "r1", itemId: "i1", blob: new Blob(), format: "audio/webm" })).toBe(false);
  });
});

describe("listCloudRecordings (supabase mocked null)", () => {
  it("returns empty array when user is null", async () => {
    expect(await listCloudRecordings(null, "item_1")).toEqual([]);
  });
  it("returns empty array when user is undefined", async () => {
    expect(await listCloudRecordings(undefined, "item_1")).toEqual([]);
  });
});

describe("downloadRecording (supabase mocked null)", () => {
  it("returns null for any path", async () => {
    expect(await downloadRecording("u/i/r.webm")).toBeNull();
  });
});

describe("deleteCloudRecording (supabase mocked null)", () => {
  it("returns false for any path", async () => {
    expect(await deleteCloudRecording("u/i/r.webm")).toBe(false);
  });
});

describe("cloudUsage (supabase mocked null)", () => {
  it("returns null when user is null", async () => {
    expect(await cloudUsage(null)).toBeNull();
  });
  it("returns null when user is undefined", async () => {
    expect(await cloudUsage(undefined)).toBeNull();
  });
});
