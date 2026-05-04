/**
 * Registers and implements the WebUI LLM configuration routes.
 */
import type { Express, Request, Response } from "express";
import type { ServerConfig } from "../config.js";
import { readLlmProviderConfig, saveLlmProviderConfig, testLlmProviderConfig } from "../services/llm-config.js";
import { deleteLlmApiAccount, readLlmApiAccounts, saveLlmApiAccount, startLlmApiAccount } from "../services/llm-accounts.js";
import { pullAccountAiSettingsToLocal, pushLocalAiSettingsToAccount } from "../services/account-ai-sync.js";
import { readCloudflareServicesConfig, summarizeCloudflareServicesConfig } from "../../../src/utils/cloudflare-services-config.js";

interface CloudflareLlmProviderSummary {
  accountRef: "cloudflare:workers-ai";
  configured: boolean;
  runtime: "worker" | "workers-ai-rest" | "unconfigured";
  endpoint: string | null;
  aiModel: string | null;
  embeddingModels: string[];
}

export function registerLlmRoutes(app: Express, cfg: ServerConfig): void {
  app.get("/api/llm/config", handleLlmConfig(cfg));
  app.get("/api/llm/accounts", handleLlmAccounts(cfg));
  app.get("/api/llm/cloudflare-provider", handleCloudflareProvider());
  const maybePut = (app as Express & { put?: Express["put"] }).put;
  const maybeDelete = (app as Express & { delete?: Express["delete"] }).delete;
  maybePut?.call(app, "/api/llm/config", handleLlmConfigSave(cfg));
  maybePut?.call(app, "/api/llm/accounts", handleLlmAccountSave(cfg));
  maybeDelete?.call(app, "/api/llm/accounts", handleLlmAccountDelete(cfg));
  app.post("/api/llm/test", handleLlmConfigTest(cfg));
  app.post("/api/llm/accounts/start", handleLlmAccountStart(cfg));
}

function handleLlmConfig(cfg: ServerConfig) {
  return async (_req: Request, res: Response) => {
    await tryPullAccountAiSettings(cfg);
    res.json({ success: true, data: readLlmProviderConfig(cfg.projectRoot) });
  };
}

function handleLlmConfigSave(cfg: ServerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const data = saveLlmProviderConfig(cfg.projectRoot, req.body ?? {});
      pushAccountAiSettingsInBackground(cfg.projectRoot);
      res.json({ success: true, data });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}

function handleLlmAccounts(cfg: ServerConfig) {
  return async (_req: Request, res: Response) => {
    await tryPullAccountAiSettings(cfg);
    res.json({ success: true, data: readLlmApiAccounts(cfg.projectRoot) });
  };
}

function handleCloudflareProvider() {
  return (_req: Request, res: Response) => {
    res.json({ success: true, data: readCloudflareProviderSummary() });
  };
}

function readCloudflareProviderSummary(): CloudflareLlmProviderSummary {
  const summary = summarizeCloudflareServicesConfig(readCloudflareServicesConfig());
  const usesWorker = Boolean(summary.workerUrl && summary.remoteTokenConfigured);
  const usesRest = Boolean(summary.accountId && summary.apiTokenConfigured);
  return {
    accountRef: "cloudflare:workers-ai",
    configured: usesWorker || usesRest,
    runtime: usesWorker ? "worker" : usesRest ? "workers-ai-rest" : "unconfigured",
    endpoint: summary.workerUrl ?? (summary.accountId ? "Cloudflare Workers AI REST" : null),
    aiModel: summary.aiModel,
    embeddingModels: summary.embeddingModel ? [summary.embeddingModel] : [],
  };
}

function handleLlmAccountSave(cfg: ServerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const data = saveLlmApiAccount(cfg.projectRoot, req.body ?? {});
      pushAccountAiSettingsInBackground(cfg.projectRoot);
      res.json({ success: true, data });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}

function handleLlmAccountDelete(cfg: ServerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const data = deleteLlmApiAccount(cfg.projectRoot, req.body ?? {});
      pushAccountAiSettingsInBackground(cfg.projectRoot);
      res.json({ success: true, data });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}

function handleLlmAccountStart(cfg: ServerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const data = startLlmApiAccount(cfg.projectRoot, req.body ?? {});
      const config = saveLlmProviderConfig(cfg.projectRoot, { accountRef: `api:${data.id}` });
      pushAccountAiSettingsInBackground(cfg.projectRoot);
      res.json({ success: true, data: { account: data, config } });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}

async function tryPullAccountAiSettings(cfg: ServerConfig): Promise<void> {
  await pullAccountAiSettingsToLocal(cfg.projectRoot).catch(() => null);
}

function pushAccountAiSettingsInBackground(projectRoot: string): void {
  void pushLocalAiSettingsToAccount(projectRoot).catch(() => null);
}

function handleLlmConfigTest(cfg: ServerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const data = await testLlmProviderConfig(cfg.projectRoot, req.body ?? {});
      res.json({ success: true, data });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
