/**
 * Image caption pipeline for markdown documents.
 *
 * The pipeline resolves local markdown image references, caches captions by
 * image bytes, and writes captions back into image alt text. Search and chat
 * then consume the resulting text without sending images to a model again.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

interface CaptionMarkdownImagesInput {
  sourceVaultRoot: string;
  runtimeRoot: string;
  markdownPath: string;
  markdown: string;
  captionImage: CaptionImageFn;
  overwriteAlt?: boolean;
}

interface CaptionImageRequest {
  absPath: string;
  relPath: string;
  mimeType: string;
  existingAlt: string;
  context: string;
}

type CaptionImageFn = (request: CaptionImageRequest) => Promise<string>;

interface CaptionCache {
  version: 1;
  items: Record<string, CaptionCacheItem>;
}

interface CaptionCacheItem {
  caption: string;
  updatedAt: string;
}

interface CaptionedImage {
  original: string;
  alt: string;
  url: string;
  caption: string;
}

interface CaptionMarkdownImagesResult {
  markdown: string;
  attempted: number;
  captioned: number;
  cached: number;
  skipped: number;
  failed: number;
}

const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)(\s+"[^"]*")?\)/g;
const CONTEXT_RADIUS = 150;

export async function captionMarkdownImages(
  input: CaptionMarkdownImagesInput,
): Promise<CaptionMarkdownImagesResult> {
  const cache = readCaptionCache(input.runtimeRoot);
  const images = [...input.markdown.matchAll(MARKDOWN_IMAGE_RE)];
  const captioned: CaptionedImage[] = [];
  const summary = emptyResult(input.markdown);

  for (const match of images) {
    const next = await captionMarkdownImage(input, cache, match);
    addCaptionSummary(summary, next);
    if (next.image) captioned.push(next.image);
  }

  if (captioned.length > 0) {
    writeCaptionCache(input.runtimeRoot, cache);
  }
  return {
    ...summary,
    markdown: rewriteMarkdownImages(input.markdown, captioned),
  };
}

async function captionMarkdownImage(
  input: CaptionMarkdownImagesInput,
  cache: CaptionCache,
  match: RegExpMatchArray,
): Promise<{ image?: CaptionedImage; cached: boolean; skipped: boolean; failed: boolean }> {
  const target = resolveCaptionTarget(input, match);
  if (!target) return skippedCaption();
  const bytes = fs.readFileSync(target.absPath);
  const hash = crypto.createHash("sha256").update(bytes).digest("hex");
  const cached = cache.items[hash]?.caption.trim();
  const caption = cached || await readFreshCaption(input, target.absPath, target.url, target.alt, target.original);
  if (!caption) return { skipped: false, cached: false, failed: true };
  if (!cached) {
    cache.items[hash] = { caption, updatedAt: new Date().toISOString() };
  }
  return {
    image: { original: target.original, alt: target.alt, url: target.url, caption },
    cached: Boolean(cached),
    skipped: false,
    failed: false,
  };
}

function resolveCaptionTarget(
  input: CaptionMarkdownImagesInput,
  match: RegExpMatchArray,
): { original: string; alt: string; url: string; absPath: string } | null {
  const original = match[0] ?? "";
  const alt = (match[1] ?? "").trim();
  const url = normalizeImageUrl(match[2] ?? "");
  if (!url || (!input.overwriteAlt && alt)) return null;
  const absPath = resolveLocalImagePath(input.sourceVaultRoot, input.runtimeRoot, input.markdownPath, url);
  return absPath ? { original, alt, url, absPath } : null;
}

function skippedCaption(): { cached: false; skipped: true; failed: false } {
  return { cached: false, skipped: true, failed: false };
}

async function readFreshCaption(
  input: CaptionMarkdownImagesInput,
  absPath: string,
  relPath: string,
  existingAlt: string,
  original: string,
): Promise<string> {
  try {
    const caption = await input.captionImage({
      absPath,
      relPath,
      existingAlt,
      mimeType: mimeTypeForPath(absPath),
      context: readImageContext(input.markdown, original),
    });
    return caption.trim();
  } catch {
    return "";
  }
}

function rewriteMarkdownImages(markdown: string, images: CaptionedImage[]): string {
  let result = markdown;
  for (const image of images) {
    result = result.replace(image.original, `![${escapeMarkdownAlt(image.caption)}](${image.url})`);
  }
  return result;
}

function readImageContext(markdown: string, original: string): string {
  const index = markdown.indexOf(original);
  if (index < 0) return "";
  const start = Math.max(0, index - CONTEXT_RADIUS);
  const end = Math.min(markdown.length, index + original.length + CONTEXT_RADIUS);
  return markdown.slice(start, end).replace(/\s+/g, " ").trim();
}

function resolveLocalImagePath(
  sourceVaultRoot: string,
  runtimeRoot: string,
  markdownPath: string,
  imageUrl: string,
): string | null {
  if (/^(https?:\/\/|data:)/i.test(imageUrl)) return null;
  const normalizedUrl = imageUrl.replace(/^\/+/, "");
  const ownerDir = path.posix.dirname(markdownPath.replace(/\\/g, "/"));
  const logicalPath = normalizedUrl.includes("/")
    ? normalizedUrl
    : path.posix.join(ownerDir, normalizedUrl);
  const root = logicalPath.startsWith("sources_full/") || logicalPath.startsWith("wiki/")
    ? runtimeRoot
    : sourceVaultRoot;
  const fullPath = path.resolve(root, ...logicalPath.split("/"));
  if (!isInsideRoot(fullPath, root)) return null;
  return fs.existsSync(fullPath) && fs.statSync(fullPath).isFile() ? fullPath : null;
}

function readCaptionCache(runtimeRoot: string): CaptionCache {
  const filePath = captionCachePath(runtimeRoot);
  if (!fs.existsSync(filePath)) return { version: 1, items: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<CaptionCache>;
    return parsed.version === 1 && parsed.items && typeof parsed.items === "object"
      ? { version: 1, items: parsed.items }
      : { version: 1, items: {} };
  } catch {
    return { version: 1, items: {} };
  }
}

function writeCaptionCache(runtimeRoot: string, cache: CaptionCache): void {
  const filePath = captionCachePath(runtimeRoot);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

function captionCachePath(runtimeRoot: string): string {
  return path.join(runtimeRoot, ".llmwiki", "image-caption-cache.json");
}

function addCaptionSummary(
  result: CaptionMarkdownImagesResult,
  next: { image?: CaptionedImage; cached: boolean; skipped: boolean; failed: boolean },
): void {
  if (next.skipped) {
    result.skipped += 1;
    return;
  }
  result.attempted += 1;
  if (next.failed) result.failed += 1;
  if (next.cached) result.cached += 1;
  if (next.image) result.captioned += 1;
}

function emptyResult(markdown: string): CaptionMarkdownImagesResult {
  return { markdown, attempted: 0, captioned: 0, cached: 0, skipped: 0, failed: 0 };
}

function normalizeImageUrl(value: string): string {
  return value.trim().replace(/^<|>$/g, "");
}

function escapeMarkdownAlt(value: string): string {
  return value.replace(/]/g, "\\]");
}

function mimeTypeForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/png";
}

function isInsideRoot(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
