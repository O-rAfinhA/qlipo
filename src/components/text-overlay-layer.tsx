'use client';

import { useEffect, useRef } from "react";
import type { TextOverlay } from "@/lib/types";

// Duration of fade-in / slide-up animation in seconds
const ANIM_DUR = 0.4;

function calcAnimProgress(playheadAt: number, overlay: TextOverlay): number {
  const local = playheadAt - overlay.startAt;
  const dur   = overlay.endAt - overlay.startAt;
  // fade-in / slide-up at start
  if (local < ANIM_DUR) return local / ANIM_DUR;
  // fade-out at end
  if (overlay.animation !== "none" && local > dur - ANIM_DUR) {
    return Math.max(0, (dur - local) / ANIM_DUR);
  }
  return 1;
}

function OverlayItem({
  overlay, playheadAt,
}: { overlay: TextOverlay; playheadAt: number }) {
  const ref = useRef<HTMLDivElement>(null);

  // Update transform/opacity on every frame — correct for scrubbing too
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const p = calcAnimProgress(playheadAt, overlay);
    el.style.opacity = overlay.animation === "none" ? "1" : String(p.toFixed(4));
    el.style.transform = overlay.animation === "slide-up"
      ? `translateY(${((1 - p) * 20).toFixed(2)}px)`
      : "translateY(0)";
  });

  return (
    <div
      ref={ref}
      className="absolute pointer-events-none select-none"
      style={{
        left:       `${overlay.x}%`,
        top:        `${overlay.y}%`,
        transform:  "translateY(0)",
        fontSize:   overlay.fontSize,
        color:      overlay.color,
        fontWeight: overlay.fontWeight,
        textShadow: "0 1px 4px rgba(0,0,0,0.7)",
        whiteSpace: "pre-wrap",
        maxWidth:   "80%",
        lineHeight: 1.2,
      }}
    >
      {overlay.text}
    </div>
  );
}

export function TextOverlayLayer({
  overlays,
  playheadAt,
}: {
  overlays: TextOverlay[];
  playheadAt: number;
}) {
  const active = overlays.filter(
    (o) => playheadAt >= o.startAt && playheadAt < o.endAt,
  );

  if (active.length === 0) return null;

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {active.map((o) => (
        <OverlayItem key={o.id} overlay={o} playheadAt={playheadAt} />
      ))}
    </div>
  );
}
