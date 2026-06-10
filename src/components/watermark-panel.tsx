'use client';

import { useState } from 'react';
import type { Watermark, MediaItem } from '@/lib/types';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";

interface WatermarkPanelProps {
  watermarks: Watermark[];
  media: MediaItem[];
  totalDuration: number;
  onAdd: (watermark: Watermark) => void;
  onUpdate: (id: string, patch: Partial<Watermark>) => void;
  onRemove: (id: string) => void;
}

export function WatermarkPanel({
  watermarks, media, totalDuration, onAdd, onUpdate, onRemove,
}: WatermarkPanelProps) {
  const [showForm,    setShowForm]    = useState(false);
  const [uploading,   setUploading]   = useState(false);
  const [uploadError, setUploadError] = useState('');
  // ID of the watermark being configured right now (already added to store)
  const [draftId,     setDraftId]     = useState<string | null>(null);

  const draft = draftId ? watermarks.find((w) => w.id === draftId) : null;

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError('');
    setUploading(true);

    try {
      const urlRes = await fetch(`${BACKEND_URL}/api/uploads/watermark-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, contentType: file.type, sizeBytes: file.size }),
      });
      if (!urlRes.ok) {
        const err = await urlRes.json();
        setUploadError(err.error ?? 'Erro ao obter URL de upload.');
        return;
      }
      const { uploadUrl, r2Key } = await urlRes.json() as { uploadUrl: string; r2Key: string };

      const putRes = await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      if (!putRes.ok) { setUploadError('Erro ao enviar imagem.'); return; }

      // Add immediately to store so it appears in the preview right away
      const startAt = 3;
      const endAt   = Math.max(startAt + 1, totalDuration - 5);
      const newWm: Watermark = {
        id:              crypto.randomUUID(),
        mediaId:         r2Key,
        imageUrl:        `${BACKEND_URL}/api/media/preview?r2Key=${encodeURIComponent(r2Key)}`,
        size:            20,
        opacity:         80,
        x:               75,
        y:               75,
        startAt,
        endAt,
        fadeInDuration:  0.5,
        fadeOutDuration: 0.5,
      };
      onAdd(newWm);
      setDraftId(newWm.id);
    } catch {
      setUploadError("Erro ao fazer upload da marca d'água.");
    } finally {
      setUploading(false);
    }
  };

  const handleOpenForm = () => {
    setDraftId(null);
    setUploadError('');
    setShowForm(true);
  };

  const handleClose = () => {
    setShowForm(false);
    setDraftId(null);
    setUploadError('');
  };

  const handleCancelDraft = () => {
    if (draftId) onRemove(draftId);
    handleClose();
  };

  return (
    <div className="space-y-4 p-4 bg-slate-900 rounded-lg border border-slate-700">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Marca D'Água</h3>
        {!showForm && (
          <button onClick={handleOpenForm}
            className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition">
            Adicionar
          </button>
        )}
      </div>

      {/* Add form */}
      {showForm && (
        <div className="space-y-3 p-3 bg-slate-800 rounded border border-slate-600">
          {!draft ? (
            /* Step 1: pick file */
            <>
              <label className="text-xs text-gray-300 block mb-1">Imagem (JPG, PNG, WEBP — Max 5 MB)</label>
              <input
                type="file"
                accept=".jpg,.jpeg,.png,.webp"
                onChange={handleFileSelect}
                disabled={uploading}
                className="w-full text-xs bg-slate-700 text-white rounded px-2 py-1 border border-slate-600 disabled:opacity-50"
              />
              {uploading    && <p className="text-xs text-zinc-400">Enviando...</p>}
              {uploadError  && <p className="text-xs text-red-400">{uploadError}</p>}
              <button onClick={handleClose}
                className="w-full px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-gray-300 rounded transition">
                Cancelar
              </button>
            </>
          ) : (
            /* Step 2: adjust parameters — watermark already visible in preview */
            <>
              <div className="flex items-center gap-2 mb-1">
                <img src={draft.imageUrl} alt="wm" className="h-8 w-auto rounded border border-slate-600 object-contain bg-slate-700 shrink-0" />
                <p className="text-[10px] text-green-400">Visível no preview — arraste para posicionar</p>
              </div>

              <Slider label="Tamanho" value={draft.size}    unit="%" min={5}   max={50}  step={1}
                onChange={(v) => onUpdate(draft.id, { size: v })} />
              <Slider label="Opacidade" value={draft.opacity} unit="%" min={10}  max={100} step={1}
                onChange={(v) => onUpdate(draft.id, { opacity: v })} />
              <Slider label="Fade In"  value={draft.fadeInDuration}  unit="s" min={0.5} max={3} step={0.1}
                onChange={(v) => onUpdate(draft.id, { fadeInDuration: v })} />
              <Slider label="Fade Out" value={draft.fadeOutDuration} unit="s" min={0.5} max={3} step={0.1}
                onChange={(v) => onUpdate(draft.id, { fadeOutDuration: v })} />

              <div className="flex gap-2 pt-1">
                <button onClick={handleCancelDraft}
                  className="flex-1 px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-gray-300 rounded transition">
                  Remover
                </button>
                <button onClick={handleClose}
                  className="flex-1 px-3 py-1.5 text-xs bg-green-600 hover:bg-green-700 text-white rounded transition font-medium">
                  Concluído
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Watermark list */}
      {watermarks.map((wm) => {
        if (wm.id === draftId) return null; // already shown in form
        return (
          <div key={wm.id} className="p-3 bg-slate-800 rounded border border-slate-600 space-y-2">
            <div className="flex items-center gap-2">
              {wm.imageUrl && (
                <img src={wm.imageUrl} alt="wm" className="h-7 w-auto rounded border border-slate-600 object-contain bg-slate-700 shrink-0" />
              )}
              <p className="text-[10px] text-gray-400 flex-1">{wm.startAt.toFixed(1)}s – {wm.endAt.toFixed(1)}s</p>
              <button onClick={() => onRemove(wm.id)}
                className="px-2 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded shrink-0">✕</button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Slider label="Tamanho"  value={wm.size}    unit="%" min={5}  max={50}  step={1}
                onChange={(v) => onUpdate(wm.id, { size: v })} />
              <Slider label="Opacidade" value={wm.opacity} unit="%" min={10} max={100} step={1}
                onChange={(v) => onUpdate(wm.id, { opacity: v })} />
            </div>

            <p className="text-[10px] text-zinc-600">
              {wm.x.toFixed(0)}% × {wm.y.toFixed(0)}% — arraste no preview para reposicionar
            </p>
          </div>
        );
      })}

      {watermarks.length === 0 && !showForm && (
        <p className="text-xs text-gray-500 text-center py-2">Nenhuma marca d'água adicionada</p>
      )}
    </div>
  );
}

function Slider({ label, value, unit, min, max, step, onChange }: {
  label: string; value: number; unit: string;
  min: number; max: number; step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="text-[10px] text-gray-400 flex justify-between">
        <span>{label}</span><span>{typeof value === 'number' ? (step < 1 ? value.toFixed(1) : value) : '—'}{unit}</span>
      </label>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 bg-slate-600 rounded appearance-none cursor-pointer" />
    </div>
  );
}
