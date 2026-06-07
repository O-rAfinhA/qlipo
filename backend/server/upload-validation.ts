import { validateMediaFile } from "../lib/media-rules";
import type { UploadValidationResponse } from "../lib/types";

type UploadMeta = {
  name: string;
  sizeBytes: number;
  mimeType?: string;
};

export function validateUploadBatch(files: UploadMeta[]): UploadValidationResponse {
  const totalBytesProject = files.reduce((sum, file) => sum + file.sizeBytes, 0);

  return {
    totalBytesProject,
    files: files.map((file) => {
      const result = validateMediaFile(file.name, file.sizeBytes, totalBytesProject, file.mimeType);
      return {
        name: file.name,
        detectedCategory: result.kind,
        valid: result.valid,
        issues: result.issues,
      };
    }),
  };
}
