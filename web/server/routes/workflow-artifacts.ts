/**
 * Workflow artifact API routes.
 *
 * These routes expose the distinction between long-term wiki folders and
 * runtime queues so the UI can show what has been created and what still needs
 * review.
 */
import type { Request, Response } from "express";
import type { ServerConfig } from "../config.js";
import { readWorkflowArtifactsSnapshot } from "../services/workflow-artifacts.js";

export function handleWorkflowArtifacts(cfg: ServerConfig) {
  return async (_req: Request, res: Response) => {
    try {
      res.json({ success: true, data: await readWorkflowArtifactsSnapshot(cfg) });
    } catch (error) {
      res.status(500).json({ success: false, error: errorMessage(error) });
    }
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
