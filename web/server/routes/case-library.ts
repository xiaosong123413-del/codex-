/**
 * Case-library API routes.
 *
 * These handlers expose source refresh and status actions while keeping all
 * Markdown mutation in the case-library service.
 */
import type { Request, Response } from "express";
import type { ServerConfig } from "../config.js";
import { mutateCaseLibraryCase, refreshCaseLibrarySource } from "../services/case-library.js";

export function handleCaseLibrarySourceRefresh(cfg: ServerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const data = await refreshCaseLibrarySource(cfg, normalizeRefreshInput(req.body));
      res.json({ success: true, data });
    } catch (error) {
      res.status(400).json({ success: false, error: errorMessage(error) });
    }
  };
}

export function handleCaseLibraryCaseAction(cfg: ServerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const data = await mutateCaseLibraryCase(cfg, normalizeCaseAction(req.body));
      res.status(data.status === "not-found" ? 404 : 200).json({ success: data.status === "written", data });
    } catch (error) {
      res.status(400).json({ success: false, error: errorMessage(error) });
    }
  };
}

function normalizeRefreshInput(value: unknown): { label: string; entries: string[] } {
  const record = isRecord(value) ? value : {};
  return {
    label: readString(record.label),
    entries: Array.isArray(record.entries) ? record.entries.map(String).map((item) => item.trim()).filter(Boolean) : [],
  };
}

function normalizeCaseAction(value: unknown): {
  action: "confirm" | "delete" | "mark-distilled" | "mark-rule" | "mark-ability";
  casePath: string;
} {
  const record = isRecord(value) ? value : {};
  return {
    action: readCaseAction(record.action),
    casePath: readString(record.casePath),
  };
}

// fallow-ignore-next-line complexity
function readCaseAction(value: unknown): "confirm" | "delete" | "mark-distilled" | "mark-rule" | "mark-ability" {
  if (value === "delete" || value === "mark-distilled" || value === "mark-rule" || value === "mark-ability") return value;
  return "confirm";
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
