import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { checkNoOutlinks } from "../src/linter/rules.js";
import { checkUntraceableMediaReferences } from "../src/linter/media-rules.js";
import { checkLowConfidenceClaims, checkStaleClaims } from "../src/linter/lifecycle-rules.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "lint-media-"));
  await mkdir(path.join(tmpDir, "wiki", "concepts"), { recursive: true });
  await mkdir(path.join(tmpDir, "wiki", "queries"), { recursive: true });
  await mkdir(path.join(tmpDir, "wiki", "procedures"), { recursive: true });
  await mkdir(path.join(tmpDir, "raw"), { recursive: true });
  await mkdir(path.join(tmpDir, "sources_full", "\u9644\u4ef6\u526f\u672c\uff08\u975eMarkdown\uff09"), { recursive: true });
  await mkdir(path.join(tmpDir, ".llmwiki"), { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function writeConcept(slug: string, content: string): Promise<void> {
  await writeFile(path.join(tmpDir, "wiki", "concepts", `${slug}.md`), content, "utf8");
}

describe("checkNoOutlinks", () => {
  it("warns when a wiki page has no outbound wikilinks", async () => {
    await writeConcept("solo", "---\ntitle: Solo\nsummary: page\n---\nPlain body without any links.");

    const results = await checkNoOutlinks(tmpDir);

    expect(results).toHaveLength(1);
    expect(results[0]?.rule).toBe("no-outlinks");
    expect(results[0]?.severity).toBe("warning");
  });
});

describe("checkUntraceableMediaReferences", () => {
  it("accepts an image that exists in sources_full attachments", async () => {
    await writeConcept("page", "---\ntitle: Page\nsummary: ok\n---\n![diagram](redis-cache.png)");
    await writeFile(
      path.join(tmpDir, "sources_full", "\u9644\u4ef6\u526f\u672c\uff08\u975eMarkdown\uff09", "redis-cache.png"),
      "png",
      "utf8",
    );

    const results = await checkUntraceableMediaReferences(tmpDir);
    expect(results).toHaveLength(0);
  });

  it("accepts a remote image URL when it appears in raw markdown", async () => {
    await writeConcept("page", "---\ntitle: Page\nsummary: ok\n---\n![remote](https://img.example.com/cache.png)");
    await writeFile(
      path.join(tmpDir, "raw", "clip.md"),
      "# Clip\n![remote](https://img.example.com/cache.png)\n",
      "utf8",
    );

    const results = await checkUntraceableMediaReferences(tmpDir);
    expect(results).toHaveLength(0);
  });

  it("reports an untraceable image reference", async () => {
    await writeConcept("page", "---\ntitle: Page\nsummary: ok\n---\n![lost](lost.png)");

    const results = await checkUntraceableMediaReferences(tmpDir);

    expect(results).toHaveLength(1);
    expect(results[0]?.rule).toBe("untraceable-image");
    expect(results[0]?.severity).toBe("error");
    expect(results[0]?.message).toContain("lost.png");
  });

  it("reports an untraceable attachment reference", async () => {
    await writeConcept("page", "---\ntitle: Page\nsummary: ok\n---\n[spec](design.pdf)");

    const results = await checkUntraceableMediaReferences(tmpDir);

    expect(results).toHaveLength(1);
    expect(results[0]?.rule).toBe("untraceable-attachment");
  });

  it("reports an untraceable video embed", async () => {
    await writeConcept("page", "---\ntitle: Page\nsummary: ok\n---\n![[demo.mp4]]");

    const results = await checkUntraceableMediaReferences(tmpDir);

    expect(results).toHaveLength(1);
    expect(results[0]?.rule).toBe("untraceable-video");
  });
});

describe("claim lifecycle lint rules", () => {
  it("warns about stale claims", async () => {
    await writeConcept("redis-cache", "---\ntitle: Redis Cache\nsummary: cache\n---\nBody.");
    await writeFile(
      path.join(tmpDir, ".llmwiki", "claims.json"),
      JSON.stringify([{
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
        confidence: 0.52,
        retention: 0.11,
        status: "stale",
        supersedes: [],
        halfLifeDays: 90,
      }], null, 2),
      "utf8",
    );

    const results = await checkStaleClaims(tmpDir);

    expect(results).toHaveLength(1);
    expect(results[0]?.rule).toBe("stale-claim");
    expect(results[0]?.severity).toBe("warning");
  });

  it("surfaces low-confidence active claims", async () => {
    await writeConcept("redis-cache", "---\ntitle: Redis Cache\nsummary: cache\n---\nBody.");
    await writeFile(
      path.join(tmpDir, ".llmwiki", "claims.json"),
      JSON.stringify([{
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
        confidence: 0.35,
        retention: 0.7,
        status: "active",
        supersedes: [],
        halfLifeDays: 90,
      }], null, 2),
      "utf8",
    );

    const results = await checkLowConfidenceClaims(tmpDir);

    expect(results).toHaveLength(1);
    expect(results[0]?.rule).toBe("low-confidence-claim");
    expect(results[0]?.severity).toBe("warning");
  });
});
