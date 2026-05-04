/**
 * Cloudflare embeddings and vector search client.
 *
 * Provides narrow HTTP adapters for local server/root code; Worker-side index
 * implementation remains outside this repository.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readCloudflareServicesConfig } from "../utils/cloudflare-services-config.js";
import {
  extractVectorResponse,
  postCloudflareAiRun,
  postWorkerJson,
  type CloudflareClientError,
  type CloudflareClientResult,
} from "../utils/cloudflare-http.js";
import { fetchWithOptionalProxy } from "../utils/proxy-fetch.js";

interface VectorSearchMatch {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
}

interface VectorUpsertRecord {
  id: string;
  values: number[];
  metadata?: Record<string, string | number | boolean>;
}

interface WikiVectorPageInput {
  path: string;
  title: string;
  hash: string;
  content: string;
  publishedAt: string;
}

interface VectorUpsertSummary {
  upserted: number;
  skipped: number;
  errors: number;
  mutationIds: string[];
  errorSamples: string[];
}

interface VectorUpsertOptions {
  wikiRoot?: string;
}

interface VectorPublishStateFile {
  version: 1;
  pages: Record<string, VectorPublishStateEntry>;
}

interface VectorPublishStateEntry {
  hash: string;
  vectorId: string;
  updatedAt: string;
}

const EMBEDDING_CONCURRENCY = 8;
const VECTOR_PUBLISH_STATE_FILE = ".llmwiki/vector-publish-state.json";

export async function embedText(text: string): Promise<CloudflareClientResult<number[]>> {
  const cfg = readCloudflareServicesConfig();
  const payload = { text, model: cfg.embeddingModel };
  const result = cfg.workerUrl && cfg.remoteToken
    ? await postWorkerJson<unknown>(cfg, "embed", payload)
    : await postCloudflareAiRun<unknown>(cfg, cfg.embeddingModel, { text });
  if (!result.ok) return result;
  return { ok: true, data: extractVectorResponse(result.data) };
}

export async function queryVectorSearch(
  vector: number[],
  limit = 10,
): Promise<CloudflareClientResult<VectorSearchMatch[]>> {
  const cfg = readCloudflareServicesConfig();
  const result = await postWorkerJson<unknown>(cfg, "vector/query", { vector, topK: limit });
  if (!result.ok) return result;
  return { ok: true, data: normalizeMatches(result.data) };
}

export async function upsertWikiVectorPages(
  pages: WikiVectorPageInput[],
  options: VectorUpsertOptions = {},
): Promise<CloudflareClientResult<VectorUpsertSummary>> {
  const cfg = readCloudflareServicesConfig();
  const indexName = normalizeOptional(process.env.CLOUDFLARE_VECTORIZE_INDEX);
  if (!cfg.accountId || !cfg.apiToken || !indexName) {
    return {
      ok: false,
      error: {
        type: "cloudflare-unconfigured",
        message: "Missing CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, or CLOUDFLARE_VECTORIZE_INDEX",
      },
    };
  }

  const vectorState = options.wikiRoot ? readVectorPublishState(options.wikiRoot) : emptyVectorPublishState();
  const pendingPages = pages.filter((page) => {
    const previous = vectorState.pages[page.path];
    return !previous || previous.hash !== page.hash;
  });
  const skipped = Math.max(0, pages.length - pendingPages.length);
  const records: Array<{ page: WikiVectorPageInput; record: VectorUpsertRecord }> = [];
  const errorSamples: string[] = [];
  let errors = 0;

  await runWithConcurrency(pendingPages, EMBEDDING_CONCURRENCY, async (page) => {
    const embedded = await embedText(`${page.title}\n${page.content.slice(0, 6000)}`);
    if (!embedded.ok) {
      errors += 1;
      if (errorSamples.length < 8) {
        errorSamples.push(embedded.error.message);
      }
      return;
    }
    records.push({
      page,
      record: {
        id: vectorIdForPath(page.path),
        values: embedded.data,
        metadata: {
          path: page.path,
          title: page.title,
          hash: page.hash,
          publishedAt: page.publishedAt,
          excerpt: page.content.replace(/\s+/g, " ").trim().slice(0, 300),
        },
      },
    });
  });

  const mutationIds: string[] = [];
  const nextState: VectorPublishStateFile = {
    version: 1,
    pages: Object.fromEntries(
      pages
        .map((page) => [page.path, vectorState.pages[page.path]])
        .filter((entry): entry is [string, VectorPublishStateEntry] => Boolean(entry[1])),
    ),
  };

  for (const batch of chunk(records, 200)) {
    const uploaded = await upsertVectorBatch(cfg.accountId, cfg.apiToken, indexName, batch.map((item) => item.record));
    if (!uploaded.ok) {
      errors += batch.length;
      if (errorSamples.length < 8) {
        errorSamples.push(uploaded.error.message);
      }
      continue;
    }
    if (uploaded.data) {
      mutationIds.push(uploaded.data);
    }
    for (const item of batch) {
      nextState.pages[item.page.path] = {
        hash: item.page.hash,
        vectorId: item.record.id,
        updatedAt: item.page.publishedAt,
      };
    }
  }

  if (options.wikiRoot) {
    writeVectorPublishState(options.wikiRoot, nextState);
  }

  return {
    ok: true,
    data: {
      upserted: records.length,
      skipped,
      errors,
      mutationIds,
      errorSamples,
    },
  };
}

function normalizeMatches(payload: unknown): VectorSearchMatch[] {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const result = record.result && typeof record.result === "object"
    ? record.result as Record<string, unknown>
    : {};
  const raw = Array.isArray(record.matches) ? record.matches : result.matches;
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => normalizeMatch(item)).filter((item): item is VectorSearchMatch => Boolean(item));
}

function normalizeMatch(value: unknown): VectorSearchMatch | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const id = typeof item.id === "string" ? item.id : "";
  const score = typeof item.score === "number" ? item.score : 0;
  if (!id) return null;
  return {
    id,
    score,
    metadata: item.metadata && typeof item.metadata === "object"
      ? item.metadata as Record<string, unknown>
      : undefined,
  };
}

/** Send the NDJSON upsert request to the Cloudflare Vectorize API. */
async function postUpsertRequest(
  endpoint: string,
  apiToken: string,
  body: string,
): Promise<CloudflareClientResult<Response>> {
  try {
    const response = await fetchWithOptionalProxy(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "content-type": "application/x-ndjson",
      },
      body,
    });
    return { ok: true, data: response };
  } catch (error) {
    return fail("cloudflare-network-error", error instanceof Error ? error.message : String(error), endpoint);
  }
}

/** Parse the JSON response body from a Vectorize upsert call. */
function parseUpsertResponseBody(
  text: string,
  endpoint: string,
  status: number,
): CloudflareClientResult<string | null> {
  try {
    const parsed = text ? JSON.parse(text) as Record<string, unknown> : {};
    const result = parsed.result && typeof parsed.result === "object"
      ? parsed.result as Record<string, unknown>
      : {};
    return { ok: true, data: typeof result.mutationId === "string" ? result.mutationId : null };
  } catch (error) {
    return fail("cloudflare-invalid-json", error instanceof Error ? error.message : String(error), endpoint, status);
  }
}

/** Upsert a single batch of vector records to the Cloudflare Vectorize index. */
async function upsertVectorBatch(
  accountId: string,
  apiToken: string,
  indexName: string,
  batch: VectorUpsertRecord[],
): Promise<CloudflareClientResult<string | null>> {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/vectorize/v2/indexes/${indexName}/upsert?unparsable-behavior=error`;
  const body = `${batch.map((item) => JSON.stringify(item)).join("\n")}\n`;

  const requestResult = await postUpsertRequest(endpoint, apiToken, body);
  if (!requestResult.ok) return requestResult;

  const text = await requestResult.data.text();
  if (!requestResult.data.ok) {
    return fail("cloudflare-http-error", text || requestResult.data.statusText, endpoint, requestResult.data.status);
  }

  return parseUpsertResponseBody(text, endpoint, requestResult.data.status);
}

function vectorIdForPath(pagePath: string): string {
  return crypto.createHash("sha256").update(pagePath).digest("hex").slice(0, 32);
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let cursor = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const current = items[cursor];
      cursor += 1;
      await worker(current);
    }
  });
  await Promise.all(lanes);
}

function normalizeOptional(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
}

function readVectorPublishState(wikiRoot: string): VectorPublishStateFile {
  const filePath = getVectorPublishStatePath(wikiRoot);
  if (!fs.existsSync(filePath)) {
    return emptyVectorPublishState();
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<VectorPublishStateFile>;
    const pages = parsed.pages && typeof parsed.pages === "object"
      ? Object.fromEntries(
        Object.entries(parsed.pages).flatMap(([pagePath, value]) => {
          if (!value || typeof value !== "object") return [];
          const entry = value as Partial<VectorPublishStateEntry>;
          if (typeof entry.hash !== "string" || entry.hash.length === 0) return [];
          return [[pagePath, {
            hash: entry.hash,
            vectorId: typeof entry.vectorId === "string" ? entry.vectorId : vectorIdForPath(pagePath),
            updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : "",
          }]];
        }),
      )
      : {};
    return {
      version: 1,
      pages,
    };
  } catch {
    return emptyVectorPublishState();
  }
}

function writeVectorPublishState(wikiRoot: string, state: VectorPublishStateFile): void {
  const filePath = getVectorPublishStatePath(wikiRoot);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function getVectorPublishStatePath(wikiRoot: string): string {
  return path.join(wikiRoot, VECTOR_PUBLISH_STATE_FILE);
}

function emptyVectorPublishState(): VectorPublishStateFile {
  return {
    version: 1,
    pages: {},
  };
}

function fail(
  type: CloudflareClientError["type"],
  message: string,
  endpoint: string,
  status?: number,
): CloudflareClientResult<never> {
  return { ok: false, error: { type, message, endpoint, status } };
}
