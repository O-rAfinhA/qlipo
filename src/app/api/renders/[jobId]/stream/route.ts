import { getJob, subscribeJob } from "@/server/job-store";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;

  let unsubscribe: (() => void) | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (payload: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));

      const existing = getJob(jobId);
      if (existing) {
        send(existing);
      } else {
        send({ stage: "erro", progress: 100, message: "Job nao encontrado" });
        controller.close();
        return;
      }

      unsubscribe = subscribeJob(jobId, (job) => {
        send(job);
        if (job.stage === "finalizado" || job.stage === "erro") {
          unsubscribe?.();
          controller.close();
        }
      });
    },
    cancel() {
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
