import type { Request, Response } from "express";
import type { ServerConfig } from "../config.js";
import {
  appendLocalClippingMedia,
  readLocalMediaPaths,
} from "../services/clipping-local-media.js";
import { readXiaohongshuImportConfig } from "../services/xiaohongshu-import.js";
import {
  deleteXhsSyncFailures,
  getXhsSyncStatus,
  runXhsBatch,
  runXhsFavoritesSync,
  runXhsSingle,
  type XhsRunOptions,
} from "../services/xhs-sync.js";

interface XhsRouteOptions extends XhsRunOptions {}

export function handleXhsStatus(cfg: ServerConfig) {
  return (_req: Request, res: Response) => {
    res.json({ success: true, data: getXhsSyncStatus(cfg.sourceVaultRoot) });
  };
}

export function handleXhsExtract(cfg: ServerConfig, options: XhsRouteOptions = {}) {
  // fallow-ignore-next-line complexity
  return async (req: Request, res: Response) => {
    try {
      const outputRoot = resolveXhsOutputRoot(cfg.projectRoot);
      const data = await runXhsSingle(cfg.sourceVaultRoot, {
        url: stringBody(req.body?.url) ?? "",
        body: stringBody(req.body?.body),
        now: parseDate(req.body?.now),
      }, { ...options, outputRoot, projectRoot: cfg.projectRoot, runtimeRoot: cfg.runtimeRoot });
      if (data.status !== "failed" && data.path) {
        await appendLocalClippingMedia(
          cfg.sourceVaultRoot,
          cfg.runtimeRoot,
          data.path,
          readLocalMediaPaths(req.body?.mediaPaths),
        );
      }
      res.status(data.status === "failed" ? 400 : 200).json({ success: data.status !== "failed", data, error: data.error });
    } catch (error) {
      sendError(res, error);
    }
  };
}

export function handleXhsBatch(cfg: ServerConfig, options: XhsRouteOptions = {}) {
  return async (req: Request, res: Response) => {
    try {
      const outputRoot = resolveXhsOutputRoot(cfg.projectRoot);
      const data = await runXhsBatch(cfg.sourceVaultRoot, {
        urls: readUrlList(req.body?.urls ?? req.body?.text),
        now: parseDate(req.body?.now),
      }, { ...options, outputRoot, projectRoot: cfg.projectRoot, runtimeRoot: cfg.runtimeRoot });
      res.status(data.status === "failed" ? 400 : 200).json({ success: data.status !== "failed", data });
    } catch (error) {
      sendError(res, error);
    }
  };
}

export function handleXhsFavoritesSync(cfg: ServerConfig, options: XhsRouteOptions = {}) {
  return async (req: Request, res: Response) => {
    try {
      const outputRoot = resolveXhsOutputRoot(cfg.projectRoot);
      const data = await runXhsFavoritesSync(cfg.sourceVaultRoot, {
        now: parseDate(req.body?.now),
      }, { ...options, outputRoot, projectRoot: cfg.projectRoot, runtimeRoot: cfg.runtimeRoot });
      res.status(data.status === "failed" ? 400 : 200).json({ success: data.status !== "failed", data });
    } catch (error) {
      sendError(res, error);
    }
  };
}

export function handleXhsFailureDelete(cfg: ServerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const data = await deleteXhsSyncFailures(cfg.sourceVaultRoot, readIdList(req.body?.ids));
      res.json({ success: true, data });
    } catch (error) {
      sendError(res, error);
    }
  };
}

function readUrlList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string") return [];
  return value.split(/[\s,，]+/).map((item) => item.trim()).filter(Boolean);
}

function readIdList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean)
    : [];
}

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function sendError(res: Response, error: unknown): void {
  res.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
}

function stringBody(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function resolveXhsOutputRoot(projectRoot: string): string | undefined {
  const config = readXiaohongshuImportConfig(projectRoot);
  return config.importDirPath || undefined;
}
