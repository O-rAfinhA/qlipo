export type MediaKind = "image" | "video" | "audio";

export type ExportPreset = "reels_9_16" | "landscape_16_9" | "square_1_1";

export type ValidationIssue =
  | "invalid-format"
  | "file-too-large"
  | "project-too-large";

export type MediaValidation = {
  valid: boolean;
  issues: ValidationIssue[];
};

export type MediaItem = {
  id: string;
  name: string;
  kind: MediaKind;
  format: string;
  sizeBytes: number;
  durationSeconds: number;
  previewUrl?: string;
  serverPath?: string;
  r2Key?: string;
  width?: number;
  height?: number;
  valid: boolean;
  issues: ValidationIssue[];
};

export type XfadeTransitionType =
  | "fade" | "wipeleft" | "wiperight" | "wipeup" | "wipedown"
  | "slideleft" | "slideright" | "dissolve" | "smoothup" | "radial";

export const XFADE_TRANSITION_LABELS: Record<XfadeTransitionType, string> = {
  fade:       "Fade",
  wipeleft:   "Wipe ←",
  wiperight:  "Wipe →",
  wipeup:     "Wipe ↑",
  wipedown:   "Wipe ↓",
  slideleft:  "Slide ←",
  slideright: "Slide →",
  dissolve:   "Dissolve",
  smoothup:   "Smooth ↑",
  radial:     "Radial",
};

export type VisualTimelineItem = {
  id: string;
  mediaId: string;
  kind: "image" | "video";
  order: number;
  durationSeconds: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
  startAt?: number;
  volume?: number;
  opacity?: number;
  brightness?: number;
  contrast?: number;
  saturation?: number;
  blur?: number;
  transitionType?: XfadeTransitionType;
};

export type AudioTimelineItem = {
  id: string;
  mediaId: string;
  order: number;
  startAt?: number;
  volume?: number;
};

export type AudioSegment = {
  mediaId: string;
  startAt: number;
  endAt: number;
  trimStart: number;
  trimEnd: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
  gainDb: number;
};

export type VisualSegment = {
  mediaId: string;
  startAt: number;
  endAt: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
  opacity?: number;
  brightness?: number;
  contrast?: number;
  saturation?: number;
  blur?: number;
  videoVolume?: number;
  transitionType?: XfadeTransitionType;
  speed?: number; // playback speed: 0.75 = slow-mo, 1.0 = normal, 1.25 = fast
};

export type CompositionSummary = {
  totalVideoSeconds: number;
  totalAudioSeconds: number;
  visualSegments: VisualSegment[];
  audioSegments: AudioSegment[];
  crossfadeSeconds: number;
  normalizedTargetDb: number;
  peakLimitDb: number;
};

export type UploadValidationResponse = {
  totalBytesProject: number;
  files: Array<{
    name: string;
    detectedCategory: MediaKind | "unknown";
    valid: boolean;
    issues: ValidationIssue[];
  }>;
};

// ─── Output options ───────────────────────────────────────────────────────────

export type VideoCodec = "h264" | "h265" | "vp9";
export type VideoQualityLevel = "low" | "medium" | "high" | "very_high";
export type FrameRate = 24 | 30 | 60;
export type AudioQualityLevel = "standard" | "high" | "studio";

export type OutputOptions = {
  codec: VideoCodec;
  quality: VideoQualityLevel;
  fps: FrameRate;
  audioQuality: AudioQualityLevel;
};

export const DEFAULT_OUTPUT_OPTIONS: OutputOptions = {
  codec:        "h264",
  quality:      "high",
  fps:          30,
  audioQuality: "high",
};

// CRF values per codec per quality level
export const CODEC_CRF: Record<VideoCodec, Record<VideoQualityLevel, number>> = {
  h264: { low: 28, medium: 23, high: 18, very_high: 14 },
  h265: { low: 32, medium: 28, high: 22, very_high: 18 },
  vp9:  { low: 36, medium: 30, high: 24, very_high: 18 },
};

// Audio bitrate (kbps) per quality level
export const AUDIO_BITRATE: Record<AudioQualityLevel, number> = {
  standard: 128,
  high:     192,
  studio:   320,
};

export const CODEC_LABELS: Record<VideoCodec, { name: string; ext: string; note?: string }> = {
  h264: { name: "H.264",  ext: "mp4",  note: "Máxima compatibilidade" },
  h265: { name: "H.265",  ext: "mp4",  note: "Arquivo menor (~50%)" },
  vp9:  { name: "VP9",    ext: "webm", note: "Código aberto" },
};

export const QUALITY_LABELS: Record<VideoQualityLevel, { name: string; desc: string }> = {
  low:       { name: "Baixa",         desc: "Arquivo menor, qualidade reduzida" },
  medium:    { name: "Média",         desc: "Equilíbrio tamanho × qualidade" },
  high:      { name: "Alta",          desc: "Boa qualidade para publicação" },
  very_high: { name: "Muito alta",    desc: "Quase sem perdas" },
};

export const AUDIO_QUALITY_LABELS: Record<AudioQualityLevel, { name: string; bitrate: string }> = {
  standard: { name: "Padrão",  bitrate: "128 kbps" },
  high:     { name: "Alta",    bitrate: "192 kbps" },
  studio:   { name: "Studio",  bitrate: "320 kbps" },
};

export const FRAME_RATE_LABELS: Record<number, string> = {
  24: "24 fps — Cinema",
  30: "30 fps — Padrão",
  60: "60 fps — Fluido",
};

export type RenderStage =
  | "preparando"
  | "montando_video"
  | "processando_audio"
  | "muxando"
  | "finalizado"
  | "erro";

export type TextAnimationType = "none" | "fade" | "slide-up";

export type TextOverlay = {
  id: string;
  text: string;
  startAt: number;
  endAt: number;
  x: number;           // % 0–100
  y: number;           // % 0–100
  fontSize: number;    // px
  color: string;       // CSS color
  fontWeight: "normal" | "bold";
  animation: TextAnimationType;
};

export type WatermarkPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";

export type Watermark = {
  id: string;
  mediaId: string;
  imageUrl?: string;
  imageData?: string;
  size: number;              // 5-50, percentage of video width
  opacity: number;           // 10-100, percentage
  position: WatermarkPosition;
  startAt: number;           // Seconds
  endAt: number;             // Seconds
  fadeInDuration: number;    // Min 0.5s
  fadeOutDuration: number;   // Min 0.5s
};

export type RenderRequest = {
  preset: ExportPreset;
  media: MediaItem[];
  visuals: VisualTimelineItem[];
  audios: AudioTimelineItem[];
  mediaOrder: "sequential" | "random";
  bpm?: number;
  outputOptions?: OutputOptions;
  textOverlays?: TextOverlay[];
  watermarks?: Watermark[];
};

export type RenderJob = {
  jobId: string;
  stage: RenderStage;
  progress: number;
  message: string;
  startedAt: number;
  completedAt?: number;
  downloadUrl?: string;
  summary: CompositionSummary;
  mode: "simulation" | "ffmpeg";
};
