import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerSearchRoutes } from "../web/server/routes/search.js";

const { getSearchStatus, readSearchProviderConfig, saveSearchProviderConfig, searchAll } = vi.hoisted(() => ({
  getSearchStatus: vi.fn(),
  readSearchProviderConfig: vi.fn(),
  saveSearchProviderConfig: vi.fn(),
  searchAll: vi.fn(),
}));

const {
  readLocalVectorConfigView,
  saveLocalVectorConfig,
  listEmbeddingServices,
  testLocalVectorEmbedding,
  readLocalVectorIndexStatus,
  rebuildLocalVectorIndex,
  runSearchBenchmark,
  readLocalEmbeddingServiceStatus,
  startLocalEmbeddingService,
  stopLocalEmbeddingService,
} = vi.hoisted(() => ({
  readLocalVectorConfigView: vi.fn(),
  saveLocalVectorConfig: vi.fn(),
  listEmbeddingServices: vi.fn(),
  testLocalVectorEmbedding: vi.fn(),
  readLocalVectorIndexStatus: vi.fn(),
  rebuildLocalVectorIndex: vi.fn(),
  runSearchBenchmark: vi.fn(),
  readLocalEmbeddingServiceStatus: vi.fn(),
  startLocalEmbeddingService: vi.fn(),
  stopLocalEmbeddingService: vi.fn(),
}));

vi.mock("../web/server/services/search-config.js", () => ({
  readSearchProviderConfig,
  saveSearchProviderConfig,
}));

vi.mock("../web/server/services/search-orchestrator.js", () => ({
  getSearchStatus,
  searchAll,
}));

vi.mock("../web/server/services/search-vector-config.js", () => ({
  readLocalVectorConfigView,
  saveLocalVectorConfig,
}));

vi.mock("../web/server/services/embedding-service-discovery.js", () => ({
  listEmbeddingServices,
}));

vi.mock("../web/server/services/local-vector-search.js", () => ({
  testLocalVectorEmbedding,
  readLocalVectorIndexStatus,
  rebuildLocalVectorIndex,
}));

vi.mock("../web/server/services/search-benchmark.js", () => ({
  runSearchBenchmark,
}));

vi.mock("../web/server/services/local-embedding-process.js", () => ({
  readLocalEmbeddingServiceStatus,
  startLocalEmbeddingService,
  stopLocalEmbeddingService,
}));

describe("search routes", () => {
  beforeEach(() => {
    getSearchStatus.mockReset();
    getSearchStatus.mockReturnValue({
      local: { configured: true },
      web: { configured: false, endpointHost: null },
      vector: { enabled: false, configured: false, endpointHost: null, model: "" },
    });
    readSearchProviderConfig.mockReset();
    readSearchProviderConfig.mockReturnValue({
      url: "https://search.example.com/query/",
      keyConfigured: true,
      model: "provider/model",
    });
    saveSearchProviderConfig.mockReset();
    saveSearchProviderConfig.mockImplementation((_projectRoot: string, input: unknown) => ({
      url: typeof (input as { url?: unknown }).url === "string" ? (input as { url: string }).url : "",
      keyConfigured: Boolean((input as { key?: unknown }).key),
      model: typeof (input as { model?: unknown }).model === "string" ? (input as { model: string }).model : "",
    }));
    readLocalVectorConfigView.mockReset();
    readLocalVectorConfigView.mockReturnValue({
      enabled: false,
      source: "api",
      endpoint: "",
      apiKeyConfigured: false,
      model: "",
      maxChunkChars: 1000,
      overlapChunkChars: 200,
    });
    saveLocalVectorConfig.mockReset();
    saveLocalVectorConfig.mockImplementation((_projectRoot: string, input: unknown) => ({
      enabled: Boolean((input as { enabled?: unknown }).enabled),
      source: (input as { source?: unknown }).source === "local" ? "local" : "api",
      endpoint: typeof (input as { endpoint?: unknown }).endpoint === "string" ? (input as { endpoint: string }).endpoint : "",
      apiKeyConfigured: Boolean((input as { apiKey?: unknown }).apiKey),
      model: typeof (input as { model?: unknown }).model === "string" ? (input as { model: string }).model : "",
      maxChunkChars: 1000,
      overlapChunkChars: 200,
    }));
    testLocalVectorEmbedding.mockReset();
    testLocalVectorEmbedding.mockResolvedValue(true);
    listEmbeddingServices.mockReset();
    listEmbeddingServices.mockResolvedValue([
      {
        id: "local-qwen",
        name: "本机 Qwen embedding",
        source: "local",
        endpoint: "http://127.0.0.1:8011/v1/embeddings",
        model: "Qwen3-Embedding-8B",
        status: "unavailable",
        description: "local",
        managedByApp: true,
        managedRunning: false,
      },
    ]);
    readLocalEmbeddingServiceStatus.mockReset();
    readLocalEmbeddingServiceStatus.mockReturnValue({
      running: false,
      endpoint: "http://127.0.0.1:8011/v1/embeddings",
      model: "Qwen3-Embedding-8B",
      pid: null,
      message: "未启动",
    });
    startLocalEmbeddingService.mockReset();
    startLocalEmbeddingService.mockReturnValue({
      running: true,
      endpoint: "http://127.0.0.1:8011/v1/embeddings",
      model: "Qwen3-Embedding-8B",
      pid: 123,
      message: "正在启动",
    });
    stopLocalEmbeddingService.mockReset();
    stopLocalEmbeddingService.mockReturnValue({
      running: false,
      endpoint: "http://127.0.0.1:8011/v1/embeddings",
      model: "Qwen3-Embedding-8B",
      pid: null,
      message: "已停止",
    });
    readLocalVectorIndexStatus.mockReset();
    readLocalVectorIndexStatus.mockResolvedValue({
      enabled: false,
      configured: false,
      dbExists: false,
      tableExists: false,
      chunkCount: 0,
      pageCount: 0,
      sizeBytes: 0,
      updatedAt: null,
    });
    rebuildLocalVectorIndex.mockReset();
    rebuildLocalVectorIndex.mockResolvedValue({
      enabled: true,
      configured: true,
      dbExists: true,
      tableExists: true,
      chunkCount: 2,
      pageCount: 1,
      sizeBytes: 1024,
      updatedAt: "2026-05-02T00:00:00.000Z",
    });
    runSearchBenchmark.mockReset();
    runSearchBenchmark.mockReturnValue({
      queryCount: 1,
      documentCount: 1,
      k: 5,
      baseline: { precision: 0, recall: 0, mrr: 0, ndcg: 0 },
      current: { precision: 1, recall: 1, mrr: 1, ndcg: 1 },
    });
    searchAll.mockReset();
    searchAll.mockResolvedValue({
      scope: "local",
      mode: "keyword",
      local: {
        mode: "keyword",
        results: [],
      },
      web: {
        configured: false,
        ok: false,
        error: null,
        results: [],
      },
    });
  });

  it("registers GET /api/search and returns local results by default", async () => {
    const getRoutes: Array<{
      path: string;
      handler: (req: { query?: Record<string, string | undefined> }, res: { json: (body: unknown) => void }) => Promise<void> | void;
    }> = [];

    const app = {
      get(path: string, handler: (req: { query?: Record<string, string | undefined> }, res: { json: (body: unknown) => void }) => Promise<void> | void) {
        getRoutes.push({ path, handler });
        return app;
      },
      put() {
        return app;
      },
    };

    registerSearchRoutes(app as never, { wikiRoot: "wiki", port: 4175, host: "127.0.0.1", author: "me", projectRoot: "project" });

    expect(getRoutes).toHaveLength(7);
    expect(getRoutes[0]?.path).toBe("/api/search");

    const json = vi.fn();
    await getRoutes[0].handler({ query: { q: "redis", mode: "keyword" } }, { json });

    expect(searchAll).toHaveBeenCalledWith(
      expect.objectContaining({ wikiRoot: "wiki" }),
      "redis",
      {
        scope: "local",
        mode: "keyword",
      },
    );
    expect(json).toHaveBeenCalledWith({
      success: true,
      data: {
        scope: "local",
        mode: "keyword",
        local: {
          mode: "keyword",
          results: [],
        },
        web: {
          configured: false,
          ok: false,
          error: null,
          results: [],
        },
      },
    });
  });

  it("registers GET /api/search/status for visible provider state", () => {
    const getRoutes: Array<{
      path: string;
      handler: (req: { query?: Record<string, string | undefined> }, res: { json: (body: unknown) => void }) => Promise<void> | void;
    }> = [];

    const app = {
      get(path: string, handler: (req: { query?: Record<string, string | undefined> }, res: { json: (body: unknown) => void }) => Promise<void> | void) {
        getRoutes.push({ path, handler });
        return app;
      },
      put() {
        return app;
      },
    };

    registerSearchRoutes(app as never, { wikiRoot: "wiki", port: 4175, host: "127.0.0.1", author: "me", projectRoot: "project" });

    const json = vi.fn();
    getRoutes[1]?.handler({ query: {} }, { json });

    expect(getRoutes[1]?.path).toBe("/api/search/status");
    expect(json).toHaveBeenCalledWith({
      success: true,
      data: {
        local: { configured: true },
        web: { configured: false, endpointHost: null },
        vector: { enabled: false, configured: false, endpointHost: null, model: "" },
      },
    });
  });

  it("registers GET /api/search/config and returns the persisted provider config", () => {
    const getRoutes: Array<{
      path: string;
      handler: (req: { query?: Record<string, string | undefined> }, res: { json: (body: unknown) => void }) => Promise<void> | void;
    }> = [];

    const app = {
      get(path: string, handler: (req: { query?: Record<string, string | undefined> }, res: { json: (body: unknown) => void }) => Promise<void> | void) {
        getRoutes.push({ path, handler });
        return app;
      },
      put() {
        return app;
      },
    };

    registerSearchRoutes(app as never, { wikiRoot: "wiki", port: 4175, host: "127.0.0.1", author: "me", projectRoot: "project-root" });

    const json = vi.fn();
    getRoutes[2]?.handler({ query: {} }, { json });

    expect(getRoutes[2]?.path).toBe("/api/search/config");
    expect(readSearchProviderConfig).toHaveBeenCalledWith("project-root");
    expect(json).toHaveBeenCalledWith({
      success: true,
      data: {
        url: "https://search.example.com/query/",
        keyConfigured: true,
        model: "provider/model",
      },
    });
  });

  it("registers GET /api/search/vector-config for local vector settings", () => {
    const getRoutes: Array<{
      path: string;
      handler: (req: { query?: Record<string, string | undefined> }, res: { json: (body: unknown) => void }) => Promise<void> | void;
    }> = [];

    const app = {
      get(path: string, handler: (req: { query?: Record<string, string | undefined> }, res: { json: (body: unknown) => void }) => Promise<void> | void) {
        getRoutes.push({ path, handler });
        return app;
      },
      put() {
        return app;
      },
    };

    registerSearchRoutes(app as never, { wikiRoot: "wiki", port: 4175, host: "127.0.0.1", author: "me", projectRoot: "project-root" });

    const json = vi.fn();
    getRoutes[3]?.handler({ query: {} }, { json });

    expect(getRoutes[3]?.path).toBe("/api/search/vector-config");
    expect(json).toHaveBeenCalledWith({
      success: true,
      data: {
        enabled: false,
        source: "api",
        endpoint: "",
        apiKeyConfigured: false,
        model: "",
        maxChunkChars: 1000,
        overlapChunkChars: 200,
      },
    });
  });

  it("registers GET /api/search/embedding-services for selectable services", async () => {
    const getRoutes: Array<{
      path: string;
      handler: (req: { query?: Record<string, string | undefined> }, res: { json: (body: unknown) => void }) => Promise<void> | void;
    }> = [];

    const app = {
      get(path: string, handler: (req: { query?: Record<string, string | undefined> }, res: { json: (body: unknown) => void }) => Promise<void> | void) {
        getRoutes.push({ path, handler });
        return app;
      },
      put() {
        return app;
      },
    };

    registerSearchRoutes(app as never, { wikiRoot: "wiki", port: 4175, host: "127.0.0.1", author: "me", projectRoot: "project-root" });

    const json = vi.fn();
    await getRoutes[4]?.handler({ query: {} }, { json });

    expect(getRoutes[4]?.path).toBe("/api/search/embedding-services");
    expect(listEmbeddingServices).toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: {
        services: [
          expect.objectContaining({
            id: "local-qwen",
            name: "本机 Qwen embedding",
            source: "local",
            endpoint: "http://127.0.0.1:8011/v1/embeddings",
            model: "Qwen3-Embedding-8B",
            status: "unavailable",
            description: "local",
          }),
        ],
      },
    }));
  });

  it("registers local embedding service controls", async () => {
    const getRoutes: Array<{
      path: string;
      handler: (req: Record<string, never>, res: { json: (body: unknown) => void }) => Promise<void> | void;
    }> = [];
    const postRoutes: Array<{
      path: string;
      handler: (req: Record<string, never>, res: { json: (body: unknown) => void; status: (code: number) => { json: (body: unknown) => void } }) => Promise<void> | void;
    }> = [];
    const app = {
      get(path: string, handler: (req: Record<string, never>, res: { json: (body: unknown) => void }) => Promise<void> | void) {
        getRoutes.push({ path, handler });
        return app;
      },
      put() {
        return app;
      },
      post(
        path: string,
        handler: (req: Record<string, never>, res: { json: (body: unknown) => void; status: (code: number) => { json: (body: unknown) => void } }) => Promise<void> | void,
      ) {
        postRoutes.push({ path, handler });
        return app;
      },
    };

    registerSearchRoutes(app as never, { wikiRoot: "wiki", port: 4175, host: "127.0.0.1", author: "me", projectRoot: "project-root" });

    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    getRoutes[5]?.handler({}, { json });
    await postRoutes[2]?.handler({}, { json, status });

    expect(getRoutes[5]?.path).toBe("/api/search/local-embedding/status");
    expect(postRoutes[2]?.path).toBe("/api/search/local-embedding/start");
    expect(readLocalEmbeddingServiceStatus).toHaveBeenCalled();
    expect(startLocalEmbeddingService).toHaveBeenCalledWith("project-root");
    expect(status).not.toHaveBeenCalled();
  });

  it("registers PUT /api/search/config and saves the provider config", async () => {
    const putRoutes: Array<{
      path: string;
      handler: (req: { body?: unknown }, res: { json: (body: unknown) => void; status: (code: number) => { json: (body: unknown) => void } }) => Promise<void> | void;
    }> = [];

    const app = {
      get() {
        return app;
      },
      put(
        path: string,
        handler: (req: { body?: unknown }, res: { json: (body: unknown) => void; status: (code: number) => { json: (body: unknown) => void } }) => Promise<void> | void,
      ) {
        putRoutes.push({ path, handler });
        return app;
      },
    };

    registerSearchRoutes(app as never, { wikiRoot: "wiki", port: 4175, host: "127.0.0.1", author: "me", projectRoot: "project-root" });

    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    await putRoutes[0]?.handler(
      {
        body: {
          url: "https://search.example.com/live",
          key: "search-secret",
          model: "provider/search-model",
        },
      },
      { json, status },
    );

    expect(putRoutes[0]?.path).toBe("/api/search/config");
    expect(saveSearchProviderConfig).toHaveBeenCalledWith("project-root", {
      url: "https://search.example.com/live",
      key: "search-secret",
      model: "provider/search-model",
    });
    expect(json).toHaveBeenCalledWith({
      success: true,
      data: {
        url: "https://search.example.com/live",
        keyConfigured: true,
        model: "provider/search-model",
      },
    });
    expect(status).not.toHaveBeenCalled();
  });

  it("registers PUT /api/search/vector-config and saves local vector settings", async () => {
    const putRoutes: Array<{
      path: string;
      handler: (req: { body?: unknown }, res: { json: (body: unknown) => void; status: (code: number) => { json: (body: unknown) => void } }) => Promise<void> | void;
    }> = [];

    const app = {
      get() {
        return app;
      },
      put(
        path: string,
        handler: (req: { body?: unknown }, res: { json: (body: unknown) => void; status: (code: number) => { json: (body: unknown) => void } }) => Promise<void> | void,
      ) {
        putRoutes.push({ path, handler });
        return app;
      },
    };

    registerSearchRoutes(app as never, { wikiRoot: "wiki", port: 4175, host: "127.0.0.1", author: "me", projectRoot: "project-root" });

    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const body = {
      enabled: true,
      source: "local",
      endpoint: "https://embed.example.com/v1/embeddings",
      apiKey: "embed-secret",
      model: "text-embedding-test",
    };
    await putRoutes[1]?.handler({ body }, { json, status });

    expect(putRoutes[1]?.path).toBe("/api/search/vector-config");
    expect(saveLocalVectorConfig).toHaveBeenCalledWith("project-root", body);
    expect(json).toHaveBeenCalledWith({
      success: true,
      data: {
        enabled: true,
        source: "local",
        endpoint: "https://embed.example.com/v1/embeddings",
        apiKeyConfigured: true,
        model: "text-embedding-test",
        maxChunkChars: 1000,
        overlapChunkChars: 200,
      },
    });
    expect(status).not.toHaveBeenCalled();
  });

  it("supports scope=all and returns separate local and web buckets", async () => {
    searchAll.mockResolvedValue({
      scope: "all",
      mode: "hybrid",
      local: {
        mode: "hybrid",
        results: [{ id: "l1", title: "Redis", path: "wiki/concepts/redis.md", layer: "wiki", excerpt: "cache", tags: [], modifiedAt: null }],
      },
      web: {
        configured: true,
        ok: true,
        error: null,
        results: [{ title: "Redis Docs", url: "https://redis.io", snippet: "external" }],
      },
    });

    const getRoutes: Array<{
      path: string;
      handler: (req: { query?: Record<string, string | undefined> }, res: { json: (body: unknown) => void }) => Promise<void> | void;
    }> = [];
    const app = {
      get(path: string, handler: (req: { query?: Record<string, string | undefined> }, res: { json: (body: unknown) => void }) => Promise<void> | void) {
        getRoutes.push({ path, handler });
        return app;
      },
      put() {
        return app;
      },
    };

    registerSearchRoutes(app as never, { wikiRoot: "wiki", port: 4175, host: "127.0.0.1", author: "me", projectRoot: "project" });

    const json = vi.fn();
    await getRoutes[0].handler({ query: { q: "redis", mode: "hybrid", scope: "all" } }, { json });

    expect(searchAll).toHaveBeenCalledWith(
      expect.objectContaining({ wikiRoot: "wiki" }),
      "redis",
      {
        scope: "all",
        mode: "hybrid",
      },
    );
    expect(json).toHaveBeenCalledWith({
      success: true,
      data: {
        scope: "all",
        mode: "hybrid",
        local: {
          mode: "hybrid",
          results: [{ id: "l1", title: "Redis", path: "wiki/concepts/redis.md", layer: "wiki", excerpt: "cache", tags: [], modifiedAt: null }],
        },
        web: {
          configured: true,
          ok: true,
          error: null,
          results: [{ title: "Redis Docs", url: "https://redis.io", snippet: "external" }],
        },
      },
    });
  });

  it("treats an empty connected provider test as successful", async () => {
    getSearchStatus.mockReturnValue({
      local: { configured: true },
      web: { configured: true, endpointHost: "api.tavily.com" },
      vector: { enabled: false, configured: false, endpointHost: null, model: "" },
    });
    searchAll.mockResolvedValue({
      scope: "web",
      mode: "keyword",
      local: {
        mode: "keyword",
        results: [],
      },
      web: {
        configured: true,
        ok: true,
        error: null,
        results: [],
      },
    });

    const postRoutes: Array<{
      path: string;
      handler: (req: Record<string, never>, res: { json: (body: unknown) => void }) => Promise<void> | void;
    }> = [];
    const app = {
      get() {
        return app;
      },
      put() {
        return app;
      },
      post(path: string, handler: (req: Record<string, never>, res: { json: (body: unknown) => void }) => Promise<void> | void) {
        postRoutes.push({ path, handler });
        return app;
      },
    };

    registerSearchRoutes(app as never, { wikiRoot: "wiki", port: 4175, host: "127.0.0.1", author: "me", projectRoot: "project" });

    const json = vi.fn();
    await postRoutes[0]?.handler({}, { json });

    expect(postRoutes[0]?.path).toBe("/api/search/test");
    expect(searchAll).toHaveBeenCalledWith(
      expect.objectContaining({ wikiRoot: "wiki" }),
      "LLM Wiki connectivity test",
      {
        scope: "web",
        mode: "keyword",
        webLimit: 1,
      },
    );
    expect(json).toHaveBeenCalledWith({
      success: true,
      data: {
        ok: true,
        message: "网络搜索 API 已连接，但测试没有返回结果。",
      },
    });
  });
});
