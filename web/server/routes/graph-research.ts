/**
 * Graphy Deep Research routes.
 *
 * These endpoints are used only by the Graphy Insights panel: prepare an
 * editable research topic, then run web search + LLM synthesis and save a wiki
 * query page.
 */
import type { Request, Response } from "express";
import type { ServerConfig } from "../config.js";
import type { RunManager } from "../services/run-manager.js";
import {
  optimizeGraphResearchTopic,
  queueGraphResearch,
  runGraphResearch,
  type GraphResearchRunRequest,
  type GraphResearchSeed,
} from "../services/graph-research.js";

export function handleGraphResearchPrepare(cfg: ServerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const seed = readGraphResearchSeed(req.body);
      const data = await optimizeGraphResearchTopic(cfg, seed);
      res.json({ success: true, data });
    } catch (error) {
      res.status(400).json({ success: false, error: errorMessage(error) });
    }
  };
}

export function handleGraphResearchRun(cfg: ServerConfig, runManager: RunManager) {
  return async (req: Request, res: Response) => {
    try {
      const data = await runGraphResearch(cfg, readGraphResearchRunRequest(req.body));
      const ingest = startAutoIngest(cfg, runManager);
      res.json({ success: true, data: { ...data, ...ingest } });
    } catch (error) {
      res.status(400).json({ success: false, error: errorMessage(error) });
    }
  };
}

export function handleGraphResearchStream(cfg: ServerConfig, runManager: RunManager) {
  return async (req: Request, res: Response) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    try {
      const request = readGraphResearchRunRequest(req.body);
      const data = await queueGraphResearch(
        cfg,
        request,
        (progress) => writeSse(res, "status", progress),
        (token) => writeSse(res, "token", { token }),
      );
      const ingest = startAutoIngest(cfg, runManager);
      writeSse(res, "done", { ...data, ...ingest });
    } catch (error) {
      writeSse(res, "error", { error: errorMessage(error) });
    } finally {
      res.end();
    }
  };
}

function readGraphResearchRunRequest(body: unknown): GraphResearchRunRequest {
  const record = readRecord(body);
  return {
    topic: readRequiredString(record.topic, "topic"),
    queries: readStringArray(record.queries, "queries"),
    gap: readGraphResearchSeed(record.gap),
  };
}

function readGraphResearchSeed(body: unknown): GraphResearchSeed {
  const record = readRecord(body);
  return {
    title: readRequiredString(record.title, "title"),
    description: readRequiredString(record.description, "description"),
    type: readRequiredString(record.type, "type"),
  };
}

function startAutoIngest(
  cfg: ServerConfig,
  runManager: RunManager,
): { syncRunId: string | null; syncError?: string } {
  try {
    const run = runManager.start("sync", {
      sourceVaultRoot: cfg.sourceVaultRoot,
      runtimeRoot: cfg.runtimeRoot,
      projectRoot: cfg.projectRoot,
    });
    return { syncRunId: run.id };
  } catch (error) {
    return { syncRunId: null, syncError: errorMessage(error) };
  }
}

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid request body");
  }
  return value as Record<string, unknown>;
}

function readRequiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function readStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function writeSse(res: Response, event: string, payload: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}
