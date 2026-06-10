import { z } from "zod";
import type {
  AudioTimelineItem,
  ExportPreset,
  MediaItem,
  TextOverlay,
  VisualTimelineItem,
  Watermark,
} from "@/lib/types";

export type ProjectSaveData = {
  version: 1;
  savedAt: number;
  preset: ExportPreset;
  editMode: "auto" | "manual";
  mediaOrder: "sequential" | "random";
  colorGradePresetId: string | null;
  media: (Omit<MediaItem, "previewUrl"> & { previewUrl?: string })[];
  visuals: VisualTimelineItem[];
  audios: AudioTimelineItem[];
  textOverlays: TextOverlay[];
  watermarks: Watermark[];
};

// ─── Zod schema ───────────────────────────────────────────────────────────────

const schema = z.object({
  version: z.literal(1),
  savedAt: z.number(),
  preset: z.enum(["reels_9_16", "landscape_16_9", "square_1_1"]),
  editMode: z.enum(["auto", "manual"]),
  mediaOrder: z.enum(["sequential", "random"]),
  colorGradePresetId: z.string().nullable(),
  media: z.array(z.object({
    id: z.string(),
    name: z.string(),
    kind: z.enum(["image", "video", "audio"]),
    format: z.string(),
    sizeBytes: z.number(),
    durationSeconds: z.number(),
    serverPath: z.string().optional(),
    r2Key: z.string().optional(),
    previewUrl: z.string().optional(),
    valid: z.boolean(),
    issues: z.array(z.string()),
  })),
  visuals: z.array(z.object({
    id: z.string(),
    mediaId: z.string(),
    kind: z.enum(["image", "video"]),
    order: z.number(),
    durationSeconds: z.number(),
    fadeInSeconds: z.number(),
    fadeOutSeconds: z.number(),
    startAt: z.number().optional(),
    volume: z.number().optional(),
    opacity: z.number().optional(),
    brightness: z.number().optional(),
    contrast: z.number().optional(),
    saturation: z.number().optional(),
    blur: z.number().optional(),
    transitionType: z.string().optional(),
  })),
  audios: z.array(z.object({
    id: z.string(),
    mediaId: z.string(),
    order: z.number(),
    startAt: z.number().optional(),
    volume: z.number().optional(),
  })),
  textOverlays: z.array(z.object({
    id: z.string(),
    text: z.string(),
    startAt: z.number(),
    endAt: z.number(),
    x: z.number(),
    y: z.number(),
    fontSize: z.number(),
    color: z.string(),
    fontWeight: z.enum(["normal", "bold"]),
    animation: z.enum(["none", "fade", "slide-up"]),
  })).default([]),
  watermarks: z.array(z.object({
    id: z.string(),
    mediaId: z.string(),
    imageUrl: z.string().optional(),
    imageData: z.string().optional(),
    size: z.number(),
    opacity: z.number(),
    x: z.number().default(75),
    y: z.number().default(75),
    startAt: z.number(),
    endAt: z.number(),
    fadeInDuration: z.number(),
    fadeOutDuration: z.number(),
  })).default([]),
});

// ─── Serialize ────────────────────────────────────────────────────────────────

export function serializeProject(state: {
  preset: ExportPreset;
  editMode: "auto" | "manual";
  mediaOrder: "sequential" | "random";
  colorGradePresetId: string | null;
  media: MediaItem[];
  visuals: VisualTimelineItem[];
  audios: AudioTimelineItem[];
  textOverlays: TextOverlay[];
  watermarks: Watermark[];
}): ProjectSaveData {
  return {
    version: 1,
    savedAt: Date.now(),
    preset: state.preset,
    editMode: state.editMode,
    mediaOrder: state.mediaOrder,
    colorGradePresetId: state.colorGradePresetId,
    // Only persist real URLs (not blob: URLs which are session-only)
    media: state.media.map(({ previewUrl, ...rest }) => ({
      ...rest,
      previewUrl: previewUrl?.startsWith("blob:") ? undefined : previewUrl,
    })),
    visuals: state.visuals,
    audios: state.audios,
    textOverlays: state.textOverlays,
    watermarks: state.watermarks,
  };
}

// ─── Deserialize ──────────────────────────────────────────────────────────────

export function deserializeProject(raw: unknown): ProjectSaveData {
  return schema.parse(raw) as ProjectSaveData;
}

// ─── File I/O ─────────────────────────────────────────────────────────────────

export function downloadProjectFile(data: ProjectSaveData, filename = "projeto.qlipo.json") {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function readProjectFile(file: File): Promise<ProjectSaveData> {
  const text = await file.text();
  return deserializeProject(JSON.parse(text));
}

// ─── LocalStorage auto-save ───────────────────────────────────────────────────

const LS_KEY = "qlipo-autosave-v1";

export function saveToLocalStorage(data: ProjectSaveData) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch {}
}

export function loadFromLocalStorage(): ProjectSaveData | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return deserializeProject(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function clearLocalStorage() {
  try { localStorage.removeItem(LS_KEY); } catch {}
}

// ─── Crash detection ─────────────────────────────────────────────────────────
// On mount we set the flag. On beforeunload (clean exit / refresh) we clear it.
// If on the next mount the flag is still set, beforeunload never ran → crash.

const LS_SESSION_KEY = "qlipo-session-active";

export function markSessionStart() {
  try { localStorage.setItem(LS_SESSION_KEY, "1"); } catch {}
}

export function markSessionEnd() {
  try { localStorage.removeItem(LS_SESSION_KEY); } catch {}
}

export function didSessionCrash(): boolean {
  try { return localStorage.getItem(LS_SESSION_KEY) === "1"; } catch { return false; }
}
