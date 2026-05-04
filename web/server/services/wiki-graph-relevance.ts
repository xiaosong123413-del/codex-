/**
 * Scores existing wikilink relationships between normalized wiki pages for Graphy.
 *
 * Relations start from real Obsidian wikilinks, then direct link direction,
 * shared sources, common-neighbor Adamic-Adar influence, and type affinity
 * contribute to the final edge weight.
 */
import {
  ADAMIC_ADAR_WEIGHT,
  DIRECT_LINK_WEIGHT,
  GRAPHY_RELEVANCE_CONFIG,
  SOURCE_OVERLAP_WEIGHT,
  TYPE_AFFINITY_WEIGHT,
  type EdgeDraft,
  type ParsedWikiPage,
  type WikiGraphEdgePayload,
} from "./wiki-graph-model.js";
import { normalizeLookupKey } from "./wiki-graph-pages.js";

/** Builds deduplicated weighted graph edges from parsed wiki pages. */
export function buildEdges(
  pages: readonly ParsedWikiPage[],
  lookup: ReadonlyMap<string, ParsedWikiPage>,
): WikiGraphEdgePayload[] {
  const drafts = new Map<string, EdgeDraft>();
  addDirectLinkEdges(drafts, pages, lookup);
  addSourceOverlapScores(drafts, pages);
  addCommonNeighborScores(drafts);
  addTypeAffinityScores(drafts, pages);
  return Array.from(drafts.entries()).map(([id, draft]) => {
    const weight = scoreEdge(draft);
    return {
      id,
      source: draft.source,
      target: draft.target,
      weight,
      label: weight.toFixed(1),
    };
  });
}

function addDirectLinkEdges(
  drafts: Map<string, EdgeDraft>,
  pages: readonly ParsedWikiPage[],
  lookup: ReadonlyMap<string, ParsedWikiPage>,
): void {
  for (const page of pages) {
    for (const link of page.links) {
      const target = lookup.get(normalizeLookupKey(link));
      if (target) {
        getEdgeDraft(drafts, page.path, target.path).directLinkScore += 1;
      }
    }
  }
}

function addSourceOverlapScores(drafts: Map<string, EdgeDraft>, pages: readonly ParsedWikiPage[]): void {
  const buckets = new Map<string, ParsedWikiPage[]>();
  for (const page of pages) {
    for (const source of page.sources) {
      const key = source.trim().toLowerCase();
      buckets.set(key, [...(buckets.get(key) ?? []), page]);
    }
  }
  for (const bucket of buckets.values()) {
    addPairwiseValues(bucket, (left, right) => {
      const draft = findEdgeDraft(drafts, left.path, right.path);
      if (draft) {
        draft.sourceOverlapScore += 1;
      }
    });
  }
}

function addCommonNeighborScores(drafts: Map<string, EdgeDraft>): void {
  const neighbors = buildDirectNeighborMap(drafts);
  for (const linkedNodes of neighbors.values()) {
    const degree = linkedNodes.size;
    if (degree < 2) {
      continue;
    }
    const score = 1 / Math.log(Math.max(degree, 2));
    addPairwiseValues(Array.from(linkedNodes), (left, right) => {
      const draft = findEdgeDraft(drafts, left, right);
      if (draft) {
        draft.commonNeighborScore += score;
      }
    });
  }
}

function addTypeAffinityScores(drafts: Map<string, EdgeDraft>, pages: readonly ParsedWikiPage[]): void {
  const pageByPath = new Map(pages.map((page) => [page.path, page]));
  for (const draft of drafts.values()) {
    const left = pageByPath.get(draft.source);
    const right = pageByPath.get(draft.target);
    draft.typeAffinityScore = left && right ? typeAffinityScore(left, right) : 0;
  }
}

function scoreEdge(draft: EdgeDraft): number {
  return draft.directLinkScore * DIRECT_LINK_WEIGHT
    + draft.sourceOverlapScore * SOURCE_OVERLAP_WEIGHT
    + draft.commonNeighborScore * ADAMIC_ADAR_WEIGHT
    + draft.typeAffinityScore * TYPE_AFFINITY_WEIGHT;
}

function typeAffinityScore(left: ParsedWikiPage, right: ParsedWikiPage): number {
  return GRAPHY_RELEVANCE_CONFIG.typeAffinity[left.type]?.[right.type] ?? 0;
}

function getEdgeDraft(drafts: Map<string, EdgeDraft>, source: string, target: string): EdgeDraft {
  const { id, left, right } = edgeKey(source, target);
  const existing = drafts.get(id);
  if (existing) {
    return existing;
  }
  const draft = {
    source: left,
    target: right,
    directLinkScore: 0,
    sourceOverlapScore: 0,
    commonNeighborScore: 0,
    typeAffinityScore: 0,
  };
  drafts.set(id, draft);
  return draft;
}

function findEdgeDraft(drafts: ReadonlyMap<string, EdgeDraft>, source: string, target: string): EdgeDraft | undefined {
  return drafts.get(edgeKey(source, target).id);
}

function edgeKey(source: string, target: string): { id: string; left: string; right: string } {
  const [left, right] = source < target ? [source, target] : [target, source];
  return { id: `${left}::${right}`, left, right };
}

function buildDirectNeighborMap(drafts: ReadonlyMap<string, EdgeDraft>): Map<string, Set<string>> {
  const neighbors = new Map<string, Set<string>>();
  for (const draft of drafts.values()) {
    if (draft.directLinkScore <= 0) {
      continue;
    }
    addNeighbor(neighbors, draft.source, draft.target);
    addNeighbor(neighbors, draft.target, draft.source);
  }
  return neighbors;
}

function addNeighbor(neighbors: Map<string, Set<string>>, source: string, target: string): void {
  const existing = neighbors.get(source) ?? new Set<string>();
  existing.add(target);
  neighbors.set(source, existing);
}

function addPairwiseValues<T>(items: readonly T[], visit: (left: T, right: T) => void): void {
  for (let left = 0; left < items.length; left += 1) {
    for (let right = left + 1; right < items.length; right += 1) {
      visit(items[left]!, items[right]!);
    }
  }
}
