'use client';

import clsx from "clsx";
import { Maximize2, Minimize2, Pause, Play, SkipBack } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { getVideoPreviewUrl } from "@/lib/media-preview-url";
import type { AudioSegment, MediaItem, TextOverlay, VisualSegment, Watermark } from "@/lib/types";
import { TextOverlayLayer } from "@/components/text-overlay-layer";
import { WatermarkPreviewLayer } from "@/components/watermark-preview-layer";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(t: number): string {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = t % 60;
  return m > 0
    ? `${m}:${String(Math.floor(s)).padStart(2, "0")}`
    : `${s.toFixed(1)}s`;
}

type Fadeable = { startAt: number; endAt: number; fadeInSeconds: number; fadeOutSeconds: number };

function calcFadeOpacity(t: number, seg: Fadeable): number {
  const local = t - seg.startAt;
  const dur   = seg.endAt - seg.startAt;
  if (seg.fadeInSeconds  > 0 && local < seg.fadeInSeconds)        return Math.max(0, local / seg.fadeInSeconds);
  if (seg.fadeOutSeconds > 0 && local > dur - seg.fadeOutSeconds) return Math.max(0, (dur - local) / seg.fadeOutSeconds);
  return 1;
}

function segFilter(seg: VisualSegment): string {
  const parts = [
    `brightness(${seg.brightness ?? 1})`,
    `contrast(${seg.contrast ?? 1})`,
    `saturate(${seg.saturation ?? 1})`,
    seg.blur ? `blur(${seg.blur}px)` : "",
  ];
  return parts.filter(Boolean).join(" ");
}

// ─── Ken Burns ────────────────────────────────────────────────────────────────

// 4 variants: zoom-in-center, zoom-in+drift, zoom-out-center, drift-pan
// Values: [startScale, endScale, startX%, startY%, endX%, endY%]
const KB: [number, number, number, number, number, number][] = [
  [1.00, 1.15,  0,    0,    0,    0   ], // zoom in, center
  [1.10, 1.10, -3,   -2,    3,    2   ], // drift right-down
  [1.15, 1.00,  0,    0,    0,    0   ], // zoom out, center
  [1.08, 1.08,  3,    1,   -3,   -1   ], // drift left-up
];

function kbVariant(mediaId: string): number {
  let h = 0;
  for (const ch of mediaId) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  return Math.abs(h) % KB.length;
}

function KenBurnsImage({
  src, alt, opacity, filter, segStart, segEnd, playheadAt, mediaId,
}: {
  src: string; alt: string; opacity: number; filter: string;
  segStart: number; segEnd: number; playheadAt: number; mediaId: string;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const v = kbVariant(mediaId);
  const [startScale, endScale, startX, startY, endX, endY] = KB[v];

  // Apply transform every frame — correct for both playback and seeking
  useEffect(() => {
    const el = imgRef.current;
    if (!el) return;
    const dur = segEnd - segStart;
    const p   = dur > 0 ? Math.max(0, Math.min(1, (playheadAt - segStart) / dur)) : 0;
    const scale = startScale + (endScale - startScale) * p;
    const tx    = startX    + (endX    - startX)    * p;
    const ty    = startY    + (endY    - startY)    * p;
    el.style.transform = `scale(${scale.toFixed(4)}) translate(${tx.toFixed(2)}%, ${ty.toFixed(2)}%)`;
  });

  return (
    <div className="absolute inset-0 overflow-hidden">
      <img
        ref={imgRef}
        src={src} alt={alt}
        className="h-full w-full object-cover"
        style={{ opacity, filter, transformOrigin: "center", willChange: "transform" }}
        draggable={false}
      />
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type PreviewPlayerProps = {
  playheadAt:              number;
  isPlaying:               boolean;
  totalDuration:           number;
  segments:                VisualSegment[];
  audioSegments:           AudioSegment[];
  media:                   MediaItem[];
  presetWidth:             number;
  presetHeight:            number;
  viewportHeight:          number;
  textOverlays?:           TextOverlay[];
  watermarks?:             Watermark[];
  syncBeats?:              number[];   // beat timestamps — cyan marks on scrub bar
  syncEvents?:             number[];   // rock event timestamps — violet marks
  onPlayheadChange:        (t: number) => void;
  onPlayToggle:            () => void;
  onStop:                  () => void;
  onViewportHeightChange?: (h: number) => void;
};

const MIN_VIEWPORT_H = 120;
const MAX_VIEWPORT_H = 640;

// ─── Component ────────────────────────────────────────────────────────────────

export function PreviewPlayer({
  playheadAt, isPlaying, totalDuration,
  segments, audioSegments, media,
  presetWidth, presetHeight, viewportHeight,
  textOverlays = [],
  watermarks = [],
  syncBeats = [],
  syncEvents = [],
  onPlayheadChange, onPlayToggle, onStop, onViewportHeightChange,
}: PreviewPlayerProps) {

  const topVideoRef = useRef<HTMLVideoElement>(null);
  const botVideoRef = useRef<HTMLVideoElement>(null);
  const audioRefs   = useRef<Map<string, HTMLAudioElement>>(new Map());
  const playerRef   = useRef<HTMLDivElement>(null);
  const scrubRef    = useRef<HTMLDivElement>(null);

  const [topVideoRenderable, setTopVideoRenderable] = useState(true);
  const [botVideoRenderable, setBotVideoRenderable] = useState(true);
  const [viewHovered,  setViewHovered]  = useState(false);
  const [scrubHoverX,  setScrubHoverX]  = useState<number | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // ── Active segments ────────────────────────────────────────────────────────

  const activeSegs = segments
    .filter((s) => playheadAt >= s.startAt && playheadAt < s.endAt)
    .sort((a, b) => a.startAt - b.startAt);

  const botSeg   = activeSegs.length > 1 ? activeSegs[0] : null;
  const topSeg   = activeSegs.length > 0 ? activeSegs[activeSegs.length - 1] : null;

  const botMedia = botSeg ? media.find((m) => m.id === botSeg.mediaId) : null;
  const topMedia = topSeg ? media.find((m) => m.id === topSeg.mediaId) : null;
  const topVideoPreviewUrl = topMedia?.kind === "video" ? getVideoPreviewUrl(topMedia.previewUrl, topMedia.serverPath) : "";
  const botVideoPreviewUrl = botMedia?.kind === "video" ? getVideoPreviewUrl(botMedia.previewUrl, botMedia.serverPath) : "";

  const isCrossfade = botSeg !== null;

  // Fade applies only during crossfade (for top) or always for bot (which is always outgoing)
  const fadeFor = (seg: VisualSegment, applyFade: boolean) =>
    (isPlaying && applyFade) ? calcFadeOpacity(playheadAt, seg) : 1;

  const botOpacity = botSeg ? fadeFor(botSeg, true)       * (botSeg.opacity ?? 1) : 0;
  const topOpacity = topSeg ? fadeFor(topSeg, isCrossfade) * (topSeg.opacity ?? 1) : 0;

  // ── Transition style for the incoming (top) layer ─────────────────────────
  // p = progress of the crossfade (0 = just starting, 1 = complete)
  const crossfadeP = (() => {
    if (!isCrossfade || !topSeg) return 1;
    const d = topSeg.fadeInSeconds || 1;
    return Math.max(0, Math.min(1, (playheadAt - topSeg.startAt) / d));
  })();

  function transitionStyle(seg: VisualSegment | null): React.CSSProperties {
    if (!isCrossfade || !seg || crossfadeP >= 1) return {};
    const inv = 1 - crossfadeP; // 1→0 as transition completes
    switch (seg.transitionType) {
      case "wipeleft":   return { clipPath: `inset(0 ${inv * 100}% 0 0)` };
      case "wiperight":  return { clipPath: `inset(0 0 0 ${inv * 100}%)` };
      case "wipeup":     return { clipPath: `inset(${inv * 100}% 0 0 0)` };
      case "wipedown":   return { clipPath: `inset(0 0 ${inv * 100}% 0)` };
      case "slideleft":  return { transform: `translateX(${inv * 100}%)` };
      case "slideright": return { transform: `translateX(-${inv * 100}%)` };
      case "smoothup":   return { transform: `translateY(${inv * 40}px)`, opacity: crossfadeP };
      case "radial":     return { clipPath: `circle(${crossfadeP * 75}% at 50% 50%)` };
      case "dissolve":   return { opacity: crossfadeP };
      default:           return {}; // "fade" handled by opacity calc above
    }
  }

  const topTransitionStyle = transitionStyle(topSeg);

  const botVolume  = botSeg ? calcFadeOpacity(playheadAt, botSeg) * (botSeg.videoVolume ?? 1) : 0;
  const topVolume  = topSeg ? calcFadeOpacity(playheadAt, topSeg) * (topSeg.videoVolume ?? 1) : 0;

  const botFilter  = botSeg ? segFilter(botSeg) : "";
  const topFilter  = topSeg ? segFilter(topSeg) : "";

  // ── Video src / metadata effects ───────────────────────────────────────────

  useEffect(() => {
    const v = topVideoRef.current;
    if (!v) return;
    setTopVideoRenderable(true);
    const syncFrame = () => {
      if (!topSeg) return;
      try { v.currentTime = Math.max(0, playheadAt - topSeg.startAt); } catch {}
    };
    v.onloadedmetadata = syncFrame;
    v.onloadeddata     = () => setTopVideoRenderable(v.videoWidth > 0);
    v.onerror          = () => setTopVideoRenderable(false);
    if (topVideoPreviewUrl && v.readyState >= 1) { syncFrame(); setTopVideoRenderable(v.videoWidth > 0); }
    return () => { v.onloadedmetadata = null; v.onloadeddata = null; v.onerror = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topMedia?.id, topVideoPreviewUrl]);

  useEffect(() => {
    const v = botVideoRef.current;
    if (!v) return;
    setBotVideoRenderable(true);
    const syncFrame = () => {
      if (!botSeg) return;
      try { v.currentTime = Math.max(0, playheadAt - botSeg.startAt); } catch {}
    };
    v.onloadedmetadata = syncFrame;
    v.onloadeddata     = () => setBotVideoRenderable(v.videoWidth > 0);
    v.onerror          = () => setBotVideoRenderable(false);
    if (botVideoPreviewUrl && v.readyState >= 1) { syncFrame(); setBotVideoRenderable(v.videoWidth > 0); }
    return () => { v.onloadedmetadata = null; v.onloadeddata = null; v.onerror = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botMedia?.id, botVideoPreviewUrl]);

  // ── Video playback sync (runs every render) ────────────────────────────────

  useEffect(() => {
    function syncVideo(
      ref: React.RefObject<HTMLVideoElement | null>,
      seg: VisualSegment | null,
      mediaItem: MediaItem | null,
      vol: number,
      allowAudio: boolean,
    ) {
      const v = ref.current;
      if (!v) return;
      if (!seg || mediaItem?.kind !== "video") {
        if (!v.paused) v.pause();
        v.muted = true; v.volume = 0;
        return;
      }
      const speed  = seg.speed ?? 1;
      const target = Math.max(0, (playheadAt - seg.startAt) * speed);
      if (v.readyState < 1) return;
      if (v.playbackRate !== speed) v.playbackRate = speed;
      const clampedVol = Math.max(0, Math.min(1, vol));
      v.muted   = !allowAudio || clampedVol <= 0;
      v.volume  = allowAudio ? clampedVol : 0;
      if (isPlaying) {
        if (Math.abs(v.currentTime - target) > 0.2) v.currentTime = target;
        if (v.paused) v.play().catch(() => {});
      } else {
        if (!v.paused) v.pause();
        if (Math.abs(v.currentTime - target) > 0.08) v.currentTime = target;
      }
    }
    syncVideo(topVideoRef, topSeg, topMedia ?? null, topVolume, true);
    syncVideo(botVideoRef, botSeg, botMedia ?? null, botVolume, false);
  });

  // ── Audio: create / destroy elements ──────────────────────────────────────

  useEffect(() => {
    const ids  = [...new Set(audioSegments.map((s) => s.mediaId))];
    const next = new Map<string, HTMLAudioElement>();
    for (const mediaId of ids) {
      const mi = media.find((m) => m.id === mediaId);
      if (!mi?.previewUrl) continue;
      let el = audioRefs.current.get(mediaId);
      if (!el) { el = new Audio(); el.preload = "auto"; el.src = mi.previewUrl; }
      next.set(mediaId, el);
    }
    for (const [id, el] of audioRefs.current) {
      if (!next.has(id)) { el.pause(); el.src = ""; }
    }
    audioRefs.current = next;
  }, [audioSegments, media]);

  // ── Audio sync (runs every render) ────────────────────────────────────────

  useEffect(() => {
    for (const [mediaId, audio] of audioRefs.current) {
      const seg = audioSegments.find(
        (s) => s.mediaId === mediaId && playheadAt >= s.startAt && playheadAt < s.endAt,
      );
      if (seg) {
        const target     = Math.max(0, playheadAt - seg.startAt + seg.trimStart);
        const gainLinear = Math.pow(10, seg.gainDb / 20);
        audio.volume     = Math.max(0, Math.min(1, gainLinear * calcFadeOpacity(playheadAt, seg)));
        if (isPlaying) {
          if (Math.abs(audio.currentTime - target) > 0.5) audio.currentTime = target;
          if (audio.paused) audio.play().catch(() => {});
        } else {
          if (!audio.paused) audio.pause();
          if (Math.abs(audio.currentTime - target) > 0.08) audio.currentTime = target;
        }
      } else {
        if (!audio.paused) audio.pause();
      }
    }
  });

  // ── Cleanup ────────────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      for (const el of audioRefs.current.values()) { el.pause(); el.src = ""; }
      audioRefs.current.clear();
    };
  }, []);

  // ── Fullscreen ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      playerRef.current?.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  // ── Resize handle ─────────────────────────────────────────────────────────

  function handleResizeStart(e: React.MouseEvent) {
    if (!onViewportHeightChange) return;
    e.preventDefault();
    const startY = e.clientY;
    const startH = viewportHeight;

    function onMove(ev: MouseEvent) {
      const newH = Math.max(MIN_VIEWPORT_H, Math.min(MAX_VIEWPORT_H, startH + ev.clientY - startY));
      onViewportHeightChange?.(newH);
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  // ── Progress bar ───────────────────────────────────────────────────────────

  const progress    = totalDuration > 0 ? Math.min(1, playheadAt / totalDuration) : 0;
  const isEmpty     = totalDuration === 0 || segments.length === 0;
  const displayMedia = topMedia ?? botMedia;

  const showVideoFallback =
    (topMedia?.kind === "video" && !topVideoRenderable) ||
    (botMedia?.kind === "video" && !botVideoRenderable && !topMedia);

  function handleBarClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect  = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    onPlayheadChange(Math.max(0, Math.min(totalDuration, ratio * totalDuration)));
  }

  function handleBarKey(e: React.KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 5 : 1;
    if (e.key === "ArrowRight") onPlayheadChange(Math.min(totalDuration, playheadAt + step));
    if (e.key === "ArrowLeft")  onPlayheadChange(Math.max(0, playheadAt - step));
  }

  function handleScrubMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    setScrubHoverX((e.clientX - rect.left) / rect.width);
  }

  const scrubTooltipTime = scrubHoverX !== null ? scrubHoverX * totalDuration : null;

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div ref={playerRef} className={clsx(
      "flex flex-col border-b border-white/[0.06]",
      isFullscreen && "h-screen bg-black",
    )}>

      {/* ── Viewport ──────────────────────────────────────────────────── */}
      <div
        className={clsx(
          "flex shrink-0 items-center justify-center bg-black",
          isFullscreen ? "flex-1" : "",
        )}
        style={isFullscreen ? undefined : { height: viewportHeight }}
      >
        {/* Clickable content box */}
        <div
          className="relative h-full overflow-hidden bg-zinc-950 cursor-pointer select-none"
          style={{ aspectRatio: `${presetWidth} / ${presetHeight}`, maxHeight: "100%", maxWidth: "100%" }}
          onClick={isEmpty ? undefined : onPlayToggle}
          onMouseEnter={() => setViewHovered(true)}
          onMouseLeave={() => setViewHovered(false)}
        >
          {/* Empty state */}
          {!botSeg && !topSeg && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#070709]">
              <p className="text-[11px] text-zinc-800">
                {isEmpty ? "Adicione clipes e pressione Play" : "Intervalo entre clipes"}
              </p>
            </div>
          )}

          {/* Bottom layer — outgoing clip during crossfade */}
          {botSeg && (
            <div className="absolute inset-0">
              {botMedia?.kind === "image" && botMedia.previewUrl && (
                <KenBurnsImage
                  key={`bot-${botMedia.id}-${botSeg.startAt}`}
                  src={botMedia.previewUrl} alt={botMedia.name}
                  opacity={botOpacity} filter={botFilter}
                  segStart={botSeg.startAt} segEnd={botSeg.endAt}
                  playheadAt={playheadAt} mediaId={botMedia.id} />
              )}
              <video
                key={`bot-v-${botVideoPreviewUrl || botMedia?.id || "e"}`}
                ref={botVideoRef}
                src={botMedia?.kind === "video" ? botVideoPreviewUrl || undefined : undefined}
                playsInline preload="auto"
                className={clsx("h-full w-full object-contain", (botMedia?.kind !== "video" || !botVideoRenderable) && "hidden")}
                style={{ opacity: botOpacity, filter: botMedia?.kind === "video" ? botFilter : "" }}
              />
            </div>
          )}

          {/* Top layer — incoming / current clip */}
          {topSeg && (
            <div className="absolute inset-0" style={topTransitionStyle}>
              {topMedia?.kind === "image" && topMedia.previewUrl && (
                <KenBurnsImage
                  key={`top-${topMedia.id}-${topSeg.startAt}`}
                  src={topMedia.previewUrl} alt={topMedia.name}
                  opacity={topOpacity} filter={topFilter}
                  segStart={topSeg.startAt} segEnd={topSeg.endAt}
                  playheadAt={playheadAt} mediaId={topMedia.id} />
              )}
              <video
                key={`top-v-${topVideoPreviewUrl || topMedia?.id || "e"}`}
                ref={topVideoRef}
                src={topMedia?.kind === "video" ? topVideoPreviewUrl || undefined : undefined}
                playsInline preload="auto"
                className={clsx("h-full w-full object-contain", (topMedia?.kind !== "video" || !topVideoRenderable) && "hidden")}
                style={{ opacity: topOpacity, filter: topMedia?.kind === "video" ? topFilter : "" }}
              />
            </div>
          )}

          {/* Video fallback message */}
          {showVideoFallback && displayMedia?.kind === "video" && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#050507] px-6 text-center">
              <div className="max-w-sm rounded-2xl border border-white/10 bg-black/40 p-4">
                <p className="text-sm font-medium text-white">Sem preview de vídeo no navegador</p>
                <p className="mt-2 text-xs leading-5 text-zinc-400">
                  O arquivo está reproduzindo áudio, mas a trilha de vídeo não está sendo decodificada pelo navegador atual.
                </p>
                <p className="mt-3 text-[11px] text-zinc-500">{displayMedia.name}</p>
              </div>
            </div>
          )}

          {/* Text overlays */}
          <TextOverlayLayer overlays={textOverlays} playheadAt={playheadAt} />

          {/* Watermarks */}
          <WatermarkPreviewLayer
            watermarks={watermarks}
            media={media}
            playheadAt={playheadAt}
            presetWidth={presetWidth}
            presetHeight={presetHeight}
          />

          {/* Hover play/pause overlay */}
          {!isEmpty && (
            <div className={clsx(
              "absolute inset-0 flex items-center justify-center transition-opacity duration-150 pointer-events-none",
              viewHovered ? "opacity-100" : "opacity-0",
            )}>
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/50 ring-1 ring-white/10 backdrop-blur-sm">
                {isPlaying
                  ? <Pause className="h-5 w-5 text-white" />
                  : <Play  className="ml-0.5 h-5 w-5 text-white" />}
              </div>
            </div>
          )}

          {/* Timecode */}
          <div className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-white/50 pointer-events-none">
            {fmtTime(playheadAt)}{totalDuration > 0 ? ` / ${fmtTime(totalDuration)}` : ""}
          </div>
        </div>
      </div>

      {/* ── Transport ─────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-3 bg-[#0c0c0e] px-4 py-2.5">

        {/* Stop / rewind */}
        <button type="button" onClick={onStop}
          title="Parar e voltar ao início"
          className="rounded p-1.5 text-zinc-700 transition-colors hover:bg-white/[0.06] hover:text-zinc-300">
          <SkipBack className="h-3.5 w-3.5" />
        </button>

        {/* Play / Pause */}
        <button
          type="button" onClick={onPlayToggle} disabled={isEmpty}
          title={isPlaying ? "Pausar (Space)" : "Reproduzir (Space)"}
          className={clsx(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all",
            "disabled:cursor-not-allowed disabled:opacity-30",
            isPlaying
              ? "bg-white/10 text-white hover:bg-white/15"
              : "bg-white text-zinc-950 shadow hover:bg-zinc-100",
          )}
        >
          {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="ml-0.5 h-3.5 w-3.5" />}
        </button>

        {/* Progress / seek bar with tooltip */}
        <div
          ref={scrubRef}
          role="slider" tabIndex={0}
          aria-label="Posição de reprodução"
          aria-valuemin={0} aria-valuemax={totalDuration} aria-valuenow={playheadAt}
          className="group relative flex flex-1 cursor-pointer items-center focus:outline-none"
          onClick={handleBarClick}
          onKeyDown={handleBarKey}
          onMouseMove={handleScrubMouseMove}
          onMouseLeave={() => setScrubHoverX(null)}
        >
          {/* Beat / Rock event markers above the track */}
          {totalDuration > 0 && (syncBeats.length > 0 || syncEvents.length > 0) && (
            <div className="pointer-events-none absolute bottom-full mb-0.5 left-0 right-0 h-2">
              {/* Beat markers — thin cyan ticks */}
              {syncBeats.map((t) => (
                <div key={t}
                  className="absolute top-0 w-px h-full bg-cyan-400/50"
                  style={{ left: `${(t / totalDuration) * 100}%` }} />
              ))}
              {/* Rock event markers — wider violet ticks */}
              {syncEvents.map((t) => (
                <div key={t}
                  className="absolute top-0 h-full"
                  style={{ left: `${(t / totalDuration) * 100}%`, width: 2 }}>
                  <div className="w-full h-full bg-violet-400/70" />
                  {/* Diamond pip at top */}
                  <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rotate-45 bg-violet-400" />
                </div>
              ))}
            </div>
          )}

          {/* Track */}
          <div className="relative h-1 w-full rounded-full bg-white/[0.08] transition-all duration-150 group-hover:h-1.5">
            {/* Filled */}
            <div
              className="absolute left-0 top-0 h-full rounded-full bg-white/40"
              style={{ width: `${progress * 100}%` }}
            />
            {/* Thumb */}
            <div
              className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow opacity-0 transition-opacity group-hover:opacity-100"
              style={{ left: `${progress * 100}%` }}
            />
          </div>

          {/* Time tooltip */}
          {scrubTooltipTime !== null && totalDuration > 0 && (
            <div
              className="pointer-events-none absolute bottom-full mb-2 -translate-x-1/2 rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[9px] text-zinc-300 ring-1 ring-white/[0.06]"
              style={{ left: `${(scrubHoverX ?? 0) * 100}%` }}
            >
              {fmtTime(scrubTooltipTime)}
            </div>
          )}
        </div>

        {/* Active clip badge */}
        <div className="hidden w-28 items-center gap-1.5 overflow-hidden xl:flex">
          {displayMedia && (
            <>
              <span className={clsx(
                "shrink-0 rounded px-1 py-0.5 text-[9px] font-bold uppercase",
                displayMedia.kind === "image" ? "bg-orange-400/15 text-orange-300" :
                displayMedia.kind === "video" ? "bg-cyan-400/15 text-cyan-300" :
                "bg-violet-400/15 text-violet-300",
              )}>
                {displayMedia.kind === "image" ? "IMG" : "VID"}
              </span>
              <span className="truncate text-[10px] text-zinc-600">{displayMedia.name}</span>
            </>
          )}
        </div>

        {/* Fullscreen */}
        <button type="button" onClick={toggleFullscreen}
          title={isFullscreen ? "Sair do fullscreen" : "Fullscreen"}
          className="shrink-0 rounded p-1.5 text-zinc-700 transition-colors hover:bg-white/[0.06] hover:text-zinc-300">
          {isFullscreen
            ? <Minimize2 className="h-3.5 w-3.5" />
            : <Maximize2 className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* ── Resize handle ─────────────────────────────────────────────── */}
      {onViewportHeightChange && !isFullscreen && (
        <div
          onMouseDown={handleResizeStart}
          className="group flex h-2 shrink-0 cursor-row-resize items-center justify-center bg-transparent hover:bg-white/[0.04] active:bg-white/[0.08]"
          title="Arrastar para redimensionar"
        >
          <div className="h-px w-8 rounded-full bg-white/[0.08] transition-colors group-hover:bg-white/20" />
        </div>
      )}
    </div>
  );
}
