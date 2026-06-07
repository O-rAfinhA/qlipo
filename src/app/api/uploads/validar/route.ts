import { NextResponse } from "next/server";
import { z } from "zod";

import { validateUploadBatch } from "@/server/upload-validation";

const requestSchema = z.object({
  files: z.array(
    z.object({
      name: z.string(),
      sizeBytes: z.number().nonnegative(),
      mimeType: z.string().optional(),
    }),
  ),
});

export async function POST(request: Request) {
  try {
    const payload = requestSchema.parse(await request.json());
    return NextResponse.json(validateUploadBatch(payload.files));
  } catch {
    return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
  }
}
