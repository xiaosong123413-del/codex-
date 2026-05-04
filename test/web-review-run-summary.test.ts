/**
 * Focused regression coverage for failed review run summaries.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { aggregateReviewItems } from "../web/server/services/review-aggregator.js";
import type { RunSnapshot } from "../web/server/services/run-manager.js";

const tempRoots: string[] = [];

describe("review failed run summary", () => {
  afterEach(() => {
    while (tempRoots.length > 0) {
      fs.rmSync(tempRoots.pop()!, { recursive: true, force: true });
    }
  });

  it("drops node deprecation warning noise from failed check summaries", () => {
    const root = makeRoot();
    const result = aggregateReviewItems({
      sourceVaultRoot: root,
      runtimeRoot: root,
      projectRoot: root,
      currentRun: makeRun([
        "(node:45104) [DEP0040] DeprecationWarning: The `punycode` module is deprecated. Please use a userland alternative instead.",
        "(Use `node --trace-deprecation ...` to show where the warning was created)",
        "x error wiki/concepts/example.md:22 Broken wikilink [[Missing Page]] - no matching page found",
        "* 1 error(s), 0 warning(s), 0 info",
        "需要你确认后再继续：",
        "process exited with code 1",
      ]),
    });

    expect(result.items).toContainEqual(
      expect.objectContaining({
        kind: "run",
        title: "系统检查失败",
        run: {
          kind: "check",
          status: "failed",
          exitCode: 1,
        },
        detail: [
          "x error wiki/concepts/example.md:22 Broken wikilink [[Missing Page]] - no matching page found",
          "* 1 error(s), 0 warning(s), 0 info",
        ].join("\n"),
      }),
    );
  });
});

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "review-run-summary-"));
  tempRoots.push(root);
  return root;
}

function makeRun(lines: string[]): RunSnapshot {
  return {
    id: "check-test",
    kind: "check",
    status: "failed",
    startedAt: "2026-04-17T01:00:00.000Z",
    endedAt: "2026-04-17T01:01:00.000Z",
    exitCode: 1,
    lines: lines.map((text, index) => ({
      at: `2026-04-17T01:00:${String(index).padStart(2, "0")}.000Z`,
      source: "stdout",
      text,
    })),
  };
}
