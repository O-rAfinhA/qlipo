import { access, mkdir, rename, unlink } from "fs/promises";
import { constants as fsConstants } from "fs";
import { basename, extname, join, resolve } from "path";
import { tmpdir } from "os";
import { execFile } from "child_process";
import { promisify } from "util";

import { Ffmpeg, ffmpegPath } from "@/server/ffmpeg-runtime";

const mediaRoot = resolve(tmpdir(), "qlipo");
const execFileAsync = promisify(execFile);

export function encodeMediaPath(filePath: string) {
  return Buffer.from(filePath, "utf8").toString("base64url");
}

export function decodeMediaPath(token: string) {
  const decoded = Buffer.from(token, "base64url").toString("utf8");
  const resolved = resolve(decoded);
  if (!resolved.startsWith(mediaRoot)) {
    throw new Error("Caminho de midia invalido.");
  }
  return resolved;
}

export async function ensureVideoPreview(sourcePath: string) {
  const source = decodeAndValidatePath(sourcePath);
  const previewsDir = join(mediaRoot, "previews");
  await mkdir(previewsDir, { recursive: true });

  const fileBase = `${basename(source, extname(source))}-${Buffer.from(source).toString("base64url").slice(0, 12)}`;
  const outputPath = join(previewsDir, `${fileBase}.mp4`);
  const tempOutputPath = join(previewsDir, `${fileBase}.tmp.mp4`);

  try {
    await access(outputPath, fsConstants.F_OK);
    if (await isValidPreview(outputPath)) {
      return outputPath;
    }
    await unlink(outputPath).catch(() => undefined);
  } catch {
    // File does not exist yet. Continue with transcode.
  }

  await unlink(tempOutputPath).catch(() => undefined);
  await new Promise<void>((resolvePromise, rejectPromise) => {
    Ffmpeg(source)
      .videoCodec("libx264")
      .audioCodec("aac")
      .outputOptions(["-movflags +faststart", "-pix_fmt yuv420p", "-preset veryfast", "-crf 23"])
      .size("1280x?")
      .on("end", () => resolvePromise())
      .on("error", (error) => rejectPromise(error))
      .save(tempOutputPath);
  });

  if (!(await isValidPreview(tempOutputPath))) {
    await unlink(tempOutputPath).catch(() => undefined);
    throw new Error("Preview de video gerado de forma invalida.");
  }

  await rename(tempOutputPath, outputPath);
  return outputPath;
}

async function isValidPreview(filePath: string) {
  if (!ffmpegPath) {
    return false;
  }

  try {
    await execFileAsync(ffmpegPath, ["-v", "error", "-i", filePath, "-f", "null", "-"]);
    return true;
  } catch {
    return false;
  }
}

function decodeAndValidatePath(filePath: string) {
  const resolved = resolve(filePath);
  if (!resolved.startsWith(mediaRoot)) {
    throw new Error("Caminho de midia invalido.");
  }
  return resolved;
}
