'use client';

import clsx from "clsx";
import {
  AUDIO_BITRATE,
  AUDIO_QUALITY_LABELS,
  CODEC_CRF,
  CODEC_LABELS,
  FRAME_RATE_LABELS,
  QUALITY_LABELS,
  type AudioQualityLevel,
  type FrameRate,
  type OutputOptions,
  type VideoCodec,
  type VideoQualityLevel,
} from "@/lib/types";

// Estimated file size helper (very rough: bitrate × duration ÷ 8 = bytes)
function estimateFileSizeMB(
  opts: OutputOptions,
  totalSeconds: number,
): string {
  if (totalSeconds <= 0) return "—";
  const crf      = CODEC_CRF[opts.codec][opts.quality];
  // rough video bitrate heuristic from CRF (lower CRF = higher bitrate)
  const videoBps = Math.round(12_000_000 / Math.pow(1.28, crf - 10));
  const audioBps = AUDIO_BITRATE[opts.audioQuality] * 1000;
  const bytes    = (videoBps + audioBps) * totalSeconds / 8;
  const mb       = bytes / (1024 * 1024);
  return mb < 1000 ? `~${mb.toFixed(0)} MB` : `~${(mb / 1024).toFixed(1)} GB`;
}

type Props = {
  options: OutputOptions;
  totalSeconds: number;
  onChange: (patch: Partial<OutputOptions>) => void;
};

const CODECS: VideoCodec[]          = ["h264", "h265", "vp9"];
const QUALITIES: VideoQualityLevel[] = ["low", "medium", "high", "very_high"];
const FRAME_RATES: FrameRate[]       = [24, 30, 60];
const AUDIO_LEVELS: AudioQualityLevel[] = ["standard", "high", "studio"];

export function OutputOptionsPanel({ options, totalSeconds, onChange }: Props) {
  const ext    = CODEC_LABELS[options.codec].ext;
  const sizeMB = estimateFileSizeMB(options, totalSeconds);

  return (
    <div className="space-y-4">

      {/* ── Codec ─────────────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-700">Codec de vídeo</p>
        <div className="space-y-1">
          {CODECS.map((codec) => {
            const info     = CODEC_LABELS[codec];
            const isActive = options.codec === codec;
            return (
              <button
                key={codec}
                type="button"
                onClick={() => onChange({ codec })}
                className={clsx(
                  "flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-all duration-150",
                  isActive
                    ? "border-white/[0.14] bg-white/[0.07]"
                    : "border-white/[0.04] hover:border-white/[0.08] hover:bg-white/[0.02]",
                )}
              >
                <span className={clsx(
                  "shrink-0 w-12 rounded px-1.5 py-0.5 text-center text-[10px] font-bold tracking-wide",
                  isActive ? "bg-white/10 text-white" : "bg-white/[0.04] text-zinc-600",
                )}>
                  {info.name}
                </span>
                <span className={clsx("flex-1 text-[10px]", isActive ? "text-zinc-300" : "text-zinc-600")}>
                  {info.note}
                </span>
                <span className={clsx("text-[9px] font-mono", isActive ? "text-zinc-500" : "text-zinc-700")}>
                  .{info.ext}
                </span>
                {isActive && <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-white/40" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Quality ───────────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-700">Qualidade de vídeo</p>
        <div className="grid grid-cols-2 gap-1">
          {QUALITIES.map((q) => {
            const info     = QUALITY_LABELS[q];
            const crf      = CODEC_CRF[options.codec][q];
            const isActive = options.quality === q;
            return (
              <button
                key={q}
                type="button"
                onClick={() => onChange({ quality: q })}
                className={clsx(
                  "flex flex-col gap-0.5 rounded-lg border p-2.5 text-left transition-all duration-150",
                  isActive
                    ? "border-white/[0.14] bg-white/[0.07]"
                    : "border-white/[0.04] hover:border-white/[0.08] hover:bg-white/[0.02]",
                )}
              >
                <span className={clsx("text-[10px] font-medium", isActive ? "text-zinc-200" : "text-zinc-600")}>
                  {info.name}
                </span>
                <span className="text-[9px] text-zinc-700">CRF {crf}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Frame rate ────────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-700">Taxa de quadros</p>
        <div className="flex rounded-lg overflow-hidden border border-white/[0.06]">
          {FRAME_RATES.map((fps, i) => {
            const isActive = options.fps === fps;
            return (
              <button
                key={fps}
                type="button"
                onClick={() => onChange({ fps })}
                className={clsx(
                  "flex-1 py-1.5 text-[10px] font-medium transition-all duration-150",
                  i > 0 && "border-l border-white/[0.06]",
                  isActive
                    ? "bg-white/[0.10] text-zinc-200"
                    : "text-zinc-600 hover:bg-white/[0.03] hover:text-zinc-400",
                )}
              >
                {fps} fps
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Audio quality ─────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-700">Qualidade de áudio</p>
        <div className="flex rounded-lg overflow-hidden border border-white/[0.06]">
          {AUDIO_LEVELS.map((level, i) => {
            const info     = AUDIO_QUALITY_LABELS[level];
            const isActive = options.audioQuality === level;
            return (
              <button
                key={level}
                type="button"
                onClick={() => onChange({ audioQuality: level })}
                className={clsx(
                  "flex flex-1 flex-col items-center py-1.5 transition-all duration-150",
                  i > 0 && "border-l border-white/[0.06]",
                  isActive
                    ? "bg-white/[0.10] text-zinc-200"
                    : "text-zinc-600 hover:bg-white/[0.03] hover:text-zinc-400",
                )}
              >
                <span className="text-[10px] font-medium">{info.name}</span>
                <span className="text-[9px] text-zinc-700">{info.bitrate}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Summary bar ───────────────────────────────────────────── */}
      <div className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
        <div className="flex items-center gap-2 text-[10px] text-zinc-600">
          <span className="font-mono">.{ext}</span>
          <span>·</span>
          <span>{QUALITY_LABELS[options.quality].name}</span>
          <span>·</span>
          <span>{options.fps} fps</span>
          <span>·</span>
          <span>{AUDIO_QUALITY_LABELS[options.audioQuality].bitrate}</span>
        </div>
        <span className="text-[10px] font-mono text-zinc-500">{sizeMB}</span>
      </div>

      {options.codec === "h265" && (
        <p className="text-[9px] leading-relaxed text-amber-400/60">
          H.265 tem suporte limitado em navegadores. O arquivo funcionará em players de desktop.
        </p>
      )}
    </div>
  );
}
