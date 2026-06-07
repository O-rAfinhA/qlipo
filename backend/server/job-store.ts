import type { RenderJob } from "../lib/types";

type Listener = (job: RenderJob) => void;

const jobs = new Map<string, RenderJob>();
const listeners = new Map<string, Set<Listener>>();
const outputKeys = new Map<string, string>();

export function saveJobOutputKey(jobId: string, r2Key: string) {
  outputKeys.set(jobId, r2Key);
}

export function getJobOutputKey(jobId: string) {
  return outputKeys.get(jobId);
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
