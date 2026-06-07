'use client';

import { CSS } from "@dnd-kit/utilities";
import { useSortable } from "@dnd-kit/sortable";
import clsx from "clsx";
import { GripVertical, X } from "lucide-react";

type SortableTrackProps = {
  id: string;
  title: string;
  subtitle: string;
  accent: "coral" | "cyan";
  badge: string;
  preview?: React.ReactNode;
  controls?: React.ReactNode;
  onRemove: () => void;
};

export function SortableTrack({
  id,
  title,
  subtitle,
  accent,
  badge,
  preview,
  controls,
  onRemove,
}: SortableTrackProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={clsx(
        "group flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-all duration-150",
        isDragging
          ? "z-10 border-white/20 bg-zinc-800 shadow-2xl"
          : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.10] hover:bg-white/[0.04]",
      )}
    >
      <button
        type="button"
        className="shrink-0 cursor-grab touch-none text-zinc-700 transition-colors hover:text-zinc-400 active:cursor-grabbing"
        aria-label={`Reordenar ${title}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>

      {preview && <div className="shrink-0">{preview}</div>}

      <span
        className={clsx(
          "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
          accent === "coral" ? "bg-orange-400/10 text-orange-300" : "bg-cyan-400/10 text-cyan-300",
        )}
      >
        {badge}
      </span>

      <div className="min-w-0 flex-1">
        <p className="mb-px truncate text-[11px] font-medium leading-none text-zinc-200">{title}</p>
        <p className="text-[10px] text-zinc-600">{subtitle}</p>
      </div>

      {controls && <div className="flex shrink-0 items-center gap-2">{controls}</div>}

      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remover ${title}`}
        className="shrink-0 rounded p-0.5 text-zinc-700 opacity-0 transition-all group-hover:opacity-100 hover:bg-red-400/10 hover:text-red-400"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
