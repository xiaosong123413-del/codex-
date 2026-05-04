import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handlePage } from "../web/server/routes/pages.js";

const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("handlePage access retention", () => {
  it("touches related claims after the page response is sent", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-page-access-"));
    tempDirs.push(root);
    fs.mkdirSync(path.join(root, "wiki", "concepts"), { recursive: true });
    fs.mkdirSync(path.join(root, ".llmwiki"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "wiki", "concepts", "redis-cache.md"),
      "---\ntitle: Redis Cache\nsummary: cache\nsources:\n  - a.md\ncreatedAt: 2026-04-19T00:00:00.000Z\nupdatedAt: 2026-04-19T00:00:00.000Z\n---\n\n# Redis Cache\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(root, ".llmwiki", "claims.json"),
      `${JSON.stringify([{
        id: "claim-1",
        conceptSlug: "redis-cache",
        claimKey: "cache-backend",
        claimText: "Project X uses Redis for caching.",
        claimType: "fact",
        sourceFiles: ["a.md"],
        sources: [{
          file: "a.md",
          title: "a.md",
          kind: "external",
          channel: "外部源",
          observedAt: "2026-04-01T00:00:00.000Z",
        }],
        firstSeenAt: "2026-04-01T00:00:00.000Z",
        lastConfirmedAt: "2026-04-01T00:00:00.000Z",
        supportCount: 1,
        contradictionCount: 0,
        confidence: 0.8,
        retention: 0.1,
        status: "stale",
        supersedes: [],
        halfLifeDays: 90,
      }], null, 2)}\n`,
      "utf8",
    );

    const json = vi.fn();
    const claimsPath = path.join(root, ".llmwiki", "claims.json");
    const writeSpy = vi.spyOn(fs, "writeFileSync");
    const handler = handlePage({
      projectRoot: root,
      sourceVaultRoot: root,
      runtimeRoot: root,
      host: "127.0.0.1",
      port: 4175,
      author: "me",
    });

    handler({ query: { path: "wiki/concepts/redis-cache" } } as never, { json, status: vi.fn() } as never);

    expect(json).toHaveBeenCalled();
    expect(writeSpy.mock.calls.some(([filePath]) => String(filePath) === claimsPath)).toBe(false);

    await waitForCondition(() => {
      const claims = JSON.parse(fs.readFileSync(claimsPath, "utf8")) as Array<{
        lastAccessedAt?: string;
        retention: number;
        status: string;
      }>;
      return claims[0]?.retention === 1 && claims[0]?.status === "active";
    });

    const claims = JSON.parse(fs.readFileSync(claimsPath, "utf8")) as Array<{
      lastAccessedAt?: string;
      retention: number;
      status: string;
    }>;

    expect(claims[0]?.lastAccessedAt).toMatch(/^2026|^\d{4}-\d{2}-\d{2}T/);
    expect(claims[0]?.retention).toBe(1);
    expect(claims[0]?.status).toBe("active");
  });
});

async function waitForCondition(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for condition");
}
