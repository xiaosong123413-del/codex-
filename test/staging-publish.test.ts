import { describe, expect, it } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { makeTempRoot } from "./fixtures/temp-root.js";
import {
  createStagingRun,
  publishStagingRun,
  readFinalCompileResult,
  writeFinalCompileResult,
} from "../scripts/sync-compile/staging.mjs";

describe("staging publish", () => {
  it("publishes staging wiki and state into the runtime root without touching the source vault", async () => {
    const root = await makeTempRoot("staging-publish");
    const sourceVaultRoot = path.join(root, "source-vault");
    const runtimeRoot = path.join(root, "runtime");
    await mkdir(path.join(sourceVaultRoot, "wiki"), { recursive: true });
    await mkdir(path.join(sourceVaultRoot, "wiki", "episodes"), { recursive: true });
    await mkdir(path.join(runtimeRoot, "wiki"), { recursive: true });
    await mkdir(path.join(runtimeRoot, ".llmwiki"), { recursive: true });
    await writeFile(path.join(sourceVaultRoot, "wiki", "index.md"), "# source\n", "utf8");
    await writeFile(path.join(sourceVaultRoot, "wiki", "episodes", "old.md"), "# old episode\n", "utf8");
    await writeFile(path.join(runtimeRoot, "wiki", "index.md"), "# live\n", "utf8");
    await writeFile(path.join(runtimeRoot, ".llmwiki", "state.json"), "{\"version\":2,\"indexHash\":\"\",\"sources\":{}}\n", "utf8");

    const staging = await createStagingRun(sourceVaultRoot, runtimeRoot);

    await expect(readFile(path.join(staging.root, "wiki", "index.md"), "utf8")).resolves.toBe("# source\n");
    await expect(readFile(path.join(staging.root, "wiki", "episodes", "old.md"), "utf8")).rejects.toThrow();
    await expect(readFile(path.join(staging.root, ".llmwiki", "state.json"), "utf8")).resolves.toBe(
      "{\"version\":2,\"indexHash\":\"\",\"sources\":{}}\n",
    );

    await writeFile(path.join(staging.root, "wiki", "index.md"), "# staging\n", "utf8");
    await writeFile(path.join(staging.root, ".llmwiki", "claims.json"), "[]\n", "utf8");

    await expect(readFile(path.join(runtimeRoot, "wiki", "index.md"), "utf8")).resolves.toBe("# live\n");
    await expect(readFile(path.join(sourceVaultRoot, "wiki", "index.md"), "utf8")).resolves.toBe("# source\n");

    await publishStagingRun(sourceVaultRoot, runtimeRoot, staging);

    await expect(readFile(path.join(runtimeRoot, "wiki", "index.md"), "utf8")).resolves.toBe("# staging\n");
    await expect(readFile(path.join(runtimeRoot, "wiki", "episodes", "old.md"), "utf8")).rejects.toThrow();
    await expect(readFile(path.join(runtimeRoot, ".llmwiki", "claims.json"), "utf8")).resolves.toBe("[]\n");
    await expect(readFile(path.join(sourceVaultRoot, "wiki", "index.md"), "utf8")).resolves.toBe("# source\n");
    await expect(readFile(path.join(sourceVaultRoot, ".llmwiki", "state.json"), "utf8")).rejects.toThrow();
  });

  it("persists a single final compile result", async () => {
    const root = await makeTempRoot("final-result");

    await writeFinalCompileResult(root, {
      status: "succeeded",
      syncedMarkdownCount: 3,
      syncedAssetCount: 1,
      completedFilesCount: 3,
      internalBatchCount: 2,
      batchLimit: 20,
      claimsUpdated: 4,
      proceduresUpdated: 1,
      wikiOutputDir: path.join(root, "wiki"),
      publishedAt: "2026-04-19T00:00:00.000Z",
    });

    const result = await readFinalCompileResult(root);

    expect(result?.status).toBe("succeeded");
    expect(result?.internalBatchCount).toBe(2);
    expect(result?.claimsUpdated).toBe(4);
  });
});
