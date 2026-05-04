import type { Express, Request, Response } from "express";
import type { ServerConfig } from "../config.js";
import {
  getCLIProxyAuthFileModels,
  getCLIProxyCodexAccounts,
  getCLIProxyOAuthAccounts,
  getCLIProxyOAuthStatus,
  getCLIProxyStatus,
  installCLIProxySource,
  deleteCLIProxyAccount,
  readCLIProxyConfig,
  requestCLIProxyOAuth,
  saveCLIProxyOpenAICompatibility,
  setCLIProxyAccountEnabled,
  setCLIProxyCodexAccountEnabled,
  startCLIProxy,
  stopCLIProxy,
  syncCLIProxyCodexTokenToWorker,
} from "../services/cliproxy.js";

export function registerCLIProxyRoutes(app: Express, cfg: ServerConfig): void {
  app.get("/api/cliproxy/status", handleCLIProxyStatus(cfg));
  app.get("/api/cliproxy/accounts", handleCLIProxyAccounts(cfg));
  app.get("/api/cliproxy/accounts/models", handleCLIProxyAccountModels(cfg));
  app.get("/api/cliproxy/codex/accounts", handleCLIProxyCodexAccounts(cfg));
  app.get("/api/cliproxy/oauth/status", handleCLIProxyOAuthStatus(cfg));
  app.post("/api/cliproxy/install", handleCLIProxyInstall(cfg));
  app.post("/api/cliproxy/start", handleCLIProxyStart(cfg));
  app.post("/api/cliproxy/stop", handleCLIProxyStop());
  app.post("/api/cliproxy/oauth", handleCLIProxyOAuth(cfg));
  app.delete("/api/cliproxy/accounts", handleCLIProxyAccountDelete(cfg));
  app.post("/api/cliproxy/accounts/enabled", handleCLIProxyAccountEnabled(cfg));
  app.post("/api/cliproxy/accounts/sync-worker-token", handleCLIProxyAccountWorkerSync(cfg));
  app.post("/api/cliproxy/codex/accounts/enabled", handleCLIProxyCodexAccountEnabled(cfg));
  app.post("/api/cliproxy/openai-compatibility", handleCLIProxyOpenAICompatibility(cfg));
}

function handleCLIProxyStatus(cfg: ServerConfig) {
  return async (_req: Request, res: Response) => {
    const data = await getCLIProxyStatus(readCLIProxyConfig(cfg.projectRoot));
    res.json({ success: true, data });
  };
}

function handleCLIProxyOAuthStatus(cfg: ServerConfig) {
  return async (req: Request, res: Response) => {
    await respond(res, () => getCLIProxyOAuthStatus({
      ...readCLIProxyConfig(cfg.projectRoot),
      state: req.query.state,
    }));
  };
}

function handleCLIProxyCodexAccounts(cfg: ServerConfig) {
  return async (req: Request, res: Response) => {
    await respond(res, () => getCLIProxyCodexAccounts({
      ...readCLIProxyConfig(cfg.projectRoot),
      projectRoot: cfg.projectRoot,
      refreshQuota: req.query.refresh === "1",
    }));
  };
}

function handleCLIProxyAccounts(cfg: ServerConfig) {
  return async (req: Request, res: Response) => {
    await respond(res, () => getCLIProxyOAuthAccounts({
      ...readCLIProxyConfig(cfg.projectRoot),
      projectRoot: cfg.projectRoot,
      refreshQuota: req.query.refresh === "1",
    }));
  };
}

function handleCLIProxyAccountModels(cfg: ServerConfig) {
  return async (req: Request, res: Response) => {
    await respond(res, () => getCLIProxyAuthFileModels({
      ...readCLIProxyConfig(cfg.projectRoot),
      name: req.query.name,
    }));
  };
}

function handleCLIProxyAccountWorkerSync(cfg: ServerConfig) {
  return async (req: Request, res: Response) => {
    await respond(res, () => syncCLIProxyCodexTokenToWorker({
      ...readCLIProxyConfig(cfg.projectRoot),
      projectRoot: cfg.projectRoot,
      name: readRecord(req.body).name,
      ownerUid: readRecord(req.body).ownerUid,
      workerUrl: readRecord(req.body).workerUrl,
      remoteToken: readRecord(req.body).remoteToken,
    }));
  };
}

function handleCLIProxyInstall(cfg: ServerConfig) {
  return async (_req: Request, res: Response) => {
    await respond(res, () => installCLIProxySource(cfg.projectRoot));
  };
}

function handleCLIProxyStart(cfg: ServerConfig) {
  return async (req: Request, res: Response) => {
    await respond(res, () => startCLIProxy(cfg.projectRoot, parseConfigInput(req.body)));
  };
}

function handleCLIProxyStop() {
  return async (_req: Request, res: Response) => {
    await respond(res, () => stopCLIProxy());
  };
}

function handleCLIProxyOAuth(cfg: ServerConfig) {
  return async (req: Request, res: Response) => {
    await respond(res, () => requestCLIProxyOAuth({
      ...readCLIProxyConfig(cfg.projectRoot),
      provider: parseOAuthProvider(req.body),
    }));
  };
}

function handleCLIProxyCodexAccountEnabled(cfg: ServerConfig) {
  return handleCLIProxyAccountEnabled(cfg, setCLIProxyCodexAccountEnabled);
}

function handleCLIProxyAccountEnabled(cfg: ServerConfig, work = setCLIProxyAccountEnabled) {
  return async (req: Request, res: Response) => {
    await respond(res, () => work({
      ...readCLIProxyConfig(cfg.projectRoot),
      name: readRecord(req.body).name,
      enabled: readRecord(req.body).enabled,
    }));
  };
}

function handleCLIProxyAccountDelete(cfg: ServerConfig) {
  return async (req: Request, res: Response) => {
    await respond(res, () => deleteCLIProxyAccount({
      ...readCLIProxyConfig(cfg.projectRoot),
      projectRoot: cfg.projectRoot,
      name: readRecord(req.body).name,
    }));
  };
}

function handleCLIProxyOpenAICompatibility(cfg: ServerConfig) {
  return async (req: Request, res: Response) => {
    await respond(res, () => saveCLIProxyOpenAICompatibility({
      ...readCLIProxyConfig(cfg.projectRoot),
      ...readRecord(req.body),
    }));
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

function parseConfigInput(body: unknown): { port?: number; managementKey?: string; clientKey?: string; model?: string; proxyUrl?: string } {
  const record = readRecord(body);
  return {
    port: typeof record.port === "number" ? record.port : undefined,
    managementKey: typeof record.managementKey === "string" ? record.managementKey : undefined,
    clientKey: typeof record.clientKey === "string" ? record.clientKey : undefined,
    model: typeof record.model === "string" ? record.model : undefined,
    proxyUrl: typeof record.proxyUrl === "string" ? record.proxyUrl : undefined,
  };
}

function parseOAuthProvider(body: unknown): "anthropic" | "codex" | "gemini-cli" | "antigravity" | "kimi" {
  const provider = readRecord(body).provider;
  if (
    provider === "anthropic"
    || provider === "codex"
    || provider === "gemini-cli"
    || provider === "antigravity"
    || provider === "kimi"
  ) {
    return provider;
  }
  throw new Error("Unsupported OAuth provider.");
}

function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
