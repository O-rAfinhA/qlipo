'use client';

import { useEffect, useRef } from "react";
import { saveToLocalStorage, serializeProject } from "@/lib/project-serializer";
import type { AudioTimelineItem, ExportPreset, MediaItem, TextOverlay, VisualTimelineItem, Watermark } from "@/lib/types";

type AutoSaveState = {
  preset: ExportPreset;
  editMode: "auto" | "manual";
  mediaOrder: "sequential" | "random";
  colorGradePresetId: string | null;
  media: MediaItem[];
  visuals: VisualTimelineItem[];
  audios: AudioTimelineItem[];
  textOverlays: TextOverlay[];
  watermarks: Watermark[];
};

export function useAutoSave(state: AutoSaveState, debounceMs = 1000) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Don't save empty projects
    if (state.media.length === 0) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const data = serializeProject(state);
      saveToLocalStorage(data);
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  // Serialize state to a stable string so effect only fires on real changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.preset, state.editMode, state.mediaOrder, state.colorGradePresetId,
    state.media, state.visuals, state.audios, state.textOverlays, state.watermarks, debounceMs,
  ]);
}
