/**
 * Workflow recorder API routes.
 *
 * The routes accept rough process notes, return the inferred filing result, and
 * allow pending records to be manually archived to a task.
 */
import type { Request, Response } from "express";
import type { ServerConfig } from "../config.js";
import {
  archiveWorkflowRecord,
  readWorkflowInbox,
  recordWorkflowInput,
} from "../services/workflow-recorder.js";

type WorkflowRecorderMarker = "normal" | "issue" | "resolved" | "method" | "end-node";

const WORKFLOW_RECORDER_MARKERS = new Set<WorkflowRecorderMarker>([
  "normal",
  "issue",
  "resolved",
  "method",
  "end-node",
]);

export function handleWorkflowRecorderInbox(cfg: ServerConfig) {
  return (_req: Request, res: Response) => {
    res.json({ success: true, data: { records: readWorkflowInbox(cfg.runtimeRoot) } });
  };
}

export function handleWorkflowRecorderRecord(cfg: ServerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const data = await recordWorkflowInput(cfg, normalizeRecordInput(req.body));
      res.json({ success: true, data });
    } catch (error) {
      res.status(400).json({ success: false, error: errorMessage(error) });
    }
  };
}

export function handleWorkflowRecorderArchive(cfg: ServerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const data = await archiveWorkflowRecord(cfg, normalizeArchiveInput(req.body));
      res.json({ success: true, data });
    } catch (error) {
      res.status(400).json({ success: false, error: errorMessage(error) });
    }
  };
}

function normalizeRecordInput(value: unknown): {
  text: string;
  taskId?: string;
  attachments: string[];
  marker: WorkflowRecorderMarker;
  source?: "execution_recorder" | "diary";
} {
  const record = isRecord(value) ? value : {};
  return {
    text: readString(record.text),
    taskId: readString(record.taskId) || undefined,
    attachments: Array.isArray(record.attachments) ? record.attachments.map(String).filter(Boolean) : [],
    marker: readMarker(record.marker),
    source: readSource(record.source),
  };
}

function normalizeArchiveInput(value: unknown): { recordId: string; taskId: string } {
  const record = isRecord(value) ? value : {};
  return {
    recordId: readString(record.recordId),
    taskId: readString(record.taskId),
  };
}

function readMarker(value: unknown): WorkflowRecorderMarker {
  return isWorkflowRecorderMarker(value) ? value : "normal";
}

function isWorkflowRecorderMarker(value: unknown): value is WorkflowRecorderMarker {
  return typeof value === "string" && WORKFLOW_RECORDER_MARKERS.has(value as WorkflowRecorderMarker);
}

function readSource(value: unknown): "execution_recorder" | "diary" | undefined {
  if (value === "execution_recorder" || value === "diary") return value;
  return undefined;
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
