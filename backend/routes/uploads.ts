import { Router } from "express";
import { randomUUID } from "crypto";
import { requireAuth } from "../middleware/auth";
import { generateUploadUrl } from "../server/r2-client";
import { validateUploadBatch } from "../server/upload-validation";
import { validateWatermarkUpload } from "../server/watermark-validation";

const router = Router();

// Generate presigned PUT URL for direct browser → R2 upload
router.post("/upload-url", requireAuth, async (req, res) => {
  try {
    const { filename, contentType } = req.body as { filename: string; contentType: string };
    if (!filename || !contentType) {
      res.status(400).json({ error: "filename e contentType sao obrigatorios." });
      return;
    }
    const sessionId = randomUUID();
    const safeName  = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const r2Key     = `uploads/${sessionId}/${safeName}`;
    const uploadUrl = await generateUploadUrl(r2Key, contentType);
    res.json({ uploadUrl, r2Key });
  } catch (error) {
    console.error("[upload-url]", error);
    res.status(500).json({ error: "Erro ao gerar URL de upload." });
  }
});

// Batch presigned URLs for multiple files
router.post("/upload-urls", requireAuth, async (req, res) => {
  try {
    const { files } = req.body as { files: { filename: string; contentType: string }[] };
    if (!Array.isArray(files) || files.length === 0) {
      res.status(400).json({ error: "Lista de arquivos invalida." });
      return;
    }
    const sessionId = randomUUID();
    const results = await Promise.all(
      files.map(async ({ filename, contentType }) => {
        const safeName  = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
        const r2Key     = `uploads/${sessionId}/${safeName}`;
        const uploadUrl = await generateUploadUrl(r2Key, contentType);
        return { filename, uploadUrl, r2Key };
      }),
    );
    res.json({ files: results });
  } catch (error) {
    console.error("[upload-urls]", error);
    res.status(500).json({ error: "Erro ao gerar URLs de upload." });
  }
});

// Validate files before upload (metadata only, no file transfer)
router.post("/uploads/validar", requireAuth, (req, res) => {
  try {
    const { files } = req.body as { files: { name: string; sizeBytes: number; mimeType?: string }[] };
    const result = validateUploadBatch(files ?? []);
    res.json(result);
  } catch (error) {
    console.error("[validar]", error);
    res.status(500).json({ error: "Erro na validacao." });
  }
});

// Generate presigned URL for watermark upload
router.post("/uploads/watermark-url", requireAuth, async (req, res) => {
  try {
    const { filename, contentType, sizeBytes } = req.body as {
      filename: string;
      contentType: string;
      sizeBytes: number;
    };
    const validation = validateWatermarkUpload(filename, sizeBytes);
    if (!validation.valid) {
      res.status(400).json({ error: validation.issues.join(", ") });
      return;
    }
    const sessionId = randomUUID();
    const safeName  = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const r2Key     = `watermarks/${sessionId}/${safeName}`;
    const uploadUrl = await generateUploadUrl(r2Key, contentType);
    res.json({ uploadUrl, r2Key });
  } catch (error) {
    console.error("[watermark-url]", error);
    res.status(500).json({ error: "Erro ao gerar URL de watermark." });
  }
});

export default router;
