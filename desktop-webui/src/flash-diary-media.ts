/**
 * Desktop flash-diary capture media persistence.
 *
 * Handles clipboard/drop media that arrive as data URLs from the isolated
 * capture window. Files are persisted under Electron userData so the existing
 * submit pipeline can pass normal local paths to the web server.
 */
import { app, ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

interface FlashDiaryMediaPayload {
  fileName?: string;
  mimeType?: string;
  dataUrl?: string;
}

interface DecodedFlashDiaryMedia {
  readonly bytes: Buffer;
  readonly extension: string;
}

export function registerFlashDiaryMediaHandlers(): void {
  ipcMain.handle("desktop:save-flash-diary-media", (_event, payload: FlashDiaryMediaPayload) =>
    saveFlashDiaryMedia(payload),
  );
}

function saveFlashDiaryMedia(payload: FlashDiaryMediaPayload): string {
  const decoded = decodeFlashDiaryMediaDataUrl(payload.dataUrl ?? "");
  const fileName = buildFlashDiaryMediaFileName(payload.fileName, payload.mimeType, decoded.extension);
  const mediaDir = path.join(app.getPath("userData"), "capture-media");
  fs.mkdirSync(mediaDir, { recursive: true });
  const targetPath = path.join(mediaDir, fileName);
  fs.writeFileSync(targetPath, decoded.bytes);
  return targetPath;
}

// fallow-ignore-next-line complexity
function decodeFlashDiaryMediaDataUrl(dataUrl: string): DecodedFlashDiaryMedia {
  const match = /^data:(image|video)\/([a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/iu.exec(dataUrl.trim());
  if (!match) {
    throw new Error("\u9644\u4ef6\u683c\u5f0f\u4e0d\u652f\u6301");
  }
  const subtype = (match[2] ?? "").toLowerCase();
  const base64 = (match[3] ?? "").replace(/\s+/g, "");
  if (!base64) {
    throw new Error("\u9644\u4ef6\u5185\u5bb9\u4e3a\u7a7a");
  }
  return { bytes: Buffer.from(base64, "base64"), extension: extensionFromMimeSubtype(subtype) };
}

function buildFlashDiaryMediaFileName(
  preferredName: string | undefined,
  mimeType: string | undefined,
  fallbackExtension: string,
): string {
  const parsed = path.parse(preferredName?.trim() || `pasted-media${fallbackExtension}`);
  const extension = normalizeFlashDiaryMediaExtension(parsed.ext, mimeType, fallbackExtension);
  const baseName = parsed.name.replace(/[^a-z0-9\u4e00-\u9fff-_]+/giu, "-").replace(/^-+|-+$/g, "") || "pasted-media";
  return `${Date.now()}-${randomUUID()}-${baseName}${extension}`;
}

// fallow-ignore-next-line complexity
function normalizeFlashDiaryMediaExtension(
  extension: string,
  mimeType: string | undefined,
  fallbackExtension: string,
): string {
  const normalized = extension.toLowerCase();
  if (/^\.(png|jpe?g|gif|webp|bmp|svg|mp4|mov|m4v|webm|avi|mkv)$/i.test(normalized)) {
    return normalized === ".jpeg" ? ".jpg" : normalized;
  }
  const subtype = mimeType?.split("/")[1]?.trim().toLowerCase() ?? "";
  return subtype ? extensionFromMimeSubtype(subtype) : fallbackExtension;
}

// fallow-ignore-next-line complexity
function extensionFromMimeSubtype(subtype: string): string {
  switch (subtype) {
    case "jpeg":
      return ".jpg";
    case "quicktime":
      return ".mov";
    case "svg+xml":
      return ".svg";
    default:
      return `.${subtype.replace(/[^a-z0-9]+/g, "") || "bin"}`;
  }
}
