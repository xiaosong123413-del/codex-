import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { captionMarkdownImages } from "../web/server/services/image-caption-pipeline.js";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("image caption pipeline", () => {
  it("writes captions into markdown alt text and caches by image bytes", async () => {
    const sourceVaultRoot = makeRoot("caption-source-");
    const runtimeRoot = makeRoot("caption-runtime-");
    write(runtimeRoot, "wiki/media/q2/image-001.png", "same-image-bytes");
    const markdown = "Before\n![](wiki/media/q2/image-001.png)\nAfter";
    let calls = 0;

    const first = await captionMarkdownImages({
      sourceVaultRoot,
      runtimeRoot,
      markdownPath: "wiki/reports/q2.md",
      markdown,
      captionImage: async (request) => {
        calls += 1;
        expect(request.mimeType).toBe("image/png");
        expect(request.context).toContain("Before");
        return "Revenue chart showing Q2 growth";
      },
    });

    const second = await captionMarkdownImages({
      sourceVaultRoot,
      runtimeRoot,
      markdownPath: "wiki/reports/q2.md",
      markdown,
      captionImage: async () => {
        throw new Error("caption should come from cache");
      },
    });

    expect(first.markdown).toContain("![Revenue chart showing Q2 growth](wiki/media/q2/image-001.png)");
    expect(first.captioned).toBe(1);
    expect(second.cached).toBe(1);
    expect(second.markdown).toBe(first.markdown);
    expect(calls).toBe(1);
  });

  it("skips existing alt text unless overwrite is enabled", async () => {
    const sourceVaultRoot = makeRoot("caption-source-");
    const runtimeRoot = makeRoot("caption-runtime-");
    write(runtimeRoot, "wiki/media/q2/image-001.png", "image");
    const markdown = "![Existing caption](wiki/media/q2/image-001.png)";

    const result = await captionMarkdownImages({
      sourceVaultRoot,
      runtimeRoot,
      markdownPath: "wiki/reports/q2.md",
      markdown,
      captionImage: async () => "New caption",
    });

    expect(result.markdown).toBe(markdown);
    expect(result.skipped).toBe(1);
    expect(result.attempted).toBe(0);
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
  fs.writeFileSync(fullPath, content);
}
