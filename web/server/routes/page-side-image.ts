/**
 * Upload and media routes for the optional right-side wiki article image.
 *
 * Each editable wiki page can bind at most one side image. The selected image
 * is stored under `wiki/.page-media/` inside the source vault, and the page
 * markdown keeps the canonical `side_image` frontmatter value.
 */

import fs from "node:fs";
import path from "node:path";
import type { Request, Response } from "express";
import type { ServerConfig } from "../config.js";
import { resolveEditableSourceMarkdownPath, sourcePath } from "../runtime-paths.js";
import { clearPageRenderCacheForPath } from "./pages.js";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const PAGE_MEDIA_DIR = "wiki/.page-media";
const SUPPORTED_DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp|gif));base64,([a-z0-9+/=\s]+)$/iu;
const SUPPORTED_FRONTMATTER_KEYS = new Set(["side_image", "avatar_image"]);

export function handlePageSideImageUpload(cfg: ServerConfig) {
  // fallow-ignore-next-line complexity
  return (req: Request, res: Response) => {
    const logicalPath = normalizeLogicalPath(req.body?.path);
    if (!logicalPath) {
      res.status(400).json({ success: false, error: "invalid page path" });
      return;
    }

    const editablePath = resolveEditableSourceMarkdownPath(cfg, logicalPath);
    if (!editablePath) {
      res.status(400).json({ success: false, error: "page is not editable" });
      return;
    }

    const dataUrl = typeof req.body?.dataUrl === "string" ? req.body.dataUrl.trim() : "";
    const fileName = typeof req.body?.fileName === "string" ? req.body.fileName.trim() : "";
    const frontmatterKey = normalizeFrontmatterKey(req.body?.frontmatterKey);
    const decoded = decodeImageDataUrl(dataUrl);
    if (!decoded) {
      res.status(400).json({ success: false, error: "invalid image payload" });
      return;
    }

    const nextSideImagePath = buildSideImageLogicalPath(logicalPath, fileName, decoded.extension, frontmatterKey);
    const nextSideImageFullPath = sourcePath(cfg, nextSideImagePath);
    const currentRaw = fs.readFileSync(editablePath, "utf8");
    const previousSideImagePath = readFrontmatterImagePath(currentRaw, frontmatterKey);

    fs.mkdirSync(path.dirname(nextSideImageFullPath), { recursive: true });
    fs.writeFileSync(nextSideImageFullPath, decoded.bytes);
    cleanupReplacedSideImage(cfg, previousSideImagePath, nextSideImagePath);

    const nextRaw = upsertImageFrontmatter(currentRaw, frontmatterKey, nextSideImagePath);
    fs.writeFileSync(editablePath, ensureTrailingNewline(nextRaw), "utf8");
    clearPageRenderCacheForPath(editablePath);

    res.json({
      success: true,
      data: {
        path: logicalPath,
        sideImagePath: nextSideImagePath,
        sideImageUrl: buildSideImageUrl(nextSideImagePath),
        modifiedAt: fs.statSync(editablePath).mtime.toISOString(),
      },
    });
  };
}

export function handlePageSideImageMedia(cfg: ServerConfig) {
  return (req: Request, res: Response) => {
    const logicalPath = normalizeSideImageLogicalPath(req.query.path);
    if (!logicalPath) {
      res.status(400).send("bad path");
      return;
    }

    const fullPath = sourcePath(cfg, logicalPath);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      res.status(404).send("not found");
      return;
    }

    res.sendFile(fullPath);
  };
}

function normalizeLogicalPath(input: unknown): string | null {
  if (typeof input !== "string" || !input.trim()) {
    return null;
  }
  const normalized = path.posix.normalize(input.replace(/\\/g, "/"));
  if (path.posix.isAbsolute(normalized) || normalized.startsWith("../")) {
    return null;
  }
  return normalized;
}

function normalizeSideImageLogicalPath(input: unknown): string | null {
  const normalized = normalizeLogicalPath(input);
  if (!normalized || !(normalized === PAGE_MEDIA_DIR || normalized.startsWith(`${PAGE_MEDIA_DIR}/`))) {
    return null;
  }
  return normalized;
}

function normalizeFrontmatterKey(input: unknown): string {
  return typeof input === "string" && SUPPORTED_FRONTMATTER_KEYS.has(input) ? input : "side_image";
}

function decodeImageDataUrl(dataUrl: string): { extension: string; bytes: Buffer } | null {
  const match = SUPPORTED_DATA_URL_RE.exec(dataUrl);
  if (!match) {
    return null;
  }
  const mimeType = match[1]?.toLowerCase() ?? "";
  const base64 = match[2]?.replace(/\s+/g, "") ?? "";
  if (!base64) {
    return null;
  }
  return {
    extension: mimeTypeToExtension(mimeType),
    bytes: Buffer.from(base64, "base64"),
  };
}

function mimeTypeToExtension(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    default:
      return ".png";
  }
}

function buildSideImageLogicalPath(
  logicalPagePath: string,
  fileName: string,
  fallbackExtension: string,
  frontmatterKey: string,
): string {
  const pageWithoutPrefix = logicalPagePath.replace(/^wiki\//u, "");
  const pageDirectory = path.posix.dirname(pageWithoutPrefix);
  const pageStem = path.posix.basename(pageWithoutPrefix, path.posix.extname(pageWithoutPrefix));
  const imageExtension = normalizeImageExtension(fileName, fallbackExtension);
  const imageRole = frontmatterKey === "avatar_image" ? "avatar" : "side";
  const fileBaseName = `${pageStem}-${imageRole}${imageExtension}`;
  const relativeImagePath = pageDirectory === "."
    ? fileBaseName
    : `${pageDirectory}/${fileBaseName}`;
  return `${PAGE_MEDIA_DIR}/${relativeImagePath}`;
}

function normalizeImageExtension(fileName: string, fallbackExtension: string): string {
  const extension = path.posix.extname(fileName.toLowerCase());
  if (extension === ".png" || extension === ".jpg" || extension === ".jpeg" || extension === ".webp" || extension === ".gif") {
    return extension === ".jpeg" ? ".jpg" : extension;
  }
  return fallbackExtension;
}

function readFrontmatterImagePath(raw: string, frontmatterKey: string): string | null {
  const match = FRONTMATTER_RE.exec(raw.replace(/^\uFEFF/u, ""));
  if (!match) {
    return null;
  }
  for (const line of match[1].split(/\r?\n/u)) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex < 0) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    if (key !== frontmatterKey) {
      continue;
    }
    const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/gu, "");
    return value || null;
  }
  return null;
}

function cleanupReplacedSideImage(
  cfg: ServerConfig,
  previousSideImagePath: string | null,
  nextSideImagePath: string,
): void {
  if (!previousSideImagePath || previousSideImagePath === nextSideImagePath) {
    return;
  }
  const normalizedPrevious = normalizeSideImageLogicalPath(previousSideImagePath);
  if (!normalizedPrevious) {
    return;
  }
  const previousFullPath = sourcePath(cfg, normalizedPrevious);
  if (fs.existsSync(previousFullPath) && fs.statSync(previousFullPath).isFile()) {
    fs.rmSync(previousFullPath, { force: true });
  }
}

function upsertImageFrontmatter(raw: string, frontmatterKey: string, sideImagePath: string): string {
  const normalizedRaw = raw.replace(/^\uFEFF/u, "");
  const match = FRONTMATTER_RE.exec(normalizedRaw);
  if (!match) {
    return `---\n${frontmatterKey}: ${sideImagePath}\n---\n\n${normalizedRaw.trimStart()}`;
  }

  const lines = match[1].split(/\r?\n/u);
  let replaced = false;
  const nextLines = lines.map((line) => {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex < 0) {
      return line;
    }
    const key = line.slice(0, separatorIndex).trim();
    if (key !== frontmatterKey) {
      return line;
    }
    replaced = true;
    return `${frontmatterKey}: ${sideImagePath}`;
  });
  if (!replaced) {
    nextLines.push(`${frontmatterKey}: ${sideImagePath}`);
  }

  const rebuiltFrontmatter = `---\n${nextLines.join("\n")}\n---\n`;
  return `${rebuiltFrontmatter}${normalizedRaw.slice(match[0].length)}`;
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function buildSideImageUrl(logicalPath: string): string {
  return `/api/page-side-image?path=${encodeURIComponent(logicalPath)}`;
}
