import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runSearch, type SearchResult } from "../web/server/services/search-router.js";
import { sourceMediaId } from "../web/server/services/source-media-index.js";
import { dedupSearchResults } from "../web/server/services/search-dedup.js";
import { chooseSearchMode } from "../web/server/services/search-intent.js";
import { buildAndSaveSearchIndex } from "../web/server/services/search-index-builder.js";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("search mode routing", () => {
  it("routes direct when the query looks like a path or slug", () => {
    expect(chooseSearchMode("wiki/index.md")).toBe("direct");
    expect(chooseSearchMode("sources_full/clip-note.md")).toBe("direct");
  });

  it("routes keyword for short exact terms", () => {
    expect(chooseSearchMode("Redis")).toBe("keyword");
  });

  it("routes hybrid for natural language questions", () => {
    expect(chooseSearchMode("我最近关于缓存提到过什么模式")).toBe("hybrid");
  });

  it("matches OCR sidecar text for indexed source paths", async () => {
    const sourceVaultRoot = makeRoot("search-source-");
    const runtimeRoot = makeRoot("search-runtime-");
    const sourcePath = "raw/闪念日记/2026-04-27.md";
    const id = sourceMediaId(sourcePath);
    writeJson(runtimeRoot, ".llmwiki/search-index.json", [
      {
        id: "diary-page",
        title: "2026-04-27",
        path: sourcePath,
        layer: "raw",
        excerpt: "普通日记文字",
        tags: [],
      },
    ]);
    writeJson(runtimeRoot, ".llmwiki/source-media-index.json", {
      version: 1,
      generatedAt: "2026-04-27T00:00:00.000Z",
      records: {
        [id]: {
          id,
          path: sourcePath,
          layer: "raw",
          title: "2026-04-27",
          modifiedAt: "2026-04-27T00:00:00.000Z",
          mediaCount: 1,
          mediaKinds: ["image"],
          ocrTextPath: `.llmwiki/ocr/${id}.txt`,
          media: [],
        },
      },
      assets: {},
    });
    write(runtimeRoot, `.llmwiki/ocr/${id}.txt`, "图片里的门牌号 ZX-9");

    const result = await runSearch({
      sourceVaultRoot,
      runtimeRoot,
      host: "127.0.0.1",
      port: 4175,
      author: "tester",
      projectRoot: sourceVaultRoot,
    }, "ZX-9", "keyword");

    expect(result.results.map((item) => item.path)).toEqual([sourcePath]);
  });

  it("matches markdown image alt text and returns image references", async () => {
    const sourceVaultRoot = makeRoot("search-source-");
    const runtimeRoot = makeRoot("search-runtime-");
    write(runtimeRoot, "wiki/reports/q2.md", [
      "# Q2 report",
      "",
      "![Revenue chart showing Q2 revenue from 12M to 18M](wiki/media/q2/image-001.png)",
    ].join("\n"));

    buildAndSaveSearchIndex({
      sourceVaultRoot,
      runtimeRoot,
      host: "127.0.0.1",
      port: 4175,
      author: "tester",
      projectRoot: sourceVaultRoot,
    });

    const result = await runSearch({
      sourceVaultRoot,
      runtimeRoot,
      host: "127.0.0.1",
      port: 4175,
      author: "tester",
      projectRoot: sourceVaultRoot,
    }, "revenue chart", "keyword");

    expect(result.results.map((item) => item.path)).toEqual(["wiki/reports/q2.md"]);
    expect(result.results[0]?.images).toEqual([{
      alt: "Revenue chart showing Q2 revenue from 12M to 18M",
      url: "wiki/media/q2/image-001.png",
    }]);
  });
});

describe("search dedup", () => {
  it("keeps the highest-priority layer among duplicate hits", () => {
    const results: SearchResult[] = [
      {
        id: "source",
        title: "Foo",
        path: "sources_full/foo.md",
        layer: "source",
        excerpt: "source",
        tags: [],
        modifiedAt: null,
        images: [],
      },
      {
        id: "raw",
        title: "Foo",
        path: "raw/剪藏/foo.md",
        layer: "raw",
        excerpt: "raw",
        tags: [],
        modifiedAt: null,
        images: [],
      },
      {
        id: "concept",
        title: "Foo",
        path: "wiki/concepts/foo.md",
        layer: "wiki",
        excerpt: "concept",
        tags: [],
        modifiedAt: null,
        images: [],
      },
      {
        id: "procedure",
        title: "Foo",
        path: "wiki/procedures/foo.md",
        layer: "wiki",
        excerpt: "procedure",
        tags: [],
        modifiedAt: null,
        images: [],
      },
    ];

    const deduped = dedupSearchResults(results);

    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.id).toBe("procedure");
  });
});

function makeRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function write(root: string, relativePath: string, content: string): void {
  const fullPath = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf8");
}

function writeJson(root: string, relativePath: string, value: unknown): void {
  write(root, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}
