import { Router } from "express";
import { mkdir, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { downloadToFile, uploadBuffer, generateDownloadUrl, keyExists, getObjectStream } from "../server/r2-client";
import { Ffmpeg } from "../server/ffmpeg-runtime";

const router = Router();

router.get("/media/preview", async (req, res) => {
  const r2Key = req.query.r2Key as string;
  if (!r2Key) {
    res.status(400).json({ error: "r2Key e obrigatorio." });
    return;
  }

  try {
    // Images and audio: redirect to R2 directly, no FFmpeg needed
    const directExts = ["jpg", "jpeg", "png", "webp", "gif", "avif", "mp3", "wav", "ogg", "flac", "aac", "m4a", "opus"];
    const fileExt = r2Key.split(".").pop()?.toLowerCase() ?? "";
    if (directExts.includes(fileExt)) {
      const downloadUrl = await generateDownloadUrl(r2Key, 3600);
      res.redirect(302, downloadUrl);
      return;
    }

    // v2 suffix forces regeneration after codec fix (H.264 high profile + even dimensions)
    const previewKey = `previews/v2-${Buffer.from(r2Key).toString("base64url").slice(0, 32)}.mp4`;

    // Serve existing preview if already generated
    if (await keyExists(previewKey)) {
      const downloadUrl = await generateDownloadUrl(previewKey, 3600);
      res.redirect(302, downloadUrl);
      return;
    }

    // Download original file to /tmp
    const workDir  = join(tmpdir(), "qlipo-preview", randomUUID());
    await mkdir(workDir, { recursive: true });
    const ext      = r2Key.split(".").pop() ?? "mp4";
    const srcPath  = join(workDir, `source.${ext}`);
    const outPath  = join(workDir, "preview.mp4");

    await downloadToFile(r2Key, srcPath);

    // Generate browser-compatible H.264 preview.
    // scale=1280:-2 ensures even dimensions (H.264 requires even width/height).
    // profile:v high / level 4.0 gives broad browser support including Safari.
    // pix_fmt yuv420p is required for Safari/iOS compatibility.
    await new Promise<void>((resolve, reject) => {
      Ffmpeg(srcPath)
        .videoCodec("libx264")
        .audioCodec("aac")
        .outputOptions([
          "-movflags +faststart",
          "-pix_fmt yuv420p",
          "-profile:v high",
          "-level:v 4.0",
          "-preset veryfast",
          "-crf 23",
          "-vf scale=1280:-2",
        ])
        .on("end", () => resolve())
        .on("error", (err) => reject(err))
        .save(outPath);
    });

    // Upload preview to R2
    const { readFile } = await import("fs/promises");
    const buffer = await readFile(outPath);
    await uploadBuffer(previewKey, buffer, "video/mp4");

    // Cleanup
    await unlink(srcPath).catch(() => undefined);
    await unlink(outPath).catch(() => undefined);

    const downloadUrl = await generateDownloadUrl(previewKey, 3600);
    res.redirect(302, downloadUrl);
  } catch (error) {
    console.error("[preview]", error);
    res.status(500).json({ error: "Erro ao gerar preview." });
  }
});

// Stream R2 object directly to client — avoids cross-origin redirect so that
// browser fetch() + arrayBuffer() works without R2 CORS issues (used by beat
// and musical-event analysis on the frontend).
router.get("/media/stream", async (req, res) => {
  const r2Key = req.query.r2Key as string;
  if (!r2Key) {
    res.status(400).json({ error: "r2Key e obrigatorio." });
    return;
  }
  try {
    const { body, contentType, contentLength } = await getObjectStream(r2Key);
    res.setHeader("Content-Type", contentType ?? "application/octet-stream");
    if (contentLength) res.setHeader("Content-Length", String(contentLength));
    res.setHeader("Accept-Ranges", "bytes");
    body.pipe(res);
  } catch (error) {
    console.error("[stream]", error);
    res.status(500).json({ error: "Erro ao transmitir arquivo." });
  }
});

export default router;
