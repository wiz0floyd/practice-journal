import { supabase } from "./supabase.js";
import { recordingPath } from "./sr.js";

const BUCKET = "recordings";

export const cloudEnabled = (settings, user) =>
  !!supabase && !!user && settings?.recordingStorage === "cloud";

export async function uploadRecording(user, rec) {
  if (!supabase || !user) return false;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(recordingPath(user.id, rec.itemId, rec.id), rec.blob, {
      contentType: rec.format || "audio/webm",
      upsert: true,
    });
  if (error) { console.warn("[cloudrec] upload failed:", error.message); return false; }
  return true;
}

export async function listCloudRecordings(user, itemId) {
  if (!supabase || !user) return [];
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list(`${user.id}/${itemId}`, { sortBy: { column: "name", order: "desc" } });
  if (error) { console.warn("[cloudrec] list failed:", error.message); return []; }
  return (data ?? [])
    .filter((f) => f.name.endsWith(".webm"))
    .map((f) => ({
      id:   f.name.replace(/\.webm$/, ""),
      name: f.name,
      path: `${user.id}/${itemId}/${f.name}`,
      size: f.metadata?.size ?? 0,
      date: f.created_at ?? null,
    }))
    .sort((a, b) => new Date(b.date ?? 0) - new Date(a.date ?? 0));
}

export async function downloadRecording(path) {
  if (!supabase) return null;
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error) { console.warn("[cloudrec] download failed:", error.message); return null; }
  return data;
}

export async function deleteCloudRecording(path) {
  if (!supabase) return false;
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) { console.warn("[cloudrec] delete failed:", error.message); return false; }
  return true;
}

export async function pruneCloud(user, itemId, limit) {
  const recs = await listCloudRecordings(user, itemId);
  await Promise.all(recs.slice(limit).map((r) => deleteCloudRecording(r.path)));
}

export async function cloudUsage(user) {
  if (!supabase || !user) return null;
  const { data: folders, error } = await supabase.storage.from(BUCKET).list(user.id);
  if (error || !folders) return null;
  let total = 0;
  for (const folder of folders) {
    if (!folder.id && folder.name) {
      const { data: files } = await supabase.storage
        .from(BUCKET)
        .list(`${user.id}/${folder.name}`);
      for (const f of files ?? []) total += f.metadata?.size ?? 0;
    } else {
      total += folder.metadata?.size ?? 0;
    }
  }
  return total;
}
