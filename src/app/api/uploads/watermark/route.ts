import { NextResponse } from "next/server";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { validateWatermarkUpload } from "@/server/watermark-validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file || !file.size) {
      return NextResponse.json(
        { message: "No file provided" },
        { status: 400 }
      );
    }

    // Validate
    const validation = validateWatermarkUpload(file.name, file.size);
    if (!validation.valid) {
      return NextResponse.json(
        { message: "Invalid watermark", issues: validation.issues },
        { status: 400 }
      );
    }

    const sessionId = randomUUID();
    const uploadDir = join(tmpdir(), "qlipo", "watermarks", sessionId);
    await mkdir(uploadDir, { recursive: true });

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const serverPath = join(uploadDir, safeName);
    await writeFile(serverPath, Buffer.from(await file.arrayBuffer()));

    return NextResponse.json({
      name: file.name,
      serverPath,
      size: file.size,
    });
  } catch (error) {
    console.error("[watermark-upload]", error);
    return NextResponse.json(
      { message: "Error uploading watermark" },
      { status: 500 }
    );
  }
}
