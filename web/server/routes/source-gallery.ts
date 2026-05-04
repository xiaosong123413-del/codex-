import type { Request, Response } from "express";
import type { ServerConfig } from "../config.js";
import type { RunManager } from "../services/run-manager.js";
import {
  appendLocalClippingMedia,
  readLocalMediaPaths,
} from "../services/clipping-local-media.js";
import {
  createSourceGalleryCompileInput,
  createSourceGalleryEntry,
  deleteSourceGalleryItems,
  getSourceGalleryDetail,
  listSourceGalleryItems,
  moveSourceGalleryItemsToInbox,
  queueSourceGalleryBatchIngest,
  resolveSourceGalleryMediaPath,
  runSourceGalleryOcr,
  runSourceGalleryTranscription,
  saveSourceGalleryDetail,
  type SourceGalleryLayer,
  type SourceGallerySort,
} from "../services/source-gallery.js";

const ALLOWED_SORTS: SourceGallerySort[] = ["modified-desc", "modified-asc", "created-desc", "created-asc"];

function parseSort(value: unknown): SourceGallerySort {
  return typeof value === "string" && (ALLOWED_SORTS as string[]).includes(value)
    ? (value as SourceGallerySort)
    : "modified-desc";
}

export function handleSourceGalleryList(cfg: ServerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const data = await listSourceGalleryItems(
        cfg.sourceVaultRoot,
        cfg.runtimeRoot,
        stringValue(req.query.query),
        parseSort(req.query.sort),
        {
          buckets: csvValue(req.query.buckets),
          tags: csvValue(req.query.tags),
          layers: parseLayers(req.query.layers),
        },
      );
      res.json({ success: true, data });
    } catch (error) {
      sendError(res, error, 500);
    }
  };
}

export function handleSourceGalleryDetail(cfg: ServerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const data = await getSourceGalleryDetail(cfg.sourceVaultRoot, cfg.runtimeRoot, req.params.id ?? "");
      res.json({ success: true, data });
    } catch (error) {
      sendError(res, error, 404);
    }
  };
}

export function handleSourceGalleryMedia(cfg: ServerConfig) {
  return (req: Request, res: Response) => {
    try {
      const full = resolveSourceGalleryMediaPath(cfg.sourceVaultRoot, cfg.runtimeRoot, stringValue(req.query.path) ?? "");
      res.sendFile(full);
    } catch (error) {
      sendError(res, error, 404);
    }
  };
}

export function handleSourceGalleryCreate(cfg: ServerConfig) {
  // fallow-ignore-next-line complexity
  return async (req: Request, res: Response) => {
    try {
      const data = await createSourceGalleryEntry(cfg.sourceVaultRoot, {
        type: req.body?.type === "flash-diary" ? "flash-diary" : "clipping",
        title: stringBody(req.body?.title),
        body: stringBody(req.body?.body),
        url: stringBody(req.body?.url),
        now: stringBody(req.body?.now),
      });
      if (req.body?.type !== "flash-diary") {
        await appendLocalClippingMedia(
          cfg.sourceVaultRoot,
          cfg.runtimeRoot,
          data.path,
          readLocalMediaPaths(req.body?.mediaPaths),
        );
      }
      res.json({ success: true, data });
    } catch (error) {
      sendError(res, error);
    }
  };
}

export function handleSourceGallerySave(cfg: ServerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const data = await saveSourceGalleryDetail(cfg.sourceVaultRoot, cfg.runtimeRoot, req.params.id ?? "", stringBody(req.body?.raw) ?? "");
      res.json({ success: true, data });
    } catch (error) {
      sendError(res, error);
    }
  };
}

export function handleSourceGalleryMoveToInbox(cfg: ServerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const data = await moveSourceGalleryItemsToInbox(cfg.sourceVaultRoot, cfg.runtimeRoot, arrayBody(req.body?.ids));
      res.json({ success: true, data });
    } catch (error) {
      sendError(res, error);
    }
  };
}

export function handleSourceGalleryDelete(cfg: ServerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const data = await deleteSourceGalleryItems(cfg.sourceVaultRoot, cfg.runtimeRoot, arrayBody(req.body?.ids));
      res.json({ success: true, data });
    } catch (error) {
      sendError(res, error);
    }
  };
}

export function handleSourceGalleryIngestQueue(cfg: ServerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const data = await queueSourceGalleryBatchIngest(cfg.sourceVaultRoot, cfg.runtimeRoot, arrayBody(req.body?.ids));
      res.json({ success: true, data });
    } catch (error) {
      sendError(res, error);
    }
  };
}

export function handleSourceGalleryOcr(cfg: ServerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const data = await runSourceGalleryOcr(cfg.sourceVaultRoot, cfg.runtimeRoot, req.params.id ?? "");
      res.json({ success: true, data });
    } catch (error) {
      sendError(res, error);
    }
  };
}

export function handleSourceGalleryTranscribe(cfg: ServerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const data = await runSourceGalleryTranscription(cfg.sourceVaultRoot, cfg.runtimeRoot, req.params.id ?? "");
      res.json({ success: true, data });
    } catch (error) {
      sendError(res, error);
    }
  };
}

export function handleSourceGalleryCompile(cfg: ServerConfig, manager: RunManager) {
  return async (req: Request, res: Response) => {
    try {
      const conversationId = stringBody(req.body?.conversationId);
      if (!conversationId) {
        throw new Error("conversationId is required");
      }
      const data = await createSourceGalleryCompileInput(
        cfg.sourceVaultRoot,
        cfg.runtimeRoot,
        req.params.id ?? "",
        conversationId,
        parseOptionalDate(req.body?.now),
      );
      const run = manager.start("sync", {
        sourceVaultRoot: cfg.sourceVaultRoot,
        runtimeRoot: cfg.runtimeRoot,
        projectRoot: cfg.projectRoot,
      });
      res.status(202).json({ success: true, data: { ...data, started: true, runId: run.id } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendError(res, error, message.includes("already active") ? 409 : 400);
    }
  };
}

function sendError(res: Response, error: unknown, status = 400): void {
  res.status(status).json({ success: false, error: error instanceof Error ? error.message : String(error) });
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringBody(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function arrayBody(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function csvValue(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function parseLayers(value: unknown): SourceGalleryLayer[] {
  return csvValue(value).filter((item): item is SourceGalleryLayer => item === "raw" || item === "source");
}

function parseOptionalDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
