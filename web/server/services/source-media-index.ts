/**
 * Builds and persists the source-media index used by the source gallery and
 * media sidecars. Scanning, normalization, and asset collection stay here,
 * while markdown link parsing lives in `source-media-support.ts`.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import {
  detectMediaKind,
  extractMediaReferences,
  isMediaKind,
  NON_MARKDOWN_ATTACHMENT_DIR,
  RAW_DIR,
  type SourceMediaAssetRecord,
  type SourceMediaIndexFile,
  type SourceMediaIndexRecord,
  type SourceMediaKind,
  type SourceMediaReference,
  SOURCES_FULL_DIR,
  toPosix,
} from "./source-media-support.js";

const MEDIA_INDEX_FILE = ".llmwiki/source-media-index.json";

interface SourceDocumentSpec {
  baseRoot: string;
  relativeRoot: typeof RAW_DIR | typeof SOURCES_FULL_DIR;
  layer: SourceMediaIndexRecord["layer"];
}

export async function scanSourceMediaIndex(sourceVaultRoot: string, runtimeRoot: string): Promise<SourceMediaIndexFile> {
  const existing = readSourceMediaIndex(runtimeRoot);
  const documents = scanSourceDocuments(sourceVaultRoot, runtimeRoot, existing);
  const assets = scanSourceMediaAssets(sourceVaultRoot, runtimeRoot, documents);
  const file: SourceMediaIndexFile = {
    version: 1,
    generatedAt: new Date().toISOString(),
    records: Object.fromEntries(documents.map((record) => [record.id, record])),
    assets: Object.fromEntries(assets.map((record) => [record.path, record])),
  };
  await writeSourceMediaIndex(runtimeRoot, file);
  return file;
}

export function readSourceMediaIndex(runtimeRoot: string): SourceMediaIndexFile {
  const file = getSourceMediaIndexPath(runtimeRoot);
  if (!fs.existsSync(file)) {
    return emptySourceMediaIndex();
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<SourceMediaIndexFile>;
    return {
      version: 1,
      generatedAt: typeof parsed.generatedAt === "string" ? parsed.generatedAt : "",
      records: normalizeRecordMap(parsed.records),
      assets: normalizeAssetMap(parsed.assets),
    };
  } catch {
    return emptySourceMediaIndex();
  }
}

export async function writeSourceMediaIndex(
  runtimeRoot: string,
  index: SourceMediaIndexFile,
): Promise<void> {
  const file = getSourceMediaIndexPath(runtimeRoot);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(index, null, 2)}\n`, "utf8");
}

export function sourceMediaId(relativePath: string): string {
  return crypto.createHash("sha1").update(relativePath.replace(/\\/g, "/").toLowerCase()).digest("hex").slice(0, 20);
}

function getSourceMediaIndexPath(runtimeRoot: string): string {
  return path.join(runtimeRoot, MEDIA_INDEX_FILE);
}

function scanSourceDocuments(
  sourceVaultRoot: string,
  runtimeRoot: string,
  existing: SourceMediaIndexFile,
): SourceMediaIndexRecord[] {
  const records = listSourceDocumentSpecs(sourceVaultRoot, runtimeRoot)
    .flatMap((spec) => scanSourceDocumentRoot(spec, sourceVaultRoot, runtimeRoot, existing));
  return records.sort((left, right) => left.path.localeCompare(right.path));
}

function listSourceDocumentSpecs(sourceVaultRoot: string, runtimeRoot: string): SourceDocumentSpec[] {
  return [
    { baseRoot: sourceVaultRoot, relativeRoot: RAW_DIR, layer: "raw" },
    { baseRoot: runtimeRoot, relativeRoot: SOURCES_FULL_DIR, layer: "source" },
  ];
}

function scanSourceDocumentRoot(
  spec: SourceDocumentSpec,
  sourceVaultRoot: string,
  runtimeRoot: string,
  existing: SourceMediaIndexFile,
): SourceMediaIndexRecord[] {
  const records: SourceMediaIndexRecord[] = [];
  for (const fullPath of walkFiles(path.join(spec.baseRoot, spec.relativeRoot))) {
    const relativePath = toPosix(path.relative(spec.baseRoot, fullPath));
    if (!isIndexableSourceDocument(relativePath)) {
      continue;
    }
    records.push(readSourceDocumentRecord(spec, sourceVaultRoot, runtimeRoot, existing, fullPath, relativePath));
  }
  return records;
}

function isIndexableSourceDocument(relativePath: string): boolean {
  return relativePath.toLowerCase().endsWith(".md")
    && !relativePath.includes(`/${NON_MARKDOWN_ATTACHMENT_DIR}/`);
}

function readSourceDocumentRecord(
  spec: SourceDocumentSpec,
  sourceVaultRoot: string,
  runtimeRoot: string,
  existing: SourceMediaIndexFile,
  fullPath: string,
  relativePath: string,
): SourceMediaIndexRecord {
  const raw = fs.readFileSync(fullPath, "utf8");
  const stat = fs.statSync(fullPath);
  const media = extractMediaReferences(sourceVaultRoot, runtimeRoot, relativePath, raw);
  const previous = findExistingRecord(existing, relativePath);
  return {
    id: sourceMediaId(relativePath),
    path: relativePath,
    layer: spec.layer,
    title: readTitle(raw, path.basename(fullPath, ".md")),
    modifiedAt: stat.mtime.toISOString(),
    mediaCount: media.length,
    mediaKinds: [...new Set(media.map((item) => item.kind))],
    coverImagePath: pickCoverImagePath(media),
    ocrTextPath: previous?.ocrTextPath,
    ocrFingerprint: previous?.ocrFingerprint,
    transcriptPath: previous?.transcriptPath,
    media,
  };
}

function pickCoverImagePath(media: SourceMediaReference[]): string | undefined {
  return media.find((item) => item.kind === "image" && item.exists)?.path
    ?? media.find((item) => item.kind === "image")?.path;
}

function scanSourceMediaAssets(
  sourceVaultRoot: string,
  runtimeRoot: string,
  documents: SourceMediaIndexRecord[],
): SourceMediaAssetRecord[] {
  const referencedBy = buildReferencedByMap(documents);
  const assets = [
    ...collectIndexedAssets(sourceVaultRoot, RAW_DIR, referencedBy),
    ...collectIndexedAssets(runtimeRoot, SOURCES_FULL_DIR, referencedBy),
  ];
  return assets.sort((left, right) => left.path.localeCompare(right.path));
}

function buildReferencedByMap(documents: SourceMediaIndexRecord[]): Map<string, Set<string>> {
  const referencedBy = new Map<string, Set<string>>();
  for (const record of documents) {
    for (const media of record.media) {
      const current = referencedBy.get(media.path) ?? new Set<string>();
      current.add(record.path);
      referencedBy.set(media.path, current);
    }
  }
  return referencedBy;
}

function collectIndexedAssets(
  root: string,
  relativeRoot: typeof RAW_DIR | typeof SOURCES_FULL_DIR,
  referencedBy: Map<string, Set<string>>,
): SourceMediaAssetRecord[] {
  const assets: SourceMediaAssetRecord[] = [];
  for (const fullPath of walkFiles(path.join(root, relativeRoot))) {
    const relativePath = toPosix(path.relative(root, fullPath));
    const asset = readSourceMediaAssetRecord(fullPath, relativePath, referencedBy);
    if (asset) {
      assets.push(asset);
    }
  }
  return assets;
}

function readSourceMediaAssetRecord(
  fullPath: string,
  relativePath: string,
  referencedBy: Map<string, Set<string>>,
): SourceMediaAssetRecord | null {
  const kind = detectMediaKind(relativePath);
  if (!kind || shouldSkipSourceMediaAsset(relativePath)) {
    return null;
  }
  const stat = fs.statSync(fullPath);
  return {
    path: relativePath,
    kind,
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    referencedBy: [...(referencedBy.get(relativePath) ?? new Set<string>())].sort(),
  };
}

function shouldSkipSourceMediaAsset(relativePath: string): boolean {
  return relativePath.startsWith(`${SOURCES_FULL_DIR}/`)
    && !relativePath.includes(`/${NON_MARKDOWN_ATTACHMENT_DIR}/`)
    && relativePath.endsWith(".md");
}

function walkFiles(root: string): string[] {
  if (!fs.existsSync(root)) {
    return [];
  }
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath));
      continue;
    }
    if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

function readTitle(raw: string, fallback: string): string {
  const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (frontmatter) {
    for (const line of frontmatter[1]!.split(/\r?\n/)) {
      const match = line.match(/^title:\s*(.*)$/i);
      if (match) {
        return match[1]!.replace(/^["']|["']$/g, "").trim();
      }
    }
  }
  return raw.match(/^#\s+(.+)$/m)?.[1]?.trim() || fallback;
}

function normalizeRecordMap(records: unknown): Record<string, SourceMediaIndexRecord> {
  if (!records || typeof records !== "object") {
    return {};
  }
  const entries = Object.entries(records as Record<string, Partial<SourceMediaIndexRecord>>)
    .map(([key, value]) => normalizeRecordEntry(key, value))
    .filter((entry): entry is [string, SourceMediaIndexRecord] => entry !== null);
  return Object.fromEntries(entries);
}

function normalizeRecordEntry(
  key: string,
  value: Partial<SourceMediaIndexRecord> | undefined,
): [string, SourceMediaIndexRecord] | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const pathValue = readRequiredString(value.path);
  const media = normalizeMediaReferences(value.media);
  return [key, {
    id: readRequiredString(value.id, key),
    path: pathValue,
    layer: readRecordLayer(value.layer),
    title: readRecordTitle(value.title, pathValue),
    modifiedAt: readRequiredString(value.modifiedAt),
    mediaCount: readRecordMediaCount(value.mediaCount, media),
    mediaKinds: normalizeMediaKinds(value.mediaKinds, media),
    coverImagePath: readOptionalString(value.coverImagePath),
    ocrTextPath: readOptionalString(value.ocrTextPath),
    ocrFingerprint: readOptionalString(value.ocrFingerprint),
    transcriptPath: readOptionalString(value.transcriptPath),
    media,
  }];
}

function normalizeMediaReferences(value: unknown): SourceMediaReference[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => normalizeMediaReference(item as Partial<SourceMediaReference>))
    .filter((item): item is SourceMediaReference => item !== undefined);
}

function normalizeMediaReference(value: Partial<SourceMediaReference>): SourceMediaReference | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  if (!isMediaKind(value.kind) || typeof value.path !== "string") {
    return undefined;
  }
  return {
    kind: value.kind,
    path: value.path,
    reference: typeof value.reference === "string" ? value.reference : value.path,
    alt: typeof value.alt === "string" ? value.alt : undefined,
    title: typeof value.title === "string" ? value.title : undefined,
    exists: Boolean(value.exists),
  };
}

function normalizeMediaKinds(value: unknown, media: SourceMediaReference[]): SourceMediaKind[] {
  if (!Array.isArray(value)) {
    return [...new Set(media.map((item) => item.kind))];
  }
  return [...new Set(value.map((item) => String(item)).filter(isMediaKind))];
}

function readRequiredString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readRecordLayer(value: unknown): SourceMediaIndexRecord["layer"] {
  return value === "source" ? "source" : "raw";
}

function readRecordTitle(value: unknown, pathValue: string): string {
  if (typeof value === "string") {
    return value;
  }
  return path.basename(pathValue, path.extname(pathValue));
}

function readRecordMediaCount(value: unknown, media: SourceMediaReference[]): number {
  return typeof value === "number" ? value : media.length;
}

function normalizeAssetMap(assets: unknown): Record<string, SourceMediaAssetRecord> {
  if (!assets || typeof assets !== "object") {
    return {};
  }
  const entries = Object.entries(assets as Record<string, Partial<SourceMediaAssetRecord>>)
    .map(([key, value]) => normalizeAssetEntry(key, value))
    .filter((entry): entry is [string, SourceMediaAssetRecord] => entry !== null);
  return Object.fromEntries(entries);
}

function normalizeAssetEntry(
  key: string,
  value: Partial<SourceMediaAssetRecord> | undefined,
): [string, SourceMediaAssetRecord] | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return [key, {
    path: typeof value.path === "string" ? value.path : key,
    kind: isMediaKind(value.kind) ? value.kind : "image",
    size: typeof value.size === "number" ? value.size : 0,
    modifiedAt: typeof value.modifiedAt === "string" ? value.modifiedAt : "",
    referencedBy: normalizeStringArray(value.referencedBy),
  }];
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item)).filter(Boolean);
}

function findExistingRecord(
  existing: SourceMediaIndexFile,
  relativePath: string,
): SourceMediaIndexRecord | undefined {
  return Object.values(existing.records).find((record) => record.path === relativePath);
}

function emptySourceMediaIndex(): SourceMediaIndexFile {
  return { version: 1, generatedAt: "", records: {}, assets: {} };
}
