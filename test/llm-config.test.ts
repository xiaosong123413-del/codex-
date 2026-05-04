import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CloudflareProvider } from "../src/providers/cloudflare.js";
import {
  readLlmProviderConfig,
  saveLlmProviderConfig,
  testLlmProviderConfig,
} from "../web/server/services/llm-config.js";

describe("LLM provider config", () => {
  it("persists the selected API account as the default model source", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-llm-config-"));
    const env: NodeJS.ProcessEnv = {};
    fs.mkdirSync(path.join(root, ".llmwiki"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".llmwiki", "llm-accounts.json"),
      `${JSON.stringify({
        accounts: [{
          id: "deepseek:primary",
          name: "primary",
          provider: "deepseek",
          url: "https://api.deepseek.com/v1",
          key: "deepseek-key",
          model: "deepseek-chat",
          enabled: true,
          updatedAt: "2026-04-25T00:00:00.000Z",
        }],
      }, null, 2)}\n`,
      "utf8",
    );

    const saved = saveLlmProviderConfig(root, {
      accountRef: "api:deepseek:primary",
    }, env);

    expect(saved).toEqual({
      accountRef: "api:deepseek:primary",
      provider: "deepseek",
      url: "https://api.deepseek.com/v1",
      keyConfigured: true,
      model: "deepseek-chat",
    });
    expect(env.LLMWIKI_DEFAULT_ACCOUNT_REF).toBe("api:deepseek:primary");
    expect(env.LLMWIKI_PROVIDER).toBe("openai");
    expect(env.LLMWIKI_OPENAI_COMPAT_PROVIDER).toBe("deepseek");
    expect(env.LLMWIKI_OPENAI_BASE_URL).toBe("https://api.deepseek.com/v1");
    expect(env.OPENAI_API_KEY).toBe("deepseek-key");
    expect(env.LLMWIKI_MODEL).toBe("deepseek-chat");
  });

  it("persists the selected OAuth account through the local CLIProxy route", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-llm-config-"));
    const env: NodeJS.ProcessEnv = {};
    fs.mkdirSync(path.join(root, ".llmwiki", "cliproxyapi"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".llmwiki", "cliproxyapi", "wiki-cliproxy.json"),
      `${JSON.stringify({
        port: 8899,
        managementKey: "mgmt-key",
        clientKey: "wiki-client-key",
        model: "gpt-5-codex",
      }, null, 2)}\n`,
      "utf8",
    );

    const saved = saveLlmProviderConfig(root, {
      accountRef: "oauth:codex:codex.json",
    }, env);

    expect(saved).toEqual({
      accountRef: "oauth:codex:codex.json",
      provider: "codex-cli",
      url: "http://127.0.0.1:8899/v1",
      keyConfigured: true,
      model: "gpt-5-codex",
    });
    expect(env.LLMWIKI_DEFAULT_ACCOUNT_REF).toBe("oauth:codex:codex.json");
    expect(env.LLMWIKI_PROVIDER).toBe("openai");
    expect(env.LLMWIKI_OPENAI_COMPAT_PROVIDER).toBe("codex-cli");
    expect(env.LLMWIKI_OPENAI_BASE_URL).toBe("http://127.0.0.1:8899/v1");
    expect(env.OPENAI_API_KEY).toBe("wiki-client-key");
    expect(env.LLMWIKI_MODEL).toBe("gpt-5-codex");
  });

  it("persists the selected Worker OAuth account through the account session route", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-llm-config-"));
    const env: NodeJS.ProcessEnv = {
      CLOUDFLARE_WORKER_URL: "https://worker.example.com/",
      CLOUDFLARE_ACCOUNT_SESSION_TOKEN: "session-token",
    };

    const saved = saveLlmProviderConfig(root, {
      accountRef: "oauth:codex:cloud-account",
    }, env);

    expect(saved).toEqual({
      accountRef: "oauth:codex:cloud-account",
      provider: "codex-cli",
      url: "https://worker.example.com/user/ai",
      keyConfigured: true,
      model: "gpt-5.5",
    });
    expect(env.LLMWIKI_DEFAULT_ACCOUNT_REF).toBe("oauth:codex:cloud-account");
    expect(env.LLMWIKI_OPENAI_COMPAT_PROVIDER).toBe("codex-cli");
    expect(env.LLMWIKI_OPENAI_BASE_URL).toBe("https://worker.example.com/user/ai");
    expect(env.OPENAI_API_KEY).toBe("session-token");
  });

  it("persists the selected Cloudflare Workers AI account as the default model source", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-llm-config-"));
    const env: NodeJS.ProcessEnv = {
      CLOUDFLARE_WORKER_URL: "https://worker.example.com/",
      CLOUDFLARE_REMOTE_TOKEN: "remote-token",
      CLOUDFLARE_AI_MODEL: "@cf/test/llm",
      LLMWIKI_MODEL: "claude-sonnet-4-20250514",
    };

    const saved = saveLlmProviderConfig(root, {
      accountRef: "cloudflare:workers-ai",
    }, env);

    expect(saved).toEqual({
      accountRef: "cloudflare:workers-ai",
      provider: "cloudflare",
      url: "https://worker.example.com/llm",
      keyConfigured: true,
      model: "@cf/test/llm",
    });
    expect(env.LLMWIKI_DEFAULT_ACCOUNT_REF).toBe("cloudflare:workers-ai");
    expect(env.LLMWIKI_PROVIDER).toBe("cloudflare");
    expect(env.LLMWIKI_MODEL).toBe("@cf/test/llm");
  });

  it("persists OpenAI-compatible settings into the project env file", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-llm-config-"));
    const env: NodeJS.ProcessEnv = {};

    const saved = saveLlmProviderConfig(root, {
      provider: "openai",
      url: "http://127.0.0.1:8317/v1",
      key: "wiki-client-key",
      model: "gpt-5-codex",
    }, env);

    expect(saved).toEqual({
      provider: "openai",
      url: "http://127.0.0.1:8317/v1",
      keyConfigured: true,
      model: "gpt-5-codex",
    });
    expect(env.LLMWIKI_PROVIDER).toBe("openai");
    expect(env.LLMWIKI_OPENAI_COMPAT_PROVIDER).toBe("openai");
    expect(env.LLMWIKI_OPENAI_BASE_URL).toBe("http://127.0.0.1:8317/v1");
    expect(env.OPENAI_API_KEY).toBe("wiki-client-key");
    expect(env.LLMWIKI_MODEL).toBe("gpt-5-codex");
    expect(fs.readFileSync(path.join(root, ".env"), "utf8")).toContain("LLMWIKI_OPENAI_BASE_URL=http://127.0.0.1:8317/v1");
  });

  it("reads key state without exposing the saved key", () => {
    const env: NodeJS.ProcessEnv = {
      LLMWIKI_PROVIDER: "openai",
      LLMWIKI_OPENAI_BASE_URL: "http://127.0.0.1:8317/v1",
      OPENAI_API_KEY: "secret",
      LLMWIKI_MODEL: "gpt-5-codex",
    };

    expect(readLlmProviderConfig("unused", env)).toEqual({
      provider: "openai",
      url: "http://127.0.0.1:8317/v1",
      keyConfigured: true,
      model: "gpt-5-codex",
    });
  });

  it("persists OpenAI-compatible third-party providers through the internal OpenAI route", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-llm-config-"));
    const env: NodeJS.ProcessEnv = {};

    const saved = saveLlmProviderConfig(root, {
      provider: "deepseek",
      url: "https://api.deepseek.com",
      key: "deepseek-key",
      model: "deepseek-chat",
    }, env);

    expect(saved).toEqual({
      provider: "deepseek",
      url: "https://api.deepseek.com/v1",
      keyConfigured: true,
      model: "deepseek-chat",
    });
    expect(env.LLMWIKI_PROVIDER).toBe("openai");
    expect(env.LLMWIKI_OPENAI_COMPAT_PROVIDER).toBe("deepseek");
    expect(env.LLMWIKI_OPENAI_BASE_URL).toBe("https://api.deepseek.com/v1");
    expect(env.OPENAI_API_KEY).toBe("deepseek-key");
  });

  it("persists MiniMax as an Anthropic Messages provider with bearer auth", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-llm-config-"));
    const env: NodeJS.ProcessEnv = {};
    const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];

    const saved = saveLlmProviderConfig(root, {
      provider: "minimax",
      url: "https://api.minimax.io/anthropic",
      key: "minimax-key",
      model: "MiniMax-M2.7",
    }, env);

    expect(saved).toEqual({
      provider: "minimax",
      url: "https://api.minimax.io/anthropic",
      keyConfigured: true,
      model: "MiniMax-M2.7",
    });
    expect(env.LLMWIKI_PROVIDER).toBe("minimax");
    expect(env.MINIMAX_BASE_URL).toBe("https://api.minimax.io/anthropic");
    expect(env.MINIMAX_API_KEY).toBe("minimax-key");
    expect(env.LLMWIKI_OPENAI_BASE_URL).toBeUndefined();

    const result = await testLlmProviderConfig(root, {
      provider: "minimax",
      url: "https://api.minimax.io/anthropic",
      model: "MiniMax-M2.7",
    }, env, async (input, init) => {
      calls.push({ input, init });
      return new Response("{}", { status: 200 });
    });

    expect(result).toMatchObject({
      ok: true,
      provider: "minimax",
      endpoint: "https://api.minimax.io/anthropic/v1/messages",
    });
    expect(calls[0]?.init?.headers).toEqual({
      "content-type": "application/json",
      Authorization: "Bearer minimax-key",
    });
  });

  it("normalizes NVIDIA NIM settings as an OpenAI-compatible provider", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-llm-config-"));
    const env: NodeJS.ProcessEnv = {};

    const saved = saveLlmProviderConfig(root, {
      provider: "nvidia",
      url: "https://integrate.api.nvidia.com",
      key: "nvapi-key",
      model: "openai/gpt-oss-120b",
    }, env);

    expect(saved).toEqual({
      provider: "nvidia",
      url: "https://integrate.api.nvidia.com/v1",
      keyConfigured: true,
      model: "openai/gpt-oss-120b",
    });
    expect(env.LLMWIKI_PROVIDER).toBe("openai");
    expect(env.LLMWIKI_OPENAI_COMPAT_PROVIDER).toBe("nvidia");
    expect(env.LLMWIKI_OPENAI_BASE_URL).toBe("https://integrate.api.nvidia.com/v1");
    expect(env.OPENAI_API_KEY).toBe("nvapi-key");
  });

  it("normalizes Alibaba Bailian settings to compatible-mode v1", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-llm-config-"));
    const env: NodeJS.ProcessEnv = {};

    const saved = saveLlmProviderConfig(root, {
      provider: "bailian-cn",
      url: "https://dashscope.aliyuncs.com",
      key: "dashscope-key",
      model: "qwen-plus",
    }, env);

    expect(saved).toEqual({
      provider: "bailian-cn",
      url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      keyConfigured: true,
      model: "qwen-plus",
    });
    expect(env.LLMWIKI_PROVIDER).toBe("openai");
    expect(env.LLMWIKI_OPENAI_COMPAT_PROVIDER).toBe("bailian-cn");
    expect(env.LLMWIKI_OPENAI_BASE_URL).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1");
    expect(env.OPENAI_API_KEY).toBe("dashscope-key");
  });

  it("keeps Perplexity settings at the root chat completions endpoint", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-llm-config-"));
    const env: NodeJS.ProcessEnv = {};

    const saved = saveLlmProviderConfig(root, {
      provider: "perplexity",
      url: "https://api.perplexity.ai",
      key: "pplx-key",
      model: "sonar",
    }, env);

    expect(saved).toEqual({
      provider: "perplexity",
      url: "https://api.perplexity.ai",
      keyConfigured: true,
      model: "sonar",
    });
    expect(env.LLMWIKI_OPENAI_BASE_URL).toBe("https://api.perplexity.ai");
    expect(env.OPENAI_API_KEY).toBe("pplx-key");
  });

  it("tests provider connectivity against the selected provider endpoint", async () => {
    const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
    const response = new Response("{}", { status: 200 });
    const result = await testLlmProviderConfig(
      "unused",
      {
        provider: "deepseek",
        url: "https://api.deepseek.com/v1",
        key: "deepseek-key",
        model: "deepseek-chat",
      },
      {},
      async (input, init) => {
        calls.push({ input, init });
        return response;
      },
    );

    expect(result).toMatchObject({
      ok: true,
      provider: "deepseek",
      endpoint: "https://api.deepseek.com/v1/chat/completions",
    });
    expect(String(calls[0]?.input)).toBe("https://api.deepseek.com/v1/chat/completions");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.headers).toMatchObject({ Authorization: "Bearer deepseek-key" });
  });

  it("tests Bailian connectivity against the OpenAI-compatible endpoint", async () => {
    const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
    const result = await testLlmProviderConfig(
      "unused",
      {
        provider: "bailian-cn",
        url: "https://dashscope.aliyuncs.com",
        key: "dashscope-key",
        model: "qwen-plus",
      },
      {},
      async (input, init) => {
        calls.push({ input, init });
        return new Response("{}", { status: 200 });
      },
    );

    expect(result).toMatchObject({
      ok: true,
      provider: "bailian-cn",
      endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    });
    expect(calls[0]?.init?.headers).toMatchObject({ Authorization: "Bearer dashscope-key" });
    expect(calls[0]?.init?.body).toContain("\"model\":\"qwen-plus\"");
  });

  it("returns a timeout result when provider connectivity hangs", async () => {
    vi.useFakeTimers();
    try {
      const resultPromise = testLlmProviderConfig(
        "unused",
        {
          provider: "nvidia",
          url: "https://integrate.api.nvidia.com/v1",
          key: "nvapi-key",
          model: "openai/gpt-oss-120b",
        },
        {},
        async (_input, init) => new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
      );

      await vi.advanceTimersByTimeAsync(15_000);
      await expect(resultPromise).resolves.toEqual({
        ok: false,
        provider: "nvidia",
        endpoint: "https://integrate.api.nvidia.com/v1/chat/completions",
        message: "验证失败：请求超时，请检查网络、代理、Base URL 或服务商状态。",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("tests provider connectivity through a saved API account reference", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-llm-config-"));
    const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
    fs.mkdirSync(path.join(root, ".llmwiki"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".llmwiki", "llm-accounts.json"),
      `${JSON.stringify({
        accounts: [{
          id: "relay:-",
          name: "小马中转",
          provider: "relay",
          url: "https://xiaoma.best/v1",
          key: "saved-relay-key",
          model: "claude-sonnet-4-20250514",
          enabled: true,
          updatedAt: "2026-04-29T00:00:00.000Z",
        }],
      }, null, 2)}\n`,
      "utf8",
    );

    const result = await testLlmProviderConfig(
      root,
      { accountRef: "api:relay:-" },
      {},
      async (input, init) => {
        calls.push({ input, init });
        return new Response("{}", { status: 200 });
      },
    );

    expect(result).toMatchObject({
      ok: true,
      provider: "relay",
      endpoint: "https://xiaoma.best/v1/chat/completions",
    });
    expect(calls[0]?.init?.headers).toMatchObject({ Authorization: "Bearer saved-relay-key" });
    expect(calls[0]?.init?.body).toContain("claude-sonnet-4-20250514");
  });

  it("tests Cloudflare Workers AI connectivity through its provider account reference", async () => {
    const completeSpy = vi.spyOn(CloudflareProvider.prototype, "complete").mockResolvedValue("ok");
    try {
      const result = await testLlmProviderConfig(
        "unused",
        { accountRef: "cloudflare:workers-ai" },
        {
          CLOUDFLARE_WORKER_URL: "https://worker.example.com/",
          CLOUDFLARE_REMOTE_TOKEN: "remote-token",
          CLOUDFLARE_AI_MODEL: "@cf/test/llm",
          LLMWIKI_MODEL: "claude-sonnet-4-20250514",
        },
      );

      expect(result).toEqual({
        ok: true,
        provider: "cloudflare",
        endpoint: "https://worker.example.com/llm",
        message: "验证成功，Cloudflare Workers AI 可以连通。",
      });
      expect(completeSpy).toHaveBeenCalledOnce();
      expect(Reflect.get(completeSpy.mock.instances[0], "model")).toBe("@cf/test/llm");
    } finally {
      completeSpy.mockRestore();
    }
  });

  it("uses provider-specific default models when testing connectivity without an explicit model", async () => {
    const geminiCalls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
    const codexCalls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];

    const geminiResult = await testLlmProviderConfig(
      "unused",
      {
        provider: "gemini",
        url: "https://generativelanguage.googleapis.com",
        key: "gemini-key",
      },
      {},
      async (input, init) => {
        geminiCalls.push({ input, init });
        return new Response("{}", { status: 200 });
      },
    );

    const codexResult = await testLlmProviderConfig(
      "unused",
      {
        provider: "codex-cli",
        url: "http://127.0.0.1:8317/v1",
        key: "codex-key",
      },
      {},
      async (input, init) => {
        codexCalls.push({ input, init });
        return new Response("{}", { status: 200 });
      },
    );

    expect(geminiResult).toMatchObject({
      ok: true,
      endpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=gemini-key",
    });
    expect(String(geminiCalls[0]?.input)).toContain("gemini-2.5-flash:generateContent");

    expect(codexResult).toMatchObject({
      ok: true,
      endpoint: "http://127.0.0.1:8317/v1/chat/completions",
    });
    expect(codexCalls[0]?.init?.body).toContain("\"model\":\"gpt-5-codex\"");
  });

  it("translates relay model_not_found errors into a direct model hint", async () => {
    const result = await testLlmProviderConfig(
      "unused",
      {
        provider: "relay",
        url: "https://xiaoma.best",
        key: "relay-key",
        model: "gpt-4o",
      },
      {},
      async () => new Response(
        JSON.stringify({
          error: {
            code: "model_not_found",
            message: "No available channel for model gpt-4o under group default",
          },
        }),
        { status: 503, headers: { "content-type": "application/json" } },
      ),
    );

    expect(result).toEqual({
      ok: false,
      provider: "relay",
      endpoint: "https://xiaoma.best/v1/chat/completions",
      message: "验证失败：当前中转站账号不支持模型 gpt-4o，请改成该中转实际支持的模型名后再试。",
    });
  });
});
