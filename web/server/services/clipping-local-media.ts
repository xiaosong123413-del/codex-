/**
 * Local clipping media attachment helpers.
 *
 * Copies user-provided image and video files into the asset folder beside an
 * already-created clipping markdown file, then appends stable markdown
 * references so source-gallery and compile can discover the media later.
 */
import fs from "node:fs";
import path from "node:path";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { scanSourceMediaIndex } from "./source-media-index.js";

type LocalClippingMediaKind = "image" | "video";

interface AppendedLocalClippingMedia {
  readonly kind: LocalClippingMediaKind;
  readonly mediaPath: string;
  readonly markdownReference: string;
}

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv"]);

export function readLocalMediaPaths(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

export async function appendLocalClippingMedia(
  sourceVaultRoot: string,
  runtimeRoot: string,
  markdownPath: string,
  mediaPaths: readonly string[],
): Promise<AppendedLocalClippingMedia[]> {
  if (mediaPaths.length === 0) {
    return [];
  }
  const target = resolveMarkdownTarget(sourceVaultRoot, markdownPath);
  const copied = await copyLocalMediaFiles(sourceVaultRoot, target, mediaPaths);
  if (copied.length === 0) {
    return [];
  }
  const raw = await readFile(target.fullPath, "utf8");
  await writeFile(target.fullPath, appendMediaSection(raw, copied), "utf8");
  await scanSourceMediaIndex(sourceVaultRoot, runtimeRoot);
  return copied;
}

interface MarkdownTarget {
  readonly fullPath: string;
  readonly relativePath: string;
}

async function copyLocalMediaFiles(
  sourceVaultRoot: string,
  target: MarkdownTarget,
  mediaPaths: readonly string[],
): Promise<AppendedLocalClippingMedia[]> {
  const assetDir = path.join(path.dirname(target.fullPath), "assets", assetFolderName(target.relativePath));
  await mkdir(assetDir, { recursive: true });
  const copied: AppendedLocalClippingMedia[] = [];
  for (const source of mediaPaths) {
    const media = await copyOneLocalMedia(sourceVaultRoot, target.fullPath, assetDir, source);
    copied.push(media);
  }
  return copied;
}

async function copyOneLocalMedia(
  sourceVaultRoot: string,
  markdownFullPath: string,
  assetDir: string,
  source: string,
): Promise<AppendedLocalClippingMedia> {
  const sourcePath = path.resolve(source);
  const kind = mediaKindFromPath(sourcePath);
  if (!kind) {
    throw new Error(`unsupported clipping media: ${source}`);
  }
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    throw new Error(`clipping media file not found: ${source}`);
  }
  const fileName = allocateMediaName(assetDir, path.basename(sourcePath));
  const targetPath = path.join(assetDir, fileName);
  await copyFile(sourcePath, targetPath);
  return {
    kind,
    mediaPath: toPosix(path.relative(sourceVaultRoot, targetPath)),
    markdownReference: markdownReference(markdownFullPath, targetPath),
  };
}

function resolveMarkdownTarget(sourceVaultRoot: string, markdownPath: string): MarkdownTarget {
  const relativePath = normalizeMarkdownPath(markdownPath);
  if (!relativePath) {
    throw new Error("invalid clipping markdown path");
  }
  const fullPath = path.resolve(sourceVaultRoot, ...relativePath.split("/"));
  if (!isInsideRoot(fullPath, sourceVaultRoot) || !fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    throw new Error("clipping markdown file not found");
  }
  return { fullPath, relativePath };
}

function normalizeMarkdownPath(value: string): string | null {
  const normalized = path.posix.normalize(value.replace(/\\/g, "/").replace(/^\/+/u, ""));
  if (!normalized || normalized.startsWith("../") || normalized === ".." || !normalized.endsWith(".md")) {
    return null;
  }
  return normalized;
}

function appendMediaSection(raw: string, media: readonly AppendedLocalClippingMedia[]): string {
  const lines = ["", "", "## 手动附件", ""];
  for (const item of media) {
    lines.push(renderMediaReference(item), "");
  }
  return `${raw.trimEnd()}${lines.join("\n")}`.trimEnd() + "\n";
}

function renderMediaReference(media: AppendedLocalClippingMedia): string {
  if (media.kind === "image") {
    return `![](${media.markdownReference})`;
  }
  return `[视频：${path.posix.basename(media.mediaPath)}](${media.markdownReference})`;
}

function assetFolderName(markdownPath: string): string {
  const stem = path.posix.basename(markdownPath, ".md");
  return stem.replace(/[<>:"/\\|?*\x00-\x1F]+/g, "-").replace(/\s+/g, "-").trim() || "media";
}

function mediaKindFromPath(filePath: string): LocalClippingMediaKind | null {
  const extension = path.extname(filePath).toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension)) {
    return "image";
  }
  if (VIDEO_EXTENSIONS.has(extension)) {
    return "video";
  }
  return null;
}

function allocateMediaName(dir: string, preferredName: string): string {
  const parsed = path.parse(preferredName);
  const base = parsed.name.replace(/[<>:"/\\|?*\x00-\x1F]+/g, "-").trim() || "media";
  let index = 0;
  while (true) {
    const suffix = index === 0 ? "" : `-${index + 1}`;
    const candidate = `${base}${suffix}${parsed.ext.toLowerCase()}`;
    if (!fs.existsSync(path.join(dir, candidate))) {
      return candidate;
    }
    index += 1;
  }
}

function markdownReference(markdownFullPath: string, targetPath: string): string {
  const relative = toPosix(path.relative(path.dirname(markdownFullPath), targetPath));
  return relative.startsWith(".") ? relative : `./${relative}`;
}

function isInsideRoot(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function toPosix(value: string): string {
  return value.replace(/\\/g, "/");
}
