/**
 * Registers and implements the WebUI unified search routes.
 */
import type { Express, Request, Response } from "express";
import type { ServerConfig } from "../config.js";
import { getSearchStatus, searchAll, type SearchScope } from "../services/search-orchestrator.js";
import { readSearchProviderConfig, saveSearchProviderConfig } from "../services/search-config.js";
import { rebuildLocalVectorIndex, readLocalVectorIndexStatus, testLocalVectorEmbedding } from "../services/local-vector-search.js";
import { readLocalVectorConfigView, saveLocalVectorConfig } from "../services/search-vector-config.js";
import { listEmbeddingServices } from "../services/embedding-service-discovery.js";
import {
  readLocalEmbeddingServiceStatus,
  startLocalEmbeddingService,
  stopLocalEmbeddingService,
} from "../services/local-embedding-process.js";
import { loadSearchIndex } from "../services/search-index.js";
import { runSearchBenchmark } from "../services/search-benchmark.js";
import type { SearchMode } from "../services/search-router.js";

export function registerSearchRoutes(app: Express, cfg: ServerConfig) {
  app.get("/api/search", handleSearch(cfg));
  app.get("/api/search/status", handleSearchStatus());
  app.get("/api/search/config", handleSearchConfig(cfg));
  app.get("/api/search/vector-config", handleVectorConfig());
  app.get("/api/search/embedding-services", handleEmbeddingServices());
  app.get("/api/search/local-embedding/status", handleLocalEmbeddingStatus());
  app.get("/api/search/vector-status", handleVectorStatus(cfg));
  const maybePut = (app as Express & { put?: Express["put"] }).put;
  maybePut?.call(app, "/api/search/config", handleSearchConfigSave(cfg));
  maybePut?.call(app, "/api/search/vector-config", handleVectorConfigSave(cfg));
  const maybePost = (app as Express & { post?: Express["post"] }).post;
  maybePost?.call(app, "/api/search/test", handleSearchTest(cfg));
  maybePost?.call(app, "/api/search/vector-test", handleVectorTest());
  maybePost?.call(app, "/api/search/local-embedding/start", handleLocalEmbeddingStart(cfg));
  maybePost?.call(app, "/api/search/local-embedding/stop", handleLocalEmbeddingStop());
  maybePost?.call(app, "/api/search/vector-rebuild", handleVectorRebuild(cfg));
  maybePost?.call(app, "/api/search/benchmark", handleSearchBenchmark(cfg));
}

function handleSearch(cfg: ServerConfig) {
  return async (req: Request, res: Response) => {
    const query = typeof req.query.q === "string" ? req.query.q : "";
    const mode = normalizeMode(req.query.mode);
    const scope = normalizeScope(req.query.scope);
    const data = await searchAll(cfg, query, { scope, mode });
    res.json({ success: true, data });
  };
}

function handleSearchStatus() {
  return (_req: Request, res: Response) => {
    res.json({ success: true, data: getSearchStatus() });
  };
}

function handleSearchConfig(cfg: ServerConfig) {
  return (_req: Request, res: Response) => {
    res.json({ success: true, data: readSearchProviderConfig(cfg.projectRoot) });
  };
}

function handleSearchConfigSave(cfg: ServerConfig) {
  return (req: Request, res: Response) => {
    try {
      const data = saveSearchProviderConfig(cfg.projectRoot, req.body ?? {});
      res.json({ success: true, data });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}

function handleVectorConfig() {
  return (_req: Request, res: Response) => {
    res.json({ success: true, data: readLocalVectorConfigView() });
  };
}

function handleEmbeddingServices() {
  return async (_req: Request, res: Response) => {
    res.json({ success: true, data: { services: await listEmbeddingServices() } });
  };
}

function handleLocalEmbeddingStatus() {
  return (_req: Request, res: Response) => {
    res.json({ success: true, data: readLocalEmbeddingServiceStatus() });
  };
}

function handleLocalEmbeddingStart(cfg: ServerConfig) {
  return (_req: Request, res: Response) => {
    try {
      res.json({ success: true, data: startLocalEmbeddingService(cfg.projectRoot) });
    } catch (error) {
      res.status(400).json({ success: false, error: errorMessage(error) });
    }
  };
}

function handleLocalEmbeddingStop() {
  return (_req: Request, res: Response) => {
    res.json({ success: true, data: stopLocalEmbeddingService() });
  };
}

function handleVectorConfigSave(cfg: ServerConfig) {
  return (req: Request, res: Response) => {
    try {
      res.json({ success: true, data: saveLocalVectorConfig(cfg.projectRoot, req.body ?? {}) });
    } catch (error) {
      res.status(400).json({ success: false, error: errorMessage(error) });
    }
  };
}

function handleVectorTest() {
  return async (_req: Request, res: Response) => {
    try {
      const ok = await testLocalVectorEmbedding();
      res.json({ success: true, data: { ok, message: describeVectorTest(ok) } });
    } catch (error) {
      res.json({ success: true, data: { ok: false, message: errorMessage(error) } });
    }
  };
}

function handleVectorStatus(cfg: ServerConfig) {
  return async (_req: Request, res: Response) => {
    res.json({ success: true, data: await readLocalVectorIndexStatus(cfg) });
  };
}

function handleVectorRebuild(cfg: ServerConfig) {
  return async (_req: Request, res: Response) => {
    try {
      res.json({ success: true, data: await rebuildLocalVectorIndex(cfg, loadSearchIndex(cfg)) });
    } catch (error) {
      res.status(400).json({ success: false, error: errorMessage(error) });
    }
  };
}

function handleSearchBenchmark(cfg: ServerConfig) {
  return (_req: Request, res: Response) => {
    try {
      res.json({ success: true, data: runSearchBenchmark(cfg) });
    } catch (error) {
      res.status(400).json({ success: false, error: errorMessage(error) });
    }
  };
}

function handleSearchTest(cfg: ServerConfig) {
  return async (_req: Request, res: Response) => {
    const status = getSearchStatus();
    if (!status.web.configured) {
      res.json({
        success: true,
        data: {
          ok: false,
          message: "\u672a\u914d\u7f6e\u7f51\u7edc\u641c\u7d22 endpoint\u3002",
        },
      });
      return;
    }
    const data = await searchAll(cfg, "LLM Wiki connectivity test", {
      scope: "web",
      mode: "keyword",
      webLimit: 1,
    });
    res.json({
      success: true,
      data: {
        ok: data.web.ok,
        message: describeSearchTestResult(data.web),
      },
    });
  };
}

function describeSearchTestResult(data: {
  ok: boolean;
  error: string | null;
  results: unknown[];
}): string {
  if (!data.ok) {
    return data.error ?? "\u7f51\u7edc\u641c\u7d22 API \u6d4b\u8bd5\u5931\u8d25\u3002";
  }
  return data.results.length > 0
    ? "\u7f51\u7edc\u641c\u7d22 API \u53ef\u7528\u3002"
    : "\u7f51\u7edc\u641c\u7d22 API \u5df2\u8fde\u63a5\uff0c\u4f46\u6d4b\u8bd5\u6ca1\u6709\u8fd4\u56de\u7ed3\u679c\u3002";
}

function describeVectorTest(ok: boolean): string {
  return ok
    ? "本地向量检索 embedding endpoint 可用。"
    : "本地向量检索未启用，或 endpoint/model 未配置完整。";
}

function normalizeMode(input: unknown): SearchMode {
  return input === "direct" || input === "hybrid" ? input : "keyword";
}

function normalizeScope(input: unknown): SearchScope {
  return input === "web" || input === "all" ? input : "local";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
