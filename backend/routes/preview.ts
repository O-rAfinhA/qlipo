import { Router } from "express";
import { mkdir, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { downloadToFile, uploadBuffer, generateDownloadUrl, keyExists } from "../server/r2-client";
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

    const previewKey = `previews/${Buffer.from(r2Key).toString("base64url").slice(0, 32)}.mp4`;

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

    // Generate preview with FFmpeg
    await new Promise<void>((resolve, reject) => {
      Ffmpeg(srcPath)
        .videoCodec("libx264")
        .audioCodec("aac")
        .outputOptions(["-movflags +faststart", "-pix_fmt yuv420p", "-preset veryfast", "-crf 23"])
        .size("1280x?")
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

export default router;
