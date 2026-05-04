/**
 * Source image OCR orchestration.
 *
 * Source media scanning discovers image references, while `ocr-service.ts`
 * knows how to call Cloudflare and write sidecars. This module connects those
 * two pieces: it OCRs image media for selected source records, stores combined
 * text under `.llmwiki/ocr/<source-id>.txt`, and updates the source-media index
 * so search and source-gallery views can read the text deterministically.
 */
import fs from "node:fs";
import path from "node:path";
import {
  extractCloudflareOcrText,
  isCloudflareOcrConfigured,
  readSourceOcrSidecar,
  writeSourceOcrSidecar,
} from "./ocr-service.js";
import {
  readSourceMediaIndex,
  scanSourceMediaIndex,
  writeSourceMediaIndex,
} from "./source-media-index.js";
import type {
  SourceMediaIndexFile,
  SourceMediaIndexRecord,
  SourceMediaReference,
} from "./source-media-support.js";

const SOURCE_IMAGE_OCR_FINGERPRINT = "source-image-ocr:v2:verbatim-text";

interface SourceImageOcrSummary {
  attempted: number;
  written: number;
  skipped: number;
  failed: number;
}

interface SourceImageOcrRunResult {
  id: string;
  sourcePath: string;
  path: string;
  text: string;
  summary: SourceImageOcrSummary;
}

interface EnsureSourceImageOcrInput {
  sourceVaultRoot: string;
  runtimeRoot: string;
  recordPaths?: readonly string[];
  rescan?: boolean;
}

interface EnsureSourceImageOcrResult {
  index: SourceMediaIndexFile;
  summary: SourceImageOcrSummary;
}

/**
 * Ensures image OCR sidecars exist for source media records.
 *
 * When `recordPaths` is omitted, every indexed source record with existing
 * image media is eligible. When `rescan` is true, the source-media index is
 * rebuilt first so recently saved diary Markdown can be discovered.
 */
export async function ensureSourceImageOcr(
  input: EnsureSourceImageOcrInput,
): Promise<EnsureSourceImageOcrResult> {
  const index = input.rescan
    ? await scanSourceMediaIndex(input.sourceVaultRoot, input.runtimeRoot)
    : readSourceMediaIndex(input.runtimeRoot);
  const summary = emptySummary();
  if (!isCloudflareOcrConfigured()) {
    return { index, summary };
  }

  const targetPaths = new Set(input.recordPaths?.map(normalizePath));
  let changed = false;
  for (const record of selectRecords(index, targetPaths)) {
    const result = await ocrSourceRecord(input.sourceVaultRoot, input.runtimeRoot, record);
    addSummary(summary, result.summary);
    changed = updateRecordOcrMetadata(index, record.id, result.ocrTextPath) || changed;
  }
  if (changed) {
    index.generatedAt = new Date().toISOString();
    await writeSourceMediaIndex(input.runtimeRoot, index);
  }
  return { index, summary };
}

/**
 * Runs OCR for one source document path and returns the persisted sidecar text.
 *
 * The path is the stable contract for desktop and mobile callers because it is
 * available immediately after a diary or source entry is saved.
 */
export async function runSourcePathImageOcr(input: {
  sourceVaultRoot: string;
  runtimeRoot: string;
  sourcePath: string;
}): Promise<SourceImageOcrRunResult> {
  const sourcePath = normalizePath(input.sourcePath).trim();
  if (!sourcePath) throw new Error("source path required");
  const result = await ensureSourceImageOcr({
    sourceVaultRoot: input.sourceVaultRoot,
    runtimeRoot: input.runtimeRoot,
    recordPaths: [sourcePath],
    rescan: true,
  });
  const record = findRecordByPath(result.index, sourcePath);
  if (!record) throw new Error("source record not found");
  if (!record.ocrTextPath) throw new Error(sourceOcrMissingMessage(result.summary));
  const text = readSourceOcrSidecar(input.runtimeRoot, record.id);
  if (!text) throw new Error(sourceOcrMissingMessage(result.summary));
  return { id: record.id, sourcePath: record.path, path: record.ocrTextPath, text, summary: result.summary };
}

async function ocrSourceRecord(
  sourceVaultRoot: string,
  runtimeRoot: string,
  record: SourceMediaIndexRecord,
): Promise<{ summary: SourceImageOcrSummary; ocrTextPath?: string }> {
  const summary = emptySummary();
  if (hasExistingOcr(runtimeRoot, record)) {
    summary.skipped += 1;
    return { summary, ocrTextPath: record.ocrTextPath };
  }
  const chunks = await readImageOcrChunks(sourceVaultRoot, runtimeRoot, record, summary);
  if (chunks.length === 0) {
    return { summary };
  }
  const sidecar = await writeSourceOcrSidecar(runtimeRoot, record.id, chunks.join("\n\n"));
  summary.written += 1;
  return { summary, ocrTextPath: sidecar.path };
}

async function readImageOcrChunks(
  sourceVaultRoot: string,
  runtimeRoot: string,
  record: SourceMediaIndexRecord,
  summary: SourceImageOcrSummary,
): Promise<string[]> {
  const chunks: string[] = [];
  for (const media of record.media.filter(isExistingImage)) {
    const fullPath = resolveLogicalMediaPath(sourceVaultRoot, runtimeRoot, media.path);
    if (!fullPath) {
      continue;
    }
    summary.attempted += 1;
    const result = await extractCloudflareOcrText({ filePath: fullPath });
    if (!result.ok) {
      summary.failed += 1;
      continue;
    }
    const text = result.text.trim();
    if (text) {
      chunks.push([`Image: ${media.path}`, text].join("\n"));
    }
  }
  return chunks;
}

function selectRecords(
  index: SourceMediaIndexFile,
  targetPaths: ReadonlySet<string>,
): SourceMediaIndexRecord[] {
  return Object.values(index.records)
    .filter((record) => targetPaths.size === 0 || targetPaths.has(normalizePath(record.path)))
    .filter((record) => record.media.some(isExistingImage));
}

function findRecordByPath(index: SourceMediaIndexFile, sourcePath: string): SourceMediaIndexRecord | undefined {
  return Object.values(index.records).find((record) => normalizePath(record.path) === sourcePath);
}

function updateRecordOcrMetadata(index: SourceMediaIndexFile, id: string, ocrTextPath: string | undefined): boolean {
  if (!ocrTextPath) {
    return false;
  }
  const record = index.records[id];
  if (!record) {
    return false;
  }
  if (record.ocrTextPath === ocrTextPath && record.ocrFingerprint === SOURCE_IMAGE_OCR_FINGERPRINT) {
    return false;
  }
  index.records[id] = { ...record, ocrTextPath, ocrFingerprint: SOURCE_IMAGE_OCR_FINGERPRINT };
  return true;
}

function hasExistingOcr(runtimeRoot: string, record: SourceMediaIndexRecord): boolean {
  return Boolean(
    record.ocrFingerprint === SOURCE_IMAGE_OCR_FINGERPRINT
    && record.ocrTextPath
    && readSourceOcrSidecar(runtimeRoot, record.id).trim(),
  );
}

function resolveLogicalMediaPath(sourceVaultRoot: string, runtimeRoot: string, relativePath: string): string | null {
  const normalized = normalizePath(relativePath);
  const root = normalized.startsWith("sources_full/") ? runtimeRoot : sourceVaultRoot;
  const fullPath = path.resolve(root, ...normalized.split("/"));
  if (!isInsideRoot(fullPath, root)) {
    return null;
  }
  return fs.existsSync(fullPath) && fs.statSync(fullPath).isFile() ? fullPath : null;
}

function isExistingImage(media: SourceMediaReference): boolean {
  return media.kind === "image" && media.exists;
}

function isInsideRoot(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function sourceOcrMissingMessage(summary: SourceImageOcrSummary): string {
  if (summary.failed > 0) {
    return "source image OCR failed";
  }
  if (!isCloudflareOcrConfigured()) {
    return "Cloudflare OCR is not configured";
  }
  return "no image OCR text found";
}

function emptySummary(): SourceImageOcrSummary {
  return { attempted: 0, written: 0, skipped: 0, failed: 0 };
}

function addSummary(target: SourceImageOcrSummary, source: SourceImageOcrSummary): void {
  target.attempted += source.attempted;
  target.written += source.written;
  target.skipped += source.skipped;
  target.failed += source.failed;
}
