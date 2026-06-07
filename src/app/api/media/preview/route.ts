import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { basename } from "path";
import { Readable } from "stream";

import { NextResponse } from "next/server";

import { decodeMediaPath, ensureVideoPreview } from "@/server/media-preview";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("path");
    if (!token) {
      return NextResponse.json({ message: "Parametro path ausente." }, { status: 400 });
    }

    const sourcePath = decodeMediaPath(token);
    const previewPath = await ensureVideoPreview(sourcePath);
    const fileStat = await stat(previewPath);
    const rangeHeader = request.headers.get("range");
    const fileName = basename(previewPath);

    if (rangeHeader) {
      const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
      const start = match?.[1] ? Number(match[1]) : 0;
      const end = match?.[2] ? Number(match[2]) : fileStat.size - 1;
      const safeStart = Number.isFinite(start) ? start : 0;
      const safeEnd = Number.isFinite(end) ? Math.min(end, fileStat.size - 1) : fileStat.size - 1;

      if (safeStart > safeEnd || safeStart >= fileStat.size) {
        return new Response(null, {
          status: 416,
          headers: {
            "Content-Range": `bytes */${fileStat.size}`,
          },
        });
      }

      const stream = createReadStream(previewPath, { start: safeStart, end: safeEnd });
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 206,
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": String(safeEnd - safeStart + 1),
          "Content-Range": `bytes ${safeStart}-${safeEnd}/${fileStat.size}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": "private, max-age=31536000, immutable",
          "Content-Disposition": `inline; filename="${fileName}"`,
        },
      });
    }

    const stream = createReadStream(previewPath);
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(fileStat.size),
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=31536000, immutable",
        "Content-Disposition": `inline; filename="${fileName}"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao gerar preview.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
