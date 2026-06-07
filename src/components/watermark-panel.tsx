'use client';

import { useState } from 'react';
import type { Watermark, WatermarkPosition, MediaItem } from '@/lib/types';

interface WatermarkPanelProps {
  watermarks: Watermark[];
  media: MediaItem[];
  totalDuration: number;
  onAdd: (watermark: Watermark) => void;
  onUpdate: (id: string, patch: Partial<Watermark>) => void;
  onRemove: (id: string) => void;
}

const POSITION_OPTIONS: WatermarkPosition[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'];
const POSITION_LABELS: Record<WatermarkPosition, string> = {
  'top-left': 'Superior Esq',
  'top-right': 'Superior Dir',
  'bottom-left': 'Inferior Esq',
  'bottom-right': 'Inferior Dir',
  'center': 'Centro',
};

function PositionSelector({
  value,
  onChange,
}: {
  value: WatermarkPosition;
  onChange: (pos: WatermarkPosition) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="text-xs text-gray-300 block">Posição</label>
      <div className="relative w-full aspect-video bg-gradient-to-br from-slate-700 to-slate-800 rounded-lg border border-slate-600">
        {/* Video frame representation */}
        <div className="absolute inset-0 p-2 pointer-events-none">
          <div className="w-full h-full border border-dashed border-slate-500 rounded opacity-50" />
        </div>

        {/* Top-left button */}
        <button
          onClick={() => onChange('top-left')}
          className={`absolute top-1.5 left-1.5 w-12 h-6 rounded text-xs font-medium transition-all z-10 ${
            value === 'top-left'
              ? 'bg-blue-600 text-white ring-2 ring-blue-400'
              : 'bg-slate-600/40 text-gray-300 hover:bg-slate-600/60'
          }`}
          title={POSITION_LABELS['top-left']}
        >
          ⬉
        </button>

        {/* Top-right button */}
        <button
          onClick={() => onChange('top-right')}
          className={`absolute top-1.5 right-1.5 w-12 h-6 rounded text-xs font-medium transition-all z-10 ${
            value === 'top-right'
              ? 'bg-blue-600 text-white ring-2 ring-blue-400'
              : 'bg-slate-600/40 text-gray-300 hover:bg-slate-600/60'
          }`}
          title={POSITION_LABELS['top-right']}
        >
          ⬈
        </button>

        {/* Center button */}
        <button
          onClick={() => onChange('center')}
          className={`absolute inset-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 rounded-full font-medium transition-all z-20 ${
            value === 'center'
              ? 'bg-blue-600 text-white ring-2 ring-blue-400'
              : 'bg-slate-600/40 text-gray-300 hover:bg-slate-600/60'
          }`}
          title={POSITION_LABELS['center']}
        >
          ◉
        </button>

        {/* Bottom-left button */}
        <button
          onClick={() => onChange('bottom-left')}
          className={`absolute bottom-1.5 left-1.5 w-12 h-6 rounded text-xs font-medium transition-all z-10 ${
            value === 'bottom-left'
              ? 'bg-blue-600 text-white ring-2 ring-blue-400'
              : 'bg-slate-600/40 text-gray-300 hover:bg-slate-600/60'
          }`}
          title={POSITION_LABELS['bottom-left']}
        >
          ⬇⬉
        </button>

        {/* Bottom-right button */}
        <button
          onClick={() => onChange('bottom-right')}
          className={`absolute bottom-1.5 right-1.5 w-12 h-6 rounded text-xs font-medium transition-all z-10 ${
            value === 'bottom-right'
              ? 'bg-blue-600 text-white ring-2 ring-blue-400'
              : 'bg-slate-600/40 text-gray-300 hover:bg-slate-600/60'
          }`}
          title={POSITION_LABELS['bottom-right']}
        >
          ⬇⬈
        </button>
      </div>

      {/* Position label */}
      <div className="text-xs text-gray-400 text-center">
        {POSITION_LABELS[value]}
      </div>
    </div>
  );
}

export function WatermarkPanel({
  watermarks,
  media,
  totalDuration,
  onAdd,
  onUpdate,
  onRemove,
}: WatermarkPanelProps) {
  const [showForm, setShowForm] = useState(false);
  const [uploadError, setUploadError] = useState<string>('');
  const [formData, setFormData] = useState<Partial<Watermark>>({
    size: 20,
    opacity: 80,
    position: 'bottom-right',
    fadeInDuration: 0.5,
    fadeOutDuration: 0.5,
  });

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setUploadError('');
      const formDataToSend = new FormData();
      formDataToSend.append('file', file);

      const response = await fetch('/api/uploads/watermark', {
        method: 'POST',
        body: formDataToSend,
      });

      if (!response.ok) {
        const error = await response.json();
        setUploadError(error.message || 'Upload failed');
        return;
      }

      const result = await response.json();
      setFormData((prev) => ({
        ...prev,
        mediaId: result.name,
        imageUrl: URL.createObjectURL(file),
      }));
    } catch (err) {
      setUploadError('Error uploading watermark');
      console.error(err);
    }
  };

  const handleAddWatermark = () => {
    if (!formData.mediaId || !formData.size || formData.opacity === undefined) {
      setUploadError('Please fill in all required fields');
      return;
    }

    const startAt = 3;
    const endAt = Math.max(startAt + 1, totalDuration - 5);

    const newWatermark: Watermark = {
      id: crypto.randomUUID(),
      mediaId: formData.mediaId,
      imageUrl: formData.imageUrl,
      size: formData.size,
      opacity: formData.opacity,
      position: formData.position || 'bottom-right',
      startAt,
      endAt,
      fadeInDuration: formData.fadeInDuration || 0.5,
      fadeOutDuration: formData.fadeOutDuration || 0.5,
    };

    onAdd(newWatermark);
    setShowForm(false);
    setFormData({
      size: 20,
      opacity: 80,
      position: 'bottom-right',
      fadeInDuration: 0.5,
      fadeOutDuration: 0.5,
    });
    setUploadError('');
  };

  const handlePositionChange = (pos: WatermarkPosition) => {
    setFormData((prev) => ({ ...prev, position: pos }));
  };

  const handleUpdateWatermark = (id: string, field: keyof Watermark, value: any) => {
    onUpdate(id, { [field]: value });
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
            <label className="text-xs text-gray-300 block mb-1">Imagem (JPG, PNG, WEBP - Max 5MB)</label>
            <input
              type="file"
              accept=".jpg,.jpeg,.png,.webp"
              onChange={handleFileSelect}
              className="w-full text-xs bg-slate-700 text-white rounded px-2 py-1 border border-slate-600"
            />
            {uploadError && <p className="text-xs text-red-400 mt-1">{uploadError}</p>}
            {formData.imageUrl && (
              <div className="mt-2 text-xs text-green-400">✓ Imagem selecionada</div>
            )}
          </div>

          {/* Size Slider */}
          <div>
            <label className="text-xs text-gray-300 flex justify-between">
              <span>Tamanho</span>
              <span>{formData.size}%</span>
            </label>
            <input
              type="range"
              min="5"
              max="50"
              step="1"
              value={formData.size || 20}
              onChange={(e) => setFormData({ ...formData, size: Number(e.target.value) })}
              className="w-full h-1.5 bg-slate-600 rounded appearance-none cursor-pointer"
            />
          </div>

          {/* Opacity Slider */}
          <div>
            <label className="text-xs text-gray-300 flex justify-between">
              <span>Opacidade</span>
              <span>{formData.opacity}%</span>
            </label>
            <input
              type="range"
              min="10"
              max="100"
              step="1"
              value={formData.opacity || 80}
              onChange={(e) => setFormData({ ...formData, opacity: Number(e.target.value) })}
              className="w-full h-1.5 bg-slate-600 rounded appearance-none cursor-pointer"
            />
          </div>

          {/* Position Selector */}
          <PositionSelector
            value={formData.position || 'bottom-right'}
            onChange={handlePositionChange}
          />

          {/* Fade In Duration */}
          <div>
            <label className="text-xs text-gray-300 flex justify-between">
              <span>Fade In (s)</span>
              <span>{formData.fadeInDuration?.toFixed(1)}</span>
            </label>
            <input
              type="range"
              min="0.5"
              max="3"
              step="0.1"
              value={formData.fadeInDuration || 0.5}
              onChange={(e) => setFormData({ ...formData, fadeInDuration: Number(e.target.value) })}
              className="w-full h-1.5 bg-slate-600 rounded appearance-none cursor-pointer"
            />
          </div>

          {/* Fade Out Duration */}
          <div>
            <label className="text-xs text-gray-300 flex justify-between">
              <span>Fade Out (s)</span>
              <span>{formData.fadeOutDuration?.toFixed(1)}</span>
            </label>
            <input
              type="range"
              min="0.5"
              max="3"
              step="0.1"
              value={formData.fadeOutDuration || 0.5}
              onChange={(e) => setFormData({ ...formData, fadeOutDuration: Number(e.target.value) })}
              className="w-full h-1.5 bg-slate-600 rounded appearance-none cursor-pointer"
            />
          </div>

          {/* Add Button */}
          <button
            onClick={handleAddWatermark}
            className="w-full px-3 py-2 text-xs bg-green-600 hover:bg-green-700 text-white rounded transition font-medium"
          >
            Adicionar Marca D'Água
          </button>
        </div>
      )}

      {/* Watermark List */}
      {watermarks.length > 0 && (
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {watermarks.map((wm) => (
            <div key={wm.id} className="p-3 bg-slate-800 rounded border border-slate-600 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white truncate">{wm.mediaId}</p>
                  <p className="text-xs text-gray-400">
                    {wm.startAt.toFixed(1)}s - {wm.endAt.toFixed(1)}s
                  </p>
                </div>
                <button
                  onClick={() => onRemove(wm.id)}
                  className="px-2 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded"
                >
                  ✕
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <label className="text-gray-400">Tamanho</label>
                  <input
                    type="range"
                    min="5"
                    max="50"
                    step="1"
                    value={wm.size}
                    onChange={(e) => handleUpdateWatermark(wm.id, 'size', Number(e.target.value))}
                    className="w-full h-1.5 bg-slate-600 rounded appearance-none cursor-pointer"
                  />
                  <p className="text-gray-500 text-xs">{wm.size}%</p>
                </div>
                <div>
                  <label className="text-gray-400">Opacidade</label>
                  <input
                    type="range"
                    min="10"
                    max="100"
                    step="1"
                    value={wm.opacity}
                    onChange={(e) => handleUpdateWatermark(wm.id, 'opacity', Number(e.target.value))}
                    className="w-full h-1.5 bg-slate-600 rounded appearance-none cursor-pointer"
                  />
                  <p className="text-gray-500 text-xs">{wm.opacity}%</p>
                </div>
              </div>

              <PositionSelector
                value={wm.position}
                onChange={(pos) => handleUpdateWatermark(wm.id, 'position', pos)}
              />
            </div>
          ))}
        </div>
      )}

      {watermarks.length === 0 && !showForm && (
        <p className="text-xs text-gray-500 text-center py-2">Nenhuma marca d'água adicionada</p>
      )}
    </div>
  );
}
