/**
 * Save route for editable source-backed markdown pages.
 *
 * Source-backed wiki files and workspace record pages are writable through the
 * same API. Runtime-generated pages such as wiki/index.md remain read-only.
 */

import fs from "node:fs";
import path from "node:path";
import type { Request, Response } from "express";
import type { ServerConfig } from "../config.js";
import { clearPageRenderCacheForPath } from "./pages.js";
import { resolveEditableSourceMarkdownPath } from "../runtime-paths.js";
import { clearTreeCache } from "./tree.js";

export function handlePageSave(cfg: ServerConfig) {
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

    const raw = typeof req.body?.raw === "string" ? req.body.raw : "";
    fs.mkdirSync(path.dirname(editablePath), { recursive: true });
    fs.writeFileSync(editablePath, raw.endsWith("\n") ? raw : `${raw}\n`, "utf-8");
    clearPageRenderCacheForPath(editablePath);

    res.json({
      success: true,
      data: {
        path: logicalPath,
        modifiedAt: fs.statSync(editablePath).mtime.toISOString(),
      },
    });
  };
}

export function handlePageDelete(cfg: ServerConfig) {
  return (req: Request, res: Response) => {
    const logicalPaths = normalizeDeletePaths(req.body);
    if (logicalPaths.length === 0) {
      res.status(400).json({ success: false, error: "invalid page path" });
      return;
    }

    const editablePaths = logicalPaths.map((logicalPath) => ({
      logicalPath,
      fullPath: resolveEditableSourceMarkdownPath(cfg, logicalPath),
    }));
    const blockedPath = editablePaths.find((item) => !item.fullPath)?.logicalPath;
    if (blockedPath) {
      res.status(400).json({ success: false, error: "page is not editable", path: blockedPath });
      return;
    }

    for (const item of editablePaths) {
      fs.unlinkSync(item.fullPath!);
      clearPageRenderCacheForPath(item.fullPath!);
    }
    clearTreeCache();

    res.json({
      success: true,
      data: {
        paths: editablePaths.map((item) => item.logicalPath),
      },
    });
  };
}

function normalizeDeletePaths(body: unknown): string[] {
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const rawPaths = Array.isArray(record.paths) ? record.paths : [record.path];
  const paths = rawPaths
    .map(normalizeLogicalPath)
    .filter((path): path is string => Boolean(path));
  return Array.from(new Set(paths));
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
