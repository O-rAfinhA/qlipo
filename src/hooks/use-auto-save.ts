'use client';

import { useEffect, useRef } from "react";
import { clearLocalStorage, saveToLocalStorage, serializeProject } from "@/lib/project-serializer";
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

export function useAutoSave(state: AutoSaveState, debounceMs = 300) {
  const timerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef  = useRef(false);

  useEffect(() => {
    // Skip the very first run — let the session-restore effect load localStorage first.
    // On the first render the store is empty (media=[]), which would incorrectly
    // trigger clearLocalStorage() before the restore has had a chance to run.
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);

    if (state.media.length === 0) {
      clearLocalStorage();
      return;
    }

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
