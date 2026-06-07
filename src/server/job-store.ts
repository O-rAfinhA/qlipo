import type { RenderJob } from "@/lib/types";

type Listener = (job: RenderJob) => void;

const jobs = new Map<string, RenderJob>();
const listeners = new Map<string, Set<Listener>>();
const outputPaths = new Map<string, string>();

export function saveJobOutputPath(jobId: string, path: string) {
  outputPaths.set(jobId, path);
}

export function getJobOutputPath(jobId: string) {
  return outputPaths.get(jobId);
}

export function saveJob(job: RenderJob) {
  jobs.set(job.jobId, job);
  listeners.get(job.jobId)?.forEach((listener) => listener(job));
}

export function getJob(jobId: string) {
  return jobs.get(jobId);
}

export function subscribeJob(jobId: string, listener: Listener) {
  const group = listeners.get(jobId) ?? new Set<Listener>();
  group.add(listener);
  listeners.set(jobId, group);

  return () => {
    const current = listeners.get(jobId);
    current?.delete(listener);
    if (current && current.size === 0) {
      listeners.delete(jobId);
    }
  };
}
