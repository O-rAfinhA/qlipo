import { Router } from "express";
import { randomUUID } from "crypto";
import { requireAuth } from "../middleware/auth";
import { generateUploadUrl, getUserStorageBytes } from "../server/r2-client";
import { validateUploadBatch } from "../server/upload-validation";
import { validateWatermarkUpload } from "../server/watermark-validation";

const router = Router();

// Default quota: 2 GB per user (configurable via env)
const USER_QUOTA_BYTES = parseInt(process.env.USER_QUOTA_BYTES ?? String(2 * 1024 * 1024 * 1024));

async function checkQuota(userId: string, additionalBytes: number): Promise<{ ok: boolean; usedBytes: number }> {
  const usedBytes = await getUserStorageBytes(userId);
  return { ok: usedBytes + additionalBytes <= USER_QUOTA_BYTES, usedBytes };
}

// Generate presigned PUT URL for direct browser → R2 upload
router.post("/upload-url", requireAuth, async (req, res) => {
  try {
    const userId = res.locals.userId as string;
    const { filename, contentType, sizeBytes } = req.body as {
      filename: string;
      contentType: string;
      sizeBytes: number;
    };
    if (!filename || !contentType) {
      res.status(400).json({ error: "filename e contentType sao obrigatorios." });
      return;
    }

    const quota = await checkQuota(userId, sizeBytes ?? 0);
    if (!quota.ok) {
      res.status(413).json({ error: `Cota de armazenamento excedida. Voce ja usa ${Math.round(quota.usedBytes / 1024 / 1024)} MB dos ${Math.round(USER_QUOTA_BYTES / 1024 / 1024)} MB permitidos.` });
      return;
    }

    const sessionId = randomUUID();
    const safeName  = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const r2Key     = `uploads/${userId}/${sessionId}/${safeName}`;
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
    const userId = res.locals.userId as string;
    const { files } = req.body as { files: { filename: string; contentType: string; sizeBytes?: number }[] };
    if (!Array.isArray(files) || files.length === 0) {
      res.status(400).json({ error: "Lista de arquivos invalida." });
      return;
    }

    const totalAdditional = files.reduce((sum, f) => sum + (f.sizeBytes ?? 0), 0);
    const quota = await checkQuota(userId, totalAdditional);
    if (!quota.ok) {
      res.status(413).json({ error: `Cota de armazenamento excedida. Voce ja usa ${Math.round(quota.usedBytes / 1024 / 1024)} MB dos ${Math.round(USER_QUOTA_BYTES / 1024 / 1024)} MB permitidos.` });
      return;
    }

    const sessionId = randomUUID();
    const results = await Promise.all(
      files.map(async ({ filename, contentType }) => {
        const safeName  = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
        const r2Key     = `uploads/${userId}/${sessionId}/${safeName}`;
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

// Validate files before upload (metadata only)
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
    const userId = res.locals.userId as string;
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
    const r2Key     = `watermarks/${userId}/${sessionId}/${safeName}`;
    const uploadUrl = await generateUploadUrl(r2Key, contentType);
    res.json({ uploadUrl, r2Key });
  } catch (error) {
    console.error("[watermark-url]", error);
    res.status(500).json({ error: "Erro ao gerar URL de watermark." });
  }
});

// Get current storage usage for the authenticated user
router.get("/storage/usage", requireAuth, async (req, res) => {
  try {
    const userId = res.locals.userId as string;
    const usedBytes = await getUserStorageBytes(userId);
    res.json({
      usedBytes,
      limitBytes: USER_QUOTA_BYTES,
      usedMB: Math.round(usedBytes / 1024 / 1024),
      limitMB: Math.round(USER_QUOTA_BYTES / 1024 / 1024),
      percentUsed: Math.round((usedBytes / USER_QUOTA_BYTES) * 100),
    });
  } catch (error) {
    console.error("[storage/usage]", error);
    res.status(500).json({ error: "Erro ao consultar uso de armazenamento." });
  }
});

export default router;
