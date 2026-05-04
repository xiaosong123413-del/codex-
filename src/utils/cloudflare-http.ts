/**
 * Minimal HTTP helpers for Cloudflare service adapters.
 *
 * Keeps authentication handling in one server-only module and returns compact,
 * structured errors without including token values.
 */

import {
  ensureTrailingSlash,
  type CloudflareServicesConfig,
} from "./cloudflare-services-config.js";
import { fetchWithOptionalProxy } from "./proxy-fetch.js";

export interface CloudflareClientError {
  type: string;
  message: string;
  status?: number;
  endpoint?: string;
}

export type CloudflareClientResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: CloudflareClientError };

export async function postWorkerJson<T>(
  cfg: CloudflareServicesConfig,
  path: string,
  payload: unknown,
): Promise<CloudflareClientResult<T>> {
  if (!cfg.workerUrl || !cfg.remoteToken) {
    return missingConfig("Missing CLOUDFLARE_WORKER_URL or CLOUDFLARE_REMOTE_TOKEN");
  }
  return postJson<T>(joinUrl(cfg.workerUrl, path), payload, {
    Authorization: `Bearer ${cfg.remoteToken}`,
  });
}

export async function postCloudflareAiRun<T>(
  cfg: CloudflareServicesConfig,
  model: string | null,
  payload: unknown,
): Promise<CloudflareClientResult<T>> {
  if (!cfg.accountId || !cfg.apiToken || !model) {
    return missingConfig("Missing CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, or model");
  }
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${cfg.accountId}/ai/run/${model}`;
  return postJson<T>(endpoint, payload, {
    Authorization: `Bearer ${cfg.apiToken}`,
  });
}

export async function postJson<T>(
  endpoint: string,
  payload: unknown,
  headers: Record<string, string> = {},
): Promise<CloudflareClientResult<T>> {
  let response: Response;
  try {
    response = await fetchWithOptionalProxy(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    return {
      ok: false,
      error: { type: "cloudflare-network-error", message: errorMessage(error), endpoint },
    };
  }
  return parseJsonResponse<T>(response, endpoint);
}

export function extractTextResponse(payload: unknown): string {
  if (typeof payload === "string") return payload;
  const record = asRecord(payload);
  const result = asRecord(record.result);
  const choiceText = firstChoiceText(record) || firstChoiceText(result);
  return firstString(
    record.text,
    record.response,
    record.output,
    choiceText,
    result.text,
    result.response,
    result.output,
  );
}

export function extractVectorResponse(payload: unknown): number[] {
  const record = asRecord(payload);
  const result = asRecord(record.result);
  const vectors = [record.vector, record.embedding, result.vector, result.embedding, result.data];
  for (const value of vectors) {
    if (isNumberArray(value)) return value;
    if (Array.isArray(value) && isNumberArray(value[0])) return value[0];
  }
  return [];
}

function joinUrl(base: string, path: string): string {
  return new URL(path.replace(/^\/+/, ""), ensureTrailingSlash(base)).toString();
}

async function parseJsonResponse<T>(
  response: Response,
  endpoint: string,
): Promise<CloudflareClientResult<T>> {
  const text = await response.text();
  if (!response.ok) {
    return {
      ok: false,
      error: {
        type: "cloudflare-http-error",
        message: text || response.statusText,
        status: response.status,
        endpoint,
      },
    };
  }
  return { ok: true, data: (text ? JSON.parse(text) : {}) as T };
}

function missingConfig(message: string): CloudflareClientResult<never> {
  return { ok: false, error: { type: "cloudflare-unconfigured", message } };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "";
}

function firstChoiceText(record: Record<string, unknown>): string {
  const choices = record.choices;
  if (!Array.isArray(choices)) {
    return "";
  }
  const first = asRecord(choices[0]);
  const message = asRecord(first.message);
  const delta = asRecord(first.delta);
  return readContentText(message.content) || readContentText(delta.content) || firstString(first.text);
}

function readContentText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (!Array.isArray(value)) {
    return "";
  }
  return value.map(readContentPartText).filter(Boolean).join("");
}

function readContentPartText(value: unknown): string {
  const record = asRecord(value);
  return firstString(record.text);
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface CloudflareStreamChunk {
  choices?: { delta?: { content?: string; tool_calls?: unknown[] } }[];
  result?: { response?: string };
}

/** Post a JSON payload and return an async iterable of SSE stream chunks. */
export async function postJsonStream(
  endpoint: string,
  payload: unknown,
  headers: Record<string, string> = {},
): Promise<AsyncGenerator<CloudflareStreamChunk>> {
  const response = await fetchWithOptionalProxy(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify({ ...(payload as Record<string, unknown>), stream: true }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Cloudflare stream failed: HTTP ${response.status} - ${text}`);
  }
  return readSSEChunks(response);
}

async function* readSSEChunks(response: Response): AsyncGenerator<CloudflareStreamChunk> {
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parsed = parseSSEBuffer(buffer);
      buffer = parsed.remainder;
      for (const chunk of parsed.chunks) {
        yield chunk;
      }
      if (parsed.done) {
        return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseSSEBuffer(buffer: string): {
  chunks: CloudflareStreamChunk[];
  done: boolean;
  remainder: string;
} {
  const lines = buffer.split("\n");
  const remainder = lines.pop() ?? "";
  const chunks: CloudflareStreamChunk[] = [];
  let done = false;
  for (const line of lines) {
    const parsed = parseSSELine(line);
    if (parsed === "done") {
      done = true;
      break;
    }
    if (parsed) chunks.push(parsed);
  }
  return { chunks, done, remainder };
}

function parseSSELine(line: string): CloudflareStreamChunk | "done" | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(":")) return null;
  const data = trimmed.startsWith("data: ") ? trimmed.slice(6) : trimmed;
  if (data === "[DONE]") return "done";
  try {
    return JSON.parse(data) as CloudflareStreamChunk;
  } catch {
    return null;
  }
}
