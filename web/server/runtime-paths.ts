import fs from "node:fs";
import path from "node:path";
import type { ServerConfig } from "./config.js";

const RUNTIME_WIKI_TARGETS = new Map<string, string>([
  ["wiki", "wiki/index.md"],
  ["index", "wiki/index.md"],
  ["index.md", "wiki/index.md"],
  ["wiki/index", "wiki/index.md"],
  ["wiki/index.md", "wiki/index.md"],
  ["moc", "wiki/MOC.md"],
  ["moc.md", "wiki/MOC.md"],
  ["wiki/moc", "wiki/MOC.md"],
  ["wiki/moc.md", "wiki/MOC.md"],
]);

export function sourcePath(cfg: ServerConfig, ...parts: string[]): string {
  return path.join(cfg.sourceVaultRoot, ...parts);
}

export function runtimePath(cfg: ServerConfig, ...parts: string[]): string {
  return path.join(cfg.runtimeRoot, ...parts);
}

export function resolveContentPath(cfg: ServerConfig, logicalPath: string): string {
  const normalized = normalizeLogicalPath(logicalPath);
  const runtimeWikiPath = resolveRuntimeWikiLogicalPath(normalized);
  if (runtimeWikiPath) {
    const sourceCandidate = sourcePath(cfg, runtimeWikiPath);
    if (pathExists(sourceCandidate)) {
      return sourceCandidate;
    }
    return runtimePath(cfg, runtimeWikiPath);
  }

  if (
    normalized === "sources"
    || normalized.startsWith("sources/")
    || normalized === "sources_full"
    || normalized.startsWith("sources_full/")
  ) {
    return runtimePath(cfg, normalized);
  }

  if (normalized === "wiki" || normalized.startsWith("wiki/")) {
    const sourceCandidate = sourcePath(cfg, normalized);
    if (pathExists(sourceCandidate)) {
      return sourceCandidate;
    }
    const runtimeCandidate = runtimePath(cfg, normalized);
    if (pathExists(runtimeCandidate)) {
      return runtimeCandidate;
    }
    return sourceCandidate;
  }

  return sourcePath(cfg, normalized);
}

export function resolveRuntimeWikiLogicalPath(target: string): string | null {
  return RUNTIME_WIKI_TARGETS.get(normalizeLogicalPath(target).toLowerCase()) ?? null;
}

export function resolveEditableSourceMarkdownPath(cfg: ServerConfig, logicalPath: string): string | null {
  const normalized = normalizeEditableLogicalPath(logicalPath);
  if (!normalized) {
    return null;
  }
  if (!isEditableSourceMarkdownNamespace(normalized)) {
    return null;
  }
  if (resolveRuntimeWikiLogicalPath(normalized)) {
    return null;
  }
  const sourceCandidate = sourcePath(cfg, normalized);
  if (!pathExists(sourceCandidate)) {
    return null;
  }
  try {
    return fs.statSync(sourceCandidate).isFile() ? sourceCandidate : null;
  } catch {
    return null;
  }
}

function isEditableSourceMarkdownNamespace(logicalPath: string): boolean {
  return logicalPath === "领域.md"
    || logicalPath.startsWith("领域/")
    || logicalPath === "wiki"
    || logicalPath.startsWith("wiki/");
}

function normalizeEditableLogicalPath(value: string): string | null {
  const slashNormalized = value.replace(/\\/g, "/");
  if (path.posix.isAbsolute(slashNormalized)) {
    return null;
  }
  const normalized = path.posix.normalize(slashNormalized).replace(/\/+$/g, "");
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    return null;
  }
  return normalized;
}

export function toLogicalPath(cfg: ServerConfig, absolutePath: string): string | null {
  for (const root of [cfg.sourceVaultRoot, cfg.runtimeRoot]) {
    const relativePath = path.relative(root, absolutePath);
    if (!relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
      return relativePath.split(path.sep).join("/");
    }
  }
  return null;
}

function normalizeLogicalPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
}

function pathExists(targetPath: string): boolean {
  try {
    return fs.existsSync(targetPath);
  } catch {
    return false;
  }
}
