import { describe, expect, it } from "vitest";

import {
  computeVisualSegments,
  summarizeComposition,
  syncAudioToVideo,
  validateMediaFile,
} from "@/lib/media-rules";
import type { AudioTimelineItem, MediaItem, VisualTimelineItem } from "@/lib/types";

const media: MediaItem[] = [
  {
    id: "img-1",
    name: "cover.jpg",
    kind: "image",
    format: "jpg",
    sizeBytes: 1024,
    durationSeconds: 3,
    valid: true,
    issues: [],
  },
  {
    id: "vid-1",
    name: "scene.mp4",
    kind: "video",
    format: "mp4",
    sizeBytes: 1024,
    durationSeconds: 5,
    valid: true,
    issues: [],
  },
  {
    id: "aud-1",
    name: "theme.mp3",
    kind: "audio",
    format: "mp3",
    sizeBytes: 1024,
    durationSeconds: 4,
    valid: true,
    issues: [],
  },
];

const visuals: VisualTimelineItem[] = [
  { id: "v1", mediaId: "img-1", kind: "image", order: 0, durationSeconds: 4, fadeInSeconds: 1, fadeOutSeconds: 1 },
  { id: "v2", mediaId: "vid-1", kind: "video", order: 1, durationSeconds: 4, fadeInSeconds: 1, fadeOutSeconds: 1 },
];

const audios: AudioTimelineItem[] = [{ id: "a1", mediaId: "aud-1", order: 0 }];

describe("validateMediaFile", () => {
  it("rejeita formatos nao suportados", () => {
    const result = validateMediaFile("arquivo.psd", 1000, 1000);
    expect(result.valid).toBe(false);
    expect(result.issues).toContain("invalid-format");
  });

  it("rejeita arquivo acima do limite", () => {
    const result = validateMediaFile("clip.mp4", 600 * 1024 * 1024, 600 * 1024 * 1024, "video/mp4");
    expect(result.issues).toContain("file-too-large");
  });
});

describe("computeVisualSegments", () => {
  it("preserva a duracao original de videos e usa duracao customizada de imagens", () => {
    const segments = computeVisualSegments(media, visuals);
    expect(segments[0]).toMatchObject({ startAt: 0, endAt: 4 });
    expect(segments[1]).toMatchObject({ startAt: 4, endAt: 9 });
  });
});

describe("syncAudioToVideo", () => {
  it("repete trilhas ate preencher a duracao do video", () => {
    const segments = syncAudioToVideo(media, audios, 9);
    expect(segments.length).toBeGreaterThan(1);
    expect(segments[segments.length - 1].endAt).toBe(9);
  });
});

describe("summarizeComposition", () => {
  it("gera resumo com crossfade e nivelamento esperados", () => {
    const summary = summarizeComposition(media, visuals, audios);
    expect(summary.totalVideoSeconds).toBe(9);
    expect(summary.totalAudioSeconds).toBe(9);
    expect(summary.crossfadeSeconds).toBe(2);
    expect(summary.normalizedTargetDb).toBe(-14);
  });
});
