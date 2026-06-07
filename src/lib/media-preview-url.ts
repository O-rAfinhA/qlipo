export function getVideoPreviewUrl(previewUrl?: string, serverPath?: string) {
  if (previewUrl) {
    return previewUrl;
  }
  if (!serverPath) {
    return undefined;
  }

  const token = toBase64Url(serverPath);
  return `/api/media/preview?path=${encodeURIComponent(token)}`;
}

function toBase64Url(value: string) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(value, "utf8").toString("base64url");
  }

  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
