/**
 * Integration tests for deterministic lint autofix at the lint() boundary.
 *
 * These tests intentionally stay narrow: they cover the current end-to-end
 * lint surface, while direct repairer behavior lives in dedicated focused
 * tests to keep file size and failure isolation under control.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { lint } from "../src/linter/index.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "lint-autofix-test-"));
  await mkdir(path.join(tmpDir, ".llmwiki"), { recursive: true });
  await mkdir(path.join(tmpDir, "wiki", "concepts"), { recursive: true });
  await mkdir(path.join(tmpDir, "wiki", "queries"), { recursive: true });
  await mkdir(path.join(tmpDir, "raw"), { recursive: true });
  await mkdir(path.join(tmpDir, "sources_full"), { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function writeConcept(slug: string, content: string): Promise<string> {
  const filePath = path.join(tmpDir, "wiki", "concepts", `${slug}.md`);
  await writeFile(filePath, content, "utf8");
  return filePath;
}

async function writeQuery(slug: string, content: string): Promise<string> {
  const filePath = path.join(tmpDir, "wiki", "queries", `${slug}.md`);
  await writeFile(filePath, content, "utf8");
  return filePath;
}

describe("deterministic lint autofix integration", () => {
  it("backfills a unique alias and clears the broken wikilink", async () => {
    await writeConcept(
      "web-clipper",
      [
        "---",
        "title: Web Clipper素材捕获",
        "summary: 用于网页内容捕获。",
        "aliases:",
        "  - Web Clipper",
        "---",
        "",
        "# Web Clipper素材捕获",
        "",
        "正文内容足够长，避免空页规则干扰。",
      ].join("\n"),
    );
    await writeConcept(
      "consumer",
      [
        "---",
        "title: Consumer",
        "summary: 消费页。",
        "---",
        "",
        "See [[素材捕获]].",
      ].join("\n"),
    );

    const summary = await lint(tmpDir);
    expect(summary.errors).toBe(0);
    const autofix = summary.autofix;
    expect(autofix).toBeDefined();
    expect(autofix.applied).toBe(1);
    expect(summary.results.some((result) => result.rule === "broken-wikilink")).toBe(false);
    expect(autofix.details).toContainEqual(expect.objectContaining({
      repairer: "alias-backfill",
      status: "applied",
    }));
  });

  it("creates concept seed pages for missing wikilinks in query drafts", async () => {
    const queryPath = await writeQuery(
      "research-ai-human-work",
      [
        "---",
        "title: Research AI Human Work",
        "type: query",
        "summary: Research draft.",
        "---",
        "",
        "# Research AI Human Work",
        "",
        "草稿连接 [[组织设计/未来工作]] 和 [[Human-on-the-Loop|人工监督循环]]。",
        "",
        "这是一段足够长的研究草稿内容，用来避免空页规则干扰。",
      ].join("\n"),
    );

    const summary = await lint(tmpDir);
    const queryContent = await readFile(queryPath, "utf8");
    const organizationSeed = await readFile(path.join(tmpDir, "wiki", "concepts", "组织设计未来工作.md"), "utf8");
    const humanLoopSeed = await readFile(path.join(tmpDir, "wiki", "concepts", "human-on-the-loop.md"), "utf8");

    expect(summary.errors).toBe(0);
    expect(summary.results.some((result) => result.rule === "broken-wikilink")).toBe(false);
    expect(summary.autofix.details).toContainEqual(expect.objectContaining({
      repairer: "query-concept-seed",
      status: "applied",
      reason: "created-query-concept-seed",
    }));
    expect(queryContent).toContain("[[组织设计/未来工作]]");
    expect(queryContent).toContain("[[Human-on-the-Loop|人工监督循环]]");
    expect(organizationSeed).toContain("title: 组织设计/未来工作");
    expect(organizationSeed).toContain("[[Research AI Human Work]]");
    expect(humanLoopSeed).toContain("title: Human-on-the-Loop");
    expect(humanLoopSeed).toContain("[[Research AI Human Work]]");
  });

  it("keeps missing wikilinks in concept pages for human review", async () => {
    const conceptPath = await writeConcept(
      "consumer",
      [
        "---",
        "title: Consumer",
        "summary: 消费页。",
        "---",
        "",
        "See [[Missing Concept]] before making a new page.",
      ].join("\n"),
    );

    const summary = await lint(tmpDir);
    const preserved = await readFile(conceptPath, "utf8");

    expect(summary.errors).toBeGreaterThan(0);
    expect(summary.results.some((result) => result.rule === "broken-wikilink")).toBe(true);
    expect(summary.autofix.details.some((detail) => detail.repairer === "query-concept-seed")).toBe(false);
    expect(preserved).toContain("[[Missing Concept]]");
  });

  it("skips alias writes when more than one deterministic target exists", async () => {
    await writeConcept(
      "oauth-browser",
      [
        "---",
        "title: OAuth 桌面端回调机制",
        "summary: 桌面端回调。",
        "---",
        "",
        "正文内容足够长，避免空页规则干扰。",
      ].join("\n"),
    );
    await writeConcept(
      "oauth-local",
      [
        "---",
        "title: OAuth 本地回调问题",
        "summary: 本地回调问题。",
        "---",
        "",
        "正文内容足够长，避免空页规则干扰。",
      ].join("\n"),
    );
    await writeConcept(
      "consumer",
      [
        "---",
        "title: Consumer",
        "summary: 消费页。",
        "---",
        "",
        "See [[OAuth]].",
      ].join("\n"),
    );

    const summary = await lint(tmpDir);
    expect(summary.errors).toBeGreaterThan(0);
    expect(summary.results.some((result) => result.rule === "broken-wikilink")).toBe(true);
    const autofix = summary.autofix;
    expect(autofix).toBeDefined();
    expect(autofix.skipped).toBe(1);
    expect(autofix.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          repairer: "alias-backfill",
          status: "skipped",
          reason: "ambiguous-target",
        }),
      ]),
    );
  });

  it("prints the localized autofix block before final diagnostics", async () => {
    vi.resetModules();
    const events: string[] = [];
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    vi.doMock("../src/linter/index.js", () => ({
      lint: vi.fn(async () => ({
        errors: 0,
        warnings: 1,
        info: 0,
        results: [
          { rule: "missing-summary", severity: "warning" as const, file: "page.md", message: "warn" },
        ],
        autofix: {
          attempted: 1,
          applied: 1,
          skipped: 0,
          failures: 0,
          details: [
            { repairer: "alias-backfill" as const, kind: "broken-wikilink", target: "wiki/concepts/page.md", reason: "ok", status: "applied" as const },
          ],
        },
      })),
    }));
    vi.doMock("../src/utils/output.js", () => ({
      header: vi.fn((value: string) => events.push(`header:${value}`)),
      status: vi.fn((icon: string, message: string) => events.push(`status:${icon}:${message}`)),
      error: vi.fn((value: string) => value),
      warn: vi.fn((value: string) => value),
      info: vi.fn((value: string) => value),
      dim: vi.fn((value: string) => value),
    }));
    vi.doMock("../src/utils/maintenance-log.js", () => ({
      appendMaintenanceLog: vi.fn(async () => undefined),
    }));
    vi.doMock("../src/linter/system-check-guidance.js", () => ({
      formatSystemCheckGuidance: vi.fn(() => "guidance"),
    }));

    const { default: lintCommand } = await import("../src/commands/lint.js");
    await lintCommand();

    const autofixSummaryIndex = events.findIndex((event) => event.includes("自动修复"));
    const autofixDetailIndex = events.findIndex((event) => event.includes("alias-backfill 已应用 wiki/concepts/page.md broken-wikilink（ok）"));
    const diagnosticIndex = events.findIndex((event) => event.includes("warning page.md warn"));
    expect(events).toContain("status:*:自动修复 尝试 1 项，已应用 1 项，已跳过 0 项，失败 0 项");
    expect(autofixSummaryIndex).toBeGreaterThan(-1);
    expect(autofixDetailIndex).toBeGreaterThan(autofixSummaryIndex);
    expect(diagnosticIndex).toBeGreaterThan(autofixDetailIndex);
    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});
