/**
 * Covers deterministic Graphy insight rules.
 *
 * These tests keep the Insights panel grounded in graph structure: surprising
 * connections and knowledge gaps must be derived from nodes, edges, and
 * communities without invoking an LLM.
 */
import { describe, expect, it } from "vitest";
import {
  detectKnowledgeGaps,
  findSurprisingConnections,
} from "../web/client/src/pages/graph/graph-insights.js";
import type {
  WikiHomeGraphEdge,
  WikiHomeGraphNode,
  WikiHomeGraphPayload,
} from "../web/client/src/pages/wiki/home-graph.js";

describe("Graphy insights", () => {
  it("flags cross-community, cross-type, weak connections as surprising", () => {
    const payload = graphPayload([
      node("wiki/a.md", "Alpha", "entity", 1),
      node("wiki/b.md", "Beta", "concept", 2),
      node("wiki/c.md", "Core", "concept", 2),
    ], [
      edge("wiki/a.md", "wiki/b.md", 1),
      edge("wiki/b.md", "wiki/c.md", 1),
    ]);

    const [connection] = findSurprisingConnections(payload);

    expect(connection).toMatchObject({
      source: expect.objectContaining({ id: "wiki/a.md" }),
      target: expect.objectContaining({ id: "wiki/b.md" }),
      nodeIds: ["wiki/a.md", "wiki/b.md"],
    });
    expect(connection?.reasons).toEqual(expect.arrayContaining([
      "跨社区连接",
      "跨类型连接：entity ↔ concept",
      "弱连接但真实存在",
    ]));
  });

  it("excludes structural pages from insight noise", () => {
    const payload = graphPayload([
      node("wiki/index.md", "Index", "overview", 0),
      node("wiki/a.md", "Alpha", "entity", 1),
    ], [
      edge("wiki/index.md", "wiki/a.md", 1),
    ]);

    expect(findSurprisingConnections(payload)).toHaveLength(0);
    expect(detectKnowledgeGaps(payload).map((gap) => gap.nodeIds).flat()).not.toContain("wiki/index.md");
  });

  it("detects isolated pages, sparse communities, and bridge nodes", () => {
    const payload = graphPayload([
      node("wiki/a.md", "Alpha", "entity", 1),
      node("wiki/b.md", "Beta", "concept", 1),
      node("wiki/c.md", "Gamma", "concept", 1),
      node("wiki/bridge.md", "Bridge", "concept", 9),
      node("wiki/d.md", "Delta", "source", 2),
      node("wiki/e.md", "Epsilon", "concept", 3),
      node("wiki/lone.md", "Lone", "other", 4),
    ], [
      edge("wiki/bridge.md", "wiki/a.md", 2),
      edge("wiki/bridge.md", "wiki/d.md", 2),
      edge("wiki/bridge.md", "wiki/e.md", 2),
    ]);

    const gaps = detectKnowledgeGaps(payload);
    const types = gaps.map((gap) => gap.type);

    expect(types).toContain("isolated-page");
    expect(types).toContain("sparse-community");
    expect(types).toContain("bridge-node");
    expect(gaps.find((gap) => gap.type === "bridge-node")?.nodeIds).toEqual(["wiki/bridge.md"]);
  });
});

function graphPayload(
  nodes: readonly WikiHomeGraphNode[],
  edges: readonly WikiHomeGraphEdge[],
): WikiHomeGraphPayload {
  return { nodes: [...nodes], edges: [...edges], communities: [] };
}

function node(
  id: string,
  label: string,
  type: WikiHomeGraphNode["type"],
  community: number,
): WikiHomeGraphNode {
  return { id, label, path: id, type, community, size: 8, color: "#94a3b8", x: 0, y: 0 };
}

function edge(source: string, target: string, weight: number): WikiHomeGraphEdge {
  return { id: `${source}::${target}`, source, target, weight, label: "related" };
}
