/**
 * Cloudflare web search HTTP client.
 *
 * Normalizes Worker/search endpoint responses into title/url/snippet objects
 * without exposing any configured authentication tokens.
 */

import { readCloudflareServicesConfig } from "../utils/cloudflare-services-config.js";
import {
  postJson,
  postWorkerJson,
  type CloudflareClientResult,
} from "../utils/cloudflare-http.js";

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export async function searchWeb(
  query: string,
  limit = 5,
): Promise<CloudflareClientResult<WebSearchResult[]>> {
  const cfg = readCloudflareServicesConfig();
  const result = cfg.searchEndpoint
    ? await postExternalSearchJson(cfg.searchEndpoint, query, limit, cfg.searchModel, cfg.searchToken ?? cfg.remoteToken)
    : await postWorkerJson<unknown>(cfg, "search", buildGenericPayload(query, limit, cfg.searchModel));
  if (!result.ok) return result;
  return { ok: true, data: normalizeResults(result.data) };
}

export async function searchWebExternal(
  query: string,
  limit = 5,
): Promise<CloudflareClientResult<WebSearchResult[]>> {
  const cfg = readCloudflareServicesConfig();
  if (!cfg.searchEndpoint) {
    return {
      ok: false,
      error: {
        type: "cloudflare-unconfigured",
        message: "Missing CLOUDFLARE_SEARCH_ENDPOINT",
      },
    };
  }
  const result = await postExternalSearchJson(
    cfg.searchEndpoint,
    query,
    limit,
    cfg.searchModel,
    cfg.searchToken ?? cfg.remoteToken,
  );
  if (!result.ok) return result;
  return { ok: true, data: normalizeResults(result.data) };
}

function authHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function postExternalSearchJson(
  endpoint: string,
  query: string,
  limit: number,
  model: string | null,
  token: string | null,
): Promise<CloudflareClientResult<unknown>> {
  const request = buildExternalSearchRequest(endpoint, query, limit, model);
  return postJson<unknown>(request.endpoint, request.payload, authHeaders(token));
}

function buildExternalSearchRequest(
  endpoint: string,
  query: string,
  limit: number,
  model: string | null,
): {
  endpoint: string;
  payload: Record<string, unknown>;
} {
  if (isTavilyEndpoint(endpoint)) {
    return {
      endpoint: withTavilySearchPath(endpoint),
      payload: {
        query,
        max_results: limit,
        search_depth: "advanced",
        include_answer: false,
        include_raw_content: true,
      },
    };
  }
  return { endpoint, payload: buildGenericPayload(query, limit, model) };
}

function buildGenericPayload(query: string, limit: number, model: string | null): {
  query: string;
  limit: number;
  model?: string;
} {
  return model ? { query, limit, model } : { query, limit };
}

function isTavilyEndpoint(endpoint: string): boolean {
  try {
    return new URL(endpoint).host.toLowerCase() === "api.tavily.com";
  } catch {
    return false;
  }
}

function withTavilySearchPath(endpoint: string): string {
  const url = new URL(endpoint);
  if (url.pathname === "/" || url.pathname === "") {
    url.pathname = "/search";
  }
  return url.toString();
}

function normalizeResults(payload: unknown): WebSearchResult[] {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const result = record.result && typeof record.result === "object"
    ? record.result as Record<string, unknown>
    : {};
  const raw = Array.isArray(record.results) ? record.results : result.results;
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => normalizeResult(item)).filter((item): item is WebSearchResult => Boolean(item));
}

function normalizeResult(value: unknown): WebSearchResult | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const title = typeof item.title === "string" ? item.title : "";
  const url = typeof item.url === "string" ? item.url : "";
  const snippet = firstString(item.raw_content, item.content, item.snippet, item.description);
  if (!title || !url) return null;
  return { title, url, snippet };
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string") return value;
  }
  return "";
}
