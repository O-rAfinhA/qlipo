import { validateWatermarkFile } from "../lib/media-rules";

export function validateWatermarkUpload(name: string, sizeBytes: number) {
  return validateWatermarkFile(name, sizeBytes);
}
