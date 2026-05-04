/**
 * Routes for the editable personal identity dashboard.
 *
 * The dashboard layout is stored beside the identity Markdown file as JSON.
 * Widget generation returns a preview only; the client decides whether to
 * apply and save the generated candidate.
 */
import type { Request, Response } from "express";
import type { ServerConfig } from "../config.js";
import {
  generateIdentityDashboardWidget,
  readIdentityDashboardConfig,
  saveIdentityDashboardConfig,
} from "../services/identity-dashboard.js";

export function handleIdentityDashboardGet(cfg: ServerConfig) {
  return (req: Request, res: Response) => {
    const path = readQueryPath(req);
    if (!path) {
      res.status(400).json({ success: false, error: "missing path" });
      return;
    }
    res.json({ success: true, data: { config: readIdentityDashboardConfig(cfg, path) } });
  };
}

export function handleIdentityDashboardSave(cfg: ServerConfig) {
  // fallow-ignore-next-line complexity
  return (req: Request, res: Response) => {
    const path = typeof req.body?.path === "string" ? req.body.path.trim() : "";
    if (!path || !req.body?.config) {
      res.status(400).json({ success: false, error: "invalid dashboard payload" });
      return;
    }
    try {
      const config = saveIdentityDashboardConfig(cfg, path, req.body.config);
      res.json({ success: true, data: { config } });
    } catch (error) {
      res.status(400).json({ success: false, error: errorMessage(error) });
    }
  };
}

export function handleIdentityDashboardWidgetGenerate(cfg: ServerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const data = await generateIdentityDashboardWidget(cfg, req.body ?? {});
      res.json({ success: true, data });
    } catch (error) {
      res.status(400).json({ success: false, error: errorMessage(error) });
    }
  };
}

function readQueryPath(req: Request): string {
  return typeof req.query.path === "string" ? req.query.path.trim() : "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
