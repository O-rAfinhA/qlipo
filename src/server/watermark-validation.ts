import { validateWatermarkFile } from "@/lib/media-rules";

export function validateWatermarkUpload(
  name: string,
  sizeBytes: number,
): { valid: boolean; issues: string[] } {
  return validateWatermarkFile(name, sizeBytes);
}
