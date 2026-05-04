/**
 * Coordinates local wiki search and configured external web search.
 *
 * The web bucket keeps transport success separate from result count so empty
 * searches do not look like provider failures.
 */
import { searchWebExternal, type WebSearchResult } from "../../../src/services/cloudflare-web-search.js";
import { readCloudflareServicesConfig } from "../../../src/utils/cloudflare-services-config.js";
import type { ServerConfig } from "../config.js";
import { runSearch, type SearchMode, type SearchResponse } from "./search-router.js";
import { readLocalVectorConfigView } from "./search-vector-config.js";

export type SearchScope = "local" | "web" | "all";

interface SearchAllOptions {
  scope?: SearchScope;
  mode?: SearchMode;
  webLimit?: number;
}

interface SearchAllResponse {
  scope: SearchScope;
  mode: SearchMode;
  local: SearchResponse;
  web: {
    configured: boolean;
    ok: boolean;
    error: string | null;
    results: WebSearchResult[];
  };
}

interface SearchStatusResponse {
  local: {
    configured: boolean;
  };
  web: {
    configured: boolean;
    endpointHost: string | null;
  };
  vector: {
    enabled: boolean;
    configured: boolean;
    endpointHost: string | null;
    model: string;
  };
}

export function getSearchStatus(): SearchStatusResponse {
  const cfg = readCloudflareServicesConfig();
  const vector = readLocalVectorConfigView();
  return {
    local: { configured: true },
    web: {
      configured: Boolean(cfg.searchEndpoint),
      endpointHost: cfg.searchEndpoint ? readHost(cfg.searchEndpoint) : null,
    },
    vector: {
      enabled: vector.enabled,
      configured: Boolean(vector.endpoint && vector.model),
      endpointHost: vector.endpoint ? readHost(vector.endpoint) : null,
      model: vector.model,
    },
  };
}

export async function searchAll(
  cfg: ServerConfig | undefined,
  query: string,
  options: SearchAllOptions = {},
): Promise<SearchAllResponse> {
  const scope = normalizeScope(options.scope);
  const mode = normalizeMode(options.mode);
  const webLimit = normalizeWebLimit(options.webLimit);

  const [local, web] = await Promise.all([
    scope === "local" || scope === "all"
      ? runSearch(cfg, query, mode)
      : Promise.resolve<SearchResponse>({ mode, results: [] }),
    scope === "web" || scope === "all"
      ? runWebSearch(query, webLimit)
      : Promise.resolve(emptyWebSearchBucket(false)),
  ]);

  return {
    scope,
    mode: local.mode,
    local,
    web,
  };
}

async function runWebSearch(query: string, limit: number): Promise<SearchAllResponse["web"]> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return emptyWebSearchBucket(true, true);
  }
  try {
    const result = await searchWebExternal(normalizedQuery, limit);
    if (result.ok) {
      return { configured: true, ok: true, error: null, results: result.data };
    }
    return {
      configured: result.error.type !== "cloudflare-unconfigured",
      ok: false,
      error: result.error.message,
      results: [],
    };
  } catch (error) {
    return { configured: true, ok: false, error: errorMessage(error), results: [] };
  }
}

function emptyWebSearchBucket(configured: boolean, ok = false): SearchAllResponse["web"] {
  return { configured, ok, error: null, results: [] };
}

function normalizeScope(value: SearchScope | undefined): SearchScope {
  return value === "web" || value === "all" ? value : "local";
}

function normalizeMode(value: SearchMode | undefined): SearchMode {
  return value === "direct" || value === "hybrid" ? value : "keyword";
}

function normalizeWebLimit(value: number | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 5;
  }
  return Math.max(1, Math.min(10, Math.trunc(value)));
}

function readHost(value: string): string | null {
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
