/**
 * Shared OCR HTTP routes.
 *
 * Desktop and mobile callers should trigger source-image OCR through this route
 * instead of calling Cloudflare directly. The server owns Worker credentials,
 * sidecar persistence, and source-media index updates.
 */
import type { Request, Response } from "express";
import type { ServerConfig } from "../config.js";
import { runSourcePathImageOcr } from "../services/source-ocr.js";

export function handleSourceImageOcr(cfg: ServerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const data = await runSourcePathImageOcr({
        sourceVaultRoot: cfg.sourceVaultRoot,
        runtimeRoot: cfg.runtimeRoot,
        sourcePath: stringBody(req.body?.path) ?? "",
      });
      res.json({ success: true, data });
    } catch (error) {
      res.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  };
}

function stringBody(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
