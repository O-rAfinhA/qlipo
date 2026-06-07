'use client';

import clsx from "clsx";
import { ImageIcon, Music4, Video } from "lucide-react";

import { getVideoPreviewUrl } from "@/lib/media-preview-url";
import type { MediaItem } from "@/lib/types";

type MediaThumbnailProps = {
  item: MediaItem;
  className?: string;
};

export function MediaThumbnail({ item, className }: MediaThumbnailProps) {
  const videoPreviewUrl = item.kind === "video" ? getVideoPreviewUrl(item.previewUrl, item.serverPath) : undefined;
  const shellClassName = clsx(
    "relative overflow-hidden rounded-md border border-white/[0.08] bg-black/30",
    className,
  );

  if (item.kind === "image" && item.previewUrl) {
    return (
      <div className={shellClassName}>
        {/* Native img is required here because previewUrl is a blob URL from local uploads. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={item.previewUrl} alt={item.name} className="h-full w-full object-cover" draggable={false} />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/40 to-transparent" />
      </div>
    );
  }

  if (item.kind === "video" && videoPreviewUrl) {
    return (
      <div className={shellClassName}>
        <video src={videoPreviewUrl} className="h-full w-full object-cover" muted playsInline preload="metadata" />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20">
          <span className="rounded-full border border-white/20 bg-black/45 p-1.5 text-cyan-200">
            <Video className="h-3.5 w-3.5" />
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={clsx(shellClassName, "flex items-center justify-center")}>
      <span
        className={clsx(
          "rounded-full border border-white/[0.08] p-2",
          item.kind === "audio" ? "text-violet-300" : "text-orange-300",
        )}
      >
        {item.kind === "audio" ? <Music4 className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />}
      </span>
    </div>
  );
}
