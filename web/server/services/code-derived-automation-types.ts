/**
 * Contracts for source-owned automation flow modules.
 *
 * Real automation DAGs live beside the code they describe, but the workspace
 * server still needs one shared seed shape to load them uniformly and turn
 * them into API-ready automation definitions.
 */

import type { AutomationFlow } from "./automation-flow.js";

type CodeDerivedSourceInsightScope = "page" | "cross-page";

type CodeDerivedSourceInsightNodeKind = "trigger" | "decision" | "input" | "process" | "result";

export type CodeDerivedAutomationSourceKind = "code" | "information";

export interface CodeDerivedSourceInsightGraphNode {
  id: string;
  kind: CodeDerivedSourceInsightNodeKind;
  label: string;
  displayId?: string;
}

export interface CodeDerivedSourceInsightGraphEdge {
  source: string;
  target: string;
  label?: string;
}

interface CodeDerivedSourceInsightMissingLink {
  to: string;
  statusNote: string;
}

export interface CodeDerivedSourceInsightPotentialDestination {
  id: string;
  automationId: string;
  nodeId: string;
  label: string;
  intendedOutcome: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

interface CodeDerivedSourceInsightPageHotspotView {
  title: string;
  description: string;
  svg: string;
}

export interface CodeDerivedSourceInsightNodeInsight {
  summary: string;
  upstream: string[];
  downstream: string[];
  shownIn: string[];
  sourcePaths: string[];
  missingLinks: CodeDerivedSourceInsightMissingLink[];
  specRows?: Array<{
    label: string;
    value: string;
  }>;
  potentialDestinations?: CodeDerivedSourceInsightPotentialDestination[];
}

export interface CodeDerivedSourceInsight {
  scope: CodeDerivedSourceInsightScope;
  page: {
    id: string;
    title: string;
    routeLabel: string;
  };
  graph: {
    mermaid: string;
    nodes: CodeDerivedSourceInsightGraphNode[];
    edges: CodeDerivedSourceInsightGraphEdge[];
    preserveMermaid?: boolean;
  };
  pageHotspotView?: CodeDerivedSourceInsightPageHotspotView;
  nodeInsights: Record<string, CodeDerivedSourceInsightNodeInsight>;
  appendices?: Array<{
    id: string;
    title: string;
    content: string;
  }>;
}

export interface CodeDerivedAutomationSeed {
  slug: string;
  name: string;
  summary: string;
  icon: string;
  /**
   * User-facing topic for the automation list. This is not a file-origin flag:
   * source-owned flows that explain data movement should use "information"
   * even when their implementation lives in code.
   */
  sourceKind?: CodeDerivedAutomationSourceKind;
  sourcePaths: string[];
  flow: AutomationFlow;
  mermaid?: string;
  sourceInsight?: CodeDerivedSourceInsight;
}

export interface CodeDerivedAutomationModule {
  codeDerivedAutomationSeeds: readonly CodeDerivedAutomationSeed[];
}
