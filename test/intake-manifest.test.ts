import { afterEach, describe, expect, it } from "vitest";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  archiveCompiledClippingsFromManifest,
  ensureIntakeFolders,
  scanIntakeItems,
} from "../scripts/sync-compile/intake.mjs";
import { syncMarkdownSources } from "../scripts/sync-compile/sync-files.mjs";

async function makeTempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("intake manifest", () => {
  let tempDir = "";

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  it("creates and scans raw clipping, flash diary, and inbox folders", async () => {
    tempDir = await makeTempDir("intake-scan-");
    const vault = path.join(tempDir, "vault");
    await ensureIntakeFolders(vault);
    await writeFile(path.join(vault, "raw", "\u526a\u85cf", "clip.md"), "# Clip\nhttps://example.com/a\n", "utf8");
    await writeFile(path.join(vault, "raw", "\u95ea\u5ff5\u65e5\u8bb0", "idea.md"), "# Idea\n", "utf8");
    await writeFile(path.join(vault, "inbox", "guided.md"), "# Guided\n", "utf8");

    const items = await scanIntakeItems(vault);

    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "clipping", title: "Clip", cleanupAllowed: true }),
        expect.objectContaining({ kind: "flash", title: "Idea", cleanupAllowed: false }),
        expect.objectContaining({ kind: "inbox", title: "Guided", cleanupAllowed: false }),
      ]),
    );
  });

  it("does not rescan completed inbox materials", async () => {
    tempDir = await makeTempDir("intake-completed-");
    const vault = path.join(tempDir, "vault");
    await mkdir(path.join(vault, "inbox", "_\u5df2\u5f55\u5165"), { recursive: true });
    await writeFile(path.join(vault, "inbox", "_\u5df2\u5f55\u5165", "done.md"), "# Done\n", "utf8");

    const items = await scanIntakeItems(vault);

    expect(items.map((item) => item.title)).not.toContain("Done");
  });

  it("writes source metadata into synchronized markdown copies", async () => {
    tempDir = await makeTempDir("intake-sync-");
    const vault = path.join(tempDir, "vault");
    const clippingRoot = path.join(vault, "raw", "\u526a\u85cf");
    await mkdir(clippingRoot, { recursive: true });
    await writeFile(path.join(clippingRoot, "clip.md"), "# Clipped Title\nhttps://example.com/a\n", "utf8");

    await syncMarkdownSources([clippingRoot], vault, []);
    const manifest = JSON.parse(await readFile(path.join(vault, "raw_import_manifest.json"), "utf8"));
    const imported = manifest.imports[0].imported_filename;
    const copied = await readFile(path.join(vault, "sources_full", imported), "utf8");

    expect(copied).toContain("\u539f\u6599\u6765\u6e90");
    expect(copied).toContain("\u526a\u85cf");
    expect(copied).toContain("https://example.com/a");
    expect(manifest.imports[0]).toEqual(
      expect.objectContaining({ source_kind: "clipping", source_channel: "\u526a\u85cf" }),
    );
  });

  it("writes configured source folder metadata into synchronized markdown copies", async () => {
    tempDir = await makeTempDir("intake-configured-sync-");
    const vault = path.join(tempDir, "vault");
    const sourceRoot = path.join(vault, "raw", "\u4e2a\u4eba\u4fe1\u606f");
    await mkdir(sourceRoot, { recursive: true });
    await writeFile(path.join(sourceRoot, "about.md"), "# About Me\n", "utf8");

    await syncMarkdownSources([sourceRoot], vault, []);
    const manifest = JSON.parse(await readFile(path.join(vault, "raw_import_manifest.json"), "utf8"));
    const imported = manifest.imports[0].imported_filename;
    const copied = await readFile(path.join(vault, "sources_full", imported), "utf8");

    expect(copied).toContain("\u4e2a\u4eba\u4fe1\u606f");
    expect(manifest.imports[0]).toEqual(
      expect.objectContaining({ source_kind: "source", source_channel: "\u4e2a\u4eba\u4fe1\u606f" }),
    );
  });

  it("moves only compiled clipping raw files into the cleaned folder", async () => {
    tempDir = await makeTempDir("intake-clean-");
    const vault = path.join(tempDir, "vault");
    const clippingRoot = path.join(vault, "raw", "\u526a\u85cf");
    const flashRoot = path.join(vault, "raw", "\u95ea\u5ff5\u65e5\u8bb0");
    await mkdir(clippingRoot, { recursive: true });
    await mkdir(flashRoot, { recursive: true });
    await writeFile(path.join(clippingRoot, "clip.md"), "# Clip\n", "utf8");
    await writeFile(path.join(flashRoot, "idea.md"), "# Idea\n", "utf8");

    await syncMarkdownSources([clippingRoot, flashRoot], vault, []);
    const manifest = JSON.parse(await readFile(path.join(vault, "raw_import_manifest.json"), "utf8"));
    const compiled = manifest.imports.map((row: { imported_filename: string }) => row.imported_filename);

    const moved = await archiveCompiledClippingsFromManifest(vault, compiled);

    expect(moved).toBe(1);
    await expect(stat(path.join(clippingRoot, "_\u5df2\u6e05\u7406", "clip.md"))).resolves.toBeTruthy();
    await expect(stat(path.join(flashRoot, "idea.md"))).resolves.toBeTruthy();
  });
});
