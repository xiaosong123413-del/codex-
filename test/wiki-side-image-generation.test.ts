/**
 * Verifies new wiki pages can receive generated side images at creation time
 * without scanning or mutating old pages.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildFrontmatter } from "../src/utils/markdown.js";
import { attachGeneratedWikiSideImage } from "../src/utils/wiki-side-image.js";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("attachGeneratedWikiSideImage", () => {
  it("writes one PNG and returns markdown with side_image frontmatter", async () => {
    const root = makeDir();
    const raw = [
      buildFrontmatter({ title: "个人知识系统", summary: "长期记录与成果库", tags: ["知识管理"] }),
      "",
      "# 个人知识系统",
      "",
      "这是一个关于长期记录、成果库和复盘机制的页面。",
      "",
    ].join("\n");

    const result = await attachGeneratedWikiSideImage(root, "wiki/concepts/pkm.md", raw);

    expect(result.generated).toBe(true);
    expect(result.sideImagePath).toBe("wiki/.page-media/concepts/pkm-auto.png");
    expect(result.content).toContain("side_image: wiki/.page-media/concepts/pkm-auto.png");
    expect(result.content).toContain("side_image_caption: 根据页面内容自动生成的配图。");

    const pngPath = path.join(root, "wiki", ".page-media", "concepts", "pkm-auto.png");
    expect(fs.existsSync(pngPath)).toBe(true);
    expect(readPngSignature(pngPath)).toBe("89504e470d0a1a0a");
  });

  it("does not generate when the new page already has an image", async () => {
    const root = makeDir();
    const raw = `${buildFrontmatter({ title: "已有图片" })}\n\n# 已有图片\n\n![图](./a.png)\n`;

    const result = await attachGeneratedWikiSideImage(root, "wiki/concepts/has-image.md", raw);

    expect(result.generated).toBe(false);
    expect(result.content).toBe(raw);
    expect(fs.existsSync(path.join(root, "wiki", ".page-media"))).toBe(false);
  });
});

function makeDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-side-image-generation-"));
  tempRoots.push(root);
  return root;
}

function readPngSignature(filePath: string): string {
  return fs.readFileSync(filePath).subarray(0, 8).toString("hex");
}
