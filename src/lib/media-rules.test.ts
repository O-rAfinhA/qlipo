import { describe, expect, it } from "vitest";

import {
  applyIntroFinalOrder,
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

// ─── applyIntroFinalOrder ─────────────────────────────────────────────────────

const mkAudioMedia = (id: string, name: string, dur = 10): MediaItem => ({
  id, name, kind: "audio", format: name.split(".").pop()!, sizeBytes: 1024,
  durationSeconds: dur, valid: true, issues: [],
});
const mkAudio = (id: string, mediaId: string, order: number): AudioTimelineItem => ({ id, mediaId, order });

describe("applyIntroFinalOrder", () => {
  const introMedia  = mkAudioMedia("m-intro",  "Intro.mp3");
  const finalMedia  = mkAudioMedia("m-final",  "Final.mp3");
  const track2Media = mkAudioMedia("m-track2", "track2.mp3");
  const track3Media = mkAudioMedia("m-track3", "track3.mp3");

  const introTrack  = mkAudio("a-intro",  "m-intro",  3);
  const finalTrack  = mkAudio("a-final",  "m-final",  0);
  const track2      = mkAudio("a-track2", "m-track2", 1);
  const track3      = mkAudio("a-track3", "m-track3", 2);

  const allMedia    = [introMedia, finalMedia, track2Media, track3Media];

  it("nao altera a lista com apenas uma faixa", () => {
    const result = applyIntroFinalOrder([introMedia], [introTrack]);
    expect(result.map((a) => a.mediaId)).toEqual(["m-intro"]);
  });

  it("coloca Intro primeiro e Final por ultimo (ambas presentes)", () => {
    // Input order: Final, track2, Intro, track3
    const input = [finalTrack, track2, introTrack, track3];
    const result = applyIntroFinalOrder(allMedia, input);
    expect(result.map((a) => a.mediaId)).toEqual(["m-intro", "m-track2", "m-track3", "m-final"]);
  });

  it("coloca Intro primeiro quando apenas ela existe", () => {
    const input = [track3, introTrack, track2];
    const result = applyIntroFinalOrder(
      [introMedia, track2Media, track3Media], input,
    );
    expect(result.map((a) => a.mediaId)).toEqual(["m-intro", "m-track3", "m-track2"]);
  });

  it("coloca Final por ultimo quando apenas ela existe", () => {
    const input = [finalTrack, track2, track3];
    const result = applyIntroFinalOrder(
      [finalMedia, track2Media, track3Media], input,
    );
    expect(result.map((a) => a.mediaId)).toEqual(["m-track2", "m-track3", "m-final"]);
  });

  it("nao altera a ordem quando nem Intro nem Final existem", () => {
    const input = [track3, track2];
    const result = applyIntroFinalOrder([track3Media, track2Media], input);
    expect(result.map((a) => a.mediaId)).toEqual(["m-track3", "m-track2"]);
  });

  it("re-indexa os campos order apos reordenacao", () => {
    const input = [finalTrack, track2, introTrack, track3];
    const result = applyIntroFinalOrder(allMedia, input);
    result.forEach((a, i) => expect(a.order).toBe(i));
  });

  it("e case-insensitive para os nomes intro e final", () => {
    const introLower = mkAudioMedia("m-il", "intro.mp3");
    const finalUpper = mkAudioMedia("m-fu", "FINAL.wav");
    const a1 = mkAudio("a-il", "m-il", 1);
    const a2 = mkAudio("a-fu", "m-fu", 0);
    const other = mkAudio("a-other", "m-track2", 2);
    const result = applyIntroFinalOrder([introLower, finalUpper, track2Media], [a2, other, a1]);
    expect(result[0].mediaId).toBe("m-il");
    expect(result[result.length - 1].mediaId).toBe("m-fu");
  });
});

// Integration: verify applyIntroFinalOrder feeds correctly into syncAudioToVideo
describe("summarizeComposition — ordenacao Intro/Final (integracao via syncAudioToVideo)", () => {
  const introMedia  = mkAudioMedia("m-intro",  "Intro.mp3",   8);
  const finalMedia  = mkAudioMedia("m-final",  "Final.mp3",   8);
  const track2Media = mkAudioMedia("m-track2", "track2.mp3",  8);
  const track3Media = mkAudioMedia("m-track3", "track3.mp3",  8);

  // Use a video duration that fits exactly one cycle (no looping back to start)
  // 3 tracks * 8s - 2 crossfades * 2s = 20s
  const VIDEO_DUR = 20;
  const CROSSFADE  = 0; // disable crossfade to keep segments clean

  function uniqueIds(segments: { mediaId: string }[]) {
    const seen = new Set<string>();
    return segments.filter((s) => !seen.has(s.mediaId) && seen.add(s.mediaId)).map((s) => s.mediaId);
  }

  it("modo auto: Intro primeiro, Final ultimo (ambas presentes)", () => {
    const inputAudios = [
      mkAudio("a-final",  "m-final",  0),
      mkAudio("a-track2", "m-track2", 1),
      mkAudio("a-intro",  "m-intro",  2),
    ];
    const allMedia  = [introMedia, finalMedia, track2Media];
    const sorted    = applyIntroFinalOrder(allMedia, inputAudios);
    const segments  = syncAudioToVideo(allMedia, sorted, VIDEO_DUR, CROSSFADE);
    const ids       = uniqueIds(segments);
    expect(ids[0]).toBe("m-intro");
    expect(ids[ids.length - 1]).toBe("m-final");
    expect(ids).toContain("m-track2");
  });

  it("modo auto: apenas Intro — fica primeiro", () => {
    const inputAudios = [mkAudio("a-track2", "m-track2", 0), mkAudio("a-intro", "m-intro", 1)];
    const allMedia    = [introMedia, track2Media];
    const sorted      = applyIntroFinalOrder(allMedia, inputAudios);
    const segments    = syncAudioToVideo(allMedia, sorted, 14, CROSSFADE);
    expect(uniqueIds(segments)[0]).toBe("m-intro");
  });

  it("modo auto: apenas Final — fica ultimo na primeira passagem", () => {
    const inputAudios = [mkAudio("a-final", "m-final", 0), mkAudio("a-track2", "m-track2", 1)];
    const allMedia    = [finalMedia, track2Media];
    const sorted      = applyIntroFinalOrder(allMedia, inputAudios);
    const segments    = syncAudioToVideo(allMedia, sorted, 14, CROSSFADE);
    const ids         = uniqueIds(segments);
    expect(ids[0]).toBe("m-track2");
    expect(ids[ids.length - 1]).toBe("m-final");
  });

  it("modo auto: sem Intro nem Final — ordem original nao e alterada", () => {
    const inputAudios = [mkAudio("a-track2", "m-track2", 0), mkAudio("a-track3", "m-track3", 1)];
    const allMedia    = [track2Media, track3Media];
    const sorted      = applyIntroFinalOrder(allMedia, inputAudios);
    const segments    = syncAudioToVideo(allMedia, sorted, 14, CROSSFADE);
    const ids         = uniqueIds(segments);
    expect(ids[0]).toBe("m-track2");
    expect(ids[1]).toBe("m-track3");
  });

  it("modo manual: startAt preservados, ordenacao por posicao no tempo", () => {
    // In manual mode startAt controls position — our ordering just re-indexes order field
    const inputAudios = [
      { ...mkAudio("a-final",  "m-final",  0), startAt: 0  },
      { ...mkAudio("a-track2", "m-track2", 1), startAt: 10 },
      { ...mkAudio("a-intro",  "m-intro",  2), startAt: 20 },
    ];
    const allMedia = [introMedia, finalMedia, track2Media];
    const sorted   = applyIntroFinalOrder(allMedia, inputAudios);
    // After ordering: [intro(startAt=20), track2(startAt=10), final(startAt=0)]
    // Sorted by startAt for playback: final=0, track2=10, intro=20
    const byTime = [...sorted].sort((a, b) => (a.startAt ?? 0) - (b.startAt ?? 0));
    expect(byTime[0].mediaId).toBe("m-final");   // startAt=0 preserved
    expect(byTime[1].mediaId).toBe("m-track2");  // startAt=10 preserved
    expect(byTime[2].mediaId).toBe("m-intro");   // startAt=20 preserved
  });
});

// ─── applyIntroFinalOrder — visuais ───────────────────────────────────────────

const mkVisualMedia = (id: string, name: string, dur = 5): MediaItem => ({
  id, name, kind: "video", format: name.split(".").pop()!, sizeBytes: 1024,
  durationSeconds: dur, valid: true, issues: [],
});
const mkVisual = (id: string, mediaId: string, order: number): VisualTimelineItem => ({
  id, mediaId, kind: "video", order, durationSeconds: 5, fadeInSeconds: 0, fadeOutSeconds: 0,
});

describe("applyIntroFinalOrder — visuais", () => {
  const introVid  = mkVisualMedia("mv-intro",  "Intro.mp4");
  const finalVid  = mkVisualMedia("mv-final",  "Final.mp4");
  const clip2     = mkVisualMedia("mv-clip2",  "clip2.mp4");
  const clip3     = mkVisualMedia("mv-clip3",  "clip3.mp4");

  const introClip = mkVisual("vt-intro", "mv-intro", 3);
  const finalClip = mkVisual("vt-final", "mv-final", 0);
  const clip2Item = mkVisual("vt-clip2", "mv-clip2", 1);
  const clip3Item = mkVisual("vt-clip3", "mv-clip3", 2);

  const allMedia = [introVid, finalVid, clip2, clip3];

  it("coloca Intro primeiro e Final por ultimo (ambas presentes)", () => {
    const result = applyIntroFinalOrder(allMedia, [finalClip, clip2Item, introClip, clip3Item]);
    expect(result.map((v) => v.mediaId)).toEqual(["mv-intro", "mv-clip2", "mv-clip3", "mv-final"]);
  });

  it("coloca Intro primeiro quando apenas ela existe", () => {
    const result = applyIntroFinalOrder([introVid, clip2, clip3], [clip3Item, introClip, clip2Item]);
    expect(result[0].mediaId).toBe("mv-intro");
    expect(result.map((v) => v.mediaId)).not.toContain("mv-final");
  });

  it("coloca Final por ultimo quando apenas ela existe", () => {
    const result = applyIntroFinalOrder([finalVid, clip2, clip3], [finalClip, clip2Item, clip3Item]);
    expect(result[result.length - 1].mediaId).toBe("mv-final");
    expect(result[0].mediaId).not.toBe("mv-final");
  });

  it("nao altera a ordem quando nem Intro nem Final existem", () => {
    const result = applyIntroFinalOrder([clip2, clip3], [clip3Item, clip2Item]);
    expect(result.map((v) => v.mediaId)).toEqual(["mv-clip3", "mv-clip2"]);
  });

  it("re-indexa os campos order apos reordenacao", () => {
    const result = applyIntroFinalOrder(allMedia, [finalClip, clip2Item, introClip, clip3Item]);
    result.forEach((v, i) => expect(v.order).toBe(i));
  });
});

describe("summarizeComposition — ordenacao Intro/Final visuais (auto mode)", () => {
  const introVid  = mkVisualMedia("mv-intro",  "Intro.mp4",  5);
  const finalVid  = mkVisualMedia("mv-final",  "Final.mp4",  5);
  const clip2     = mkVisualMedia("mv-clip2",  "clip2.mp4",  5);
  const audioMed  = mkAudioMedia ("ma-theme",  "theme.mp3",  60);
  const audioItem: AudioTimelineItem = { id: "at-1", mediaId: "ma-theme", order: 0 };

  const mkV = (id: string, mediaId: string, order: number): VisualTimelineItem => ({
    id, mediaId, kind: "video", order, durationSeconds: 5, fadeInSeconds: 0, fadeOutSeconds: 0,
  });

  it("modo auto: Intro primeiro, Final ultimo (ambas presentes)", () => {
    const visualsInput = [
      mkV("vt-final", "mv-final", 0),
      mkV("vt-clip2", "mv-clip2", 1),
      mkV("vt-intro", "mv-intro", 2),
    ];
    const summary = summarizeComposition(
      [introVid, finalVid, clip2, audioMed],
      visualsInput, [audioItem],
    );
    const ids = summary.visualSegments.map((s) => s.mediaId);
    expect(ids[0]).toBe("mv-intro");
    expect(ids[ids.length - 1]).toBe("mv-final");
    expect(ids).toContain("mv-clip2");
  });

  it("modo auto: apenas Intro — fica primeiro", () => {
    const visualsInput = [mkV("vt-clip2", "mv-clip2", 0), mkV("vt-intro", "mv-intro", 1)];
    const summary = summarizeComposition(
      [introVid, clip2, audioMed], visualsInput, [audioItem],
    );
    expect(summary.visualSegments[0].mediaId).toBe("mv-intro");
  });

  it("modo auto: apenas Final — fica ultimo", () => {
    const visualsInput = [mkV("vt-final", "mv-final", 0), mkV("vt-clip2", "mv-clip2", 1)];
    const summary = summarizeComposition(
      [finalVid, clip2, audioMed], visualsInput, [audioItem],
    );
    const ids = summary.visualSegments.map((s) => s.mediaId);
    // Final should be last before any looping repeats
    const lastFinalIdx  = ids.lastIndexOf("mv-final");
    const lastOtherIdx  = ids.lastIndexOf("mv-clip2");
    expect(lastFinalIdx).toBeGreaterThan(lastOtherIdx < lastFinalIdx ? -1 : lastOtherIdx);
    expect(ids[0]).toBe("mv-clip2");
  });

  it("modo auto: sem Intro nem Final — ordem original preservada", () => {
    const visualsInput = [mkV("vt-final", "mv-final", 1), mkV("vt-clip2", "mv-clip2", 0)];
    // Rename so neither matches intro/final
    const renamedFinal = { ...finalVid, name: "sceneB.mp4" };
    const summary = summarizeComposition(
      [renamedFinal, clip2, audioMed], visualsInput, [audioItem],
    );
    // clip2 has lower order so it should come first
    expect(summary.visualSegments[0].mediaId).toBe("mv-clip2");
  });
});
