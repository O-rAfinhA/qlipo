'use client';

import type { Watermark, WatermarkPosition, MediaItem } from '@/lib/types';

interface WatermarkPreviewLayerProps {
  watermarks: Watermark[];
  media: MediaItem[];
  playheadAt: number;
  presetWidth: number;
  presetHeight: number;
}

function calculateWatermarkOpacity(t: number, watermark: Watermark): number {
  if (t < watermark.startAt || t >= watermark.endAt) return 0;

  const fadeInEnd = watermark.startAt + watermark.fadeInDuration;
  const fadeOutStart = watermark.endAt - watermark.fadeOutDuration;

  if (t < fadeInEnd) {
    return (t - watermark.startAt) / watermark.fadeInDuration;
  }
  if (t > fadeOutStart) {
    return (watermark.endAt - t) / watermark.fadeOutDuration;
  }
  return 1;
}

function calculatePositionOffsets(
  position: WatermarkPosition,
  wmWidth: number,
  wmHeight: number,
  presetWidth: number,
  presetHeight: number
): { left: number; top: number } {
  const positionMap: Record<WatermarkPosition, { left: number; top: number }> = {
    'top-left': { left: 0, top: 0 },
    'top-right': { left: presetWidth - wmWidth, top: 0 },
    'bottom-left': { left: 0, top: presetHeight - wmHeight },
    'bottom-right': { left: presetWidth - wmWidth, top: presetHeight - wmHeight },
    'center': {
      left: (presetWidth - wmWidth) / 2,
      top: (presetHeight - wmHeight) / 2,
    },
  };

  return positionMap[position];
}

export function WatermarkPreviewLayer({
  watermarks,
  media,
  playheadAt,
  presetWidth,
  presetHeight,
}: WatermarkPreviewLayerProps) {
  const activeWatermarks = watermarks.filter(
    (w) => playheadAt >= w.startAt && playheadAt < w.endAt
  );

  if (activeWatermarks.length === 0) {
    return null;
  }

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {activeWatermarks.map((watermark, idx) => (
        <WatermarkItem
          key={watermark.id}
          watermark={watermark}
          playheadAt={playheadAt}
          presetWidth={presetWidth}
          presetHeight={presetHeight}
          zIndex={idx}
        />
      ))}
    </div>
  );
}

interface WatermarkItemProps {
  watermark: Watermark;
  playheadAt: number;
  presetWidth: number;
  presetHeight: number;
  zIndex: number;
}

function WatermarkItem({
  watermark,
  playheadAt,
  presetWidth,
  presetHeight,
  zIndex,
}: WatermarkItemProps) {
  const fadeOpacity = calculateWatermarkOpacity(playheadAt, watermark);
  const finalOpacity = (watermark.opacity / 100) * fadeOpacity;

  // Calculate watermark dimensions (keeping aspect ratio)
  const wmWidth = Math.round((presetWidth * watermark.size) / 100);
  const wmHeight = Math.round((wmWidth * presetHeight) / presetWidth); // Simplified aspect ratio

  const { left, top } = calculatePositionOffsets(
    watermark.position,
    wmWidth,
    wmHeight,
    presetWidth,
    presetHeight
  );

  return (
    <img
      src={watermark.imageUrl}
      alt="watermark"
      style={{
        position: 'absolute',
        left: `${(left / presetWidth) * 100}%`,
        top: `${(top / presetHeight) * 100}%`,
        width: `${watermark.size}%`,
        height: 'auto',
        opacity: finalOpacity,
        pointerEvents: 'none',
        zIndex: 10 + zIndex,
      }}
    />
  );
}
