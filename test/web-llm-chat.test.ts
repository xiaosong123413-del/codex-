import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  generateAssistantReply,
  generateAssistantReplyResult,
  resolveCodexAgentProviderRoute,
  streamAssistantReply,
} from "../web/server/services/llm-chat.js";
import type { Conversation } from "../web/server/services/chat-store.js";
import { CloudflareProvider } from "../src/providers/cloudflare.js";
import { GeminiProvider } from "../src/providers/gemini.js";
import { OpenAIProvider } from "../src/providers/openai.js";

const tempRoots: string[] = [];
const { searchAll } = vi.hoisted(() => ({
  searchAll: vi.fn(),
}));

vi.mock("../web/server/services/search-orchestrator.js", () => ({
  searchAll,
}));

describe("llm-chat service", () => {
  afterEach(() => {
    while (tempRoots.length > 0) {
      const root = tempRoots.pop();
      if (root && fs.existsSync(root)) {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    searchAll.mockReset();
    searchAll.mockResolvedValue({
      scope: "all",
      mode: "hybrid",
      local: {
        mode: "hybrid",
        results: [],
      },
      web: {
        results: [],
      },
    });
  });

  it("calls the provider with conversation messages and selected article context", async () => {
    const root = createTempRoot();
    const articlePath = path.join(root, "wiki", "concepts", "alpha.md");
    fs.mkdirSync(path.dirname(articlePath), { recursive: true });
    fs.writeFileSync(articlePath, "# Alpha\n\nAlpha knowledge lives here.");

    const conversation: Conversation = {
      id: "c1",
      title: "Thread",
      createdAt: "2026-04-17T10:00:00.000Z",
      updatedAt: "2026-04-17T10:00:00.000Z",
      webSearchEnabled: false,
      articleRefs: ["wiki/concepts/alpha.md"],
      messages: [
        {
          id: "m1",
          role: "user",
          content: "Tell me about alpha.",
          createdAt: "2026-04-17T10:00:00.000Z",
          articleRefs: ["wiki/concepts/alpha.md"],
        },
      ],
    };

    const provider = {
      complete: vi.fn().mockResolvedValue("Assistant reply"),
    };

    const output = await generateAssistantReply(root, conversation, provider as never);

    expect(output).toBe("Assistant reply");
    expect(provider.complete).toHaveBeenCalledOnce();
    const [system, messages, maxTokens] = provider.complete.mock.calls[0]!;
    expect(system).toContain("wiki/concepts/alpha.md");
    expect(system).toContain("Alpha knowledge lives here.");
    expect(messages).toEqual([{ role: "user", content: "Tell me about alpha." }]);
    expect(maxTokens).toBe(4000);
  });

  it("requires thinking summaries to use the user's working language", async () => {
    const root = createTempRoot();
    const conversation: Conversation = {
      id: "c-language",
      title: "Thread",
      createdAt: "2026-04-17T10:00:00.000Z",
      updatedAt: "2026-04-17T10:00:00.000Z",
      webSearchEnabled: false,
      articleRefs: [],
      messages: [
        {
          id: "m1",
          role: "user",
          content: "如何不要过度交付？",
          createdAt: "2026-04-17T10:00:00.000Z",
        },
      ],
    };
    const provider = {
      complete: vi.fn().mockResolvedValue("回答"),
    };

    await generateAssistantReply(root, conversation, provider as never);

    const [system] = provider.complete.mock.calls[0]!;
    expect(system).toContain("Use the user's working language for every visible section, including <thinking>");
    expect(system).toContain("If the user writes Chinese, answer in Chinese");
    expect(system).toContain("the thinking summary must be Chinese");
    expect(system).toContain("do not include hidden chain-of-thought or English planning notes");
  });

  it("streams assistant tokens through the provider", async () => {
    const root = createTempRoot();
    const conversation: Conversation = {
      id: "c1",
      title: "Thread",
      createdAt: "2026-04-17T10:00:00.000Z",
      updatedAt: "2026-04-17T10:00:00.000Z",
      webSearchEnabled: false,
      articleRefs: [],
      messages: [
        {
          id: "m1",
          role: "user",
          content: "Stream please.",
          createdAt: "2026-04-17T10:00:00.000Z",
        },
      ],
    };
    const tokens: string[] = [];
    const provider = {
      stream: vi.fn(async (_system, _messages, _maxTokens, onToken?: (token: string) => void) => {
        onToken?.("Hello");
        onToken?.(" world");
        return "Hello world";
      }),
    };

    const output = await streamAssistantReply(root, conversation, provider as never, (token) => {
      tokens.push(token);
    });

    expect(output).toBe("Hello world");
    expect(tokens).toEqual(["Hello", " world"]);
    expect(provider.stream).toHaveBeenCalledOnce();
  });

  it("loads web search context through the unified search orchestrator", async () => {
    const root = createTempRoot();
    const conversation: Conversation = {
      id: "c2",
      title: "Thread",
      createdAt: "2026-04-17T10:00:00.000Z",
      updatedAt: "2026-04-17T10:00:00.000Z",
      webSearchEnabled: true,
      articleRefs: [],
      messages: [
        {
          id: "m1",
          role: "user",
          content: "Redis 最新官方文档",
          createdAt: "2026-04-17T10:00:00.000Z",
        },
      ],
    };
    searchAll.mockResolvedValue({
      scope: "all",
      mode: "hybrid",
      local: {
        mode: "hybrid",
        results: [],
      },
      web: {
        results: [{ title: "Redis Docs", url: "https://redis.io", snippet: "Official documentation" }],
      },
    });
    const provider = {
      complete: vi.fn().mockResolvedValue("Assistant reply"),
    };

    await generateAssistantReply(root, conversation, provider as never);

    expect(searchAll).toHaveBeenCalledWith(
      undefined,
      "Redis 最新官方文档",
      {
        scope: "web",
        mode: "keyword",
        webLimit: 5,
      },
    );
    const [system] = provider.complete.mock.calls[0]!;
    expect(system).toContain("Redis Docs");
    expect(system).toContain("https://redis.io");
    expect(system).toContain("哪些信息来自本地 wiki，哪些来自联网结果");
  });

  it("loads local search context when the conversation scope is local", async () => {
    const root = createTempRoot();
    const conversation: Conversation = {
      id: "c3",
      title: "Thread",
      createdAt: "2026-04-17T10:00:00.000Z",
      updatedAt: "2026-04-17T10:00:00.000Z",
      webSearchEnabled: false,
      searchScope: "local",
      articleRefs: [],
      messages: [
        {
          id: "m1",
          role: "user",
          content: "Redis 缓存策略",
          createdAt: "2026-04-17T10:00:00.000Z",
        },
      ],
    };
    searchAll.mockResolvedValue({
      scope: "local",
      mode: "hybrid",
      local: {
        mode: "hybrid",
        results: [
          {
            id: "redis",
            title: "Redis",
            path: "wiki/concepts/redis.md",
            layer: "wiki",
            excerpt: "Redis 用于缓存。",
            tags: ["cache"],
            modifiedAt: "2026-04-17T10:00:00.000Z",
          },
        ],
      },
      web: {
        results: [],
      },
    });
    const provider = {
      complete: vi.fn().mockResolvedValue("Assistant reply"),
    };

    await generateAssistantReply(root, conversation, provider as never);

    expect(searchAll).toHaveBeenCalledWith(
      undefined,
      "Redis 缓存策略",
      {
        scope: "local",
        mode: "hybrid",
        webLimit: 5,
      },
    );
    const [system] = provider.complete.mock.calls[0]!;
    expect(system).toContain("<source_list>");
    expect(system).toContain("[1] Redis");
    expect(system).toContain("wiki_pages");
    expect(system).toContain("Redis");
    expect(system).toContain("Redis 用于缓存。");
  });

  it("returns stable numbered references for searched wiki pages", async () => {
    const root = createTempRoot();
    const pagePath = path.join(root, "wiki", "concepts", "redis.md");
    fs.mkdirSync(path.dirname(pagePath), { recursive: true });
    fs.writeFileSync(pagePath, "# Redis\n\nRedis 用于缓存和队列。");
    const conversation: Conversation = {
      id: "c-ref",
      title: "Thread",
      createdAt: "2026-04-17T10:00:00.000Z",
      updatedAt: "2026-04-17T10:00:00.000Z",
      webSearchEnabled: false,
      searchScope: "local",
      articleRefs: [],
      messages: [
        {
          id: "m1",
          role: "user",
          content: "Redis 是什么？",
          createdAt: "2026-04-17T10:00:00.000Z",
        },
      ],
    };
    searchAll.mockResolvedValue({
      scope: "local",
      mode: "hybrid",
      local: {
        mode: "hybrid",
        results: [{
          id: "redis",
          title: "Redis",
          path: "wiki/concepts/redis.md",
          layer: "wiki",
          excerpt: "Redis 用于缓存。",
          tags: [],
          modifiedAt: null,
        }],
      },
      web: { results: [] },
    });
    const provider = {
      complete: vi.fn().mockResolvedValue("Redis 是缓存系统。[1]\n<!-- cited: 1 -->"),
    };

    const result = await generateAssistantReplyResult(root, conversation, provider as never);

    expect(result.content).toContain("[1]");
    expect(result.references).toEqual([{
      index: 1,
      kind: "wiki",
      title: "Redis",
      path: "wiki/concepts/redis.md",
      excerpt: "Redis 用于缓存。",
    }]);
    const [system] = provider.complete.mock.calls[0]!;
    expect(system).toContain("When using a listed source, cite it inline as [1], [2], etc.");
    expect(system).toContain("### [1] Redis");
    expect(system).toContain("Redis 用于缓存和队列。");
  });

  it("loads both local and web search context when the conversation scope is all", async () => {
    const root = createTempRoot();
    const conversation: Conversation = {
      id: "c4",
      title: "Thread",
      createdAt: "2026-04-17T10:00:00.000Z",
      updatedAt: "2026-04-17T10:00:00.000Z",
      webSearchEnabled: true,
      searchScope: "all",
      articleRefs: [],
      messages: [
        {
          id: "m1",
          role: "user",
          content: "Redis 最新缓存实践",
          createdAt: "2026-04-17T10:00:00.000Z",
        },
      ],
    };
    searchAll.mockResolvedValue({
      scope: "all",
      mode: "hybrid",
      local: {
        mode: "hybrid",
        results: [
          {
            id: "redis-local",
            title: "Redis 本地笔记",
            path: "wiki/concepts/redis-local.md",
            layer: "wiki",
            excerpt: "本地整理的 Redis 实践。",
            tags: ["redis"],
            modifiedAt: "2026-04-17T10:00:00.000Z",
          },
        ],
      },
      web: {
        results: [{ title: "Redis Docs", url: "https://redis.io", snippet: "Official documentation" }],
      },
    });
    const provider = {
      complete: vi.fn().mockResolvedValue("Assistant reply"),
    };

    await generateAssistantReply(root, conversation, provider as never);

    expect(searchAll).toHaveBeenCalledWith(
      undefined,
      "Redis 最新缓存实践",
      {
        scope: "all",
        mode: "hybrid",
        webLimit: 5,
      },
    );
    const [system] = provider.complete.mock.calls[0]!;
    expect(system).toContain("wiki_pages");
    expect(system).toContain("Redis 本地笔记");
    expect(system).toContain("web_search_results");
    expect(system).toContain("Redis Docs");
  });

  it("injects the selected agent prompt and workflow into the system prompt", async () => {
    const root = createTempRoot();
    writeAgentConfig(root, {
      activeAgentId: "research-agent",
      agents: [
        {
          id: "research-agent",
          name: "Research Agent",
          purpose: "验证资料来源",
          provider: "openai",
          model: "",
          workflow: "先检索\n再归纳",
          prompt: "回答时必须列出证据。",
          enabled: true,
          updatedAt: "2026-04-23T00:00:00.000Z",
        },
      ],
    });
    const conversation: Conversation = {
      id: "c5",
      title: "Thread",
      createdAt: "2026-04-17T10:00:00.000Z",
      updatedAt: "2026-04-17T10:00:00.000Z",
      webSearchEnabled: false,
      searchScope: "local",
      agentId: "research-agent",
      articleRefs: [],
      messages: [
        {
          id: "m1",
          role: "user",
          content: "查一下来源",
          createdAt: "2026-04-17T10:00:00.000Z",
        },
      ],
    };
    const provider = {
      complete: vi.fn().mockResolvedValue("Agent reply"),
    };

    await generateAssistantReply(root, conversation, { projectRoot: root, provider: provider as never });

    const [system] = provider.complete.mock.calls[0]!;
    expect(system).toContain("<agent_config>");
    expect(system).toContain("Research Agent");
    expect(system).toContain("先检索");
    expect(system).toContain("回答时必须列出证据。");
  });

  it("resolves Codex agents to the local CLIProxy OpenAI-compatible endpoint", () => {
    const root = createTempRoot();
    writeJson(root, ".llmwiki/cliproxyapi/wiki-cliproxy.json", {
      port: 8317,
      managementKey: "management-key",
      clientKey: "wiki-client-key",
      model: "gpt-5-codex",
      proxyUrl: "",
    });
    const route = resolveCodexAgentProviderRoute(root, {
      id: "codex-agent",
      title: "Thread",
      createdAt: "2026-04-17T10:00:00.000Z",
      updatedAt: "2026-04-17T10:00:00.000Z",
      webSearchEnabled: false,
      articleRefs: [],
      messages: [],
    }, {
      id: "codex-agent",
      name: "Codex Agent",
      purpose: "代码任务",
      provider: "codex-cli",
      model: "gpt-5-codex",
      workflow: "",
      prompt: "使用 Codex OAuth 账号。",
      enabled: true,
      updatedAt: "2026-04-23T00:00:00.000Z",
    });

    expect(route).toEqual({
      baseURL: "http://127.0.0.1:8317/v1",
      apiKey: "wiki-client-key",
      model: "gpt-5-codex",
      headers: {
        "X-Session-ID": "agent:codex-agent:conversation:codex-agent",
      },
    });
  });

  it("routes agent API accounts through the saved provider account", async () => {
    const root = createTempRoot();
    writeAgentConfig(root, {
      activeAgentId: "writer",
      agents: [
        {
          id: "writer",
          name: "Writer",
          purpose: "生成草稿",
          provider: "gemini",
          accountRef: "api:gemini-work",
          model: "",
          workflow: "",
          prompt: "",
          enabled: true,
          updatedAt: "2026-04-23T00:00:00.000Z",
        },
      ],
    });
    writeJson(root, ".llmwiki/llm-accounts.json", {
      accounts: [
        {
          id: "gemini-work",
          name: "Gemini Work",
          provider: "gemini",
          url: "https://generativelanguage.googleapis.com",
          key: "gemini-key",
          model: "gemini-2.5-pro",
          enabled: true,
          updatedAt: "2026-04-23T00:00:00.000Z",
        },
      ],
    });
    const conversation: Conversation = {
      id: "api-account-conversation",
      title: "Thread",
      createdAt: "2026-04-17T10:00:00.000Z",
      updatedAt: "2026-04-17T10:00:00.000Z",
      webSearchEnabled: false,
      searchScope: "local",
      agentId: "writer",
      articleRefs: [],
      messages: [
        {
          id: "m1",
          role: "user",
          content: "写一版摘要",
          createdAt: "2026-04-17T10:00:00.000Z",
        },
      ],
    };
    const completeSpy = vi.spyOn(GeminiProvider.prototype, "complete").mockResolvedValue("Gemini reply");

    const output = await generateAssistantReply(root, conversation, { projectRoot: root });

    expect(output).toBe("Gemini reply");
    expect(completeSpy).toHaveBeenCalledOnce();
    const instance = completeSpy.mock.instances[0];
    expect(instance).toBeInstanceOf(GeminiProvider);
    expect(Reflect.get(instance, "model")).toBe("gemini-2.5-pro");
    expect(Reflect.get(instance, "baseURL")).toBe("https://generativelanguage.googleapis.com");
    expect(Reflect.get(instance, "apiKey")).toBe("gemini-key");
    completeSpy.mockRestore();
  });

  it("normalizes relay api account URLs before constructing the OpenAI-compatible client", async () => {
    const root = createTempRoot();
    writeAgentConfig(root, {
      activeAgentId: "xhs-decision-note",
      agents: [
        {
          id: "xhs-decision-note",
          name: "XHS Decision",
          purpose: "生成决策笔记",
          provider: "relay",
          accountRef: "api:relay:-",
          model: "claude-sonnet-4-20250514",
          workflow: "",
          prompt: "",
          enabled: true,
          updatedAt: "2026-04-24T00:00:00.000Z",
        },
      ],
    });
    writeJson(root, ".llmwiki/llm-accounts.json", {
      accounts: [
        {
          id: "relay:-",
          name: "Relay",
          provider: "relay",
          url: "https://xiaoma.best",
          key: "relay-key",
          model: "claude-sonnet-4-20250514",
          enabled: true,
          updatedAt: "2026-04-24T00:00:00.000Z",
        },
      ],
    });
    const conversation: Conversation = {
      id: "relay-conversation",
      title: "Thread",
      createdAt: "2026-04-17T10:00:00.000Z",
      updatedAt: "2026-04-17T10:00:00.000Z",
      webSearchEnabled: false,
      searchScope: "local",
      agentId: "xhs-decision-note",
      articleRefs: [],
      messages: [
        {
          id: "m1",
          role: "user",
          content: "生成决策笔记",
          createdAt: "2026-04-17T10:00:00.000Z",
        },
      ],
    };
    const completeSpy = vi.spyOn(OpenAIProvider.prototype, "complete").mockResolvedValue("Relay reply");

    const output = await generateAssistantReply(root, conversation, { projectRoot: root });

    expect(output).toBe("Relay reply");
    expect(completeSpy).toHaveBeenCalledOnce();
    const instance = completeSpy.mock.instances[0];
    expect(instance).toBeInstanceOf(OpenAIProvider);
    expect(Reflect.get(Reflect.get(instance, "client"), "baseURL")).toBe("https://xiaoma.best/v1");
    completeSpy.mockRestore();
  });

  it("routes agent OAuth accounts through the local CLIProxy OpenAI-compatible endpoint", async () => {
    const root = createTempRoot();
    writeAgentConfig(root, {
      activeAgentId: "oauth-agent",
      agents: [
        {
          id: "oauth-agent",
          name: "OAuth Agent",
          purpose: "代码任务",
          provider: "gemini",
          accountRef: "oauth:gemini-cli:gemini.json",
          model: "gemini-2.5-pro",
          workflow: "",
          prompt: "",
          enabled: true,
          updatedAt: "2026-04-23T00:00:00.000Z",
        },
      ],
    });
    writeJson(root, ".llmwiki/cliproxyapi/wiki-cliproxy.json", {
      port: 8317,
      managementKey: "management-key",
      clientKey: "wiki-client-key",
      model: "gpt-5-codex",
      proxyUrl: "",
    });
    const conversation: Conversation = {
      id: "oauth-conversation",
      title: "Thread",
      createdAt: "2026-04-17T10:00:00.000Z",
      updatedAt: "2026-04-17T10:00:00.000Z",
      webSearchEnabled: false,
      searchScope: "local",
      agentId: "oauth-agent",
      articleRefs: [],
      messages: [
        {
          id: "m1",
          role: "user",
          content: "处理这个任务",
          createdAt: "2026-04-17T10:00:00.000Z",
        },
      ],
    };
    const completeSpy = vi.spyOn(OpenAIProvider.prototype, "complete").mockResolvedValue("OAuth reply");

    const output = await generateAssistantReply(root, conversation, { projectRoot: root });

    expect(output).toBe("OAuth reply");
    expect(completeSpy).toHaveBeenCalledOnce();
    const instance = completeSpy.mock.instances[0];
    expect(instance).toBeInstanceOf(OpenAIProvider);
    expect(Reflect.get(instance, "model")).toBe("gemini-2.5-pro");
    expect(Reflect.get(Reflect.get(instance, "client"), "baseURL")).toBe("http://127.0.0.1:8317/v1");
    expect(Reflect.get(Reflect.get(instance, "client"), "_options")).toMatchObject({
      apiKey: "wiki-client-key",
      defaultHeaders: {
        "X-Session-ID": "agent:oauth-agent:oauth:gemini-cli:gemini.json:conversation:oauth-conversation",
      },
    });
    completeSpy.mockRestore();
  });

  it("routes Cloudflare Workers AI account apps through the Cloudflare provider", async () => {
    const root = createTempRoot();
    writeAgentConfig(root, {
      activeAgentId: "cloudflare-chat",
      agents: [
        {
          id: "cloudflare-chat",
          name: "Cloudflare Chat",
          purpose: "聊天",
          provider: "cloudflare",
          accountRef: "cloudflare:workers-ai",
          model: "@cf/meta/llama-3.1-8b-instruct",
          workflow: "",
          prompt: "",
          enabled: true,
          updatedAt: "2026-05-01T00:00:00.000Z",
        },
      ],
    });
    const conversation: Conversation = {
      id: "cloudflare-conversation",
      title: "Thread",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
      webSearchEnabled: false,
      searchScope: "local",
      agentId: "cloudflare-chat",
      articleRefs: [],
      messages: [{
        id: "m1",
        role: "user",
        content: "验证 Cloudflare provider",
        createdAt: "2026-05-01T00:00:00.000Z",
      }],
    };
    const completeSpy = vi.spyOn(CloudflareProvider.prototype, "complete").mockResolvedValue("Cloudflare reply");

    const output = await generateAssistantReply(root, conversation, { projectRoot: root });

    expect(output).toBe("Cloudflare reply");
    expect(completeSpy).toHaveBeenCalledOnce();
    const instance = completeSpy.mock.instances[0];
    expect(instance).toBeInstanceOf(CloudflareProvider);
    expect(Reflect.get(instance, "model")).toBe("@cf/meta/llama-3.1-8b-instruct");
    completeSpy.mockRestore();
  });
});

function createTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-llm-chat-"));
  tempRoots.push(root);
  return root;
}

function writeAgentConfig(root: string, value: unknown): void {
  writeJson(root, "agents/agents.json", value);
}

function writeJson(root: string, relativePath: string, value: unknown): void {
  const file = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
