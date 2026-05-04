/**
 * Tests for Cloudflare service adapters.
 *
 * All external calls are mocked to verify request shape, response parsing,
 * sidecar writes, and secret redaction without hitting Cloudflare.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudflareProvider } from "../src/providers/cloudflare.js";
import {
  readCloudflareServicesConfig,
  summarizeCloudflareServicesConfig,
} from "../src/utils/cloudflare-services-config.js";
import { getProvider } from "../src/utils/provider.js";
import { embedText, queryVectorSearch, upsertWikiVectorPages } from "../src/services/cloudflare-vector-search.js";
import { searchWeb, searchWebExternal } from "../src/services/cloudflare-web-search.js";
import {
  getSourceOcrSidecarPath,
  readSourceOcrSidecar,
  runCloudflareOcr,
} from "../web/server/services/ocr-service.js";
import {
  readSourceTranscriptSidecar,
  runCloudflareTranscription,
} from "../web/server/services/transcript-service.js";

const roots: string[] = [];
const envBackup = new Map<string, string | undefined>();

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
  restoreEnv();
  vi.unstubAllGlobals();
});

describe("Cloudflare service adapters", () => {
  it("selects the Cloudflare LLM provider and parses Worker responses", async () => {
    stubCloudflareEnv();
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("https://worker.example.com/llm");
      expect(init?.headers).toEqual(expect.objectContaining({
        Authorization: "Bearer remote-secret",
      }));
      expect(String(init?.body)).not.toContain("remote-secret");
      return jsonResponse({ text: "Cloudflare answer" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = getProvider();
    const output = await provider.complete("system", [{ role: "user", content: "hello" }], 100);

    expect(provider).toBeInstanceOf(CloudflareProvider);
    expect(output).toBe("Cloudflare answer");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("calls Cloudflare Workers AI REST when no Worker endpoint is configured", async () => {
    stubCloudflareEnv({
      CLOUDFLARE_WORKER_URL: undefined,
      CLOUDFLARE_REMOTE_TOKEN: undefined,
    });
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe(
        "https://api.cloudflare.com/client/v4/accounts/account-1/ai/run/@cf/test/llm",
      );
      expect(init?.headers).toEqual(expect.objectContaining({
        Authorization: "Bearer api-secret",
      }));
      return jsonResponse({ result: { response: "REST answer" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const output = await new CloudflareProvider("@cf/test/llm").complete("sys", [], 20);

    expect(output).toBe("REST answer");
  });

  it("parses OpenAI-compatible Cloudflare text responses", async () => {
    stubCloudflareEnv({
      CLOUDFLARE_WORKER_URL: undefined,
      CLOUDFLARE_REMOTE_TOKEN: undefined,
    });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      choices: [{
        message: {
          content: [
            { type: "output_text", text: "Cloudflare " },
            { type: "output_text", text: "block answer" },
          ],
        },
      }],
    })));

    const output = await new CloudflareProvider("@cf/test/llm").complete("sys", [], 20);

    expect(output).toBe("Cloudflare block answer");
  });

  it("uses final Workers AI stream text when no OpenAI delta is present", async () => {
    stubCloudflareEnv({
      CLOUDFLARE_WORKER_URL: undefined,
      CLOUDFLARE_REMOTE_TOKEN: undefined,
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      'data: {"result":{"response":"stream final answer"}}\n\ndata: [DONE]\n\n',
      {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      },
    )));
    const tokens: string[] = [];

    const output = await new CloudflareProvider("@cf/test/llm").stream("sys", [], 20, (token) => {
      tokens.push(token);
    });

    expect(output).toBe("stream final answer");
    expect(tokens).toEqual(["stream final answer"]);
  });

  it("redacts configured tokens from summaries", () => {
    stubCloudflareEnv();

    const summary = summarizeCloudflareServicesConfig(readCloudflareServicesConfig());

    expect(JSON.stringify(summary)).not.toContain("api-secret");
    expect(JSON.stringify(summary)).not.toContain("remote-secret");
    expect(summary.apiTokenConfigured).toBe(true);
    expect(summary.remoteTokenConfigured).toBe(true);
  });

  it("writes OCR sidecar on Cloudflare success", async () => {
    stubCloudflareEnv({ CLOUDFLARE_OCR_MODEL: "@cf/test/ocr" });
    const root = makeRoot();
    const filePath = write(root, "raw/image.png", "image-bytes");
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ text: "OCR text" })));

    const result = await runCloudflareOcr({ runtimeRoot: root, sourceId: "source/one", filePath });

    expect(result).toEqual({ ok: true, path: ".llmwiki/ocr/source-one.txt", text: "OCR text" });
    expect(readSourceOcrSidecar(root, "source/one")).toBe("OCR text");
  });

  it("does not write OCR sidecar when Cloudflare is unconfigured", async () => {
    stubCloudflareEnv({
      CLOUDFLARE_WORKER_URL: undefined,
      CLOUDFLARE_REMOTE_TOKEN: undefined,
    });
    const root = makeRoot();
    const filePath = write(root, "raw/image.png", "image-bytes");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await runCloudflareOcr({ wikiRoot: root, sourceId: "source-id", filePath });

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ type: "cloudflare-unconfigured" }),
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(root, ...getSourceOcrSidecarPath("source-id").split("/")))).toBe(false);
  });

  it("writes transcription sidecar on Cloudflare success", async () => {
    stubCloudflareEnv({ CLOUDFLARE_TRANSCRIBE_MODEL: "@cf/test/transcribe" });
    const root = makeRoot();
    const filePath = write(root, "raw/audio.mp3", "audio-bytes");
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ result: { text: "Transcript text" } })));

    const result = await runCloudflareTranscription({ runtimeRoot: root, sourceId: "audio-id", filePath });

    expect(result).toEqual({
      ok: true,
      path: ".llmwiki/transcripts/audio-id.txt",
      text: "Transcript text",
    });
    expect(readSourceTranscriptSidecar(root, "audio-id")).toBe("Transcript text");
  });

  it("parses embedding and vector search Worker responses", async () => {
    stubCloudflareEnv({ CLOUDFLARE_EMBEDDING_MODEL: "@cf/test/embed" });
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith("/embed")) {
        return jsonResponse({ result: { data: [[0.1, 0.2, 0.3]] } });
      }
      return jsonResponse({ matches: [{ id: "doc-1", score: 0.9, metadata: { title: "Doc" } }] });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(embedText("hello")).resolves.toEqual({ ok: true, data: [0.1, 0.2, 0.3] });
    await expect(queryVectorSearch([0.1, 0.2], 3)).resolves.toEqual({
      ok: true,
      data: [{ id: "doc-1", score: 0.9, metadata: { title: "Doc" } }],
    });
  });

  it("skips unchanged wiki pages on repeated vector publish runs", async () => {
    stubCloudflareEnv({
      CLOUDFLARE_EMBEDDING_MODEL: "@cf/test/embed",
      CLOUDFLARE_VECTORIZE_INDEX: "vectors-1",
    });
    const root = makeRoot();
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://worker.example.com/embed") {
        return jsonResponse({ result: { data: [[0.1, 0.2, 0.3]] } });
      }
      if (url === "https://api.cloudflare.com/client/v4/accounts/account-1/vectorize/v2/indexes/vectors-1/upsert?unparsable-behavior=error") {
        expect(init?.method).toBe("POST");
        return jsonResponse({ result: { mutationId: "mutation-1" } });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const pages = [
      {
        path: "wiki/concepts/redis-cache.md",
        title: "Redis Cache",
        hash: "hash-1",
        content: "Redis cache content",
        publishedAt: "2026-04-23T00:00:00.000Z",
      },
    ];

    await expect(upsertWikiVectorPages(pages, { wikiRoot: root })).resolves.toEqual({
      ok: true,
      data: {
        upserted: 1,
        skipped: 0,
        errors: 0,
        mutationIds: ["mutation-1"],
        errorSamples: [],
      },
    });
    await expect(upsertWikiVectorPages(pages, { wikiRoot: root })).resolves.toEqual({
      ok: true,
      data: {
        upserted: 0,
        skipped: 1,
        errors: 0,
        mutationIds: [],
        errorSamples: [],
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fs.existsSync(path.join(root, ".llmwiki", "vector-publish-state.json"))).toBe(true);
  });

  it("parses web search endpoint responses", async () => {
    stubCloudflareEnv({ CLOUDFLARE_SEARCH_ENDPOINT: "https://search.example.com/query" });
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("https://search.example.com/query/");
      expect(JSON.parse(String(init?.body))).toEqual({ query: "query", limit: 2 });
      return jsonResponse({
        results: [{ title: "Result", url: "https://example.com", snippet: "Snippet" }],
      });
    }));

    await expect(searchWeb("query", 2)).resolves.toEqual({
      ok: true,
      data: [{ title: "Result", url: "https://example.com", snippet: "Snippet" }],
    });
  });

  it("normalizes Tavily search endpoint requests", async () => {
    stubCloudflareEnv({
      CLOUDFLARE_SEARCH_ENDPOINT: "https://api.tavily.com",
      CLOUDFLARE_SEARCH_TOKEN: "tavily-secret",
    });
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.tavily.com/search");
      expect(init?.headers).toEqual(expect.objectContaining({
        Authorization: "Bearer tavily-secret",
      }));
      expect(JSON.parse(String(init?.body))).toEqual({
        query: "query",
        max_results: 2,
        search_depth: "advanced",
        include_answer: false,
        include_raw_content: true,
      });
      return jsonResponse({
        results: [{
          title: "Tavily Result",
          url: "https://example.com/tavily",
          content: "Content",
          raw_content: "Raw content",
        }],
      });
    }));

    await expect(searchWebExternal("query", 2)).resolves.toEqual({
      ok: true,
      data: [{ title: "Tavily Result", url: "https://example.com/tavily", snippet: "Raw content" }],
    });
  });

  it("does not fall back to Worker search for external web search when endpoint is missing", async () => {
    stubCloudflareEnv({ CLOUDFLARE_SEARCH_ENDPOINT: undefined });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchWebExternal("query", 2)).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({
        type: "cloudflare-unconfigured",
      }),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("adds a proxy dispatcher to Cloudflare requests when proxy env is configured", async () => {
    stubCloudflareEnv({
      GLOBAL_AGENT_HTTP_PROXY: "http://127.0.0.1:7890",
    });
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init).toEqual(expect.objectContaining({
        dispatcher: expect.anything(),
      }));
      return jsonResponse({ text: "proxied answer" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const output = await new CloudflareProvider("@cf/test/llm").complete("sys", [], 20);

    expect(output).toBe("proxied answer");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

function stubCloudflareEnv(overrides: Record<string, string | undefined> = {}): void {
  stubEnv({
    LLMWIKI_PROVIDER: "cloudflare",
    CLOUDFLARE_ACCOUNT_ID: "account-1",
    CLOUDFLARE_API_TOKEN: "api-secret",
    CLOUDFLARE_WORKER_URL: "https://worker.example.com",
    CLOUDFLARE_REMOTE_TOKEN: "remote-secret",
    CLOUDFLARE_AI_MODEL: "@cf/test/llm",
    CLOUDFLARE_OCR_MODEL: undefined,
    CLOUDFLARE_TRANSCRIBE_MODEL: undefined,
    CLOUDFLARE_EMBEDDING_MODEL: undefined,
    CLOUDFLARE_SEARCH_ENDPOINT: undefined,
    ...overrides,
  });
}

function stubEnv(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    if (!envBackup.has(key)) envBackup.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function restoreEnv(): void {
  for (const [key, value] of envBackup.entries()) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  envBackup.clear();
}

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cloudflare-adapters-"));
  roots.push(root);
  return root;
}

function write(root: string, relativePath: string, content: string): string {
  const file = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
  return file;
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
