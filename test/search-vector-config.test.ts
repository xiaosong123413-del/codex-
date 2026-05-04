/**
 * Verifies local vector-search configuration normalization.
 *
 * These cases cover the settings UI contract for OpenAI-compatible relay
 * services: users may paste either a provider base URL or the final embeddings
 * endpoint, and the server stores the endpoint used by embedding requests.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { saveLocalVectorConfig } from "../web/server/services/search-vector-config.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("search vector config", () => {
  it("accepts an OpenAI-compatible base URL and stores the embeddings endpoint", () => {
    const projectRoot = makeRoot("vector-config-");
    const env: NodeJS.ProcessEnv = {};

    const config = saveLocalVectorConfig(projectRoot, {
      enabled: true,
      endpoint: "https://relay.example.com/v1",
      apiKey: "secret",
      model: "text-embedding-3-large",
    }, env);

    expect(config.endpoint).toBe("https://relay.example.com/v1/embeddings");
    expect(config.enabled).toBe(true);
    expect(config.model).toBe("text-embedding-3-large");
  });

  it("keeps a full embeddings endpoint unchanged", () => {
    const projectRoot = makeRoot("vector-config-");
    const env: NodeJS.ProcessEnv = {};

    const config = saveLocalVectorConfig(projectRoot, {
      enabled: true,
      endpoint: "https://relay.example.com/v1/embeddings",
      model: "provider/text-embedding-3-large",
    }, env);

    expect(config.endpoint).toBe("https://relay.example.com/v1/embeddings");
  });

  it("stores the embedding source for local service selection", () => {
    const projectRoot = makeRoot("vector-config-");
    const env: NodeJS.ProcessEnv = {};

    const config = saveLocalVectorConfig(projectRoot, {
      enabled: true,
      source: "local",
      endpoint: "http://127.0.0.1:8011",
      model: "Qwen3-Embedding-8B",
    }, env);

    expect(config.source).toBe("local");
    expect(config.endpoint).toBe("http://127.0.0.1:8011/v1/embeddings");
  });

  it("accepts the whatai relay root URL for embeddings", () => {
    const projectRoot = makeRoot("vector-config-");
    const env: NodeJS.ProcessEnv = {};

    const config = saveLocalVectorConfig(projectRoot, {
      enabled: true,
      endpoint: "https://api.whatai.cc",
      model: "text-embedding-3-large",
    }, env);

    expect(config.endpoint).toBe("https://api.whatai.cc/v1/embeddings");
  });

  it("treats a trailing slash relay URL as a provider root", () => {
    const projectRoot = makeRoot("vector-config-");
    const env: NodeJS.ProcessEnv = {};

    const config = saveLocalVectorConfig(projectRoot, {
      enabled: true,
      endpoint: "https://xiaoma.best/",
      model: "text-embedding-3-small",
    }, env);

    expect(config.endpoint).toBe("https://xiaoma.best/v1/embeddings");
  });
});

function makeRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}
