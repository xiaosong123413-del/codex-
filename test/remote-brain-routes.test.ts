import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ServerConfig } from "../web/server/config.js";
import {
  handleRemoteBrainPull,
  handleRemoteBrainPublish,
  handleRemoteBrainPush,
  handleRemoteBrainStatus,
} from "../web/server/routes/remote-brain.js";

const roots: string[] = [];
const envBackup = new Map<string, string | undefined>();

beforeEach(() => {
  stubEnv(
    {
      LLMWIKI_REMOTE_PROVIDER: undefined,
      CLOUDFLARE_WORKER_URL: undefined,
      CLOUDFLARE_REMOTE_TOKEN: undefined,
      CLOUDFLARE_API_TOKEN: undefined,
      CLOUDFLARE_ACCOUNT_ID: undefined,
      CLOUDFLARE_D1_DATABASE_ID: undefined,
      CLOUDFLARE_R2_BUCKET: undefined,
      CLOUDFLARE_VECTORIZE_INDEX: undefined,
    },
  );
});

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
  restoreEnv();
  vi.unstubAllGlobals();
});

describe("remote brain routes", () => {
  it("reports cloudflare-unconfigured without calling the worker", async () => {
    const cfg = makeConfig(false);
    const response = createResponse();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await handleRemoteBrainStatus(cfg)({} as Request, response as Response);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: expect.objectContaining({
        mode: "cloudflare-unconfigured",
        connected: false,
        pushSupported: true,
        pullSupported: true,
        publishSupported: true,
      }),
    });
  });

  it("calls the Cloudflare worker for publish when configured", async () => {
    const cfg = makeConfig(true);
    write(cfg.sourceVaultRoot, "wiki/index.md", "# Home\n\nRemote brain page.");
    write(cfg.sourceVaultRoot, "wiki/concepts/cloudflare.md", "# Cloudflare\n\nWorker content.");
    write(cfg.runtimeRoot, ".llmwiki/claims.json", JSON.stringify({ claims: [{ id: "claim-1" }] }));
    const response = createResponse();
    // fallow-ignore-next-line complexity
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://worker.example.com/remote-brain/publish") {
        expect(init?.method).toBe("POST");
        expect(init?.headers).toEqual(
          expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        );
        const body = JSON.parse(String(init?.body));
        expect(body).toEqual(expect.objectContaining({
          action: "publish",
          wikiRoot: path.basename(cfg.sourceVaultRoot),
          publishedAt: expect.any(String),
          files: expect.arrayContaining([
            expect.objectContaining({
              path: "wiki/index.md",
              content: expect.stringContaining("Remote brain page."),
              hash: expect.any(String),
              modifiedAt: expect.any(String),
            }),
            expect.objectContaining({
              path: "wiki/concepts/cloudflare.md",
              content: expect.stringContaining("Worker content."),
            }),
          ]),
          indexFiles: expect.arrayContaining([
            expect.objectContaining({
              path: ".llmwiki/claims.json",
              content: expect.stringContaining("claim-1"),
            }),
          ]),
        }));
        expect(String(init?.body)).not.toContain("test-token");
        return new Response(JSON.stringify({
          ok: true,
          runId: "run-1",
          pageCount: 2,
          indexFileCount: 1,
          vectorUpserted: 0,
          vectorErrors: 0,
          vectorErrorSamples: [],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url === "https://worker.example.com/remote-brain/embed") {
        return new Response(JSON.stringify({ vector: [0.1, 0.2, 0.3] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url === "https://api.cloudflare.com/client/v4/accounts/account-1/vectorize/v2/indexes/vectors-1/upsert?unparsable-behavior=error") {
        expect(init?.method).toBe("POST");
        expect(init?.headers).toEqual(expect.objectContaining({
          Authorization: "Bearer test-api-token",
          "content-type": "application/x-ndjson",
        }));
        const body = String(init?.body);
        expect(body).toContain("\"path\":\"wiki/index.md\"");
        expect(body).toContain("\"path\":\"wiki/concepts/cloudflare.md\"");
        return new Response(JSON.stringify({
          success: true,
          result: { mutationId: "mutation-1" },
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await handleRemoteBrainPublish(cfg)({ body: {} } as Request, response as Response);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        action: "publish",
        mode: "cloudflare-connected",
        queued: false,
        network: true,
        endpoint: "https://worker.example.com/remote-brain/",
        workerResponse: {
          ok: true,
          action: "publish",
          batchCount: 1,
          pageCount: 2,
          indexFileCount: 1,
          vectorUpserted: 2,
          vectorSkipped: 0,
          vectorErrors: 0,
          vectorErrorSamples: [],
          runs: ["run-1", "vector:mutation-1"],
        },
      }),
    }));
  });

  it("skips unchanged vector uploads on a second publish run", async () => {
    const cfg = makeConfig(true);
    write(cfg.sourceVaultRoot, "wiki/index.md", "# Home\n\nRemote brain page.");
    write(cfg.sourceVaultRoot, "wiki/concepts/cloudflare.md", "# Cloudflare\n\nWorker content.");
    write(cfg.runtimeRoot, ".llmwiki/claims.json", JSON.stringify({ claims: [{ id: "claim-1" }] }));
    const firstResponse = createResponse();
    const secondResponse = createResponse();
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://worker.example.com/remote-brain/publish") {
        return new Response(JSON.stringify({
          ok: true,
          runId: "run-1",
          pageCount: 2,
          indexFileCount: 1,
          vectorUpserted: 0,
          vectorErrors: 0,
          vectorErrorSamples: [],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url === "https://worker.example.com/remote-brain/embed") {
        return new Response(JSON.stringify({ vector: [0.1, 0.2, 0.3] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url === "https://api.cloudflare.com/client/v4/accounts/account-1/vectorize/v2/indexes/vectors-1/upsert?unparsable-behavior=error") {
        return new Response(JSON.stringify({
          success: true,
          result: { mutationId: "mutation-1" },
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await handleRemoteBrainPublish(cfg)({ body: {} } as Request, firstResponse as Response);
    await handleRemoteBrainPublish(cfg)({ body: {} } as Request, secondResponse as Response);

    expect(secondResponse.statusCode).toBe(200);
    expect(secondResponse.body).toEqual(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        workerResponse: expect.objectContaining({
          vectorUpserted: 0,
          vectorSkipped: 2,
          vectorErrors: 0,
        }),
      }),
    }));
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("returns a structured error when the worker responds with HTTP failure", async () => {
    const cfg = makeConfig(true);
    const response = createResponse();
    const fetchMock = vi.fn(async () => new Response("boom", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    await handleRemoteBrainPush(cfg)({ body: {} } as Request, response as Response);

    expect(response.statusCode).toBe(502);
    expect(response.body).toEqual({
      success: false,
      error: expect.objectContaining({
        type: "cloudflare-http-error",
        status: 503,
        endpoint: "https://worker.example.com/remote-brain/push",
      }),
      data: expect.objectContaining({
        mode: "cloudflare-error",
        network: true,
      }),
    });
  });

  it("routes pull requests through the worker", async () => {
    const cfg = makeConfig(true);
    const response = createResponse();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, kind: "pull" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await handleRemoteBrainPull(cfg)({ body: {} } as Request, response as Response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: expect.objectContaining({
        action: "pull",
        mode: "cloudflare-connected",
        network: true,
      }),
    });
  });

  it("adds a proxy dispatcher to remote brain worker calls when proxy env is configured", async () => {
    const cfg = makeConfig(true);
    stubEnv({
      GLOBAL_AGENT_HTTP_PROXY: "http://127.0.0.1:7890",
    });
    const response = createResponse();
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init).toEqual(expect.objectContaining({
        dispatcher: expect.anything(),
      }));
      return new Response(JSON.stringify({ ok: true, kind: "status" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await handleRemoteBrainStatus(cfg)({} as Request, response as Response);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(response.statusCode).toBe(200);
  });
});

function makeConfig(configured: boolean): ServerConfig {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "remote-brain-routes-"));
  const sourceVaultRoot = path.join(projectRoot, "source-vault");
  const runtimeRoot = path.join(projectRoot, ".runtime");
  fs.mkdirSync(sourceVaultRoot, { recursive: true });
  fs.mkdirSync(runtimeRoot, { recursive: true });
  roots.push(projectRoot);
  if (configured) {
    stubEnv({
      LLMWIKI_REMOTE_PROVIDER: "cloudflare",
      CLOUDFLARE_WORKER_URL: "https://worker.example.com/remote-brain",
      CLOUDFLARE_REMOTE_TOKEN: "test-token",
      CLOUDFLARE_API_TOKEN: "test-api-token",
      CLOUDFLARE_ACCOUNT_ID: "account-1",
      CLOUDFLARE_D1_DATABASE_ID: "d1-1",
      CLOUDFLARE_R2_BUCKET: "bucket-1",
      CLOUDFLARE_VECTORIZE_INDEX: "vectors-1",
    });
  }
  return {
    projectRoot,
    sourceVaultRoot,
    runtimeRoot,
    host: "127.0.0.1",
    port: 4175,
    author: "test",
  };
}

function createResponse() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}

function stubEnv(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    if (!envBackup.has(key)) {
      envBackup.set(key, process.env[key]);
    }
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

function write(root: string, relativePath: string, content: string): void {
  const filePath = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}
