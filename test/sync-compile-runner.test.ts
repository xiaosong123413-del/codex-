import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  assertSourceInventoryHasContent,
  clearStaleLockIfSafe,
  consumeFlashDiaryAutoCompileAttempt,
  hasSelectedFlashDiaryImport,
  summarizeBatchProgress,
} from "../scripts/sync-compile.mjs";

async function makeTempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("sync compile runner helpers", () => {
  let tempDir = "";

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  it("clears a stale lock when the pid is dead", async () => {
    tempDir = await makeTempDir("sync-runner-");
    const lockDir = path.join(tempDir, ".llmwiki");
    const lockPath = path.join(lockDir, "lock");
    await mkdir(lockDir, { recursive: true });
    await writeFile(lockPath, "999999", "utf8");

    await clearStaleLockIfSafe(tempDir);

    await expect(readFile(lockPath, "utf8")).rejects.toThrow();
  });

  it("clears a structured stale lock when the owner process is gone", async () => {
    tempDir = await makeTempDir("sync-runner-structured-");
    const lockDir = path.join(tempDir, ".llmwiki");
    const lockPath = path.join(lockDir, "lock");
    await mkdir(lockDir, { recursive: true });
    await writeFile(
      lockPath,
      JSON.stringify({
        pid: 999999,
        script: "D:/Desktop/llm-wiki-compiler-main/scripts/sync-compile.mjs",
      }),
      "utf8",
    );

    await clearStaleLockIfSafe(tempDir);

    await expect(readFile(lockPath, "utf8")).rejects.toThrow();
  });

  it("summarizes progress using completed, asset, and active batch counts", () => {
    const summary = summarizeBatchProgress({
      importedCount: 1174,
      assetCount: 503,
      completedCount: 40,
      activeBatchCount: 20,
    });

    expect(summary).toContain("1174");
    expect(summary).toContain("503");
    expect(summary).toContain("40");
    expect(summary).toContain("20");
    expect(summary).toContain("sources_full");
    expect(summary).toContain("\u5168\u91cf Markdown \u539f\u6599\u4ed3");
    expect(summary).toContain("\u5f53\u524d\u6279\u6b21\u5de5\u4f5c\u533a");
    expect(summary).toContain("\u9644\u4ef6\u526f\u672c");
  });

  it("rejects an empty local mirror before clearing existing synced files", () => {
    expect(() =>
      assertSourceInventoryHasContent({
        markdownCount: 0,
        assetCount: 0,
      }),
    ).toThrow("Configured source folders are empty");
  });

  it("persists the flash diary daily slot before compile batches start", async () => {
    tempDir = await makeTempDir("sync-runner-flash-attempt-");
    const state = {
      completed_files: ["clip.md"],
      flash_diary_auto_compile: { last_run_on: null },
    };

    const nextState = await consumeFlashDiaryAutoCompileAttempt({
      runtimeRoot: tempDir,
      state,
      now: new Date("2026-04-25T08:00:00"),
      shouldConsume: true,
    });

    expect(nextState.flash_diary_auto_compile.last_run_on).toBe("2026-04-25");
    expect(nextState.completed_files).toEqual(["clip.md"]);

    const stored = JSON.parse(
      await readFile(path.join(tempDir, ".llmwiki-batch-state.json"), "utf8"),
    ) as {
      completed_files: string[];
      flash_diary_auto_compile: { last_run_on: string | null };
    };

    expect(stored.completed_files).toEqual(["clip.md"]);
    expect(stored.flash_diary_auto_compile.last_run_on).toBe("2026-04-25");
  });

  it("does not write batch state when the flash diary daily slot is not consumed", async () => {
    tempDir = await makeTempDir("sync-runner-flash-skip-");
    const state = {
      completed_files: ["clip.md"],
      flash_diary_auto_compile: { last_run_on: "2026-04-24" },
    };

    const nextState = await consumeFlashDiaryAutoCompileAttempt({
      runtimeRoot: tempDir,
      state,
      now: new Date("2026-04-25T13:00:00"),
      shouldConsume: false,
    });

    expect(nextState).toEqual({
      completed_files: ["clip.md"],
      flash_diary_auto_compile: { last_run_on: "2026-04-24" },
    });
    await expect(
      readFile(path.join(tempDir, ".llmwiki-batch-state.json"), "utf8"),
    ).rejects.toThrow();
  });

  it("does not consider the slot consumable when only clipping files are selected", async () => {
    tempDir = await makeTempDir("sync-runner-flash-selection-skip-");
    await writeFile(
      path.join(tempDir, "raw_import_manifest.json"),
      `${JSON.stringify({
        imports: [
          {
            imported_filename: "clip.md",
            source_kind: "clipping",
          },
          {
            imported_filename: "flash-yesterday.md",
            source_kind: "flash",
          },
        ],
      })}\n`,
      "utf8",
    );

    await expect(
      hasSelectedFlashDiaryImport(tempDir, ["clip.md"]),
    ).resolves.toBe(false);
  });

  it("considers the slot consumable when a selected file is a flash diary import", async () => {
    tempDir = await makeTempDir("sync-runner-flash-selection-hit-");
    await writeFile(
      path.join(tempDir, "raw_import_manifest.json"),
      `${JSON.stringify({
        imports: [
          {
            imported_filename: "clip.md",
            source_kind: "clipping",
          },
          {
            imported_filename: "flash-yesterday.md",
            source_kind: "flash",
          },
        ],
      })}\n`,
      "utf8",
    );

    await expect(
      hasSelectedFlashDiaryImport(tempDir, ["clip.md", "flash-yesterday.md"]),
    ).resolves.toBe(true);
  });
});
