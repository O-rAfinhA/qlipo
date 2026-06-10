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
  const [showForm,     setShowForm]     = useState(false);
  const [uploadError,  setUploadError]  = useState('');
  const [uploading,    setUploading]    = useState(false);
  const [formData,     setFormData]     = useState<Partial<Watermark>>({
    size: 20, opacity: 80, x: 75, y: 75, fadeInDuration: 0.5, fadeOutDuration: 0.5,
  });

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError('');
    setUploading(true);
    try {
      // Get presigned URL from backend
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

      // Upload directly to R2
      const putRes = await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      if (!putRes.ok) { setUploadError('Erro ao enviar imagem para o armazenamento.'); return; }

      setFormData((prev) => ({
        ...prev,
        mediaId: r2Key,
        imageUrl: `${BACKEND_URL}/api/media/preview?r2Key=${encodeURIComponent(r2Key)}`,
      }));
    } catch {
      setUploadError('Erro ao fazer upload da marca d\'água.');
    } finally {
      setUploading(false);
    }
  };

  const handleAdd = () => {
    if (!formData.mediaId || formData.size == null || formData.opacity == null) {
      setUploadError('Selecione uma imagem primeiro.');
      return;
    }
    const startAt = 3;
    const endAt   = Math.max(startAt + 1, totalDuration - 5);
    onAdd({
      id:              crypto.randomUUID(),
      mediaId:         formData.mediaId!,
      imageUrl:        formData.imageUrl,
      size:            formData.size!,
      opacity:         formData.opacity!,
      x:               formData.x ?? 75,
      y:               formData.y ?? 75,
      startAt,
      endAt,
      fadeInDuration:  formData.fadeInDuration ?? 0.5,
      fadeOutDuration: formData.fadeOutDuration ?? 0.5,
    });
    setShowForm(false);
    setFormData({ size: 20, opacity: 80, x: 75, y: 75, fadeInDuration: 0.5, fadeOutDuration: 0.5 });
    setUploadError('');
  };

  return (
    <div className="space-y-4 p-4 bg-slate-900 rounded-lg border border-slate-700">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Marca D'Água</h3>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition"
        >
          {showForm ? 'Cancelar' : 'Adicionar'}
        </button>
      </div>

      {showForm && (
        <div className="space-y-3 p-3 bg-slate-800 rounded border border-slate-600">
          {/* File Upload */}
          <div>
            <label className="text-xs text-gray-300 block mb-1">Imagem (JPG, PNG, WEBP — Max 5 MB)</label>
            <input
              type="file"
              accept=".jpg,.jpeg,.png,.webp"
              onChange={handleFileSelect}
              disabled={uploading}
              className="w-full text-xs bg-slate-700 text-white rounded px-2 py-1 border border-slate-600 disabled:opacity-50"
            />
            {uploadError && <p className="text-xs text-red-400 mt-1">{uploadError}</p>}
            {uploading   && <p className="text-xs text-zinc-400 mt-1">Enviando...</p>}
            {formData.imageUrl && !uploading && (
              <div className="mt-2 flex items-center gap-2">
                <img src={formData.imageUrl} alt="preview" className="h-8 rounded border border-slate-600 object-contain bg-slate-700" />
                <span className="text-xs text-green-400">Imagem carregada</span>
              </div>
            )}
          </div>

          {/* Size */}
          <div>
            <label className="text-xs text-gray-300 flex justify-between"><span>Tamanho</span><span>{formData.size}%</span></label>
            <input type="range" min="5" max="50" step="1" value={formData.size ?? 20}
              onChange={(e) => setFormData({ ...formData, size: Number(e.target.value) })}
              className="w-full h-1.5 bg-slate-600 rounded appearance-none cursor-pointer" />
          </div>

          {/* Opacity */}
          <div>
            <label className="text-xs text-gray-300 flex justify-between"><span>Opacidade</span><span>{formData.opacity}%</span></label>
            <input type="range" min="10" max="100" step="1" value={formData.opacity ?? 80}
              onChange={(e) => setFormData({ ...formData, opacity: Number(e.target.value) })}
              className="w-full h-1.5 bg-slate-600 rounded appearance-none cursor-pointer" />
          </div>

          {/* Fade In */}
          <div>
            <label className="text-xs text-gray-300 flex justify-between"><span>Fade In (s)</span><span>{formData.fadeInDuration?.toFixed(1)}</span></label>
            <input type="range" min="0.5" max="3" step="0.1" value={formData.fadeInDuration ?? 0.5}
              onChange={(e) => setFormData({ ...formData, fadeInDuration: Number(e.target.value) })}
              className="w-full h-1.5 bg-slate-600 rounded appearance-none cursor-pointer" />
          </div>

          {/* Fade Out */}
          <div>
            <label className="text-xs text-gray-300 flex justify-between"><span>Fade Out (s)</span><span>{formData.fadeOutDuration?.toFixed(1)}</span></label>
            <input type="range" min="0.5" max="3" step="0.1" value={formData.fadeOutDuration ?? 0.5}
              onChange={(e) => setFormData({ ...formData, fadeOutDuration: Number(e.target.value) })}
              className="w-full h-1.5 bg-slate-600 rounded appearance-none cursor-pointer" />
          </div>

          <p className="text-[10px] text-zinc-500">Após adicionar, arraste a marca d'água diretamente no preview para posicioná-la.</p>

          <button onClick={handleAdd} disabled={!formData.mediaId || uploading}
            className="w-full px-3 py-2 text-xs bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white rounded transition font-medium">
            Adicionar Marca D'Água
          </button>
        </div>
      )}

      {/* List */}
      {watermarks.map((wm) => (
        <div key={wm.id} className="p-3 bg-slate-800 rounded border border-slate-600 space-y-2">
          <div className="flex items-center justify-between gap-2">
            {wm.imageUrl && (
              <img src={wm.imageUrl} alt="wm" className="h-7 w-auto rounded border border-slate-600 object-contain bg-slate-700 shrink-0" />
            )}
            <p className="text-[10px] text-gray-400 flex-1">{wm.startAt.toFixed(1)}s – {wm.endAt.toFixed(1)}s</p>
            <button onClick={() => onRemove(wm.id)}
              className="px-2 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded shrink-0">✕</button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-gray-400 flex justify-between"><span>Tamanho</span><span>{wm.size}%</span></label>
              <input type="range" min="5" max="50" step="1" value={wm.size}
                onChange={(e) => onUpdate(wm.id, { size: Number(e.target.value) })}
                className="w-full h-1.5 bg-slate-600 rounded appearance-none cursor-pointer" />
            </div>
            <div>
              <label className="text-[10px] text-gray-400 flex justify-between"><span>Opacidade</span><span>{wm.opacity}%</span></label>
              <input type="range" min="10" max="100" step="1" value={wm.opacity}
                onChange={(e) => onUpdate(wm.id, { opacity: Number(e.target.value) })}
                className="w-full h-1.5 bg-slate-600 rounded appearance-none cursor-pointer" />
            </div>
          </div>

          <p className="text-[10px] text-zinc-600">Posição: {wm.x.toFixed(0)}% × {wm.y.toFixed(0)}% — arraste no preview para reposicionar</p>
        </div>
      ))}

      {watermarks.length === 0 && !showForm && (
        <p className="text-xs text-gray-500 text-center py-2">Nenhuma marca d'água adicionada</p>
      )}
    </div>
  );
}
