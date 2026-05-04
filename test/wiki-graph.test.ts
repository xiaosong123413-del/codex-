/**
 * Covers the server-side Graphy graph builder.
 *
 * The tests pin the relevance scoring contract because the browser only
 * renders edge weights; wikilink discovery, source overlap, common-neighbor
 * scoring, and type affinity all happen before the API payload is returned.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ServerConfig } from "../web/server/config.js";
import { buildWikiGraph, buildWikiGraphForPage } from "../web/server/services/wiki-graph.js";

const roots: string[] = [];

describe("wiki graph builder", () => {
  it("scores Graphy edges from four signals without creating source-only edges", () => {
    const cfg = makeConfig();
    writeWikiPage(cfg, "index.md", [
      "---",
      "title: Home",
      "type: overview",
      "---",
      "# Home",
      "[[Alpha]]",
    ].join("\n"));
    writeWikiPage(cfg, "alpha.md", [
      "---",
      "title: Alpha",
      "type: entity",
      "sources:",
      "  - shared.md",
      "---",
      "# Alpha",
      "[[Beta]]",
      "[[Connector]]",
    ].join("\n"));
    writeWikiPage(cfg, "beta.md", [
      "---",
      "title: Beta",
      "type: concept",
      "sources:",
      "  - shared.md",
      "---",
      "# Beta",
      "[[Alpha]]",
      "[[Connector]]",
    ].join("\n"));
    writeWikiPage(cfg, "connector.md", [
      "---",
      "title: Connector",
      "type: source",
      "---",
      "# Connector",
    ].join("\n"));
    writeWikiPage(cfg, "gamma.md", [
      "---",
      "title: Gamma",
      "type: concept",
      "sources:",
      "  - shared.md",
      "---",
      "# Gamma",
    ].join("\n"));
    writeWikiPage(cfg, "question.md", [
      "---",
      "title: Question",
      "type: query",
      "---",
      "# Question",
      "[[Alpha]]",
    ].join("\n"));

    const graph = buildWikiGraph(cfg);
    const alphaBeta = graph.edges.find((edge) =>
      edge.source === "wiki/alpha.md" && edge.target === "wiki/beta.md",
    );

    expect(graph.nodes.map((node) => node.id).sort()).toEqual([
      "wiki/alpha.md",
      "wiki/beta.md",
      "wiki/connector.md",
      "wiki/gamma.md",
      "wiki/index.md",
    ]);
    expect(graph.nodes.find((node) => node.id === "wiki/alpha.md")).toMatchObject({
      label: "Alpha",
      type: "entity",
      color: "#60a5fa",
    });
    expect(alphaBeta?.weight).toBeCloseTo(13.36, 2);
    expect(alphaBeta?.label).toBe("13.4");
    expect(graph.edges.some((edge) => edge.id === "wiki/alpha.md::wiki/gamma.md")).toBe(false);
    expect(graph.edges.some((edge) => edge.id === "wiki/alpha.md::wiki/index.md")).toBe(true);
    expect(graph.communities.length).toBeGreaterThan(0);
    expect(graph.communities[0]).toEqual(expect.objectContaining({
      id: 0,
      nodeCount: expect.any(Number),
      cohesion: expect.any(Number),
      topNodes: expect.any(Array),
    }));
  });

  it("infers graph node type from wiki folder when frontmatter type is absent", () => {
    const cfg = makeConfig();
    writeWikiPage(cfg, "concepts/topic.md", [
      "---",
      "title: Topic",
      "---",
      "# Topic",
    ].join("\n"));
    writeWikiPage(cfg, "个人信息档案/profile.md", [
      "---",
      "title: Profile",
      "type: identity_profile",
      "---",
      "# Profile",
    ].join("\n"));

    const graph = buildWikiGraph(cfg);

    expect(graph.nodes.find((node) => node.id === "wiki/concepts/topic.md")).toMatchObject({
      type: "concept",
      color: "#c084fc",
    });
    expect(graph.nodes.find((node) => node.id === "wiki/个人信息档案/profile.md")).toMatchObject({
      type: "entity",
      color: "#60a5fa",
    });
  });

  it("builds a direct relation subgraph for one wiki page", () => {
    const cfg = makeConfig();
    writeWikiPage(cfg, "index.md", "# Home\n\n[[Alpha]]");
    writeWikiPage(cfg, "alpha.md", "# Alpha\n\n[[Beta]]");
    writeWikiPage(cfg, "beta.md", "# Beta");
    writeWikiPage(cfg, "unrelated.md", "# Unrelated");

    const graph = buildWikiGraphForPage(cfg, "wiki/alpha.md");

    expect(graph.nodes.map((node) => node.id).sort()).toEqual([
      "wiki/alpha.md",
      "wiki/beta.md",
      "wiki/index.md",
    ]);
    expect(graph.edges.map((edge) => edge.id).sort()).toEqual([
      "wiki/alpha.md::wiki/beta.md",
      "wiki/alpha.md::wiki/index.md",
    ]);
    expect(graph.nodes.some((node) => node.id === "wiki/unrelated.md")).toBe(false);
  });
});

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

function makeConfig(): ServerConfig {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-graph-project-"));
  const sourceVaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-graph-source-"));
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-graph-runtime-"));
  roots.push(projectRoot, sourceVaultRoot, runtimeRoot);
  fs.mkdirSync(path.join(sourceVaultRoot, "wiki"), { recursive: true });
  return {
    projectRoot,
    sourceVaultRoot,
    runtimeRoot,
    host: "127.0.0.1",
    port: 4175,
    author: "me",
  };
}

function writeWikiPage(cfg: ServerConfig, relPath: string, content: string): void {
  const filePath = path.join(cfg.sourceVaultRoot, "wiki", relPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${content}\n`, "utf-8");
}
