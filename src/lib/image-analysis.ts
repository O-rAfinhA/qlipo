'use client';

// ─── Color temperature analysis ───────────────────────────────────────────────
// Returns a warmth score for an image:
//   positive → warm (reds/yellows dominate)
//   negative → cool (blues dominate)
//   ~0       → neutral
//
// Uses a hidden <canvas> to sample the image pixels.
// The score is: average(R) - average(B), range ≈ -255 to +255.

export async function analyzeImageWarmth(url: string): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      try {
        // Sample at reduced resolution for performance (max 64×64)
        const SAMPLE = 64;
        const w = Math.min(img.naturalWidth,  SAMPLE);
        const h = Math.min(img.naturalHeight, SAMPLE);

        const canvas  = document.createElement("canvas");
        canvas.width  = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) { resolve(0); return; }

        ctx.drawImage(img, 0, 0, w, h);
        const { data } = ctx.getImageData(0, 0, w, h);

        let sumR = 0, sumG = 0, sumB = 0, n = 0;
        for (let i = 0; i < data.length; i += 4) {
          sumR += data[i];
          sumG += data[i + 1];
          sumB += data[i + 2];
          n++;
        }

        const avgR = sumR / n;
        const avgB = sumB / n;
        // warmth = R dominance over B, normalised to [-1, 1]
        resolve((avgR - avgB) / 255);
      } catch {
        resolve(0);
      }
    };

    img.onerror = () => resolve(0);
    img.src = url;
  });
}

// Analyse warmth for a batch of images, returns a map mediaId → score
export async function analyzeWarmthBatch(
  items: { id: string; previewUrl?: string; kind: string }[],
): Promise<Map<string, number>> {
  const images = items.filter((m) => m.kind === "image" && m.previewUrl);
  const results = await Promise.all(
    images.map(async (m) => ({
      id:    m.id,
      score: await analyzeImageWarmth(m.previewUrl!),
    })),
  );
  return new Map(results.map((r) => [r.id, r.score]));
}
