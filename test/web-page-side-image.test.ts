import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  handlePageSideImageMedia,
  handlePageSideImageUpload,
} from "../web/server/routes/page-side-image.js";

const tempDirs: string[] = [];
const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn1s9sAAAAASUVORK5CYII=";

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("handlePageSideImageUpload", () => {
  it("stores the uploaded image under wiki page media and writes side_image frontmatter", () => {
    const sourceVaultRoot = makeDir("llmwiki-side-image-source-");
    const runtimeRoot = makeDir("llmwiki-side-image-runtime-");
    const pagePath = path.join(sourceVaultRoot, "wiki", "concepts", "sample.md");
    fs.mkdirSync(path.dirname(pagePath), { recursive: true });
    fs.writeFileSync(pagePath, "# Sample\n\nBody\n", "utf8");

    const handler = handlePageSideImageUpload(makeServerConfig(sourceVaultRoot, runtimeRoot));
    const json = vi.fn();

    handler(
      {
        body: {
          path: "wiki/concepts/sample.md",
          fileName: "cover.png",
          dataUrl: PNG_DATA_URL,
        },
      } as never,
      { json, status: vi.fn() } as never,
    );

    const updatedRaw = fs.readFileSync(pagePath, "utf8");
    expect(updatedRaw).toContain("side_image: wiki/.page-media/concepts/sample-side.png");

    const storedImage = path.join(sourceVaultRoot, "wiki", ".page-media", "concepts", "sample-side.png");
    expect(fs.existsSync(storedImage)).toBe(true);
    expect(fs.statSync(storedImage).size).toBeGreaterThan(0);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        path: "wiki/concepts/sample.md",
        sideImagePath: "wiki/.page-media/concepts/sample-side.png",
      }),
    }));
  });

  it("can write avatar_image frontmatter for identity profile avatars", () => {
    const sourceVaultRoot = makeDir("llmwiki-avatar-image-source-");
    const runtimeRoot = makeDir("llmwiki-avatar-image-runtime-");
    const pagePath = path.join(sourceVaultRoot, "wiki", "个人身份信息档案.md");
    fs.mkdirSync(path.dirname(pagePath), { recursive: true });
    fs.writeFileSync(pagePath, "# 个人身份信息档案\n", "utf8");

    const handler = handlePageSideImageUpload(makeServerConfig(sourceVaultRoot, runtimeRoot));
    const json = vi.fn();

    handler(
      {
        body: {
          path: "wiki/个人身份信息档案.md",
          fileName: "avatar.png",
          dataUrl: PNG_DATA_URL,
          frontmatterKey: "avatar_image",
        },
      } as never,
      { json, status: vi.fn() } as never,
    );

    const updatedRaw = fs.readFileSync(pagePath, "utf8");
    expect(updatedRaw).toContain("avatar_image: wiki/.page-media/个人身份信息档案-avatar.png");
    expect(updatedRaw).not.toContain("side_image:");

    const storedImage = path.join(sourceVaultRoot, "wiki", ".page-media", "个人身份信息档案-avatar.png");
    expect(fs.existsSync(storedImage)).toBe(true);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        sideImagePath: "wiki/.page-media/个人身份信息档案-avatar.png",
      }),
    }));
  });
});

describe("handlePageSideImageMedia", () => {
  it("serves stored wiki side-image assets", () => {
    const sourceVaultRoot = makeDir("llmwiki-side-image-media-source-");
    const runtimeRoot = makeDir("llmwiki-side-image-media-runtime-");
    const mediaPath = path.join(sourceVaultRoot, "wiki", ".page-media", "concepts", "sample-side.png");
    fs.mkdirSync(path.dirname(mediaPath), { recursive: true });
    fs.writeFileSync(mediaPath, Buffer.from("png"));

    const handler = handlePageSideImageMedia(makeServerConfig(sourceVaultRoot, runtimeRoot));
    const sendFile = vi.fn();

    handler(
      { query: { path: "wiki/.page-media/concepts/sample-side.png" } } as never,
      { sendFile, status: vi.fn() } as never,
    );

    expect(sendFile).toHaveBeenCalledWith(mediaPath);
  });
});

function makeDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function makeServerConfig(sourceVaultRoot: string, runtimeRoot: string) {
  return {
    sourceVaultRoot,
    runtimeRoot,
    projectRoot: runtimeRoot,
    host: "127.0.0.1",
    port: 4175,
    author: "me",
  };
}
