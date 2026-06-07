import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { createFfmpegRenderJob } from "../server/render-ffmpeg";
import { createRenderJob } from "../server/render-simulator";
import type { RenderRequest } from "../lib/types";

const router = Router();

router.post("/renders", requireAuth, (req, res) => {
  try {
    const payload = req.body as RenderRequest;
    if (!payload?.media || !payload?.visuals || !payload?.audios) {
      res.status(400).json({ error: "Payload de render invalido." });
      return;
    }

    const hasR2Files = payload.media.some((m) => m.r2Key);
    const job = hasR2Files
      ? createFfmpegRenderJob(payload)
      : createRenderJob(payload);

    res.json({ jobId: job.jobId, status: job.stage });
  } catch (error) {
    console.error("[renders]", error);
    res.status(500).json({ error: "Erro ao criar job de render." });
  }
});

export default router;
