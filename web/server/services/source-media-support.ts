/**
 * Shared source-media types and helpers for indexing markdown-attached assets.
 * This module keeps path resolution and markdown reference parsing isolated so
 * the indexer can stay focused on scanning and persistence.
 */
import fs from "node:fs";
import path from "node:path";

export type SourceMediaKind = "image" | "pdf" | "video" | "audio";
type SourceMediaLayer = "raw" | "source";

export interface SourceMediaIndexFile {
  version: 1;
  generatedAt: string;
  records: Record<string, SourceMediaIndexRecord>;
  assets: Record<string, SourceMediaAssetRecord>;
}

export interface SourceMediaIndexRecord {
  id: string;
  path: string;
  layer: SourceMediaLayer;
  title: string;
  modifiedAt: string;
  mediaCount: number;
  mediaKinds: SourceMediaKind[];
  coverImagePath?: string;
  ocrTextPath?: string;
  ocrFingerprint?: string;
  transcriptPath?: string;
  media: SourceMediaReference[];
}

export interface SourceMediaReference {
  kind: SourceMediaKind;
  path: string;
  reference: string;
  alt?: string;
  title?: string;
  exists: boolean;
}

export interface SourceMediaAssetRecord {
  path: string;
  kind: SourceMediaKind;
  size: number;
  modifiedAt: string;
  referencedBy: string[];
}

interface MediaReferenceMatch {
  reference: string;
  alt?: string;
  title?: string;
}

interface MediaReferencePattern {
  expression: RegExp;
  readMatch: (match: RegExpMatchArray) => MediaReferenceMatch | null;
  skipKind?: SourceMediaKind;
}

export const RAW_DIR = "raw";
export const SOURCES_FULL_DIR = "sources_full";
export const NON_MARKDOWN_ATTACHMENT_DIR = "附件副本（非Markdown）";

const MEDIA_EXTENSIONS = new Map<string, SourceMediaKind>([
  [".png", "image"],
  [".jpg", "image"],
  [".jpeg", "image"],
  [".gif", "image"],
  [".webp", "image"],
  [".bmp", "image"],
  [".svg", "image"],
  [".pdf", "pdf"],
  [".mp4", "video"],
  [".mov", "video"],
  [".webm", "video"],
  [".mkv", "video"],
  [".m4v", "video"],
  [".avi", "video"],
  [".mp3", "audio"],
  [".wav", "audio"],
  [".m4a", "audio"],
  [".aac", "audio"],
  [".ogg", "audio"],
  [".flac", "audio"],
]);

const MEDIA_REFERENCE_PATTERNS: readonly MediaReferencePattern[] = [
  {
    expression: /!\[([^\]]*)]\(([^)]+)\)/g,
    readMatch: (match) => ({
      alt: match[1]?.trim() || undefined,
      reference: match[2] ?? "",
    }),
  },
  {
    expression: /!\[\[([^\]]+)\]\]/g,
    readMatch: (match) => ({
      reference: match[1] ?? "",
    }),
  },
  {
    expression: /\[([^\]]+)\]\(([^)]+)\)/g,
    readMatch: (match) => ({
      title: match[1]?.trim() || undefined,
      reference: match[2] ?? "",
    }),
    skipKind: "image",
  },
] as const;

export function extractMediaReferences(
  sourceVaultRoot: string,
  runtimeRoot: string,
  markdownPath: string,
  raw: string,
): SourceMediaReference[] {
  const refs: SourceMediaReference[] = [];
  const seen = new Set<string>();
  for (const pattern of MEDIA_REFERENCE_PATTERNS) {
    collectMediaReferenceMatches(pattern, sourceVaultRoot, runtimeRoot, markdownPath, raw, refs, seen);
  }
  return refs;
}

export function detectMediaKind(relativePath: string): SourceMediaKind | undefined {
  return MEDIA_EXTENSIONS.get(path.extname(relativePath).toLowerCase());
}

export function isMediaKind(value: unknown): value is SourceMediaKind {
  return value === "image" || value === "pdf" || value === "video" || value === "audio";
}

function resolveLogicalPath(sourceVaultRoot: string, runtimeRoot: string, relativePath: string): string {
  const normalized = toPosix(relativePath);
  const baseRoot = ownerRootForLogicalPath(sourceVaultRoot, runtimeRoot, normalized);
  return path.join(baseRoot, ...normalized.split("/"));
}

export function toPosix(value: string): string {
  return value.replace(/\\/g, "/");
}

function collectMediaReferenceMatches(
  pattern: MediaReferencePattern,
  sourceVaultRoot: string,
  runtimeRoot: string,
  markdownPath: string,
  raw: string,
  refs: SourceMediaReference[],
  seen: Set<string>,
): void {
  for (const match of raw.matchAll(pattern.expression)) {
    const candidate = pattern.readMatch(match);
    if (!candidate) {
      continue;
    }
    pushMediaReference(pattern, sourceVaultRoot, runtimeRoot, markdownPath, candidate, refs, seen);
  }
}

function pushMediaReference(
  pattern: MediaReferencePattern,
  sourceVaultRoot: string,
  runtimeRoot: string,
  markdownPath: string,
  candidate: MediaReferenceMatch,
  refs: SourceMediaReference[],
  seen: Set<string>,
): void {
  const reference = normalizeLinkTarget(candidate.reference);
  const resolved = resolveLocalMediaPath(sourceVaultRoot, runtimeRoot, markdownPath, reference);
  const kind = detectMediaKind(resolved ?? reference);
  if (!kind || kind === pattern.skipKind) {
    return;
  }
  const key = `${kind}:${resolved ?? reference}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  refs.push({
    kind,
    path: resolved ? toLogicalPath(sourceVaultRoot, runtimeRoot, resolved) : reference,
    reference,
    alt: candidate.alt,
    title: candidate.title,
    exists: Boolean(resolved),
  });
}

function resolveLocalMediaPath(
  sourceVaultRoot: string,
  runtimeRoot: string,
  markdownPath: string,
  reference: string,
): string | undefined {
  const cleaned = readCleanLinkTarget(reference);
  if (!cleaned) {
    return undefined;
  }
  const markdownFile = resolveLogicalPath(sourceVaultRoot, runtimeRoot, markdownPath);
  const candidate = resolveMediaCandidatePath(sourceVaultRoot, runtimeRoot, markdownFile, cleaned);
  if (!isLocalMediaFile(candidate, sourceVaultRoot, runtimeRoot)) {
    return undefined;
  }
  return canUseRelativeMediaPath(candidate, cleaned, sourceVaultRoot, runtimeRoot, markdownPath) ? candidate : undefined;
}

function readCleanLinkTarget(reference: string): string | null {
  if (!reference || /^https?:\/\//i.test(reference) || /^data:/i.test(reference)) {
    return null;
  }
  const cleaned = reference.split("#")[0]?.split("?")[0]?.trim();
  return cleaned || null;
}

function resolveMediaCandidatePath(
  sourceVaultRoot: string,
  runtimeRoot: string,
  markdownFile: string,
  cleaned: string,
): string {
  if (path.isAbsolute(cleaned)) {
    return path.resolve(cleaned);
  }
  if (cleaned.startsWith(`${RAW_DIR}/`) || cleaned.startsWith(`${SOURCES_FULL_DIR}/`)) {
    return resolveLogicalPath(sourceVaultRoot, runtimeRoot, cleaned);
  }
  return path.resolve(path.dirname(markdownFile), cleaned);
}

function isLocalMediaFile(candidate: string, sourceVaultRoot: string, runtimeRoot: string): boolean {
  if (!isInsideRoot(candidate, sourceVaultRoot) && !isInsideRoot(candidate, runtimeRoot)) {
    return false;
  }
  return path.isAbsolute(candidate) && fs.existsSync(candidate) && fs.statSync(candidate).isFile();
}

function canUseRelativeMediaPath(
  candidate: string,
  cleaned: string,
  sourceVaultRoot: string,
  runtimeRoot: string,
  markdownPath: string,
): boolean {
  if (cleaned.startsWith(`${RAW_DIR}/`) || cleaned.startsWith(`${SOURCES_FULL_DIR}/`)) {
    return true;
  }
  const ownerRoot = ownerRootForLogicalPath(sourceVaultRoot, runtimeRoot, markdownPath);
  return isInsideRoot(candidate, ownerRoot);
}

function normalizeLinkTarget(value: string): string {
  return value.replace(/^\s+|\s+$/g, "").replace(/^<|>$/g, "");
}

function ownerRootForLogicalPath(sourceVaultRoot: string, runtimeRoot: string, relativePath: string): string {
  return toPosix(relativePath).startsWith(`${SOURCES_FULL_DIR}/`) ? runtimeRoot : sourceVaultRoot;
}

function toLogicalPath(sourceVaultRoot: string, runtimeRoot: string, fullPath: string): string {
  if (isInsideRoot(fullPath, sourceVaultRoot)) {
    return toPosix(path.relative(sourceVaultRoot, fullPath));
  }
  return toPosix(path.relative(runtimeRoot, fullPath));
}

function isInsideRoot(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
