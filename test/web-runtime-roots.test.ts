import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseArgs } from "../web/server/config.js";
import { findPage } from "../web/server/render/markdown.js";
import { handlePage } from "../web/server/routes/pages.js";
import { loadSearchIndex } from "../web/server/services/search-index.js";

const tempDirs: string[] = [];
let previousCwd: string | null = null;

afterEach(() => {
  if (previousCwd !== null) {
    process.chdir(previousCwd);
    previousCwd = null;
  }

  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("web runtime roots", () => {
  it("parses explicit source and runtime roots from CLI flags", () => {
    const projectRoot = makeDir("llmwiki-web-config-project-");
    const sourceVaultRoot = path.join(projectRoot, "source-vault");
    const runtimeRoot = path.join(projectRoot, "runtime-root");
    fs.mkdirSync(sourceVaultRoot, { recursive: true });
    fs.mkdirSync(runtimeRoot, { recursive: true });
    fs.mkdirSync(path.join(projectRoot, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "package.json"), "{}\n", "utf8");
    fs.writeFileSync(path.join(projectRoot, "scripts", "sync-compile.mjs"), "", "utf8");

    previousCwd = process.cwd();
    process.chdir(projectRoot);

    const cfg = parseArgs([
      "node",
      "server/index.ts",
      "--source-vault",
      sourceVaultRoot,
      "--runtime-root",
      runtimeRoot,
      "--port",
      "4312",
      "--host",
      "0.0.0.0",
      "--author",
      "tester",
    ]);

    expect(cfg).toMatchObject({
      sourceVaultRoot: path.resolve(sourceVaultRoot),
      runtimeRoot: path.resolve(runtimeRoot),
      projectRoot,
      port: 4312,
      host: "0.0.0.0",
      author: "tester",
    });
    expect("wikiRoot" in cfg).toBe(false);
  });

  it("reads source-backed pages from the source vault and falls back to runtime pages", () => {
    const sourceVaultRoot = makeDir("llmwiki-web-source-vault-");
    const runtimeRoot = makeDir("llmwiki-web-runtime-root-");
    fs.mkdirSync(path.join(sourceVaultRoot, "wiki", "concepts"), { recursive: true });
    fs.mkdirSync(path.join(runtimeRoot, "wiki"), { recursive: true });
    fs.writeFileSync(path.join(sourceVaultRoot, "wiki", "concepts", "person.md"), "# Person\n\nSource vault page.\n", "utf8");
    fs.writeFileSync(path.join(sourceVaultRoot, "wiki", "index.md"), "# Source Index\n", "utf8");
    fs.writeFileSync(path.join(runtimeRoot, "wiki", "index.md"), "# Runtime Index\n", "utf8");

    const handler = handlePage(makeServerConfig(sourceVaultRoot, runtimeRoot));

    const sourceJson = captureJson();
    handler({ query: { path: "wiki/concepts/person.md" } } as never, sourceJson.response as never);
    expect(sourceJson.body?.path).toBe("wiki/concepts/person.md");
    expect(sourceJson.body?.raw).toContain("Source vault page.");

    const runtimeJson = captureJson();
    handler({ query: { path: "wiki/index.md" } } as never, runtimeJson.response as never);
    expect(runtimeJson.body?.path).toBe("wiki/index.md");
    expect(runtimeJson.body?.raw).toContain("Source Index");
    expect(runtimeJson.body?.raw).not.toContain("Runtime Index");
  });

  it("reads runtime-only wiki pages from the runtime root when the source vault does not contain them", () => {
    const sourceVaultRoot = makeDir("llmwiki-web-source-vault-runtime-page-");
    const runtimeRoot = makeDir("llmwiki-web-runtime-root-runtime-page-");
    fs.mkdirSync(path.join(sourceVaultRoot, "wiki"), { recursive: true });
    fs.mkdirSync(path.join(runtimeRoot, "wiki", "generated"), { recursive: true });
    fs.writeFileSync(
      path.join(runtimeRoot, "wiki", "generated", "runtime-only.md"),
      "# Runtime Only\n\nServed from runtime.\n",
      "utf8",
    );

    const handler = handlePage(makeServerConfig(sourceVaultRoot, runtimeRoot));
    const runtimeJson = captureJson();
    handler({ query: { path: "wiki/generated/runtime-only.md" } } as never, runtimeJson.response as never);

    expect(runtimeJson.body?.path).toBe("wiki/generated/runtime-only.md");
    expect(runtimeJson.body?.raw).toContain("Served from runtime.");
  });

  it("prefers the source wiki homepage for directory requests when it exists", () => {
    const sourceVaultRoot = makeDir("llmwiki-web-source-vault-dir-");
    const runtimeRoot = makeDir("llmwiki-web-runtime-root-dir-");
    fs.mkdirSync(path.join(sourceVaultRoot, "wiki"), { recursive: true });
    fs.mkdirSync(path.join(runtimeRoot, "wiki"), { recursive: true });
    fs.writeFileSync(path.join(sourceVaultRoot, "wiki", "index.md"), "# Source Index\n", "utf8");
    fs.writeFileSync(path.join(runtimeRoot, "wiki", "index.md"), "# Runtime Index\n", "utf8");

    const handler = handlePage(makeServerConfig(sourceVaultRoot, runtimeRoot));

    const runtimeJson = captureJson();
    handler({ query: { path: "wiki" } } as never, runtimeJson.response as never);

    expect(runtimeJson.body?.path).toBe("wiki/index.md");
    expect(runtimeJson.body?.raw).toContain("Source Index");
    expect(runtimeJson.body?.raw).not.toContain("Runtime Index");
  });

  it("loads the search index from the runtime root", () => {
    const sourceVaultRoot = makeDir("llmwiki-search-source-vault-");
    const runtimeRoot = makeDir("llmwiki-search-runtime-root-");
    fs.mkdirSync(path.join(sourceVaultRoot, ".llmwiki"), { recursive: true });
    fs.mkdirSync(path.join(runtimeRoot, ".llmwiki"), { recursive: true });
    fs.writeFileSync(
      path.join(sourceVaultRoot, ".llmwiki", "search-index.json"),
      JSON.stringify([{ id: "source", title: "Source", path: "wiki/source.md", layer: "wiki", excerpt: "", tags: [] }]),
      "utf8",
    );
    fs.writeFileSync(
      path.join(runtimeRoot, ".llmwiki", "search-index.json"),
      JSON.stringify([{ id: "runtime", title: "Runtime", path: "wiki/index.md", layer: "wiki", excerpt: "", tags: [] }]),
      "utf8",
    );

    const entries = loadSearchIndex(makeServerConfig(sourceVaultRoot, runtimeRoot));

    expect(entries).toEqual([
      {
        id: "runtime",
        title: "Runtime",
        path: "wiki/index.md",
        layer: "wiki",
        excerpt: "",
        tags: [],
        modifiedAt: null,
      },
    ]);
  });

  it("rejects identical source and runtime roots in CLI args", () => {
    const projectRoot = makeDir("llmwiki-web-config-same-roots-");
    const sharedRoot = path.join(projectRoot, "shared-root");
    fs.mkdirSync(sharedRoot, { recursive: true });
    fs.mkdirSync(path.join(projectRoot, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "package.json"), "{}\n", "utf8");
    fs.writeFileSync(path.join(projectRoot, "scripts", "sync-compile.mjs"), "", "utf8");

    previousCwd = process.cwd();
    process.chdir(projectRoot);

    expectParseArgsExit([
      "node",
      "server/index.ts",
      "--source-vault",
      sharedRoot,
      "--runtime-root",
      sharedRoot,
    ], "must not be the same");
  });

  it("rejects nested source and runtime roots in CLI args", () => {
    const projectRoot = makeDir("llmwiki-web-config-nested-roots-");
    const sourceVaultRoot = path.join(projectRoot, "source-vault");
    const runtimeRoot = path.join(sourceVaultRoot, "runtime-root");
    fs.mkdirSync(runtimeRoot, { recursive: true });
    fs.mkdirSync(path.join(projectRoot, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "package.json"), "{}\n", "utf8");
    fs.writeFileSync(path.join(projectRoot, "scripts", "sync-compile.mjs"), "", "utf8");

    previousCwd = process.cwd();
    process.chdir(projectRoot);

    expectParseArgsExit([
      "node",
      "server/index.ts",
      "--source-vault",
      sourceVaultRoot,
      "--runtime-root",
      runtimeRoot,
    ], "inside");
  });

  it("keeps wikilink page lookup inside the wiki namespace", () => {
    const sourceVaultRoot = makeDir("llmwiki-web-find-page-source-");
    fs.mkdirSync(path.join(sourceVaultRoot, "wiki", "concepts"), { recursive: true });
    fs.mkdirSync(path.join(sourceVaultRoot, "raw"), { recursive: true });
    fs.writeFileSync(path.join(sourceVaultRoot, "wiki", "concepts", "inside.md"), "# Inside\n", "utf8");
    fs.writeFileSync(path.join(sourceVaultRoot, "log.md"), "# Outside root\n", "utf8");
    fs.writeFileSync(path.join(sourceVaultRoot, "raw", "outside.md"), "# Outside raw\n", "utf8");

    expect(findPage(sourceVaultRoot, "inside")).toBe(path.join(sourceVaultRoot, "wiki", "concepts", "inside.md"));
    expect(findPage(sourceVaultRoot, "log")).toBeNull();
    expect(findPage(sourceVaultRoot, "outside")).toBeNull();
  });
});

function captureJson(): {
  body: unknown;
  response: {
    json: (body: unknown) => void;
    status: () => { json: (body: unknown) => void };
  };
} {
  let body: unknown;
  return {
    get body() {
      return body;
    },
    response: {
      json(nextBody: unknown) {
        body = nextBody;
      },
      status() {
        return {
          json(nextBody: unknown) {
            body = nextBody;
          },
        };
      },
    },
  };
}

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

function expectParseArgsExit(argv: string[], expectedMessage: string): void {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
  const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
    throw new Error(`process.exit:${code ?? ""}`);
  }) as never);

  try {
    expect(() => parseArgs(argv)).toThrow("process.exit:1");
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining(expectedMessage));
  } finally {
    exitSpy.mockRestore();
    consoleError.mockRestore();
    consoleLog.mockRestore();
  }
}
