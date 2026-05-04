import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildIntakePlan, scanIntakeForReview } from "../web/server/services/intake-summary.js";

const tempRoots: string[] = [];

describe("web intake summary", () => {
  afterEach(() => {
    vi.useRealTimers();
    while (tempRoots.length > 0) {
      const root = tempRoots.pop();
      if (root) fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("builds the batch ingest table from raw folders and skips cleaned clippings", () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, "raw", "\u526a\u85cf", "_\u5df2\u6e05\u7406"), { recursive: true });
    fs.mkdirSync(path.join(root, "raw", "\u95ea\u5ff5\u65e5\u8bb0"), { recursive: true });
    fs.writeFileSync(path.join(root, "raw", "\u526a\u85cf", "clip.md"), "# Clip\nhttps://example.com", "utf8");
    fs.writeFileSync(path.join(root, "raw", "\u526a\u85cf", "_\u5df2\u6e05\u7406", "old.md"), "# Old", "utf8");
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayName = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}.md`;
    fs.writeFileSync(path.join(root, "raw", "\u95ea\u5ff5\u65e5\u8bb0", yesterdayName), "# Idea", "utf8");

    const items = scanIntakeForReview(root);
    const plan = buildIntakePlan(root);

    expect(items.map((item) => item.title)).toContain("Clip");
    expect(items.map((item) => item.title)).not.toContain("Old");
    expect(plan).toContainEqual(
      expect.objectContaining({
        file: expect.stringContaining("clip.md"),
        suggestedLocation: "Knowledge/\u526a\u85cf/",
        action: "\u65b0\u5efa",
      }),
    );
  });

  it("skips completed inbox materials", () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, "inbox", "_\u5df2\u5f55\u5165"), { recursive: true });
    fs.writeFileSync(path.join(root, "inbox", "_\u5df2\u5f55\u5165", "done.md"), "# Done", "utf8");

    const items = scanIntakeForReview(root);

    expect(items.map((item) => item.title)).not.toContain("Done");
  });

  it("includes markdown from configured sync source folders", () => {
    const root = makeRoot();
    const sourceRoot = path.join(root, "raw", "\u4e2a\u4eba\u4fe1\u606f");
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, "about.md"), "# About Me\n\nprofile", "utf8");

    const options = { sourceRoots: [sourceRoot] };
    const items = scanIntakeForReview(root, undefined, new Date(), options);
    const plan = buildIntakePlan(root, undefined, new Date(), options);

    expect(items).toContainEqual(
      expect.objectContaining({
        kind: "source",
        channel: "\u4e2a\u4eba\u4fe1\u606f",
        title: "About Me",
        relativePath: "\u4e2a\u4eba\u4fe1\u606f/about.md",
      }),
    );
    expect(plan).toContainEqual(
      expect.objectContaining({
        file: "\u4e2a\u4eba\u4fe1\u606f/about.md",
        suggestedLocation: "\u6309\u6765\u6e90\u5f52\u6863/\u4e2a\u4eba\u4fe1\u606f/",
      }),
    );
  });

  it("does not surface yesterday flash diary again after it was compiled", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-22T09:00:00"));
    const sourceVaultRoot = makeRoot();
    const runtimeRoot = makeRoot();
    fs.mkdirSync(path.join(sourceVaultRoot, "raw", "\u95ea\u5ff5\u65e5\u8bb0"), { recursive: true });
    fs.writeFileSync(
      path.join(sourceVaultRoot, "raw", "\u95ea\u5ff5\u65e5\u8bb0", "2026-04-21.md"),
      "# 2026-04-21 \u95ea\u5ff5\u65e5\u8bb0\n\n## 08:00\n\nalready compiled\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(runtimeRoot, "raw_import_manifest.json"),
      `${JSON.stringify({
        imports: [
          {
            imported_filename: "flash-yesterday.md",
            source_kind: "flash",
            source_relative_path: "2026-04-21.md",
          },
        ],
      }, null, 2)}\n`,
      "utf8",
    );
    fs.writeFileSync(
      path.join(runtimeRoot, ".llmwiki-batch-state.json"),
      `${JSON.stringify({
        completed_files: ["flash-yesterday.md"],
        flash_diary_auto_compile: { last_run_on: "2026-04-22" },
      }, null, 2)}\n`,
      "utf8",
    );

    const items = scanIntakeForReview(sourceVaultRoot, runtimeRoot);
    const plan = buildIntakePlan(sourceVaultRoot, runtimeRoot);

    expect(items.map((item) => item.relativePath)).not.toContain("\u95ea\u5ff5\u65e5\u8bb0/2026-04-21.md");
    expect(plan.map((item) => item.file)).not.toContain("\u95ea\u5ff5\u65e5\u8bb0/2026-04-21.md");
  });

  it("does not surface raw clipping again after it was compiled", () => {
    const sourceVaultRoot = makeRoot();
    const runtimeRoot = makeRoot();
    fs.mkdirSync(path.join(sourceVaultRoot, "raw", "\u526a\u85cf"), { recursive: true });
    fs.writeFileSync(
      path.join(sourceVaultRoot, "raw", "\u526a\u85cf", "2026-04-21-11.md"),
      "# 2026-04-21-11\n\nalready compiled\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(runtimeRoot, "raw_import_manifest.json"),
      `${JSON.stringify({
        imports: [
          {
            imported_filename: "2026-04-21-11__deadbeef.md",
            source_kind: "clipping",
            source_relative_path: "2026-04-21-11.md",
          },
        ],
      }, null, 2)}\n`,
      "utf8",
    );
    fs.writeFileSync(
      path.join(runtimeRoot, ".llmwiki-batch-state.json"),
      `${JSON.stringify({
        completed_files: ["2026-04-21-11__deadbeef.md"],
        flash_diary_auto_compile: { last_run_on: null },
      }, null, 2)}\n`,
      "utf8",
    );

    const items = scanIntakeForReview(sourceVaultRoot, runtimeRoot);
    const plan = buildIntakePlan(sourceVaultRoot, runtimeRoot);

    expect(items.map((item) => item.relativePath)).not.toContain("\u526a\u85cf/2026-04-21-11.md");
    expect(plan.map((item) => item.file)).not.toContain("\u526a\u85cf/2026-04-21-11.md");
  });

  it("does not surface configured source material again after it was compiled", () => {
    const sourceVaultRoot = makeRoot();
    const runtimeRoot = makeRoot();
    const sourceRoot = path.join(sourceVaultRoot, "raw", "\u4e2a\u4eba\u4fe1\u606f");
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, "about.md"), "# About Me\n\nalready compiled\n", "utf8");
    fs.writeFileSync(
      path.join(runtimeRoot, "raw_import_manifest.json"),
      `${JSON.stringify({
        imports: [
          {
            imported_filename: "about__deadbeef.md",
            source_kind: "source",
            source_root: sourceRoot,
            source_relative_path: "about.md",
          },
        ],
      }, null, 2)}\n`,
      "utf8",
    );
    fs.writeFileSync(
      path.join(runtimeRoot, ".llmwiki-batch-state.json"),
      `${JSON.stringify({
        completed_files: ["about__deadbeef.md"],
        flash_diary_auto_compile: { last_run_on: null },
      }, null, 2)}\n`,
      "utf8",
    );

    const options = { sourceRoots: [sourceRoot] };
    const items = scanIntakeForReview(sourceVaultRoot, runtimeRoot, new Date(), options);
    const plan = buildIntakePlan(sourceVaultRoot, runtimeRoot, new Date(), options);

    expect(items.map((item) => item.relativePath)).not.toContain("\u4e2a\u4eba\u4fe1\u606f/about.md");
    expect(plan.map((item) => item.file)).not.toContain("\u4e2a\u4eba\u4fe1\u606f/about.md");
  });
});

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "web-intake-"));
  tempRoots.push(root);
  return root;
}
