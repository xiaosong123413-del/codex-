import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createRunManager } from "../web/server/services/run-manager.js";
import { makeTempRoot } from "./fixtures/temp-root.js";

describe("run-manager", () => {
  it("captures process output and marks a run as succeeded", async () => {
    const manager = createRunManager({
      resolveCommand: () => ({
        command: process.execPath,
        args: ["-e", "console.log('run-ok')"],
        cwd: process.cwd(),
      }),
    });

    const run = manager.start("check", {
      sourceVaultRoot: process.cwd(),
      runtimeRoot: process.cwd(),
      projectRoot: process.cwd(),
    });
    await manager.waitForRun(run.id);

    const current = manager.getCurrent();
    expect(current?.status).toBe("succeeded");
    expect(current?.lines.some((line) => line.text.includes("run-ok"))).toBe(true);
  });

  it("rejects a second run while one is active", () => {
    const manager = createRunManager({
      resolveCommand: () => ({
        command: process.execPath,
        args: ["-e", "setTimeout(() => {}, 1000)"],
        cwd: process.cwd(),
      }),
    });

    const run = manager.start("sync", {
      sourceVaultRoot: process.cwd(),
      runtimeRoot: process.cwd(),
      projectRoot: process.cwd(),
    });

    expect(() => manager.start("check", {
      sourceVaultRoot: process.cwd(),
      runtimeRoot: process.cwd(),
      projectRoot: process.cwd(),
    })).toThrow(
      "run already active",
    );

    manager.stop(run.id);
  });

  it("appends the final compile result summary for sync runs", async () => {
    const sourceVaultRoot = await makeTempRoot("run-manager-final-result-source");
    const runtimeRoot = await makeTempRoot("run-manager-final-result-runtime");
    await mkdir(path.join(runtimeRoot, ".llmwiki"), { recursive: true });
    await writeFile(
      path.join(runtimeRoot, ".llmwiki", "final-compile-result.json"),
      `${JSON.stringify({
        status: "succeeded",
        syncedMarkdownCount: 6,
        syncedAssetCount: 2,
        completedFilesCount: 4,
        internalBatchCount: 2,
        batchLimit: 20,
        claimsUpdated: 6,
        proceduresUpdated: 1,
        wikiOutputDir: path.join(runtimeRoot, "wiki"),
        publishedAt: "2026-04-19T01:00:00.000Z",
      }, null, 2)}\n`,
      "utf8",
    );

    const manager = createRunManager({
      resolveCommand: () => ({
        command: process.execPath,
        args: ["-e", "console.log('sync-done')"],
        cwd: process.cwd(),
      }),
    });

    const run = manager.start("sync", { sourceVaultRoot, runtimeRoot, projectRoot: process.cwd() });
    const completed = await manager.waitForRun(run.id);

    expect(completed.status).toBe("succeeded");
    expect(completed.lines.some((line) => line.text.includes("final result: succeeded"))).toBe(true);
    expect(completed.lines.some((line) => line.text.includes("status counts: synced 6, compiled 4, not synced 0, not compiled 2"))).toBe(true);
    expect(completed.lines.some((line) => line.text.includes("claims 6"))).toBe(true);
  });

  it("persists structured deep-research items for actionable lint diagnostics and clears them after a clean rerun", async () => {
    const sourceVaultRoot = await makeTempRoot("run-manager-deep-research-source");
    const runtimeRoot = await makeTempRoot("run-manager-deep-research-runtime");
    const lintTarget = path.join(sourceVaultRoot, "wiki", "concepts", "example.md");
    await mkdir(path.dirname(lintTarget), { recursive: true });
    await writeFile(lintTarget, "# Example\n\nOld content.\n", "utf8");
    let checkAttempt = 0;
    const manager = createRunManager({
      resolveCommand: (kind) => ({
        command: process.execPath,
        args: kind === "check"
          ? [
            "-e",
            checkAttempt === 0
              ? `console.log(${JSON.stringify(`x error ${lintTarget}:22 Broken citation ^[clip.md] - source file not found`)})`
              : "console.log('check-ok')",
          ]
          : ["-e", "console.log('check-ok')"],
        cwd: process.cwd(),
      }),
    });

    const firstRun = manager.start("check", { sourceVaultRoot, runtimeRoot, projectRoot: process.cwd() });
    await manager.waitForRun(firstRun.id);

    const storedAfterFirstRun = JSON.parse(
      await readFile(path.join(runtimeRoot, ".llmwiki", "deep-research-items.json"), "utf8"),
    ) as Array<{ kind: string; category: string; pagePath: string; line?: number; gapText?: string }>;
    expect(storedAfterFirstRun).toContainEqual(
      expect.objectContaining({
        kind: "check",
        category: "missing-citation",
        pagePath: "wiki/concepts/example.md",
        line: 22,
        gapText: "Broken citation ^[clip.md] - source file not found",
      }),
    );

    checkAttempt += 1;
    const secondRun = manager.start("check", { sourceVaultRoot, runtimeRoot, projectRoot: process.cwd() });
    await manager.waitForRun(secondRun.id);

    const storedAfterSecondRun = JSON.parse(
      await readFile(path.join(runtimeRoot, ".llmwiki", "deep-research-items.json"), "utf8"),
    ) as Array<{ kind: string; detail: string }>;
    expect(storedAfterSecondRun.some((item) => item.kind === "check")).toBe(false);
  });

  it("stores only actionable lint diagnostics with a page target and drops generic footer prompts", async () => {
    const sourceVaultRoot = await makeTempRoot("run-manager-deep-research-filter-source");
    const runtimeRoot = await makeTempRoot("run-manager-deep-research-filter-runtime");
    const citationPage = path.join(sourceVaultRoot, "wiki", "concepts", "ai-tools.md");
    const confidencePage = path.join(sourceVaultRoot, "wiki", "concepts", "research.md");
    const stalePage = path.join(sourceVaultRoot, "wiki", "concepts", "legacy.md");
    await mkdir(path.dirname(citationPage), { recursive: true });
    await writeFile(citationPage, "# AI Tools\n", "utf8");
    await writeFile(confidencePage, "# Research\n", "utf8");
    await writeFile(stalePage, "# Legacy\n", "utf8");
    const manager = createRunManager({
      resolveCommand: () => ({
        command: process.execPath,
        args: [
          "-e",
          [
            `console.log(${JSON.stringify(`! warning ${path.join(sourceVaultRoot, "wiki", "concepts", "deep-research-调研效率提升.md")} Page is marked as orphaned`)})`,
            `console.log(${JSON.stringify(`x error ${citationPage}:22 Broken citation ^[clip.md] - source file not found`)})`,
            `console.log(${JSON.stringify(`! warning ${confidencePage} Low-confidence claim: 这个结论目前只有零散线索支撑 (confidence 0.31, status fresh)`)})`,
            `console.log(${JSON.stringify(`! warning ${stalePage} Stale claim: 旧版结论已经落后 (retention 0.22, last confirmed 2025-03-10)`)})`,
            "console.log('- 需要网络搜索补证的数据空白')",
            "console.log('  原因：联网搜索会引入新来源和外部信息，需要你确认是否值得补证。')",
            "console.log('  需要你确认：是否进一步网络搜索补证？')",
          ].join(";"),
        ],
        cwd: process.cwd(),
      }),
    });

    const run = manager.start("check", { sourceVaultRoot, runtimeRoot, projectRoot: process.cwd() });
    await manager.waitForRun(run.id);

    const stored = JSON.parse(
      await readFile(path.join(runtimeRoot, ".llmwiki", "deep-research-items.json"), "utf8"),
    ) as Array<{ title: string; category: string; pagePath: string }>;

    expect(stored).toEqual([
      expect.objectContaining({
        title: "引用缺失",
        category: "missing-citation",
        pagePath: "wiki/concepts/ai-tools.md",
      }),
      expect.objectContaining({
        title: "需要网络搜索补证的数据空白",
        category: "needs-deep-research",
        pagePath: "wiki/concepts/research.md",
      }),
      expect.objectContaining({
        title: "新来源已取代的过时表述",
        category: "outdated-source",
        pagePath: "wiki/concepts/legacy.md",
      }),
    ]);
  });
});
