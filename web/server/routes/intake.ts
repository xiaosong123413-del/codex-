import type { Request, Response } from "express";
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ServerConfig } from "../config.js";
import { buildIntakePlan, scanIntakeForReview } from "../services/intake-summary.js";
import { readSyncRepoConfig } from "../services/sync-config.js";

type MobilePullResult = {
  pulledCount: number;
  failedCount: number;
  skipped?: boolean;
  error?: string;
};

type MobilePuller = (cfg: ServerConfig) => Promise<MobilePullResult>;

let projectEnvLoaded = false;
let proxyBootstrapped = false;

export function handleIntakeScan(cfg: ServerConfig, pullMobileEntries: MobilePuller = pullMobileEntriesBeforeScan) {
  return async (_req: Request, res: Response) => {
    const mobilePull = await pullMobileEntries(cfg);
    const sourceRoots = readSyncRepoConfig(cfg.projectRoot).sourceRepoPaths;
    const now = new Date();
    const scanOptions = { sourceRoots };
    const items = scanIntakeForReview(cfg.sourceVaultRoot, cfg.runtimeRoot, now, scanOptions);
    res.json({
      success: true,
      data: {
        mobilePull,
        items,
        plan: buildIntakePlan(cfg.sourceVaultRoot, cfg.runtimeRoot, now, scanOptions),
      },
    });
  };
}

async function pullMobileEntriesBeforeScan(cfg: ServerConfig): Promise<MobilePullResult> {
  loadProjectEnv(cfg.projectRoot);
  await bootstrapProxy();
  const moduleUrl = pathToFileURL(
    path.join(cfg.projectRoot, "scripts", "sync-compile", "cloudflare-mobile-sync.mjs"),
  ).href;
  const module = await import(moduleUrl) as {
    syncMobileEntriesFromCloudflare: (input: {
      projectRoot: string;
      vaultRoot: string;
      now?: string;
    }) => Promise<MobilePullResult>;
  };
  return module.syncMobileEntriesFromCloudflare({
    projectRoot: cfg.projectRoot,
    vaultRoot: cfg.sourceVaultRoot,
    now: new Date().toISOString(),
  });
}

function loadProjectEnv(projectRoot: string): void {
  if (projectEnvLoaded) return;
  loadDotenv({ path: path.join(projectRoot, ".env") });
  projectEnvLoaded = true;
}

async function bootstrapProxy(): Promise<void> {
  if (proxyBootstrapped) return;
  if (process.env.GLOBAL_AGENT_HTTP_PROXY || process.env.GLOBAL_AGENT_HTTPS_PROXY) {
    await import("global-agent/bootstrap.js");
  }
  proxyBootstrapped = true;
}
