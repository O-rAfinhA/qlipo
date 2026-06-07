import { NextResponse } from "next/server";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

import { encodeMediaPath } from "@/server/media-preview";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const sessionId = randomUUID();
    const uploadDir = join(tmpdir(), "qlipo", "uploads", sessionId);
    await mkdir(uploadDir, { recursive: true });

    const results: { name: string; serverPath: string; previewUrl?: string }[] = [];

    for (const [, value] of formData.entries()) {
      if (value instanceof File) {
        const safeName = value.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const serverPath = join(uploadDir, safeName);
        await writeFile(serverPath, Buffer.from(await value.arrayBuffer()));
        const isVideo = value.type.startsWith("video/");
        results.push({
          name: value.name,
          serverPath,
          ...(isVideo && {
            previewUrl: `/api/media/preview?path=${encodeURIComponent(encodeMediaPath(serverPath))}`,
          }),
        });
      }
    }

    return NextResponse.json({ files: results });
  } catch (error) {
    console.error("[upload]", error);
    return NextResponse.json({ message: "Erro ao receber os arquivos." }, { status: 500 });
  }
}
