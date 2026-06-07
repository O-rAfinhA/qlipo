import { summarizeComposition } from "../lib/media-rules";
import type { RenderJob, RenderRequest, RenderStage } from "../lib/types";
import { getJob, saveJob } from "./job-store";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3001";

const stagePlan: Array<{ stage: RenderStage; progress: number; message: string; waitMs: number }> = [
  { stage: "preparando", progress: 10, message: "Validando projeto e preparando arquivos", waitMs: 700 },
  { stage: "montando_video", progress: 45, message: "Aplicando timeline visual e fades", waitMs: 900 },
  { stage: "processando_audio", progress: 72, message: "Sincronizando audio, loops e crossfades", waitMs: 1000 },
  { stage: "muxando", progress: 92, message: "Combinando trilhas e gerando pacote final", waitMs: 900 },
];

export function createRenderJob(input: RenderRequest) {
  const jobId = crypto.randomUUID();
  const summary = summarizeComposition(input.media, input.visuals, input.audios, input.mediaOrder, [], input.bpm ?? 0);
  const baseJob: RenderJob = {
    jobId,
    stage: "preparando",
    progress: 0,
    message: "Job criado",
    startedAt: Date.now(),
    summary,
    mode: "simulation",
  };

  saveJob(baseJob);
  void advanceJob(jobId);

  return baseJob;
}

async function advanceJob(jobId: string) {
  for (const step of stagePlan) {
    await wait(step.waitMs);
    const current = getJob(jobId);
    if (!current) return;
    saveJob({ ...current, stage: step.stage, progress: step.progress, message: step.message });
  }

  await wait(650);
  const current = getJob(jobId);
  if (!current) return;

  saveJob({
    ...current,
    stage: "finalizado",
    progress: 100,
    message: "Renderizacao simulada concluida. Ambiente sem FFmpeg nativo.",
    completedAt: Date.now(),
    downloadUrl: `${BACKEND_URL}/api/renders/${jobId}/download`,
  });
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
