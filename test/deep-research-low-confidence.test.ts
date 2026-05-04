/**
 * Regression coverage for low-confidence deep-research confirmation and
 * legacy backfill behavior on the review page.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkLowConfidenceClaims } from "../src/linter/lifecycle-rules.js";
import {
  handleDeepResearchConfirm,
  handleReviewSummary,
} from "../web/server/routes/review.js";

const tempRoots: string[] = [];

describe("deep research low-confidence confirmation", () => {
  afterEach(() => {
    while (tempRoots.length > 0) {
      fs.rmSync(tempRoots.pop()!, { recursive: true, force: true });
    }
  });

  it("refreshes the matching low-confidence claim when deep research is confirmed", async () => {
    const cfg = makeLowConfidenceConfig({
      status: "done-await-confirm",
      progress: 100,
      selectedAction: "deep-research",
      draftResult: {
        mode: "append",
        pagePath: "wiki/concepts/example.md",
        summary: "Deep Research草案",
        preview: "补齐外部来源后再确认。",
        content: [
          "<!-- deep-research:deep-research-check-low-confidence -->",
          "## Deep Research草案",
          "- 问题类型：需要网络搜索补证的数据空白",
          "- 页面：wiki/concepts/example.md",
          "- 处理动作：Deep Research",
          "- 对象：Android Studio 已集成开发安卓 App 所需的全部组件，无需单独安装 JDK 或其他工具链。",
          "- 触发依据：当前结论置信度只有 0.55，状态为 active，需要补充外部证据后再确认。",
        ].join("\n"),
      },
    });
    const response = createResponse();

    await handleDeepResearchConfirm(cfg)(
      { params: { id: "deep-research-check-low-confidence" } } as never,
      response as never,
    );

    expect(response.statusCode).toBe(200);
    expect(response.body.data.deepResearch.status).toBe("completed");

    const claims = readClaims(cfg.sourceVaultRoot);
    expect(claims[0]?.status).toBe("active");
    expect(claims[0]?.supportCount).toBe(2);
    expect(claims[0]?.confidence).toBeGreaterThanOrEqual(0.6);
    expect(claims[0]?.retention).toBe(1);
    expect(claims[0]?.lastConfirmedAt).toMatch(/^20\d\d-\d\d-\d\dT/);

    const lowConfidenceResults = await checkLowConfidenceClaims(cfg.sourceVaultRoot);
    expect(lowConfidenceResults).toHaveLength(0);
  });

  it("backfills legacy confirmed low-confidence deep-research items on review load", async () => {
    const cfg = makeLowConfidenceConfig({
      pageContent: [
        "# Example",
        "",
        "## 置信度概览",
        "",
        "- Android Studio 已集成开发安卓 App 所需的全部组件，无需单独安装 JDK 或其他工具链。（confidence 0.55 / retention 1.00 / last confirmed 2026-04-19）",
        "",
        "<!-- deep-research:deep-research-check-low-confidence -->",
        "## Deep Research草案",
        "- 问题类型：需要网络搜索补证的数据空白",
        "- 页面：wiki/concepts/example.md",
        "- 处理动作：Deep Research",
        "- 对象：Android Studio 已集成开发安卓 App 所需的全部组件，无需单独安装 JDK 或其他工具链。",
        "- 触发依据：当前结论置信度只有 0.55，状态为 active，需要补充外部证据后再确认。",
      ].join("\n"),
    });
    const response = createJsonSpy();

    await handleReviewSummary(cfg, { getCurrent() { return null; } } as never)(
      {} as never,
      response as never,
    );

    const payload = response.payload as {
      success: boolean;
      data: {
        items: Array<{ id: string }>;
      };
    };
    expect(payload.success).toBe(true);
    expect(payload.data.items.some((item) => item.id === "deep-research-check-low-confidence")).toBe(false);

    const claims = readClaims(cfg.sourceVaultRoot);
    expect(claims[0]?.supportCount).toBe(2);
    expect(claims[0]?.confidence).toBeGreaterThanOrEqual(0.6);
    expect(claims[0]?.lastConfirmedAt).toMatch(/^20\d\d-\d\d-\d\dT/);

    const stored = JSON.parse(
      fs.readFileSync(path.join(cfg.runtimeRoot, ".llmwiki", "deep-research-items.json"), "utf8"),
    ) as Array<{ id: string; status: string; progress: number }>;
    expect(stored.find((item) => item.id === "deep-research-check-low-confidence")).toMatchObject({
      status: "completed",
      progress: 100,
    });

    const lowConfidenceResults = await checkLowConfidenceClaims(cfg.sourceVaultRoot);
    expect(lowConfidenceResults).toHaveLength(0);
  });
});

function makeLowConfidenceConfig(
  overrides: Partial<{
    status: string;
    progress: number;
    selectedAction: string;
    pageContent: string;
    draftResult: {
      mode: "append";
      pagePath: string;
      summary: string;
      preview: string;
      content: string;
    };
  }> = {},
) {
  const sourceVaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "review-route-low-confidence-source-"));
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "review-route-low-confidence-runtime-"));
  tempRoots.push(sourceVaultRoot, runtimeRoot);
  fs.mkdirSync(path.join(runtimeRoot, ".llmwiki"), { recursive: true });
  fs.mkdirSync(path.join(sourceVaultRoot, ".llmwiki"), { recursive: true });
  fs.mkdirSync(path.join(sourceVaultRoot, "wiki", "concepts"), { recursive: true });
  fs.writeFileSync(
    path.join(sourceVaultRoot, "wiki", "concepts", "example.md"),
    overrides.pageContent ?? "# Example\n\nOld content.\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(sourceVaultRoot, ".llmwiki", "claims.json"),
    JSON.stringify([
      {
        id: "claim-low-confidence-example",
        conceptSlug: "example",
        claimKey: "android-studio-includes-all-sdk",
        claimText: "Android Studio 已集成开发安卓 App 所需的全部组件，无需单独安装 JDK 或其他工具链。",
        claimType: "fact",
        sourceFiles: ["source.md"],
        sources: [{
          file: "source.md",
          title: "source.md",
          kind: "external",
          channel: "外部源",
          observedAt: "2026-04-19T17:20:38.590Z",
        }],
        firstSeenAt: "2026-04-19T17:20:38.590Z",
        lastConfirmedAt: "2026-04-19T17:20:38.590Z",
        supportCount: 1,
        contradictionCount: 0,
        confidence: 0.5470568568607975,
        retention: 1,
        status: "active",
        supersedes: [],
        halfLifeDays: 90,
      },
    ], null, 2),
    "utf8",
  );
  fs.writeFileSync(
    path.join(runtimeRoot, ".llmwiki", "deep-research-items.json"),
    JSON.stringify([
      {
        id: "deep-research-check-low-confidence",
        kind: "check",
        title: "需要网络搜索补证的数据空白",
        detail: "当前结论置信度只有 0.55，状态为 active，需要补充外部证据后再确认。",
        category: "needs-deep-research",
        scope: "claim",
        pagePath: "wiki/concepts/example.md",
        line: 12,
        factText: "Android Studio 已集成开发安卓 App 所需的全部组件，无需单独安装 JDK 或其他工具链。",
        gapText: "Low-confidence claim: Android Studio 已集成开发安卓 App 所需的全部组件，无需单独安装 JDK 或其他工具链。",
        triggerReason: "当前结论置信度只有 0.55，状态为 active，需要补充外部证据后再确认。",
        sourceExcerpt: "i info wiki/concepts/example.md Low-confidence claim: Android Studio 已集成开发安卓 App 所需的全部组件，无需单独安装 JDK 或其他工具链。 (confidence 0.55, status active)",
        status: overrides.status ?? "pending",
        progress: overrides.progress ?? 0,
        selectedAction: overrides.selectedAction,
        draftResult: overrides.draftResult,
        createdAt: "2026-04-25T12:35:37.678Z",
        updatedAt: "2026-04-25T12:35:37.678Z",
      },
    ], null, 2),
    "utf8",
  );
  return {
    sourceVaultRoot,
    runtimeRoot,
    projectRoot: sourceVaultRoot,
    port: 4175,
    host: "127.0.0.1",
    author: "me",
  };
}

function readClaims(root: string): Array<{
  status: string;
  supportCount: number;
  confidence: number;
  retention: number;
  lastConfirmedAt: string;
}> {
  return JSON.parse(fs.readFileSync(path.join(root, ".llmwiki", "claims.json"), "utf8")) as Array<{
    status: string;
    supportCount: number;
    confidence: number;
    retention: number;
    lastConfirmedAt: string;
  }>;
}

function createResponse() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}

function createJsonSpy(): { payload: unknown; json: (payload: unknown) => void } {
  return {
    payload: undefined,
    json(payload: unknown) {
      this.payload = payload;
    },
  };
}
