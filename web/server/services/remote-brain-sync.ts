import type { ServerConfig } from "../config.js";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { upsertWikiVectorPages } from "../../../src/services/cloudflare-vector-search.js";
import { readFlashDiarySyncState } from "./flash-diary-sync.js";
import {
  readCloudflareRemoteBrainConfig,
  summarizeCloudflareRemoteBrainConfig,
  type CloudflareRemoteBrainConfig,
  type CloudflareRemoteBrainSummary,
} from "./cloudflare-remote-brain-config.js";
import { fetchWithOptionalProxy } from "../../../src/utils/proxy-fetch.js";

type RemoteBrainAction = "push" | "pull" | "publish";

type RemoteBrainMode = "cloudflare-unconfigured" | "cloudflare-connected" | "cloudflare-error";

interface RemoteBrainError {
  type: "cloudflare-unconfigured" | "cloudflare-http-error" | "cloudflare-network-error" | "cloudflare-invalid-json";
  message: string;
  endpoint: string | null;
  status?: number;
}

interface RemoteBrainStatus {
  provider: "cloudflare";
  mode: RemoteBrainMode;
  connected: boolean;
  endpoint: string | null;
  pushSupported: true;
  pullSupported: true;
  publishSupported: true;
  cloudflare: CloudflareRemoteBrainSummary;
  flashDiarySync: ReturnType<typeof readFlashDiarySyncState>;
  workerResponse?: unknown;
  error?: RemoteBrainError;
}

interface RemoteBrainActionResult {
  provider: "cloudflare";
  action: RemoteBrainAction;
  mode: RemoteBrainMode;
  queued: false;
  network: boolean;
  endpoint: string | null;
  cloudflare: CloudflareRemoteBrainSummary;
  workerResponse?: unknown;
  error?: RemoteBrainError;
}

interface RemoteBrainCallResult<T> {
  ok: boolean;
  data: T;
  statusCode: number;
  error?: RemoteBrainError;
}

interface RemoteBrainFilePayload {
  path: string;
  content: string;
  hash: string;
  modifiedAt: string;
}

interface RemoteBrainPublishPayload {
  action: "publish";
  wikiRoot: string;
  publishedAt: string;
  files: RemoteBrainFilePayload[];
  indexFiles: RemoteBrainFilePayload[];
}

interface RemoteBrainPushPayload {
  action: "push";
  wikiRoot: string;
  pushedAt: string;
  manifest: Array<Pick<RemoteBrainFilePayload, "path" | "hash" | "modifiedAt">>;
  indexManifest: Array<Pick<RemoteBrainFilePayload, "path" | "hash" | "modifiedAt">>;
}

interface RemoteBrainPullPayload {
  action: "pull";
  wikiRoot: string;
  pulledAt: string;
  limit?: number;
  cursor?: string;
}

const REMOTE_BRAIN_PUBLISH_BATCH_SIZE = 20;

export async function getRemoteBrainStatus(cfg: ServerConfig): Promise<RemoteBrainCallResult<RemoteBrainStatus>> {
  const cloudflare = readCloudflareRemoteBrainConfig();
  const base = buildCloudflareBase(cloudflare);

  if (!cloudflare.enabled || !base) {
    return {
      ok: true,
      statusCode: 200,
      data: {
        provider: "cloudflare",
        mode: "cloudflare-unconfigured",
        connected: false,
        endpoint: cloudflare.workerUrl,
        pushSupported: true,
        pullSupported: true,
        publishSupported: true,
        cloudflare: summarizeCloudflareRemoteBrainConfig(cloudflare),
        flashDiarySync: readFlashDiarySyncState(cfg.runtimeRoot),
      },
    };
  }

  const response = await callCloudflareWorker(base, cloudflare, "status", "GET");
  if (!response.ok) {
    return {
      ok: false,
      statusCode: response.statusCode,
      error: response.error,
      data: {
        provider: "cloudflare",
        mode: "cloudflare-error",
        connected: false,
        endpoint: cloudflare.workerUrl,
        pushSupported: true,
        pullSupported: true,
        publishSupported: true,
        cloudflare: summarizeCloudflareRemoteBrainConfig(cloudflare),
        flashDiarySync: readFlashDiarySyncState(cfg.runtimeRoot),
        error: response.error,
      },
    };
  }

  return {
    ok: true,
    statusCode: 200,
    data: {
      provider: "cloudflare",
      mode: "cloudflare-connected",
      connected: true,
      endpoint: cloudflare.workerUrl,
      pushSupported: true,
      pullSupported: true,
      publishSupported: true,
      cloudflare: summarizeCloudflareRemoteBrainConfig(cloudflare),
      flashDiarySync: readFlashDiarySyncState(cfg.runtimeRoot),
      workerResponse: response.data,
    },
  };
}

export async function queueRemoteBrainPush(cfg: ServerConfig): Promise<RemoteBrainCallResult<RemoteBrainActionResult>> {
  return queueRemoteBrainAction(cfg, "push");
}

export async function queueRemoteBrainPull(cfg: ServerConfig): Promise<RemoteBrainCallResult<RemoteBrainActionResult>> {
  return queueRemoteBrainAction(cfg, "pull");
}

export async function queueRemoteBrainPublish(cfg: ServerConfig): Promise<RemoteBrainCallResult<RemoteBrainActionResult>> {
  return queueRemoteBrainAction(cfg, "publish");
}

async function queueRemoteBrainAction(
  cfg: ServerConfig,
  action: RemoteBrainAction,
): Promise<RemoteBrainCallResult<RemoteBrainActionResult>> {
  const cloudflare = readCloudflareRemoteBrainConfig();
  const base = buildCloudflareBase(cloudflare);

  if (!cloudflare.enabled || !base) {
    const error: RemoteBrainError = {
      type: "cloudflare-unconfigured",
      message: "Set CLOUDFLARE_WORKER_URL and CLOUDFLARE_REMOTE_TOKEN before using Remote Brain.",
      endpoint: cloudflare.workerUrl,
    };
    return {
      ok: false,
      statusCode: 400,
      error,
      data: {
        provider: "cloudflare",
        action,
        mode: "cloudflare-unconfigured",
        queued: false,
        network: false,
        endpoint: cloudflare.workerUrl,
        cloudflare: summarizeCloudflareRemoteBrainConfig(cloudflare),
        error,
      },
    };
  }

  const payload = buildRemoteBrainPayload(cfg, action);
  if (action === "pull") {
    return queueRemoteBrainPullPages(cfg, cloudflare, base, payload as RemoteBrainPullPayload);
  }
  if (action === "publish") {
    return queueRemoteBrainPublishBatches(cloudflare, base, payload as RemoteBrainPublishPayload, cfg.sourceVaultRoot);
  }
  const response = await callCloudflareWorker(base, cloudflare, action, "POST", payload);
  if (!response.ok) {
    return {
      ok: false,
      statusCode: response.statusCode,
      error: response.error,
      data: {
        provider: "cloudflare",
        action,
        mode: "cloudflare-error",
        queued: false,
        network: true,
        endpoint: cloudflare.workerUrl,
        cloudflare: summarizeCloudflareRemoteBrainConfig(cloudflare),
        workerResponse: response.data,
        error: response.error,
      },
    };
  }

  return {
    ok: true,
    statusCode: 200,
    data: {
      provider: "cloudflare",
      action,
      mode: "cloudflare-connected",
      queued: false,
      network: true,
      endpoint: cloudflare.workerUrl,
      cloudflare: summarizeCloudflareRemoteBrainConfig(cloudflare),
      workerResponse: response.data,
    },
  };
}

// fallow-ignore-next-line complexity
async function queueRemoteBrainPublishBatches(
  cloudflare: CloudflareRemoteBrainConfig,
  base: URL,
  payload: RemoteBrainPublishPayload,
  wikiRoot: string,
): Promise<RemoteBrainCallResult<RemoteBrainActionResult>> {
  const batches = chunkPublishPayload(payload, REMOTE_BRAIN_PUBLISH_BATCH_SIZE);
  const aggregated = {
    ok: true,
    action: "publish",
    batchCount: batches.length,
    pageCount: 0,
    indexFileCount: payload.indexFiles.length,
    vectorUpserted: 0,
    vectorSkipped: 0,
    vectorErrors: 0,
    vectorErrorSamples: [] as string[],
    runs: [] as string[],
  };

  for (const batch of batches) {
    const response = await callCloudflareWorker(base, cloudflare, "publish", "POST", batch);
    if (!response.ok) {
      return {
        ok: false,
        statusCode: response.statusCode,
        error: response.error,
        data: {
          provider: "cloudflare",
          action: "publish",
          mode: "cloudflare-error",
          queued: false,
          network: true,
          endpoint: cloudflare.workerUrl,
          cloudflare: summarizeCloudflareRemoteBrainConfig(cloudflare),
          workerResponse: {
            ...aggregated,
            failedBatchPageCount: batch.files.length,
          },
          error: response.error,
        },
      };
    }
    const record = response.data && typeof response.data === "object" ? response.data as Record<string, unknown> : {};
    aggregated.pageCount += numberValue(record.pageCount);
    aggregated.vectorUpserted += numberValue(record.vectorUpserted);
    aggregated.vectorErrors += numberValue(record.vectorErrors);
    if (typeof record.runId === "string" && record.runId) {
      aggregated.runs.push(record.runId);
    }
    const samples = Array.isArray(record.vectorErrorSamples) ? record.vectorErrorSamples : [];
    for (const sample of samples) {
      if (typeof sample === "string" && sample && aggregated.vectorErrorSamples.length < 8) {
        aggregated.vectorErrorSamples.push(sample);
      }
    }
  }

  const vectorUpload = await upsertWikiVectorPages(
    payload.files.map((file) => ({
      path: file.path,
      title: titleFromPath(file.path),
      hash: file.hash,
      content: file.content,
      publishedAt: payload.publishedAt,
    })),
    { wikiRoot },
  );
  if (vectorUpload.ok) {
    aggregated.vectorUpserted = vectorUpload.data.upserted;
    aggregated.vectorSkipped = vectorUpload.data.skipped;
    aggregated.vectorErrors = vectorUpload.data.errors;
    aggregated.vectorErrorSamples = vectorUpload.data.errorSamples.slice(0, 8);
    aggregated.runs.push(
      ...vectorUpload.data.mutationIds.map((mutationId) => `vector:${mutationId}`),
    );
  } else {
    aggregated.vectorUpserted = 0;
    aggregated.vectorSkipped = 0;
    aggregated.vectorErrors = payload.files.length;
    aggregated.vectorErrorSamples = [vectorUpload.error.message];
  }

  return {
    ok: true,
    statusCode: 200,
    data: {
      provider: "cloudflare",
      action: "publish",
      mode: "cloudflare-connected",
      queued: false,
      network: true,
      endpoint: cloudflare.workerUrl,
      cloudflare: summarizeCloudflareRemoteBrainConfig(cloudflare),
      workerResponse: aggregated,
    },
  };
}

// fallow-ignore-next-line complexity
async function queueRemoteBrainPullPages(
  _cfg: ServerConfig,
  cloudflare: CloudflareRemoteBrainConfig,
  base: URL,
  payload: RemoteBrainPullPayload,
): Promise<RemoteBrainCallResult<RemoteBrainActionResult>> {
  const pages: unknown[] = [];
  let cursor: string | null | undefined = undefined;
  let workerResponse: unknown = null;
  for (let page = 0; page < 50; page += 1) {
    const response = await callCloudflareWorker(base, cloudflare, "pull", "POST", {
      ...payload,
      limit: 500,
      cursor: cursor || undefined,
    });
    if (!response.ok) {
      return {
        ok: false,
        statusCode: response.statusCode,
        error: response.error,
        data: {
          provider: "cloudflare",
          action: "pull",
          mode: "cloudflare-error",
          queued: false,
          network: true,
          endpoint: cloudflare.workerUrl,
          cloudflare: summarizeCloudflareRemoteBrainConfig(cloudflare),
          workerResponse: response.data,
          error: response.error,
        },
      };
    }
    const record = response.data && typeof response.data === "object" ? response.data as Record<string, unknown> : {};
    const batch = Array.isArray(record.pages) ? record.pages : [];
    pages.push(...batch);
    workerResponse = response.data;
    cursor = typeof record.nextCursor === "string" && record.nextCursor ? record.nextCursor : null;
    if (!cursor) break;
  }
  return {
    ok: true,
    statusCode: 200,
    data: {
      provider: "cloudflare",
      action: "pull",
      mode: "cloudflare-connected",
      queued: false,
      network: true,
      endpoint: cloudflare.workerUrl,
      cloudflare: summarizeCloudflareRemoteBrainConfig(cloudflare),
      workerResponse: {
        ...(workerResponse && typeof workerResponse === "object" ? workerResponse as Record<string, unknown> : {}),
        pages,
        pulledPageCount: pages.length,
      },
    },
  };
}

function buildCloudflareBase(cloudflare: CloudflareRemoteBrainConfig): URL | null {
  if (!cloudflare.enabled || !cloudflare.workerUrl) {
    return null;
  }

  try {
    return new URL(cloudflare.workerUrl);
  } catch {
    return null;
  }
}

// fallow-ignore-next-line complexity
async function callCloudflareWorker(
  base: URL,
  cloudflare: CloudflareRemoteBrainConfig,
  action: "status" | RemoteBrainAction,
  method: "GET" | "POST",
  payload?: RemoteBrainPublishPayload | RemoteBrainPushPayload | RemoteBrainPullPayload,
): Promise<
  | { ok: true; statusCode: number; data: unknown }
  | { ok: false; statusCode: number; error: RemoteBrainError; data?: unknown }
> {
  const endpoint = new URL(action, base);

  let response: Response;
  try {
    response = await fetchWithOptionalProxy(endpoint, {
      method,
      headers: {
        Authorization: `Bearer ${cloudflare.remoteToken ?? ""}`,
        "Content-Type": "application/json",
      },
      body: method === "POST"
        ? JSON.stringify(payload ?? { action })
        : undefined,
    });
  } catch (error) {
    return {
      ok: false,
      statusCode: 502,
      error: {
        type: "cloudflare-network-error",
        message: error instanceof Error ? error.message : String(error),
        endpoint: endpoint.toString(),
      },
    };
  }

  const data = await readRemoteBrainResponse(response).catch((error) => ({
    __parseError: error instanceof Error ? error.message : String(error),
  }));

  if (!response.ok) {
    return {
      ok: false,
      statusCode: 502,
      error: {
        type: "cloudflare-http-error",
        message: `Cloudflare Worker returned ${response.status} for ${action}.`,
        endpoint: endpoint.toString(),
        status: response.status,
      },
      data,
    };
  }

  if (data && typeof data === "object" && "__parseError" in data) {
    return {
      ok: false,
      statusCode: 502,
      error: {
        type: "cloudflare-invalid-json",
        message: `Cloudflare Worker returned an unreadable response for ${action}.`,
        endpoint: endpoint.toString(),
        status: response.status,
      },
      data,
    };
  }

  return {
    ok: true,
    statusCode: response.status,
    data,
  };
}

async function readRemoteBrainResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  const text = await response.text();
  return text.length > 0 ? { text } : null;
}

function buildRemoteBrainPayload(
  cfg: ServerConfig,
  action: RemoteBrainAction,
): RemoteBrainPublishPayload | RemoteBrainPushPayload | RemoteBrainPullPayload {
  if (action === "publish") {
    const files = collectRemoteBrainFiles(cfg.sourceVaultRoot, "wiki", ".md");
    const indexFiles = collectRemoteBrainFiles(cfg.runtimeRoot, ".llmwiki", ".json");
    return {
      action,
      wikiRoot: path.basename(cfg.sourceVaultRoot),
      publishedAt: new Date().toISOString(),
      files,
      indexFiles,
    };
  }

  if (action === "push") {
    const files = collectRemoteBrainFiles(cfg.sourceVaultRoot, "wiki", ".md");
    const indexFiles = collectRemoteBrainFiles(cfg.runtimeRoot, ".llmwiki", ".json");
    return {
      action,
      wikiRoot: path.basename(cfg.sourceVaultRoot),
      pushedAt: new Date().toISOString(),
      manifest: files.map(toManifestEntry),
      indexManifest: indexFiles.map(toManifestEntry),
    };
  }

  return {
    action,
    wikiRoot: path.basename(cfg.sourceVaultRoot),
    pulledAt: new Date().toISOString(),
  };
}

function chunkPublishPayload(payload: RemoteBrainPublishPayload, size: number): RemoteBrainPublishPayload[] {
  if (payload.files.length <= size) {
    return [payload];
  }
  const batches: RemoteBrainPublishPayload[] = [];
  for (let index = 0; index < payload.files.length; index += size) {
    batches.push({
      ...payload,
      files: payload.files.slice(index, index + size),
      indexFiles: index === 0 ? payload.indexFiles : [],
    });
  }
  return batches;
}

function collectRemoteBrainFiles(root: string, directory: "wiki" | ".llmwiki", extension: ".md" | ".json"): RemoteBrainFilePayload[] {
  const base = path.join(root, directory);
  if (!fs.existsSync(base)) {
    return [];
  }

  const files: RemoteBrainFilePayload[] = [];
  collectFiles(base, extension, files, root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function collectFiles(current: string, extension: ".md" | ".json", files: RemoteBrainFilePayload[], root: string): void {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      collectFiles(fullPath, extension, files, root);
      continue;
    }
    if (!entry.isFile() || path.extname(entry.name) !== extension) {
      continue;
    }
    const content = fs.readFileSync(fullPath, "utf8");
    const stats = fs.statSync(fullPath);
    files.push({
      path: path.relative(root, fullPath).split(path.sep).join("/"),
      content,
      hash: crypto.createHash("sha256").update(content).digest("hex"),
      modifiedAt: stats.mtime.toISOString(),
    });
  }
}

function toManifestEntry(file: RemoteBrainFilePayload): Pick<RemoteBrainFilePayload, "path" | "hash" | "modifiedAt"> {
  return {
    path: file.path,
    hash: file.hash,
    modifiedAt: file.modifiedAt,
  };
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function titleFromPath(pagePath: string): string {
  return pagePath.replace(/^wiki\//, "").replace(/\.md$/, "").split("/").pop() || pagePath;
}
