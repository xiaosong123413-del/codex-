import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";

const scriptPath = fileURLToPath(new URL("../scripts/search-eval.mjs", import.meta.url));
const queriesPath = fileURLToPath(new URL("../search/queries.sample.json", import.meta.url));
const qrelsPath = fileURLToPath(new URL("../search/qrels.sample.json", import.meta.url));
const benchmarkQueriesPath = fileURLToPath(new URL("../search/queries.benchmark.json", import.meta.url));
const benchmarkQrelsPath = fileURLToPath(new URL("../search/qrels.benchmark.json", import.meta.url));
const queriesData = JSON.parse(fs.readFileSync(queriesPath, "utf-8"));
const qrelsData = JSON.parse(fs.readFileSync(qrelsPath, "utf-8"));
const documentById = new Map(queriesData.documents.map((document) => [document.id, document]));

describe("search eval", () => {
  it("covers direct, keyword, hybrid, temporal, entity, and workflow intents across four corpus layers", () => {
    expect(queriesData.documents.length).toBeGreaterThanOrEqual(12);
    expect(queriesData.queries.length).toBeGreaterThanOrEqual(9);
    expect(queriesData.queries.map((query) => query.mode)).toEqual(
      expect.arrayContaining(["direct", "keyword", "hybrid", "temporal", "entity", "workflow"]),
    );

    const qrelsDocIds = Object.values(qrelsData).flatMap((rels) =>
      Object.entries(rels)
        .filter(([, gain]) => Number(gain) > 0)
        .map(([id]) => id),
    );

    expect(qrelsDocIds.some((id) => documentById.get(id)?.path.startsWith("wiki/concepts/"))).toBe(true);
    expect(qrelsDocIds.some((id) => documentById.get(id)?.path.startsWith("wiki/procedures/"))).toBe(true);
    expect(qrelsDocIds.some((id) => documentById.get(id)?.path.startsWith("sources_full/"))).toBe(true);
    expect(queriesData.documents.some((document) => document.path.startsWith("raw/"))).toBe(true);
    expect(queriesData.queries.some((query) => String(query.query).toLowerCase().includes("incident"))).toBe(true);
    expect(queriesData.queries.some((query) => String(query.query).toLowerCase().includes("playbook"))).toBe(true);
  });

  it("prints P@k, Recall@k, MRR, and nDCG@k from sample queries and qrels", () => {
    const result = spawnSync("node", [scriptPath, "--queries", queriesPath, "--qrels", qrelsPath], {
      encoding: "utf-8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("P@");
    expect(result.stdout).toContain("Recall@");
    expect(result.stdout).toContain("MRR");
    expect(result.stdout).toContain("nDCG@");
  });

  it("ships a larger benchmark fixture that resembles real wiki retrieval mixes", () => {
    const benchmarkQueriesData = JSON.parse(fs.readFileSync(benchmarkQueriesPath, "utf-8"));
    const benchmarkQrelsData = JSON.parse(fs.readFileSync(benchmarkQrelsPath, "utf-8"));
    const benchmarkDocumentById = new Map(
      benchmarkQueriesData.documents.map((document: { id: string }) => [document.id, document]),
    );

    expect(benchmarkQueriesData.documents.length).toBeGreaterThanOrEqual(16);
    expect(benchmarkQueriesData.queries.length).toBeGreaterThanOrEqual(12);
    expect(benchmarkQueriesData.queries.map((query: { mode: string }) => query.mode)).toEqual(
      expect.arrayContaining(["direct", "keyword", "hybrid", "temporal", "entity", "workflow"]),
    );
    expect(benchmarkQueriesData.queries.map((query: { group?: string }) => query.group)).toEqual(
      expect.arrayContaining(["concept", "procedure", "temporal", "supporting-source"]),
    );

    const benchmarkQrelDocIds = Object.values(benchmarkQrelsData).flatMap((rels) =>
      Object.entries(rels as Record<string, number>)
        .filter(([, gain]) => Number(gain) > 0)
        .map(([id]) => id),
    );

    expect(benchmarkQrelDocIds.some((id) => (benchmarkDocumentById.get(id) as { path?: string } | undefined)?.path?.startsWith("wiki/concepts/"))).toBe(true);
    expect(benchmarkQrelDocIds.some((id) => (benchmarkDocumentById.get(id) as { path?: string } | undefined)?.path?.startsWith("wiki/procedures/"))).toBe(true);
    expect(benchmarkQrelDocIds.some((id) => (benchmarkDocumentById.get(id) as { path?: string } | undefined)?.path?.startsWith("sources_full/"))).toBe(true);
    expect(benchmarkQueriesData.documents.some((document: { path: string }) => document.path.startsWith("raw/"))).toBe(true);
  });

  it("runs search-eval against the larger benchmark fixture", () => {
    const result = spawnSync("node", [scriptPath, "--queries", benchmarkQueriesPath, "--qrels", benchmarkQrelsPath], {
      encoding: "utf-8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Evaluated");
    expect(result.stdout).toContain("P@");
    expect(result.stdout).toContain("Recall@");
    expect(result.stdout).toContain("MRR");
    expect(result.stdout).toContain("nDCG@");
  });
});
