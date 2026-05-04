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

describe("handlePage render cache", () => {
  it("reuses the rendered page when the file has not changed", () => {
    const sourceVaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-page-cache-source-"));
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-page-cache-runtime-"));
    tempDirs.push(sourceVaultRoot, runtimeRoot);
    fs.mkdirSync(path.join(runtimeRoot, "wiki"), { recursive: true });
    const pagePath = path.join(runtimeRoot, "wiki", "index.md");
    fs.writeFileSync(pagePath, "# Index\n\nCached page.\n", "utf8");

    const readSpy = vi.spyOn(fs, "readFileSync");
    const handler = handlePage({
      projectRoot: runtimeRoot,
      sourceVaultRoot,
      runtimeRoot,
      host: "127.0.0.1",
      port: 4175,
      author: "me",
    });

    const firstJson = vi.fn();
    const secondJson = vi.fn();
    handler({ query: { path: "wiki/index.md" } } as never, { json: firstJson, status: vi.fn() } as never);
    handler({ query: { path: "wiki/index.md" } } as never, { json: secondJson, status: vi.fn() } as never);

    const pageReads = readSpy.mock.calls.filter(([filePath]) => String(filePath) === pagePath);
    expect(firstJson).toHaveBeenCalled();
    expect(secondJson).toHaveBeenCalled();
    expect(pageReads).toHaveLength(1);
  });

  it("marks source-backed wiki pages editable and runtime-only wiki index pages non-editable", () => {
    const sourceVaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-source-editable-source-"));
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-source-editable-runtime-"));
    tempDirs.push(sourceVaultRoot, runtimeRoot);

    fs.mkdirSync(path.join(sourceVaultRoot, "wiki", "concepts"), { recursive: true });
    fs.mkdirSync(path.join(runtimeRoot, "wiki"), { recursive: true });
    fs.writeFileSync(path.join(sourceVaultRoot, "wiki", "concepts", "test.md"), "# Test\n\nSource page.\n", "utf8");
    fs.writeFileSync(path.join(runtimeRoot, "wiki", "index.md"), "# Index\n\nRuntime page.\n", "utf8");

    const handler = handlePage({
      projectRoot: runtimeRoot,
      sourceVaultRoot,
      runtimeRoot,
      host: "127.0.0.1",
      port: 4175,
      author: "me",
    });

    const sourceJson = vi.fn();
    const runtimeJson = vi.fn();

    handler({ query: { path: "wiki/concepts/test.md" } } as never, { json: sourceJson, status: vi.fn() } as never);
    handler({ query: { path: "wiki/index.md" } } as never, { json: runtimeJson, status: vi.fn() } as never);

    expect(sourceJson).toHaveBeenCalledWith(expect.objectContaining({
      path: "wiki/concepts/test.md",
      sourceEditable: true,
    }));
    expect(runtimeJson).toHaveBeenCalledWith(expect.objectContaining({
      path: "wiki/index.md",
      sourceEditable: false,
    }));
  });

  it("omits raw markdown when the page route is requested in lightweight mode", () => {
    const sourceVaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-page-light-source-"));
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-page-light-runtime-"));
    tempDirs.push(sourceVaultRoot, runtimeRoot);

    fs.mkdirSync(path.join(runtimeRoot, "wiki"), { recursive: true });
    fs.writeFileSync(path.join(runtimeRoot, "wiki", "index.md"), "# Index\n\nRuntime page.\n", "utf8");

    const handler = handlePage({
      projectRoot: runtimeRoot,
      sourceVaultRoot,
      runtimeRoot,
      host: "127.0.0.1",
      port: 4175,
      author: "me",
    });
    const json = vi.fn();

    handler({ query: { path: "wiki/index.md", raw: "0" } } as never, { json, status: vi.fn() } as never);

    expect(json).toHaveBeenCalledWith(expect.not.objectContaining({ raw: expect.any(String) }));
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      path: "wiki/index.md",
      html: expect.stringContaining("Runtime page."),
    }));
  });

  it("returns YAML frontmatter arrays for page previews", () => {
    const sourceVaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-page-frontmatter-source-"));
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llmwiki-page-frontmatter-runtime-"));
    tempDirs.push(sourceVaultRoot, runtimeRoot);

    fs.mkdirSync(path.join(runtimeRoot, "wiki"), { recursive: true });
    fs.writeFileSync(path.join(runtimeRoot, "wiki", "alpha.md"), [
      "---",
      "title: Alpha",
      "type: concept",
      "tags:",
      "  - one",
      "  - two",
      "sources:",
      "  - source.md",
      "related:",
      "  - Beta",
      "---",
      "# Alpha",
      "",
      "Body.",
    ].join("\n"), "utf8");

    const handler = handlePage({
      projectRoot: runtimeRoot,
      sourceVaultRoot,
      runtimeRoot,
      host: "127.0.0.1",
      port: 4175,
      author: "me",
    });
    const json = vi.fn();

    handler({ query: { path: "wiki/alpha.md", raw: "0" } } as never, { json, status: vi.fn() } as never);

    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      frontmatter: expect.objectContaining({
        title: "Alpha",
        type: "concept",
        tags: ["one", "two"],
        sources: ["source.md"],
        related: ["Beta"],
      }),
    }));
  });
});
