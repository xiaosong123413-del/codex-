/**
 * Local LanceDB vector search configuration.
 *
 * The legacy app kept embedding settings separate from the chat model. The
 * WebUI mirrors that with dedicated environment variables and keeps vector
 * retrieval disabled until explicitly enabled.
 */

import { assignEnvValue, updateEnvFile } from "./env-file.js";

export interface LocalVectorConfig {
  enabled: boolean;
  source: EmbeddingSource;
  endpoint: string;
  apiKey: string;
  model: string;
  maxChunkChars: number;
  overlapChunkChars: number;
}

export type EmbeddingSource = "api" | "local";

interface LocalVectorConfigView {
  enabled: boolean;
  source: EmbeddingSource;
  endpoint: string;
  apiKeyConfigured: boolean;
  model: string;
  maxChunkChars: number;
  overlapChunkChars: number;
}

interface LocalVectorConfigInput {
  enabled?: unknown;
  source?: unknown;
  endpoint?: unknown;
  apiKey?: unknown;
  model?: unknown;
  maxChunkChars?: unknown;
  overlapChunkChars?: unknown;
}

const ENABLED_ENV = "LLMWIKI_VECTOR_SEARCH_ENABLED";
const SOURCE_ENV = "LLMWIKI_EMBEDDING_SOURCE";
const ENDPOINT_ENV = "LLMWIKI_EMBEDDING_ENDPOINT";
const API_KEY_ENV = "LLMWIKI_EMBEDDING_API_KEY";
const MODEL_ENV = "LLMWIKI_EMBEDDING_MODEL";
const MAX_CHUNK_ENV = "LLMWIKI_EMBEDDING_MAX_CHUNK_CHARS";
const OVERLAP_ENV = "LLMWIKI_EMBEDDING_OVERLAP_CHARS";

/** Reads independent OpenAI-compatible embedding settings for local vectors. */
export function readLocalVectorConfig(env: NodeJS.ProcessEnv = process.env): LocalVectorConfig {
  const endpoint = normalizeText(env[ENDPOINT_ENV]) ?? "";
  const model = normalizeText(env[MODEL_ENV]) ?? "";
  return {
    enabled: normalizeFlag(env[ENABLED_ENV]) && Boolean(endpoint && model),
    source: normalizeSource(env[SOURCE_ENV]),
    endpoint,
    apiKey: normalizeText(env[API_KEY_ENV]) ?? "",
    model,
    maxChunkChars: normalizePositiveInt(env[MAX_CHUNK_ENV], 1000),
    overlapChunkChars: normalizePositiveInt(env[OVERLAP_ENV], 200),
  };
}

/** Returns the redacted vector-search config used by the settings UI. */
export function readLocalVectorConfigView(env: NodeJS.ProcessEnv = process.env): LocalVectorConfigView {
  const cfg = readLocalVectorConfig(env);
  return {
    enabled: cfg.enabled,
    source: cfg.source,
    endpoint: cfg.endpoint,
    apiKeyConfigured: Boolean(cfg.apiKey),
    model: cfg.model,
    maxChunkChars: cfg.maxChunkChars,
    overlapChunkChars: cfg.overlapChunkChars,
  };
}

/** Saves independent embedding settings into the project `.env` file. */
export function saveLocalVectorConfig(
  projectRoot: string,
  input: LocalVectorConfigInput,
  env: NodeJS.ProcessEnv = process.env,
): LocalVectorConfigView {
  const values = normalizeConfigInput(input);
  updateEnvFile(projectRoot, values);
  for (const [key, value] of Object.entries(values)) {
    assignEnvValue(env, key, value);
  }
  return readLocalVectorConfigView(env);
}

function normalizeConfigInput(input: LocalVectorConfigInput): Record<string, string | null> {
  const endpoint = normalizeEndpoint(input.endpoint);
  const model = normalizeText(input.model);
  const maxChunkChars = normalizeBoundedInt(input.maxChunkChars, 1000, 200, 8000);
  const overlapChunkChars = normalizeBoundedInt(input.overlapChunkChars, 200, 0, maxChunkChars - 1);
  return {
    [ENABLED_ENV]: normalizeEnabledInput(input.enabled) ? "true" : null,
    [SOURCE_ENV]: normalizeSource(input.source),
    [ENDPOINT_ENV]: endpoint,
    [API_KEY_ENV]: normalizeText(input.apiKey),
    [MODEL_ENV]: model,
    [MAX_CHUNK_ENV]: String(maxChunkChars),
    [OVERLAP_ENV]: String(overlapChunkChars),
  };
}

function normalizeFlag(value: unknown): boolean {
  const text = String(value ?? "").trim().toLowerCase();
  return text === "1" || text === "true" || text === "yes" || text === "on";
}

function normalizeSource(value: unknown): EmbeddingSource {
  return value === "local" ? "local" : "api";
}

function normalizeText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
}

function normalizeEndpoint(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  try {
    return normalizeEmbeddingUrl(new URL(text), text).toString();
  } catch {
    throw new Error("Embedding endpoint 必须是完整 URL。");
  }
}

function normalizeEmbeddingUrl(url: URL, rawText: string): URL {
  const normalized = new URL(url.toString());
  const pathname = normalized.pathname.replace(/\/+$/, "");
  if (!pathname || rawText.endsWith("/")) {
    normalized.pathname = "/v1/embeddings";
    return normalized;
  }
  if (pathname === "/v1") {
    normalized.pathname = `${pathname}/embeddings`;
  }
  return normalized;
}

function normalizePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeBoundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = normalizePositiveInt(value, fallback);
  return Math.max(min, Math.min(max, parsed));
}

function normalizeEnabledInput(value: unknown): boolean {
  return value === true || normalizeFlag(value);
}
