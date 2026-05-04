import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  buildImportedFilename,
  inspectSourceFolders,
  syncMarkdownSources,
  syncNonMarkdownAssets,
} from "../scripts/sync-compile/sync-files.mjs";
import {
  canClearStaleLock,
  createLockFileContent,
  formatLockOwner,
} from "../scripts/sync-compile/lock.mjs";

async function makeTempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("sync compile raw sync", () => {
  let tempDir = "";

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  it("creates collision-safe filenames from source roots", () => {
    const one = buildImportedFilename("\u6982\u5ff5/README.md");
    const two = buildImportedFilename("\u9879\u76ee/README.md");

    expect(one).not.toBe(two);
    expect(one.endsWith(".md")).toBe(true);
  });

  it("syncs markdown files from multiple roots and writes a manifest", async () => {
    tempDir = await makeTempDir("sync-files-");
    const sourceA = path.join(tempDir, "source-a");
    const sourceB = path.join(tempDir, "source-b");
    const vault = path.join(tempDir, "vault");
    await mkdir(path.join(sourceA, ".obsidian"), { recursive: true });
    await mkdir(path.join(sourceB, "\u6982\u5ff5"), { recursive: true });
    await mkdir(vault, { recursive: true });

    await writeFile(path.join(sourceA, "README.md"), "# a\n", "utf8");
    await writeFile(path.join(sourceA, ".obsidian", "hidden.md"), "# hidden\n", "utf8");
    await writeFile(path.join(sourceB, "\u6982\u5ff5", "README.md"), "# b\n", "utf8");

    const imported = await syncMarkdownSources([sourceA, sourceB], vault, [".obsidian"]);
    const manifest = await readFile(path.join(vault, "raw_import_manifest.csv"), "utf8");
    const guide = await readFile(
      path.join(vault, "sources_full", "00-\u5168\u91cf\u539f\u6599\u4ed3\u8bf4\u660e.txt"),
      "utf8",
    );

    expect(imported).toBe(2);
    expect(manifest).toContain("source_root");
    expect(manifest).toContain("README.md");
    expect(guide).toContain("\u5168\u91cf Markdown \u539f\u6599\u4ed3");
    expect(guide).toContain("\u5206\u6279\u7f16\u8bd1");
  });

  it("writes sync artifacts into the runtime root without mutating the source vault", async () => {
    tempDir = await makeTempDir("sync-runtime-root-");
    const sourceRoot = path.join(tempDir, "source");
    const sourceVaultRoot = path.join(tempDir, "source-vault");
    const runtimeRoot = path.join(tempDir, "runtime");
    await mkdir(sourceRoot, { recursive: true });
    await mkdir(path.join(sourceVaultRoot, "wiki"), { recursive: true });
    await mkdir(runtimeRoot, { recursive: true });

    await writeFile(path.join(sourceRoot, "note.md"), "# note\n", "utf8");
    await writeFile(path.join(sourceVaultRoot, "wiki", "index.md"), "# source vault\n", "utf8");

    const imported = await syncMarkdownSources([sourceRoot], runtimeRoot, [".obsidian"]);

    expect(imported).toBe(1);
    await expect(
      readFile(path.join(runtimeRoot, "raw_import_manifest.csv"), "utf8"),
    ).resolves.toContain("note.md");
    await expect(
      readFile(path.join(runtimeRoot, "sources_full", buildImportedFilename("note.md")), "utf8"),
    ).resolves.toContain("# note");
    await expect(
      readFile(path.join(sourceVaultRoot, "wiki", "index.md"), "utf8"),
    ).resolves.toBe("# source vault\n");
    await expect(
      readFile(path.join(sourceVaultRoot, "raw_import_manifest.csv"), "utf8"),
    ).rejects.toThrow();
  });

  it("preserves unchanged mirrored markdown files across repeated syncs", async () => {
    tempDir = await makeTempDir("sync-markdown-stable-");
    const source = path.join(tempDir, "source");
    const vault = path.join(tempDir, "vault");
    await mkdir(source, { recursive: true });
    await mkdir(vault, { recursive: true });

    await writeFile(path.join(source, "note.md"), "# stable\n", "utf8");

    await syncMarkdownSources([source], vault, []);
    const mirrored = path.join(vault, "sources_full", buildImportedFilename("note.md"));
    const before = await stat(mirrored);

    await new Promise((resolve) => setTimeout(resolve, 30));
    await syncMarkdownSources([source], vault, []);
    const after = await stat(mirrored);

    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it("removes deleted mirrored markdown files without rewriting unchanged neighbors", async () => {
    tempDir = await makeTempDir("sync-markdown-prune-");
    const source = path.join(tempDir, "source");
    const vault = path.join(tempDir, "vault");
    await mkdir(source, { recursive: true });
    await mkdir(vault, { recursive: true });

    await writeFile(path.join(source, "keep.md"), "# keep\n", "utf8");
    await writeFile(path.join(source, "drop.md"), "# drop\n", "utf8");

    await syncMarkdownSources([source], vault, []);
    const keepMirror = path.join(vault, "sources_full", buildImportedFilename("keep.md"));
    const dropMirror = path.join(vault, "sources_full", buildImportedFilename("drop.md"));
    const before = await stat(keepMirror);

    await rm(path.join(source, "drop.md"), { force: true });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await syncMarkdownSources([source], vault, []);

    const after = await stat(keepMirror);
    const entries = await readdir(path.join(vault, "sources_full"));

    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(entries).not.toContain(path.basename(dropMirror));
  });

  it("copies non-markdown assets into the attachment mirror and writes a manifest", async () => {
    tempDir = await makeTempDir("sync-assets-");
    const source = path.join(tempDir, "source");
    const vault = path.join(tempDir, "vault");
    await mkdir(path.join(source, "images"), { recursive: true });
    await mkdir(path.join(source, ".obsidian"), { recursive: true });
    await mkdir(vault, { recursive: true });

    await writeFile(path.join(source, "note.md"), "# note\n", "utf8");
    await writeFile(path.join(source, "images", "diagram.png"), "png", "utf8");
    await writeFile(path.join(source, "images", "paper.pdf"), "pdf", "utf8");
    await writeFile(path.join(source, ".obsidian", "hidden.png"), "hidden", "utf8");

    const copied = await syncNonMarkdownAssets([source], vault, [".obsidian"]);
    const assetRoot = path.join(
      vault,
      "sources_full",
      "\u9644\u4ef6\u526f\u672c\uff08\u975eMarkdown\uff09",
    );
    const rootEntries = await readdir(assetRoot);
    const manifest = await readFile(path.join(vault, "raw_asset_manifest.csv"), "utf8");
    const guide = await readFile(
      path.join(assetRoot, "00-\u9644\u4ef6\u8bf4\u660e.txt"),
      "utf8",
    );
    const mirrorDir = rootEntries.find((entry) => entry !== "00-\u9644\u4ef6\u8bf4\u660e.txt");

    expect(copied).toBe(2);
    expect(rootEntries).toContain("00-\u9644\u4ef6\u8bf4\u660e.txt");
    expect(mirrorDir).toBeTruthy();
    await expect(
      readFile(path.join(assetRoot, mirrorDir!, "images", "diagram.png"), "utf8"),
    ).resolves.toBe("png");
    await expect(
      readFile(path.join(assetRoot, mirrorDir!, "images", "paper.pdf"), "utf8"),
    ).resolves.toBe("pdf");
    expect(manifest).toContain("diagram.png");
    expect(manifest).toContain("paper.pdf");
    expect(manifest).not.toContain("hidden.png");
    expect(guide).toContain("\u9644\u4ef6\u526f\u672c");
    expect(guide).toContain("compile");
  });

  it("counts markdown and asset files before a sync runs", async () => {
    tempDir = await makeTempDir("sync-inspect-");
    const source = path.join(tempDir, "source");
    await mkdir(path.join(source, "images"), { recursive: true });
    await mkdir(path.join(source, ".obsidian"), { recursive: true });

    await writeFile(path.join(source, "note.md"), "# note\n", "utf8");
    await writeFile(path.join(source, "images", "diagram.png"), "png", "utf8");
    await writeFile(path.join(source, ".obsidian", "hidden.md"), "# hidden\n", "utf8");

    const inventory = await inspectSourceFolders([source], [".obsidian"]);

    expect(inventory.markdownCount).toBe(1);
    expect(inventory.assetCount).toBe(1);
  });

  it("treats a dead lock pid as removable", async () => {
    const removable = await canClearStaleLock("999999");
    expect(removable).toBe(true);
  });

  it("writes structured lock metadata for the active sync process", () => {
    const lock = JSON.parse(
      createLockFileContent(new Date("2026-05-03T00:00:00.000Z")),
    ) as {
      pid: number;
      script: string;
      createdAt: string;
    };

    expect(lock.pid).toBe(process.pid);
    expect(lock.script.length).toBeGreaterThan(0);
    expect(lock.createdAt).toBe("2026-05-03T00:00:00.000Z");
  });

  it("treats a reused pid with a different command as removable", async () => {
    const scriptPath = "D:/Desktop/llm-wiki-compiler-main/scripts/sync-compile.mjs";
    const lockText = JSON.stringify({ pid: 123, script: scriptPath });

    await expect(
      canClearStaleLock(lockText, {
        processExists: () => true,
        readCommandLine: async () => "node D:/Desktop/other-script.mjs",
      }),
    ).resolves.toBe(true);
  });

  it("keeps a live matching structured lock", async () => {
    const scriptPath = "D:/Desktop/llm-wiki-compiler-main/scripts/sync-compile.mjs";
    const lockText = JSON.stringify({ pid: 123, script: scriptPath });

    await expect(
      canClearStaleLock(lockText, {
        processExists: () => true,
        readCommandLine: async () => `node ${scriptPath}`,
      }),
    ).resolves.toBe(false);
    expect(formatLockOwner(lockText)).toContain("sync-compile.mjs");
  });
});
