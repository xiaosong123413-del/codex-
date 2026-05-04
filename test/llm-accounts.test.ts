import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  readLlmApiAccount,
  saveLlmApiAccount,
  startLlmApiAccount,
} from "../web/server/services/llm-accounts.js";

describe("llm api accounts", () => {
  it("normalizes existing relay account urls for runtime use", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-llm-accounts-"));
    writeAccounts(root, {
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

    const account = readLlmApiAccount(root, "relay:-");

    expect(account?.url).toBe("https://xiaoma.best/v1");
  });

  it("normalizes relay account urls when saving from settings", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-llm-accounts-"));

    const saved = saveLlmApiAccount(root, {
      provider: "relay",
      name: "Relay",
      url: "https://xiaoma.best",
      key: "relay-key",
      model: "claude-sonnet-4-20250514",
    });

    expect(saved.url).toBe("https://xiaoma.best/v1");
    const stored = JSON.parse(fs.readFileSync(path.join(root, ".llmwiki", "llm-accounts.json"), "utf8")) as {
      accounts: Array<{ url: string }>;
    };
    expect(stored.accounts[0]?.url).toBe("https://xiaoma.best/v1");
  });

  it("infers whatai relay accounts from the base URL", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-llm-accounts-"));

    const saved = saveLlmApiAccount(root, {
      provider: "custom",
      name: "神马中转",
      url: "https://api.whatai.cc",
      key: "relay-key",
      model: "gpt-4o",
    });

    expect(saved.provider).toBe("relay");
    expect(saved.url).toBe("https://api.whatai.cc/v1");
  });

  it("infers NVIDIA provider from its base URL when OpenAI is selected", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-llm-accounts-"));

    const saved = saveLlmApiAccount(root, {
      provider: "openai",
      name: "NVIDIA",
      url: "https://integrate.api.nvidia.com/v1",
      key: "nvapi-key",
    });

    expect(saved.provider).toBe("nvidia");
    expect(saved.model).toBe("meta/llama-3.3-70b-instruct");
  });

  it("starts a disabled account by enabling it in storage", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-llm-accounts-"));
    writeAccounts(root, {
      accounts: [{
        id: "relay:-",
        name: "Relay",
        provider: "relay",
        url: "https://xiaoma.best/v1",
        key: "relay-key",
        model: "claude-sonnet-4-20250514",
        enabled: false,
        updatedAt: "2026-04-24T00:00:00.000Z",
      }],
    });

    const started = startLlmApiAccount(root, { id: "relay:-" });

    expect(started.enabled).toBe(true);
    expect(readLlmApiAccount(root, "relay:-")?.enabled).toBe(true);
  });
});

function writeAccounts(root: string, value: unknown): void {
  const file = path.join(root, ".llmwiki", "llm-accounts.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
