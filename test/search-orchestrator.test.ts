import { beforeEach, describe, expect, it, vi } from "vitest";
import { searchAll } from "../web/server/services/search-orchestrator.js";

const { runSearch, searchWebExternal } = vi.hoisted(() => ({
  runSearch: vi.fn(),
  searchWebExternal: vi.fn(),
}));

vi.mock("../web/server/services/search-router.js", () => ({
  runSearch,
}));

vi.mock("../src/services/cloudflare-web-search.js", () => ({
  searchWebExternal,
}));

describe("search orchestrator", () => {
  beforeEach(() => {
    runSearch.mockReset();
    searchWebExternal.mockReset();
    runSearch.mockResolvedValue({
      mode: "keyword",
      results: [{ id: "local-1", title: "Redis", path: "wiki/concepts/redis.md", layer: "wiki", excerpt: "cache", tags: [], modifiedAt: null }],
    });
    searchWebExternal.mockResolvedValue({
      ok: true,
      data: [{ title: "Redis Docs", url: "https://redis.io", snippet: "official" }],
    });
  });

  it("uses only the external web provider for scope=web", async () => {
    const result = await searchAll(
      { wikiRoot: "wiki", port: 4175, host: "127.0.0.1", author: "me", projectRoot: "project" },
      "redis",
      { scope: "web", mode: "keyword", webLimit: 3 },
    );

    expect(runSearch).not.toHaveBeenCalled();
    expect(searchWebExternal).toHaveBeenCalledWith("redis", 3);
    expect(result).toEqual({
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
        results: [{ title: "Redis Docs", url: "https://redis.io", snippet: "official" }],
      },
    });
  });

  it("returns an unconfigured web bucket when external endpoint is unavailable", async () => {
    searchWebExternal.mockResolvedValue({
      ok: false,
      error: {
        type: "cloudflare-unconfigured",
        message: "Missing CLOUDFLARE_SEARCH_ENDPOINT",
      },
    });

    const result = await searchAll(undefined, "redis", { scope: "web", mode: "keyword", webLimit: 3 });

    expect(result.web).toEqual({
      configured: false,
      ok: false,
      error: "Missing CLOUDFLARE_SEARCH_ENDPOINT",
      results: [],
    });
  });
});
