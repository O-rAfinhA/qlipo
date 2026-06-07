import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import type { Readable } from "stream";

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.R2_BUCKET_NAME!;

export async function generateUploadUrl(key: string, contentType: string, expiresIn = 3600) {
  return getSignedUrl(r2, new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }), { expiresIn });
}

export async function generateDownloadUrl(key: string, expiresIn = 3600) {
  return getSignedUrl(r2, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn });
}

export async function uploadBuffer(key: string, buffer: Buffer, contentType = "application/octet-stream") {
  await r2.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: buffer, ContentType: contentType }));
}

export async function downloadToFile(key: string, localPath: string) {
  const res = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  if (!res.Body) throw new Error(`R2 key not found: ${key}`);
  await pipeline(res.Body as Readable, createWriteStream(localPath));
}

export async function downloadToBuffer(key: string): Promise<Buffer> {
  const res = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  if (!res.Body) throw new Error(`R2 key not found: ${key}`);
  const chunks: Buffer[] = [];
  for await (const chunk of res.Body as Readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
