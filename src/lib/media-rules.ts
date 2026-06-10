import type {
  AudioSegment,
  AudioTimelineItem,
  CompositionSummary,
  ExportPreset,
  MediaItem,
  MediaKind,
  MediaValidation,
  VisualSegment,
  VisualTimelineItem,
  XfadeTransitionType,
} from "@/lib/types";

export const MAX_FILE_BYTES = 500 * 1024 * 1024;
export const MAX_PROJECT_BYTES = 2 * 1024 * 1024 * 1024;
export const DEFAULT_IMAGE_DURATION = 3;
export const DEFAULT_FADE_SECONDS = 1;
export const DEFAULT_CROSSFADE_SECONDS = 2;
export const TARGET_GAIN_DB = -14;
export const PEAK_LIMIT_DB = -1;

export const WATERMARK_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const WATERMARK_SUPPORTED_FORMATS = ["jpg", "jpeg", "png", "webp"];
export const WATERMARK_CONSTRAINTS = {
  minSize: 5,
  maxSize: 50,
  minOpacity: 10,
  maxOpacity: 100,
  minFadeDuration: 0.5,
};

const supportedFormats: Record<MediaKind, string[]> = {
  image: ["jpg", "jpeg", "png", "webp", "heic"],
  video: ["mp4", "mov", "avi", "webm"],
  audio: ["mp3", "wav", "aac", "flac"],
};

export const exportPresets: Record<
  ExportPreset,
  { label: string; width: number; height: number; aspect: string }
> = {
  landscape_16_9: { label: "YouTube / Facebook", width: 1920, height: 1080, aspect: "16:9" },
  reels_9_16: { label: "Instagram Reels / TikTok / Shorts", width: 1080, height: 1920, aspect: "9:16" },
  square_1_1: { label: "Instagram Feed", width: 1080, height: 1080, aspect: "1:1" },
};

export function extensionFromName(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return ext;
}

export function detectMediaKind(name: string, mimeType?: string): MediaKind | "unknown" {
  const ext = extensionFromName(name);
  for (const [kind, formats] of Object.entries(supportedFormats) as Array<[MediaKind, string[]]>) {
    if (formats.includes(ext)) {
      return kind;
    }
  }

  if (!mimeType) {
    return "unknown";
  }

  if (mimeType.startsWith("image/")) {
    return "image";
  }
  if (mimeType.startsWith("video/")) {
    return "video";
  }
  if (mimeType.startsWith("audio/")) {
    return "audio";
  }

  return "unknown";
}

export function validateMediaFile(
  name: string,
  sizeBytes: number,
  totalProjectBytes: number,
  mimeType?: string,
): MediaValidation & { kind: MediaKind | "unknown" } {
  const kind = detectMediaKind(name, mimeType);
  const issues: MediaValidation["issues"] = [];

  if (kind === "unknown") {
    issues.push("invalid-format");
  }
  if (sizeBytes > MAX_FILE_BYTES) {
    issues.push("file-too-large");
  }
  if (totalProjectBytes > MAX_PROJECT_BYTES) {
    issues.push("project-too-large");
  }

  return {
    kind,
    valid: issues.length === 0,
    issues,
  };
}

export function validateWatermarkFile(
  name: string,
  sizeBytes: number,
): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  const ext = extensionFromName(name).toLowerCase();

  if (!WATERMARK_SUPPORTED_FORMATS.includes(ext)) {
    issues.push("invalid-watermark-format");
  }
  if (sizeBytes > WATERMARK_MAX_FILE_BYTES) {
    issues.push("watermark-too-large");
  }

  return { valid: issues.length === 0, issues };
}

export function clampFade(durationSeconds: number, requestedFade: number) {
  const safeMax = Math.max(0, durationSeconds / 2);
  return Number(Math.min(Math.max(requestedFade, 0), safeMax).toFixed(2));
}

export function computeVisualSegments(
  media: MediaItem[],
  visuals: VisualTimelineItem[],
): VisualSegment[] {
  let cursor = 0;

  return [...visuals]
    .sort((a, b) => a.order - b.order)
    .map((item) => {
      const source = media.find((entry) => entry.id === item.mediaId);
      const duration = source?.kind === "video" ? source.durationSeconds : item.durationSeconds;
      const fadeInSeconds = clampFade(duration, item.fadeInSeconds);
      const fadeOutSeconds = clampFade(duration, item.fadeOutSeconds);

      // Manual mode: use explicit startAt; Auto mode: use accumulated cursor
      const startAt = item.startAt !== undefined ? item.startAt : cursor;

      const segment: VisualSegment = {
        mediaId: item.mediaId,
        startAt: Number(startAt.toFixed(2)),
        endAt: Number((startAt + duration).toFixed(2)),
        fadeInSeconds,
        fadeOutSeconds,
        opacity:        item.opacity        ?? 1,
        brightness:     item.brightness     ?? 1,
        contrast:       item.contrast       ?? 1,
        saturation:     item.saturation     ?? 1,
        blur:           item.blur           ?? 0,
        videoVolume:    item.volume         ?? 1,
        transitionType: item.transitionType,
      };

      if (item.startAt === undefined) {
        // Overlap the next clip by fadeOutSeconds so the crossfade happens
        // simultaneously (outgoing fades out while incoming fades in).
        // If fadeOutSeconds is 0, no overlap — same as before.
        cursor += Math.max(0, duration - fadeOutSeconds);
      }

      return segment;
    });
}

function audioDurationFor(media: MediaItem[], mediaId: string) {
  return media.find((entry) => entry.id === mediaId)?.durationSeconds ?? 0;
}

function mediaBaseName(mediaId: string, media: MediaItem[]) {
  return (media.find((m) => m.id === mediaId)?.name ?? "")
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .trim();
}

/**
 * Splits an already-ordered timeline array into { loopItems, finalItem }.
 * finalItem is the last item ONLY when its media file is named "final"
 * (case-insensitive, no extension). Otherwise finalItem is null and loopItems
 * contains the full array.  Callers should loop only loopItems and then
 * append finalItem once at the very end to guarantee Final is always last.
 */
function splitFinalItem<T extends { mediaId: string }>(
  media: MediaItem[],
  items: T[],
): { loopItems: T[]; finalItem: T | null } {
  if (items.length <= 1) return { loopItems: items, finalItem: null };
  const last = items[items.length - 1];
  if (mediaBaseName(last.mediaId, media) === "final") {
    return { loopItems: items.slice(0, -1), finalItem: last };
  }
  return { loopItems: items, finalItem: null };
}

/**
 * Re-orders any timeline item array so that the item whose media file is named
 * "Intro" (case-insensitive, no extension) is always first and the one named
 * "Final" is always last. All other items keep their relative order between
 * those two anchors. Works for both audio and visual timeline items.
 * In manual mode the startAt times are preserved — only the array position and
 * the order field change.
 */
export function applyIntroFinalOrder<T extends { mediaId: string; order: number }>(
  media: MediaItem[],
  items: T[],
): T[] {
  if (items.length <= 1) return items;

  const baseName = (mediaId: string) =>
    (media.find((m) => m.id === mediaId)?.name ?? "")
      .replace(/\.[^.]+$/, "")
      .toLowerCase()
      .trim();

  const intro  = items.find((a) => baseName(a.mediaId) === "intro");
  const final_ = items.find((a) => baseName(a.mediaId) === "final");
  const rest   = items.filter((a) => a !== intro && a !== final_);

  const ordered = [
    ...(intro  ? [intro]  : []),
    ...rest,
    ...(final_ ? [final_] : []),
  ];

  return ordered.map((a, i) => ({ ...a, order: i }));
}

function calcGainDb(volumeFactor: number): number {
  return TARGET_GAIN_DB + 20 * Math.log10(Math.max(0.001, volumeFactor));
}

export function syncAudioToVideo(
  media: MediaItem[],
  audios: AudioTimelineItem[],
  targetVideoSeconds: number,
  crossfadeSeconds = DEFAULT_CROSSFADE_SECONDS,
): AudioSegment[] {
  if (!audios.length || targetVideoSeconds <= 0) {
    return [];
  }

  // Separate "Final" so it plays exactly once at the very end (not looped).
  const { loopItems: loopAudios, finalItem: finalAudio } = splitFinalItem(media, [...audios].sort((a, b) => a.order - b.order));
  const finalDuration = finalAudio ? audioDurationFor(media, finalAudio.mediaId) : 0;
  const mainTarget    = Math.max(0, targetVideoSeconds - finalDuration);
  const ordered       = loopAudios.length > 0 ? loopAudios : (finalAudio ? [] : [...audios].sort((a, b) => a.order - b.order));

  const segments: AudioSegment[] = [];
  let cursor = 0;
  let loopIndex = 0;

  while (cursor < mainTarget && ordered.length > 0) {
    const current = ordered[loopIndex % ordered.length];
    const sourceDuration = audioDurationFor(media, current.mediaId);
    if (!sourceDuration) {
      loopIndex += 1;
      if (loopIndex > ordered.length * 4 && !segments.length) break;
      continue;
    }

    const segmentStart    = Math.max(0, cursor - (segments.length > 0 ? crossfadeSeconds : 0));
    const remaining       = mainTarget - segmentStart;
    const plannedDuration = Math.min(sourceDuration, remaining);
    const isFirst         = segments.length === 0;

    segments.push({
      mediaId: current.mediaId,
      startAt: Number(segmentStart.toFixed(2)),
      endAt:   Number((segmentStart + plannedDuration).toFixed(2)),
      trimStart: 0,
      trimEnd:   Number(plannedDuration.toFixed(2)),
      fadeInSeconds:  isFirst ? DEFAULT_FADE_SECONDS : crossfadeSeconds,
      fadeOutSeconds: finalAudio  ? crossfadeSeconds : DEFAULT_FADE_SECONDS,
      gainDb: calcGainDb(current.volume ?? 1),
    });

    cursor = segmentStart + plannedDuration;
    loopIndex += 1;
    if (loopIndex > ordered.length * 16) break;
  }

  // Append Final once as the absolute last segment
  if (finalAudio && finalDuration > 0) {
    const prevEnd = segments.at(-1)?.endAt ?? 0;
    const startAt = Math.max(0, prevEnd - crossfadeSeconds);
    segments.push({
      mediaId:       finalAudio.mediaId,
      startAt:       Number(startAt.toFixed(2)),
      endAt:         Number((startAt + finalDuration).toFixed(2)),
      trimStart:     0,
      trimEnd:       finalDuration,
      fadeInSeconds:  crossfadeSeconds,
      fadeOutSeconds: DEFAULT_FADE_SECONDS,
      gainDb: calcGainDb((finalAudio as AudioTimelineItem).volume ?? 1),
    });
  }

  return segments;
}

// ─── Auto-mode helpers ────────────────────────────────────────────────────────

// Deterministic LCG seeded by a string — same clip ID → same random values.
// This keeps the timeline stable between re-renders without storing state.
function seededRng(seed: string): () => number {
  let h = 0;
  for (const ch of seed) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  return () => {
    h = (Math.imul(h, 1664525) + 1013904223) | 0;
    return (h >>> 0) / 0x100000000;
  };
}

function shuffleArray<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Duration if all auto-mode audio tracks play once through (no loops). */
function naturalAudioDuration(
  media: MediaItem[],
  audios: AudioTimelineItem[],
  crossfadeSeconds = DEFAULT_CROSSFADE_SECONDS,
): number {
  const ordered = [...audios]
    .filter((a) => a.startAt === undefined)
    .sort((a, b) => a.order - b.order);
  let cursor = 0;
  let seenSegments = 0;
  for (const a of ordered) {
    const dur = audioDurationFor(media, a.mediaId);
    if (!dur) continue;
    const start = seenSegments > 0 ? Math.max(0, cursor - crossfadeSeconds) : 0;
    cursor = start + dur;
    seenSegments++;
  }
  return Number(cursor.toFixed(2));
}

/** Append random repeats of the visual pool until segments cover `targetSeconds`. */
function appendFinalVisualSegment(
  media: MediaItem[],
  finalItem: VisualTimelineItem,
  segments: VisualSegment[],
): VisualSegment[] {
  const source   = media.find((m) => m.id === finalItem.mediaId);
  if (!source) return segments;
  const duration = source.kind === "video" ? source.durationSeconds : finalItem.durationSeconds;
  const fadeIn   = clampFade(duration, finalItem.fadeInSeconds);
  const fadeOut  = clampFade(duration, finalItem.fadeOutSeconds);
  const prev     = segments.at(-1);
  // Overlap by the previous clip's fadeOut so the crossfade is seamless
  const prevCursor = prev
    ? prev.startAt + Math.max(0, (prev.endAt - prev.startAt) - prev.fadeOutSeconds)
    : 0;
  const startAt = Number(Math.max(0, prevCursor - fadeIn).toFixed(2));
  return [...segments, {
    mediaId: finalItem.mediaId,
    startAt, endAt: Number((startAt + duration).toFixed(2)),
    fadeInSeconds: fadeIn, fadeOutSeconds: fadeOut,
    opacity:    finalItem.opacity    ?? 1,
    brightness: finalItem.brightness ?? 1,
    contrast:   finalItem.contrast   ?? 1,
    saturation: finalItem.saturation ?? 1,
    blur:       finalItem.blur       ?? 0,
    videoVolume: finalItem.volume    ?? 1,
    transitionType: finalItem.transitionType,
  }];
}

function extendVisualsToFillDuration(
  media: MediaItem[],
  pool: VisualTimelineItem[],
  existing: VisualSegment[],
  targetSeconds: number,
): VisualSegment[] {
  if (!pool.length || !existing.length) return existing;
  const segs = [...existing];
  const last = segs[segs.length - 1];
  const lastDur = last.endAt - last.startAt;
  // cursor = where the next clip should "start overlapping" from
  let cursor = last.startAt + Math.max(0, lastDur - last.fadeOutSeconds);
  let safety = 0;

  while (cursor < targetSeconds && safety < 2000) {
    const item = pool[Math.floor(Math.random() * pool.length)];
    const source = media.find((m) => m.id === item.mediaId);
    if (!source) break;
    const duration = source.kind === "video" ? source.durationSeconds : item.durationSeconds;
    const fadeIn  = clampFade(duration, item.fadeInSeconds);
    const fadeOut = clampFade(duration, item.fadeOutSeconds);
    const startAt = Number(Math.max(0, cursor - fadeOut).toFixed(2));
    const endAt   = Number((startAt + duration).toFixed(2));
    segs.push({
      mediaId:    item.mediaId,
      startAt, endAt, fadeInSeconds: fadeIn, fadeOutSeconds: fadeOut,
      opacity:    item.opacity    ?? 1,
      brightness: item.brightness ?? 1,
      contrast:   item.contrast   ?? 1,
      saturation: item.saturation ?? 1,
      blur:       item.blur       ?? 0,
      videoVolume: item.volume    ?? 1,
    });
    cursor = Number((startAt + Math.max(0, duration - fadeOut)).toFixed(2));
    safety++;
  }
  return segs;
}

function buildManualAudioSegments(
  media: MediaItem[],
  audios: AudioTimelineItem[],
): AudioSegment[] {
  return audios
    .filter((item) => item.startAt !== undefined)
    .map((item) => {
      const source = media.find((m) => m.id === item.mediaId);
      if (!source) return null;
      const startAt = item.startAt!;
      const duration = source.durationSeconds;
      return {
        mediaId: item.mediaId,
        startAt: Number(startAt.toFixed(2)),
        endAt: Number((startAt + duration).toFixed(2)),
        trimStart: 0,
        trimEnd: Number(duration.toFixed(2)),
        fadeInSeconds: DEFAULT_FADE_SECONDS,
        fadeOutSeconds: DEFAULT_FADE_SECONDS,
        gainDb: calcGainDb(item.volume ?? 1),
      } satisfies AudioSegment;
    })
    .filter((s): s is AudioSegment => s !== null);
}

export type AutoEnhancements = {
  colorGrade?: { brightness: number; contrast: number; saturation: number; blur: number };
  speedVariation?: boolean; // random 0.75/1.0/1.25× on video clips
  introOutro?: boolean;     // enforce 1 s fade-in on first clip, 1 s fade-out on last
};

export function summarizeComposition(
  media: MediaItem[],
  visuals: VisualTimelineItem[],
  audios: AudioTimelineItem[],
  mediaOrder: "sequential" | "random" = "sequential",
  musicalEvents: number[] = [],
  bpm = 0,
  beats: number[] = [],
  enhancements: AutoEnhancements = {},
): CompositionSummary {
  const hasManualAudio = audios.some((a) => a.startAt !== undefined);
  const sortedAudios   = applyIntroFinalOrder(media, audios);

  // ── Auto mode: randomised timing + optional music-driven sync ─────────────
  if (!hasManualAudio && visuals.some((v) => v.startAt === undefined)) {
    // 1. Order visuals (pin Intro first / Final last), then split Final out
    //    so it never enters the loop pool — it is appended once at the end.
    const baseVisuals = mediaOrder === "random"
      ? shuffleArray([...visuals])
      : [...visuals].sort((a, b) => a.order - b.order);
    const orderedVisuals = applyIntroFinalOrder(media, baseVisuals)
      .map((item, idx) => ({ ...item, order: idx }));
    const { loopItems: loopVisuals, finalItem: finalVisual } = splitFinalItem(media, orderedVisuals);

    const audioNatural = naturalAudioDuration(media, sortedAudios);
    let visualSegments: VisualSegment[];

    if (musicalEvents.length > 0) {
      // ── Music-driven layout: each clip fills one musical section ────────────
      const totalRef = audioNatural || 60;
      const sortedEvts = [...musicalEvents].sort((a, b) => a - b).filter((t) => t > 0 && t < totalRef);
      const boundaries = [0, ...sortedEvts, totalRef];

      const segs: VisualSegment[] = [];
      let overflowCursor = boundaries[boundaries.length - 1]; // for extra clips

      loopVisuals.forEach((item, idx) => {
        const source = media.find((m) => m.id === item.mediaId);
        if (!source) return;
        const rng = seededRng(item.mediaId + "auto");

        if (idx < boundaries.length - 1) {
          const sStart = boundaries[idx];
          const sEnd   = boundaries[idx + 1];
          const sDur   = sEnd - sStart;
          const isIntro = idx === 0 && mediaBaseName(item.mediaId, media) === "intro";
          // Intro plays fully — never truncated to the event window
          const clipDur = isIntro
            ? source.durationSeconds
            : (source.kind === "image" ? sDur : Math.min(source.durationSeconds, sDur));
          const fadeOut = clampFade(clipDur, Number((0.5 + rng() * 1.5).toFixed(1)));
          const fadeIn  = clampFade(clipDur, Number((0.3 + rng() * 0.9).toFixed(1)));
          segs.push({
            mediaId: item.mediaId,
            startAt: Number(sStart.toFixed(2)),
            endAt:   Number((sStart + clipDur).toFixed(2)),
            fadeInSeconds: fadeIn, fadeOutSeconds: fadeOut,
            opacity: item.opacity ?? 1, brightness: item.brightness ?? 1,
            contrast: item.contrast ?? 1, saturation: item.saturation ?? 1,
            blur: item.blur ?? 0, videoVolume: item.volume ?? 1,
          });
        } else {
          // Extra clips beyond the last event: append sequentially
          const dur = source.kind === "image"
            ? Number((2 + rng() * 5).toFixed(1))
            : source.durationSeconds;
          const fadeOut = clampFade(dur, Number((0.5 + rng() * 1.5).toFixed(1)));
          const fadeIn  = clampFade(dur, Number((0.3 + rng() * 0.9).toFixed(1)));
          const start   = Number(Math.max(0, overflowCursor - fadeOut).toFixed(2));
          segs.push({
            mediaId: item.mediaId,
            startAt: start,
            endAt:   Number((start + dur).toFixed(2)),
            fadeInSeconds: fadeIn, fadeOutSeconds: fadeOut,
            opacity: item.opacity ?? 1, brightness: item.brightness ?? 1,
            contrast: item.contrast ?? 1, saturation: item.saturation ?? 1,
            blur: item.blur ?? 0, videoVolume: item.volume ?? 1,
          });
          overflowCursor = Number((start + Math.max(0, dur - fadeOut)).toFixed(2));
        }
      });

      // Extend visuals to fill the full audio duration (loop clips as needed)
      if (audioNatural > 0 && segs.length > 0) {
        const lastEnd = Math.max(...segs.map((s) => s.endAt));
        if (audioNatural > lastEnd) {
          visualSegments = extendVisualsToFillDuration(
            media, loopVisuals.length > 0 ? loopVisuals : orderedVisuals, segs, audioNatural,
          );
        } else {
          visualSegments = segs;
        }
      } else {
        visualSegments = segs;
      }
    } else {
      const AUTO_TRANSITIONS: XfadeTransitionType[] = [
        "fade", "wipeleft", "slideleft", "dissolve", "smoothup", "wiperight", "slideright",
      ];

      // ── Beat-exact sync: position each clip to start at a beat timestamp ───
      if (beats.length >= 4 && bpm > 0) {
        const beatDur  = 60 / bpm;
        const halfBeat = Number((beatDur * 0.45).toFixed(3));
        const segs: VisualSegment[] = [];
        let beatIdx = 0;
        let gi = 0; // global clip index — cycles through loopVisuals indefinitely
        const beatPool = loopVisuals.length > 0 ? loopVisuals : orderedVisuals;

        // Loop through ALL beats, cycling clips so visuals never stop
        while (beatIdx < beats.length - 1) {
          const item   = beatPool[gi % beatPool.length];
          const source = media.find((m) => m.id === item.mediaId);
          gi++;
          if (!source) continue;

          const rng     = seededRng(item.mediaId + String(gi) + "beat");
          const rngT    = seededRng(item.mediaId + String(gi) + "trans");
          const nBeats  = [2, 4, 8][Math.floor(rng() * 3)];
          const nextIdx = Math.min(beatIdx + nBeats, beats.length - 1);

          const sStart  = beats[beatIdx];
          const sEnd    = beats[nextIdx];
          const sDur    = sEnd - sStart;
          if (sDur < 0.2) { beatIdx++; continue; }

          const isIntro = gi === 1 && mediaBaseName(item.mediaId, media) === "intro";
          // Intro plays fully — never truncated to the beat window
          const clipDur = isIntro
            ? source.durationSeconds
            : (source.kind === "image" ? sDur : Math.min(source.durationSeconds, sDur));
          const fadeOut = clampFade(clipDur, halfBeat);
          const fadeIn  = clampFade(clipDur, halfBeat);
          const tType   = AUTO_TRANSITIONS[Math.floor(rngT() * AUTO_TRANSITIONS.length)];

          segs.push({
            mediaId: item.mediaId,
            startAt:        Number(sStart.toFixed(2)),
            endAt:          Number((sStart + clipDur).toFixed(2)),
            fadeInSeconds:  fadeIn,
            fadeOutSeconds: fadeOut,
            opacity:     item.opacity    ?? 1,
            brightness:  item.brightness ?? 1,
            contrast:    item.contrast   ?? 1,
            saturation:  item.saturation ?? 1,
            blur:        item.blur       ?? 0,
            videoVolume: item.volume     ?? 1,
            transitionType: tType,
          });

          beatIdx = nextIdx;
        }

        visualSegments = segs;
      } else {
        // ── Pure random (no beats): random durations aligned to BPM multiples ─
        const beatDur = bpm > 0 ? 60 / bpm : 0;
        const randomizedVisuals = (loopVisuals.length > 0 ? loopVisuals : orderedVisuals).map((item) => {
          const source = media.find((m) => m.id === item.mediaId);
          if (!source) return item;
          const isIntro = mediaBaseName(item.mediaId, media) === "intro";
          const rng  = seededRng(item.mediaId + "auto");
          const rngT = seededRng(item.mediaId + "transition");
          const transitionType = AUTO_TRANSITIONS[Math.floor(rngT() * AUTO_TRANSITIONS.length)];
          if (source.kind === "image") {
            let dur: number;
            if (isIntro) {
              // Intro plays its full configured duration — never shortened
              dur = item.durationSeconds;
            } else if (beatDur > 0) {
              const nBeats = [2, 4, 8][Math.floor(rng() * 3)];
              dur = Math.max(1.5, Math.min(12, Number((nBeats * beatDur).toFixed(2))));
            } else {
              dur = Number((2 + rng() * 5).toFixed(1));
            }
            const fadeOut = clampFade(dur, Number((0.5 + rng() * 1.5).toFixed(1)));
            const fadeIn  = clampFade(dur, Number((0.3 + rng() * 0.9).toFixed(1)));
            return { ...item, durationSeconds: dur, fadeInSeconds: fadeIn, fadeOutSeconds: fadeOut, transitionType };
          } else {
            // Videos always use their full duration; Intro is no exception here
            const dur     = source.durationSeconds;
            const fadeOut = clampFade(dur, Number((0.5 + rng() * 1.5).toFixed(1)));
            const fadeIn  = clampFade(dur, Number((0.3 + rng() * 0.9).toFixed(1)));
            return { ...item, fadeInSeconds: fadeIn, fadeOutSeconds: fadeOut, transitionType };
          }
        });

        visualSegments = computeVisualSegments(media, randomizedVisuals);

        // If visuals shorter than audio, loop visuals randomly to fill
        const initialVideoEnd = visualSegments.length
          ? Math.max(...visualSegments.map((s) => s.endAt))
          : 0;
        if (audioNatural > initialVideoEnd && randomizedVisuals.length > 0) {
          visualSegments = extendVisualsToFillDuration(
            media, randomizedVisuals, visualSegments, audioNatural,
          );
        }
      }
    }

    // ── Post-processing enhancements ─────────────────────────────────────────

    // Speed variation: 0.75× / 1.0× / 1.25× on video clips (seeded per clip)
    const SPEED_OPTIONS = [0.75, 1.0, 1.0, 1.25] as const;
    if (enhancements.speedVariation && visualSegments.length > 0) {
      visualSegments = visualSegments.map((seg) => {
        const src = media.find((m) => m.id === seg.mediaId);
        if (src?.kind !== "video") return seg;
        const rngS = seededRng(seg.mediaId + seg.startAt + "speed");
        const speed = SPEED_OPTIONS[Math.floor(rngS() * SPEED_OPTIONS.length)];
        if (speed === 1) return seg;
        // Extend/compress endAt to match speed-adjusted duration
        const srcDur = seg.endAt - seg.startAt;
        return { ...seg, speed, endAt: Number((seg.startAt + srcDur / speed).toFixed(2)) };
      });
    }

    // Color grade: override segment visual values with preset
    if (enhancements.colorGrade && visualSegments.length > 0) {
      const cg = enhancements.colorGrade;
      visualSegments = visualSegments.map((seg) => ({
        ...seg,
        brightness: cg.brightness,
        contrast:   cg.contrast,
        saturation: cg.saturation,
        blur:       cg.blur,
      }));
    }

    // Intro / outro: enforce 1 s fades on first and last segment
    if (enhancements.introOutro && visualSegments.length > 0) {
      const FADE = 1.0;
      const first = visualSegments[0];
      const last  = visualSegments[visualSegments.length - 1];
      visualSegments[0] = {
        ...first,
        fadeInSeconds: Math.max(first.fadeInSeconds, Math.min(FADE, (first.endAt - first.startAt) / 2)),
      };
      if (visualSegments.length > 1) {
        const lastDur = last.endAt - last.startAt;
        visualSegments[visualSegments.length - 1] = {
          ...last,
          fadeOutSeconds: Math.max(last.fadeOutSeconds, Math.min(FADE, lastDur / 2)),
        };
      }
    }

    // Append Final visual once at the very end (never looped)
    if (finalVisual) {
      visualSegments = appendFinalVisualSegment(media, finalVisual, visualSegments);
    }

    const totalVideoSeconds = Number(
      (visualSegments.length ? Math.max(...visualSegments.map((s) => s.endAt)) : 0).toFixed(2),
    );

    const audioSegments = syncAudioToVideo(media, sortedAudios, totalVideoSeconds);
    const totalAudioSeconds = Number(
      (audioSegments.length ? Math.max(...audioSegments.map((s) => s.endAt)) : 0).toFixed(2),
    );

    return {
      totalVideoSeconds,
      totalAudioSeconds,
      visualSegments,
      audioSegments,
      crossfadeSeconds: DEFAULT_CROSSFADE_SECONDS,
      normalizedTargetDb: TARGET_GAIN_DB,
      peakLimitDb: PEAK_LIMIT_DB,
    };
  }

  // ── Manual / mixed mode ────────────────────────────────────────────────────
  const sortedVisuals  = applyIntroFinalOrder(media, visuals);
  const visualSegments = computeVisualSegments(media, sortedVisuals);
  const totalVideoSeconds = Number(
    (visualSegments.length ? Math.max(...visualSegments.map((s) => s.endAt)) : 0).toFixed(2),
  );

  const audioSegments = hasManualAudio
    ? buildManualAudioSegments(media, sortedAudios)
    : syncAudioToVideo(media, sortedAudios, totalVideoSeconds);

  const totalAudioSeconds = Number(
    (audioSegments.length ? Math.max(...audioSegments.map((s) => s.endAt)) : 0).toFixed(2),
  );

  return {
    totalVideoSeconds,
    totalAudioSeconds,
    visualSegments,
    audioSegments,
    crossfadeSeconds: DEFAULT_CROSSFADE_SECONDS,
    normalizedTargetDb: TARGET_GAIN_DB,
    peakLimitDb: PEAK_LIMIT_DB,
  };
}

export function secondsLabel(value: number) {
  return `${value.toFixed(value % 1 === 0 ? 0 : 1)}s`;
}
