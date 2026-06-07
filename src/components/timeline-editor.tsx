'use client';

import clsx from "clsx";
import { Activity, LoaderCircle, Magnet, Maximize2, Trash2, Wand2, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { computeVisualSegments, secondsLabel } from "@/lib/media-rules";
import type { AudioTimelineItem, MediaItem, TextOverlay, VisualTimelineItem, XfadeTransitionType } from "@/lib/types";
import { XFADE_TRANSITION_LABELS } from "@/lib/types";

// ─── Constants ────────────────────────────────────────────────────────────────

const RULER_H  = 40;
const VIDEO_H  = 68;
const AUDIO_H  = 52;
const LABEL_W  = 72;
const RESIZE_W = 10;
const MIN_DUR  = 0.1;
const MIN_PPS  = 4;
const MAX_PPS  = 800;

// ─── Types ────────────────────────────────────────────────────────────────────

type DragState = {
  kind: "move-visual" | "resize-visual" | "move-audio" | "playhead";
  id: string;
  startPageX: number;
  startScrollLeft: number;
  origStart: number;
  origDur: number;
};

export type TimelineEditorProps = {
  media:    MediaItem[];
  visuals:  VisualTimelineItem[];
  audios:   AudioTimelineItem[];
  pxPerSec: number;
  totalSeconds: number;
  playheadAt:         number;
  onPlayheadChange:   (t: number) => void;
  onPxPerSecChange:   (v: number) => void;
  onVisualMove:       (id: string, startAt: number) => void;
  onVisualResize:     (id: string, durationSeconds: number) => void;
  onVisualFadeChange: (id: string, field: "fadeInSeconds" | "fadeOutSeconds", value: number) => void;
  onVisualPropChange?: (id: string, field: string, value: number) => void;
  onVisualTransitionChange?: (id: string, type: XfadeTransitionType | undefined) => void;
  onAudioMove:        (id: string, startAt: number) => void;
  onAudioPropChange?: (id: string, field: string, value: number) => void;
  onRemoveMedia:      (mediaId: string) => void;
  beats?:             number[];
  bpm?:               number;
  analyzingBeats?:    boolean;
  onAnalyzeBeats?:    () => void;
  musicalEvents?:     number[];
  analyzingEvents?:   boolean;
  onSyncToMusic?:     () => void;
  onSelectionChange?: (id: string | null, kind: "visual" | "audio") => void;
  textOverlays?:        TextOverlay[];
  onAddTextOverlay?:    (o: TextOverlay) => void;
  onUpdateTextOverlay?: (id: string, patch: Partial<TextOverlay>) => void;
  onRemoveTextOverlay?: (id: string) => void;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(t: number): string {
  if (t < 0) t = 0;
  const m  = Math.floor(t / 60);
  const s  = t % 60;
  const ss = s.toFixed(1);
  if (m > 0) return `${m}:${String(Math.floor(s)).padStart(2, "0")}`;
  if (s % 1 === 0) return `${Math.floor(s)}s`;
  return `${ss}s`;
}

function rulerIntervals(pps: number): { major: number; minor: number } {
  if (pps >= 400) return { major: 1,   minor: 0.1  };
  if (pps >= 200) return { major: 1,   minor: 0.25 };
  if (pps >= 120) return { major: 2,   minor: 0.5  };
  if (pps >= 60)  return { major: 5,   minor: 1    };
  if (pps >= 30)  return { major: 10,  minor: 2    };
  if (pps >= 15)  return { major: 30,  minor: 5    };
  return               { major: 60,  minor: 10   };
}

function getSnaps(segments: { startAt: number; endAt: number }[]): number[] {
  const s = new Set<number>([0]);
  for (const seg of segments) { s.add(seg.startAt); s.add(seg.endAt); }
  return [...s];
}

function snapValue(v: number, targets: number[], pps: number, on: boolean): number {
  if (!on) return v;
  const thresh = 8 / pps;
  let best = v; let bestDist = thresh + 1;
  for (const t of targets) {
    const d = Math.abs(v - t);
    if (d < bestDist) { bestDist = d; best = t; }
  }
  return bestDist <= thresh ? best : v;
}

// ─── Waveform Bars ────────────────────────────────────────────────────────────

function WaveformBars({ width, height, name }: { width: number; height: number; name: string }) {
  const bars = Math.max(1, Math.floor(width / 3.5));
  const seed = name.split("").reduce((s, c) => ((s * 31) + c.charCodeAt(0)) | 0, 0);
  return (
    <svg width={width} height={height} className="absolute inset-0 pointer-events-none" aria-hidden>
      {Array.from({ length: bars }, (_, i) => {
        const x = i / Math.max(1, bars - 1);
        const h = Math.abs(
          Math.sin(x * 11.7 + (seed % 7) * 0.8)  * 0.42 +
          Math.sin(x * 6.9  + (seed % 5) * 0.55)  * 0.33 +
          Math.sin(x * 23.1 + (seed % 11) * 1.1)  * 0.25,
        );
        const barH = Math.max(2, (0.12 + 0.88 * h) * (height - 8));
        return (
          <rect key={i} x={i * 3.5} y={(height - barH) / 2}
            width={2.5} height={barH} fill="currentColor" rx={1} />
        );
      })}
    </svg>
  );
}

// ─── Fade overlay ─────────────────────────────────────────────────────────────

function FadeOverlay({
  duration, pxPerSec, fadeIn, fadeOut, accent,
}: { duration: number; pxPerSec: number; fadeIn: number; fadeOut: number; accent: string }) {
  const totalW = duration * pxPerSec;
  const inW    = Math.min(fadeIn  * pxPerSec, totalW * 0.5);
  const outW   = Math.min(fadeOut * pxPerSec, totalW * 0.5);
  return (
    <>
      {inW > 1 && (
        <div className="absolute inset-y-0 left-0 pointer-events-none rounded-l"
          style={{ width: inW, background: `linear-gradient(to right, ${accent}, transparent)` }} />
      )}
      {outW > 1 && (
        <div className="absolute inset-y-0 right-0 pointer-events-none rounded-r"
          style={{ width: outW, background: `linear-gradient(to left, ${accent}, transparent)` }} />
      )}
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function TimelineEditor({
  media, visuals, audios, pxPerSec, totalSeconds,
  playheadAt, onPlayheadChange,
  onPxPerSecChange, onVisualMove, onVisualResize, onVisualFadeChange, onVisualPropChange, onVisualTransitionChange, onAudioMove, onAudioPropChange, onRemoveMedia,
  beats = [], bpm = 0, analyzingBeats = false, onAnalyzeBeats,
  musicalEvents = [], analyzingEvents = false, onSyncToMusic,
  onSelectionChange,
  textOverlays = [], onAddTextOverlay, onUpdateTextOverlay, onRemoveTextOverlay,
}: TimelineEditorProps) {

  const scrollRef     = useRef<HTMLDivElement>(null);
  const labelsRef     = useRef<HTMLDivElement>(null);
  const dragRef       = useRef<DragState | null>(null);
  const prevCountRef  = useRef(visuals.length + audios.length);

  const [selectedId,   setSelectedId]   = useState<string | null>(null);
  const [selectedKind, setSelectedKind] = useState<"visual" | "audio">("visual");
  const [hoverTime,    setHoverTime]    = useState<number | null>(null);
  const [snapEnabled,  setSnapEnabled]  = useState(true);
  const [trackScale,   setTrackScale]   = useState(1.0);

  // Dynamic track heights (scaled by trackScale)
  const videoH = Math.max(28, Math.round(VIDEO_H * trackScale));
  const audioH = Math.max(22, Math.round(AUDIO_H * trackScale));

  // Derived
  const segments  = useMemo(() => computeVisualSegments(media, visuals), [media, visuals]);
  const segMap    = useMemo(() => new Map(segments.map((s) => [s.mediaId, s])), [segments]);
  const snaps     = useMemo(() => [...getSnaps(segments), ...beats], [segments, beats]);
  // Include audio track ends so the ruler covers all content
  const maxAudioEnd = useMemo(() => {
    if (!audios.length) return 0;
    return Math.max(...audios.map((a) => {
      const m = media.find((mi) => mi.id === a.mediaId);
      return (a.startAt ?? 0) + (m?.durationSeconds ?? 0);
    }));
  }, [audios, media]);
  const displayDur = Math.max(totalSeconds, maxAudioEnd, 7) + 8;
  const contentW   = displayDur * pxPerSec;

  // Visuals split by kind
  const imageVisuals = useMemo(
    () => visuals.filter((v) => media.find((m) => m.id === v.mediaId)?.kind === "image"),
    [visuals, media],
  );
  const videoVisuals = useMemo(
    () => visuals.filter((v) => media.find((m) => m.id === v.mediaId)?.kind === "video"),
    [visuals, media],
  );

  // Clear selection if clip removed
  useEffect(() => {
    if (!selectedId) return;
    const exists = visuals.some((v) => v.id === selectedId) || audios.some((a) => a.id === selectedId);
    if (!exists) setSelectedId(null);
  }, [selectedId, visuals, audios]);

  // Notify parent of selection change
  useEffect(() => {
    onSelectionChange?.(selectedId, selectedKind);
  }, [selectedId, selectedKind]); // eslint-disable-line react-hooks/exhaustive-deps

  // Draft positions (updated during drag without touching the store)
  const [draft, setDraft] = useState<Map<string, { startAt: number; duration: number }>>(new Map());

  // ── Position resolvers ─────────────────────────────────────────────────────

  function vPos(item: VisualTimelineItem) {
    const d = draft.get(item.id);
    if (d) return d;
    const seg = segMap.get(item.mediaId);
    return { startAt: item.startAt ?? seg?.startAt ?? 0, duration: item.durationSeconds };
  }

  function aPos(item: AudioTimelineItem) {
    const d = draft.get(item.id);
    const src = media.find((m) => m.id === item.mediaId);
    return { startAt: d?.startAt ?? item.startAt ?? 0, duration: src?.durationSeconds ?? 0 };
  }

  // ── Coordinate helpers ─────────────────────────────────────────────────────

  function clientXToTime(pageX: number): number {
    if (!scrollRef.current) return 0;
    const rect = scrollRef.current.getBoundingClientRect();
    const relX  = (pageX - rect.left) + scrollRef.current.scrollLeft;
    return Math.max(0, relX / pxPerSec);
  }

  // ── Drag start ─────────────────────────────────────────────────────────────

  function startDrag(
    e: React.MouseEvent,
    kind: DragState["kind"],
    id: string,
    origStart: number,
    origDur: number,
  ) {
    e.preventDefault(); e.stopPropagation();
    dragRef.current = {
      kind, id,
      startPageX: e.pageX,
      startScrollLeft: scrollRef.current?.scrollLeft ?? 0,
      origStart, origDur,
    };
    document.body.style.cursor  = kind === "resize-visual" ? "ew-resize" : "grabbing";
    document.body.style.userSelect = "none";
  }

  // ── Window drag handlers ───────────────────────────────────────────────────

  const onMouseMove = useCallback((e: MouseEvent) => {
    const d = dragRef.current;
    if (!d) return;

    // account for scroll during drag
    const scrollDelta = (scrollRef.current?.scrollLeft ?? 0) - d.startScrollLeft;
    const dx = (e.pageX - d.startPageX) + scrollDelta;
    const dt = dx / pxPerSec;

    if (d.kind === "playhead") {
      onPlayheadChange(Math.max(0, d.origStart + dt));
      return;
    }

    if (d.kind === "move-visual") {
      const raw     = Math.max(0, d.origStart + dt);
      const snapped = snapValue(raw, snaps, pxPerSec, snapEnabled);
      setDraft((prev) => new Map(prev).set(d.id, { startAt: snapped, duration: d.origDur }));
    } else if (d.kind === "resize-visual") {
      const rawEnd  = d.origStart + d.origDur + dt;
      const snapped = snapValue(rawEnd, snaps, pxPerSec, snapEnabled);
      const newDur  = Math.max(MIN_DUR, snapped - d.origStart);
      setDraft((prev) => new Map(prev).set(d.id, { startAt: d.origStart, duration: newDur }));
    } else if (d.kind === "move-audio") {
      const raw = Math.max(0, d.origStart + dt);
      setDraft((prev) => new Map(prev).set(d.id, { startAt: raw, duration: d.origDur }));
    }
  }, [pxPerSec, snaps, snapEnabled]);

  const onMouseUp = useCallback(() => {
    const d = dragRef.current;
    if (!d || d.kind === "playhead") {
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      return;
    }
    const pos = draft.get(d.id);
    if (pos) {
      if (d.kind === "move-visual")   onVisualMove(d.id, pos.startAt);
      if (d.kind === "resize-visual") onVisualResize(d.id, pos.duration);
      if (d.kind === "move-audio") {
        // Could be an audio track OR a text overlay
        const isText = textOverlays.some((o) => o.id === d.id);
        if (isText) {
          const dur = d.origDur;
          onUpdateTextOverlay?.(d.id, { startAt: pos.startAt, endAt: pos.startAt + dur });
        } else {
          onAudioMove(d.id, pos.startAt);
        }
      }
    }
    dragRef.current = null;
    setDraft(new Map());
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, [draft, onVisualMove, onVisualResize, onAudioMove, textOverlays, onUpdateTextOverlay]);

  useEffect(() => {
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup",   onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup",   onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  // ── Keyboard ───────────────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!selectedId) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        const clip = selectedKind === "visual"
          ? visuals.find((v) => v.id === selectedId)
          : audios.find((a) => a.id === selectedId);
        if (clip) { onRemoveMedia(clip.mediaId); setSelectedId(null); }
      }
      if (e.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedId, selectedKind, visuals, audios, onRemoveMedia]);

  // ── Ctrl+scroll zoom ────────────────────────────────────────────────────────

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.2 : 0.83;
      onPxPerSecChange(Math.round(Math.max(MIN_PPS, Math.min(MAX_PPS, pxPerSec * factor))));
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [pxPerSec, onPxPerSecChange]);

  // ── Fit to screen ──────────────────────────────────────────────────────────

  function fitScreen() {
    const el = scrollRef.current;
    if (!el) return;

    // Horizontal: fit the full content (visuals + audio) to the visible width
    if (displayDur > 0) {
      const newPps = Math.max(MIN_PPS, Math.min(MAX_PPS, el.clientWidth / displayDur));
      onPxPerSecChange(newPps);
    }

    // Vertical: fit all tracks to visible height
    const availH    = el.clientHeight - RULER_H;
    const totalBaseH = visuals.length * VIDEO_H + audios.length * AUDIO_H;
    if (availH > 0 && totalBaseH > 0) {
      setTrackScale(Math.max(0.4, Math.min(2.5, availH / totalBaseH)));
    }

    // Reset scroll so the user sees from the beginning
    el.scrollLeft = 0;
    el.scrollTop  = 0;
    if (labelsRef.current) labelsRef.current.scrollTop = 0;
  }

  // ── Scroll to beginning when clips are added ──────────────────────────────

  useEffect(() => {
    const total = visuals.length + audios.length;
    if (total > prevCountRef.current) {
      // New clips added — scroll to t=0 so the user can see them
      if (scrollRef.current) {
        scrollRef.current.scrollLeft = 0;
        scrollRef.current.scrollTop  = Math.max(0, scrollRef.current.scrollHeight - scrollRef.current.clientHeight);
      }
      if (labelsRef.current) {
        labelsRef.current.scrollTop = Math.max(0, labelsRef.current.scrollHeight - labelsRef.current.clientHeight);
      }
    }
    prevCountRef.current = total;
  }, [visuals.length, audios.length]);

  // ── Ruler ──────────────────────────────────────────────────────────────────

  const { major, minor } = useMemo(() => rulerIntervals(pxPerSec), [pxPerSec]);

  const minorTicks = useMemo(() => {
    const ticks: number[] = [];
    const n = Math.ceil(displayDur / minor);
    for (let i = 0; i <= n; i++) ticks.push(Math.round(i * minor * 1000) / 1000);
    return ticks;
  }, [displayDur, minor]);

  const majorTicks = useMemo(() => {
    const ticks: number[] = [];
    const n = Math.ceil(displayDur / major);
    for (let i = 0; i <= n; i++) ticks.push(Math.round(i * major * 1000) / 1000);
    return ticks;
  }, [displayDur, major]);

  // ── Hover time tracking ────────────────────────────────────────────────────

  function onTrackMouseMove(e: React.MouseEvent) {
    setHoverTime(clientXToTime(e.clientX));
  }

  // ── Visual clip renderer (shared between image and video tracks) ──────────

  function renderVisualClip(item: VisualTimelineItem) {
    const mi = media.find((m) => m.id === item.mediaId);
    if (!mi) return null;
    const { startAt, duration } = vPos(item);
    const left    = startAt  * pxPerSec;
    const width   = Math.max(2, duration * pxPerSec);
    const isSel   = selectedId === item.id;
    const isDragg = dragRef.current?.id === item.id;
    const isImg   = mi.kind === "image";

    const clipBg   = isImg
      ? "bg-gradient-to-b from-orange-500/25 to-orange-500/10"
      : "bg-gradient-to-b from-cyan-500/22 to-cyan-500/8";
    const clipBord = isImg
      ? (isSel ? "border-orange-300/80" : "border-orange-400/40 hover:border-orange-400/60")
      : (isSel ? "border-cyan-300/80"   : "border-cyan-400/40 hover:border-cyan-400/60");
    const fadeTint = isImg ? "rgba(249,115,22,0.55)" : "rgba(34,211,238,0.45)";

    return (
      <div
        key={item.id}
        className={clsx(
          "absolute inset-y-2 rounded-md border overflow-hidden transition-[border-color] duration-100",
          "cursor-grab active:cursor-grabbing",
          clipBg, clipBord,
          isSel   && "ring-1 ring-white/20 shadow-lg z-10",
          isDragg && "opacity-90 z-20",
        )}
        style={{ left, width: Math.max(4, width) }}
        onClick={(e) => { e.stopPropagation(); setSelectedId(item.id); setSelectedKind("visual"); }}
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).dataset.resize) return;
          setSelectedId(item.id); setSelectedKind("visual");
          startDrag(e, "move-visual", item.id, startAt, duration);
        }}
      >
        <FadeOverlay
          duration={duration} pxPerSec={pxPerSec}
          fadeIn={item.fadeInSeconds} fadeOut={item.fadeOutSeconds}
          accent={fadeTint}
        />
        <div className="relative z-10 flex h-full items-center gap-2 px-2.5 pointer-events-none">
          <span className={clsx(
            "shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider",
            isImg ? "bg-orange-400/20 text-orange-200" : "bg-cyan-400/20 text-cyan-200",
          )}>
            {isImg ? "IMG" : "VID"}
          </span>
          {width > 56 && (
            <span className="flex-1 truncate text-[10px] font-medium text-zinc-200 leading-none">
              {mi.name}
            </span>
          )}
          {width > 100 && (
            <span className="ml-auto shrink-0 font-mono text-[9px] text-zinc-500">
              {fmt(duration)}
            </span>
          )}
        </div>
        {width > 20 && (
          <div
            data-resize="right"
            className="absolute right-0 inset-y-0 z-20 flex cursor-ew-resize items-center justify-center hover:bg-white/10"
            style={{ width: RESIZE_W }}
            onMouseDown={(e) => startDrag(e, "resize-visual", item.id, startAt, duration)}
          >
            <div className="h-5 w-[2px] rounded-full bg-white/25" />
          </div>
        )}
      </div>
    );
  }

  // ── Selected clip data ─────────────────────────────────────────────────────

  const selectedVisual  = selectedKind === "visual" ? visuals.find((v) => v.id === selectedId) : undefined;
  const selectedAudio   = selectedKind === "audio"  ? audios.find((a) => a.id === selectedId)  : undefined;
  const selectedOverlay = textOverlays.find((o) => o.id === selectedId);
  const selectedMedia  = selectedVisual
    ? media.find((m) => m.id === selectedVisual.mediaId)
    : selectedAudio
    ? media.find((m) => m.id === selectedAudio.mediaId)
    : undefined;

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div
      className="flex flex-col overflow-hidden"
      style={{ height: "100%" }}
    >

      {/* ── Toolbar ───────────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] bg-[#0c0c0e] px-4 py-2">

        {/* Zoom */}
        <div className="flex items-center gap-1.5">
          <button type="button"
            onClick={() => onPxPerSecChange(Math.max(MIN_PPS, Math.round(pxPerSec / 1.4)))}
            className="rounded p-1.5 text-zinc-600 hover:bg-white/[0.06] hover:text-zinc-300">
            <ZoomOut className="h-3.5 w-3.5" />
          </button>

          <input type="range" min={MIN_PPS} max={MAX_PPS} value={pxPerSec}
            onChange={(e) => onPxPerSecChange(Number(e.target.value))}
            className="h-1 w-24 cursor-pointer appearance-none rounded-full bg-white/[0.08] accent-white/60" />

          <button type="button"
            onClick={() => onPxPerSecChange(Math.min(MAX_PPS, Math.round(pxPerSec * 1.4)))}
            className="rounded p-1.5 text-zinc-600 hover:bg-white/[0.06] hover:text-zinc-300">
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <span className="w-16 text-center font-mono text-[10px] text-zinc-600">{pxPerSec}px/s</span>
        </div>

        <div className="h-3 w-px bg-white/[0.08]" />

        {/* Track height */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-zinc-600 whitespace-nowrap">Faixas</span>
          <button type="button"
            onClick={() => setTrackScale((s) => Math.max(0.4, parseFloat((s - 0.15).toFixed(2))))}
            className="rounded p-1 text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200 transition-colors">
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <input
            type="range" min={0.4} max={2.5} step={0.05}
            value={trackScale}
            onChange={(e) => setTrackScale(Number(e.target.value))}
            style={{ userSelect: "text", touchAction: "pan-x" }}
            className="h-1.5 w-24 cursor-pointer rounded-full accent-white/70"
          />
          <button type="button"
            onClick={() => setTrackScale((s) => Math.min(2.5, parseFloat((s + 0.15).toFixed(2))))}
            className="rounded p-1 text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200 transition-colors">
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <span className="w-9 text-right font-mono text-[10px] text-zinc-500">
            {Math.round(trackScale * 100)}%
          </span>
        </div>

        <div className="h-3 w-px bg-white/[0.08]" />

        {/* Snap */}
        <button type="button"
          onClick={() => setSnapEnabled((s) => !s)}
          className={clsx(
            "flex items-center gap-1.5 rounded px-2 py-1.5 text-[10px] font-medium transition-all",
            snapEnabled
              ? "bg-cyan-400/10 text-cyan-400"
              : "text-zinc-600 hover:bg-white/[0.04] hover:text-zinc-400",
          )}>
          <Magnet className="h-3 w-3" />
          Snap
        </button>

        {/* Fit */}
        <button type="button" onClick={fitScreen}
          className="flex items-center gap-1.5 rounded px-2 py-1.5 text-[10px] font-medium text-zinc-600 hover:bg-white/[0.04] hover:text-zinc-400">
          <Maximize2 className="h-3 w-3" />
          Ajustar
        </button>

        {/* Beat analysis */}
        {(audios.length > 0 || beats.length > 0) && (
          <>
            <div className="h-3 w-px bg-white/[0.08]" />
            <button
              type="button"
              disabled={analyzingBeats}
              onClick={onAnalyzeBeats}
              title="Analisar batidas da música"
              className={clsx(
                "flex items-center gap-1.5 rounded px-2 py-1.5 text-[10px] font-medium transition-all",
                beats.length > 0
                  ? "bg-cyan-400/10 text-cyan-400"
                  : "text-zinc-600 hover:bg-white/[0.04] hover:text-zinc-400",
                analyzingBeats && "cursor-wait opacity-60",
              )}
            >
              {analyzingBeats
                ? <LoaderCircle className="h-3 w-3 animate-spin" />
                : <Activity className="h-3 w-3" />}
              {bpm > 0 ? `${bpm} BPM` : "Analisar"}
            </button>
          </>
        )}

        {/* Sync to music button — appears when audio exists */}
        {audios.length > 0 && (
          <>
            <div className="h-3 w-px bg-white/[0.08]" />
            <button
              type="button"
              disabled={analyzingEvents}
              onClick={onSyncToMusic}
              title="Analisa o áudio e reposiciona os clipes nos momentos em que entram solos, riffs e seções"
              className={clsx(
                "flex items-center gap-1.5 rounded px-2 py-1.5 text-[10px] font-medium transition-all",
                musicalEvents.length > 0
                  ? "bg-violet-400/10 text-violet-400"
                  : "text-zinc-600 hover:bg-white/[0.04] hover:text-zinc-400",
                analyzingEvents && "cursor-wait opacity-60",
              )}
            >
              {analyzingEvents
                ? <LoaderCircle className="h-3 w-3 animate-spin" />
                : <Wand2 className="h-3 w-3" />}
              {musicalEvents.length > 0 ? `${musicalEvents.length} eventos` : "Sincronizar"}
            </button>
          </>
        )}

        {/* Playhead time */}
        <div className="ml-auto flex items-center gap-2 font-mono">
          <span className="text-[10px] text-zinc-700">Playhead</span>
          <span className="text-[11px] text-zinc-400">{fmt(playheadAt)}</span>
          {hoverTime !== null && (
            <>
              <span className="text-zinc-700">·</span>
              <span className="text-[10px] text-zinc-600">{fmt(hoverTime)}</span>
            </>
          )}
        </div>
      </div>

      {/* ── Timeline area ─────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 overflow-hidden select-none">

        {/* Track labels (fixed left, scrolls vertically in sync with content) */}
        <div
          ref={labelsRef}
          className="flex shrink-0 flex-col border-r border-white/[0.06] bg-[#0c0c0e] overflow-y-hidden"
          style={{ width: LABEL_W }}>
          {/* Ruler spacer — sticky so it stays at the top when scrolling */}
          <div className="sticky top-0 z-10 shrink-0 bg-[#0c0c0e]" style={{ height: RULER_H }} />

          {/* Per-clip visual labels */}
          {[...visuals].sort((a, b) => a.order - b.order).map((item) => {
            const mi = media.find((m) => m.id === item.mediaId);
            if (!mi) return null;
            const isImg = mi.kind === "image";
            return (
              <TrackLabel
                key={item.id}
                badge={isImg ? "IMG" : "VID"}
                name={mi.name}
                color={isImg ? "text-orange-400/70" : "text-cyan-400/70"}
                height={videoH}
                bordered
              />
            );
          })}

          {/* Per-clip audio labels */}
          {[...audios].sort((a, b) => a.order - b.order).map((item) => {
            const mi = media.find((m) => m.id === item.mediaId);
            if (!mi) return null;
            return (
              <TrackLabel
                key={item.id}
                badge="AUD"
                name={mi.name}
                color="text-violet-400/70"
                height={audioH}
                bordered={false}
              />
            );
          })}

          {/* Text overlay labels */}
          {textOverlays.map((ov) => (
            <TrackLabel
              key={ov.id}
              badge="TXT"
              name={ov.text.slice(0, 20) || "Texto"}
              color="text-amber-400/70"
              height={44}
              bordered={false}
            />
          ))}

          {/* Add text overlay button */}
          {onAddTextOverlay && (
            <div style={{ height: 36 }} className="flex items-center px-2">
              <button
                type="button"
                onClick={() => onAddTextOverlay({
                  id: `txt-${Date.now()}`,
                  text: "Título",
                  startAt: 0,
                  endAt: Math.max(3, (totalSeconds || 10) * 0.15),
                  x: 50, y: 10,
                  fontSize: 36,
                  color: "#ffffff",
                  fontWeight: "bold",
                  animation: "fade",
                })}
                className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-zinc-600 hover:bg-white/[0.04] hover:text-amber-400 transition-all"
              >
                <span className="text-[12px] leading-none">+</span> Texto
              </button>
            </div>
          )}
        </div>

        {/* Scrollable content */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-x-auto overflow-y-auto"
          onMouseMove={onTrackMouseMove}
          onMouseLeave={() => setHoverTime(null)}
          onClick={() => setSelectedId(null)}
          onScroll={(e) => {
            if (labelsRef.current) labelsRef.current.scrollTop = e.currentTarget.scrollTop;
          }}
        >
          <div className="relative" style={{ width: contentW, minWidth: "100%" }}>

            {/* ── Ruler (sticky top so it stays visible when scrolling vertically) ── */}
            <div
              className="sticky top-0 z-10 relative bg-[#0d0d10] border-b border-white/[0.10]"
              style={{ height: RULER_H, width: contentW }}
              onMouseDown={(e) => {
                const t = clientXToTime(e.clientX);
                onPlayheadChange(t);
                startDrag(e, "playhead", "playhead", t, 0);
              }}
            >
              {/* Minor ticks */}
              {minorTicks.map((t) => (
                <div key={t} className="absolute bottom-0 w-px bg-white/[0.08]"
                  style={{ left: t * pxPerSec, height: 10 }} />
              ))}

              {/* Major ticks + labels */}
              {majorTicks.map((t) => (
                <div key={t} className="absolute bottom-0 flex flex-col items-start"
                  style={{ left: t * pxPerSec }}>
                  <div className="w-px bg-white/25" style={{ height: 20 }} />
                  <span
                    className="mt-1 pl-1 font-mono text-[10px] font-medium leading-none text-zinc-400 whitespace-nowrap"
                    style={{ transform: "translateX(-50%)" }}
                  >
                    {fmt(t)}
                  </span>
                </div>
              ))}

              {/* Beat markers — cyan thin lines */}
              {beats.length > 0 && beats.map((beatTime) => (
                <div
                  key={beatTime}
                  className="pointer-events-none absolute top-0 w-px bg-cyan-400/30"
                  style={{ left: beatTime * pxPerSec, height: RULER_H }}
                />
              ))}

              {/* Musical event markers — violet, taller, with a diamond pip */}
              {musicalEvents.map((evtTime) => (
                <div
                  key={evtTime}
                  className="pointer-events-none absolute top-0 flex flex-col items-center"
                  style={{ left: evtTime * pxPerSec - 4, height: RULER_H }}
                >
                  {/* Vertical line */}
                  <div className="w-px bg-violet-400/60 flex-1" style={{ marginLeft: 4 }} />
                  {/* Diamond marker at top */}
                  <div
                    className="absolute bg-violet-400 rotate-45"
                    style={{ top: 2, left: 1, width: 6, height: 6 }}
                  />
                </div>
              ))}

              {/* Hover time cursor */}
              {hoverTime !== null && (
                <div className="pointer-events-none absolute top-0 bottom-0 w-px bg-white/10"
                  style={{ left: hoverTime * pxPerSec }} />
              )}

              {/* Playhead triangle in ruler */}
              <div
                className="absolute top-0 z-20 cursor-grab active:cursor-grabbing"
                style={{ left: playheadAt * pxPerSec, transform: "translateX(-50%)" }}
                onMouseDown={(e) => startDrag(e, "playhead", "playhead", playheadAt, 0)}
              >
                <svg width={12} height={14} viewBox="0 0 12 14" className="text-red-500">
                  <polygon points="0,0 12,0 6,14" fill="currentColor" />
                </svg>
              </div>
            </div>

            {/* ── Per-clip visual tracks ──────────────────────────────────── */}
            {[...visuals].sort((a, b) => a.order - b.order).map((item, idx) => {
              const mi = media.find((m) => m.id === item.mediaId);
              if (!mi) return null;
              const bgColor = mi.kind === "image" ? "#100e12" : "#0e1012";
              const isLast  = idx === visuals.length - 1 && audios.length === 0;
              return (
                <TrackRow
                  key={item.id}
                  height={videoH} contentW={contentW}
                  bgColor={bgColor}
                  majorTicks={majorTicks} pxPerSec={pxPerSec}
                  playheadAt={playheadAt} hoverTime={hoverTime}
                  last={isLast}
                >
                  {renderVisualClip(item)}
                </TrackRow>
              );
            })}

            {/* ── Text overlay tracks ──────────────────────────────────────── */}
            {textOverlays.map((ov, idx) => {
              const left  = ov.startAt * pxPerSec;
              const width = Math.max(2, (ov.endAt - ov.startAt) * pxPerSec);
              const isSel = selectedId === ov.id;
              return (
                <TrackRow
                  key={ov.id}
                  height={44} contentW={contentW}
                  bgColor="#100e06"
                  majorTicks={majorTicks} pxPerSec={pxPerSec}
                  playheadAt={playheadAt} hoverTime={hoverTime}
                  last={idx === textOverlays.length - 1 && audios.length === 0}
                >
                  <div
                    className={clsx(
                      "absolute inset-y-1.5 rounded-md border overflow-hidden cursor-grab active:cursor-grabbing",
                      "bg-gradient-to-b from-amber-500/20 to-amber-500/8",
                      isSel ? "border-amber-300/70 ring-1 ring-white/20 z-10" : "border-amber-400/35 hover:border-amber-400/60",
                    )}
                    style={{ left, width: Math.max(4, width) }}
                    onClick={(e) => { e.stopPropagation(); setSelectedId(ov.id); setSelectedKind("visual"); }}
                    onMouseDown={(e) => {
                      e.preventDefault(); e.stopPropagation();
                      setSelectedId(ov.id);
                      // Drag moves startAt+endAt together
                      const dur = ov.endAt - ov.startAt;
                      startDrag(e, "move-audio", ov.id, ov.startAt, dur);
                    }}
                  >
                    <div className="relative z-10 flex h-full items-center gap-2 px-2 pointer-events-none">
                      <span className="shrink-0 rounded px-1 py-0.5 text-[9px] font-bold uppercase bg-amber-400/20 text-amber-200">TXT</span>
                      {width > 60 && <span className="flex-1 truncate text-[10px] font-medium text-zinc-300">{ov.text.slice(0, 24)}</span>}
                    </div>
                  </div>
                </TrackRow>
              );
            })}

            {/* Add text button spacer row */}
            {onAddTextOverlay && (
              <TrackRow
                height={36} contentW={contentW}
                bgColor="transparent"
                majorTicks={[]} pxPerSec={pxPerSec}
                playheadAt={playheadAt} hoverTime={null}
                last
              ><span /></TrackRow>
            )}

            {/* ── Per-clip audio tracks ────────────────────────────────────── */}
            {[...audios].sort((a, b) => a.order - b.order).map((item, idx) => {
              const mi = media.find((m) => m.id === item.mediaId);
              if (!mi) return null;
              const { startAt, duration } = aPos(item);
              const left   = startAt  * pxPerSec;
              const width  = Math.max(2, duration * pxPerSec);
              const isSel  = selectedId === item.id;
              const isDrag = dragRef.current?.id === item.id;
              const isLast = idx === audios.length - 1;
              return (
                <TrackRow
                  key={item.id}
                  height={audioH} contentW={contentW}
                  bgColor="#0d0e12"
                  majorTicks={majorTicks} pxPerSec={pxPerSec}
                  playheadAt={playheadAt} hoverTime={hoverTime}
                  last={isLast}
                >
                  <div
                    className={clsx(
                      "absolute inset-y-1.5 rounded-md border overflow-hidden cursor-grab active:cursor-grabbing",
                      "bg-gradient-to-b from-violet-500/20 to-violet-500/8",
                      isSel  ? "border-violet-300/70 ring-1 ring-white/20 z-10" : "border-violet-400/35 hover:border-violet-400/60",
                      isDrag && "opacity-90 z-20",
                    )}
                    style={{ left, width: Math.max(4, width) }}
                    onClick={(e) => { e.stopPropagation(); setSelectedId(item.id); setSelectedKind("audio"); }}
                    onMouseDown={(e) => {
                      setSelectedId(item.id); setSelectedKind("audio");
                      startDrag(e, "move-audio", item.id, startAt, duration);
                    }}
                  >
                    <div className="absolute inset-0 text-violet-400">
                      {width > 20 && <WaveformBars width={width} height={audioH - 12} name={mi.name} />}
                    </div>
                    <div className="relative z-10 flex h-full items-center gap-2 px-2 pointer-events-none">
                      <span className="shrink-0 rounded px-1 py-0.5 text-[9px] font-bold uppercase bg-violet-400/20 text-violet-200">AUD</span>
                      {width > 60 && <span className="flex-1 truncate text-[10px] font-medium text-zinc-300 leading-none">{mi.name}</span>}
                      {width > 110 && <span className="ml-auto shrink-0 font-mono text-[9px] text-zinc-500">{fmt(duration)}</span>}
                    </div>
                  </div>
                </TrackRow>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Properties panel ──────────────────────────────────────────────── */}
      <div className={clsx(
        "shrink-0 border-t border-white/[0.06] bg-[#0c0c0e] transition-all duration-200 overflow-hidden",
        (selectedVisual || selectedAudio || selectedOverlay) ? "max-h-[180px]" : "max-h-0",
      )}>
        {selectedVisual && selectedMedia && (
          <div className="flex flex-col gap-1.5 px-4 py-2.5">
            {/* Row 1: clip info + remove */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <p className="text-[10px] font-semibold text-zinc-300 truncate max-w-[180px]">{selectedMedia.name}</p>
                <span className="shrink-0 text-[9px] uppercase tracking-wider text-zinc-700">{selectedMedia.kind}</span>
              </div>
              <button type="button"
                onClick={() => { onRemoveMedia(selectedVisual.mediaId); setSelectedId(null); }}
                className="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium text-zinc-600 hover:bg-red-400/10 hover:text-red-400 transition-all shrink-0">
                <Trash2 className="h-3 w-3" /> Remover
              </button>
            </div>

            {/* Row 2: all controls, wrapping to next line if needed */}
            <div className="flex flex-wrap items-end gap-x-3 gap-y-2 text-[10px]">
              <PropInput label="Início" value={vPos(selectedVisual).startAt}
                onChange={(v) => onVisualMove(selectedVisual.id, v)} step={0.1} min={0} />
              <PropInput label="Duração" value={vPos(selectedVisual).duration}
                onChange={(v) => onVisualResize(selectedVisual.id, Math.max(MIN_DUR, v))} step={0.1} min={MIN_DUR} />
              <PropInput label="F.in" value={selectedVisual.fadeInSeconds}
                onChange={(v) => onVisualFadeChange(selectedVisual.id, "fadeInSeconds", Math.max(0, v))} step={0.1} min={0} />
              <PropInput label="F.out" value={selectedVisual.fadeOutSeconds}
                onChange={(v) => onVisualFadeChange(selectedVisual.id, "fadeOutSeconds", Math.max(0, v))} step={0.1} min={0} />

              <div className="w-px h-6 bg-white/[0.06] self-end mb-0.5 shrink-0" />

              <PropSlider label="Opac." value={selectedVisual.opacity ?? 1}
                onChange={(v) => onVisualPropChange?.(selectedVisual.id, "opacity", v)} min={0} max={1} step={0.01} />
              {selectedMedia.kind === "video" && (
                <PropSlider label="Vol." value={selectedVisual.volume ?? 1}
                  onChange={(v) => onVisualPropChange?.(selectedVisual.id, "volume", v)} min={0} max={1} step={0.01} />
              )}
              <PropSlider label="Brilho" value={selectedVisual.brightness ?? 1}
                onChange={(v) => onVisualPropChange?.(selectedVisual.id, "brightness", v)} min={0.1} max={3} step={0.1} />
              <PropSlider label="Contraste" value={selectedVisual.contrast ?? 1}
                onChange={(v) => onVisualPropChange?.(selectedVisual.id, "contrast", v)} min={0} max={3} step={0.1} />
              <PropSlider label="Sat." value={selectedVisual.saturation ?? 1}
                onChange={(v) => onVisualPropChange?.(selectedVisual.id, "saturation", v)} min={0} max={3} step={0.1} />
              <PropSlider label="Blur" value={selectedVisual.blur ?? 0}
                onChange={(v) => onVisualPropChange?.(selectedVisual.id, "blur", v)} min={0} max={20} step={0.5} />

              <div className="w-px h-6 bg-white/[0.06] self-end mb-0.5 shrink-0" />

              {/* Transition */}
              <div className="flex flex-col gap-1 shrink-0">
                <span className="text-[9px] uppercase tracking-wider text-zinc-600">Transição</span>
                <select
                  value={selectedVisual.transitionType ?? "fade"}
                  onChange={(e) => onVisualTransitionChange?.(
                    selectedVisual.id,
                    e.target.value === "fade" ? undefined : e.target.value as XfadeTransitionType,
                  )}
                  className="rounded border border-white/[0.08] bg-[#0d0d10] px-1.5 py-1 text-[10px] text-zinc-300 focus:border-white/20 focus:outline-none"
                >
                  {(Object.entries(XFADE_TRANSITION_LABELS) as [XfadeTransitionType, string][]).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}

        {selectedOverlay && (
          <div className="flex items-center gap-3 px-5 py-3 overflow-x-auto">
            <div className="shrink-0">
              <p className="text-[10px] font-semibold text-amber-400/80 leading-none">Texto</p>
            </div>
            <div className="h-8 w-px bg-white/[0.06]" />
            <div className="flex items-center gap-3 flex-nowrap text-[10px]">
              {/* Text */}
              <div className="flex flex-col gap-1 shrink-0">
                <span className="text-[9px] uppercase tracking-wider text-zinc-600">Texto</span>
                <input
                  value={selectedOverlay.text}
                  onChange={(e) => onUpdateTextOverlay?.(selectedOverlay.id, { text: e.target.value })}
                  className="rounded border border-white/[0.08] bg-[#0d0d10] px-2 py-1 text-[10px] text-zinc-300 w-32 focus:border-white/20 focus:outline-none"
                />
              </div>
              <PropInput label="Início (s)" value={selectedOverlay.startAt}
                onChange={(v) => onUpdateTextOverlay?.(selectedOverlay.id, { startAt: Math.max(0,v), endAt: Math.max(Math.max(0,v)+0.5, selectedOverlay.endAt) })} step={0.1} min={0} />
              <PropInput label="Fim (s)" value={selectedOverlay.endAt}
                onChange={(v) => onUpdateTextOverlay?.(selectedOverlay.id, { endAt: Math.max(selectedOverlay.startAt+0.5, v) })} step={0.1} min={0} />
              <PropInput label="Tamanho" value={selectedOverlay.fontSize}
                onChange={(v) => onUpdateTextOverlay?.(selectedOverlay.id, { fontSize: Math.max(8, v) })} step={2} min={8} />
              <PropInput label="X (%)" value={selectedOverlay.x}
                onChange={(v) => onUpdateTextOverlay?.(selectedOverlay.id, { x: Math.max(0, Math.min(100, v)) })} step={1} min={0} />
              <PropInput label="Y (%)" value={selectedOverlay.y}
                onChange={(v) => onUpdateTextOverlay?.(selectedOverlay.id, { y: Math.max(0, Math.min(100, v)) })} step={1} min={0} />
              {/* Color */}
              <div className="flex flex-col gap-1 shrink-0">
                <span className="text-[9px] uppercase tracking-wider text-zinc-600">Cor</span>
                <input type="color" value={selectedOverlay.color}
                  onChange={(e) => onUpdateTextOverlay?.(selectedOverlay.id, { color: e.target.value })}
                  className="h-7 w-10 cursor-pointer rounded border border-white/[0.08] bg-transparent p-0.5" />
              </div>
              {/* Bold toggle */}
              <div className="flex flex-col gap-1 shrink-0">
                <span className="text-[9px] uppercase tracking-wider text-zinc-600">Negrito</span>
                <button type="button"
                  onClick={() => onUpdateTextOverlay?.(selectedOverlay.id, { fontWeight: selectedOverlay.fontWeight === "bold" ? "normal" : "bold" })}
                  className={clsx("rounded px-2 py-1 text-[10px] font-bold transition-all border",
                    selectedOverlay.fontWeight === "bold" ? "border-white/20 bg-white/10 text-white" : "border-white/[0.06] text-zinc-600"
                  )}>B</button>
              </div>
              {/* Animation */}
              <div className="flex flex-col gap-1 shrink-0">
                <span className="text-[9px] uppercase tracking-wider text-zinc-600">Animação</span>
                <select value={selectedOverlay.animation}
                  onChange={(e) => onUpdateTextOverlay?.(selectedOverlay.id, { animation: e.target.value as import("@/lib/types").TextAnimationType })}
                  className="rounded border border-white/[0.08] bg-[#0d0d10] px-1.5 py-1 text-[10px] text-zinc-300 focus:border-white/20 focus:outline-none">
                  <option value="none">Nenhuma</option>
                  <option value="fade">Fade</option>
                  <option value="slide-up">Slide ↑</option>
                </select>
              </div>
            </div>
            <div className="ml-auto">
              <button type="button"
                onClick={() => { onRemoveTextOverlay?.(selectedOverlay.id); setSelectedId(null); }}
                className="flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[10px] font-medium text-zinc-600 hover:bg-red-400/10 hover:text-red-400 transition-all">
                <Trash2 className="h-3 w-3" />
                Remover
              </button>
            </div>
          </div>
        )}

        {selectedAudio && selectedMedia && (
          <div className="flex items-center gap-4 px-5 py-3">
            <div className="shrink-0">
              <p className="text-[10px] font-semibold text-zinc-300 truncate max-w-[140px]">{selectedMedia.name}</p>
              <p className="mt-0.5 text-[9px] uppercase tracking-wider text-zinc-700">áudio · {fmt(selectedMedia.durationSeconds)}</p>
            </div>

            <div className="h-8 w-px bg-white/[0.06]" />

            <div className="flex items-center gap-4">
              <PropInput label="Início (s)" value={aPos(selectedAudio).startAt}
                onChange={(v) => onAudioMove(selectedAudio.id, Math.max(0, v))} step={0.1} min={0} />
              <div className="w-32">
                <PropSlider label="Volume" value={selectedAudio.volume ?? 1}
                  onChange={(v) => onAudioPropChange?.(selectedAudio.id, "volume", v)} min={0} max={1} step={0.01} />
              </div>
              <div className="text-[10px] text-zinc-700">
                Fim: <span className="text-zinc-500 font-mono">{fmt(aPos(selectedAudio).startAt + aPos(selectedAudio).duration)}</span>
              </div>
            </div>

            <div className="ml-auto">
              <button type="button"
                onClick={() => { onRemoveMedia(selectedAudio.mediaId); setSelectedId(null); }}
                className="flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[10px] font-medium text-zinc-600 hover:bg-red-400/10 hover:text-red-400 transition-all">
                <Trash2 className="h-3 w-3" />
                Remover
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Track label (left sidebar cell) ──────────────────────────────────────────

function TrackLabel({
  badge, name, color, height, bordered,
}: { badge: string; name: string; color: string; height: number; bordered: boolean }) {
  return (
    <div
      className={clsx(
        "flex flex-col items-end justify-center gap-0.5 pr-2",
        bordered && "border-b border-white/[0.04]",
      )}
      style={{ height }}
    >
      <span className={clsx("text-[9px] font-bold uppercase tracking-widest leading-none", color)}>{badge}</span>
      <span className="max-w-full truncate text-right text-[7px] leading-none text-zinc-700"
        style={{ maxWidth: LABEL_W - 8 }} title={name}>{name}</span>
    </div>
  );
}

// ─── Track row (scrollable track area) ────────────────────────────────────────

function TrackRow({
  height, contentW, bgColor, majorTicks, pxPerSec, playheadAt, hoverTime, last = false, children,
}: {
  height: number;
  contentW: number;
  bgColor: string;
  majorTicks: number[];
  pxPerSec: number;
  playheadAt: number;
  hoverTime: number | null;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={clsx("relative", !last && "border-b border-white/[0.06]")}
      style={{ height, width: contentW, background: bgColor }}
    >
      {/* Grid lines */}
      {majorTicks.map((t) => (
        <div key={t} className="absolute inset-y-0 w-px bg-white/[0.04]"
          style={{ left: t * pxPerSec }} />
      ))}
      {/* Playhead */}
      <div className="pointer-events-none absolute inset-y-0 z-20 w-px bg-red-500/70"
        style={{ left: playheadAt * pxPerSec }} />
      {/* Hover cursor */}
      {hoverTime !== null && (
        <div className="pointer-events-none absolute inset-y-0 w-px bg-white/[0.06]"
          style={{ left: hoverTime * pxPerSec }} />
      )}
      {children}
    </div>
  );
}

// ─── Property slider ──────────────────────────────────────────────────────────

function PropSlider({
  label, value, onChange, min = 0, max = 1, step = 0.01,
}: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <label className="flex flex-col gap-1 shrink-0" style={{ width: 88 }}>
      <span className="flex items-center justify-between text-[9px] font-semibold uppercase tracking-wider text-zinc-700">
        {label}
        <span className="font-mono text-zinc-600">{value.toFixed(2)}</span>
      </span>
      <input
        type="range" min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-full cursor-pointer rounded-full bg-white/[0.08] accent-white/50"
      />
    </label>
  );
}

// ─── Property input ────────────────────────────────────────────────────────────

function PropInput({
  label, value, onChange, step = 1, min = 0,
}: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number }) {
  const [local, setLocal] = useState(String(Number(value.toFixed(2))));

  useEffect(() => {
    setLocal(String(Number(value.toFixed(2))));
  }, [value]);

  return (
    <label className="flex flex-col gap-1">
      <span className="text-[9px] font-semibold uppercase tracking-wider text-zinc-700">{label}</span>
      <input
        type="number" step={step} min={min}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          const v = parseFloat(local);
          if (!Number.isNaN(v) && v >= min) onChange(v);
          else setLocal(String(Number(value.toFixed(2))));
        }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className="w-[72px] rounded border border-white/[0.08] bg-white/[0.04] px-2 py-1.5 font-mono text-[11px] text-zinc-200 focus:border-white/20 focus:outline-none focus:bg-white/[0.06]"
      />
    </label>
  );
}
