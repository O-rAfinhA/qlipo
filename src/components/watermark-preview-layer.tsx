'use client';

import { useRef } from 'react';
import type { Watermark } from '@/lib/types';

interface WatermarkPreviewLayerProps {
  watermarks: Watermark[];
  playheadAt: number;
  presetWidth: number;
  presetHeight: number;
  onUpdatePosition?: (id: string, x: number, y: number) => void;
}

function calcOpacity(t: number, wm: Watermark): number {
  if (t < wm.startAt || t >= wm.endAt) return 0;
  const fadeInEnd    = wm.startAt + wm.fadeInDuration;
  const fadeOutStart = wm.endAt   - wm.fadeOutDuration;
  if (t < fadeInEnd)    return (t - wm.startAt) / wm.fadeInDuration;
  if (t > fadeOutStart) return (wm.endAt - t)   / wm.fadeOutDuration;
  return 1;
}

export function WatermarkPreviewLayer({
  watermarks, playheadAt, presetWidth, presetHeight, onUpdatePosition,
}: WatermarkPreviewLayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const active = watermarks.filter((w) => playheadAt >= w.startAt && playheadAt < w.endAt);
  if (active.length === 0) return null;

  return (
    <div ref={containerRef} className="absolute inset-0 overflow-hidden">
      {active.map((wm, idx) => (
        <DraggableWatermark
          key={wm.id}
          watermark={wm}
          playheadAt={playheadAt}
          containerRef={containerRef}
          onUpdatePosition={onUpdatePosition}
          zIndex={idx}
        />
      ))}
    </div>
  );
}

function DraggableWatermark({
  watermark, playheadAt, containerRef, onUpdatePosition, zIndex,
}: {
  watermark: Watermark;
  playheadAt: number;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onUpdatePosition?: (id: string, x: number, y: number) => void;
  zIndex: number;
}) {
  const opacity    = (watermark.opacity / 100) * calcOpacity(playheadAt, watermark);
  const draggable  = !!onUpdatePosition;

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!onUpdatePosition || !containerRef.current) return;
    e.preventDefault();
    e.stopPropagation();

    const rect       = containerRef.current.getBoundingClientRect();
    const startCX    = e.clientX;
    const startCY    = e.clientY;
    const originX    = watermark.x;
    const originY    = watermark.y;

    document.body.style.cursor     = 'grabbing';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      const dx   = ((ev.clientX - startCX) / rect.width)  * 100;
      const dy   = ((ev.clientY - startCY) / rect.height) * 100;
      const newX = Math.max(0, Math.min(100 - watermark.size, originX + dx));
      const newY = Math.max(0, Math.min(95, originY + dy));
      onUpdatePosition(watermark.id, Math.round(newX * 10) / 10, Math.round(newY * 10) / 10);
    };

    const onUp = () => {
      document.body.style.cursor     = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
  };

  return (
    <img
      src={watermark.imageUrl}
      alt="watermark"
      draggable={false}
      onMouseDown={draggable ? handleMouseDown : undefined}
      style={{
        position:      'absolute',
        left:          `${watermark.x}%`,
        top:           `${watermark.y}%`,
        width:         `${watermark.size}%`,
        height:        'auto',
        opacity,
        zIndex:        10 + zIndex,
        cursor:        draggable ? 'grab' : 'default',
        pointerEvents: draggable ? 'auto' : 'none',
        userSelect:    'none',
        // Visual drag hint
        outline:       draggable ? '1px dashed rgba(255,255,255,0.3)' : 'none',
        outlineOffset: '2px',
      }}
    />
  );
}
