/**
 * Shared graph model contracts for the Wiki home Graphy pipeline.
 *
 * These types define the server response, normalized markdown page shape,
 * graphology attributes, visual constants, and relevance weights used by the
 * parser, scorer, layout, and API route layers.
 */

export type WikiGraphNodeType =
  | "entity"
  | "concept"
  | "source"
  | "query"
  | "synthesis"
  | "overview"
  | "comparison"
  | "other";

export interface WikiGraphNodePayload {
  id: string;
  label: string;
  path: string;
  type: WikiGraphNodeType;
  linkCount: number;
  community: number;
  size: number;
  color: string;
  x: number;
  y: number;
}

export interface WikiGraphEdgePayload {
  id: string;
  source: string;
  target: string;
  weight: number;
  label: string;
}

export interface WikiGraphCommunityPayload {
  id: number;
  nodeCount: number;
  cohesion: number;
  topNodes: string[];
}

export interface WikiGraphPayload {
  generatedAt: string;
  nodes: WikiGraphNodePayload[];
  edges: WikiGraphEdgePayload[];
  communities: WikiGraphCommunityPayload[];
}

export interface ParsedWikiPage {
  path: string;
  title: string;
  type: WikiGraphNodeType;
  sources: string[];
  aliases: string[];
  links: string[];
}

export interface WikiGraphNodeAttributes {
  label: string;
  path: string;
  type: WikiGraphNodeType;
  color: string;
  x: number;
  y: number;
  community?: number;
}

export interface WikiGraphEdgeAttributes {
  weight: number;
  label: string;
}

export interface EdgeDraft {
  source: string;
  target: string;
  directLinkScore: number;
  sourceOverlapScore: number;
  commonNeighborScore: number;
  typeAffinityScore: number;
}

interface GraphyRelevanceWeights {
  directLink: number;
  sourceOverlap: number;
  commonNeighbor: number;
  typeAffinity: number;
}

type GraphyTypeAffinity = Readonly<Partial<Record<
  WikiGraphNodeType,
  Readonly<Partial<Record<WikiGraphNodeType, number>>>
>>>;

interface GraphyRelevanceConfig {
  weights: GraphyRelevanceWeights;
  typeAffinity: GraphyTypeAffinity;
}

export const NODE_COLORS: Record<WikiGraphNodeType, string> = {
  entity: "#60a5fa",
  concept: "#c084fc",
  source: "#fb923c",
  query: "#4ade80",
  synthesis: "#f87171",
  overview: "#facc15",
  comparison: "#2dd4bf",
  other: "#94a3b8",
};

export const GRAPHY_RELEVANCE_CONFIG: GraphyRelevanceConfig = {
  weights: {
    directLink: 3.0,
    sourceOverlap: 4.0,
    commonNeighbor: 1.5,
    typeAffinity: 1.0,
  },
  typeAffinity: {
    entity: { concept: 1.2 },
    concept: { entity: 1.2, synthesis: 1.2, concept: 0.8 },
    synthesis: { concept: 1.2 },
    source: { source: 0.5 },
  },
};

export const DIRECT_LINK_WEIGHT = GRAPHY_RELEVANCE_CONFIG.weights.directLink;
export const SOURCE_OVERLAP_WEIGHT = GRAPHY_RELEVANCE_CONFIG.weights.sourceOverlap;
export const ADAMIC_ADAR_WEIGHT = GRAPHY_RELEVANCE_CONFIG.weights.commonNeighbor;
export const TYPE_AFFINITY_WEIGHT = GRAPHY_RELEVANCE_CONFIG.weights.typeAffinity;
export const BASE_NODE_SIZE = 8;
export const MAX_NODE_SIZE = 28;
