'use client';

import clsx from "clsx";
import { COLOR_GRADE_PRESETS, type ColorGradePreset } from "@/lib/color-grade-presets";

function PreviewSwatch({ preset }: { preset: ColorGradePreset }) {
  const filter = [
    `brightness(${preset.brightness})`,
    `contrast(${preset.contrast})`,
    `saturate(${preset.saturation})`,
    preset.blur > 0 ? `blur(${preset.blur}px)` : "",
  ].filter(Boolean).join(" ");

  return (
    <div
      className="h-7 w-full rounded overflow-hidden"
      style={{ filter }}
    >
      {/* Gradient strip that reacts visibly to color/brightness changes */}
      <div className="h-full w-full" style={{
        background: "linear-gradient(135deg, #1a1a2e 0%, #4a3060 35%, #c0703a 65%, #e8c87a 100%)",
      }} />
    </div>
  );
}

type ColorGradePanelProps = {
  activePresetId: string | null;
  selectedVisualId?: string | null;
  onSelect: (id: string | null) => void;
  onApplyToSelected?: (presetId: string, clipId: string) => void;
  onApplyToAll: (id: string) => void;
};

export function ColorGradePanel({
  activePresetId,
  selectedVisualId,
  onSelect,
  onApplyToSelected,
  onApplyToAll,
}: ColorGradePanelProps) {
  const canApplyToSelected = !!selectedVisualId && !!onApplyToSelected;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-1.5">
        {COLOR_GRADE_PRESETS.map((preset) => {
          const isActive = activePresetId === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                // In manual mode with a clip selected: apply directly to that clip
                if (canApplyToSelected && !isActive) {
                  onApplyToSelected(preset.id, selectedVisualId);
                } else {
                  onSelect(isActive ? null : preset.id);
                }
              }}
              className={clsx(
                "flex flex-col gap-1.5 rounded-lg border p-2 text-left transition-all duration-150",
                isActive
                  ? "border-white/25 bg-white/[0.07]"
                  : "border-white/[0.05] hover:border-white/10 hover:bg-white/[0.03]",
              )}
            >
              <PreviewSwatch preset={preset} />
              <span className={clsx(
                "text-[10px] font-medium leading-none",
                isActive ? "text-zinc-200" : "text-zinc-600",
              )}>
                {preset.label}
              </span>
            </button>
          );
        })}
      </div>

      {activePresetId && activePresetId !== "neutral" && (
        <div className="flex gap-1.5">
          {canApplyToSelected && (
            <button
              type="button"
              onClick={() => onApplyToSelected(activePresetId, selectedVisualId)}
              className="flex-1 rounded-lg border border-cyan-400/20 bg-cyan-400/[0.05] py-1.5 text-[10px] font-medium text-cyan-400/80 transition-all hover:border-cyan-400/30 hover:text-cyan-300"
            >
              Aplicar ao selecionado
            </button>
          )}
          <button
            type="button"
            onClick={() => onApplyToAll(activePresetId)}
            className={clsx(
              "rounded-lg border border-white/[0.06] bg-white/[0.03] py-1.5 text-[10px] font-medium text-zinc-500 transition-all hover:border-white/10 hover:text-zinc-300",
              canApplyToSelected ? "flex-1" : "w-full",
            )}
          >
            Aplicar a todos
          </button>
        </div>
      )}

      {canApplyToSelected && (
        <p className="text-[9px] text-zinc-700 leading-relaxed">
          Clipe selecionado — clique em um preset para aplicar só a ele.
        </p>
      )}
    </div>
  );
}
