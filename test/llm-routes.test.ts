import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerLlmRoutes } from "../web/server/routes/llm.js";

const { readLlmProviderConfig, saveLlmProviderConfig, testLlmProviderConfig, readLlmApiAccounts, saveLlmApiAccount, deleteLlmApiAccount, startLlmApiAccount } = vi.hoisted(() => ({
  readLlmProviderConfig: vi.fn(),
  saveLlmProviderConfig: vi.fn(),
  testLlmProviderConfig: vi.fn(),
  readLlmApiAccounts: vi.fn(),
  saveLlmApiAccount: vi.fn(),
  deleteLlmApiAccount: vi.fn(),
  startLlmApiAccount: vi.fn(),
}));

const { pullAccountAiSettingsToLocal, pushLocalAiSettingsToAccount } = vi.hoisted(() => ({
  pullAccountAiSettingsToLocal: vi.fn(),
  pushLocalAiSettingsToAccount: vi.fn(),
}));

vi.mock("../web/server/services/llm-config.js", () => ({
  readLlmProviderConfig,
  saveLlmProviderConfig,
  testLlmProviderConfig,
}));

vi.mock("../web/server/services/llm-accounts.js", () => ({
  readLlmApiAccounts,
  saveLlmApiAccount,
  deleteLlmApiAccount,
  startLlmApiAccount,
}));

vi.mock("../web/server/services/account-ai-sync.js", () => ({
  pullAccountAiSettingsToLocal,
  pushLocalAiSettingsToAccount,
}));

describe("llm routes", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    readLlmProviderConfig.mockReset();
    readLlmProviderConfig.mockReturnValue({
      provider: "openai",
      url: "http://127.0.0.1:8317/v1",
      keyConfigured: true,
      model: "gpt-5-codex",
    });
    saveLlmProviderConfig.mockReset();
    saveLlmProviderConfig.mockReturnValue({
      provider: "openai",
      url: "http://127.0.0.1:8317/v1",
      keyConfigured: true,
      model: "gpt-5-codex",
    });
    testLlmProviderConfig.mockReset();
    testLlmProviderConfig.mockResolvedValue({
      ok: true,
      provider: "openai",
      endpoint: "http://127.0.0.1:8317/v1/chat/completions",
      message: "ok",
    });
    readLlmApiAccounts.mockReset();
    readLlmApiAccounts.mockReturnValue({ accounts: [] });
    saveLlmApiAccount.mockReset();
    saveLlmApiAccount.mockReturnValue({
      id: "openai:main",
      name: "main",
      provider: "openai",
      url: "http://127.0.0.1:8317/v1",
      keyConfigured: true,
      model: "gpt-5-codex",
      enabled: true,
      updatedAt: "2026-04-23T00:00:00.000Z",
    });
    deleteLlmApiAccount.mockReset();
    deleteLlmApiAccount.mockReturnValue({ ok: true });
    startLlmApiAccount.mockReset();
    startLlmApiAccount.mockReturnValue({
      id: "openai:main",
      name: "main",
      provider: "openai",
      url: "http://127.0.0.1:8317/v1",
      keyConfigured: true,
      model: "gpt-5-codex",
      enabled: true,
      updatedAt: "2026-04-23T00:00:00.000Z",
    });
    pullAccountAiSettingsToLocal.mockReset();
    pullAccountAiSettingsToLocal.mockResolvedValue(null);
    pushLocalAiSettingsToAccount.mockReset();
    pushLocalAiSettingsToAccount.mockResolvedValue(null);
  });

  it("registers GET, PUT, and test routes for LLM config", async () => {
    const getRoutes: Array<{ path: string; handler: (req: unknown, res: { json: (body: unknown) => void }) => void }> = [];
    const putRoutes: Array<{
      path: string;
      handler: (
        req: { body?: unknown },
        res: { json: (body: unknown) => void; status: (code: number) => { json: (body: unknown) => void } },
      ) => void;
    }> = [];
    const postRoutes: Array<{
      path: string;
      handler: (
        req: { body?: unknown },
        res: { json: (body: unknown) => void; status: (code: number) => { json: (body: unknown) => void } },
      ) => Promise<void>;
    }> = [];
    const app = {
      get(path: string, handler: (req: unknown, res: { json: (body: unknown) => void }) => void) {
        getRoutes.push({ path, handler });
        return app;
      },
      put(
        path: string,
        handler: (
          req: { body?: unknown },
          res: { json: (body: unknown) => void; status: (code: number) => { json: (body: unknown) => void } },
        ) => void,
      ) {
        putRoutes.push({ path, handler });
        return app;
      },
      post(
        path: string,
        handler: (
          req: { body?: unknown },
          res: { json: (body: unknown) => void; status: (code: number) => { json: (body: unknown) => void } },
        ) => Promise<void>,
      ) {
        postRoutes.push({ path, handler });
        return app;
      },
    };

    registerLlmRoutes(app as never, { wikiRoot: "wiki", port: 4175, host: "127.0.0.1", author: "me", projectRoot: "project-root" });

    const json = vi.fn();
    await getRoutes[0]?.handler({}, { json });
    expect(getRoutes[0]?.path).toBe("/api/llm/config");
    expect(readLlmProviderConfig).toHaveBeenCalledWith("project-root");
    expect(json).toHaveBeenCalledWith({
      success: true,
      data: {
        provider: "openai",
        url: "http://127.0.0.1:8317/v1",
        keyConfigured: true,
        model: "gpt-5-codex",
      },
    });

    const status = vi.fn(() => ({ json }));
    putRoutes[0]?.handler(
      {
        body: {
          provider: "openai",
          url: "http://127.0.0.1:8317/v1",
          key: "wiki-client-key",
          model: "gpt-5-codex",
        },
      },
      { json, status },
    );
    expect(putRoutes[0]?.path).toBe("/api/llm/config");
    expect(saveLlmProviderConfig).toHaveBeenCalledWith("project-root", {
      provider: "openai",
      url: "http://127.0.0.1:8317/v1",
      key: "wiki-client-key",
      model: "gpt-5-codex",
    });

    await postRoutes[0]?.handler(
      {
        body: {
          provider: "deepseek",
          url: "https://api.deepseek.com/v1",
          key: "sk-deepseek",
          model: "deepseek-chat",
        },
      },
      { json, status },
    );
    expect(postRoutes[0]?.path).toBe("/api/llm/test");
    expect(testLlmProviderConfig).toHaveBeenCalledWith("project-root", {
      provider: "deepseek",
      url: "https://api.deepseek.com/v1",
      key: "sk-deepseek",
      model: "deepseek-chat",
    });
    expect(json).toHaveBeenLastCalledWith({
      success: true,
      data: {
        ok: true,
        provider: "openai",
        endpoint: "http://127.0.0.1:8317/v1/chat/completions",
        message: "ok",
      },
    });

    await postRoutes[1]?.handler(
      { body: { id: "openai:main" } },
      { json, status },
    );
    expect(postRoutes[1]?.path).toBe("/api/llm/accounts/start");
    expect(startLlmApiAccount).toHaveBeenCalledWith("project-root", { id: "openai:main" });
    expect(saveLlmProviderConfig).toHaveBeenCalledWith("project-root", { accountRef: "api:openai:main" });
  });

  it("does not block LLM account saves on account sync", async () => {
    const putRoutes: Array<{
      path: string;
      handler: (
        req: { body?: unknown },
        res: { json: (body: unknown) => void; status: (code: number) => { json: (body: unknown) => void } },
      ) => void;
    }> = [];
    const app = {
      get() { return app; },
      put(
        path: string,
        handler: (
          req: { body?: unknown },
          res: { json: (body: unknown) => void; status: (code: number) => { json: (body: unknown) => void } },
        ) => void,
      ) {
        putRoutes.push({ path, handler });
        return app;
      },
      delete() { return app; },
      post() { return app; },
    };
    pushLocalAiSettingsToAccount.mockReturnValue(new Promise(() => undefined));
    registerLlmRoutes(app as never, { wikiRoot: "wiki", port: 4175, host: "127.0.0.1", author: "me", projectRoot: "project-root" });

    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    putRoutes.find((route) => route.path === "/api/llm/accounts")?.handler(
      {
        body: {
          provider: "nvidia",
          url: "https://integrate.api.nvidia.com/v1",
          key: "nvapi-key",
          model: "openai/gpt-oss-120b",
        },
      },
      { json, status },
    );

    expect(pushLocalAiSettingsToAccount).toHaveBeenCalledWith("project-root");
    expect(status).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith({
      success: true,
      data: {
        id: "openai:main",
        name: "main",
        provider: "openai",
        url: "http://127.0.0.1:8317/v1",
        keyConfigured: true,
        model: "gpt-5-codex",
        enabled: true,
        updatedAt: "2026-04-23T00:00:00.000Z",
      },
    });
  });

  it("returns a redacted Cloudflare Workers AI provider summary", () => {
    vi.stubEnv("CLOUDFLARE_WORKER_URL", "https://worker.example.com/");
    vi.stubEnv("CLOUDFLARE_REMOTE_TOKEN", "remote-secret");
    vi.stubEnv("CLOUDFLARE_AI_MODEL", "@cf/test/llm");
    vi.stubEnv("CLOUDFLARE_EMBEDDING_MODEL", "@cf/test/embed");
    const getRoutes: Array<{ path: string; handler: (req: unknown, res: { json: (body: unknown) => void }) => void }> = [];
    const app = {
      get(path: string, handler: (req: unknown, res: { json: (body: unknown) => void }) => void) {
        getRoutes.push({ path, handler });
        return app;
      },
      put() { return app; },
      delete() { return app; },
      post() { return app; },
    };
    registerLlmRoutes(app as never, { wikiRoot: "wiki", port: 4175, host: "127.0.0.1", author: "me", projectRoot: "project-root" });

    const json = vi.fn();
    getRoutes.find((route) => route.path === "/api/llm/cloudflare-provider")?.handler({}, { json });

    expect(JSON.stringify(json.mock.calls)).not.toContain("remote-secret");
    expect(json).toHaveBeenCalledWith({
      success: true,
      data: {
        accountRef: "cloudflare:workers-ai",
        configured: true,
        runtime: "worker",
        endpoint: "https://worker.example.com/",
        aiModel: "@cf/test/llm",
        embeddingModels: ["@cf/test/embed"],
      },
    });
  });
});
