import { Router } from "express";
import { getJob, getJobOutputKey, subscribeJob } from "../server/job-store";
import { generateDownloadUrl } from "../server/r2-client";

const router = Router();

// Get job status
router.get("/renders/:jobId", (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "Job nao encontrado." });
    return;
  }
  res.json(job);
});

// SSE stream for live job updates
router.get("/renders/:jobId/stream", (req, res) => {
  const { jobId } = req.params;
  const job = getJob(jobId);
  if (!job) {
    res.status(404).json({ error: "Job nao encontrado." });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // prevent Railway/nginx buffering
  res.flushHeaders();

  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const ping = () => res.write(": ping\n\n");

  send(job);

  if (job.stage === "finalizado" || job.stage === "erro") {
    res.end();
    return;
  }

  const keepalive = setInterval(ping, 15000);

  const unsubscribe = subscribeJob(jobId, (updated) => {
    send(updated);
    if (updated.stage === "finalizado" || updated.stage === "erro") {
      clearInterval(keepalive);
      unsubscribe();
      res.end();
    }
  });

  req.on("close", () => {
    clearInterval(keepalive);
    unsubscribe();
  });
});

// Generate fresh presigned download URL from R2
router.get("/renders/:jobId/download", async (req, res) => {
  try {
    const { jobId } = req.params;
    const r2Key = getJobOutputKey(jobId);

    if (!r2Key) {
      // Simulation fallback: return job JSON
      const job = getJob(jobId);
      if (!job) {
        res.status(404).json({ error: "Job nao encontrado." });
        return;
      }
      res.json(job);
      return;
    }

    const downloadUrl = await generateDownloadUrl(r2Key, 3600);
    res.redirect(302, downloadUrl);
  } catch (error) {
    console.error("[download]", error);
    res.status(500).json({ error: "Erro ao gerar URL de download." });
  }
});

export default router;
