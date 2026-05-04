/**
 * Express routes for account-backed AI settings and Codex OAuth.
 *
 * These routes are desktop bridge endpoints: the browser UI talks to the local
 * server, and the local server talks to the public Worker with the logged-in
 * account session.
 */
import type { Express, Request, Response } from "express";
import {
  fetchAccountAiSettings,
  pollAccountCodexOAuth,
  pullAccountAiSettingsToLocal,
  pushLocalAiSettingsToAccount,
  refreshAccountCodexQuota,
  saveAccountAiSettings,
  startAccountCodexOAuth,
} from "../services/account-ai-sync.js";
import type { ServerConfig } from "../config.js";

export function registerAccountAiRoutes(app: Express, cfg: ServerConfig): void {
  app.get("/api/account-ai/settings", handleSettingsGet(cfg));
  app.put("/api/account-ai/settings", handleSettingsSave());
  app.post("/api/account-ai/sync/pull", handleSettingsPull(cfg));
  app.post("/api/account-ai/sync/push", handleSettingsPush(cfg));
  app.post("/api/account-ai/codex-oauth/start", handleCodexOAuthStart());
  app.get("/api/account-ai/codex-oauth/status", handleCodexOAuthStatus());
  app.get("/api/account-ai/codex-quota", handleCodexQuota());
}

function handleSettingsGet(cfg: ServerConfig) {
  return async (_req: Request, res: Response) => {
    await respond(res, async () => {
      const settings = await fetchAccountAiSettings();
      if (settings) await pullAccountAiSettingsToLocal(cfg.projectRoot);
      return settings;
    });
  };
}

function handleSettingsSave() {
  return async (req: Request, res: Response) => {
    await respond(res, () => saveAccountAiSettings(req.body?.settings ?? req.body ?? {}));
  };
}

function handleSettingsPull(cfg: ServerConfig) {
  return async (_req: Request, res: Response) => {
    await respond(res, () => pullAccountAiSettingsToLocal(cfg.projectRoot));
  };
}

function handleSettingsPush(cfg: ServerConfig) {
  return async (_req: Request, res: Response) => {
    await respond(res, () => pushLocalAiSettingsToAccount(cfg.projectRoot));
  };
}

function handleCodexOAuthStart() {
  return async (_req: Request, res: Response) => {
    await respond(res, () => startAccountCodexOAuth());
  };
}

function handleCodexOAuthStatus() {
  return async (req: Request, res: Response) => {
    await respond(res, () => pollAccountCodexOAuth(req.query.state));
  };
}

function handleCodexQuota() {
  return async (_req: Request, res: Response) => {
    await respond(res, () => refreshAccountCodexQuota());
  };
}

async function respond(res: Response, work: () => Promise<unknown>): Promise<void> {
  try {
    res.json({ success: true, data: await work() });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
