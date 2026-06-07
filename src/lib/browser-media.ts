'use client';

export async function readMediaDuration(file: File) {
  if (file.type.startsWith("image/")) {
    return 3;
  }

  return new Promise<number>((resolve) => {
    const url = URL.createObjectURL(file);
    const isAudio = file.type.startsWith("audio/");
    const fallback = isAudio ? 20 : 8;
    const element = document.createElement(isAudio ? "audio" : "video");

    const cleanup = (duration: number) => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(duration);
    };

    const timer = setTimeout(() => cleanup(fallback), 10_000);

    element.preload = "metadata";
    element.src = url;
    element.onloadedmetadata = () => {
      cleanup(Number.isFinite(element.duration) ? Number(element.duration.toFixed(2)) : fallback);
    };
    element.onerror = () => cleanup(fallback);
  });
}

export function formatBytes(value: number) {
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(0)} KB`;
  }
  if (value < 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
