/**
 * Workspace Graphy route.
 *
 * The work-log page uses this endpoint instead of the compiled wiki graph so
 * it can show task, project, case, method, and toolbox backlinks directly.
 */
import type { Request, Response } from "express";
import type { ServerConfig } from "../config.js";
import { buildWorkspaceGraphForNode } from "../services/workspace-graph.js";

export function handleWorkspaceGraph(cfg: ServerConfig) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const nodeId = typeof req.query.nodeId === "string" ? req.query.nodeId : "";
      const data = await buildWorkspaceGraphForNode(cfg, nodeId);
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
