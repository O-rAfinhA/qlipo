'use client';

import { create } from "zustand";

import {
  computeVisualSegments,
  DEFAULT_FADE_SECONDS,
  DEFAULT_IMAGE_DURATION,
  detectMediaKind,
  exportPresets,
  validateMediaFile,
} from "@/lib/media-rules";
import { COLOR_GRADE_PRESETS } from "@/lib/color-grade-presets";
import type {
  AudioTimelineItem,
  CompositionSummary,
  ExportPreset,
  MediaItem,
  OutputOptions,
  TextOverlay,
  UploadValidationResponse,
  VisualTimelineItem,
  Watermark,
  XfadeTransitionType,
} from "@/lib/types";
import { DEFAULT_OUTPUT_OPTIONS } from "@/lib/types";
import type { AutoEnhancements } from "@/lib/media-rules";

type UploadableFile = File & {
  durationSeconds?: number;
  serverPath?: string;
  r2Key?: string;
  previewUrl?: string;
};

type EditorState = {
  preset: ExportPreset;
  media: MediaItem[];
  visuals: VisualTimelineItem[];
  audios: AudioTimelineItem[];
  projectBytes: number;
  processing: boolean;
  progress: number;
  progressMessage: string;
  activeJobId?: string;
  downloadUrl?: string;
  simulationMode: boolean;
  editMode: "auto" | "manual";
  mediaOrder: "sequential" | "random";
  colorGradePresetId: string | null;
  autoEnhancements: AutoEnhancements;
  outputOptions: OutputOptions;
  textOverlays: TextOverlay[];
  watermarks: Watermark[];
  setPreset: (preset: ExportPreset) => void;
  setMediaOrder: (order: "sequential" | "random") => void;
  setColorGradePreset: (id: string | null) => void;
  applyColorGradeToAllClips: (id: string) => void;
  applyColorGradeToClip: (presetId: string, clipId: string) => void;
  setOutputOptions: (opts: Partial<OutputOptions>) => void;
  setAutoEnhancements: (patch: Partial<AutoEnhancements>) => void;
  reorderVisuals: (orderedIds: string[]) => void;
  setEditMode: (mode: "auto" | "manual", summary?: CompositionSummary) => void;
  ingestFiles: (files: UploadableFile[], validation?: UploadValidationResponse) => void;
  moveVisual: (activeId: string, overId: string) => void;
  moveAudio: (activeId: string, overId: string) => void;
  removeMedia: (mediaId: string) => void;
  updateVisualDuration: (id: string, durationSeconds: number) => void;
  updateVisualFade: (id: string, field: "fadeInSeconds" | "fadeOutSeconds", value: number) => void;
  setVisualPosition: (id: string, startAt: number, durationSeconds: number) => void;
  setAudioPosition: (id: string, startAt: number) => void;
  updateVisualProp: (id: string, field: string, value: number) => void;
  updateVisualTransition: (id: string, type: XfadeTransitionType | undefined) => void;
  updateAudioProp: (id: string, field: string, value: number) => void;
  syncClipsToEvents: (events: number[], totalDuration: number) => void;
  addTextOverlay: (overlay: TextOverlay) => void;
  updateTextOverlay: (id: string, patch: Partial<TextOverlay>) => void;
  removeTextOverlay: (id: string) => void;
  addWatermark: (watermark: Watermark) => void;
  updateWatermark: (id: string, patch: Partial<Watermark>) => void;
  removeWatermark: (id: string) => void;
  loadProject: (data: import("@/lib/project-serializer").ProjectSaveData) => void;
  clearProject: () => void;
  setProcessingState: (state: Partial<Pick<EditorState, "processing" | "progress" | "progressMessage" | "activeJobId" | "downloadUrl" | "simulationMode">>) => void;
};

function reorder<T extends { id: string; order: number }>(items: T[], activeId: string, overId: string) {
  const next = [...items].sort((a, b) => a.order - b.order);
  const oldIndex = next.findIndex((entry) => entry.id === activeId);
  const newIndex = next.findIndex((entry) => entry.id === overId);
  if (oldIndex < 0 || newIndex < 0) return items;
  const [moved] = next.splice(oldIndex, 1);
  next.splice(newIndex, 0, moved);
  return next.map((entry, index) => ({ ...entry, order: index }));
}

export const useEditorStore = create<EditorState>((set, get) => ({
  preset: "landscape_16_9",
  media: [],
  visuals: [],
  audios: [],
  projectBytes: 0,
  processing: false,
  progress: 0,
  progressMessage: "Pronto para processar",
  simulationMode: true,
  editMode: "auto",
  mediaOrder: "sequential",
  colorGradePresetId: null,
  autoEnhancements: { introOutro: true, speedVariation: false },
  outputOptions: DEFAULT_OUTPUT_OPTIONS,
  textOverlays: [],
  watermarks: [],

  setPreset: (preset) => set({ preset }),
  setMediaOrder: (mediaOrder) => set({ mediaOrder }),
  setColorGradePreset: (id) => set({ colorGradePresetId: id }),
  setOutputOptions: (opts) => set({ outputOptions: { ...get().outputOptions, ...opts } }),
  setAutoEnhancements: (patch) => set({ autoEnhancements: { ...get().autoEnhancements, ...patch } }),
  reorderVisuals: (orderedIds) =>
    set({
      visuals: orderedIds
        .map((id, idx) => {
          const v = get().visuals.find((x) => x.id === id);
          return v ? { ...v, order: idx } : null;
        })
        .filter((v): v is NonNullable<typeof v> => v !== null),
    }),
  applyColorGradeToAllClips: (id) => {
    const preset = COLOR_GRADE_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    set({
      colorGradePresetId: id,
      visuals: get().visuals.map((v) => ({
        ...v,
        brightness: preset.brightness,
        contrast:   preset.contrast,
        saturation: preset.saturation,
        blur:       preset.blur,
      })),
    });
  },

  applyColorGradeToClip: (presetId, clipId) => {
    const preset = COLOR_GRADE_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    set({
      colorGradePresetId: presetId,
      visuals: get().visuals.map((v) =>
        v.id === clipId
          ? { ...v, brightness: preset.brightness, contrast: preset.contrast, saturation: preset.saturation, blur: preset.blur }
          : v,
      ),
    });
  },

  setEditMode: (mode, summary) => {
    if (mode === "manual") {
      const state = get();

      // Always derive positions from the ORIGINAL clips only (no loop-extension
      // repeats), so the same mediaId doesn't end up at a far-right position.
      const segments  = computeVisualSegments(state.media, state.visuals);
      const audioSegs = summary?.audioSegments ?? [];

      // Use FIRST occurrence of each mediaId (original sequential position).
      const visualStartMap = new Map<string, number>();
      for (const s of segments) {
        if (!visualStartMap.has(s.mediaId)) visualStartMap.set(s.mediaId, s.startAt);
      }
      const audioStartMap = new Map<string, number>();
      for (const s of audioSegs) {
        if (!audioStartMap.has(s.mediaId)) audioStartMap.set(s.mediaId, s.startAt);
      }

      set({
        editMode: "manual",
        visuals: state.visuals.map((item) => ({
          ...item,
          startAt: visualStartMap.get(item.mediaId) ?? 0,
        })),
        audios: state.audios.map((item) => ({
          ...item,
          startAt: audioStartMap.get(item.mediaId) ?? 0,
        })),
      });
    } else {
      // Strip explicit positions — revert to order-based auto mode
      set({
        editMode: "auto",
        visuals: get().visuals.map((item) => {
          const { startAt: _removed, ...rest } = item;
          return rest as VisualTimelineItem;
        }),
        audios: get().audios.map((item) => {
          const { startAt: _removed, ...rest } = item;
          return rest as AudioTimelineItem;
        }),
      });
    }
  },

  ingestFiles: (files, validation) => {
    const state = get();
    const currentBytes = state.projectBytes;
    const totalBytes = currentBytes + files.reduce((sum, file) => sum + file.size, 0);

    const mappedMedia = files.map((file, index) => {
      const validationEntry = validation?.files.find((entry) => entry.name === file.name);
      const detectedKind = validationEntry?.detectedCategory ?? detectMediaKind(file.name, file.type);
      const fallbackValidation = validateMediaFile(file.name, file.size, totalBytes, file.type);
      const id = `${file.name}-${file.size}-${Date.now()}-${index}`;
      const kind = detectedKind === "unknown" ? fallbackValidation.kind : detectedKind;
      const durationSeconds =
        kind === "image" ? DEFAULT_IMAGE_DURATION : Number(file.durationSeconds?.toFixed(2) ?? 8);

      return {
        id,
        name: file.name,
        kind: kind === "unknown" ? "image" : kind,
        format: file.name.split(".").pop()?.toLowerCase() ?? "bin",
        sizeBytes: file.size,
        durationSeconds,
        previewUrl: file.previewUrl ?? URL.createObjectURL(file),
        serverPath: file.serverPath,
        r2Key: file.r2Key,
        valid: validationEntry?.valid ?? fallbackValidation.valid,
        issues: validationEntry?.issues ?? fallbackValidation.issues,
      } satisfies MediaItem;
    });

    const validMedia = mappedMedia.filter((entry) => entry.valid);

    // Each new clip goes to its own track starting at t=0.
    // The user positions it by dragging in the timeline.
    const inManual = state.editMode === "manual";

    const newVisuals = validMedia
      .filter((entry) => entry.kind !== "audio")
      .map((entry, index) => {
        const dur = entry.kind === "image" ? DEFAULT_IMAGE_DURATION : entry.durationSeconds;
        const item: VisualTimelineItem = {
          id: `visual-${entry.id}`,
          mediaId: entry.id,
          kind: entry.kind as "image" | "video",
          order: state.visuals.length + index,
          durationSeconds: dur,
          fadeInSeconds: DEFAULT_FADE_SECONDS,
          fadeOutSeconds: DEFAULT_FADE_SECONDS,
          ...(inManual && { startAt: 0 }),
        };
        return item;
      });

    const newAudios = validMedia
      .filter((entry) => entry.kind === "audio")
      .map((entry, index) => {
        const item: AudioTimelineItem = {
          id: `audio-${entry.id}`,
          mediaId: entry.id,
          order: state.audios.length + index,
          ...(inManual && { startAt: 0 }),
        };
        return item;
      });

    set({
      media: [...state.media, ...mappedMedia],
      visuals: [...state.visuals, ...newVisuals],
      audios: [...state.audios, ...newAudios],
      projectBytes: totalBytes,
      simulationMode: true,
    });
  },

  moveVisual: (activeId, overId) => set({ visuals: reorder(get().visuals, activeId, overId) }),
  moveAudio: (activeId, overId) => set({ audios: reorder(get().audios, activeId, overId) }),

  removeMedia: (mediaId) =>
    set({
      media: get().media.filter((entry) => entry.id !== mediaId),
      visuals: get()
        .visuals.filter((entry) => entry.mediaId !== mediaId)
        .map((entry, index) => ({ ...entry, order: index })),
      audios: get()
        .audios.filter((entry) => entry.mediaId !== mediaId)
        .map((entry, index) => ({ ...entry, order: index })),
      projectBytes: get()
        .media.filter((entry) => entry.id !== mediaId)
        .reduce((sum, entry) => sum + entry.sizeBytes, 0),
    }),

  updateVisualDuration: (id, durationSeconds) =>
    set({
      visuals: get().visuals.map((entry) =>
        entry.id === id ? { ...entry, durationSeconds: Number(durationSeconds.toFixed(2)) } : entry,
      ),
    }),

  updateVisualFade: (id, field, value) =>
    set({
      visuals: get().visuals.map((entry) =>
        entry.id === id ? { ...entry, [field]: Number(value.toFixed(2)) } : entry,
      ),
    }),

  setVisualPosition: (id, startAt, durationSeconds) =>
    set({
      visuals: get().visuals.map((entry) =>
        entry.id === id
          ? { ...entry, startAt: Number(startAt.toFixed(2)), durationSeconds: Number(durationSeconds.toFixed(2)) }
          : entry,
      ),
    }),

  setAudioPosition: (id, startAt) =>
    set({
      audios: get().audios.map((entry) =>
        entry.id === id ? { ...entry, startAt: Number(startAt.toFixed(2)) } : entry,
      ),
    }),

  updateVisualProp: (id, field, value) =>
    set({
      visuals: get().visuals.map((entry) =>
        entry.id === id ? { ...entry, [field]: Number(value.toFixed(2)) } : entry,
      ),
    }),

  updateVisualTransition: (id, type) =>
    set({
      visuals: get().visuals.map((entry) =>
        entry.id === id ? { ...entry, transitionType: type } : entry,
      ),
    }),

  updateAudioProp: (id, field, value) =>
    set({
      audios: get().audios.map((entry) =>
        entry.id === id ? { ...entry, [field]: Number(value.toFixed(2)) } : entry,
      ),
    }),

  syncClipsToEvents: (events, totalDuration) => {
    const state   = get();
    const sorted  = [...state.visuals].sort((a, b) => a.order - b.order);
    if (sorted.length === 0) return;

    // Build section boundaries: [0, e0, e1, ..., en, totalDuration]
    const boundaries = [0, ...events.filter((t) => t > 0 && t < totalDuration), totalDuration];

    const newVisuals = sorted.map((item, idx) => {
      // Each clip maps to the section at its index (last section reused for overflow)
      const sectionIdx  = Math.min(idx, boundaries.length - 2);
      const sectionStart = boundaries[sectionIdx];
      const sectionEnd   = boundaries[sectionIdx + 1];
      const sectionDur   = sectionEnd - sectionStart;

      // Preserve clip's natural duration but cap it so it doesn't spill into
      // the next section; for images stretch to fill the section exactly.
      const naturalDur = item.durationSeconds;
      const newDur     = item.kind === "image"
        ? sectionDur
        : Math.min(naturalDur, sectionDur);

      return {
        ...item,
        startAt:         Number(sectionStart.toFixed(2)),
        durationSeconds: Number(Math.max(0.5, newDur).toFixed(2)),
      };
    });

    set({ editMode: "manual", visuals: newVisuals });
  },

  addTextOverlay: (overlay) =>
    set({ textOverlays: [...get().textOverlays, overlay] }),

  updateTextOverlay: (id, patch) =>
    set({ textOverlays: get().textOverlays.map((o) => o.id === id ? { ...o, ...patch } : o) }),

  removeTextOverlay: (id) =>
    set({ textOverlays: get().textOverlays.filter((o) => o.id !== id) }),

  addWatermark: (watermark) =>
    set({ watermarks: [...get().watermarks, watermark] }),

  updateWatermark: (id, patch) =>
    set({ watermarks: get().watermarks.map((w) => w.id === id ? { ...w, ...patch } : w) }),

  removeWatermark: (id) =>
    set({ watermarks: get().watermarks.filter((w) => w.id !== id) }),

  loadProject: (data) => set({
    preset:             data.preset,
    editMode:           data.editMode,
    mediaOrder:         data.mediaOrder,
    colorGradePresetId: data.colorGradePresetId,
    // previewUrl will be undefined — components handle this gracefully
    media:              data.media as MediaItem[],
    visuals:            data.visuals as VisualTimelineItem[],
    audios:             data.audios as AudioTimelineItem[],
    textOverlays:       data.textOverlays,
    watermarks:         data.watermarks,
    projectBytes:       data.media.reduce((sum, m) => sum + m.sizeBytes, 0),
    simulationMode:     true,
    processing:         false,
    progress:           0,
    progressMessage:    "Projeto carregado",
    downloadUrl:        undefined,
    activeJobId:        undefined,
  }),

  clearProject: () => set({
    media: [], visuals: [], audios: [], textOverlays: [], watermarks: [],
    projectBytes: 0, colorGradePresetId: null,
    editMode: "auto", mediaOrder: "sequential",
    processing: false, progress: 0, progressMessage: "Pronto para processar",
    downloadUrl: undefined, activeJobId: undefined, simulationMode: true,
  }),

  setProcessingState: (state) => set(state),
}));

export function usePresetMetadata() {
  return useEditorStore((state) => exportPresets[state.preset]);
}
