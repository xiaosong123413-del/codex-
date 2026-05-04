/**
 * Flash-diary editor media helpers.
 *
 * Owns diary media upload path validation, media persistence under per-day
 * asset folders, preview URL construction, and save-time orphan cleanup for
 * media references that disappear from a single diary markdown file.
 */
import fs from "node:fs";
import path from "node:path";

const DIARY_ROOT = "raw/闪念日记";
const DIARY_ASSET_ROOT = `${DIARY_ROOT}/assets`;
const SUPPORTED_DATA_URL_RE = /^data:((?:image|video)\/(?:png|jpeg|webp|gif|bmp|svg\+xml|mp4|quicktime|webm|x-msvideo));base64,([a-z0-9+/=\s]+)$/iu;
const DIARY_IMAGE_RE = /!\[[^\]]*\]\(([^)]+)\)/gu;
const DIARY_MEDIA_RE = /!?\[[^\]]*\]\(([^)]+)\)/gu;

interface FlashDiaryUploadedMedia {
  readonly mediaPath: string;
  readonly mediaUrl: string;
}

interface DecodedMediaData {
  readonly extension: string;
  readonly bytes: Buffer;
}

export function saveFlashDiaryEditorImage(
  sourceVaultRoot: string,
  diaryPath: string,
  fileName: string,
  dataUrl: string,
): FlashDiaryUploadedMedia {
  const normalizedDiaryPath = normalizeFlashDiaryPath(diaryPath);
  if (!normalizedDiaryPath) {
    throw new Error("invalid flash diary path");
  }
  const decoded = decodeMediaDataUrl(dataUrl.trim());
  if (!decoded) {
    throw new Error("invalid media payload");
  }
  const date = path.posix.basename(normalizedDiaryPath, ".md");
  const assetDirectory = path.posix.join(DIARY_ASSET_ROOT, date);
  const nextName = allocateDiaryMediaName(
    sourceVaultRoot,
    assetDirectory,
    fileName.trim(),
    decoded.extension,
  );
  const logicalPath = path.posix.join(assetDirectory, nextName);
  const fullPath = path.join(sourceVaultRoot, ...logicalPath.split("/"));
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, decoded.bytes);
  return {
    mediaPath: logicalPath,
    mediaUrl: buildFlashDiaryMediaUrl(logicalPath),
  };
}

export function cleanupRemovedFlashDiaryMedia(
  sourceVaultRoot: string,
  diaryPath: string,
  previousRaw: string,
  nextRaw: string,
): void {
  const normalizedDiaryPath = normalizeFlashDiaryPath(diaryPath);
  if (!normalizedDiaryPath) {
    return;
  }
  const previousPaths = extractDiaryMediaPaths(previousRaw, normalizedDiaryPath);
  const nextPaths = extractDiaryMediaPaths(nextRaw, normalizedDiaryPath);
  for (const mediaPath of previousPaths) {
    if (nextPaths.has(mediaPath)) {
      continue;
    }
    const fullPath = path.join(sourceVaultRoot, ...mediaPath.split("/"));
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      fs.rmSync(fullPath, { force: true });
    }
  }
}

export function resolveFlashDiaryMediaFullPath(
  sourceVaultRoot: string,
  logicalPath: string,
): string | null {
  const normalized = normalizeFlashDiaryMediaPath(logicalPath);
  if (!normalized) {
    return null;
  }
  return path.join(sourceVaultRoot, ...normalized.split("/"));
}

function buildFlashDiaryMediaUrl(logicalPath: string): string {
  return `/api/flash-diary/media?path=${encodeURIComponent(logicalPath)}`;
}

export function findFirstFlashDiaryImageUrl(diaryPath: string, raw: string): string | null {
  const mediaPath = findFirstDiaryImagePath(raw, diaryPath);
  return mediaPath ? buildFlashDiaryMediaUrl(mediaPath) : null;
}

function normalizeFlashDiaryPath(input: string): string | null {
  const normalized = path.posix.normalize(input.replace(/\\/g, "/").replace(/^\/+/u, ""));
  if (!normalized.startsWith(`${DIARY_ROOT}/`) || !normalized.endsWith(".md")) {
    return null;
  }
  return normalized;
}

function normalizeFlashDiaryMediaPath(input: string): string | null {
  const normalized = path.posix.normalize(input.replace(/\\/g, "/").replace(/^\/+/u, ""));
  if (!normalized.startsWith(`${DIARY_ASSET_ROOT}/`)) {
    return null;
  }
  return normalized;
}

function decodeMediaDataUrl(dataUrl: string): DecodedMediaData | null {
  const match = SUPPORTED_DATA_URL_RE.exec(dataUrl);
  if (!match) {
    return null;
  }
  const mimeType = (match[1] ?? "").toLowerCase();
  const base64 = (match[2] ?? "").replace(/\s+/gu, "");
  if (!base64) {
    return null;
  }
  return {
    extension: mimeTypeToExtension(mimeType),
    bytes: Buffer.from(base64, "base64"),
  };
}

// fallow-ignore-next-line complexity
function mimeTypeToExtension(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    case "image/bmp":
      return ".bmp";
    case "image/svg+xml":
      return ".svg";
    case "video/quicktime":
      return ".mov";
    case "video/webm":
      return ".webm";
    case "video/x-msvideo":
      return ".avi";
    case "video/mp4":
      return ".mp4";
    default:
      return ".png";
  }
}

function allocateDiaryMediaName(
  sourceVaultRoot: string,
  logicalDirectory: string,
  preferredName: string,
  fallbackExtension: string,
): string {
  const parsed = path.posix.parse(preferredName || `image${fallbackExtension}`);
  const baseName = sanitizeMediaBaseName(parsed.name || "image");
  const extension = normalizeMediaExtension(parsed.ext, fallbackExtension);
  let index = 0;
  while (true) {
    const suffix = index === 0 ? "" : `-${index + 1}`;
    const candidate = `${baseName}${suffix}${extension}`;
    const fullPath = path.join(sourceVaultRoot, ...path.posix.join(logicalDirectory, candidate).split("/"));
    if (!fs.existsSync(fullPath)) {
      return candidate;
    }
    index += 1;
  }
}

function sanitizeMediaBaseName(value: string): string {
  return value.replace(/[^a-z0-9-_]+/giu, "-").replace(/^-+|-+$/gu, "") || "image";
}

// fallow-ignore-next-line complexity
function normalizeMediaExtension(extension: string, fallbackExtension: string): string {
  const normalized = extension.toLowerCase();
  if (
    normalized === ".png" ||
    normalized === ".jpg" ||
    normalized === ".jpeg" ||
    normalized === ".webp" ||
    normalized === ".gif" ||
    normalized === ".bmp" ||
    normalized === ".svg" ||
    normalized === ".mp4" ||
    normalized === ".mov" ||
    normalized === ".m4v" ||
    normalized === ".webm" ||
    normalized === ".avi" ||
    normalized === ".mkv"
  ) {
    return normalized === ".jpeg" ? ".jpg" : normalized;
  }
  return fallbackExtension;
}

function extractDiaryMediaPaths(raw: string, diaryPath: string): Set<string> {
  const results = new Set<string>();
  for (const match of raw.matchAll(DIARY_MEDIA_RE)) {
    const logicalPath = resolveDiaryImageReference(diaryPath, match[1] ?? "");
    if (logicalPath) {
      results.add(logicalPath);
    }
  }
  return results;
}

function findFirstDiaryImagePath(raw: string, diaryPath: string): string | null {
  for (const match of raw.matchAll(DIARY_IMAGE_RE)) {
    const logicalPath = resolveDiaryImageReference(diaryPath, match[1] ?? "");
    if (logicalPath) {
      return logicalPath;
    }
  }
  return null;
}

function resolveDiaryImageReference(diaryPath: string, value: string): string | null {
  const reference = normalizeMarkdownImageReference(value);
  if (!reference) {
    return null;
  }
  const diaryDirectory = path.posix.dirname(diaryPath);
  const logicalPath = reference.startsWith("raw/")
    ? path.posix.normalize(reference)
    : path.posix.normalize(path.posix.join(diaryDirectory, reference));
  return logicalPath.startsWith(`${DIARY_ASSET_ROOT}/`) ? logicalPath : null;
}

function normalizeMarkdownImageReference(value: string): string {
  return value
    .trim()
    .replace(/^<|>$/gu, "")
    .replace(/\s+['"].*$/u, "");
}
