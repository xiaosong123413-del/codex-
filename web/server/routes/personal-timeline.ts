/**
 * Personal timeline API routes.
 *
 * The refresh endpoint checks configured source entries by content digest and
 * records failures so the review page can surface broken source bindings.
 */
import type { Request, Response } from "express";
import type { ServerConfig } from "../config.js";
import { mutatePendingTimelineFact } from "../services/personal-timeline-pending-facts.js";
import {
  recordPersonalTimelineSourceFailure,
  refreshPersonalTimelineSource,
} from "../services/personal-timeline-source-refresh.js";

export function handlePersonalTimelineSourceRefresh(cfg: ServerConfig) {
  return async (req: Request, res: Response) => {
    const input = normalizeRefreshInput(req.body);
    try {
      const data = await refreshPersonalTimelineSource(cfg, input);
      res.json({ success: true, data });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await recordPersonalTimelineSourceFailure(cfg.runtimeRoot, {
        label: input.label,
        entries: input.entries,
        error: message,
        createdAt: new Date().toISOString(),
      });
      res.status(400).json({ success: false, error: message });
    }
  };
}

export function handlePendingTimelineFactMutation(cfg: ServerConfig) {
  return async (req: Request, res: Response) => {
    const input = normalizePendingFactInput(req.body);
    const data = await mutatePendingTimelineFact(cfg, input);
    const status = data.status === "not-found" ? 404 : 200;
    res.status(status).json({ success: data.status === "written", data });
  };
}

function normalizeRefreshInput(value: unknown): { label: string; entries: string[] } {
  if (!value || typeof value !== "object") return { label: "", entries: [] };
  const record = value as { label?: unknown; entries?: unknown };
  return {
    label: stringValue(record.label),
    entries: stringListValue(record.entries),
  };
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringListValue(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((entry) => entry.trim()).filter(Boolean) : [];
}

function normalizePendingFactInput(value: unknown): {
  action: "confirm" | "delete" | "supplement";
  sourceTarget: string;
  note?: string;
} {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    action: pendingActionValue(record.action),
    sourceTarget: stringValue(record.sourceTarget),
    note: stringValue(record.note),
  };
}

function pendingActionValue(value: unknown): "confirm" | "delete" | "supplement" {
  return value === "confirm" || value === "delete" || value === "supplement" ? value : "delete";
}
