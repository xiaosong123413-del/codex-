/**
 * Intake helpers for the local raw layer. The first-stage workflow treats
 * raw/clippings, raw/flash diary, and inbox as first-class source queues while
 * keeping cleanup conservative: clipping originals are moved to _cleaned only
 * after their synchronized copy has compiled.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, stat } from "node:fs/promises";
import path from "node:path";
import { listMarkdownFilesRecursive } from "./file-listing.mjs";

export const RAW_DIR_NAME = "raw";
export const CLIPPING_DIR_NAME = "\u526a\u85cf";
export const FLASH_DIR_NAME = "\u95ea\u5ff5\u65e5\u8bb0";
export const INBOX_DIR_NAME = "inbox";
export const CLEANED_DIR_NAME = "_\u5df2\u6e05\u7406";
export const COMPLETED_INBOX_DIR_NAME = "_\u5df2\u5f55\u5165";
export const IMPORT_MANIFEST_JSON = "raw_import_manifest.json";

const EXCLUDED_DIRS = new Set([".obsidian", ".trash", ".git", CLEANED_DIR_NAME, COMPLETED_INBOX_DIR_NAME]);

export function getIntakeRoots(vaultRoot) {
  return [
    {
      kind: "clipping",
      channel: CLIPPING_DIR_NAME,
      cleanupAllowed: true,
      root: path.join(vaultRoot, RAW_DIR_NAME, CLIPPING_DIR_NAME),
    },
    {
      kind: "flash",
      channel: FLASH_DIR_NAME,
      cleanupAllowed: false,
      root: path.join(vaultRoot, RAW_DIR_NAME, FLASH_DIR_NAME),
    },
    {
      kind: "inbox",
      channel: INBOX_DIR_NAME,
      cleanupAllowed: false,
      root: path.join(vaultRoot, INBOX_DIR_NAME),
    },
  ];
}

export async function ensureIntakeFolders(vaultRoot) {
  await Promise.all(getIntakeRoots(vaultRoot).map((root) => mkdir(root.root, { recursive: true })));
}

export async function scanIntakeItems(vaultRoot) {
  await ensureIntakeFolders(vaultRoot);
  const items = [];
  for (const root of getIntakeRoots(vaultRoot)) {
    const files = await listMarkdownFilesRecursive(root.root, {
      excludeDirs: EXCLUDED_DIRS,
      ignoreMissing: true,
    });
    for (const relativePath of files) {
      items.push(await buildIntakeItem(root, relativePath));
    }
  }
  return items;
}

export function resolveSourceMetadata(sourceRoot, relativePath, sourcePath, content) {
  const intakeRoot = getMatchedIntakeRoot(sourceRoot, sourcePath);
  const title = extractTitle(content, relativePath);
  return {
    source_kind: intakeRoot?.kind ?? "source",
    source_channel: intakeRoot?.channel ?? readSourceChannel(sourceRoot),
    source_title: title,
    source_url: extractUrl(content),
    source_path: toSlash(sourcePath),
    source_relative_path: toSlash(relativePath),
    cleanup_allowed: Boolean(intakeRoot?.cleanupAllowed),
  };
}

export function addSourceHeader(content, metadata) {
  const parts = [
    `\u6e20\u9053\uff1a${metadata.source_channel}`,
    `\u540d\u79f0\uff1a${metadata.source_title}`,
    metadata.source_url ? `\u94fe\u63a5\uff1a${metadata.source_url}` : "",
    `\u8def\u5f84\uff1a${metadata.source_path}`,
  ].filter(Boolean);
  const header = `> \u539f\u6599\u6765\u6e90\uff1a${parts.join(" | ")}\n\n`;
  if (!content.startsWith("---")) return `${header}${content}`;
  const end = content.indexOf("\n---", 3);
  if (end < 0) return `${header}${content}`;
  const frontmatterEnd = end + "\n---".length;
  return `${content.slice(0, frontmatterEnd)}\n\n${header}${content.slice(frontmatterEnd).replace(/^\r?\n/, "")}`;
}

export async function archiveCompiledClippingsFromManifest(vaultRoot, compiledFiles) {
  const manifest = await readImportManifest(vaultRoot);
  const compiled = new Set(compiledFiles);
  let moved = 0;
  for (const item of manifest.imports ?? []) {
    if (!compiled.has(item.imported_filename) || item.source_kind !== "clipping") continue;
    if (await moveToCleaned(item.source_path, vaultRoot)) moved += 1;
  }
  return moved;
}

async function buildIntakeItem(root, relativePath) {
  const sourcePath = path.join(root.root, relativePath);
  const content = await readFile(sourcePath, "utf8");
  const fileStat = await stat(sourcePath);
  const hash = createHash("sha1").update(content).digest("hex");
  return {
    id: createHash("sha1").update(`${root.kind}:${relativePath}:${hash}`).digest("hex").slice(0, 16),
    kind: root.kind,
    channel: root.channel,
    cleanupAllowed: root.cleanupAllowed,
    title: extractTitle(content, relativePath),
    url: extractUrl(content),
    sourcePath: toSlash(sourcePath),
    relativePath: toSlash(relativePath),
    size: fileStat.size,
    lastWriteTime: fileStat.mtime.toISOString(),
  };
}

function getMatchedIntakeRoot(sourceRoot, sourcePath) {
  const resolvedSource = path.resolve(sourcePath);
  return getIntakeRoots(findVaultRoot(sourceRoot)).find((root) => isInside(resolvedSource, root.root));
}

function findVaultRoot(sourceRoot) {
  const parts = path.resolve(sourceRoot).split(path.sep);
  const rawIndex = parts.lastIndexOf(RAW_DIR_NAME);
  if (rawIndex > 0) return parts.slice(0, rawIndex).join(path.sep);
  const inboxIndex = parts.lastIndexOf(INBOX_DIR_NAME);
  if (inboxIndex > 0) return parts.slice(0, inboxIndex).join(path.sep);
  return path.dirname(path.resolve(sourceRoot));
}

function isInside(childPath, parentPath) {
  const relative = path.relative(path.resolve(parentPath), childPath);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function extractTitle(content, relativePath) {
  const frontmatterTitle = content.match(/^---[\s\S]*?\ntitle:\s*["']?(.+?)["']?\s*\n[\s\S]*?---/i)?.[1];
  const heading = content.match(/^#\s+(.+)$/m)?.[1];
  return cleanTitle(frontmatterTitle ?? heading ?? path.basename(relativePath, path.extname(relativePath)));
}

function extractUrl(content) {
  const frontmatterUrl = content.match(/^---[\s\S]*?\n(?:url|source|link):\s*["']?(.+?)["']?\s*\n[\s\S]*?---/i)?.[1];
  return (frontmatterUrl ?? content.match(/https?:\/\/[^\s)>\]]+/)?.[0] ?? "").trim();
}

function cleanTitle(value) {
  return String(value).replace(/^["']|["']$/g, "").trim();
}

function readSourceChannel(sourceRoot) {
  return path.basename(path.resolve(sourceRoot)) || "\u540c\u6b65\u6e90";
}

async function readImportManifest(vaultRoot) {
  const manifestPath = path.join(vaultRoot, IMPORT_MANIFEST_JSON);
  if (!existsSync(manifestPath)) return { imports: [] };
  return JSON.parse(await readFile(manifestPath, "utf8"));
}

async function moveToCleaned(sourcePath, vaultRoot) {
  if (!existsSync(sourcePath)) return false;
  const sourceRoot = path.join(vaultRoot, RAW_DIR_NAME, CLIPPING_DIR_NAME);
  const relative = path.relative(sourceRoot, sourcePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return false;
  const target = path.join(sourceRoot, CLEANED_DIR_NAME, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await rename(sourcePath, target);
  return true;
}

function toSlash(value) {
  return value.replace(/\\/g, "/");
}
