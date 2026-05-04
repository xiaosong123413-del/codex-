/**
 * Cloudflare mobile sync proxy regression tests.
 *
 * The desktop app stores network proxy settings in the project `.env`, while
 * ad-hoc publish calls may not have those values loaded into process.env.
 * These tests keep Cloudflare publishing on the same proxy path as the app.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

const ENV_KEYS = [
  "CLOUDFLARE_WORKER_URL",
  "CLOUDFLARE_REMOTE_TOKEN",
  "CLOUDFLARE_ACCOUNT_SESSION_TOKEN",
  "CLOUDFLARE_WORKSPACE_ID",
  "GLOBAL_AGENT_HTTP_PROXY",
  "GLOBAL_AGENT_HTTPS_PROXY",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "https_proxy",
  "http_proxy",
] as const;

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock("undici");
});

describe("cloudflare mobile sync proxy configuration", () => {
  test("uses the project .env proxy for wiki publishing when process env has no proxy", async () => {
    const restoreEnv = clearEnvForTest();
    const projectRoot = tempDir();
    const vaultRoot = tempDir();
    const proxyUrls: string[] = [];
    const undiciFetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, pageCount: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.doMock("undici", () => ({
      ProxyAgent: class FakeProxyAgent {
        constructor(proxyUrl: string) {
          proxyUrls.push(proxyUrl);
        }
      },
      fetch: undiciFetch,
    }));
    fs.writeFileSync(
      path.join(projectRoot, ".env"),
      [
        "CLOUDFLARE_WORKER_URL=https://worker.example.com",
        "CLOUDFLARE_REMOTE_TOKEN=test-token",
        "GLOBAL_AGENT_HTTP_PROXY=http://127.0.0.1:7890",
      ].join("\n"),
      "utf8",
    );
    fs.mkdirSync(path.join(vaultRoot, "wiki"), { recursive: true });
    fs.writeFileSync(path.join(vaultRoot, "wiki", "index.md"), "# Index\n\nProxy publish.\n", "utf8");

    try {
      const { publishWikiToCloudflare } = await import("../scripts/sync-compile/cloudflare-mobile-sync.mjs");
      const result = await publishWikiToCloudflare({
        projectRoot,
        vaultRoot,
        version: "2026-04-30T01:00:00.000Z",
      });

      expect(result).toEqual(expect.objectContaining({ publishedCount: 1, skipped: false }));
      expect(undiciFetch).toHaveBeenCalledOnce();
      expect(proxyUrls).toEqual(["http://127.0.0.1:7890"]);
    } finally {
      restoreEnv();
    }
  });
});

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-cloudflare-proxy-"));
}

function clearEnvForTest(): () => void {
  const previous = new Map<string, string | undefined>();
  for (const key of ENV_KEYS) {
    previous.set(key, process.env[key]);
    delete process.env[key];
  }
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}
