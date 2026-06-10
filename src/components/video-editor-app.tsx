'use client';

import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import clsx from "clsx";
import { AlertCircle, CheckCircle2, Download, Film, FolderOpen, LoaderCircle, Music4, Sparkles, Upload, Wand2 } from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";

import { PreviewPlayer } from "@/components/preview-player";
import { MediaThumbnail } from "@/components/media-thumbnail";
import { SortableTrack } from "@/components/sortable-track";
import { TimelineEditor } from "@/components/timeline-editor";
import { analyzeBeat, analyzeMusicalEvents } from "@/lib/beat-detection";
import { ColorGradePanel } from "@/components/color-grade-panel";
import { COLOR_GRADE_PRESETS } from "@/lib/color-grade-presets";
import { analyzeWarmthBatch } from "@/lib/image-analysis";
import { OutputOptionsPanel } from "@/components/output-options-panel";
import { WatermarkPanel } from "@/components/watermark-panel";
import {
  didSessionCrash, downloadProjectFile, loadFromLocalStorage,
  markSessionEnd, markSessionStart, readProjectFile, serializeProject,
} from "@/lib/project-serializer";
import { useAutoSave } from "@/hooks/use-auto-save";
import { readMediaDuration, formatBytes } from "@/lib/browser-media";
import { exportPresets, secondsLabel, summarizeComposition } from "@/lib/media-rules";
import type { ExportPreset, RenderJob, UploadValidationResponse } from "@/lib/types";
import { useEditorStore, usePresetMetadata } from "@/store/editor-store";
import { UserButton } from "@clerk/nextjs";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";

async function validateFiles(files: File[], token: string) {
  const response = await fetch(`${BACKEND_URL}/api/uploads/validar`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      files: files.map((file) => ({ name: file.name, sizeBytes: file.size, mimeType: file.type })),
    }),
  });
  return (await response.json()) as UploadValidationResponse;
}

async function uploadFiles(files: File[], token: string): Promise<Record<string, { r2Key: string; previewUrl?: string }>> {
  // Request presigned URLs for all files at once
  const urlsRes = await fetch(`${BACKEND_URL}/api/upload-urls`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ files: files.map((f) => ({ filename: f.name, contentType: f.type || "application/octet-stream" })) }),
  });
  if (!urlsRes.ok) throw new Error("Falha ao obter URLs de upload.");
  const { files: urlData } = (await urlsRes.json()) as { files: { filename: string; uploadUrl: string; r2Key: string }[] };

  // Upload each file directly to R2
  await Promise.all(
    files.map((file) => {
      const entry = urlData.find((u) => u.filename === file.name);
      if (!entry) throw new Error(`URL nao encontrada para ${file.name}`);
      return fetch(entry.uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type || "application/octet-stream" } });
    }),
  );

  return Object.fromEntries(
    urlData.map(({ filename, r2Key }) => [
      filename,
      { r2Key, previewUrl: `${BACKEND_URL}/api/media/preview?r2Key=${encodeURIComponent(r2Key)}` },
    ]),
  );
}

export function VideoEditorApp() {
  const { getToken } = useAuth();
  const inputRef        = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const sourceRef       = useRef<EventSource | null>(null);
  const [errorMessage,    setErrorMessage]    = useState<string>();
  const [dragging,        setDragging]        = useState(false);
  const [uploading,       setUploading]       = useState(false);
  const [pxPerSec,        setPxPerSec]        = useState(80);
  const [previewHeight,   setPreviewHeight]   = useState(220);
  const [showRestoreBanner,  setShowRestoreBanner]  = useState(false);
  const [selectedVisualId,   setSelectedVisualId]   = useState<string | null>(null);

  // ── Beat analysis state ────────────────────────────────────────────────────
  const [beats,            setBeats]            = useState<number[]>([]);
  const [bpm,              setBpm]              = useState(0);
  const [analyzingBeats,   setAnalyzingBeats]   = useState(false);

  // ── Musical events (section changes: solos, riffs, melody entries) ─────────
  const [musicalEvents,    setMusicalEvents]    = useState<number[]>([]);
  const [analyzingEvents,  setAnalyzingEvents]  = useState(false);

  // ── Playback state ─────────────────────────────────────────────────────────
  const [playheadAt, setPlayheadAt] = useState(0);
  const [isPlaying,  setIsPlaying]  = useState(false);

  const playheadRef   = useRef(0);
  const totalDurRef   = useRef(0);
  const isPlayingRef  = useRef(false);
  const rafRef        = useRef<number | null>(null);
  const lastTsRef     = useRef<number | null>(null);
  const togglePlayRef = useRef<() => void>(() => {});

  function setPlayhead(t: number) {
    playheadRef.current = t;
    setPlayheadAt(t);
  }

  function tick(ts: number) {
    if (!isPlayingRef.current) return;
    if (lastTsRef.current !== null) {
      const dt   = (ts - lastTsRef.current) / 1000;
      const next = Math.min(playheadRef.current + dt, totalDurRef.current);
      setPlayhead(next);
      if (next >= totalDurRef.current) {
        isPlayingRef.current = false;
        setIsPlaying(false);
        lastTsRef.current = null;
        return;
      }
    }
    lastTsRef.current = ts;
    rafRef.current = requestAnimationFrame(tick);
  }

  function togglePlay() {
    if (isPlayingRef.current) {
      isPlayingRef.current = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      lastTsRef.current = null;
      setIsPlaying(false);
    } else {
      if (playheadRef.current >= totalDurRef.current) setPlayhead(0);
      isPlayingRef.current = true;
      lastTsRef.current    = null;
      setIsPlaying(true);
      rafRef.current = requestAnimationFrame(tick);
    }
  }
  togglePlayRef.current = togglePlay;

  function stopPlayback() {
    isPlayingRef.current = false;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    lastTsRef.current = null;
    setIsPlaying(false);
    setPlayhead(0);
  }

  // Cleanup RAF on unmount
  useEffect(() => {
    return () => {
      isPlayingRef.current = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Space bar = play/pause
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const target = e.target as HTMLElement;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable) return;
      e.preventDefault();
      togglePlayRef.current();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => { return () => { sourceRef.current?.close(); }; }, []);

  // ── Store ──────────────────────────────────────────────────────────────────
  const preset        = useEditorStore((s) => s.preset);
  const media         = useEditorStore((s) => s.media);
  const visuals       = useEditorStore((s) => s.visuals);
  const audios        = useEditorStore((s) => s.audios);
  const projectBytes  = useEditorStore((s) => s.projectBytes);
  const processing    = useEditorStore((s) => s.processing);
  const progress      = useEditorStore((s) => s.progress);
  const progressMessage = useEditorStore((s) => s.progressMessage);
  const downloadUrl   = useEditorStore((s) => s.downloadUrl);
  const activeJobId   = useEditorStore((s) => s.activeJobId);
  const simulationMode = useEditorStore((s) => s.simulationMode);
  const editMode      = useEditorStore((s) => s.editMode);
  const mediaOrder    = useEditorStore((s) => s.mediaOrder);

  const syncClipsToEvents       = useEditorStore((s) => s.syncClipsToEvents);
  const loadProject             = useEditorStore((s) => s.loadProject);
  const clearProject            = useEditorStore((s) => s.clearProject);
  const textOverlays            = useEditorStore((s) => s.textOverlays);
  const addTextOverlay          = useEditorStore((s) => s.addTextOverlay);
  const updateTextOverlay       = useEditorStore((s) => s.updateTextOverlay);
  const removeTextOverlay       = useEditorStore((s) => s.removeTextOverlay);
  const watermarks              = useEditorStore((s) => s.watermarks);
  const addWatermark            = useEditorStore((s) => s.addWatermark);
  const updateWatermark         = useEditorStore((s) => s.updateWatermark);
  const removeWatermark         = useEditorStore((s) => s.removeWatermark);
  const colorGradePresetId        = useEditorStore((s) => s.colorGradePresetId);
  const setColorGradePreset       = useEditorStore((s) => s.setColorGradePreset);
  const applyColorGradeToAllClips = useEditorStore((s) => s.applyColorGradeToAllClips);
  const applyColorGradeToClip     = useEditorStore((s) => s.applyColorGradeToClip);
  const outputOptions             = useEditorStore((s) => s.outputOptions);
  const setOutputOptions          = useEditorStore((s) => s.setOutputOptions);
  const setPreset               = useEditorStore((s) => s.setPreset);
  const setMediaOrder        = useEditorStore((s) => s.setMediaOrder);
  const setEditMode          = useEditorStore((s) => s.setEditMode);
  const ingestFiles          = useEditorStore((s) => s.ingestFiles);
  const moveVisual           = useEditorStore((s) => s.moveVisual);
  const moveAudio            = useEditorStore((s) => s.moveAudio);
  const removeMedia          = useEditorStore((s) => s.removeMedia);
  const updateVisualDuration = useEditorStore((s) => s.updateVisualDuration);
  const updateVisualFade     = useEditorStore((s) => s.updateVisualFade);
  const setVisualPosition    = useEditorStore((s) => s.setVisualPosition);
  const setAudioPosition     = useEditorStore((s) => s.setAudioPosition);
  const updateVisualProp       = useEditorStore((s) => s.updateVisualProp);
  const updateVisualTransition = useEditorStore((s) => s.updateVisualTransition);
  const updateAudioProp        = useEditorStore((s) => s.updateAudioProp);
  const setProcessingState     = useEditorStore((s) => s.setProcessingState);
  const autoEnhancements       = useEditorStore((s) => s.autoEnhancements);
  const setAutoEnhancements    = useEditorStore((s) => s.setAutoEnhancements);
  const reorderVisuals         = useEditorStore((s) => s.reorderVisuals);

  // ── Auto-save (debounced 1 s, skips empty projects) ───────────────────────
  useAutoSave({ preset, editMode, mediaOrder, colorGradePresetId, media, visuals, audios, textOverlays, watermarks });

  // On mount: restore last session automatically, then mark session active
  useEffect(() => {
    const saved = loadFromLocalStorage();
    if (saved && saved.media.length > 0) {
      loadProject(saved);
    }
    markSessionStart();
    const onUnload = () => markSessionEnd();
    window.addEventListener("beforeunload", onUnload);
    return () => { window.removeEventListener("beforeunload", onUnload); markSessionEnd(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Project save / open handlers ──────────────────────────────────────────
  function handleSaveProject() {
    const data = serializeProject({ preset, editMode, mediaOrder, colorGradePresetId, media, visuals, audios, textOverlays, watermarks });
    downloadProjectFile(data);
  }

  async function handleOpenProject(file: File) {
    try {
      const data = await readProjectFile(file);
      loadProject(data);
      setShowRestoreBanner(false);
    } catch {
      setErrorMessage("Arquivo de projeto inválido ou corrompido.");
    }
  }

  function handleRestoreSession() {
    const saved = loadFromLocalStorage();
    if (saved) { loadProject(saved); }
    setShowRestoreBanner(false);
  }

  // Build auto enhancements with live colorGrade from active preset
  const activeColorGrade = useMemo(() => {
    if (!colorGradePresetId) return undefined;
    const p = COLOR_GRADE_PRESETS.find((x) => x.id === colorGradePresetId);
    return p ? { brightness: p.brightness, contrast: p.contrast, saturation: p.saturation, blur: p.blur } : undefined;
  }, [colorGradePresetId]);

  const summary     = useMemo(
    () => summarizeComposition(
      media, visuals, audios,
      editMode === "auto" ? mediaOrder : "sequential",
      editMode === "auto" ? musicalEvents : [],
      editMode === "auto" ? bpm : 0,
      editMode === "auto" ? beats : [],
      editMode === "auto" ? { ...autoEnhancements, colorGrade: activeColorGrade } : {},
    ),
    [media, visuals, audios, editMode, mediaOrder, musicalEvents, bpm, beats, autoEnhancements, activeColorGrade],
  );

  // Keep totalDur ref in sync with computed summary
  totalDurRef.current = summary.totalVideoSeconds;

  // Reset playhead if project shrinks and playhead is past the end
  useEffect(() => {
    if (playheadAt > summary.totalVideoSeconds && summary.totalVideoSeconds > 0) {
      setPlayhead(0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary.totalVideoSeconds]);
  const presetMeta  = usePresetMetadata();
  const invalidCount = useMemo(() => media.filter((m) => !m.valid).length, [media]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  // ── File handling ──────────────────────────────────────────────────────────

  async function processSelectedFiles(fileList: FileList | null) {
    if (!fileList?.length) return;
    const files = Array.from(fileList);
    setUploading(true);
    setErrorMessage(undefined);
    try {
      const token = await getToken() ?? "";
      const [durations, r2Paths] = await Promise.all([
        Promise.all(files.map(readMediaDuration)),
        uploadFiles(files, token),
      ]);
      const enhanced = files.map((file, i) =>
        Object.assign(file, {
          durationSeconds: durations[i],
          r2Key: r2Paths[file.name]?.r2Key,
          previewUrl: r2Paths[file.name]?.previewUrl,
        }),
      );
      const validation = await validateFiles(files, token);
      ingestFiles(enhanced, validation);
      setErrorMessage(
        validation.files.some((e) => !e.valid) ? "Alguns arquivos foram rejeitados." : undefined,
      );
    } catch (err) {
      console.error("[upload]", err);
      setErrorMessage("Erro ao enviar os arquivos. Tente novamente.");
    } finally {
      setUploading(false);
    }
  }

  // ── Helper: get first audio with preview ─────────────────────────────────

  function getFirstAudio() {
    return audios
      .map((a) => media.find((m) => m.id === a.mediaId))
      .find((m) => m?.kind === "audio" && m.previewUrl) ?? null;
  }

  // ── Beat mode: detecta BPM + timestamps exatos de batida ─────────────────
  // Clips trocam exatamente no tempo de cada batida (2, 4 ou 8 beats por clip).

  async function handleActivateBeat() {
    const audioItem = getFirstAudio();
    if (!audioItem?.previewUrl) return;

    // Desativa Rock se estiver ativo
    setMusicalEvents([]);
    setAnalyzingBeats(true);
    setBeats([]);
    setBpm(0);
    try {
      const result = await analyzeBeat(audioItem.previewUrl);
      setBpm(result.bpm);
      setBeats(result.beats);
    } catch (e) {
      console.error("[beat]", e);
    } finally {
      setAnalyzingBeats(false);
    }
  }

  function handleDeactivateBeat() {
    setBeats([]); setBpm(0);
  }

  // ── Rock mode: detecta seções musicais (solos, riffs, melodias) ───────────
  // Clips trocam nos momentos em que entram novos instrumentos ou seções.

  async function handleActivateRock() {
    const audioItem = getFirstAudio();
    if (!audioItem?.previewUrl) return;

    // Desativa Beat se estiver ativo
    setBeats([]); setBpm(0);
    setAnalyzingEvents(true);
    setMusicalEvents([]);
    try {
      const events = await analyzeMusicalEvents(audioItem.previewUrl);
      setMusicalEvents(events);
      if (editMode === "manual") {
        syncClipsToEvents(events, summary.totalVideoSeconds || audioItem.durationSeconds);
      }
    } catch (e) {
      console.error("[rock]", e);
    } finally {
      setAnalyzingEvents(false);
    }
  }

  function handleDeactivateRock() {
    setMusicalEvents([]);
  }

  // ── Temperatura de cor: analisa e reordena imagens (quente → frio) ────────

  const [sortingTemp, setSortingTemp] = useState(false);
  const [tempDirection, setTempDirection] = useState<"warm-cool" | "cool-warm" | null>(null);

  async function handleSortByTemperature(direction: "warm-cool" | "cool-warm") {
    setSortingTemp(true);
    try {
      const warmthMap = await analyzeWarmthBatch(media);
      const imageVisuals = visuals.filter((v) => {
        const m = media.find((mi) => mi.id === v.mediaId);
        return m?.kind === "image";
      });
      const videoVisuals = visuals.filter((v) => {
        const m = media.find((mi) => mi.id === v.mediaId);
        return m?.kind !== "image";
      });

      // Sort image visuals by warmth
      const sorted = [...imageVisuals].sort((a, b) => {
        const wa = warmthMap.get(a.mediaId) ?? 0;
        const wb = warmthMap.get(b.mediaId) ?? 0;
        return direction === "warm-cool" ? wb - wa : wa - wb;
      });

      // Rebuild order: sorted images first, then videos
      const allSorted = [...sorted, ...videoVisuals];
      reorderVisuals(allSorted.map((v) => v.id));
      setTempDirection(direction);
    } catch (e) {
      console.error("[temperature-sort]", e);
    } finally {
      setSortingTemp(false);
    }
  }

  // Keep legacy callbacks for manual-mode toolbar (still used by TimelineEditor)
  const handleAnalyzeBeats = handleActivateBeat;
  const handleSyncToMusic  = handleActivateRock;

  // ── Render ─────────────────────────────────────────────────────────────────

  async function handleRender() {
    setProcessingState({ processing: true, progress: 5, progressMessage: "Criando job de renderizacao", downloadUrl: undefined });
    try {
      const token = await getToken() ?? "";
      const response = await fetch(`${BACKEND_URL}/api/renders`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          preset, media, visuals, audios, mediaOrder,
          bpm: bpm > 0 ? bpm : undefined,
          textOverlays: textOverlays.length > 0 ? textOverlays : undefined,
          outputOptions,
        }),
      });
      const payload = await response.json() as { jobId?: string; error?: string };
      if (!response.ok || !payload.jobId) {
        const msg = payload.error ?? `Erro HTTP ${response.status}`;
        console.error("[render] POST falhou:", msg);
        setProcessingState({ processing: false, progress: 0, progressMessage: `Erro: ${msg}` });
        return;
      }
      setProcessingState({ activeJobId: payload.jobId });

      sourceRef.current?.close();
      const source = new EventSource(`${BACKEND_URL}/api/renders/${payload.jobId}/stream`);
      sourceRef.current = source;

      source.onmessage = (event) => {
        const job = JSON.parse(event.data) as RenderJob;
        setProcessingState({
          processing: job.stage !== "finalizado" && job.stage !== "erro",
          progress: job.progress,
          progressMessage: job.message,
          downloadUrl: job.downloadUrl,
          activeJobId: job.jobId,
          simulationMode: job.mode === "simulation",
        });
        if (job.stage === "finalizado" || job.stage === "erro") {
          source.close();
          sourceRef.current = null;
        }
      };
      source.onerror = async (e) => {
        console.error("[render] SSE erro:", e);
        source.close();
        sourceRef.current = null;
        // Poll once to catch the result if the SSE dropped after the job finished
        try {
          const res = await fetch(`${BACKEND_URL}/api/renders/${payload.jobId}`);
          if (res.ok) {
            const job = await res.json() as RenderJob;
            if (job.stage === "finalizado" || job.stage === "erro") {
              setProcessingState({
                processing: false,
                progress: job.progress,
                progressMessage: job.message,
                downloadUrl: job.downloadUrl,
                simulationMode: job.mode === "simulation",
              });
              return;
            }
          }
        } catch { /* ignore poll error */ }
        setProcessingState({ processing: false, progressMessage: "Erro na conexao com o servidor." });
      };
    } catch (err) {
      console.error("[render] Excecao:", err);
      setProcessingState({ processing: false, progress: 0, progressMessage: `Erro: ${err instanceof Error ? err.message : "Falha ao conectar com o backend"}` });
    }
  }

  // ── Drag-to-reorder (auto mode) ────────────────────────────────────────────

  function onDragEnd(event: DragEndEvent, mode: "visual" | "audio") {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    if (mode === "visual") { moveVisual(String(active.id), String(over.id)); return; }
    moveAudio(String(active.id), String(over.id));
  }

  // ── Mode toggle ────────────────────────────────────────────────────────────

  function handleSetEditMode(mode: "auto" | "manual") {
    setEditMode(mode, summary);
  }

  // ─── Shared input class ───────────────────────────────────────────────────
  const inputCls = "w-14 rounded border border-white/[0.08] bg-white/[0.04] px-1.5 py-1 text-[10px] text-zinc-300 focus:border-white/20 focus:outline-none";

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#0a0a0b] text-zinc-100">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="flex h-[52px] shrink-0 items-center gap-4 border-b border-white/[0.06] px-5">
        <div className="flex items-center gap-2.5">
          <Image src="/qlipo-logo.png" alt="Qlipo" width={32} height={32} priority />
          <span className="text-sm font-semibold tracking-tight text-white">Qlipo</span>
        </div>
        <div className="h-3.5 w-px bg-white/[0.08]" />
        <div className="flex items-center gap-2 font-mono text-xs text-zinc-600">
          <span>{formatBytes(projectBytes)}</span>
          <span className="text-zinc-800">·</span>
          <span>{secondsLabel(summary.totalVideoSeconds)}</span>
          {media.length > 0 && (
            <>
              <span className="text-zinc-800">·</span>
              <span>{media.length} {media.length === 1 ? "arquivo" : "arquivos"}</span>
            </>
          )}
        </div>
        {/* Save / Open buttons */}
        <div className="flex items-center gap-1">
          <button type="button" onClick={handleSaveProject} title="Salvar projeto (.qlipo.json)"
            className="flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[10px] font-medium text-zinc-600 hover:bg-white/[0.04] hover:text-zinc-300 transition-all">
            <Download className="h-3 w-3" /> Salvar
          </button>
          <button type="button" onClick={() => projectInputRef.current?.click()} title="Abrir projeto"
            className="flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[10px] font-medium text-zinc-600 hover:bg-white/[0.04] hover:text-zinc-300 transition-all">
            <FolderOpen className="h-3 w-3" /> Abrir
          </button>
        </div>

        <div className="ml-auto">
          {simulationMode ? (
            <span
              title="Os arquivos ainda não foram enviados ao servidor. Ao exportar, apenas o progresso será simulado — nenhum vídeo real será gerado."
              className="flex cursor-default items-center gap-1.5 rounded-full border border-amber-400/20 bg-amber-400/[0.06] px-2.5 py-[3px]"
            >
              <AlertCircle className="h-3 w-3 text-amber-400/50" />
              <span className="text-[10px] font-medium text-amber-300/60">Sem vídeo de saída</span>
            </span>
          ) : (
            <span className="flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/[0.05] px-2.5 py-[3px]">
              <CheckCircle2 className="h-3 w-3 text-emerald-400/60" />
              <span className="text-[10px] font-medium text-emerald-300/70">Pronto para exportar</span>
            </span>
          )}
        </div>
        <div className="h-3.5 w-px bg-white/[0.08]" />
        <UserButton appearance={{ elements: { avatarBox: "h-7 w-7" } }} />
      </header>

      {/* ── Restore session banner ──────────────────────────────────────── */}
      {showRestoreBanner && (
        <div className="flex shrink-0 items-center gap-3 border-b border-cyan-400/20 bg-cyan-400/[0.05] px-5 py-2.5">
          <span className="text-[11px] text-cyan-300/80">Sessão anterior encontrada.</span>
          <button type="button" onClick={handleRestoreSession}
            className="rounded bg-cyan-400/15 px-2.5 py-1 text-[10px] font-semibold text-cyan-300 hover:bg-cyan-400/25 transition-all">
            Restaurar
          </button>
          <button type="button" onClick={() => setShowRestoreBanner(false)}
            className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-all">
            Ignorar
          </button>
        </div>
      )}

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Left sidebar ──────────────────────────────────────────────── */}
        <aside className="flex w-[256px] shrink-0 flex-col overflow-hidden border-r border-white/[0.06]">

          {/* Upload zone */}
          <div className="shrink-0 border-b border-white/[0.06] p-3">
            <div
              className={clsx(
                "flex cursor-pointer flex-col items-center gap-2.5 rounded-lg border border-dashed p-5 text-center transition-all duration-150",
                dragging ? "border-cyan-400/40 bg-cyan-400/[0.04]"
                  : uploading ? "border-white/10 bg-white/[0.02]"
                  : "border-white/[0.08] hover:border-white/[0.14] hover:bg-white/[0.02]",
              )}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={async (e) => { e.preventDefault(); setDragging(false); await processSelectedFiles(e.dataTransfer.files); }}
              onClick={() => !uploading && inputRef.current?.click()}
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04]">
                {uploading
                  ? <LoaderCircle className="h-3.5 w-3.5 animate-spin text-cyan-400" />
                  : <Upload className="h-3.5 w-3.5 text-zinc-600" />
                }
              </div>
              <div>
                <p className="text-[11px] font-medium text-zinc-400">
                  {uploading ? "Enviando..." : dragging ? "Soltar aqui" : "Soltar ou clicar"}
                </p>
                <p className="mt-0.5 text-[10px] text-zinc-700">
                  {uploading ? "Aguarde…" : "JPG · PNG · MP4 · MP3 · WAV"}
                </p>
              </div>
            </div>
            <input ref={inputRef} type="file" multiple className="hidden"
              onChange={(e) => void processSelectedFiles(e.target.files)} />
            <input ref={projectInputRef} type="file" accept=".json,.qlipo.json" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleOpenProject(f); e.target.value = ""; }} />
            {errorMessage && <p className="mt-2 text-[10px] leading-relaxed text-red-400">{errorMessage}</p>}
          </div>

          {/* File library */}
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center justify-between border-b border-white/[0.04] px-4 py-2">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-700">Arquivos</span>
              {media.length > 0 && (
                <span className="rounded-full bg-white/[0.06] px-2 py-px text-[10px] text-zinc-500">{media.length}</span>
              )}
            </div>
            <div className="flex-1 overflow-y-auto">
              {media.length === 0 ? (
                <div className="flex h-full min-h-[72px] items-center justify-center">
                  <p className="text-[10px] text-zinc-800">Nenhum arquivo adicionado</p>
                </div>
              ) : (
                media.map((item) => (
                  <div key={item.id} className="flex items-center gap-2.5 border-b border-white/[0.04] px-4 py-2.5 hover:bg-white/[0.02]">
                    <MediaThumbnail item={item} className="h-11 w-11 shrink-0" />
                    <span className={clsx(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded text-[9px] font-bold uppercase",
                      item.kind === "image" ? "bg-orange-400/10 text-orange-300" :
                      item.kind === "video" ? "bg-cyan-400/10 text-cyan-300" :
                      "bg-violet-400/10 text-violet-300",
                    )}>
                      {item.kind[0].toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] font-medium text-zinc-400">{item.name}</p>
                      <p className="text-[10px] text-zinc-700">{formatBytes(item.sizeBytes)} · {secondsLabel(item.durationSeconds)}</p>
                    </div>
                    {!item.valid && <span className="shrink-0 text-[10px] font-semibold text-red-400">!</span>}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Automations */}
          <div className="shrink-0 border-t border-white/[0.06] p-4">
            <div className="mb-2 flex items-center gap-1.5">
              <Wand2 className="h-3 w-3 text-zinc-700" />
              <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-700">Automações</span>
            </div>
            <ul className="space-y-0.5 text-[10px] leading-relaxed text-zinc-700">
              <li>Fade 1 s · Crossfade 2 s</li>
              <li>Alvo −14 dB · Pico −1 dB</li>
              <li>Loop e corte automático de áudio</li>
            </ul>
          </div>
        </aside>

        {/* ── Center: Timeline ─────────────────────────────────────────────── */}
        <main className="flex flex-1 flex-col overflow-hidden">

          {/* Mode toggle header */}
          <div className="flex shrink-0 items-center gap-3 border-b border-white/[0.06] px-5 py-2.5">
            {editMode === "auto" ? (
              <>
                <Film className="h-3.5 w-3.5 text-orange-400/60" />
                <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600">Timeline</span>
                <span className="ml-2 text-[10px] text-zinc-800">
                  {summary.visualSegments.length} seg · {secondsLabel(summary.totalVideoSeconds)}
                </span>
              </>
            ) : (
              <>
                <Film className="h-3.5 w-3.5 text-cyan-400/60" />
                <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600">Editor Manual</span>
                <span className="ml-2 text-[10px] text-zinc-800">
                  {secondsLabel(summary.totalVideoSeconds)} · {pxPerSec}px/s
                </span>
              </>
            )}

            <div className="ml-auto flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-700">
                Preview
              </span>
              <input
                type="range"
                min="180"
                max="420"
                step="20"
                value={previewHeight}
                onChange={(e) => setPreviewHeight(Number(e.target.value))}
                className="h-1.5 w-24 accent-white"
                aria-label="Tamanho do preview"
              />
              <span className="w-12 text-right font-mono text-[10px] text-zinc-500">
                {previewHeight}px
              </span>
            </div>

            {/* Auto / Manual toggle */}
            <div className="flex items-center rounded-full border border-white/[0.08] bg-white/[0.03] p-0.5">
              {(["auto", "manual"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => handleSetEditMode(m)}
                  className={clsx(
                    "rounded-full px-3 py-1 text-[10px] font-semibold transition-all duration-150",
                    editMode === m
                      ? "bg-white/[0.10] text-zinc-200"
                      : "text-zinc-600 hover:text-zinc-400",
                  )}
                >
                  {m === "auto" ? "Auto" : "Manual"}
                </button>
              ))}
            </div>
          </div>

          {/* ── Auto mode: preview + vertical sortable lists ────────────── */}
          {editMode === "auto" && (
            <div className="flex flex-1 flex-col overflow-hidden">
            <PreviewPlayer
                playheadAt={playheadAt}
                isPlaying={isPlaying}
                totalDuration={summary.totalVideoSeconds}
                segments={summary.visualSegments}
                audioSegments={summary.audioSegments}
                media={media}
                presetWidth={presetMeta.width}
                presetHeight={presetMeta.height}
                viewportHeight={previewHeight}
                textOverlays={textOverlays}
                watermarks={watermarks}
                syncBeats={editMode === "auto" ? beats : []}
                syncEvents={editMode === "auto" ? musicalEvents : []}
                onPlayheadChange={setPlayhead}
                onPlayToggle={togglePlay}
                onStop={stopPlayback}
                onViewportHeightChange={setPreviewHeight}
              />

              {/* ── Sync mode toolbar (auto mode) ──────────────────────── */}
              {audios.length > 0 && (
                <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] bg-[#0d0d10] px-4 py-2">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-700">
                    Sincronizar
                  </span>
                  <div className="h-3 w-px bg-white/[0.08]" />

                  {/* ── BEAT: troca nos timestamps exatos de cada batida ── */}
                  {beats.length > 0 ? (
                    <div className="flex items-center gap-1.5">
                      <span className="flex items-center gap-1.5 rounded bg-cyan-400/10 px-2.5 py-1 text-[10px] font-semibold text-cyan-400">
                        <span className="font-bold">♩</span>
                        Beat — {bpm} BPM
                      </span>
                      <button type="button" onClick={handleDeactivateBeat}
                        title="Desativar modo Beat"
                        className="text-[11px] text-zinc-600 hover:text-zinc-400">✕</button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={analyzingBeats || musicalEvents.length > 0}
                      onClick={handleActivateBeat}
                      title="Beat — clipes trocam nos timestamps exatos de cada batida"
                      className={clsx(
                        "flex items-center gap-1.5 rounded px-2.5 py-1 text-[10px] font-medium transition-all",
                        analyzingBeats ? "cursor-wait opacity-60 text-cyan-400" : "text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300",
                        musicalEvents.length > 0 && "opacity-30 cursor-not-allowed",
                      )}
                    >
                      {analyzingBeats
                        ? <LoaderCircle className="h-3 w-3 animate-spin" />
                        : <span className="font-bold">♩</span>}
                      Beat
                    </button>
                  )}

                  <div className="h-3 w-px bg-white/[0.08]" />

                  {/* ── ROCK: troca nos inícios de seções musicais ──────── */}
                  {musicalEvents.length > 0 ? (
                    <div className="flex items-center gap-1.5">
                      <span className="flex items-center gap-1.5 rounded bg-violet-400/10 px-2.5 py-1 text-[10px] font-semibold text-violet-400">
                        <Wand2 className="h-3 w-3" />
                        Rock — {musicalEvents.length} seções
                      </span>
                      <button type="button" onClick={handleDeactivateRock}
                        title="Desativar modo Rock"
                        className="text-[11px] text-zinc-600 hover:text-zinc-400">✕</button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={analyzingEvents || beats.length > 0}
                      onClick={handleActivateRock}
                      title="Rock — clipes trocam quando entram solos, riffs ou novas seções"
                      className={clsx(
                        "flex items-center gap-1.5 rounded px-2.5 py-1 text-[10px] font-medium transition-all",
                        analyzingEvents ? "cursor-wait opacity-60 text-violet-400" : "text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300",
                        beats.length > 0 && "opacity-30 cursor-not-allowed",
                      )}
                    >
                      {analyzingEvents
                        ? <LoaderCircle className="h-3 w-3 animate-spin" />
                        : <Wand2 className="h-3 w-3" />}
                      Rock
                    </button>
                  )}

                  <div className="ml-auto text-[10px] text-zinc-700">
                    {beats.length > 0
                      ? "Trocas nas batidas exatas"
                      : musicalEvents.length > 0
                        ? "Trocas nas seções musicais"
                        : "Clique em Beat ou Rock para sincronizar"}
                  </div>
                </div>
              )}

              {/* ── Enhancement toolbar (auto mode) ─────────────────────── */}
              {editMode === "auto" && (
                <div className="flex shrink-0 items-center gap-3 border-b border-white/[0.06] bg-[#0d0d10] px-4 py-2.5">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-700">
                    Aprimoramentos
                  </span>
                  <div className="h-3 w-px bg-white/[0.08]" />

                  {/* ── Color Grade ── */}
                  <div className="flex items-center gap-1.5">
                    <select
                      value={colorGradePresetId ?? "neutral"}
                      onChange={(e) => setColorGradePreset(e.target.value === "neutral" ? null : e.target.value)}
                      className="rounded border border-white/[0.08] bg-[#0d0d10] px-2 py-1 text-[10px] text-zinc-400 focus:border-white/20 focus:outline-none hover:text-zinc-300"
                      title="Aplicar cor a todo o vídeo"
                    >
                      {COLOR_GRADE_PRESETS.map((p) => (
                        <option key={p.id} value={p.id}>{p.label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="h-3 w-px bg-white/[0.08]" />

                  {/* ── Temperature Sort ── */}
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={sortingTemp || media.filter((m) => m.kind === "image").length === 0}
                      onClick={() => handleSortByTemperature("warm-cool")}
                      title="Ordenar imagens: quente → frio"
                      className={clsx(
                        "rounded px-1.5 py-1 text-[10px] font-medium transition-all border",
                        sortingTemp ? "cursor-wait opacity-60 text-amber-400" :
                        tempDirection === "warm-cool" ? "border-amber-400/20 bg-amber-400/10 text-amber-300" :
                        "border-white/[0.06] text-zinc-600 hover:bg-white/[0.04] hover:text-zinc-400",
                      )}
                    >
                      {sortingTemp ? "..." : "🔥→❄"}
                    </button>
                    <button
                      type="button"
                      disabled={sortingTemp || media.filter((m) => m.kind === "image").length === 0}
                      onClick={() => handleSortByTemperature("cool-warm")}
                      title="Ordenar imagens: frio → quente"
                      className={clsx(
                        "rounded px-1.5 py-1 text-[10px] font-medium transition-all border",
                        sortingTemp ? "cursor-wait opacity-60 text-blue-400" :
                        tempDirection === "cool-warm" ? "border-blue-400/20 bg-blue-400/10 text-blue-300" :
                        "border-white/[0.06] text-zinc-600 hover:bg-white/[0.04] hover:text-zinc-400",
                      )}
                    >
                      {sortingTemp ? "..." : "❄→🔥"}
                    </button>
                  </div>

                  <div className="h-3 w-px bg-white/[0.08]" />

                  {/* ── Speed Variation Toggle ── */}
                  <button
                    type="button"
                    onClick={() => setAutoEnhancements({ speedVariation: !autoEnhancements.speedVariation })}
                    className={clsx(
                      "rounded px-2 py-1 text-[10px] font-medium transition-all border",
                      autoEnhancements.speedVariation
                        ? "border-cyan-400/20 bg-cyan-400/10 text-cyan-300"
                        : "border-white/[0.06] text-zinc-600 hover:bg-white/[0.04] hover:text-zinc-400",
                    )}
                    title="Alternar variação de velocidade (slow-mo / normal)"
                  >
                    {autoEnhancements.speedVariation ? "⚡ Velocidade" : "Velocidade"}
                  </button>

                  {/* ── Intro/Outro toggle ── */}
                  <button
                    type="button"
                    onClick={() => setAutoEnhancements({ introOutro: !autoEnhancements.introOutro })}
                    className={clsx(
                      "rounded px-2 py-1 text-[10px] font-medium transition-all border",
                      autoEnhancements.introOutro
                        ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
                        : "border-white/[0.06] text-zinc-600 hover:bg-white/[0.04] hover:text-zinc-400",
                    )}
                    title="Garantir fade in/out nos extremos"
                  >
                    {autoEnhancements.introOutro ? "✓ Intro/Outro" : "Intro/Outro"}
                  </button>
                </div>
              )}

            <div className="flex-1 overflow-y-auto">

              {/* Visual tracks */}
              <div className="p-4">
                <DndContext sensors={sensors} collisionDetection={closestCenter}
                  onDragEnd={(e) => onDragEnd(e, "visual")}>
                  <SortableContext items={visuals.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                    {visuals.length === 0 ? (
                      <div className="flex h-20 items-center justify-center rounded-lg border border-dashed border-white/[0.06]">
                        <p className="text-[11px] text-zinc-800">Adicione imagens ou vídeos</p>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {visuals.map((item) => {
                          const mediaItem = media.find((m) => m.id === item.mediaId);
                          if (!mediaItem) return null;
                          return (
                            <SortableTrack
                              key={item.id}
                              id={item.id}
                              title={mediaItem.name}
                              subtitle={`${secondsLabel(item.durationSeconds)} · fade ${item.fadeInSeconds}s / ${item.fadeOutSeconds}s`}
                              accent="coral"
                              badge={mediaItem.kind}
                              preview={<MediaThumbnail item={mediaItem} className="h-10 w-10" />}
                              onRemove={() => removeMedia(item.mediaId)}
                              controls={
                                <div className="flex items-center gap-2">
                                  <label className="flex items-center gap-1 text-[10px] text-zinc-700">
                                    Dur
                                    <input className={`${inputCls} w-14`} type="number" min="1" step="0.5"
                                      value={item.durationSeconds}
                                      onChange={(e) => updateVisualDuration(item.id, Number(e.target.value || 1))} />
                                  </label>
                                  <label className="flex items-center gap-1 text-[10px] text-zinc-700">
                                    In
                                    <input className={`${inputCls} w-12`} type="number" min="0" step="0.5"
                                      value={item.fadeInSeconds}
                                      onChange={(e) => updateVisualFade(item.id, "fadeInSeconds", Number(e.target.value || 0))} />
                                  </label>
                                  <label className="flex items-center gap-1 text-[10px] text-zinc-700">
                                    Out
                                    <input className={`${inputCls} w-12`} type="number" min="0" step="0.5"
                                      value={item.fadeOutSeconds}
                                      onChange={(e) => updateVisualFade(item.id, "fadeOutSeconds", Number(e.target.value || 0))} />
                                  </label>
                                </div>
                              }
                            />
                          );
                        })}
                      </div>
                    )}
                  </SortableContext>
                </DndContext>
              </div>

              {/* Audio header */}
              <div className="flex shrink-0 items-center gap-2.5 border-y border-white/[0.06] px-5 py-3">
                <Music4 className="h-3.5 w-3.5 text-cyan-400/60" />
                <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600">Áudio</span>
                <span className="ml-2 text-[10px] text-zinc-800">
                  {summary.audioSegments.length} seg · {secondsLabel(summary.totalAudioSeconds)}
                </span>
              </div>

              {/* Audio tracks */}
              <div className="p-4">
                <DndContext sensors={sensors} collisionDetection={closestCenter}
                  onDragEnd={(e) => onDragEnd(e, "audio")}>
                  <SortableContext items={audios.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                    {audios.length === 0 ? (
                      <div className="flex h-16 items-center justify-center rounded-lg border border-dashed border-white/[0.06]">
                        <p className="text-[11px] text-zinc-800">Sem trilhas de áudio</p>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {audios.map((item) => {
                          const mediaItem = media.find((m) => m.id === item.mediaId);
                          if (!mediaItem) return null;
                          return (
                            <SortableTrack
                              key={item.id}
                              id={item.id}
                              title={mediaItem.name}
                              subtitle={`${secondsLabel(mediaItem.durationSeconds)} · alvo ${summary.normalizedTargetDb} dB · pico ${summary.peakLimitDb} dB`}
                              accent="cyan"
                              badge="audio"
                              preview={<MediaThumbnail item={mediaItem} className="h-10 w-10" />}
                              onRemove={() => removeMedia(item.mediaId)}
                            />
                          );
                        })}
                      </div>
                    )}
                  </SortableContext>
                </DndContext>
              </div>
            </div>
            </div>
          )}

          {/* ── Manual mode: preview + horizontal timeline ──────────────── */}
          {editMode === "manual" && (
            <div className="flex flex-1 flex-col overflow-hidden">
              <PreviewPlayer
                playheadAt={playheadAt}
                isPlaying={isPlaying}
                totalDuration={summary.totalVideoSeconds}
                segments={summary.visualSegments}
                audioSegments={summary.audioSegments}
                media={media}
                presetWidth={presetMeta.width}
                presetHeight={presetMeta.height}
                viewportHeight={previewHeight}
                textOverlays={textOverlays}
                watermarks={watermarks}
                onPlayheadChange={setPlayhead}
                onPlayToggle={togglePlay}
                onStop={stopPlayback}
                onViewportHeightChange={setPreviewHeight}
              />
              {visuals.length === 0 && audios.length === 0 ? (
                <div className="flex flex-1 items-center justify-center">
                  <p className="text-[11px] text-zinc-800">
                    Adicione arquivos para começar a editar na timeline
                  </p>
                </div>
              ) : (
                <TimelineEditor
                  media={media}
                  visuals={visuals}
                  audios={audios}
                  pxPerSec={pxPerSec}
                  totalSeconds={summary.totalVideoSeconds}
                  playheadAt={playheadAt}
                  onPlayheadChange={setPlayhead}
                  onPxPerSecChange={setPxPerSec}
                  onVisualMove={(id, startAt) => {
                    const item = visuals.find((v) => v.id === id);
                    if (item) setVisualPosition(id, startAt, item.durationSeconds);
                  }}
                  onVisualResize={(id, dur) => {
                    const item = visuals.find((v) => v.id === id);
                    if (item) setVisualPosition(id, item.startAt ?? 0, dur);
                  }}
                  onVisualFadeChange={updateVisualFade}
                  onVisualPropChange={updateVisualProp}
                  onVisualTransitionChange={updateVisualTransition}
                  onAudioMove={setAudioPosition}
                  onAudioPropChange={updateAudioProp}
                  onRemoveMedia={removeMedia}
                  beats={beats}
                  bpm={bpm}
                  analyzingBeats={analyzingBeats}
                  onAnalyzeBeats={handleAnalyzeBeats}
                  musicalEvents={musicalEvents}
                  analyzingEvents={analyzingEvents}
                  onSyncToMusic={handleSyncToMusic}
                  textOverlays={textOverlays}
                  onAddTextOverlay={addTextOverlay}
                  onUpdateTextOverlay={updateTextOverlay}
                  onRemoveTextOverlay={removeTextOverlay}
                  onSelectionChange={(id, kind) =>
                    setSelectedVisualId(kind === "visual" ? id : null)
                  }
                />
              )}
            </div>
          )}
        </main>

        {/* ── Right panel: Export ──────────────────────────────────────────── */}
        <aside className="flex w-[268px] shrink-0 flex-col overflow-hidden border-l border-white/[0.06]">

          {/* Preset selector */}
          <div className="shrink-0 border-b border-white/[0.06] p-4">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-zinc-700">Formato</p>
            <div className="space-y-1.5">
              {(Object.entries(exportPresets) as Array<[ExportPreset, (typeof exportPresets)[ExportPreset]]>).map(([key, value]) => (
                <button key={key} type="button" onClick={() => setPreset(key)}
                  className={clsx(
                    "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-all duration-150",
                    preset === key
                      ? "border-white/[0.12] bg-white/[0.06]"
                      : "border-white/[0.04] hover:border-white/[0.08] hover:bg-white/[0.02]",
                  )}
                >
                  <div className={clsx(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-md border text-[11px] font-bold",
                    preset === key
                      ? "border-white/[0.14] bg-white/[0.08] text-white"
                      : "border-white/[0.06] bg-white/[0.03] text-zinc-700",
                  )}>
                    {value.aspect}
                  </div>
                  <div className="min-w-0">
                    <p className={clsx("truncate text-xs font-medium", preset === key ? "text-zinc-200" : "text-zinc-600")}>{value.label}</p>
                    <p className="text-[10px] text-zinc-700">{value.width}×{value.height}</p>
                  </div>
                  {preset === key && <div className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-white/40" />}
                </button>
              ))}
            </div>
          </div>

          {/* Render + progress */}
          <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-4">

            {/* ── Color grade (modo manual apenas) ──────────────────────── */}
            {editMode === "manual" && (
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-700">
                  Cor &amp; Estilo
                </p>
                <ColorGradePanel
                  activePresetId={colorGradePresetId}
                  selectedVisualId={selectedVisualId}
                  onSelect={setColorGradePreset}
                  onApplyToSelected={applyColorGradeToClip}
                  onApplyToAll={applyColorGradeToAllClips}
                />
              </div>
            )}

            {/* ── Opções de saída ───────────────────────────────────────── */}
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-700">
                Saída
              </p>
              <OutputOptionsPanel
                options={outputOptions}
                totalSeconds={summary.totalVideoSeconds}
                onChange={setOutputOptions}
              />
            </div>

            {/* ── Marca D'Água ──────────────────────────────────────────── */}
            <WatermarkPanel
              watermarks={watermarks}
              media={media}
              totalDuration={summary.totalVideoSeconds}
              onAdd={addWatermark}
              onUpdate={updateWatermark}
              onRemove={removeWatermark}
            />

            {/* ── Configuração de ordem (modo auto) ────────────────────── */}
            {editMode === "auto" && (
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-700">
                  Ordem dos clipes
                </p>
                <div className="space-y-1.5">
                  {(["sequential", "random"] as const).map((opt) => (
                    <label
                      key={opt}
                      className={clsx(
                        "flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-all",
                        mediaOrder === opt
                          ? "border-white/20 bg-white/[0.06] text-zinc-200"
                          : "border-white/[0.06] text-zinc-600 hover:border-white/10 hover:text-zinc-400",
                      )}
                    >
                      <input
                        type="radio"
                        name="mediaOrder"
                        value={opt}
                        checked={mediaOrder === opt}
                        onChange={() => setMediaOrder(opt)}
                        className="mt-0.5 accent-white"
                      />
                      <div>
                        <p className="text-[11px] font-medium leading-none">
                          {opt === "sequential" ? "Ordem de adição" : "Ordem aleatória"}
                        </p>
                        <p className="mt-1 text-[10px] leading-relaxed text-zinc-700">
                          {opt === "sequential"
                            ? "Clipes exibidos na sequência em que foram adicionados."
                            : "Clipes embaralhados aleatoriamente antes de gerar o vídeo."}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* ── Validação ─────────────────────────────────────────────── */}
            {editMode === "auto" && (() => {
              const hasVisuals = visuals.length > 0;
              const hasAudio   = audios.length > 0;
              if (!hasVisuals || !hasAudio) return (
                <div className="rounded-lg border border-amber-400/20 bg-amber-400/[0.05] p-3 text-[10px] leading-relaxed text-amber-300/70">
                  {!hasVisuals && !hasAudio
                    ? "Adicione pelo menos uma imagem/vídeo e uma música para processar."
                    : !hasVisuals
                    ? "Adicione pelo menos uma imagem ou vídeo."
                    : "Adicione pelo menos uma faixa de áudio/música."}
                </div>
              );
              return null;
            })()}

            <button
              type="button"
              disabled={
                processing || uploading ||
                !visuals.length ||
                (editMode === "auto" && !audios.length)
              }
              onClick={() => void handleRender()}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-white py-2.5 text-sm font-semibold text-zinc-950 transition-all duration-150 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:bg-white/[0.06] disabled:text-zinc-700"
            >
              {processing
                ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                : <Sparkles className="h-3.5 w-3.5" />
              }
              Processar projeto
            </button>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-zinc-700">Progresso</span>
                <span className="font-mono text-[10px] text-zinc-600">{progress}%</span>
              </div>
              <div className="h-[2px] overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className={clsx(
                    "h-full rounded-full transition-all duration-700",
                    progress === 100 && !processing ? "bg-emerald-400" : "bg-gradient-to-r from-cyan-400 to-orange-400",
                  )}
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className={clsx("text-[10px] leading-relaxed", progressMessage?.startsWith("Erro") ? "text-red-400" : "text-zinc-700")}>{progressMessage}</p>
            </div>

            {downloadUrl && (
              <a href={downloadUrl}
                className="flex items-center justify-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.04] py-2.5 text-xs font-medium text-zinc-400 transition-all hover:border-white/[0.12] hover:bg-white/[0.06] hover:text-zinc-200"
              >
                {simulationMode ? "Baixar manifesto JSON" : "Baixar vídeo .mp4"}
              </a>
            )}

            {activeJobId && (
              <p className="text-center font-mono text-[10px] text-zinc-800">job {activeJobId.slice(0, 8)}</p>
            )}
          </div>

          {/* Footer stats */}
          <div className="shrink-0 space-y-1.5 border-t border-white/[0.06] px-4 py-3">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-zinc-700">Resolução</span>
              <span className="text-zinc-500">{presetMeta.width}×{presetMeta.height}</span>
            </div>
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-zinc-700">Projeto</span>
              <span className="text-zinc-500">{formatBytes(projectBytes)}</span>
            </div>
            {invalidCount > 0 && (
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-zinc-700">Inválidos</span>
                <span className="text-red-400">{invalidCount}</span>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
