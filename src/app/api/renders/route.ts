import { NextResponse } from "next/server";
import { z } from "zod";

import { createFfmpegRenderJob } from "@/server/render-ffmpeg";
import { createRenderJob } from "@/server/render-simulator";

const mediaItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["image", "video", "audio"]),
  format: z.string(),
  sizeBytes: z.number().nonnegative(),
  durationSeconds: z.number().nonnegative(),
  previewUrl: z.string().optional(),
  serverPath: z.string().optional(),
  valid: z.boolean(),
  issues: z.array(z.enum(["invalid-format", "file-too-large", "project-too-large"])),
});

const renderRequestSchema = z.object({
  preset: z.enum(["reels_9_16", "landscape_16_9", "square_1_1"]),
  media: z.array(mediaItemSchema),
  visuals: z.array(
    z.object({
      id: z.string(),
      mediaId: z.string(),
      kind: z.enum(["image", "video"]),
      order: z.number(),
      durationSeconds: z.number().positive(),
      fadeInSeconds: z.number().min(0),
      fadeOutSeconds: z.number().min(0),
      startAt: z.number().min(0).optional(),
      volume: z.number().min(0).max(1).optional(),
      opacity: z.number().min(0).max(1).optional(),
      brightness: z.number().min(0.1).max(3).optional(),
      contrast: z.number().min(0).max(3).optional(),
      saturation: z.number().min(0).max(3).optional(),
      blur: z.number().min(0).max(20).optional(),
      transitionType: z.enum([
        "fade","wipeleft","wiperight","wipeup","wipedown",
        "slideleft","slideright","dissolve","smoothup","radial",
      ]).optional(),
    }),
  ),
  audios: z.array(
    z.object({
      id: z.string(),
      mediaId: z.string(),
      order: z.number(),
      startAt: z.number().min(0).optional(),
      volume: z.number().min(0).max(1).optional(),
    }),
  ),
  mediaOrder: z.enum(["sequential", "random"]).default("sequential"),
  bpm: z.number().min(0).max(300).optional(),
  outputOptions: z.object({
    codec:        z.enum(["h264", "h265", "vp9"]).default("h264"),
    quality:      z.enum(["low", "medium", "high", "very_high"]).default("high"),
    fps:          z.union([z.literal(24), z.literal(30), z.literal(60)]).default(30),
    audioQuality: z.enum(["standard", "high", "studio"]).default("high"),
  }).optional(),
  autoEnhancements: z.object({
    colorGrade: z.object({
      brightness: z.number(), contrast: z.number(),
      saturation: z.number(), blur: z.number(),
    }).optional(),
    speedVariation: z.boolean().optional(),
    introOutro: z.boolean().optional(),
  }).optional(),
  textOverlays: z.array(z.object({
    id: z.string(),
    text: z.string(),
    startAt: z.number().min(0),
    endAt: z.number().min(0),
    x: z.number().min(0).max(100),
    y: z.number().min(0).max(100),
    fontSize: z.number().min(8).max(200),
    color: z.string(),
    fontWeight: z.enum(["normal", "bold"]),
    animation: z.enum(["none", "fade", "slide-up"]),
  })).optional(),
  watermarks: z.array(z.object({
    id: z.string(),
    mediaId: z.string(),
    imageUrl: z.string().optional(),
    imageData: z.string().optional(),
    size: z.number().min(5).max(50),
    opacity: z.number().min(10).max(100),
    position: z.enum(["top-left", "top-right", "bottom-left", "bottom-right", "center"]),
    startAt: z.number().min(0),
    endAt: z.number().min(0),
    fadeInDuration: z.number().min(0.5),
    fadeOutDuration: z.number().min(0.5),
  })).optional(),
});

export async function POST(request: Request) {
  try {
    const payload = renderRequestSchema.parse(await request.json());

    const hasServerFiles = payload.media.some((m) => m.serverPath);
    const job = hasServerFiles ? createFfmpegRenderJob(payload) : createRenderJob(payload);

    return NextResponse.json({ jobId: job.jobId, status: "processando" });
  } catch {
    return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
  }
}
