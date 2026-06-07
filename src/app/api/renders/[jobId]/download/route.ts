import { createReadStream } from "fs";
import { stat } from "fs/promises";

import { getJob, getJobOutputPath } from "@/server/job-store";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const job = getJob(jobId);

  if (!job) {
    return Response.json({ message: "Job nao encontrado" }, { status: 404 });
  }

  const outputPath = getJobOutputPath(jobId);

  if (outputPath) {
    try {
      const info = await stat(outputPath);
      const stream = new ReadableStream({
        start(controller) {
          const fileStream = createReadStream(outputPath);
          fileStream.on("data", (chunk) => controller.enqueue(chunk));
          fileStream.on("end", () => controller.close());
          fileStream.on("error", (err) => controller.error(err));
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": String(info.size),
          "Content-Disposition": `attachment; filename="qlipo-${jobId.slice(0, 8)}.mp4"`,
        },
      });
    } catch {
      // outputPath exists in store but file was deleted — fall through to manifest
    }
  }

  // Fallback: JSON manifest (simulation mode or missing file)
  const manifest = JSON.stringify(
    {
      mode: job.mode,
      note: "Ambiente sem FFmpeg nativo. Este download e um manifesto da composicao pronto para futura integracao de render real.",
      summary: job.summary,
      completedAt: job.completedAt,
    },
    null,
    2,
  );

  return new Response(manifest, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="videofast-${jobId}.json"`,
    },
  });
}
