/**
 * Workspace relation routes.
 *
 * These endpoints edit the single relation table used by both sides of a
 * work-log backlink.
 */
import type { Request, Response } from "express";
import type { ServerConfig } from "../config.js";
import {
  createWorkspaceRelation,
  deleteWorkspaceRelation,
  listWorkspaceRelationState,
} from "../services/workspace-relations.js";

export function handleWorkspaceRelations(cfg: ServerConfig) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const nodeId = typeof req.query.nodeId === "string" ? req.query.nodeId : "";
      res.json({ success: true, data: await listWorkspaceRelationState(cfg, nodeId) });
    } catch (error) {
      sendWorkspaceRelationError(res, error);
    }
  };
}

export function handleWorkspaceRelationCreate(cfg: ServerConfig) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const relation = await createWorkspaceRelation(cfg, {
        sourceId: String(req.body?.sourceId ?? ""),
        targetId: String(req.body?.targetId ?? ""),
        type: String(req.body?.type ?? ""),
      });
      res.json({ success: true, data: relation });
    } catch (error) {
      sendWorkspaceRelationError(res, error);
    }
  };
}

export function handleWorkspaceRelationDelete(cfg: ServerConfig) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      await deleteWorkspaceRelation(cfg, String(req.params.id ?? ""));
      res.json({ success: true });
    } catch (error) {
      sendWorkspaceRelationError(res, error);
    }
  };
}

function sendWorkspaceRelationError(res: Response, error: unknown): void {
  res.status(400).json({
    success: false,
    error: error instanceof Error ? error.message : String(error),
  });
}
