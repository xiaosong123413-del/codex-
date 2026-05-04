/**
 * Intake scan summary service for sync confirmation.
 *
 * This service joins the built-in intake queues with the user-configured sync
 * source folders so the UI preview and the actual sync/compile run look at the
 * same filesystem roots.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { listMarkdownFilesRecursive } from "./markdown-file-listing.js";

type IntakeKind = "clipping" | "flash" | "source" | "inbox";

interface IntakeItem {
  id: string;
  kind: IntakeKind;
  channel: string;
  title: string;
  url: string;
  relativePath: string;
  sourcePath: string;
  cleanupAllowed: boolean;
  lastWriteTime: string;
}

interface IntakePlanRow {
  file: string;
  suggestedLocation: string;
  action: string;
  reason: string;
}

interface IntakeScanOptions {
  sourceRoots?: readonly string[];
}

interface IntakeRoot {
  kind: IntakeKind;
  channel: string;
  root: string;
  cleanupAllowed: boolean;
}

const RAW_DIR = "raw";
const CLIPPING_DIR = "\u526a\u85cf";
const FLASH_DIR = "\u95ea\u5ff5\u65e5\u8bb0";
const INBOX_DIR = "inbox";
const CLEANED_DIR = "_\u5df2\u6e05\u7406";
const COMPLETED_INBOX_DIR = "_\u5df2\u5f55\u5165";
const IMPORT_MANIFEST_JSON = "raw_import_manifest.json";

interface IntakeScanContext {
  now: Date;
  completedClippingRelativePaths: Set<string>;
  completedFlashRelativePaths: Set<string>;
  completedSourceKeys: Set<string>;
}

export function scanIntakeForReview(
  wikiRoot: string,
  runtimeRoot?: string,
  now = new Date(),
  options: IntakeScanOptions = {},
): IntakeItem[] {
  const context = createScanContext(runtimeRoot, now);
  const items = getRoots(wikiRoot, options.sourceRoots ?? []).flatMap((root) => scanRoot(root, context));
  return dedupeItems(items);
}

export function buildIntakePlan(
  wikiRoot: string,
  runtimeRoot?: string,
  now = new Date(),
  options: IntakeScanOptions = {},
): IntakePlanRow[] {
  return scanIntakeForReview(wikiRoot, runtimeRoot, now, options)
    .filter((item) => item.kind !== "inbox")
    .map((item) => ({
      file: item.relativePath,
      suggestedLocation: suggestLocation(item),
      action: suggestAction(wikiRoot, item),
      reason: suggestReason(item),
    }));
}

function getRoots(wikiRoot: string, sourceRoots: readonly string[]): IntakeRoot[] {
  const defaultRoots: IntakeRoot[] = [
    {
      kind: "clipping",
      channel: CLIPPING_DIR,
      cleanupAllowed: true,
      root: path.join(wikiRoot, RAW_DIR, CLIPPING_DIR),
    },
    {
      kind: "flash",
      channel: FLASH_DIR,
      cleanupAllowed: false,
      root: path.join(wikiRoot, RAW_DIR, FLASH_DIR),
    },
    {
      kind: "inbox" as const,
      channel: INBOX_DIR,
      cleanupAllowed: false,
      root: path.join(wikiRoot, INBOX_DIR),
    },
  ];
  return dedupeRoots([...defaultRoots, ...sourceRoots.map(createConfiguredSourceRoot)]);
}

function createScanContext(runtimeRoot: string | undefined, now: Date): IntakeScanContext {
  const completedRawRelativePaths = readCompletedRawRelativePaths(runtimeRoot);
  return {
    now,
    completedClippingRelativePaths: completedRawRelativePaths.clipping,
    completedFlashRelativePaths: completedRawRelativePaths.flash,
    completedSourceKeys: completedRawRelativePaths.source,
  };
}

function scanRoot(root: IntakeRoot, context: IntakeScanContext): IntakeItem[] {
  if (!fs.existsSync(root.root)) return [];
  return listMarkdownFilesRecursive(root.root, {
    relative: true,
    excludeDirs: [CLEANED_DIR, COMPLETED_INBOX_DIR],
  }).filter((relativePath) => {
    const normalized = toSlash(relativePath);
    if (root.kind === "clipping") {
      return !context.completedClippingRelativePaths.has(normalized);
    }
    if (root.kind === "source") {
      return !context.completedSourceKeys.has(buildSourceCompletionKey(root.root, normalized));
    }
    if (root.kind !== "flash") return true;
    return shouldIncludeFlashDiary(relativePath, context);
  }).map((relativePath) => {
    const sourcePath = path.join(root.root, relativePath);
    const content = fs.readFileSync(sourcePath, "utf8");
    const fileStat = fs.statSync(sourcePath);
    return {
      id: createHash("sha1").update(`${root.kind}:${sourcePath}:${fileStat.mtimeMs}`).digest("hex").slice(0, 16),
      kind: root.kind,
      channel: root.channel,
      title: extractTitle(content, relativePath),
      url: extractUrl(content),
      relativePath: toSlash(path.join(root.channel, relativePath)),
      sourcePath: toSlash(sourcePath),
      cleanupAllowed: root.cleanupAllowed,
      lastWriteTime: fileStat.mtime.toISOString(),
    };
  });
}

function createConfiguredSourceRoot(rootPath: string): IntakeRoot {
  return {
    kind: "source",
    channel: readSourceChannel(rootPath),
    cleanupAllowed: false,
    root: rootPath,
  };
}

function dedupeRoots(roots: IntakeRoot[]): IntakeRoot[] {
  const seen = new Set<string>();
  return roots.filter((root) => {
    const key = canonicalPath(root.root);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeItems(items: IntakeItem[]): IntakeItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = canonicalPath(item.sourcePath);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function shouldIncludeFlashDiary(relativePath: string, context: IntakeScanContext): boolean {
  const normalized = toSlash(relativePath);
  const match = /^(\d{4}-\d{2}-\d{2})\.md$/u.exec(normalized);
  if (!match) return false;
  if (context.completedFlashRelativePaths.has(normalized)) return false;

  // Flash diary sync is intentionally narrow: during the morning, only
  // yesterday's diary is considered new source material.
  const now = context.now;
  if (now.getHours() >= 12) return false;

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  return match[1] === formatLocalDate(yesterday);
}

// fallow-ignore-next-line complexity
function readCompletedRawRelativePaths(runtimeRoot?: string): {
  clipping: Set<string>;
  flash: Set<string>;
  source: Set<string>;
} {
  if (!runtimeRoot) {
    return {
      clipping: new Set<string>(),
      flash: new Set<string>(),
      source: new Set<string>(),
    };
  }

  const completedFiles = readCompletedFiles(runtimeRoot);
  if (completedFiles.size === 0) {
    return {
      clipping: new Set<string>(),
      flash: new Set<string>(),
      source: new Set<string>(),
    };
  }

  const manifestPath = path.join(runtimeRoot, IMPORT_MANIFEST_JSON);
  if (!fs.existsSync(manifestPath)) {
    return {
      clipping: new Set<string>(),
      flash: new Set<string>(),
      source: new Set<string>(),
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      imports?: Array<{
        imported_filename?: string;
        source_kind?: string;
        source_root?: string;
        source_relative_path?: string;
      }>;
    };
    const completedRawRelativePaths = {
      clipping: new Set<string>(),
      flash: new Set<string>(),
      source: new Set<string>(),
    };
    for (const item of parsed.imports ?? []) {
      if (typeof item.imported_filename !== "string" || !completedFiles.has(toSlash(item.imported_filename))) continue;
      if (typeof item.source_relative_path !== "string") continue;
      if (item?.source_kind === "clipping") {
        completedRawRelativePaths.clipping.add(toSlash(item.source_relative_path));
        continue;
      }
      if (item?.source_kind === "flash") {
        completedRawRelativePaths.flash.add(toSlash(item.source_relative_path));
        continue;
      }
      if (typeof item.source_root === "string") {
        completedRawRelativePaths.source.add(buildSourceCompletionKey(item.source_root, item.source_relative_path));
      }
    }
    return completedRawRelativePaths;
  } catch {
    return {
      clipping: new Set<string>(),
      flash: new Set<string>(),
      source: new Set<string>(),
    };
  }
}

function readCompletedFiles(runtimeRoot: string): Set<string> {
  const candidates = [
    path.join(runtimeRoot, ".llmwiki-batch-state.json"),
    path.join(runtimeRoot, ".llmwiki", "batch-state.json"),
  ];
  const completed = new Set<string>();
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { completed_files?: string[] };
      for (const item of parsed.completed_files ?? []) {
        completed.add(toSlash(item));
      }
    } catch {
      // Ignore corrupt batch-state files so intake scan can still render.
    }
  }
  return completed;
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function suggestLocation(item: IntakeItem): string {
  if (item.kind === "flash") return "Knowledge/\u95ea\u5ff5\u65e5\u8bb0/";
  if (item.kind === "source") return `\u6309\u6765\u6e90\u5f52\u6863/${item.channel}/`;
  return item.url ? "Knowledge/\u526a\u85cf/" : "Knowledge/";
}

function suggestAction(wikiRoot: string, item: IntakeItem): string {
  const slug = path.basename(item.relativePath, path.extname(item.relativePath)).toLowerCase();
  const wikiDir = path.join(wikiRoot, "wiki");
  if (fs.existsSync(path.join(wikiDir, "concepts", `${slug}.md`))) {
    return "\u5408\u5e76\u5230\u5df2\u6709\u6587\u4ef6";
  }
  return "\u65b0\u5efa";
}

function suggestReason(item: IntakeItem): string {
  if (item.kind === "flash") return "\u95ea\u5ff5\u65e5\u8bb0\u4e0d\u6e05\u7406\uff0c\u4fdd\u7559\u539f\u59cb\u601d\u8003\u8109\u7edc";
  if (item.kind === "source") return "\u6765\u81ea\u5df2\u914d\u7f6e\u540c\u6b65\u6587\u4ef6\u5939\uff0c\u70b9\u51fb\u540c\u6b65\u65f6\u81ea\u52a8\u7eb3\u5165\u6279\u91cf\u7f16\u8bd1";
  if (item.url) return "\u526a\u85cf\u542b\u53ef\u56de\u6eaf\u94fe\u63a5\uff0c\u7f16\u8bd1\u540e\u539f\u6587\u79fb\u5230 _\u5df2\u6e05\u7406";
  return "\u526a\u85cf\u672a\u68c0\u51fa\u94fe\u63a5\uff0c\u5148\u4fdd\u7559\u6765\u6e90\u8def\u5f84";
}

function extractTitle(content: string, relativePath: string): string {
  const heading = content.match(/^#\s+(.+)$/m)?.[1];
  return (heading ?? path.basename(relativePath, path.extname(relativePath))).trim();
}

function extractUrl(content: string): string {
  return content.match(/https?:\/\/[^\s)>\]]+/)?.[0] ?? "";
}

function buildSourceCompletionKey(sourceRoot: string, relativePath: string): string {
  return `${canonicalPath(sourceRoot)}::${toSlash(relativePath)}`;
}

function canonicalPath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function readSourceChannel(rootPath: string): string {
  return path.basename(path.resolve(rootPath)) || "\u540c\u6b65\u6e90";
}

function toSlash(value: string): string {
  return value.replace(/\\/g, "/");
}
