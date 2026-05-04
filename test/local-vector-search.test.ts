import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { searchLocalVectors, syncLocalVectorIndex, testLocalVectorEmbedding } from "../web/server/services/local-vector-search.js";
import type { SearchIndexEntry } from "../web/server/services/search-index.js";

const tempRoots: string[] = [];
const previousEnv = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in previousEnv)) delete process.env[key];
  }
  Object.assign(process.env, previousEnv);
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("local vector search", () => {
  it("stores chunks in local LanceDB and retrieves matching pages", async () => {
    const sourceVaultRoot = makeRoot("vector-source-");
    const runtimeRoot = makeRoot("vector-runtime-");
    write(sourceVaultRoot, "wiki/concepts/cache.md", "# Cache\n\nRedis cache strategy.");
    const server = await startEmbeddingServer();
    try {
      setVectorEnv(server.url);
      const entry = searchEntry("cache-page", "Cache", "wiki/concepts/cache.md");
      const cfg = { sourceVaultRoot, runtimeRoot, projectRoot: sourceVaultRoot, host: "127.0.0.1", port: 4175, author: "tester" };
      await syncLocalVectorIndex(cfg, [entry]);
      const results = await searchLocalVectors(cfg, "redis cache", 3);
      expect(results[0]?.path).toBe("wiki/concepts/cache.md");
    } finally {
      await new Promise<void>((resolve) => server.close(resolve));
    }
  });

  it("reports a clear error when the endpoint returns an HTML page", async () => {
    const server = await startHtmlServer();
    try {
      setVectorEnv(server.url);
      await expect(testLocalVectorEmbedding()).rejects.toThrow("Embedding endpoint 返回了网页 HTML");
    } finally {
      await new Promise<void>((resolve) => server.close(resolve));
    }
  });

  it("reports the provider error when no embedding channel is available", async () => {
    const server = await startEmbeddingErrorServer();
    try {
      setVectorEnv(server.url);
      await expect(testLocalVectorEmbedding()).rejects.toThrow("model_not_found");
    } finally {
      await new Promise<void>((resolve) => server.close(resolve));
    }
  });
});

function searchEntry(id: string, title: string, filePath: string): SearchIndexEntry {
  return { id, title, path: filePath, layer: "wiki", excerpt: "Redis cache strategy.", tags: [], modifiedAt: null };
}

function makeRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function write(root: string, relativePath: string, content: string): void {
  const filePath = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function setVectorEnv(endpoint: string): void {
  process.env.LLMWIKI_VECTOR_SEARCH_ENABLED = "true";
  process.env.LLMWIKI_EMBEDDING_ENDPOINT = endpoint;
  process.env.LLMWIKI_EMBEDDING_MODEL = "test-embedding";
}

async function startEmbeddingServer(): Promise<http.Server & { url: string }> {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += String(chunk);
    });
    req.on("end", () => {
      const text = JSON.parse(body) as { input?: string };
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ embedding: fakeEmbedding(text.input ?? "") }] }));
    });
  }) as http.Server & { url: string };
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  server.url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/embeddings`;
  return server;
}

async function startHtmlServer(): Promise<http.Server & { url: string }> {
  const server = http.createServer((_req, res) => {
    res.setHeader("content-type", "text/html");
    res.end("<!doctype html><html><body>home</body></html>");
  }) as http.Server & { url: string };
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  server.url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/`;
  return server;
}

async function startEmbeddingErrorServer(): Promise<http.Server & { url: string }> {
  const server = http.createServer((_req, res) => {
    res.statusCode = 503;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      error: {
        code: "model_not_found",
        message: "No available channel for model text-embedding-3-small under group default",
      },
    }));
  }) as http.Server & { url: string };
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  server.url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/embeddings`;
  return server;
}

function fakeEmbedding(text: string): number[] {
  const lower = text.toLowerCase();
  return [lower.includes("redis") ? 1 : 0, lower.includes("cache") ? 1 : 0, 0.1];
}
