/**
 * Media traceability lint rules for wiki content.
 *
 * Verifies that images, videos, PDFs, and other linked attachments referenced
 * by wiki pages can be traced back to raw/ or sources_full/. The rule uses a
 * lightweight source index built from stored markdown and archived files, not
 * UI metadata, so it stays aligned with the compiler's filesystem model.
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import { readFile } from "fs/promises";
import path from "path";
import {
  CONCEPTS_DIR,
  PROCEDURES_DIR,
  QUERIES_DIR,
  SOURCES_FULL_DIR,
} from "../utils/constants.js";
import type { LintResult } from "./types.js";

type MediaKind = "image" | "video" | "attachment";

interface MediaReference {
  kind: MediaKind;
  target: string;
  line: number;
}

interface MediaIndex {
  exactTargets: Set<string>;
  fileNames: Set<string>;
  hashes: Set<string>;
  remoteUrls: Set<string>;
}

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".avi", ".mkv", ".m4v"]);
const ATTACHMENT_EXTENSIONS = new Set([
  ".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".csv", ".zip", ".rar", ".7z", ".mp3", ".wav", ".m4a",
]);
const WIKI_PAGE_DIRS = [CONCEPTS_DIR, QUERIES_DIR, PROCEDURES_DIR];
const MARKDOWN_IMAGE_PATTERN = /!\[[^\]]*]\(([^)]+)\)/g;
const MARKDOWN_LINK_PATTERN = /\[[^\]]*]\(([^)]+)\)/g;
const OBSIDIAN_EMBED_PATTERN = /!\[\[([^\]]+)\]\]/g;
const HTML_MEDIA_PATTERN = /<(img|video|source|a)\b[^>]+(?:src|href)=["']([^"']+)["'][^>]*>/gi;

export async function checkUntraceableMediaReferences(root: string): Promise<LintResult[]> {
  const pages = await collectWikiPages(root);
  const index = buildMediaIndex(root);
  const results: LintResult[] = [];

  for (const page of pages) {
    const references = findMediaReferences(page.content);
    for (const reference of references) {
      if (isTraceable(reference.target, index)) continue;
      results.push({
        rule: `untraceable-${reference.kind}`,
        severity: "error",
        file: page.filePath,
        line: reference.line,
        message: `${capitalize(reference.kind)} reference ${reference.target} cannot be traced to raw/ or sources_full/`,
      });
    }
  }

  return results;
}

async function collectWikiPages(root: string): Promise<Array<{ filePath: string; content: string }>> {
  const pages: Array<{ filePath: string; content: string }> = [];
  for (const dir of WIKI_PAGE_DIRS) {
    const dirPath = path.join(root, dir);
    if (!existsSync(dirPath)) continue;
    for (const fileName of readdirSync(dirPath)) {
      if (!fileName.endsWith(".md")) continue;
      const filePath = path.join(dirPath, fileName);
      pages.push({ filePath, content: await readFile(filePath, "utf8") });
    }
  }
  return pages;
}

function buildMediaIndex(root: string): MediaIndex {
  const index: MediaIndex = {
    exactTargets: new Set(),
    fileNames: new Set(),
    hashes: new Set(),
    remoteUrls: new Set(),
  };
  for (const dir of [path.join(root, "raw"), path.join(root, SOURCES_FULL_DIR)]) {
    if (!existsSync(dir)) continue;
    indexDirectory(dir, root, index);
  }
  return index;
}

function indexDirectory(current: string, root: string, index: MediaIndex): void {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      indexDirectory(fullPath, root, index);
      continue;
    }
    indexFile(fullPath, root, index);
  }
}

function indexFile(fullPath: string, root: string, index: MediaIndex): void {
  const relative = normalizeLocalTarget(path.relative(root, fullPath));
  const fileName = path.posix.basename(relative);
  index.exactTargets.add(relative);
  index.fileNames.add(fileName);

  const trailingHash = extractTrailingHash(fileName);
  if (trailingHash) {
    index.hashes.add(trailingHash);
  }

  if (!fullPath.toLowerCase().endsWith(".md")) return;
  const content = readTextFile(fullPath);
  for (const reference of findMediaReferences(content)) {
    indexReferenceTarget(reference.target, index);
  }
}

function readTextFile(filePath: string): string {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function findMediaReferences(content: string): MediaReference[] {
  const references: MediaReference[] = [];
  const lines = content.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    collectPatternTargets(lines[index]!, MARKDOWN_IMAGE_PATTERN, lineNumber, references);
    collectPatternTargets(lines[index]!, OBSIDIAN_EMBED_PATTERN, lineNumber, references);
    collectMarkdownLinks(lines[index]!, lineNumber, references);
    collectHtmlTargets(lines[index]!, lineNumber, references);
  }

  return references;
}

function collectPatternTargets(
  line: string,
  pattern: RegExp,
  lineNumber: number,
  references: MediaReference[],
): void {
  for (const match of line.matchAll(pattern)) {
    const target = cleanReferenceTarget(match[1] ?? "");
    const kind = classifyMediaTarget(target);
    if (!kind) continue;
    references.push({ kind, target, line: lineNumber });
  }
}

function collectMarkdownLinks(line: string, lineNumber: number, references: MediaReference[]): void {
  for (const match of line.matchAll(MARKDOWN_LINK_PATTERN)) {
    if (match.index !== undefined && match.index > 0 && line[match.index - 1] === "!") continue;
    const target = cleanReferenceTarget(match[1] ?? "");
    const kind = classifyMediaTarget(target);
    if (!kind || kind === "image") continue;
    references.push({ kind, target, line: lineNumber });
  }
}

function collectHtmlTargets(line: string, lineNumber: number, references: MediaReference[]): void {
  for (const match of line.matchAll(HTML_MEDIA_PATTERN)) {
    const target = cleanReferenceTarget(match[2] ?? "");
    const kind = classifyMediaTarget(target);
    if (!kind) continue;
    references.push({ kind, target, line: lineNumber });
  }
}

function cleanReferenceTarget(raw: string): string {
  const trimmed = raw.trim();
  const withoutAlias = trimmed.split("|")[0]!.trim();
  const withoutTitle = withoutAlias.match(/^(.*?)(?:\s+["'][^"']*["'])?$/)?.[1] ?? withoutAlias;
  return withoutTitle.replace(/^<|>$/g, "").trim();
}

function classifyMediaTarget(target: string): MediaKind | null {
  const extension = path.posix.extname(stripQueryAndHash(target)).toLowerCase();
  if (!extension) return null;
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  if (ATTACHMENT_EXTENSIONS.has(extension)) return "attachment";
  return null;
}

function isTraceable(target: string, index: MediaIndex): boolean {
  if (/^https?:\/\//i.test(target)) {
    return index.remoteUrls.has(normalizeRemoteTarget(target));
  }

  const normalized = normalizeLocalTarget(stripQueryAndHash(target));
  const fileName = path.posix.basename(normalized);
  if (index.exactTargets.has(normalized) || index.fileNames.has(fileName)) {
    return true;
  }

  const trailingHash = extractTrailingHash(fileName);
  return Boolean(trailingHash && index.hashes.has(trailingHash));
}

function indexReferenceTarget(target: string, index: MediaIndex): void {
  if (/^https?:\/\//i.test(target)) {
    index.remoteUrls.add(normalizeRemoteTarget(target));
    return;
  }

  const normalized = normalizeLocalTarget(stripQueryAndHash(target));
  if (!normalized) return;
  index.exactTargets.add(normalized);
  const fileName = path.posix.basename(normalized);
  index.fileNames.add(fileName);
  const trailingHash = extractTrailingHash(fileName);
  if (trailingHash) {
    index.hashes.add(trailingHash);
  }
}

function normalizeLocalTarget(target: string): string {
  return target
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .toLowerCase();
}

function normalizeRemoteTarget(target: string): string {
  return stripQueryAndHash(target).trim().toLowerCase();
}

function stripQueryAndHash(target: string): string {
  return target.split("#")[0]!.split("?")[0]!.trim();
}

function extractTrailingHash(fileName: string): string | null {
  const match = fileName.match(/(?:__)?([a-f0-9]{8,32})(?:\.[^.]+)$/i);
  return match ? match[1]!.toLowerCase() : null;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
